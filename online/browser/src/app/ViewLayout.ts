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

class ScrollProperties {
	yOffset: number = 0;
	verticalScrollLength: number = 0;
	// Where the vertical scroll bar railway is drawn: the whole document
	// anchor, unlike yOffset/verticalScrollLength, which stop at the edge of
	// a frozen pane so the thumb does not travel into it.
	verticalScrollRailwayOffset: number = 0;
	verticalScrollRailwayLength: number = 0;
	verticalScrollSize: number = 0; // Clamped to minimum, used for drawing.
	verticalScrollSizeForScrolling: number = 0; // Unclamped, used for scroll calculations.
	minimumVerticalScrollSize: number = 80 * app.roundedDpiScale;
	verticalScrollRatio: number = 0;
	startY: number = 0; // Start position of the vertical scroll bar on canvas.
	viewY: number = 0; // Corresponding view position of startY.
	verticalScrollStep: number = 0; // Quick scroll step.

	xOffset: number = 0;
	horizontalScrollLength: number = 0;
	// Where the horizontal scroll bar railway is drawn: the whole document
	// anchor, unlike xOffset/horizontalScrollLength, which stop at the edge
	// of a frozen pane so the thumb does not travel into it.
	horizontalScrollRailwayOffset: number = 0;
	horizontalScrollRailwayLength: number = 0;
	horizontalScrollSize: number = 0; // Clamped to minimum, used for drawing.
	horizontalScrollSizeForScrolling: number = 0; // Unclamped, used for scroll calculations.
	minimumHorizontalScrollSize: number = 80 * app.roundedDpiScale;
	horizontalScrollRatio: number = 0;
	startX: number = 0;
	viewX: number = 0; // Corresponding view position of startX.
	horizontalScrollStep: number = 0;

	usableThickness: number = 20 * app.roundedDpiScale;
	horizontalScrollRightOffset: number = 20 /*usableThickness*/; // To prevent overlapping of the scroll bars.
	scrollBarThickness: number = 6 * app.roundedDpiScale;
	edgeOffset: number = ScrollProperties.vulcanIndicatorEdgeOffset();

	moveBy: number[] | null = null; // Pending move event (pX, pY).

	/*
	 * VO-P-0007 / M-0015 §B — the phone scroll indicator's inset from the edge
	 * of its viewport, in canvas (core) px. Zero everywhere else, which is what
	 * this field has silently been since it was declared: the four draw sites
	 * in ScrollSection (drawVerticalScrollBar / drawHorizontalScrollBar, thumb
	 * and railway) are its only readers, and nothing ever assigned it, so both
	 * phone indicators sat flush against the glass.
	 *
	 * THE NUMBER IS MEASURED, NOT CHOSEN. On the reference at 1179x2556 the
	 * vertical bar's right edge is at x = 1154 in a 1179-wide viewport and the
	 * horizontal bar's bottom edge is at y = 2147 with the viewport ending at
	 * 2172: 24 device px on both axes, i.e. 8 dp. The bar's own 6 dp thickness
	 * (scrollBarThickness above) was already right and is untouched.
	 *
	 * DP, NOT DEVICE PX. app.dpiScale is clamped to VulcanTilePerf.TILE_DPI_CAP
	 * on phone chrome, so a dpr-3 phone renders this canvas at 2x and the
	 * browser upscales; 8 * roundedDpiScale is 16 backing px there, which is
	 * the 24 screen px measured. CSS px is the invariant, exactly as it is for
	 * the thickness one line up.
	 *
	 * WHY EVERY PHONE DOCTYPE AND NOT JUST CALC. The measurement is Sheets', but
	 * this is one painted indicator shared by Writer, Calc and Impress, and the
	 * inset is what keeps the HORIZONTAL bar off the display's corner arc --
	 * RU-04 is universal law, and a Calc-only inset would leave the other two
	 * doctypes with the geometry the law exists to forbid.
	 *
	 * 🔴 The gate is both halves. `?vulcanChrome=desktop` on a real phone leaves
	 * isSmallScreenDevice() true and the class absent, and there the bar is a
	 * grabbable control laid out against desktop CSS -- inset it and the grab
	 * strip and the paint stop agreeing.
	 */
	private static vulcanIndicatorEdgeOffset(): number {
		// The `!!…mode` guard is not defensive noise, and it is the fork's own
		// idiom (Control.Menubar.ts spells the same one). This is a class FIELD
		// initializer, so unlike every other gate in the tree it runs at layout
		// construction rather than inside a method after boot -- earlier than
		// window.mode exists in the mocha rig, where ViewLayouts are built
		// against a bare window. No chrome machinery means no phone chrome,
		// which is the desktop default and upstream's behaviour exactly.
		const phoneChrome =
			!!(<any>window).mode &&
			(<any>window).mode.isSmallScreenDevice() &&
			document.documentElement.classList.contains('vulcan-mobile-chrome');
		return phoneChrome ? 8 * app.roundedDpiScale : 0;
	}
}

// FIXME: should be abstract to split Writer and other layouts
// so we can have abstract methods and be warned about missing bits
class ViewLayoutBase {
	public readonly type: string = 'ViewLayoutBase';

	protected lastViewedRectangle: cool.SimpleRectangle; // Previously viewed rectangle.

	// How fast the view is panning, in canvas (core) pixels per millisecond,
	// per axis, unsigned. The companion to lastViewedRectangle: that pair
	// answers "which way", through getLastPanDirection, which reduces the delta
	// to Math.sign and throws the magnitude away. That is why the tile prefetch
	// margin has always been a fixed number of tiles no matter how fast the
	// view was moving. This keeps the magnitude so a consumer can ask.
	//
	// Recorded only by layouts that opt in (ViewLayoutCalc today) and read only
	// through getPanSpeed, so a layout that never calls trackPanSpeed reports a
	// standing 0 and every consumer of it falls back to its constant.
	protected panSpeed: number[] = [0, 0];
	protected panSpeedStamp: number = 0;

	// Smoothing time constant: a single frame's delta is noisy (touchmove
	// coalescing, a stray 2ms frame), so weight each sample by how much of this
	// window it covers.
	protected static readonly panSpeedSmoothingMs: number = 50;

	// A gap longer than this means the previous gesture is over and the next
	// delta is the start of a new one, not a continuation of the old speed.
	protected static readonly panSpeedIdleMs: number = 250;

	protected clientVisibleAreaCommand: string = ''; // Last visible area command. Checked to avoid sending the same command multiple times.
	protected _viewedRectangle: cool.SimpleRectangle; // Currently viewed rectangle.
	protected _viewSize: cool.SimplePoint; // Scrollable area.
	protected _documentAnchorPosition: number[]; // The position of document section on the canvas. Always canvas (core) pixels, no need for SimplePoint class.
	public scrollProperties: ScrollProperties = new ScrollProperties();
	protected currentCoordList: Array<TileCoordData> = [];

	constructor() {
		this._viewedRectangle = new cool.SimpleRectangle(0, 0, 0, 0);
		this.lastViewedRectangle = new cool.SimpleRectangle(0, 0, 0, 0);
		this._viewSize = new cool.SimplePoint(0, 0);
		this._documentAnchorPosition = [0, 0];
	}

	/*
		View layout may choose to render the tiles in different coordinates.
		In that case, the tiles' coordinates will differ from the file's coordinates.
		There are x, pX and cX. View layout also adds vX.
			x : Document coordinate system
			pX: Corresponding pixel coordinate system on canvas. x and pX have a fixed ratio.
			cX: Corresponding CSS coordinate system on canvas. x and cX have a fixed ratio.
			vX: View coordinate system. Current view layout decides on the mapping between x (document coordinate) and vX (view coordinate).
				View coordinate system also uses canvas pixels as unit (like pX).

		Below functions are used to convert between those coordinate systems.
		This is the base class. Does nothing special but provide the interface.
	*/
	public documentToViewX(point: cool.SimplePoint): number {
		return (
			point.pX - this._viewedRectangle.pX1 + this._documentAnchorPosition[0]
		);
	}

	public adjustViewZoomLevel() {
		if (app.map._docLayer)
			app.map._docLayer._fitWidthZoom(undefined, undefined, true);
	}

	public documentToViewY(point: cool.SimplePoint): number {
		return (
			point.pY - this._viewedRectangle.pY1 + this._documentAnchorPosition[1]
		);
	}

	// point: Unmodified canvas coordinate, no scroll included.
	public canvasToDocumentPoint(point: cool.SimplePoint): cool.SimplePoint {
		const result = point.clone();

		result.pX =
			point.pX + this._viewedRectangle.pX1 - this._documentAnchorPosition[0];
		result.pY =
			point.pY + this._viewedRectangle.pY1 - this._documentAnchorPosition[1];

		return result;
	}

	public resetClientVisibleArea(): void {
		this.lastViewedRectangle = new cool.SimpleRectangle(0, 0, 0, 0);
	}

	protected getVisibleAreaBounds() {
		let visibleArea = app.map.getPixelBounds();
		visibleArea = new cool.Bounds(
			app.map._docLayer._pixelsToTwips(visibleArea.min),
			app.map._docLayer._pixelsToTwips(visibleArea.max),
		);
		return visibleArea;
	}

	public sendClientVisibleArea(forceUpdate: boolean = false): void {
		if (!app.map._docLoaded) return;
		// During a zoom animation app.twipsToPixels and the viewedRectangle are
		// driven through intermediate frame values; do not push those to core.
		// The real visible area is sent once the animation settles.
		if (app.sectionContainer.isInZoomAnimation()) return;

		var splitPos = app.map._docLayer._splitPanesContext
			? app.map._docLayer._splitPanesContext.getSplitPos()
			: new cool.Point(0, 0);

		const visibleArea = this.getVisibleAreaBounds();

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
			Math.round(size.y);

		if (
			this.clientVisibleAreaCommand !== newClientVisibleAreaCommand ||
			forceUpdate
		) {
			// Visible area is dirty, update it on the server
			app.socket.sendMessage(newClientVisibleAreaCommand);
			if (app.map.contextToolbar) app.map.contextToolbar.hideContextToolbar(); // hide context toolbar when scroll/window resize etc...
			if (!app.map._fatal && app.idleHandler._active && app.socket.connected())
				this.clientVisibleAreaCommand = newClientVisibleAreaCommand;
		}
	}

	public getLastPanDirection(): Array<number> {
		var dx: number = this._viewedRectangle.pX1 - this.lastViewedRectangle.pX1;
		var dy: number = this._viewedRectangle.pY1 - this.lastViewedRectangle.pY1;
		return [Math.sign(dx), Math.sign(dy)];
	}

	// Fold one viewedRectangle delta into the smoothed pan speed. Bookkeeping
	// only -- it changes no behaviour by itself; a consumer has to read
	// getPanSpeed and act on it.
	protected trackPanSpeed(dX: number, dY: number): void {
		const now = performance.now();
		const dt = now - this.panSpeedStamp;
		this.panSpeedStamp = now;

		// Two updates inside the same clock tick carry no usable rate, and a
		// long gap means this delta opens a new gesture rather than continuing
		// the last one at its old speed.
		if (!(dt > 0) || dt > ViewLayoutBase.panSpeedIdleMs) {
			this.panSpeed = [0, 0];
			return;
		}

		const weight = Math.min(1, dt / ViewLayoutBase.panSpeedSmoothingMs);
		this.panSpeed = [
			this.panSpeed[0] + (Math.abs(dX) / dt - this.panSpeed[0]) * weight,
			this.panSpeed[1] + (Math.abs(dY) / dt - this.panSpeed[1]) * weight,
		];
	}

	// Unsigned pan speed per axis, canvas (core) pixels per millisecond. Pairs
	// with getLastPanDirection, which supplies the sign this drops.
	public getPanSpeed(): Array<number> {
		return this.panSpeed.slice();
	}

	public get viewedRectangle() {
		return this._viewedRectangle;
	}

	public set viewedRectangle(rectangle: cool.SimpleRectangle) {
		// maintain a view of where we're panning to.
		if (!this._viewedRectangle.equals(rectangle.toArray()))
			this.lastViewedRectangle = this._viewedRectangle.clone();

		this._viewedRectangle = rectangle;

		app.sectionContainer.onNewDocumentTopLeft();
		app.sectionContainer.requestReDraw();
	}

	// Refresh cached geometry that depends on the current viewed rectangle.
	public refreshViewArea(): void {
		return;
	}

	// Lightweight viewedRectangle update used per zoom frame. Unlike the setter
	// it does not run onNewDocumentTopLeft, requestReDraw or touch
	// lastViewedRectangle: the zoom RAF already redraws, and the document
	// sections read this rectangle directly via documentToViewX/Y.
	public setZoomFrameViewedRectangle(rectangle: cool.SimpleRectangle): void {
		this._viewedRectangle = rectangle;
	}

	public get viewSize() {
		return this._viewSize;
	}

	public set viewSize(size: cool.SimplePoint) {
		this._viewSize = size;
	}

	public get documentAnchorPosition() {
		return this._documentAnchorPosition.slice();
	}

	public set documentAnchorPosition(newPosition: number[]) {
		this._documentAnchorPosition = newPosition;
	}

	protected getDocumentAnchorSection(): CanvasSectionObject {
		return app.sectionContainer.getDocumentAnchorSection();
	}

	/// used in Views which can show pages (Writer) to determine left alignment
	// FIXME: confusing name, should be abstract
	public getDocumentScrollOffset(): number {
		app.console.error('not implemented');
		return 0;
	}

	private calculateHorizontalScrollLength(
		documentAnchor: CanvasSectionObject,
	): void {
		const canvasWidth: number = this.getHorizontalViewportWidth(documentAnchor);
		this.scrollProperties.xOffset = documentAnchor.myTopLeft[0];

		this.scrollProperties.horizontalScrollRailwayOffset =
			documentAnchor.myTopLeft[0];
		this.scrollProperties.horizontalScrollRailwayLength =
			canvasWidth - this.scrollProperties.horizontalScrollRightOffset;

		if (app.map._docLayer._docType === 'spreadsheet') {
			var splitPanesContext: any = app.map.getSplitPanesContext();
			var splitPos = { x: 0, y: 0 };
			if (splitPanesContext) {
				splitPos = splitPanesContext.getSplitPos().clone();
				splitPos.x = Math.round(splitPos.x * app.dpiScale);
			}

			this.scrollProperties.xOffset += splitPos.x;
			this.scrollProperties.horizontalScrollLength =
				canvasWidth -
				splitPos.x -
				this.scrollProperties.horizontalScrollRightOffset;
		} else {
			this.scrollProperties.horizontalScrollLength =
				canvasWidth - this.scrollProperties.horizontalScrollRightOffset;
		}
	}

	private calculateVerticalScrollLength(
		documentAnchor: CanvasSectionObject,
	): void {
		const result: number = documentAnchor.size[1];
		this.scrollProperties.yOffset = documentAnchor.myTopLeft[1];

		this.scrollProperties.verticalScrollRailwayOffset =
			documentAnchor.myTopLeft[1];
		this.scrollProperties.verticalScrollRailwayLength = result;

		if (app.map._docLayer._docType !== 'spreadsheet') {
			this.scrollProperties.verticalScrollLength = result;
		} else {
			const splitPanesContext: any = app.map.getSplitPanesContext();
			let splitPos = { x: 0, y: 0 };
			if (splitPanesContext) {
				splitPos = splitPanesContext.getSplitPos().clone();
				splitPos.y = Math.round(splitPos.y * app.dpiScale);
			}

			this.scrollProperties.yOffset += splitPos.y;
			this.scrollProperties.verticalScrollLength = result - splitPos.y;
		}
	}

	// VULCAN: vector canvas editing (decks and pages) pans up to a
	// HALF-INCH APRON past the page edge (720 twips of slide space), symmetric per axis —
	// the same apron _updateMaxBounds gives the zoom-target clamp.
	// Everything else pans exactly to the document edge.
	protected vulcanScrollPadCore(): number {
		const w = window as any;
		const layer: any = app?.map?._docLayer;
		if (!w.RenderManager?.isVectorRendering?.()) return 0;
		if (!VulcanLiveCanvas.isCanvasDocType(layer?._docType) || app.file.fileBasedView)
			return 0;
		return Math.round(720 * app.twipsToPixels);
	}

	// VULCAN: extra vertical travel BELOW the document's end, in
	// canvas (core) px. Bottom only, unlike the symmetric pad above: it is
	// room for the end to clear something covering the bottom of this frame,
	// not context around the page. 0 here, so every layout keeps its extent;
	// ViewLayoutWriter answers it for the phone READ posture.
	public vulcanBottomApronCore(): number {
		return 0;
	}

	protected calculateTheScrollSizes() {
		// Sizes of the scroll bars.
		this.scrollProperties.verticalScrollSize = Math.round(
			Math.pow(this.scrollProperties.verticalScrollLength, 2) /
				(this.viewSize.pY +
					2 * this.vulcanScrollPadCore() +
					this.vulcanBottomApronCore()),
		);
		// VULCAN: the horizontal thumb is sized against the SCROLLABLE BAND, not
		// the sheet. Sizing it against the sheet makes the travel include the
		// right margin, so the far-right stop lands in blank paper -- the
		// "can still scroll too far right, too much empty space" report. Stock
		// everywhere the band is the sheet (see getVulcanScrollableWidthPx).
		this.scrollProperties.horizontalScrollSize = Math.round(
			Math.pow(this.scrollProperties.horizontalScrollLength, 2) /
				(this.getVulcanScrollableWidthPx() + 2 * this.vulcanScrollPadCore()),
		);

		// Store unclamped values for scroll calculations.
		this.scrollProperties.verticalScrollSizeForScrolling =
			this.scrollProperties.verticalScrollSize;
		this.scrollProperties.horizontalScrollSizeForScrolling =
			this.scrollProperties.horizontalScrollSize;

		// Clamp to minimum for drawing.
		if (
			this.scrollProperties.horizontalScrollSize <
			this.scrollProperties.minimumHorizontalScrollSize
		)
			this.scrollProperties.horizontalScrollSize =
				this.scrollProperties.minimumHorizontalScrollSize;

		if (
			this.scrollProperties.verticalScrollSize <
			this.scrollProperties.minimumVerticalScrollSize
		)
			this.scrollProperties.verticalScrollSize =
				this.scrollProperties.minimumVerticalScrollSize;
	}

	public refreshScrollProperties(): any {
		const documentAnchor = this.getDocumentAnchorSection();

		// The length of the railway that the scroll bar moves on up & down or left & right.
		this.calculateVerticalScrollLength(documentAnchor);
		this.calculateHorizontalScrollLength(documentAnchor);

		// Sizes of the scroll bars.
		this.calculateTheScrollSizes();

		// 1px scrolling = xpx document height / width.
		// Same extent as the thumb above: the document distance the bar maps
		// onto is the band, so bar and document stay in step and the last
		// position shows the text's right edge rather than the page's.
		this.scrollProperties.horizontalScrollRatio =
			(this.getVulcanScrollableWidthPx() + 2 * this.vulcanScrollPadCore() -
				this.getHorizontalViewportWidth(documentAnchor)) /
			(this.scrollProperties.horizontalScrollLength -
				this.scrollProperties.horizontalScrollSize);
		// The bottom apron joins the travel here and nowhere at the top:
		// startY below is unchanged, so the first position is still the
		// document's top and the last one is the apron past its end.
		this.scrollProperties.verticalScrollRatio =
			(this.viewSize.pY +
				2 * this.vulcanScrollPadCore() +
				this.vulcanBottomApronCore() -
				documentAnchor.size[1]) /
			(this.scrollProperties.verticalScrollLength -
				this.scrollProperties.verticalScrollSize);

		// The start position of scroll bars on canvas.
		this.scrollProperties.startX =
			(this.viewedRectangle.pX1 + this.vulcanScrollPadCore()) /
				this.scrollProperties.horizontalScrollRatio +
			this.scrollProperties.xOffset;

		this.scrollProperties.startY =
			(this.viewedRectangle.pY1 + this.vulcanScrollPadCore()) /
				this.scrollProperties.verticalScrollRatio +
			this.scrollProperties.yOffset;

		// Properties for quick scrolling.
		this.scrollProperties.verticalScrollStep = documentAnchor.size[1] / 2;
		this.scrollProperties.horizontalScrollStep = documentAnchor.size[0] / 2;
	}

	// This function doesn't do well. It seems we don't need this function.
	// Tiles middleware seems to manage redraw requests when tiles are ready.
	public areViewTilesReady(): boolean {
		let allReady = true;

		for (let i = 0; i < this.currentCoordList.length; i++) {
			const tempTile = RenderManager.get(this.currentCoordList[i]);

			if (!tempTile || !tempTile.isReady()) allReady = false;
		}

		return allReady;
	}

	protected refreshCurrentCoordList() {
		this.currentCoordList.length = 0;
		const zoom = Math.round(app.map.getZoom());

		const columnCount = Math.ceil(
			this._viewedRectangle.pWidth / RenderManager.tileSize,
		);
		const rowCount = Math.ceil(
			this._viewedRectangle.pHeight / RenderManager.tileSize,
		);
		const startX =
			Math.floor(this._viewedRectangle.pX1 / RenderManager.tileSize) *
			RenderManager.tileSize;
		const startY =
			Math.floor(this._viewedRectangle.pY1 / RenderManager.tileSize) *
			RenderManager.tileSize;

		for (let i = 0; i <= columnCount; i++) {
			for (let j = 0; j <= rowCount; j++) {
				const coords = new TileCoordData(
					startX + i * RenderManager.tileSize,
					startY + j * RenderManager.tileSize,
					zoom,
					0,
				);

				if (RenderManager.isValidTile(coords))
					this.currentCoordList.push(coords);
			}
		}
	}

	public getCurrentCoordList(): Array<TileCoordData> {
		return this.currentCoordList;
	}

	// virtual function implemented by the children
	public viewHasEnoughSpaceToShowFullWidthComments() {
		return false;
	}

	// virtual function implemented by the children
	public unselectCommentOnScroll() {
		return;
	}

	private addToMoveBy(pX: number, pY: number) {
		if (this.scrollProperties.moveBy !== null) {
			// Add offset to the pending move event.
			if (pX !== 0) {
				this.scrollProperties.moveBy[0] += pX;
			}
			if (pY !== 0) {
				this.scrollProperties.moveBy[1] += pY;
			}
		} else {
			// Create a new pending move event.
			this.scrollProperties.moveBy = [pX, pY];
		}
	}
	/*
		`ignoreScrollbarLength` constraints while scrolling the document to make some space for the comments.
		see `ViewLayoutWriter.adjustDocumentMarginsForComments`
	*/
	protected scrollHorizontal(
		pX: number,
		ignoreScrollbarLength: boolean = false,
	): void {
		const scrollProps: ScrollProperties = this.scrollProperties;
		const psX = pX / scrollProps.horizontalScrollRatio;
		if (document.documentElement.dir === 'rtl') pX = -pX;

		if (!ignoreScrollbarLength) {
			let control = scrollProps.moveBy ? scrollProps.moveBy[0] : 0; // Add pending offset.
			control /= scrollProps.horizontalScrollRatio; // Convert to scroll bar position diff.

			const endPosition =
				scrollProps.startX - scrollProps.xOffset + control + psX;
			if (pX > 0) {
				if (
					endPosition + scrollProps.horizontalScrollSize >
					scrollProps.horizontalScrollLength
				)
					pX =
						(scrollProps.horizontalScrollLength -
							scrollProps.horizontalScrollSize -
							scrollProps.startX +
							scrollProps.xOffset -
							control) *
						scrollProps.horizontalScrollRatio;

				if (pX < 0) pX = 0;
			} else {
				if (endPosition < 0)
					pX =
						(scrollProps.startX - scrollProps.xOffset + control) *
						-1 *
						scrollProps.horizontalScrollRatio;

				if (pX > 0) pX = 0;
			}
		}

		this.addToMoveBy(pX, 0);
	}

	// For scrolling with screen offset.
	// This function shouldn't care about the document content, size etc.
	// All this cares is the current scroll position and the scroll length.
	// For making a portion of the document visible, use other methods.
	protected scrollVertical(pY: number): void {
		const scrollProps: ScrollProperties = this.scrollProperties;

		let control = scrollProps.moveBy ? scrollProps.moveBy[1] : 0; // Add pending offset.
		control /= scrollProps.verticalScrollRatio; // Convert to scroll bar position diff.

		const psY = pY / scrollProps.verticalScrollRatio;

		const endPosition =
			scrollProps.startY - scrollProps.yOffset + control + psY;

		if (pY > 0) {
			if (
				endPosition + scrollProps.verticalScrollSize >
				scrollProps.verticalScrollLength
			)
				pY =
					(scrollProps.verticalScrollLength -
						scrollProps.verticalScrollSize -
						scrollProps.startY +
						scrollProps.yOffset -
						control) *
					scrollProps.verticalScrollRatio;

			if (pY < 0) pY = 0;
		} else {
			if (endPosition < 0)
				pY =
					(scrollProps.startY - scrollProps.yOffset + control) *
					-1 *
					scrollProps.verticalScrollRatio;

			if (pY > 0) pY = 0;
		}

		this.addToMoveBy(0, pY);
	}

	public canScrollHorizontal(documentAnchor: CanvasSectionObject): boolean {
		// VULCAN, desktop Writer: OFFER the scrollbar only when the TEXT does
		// not fit. Empty margin is not content, so a page overhanging only by
		// its margins must not scroll -- the opening fit overhangs on purpose.
		//
		// This is a DIFFERENT quantity from the travel band below, and using
		// the band here was a defect: at the opening fit the text was 1078px in
		// a 1216px viewport (fits, no scrollbar wanted) while the band was
		// 1245px, so a 29px sliver of LEFT MARGIN justified a scrollbar and the
		// wheel moved the page 29px. Measured on build 3fc2b744.
		return this.getVulcanTextWidthPx() > this.getHorizontalViewportWidth(documentAnchor);
	}

	protected getHorizontalViewportWidth(documentAnchor: CanvasSectionObject): number {
		const layer: any = app.map && app.map._docLayer;
		if (!this.isVulcanDesktopWriter(layer) || !layer._getDocumentContainerSize)
			return documentAnchor.size[0];
		// The canvas/map may still have its previous inline width on a split
		// transition. Use the same visible-container bound as Writer's fit.
		const width = layer._getDocumentContainerSize()[0] * app.dpiScale;
		return Math.min(documentAnchor.size[0], Math.max(0, width));
	}

	/*
	 * The text column's width in document pixels — the test for whether
	 * scrolling is worth offering at all. Stock everywhere the geometry is
	 * unknown.
	 */
	protected getVulcanTextWidthPx(): number {
		const docLayer: any = app.map && app.map._docLayer;
		if (!this.isVulcanDesktopWriter(docLayer)) return this.viewSize.pX;
		const activeDocument = app.activeDocument;
		if (!activeDocument) return this.viewSize.pX;
		if (!(docLayer._vulcanTextWidthMm100 > 0)) return this.viewSize.pX;

		return VulcanWriterFit.scrollableWidthPx(
			activeDocument.fileSize.pX,
			activeDocument.fileSize.x,
			docLayer._vulcanTextWidthMm100,
			0,
		);
	}

	/*
	 * How far scrolling may travel, once it is offered: to the PAPER'S EDGE.
	 *
	 * Bounding the travel to the text's right edge stopped at an invisible
	 * line — you could not tell you had reached the end. The paper's edge is a
	 * landmark: at the far-right stop it sits at the viewport's edge, mirroring
	 * the way the paper's left edge shows just inside the toolbar at rest, so
	 * reaching the boundary is legible.
	 *
	 * Measured in DOCUMENT pixels: `viewSize.pX` carries a 260px comment-rail
	 * allowance whether or not the document has comments, and mixing that with
	 * a `fileSize.x` twips ratio inflated the band by ~219px of blank paper.
	 */
	protected getVulcanScrollableWidthPx(): number {
		const docLayer: any = app.map && app.map._docLayer;
		if (!this.isVulcanDesktopWriter(docLayer)) return this.viewSize.pX;
		const activeDocument = app.activeDocument;
		if (!activeDocument) return this.viewSize.pX;
		if (!(docLayer._vulcanTextWidthMm100 > 0)) return this.viewSize.pX;
		if (!(activeDocument.fileSize.pX > 0)) return this.viewSize.pX;

		return activeDocument.fileSize.pX;
	}

	private isVulcanDesktopWriter(docLayer: any): boolean {
		return Boolean(
			docLayer &&
				typeof docLayer.isWriter === 'function' &&
				docLayer.isWriter() &&
				document.documentElement.classList.contains('vulcan-desktop-chrome'),
		);
	}

	public canScrollVertical(documentAnchor: CanvasSectionObject): boolean {
		// With the apron, a document a little SHORTER than the canvas can still
		// have its end under whatever covers the frame's bottom, so it scrolls.
		return (
			this.viewSize.pY + this.vulcanBottomApronCore() > documentAnchor.size[1]
		);
	}

	public scroll(
		pX: number,
		pY: number,
		userIsScrolling: boolean = false,
	): void {
		// While a zoom is waiting for its new tiles the canvas is not cleared (to
		// avoid white flicker), so scrolling in that window leaves smears.
		// Force a clear in that case; the flag is reset once the zoom finishes.
		if (
			app.sectionContainer.isZoomChanged() &&
			!app.sectionContainer.isInZoomAnimation()
		)
			app.sectionContainer.setScrollingBeforeZoomSettled(true);
		if (userIsScrolling) this.unselectCommentOnScroll();
		this.refreshScrollProperties();
		const documentAnchor = this.getDocumentAnchorSection();

		if (pX !== 0 && this.canScrollHorizontal(documentAnchor))
			this.scrollHorizontal(pX);

		if (pY !== 0 && this.canScrollVertical(documentAnchor))
			this.scrollVertical(pY);

		this.refreshCurrentCoordList();
		app.sectionContainer.requestReDraw();
	}

	/*
		The origin scrollTo()'s arguments are absolute against.

		Which offset that is, is per-layout, and a pan cannot pick for itself:
		here scrollTo subtracts the viewed rectangle's top-left before
		delegating to scroll(), so the viewed rectangle IS the origin. A layout
		whose scrollTo writes some other offset must override this, or a caller
		panning by a screen delta adds that delta to a number the layout does
		not scroll by.
	*/
	public getScrollOrigin(): number[] {
		return [this._viewedRectangle.pX1, this._viewedRectangle.pY1];
	}

	public scrollTo(
		pX: number,
		pY: number,
		userIsScrolling: boolean = false,
	): void {
		this.refreshScrollProperties();

		this.scrollProperties.moveBy = null;

		pX -= this.viewedRectangle.pX1;
		pY -= this.viewedRectangle.pY1;

		this.scroll(pX, pY, userIsScrolling);
	}

	public setOverviewPageVisArea(point: cool.SimplePoint): void {
		this.scrollTo(point.pX, point.pY);
	}
}
