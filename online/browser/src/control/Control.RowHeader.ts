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
 */

/* global _UNO app */

declare var _UNO: any;

namespace cool {

/*
 * C6a. The anchored row's resize band on its NEAR side, in CSS px. Phone only.
 *
 * 🔴 UNMEASURED, AND DELIBERATELY LEFT ALONE. M-0012 §4 measured the COLUMN's
 * band (`Header.vulcanGrabHalfBandCSS`, ≈41 CSS px centred on the edge) and
 * its "Not covered" section records that the disc's other extent swept
 * non-monotonically -- "which is drift, not a measurement, so no number is
 * recorded". So this 18 and the row's 12 px far side stay the numbers round 10
 * chose by feel until a capture earns better ones, rather than borrowing the
 * column's the way the ROW GRIP once borrowed the column's floor (C8 below).
 */
const VULCAN_TAPPED_ROW_BAND_CSS = 18;

/*
 * C8. The shortest row that still earns a resize grip on a phone, in CSS px.
 *
 * Upstream's floor is `2 * resizeHandleSize` = 30 CSS px, which is a COLUMN
 * number: a default column clears it three times over, a default row at the
 * phone's forced 120% zoom is ~20.5 CSS px and never clears it at all. The
 * row grip has therefore never been painted on a phone, which is what made
 * row-height resize look deleted -- the drag path underneath was intact the
 * whole time. 14 is the shortest entry the two 2 px bars and their 1 px gap
 * can sit inside with the clamp in drawHeaderEntry.
 */
const VULCAN_MIN_GRIP_ROW_CSS = 14;

export class RowHeader extends cool.Header {
	anchor: Array<Array<string>> = [[app.CSections.CornerHeader.name, 'bottom', 'top'], [app.CSections.RowGroup.name, 'right', 'left']];
	position: number[] = [0, 0]; // This section's myTopLeft is placed according to corner header and row group sections.
	// Width MUST track CornerHeader's -- see Header.rowHeaderWidth().
	size: number[] = [Header.rowHeaderWidth(), 0]; // No initial height is necessary.
	expand: string[] = ['top', 'bottom']; // Expand vertically.
	processingOrder: number = app.CSections.RowHeader.processingOrder;
	drawingOrder: number = app.CSections.RowHeader.drawingOrder;
	zIndex: number = app.CSections.RowHeader.zIndex;
	cursor: string = 'row-resize';

	_current: number;
	_selection: SelectionRange;

	constructor(cursor?: string) {
		super(app.CSections.RowHeader.name);

		if (cursor)
			this.cursor = cursor;
	}

	onInitialize(): void {
		this._map = window.L.Map.THIS;
		this._isColumn = false;
		this._current = -1;
		this.resizeHandleSize = 15 * app.dpiScale;
		this._selection = {start: -1, end: -1};
		this._mouseOverEntry = null;
		this._lastMouseOverIndex = undefined;
		this._hitResizeArea = false;
		this.sectionProperties.docLayer = this._map._docLayer;

		super.onInitialize();

		this._headerMenuID = 'row-header-menu';
		// `name` is the DESKTOP context menu's markup and `text` is the plain
		// label the phone bottom sheet shows (G29 — the wizard writes labels
		// with textContent, so the markup used to render verbatim). The desktop
		// dropdown derives its own text from _UNO(command) and reads neither.
		this._menuItem = {
			'.uno:InsertRowsBefore': {
				name: app.IconUtil.createMenuItemLink(_UNO('.uno:InsertRowsBefore', 'spreadsheet', true), 'InsertRowsBefore'),
				isHtmlName: true,
				text: _UNO('.uno:InsertRowsBefore', 'spreadsheet', true),
				callback: (this._insertRowAbove).bind(this)
			},
			'.uno:InsertRowsAfter': {
				name: app.IconUtil.createMenuItemLink(_UNO('.uno:InsertRowsAfter', 'spreadsheet', true), 'InsertRowsAfter'),
				isHtmlName: true,
				text: _UNO('.uno:InsertRowsAfter', 'spreadsheet', true),
				callback: (this._insertRowBelow).bind(this)
			},
			'.uno:DeleteRows': {
				name: app.IconUtil.createMenuItemLink(_UNO('.uno:DeleteRows', 'spreadsheet', true), 'DeleteRows'),
				isHtmlName: true,
				text: _UNO('.uno:DeleteRows', 'spreadsheet', true),
				callback: (this._deleteSelectedRow).bind(this)
			},
			'.uno:RowHeight': {
				name: app.IconUtil.createMenuItemLink(_UNO('.uno:RowHeight', 'spreadsheet', true), 'RowHeight'),
				isHtmlName: true,
				text: _UNO('.uno:RowHeight', 'spreadsheet', true),
				callback: (this._rowHeight).bind(this)
			},
			'.uno:SetOptimalRowHeight': {
				name: app.IconUtil.createMenuItemLink(_UNO('.uno:SetOptimalRowHeight', 'spreadsheet', true), 'SetOptimalRowHeight'),
				isHtmlName: true,
				text: _UNO('.uno:SetOptimalRowHeight', 'spreadsheet', true),
				callback: (this._optimalHeight).bind(this)
			},
			'.uno:HideRow': {
				name: app.IconUtil.createMenuItemLink(_UNO('.uno:HideRow', 'spreadsheet', true), 'HideRow'),
				isHtmlName: true,
				text: _UNO('.uno:HideRow', 'spreadsheet', true),
				callback: (this._hideRow).bind(this)
			},
			'.uno:ShowRow': {
				name: app.IconUtil.createMenuItemLink(_UNO('.uno:ShowRow', 'spreadsheet', true), 'ShowRow'),
				isHtmlName: true,
				text: _UNO('.uno:ShowRow', 'spreadsheet', true),
				callback: (this._showRow).bind(this)
			},
			'.uno:FreezePanes': {
				name: app.IconUtil.createMenuItemLink(_UNO('.uno:FreezePanes', 'spreadsheet', true), 'FreezePanes'),
				isHtmlName: true,
				text: _UNO('.uno:FreezePanes', 'spreadsheet', true),
				callback: (this._freezePanes).bind(this)
			}
		};

		this._menuData = window.L.Control.JSDialogBuilder.getMenuStructureForMobileWizard(this._menuItem, true, '');
		this._headerInfo = new cool.HeaderInfo(this._map, false /* isCol */);
	}

	isMouseOverResizeArea(start: number, end:number, position: number, entryIsCurrent: boolean, entry?: HeaderEntryData) : boolean {
		let resizeAreaStart = Math.max(start, end - this.borderResizeHandle * app.dpiScale);
		if (entryIsCurrent || (window as any).mode.isSmallScreenDevice()) {
			if (this.resizeHandleSize > (end - start) / 4) {
				resizeAreaStart = end - ((end - start) / 4);
			} else {
				resizeAreaStart =  end - this.resizeHandleSize;
			}
		}
		// C6a. The quarter-row band above is the branch a phone always takes,
		// and on a ~20.5 CSS px row a quarter is ~5 px -- far below the
		// vulcanResizeArmDistance the gesture must then travel to arm (24 CSS
		// px; this comment said 12 for two rounds after the constant moved),
		// so the tapped row could not be dragged at all. For the tapped row
		// only, the band is 18 CSS px:
		// deliberately most of the row, because the only other verb on this
		// entry is a tap that re-selects the row it already selected.
		const tapped = this._vulcanTappedResizeBand(entry, VULCAN_TAPPED_ROW_BAND_CSS);
		if (tapped !== null)
			resizeAreaStart = Math.max(start, end - tapped);

		return position > resizeAreaStart;
	}

	/*
	 * D3 (round 12) / VO-P-0005 (round 15). Where the row's resize badge sits,
	 * in canvas px, or null when this row is too short to carry one.
	 *
	 * It STRADDLES the boundary it resizes -- that is the y -- and it does not
	 * share the row number's x. Round 11 centred it at size[0] / 2, which is
	 * exactly where drawHeaderEntry centres the digits, so a 15 CSS px disc
	 * landed on top of the number in a 32 CSS px gutter.
	 *
	 * 🔴 ROUND 12 THEN SAT IT TANGENT TO THE INNER EDGE, EXPLICITLY TO KEEP IT
	 * OFF THE GRID -- and M-0012 §2 measures the reference doing the opposite.
	 * "row: (gutter's right rule, row's bottom rule) -> centre (137.5,
	 * 1146.5)" against a gutter running 0-138: the disc is centred ON the
	 * rule and overhangs 22 device px into column A. That is the same rule
	 * the column obeys ("the header's INNER edge"), and it is what makes the
	 * mark point at the whole of its own target instead of half of it.
	 *
	 * Round 12's worry was real but its premise was wrong: canvas sections
	 * are not clipped, which is precisely why the overhang WORKS. Every
	 * section is repainted in drawingOrder on every frame
	 * (CanvasSectionContainer.drawSections), and RowHeader is 140 against
	 * Tiles' 50, so the half over column A is painted after the grid, not
	 * erased by it.
	 *
	 * The floor is C8's: VULCAN_MIN_GRIP_ROW_CSS, not the desktop
	 * `2 * resizeHandleSize`, which no phone row has ever cleared.
	 */
	protected _vulcanBadgeCentre(entry: HeaderEntryData): number[] | null {
		if (!entry || entry.size <= VULCAN_MIN_GRIP_ROW_CSS * app.dpiScale)
			return null;
		return [this.size[0], entry.pos];
	}

	drawHeaderEntry (entry: HeaderEntryData): void {
		if (!entry)
			return;

		const content = entry.index + 1;
		const startY = entry.pos - entry.size;

		if (entry.size <= 0)
			return;

		const highlight = entry.isCurrent || entry.isHighlighted;

		// background gradient
		let selectionBackgroundGradient = null;
		if (highlight) {
			selectionBackgroundGradient = this.context.createLinearGradient(0, startY, 0, startY + entry.size);
			selectionBackgroundGradient.addColorStop(0, this._selectionBackgroundGradient[0]);
			selectionBackgroundGradient.addColorStop(0.5, this._selectionBackgroundGradient[1]);
			selectionBackgroundGradient.addColorStop(1, this._selectionBackgroundGradient[2]);
		}

		// draw background
		this.context.beginPath();
		this.context.fillStyle = highlight ? selectionBackgroundGradient : entry.isOver ? this._hoverColor : this._backgroundColor;
		this.context.fillRect(0, startY, this.size[0], entry.size);

		// draw resize handle
		const handleSize = this.resizeHandleSize;
		// D3 (round 12): the phone's badge is an OVERLAY now, painted after
		// every entry's background by Header.drawVulcanBadgeIfNeeded -- the
		// next row's fillRect was erasing its lower half. Substitute
		// phone = false and the expression below is the one that shipped, the
		// stock bars on the stock `2 * handleSize` floor.
		if (!this._isVulcanPhoneHeader()
			&& this._shouldDrawResizeGrip(entry) && entry.size > 2 * handleSize && !this.inResize()) {
			const center = startY + entry.size - handleSize / 2;
			const x = 2 * app.dpiScale;
			const w = this.size[0] - 4 * app.dpiScale;
			const size = 2 * app.dpiScale;
			const offsetOnePixel = 1 * app.dpiScale;

			this.context.fillStyle = this._resizeGripColor();
			this.context.beginPath();
			this.context.fillRect(x + 2 * app.dpiScale, center - size - offsetOnePixel, w - 4 * app.dpiScale, size);
			this.context.beginPath();
			this.context.fillRect(x + 2 * app.dpiScale, center + offsetOnePixel, w - 4 * app.dpiScale, size);
		}

		// draw text content
		//
		// D3: the number is fitted to the row it names -- to the row's HEIGHT,
		// which is what collides at deep zoom, and to the gutter's WIDTH,
		// which is what a five-digit row number overflowed straight through
		// the border into column A. When the badge is up it takes the trailing
		// disc's width of the gutter and the number re-centres in the rest;
		// substitute a hidden badge and `band` is `this.size[0]` and every
		// expression below is the shipped one.
		const label = content.toString();
		const band = this.size[0] - (this._vulcanBadgeShowing(entry)
			? Header.vulcanBadgeDiameterCSS * app.dpiScale : 0);
		const font = this._vulcanLabelFont(
			entry, label, this._vulcanLabelPitch(entry) / app.dpiScale, band / app.dpiScale);
		if (font !== null) {
			this.context.fillStyle = highlight ? this._selectionTextColor : this._textColor;
			this.context.font = font;
			this.context.textAlign = 'center';
			this.context.textBaseline = 'middle';
			this.context.fillText(label, band / 2, entry.pos - (entry.size / 2) + app.roundedDpiScale);
		}

		// draw row borders.
		this.context.strokeStyle = this._borderColor;
		const offset = this.getLineOffset();
		this.context.lineWidth = this.getLineWidth();
		this.context.strokeRect(offset, startY - offset, this.size[0], entry.size);
	}

	getHeaderEntryBoundingClientRect (index: number): Partial<DOMRect> {
		let entry = this._mouseOverEntry;

		if (index !== undefined && index !== null)
			entry = this._headerInfo.getRowData(index);

		if (!entry)
			return;

		const rect = this.containerObject.getCanvasBoundingClientRect();

		const rowStart = (entry.pos - entry.size) / app.dpiScale;
		const rowEnd = entry.pos / app.dpiScale;

		const left = rect.left;
		const right = rect.right;
		const top = rect.top + rowStart;
		const bottom = rect.top + rowEnd;
		return {left: left, right: right, top: top, bottom: bottom};
	}

	onClick (point: cool.SimplePoint, e: MouseEvent): void {
		if (!this._mouseOverEntry)
			return;

		// VO-P-0004: onMouseUp already selected for THIS gesture (the phone
		// still-tap fallback), and this is the browser's compatibility click
		// for the same finger. Running it again posts a second
		// .uno:SelectRow and raises the pill twice.
		//
		// Substitute false -- which is what the latch is off the phone chrome,
		// where nothing ever sets it -- and this is the shipped body: desktop
		// and tablet still ride the click, which on those devices is the only
		// route a motionless press has.
		if (this._vulcanTapConsumed && this._isVulcanPhoneHeader())
			return;

		// Phone: landing zone, not a trigger -- see the twin in ColumnHeader.
		// The row band is worse than the column's: it is the bottom 25% of
		// every row header, not a fixed 15px.
		if (this._hitResizeArea && !this._isVulcanPhoneHeader())
			return;

		const row = this._mouseOverEntry.index;

		let modifier = 0;
		if (e.shiftKey) {
			modifier += app.UNOModifier.SHIFT;
		}
		if (e.ctrlKey) {
			modifier += app.UNOModifier.CTRL;
		}

		this._selectRow(row, modifier);
		this._onVulcanHeaderTap(row);
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	_onDialogResult (e: any): void {
		if (e.type === 'submit' && !isNaN(e.value)) {
			const extra = {
				aExtraHeight: {
					type: 'unsigned short',
					value: e.value
				}
			};

			this._map.sendUnoCommand('.uno:SetOptimalRowHeight', extra);
		}
	}

	onDragEnd (dragDistance: number[]): void {
		if (dragDistance[1] === 0)
			return;

		let height = this._dragEntry.size;
		let row = this._dragEntry.index;

		const nextRow = this._headerInfo.getNextIndex(this._dragEntry.index);
		if (this._headerInfo.isZeroSize(nextRow)) {
			row = nextRow;
			height = 0;
		}

		height += dragDistance[1];
		height /= app.dpiScale;
		height = this._map._docLayer._pixelsToTwips({x: 0, y: height}).y;

		const command = {
			RowHeight: {
				type: 'unsigned short',
				value: this._map._docLayer.twipsToHMM(Math.max(height, 0))
			},
			Row: {
				type: 'long',
				value: row + 1 // core expects 1-based index.
			}
		};

		this._map.sendUnoCommand('.uno:RowHeight', command);
		this._mouseOverEntry = null;
	}

	onMouseUp(): void {
		super.onMouseUp();

		if (!(this.containerObject.isDraggingSomething() && this._dragEntry)) {
			this._lastSelectedIndex = null;
			this._startSelectionEntry = null;
		}
	}

	setOptimalHeightAuto(): void {
		if (this._mouseOverEntry) {
			const extra = {
				aExtraHeight: {
					type: 'unsigned short',
					value: 0
				}
			};

			this._map.sendUnoCommand('.uno:SetOptimalRowHeight', extra);
		}
	}

	_getParallelPos (point: cool.Point): number {
		return point.y;
	}

	_getOrthogonalPos (point: cool.Point): number {
		return point.x;
	}

	selectIndex(index: number, modifier: number): void {
		this._selectRow(index, modifier);
	}
}

}

app.definitions.rowHeader = cool.RowHeader;
