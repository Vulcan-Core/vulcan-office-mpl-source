/* -*- js-indent-level: 8; fill-column: 100 -*- */
/*
 * Copyright the Collabora Online contributors.
 *
 * SPDX-License-Identifier: MPL-2.0
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
/*
 * window.L.A11yTextInput is the hidden textarea, which handles text input events
 *
 * This is made significantly more difficult than expected by such a
 * mess of browser, and mobile IME quirks that it is not possible to
 * follow events, but we have to re-construct input from a browser
 * text area itself.
 */

/* global app _ VulcanImpressTextDock */

window.L.A11yTextInput = window.L.TextInput.extend({
	initialize: function() {
		window.L.TextInput.prototype.initialize.call(this);

		this._className = 'A11yTextInput';

		// Used for signaling when in a mobile device the user tapped the edit button
		this._justSwitchedToEditMode = false;

		// Used when editing a shape text content.
		this._isEditingInSelection = false;
		this._hasAnySelection = false;


		// In core text selection exists even if it's empty and <backspace> deletes the empty selection
		// instead of the previous character.
		this._hasSelection = false;
		this._lastCursorPosition = 0;
		this._lastSelectionStart = 0;
		this._lastSelectionEnd = 0;
		this._listPrefixLength = 0;
		this._isLeftRightArrow = 0;
	},

	hasAccessibilitySupport: function() {
		return true;
	},

	setHTML: function(content) {
		this._textArea.innerHTML = this._wrapContent(content);
	},

	_prependSpace: function() {
		this._textArea.innerHTML = this._preSpaceChar + this._textArea.innerHTML;
	},

	_appendSpace: function() {
		this._textArea.innerHTML = this._textArea.innerHTML + this._postSpaceChar;
	},

	_getLastCursorPosition: function() {
		return this._lastCursorPosition;
	},

	_setLastCursorPosition: function(nPos) {
		this._lastCursorPosition = nPos;
		this._lastSelectionStart = this._lastSelectionEnd = nPos;
	},

	_setLastSelection: function(nStart, nEnd) {
		this._lastSelectionStart = nStart;
		this._lastSelectionEnd = this._lastCursorPosition = nEnd;
	},

	_isLastSelectionEmpty: function() {
		return this._lastSelectionStart === this._lastSelectionEnd;
	},

	_isLastSelection: function(start, end) {
		return this._hasSelection &&  this._lastSelectionStart === start && this._lastSelectionEnd === end;
	},

	_updateCursorPosition: function(pos) {
		if (typeof pos !== 'number')
			return;
		// Normalize input parameters
		var l = this.getPlainTextContent().length;
		if (pos < 0)
			pos = 0;
		if (pos > l)
			pos = l;

		this._setLastCursorPosition(pos);
		this._setCursorPosition(pos);
	} ,

	_updateSelection: function(pos, start, end, forced) {
		window.app.console.log('_updateSelection: pos: ' + pos + ', start: ' + start + ', end: ' + end);
		if (typeof pos !== 'number' || typeof start !== 'number' || typeof end !== 'number')
			return;

		var hasSelection= !(start === -1 && end === -1);
		if (!hasSelection) {
			this._updateCursorPosition(pos);
		} else if (forced || !this._isLastSelection(start, end)) {
			if (forced || start !== end || !this._hasSelection || !this._isLastSelectionEmpty()) {
				// When the new selection is empty (start == end). the cursor position is updated
				// only if there was no previous selection, or previous selection was not empty.
				// In fact when both old and new selection are empty, it means that the old selection
				// has been moved to a new position by some typing. Anyway changing cursor position
				// while typing can mess up editable area content.
				this._setLastSelection(start, end);
				this._setSelectionRange(start, end);
			}
		}
		this._setSelectionFlag(hasSelection);
	},

	_setSelectionFlag: function(flag) {
		this._hasSelection = flag;
		if (window.L.Browser.cypressTest)
			this._textArea.isSelectionNull = !flag;
	},

	// R6-1: the phone Impress long-text dock mirrors the focused paragraph
	// this class already receives — same stream, one more sink. The dock
	// gates itself (phone chrome, presentation/drawing, editable), so every
	// entry point below forwards unconditionally. A dock fault must never
	// break typing: the notify is fenced.
	//
	// VulcanImpressTextDock.sink is the BUNDLE-SCOPE class binding (the
	// Permission.js -> VulcanImpressTextEntry precedent), not a window
	// property. Build #9 shipped this method reading a dock property off
	// window that nothing in the served bundle ever assigned — the dock's
	// file was missing from COOL_JS_LST and the
	// null-guard read the build defect as a feature toggle, silently. The
	// bare binding lives inside the fence, so if the dock ever leaves the
	// bundle again the ReferenceError lands in the warn below on every
	// a11y event (typing survives, the console does not stay quiet), and
	// the fork-gates BUNDLE layer goes red before an image is even built.
	_vulcanDockNotify: function(method, a, b, c, d) {
		try {
			var dock = VulcanImpressTextDock.sink;
			if (!dock || typeof dock[method] !== 'function')
				return;
			dock[method](this, a, b, c, d);
		} catch (err) {
			window.app.console.warn('long-text dock ' + method + ' failed: ' + err);
		}
	},

	_setFocusedParagraph: function(content, pos, start, end) {
		window.app.console.log('_setFocusedParagraph:'
			+ '\n    content "' + content + '"'
			+ '\n    pos: ' + pos
			+ '\n    start: ' + start + ', end: ' + end);

		this._isComposing = false;
		this._isLeftRightArrow = 0;
		if (!this._hasFormulaBarFocus()) {
			this.setHTML(content);
			this.updateLastContent();
			this._updateSelection(pos, start, end, true);
			// The paragraph just applied carries content, caret and selection,
			// and every park came from an earlier message on the same ordered
			// socket. Left in place, the park is replayed over this paragraph at
			// the next beforeinput (A:402): measured on the Android Impress title
			// double tap, it wiped "[Program Name]" mid-keystroke and every
			// letter was dropped. Client state only; nothing is sent.
			this._dropParkedParagraph();
		}
	},

	_dropParkedParagraph: function() {
		this._remoteContent = undefined;
		this._remotePosition = undefined;
		this._remoteSelectionStart = undefined;
		this._remoteSelectionEnd = undefined;
	},

	// A caret or selection applied directly is newer than any parked caret or
	// selection, which would otherwise be replayed over it at the next
	// beforeinput (a parked caret of 2 under a live caret of 11 turns one 'x'
	// into "delete 9 after, type 'xllo world'"). A parked paragraph is older
	// than this update too, but its CONTENT is still the latest the editable
	// has been told, so it is applied first and this update lands on top.
	// So is a parked caret with no parked selection, or with only a parked
	// selection clear: a clear (-1, -1) carries no caret and falls back to
	// the last one applied, so dropping the park would leave the editable's
	// caret behind core's.
	_flushParkedParagraph: function() {
		if (this._remoteContent !== undefined)
			this._updateFocusedParagraph();
		else {
			if ((this._remoteSelectionEnd === undefined || (this._remoteSelectionStart === -1 && this._remoteSelectionEnd === -1)) && this._remotePosition !== undefined)
				this._updateCursorPosition(this._remotePosition);
			// The dropped park set _hasSelection; left set, the next backspace
			// sends a fake Delete first. Only a NON-EMPTY parked selection: an
			// empty one is core's own empty-selection state, which keeps it.
			else if (this._remoteSelectionEnd !== undefined && this._remoteSelectionStart !== this._remoteSelectionEnd)
				this._setSelectionFlag(false);
			this._dropParkedParagraph();
		}
	},

	_updateFocusedParagraph: function() {
		this._log('_updateFocusedParagraph');
		if (this._remoteContent !== undefined) {
			this._setFocusedParagraph(this._remoteContent, this._remotePosition,
				this._remoteSelectionStart, this._remoteSelectionEnd);
		} else if (this._remoteSelectionEnd !== undefined) {
			this._updateSelection(this._remotePosition, this._remoteSelectionStart, this._remoteSelectionEnd);
		} else if (this._remotePosition !== undefined) {
			this._updateCursorPosition(this._remotePosition);
		}
		this._remoteContent = undefined;
		this._remotePosition = undefined;
		this._remoteSelectionStart = undefined;
		this._remoteSelectionEnd = undefined;
	},

	onAccessibilityFocusChanged: function(content, pos, start, end, listPrefixLength, force) {
		this._vulcanDockNotify('onFocusedParagraph', content, pos, start, end);
		this._listPrefixLength = listPrefixLength;
		if (!this.hasFocus() || (this._isComposing && !force)) {
			this._log('onAccessibilityFocusChanged: skipped updating: '
				+ '\n  hasFocus: ' + this.hasFocus()
				+ '\n  _isComposing: ' + this._isComposing
				+ '\n  force: ' + force);
			this._remoteContent = content;
			this._remotePosition = pos;
			this._remoteSelectionStart = start;
			this._remoteSelectionEnd = end;
		} else {
			this._setFocusedParagraph(content, pos, start, end);
		}
	},

	setA11yFocusedParagraph: function(content, pos, start, end) {
		this._vulcanDockNotify('onFocusedParagraph', content, pos, start, end);
		// The reply to geta11yfocusedparagraph is not held back the way
		// onAccessibilityFocusChanged is: _setFocusedParagraph would rewrite
		// the element and end the composition, so a reply landing in the
		// middle of a Gboard word wipes it. Park it instead; compositionend
		// (_updateFocusedParagraph) applies it. _abortComposition clears
		// _isComposing before it requests, so its own reply is never parked.
		if (this._isComposing) {
			this._remoteContent = content;
			this._remotePosition = pos;
			this._remoteSelectionStart = start;
			this._remoteSelectionEnd = end;
			return;
		}
		this._setFocusedParagraph(content, pos, start, end);
	},

	onAccessibilityCaretChanged: function(nPos) {
		this._vulcanDockNotify('onCaretChanged', nPos);
		this._log('onAccessibilityCaretChanged: \n' +
			'    position: ' + nPos + '\n' +
			'    _isComposing: ' + this._isComposing);
		if (this._isLeftRightArrow || !this.hasFocus() || this._isComposing) {
			this._log('onAccessibilityCaretChanged: skip updating');
			this._remotePosition = nPos;
		}
		else if (!this._hasFormulaBarFocus()) {
			this._flushParkedParagraph();
			this._updateCursorPosition(nPos);
		}
	},

	setA11yCaretPosition: function(nPos) {
		if (this._isLastSelectionEmpty()) {
			this.onAccessibilityCaretChanged(nPos);
		}
	},

	onAccessibilityTextSelectionChanged: function(start, end) {
		this._vulcanDockNotify('onSelectionChanged', start, end);
		if (this._isLeftRightArrow || !this.hasFocus() || this._isComposing) {
			this._remoteSelectionStart = start;
			this._remoteSelectionEnd = end;
			var hasSelection = !(start === -1 && end === -1);
			this._setSelectionFlag(hasSelection);
			if (hasSelection) {
				this._remotePosition = end;
			}
			this._statusLog('onAccessibilityTextSelectionChanged: skip updating');
		} else {
			this._flushParkedParagraph();
			this._updateSelection(this._lastCursorPosition, start, end);
		}
	},

	A11Y_FOCUS_ANNOUNCEMENT_MS: 500,

	_setDescription: function(text) {
		this._log('setDescription: ' + text);
		this._textArea.setAttribute('aria-description', text);

		if (window.L.Browser.mac) {
			// avoid duplicate cell announcement in Chrome
			var sinceFocus = Date.now() - (this._a11yFocusTime || 0);
			if (text && sinceFocus < this.A11Y_FOCUS_ANNOUNCEMENT_MS)
				return;
		}

		if (window.L.Browser.mac || window.vulcanPhoneChrome) {
			// VoiceOver is not triggered by description changes alone. Forced
			// phone accessibility uses the same real sink for Android/TalkBack.
			var region = this._a11yLiveRegion;
			if (region) {
				region.textContent = '';
				var t = text;
				requestAnimationFrame(function () { region.textContent = t; });
			}
		}
	},

	_updateTable: function(outCount, inList, row, col, rowSpan, colSpan) {
		this._log('_updateTable: '
			+ '\n outCount: ' + outCount
			+ '\n inList: ' + inList.toString()
			+ '\n row: ' + row + ', rowSpan: ' + rowSpan
			+ '\n col: ' + col + ', colSpan: ' + colSpan
		);

		if (this._timeoutForA11yDescription)
			clearTimeout(this._timeoutForA11yDescription);

		var eventDescription = '';
		if (outCount > 0 || inList.length > 0) {
			this._lastRowIndex = 0;
			this._lastColIndex = 0;
			this._lastRowSpan = 1;
			this._lastColSpan = 1;
		}
		for (var i = 0; i < outCount; i++) {
			eventDescription += _('Out of table') + '. ';
		}
		for (i = 0; i < inList.length; i++) {
			eventDescription += _('Table with {0} rows and {1} columns').replace('{0}', inList[i].rowCount).replace('{1}', inList[i].colCount) + '. ';
		}
		if (this._lastRowIndex !== row || this._lastRowSpan !== rowSpan) {
			this._lastRowIndex = row;
			if (this._lastRowSpan !== rowSpan && rowSpan > 1) {
				eventDescription += _('Row {0} through {1}').replace('{0}', row).replace('{1}', row + rowSpan - 1);
			}
			else {
				eventDescription += _('Row {0}').replace('{0}', row);
			}
			eventDescription += '. ';
			this._lastRowSpan = rowSpan;
		}
		if (this._lastColIndex !== col || this._lastColSpan !== colSpan) {
			this._lastColIndex = col;
			if (this._lastColSpan !== colSpan && colSpan > 1) {
				eventDescription += _('Column {0} through {1}').replace('{0}', col).replace('{1}', col + colSpan - 1);
			}
			else {
				eventDescription += _('Column {0}').replace('{0}', col);
			}
			eventDescription += '. ';
			this._lastColSpan = colSpan;
		}
		this._setDescription(eventDescription);

		var that = this;
		this._timeoutForA11yDescription = setTimeout(function() {
			that._setDescription('');
		}, 1000);
	},

	onAccessibilityFocusedCellChanged: function(outCount, inList, row, col, rowSpan, colSpan, paragraph) {
		this._setFocusedParagraph(paragraph.content, parseInt(paragraph.position), parseInt(paragraph.start), parseInt(paragraph.end));
		this._updateTable(outCount, inList, row + 1, col + 1, rowSpan, colSpan);
	},

	onAccessibilityEditingInSelectionState: function(cell, enabled, selectionDescr, paragraph) {
		this._log('onAccessibilityEditingInSelectionState: cell: ' + cell + ', enabled: ' + enabled);
		if (!cell) {
			this._isEditingInSelection = enabled;
		}
		if (enabled) {
			clearTimeout(this._timeoutForA11yDescription);
			var eventDescription = '';
			if (typeof selectionDescr === 'string' && selectionDescr.length > 0)
				eventDescription += selectionDescr + '. ';
			eventDescription += _('Editing activated. ');
			if (typeof paragraph === 'string' && paragraph.length > 0)
				eventDescription += paragraph;
			this._setDescription(eventDescription);
			this._timeoutForA11yDescription = setTimeout(function () {
				this._setDescription('');
			}.bind(this), 1000);
		}
	},

	onAccessibilitySelectionChanged: function(cell, action, name, textContent) {
		this._vulcanDockNotify('onShapeSelectionChanged');
		this._log('onAccessibilitySelectionChanged: cell: ' + cell + ', action: ' + action + ', name: ' + name);
		if (this._timeoutForA11yDescription)
			clearTimeout(this._timeoutForA11yDescription);
		if (!this._isFormula())
			this._emptyArea();
		var eventDescription = '';
		if (action === 'create' || action === 'add') {
			this._hasAnySelection = true;
			eventDescription =  _('{0} selected').replace('{0}', name) + '. ';
			if (typeof textContent === 'string' && textContent.length > 0) {
				eventDescription += (cell ? '' : _('Has text: ')) + textContent;
			}
		}
		else if (action === 'remove') {
			this._hasAnySelection = false;
			eventDescription = _('{0} unselected').replace('{0}', name);
		}
		else if (action === 'delete') {
			this._hasAnySelection = false;
			eventDescription = _('{0} deleted').replace('{0}', name);
		}
		this._setDescription(eventDescription);
		if (action !== 'create' && action !== 'add') {
			this._timeoutForA11yDescription = setTimeout(function () {
				this._setDescription('');
			}.bind(this), 1000);
		}
	},

	// Check if a UTF-16 pair represents a Unicode code point
	_isSurrogatePair: function(hi, lo) {
		return 	hi >= 0xd800 && hi <= 0xdbff && lo >= 0xdc00 && lo <= 0xdfff;
	},

	// Backspaces and deletes at the beginning / end are filtered out, so
	// we get a beforeinput, but no input for them. Sometimes we can end up
	// in a state where we lost our leading / terminal chars and can't recover
	_onBeforeInput: function(ev) {
		if (this._map.uiManager.isUIBlocked())
			return;
		this._statusLog('_onBeforeInput [');
		this._ignoreNextBackspace = false;
		if (!this._isSelectionValid()) {
			this._setCursorPosition(this._getLastCursorPosition());
		}
		else if (this._isCursorAtBeginning()) {
			this._handleMisplacedCursorAtBeginning(ev);
		}
		else if (!this._isLastSelectionEmpty() && !this._hasFormulaBarFocus() && this._isFormula()) {
			// A cell address is selected in formula input mode,
			// before inserting a new input we need to clear selection
			this._updateCursorPosition(this._lastSelectionEnd);
		}

		if (!this._isComposing && !this._isLeftRightArrow && this._remotePosition !== undefined) {
			this._updateFocusedParagraph();
		}

		// Firefox is not able to delete the <img> post space. Since no 'input' event is generated,
		// we need to handle a <delete> at the end of the paragraph, here.
		if (window.L.Browser.gecko && (!this._hasSelection || this._isLastSelectionEmpty()) &&
			this._getLastCursorPosition() === this.getPlainTextContent().length &&
			this._deleteHint === 'delete') {
			if (this._map._debug.logKeyboardEvents) {
				window.app.console.log('Sending delete');
			}
			this._removeEmptySelectionIfAny();
			this._removeTextContent(0, 1);
		}
		// Last: the repairs above can rewrite this element, and the snapshot
		// taken here has to be the text the browser is about to mutate.
		// TextInput._captureReplacementRange owns the reasoning.
		this._captureReplacementRange(ev);
		this._statusLog('_onBeforeInput ]');
	},

	updateLastContent: function() {
		var value = this.getValue();
		this._lastContent = this.getValueAsCodePoints(value);
	},

	_isFormula: function() {
		var content = this.getValue();
		return this._map._docLoaded && this._map.getDocType() === 'spreadsheet'
			&& content.length > 0 && content[0] === '=';
	},

	_requestFocusedParagraph: function() {
		app.socket.sendMessage('geta11yfocusedparagraph');
	},

	_restoreSpanWrapper: function() {
		var children = this._textArea.childNodes;
		if (children.length >= 3 && children[1].nodeName === '#text') {
			if (children.length === 3) {
				// When typing in an empty paragraph, we get <img>H<img>
				var htmlContent = this.getHTML();
				htmlContent = htmlContent.slice(this._preSpaceChar.length, -this._postSpaceChar.length);
				this.setHTML(htmlContent);
			}
			else if (children.length === 4 && children[2].id === 'readable-content') {
				// When typing, let's say 'k', at beginning of a not empty paragraph,
				// we get: <img>k<span>Hello World</span><img>
				var newText = children[1].textContent;
				children[2].innerHTML = newText + children[2].innerHTML;
				this._textArea.removeChild(children[1]);
			}
		}
	},

	// Fired when text has been inputted, *during* and after composing/spellchecking
	_onInput: function(ev) {
		if (this._map.uiManager.isUIBlocked())
			return;
		this._statusLog('_onInput [');
		app.idleHandler.notifyActive();

		if (this._ignoreInputCount > 0) {
			window.app.console.log('ignoring synthetic input ' + this._ignoreInputCount);
			return;
		}

		// Real input after a commit-Return starts the next entry (as in
		// TextInput._onInput, which this override replaces on the phone), so
		// the commit is no longer what core's next same-cell answer means.
		if (window.VulcanCalcReturnKey)
			window.VulcanCalcReturnKey.noteTyping();

		// A phone autocorrect rewrite arrives as insertReplacementText over a
		// range the differ below cannot see. Handled from the range captured
		// in _onBeforeInput, and handled here -- before _newlineHint, which
		// would otherwise swallow the correction that commits on <enter>.
		// This is the live phone path: Map.initTextInput builds an
		// A11yTextInput for every phone-chrome text/Calc/Impress session.
		if (this._applyReplacementRange(ev)) {
			this._statusLog('_onInput ]');
			return;
		}

		if (this._deleteHint === '' && ev.inputType) {
			if (ev.inputType === 'deleteContentForward')
				this._deleteHint = 'delete';
			else if (ev.inputType === 'deleteContentBackward')
				this._deleteHint = 'backspace';
		}

		var ignoreBackspace = this._ignoreNextBackspace;
		this._ignoreNextBackspace = false;

		if (this._newlineHint) {
			this._sendNewlineEvent();
			return;
		}

		// We use a different leading and terminal space character
		// to differentiate backspace from delete, then replace the character.
		if (!this._hasPreSpace()) { // missing initial space
			if (this._map._debug.logKeyboardEvents) {
				window.app.console.log('Sending backspace');
			}
			if (!ignoreBackspace) {
				this._removeEmptySelectionIfAny();
				this._removeTextContent(1, 0);
			}
			// Lately we receive the new paragraph == above paragraph + current paragraph,
			// except current paragraph is the first one.
			// In this last case we need to restore the pre space.
			this._prependSpace();
			this._updateCursorPosition(0);
			return;
		}
		if (!this._hasPostSpace()) { // missing trailing space.
			if (this._map._debug.logKeyboardEvents) {
				window.app.console.log('Sending delete');
			}
			this._removeTextContent(0, this._hasSelection && this._isLastSelectionEmpty() ? 2 : 1);
			this._appendSpace();
			var pos = this._getLastCursorPosition();
			this._updateCursorPosition(pos);
			return;
		}

		// We assume that what is on the right of the new cursor position has not been modified
		// We also assume that lastCursorPosition is synchronized with the cursor position in core
		var cursorPosition = this._getSelectionEnd();
		var lastCursorPosition = this._getLastCursorPosition();
		var value = this.getValue();

		// Without both carets the differ below computes NaN windows, finds "no
		// new content" and returns without a word: measured on Android with the
		// browser's caret on the element (_getSelection -> undefined), 5 of 5
		// letters lost. Never drop a key silently.
		if (!this._isFiniteOffset(cursorPosition) || !this._isFiniteOffset(lastCursorPosition)) {
			this._onInputWithUnknownCaret(ev, value);
			this._statusLog('_onInput ]');
			return;
		}

		// In the android keyboard when you try to erase the pre-space
		// and then enter some character,
		// The first character will likely travel with the cursor,
		// And that is caused because after entering the first character
		// cursor position is never updated by keyboard (I know it is strange)
		// so here we manually correct the position
		if (lastCursorPosition === 0 && cursorPosition < 1 && value.length - this._lastContent.length === 1) {
			cursorPosition = 1;
			if (!this._isComposing)
				this._setCursorPosition(1);
		}

		// We need to take into account the case that lastCursorPosition is beyond the new cursor position.
		// For instance that can happen when after entering a word, several spaces are typed:
		// a '.' is appended automatically.
		var contentTailLength = value.length - cursorPosition;
		var lastContentTailLength = this._lastContent.length - lastCursorPosition;
		var guessedBackMatchTo = Math.min(lastContentTailLength, contentTailLength);
		var contentEnd = value.length - guessedBackMatchTo;
		var content = this.getValueAsCodePoints(value.slice(0, contentEnd));
		// Note that content is an array of Unicode code points
		var lastContentEnd = this._lastContent.length - guessedBackMatchTo;
		var lastContent = this._lastContent.slice(0, lastContentEnd);

		window.app.console.log('_onInput: cursorPosition: ' + cursorPosition + ', lastContentEnd: ' + lastContentEnd);

		var matchTo = 0;
		var compareUpTo = Math.min(content.length, lastContent.length);
		if (!this._isLastSelectionEmpty()) {
			// Selected text has always to be removed, so there is no need for comparing old and new content
			// over selection start. Moreover, if selection content starts with the typed key, it would lead to
			// an empty new content and the input would never be forwarded to core.
			compareUpTo = Math.min(compareUpTo, this._lastSelectionStart);
		}
		while (matchTo < compareUpTo && content[matchTo] === lastContent[matchTo])
			matchTo++;

		if (this._map._debug.logKeyboardEvents) {
			window.app.console.log('Comparison matchAt ' + matchTo + '\n' +
				'\tnew "' + this.codePointsToString(content) + '" (' + content.length + ')' + '\n' +
				'\told "' + this.codePointsToString(lastContent) + '" (' + lastContent.length + ')');
		}

		// no new content
		if (matchTo === content.length && matchTo === lastContent.length)
			return;

		// matchTo <= lastCursorPosition <= lastContent.length
		matchTo = Math.min(matchTo, lastCursorPosition);

		var removeAfter = 0;
		var removeBefore = 0;
		if (!this._hasSelection) {
			removeAfter = lastContent.length - lastCursorPosition;
			removeBefore = (lastContent.length - matchTo) - removeAfter;
		}
		else if (this._deleteHint === 'backspace') {
			this._removeEmptySelectionIfAny();
			this._setSelectionFlag(false);
			removeBefore = 1;
		}
		else if (this._deleteHint === 'delete') {
			// when in core there is an empty selection the first <delete> deletes
			// the selection instead of the next char
			this._setSelectionFlag(false);
			removeAfter = this._isLastSelectionEmpty() ? 2 : 1;
		}

		// A browser selection range counts a surrogate UTF-16 pair as 2 chars.
		// The same occurs in core for the text cursor position reported by the caret changed accessibility event.
		// However, in core a single <backspace> or <delete> is needed for deleting a surrogate pair.
        if (removeBefore > 1) {
			var start = lastCursorPosition - removeBefore;
			for (var i = start; i < lastCursorPosition; i++) {
				if (this._isSurrogatePair(lastContent[i], lastContent[i+1])) {
					removeBefore--;
					i++;
				}
			}
		}
		if (removeAfter > 1) {
			var end = lastCursorPosition + removeAfter;
			for (var j = lastCursorPosition; j < end; j++) {
				if (this._isSurrogatePair(lastContent[j], lastContent[j+1])) {
					removeAfter--;
					j++;
				}
			}
		}

		if (removeBefore > 0 || removeAfter > 0)
			this._removeTextContent(removeBefore, removeAfter);

		var newText = content;
		if (matchTo > 0)
			newText = newText.slice(matchTo);

		var head = this._lastContent.slice(0, matchTo);
		var tail = this._lastContent.slice(lastContentEnd);
		this._lastContent = head.concat(newText, tail);
		window.app.console.log('_onInput: \n'
			+ 'head: "' + this.codePointsToString(head) + '"\n'
			+ 'newText: "' + this.codePointsToString(newText) + '"\n'
			+ 'tail: "' + this.codePointsToString(tail) + '"');

		this._setLastCursorPosition(cursorPosition);

		if (newText.length > 0) {
			if (!this._isComposing && !this._isWrappedBySpan()) {
				this._restoreSpanWrapper();
				this._setCursorPosition(cursorPosition);
			}
			this._sendNewText(ev, content, newText);
		}

		// special handling for formula bar
		this._finishFormulabarEditing(content, matchTo);

		// special handling for mentions
		if (this._map.getDocType() === 'text')
			this._map.mention.handleMentionInput(ev);

		this._statusLog('_onInput ]');
	},

	_isFiniteOffset: function(n) {
		return typeof n === 'number' && isFinite(n);
	},

	// The editable changed, but the caret (or core's caret) cannot be read,
	// so "what is right of the caret is unchanged" cannot be assumed. Only an
	// edit that is a pure insertion can be forwarded without it: 'textinput'
	// carries no position, so core inserts at its own caret, and this path
	// never sends a removal, so it cannot delete. It sends only the characters
	// missing from _lastContent and folds them in, so it cannot duplicate
	// either. Core echoes the paragraph after every textinput, which resyncs
	// the element; no request is sent here, because the reply to one is not
	// held back and would wipe the next Gboard word. Anything else (a
	// backspace, typing over a selection, a correction away from the caret) is
	// refused, and that key is lost: this says so, and asks core for the
	// paragraph to resync.
	_onInputWithUnknownCaret: function(ev, value) {
		var old = this.codePointsToString(this._lastContent);
		if (value === old)
			return; // nothing new: the genuine case of the "no new content" return
		if (this._isComposing) {
			// compositionend runs _onInput again with composing off.
			window.app.console.warn('A11yTextInput: caret unknown while composing: waiting for compositionend');
			return;
		}
		// Core holds a selection, and the browser replaced it with what was
		// typed: "the" -> "there" diffs as "re" inserted, and core types that
		// over its whole selection ("a the b" -> "a re b"). Refused.
		if (this._hasSelection && !this._isLastSelectionEmpty()) {
			this._loseUnknownCaretKey('core holds a selection');
			return;
		}
		var corePos = this._getLastCursorPosition();
		var span = null;
		var why;
		if (this._isFiniteOffset(corePos)) {
			// Core's caret is known and textinput lands there, so only an edit
			// that is exactly an insertion at it goes through. A leftmost diff
			// reads "wow" typed before "world" as "wwo", and a skin tone added
			// to a thumbs-up as the tone plus a second thumbs-up.
			span = this._insertedSpanAt(old, value, corePos);
			why = 'the edit is not an insertion at core\'s caret';
		} else if (ev && ev.inputType === 'insertReplacementText') {
			// A correction rewrites a range away from the caret ("dont" ->
			// "don't" inserts at 5 with the caret at 6); without core's caret
			// there is no telling where textinput would put it.
			why = 'a correction cannot be placed without core\'s caret';
		} else {
			span = this._insertedSpan(old, value);
			why = 'the edit is not a pure insertion';
		}
		if (!span) {
			this._loseUnknownCaretKey(why);
			return;
		}
		window.app.console.warn('A11yTextInput: caret unknown: insert-only resync');
		var inserted = this.getValueAsCodePoints(value.slice(span.start, span.end));
		this._lastContent = this.getValueAsCodePoints(value);
		this._setLastCursorPosition(span.end);
		this._sendNewText(ev, this._lastContent, inserted);
		if (!this._isWrappedBySpan())
			this._restoreSpanWrapper();
		this._setCursorPosition(span.end);
		// The follow-ups the normal path runs after a send: a newline typed in
		// the formula bar accepts the formula, and an '@' opens the mention list.
		this._finishFormulabarEditing(this._lastContent, span.start);
		if (this._map.getDocType() === 'text')
			this._map.mention.handleMentionInput(ev);
	},

	// Says the key is lost and asks core for the paragraph to resync.
	_loseUnknownCaretKey: function(why) {
		window.app.console.warn('A11yTextInput: caret unknown and ' + why + ': ' +
			'this key is lost; asking core for the paragraph');
		this._requestFocusedParagraph();
	},

	// [L, L + k) when `value` is `old` with exactly k units inserted at core's
	// caret L, so core typing them at its caret reads `value`; else null.
	_insertedSpanAt: function(old, value, L) {
		var k = value.length - old.length;
		if (k <= 0 || L < 0 || L > old.length)
			return null;
		if (value.slice(0, L) !== old.slice(0, L) || value.slice(L + k) !== old.slice(L))
			return null;
		return { start: L, end: L + k };
	},

	// With core's caret unknown: [start, end) of what a pure insertion into
	// `old` added to `value` (leftmost), in UTF-16 units, or null when the
	// change is anything else. Never splits a surrogate pair: U+1F603 typed in
	// front of U+1F600 shares its high surrogate with it, and a naive common
	// prefix would send two lone halves.
	_insertedSpan: function(old, value) {
		if (value.length <= old.length)
			return null;
		var p = 0;
		while (p < old.length && old.charCodeAt(p) === value.charCodeAt(p))
			p++;
		if (p > 0 && this._isHighSurrogate(value.charCodeAt(p - 1)))
			p--;
		var s = 0;
		var maxSuffix = old.length - p;
		while (s < maxSuffix &&
			old.charCodeAt(old.length - 1 - s) === value.charCodeAt(value.length - 1 - s))
			s++;
		if (s > 0 && this._isLowSurrogate(value.charCodeAt(value.length - s)))
			s--;
		if (p + s !== old.length)
			return null;
		// Core types at a caret this path cannot see, and the insertion may
		// sit at any start from the rightmost (where the full common suffix
		// begins) to the leftmost: "wow" typed before "world" reads "wwo"
		// leftmost and "wow" rightmost. Refuse unless every start that is a
		// caret position (not inside a surrogate pair) inserts the same text.
		var k = value.length - old.length;
		var q = 0;
		while (q < old.length &&
			old.charCodeAt(old.length - 1 - q) === value.charCodeAt(value.length - 1 - q))
			q++;
		var inserted = value.slice(p, p + k);
		for (var i = old.length - q; i < p; i++) {
			if (i > 0 && this._isHighSurrogate(old.charCodeAt(i - 1)) && this._isLowSurrogate(old.charCodeAt(i)))
				continue;
			if (value.slice(i, i + k) !== inserted)
				return null;
		}
		return { start: p, end: value.length - s };
	},

	_isHighSurrogate: function(code) {
		return code >= 0xd800 && code <= 0xdbff;
	},

	_isLowSurrogate: function(code) {
		return code >= 0xdc00 && code <= 0xdfff;
	},

	_removeEmptySelectionIfAny: function() {
		if (this._hasSelection && this._isLastSelectionEmpty()) {
			// when in core there is an empty selection a <backspace> or a <delete> removes
			// the selection instead of the previous or next char, so we send a fake <delete>
			// in order to remove the empty selection.
			this._sendDelete();
		}
	},

	_sendDelete: function() {
		this._sendKeyEvent(46, 1286, 'input');
	},

	_hasPreSpace: function() {
		var child = this._textArea.firstChild;
		while (child && child.tagName !== 'img') {
			if (child.id === 'pre-space')
				return true;
			child = child.firstChild;
		}
		return false;
	},

	_hasPostSpace: function() {
		var child = this._textArea.lastChild;
		while (child) {
			if (child.id === 'post-space')
				return true;
			child = child.lastChild;
		}
		return false;
	},

	_isWrappedBySpan: function() {
		var children = this._textArea.childNodes;
		return children.length === 3 && children[1].nodeName === 'SPAN';
	}
});

L.a11yTextInput = function() {
	return new window.L.A11yTextInput();
};
