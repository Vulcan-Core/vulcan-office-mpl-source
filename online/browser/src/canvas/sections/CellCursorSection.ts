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

class CellCursorSection extends CanvasSectionObject {
    zIndex: number = app.CSections.CellCursor.zIndex;
    drawingOrder: number = app.CSections.CellCursor.drawingOrder;
    processingOrder: number = app.CSections.CellCursor.processingOrder;
	interactable: boolean = false;

	constructor (color: string, weight: number, viewId: number) {
        super(app.CSections.CellCursor.name);

		this.documentObject = true;

		this.sectionProperties.viewId = viewId;
		this.sectionProperties.weight = weight;
		this.sectionProperties.color = color;

		// Phone gate: global.js stamps html.vulcan-mobile-chrome iff
		// !desktopChrome && mode.isSmallScreenDevice(), and isTablet() is DEFINED
		// as !isSmallScreenDevice(), so desktop and tablet fail both halves and
		// take the stock branch in onDraw() unchanged. Same pair
		// Control.Header._isVulcanPhoneHeader() and CellSelectionHandleSection
		// use. Read once here, like CellSelectionHandleSection does -- onDraw
		// runs per frame and must stay free of DOM reads.
		this.sectionProperties.vulcanPhoneCursor =
			!!window.mode.isSmallScreenDevice() &&
			document.documentElement.classList.contains('vulcan-mobile-chrome');
	}

	public getViewId(): number {
		return this.sectionProperties.viewId;
	}

	public setViewId(viewId: number) {
		this.sectionProperties.viewId = viewId;
	}

	// If the split panes are active and the cell cursor overlaps with the split pane, we adjust the size and position.
	public static adjustSizePos(defaultSizePos: number[]): number[] {
		const splitPos = app.map._docLayer._splitPanesContext ? app.map._docLayer._splitPanesContext.getSplitPos() : null;

		if (!splitPos || (splitPos.x === 0 && splitPos.y === 0) || !app.activeDocument || (app.activeDocument.activeLayout.viewedRectangle.pX1 === 0 && app.activeDocument.activeLayout.viewedRectangle.pY1 === 0)) return defaultSizePos;

		if (defaultSizePos[0] < splitPos.x && defaultSizePos[0] + defaultSizePos[2] > splitPos.x)
			defaultSizePos[2] = Math.max(splitPos.x - defaultSizePos[0], defaultSizePos[2] - app.activeDocument.activeLayout.viewedRectangle.pX1);

		if (defaultSizePos[0] >= splitPos.x && app.activeDocument.activeLayout.viewedRectangle.pX1 + splitPos.x > defaultSizePos[0]) {
			defaultSizePos[2] = (defaultSizePos[0] + defaultSizePos[2]) - (app.activeDocument.activeLayout.viewedRectangle.pX1 + splitPos.x);
			defaultSizePos[0] = splitPos.x + app.activeDocument.activeLayout.viewedRectangle.pX1;
		}

		if (defaultSizePos[1] < splitPos.y && defaultSizePos[1] + defaultSizePos[3] > splitPos.y)
			defaultSizePos[3] = Math.max(splitPos.y - defaultSizePos[1], defaultSizePos[3] - app.activeDocument.activeLayout.viewedRectangle.pY1);

		if (defaultSizePos[1] >= splitPos.y && app.activeDocument.activeLayout.viewedRectangle.pY1 + splitPos.y > defaultSizePos[1]) {
			defaultSizePos[3] = (defaultSizePos[1] + defaultSizePos[3]) - (app.activeDocument.activeLayout.viewedRectangle.pY1 + splitPos.y);
			defaultSizePos[1] = splitPos.y + app.activeDocument.activeLayout.viewedRectangle.pY1;
		}

		return defaultSizePos;
	}

	/**
	 * The grid rectangle in absolute canvas px: the tiles, excluding both
	 * headers. Null when nothing can answer it.
	 *
	 * The document anchor section IS the tiles (CanvasTileLayer wires it with
	 * `setDocumentAnchorSection(app.CSections.Tiles.name)` right after adding
	 * the section), and the container assigns
	 * `activeLayout.documentAnchorPosition = section.myTopLeft` for whichever
	 * section holds that name, so this rect's origin is by construction the
	 * same inner corner every document-object coordinate is measured from.
	 * Asking the container rather than re-deriving it from the header sizes is
	 * what keeps the two definitions from drifting apart.
	 */
	private vulcanGridRect(): number[] | null {
		const grid = app.sectionContainer.getDocumentAnchorSection();
		if (!grid) return null;
		return [grid.myTopLeft[0], grid.myTopLeft[1], grid.size[0], grid.size[1]];
	}

	/**
	 * Where the cursor's top-left corner sits on the glass with the view clamp
	 * NOT applied -- the base ViewLayout mapping (`documentToViewX/Y` in
	 * ViewLayout, which ViewLayoutCalc overrides). Null when no layout can
	 * answer, or on an RTL sheet.
	 *
	 * VO-P-0006. `cursorRect.v1X` routes through
	 * ViewLayoutCalc.splitAwareOffset, which with no frozen panes (the phone
	 * always: app.calc.splitCoordinate is (0,0)) reduces to
	 * `Math.max(0, coord - viewedStart)`. So a cell scrolled left of the
	 * viewport start maps to the grid's inner corner instead of going
	 * negative. The ring's SIZE does not go through that map -- pWidth and
	 * pHeight are a pure twips->px scale -- so inside the clamp window the
	 * left/top edge is pinned at the header boundary while the right/bottom
	 * edge still sits a full cell's width beyond it: the ring overruns its own
	 * cell by exactly the number of px the cell is hidden behind the header.
	 * That is the reported "the box [moves] beyond the cell boundary ... (lhs
	 * is at to row # boundary)", and the same expression on Y is the reported
	 * "similarly for scrolling down".
	 *
	 * This architecture has no canvas clipping for document sections --
	 * CanvasSectionContainer.drawSections only translates to myTopLeft -- so
	 * the clamp is the only thing standing in for a mask, and clamping ONE
	 * corner of a rectangle deforms it rather than masking it. Draw from the
	 * true position and mask with a real clip instead; see the caller, where
	 * the two are taken together or not at all.
	 *
	 * Away from the clamp window this is byte-identical to v1X/v1Y: it is the
	 * expression splitAwareOffset reduces to whenever the Math.max does not
	 * fire, evaluated on the same pX getters, so it carries the same rounding.
	 *
	 * RTL IS LEFT ALONE, the same call CellSelectionHandleSection.
	 * cornerViewPosition makes and for the same reason:
	 * ViewLayoutCalc.documentToViewX mirrors x about the document anchor on an
	 * RTL sheet, which inverts the sign of this correction, and RTL Calc on a
	 * phone is unmeasured here. Keeping the shipped expression there is a
	 * known wrong number rather than a guessed one.
	 */
	private vulcanUnclampedOrigin(cursorRect: cool.SimpleRectangle): number[] | null {
		const layout = app.activeDocument ? app.activeDocument.activeLayout : null;
		if (!layout) return null;

		const docLayer = app.map ? app.map._docLayer : null;
		if (docLayer && docLayer.isCalcRTL && docLayer.isCalcRTL()) return null;

		const anchor = layout.documentAnchorPosition;
		const viewed = layout.viewedRectangle;
		return [
			cursorRect.pX1 - viewed.pX1 + anchor[0],
			cursorRect.pY1 - viewed.pY1 + anchor[1],
		];
	}

	/**
	 * Vulcan phone cursor (docs/mobile-redesign/02 §5).
	 *
	 * Two changes from the stock ring, both for the same reason: on a phone the
	 * cursor is not a lone mark, it is the middle of a three-part object -- a
	 * round handle sits on the top-left and bottom-right corners
	 * (CellSelectionHandleSection, already a filled accent dot with a surface
	 * halo). A mitred right angle poking out of a circle reads as two unrelated
	 * marks in the same colour, which is the exact failure the handle work was
	 * done to remove.
	 *
	 *  1. ONE rounded stroke instead of `weight` concentric mitred rectangles.
	 *  2. No dark-theme white outline. The stock branch strokes the SAME rect
	 *     twice (an obvious copy-paste, both calls identical), so on dark the
	 *     ring is a coloured band with a doubled white line hugging its inside
	 *     edge. Google Sheets has no such second colour, and the halo the phone
	 *     handles already carry does that separation job in one place.
	 *
	 * Everything is in DEVICE px -- sections get no ctx.scale().
	 */
	private drawVulcanPhoneCursor(cursorRect: cool.SimpleRectangle): void {
		// weight arrives as 2 * app.dpiScale (CanvasTileLayer reads the 2px
		// border-top-width off .cell-cursor-data and multiplies), so it is device
		// px = 2 CSS px. Round it: at a fractional DPR a 5.5-device-px stroke
		// straddles a device pixel on both edges and shimmers through a fling.
		const w: number = Math.max(1, Math.round(this.sectionProperties.weight));
		const half: number = w / 2;

		/*
		 * VO-P-0006. The true position and the mask are ONE change and are
		 * taken together or not at all: drawing from the unclamped origin
		 * WITHOUT the clip would paint the occluded part of the ring on top of
		 * the row-number gutter, which is a worse defect than the overrun it
		 * removes. So if either half cannot be established -- no anchor
		 * section, no layout, an RTL sheet -- the shipped clamped expression
		 * stands unchanged.
		 *
		 * onDraw has already reset the transform to the identity, so this rect
		 * is in the same absolute canvas px the ring is stroked in, and the
		 * restore() onDraw makes right after this call is what scopes it -- no
		 * new save/restore pair.
		 *
		 * Cost is one rect clip per frame on one section, and no Path2D (the
		 * beginPath/rect/clip form allocates nothing per frame; TilesSection's
		 * debug overlay uses Path2D because it clips per tile). This is not
		 * the case TilesSection's "normally we avoid clipping for perf" note is
		 * about -- that is a whole-tile clip per tile per frame. An arithmetic
		 * intersect is not an alternative either: the ring is rounded, and an
		 * intersected rect would keep a corner radius on the cut side that a
		 * clip correctly removes.
		 */
		const grid: number[] | null = this.vulcanGridRect();
		const origin: number[] | null = grid
			? this.vulcanUnclampedOrigin(cursorRect)
			: null;

		let originX: number;
		let originY: number;
		if (grid && origin) {
			this.context.beginPath();
			this.context.rect(grid[0], grid[1], grid[2], grid[3]);
			this.context.clip();
			originX = origin[0];
			originY = origin[1];
		} else {
			originX = cursorRect.v1X;
			originY = cursorRect.v1Y;
		}

		// Occupy the band the stock loop covers. That loop strokes `weight` 1px
		// rects each 1px larger per side, netting [edge - 1 - weight, edge - 1]
		// on the top/left and [edge, edge + weight] on the bottom/right; centring
		// a single w-wide stroke on that band reproduces it. With w even (the
		// normal case: 2 * an integer DPR) the centre lands on an integer and the
		// stroke edges land on device-pixel boundaries.
		const x: number = originX - 1 - half;
		const y: number = originY - 1 - half;
		const width: number = cursorRect.pWidth + w + 1;
		const height: number = cursorRect.pHeight + w + 1;

		// Radius = the ring weight (2 CSS px): the smallest corner that visibly
		// meets the handle dot without softening the cell box into a pill.
		// Clamped to half the shorter side so a one-row-tall or one-column-wide
		// cursor cannot invert its own corners.
		const radius: number = Math.max(0, Math.min(w, width / 2, height / 2));

		this.context.lineJoin = 'round';
		this.context.lineWidth = w;

		// arcTo rather than roundRect: roundRect is Chrome 99+/Safari 16+, and a
		// feature-detected fallback would mean two corner geometries to keep in
		// step. arcTo is universal and the shape is four calls.
		this.context.beginPath();
		this.context.moveTo(x + radius, y);
		this.context.arcTo(x + width, y, x + width, y + height, radius);
		this.context.arcTo(x + width, y + height, x, y + height, radius);
		this.context.arcTo(x, y + height, x, y, radius);
		this.context.arcTo(x, y, x + width, y, radius);
		this.context.closePath();
		this.context.stroke();
	}

	/*
	 * CORE px of slack. _cellSelectionArea is built from twips that
	 * CanvasTileLayer adjusts before construction; the cursor rectangle is
	 * not, so an identical single cell can differ by a rounding.
	 */
	private static readonly rangeSlack: number = 1;

	/**
	 * Is the live selection bigger than the cell the cursor sits on?
	 *
	 * Measured geometry, NOT "_cellSelectionArea is null for a single cell" --
	 * that is a comment elsewhere in the tree, not an invariant core promises.
	 * A real range outgrows the anchor cell on at least one axis under either
	 * reading, and a single cell outgrows it under neither, so this answers
	 * the same both ways.
	 */
	private rangeOutgrowsCursor(): boolean {
		const area = app.map._docLayer._cellSelectionArea;
		const cursor = app.calc.cellCursorRectangle;
		if (!area || !cursor) return false;

		return (
			area.pWidth > cursor.pWidth + CellCursorSection.rangeSlack ||
			area.pHeight > cursor.pHeight + CellCursorSection.rangeSlack
		);
	}

	public onDraw() {
		if (app.calc.cellCursorVisible) {
			/*
			 * A multi-cell range carries its own chrome already: the wash, and
			 * a corner square at each end (CellSelectionHandleSection). Core
			 * keeps the cell cursor visible on the ANCHOR cell throughout, so
			 * the ring paints a second mark of a different shape around one
			 * cell of the many selected -- the same two-marks-in-one-colour
			 * failure drawVulcanPhoneCursor was written to remove, one level
			 * up. Google Sheets rings the whole range or nothing.
			 *
			 * Phone only; the stock branch below never reaches this.
			 */
			if (
				this.sectionProperties.vulcanPhoneCursor &&
				this.rangeOutgrowsCursor()
			)
				return;

			Util.ensureValue(app.activeDocument);

			this.context.save();
			this.context.setTransform(1, 0, 0, 1, 0, 0);

			this.context.lineJoin = 'miter';
			this.context.lineCap = 'butt';
			this.context.lineWidth = 1;

			this.context.strokeStyle = this.sectionProperties.color;

			// Vulcan: a predicted move (VulcanCalcCursorEcho) is drawn until
			// core's cellcursor answers it.
			const predicted: cool.SimpleRectangle | null =
				app.definitions?.vulcanCalcCursorEcho?.getPredictedRectangle?.() ?? null;
			const cursorRect: cool.SimpleRectangle = (predicted ?? app.calc.cellCursorRectangle ?? new cool.SimpleRectangle(0, 0, 0, 0)).clone();

			if (this.sectionProperties.vulcanPhoneCursor) {
				this.drawVulcanPhoneCursor(cursorRect);
				this.context.restore();
				return;
			}

			for (let i: number = 0; i < this.sectionProperties.weight; i++) {
				// Slighyly modify rectangle in each cycle, for thickness.
				cursorRect.pX1 -= 1;
				cursorRect.pY1 -= 1;
				cursorRect.pWidth += 2;
				cursorRect.pHeight += 2;
				this.drawViewRectangle(cursorRect);
			}

			if (window.prefs.getBoolean('darkTheme')) {
				this.context.strokeStyle = 'white';
				const diff = 1;
				this.context.strokeRect(cursorRect.v1X + -0.5 + diff, cursorRect.v1Y - 0.5 + diff, cursorRect.pWidth - 2 * diff, cursorRect.pHeight - 2 * diff);
				this.context.strokeRect(cursorRect.v1X + -0.5 + diff, cursorRect.v1Y - 0.5 + diff, cursorRect.pWidth - 2 * diff, cursorRect.pHeight - 2 * diff);
			}

			this.context.restore();
		}
	}
}
