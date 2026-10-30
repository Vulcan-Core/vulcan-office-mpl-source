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

class ViewLayoutCalc extends ViewLayoutNewBase {
	public readonly type: string = 'ViewLayoutCalc';

	// Floor on the gap between two clientvisiblearea messages sent from
	// scroll(). scroll() runs once per animation frame while a finger pans or
	// a fling coasts, and sendClientVisibleArea only suppresses a message when
	// the ROUNDED rectangle is unchanged -- which during a coast it never is.
	// A four-second coast therefore put roughly 240 socket messages on the
	// wire. Core does not need the visible area at frame resolution; it needs
	// it often enough that tiles are rendered for where the view is going, and
	// it needs the final one exactly.
	//
	// 100ms is half the 200ms leaflet 'move' throttle
	// (CanvasTileLayer.js options.updateInterval) that gates the tile request
	// pass, so core still learns the area before each tile pass rather than
	// after it.
	private static readonly vulcanVisibleAreaMinIntervalMs: number = 100;

	private vulcanVisibleAreaTimer: any = null;
	private vulcanVisibleAreaStamp: number = 0;

	constructor() {
		super();
	}

	// True only inside the Vulcan phone chrome. This layout is Calc by
	// construction, so the doctype half of the predicate used elsewhere is
	// already satisfied: a small-screen device AND the pre-paint
	// html.vulcan-mobile-chrome marker js/global.js stamps iff !desktopChrome
	// && mode.isSmallScreenDevice(). Tablets fail both halves -- isTablet() is
	// *defined* as !isSmallScreenDevice() -- so desktop and tablet Calc take
	// the untouched upstream path at every call site below.
	private isVulcanPhoneCalc(): boolean {
		return (
			(<any>window).mode.isSmallScreenDevice() &&
			document.documentElement.classList.contains('vulcan-mobile-chrome')
		);
	}

	// Rate-limited sendClientVisibleArea for the per-frame scroll path, with a
	// guaranteed trailing send so the settled position is never the one that
	// gets dropped. Off the phone this is a straight call and the upstream
	// behaviour is recovered exactly.
	private sendClientVisibleAreaThrottled(): void {
		if (!this.isVulcanPhoneCalc()) {
			this.sendClientVisibleArea();
			return;
		}

		const now = performance.now();
		const since = now - this.vulcanVisibleAreaStamp;

		if (since >= ViewLayoutCalc.vulcanVisibleAreaMinIntervalMs) {
			if (this.vulcanVisibleAreaTimer !== null) {
				clearTimeout(this.vulcanVisibleAreaTimer);
				this.vulcanVisibleAreaTimer = null;
			}
			this.vulcanVisibleAreaStamp = now;
			this.sendClientVisibleArea();
			return;
		}

		// A trailing send is already queued; it will pick up whatever the
		// rectangle has become by the time it fires.
		if (this.vulcanVisibleAreaTimer !== null) return;

		this.vulcanVisibleAreaTimer = setTimeout(() => {
			this.vulcanVisibleAreaTimer = null;
			this.vulcanVisibleAreaStamp = performance.now();
			this.sendClientVisibleArea();
		}, ViewLayoutCalc.vulcanVisibleAreaMinIntervalMs - since);
	}

	private isRTL(): boolean {
		const docLayer = app.map._docLayer;
		return !!(docLayer && docLayer.isCalcRTL && docLayer.isCalcRTL());
	}

	private splitAwareOffset(
		coord: number,
		viewedStart: number,
		split: number,
	): number {
		if (coord < split) return coord;
		const scrolled = coord - viewedStart;
		if (scrolled < split) return split;
		return scrolled;
	}

	// In RTL Calc the document origin (column A) sits at the right edge of
	// the document area, so a point's view X must be mirrored across the
	// document anchor's horizontal extent. LTR matches the base class.
	public override documentToViewX(point: cool.SimplePoint): number {
		const splitX = app.calc.splitCoordinate ? app.calc.splitCoordinate.pX : 0;
		const offset = this.splitAwareOffset(
			point.pX,
			this._viewedRectangle.pX1,
			splitX,
		);

		if (this.isRTL()) {
			return (
				this._documentAnchorPosition[0] +
				this.getDocumentAnchorSection().size[0] -
				offset
			);
		}
		return offset + this._documentAnchorPosition[0];
	}

	public override documentToViewY(point: cool.SimplePoint): number {
		const splitY = app.calc.splitCoordinate ? app.calc.splitCoordinate.pY : 0;
		const offset = this.splitAwareOffset(
			point.pY,
			this._viewedRectangle.pY1,
			splitY,
		);
		return offset + this._documentAnchorPosition[1];
	}

	public override canvasToDocumentPoint(
		point: cool.SimplePoint,
	): cool.SimplePoint {
		const result = point.clone();

		if (this.isRTL()) {
			result.pX =
				this._documentAnchorPosition[0] +
				this.getDocumentAnchorSection().size[0] +
				this._viewedRectangle.pX1 -
				point.pX;
		} else {
			result.pX =
				point.pX + this._viewedRectangle.pX1 - this._documentAnchorPosition[0];
		}
		result.pY =
			point.pY + this._viewedRectangle.pY1 - this._documentAnchorPosition[1];

		return result;
	}

	// CalcTileLayer assigns viewSize from fileSize when the document size is
	// known, and re-assigns when the document grows. ViewLayoutNewBase
	// disables the setter; re-enable it for Calc.
	public override get viewSize() {
		return this._viewSize;
	}
	public override set viewSize(size: cool.SimplePoint) {
		this._viewSize = size;
	}

	// Scroll drives the viewedRectangle update from inside the layout, but
	// zoom and the initial document load still come in via map events, so the
	// setter must stay writable from outside.
	public override get viewedRectangle() {
		return this._viewedRectangle;
	}
	public override set viewedRectangle(rectangle: cool.SimpleRectangle) {
		if (!this._viewedRectangle.equals(rectangle.toArray())) {
			this.lastViewedRectangle = this._viewedRectangle.clone();
			// Same delta the pan direction is derived from, kept at full
			// magnitude so the tile prefetch runway can scale with pan speed
			// instead of standing at a constant three tiles. Recording it is
			// inert -- BitmapTileManager.expandTileRange only reads it behind
			// the phone gate.
			this.trackPanSpeed(
				rectangle.pX1 - this._viewedRectangle.pX1,
				rectangle.pY1 - this._viewedRectangle.pY1,
			);
		}

		this._viewedRectangle = rectangle;

		app.sectionContainer.onNewDocumentTopLeft();
		app.sectionContainer.requestReDraw();
	}

	// Push the current viewed rectangle into the sheet geometry's view limits,
	// which feed the in-view row and column range and group collection. The
	// rectangle is authoritative even mid-scroll, before the map catches up.
	public override refreshViewArea(): void {
		const docLayer = app.map && app.map._docLayer;
		if (!docLayer || !docLayer.sheetGeometry) return;

		const rectangle = this._viewedRectangle;
		docLayer.sheetGeometry.setViewArea(
			new cool.Point(rectangle.x1, rectangle.y1),
			new cool.Point(rectangle.width, rectangle.height),
		);
	}

	// Calc needs splitx/splity so the server renders frozen/split panes
	// correctly, plus the splitter onPositionChange notifications, the
	// context-toolbar hide, the cache suppression, and the forceUpdate flag.
	public override sendClientVisibleArea(forceUpdate: boolean = false) {
		if (!app.map._docLoaded) return;

		var splitPos = app.map._docLayer._splitPanesContext
			? app.map._docLayer._splitPanesContext.getSplitPos()
			: new cool.Point(0, 0);

		const visibleArea = this.getVisibleAreaBounds();

		splitPos = app.map._docLayer._corePixelsToTwips(splitPos);
		var size = visibleArea.getSize();
		var visibleTopLeft = visibleArea.min;
		var newClientVisibleAreaCommand =
			'clientvisiblearea x=' +
			Math.round(visibleTopLeft.x) +
			' y=' +
			Math.round(visibleTopLeft.y) +
			' width=' +
			Math.round(size.x) +
			' height=' +
			Math.round(size.y) +
			' splitx=' +
			Math.round(splitPos.x) +
			' splity=' +
			Math.round(splitPos.y);

		if (
			this.clientVisibleAreaCommand !== newClientVisibleAreaCommand ||
			forceUpdate
		) {
			if (app.map._docLayer._ySplitter) {
				app.map._docLayer._ySplitter.onPositionChange();
			}
			if (app.map._docLayer._xSplitter) {
				app.map._docLayer._xSplitter.onPositionChange();
			}
			app.socket.sendMessage(newClientVisibleAreaCommand);
			if (app.map.contextToolbar) app.map.contextToolbar.hideContextToolbar();
			if (!app.map._fatal && app.idleHandler._active && app.socket.connected())
				this.clientVisibleAreaCommand = newClientVisibleAreaCommand;
		}
	}

	public override refreshScrollProperties(): any {
		const documentAnchor = this.getDocumentAnchorSection();
		const scrollProps = this.scrollProperties;

		// The railway is drawn across the whole document anchor, so a frozen
		// row or column never leaves a gap in it.
		scrollProps.horizontalScrollRailwayOffset = documentAnchor.myTopLeft[0];
		scrollProps.horizontalScrollRailwayLength =
			documentAnchor.size[0] - scrollProps.horizontalScrollRightOffset;
		scrollProps.verticalScrollRailwayOffset = documentAnchor.myTopLeft[1];
		scrollProps.verticalScrollRailwayLength = documentAnchor.size[1];

		// The thumb only travels across the scrollable part, past any
		// frozen/split panes, since that part of the view never moves.
		scrollProps.xOffset = documentAnchor.myTopLeft[0];
		scrollProps.yOffset = documentAnchor.myTopLeft[1];

		const splitPanesContext: any = app.map.getSplitPanesContext();
		let splitX = 0;
		let splitY = 0;
		if (splitPanesContext) {
			const splitPos = splitPanesContext.getSplitPos();
			splitX = Math.round(splitPos.x * app.dpiScale);
			splitY = Math.round(splitPos.y * app.dpiScale);
		}
		scrollProps.xOffset += splitX;
		scrollProps.yOffset += splitY;

		scrollProps.horizontalScrollLength =
			documentAnchor.size[0] - splitX - scrollProps.horizontalScrollRightOffset;
		scrollProps.verticalScrollLength = documentAnchor.size[1] - splitY;

		this.calculateTheScrollSizes();

		// The ratio maps scrollbar-track pixels to view-space pixels.
		// ScrollSection.quickScroll* multiplies its pointer delta by this
		// ratio before calling scroll(), so scroll() always receives
		// view-space deltas regardless of entry point (wheel, drag, keys).
		scrollProps.horizontalScrollRatio = ViewLayoutCalc.trackToViewRatio(
			this.viewSize.pX,
			documentAnchor.size[0],
			scrollProps.horizontalScrollLength,
			scrollProps.horizontalScrollSize,
		);
		scrollProps.verticalScrollRatio = ViewLayoutCalc.trackToViewRatio(
			this.viewSize.pY,
			documentAnchor.size[1],
			scrollProps.verticalScrollLength,
			scrollProps.verticalScrollSize,
		);

		// Project the current view onto the scrollbar track.
		scrollProps.startX =
			scrollProps.xOffset +
			ViewLayoutCalc.viewToTrack(
				this._viewedRectangle.pX1,
				this.viewSize.pX,
				documentAnchor.size[0],
				scrollProps.horizontalScrollLength,
				scrollProps.horizontalScrollSize,
			);
		scrollProps.startY =
			scrollProps.yOffset +
			ViewLayoutCalc.viewToTrack(
				this._viewedRectangle.pY1,
				this.viewSize.pY,
				documentAnchor.size[1],
				scrollProps.verticalScrollLength,
				scrollProps.verticalScrollSize,
			);

		scrollProps.verticalScrollStep = documentAnchor.size[1] / 2;
		scrollProps.horizontalScrollStep = documentAnchor.size[0] / 2;

		this.vulcanProjectIndicatorOnSheet(documentAnchor, scrollProps);
	}

	/*
	 * VO-P-0007 / M-0015 §E — the phone indicator describes the SHEET.
	 *
	 * Everything above projects the thumb onto `viewSize`, which for Calc is
	 * app.activeDocument.fileSize: the PANNABLE extent. On a phone
	 * CalcTileLayer._restrictDocumentSize pads that by EIGHT viewport-fulls past
	 * the last data cell so there is somewhere to fling to, so our thumb
	 * describes sheet + 8 viewports and is nowhere near the end of its track at
	 * the last row.
	 *
	 * 🔴 The measurement settles what it SHOULD describe, and kills the
	 * hypothesis this defect's own fix sketch carried. On a 26-column × 1000-row
	 * sheet with data in exactly ONE column, the reference's horizontal thumb is
	 * 132 px: the sheet extent predicts 132, the DATA extent would have filled
	 * the track. It is a straight proportional projection of the viewport onto
	 * the sheet's full grid extent — nothing clever, and nothing keyed to where
	 * the data ends. Building the data-extent rule would have been a divergence
	 * dressed as parity.
	 *
	 * WHAT IS DELIBERATELY LEFT ALONE. The pannable extent: how far Calc lets you
	 * fling past the data is a different question from what the indicator says,
	 * and shrinking limitMargin changes how Calc GROWS the document. So are
	 * verticalScrollRatio / *SizeForScrolling and the viewSize clamps in
	 * scroll() — the thumb is a readout here, not an input, because the phone
	 * refuses the scroll-bar grab entirely (ScrollSection onMouseDown).
	 *
	 * Desktop and tablet never reach this: isVulcanPhoneCalc() is both halves,
	 * and the method returns before touching a single field.
	 */
	private vulcanProjectIndicatorOnSheet(
		documentAnchor: CanvasSectionObject,
		scrollProps: ScrollProperties,
	): void {
		const extent = this.vulcanSheetExtent();
		if (!extent) return;

		const thickness = scrollProps.scrollBarThickness;

		scrollProps.horizontalScrollSize = ViewLayoutCalc.vulcanThumbSize(
			scrollProps.horizontalScrollLength,
			extent[0],
			thickness,
		);
		scrollProps.verticalScrollSize = ViewLayoutCalc.vulcanThumbSize(
			scrollProps.verticalScrollLength,
			extent[1],
			thickness,
		);

		scrollProps.startX =
			scrollProps.xOffset +
			ViewLayoutCalc.vulcanViewToSheetTrack(
				this._viewedRectangle.pX1,
				extent[0],
				documentAnchor.size[0],
				scrollProps.horizontalScrollLength,
				scrollProps.horizontalScrollSize,
			);
		scrollProps.startY =
			scrollProps.yOffset +
			ViewLayoutCalc.vulcanViewToSheetTrack(
				this._viewedRectangle.pY1,
				extent[1],
				documentAnchor.size[1],
				scrollProps.verticalScrollLength,
				scrollProps.verticalScrollSize,
			);
	}

	/*
	 * The sheet's full grid extent in canvas (core) px — the same unit viewSize
	 * carries, so the projection arithmetic above is unchanged apart from which
	 * number it divides by. `undefined` comes back from SheetGeometry before the
	 * first geometry message, hence the >0 guards rather than a truthiness test:
	 * a zero extent would divide the thumb to Infinity.
	 */
	private vulcanSheetExtent(): number[] | null {
		if (!this.isVulcanPhoneCalc()) return null;

		const docLayer = app.map && app.map._docLayer;
		const sheetGeometry = docLayer && docLayer.sheetGeometry;
		if (!sheetGeometry) return null;

		const size = sheetGeometry.getSize('corepixels');
		if (!size || !(size.x > 0) || !(size.y > 0)) return null;

		return [size.x, size.y];
	}

	/*
	 * Thumb length, in the units the two draw sites want.
	 *
	 * Both of them paint `scrollSize - scrollBarThickness` (ScrollSection
	 * drawVerticalScrollBar / drawHorizontalScrollBar), while the measurement's
	 * arithmetic is about the length that is actually PAINTED: 996 × 0.132 = 132
	 * measured, 1715 × 0.028 = 48 measured. So the thickness is carried here and
	 * the painted bar is the projection itself, with no edit to a draw site that
	 * desktop also runs.
	 *
	 * 🔴 THE FLOOR IS OURS, NOT THE REFERENCE'S, AND IT IS DELIBERATELY TINY.
	 * minimumVerticalScrollSize is 80 CSS px; the reference's vertical thumb on
	 * the default 1000-row sheet is 16 CSS px, so upstream's floor is five times
	 * the measured length and would swallow the projection whole — the fix would
	 * be invisible in exactly the case that was measured. What M-0015 pins is
	 * that NO floor above 16 CSS px applies at 1000 rows; it does not say
	 * whether the reference has one at all (a sheet larger than the 1000 × 26
	 * default is listed under "Not covered"). So the floor here is derived
	 * rather than invented: twice the thickness, i.e. a painted length equal to
	 * the bar's own diameter — the point at which fillRoundedBar's pill
	 * degenerates to a dot and below which there is no shape left to draw.
	 */
	private static vulcanThumbSize(
		trackLen: number,
		extent: number,
		thickness: number,
	): number {
		if (!(trackLen > 0) || !(extent > 0)) return 0;
		const projected = Math.round(Math.pow(trackLen, 2) / extent);
		return Math.max(
			2 * thickness,
			Math.min(trackLen, projected + thickness),
		);
	}

	/*
	 * Position, projected on the sheet — viewToTrack with one added term.
	 *
	 * The fork can pan PAST the sheet (the eight-viewport pad above); the
	 * reference cannot, and at its far extent the thumb reaches the end of its
	 * track exactly. Clamping the ratio at 1 parks the thumb at that end for the
	 * pad rather than walking it off the track it describes. It is a separate
	 * helper and not a term on viewToTrack because that one is also the desktop
	 * path, where viewedRectangle is clamped to viewSize by scroll() and the
	 * clamp could only ever be dead code or a silent behaviour change.
	 */
	private static vulcanViewToSheetTrack(
		viewPos: number,
		extent: number,
		anchorSize: number,
		trackLen: number,
		trackSize: number,
	): number {
		const maxView = Math.max(0, extent - anchorSize);
		const trackMax = Math.max(0, trackLen - trackSize);
		if (maxView <= 0 || trackMax <= 0) return 0;
		return Math.min(1, Math.max(0, viewPos) / maxView) * trackMax;
	}

	private static trackToViewRatio(
		viewSize: number,
		anchorSize: number,
		trackLen: number,
		trackSize: number,
	): number {
		const num = viewSize - anchorSize;
		const den = trackLen - trackSize;
		return den > 0 ? num / den : 1;
	}

	private static viewToTrack(
		viewPos: number,
		viewSize: number,
		anchorSize: number,
		trackLen: number,
		trackSize: number,
	): number {
		const maxView = Math.max(0, viewSize - anchorSize);
		const trackMax = Math.max(0, trackLen - trackSize);
		if (maxView <= 0 || trackMax <= 0) return 0;
		return (viewPos / maxView) * trackMax;
	}

	// pX, pY are view-space deltas in canvas (core) pixels.
	public override scroll(pX: number, pY: number): any {
		const documentAnchor = this.getDocumentAnchorSection();

		if (this.isRTL()) pX = -pX;

		const prevX = this._viewedRectangle.pX1;
		const prevY = this._viewedRectangle.pY1;
		let newX = prevX;
		let newY = prevY;

		if (pX !== 0 && this.canScrollHorizontal(documentAnchor)) {
			const maxView = Math.max(0, this.viewSize.pX - documentAnchor.size[0]);
			newX = Math.max(0, Math.min(maxView, prevX + pX));
		}

		if (pY !== 0 && this.canScrollVertical(documentAnchor)) {
			const maxView = Math.max(0, this.viewSize.pY - documentAnchor.size[1]);
			newY = Math.max(0, Math.min(maxView, prevY + pY));
		}

		if (newX === prevX && newY === prevY) return;

		// Update the viewed rectangle internally; the setter refreshes the
		// section container and remembers the previous rectangle for pan
		// direction pre-fetch.
		this.viewedRectangle = cool.SimpleRectangle.fromCorePixels([
			newX,
			newY,
			this._viewedRectangle.pWidth,
			this._viewedRectangle.pHeight,
		]);

		// Keep the leaflet map in sync so map-dependent features (headers,
		// cursor visibility, context menus, freeze-pane splitters) keep
		// working. A follow-up will remove this leaflet dependency entirely.
		(app.map as any).panBy(
			new cool.Point(
				(newX - prevX) / app.dpiScale,
				(newY - prevY) / app.dpiScale,
			),
			{ animate: false },
		);

		this.refreshCurrentCoordList();
		this.sendClientVisibleAreaThrottled();
	}

	// pX, pY are absolute view-space positions in canvas (core) pixels.
	public override scrollTo(pX: number, pY: number): void {
		const deltaX = pX - this._viewedRectangle.pX1;
		const deltaY = pY - this._viewedRectangle.pY1;
		if (deltaX !== 0 || deltaY !== 0) this.scroll(deltaX, deltaY);
	}
}
