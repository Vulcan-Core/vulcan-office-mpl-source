// @ts-strict-ignore

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
	This class is only for rendering the selected text from all views.
*/
class TextSelectionSection extends CanvasSectionObject {
	interactable = false;
	processingOrder = app.CSections.TextSelection.processingOrder;
	drawingOrder = app.CSections.TextSelection.drawingOrder;
	zIndex = app.CSections.TextSelection.zIndex;
	documentObject: boolean = true;

	/*
		There are questions like: Can a view have a selection in a part other than its currently selected part?
		New view layouts can allow multiple parts to be drawn at the same time.
		Unfortunately, we need to keep the selection's part and mode separate from the view.
		The behaviour between selections of a specific view:
			* Behaviour should be decided based on what the app is capable (remove one selection when other is initiated or keep them all etc).
			* Selections data (not the socket message, its data) should be handled in the DocumentViewBase class.
	*/
	private mode: number;
	private part: number;
	public color: string;
	private polygons: Array<Array<cool.SimplePoint>> = [[]];

	/*
		The wash alpha, split by surface.

		On a phone the Calc range is the loudest thing in a selection that
		also carries a cursor ring and two corner squares, and it is the one
		mark with nothing to say: the cells under it are what the user is
		reading. The reference sheets app's own #e8f0fe range fill measures
		1.15:1 on white; ours at 0.25 measures 1.42:1 (the pair is recorded in
		css/vulcan-theme.css, 13-CALC.7). 0.13 lands on that app's side of the
		measurement without dropping the range below noticing.

		Calc only -- the Calc branch is the one with no stroke to carry the
		shape (see the fill loop) -- and phone only, so desktop and tablet
		keep 0.25 byte for byte.

		PHONE WRITER KEEPS 0.25 ON PURPOSE, and its own §13-WRITER.7 records
		why: the reference docs app's measured range tint #CACFDC is that
		app's own navy #2A4174 laid over white paper at exactly 0.25
		(0.25x42 + 0.75x255 = 201.75 = 0xCA, and the same arithmetic on the
		other two channels). The alpha was never the divergence there -- the
		ink was, and the stroke below. So Writer changes neither number in
		this file; it drops the stroke, and 13-WRITER.7 re-points its ink.
	*/
	private static readonly phoneCalcAlpha: number = 0.13;
	private static readonly stockAlpha: number = 0.25;

	/*
		Both halves, for the reason the gate registry exists:
		?vulcanChrome=desktop on a real handset leaves the screen test true and
		the class absent, and every phone rule this tone belongs to is scoped
		on the class (js/global.js stamps it iff !desktopChrome &&
		mode.isSmallScreenDevice()).

		Answered once and kept, but on the first PAINT rather than at
		construction: these sections are built per view as the document view
		is assembled, and the phone decision is boot-immutable and stamped
		before anything paints, so the first draw is the earliest moment
		guaranteed to see it. onDraw itself must stay free of DOM reads --
		it runs per frame.
	*/
	private vulcanPhoneWash: boolean | null = null;

	private isPhoneWash(): boolean {
		if (this.vulcanPhoneWash === null)
			this.vulcanPhoneWash =
				!!window.mode.isSmallScreenDevice() &&
				document.documentElement.classList.contains(
					'vulcan-mobile-chrome',
				);
		return this.vulcanPhoneWash;
	}

	constructor(name: string, mode: number, part: number, color: string) {
		super(name);
		this.part = part;
		this.mode = mode;
		this.color = color;
	}

	public setSelectionInfo(
		mode: number,
		part: number,
		polygons: Array<Array<cool.SimplePoint>>,
	) {
		this.mode = mode;
		this.part = part;
		this.polygons = polygons;
	}

	onDraw(frameCount?: number, elapsedTime?: number): void {
		Util.ensureValue(app.activeDocument);
		Util.ensureValue(app.calc.splitCoordinate);

		// Remove when visibility checks are done in layout views (on simple point instances).
		if (
			!app.activeDocument.isModeActive(this.mode) ||
			this.part !== app.map._docLayer._selectedPart ||
			this.polygons.length === 0
		)
			return;

		this.context.translate(-this.myTopLeft[0], -this.myTopLeft[1]);

		this.context.globalAlpha =
			this.isPhoneWash() && app.map._docLayer.isCalc()
				? TextSelectionSection.phoneCalcAlpha
				: TextSelectionSection.stockAlpha;
		this.context.strokeStyle = this.color;
		this.context.fillStyle = this.color;

		for (let i = 0; i < this.polygons.length; i++) {
			const polygon = this.polygons[i];

			this.context.beginPath();

			for (let j = 0; j < polygon.length; j++) {
				const point = polygon[j].clone();

				if (j === 0) this.context.moveTo(point.vX, point.vY);
				else this.context.lineTo(point.vX, point.vY);
			}

			this.context.closePath();
			// TWO SURFACES DROP THE STROKE, for two different reasons.
			//
			// CALC, everywhere. The selection has to line up with the cell
			// grid. The 1px stroke is centred on the polygon edge, so its outer
			// half is painted just outside the boundary and shows up as a faint
			// band one pixel past the right and bottom grid lines. The fill
			// already covers the selected cells exactly.
			//
			// WRITER, on phone chrome only. The stroke carries the same alpha
			// as the fill and lands ON it, so the run's edge composites to
			// 1 - (1 - 0.25)^2 = 0.4375: a 1.38:1 rim around a 1.21:1 field,
			// half a pixel wider than the run on every side. The reference docs
			// app paints ONE flat field, hugging the run, with no rim at all,
			// and that is the mark this surface is measured against (the wash
			// numbers are in css/vulcan-theme.css, 13-WRITER.7). Desktop and
			// tablet Writer keep the stroke: the rim is what distinguishes
			// overlapping collaborator ranges at mouse distances, and neither
			// surface is being measured against a phone app.
			const flatWash =
				app.map._docLayer.isCalc() ||
				(this.isPhoneWash() && app.map._docLayer.isWriter());
			if (!flatWash) this.context.stroke();
			this.context.fill();
		}

		this.context.globalAlpha = 1.0;

		// We are done. Set the pen back to its initial position. This is needed or all other sections can draw at unexpected coordinates.
		this.context.translate(this.myTopLeft[0], this.myTopLeft[1]);
	}
}
