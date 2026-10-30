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
 * window.L.Control.MobileSlide is used to add new slide button on the Impress document.
 *
 * Vulcan Office (docs/mobile-redesign/03 §1/§5): under the Google-style phone
 * chrome the add affordance is a FLOATING ACTION BUTTON pinned to the bottom
 * right of the document area, and tapping it opens a slide-layout picker — the
 * same trimmed layout set Google offers — through the stock JSDialog dropdown
 * machinery the filmstrip's long-press menu already uses. Without the
 * html.vulcan-mobile-chrome marker the stock floating corner button is kept
 * untouched.
 *
 * 🔴 WHY A CORNER FAB AND NOT THE FILMSTRIP TILE IT REPLACES.
 * Until now this control appended a card-sized "+" tile to the END of the
 * bottom filmstrip (vulcan-theme.css §13i.5, pinned last with `order: 9999`).
 * The parity matrix scored that `gap-structural` at row 5 for three passes and
 * the row never moved; this is the move. Google's row is unambiguous —
 * Google Slides parity catalogue, "New-slide FAB (bottom right)", importance
 * `core`: "A floating '+' button at the bottom right of the editor. Tapping it
 * opens a layout picker sheet; picking a layout inserts a new slide with that
 * layout after the current one." The layout-forced-at-insert half was already
 * parity (the picker below); only the placement was not.
 *
 * The standing rule ("make it like Slides") is reason enough on its own, so the
 * bar for keeping the tile was: name something concrete that makes the tile
 * better HERE. Two candidate arguments were checked and both fail:
 *
 *   1. "A corner FAB costs canvas, and canvas is the point on a viewer-first
 *      surface." True in isolation, but it does not distinguish us from Slides:
 *      Slides' phone filmstrip is bottom-anchored too (google-slides.json,
 *      "Bottom filmstrip": "A horizontal strip of slide thumbnails runs along
 *      the bottom of the edit surface") and Google still floats the FAB over
 *      the canvas above it. Same geometry, same trade, and they took it. It
 *      also costs nothing in the posture that matters most: the FAB exists only
 *      in EDIT permission (ImpressTileLayer.onUpdatePermission adds this
 *      control on 'edit' and removes it otherwise), so the read posture — the
 *      one the direction calls first class — never sees it.
 *
 *   2. "A second bottom-right FAB collides with the pencil FAB." It does not.
 *      #mobile-edit-button is the READONLY→edit affordance: Permission.js:85
 *      and :155 hide it on entering edit, and this control is only on the map
 *      in edit. They are never on screen together.
 *
 * And the tile has a concrete defect the FAB does not: the strip is
 * horizontally scrollable (`overflow-x: auto`, vulcan-theme.css §13i.2) and the
 * tile is pinned to its END, so on any deck longer than about four slides the
 * one control that CREATES a slide is off-screen behind a scroll — worst
 * exactly where you are most likely to be adding slides. The FAB is at a fixed
 * address the whole time.
 *
 * Escape hatch: a FAB adds no depth, so it owes no back affordance. The layout
 * picker it opens does add depth, and its first, sticky row is the explicit
 * upper-left Close control.
 */

/* global _ JSDialog */

// Google's phone layout picker offers a handful of stock layouts, not the
// engine's full sixteen (spec 03 §5; cut discipline per 00). The WhatLayout
// values follow AutoLayout in autolayout.hxx, the icon names LOUtil's
// insertpage…→layoutNN mapping.
//
// Hoisted to a shared global so the filmstrip '+' tile (which dispatches
// InsertPage) and the phone kebab's Slide ▸ Change layout (which dispatches
// AssignLayout) read ONE list and cannot drift apart. Built lazily rather than
// as a constant so _() runs after l10n is up. Load order is safe despite
// `module: none` concatenation: Control.Menubar.ts is concatenated earlier but
// only calls this from `new Menubar()`, which runs long after bundle load.
window.getVulcanSlideLayouts = function () {
	return [
		{ layout: 20, img: 'layout00', text: _('Blank Slide') },
		{ layout: 0, img: 'layout01', text: _('Title Slide') },
		{ layout: 1, img: 'layout02', text: _('Title, Content') },
		{ layout: 3, img: 'layout03', text: _('Title and 2 Content') },
		{ layout: 19, img: 'layout04', text: _('Title Only') },
		{ layout: 32, img: 'layout05', text: _('Centered Text') },
	];
};

window.L.Control.MobileSlide = window.L.Control.extend({
	options: {
		position: 'bottomright'
	},

	// See window.getVulcanSlideLayouts above — shared with the phone kebab.
	_getVulcanLayouts: function () {
		return window.getVulcanSlideLayouts();
	},

	onAdd: function (map) {
		this._map = map;

		// Both halves of the phone gate hold here: this control is only
		// CONSTRUCTED under window.mode.isSmallScreenDevice()
		// (ImpressTileLayer.js:39-41), and this line is the chrome half. With
		// vulcanChrome=desktop the class is absent and _initLayout() below
		// reproduces HEAD exactly.
		if (document.documentElement.classList.contains('vulcan-mobile-chrome')) {
			this._addFab();
			// L.Control contract: hand Leaflet an (empty, hidden) corner
			// container; the real affordance is the FAB, which is positioned
			// against #document-container rather than a Leaflet corner.
			if (!this._container) {
				this._container = window.L.DomUtil.create('div');
				this._container.style.display = 'none';
			}
			return this._container;
		}

		if (!this._container) {
			this._initLayout();
		}

		return this._container;
	},

	onRemove: function () {
		this._hideFab();
		this._map = undefined;
	},

	_onAddSlide: function () {
		this._map.insertPage();
	},

	// The FAB is parented to #document-container, NOT to the filmstrip and NOT
	// to body. #document-container is `position: relative` (cool.css:206-216),
	// so it is a containing block for the absolute positioning in
	// device-mobile.css, and in portrait it is the flex sibling that ends where
	// the filmstrip begins (vulcan-theme.css §13i.1 gives
	// #presentation-controls-wrapper.portrait intrinsic height in the body
	// column). Anchoring there means one rule — `right: 16px; bottom: 16px` —
	// puts the FAB above the strip in portrait and clear of it in landscape,
	// where the strip docks left, with no orientation branch to keep in sync.
	// It also shrinks with the container when the host reports the keyboard,
	// which a `position: fixed` FAB would not: fixed and the vh units resolve
	// against the initial containing block, which is the bug the bottom sheet
	// already had to be fixed for.
	_addFab: function () {
		if (this._fab) {
			this._fab.style.display = '';
			return;
		}
		// Static markup (html/cool.html.m4:211), so this is belt-and-braces.
		// Falling back to body degrades the anchor (the FAB then sits over the
		// filmstrip instead of above it) rather than removing the only phone
		// route to inserting a slide.
		var host =
			document.getElementById('document-container') || document.body;
		if (!host) return;

		var fab = document.createElement('button');
		fab.id = 'vulcan-addslide-fab';
		fab.type = 'button';
		fab.title = _('New Slide');
		fab.setAttribute('aria-label', _('New Slide'));
		fab.textContent = '+';
		fab.addEventListener('click', this._onFabClick.bind(this));
		host.appendChild(fab);
		this._fab = fab;
	},

	_hideFab: function () {
		// Keep the node (and its dropdown anchor identity) for the next edit
		// session; updatepermission flips add/remove on every mode switch.
		if (this._fab) this._fab.style.display = 'none';
	},

	// A depth-adding phone surface owes an explicit way out in its upper-left
	// corner. Render this real pushbutton as a sibling BEFORE the listbox — via
	// OpenDropdown's `headerList` option (Util.Dropdown.ts:39-60) — not as a
	// seventh fake layout option and not through after-render DOM injection.
	// Being part of the JSON the builder builds, it sizes and places WITH the
	// popup rather than after it, it never impersonates a layout, and it takes
	// the popup's initial focus (`json.init_focus_id = header.id`). The
	// popup-specific CSS (vulcan-theme.css §13i.12) keeps it sticky with a full
	// 44px target.
	_onFabClick: function (e) {
		e.preventDefault();
		e.stopPropagation();
		if (!this._map || this._map._permission !== 'edit') return;

		var that = this;
		var entries = this._getVulcanLayouts().map(function (item, index) {
			return {
				id: 'vulcan-newslide-' + item.layout,
				type: 'comboboxentry',
				text: item.text,
				img: item.img,
				pos: index,
			};
		});
		// Kept OUT of `entries` on purpose: inside the array it would land in
		// the listbox grid, be counted by `rows: entries.length`, and compete
		// with the layout rows for the default selection. As `headerList.header`
		// it is a sibling of the grid, which is also the shape the CSS and the
		// keyboard nav (Widget.DropDown.ts:113-114 dropdownHeaderId) expect.
		// No text glyph: the close mark is a CSS-masked ::before on the
		// button (vulcan-theme.css §15, `vulcan-glyph-cancel` idiom), so the
		// JSON carries only the fields Widget.PushButton reads. `text` stays a
		// string — the access-key derivation reads it unconditionally.
		var header = {
			id: 'vulcan-addslide-layout-close',
			type: 'pushbutton',
			text: '',
			aria: { label: _('Close') },
		};

		var callback = function (objectType, eventType, object, data, entry) {
			if (
				objectType === 'pushbutton' &&
				eventType === 'click' &&
				object &&
				object.id === 'vulcan-addslide-layout-close'
			) {
				// Send focus back to the FAB that opened the picker, and tell
				// the close path we did it (Util.Dropdown.ts:333) so it skips
				// its own restore. Without the flag the framework's
				// focusToLastElement runs in a LATER layouting task and wins:
				// on iOS a tap never focuses a <button>, so the remembered
				// "last element" is body and focus would land on the map
				// instead of the control the user just came from. Fall back to
				// the framework restore if the FAB is somehow gone, rather than
				// dropping focus on the floor.
				JSDialog.CloseDropdown('vulcan-addslide-layout', !!that._fab);
				if (that._fab) that._fab.focus();
				return true;
			}
			if (eventType !== 'selected' || !entry) return false;
			var layout = parseInt(String(entry.id).replace('vulcan-newslide-', ''), 10);
			if (!isNaN(layout))
				that._map.sendUnoCommand('.uno:InsertPage?WhatLayout:long=' + layout);
			JSDialog.CloseAllDropdowns();
			return true;
		};

		JSDialog.OpenDropdown(
			'vulcan-addslide-layout',
			this._fab,
			entries,
			callback,
			'',
			false,
			false,
			true,
			{
				headerList: {
					header: header,
					listboxLabel: _('Slide layouts'),
				},
			},
		);
	},

	_initLayout: function () {
		this._container = window.L.DomUtil.create('div', 'leaflet-control-zoom leaflet-bar');
		this._createButton('+', '', 'leaflet-control-zoom-in',  this._container, this._onAddSlide,  this);
		return this._container;
	},

	_createButton: function (html, title, className, container, fnOnClick, context) {
		var button = window.L.DomUtil.create('a', className, container);
		button.innerHTML = html;
		button.href = '#';
		button.title = title;

		window.L.DomEvent
		    .on(button, 'click', window.L.DomEvent.stopPropagation)
		    .on(button, 'mousedown', window.L.DomEvent.stopPropagation)
		    .on(button, 'click', window.L.DomEvent.preventDefault)
		    .on(button, 'click', this._map.focus, this._map)
		    .on(button, 'click', fnOnClick, context);

		return button;
	},
});

window.L.control.mobileSlide = function (options) {
	return new window.L.Control.MobileSlide(options);
};
