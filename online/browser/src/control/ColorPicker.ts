// @ts-strict-ignore
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
 * ColorPicker is used for building a native HTML color picker
 * panel to be used by the properties mobile wizard.
 */

/* global _ */

type ColorTypes = 'BASIC_COLOR' | 'TINT';

interface ColorPickerOptions {
	selectedColor: string;
	noColorControl: boolean;
	autoColorControl: boolean;
	selectionCallback: (color: string) => unknown;
}

interface ColorEvent {
	id: string;
}

class ColorPicker {
	// The "selected" mark on the no-colour / automatic controls: a CSS-masked
	// sprite painted in currentColor (vulcan-theme.css §15), never a text
	// dingbat — every mark this chrome draws comes from the icon set.
	static readonly CHECK_MARK_HTML =
		'<span class="vulcan-glyph-icon vulcan-glyph-check" aria-hidden="true"></span>';
	options: ColorPickerOptions;

	_selectedBasicColorIndex: number;
	_selectedTintIndex: number;

	static ID = 0;
	static readonly ID_TAG = 'color-picker-';

	/*
	 * ELEVEN families, not ten. The eleventh (cornflower blue, #4a86e8) sat
	 * commented out behind a note that the layout could not fit it — true of
	 * the old `display: table` strip with its 2px borders and 4% gutters, and
	 * no longer true of the continuous band the strip is now: eleven cells
	 * that each take `flex: 1 1 0` of one full-bleed row fit by construction,
	 * at any width, with no per-cell number to keep in step.
	 *
	 * These values are the reference palette MEASURED off the phone capture
	 * (round-11 C8), and they are the half of the widget that is real design
	 * rather than device theming: the family colours, every shade below and
	 * the selection marks are identical under two different wallpaper seeds,
	 * so they are safe to carry verbatim. Everything painted AROUND them —
	 * sheet fill, rules, tab underline, text — is seed-derived on that device
	 * and is bound to our own tokens in css/mobilewizard.css instead.
	 */
	static readonly BASIC_COLORS = [
		'#000000',
		'#980000',
		'#ff0000',
		'#ff9900',
		'#ffff00',
		'#00ff00',
		'#00ffff',
		'#4a86e8',
		'#0000ff',
		'#9900ff',
		'#ff00ff',
	] as const;

	static readonly TINTS = {
		/*
		 * Grey carries TEN shades where every other family carries eight, so
		 * its grid lays out 5x2 rather than 4x2 — `_createTintSamples` splits
		 * on `length / 2` and needs no branch to do it. The extra pair buys
		 * the two ends: black is reachable only here, and the four light
		 * greys are the ones a fill actually uses.
		 */
		'#000000': [
			'#000000',
			'#434343',
			'#666666',
			'#999999',
			'#b7b7b7',
			'#cccccc',
			'#d9d9d9',
			'#efefef',
			'#f3f3f3',
			'#ffffff',
		],
		'#980000': [
			'#5b0f00',
			'#85200c',
			'#a61c00',
			'#980000',
			'#cc4125',
			'#dd7e6b',
			'#e6b8af',
			'#ffffff',
		],
		'#ff0000': [
			'#660000',
			'#990000',
			'#cc0000',
			'#ff0000',
			'#e06666',
			'#ea9999',
			'#f4cccc',
			'#ffffff',
		],
		'#ff9900': [
			'#783f04',
			'#b45f06',
			'#e69138',
			'#ff9900',
			'#f6b26b',
			'#f9cb9c',
			'#fce5cd',
			'#ffffff',
		],
		'#ffff00': [
			'#7f6000',
			'#bf9000',
			'#f1c232',
			'#ffff00',
			'#ffd966',
			'#ffe599',
			'#fff2cc',
			'#ffffff',
		],
		'#00ff00': [
			'#274e13',
			'#38761d',
			'#6aa84f',
			'#00ff00',
			'#93c47d',
			'#b6d7a8',
			'#d9ead3',
			'#ffffff',
		],
		'#00ffff': [
			'#0c343d',
			'#134f5c',
			'#45818e',
			'#00ffff',
			'#76a5af',
			'#a2c4c9',
			'#d0e0e3',
			'#ffffff',
		],
		'#4a86e8': [
			'#1c4587',
			'#1155cc',
			'#3c78d8',
			'#4a86e8',
			'#6d9eeb',
			'#a4c2f4',
			'#c9daf8',
			'#ffffff',
		],
		'#0000ff': [
			'#073763',
			'#0b5394',
			'#3d85c6',
			'#0000ff',
			'#6fa8dc',
			'#9fc5e8',
			'#cfe2f3',
			'#ffffff',
		],
		'#9900ff': [
			'#20124d',
			'#351c75',
			'#674ea7',
			'#9900ff',
			'#8e7cc3',
			'#b4a7d6',
			'#d9d2e9',
			'#ffffff',
		],
		'#ff00ff': [
			'#4c1130',
			'#741b47',
			'#a64d79',
			'#ff00ff',
			'#c27ba0',
			'#d5a6bd',
			'#ead1dc',
			'#ffffff',
		],
	} as const;

	_pickerID: number;
	_basicColorSampleIdTag: string;
	_tintSampleIdTag: string;
	_noColorControlId: string;
	_autoColorControlId: string;
	_basicTabId: string;
	_customTabId: string;
	_basicPageId: string;
	_customPageId: string;
	_customListId: string;

	_selectedColorElement: HTMLElement | undefined;

	_selectedColor: ColorPickerOptions['selectedColor'];
	_selectionCallback: ColorPickerOptions['selectionCallback'];
	_container: ReturnType<ColorPicker['_createControl']>;

	_initialized: boolean;

	_basicColorSelectionMark: HTMLElement;

	constructor(
		selectedColorSample: HTMLElement | undefined,
		options: ColorPickerOptions,
	) {
		this.options = Object.assign(
			{
				selectedColor: '#ff0000',
				noColorControl: true,
				autoColorControl: false,
				selectionCallback: (_: string) => {
					/* no-op */
				},
			},
			options,
		);

		if (this.options.noColorControl && this.options.autoColorControl) {
			this.options.autoColorControl = false;
			window.app.console.warn(
				'ColorPicker: requested both no color and auto color control',
			);
		}

		this._selectedBasicColorIndex = 0;
		this._selectedTintIndex = 0;

		const pickerID = ColorPicker.ID++;

		this._basicColorSampleIdTag =
			ColorPicker.ID_TAG + pickerID + '-basic-color-';
		this._tintSampleIdTag = ColorPicker.ID_TAG + pickerID + '-tint-';
		this._noColorControlId = ColorPicker.ID_TAG + pickerID + '-no-color';
		this._autoColorControlId = ColorPicker.ID_TAG + pickerID + '-auto-color';
		this._basicTabId = ColorPicker.ID_TAG + pickerID + '-tab-basic';
		this._customTabId = ColorPicker.ID_TAG + pickerID + '-tab-custom';
		this._basicPageId = ColorPicker.ID_TAG + pickerID + '-page-basic';
		this._customPageId = ColorPicker.ID_TAG + pickerID + '-page-custom';
		this._customListId = ColorPicker.ID_TAG + pickerID + '-custom-list';
		this._createBasicColorSelectionMark();
		this._selectedColorElement = selectedColorSample;
		this._selectedColor = this.options.selectedColor;
		this._selectionCallback = this.options.selectionCallback;
		this._initIndexes();
		this._container = this._createControl();
		this._initialized = true;
	}

	getContainer() {
		return this._container;
	}

	onShow = () => {
		if (!this._initialized || this._selectedColor === '#') return;
		this._initIndexes();
		this._updateTintsView();
	};

	_initIndexes() {
		for (var i = 0; i < this._getBasicColorCount(); ++i) {
			var tintSet = this._getTintSet(i);
			if (!tintSet) return;
			for (var j = 0; j < tintSet.length; ++j) {
				var tint = tintSet[j];
				if (tint === this._selectedColor) {
					this._selectedBasicColorIndex = i;
					this._selectedTintIndex = j;
					return;
				}
			}
		}
	}

	/*
	 * ONE sheet, two tiers, no sub-screen.
	 *
	 *   tabs            Basic | Custom
	 *   pseudo row      "No color" / "Automatic color" — shared by both tabs,
	 *                   which is why it sits above them rather than inside
	 *                   each page: one row, one handler, identical to the
	 *                   reference's own reading order.
	 *   basic page      the family band, then the shade grid it controls
	 *   custom page     a LIST of colours already used, or an empty message
	 *
	 * The shade grid swaps IN PLACE under the band. There is no second window
	 * and no back affordance of our own, so the sheet's one back layer — the
	 * wizard titlebar's, hardware Back, or a tap outside — closes the whole
	 * picker in one press from anywhere inside it.
	 */
	_createControl() {
		var children = [];
		children.push(this._createTabRow());
		if (this.options.noColorControl || this.options.autoColorControl)
			children.push(this._createPseudoColorControl());
		children.push({
			type: 'divcontainer',
			id: this._basicPageId,
			style: 'colors-container-page',
			children: [this._createBasicColorSamples(), this._createTintSamples()],
		});
		children.push(this._createCustomPage());
		return {
			type: 'divcontainer',
			style: 'colors-container',
			children: children,
		};
	}

	_createTabRow() {
		var tab = (id: string, label: string, selected: boolean) => ({
			type: 'divcontainer',
			id: id,
			style:
				'colors-container-tab' + (selected ? ' colors-container-tab-selected' : ''),
			handlers: [
				{
					event: 'click',
					handler: window.L.bind(this.onClickTab, this),
				},
			],
			children: [
				{
					type: 'fixedtext',
					style: 'colors-container-tab-label',
					text: label,
				},
			],
		});
		return {
			type: 'divcontainer',
			style: 'colors-container-tabs',
			children: [
				tab(this._basicTabId, _('Basic'), true),
				tab(this._customTabId, _('Custom'), false),
			],
		};
	}

	/*
	 * The Custom tab is a LIST, not a creator: no hex field, no spectrum, no
	 * eyedropper, no add affordance — the same shape the reference ships.
	 *
	 * What differs is where the list comes from. The reference's is populated
	 * on some other surface and is simply empty on a phone-only account, so
	 * its tab can never fill. Ours reads the colours this user has already
	 * applied (`recentColor`, the store the desktop picker has always kept),
	 * and every selection here writes to that same store — so the tab earns
	 * its place instead of being a permanently empty half of a tab bar.
	 */
	_createCustomPage() {
		return {
			type: 'divcontainer',
			id: this._customPageId,
			style: 'colors-container-page colors-container-page-hidden',
			children: [
				{
					type: 'divcontainer',
					id: this._customListId,
					style: 'colors-container-custom-list',
					children: [
						{
							type: 'fixedtext',
							style: 'colors-container-empty-message',
							text: _('No custom colors'),
						},
					],
				},
			],
		};
	}

	onClickTab(e: ColorEvent) {
		if (e.id !== this._basicTabId && e.id !== this._customTabId) return;
		this._showTab(e.id === this._customTabId);
	}

	_showTab(custom: boolean) {
		var pairs: [string, boolean][] = [
			[this._basicTabId, !custom],
			[this._customTabId, custom],
		];
		for (const [id, on] of pairs) {
			const tab = window.L.DomUtil.get(id);
			if (!tab) continue;
			if (on)
				window.L.DomUtil.addClass(tab, 'colors-container-tab-selected');
			else
				window.L.DomUtil.removeClass(tab, 'colors-container-tab-selected');
		}
		var pages: [string, boolean][] = [
			[this._basicPageId, custom],
			[this._customPageId, !custom],
		];
		for (const [id, hidden] of pages) {
			const page = window.L.DomUtil.get(id);
			if (!page) continue;
			// A class, never an inline `display` — the editor iframe's CSP is
			// `style-src 'self'` and drops style ATTRIBUTES at runtime.
			if (hidden)
				window.L.DomUtil.addClass(page, 'colors-container-page-hidden');
			else
				window.L.DomUtil.removeClass(page, 'colors-container-page-hidden');
		}
		if (custom) this._renderCustomList();
	}

	/** Colours this user has already applied, most recent first. */
	_readRecentColors(): string[] {
		const prefs = (window as any).prefs;
		if (!prefs || typeof prefs.get !== 'function') return [];
		let raw;
		try {
			raw = JSON.parse(prefs.get('recentColor'));
		} catch (_e) {
			return [];
		}
		if (!Array.isArray(raw)) return [];
		const out: string[] = [];
		for (const entry of raw) {
			if (typeof entry !== 'string') continue;
			const digits = entry.replace(/^#/, '').toLowerCase();
			if (!/^[0-9a-f]{6}$/.test(digits)) continue;
			if (out.indexOf('#' + digits) === -1) out.push('#' + digits);
		}
		return out;
	}

	_writeRecentColor(colorCode: string) {
		const prefs = (window as any).prefs;
		if (!prefs || typeof prefs.set !== 'function') return;
		const digits = colorCode.replace(/^#/, '').toUpperCase();
		if (!/^[0-9A-F]{6}$/.test(digits)) return;
		const kept = this._readRecentColors()
			.map((c) => c.substring(1).toUpperCase())
			.filter((c) => c !== digits);
		kept.unshift(digits);
		prefs.set('recentColor', JSON.stringify(kept.slice(0, 8)));
	}

	_renderCustomList() {
		const list = window.L.DomUtil.get(this._customListId);
		if (!list) return;
		list.replaceChildren();
		const colors = this._readRecentColors();
		if (!colors.length) {
			const empty = window.L.DomUtil.create(
				'div',
				'colors-container-empty-message',
				list,
			);
			empty.textContent = _('No custom colors');
			return;
		}
		for (const color of colors) {
			const row = window.L.DomUtil.create(
				'div',
				'colors-container-custom-row',
				list,
			);
			row.setAttribute('role', 'button');
			row.setAttribute('tabindex', '0');
			const chip = window.L.DomUtil.create(
				'div',
				'colors-container-custom-chip',
				row,
			);
			// CSSOM property writes survive the CSP; style attributes do not.
			chip.style.backgroundColor = color;
			ColorPicker.paintSwatchDerivedColors(chip, color);
			const label = window.L.DomUtil.create(
				'div',
				'colors-container-custom-label',
				row,
			);
			label.textContent = color.toUpperCase();
			row.onclick = () => {
				this._selectedColor = color;
				this._initIndexes();
				this._updateSelectedColorElement();
				this._selectionCallback(color.substring(1));
				this._writeRecentColor(color);
			};
		}
	}

	/**
	 * The two colours a swatch derives from itself, published as custom
	 * properties for the stylesheet to consume.
	 *
	 * `--vulcan-swatch-edge` is the swatch's own colour at 92% brightness. It
	 * replaces the 2px grey border every swatch used to carry: an outline is
	 * one more hard stroke on a surface whose whole character is that nothing
	 * is outlined, and it is also the reason a white swatch needed one at all.
	 * A self-coloured inner edge keeps `#ffffff` legible on a near-white sheet
	 * while being invisible as a stroke on all 87 others.
	 *
	 * `--vulcan-swatch-badge` is the swatch mixed 80% toward white — the
	 * check disc's fill. Deriving it from the swatch rather than the theme is
	 * what keeps a black check readable on top of `#000000` and `#ffffff`
	 * alike; both are FIXED in the reference and neither moves with the
	 * device palette.
	 */
	static paintSwatchDerivedColors(element: HTMLElement, color: string) {
		const rgb = ColorPicker.parseHex(color);
		if (!rgb) return;
		const edge = rgb.map((c) => Math.round(c * 0.92));
		const badge = rgb.map((c) => Math.round(c + (255 - c) * 0.8));
		element.style.setProperty(
			'--vulcan-swatch-edge',
			'rgb(' + edge.join(', ') + ')',
		);
		element.style.setProperty(
			'--vulcan-swatch-badge',
			'rgb(' + badge.join(', ') + ')',
		);
	}

	static parseHex(color: string): number[] | null {
		const m = /^#?([0-9a-f]{6})$/i.exec(String(color).trim());
		if (!m) return null;
		const n = parseInt(m[1], 16);
		return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
	}

	_createPseudoColorControl() {
		var noColorControl = this.options.noColorControl;
		var icon = {
			type: 'fixedtext',
			text: '',
			style: noColorControl
				? 'no-color-control-icon'
				: 'auto-color-control-icon',
		};
		var label = noColorControl
			? {
					type: 'fixedtext',
					style: 'no-color-control-label',
					text: _('No color'),
				}
			: {
					type: 'fixedtext',
					style: 'auto-color-control-label',
					text: _('Automatic color'),
				};
		var description = { type: 'divcontainer', children: [icon, label] };
		var checked = noColorControl
			? {
					type: 'fixedtext',
					id: this._noColorControlId,
					style: 'no-color-control-mark',
					text: '',
				}
			: {
					type: 'fixedtext',
					id: this._autoColorControlId,
					style: 'auto-color-control-mark',
					text: '',
				};
		var container = {
			type: 'divcontainer',
			style: noColorControl
				? 'colors-container-no-color-row'
				: 'colors-container-auto-color-row',
			handlers: [
				{
					event: 'click',
					handler: window.L.bind(this.onClickPseudoColor, this),
				},
			],
			children: [description, checked],
		};
		return container;
	}

	_createBasicColorSamples() {
		var colorEntries = [];
		for (var k = 0; k < this._getBasicColorCount(); ++k) {
			var selected = k === this._selectedBasicColorIndex;
			var entry: {
				type: 'colorsample';
				id: string;
				selected: boolean;
				color: string;
				size: 'small';
				handlers: [{ event: 'click'; handler: (event: ColorEvent) => void }];
				mark?: HTMLElement;
			} = {
				type: 'colorsample',
				id: this._basicColorSampleIdTag + k,
				selected: selected,
				color: this._getBasicColor(k),
				size: 'small',
				handlers: [
					{
						event: 'click',
						handler: window.L.bind(this.onClickBasicColorSample, this),
					},
				],
			};
			if (selected) {
				entry.mark = this._basicColorSelectionMark;
			}
			colorEntries.push(entry);
		}
		return {
			type: 'divcontainer',
			style: 'colors-container-basic-colors-row',
			children: colorEntries,
		};
	}

	_createTintSamples() {
		var tints = this._getTintSet(this._selectedBasicColorIndex);
		var k,
			selected,
			entry,
			tintRowLength = tints.length / 2;

		// first tints row
		var tintsEntries1 = [];
		for (k = 0; k < tintRowLength; ++k) {
			selected = tints[k] === this._selectedColor;
			entry = {
				type: 'colorsample',
				id: this._tintSampleIdTag + k,
				selected: selected,
				color: tints[k],
				size: 'big',
				handlers: [
					{
						event: 'click',
						handler: window.L.bind(this.onClickTintSample, this),
					},
				],
			};
			tintsEntries1.push(entry);
		}
		var tintsRow1 = {
			type: 'divcontainer',
			style: 'colors-container-tints',
			children: tintsEntries1,
		};

		// second tints row
		var tintsEntries2 = [];
		for (k = tintRowLength; k < tints.length; ++k) {
			selected = tints[k] === this._selectedColor;
			entry = {
				type: 'colorsample',
				id: this._tintSampleIdTag + k,
				selected: selected,
				color: tints[k],
				size: 'big',
				handlers: [
					{
						event: 'click',
						handler: window.L.bind(this.onClickTintSample, this),
					},
				],
			};
			tintsEntries2.push(entry);
		}
		var tintsRow2 = {
			type: 'divcontainer',
			style: 'colors-container-tints',
			children: tintsEntries2,
		};

		return { type: 'divcontainer', children: [tintsRow1, tintsRow2] };
	}

	_createBasicColorSelectionMark() {
		this._basicColorSelectionMark = window.L.DomUtil.create(
			'div',
			'colors-container-basic-color-mark',
			null,
		);
	}

	_getBasicColorCount() {
		return ColorPicker.BASIC_COLORS.length;
	}

	_getBasicColor(
		index: number,
	): (typeof ColorPicker.BASIC_COLORS)[number] | '' {
		if (!(index >= 0 && index < ColorPicker.BASIC_COLORS.length)) {
			return '';
		}
		return ColorPicker.BASIC_COLORS[index];
	}

	_getTintSet(basicColorIndex: number) {
		const basicColor = this._getBasicColor(basicColorIndex);

		if (basicColor === '') return [] as const;

		return ColorPicker.TINTS[basicColor];
	}

	_extractBasicColorIndex(sampleId: string) {
		if (!sampleId.startsWith(this._basicColorSampleIdTag)) return -1;
		var index = parseInt(
			sampleId.substring(this._basicColorSampleIdTag.length),
		);
		if (index < 0 || index >= this._getBasicColorCount()) return -1;
		return index;
	}

	_extractTintIndex(sampleId: string) {
		if (!sampleId.startsWith(this._tintSampleIdTag)) return -1;
		var index = parseInt(sampleId.substring(this._tintSampleIdTag.length));
		if (
			index < 0 ||
			index >= this._getTintSet(this._selectedBasicColorIndex).length
		)
			return -1;
		return index;
	}

	_getColorCode(colorIndex: number, colorType: ColorTypes): string {
		var sampleElem = this._getSampleElement(colorIndex, colorType);
		return sampleElem.name;
	}

	onClickPseudoColor() {
		this._selectedColor = '#';
		this._unselectSample(this._selectedTintIndex, 'TINT');
		this._updatePseudoColorControl(true);
		// transparent is fine for both no color and automatic color
		this._selectionCallback('transparent');
	}

	/**
	 * Where a family's OWN colour sits inside its shade set — the cell the
	 * family chip is a picture of.
	 *
	 * It is 3 for the ten chromatic families and 0 for grey, and hard-coding
	 * the 3 was safe only while grey's set was eight synthetic values with a
	 * mid-grey in slot 3. Against the measured ten-shade grey ramp that
	 * constant applies `#999999` for a tap on a chip painted `#000000` — a
	 * control that applies a colour it is not showing. Searching for the
	 * family colour cannot drift: whatever the sets become, the tap applies
	 * the swatch the user pressed.
	 */
	_baseTintIndex(basicColorIndex: number): number {
		const basicColor = this._getBasicColor(basicColorIndex);
		const tintSet = this._getTintSet(basicColorIndex);
		for (var i = 0; i < tintSet.length; ++i) {
			if (tintSet[i] === basicColor) return i;
		}
		return 0;
	}

	/*
	 * A family tap is BOTH halves of this widget at once: it swaps the shade
	 * grid below the band AND applies that family's own colour, live, with
	 * the sheet still up. That is the whole reason the band is worth 30px of
	 * a bottom sheet — the common case is one tap, and the grid underneath is
	 * refinement rather than a required second step. Measured five times on
	 * the reference across four families and both pickers.
	 */
	onClickBasicColorSample(e: ColorEvent) {
		var basicColorIndex = this._extractBasicColorIndex(e.id);
		if (basicColorIndex < 0) return;
		this._selectedBasicColorIndex = this._updateSelectedSample(
			basicColorIndex,
			this._selectedBasicColorIndex,
			'BASIC_COLOR',
		);
		this._updateTintsView();
		this._selectTintIndex(this._baseTintIndex(basicColorIndex));
	}

	onClickTintSample(e: ColorEvent) {
		var tintIndex = this._extractTintIndex(e.id);
		if (tintIndex < 0) return;
		this._selectTintIndex(tintIndex);
	}

	_selectTintIndex(tintIndex: number) {
		this._selectedTintIndex = this._updateSelectedSample(
			tintIndex,
			this._selectedTintIndex,
			'TINT',
		);
		this._selectedColor =
			'#' + this._getColorCode(this._selectedTintIndex, 'TINT');
		this._updatePseudoColorControl(false);
		this._updateSelectedColorElement();
		/*
		 * Write through immediately, and keep it. There is no OK, no Cancel
		 * and no Apply anywhere in this widget: every tap lands on the
		 * document at once and every route out of the sheet — Back, a tap
		 * outside — leaves the colour in place. Adding a confirm step here is
		 * the one change that would make the picker feel slower than the
		 * thing it is modelled on.
		 */
		this._selectionCallback(
			this._getColorCode(this._selectedTintIndex, 'TINT'),
		);
		this._writeRecentColor(this._selectedColor);
	}

	_updateSelectedSample(
		colorIndex: number,
		selectedColorIndex: number,
		colorType: ColorTypes,
	) {
		this._unselectSample(selectedColorIndex, colorType);
		this._selectSample(colorIndex, colorType);
		return colorIndex;
	}

	_unselectSample(colorIndex: number, colorType: ColorTypes) {
		var sampleElem = this._getSampleElement(colorIndex, colorType);
		if (sampleElem && sampleElem.firstChild) {
			if (colorType === 'BASIC_COLOR') {
				sampleElem.removeChild(sampleElem.firstChild);
				window.L.DomUtil.removeClass(
					sampleElem,
					'colors-container-selected-basic-color',
				);
			} else if (colorType === 'TINT') {
				const child: ChildNode & { style?: HTMLElement['style'] } =
					sampleElem.firstChild;

				if (!('style' in child)) {
					throw new Error(
						'Assertion failed: sampleElem.firstChild is not a HTMLElement',
					);
				}

				child.style.visibility = 'hidden';
			}
		}
	}

	_selectSample(colorIndex: number, colorType: ColorTypes) {
		var sampleElem = this._getSampleElement(colorIndex, colorType);
		if (sampleElem) {
			if (colorType === 'BASIC_COLOR') {
				sampleElem.appendChild(this._basicColorSelectionMark);
				window.L.DomUtil.addClass(
					sampleElem,
					'colors-container-selected-basic-color',
				);
			} else if (colorType === 'TINT' && sampleElem.firstChild) {
				const child: ChildNode & { style?: HTMLElement['style'] } =
					sampleElem.firstChild;

				if (!('style' in child)) {
					throw new Error(
						'Assertion failed: sampleElem.firstChild is not a HTMLElement',
					);
				}

				child.style.visibility = 'visible';
			}
		}
	}

	_updateTintsView() {
		var tintSet = this._getTintSet(this._selectedBasicColorIndex);
		if (!tintSet) return;
		for (var i = 0; i < tintSet.length; ++i) {
			var tint = tintSet[i];
			var sampleElem = this._getSampleElement(i, 'TINT');
			if (sampleElem) {
				sampleElem.style.backgroundColor = tint;
				sampleElem.name = tint.substring(1);
				// The edge and badge are DERIVED from the fill, so they have
				// to be re-derived wherever the fill is rewritten. Repainting
				// the background alone leaves the previous family's edge on
				// the new colour -- a stale hairline that reads as a border,
				// which is the one thing this swatch is built not to have.
				ColorPicker.paintSwatchDerivedColors(sampleElem, tint);
				if (sampleElem.firstChild) {
					const child: ChildNode & { style?: HTMLElement['style'] } =
						sampleElem.firstChild;

					if (!('style' in child)) {
						throw new Error(
							'Assertion failed: sampleElem.firstChild is not a HTMLElement',
						);
					}

					if (tint === this._selectedColor) {
						child.style.visibility = 'visible';
					} else {
						child.style.visibility = 'hidden';
					}
				}
			}
		}
	}

	_updatePseudoColorControl(checked: boolean) {
		if (this.options.noColorControl) this._updateNoColorControl(checked);
		else if (this.options.autoColorControl)
			this._updateAutoColorControl(checked);
	}

	_updateNoColorControl(checked: boolean) {
		var noColorElem = window.L.DomUtil.get(this._noColorControlId);
		if (noColorElem) {
			if (noColorElem.checked !== checked) {
				noColorElem.checked = checked;
				if (this._selectedColorElement) {
					if (checked) {
						// Masked sprite check (vulcan-theme.css §15), not a text dingbat.
						noColorElem.innerHTML = ColorPicker.CHECK_MARK_HTML;
						// update value for the related menu entry
						window.L.DomUtil.addClass(
							this._selectedColorElement,
							'no-color-selected',
						);
						this._selectedColorElement.innerHTML = '\\';
					} else {
						noColorElem.replaceChildren();
						// update value for the related menu entry
						window.L.DomUtil.removeClass(
							this._selectedColorElement,
							'no-color-selected',
						);
						this._selectedColorElement.replaceChildren();
					}
				}
			}
		}
	}

	_updateAutoColorControl(checked: boolean) {
		var autoColorElem: HTMLInputElement = window.L.DomUtil.get(
			this._autoColorControlId,
		);
		if (autoColorElem) {
			if (autoColorElem.checked !== checked) {
				autoColorElem.checked = checked;
				if (this._selectedColorElement) {
					if (checked) {
						autoColorElem.innerHTML = ColorPicker.CHECK_MARK_HTML;
						// update value for the related menu entry
						window.L.DomUtil.addClass(
							this._selectedColorElement,
							'auto-color-selected',
						);
						this._selectedColorElement.innerHTML = '\\';
					} else {
						autoColorElem.replaceChildren();
						// update value for the related menu entry
						window.L.DomUtil.removeClass(
							this._selectedColorElement,
							'auto-color-selected',
						);
						this._selectedColorElement.replaceChildren();
					}
				}
			}
		}
	}

	_getSampleElement(index: number, type: ColorTypes): HTMLFormElement {
		var sampleId;
		if (type === 'BASIC_COLOR') {
			sampleId = this._basicColorSampleIdTag + index;
		} else if (type === 'TINT') {
			sampleId = this._tintSampleIdTag + index;
		}
		return window.L.DomUtil.get(sampleId);
	}

	_updateSelectedColorElement() {
		if (this._selectedColorElement) {
			this._selectedColorElement.style.backgroundColor = this._selectedColor;
		}
	}
}
