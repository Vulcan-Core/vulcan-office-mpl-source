/*
 * Copyright the Collabora Online contributors.
 *
 * SPDX-License-Identifier: MPL-2.0
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

class CellSelectionMarkers {
	static start: CellSelectionHandle;
	static end: CellSelectionHandle;

	// Round-11 C2: the two new corners and the four edge bands, phone only.
	// Keyed by section name so the update loop below can stay a loop.
	private static grips: { [name: string]: CellSelectionHandle } = {};
	private static initiated: boolean = false;

	public static initiate() {
		if (app.map._docLayer._docType !== 'spreadsheet')
			// Calc only.
			return;

		this.initiated = true;

		// Cell selection handles (mobile & tablet).
		this.start = new CellSelectionHandle('cell_selection_handle_start');
		this.end = new CellSelectionHandle('cell_selection_handle_end');
		app.sectionContainer.addSection(this.start);
		app.sectionContainer.addSection(this.end);

		// ROUND-11 C2 — the rest of the corner > edge > centre ladder, and phone
		// only. The two handles above are the tablet's whole vocabulary and a
		// tablet has a pointer that can aim at them; the ladder exists because a
		// fingertip cannot, and every band it adds is invisible. Adding six
		// silent hit regions to a surface that did not ask for them is the kind
		// of change that is only safe where it is the answer to a stated
		// problem.
		this.grips = {};
		if (
			!document.documentElement.classList.contains('vulcan-mobile-chrome')
		)
			return;

		const names = CellSelectionHandle.CORNER_NAMES.slice(2).concat(
			CellSelectionHandle.EDGE_NAMES,
		);
		for (const name of names) {
			const grip = new CellSelectionHandle(name);
			this.grips[name] = grip;
			app.sectionContainer.addSection(grip);
		}
	}

	public static update() {
		if (window.mode.isDesktop()) return; // Not shown on desktop.

		if (!this.initiated) return;

		var showMarkers =
			app.map._docLayer._cellSelectionArea || app.calc.cellCursorVisible;

		if (showMarkers) {
			this.start.setShowSection(true);
			this.end.setShowSection(true);

			Util.ensureValue(app.calc.cellCursorRectangle);
			var cellRectangle = app.map._docLayer._cellSelectionArea
				? app.map._docLayer._cellSelectionArea.clone()
				: app.calc.cellCursorRectangle.clone();

			const posStart = new cool.SimplePoint(cellRectangle.x1, cellRectangle.y1);
			const posEnd = new cool.SimplePoint(cellRectangle.x2, cellRectangle.y2);

			// Phone boxes anchor in the corner's outward quadrant so the cell
			// body stays pannable (tablet stays centred), sliding inward at a
			// document edge just enough to stay visible. The handle owns the
			// one clamped-offset computation its draw and drag math read.
			this.start.anchorToSelectionCorner(posStart.pX, posStart.pY);
			this.end.anchorToSelectionCorner(posEnd.pX, posEnd.pY);

			// ROUND-12 D6-b: the six grips that carry no art exist only for a
			// BANDBOX selection — a dragged-out rectangle, which is the case
			// The designer states the corner > edge > centre ladder about. On a bare
			// cell cursor they were 4,612 CSS px² of invisible drag capture
			// over the neighbouring cells, and a pan that began there moved and
			// widened the selection instead of scrolling the sheet. The two
			// DRAWN handles are unconditional, exactly as they have always
			// been. See CellSelectionHandle.undrawnGripsApply for the three
			// candidate fixes this was chosen over.
			const bandbox = CellSelectionHandle.undrawnGripsApply(
				app.map._docLayer._cellSelectionArea,
			);

			// The two new corners take the other diagonal of the same rectangle;
			// each edge band decides for itself whether the side it runs along
			// is long enough to leave anything over between the corners.
			this.eachGrip('cell_selection_handle_topright', (grip) => {
				grip.setShowSection(bandbox);
				if (bandbox) grip.anchorToSelectionCorner(posEnd.pX, posStart.pY);
			});
			this.eachGrip('cell_selection_handle_bottomleft', (grip) => {
				grip.setShowSection(bandbox);
				if (bandbox) grip.anchorToSelectionCorner(posStart.pX, posEnd.pY);
			});
			for (const name of CellSelectionHandle.EDGE_NAMES)
				this.eachGrip(name, (grip) => {
					if (!bandbox) {
						grip.setShowSection(false);
						return;
					}
					grip.anchorToSelectionEdge(
						posStart.pX,
						posStart.pY,
						posEnd.pX,
						posEnd.pY,
					);
				});
		} else {
			this.start.setShowSection(false);
			this.end.setShowSection(false);
			for (const name in this.grips)
				this.grips[name].setShowSection(false);
		}
	}

	// Inert off the phone, where `grips` is empty by construction.
	private static eachGrip(
		name: string,
		apply: (grip: CellSelectionHandle) => void,
	): void {
		const grip = this.grips[name];
		if (grip) apply(grip);
	}
}
