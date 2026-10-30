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
 * window.L.TextInput is the hidden textarea, which handles text input events
 *
 * This is made significantly more difficult than expected by such a
 * mess of browser, and mobile IME quirks that it is not possible to
 * follow events, but we have to re-construct input from a browser
 * text area itself.
 */

/* global app _ CursorHandler cool TextSelections */

window.L.TextInput = window.L.Layer.extend({
	initialize: function() {

		window.L.Layer.prototype.initialize.call(this);

		this._className = 'TextInput';

		// Flag to denote the composing state, derived from
		// compositionstart/compositionend events; unused
		this._isComposing = false;

		// We need to detect whether delete or backspace was
		// pressed sometimes - consider '  foo' -> ' foo'
		this._deleteHint = ''; // or 'delete' or 'backspace'

		// When <enter> key is hit a <div> element is created and appended to the editable area:
		// inputType: insertParagraph. No new char is added to the editable area textContent property.
		this._newlineHint = false;

		// We need to detect line break in the tunneled formula
		// input window for the multiline case.
		this._linebreakHint = false;

		// Clearing the area can generate input events
		this._ignoreInputCount = 0;

		// The target range of a phone autocorrect rewrite, read during
		// 'beforeinput' (the only time it exists) and consumed by the
		// 'input' event that follows it. Null at every other moment.
		this._pendingReplacement = null;

		// Whether the user has typed in the current keyboard session; the
		// phone Calc inputmode choice never escalates once this is set
		// (see _vulcanUpdateCellEditInputMode).
		this._vulcanCellEditTyped = false;

		// The cell-edit session the current phone Calc plane was decided in
		// (see _vulcanCellEditSessionKey); null = no plane decided in a live
		// edit, so the next _setAcceptInput flip is a full session boundary.
		this._vulcanCellEditPlaneKey = null;

		// When the last user-gesture keyboard acquisition happened (phone
		// Calc only; see _vulcanMayAcquireKeyboardFocus). 0 = none live.
		this._vulcanEditIntentAt = 0;
		// Quick entry holds the Android keyboard (see vulcanHoldQuickEntry).
		this._vulcanQuickEntryHeld = false;
		// B-0287: when the Android phone-Impress double-tap door last raised the
		// keyboard (see vulcanRaiseKeyboardInGesture); 0 = none.
		this._vulcanImpressDoorAt = 0;

		// If the last focus intended to accept user input.
		// Signifies whether the keyboard is meant to be visible.
		this._setAcceptInput(false);

		// Content
		this._lastContent = []; // unicode characters
		this._hasWorkingSelectionStart = undefined; // does it work ?
		this._ignoreNextBackspace = false;

		this._preSpaceChar = '<img id="pre-space" alt=" " aria-hidden="true">';
		this._postSpaceChar = '<img id="post-space" alt=" " aria-hidden="true">';
		this._initialContent = this._preSpaceChar + this._postSpaceChar;

		// Debug flag, used in fancyLog(). See the debug() method.
		// this._isDebugOn = true;
		this._isDebugOn = false;

		this._initLayout();

		// Under-caret orange marker.
		this._addCursorHandler();

		// Auto-correct characters can trigger auto-correction, but
		// must be sent as key-up/down if we want correction.
		// cf. SvxAutoCorrect::IsAutoCorrectChar
		this._autoCorrectChars = {
			// tab, newline - handled elsewhere
			' ':  [ 32, 0,      0, 1284 ],
			'!':  [ 33, 0,      0, 4353 ],
			'"':  [ 34, 0,      0, 4353 ],
			'%':  [ 37, 0,      0, 4357 ],
			'\'': [ 39, 0,      0,  192 ],
			'*':  [ 42, 0,      0, 4360 ],
			',':  [ 44, 0,      0, 1291 ],
			'-':  [ 45, 0,      0, 1288 ],
			'.':  [ 46, 0,      0,  190 ],
			'/':  [ 47, 0,      0,  191 ],
			':':  [ 58, 0,      0, 5413 ],
			';':  [ 59, 0,      0, 1317 ],
			'?':  [ 63, 0,      0, 4287 ],
			'_':  [ 95, 0,      0, 5384 ]
		};

		// unoKeyCode values of the digits.
		this._unoKeyMap = {
			'48': 96,   // 0
			'49': 97,   // 1
			'50': 98,   // 2
			'51': 99,   // 3
			'52': 100,  // 4
			'53': 101,  // 5
			'54': 102,  // 6
			'55': 103,  // 7
			'56': 104,  // 8
			'57': 105   // 9
		};

	},

	_addCursorHandler() {
		if (document.getElementById('canvas-container')) {
			this._cursorHandler = new CursorHandler();
			app.sectionContainer.addSection(this._cursorHandler);
		}
		else {
			app.layoutingService.appendLayoutingTask(() => {
				this._addCursorHandler();
			});
		}
	},

	hasAccessibilitySupport: function() {
		return false;
	},

	onAdd: function() {
		if (this._container) {
			var docContainer = document.getElementById('document-container');
			if (docContainer)
				docContainer.appendChild(this._container);
			this.update();
		}

		if (!this.hasAccessibilitySupport()) {
			this._emptyArea();
			this._map.on('commandresult', this._onCommandResult, this);
		}

		app.events.on('updatepermission', this._onPermission.bind(this));
		window.L.DomEvent.on(this._textArea, 'focus blur', this._onFocusBlur, this);
		// VULCAN: a dedicated listener rather than a hook in _onInput, which
		// A11yTextInput (the class phone chrome always instantiates)
		// overrides wholesale.
		window.L.DomEvent.on(this._textArea, 'input', this._vulcanOnCellEditUserInput, this);

		// Do not wait for a 'focus' event to attach events if the
		// textarea/contenteditable is already focused (due to the autofocus
		// HTML attribute, the browser focusing it on DOM creation, or whatever)
		if (document.activeElement === this._textArea) {
			this._onFocusBlur({ type: 'focus' });
		}

		if (window.ThisIsTheiOSApp) {
			var that = this;
			window.MagicToGetHWKeyboardWorking = function() {
				var that2 = that;
				window.MagicKeyDownHandler = function(e) {
					that2._onKeyDown(e);
				};
				window.MagicKeyUpHandler = function(e) {
					that2._onKeyUp(e);
				};
			};
			window.postMobileMessage('FOCUSIFHWKBD');
		}

		window.L.DomEvent.on(this._map.getContainer(), 'mousedown touchstart', this._abortComposition, this);
	},

	onRemove: function() {
		window.MagicToGetHWKeyboardWorking = null;
		window.MagicKeyDownHandler = null;
		window.MagicKeyUpHandler = null;

		if (this._container && this._container.parentNode) {
			this._container.parentNode.removeChild(this._container);
		}

		if (!this.hasAccessibilitySupport()) {
			this._map.off('commandresult', this._onCommandResult, this);
		}
		window.L.DomEvent.off(this._textArea, 'focus blur', this._onFocusBlur, this);
		window.L.DomEvent.off(this._textArea, 'input', this._vulcanOnCellEditUserInput, this);
		window.L.DomEvent.off(this._map.getContainer(), 'mousedown touchstart', this._abortComposition, this);

		if (this._cursorHandler)
			app.sectionContainer.removeSection(this._cursorHandler.name);
	},

	disable: function () {
		this._textArea.setAttribute('disabled', true);
	},

	enable: function () {
		this._textArea.removeAttribute('disabled');
	},

	_onPermission: function(e) {
		if (e.detail.perm === 'edit') {
			this._textArea.removeAttribute('disabled');
			this._textArea.setAttribute('contenteditable', 'true');
			this._textArea.removeAttribute('aria-disabled');
		} else {
			this._textArea.setAttribute('disabled', true);
			this._textArea.setAttribute('contenteditable', 'false');
			this._textArea.setAttribute('aria-disabled', 'true');
		}
	},

	_onCommandResult: function(e) {
		if (this.hasAccessibilitySupport())
			return;

		if (e.commandName === '.uno:Undo' || e.commandName === '.uno:Redo') {
			//undoing something does not trigger any input method
			// this causes the editable area content not to be a substring
			// of the document text; moreover this causes problem
			// in mobile working with suggestions:
			//i.e: type "than" and then select "thank" from suggestion
			//now undo and then again select "thanks" from suggestions
			//final output is "thans"
			//this happens because undo doesn't change the editable area content.
			//So better to clean the editable area content.
			this._emptyArea();
		}
	},

	hasFocus: function() {
		return this._textArea && this._textArea === document.activeElement;
	},

	_onFocusBlur: function(ev) {
		this._fancyLog(ev.type, '');
		this._statusLog('_onFocusBlur');
		var onoff = (ev.type === 'focus' ? window.L.DomEvent.on : window.L.DomEvent.off).bind(window.L.DomEvent);

		// Debug - connect first for saner logging.
		onoff(
			this._textArea,
			'copy cut compositionstart compositionupdate compositionend select keydown keypress keyup beforeinput textInput textinput input',
			this._onEvent,
			this
		);

		// we already do the same in _onBeforeInput, anyway for Safari on iOS is too late:
		// the selection is messed up, so we miss the first typed key.
		// Needed also after a Ctrl+C.
		if (ev.type === 'focus') {
			this._a11yFocusTime = Date.now();

			if (!this._isSelectionValid() || this._isCursorAtBeginning()) {
				if (this.hasAccessibilitySupport()) {
					this._setSelectionRange(this._lastSelectionStart, this._lastSelectionEnd);
					// What core said while the keyboard was down is newer
					// than the selection just restored, as the branch below
					// already assumes. Left parked, it is replayed inside the
					// first keystroke (A11yTextInput._onBeforeInput), where a
					// caret moved left turns one letter into "delete the rest
					// of the line and type it again".
					this._updateFocusedParagraph();
				} else {
					this._emptyArea();
				}
			} else if (this.hasAccessibilitySupport()) {
				this._updateFocusedParagraph();
			}
		}

		onoff(this._textArea, 'input', this._onInput, this);
		onoff(this._textArea, 'beforeinput', this._onBeforeInput, this);
		onoff(this._textArea, 'compositionstart', this._onCompositionStart, this);
		onoff(this._textArea, 'compositionupdate', this._onCompositionUpdate, this);
		onoff(this._textArea, 'compositionend', this._onCompositionEnd, this);
		onoff(this._textArea, 'keydown', this._onKeyDown, this);
		onoff(this._textArea, 'keyup', this._onKeyUp, this);
		onoff(this._textArea, 'copy cut paste', this._map._handleDOMEvent, this._map);

		app.idleHandler.notifyActive();

		if (ev.type === 'blur' && this._isComposing) {
			this._abortComposition(ev);
		}
	},

	/*
	 * VULCAN (B-0094): is this focus()'s ANDROID branch? The platform test of
	 * its first branch below: not the iOS app, not the iPhone, not a
	 * Chromebook, and an onscreen keyboard -- the Android phone, the host app
	 * and Chrome alike. Kept beside focus() so the two read the same platform
	 * facts.
	 */
	vulcanAndroidKeyboardBranch: function() {
		return !window.ThisIsTheiOSApp && navigator.platform !== 'iPhone' &&
			!window.mode.isChromebook() && !!window.keyboard.guessOnscreenKeyboard();
	},

	// Focus the textarea/contenteditable
	// @acceptInput (only on "mobile" (= mobile phone) or on iOS and Android in general) true if we want to
	// accept key input, and show the virtual keyboard.
	focus: function(acceptInput) {
		// Note that the acceptInput parameter intentionally
		// is a tri-state boolean: undefined, false, or true.

		// Clicking or otherwise focusing the map should focus on the clipboard
		// container in order for the user to input text (and on-screen keyboards
		// to pop-up), unless the document is read only.
		if (!this._map.isEditMode()) {
			this._setAcceptInput(false);
			// on clicking focus is important
			// specially in chrome once document loses focus it never gets it back
			// which causes shortcuts to stop working (i.e: print, search etc...)
			this._map.getContainer().focus();
			return;
		}

		// VULCAN (B-0287): a door raised the keyboard inside tap 2 of a phone-deck
		// double tap. Core's round trip is not the user letting go: the
		// GraphicSelection hide-on-selection (focus(textCursor.visible) while the
		// caret is still hidden) and the cursor-gone arm both arrive here as a
		// message-context focus(false), which on Android blurs the editable and
		// drops the IME. Held for the edit-intent window from the stamp (a late
		// count 2 moves the stamp: vulcanExtendImpressDoor), which is exactly as
		// long as the door's no-caret verdict waits; a live gesture and
		// dismissSoftKeyboard (that verdict) still release. The stamp test first
		// keeps rigs that lift focus() over stubs untouched.
		if (acceptInput !== true && this._vulcanImpressDoorAt > 0 && this._vulcanImpressDoorHolds())
			return;

		// Trick to avoid showing the software keyboard: Set the textarea
		// read-only before focus() and reset it again after the blur()
		if (!window.ThisIsTheiOSApp && navigator.platform !== 'iPhone' && !window.mode.isChromebook()) {
			if (window.keyboard.guessOnscreenKeyboard() && acceptInput !== true)
				this._textArea.setAttribute('readonly', true);
		}

		/*
		 * VULCAN: ON PHONE CALC THE KEYBOARD IS SUMMONED BY A GESTURE, NOT
		 * BY A MESSAGE. Every focus(true) below this line acquires DOM focus
		 * on the hidden editable, and on iOS a focused contenteditable IS
		 * the keyboard, whatever the _acceptInput latch says. Measured on
		 * slot-01 (focus-probe stacks): core answers a bare tap on the
		 * selected cell -- and sometimes a bare select-tap -- with
		 * `cursorvisible: true`, and CanvasTileLayer._updateCursorAndOverlay
		 * replays that MESSAGE as map.focus(true), raising the keyboard with
		 * zero edit intent. The committed onClick keyboard gate cannot stop
		 * it: the raise never passes through onClick.
		 *
		 * Every deliberate phone-Calc keyboard door already acquires focus
		 * INSIDE its own user gesture, because iOS only honours programmatic
		 * focus there (MouseControl.onVulcanTouchDown on the double tap's
		 * second touchdown; the ✎ FAB in docdispatcher; the fx field's
		 * grab_focus and Control.FormulaBarJSDialog.focus). So the rule this
		 * predicate enforces is one iOS already imposed on every wanted
		 * raise: acquisition needs a live trusted gesture, an editable that
		 * already holds focus (the mid-edit zoom restore), or a gesture
		 * acquisition seconds ago (an Android/onscreen-keyboard branch
		 * incidental bare-focus() blur steals the door's focus and the round
		 * trip must be able to take it back; the true-iPhone branch never
		 * blurs, so the window is inert there).
		 *
		 * Phone Calc only -- the same scope as the inputmode feature,
		 * because Impress is DOCUMENTED to summon its shape-text keyboard
		 * through the cursor handler itself (Permission._proceedEditMode:
		 * "The deck's shape text and the sheet's cell editor summon it at
		 * their own entry doors (CanvasTileLayer's cursor handler, the Calc
		 * double tap)"), and Writer's tap grammar takes focus in-gesture via
		 * onClick. Substituting `true` here recovers the previous behaviour
		 * on every path.
		 */
		var vulcanMayAcquire = this._vulcanMayAcquireKeyboardFocus(acceptInput);

		if (!window.ThisIsTheiOSApp && navigator.platform !== 'iPhone' && !window.keyboard.guessOnscreenKeyboard()) {
			// preventScroll keeps Chromium from auto-scrolling html or body to bring
			// the caret in this hidden contenteditable back into view when focus
			// arrives during a chrome rebuild like the readonly-to-edit transition
			// (which would otherwise shift the visible UI up by the chrome-height
			// delta even though body has overflow:hidden):
			this._textArea.focus({ preventScroll: true });
		} else if (acceptInput === true && vulcanMayAcquire) {
			// On the iPhone, only call the textarea's focus() when we get an explicit
			// true parameter. On the other hand, never call the textarea's blur().

			// Calling blur() leads to so confusing behaviour with the keyboard not
			// showing up when we want. Better to have it show up a bit too long that
			// strictly needed.

			// Probably whether the calls to the textarea's focus() and blur() functions
			// actually do anything or not might depend on whether the call stack
			// originates in a user input event handler or not, for security reasons.

			// To investigate, uncomment the call to console.trace() at the start of
			// this function, and check when the topmost slot in the stack trace is
			// "(anonymous function)" in hammer.js (an event handler), and when it is
			// _onMessage (the WebSocket message handler in Socket.js).

			// preventScroll keeps Chromium from auto-scrolling html or body to bring
			// the caret in this hidden contenteditable back into view when focus
			// arrives during a chrome rebuild like the readonly-to-edit transition
			// (which would otherwise shift the visible UI up by the chrome-height
			// delta even though body has overflow:hidden):
			this._textArea.focus({ preventScroll: true });
		}

		if (!window.ThisIsTheiOSApp && navigator.platform !== 'iPhone' && !window.mode.isChromebook()) {
			if (window.keyboard.guessOnscreenKeyboard() && acceptInput !== true) {
				this._setAcceptInput(false);
				this._textArea.blur();
				this._textArea.removeAttribute('readonly');
			} else {
				// VULCAN: was an unconditional true. Reaching here with
				// acceptInput === true and the acquisition vetoed above
				// (phone-Calc message-context raise on the onscreen-keyboard
				// branch) means no focus was taken and the keyboard is not
				// meant to be up; latch what actually happened. Every other
				// route into this else keeps the stock true.
				this._setAcceptInput(acceptInput !== true || vulcanMayAcquire || this.hasFocus());
			}
		} else if (acceptInput !== false) {
			/*
			 * VULCAN: LATCH ONLY WHAT ACTUALLY HAPPENED. On this branch
			 * (iPhone, the iOS app, Chromebook with an onscreen keyboard) a
			 * bare focus() call took NO DOM focus above -- only an explicit
			 * acceptInput === true reaches _textArea.focus() -- yet the stock
			 * tail latched _acceptInput true anyway. That overstates the
			 * latch's own contract ("Returns true if the last focus was to
			 * accept input. Used to restore the keyboard",
			 * canAcceptKeyboardInput below), and every zoom-finish restore
			 * (TileSectionManager.zoomStepEnd ->
			 * map.focus(map.canAcceptKeyboardInput())) turns the stale latch
			 * into a real _textArea.focus(): on an iPhone a pinch after any
			 * incidental bare focus() -- document load, a row/column header
			 * tap, a formula commit -- raised the keyboard with zero edit
			 * intent. The onscreen-keyboard branch above already latches
			 * FALSE for the same bare call; mirror it here, latching true
			 * only when this call took DOM focus or the editor legitimately
			 * holds it already. A live edit keeps DOM focus through a pinch
			 * (disableTextInput's `disabled` attribute is inert on a
			 * contenteditable div), so the intended keyboard restore after a
			 * mid-edit zoom is preserved.
			 *
			 * vulcanMayAcquire joined later: a phone-Calc focus(true) whose
			 * acquisition was vetoed above (message-context raise) took no
			 * DOM focus either, so it must not latch true -- the latch's
			 * contract is what HAPPENED, and hasFocus() alone answers for
			 * the vetoed call.
			 */
			this._setAcceptInput((acceptInput === true && vulcanMayAcquire) || this.hasFocus());
		} else if (this._vulcanCellEditInputModeActive()) {
			/*
			 * VULCAN: ON PHONE CALC AN EXPLICIT focus(false) IS A REAL
			 * DISMISSAL. Reaching here means the caller asked, in as many
			 * words, for the keyboard to go away -- the tap-again and the
			 * tap outside the cell cursor (MouseControl), the ✎ door's
			 * pre-arm (Permission._proceedEditMode), the cursor-gone unlatch
			 * (CanvasTileLayer._updateCursorAndOverlay). On this branch
			 * (iPhone, the iOS app, Chromebook with an onscreen keyboard) the
			 * stock body wrote the latch and stopped, and TextInput.blur()
			 * cannot finish the job either: its DOM blur is platform-gated
			 * off on iPhone, where a focused contenteditable IS the keyboard.
			 * So every one of those exits left the keyboard over half the
			 * grid and only ✓/✕ could take it down. Same scope as the
			 * acquisition gate above -- phone chrome + spreadsheet -- because
			 * it is the same argument in reverse: every phone-Calc raise
			 * re-acquires INSIDE its own gesture, which is the precondition
			 * dismissSoftKeyboard's header says makes bypassing the platform
			 * gate safe. Substituting the bare _setAcceptInput(false) below
			 * recovers the previous behaviour.
			 */
			this.dismissSoftKeyboard();
		} else {
			// A deliberate release closes the edit-intent window wherever it
			// is asked for, or a `cursorvisible: true` arriving within
			// VULCAN_EDIT_INTENT_MS re-raises over a cell the user only
			// selected (see _vulcanMayAcquireKeyboardFocus). Inert off phone
			// Calc, which is the only scope that reads the window.
			this._vulcanEditIntentAt = 0;
			this._vulcanQuickEntryHeld = false;
			this._setAcceptInput(false);
		}
	},

	blur: function() {
		// A deliberate release also closes the phone-Calc edit-intent window:
		// nothing after this point may claim the last gesture wanted a
		// keyboard (see _vulcanMayAcquireKeyboardFocus).
		this._vulcanEditIntentAt = 0;
		this._vulcanQuickEntryHeld = false;
		this._setAcceptInput(false);
		if (!window.ThisIsTheiOSApp && navigator.platform !== 'iPhone' && !window.mode.isChromebook())
			this._textArea.blur();
	},

	/*
	 * VULCAN: A DELIBERATE EXIT MUST DROP THE KEYBOARD, iPhone included.
	 * blur() above keeps the stock iPhone gate: never call the DOM blur(),
	 * because a blur can make iOS refuse the next programmatic focus(), and
	 * upstream preferred a keyboard that shows "a bit too long" over one
	 * that fails to appear. That tolerance is for incidental focus churn
	 * mid-edit. A commit is the opposite case: phone Calc's ✓/✕ and the
	 * host's Done mean "I am done typing", Google Sheets' grammar drops the
	 * keyboard there (commit -> keyboard down, selection stays), and the
	 * next edit door (✎ / double tap) re-raises it with a synchronous
	 * in-gesture focus(true) that iOS honours
	 * (CalcPhoneAcceptCommitsInPlace.test.ts pins that ordering). So this
	 * bypasses the platform gate on purpose. Fork-only and skew-safe: it is
	 * called from the fork's own commit exit (Toolbar.formulabarBlur).
	 */
	dismissSoftKeyboard: function() {
		// The ✓/✕/Done exit ends the edit-intent window too: the next raise
		// needs its own gesture (see _vulcanMayAcquireKeyboardFocus).
		this._vulcanEditIntentAt = 0;
		this._vulcanImpressDoorAt = 0;
		this._vulcanQuickEntryHeld = false;
		this._setAcceptInput(false);
		this._textArea.blur();
	},

	/*
	 * VULCAN: whether this focus(acceptInput) call may take DOM focus on the
	 * hidden editable. Always yes outside phone Calc and for every call that
	 * is not asking for the keyboard; the rationale block in focus() carries
	 * the measurements. Substituting `true` recovers the previous behaviour.
	 *
	 * The gesture check STAMPS the intent window as a side effect: only an
	 * acquisition granted for a live gesture opens it, so a bare tap (whose
	 * onClick asks with acceptInput false) never does, and a message-context
	 * raise can never extend it.
	 */
	VULCAN_EDIT_INTENT_MS: 2000,

	_vulcanMayAcquireKeyboardFocus: function(acceptInput) {
		if (acceptInput !== true)
			return true;
		// Same scope as the inputmode feature: phone chrome + spreadsheet.
		if (!this._vulcanCellEditInputModeActive())
			return true;
		if (this.hasFocus())
			return true;
		if (this._vulcanUserGestureLive()) {
			this._vulcanEditIntentAt = Date.now();
			// A gesture door opens an edit of its own: no quick entry.
			this._vulcanQuickEntryHeld = false;
			return true;
		}
		return this._vulcanEditIntentAt > 0 &&
			Date.now() - this._vulcanEditIntentAt < this.VULCAN_EDIT_INTENT_MS;
	},

	// Inside the dispatch of a trusted user-input event right now. window.event
	// is the live event during dispatch and undefined on a WebSocket-message
	// or timer stack; verified set for real and synthetic-trusted input in
	// both WebKit and Chromium (focus-probe rounds 7/10 on slot-01).
	_vulcanUserGestureLive: function() {
		var ev = window.event;
		if (!ev || !ev.isTrusted)
			return false;
		var type = ev.type || '';
		return type.indexOf('touch') === 0 || type.indexOf('mouse') === 0 ||
			type.indexOf('pointer') === 0 || type === 'click' ||
			type === 'dblclick' || type.indexOf('key') === 0;
	},

	/*
	 * VULCAN: QUICK ENTRY HOLDS THE ANDROID KEYBOARD (B-0099 / B-0100 /
	 * B-0102). When a phone-Calc cell edit ends WITHOUT dismissing the
	 * keyboard -- the Return commit-and-advance and a tap on another cell,
	 * both of which reach Toolbar.vulcanEndCellEditSession({dismissKeyboard:
	 * false}) "so a serial data-entry run keeps typing" -- the keyboard is up
	 * over a merely-selected cell: VulcanCalcReturnKey's quick entry. The
	 * cursor-gone unlatch arm of _updateCursorAndOverlay cannot tell that
	 * from the round-10 leak it closes (a keyboard raised over a selected
	 * cell with no intent), so the next cursor update with no caret dropped
	 * it: the first key's own answer ('editor:' / 'invalidatecursor:' land
	 * before 'cursorvisible: true'), or ~3 s after a Return, a resize-driven
	 * _onUpdateCursor (traced on redroid, lane-b runs/run2/calc-qe/qe3, qr1).
	 * The session end that keeps the keyboard therefore HOLDS it here, and
	 * the arm asks vulcanQuickEntryHolds() before it dismisses. Released by
	 * every deliberate exit (blur, dismissSoftKeyboard, a focus(false) that
	 * reaches the release branch, a new gesture door) and by focus leaving
	 * the editable. Android only (the B-0094 gate, vulcanAndroidKeyboardBranch):
	 * the iPhone keeps the shipped answer. Substituting `false` for
	 * vulcanQuickEntryHolds() recovers the previous behaviour.
	 */
	vulcanHoldQuickEntry: function() {
		if (!this._vulcanCellEditInputModeActive())
			return;
		// The edit has ended on every platform, but a held keyboard never
		// reaches the _setAcceptInput boundary (no focus(false) runs), so end
		// the plane here: the next cell must not open on this one's keypad
		// choice, pin or typed flag.
		this._vulcanResetCellEditPlane(null);
		if (!this.vulcanAndroidKeyboardBranch())
			return;
		if (!this.hasFocus())
			return;
		this._vulcanQuickEntryHeld = true;
	},

	vulcanQuickEntryHolds: function() {
		return !!this._vulcanQuickEntryHeld && this.hasFocus() &&
			this._vulcanCellEditInputModeActive();
	},

	/*
	 * VULCAN (VO-P-0022): A GESTURE OPENED THE KEYBOARD'S DOOR MOMENTS AGO,
	 * AND THE CALLER IS NOT THAT GESTURE. True exactly while the intent
	 * window a granted gesture acquisition stamped is still live AND the
	 * current stack is a WebSocket message or a timer rather than a trusted
	 * input event -- i.e. the door's own round trip is answering.
	 *
	 * Read by CanvasTileLayer._updateCursorAndOverlay's cursor-gone unlatch
	 * arm, which otherwise mistakes that round trip for an edit that ended:
	 * the phone Calc double tap raises the keyboard inside tap 2's click,
	 * core answers the count-2 with cellcursor -> invalidatecursor ->
	 * cursorvisible, and the first two land while the in-cell caret is still
	 * hidden. Left alone the arm dismissed on each of them (DOM blur, window
	 * zeroed), so the caret's own focus(true) at cursorvisible was vetoed
	 * and focused edit opened with no keyboard.
	 *
	 * Bounded by VULCAN_EDIT_INTENT_MS, never a flag: a door whose answer
	 * never comes (a protected cell, a dropped socket) expires on its own,
	 * and every deliberate exit (dismissSoftKeyboard, blur, a gesture
	 * focus(false)) still zeroes the stamp and closes it at once. A live
	 * gesture is never "in flight" -- the tap-2 fire that runs this same arm
	 * inside the click still dismisses, and the raise placed after it in
	 * MouseControl.onClick is what re-stamps the window. Phone Calc only,
	 * the window's own scope. Substituting `false` recovers the previous
	 * behaviour.
	 */
	vulcanGestureDoorInFlight: function() {
		if (!this._vulcanCellEditInputModeActive())
			return false;
		if (this._vulcanUserGestureLive())
			return false;
		return this._vulcanEditIntentAt > 0 &&
			Date.now() - this._vulcanEditIntentAt < this.VULCAN_EDIT_INTENT_MS;
	},

	/*
	 * VULCAN (B-0287): THE PHONE DECK'S DOUBLE-TAP KEYBOARD DOOR, ANDROID HOST ONLY.
	 *
	 * A double tap on shape text in phone Impress opened the text with the caret
	 * and no keyboard on Android (IME up in 1 of 12 runs; Google Slides raises
	 * it). The editable was ALREADY document.activeElement when every focus() on
	 * it ran: the a11y selection write focuses it with no keyboard request (the
	 * note in _setSelectionRange, "A SELECTION WRITE IS A FOCUS ACQUISITION"),
	 * and a focus() on the focused element is a no-op. Android raises the IME
	 * only for an editable that BECOMES focused inside a gesture, so the door
	 * re-takes focus inside tap 2's own event, then holds it through core's
	 * answer (the hold in focus()).
	 *
	 * Scope is the host's keyboard MODEL, never the platform: only the Android
	 * host reports `resizes` (Vulcan_HostKeyboard, RU-38). The iPhone sends no
	 * such field, so every member below is inert there and RU-26/RU-03 stand;
	 * Writer, Calc, tablet and desktop never reach it.
	 */
	_vulcanImpressDoorScope: function() {
		return !!(window.vulcanPhoneChrome && this._textArea && this._map &&
			this._map._docLayer && this._map._docLayer._docType === 'presentation' &&
			window.VulcanKeyboard && typeof window.VulcanKeyboard.hostResizes === 'function' &&
			window.VulcanKeyboard.hostResizes());
	},

	// Only from VulcanImpressTextEntry.openKeyboardDoor, inside tap 2's click or
	// dblclick. True = raised (the caller arms the no-caret verdict).
	vulcanRaiseKeyboardInGesture: function() {
		if (!this._vulcanImpressDoorScope() || !this._vulcanUserGestureLive())
			return false;
		var doorLive = this.vulcanImpressDoorRemainingMs() > 0;
		// Focused with no keyboard: blur so focus(true) is a real transition. A
		// keyboard that is already up (serial entry) or a door already raised in
		// this gesture (click, then dblclick) keeps its focus: no IME flash.
		if (this.hasFocus() && !doorLive &&
		    !document.documentElement.hasAttribute('data-vulcan-keyboard-open'))
			this._textArea.blur();
		this._vulcanImpressDoorAt = Date.now();
		this.focus(true);
		return true;
	},

	_vulcanImpressDoorHolds: function() {
		return this.vulcanImpressDoorRemainingMs() > 0 &&
			!this._vulcanUserGestureLive() && this._vulcanImpressDoorScope();
	},

	/*
	 * VULCAN (B-0287, the door race): the stamp above is the door's ONE clock.
	 * The hold in focus() and VulcanImpressTextEntry's no-caret verdict both
	 * end when it runs out, at the same instant, so the verdict can never take
	 * the keyboard back while the hold still treats core's round trip as the
	 * door's own (or the other way round). On the device the verdict was an
	 * 800 ms timer of its own; it fired at tap 2 + 921-948 ms and core's caret
	 * came at tap 2 + 990-1297 ms (lane-b runs/run3/dtap-gap), so a slow caret
	 * met a keyboard that had already gone down.
	 *
	 * How long the door's hold has left, in ms; 0 when no door is open.
	 */
	vulcanImpressDoorRemainingMs: function() {
		if (!(this._vulcanImpressDoorAt > 0))
			return 0;
		return Math.max(0, this._vulcanImpressDoorAt + this.VULCAN_EDIT_INTENT_MS - Date.now());
	},

	/*
	 * Keep an open door open until at least `untilMs` (a Date.now() time):
	 * VulcanImpressTextEntry.onDoorCount2Sent, when the count 2 the caret
	 * answers went to core late. Moves the stamp, so the hold and the verdict
	 * still end together. It can extend a door and never open one: a door
	 * never raised, already expired or already dismissed (stamp 0) stays shut,
	 * and so does every host outside the door's scope (the iPhone). Returns the
	 * ms the hold has left.
	 */
	vulcanExtendImpressDoor: function(untilMs) {
		if (this.vulcanImpressDoorRemainingMs() > 0 &&
		    this._vulcanImpressDoorScope())
			this._vulcanImpressDoorAt = Math.max(this._vulcanImpressDoorAt, untilMs - this.VULCAN_EDIT_INTENT_MS);
		return this.vulcanImpressDoorRemainingMs();
	},

	/*
	 * VULCAN: NUMERIC-FIRST KEYBOARD FOR PHONE CALC NUMBER CELLS.
	 *
	 * The hidden editable never set `inputmode`, so every phone Calc cell
	 * edit raised the full QWERTY keyboard and digits sat one plane away
	 * (docs/mobile-redesign/02-calc.md names Google Sheets phone, which
	 * leads numeric cells with a numeric surface, as the parity bar; the
	 * operator strip covers formula symbols but no digits).
	 *
	 * WHICH numeric plane is a DEVICE measurement, not a preference
	 * (G28-REVISED (b)): Sheets raises a 3x4 phone keypad carrying the
	 * ITU E.161 letter subtitles -- 2 ABC, 3 DEF, 4 GHI. On the web exactly
	 * one inputmode renders that on iOS: 'tel' (UIKeyboardTypePhonePad).
	 * 'decimal' and 'numeric' both render a bare digit pad with no letters
	 * at all. The keypad has no decimal-separator key; the above-keyboard
	 * rail carries `.` and `,` for that, which is why the measured symbol
	 * set has them.
	 *
	 * The cell's number FORMAT never crosses to the client outside dialogs,
	 * so the pragmatic subset: when a cell edit's content arrives from core
	 * and it reads as a plain number, present the keypad. The keypad's
	 * letters are painted mnemonics, not typable, so it is as letterless as
	 * the pad it replaces and the rules stay asymmetric in the safe
	 * direction:
	 *
	 *   - the keypad is only ever chosen from content CORE sent for this
	 *     keyboard session (_wrapContent, the choke every a11y content set
	 *     flows through) and only before the user has typed -- never
	 *     mid-typing, which would yank the layout under the user's thumbs.
	 *   - it falls back to the full layout the moment the content stops
	 *     reading as a number -- deleted to empty, '=' formulas, pasted
	 *     text -- so nobody is stranded on a letterless plane.
	 *   - a session boundary (_setAcceptInput flip) clears the attribute,
	 *     so every keyboard raise starts from the full layout and the
	 *     stale previous cell can never pick the plane. A flip inside the
	 *     SAME live cell edit is not a boundary: on Android the keyboard's
	 *     own pad swap flips the latch (see _vulcanCellEditSessionKey).
	 *     The end of that edit still is, flip or not (_setAcceptInput).
	 *
	 * Phone chrome + spreadsheet only; everything else keeps the browser
	 * default. If the running iOS ignores a mid-focus inputmode change the
	 * whole feature degrades to today's full keyboard, never worse.
	 */
	_vulcanCellEditInputModeActive: function() {
		return !!(window.vulcanPhoneChrome && this._textArea && this._map &&
			typeof this._map.getDocType === 'function' &&
			this._map.getDocType() === 'spreadsheet');
	},

	/*
	 * VULCAN: WHICH live cell edit the plane was decided in, or null.
	 *
	 * The _setAcceptInput flip is a keyboard-session boundary by proxy, and
	 * on Android the proxy fires inside ONE edit. Measured on redroid/Gboard
	 * (phone Calc, focused edit on '27', IME up): the 123 chip sets
	 * inputmode=tel, Gboard swaps to its shorter numeric pad
	 * (visualViewport 367 -> 407), and that resize alone flips the latch
	 * twice -- true via CalcTileLayer resize -> _onUpdateCursor ->
	 * _updateCursorAndOverlay -> focus(true), then false via
	 * CanvasTileLayer._mobileChecksAfterResizeEvent -> map.setAcceptInput.
	 * Each flip read as a new session and put the plane back on letters, so
	 * the chip visibly did nothing. The keyboard swapping its own layout is
	 * not a new edit; the key is what tells the two apart.
	 *
	 * Non-null only while a cell edit is demonstrably live: phone Calc,
	 * html.vulcan-formula-editing (the client's own live-edit marker), the
	 * cell cursor and the text caret both shown. It names the part and the
	 * cell, so a different cell is a different session whatever the latch
	 * did in between. Every global is guarded: a context without them reads
	 * null, which is today's flip-is-a-boundary behaviour, never worse.
	 */
	_vulcanCellEditSessionKey: function() {
		if (!this._vulcanCellEditInputModeActive())
			return null;
		if (typeof document === 'undefined' || !document.documentElement ||
			!document.documentElement.classList.contains('vulcan-formula-editing'))
			return null;
		if (typeof app === 'undefined' || !app || !app.calc || !app.file ||
			!app.calc.cellCursorVisible || !app.calc.cellAddress ||
			!app.file.textCursor || !app.file.textCursor.visible)
			return null;
		var docLayer = this._map._docLayer;
		return (docLayer ? docLayer._selectedPart : '') + ':' +
			app.calc.cellAddress.x + ':' + app.calc.cellAddress.y;
	},

	/*
	 * VULCAN: the selected cell's number-format CATEGORY, or null.
	 *
	 * Round 8 correction to the header above: the cell's number format DOES
	 * cross to the client. `.uno:NumberFormatType` (core's
	 * SID_NUMBER_TYPE_FORMAT, ScFormatShell::GetNumFormatState) is in Calc's
	 * tested state-change set (online/test/UnitUNOCommand.cpp:274), every
	 * statechanged: lands in map.stateChangeHandler unconditionally, and
	 * VulcanMobileFormat.ts:143-158 documents the category map. 9 = Plain
	 * text is the one consumed here.
	 *
	 * EDGE-TRIGGERED, and that is load-bearing: LOK reports the state when
	 * it CHANGES, so moving between two same-format cells sends nothing and
	 * a document that never sent it at all is indistinguishable from
	 * General. Absence therefore returns null — General — and the caller
	 * falls back to the shipped content regex. Absence must NEVER read as
	 * numeric; a stale or missing category picking the letterless plane
	 * silently is the confident-wrong-answer failure mode.
	 */
	_vulcanCellNumberFormatCategory: function() {
		var handler = this._map && this._map.stateChangeHandler;
		if (!handler || typeof handler.getItemValue !== 'function')
			return null;
		var raw = handler.getItemValue('.uno:NumberFormatType');
		if (raw === undefined || raw === null || raw === '')
			return null;
		var category = parseInt(raw, 10);
		return isNaN(category) ? null : category;
	},

	_vulcanUpdateCellEditInputMode: function(content) {
		if (!this._vulcanCellEditInputModeActive())
			return;
		// VULCAN round 8 (C4): an explicit chip choice outranks every
		// automatic decision for the rest of the keyboard session. The pin
		// is set ONLY by _vulcanToggleCellEditPlane and cleared at the
		// _setAcceptInput session boundary with the plane itself -- not at
		// a same-edit flip, which Gboard's pad swap causes on its own.
		if (this._vulcanCellEditPlanePinned)
			return;
		// VULCAN round 8 (L7 step 1): a cell explicitly formatted Plain text
		// (category 9) is TEXT whatever its content reads as -- `12345` in a
		// Plain text column may be about to become `12345 Main St`, and the
		// keypad's letters are paint, not keys. The veto is ONE-directional
		// on purpose: a numeric category alone never summons the plane (that
		// widening is gated on the iOS 26.2-26.4 comma-decimal regression,
		// FB22063448 -- a device check, not a mocha test), and a null
		// category is General, which keeps the shipped content decision
		// byte-for-byte.
		var plainText = this._vulcanCellNumberFormatCategory() === 9;
		var numeric = !plainText && typeof content === 'string' &&
			/^[+-]?([0-9]+([.,][0-9]*)?|[.,][0-9]+)%?$/.test(content.trim());
		var keypadNow = this._textArea.getAttribute('inputmode') === 'tel';
		// `_acceptInput === true` scopes the choice to a LIVE keyboard
		// session: a content sync for a merely-selected cell must not leave
		// a stale plane behind for the next cell's edit to raise with.
		if (numeric && !keypadNow && !this._vulcanCellEditTyped &&
			this._acceptInput === true) {
			this._textArea.setAttribute('inputmode', 'tel');
			// The automatic keypad swaps Gboard's pad exactly like the chip
			// does, so it must survive the same-edit resize flips too (see
			// _vulcanCellEditSessionKey).
			this._vulcanCellEditPlaneKey = this._vulcanCellEditSessionKey();
		} else if (keypadNow && !numeric)
			this._textArea.removeAttribute('inputmode');
		// VULCAN round 8 (C5): broadcast the one decision so the chip label
		// and the rail ride THIS state, never a second derivation. Guarded:
		// the extraction rigs and jsdom harnesses run this method against
		// maps that cannot hear.
		if (this._map && typeof this._map.fire === 'function')
			this._map.fire('vulcancalcplane', {
				keypad: this._textArea.getAttribute('inputmode') === 'tel',
				category: this._vulcanCellNumberFormatCategory(),
				content: typeof content === 'string' ? content : '',
				typed: !!this._vulcanCellEditTyped,
				pinned: false
			});
	},

	/*
	 * VULCAN round 8 (C4/GAP 3): the plane chip's isolated flip.
	 *
	 * The ONE place a plane changes by human decree. An attribute write and
	 * nothing else — NO blur/refocus bounce (ruling X-3): TextInput.blur()
	 * is platform-gated on the iPhone for a reason, a bounce would be
	 * vetoed by the keyboard-focus gesture gate or destroy live
	 * composition, and WebKit applies the change at pointerup on its own
	 * schedule (the deliberate m_pendingInputModeChange deferral). If the
	 * running iOS ignores the mid-focus change entirely the feature
	 * degrades to today's full keyboard — never worse than today.
	 *
	 * The choice PINS the session: automatic decisions stand down until
	 * the _setAcceptInput boundary clears the pin with the plane. The pin
	 * records WHICH cell edit it belongs to, so the resize flips its own
	 * Gboard pad swap causes (measured on redroid: visualViewport
	 * 367 -> 407) do not count as that boundary.
	 */
	_vulcanToggleCellEditPlane: function() {
		if (!this._vulcanCellEditInputModeActive())
			return;
		var keypadNow = this._textArea.getAttribute('inputmode') === 'tel';
		if (keypadNow)
			this._textArea.removeAttribute('inputmode');
		else
			this._textArea.setAttribute('inputmode', 'tel');
		this._vulcanCellEditPlanePinned = true;
		// The pin belongs to THIS cell edit: the Gboard pad swap the flip
		// just caused re-lays the viewport, and those resize flips must not
		// read as a session boundary (see _vulcanCellEditSessionKey).
		this._vulcanCellEditPlaneKey = this._vulcanCellEditSessionKey();
		if (this._map && typeof this._map.fire === 'function')
			this._map.fire('vulcancalcplane', {
				keypad: !keypadNow,
				category: this._vulcanCellNumberFormatCategory(),
				content: this.getPlainTextContent(),
				typed: !!this._vulcanCellEditTyped,
				pinned: true
			});
	},

	// A real user edit (never a programmatic innerHTML write, which fires no
	// input event) pins the current plane against escalation and keeps the
	// non-numeric fallback immediate.
	_vulcanOnCellEditUserInput: function() {
		if (this._ignoreInputCount > 0)
			return;
		if (!this._vulcanCellEditInputModeActive())
			return;
		this._vulcanCellEditTyped = true;
		this._vulcanUpdateCellEditInputMode(this.getPlainTextContent());
	},

	/*
	 * VULCAN: SUGGESTION-ROW POLICY BY ORIENTATION x DOCTYPE (G12).
	 *
	 * The "suggestion row" G12 budgets is iOS QuickType — SYSTEM keyboard
	 * chrome. The only web lever is this editable's content attributes,
	 * which iOS maps onto UITextInputTraits: autocorrect (+ the standing
	 * autocomplete=off/spellcheck=false) and, on iOS 18+,
	 * writingsuggestions="false" for inline predictions. The matrix, from
	 * the round-7 exhibits: Calc suppresses in LANDSCAPE only (Google
	 * Sheets landscape shows no suggestion row — the space belongs to the
	 * toolbars); Calc portrait, Impress and Writer keep it in both
	 * orientations (Google Slides keeps predictions in landscape, and
	 * suppressing Writer would also kill the R6 autocorrect rewrites). We
	 * never build a DOM suggestion row of our own. If the running iOS
	 * ignores a mid-focus trait change, the policy lands at the next
	 * keyboard session (_setAcceptInput) — degradation in every case is
	 * today's behaviour, never worse. Desktop chrome (a misdeclared phone
	 * included) keeps the stock autocorrect=off stamp.
	 */
	_vulcanSuggestionRowSuppressed: function() {
		if (!window.vulcanPhoneChrome)
			return false;
		var docType = this._map && typeof this._map.getDocType === 'function' ?
			this._map.getDocType() : null;
		// Unknown docType (_initLayout runs before the map attaches) reads
		// as the kept state; the first session boundary re-decides.
		return docType === 'spreadsheet' && !this._vulcanIsPortrait();
	},

	_vulcanIsPortrait: function() {
		if (window.matchMedia) {
			// Trust the pair only when it discriminates (a UA without CSSOM
			// view matching answers false to both).
			if (window.matchMedia('(orientation: portrait)').matches)
				return true;
			if (window.matchMedia('(orientation: landscape)').matches)
				return false;
		}
		return window.innerHeight >= window.innerWidth;
	},

	_vulcanApplySuggestionPolicy: function() {
		if (!this._textArea)
			return;
		if (!window.vulcanPhoneChrome) {
			// Stock stamp: no corrections off the phone chrome.
			this._textArea.setAttribute('autocorrect', 'off');
			this._textArea.removeAttribute('writingsuggestions');
			return;
		}
		if (this._vulcanSuggestionRowSuppressed()) {
			this._textArea.setAttribute('autocorrect', 'off');
			this._textArea.setAttribute('writingsuggestions', 'false');
		} else {
			this._textArea.setAttribute('autocorrect', 'on');
			this._textArea.removeAttribute('writingsuggestions');
		}
	},

	// Returns true if the last focus was to accept input.
	// Used to restore the keyboard.
	canAcceptKeyboardInput: function() {
		return this._acceptInput;
	},

	// Marks the content of the textarea/contenteditable as selected,
	// for system clipboard interaction.
	select: function() {
		this._setSelectionRange(0, this.getPlainTextContent().length);
	},

	getValue: function() {
		return this.getPlainTextContent();
	},

	getPlainTextContent: function() {
		return 	this._textArea.textContent;
	},

	getHTML: function() {
		return 	this._textArea.innerHTML;
	},

	_wrapContent: function(content) {
		// VULCAN: every a11y content set (A11yTextInput.setHTML, fed by
		// core's focused-paragraph messages) flows through here with the
		// plain cell text -- the one trustworthy moment to (re)decide the
		// phone Calc keyboard plane. See _vulcanUpdateCellEditInputMode.
		this._vulcanUpdateCellEditInputMode(content);
		var wrappedContent = this.hasAccessibilitySupport()
			? '<span id="readable-content" aria-hidden="false">' + content + '</span>'
			: content;
		return content.length === 0
			? this._initialContent
			: this._preSpaceChar + wrappedContent + this._postSpaceChar;
	},

	resetContent: function() {
		// VULCAN: an emptied buffer must not keep the letterless keypad
		// plane; see _vulcanUpdateCellEditInputMode.
		this._vulcanUpdateCellEditInputMode('');
		this._textArea.innerHTML = this._initialContent;
	},

	// Convert an array of Unicode code points to a string of UTF-16 code units. Workaround
	// for String.fromCodePoint() that is missing in IE.
	codePointsToString: function(codePoints) {
		var result = '';
		for (var i = 0; i < codePoints.length; ++i) {
			if (codePoints[i] <= 0xFFFF)
				result = (result +
					String.fromCharCode(codePoints[i]));
			else
				result = (result +
					String.fromCharCode(((codePoints[i] - 0x10000) >> 10) + 0xD800) +
					String.fromCharCode(((codePoints[i] - 0x10000) % 0x400) + 0xDC00));
		}
		return result;
	},

	// As the name says, this returns this._textArea.value as an array of numbers that are
	// Unicode code points. *Not* UTF-16 code units.
	getValueAsCodePoints: function(value) {
		// this._logCharCodeSequence(value);
		var arr = [];
		var code;
		for (var i = 0; i < value.length; ++i)
		{
			code = value.charCodeAt(i);
			arr.push(code);
		}
		return arr;
	},

	update: function() {
		if (this._container && this._map && app.file.textCursor.rectangle && app.activeDocument) {
			var rect = app.file.textCursor.rectangle;
			var pos = new cool.Point(
				Math.round(rect.v1X / app.dpiScale),
				Math.round(rect.v1Y / app.dpiScale)
			);
			this._setPos(pos);
		}
	},

	_initLayout: function() {
		this._container = window.L.DomUtil.create('div', 'clipboard-container');
		this._container.id = 'doc-clipboard-container';

		this._textAreaLabel = window.L.DomUtil.create('label', 'visuallyhidden', this._container);
		this._textAreaLabel.id = 'clipboard-area-label';

		// The textarea allows the keyboard to pop up and so on.
		// Note that the contents of the textarea are NOT deleted on each composed
		// word, in order to make
		this._textArea = window.L.DomUtil.create('div', 'clipboard', this._container);
		this._textArea.id = 'clipboard-area';
		this._textArea.setAttribute('contenteditable', 'true');
		/*
		 * VULCAN: SENTENCE CAPITALISATION AND AUTOCORRECT ON A PHONE.
		 *
		 * `autocapitalize: off` is a desktop default that nobody notices on a
		 * desktop, because a hardware keyboard has a shift key you were going
		 * to press anyway. On a phone it is a typing regression against every
		 * other editor on the device: every sentence you write starts
		 * lowercase and you have to reach for shift on each one. Google Docs
		 * on a phone capitalises sentences; so does Mail, Notes and the
		 * browser's own address bar. It changes only the keyboard's shift
		 * state -- the character arrives uppercase and nothing already in this
		 * element is touched.
		 *
		 * `autocorrect` is a different kind of feature, and it was off for that
		 * reason: it REWRITES text that has already been entered, arriving as
		 * an `insertReplacementText` input event over a RANGE rather than as a
		 * keystroke at the caret. This element holds a window of surrounding
		 * document text for IME context, not an authoritative buffer, so a
		 * replacement that is turned into the wrong delete count silently eats
		 * the neighbouring word. It is on now because
		 * _captureReplacementRange / _applyReplacementRange further down
		 * this file translate that range into the protocol core speaks -- delete N
		 * characters before the caret, M after it, insert a string at it:
		 *
		 *   RANGE SOURCE. `beforeinput.getTargetRanges()`, and nothing else.
		 *   It is populated only during beforeinput, so it is read at the END
		 *   of _onBeforeInput -- after that handler's own repairs, which can
		 *   rewrite this element -- and stashed with a snapshot of the pre-edit
		 *   text. No range is ever inferred from the caret. `ev.data` is not
		 *   trusted either: the replacement string is read back out of the DOM
		 *   the browser actually produced; a disagreement between the two is
		 *   logged under _isDebugOn and acted on by neither.
		 *
		 *   WHAT MAKES THE COUNTS SAFE. Before a byte is sent, the post-edit
		 *   text must read back as prefix + X + suffix around the stashed
		 *   range, and `_lastContent` must still equal the pre-edit text (that
		 *   is what puts core's caret and these offsets in one coordinate
		 *   space). Deletes are counted in code points, because core spends one
		 *   <backspace> on a surrogate pair that the range counts as two.
		 *
		 *   THE CARET HAS USUALLY MOVED ON. The correction commits when you
		 *   type the space, so the range ("teh") sits behind the caret (after
		 *   "teh "). Handled: the delete spans from the range start to the
		 *   caret and the retyped text carries the correction plus everything
		 *   between, so the caret lands where it already was. Typing "teh "
		 *   sends `removetextcontext before=4 after=0` then
		 *   `textinput text=the%20`. A range that starts AFTER the caret cannot
		 *   be expressed without moving core's caret, and is refused.
		 *
		 *   FALLBACK. Every refusal names its reason on the console and falls
		 *   through to the ordinary content differ below -- the code that
		 *   shipped before this, which reconstructs the edit from old-vs-new
		 *   content and is right while the change is contiguous with the caret.
		 *   Nothing is dropped and nothing is guessed.
		 *
		 *   NOT VERIFIED: no device has typed into this build. Which
		 *   `inputType` a correction arrives as is browser behaviour that
		 *   cannot be read out of this tree -- nothing else in it observes
		 *   insertReplacementText -- and on Android a GBoard correction is
		 *   expected to arrive as a composition instead, where this handler
		 *   never fires and the composition path behaves as it did before. The
		 *   reading that settles it: type "teh " on a device with _isDebugOn
		 *   set, and look for `replacement-range` / `replacement-applied` in
		 *   the INPUT log and for that removetextcontext/textinput pair on the
		 *   wire. A `not applied over its target range` line instead means the
		 *   differ handled it.
		 *
		 * `spellcheck` stays off: the engine runs its own and browser squiggles
		 * on an off-screen 1px element are invisible anyway.
		 *
		 * Phone chrome only. `vulcanPhoneChrome` is stamped pre-paint in
		 * js/global.js from the host's `vulcanChrome` parameter, so an iPad in
		 * desktop mode and a small desktop window both keep the stock
		 * behaviour.
		 */
		this._textArea.setAttribute('autocapitalize',
			window.vulcanPhoneChrome ? 'sentences' : 'off');
		/*
		 * VULCAN: NO AUTOFOCUS UNDER PHONE CHROME. The "Prevent autofocus"
		 * `disabled` attribute below never prevented anything -- `disabled`
		 * is a form-control attribute and is inert on this contenteditable
		 * div -- so once `updatepermission: edit` swaps contenteditable on,
		 * the browser's autofocus processing takes REAL DOM focus with no
		 * JS focus() call at all (measured on slot-01: activeElement flips
		 * to #clipboard-area with zero focus() calls traced; dropping this
		 * attribute at set-time leaves body focused). On iOS a focused
		 * contenteditable raises the soft keyboard, so phone Calc -- the one
		 * phone doctype that opens straight into edit -- showed a keyboard
		 * on document open, zero gestures. Desktop and tablet keep the
		 * stamp: their first bare focus() acquires anyway and no onscreen
		 * keyboard is at stake. A phone the host declared desktop chrome
		 * for keeps stock behaviour, same as every other phone gate.
		 */
		if (!window.vulcanPhoneChrome)
			this._textArea.setAttribute('autofocus', 'true');
		// autocorrect (and iOS 18's writingsuggestions veto) are stamped by
		// the G12 orientation x doctype policy — see
		// _vulcanApplySuggestionPolicy. The docType is usually unknown this
		// early, which reads as the kept state ('on' under phone chrome,
		// matching the paragraph above); the suppressed cells are re-stamped
		// at the first _setAcceptInput boundary and on rotation.
		this._vulcanApplySuggestionPolicy();
		this._textArea.setAttribute('autocomplete', 'off');
		this._textArea.setAttribute('spellcheck', 'false');
		this._textArea.setAttribute('aria-labelledby', this._textAreaLabel.id);
		if (window.vulcanPhoneChrome && window.matchMedia) {
			// Re-stamp the suggestion policy on rotation. Never force a
			// blur()/focus() to make iOS re-read the traits mid-focus: if it
			// ignores the change, the next keyboard session converges — the
			// same degradation stance as the inputmode feature above.
			var suggestionPolicyInput = this;
			var vulcanOrientationQuery = window.matchMedia('(orientation: portrait)');
			var vulcanOnOrientationChange = function() {
				suggestionPolicyInput._vulcanApplySuggestionPolicy();
			};
			if (vulcanOrientationQuery.addEventListener)
				vulcanOrientationQuery.addEventListener('change', vulcanOnOrientationChange);
			else if (vulcanOrientationQuery.addListener)
				vulcanOrientationQuery.addListener(vulcanOnOrientationChange);
		}

		if (this.hasAccessibilitySupport()) {
			this._setSelectionFlag(false);

			if (window.L.Browser.mac || window.vulcanPhoneChrome) {
				// macOS needs this for keyboard movement. Forced phone accessibility
				// also needs a real assertive sink on Android/TalkBack, where `mac`
				// is false even though A11yTextInput is active.
				this._a11yLiveRegion = window.L.DomUtil.create('div', 'visuallyhidden', this._container);
				this._a11yLiveRegion.id = 'a11y-live-region';
				this._a11yLiveRegion.setAttribute('aria-live', 'assertive');
				this._a11yLiveRegion.setAttribute('aria-atomic', 'true');
			}
		}

		// Prevent automatic line breaks in the textarea. Without this,
		// chromium/blink will trigger input/insertLineBreak events by
		// just adding whitespace.
		// See https://developer.mozilla.org/en-US/docs/Web/HTML/Element/textarea#attr-wrap
		this._textArea.setAttribute('wrap', 'off');

		// Prevent autofocus
		this._textArea.setAttribute('disabled', true);

		if (window.L.Browser.cypressTest) {
			var that = this;
			this._textArea._hasAccessibilitySupport = function() {
				return that.hasAccessibilitySupport();
			};
			this._textArea._wrapContent = function(content) {
				return that._wrapContent(content);
			};
			this._textArea._getSelectionStart = function() {
				return that._getSelectionStart();
			};
			this._textArea._getSelectionEnd = function() {
				return that._getSelectionEnd();
			};
		}

		this._setupStyles();

		this._emptyArea();

		if (!this.hasAccessibilitySupport()) {
			var warningMessage =
				_('Screen reader support for text content is disabled. ') +
				_('You need to enable it both at server level and in the UI. ') +
				_('Look for the accessibility section in coolwsd.xml for server setting. ') +
				_('Also check the voice over toggle under {parentControl}.').replace(
					'{parentControl}',
					window.userInterfaceMode === 'notebookbar' ? _('the Help tab') : _('the View menu')
				);
			this._textArea.setAttribute('aria-description', warningMessage);
		}
	},

	_setupStyles: function() {
		if (this._isDebugOn) {
			// Style for debugging
			this._container.style.opacity = 0.5;
			this._textArea.style.cssText = 'border:1px solid red !important';
			this._textArea.style.width = window.L.Browser.cypressTest ? '1px' : '120px';
			this._textArea.style.height = window.L.Browser.cypressTest ? '1px' : '50px';
			this._textArea.style.overflow = 'display';

			this._textArea.style.fontSize = '20px';
			this._textArea.style.position = 'relative';
			this._textArea.style.left = '10px';
		} else {
			this._container.style.opacity = 0;
			this._textArea.style.width = '1px';
			this._textArea.style.height = '1px';
			this._textArea.style.caretColor = 'transparent';
			this._textArea.style.resize = 'none';
		}
		this._textArea.style['white-space'] = 'pre';
	},

	debug: function(debugOn) {
		this._isDebugOn = !!debugOn;
		this._setupStyles();
	},

	activeElement: function() {
		return this._textArea;
	},

	// Displays the caret and the under-caret marker.
	// Fetches the coordinates of the caret from the map's doclayer.
	showCursor: function() {
		if (!this._map._docLayer._cursorMarker || app.tile.size.x === 0 || !app.activeDocument) {
			return;
		}

		if (!this._map._docLayer._cursorMarker.isDomAttached()) {
			// Display caret
			this._map._docLayer._cursorMarker.add();
		}
		this._map._docLayer._cursorMarker.setMouseCursorForTextBox();

		// Move and display under-caret marker

		if (window.touch.currentlyUsingTouchscreen() && !app.activeDocument.activeView.hasTextSelection && this._cursorHandler) {
			// setPosition takes the section's top-left BOX corner, not the
			// caret. On a phone the box is wider than the art and starts
			// anchorInsetX() CSS px LEFT of the caret, so that the grab region
			// wraps the teardrop instead of sitting beside it;
			// CursorHandler.ts owns that split and the reason for it.
			// CursorHandler.onMouseUp adds the same inset back before posting,
			// so core is still told the caret's own pixel. Off-phone
			// anchorInsetX() is 0 and this is the stock call, minus a literal
			// `+ (0 * app.dpiScale)` on the Y that never did anything.
			//
			// anchorInsetX() is CSS px and rectangle.pX1 is CORE px, so the
			// crossing is `* app.dpiScale` — multiply, never divide.
			var cursorHandlerInsetX = CursorHandler.anchorInsetX() * app.dpiScale; // CORE px.
			this._cursorHandler.setPosition(
				app.file.textCursor.rectangle.pX1 - cursorHandlerInsetX,
				app.file.textCursor.rectangle.pY2);
			// Stock passed a literal `true` here: the knob was up for the whole
			// life of the caret. It is now a tap-summoned affordance, and
			// wantsVisible() is the policy (CursorHandler.phoneVisibility).
			// Off-phone that method returns true and this is the stock line.
			this._cursorHandler.setShowSection(this._cursorHandler.wantsVisible());
		} else if (this._cursorHandler) {
			this._cursorHandler.setShowSection(false);
		}

		// Move the hidden text area with the cursor
		this.update();
		// shape handlers hidden (if selected)
		this._map.fire('handlerstatus', {hidden: true});
		if (this._map._docLoaded && this._map.getDocType() === 'spreadsheet')
			this._map.onFormulaBarFocus();
	},

	// Hides the caret and the under-caret marker.
	hideCursor: function() {
		if (!this._map._docLayer._cursorMarker) {
			return;
		}
		if (this._map._docLayer._cursorMarker.isDomAttached())
			this._map._docLayer._cursorMarker.remove();

		if (this._cursorHandler)
			this._cursorHandler.setShowSection(false);

		// shape handlers visible again (if selected)
		this._map.fire('handlerstatus', {hidden: false});
	},

	_setPos: function(pos) {
		// the offset is needed since we have to move away from the edited text
		// or double clicks for selecting text doesn't work properly
		if (window.L.Browser.cypressTest) {
			// Some cypress tests require for the editable area to be as near as possible
			// to the caret overlay when editing. In fact a synthetic mouse click on
			// the editable area is performed in order to make it focused and ready for the input.
			// However, since this click is forwarded to core, it could change the current caret
			// position causing a test failure.
			pos.x += 10;
			pos.y += 10;
		}
		else {
			pos.y += this._isDebugOn ? 50 : 200;
		}
		this._container.style.transform = 'translate(' + pos.x + 'px, ' + pos.y + 'px)';
	},

	// Generic handle attached to most text area events, just for debugging purposes.
	_onEvent: function(ev) {
		if (this._map.uiManager.isUIBlocked())
			return;
		var msg = {
			inputType: ev.inputType,
			data: ev.data,
			key: ev.key,
			isComposing: ev.isComposing
		};

		if ('key' in ev) {
			msg.key = ev.key;
			msg.keyCode = ev.keyCode;
			msg.code = ev.code;
			msg.which = ev.which;
		}
		this._fancyLog(ev.type, msg);
	},

	_fancyLog: function(type, payload) {
		// Avoid unhelpful exceptions
		if (payload === undefined)
			payload = 'undefined';
		else if (payload === null)
			payload = 'null';

		// Pretty-print on console (but only if "tile layer debug mode" is active)
		if (this._isDebugOn) {
			var state = this._isComposing ? 'C' : 'N';
			state += this._hasWorkingSelectionStart ? 'S' : '-';
			state += this._ignoreNextBackspace ? 'I' : '-';
			state += ' ';

			var textSel = this._getSelectionStart() + '!' + this._getSelectionEnd();
			state += textSel + ' ';

			var sel = window.getSelection();
			var content = this.getValue();
			if (sel === null)
				state += '-1';
			else
			{
				state += sel.rangeCount;

				state += ' ';
				var cursorPos = -1;
				for (var i = 0; i < sel.rangeCount; ++i)
				{
					var range = sel.getRangeAt(i);
					state += range.startOffset + '-' + range.endOffset + ' ';
					if (cursorPos < 0)
						cursorPos = range.startOffset;
				}
				if (sel.toString() !== '')
					state += ': "' + sel.toString() + '" ';

				// inject probable cursor
				if (cursorPos >= 0)
					content = content.slice(0, cursorPos) + '|' + content.slice(cursorPos);
			}

			state += '[' + this._deleteHint + '] ';

			window.app.console.log(
				+ new Date() + ' %cINPUT%c: ' + state
				+ '"' + content + '" ' + type + '%c ',
				'background:#bfb;color:black',
				'color:green',
				'color:black',
				JSON.stringify(payload)
			);
		}
	},

	_handleMisplacedCursorAtBeginning: function(ev) {
		// It seems some inputs e.g. GBoard can magically move the cursor from " | " to "|  "
		window.app.console.log('Oh dear, gboard sabotaged our cursor position, fixing');
		// But when we detect the problem only emit a delete when we have one.
		if (ev.inputType && ev.inputType === 'deleteContentBackward')
		{
			this._removeTextContent(1, 0);
			// Having mended it we now get a real backspace on input (sometimes)
			this._ignoreNextBackspace = true;
		}
		else if (this.hasAccessibilitySupport()) {
			this._setCursorPosition(this._getLastCursorPosition());
		}
		if (!this.hasAccessibilitySupport()) {
			this._emptyArea();
		}
	},

	// Offset of (node, offset) in the coordinate space getPlainTextContent()
	// uses: characters, with the <img> spacers counting for nothing. That is
	// also the space _getSelection() and _setSelectionRange() work in.
	// Range.toString() concatenates the text nodes it spans and ignores
	// elements, exactly as textContent does, so the two agree by construction.
	// Returns undefined when the boundary is not inside the editable area --
	// e.g. a node detached by a handler that rewrote this element in between.
	_plainTextOffsetOf: function(node, offset) {
		if (!node || !this._textArea.contains(node))
			return undefined;
		try {
			var probe = document.createRange();
			probe.setStart(this._textArea, 0);
			probe.setEnd(node, offset);
			return probe.toString().length;
		} catch (err) {
			return undefined;
		}
	},

	// core deletes by CHARACTER: a surrogate pair goes in a single
	// <backspace>, while every browser offset in this file counts it as two
	// UTF-16 units. Iterating a string yields code points, which is the count
	// 'removetextcontext' wants. A11yTextInput._onInput open-codes the same
	// correction after the fact; here it is applied while counting.
	_coreDeleteCount: function(text) {
		return Array.from(text).length;
	},

	// Reads the target range off a phone autocorrect rewrite. Called at the
	// END of _onBeforeInput: getTargetRanges() is only populated during
	// beforeinput, and by the end of that handler its own repairs (which can
	// rewrite this element) have already run, so the text snapshot taken here
	// is the one the browser is about to mutate. See the autocorrect block in
	// _initLayout for why this exists.
	_captureReplacementRange: function(ev) {
		this._pendingReplacement = null;
		if (!window.vulcanPhoneChrome)
			return;
		if (!ev || ev.inputType !== 'insertReplacementText')
			return;
		if (this._isComposing)
			return; // a composing IME owns its own text; leave it alone
		if (typeof ev.getTargetRanges !== 'function')
			return;
		var ranges = ev.getTargetRanges();
		if (!ranges || ranges.length !== 1)
			return;
		var start = this._plainTextOffsetOf(ranges[0].startContainer, ranges[0].startOffset);
		var end = this._plainTextOffsetOf(ranges[0].endContainer, ranges[0].endOffset);
		if (typeof start !== 'number' || typeof end !== 'number' || start > end)
			return;
		this._pendingReplacement = {
			start: start,
			end: end,
			before: this.getPlainTextContent(),
			data: ev.data
		};
		this._fancyLog('replacement-range', this._pendingReplacement);
	},

	// Never silent. The generic differ still runs after this, and this line is
	// the only way to tell a fallback from a handled replacement in a log.
	_refuseReplacement: function(reason) {
		window.app.console.log('TextInput: insertReplacementText not applied over its ' +
			'target range (' + reason + '); falling back to the content differ');
		return false;
	},

	// Turns the captured range into the protocol core speaks -- delete N
	// characters before the caret, M after it, then insert a string at it --
	// and sends it. Returns true when the event was fully handled here.
	_applyReplacementRange: function(ev) {
		var pending = this._pendingReplacement;
		this._pendingReplacement = null;
		if (!ev || ev.inputType !== 'insertReplacementText')
			return false;
		if (!pending)
			return this._refuseReplacement('no usable target range from beforeinput');

		var pre = pending.before;
		var post = this.getPlainTextContent();
		var start = pending.start;
		var end = pending.end;
		var tail = pre.length - end;
		if (end > pre.length || post.length < start + tail)
			return this._refuseReplacement('range outside the pre-edit text');

		// The mutation has to be confined to [start, end). If anything outside
		// it moved, these offsets describe a different edit than the one that
		// landed, and turning them into a delete count is exactly how you eat
		// the neighbouring word.
		if (post.slice(0, start) !== pre.slice(0, start) ||
			(tail > 0 && post.slice(post.length - tail) !== pre.slice(end)))
			return this._refuseReplacement('edit not confined to the target range');

		// The replacement string comes from the DOM the browser actually
		// produced, not from ev.data -- see the autocorrect block in
		// _initLayout.
		var inserted = post.slice(start, post.length - tail);
		if (this._isDebugOn && typeof pending.data === 'string' && pending.data !== inserted)
			this._fancyLog('replacement-data-differs', { data: pending.data, dom: inserted });

		// Both offsets above are in editable-area coordinates. core's caret is
		// only in that same space while _lastContent still describes this
		// element, so prove that before using either.
		if (this.codePointsToString(this._lastContent) !== pre)
			return this._refuseReplacement('editable area and _lastContent disagree');
		var caret = this.hasAccessibilitySupport()
			? this._getLastCursorPosition()
			: this._lastContent.length;
		// typeof NaN is 'number': a NaN caret deletes nothing below and retypes
		// the whole correction ("I dont" -> "I dontdon't").
		if (typeof caret !== 'number' || !isFinite(caret) || caret < 0 || caret > pre.length)
			return this._refuseReplacement('no trustworthy caret');
		if (caret < start) {
			// Deleting forward and retyping would leave core's caret on the far
			// side of the retyped run, and this protocol has no way to put it
			// back. Not observed; refused rather than guessed at.
			return this._refuseReplacement('replacement lands after the caret');
		}
		if (this.hasAccessibilitySupport() && this._hasSelection && !this._isLastSelectionEmpty())
			return this._refuseReplacement('a real selection is live in core');

		// Delete from the range start to whichever of the range end / the
		// caret is further on, then retype the correction plus whatever was
		// between the corrected word and the caret (on iOS, the space that
		// committed it). The caret therefore lands where it already was.
		var deleteTo = Math.max(end, caret);
		var removeBefore = this._coreDeleteCount(pre.slice(start, caret));
		var removeAfter = this._coreDeleteCount(pre.slice(caret, deleteTo));
		var text = inserted + pre.slice(end, deleteTo);
		if (/[\n\r]/.test(text)) {
			// _sendText turns a line break into a key event and resets this
			// element underneath us, which would leave _lastContent
			// describing content that is no longer here.
			return this._refuseReplacement('replacement carries a line break');
		}

		if (removeBefore > 0 || removeAfter > 0) {
			if (this.hasAccessibilitySupport()) {
				// An empty selection in core swallows the first delete, which
				// would leave every count here one short.
				this._removeEmptySelectionIfAny();
				this._setSelectionFlag(false);
			}
			this._removeTextContent(removeBefore, removeAfter);
		}
		if (text.length > 0)
			this._sendText(text);

		this._lastContent = this.getValueAsCodePoints(post);
		if (this.hasAccessibilitySupport())
			this._setLastCursorPosition(start + text.length);

		// The replaced range can take a spacer <img> with it. Without them the
		// next input event reads a missing spacer as a backspace or a delete
		// and sends one.
		if (!this._hasPreSpace() || !this._hasPostSpace()) {
			if (this.hasAccessibilitySupport()) {
				if (!this._hasPreSpace())
					this._prependSpace();
				if (!this._hasPostSpace())
					this._appendSpace();
				this._updateCursorPosition(start + text.length);
			} else {
				this._emptyArea();
			}
		}

		this._fancyLog('replacement-applied',
			{ before: removeBefore, after: removeAfter, text: text });
		return true;
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
			this._emptyArea();
		}
		else if (this._isInitialContent() && this._isCursorAtBeginning()) {
			this._handleMisplacedCursorAtBeginning(ev);
		}
		// Firefox is not able to delete the <img> post space. Since no 'input' event is generated,
		// we need to handle a <delete> at the end of the paragraph, here.
		if (window.L.Browser.gecko && this._isCursorAtEnd() && this._deleteHint === 'delete') {
			if (this._map._debug.logKeyboardEvents) {
				window.app.console.log('Sending delete');
			}
			this._removeTextContent(0, 1);
			this._emptyArea();
		}
		// Last: the repairs above can rewrite this element, and the snapshot
		// taken here has to be the text the browser is about to mutate.
		this._captureReplacementRange(ev);
		this._statusLog('_onBeforeInput ]');
	},

	_isDigit: function(asciiChar) {
		return asciiChar >= 48 && asciiChar <= 57;
	},

	_hasFormulaBarFocus: function() {
		return 	this._map && this._map.formulabar && this._map.formulabar.hasFocus();
	},

	// Fired when text has been entered, *during* and after composing/spellchecking
	_onInput: function(ev) {
		if (this._map.uiManager.isUIBlocked())
			return;
		this._statusLog('_onInput [');
		app.idleHandler.notifyActive();

		// Typing dismisses the caret knob (Google's phone grammar). This is the
		// path a soft keyboard takes -- it raises 'input' with no usable
		// keydown -- so it cannot be left to _onKeyDown alone.
		CursorHandler.noteTextTyped();

		if (this._ignoreInputCount > 0) {
			window.app.console.log('ignoring synthetic input ' + this._ignoreInputCount);
			return;
		}

		// Real input after a commit-Return starts the next entry, so the
		// commit is no longer what core's next same-cell answer means.
		if (window.VulcanCalcReturnKey)
			window.VulcanCalcReturnKey.noteTyping();

		// A phone autocorrect rewrite arrives as insertReplacementText over a
		// range the differ below cannot see. Handled from the range captured
		// in _onBeforeInput, and handled here -- before _newlineHint, which
		// would otherwise swallow the correction that commits on <enter>.
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
			if (!ignoreBackspace)
				this._removeTextContent(1, 0);
			this._emptyArea();
			return;
		}
		if (!this._hasPostSpace()) { // missing trailing space.
			if (this._map._debug.logKeyboardEvents) {
				window.app.console.log('Sending delete');
			}
			this._removeTextContent(0, 1);
			this._emptyArea();
			return;
		}

		var value = this.getValue();
		var content = this.getValueAsCodePoints(value);
		// Note that content is an array of Unicode code points

		// In the android keyboard when you try to erase in an empty area
		// and then enter some character,
		// The first character will likely travel with the cursor,
		// And that is caused because after entering the first character
		// cursor position is never updated by keyboard (I know it is strange)
		// so here we manually correct the position
		if (window.mode.isSmallScreenDevice() && content.length === 1 && this._lastContent.length === 0)
			this._setCursorPosition(1);

		var matchTo = 0;
		var sharedLength = Math.min(content.length, this._lastContent.length);
		while (matchTo < sharedLength && content[matchTo] === this._lastContent[matchTo])
			matchTo++;

		if (this._map._debug.logKeyboardEvents) {
			window.app.console.log('Comparison matchAt ' + matchTo + '\n' +
				'\tnew "' + this.codePointsToString(content) + '" (' + content.length + ')' + '\n' +
				'\told "' + this.codePointsToString(this._lastContent) + '" (' + this._lastContent.length + ')');
		}

		var removeBefore = this._lastContent.length - matchTo;
		var removeAfter = 0;

		if (this._lastContent.length > content.length)
		{
			// Pressing '<space><delete>' can delete our terminal space
			// such that subsequent deletes will do nothing; need to
			// detect and reset in this case.
			if (this._deleteHint === 'delete')
			{
				removeBefore--;
				removeAfter++;
			}
		}

		if (removeBefore > 0 || removeAfter > 0)
			this._removeTextContent(removeBefore, removeAfter);

		var newText = content;
		if (matchTo > 0)
			newText = newText.slice(matchTo);

		this._lastContent = content;

		if (newText.length > 0) {
			this._sendNewText(ev, content, newText);
		}

		// was a 'delete' and we need to reset world.
		if (removeAfter > 0)
			this._emptyArea();

		// special handling for formula bar
		this._finishFormulabarEditing(content, matchTo);

		// special handling for mentions
		if (this._map.getDocType() === 'text') {
			const contentStr = this.codePointsToString(content);
			const newPara = contentStr.length === 1;
			this._map.mention.handleMentionInput(ev, newPara);
		}

		this._statusLog('_onInput ]');
	},

	_sendNewText: function (ev, content, newText) {
		// When the cell formatted as percent, to trig percentage sign addition
		// automatically we send the first digit character as KeyEvent.
		if (this._map.getDocType() === 'spreadsheet' &&
			content.length === 1 && ev.inputType === 'insertText' &&
			this._isDigit(newText) && window.mode.isDesktop()) {
			this._sendKeyEvent(newText, this._unoKeyMap[newText], 'input');
		}
		else {
			this._sendText(this.codePointsToString(newText));
		}
	},

	_finishFormulabarEditing: function(content, matchTo) {
		if (this._hasFormulaBarFocus() && content.length) {
			var contentString = this.codePointsToString(content);
			if (contentString[matchTo] === '\n' || contentString.charCodeAt(matchTo) === 13) {
				app.dispatcher.dispatch('acceptformula');
			}
		}
	},

	// Sends the given (UTF-8) string of text to coolwsd, as IME (text composition)
	// messages
	_sendText: function(text) {
		// this._logCharCodeSequence(text);
		this._fancyLog('send-text-to-coolwsd', text);

		// MSIE/Edge cannot compare a string to "\n" for whatever reason,
		// so compare charcode as well
		if (text === '\n' || (text.length === 1 && text.charCodeAt(0) === 13)) {
			this._sendNewlineEvent();
		} else {
			// The composition messages doesn't play well with line breaks inside
			// the composed word (e.g. word and a newline are queued client-side
			// and are sent together), therefore split and send keystrokes accordingly.

			var parts = text.split(/[\n\r]/);
			var l = parts.length;
			for (var i = 0; i < l; i++) {
				if (i !== 0) {
					this._sendKeyEvent(13, 1280);
					if (!this.hasAccessibilitySupport()) {
						this._emptyArea();
					}
				}
				if (parts[i].length > 0) {
					this._sendCompositionEvent(parts[i]);
				}
			}
		}
	},

	// Empties the textarea / contenteditable element.
	// If the browser supports the 'inputType' property on 'input' events, then
	// add empty spaces to the textarea / contenteditable, in order to
	// always catch deleteContentBackward/deleteContentForward input events
	// (some combination of browser + input method don't fire those on an
	// empty contenteditable).
	_emptyArea: function(noSelect) {
		this._statusLog('_emptyArea [');
		this._fancyLog('empty-area');

		this._ignoreInputCount++;
		// Note: 0xA0 is 160, which is the character code for non-breaking space:
		// https://www.fileformat.info/info/unicode/char/00a0/index.htm

		// Using normal spaces would make FFX/Gecko collapse them into an
		// empty string.
		// FIXME: is that true !? ...

		// window.app.console.log('Set old/lastContent to empty');
		this._lastContent = [];
		// The offsets in a stashed replacement range describe content that no
		// longer exists.
		this._pendingReplacement = null;
		if (this.hasAccessibilitySupport()) {
			this._setLastCursorPosition(0);
		}

		this.resetContent();

		// avoid setting the focus keyboard
		if (!noSelect && document.getElementById(this._textArea.id)) {
			this._setCursorPosition(0);
			if (this._hasWorkingSelectionStart === undefined)
				this._hasWorkingSelectionStart = (this._getSelectionStart() === 0);
		}

		this._fancyLog('empty-area-end');
		this._statusLog('_emptyArea ]');
		this._ignoreInputCount--;
	},

	_onCompositionStart: function(/*ev*/) {
		this._isComposing = true;
	},

	// Handled only in legacy situations ('input' events with an inputType
	// property are preferred).
	_onCompositionUpdate: function(ev) {
		app.idleHandler.notifyActive();
		this._onInput(ev);
	},

	// Chrome doesn't fire any "input/insertCompositionText" with "isComposing" set to false.
	// Instead , it fires non-standard "textInput" events, but those can be tricky
	// to handle since Chrome also fires "input/insertText" events.
	// The approach here is to use "compositionend" events *only in Chrome* to mark
	// the composing text as committed to the text area.
	_onCompositionEnd: function(ev) {
		app.idleHandler.notifyActive();
		this._isComposing = false;
		if (ev.data && ev.data.charCodeAt(ev.data.length-1) === 10) // 10 === charCode('\n')
			this._newlineHint = true;
		if (this.hasAccessibilitySupport()) {
			if (!this._isWrappedBySpan()) {
				this._restoreSpanWrapper();
			}
		}
		this._onInput(ev);
		if (this.hasAccessibilitySupport()) {
			this._updateFocusedParagraph();
		}
	},

	// Called when the user goes back to a word to spellcheck or replace it,
	// on a timeout.
	// Very difficult to handle right now, so the strategy is to panic and
	// empty the text area.
	_abortComposition: function(ev) {
		this._fancyLog('abort-composition', ev.type);
		// Vulcan: whatever the echo predicted around this is unknowable.
		if (app.definitions && app.definitions.vulcanImpressTextEcho)
			app.definitions.vulcanImpressTextEcho.onCompositionAborted();
		if (app.definitions && app.definitions.vulcanCalcTextEcho)
			app.definitions.vulcanCalcTextEcho.onCompositionAborted();
		if (this._isComposing)
			this._isComposing = false;
		if (this.hasAccessibilitySupport()) {
			this._isLeftRightArrow = 0;
			this._updateFocusedParagraph();
			this._requestFocusedParagraph();
		} else {
			this._emptyArea(document.activeElement !== this._textArea);
		}
	},

	_handleKeyDownForPopup: function (ev, id) {
		var popup = window.L.DomUtil.get(id);
		if (popup) {
			const entries = document.querySelectorAll('#' + id + ' span.ui-treeview-cell');
			if (ev.key === 'ArrowDown') {
				const initialFocusElement = entries[0];
				if (initialFocusElement) {
					initialFocusElement.tabIndex = 0;
					initialFocusElement.focus();
					ev.preventDefault();
					ev.stopPropagation();
				}
			} else if (ev.key === 'Enter' && entries.length === 1) {
					const event = new KeyboardEvent('keydown', {
						key: 'Enter',
						bubbles: true,
						cancelable: true,
					});
					entries[0].dispatchEvent(event);
					ev.preventDefault();
					ev.stopPropagation();
			} else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight' ||
				ev.key === 'ArrowUp' || ev.key === 'Home' ||
				ev.key === 'End' || ev.key === 'PageUp' ||
				ev.key === 'PageDown' || ev.key === 'Enter' ||
				ev.key === 'Escape' || ev.key === 'Control' ||
				ev.key === 'Tab') {

				if (id === 'mentionPopup')
					this._map.mention.closeMentionPopup(false);
				else if (id === 'formulaautocompletePopup')
					this._map.fire('closepopup');
			}
		}
		return popup;
	},

	_onKeyDown: function(ev) {
		if (this._map.uiManager.isUIBlocked())
			return;

		// Covers the keys that never raise 'input' -- arrows, backspace on some
		// keyboards -- which move the caret and so must dismiss its knob too.
		CursorHandler.noteTextTyped();

		this._a11yFocusTime = 0;

		if (ev.keyCode === 8)
			this._deleteHint = 'backspace';
		else if (ev.keyCode === 46)
			this._deleteHint = 'delete';
		else {
			this._deleteHint = '';
		}
		this._newlineHint = ev.keyCode === 13;
		this._linebreakHint = this._newlineHint && ev.shiftKey;

		// In Firefox 117 up to 120 no copy/cut input event is emitted when CTRL+C/X is pressed
		// with no selection in a text element with contenteditable='true'. Since no copy/cut event
		// is emitted, Clipboard.copy/cut is never invoked. So we need to emit it manually.
		// To be honest it seems a Firefox bug. We need to check if they fix it in later version.
		if (!this.hasAccessibilitySupport() && !window.L.Browser.win &&
			window.L.Browser.gecko && window.L.Browser.geckoVersion >= '117.0' && window.L.Browser.geckoVersion <= '120.0' &&
			ev.ctrlKey && window.getSelection().isCollapsed) {
			if (ev.key === 'c') {
				document.execCommand('copy');
			}
			else if (ev.key === 'x') {
				document.execCommand('cut');
			}
		}

		if (this.hasAccessibilitySupport()) {
			if ((this._hasAnySelection && !this._isEditingInSelection && this._map.getDocType() !== 'spreadsheet') ||
				(!this._hasAnySelection && this._map.getDocType() === 'presentation')) {
				if (!window.L.Browser.cypressTest) {
					var allowedKeyEvent =
						this._map.keyboard.allowedKeyCodeWhenNotEditing[ev.keyCode] ||
						ev.ctrlKey ||
						ev.altKey ||
						(this._newlineHint && ev.shiftKey);
					if (!allowedKeyEvent) {
						window.console.log('TextInput._onKeyDown: any input default prevented since no shape editing is active.');
						ev.preventDefault();
					}
				}
			}
			// In order to allow screen reader to track caret navigation properly even if there is some connection delay
			// default behaviour for Left/Right arrow key press is no more prevented in Map.Keyboard._handleKeyEvent,
			// Here we set _isLeftRightArrow flag and handle some special cases.
			else {
				this._isLeftRightArrow = 0;
				if (ev.key === 'ArrowLeft') {
					this._isLeftRightArrow = -1;
				} else if (ev.key === 'ArrowRight') {
					this._isLeftRightArrow = 1;
				}

				// If we are at paragraph begin/end and left/right arrow is pressed, we need to prevent default behaviour
				if (this._isLeftRightArrow) {
					clearTimeout(this._onNavigationEndTimeout);
					if (!this._isSelectionValid() || this._isComposing ||
						(this._isLeftRightArrow > 0 && this._isCursorAtEnd()) ||
						(this._isLeftRightArrow < 0 && this._isCursorAtStart())) {
						this._log('_onKeyDown: preventDefault');
						ev.preventDefault();
					}
				}

				if (this._isLeftRightArrow) {
					if (this._listPrefixLength > 0) {
						var cursorPosition = this._getSelectionEnd();
						if (cursorPosition === this._listPrefixLength && this._isLeftRightArrow < 0) {
							// if caret is at begin of list entry content: "1. |Item 1" and shift+left arrow is pressed,
							// then caret is moved at the end of previous paragraph, if any; or it's not moved at all
							// if we are at the document beginning; so we only need to prevent default behaviour
							ev.preventDefault();
							if (!ev.shiftKey) {
								// when shift is not pressed, caret is moved ahead of list prefix: "|1. Item 1",
								// selection is cleared, if any
								this._updateCursorPosition(0);
							}
						}
						// if caret is ahead of list prefix: "|1. Item 1" and right arrow is pressed, with or without shift,
						// caret is moved at begin of list entry content: "1. |Item 1", nothing is selected
						if (cursorPosition === 0 && this._isLeftRightArrow > 0) {
							ev.preventDefault();
							this._updateCursorPosition(this._listPrefixLength);
						}
					}

					// When left/right arrow is pressed and text is selected, selection is cleared
					// and caret needs to be moved by one char left/right.
					// However, for an editable div the behaviour is different:
					// - when left arrow is pressed caret moves at start of previously selected text
					// - when right arrow is pressed caret moves at end of previously selected text
					// So we need to prevent default behaviour and simulate the same behaviour that occurs in the engine.
					if (!ev.shiftKey) {
						var selection = window.getSelection();
						if (!selection.isCollapsed) {
							// The case where a left arrow is pressed with caret at the beginning of a list entry content
							// is already handled earlier.
							if (!(this._listPrefixLength > 0 &&
								this._lastCursorPosition === this._listPrefixLength && this._isLeftRightArrow < 0)) {
								this._log('_onKeyDown: pressed left/right arrows with selected text');
								ev.preventDefault();
								var pos = this._lastCursorPosition + this._isLeftRightArrow;
								// _updateCursorPosition takes care to normalize pos value
								this._updateCursorPosition(pos);
							}
						}
					}
				}
			}
		}

		// We want to open drowdown menu when cursor is above a dropdown content control.
		if (ev.code === 'Space' || ev.code === 'Enter') {
			if (this._map['stateChangeHandler'].getItemValue('.uno:ContentControlProperties') === 'enabled') {
				if (app.sectionContainer.doesSectionExist(app.CSections.ContentControl.name)) {
					var section = app.sectionContainer.getSectionWithName(app.CSections.ContentControl.name);
					if (section.sectionProperties.dropdownSection)
						section.sectionProperties.dropdownSection.onClick(null, ev);
				}
			}
		}

		if (ev.altKey && ev.code === 'KeyC') {
			// We want to focus on the comment menu if a comment is currently shown in Writer or Calc.
			// This is the key combination (Alt+C or Alt+Shift+C) for focusing on the comment menu.

			// On Calc, first press opens the comment, second press focuses on it.
			section = app.sectionContainer.getSectionWithName(app.CSections.CommentList.name);
			if (section) {
				if (section.sectionProperties.selectedComment) {
					var id = section.sectionProperties.selectedComment.sectionProperties.menu.id;
					var element = document.getElementById(id);
					if (element)
						element.focus();
				}
				else if (this._map._docLayer._docType === 'spreadsheet') {
					if (section.sectionProperties.calcCurrentComment !== null)
						section.sectionProperties.calcCurrentComment.show();
				}
			}
		}

		this._handleKeyDownForPopup(ev, 'mentionPopup');
		this._handleKeyDownForPopup(ev, 'formulaautocompletePopup');
	},

	// Check arrow keys on 'keyup' event; using 'ArrowLeft' or 'ArrowRight'
	// shall empty the textarea, to prevent FFX/Gecko from ever not having
	// whitespace around the caret.
	// Across browsers, arrow up/down / home / end would move the caret to
	// the beginning/end of the textarea/contenteditable.
	_onKeyUp: function(ev) {
		if (this._map.uiManager.isUIBlocked())
			return;

		app.idleHandler.notifyActive();
		if (!this.hasAccessibilitySupport() && !this._isComposing &&
			(ev.key === 'ArrowLeft' || ev.key === 'ArrowRight' ||
			ev.key === 'ArrowUp' || ev.key === 'ArrowDown' ||
			ev.key === 'Home' || ev.key === 'End' ||
			ev.key === 'PageUp' || ev.key === 'PageDown' ||
			ev.key === 'Escape')) {
			this._emptyArea();
		}

		if (this.hasAccessibilitySupport()) {
			if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
				clearTimeout(this._onNavigationEndTimeout);
				this._onNavigationEndTimeout = setTimeout(function () {
					if (this._isLeftRightArrow) {
						this._isLeftRightArrow = 0;
						this._updateFocusedParagraph();
					}
				}.bind(this), 1000);
			}
			else if (ev.key === 'Shift') {
				if (this._isLeftRightArrow/* && this._remotePosition !== undefined*/) {
					this._isLeftRightArrow = 0;
					this._updateFocusedParagraph();
				}
			}
		}
	},

	// Used in the deleteContentBackward for deleting multiple characters with a single
	// message.
	// Will remove characters from the queue first, if there are any.
	_removeTextContent: function(before, after) {
		if (this._map._debug.logKeyboardEvents) {
			window.app.console.log('Remove ' + before + ' before, and ' + after + ' after');
		}

		this._followMyCursor();

		const windowId = app.map._docLayer._formID !== null ? app.map._docLayer._formID : this._map.getWinId();

		/// TODO: rename the event to 'removetextcontent' as soon as coolwsd supports it
		/// TODO: Ask Marco about it
		app.socket.sendMessage(
			'removetextcontext id=' + windowId +
			' before=' + before +
			' after=' + after
		);
		// Vulcan: speculative text echo observes every mutating send,
		// AFTER the socket write (see _sendKeyEvent).
		if (app.definitions && app.definitions.vulcanImpressTextEcho)
			app.definitions.vulcanImpressTextEcho.onDelete(before, after);
		if (app.definitions && app.definitions.vulcanCalcTextEcho)
			app.definitions.vulcanCalcTextEcho.onDelete(before, after);
	},

	_followMyCursor: function() {
		if (this._map && this._map.userList)
		this._map.userList.followUser(this._map._docLayer._getViewId());
	},

	// Tiny helper - encapsulates sending a 'textinput' websocket message.
	// sends a pair of "input" for a composition update pair with an "end"
	_sendCompositionEvent: function(text) {
		// this._logCharCodeSequence(text);

		// We want to trigger auto-correction, but not if we may
		// have to delete a count of characters in the future,
		// which is specific to crazy mobile keyboard / IMEs:
		if (!window.mode.isSmallScreenDevice() && !window.mode.isTablet() &&
			this._autoCorrectChars[text])
		{
			let codes;

			if (app.calc.decimalSeparator && this._map.numPadDecimalPressed) { // decimalSeparator is set only for Calc.
				this._map.numPadDecimalPressed = false;
				codes = this._autoCorrectChars[app.calc.decimalSeparator];
			}
			else codes = this._autoCorrectChars[text];

			this._sendKeyEvent(codes[0], codes[1], 'input');
			this._sendKeyEvent(codes[2], codes[3], 'up');
		}
		else
		{
			var encodedText = encodeURIComponent(text);
			var winId = this._map.getWinId();
			this._followMyCursor();
			app.socket.sendMessage(
				'textinput id=' + winId + ' text=' + encodedText);
			// Vulcan: speculative text echo observes every mutating send,
			// AFTER the socket write (see _sendKeyEvent).
			if (app.definitions && app.definitions.vulcanImpressTextEcho)
				app.definitions.vulcanImpressTextEcho.onInsert(text);
			if (app.definitions && app.definitions.vulcanCalcTextEcho)
				app.definitions.vulcanCalcTextEcho.onInsert(text);
		}
	},

	// Tiny helper - encapsulates sending a 'key' or 'windowkey' websocket message
	// "type" can be "input" (default) or "up"
	_sendKeyEvent: function(charCode, unoKeyCode, type) {
		this._followMyCursor();
		if (!type) {
			type = 'input';
		}
		if (this._map.editorHasFocus() || this._hasFormulaBarFocus()) {
			app.socket.sendMessage(
				'key type=' + type + ' char=' + charCode + ' key=' + unoKeyCode + '\n'
			);
		} else {
			app.socket.sendMessage(
				'windowkey id=' +
				this._map.getWinId() +
				' type=' +
				type +
				' char=' +
				charCode +
				' key=' +
				unoKeyCode +
				'\n'
			);
		}
		// Vulcan: speculative text echo observes every mutating send.
		// AFTER the socket write: the hook can trigger a primitives fetch,
		// and a fetch tagged with this input's seq must never precede the
		// input itself on the wire.
		if (app.definitions && app.definitions.vulcanImpressTextEcho)
			app.definitions.vulcanImpressTextEcho.onKey(charCode, type);
		// Calc echoes (cell text and cell cursor) see the same sends. The
		// cursor echo first: whether a key moves the cell depends on the
		// edit as it was before the key (the text echo ends its session on
		// a commit key).
		if (app.definitions && app.definitions.vulcanCalcCursorEcho)
			app.definitions.vulcanCalcCursorEcho.onKey(charCode, unoKeyCode, type);
		if (app.definitions && app.definitions.vulcanCalcTextEcho)
			app.definitions.vulcanCalcTextEcho.onKey(charCode, unoKeyCode, type);
	},

	_sendNewlineEvent: function() {
		// The composition messages doesn't play well with just a line break,
		// therefore send a keystroke.
		var unoKeyCode = this._linebreakHint ? 5376 : 1280;
		// Phone Calc's in-cell edit mode turns Return into the cell's OWN
		// newline (Ctrl+Enter to core) instead of commit-and-advance — the
		// Google Sheets split. Quick entry never opens the latch, so the
		// data-entry Return keeps advancing. See VulcanCalcReturnKey.ts.
		// A Return that commits is noted, so a same-cell cellcursor answering
		// it ends the edit instead of reading as the editor growing.
		if (window.VulcanCalcReturnKey &&
		    window.VulcanCalcReturnKey.returnInsertsNewline())
			unoKeyCode = window.VulcanCalcReturnKey.newlineUnoKeyCode();
		else if (window.VulcanCalcReturnKey)
			window.VulcanCalcReturnKey.noteCommitReturn();
		this._sendKeyEvent(13, unoKeyCode);
		this._newlineHint = false;
		if (this.hasAccessibilitySupport()) {
			var pos = this._getLastCursorPosition();
			var empty = this._lastContent.length === 0;
		}
		this._emptyArea();
		if (this.hasAccessibilitySupport()) {
			this._setSelectionFlag(false);
			if (pos === 0 && !empty)
				this._requestFocusedParagraph();
		}
	},

	_onCursorHandlerDragEnd: function(ev) {
		var cursorPos = this._map._docLayer._internToTwips(ev.target.getIntern());
		this._map._docLayer._postMouseEvent('buttondown', cursorPos.x, cursorPos.y, 1, 1, 0);
		this._map._docLayer._postMouseEvent('buttonup', cursorPos.x, cursorPos.y, 1, 1, 0);
	},

	_setCursorPosition: function(pos) {
		try {
			this._setSelectionRange(pos, pos);
		} catch (err) {
			// old firefox throws an exception on start.
		}
	},

	setSwitchedToEditMode: function() {
		if (this.hasAccessibilitySupport()) {
			this._justSwitchedToEditMode = true;
		}
	},

	// VULCAN: the full keyboard-session boundary for the phone Calc plane
	// (see _setAcceptInput): the next edit starts undecided, unpinned and on
	// the full layout. Also run by vulcanHoldQuickEntry, whose edit ends with
	// the keyboard kept and so never reaches a _setAcceptInput boundary.
	_vulcanResetCellEditPlane: function(sessionKey) {
		this._vulcanCellEditPlaneKey = sessionKey;
		this._vulcanCellEditTyped = false;
		// Round 8: the chip's pin is session-scoped like the plane it
		// pins. A pin that outlived its session would leave the next
		// cell's automatic decision permanently disarmed.
		this._vulcanCellEditPlanePinned = false;
		this._textArea.removeAttribute('inputmode');
		this._vulcanApplySuggestionPolicy();
		// VULCAN round 8 (C5, completed): this boundary is the THIRD site
		// that moves the plane, so it announces like the other two.
		// Silent, it stranded the chip on the PREVIOUS session's label --
		// pick the keypad in A1, commit, edit B1, and the chip still reads
		// 'Aa' and still announces the letter keyboard while a tap goes to
		// the keypad. Empty content is also correct here: the next cell
		// must not open on the last one's function face.
		if (this._vulcanCellEditInputModeActive() &&
			typeof this._map.fire === 'function')
			this._map.fire('vulcancalcplane', {
				keypad: false,
				category: this._vulcanCellNumberFormatCategory(),
				content: '',
				typed: false,
				pinned: false
			});
	},

	_setAcceptInput: function(accept) {
		// VULCAN: a keyboard-session boundary for the phone Calc inputmode
		// (see _vulcanUpdateCellEditInputMode): every flip that is not the
		// same live cell edit (_vulcanCellEditSessionKey) starts the next
		// session undecided and on the full layout, so a previous cell's
		// plane can never leak into a new edit. The same boundary re-stamps
		// the G12 suggestion-row policy, so every keyboard raise starts
		// policy-correct for the current doctype and orientation.
		//
		// The END of a live edit is a boundary even when the latch does not
		// flip. The same-edit rule below lets the pad swap leave the latch
		// false with the plane kept (the resize pass ends in
		// setAcceptInput(false)), and so does a Back/hide-key IME drop,
		// which leaves the editable focused on Android. The ✓/✕ exit then
		// arrives as a second false (vulcanEndCellEditSession -> caret and
		// live-edit class cleared -> dismissSoftKeyboard), not a flip; if it
		// did nothing, inputmode=tel and the pin would outlive the edit, and
		// the next door's _textArea.focus() on a text cell would raise the
		// numeric pad before its own flip could reset it. A plane decided
		// in a live edit (a string key) whose edit is gone resets here.
		var vulcanEditEnded = !!this._textArea && accept === false &&
			this._acceptInput === false &&
			typeof this._vulcanCellEditPlaneKey === 'string' &&
			this._vulcanCellEditSessionKey() === null;
		if (this._textArea && (accept !== this._acceptInput || vulcanEditEnded)) {
			// A flip inside the SAME live cell edit is not a boundary. On
			// redroid/Gboard the 123 chip's own pad swap (visualViewport
			// 367 -> 407) flips the latch true then false through the resize
			// pass; resetting there undid the chip every time. Same part and
			// cell, edit live, editable still focused: keep the plane, the
			// pin and the typed flag, and only re-stamp the policy. Any
			// other flip -- another cell, the edit gone, focus lost, or no
			// plane decided in a live edit -- is the full boundary below, in
			// BOTH directions: the trace rests the latch false, so on
			// Android the flip into the next cell's edit is false -> true.
			// The ended-edit call above reads a null key and lands there too.
			var sessionKey = this._vulcanCellEditInputModeActive() ?
				this._vulcanCellEditSessionKey() : null;
			if (sessionKey !== null &&
				sessionKey === this._vulcanCellEditPlaneKey &&
				this.hasFocus()) {
				this._vulcanApplySuggestionPolicy();
			} else {
				this._vulcanResetCellEditPlane(sessionKey);
			}
		}
		if (window.L.Browser.cypressTest && this._textArea) {
			// This is used to track whether we *intended*
			// the keyboard to be visible or hidden.
			// There is no way track the keyboard state
			// programmatically, so the next best thing
			// is to track what we intended to do.
			this._textArea.setAttribute('data-accept-input', accept);
		}
		if (!this.hasAccessibilitySupport()) {
			this._acceptInput = accept;
		}
		else if (this._acceptInput !== accept) {
			this._acceptInput = accept;
			if (this._justSwitchedToEditMode && accept && this._isInitialContent()) {
				// We need to make the paragraph at the cursor position focused in core
				// so its content is sent to the editable area.
				this._justSwitchedToEditMode = false;
				if (this._map._docLayer && app.file.textCursor.visible) {
					/*
					 * VULCAN: THE PARAGRAPH-FOCUS CLICK COLLAPSES A LIVE SELECTION.
					 *
					 * The click below is a count 1 LEFT click at the caret, and while a
					 * selection is live the caret sits at that selection's END — so on
					 * the phone's read -> edit flip it means, exactly, "throw away what
					 * the reader just selected". MEASURED on slot-02 build #10: a
					 * long press plus an end-handle drag gave core a 3-rectangle
					 * multi-paragraph selection, the pencil then sent
					 * `setviewreadonly value=false` and this pair, and core answered
					 * with an EMPTY `textselection:`. Google's phone Docs carries the
					 * wash across that flip and applies the next format action to it;
					 * ours could not, which is most of why selecting on a phone felt
					 * like it did not work.
					 *
					 * SUPPRESSING THE CLICK IS THE WRONG FIX. It is not stray — it is
					 * how core is told to focus the paragraph so its content reaches
					 * the accessible editable area, and dropping it would trade a
					 * visible defect for a silent one on exactly the users least able
					 * to report it. So the click still goes, and the two edges are
					 * captured BEFORE it and re-posted after: core does the paragraph
					 * focus, then puts the selection back.
					 *
					 * ORDER IS GUARANTEED, not hoped for. All three frames leave on the
					 * one socket and wsd forwards them to the kit's single queue, so
					 * the click is always processed before the re-issue. Capturing
					 * before rather than reading back after matters for the same
					 * reason: the click has already emptied the client's copy by the
					 * time core's reply lands.
					 *
					 * Re-posting a START edge and then an END edge to rebuild a
					 * selection is the shipped idiom, not a new wire trick —
					 * TableSelectMarkerSection has posted that same pair since
					 * upstream. The x is the edge rectangle's x1 and the y its BOTTOM,
					 * which is the anchor TextSelections.updateMarkers puts the
					 * teardrops on and the y TextSelectionHandle.postSelectionEdge
					 * sends, so a carried selection and a dragged one describe their
					 * edges identically.
					 *
					 * The typeof guard is not padding: this file is concatenated ahead
					 * of nothing in particular, and a bundle that ever drops
					 * TextSelectionMiddleware must lose the carry, not throw inside
					 * the a11y path. A null carry reproduces the previous behaviour
					 * byte for byte, which is also what substituting `null` here does.
					 */
					var vulcanCarry = null;
					if (typeof TextSelections !== 'undefined' && TextSelections.isActive()) {
						var vulcanStart = TextSelections.getStartRectangle();
						var vulcanEnd = TextSelections.getEndRectangle();
						if (vulcanStart && vulcanEnd)
							vulcanCarry = {
								startX: vulcanStart.x1, startY: vulcanStart.y2,
								endX: vulcanEnd.x1, endY: vulcanEnd.y2,
							};
					}

					window.app.console.log('A11yTextInput._setAcceptInput: going to emit a synthetic click after switching to edit mode.');
					let center = app.file.textCursor.rectangle.center;
					center[0] = Math.round(center[0]);
					center[1] = Math.round(center[1]);
					this._map._docLayer._postMouseEvent('buttondown', center[0], center[1], 1, 1, 0);
					this._map._docLayer._postMouseEvent('buttonup', center[0], center[1], 1, 1, 0);

					if (vulcanCarry) {
						this._map._docLayer._postSelectTextEvent('start', vulcanCarry.startX, vulcanCarry.startY);
						this._map._docLayer._postSelectTextEvent('end', vulcanCarry.endX, vulcanCarry.endY);
					}
				}
			}
		}
	},

	_hasPreSpace: function() {
		var child = this._textArea.firstChild;
		return child && child.id === 'pre-space';
	},

	_hasPostSpace: function() {
		var child = this._textArea.lastChild;
		return child && child.id === 'post-space';
	},

	_isInitialContent: function() {
		var children = this._textArea.childNodes;
		return children.length === 2 && this._hasPreSpace() && this._hasPostSpace();
	},

	_isCursorAtBeginning: function() {
		var selection = window.getSelection();
		return selection.isCollapsed && this._getSelectionStart() === -1;
	},

	_isSelectionValid: function() {
		return typeof this._getSelectionStart() === 'number' && typeof this._getSelectionEnd() === 'number';
	},

	_isCursorAtStart: function() {
		var selection = window.getSelection();
		return selection.isCollapsed && this._getSelectionStart() === 0;
	},

	_isCursorAtEnd: function() {
		var selection = window.getSelection();
		return selection.isCollapsed && this._getSelectionEnd() === this.getPlainTextContent().length;
	},

	// When the cursor is on a text node return the position wrt. the whole plain text content
	// When the cursor is on a pre- / post-space node return -1 / -2
	// Otherwise return undefined
	_getSelection: function(isStart) {
		var selection = window.getSelection();
		var node, offset;
		if (isStart) {
			node = selection.anchorNode;
			offset = selection.anchorOffset;
		} else {
			node = selection.focusNode;
			offset = selection.focusOffset;
		}

		if (!node)
			return;
		if (node.id === 'pre-space')      // cursor position: <div><img>|</img> ... <img></img></div>
			return -1;
		if (node.id === 'post-space')     // cursor position: <div><img></img> ... <img>|</img></div>
			return -2;
		if (node.id === this._textArea.id) {
			if (this._hasPreSpace()) {
				if (offset === 0)         // cursor position: <div>|<img></img> ... <img></img></div>
					return -1;
				else if (offset === 1)    // cursor position: <div><img></img>| ... <img></img></div>
					return 0;
			} else if (this._hasPostSpace()) {
				if (offset === node.childNodes.length)    // cursor position: <div><img></img> ... <img></img>|</div>
					return -2;
			}
		}
		if (node.nodeType !== Node.TEXT_NODE)
			return;

		var walker = document.createTreeWalker(this._textArea, NodeFilter.SHOW_TEXT);
		var currentNode = walker.nextNode();
		var pos = 0;
		while (currentNode) {
			if (currentNode === node) {
				return pos + offset;
			}
			pos += currentNode.textContent.length;
			currentNode = walker.nextNode();
		}
	},

	_getSelectionStart: function() {
		return this._getSelection(true);
	},

	_getSelectionEnd: function() {
		return this._getSelection(false);
	},

	// set the selection range
	// start/end refer to the string represented by the whole plain text content
	// it's not possible to set range start/end position at <img> delimiters
	_setSelectionRange: function(start, end) {
		/*
		 * VULCAN: A SELECTION WRITE IS A FOCUS ACQUISITION. Both WebKit and
		 * Chromium move DOM focus onto the editable host when a script
		 * places the document selection inside it, and on iOS that focus IS
		 * the soft keyboard. Phone Calc's a11y cell sync rides exactly this:
		 * every cell-selection change (document open included -- phone
		 * chrome forces a11ystate on) delivers a11yfocusedcellchanged, whose
		 * onAccessibilityFocusedCellChanged has no hasFocus gate, and its
		 * content sync lands here -- measured on slot-01: after a bare
		 * select-tap the editable regains DOM focus with zero focus() calls
		 * traced, and this write is the only mechanism left.
		 *
		 * So, on phone Calc, defer the write while the editable does not
		 * hold focus. Nothing is lost: every a11y caller records the range
		 * in _lastSelectionStart/_lastSelectionEnd BEFORE calling
		 * (_updateSelection, _updateCursorPosition), and the focus handler
		 * already restores from exactly those on arrival (_onFocusBlur's
		 * `_setSelectionRange(this._lastSelectionStart, ...)` branch, which
		 * runs focused and passes this gate). _emptyArea's noSelect
		 * parameter -- "avoid setting the focus keyboard" -- is this same
		 * discipline, applied by callers; the a11y sync paths never got it.
		 * VoiceOver keeps its content (setHTML) and its live-region table
		 * announcements untouched; only the selection is deferred, and only
		 * until the editable is focused, which under VoiceOver it is
		 * whenever VoiceOver is reading it. Substituting `false` for the
		 * guard recovers the previous behaviour byte for byte.
		 */
		if (this._vulcanCellEditInputModeActive() && !this.hasFocus())
			return;
		this._statusLog('_setSelectionRange [');
		var selection = window.getSelection();
		selection.removeAllRanges();
		var range = document.createRange();

		// at the beginning we have no text node, so set cursor between <img> delimiters
		if (this._isInitialContent()) {
			range.setStart(this._textArea, 1);
			range.setEnd(this._textArea, 1);
			selection.addRange(range);
			this._statusLog('_setSelectionRange ]');
			return;
		}

		// Normalize input parameters
		var l = this.getPlainTextContent().length;
		if (start < 0)
			start = 0;
		if (end < 0)
			end = 0;
		if (start > l)
			start = l;
		if (end > l)
			end = l;
		if (start > end) {
			var t = start;
			start = end;
			end = t;
		}
		var msg = '_setSelectionRange:\n' +
			'    start: ' + start + ', end: ' + end +'\n';

		var startContainer = null;
		var walker = document.createTreeWalker(this._textArea, NodeFilter.SHOW_TEXT);
		var currentNode = walker.nextNode(); // first text node in <div>
		var pos = 0;
		// walker iterates over text nodes only
		while (currentNode) {
			msg += '    current node: ' + currentNode + ', text content: "' + currentNode.textContent + '"\n';
			var len = currentNode.textContent.length;
			msg += '    pos: ' + pos + ', len: ' + len +'\n';
			if (!startContainer && start <= pos + len) {
				startContainer = currentNode;
				range.setStart(currentNode, start - pos);
				msg += '    current node set as start: offset: ' + (start - pos) + '\n';
			}
			// The range end is set only after the range start has been set.
			if (startContainer && end <= pos + len) {
				range.setEnd(currentNode, end - pos);
				msg += '    current node set as end:   offset: ' + (end - pos) + '\n';
				break;
			}
			pos += len;
			currentNode = walker.nextNode();
		}

		// Get the selection object and add the range to it
		selection.addRange(range);
		window.console.log(msg);
		this._statusLog('_setSelectionRange ]');
	},

	_logCharCodeSequence: function(text) {
		var s = '[';
		for (var ii = 0; ii < text.length; ++ii) {
			if (ii > 0)
				s = s + ',';
			s = s + '0x' + text.charCodeAt(ii).toString(16);
		}
		s = s + ']';
		window.app.console.log('L.' + this._className + '._sendText: ' + s);
	},

	_log: function(msg) {
		if (!this._isDebugOn)
			return;
		window.app.console.log(msg);
	},

	_statusLog: function(header) {
		if (!this._isDebugOn)
			return;

		var msg = this._className + ' ' + header + '\n';
		msg += '  _lastContent: ' + this._lastContent  +'\n';
		msg += '  _lastContent: >' + this.codePointsToString(this._lastContent) + '<\n';
		if (this.hasAccessibilitySupport()) {
			msg += '  _remotePosition: ' + this._remotePosition + '\n';
			msg += '  _lastCursorPosition: ' + this._getLastCursorPosition() + '\n';
			msg += '  _lastSelectionStart: ' + this._lastSelectionStart + '\n';
			msg += '  _lastSelectionEnd: ' + this._lastSelectionEnd + '\n';
			msg += '  _hasSelection: ' + this._hasSelection + '\n';
		}
		msg += '  SelectionStart: ' + this._getSelectionStart() + '\n';
		msg += '  SelectionEnd: ' + this._getSelectionEnd() + '\n';
		msg += '  active element: ' + document.activeElement +'\n';
		msg += '  _isComposing: ' + this._isComposing + '\n';
		var textArea = this._textArea;
		msg += '  editable element: ' + '\n';
		msg += '    innerHTML: >' +  textArea.innerHTML + '<\n';
		msg += '    innerText: >' +  textArea.innerText + '<\n';
		msg += '    textContent: >' +  textArea.textContent + '<\n';
		msg += '    has focus: ' + (textArea === document.activeElement) + '\n';
		msg += '    has pre space: ' + this._hasPreSpace() + '\n';
		msg += '    has post space: ' + this._hasPostSpace() + '\n';

		var children = textArea.childNodes;
		for (var i = 0; i < children.length; ++i) {
			var child = children[i];
			msg += '    child: ' + child + '\n';
			if (child) {
				msg += '      name: ' + child.nodeName + '\n';
				msg += '      textContent: >' + child.textContent + '<\n';
			}
		}

		var selection = window.getSelection();
		msg += '  selection: \n';
		msg += '    content: >' + selection.toString() + '<\n';
		msg += '    range count: ' + selection.rangeCount + '\n';
		msg += '    anchorNode: ' + selection.anchorNode + '\n';
		if (selection.anchorNode) {
			msg += '      name: ' + selection.anchorNode.nodeName + '\n';
			msg += '      textContent: >' + selection.anchorNode.textContent + '<\n';
			for (i = 0; i < children.length; ++i) {
				if (children[i] === selection.anchorNode) {
					msg += '      equal to child: ' + i + '\n';
				} else if (children[i].contains(selection.anchorNode)) {
					msg += '      contained in child: ' + i + '\n';
				}
			}
		}
		msg += '    focusNode: ' + selection.focusNode + '\n';
		if (selection.focusNode) {
			msg += '      name: ' + selection.focusNode.nodeName + '\n';
			msg += '      textContent: >' + selection.focusNode.textContent + '<\n';
			for (i = 0; i < children.length; ++i) {
				if (children[i] === selection.focusNode) {
					msg += '      equal to child: ' + i + '\n';
				} else if (children[i].contains(selection.focusNode)) {
					msg += '      contained in child: ' + i + '\n';
				}
			}
		}
		msg += '    editable element contains anchorNode: ' + textArea.contains(selection.anchorNode) + '\n';
		msg += '    anchorNode == focusNode ? ' + (selection.anchorNode === selection.focusNode) + '\n';
		msg += '    anchorOffset: ' + selection.anchorOffset + '\n';
		msg += '    focusOffset: ' + selection.focusOffset + '\n';
		msg += '    is collapsed: ' + selection.isCollapsed + '\n';

		window.app.console.log(msg);
	},

	onAccessibilityCaretChange: function () {
		window.app.console.warn('invalid call: ' + (new Error()).stack);
	},

	onAccessibilityTextSelectionChanged: function () {
		window.app.console.warn('invalid call: ' + (new Error()).stack);
	},

	onAccessibilityFocusedCellChanged: function () {
		window.app.console.warn('invalid call: ' + (new Error()).stack);
	},

	onAccessibilityEditingInSelectionState: function () {
		window.app.console.warn('invalid call: ' + (new Error()).stack);
	},

	onAccessibilitySelectionChanged: function () {
		window.app.console.warn('invalid call: ' + (new Error()).stack);
	},

	setA11yFocusedParagraph: function () {
		window.app.console.warn('invalid call: ' + (new Error()).stack);
	},

	setA11yCaretPosition: function () {
		window.app.console.warn('invalid call: ' + (new Error()).stack);
	}
});

window.L.textInput = function() {
	return new window.L.TextInput();
};
