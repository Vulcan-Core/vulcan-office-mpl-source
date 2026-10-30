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
 * Control.Header
 *
 * Abstract class, basis for ColumnHeader and RowHeader controls.
 * Used only in spreadsheets, implements the row/column headers.
 */
/* global $ L app */

declare var JSDialog: any;
declare var _UNO: any;

namespace cool {

export interface SelectionRange {
	start: number,
	end: number,
}

/*
 * The Vulcan phone chrome, as a free function: a small-screen device AND the
 * pre-paint html.vulcan-mobile-chrome marker global.js stamps iff
 * !desktopChrome && mode.isSmallScreenDevice(). Desktop and tablet fail BOTH
 * halves.
 *
 * It exists as a free function because HeaderInfo below is a separate class
 * with no section of its own and therefore no access to Header's protected
 * _isVulcanPhoneHeader. The two are deliberately NOT collapsed into one: the
 * fork-gate registry pins _isVulcanPhoneHeader's own text as a both-halves
 * site, and a body that delegates to this function carries no class literal
 * for the scanner to re-derive the shape from. Duplicated expression, one
 * meaning -- change either and change both.
 */
export function isVulcanPhoneChrome(): boolean {
	return !!(window as any).mode.isSmallScreenDevice()
		&& document.documentElement.classList.contains('vulcan-mobile-chrome');
}

export class Header extends CanvasSectionObject {
	_map: any;
	_textColor: string;
	_backgroundColor: string;
	_borderColor: string;
	_borderWidth: number;
	_cursor: string;
	_hoverColor: string;
	_selectionTextColor: string;
	_selectionBackgroundGradient: string[];
	_resizeCursor: string;
	_lastMouseOverIndex: number;
	_menuData: any;
	_headerInfo: HeaderInfo;
	_dragEntry: HeaderEntryData;
	_mouseOverEntry: HeaderEntryData;
	_prevMouseOverEntry: HeaderEntryData;
	_startSelectionEntry: HeaderEntryData;
	_lastSelectedIndex: number;
	_hitResizeArea: boolean;
	_menuItem: any;
	_headerMenuID: string;
	_menuPosEl: HTMLElement;
	_dragDistance: number[];
	_isColumn: boolean;
	cursor: string;
	resizeHandleSize: number;
	borderResizeHandle = 3;

	// Vulcan phone ergonomics (docs/mobile-redesign/02 §5): on phones the
	// resize band is a LANDING ZONE, not a trigger. A press that starts inside
	// it only becomes a resize once the finger has travelled this far along the
	// resize axis; below that the gesture is still a tap and selects the whole
	// row/column. Expressed in CSS px -- dragDistance arrives in CORE pixels,
	// so scale by app.dpiScale before comparing.
	//
	// 24 is the MEASURED reference threshold, not a guess: the Android app was
	// swept and bracketed to >20px and <=30px (6px/12px/20px do nothing, 30px
	// resizes) -- SHEETS-MODEL §3 "Engagement threshold". 12 was ours, and it
	// is trigger-happy by comparison: a 20px wobble that the reference reads as
	// a tap was a resize here.
	//
	// 🔴 THE THRESHOLD IS NOT SUBTRACTED FROM THE RESULT, and the reference is
	// explicit about it: a 30px drag yields +27px, not +6px. Row/ColumnHeader
	// onDragEnd add the WHOLE dragDistance, which is already right -- pinned by
	// CalcPhoneRowResizeRetry D5 so nobody "corrects" it into the remainder.
	vulcanResizeArmDistance: number = 24;
	_resizeArmed: boolean = false;

	/*
	 * VO-P-0004. THIS gesture's tap has already been served by onMouseUp, so
	 * the browser's compatibility click must not serve it a second time.
	 *
	 * Set immediately before the selectIndex in onMouseUp's phone fallback and
	 * cleared in onMouseDown, so it is a property of ONE gesture: the press
	 * that opens the next gesture clears it, and a gesture whose click never
	 * arrives (the usual case -- the container swallows the click after a
	 * touchmove) leaves the field in exactly the state the following press
	 * expects. It is not a mode.
	 *
	 * Without it, lifting the early return below makes every still tap select
	 * TWICE: two .uno:SelectRow, two _onVulcanHeaderTap and therefore two pill
	 * raises, for one finger.
	 *
	 * It lives on Header rather than on the two subclasses because
	 * Row/ColumnHeader.onMouseUp clear _startSelectionEntry AFTER
	 * super.onMouseUp() has run -- by the time the click arrives the field the
	 * fallback used is gone, and the click reads _mouseOverEntry instead, so
	 * nothing else here can tell the two selections apart.
	 */
	protected _vulcanTapConsumed: boolean = false;

	// C2 / G26. The index of the header entry the last PHONE header tap
	// selected, or -1. The resize grip is keyed off this instead of off the
	// cell cursor: `entry.isCurrent` means "this entry contains the cell
	// cursor", so a bare single-cell tap on G8 makes column G AND row 8
	// current and drew a grip in each -- EX-6, with no row or column selected
	// at all. A tap is a signal this section OWNS, so nothing here waits on a
	// core round trip and nothing flickers while one is in flight.
	protected _vulcanGripIndex: number = -1;

	// S6. The armed entry a straddling press is resizing, when the finger
	// landed just PAST that entry's boundary and is therefore physically
	// inside the next one. Written by _entryAtPoint on every query (including
	// the null that clears it) and read once, by onMouseDown, to aim
	// _dragEntry. Never used for selection -- see the _entryAtPoint note.
	protected _vulcanStraddleEntry: HeaderEntryData = null;

	// ROUND 16, VO-P-0005 second ask. The CANVAS point of a press that landed
	// in the disc's sliver -- strictly past this header's inner edge, so
	// inside the grid -- or null for a press inside the header's own
	// rectangle and for every press off the phone chrome. Written by
	// onMouseDown on every press; read once, by onMouseUp's phone fallback,
	// to decide whose tap an UNARMED release is (see _vulcanForwardSliverTap).
	protected _vulcanSliverPress: number[] = null;

	// ROUND 16 WAVE E, M-0020 §3 R3(d)/(e), §4 R4(d)/(e). Whether this
	// gesture's press landed within the resize disc's own painted radius --
	// either half of it. Written by onMouseDown on every press (false off
	// the phone chrome and whenever no disc is painted); read by onMouseUp's
	// phone fallback, where it makes an UNARMED release inert, and by
	// onContextMenu, where it withholds the long-press menu. The disc is
	// drag-only: see the block above vulcanDiscSliverCSS.
	protected _vulcanDiscPress: boolean = false;

	// D3. `sizeCSS` overrides the zoom ladder for ONE label -- the fitted size
	// _vulcanLabelFont computes below. Called with no argument (every shipped
	// caller) it is the expression that shipped, byte for byte.
	getFont: (sizeCSS?: number) => string;

	getHeaderInfo(): HeaderInfo {
		return this._headerInfo;
	}

	// Phone header metrics (docs/mobile-redesign/02 §5; round-8 GAP 2).
	// 19px is a mouse-era target. The phone band was 48px -- the finger floor
	// the rest of the phone chrome holds -- but that floor does not belong on
	// THIS band: the tap target for "select this column" is the header CELL,
	// which is as wide as the column, so the target AREA stays a column-wide
	// rectangle however short the band is, and resize is a drag on the cell's
	// edge rather than a press inside a fat band. Google Sheets ships 14 CSS
	// px (measured off EX-8: L12 §6.1, V-EX); 26 keeps a comfortable label
	// and hands 22 px of a 844 px phone back to the grid. The lint carries
	// the matching floor -- HEADER_BAND_FLOOR in
	// scripts/phone-ergonomics-lint.mjs, which moved in this same change.
	//
	// MUST be applied to ColumnHeader AND CornerHeader together:
	// RowHeader anchors to CornerHeader's bottom while TilesSection anchors to
	// ColumnHeader's bottom, so any difference between the two offsets every
	// row label from its row by the delta. Returns CORE pixels, like the
	// literal it replaces.
	public static columnHeaderHeight(): number {
		const phone = !!(window as any).mode.isSmallScreenDevice()
			&& document.documentElement.classList.contains('vulcan-mobile-chrome');
		return (phone ? 26 : 19) * app.dpiScale;
	}

	// The other axis of the same band (round-8 GAP 2). Stock is a static 48px
	// gutter on every device; Google's is ~27 CSS px (L12 §6.1, V-EX). 32 is
	// the ruled compromise. 🔴 JUDGMENT: 32px holds a FOUR-digit row label at
	// the 12px phone header font (_getFontSize), derived from the font size in
	// this file and NOT measured on a device -- a five-digit row number will
	// crowd it, and canvas sections are not clipped, so it would bleed a few
	// px rather than truncate. Revisit with a device frame on a >9,999-row
	// sheet before calling the number final.
	//
	// MUST be applied to RowHeader AND CornerHeader together, for the same
	// reason as the height above, transposed: TilesSection anchors its LEFT to
	// RowHeader's right while ColumnHeader anchors its LEFT to CornerHeader's
	// right, so any difference between the two offsets every column label from
	// its column by the delta. Returns CORE pixels, like the literal it
	// replaces.
	public static rowHeaderWidth(): number {
		const phone = !!(window as any).mode.isSmallScreenDevice()
			&& document.documentElement.classList.contains('vulcan-mobile-chrome');
		return (phone ? 32 : 48) * app.dpiScale;
	}

	constructor (name: string) {
		super(name);
	}

	onInitialize(): void {
		this._selectionBackgroundGradient = [ '#3465A4', '#729FCF', '#004586' ];

		this._map.on('move zoomchanged sheetgeometrychanged splitposchanged', this._updateCanvas, this);
		this._map.on('darkmodechanged', this._reInitRowColumnHeaderStylesAfterModeChange, this);
		this._map.on('statusupdated', this._handleStatusUpdated, this);

		this._reInitRowColumnHeaderStylesAfterModeChange();
	}

	_handleStatusUpdated(): void {
		this._reInitRowColumnHeaderStylesAfterModeChange();
	}

	isMouseOverResizeArea(start: number, end:number, position: number, entryIsCurrent: boolean, entry?: HeaderEntryData): boolean {return false;}

	_initHeaderEntryStyles (className: string): void {
		const baseElem = document.getElementsByTagName('body')[0];
		const elem = window.L.DomUtil.create('div', className, baseElem);
		this._textColor = window.L.DomUtil.getStyle(elem, 'color');
		this._backgroundColor = window.L.DomUtil.getStyle(elem, 'background-color');
		const fontFamily = window.L.DomUtil.getStyle(elem, 'font-family');
		this.getFont = function(sizeCSS?: number) {
			const selectedSize = sizeCSS === undefined
				? this._getFontSize()
				: Math.max(1, Math.round(sizeCSS * app.dpiScale));
			return selectedSize + 'px ' + fontFamily;
		}.bind(this);
		this._borderColor = window.L.DomUtil.getStyle(elem, 'border-top-color');
		const borderWidth = window.L.DomUtil.getStyle(elem, 'border-top-width');
		this._borderWidth = Math.round(parseFloat(borderWidth));
		this._cursor = window.L.DomUtil.getStyle(elem, 'cursor');
		window.L.DomUtil.remove(elem);
	}

	_getFontSize(): number {
		const map = this._map;
		const zoomScale = map.getZoomScale(map.getZoom(), map.options.defaultZoom);
		if (zoomScale < 0.68)
			return Math.round(8 * app.dpiScale);
		else if (zoomScale < 0.8)
			return Math.round(10 * app.dpiScale);
		else
			return Math.round(12 * app.dpiScale);
	}

	/*
	 * ==================================================================
	 * D3 (round 12) -- THE LABEL IS FITTED TO THE ENTRY, NOT TO THE ZOOM.
	 *
	 * "In VO the numbers now slightly overlap which looks *really* bad",
	 * against a reference that "does an excellent job of compressing row and
	 * column #s so they are always legible".
	 *
	 * There was no overlap avoidance here of ANY kind, and that half is
	 * upstream's: every entry painted its whole label centred, and the only
	 * adaptivity was _getFontSize() above -- three rungs keyed on the ZOOM
	 * SCALE ALONE, which has never seen the entry whose label it is sizing.
	 * A 60 CSS px row and a 6 CSS px row got the same digits. That survives
	 * on the desk because a mouse-era sheet never gets that tight.
	 *
	 * WHAT IS OURS IS THE EXPOSURE, and it is two of our own numbers. Round 8
	 * took the row gutter from 48 CSS px to 32 (rowHeaderWidth above), and
	 * round 10 dropped the phone Calc pinch floor to rung 5. MEASURED on the
	 * round-11 vehicle: at rung 5 consecutive row numbers are 1.2-2.2 CSS px
	 * apart, at rung 4 they are less than zero apart, and a five-digit row
	 * number paints straight through the gutter's border into column A --
	 * canvas sections are not clipped, and the comment on rowHeaderWidth
	 * predicted exactly that.
	 *
	 * THE RULE, and it is one rule: compress the label until it fits the
	 * entry; never past the point where a digit stops being a digit; and when
	 * even that floor does not fit, keep the floor and paint FEWER labels.
	 * Shrinking comes first because it keeps every number. Thinning is what
	 * the floor buys: one legible 500 every fifth row beats five illegible
	 * ones, and both beat mush. Clipping is deliberately NOT the answer --
	 * it would eat digits off a row number, which is worse than dropping the
	 * label on purpose.
	 *
	 * THE TWO BOXES ARE NOT THE SAME BOX, which is why one function serves
	 * both axes. One dimension of the glyph runs ALONG the header axis, where
	 * its neighbour is the NEXT label -- a row's digits stack vertically down
	 * the gutter, a column's letters run horizontally across the band -- and
	 * a stride multiplies that room. The other runs ACROSS the band, whose
	 * size is fixed by rowHeaderWidth/columnHeaderHeight: no stride ever buys
	 * a wider gutter, so a label that cannot fit ACROSS is dropped, not
	 * thinned.
	 * ==================================================================
	 */

	/** Clear space between a label and its neighbour's, along the axis. The
	 * vehicle graded 1.2-2.2 CSS px "touching" and 3.7 "tight, legible"; 3 is
	 * inside that bracket, on the legible side. */
	public static readonly vulcanLabelGapCSS: number = 3;

	/** Clear space a label keeps from each edge of its own band -- the margin
	 * the five-digit row number did not have when it bled into column A. */
	public static readonly vulcanLabelPadCSS: number = 2;

	/** The smallest label this fork will paint. The zoom ladder's own bottom
	 * rung is 8 CSS px, so 6 is one deliberate step below what the fork
	 * already ships as readable; below it a digit's ink is under 9 device px
	 * tall at dpiScale 2 and stops being a digit. Not a taste number -- it is
	 * the point where thinning takes over from shrinking. */
	public static readonly vulcanLabelFloorCSS: number = 6;

	/** The strides a thinned axis may use. Every 7th or 13th row reads as
	 * noise; these are the counts a person reads off an axis. */
	private static readonly vulcanLabelStrides: number[] = [2, 5, 10, 25, 50, 100];

	/** Ink height of a digit as a fraction of the font size, for the browsers
	 * whose TextMetrics has no actualBoundingBox. MEASURED on the vehicle at
	 * two different rungs (11.7/16 and 17.5/24 device px) -- both 0.73. */
	public static readonly vulcanLabelHeightEm: number = 0.73;

	/**
	 * D3. The size this label gets, and how many of its neighbours must be
	 * dropped for it to have that size. `fontCSS` 0 means "paint nothing";
	 * `stride` n means "paint only where (index + 1) % n === 0", which is
	 * index-keyed and therefore stable while the sheet is panned.
	 *
	 * Pure and static so the ruling can be driven with numbers rather than
	 * inferred from a canvas.
	 */
	public static vulcanFitLabel(
		ladderCSS: number,
		pitchCSS: number,
		bandCSS: number,
		widthEm: number,
		heightEm: number,
		isColumn: boolean,
	): { fontCSS: number, stride: number } {
		const alongEm = isColumn ? widthEm : heightEm;
		const acrossEm = isColumn ? heightEm : widthEm;

		// The band's own ceiling. No stride widens a gutter, so this bound
		// stands whatever the pitch does -- and it is the bound that decides
		// whether thinning can help at all.
		const ceiling = Math.min(
			ladderCSS,
			(bandCSS - 2 * Header.vulcanLabelPadCSS) / acrossEm);
		const fitAt = function (pitch: number): number {
			return Math.min(ceiling, (pitch - Header.vulcanLabelGapCSS) / alongEm);
		};

		const size = Math.floor(fitAt(pitchCSS));
		if (size >= Header.vulcanLabelFloorCSS)
			return { fontCSS: size, stride: 1 };

		if (Math.floor(ceiling) < Header.vulcanLabelFloorCSS)
			return { fontCSS: 0, stride: 1 };

		// Below the floor the size STOPS falling and the stride starts
		// rising. Re-fitting upward into the room a stride buys would make
		// zooming further OUT paint bigger numbers, which is the jank this
		// whole change exists to remove.
		for (let i = 0; i < Header.vulcanLabelStrides.length; i++) {
			const stride = Header.vulcanLabelStrides[i];
			if (Math.floor(fitAt(stride * pitchCSS)) >= Header.vulcanLabelFloorCSS)
				return { fontCSS: Header.vulcanLabelFloorCSS, stride: stride };
		}
		return { fontCSS: 0, stride: 1 };
	}

	/**
	 * D3. The room this entry's label actually has along the header axis: the
	 * distance to the nearest neighbouring LABEL, not the entry's own extent.
	 *
	 * For a sheet of equal rows the two are the same number and this is inert.
	 * They diverge on the entry HeaderInfo.update clips to the viewport -- the
	 * first visible row, whose `size` is only the part on screen. Fitting that
	 * sliver would delete the top row's number on any scroll position that cut
	 * it, at every zoom, which is a new defect rather than a fixed one; its
	 * label is centred in the sliver and the next row's label is a full pitch
	 * below, so it has the room and upstream paints it. They also diverge on a
	 * hand-shrunk row between two ordinary ones, and the answer there is the
	 * same: what a label can collide with is another label.
	 *
	 * Zero-size (hidden) entries are skipped because drawHeaderEntry returns
	 * before painting one, so there is no label of theirs to clear.
	 */
	protected _vulcanLabelPitch(entry: HeaderEntryData): number {
		const info = this._headerInfo;
		if (!info || typeof info.getElementData !== 'function')
			return entry.size;
		let pitch = Infinity;
		for (const index of [info.getPreviousIndex(entry.index), info.getNextIndex(entry.index)]) {
			const neighbour = info.getElementData(index);
			if (neighbour && neighbour.size > 0)
				pitch = Math.min(pitch, (entry.size + neighbour.size) / 2);
		}
		return isFinite(pitch) ? pitch : entry.size;
	}

	/**
	 * D3. The font string for this entry's label, or null when the entry must
	 * not paint one at all.
	 *
	 * Off the phone chrome this is `this.getFont()` -- the shipped expression,
	 * byte for byte, on 95-96% of production use. The label is MEASURED rather
	 * than assumed: `widthEm` is what this exact string costs in this exact
	 * family, which is the whole point (a four-digit row and a five-digit row
	 * differ by a digit, and the gutter does not).
	 */
	protected _vulcanLabelFont(
		entry: HeaderEntryData,
		label: string,
		pitchCSS: number,
		bandCSS: number,
	): string | null {
		if (!this._isVulcanPhoneHeader())
			return this.getFont();

		const ctx: any = this.context;
		const probe = this._getFontSize();
		if (!ctx || typeof ctx.measureText !== 'function' || !(probe > 0))
			return this.getFont();

		ctx.font = this.getFont();
		const metrics: any = ctx.measureText(label);
		const widthEm = metrics ? metrics.width / probe : NaN;
		if (!(widthEm > 0) || !isFinite(widthEm))
			return this.getFont();
		const inkEm = metrics
			? (metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) / probe
			: NaN;
		const heightEm = inkEm > 0 && isFinite(inkEm)
			? inkEm
			: Header.vulcanLabelHeightEm;

		const fit = Header.vulcanFitLabel(
			probe / app.dpiScale, pitchCSS, bandCSS, widthEm, heightEm, this._isColumn);

		if (fit.fontCSS <= 0)
			return null;
		if (fit.stride > 1 && (entry.index + 1) % fit.stride !== 0)
			return null;
		return this.getFont(fit.fontCSS);
	}

	_initHeaderEntryHoverStyles (className: string): void {
		const baseElem = document.getElementsByTagName('body')[0];
		const elem = window.L.DomUtil.create('div', className, baseElem);
		this._hoverColor = window.L.DomUtil.getStyle(elem, 'background-color');
		window.L.DomUtil.remove(elem);
	}

	_initHeaderEntrySelectedStyles(className: string): void {
		const baseElem = document.getElementsByTagName('body')[0];
		const elem = window.L.DomUtil.create('div', className, baseElem);
		this._selectionTextColor = window.L.DomUtil.getStyle(elem, 'color');

		const selectionBackgroundGradient: string[] = [];
		let gradientColors: string = window.L.DomUtil.getStyle(elem, 'background-image');
		gradientColors = gradientColors.slice('linear-gradient('.length, -1);
		while (gradientColors) {
			const color = gradientColors.split(',', 3);
			const colorJoin = color.join(','); // color = 'rgb(r, g, b)'
			selectionBackgroundGradient.push(colorJoin);
			gradientColors = gradientColors.substr(color.length); // remove last parsed color
			gradientColors = gradientColors.substr(gradientColors.indexOf('r')); // remove ', ' stuff
		}

		if (selectionBackgroundGradient.length) {
			this._selectionBackgroundGradient = selectionBackgroundGradient;
		}
		window.L.DomUtil.remove(elem);
	}

	_initHeaderEntryResizeStyles (className: string): void {
		if (this.cursor) {
			this._resizeCursor = this.cursor;
		}
		else {
			const baseElem = document.getElementsByTagName('body')[0];
			const elem = window.L.DomUtil.create('div', className, baseElem);
			this._resizeCursor = window.L.DomUtil.getStyle(elem, 'cursor');
			window.L.DomUtil.remove(elem);
		}
	}

	_isRowColumnInSelectedRange (index: number): boolean {
		return (!!this._headerInfo.getElementData(index)?.isCurrent) || (!!this._headerInfo.getElementData(index)?.isHighlighted);
	}

	onContextMenu(point: cool.SimplePoint, evt: MouseEvent): void {
		if (!this._map.isEditMode())
			return;

		// M-0020 §3 R3(e) / §4 R4(e): a 700 ms long press ON the disc raises
		// nothing on the reference (delivery proven -- the same press with no
		// disc painted raises the context toolbar). The container routes a
		// phone long press here through propagateOnContextMenu with the press
		// point; a desktop right-click never satisfies the predicate
		// (_isVulcanPhoneHeader is its first term) and keeps the line below.
		if (this._vulcanPressOnDisc(point))
			return;

		this._showHeaderContextMenu(this._createMenuPositionElement(evt.clientX, evt.clientY));
	}

	openContextMenuForCurrentSelection(): void {
		if (!this._map.isEditMode())
			return;

		if (!app.calc.cellCursorVisible || !app.calc.cellAddress)
			return;

		const index = this._isColumn ? app.calc.cellAddress.x : app.calc.cellAddress.y;
		this._lastMouseOverIndex = index;

		const anchor = this._keyboardMenuAnchor(index);
		this._showHeaderContextMenu(this._createMenuPositionElement(anchor.x, anchor.y));
	}

	private _showHeaderContextMenu(posEl: HTMLElement): void {
		if ((window as any).mode.isSmallScreenDevice()) {
			(window as any).contextMenuWizard = true;
			const menuData = Object.assign({}, this._menuData);
			menuData.children = this._menuData.children.filter(
				(child: any) => this._isHeaderCommandUsable(child.command));
			this._map.fire('mobilewizard', {data: menuData});
		}
		else {
			const entries = this._getDropdownEntries();
			const callback = this._handleDropdownCallback.bind(this);
			JSDialog.OpenDropdown(
				this._headerMenuID,
				posEl,
				entries,
				callback,
				'',
				false,
				true,
				true,
			);
		}
	}

	// True only inside the Vulcan phone chrome: a small-screen device AND the
	// pre-paint html.vulcan-mobile-chrome marker (global.js adds it iff
	// !desktopChrome && mode.isSmallScreenDevice()). Desktop and tablet fail
	// BOTH halves -- isTablet() is *defined* as !isSmallScreenDevice() -- so
	// every phone-only branch below is unreachable for them.
	protected _isVulcanPhoneHeader(): boolean {
		return !!(window as any).mode.isSmallScreenDevice()
			&& document.documentElement.classList.contains('vulcan-mobile-chrome');
	}

	// Off the phone chrome a press in the resize band resizes immediately, as
	// upstream does -- this returns true unconditionally there, so desktop and
	// tablet keep byte-identical behaviour (substitute `true` into every caller
	// and you get the original expression back). On phones the finger must
	// first clear vulcanResizeArmDistance, armed in onMouseMove.
	protected _isResizeArmed(): boolean {
		if (!this._isVulcanPhoneHeader())
			return true;
		return this._resizeArmed;
	}

	/*
	 * C2 / G26 -- whether drawHeaderEntry paints the two resize bars, and
	 * (on a phone) where the resize badge and its grab band belong.
	 *
	 * Off phone chrome the answer is `entryIsCurrent`: substitute
	 * phone = false and the expression the two subclasses shipped comes back
	 * byte for byte, so desktop and tablet keep the upstream grip on the
	 * upstream trigger.
	 *
	 * ON PHONE, TWO TERMS -- VO-P-0005 / M-0012 §2 and §4:
	 *
	 *   - `entryIndex === anchorIndex`: this entry is the TRAILING edge of
	 *     the selection on this axis (_vulcanSelectionAnchorIndex).
	 *   - `wholeAxisSelected`: a whole row/column really is selected on this
	 *     axis. This is the CONFIRMED half and it is what disarms the grip:
	 *     CanvasTileLayer clears both flags the moment an ordinary cell
	 *     selection arrives (`_onCellSelectionAreaMsg`), so tapping a cell
	 *     inside the column you had selected takes the grip away, and
	 *     `_onRowColSelCount` re-states them from the core's own count.
	 *
	 * 🔴 ROUND 15 REPLACED TWO TERMS WITH THIS ONE, AND THE MEASUREMENT IS
	 * WHY. Round 8 keyed the grip on `entryIndex === tappedIndex &&
	 * entryIsCurrent` -- the entry THIS FINGER tapped, which still holds the
	 * cursor. M-0012 measures the reference gating it on the SELECTION
	 * instead: §2 "gated on selection: absent when only a cell in that column
	 * is selected", and §4 settles the harder half by watching a rule-drag
	 * extend B to B:C, at which point "the disc re-anchors to the new
	 * trailing edge" -- onto column C, which was never tapped and does not
	 * carry the cell cursor. Neither dropped term could ever have put a mark
	 * there, so both had to go and the anchor replaces them.
	 *
	 * WHAT STILL KEEPS EX-6 SHUT. `entryIsCurrent` was the term that stopped
	 * a bare cell tap lighting grips on BOTH axes, and it is gone from this
	 * expression -- but it was never the load-bearing one. A bare cell
	 * selection clears `wholeColumnSelected` AND `wholeRowSelected`, so the
	 * second term alone disarms both axes; and the anchor is derived from
	 * the same selection, so on the cross axis there is nothing to anchor to
	 * either. The EX-6 rows in CalcPhoneHeaderBandGrip and group A2 of
	 * CalcPhoneResizeAffordance both drive that state and stay green.
	 */
	public static shouldDrawResizeGrip(
		entryIsCurrent: boolean,
		entryIndex: number,
		anchorIndex: number,
		wholeAxisSelected: boolean,
		phone: boolean,
	): boolean {
		if (!phone)
			return entryIsCurrent;

		return entryIndex === anchorIndex && wholeAxisSelected;
	}

	/*
	 * VO-P-0005 / M-0012 §2: "exactly one per selection ... it re-anchors to
	 * the trailing edge of a multi-column selection". This is that index --
	 * the highest-numbered VISIBLE entry the selection covers on this axis.
	 *
	 * Derived from `isHighlighted`, which HeaderInfo.update already computes
	 * for every entry out of the core's own selection rectangles
	 * (`_cellSelections`, the textselection message). That is deliberate: the
	 * extent of the selection is a fact the server states, and re-deriving it
	 * from a second signal is how the two would drift apart. Off screen it
	 * simply is not in `_elements`, so the disc is not drawn -- which is
	 * right, since the edge it points at is not on screen either.
	 *
	 * THE FALLBACK IS THE TAP, and it covers one window: `selectRow` and
	 * `selectColumn` set the whole-axis flag EARLY, before the core's
	 * selection message arrives, so for a frame or two the flag is up and no
	 * entry is highlighted yet. Falling back to the tapped index keeps the
	 * badge from blinking on the tap route.
	 *
	 * 🔴 THE FALLBACK IS A LATCH, AND THE LATCH CAN BE STALE. `_vulcanGripIndex`
	 * is written by `_onVulcanHeaderTap` and never cleared, so "no entry is
	 * highlighted" resolves to "the last entry a finger tapped on this axis"
	 * however long ago that was. That is right for the window above and wrong
	 * for any other state that reaches it with a whole-axis flag up -- and the
	 * guard below exists because one such state is a single tap away and is
	 * not a window at all. The honest statement of the residual, which an
	 * earlier draft of this comment got wrong: outside select-all the fallback
	 * can still be MISPLACED rather than merely absent (a name-box selection
	 * the wire does not cover, or a covered selection scrolled off screen,
	 * after an earlier header tap). It is bounded to that one latched index on
	 * this axis, and it needs the device pass M-0012 says this surface needs.
	 * It is deliberately not "fixed" by spending the latch on the first
	 * highlighted frame: whether a whole-column `.uno:SelectColumn` produces a
	 * covering rectangle at all is flagged unproven in-tree two methods down,
	 * and if it does not, a spent latch turns the tap route -- the shipping
	 * route, and this defect's entire symptom -- from a disc into nothing.
	 *
	 * Cost, stated: this walks the visible entries, and `_entryAtPoint` calls
	 * it once per entry it tests, so a pointer move is O(visible^2) trivial
	 * comparisons -- tens of columns, a few thousand integer compares, next
	 * to nothing beside the fills in the same pass. It is deliberately not
	 * cached: a cache here would have to be invalidated from `update()`,
	 * `onDraw()` and every hit test, and a stale anchor paints the mark on
	 * the wrong edge, which is the defect this method exists to fix.
	 */
	protected _vulcanSelectionAnchorIndex(): number {
		if (!this._isVulcanPhoneHeader())
			return -1;

		/*
		 * 🔴 SELECT-ALL HAS NO TRAILING EDGE THIS SECTION CAN READ, SO IT MUST
		 * NOT GUESS ONE.
		 *
		 * Both flags up means the whole sheet: `selectAllAndRestoreFocus`
		 * (Control.GroupBase) sets the pair, `CornerHeader.onClick` is its
		 * caller and carries no phone gate, and `_onRowColSelCount` then
		 * RE-states both because each count hits its maximum. So this is a
		 * steady state one tap away from any sheet, not an optimistic frame
		 * that resolves itself.
		 *
		 * In that state the phone cross-axis suppression in
		 * `isHeaderEntryHighLighted` returns false for EVERY entry on BOTH
		 * axes -- deliberately, C6b -- so `trailing` below is -1 on both, and
		 * the tap fallback would answer with each axis's own stale latch: two
		 * discs, on two indices a finger once chose, neither of them a
		 * trailing edge. That breaks M-0012 §2's "count: exactly one per
		 * selection" and its position rule at the same time, in a state
		 * M-0012 does not measure at all. Absent is the only answer the
		 * record supports, and it is what this fork painted before the anchor
		 * existed.
		 *
		 * Written as the flag pair rather than as "no entry is highlighted"
		 * on purpose: the pair is the state, and the empty highlight is only
		 * its symptom -- one it shares with the tap window the fallback is
		 * FOR.
		 */
		if (this._map && this._map.wholeRowSelected && this._map.wholeColumnSelected)
			return -1;

		let trailing = -1;
		if (this._headerInfo) {
			this._headerInfo.forEachElement(function(entry: HeaderEntryData): boolean {
				if (entry && entry.isHighlighted && entry.index > trailing)
					trailing = entry.index;
				return false; // continue till last.
			});
		}
		// The fallback is deliberately outside the walk's guard, not inside
		// it: "no entry is highlighted" and "the entry list is not built yet"
		// are the same state as far as this question goes, and both want the
		// tap's answer rather than no answer.
		return trailing >= 0 ? trailing : this._vulcanGripIndex;
	}

	protected _shouldDrawResizeGrip(entry: HeaderEntryData): boolean {
		// `wholeColumnSelected` means "a whole COLUMN is selected" (core sets
		// it when the selection spans every row), so it is the COLUMN
		// header's own flag. isHeaderEntryHighLighted below consumes the pair
		// crossed, on purpose and for a different question; this is not that.
		const wholeAxisSelected = this._isColumn
			? !!this._map.wholeColumnSelected
			: !!this._map.wholeRowSelected;

		return Header.shouldDrawResizeGrip(
			!!entry.isCurrent,
			entry.index,
			this._vulcanSelectionAnchorIndex(),
			wholeAxisSelected,
			this._isVulcanPhoneHeader());
	}

	/*
	 * C6a -- the resize band for the ONE entry a phone header tap armed, in
	 * core px, or null when this entry is not it.
	 *
	 * Keyed on _shouldDrawResizeGrip, so the band a finger can hit is exactly
	 * the band the grip is DRAWN on: the affordance and the target cannot
	 * drift apart, which is the whole defect this answers -- the stock band
	 * is the trailing 15 CSS px of EVERY entry (columns) or the bottom 25% of
	 * every row (~5 CSS px on a phone row), tapped or not, with nothing
	 * painted to say so.
	 *
	 * Null off the phone chrome BEFORE the grip predicate is consulted:
	 * off-phone _shouldDrawResizeGrip reduces to entry.isCurrent, which would
	 * silently widen the desktop band on whichever entry holds the cursor.
	 *
	 * This does NOT make the tap ambiguous. vulcanResizeArmDistance is the
	 * discriminator: a press inside the widened band is still a tap until the
	 * finger has travelled that far along the resize axis (24 CSS px since
	 * round 10 measured the reference's bracket -- the number is named, not
	 * repeated, because the 12 it used to say outlived the constant).
	 *
	 * 🔴 THE NAME NOW OUTRUNS THE PREDICATE. Round 15 re-keyed
	 * _shouldDrawResizeGrip from the tapped entry onto the SELECTION's
	 * trailing edge (VO-P-0005 / M-0012 §2, §4), so "tapped" here means "the
	 * entry carrying the disc", which a tap is only one route to. The band and
	 * the mark share one predicate on purpose: RU-09's generous target has to
	 * be centred on the paint it belongs to, or it is a target for something
	 * invisible.
	 */
	protected _vulcanTappedResizeBand(entry: HeaderEntryData, bandCSS: number): number | null {
		if (!this._isVulcanPhoneHeader() || !entry || !this._shouldDrawResizeGrip(entry))
			return null;

		return bandCSS * app.dpiScale;
	}

	// The grip only ever sits on the highlighted band, so on phones it takes
	// the same ink that band's own label takes. Off phone chrome this is the
	// stock literal, byte for byte -- and that literal used to be the whole
	// story: a hardcoded light grey with no dark variant, painted on the
	// §13-CALC.6 phone band, which is light-on-light in dark mode.
	protected _resizeGripColor(): string {
		return this._isVulcanPhoneHeader() ? this._selectionTextColor : '#BBBBBB';
	}

	/*
	 * ==================================================================
	 * C5 -- THE MANIPULATION CHROME (round 11).
	 *
	 * Two marks, and they are DIFFERENT VERBS. Keeping the distinction in the
	 * code is the point of writing them next to each other:
	 *
	 *   THE BADGE (_drawVulcanResizeBadge)  a small disc carrying a
	 *     double-headed arrow, on the selected header entry's trailing edge.
	 *     It means RESIZE. It replaces the two grey bars this fork drew there
	 *     before, which named no verb at all.
	 *
	 *   THE GUIDE (drawResizeLineIfNeeded)  the full-extent bar that tracks
	 *     the boundary while that drag is live. Same thing, mid-gesture.
	 *
	 * Both take their colours from --vulcan-manip-*, and both are NEUTRAL
	 * GREY on purpose. The reference measures its manipulation chrome
	 * byte-identical under two different platform palette seeds while every
	 * other accent in the app recolours: colour is spent on STATE (what is
	 * selected, what has focus) and withheld from the marks that say "you are
	 * dragging this". The house purple must not reach either of these.
	 * ==================================================================
	 */

	/*
	 * A --vulcan-* token off the document root, with a literal fallback -- the
	 * idiom TilesSection and ScrollSection already use for canvas paints.
	 *
	 * Read at PAINT time rather than cached at construction, unlike the header
	 * band styles above. Those are cached because they come off a throwaway
	 * probe <div> that is expensive to build; these are two custom properties
	 * on <html>, and reading them per drag frame is what makes the marks
	 * follow a live theme swap instead of keeping whatever theme was current
	 * when the header was first laid out (the §13-CALC.7 trap: the cursor and
	 * selection marks DO cache, and have no 'darkmodechanged' re-read).
	 */
	protected static vulcanManipColor(name: string, fallback: string): string {
		try {
			const v = getComputedStyle(document.documentElement)
				.getPropertyValue(name)
				.trim();
			return v || fallback;
		} catch (e) {
			return fallback;
		}
	}

	/*
	 * The reference's resize badge, MEASURED: a filled disc 46 device px across
	 * at density 3 -- 15 CSS px -- in a fixed neutral grey, carrying a white
	 * double-headed arrow, straddling the selected entry's resize boundary
	 * (horizontal on a column, vertical on a row).
	 *
	 * 15 CSS px is drawn as-is rather than scaled to our band: our phone column
	 * band is 26 CSS px and our row gutter 32 (§13-CALC GAP 2), against the
	 * reference's 23/45, so a 15px disc has the same relationship to the band
	 * it sits on. It is also the same diameter as the selection corner handles
	 * the sheet already draws, which is not a coincidence worth breaking.
	 *
	 * WHY A BADGE AND NOT THE TWO BARS. The bars were 2px wide and 8px apart
	 * either side of the edge -- readable as "a texture", not as a verb, and
	 * the round-10 device pass is why the hit band had to grow a 12px straddle
	 * to be findable at all. A disc with an arrow in it says which way the
	 * finger goes, and it centres the target it is painted on.
	 *
	 * Coordinates are CANVAS px (device px), matching every other paint in
	 * this file; the caller converts.
	 */
	protected _drawVulcanResizeBadge(centerX: number, centerY: number): void {
		const s = app.dpiScale;
		const r = (Header.vulcanBadgeDiameterCSS / 2) * s;
		const ctx = this.context;

		ctx.save();
		ctx.beginPath();
		ctx.fillStyle = Header.vulcanManipColor('--vulcan-manip-badge', '#757575');
		ctx.arc(centerX, centerY, r, 0, 2 * Math.PI);
		ctx.fill();

		// The glyph, in the disc's own local frame: a shaft with a head at each
		// end. Drawn along +x and then rotated a quarter turn for a row, so the
		// two axes cannot drift apart the way two hand-written copies would.
		ctx.translate(centerX, centerY);
		if (!this._isColumn)
			ctx.rotate(Math.PI / 2);

		const reach = r * 0.62;        // how far each head's point sits from centre
		const head = r * 0.34;         // head length AND half-height (a right angle)
		const shaft = Math.max(s, Math.round(r * 0.17)); // >= 1 device px

		ctx.fillStyle = Header.vulcanManipColor('--vulcan-affirm-contrast', '#FFFFFF');
		ctx.beginPath();
		ctx.rect(-reach + head, -shaft / 2, 2 * (reach - head), shaft);
		ctx.fill();

		for (const dir of [-1, 1]) {
			ctx.beginPath();
			ctx.moveTo(dir * reach, 0);
			ctx.lineTo(dir * (reach - head), -head);
			ctx.lineTo(dir * (reach - head), head);
			ctx.closePath();
			ctx.fill();
		}
		ctx.restore();
	}

	/** Reference §5: 46 device px at density 3. */
	public static readonly vulcanBadgeDiameterCSS: number = 15;

	/*
	 * D3 (round 12) -- THE BADGE IS AN OVERLAY, LIKE THE GUIDE BESIDE IT.
	 *
	 * Round 11 painted it from inside drawHeaderEntry, centred on the entry's
	 * trailing boundary. Half of that disc lies in the NEXT entry, and the
	 * next entry's own background fillRect runs later in the SAME pass and
	 * erased it. What actually shipped, read off the vehicle: a flat-bottomed
	 * half-disc carrying a single arrowhead. The double-headed arrow the
	 * commit describes has never once been painted.
	 *
	 * Drawing it after the entry loop is the fix that keeps the straddle,
	 * which is the property the mark is for -- the hit band crosses that
	 * boundary too (vulcanStraddleCSS), so a mark inset off the line would
	 * point at half its own target. The guide two methods down is already an
	 * after-the-loop overlay for the same reason; the two manipulation marks
	 * now share one paint order.
	 *
	 * The cost, stated: a single-entry repaint (onMouseMove's hover branch)
	 * no longer redraws the badge. That branch runs at the head of a gesture
	 * which requests a full redraw within the same touch, so the badge is
	 * gone for one frame rather than until the next zoom.
	 */
	protected _vulcanBadgeCentre(entry: HeaderEntryData): number[] | null {
		return null;
	}

	/** Whether this entry's resize badge is on screen -- read by the label
	 * fitter, because a badge takes band away from the number beside it. */
	protected _vulcanBadgeShowing(entry: HeaderEntryData): boolean {
		return this._isVulcanPhoneHeader()
			&& !this.inResize()
			&& !!entry && entry.size > 0
			&& this._shouldDrawResizeGrip(entry)
			&& !!this._vulcanBadgeCentre(entry);
	}

	drawVulcanBadgeIfNeeded(): void {
		if (!this._isVulcanPhoneHeader() || !this._headerInfo)
			return;
		// M-0012 §2: ONE disc per selection, on its trailing edge -- the
		// anchor, not the finger. See _vulcanSelectionAnchorIndex.
		const entry = this._headerInfo.getElementData(this._vulcanSelectionAnchorIndex());
		if (!this._vulcanBadgeShowing(entry))
			return;
		const centre = this._vulcanBadgeCentre(entry);
		this.containerObject.setPenPosition(this);
		this._drawVulcanResizeBadge(centre[0], centre[1]);
	}

	/*
	 * Reference §6: the drag indicator is a bar 10 device px thick at density
	 * 3 -- 3.33 CSS px -- with square caps and no arrowhead, spanning the full
	 * extent of the sheet. Rounded to whole device px so it never lands on a
	 * half-pixel and blurs into a 5px smear.
	 */
	public static vulcanGuideThickness(): number {
		return Math.max(app.dpiScale, Math.round(3.33 * app.dpiScale));
	}

	// One phone header tap: arm the resize grip for the entry the tap
	// selected, then raise the contextual pill. Called from
	// Row/ColumnHeader.onClick and from the touch-tap branch of onMouseUp --
	// the two places a header tap selects a whole row or column.
	protected _onVulcanHeaderTap(index: number): void {
		if (this._isVulcanPhoneHeader())
			this._vulcanGripIndex = index;

		this._showVulcanHeaderPill(index);
	}

	// Google-Sheets phone chrome (docs/mobile-redesign/02 §5): a header tap
	// that selected a whole row/column surfaces the floating contextual pill
	// (VulcanMobileSelectionBar.showForHeader), anchored just off the tapped
	// header entry. Called from _onVulcanHeaderTap; no-op outside the
	// vulcan phone chrome so stock/tablet/desktop behavior is untouched.
	protected _showVulcanHeaderPill(index: number): void {
		if (!this._isVulcanPhoneHeader())
			return;
		const bar = this._map.mobileSelectionBar;
		if (!bar || !bar.showForHeader)
			return;
		const rect = this.getHeaderEntryBoundingClientRect(index);
		if (!rect)
			return;
		if (this._isColumn)
			bar.showForHeader('column', index,
				(rect.left + rect.right) / 2,
				rect.top + this.size[1] / app.dpiScale);
		else
			bar.showForHeader('row', index,
				rect.left + this.size[0] / app.dpiScale,
				(rect.top + rect.bottom) / 2);
	}

	private _keyboardMenuAnchor(index: number): {x: number, y: number} {
		const rect = this.getHeaderEntryBoundingClientRect(index);
		if (rect)
			return this._isColumn
				? {x: rect.left, y: rect.top + this.size[1] / app.dpiScale}
				: {x: rect.left + this.size[0] / app.dpiScale, y: rect.top};

		const canvasRect = this.containerObject.getCanvasBoundingClientRect();
		return {x: canvasRect.left, y: canvasRect.top};
	}

	getHeaderEntryBoundingClientRect(index?: number): Partial<DOMRect> {
		return undefined;
	}

	_updateCanvas(): void {
		if (this._headerInfo) {
			this._headerInfo.update(this as any as CanvasSectionObject);
			this.containerObject.requestReDraw();
		}
	}

	_reInitRowColumnHeaderStylesAfterModeChange(): void {
		// add a separation to update row/column DOM element info
		var isSheetView = app.calc.isSelectedPartSheetView();

		if (this._isColumn) {
			// update column DOM element info
			if (isSheetView) {
				this._initHeaderEntryStyles('spreadsheet-header-sheetview-column');
				this._initHeaderEntryHoverStyles('spreadsheet-header-sheetview-column-hover');
				this._initHeaderEntrySelectedStyles('spreadsheet-header-sheetview-column-selected');
			}
			else {
				this._initHeaderEntryStyles('spreadsheet-header-column');
				this._initHeaderEntryHoverStyles('spreadsheet-header-column-hover');
				this._initHeaderEntrySelectedStyles('spreadsheet-header-column-selected');
			}
			this._initHeaderEntryResizeStyles('spreadsheet-header-column-resize');
		}
		else {
			// update row DOM element info
			if (isSheetView) {
				this._initHeaderEntryStyles('spreadsheet-header-sheetview-row');
				this._initHeaderEntryHoverStyles('spreadsheet-header-sheetview-row-hover');
				this._initHeaderEntrySelectedStyles('spreadsheet-header-sheetview-row-selected');
			}
			else {
				this._initHeaderEntryStyles('spreadsheet-header-row');
				this._initHeaderEntryHoverStyles('spreadsheet-header-row-hover');
				this._initHeaderEntrySelectedStyles('spreadsheet-header-row-selected');
			}
			this._initHeaderEntryResizeStyles('spreadsheet-header-row-resize');
		}
	}

	optimalHeight (index: number): void {
		if (!this._isRowColumnInSelectedRange(index)) {
			this._selectRow(index, 0);
		}
		this._map.sendUnoCommand('.uno:SetOptimalRowHeight');
	}

	insertRowAbove (index: number): void {
		// First select the corresponding row because
		// .uno:InsertRows doesn't accept any row number
		// as argument and just inserts before the selected row
		if (!this._isRowColumnInSelectedRange(index)) {
			this._selectRow(index, 0);
		}
		this._map.sendUnoCommand('.uno:InsertRows');
	}

	insertRowBelow (index: number): void {
		if (!this._isRowColumnInSelectedRange(index)) {
			this._selectRow(index, 0);
		}
		this._map.sendUnoCommand('.uno:InsertRowsAfter');
	}

	deleteRow (index: number): void {
		if (!this._isRowColumnInSelectedRange(index)) {
			this._selectRow(index, 0);
		}
		this._map.sendUnoCommand('.uno:DeleteRows');
	}

	hideRow (index: number): void {
		if (!this._isRowColumnInSelectedRange(index)) {
			this._selectRow(index, 0);
		}
		this._map.sendUnoCommand('.uno:HideRow');
	}

	showRow (index: number): void {
		if (!this._isRowColumnInSelectedRange(index)) {
			this._selectRow(index, 0);
		}
		this._map.sendUnoCommand('.uno:ShowRow');
	}

	_selectRow (row: number, modifier: number): void {
		// If function dialog is open and user wants to add the whole row to function.
		if (this._map.dialog.hasOpenedDialog() && this._map.dialog.getCurrentDialogContainer()) {
			const dialogContainer = this._map.dialog.getCurrentDialogContainer();
			if (dialogContainer.dataset.uniqueId === 'FormulaDialog') {
				const alpha = String(row + 1);
				const text = alpha + ':' + alpha;
				this._map._textInput._sendText(text);
			}

			return;
		}

		// Normal behavior.
		const command = {
			Row: {
				type: 'long',
				value: row
			},
			Modifier: {
				type: 'unsigned short',
				value: modifier
			}
		};

		this._map.wholeRowSelected = true; // This variable is set early, state change will set this again.
		this._map.sendUnoCommand('.uno:SelectRow ', command);
		// Ensures the focus is returned to the map area after the row is selected
		this._map.focus();
	}

	_insertRowAbove(): void {
		const index = this._lastMouseOverIndex;
		if (index !== undefined) {
			this.insertRowAbove.call(this, index);
		}
	}

	_insertRowBelow(): void {
		const index = this._lastMouseOverIndex;
		if (index !== undefined) {
			this.insertRowBelow.call(this, index);
		}
	}

	_deleteSelectedRow(): void {
		const index = this._lastMouseOverIndex;
		if (index !== undefined) {
			this.deleteRow.call(this, index);
		}
	}

	_rowHeight(): void {
		this._map.sendUnoCommand('.uno:RowHeight');
	}

	_optimalHeight(): void {
		const index = this._lastMouseOverIndex;
		if (index !== undefined) {
			this.optimalHeight.call(this, index);
		}
	}

	_hideRow(): void {
		const index = this._lastMouseOverIndex;
		if (index !== undefined) {
			this.hideRow.call(this, index);
		}
	}

	_showRow(): void {
		const index = this._lastMouseOverIndex;
		if (index !== undefined) {
			this.showRow.call(this, index);
		}
	}

	optimalWidth (index: number): void {
		if (!this._isRowColumnInSelectedRange(index)) {
			this._selectColumn(index, 0);
		}
		this._map.sendUnoCommand('.uno:SetOptimalColumnWidth');
	}

	insertColumnBefore (index: number): void {
		// First select the corresponding column because
		// .uno:InsertColumn doesn't accept any column number
		// as argument and just inserts before the selected column
		if (!this._isRowColumnInSelectedRange(index)) {
			this._selectColumn(index, 0);
		}
		this._map.sendUnoCommand('.uno:InsertColumns');
		this._updateColumnHeader();
	}

	insertColumnAfter (index: number): void {
		if (!this._isRowColumnInSelectedRange(index)) {
			this._selectColumn(index, 0);
		}
		this._map.sendUnoCommand('.uno:InsertColumnsAfter');
		this._updateColumnHeader();
	}

	deleteColumn (index: number): void {
		if (!this._isRowColumnInSelectedRange(index)) {
			this._selectColumn(index, 0);
		}
		this._map.sendUnoCommand('.uno:DeleteColumns');
		this._updateColumnHeader();
	}

	hideColumn (index: number): void {
		if (!this._isRowColumnInSelectedRange(index)) {
			this._selectColumn(index, 0);
		}
		this._map.sendUnoCommand('.uno:HideColumn');
		this._updateColumnHeader();
	}

	showColumn (index: number): void {
		if (!this._isRowColumnInSelectedRange(index)) {
			this._selectColumn(index, 0);
		}
		this._map.sendUnoCommand('.uno:ShowColumn');
		this._updateColumnHeader();
	}

	_updateColumnHeader(): void {
		this._map._docLayer.refreshViewData({x: this._map._getTopLeftPoint().x, y: 0, offset: {x: undefined, y: 0}});
	}

	_colIndexToAlpha (columnNumber: number): string {
		const offset = 'A'.charCodeAt(0);
		let dividend = columnNumber;
		let columnName = '';

		while (dividend > 0) {
			const modulo: number = (dividend - 1) % 26;
			columnName = String.fromCharCode(offset + modulo) + columnName;
			dividend = Math.floor((dividend - modulo) / 26);
		}

		return columnName;
	}

	_selectColumn (colNumber: number, modifier: number): void {
		// If function dialog is open and user wants to add the whole column to function.
		if (this._map.dialog.hasOpenedDialog() && this._map.dialog.getCurrentDialogContainer()) {
			const dialogContainer = this._map.dialog.getCurrentDialogContainer();
			if (dialogContainer.dataset.uniqueId === 'FormulaDialog') {
				const alpha = this._colIndexToAlpha(colNumber + 1);
				const text = alpha + ':' + alpha;
				this._map._textInput._sendText(text);
			}

			return;
		}

		// Normal behavior.
		const command = {
			Col: {
				type: 'unsigned short',
				value: colNumber
			},
			Modifier: {
				type: 'unsigned short',
				value: modifier
			}
		};

		this._map.wholeColumnSelected = true; // This variable is set early, state change will set this again.
		this._map.sendUnoCommand('.uno:SelectColumn ', command);
		// Ensures the focus is returned to the map area after the column is selected
		this._map.focus();
	}

	_insertColBefore(): void {
		const index = this._lastMouseOverIndex;
		if (index !== undefined) {
			this.insertColumnBefore.call(this, index);
		}
	}

	_insertColAfter(): void {
		const index = this._lastMouseOverIndex;
		if (index !== undefined) {
			this.insertColumnAfter.call(this, index);
		}
	}

	_deleteSelectedCol(): void {
		const index = this._lastMouseOverIndex;
		if (index !== undefined) {
			this.deleteColumn.call(this, index);
		}
	}

	_columnWidth(): void {
		this._map.sendUnoCommand('.uno:ColumnWidth');
	}

	_optimalWidth(): void {
		const index = this._lastMouseOverIndex;
		if (index !== undefined) {
			this.optimalWidth.call(this, index);
		}
	}

	_hideColumn(): void {
		const index = this._lastMouseOverIndex;
		if (index !== undefined) {
			this.hideColumn.call(this, index);
		}
	}

	_showColumn(): void {
		const index = this._lastMouseOverIndex;
		if (index !== undefined) {
			this.showColumn.call(this, index);
		}
	}

	_freezePanes (): void {
		this._map.sendUnoCommand('.uno:FreezePanes');
	}

	/*
	 * S6 -- THE ARMED BAND SITS ENTIRELY ON ONE SIDE OF THE LINE THE FINGER IS
	 * AIMING AT.
	 *
	 * `isMouseOverResizeArea` measures `position > end - band`, so the widened
	 * phone band is the trailing slice of the tapped entry and nothing else:
	 * for row 5 it is [rowBottom - 18, rowBottom). A finger aiming AT the
	 * boundary lands at or just past it -- measured live on round-10 R4b, the
	 * armed hit window was delta in [-17, -1] CSS px and every press from the
	 * boundary downwards was dead, with 19-23 px below quietly resizing ROW 6
	 * instead (its own quarter-row band). A grip painted on a line, with the
	 * whole target above the line, is a target the finger cannot centre on.
	 *
	 * So let the armed entry's band CROSS its own boundary: a press inside the
	 * leading _vulcanFarBandCSS of the NEXT entry, when the previous entry is
	 * the armed one, is a resize of the armed entry, and the aim point is
	 * inside the band. Round 15 (M-0012 §4) then made the COLUMN's two sides
	 * equal at the measured 20.5 CSS px each, so its band is
	 * [boundary - 20.5, boundary + 20.5) -- centred, as measured. The row's
	 * stays the shipped, unmeasured [boundary - 18, boundary + 12).
	 *
	 * TWO THINGS IT DELIBERATELY DOES NOT DO:
	 *   - it does not change which entry a TAP selects. The straddle only
	 *     redirects the resize TARGET (`_vulcanStraddleEntry`, consumed in
	 *     onMouseDown); `_mouseOverEntry` stays the entry the finger is
	 *     physically inside, so a tap 6 px into row 6 still selects row 6 and
	 *     the pill still names row 6.
	 *   - it does not exist off the phone chrome. `_shouldDrawResizeGrip`
	 *     reduces to `entry.isCurrent` there, which would hand a straddle to
	 *     whichever entry holds the cursor and silently widen the desktop
	 *     band; the explicit phone gate is checked first for that reason.
	 */
	protected static readonly vulcanStraddleCSS: number = 12;

	/*
	 * VO-P-0005 / M-0012 §4 -- HALF THE MEASURED GRAB BAND, IN CSS PX.
	 *
	 * "A drag starting at the disc's own y resizes for any start x within
	 * edge ± 60 px; ± 65 px does not. So the grab band is ≈ 124 px wide
	 * (≈ 41 CSS px) centred on the edge, against a painted disc of 46 px
	 * (15)." At density 3 that puts the half-band in [20, 21.67) CSS px, and
	 * 20.5 is the value inside it that makes the two sides equal.
	 *
	 * 🔴 CENTRED is the property, not merely WIDE. The round-10 band was 23
	 * CSS px on the near side and a 12 px straddle on the far side, so a
	 * finger aiming AT the line -- which is where the disc is painted --
	 * spent most of its slop on one side of the target. RU-09 measured: a
	 * 15 dp painted hint over a 41 dp target, centred on the rule it moves.
	 *
	 * It is the COLUMN's number. M-0012's own "Not covered" says the disc's
	 * other extent swept non-monotonically and is therefore not a
	 * measurement, so the row keeps its shipped, unmeasured 18/12 until a
	 * capture earns a number -- see _vulcanFarBandCSS and RowHeader's
	 * VULCAN_TAPPED_ROW_BAND_CSS.
	 */
	public static readonly vulcanGrabHalfBandCSS: number = 20.5;

	/*
	 * How far PAST its own boundary the armed entry's band reaches, in CSS
	 * px. The column's is the measured half-band above; the row's is the
	 * shipped straddle, unmeasured and therefore unmoved.
	 */
	protected _vulcanFarBandCSS(): number {
		return this._isColumn
			? Header.vulcanGrabHalfBandCSS
			: Header.vulcanStraddleCSS;
	}

	/*
	 * ROUND 16 — VO-P-0005, SECOND ASK: THE DISC'S INNER HALF IS A RESIZE
	 * TARGET.
	 *
	 * The designer, with 1cd7ee1eff under his thumb: "it's way too difficult to
	 * resize a column or row ... tap and drag the slider itself to move it."
	 *
	 * Round 15 centred the disc on the header's INNER edge (M-0012 §2), which
	 * put half its paint over the grid — and left this section's hit test at
	 * the base rectangle, which ends exactly on that edge. So the half of the
	 * one drawn control that overhangs the grid was not this section's at
	 * all: a press there resolved to Tiles / MouseControl (a pan) or, on a
	 * whole-row / whole-column selection, to a selection corner grip (a
	 * reshape), because the selection's corner is the disc's centre. And the
	 * header half was not whole either: the edge band's canvas-origin slide
	 * (CellSelectionHandleSection.isHit, corrected in round 16) claimed the
	 * header band PAST the rule on a whole-axis selection, so on the build
	 * The designer tested the disc owned only its near-side quarter — a press
	 * anywhere else on its paint reshaped the selection or panned. That is
	 * the whole of the second ask, proven at L2 in round 16's verification.
	 *
	 * THE SLIVER. On the phone this section's hit region grows past its inner
	 * edge by vulcanDiscSliverCSS, ONLY under the disc: the along-axis extent
	 * is the disc's own grab band (the anchored entry's, straddle included —
	 * _entryAtPoint decides, so the row's 18/12 and the column's 20.5/20.5
	 * are consumed, not copied), and the region exists only while the disc is
	 * painted (_vulcanBadgeShowing). Nothing else about the header moves: the
	 * header's own tap band stays its paint (M-0012 §4, VO-P-0004), and away
	 * from the disc a point past the inner edge is not the header's, exactly
	 * as before.
	 *
	 * WHY THE HEADER AND NOT A NEW SECTION. The container resolves a finger
	 * by (zIndex, drawingOrder, processingOrder) — applyDrawingOrders is the
	 * LAST sort reNewAllSections runs, and findSectionContainingPoint walks
	 * that list from the end — so at zIndex 5 the column header (150) and row
	 * header (140) are already asked before MouseControl (51) and Tiles (50).
	 * The only reason the disc's inner half was not the header's is this
	 * section's base isHit bounds. Growing them is the whole fix on this
	 * side; the zIndex-9 selection grips, which are searched before every
	 * zIndex-5 section whatever their order, yield to this predicate
	 * themselves (CellSelectionHandle.resizeDiscClaims). 🔴 processingOrder is
	 * NOT touched: it is the layout order (Tiles anchors to the headers), and
	 * raising it would locate Tiles at the origin over the headers.
	 *
	 * THE LADDER, stated and pinned (CalcPhoneResizeAffordance group H):
	 * disc > selection corner > selection edge band > pan.
	 *
	 * A press in the sliver then runs the shipped DRAG unchanged: the
	 * container hands this section onMouseDown with a section-local point
	 * whose across-axis coordinate lies past the edge, _entryAtPoint reads
	 * only the along-axis coordinate, _hitResizeArea arms _dragEntry with the
	 * finger-absolute press offset (M-0012 §3), and vulcanResizeArmDistance
	 * still separates the tap from the resize.
	 *
	 * 🔴 THE SLIVER OWNS THE DRAG, NOT THE TAP. The sliver is 41 x 20 CSS px
	 * on a column and 20 x 30 on a row, and most of it lies OUTSIDE the
	 * disc's 7.5 px paint -- it is grid, over cells the user can see. Before
	 * this round a still tap anywhere in it was a CELL tap (the corner
	 * grip's D-A forward to MouseControl, or MouseControl itself), and the
	 * round-16 skeptic's PROBE-1/2 showed the first draft turning that into
	 * a whole-row/column select plus the pill: a tap on cell D1 selected
	 * column D. So an UNARMED release from a sliver press is forwarded to
	 * MouseControl as the document click it was (_vulcanForwardSliverTap,
	 * the grips' own D-A idiom), and only a release past the arm distance
	 * commits the resize.
	 *
	 * 🔴 EXCEPT ON THE DISC ITSELF, WHICH IS DRAG-ONLY -- MEASURED (wave E,
	 * D18 answered). reference/M-0020.md §3 R3(d)/(e) and §4 R4(d)/(e): with
	 * the whole column / row selected, a still tap on the disc and a 700 ms
	 * long press on the disc both change NOTHING -- no re-select, no
	 * collapse to a cell, no menu -- and the delivery is proven by a known
	 * positive (R8: the same point with a cell selected, no disc painted,
	 * selects the cell it covers; a long press there raises the context
	 * toolbar). "The disc absorbs the tap when it is painted." So a press
	 * within the disc's own painted radius (vulcanBadgeDiameterCSS / 2,
	 * both halves of the disc -- the header half too, which used to select)
	 * that never arms the resize does nothing at all (_vulcanPressOnDisc,
	 * consumed in onMouseUp), and a long press there raises no menu
	 * (onContextMenu). The rest of the sliver keeps the cell's click, and
	 * the header band beside the disc keeps E1 (select + pill): those two
	 * regions are unmeasured on the reference and hold base's verb.
	 *
	 * RTL columns keep the base rectangle: _vulcanStraddles refuses RTL for a
	 * reason that applies here too (the end/start mapping reverses), and the
	 * reference's RTL disc is unmeasured. Refusing is a reach gap, not a
	 * wrong target.
	 */

	/*
	 * 🔴 MEASURED (M-0020 §3 R3(c), §4 R4(c)). How far past the header's inner
	 * edge the disc's grab region reaches, in CSS px. Wave C shipped 15 as a
	 * judgment (disc radius 7.5 + the 8 px touch latch). The finger model
	 * then swept the reference's disc cross-axis on a whole column and a
	 * whole row alike: a drag starting at the disc centre + d into the grid
	 * RESIZEs for d = 0 … +20 and EXTENDs the selection at +25 (+30, +40) --
	 * "~22 dp" by interpolation, 20 the last measured RESIZE. This is the
	 * last point measured on the RESIZE side, not the interpolated boundary:
	 * a sliver that reached 22 would be claiming two unmeasured pixels from
	 * the corner grip, whose own reach the same record measures at 15.
	 */
	public static readonly vulcanDiscSliverCSS: number = 20;

	/*
	 * Whether `point` (a CANVAS point, the frame findSectionContainingPoint
	 * speaks) lies in the disc's sliver past this header's inner edge. Public
	 * because CellSelectionHandle asks it to yield; false everywhere off the
	 * phone chrome, so desktop and tablet hit tests are the base rectangle,
	 * byte for byte.
	 */
	public vulcanDiscSliverContains(point: number[]): boolean {
		if (!this._isVulcanPhoneHeader() || !this._headerInfo || !this.myTopLeft || !this.size)
			return false;
		if (this._isColumn && this.isCalcRTL())
			return false;

		// Across the axis: from the inner edge (inclusive — the base rectangle
		// already owns that line, but a zIndex-9 grip's inclusive box owns it
		// too and is asked first, so the yield must cover it) to the sliver's
		// depth past it.
		const across = this._isColumn ? point[1] : point[0];
		const inner = this._isColumn
			? this.myTopLeft[1] + this.size[1]
			: this.myTopLeft[0] + this.size[0];
		if (across < inner || across > inner + Header.vulcanDiscSliverCSS * app.dpiScale)
			return false;

		// Along the axis: within this header's own run.
		const along = this._isColumn ? point[0] : point[1];
		const alongStart = this._isColumn ? this.myTopLeft[0] : this.myTopLeft[1];
		const alongSize = this._isColumn ? this.size[0] : this.size[1];
		if (along < alongStart || along > alongStart + alongSize)
			return false;

		// ...and under the disc: the disc is painted, and the along-axis
		// position falls in the anchored entry's grab band (or its straddle
		// into the next entry). _entryAtPoint reads only the along-axis
		// coordinate, so the section-local point's across-axis overshoot is
		// harmless here and in the onMouseDown that follows.
		const anchor = this._headerInfo.getElementData(this._vulcanSelectionAnchorIndex());
		if (!this._vulcanBadgeShowing(anchor))
			return false;
		const local = cool.SimplePoint.fromCorePixels([
			point[0] - this.myTopLeft[0],
			point[1] - this.myTopLeft[1],
		]);
		// A PREDICATE, so it leaves no trace: _entryAtPoint writes
		// _vulcanStraddleEntry on every call, and this is asked by every
		// selection grip's hit test (CellSelectionHandle.resizeDiscClaims --
		// eight grips, both headers, per touchstart) for points that are not
		// this gesture's press. The one consumer, onMouseDown, recomputes it
		// through onMouseMove; restoring here keeps that true for any reader
		// added later.
		const straddleBefore = this._vulcanStraddleEntry;
		const result = this._entryAtPoint(local);
		const straddle = this._vulcanStraddleEntry;
		this._vulcanStraddleEntry = straddleBefore;
		if (!result || !result.hit)
			return false;
		const resizing = straddle || result.entry;
		return resizing.index === anchor.index;
	}

	/*
	 * Whether a section-local press lies strictly past this header's inner
	 * edge -- i.e. it reached this section through the sliver and is over the
	 * grid. The edge line itself is the base rectangle's (inclusive) and keeps
	 * the header's own tap.
	 */
	private _vulcanPressPastInnerEdge(point: cool.SimplePoint): boolean {
		if (!this._isVulcanPhoneHeader() || !this.size)
			return false;
		return this._isColumn ? point.pY > this.size[1] : point.pX > this.size[0];
	}

	/*
	 * Whether a section-local point lies within the painted resize disc --
	 * the disc's own radius (vulcanBadgeDiameterCSS / 2) around the centre
	 * the badge is painted at (_vulcanBadgeCentre of the anchored entry), on
	 * BOTH sides of the inner edge. False off the phone chrome and whenever
	 * no disc is painted (_vulcanBadgeShowing), so nothing here reaches a
	 * desktop, a tablet, or a header with a mere cell selected -- which is
	 * M-0020 R8's known positive: that same point, no disc, is live.
	 *
	 * The disc's painted radius, not the sliver: the sliver is the reach the
	 * finger needs for the DRAG (R3(c)/R4(c), ~20 dp past the centre); the
	 * inert region is what the reference measured a still tap and a long
	 * press ON the disc doing (R3(d)/(e), R4(d)/(e)). Outside the paint but
	 * inside the sliver the reference is unmeasured and base's verb stands.
	 */
	private _vulcanPressOnDisc(point: cool.SimplePoint): boolean {
		if (!this._isVulcanPhoneHeader() || !this._headerInfo || !point)
			return false;
		// The anchored entry, found by the same walk that chose its index
		// (_vulcanSelectionAnchorIndex): this runs on EVERY phone press, and
		// forEachElement is the one surface of HeaderInfo every press-path
		// contract on this class drives.
		const index = this._vulcanSelectionAnchorIndex();
		let anchor: HeaderEntryData = null;
		this._headerInfo.forEachElement(function(entry: HeaderEntryData): boolean {
			if (entry && entry.index === index) {
				anchor = entry;
				return true;
			}
			return false;
		});
		if (!this._vulcanBadgeShowing(anchor))
			return false;
		const centre = this._vulcanBadgeCentre(anchor);
		const r = (Header.vulcanBadgeDiameterCSS / 2) * app.dpiScale;
		const dx = point.pX - centre[0];
		const dy = point.pY - centre[1];
		return dx * dx + dy * dy <= r * r;
	}

	/*
	 * THE UNARMED RELEASE FROM A SLIVER PRESS IS THE CELL'S TAP.
	 *
	 * Forward it to MouseControl as the document click it would have been
	 * (the twin of CellSelectionHandle.onClick, round 8's D-A, which is what
	 * served this exact region before the sliver existed). The point crosses
	 * frames by myTopLeft difference, and it is the point where the finger
	 * LIFTED: the browser's own rule for the click it synthesises, and the
	 * position the D-A forward carried. The release travel is the container's
	 * canvas-frame answer during onMouseUp propagation; when it has none (a
	 * synthetic mouseup from a window blur) the press stands in.
	 *
	 * The event is synthetic because Row/ColumnHeader.onMouseUp hand this
	 * class nothing (their `super.onMouseUp()` is argument-free); MouseControl
	 * .onClick reads only the modifier keys off it, and a phone tap has none.
	 * The container's compatibility click, if the browser sends one, is stood
	 * down by _vulcanTapConsumed exactly as the header's own tap is.
	 *
	 * Nothing here runs off the phone chrome: _vulcanSliverPress is null there
	 * because _vulcanPressPastInnerEdge is false by its first line.
	 */
	private _vulcanForwardSliverTap(): void {
		const press = this._vulcanSliverPress;
		this._vulcanSliverPress = null;
		if (!press || !this.containerObject || !app.CSections || !app.CSections.MouseControl)
			return;
		// `any`: the container hands back the base section type; onClick is on
		// it, myTopLeft is on it, and MouseControl is not imported here.
		const mouse: any = this.containerObject.getSectionWithName(app.CSections.MouseControl.name);
		if (!mouse || !mouse.myTopLeft)
			return;
		const travel = this.containerObject.getReleaseDragDistance();
		const lifted = travel ? [press[0] + travel[0], press[1] + travel[1]] : press;
		const forwarded = cool.SimplePoint.fromCorePixels([
			lifted[0] - mouse.myTopLeft[0],
			lifted[1] - mouse.myTopLeft[1],
		]);
		// window.MouseEvent, not the bare global: the same constructor in a
		// browser, and the one the jsdom rigs actually expose.
		mouse.onClick(forwarded, new window.MouseEvent('click', { button: 0, buttons: 0 }));
	}

	/*
	 * The base rectangle, plus the disc's sliver on the phone. Substitute
	 * phone = false and vulcanDiscSliverContains is false by its first line,
	 * so this is `super.isHit(point)` everywhere else.
	 */
	isHit(point: number[]): boolean {
		return super.isHit(point) || this.vulcanDiscSliverContains(point);
	}

	_entryAtPoint(point: cool.SimplePoint): PointEntryQueryResult {
		this._vulcanStraddleEntry = null;

		if (!this._headerInfo)
			return undefined;

		const isColumn = this._headerInfo._isColumn;
		const position = isColumn ? point.pX: point.pY;

		let result:PointEntryQueryResult  = null;
		let previous: HeaderEntryData = null;
		const isRTL = isColumn && this.isCalcRTL();
		this._headerInfo.forEachElement(function(entry: HeaderEntryData): boolean {
			const end = isRTL ? this.size[0] - entry.pos + entry.size : entry.pos;
			const start = end - entry.size;
			if (position >= start && position < end) {
				const hit = this.isMouseOverResizeArea(start, end, position, entry.isCurrent, entry);
				if (!hit && this._vulcanStraddles(previous, position, start, isRTL)) {
					this._vulcanStraddleEntry = previous;
					result = {entry: entry, hit: true};
				} else {
					result = {entry: entry, hit: hit};
				}
				return true;
			}
			previous = entry;
		}.bind(this));
		return result;
	}

	/*
	 * The far half of the straddle: `position` fell inside the entry that
	 * FOLLOWS `previous`, within the straddle depth of the boundary they share,
	 * and `previous` is the one entry a phone header tap armed.
	 *
	 * 🔴 LTR ONLY, AND THAT IS NOT TIMIDITY. In an RTL sheet the mapping
	 * `end = size[0] - entry.pos + entry.size` reverses which neighbour each
	 * edge belongs to: entry i's `end` is its boundary with entry i-1, which
	 * `forEachElement` has ALREADY walked past, so the armed entry is never the
	 * `previous` this function is handed. A straddle computed here would widen
	 * a band toward the wrong column. Refusing keeps RTL on the shipped
	 * one-sided band, which is a reach problem, not a wrong-target one.
	 * Covering it needs the NEXT entry rather than the previous one, and that
	 * is a lookahead this walk does not have; see the note in the report.
	 *
	 * Rows are unaffected either way: `isRTL` is `isColumn && isCalcRTL()`.
	 */
	/*
	 * How far the press sits from the boundary it is about to drag, signed, in
	 * core px -- and 0 wherever the shipped displacement behaviour must stand.
	 *
	 * Zero OFF THE PHONE, because desktop is 95-96% of production use and its
	 * mouse lands within borderResizeHandle (3 px) of the line anyway: the
	 * correction would be worth 3 px there and is not worth changing a verified
	 * behaviour for. Zero in RTL for the reason _vulcanStraddles gives -- the
	 * end/start mapping reverses, so the offset's sign would too, and RTL
	 * columns are unmeasured on the reference.
	 */
	private _vulcanPressOffset(point: cool.SimplePoint, entry: HeaderEntryData): number {
		if (!this._isVulcanPhoneHeader()) return 0;
		if (this._isColumn && this.isCalcRTL()) return 0;
		return (this._isColumn ? point.pX : point.pY) - entry.pos;
	}

	private _vulcanStraddles(
		previous: HeaderEntryData,
		position: number,
		start: number,
		isRTL: boolean,
	): boolean {
		if (isRTL) return false;
		if (!this._isVulcanPhoneHeader() || !previous)
			return false;
		if (!this._shouldDrawResizeGrip(previous))
			return false;
		return position - start < this._vulcanFarBandCSS() * app.dpiScale;
	}

	drawHeaderEntry (entry: HeaderEntryData): void {
		return;
	}

	/*
	 * Paint inside the section rectangle only. Sections are unclipped and the
	 * headers draw AFTER the corner header (drawing order 130 < 140), so the
	 * first, mostly scrolled-off row's label — clamped to start at the header
	 * top with its glyphs centred in the remaining sliver — used to spill a few
	 * device pixels up into the corner cell (the "153 poking into the dead
	 * square" defect). A clip to our own box is what the corner needs; every
	 * entry redraw (hover, leave, drag) goes through here too.
	 */
	protected drawClipped(draw: () => void): void {
		const ctx = this.context;
		ctx.save();
		ctx.beginPath();
		ctx.rect(0, 0, this.size[0], this.size[1]);
		ctx.clip();
		try {
			draw();
		} finally {
			ctx.restore();
		}
	}

	onDraw(): void {
		this.drawClipped(() => {
			this._headerInfo.forEachElement(function(elemData: HeaderEntryData): boolean {
				this.drawHeaderEntry(elemData);
				return false; // continue till last.
			}.bind(this));
		});

		// OUTSIDE the clip on purpose: the phone's resize badge is centred ON
		// the header's far edge (_vulcanBadgeCentre), so half its disc lives in
		// the grid, and the resize guide runs from that edge across the whole
		// grid (drawResizeLineIfNeeded) — a clip to our own box would discard
		// half of one and every pixel of the other.
		this.drawVulcanBadgeIfNeeded();
		this.drawResizeLineIfNeeded();
	}

	onDragEnd (dragDistance: number[]): void {
		return;
	}

	onMouseEnter(): void {
		this.context.canvas.style.cursor = this._cursor;
	}

	onMouseLeave (point: cool.SimplePoint): void {
		if (point === null) { // This means that the mouse pointer is outside the canvas.
			if (this.containerObject.isDraggingSomething() && this._dragEntry && this._isResizeArmed()) { // Were we resizing a row / column before mouse left.
				this.onDragEnd(this.containerObject.getDragDistance());
			}
		}

		if (this._mouseOverEntry) {
			this.containerObject.setPenPosition(this);
			this._mouseOverEntry.isOver = false;
			this.drawClipped(() => this.drawHeaderEntry(this._mouseOverEntry));
			this._mouseOverEntry = null;
		}
		this._hitResizeArea = false;
	}

	private _createMenuPositionElement(clientX: number, clientY: number): HTMLElement {
		const container = document.getElementById('canvas-container');
		if (!this._menuPosEl) {
			this._menuPosEl = document.createElement('div');
			this._menuPosEl.id = this._headerMenuID + '-pos';
			container.append(this._menuPosEl);
		}
		const rect = container.getBoundingClientRect();
		this._menuPosEl.style.position = 'absolute';
		this._menuPosEl.style.zIndex = '1500';
		this._menuPosEl.style.left = (clientX - rect.left) + 'px';
		this._menuPosEl.style.top = (clientY - rect.top) + 'px';
		return this._menuPosEl;
	}

	// Sheet protection blocks some header commands but leaves others
	// working, and which structural edits stay allowed is chosen when the
	// sheet is protected. Keep in the menu only the commands that still work
	// on the current sheet.
	_isHeaderCommandUsable(command: string): boolean {
		const part = this._map._docLayer._selectedPart;
		if (!(app.calc as any).isPartProtected(part))
			return true;

		switch (command) {
		// Freezing panes and opening the width or height dialog keep working
		// on a protected sheet.
		case '.uno:FreezePanes':
		case '.uno:ColumnWidth':
		case '.uno:RowHeight':
			return true;
		case '.uno:InsertColumnsBefore':
		case '.uno:InsertColumnsAfter':
			return (app.calc as any).isProtectedSheetEditAllowed(part, 'insertcolumns');
		case '.uno:DeleteColumns':
			return (app.calc as any).isProtectedSheetEditAllowed(part, 'deletecolumns');
		case '.uno:InsertRowsBefore':
		case '.uno:InsertRowsAfter':
			return (app.calc as any).isProtectedSheetEditAllowed(part, 'insertrows');
		case '.uno:DeleteRows':
			return (app.calc as any).isProtectedSheetEditAllowed(part, 'deleterows');
		// Hiding, showing and optimal sizing are rejected on any protected
		// sheet.
		default:
			return false;
		}
	}

	private _getDropdownEntries(): any[] {
		const entries: any[] = [];
		for (const command of Object.keys(this._menuItem)) {
			if (!this._isHeaderCommandUsable(command))
				continue;
			entries.push({
				id: command,
				uno: command,
				type: 'comboboxentry',
				text: _UNO(command, 'spreadsheet', true),
				img: command,
				class: this._commandClass(command),
			});
		}
		return entries;
	}

	private _commandClass(command: string): string {
		return command.replace(/[^a-zA-Z0-9]/g, '');
	}

	private _handleDropdownCallback(
		objectType: string,
		eventType: string,
		object: any,
		data: any,
		entry: any,
	): boolean {
		if (eventType !== 'selected')
			return false;

		const command = entry.id || entry.uno;
		if (command && this._menuItem[command] && this._menuItem[command].callback) {
			this._menuItem[command].callback();
		}
		return true;
	}

	inResize(): boolean {
		return this.containerObject.isDraggingSomething() && this._dragEntry && (this._dragDistance !== null)
			&& this._isResizeArmed();
	}

	/*
	 * THE DRAG GUIDE (C5 / C7).
	 *
	 * 🔴 WHAT THIS USED TO BE: `strokeStyle = 'darkblue'` at 1 device px --
	 * a hard navy hairline ruled across the whole sheet, the loudest object on
	 * a screen whose entire grammar is quiet chrome, and the one literal blue
	 * mark actually painted ON a header. The fork audit named it "the closest
	 * thing to ugly blue on the header itself".
	 *
	 * WHAT IT IS NOW, and every number is measured off the reference:
	 *   - 3.33 CSS px thick, square caps, no arrowhead, no tick, no bulb;
	 *   - TWO TONE. Over the header gutter it is #8B8B8B and states itself;
	 *     over the sheet it drops to #E1E1E1 and whispers. That split is the
	 *     reference's, and it is why the bar can span the whole document
	 *     without becoming the thing you look at.
	 *   - NEUTRAL in both palette seeds -- see the C5 block above.
	 *
	 * 🔴 THE VERB IS RESIZE, NOT MOVE, AND THAT MATTERS. These are the
	 * reference's COLUMN/ROW MOVE indicator numbers; this fork has no move
	 * gesture to hang them on (a header drag is resize-or-nothing, and there is
	 * no reorder verb anywhere in Calc's phone inventory). They are used here
	 * because the reference draws its RESIZE guide from the same vocabulary --
	 * a full-height grey rule that tracks the finger -- and because one drag
	 * guide is better than two. If a move gesture is ever built, it wants this
	 * exact painter plus boundary SNAPPING, which resize must not have.
	 *
	 * Substitute the old constants back and the geometry is unchanged: this
	 * still draws one straight line from the dragged boundary across the
	 * document, on the same axis, at the same place.
	 */
	drawResizeLineIfNeeded(): void {
		if (!this.inResize())
			return;

		this.containerObject.setPenPosition(this);
		const isRTL = this.isCalcRTL();
		const x = this._isColumn ? ((isRTL ? this.size[0] - this._dragEntry.pos: this._dragEntry.pos) + this._dragDistance[0]): (isRTL ? 0 : this.size[0]);
		const y = this._isColumn ? this.size[1]: (this._dragEntry.pos + this._dragDistance[1]);

		const phone = this._isVulcanPhoneHeader();
		// Off the phone chrome this reduces to the shipped hairline: one
		// stroke, 1 device px, one colour. Desktop is 95-96% of production use
		// and its mouse guide is a mouse guide.
		this.context.lineWidth = phone ? Header.vulcanGuideThickness() : app.dpiScale;
		this.context.lineCap = 'butt';

		const bodyEnd = this._isColumn ? this.containerObject.getHeight() : (isRTL ? -this.myTopLeft[0] : this.containerObject.getWidth());

		// Pass 1: the SHEET half, quiet.
		this.context.strokeStyle = phone
			? Header.vulcanManipColor('--vulcan-manip-guide-body', '#E1E1E1')
			: 'darkblue';
		this.context.beginPath();
		this.context.moveTo(x, y);
		this.context.lineTo(this._isColumn ? x: bodyEnd, this._isColumn ? bodyEnd: y);
		this.context.stroke();

		if (!phone)
			return;

		// Pass 2: the GUTTER half, stated. `this.size` is this header
		// section's own box and the guide STARTS on its far edge (a column
		// guide starts at the band's bottom, y = size[1]; a row guide at the
		// gutter's inner edge, x = size[0], mirrored in RTL) -- so this
		// segment runs back across the band to the opposite edge, which is
		// exactly the part of the guide that crosses chrome.
		this.context.strokeStyle = Header.vulcanManipColor('--vulcan-manip-guide', '#8B8B8B');
		this.context.beginPath();
		this.context.moveTo(x, y);
		this.context.lineTo(this._isColumn ? x : (isRTL ? this.size[0] : 0), this._isColumn ? 0 : y);
		this.context.stroke();
	}

	onMouseMove (point: cool.SimplePoint, dragDistance?: number[]): void {
		const result = this._entryAtPoint(point); // Data related to current entry that the mouse is over now.
		if (result) { // Is mouse over an entry.
			this._prevMouseOverEntry = this._mouseOverEntry;
			this._mouseOverEntry = result.entry;
		}
		else return;

		if (!this.containerObject.isDraggingSomething()) { // If we are not dragging anything.
			this._dragDistance = null;

			// If mouse was over another entry previously, we draw that again (without mouse-over effect).
			if (this._prevMouseOverEntry && (result && result.entry.index !== this._prevMouseOverEntry.index)) {
				this.containerObject.setPenPosition(this);
				this._prevMouseOverEntry.isOver = false;
				this.drawClipped(() => this.drawHeaderEntry(this._prevMouseOverEntry));
			}

			let isMouseOverResizeArea = false;

			this._mouseOverEntry.isOver = true;
			this._lastMouseOverIndex = this._mouseOverEntry.index; // used by context menu
			this.containerObject.setPenPosition(this);
			this.drawClipped(() => this.drawHeaderEntry(result.entry));
			isMouseOverResizeArea = result.hit && this._map.isEditMode();

			// cypress mobile emulation sometimes triggers resizing unintentionally.
			if (window.L.Browser.cypressTest)
				return;

			if (isMouseOverResizeArea !== this._hitResizeArea) { // Do we need to change cursor (to resize or pointer).
				const cursor = isMouseOverResizeArea ? this._resizeCursor : this._cursor;
				this.context.canvas.style.cursor = cursor;
				this._hitResizeArea = isMouseOverResizeArea;
			}
		}
		else { // We are in dragging mode.
			this._dragDistance = dragDistance;

			// Phone: arm the resize the first time the finger clears the
			// threshold on the resize axis. Once armed it stays armed for the
			// rest of the gesture (reset in onMouseDown). The container latches
			// draggingSomething at >0.1 core px -- about 0.1 CSS px at dpr 3 --
			// so without this every real tap on the band shipped a resize.
			if (this._dragEntry && !this._resizeArmed && dragDistance
				&& Math.abs(dragDistance[this._isColumn ? 0 : 1]) >= this.vulcanResizeArmDistance * app.dpiScale)
				this._resizeArmed = true;

			this.containerObject.requestReDraw(); // Remove previously drawn line and paint a new one.

			// G26 / C2: phones do not multi-select rows or columns. Dragging
			// ALONG the header extended the selection entry by entry with a
			// SHIFT modifier -- an affordance with no phone route back out of
			// it, no phone need for it, and no counterpart in Sheets' phone
			// grammar (Google's header verbs are all single-axis).
			// Substitute `false` for this predicate and everything below runs
			// exactly as it shipped, which is how every other phone gate in
			// this file is written.
			if (this._isVulcanPhoneHeader())
				return;

			if (this._prevMouseOverEntry && this._lastSelectedIndex == this._prevMouseOverEntry.index)
				return;
			if (this._dragEntry)
				return;
			const modifier = typeof this._lastSelectedIndex === 'number' && this._lastSelectedIndex >= 0 ? app.UNOModifier.SHIFT : 0;
			this._lastSelectedIndex = this._mouseOverEntry.index;
			this.selectIndex(this._mouseOverEntry.index, modifier);
		}
	}

	selectIndex(index: number, modifier: number): void {
		return;
	}

	setOptimalWidthAuto(): void {
		return;
	}

	setOptimalHeightAuto(): void {
		return;
	}

	/*
	 * S6 -- THE RETRY GESTURE MUST NOT UNDO THE RESIZE.
	 *
	 * On a phone the two taps a user makes when they are not sure the first one
	 * landed ARE a double click: the browser synthesises `dblclick` from them,
	 * it reaches here, and the optimal-size verb snaps the row straight back to
	 * its content height -- silently reverting a resize the finger had just
	 * succeeded in making (traced round-10 R4b, p3-retry-loop.json: two
	 * .uno:SelectRow followed by .uno:SetOptimalRowHeight).
	 *
	 * Optimal size is a mouse verb: on a desktop the double click is a
	 * deliberate, distinct gesture, so it keeps it byte for byte -- substitute
	 * `false` for the gate and this is the shipped line. The phone has no
	 * gesture to spare here, and if optimal size is wanted on a phone later it
	 * belongs on the header pill as a named verb, not on the retry.
	 */
	onDoubleClick(): void {
		if (this._isVulcanPhoneHeader())
			return;
		this._isColumn ? this.setOptimalWidthAuto(): this.setOptimalHeightAuto();
	}

	onMouseDown (point: cool.SimplePoint): void {
		this.onMouseMove(point);

		if (this._hitResizeArea) {
			window.L.DomUtil.disableImageDrag();
			window.L.DomUtil.disableTextSelection();

			// When code is here, this._mouseOverEntry should never be null.

			// S6: a straddling press is physically inside the NEXT entry but
			// means the armed one. Null off the phone chrome and for every
			// ordinary in-band press, so this reduces to _mouseOverEntry --
			// the expression that shipped -- everywhere else.
			const resizing = this._vulcanStraddleEntry || this._mouseOverEntry;

			// THE BOUNDARY FOLLOWS THE FINGER, NOT ITS DISPLACEMENT -- measured
			// on the reference (SHEETS-MODEL §3 "The dragged boundary is
			// absolute, not relative"): seven start offsets from -40px to +40px,
			// each dragged +100px, and every one landed the new boundary on the
			// finger's FINAL y. Ours computed `size + dragDistance`, which lands
			// it on `finalY - pressOffset` -- so the boundary trailed the finger
			// by however far inside the band the press happened to start, up to
			// the full band. Folding the press offset into the remembered entry
			// fixes the commit and the preview together, because they are the
			// two readers of exactly these two fields (onDragEnd reads .size,
			// drawResizeLineIfNeeded reads .pos) and both add the same
			// dragDistance to them.
			const offset = this._vulcanPressOffset(point, resizing);

			this._dragEntry = { // In case dragging takes place, we will remember this entry.
				index: resizing.index,
				origsize: resizing.origsize,
				pos: resizing.pos + offset,
				size: resizing.size + offset
			};
		}
		else {
			this._dragEntry = null;
		}

		this._resizeArmed = false; // Every gesture starts unarmed -- see _isResizeArmed.
		this._vulcanTapConsumed = false; // ...and unconsumed -- see _vulcanTapConsumed.
		// ...and remembers whether it began over the grid (the disc's sliver)
		// or inside the header's own rectangle -- see _vulcanForwardSliverTap.
		// The canvas frame, because that is the frame the release travel and
		// MouseControl's origin are both in.
		this._vulcanSliverPress = this._vulcanPressPastInnerEdge(point)
			? [this.myTopLeft[0] + point.pX, this.myTopLeft[1] + point.pY]
			: null;
		// ...and whether it landed ON the painted disc, either half -- the
		// region M-0020 measures as drag-only. See _vulcanPressOnDisc.
		this._vulcanDiscPress = this._vulcanPressOnDisc(point);
		this._startSelectionEntry = this._mouseOverEntry;
		this._lastSelectedIndex = null;
	}

	onMouseUp(): void {
		window.L.DomUtil.enableImageDrag();
		window.L.DomUtil.enableTextSelection();

		this._map.fire('closepopups'); // close all popups if a row/column header is selected

		/*
		 * VO-P-0004, THE SECOND ASK -- THE STILLER THE TAP, THE LESS LIKELY IT
		 * WAS TO SELECT ANYTHING.
		 *
		 * The container latches draggingSomething once the finger clears
		 * touchDraggingToleranceCSS (8 CSS px, CanvasSectionContainer), and
		 * that split the phone's header taps into two disjoint classes:
		 *
		 *   travel >  8 px -- draggingSomething true, so the fallback below
		 *                     does the tap's work. This is the class the
		 *                     round-13 fix repaired, and it stays repaired.
		 *   travel <= 8 px -- draggingSomething FALSE, so this returned here
		 *                     having done nothing at all.
		 *
		 * For that second class the tap's only remaining route to a selection
		 * was the browser's synthesised compatibility click, delivered through
		 * CanvasSectionContainer.onClick into Row/ColumnHeader.onClick. The
		 * fork does not control whether that event arrives: the container
		 * drops it whenever the press and the release resolve to different
		 * sections, and clearMousePositions() -- reachable from onMouseLeave,
		 * a mouseup outside the canvas, a window blur and touchcancel --
		 * nulls the two positions it requires, as does a second contact
		 * anywhere on the canvas (onTouchEnd only records the release
		 * position on the single-touch branch).
		 *
		 * So the CLEANER the tap, the more it depended on an event that may
		 * never come -- and a user hunting a 32 px gutter makes cleaner taps,
		 * not wobblier ones. That is why a correct round-13 fix left "still
		 * hard to select rows" standing, and it is the whole of the second
		 * ask.
		 *
		 * The phone therefore does its own work here for BOTH classes, and the
		 * click becomes belt and braces (suppressed for the gesture by
		 * _vulcanTapConsumed rather than removed, because desktop and tablet
		 * still ride it).
		 *
		 * Substitute phone = false and this is the shipped
		 * `if (!this.containerObject.isDraggingSomething()) return;`, byte for
		 * byte -- which desktop NEEDS, and not merely for parity's sake:
		 * _isResizeArmed() is unconditionally true off the phone chrome, so a
		 * motionless click inside the desktop resize band would fall into the
		 * commit below and post a .uno:RowHeight for a gesture that never
		 * dragged.
		 */
		if (!this.containerObject.isDraggingSomething() && !this._isVulcanPhoneHeader())
			return;

		// The armed resize commits and is done. Unchanged, and deliberately
		// still gated on _dragEntry: that field is the remembered entry the
		// commit reads, so without it there is no resize to end.
		if (this._dragEntry && this._isResizeArmed()) {
			this.onDragEnd(this.containerObject.getDragDistance());
			this._dragEntry = null;
			this._vulcanSliverPress = null;
			this._vulcanDiscPress = false;
			return;
		}

		// THE PHONE TAP FALLBACK, AND WHY IT NO LONGER SITS UNDER _dragEntry.
		//
		// A real finger emits a touchmove on almost every tap, so the container
		// has already latched draggingSomething and will swallow the click --
		// which is why the tap's work has to happen here at all.
		//
		// It used to be nested inside `&& this._dragEntry`, and onMouseDown
		// assigns _dragEntry ONLY under _hitResizeArea and nulls it otherwise.
		// So the fallback was reachable only when the press happened to land in
		// the resize band: every ordinary press on the body of a row header that
		// travelled at all selected NOTHING, with no feedback to say why. That
		// is the designer's "it's really hard to select rows" -- the band worked, the
		// other three quarters of the header cell did not.
		//
		// Off phone chrome _isResizeArmed() is unconditionally true, so the
		// branch above takes every desktop gesture that reaches here and this
		// one is phone-only by the same reasoning it always was; the explicit
		// guard says so rather than relying on that to hold.
		if (this._isVulcanPhoneHeader() && this._startSelectionEntry) {
			// Latch FIRST, then select: the compatibility click for this same
			// finger may still arrive, and the two onClick bodies read this
			// field to stand down. See _vulcanTapConsumed.
			this._vulcanTapConsumed = true;
			// ROUND 16 WAVE E: a press ON the painted disc that never armed the
			// resize is NOTHING -- no select, no pill, no cell click. M-0020
			// §3 R3(d) / §4 R4(d): "a still tap ... on the disc changes
			// nothing (NONE)", delivery proven. The latch above still stands
			// the compatibility click down, so the browser cannot serve the
			// tap a second way. The disc is drag-only; the arm distance is
			// the one threshold between its two verbs, so a sub-arm wobble
			// from a disc press is inert too (the reference's finger model
			// wobbles ±2 dp on every "still" tap).
			if (this._vulcanDiscPress) {
				this._vulcanSliverPress = null;
			// ROUND 16: a press that began over the GRID -- through the disc's
			// sliver -- and never armed the resize is the cell's tap, not the
			// header's. The header's own rectangle keeps the two lines below,
			// byte for byte. See _vulcanForwardSliverTap.
			} else if (this._vulcanSliverPress) {
				this._vulcanForwardSliverTap();
			} else {
				this.selectIndex(this._startSelectionEntry.index, 0);
				this._onVulcanHeaderTap(this._startSelectionEntry.index);
			}
		}
		this._dragEntry = null;
		this._vulcanSliverPress = null;
		this._vulcanDiscPress = false;
	}
}

export interface HeaderEntryData {
	index: number,
	pos: number, // end position on the header canvas
	size: number,
	origsize: number,
	isHighlighted?: boolean,
	isCurrent?: boolean,
	isOver?: boolean,
}

export interface PointEntryQueryResult {
	entry: HeaderEntryData,
	hit: boolean,
}

export class HeaderInfo {
	_map: any;
	_isColumn: boolean;
	_dimGeom: cool.SheetDimension;
	_docVisStart: number;
	_elements: HeaderEntryData[];
	_startIndex: number;
	_endIndex: number;
	_hasSplits: boolean;
	_splitIndex: number;
	_splitPos: number;

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	constructor(map: any, _isColumn: boolean) {
		window.app.console.assert(map && _isColumn !== undefined, 'map and isCol required');
		this._map = map;
		this._isColumn = _isColumn;
		window.app.console.assert(this._map._docLayer.sheetGeometry, 'no sheet geometry data-structure found!');
		const sheetGeom = this._map._docLayer.sheetGeometry as cool.SheetGeometry;
		this._dimGeom = this._isColumn ? sheetGeom.getColumnsGeometry() : sheetGeom.getRowsGeometry();
	}

	findXInCellSelections (cellSelections: cool.SimpleRectangle[], ordinate: number): boolean {
		for (let i = 0; i < cellSelections.length; i++) {
			if (cellSelections[i].pContainsX(ordinate))
				return true;
		}
		return false;
	}

	findYInCellSelections (cellSelections: cool.SimpleRectangle[], ordinate: number): boolean {
		for (let i = 0; i < cellSelections.length; i++) {
			if (cellSelections[i].pContainsY(ordinate))
				return true;
		}
		return false;
	}

	/*
	 * C6b -- on the phone, selecting a whole column must not tint every ROW
	 * header, and vice versa.
	 *
	 * Upstream's crossed reading below is deliberate on a mouse: a whole
	 * column IS present in every row, so lighting the row band states the
	 * extent of the selection. On a phone it states nothing -- the extent is
	 * "all of it" and the user just tapped the header that says so -- while
	 * costing the entire opposite band, which is then two tinted axes at once
	 * against a §13-CALC.6 band deliberately quiet enough to be read as a
	 * local difference between neighbours. Both bands lit is not a subtler
	 * cue; it is no cue.
	 *
	 * Placed before EVERY branch on purpose, not just before the whole-axis
	 * shortcut two lines down. The shortcut is not the only route to the same
	 * paint: core's own selection rectangle for a whole column may span every
	 * row, and findYInCellSelections below would then light them anyway. That
	 * is a claim about the wire, unproven in-tree -- which is exactly why the
	 * suppression is written so it does not depend on the answer.
	 *
	 * Substitute phone = false and the shipped expression comes back byte for
	 * byte, so desktop and tablet keep the crossed highlight.
	 */
	isHeaderEntryHighLighted (cellSelections: cool.SimpleRectangle[], ordinate: number): boolean {
		const crossAxisWhole = this._isColumn
			? this._map.wholeRowSelected
			: this._map.wholeColumnSelected;
		if (crossAxisWhole && isVulcanPhoneChrome())
			return false;

		if (this._isColumn && this._map.wholeRowSelected)
			return true;
		else if (!this._isColumn && this._map.wholeColumnSelected)
			return true;
		else if (this._isColumn && cellSelections.length > 0) {
			return this.findXInCellSelections(cellSelections, ordinate);
		}
		else if (!this._isColumn && cellSelections.length > 0) {
			return this.findYInCellSelections(cellSelections, ordinate);
		}
		else
			return false;
	}

	update(section: CanvasSectionObject): void {
		const cellSelections: cool.SimpleRectangle[] = this._map._docLayer._cellSelections;

		let currentIndex: number;
		if (app.calc.cellCursorVisible) {
			currentIndex = this._isColumn ? app.calc.cellAddress.x: app.calc.cellAddress.y;
		} else {
			currentIndex = -1;
		}

		const tsManager = this._map._docLayer._painter;
		const ctx = tsManager._paintContext();

		const splitPos = this._isColumn ?
			ctx.splitPos.x
			: ctx.splitPos.y;

		let startPx: number;
		let scale: number;
		if (tsManager._inZoomAnim) {
			const viewBounds = ctx.viewBounds;
			const freePaneBounds = new cool.Bounds(viewBounds.min.add(ctx.splitPos), viewBounds.max);

			scale = tsManager._zoomFrameScale;

			const zoomPos = tsManager._getZoomDocPos(
				tsManager._newCenter,
				tsManager._layer._pinchStartCenter,
				freePaneBounds,
				{ freezeX: false, freezeY: false },
				ctx.splitPos,
				scale,
				false
			);

			startPx = this._isColumn ?
				zoomPos.topLeft.x
				: zoomPos.topLeft.y;
		} else {
			startPx = this._isColumn ?
				app.activeDocument.activeLayout.viewedRectangle.pX1 + splitPos
				: app.activeDocument.activeLayout.viewedRectangle.pY1 + splitPos;
			scale = 1;
		}

		const endPx = this._isColumn ?
			startPx + section.size[0] / scale
			: startPx + section.size[1] / scale;

		this._docVisStart = startPx;
		let startIdx = this._dimGeom.getIndexFromPos(startPx, 'corepixels');
		const maxIndex = this._isColumn ? this._map._docLayer.sheetGeometry.maxVisibleColumnIndex : this._map._docLayer.sheetGeometry.maxVisibleRowIndex;
		const maxCount = this._isColumn ? app.calc.maxColumnCount : app.calc.maxRowCount;
		const endIdx = Math.min(this._dimGeom.getIndexFromPos(endPx - 1, 'corepixels'), maxCount - 1, maxIndex);
		this._elements = [];

		this._hasSplits = false;
		this._splitIndex = 0;

		if (splitPos) {
			const splitIndex = this._dimGeom.getIndexFromPos(splitPos + 1, 'corepixels');

			if (splitIndex) {
				this._splitPos = splitPos;
				this._dimGeom.forEachInRange(0,
					splitIndex - 1,
					(idx: number, data: DimensionPosSize) => {
						this._elements[idx] = {
							index: idx,
							pos: (data.startpos + data.size) * scale, // end position on the header canvas
							size: data.size * scale,
							origsize: data.size,
							isHighlighted: this.isHeaderEntryHighLighted(cellSelections, data.startpos + data.size * 0.5),
							isCurrent: idx === currentIndex
						};
					}
				);

				this._hasSplits = true;
				this._splitIndex = splitIndex;

				const freeStartPos = startPx;
				const freeStartIndex = this._dimGeom.getIndexFromPos(freeStartPos + 1, 'corepixels');

				startIdx = freeStartIndex;
			}
		}

		// first free index
		const dataFirstFree = this._dimGeom.getElementData(startIdx);
		const firstFreeEnd = dataFirstFree.startpos + dataFirstFree.size - startPx + splitPos;
		const firstFreeStart = splitPos;
		const firstFreeSize = Math.max(0, firstFreeEnd - firstFreeStart);
		this._elements[startIdx] = {
			index: startIdx,
			pos: firstFreeEnd * scale, // end position on the header canvas
			size: firstFreeSize * scale,
			origsize: dataFirstFree.size,
			isHighlighted: this.isHeaderEntryHighLighted(cellSelections, dataFirstFree.startpos + dataFirstFree.size * 0.5),
			isCurrent: startIdx === currentIndex
		};

		this._dimGeom.forEachInRange(startIdx + 1,
			endIdx,
			(idx: number, data: DimensionPosSize) => {
				this._elements[idx] = {
					index: idx,
					pos: (data.startpos - startPx + splitPos + data.size) * scale, // end position on the header canvas
					size: data.size * scale,
					origsize: data.size,
					isHighlighted: this.isHeaderEntryHighLighted(cellSelections, data.startpos + data.size * 0.5),
					isCurrent: idx === currentIndex
				};
			}
		);

		this._startIndex = startIdx;
		this._endIndex = endIdx;
	}

	docToHeaderPos (docPos: number): number {
		if (!this._hasSplits) {
			return docPos - this._docVisStart;
		}

		if (docPos <= this._splitPos) {
			return docPos;
		}

		// max here is to prevent encroachment of the fixed pane-area.
		return Math.max(docPos - this._docVisStart, this._splitPos);
	}

	headerToDocPos (hdrPos: number): number {
		if (!this._hasSplits) {
			return hdrPos + this._docVisStart;
		}

		if (hdrPos <= this._splitPos) {
			return hdrPos;
		}

		return hdrPos + this._docVisStart;
	}

	isZeroSize (i: number): boolean {
		const elem = this._elements[i];
		window.app.console.assert(elem, 'queried a non existent row/col in the header : ' + i);
		return elem.size === 0;
	}

	getMinIndex(): number {
		return this._hasSplits ? 0 : this._startIndex;
	}

	getMaxIndex(): number {
		return this._endIndex;
	}

	getElementData (index: number): HeaderEntryData {
		return this._elements[index];
	}

	getDocVisStart(): number {
		return this._docVisStart;
	}

	getRowData (index: number): HeaderEntryData {
		window.app.console.assert(!this._isColumn, 'this is a column header instance!');
		return this.getElementData(index);
	}

	getColData (index: number): HeaderEntryData {
		window.app.console.assert(this._isColumn, 'this is a row header instance!');
		return this.getElementData(index);
	}

	getPreviousIndex (index: number): number {

		let prevIndex: number;
		if (this._splitIndex && index === this._startIndex) {
			prevIndex = this._splitIndex - 1;
		}
		else {
			prevIndex = index - 1;
		}

		return prevIndex;
	}

	getNextIndex (index: number): number {

		let nextIndex;
		if (this._splitIndex && index === (this._splitIndex - 1)) {
			nextIndex = this._startIndex;
		}
		else {
			nextIndex = index + 1;
		}

		return nextIndex;
	}

	forEachElement (callback: (entry: HeaderEntryData) => boolean): void {
		let idx: number;
		if (this._hasSplits) {
			for (idx = 0; idx < this._splitIndex; ++idx) {
				window.app.console.assert(this._elements[idx], 'forEachElement failed');
				if (callback(this._elements[idx])) {
					return;
				}
			}
		}
		for (idx = this._startIndex; idx <= this._endIndex; ++idx) {
			window.app.console.assert(this._elements[idx], 'forEachElement failed');
			if (callback(this._elements[idx])) {
				return;
			}
		}
	}

}

}
