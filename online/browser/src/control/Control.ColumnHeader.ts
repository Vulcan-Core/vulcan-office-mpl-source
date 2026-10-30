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
 * Control.ColumnHeader
 */

/* global _UNO app */
namespace cool {

/*
 * C6a / VO-P-0005. The anchored column's resize band no longer carries a
 * literal of its own.
 *
 * Round 10 chose 23 CSS px by feel ("a finger pad's width"). M-0012 §4
 * measured it: the reference resizes at edge ± 60 device px and not at ± 65,
 * i.e. a band ≈124 device px (≈41 CSS px) CENTRED on the edge. So the near
 * side is the same half-band as the far side and both now read
 * `Header.vulcanGrabHalfBandCSS` at their use sites -- a band whose two
 * halves are separate literals is a band that goes off-centre the next time
 * one of them is tuned.
 */

export class ColumnHeader extends Header {
	anchor: Array<Array<string>> = [[app.CSections.ColumnGroup.name, 'bottom', 'top'], [app.CSections.CornerHeader.name, 'right', 'left']];
	position: number[] = [0, 0]; // This section's myTopLeft is placed according to corner header and column group sections.
	// Height MUST track CornerHeader's -- see Header.columnHeaderHeight().
	size: number[] = [0, Header.columnHeaderHeight()]; // No initial width is necessary.
	expand: Array<string> = ['right']; // Expand horizontally.
	processingOrder: number = app.CSections.ColumnHeader.processingOrder;
	drawingOrder: number = app.CSections.ColumnHeader.drawingOrder;
	zIndex: number = app.CSections.ColumnHeader.zIndex;
	cursor: string = 'col-resize';

	_current: number;
	_selection: SelectionRange;

	constructor(cursor?: string) {
		super(app.CSections.ColumnHeader.name);

		if (cursor)
			this.cursor = cursor;
	}

	onInitialize(): void {
		this._map = window.L.Map.THIS;
		this._isColumn = true;
		this._current = -1;
		this.resizeHandleSize = 15 * app.dpiScale;
		this._selection = {start: -1, end: -1};
		this._mouseOverEntry = null;
		this._lastMouseOverIndex = undefined;
		this._hitResizeArea = false;
		this.sectionProperties.docLayer = this._map._docLayer;

		super.onInitialize();

		this._headerMenuID = 'col-header-menu';
		// `name` is the DESKTOP context menu's markup and `text` is the plain
		// label the phone bottom sheet shows (G29 — the wizard writes labels
		// with textContent, so the markup used to render verbatim). The desktop
		// dropdown derives its own text from _UNO(command) and reads neither.
		this._menuItem = {
			'.uno:InsertColumnsBefore': {
				name: app.IconUtil.createMenuItemLink(_UNO('.uno:InsertColumnsBefore', 'spreadsheet', true), 'InsertColumnsBefore'),
				isHtmlName: true,
				text: _UNO('.uno:InsertColumnsBefore', 'spreadsheet', true),
				callback: (this._insertColBefore).bind(this)
			},
			'.uno:InsertColumnsAfter': {
				name: app.IconUtil.createMenuItemLink(_UNO('.uno:InsertColumnsAfter', 'spreadsheet', true), 'InsertColumnsAfter'),
				isHtmlName: true,
				text: _UNO('.uno:InsertColumnsAfter', 'spreadsheet', true),
				callback: (this._insertColAfter).bind(this)
			},
			'.uno:DeleteColumns': {
				name: app.IconUtil.createMenuItemLink(_UNO('.uno:DeleteColumns', 'spreadsheet', true), 'DeleteColumns'),
				isHtmlName: true,
				text: _UNO('.uno:DeleteColumns', 'spreadsheet', true),
				callback: (this._deleteSelectedCol).bind(this)
			},
			'.uno:ColumnWidth': {
				name: app.IconUtil.createMenuItemLink(_UNO('.uno:ColumnWidth', 'spreadsheet', true), 'ColumnWidth'),
				isHtmlName: true,
				text: _UNO('.uno:ColumnWidth', 'spreadsheet', true),
				callback: (this._columnWidth).bind(this)
			},
			'.uno:SetOptimalColumnWidth': {
				name: app.IconUtil.createMenuItemLink(_UNO('.uno:SetOptimalColumnWidth', 'spreadsheet', true), 'SetOptimalColumnWidth'),
				isHtmlName: true,
				text: _UNO('.uno:SetOptimalColumnWidth', 'spreadsheet', true),
				callback: (this._optimalWidth).bind(this)
			},
			'.uno:HideColumn': {
				name: app.IconUtil.createMenuItemLink(_UNO('.uno:HideColumn', 'spreadsheet', true), 'HideColumn'),
				isHtmlName: true,
				text: _UNO('.uno:HideColumn', 'spreadsheet', true),
				callback: (this._hideColumn).bind(this)
			},
			'.uno:ShowColumn': {
				name: app.IconUtil.createMenuItemLink(_UNO('.uno:ShowColumn', 'spreadsheet', true), 'ShowColumn'),
				isHtmlName: true,
				text: _UNO('.uno:ShowColumn', 'spreadsheet', true),
				callback: (this._showColumn).bind(this)
			},
			'.uno:FreezePanes': {
				name: app.IconUtil.createMenuItemLink(_UNO('.uno:FreezePanes', 'spreadsheet', true), 'FreezePanes'),
				isHtmlName: true,
				text: _UNO('.uno:FreezePanes', 'spreadsheet', true),
				callback: (this._freezePanes).bind(this)
			}
		};

		this._menuData = window.L.Control.JSDialogBuilder.getMenuStructureForMobileWizard(this._menuItem, true, '');
		this._headerInfo = new cool.HeaderInfo(this._map, true /* isCol */);
	}

	isMouseOverResizeArea(start: number, end:number, position: number, entryIsCurrent: boolean, entry?: HeaderEntryData) : boolean {
		const isRTL = this.isCalcRTL();
		// NOTE: From a geometric perspective resizeAreaStart is really "resizeAreaEnd" in RTL case.
		let resizeAreaStart = isRTL ? Math.min(start + this.borderResizeHandle * app.dpiScale, end) : Math.max(start, end - this.borderResizeHandle * app.dpiScale);
		if (entryIsCurrent || (window as any).mode.isSmallScreenDevice()) {
			resizeAreaStart = isRTL ? start + this.resizeHandleSize : end - this.resizeHandleSize;
		}
		// C6a / VO-P-0005. The ANCHORED column's own band, and only its own --
		// every other entry keeps the expression above untouched, which is
		// M-0012 §4's "the column edge is NOT a resize target away from the
		// disc" in the shape this fork can carry it: the widened band follows
		// the mark, never the rule.
		const tapped = this._vulcanTappedResizeBand(entry, Header.vulcanGrabHalfBandCSS);
		if (tapped !== null) {
			resizeAreaStart = isRTL
				? Math.min(start + tapped, end)
				: Math.max(start, end - tapped);
		}
		return isRTL ? (position < resizeAreaStart) : (position > resizeAreaStart);
	}

	/*
	 * D3 (round 12) / VO-P-0005 (round 15). Where the column's resize badge
	 * sits, in canvas px, or null when the column is too narrow to carry one.
	 *
	 * X is unchanged from round 11 -- it straddles the trailing edge, because
	 * the hit band straddles it too and a mark inset off the line points at
	 * half its own target. Round 12 moved WHEN it is painted:
	 * Header.drawVulcanBadgeIfNeeded runs it after the entry loop, so the
	 * next column's background no longer erases the half of it that lies on
	 * the far side of the boundary.
	 *
	 * 🔴 Y MOVED IN ROUND 15, AND IT IS A MEASUREMENT. M-0012 §2: the disc is
	 * "centred on the intersection of the selection's trailing edge and the
	 * header's INNER edge -- column: (column's right rule, header band's
	 * bottom rule)", reference centre (743.5, 408.5) in a band running
	 * 337-409. Ours sat at `size[1] / 2`, the band's middle, which is half a
	 * disc up from the corner the two rules make.
	 *
	 * That puts half the disc over the grid, exactly as the reference does
	 * (its own disc overhangs 22 device px past the band). Canvas sections
	 * are not clipped, and CanvasSectionContainer.drawSections repaints every
	 * section in drawingOrder on every frame -- ColumnHeader is 150 against
	 * Tiles' 50 -- so the overhang lands ON the grid rather than under it.
	 *
	 * The floor is the shipped one: M-0012's question 6 (what a hand-narrowed
	 * column does) was not answered by that capture, so the desktop-derived
	 * `2 * resizeHandleSize` stands rather than being tuned by taste.
	 */
	protected _vulcanBadgeCentre(entry: HeaderEntryData): number[] | null {
		if (!entry || entry.size <= 2 * this.resizeHandleSize)
			return null;
		const isRTL = this.isCalcRTL();
		const startX = isRTL ? this.size[0] - entry.pos : entry.pos - entry.size;
		return [isRTL ? startX : startX + entry.size, this.size[1]];
	}

	drawHeaderEntry (entry: HeaderEntryData): void {
		if (!entry)
			return;

		const isRTL = this.isCalcRTL();
		const content = this._colIndexToAlpha(entry.index + 1);
		const startX = isRTL ? this.size[0] - entry.pos : entry.pos - entry.size;

		if (entry.size <= 0)
			return;

		const highlight = entry.isCurrent || entry.isHighlighted;

		// background gradient
		let selectionBackgroundGradient = null;
		if (highlight) {
			selectionBackgroundGradient = this.context.createLinearGradient(startX, 0, startX, this.size[1]);
			selectionBackgroundGradient.addColorStop(0, this._selectionBackgroundGradient[0]);
			selectionBackgroundGradient.addColorStop(0.5, this._selectionBackgroundGradient[1]);
			selectionBackgroundGradient.addColorStop(1, this._selectionBackgroundGradient[2]);
		}

		// draw background
		this.context.beginPath();
		this.context.fillStyle = highlight ? selectionBackgroundGradient : entry.isOver ? this._hoverColor : this._backgroundColor;
		this.context.fillRect(startX, 0, entry.size, this.size[1]);

		// draw resize handle
		const handleSize = this.resizeHandleSize;
		// D3 (round 12): the phone's badge is an OVERLAY now, painted after
		// every entry's background by Header.drawVulcanBadgeIfNeeded -- the
		// next column's fillRect was erasing its trailing half. Substitute
		// phone = false and the block below is the one that shipped, untouched.
		if (!this._isVulcanPhoneHeader()
			&& this._shouldDrawResizeGrip(entry) && entry.size > 2 * handleSize && !this.inResize()) {
			const center = isRTL ? startX + handleSize / 2 : startX + entry.size - handleSize / 2;
			const y = 2 * app.dpiScale;
			const h = this.size[1] - 4 * app.dpiScale;
			const size = 2 * app.dpiScale;
			const offset = 1 * app.dpiScale;

			this.context.fillStyle = this._resizeGripColor();
			this.context.beginPath();
			this.context.fillRect(center - size - offset, y + 2 * app.dpiScale, size, h - 4 * app.dpiScale);
			this.context.beginPath();
			this.context.fillRect(center + offset, y + 2 * app.dpiScale, size, h - 4 * app.dpiScale);
		}

		// draw text content
		//
		// D3: the letter is fitted to the column it names -- to the column's
		// own WIDTH, which is what a hand-narrowed column takes away, and to
		// the band's HEIGHT. The badge eats the trailing half-disc of this
		// column, so the letter is given a symmetric pair of half-discs to
		// stay centred where it has always been; with no badge up `usable` is
		// `entry.size` and every expression below is the shipped one.
		const usable = this._vulcanLabelPitch(entry) - (this._vulcanBadgeShowing(entry)
			? Header.vulcanBadgeDiameterCSS * app.dpiScale : 0);
		const font = this._vulcanLabelFont(
			entry, content, usable / app.dpiScale, this.size[1] / app.dpiScale);
		if (font !== null) {
			this.context.fillStyle = highlight ? this._selectionTextColor : this._textColor;
			this.context.font = font;
			this.context.textAlign = 'center';
			this.context.textBaseline = 'middle';
			// The '+ 1' below is a hack - it's currently not possible to measure
			// the exact bounding box in html5's canvas, and the textBaseline
			// 'middle' measures everything including the descent etc.
			// '+ 1' looks visually fine, and seems safe enough
			this.context.fillText(content,
				isRTL ? startX + (entry.size / 2) : entry.pos - (entry.size / 2),
				(this.size[1] / 2) + 1);
		}

		// draw column borders.
		this.context.strokeStyle = this._borderColor;
		var offset = this.getLineOffset();
		this.context.lineWidth = this.getLineWidth();
		this.context.strokeRect(startX - offset, offset, entry.size, this.size[1]);
	}

	getHeaderEntryBoundingClientRect (index: number): Partial<DOMRect> {
		let entry = this._mouseOverEntry;
		if (index !== undefined && index !== null) {
			entry = this._headerInfo.getColData(index);
		}

		if (!entry)
			return;

		const rect = this.containerObject.getCanvasBoundingClientRect();
		const colStart = (entry.pos - entry.size) / app.dpiScale;
		const colEnd = entry.pos / app.dpiScale;

		const isRTL = this.isCalcRTL();

		const left = isRTL ? rect.right - colEnd : rect.left + colStart;
		const right = isRTL ? rect.right - colStart : rect.left + colEnd;
		const top = rect.top;
		const bottom = rect.bottom;
		return {left: left, right: right, top: top, bottom: bottom};
	}

	onClick(point: cool.SimplePoint, e: MouseEvent): void {
		if (!this._mouseOverEntry)
			return;

		// VO-P-0004: the twin of RowHeader's guard, and it carries the same
		// reasoning -- onMouseUp served this gesture's tap, so the browser's
		// compatibility click for the same finger stands down rather than
		// posting a second .uno:SelectColumn and a second pill raise.
		// Substitute false and this is the shipped body.
		if (this._vulcanTapConsumed && this._isVulcanPhoneHeader())
			return;

		// Phone: the band is a landing zone, so a motionless tap inside it is
		// still a select -- the resize needs displacement (_isResizeArmed).
		// Without this, a tap in the trailing 15px of a column header could
		// never select the column: it either shipped a jitter-resize or, if
		// truly motionless, fell through here and did nothing at all.
		if (this._hitResizeArea && !this._isVulcanPhoneHeader())
			return;

		const col = this._mouseOverEntry.index;

		let modifier = 0;
		if (e.shiftKey) {
			modifier += app.UNOModifier.SHIFT;
		}
		if (e.ctrlKey) {
			modifier += app.UNOModifier.CTRL;
		}

		this._selectColumn(col, modifier);
		this._onVulcanHeaderTap(col);
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	_onDialogResult(e: any) {
		if (e.type === 'submit' && !isNaN(e.value)) {
			const extra = {
				aExtraWidth: {
					type: 'unsigned short',
					value: e.value
				}
			};

			this._map.sendUnoCommand('.uno:SetOptimalColumnWidth', extra);
		}
	}

	onDragEnd (dragDistance: number[]): number {
		if (dragDistance[0] === 0)
			return;

		let width = this._dragEntry.size;
		let column = this._dragEntry.index;

		const nextCol = this._headerInfo.getNextIndex(this._dragEntry.index);
		if (this._headerInfo.isZeroSize(nextCol)) {
			column = nextCol;
			width = 0;
		}

		const isRTL = this.isCalcRTL();

		if (isRTL) {
			width -= dragDistance[0];
		}
		else {
			width += dragDistance[0];
		}

		width /= app.dpiScale;
		width = this._map._docLayer._pixelsToTwips({x: width, y: 0}).x;

		const command = {
			ColumnWidth: {
				type: 'unsigned short',
				value: this._map._docLayer.twipsToHMM(Math.max(width, 0))
			},
			Column: {
				type: 'unsigned short',
				value: column + 1 // core expects 1-based index.
			}
		};

		this._map.sendUnoCommand('.uno:ColumnWidth', command);
		this._mouseOverEntry = null;
	}

	onMouseUp(): void {
		super.onMouseUp();

		if (!(this.containerObject.isDraggingSomething() && this._dragEntry)) {
			this._lastSelectedIndex = null;
			this._startSelectionEntry = null;
		}
	}

	setOptimalWidthAuto(): void {
		if (this._mouseOverEntry) {
			const extra = {
				aExtraWidth: {
					type: 'unsigned short',
					value: 200
				},
				Column: {
					type: 'unsigned short',
					value: this._mouseOverEntry.index + 1 // 1-based
				}
			};

			this._map.sendUnoCommand('.uno:SetOptimalColumnWidth', extra);
		}
	}

	_getParallelPos (point: cool.Point): number {
		return point.x;
	}

	_getOrthogonalPos (point: cool.Point): number {
		return point.y;
	}

	selectIndex(index: number, modifier: number): void {
		this._selectColumn(index, modifier);
	}
}

}

app.definitions.columnHeader = cool.ColumnHeader;
