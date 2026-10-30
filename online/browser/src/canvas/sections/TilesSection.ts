// @ts-strict-ignore
/* -*- tab-width: 4 -*- */

/*
 * Copyright the Collabora Online contributors.
 *
 * SPDX-License-Identifier: MPL-2.0
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
/* See CanvasSectionContainer.ts for explanations. */

/* global L */

namespace cool {

export class TilesSection extends CanvasSectionObject {

	anchor: any = [[app.CSections.RulerSpacer.name, 'bottom', app.CSections.ColumnHeader.name, 'bottom', 'top'], [app.CSections.RowHeader.name, 'right', 'left']];
	expand: any = ['top', 'left', 'bottom', 'right'];
	processingOrder: number = app.CSections.Tiles.processingOrder;
	drawingOrder: number = app.CSections.Tiles.drawingOrder;
	zIndex: number = app.CSections.Tiles.zIndex;

	map: any;
	isJSDOM: boolean = false; // testing
	checkpattern: any;

	// The desktop Writer sheet, as the pre-tile pass of this frame measured
	// it, for the post-tile pass to decorate. Absolute view coordinates in
	// device pixels, every edge snapped. null when this frame drew no sheet
	// (phone, tablet, multi-page view, no pages yet).
	private writerSheet: {
		x0: number; y0: number; x1: number; y1: number;
		dx0: number; dy0: number; dx1: number; dy1: number;
		gaps: { y0: number; y1: number }[];
		rules: number[];
	} | null = null;

	constructor () {
		super(app.CSections.Tiles.name);

		this.map = window.L.Map.THIS;

		this.sectionProperties.docLayer = this.map._docLayer;
		this.sectionProperties.tsManager = this.sectionProperties.docLayer._painter;
		this.sectionProperties.pageBackgroundInnerMargin = 0; // In core pixels. We don't want backgrounds to have exact same borders with tiles for not making them visible when tiles are rendered.
		this.sectionProperties.pageBackgroundFont = String(40 * app.roundedDpiScale) + 'px Arial';

		// Theme-dependent page decoration colors (--vulcan-* tokens). Read
		// once here and again on 'darkmodechanged' — never per frame.
		this.refreshPageDecorationColors();
		this.map.on('darkmodechanged', this.refreshPageDecorationColors, this);

		// Floating-page drop shadows are part of the desktop-only chrome
		// (global.js stamps the marker at boot) AND canvas shadowBlur is real
		// per-page paint cost — mobile keeps the stock flat pages.
		this.sectionProperties.desktopChrome =
			document.documentElement.classList.contains('vulcan-desktop-chrome');

		// Phone chrome, same two-part test the rest of the phone work uses
		// (CanvasTileLayer._recalcZoom's one-slide fit, ImpressTileLayer's
		// view-mode flip). Both halves are fixed for the session — global.js
		// stamps the marker pre-paint and only when isSmallScreenDevice() — so
		// this is read once here rather than per frame, like desktopChrome.
		this.sectionProperties.phoneChrome =
			window.mode.isSmallScreenDevice() &&
			document.documentElement.classList.contains('vulcan-mobile-chrome');

		// Loading-state skeleton: for a subtle hint of a heading / cell content
		// drawn over a page's white background before tiles arrive.
		this.sectionProperties.skeletonHeadingColor = '#c8d2dc';
		this.sectionProperties.skeletonLineColor = '#dde3ea';

		this.isJSDOM = typeof window === 'object' && window.name === 'nodejs';

		this.checkpattern = this.makeCheckPattern();
	}

	// Cache the theme-dependent page decoration colors from the vulcan-theme
	// tokens. getComputedStyle is too expensive to run per frame
	// (drawPageBackgrounds runs on every draw), so this is called once from
	// the constructor and again whenever UIManager fires 'darkmodechanged'
	// (loadLightMode/loadDarkMode) — same pattern as
	// setCanvasColorAfterModeChange / ScrollSection.refreshScrollBarColors.
	private refreshPageDecorationColors(): void {
		const style = getComputedStyle(document.documentElement);
		this.sectionProperties.pageOutlineColor =
			style.getPropertyValue('--vulcan-page-outline').trim() || 'rgba(15, 23, 42, 0.28)';
		// The two-layer chrome shadow — the SAME recipe the glass bars paint
		// (--vulcan-glass-shadow), read from the geometry + colour tokens so the
		// page and the bars above it can never drift to different weights.
		this.sectionProperties.pageShadow = VulcanPageShadow.read(style);

		// Legacy page chrome (file-based view border + page numbers): follow
		// the same tokens instead of the old hardcoded lightgrey/grey.
		this.sectionProperties.pageBackgroundBorderColor =
			this.sectionProperties.pageOutlineColor;
		this.sectionProperties.pageBackgroundTextColor =
			style.getPropertyValue('--vulcan-muted').trim() || 'grey';
	}

	/*
	 * THE PHONE WRITER SURFACE, AS DATA. (R6-15)
	 *
	 * Founder directive: "google docs doesn't have separately shaded 'sheets'
	 * -- it has dotted line breaks on a white background".
	 *
	 * MEASURED on served build #10 (slot-02, Dinosaurs.docx, 393x852 dpr 3;
	 * ~/.cache/voffice-evidence/round6/r6-15-writer-viewmodel/m1-in2.png): the
	 * phone paints four white cards on the #f0f0f0 workspace, each stroked on
	 * all four sides, with grey gutters between and around them. That is the
	 * shaded sheet. The reflowed posture (m1-00-rest.png) is the same
	 * treatment with one card -- grey bands left, right and top, and a box
	 * around the reading column.
	 *
	 * So: one sheet of paper spanning every page AND every gap, and a dotted
	 * rule where each page ends. Returned as data rather than drawn here so
	 * the geometry is testable without a canvas, and so the draw below is a
	 * thin consumer of it.
	 *
	 * Everything is twips, the units pageRectangleList arrives in. A rule sits
	 * at the MIDDLE of the gap it marks -- on a page it would be a line across
	 * prose that does not break there -- and spans the page it separates. N
	 * pages give N-1 rules, so the reflowed single page gets none, which is
	 * correct: there is no break in it.
	 *
	 * null for an empty list: before the first `status:` there is nothing to
	 * paint, and a zero-sized fill is not the same answer.
	 */
	public static continuousSurfacePlan(
		pageRectsTwips: number[][],
	): {
		paper: { x: number; y: number; w: number; h: number };
		rules: { y: number; x: number; w: number }[];
	} | null {
		if (!pageRectsTwips || pageRectsTwips.length === 0) return null;

		let left = Infinity;
		let right = -Infinity;
		let top = Infinity;
		let bottom = -Infinity;
		for (const p of pageRectsTwips) {
			if (!p || p.length < 4) continue;
			left = Math.min(left, p[0]);
			right = Math.max(right, p[0] + p[2]);
			top = Math.min(top, p[1]);
			bottom = Math.max(bottom, p[1] + p[3]);
		}
		if (!isFinite(left) || !isFinite(top) || right <= left || bottom <= top)
			return null;

		const rules: { y: number; x: number; w: number }[] = [];
		for (let i = 0; i + 1 < pageRectsTwips.length; i++) {
			const a = pageRectsTwips[i];
			const b = pageRectsTwips[i + 1];
			if (!a || !b || a.length < 4 || b.length < 4) continue;
			const gapTop = a[1] + a[3];
			const gapBottom = b[1];
			// Pages that overlap or abut still get their crease, on the seam.
			const y = Math.round((gapTop + Math.max(gapTop, gapBottom)) / 2);
			const x = Math.min(a[0], b[0]);
			const w = Math.max(a[0] + a[2], b[0] + b[2]) - x;
			rules.push({ y: y, x: x, w: w });
		}

		return {
			paper: { x: left, y: top, w: right - left, h: bottom - top },
			rules: rules,
		};
	}

	/*
	 * WHERE THE PAGE OUTLINE IS STROKED, AS DATA.
	 *
	 * The hairline is one device pixel (`unit`) wide and sits OUTSIDE the
	 * page by default: its inner edge is the page edge, so the tiles that
	 * over-paint the interior can never cover it. Every edge is rounded
	 * first -- a page edge on a fractional pixel (x = 13.26 at 150%) would
	 * split the line across two columns, and which column the tiles then
	 * cover differs per side, so the same stroke read twice as dark on the
	 * left as on the right. Both ends are rounded, not the origin and the
	 * size, so the far edge stays on the pixel the tiles' own rounding puts
	 * it on.
	 *
	 * THE DEFECT THIS ALSO ANSWERS. "Outside the page" is off the canvas
	 * whenever the page edge sits on the canvas edge. Desktop Writer opens
	 * on the TEXT fit (VulcanWriterFit.textFitLevel): the page is centred
	 * and its margins overhang the column on purpose, so the sheet's left
	 * and right edges are at or past the section's sides while its top is
	 * a DOCUMENTBORDER band below the section's top. The top stroke landed
	 * on canvas; the two side strokes were clipped -- the owner saw a
	 * hairline along the top of the page and none down either side.
	 *
	 * So the stroke column is kept ON canvas, per axis:
	 *
	 *   sides   -- clamped into the view. A page wider than the column is a
	 *              LAYOUT state (the fit overhangs the margins, or the
	 *              reader zoomed past it), the whole visible width is paper,
	 *              and the outline runs down the outermost column on each
	 *              side, where the page's own edge would be if it fit.
	 *   top and -- moved inside only while the edge row is itself in view
	 *   bottom     (the page starts on the first row, the slide fits the
	 *              height). An edge scrolled OFF the canvas is a SCROLL
	 *              state: the text continues past the row, and a line
	 *              pinned across the viewport there would cut the prose
	 *              under the toolbar on every frame. Those strokes stay
	 *              where they are, off canvas and unseen.
	 *
	 * The result is a strokeRect: (x, y) is the centre of the top-left
	 * corner, so the stroke covers [x - unit/2, x + unit/2) -- a whole
	 * device pixel column when x is on a half pixel, which every value here
	 * is. The view is the section's own rectangle in the caller's
	 * coordinates; pass ±Infinity when there is no canvas to clip against.
	 */
	public static pageOutlineStrokeRect(
		x: number, y: number, w: number, h: number,
		unit: number,
		view: { left: number; top: number; right: number; bottom: number },
	): { x: number; y: number; w: number; h: number } {
		const x0 = Math.round(x);
		const y0 = Math.round(y);
		const x1 = Math.round(x + w);
		const y1 = Math.round(y + h);

		// Each stroke as the first device pixel of its column / row.
		let left = x0 - unit;
		let right = x1;
		let top = y0 - unit;
		let bottom = y1;

		// Sides: the column is always on canvas.
		left = Math.max(left, view.left);
		right = Math.min(right, view.right - unit);

		// Top and bottom: on canvas while the edge itself is.
		if (top < view.top && y0 >= view.top) top = view.top;
		if (bottom + unit > view.bottom && y1 <= view.bottom)
			bottom = view.bottom - unit;

		return {
			x: left + unit / 2,
			y: top + unit / 2,
			w: right - left,
			h: bottom - top,
		};
	}

	// A section's rectangle in the page painters' coordinates (absolute
	// view pixels: the callers translate the context by -myTopLeft first).
	// Unbounded before the container has located the section. Static, and
	// handed the section, because the mocha rigs run the painters on plain
	// objects that carry only the prototype methods they name.
	public static pageOutlineView(
		section: { myTopLeft?: number[]; size?: number[] },
	): { left: number; top: number; right: number; bottom: number } {
		if (!section.myTopLeft || !section.size)
			return { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
		return {
			left: section.myTopLeft[0],
			top: section.myTopLeft[1],
			right: section.myTopLeft[0] + section.size[0],
			bottom: section.myTopLeft[1] + section.size[1],
		};
	}

	/*
	 * Paint that plan: paper edge to edge, then the creases. Phone Writer only
	 * -- desktop and tablet keep the floating card (shadow, fill, four-sided
	 * outline) that drawWriterPageBackground gives them.
	 *
	 * The fill covers the WHOLE section, not just the plan's paper rectangle,
	 * because the grey either side of the column and above the first page is
	 * as much a "sheet" cue as the outline is. The tiles over-paint the page
	 * interiors immediately after, so this costs one fillRect per frame and
	 * the region outside the document simply stays paper.
	 */
	private drawPhoneWriterContinuousSurface(docBg: string): void {
		const plan = TilesSection.continuousSurfacePlan(
			app.file.writer.pageRectangleList);
		if (!plan) return;

		// The caller has translated the context by -myTopLeft, so the section
		// occupies myTopLeft .. myTopLeft + size in these coordinates.
		this.context.fillStyle = docBg;
		this.context.fillRect(
			this.myTopLeft[0], this.myTopLeft[1], this.size[0], this.size[1]);

		if (plan.rules.length === 0) return;

		// One dash setup for the whole set. 2-on/4-off at the device scale
		// reads as dots rather than a broken line, and app.roundedDpiScale is
		// DEVICE pixels (3 at DPR 3), never a third of a CSS pixel.
		const unit = app.roundedDpiScale;
		this.context.save();
		this.context.strokeStyle = this.sectionProperties.pageOutlineColor;
		this.context.lineWidth = unit;
		this.context.setLineDash([2 * unit, 4 * unit]);
		for (const rule of plan.rules) {
			const line = new cool.SimpleRectangle(rule.x, rule.y, rule.w, 0);
			const y = line.v1Y;
			this.context.beginPath();
			this.context.moveTo(line.v1X, y);
			this.context.lineTo(line.v1X + line.pWidth, y);
			this.context.stroke();
		}
		this.context.restore();
	}

	// Stroke the page outline, one device pixel wide, on the pixel column
	// pageOutlineStrokeRect picks: outside the page where the canvas has
	// room for it (so the tiles, which over-paint the page interior after
	// the backgrounds are drawn, can never cover it), on the page's own edge
	// pixel where the page sits on the canvas edge. Whole pixels throughout;
	// the helper's comment has the why.
	private strokePageOutline(x: number, y: number, w: number, h: number): void {
		const lineWidth = app.roundedDpiScale;
		const r = TilesSection.pageOutlineStrokeRect(
			x, y, w, h, lineWidth, TilesSection.pageOutlineView(this));
		this.context.save();
		this.context.strokeStyle = this.sectionProperties.pageOutlineColor;
		this.context.lineWidth = lineWidth;
		this.context.strokeRect(r.x, r.y, r.w, r.h);
		this.context.restore();
	}

	private makeCheckPattern() {
		var canvas = document.createElement('canvas');
		canvas.width = 256;
		canvas.height = 256;
		var drawctx = canvas.getContext('2d');
		var patternOn = true;
		for (var y = 0; y < 256; y+=32) {
			for (var x = 0; x < 256; x+=32) {
				if (patternOn)
					drawctx.fillStyle = 'darkgray';
				else
					drawctx.fillStyle = 'gray';
				patternOn = !patternOn;
				drawctx.fillRect(x, y, 32, 32);
			}
			patternOn = !patternOn;
		}
		return canvas;
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	private paintWithPanes (tile: any, ctx: any, async: boolean): void {
		var tileTopLeft = tile.coords.getPos();
		var tileBounds = new cool.Bounds(tileTopLeft, tileTopLeft.add(new cool.Point(RenderManager.tileSize, RenderManager.tileSize)));

		for (var i = 0; i < ctx.paneBoundsList.length; ++i) {
			// co-ordinates of this pane in core document pixels
			var paneBounds = ctx.paneBoundsList[i];
			// co-ordinates of the main-(bottom right) pane in core document pixels
			var viewBounds = ctx.viewBounds;

			// into real pixel-land ...
			paneBounds.round();
			viewBounds.round();

			if (paneBounds.intersects(tileBounds)) {
				var paneOffset = paneBounds.getTopLeft(); // allocates
				// Cute way to detect the in-canvas pixel offset of each pane
				paneOffset.x = Math.min(paneOffset.x, viewBounds.min.x);
				paneOffset.y = Math.min(paneOffset.y, viewBounds.min.y);

				this.drawTileInPane(tile, tileBounds, paneBounds, paneOffset, this.context, async);
			}
		}
	}

	private beforeDraw(canvasCtx: CanvasRenderingContext2D): void {
		const mirrorTile: boolean = this.isCalcRTL();
		if (mirrorTile) {
			canvasCtx.save();
			canvasCtx.translate(this.size[0], 0);
			canvasCtx.scale(-1, 1);
		}
	}

	private afterDraw(canvasCtx: CanvasRenderingContext2D): void {
		const mirrorTile: boolean = this.isCalcRTL();
		if (mirrorTile) {
			canvasCtx.restore();
		}
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	private drawTileInPane (tile: any, tileBounds: any, paneBounds: any, paneOffset: any, canvasCtx: CanvasRenderingContext2D, clearBackground: boolean): void {
		// intersect - to avoid state thrash through clipping
		var crop = new cool.Bounds(tileBounds.min, tileBounds.max);
		crop.min.x = Math.max(paneBounds.min.x, tileBounds.min.x);
		crop.min.y = Math.max(paneBounds.min.y, tileBounds.min.y);
		crop.max.x = Math.min(paneBounds.max.x, tileBounds.max.x);
		crop.max.y = Math.min(paneBounds.max.y, tileBounds.max.y);

		var cropWidth = crop.max.x - crop.min.x;
		var cropHeight = crop.max.y - crop.min.y;

		if (cropWidth && cropHeight) {
			if (clearBackground || this.containerObject.isZoomChanged() || canvasCtx !== this.context) {
				// Whole canvas is not cleared after zoom has changed, so clear it per tile as they arrive.
				canvasCtx.fillStyle = this.containerObject.getClearColor();
				this.beforeDraw(canvasCtx);
				canvasCtx.fillRect(
					crop.min.x - paneOffset.x,
					crop.min.y - paneOffset.y,
					cropWidth, cropHeight);
				this.afterDraw(canvasCtx);
				var gridSection = this.containerObject.getSectionWithName(app.CSections.CalcGrid.name);
				gridSection.onDrawArea(crop, paneOffset, canvasCtx);
			}

			this.beforeDraw(canvasCtx);
			this.drawTileToCanvasCrop(tile, canvasCtx,
									  crop.min.x - tileBounds.min.x,
									  crop.min.y - tileBounds.min.y,
									  cropWidth, cropHeight,
									  crop.min.x - paneOffset.x,
									  crop.min.y - paneOffset.y,
									  cropWidth, cropHeight);
			this.afterDraw(canvasCtx);
		}
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	pdfViewDrawTileBorders (tile: any, offset: any, tileSize: number): void {
		this.context.strokeStyle = 'red';
		this.context.strokeRect(offset.x, offset.y, tileSize, tileSize);
		this.context.font = '20px Verdana';
		this.context.fillStyle = 'black';
		this.context.fillText(tile.coords.x + ' ' + tile.coords.y + ' ' + tile.coords.part, Math.round(offset.x + tileSize * 0.5), Math.round(offset.y + tileSize * 0.5));
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	private paintSimple (tile: any, async: boolean): void {
		const tilePos: cool.SimplePoint = tile.coords.getPosSimplePoint();

		if ((async || this.containerObject.isZoomChanged()) && !app.file.fileBasedView) {
			// Non Calc tiles(handled by paintSimple) can have transparent pixels,
			// so clear before paint if the call is an async one.
			// For the full view area repaint, whole canvas is cleared by section container.
			// Whole canvas is not cleared after zoom has changed, so clear it per tile as they arrive even if not async.
			this.context.fillStyle = this.containerObject.getClearColor();
			this.context.fillRect(tilePos.vX, tilePos.vY, RenderManager.tileSize, RenderManager.tileSize);
		}

		if (app.file.fileBasedView) {
			// Narrow activeLayout to ViewLayoutFileBased before reading
			// documentRectangles; TypeScript can't see through the flag.
			const activeLayout = app.activeDocument.activeLayout;
			const layout =
				activeLayout && activeLayout.type === 'ViewLayoutFileBased'
					? (activeLayout as ViewLayoutFileBased)
					: null;
			const docRect = layout && layout.documentRectangles[tile.coords.part];
			if (docRect) {
				// tile.coords.x/y are page-local pixels. Set the tile position
				// in twips by combining docRect.y1 (exact twips) with the
				// pixel-to-twip conversion of tile.coords. Setting via .pX /
				// .pY would compose docRect.pY1 (already rounded) with the
				// tile coord and convert the sum back to twips - that double
				// round-trip can shift the resulting twip value by a few
				// twips relative to docRect.y1, which then causes
				// SimpleRectangle.containsPoint inside
				// getClosestRectangleIndex to miss this docRect and fall
				// through to closest-by-center. The closest-by-center pick
				// can land on a neighbouring part and route the tile through
				// its viewRect; if that neighbour has a different X centering
				// offset (e.g. mixed page orientations) the page paints at
				// the wrong X.
				tilePos.x = docRect.x1 + Math.round(tile.coords.x * app.pixelsToTwips);
				tilePos.y = docRect.y1 + Math.round(tile.coords.y * app.pixelsToTwips);

				// Clip the tile to page bounds. The last row/column of tiles
				// can extend up to tileSize-1 pixels past the page edge. Those
				// pixels are drawn at the canvas position of the next page
				// (vertically) or to the right of the page (horizontally) and
				// the next page may be narrower or positioned differently,
				// leaving a visible bleed strip. drawTileToCanvasCrop only
				// draws the in-page portion of the tile.
				const drawW = Math.min(RenderManager.tileSize, docRect.pWidth - tile.coords.x);
				const drawH = Math.min(RenderManager.tileSize, docRect.pHeight - tile.coords.y);
				if (drawW <= 0 || drawH <= 0) return;
				if (drawW < RenderManager.tileSize || drawH < RenderManager.tileSize) {
					this.drawTileToCanvasCrop(
						tile, this.context,
						0, 0, drawW, drawH,
						tilePos.vX - this.myTopLeft[0],
						tilePos.vY - this.myTopLeft[1],
						drawW, drawH,
					);
					return;
				}
			} else {
				// Fallback before the layout has built rectangles.
				const partHeightPixels = Math.round((this.sectionProperties.docLayer._partHeightTwips + this.sectionProperties.docLayer._spaceBetweenParts) * app.twipsToPixels);
				tilePos.pY = tile.coords.part * partHeightPixels + tile.coords.y;
			}
		}

		this.drawTileToCanvas(tile, this.context, tilePos.vX - this.myTopLeft[0], tilePos.vY - this.myTopLeft[1], RenderManager.tileSize, RenderManager.tileSize);
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	public paint (tile: any, ctx: any, async: boolean): void {
		// A scroll during the tile wait has cleared the canvas: paint what
		// has arrived (see onDraw).
		if (this.containerObject.isInZoomAnimation() ||
			(this.sectionProperties.tsManager.waitForTiles() &&
				!this.containerObject.isScrollingBeforeZoomSettled()))
			return;

		if (!ctx)
			ctx = this.sectionProperties.tsManager._paintContext();

		this.containerObject.setPenPosition(this);

		if (ctx.paneBoundsActive === true)
			this.paintWithPanes(tile, ctx, async);
		else
			this.paintSimple(tile, async);
	}

	private forEachTileInView(zoom: number, part: number, mode: number, ctx: any,
		callback: (tile: any, coords: any) => boolean) {
		var tileRanges = ctx.paneBoundsList.map(RenderManager.pxBoundsToTileRange, RenderManager);

		if (app.file.fileBasedView) {
			const coordList = RenderManager.updateFileBasedView(true);

			for (var k: number = 0; k < coordList.length; k++) {
				const tile: Tile = RenderManager.get(coordList[k]);
				if (!callback(tile, coordList[k]))
					return;
			}
		}
		else {
			for (var rangeIdx = 0; rangeIdx < tileRanges.length; ++rangeIdx) {
				var tileRange = tileRanges[rangeIdx];
				for (var j = tileRange.min.y; j <= tileRange.max.y; ++j) {
					for (var i: number = tileRange.min.x; i <= tileRange.max.x; ++i) {
						var coords = new TileCoordData(
							i * RenderManager.tileSize,
							j * RenderManager.tileSize,
							zoom,
							part,
							mode);

						const tile: Tile = RenderManager.get(coords);

						if (!callback(tile, coords))
							return;
					}
				}
			}
		}
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	public haveAllTilesInView(zoom?: number, part?: number, mode?: number, ctx?: any): boolean {
		zoom = zoom || Math.round(this.map.getZoom());
		part = part || this.sectionProperties.docLayer._selectedPart;
		ctx = ctx || this.sectionProperties.tsManager._paintContext();

		var allTilesFetched = true;
		this.forEachTileInView(zoom, part, mode, ctx, function (tile: any, coords: TileCoordData): boolean {
			// Ensure all tile are available.
			if (!tile || tile.needsFetch()) {
				// VULCAN: the view walk runs past the
				// document (x < 0 beside a centred page, beyond fileSize below
				// the fit). Those tiles are never requested (BitmapTileManager
				// update skips !isValidTile) nor painted (onDrawTileCallback),
				// so waiting for them held every zoom of a page narrower than
				// the pane to zoomStepEnd's 500 ms deadline: input off, the old
				// frame frozen, and the page blank if the reader scrolled. Wait
				// only for the tiles that can arrive.
				if (!RenderManager.isValidTile(coords))
					return true;
				allTilesFetched = false;
				return false; // stop search.
			}
			return true; // continue checking remaining tiles.
		});

		return allTilesFetched;
	}

	private drawPageBackgroundWriter (ctx: any) {
		const viewRectangleTwips = app.activeDocument.activeLayout.viewedRectangle.toArray();
		const docBg = this.containerObject.getDocumentBackgroundColor();

		// R6-15: on a phone this surface is one continuous sheet with dotted
		// creases, not a stack of cards. The per-page walk below is what draws
		// the cards, so it is replaced rather than decorated. Skeletons are
		// dropped with it: they are a per-PAGE cue for a posture that no
		// longer has separate pages, and the reflowed phone document is a
		// single page tens of thousands of twips tall, so the skeleton was one
		// enormous fake paragraph block either way.
		if (this.sectionProperties.phoneChrome) {
			this.drawPhoneWriterContinuousSurface(docBg);
			return;
		}

		// Desktop: one sheet across every page and gap, decorated after the
		// tiles (see drawDesktopWriterSheetDecoration for why after). The
		// multi-page view lays pages out in a grid, so its cards stay cards.
		if (this.sectionProperties.desktopChrome &&
			app.activeDocument.activeLayout.type !== 'ViewLayoutMultiPage') {
			this.drawDesktopWriterSheet(docBg);
			return;
		}

		for (let i: number = 0; i < app.file.writer.pageRectangleList.length; i++) {
			const simpleRectangle = new cool.SimpleRectangle(
				app.file.writer.pageRectangleList[i][0],
				app.file.writer.pageRectangleList[i][1],
				app.file.writer.pageRectangleList[i][2],
				app.file.writer.pageRectangleList[i][3]
			);

			if (!simpleRectangle.intersectsRectangle(viewRectangleTwips))
				continue;

			this.drawWriterPageBackground(simpleRectangle, docBg);
		}
	}

	/*
	 * THE DESKTOP WRITER SHEET, PAINTED AROUND THE TILES.
	 *
	 * Two facts about the page geometry decide how this has to be drawn.
	 *
	 * 1. The page is not the document. Core lays every page out inside a
	 *    DOCUMENTBORDER band -- 284 twips on all four sides; measured, a
	 *    Letter page sits at (284, 284) in a document 12808 twips wide --
	 *    and the 284-twip gap between pages is the same band. That band is
	 *    INSIDE the tiled area, and core paints its own page border and
	 *    shadow into it: a translucent line one pixel outside every page
	 *    edge, an opaque #e9e9e9 one along each side of the gap. Anything
	 *    drawn under the tiles is overpainted by exactly those pixels, so the
	 *    stock outline (drawn under) read darker where core's line and ours
	 *    added up and softer where the tile's edge anti-aliasing happened to
	 *    cover ours. Sampled on the served build: left edge 0.44 alpha,
	 *    right edge 0.20 -- same stroke, same colour. The decoration
	 *    therefore goes on AFTER the tiles, once the band has been wiped.
	 *
	 * 2. The page edge lands on a fractional pixel (x = 13.26 at 150%). A
	 *    one-pixel stroke centred there splits across two columns, and which
	 *    column the tiles then cover differs per side. Every edge used here
	 *    is rounded first, so all four sides get the same pixel.
	 *
	 * The pre-tile pass (drawDesktopWriterSheet) paints the sheet as paper
	 * -- what shows through where a tile has not arrived -- plus the loading
	 * skeleton, and records the geometry. The post-tile pass
	 * (drawDesktopWriterSheetDecoration) wipes the band, puts the drop
	 * shadow back BEHIND everything with destination-over (the paper is
	 * opaque, so it only shows in the band), turns the gaps into paper with
	 * one rule mid-gap, and strokes a single outline outside the sheet
	 * wherever the canvas has a column for it (pageOutlineStrokeRect).
	 *
	 * What that buys: one continuous sheet with a grey line where each page
	 * ends, the same soft edge on every side, and no shadow falling through
	 * a gap onto the next page.
	 */
	private planDesktopWriterSheet(): TilesSection['writerSheet'] {
		const list = app.file.writer.pageRectangleList;
		const plan = TilesSection.continuousSurfacePlan(list);
		if (!plan) return null;

		const paper = new cool.SimpleRectangle(
			plan.paper.x, plan.paper.y, plan.paper.w, plan.paper.h);
		const fileSize = app.activeDocument.fileSize;
		const doc = new cool.SimpleRectangle(0, 0, fileSize.x, fileSize.y);
		const layout = app.activeDocument.activeLayout;
		const viewY = (x: number, y: number) =>
			Math.round(layout.documentToViewY(new cool.SimplePoint(x, y)));

		const gaps: { y0: number; y1: number }[] = [];
		for (let i = 0; i + 1 < list.length; i++) {
			const a = list[i];
			const b = list[i + 1];
			if (!a || !b || a.length < 4 || b.length < 4) continue;
			const y0 = viewY(a[0], a[1] + a[3]);
			const y1 = viewY(b[0], b[1]);
			if (y1 > y0) gaps.push({ y0: y0, y1: y1 });
		}

		return {
			x0: Math.round(paper.v1X), y0: Math.round(paper.v1Y),
			x1: Math.round(paper.v2X), y1: Math.round(paper.v3Y),
			dx0: Math.round(doc.v1X), dy0: Math.round(doc.v1Y),
			dx1: Math.round(doc.v2X), dy1: Math.round(doc.v3Y),
			gaps: gaps,
			rules: plan.rules.map((r) => viewY(r.x, r.y)),
		};
	}

	// Pre-tile pass: paper under the tiles, skeleton over it, geometry kept.
	private drawDesktopWriterSheet(docBg: string): void {
		const sheet = this.planDesktopWriterSheet();
		this.writerSheet = sheet;
		if (!sheet) return;

		this.context.fillStyle = docBg;
		this.context.fillRect(
			sheet.x0, sheet.y0, sheet.x1 - sheet.x0, sheet.y1 - sheet.y0);

		if (!this.sectionProperties.skeletonNeeded) return;
		for (const p of app.file.writer.pageRectangleList) {
			const page = new cool.SimpleRectangle(p[0], p[1], p[2], p[3]);
			this.drawWriterLoadingSkeleton(
				Math.round(page.v1X), Math.round(page.v1Y), page.pWidth, page.pHeight);
		}
	}

	// Post-tile pass. Absolute view coordinates: the caller has translated
	// the context by -myTopLeft, as for drawPageBackgrounds.
	private drawDesktopWriterSheetDecoration(): void {
		const sheet = this.writerSheet;
		if (!sheet) return;

		const ctx = this.context;
		const unit = app.roundedDpiScale;
		const docBg = this.containerObject.getDocumentBackgroundColor();
		const left = this.myTopLeft[0];
		const top = this.myTopLeft[1];
		const right = left + this.size[0];
		const bottom = top + this.size[1];

		// 1. Wipe the DOCUMENTBORDER band -- the strip between the document
		//    extent and the sheet. Core's border and shadow live there, and
		//    nothing else does. Clamped to the section: a clearRect outside
		//    it is wasted work at best.
		const wipe = (x0: number, y0: number, x1: number, y1: number) => {
			const cx0 = Math.max(x0, left);
			const cy0 = Math.max(y0, top);
			const cx1 = Math.min(x1, right);
			const cy1 = Math.min(y1, bottom);
			if (cx1 > cx0 && cy1 > cy0)
				ctx.clearRect(cx0, cy0, cx1 - cx0, cy1 - cy0);
		};
		wipe(sheet.dx0, sheet.dy0, sheet.dx1, sheet.y0);
		wipe(sheet.dx0, sheet.y1, sheet.dx1, sheet.dy1);
		wipe(sheet.dx0, sheet.y0, sheet.x0, sheet.y1);
		wipe(sheet.x1, sheet.y0, sheet.dx1, sheet.y1);

		// 2. The drop shadow, behind everything. The sheet is opaque paper,
		//    so only the band just wiped shows it; a hole where a tile is
		//    still missing gets paper, which is what the pre-tile pass gave
		//    it. The fill is clamped to the section plus more than the
		//    shadow's reach, so a forty-page sheet never asks the canvas to
		//    blur forty pages: the clamped edges' shadows land off-canvas.
		const reach = 64 * unit;
		const fx0 = Math.max(sheet.x0, left - reach);
		const fy0 = Math.max(sheet.y0, top - reach);
		const fx1 = Math.min(sheet.x1, right + reach);
		const fy1 = Math.min(sheet.y1, bottom + reach);
		if (fx1 > fx0 && fy1 > fy0) {
			ctx.save();
			ctx.globalCompositeOperation = 'destination-over';
			VulcanPageShadow.paint(
				ctx, fx0, fy0, fx1 - fx0, fy1 - fy0, docBg,
				this.sectionProperties.pageShadow ?? VulcanPageShadow.DEFAULTS, unit);
			ctx.restore();
		}

		// 3. The gaps become paper, over core's lines, with one rule each.
		ctx.save();
		ctx.fillStyle = docBg;
		for (const gap of sheet.gaps) {
			if (gap.y1 <= top || gap.y0 >= bottom) continue;
			ctx.fillRect(sheet.x0, gap.y0, sheet.x1 - sheet.x0, gap.y1 - gap.y0);
		}
		ctx.strokeStyle = this.sectionProperties.pageOutlineColor;
		ctx.lineWidth = unit;
		for (const ruleY of sheet.rules) {
			const y = ruleY + unit / 2; // centred on a pixel row
			if (y < top || y > bottom) continue;
			ctx.beginPath();
			ctx.moveTo(sheet.x0, y);
			ctx.lineTo(sheet.x1, y);
			ctx.stroke();
		}

		// 4. One outline, one device pixel, outside the sheet wherever the
		//    canvas has a column for it. At the text fit the sheet's sides
		//    sit on or past the section's sides, and a stroke outside them
		//    is off canvas -- the owner's "top edge has a hairline, the
		//    sides have none". pageOutlineStrokeRect keeps each side's
		//    column on canvas (see its comment for the per-axis rule); this
		//    pass runs after the tiles, so a column on the sheet's own edge
		//    pixel survives.
		const outline = TilesSection.pageOutlineStrokeRect(
			sheet.x0, sheet.y0, sheet.x1 - sheet.x0, sheet.y1 - sheet.y0, unit,
			{ left: left, top: top, right: right, bottom: bottom });
		ctx.strokeRect(outline.x, outline.y, outline.w, outline.h);
		ctx.restore();
	}

	// Fill a single Writer page with the document background colour and paint a
	// loading skeleton over it. The rectangle's view-space getters place the
	// page (honouring its tile mode), so this works for both the inline and the
	// side-by-side compare-changes views.
	private drawWriterPageBackground(rectangle: cool.SimpleRectangle, docBg: string): void {
		// Soft drop shadow, attached to the page fill itself: the tiles later
		// over-paint the page interior, but the shadow pixels land outside the
		// page rect and survive, making the page read as a floating card over
		// the transparent workspace. Desktop chrome only: canvas shadowBlur is
		// real per-page paint cost and mobile keeps the stock flat pages.
		if (this.sectionProperties.desktopChrome) {
			// Same edges strokePageOutline uses below (rectangle's own far
			// edges, not v1 + pWidth — see the note there).
			VulcanPageShadow.paint(
				this.context,
				rectangle.v1X, rectangle.v1Y,
				rectangle.v2X - rectangle.v1X, rectangle.v3Y - rectangle.v1Y,
				docBg, this.sectionProperties.pageShadow ?? VulcanPageShadow.DEFAULTS, app.roundedDpiScale);
		} else {
			this.context.fillStyle = docBg;
			this.drawViewRectangle(rectangle, true);
		}

		// Crisp page edge, stroked just outside the bounds so tiles can't
		// cover it. Between the rectangle's own far edges, not v1 + pWidth:
		// pWidth is rounded on its own, and at a fractional origin that put
		// the right-hand line one pixel past where the fill above ends.
		this.strokePageOutline(
			rectangle.v1X, rectangle.v1Y,
			rectangle.v2X - rectangle.v1X, rectangle.v3Y - rectangle.v1Y);

		// Position from the view-space top-left; the page size is scale-only and
		// independent of the column offset, so read it from the pixel getters.
		//
		// ONLY WHILE TILES ARE ACTUALLY MISSING. This used to run on every
		// frame for every visible page, painting a 9-shape roundRect skeleton
		// that the tiles over-painted microseconds later -- pure waste on the
		// scroll path, which is the one path the phone cannot afford it on.
		// It is also a correctness thing, not just cost: a skeleton drawn over
		// real content is a flicker of fake paragraphs across text the reader
		// is in the middle of.
		if (this.sectionProperties.skeletonNeeded) {
			this.drawWriterLoadingSkeleton(
				rectangle.v1X, rectangle.v1Y, rectangle.pWidth, rectangle.pHeight);
		}
	}

	// Paint a skeleton of a heading + a few paragraph lines on a Writer page
	// before tiles arrive and over-paint that; FIXME: eventually writer tiles
	// should be transparent, and we'll need to clip this.
	private drawWriterLoadingSkeleton(px: number, py: number, pw: number, ph: number): void {
		// Roughly mirror a 1" margin on so the skeleton sits inside
		// the would-be text frame rather than against the page edge.
		const marginX = Math.round(pw * 0.12);
		const marginY = Math.round(ph * 0.12);
		const textLeft = px + marginX;
		const textTop = py + marginY;
		const textWidth = pw - 2 * marginX;
		if (textWidth <= 0)
			return;

		const headingHeight = Math.max(8, Math.round(ph * 0.035));
		const headingWidth = Math.round(textWidth * 0.55);
		const lineHeight = Math.max(4, Math.round(ph * 0.014));
		const lineGap = Math.max(3, Math.round(ph * 0.014));
		const paragraphGap = Math.max(6, Math.round(ph * 0.025));
		const radius = Math.max(2, Math.round(lineHeight * 0.5));

		// Heading.
		this.context.fillStyle = this.sectionProperties.skeletonHeadingColor;
		this.roundedFillRect(textLeft, textTop, headingWidth, headingHeight, Math.max(3, Math.round(headingHeight * 0.35)));

		// Paragraph lines: two short paragraphs with a ragged last line, so it
		// reads as prose rather than a UI placeholder.
		this.context.fillStyle = this.sectionProperties.skeletonLineColor;
		const lineWidths = [1.0, 0.97, 0.94, 0.62, /* gap */ 0.98, 0.95, 0.93, 0.45];
		const gapAfter = 3; // index 3 is the last line of the first paragraph.

		let y = textTop + headingHeight + paragraphGap;
		for (let i = 0; i < lineWidths.length; i++) {
			const w = Math.round(textWidth * lineWidths[i]);
			if (y + lineHeight > py + ph - marginY)
				break;
			this.roundedFillRect(textLeft, y, w, lineHeight, radius);
			y += lineHeight + lineGap;
			if (i === gapAfter)
				y += paragraphGap;
		}
	}

	private roundedFillRect(x: number, y: number, w: number, h: number, r: number): void {
		const ctx = this.context as any;
		if (typeof ctx.roundRect === 'function') {
			ctx.beginPath();
			ctx.roundRect(x, y, w, h, r);
			ctx.fill();
			return;
		}
		// Fallback for older canvas implementations.
		const rr = Math.min(r, w * 0.5, h * 0.5);
		ctx.beginPath();
		ctx.moveTo(x + rr, y);
		ctx.lineTo(x + w - rr, y);
		ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
		ctx.lineTo(x + w, y + h - rr);
		ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
		ctx.lineTo(x + rr, y + h);
		ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
		ctx.lineTo(x, y + rr);
		ctx.quadraticCurveTo(x, y, x + rr, y);
		ctx.closePath();
		ctx.fill();
	}

	private drawPageBackgroundFileBasedView (ctx: any) {
		const layout = app.activeDocument.activeLayout as ViewLayoutFileBased;
		if (!layout || !layout.documentRectangles || layout.documentRectangles.length === 0)
			return;

		const viewRectTwips = app.activeDocument.activeLayout.viewedRectangle.toArray();
		const innerMargin = this.sectionProperties.pageBackgroundInnerMargin;
		const docBg = this.containerObject.getDocumentBackgroundColor();

		for (let i = 0; i < layout.documentRectangles.length; i++) {
			const docRect = layout.documentRectangles[i];

			if (!docRect.intersectsRectangle(viewRectTwips)) continue;

			// v1X/v1Y route through activeLayout.documentToViewX/Y, so the
			// centering offset and scroll are applied exactly once - matching
			// where paintSimple places tiles. The caller has already
			// translate()-d the canvas by -myTopLeft.
			// Inset by innerMargin on all four sides: the top-left point shifts
			// right/down by innerMargin and the width/height shrink by twice
			// that to leave a matching margin on the right/bottom.
			const x = docRect.v1X + innerMargin;
			const y = docRect.v1Y + innerMargin;
			const w = (docRect.v2X - docRect.v1X) - 2 * innerMargin;
			const h = (docRect.v3Y - docRect.v1Y) - 2 * innerMargin;

			// Same floating-card treatment as the Writer view: shadow attached
			// to the page fill (only its outside pixels survive the tiles) and
			// an outline stroked just outside the bounds. save()/restore()
			// keeps fillStyle = pageBackgroundTextColor (set by the caller)
			// intact for the page number below. Shadow is desktop-only (see
			// drawWriterPageBackground).
			this.context.save();
			if (this.sectionProperties.desktopChrome) {
				VulcanPageShadow.paint(
					this.context, x, y, w, h, docBg,
					this.sectionProperties.pageShadow ?? VulcanPageShadow.DEFAULTS, app.roundedDpiScale);
			} else {
				this.context.fillStyle = docBg;
				this.context.fillRect(x, y, w, h);
			}
			this.context.restore();

			this.strokePageOutline(x, y, w, h);

			// Google Slides never stamps a number across a slide, and on a
			// phone this one is not a watermark, it is an obstruction: the
			// font is 40 CSS px against a slide that now fits the viewport
			// (846dce9), it paints in --vulcan-muted at 4.7:1 over the paper,
			// and it is not even centred — textAlign is never set, so it falls
			// back to `start` and hangs off the middle to the right.
			//
			// The information it carries is already in the phone chrome, done
			// properly: the filmstrip renders a .preview-slide-number under
			// every thumbnail and marks the current slide with the accent
			// border (vulcan-theme.css §13i.3/§13i.4), and it is on screen
			// during the read phase — UIManager show()s the wrapper for every
			// presentation and read-only only adds a class. So this is not a
			// capability being cut, it is the same fact drawn twice, once over
			// the content. Drop the on-slide copy; keep the chrome one.
			//
			// Phone only: desktop and tablet read-only decks are a different
			// surface (no phone filmstrip treatment, page-sized pages, cursor
			// not finger) and keep the stock numeral.
			if (!this.sectionProperties.phoneChrome) {
				this.context.fillText(
					String(i + 1),
					Math.round(x + w * 0.5),
					Math.round(y + h * 0.5),
					w * 0.4,
				);
			}
		}
	}

	// Decorate the single slide of a phone Impress EDIT session — the one page
	// in this file that gets no decoration at all, because the guard in
	// drawPageBackgrounds sends every presentation that is not in
	// fileBasedView straight back out.
	//
	// On desktop that costs nothing: vulcan-theme.css §3 makes the workspace
	// transparent there, so the paper already reads as a card over the
	// host background behind the iframe. The phone deliberately keeps the
	// stock OPAQUE canvas (the §2 --color-canvas override is scoped
	// html.vulcan-desktop-chrome), which leaves white paper on #f0f0f0 —
	// a 1.14:1 surface step, 1.02:1 in dark (#121212 on #141414) — and no
	// line anywhere. The slide has no edge; it bleeds into the workspace.
	//
	// So paint the same page treatment every other page in this file already
	// gets on mobile — flat fill plus the --vulcan-page-outline hairline —
	// and nothing new. Light: rgba(15,23,42,0.28) over the #f0f0f0 workspace
	// resolves to rgb(177,179,185), 2.09:1 against the white slide and 1.84:1
	// against the workspace. Dark: rgba(255,255,255,0.22) over #141414
	// resolves to #484848, 2.04:1 against the #121212 slide and 2.00:1
	// against the workspace. Both sides of the line carry contrast, which is
	// what makes it read as an edge rather than as one more surface step.
	private drawPhoneImpressSlideBackground(): void {
		const docLayer = this.sectionProperties.docLayer;
		const widthTwips = docLayer._partWidthTwips;
		const heightTwips = docLayer._partHeightTwips;
		if (!(widthTwips > 0) || !(heightTwips > 0))
			return;

		// partBasedView lays the selected slide out from the document origin,
		// so the slide IS the document extent. Read it from the layer's
		// single-part dimensions rather than app.activeDocument.fileSize:
		// fileSize is the stacked extent whenever fileBasedView is on and is
		// only collapsed back on the view-mode flip, whereas these two always
		// hold the current part. v1X/v1Y then route through the layout's
		// documentToViewX/Y, the same mapping paintSimple uses to place the
		// tiles that fill this rectangle, so the frame cannot drift from what
		// it frames.
		const slide = new cool.SimpleRectangle(0, 0, widthTwips, heightTwips);
		const x = slide.v1X;
		const y = slide.v1Y;
		const w = slide.pWidth;
		const h = slide.pHeight;

		// Flat fill, exactly like drawWriterPageBackground's non-desktop
		// branch: paper-coloured from the first frame instead of workspace
		// grey until tiles land, and the tiles then over-paint the interior.
		this.context.fillStyle = this.containerObject.getDocumentBackgroundColor();
		this.context.fillRect(x, y, w, h);

		// No drop shadow, and NOT only for the per-page cost reason the rest of
		// this file gives — here it would make the dark edge worse. The outline
		// is stroked entirely outside the paper, so its backdrop is the
		// workspace; a shadow darkens exactly those pixels, and the dark token
		// is a translucent WHITE line, which then has less to sit against.
		// Measured against the slide: 2.04:1 outline-only versus 1.88:1 with
		// the shadow under it. Dark is the mode that starts worst (a 1.02:1
		// step, #121212 slide on #141414 canvas), so trading its edge away for
		// light-mode depth is backwards.
		//
		// strokePageOutline's lineWidth is app.roundedDpiScale — DEVICE pixels,
		// i.e. one CSS px at any integer DPR (3 device px at DPR 3), never the
		// third-of-a-CSS-pixel line a literal 1 would give.
		this.strokePageOutline(x, y, w, h);
	}

	private drawPageBackgrounds (ctx: any) {
		if (!this.containerObject.getDocumentAnchorSection())
			return;

		if (!app.file.fileBasedView && this.map._docLayer._docType !== 'text') {
			// Phone Impress in edit mode is the sole exception to this guard.
			// isImpress() is presentation-only, so Draw never reaches it, and
			// the phoneChrome test keeps desktop and tablet on the stock
			// no-decoration path they have today.
			if (this.sectionProperties.phoneChrome && this.map._docLayer.isImpress())
				this.drawPhoneImpressSlideBackground();
			return;
		}

		this.context.fillStyle = this.sectionProperties.pageBackgroundTextColor;
		this.context.strokeStyle = this.sectionProperties.pageBackgroundBorderColor;
		this.context.lineWidth = app.roundedDpiScale;

		this.context.font = this.sectionProperties.pageBackgroundFont;

		if (app.file.fileBasedView)
			this.drawPageBackgroundFileBasedView(ctx);
		else if (this.map._docLayer._docType === 'text')
			this.drawPageBackgroundWriter(ctx);
	}

	private drawForViewLayoutMultiPage() {
		Util.ensureValue(app.activeDocument);

		const view = app.activeDocument.activeLayout as ViewLayoutMultiPage;

		const visibleCoordList: Array<TileCoordData> = view.getCurrentCoordList();
		const tileSize = RenderManager.tileSize;

		for (let i = 0; i < visibleCoordList.length; i++) {
			const tile = RenderManager.get(visibleCoordList[i]);

			if (!(tile && tile.isReadyToDraw())) continue;

			const tilePos = tile.coords.getPosSimplePoint();

			// Core tiles live on a single continuous stacked-document grid. In
			// multipage view the pages are re-laid into a grid, so one tile can
			// overlap several pages (two vertically-consecutive pages, three when
			// a page is shorter than a tile, and the area beyond a narrow page's
			// right edge). Clip the tile to each page it overlaps in document
			// space and blit only that intersection into the page's grid cell.
			// This handles horizontal clipping, inter-page gaps and degenerate
			// (0x0) pages uniformly.
			const tx1 = tilePos.pX;
			const ty1 = tilePos.pY;
			const tx2 = tx1 + tileSize;
			const ty2 = ty1 + tileSize;

			for (let p = 0; p < view.documentRectangles.length; p++) {
				const pr = view.documentRectangles[p];

				const ix1 = Math.max(tx1, pr.pX1);
				const iy1 = Math.max(ty1, pr.pY1);
				const ix2 = Math.min(tx2, pr.pX2);
				const iy2 = Math.min(ty2, pr.pY2);

				if (ix2 <= ix1 || iy2 <= iy1) continue; // No overlap with this page.

				const sx = ix1 - tx1;
				const sy = iy1 - ty1;
				const sw = ix2 - ix1;
				const sh = iy2 - iy1;

				const screen = view.documentPointToScreenWithIndex(
					cool.SimplePoint.fromCorePixels([ix1, iy1]),
					p,
				);

				this.drawTileToCanvasCrop(
					tile,
					this.context,
					sx,
					sy,
					sw,
					sh,
					screen.x,
					screen.y,
					sw,
					sh,
				);
			}
		}
	}

	// The side-by-side compare-changes view renders each page twice (the
	// original on the left, the current document on the right). Draw the page
	// background + loading skeleton for both columns so pages whose tiles have
	// not arrived yet show a placeholder, matching the inline Writer view.
	private drawPageBackgroundsCompareChanges() {
		if (this.map._docLayer._docType !== 'text')
			return;

		if (!this.containerObject.getDocumentAnchorSection())
			return;

		const viewRectangleTwips = app.activeDocument.activeLayout.viewedRectangle.toArray();
		const docBg = this.containerObject.getDocumentBackgroundColor();

		for (const mode of [TileMode.LeftSide, TileMode.RightSide]) {
			for (let i = 0; i < app.file.writer.pageRectangleList.length; i++) {
				const rect = app.file.writer.pageRectangleList[i];

				// Both columns show the same pages; set the tile mode so the
				// rectangle's view-space getters resolve to the correct (left or
				// right) column.
				const pageRectangle = new cool.SimpleRectangle(
					rect[0], rect[1], rect[2], rect[3], -1, mode);

				if (!pageRectangle.intersectsRectangle(viewRectangleTwips))
					continue;

				this.drawWriterPageBackground(pageRectangle, docBg);
			}
		}
	}

	private drawForViewLayoutCompareChanges() {
		Util.ensureValue(app.activeDocument);

		const view = app.activeDocument.activeLayout as ViewLayoutCompareChanges;

		const visibleCoordList: Array<TileCoordData> = view.getCurrentCoordList();

		for (let i = 0; i < visibleCoordList.length; i++) {
			const tile = RenderManager.get(visibleCoordList[i]);

			if (tile && tile.isReadyToDraw()) {
				const tilePos = tile.coords.getPosSimplePoint();

				this.drawTileToCanvas(tile, this.context, tilePos.vX, tilePos.vY, RenderManager.tileSize, RenderManager.tileSize);
			}
		}
	}

	public onDraw (frameCount: number = null, elapsedTime: number = null): void {
		if (this.containerObject.isInZoomAnimation()) {
			// While a zoom animation runs the tiles are painted scaled from the
			// zoom frame rather than at their normal positions.
			this.drawZoomFrame();
			return;
		}

		// A normal draw means any zoom animation is over; the next one
		// re-picks its tile sources.
		this.zoomSourceCache = null;

		if (this.containerObject.testing) {
			this.containerObject.createUpdateSingleDivElement(this);
		}

		// Calculate all this here instead of doing it per tile.
		var ctx = this.sectionProperties.tsManager._paintContext();

		if (app.activeDocument && app.activeDocument.activeLayout.type === 'ViewLayoutMultiPage') {
			this.context.translate(-this.myTopLeft[0], -this.myTopLeft[1]);
			this.drawPageBackgrounds(ctx);
			this.drawForViewLayoutMultiPage();
			this.context.translate(this.myTopLeft[0], this.myTopLeft[1]);
			return;
		}
		else if (app.activeDocument.activeLayout.type === 'ViewLayoutCompareChanges') {
			this.context.translate(-this.myTopLeft[0], -this.myTopLeft[1]);
			this.drawPageBackgroundsCompareChanges();
			this.drawForViewLayoutCompareChanges();
			this.context.translate(this.myTopLeft[0], this.myTopLeft[1]);
			return;
		}

		var zoom = Math.round(this.map.getZoom());
		var part = this.sectionProperties.docLayer._selectedPart;
		var mode = app.activeDocument.activeModes[0];

		// A frame that skips the backgrounds must not decorate last frame's.
		this.writerSheet = null;

		// Decide ONCE per draw whether the loading skeleton is wanted, and hand
		// it to the page painters below rather than letting each page work it
		// out. haveAllTilesInView is the same test the waitForTiles branch
		// already runs, so on that path this costs nothing new.
		this.sectionProperties.skeletonNeeded = !this.haveAllTilesInView(
			zoom, part, mode, ctx);

		// While a zoom waits for its tiles the canvas is not cleared, and the
		// last frame stays up until they arrive. A scroll in that window makes
		// the container clear every frame (ViewLayoutBase.scroll), so there is
		// no last frame left to keep: paint the page, the tiles that have
		// arrived and the skeleton for the rest, not an empty page until the
		// zoom settles.
		const waitForTiles = this.sectionProperties.tsManager.waitForTiles();
		const repaintAfterScroll = waitForTiles &&
			this.containerObject.isScrollingBeforeZoomSettled();

		if (waitForTiles && !repaintAfterScroll) {
			if (this.sectionProperties.skeletonNeeded)
				return;
		} else if (!this.containerObject.isZoomChanged() || repaintAfterScroll) {
			// Don't show page border and page numbers (drawn by drawPageBackgrounds) if zoom is changing
			// after a zoom animation, unless a scroll has cleared the last frame.

			// drawPageBackgroundWriter uses absolute view coordinates (v1X, v1Y etc.)
			// but the context is already translated by myTopLeft (by the section container).
			// Compensate for this offset, same as the multipage view path.
			this.context.translate(-this.myTopLeft[0], -this.myTopLeft[1]);
			this.drawPageBackgrounds(ctx);
			this.context.translate(this.myTopLeft[0], this.myTopLeft[1]);
		}

		// Coords can only repeat where split-pane tile ranges overlap (Calc);
		// the single-pane path skips the dedup Set. The callback is a class
		// field bound once, not a fresh closure per frame — onDraw runs every
		// frame.
		this.onDrawDoneTiles = ctx.paneBoundsActive === true ? new Set() : null;
		this.onDrawPaintCtx = ctx;
		this.forEachTileInView(zoom, part, mode, ctx, this.onDrawTileCallback);
		this.onDrawPaintCtx = null;
		this.onDrawDoneTiles = null;

		// The desktop Writer sheet's edge, shadow and seams go on over the
		// tiles: core paints its own page border into the band around the
		// page, and only a pass after the tiles can take it back.
		if (this.writerSheet) {
			this.context.translate(-this.myTopLeft[0], -this.myTopLeft[1]);
			this.drawDesktopWriterSheetDecoration();
			this.context.translate(this.myTopLeft[0], this.myTopLeft[1]);
		}
	}

	private onDrawDoneTiles: Set<string> | null = null;
	private onDrawPaintCtx: any = null;

	private onDrawTileCallback = (tile: any, coords: TileCoordData): boolean => {
		const doneTiles = this.onDrawDoneTiles;
		if (doneTiles && doneTiles.has(coords.key()))
			return true;

		// Ensure tile is within document bounds.
		if (tile && RenderManager.isValidTile(coords)) {
			if (!this.isJSDOM) { // perf-test code
				if (tile.isReadyToDraw() || this.map._debug.tileOverlaysOn) { // Ensure tile is loaded
					// Telemetry: 1-in-N sampled paint duration (histogram
					// flushed once per session) + first-paint milestone.
					// The unsampled path costs one boolean and a counter.
					if (app.telemetry && app.telemetry.shouldSampleTilePaint()) {
						const paintStart = performance.now();
						this.paint(tile, this.onDrawPaintCtx, false /* async? */);
						app.telemetry.sampleTilePaint(performance.now() - paintStart);
					} else {
						this.paint(tile, this.onDrawPaintCtx, false /* async? */);
					}
					if (app.telemetry && !app.telemetry.firstTilePainted)
						app.telemetry.noteFirstTilePaint();
				}
			}
		}
		if (doneTiles)
			doneTiles.add(coords.key());
		return true; // continue with remaining tiles.
	};

	public onClick(point: cool.SimplePoint, e: MouseEvent): void {
		// Slides pane is not focusable, we are using a variable to follow its focused state.
		// Until the pane is focusable, we will need to keep below check here.
		if (this.map._docLayer._docType === 'presentation' || this.map._docLayer._docType === 'drawing')
			this.map._docLayer._preview.partsFocused = false; // Parts (slide preview pane) is no longer focused, we need to set this here to avoid unwanted behavior.
	}

	// Return the fraction of intersection area with area1.
	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	static getTileIntersectionAreaFraction(tileBounds: any, viewBounds: any): number {

		var size = tileBounds.getSize();
		if (size.x <= 0 || size.y <= 0)
			return 0;

		var intersection = new cool.Bounds(
			new cool.Point(
				Math.max(tileBounds.min.x, viewBounds.min.x),
				Math.max(tileBounds.min.y, viewBounds.min.y)),
			new cool.Point(
				Math.min(tileBounds.max.x, viewBounds.max.x),
				Math.min(tileBounds.max.y, viewBounds.max.y))
		);

		var interSize = intersection.getSize();
		return Math.max(0, interSize.x) * Math.max(0, interSize.y) / (size.x * size.y);
	}

	private forEachTileInArea(area: any, zoom: number, part: number, mode: number, ctx: any,
		callback: (tile: any, coords: TileCoordData, section: TilesSection) => boolean) {

		if (app.file.fileBasedView) {
			const coordList = RenderManager.updateFileBasedView(true, area, zoom);

			for (var k: number = 0; k < coordList.length; k++) {
				const coords = coordList[k];
				const tile: Tile = RenderManager.get(coords);
				if (tile)
					callback(tile, coords, this);
			}

			return;
		}

		var tileRange = RenderManager.pxBoundsToTileRange(area);

		for (var j = tileRange.min.y; j <= tileRange.max.y; ++j) {
			for (var i = tileRange.min.x; i <= tileRange.max.x; ++i) {
				const coords = new TileCoordData(
					i * RenderManager.tileSize,
					j * RenderManager.tileSize,
					zoom,
					part,
					mode);

				const tile: Tile = RenderManager.get(coords);
				if (tile)
					callback(tile, coords, this);
			}
		}
	}

	/**
	 * Used for rendering a zoom-out frame, to determine which zoom level tiles
	 * to use for rendering.
	 *
	 * @param area specifies the document area in core-pixels at the current
	 * zoom level.
	 *
	 * @returns the zoom-level with maximum tile content, or null when no
	 * level holds a usable tile (a result the caller must not cache).
	 */
	private zoomLevelWithMaxContentInArea(area: any,
		areaZoom: number, part: number, mode: number, ctx: any): number | null {

		var frameScale = this.sectionProperties.tsManager._zoomFrameScale;
		var targetZoom = Math.round(this.map.getScaleZoom(frameScale, areaZoom));
		var area = area.clone();
		if (area.min.x < 0)
			area.min.x = 0;
		if (area.min.y < 0)
			area.min.y = 0;

		var minZoom = <number> this.map.options.minZoom;
		var maxZoom = <number> this.map.options.maxZoom;

		// Scanning every rung walked (and allocated coords + a key string
		// for) each candidate tile per rung per pane per frame -- the
		// measured Impress pinch-out jank. Sources far from the target are
		// scaled past usefulness anyway, so scan a window around it; a cache
		// holding only far rungs still resolves through the full-scan
		// fallback.
		var best = this.bestZoomInRange(area, areaZoom, part, mode, ctx, targetZoom,
			Math.max(minZoom, targetZoom - 2), Math.min(maxZoom, targetZoom + 2));
		if (best === null)
			best = this.bestZoomInRange(area, areaZoom, part, mode, ctx, targetZoom,
				minZoom, maxZoom);
		return best;
	}

	// The previous full-scan body, over an inclusive zoom range. Returns null
	// when no rung in the range holds a tile with content.
	private bestZoomInRange(area: any, areaZoom: number, part: number, mode: number,
		ctx: any, targetZoom: number, fromZoom: number, toZoom: number): number | null {

		var maxZoom = <number> this.map.options.maxZoom;
		var bestZoomLevel: number | null = null;
		var availAreaScoreAtBestZL = -Infinity; // Higher the better.

		for (var zoom = fromZoom; zoom <= toZoom; ++zoom) {
			var availAreaScore = 0; // Higher the better.
			var hasTiles = false;

			// To scale up missing-area scores to maxZoom as we need an
			// good resolution integer score at the end.
			var dimensionCorrection = this.map.zoomToFactor(maxZoom - zoom + this.map.options.zoom);

			// Compute area for zoom-level 'zoom'.
			var areaAtZoom = this.scaleBoundsForZoom(area, zoom, areaZoom);
			var relScale = this.map.getZoomScale(zoom, areaZoom);

			this.forEachTileInArea(areaAtZoom, zoom, part, mode, ctx, function(tile, coords, section) {
				if (tile && tile.image) {
					var tilePos = coords.getPos();

					if (app.file.fileBasedView) {
						var layout = app.activeDocument.activeLayout;
						if (layout && layout.type === 'ViewLayoutFileBased') {
							var ratio = RenderManager.tileSize * relScale / app.tile.size.y;
							// DOC-space rect (X=0 baseline), matching the
							// space `area` is in -- see drawZoomFrame's
							// R6-11 comment for the frame-mixing bug the
							// VIEW rect caused here.
							var rect = (layout as ViewLayoutFileBased).getDocumentPartRectAtRatio(coords.part, ratio);
							if (rect) {
								tilePos.x = rect.x + tilePos.x;
								tilePos.y = rect.y + tilePos.y;
							}
						}
					}

					var tileBounds = new cool.Bounds(tilePos, tilePos.add(new cool.Point(RenderManager.tileSize, RenderManager.tileSize)));
					var interFrac = TilesSection.getTileIntersectionAreaFraction(tileBounds, areaAtZoom);

					// Add to score how much of tile area is available.
					availAreaScore += interFrac;
					if (!hasTiles)
						hasTiles = true;
				}

				return true;
			});

			if (!hasTiles)
				continue;

			// Scale up with a correction factor to make area scores comparable b/w zoom levels.
			availAreaScore = Math.round(availAreaScore
				* dimensionCorrection /* width */
				* dimensionCorrection /* height */
				/ 10 /* resolution control */);

			// Accept this zoom if it has a lower missing-area score
			// In case of a tie we prefer tiles from a zoom level closer to targetZoom.
			if (bestZoomLevel === null ||
				availAreaScore > availAreaScoreAtBestZL ||
				(availAreaScore == availAreaScoreAtBestZL && Math.abs(targetZoom - bestZoomLevel) > Math.abs(targetZoom - zoom))) {
				availAreaScoreAtBestZL = availAreaScore;
				bestZoomLevel = zoom;
			}
		}

		return bestZoomLevel;
	}

	// One zoom animation reuses its chosen tile source per pane: the rung
	// scan's answer only moves when the frame nears a different rung, so
	// rescan when the scale drifts more than half a rung from where the
	// cache was computed (or the rung/part/mode changes); any normal draw
	// in onDraw marks the animation over and drops the cache. An empty scan
	// is never cached, so tiles arriving mid-animation are picked up.
	private zoomSourceCache: { fracZoom: number, zoom: number, part: number,
		mode: number, byPane: number[] } | null = null;

	private zoomSourceForFrame(docRange: any, zoom: number, part: number,
		mode: number, ctx: any, paneIndex: number): number {

		var frameScale = this.sectionProperties.tsManager._zoomFrameScale;
		var fracZoom = this.map.getScaleZoom(frameScale, zoom);
		var cache = this.zoomSourceCache;

		if (cache && (cache.zoom !== zoom || cache.part !== part || cache.mode !== mode ||
			Math.abs(cache.fracZoom - fracZoom) > 0.5))
			cache = null;
		if (!cache)
			cache = this.zoomSourceCache = { fracZoom: fracZoom, zoom: zoom, part: part, mode: mode, byPane: [] };

		var src = cache.byPane[paneIndex];
		if (src === undefined) {
			var found = this.zoomLevelWithMaxContentInArea(docRange, zoom, part, mode, ctx);
			if (found === null) // nothing usable yet: same answer the old empty scan gave, rescanned next frame.
				return Math.round(fracZoom);
			cache.byPane[paneIndex] = src = found;
		}
		return src;
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	public drawTileToCanvas(tile: any, canvas: CanvasRenderingContext2D,
							dx: number, dy: number, dWidth: number, dHeight: number): void
	{
		this.drawTileToCanvasCrop(tile, canvas,
								  0, 0, RenderManager.tileSize, RenderManager.tileSize,
								  dx, dy, dWidth, dHeight);
	}

	private drawDebugHistogram(canvas: CanvasRenderingContext2D, x: number, y: number, value: number, offset: number)
	{
			const tSize = 256;
			const deltaSize = 4;
			var maxDeltas = (tSize - 16) / deltaSize;

			// offset vertically down to 'offset'
			const yoff = Math.floor(offset / maxDeltas);
			y += yoff * deltaSize;
			offset -= yoff * maxDeltas;

			var firstRowFill = Math.min(value, maxDeltas - offset);

			// fill first row from offset
			if (firstRowFill > 0)
				canvas.fillRect(x + offset * deltaSize, y, firstRowFill * deltaSize, deltaSize);

			// render the rest:
			value = value - firstRowFill;

			// central rectangle
			var rowBlock = Math.floor(value / maxDeltas);

			if (rowBlock > 0)
				canvas.fillRect(x, y + deltaSize, maxDeltas * deltaSize, rowBlock * deltaSize);

			// Fill last row
			var rowLeft = value % maxDeltas;
			if (rowLeft > 0)
				canvas.fillRect(x, y + rowBlock * deltaSize + deltaSize, rowLeft * deltaSize, deltaSize);
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	public drawTileToCanvasCrop(tile: any, canvas: CanvasRenderingContext2D,
								sx: number, sy: number, sWidth: number, sHeight: number,
								dx: number, dy: number, dWidth: number, dHeight: number): void
	{
		RenderManager.touchImage(tile);

		/* if (!(tile.wireId % 4)) // great for debugging tile grid alignment.
				canvas.drawImage(this.checkpattern, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight);
		else */
		if (tile.image)
			canvas.drawImage(tile.image, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight);

		if (this.map._debug.tileOverlaysOn)
		{
			this.beforeDraw(canvas);

			// clipping push - normally we avoid clipping for perf.
			canvas.save();
			const clipRegion = new Path2D();
			clipRegion.rect(dx, dy, dWidth, dHeight);
			canvas.clip(clipRegion);

			// want to render our bits 'inside' the tile - but we may have only part of it.
			// so offset our rendering and rely on clipping to help.
			const ox = -sx;
			const oy = -sy;
			const tSize = 256;

			// blue boundary line on tiles
			canvas.lineWidth = 1;
			canvas.strokeStyle = 'rgba(0, 0, 255, 0.8)';
			canvas.beginPath();
			canvas.moveTo(ox + dx + 0.5, oy + dy + 0.5);
			canvas.lineTo(ox + dx + 0.5, oy + dy + tSize + 0.5);
			canvas.lineTo(ox + dx + tSize + 0.5, oy + dy + tSize + 0.5);
			canvas.lineTo(ox + dx + tSize + 0.5, oy + dy + 0.5);
			canvas.lineTo(ox + dx + 0.5, oy + dy + 0.5);
			canvas.stroke();

			// state of the tile
			if (!tile.hasContent())
				canvas.fillStyle = 'rgba(255, 0, 0, 0.8)';   // red
			else if (tile.needsFetch())
				canvas.fillStyle = 'rgba(255, 255, 0, 0.8)'; // yellow
			else if (!tile.isReady())
				canvas.fillStyle = 'rgba(0, 160, 0, 0.8)'; // dark green
			else // present
				canvas.fillStyle = 'rgba(0, 255, 0, 0.5)';   // green
			canvas.fillRect(ox + dx + 1.5, oy + dy + 1.5, 12, 12);

			// deltas graph
			if (tile.deltaCount)
			{
				// blue/grey deltas
				canvas.fillStyle = 'rgba(0, 0, 256, 0.3)';
				this.drawDebugHistogram(canvas, ox + dx + 1.5 + 14, oy + dy + 1.5, tile.deltaCount, 0);
				// yellow/grey deltas
				canvas.fillStyle = 'rgba(256, 256, 0, 0.3)';
				this.drawDebugHistogram(canvas, ox + dx + 1.5 + 14, oy + dy + 1.5, tile.updateCount, tile.deltaCount);
			}

			// Metrics on-top of the tile:
			var lines = [
				'wireId: ' + tile.wireId,
				'invalidFrom: ' + tile.invalidFrom,
				'nviewid: ' + tile.viewId,
				'invalidates: ' + tile.invalidateCount,
				'tile: ' + tile.loadCount + ' \u0394: ' + tile.deltaCount + ' upd: ' + tile.updateCount,
				'misses: ' + tile.missingContent + ' gce: ' + tile.gcErrors,
				'dlta size/kB: ' + ((tile.rawDeltas ? tile.rawDeltas.length : 0)/1024).toFixed(2)
			];

			// FIXME: generate metrics of how long a tile has been visible & invalid for.
			//			if (tile._debugTime && tile._debugTime.date !== 0)
			//					lines.push(this.map._debug.updateTimeArray(tile._debugTime, +new Date() - tile._debugTime.date));

			const startY = tSize - 12 * lines.length;

			// background
			canvas.fillStyle = 'rgba(220, 220, 220, 0.5)'; // greyish
			canvas.fillRect(ox + dx + 1.5, oy + dy + startY - 12.0, 100, 12 * lines.length + 8.0);

			canvas.font = '12px sans';
			canvas.fillStyle = 'rgba(0, 0, 0, 1.0)';   // black
			canvas.textAlign = 'left';
			for (var i = 0 ; i < lines.length; ++i)
					canvas.fillText(lines[i], ox + dx + 5.5, oy + dy + startY + i*12);

			canvas.restore();
			this.afterDraw(canvas);
		}
	}

	// Called by tsManager to draw a zoom animation frame.
	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	public drawZoomFrame(): void {
		var tsManager = this.sectionProperties.tsManager;
		if (!tsManager._inZoomAnim)
			return;

		var scale = tsManager._zoomFrameScale;
		if (!scale || !tsManager._newCenter)
			return;

		var ctx = this.sectionProperties.tsManager._paintContext();
		var docLayer = this.sectionProperties.docLayer;
		var zoom = Math.round(this.map.getZoom());
		var part = docLayer._selectedPart;
		var mode = app.activeDocument.activeModes[0];
		var splitPos = ctx.splitPos;

		this.containerObject.setPenPosition(this);
		var viewSize = ctx.viewBounds.getSize();
		// Clear the document area before the first tile lands. The container
		// skips its own clear during a zoom animation, so on the file-based
		// path the clear is deferred until a tile is actually about to draw: a
		// walk that paints nothing (evicted tiles, frame mismatch) then keeps
		// the previous frame instead of a cleared-blank one. The non-file
		// paths keep the eager clear -- Calc RTL mirrors the context inside
		// beforeDraw, where a full-canvas fill must not run.
		var frameCleared = false;
		var clearZoomFrame = (): void => {
			if (frameCleared)
				return;
			frameCleared = true;
			// R6-15: phone Writer's ground is paper, not workspace. The page
			// backgrounds are not drawn at all during a zoom animation
			// (onDraw returns into drawZoomFrame), so without this the
			// continuous white surface flashes grey for the whole gesture --
			// and the gesture is the half of it the reader is looking at.
			this.context.fillStyle =
				this.sectionProperties.phoneChrome &&
				this.map._docLayer._docType === 'text'
					? this.containerObject.getDocumentBackgroundColor()
					: this.containerObject.getClearColor();
			this.context.fillRect(0, 0, viewSize.x, viewSize.y);
		};
		if (!app.file.fileBasedView)
			clearZoomFrame();

		var paneBoundsList = ctx.paneBoundsList;

		let maxXBound = 0;
		let maxYBound = 0;

		for (const paneBounds of paneBoundsList) {
			maxXBound = Math.max(maxXBound, paneBounds.min.x);
			maxYBound = Math.max(maxYBound, paneBounds.min.y);
		}

		// The free (scrollable) pane's doc range, in base core-pixels. Used after
		// the loop to drive the global scale and viewedRectangle so vector
		// document sections follow this zoom frame.
		var freeDocRange = null;

		for (var k = 0; k < paneBoundsList.length ; ++k) {
			var paneBounds = paneBoundsList[k];
			var paneSize = paneBounds.getSize();

			var destPos = new cool.Point(0, 0);
			var docAreaSize = paneSize.divideBy(scale);

			let freezeX: boolean;
			let freezeY: boolean;

			if (paneBounds.min.x === 0 && maxXBound !== 0) {
				// There is another pane in the X direction and we are at 0, so we are fixed in X
				docAreaSize.x = paneSize.x;
				freezeX = true;
			} else {
				// Pane is free to move in X direction.
				destPos.x = splitPos.x;
				docAreaSize.x += splitPos.x / scale;
				freezeX = false;
			}

			if (paneBounds.min.y === 0 && maxYBound !== 0) {
				// There is another pane in the Y direction and we are at 0, so we are fixed in Y
				docAreaSize.y = paneSize.y;
				freezeY = true;
			} else {
				// Pane is free to move in Y direction.
				destPos.y = splitPos.y;
				docAreaSize.y += splitPos.y / scale;
				freezeY = false;
			}

			// Calculate top-left in doc core-pixels for the frame.
			var docPos = tsManager._getZoomDocPos(
				tsManager._newCenter,
				tsManager._layer._pinchStartCenter,
				paneBounds,
				{ freezeX, freezeY },
				splitPos,
				scale,
				false /* findFreePaneCenter? */
			);

			if (!freezeX) {
				tsManager._zoomAtDocEdgeX = docPos.topLeft.x == splitPos.x;
			}

			if (!freezeY) {
				tsManager._zoomAtDocEdgeY = docPos.topLeft.y == splitPos.y;
			}

			var docRange = new cool.Bounds(docPos.topLeft, docPos.topLeft.add(docAreaSize));
			if (!freezeX && !freezeY)
				freeDocRange = docRange;
			if (tsManager._calcGridSection) {
				tsManager._calcGridSection.onDrawArea(docRange, docRange.min.subtract(destPos), this.context);
			}
			var canvasContext = this.context;

			var bestZoomSrc = zoom;
			var sheetGeometry = docLayer.sheetGeometry;
			var useSheetGeometry = false;
			// R6-7 lever L4a: hunt a better source rung in BOTH directions,
			// not just zoom-out. Zoom-in hard-coded the start rung -- a pure
			// upscale -- even when the target rung's tiles are in cache,
			// which the speculative settle prefetch makes the common case
			// mid-gesture. The hunt's tie-break prefers the rung nearest the
			// frame target and an incomplete rung loses to a complete one,
			// so nothing changes until the sharper tiles have actually
			// landed. Calc keeps the zoom-out-only gate: its sheet-geometry
			// scaling path is tuned for that direction. typeof-guarded so
			// the minimal mocha docLayer stubs read as "zoom-out only", the
			// shipped gate.
			if (scale < 1.0 ||
				(typeof docLayer.isCalc === 'function' && !docLayer.isCalc())) {
				useSheetGeometry = scale < 1.0 && !!sheetGeometry;
				bestZoomSrc = this.zoomSourceForFrame(docRange, zoom, part, mode, ctx, k);
			}

			var docRangeScaled = (bestZoomSrc == zoom) ? docRange : this.scaleBoundsForZoom(docRange, bestZoomSrc, zoom);
			var destPosScaled = (bestZoomSrc == zoom) ? destPos : this.scalePosForZoom(destPos, bestZoomSrc, zoom);
			var relScale = (bestZoomSrc == zoom) ? 1 : this.map.getZoomScale(bestZoomSrc, zoom);

			this.beforeDraw(canvasContext);
			this.forEachTileInArea(docRangeScaled, bestZoomSrc, part, mode, ctx, function (tile, coords, section): boolean {
				if (!tile || !tile.isReadyToDraw() || !RenderManager.isValidTile(coords))
					return false;

				var tileCoords = tile.coords.getPos();
				if (app.file.fileBasedView) {
					var layout = app.activeDocument.activeLayout;
					if (layout && layout.type === 'ViewLayoutFileBased') {
						var ratio = RenderManager.tileSize * relScale / app.tile.size.y;
						// VULCAN (R6-11 entry/exit jolt): DOC-space rect, not
						// VIEW-space. The zoom window (docRange) is DOC-space
						// -- X=0 baseline, built from the pinch anchor through
						// canvasToDocumentPoint -- and the tile-selection walk
						// (updateFileBasedView) reads getDocumentPartRectAtRatio
						// in the same space. Offsetting the PAINT by the VIEW
						// rect, which already contains the letterbox centering,
						// counted the margin twice: every zoom-anim frame
						// painted shifted by ~the margin, read as a uniform
						// +44 core-px canvas jump on the first frame and -37
						// back at the settle repaint (r6-4 s1 ledger, 5/5 scan
						// rows; z2-entry-jolt counterfactual removes both).
						// Mixed-width decks: parts keep their own widths in
						// both spaces; only the centering X differs, and the
						// window/anchor math never contained it.
						var rect = (layout as ViewLayoutFileBased).getDocumentPartRectAtRatio(tile.coords.part, ratio);
						if (rect) {
							tileCoords.x = rect.x + tileCoords.x;
							tileCoords.y = rect.y + tileCoords.y;
						}
					}
				}
				var tileBounds = new cool.Bounds(tileCoords, tileCoords.add(new cool.Point(RenderManager.tileSize, RenderManager.tileSize)));

				var crop = new cool.Bounds(tileBounds.min, tileBounds.max);
				crop.min.x = Math.max(docRangeScaled.min.x, tileBounds.min.x);
				crop.min.y = Math.max(docRangeScaled.min.y, tileBounds.min.y);
				crop.max.x = Math.min(docRangeScaled.max.x, tileBounds.max.x);
				crop.max.y = Math.min(docRangeScaled.max.y, tileBounds.max.y);

				var cropWidth = crop.max.x - crop.min.x;
				var cropHeight = crop.max.y - crop.min.y;

				var tileOffset = crop.min.subtract(tileBounds.min);
				var paneOffset = crop.min.subtract(docRangeScaled.min.subtract(destPosScaled));
				if (cropWidth && cropHeight) {
						clearZoomFrame();
						section.drawTileToCanvasCrop(
								tile, canvasContext,
								tileOffset.x, tileOffset.y, // source x, y
								cropWidth, cropHeight, // source size
								// Destination x, y, w, h (In non-Chrome browsers it leaves lines without the 0.5 correction).
								Math.floor(paneOffset.x / relScale * scale) + 0.5, // Destination x
								Math.floor(paneOffset.y / relScale * scale) + 0.5, // Destination y
								Math.floor((cropWidth / relScale) * scale) + 1.5,    // Destination width
								Math.floor((cropHeight / relScale) * scale) + 1.5);    // Destination height
				}

				return true;
			}); // end of forEachTileInArea call.
			this.afterDraw(canvasContext);

		} // End of pane bounds list loop.

		// Drive the global scale + viewedRectangle to this zoom frame so vector
		// document sections (drawn after the tiles in this pass) scale and
		// position in lockstep with the tiles. Skip for Calc: its sections are
		// hidden during zoom, and mutating the globals there corrupts the
		// pixel-cached Calc geometry (cell cursor, shape frame).
		if (freeDocRange && tsManager._zoomBaseTwipsToPixels) {
			const baseTwipsToPixels = tsManager._zoomBaseTwipsToPixels;
			const basePixelsToTwips = 1 / baseTwipsToPixels;

			app.twipsToPixels = baseTwipsToPixels * scale;
			app.pixelsToTwips = 1 / app.twipsToPixels;

			const size = freeDocRange.getSize();
			app.activeDocument.activeLayout.setZoomFrameViewedRectangle(
				new cool.SimpleRectangle(
					Math.round(freeDocRange.min.x * basePixelsToTwips),
					Math.round(freeDocRange.min.y * basePixelsToTwips),
					Math.round(size.x * basePixelsToTwips),
					Math.round(size.y * basePixelsToTwips),
				),
			);
		}
	}

	private scalePosForZoom(pos: any, toZoom: number, fromZoom: number): any {
		var docLayer = this.sectionProperties.docLayer;
		var convScale = this.map.getZoomScale(toZoom, fromZoom);

		if (docLayer.sheetGeometry) {
			var toScale = convScale * RenderManager.tileSize * 15.0 / app.tile.size.x;
			toScale = RenderManager.tileSize * 15.0 / Math.round(15.0 * RenderManager.tileSize / toScale);
			var posScaled = docLayer.sheetGeometry.getCorePixelsAtZoom(pos, toScale);
			return posScaled;
		}

		return pos.multiplyBy(convScale);
	}

	private scaleBoundsForZoom(corePxBounds: any, toZoom: number, fromZoom: number) {
		var docLayer = this.sectionProperties.docLayer;
		var convScale = this.map.getZoomScale(toZoom, fromZoom);

		if (docLayer.sheetGeometry) {

			var topLeft = this.scalePosForZoom(corePxBounds.min, toZoom, fromZoom);
			var size = corePxBounds.getSize().multiplyBy(convScale);
			return new cool.Bounds(
				topLeft,
				topLeft.add(size)
			);
		}

		return new cool.Bounds(
			corePxBounds.min.multiplyBy(convScale),
			corePxBounds.max.multiplyBy(convScale)
		);
	}

	onNewDocumentTopLeft(): void {
		if (app.map._textInput && app.map._textInput._isDebugOn)
			app.map._textInput.update();
	}
}

}
