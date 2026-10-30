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
 * window.L.Control.MobileWizard - main container can contain few MobileWizardWindows
 */

/* global app $ */
window.L.Control.MobileWizard = window.L.Control.extend({

	initialize: function (options) {
		window.L.setOptions(this, options);
	},

	onAdd: function (map) {
		this.map = map;

		// for the moment, the mobile-wizard is mobile phone only
		if (!window.mode.isSmallScreenDevice())
			return;

		this.contents = [];

		map.on('mobilewizard', this._onMobileWizard, this);
		map.on('closemobilewizard', this._closeWizard, this);
		map.on('showwizardsidebar', this._showWizardSidebar, this);
		map.on('mobilewizardback', this.goLevelUp, this);
		map.on('resize', this._onResize, this);
		map.on('jsdialogupdate', this.onJSUpdate, this);
		map.on('jsdialogaction', this.onJSAction, this);

		this._setupBackButton();
	},

	onRemove: function() {
		this.map.off('mobilewizard', this._onMobileWizard, this);
		this.map.off('closemobilewizard', this._closeWizard, this);
		this.map.off('showwizardsidebar', this._showWizardSidebar, this);
		this.map.off('mobilewizardback', this.goLevelUp, this);
		this.map.off('resize', this._onResize, this);
		this.map.off('jsdialogupdate', this.onJSUpdate, this);
		this.map.off('jsdialogaction', this.onJSAction, this);
	},

	_setupBackButton: function() {
		this.backButton = $('#mobile-wizard-back');
		this.backButton.click(function() { history.back(); });
	},

	_showWizardSidebar: function() {
		this.map.showSidebar = true;
	},

	_closeWizard: function() {
		var items = this.contents.length;
		while (items--)
			this.removeWindow(this.contents[0]);
	},

	_hideWizard: function() {
		$('.jsdialog-overlay').remove();

		// dialog
		if (this.map.dialog.hasDialogInMobilePanelOpened()) {
			// TODO: use jsdialog approach
			this.map.dialog._onDialogClose(window.mobileDialogId, true);
			window.mobileDialogId = undefined;
		}

		// A nested picker restores its parent before removing the child. Keep the
		// still-visible wizard active; only the final window owns global teardown.
		if (this.contents.length)
			return;

		if (window.commentWizard === true && app.sectionContainer) {
			app.sectionContainer.getSectionWithName(app.CSections.CommentList.name).removeHighlighters();
		}

		if (!this.contents.length)
			$('#mobile-wizard').hide();

		document.getElementById('mobile-wizard').classList.remove('menuwizard');
		document.getElementById('mobile-wizard').classList.remove('shapeswizard');
		// The filmstrip restore (portrait; MobileWizardWindow hid it on open)
		// lives with the posture machinery: under the Vulcan phone Impress
		// chrome an inline 'block' written here would outrank the posture
		// stylesheet and resurrect the strip in the browse posture (R6-6),
		// so UIManager clears the inline property there and keeps the stock
		// inline 'block' everywhere else.
		this.map.uiManager.restorePresentationControlsAfterWizard();

		if (this.map.isEditMode()) {
			$('#toolbar-down').show();
		}
		if (window.ThisIsTheAndroidApp)
			window.postMobileMessage('MOBILEWIZARD hide');

		this.map.showSidebar = false;
		this._isActive = false;
		this._dialogid = '';
		this._currentPath = [];

		// CS-8. These globals say "a wizard of kind X is on screen", and the
		// toolbar toggles branch on them: the `A` handler
		// (docdispatcher.ts:1190) closes the sheet iff window.mobileWizard is
		// true and opens it otherwise.
		//
		// removeWindow() calls _hideWizard() unconditionally, including when
		// it has just popped a CHILD window (a drill-in picker opens a second
		// window because it carries a new id). Clearing the flags there left
		// window.mobileWizard === false while the parent A-sheet was still on
		// screen, so the next tap on `A` took the OPEN branch and rebuilt the
		// sheet in place instead of dismissing it -- the only visible escape
		// from the sheet root, consumed by using the sheet once.
		//
		// The dialog teardown above stays unconditional: that one is correct,
		// it is what stops a server-side dialog being orphaned.
		if (!this.contents.length) {
			window.pageMobileWizard = false;

			if (window.mobileWizard === true)
				window.mobileWizard = false;

			if (window.insertionMobileWizard === true)
				window.insertionMobileWizard = false;

			if (window.pageMobileWizard === true)
				window.pageMobilewizard = false;

			if (window.commentWizard === true)
				window.commentWizard = false;

			this._updateToolbarItemStateByClose();
		}

		if (!this.map.hasFocus()) {
			this.map.focus();
		}

		if (this.map.uiManager.sheetsBar)
			this.map.uiManager.sheetsBar.show();
	},

	isOpen: function() {
		return $('#mobile-wizard').is(':visible');
	},

	_updateToolbarItemStateByClose: function() {
		const mobileWizard = document.getElementById('mobile_wizard');
		if (window.mobileWizard === false && mobileWizard && mobileWizard.classList.contains('selected'))
			mobileWizard.classList.remove('selected');

		const insertionMobileWizard = document.getElementById('insertion_mobile_wizard');
		if (window.insertionMobileWizard === false && insertionMobileWizard && insertionMobileWizard.classList.contains('selected'))
			insertionMobileWizard.classList.remove('selected');

		const commentWizard = document.getElementById('comment_wizard');
		if (window.commentWizard === false && commentWizard && commentWizard.classList.contains('selected'))
			commentWizard.classList.remove('selected');
	},

	goLevelDown: function(contentToShow, options) {
		if (this.contents.length)
			this.contents[this.contents.length - 1].goLevelDown(contentToShow, options);
	},

	goLevelUp: function() {
		if (this.contents.length)
			this.contents[this.contents.length - 1].goLevelUp();
	},

	_onResize: function() {
		window.L.DomUtil.updateElementsOrientation(['mobile-wizard', 'mobile-wizard-content']);
		var topWindow = this.contents.length
			? this.contents[this.contents.length - 1]
			: null;
		if (topWindow && topWindow._resizeVulcanBottomSheetGesture)
			topWindow._resizeVulcanBottomSheetGesture();
	},

	selectedTab: function(tabText) {
		var topWindow = this.contents.length ? this.contents[this.contents.length - 1] : null;
		if (topWindow)
			topWindow.selectedTab(tabText);
	},

	_getContentForWindowId: function(id) {
		for (var i in this.contents) {
			if (this.contents[i].id === 'mobile-wizard-content-' + id)
				return this.contents[i];
		}

		return null;
	},

	_onMobileWizard: function(data) {
		var callback = data.callback;
		data = data.data;
		if (data) {
			var existingWindow = this._getContentForWindowId(data.id);
			if (existingWindow) {
				existingWindow._onMobileWizard(data, callback);
			} else {
				var newWindow = window.L.control.mobileWizardWindow(this, 'mobile-wizard-content-' + data.id);
				for (var i in this.contents)
					this.contents[i].hideWindow();
				this.contents.push(newWindow);
				this.map.addControl(newWindow);
				newWindow._onMobileWizard(data, callback);
			}
		}
	},

	removeWindow: function(window) {
		var pos = this.contents.indexOf(window);
		if (pos >= 0) {
			var wasPopup = false;
			// popup was closed so go level up in parent
			if (pos > 0 && this.contents[pos].isPopup) {
				wasPopup = true;
			}

			this.map.removeControl(window);
			this.contents.splice(pos, 1);
			// VULCAN (VO-P-0016): the one notification that a window has LEFT
			// the ladder, by its content id. Every route a docked sheet closes
			// by -- the titlebar control's history.back(), hardware/browser
			// back, the host's chevron (all through goLevelUp), the grid tap
			// and the permission drop (through 'closemobilewizard'), a core
			// `action: 'close'`, and the snackbar timer -- converges on THIS
			// method, and none of them fires 'closemobilewizard' on the way
			// out (goLevelUp fires it only behind window.contextMenuWizard).
			// The phone Calc style rail yields its slot to the sheets it
			// launches (VulcanCalcFormatRow.yieldTo) and takes it back on this
			// event, the way `#toolbar-down` above is hidden by _showWizard and
			// shown again by _hideWizard. `id` is the window's OWN id --
			// 'mobile-wizard-content-<data.id>' -- exactly as
			// _getContentForWindowId keys it.
			this.map.fire('vulcanwizardwindowremoved', { id: window.id });
			if (this.contents.length) {
				var parentWindow = this.contents[this.contents.length - 1];
				parentWindow.showWindow();
				if (wasPopup)
					parentWindow.goLevelUp();
			}
			this._hideWizard();
		}
	},

	onJSUpdate: function (e) {
		var data = e.data;

		if (data.jsontype === 'notebookbar')
			return;

		var existingWindow = this._getContentForWindowId(data.id);
		if (existingWindow) {
			existingWindow.onJSUpdate(e);
		}
	},

	onJSAction: function (e) {
		var data = e.data;

		if (data.jsontype === 'notebookbar')
			return;

		var existingWindow = this._getContentForWindowId(data.id);
		if (existingWindow) {
			existingWindow.onJSAction(e);
		}
	},
});

window.L.control.mobileWizard = function (options) {
	return new window.L.Control.MobileWizard(options);
};
