/*
 * Copyright the Collabora Online contributors.
 *
 * SPDX-License-Identifier: MPL-2.0
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

class TextSelections {
	// Below 4 are used for text selection handles, which are visible where mouse pointer doesn't exist (search "pointer: fine" in css).
	private static start: TextSelectionHandle;
	private static end: TextSelectionHandle;
	private static startRectangle: cool.SimpleRectangle | null = null; // This is the rectangle sent from the core side.
	private static endRectangle: cool.SimpleRectangle | null = null; // This is the rectangle sent from the core side.

	private static active: boolean = false; // Is there a text selection or not.

	public static initiate() {
		// CSS px. On a phone these are bigger than the 30x44 art so the grab
		// box clears the finger floor; off-phone they ARE 30x44 and nothing
		// changes. TextSelectionHandleSection owns the split and the reason.
		const boxWidth = TextSelectionHandle.boxWidth();
		const boxHeight = TextSelectionHandle.boxHeight();

		this.start = new TextSelectionHandle(
			'selection_start_handle',
			boxWidth,
			boxHeight,
			new cool.SimplePoint(0, 0),
			'text-selection-handle-start',
			false,
		);
		this.end = new TextSelectionHandle(
			'selection_end_handle',
			boxWidth,
			boxHeight,
			new cool.SimplePoint(0, 0),
			'text-selection-handle-end',
			false,
		);

		app.sectionContainer.addSection(this.start);
		app.sectionContainer.addSection(this.end);
	}

	/*
		VULCAN: a Calc CELL RANGE is not a text selection.

		Core sends the same `textselection:` triple for a dragged cell range
		as for selected text, so both Writer teardrops -- 22 CSS px of art
		apiece -- land on the two corners of the range, on top of the ~4.5 px
		squares CellSelectionHandleSection already draws there. Editing IN a
		cell is the one Calc state where the teardrops do mark text, and
		app.file.textCursor.visible is the discriminator MouseControl already
		asks that question with (isVulcanTapAgain).

		Phone only: TextSelectionHandle.isPhoneChrome() is the same class test
		that gives these handles their phone geometry, so desktop and tablet
		keep every handle they had. It gates the HANDLES only -- the range
		wash is painted from the same message by TextSelectionSection, and
		nothing here touches _onTextSelectionMsg.
	*/
	private static isCellRangeSelection(): boolean {
		return (
			TextSelectionHandle.isPhoneChrome() &&
			app.map._docLayer.isCalc() &&
			!app.file.textCursor.visible
		);
	}

	public static deactivate() {
		if (!this.active) return;

		this.active = false;
		app.map.fire('textselectionchange', { active: this.active });
		this.start.setShowSection(false);
		this.end.setShowSection(false);

		// Schedule a redraw if there's not any.
		app.sectionContainer.requestReDraw();
	}

	public static activate() {
		if (this.active) return;

		this.active = true;
		app.map.fire('textselectionchange', { active: this.active });

		// The latch above is untouched on purpose: isActive() answers "is
		// there a selection", which MouseControl and the wash both read, and
		// only the SHOWING of the two handles is a Calc-range question.
		if (this.isCellRangeSelection()) return;

		if (this.startRectangle && this.endRectangle) {
			this.start.setShowSection(true);
			this.end.setShowSection(true);
			this.updateMarkers();
		}
	}

	public static isActive(): boolean {
		return this.active;
	}

	public static showHandles() {
		if (this.start.isSectionShown()) this.start.setOpacity(1);

		if (this.end.isSectionShown()) this.end.setOpacity(1);
	}

	public static hideHandles() {
		if (this.start.isSectionShown()) this.start.setOpacity(0);

		if (this.end.isSectionShown()) this.end.setOpacity(0);
	}

	public static getStartRectangle(): cool.SimpleRectangle | null {
		return this.startRectangle ? this.startRectangle.clone() : null;
	}

	public static getEndRectangle(): cool.SimpleRectangle | null {
		return this.endRectangle ? this.endRectangle.clone() : null;
	}

	public static setStartRectangle(rectangle: cool.SimpleRectangle) {
		this.startRectangle = rectangle;
		this.updateMarkers();
	}

	public static setEndRectangle(rectangle: cool.SimpleRectangle) {
		this.endRectangle = rectangle;
		this.updateMarkers();
	}

	private static updateMarkers() {
		if (!this.isActive()) return;

		if (this.startRectangle === null || this.endRectangle === null) return;

		/*
			The catch-up below is the other way in, and a range can also
			ARRIVE while the handles are up (the in-cell editor closing under
			a live selection), so this hides as well as refuses. Placing them
			is pointless once they are down.
		*/
		if (this.isCellRangeSelection()) {
			if (this.start.isSectionShown() || this.end.isSectionShown()) {
				this.start.setShowSection(false);
				this.end.setShowSection(false);
				app.sectionContainer.requestReDraw();
			}
			return;
		}

		/*
			VULCAN: activate() is the only shower, and it can run before the
			rectangles exist. Core has two Writer emitters for this triple:
			the update path flushes textselectionstart/end BEFORE
			textselection, but SwShellCursor::Show collects its rectangles
			with start/end emission suppressed and queues textselection
			DIRECTLY, ahead of where the update path appends at flush time
			(core init.cxx enqueueUpdatedTypes) — so textselection can arrive
			first. activate() then saw two nulls, latched active, and nothing
			ever re-decided: the phone teardrops stayed display:none under a
			live selection (measured on slot-01). Catch up here, the moment
			both edges are known for a live selection. The request still goes
			through TextSelectionHandle.setShowSection, so the desktop mouse
			veto keeps every non-touch surface handle-free.
		*/
		if (!this.start.isSectionShown() || !this.end.isSectionShown()) {
			this.start.setShowSection(true);
			this.end.setShowSection(true);
		}

		var startPos = { x: this.startRectangle.pX1, y: this.startRectangle.pY2 };
		var endPos = { x: this.endRectangle.pX1, y: this.endRectangle.pY2 };

		if (app.map._docLayer.isCalcRTL()) {
			Util.ensureValue(app.activeDocument);
			// Mirror position from right to left.
			startPos.x =
				app.activeDocument.activeLayout.viewedRectangle.pX2 -
				(startPos.x - app.activeDocument.activeLayout.viewedRectangle.pX1);
			endPos.x =
				app.activeDocument.activeLayout.viewedRectangle.pX2 -
				(endPos.x - app.activeDocument.activeLayout.viewedRectangle.pX1);
		}

		const oldStart = this.start.getPosition();
		const oldEnd = this.end.getPosition();

		/*
			Both handles are anchored by their SVG's own origin, but on a phone
			the section box now starts artOffset px up-LEFT of that (bigger
			grab box, same art — see TextSelectionHandleSection). Subtract the
			offset here so the teardrop lands on exactly the document pixel it
			always did and only the invisible grab region grows.

			artOffset* and startTipOffsetX are CSS px; startPos/endPos are CORE
			px, so both cross with * dpiScale. Off-phone both offsets are 0 and
			this block is `startPos.x -= 30 * app.dpiScale` followed by the two
			stock setPosition calls. The tip shift uses startTipOffsetX, the
			same value postSelectionEdge adds back on a drag — the pair MUST
			read one source or placing and posting disagree about where the
			selection edge is (the round-8 artWidth split).
		*/
		const artDX = TextSelectionHandle.artOffsetX() * app.dpiScale; // CORE px.
		const artDY = TextSelectionHandle.artOffsetY() * app.dpiScale; // CORE px.

		startPos.x -= TextSelectionHandle.startTipOffsetX() * app.dpiScale;
		this.start.setPosition(startPos.x - artDX, startPos.y - artDY);
		const newStart = this.start.getPosition();

		this.end.setPosition(endPos.x - artDX, endPos.y - artDY);
		const newEnd = this.end.getPosition();

		if (
			app.map._docLayer.isCalcRTL() &&
			(newStart.y < newEnd.y ||
				(newStart.y <= newEnd.y && newStart.x < newEnd.x))
		) {
			// If the start handle is actually closer to the end of the selection, reverse positions (Right To Left case).
			this.start.setPosition(newEnd.pX, newEnd.pY);
			this.end.setPosition(newStart.pX, newStart.pY);
		} else if (
			!app.map._docLayer.isCalcRTL() &&
			(oldEnd.distanceTo(newStart.toArray()) < 20 ||
				oldStart.distanceTo(newEnd.toArray()) < 20)
		) {
			/*
				If the start handle is actually closer to the end of the selection, reverse positions.
				This seems to be a core side issue to me. I think the start and end positions are switched but the handlers aren't on the core side.
			*/
			this.switchStartEndHandles();
		}

		// Schedule a redraw if there's not any.
		app.sectionContainer.requestReDraw();
	}

	public static switchStartEndHandles() {
		const temp = this.start;
		this.start = this.end;
		this.end = temp;
	}

	public static dispose() {
		app.sectionContainer.removeSection(this.start.name);
		app.sectionContainer.removeSection(this.end.name);
	}
}

(window as any).TextSelections = TextSelections;
