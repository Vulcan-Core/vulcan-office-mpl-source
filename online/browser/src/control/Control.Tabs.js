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
 * window.L.Control.Tabs is used to switch sheets in Calc
 */

/* global $ _ _UNO Hammer JSDialog cool app */
window.L.Control.Tabs = window.L.Control.extend({
	onAdd: function() {
		app.events.on('updatepermission', this._onUpdatePermission.bind(this));
		this._initialized = false;
	},

	_onUpdatePermission: function() {
		if (this._map.getDocType() !== 'spreadsheet') {
			return;
		}

		if (!this._initialized) {
			this._initialize();
		}
	},

	_initialize: function () {
		this._initialized = true;
		this._spreadsheetTabs = {};
		this._tabForContextMenu = 0;
		var map = this._map;
		map.tabsControl = this;
		var tableCell = document.getElementById('spreadsheet-toolbar');
		this._tabsCont = window.L.DomUtil.create('div', 'spreadsheet-tabs-container', tableCell);

		function areTabsMultiple() {
			var numItems = $('.spreadsheet-tab').length;
			if (numItems === 1) {
				return false;
			}
			return true;
		}

		this._menuPosEl = null;

		// THE ONE sheet-menu table. _buildMenuEntries() reads it for the
		// desktop/tablet dropdown AND, since G29/C6, for the phone bottom
		// sheet — so `visible` and `_checked` are evaluated for the tapped tab
		// at the moment the menu opens on every surface.
		//
		// It carried an `IconUtil.createMenuItemLink` HTML `name` per entry
		// until then, authored for a jQuery context menu this control no longer
		// opens, and handed straight to the mobile wizard, which writes labels
		// with textContent: nine rows of `<a class="context-menu-link …">` on a
		// 393px phone. Nothing read `name` on either surface. Deleted, not
		// worked around.
		this._menuItem = {
			'insertsheetbefore': {
				callback: (this._insertSheetBefore).bind(this),
				text: _('Insert sheet before this'),
				_image: 'InsertSheetBefore',
			},
			'insertsheetafter': {
				callback: (this._insertSheetAfter).bind(this),
				text: _('Insert sheet after this'),
				_image: 'InsertSheetAfter',
			},
			'.uno:Remove': {
				callback: (this._deleteSheet).bind(this),
				visible: function() {
					return areTabsMultiple() && !this._isProtectedSheet(this._tabForContextMenu);
				}.bind(this),
				_image: 'Remove',
			},
			'.uno:Name': {
				callback: (this._renameSheet).bind(this),
				visible: function() {
					return !this._isProtectedSheet(this._tabForContextMenu);
				}.bind(this),
				_uno: '.uno:RenameTable',
				_image: 'Name',
			},
			'.uno:DuplicateSheet': {
				callback: (this._duplicateSheet).bind(this),
				_image: 'DuplicateSheet',
			},
			'.uno:Protect': {
				callback: (this._protectSheet).bind(this),
				_image: 'Protect',
				_checked: function() { return this._isProtectedSheet(this._tabForContextMenu); }.bind(this),
			},
			'.uno:SetTabBgColor': {
				callback: (this._setTabColor).bind(this),
				visible: function() {
					return !this._isProtectedSheet(this._tabForContextMenu);
				}.bind(this),
				_image: 'SetTabBgColor',
			},
			'resettabcolor': {
				callback: (this._resetTabColor).bind(this),
				visible: function() {
					return !this._isProtectedSheet(this._tabForContextMenu)
						&& !!app.calc.getPartColor(this._tabForContextMenu);
				}.bind(this),
				text: _('Reset Tab Color'),
				_image: 'ResetTabBgColor',
			},
			'.uno:Show': {
				callback: (this._showSheet).bind(this),
				visible: function() {
					return app.calc.isAnyPartHidden();
				},
				_image: 'Show',
			},
			'.uno:Hide': {
				callback: (this._hideSheet).bind(this),
				visible: areTabsMultiple,
				_image: 'Hide',
			},
			'movesheetleft': {
				callback: (this._moveSheetLeft).bind(this),
				visible: areTabsMultiple,
				text: _('Move Sheet Left'),
				_image: 'MoveSheetLeft',
			},
			'movesheetright': {
				callback: (this._moveSheetRight).bind(this),
				visible: areTabsMultiple,
				text: _('Move Sheet Right'),
				_image: 'MoveSheetRight',
			},
			'.uno:Move': {
				callback: (this._moveOrCopySheet).bind(this),
				visible: areTabsMultiple,
				_image: 'Move',
			},
			'.uno:CopyTab': {
				callback: function() {this._map.sendUnoCommand('.uno:Move');}.bind(this),
				visible: function() {
					return !areTabsMultiple();
				},
				text: _('Copy Sheet...'),
				_image: 'CopyTab',
			},
		};

		this._menuCallbacks = {
			'insertsheetbefore': this._insertSheetBefore.bind(this),
			'insertsheetafter': this._insertSheetAfter.bind(this),
			'.uno:Remove': this._deleteSheet.bind(this),
			'.uno:RenameTable': this._renameSheet.bind(this),
			'.uno:DuplicateSheet': this._duplicateSheet.bind(this),
			'.uno:Protect': this._protectSheet.bind(this),
			'.uno:Show': this._showSheet.bind(this),
			'.uno:Hide': this._hideSheet.bind(this),
			'movesheetleft': this._moveSheetLeft.bind(this),
			'movesheetright': this._moveSheetRight.bind(this),
			'.uno:Move': this._moveOrCopySheet.bind(this),
			'.uno:CopyTab': function() { this._map.sendUnoCommand('.uno:Move'); }.bind(this),
			'.uno:SetTabBgColor': this._setTabColor.bind(this),
			'resettabcolor': this._resetTabColor.bind(this),
		};

		map.on('updateparts', this._updateDisabled, this);
	},

	_updateDisabled: function (e) {
		var parts = e.parts;
		var selectedPart = e.selectedPart;
		var docType = e.docType;

		if (docType === 'text') {
			return;
		}
		if (docType === 'spreadsheet') {

			// Track which default part has a sheet view active for tab icon display.
			app.calc.updateActiveSheetView(selectedPart);

			// Save scroll position
			var horizScrollPos = 0;
			var scrollDiv = window.L.DomUtil.get('spreadsheet-tab-scroll');
			if (scrollDiv) {
				horizScrollPos = scrollDiv.scrollLeft;
			}

			if ('partNames' in e) {
				while (this._tabsCont.firstChild) {
					this._tabsCont.removeChild(this._tabsCont.firstChild);
				}
				var ssTabScroll = window.L.DomUtil.create('div', 'spreadsheet-tab-scroll', this._tabsCont);
				ssTabScroll.id = 'spreadsheet-tab-scroll';

				ssTabScroll.setAttribute('role', 'tablist');
				ssTabScroll.setAttribute('aria-label', _('Sheets'));

				if (!window.mode.isSmallScreenDevice())
					ssTabScroll.style.overflowX = 'scroll';

				this._tabsCont.style.display = 'grid';

				for (var i = 0; i < parts; i++) {
					// Skip if hidden or a sheet view (implicitly hidden)
					if (app.calc.isPartHidden(i) || app.calc.isPartSheetView(i))
						continue;

					// create a drop zone indicator for the sheet tab
					// put the indicator on the left of the tab
					var dropZoneIndicator = window.L.DomUtil.create('div', 'tab-drop-area', ssTabScroll);
					dropZoneIndicator.id = 'drop-zone-' + i;
					var id = 'spreadsheet-tab' + i;
					var tab = window.L.DomUtil.create('button', 'spreadsheet-tab', ssTabScroll);
					tab.setAttribute('role', 'tab');
					var label = window.L.DomUtil.create('div', '', tab);
					window.L.DomUtil.create('div', 'lock', tab);
					window.L.DomUtil.create('div', 'view-indicator', tab);
					if (window.mode.isSmallScreenDevice() || window.mode.isTablet()) {
						(new Hammer(tab, {recognizers: [[Hammer.Press]]}))
							.on('press', function (j) {
								return function(e) {
									if (window.mode.isSmallScreenDevice()) {
										// Long press is muscle memory, so it keeps
										// reaching the same sheet menu the tap
										// grammar opens — never a dead end.
										this._openPhoneSheetMenu(j);
									} else if (!this._map.isReadOnlyMode()) {
										this._tabForContextMenu = j;
										this._openTabContextMenu(e);
									}
								};
							}(i).bind(this));
					}

					if (!scrollDiv && i === selectedPart) {
						horizScrollPos = tab.offsetLeft;
					}

					if (!window.mode.isSmallScreenDevice()) {
						window.L.DomEvent.on(tab, 'dblclick', function(j) {
							return function() {
								// window.app.console.err('Double clicked ' + j);
								this._tabForContextMenu = j;
								this._renameSheet();
							};
						}(i).bind(this));
						window.L.DomEvent.on(tab, 'contextmenu', function(j) {
							return function(e) {
								e.preventDefault();
								this._tabForContextMenu = j;
								this._openTabContextMenu(e);
							};
						}(i).bind(this));
					}

					if (app.calc.isPartProtected(i)) {
						window.L.DomUtil.addClass(tab, 'spreadsheet-tab-protected');
					}
					else {
						window.L.DomUtil.removeClass(tab, 'spreadsheet-tab-protected');
					}

					var sheetViewPart = app.calc.getSheetViewPartForDefaultPart(i);
					if (sheetViewPart >= 0 && app.calc.hasActiveSheetView(i)) {
						window.L.DomUtil.addClass(tab, 'spreadsheet-tab-sheetview');
					}
					else {
						window.L.DomUtil.removeClass(tab, 'spreadsheet-tab-sheetview');
					}

					const tabColor = app.calc.getPartColor(i);
					if (tabColor) {
						window.L.DomUtil.addClass(tab, 'spreadsheet-tab-colored');
						tab.style.setProperty('--tab-color', '#' + tabColor);
						const r = parseInt(tabColor.slice(0, 2), 16);
						const g = parseInt(tabColor.slice(2, 4), 16);
						const b = parseInt(tabColor.slice(4, 6), 16);
						const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
						if (luminance < 0.5) {
							tab.style.setProperty('--tab-text-color', '#ffffff');
							window.L.DomUtil.addClass(tab, 'spreadsheet-tab-lock-white');
						} else {
							tab.style.setProperty('--tab-text-color', '#1a1a1a');
							window.L.DomUtil.addClass(tab, 'spreadsheet-tab-lock-black');
						}
					}

					var tabName = e.partNames[i];
					label.textContent = tabName;
					tab.id = id;
					tab.setAttribute('aria-label', app.calc.isPartProtected(i)
						? _('{0}, protected').replace('{0}', tabName)
						: tabName);

					window.L.DomEvent
						.on(tab, 'click', window.L.DomEvent.stopPropagation)
						.on(tab, 'click', window.L.DomEvent.stop)
						.on(tab, 'click', this._onTabClick, this);
					window.L.DomEvent.on(tab, 'keydown', this._onTabKeyDown, this);
					this._addDnDHandlers(tab);
					this._spreadsheetTabs[id] = tab;
				}

				// add an additional dropZoneIndicator for the last sheet tab
				// put the indicator on the right of the last tab
				var dropZoneIndicatorForTheLastTab = window.L.DomUtil.create('div', 'tab-drop-area', ssTabScroll);
				dropZoneIndicatorForTheLastTab.id = 'drop-zone-end';

				// create drop zone container for the last drop zone indicator
				// when a tab is over this container, dropZoneIndicatorForTheLastTab will be shown
				var dropZoneEndContainer = window.L.DomUtil.create('div', '', ssTabScroll);
				dropZoneEndContainer.id = 'drop-zone-end-container';
				this._addDnDHandlers(dropZoneEndContainer);
				dropZoneEndContainer.setAttribute('draggable', false);

				// Google-Sheets phone chrome (docs/mobile-redesign/02 §7):
				// "+" beside the strip appends a sheet — same 'insertsheet'
				// action as the desktop SheetsBar "+". Rebuilt with the tabs
				// on every updateparts; styled in vulcan-theme.css §13-CALC.2.
				// Phone chrome only.
				//
				// 🔴 THE PARENT IS THE TABS CONTAINER, NOT ssTabScroll, and that
				// is the whole point of this control. #spreadsheet-tab-scroll is
				// an overflow-x:auto strip, so a button appended INSIDE it is the
				// last item of the SCROLLING CONTENT: measured on a 393px phone
				// it sat at x=379 with its centre at 401, off-screen, reachable
				// only by first swiping the tab list to its end — and one sheet
				// further away with every sheet it added. As a sibling it gets
				// its own grid track from .spreadsheet-tabs-container and is
				// permanently on screen at a full 44px. _tabsCont is emptied and
				// ssTabScroll re-created at the top of this block, so appending
				// here still rebuilds exactly once per updateparts, after the
				// strip. Nothing reads the button out of the strip: the tab
				// keyboard walk queries '.spreadsheet-tab' (_onTabKeyDown) and
				// the drag handlers test for .spreadsheet-tab / .tab-drop-area.
				//
				// The one thing that DOES count the strip's children is the
				// 'insertsheet' action (docdispatcher.ts:761), and this moves
				// that count by exactly one — back to the number desktop has
				// always sent. It cannot change where the sheet lands: the
				// count is 2 elements per visible tab plus the two end drop
				// zones, so it overshoots the sheet count either way, core
				// clamps the Index to the end, and SheetSwitch
				// .updateOnSheetInsertion's loop and reassignment are both
				// no-ops for an index at or past getNumberOfParts().
				if (window.mode.isSmallScreenDevice() &&
					document.documentElement.classList.contains('vulcan-mobile-chrome')) {
					var addSheetButton = window.L.DomUtil.create('button', 'vulcan-add-sheet', this._tabsCont);
					addSheetButton.id = 'vulcan-add-sheet';
					addSheetButton.type = 'button';
					addSheetButton.textContent = '+';
					addSheetButton.setAttribute('aria-label', _('Insert sheet'));
					window.L.DomEvent
						.on(addSheetButton, 'click', window.L.DomEvent.stopPropagation)
						.on(addSheetButton, 'click', window.L.DomEvent.stop)
						.on(addSheetButton, 'click', function() {
							if (!this._map.isReadOnlyMode())
								app.dispatcher.dispatch('insertsheet');
						}, this);
				}
			}

			var scrollCont = document.getElementById('spreadsheet-tab-scroll');
			var focusInTablist = scrollCont && scrollCont.contains(document.activeElement);
			for (var key in this._spreadsheetTabs) {
				var part =  parseInt(key.match(/\d+/g)[0]);
				var tabEl = this._spreadsheetTabs[key];
				window.L.DomUtil.removeClass(tabEl, 'spreadsheet-tab-selected');
				var isSelected = (part === selectedPart || app.calc.isDefaultPartOfSelectedSheetView(part));
				if (isSelected) {
					// close auto filter popups on sheet tab selected
					this._map.fire('closeAutoFilterDialog');
					this._map.fire('closepopups');
					window.L.DomUtil.addClass(tabEl, 'spreadsheet-tab-selected');
				}
				tabEl.setAttribute('aria-selected', isSelected ? 'true' : 'false');
				if (!focusInTablist)
					tabEl.setAttribute('tabindex', isSelected ? '0' : '-1');
			}

			// Restore horizontal scroll position
			scrollDiv = window.L.DomUtil.get('spreadsheet-tab-scroll');
			if (scrollDiv) {
				if (this._map.insertPage && this._map.insertPage.scrollToEnd) {
					this._map.insertPage.scrollToEnd = false;
					scrollDiv.scrollLeft = scrollDiv.scrollWidth;
				}
				else {
					scrollDiv.scrollLeft = horizScrollPos;
				}
				// A fresh open restores scrollLeft 0 while the document may
				// select its LAST sheet, leaving the selected tab outside the
				// strip viewport — the 14px corner insets narrowed the strip
				// enough for four tabs to overflow a 393px phone. Nudge the
				// minimum distance that makes the selected tab fully visible;
				// a restore that already shows it moves nothing, so a user's
				// own scroll position survives.
				if (this._isPhoneSheetStrip()) {
					var selectedTab = scrollDiv.querySelector('.spreadsheet-tab-selected');
					if (selectedTab) {
						var tabLeft = selectedTab.offsetLeft;
						var tabRight = tabLeft + selectedTab.offsetWidth;
						var viewLeft = scrollDiv.scrollLeft;
						var viewRight = viewLeft + scrollDiv.clientWidth;
						if (tabRight > viewRight)
							scrollDiv.scrollLeft = tabRight - scrollDiv.clientWidth;
						else if (tabLeft < viewLeft)
							scrollDiv.scrollLeft = tabLeft;
					}
				}
				// Desktop and tablet: reveal the selected tab whenever the
				// selected sheet CHANGES (the sheet list, Go to Sheet, a
				// link), so the restore above cannot leave it off-strip or
				// half-clipped. Measured from rects: offsetLeft is relative to
				// the offsetParent, not to the strip, which is how the active
				// tab ended up clipped by the strip's own left margin.
				// Unchanged selection keeps the user's own scroll position.
				else if (this._lastRevealedPart !== selectedPart) {
					this._lastRevealedPart = selectedPart;
					var current = scrollDiv.querySelector('.spreadsheet-tab-selected');
					if (current) {
						var tab = current.getBoundingClientRect();
						var view = scrollDiv.getBoundingClientRect();
						var inset = 8;
						if (tab.left < view.left + inset)
							scrollDiv.scrollLeft -= view.left + inset - tab.left;
						else if (tab.right > view.right - inset)
							scrollDiv.scrollLeft += tab.right - (view.right - inset);
					}
				}
			}
		}
	},

	_buildMenuEntries: function() {
		const entries = [];
		for (let key in this._menuItem) {
			const data = this._menuItem[key];
			let visible = true;
			if (Object.prototype.hasOwnProperty.call(data, 'visible')) {
				if (typeof data.visible === 'function') {
					visible = data.visible();
				} else {
					visible = !!data.visible;
				}
			}

			if (!visible) continue;

			const isUNO = key.startsWith('.uno:');
			if (Object.prototype.hasOwnProperty.call(data, '_uno')) key = data._uno;
			let text = isUNO ? _UNO(key, 'spreadsheet', true) : data.text;
			const checked = Object.prototype.hasOwnProperty.call(data, '_checked')
				? data._checked()
				: undefined;
			entries.push({
				id: key,
				type: 'action',
				text: text,
				img: data._image,
				checked: checked,
			});
		}

		return entries;
	},

	/*
	 * THE PHONE SHEET MENU (G27 / C6), curated for a 393px screen.
	 *
	 * Order is the order Google Sheets ships, destructive last. Two desktop
	 * rows are deliberately absent:
	 *
	 *   insertsheetbefore / insertsheetafter — the 44px "+" beside the strip
	 *       already appends a sheet; two more "insert" rows are desktop residue.
	 *   .uno:Move / .uno:CopyTab ("Move or Copy Sheet…") — opens a desktop
	 *       modal with a document-and-position picker, unusable at this width.
	 *       movesheetleft/right ARE the phone's reorder affordance until touch
	 *       drag-and-drop exists (_addDnDHandlers is HTML5 DnD).
	 *
	 * Every id here is a key _buildMenuEntries emits AND a key of
	 * _menuCallbacks, so there is no second callback table: a row that stops
	 * matching simply stops being offered, and the registry test below the
	 * fold (mocha_tests/CalcPhoneSheetMenu.test.ts) is what makes that loud.
	 */
	_phoneSheetActions: [
		'.uno:RenameTable',
		'.uno:DuplicateSheet',
		'.uno:SetTabBgColor',
		'resettabcolor',
		'.uno:Protect',
		'.uno:Hide',
		'.uno:Show',
		'movesheetleft',
		'movesheetright',
		'.uno:Remove',
	],

	/*
	 * The bottom sheet, built AT PRESS TIME from the same entries the desktop
	 * dropdown opens. That is the whole fix for C6: the labels are the plain
	 * _UNO strings rather than desktop context-menu markup, `visible` and
	 * `_checked` are evaluated for THIS tab at THIS moment (the phone used to
	 * offer Rename/Delete/Set-colour on a protected sheet, because the legacy
	 * adapter never read `visible`), and the shape is no longer frozen at the
	 * last `updateparts`.
	 */
	_phoneSheetMenu: function() {
		var order = this._phoneSheetActions;
		var entries = this._buildMenuEntries().filter(function(entry) {
			return order.indexOf(entry.id) !== -1;
		});
		entries.sort(function(a, b) {
			return order.indexOf(a.id) - order.indexOf(b.id);
		});

		var callbacks = this._menuCallbacks;
		var tab = window.L.DomUtil.get('spreadsheet-tab' + this._tabForContextMenu);
		var sheetName = tab ? tab.textContent.trim() : '';

		return {
			// A real id: without one every id-less wizard window pools into the
			// same content element (Control.MobileWizard._getContentForWindowId),
			// and the escape ladder has nothing to name.
			id: 'vulcan-sheet-menu',
			type: 'container',
			text: sheetName || _('Sheet'),
			enabled: true,
			children: [
				{
					id: 'vulcan-sheet-menu-list',
					type: 'mainmenu',
					enabled: true,
					children: entries.map(function(entry, index) {
						return {
							// Not the command id: `id` becomes a `ui-header-<id>`
							// class and is looked up in _menuItemHandlers.
							id: 'vulcan-sheet-action-' + index,
							type: 'menuitem',
							text: entry.text,
							// Only read to pick the row icon; execution goes
							// through executionType 'callback' below.
							command: entry.id,
							checked: entry.checked,
							enabled: true,
							executionType: 'callback',
							callback: callbacks[entry.id],
							children: [],
						};
					}),
				},
			],
		};
	},

	/*
	 * Phone chrome, BOTH halves. js/global.js stamps vulcan-mobile-chrome iff
	 * `!desktopChrome && isSmallScreenDevice()`, and `?vulcanChrome=desktop` on
	 * a real phone leaves the screen test TRUE with the class ABSENT — a state
	 * the screen test alone cannot see. The tap grammar below is a chrome
	 * behaviour, so it takes both; the label fix above is a bug fix and
	 * deliberately applies to every small screen.
	 */
	_isPhoneSheetStrip: function() {
		return window.mode.isSmallScreenDevice() &&
			document.documentElement.classList.contains('vulcan-mobile-chrome');
	},

	/*
	 * G27 — TAP THE ACTIVE SHEET TO OPEN ITS MENU.
	 *
	 * Google's grammar exactly: a tap on a NON-active tab switches to it (the
	 * most common action on the strip, so it keeps costing one tap), and a tap
	 * on the tab you are already on opens the sheet submenu. Off phone chrome
	 * this reduces to the two handlers it replaced — substitute
	 * _isPhoneSheetStrip() = false and _setPart + map.focus run in that order,
	 * exactly as they were chained. A switch refused because a comment is
	 * being edited has put the caret in that comment, so the grid does not
	 * take focus: the next keys would overwrite the comment's anchor cell.
	 */
	_onTabClick: function(e) {
		if (this._isPhoneSheetStrip() &&
			window.L.DomUtil.hasClass(e.currentTarget, 'spreadsheet-tab-selected')) {
			var match = e.currentTarget.id.match(/\d+/);
			// No map.focus() here: the sheet is the thing being opened, and
			// focusing the document behind it is how a keyboard gets raised
			// under a bottom sheet.
			if (match) this._openPhoneSheetMenu(parseInt(match[0]));
			return;
		}
		if (!this._setPart(e))
			this._map.focus();
	},

	/** Open the phone sheet menu for one tab. The single opener: tap and press. */
	_openPhoneSheetMenu: function(tabIndex) {
		if (this._map.isReadOnlyMode())
			return;
		this._tabForContextMenu = tabIndex;
		window.contextMenuWizard = true;
		this._map.fire('mobilewizard', {data: this._phoneSheetMenu()});
	},

	_createMenuPositionElement(evt) {
		const container = document.body;
		if (!this._menuPosEl) {
			this._menuPosEl = document.createElement('div');
			container.append(this._menuPosEl);
		}
		const rect = container.getBoundingClientRect();

		let clientX = evt.clientX;
		let clientY = evt.clientY;
		if (typeof clientX !== 'number' || typeof clientY !== 'number') {
			const target = evt.currentTarget || evt.target;
			const targetRect = target.getBoundingClientRect();
			clientX = targetRect.left;
			clientY = targetRect.top;
		}

		this._menuPosEl.style.position = 'absolute';
		this._menuPosEl.style.zIndex = '1500';
		this._menuPosEl.style.left = (clientX - rect.left) + 'px';
		this._menuPosEl.style.top = (clientY - rect.top) + 'px';

		return this._menuPosEl;
	},

	openContextMenuForFocusedTab: function() {
		if (this._map.isReadOnlyMode())
			return;

		var tab = document.activeElement;
		if (!tab || !tab.classList || !tab.classList.contains('spreadsheet-tab'))
			return;

		var match = tab.id.match(/\d+/);
		if (!match)
			return;

		this._tabForContextMenu = parseInt(match[0]);
		this._openTabContextMenu({ type: 'keydown', currentTarget: tab });
	},

	_openTabContextMenu: function(evt) {
		if (this._map.isReadOnlyMode())
			return;

		JSDialog.CloseAllDropdowns();
		const menuPosEl = this._createMenuPositionElement(evt);

		const keyboardInitiated = !!evt && evt.type === 'keydown';

		const entries = this._buildMenuEntries();
		const callback = (objectType, eventType, object, data, entry) => {
			if (eventType !== 'selected')
				return false;
			const cb = this._menuCallbacks[entry.id];
			if (cb) {
				cb();
				JSDialog.CloseAllDropdowns();
				return true;
			}
			return false;
		};
		JSDialog.OpenDropdown(
			'spreadsheet-tab-menu',
			menuPosEl,
			entries,
			callback,
			'bottom',
			false,
			false,
			!keyboardInitiated,
		);
	},

	_addDnDHandlers: function(element) {
		if (!this._map.isReadOnlyMode()) {
			element.setAttribute('draggable', true);
			element.addEventListener('dragstart', this._handleDragStart.bind(this), false);
			element.addEventListener('dragenter', this._handleDragEnter, false);
			element.addEventListener('dragover', this._handleDragOver, false);
			element.addEventListener('dragleave', this._handleDragLeave, false);
			element.addEventListener('drop', this._handleDrop.bind(this), false);
			element.addEventListener('dragend', this._handleDragEnd, false);
		}
	},

	_onTabKeyDown: function (e) {
		var key = e.key;
		if (key !== 'ArrowLeft' && key !== 'ArrowRight' &&
			key !== 'Home' && key !== 'End' &&
			key !== 'Enter' && key !== ' ' && key !== 'Spacebar')
			return;

		var scroll = document.getElementById('spreadsheet-tab-scroll');
		if (!scroll)
			return;
		var tabs = Array.prototype.filter.call(
			scroll.querySelectorAll('.spreadsheet-tab'),
			function (t) { return t.offsetParent !== null; });
		if (!tabs.length)
			return;

		var current = tabs.indexOf(e.currentTarget);
		if (current === -1)
			return;

		if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
			window.L.DomEvent.stop(e);
			// Not after a refused switch: see _onTabClick.
			if (!this._setPart(e))
				this._map.focus();
			return;
		}

		var next = current;
		if (key === 'ArrowLeft')
			next = (current - 1 + tabs.length) % tabs.length;
		else if (key === 'ArrowRight')
			next = (current + 1) % tabs.length;
		else if (key === 'Home')
			next = 0;
		else if (key === 'End')
			next = tabs.length - 1;

		if (next !== current) {
			window.L.DomEvent.stop(e);
			tabs[current].setAttribute('tabindex', '-1');
			tabs[next].setAttribute('tabindex', '0');
			tabs[next].focus();
		}
	},

	// Set the part by index. Return true if cancelled.
	_setPartIndex: function(index) {
		const editingComment = cool.Comment.isAnyEdit();
		if (editingComment) {
			const commentSection = app.sectionContainer.getSectionWithName(app.CSections.CommentList.name);
			if (commentSection) {
				commentSection.navigateAndFocusComment(editingComment);
			}
			return true;
		}

		this._map._docLayer._clearReferences();
		this._map.setPart(index, /*external:*/ false, /*calledFromSetPartHandler:*/ true);
	},

	// Return true if the switch was refused.
	_setPart: function (e) {
		var part = e.currentTarget.id.match(/\d+/g)[0];
		if (part == null) {
			return;
		}

		part = parseInt(part);

		if (part !== this._map._docLayer._selectedPart) {
			return this._setPartIndex(part);
		}
	},

	//selected sheet is moved to new index
	_moveSheet: function (newIndex) {
		var currentTab = this._map.getCurrentPartNumber();
		// odd but true: the base index changes according to the tab is dragged
		// on the left or on the right wrt. the current tab position
		var newIndexZeroBased = newIndex > currentTab ? newIndex - 2 : newIndex - 1;
		this._map._docLayer._sheetSwitch.updateOnSheetMoved(currentTab, newIndexZeroBased);
		this._map.sendUnoCommand('.uno:Move?Copy:bool=false&UseCurrentDocument:bool=true&Index=' + newIndex);
	},

	_moveOrCopySheet: function () {
		var contextMenuTab = this._tabForContextMenu;
		this._map.sendUnoCommand('.uno:Move?FromContextMenu:bool=true&MoveOrCopySheetDialog:bool=true&ContextMenuIndex=' + contextMenuTab);
	},

	_moveSheetLR: function (contextMenuTab, newIndex) {
		if (contextMenuTab !== undefined && contextMenuTab >= 0)
			this._map.sendUnoCommand('.uno:Move?Copy:bool=false&UseCurrentDocument:bool=true&FromContextMenu:bool=true&ContextMenuIndex=' + contextMenuTab + '&Index=' + newIndex);
	},

	_moveSheetLeft: function () {
		//core handles sheet with 1 base indexing
		// 0 index means last sheet
		var contextMenuTab = this._tabForContextMenu;
		if (contextMenuTab <= 0) return;

		this._map._docLayer._sheetSwitch.updateOnSheetMoved(contextMenuTab, contextMenuTab - 1);

		// core handles the decreasing of contextMenuTab by 1
		// so, no need to do it here (for the second parameter)
		this._moveSheetLR(contextMenuTab, contextMenuTab);
	},

	_moveSheetRight: function () {
		var contextMenuTab = this._tabForContextMenu;

		this._map._docLayer._sheetSwitch.updateOnSheetMoved(contextMenuTab, contextMenuTab + 1);

		/*
		Why there is '+3' ?
		- core handles sheet with 1 base indexing, add +1.
		- since we move right, add +1.
		- on the core side, there is a -1 for this value,
		so we add +1 again.
		*/
		this._moveSheetLR(contextMenuTab, contextMenuTab + 3);
	},

	_insertSheetBefore: function() {
		this._map.insertPage(this._tabForContextMenu);
	},

	_insertSheetAfter: function() {
		this._map.insertPage(this._tabForContextMenu + 1);
	},

	_deleteSheet: function() {
		var nPos = this._tabForContextMenu;
		var message = _('Are you sure you want to delete sheet, {sheet}?').replace('{sheet}', $('#spreadsheet-tab' + this._tabForContextMenu).text());

		this._map.uiManager.showInfoModal('delete-sheet-modal', '', message, '', _('OK'), function() {
			this._map.deletePage(nPos);
		}.bind(this), true, 'delete-sheet-modal-response');
	},

	_renameSheet: function() {
		var map = this._map;
		var nPos = this._tabForContextMenu;
		var tabName = $('#spreadsheet-tab' + this._tabForContextMenu).text();
		this._map.uiManager.showInputModal('rename-calc-sheet', _('Rename sheet'), _('Enter new sheet name'), tabName, _('OK'),
			function (value) {
				map.renamePage(value, nPos);
			});
	},

	// Engine duplicates the current tab, so switch to the context-menu tab first.
	_duplicateSheet: function() {
		if (!this._setPartIndex(this._tabForContextMenu)) {
			this._map.sendUnoCommand('.uno:DuplicateSheet');
		}
	},

	// Trigger sheet protection. It seems that it does it for the current sheet
	// so we select it first.
	_protectSheet: function() {
		if (!this._setPartIndex(this._tabForContextMenu)) {
			this._map.sendUnoCommand('.uno:Protect');
		}
	},

	// Optimistically apply the new color (or clear) to the tab DOM so the visual
	// is immediate, regardless of when the engine round-trip arrives.
	_applyTabColorVisual: function(tabIdx, hexNoHash) {
		const tab = window.L.DomUtil.get('spreadsheet-tab' + tabIdx);
		if (!tab) return;
		if (!hexNoHash) {
			window.L.DomUtil.removeClass(tab, 'spreadsheet-tab-colored');
			window.L.DomUtil.removeClass(tab, 'spreadsheet-tab-lock-black');
			window.L.DomUtil.removeClass(tab, 'spreadsheet-tab-lock-white');
			tab.style.removeProperty('--tab-color');
			tab.style.removeProperty('--tab-text-color');
			return;
		}
		const c = hexNoHash.replace('#', '');
		window.L.DomUtil.addClass(tab, 'spreadsheet-tab-colored');
		tab.style.setProperty('--tab-color', '#' + c);
		const r = parseInt(c.slice(0, 2), 16);
		const g = parseInt(c.slice(2, 4), 16);
		const b = parseInt(c.slice(4, 6), 16);
		const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
		if (luminance < 0.5) {
			tab.style.setProperty('--tab-text-color', '#ffffff');
			window.L.DomUtil.addClass(tab, 'spreadsheet-tab-lock-white');
			window.L.DomUtil.removeClass(tab, 'spreadsheet-tab-lock-black');
		} else {
			tab.style.setProperty('--tab-text-color', '#1a1a1a');
			window.L.DomUtil.addClass(tab, 'spreadsheet-tab-lock-black');
			window.L.DomUtil.removeClass(tab, 'spreadsheet-tab-lock-white');
		}
	},

	// Engine operates on the current tab, so switch first. Then open the same
	// JSDialog color picker used by the sidebar/notebookbar; selecting a color
	// auto-dispatches .uno:TabBgColor via sendColorCommand. setTimeout defers
	// past the context-menu's CloseAllDropdowns so our picker isn't killed.
	_setTabColor: function() {
		if (this._setPartIndex(this._tabForContextMenu)) return;
		const tabIdx = this._tabForContextMenu;
		const anchor = window.L.DomUtil.get('spreadsheet-tab' + tabIdx) || this._menuPosEl;
		if (!anchor) return;
		const self = this;
		setTimeout(function() {
			const entries = [
				{
					id: 'tab-bg-color-picker',
					type: 'colorpicker',
					command: '.uno:TabBgColor',
				},
				// Sibling separator so the popup isn't classified as one-child,
				// which would strip the picker's outer padding.
				{ type: 'separator' },
			];
			JSDialog.OpenDropdown(
				'tab-bg-color-dropdown',
				anchor,
				entries,
				function() {},
				'bottom',
				false,
				false,
				true,
			);
			// Attach an optimistic update listener once the dropdown DOM exists.
			setTimeout(function() {
				const dropdown = JSDialog.GetDropdown
					? JSDialog.GetDropdown('tab-bg-color-dropdown')
					: null;
				if (!dropdown) return;
				dropdown.addEventListener('click', function(evt) {
					const target = evt.target;
					const colorEntry = target.closest('.ui-color-picker-entry');
					if (colorEntry) {
						self._applyTabColorVisual(tabIdx, colorEntry.getAttribute('value'));
						return;
					}
					if (target.id === 'transparent-color-button' ||
						(target.closest && target.closest('#transparent-color-button'))) {
						self._applyTabColorVisual(tabIdx, null);
					}
				}, true);
			}, 0);
		}, 0);
	},

	_resetTabColor: function() {
		if (this._setPartIndex(this._tabForContextMenu)) return;
		this._applyTabColorVisual(this._tabForContextMenu, null);
		this._map.sendUnoCommand('.uno:TabBgColor', {
			'TabBgColor.Color': { type: 'long', value: -1 },
		});
	},

	_isProtectedSheet: function(idx) {
		var tab = window.L.DomUtil.get('spreadsheet-tab' + idx);
		return tab && window.L.DomUtil.hasClass(tab, 'spreadsheet-tab-protected');
	},

	_showSheet: function() {
		this._map.showPage();
	},

	_hideSheet: function() {
		this._map.hidePage(this._tabForContextMenu);
	},

	_handleDragStart: function(e) {
		this._setPart(e);
		e.dataTransfer.effectAllowed = 'move';
	},

	_handleDragEnter: function() {

	},

	_handleDragOver: function(e) {
		if (e.preventDefault) {
			e.preventDefault();
		}

		// By default we move when dragging, but can
		// support duplication with ctrl in the future.
		e.dataTransfer.dropEffect = 'move';

		e.currentTarget.previousElementSibling.classList.add('tab-drop-area-active');

		return false;
	},

	_handleDragLeave: function (e) {
		if ($(e.target).hasClass('spreadsheet-tab') || (e.target.getAttribute('id') == 'drop-zone-end-container'))
			e.currentTarget.previousElementSibling.classList.remove('tab-drop-area-active');
	},

	_handleDrop: function(e) {
		if (e.stopPropagation) {
			e.stopPropagation();
		}

		e.currentTarget.previousElementSibling.classList.remove('tab-drop-area-active');
		var targetIndex = this._map._docLayer._partNames.indexOf(e.target.innerText);
		this._moveSheet(targetIndex + 1); // drop to left side of the tab
	},

	_handleDragEnd: function (e) {
		e.currentTarget.previousElementSibling.classList.remove('tab-drop-area-active');
	}
});

window.L.control.tabs = function (options) {
	return new window.L.Control.Tabs(options);
};
