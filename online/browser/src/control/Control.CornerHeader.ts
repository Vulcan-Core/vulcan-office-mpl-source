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
	Calc only.
*/

/* global $ app */

namespace cool {

export class CornerHeader extends CanvasSectionObject {
	anchor: any = [[app.CSections.ColumnGroup.name, 'bottom', 'top'], [app.CSections.RowGroup.name, 'right', 'left']];
	// Height MUST track ColumnHeader's -- see Header.columnHeaderHeight().
	// RowHeader anchors to this section's bottom while TilesSection anchors to
	// ColumnHeader's, so a mismatch offsets every row label from its row.
	// Width MUST track RowHeader's -- see Header.rowHeaderWidth(). TilesSection
	// anchors its left to RowHeader's right while ColumnHeader anchors its left
	// to this section's right, so a mismatch offsets every column label from
	// its column.
	size: number[] = [Header.rowHeaderWidth(), Header.columnHeaderHeight()];
	processingOrder: number = app.CSections.CornerHeader.processingOrder;
	drawingOrder: number = app.CSections.CornerHeader.drawingOrder;
	zIndex: number = app.CSections.CornerHeader.zIndex;
	sectionProperties: any = { cursor: 'pointer' }

	_map: any;
	_textColor: string;

	constructor() { super(app.CSections.CornerHeader.name); }

	onInitialize():void {
		this._map = window.L.Map.THIS;

		this._map.on('darkmodechanged', this._initCornerHeaderStyle, this);
		this._initCornerHeaderStyle();
	}

	onClick(): void {
		selectAllAndRestoreFocus(this._map);
	}

	onMouseEnter(): void {
		this.containerObject.getCanvasStyle().cursor = this.sectionProperties.cursor;
	}

	onMouseLeave(): void {
		this.containerObject.getCanvasStyle().cursor = 'default';
	}

	_initCornerHeaderStyle(): void {
		const baseElem = document.getElementsByTagName('body')[0];
		const elem = window.L.DomUtil.create('div', 'spreadsheet-header-row', baseElem);
		this._textColor = window.L.DomUtil.getStyle(elem, 'color');
		this.backgroundColor = window.L.DomUtil.getStyle(elem, 'background-color'); // This is a section property.
		this.borderColor = window.L.DomUtil.getStyle(elem, 'border-top-color'); // This is a section property.
		window.L.DomUtil.remove(elem);
	}
}

}
