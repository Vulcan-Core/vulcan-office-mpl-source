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
 * Toolbar handler
 */

/* global app $ window brandProductName DocUtil GraphicSelection RenderManager _ VulcanPdfCanvas */

window.L.Map.include({

	// a mapping of uno commands to more readable toolbar items
	unoToolbarCommands: [
		'.uno:StyleApply',
		'.uno:CharFontName'
	],

	_modalDialogOptions: {
		overlayClose:true,
		opacity: 80,
		overlayCss: {
			backgroundColor : '#000'
		},
		containerCss: {
			overflow : 'hidden',
			backgroundColor : '#fff',
			padding : '20px',
			border : '2px solid #000'
		}
	},

	_getCurrentFontName: function() {
		return this['stateChangeHandler'].getItemValue('.uno:CharFontName');
	},

	createFontSelector: function(containerId) {
		var that = this;
		var container = document.getElementById(containerId);
		if (!container)
			return;

		var populateEntries = function() {
			var commandValues = that.getToolbarCommandValues('.uno:CharFontName');
			if (typeof commandValues === 'object' && container.updateEntries) {
				var fontNames = Object.keys(commandValues);
				container.updateEntries(fontNames);
			}
			var currentFont = that._getCurrentFontName();
			if (currentFont && container.onSetText)
				container.onSetText(currentFont);
		};

		populateEntries();

		var onCommandStateChanged = function(e) {
			if (e.commandName !== '.uno:CharFontName')
				return;

			if (container.onSetText)
				container.onSetText(e.state);
			this['stateChangeHandler'].setItemValue('.uno:CharFontName', e.state);
		};

		var onFontListChanged = function(e) {
			if (e.commandName === '.uno:CharFontName')
				populateEntries();
		};

		this.off('commandstatechanged', onCommandStateChanged);
		this.on('commandstatechanged', onCommandStateChanged);
		this.off('updatetoolbarcommandvalues', onFontListChanged);
		this.on('updatetoolbarcommandvalues', onFontListChanged);
	},

	createFontSizeSelector: function(containerId) {
		var container = document.getElementById(containerId);
		if (!container)
			return;

		var onCommandStateChanged = function(e) {
			if (e.commandName !== '.uno:FontHeight')
				return;

			var state = e.state;
			if (state === '0')
				state = '';

			if (container.onSetText)
				container.onSetText(state);
			this['stateChangeHandler'].setItemValue('.uno:FontHeight', state);
		};

		this.off('commandstatechanged', onCommandStateChanged);
		this.on('commandstatechanged', onCommandStateChanged);

		// Initialize with current state value if available
		var currentState = this['stateChangeHandler'].getItemValue('.uno:FontHeight');
		if (currentState) {
			onCommandStateChanged.call(this, {commandName: '.uno:FontHeight', state: currentState});
		}
	},

	applyFont: function (fontName) {
		if (!fontName)
			return;
		if (this.isEditMode()) {
			var msg = 'uno .uno:CharFontName {' +
				'"CharFontName.FamilyName": ' +
					'{"type": "string", "value": "' + fontName + '"}}';
			app.socket.sendMessage(msg);
		}
	},

	applyFontSize: function (fontSize) {
		if (this.isEditMode()) {
			var msg = 'uno .uno:FontHeight {' +
				'"FontHeight.Height": ' +
				'{"type": "float", "value": "' + fontSize + '"}}';
			app.socket.sendMessage(msg);
		}
	},

	getToolbarCommandValues: function (command) {
		if (this._docLayer) {
			return this._docLayer._toolbarCommandValues[command];
		}

		return undefined;
	},

	downloadAs: function (name, format, options, id) {
		if (this._fatal || !app.socket.connected() || !app.idleHandler._active || (this.uiManager && this.uiManager.isUIBlocked())) {
			return false;
		}

		id = id || 'export'; // not any special download, simple export

		if ((id === 'print' && this['wopi'].DisablePrint) ||
			(id === 'export' && this['wopi'].DisableExport)) {
			this.hideBusy();
			return false;
		}

		if (format === undefined || format === null) {
			format = '';
		}
		if (options === undefined || options === null) {
			options = '';
		}

		// printing: don't export form fields, irrelevant, and can be buggy
		// comments are irrelevant, too
		if (id === 'print' && format === 'pdf' && options === '')
			options = '{\"ExportFormFields\":{\"type\":\"boolean\",\"value\":\"false\"},' +
						'\"ExportNotes\":{\"type\":\"boolean\",\"value\":\"false\"}}';

		// download: don't export comments into PDF by default
		if (id == 'export' && format === 'pdf' && options === '')
			options = '{\"ExportNotes\":{\"type\":\"boolean\",\"value\":\"false\"}}';

		if (!window.ThisIsAMobileApp)
			this.showBusy(_('Downloading...'), false);

		app.socket.sendMessage('downloadas ' +
			'name=' + encodeURIComponent(name) + ' ' +
			'id=' + id + ' ' +
			'format=' + format + ' ' +
			'options=' + options);
		return true;
	},

	print: function (options) {
		if (window.ThisIsTheiOSApp || window.ThisIsTheAndroidApp || window.ThisIsTheMacOSApp || window.ThisIsTheWindowsApp || window.ThisIsTheQtApp) {
			window.postMobileMessage('PRINT');
		} else {
			this.showBusy(_('Downloading...'), false);
			this.downloadAs('print.pdf', 'pdf', options, 'print');
		}
	},

	saveAs: function (url, format, options) {
		if (url === undefined || url == null) {
			return;
		}
		if (format === undefined || format === null) {
			format = '';
		}
		if (options === undefined || options === null) {
			options = '';
		}

		this.showBusy(_('Saving...'), false);
		app.socket.sendMessage('saveas ' +
			'url=wopi:' + encodeURIComponent(url) + ' ' +
			'format=' + format + ' ' +
			'options=' + options);
	},

	exportAs: function (url) {
		if (url === undefined || url == null) {
			return;
		}

		app.socket.sendMessage('exportas url=wopi:' + encodeURIComponent(url));
	},

	renameFile: function (filename) {
		if (!filename) {
			return;
		}
		this.showBusy(_('Renaming...'), false);
		app.socket.sendMessage('renamefile filename=' + encodeURIComponent(filename));
	},

	applyStyle: function (style, familyName) {
		if (!style || !familyName) {
			this.fire('error', {cmd: 'setStyle', kind: 'incorrectparam'});
			return;
		}
		if (this.isEditMode()) {
			var msg = 'uno .uno:StyleApply {' +
					'"Style":{"type":"string", "value": "' + style + '"},' +
					'"FamilyName":{"type":"string", "value":"' + familyName + '"}' +
					'}';
			app.socket.sendMessage(msg);
		}
	},

	applyLayout: function (layout) {
		if (!layout) {
			this.fire('error', {cmd: 'setLayout', kind: 'incorrectparam'});
			return;
		}
		if (this.isEditMode()) {
			var msg = 'uno .uno:AssignLayout {' +
					'"WhatPage":{"type":"unsigned short", "value": "' + this.getCurrentPartNumber() + '"},' +
					'"WhatLayout":{"type":"unsigned short", "value": "' + layout + '"}' +
					'}';
			app.socket.sendMessage(msg);
		}
	},

	save: function(dontTerminateEdit, dontSaveIfUnmodified, extendedData, beforeClose) {
		this.fire('updatemodificationindicator', { status: 'SAVING' });

		// Let the native host know a save round-trip has started so
		// it can defer a close-clicked-mid-save until the round-trip
		// finishes (rather than prompting about "unsaved changes"
		// for a save that is already in flight).  CODA-only (any
		// CODA variant's native bridge): the bridge's SAVESTARTED
		// handler sets a save-in-flight flag that the window's close
		// handler watches.  COWASM tracks save-in-flight purely in JS
		// (the _switchToServerAfterSave flag), and its WASM kit's
		// ClientSession would reject the unknown command with
		// "error: cmd=SAVESTARTED kind=unknown" which surfaces as a
		// stray "server encountered..." dialog.
		if (window.bridge) {
			window.postMobileMessage('SAVESTARTED');
		}

		var msg = 'save' +
					' dontTerminateEdit=' + (dontTerminateEdit ? 1 : 0) +
					' dontSaveIfUnmodified=' + (dontSaveIfUnmodified ? 1 : 0);

		if (extendedData !== undefined) {
			msg += ' extendedData=' + extendedData;
		}

		if (beforeClose) {
			msg += ' beforeClose=1';
		}

		app.socket.sendMessage(msg);
	},

	messageNeedsToBeRedirected: function(command) {
		if (command === '.uno:EditHyperlink') {
			this.sendUnoCommand('.uno:HyperlinkDialog');
			return true;
		}
		else {
			return false;
		}
	},

	// Returns TRUE when the command was actually put on the wire (or handed to
	// a surface that will put it there), FALSE when one of the silent-drop
	// branches below ate it: read posture off the allowlist, a blocking
	// dialog, a blocked UI. Every legacy caller ignores the return; the agent
	// bridges (VulcanCalcBridge and siblings) read it, because "dispatched"
	// acked over a command this function dropped on the floor is exactly the
	// fabricated success the LE-1 probe measured — a phone-Calc WriteRange in
	// the Viewing posture acked {cellsWritten:1} in 0-1ms while GoToCell and
	// EnterString never left the browser.
	sendUnoCommand: function (command, json, force) {
		if (command.indexOf('.uno:') < 0 && command.indexOf('vnd.sun.star.script') < 0)
			console.error('Trying to send uno command without prefix: "' + command + '"');

		// Central command-usage telemetry: this is the single dispatch point
		// for menubar/toolbar/notebookbar/shortcut uno commands. The recorder
		// strips any '?' argument payload — command NAME only, plus the
		// interaction surface and a coarse command family.
		if (app.telemetry)
			app.telemetry.recordUnoCommand(command);

		// An edited scan's scan page takes text edits only: its insert tools
		// (a picture, a shape, a text box) are refused there, with a chip
		// saying why (VulcanPdfCanvas.refusesCommand).
		if (typeof VulcanPdfCanvas !== 'undefined' && VulcanPdfCanvas.refusesCommand(command))
			return false;

		if ((command.startsWith('.uno:Sidebar') && !command.startsWith('.uno:SidebarShow')) ||
			command.startsWith('.uno:CustomAnimation') || command.startsWith('.uno:ModifyPage') ||
			command.startsWith('.uno:MasterSlidesPanel') || command.startsWith('.uno:SidebarDeck')) {

			// sidebar control is present only in desktop/tablet case
			if (this.sidebar) {
				if (this.sidebar.isVisible()) {
					this.sidebar.setupTargetDeck(command);
				} else {
					// we don't know which deck was active last, show first then switch if needed
					app.socket.sendMessage('uno .uno:SidebarShow');

					this.sidebar.setupTargetDeck(command);
					return true;
				}
			}
		}

		var isAllowedInReadOnly = false;
		var allowedCommands = ['.uno:Save', '.uno:SaveAs', '.uno:WordCountDialog',
			'.uno:Signature', '.uno:PrepareSignature', '.uno:DownloadSignature', '.uno:InsertSignatureLine',
			'.uno:SetDocumentProperties',
			'.uno:ShowResolvedAnnotations', '.uno:Open', '.uno:CloseWin',
			'.uno:ToolbarMode?Mode:string=notebookbar_online.ui', '.uno:ToolbarMode?Mode:string=Default',
			'.uno:ExportToEPUB', '.uno:ExportToPDF', '.uno:ExportDirectToPDF', '.uno:MoveKeepInsertMode', '.uno:ShowRuler',
			'.uno:Navigator', '.uno:GotoPage',
			// VULCAN (Lane W): web view and its reflow width.
			//
			// 🔴 WITHOUT THESE TWO THE WHOLE REFLOW FEATURE IS DEAD IN THE
			// POSTURE IT EXISTS FOR. The branch below is
			// `(isEditMode() || isAllowedInReadOnly) && ...` and it drops
			// anything else on the floor SILENTLY -- no error, no log, no
			// message on the wire. Phone Writer opens in the READ posture
			// behind an edit FAB (that is what `allowedReadonlyMenus` and the
			// View menu's readonly gating are for), so a reader tapping
			// 'Reflow to screen width' would have watched nothing happen, in
			// exactly the way `.uno:PrintLayout` produced nothing before it.
			//
			// Both are view-only. BrowseWidth is a layout hint in twips and
			// writes no content; BrowseView changes which layout mode the view
			// renders in, and SwView::ExecViewOptions brackets it in a
			// save/restore of the document's modified flag.
			'.uno:BrowseView', '.uno:BrowseWidth',
			// Selecting does not change the document, so a viewer may use it.
			// Copy goes through the clipboard path and never reaches here.
			'.uno:SelectAll',
			// VULCAN: CELL/RANGE ADDRESSING IN READ POSTURE.
			//
			// Same class as SelectAll directly above: GoToCell moves the cell
			// cursor / marks a block and writes nothing — a viewer can already
			// do both by tapping and dragging the grid (mouse events never
			// pass through this gate). Without it, every range-addressed verb
			// of the Calc agent bridge was dead in the Viewing posture, and
			// dead in the worst way: `selectRange()` (GoToCell ToPoint) was
			// dropped HERE, silently, while the `gettextselection` that
			// follows it rides the socket directly — so Vulcan_ReadRange
			// answered with the CURRENT selection's text under the name of
			// the range it was asked for (measured: D2 asked, A8's "405"
			// returned), and a multi-cell range hung to its 8s timeout
			// because a 1x1 selection can never shape-match a 5x5 question.
			'.uno:GoToCell',
			// VULCAN: TAPPING A LINK IN READ POSTURE.
			//
			// 🔴 TWO GATES, ONE OF THEM MISSED. MouseControl's
			// `vulcanOpenLinkOnReadTap` sends this, and its own first line is
			// `if (app.map.isEditMode()) return;` -- so it fires ONLY in the
			// read posture, which is precisely the posture the branch below
			// drops anything not on this list in. Silently: no error, no log,
			// nothing on the wire. The feature could not work once, on any
			// build, in the only posture it runs in.
			//
			// The comment at that call site reasons carefully about
			// `ReadOnlyDoc = TRUE` in svx.sdi -- and that is a real gate, just
			// a DIFFERENT one. It is the ENGINE's read-only dispatch filter,
			// on the far side of a socket this message was never put on.
			// Clearing the far gate says nothing about the near one, which is
			// the same shape of mistake as [reflow's] BrowseView above.
			//
			// `scripts/phone-linktap-check.mjs` records this behaviour as
			// failing and attributes it to the fixture. It is not the fixture.
			//
			// Opening a link mutates nothing, and the engine already declares
			// it read-only-safe, so allowing it here adds no write surface.
			'.uno:OpenHyperlinkOnCursor'];
		if (app.isCommentEditingAllowed()) {
			allowedCommands.push('.uno:InsertAnnotation','.uno:DeleteCommentThread', '.uno:DeleteAnnotation', '.uno:DeleteNote',
				'.uno:DeleteComment', '.uno:ReplyComment', '.uno:ReplyToAnnotation', '.uno:PromoteComment', '.uno:ResolveComment',
				'.uno:ResolveCommentThread', '.uno:ResolveComment', '.uno:EditAnnotation', '.uno:ExportToEPUB', '.uno:ExportToPDF',
				'.uno:ExportDirectToPDF', '.uno:InsertThreadedComment');

			const graphicInfo = GraphicSelection.extraInfo;
			if (graphicInfo && graphicInfo.isSignature)
			{
				// If the just added signature line shape is selected, allow
				// moving/resizing it.
				allowedCommands.push('.uno:TransformDialog', '.uno:MoveShapeHandle');
			}
		}
		if (app.isRedlineManagementAllowed()) {
			allowedCommands.push('.uno:ShowTrackedChanges', '.uno:AcceptTrackedChanges', '.uno:AcceptTrackedChange', '.uno:RejectTrackedChange',
				'.uno:AcceptAllTrackedChanges', '.uno:RejectAllTrackedChanges', '.uno:AcceptTrackedChangeToNext', '.uno:RejectTrackedChangeToNext',
				'.uno:CommentChangeTracking', '.uno:PreviousTrackedChange', '.uno:NextTrackedChange');
		}

		for (var i in allowedCommands) {
			if (allowedCommands[i] === command) {
				isAllowedInReadOnly = true;
				break;
			}
		}

		var map = this;

		if (command.startsWith('.uno:SpellOnline')) {
			var val = map['stateChangeHandler'].getItemValue('.uno:SpellOnline');

			// proceed if the toggle button is pressed
			if (val && (json === undefined || json === null)) {
				 // because it is toggle, state has to be the opposite
				var state = !(val === 'true');
				window.prefs.set('spellOnline', state);
			}
		}

		if (this.uiManager.isUIBlocked())
			return false;
		// VULCAN: a half-typed cell is committed (.uno:AcceptFormula) under a
		// modeless dialog such as Find & Replace, as Enter in the cell would be.
		// Dropped, the drain's commit held the move on every re-ask
		// (VulcanEditState.onlyModelessDialogsOpen).
		var commitUnderModeless = command === '.uno:AcceptFormula'
			&& window.VulcanEditState
			&& window.VulcanEditState.onlyModelessDialogsOpen(this);
		if ((this.dialog.hasOpenedDialog() || (this.jsdialog && this.jsdialog.hasDialogOpened()))
			&& !command.startsWith('.uno:ToolbarMode') && !force && !commitUnderModeless) {
			console.debug('Cannot execute: ' + command + ' when dialog is opened.');
			this.dialog.blinkOpenDialog();
			return false;
		} else if (this.isEditMode() || isAllowedInReadOnly) {
			// Same order as ever: redirection is only consulted for a command
			// the posture would let through. A redirected command was
			// re-dispatched through this very function; the redirect IS the
			// send.
			if (this.messageNeedsToBeRedirected(command))
				return true;
			if (command === '.uno:Undo')
				this.fire('beforeundocommand');
			app.socket.sendMessage('uno ' + command + (json ? ' ' + JSON.stringify(json) : ''));
			// A vector view gets no invalidation for a history command; it
			// re-requests its parts (see RenderManager.noteHistoryCommandSent).
			if (command === '.uno:Undo' || command === '.uno:Redo')
				RenderManager.noteHistoryCommandSent();
			// user interaction turns off the following of other users
			if (map.userList && map._docLayer && map._docLayer._viewId)
				map.userList.followUser(map._docLayer._viewId, /* do instant scroll */ false);
			return true;
		}
		// The read-posture drop. Kept silent for legacy callers (a disabled
		// toolbar button in the read posture should not console-spam), but no
		// longer UNKNOWABLE: the return value carries the fact.
		return false;
	},

	toggleCommandState: function (unoState) {
		if (this.isEditMode()) {
			if (!unoState.startsWith('.uno:')) {
				unoState = '.uno:' + unoState;
			}
			this.sendUnoCommand(unoState);
		}
	},

	insertGraphic: function (file) {
		this.fire('insertgraphic', {file: file});
	},

	insertMultimedia: function (file) {
		this.fire('insertmultimedia', {file: file});
	},

	insertURL: function (url, urltype) {
		this.fire('inserturl', {url: url, urltype: urltype});
	},

	selectBackground: function (file) {
		this.fire('selectbackground', {file: file});
	},

	compareDocuments: function (file) {
		this.fire('comparedocuments', {file: file});
	},

	onHelpOpen: function(id, map, productName) {
		var i;
		// Display keyboard shortcut or online help
		if (id === 'keyboard-shortcuts-content') {
			document.getElementById('online-help-content').classList.add('hide');
			// Display help according to document opened
			if (map.getDocType() === 'text') {
				document.getElementById('text-shortcuts').classList.add('show');
			}
			else if (map.getDocType() === 'spreadsheet') {
				document.getElementById('spreadsheet-shortcuts').classList.add('show');
			}
			else if (map.getDocType() === 'presentation') {
				document.getElementById('presentation-shortcuts').classList.add('show');
			}
			else if (map.getDocType() === 'drawing') {
				document.getElementById('drawing-shortcuts').classList.add('show');
			}
		} else /* id === 'online-help' */ {
			document.getElementById('keyboard-shortcuts-content').classList.add('hide');
			if (window.socketProxy) {
				var helpdiv = document.getElementById('online-help-content');
				var imgList = helpdiv.querySelectorAll('img');
				for (var p = 0; p < imgList.length; p++) {
					var imgSrc = imgList[p].src;
					imgSrc = imgSrc.substring(imgSrc.indexOf('/images'));
					imgList[p].src = window.makeWsUrl('/browser/dist'+ imgSrc);
				}
			}
			// Display help according to document opened
			if (map.getDocType() === 'text') {
				var x = document.getElementsByClassName('text');
				for (i = 0; i < x.length; i++) {
					x[i].classList.add('show');
				}
			}
			else if (map.getDocType() === 'spreadsheet') {
				x = document.getElementsByClassName('spreadsheet');
				for (i = 0; i < x.length; i++) {
					x[i].classList.add('show');
				}
			}
			else if (map.getDocType() === 'presentation' || map.getDocType() === 'drawing') {
				x = document.getElementsByClassName('presentation');
				for (i = 0; i < x.length; i++) {
					x[i].classList.add('show');
				}
			}
		}

		var contentElement = document.getElementById(id);

		// Let's translate
		var max;
		var translatableContent = contentElement.querySelectorAll('h1');
		for (i = 0, max = translatableContent.length; i < max; i++) {
			translatableContent[i].innerHTML = translatableContent[i].innerHTML.toLocaleHelpString();
		}
		translatableContent = contentElement.querySelectorAll('h2');
		for (i = 0, max = translatableContent.length; i < max; i++) {
			translatableContent[i].innerHTML = translatableContent[i].innerHTML.toLocaleHelpString();
		}
		translatableContent = contentElement.querySelectorAll('h3');
		for (i = 0, max = translatableContent.length; i < max; i++) {
			translatableContent[i].innerHTML = translatableContent[i].innerHTML.toLocaleHelpString();
		}
		translatableContent = contentElement.querySelectorAll('h4');
		for (i = 0, max = translatableContent.length; i < max; i++) {
			translatableContent[i].innerHTML = translatableContent[i].innerHTML.toLocaleHelpString();
		}
		translatableContent = contentElement.querySelectorAll('td');
		for (i = 0, max = translatableContent.length; i < max; i++) {
			var orig = translatableContent[i].innerHTML;
			var trans = translatableContent[i].innerHTML.toLocaleHelpString();
			// Try harder to get translation of keyboard shortcuts (html2po trims starting <kbd> and ending </kbd>)
			if (orig === trans && orig.indexOf('kbd') != -1) {
				var trimmedOrig = orig.replace(/^(<kbd>)/,'').replace(/(<\/kbd>$)/,'');
				var trimmedTrans = trimmedOrig.toLocaleHelpString();
				if (trimmedOrig !== trimmedTrans) {
					trans = '<kbd>' + trimmedTrans + '</kbd>';
				}
			}
			translatableContent[i].innerHTML = trans;
		}
		translatableContent = contentElement.querySelectorAll('p');
		for (i = 0, max = translatableContent.length; i < max; i++) {
			translatableContent[i].innerHTML = translatableContent[i].innerHTML.toLocaleHelpString();
		}
		translatableContent = contentElement.querySelectorAll('button'); // TOC
		for (i = 0, max = translatableContent.length; i < max; i++) {
			translatableContent[i].innerHTML = translatableContent[i].innerHTML.toLocaleHelpString();
		}

		//translatable screenshots
		var supportedLanguage = ['de', 'fr', 'it', 'es', 'pt-BR'];
		var currentLanguage = String.locale;
		if (supportedLanguage.indexOf(currentLanguage) >= 0) {
			translatableContent = $(contentElement.querySelectorAll('.screenshot img'));

			for (i = 0, max = translatableContent.length; i < max; i++) {
				translatableContent[i].src = translatableContent[i].src.replace('/en/', '/'+currentLanguage+'/');
			}
		}

		// Substitute {productname} in Online Help and replace special Mac key names
		if (id === 'online-help-content') {
			var productNameContent = contentElement.querySelectorAll('span.productname');
			for (i = 0, max = productNameContent.length; i < max; i++) {
				productNameContent[i].innerHTML = productNameContent[i].innerHTML.replace('{productname}', productName);
			}
			document.getElementById('online-help-content').innerHTML = app.util.replaceCtrlAltInMac(document.getElementById('online-help-content').innerHTML);
		}
		if (id === 'keyboard-shortcuts-content') {
			// The desktop apps and the browser have different file
			// shortcuts, so drop the rows tagged for the other one.
			var dropClass = window.mode.isCODesktop() ? '.online-only' : '.coda-only';
			contentElement.querySelectorAll(dropClass).forEach(function (row) { row.remove(); });
			// Fill tagged shortcut cells from the locale-aware lookup
			// table (generated from core's Accelerators.xcu).
			if (window.JSDialog && window.JSDialog.ShortcutsUtil) {
				var rows = contentElement.querySelectorAll('tr[data-uno]');
				for (i = 0; i < rows.length; i++) {
					var unoCmd = rows[i].getAttribute('data-uno');
					var shortcut = window.JSDialog.ShortcutsUtil.getShortcutText(unoCmd);
					var cell = rows[i].querySelector('.shortcut');
					if (!cell) continue;
					if (!shortcut) {
						console.warn('cool-help.html: no shortcut found for ' + unoCmd
							+ ' — row will render empty. Either drop the data-uno attribute'
							+ ' or add the binding to Accelerators.xcu / unoshortcuts.py.');
						continue;
					}
					var html = '';
					var parts = shortcut.split('+');
					for (var j = 0; j < parts.length; j++) {
						if (j > 0) html += '<span class="kbd--plus" aria-hidden="true">+</span>';
						html += '<kbd>' + parts[j] + '</kbd>';
					}
					cell.innerHTML = html;
				}
			}
			document.getElementById('keyboard-shortcuts-content').innerHTML = app.util.replaceCtrlAltInMac(document.getElementById('keyboard-shortcuts-content').innerHTML);
		}
		var searchInput = document.getElementById('online-help-search-input');
		searchInput.setAttribute('placeholder',_('Search'));
		searchInput.setAttribute('aria-label',_('Search'));
		var helpContentParent = document.getElementsByClassName('ui-dialog-content')[0];
		var startFilter = false;
		var isAnyMatchingContent = false;

		const performSearch = function() {
			// Hide all elements within the #online-help-content on first key stroke/at start of filter content
			if (!startFilter || !isAnyMatchingContent) {
				helpContentParent.style.backgroundColor = 'var(--color-background-dark) !important';
				// Hide all <p> tags within .text, .spreadsheet, or .presentation sections
				document.querySelectorAll('#online-help-content > *:not(a), .link-section p, .product-header').forEach(function (element) {
					// Check if the element has class text, spreadsheet, or presentation
					if (!element.classList.contains('text') && !element.classList.contains('spreadsheet') && !element.classList.contains('presentation')) {
						this.hide(element);
					}
				}.bind(this));

				startFilter = true;
			}
			var searchTerm = searchInput.value.trim();
			// Reset highlighting and visibility if search term is empty
			if (searchTerm === '') {
				this.resetFilterResults();
				startFilter = false;
			}
			else {
				this.filterResults(searchTerm, isAnyMatchingContent, id);
				this._focusContainer(id + '-box');
			}
		}.bind(this);

		searchInput.addEventListener('keydown', function (e) {
			if (e.key === 'Enter') {
				performSearch();
			}
		});

		const searchButton = document.getElementById('online-help-search-button');
		searchButton.setAttribute('aria-label', _('Search'));
		searchButton.addEventListener('click', performSearch);
		searchButton.addEventListener('keydown', function (e) {
			if (e.key === 'Enter') {
				performSearch();
			}
		});

		const onlineHelpContent = document.getElementById('online-help-content');
		const buttons = onlineHelpContent.querySelectorAll('.scroll-button');

		buttons.forEach((button) => {
			button.addEventListener('click', (e) => {
				const href = button.getAttribute('href');
				if (!href || !href.startsWith('#')) return;
				const targetElement = document.getElementById(href.substring(1));
				if (!targetElement) return;
				// Scroll only the help content area. The browser's default anchor
				// navigation can scroll the modal popup itself, pushing the
				// titlebar (and its close button) out of view.
				e.preventDefault();
				const scrollContainer = targetElement.closest('.ui-dialog-content');
				if (scrollContainer) {
					const containerRect = scrollContainer.getBoundingClientRect();
					const targetRect = targetElement.getBoundingClientRect();
					scrollContainer.scrollTop += targetRect.top - containerRect.top;
				} else {
					targetElement.scrollIntoView({ block: 'start' });
				}
			});
		});

		this._focusContainer(id + '-box');
	},

	_focusContainer: function(id) {
		app.layoutingService.appendLayoutingTask(() => {
			var contentContainer = document.getElementById(id);
			if (contentContainer) {
				contentContainer.setAttribute('tabindex', '-1');
				contentContainer.focus();
			}
		});
	},

	filterResults: function (searchTerm, isAnyMatchingContent, id) {

		var mainDiv = document.getElementById(id);
		// Combine query parameters to select main sections
		var mainSectionsQuery = '.section:not(div.text .section, div.spreadsheet .section, div.presentation .section)';
		var docType = this.getDocType() === 'drawing' ? 'presentation' : this.getDocType();
		mainSectionsQuery += ', div.' + docType + ' .section';

		// Select main sections elements within the mainDiv
		var mainSections = mainDiv.querySelectorAll(mainSectionsQuery);
		isAnyMatchingContent = false;

		// Loop through each main section
		mainSections.forEach(function (mainSection) {
			// check header text matches or not
			var headerText = mainSection.querySelector('.section-header').textContent.toLowerCase();
			var containsTermInHeader = headerText.includes(searchTerm.toLowerCase());
			// check main section text matches or not
			var sectionText = mainSection.textContent.toLowerCase();
			var containsTerm = sectionText.includes(searchTerm.toLowerCase());

			//sub-section text matches or not
			var subSections = mainSection.querySelectorAll('.sub-section');
			var subSectionContainsTerm = false;

			// if text matching with the main header then display full main section
			if (containsTermInHeader) {
				// first need to reset display of subsection
				subSections.forEach(function(subSection) {
					mainSection.style.backgroundColor = '';
					mainSection.style.paddingInline = '';
					mainSection.style.borderRadius = '';
					this.show(subSection);
				}.bind(this));
				mainSection.style.backgroundColor = 'var(--color-background-lighter)';
				mainSection.style.paddingInline = '12px';
				mainSection.style.borderRadius = 'var(--border-radius-large)';
				this.show(mainSection);
			}
			else {
				// else Loop through each sub-section and display subsections with matching text has search term
				subSections.forEach(function (subSection) {
					// Highlight matching sub-sections
					if (subSection.textContent.toLowerCase().includes(searchTerm.toLowerCase())) {
						subSection.style.color = 'var(--color-text-darker)';
						this.show(subSection);
						mainSection.style.backgroundColor = 'var(--color-background-lighter)';
						mainSection.style.paddingInline = '12px';
						mainSection.style.borderRadius = 'var(--border-radius-large)';
						// make sure main section of matched subsection is visible
						this.show(mainSection);
						subSectionContainsTerm = true;
					} else {
						subSection.style.color = ''; // Remove previous highlighting
						this.hide(subSection);
					}
				}.bind(this));
			}

			if (!subSectionContainsTerm && !containsTerm) {
				this.hide(mainSection);
			}
			else {
				isAnyMatchingContent = true;
			}

		}.bind(this));

		if (!isAnyMatchingContent) {
			this.resetFilterResults();
			$('#online-help-search-input').addClass('search-not-found');
			setTimeout(function () {
				$('#online-help-search-input').removeClass('search-not-found');
			}, 800);
		}
	},

	resetFilterResults: function () {
		var helpContentParent = document.getElementsByClassName('ui-dialog-content')[0];
		helpContentParent.style.backgroundColor='';
		// Select main sections and make it visible
		var mainSections = document.querySelectorAll('.section');
		mainSections.forEach(function(mainSection) {
			mainSection.style.backgroundColor = '';
			this.show(mainSection);

			var subSections = mainSection.querySelectorAll('.sub-section');
			subSections.forEach(function(subSection) {
				this.show(subSection);
			}.bind(this));
		}.bind(this));

		// select all event scroll elements, main-header elements, product header elements and make visible to user if search term is empty
		// Exclude doctype-tagged TOC entries so non-current-doctype items stay hidden after search clear
		document.querySelectorAll('.m-v-0:not(.text):not(.spreadsheet):not(.presentation), .product-header, .help-dialog-header, .help-toc').forEach(function(element) {
			this.show(element);
			element.style.backgroundColor = '';
		}.bind(this));
	},

	show: function(element) {
		element.classList.remove('hide');
		element.classList.add('show');
	},

	hide: function(element) {
		element.classList.remove('show');
		element.classList.add('hide');
	},

	_doOpenHelpFile: function(data, id, map) {
		let productName;
		if (window.ThisIsAMobileApp) {
			productName = window.MobileAppName;
		} else {
			productName = (typeof brandProductName !== 'undefined') ? brandProductName : 'Vulcan Office';
		}

		map.uiManager.showYesNoButton(id + '-box', productName, '', _('OK'), null, null, null, true);
		app.layoutingService.appendLayoutingTask(() => {
			const box = document.getElementById(id + '-box');
			const innerDiv = window.L.DomUtil.create('div', '', null);
			box.insertBefore(innerDiv, box.firstChild);
			innerDiv.innerHTML = data;

			this.onHelpOpen(id, map, productName);
		});
	},

	showHelp: function(id) {
		var map = this;
		if (window.ThisIsAMobileApp) {
			map._doOpenHelpFile(window.HelpFile, id, map);
			return;
		}
		var helpLocation = 'cool-help.html';
		if (window.socketProxy)
			helpLocation = window.makeWsUrl('/browser/dist/' + helpLocation);
		$.get(helpLocation, function(data) {
			map._doOpenHelpFile(data, id, map);
		});
	},

	showLOAboutDialog: function() {
		if (this.aboutDialog)
			this.aboutDialog.show();
	},

	extractContent: function(html) {
		html = DocUtil.stripHTML(html);
		var parser = new DOMParser;
		return parser.parseFromString(html, 'text/html').documentElement.getElementsByTagName('body')[0].textContent;
	},

	makeURLFromStr: function(str) {
		str = str.trim();
		const lowerStr = str.toLowerCase();

		if (!(lowerStr.startsWith('http://') || lowerStr.startsWith('https://') ||
			  lowerStr.startsWith('ftp://') || lowerStr.startsWith('mailto:'))) {
			// Regular expression to test if the string is an email address
			const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
			if (emailPattern.test(str))
				str = 'mailto:' + str;
			else
				str = 'http://' + str;
		}
		return str;
	},

	cancelSearch: function() {
		var toolbar = window.mode.isSmallScreenDevice() ? app.map.mobileSearchBar: app.map.statusBar;
		var searchInput = window.L.DomUtil.get('search-input');
		app.searchService.resetSelection();
		if (toolbar) {
			if (!window.mode.isSmallScreenDevice()) {
				toolbar.showItem('cancelsearch', false);
			}
			toolbar.enableItem('searchprev', false);
			toolbar.enableItem('searchnext', false);
		}
		searchInput.value = '';
		if (window.mode.isSmallScreenDevice()) {
			searchInput.focus();
			toolbar.enableItem('cancelsearch', false);
		}

		this._onGotFocus();
	},

	openRevisionHistory: function () {
		var map = this;
		// if we are being loaded inside an iframe, ask
		// our host to show revision history mode
		map.fire('postMessage', {msgId: 'rev-history', args: {Deprecated: true}});
		map.fire('postMessage', {msgId: 'UI_FileVersions'});
	},
	openShare: function () {
		var map = this;
		if (!window.WOPIPostmessageReady) {
			// host advertised EnableShare but never completed the postMessage
			// handshake, so there is nothing to receive UI_Share
			var alertOptions = {
				messages: [
					_('Unable to share')
				],
			};
			window.JSDialog.showInfoModalWithOptions('unabletoshare', alertOptions);
			return;
		}
		map.fire('postMessage', {msgId: 'UI_Share'});
	},
	openSaveAs: function (format) {
		var map = this;
		map.fire('postMessage', {msgId: 'UI_SaveAs', args: {format: format}});
	},

	onFormulaBarFocus: function() {
		if (window.mode.isSmallScreenDevice() === true &&
		    document.documentElement.classList.contains('vulcan-mobile-chrome')) {
			// Google-Sheets phone chrome (docs/mobile-redesign/02 §2/§3): the
			// top bar keeps ✓/undo/redo untouched; ✕/✓ appear inside the
			// bottom-docked formula bar instead. The marker class lets §13-CALC
			// css collapse the sheet-tab strip while editing so the bar sits
			// directly above the keyboard.
			this.formulabar.show('cancelformula');
			this.formulabar.show('acceptformula');
			document.documentElement.classList.add('vulcan-formula-editing');
			// GAP 6 / EX-7: Google shows NO app top bar during a cell edit.
			// Ours is drawn by the HOST (SPEC-one-topbar; the fork's own
			// #toolbar-row is already 0px here, §13.2 — so no CSS rule in
			// this repo can reclaim those px), and the only way to ask for
			// them is the marker emitPosture already derives its Chrome
			// field from. Stamping it IS the request, on the SAME channel
			// immersive read uses rather than a second one.
			//
			// CALC ONLY, gated on an explicit doctype term so it is
			// substitutable: Writer's edit posture keeps its chrome (✓ Done
			// and the keyboard own the two ends of the screen), and the
			// §13-WRITER immersion rule reading this same marker is itself
			// scoped to body[data-doctype='text'], so a Calc stamp cannot
			// reach it. Inlined at both call sites rather than factored
			// into a file-level helper: these two methods are lifted and
			// run standalone by the mocha extraction rigs, where a
			// module-scope function is a ReferenceError.
			if (this.getDocType && this.getDocType() === 'spreadsheet') {
				document.documentElement.classList.add('vulcan-chrome-hidden');
				if (this.uiManager && this.uiManager.emitPosture)
					this.uiManager.emitPosture();
				// The smart toolbars are TOLD the mode, never derive it
				// (VulcanSmartToolbarMemory 'WHO CALLS modeChanged'): this
				// is the arrival at FULL EDIT, so the symbol rail opens at
				// pane 0 unless the trip started inside FULL EDIT too.
				// Stamped here, in the same task as the class above, because
				// a reset landing a task later would race a bar's own
				// restore for the same slot.
				if (window.VulcanSmartToolbarMemory)
					window.VulcanSmartToolbarMemory.modeChanged('full-edit');
				// VO-P-0016 — THE TRANSITION SEAM, and it belongs here for
				// the same reason the stamp above does. The style rail's
				// membership keys on the mode (M-0006's text verbs while
				// editing, RU-34's fourteen sheet verbs otherwise), but its
				// only trigger is `commandstatechanged`. Entering FULL EDIT
				// is the synchronous class write a few lines up, with no
				// guaranteed state event behind it, so without this call the
				// rail would show the SHEET set for the opening frames of
				// every edit and swap under the user's finger whenever core
				// next spoke. TOLD, not derived — the same criterion
				// VulcanSmartToolbarMemory sets out, and the reason a
				// VulcanEscape.publish() subscriber is the wrong seam.
				// refreshRail() is idempotent on the set it already shows.
				if (this.calcFormatRow && this.calcFormatRow.refreshRail)
					this.calcFormatRow.refreshRail();
			}
			// A live cell edit is a rung on the back ladder (SPEC-back-escape
			// §4.1 R2), and there is no map event for fx focus, so the host's
			// depth mirror is refreshed from here.
			if (window.VulcanEscape) window.VulcanEscape.publish();
		} else if (window.mode.isSmallScreenDevice() === true) {
			var mobileTopBar = this.mobileTopBar;
			mobileTopBar.showItem('undo', false);
			mobileTopBar.showItem('redo', false);
			mobileTopBar.showItem('cancelformula', true);
			mobileTopBar.showItem('acceptformula', true);
		} else {
			var jsdialogFormulabar = this.formulabar;
			jsdialogFormulabar.hide('startformula');
			jsdialogFormulabar.hide('AutoSumMenu');
			jsdialogFormulabar.show('cancelformula');
			jsdialogFormulabar.show('acceptformula');
		}
	},

	onFormulaBarBlur: function() {
		var map = this;

		if (window.mode.isSmallScreenDevice() &&
		    document.documentElement.classList.contains('vulcan-mobile-chrome')) {
			// Counterpart of the vulcan-mobile-chrome branch in
			// onFormulaBarFocus above (top-bar undo/redo were never hidden).
			map.formulabar.hide('cancelformula');
			map.formulabar.hide('acceptformula');
			// This runs on every route out of a cell edit, including the
			// one nothing else covers: committing with the soft keyboard's
			// return key moves the cell cursor, and _onCellCursorMsg fires
			// 'editorgotfocus' on a cursor move, which lands here through
			// Map._onEditorGotFocus. So the live-edit marker class can never
			// be left stranded while a cell sits merely selected.
			document.documentElement.classList.remove('vulcan-formula-editing');
			// Every route out of an edit lands here (see the list above), so
			// this is the ONE clear site for the Return-verb door latch.
			if (window.VulcanCalcReturnKey) window.VulcanCalcReturnKey.clear();
			// GAP 6's counterpart, and it is what makes the ask safe: the
			// same "every route out lands here" property clears the header
			// request, so it can never be left hidden over a document
			// nobody is editing. The marker is cleared and the posture
			// RE-EMITTED — the class alone is inert until a message carries
			// it out of the frame.
			if (map.getDocType && map.getDocType() === 'spreadsheet') {
				document.documentElement.classList.remove('vulcan-chrome-hidden');
				if (map.uiManager && map.uiManager.emitPosture)
					map.uiManager.emitPosture();
				// The other half of the smart-toolbar law: leaving FULL EDIT
				// forgets the symbol rail's pane. The font bar is NOT reset
				// with it — since D-0027 it declares all three modes, so the
				// law's survives() answers true here and its place is held
				// (RU-35 / M-0027 leg 3c: the reference keeps the offset
				// across leaving edit). The destination is READ off the
				// monotone parent —
				// which this method must never remove, see the ruling below —
				// rather than assumed to be EDIT-READY: the same 'every route
				// out lands here' property means a cursor move that engaged
				// no cell also arrives, and that one lands in FULL VIEW.
				if (window.VulcanSmartToolbarMemory)
					window.VulcanSmartToolbarMemory.modeChanged(
						document.documentElement.classList.contains('vulcan-calc-edit-ready')
							? 'edit-ready'
							: 'full-view');
				// VO-P-0016 — the counterpart of the seam in
				// onFormulaBarFocus, and it runs AFTER the class removal a
				// few lines up so refreshRail() reads the mode the user is
				// arriving IN. Leaving a live edit swaps M-0006's text verbs
				// back for the fourteen sheet verbs (RU-34: the same set
				// whatever is selected); without this the bar keeps the
				// editing seven until core next broadcasts a state.
				if (map.calcFormatRow && map.calcFormatRow.refreshRail)
					map.calcFormatRow.refreshRail();
			}
			// The counterpart publish for the R2 rung moved to the tail of
			// this function: it must run AFTER blurField, or the celledit
			// rung still reads fx.hasFocus() true, the (depth, top) pair
			// dedupes, and the host keeps ✓ over a dead edit.
		} else if (window.mode.isSmallScreenDevice() && this.isEditMode()) {
			var mobileTopBar = map.mobileTopBar;
			mobileTopBar.showItem('cancelformula', false);
			mobileTopBar.showItem('acceptformula', false);
			mobileTopBar.showItem('undo', true);
			mobileTopBar.showItem('redo', true);
		} else {
			var jsdialogFormulabar = map.formulabar;
			jsdialogFormulabar.hide('cancelformula');
			jsdialogFormulabar.hide('acceptformula');
			jsdialogFormulabar.show('startformula');
			jsdialogFormulabar.show('AutoSumMenu');
		}

		$('#AutoSumMenu-button').css('margin-inline', '0');
		$('#AutoSumMenu .unoarrow').css('margin', '0');

		map.formulabar.blurField();
		$('#addressInput input').blur();

		// The settled-state publish, LAST — after blurField, so the celledit
		// rung reads dead and the host face flips to the chevron (a publish
		// before the field blurs deduped into silence: measured zero
		// EscapeDepth updates across a whole ✓ interaction). publish()
		// self-gates on the phone chrome; elsewhere this is a no-op.
		if (window.VulcanEscape) window.VulcanEscape.publish();
	},

	formulabarBlur: function() {
		if (this.uiManager.isAnyDialogOpen())
			return;
		// VULCAN: ON A PHONE, A COMMIT DROPS THE KEYBOARD. Every accept or
		// cancel of a cell edit funnels through here (docdispatcher
		// 'acceptformula'/'cancelformula': the formula bar's ✓/✕, the host
		// header's Done via the VulcanEscape celledit rung, and closeapp's
		// exit save). The stock bare focus() re-focused the hidden editable
		// -- which on an iPhone can never blur again (TextInput.blur() is
		// platform-gated) -- so the keyboard sat over half the grid with no
		// dismissal affordance at all: the host's swipe-down cannot reach
		// into the iframe, and the native shell hides the iOS accessory
		// bar. Google Sheets' grammar is commit -> keyboard down, selection
		// stays (SPEC-sheets §3.1). The return key's commit-and-advance
		// never routes through here, so serial data entry keeps its
		// keyboard. Desktop keeps the stock refocus so typing continues.
		if (window.mode.isSmallScreenDevice()) {
			this.focus(false);
			if (this._textInput && this._textInput.dismissSoftKeyboard)
				this._textInput.dismissSoftKeyboard();
			return;
		}
		this.focus();
	},

	formulabarFocus: function() {
		this.formulabar.focusField();
	},

	// ONE exit for a phone-Calc cell-edit session (R7 hunt #6/#7). Every
	// route out of a live edit lands here: ✓/✕ (docdispatcher
	// acceptformula/cancelformula), the host ✓ Done and closeapp/idle exit
	// saves (both dispatch acceptformula), and the cursor-move commit
	// (Map._onEditorGotFocus, dismissKeyboard false — commit-and-advance
	// keeps typing). Order is the contract:
	//   1. the cursor mirror drops BEFORE any DOM change. The chrome
	//      teardown's layout collapse fires map 'resize', and CalcTileLayer's
	//      resize handler re-arms the whole edit chrome off
	//      app.file.textCursor.visible — a client mirror stale-true until
	//      core's 'cursorvisible: false' lands ~50ms later — through
	//      TextInput.showCursor's formula-bar coupling (the measured 7ms
	//      zombie re-arm). With the mirror cleared the guard reads false; if
	//      core KEEPS the edit (invalid formula), its own cursorvisible:true
	//      re-arms the chrome — the fail-safe direction.
	//   2. the rail's function face clears with the session, so the next cell
	//      never opens on the last cell's suggestions. (Core's own hidetip
	//      route in CanvasTileLayer covers the mid-edit convergence; this
	//      covers the exits — one seam, and a late hidetip frame lands on an
	//      already-empty face.)
	//   3. chrome + blur, with the escape depth published LAST (inside the
	//      blur handler, after blurField) so the host face flips to chevron.
	// Off the phone chrome this is exactly the old two-call exit sequence.
	vulcanEndCellEditSession: function (opts) {
		var dismissKeyboard = !opts || opts.dismissKeyboard !== false;
		if (window.mode.isSmallScreenDevice() &&
		    document.documentElement.classList.contains('vulcan-mobile-chrome') &&
		    this.formulabar) {
			app.setCursorVisibility(false);
			if (this._textInput)
				this._textInput.hideCursor();
			this.fire('vulcancalcfunctions', { names: [] });
		}
		this.onFormulaBarBlur();
		if (dismissKeyboard)
			this.formulabarBlur();
		// VULCAN: the edit ended with the keyboard kept (the Return
		// commit-and-advance, a tap on another cell): quick entry holds it
		// (TextInput.vulcanHoldQuickEntry, B-0099/B-0100/B-0102).
		else if (this._textInput && this._textInput.vulcanHoldQuickEntry)
			this._textInput.vulcanHoldQuickEntry();
	},

	// ── EDIT-READY: the third phone-Calc state, and its ONLY two writers ──
	//
	// html.vulcan-calc-edit-ready means "the Calc cell unit is engaged — AT
	// LEAST edit-ready". It is the monotone PARENT of the live edit, not its
	// sibling: vulcan-formula-editing is the inner bit, and both are present
	// in FULL EDIT. That nesting is what buys the grammar for nothing —
	//   * commit (FULL EDIT -> EDIT-READY) needs NO new code, because
	//     dropping vulcan-formula-editing at onFormulaBarBlur IS the
	//     transition;
	//   * the escape ladder is well-formed for free at depth 2 / 1 / 0, so a
	//     back out of a double-tap edit lands in EDIT-READY (Sheets'
	//     behaviour) rather than jumping to FULL VIEW.
	//
	// 🔴 onFormulaBarBlur MUST NOT remove this class. A symmetric removal
	// there is the "helpful" edit that breaks the grammar: it would send
	// every commit to FULL VIEW instead of EDIT-READY, and it would fire on
	// the Return commit-and-advance of a serial data-entry run as well.
	//
	// These are kept beside onFormulaBarFocus/Blur so the whole Calc state
	// machine lives in one file, and the three-part guard is written INLINE
	// at both sites rather than factored into a module-level helper for the
	// reason onFormulaBarFocus already gives above: these methods are lifted
	// and run standalone by the mocha extraction rigs, where a module-scope
	// function is a ReferenceError.
	//
	// 🔴 ORDER IS THE CONTRACT: mutate the class, THEN publish. Never the
	// reverse. VulcanEscape.publish() stamps data-vulcan-top-level BEFORE its
	// dedupe return and then dedupes on the (depth, top, overlays) triple, so
	// a publish that runs first writes a stale attribute AND poisons the
	// dedupe — the corrected value is never re-sent. That exact bug is
	// already recorded for the celledit rung at the tail of onFormulaBarBlur:
	// a publish before the field blurred deduped into silence, measured zero
	// EscapeDepth updates across a whole ✓ interaction.
	vulcanEnterCalcEditReady: function () {
		if (!window.mode.isSmallScreenDevice()) return;
		if (!document.documentElement.classList.contains('vulcan-mobile-chrome')) return;
		if (!this.getDocType || this.getDocType() !== 'spreadsheet') return;
		document.documentElement.classList.add('vulcan-calc-edit-ready');
		// Arrival at EDIT-READY, told to the bars in the same task as the
		// class (VulcanSmartToolbarMemory 'WHO CALLS modeChanged').
		if (window.VulcanSmartToolbarMemory)
			window.VulcanSmartToolbarMemory.modeChanged('edit-ready');
		if (window.VulcanEscape) window.VulcanEscape.publish();
	},

	// The single remover, reached from the 'editready' escape rung's pop() —
	// i.e. the host's ✓ face or its back chevron while EDIT-READY is topmost.
	// It clears the marker and NOTHING ELSE: it does not drop the cell
	// selection (Sheets keeps it after ✓, and a pop that also deselected
	// would be a second, invisible mutation with no marker to describe it).
	vulcanExitCalcEditReady: function () {
		if (!window.mode.isSmallScreenDevice()) return;
		if (!document.documentElement.classList.contains('vulcan-mobile-chrome')) return;
		if (!this.getDocType || this.getDocType() !== 'spreadsheet') return;
		document.documentElement.classList.remove('vulcan-calc-edit-ready');
		// Back to FULL VIEW: the font bar goes off screen, and since D-0027 it
		// KEEPS its place — it declares FULL VIEW too, so survives() is true
		// and the law never reaches its forget arm. The next trip into
		// sheet-edit opens the bar where the user left it (RU-35 / M-0027
		// leg 3c). Only a reload starts it over.
		if (window.VulcanSmartToolbarMemory)
			window.VulcanSmartToolbarMemory.modeChanged('full-view');
		if (window.VulcanEscape) window.VulcanEscape.publish();
	},

	formulabarSetDirty: function() {
		if (this.formulabar)
			this.formulabar.dirty = true;
	},
});
