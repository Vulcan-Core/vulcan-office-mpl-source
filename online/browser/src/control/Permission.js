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
 * Document permission handler
 */
/* global app $ _ VulcanImpressTextEntry */
window.L.Map.include({
	readonlyStartingFormats: {
		'txt': { canEdit: true, odfFormat: 'odt' },
		'csv': { canEdit: true, odfFormat: 'ods' },
		'xlsb': { canEdit: false, odfFormat: 'ods' }
	},

	setPermission: function (perm) {
		var button = $('#mobile-edit-button');
		button.off('click');
		button.attr('tabindex', 0);
		button.attr('role', 'button');
		button.attr('title', _('Edit document'));
		button.attr('aria-label', _('Edit document'));
		var tabletPresentation =
			window.mode.isTablet() && this.getDocType() === 'presentation';
		// app.file.fileBasedView is new view that has continuous scrolling
		// used for PDF and we don't permit editing for PDFs
		// this._shouldStartReadOnly() is a check for files that should start in readonly mode and even on desktop browser
		// we warn the user about loosing the rich formatting and offer an option to
		// save as ODF instead of the current format
		//
		// For mobile we need to display the edit button for all the cases except for PDF (which is read-only)
		// we offer save-as to another place where the user can edit the document
		// The FAB is the ONLY way out of the read posture, so its condition and
		// the posture's condition below must stay in lockstep. Show it whenever
		// a touch device could actually land in that posture -- which now
		// excludes phone Calc, except when the file itself should start
		// read-only, where the escape hatch is still needed.
		//
		// readonly-because-lockfailed keeps the pencil visible on the phone,
		// dimmed, regardless of posture (Calc included): tapping it retries
		// the lock (wired in the readonly branch below).
		//
		// A non-writing WEB session draws NO fork pencil at all. Stock says
		// this too -- but only in the LAST arm of the readonly chain below,
		// and both lock branches sit AHEAD of it: a session that reads as
		// locked got a button wired to the unlock popup, and a lockRetry
		// state got a visible dimmed pencil, for a document that session was
		// never going to edit here anyway. Since round 8 the host clamps
		// iPhone-web tokens to view grade and draws its OWN pencil (the gate
		// card's, the only edit affordance in that state), so a fork pencil
		// there is a second pencil on one screen leading to a lock dialog.
		// Hoisted to govern BOTH the visibility decision and the wiring --
		// hiding without ungating lockRetry would leave a shown-then-dead
		// button, which is worse than either.
		//
		// The app is untouched: ThisIsAMobileApp (iOS and Android) short-
		// circuits this, and it is where editing lives.
		var webSessionCannotWrite = !window.ThisIsAMobileApp
			&& !this['wopi'].UserCanWrite;
		var lockRetry = app.file.readOnly && this.options.canTryLock === true
			&& window.mode.isSmallScreenDevice() && !webSessionCannotWrite;
		button.toggleClass('lock-retry', lockRetry);
		// Has this session already been through a mode? _permission is written
		// in exactly two places -- _enterEditMode and _enterReadOnlyMode --
		// and BOTH run after the show/hide decision below, so reading it here
		// answers "is this the first open?" for the whole method. ONE
		// definition: the 'edit' branch further down consumes this same
		// variable rather than re-spelling the test, because two spellings of
		// one predicate is how they drift apart.
		var firstOpen = this._permission === undefined;
		// Re-entry: a writeable phone session entering view/readonly
		// mid-session (a critical error demotes to 'view', CanvasTileLayer
		// _mapOnError) must get the pencil even where the FIRST-OPEN posture
		// carve-out excludes it -- phone Calc's carve-out is about the open,
		// not about a downgrade, and the readonly branch below wires
		// _switchToEditMode for exactly this case. Server-enforced readonly
		// stays hidden: app.file.readOnly guards the whole arm.
		//
		// !firstOpen is the term this variable's NAME and the comment above
		// have always claimed and the expression never carried. Without it
		// "re-entry" also matched the FIRST open of a writeable phone session
		// whose permission was anything but 'edit' -- which is a plain phone
		// Calc open, since app.setPermission (docstatefunctions) has branches
		// for 'edit' and 'readonly' only and leaves app.file.readOnly false
		// for 'view'. The pencil went up at open and came down again when the
		// later 'perm: edit' re-ran this method: a stray pencil "at first",
		// on a document the carve-out says opens straight into the sheet.
		var reEntry = perm !== 'edit' && !firstOpen
			&& window.mode.isSmallScreenDevice()
			&& this['wopi'].UserCanWrite;
		if (!webSessionCannotWrite
			&& (lockRetry
			|| (!app.file.readOnly && (window.mode.isSmallScreenDevice() || window.mode.isTablet())
			&& (this._usesTouchReadPosture() || this._shouldStartReadOnly() || reEntry)))) {
			button.css('display', 'flex');
		} else {
			button.hide();
		}
		var that = this;
		if (perm === 'edit') {
			// Only apply the opt-in gate when the doc is first opened;
			// later setPermission calls (reload, save-as, server perm
			// changes) honor what was asked.
			//
			// PRESENTATIONS KEEP THIS GATE. Google Slides is explicit that
			// "on phone the presentation opens in a read/view posture, not
			// edit", and that the creation-focused first open is the
			// TABLET/foldable behaviour, not the phone's. So phone Impress
			// stays read-first: the FAB below is the pencil that opens the
			// editor, and MouseControl's tap grammar adds the second door
			// Slides gives you ("Edit slide" on the contextual bar, or a
			// double tap). Do not generalise a per-doctype exemption to
			// Impress from Writer or Calc — theirs is a different call.
			//
			// firstOpen is hoisted above the show/hide decision (see there);
			// this branch and `reEntry` are the same question asked twice, so
			// they read the same variable.
			if (firstOpen && (this._shouldStartReadOnly() || this._usesTouchReadPosture())) {
				button.on('click', function () {
					that._switchToEditMode();
				});

				// temporarily, before the user touches the floating action button
				this._enterReadOnlyMode('readonly');
			}
			else if (this.options.canTryLock) {
				// This is a success response to an attempt to lock using mobile-edit-button
				this._switchToEditMode();
			}
			else {
				// Editable Impress tablets/foldables enter the canvas directly.
				// The generic touch preamble above showed the pencil before the
				// document type was considered; do not leave that phone-only
				// affordance floating over an already-editable tablet.
				if (tabletPresentation)
					button.hide();
				this._enterEditMode(perm);
			}
		}
		else if (perm === 'view' || perm === 'readonly') {
			// FIRST, not last (see webSessionCannotWrite above): a non-writing
			// web session gets no button and no handler, so neither lock
			// branch below can wire one behind the host's gate pencil.
			if (webSessionCannotWrite) {
				button.hide();
			}
			else if (lockRetry) {
				// Success comes back as 'perm: edit' (routed to the
				// canTryLock branch above); failure as another 'lockfailed:'
				// (onLockFailed re-shows the notice).
				button.on('click', function () {
					app.socket.sendMessage('attemptlock');
				});
			}
			else if (this.isLockedReadOnlyUser()) {
				button.on('click', function () {
					that.openUnlockPopup();
				});
			}
			else if (window.ThisIsTheAndroidApp) {
				button.on('click', function () {
					that._requestFileCopy();
				});
			} else if (window.mode.isSmallScreenDevice() || window.mode.isTablet()) {
				// Writeable user stepped back from edit to readonly: keep the FAB
				// visible so they can re-enter edit mode.
				button.on('click', function () {
					that._switchToEditMode();
				});
			}

			this._enterReadOnlyMode(perm);
		}
	},

	// Ask wsd to retry the WOPI lock for a session it demoted to read-only
	// because the lock failed. The ONLY way such a session becomes editable:
	// wsd answers with 'perm: edit' (the canTryLock branch of setPermission
	// above enters edit mode) or with another 'lockfailed:' (onLockFailed).
	// Entering edit mode here, client-side, is what lost the 9/29 edits: the
	// view looked editable while storage still refused every save.
	//
	// Callers: the desktop Edit button (PermissionMode) and the lock-failed
	// modal.
	attemptEditLock: function () {
		if (!app.isReadOnly() || this.options.canTryLock !== true || !app.socket)
			return;
		app.socket.sendMessage('attemptlock');
		var permissionMode = this.uiManager && this.uiManager.permissionViewMode;
		if (permissionMode && typeof permissionMode.setLockAttemptPending === 'function')
			permissionMode.setLockAttemptPending(true);
	},

	onLockFailed: function(reason) {
		// canTryLock === false used to mean "the user chose to edit locally,
		// ignore lockfailed". Edit mode can no longer be entered locally on a
		// read-only session (_proceedEditMode), so false now only means "the
		// lock was granted". A later demotion (wsd sends 'perm: readonly'
		// first, so app.isReadOnly() is already true) is a fresh failure and
		// must re-arm the retry, or the session is stranded with no Edit.
		if (this.options.canTryLock === false && app.isReadOnly())
			this.options.canTryLock = undefined;

		var initialNotification = this.options.canTryLock === undefined;
		if (initialNotification) {
			// This is the initial notification. This status is not permanent.
			// Allow to try to lock the file for edit again.
			this.options.canTryLock = true;
		}
		// Settle the desktop Edit button: any pending "Getting edit access"
		// ends here, and the button shows now that a retry is allowed.
		var permissionMode = this.uiManager && this.uiManager.permissionViewMode;
		if (permissionMode && typeof permissionMode.setLockAttemptPending === 'function')
			permissionMode.setLockAttemptPending(false);

		if (initialNotification) {
			if (window.mode.isSmallScreenDevice()) {
				// Phone: no blocking modal. Wire the dimmed retry pencil here
				// directly -- 'lockfailed:' can arrive before the docLayer
				// exists, and the post-load setPermission re-runs the same
				// wiring once canTryLock is known.
				this._showLockFailedNotice();
				var button = $('#mobile-edit-button');
				button.addClass('lock-retry');
				button.css('display', 'flex');
				button.off('click').on('click', function () {
					app.socket.sendMessage('attemptlock');
				});
				return;
			}

			var alertMsg = _('The document could not be locked, and is opened in read-only mode.');
			if (reason) {
				alertMsg += '\n' + _('Server returned this reason:') + '\n"' + reason + '"';
			}
			var that = this;
			this.uiManager.showConfirmModal('lock_failed_message', '', alertMsg, _('OK'), function() {
				that.attemptEditLock();
			}, true);
		}
		else if (this.options.canTryLock) {
			// This is a failed response to an attempt to lock using mobile-edit-button
			if (window.mode.isSmallScreenDevice()) {
				this._showLockFailedNotice();
				return;
			}
			alertMsg = _('The document could not be locked.');
			if (reason) {
				alertMsg += '\n' + _('Server returned this reason:') + '\n"' + reason + '"';
			}
			this.uiManager.showConfirmModal('lock_failed_message', '', alertMsg, _('OK'), null, true);
		}
		// do nothing if this.options.canTryLock is defined and is false
	},

	_showLockFailedNotice: function() {
		this.uiManager.showSnackbar(
			_('View only — this document could not be locked for editing. Tap the pencil to try again.'),
			null, null, 6000, false, true);
	},

	_getFileExtension: function (filename) {
		return filename.substring(filename.lastIndexOf('.') + 1);
	},

	// Whether a touch device opens read-only behind the edit FAB.
	//
	// Phone CALC opts out (docs/mobile-redesign/02 §5). Google Sheets on a
	// phone puts you in the sheet: you tap a cell and type. Our posture cost
	// a discovery step AND re-geometried the grid between document-visible
	// and first keystroke, which is the single worst thing about the first
	// thirty seconds -- it also stacked a FAB on the sheet-tab strip and gave
	// the user two checkmarks that meant different things.
	//
	// Writer and Impress KEEP the posture: on those a stray tap on a phone
	// really does mutate the document in a way that is hard to notice, and
	// Google's own phone apps make you enter edit mode there too.
	//
	// Tablets keep it everywhere -- tablets are a separate, later phase and
	// nothing here has been designed or tested for them.
	//
	// _shouldStartReadOnly() is deliberately NOT folded in here: that is about
	// the FILE (locked user, a format we would degrade on save), not the form
	// factor, and it must keep applying to phone Calc.
	// Two carve-outs, one per lane, and they are NOT symmetric — each says
	// "this form factor + this document type opens straight into editing
	// rather than behind the pencil":
	//
	//   phone Calc      (Calc lane)    — a spreadsheet on a phone opens in the
	//                                    sheet; a read posture over a grid is
	//                                    just a worse grid.
	//   tablet Impress  (Impress lane) — a deck on a tablet opens in the deck;
	//                                    the tablet is where slides get built.
	//
	// The Impress lane expressed its half inline at the call site as
	// `isSmallScreenDevice() || (isTablet() && docType !== 'presentation')`,
	// which disagreed with this function on exactly those two cells (it would
	// have put phone Calc back behind the pencil). Both carve-outs are kept
	// here so there is ONE definition of the posture; do not re-inline either.
	_usesTouchReadPosture: function () {
		if (!window.mode.isSmallScreenDevice() && !window.mode.isTablet())
			return false;
		var docType = this._docLayer && this._docLayer._docType;
		// FAIL CLOSED on a phone that does not yet know what it is holding.
		// Both carve-outs below are stated as "this form factor AND this
		// document type", so an unknown docType makes every carve-out false
		// and the function answers "read posture" -- i.e. the predicate fails
		// TOWARD showing a pencil, on the one form factor where a stray
		// pencil is the defect. A phone Calc whose setPermission runs before
		// _docLayer is assigned is exactly that case.
		//
		// Nothing is lost by waiting: the load path always re-runs this with
		// the docLayer present (CanvasTileLayer's onAdd calls setPermission
		// after Socket assigns _docLayer), so a phone Writer or Impress that
		// genuinely wants the read posture gets its pencil one setPermission
		// later rather than never. Tablets are untouched -- they keep the
		// posture everywhere and are a separate, later phase.
		if (!docType && window.mode.isSmallScreenDevice())
			return false;
		var isPhoneCalc = window.mode.isSmallScreenDevice()
			&& docType === 'spreadsheet';
		var isTabletImpress = !window.mode.isSmallScreenDevice()
			&& window.mode.isTablet()
			&& docType === 'presentation';
		return !isPhoneCalc && !isTabletImpress;
	},

	_shouldStartReadOnly: function () {
		if (this.isLockedReadOnlyUser())
			return true;
		if (window.coolParams.get('startreadonly') === 'true') {
			return true;
		}
		var fileName = this['wopi'].BaseFileName;
		// use this feature for only integration.
		if (!fileName) return false;
		var extension = this._getFileExtension(fileName).toLowerCase();
		
		// Check if this is a view mode format from server configuration
		if (app.isViewModeExtension(extension)) return true;
		
		if (!Object.prototype.hasOwnProperty.call(this.readonlyStartingFormats, extension))
			return false;
		return true;
	},

	_proceedEditMode: function() {
		// Never flip a session the SERVER holds read-only (a failed WOPI lock,
		// a view-only token) into edit mode client-side: the view would take
		// keystrokes that no save can ever reach storage with. A lock-failed
		// session gets there through attemptEditLock and wsd's 'perm: edit',
		// which clears app.file.readOnly before setPermission lands here.
		// Also leaves canTryLock armed, so the retry stays available.
		if (app.isReadOnly())
			return;
		var fileName = this['wopi'].BaseFileName;
		if (fileName) {
			var extension = this._getFileExtension(fileName);
			var extensionInfo = this.readonlyStartingFormats[extension];
			if (extensionInfo && !extensionInfo.canEdit)
				return;
		}
		this.options.canTryLock = false; // don't respond to lockfailed anymore
		$('#mobile-edit-button').hide();
		this._enterEditMode('edit');
		if (window.mode.isSmallScreenDevice() || window.mode.isTablet() || window.mode.isCODesktop()) {
			this.fire('editorgotfocus');
			this.fire('closemobilewizard');
		}

		// In the iOS/android app, just clicking the mobile-edit-button is not
		// reason enough to pop up the on-screen keyboard, so skip the focus
		// there.
		if (!(window.ThisIsTheiOSApp || window.ThisIsTheAndroidApp)) {
			if (window.mode.isSmallScreenDevice()) {
				// PHONE: the keyboard must rise on this very tap. Two
				// constraints force both halves of this call:
				//  - SYNCHRONOUS, because iOS Safari only honours a
				//    programmatic focus() while the user-gesture call stack
				//    is still live; the onDrain deferral below lands outside
				//    it and the keyboard silently stays down (the audited
				//    behaviour: enter edit, then tap AGAIN to type — two taps
				//    for Google's one).
				//  - acceptInput === true, because TextInput.focus() treats
				//    anything else on an onscreen-keyboard device as "focus
				//    without keyboard" (the readonly-attribute trick) and on
				//    the literal iPhone branch will not focus the textarea at
				//    all.
				// WRITER ONLY: entering edit puts the caret in body text, so
				// there is something to type into.
				if (this._docLayer && this._docLayer._docType === 'text')
					this.focus(true);
				else
					// Impress and Calc enter edit with NO text target open —
					// Google's phone apps raise no keyboard here either. The
					// deck's shape text and the sheet's cell editor summon it
					// at their own entry doors (CanvasTileLayer's cursor
					// handler, the Calc double tap), so focus WITHOUT the
					// keyboard.
					this.focus(false);
			} else {
				// Desktop: defer until the layouting queue drains; the
				// notebookbar dropdown queues a task on close that would
				// otherwise steal focus back.
				app.layoutingService.onDrain(this.focus.bind(this));
			}
		}
	},

	_offerSaveAs: function() {
		var fileName = this['wopi'].BaseFileName;
		if (!fileName) return false;
		var extension = this._getFileExtension(fileName);
		var extensionInfo = this.readonlyStartingFormats[extension];
		var saveAsFormat = extensionInfo.odfFormat;

		var defaultValue = fileName.substring(0, fileName.lastIndexOf('.')) + '.' + saveAsFormat;
		this.uiManager.showInputModal('save-as-modal', '', _('Enter a file name'), defaultValue, _('OK'), function() {
			var value = document.getElementById('save-as-modal').querySelectorAll('#input-modal-input')[0].value;
			if (!value)
				return;
			else if (value.substring(value.lastIndexOf('.') + 1) !== saveAsFormat) {
				value += '.' + saveAsFormat;
			}
			this.saveAs(value, saveAsFormat);
		}.bind(this));
	},

	// Show dialog when in WASM mode asking user to choose between
	// editing locally (WASM) or joining collaborative editing (server).
	// Show a two-column "card" dialog with a title, a subtitle,
	// and two side-by-side options each with a heading, a short
	// description, and a button.  If @p titleAvatar is a non-empty
	// URL, it is rendered as a circular image to the left of the
	// title (used for "X started editing").  Styling is applied by
	// CSS via the #collab-choice-dialog id.
	// @p title may be either a plain string or an object
	//   { name: '...', rest: '...' }
	// In the latter case, and when @p titleAvatar is set,
	// the avatar + name are wrapped in a pill and the rest
	// of the title text follows outside the pill.
	_showTwoCardDialog: function (id, title, subtitle, cards, titleAvatar) {
		var dialogId = this.uiManager.generateModalId(id);
		var that = this;

		var titleChildren = [];
		if (typeof title === 'object' && titleAvatar) {
			titleChildren.push({
				id: 'collab-choice-pill',
				type: 'container',
				vertical: false,
				children: [
					{
						id: 'collab-choice-avatar',
						type: 'image',
						image: titleAvatar,
						text: ''
					},
					{
						id: 'collab-choice-name',
						type: 'fixedtext',
						text: title.name
					}
				]
			});
			titleChildren.push({
				id: 'collab-choice-title',
				type: 'fixedtext',
				text: title.rest
			});
		}
		else {
			if (titleAvatar) {
				titleChildren.push({
					id: 'collab-choice-avatar',
					type: 'image',
					image: titleAvatar,
					text: ''
				});
			}
			titleChildren.push({
				id: 'collab-choice-title',
				type: 'fixedtext',
				text: (typeof title === 'object' ?
					(title.name + ' ' + title.rest) : title)
			});
		}

		// Icon paths in c.icon are theme-agnostic stems
		// ('images/coda-collab-<name>'); pick the dark or light
		// variant once, here at build time, based on the current
		// dark-theme pref.  The dialog is modal and short-lived, so
		// a theme change mid-decision (which would leave the icon
		// stale) is not worth optimising for.
		var darkTheme = window.prefs.getBoolean('darkTheme');
		var iconSuffix = darkTheme ? '-dark.svg' : '-light.svg';

		var cardWidgets = cards.map(function (c) {
			return {
				id: c.id + '-card',
				type: 'container',
				vertical: true,
				children: [
					{
						id: c.id + '-card-icon',
						type: 'image',
						image: c.icon + iconSuffix,
						text: ''
					},
					{
						id: c.id + '-card-heading',
						type: 'fixedtext',
						text: c.heading
					},
					{
						id: c.id + '-card-description',
						type: 'fixedtext',
						text: c.description
					}
				]
			};
		});

		var json = {
			id: dialogId,
			dialogid: id,
			type: 'modalpopup',
			title: '',
			hasClose: false,
			hasOverlay: true,
			cancellable: false,
			jsontype: 'dialog',
			'init_focus_id': 'response',
			children: [{
				id: 'collab-choice-dialog',
				type: 'container',
				vertical: true,
				children: [
					{
						id: 'collab-choice-title-row',
						type: 'container',
						vertical: false,
						children: titleChildren
					},
					{
						id: 'collab-choice-subtitle',
						type: 'fixedtext',
						text: subtitle
					},
					{
						id: 'collab-choice-cards',
						type: 'container',
						vertical: false,
						children: cardWidgets
					}
				]
			}]
		};

		this.uiManager.showModal(json);

		// The jsdialog builder renders the dialog asynchronously, so the card containers (and
		// the avatar <img>, if any) only exist some short time after showModal returns; poll
		// briefly for them and wire up the click and image-error handlers once present.
		var tries = 0;
		var wire = function () {
			var anyMissing = false;
			cards.forEach(function (c) {
				var card = document.getElementById(c.id + '-card');
				if (!card) {
					anyMissing = true;
					return;
				}
				if (card.dataset.codaCollabCardWired) return;
				card.dataset.codaCollabCardWired = '1';
				card.setAttribute('role', 'button');
				card.setAttribute('tabindex', '0');
				card.addEventListener('click', function () {
					that.uiManager.closeModal(dialogId);
					c.onClick();
				});
				card.addEventListener('keydown', function (e) {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						that.uiManager.closeModal(dialogId);
						c.onClick();
					}
				});
			});
			if (titleAvatar) {
				var img = document.getElementById('collab-choice-avatar');
				if (!img) {
					anyMissing = true;
				} else if (!img.dataset.codaCollabAvatarWired) {
					img.dataset.codaCollabAvatarWired = '1';
					img.onerror = function () { img.style.display = 'none'; };
					if (img.complete && img.naturalWidth === 0)
						img.style.display = 'none';
				}
			}
			if (anyMissing && ++tries < 50)
				setTimeout(wire, 50);
		};
		setTimeout(wire, 0);
	},

	// The user wants to start editing while other users are
	// viewing.  Offer the choice between editing locally
	// (changes sync on save) or starting a collaborative
	// session (all users edit together in real-time).
	_showWasmEditChoice: function () {
		var that = this;
		this._showTwoCardDialog(
			'wasm-edit-choice-modal',
			_('How would you like to edit?'),
			_('Other users are viewing this document. Choose how you\'d like to continue:'),
			[
				{
					id: 'edit-locally',
					icon: 'images/coda-collab-local-editing',
					heading: _('Edit locally'),
					description: _('Changes sync when you save'),
					onClick: function () { that._proceedEditMode(); }
				},
				{
					id: 'start-collaborative',
					icon: 'images/coda-collab-collaborative-editing',
					heading: _('Collaborative editing'),
					description: _('Edit together in real-time'),
					onClick: function () { that._saveAndSwitchToServerMode(); }
				}
			]
		);
	},

	// Show a "keep viewing vs. join collab editing" choice using
	// the two-card layout.  Used both when another user has just
	// started editing and when a collaborative session is already
	// active - only the title/subtitle (and optional avatar image
	// shown next to the title) differ.
	_showCollabJoinDialog: function (title, subtitle, avatar) {
		var that = this;
		this._showTwoCardDialog(
			'collab-join-modal',
			title,
			subtitle,
			[
				{
					id: 'collab-keep-viewing',
					icon: 'images/coda-collab-local-viewing',
					heading: _('Keep viewing local copy'),
					description: _('Continue with your version'),
					onClick: function () {
						// Stay in current WASM read-only mode.
					}
				},
				{
					id: 'collab-join',
					icon: 'images/coda-collab-collaborative-editing',
					heading: _('Join collaborative editing'),
					description: _('Edit together in real-time'),
					onClick: function () {
						if (window.collabEditingActive) {
							// Someone is editing locally - ask them to
							// save and switch, then wait.
							that._waitForCollabSave();
							window.collabSendMessage({type: 'switch_to_collab'});
						} else {
							// No active editor - just switch directly.
							window.switchToServerMode();
						}
					}
				}
			],
			avatar
		);
	},

	// Start waiting for the local editor to save and switch.
	// Shows a busy indicator and sets a timeout so we switch
	// even if the editor does not respond (e.g., they have a
	// dialog open or have already left).
	_waitForCollabSave: function () {
		this._waitingForCollabSwitch = true;
		this.fire('showbusy', {
			label: _('Waiting for changes to be saved...')
		});
		var that = this;
		this._collabSaveTimeout = setTimeout(function () {
			that._finishCollabSwitch();
		}, 10000);
	},

	// Called when the wait is over (editor saved, timed out, or
	// all other users left).  Cleans up and switches.
	_finishCollabSwitch: function () {
		if (!this._waitingForCollabSwitch)
			return;
		this._waitingForCollabSwitch = false;
		if (this._collabSaveTimeout) {
			clearTimeout(this._collabSaveTimeout);
			this._collabSaveTimeout = null;
		}
		this.fire('hidebusy');
		window.switchToServerMode();
	},

	// The local editor has saved and is switching to server mode.
	_onEditorSavedAndSwitching: function () {
		this._finishCollabSwitch();
	},

	// A collab user left while we were waiting for their save.
	// If no other collab users remain, switch now.
	_onCollabUserLeft: function () {
		if (this._waitingForCollabSwitch
			&& window.collabUsers && window.collabUsers.length === 0) {
			this._finishCollabSwitch();
		}
	},

	// Save any local-edit changes and then switch to server mode.
	// If the document has been modified, .uno:Save triggers the
	// per-platform upload path (collabSaveToServer for COWASM, the
	// commandresult-driven collabUploadFile in main.js for CODA),
	// and the _switchToServerAfterSave flag causes switchToServerMode
	// to be called after the upload completes.  If there are no
	// modifications, .uno:Save is a no-op and we switch immediately.
	_saveAndSwitchToServerMode: function () {
		if (this._permission === 'edit' && this._everModified) {
			window._switchToServerAfterSave = true;
			this.save(true /* dontTerminateEdit */,
				false /* dontSaveIfUnmodified */);
		} else {
			window.collabSendMessage({type: 'saved_and_switching'});
			window.switchToServerMode();
		}
	},

	// Save any local-edit changes and then close the window.  Mirrors
	// _saveAndSwitchToServerMode but the post-save action is window
	// close, signalled to the native host via a CLOSE_WINDOW message
	// in main.js's commandresult handler once the save (and, for
	// remote docs, the subsequent integrator upload) completes.
	_saveAndClose: function () {
		if (this._permission === 'edit' && this._everModified) {
			window._closeAfterSave = true;
			this.save(true /* dontTerminateEdit */,
				false /* dontSaveIfUnmodified */);
		} else {
			window.postMobileMessage('CLOSE_WINDOW');
		}
	},

	// Another user wants to start collaborative editing.  Save
	// local changes and switch to server mode.  If a dialog is
	// already open (e.g., the edit choice dialog), do nothing -
	// the user will make their own choice via the dialog buttons.
	_onSwitchToCollabRequest: function () {
		if (this.uiManager.isAnyDialogOpen())
			return;
		this._saveAndSwitchToServerMode();
	},

	// A newly-joining user opens a document where a
	// collaborative editing session is already active.
	_onCollabEditingActive: function () {
		this._showCollabJoinDialog(
			_('How would you like to edit?'),
			_('Other users are editing this document. Choose how you\'d like to continue:'));
	},

	// Another user has just started editing while we were
	// viewing.  Offer to keep viewing locally or join the
	// collaborative session.
	_onOtherUserEditingStarted: function (userName, avatar) {
		// We are editing ourselves: don't offer to switch (and risk
		// dropping our in-progress local changes); the conflict gets
		// resolved at next save.  This is reachable via the /cool/ws
		// bridge in CollabBroker, since plain-COOL's editing_started
		// can land here while we are mid-edit.
		if (this.isEditMode())
			return;
		this._showCollabJoinDialog(
			avatar
				? { name: userName, rest: _('started editing') }
				: _('%0 started editing').replace('%0', userName),
			_('Someone else is now editing this document. Choose how you\'d like to continue:'),
			avatar);
	},

	// from read-only to edit mode
	_switchToEditMode: function () {
		// posture_flip_ms origin stamp; consumed (and cleared) by
		// _enterEditMode, so a direct edit-at-load entry emits nothing.
		this._vulcanPostureFlipStartMs = performance.now();

		// Notify the collab broker that editing is starting so that
		// users who join later are informed.
		if (window.ThisIsTheEmscriptenApp || window.mode.isCODesktop()) {
			window.collabSendMessage({type: 'editing_started'});
		}

		// With other collab users present, offer the choice between
		// local and collaborative editing.
		if ((window.ThisIsTheEmscriptenApp || window.mode.isCODesktop())
			&& window.collabUsers && window.collabUsers.length > 0) {
			this._showWasmEditChoice();
			return;
		}

		// This will be handled by the native mobile app instead
		if (this._shouldStartReadOnly() && !window.ThisIsAMobileApp) {
			var fileName = this['wopi'].BaseFileName;
			var extension = this._getFileExtension(fileName);

			// For defined formats (from server config), just proceed to edit mode without dialog
			if (app.isViewModeExtension(extension)) {
				this._proceedEditMode();
				return;
			}

			var extensionInfo = this.readonlyStartingFormats[extension];

			var yesButtonText = !this['wopi'].UserCanNotWriteRelative ? _('Save as ODF format'): null;
			var noButtonText = extensionInfo.canEdit ? _('Continue editing') : _('Continue read only');

			if (!yesButtonText) {
				yesButtonText = noButtonText;
				noButtonText = null;
			}

			var yesFunction = !noButtonText ? function() { this._proceedEditMode(); }.bind(this) : function() { this._offerSaveAs(); }.bind(this);
			var noFunction = function() { this._proceedEditMode(); }.bind(this);

			this.uiManager.showYesNoButton(
				'switch-to-edit-mode-modal', // id.
				'', // Title.
				_('This document may contain formatting or content that cannot be saved in the current file format.'), // Message.
				yesButtonText,
				noButtonText,
				yesFunction,
				noFunction,
				false // Cancellable.
			);
		} else {
			this._proceedEditMode();
		}
	},

	_requestFileCopy: function() {
		if (app.isReadOnly()) {
			window.postMobileMessage('REQUESTFILECOPY');
		} else {
			this._switchToEditMode();
		}
	},

	// Tell core whether this view is read-only, and update the client-side
	// comment and redline edit flags to match. This applies only to a session
	// that is editing-capable but currently viewing, so toggling between view
	// and edit must flip the flags. A session whose document is genuinely
	// read-only is skipped: core already set it read-only at session start,
	// and its comment and redline flags already reflect the real document
	// state (for example comments allowed on an otherwise read-only PDF), so
	// they must not be overwritten here. app.isReadOnly() carries the real
	// document permission for every host, online or desktop, and the view
	// and edit toggle does not change it, so it is the right gate to use.
	_applyViewReadOnly: function (readOnly) {
		if (app.isReadOnly())
			return;
		if (app.socket) {
			// Flush BEFORE the view flips read-only: core silently swallows
			// .uno:Save dispatched into a read-only view — no result, no
			// error frame — so every save issued after this flip hangs: the
			// host's exit save (its 10s timeout is the phone's "Couldn't
			// save your changes"), wsd's autosave, and the final unload save
			// (logged as "Data loss detected"). Measured live on slot-01,
			// 8/20; the desktop grammar never hits it because nothing there
			// re-enters the read posture with unsaved changes. Sent
			// unconditionally because the client's modified flag can be
			// stale; an unmodified document makes it a server-side no-op
			// (dontSaveIfUnmodified). Ordering is guaranteed by the single
			// socket: wsd forwards both to the kit's one queue, so the save
			// runs while the view is still editable.
			if (readOnly)
				app.socket.sendMessage('save dontTerminateEdit=1 dontSaveIfUnmodified=1');
			app.socket.sendMessage('setviewreadonly value=' + readOnly);
		}
		app.file.editComment = !readOnly;
		app.file.allowManageRedlines = !readOnly;
	},

	_enterEditMode: function (perm) {
		this._permission = perm;

		if ((window.mode.isSmallScreenDevice() || window.mode.isTablet()) && this._textInput && this.getDocType() === 'text') {
			this._textInput.setSwitchedToEditMode();
		}

		if (app.map['stateChangeHandler'].getItemValue('EditDoc') === 'false')
			app.map.sendUnoCommand('.uno:EditDoc?Editable:bool=true');

		// Re-enable direct-canvas interactions (shape drag, arrow-key
		// shape move) that the matching _enterReadOnlyMode branch
		// disabled.
		this._applyViewReadOnly(false);

		app.events.fire('updatepermission', {perm : perm});

		// posture_flip_ms: elapsed since _switchToEditMode's stamp. First
		// post-flip tile paint has no cheap hook from this file (paints live
		// in TilesSection), so the phases are the permission fire and the
		// map's one-shot editorgotfocus (TextInput focus settled).
		if (app.telemetry && this._vulcanPostureFlipStartMs !== undefined) {
			var vulcanFlipStartMs = this._vulcanPostureFlipStartMs;
			var vulcanFlipMap = this;
			delete this._vulcanPostureFlipStartMs;
			app.telemetry.record('posture_flip_ms', {
				phase: 'updatepermission_fired',
				ms: Math.round(performance.now() - vulcanFlipStartMs)
			});
			// One armed listener max: a re-flip before focus settles would
			// otherwise stack once-handlers and double-emit on the next focus.
			if (this._vulcanPostureFlipFocusHandler)
				this.off('editorgotfocus', this._vulcanPostureFlipFocusHandler);
			this._vulcanPostureFlipFocusHandler = function () {
				vulcanFlipMap._vulcanPostureFlipFocusHandler = null;
				app.telemetry.record('posture_flip_ms', {
					phase: 'textinput_focus_settled',
					ms: Math.round(performance.now() - vulcanFlipStartMs)
				});
			};
			this.once('editorgotfocus', this._vulcanPostureFlipFocusHandler);
		}

		// Entering edit mode must not discard the reading zoom -- PHONES ONLY.
		//
		// Stock slammed Writer to zoom LEVEL 10 here, which Map.js
		// getZoomPercent maps to exactly 100%. It ran AFTER the
		// updatepermission above, so the chrome flipped and the page then
		// jumped under the tap that had just entered edit mode; and
		// _enterReadOnlyMode has no matching setZoom, so read -> edit -> read
		// LOST whatever the reader had pinched to and never gave it back.
		// There is no zoom control in the phone chrome to recover it with
		// (Control.StatusBar's zoom widget is desktop); the only route back is
		// a two-finger canvas pinch, which snaps to whole zoom levels
		// (MouseControl.onMultiTouchEnd ceil/floors), so a reader could not
		// even land on the level they started from.
		//
		// Writer on a phone opens as a VIEWER behind the edit FAB (see
		// _usesTouchReadPosture). The zoom is therefore the state of the
		// posture the user is stepping out of for one spot edit, and the
		// cheapest correct thing is to leave it alone: read at Z -> edit at Z
		// -> read at Z. Lossless, no jump, and nothing to restore.
		//
		// Deliberately NOT "remember it and restore it on the way back": that
		// would only move the loss to the other direction (a zoom changed
		// while editing would be thrown away on Done) and would add a second
		// forced jump where today there is none. Preserving costs zero
		// motion; restoring buys one lossy round trip by selling another.
		//
		// TABLETS ARE UNCHANGED, deliberately -- same split _usesTouchReadPosture
		// makes above: tablets are a separate, later phase and nothing here has
		// been designed or tested for them. js/global.js defines isTablet() as
		// `L.Browser.mobile && !isSmallScreenDevice()`, so the stock condition
		// `isSmallScreenDevice() || isTablet()` is just `L.Browser.mobile`, and
		// removing the phone half of it leaves exactly isTablet(). Substituting
		// isSmallScreenDevice() to false recovers the stock branch verbatim.
		if (this._docLayer._docType === 'text' && window.mode.isTablet()) {
			this.setZoom(10);
		}

		// IMPRESS, PHONE. The block above is Writer's and is untouched; this is
		// the other half of the same argument, reached by the same reasoning
		// running the other way.
		//
		// The Writer rationale has two premises: (1) the zoom you are leaving is
		// a reading state worth keeping, and (2) fit-to-width is legible, so a
		// forced jump buys nothing. On a phone deck (1) still holds and (2) is
		// false: a 16:9 slide fitted to 393 px lands on zoom rung 3, where 14pt
		// table text measures 5.2 CSS px and 18pt body 6.7 -- both measured on a
		// built image, both reproduced to the reported precision by the model in
		// VulcanImpressTextZoom. Fit-to-width in Impress is unreadable BY
		// CONSTRUCTION, so the conclusion inverts while premise (1) is honoured
		// -- by SYMMETRIC RESTORE, not by skipping the zoom.
		//
		// Nothing zooms here, deliberately. There is no shape to zoom to at
		// document-edit-entry; the zoom happens when the user opens a shape's
		// text and is undone when they leave it. This call only clears any state
		// a previous edit session left behind, so a stale saved view can never
		// be applied to this one.
		//
		// NOT gated on isSmallScreenDevice() here: VulcanImpressTextEntry makes
		// that test itself, with the same three-part phone-Impress gate every
		// other Vulcan branch uses, so there is one definition of the gate
		// rather than two that can drift.
		//
		// The typeof guard is not defensive padding: `class X` at the top level
		// of a script creates a GLOBAL LEXICAL binding, not a property of
		// window, so there is nothing to feature-test with `window.X`, and
		// mocha_tests extracts methods out of this file with `new Function`,
		// where a bare reference to a class the extract never loaded would
		// throw. Same idiom Control.ImpressSelectionBar uses for GraphicSelection.
		if (typeof VulcanImpressTextEntry !== 'undefined')
			VulcanImpressTextEntry.onEnterEditMode();

		// IMPRESS, PHONE, the other half of the entry: the gesture that flipped
		// this session into edit mode can trail one browser-synthesised click,
		// re-targeted at the canvas once the control that took the tap is gone
		// (the read bar hides on entry; WebKit re-hit-tests the compat click).
		// Left alone it lands in the fresh editable session as a count 1 and
		// selects whatever sits under where the button was -- the "Edit slide
		// auto-selects the title" defect measured on slot-01. The guard consumes
		// exactly that click and no other: MouseControl clears it on the next
		// real finger-down. Self-gated to phone Impress inside the method, so
		// this call is inert for every other document type and form factor.
		if (app.activeDocument && app.activeDocument.mouseControl &&
			app.activeDocument.mouseControl.vulcanArmImpressEditEntryClickGuard)
			app.activeDocument.mouseControl.vulcanArmImpressEditEntryClickGuard();

		if (window.ThisIsTheiOSApp && window.mode.isTablet() && this._docLayer._docType === 'spreadsheet')
			this.showCalcInputBar();

		if (window.ThisIsTheAndroidApp)
			window.postMobileMessage('EDITMODE on');
	},

	_enterReadOnlyMode: function (perm) {
		var vulcanPreviousPermission = this._permission;
		this._permission = perm;

		// FIRST, and synchronously. If a phone deck is sitting at a shape zoom
		// when the user taps Done, the reading zoom and scroll it saved have to
		// go back BEFORE anything below runs: the 'updatepermission' fire two
		// statements down is what drives ImpressTileLayer.onUpdatePermission ->
		// _switchToFileBasedView, which swaps the layout for the stacked one,
		// and a saved centre applied after that swap means a different point.
		//
		// This is the half that makes the zoom honest. The Writer objection this
		// lane answers is "a forced jump that throws away what the reader had";
		// the answer is a restore that cannot be skipped, including on the exit
		// that does not go through leaving a shape's text.
		if (typeof VulcanImpressTextEntry !== 'undefined')
			VulcanImpressTextEntry.onLeaveEditMode();

		// disable all user interaction, will need to add keyboard too
		if (this._docLayer) {
			this._docLayer._onUpdateCursor();
			this._docLayer._clearSelections();
		}

		// Block direct-canvas interactions (shape drag, arrow-key shape
		// move) server-side and hide per-comment edit/redline controls
		// in the UI.
		this._applyViewReadOnly(true);

		// BEFORE the fire below, not after: 'updatepermission' is what drives
		// TextInput._onPermission, which stamps contenteditable='false' on the
		// hidden editable. A blur issued after that stamp is aimed at an element
		// the browser may already have dropped focus from, so the one call that
		// really lowers an iPhone keyboard would land on nothing.
		this._vulcanDismissWriterKeyboardOnExit(vulcanPreviousPermission);

		app.events.fire('updatepermission', {perm : perm});
		this.fire('closemobilewizard');
		this.fire('closealldialogs');

		if (window.ThisIsTheAndroidApp)
			window.postMobileMessage('EDITMODE off');
	},

	/*
	 * VULCAN: PHONE WRITER'S EXIT TO READ DROPS THE KEYBOARD DELIBERATELY.
	 *
	 * _proceedEditMode raises it deliberately for docType 'text' (a synchronous
	 * focus(true), because the caret lands in body text and there is something
	 * to type into). Nothing symmetrical existed on the way out: Writer's ✓ —
	 * VulcanEscape.popDone with no unit rung registered for 'text', so it falls
	 * through to setPermission('readonly') — relied on WebKit treating the
	 * contenteditable='false' stamp as a dismissal. That is a side effect of a
	 * stamp made for a different reason, and the fork's own note at
	 * TextInput.js:416 records that the sibling `disabled` attribute is inert on
	 * a contenteditable div. dismissSoftKeyboard is the only call in the tree
	 * that lowers an iPhone keyboard for real (map.blur()/focus(false) are inert
	 * there), and until now Calc's fx-bar commit was its only caller.
	 *
	 * KEYED ON THE POSTURE TRANSITION, never on cursor visibility. Serial text
	 * entry moves the caret within and between paragraphs constantly and none of
	 * it touches _permission, so the edit -> read edge cannot fire mid-typing.
	 * The previous permission is read before the assignment at the top of
	 * _enterReadOnlyMode: a load-time entry into the read posture has it
	 * undefined, and a readonly -> readonly re-assert has it 'readonly'; neither
	 * is an exit from typing.
	 *
	 * Writer only. Calc's ✓ never leaves edit permission (Toolbar.formulabarBlur
	 * owns that dismissal) and Impress routes its exit through
	 * VulcanImpressTextEntry.onLeaveEditMode above.
	 */
	_vulcanDismissWriterKeyboardOnExit: function (previousPermission) {
		if (previousPermission !== 'edit')
			return;
		if (!this._docLayer || this._docLayer._docType !== 'text')
			return;
		if (typeof this._docLayer._vulcanPhoneChrome !== 'function' ||
			!this._docLayer._vulcanPhoneChrome())
			return;
		if (this._textInput &&
			typeof this._textInput.dismissSoftKeyboard === 'function')
			this._textInput.dismissSoftKeyboard();
	},

	// Is user currently in read only mode (i.e: initial mobile read only view mode, user may have write access)
	isReadOnlyMode: function() {
		return this._permission === 'readonly';
	},

	// Is user currently in editing mode
	isEditMode: function() {
		return this._permission === 'edit';
	}
});
