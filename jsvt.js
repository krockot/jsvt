// Rudimentary VT100/Xterm emulator
// Copyright (c) 2011, Ken Rockot
// All rights reserved.
//
// This software may be distributed in any form and for
// any purpose.  Do whatever you want with it.
//
// Requires jQuery to be loaded.

jsvt = {};

jsvt.TerminalColors = [
	'#000000',
	'#aa0000',
	'#00aa00',
	'#aa5500',
	'#0000aa',
	'#aa00aa',
	'#00aaaa',
	'#aaaaaa',
	'#000000',
	'#ff5555',
	'#55ff55',
	'#ffff55',
	'#5555ff',
	'#ff55ff',
	'#55ffff',
	'#ffffff'
];

jsvt.Terminal = function()
{
	this.rows = 25;
	this.cols = 80;
	this.scrollBufferLines = 1000;
	this.title = "jsvt";
	this.titleHandler = function(title) {}

	this.display = $("<div/>").css("display", "inline-block");
	
	var cellT = $("<pre/>")
		.css("background", jsvt.TerminalColors[0])
		.css("color", jsvt.TerminalColors[7])
		.css("font-family", "DejaVu Sans Mono, Bitstream Vera Sans Mono, monospace")
		.css("font-size", "10pt")
		.css("display", "inline")
		.text(" ");
	
	this.screen = [];
	for(var j = 0; j < this.rows; ++j) {
		this.screen.push([]);
		for(var i = 0; i < this.cols; ++i) {
			this.screen[j].push(cellT.clone().appendTo(this.display));
		}
		this.display.append($("<br/>"));
	}
	
	this.showCursor = true;
	this.applicationKeyMode = false;
	
	var self = this;
	var NewBuffer = function() {
		var buffer = {
			cursor: {x:0,y:0},	// current cursor position in the virtual buffer
			lines: [],			// visible line buffer
			attr: {				// character attributes used for newly written characters
				fgColor: 7,
				bgColor: 0,
				bold: false,
				underline: false,
				blink: false,
				inverse: false
			},
			savedCursor: {x:0,y:0}, // saved cursor state from DECSC
			useScrollRegion: false, // default to full window scrolling
			scrollTop: 0,			// top row of the defined scroll region, if any
			scrollBottom: 0,		// bottom row of the defined scroll region, if any
			scrollBuffer: []		// lines shifted out of the visible buffer
		};
		for(var i = 0; i < self.rows; ++i)
			buffer.lines.push([]);
		return buffer;
	}

	this.normalBuffer = NewBuffer();
	this.altBuffer = NewBuffer();
	this.buffer = this.normalBuffer;
	
	this.writeBuffer = "";
	this.inVisualBell = false;

	// Matches an OSC sequence ESC]n;tX where n is a number, t is arbitrary text, and X is
	// the sequence terminator - either BEL (07) or ST (ESC\).
	this.exprOSC = /^\x1b\](\d*);((?:[^\x07\x1b]|\x1b[^\\])*)(?:\x07|\x1b\\)/;

	// Matches any general case of CSI (ESC[A...T) where A is an optional modifier and 
	// T is a terminating character or pair selecting the control mode.  Several more peculiar sequences
	// are unsupported here.
	// regexp   =  ESC   [(A)?    (...)?    (T)
	this.exprCSI = /^\x1b\[([?>!])?([0-9;]*)?([@A-Za-z`])/;

	this.UpdateDisplay();
}

// Writes a character sequence to the terminal buffer.
jsvt.Terminal.prototype.Write = function(msg) {
	msg = this.writeBuffer + msg;
	this.writeBuffer = "";

	for(var i = 0; i < msg.length; ++i) {
		var c = msg[i];
		switch(c) {
			case '\x1b': // ESC
				// String may be incomplete here.  Buffer until next Write.
				if(msg.length == i+1) {
					this.writeBuffer = msg[i];
					return;
				}
				switch(msg[i+1]) {
					// Only parse OSC and CSI sequences (ESC] and ESC[)
					case '[':
					case ']':
						var control = this.ParseControlSequence(msg.substr(i));
						// Sequence may yet be incomplete.  Buffer until next Write.
						if(control.retry == true) {
							this.writeBuffer = msg.substr(i);
							return;
						}
						i += control.length - 1;
						break;
					case 'D':
						var scrollBottom = this.buffer.useScrollRegion ? this.buffer.scrollBottom : this.rows-1;
						if(this.buffer.cursor.y == scrollBottom)
							this.ShiftLinesUp();
						else
							this.SetCursorRow(this.buffer.cursor.y + 1);
						++i;
						break;
					case 'M':
						var scrollTop = this.buffer.useScrollRegion ? this.buffer.scrollTop : 0;
						if(this.buffer.cursor.y == scrollTop)
							this.ShiftLinesDown();
						else
							this.SetCursorRow(this.buffer.cursor.y - 1);
						++i;
						break;
					case '(':
						i += 2;
						break;
					default:
						// Give up semi-gracefully
						this.WriteCharacter(c);
				}
				break;
			case '\x07': //BEL (ugly)
				this.inVisualBell = true;
				this.UpdateDisplay();
				var self = this;
				setTimeout(function() { self.inVisualBell = false; self.UpdateDisplay() }, 200);
				break;
			case '\x08': //BS (non-destructive)
				if(this.buffer.cursor.x > 0)
					this.SetCursorCol(this.buffer.cursor.x - 1);
				break;
			case '\x7f': //BS (destructive)
				if(this.buffer.cursor.x > 0) {
					this.buffer.lines[this.buffer.cursor.y].splice(this.buffer.cursor.x - 1, 1);
					this.SetCursorCol(this.buffer.cursor.x - 1);
				}
				break;
			case '\x0a': //LF
				var scrollBottom = this.buffer.useScrollRegion ? this.buffer.scrollBottom : this.rows-1;
				if(this.buffer.cursor.y == scrollBottom)
					this.ShiftLinesUp();
				else
					this.SetCursor(0, this.buffer.cursor.y + 1);
				break;
			case '\x0d': //CR
				this.SetCursorCol(0);
				break;
			default:
				this.WriteCharacter(c);
		}
	}

	this.UpdateDisplay();
}

jsvt.Terminal.prototype.SetCursorCol = function(c) {
	this.SetCursor(c, this.buffer.cursor.y);
}

jsvt.Terminal.prototype.SetCursorRow = function(r) {
	this.SetCursor(this.buffer.cursor.x, r);
}

jsvt.Terminal.prototype.SetCursor = function(c, r) {
	this.buffer.cursor.x = c;
	this.buffer.cursor.y = r;
}

jsvt.Terminal.prototype.ShiftLinesDown = function() {
	var scrollTop = this.buffer.useScrollRegion ? this.buffer.scrollTop : 0;
	var scrollBottom = this.buffer.useScrollRegion ? this.buffer.scrollBottom : this.rows-1;
	this.buffer.lines.splice(scrollBottom, 1);
	this.buffer.lines.splice(scrollTop, 0, []);
}

jsvt.Terminal.prototype.ShiftLinesUp = function() {
	var scrollTop = this.buffer.useScrollRegion ? this.buffer.scrollTop : 0;
	var scrollBottom = this.buffer.useScrollRegion ? this.buffer.scrollBottom : this.rows-1;
	this.buffer.scrollBuffer.push(this.buffer.lines[scrollTop]);
	this.buffer.lines.splice(scrollTop, 1);
	if(this.buffer.lines.length < this.rows)
		this.buffer.lines.splice(scrollBottom, 0, []);
}

// Writes a single character at the cursor in the current buffer.
// Advances the cursor accordingly.
jsvt.Terminal.prototype.WriteCharacter = function(c) {
	var line = this.buffer.lines[this.buffer.cursor.y];

	// lazily translate tab characters to 4 spaces; no tabstop aligment yet
	if(c == '\x09') {
		for(var i = 0; i < 4; ++i)
			this.WriteCharacter(' ');
		return;
	}

	var cell = {chr:c, attr:{}};
	for(var k in this.buffer.attr)
		cell.attr[k] = this.buffer.attr[k];

	line[this.buffer.cursor.x] = cell;
	if(this.buffer.cursor.x < this.cols-1)
		this.SetCursorCol(this.buffer.cursor.x + 1);
	else {
		var scrollBottom = this.buffer.useScrollRegion ? this.buffer.scrollBottom : this.rows-1;
		if(this.buffer.cursor.y == scrollBottom)
			this.ShiftLinesUp();
		else
			this.SetCursorRow(this.buffer.cursor.y + 1);
		this.SetCursorCol(0);
	}
}

jsvt.Terminal.prototype.UpdateDisplay = function() {
	var attr;
	for(var i = 0; i < this.rows; ++i) {
		var line = this.buffer.lines[i];
		for(var j = 0; j < this.cols; ++j) {
			var cell = line[j];
			var chr = " ";
			if(typeof(cell) != 'undefined') {
				var inverse = cell.attr.inverse ^ this.inVisualBell;
				var bold = cell.attr.bold || cell.attr.blink;
				var fgColor = jsvt.TerminalColors[(bold ? 8 : 0) +
					(inverse ? cell.attr.bgColor : cell.attr.fgColor)];
				var bgColor = jsvt.TerminalColors[(bold ? 8 : 0) +
					(inverse ? cell.attr.fgColor : cell.attr.bgColor)];
				attr = {background: bgColor, color: fgColor};
				chr = cell.chr;
			}
			else {
				attr = {
					background: jsvt.TerminalColors[this.inVisualBell ? 7 : 0]
				};
			}

			this.screen[i][j].css(attr).text(chr);
		}
	}

	var cur = this.buffer.cursor;
	this.screen[cur.y][cur.x].css({
		background: jsvt.TerminalColors[10],
		color: jsvt.TerminalColors[0]}
	);
}

// Set a handler to receive title change events that occur via the OSC sequence.
jsvt.Terminal.prototype.TitleChange = function(handler) {
	this.titleHandler = handler;
}

// Parse a CSI or OSC control sequence being written to the terminal
// Returns:
// {
// 		length 	// number of inupt bytes consumed
//  	retry   // optional boolean, if true the caller should wait until it has more data and resend
// }
jsvt.Terminal.prototype.ParseControlSequence = function(seq) {
	var result = this.exprOSC.exec(seq);
	if(result != null) {
		// Only support icon/window title changes here.  Silently ignore the rest.
		if(result[1] < 3) {
			this.title = result[2];
			this.titleHandler(result[2]);
		}
		return {length:result[0].length};
	}
	
	var result = this.exprCSI.exec(seq);	
	// We have an incomplete CSI sequence, so give up and tell the caller to try again when it has more data
	if(result == null)
		return {length:seq.length, retry:true};

	// Pull out regexp groups
	var match = result[0];
	var modifier = typeof(result[1]) == 'undefined' ? '' : result[1];
	var paramString = typeof(result[2]) == 'undefined' ? '' : result[2];
	var func = typeof(result[3]) == 'undefined' ? '' : result[3];
	var params = paramString.split(';');

	// Parse paramters into integer values; non-integer/empty parameters get -1.
	for(var i = 0; i < params.length; ++i) {
		params[i] = parseInt(params[i]);
		if(isNaN(params[i]))
			params[i] = -1;
	}

	switch(func) {
		case 'd': // VPA (vertical position absolute)
			var r = params[0] > 0 ? params[0] - 1 : 0;
			this.SetCursorRow(r);
			break;
		case 'm': // SGR (character attributes)
			for(var i = 0; i < params.length; ++i)
				this.ApplySGRAttribute(params[i]);
			break;
		case 'h': // DECSET (set option)
			for(var i = 0; i < params.length; ++i)
				this.ApplyDECSetting(params[i]);
			break;
		case 'l': // DECRST (reset option)
			for(var i = 0; i < params.length; ++i)
				this.ApplyDECReset(params[i]);
			break;
		case 'r': // STBM (set scrolling region)
			this.buffer.scrollTop = params[0] > 0 ? params[0] - 1 : 0;
			this.buffer.scrollBottom = params.length > 1 && params[1] > 0 ? params[1] - 1 : 0;
			this.buffer.useScrollRegion = true;
			break;
		case 'A': // CUU (cursor up n)
			var n = params[0] > 0 ? params[0] : 1;
			this.SetCursorRow(this.buffer.cursor.y - n);
			break;
		case 'B': // CUD (cursor down n)
			var n = params[0] > 0 ? params[0] : 1;
			this.SetCursorRow(this.buffer.cursor.y + n);
			break;
		case 'C': // CUF (cursor forward n)
			var n = params[0] > 0 ? params[0] : 1;
			this.SetCursorCol(this.buffer.cursor.x + n);
			break;
		case 'D': // CUB (cursor backward n)
			var n = params[0] > 0 ? params[0] : 1;
			this.SetCursorCol(this.buffer.cursor.x - n);
			break;
		case 'G': // CHA (cursor character absolute [column])
			var c = params[0] > 0 ? params[0] - 1 : 0;
			this.SetCursorCol(c);
			break;
		case 'H': // CUP (set cursor position)
			var y = params[0] > 0 ? params[0] - 1 : 0;
			var x = params.length > 1 && params[1] > 0 ? params[1] - 1 : 0;
			this.SetCursor(x, y);
			break;
		case 'J': // ED (erase display)
			var top = 0; var count = 0;
			var mode = params[0];
			switch(mode) {
				case 0: // erase below
					top = this.buffer.cursor.y;
					count = this.rows - top;
					break;
				case 1: // erase above
					top = 0;
					count = this.buffer.cursor.y + 1;
					break;
				case 2: // erase all
					top = 0;
					count = this.rows;
					break;
			}
			for(var i = top; i < top + count; ++i)
				this.buffer.lines[i] = [];
			break;
		case 'K': // EL (erase in line)
			var mode = 0;
			if(params.length > 0) mode = params[0];
			switch(mode) {
				case -1: case 0: // erase right
					var line = this.buffer.lines[this.buffer.cursor.y];
					if(typeof(line) != 'undefined')
						this.buffer.lines[this.buffer.cursor.y] = line.slice(0, this.buffer.cursor.x);
					break;
				case 1: // erase left
					var line = this.buffer.lines[this.buffer.cursor.y];
					for(var c = 0; c <= this.buffer.cursor.x; ++c)
						line[c] = {chr:" ", attr:{}};
					break;
				case 2: // erase all
					this.buffer.lines[this.buffer.cursor.y] = [];
					break;
			}
			break;
		case 'L': // IL (insert lines)
			var n = params[0] > 0 ? params[0] : 1;
			while(n--)
				this.buffer.lines.splice(this.buffer.cursor.y, 0, []);
			var scrollBottom = this.buffer.useScrollRegion ? this.buffer.scrollBottom : this.rows-1;
			if(this.buffer.lines.length > this.rows)
				this.buffer.lines.splice(scrollBottom + 1, this.buffer.lines.length - this.rows);
			break;
		case 'M': // DL (delete lines)
			var n = params[0] > 0 ? params[0] : 1;
			this.buffer.lines.splice(this.buffer.cursor.y, n);
			var scrollBottom = this.buffer.useScrollRegion ? this.buffer.scrollBottom : this.rows-1;
			while(n--)
				this.buffer.lines.splice(scrollBottom - n, 0, []);
			break;
		case 'S': // SU (scroll up)
			var n = params[0] > 0 ? params[0] : 1;
			while(n--)
				this.ShiftLinesUp();
			break;
		case 'T': // SD (scroll down)
			var n = params[0] > 0 ? params[0] : 1;
			while(n--)
				this.ShiftLinesDown();
			break;
		case '@': // ICH (insert blank characters)
			var n = params[0] > 0 ? params[0] : 1;
			if(this.buffer.lines[this.buffer.cursor.y].length > this.buffer.cursor.x)
				while(n--)
					this.buffer.lines[this.buffer.cursor.y].splice(this.buffer.cursor.x, 0, {chr:" ", attr:{}});
			break;
		case 'P': // DCH (delete characters)
			var n = params[0] > 0 ? params[0] : 1;
			this.buffer.lines[this.buffer.cursor.y].splice(this.buffer.cursor.x, n);
			break;
		case 'c':
			break;
		default:
			// Not implemented. carry on - with some debugging
			bytes = [];
			for(var i = 0; i < match.length; ++i)
				bytes.push(match.charCodeAt(i).toString(16));
			return {length: 1};
	}
	
	return {length: match.length};
}

// Apply a character attribute set as specified by the SGR sequence
jsvt.Terminal.prototype.ApplySGRAttribute = function(n)
{
	switch(n) {
		case -1: case 0:
			this.buffer.attr.fgColor = 7;
			this.buffer.attr.bgColor = 0;
			this.buffer.attr.bold = false;
			this.buffer.attr.underline = false;
			this.buffer.attr.blink = false;
			this.buffer.attr.inverse = false;
			break;
		case 1:
			this.buffer.attr.bold = true;
			break;
		case 4:
			this.buffer.attr.underline = true;
			break;
		case 5:
			this.buffer.attr.blink = true;
			break;
		case 7:
			this.buffer.attr.inverse = true;
			break;
		case 22:
			this.buffer.attr.bold = false;
			break;
		case 24:
			this.buffer.attr.underline = false;
			break;
		case 25:
			this.buffer.attr.blink = false;
			break;
		case 27:
			this.buffer.attr.inverse = false;
			break;
		case 30:
		case 31:
		case 32:
		case 33:
		case 34:
		case 35:
		case 36:
		case 37:
			this.buffer.attr.fgColor = n - 30;
			break;
		case 39:
			this.buffer.attr.fgColor = 7;
			break;
		case 40:
		case 41:
		case 42:
		case 43:
		case 44:
		case 45:
		case 46:
		case 47:
			this.buffer.attr.bgColor = n - 40;
			break;
		case 49:
			this.buffer.attr.bgColor = 0;
			break;
		default:
	}
}

jsvt.Terminal.prototype.ApplyDECSetting = function(n) {
	switch(n) {
		case 1:
			this.applicationKeyMode = true;
			break;
		case 12:
			break;
		case 25:
			this.showCursor = true;
			break;
		case 1047:
			this.buffer = this.altBuffer;
			break;
		case 1048:
			this.buffer.savedCursor.x = this.buffer.cursor.x;
			this.buffer.savedCursor.y = this.buffer.cursor.y;
			break;
		case 1049:
			this.buffer.savedCursor.x = this.buffer.cursor.x;
			this.buffer.savedCursor.y = this.buffer.cursor.y;
			for(var i = 0; i < this.altBuffer.lines.length; ++i)
				this.altBuffer.lines[i] = [];
			this.altBuffer.useScrollRegion = false;
			this.altBuffer.cursor = {x:0, y:0};
			this.altBuffer.attr.fgColor = 7;
			this.altBuffer.attr.bgColor = 0;
			this.buffer = this.altBuffer;
			break;
		default:
	}
}

jsvt.Terminal.prototype.ApplyDECReset = function(n) {
	switch(n) {
		case 1:
			this.applicationKeyMode = false;
			break;
		case 12:
			break;
		case 25:
			this.showCursor = false;
			break;
		case 1047:
			this.buffer = this.normalBuffer;
			break;
		case 1048:
			this.buffer.cursor.x = this.buffer.savedCursor.x;
			this.buffer.cursor.y = this.buffer.savedCursor.y;
			break;
		case 1049:
			this.buffer = this.normalBuffer;
			this.buffer.cursor.x = this.buffer.savedCursor.x;
			this.buffer.cursor.y = this.buffer.savedCursor.y;
			break;
		default:
	}
}

jsvt.Terminal.prototype.InputString = function(e) {
	if(e.ctrl && e.key >= 65 && e.key <= 90) {
		return String.fromCharCode(e.key - 64);
	}

	switch(e.key) {
		case $.Keys.Backspace:
			return "\x7f";
		case $.Keys.Tab:
			return "\x09";
		case $.Keys.Escape:
			return "\x1b";
		case $.Keys.PageUp:
			return "\x1b[5~";
		case $.Keys.PageDown:
			return "\x1b[6~";
		case $.Keys.End:
			return "\x1b[4~";
		case $.Keys.Home:
			return "\x1b[1~";
		case $.Keys.LeftArrow:
			if(this.applicationKeyMode)
				return "\x1bOD";
			return "\x1b[D";
		case $.Keys.UpArrow:
			if(this.applicationKeyMode)
				return "\x1bOA";
			return "\x1b[A";
		case $.Keys.RightArrow:
			if(this.applicationKeyMode)
				return "\x1bOC";
			return "\x1b[C";
		case $.Keys.DownArrow:
			if(this.applicationKeyMode)
				return "\x1bOB";
			return "\x1b[B";
		case $.Keys.Delete:
			return "\x1b[3~";
		case $.Keys.Enter:
			return "\x0d";
		case $.Keys.Space:
			return " ";
	}

	return e.chr;
}

