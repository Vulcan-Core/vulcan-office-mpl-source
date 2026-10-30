/* -*- js-indent-level: 8 -*- */
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
 * window.L.Control.MobileWizardWindow - contains one unique window instance inside mobile-wizard
 */

/* global app $ _ */
window.L.Control.MobileWizardWindow = window.L.Control.extend({
	options: {
		maxHeight: '45vh',
		snackbarTimeout: 6000
	},

	// TODO: review if used and move to initialize with description
	_builder: null,
	_inMainMenu: true,
	_isActive: false,
	_inBuilding: false,
	_currentDepth: 0,
	_mainTitle: '',
	_customTitle: false,
	_isTabMode: false,
	_currentPath: [],
	_currentScrollPosition: 0,

	initialize: function (mobileWizard, id) {
		window.L.setOptions(this, this.options);
		this.id = id; // unique id of this window "mobile-wizard-content-N"
		this.parent = mobileWizard; // reference to the parent mobile-wizard
		this.tabs = null; // tabs we can later restore if dialog was hidden
		this.isVisible = false; // indicates if this window is currently visible inside mobile-wizard
		this.isPopup = false; // indicates that current window is a popup, uses different look
		this.isSnackBar = false; // shows as little popup at the bottom
		this.isBusyPopUp = false; // show a busy popup
		this.isFunctionMenu = false; // shows full screen with list of calc functions
		this.isHamburgerMenu = false; // shows full screen with items from menubar
		this.isShapesWizard = false; // shows full screen shape type selector
		this.vulcanBottomSheetGesture = null;
		this.vulcanDraggableBottomSheetEnabled = false;
		this.vulcanCommentSheet = null;
		this.isVulcanCommentSheet = false; // the phone Calc comment surface: a strip until asked (13-CALC.12)
		this.isVulcanPhonePopupSheet = false; // a cancellable phone modal, rendered as a bottom sheet with its own close control
		this.isVulcanDocumentAreaPopup = false; // Calc autofilter / validity list: anchored to the grid, must not blank it
		this.isVulcanFormatASheet = false; // the docked VulcanMobileFormat sheet: content-height, capped (vulcan-theme.css 13.5b)
		this.vulcanPhonePopupHeader = null;
		this._vulcanInPlacePanelPop = null; // a panel flipped over this window's own content: a LAYER (see vulcanSetInPlacePanel)
		this.title = ''; // text title
		this.cusomTitle = null; // HTML title

		this.mobileWizard = $('#mobile-wizard'); // reference to main container of mobile wizard
		this.backButton = $('#mobile-wizard-back'); // reference to the button for going back or close
		this.titleBar = $('#mobile-wizard-titlebar'); // titlebar containing title and back button
		this.titleNode = $('#mobile-wizard-title'); // title content
		this.tabsContainer = $('#mobile-wizard-tabs'); // can be shown instead of titlebar
		var parentNode = document.getElementById('mobile-wizard-content');
		this.content = window.L.DomUtil.create('div', 'mobile-wizard mobile-wizard-content', parentNode);
		this.content.id = this.id;

		this.scrollPositions = [];
	},

	onAdd: function (map) {
		this.map = map;

		// for the moment, the mobile-wizard is mobile phone only
		if (!window.mode.isSmallScreenDevice())
			return;

		this.content.replaceChildren();
		this._setupBackButton();
	},

	onRemove: function() {
		this._destroyVulcanBottomSheetGesture();
		this._destroyVulcanCommentSheet();
		this._destroyVulcanPhonePopupHeader();
		window.L.DomUtil.remove(this.content);
		this.content = undefined;
	},

	/// this removes special styling
	_removeSpecialClasses: function() {
		this.mobileWizard.removeClass('shapeswizard');
		this.mobileWizard.removeClass('menuwizard');
		this.mobileWizard.removeClass('funcwizard');
		this.mobileWizard.removeClass('popup');
		this.mobileWizard.removeClass('snackbar');
		this.mobileWizard.removeClass('busypopup');
		this.mobileWizard.removeClass('vulcan-phone-popup-sheet');
		this.mobileWizard.removeClass('vulcan-a-sheet');
		this.mobileWizard.removeClass('vulcan-phone-alert');
	},

	/// this applies special styling for different types of mobile-wizards
	_applySpecialClasses: function() {
		if (this.isShapesWizard)
			this.mobileWizard.addClass('shapeswizard');
		if (this.isHamburgerMenu)
			this.mobileWizard.addClass('menuwizard');
		if (this.isFunctionMenu)
			this.mobileWizard.addClass('funcwizard');
		// `popup` is the FULL-FRAME class: device-mobile.css gives it
		// `position: fixed; top: 0; height: 100vh !important`. That is wrong for
		// a popup anchored to the grid, and phone Calc gets one on every
		// validity-list and autofilter tap -- measured as a 393x608 takeover
		// that blanked the whole sheet behind a 16px trigger, with the list
		// floating in the upper left at 26px per row.
		//
		// The window ALREADY knows this popup is different: :546-550 computes
		// `isAutofilter` and deliberately does not treat it as a popup for
		// build purposes ("show autofilter as regular mobile wizard for
		// compatibility with older version"). That decision just never reached
		// the styling, because `this.isPopup` is assigned the RAW isPopupJson at
		// :628, not the autofilter-aware value. Dropping the class here (rather
		// than changing this.isPopup) keeps removeWindow's `wasPopup` unwind in
		// Control.MobileWizard.js reading the same value it reads today.
		//
		// Without `popup` the wizard keeps its stock geometry -- `position:
		// relative`, in flow, bottom-anchored, 45vh (options.maxHeight, applied
		// at :691) -- which is a bottom sheet with the grid still visible above
		// it. That is C5.
		if (this.isPopup && !this.isAutoCompletePopup && !this.isPopupPartialScreen
			&& !(this._isVulcanPhoneChrome() && this.isVulcanDocumentAreaPopup))
			this.mobileWizard.addClass('popup');
		if (this.isSnackBar)
			this.mobileWizard.addClass('snackbar');
		if (this.isBusyPopUp)
			this.mobileWizard.addClass('busypopup');
		if (this.isVulcanPhonePopupSheet)
			this.mobileWizard.addClass('vulcan-phone-popup-sheet');
		// The docked A-sheet's content-height opt-in (vulcan-theme.css 13.5b).
		// A class rather than another inline height so the swap paths above
		// unwind it the same way they unwind every other special look.
		if (this.isVulcanFormatASheet)
			this.mobileWizard.addClass('vulcan-a-sheet');
		// The centred alert card (vulcan-theme.css §13-CALC.17). Same reason as
		// the A sheet above: a class, so every swap path already unwinds it.
		if (this.isVulcanPhoneAlert)
			this.mobileWizard.addClass('vulcan-phone-alert');
	},

	/// resets all classes which can modify the look to the original values
	_softReset: function() {
		this._setupBackButton();
		this.tabsContainer.children().detach();
		this.tabsContainer.hide();
		this.tabsContainer.css('top', '0px');
		this.titleBar.css('top', '0px');
		this.titleBar.show();
		this.titleNode[0].replaceChildren();
		this._removeSpecialClasses();
	},

	/// resets all, including content
	_reset: function() {
		this._destroyVulcanBottomSheetGesture();
		this._destroyVulcanCommentSheet();
		this._destroyVulcanPhonePopupHeader();
		// The scrim is a child of document.body, not of this window, so a
		// SWAP is the one path that would otherwise leave it up over whatever
		// replaced the card.
		this._destroyVulcanPhoneAlertScrim();
		// VO-P-0010: the content this panel was flipped over is about to be
		// replaced, so the layer goes with it. Cleared BEFORE _softReset so the
		// same pass that rebuilds the chrome restores the resting (down-chevron) face. _softReset
		// itself deliberately does NOT clear it: showWindow calls it to restore
		// a parent window whose panel is still on screen and still poppable.
		this._vulcanInPlacePanelPop = null;
		this._softReset();
		this._currentDepth = 0;
		this._inMainMenu = true;
		this.content.replaceChildren();
		this._isTabMode = false;
		this._currentPath = [];
		this.tabs = null;
		this._currentScrollPosition = 0;
		this.isPopup = false;
		this.isVulcanPhonePopupSheet = false;
		this.isVulcanDocumentAreaPopup = false;
		this.isVulcanFormatASheet = false;
		this.vulcanDraggableBottomSheetEnabled = false;
		this.isVulcanCommentSheet = false;
		this.isVulcanPhoneAlert = false;
	},

	_destroyVulcanBottomSheetGesture: function() {
		if (!this.vulcanBottomSheetGesture)
			return;
		this.vulcanBottomSheetGesture.destroy();
		this.vulcanBottomSheetGesture = null;
	},

	/*
	 * ── PHONE POPUP DISMISSAL (P1) ──────────────────────────────────────────
	 *
	 * WHAT WAS MEASURED. Tapping a hyperlink on a phone raised #mobile-wizard
	 * as a 393x800 full-frame modal titled "External link" whose only control
	 * was "Open link". Five touch gestures failed to dismiss it; only a
	 * hardware Escape closed it, which a phone does not have. Two independent
	 * causes, both visible in this file:
	 *
	 *  1. THE SCRIM IS UNDER THE SHEET, AND THE SHEET IS THE WHOLE SCREEN.
	 *     :616-623 builds a `.jsdialog-overlay.cancellable` on document.body
	 *     with a working tap-to-dismiss handler -- but the overlay is
	 *     z-index 2000 (jsdialogs.css) and #mobile-wizard is 2001
	 *     (mobilewizard.css), and `#mobile-wizard.popup` is
	 *     `position: fixed; top: 0; height: 100vh` (device-mobile.css) sharpened
	 *     to the visualViewport height by vulcan-theme.css 13.4a. The sheet
	 *     covers every pixel of its own scrim, so "tap outside" has no outside.
	 *     The handler was never broken; it was unreachable.
	 *
	 *  2. THE ONLY OTHER CONTROL IS HIDDEN. :709 runs `this.titleBar.hide()`
	 *     for every popup, and the titlebar is the <table> that CONTAINS
	 *     <td id="mobile-wizard-back"> (html/cool.html.m4). That is why the
	 *     back control measured 0x0: it is not mis-sized, it is inside a
	 *     display:none ancestor.
	 *
	 * WHY A NEW CONTROL AND NOT `titleBar.show()`. #mobile-wizard-back is bound
	 * once, globally, to `history.back()` (Control.MobileWizard._setupBackButton).
	 * On this path that is actively dangerous: _onMobileWizard only pushes
	 * history entries when the wizard was not `alreadyOpen`, so a popup raised
	 * over an existing sheet has none of its own, and a Back would be spent by
	 * UIManager.onGoBack -> VulcanEscape.popOneLayer with the ladder already
	 * empty -> `app.dispatcher.dispatch('closeapp')`. Re-showing that control
	 * would trade a stuck modal for a closed document. This header owns its own
	 * handler and calls the dismissal directly.
	 *
	 * The dismissal itself is the SAME two-step the scrim uses at :619-622, so
	 * there is one teardown path, not two: removeWindow tears down the DOM
	 * (and _hideWizard removes the overlay), and the '__POPOVER__' callback is
	 * what UIManager.showModal registers for `closeModal(dialogId)`, so the
	 * dialog state goes with it.
	 */
	_isVulcanDismissablePhonePopup: function(data) {
		if (!this._isVulcanPhoneChrome() || !data)
			return false;
		// A sheet the FORK builds declares itself, because the tests below
		// inspect core's wire shape and a fork payload has none of it: it
		// carries `type: 'container'` (the only top-level type the builder
		// actually handles — there is no 'modalpopup' control handler, so a
		// payload spelled that way would build an empty sheet) and it opts
		// into the popup path with `jsontype: 'popup'` so the cancellable
		// scrim is still created for it. Everything downstream — the 44px
		// close header, the 70% cap, the corner floor — is the same surface
		// core's modals get.
		if (data.vulcanPhoneSheet === true)
			return true;
		// snackbars self-dismiss on a timer and busypopup is a progress
		// blocker; neither is a surface a user is meant to close.
		if (data.type !== 'modalpopup')
			return false;
		// A modal that declares itself NOT cancellable is a deliberate decision
		// gate -- the collaboration-choice dialog (Control.Permission.js) is
		// `cancellable: false` on purpose. This fix is "a modal that claims to
		// be dismissable must actually be dismissable by touch", not "nothing
		// may block".
		if (data.cancellable !== true)
			return false;
		if (data.isAutoCompletePopup || data.isPopupPartialScreen)
			return false;
		// The two modals that are deliberately full-screen documents.
		if (data.id === 'busypopup'
			|| data.id === 'modal-dialog-about-dialog-box'
			|| data.id === 'modal-dialog-unlock-features-popup')
			return false;
		return true;
	},

	_dismissVulcanPhonePopup: function() {
		var builder = this._builder;
		this.parent.removeWindow(this);
		if (builder)
			builder.callback('popover', 'close', {id: '__POPOVER__'}, null, builder);
	},

	_destroyVulcanPhonePopupHeader: function() {
		if (!this.vulcanPhonePopupHeader)
			return;
		// Every listener below is on this element or its children, so removing
		// it removes them with it.
		this.vulcanPhonePopupHeader.remove();
		this.vulcanPhonePopupHeader = null;
	},

	_setupVulcanPhonePopupHeader: function() {
		this._destroyVulcanPhonePopupHeader();
		if (!this.isVulcanPhonePopupSheet)
			return;

		var wizard = document.getElementById('mobile-wizard');
		if (!wizard)
			return;

		var header = window.L.DomUtil.create('div', 'vulcan-phone-popup-header');

		// A grabber, because a sheet that can be flung away should look like
		// one. It is decoration for assistive tech -- the button beside it is
		// the accessible control.
		var grabber = window.L.DomUtil.create('div', 'vulcan-phone-popup-grabber', header);
		grabber.setAttribute('aria-hidden', 'true');

		var closeText = _('Close');
		var closeButton = window.L.DomUtil.create('button', 'vulcan-phone-popup-close', header);
		closeButton.type = 'button';
		closeButton.id = 'vulcan-phone-popup-close';
		closeButton.setAttribute('aria-label', closeText);
		closeButton.setAttribute('title', closeText);
		// A masked sprite, not a text glyph: every mark this chrome renders
		// comes from the icon set. CSS mask (vulcan-theme.css §15), so no
		// runtime URL resolution and the mark paints in currentColor.
		var closeMark = window.L.DomUtil.create('span', 'vulcan-glyph-icon vulcan-glyph-cancel', closeButton);
		closeMark.setAttribute('aria-hidden', 'true');

		var that = this;
		closeButton.addEventListener('click', function (e) {
			e.preventDefault();
			e.stopPropagation();
			that._dismissVulcanPhonePopup();
		});

		// Downward fling on the header. Deliberately the smallest thing that
		// can work: passive listeners, no preventDefault, no transform, no
		// pointer capture. It cannot interfere with the sheet's own scrolling
		// (it is bound to the header, which is not the scroll owner) and if it
		// never fires the close button and the scrim are both untouched.
		var startX = 0;
		var startY = 0;
		var tracking = false;
		header.addEventListener('touchstart', function (e) {
			tracking = e.touches && e.touches.length === 1;
			if (!tracking)
				return;
			startX = e.touches[0].clientX;
			startY = e.touches[0].clientY;
		}, { passive: true });
		header.addEventListener('touchend', function (e) {
			if (!tracking)
				return;
			tracking = false;
			var touch = e.changedTouches && e.changedTouches[0];
			if (!touch)
				return;
			var dy = touch.clientY - startY;
			var dx = touch.clientX - startX;
			if (dy > 48 && dy > Math.abs(dx))
				that._dismissVulcanPhonePopup();
		}, { passive: true });

		wizard.insertBefore(header, wizard.firstChild);
		this.vulcanPhonePopupHeader = header;

		/*
		 * THE EMPTY TITLE BAR ABOVE A SHEET THAT HAS NO ROOM (S5).
		 *
		 * A document-area popup -- the Calc autofilter menu and the validity
		 * list, the two in-display arrow surfaces -- is deliberately built
		 * through the REGULAR wizard path (`isPopup` is false for it at :822,
		 * "show autofilter as regular mobile wizard"), so the `titleBar.hide()`
		 * every other popup gets at :1024 never runs for it. Core sends these
		 * sheets no `text`, so what shipped was #mobile-wizard-title measured
		 * 340x43 with textContent '' and, directly under this header, the
		 * 43x50 .mobile-wizard-back.close-button chevron drawn over nothing:
		 * 93px of chrome, two close affordances stacked, above a sheet that
		 * could show 4 of its 10 rows.
		 *
		 * Only when the title is genuinely EMPTY -- a titled popup sheet (the
		 * "External link" modal) keeps its bar -- and only at the root, because
		 * goLevelDown re-shows the titlebar on phone chrome and a drill-in
		 * always has a real title to put in it.
		 *
		 * Losing the back CELL costs nothing here and removes a hazard: this
		 * header's own button is the accessible close control, and
		 * #mobile-wizard-back is bound once, globally, to history.back(), which
		 * the note above records as able to reach `closeapp` on a popup that
		 * pushed no history entry of its own.
		 */
		if (!this.title && !this.cusomTitle)
			this.titleBar.hide();
	},

	_setupVulcanBottomSheetGesture: function(data) {
		this._destroyVulcanBottomSheetGesture();
		if (data)
			this.vulcanDraggableBottomSheetEnabled =
				data.vulcanDraggableBottomSheet === true;
		if (!this.vulcanDraggableBottomSheetEnabled ||
			!document.documentElement.classList.contains('vulcan-mobile-chrome') ||
			!this.map._docLayer ||
			this.map._docLayer._docType !== 'presentation' ||
			!window.VulcanBottomSheetGesture)
			return false;

		this.vulcanBottomSheetGesture = new window.VulcanBottomSheetGesture(
			this.mobileWizard.get(0),
			function() {
				// Use the same history-backed one-layer unwind as the fixed
				// upper-left exit. That keeps Android Back, the toolbar exit and a
				// downward fling on one dismissal stack.
				history.back();
			},
		);
		return true;
	},

	_resizeVulcanBottomSheetGesture: function() {
		if (this.vulcanBottomSheetGesture)
			this.vulcanBottomSheetGesture.resize();
		if (this.vulcanCommentSheet)
			this.vulcanCommentSheet.resize();
	},

	/*
	 * R8 runner-up 11 / EX-6: the comment surface opened at the shared
	 * wizard's 45vh and took the bottom half of a portrait Calc screen, under
	 * a formula bar and an operator strip that had already taken two rows —
	 * on a document with no comments in it. G22 rules the other way: the
	 * surface arrives as the titlebar strip it needs to announce itself and
	 * grows only on intent. Everything about how it behaves once it is up
	 * lives in VulcanCommentSheet.ts; this is only where it is mounted.
	 *
	 * Calc-scoped deliberately. Writer's comment surface reaches the same
	 * wizard, but its chrome column and its selection grammar are a different
	 * lane's; widening the mount is one line here when that lane is ready.
	 *
	 * BOTH halves of the phone predicate, not the class alone: the class is
	 * absent when the host asks for `?vulcanChrome=desktop` on a real phone,
	 * where isSmallScreenDevice() is still true, and a strip whose CSS does
	 * not apply would be a 45vh sheet pinned to 44px of visible titlebar.
	 */
	_setupVulcanCommentSheet: function(data) {
		this._destroyVulcanCommentSheet();
		if (data)
			this.isVulcanCommentSheet = data.id === 'comment';
		if (!this.isVulcanCommentSheet)
			return false;
		if (!window.mode.isSmallScreenDevice() ||
			!document.documentElement.classList.contains('vulcan-mobile-chrome'))
			return false;
		if (!this.map._docLayer || !this.map._docLayer.isCalc())
			return false;
		if (!window.VulcanCommentSheet)
			return false;

		this.vulcanCommentSheet = new window.VulcanCommentSheet(
			this.mobileWizard.get(0),
			{
				onDismiss: function() {
					// The same history-backed one-layer unwind the fixed
					// upper-left exit and the Impress format sheet use, so the
					// toolbar toggle, Android Back and a downward pull share one
					// dismissal stack. It matters more here than there:
					// Control.MobileWizard._hideWizard is what clears
					// window.commentWizard, drops the comment highlighters and
					// de-selects comment_wizard in the top bar, and a dismissal
					// that skipped it would leave the toolbar toggle inverted.
					history.back();
				},
			},
		);
		return true;
	},

	_destroyVulcanCommentSheet: function() {
		if (!this.vulcanCommentSheet)
			return;
		this.vulcanCommentSheet.destroy();
		this.vulcanCommentSheet = null;
	},

	/*
	 * ── AN IN-PLACE PANEL IS A LAYER (VO-P-0010 / M-0019 §6B) ───────────────
	 *
	 * A phone sheet may flip a panel over its OWN content instead of pushing a
	 * second window: the Writer format sheet's colour drill does exactly that
	 * (M-0019 §6B measured the reference doing it — "the same fragment, the
	 * same ✕, a Back appears, and the list comes back with its scroll offset
	 * preserved"). Nothing is pushed, so `parent.contents.length` never moves
	 * — and that is the whole hazard, because two shipped mechanisms read
	 * depth off exactly that number:
	 *
	 *   goLevelUp   with `_inMainMenu` still true (goLevelDown was never run)
	 *               the FIRST arm fires and removes THIS WINDOW — so one back
	 *               press from inside the panel would close the whole sheet,
	 *               where the second-window drill it replaced came back to the
	 *               sheet (Control.MobileWizard.removeWindow -> showWindow).
	 *   VulcanEscape.depth()  counts `contents.length`, so the host's mirror
	 *               would under-report the panel by one.
	 *
	 * Both are fixed by making the panel a real rung of THIS window's own
	 * one-layer contract rather than a private DOM trick of the sheet's:
	 * goLevelUp pops it first (below), and VulcanEscape.depth() counts it. One
	 * press, one layer, one implementation — CS-4, and the reason this lives
	 * here and not in the sheet: every route back (the titlebar control's
	 * history.back(), hardware/browser back through UIManager.onGoBack, and the
	 * host's ‹ chevron through Map.WOPI) converges on goLevelUp, so a sheet
	 * that owned its own Back privately would be reachable by exactly one of
	 * the three.
	 *
	 * THE LEADING CONTROL'S FACE FOLLOWS, and it is not decoration. This chrome
	 * has ONE titlebar control (#mobile-wizard-back), whose `.close-button`
	 * class is the resting face (the `<` art rotated −90° into a down chevron —
	 * there is no ✕ in this chrome) and whose absence is the ‹ back face — the same flip
	 * goLevelDown/goLevelUp already do for a pushed drill-in. Once the panel is
	 * a layer the control POPS THE PANEL, so leaving it wearing ✕ would draw a
	 * close glyph on a control that no longer closes. Owned in _setupBackButton
	 * so that every existing caller (onAdd, _softReset, and therefore every
	 * window swap) keeps the face and the ladder in agreement without a second
	 * bookkeeping site.
	 *
	 * 🔴 M-0019 §6B has Back LEADING and ✕ TRAILING on one row; our titlebar
	 * has no trailing slot, so while the panel is up there is no one-tap
	 * dismissal of the whole sheet. That is a named divergence (VO-P-0010's
	 * ledger records it), and it is the fork's grammar for every other
	 * drill-in — not a second stacked leading control, which is what a Back
	 * built into the scrolling body would have been.
	 *
	 * Phone-gated, and inert everywhere else: the setter refuses off phone
	 * chrome, so `_vulcanInPlacePanelPop` is null on desktop and tablet and on
	 * every doctype but the one that installs it, which makes both additions
	 * below early-return no-ops there.
	 */
	vulcanSetInPlacePanel: function(pop) {
		if (!this._isVulcanPhoneChrome())
			return false;
		this._vulcanInPlacePanelPop = pop || null;
		this._setupBackButton();
		return true;
	},

	/// Pops a flipped-in-place panel if one is up. True when it took the press.
	_vulcanPopInPlacePanel: function() {
		var pop = this._vulcanInPlacePanelPop;
		if (!pop)
			return false;
		this._vulcanInPlacePanelPop = null;
		this._setupBackButton();
		pop();
		return true;
	},

	// reset back button to the original state
	_setupBackButton: function() {
		this.backButton.show();
		// VO-P-0010: ✕ unless a panel is flipped over this window's content,
		// in which case this control's press pops that panel and must say so.
		if (this._vulcanInPlacePanelPop)
			this.backButton.removeClass('close-button');
		else
			this.backButton.addClass('close-button');
	},

	/// for hiding the window by manager (mobile-wizard)
	hideWindow: function() {
		this._destroyVulcanBottomSheetGesture();
		this._destroyVulcanCommentSheet();
		this._destroyVulcanPhonePopupHeader();
		this.isVisible = false;
		$(this.content).hide();
		this._removeSpecialClasses();
	},

	/// for showing the window by manager (mobile-wizard)
	showWindow: function() {
		this._softReset();
		this.isVisible = true;
		$(this.content).show();
		this.restoreTitle();
		this.restoreTabs();
		this._applySpecialClasses();
		this._setupVulcanBottomSheetGesture();
		// Same story as the popup header below: the strip's toggle and the
		// sheet's height live on the shared #mobile-wizard, not on this
		// window's content div, so a swap-back has to rebuild them.
		this._setupVulcanCommentSheet();
		// The header is a DOM child of the shared #mobile-wizard, not of this
		// window's content div, so a window swap has to rebuild it the same way
		// _applySpecialClasses re-applies the classes.
		this._setupVulcanPhonePopupHeader();
	},

	_createScrollIndicator() {
		const container = document.createElement('div');
		container.className = 'mobile-wizard-scroll-indicator';
		container.id = 'mobile-wizard-scroll-indicator-' + this.id;
		container.style.width = '100%';
		container.style.height = '0px';
		container.style.position = 'fixed';
		container.style.zIndex = 2;
		container.style.bottom = '-7px';
		container.style.boxShadow = '0 -8px 20px 4px #0b87e770, 0 1px 10px 6px #0b87e7';
		return container;
	},

	_showWizard: function() {
		if (this.snackBarTimout)
			clearTimeout(this.snackBarTimout);

		this.isVisible = true;

		this.scrollIndicator = this._createScrollIndicator();
		this.content.appendChild(this.scrollIndicator);

		var wizard = $('#mobile-wizard');
		wizard.show();
		var that = this;
		wizard.on('scroll', function() {
			var mWizardContentScroll = wizard.scrollTop();
			var height = wizard.prop('scrollHeight');
			var contentHeight = wizard.prop('clientHeight');
			var scrollLeft = height - mWizardContentScroll;
			if (scrollLeft < contentHeight + 1 || !that.isVisible) { that.scrollIndicator.style.display = 'none'; }
			else { that.scrollIndicator.style.display = 'block'; }
		});
		$('#toolbar-down').hide();
		if (window.ThisIsTheAndroidApp)
			window.postMobileMessage('MOBILEWIZARD show');
		if (window.mobileMenuWizard)
			this.map.showSidebar = false;

		if (this.map.uiManager.sheetsBar)
			this.map.uiManager.sheetsBar.hide();

		if (!document.getElementById('document-container').classList.contains('landscape')) {
			var pcw = document.getElementById('presentation-controls-wrapper');
			if (pcw)
				pcw.style.display = 'none';
		}
	},

	isOpen: function() {
		return $('#mobile-wizard').is(':visible');
	},

	_hideKeyboard: function() {
		// VULCAN: map.blur() cannot lower an iPhone keyboard -- TextInput.blur()
		// keeps the stock platform gate on its DOM blur -- so on the phone chrome
		// this was a no-op and every sheet opened over a live keyboard. The
		// deliberate-exit blur is the one that bypasses that gate; opening a
		// sheet is exactly as deliberate an exit as ✓. Off the phone chrome the
		// stock release stands, so desktop and tablet are untouched.
		if (this._isVulcanPhoneChrome() && this.map._textInput &&
		    this.map._textInput.dismissSoftKeyboard) {
			this.map._textInput.dismissSoftKeyboard();
			return;
		}
		this.map.blur();
	},

	/// VULCAN: B-0179. On the Android host, Google's editors keep the IME up
	/// with the format sheet docked on it (M-0019: "it opens with the keyboard
	/// docked and its bottom edge sits exactly on the inset top"), and RU-38
	/// says the Android row follows Android. The iPhone keeps RU-26 (the sheet
	/// drops the keyboard and brings it back on dismiss). The platform is the
	/// host's keyboard MODEL, which only the Android host reports
	/// (Vulcan_HostKeyboard `resizes`): its WebView has already shrunk, so the
	/// sheet's in-flow cap resolves against a body that ends at the IME top
	/// and the sheet docks there with no lift of its own.
	/// Scoped to the Writer format sheet, the one M-0019 measured, and (B-0328)
	/// the Impress one: on the device, a live slide-text caret, then Format, and
	/// the same sheet (VulcanMobileFormat's id) dropped the Android keyboard the
	/// way Writer's did before this rule. RU-38 makes the Android row follow
	/// Android, and M-0019 is Google's Android editor behaviour (Docs; Slides
	/// itself is unmeasured). Calc still drops it.
	_vulcanHostKeepsKeyboard: function(data) {
		var doc = this.map._docLayer;
		return this._isVulcanPhoneChrome() && !!data && data.id === 'vulcan-format-sheet' &&
			!!doc && ((!!doc.isWriter && doc.isWriter()) || (!!doc.isImpress && doc.isImpress())) &&
			!!window.VulcanKeyboard && !!window.VulcanKeyboard.hostResizes &&
			window.VulcanKeyboard.hostResizes();
	},

	getCurrentLevel: function() {
		return this._currentDepth;
	},

	/// Vulcan phone chrome only. Same predicate as js/global.js
	/// vulcanIsPhoneChrome(): global.js stamps html.vulcan-mobile-chrome iff
	/// the host asked for stock chrome AND the screen is under 768px, so a
	/// desktop (vulcan-desktop-chrome) and a tablet (NEITHER class) both read
	/// false here and keep the stock behaviour untouched.
	_isVulcanPhoneChrome: function() {
		return document.documentElement.classList.contains('vulcan-mobile-chrome')
			&& !!window.mode && window.mode.isSmallScreenDevice();
	},

	/// setups the tab bar; hides the title bar except under phone chrome
	setTabs: function(tabs) {
		this.tabs = tabs;
		this.tabsContainer.show();
		this.tabsContainer.children().detach();
		this.tabsContainer.append(tabs);
		// Stock hides the whole titlebar for a tab control -- and the
		// titlebar is the <table> that CONTAINS <td id="mobile-wizard-back">
		// (html/cool.html.m4:232-236). So on every tab-mode sheet, and the
		// A-sheet is always one, the root had NO back control at all: not a
		// small one, none. The 48x20 box only ever appeared one level deeper.
		// Under phone chrome keep both rows, which is also the Google Sheets
		// format-sheet layout: "[<] Format" over the Text / Cell tabs.
		// Costs ~48px of SHEET header (--header-height), not chrome.
		if (this._isVulcanPhoneChrome()) {
			this.titleBar.insertBefore(this.tabsContainer);
			this.titleBar.show();
			this.tabsContainer.css('top', this.titleBar.outerHeight() + 'px');
		}
		else
			this.titleBar.hide();
		this._isTabMode = true;
	},

	/// for restoring the tabs by manager
	restoreTabs: function() {
		if (this.tabs)
			this.setTabs(this.tabs);
	},

	setCurrentScrollPosition: function() {
		this._currentScrollPosition = $(this.content).scrollTop();
	},

	goLevelDown: function(contentToShow, options) {
		var animate = (options && options.animate != undefined) ? options.animate : true;

		if (!this._isTabMode || this._currentDepth > 0)
			this.backButton.removeClass('close-button');

		// CS-6: on phone the titlebar is never hidden, at any depth -- it
		// carries the back control. The tab row still collapses on a real
		// drill-in, so the deeper levels look exactly as they did.
		if (this._isVulcanPhoneChrome()) {
			this.titleBar.show();
			if (this._isTabMode && this._currentDepth > 0)
				this.tabsContainer.hide();
		} else if (this._isTabMode && this._currentDepth > 0) {
			this.titleBar.show();
			this.tabsContainer.hide();
		}

		$('#mobile-wizard .ui-effects-placeholder').hide();

		// do not select already hidden nodes at first place
		var nodesToHide = $(contentToShow).siblings(':visible').not('.mobile-wizard-scroll-indicator');

		var parent = $(contentToShow).parent();
		if (parent.hasClass('toolbox'))
			nodesToHide = nodesToHide.add(parent.siblings(':visible:not(.mobile-wizard-scroll-indicator)'));
		var duration = 10;
		if (animate) {
			nodesToHide.hide('slide', { direction: 'left' }, duration);
			// be sure all is hidden, sometimes jQuery doesn't work here ...
			// restoreStyle is called in some jQuery cleanup what causes showing nodes again
			setTimeout(function() { nodesToHide.hide(); }, duration + 5);
		}
		else
			nodesToHide.hide();

		$(contentToShow).children('.ui-header').hide();

		$('#mobile-wizard.funcwizard div#mobile-wizard-content').removeClass('hideHelpBG');
		$('#mobile-wizard.funcwizard div#mobile-wizard-content').addClass('showHelpBG');

		// The content panel may carry the "hidden" class from the server
		// state (visible: false). Removing it is required for .show() to
		// take effect, because .hidden has display:none !important.
		$(contentToShow).children('.ui-content').first().removeClass('hidden');
		if (animate)
			$(contentToShow).children('.ui-content').first().show('slide', { direction: 'right' }, 'fast');
		else
			$(contentToShow).children('.ui-content').first().show();

		const currentScroll = this.mobileWizard.scrollTop();
		this.scrollPositions.push(currentScroll);
		this.mobileWizard.scrollTop(0);

		this._currentDepth++;
		if (!this._inBuilding)
			history.pushState({context: 'mobile-wizard', level: this._currentDepth}, 'mobile-wizard-level-' + this._currentDepth);

		var content = $(contentToShow).children('.ui-content').get(0);
		var title = content ? content.title : '';

		if (this._customTitle)
			this._setCustomTitle(this._customTitle);
		else
			this._setTitle(title);

		this._inMainMenu = false;

		this._currentPath.push(title);
	},

	goLevelUp: function() {
		// VO-P-0010 / M-0019 §6B: a panel flipped in place over this window's
		// own content is the topmost layer, and it pushed no window to say so.
		// Ahead of everything else because the arm below reads `_inMainMenu`,
		// which a flip deliberately never moves -- without this, one press
		// would spend two levels and close the sheet out from under the drill.
		// See vulcanSetInPlacePanel.
		//
		// The FIELD is tested here rather than the method, and that is not
		// belt-and-braces: ImpressPhoneFormatSheetGesture lifts this function
		// out of the source with `new Function` and calls it on a hand-built
		// window object, which is the honest way to test the removeWindow /
		// goLevelUp handshake without a DOM. Such an object carries the state
		// the arm under test needs and no prototype at all, so a bare method
		// call would throw there — and the ONLY thing the absent field can
		// mean is "no panel is flipped", which is exactly the fall-through.
		if (this._vulcanInPlacePanelPop && this._vulcanPopInPlacePanel())
			return;
		this._currentPath.pop();
		// CS-7: hasDialogInMobilePanelOpened is a METHOD
		// (Control.LokDialog.js:72-74). Referenced without (), it is a
		// function object -- always truthy -- so `!` was always false and
		// this entire second disjunct never ran. :411 in this same file
		// calls the same method WITH parens, which is what settles it as a
		// typo rather than a deliberate reference check.
		//
		// The dead branch is exactly the tab-root case (`_isTabMode &&
		// _currentDepth == 1`), i.e. the A-sheet. With it dead, the first
		// back at a freshly-opened sheet fell through to the else and merely
		// re-asserted the state the sheet was already in: nothing visible
		// happened and it took two taps to close.
		if (this._inMainMenu || (this._isTabMode && this._currentDepth == 1
			&& !this.map.dialog.hasDialogInMobilePanelOpened())) {
			this.parent.removeWindow(this);
			this._currentDepth = 0;
			// Removing a nested picker restores its parent. Do not run the
			// top-level toolbar toggle against that still-visible window.
			if (this.parent.contents.length)
				return;
			if (window.mobileWizard === true) {
				app.dispatcher.dispatch('mobile_wizard');
			} else if (window.insertionMobileWizard === true) {
				app.dispatcher.dispatch('insertion_mobile_wizard');
			} else if (window.mobileMenuWizard === true) {
				$('#main-menu-state').click();
			} else if (window.commentWizard === true) {
				app.dispatcher.dispatch('comment_wizard');
			} else if (window.contextMenuWizard) {
				window.contextMenuWizard = false;
				this.map.fire('closemobilewizard');
			}
		} else {
			this._currentDepth--;

			var parent = $('.ui-content.mobile-wizard:visible');
			if (this._currentDepth > 0 && parent)
				this._customTitle ? this._setCustomTitle(parent.get(0).customTitleBar) : this._setTitle(parent.get(0).title);
			else
				this._customTitle ? this._setCustomTitle(this._customTitle) : this._setTitle(this._mainTitle);

			var currentNode = $('.ui-explorable-entry.level-' + this._currentDepth + '.mobile-wizard:visible');
			// select only those nodes which are updated on Level down
			var headers = currentNode.siblings().filter(function() {
				var styleAttributeValue = $(this).attr('style');
				return styleAttributeValue && styleAttributeValue.includes('display: none;');
			});
			var currentHeader = currentNode.children('.ui-header');
			headers = headers.add(currentHeader);

			var parent = currentNode.parent();
			if (parent.hasClass('toolbox'))
				parent.siblings().each(function() {
					var styleAttributeValue = $(this).attr('style');
					// select only those nodes which are updated on Level down
					if (styleAttributeValue && styleAttributeValue.includes('display: none;')) {
						headers = headers.add($(this));
					}
				});

			headers = headers.not('.hidden');

			$('.ui-content.level-' + this._currentDepth + '.mobile-wizard:visible').hide();
			$('#mobile-wizard.funcwizard div#mobile-wizard-content').removeClass('showHelpBG');
			$('#mobile-wizard.funcwizard div#mobile-wizard-content').addClass('hideHelpBG');
			headers.show('slide', { direction: 'left' }, 'fast');

			const prevScroll = this.scrollPositions.pop();
			this.mobileWizard.scrollTop(prevScroll);

			if (this._currentDepth == 0 || (this._isTabMode && this._currentDepth == 1)) {
				this._inMainMenu = true;
				this.backButton.addClass('close-button');
				if (this._isTabMode) {
					// CS-6: coming back to the sheet root restores the tab
					// row, but on phone it must NOT re-hide the titlebar --
					// that would take the back control away again at exactly
					// the depth where the user just proved they wanted it.
					if (!this._isVulcanPhoneChrome())
						this.titleBar.hide();
					this.tabsContainer.show();
				}
			}
			if (window.commentWizard === true) {
				app.sectionContainer.getSectionWithName(app.CSections.CommentList.name).removeHighlighters();
			}
		}
	},

	/// for restoring title on windows switching
	restoreTitle: function() {
		if (this.cusomTitle)
			this._setCustomTitle(this.cusomTitle);
		else
			this._setTitle(this.title);
	},

	/// setups text title
	_setTitle: function(title) {
		this.title = title;
		this.titleNode.text(this.title);
	},

	/// setups custom HTML titlebar
	_setCustomTitle: function(title) {
		this.cusomTitle = title;
		this.titleNode.html(this.cusomTitle);
	},

	_scrollToPosition: function(position) {
		if (this._currentScrollPosition) {
			$(this.content).animate({ scrollTop: position }, 0);
		}
	},

	selectedTab: function(tabText) {
		if (this._currentPath && this._currentPath.length) {
			this._currentPath = [tabText];
		}

		if (this._isVulcanPhoneChrome())
			this.mobileWizard.scrollTop(0);
	},

	_selectTab: function(tabId) {
		if (this.tabs && tabId) {
			for (var index in this.tabs.children) {
				if (this.tabs.children[index].id === tabId) {
					$(this.tabs.children[index]).trigger('click', {animate: false});
					break;
				}
			}
		}
	},

	_goToPath: function(path) {
		// when dialog has tabs, tab selection triggers the callback, causes infinite regenetate loop
		if (this.tabs && path && path.length && !this.map.dialog.hasDialogInMobilePanelOpened())
			this._selectTab(path[0]);

		var _path = [];
		var goBack = false;

		for (var index in path) {
			var elem = $('[title=\'' + path[index] + '\'').prev();
			if (elem.length) {
				$(elem).trigger('click', {animate: false});
				_path.push(path[index]);
			}
			else
				goBack = true;
		}

		if (goBack) {
			this._currentScrollPosition = 0;
			$(this.content).animate({ scrollTop: 0 }, 0);
		}

		this._currentPath = _path;
	},

	_onMobileWizard: function(data, callback) {
		if (data) {
			if (data.jsontype === 'dialog' && data.action === 'close') {
				this.parent.removeWindow(this, false);
				return;
			}

			this._inBuilding = true;

			var isDocumentAreaPopup = data.popupParent === '_POPOVER_'
				&& data.posx !== undefined && data.posy !== undefined;
			var isCalc = this.map._docLayer ? (this.map._docLayer._docType === 'spreadsheet') : false;
			var isAutofilter = isDocumentAreaPopup && isCalc;

			var isPopupJson = (data.jsontype === 'popup' || data.type === 'modalpopup' || data.type === 'snackbar');
			// show autofilter as regular mobile wizard for compatibility with older version
			var isPopup = !isAutofilter && isPopupJson;
			var isSidebar = false;
			if (data.children) {
				for (var i in data.children) {
					if (data.children[i].type == 'deck')
						isSidebar = true;
				}
			}

			if (!this._isActive && isSidebar) {
				if (this.map.showSidebar == false)
					return;
			}
			if (isSidebar && !this.map.showSidebar) {
				return;
			}

		var isMobileDialog = data.id && !isNaN(data.id) && !isSidebar;
		if (isMobileDialog) {
				// id is a number - remember window id for interaction
				window.mobileDialogId = data.id;
				//dialogid is string - name of the dialog in json
				if (data.dialogid)
					this._dialogid = data.dialogid;
			}

			this._isActive = true;
			var currentPath = null;
			var lastScrollPosition = null;
			var alreadyOpen = this.isOpen();

			if (this._currentPath)
				currentPath = this._currentPath;
			if (this._currentScrollPosition)
				lastScrollPosition = this._currentScrollPosition;

			if (isPopup) {
				var popupContainer = $('.mobile-popup-container:visible');
				if (popupContainer.length) {
					// for menubutton we inject popup into menu structure
					if (data.action === 'close' || data.action === 'fadeout') {
						this.goLevelUp();
						popupContainer.empty();
					} else {
						this.backButton.hide();
						popupContainer.empty();
						if (!this._builder) {
							this._builder = window.L.control.mobileWizardBuilder(
								{
									windowId: data.id,
									mobileWizard: this,
									map: this.map,
									cssClass: 'mobile-wizard',
									useSetTabs: true
								});
						}
						this._builder.build(popupContainer.get(0), [data]);
					}

					this._inBuilding = false;
					return;
				} else if (data.action === 'close' || data.action === 'fadeout') {
					this.parent.removeWindow(this);
					return;
				} else {
					// normal popup - continue to open mobile wizard
					var overlay = window.L.DomUtil.create('div', 'mobile-wizard jsdialog-overlay ' + (data.cancellable ? 'cancellable' : ''), document.body);
					var that = this;
					if (data.cancellable) {
						overlay.onclick = function () {
							that.parent.removeWindow(that);
							that._builder.callback('popover', 'close', {id: '__POPOVER__'}, null, that._builder);
						};
					}
				}
			}

			this._reset();
			this.isPopup = isPopupJson;
			this.isAutoCompletePopup = data.isAutoCompletePopup;
			this.isPopupPartialScreen = data.isPopupPartialScreen;
			// Recorded rather than recomputed later: isAutofilter is derived
			// from posx/posy/popupParent on THIS payload, which is gone by the
			// time showWindow() re-applies the classes.
			this.isVulcanDocumentAreaPopup = isAutofilter;
			this.isVulcanPhonePopupSheet = this._isVulcanDismissablePhonePopup(data);
			this.persistKeyboard = data.persistKeyboard;

			this._showWizard();
			// VULCAN: the rationale below is about ONE wizard -- the fx
			// browse catalogue, where typing filters the function list -- but
			// the exclusion was written by doctype, so on the phone chrome the
			// sheet picker, the cell menu, the format sheet and find/replace
			// all opened over a live keyboard covering the sheet they were
			// supposed to be operating on. Narrowed to the catalogue itself
			// (data.id 'funclist', the same discriminator the height branch
			// below reads) and only on the phone chrome, so desktop and tablet
			// Calc keep the wholesale exclusion.
			var vulcanKeepsKeyboard = !this._isVulcanPhoneChrome() ||
				data.id === 'funclist';
			if (this.map._docLayer && !this.persistKeyboard &&
			    (!this.map._docLayer.isCalc() || !vulcanKeepsKeyboard)) {
				// In Calc, the wizard is used for the formulas,
				// and it's easier to allow the user to search
				// for a formula by typing the first few characters.
				if (!this._vulcanHostKeepsKeyboard(data))
					this._hideKeyboard();
			}

			// Morph the sidebar into something prettier
			if (isSidebar)
				this._modifySidebarLayout(data);

			// ...and the desktop find dialog into a phone find sheet
			if (data.dialogid === 'FindReplaceDialog' && this._isVulcanPhoneChrome())
				this._shapeFindReplaceForPhone(data);

			// ...and the stock merge-cells panel into a one-sentence alert
			// (§13-CALC.17). Before the build below, like the find shaper: the
			// widgets it cuts must never be constructed, only then never seen.
			if (data.dialogid === 'MergeCellsDialog' && this._isVulcanPhoneChrome())
				this._shapeMergeCellsForPhone(data);

			if (!alreadyOpen) {
				history.pushState({context: 'mobile-wizard'}, 'mobile-wizard-opened');
				history.pushState({context: 'mobile-wizard', level: 0}, 'mobile-wizard-level-0');
				this.mobileWizard.scrollTop(0);
			}

			if (!this._builder) {
				this._builder = window.L.control.mobileWizardBuilder(
					{
						windowId: data.id,
						mobileWizard: this,
						map: this.map,
						cssClass: 'mobile-wizard',
						callback: callback,
						useSetTabs: true
					});
			}
			this._builder.build(this.content, [data]);
			if (window.ThisIsTheAndroidApp)
				window.postMobileMessage('hideProgressbar');

			this._mainTitle = data.text ? data.text : '';
			this._customTitle = data.customTitle;

			this._customTitle ? this._setCustomTitle(this._customTitle) : this._setTitle(this._mainTitle);

			if (data.id === 'menubar' || data.id === 'insertshape') {
				document.getElementById('mobile-wizard').style.height = '100vh';
				if (data.id === 'menubar')
					this.isHamburgerMenu = true;
				else if (data.id === 'insertshape') {
					this.isShapesWizard = true;
				}
				$('#mobile-wizard').css('top', $('#document-container').css('top'));
			} else if (data.id === 'funclist') {
				// Only the fx BROWSE catalogue reaches the wizard now: a
				// typed-prefix suggestion list is routed to the rail before
				// any wizard is built (CanvasTileLayer
				// ._vulcanRouteCalcSuggestionsToRail), so this branch no
				// longer has two products to tell apart.
				document.getElementById('mobile-wizard').style.height = '100vh';
				$('#mobile-wizard').css('top', $('#document-container').css('top'));
				this.isFunctionMenu = true;
			}
			else if (data.id === 'modal-dialog-about-dialog-box' || data.id === 'modal-dialog-unlock-features-popup') {
				isPopup = true;
			} else if (this.isVulcanPhoneAlert) {
				// The alert is a CARD, and a card is as tall as the sentence
				// inside it. Every other branch here writes a height INLINE,
				// which outranks any stylesheet; the card's job is to let
				// §13-CALC.17 own the geometry, so this branch withdraws both
				// inline declarations instead of writing a third one. `top` is
				// cleared for the same reason the comment sheet clears it: an
				// earlier full-screen sheet leaves one behind on the shared
				// element.
				document.getElementById('mobile-wizard').style.height = '';
				$('#mobile-wizard').css('top', '');
			} else if (this._setupVulcanCommentSheet(data)) {
				// The comment sheet owns its own height from here (13-CALC.12):
				// it opens at the titlebar strip and grows on intent, and both
				// numbers are measured against the live visual viewport rather
				// than a `vh` that does not shrink for the soft keyboard. The
				// `top` reset still belongs to this branch — an earlier
				// full-screen sheet leaves it as an INLINE declaration on the
				// shared element, and inline outranks anything the stylesheet
				// can say (the same trap the funclist branch above resets for).
				$('#mobile-wizard').css('top', '');
			} else if (!this._setupVulcanBottomSheetGesture(data)) {
				document.getElementById('mobile-wizard').style.height = this.options.maxHeight;
				$('#mobile-wizard').css('top', '');
			}
			// R6-5: the docked A-sheet (VulcanMobileFormat) opts into
			// content-height-with-a-cap (vulcan-theme.css 13.5b) so its last
			// row is never half-drawn at the 45vh fold. Recomputed on every
			// build, AFTER the chain above so the Impress draggable gesture
			// (which owns its own geometry) has already claimed or declined
			// this window; false for every other id, so the kebab / insert /
			// comments sheets and the drill-in pickers keep stock 45vh.
			// _applySpecialClasses stamps the class below.
			this.isVulcanFormatASheet = data.id === 'vulcan-format-sheet' &&
				!this.vulcanDraggableBottomSheetEnabled &&
				this._isVulcanPhoneChrome();
			if (!this.map._docLoaded && !isPopup) {
				$('#mobile-wizard').height('100%');
				// Turn backButton icon from down to actually back
				// since it does not hide it, instead it goes back in this case
				this.backButton.removeClass('close-button');
			}
			if (this._isActive && currentPath && currentPath.length) {
				this._goToPath(currentPath);
				this._scrollToPosition(lastScrollPosition);
			}

			if (isPopup) {
				// force hide scroll indicator while its showing/hidding is not fixed
				$('.mobile-wizard-scroll-indicator').hide();

				this.titleBar.hide();

				if (data.type === 'snackbar') {
					var that = this;
					this.isSnackBar = true;
					this.snackBarTimout = setTimeout(function () { that.parent.removeWindow(that); }, data.timeout ? data.timeout : this.options.snackbarTimeout);
				}
				else if (data.id === 'busypopup') {
					var that = this;
					this.isBusyPopUp = true;
				}
			}

			this._applySpecialClasses();
			// After _applySpecialClasses, so `vulcan-phone-popup-sheet` is on
			// the element before its header is measured, and after the builder
			// has filled #mobile-wizard-content, so insertBefore(firstChild)
			// puts the header above the content rather than racing it.
			this._setupVulcanPhonePopupHeader();
			this._inBuilding = false;
		}
	},

	_isSlidePropertyPanel: function(data) {
		var backgroundPanel = app.LOUtil.findItemWithAttributeRecursive(data, 'id', 'SlideBackgroundPanel');
		var layoutPanel = app.LOUtil.findItemWithAttributeRecursive(data, 'id', 'SdLayoutsPanel');
		return backgroundPanel && layoutPanel;
	},

	_insertCalcBorders: function(deck) {
		var replaceMe = app.LOUtil.findItemWithAttributeRecursive(deck, 'id', 'cellbordertype');
		if (replaceMe) {
			replaceMe.id = 'borderstyle';
			replaceMe.type = 'borderstyle';
			replaceMe.text = '';
			replaceMe.enabled = 'true';
			replaceMe.children = [];
		}
	},

	_modifySidebarLayout: function (data) {
		if (data.children && data.children.length && data.children[0].type !== 'deck')
			data.children.splice(0, 1);

		var deck = app.LOUtil.findItemWithAttributeRecursive(data, 'type', 'deck');
		if (deck)
		{
			// merge styles into text-panel for elegance
			var stylesIdx = app.LOUtil.findIndexInParentByAttribute(deck, 'name', 'StylesPropertyPanel');
			var textIdx = app.LOUtil.findIndexInParentByAttribute(deck, 'name', 'TextPropertyPanel');

			if (stylesIdx >= 0 && this.map.getDocType() === 'spreadsheet')
			{       // remove rather useless calc styles panel
				deck.children.splice(stylesIdx, 1);
			}
			else if (stylesIdx >= 0 && textIdx >= 0)
			{
				var moveContent = deck.children[stylesIdx].children[0].children;
				deck.children[textIdx].children[0].children = moveContent.concat(deck.children[textIdx].children[0].children);
				deck.children.splice(stylesIdx, 1); //remove the styles property
			}
			var removeItems = ['borderlinestyle', 'editcontour', 'spacingbar',
					   'linespacing', 'stylenew', 'styleupdate',
					   'beginarrowstyle', 'endarrowstyle'];

			if (this.map.getDocType() === 'presentation')
				removeItems.push('indentfieldbox');

			this._removeItems(deck, removeItems);

			this._insertCalcBorders(deck);
		}
	},

	/*
	 * Widgets cut from the phone find sheet. Google's phone find is a slim
	 * search field, a match count, prev/next chevrons, and replace behind one
	 * disclosure -- nothing else. Core hands the client the whole
	 * SvxSearchDialog instead, so the shaping happens here.
	 *
	 * Trimming from the client is possible because the sheet is entirely
	 * data-driven: core serializes svx/ui/findreplacedialog-mobile.ui to JSON
	 * (srchdlg.cxx picks the -mobile variant off isKitMobilePhone(), which is
	 * our own deviceFormFactor=mobile coming back at us) and
	 * Control.MobileWizardBuilder.build() walks data.children dispatching on
	 * node type. Nothing about the widget list is hard-coded client-side, so
	 * deleting nodes before build deletes the controls. This is the same
	 * mechanism _modifySidebarLayout already uses on the sidebar deck.
	 *
	 * IDs are from findreplacedialog-MOBILE.ui, not the desktop one -- the
	 * phone payload has no findreplacetabbox / find_tab_btn / replace_tab_btn
	 * / searchicon / searchbox to remove.
	 *
	 *   checkboxrow  match case, formatted, whole words, entire cells, all
	 *                sheets. Sheets/Docs on a phone expose none of these.
	 *   optionsgrid  the "Other options" expander in full: regexp, selection,
	 *                similarity, sounds-like, wildcards, notes, attributes,
	 *                format, diacritics, kashida, backwards -- plus calcgrid
	 *                (search in formulae/values/notes, by rows/columns).
	 *   hide-box     the component frame, two buttons for a case that cannot
	 *                arise here.
	 *   searchall    "Find All" selects every match at once. No Google phone
	 *                analogue, and on a 390px screen the result is invisible.
	 *   help         opens the LibreOffice help browser over the document.
	 *
	 * WHAT IS DELIBERATELY KEPT, because the thesis test cuts both ways -- a
	 * change that makes editing harder without making viewing better is wrong,
	 * and that rejects over-trimming as firmly as it rejects the desktop
	 * dialog:
	 *
	 *   searchterm/replaceterm  the two fields. Already rewritten from
	 *                comboboxes to plain edits for this dialog by
	 *                Control.MobileWizardBuilder.isFindReplaceComboox.
	 *   searchlabel  core's search status line, and on a phone ALSO the match
	 *                count. ⚠ This entry used to say the label "never" carries
	 *                a number, on the reading that SetSearchLabel maps a
	 *                SearchLabel enum to a fixed string. That was already only
	 *                half the story -- the OUString overload has always been
	 *                used to put digits here (STR_SEARCH_KEY_FOUND_TIMES on
	 *                FIND_ALL) -- and it is now wrong outright: the Vulcan
	 *                overload SetSearchLabel(sal_Int32, sal_Int32) renders
	 *                "3 of 12" into this widget on every phone FIND
	 *                (svx/source/dialog/srchdlg.cxx, driven by
	 *                sw/source/uibase/uiview/viewsrch.cxx). So this sheet
	 *                already shows the count, and cutting the widget would
	 *                take it away. The same pair also reaches the phone search
	 *                BAR now, over the wire as `.uno:SearchOrdinal`.
	 *   backsearch/search  prev/next. These ARE the chevrons.
	 *   replace/replaceall  both survive, behind the disclosure. Google Docs
	 *                on a phone has Replace and Replace all, so cutting one
	 *                would be friction Google does not have.
	 *
	 * The removed options keep whatever value core already holds for them, so
	 * a phone search runs with the defaults of a fresh view. That is the
	 * intended behaviour and not a hidden-state bug: the widgets are gone from
	 * the phone, not from the document's search descriptor, and a desktop
	 * session on the same document has its own dialog and its own state.
	 */
	FIND_REPLACE_PHONE_CUT: ['help', 'checkboxrow', 'hide-box', 'optionsgrid', 'searchall'],

	/*
	 * Turn the flat desktop dialog into: search field + status, prev/next, and
	 * one collapsed "Replace With" disclosure holding the replace field and
	 * both replace buttons.
	 *
	 * The disclosure is core's own replaceframe retyped to 'expander'. Three
	 * reasons that beats inventing a widget:
	 *
	 *  - the shape already matches. _expanderHandler reads children[0] as the
	 *    label and builds children[1..] as the content, and a serialized
	 *    GtkFrame is exactly [label, content] -- which is how _frameHandler
	 *    reads it too. Only the type changes.
	 *  - the label stays localized. children[0] is core's own "Re_place With"
	 *    string; _cleanText strips the mnemonic.
	 *  - retyping a node to 'expander' is an established client move --
	 *    JSDialog.panel does it for every sidebar panel
	 *    (Widget.SidebarContainers.ts), and _insertCalcBorders in this file
	 *    retypes a node in place already.
	 *
	 * 'expander' and not 'panel': Control.MobileWizardBuilder overrides
	 * _controlHandlers['panel'] with an _explorableEntry, which is a DRILL-IN,
	 * not a disclosure -- it would push a new wizard level and take the search
	 * field, the status line and the chevrons off screen while you type the
	 * replacement. Google's replace opens underneath the search field and
	 * leaves it visible. 'expander' is not overridden, so it resolves to
	 * Control.JSDialogBuilder._expanderHandler, which expands inline.
	 *
	 * Toggling it sends core a dialogevent {id: 'replaceframe', cmd: 'toggle'}
	 * that core drops: vcl/jsdialog/executor.cxx handles "toggle" under
	 * sControlType == "expander" via dynamic_cast<weld::Expander*>, and the
	 * real widget is a weld::Frame, so the cast fails and the action is
	 * unhandled. No state changes and nothing throws; the open/close itself is
	 * done client-side by _expanderHandler's own class toggles.
	 *
	 * Phone-gated twice: the caller tests _isVulcanPhoneChrome(), and this
	 * whole control is dead on anything else -- Control.MobileWizard.onAdd
	 * returns before binding 'mobilewizard' unless isSmallScreenDevice(), and
	 * Util.MessageRouter only routes a dialog here on that same test. A tablet
	 * is by definition not a small-screen device (mode.isTablet() is
	 * `L.Browser.mobile && !isSmallScreenDevice()`), so tablet and desktop
	 * keep the full dialog in the floating JSDialog component.
	 */
	_shapeFindReplaceForPhone: function (data) {
		this._removeItems(data, this.FIND_REPLACE_PHONE_CUT);

		var replaceFrame = app.LOUtil.findItemWithAttributeRecursive(data, 'id', 'replaceframe');
		var controlBox = app.LOUtil.findItemWithAttributeRecursive(data, 'id', 'controlbox');
		if (!replaceFrame || !replaceFrame.children || replaceFrame.children.length < 2)
			return;
		if (!controlBox || !controlBox.children)
			return;
		// _expanderHandler only draws the toggle when children[0].text is
		// non-empty; with no label it renders the content permanently open,
		// which is a disclosure that does not disclose. Core's own
		// "Re_place With" is always there, so an empty one means the payload
		// is not the shape this was written against -- leave it alone rather
		// than restructure it into something worse. No client-side label
		// substitute: it would be the one unlocalized string in the sheet.
		if (!replaceFrame.children[0].text)
			return;

		// Move the replace actions out of the shared button row, so the
		// disclosure holds the whole replace story and the row that stays
		// visible is just prev/next. Walking backwards keeps the splice
		// indices valid; unshift restores document order.
		var replaceButtons = [];
		for (var i = controlBox.children.length - 1; i >= 0; i--) {
			var id = controlBox.children[i].id;
			if (id === 'replace' || id === 'replaceall')
				replaceButtons.unshift(controlBox.children.splice(i, 1)[0]);
		}
		if (!replaceButtons.length)
			return;

		// GtkFrame labels are non-interactive decoration and may serialize
		// hidden. Once this label becomes the expander toggle, it must be visible.
		replaceFrame.children[0].visible = true;
		replaceFrame.type = 'expander';
		replaceFrame.children = replaceFrame.children.concat(replaceButtons);
	},

	/*
	 * ── THE MERGE WARNING (§13-CALC.17) ───────────────────────────────────
	 *
	 * WHAT SHIPS TODAY. Merging two cells that both hold data raises core's
	 * ScMergeCellsDialog, and on a phone a `jsontype: 'dialog'` payload is
	 * routed to this wizard (Util.MessageRouter, isSmallScreenDevice), which
	 * renders it at full height with nothing skinning it: a title, "Some cells
	 * are not empty.", THREE illustrated radio options with 1|2 -> 1 2
	 * diagrams, and a full-width button bar. The reference app asks the same
	 * question in a card: one sentence, Cancel, OK.
	 *
	 * The shaping is possible for the same reason the find sheet's is, and by
	 * the same mechanism: the payload is data, the builder walks
	 * data.children dispatching on type, so a node deleted here is a control
	 * never built. IDs are from sc/uiconfig/scalc/ui/mergecellsdialog.ui.
	 *
	 * ── 🔴 THE OUTCOME THIS CHOOSES, AND WHY IT IS NOT THE REFERENCE'S ────
	 *
	 * The three radios are not three phrasings of one action; they are three
	 * different fates for the cells that the merge hides:
	 *
	 *   move-cells-radio    contents concatenated into the top-left cell
	 *   keep-content-radio  contents untouched in the model, merely hidden --
	 *                       an unmerge brings them back.  Core's default.
	 *   empty-cells-radio   contents DELETED (DoEmptyBlock)
	 *
	 * The reference's single OK is the third one: its wording promises that
	 * only the top-leftmost value is preserved. Collapsing the choice to
	 * Cancel/OK is therefore a data decision, not a styling one, and copying
	 * the reference exactly would turn a two-tap phone gesture into a silent
	 * delete of a cell the user cannot see.
	 *
	 * So this takes the reference's SHAPE and core's SAFE verb: OK means keep.
	 * The user sees exactly what the reference shows them -- the top-left
	 * value, alone, in one merged cell -- and unmerging is still lossless. The
	 * sentence is written to that, "stay visible", not "preserved", because
	 * under keep the other values are still in the document and a sentence
	 * saying otherwise would be false.
	 *
	 * The other two outcomes stay on the desktop chrome, which this does not
	 * touch: `_isVulcanPhoneChrome()` gates the call site.
	 *
	 * ── WHY THE SELECTION IS SENT AND NOT ASSUMED ─────────────────────────
	 *
	 * `lastUsedMergeCellsOption` (mergecellsdialog.cxx) is a file-static that
	 * survives the dialog and the document, and the constructor seeds the
	 * radios from it. Leaving the removed radios at "whatever the last merge
	 * anywhere in this kit process chose" would make one OK mean keep and the
	 * next mean delete, with the same sentence above both. The dialogevent
	 * below is what makes the sentence true every time: core's radio group is
	 * still welded and still addressable even though no radio is rendered
	 * (vcl/jsdialog/executor.cxx looks the widget up by id, not in the DOM).
	 */
	MERGE_CELLS_PHONE_CUT: [
		// The three options and the three diagrams that illustrate them.
		'move-cells-radio',
		'keep-content-radio',
		'empty-cells-radio',
		'imMergeFirstCell',
		'imMergeKeepHidden',
		'imMergeEmptyHidden',
		// `help` is not here: the button row is rebuilt below as exactly
		// [cancel, ok], which drops it -- and anything else core ever puts in
		// that area -- without a second list to keep in step.
	],

	/** Which fate the card's single OK commits to. See the block above. */
	MERGE_CELLS_PHONE_OPTION: 'keep-content-radio',

	_shapeMergeCellsForPhone: function (data) {
		var label = app.LOUtil.findItemWithAttributeRecursive(data, 'id', 'label');
		var actions = app.LOUtil.findItemWithAttributeRecursive(
			data, 'id', 'dialog-action_area1');
		var ok = actions && actions.children
			? app.LOUtil.findItemWithAttributeRecursive(actions, 'id', 'ok') : null;
		var cancel = actions && actions.children
			? app.LOUtil.findItemWithAttributeRecursive(actions, 'id', 'cancel') : null;
		// Not the payload this was written against: leave it entirely alone.
		// A half-shaped card -- a sentence with no way to answer it, or two
		// buttons under a question that was cut -- is worse than the stock
		// panel, and the stock panel at least works.
		if (!label || !ok || !cancel)
			return false;

		this._removeItems(data, this.MERGE_CELLS_PHONE_CUT);
		label.text = _('Only the top-left value will stay visible.');
		// Cancel then OK, reading order, because the card no longer has a
		// buttonbox worth of context to place them by. The .ui declares OK
		// first (it is the default), and _handleResponses has already read the
		// response codes off the dialog node, so reordering the children here
		// moves the buttons without touching what they do.
		actions.children = [cancel, ok];

		app.socket.sendMessage(
			'dialogevent ' + data.id + ' ' + JSON.stringify({
				id: this.MERGE_CELLS_PHONE_OPTION,
				cmd: 'change',
				data: 'true',
				type: 'radiobutton',
			}));

		this.isVulcanPhoneAlert = true;
		this._setupVulcanPhoneAlertScrim();
		return true;
	},

	_destroyVulcanPhoneAlertScrim: function () {
		var scrim = document.querySelector('.vulcan-phone-alert-scrim');
		if (scrim && scrim.parentNode)
			scrim.parentNode.removeChild(scrim);
	},

	/*
	 * The card is small, and everything it does not cover is the live sheet.
	 * Core's dialog is modal but the client's document is not, so without a
	 * scrim a tap beside the card lands on a cell while a dialog waits on an
	 * answer. This is the SAME `.jsdialog-overlay` the popup branch of
	 * _onMobileWizard builds -- full-frame, z-index 2000 under the wizard's
	 * 2001 -- so it swallows those taps, and it dims, which is what makes a
	 * card read as a card rather than a panel that failed to fill the screen.
	 *
	 * The click is a real dismissal, not just a hide: removeWindow ->
	 * _hideWizard -> _onDialogClose(mobileDialogId, true) -> _sendCloseWindow
	 * is what cancels the modal still waiting in core. _hideWizard also
	 * removes every .jsdialog-overlay, so the scrim is torn down by the same
	 * call whichever control ends the card -- Cancel, OK, or this.
	 */
	_setupVulcanPhoneAlertScrim: function () {
		this._destroyVulcanPhoneAlertScrim();
		var that = this;
		var scrim = window.L.DomUtil.create(
			'div',
			'mobile-wizard jsdialog-overlay cancellable vulcan-phone-alert-scrim',
			document.body);
		scrim.onclick = function () {
			that.parent.removeWindow(that);
		};
	},

	_removeItems: function (data, items) {
		if (data.children) {
			for (var i = 0; i < data.children.length;) {
				var childRemoved = false;
				for (var j = 0; j < items.length; j++) {
					if (data.children[i].id === items[j]) {
						data.children.splice(i, 1);
						childRemoved = true;
						break;
					}
				}
				if (!childRemoved)
				{
					if (data.children[i])
						this._removeItems(data.children[i], items);
					i++;
				}
			}
		}
	},

	onJSUpdate: function (e) {
		var data = e.data;

		if (data.jsontype === 'notebookbar')
			return;

		var container = this.content;
		if (!container)
			return;

		var control = container.querySelector('[id=\'' + data.control.id + '\']');
		if (!control) {
			window.app.console.warn('jsdialogupdate: not found control with id: "' + data.control.id + '"');
			return;
		}

		var parent = control.parentNode;
		if (!parent)
			return;

		var scrollTop = control.scrollTop;
		var wasHidden = control.style.display === 'none';

		control.style.visibility = 'hidden';
		if (!this._builder)
			return;

		this._inBuilding = true;

		// preserve the same level for control
		var classList = control.className.split(' ');
		var currentLevel = null;
		for (var i in classList) {
			if (classList[i].indexOf('level-') >= 0) {
				currentLevel = classList[i];
				break;
			}
		}

		if (currentLevel) {
			currentLevel = parseInt(currentLevel.substring('level-'.length));
			this._builder._currentDepth = currentLevel;
		}

		var temporaryParent = window.L.DomUtil.create('div');
		this._builder.build(temporaryParent, [data.control], false);
		parent.insertBefore(temporaryParent.firstChild, control.nextSibling);
		var backupGridSpan = control.style.gridColumn;
		window.L.DomUtil.remove(control);

		// reset _builder._currentDepth
		this._builder._currentDepth = 0;

		// when we updated toolbox or menubutton with color picker we need to leave
		// mobile wizard at the same level (opened color picker) on update
		if (this._currentPath.length) {
			var elem = $('[title=\'' + this._currentPath[this._currentPath.length - 1] + '\'').prev(':visible');
			if (elem.length) {
				// we already were at this level so go back one step and enter again
				this._currentPath.pop();
				this._currentDepth--;
				$(elem).trigger('click', {animate: false});
			}
		}

		var newControl = container.querySelector('[id=\'' + data.control.id + '\']');
		if (newControl) {
			if (wasHidden)
				newControl.style.display = 'none';

			newControl.scrollTop = scrollTop;
			newControl.style.gridColumn = backupGridSpan;
		}

		// avoid scrolling when adding new bigger elements to the view
		$(this.content).animate({ scrollTop: this._currentScrollPosition }, 0);

		this._inBuilding = false;
	},

	onJSAction: function (e) {
		var data = e.data;

		if (data.jsontype === 'notebookbar')
			return;

		if (!this._builder)
			return;

		if (!this.content)
			return;

		// A panel body's visibility in the mobile wizard is driven by
		// goLevelDown and goLevelUp navigation. Ignore server actions aimed
		// at a panel body or its title so a late sidebar refresh cannot
		// collapse a panel the user has just opened. A full update rebuilds
		// the panel when its visibility really has to change.
		if (data.data && data.jsontype === 'sidebar') {
			const targetId = data.data.control_id;
			if (targetId &&
				(targetId.indexOf('contents') === 0 || targetId.indexOf('titlebar') === 0)) {
				window.app.console.log('Ignored action: ' + data.data.action_type + ' for control: ' + targetId);
				return;
			}
		}

		this._builder.executeAction(this.content, data.data);
	},
});

window.L.control.mobileWizardWindow = function (mobileWizard, id) {
	return new window.L.Control.MobileWizardWindow(mobileWizard, id);
};
