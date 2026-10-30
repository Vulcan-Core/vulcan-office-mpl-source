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

// ViewLayoutFileBased: stacks all parts vertically in a single column, centering
// narrower pages within the widest page. Used by Draw/PDF and read-only Impress
// in app.file.fileBasedView mode. Per-part dimensions come from
// docLayer._partDimensions; falls back to uniform (_partWidthTwips,
// _partHeightTwips) when the per-part array is empty.

// The scroll position expressed in a form that a zoom change cannot invalidate:
// which part the top edge of the viewport is in, and how far into that part it
// sits as a 0..1 fraction of the part's height. `xTwips` is the horizontal
// offset in twips -- the stacked column has no part structure across X, so it
// only needs the unit change, not the anchoring.
interface FileBasedScrollAnchor {
	part: number;
	fraction: number;
	xTwips: number;
}

class ViewLayoutFileBased extends ViewLayoutNewBase {
	public readonly type: string = 'ViewLayoutFileBased';
	public documentRectangles = Array<cool.SimpleRectangle>();
	public viewRectangles = Array<cool.SimpleRectangle>();

	// The app.twipsToPixels that the CURRENT rectangles and the CURRENT
	// scrollProperties.viewX/viewY are expressed in.
	//
	// Everything else in this layout is immune to a zoom change by
	// construction. documentRectangles/viewRectangles and _viewSize are
	// cool.SimpleRectangle / cool.SimplePoint, which store twips and convert on
	// every pixel read (core/geometry.ts:193-209), so they re-derive themselves
	// at whatever scale is current. scrollProperties.viewX/viewY are plain
	// numbers holding core pixels -- ViewLayout.ts:25,40 -- and no writer of
	// either is zoom-aware. So a zoom step moves the layout and leaves the
	// scroll offset behind, and this field is what lets reset() tell by how
	// much.
	private layoutTwipsToPixels: number = 0;

	constructor() {
		super();

		app.events.on('resize', this.reset.bind(this));
		app.map.on('zoomend', this.reset.bind(this));

		// Populate rectangles synchronously so callers that read documentRectangles
		// right after `new ViewLayoutFileBased()` (e.g. paint paths kicked off
		// immediately after swapLayout) see a fully-built layout.
		this.resetViewLayout();
		app.layoutingService.appendLayoutingTask(() => this.updateViewData());
	}

	private getPartCount(): number {
		const docLayer = app.map._docLayer;
		if (!docLayer) return 0;
		return docLayer._parts || 0;
	}

	private getPartSizeTwips(i: number): { w: number; h: number } {
		const docLayer = app.map._docLayer;
		if (
			docLayer._partDimensions &&
			docLayer._partDimensions.length === docLayer._parts &&
			docLayer._partDimensions[i]
		) {
			return {
				w: docLayer._partDimensions[i].x,
				h: docLayer._partDimensions[i].y,
			};
		}
		return {
			w: docLayer._partWidthTwips,
			h: docLayer._partHeightTwips,
		};
	}

	private resetViewLayout(): void {
		this.documentRectangles.length = 0;
		this.viewRectangles.length = 0;

		// Record the scale this rebuild is happening at, BEFORE the early
		// return, so the invariant "layoutTwipsToPixels describes the scale
		// viewX/viewY are in" holds even for a layout with no parts yet.
		this.layoutTwipsToPixels = app.twipsToPixels;

		const partCount = this.getPartCount();
		if (partCount === 0) return;

		const docLayer = app.map._docLayer;
		const gap = docLayer._spaceBetweenParts;

		let maxWidth = 0;
		for (let i = 0; i < partCount; i++)
			maxWidth = Math.max(maxWidth, this.getPartSizeTwips(i).w);

		const canvasSize = app.sectionContainer.getViewSize();
		const canvasWidthTwips = Math.round(canvasSize[0] * app.pixelsToTwips);
		const layoutWidthTwips = Math.max(maxWidth, canvasWidthTwips);

		let cumulativeY = 0;
		for (let i = 0; i < partCount; i++) {
			const size = this.getPartSizeTwips(i);

			const docRect = new cool.SimpleRectangle(0, cumulativeY, size.w, size.h);
			const viewRect = new cool.SimpleRectangle(
				Math.round((layoutWidthTwips - size.w) * 0.5),
				cumulativeY,
				size.w,
				size.h,
			);
			docRect.part = i;
			viewRect.part = i;

			this.documentRectangles.push(docRect);
			this.viewRectangles.push(viewRect);

			cumulativeY += size.h + gap;
		}

		this._viewSize.pX = Math.max(
			Math.round(layoutWidthTwips * app.twipsToPixels),
			canvasSize[0],
		);
		this._viewSize.pY = Math.max(
			Math.round(cumulativeY * app.twipsToPixels),
			canvasSize[1],
		);

		this.sampleCentringInput(
			layoutWidthTwips,
			maxWidth,
			canvasSize[0],
			this.getPartSizeTwips(0).w,
		);
	}

	/*
	 * ── phone centring probe — INSTRUMENTATION ONLY, no behavioural effect ──
	 *
	 * resetViewLayout bakes every part's X against ONE read of
	 * app.sectionContainer.getViewSize(), which returns the container's
	 * declared `this.width` — a value resizeCanvas() only later copies onto
	 * the canvas element (CanvasSectionContainer.ts:362-364, :762-768). When
	 * the two disagree the deck is centred against a width the user is not
	 * looking at, which is the shape of the designer's phone report: slack canvas on
	 * one side, slide displaced to the other.
	 *
	 * This SAMPLES that disagreement and does not correct it. The one Impress
	 * instance measured on prod was a stale Leaflet centre at the read->edit
	 * flip and is already fixed there (ImpressTileLayer.js:394-455); the
	 * remaining report is intermittent and unattributed, so a second
	 * speculative centring fix would as likely mask the cause as remove it.
	 */
	private static readonly CENTRING_DIVERGENCE_CSS = 2;
	private static readonly CENTRING_EMIT_FLOOR_MS = 10000;
	private centringDivergenceOpen: boolean = false;
	private centringLastEmitMs: number = 0;

	// This layout is Draw/PDF and read-posture Impress by construction, so the
	// doctype half of the phone predicate is not needed here: small-screen
	// device AND the pre-paint html.vulcan-mobile-chrome marker js/global.js
	// stamps iff !desktopChrome && isSmallScreenDevice(). Desktop and tablet
	// never reach the emit, and nothing in this method writes.
	private isVulcanPhone(): boolean {
		return (
			(<any>window).mode.isSmallScreenDevice() &&
			document.documentElement.classList.contains('vulcan-mobile-chrome')
		);
	}

	private sampleCentringInput(
		layoutWidthTwips: number,
		maxWidthTwips: number,
		inputWidthPx: number,
		firstPartWidthTwips: number,
	): void {
		if (!app.telemetry) return;
		try {
			if (!this.isVulcanPhone()) return;

			const liveCss =
				app.sectionContainer.getCanvasBoundingClientRect().width;
			// A detached or display:none canvas measures 0 — no live width to
			// disagree with, and reporting it would read as a total collapse.
			if (!liveCss) return;

			const dpiScale = app.dpiScale || 1;
			const inputCss = inputWidthPx / dpiScale;
			const deltaCss = inputCss - liveCss;

			// One sample per divergence EPISODE. The latch clears on the first
			// agreeing reset; the floor covers a reset storm oscillating across
			// the threshold, because reset() is bound to 'resize' as well as
			// 'zoomend' and a phone fires resize continuously (keyboard,
			// rotation, retracting browser chrome).
			if (
				Math.abs(deltaCss) <= ViewLayoutFileBased.CENTRING_DIVERGENCE_CSS
			) {
				this.centringDivergenceOpen = false;
				return;
			}
			if (this.centringDivergenceOpen) return;
			const now = Date.now();
			if (
				now - this.centringLastEmitMs <
				ViewLayoutFileBased.CENTRING_EMIT_FLOOR_MS
			)
				return;
			this.centringDivergenceOpen = true;
			this.centringLastEmitMs = now;

			// Origins are part 0's: every slide in a deck is the same width, so
			// one part answers for the whole stack. `fresh` is the origin the
			// same arithmetic would have produced against the live width.
			const liveWidthTwips = Math.round(
				liveCss * dpiScale * app.pixelsToTwips,
			);
			const freshLayoutWidthTwips = Math.max(maxWidthTwips, liveWidthTwips);

			const map = app.map as any;
			const domUtil = (window as any).L && (window as any).L.DomUtil;

			app.telemetry.record('filebased_centring_divergence', {
				layout_width_twips: layoutWidthTwips,
				input_css_width: Math.round(inputCss),
				canvas_css_width: Math.round(liveCss),
				delta_css: Math.round(deltaCss),
				origin_stale_twips: Math.round(
					(layoutWidthTwips - firstPartWidthTwips) * 0.5,
				),
				origin_fresh_twips: Math.round(
					(freshLayoutWidthTwips - firstPartWidthTwips) * 0.5,
				),
				zoom_percent:
					map && typeof map.getZoomPercent === 'function'
						? Math.round(map.getZoomPercent())
						: -1,
				orientation:
					domUtil && typeof domUtil.isPortrait === 'function'
						? domUtil.isPortrait()
							? 'portrait'
							: 'landscape'
						: 'unknown',
			});
		} catch (e) {
			/* a probe must never break a layout pass */
		}
	}

	/*
	 * Where the top edge of the viewport is, in a form a zoom change cannot
	 * invalidate.
	 *
	 * Must be called BEFORE resetViewLayout(), and it deliberately reads the
	 * rectangles' TWIP accessors (y1 / height), never the pixel ones. By the
	 * time reset() runs on 'zoomend' the scale has already moved: _resetView
	 * fires 'viewreset' -> CanvasTileLayer._reset -> _updateTileTwips, which
	 * rewrites app.twipsToPixels, and only then fires 'zoomend'
	 * (Map.js:1374-1403). So `rect.pY1` inside here already answers at the NEW
	 * scale while scrollProperties.viewY is still a number written at the OLD
	 * one -- mixing the two is the bug, not the fix. Twips are the same at both
	 * scales, which is why the anchor is computed there.
	 */
	private captureScrollAnchor(): FileBasedScrollAnchor | null {
		const scale = this.layoutTwipsToPixels || app.twipsToPixels;
		if (!scale || this.documentRectangles.length === 0) return null;

		const anchorTwips = this.scrollProperties.viewY / scale;

		// First part whose bottom edge is still below the anchor. Past the end
		// of the stack this leaves `part` at the last one, which is what the
		// clamp in restoreScrollAnchor then pins to the bottom -- the case that
		// used to intersect nothing and snap the deck back to slide 1.
		let part = this.documentRectangles.length - 1;
		for (let i = 0; i < this.documentRectangles.length; i++) {
			if (anchorTwips < this.documentRectangles[i].y2) {
				part = i;
				break;
			}
		}

		const rect = this.documentRectangles[part];
		const fraction =
			rect.height > 0
				? Math.max(0, Math.min(1, (anchorTwips - rect.y1) / rect.height))
				: 0;

		return {
			part: part,
			fraction: fraction,
			xTwips: this.scrollProperties.viewX / scale,
		};
	}

	/*
	 * Put the viewport back on the same part, at the same fraction into it,
	 * against the rectangles that resetViewLayout() has just rebuilt.
	 *
	 * Google Slides is the reference and it is unambiguous here: changing the
	 * zoom on a phone keeps you on the slide you were reading. It does not move
	 * you to a different slide, and it does not throw you back to slide 1.
	 *
	 * The equality guard is load-bearing, not decorative. reset() is bound to
	 * 'resize' as well as 'zoomend' (see the constructor), so this handler
	 * writes two values it also reads, on an event that a phone fires
	 * constantly -- keyboard, bottom sheet, rotation, retracting browser
	 * chrome. On a resize with no zoom change the scale is unchanged, the
	 * reconstruction is exact, and the guard makes the whole call a no-op: no
	 * write to viewX/viewY, no recomputed scrollbar position, so nothing
	 * downstream of scrollProperties can be woken by a resize that did not
	 * actually move anything.
	 */
	private restoreScrollAnchor(anchor: FileBasedScrollAnchor | null): void {
		if (!anchor || this.documentRectangles.length === 0) return;

		const documentAnchor = this.getDocumentAnchorSection();
		if (!documentAnchor) return;

		const rect =
			this.documentRectangles[
				Math.min(anchor.part, this.documentRectangles.length - 1)
			];

		// Same clamp the scroll() path uses (see below), so an anchored restore
		// and a user scroll can never disagree about where the end is.
		const maxY = Math.max(0, this._viewSize.pY - documentAnchor.size[1]);
		const maxX = Math.max(0, this._viewSize.pX - documentAnchor.size[0]);

		const newViewY = Math.max(
			0,
			Math.min(
				maxY,
				Math.round(
					(rect.y1 + anchor.fraction * rect.height) * app.twipsToPixels,
				),
			),
		);
		const newViewX = Math.max(
			0,
			Math.min(maxX, Math.round(anchor.xTwips * app.twipsToPixels)),
		);

		if (
			newViewY === this.scrollProperties.viewY &&
			newViewX === this.scrollProperties.viewX
		)
			return;

		this.refreshScrollProperties();

		if (newViewY !== this.scrollProperties.viewY) {
			this.scrollProperties.viewY = newViewY;
			this.scrollProperties.startY =
				this._viewSize.pY > 0
					? Math.round(
							(newViewY / this._viewSize.pY) *
								this.scrollProperties.verticalScrollLength,
						)
					: 0;
		}

		if (newViewX !== this.scrollProperties.viewX) {
			this.scrollProperties.viewX = newViewX;
			this.scrollProperties.startX =
				this._viewSize.pX > 0
					? Math.round(
							(newViewX / this._viewSize.pX) *
								this.scrollProperties.horizontalScrollLength,
						)
					: 0;
		}
	}

	public reset(): void {
		if (!app.map._docLayer || !app.map._docLayer._parts) return;

		const anchor = this.captureScrollAnchor();
		this.resetViewLayout();
		this.restoreScrollAnchor(anchor);

		app.layoutingService.appendLayoutingTask(() => this.updateViewData());
	}

	// Per-part document rect (X=0 baseline, cumulative Y) in pixels at `ratio`.
	// Tile-queue builders work in stacked-document coords; this gives them the
	// per-part rect at the queried zoom without recomputing twips->pixels math.
	public getDocumentPartRectAtRatio(
		idx: number,
		ratio: number,
	): { x: number; y: number; w: number; h: number } | null {
		const r = this.documentRectangles[idx];
		if (!r) return null;
		return {
			x: Math.round(r.x1 * ratio),
			y: Math.round(r.y1 * ratio),
			w: Math.round(r.width * ratio),
			h: Math.round(r.height * ratio),
		};
	}

	// Per-part view rect (X-centered, cumulative Y) in pixels at `ratio`.
	public getViewPartRectAtRatio(
		idx: number,
		ratio: number,
	): { x: number; y: number; w: number; h: number } | null {
		const r = this.viewRectangles[idx];
		if (!r) return null;
		return {
			x: Math.round(r.x1 * ratio),
			y: Math.round(r.y1 * ratio),
			w: Math.round(r.width * ratio),
			h: Math.round(r.height * ratio),
		};
	}

	// Twip-space document rect for non-pixel callers.
	public getDocumentPartRect(idx: number): cool.SimpleRectangle | null {
		return this.documentRectangles[idx] ?? null;
	}

	// Cumulative Y offset of part `i` in core pixels (top of the page).
	public getPartYOffset(partIndex: number): number {
		if (partIndex < 0 || partIndex >= this.viewRectangles.length) return 0;
		return this.viewRectangles[partIndex].pY1;
	}

	// X offset of part `i` (centering) in core pixels.
	public getPartXOffset(partIndex: number): number {
		if (partIndex < 0 || partIndex >= this.viewRectangles.length) return 0;
		return this.viewRectangles[partIndex].pX1;
	}

	// Find which part contains the given core-pixel point in document space
	// (i.e. pY relative to the stacked layout's origin, not viewport).
	public getPartIndexAtDocumentY(pY: number): number {
		for (let i = 0; i < this.documentRectangles.length; i++) {
			const r = this.documentRectangles[i];
			if (pY >= r.pY1 && pY < r.pY1 + r.pHeight) return i;
		}
		if (this.documentRectangles.length === 0) return 0;
		if (pY < this.documentRectangles[0].pY1) return 0;
		return this.documentRectangles.length - 1;
	}

	protected getClosestRectangleIndex(
		point: cool.SimplePoint,
		documentPoint = true,
	): number {
		const rectangleList = documentPoint
			? this.documentRectangles
			: this.viewRectangles;

		for (let i = 0; i < rectangleList.length; i++) {
			if (rectangleList[i].containsPoint(point.toArray())) return i;
		}

		let closest = Number.POSITIVE_INFINITY;
		let part = 0;
		for (let i = 0; i < rectangleList.length; i++) {
			const r = rectangleList[i];
			const cy = (r.y1 + r.y2) * 0.5;
			const d = Math.abs(point.y - cy);
			if (d < closest) {
				closest = d;
				part = i;
			}
		}
		return part;
	}

	protected refreshVisibleAreaRectangle(): void {
		this.refreshVisibleAreaRectangleImpl(
			this.documentRectangles,
			this.viewRectangles,
			'y',
		);
	}

	protected refreshCurrentCoordList() {
		const { zoom, tileSize, view } = this.beginCoordList();
		const added: Set<string> = new Set();

		for (let i = 0; i < this.documentRectangles.length; i++) {
			const viewRect = this.viewRectangles[i];

			if (!view.intersectsRectangle(viewRect.toArray())) continue;

			const { vx1, vy1, vx2, vy2 } = this.getVisibleViewBounds(view, viewRect);

			// Map back to per-page local coordinates (tile.x/y are page-local
			// for fileBasedView).
			const localX1 = vx1 - viewRect.pX1;
			const localY1 = vy1 - viewRect.pY1;
			const localX2 = vx2 - viewRect.pX1;
			const localY2 = vy2 - viewRect.pY1;

			const startX = Math.floor(localX1 / tileSize) * tileSize;
			const startY = Math.floor(localY1 / tileSize) * tileSize;
			const columnCount = Math.ceil((localX2 - startX) / tileSize);
			const rowCount = Math.ceil((localY2 - startY) / tileSize);

			this.pushTileGrid(
				startX,
				startY,
				columnCount,
				rowCount,
				zoom,
				tileSize,
				i,
				added,
			);
		}
	}

	protected updateViewData(): void {
		this.commitVisibleAreaAndRequestTiles();
	}

	/*
		scrollTo() below assigns scrollProperties.viewX/viewY outright, so that
		pair -- not the viewed rectangle -- is the space its arguments live in.

		The two are NOT interchangeable on this layout, and the gap is not
		small. refreshVisibleAreaRectangleImpl builds _viewedRectangle as the
		bounding box of every part the viewport intersects, so pY1 is the TOP
		OF THE TOPMOST VISIBLE SLIDE: it is piecewise constant, it only moves
		when a slide leaves the viewport, and viewY - pY1 runs from 0 up to a
		whole slide pitch as you scroll through one slide. It is never
		negative, so a pan that mistakes one for the other always lands SHORT,
		i.e. scrolled back up the deck.
	*/
	public override getScrollOrigin(): number[] {
		return [this.scrollProperties.viewX, this.scrollProperties.viewY];
	}

	public override scroll(pX: number, pY: number): boolean {
		// pX / pY are document-pixel deltas (legacy ViewLayoutBase semantics).
		// ViewLayoutNewBase.scroll dampens pY by /20, so callers that pass raw
		// pixel deltas (page-down, wheel, scrollByPoint) would barely scroll.
		// Apply the delta directly to viewX/viewY and recompute the scrollbar
		// position from viewSize, matching the scrollVerticalWithOffset path.
		this.refreshScrollProperties();
		const documentAnchor = this.getDocumentAnchorSection();
		let scrolled = false;

		if (pX !== 0 && this.canScrollHorizontal(documentAnchor)) {
			const max = Math.max(0, this._viewSize.pX - documentAnchor.size[0]);
			const newViewX = Math.max(
				0,
				Math.min(this.scrollProperties.viewX + pX, max),
			);
			if (newViewX !== this.scrollProperties.viewX) {
				this.scrollProperties.viewX = newViewX;
				this.scrollProperties.startX = Math.round(
					(this.scrollProperties.viewX / this._viewSize.pX) *
						this.scrollProperties.horizontalScrollLength,
				);
				scrolled = true;
			}
		}

		if (pY !== 0 && this.canScrollVertical(documentAnchor)) {
			const max = Math.max(0, this._viewSize.pY - documentAnchor.size[1]);
			const newViewY = Math.max(
				0,
				Math.min(this.scrollProperties.viewY + pY, max),
			);
			if (newViewY !== this.scrollProperties.viewY) {
				this.scrollProperties.viewY = newViewY;
				this.scrollProperties.startY = Math.round(
					(this.scrollProperties.viewY / this._viewSize.pY) *
						this.scrollProperties.verticalScrollLength,
				);
				scrolled = true;
			}
		}

		if (scrolled) {
			this.updateViewData();
			app.sectionContainer.requestReDraw();
			app.map._docLayer._checkSelectedPart();
		}

		return scrolled;
	}

	public override scrollTo(pX: number, pY: number): void {
		let scrolled = false;

		if (pX !== this.scrollProperties.viewX) {
			this.scrollProperties.viewX = Math.max(0, pX);
			this.scrollProperties.startX = Math.round(
				(this.scrollProperties.viewX / this._viewSize.pX) *
					this.scrollProperties.horizontalScrollLength,
			);
			scrolled = true;
		}

		if (pY !== this.scrollProperties.viewY) {
			this.scrollProperties.viewY = Math.max(0, pY);
			this.scrollProperties.startY = Math.round(
				(this.scrollProperties.viewY / this._viewSize.pY) *
					this.scrollProperties.verticalScrollLength,
			);
			scrolled = true;
		}

		if (scrolled) {
			this.updateViewData();
			app.sectionContainer.requestReDraw();
		}
	}
}

ViewLayoutFileBased.prototype.documentToViewX =
	ViewLayoutMultiPage.prototype.documentToViewX;
ViewLayoutFileBased.prototype.documentToViewY =
	ViewLayoutMultiPage.prototype.documentToViewY;
ViewLayoutFileBased.prototype.canvasToDocumentPoint =
	ViewLayoutMultiPage.prototype.canvasToDocumentPoint;
