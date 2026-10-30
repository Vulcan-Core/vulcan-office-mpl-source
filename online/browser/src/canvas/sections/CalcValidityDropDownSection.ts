/* global Proxy _ */
/*
 * Copyright the Collabora Online contributors.
 *
 * SPDX-License-Identifier: MPL-2.0
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
*/

class CalcValidityDropDown extends HTMLObjectSection {
	public static dropDownArrowSize = 16; // Size of the validity drop-down arrow in CSS pixels.

	/*
	 * The finger floor the rest of this phone chrome is built to (vulcan-theme.css
	 * §13.4 back control, §13.5 sheet rows, .spreadsheet-tab). 16 is 36% of it on
	 * both axes, and this control is the ONLY way into a validity list on a phone.
	 */
	public static phoneTouchTargetSize = 44;

	zIndex: number = app.CSections.CalcValidityDropDown.zIndex;

	constructor (documentPosition: cool.SimplePoint, visible: boolean = true) {
		super(app.CSections.CalcValidityDropDown.name, CalcValidityDropDown.dropDownArrowSize, CalcValidityDropDown.dropDownArrowSize, documentPosition, 'spreadsheet-drop-down-marker', visible);

		this.sectionProperties.mouseEntered = false;
	}

	/*
	 * GROW THE HIT BOX, DRAW NOTHING DIFFERENT.
	 *
	 * `isHit` is the base class's declared hook for exactly this ("Allow locally
	 * to influence if this object is hit by the given point",
	 * CanvasSectionObject.ts). Taking it here means `size`, `position` and the
	 * marker <div> are all untouched, so not one drawn pixel moves -- which
	 * matters because the marker's PLACEMENT is currently correct and only its
	 * target is too small. Widening `size` instead would have grown the div
	 * (HTMLObjectSection writes objectWidth/objectHeight as inline styles) and
	 * dragged the glyph off the cell corner.
	 *
	 * IT GROWS UP AND LEFT, AND NEVER PAST THE CELL. The marker is anchored at
	 * the bottom-right corner of the validated cell (CanvasTileLayer
	 * _addCellDropDownArrow), so growing towards the cell's interior is the only
	 * direction that cannot steal a tap from a NEIGHBOURING cell. The growth is
	 * then clamped to the cell cursor's own width/height, so on a row shorter
	 * than 44px the box stops at the cell edge rather than reaching into the row
	 * above. A user who taps inside the selected cell's bottom-right corner has
	 * already selected that cell; a user who taps the cell next door still gets
	 * the cell next door.
	 *
	 * RTL mirrors the stock `addition` term, which is how the base class already
	 * expresses "this document object is laid out from the right".
	 *
	 * Phone chrome only: on desktop and tablet super.isHit() is returned
	 * unchanged, so a mouse keeps the precise 16px target it has today.
	 */
	public isHit(point: number[]): boolean {
		if (super.isHit(point)) return true;

		if (!document.documentElement.classList.contains('vulcan-mobile-chrome'))
			return false;

		const target = CalcValidityDropDown.phoneTouchTargetSize * app.dpiScale;
		let growX = Math.max(0, target - this.size[0]);
		let growY = Math.max(0, target - this.size[1]);

		const cell = app.calc ? app.calc.cellCursorRectangle : null;
		if (cell) {
			growX = Math.min(growX, Math.max(0, cell.pWidth - this.size[0]));
			growY = Math.min(growY, Math.max(0, cell.pHeight - this.size[1]));
		}

		const rtl = app.map._docLayer.isCalcRTL();
		const addition = rtl ? -this.size[0] : 0;
		const x1 = this.myTopLeft[0] + addition - (rtl ? 0 : growX);
		const x2 = this.myTopLeft[0] + addition + this.size[0] + (rtl ? growX : 0);
		const y1 = this.myTopLeft[1] - growY;
		const y2 = this.myTopLeft[1] + this.size[1];

		return point[0] >= x1 && point[0] <= x2 && point[1] >= y1 && point[1] <= y2;
	}

	public onMouseEnter(point: cool.SimplePoint, e: MouseEvent): void {
		this.sectionProperties.mouseEntered = true;
	}

	public onMouseLeave() {
		this.sectionProperties.mouseEntered = false;
	}

	public onClick(point: cool.SimplePoint, e: MouseEvent): void {
		e.stopPropagation();
		e.preventDefault();
		this.stopPropagating();

		const _validatedCellAddress = (app.map._docLayer as { _validatedCellAddress?: null | cool.SimplePoint })._validatedCellAddress;
		if (_validatedCellAddress && app.calc.cellCursorVisible && _validatedCellAddress.equals(app.calc.cellAddress?.toArray() ?? [])) {
			app.map.sendUnoCommand('.uno:DataSelect');
		}
	}
}
