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
 * Control.SheetsBar - toolbar with buttons for scrolling tabs
 */

/* global _ JSDialog app */
class SheetsBar {

	constructor(map, showNavigation = true) {
		this.showNavigation = showNavigation;
		this.onAdd(map);
	}

	onAdd(map) {
		this.map = map;
		this.parentContainer = window.L.DomUtil.get('spreadsheet-toolbar');
		this.builder = new window.L.control.jsDialogBuilder(
			{
				mobileWizard: this,
				map: this.map,
				cssClass: 'jsdialog',
				suffix: 'spreadsheet-toolbar',
				callback: this.onSelectSheet.bind(this),
			});

		this.create();

		map.on('doclayerinit', this.onDocLayerInit, this);
		map.on('updateparts', this.onUpdateParts, this);
		app.events.on('updatepermission', this.onUpdatePermission.bind(this));
	}

	create() {
		var data = [
			{
				id: 'sheets-buttons-toolbox',
				type: 'toolbox',
				children: [
					{
						id: 'firstrecord',
						type: 'customtoolitem',
						text: _('Scroll to the first sheet'),
						command: 'firstrecord',
						visible: this.showNavigation
					},
					// No pressAndHold: each press now pages a whole strip of
					// tabs (docdispatcher 'nextrecord'), so a repeat-on-hold
					// would fly past the tab being looked for.
					{
						id: 'prevrecord',
						type: 'customtoolitem',
						text: _('Scroll left'),
						command: 'prevrecord',
						visible: this.showNavigation
					},
					{
						id: 'nextrecord',
						type: 'customtoolitem',
						text: _('Scroll right'),
						command: 'nextrecord',
						visible: this.showNavigation
					},
					{
						id: 'lastrecord',
						type: 'customtoolitem',
						text: _('Scroll to the last sheet'),
						command: 'lastrecord',
						visible: this.showNavigation
					},
					{
						id: 'insertsheet',
						type: 'customtoolitem',
						text: _('Insert sheet'),
						command: 'insertsheet'
					},
					{
						id: 'sheetlist:SheetListMenu',
						type: 'menubutton',
						noLabel: true,
						text: _('Show sheet list'),
						command: 'sheetlist',
						// VULCAN: on the phone chrome this button opens the
						// bottom sheet below instead of the desktop dropdown.
						// See openPhoneSheetList, and the opt-in itself in
						// jsdialog/Widget.MenuButton.js.
						vulcanPhoneMenu: this.openPhoneSheetList.bind(this),
					},
				]
			}
		];

		this.parentContainer.replaceChildren();
		this.builder.build(this.parentContainer, data);
		
		this.updateSheetListMenu();
	}

	onDocLayerInit() {
		var docType = this.map.getDocType();
		if (docType == 'spreadsheet') {
			if (!window.mode.isSmallScreenDevice()) {
				this.show();
			}
		}
	}

	onUpdateParts(e) {
		this.partNames = e.partNames || [];
		this.selectedPart = e.selectedPart;
		this.parts = e.parts;
		this.updateSheetListMenu();
	}

	onUpdatePermission(e) {
		if (e.detail.perm === 'edit') {
			this.enableInsertion(true);
		} else {
			this.enableInsertion(false);
		}
	}

	updateSheetListMenu() {
		let sheetEntries = [];
		// Kept for the phone sheet below, which is built at PRESS time from
		// the same list the desktop dropdown is fed — one source of truth for
		// which parts are offered, so a hidden or sheet-view part cannot be
		// reachable from one surface and not the other.
		this.sheetEntries = sheetEntries;

		if (!this.partNames || this.partNames.length === 0) {
			return sheetEntries;
		}

		for (let i = 0; i < this.partNames.length; i++) {
			if (app.calc.isPartHidden(i)) {
				continue;
			}

			if (app.calc.isPartSheetView(i)) {
				continue;
			}

			let displayText = this.partNames[i];

			sheetEntries.push({
				id: 'selectsheet-' + i,
				text: displayText,
				selected: (i === this.selectedPart || app.calc.isDefaultPartOfSelectedSheetView(i))
			});
		}
		
		JSDialog.MenuDefinitions.set('SheetListMenu', sheetEntries);
		this.enableSheetList(sheetEntries.length > 1);
	}

	/*
	 * Phone chrome, BOTH halves — the same predicate Control.Tabs uses for the
	 * strip beside this button. js/global.js stamps vulcan-mobile-chrome iff
	 * `!desktopChrome && isSmallScreenDevice()`, so `?vulcanChrome=desktop` on
	 * a real phone leaves the screen test TRUE with the class ABSENT, and only
	 * both halves together mean "the phone chrome is on screen".
	 */
	isPhoneSheetStrip() {
		return !!window.mode && window.mode.isSmallScreenDevice() &&
			document.documentElement.classList.contains('vulcan-mobile-chrome');
	}

	/** The one part switch, shared by the dropdown and the phone sheet. */
	selectSheetPart(partIndex) {
		if (isNaN(partIndex) || partIndex === this.map._docLayer._selectedPart)
			return;
		this.map._docLayer._clearReferences();
		this.map.setPart(partIndex, false, true);
	}

	/*
	 * THE PHONE SHEET LIST (S4).
	 *
	 * WHAT WAS MEASURED, on the button the designer calls the accordion. Its glyph
	 * is right and its arrow half is correctly hidden; what it OPENED was a
	 * desktop combobox with no phone form anywhere in this fork — a 57.8x92
	 * card at margin-top 564 that fully contained its own 46x46 trigger at
	 * (14,594), so `document.elementFromPoint` at the button's centre returned
	 * a sheet row and the universal tap-again dismissal switched sheets
	 * instead (selectedPart 0 -> 1, no undo affordance). Its rows were 30px
	 * against this chrome's 44px floor, each 15px wider than the card holding
	 * them, and the active one painted in the raw per-doctype accent — dark
	 * green — six pixels from the fork's own ink-black selected tab.
	 *
	 * NONE of that is a stylesheet gap to be filled in place. It is one fact:
	 * a jsdialog dropdown is a DESKTOP surface and this fork has no phone tier
	 * for one — every `.jsdialog-window.modalpopup` and `.ui-combobox-entry`
	 * rule it owns is scoped `html.vulcan-desktop-chrome`. Every other phone
	 * menu here is a #mobile-wizard bottom sheet, which is 44px-row,
	 * fork-skinned and safe-area-aware by construction and cannot cover the
	 * control that opened it (Control.MobileWizardWindow._showWizard hides
	 * this whole strip while a sheet is up). So the phone gets the surface it
	 * already has rather than a second one built to look like it.
	 *
	 * Shape copied deliberately from Control.Tabs._phoneSheetMenu — the SAME
	 * strip's other phone menu, reached by tapping the active tab — so the two
	 * menus on one bar are one idiom: a real window id, the sheet's name as
	 * the title, `mainmenu` rows carrying their own callbacks, and `checked`
	 * marking where you are.
	 *
	 * Built at press time, not cached: `checked` has to follow the document,
	 * and updateSheetListMenu only runs on `updateparts`.
	 */
	phoneSheetList() {
		var entries = this.sheetEntries || [];
		var that = this;
		return {
			id: 'vulcan-sheet-list',
			type: 'container',
			text: _('Sheets'),
			enabled: true,
			// THE THREE THINGS THE PICKER IS SPECIFIED TO BE — large, scrollable,
			// dismissed by a tap outside — are all bought by these three fields,
			// and none of them is a size this file chooses:
			//
			//   `jsontype: 'popup'` puts the window on the popup path, which is
			//       what BUILDS the cancellable `.jsdialog-overlay` scrim and
			//       wires its tap-to-dismiss (Control.MobileWizardWindow, the
			//       `isPopup` branch). `type` stays 'container' because that is
			//       the top-level type the builder has a handler for.
			//   `cancellable: true` is what that scrim's onclick is gated on.
			//   `vulcanPhoneSheet: true` claims the fork's phone bottom-sheet
			//       surface: the 44px round close control in its own header, and
			//       §13.8a's geometry — content height capped at 70% of the
			//       frame, the corner floor, the safe-area side rails. LARGE is
			//       therefore the shared cap, not a number invented here, and it
			//       moves with §13.8a if that ever changes.
			//
			// SCROLLABLE needs nothing: #mobile-wizard is the scroll owner
			// (§13.4, `overflow-y: auto`) and the cap is a max-height, so a
			// workbook with more sheets than fit scrolls inside the sheet.
			// Measured at ten sheets: 648px of rows in a 489px box.
			jsontype: 'popup',
			cancellable: true,
			vulcanPhoneSheet: true,
			children: [
				{
					id: 'vulcan-sheet-list-menu',
					type: 'mainmenu',
					enabled: true,
					children: entries.map(function (entry, index) {
						var partIndex = parseInt(entry.id.replace('selectsheet-', ''));
						return {
							// Not the part id: `id` becomes a `ui-header-<id>`
							// class and is looked up in _menuItemHandlers.
							id: 'vulcan-sheet-list-entry-' + index,
							type: 'menuitem',
							text: entry.text,
							checked: entry.selected === true,
							enabled: true,
							executionType: 'callback',
							callback: function () {
								that.selectSheetPart(partIndex);
							},
							children: [],
						};
					}),
				},
			],
		};
	}

	/** The phone door. Wired as the menubutton's vulcanPhoneMenu in create(). */
	openPhoneSheetList() {
		if (!this.isPhoneSheetStrip())
			return;
		// The button is disabled below two sheets (updateSheetListMenu), but
		// the sheet is also the only surface here that would render an empty
		// list, so it refuses on its own terms too.
		if (!this.sheetEntries || this.sheetEntries.length < 2)
			return;
		// Same flag Control.Tabs sets for its sibling sheet: it is what makes
		// goLevelUp fire `closemobilewizard`, so both menus on this strip
		// unwind through one escape ladder.
		window.contextMenuWizard = true;
		this.map.fire('mobilewizard', {data: this.phoneSheetList()});
	}

	onSelectSheet(objectType, eventType, object, data, builder) {
		if (object.id === 'sheetlist') {

			if (eventType === 'select') {
				this.selectSheetPart(parseInt(data.replace('selectsheet-', '')));
			}
			return;
		}
		builder._defaultCallbackHandler(objectType, eventType, object, data, builder);
  }

	enableInsertion(enable) {
		this.builder.executeAction(this.parentContainer, {
			'control_id': 'insertsheet',
			'action_type': enable ? 'enable' : 'disable'
		});
	}

	enableSheetList(enable) {
		this.builder.executeAction(this.parentContainer, {
			'control_id': 'sheetlist',
			'action_type': enable ? 'enable' : 'disable'
		});
	}

	show() {
		this.parentContainer.style.display = 'grid';
	}

	hide() {
		this.parentContainer.style.display = 'none';
	}
}

JSDialog.SheetsBar = function (map, showNavigation) {
	return new SheetsBar(map, showNavigation);
};
