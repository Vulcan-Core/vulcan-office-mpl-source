// @ts-strict-ignore
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

class CalcGridSection extends CanvasSectionObject {
	constructor () {
        super(app.CSections.CalcGrid.name);

        // Even if this one is drawn on top, won't be able to catch events.
        // Sections with "interactable: true" can catch events even if they are under a section with property "interactable: false".
        this.interactable = false;
        this.anchor = ['top', 'left'];
        this.processingOrder = app.CSections.CalcGrid.processingOrder, // Size and position will be copied (boundSection), this value is not important.
        this.drawingOrder = app.CSections.CalcGrid.drawingOrder,
        this.zIndex = app.CSections.CalcGrid.zIndex,
        this.boundToSection = 'tiles';
        this.sectionProperties = {
            docLayer: app.map._docLayer,
            strokeStyle: getComputedStyle(document.body).getPropertyValue('--color-calc-grid'),
			tsManager: null,

			// Vulcan phone: draw the grid at 1 CSS px instead of 1 DEVICE px.
			//
			// Canvas units in a section are DEVICE pixels -- CanvasSectionContainer
			// never calls ctx.scale(), it multiplies every size by app.dpiScale --
			// so the hairline below is literally one device pixel, i.e. a THIRD of
			// a CSS pixel on a DPR-3 phone. The header rules framing that grid draw
			// at CanvasSectionObject.getLineWidth() = app.roundedDpiScale = a full
			// CSS pixel, so the chrome renders 3x heavier than the data it frames
			// and the sheet stops reading as tabular data. Google Sheets draws both
			// at 1 CSS px, with the grid the quieter of the two by COLOUR (#c0c0c0
			// vs the header's own rules), not by sub-pixel thinness.
			//
			// Phone gate: global.js stamps html.vulcan-mobile-chrome iff
			// !desktopChrome && mode.isSmallScreenDevice(), and isTablet() is
			// DEFINED as !isSmallScreenDevice() -- so desktop and tablet fail both
			// halves, keep vulcanPhoneGrid false, and drawHairLine below collapses
			// to the original fillRect with no change in geometry. Same pair
			// Control.Header._isVulcanPhoneHeader() and CellSelectionHandleSection
			// use.
			vulcanPhoneGrid:
				!!window.mode.isSmallScreenDevice() &&
				document.documentElement.classList.contains('vulcan-mobile-chrome'),
        };
	}

	public resetStrokeStyle() {
		this.sectionProperties.strokeStyle = getComputedStyle(document.body).getPropertyValue('--color-calc-grid');
	}

	// repaintArea, paneTopLeft, canvasCtx
	onDrawArea(area?: Bounds, paneTopLeft?: any): void {
		if (!this.sectionProperties.docLayer.sheetGeometry)
			return;

		var tsManager = this.sectionProperties.tsManager;
		this.context.strokeStyle = this.sectionProperties.strokeStyle;
		this.context.lineWidth = 1.0;

		// Thickness of one grid rule, in DEVICE px (see the constructor note).
		// ROUNDED, not raw app.dpiScale: at a fractional DPR (2.625 / 2.75 are
		// common Android values) a 2.75-device-px rect antialiases its trailing
		// edge, and the coverage of that edge changes with every scroll delta --
		// the grid shimmers through a fling. Whole device pixels on integer
		// coordinates cannot. This is exactly what getLineWidth() already does
		// for the headers, so grid and headers now round the same way.
		var hairWidth = 1;
		if (this.sectionProperties.vulcanPhoneGrid)
			hairWidth = Math.max(1, Math.round(app.dpiScale));

		var scale = 1.0;
		if (tsManager._inZoomAnim && tsManager._zoomFrameScale)
			scale = tsManager._zoomFrameScale;

		var ctx = tsManager._paintContext();
		var isRTL = this.sectionProperties.docLayer.isCalcRTL();
		var sectionWidth = this.size[0];
		var xTransform = function (xcoord: any) {
			return isRTL ? sectionWidth - xcoord : xcoord;
		}.bind(this);

		// This is called just before and after the dashed line drawing.
		var startEndDash = function (ctx2D: CanvasRenderingContext2D, end: boolean) {
			// Style the dashed lines.
			var dashLen = 5;
			var gapLen = 5;

			// Restart the path to apply the dashed line style.
			ctx2D.closePath();
			ctx2D.beginPath();
			ctx2D.setLineDash(end ? [] : [dashLen, gapLen]);
		}.bind(this);

		var docLayer = this.sectionProperties.docLayer;
		var currentPart = docLayer._selectedPart;
		// Draw the print range with dashed line if singleton to match desktop Calc.
		var printRange: any = [];
		if (docLayer._printRanges && docLayer._printRanges.length > currentPart
			&& docLayer._printRanges[currentPart].length == 1)
			printRange = docLayer._printRanges[currentPart][0];

		for (var i = 0; i < ctx.paneBoundsList.length; ++i) {
			// co-ordinates of this pane in core document pixels
			var paneBounds = ctx.paneBoundsList[i];
			// co-ordinates of the main-(bottom right) pane in core document pixels
			var viewBounds = ctx.viewBounds;
			// into real pixel-land ...
			paneBounds.round();
			viewBounds.round();

			var paneOffset: any;
			var doOnePane = false;
			if (!area || !paneTopLeft) {
				area = paneBounds;
				paneOffset = paneBounds.getTopLeft(); // allocates
				// Cute way to detect the in-canvas pixel offset of each pane
				paneOffset.x = Math.min(paneOffset.x, viewBounds.min.x);
				paneOffset.y = Math.min(paneOffset.y, viewBounds.min.y);
			} else {
				// do only for the predefined pane (paneOffset / repaintArea)
				doOnePane = true;
				paneOffset = paneTopLeft.clone();
			}

			// Vertical line rendering on large areas is ~10x as expensive
			// as horizontal line rendering: due to cache effects - so to
			// help our poor CPU renderers - render in horizontal strips.
			var bandSize = 256;
			var printRangeLine = false;

			var drawPrintLine = function(ctx: CanvasRenderingContext2D,
						    x1: number, y1: number, x2: number, y2: number) {
				ctx.moveTo(x1 + 0.5, y1 + 0.5);
				ctx.lineTo(x2 - 0.5, y2 - 0.5);
				ctx.stroke();
			};
			var drawHairLine = function(ctx: CanvasRenderingContext2D,
						    x1: number, y1: number, x2: number, y2: number) {
				// https://bugzilla.mozilla.org/show_bug.cgi?id=1857185
				var w = x2 - x1;
				var h = y2 - y1;

				// Widen only the axis the CALLER made exactly one device pixel
				// thick: the vertical site passes (xcoord - 1, .., xcoord, ..)
				// and the horizontal one (.., pos - 1, .., pos). Grow away from
				// x2/y2, which is the cell boundary, so the rule keeps the
				// device-pixel edge it already sat on rather than creeping into
				// the neighbouring cell.
				//
				// Exact `=== 1` rather than `<= hairWidth` on purpose. In RTL
				// xTransform mirrors min and max, so the horizontal call's WIDTH
				// is negative (fillRect accepts that and draws leftwards); a
				// magnitude test would clamp it to hairWidth and delete every
				// horizontal rule on an RTL sheet.
				//
				// Both coordinates are already integers -- every call site wraps
				// its position in Math.floor -- so an integer hairWidth keeps the
				// rect on exact device-pixel boundaries with no antialiasing.
				// Off the phone hairWidth is 1 and both branches restore the
				// original x1/w and y1/h byte for byte.
				if (w === 1) { x1 = x2 - hairWidth; w = hairWidth; }
				if (h === 1) { y1 = y2 - hairWidth; h = hairWidth; }

				ctx.fillRect(x1, y1, w, h);
			};

			this.context.fillStyle = this.sectionProperties.strokeStyle;
			for (var miny = area.min.y; miny < area.max.y; miny += bandSize)
			{
				var maxy = Math.min(area.max.y, miny + bandSize);

				this.context.beginPath();

				// vertical lines
				this.sectionProperties.docLayer.sheetGeometry._columns.forEachInCorePixelRange(
					area.min.x, area.max.x,
					function(pos: any, colIndex: any) {
						var xcoord = xTransform(Math.floor(scale * (pos - paneOffset.x)));

						printRangeLine = false;
						var drawLine = drawHairLine;
						if (printRange.length === 4
							&& (printRange[0] === colIndex || printRange[2] + 1 === colIndex)) {
							printRangeLine = true;
							startEndDash(this.context, false /* end? */);
							drawLine = drawPrintLine;
						}

						drawLine(this.context,
							 xcoord - 1, Math.floor(scale * (miny - paneOffset.y)) - 1,
							 xcoord, Math.floor(scale * (maxy - paneOffset.y)));

						if (printRangeLine)
							startEndDash(this.context, true /* end? */);
					}.bind(this));

				// horizontal lines
				this.sectionProperties.docLayer.sheetGeometry._rows.forEachInCorePixelRange(
					miny, maxy,
					function(pos: any, rowIndex: any) {

						printRangeLine = false;
						var drawLine = drawHairLine;
						if (printRange.length === 4
							&& (printRange[1] === rowIndex || printRange[3] + 1 === rowIndex)) {
							printRangeLine = true;
							startEndDash(this.context, false /* end? */);
							drawLine = drawPrintLine;
						}

						drawLine(this.context,
							 xTransform(Math.floor(scale * (area.min.x - paneOffset.x))) - 1,
							 Math.floor(scale * (pos - paneOffset.y)) - 1,
							 xTransform(Math.floor(scale * (area.max.x - paneOffset.x))),
							 Math.floor(scale * (pos - paneOffset.y)));

						if (printRangeLine)
							startEndDash(this.context, true /* end? */);
					}.bind(this));

				this.context.closePath();
			}

			if (doOnePane)
				break;
		}
	}

    onDraw(frameCount?: number, elapsedTime?: number): void {
		// We don't show the sheet grid, so we don't draw it.
		if (!this.sectionProperties.docLayer._sheetGrid)
			return;

		// grid-section's onDrawArea is TileSectionManager's _drawGridSectionArea().
		this.onDrawArea();
    }
}

app.definitions.calcGridSection = CalcGridSection;
