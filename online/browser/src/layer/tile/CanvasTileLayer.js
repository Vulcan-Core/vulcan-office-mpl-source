/* -*- js-indent-level: 8; fill-column: 100 -*- */
/*
 * window.L.CanvasTileLayer is a layer with canvas based rendering.
 */

/* global app JSDialog CanvasSectionContainer GraphicSelection CanvasOverlay CursorHeaderSection $ _ CPolyUtil CPolygon Cursor UNOKey cool OtherViewCellCursorSection RenderManager SplitSection TextSelections CellSelectionMarkers URLPopUpSection CalcValidityDropDown DocumentBase CellCursorSection FormFieldButton TextCursorSection CStyleData CSelections CReferences OtherViewGraphicSelectionSection CompareChangesLabelSection InternPointUtil InternBoundsUtil VulcanFilmstripFollow VulcanImpressFit VulcanWriterFit VulcanCaretReveal VulcanPdfCanvas VulcanCanvasAutosave VulcanImpressOverlap */

function clamp(num, min, max)
{
	return Math.min(Math.max(num, min), max);
}

window.L.TileSectionManager = window.L.Class.extend({

	initialize: function (layer) {
		this._layer = layer;
		this._canvas = this._layer._canvas;
		this._map = this._layer._map;
		var mapSize = { x:  app.sectionContainer.getWidth(), y:  app.sectionContainer.getHeight() };
		this._tilesSection = null; // Shortcut.

		if (window.L.Browser.cypressTest) // If cypress is active, create test divs.
			app.sectionContainer.testing = true;

		app.sectionContainer.onResize(mapSize.x, mapSize.y);

		var splitPanesContext = this._layer.getSplitPanesContext();
		this._splitPos = splitPanesContext ?
			splitPanesContext.getSplitPos() : new cool.Point(0, 0);
		this._updatesRunning = false;

		var canvasContainer = document.getElementById('document-container');
		var that = this;
		this.resObserver = new ResizeObserver(function() {
			that._layer._syncTileContainerSize();
		});
		this.resObserver.observe(canvasContainer);

		this._zoomAtDocEdgeX = true;
		this._zoomAtDocEdgeY = true;
	},

	getSplitPos: function () {
		var splitPanesContext = this._layer.getSplitPanesContext();
		return splitPanesContext ?
			splitPanesContext.getSplitPos().multiplyBy(app.dpiScale) :
			new cool.Point(0, 0);
	},

	// Details of tile areas to render
	_paintContext: function() {
		var viewBounds = this._map.getPixelBoundsCore();
		var splitPanesContext = this._layer.getSplitPanesContext();
		var paneBoundsList = splitPanesContext ?
		    splitPanesContext.getPxBoundList(viewBounds) :
		    [viewBounds];

		return {
			 viewBounds: viewBounds,
			 paneBoundsList: paneBoundsList,
			 paneBoundsActive: splitPanesContext ? true: false,
			 splitPos: this.getSplitPos(),
		};
	},

	// Debug tool. Splits are enabled for only Calc for now.
	_addSplitsSection: function () {
		const splitSection = new SplitSection();
		app.sectionContainer.addSection(splitSection);
	},

	_removeSplitsSection: function () {
		var section = app.sectionContainer.getSectionWithName('calc grid');
		if (section) {
			section.setDrawingOrder(app.CSections.CalcGrid.drawingOrder);
			section.sectionProperties.strokeStyle = '#c0c0c0';
		}
		app.sectionContainer.removeSection(app.CSections.Debug.Splits.name);
	},

	// Debug tool
	_addTilePixelGridSection: function () {
		app.sectionContainer.addSection(new app.definitions.pixelGridSection());
	},

	_removeTilePixelGridSection: function () {
		app.sectionContainer.removeSection(app.CSections.Debug.TilePixelGrid.name);
	},

	_addDebugOverlaySection: function () {
		app.sectionContainer.addSection(new app.definitions.debugOverlaySection(this._map._debug));
	},

	_removeDebugOverlaySection: function () {
		app.sectionContainer.removeSection(app.CSections.Debug.DebugOverlay.name);
	},

	_addPreloadMap: function () {
		app.sectionContainer.addSection(new app.definitions.preloadMapSection());
	},

	_removePreloadMap: function () {
		app.sectionContainer.removeSection(app.CSections.Debug.PreloadMap.name);
	},

	update: function () {
		app.sectionContainer.requestReDraw();
	},

	/**
	 * Everything in this doc comment is speculation: I didn't write the code that supplies it and I'm guessing to
	 * have something to work on for this function. That said, given my observations, they seem incredibly likely to be correct
	 *
	 * @param pinchCenter {{x: number, y: number}} The current pinch center in doc core-pixels
	 * Normally expressed as an cool.Point instance
	 *
	 * @param pinchStartCenter {{x: number, y: number}} The pinch center at the start of the pinch in doc core-pixels
	 * Normally expressed as an cool.Point instance
	 *
	 * @param paneBounds {{min: {x: number, y: number}, max: {x: number, y: number}}} The edges of the current pane
	 * Traditionally this is the map border at the start of the pinch
	 *
	 * @param freezePane {{freezeX: boolean, freezeY: boolean}} Whether the pane is frozen in the x or y directions
	 *
	 * @param splitPos {{x: number, y: number}} The inset in core-pixels into the document caused by any splits (e.g. a frozen row at the start of the document)
	 *
	 * @param scale {number} The scale, relative to the initial size, of the document currently
	 * Or rather this is equivalent to: old_width / new_width
	 *
	 * @param findFreePaneCenter {boolean} Wether to return a center point
	 *
	 * @returns {{topLeft: {x: number, y: number}, center?: {x: number, y: number}}} An object with a top left point in core-pixels and optionally a center point
	 * Center is included iff findFreePaneCenter is true
	 * (probably this should be encoded into the type, e.g. with an overload when this is converted to TypeScript)
	 **/
	_getZoomDocPos: function (pinchCenter, pinchStartCenter, paneBounds, freezePane, splitPos, scale, findFreePaneCenter) {
		let xMin = 0;
		const hasXMargin = !this._layer.isCalc();
		if (hasXMargin) {
			xMin = -Infinity;
		} else if (paneBounds.min.x > 0) {
			xMin = splitPos.x;
		}

		let yMin = 0;
		if (paneBounds.min.y < 0) {
			yMin = -Infinity;
		} else if (paneBounds.min.y > 0) {
			yMin = splitPos.y;
		}

		const minTopLeft = new cool.Point(xMin, yMin);

		const paneSize = paneBounds.getSize();

		pinchCenter = pinchCenter.subtract(this._offset);

		let centerOffset = {
			x: pinchCenter.x - pinchStartCenter.x,
			y: pinchCenter.y - pinchStartCenter.y,
		};

		// Portion of the pane away that our pinchStart (which should be where we zoom round) is
		const panePortion = {
			x: (pinchStartCenter.x - this._offset.x - paneBounds.min.x) / paneSize.x,
			y: (pinchStartCenter.y - this._offset.y - paneBounds.min.y) / paneSize.y,
		};

		let docTopLeft = new cool.Point(
			pinchStartCenter.x + (centerOffset.x - paneSize.x * panePortion.x) / scale,
			pinchStartCenter.y + (centerOffset.y - paneSize.y * panePortion.y) / scale
		);

		// Top left in document coordinates.
		const clampedDocTopLeft = new cool.Point(
			Math.max(minTopLeft.x, docTopLeft.x),
			Math.max(minTopLeft.y, docTopLeft.y)
		);

		const offset = clampedDocTopLeft.subtract(docTopLeft);

		if (freezePane.freezeX) {
			docTopLeft.x = paneBounds.min.x;
		} else {
			this._offset.x = Math.round(Math.max(this._offset.x, offset.x));
			docTopLeft.x += this._offset.x;
		}

		if (freezePane.freezeY) {
			docTopLeft.y = paneBounds.min.y;
		} else {
			this._offset.y = Math.round(Math.max(this._offset.y, offset.y));
			docTopLeft.y += this._offset.y;
		}

		if (!findFreePaneCenter) {
			return { offset: this._offset, topLeft: docTopLeft };
		}

		const newPaneCenter = new cool.Point(
			(docTopLeft.x - splitPos.x + (paneSize.x + splitPos.x) * 0.5 / scale),
			(docTopLeft.y - splitPos.y + (paneSize.y + splitPos.y) * 0.5 / scale));

		return {
			offset: this._offset,
			topLeft: docTopLeft.add(this._offset),
			center: this._map.rescale(newPaneCenter, this._map.getZoom(), this._map.getScaleZoom(scale)),
		};
	},

	_getZoomMapCenter: function (zoom) {
		var scale = this._calcZoomFrameScale(zoom);
		var ctx = this._paintContext();
		var splitPos = ctx.splitPos;
		var viewBounds = ctx.viewBounds;
		var freePaneBounds = new cool.Bounds(viewBounds.min.add(splitPos), viewBounds.max);

		return this._getZoomDocPos(
			this._newCenter,
			this._layer._pinchStartCenter,
			freePaneBounds,
			{ freezeX: false, freezeY: false },
			splitPos,
			scale,
			true /* findFreePaneCenter */
		).center;
	},

	_zoomAnimation: function () {
		var painter = this;

		var rafFunc = function (timeStamp, final) {
			painter._layer._refreshRowColumnHeaders();

			// Redraw the section container each frame. The tiles section paints
			// the scaled zoom frame from its own onDraw, and the overlay and
			// document sections follow in the same pass instead of freezing.
			app.sectionContainer.requestReDraw();

			if (!final)
				painter._zoomRAF = requestAnimationFrame(rafFunc);
		};
		this.rafFunc = rafFunc;
		rafFunc();
	},

	_calcZoomFrameScale: function (zoom) {
		zoom = this._layer._map._limitZoom(zoom);
		var origZoom = this._layer._map.getZoom();
		// Compute relative-multiplicative scale of this zoom-frame w.r.t the starting zoom(ie the current Map's zoom).
		return this._layer._map.zoomToFactor(zoom - origZoom + this._layer._map.options.zoom);
	},

	_calcZoomFrameParams: function (zoom, newCenter) {
		this._zoomFrameScale = this._calcZoomFrameScale(zoom);
		this._newCenter = this._layer._map.project(newCenter).multiplyBy(app.dpiScale); // in core pixels
	},

	setWaitForTiles: function (wait) {
		this._waitForTiles = wait;
	},

	waitForTiles: function () {
		return this._waitForTiles;
	},

	zoomStep: function (zoom, newCenter) {
		if (this._finishingZoom) // finishing steps of animation still going on.
			return;

		this._calcZoomFrameParams(zoom, newCenter);

		if (!this._inZoomAnim) {
			app.sectionContainer.setInZoomAnimation(true);
			this._inZoomAnim = true;
			this._vulcanSpecRungSent = undefined;
			// Start RAF loop for zoom-animation
			this._zoomAnimation();
		}

		this._vulcanSpeculativePrefetch(zoom);
	},

	/*
	 * R6-7 lever L3: mid-gesture, predict the rung the release grammar will
	 * commit and prefetch its viewport (RenderManager.prefetchZoomStop), so
	 * the commit's tile wait exits on its first poll instead of swapping at
	 * the deadline with holes (measured: the first new-rung tilecombine
	 * left at +154ms AFTER finger-up on every doctype, while the server
	 * answers a full viewport in 70-90ms).
	 *
	 * Prediction is the nearest rung — phone Impress and the sub-snap Calc
	 * band commit exactly that; Calc's directional snap past 0.35 and a
	 * floored commit (fit / legibility) land elsewhere, costing one wasted
	 * viewport and today's wait, no worse than shipped. Phone chrome only.
	 *
	 * PHONE WRITER JOINS THIS AS OF R6-15. It was excluded, with the reason
	 * "its browse-width re-vote relayouts on commit, so pre-commit tiles are
	 * dead weight" — true while a pinch re-stated .uno:BrowseWidth. It no
	 * longer does: VulcanWriterReflow.layoutPinned withholds the re-vote so a
	 * pinch magnifies a fixed layout instead of re-wrapping it, and the
	 * page-layout posture votes a constant -1 that the dedupe drops. Nothing
	 * relayouts on a Writer zoom commit any more, so the predicted rung's
	 * tiles are the tiles the commit will draw.
	 *
	 * That exclusion also became the expensive one to keep. Cross-rung phone
	 * Writer was rare while every pinch cost a whole-document relayout;
	 * optical zoom makes it the primary reading gesture, and it is the only
	 * path left paying the full tile wait (the L6a fast arm covers same-rung
	 * only).
	 *
	 * The commit-center math (_getZoomMapCenter -> _getZoomDocPos) ratchets
	 * this._offset; snapshot/restore so a mid-gesture prediction cannot
	 * disturb the live frame's pan clamp. typeof-guards keep the minimal
	 * mocha painter rigs on the shipped path.
	 */
	_vulcanSpeculativePrefetch: function (zoom) {
		var layer = this._layer;
		if (typeof layer._vulcanPhoneChrome !== 'function' ||
			!layer._vulcanPhoneChrome())
			return;
		if (typeof RenderManager === 'undefined' ||
			typeof RenderManager.prefetchZoomStop !== 'function')
			return;
		var map = this._map;
		var predicted = Math.round(map._limitZoom(zoom));
		if (predicted === Math.round(map.getZoom()))
			return;
		if (predicted === this._vulcanSpecRungSent)
			return;
		this._vulcanSpecRungSent = predicted;
		var savedOffset = this._offset && this._offset.clone ?
			this._offset.clone() : undefined;
		var center;
		try {
			center = this._getZoomMapCenter(predicted);
		} finally {
			if (savedOffset !== undefined)
				this._offset = savedOffset;
		}
		if (!center)
			return;
		RenderManager.prefetchZoomStop(predicted, center);
	},

	zoomStepEnd: function (zoom, newCenter, mapUpdater, runAtFinish, noGap) {

		// TWO LANES LAND THE SAME TWO PHONE-PINCH DECISIONS HERE, on different
		// surfaces: the SLIDES lane scoped them to phone Impress (below), the
		// SHEETS lane shipped them for every document. Each phone doctype
		// keeps its fix -- the DOCS arm below completes the set with the
		// no-animation restore only -- while desktop stays on the stock path,
		// the narrower contract the Impress lane deliberately drew (see
		// MouseControl.onMultiTouchCancel).
		//
		// A two-finger TAP reaches here: onMultiTouchStart ran preZoomAnimation
		// -- which hides the caret and the overlay markers -- but no move ever
		// called zoomStep, so there is no animation to finish. Returning without
		// runAtFinish left postZoomAnimation uncalled and the markers hidden
		// until some later unrelated redraw happened to restore them. Measured
		// 0 -> 1 postZoomAnimation calls on the rig.
		//
		// The `!this._finishingZoom` term makes this arm identical to running it
		// after the guard below; it is hoisted only so that guard stays
		// byte-identical, because ImpressPhonePinch.test.ts extracts this
		// method's source and mutates that exact block back to its legacy form.
		// `isCalc` is read defensively for the same reason: that test drives the
		// painter with a minimal _layer stub carrying only the Impress pair, and
		// a missing method there must read as "not Calc", not throw.
		const vulcanPhoneCalc =
			typeof this._layer.isCalc === 'function' &&
			this._layer.isCalc() && this._layer._vulcanPhoneChrome();

		if (vulcanPhoneCalc && !this._finishingZoom && !this._inZoomAnim) {
			if (runAtFinish)
				runAtFinish();
			return;
		}

		// THE SAME RESTORE FOR PHONE WRITER (the DOCS lane). A two-finger
		// TAP -- resting two fingers on the page without moving, the common
		// re-grip -- ran preZoomAnimation (caret marker and knob to opacity
		// 0, TextSelections.hideHandles) but never zoomStep, so nothing was
		// animating and phone Writer fell through the guards below without
		// runAtFinish: the caret marker and the selection teardrops stayed
		// invisible -- the teardrops until a real moving pinch completed,
		// because postZoomAnimation is the only caller of
		// TextSelections.showHandles in the tree. Same hoisted shape as the
		// Calc arm above: the `!this._finishingZoom` term keeps it identical
		// to running after the guard below, which ImpressPhonePinch.test.ts
		// pins byte-for-byte, and `typeof` keeps minimal mocha layer stubs
		// reading as "not Writer" instead of throwing.
		const vulcanPhoneWriter =
			typeof this._layer.isWriter === 'function' &&
			this._layer.isWriter() && this._layer._vulcanPhoneChrome();

		if (vulcanPhoneWriter && !this._finishingZoom && !this._inZoomAnim) {
			if (runAtFinish)
				runAtFinish();
			return;
		}

		// A no-move phone pinch ran preZoomAnimation but never started zoomStep;
		// its finish callback still has to restore the hidden overlay state.
		if (this._finishingZoom)
			return;

		const vulcanPhoneImpress =
			this._layer.isImpress() && this._layer._vulcanPhoneChrome();

		if (!this._inZoomAnim) {
			if (vulcanPhoneImpress && runAtFinish)
				runAtFinish();
			return;
		}

		this._finishingZoom = true;

		this._map.disableTextInput();
		// Do a another animation from current non-integral log-zoom to
		// the final integral zoom, but maintain the same center.
		var steps = 10;
		var stepId = noGap ? steps : 0;

		var startZoom = this._zoomFrameScale;
		var endZoom = this._calcZoomFrameScale(zoom);
		var painter = this;
		var map = this._map;

		// Calculate the final center at final zoom in advance.
		var newMapCenter = this._getZoomMapCenter(zoom).divideBy(app.dpiScale);
		var newMapCenterIntern = map.unproject(newMapCenter, zoom);
		app.sectionContainer.setZoomChanged(true);

		var stopAnimation = noGap ? true : false;
		var waitForTiles = false;
		// Wall-clock, not RAF frames: the old 30-try counter was ~250ms on
		// a 120Hz phone and ~500ms at 60Hz — the swap contract should not
		// depend on the display's refresh rate. (R6-7)
		var waitDeadline = undefined;
		var finishingRAF = undefined;

		var finishAnimation = function () {

			if (stepId < steps) {
				// continue animating till we reach "close" to 'final zoom'.
				painter._zoomFrameScale = startZoom + (endZoom - startZoom) * stepId / steps;
				stepId += 1;
				if (stepId >= steps)
					stopAnimation = true;
			}

			if (stopAnimation) {
				stopAnimation = false;
				cancelAnimationFrame(painter._zoomRAF);
				painter._calcZoomFrameParams(zoom, newCenter);
				// Draw one last frame at final zoom.
				painter.rafFunc(undefined, true /* final? */);
				painter._zoomFrameScale = undefined;
				app.sectionContainer.setInZoomAnimation(false);
				painter._inZoomAnim = false;

				// Every zoom frame wrote app.twipsToPixels = base*scale and
				// swapped in a zoom-frame viewedRectangle. A rung CHANGE heals
				// both (_reset gates _updateTileTwips on tileZoomChanged); a
				// SAME-RUNG settle never did, so the frame drift compounded
				// pinch over pinch, all doctypes. Recompute from the rounded
				// rung — never multiply the drift back out — then rebuild the
				// rectangle. Hoisted ABOVE the phone fast arms below, which are
				// pinned as exact source text by ImpressPhonePinch.test.ts;
				// typeof-guarded because mocha rigs drive this with minimal
				// _layer stubs.
				if (zoom === map.getZoom() &&
					typeof painter._layer._restoreRoundedRungTwips === 'function' &&
					typeof painter._layer._syncTilePanePos === 'function') {
					painter._layer._restoreRoundedRungTwips();
					painter._layer._syncTilePanePos();
				}

				// A same-rung phone pinch can still translate the map, but its
				// current-zoom tiles are already available. Commit the new center
				// and finish without entering the tile-refetch wait below.
				if (vulcanPhoneImpress && zoom === map.getZoom()) {
					cancelAnimationFrame(finishingRAF);
					mapUpdater(newMapCenterIntern);
					app.sectionContainer.setZoomChanged(false);
					map.enableTextInput();
					map.focus(map.canAcceptKeyboardInput());
					app.sectionContainer.requestReDraw();
					painter._finishingZoom = false;
					runAtFinish();
					return;
				}

				// THE SAME SHORTCUT FOR PHONE CALC, and NOTHING TO REFETCH when the
				// gesture landed on the zoom it started at. Every tile in view is
				// already at this zoom, so the wait-for-tiles round trip below --
				// setWaitForTiles, setZoomChanged and up to 500ms of a frozen,
				// input-disabled canvas -- is entirely spent on a gesture that
				// changed nothing. Before the nearest-rung settle in
				// MouseControl.onMultiTouchEnd this branch was nearly unreachable,
				// because ceil/floor guaranteed every pinch changed the zoom; now it
				// is the common case for a small pinch. Measured on the rig: settles
				// entered per pinch went 1.0 -> 0.0 for magnitudes under half a
				// level, and stayed 1.0 for every pinch that did change the zoom.
				//
				// mapUpdater still runs: a pinch pans as well as zooms, and at
				// unchanged zoom setView takes its own panBy path (Map.js:490)
				// rather than a hard view reset.
				//
				// Kept as its own arm rather than folded into the Impress condition
				// above: that block is mutated as exact source text by
				// ImpressPhonePinch.test.ts, which also pins non-phone-Impress
				// documents to the tile-wait path.
				if (vulcanPhoneCalc && zoom === map.getZoom()) {
					cancelAnimationFrame(finishingRAF);
					mapUpdater(newMapCenterIntern);
					app.sectionContainer.setZoomChanged(false);
					map.enableTextInput();
					map.focus(map.canAcceptKeyboardInput());
					app.sectionContainer.requestReDraw();
					painter._finishingZoom = false;
					runAtFinish();
					return;
				}

				// THE SAME SHORTCUT FOR PHONE WRITER (R6-7 lever L6a). A
				// same-rung commit re-votes an IDENTICAL browse width -- the
				// reflow vote is a function of viewport and zoom, both
				// unchanged (VulcanWriterReflow) -- so no relayout follows
				// and every tile in view is already at this rung. Measured
				// on the slot-02 z1 rig (r6-7 baseline): the micro pinch
				// spent the FULL exhausted wait -- +400ms of frozen,
				// input-disabled canvas at 120Hz, ~double at 60Hz -- on a
				// gesture that fetched nothing. Cross-rung Writer commits
				// keep the wait below: those DO re-vote and refetch. Kept as
				// its own arm, after the Calc one: ImpressPhonePinch.test.ts
				// pins the Impress arm's exact bytes and executes this whole
				// method, so additions stay outside the pinned spans.
				if (vulcanPhoneWriter && zoom === map.getZoom()) {
					cancelAnimationFrame(finishingRAF);
					mapUpdater(newMapCenterIntern);
					app.sectionContainer.setZoomChanged(false);
					map.enableTextInput();
					map.focus(map.canAcceptKeyboardInput());
					app.sectionContainer.requestReDraw();
					painter._finishingZoom = false;
					runAtFinish();
					return;
				}

				painter.setWaitForTiles(true);
				// Set view and paint the tiles if all available.
				mapUpdater(newMapCenterIntern);
				// VULCAN belt (slides-blank-zoom): the committed view must
				// hold painted content — reconcile/clamp per doctype (see
				// _vulcanClampCommittedView) BEFORE the wait below starts
				// polling for its tiles. typeof-guarded because the mocha
				// rigs drive this method with minimal _layer stubs, which
				// must read as "no belt", not throw; phone chrome only
				// inside, so desktop and tablet keep the stock pipeline.
				if (typeof painter._layer._vulcanClampCommittedView ===
					'function') {
					painter._layer._vulcanClampCommittedView();
					// The belt's layout.scroll queues its tile re-request on
					// the ASYNC layouting queue — measured landing at +365ms
					// after finger-up (z1/z3 rigs, in1 leg) while the wait
					// below polls the post-belt view from its first frame:
					// the request the wait depends on went out 200ms after
					// the wait began, and every big zoom-in swapped at the
					// deadline with holes. Request the post-belt view NOW —
					// update() reads the already-scrolled layout state
					// synchronously. Phone chrome only, like the belt itself;
					// desktop's stock pipeline keeps its own update timing.
					// The typeof read keeps the mocha zoomStepEnd rigs — a
					// bare Function scope without the bundle's globals — on
					// the shipped path. (R6-7 lever L3)
					if (typeof RenderManager !== 'undefined' &&
						typeof painter._layer._vulcanPhoneChrome ===
							'function' && painter._layer._vulcanPhoneChrome())
						RenderManager.update();
				}
				waitForTiles = true;
				waitDeadline = performance.now() + 500;
			}

			if (waitForTiles) {
				// Wait until we get all tiles or wait time exceeded.
				if (performance.now() >= waitDeadline ||
					painter._tilesSection.haveAllTilesInView()) {
					// All done.
					waitForTiles = false;
					cancelAnimationFrame(finishingRAF);
					painter.setWaitForTiles(false);
					app.sectionContainer.setZoomChanged(false);
					map.enableTextInput();
					// VULCAN (code review): a trackpad pinch (ctrl+wheel)
					// over the document is no keyboard gesture, and on the vbox
					// rig this restore took the keyboard from the agent composer:
					// the next words typed there went into a cell. While the host
					// owns the keyboard and this frame does not hold it, it stays
					// there (the caret path's test, _updateCursorAndOverlay). The
					// policy test comes first for the rigs that run this over a
					// stub map.
					if (!(map._vulcanAutoFocusOnLoad === false && !document.hasFocus()))
						map.focus(map.canAcceptKeyboardInput());
					// Paint everything.
					app.sectionContainer.requestReDraw();
					// Don't let a subsequent pinchZoom start before finishing all steps till this point.
					painter._finishingZoom = false;
					// Run the finish callback.
					runAtFinish();
					return;
				}
			}

			finishingRAF = requestAnimationFrame(finishAnimation);
		};

		finishAnimation();
	},

	getTileSectionPos : function () {
		return new cool.Point(this._tilesSection.myTopLeft[0], this._tilesSection.myTopLeft[1]);
	}
});

window.L.CanvasTileLayer = window.L.Layer.extend({

	options: {
		tileSize: window.tileSize,
		opacity: 1,

		// DEAD OPTION -- reads as "phones only draw tiles once the pan has
		// stopped", and it does not do that, because nothing reads it. This
		// name is inherited from Leaflet's own L.TileLayer, which this class
		// replaced; `updateWhenIdle` occurs exactly once in the whole browser
		// tree (this line), and `L.setOptions` only copies options onto the
		// instance. The pan-time tile path is device-neutral and does NOT
		// consult it: `getEvents` throttles `move` by `updateInterval` and
		// always calls `_moveThrottledUpdate` -> `RenderManager.update()`, and the only
		// move-time filter in the pipeline is the duplicate-request dedup in
		// BitmapTileManager.removeIrrelevantsFromCoordsQueue, keyed on
		// `_moveInProgress`, not on the device. Left in place rather than
		// deleted: removing it changes no behaviour, and an integrator may
		// pass the name in. Do not "fix" phone pan rendering by flipping it.
		updateWhenIdle: (window.mode.isSmallScreenDevice() || window.mode.isTablet()),
		updateInterval: 200,

		attribution: null,
		zIndex: null,
		bounds: null,

		previewInvalidationTimeout: 1000,
	},

	_pngCache: [],

	initialize: function (options) {

		window.L.Layer.prototype.initialize.call(this);

		options = window.L.setOptions(this, options);

		// text, presentation, spreadsheet, etc
		this._docType = options.docType;
		this._documentInfo = '';
		if (!this.isWriter())
			app.setCursorVisibility(false); // Don't change the default for Writer.
		// Last cursor position for invalidation
		this.lastCursorPos = null;
		// Are we zooming currently ? - if so, no cursor.
		this._isZooming = false;

		app.calc.cellCursorVisible = false;
		this._prevCellCursorAddress = null;
		this._shapeGridOffset = new cool.SimplePoint(0, 0);

		// Position and size of the selection start (as if there would be a cursor caret there).

		this._lastValidPart = -1;
		// Cursor marker
		this._cursorMarker = null;

		this._msgQueue = [];
		this._toolbarCommandValues = {};
		this._previewInvalidations = [];

		this._editorId = -1;
		app.setFollowingUser(options.viewId);

		this._selectedTextContent = '';

		this._moveInProgress = false;
		// tile requests issued while _moveInProgress is true,
		// i.e. issued between moveStart and moveEnd
		this._moveTileRequests = [];
		this._canonicalIdInitialized = false;

		RenderManager.initialize(this._docType);
	},

	_initContainer: function () {
		if (this._canvasContainer) {
			window.app.console.error('called _initContainer() when this._canvasContainer is present!');
		}

		if (this._container) { return; }

		this._container = window.L.DomUtil.create('div', 'leaflet-layer');
		this._updateZIndex();

		this.getPane().appendChild(this._container);

		var mapContainer = document.getElementById('document-container');
		var canvasContainerClass = 'leaflet-canvas-container';
		this._canvasContainer = window.L.DomUtil.create('div', canvasContainerClass, mapContainer);
		this._canvasContainer.id = 'canvas-container';
		this._setup();
	},

	_setup: function () {

		if (!this._canvasContainer) {
			window.app.console.error('canvas container not found. _initContainer failed ?');
		}

		this._canvas = window.L.DomUtil.createWithId('canvas', 'document-canvas', this._canvasContainer);
		this._canvas.style.visibility = 'hidden';
		// setAttribute, not the ARIA reflection IDL properties (`.role` /
		// `.ariaLabel`). Reflection is recent -- `Element.ariaLabel` is
		// Safari 16.4+, and `Element.role` is later still (Chrome 119,
		// Firefox 119, Safari 16.4) -- and where it is missing BOTH lines
		// below silently become plain JS expandos: the element ends up with
		// no `role` attribute and no `aria-label` attribute, and a screen
		// reader gets nothing.
		//
		// Two reasons this is the wrong place to rely on it.
		//
		// 1. It is against the grain of the tree. Counted, not assumed:
		//    `grep -rn "setAttribute('role'" src/` is 96 hits, `grep -rEn
		//    "\w\.role = " src/` is 2 -- and after this change both of those
		//    survivors are jsdialog widgets (Widget.Containers.ts:80,
		//    Widget.Combobox.js:247), a separate surface with the same latent
		//    problem that is not this file's to fix. This WAS the tree's only
		//    `.ariaLabel =`; after this change that grep returns nothing.
		//
		// 2. It silently defeats the phone Impress fix that depends on it.
		//    ImpressTileLayer._updateSlideAccessibleName re-labels THIS
		//    element with 'Slide N of M' and already writes through
		//    setAttribute for exactly the Safari reason above (the note at
		//    ImpressTileLayer.js:356-358). But <canvas> has no implicit ARIA
		//    role, so with the `role` line no-oped the label lands on a
		//    role-less generic element and is not reliably exposed -- the
		//    label half was hardened and the role half it needs was left on
		//    the unsafe path.
		//
		// Where reflection DOES exist this is a no-op: both properties
		// reflect to these same two attributes, so the resulting DOM is
		// byte-identical on every modern browser. No gate, because there is
		// no behaviour to gate -- this is the same accessible name on every
		// doctype and every form factor, just written so it survives.
		this._canvas.setAttribute('role', 'img');
		this._canvas.setAttribute('aria-label', _('Online Editor'));

		app.sectionContainer = new CanvasSectionContainer(this._canvas, this.isCalc() /* disableDrawing? */);
		app.activeDocument = new DocumentBase();

		this._container.style.position = 'absolute';
		this._cursorDataDiv = window.L.DomUtil.create('div', 'cell-cursor-data', this._canvasContainer);
		this._selectionsDataDiv = window.L.DomUtil.create('div', 'selections-data', this._canvasContainer);
		this._splittersDataDiv = window.L.DomUtil.create('div', 'splitters-data', this._canvasContainer);
		this._cursorOverlayDiv = window.L.DomUtil.create('div', 'cursor-overlay', this._canvasContainer);
		if (window.L.Browser.cypressTest) {
			this._emptyDeltaDiv = window.L.DomUtil.create('div', 'empty-deltas', this._canvasContainer);
			this._emptyDeltaDiv.innerText = 0;
		}
		this._splittersStyleData = new CStyleData(this._splittersDataDiv);

		this._painter = new window.L.TileSectionManager(this);

		app.sectionContainer.addSection(new cool.TilesSection());
		this._painter._tilesSection = app.sectionContainer.getSectionWithName('tiles');
		app.sectionContainer.setDocumentAnchorSection(app.CSections.Tiles.name);

		if (this._docType === 'text')
			app.sectionContainer.addSection(new CompareChangesLabelSection());

		app.sectionContainer.getSectionWithName('tiles').onResize();

		// Add the vector main-view section for Impress and Draw when vector
		// rendering is enabled. The tile grid stays empty in this mode.
		if (RenderManager.isVectorRendering()) {
			app.sectionContainer.addSection(new cool.VectorContentSection());
		}

		// Rubber-band select visual for the live canvas (Impress and Draw):
		// core already marks the objects an empty-canvas drag covers, but its
		// rubber-band overlay never reaches LOK clients — this draws it.
		if (this.isImpress() || this.isDraw()) {
			app.sectionContainer.addSection(new cool.VulcanImpressMarqueeSection());
			// The PDF half of the canvas: pages that arrive as protected
			// pictures are decomposed for an edit session. A PDF opens as a
			// drawing; a deck would post every slide to the PDF-only routes.
			if (this.isDraw()) VulcanPdfCanvas.attach();
			// The page canvas saves itself a few seconds after the last edit
			// (a deck keeps the server's idle autosave).
			VulcanCanvasAutosave.attach();
			// A PDF is a finished document: the spellchecker's red underlines
			// (COMAR, a statute's citation, a person's name) are not the
			// reader's. Switch automatic spellcheck off once the engine reports
			// it on; the command is a toggle, so only a reported "true" flips it.
			if (this.isDraw()) {
				let spellSwitched = false;
				this._map.on('commandstatechanged', (e) => {
					if (spellSwitched || !e || e.commandName !== '.uno:SpellOnline') return;
					if (e.state === 'true' || e.state === true) {
						spellSwitched = true;
						app.socket.sendMessage('uno .uno:SpellOnline');
					}
				});
			}
		}

		this._canvasOverlay = new CanvasOverlay(this._map, app.sectionContainer.getContext());
		app.sectionContainer.addSection(this._canvasOverlay);

		app.sectionContainer.addSection(new cool.ScrollSection(() => this.isCalcRTL()));

		// For mobile/tablet the hammerjs swipe handler already uses a requestAnimationFrame to fire move/drag events
		// Using window.L.TileSectionManager's own requestAnimationFrame loop to do the updates in that case does not perform well.
		if (window.mode.isSmallScreenDevice() || window.mode.isTablet()) {
			this._map.on('move', this._painter.update, this._painter);
			this._map.on('moveend', function () {
				setTimeout(this.update.bind(this), 200);
			}, this._painter);
		}
		this._map.on('zoomend', this._painter.update, this._painter);
		this._map.on('splitposchanged', function () {
			RenderManager.update();
		}, this);
		this._map.on('sheetgeometrychanged', this._painter.update, this._painter);
		this._map.on('move', this._syncTilePanePos, this);

		this._map.on('viewrowcolumnheaders', this._painter.update, this._painter);
		this._map.on('messagesdone', RenderManager.sendProcessedResponse, RenderManager);

		if (this._docType === 'spreadsheet') {
			const calcGridSection = new app.definitions.calcGridSection();
			calcGridSection.sectionProperties.tsManager = this._painter;
			this._painter._calcGridSection = calcGridSection;
			app.sectionContainer.addSection(calcGridSection);
		}

		// Add it regardless of the file type.
		app.sectionContainer.addSection(new app.definitions.CommentSection());

		document.addEventListener('blur', this._onDocumentBlur.bind(this));
		document.addEventListener('focus', this._onDocumentFocus.bind(this));

		this._syncTileContainerSize();
	},

	// Returns true if the document type is Writer.
	isWriter: function() {
		return this._docType === 'text';
	},

	// Returns true if the document type is Calc.
	isCalc: function() {
		return this._docType === 'spreadsheet';
	},

	// Returns true if the document type is Impress.
	isImpress: function() {
		return this._docType === 'presentation';
	},

	// Returns true if the document type is Draw.
	isDraw: function() {
		return this._docType === 'drawing';
	},

	getContainer: function () {
		return this._container;
	},

	_updateZIndex: function () {
		if (this._container && this.options.zIndex !== undefined && this.options.zIndex !== null) {
			this._container.style.zIndex = this.options.zIndex;
		}
	},

	_onDocumentBlur: function() {
		// Reclaim the graphics memory of non-visible tiles when the document loses focus
		// (which happens when the browser is minimised, switched away from or when switching
		// tabs).
		// We do this as systems with poor video memory management can show bad side-effects
		// in other applications while we hold onto lots of video memory.
		this.onDocumentBlurTimeout = setTimeout(() => {
			this.onDocumentBlurTimeout = null;
			RenderManager.clearPreFetch();
			RenderManager.pruneTiles();
			RenderManager.reclaimGraphicsMemory();
		}, 500);
	},

	_onDocumentFocus: function() {
		if (this.onDocumentBlurTimeout) {
			clearTimeout(this.onDocumentBlurTimeout);
			this.onDocumentBlurTimeout = null;
			return;
		}

		RenderManager.resetPreFetching();

		// We may want to consider touching tiles in an area surrounding the visible area
		// for enhanced interactivity on the first scroll after refocusing.
		// Anecdotally, I don't notice any negative impact right now though.
	},

	_reset: function (hard) {
		var tileZoom = Math.round(this._map.getZoom()),
		    tileZoomChanged = this._tileZoom !== tileZoom;

		if (hard || tileZoomChanged) {
			this._resetClientVisArea();

			this._tileZoom = tileZoom;
			if (tileZoomChanged) {
				this._updateTileTwips();
				this._updateMaxBounds();
			}

			if (app.tile.size.x === 0 || app.tile.size.y === 0) {
				let tileWidthTwips = this.options.tileWidthTwips;
				app.twipsToPixels =  RenderManager.tileSize / tileWidthTwips;
				app.pixelsToTwips = 1 / app.twipsToPixels;
				app.tile.size.pX = app.tile.size.pY = RenderManager.tileSize;
			}

			if (!window.L.Browser.mobileWebkit)
				RenderManager.update(this._map.getCenter(), tileZoom);

			if (tileZoomChanged)
				RenderManager.pruneTiles();

			if (this._docType === 'spreadsheet')
				this._syncTileContainerSize();
		}
	},

	// These variables indicates the clientvisiblearea sent to the server and stored by the server
	// We need to reset them when we are reconnecting to the server or reloading a document
	// because the server needs new data even if the client is unmodified.
	_resetClientVisArea: function ()  {
		this._clientZoom = '';
		app.activeDocument.activeLayout.resetClientVisibleArea();
	},

	_resetCanonicalIdStatus: function() {
		this._canonicalIdInitialized = false;
	},

	_resetViewId: function () {
		this._viewId = undefined;
	},

	_resetDocumentInfo: function () {
		this._documentInfo = "";
	},

	_getViewId: function () {
		return this._viewId;
	},

	_updateTileTwips: function () {
		this._restoreRoundedRungTwips();

		if (this._docType === 'spreadsheet')
			this._syncTileContainerSize();
	},

	// The rounded-rung half of _updateTileTwips, split out so the same-rung
	// settle in zoomStepEnd can heal the globals without re-entering
	// _syncTileContainerSize — that is a resize responder (setView,
	// _fitWidthZoom) and nothing resized during a same-rung pinch.
	_restoreRoundedRungTwips: function () {
		// smaller zoom = zoom in
		const factor = Math.pow(1.2, (this._map.options.zoom - this._tileZoom));
		const tileWidthTwips = Math.round(this.options.tileWidthTwips * factor);

		app.twipsToPixels = RenderManager.tileSize / tileWidthTwips;
		app.pixelsToTwips = 1 / app.twipsToPixels;
		app.tile.size.pX = app.tile.size.pY = RenderManager.tileSize;
	},

	_checkSpreadSheetBounds: function (newZoom) {
		// for spreadsheets, when the document is smaller than the viewing area
		// we want it to be glued to the row/column headers instead of being centered
		// In the future we probably want to remove this and set the bonds only on the
		// left/upper side of the spreadsheet so that we can have an 'infinite' number of
		// cells downwards and to the right, like we have on desktop
		var viewSize = this._map.getSize();
		var scale = this._map.getZoomScale(newZoom);
		var width = app.activeDocument.fileSize.x / app.tile.size.x * RenderManager.tileSize * scale;
		var height = app.activeDocument.fileSize.y / app.tile.size.y * RenderManager.tileSize * scale;
		if (width < viewSize.x || height < viewSize.y) {
			// if after zoomimg the document becomes smaller than the viewing area
			width = Math.max(width, viewSize.x);
			height = Math.max(height, viewSize.y);
			if (!this._map.options._origMaxBounds) {
				this._map.options._origMaxBounds = this._map.options.maxBounds;
			}
			scale = InternPointUtil.scale(1);
			this._map.setMaxBounds(InternBoundsUtil.flexConstruct(
				this._map.unproject(new cool.Point(0, 0)),
				this._map.unproject(new cool.Point(width * scale, height * scale))));
		}
		else if (this._map.options._origMaxBounds) {
			// if after zoomimg the document becomes larger than the viewing area
			// we need to restore the initial bounds
			this._map.setMaxBounds(this._map.options._origMaxBounds);
			this._map.options._origMaxBounds = null;
		}
	},

	_moveStart: function () {
		RenderManager.resetPreFetching();
		this._moveInProgress = true;
		this._moveTileRequests = [];
	},

	_move: function () {
		// We throttle the "move" event, but in moveEnd we always call
		// a _move anyway, so if there are throttled moves still
		// pending by the time moveEnd is called then there is no point
		// processing them after _moveEnd because we are up to date
		// already when they arrive and to do would just duplicate tile
		// requests
		if (!this._moveInProgress)
			return;

		RenderManager.update();
		RenderManager.resetPreFetching(true);
	},

	// The `move` throttle's target, deliberately NOT `_move`. Map.panBy fires
	// movestart, move and moveend in one statement, so between two panBy
	// calls `_moveInProgress` is already false -- and the throttle's queued
	// trailing call runs from its own timer, i.e. always between panBy calls.
	// Through `_move` it returned without updating, and because that trailing
	// call re-arms the lock, every later leading edge of the gesture was
	// queued and dropped the same way. A continuous pan (a finger drag, a
	// fling, a selection handle held at the screen edge driving
	// ScrollSection's autoscroll) therefore requested no tiles after its
	// first frame, and everything it scrolled into stayed blank until the
	// motion stopped. Updating here regardless of the flag keeps one update
	// per updateInterval for the whole gesture; the settle still adds the
	// last one. `_container` is nulled in onRemove, so a timer left over from
	// a torn-down layer cannot update behind its replacement.
	_moveThrottledUpdate: function () {
		if (!this._container)
			return;

		RenderManager.update();
		RenderManager.resetPreFetching(true);
	},

	_isInternInView: function (position) {
		var centerOffset = this._map._getCenterOffset(position);
		var viewHalf = this._map.getSize()._divideBy(2);
		var positionInView =
			centerOffset.x > -viewHalf.x && centerOffset.x < viewHalf.x &&
			centerOffset.y > -viewHalf.y && centerOffset.y < viewHalf.y;
		return positionInView;
	},

	_moveEnd: function () {
		// THROTTLED, because "moveend" is not the end of anything during a drag.
		//
		// Map.panBy fires `move` and `moveend` in ONE statement (Map.js:481),
		// and a touch drag calls panBy once per animation frame. `move` is
		// throttled to updateInterval; `moveend` was not, and this called
		// _move() raw -- so the throttle was bypassed sixty times a second and
		// every frame of every scroll paid for a full tile-cache sweep, a sort
		// of the visible set, and a clientvisiblearea message on the socket.
		// That is the largest block of non-paint main-thread work on the scroll
		// path, and it is why scrolling stutters more the longer you scroll.
		//
		// 🔴 AN EARLIER REVISION OF THIS COMMENT SAID sharing the throttled
		// instance was safe because "app.util.throttle keeps a trailing call,
		// so the last panBy of a gesture still produces a real _move() once
		// the lock expires. The settle is not dropped, it is coalesced."
		//
		// THAT IS REFUTED BY THE THREE LINES IT SAT ON TOP OF. The trailing
		// call DID fire -- and returned at `if (!this._moveInProgress) return`
		// (_move, above), because `_moveInProgress = false` ran on the
		// statement below, synchronously, long before the lock expired. So the
		// settle was not coalesced, it was DELETED, and the code that deleted
		// it was in the same function as the comment claiming it survived.
		//
		// What that costs: Map.panBy fires movestart, move and moveend in one
		// statement (Map.js:489), so during a drag the throttled `move`
		// updates once per updateInterval (through _moveThrottledUpdate, which
		// does not read the flag -- through `_move` it updated only on the
		// gesture's first frame) -- the throttling win is real and is kept.
		// It is the LAST panBy that has no leading edge to catch
		// it: you stop scrolling and the newly revealed strip stays blank,
		// with nothing scheduled to fill it. Every form factor, not just
		// phones. Before the campaign, `moveend` called `_move()` raw and
		// synchronously, i.e. while the flag was still true, which is why the
		// settle used to arrive.
		//
		// THE SETTLE IS NOW ITS OWN SCHEDULE, and deliberately not the `move`
		// throttle: "the gesture ended" is a TRAILING-only question, and
		// answering it needs a timer that each new panBy pushes back rather
		// than one that a leading edge can consume. It also does not read
		// `_moveInProgress` -- the whole point is that it runs after the flag
		// has gone down.
		//
		// Everything else here stays immediate: they are cheap bookkeeping and
		// _moveInProgress in particular gates other code.
		this._scheduleMoveSettle();
		this._moveInProgress = false;
		this._moveTileRequests = [];
		app.updateFollowingUsers();
	},

	// One update, updateInterval after the LAST moveend rather than after the
	// first. A drag pushes it back on every frame; when the frames stop, it
	// fires once. Cancelled on remove so a torn-down layer cannot update
	// behind its replacement.
	//
	// ⚠ MEASURED, AND IT BUYS NOTHING OBSERVABLE. An earlier version of this
	// comment said it "fills whatever the gesture revealed", and the commit
	// that added it called the missing settle a P0. Both overstate it. On the
	// live build, phone profile, Dinosaurs.docx at zoom 14 with 5979 CSS px of
	// pan headroom, counting `tilecombine` after the finger stops:
	//
	//     before the fix   1027, 1035, 1025 ms
	//     after the fix    1226, 1227, 1231 ms  (and 1227/1227/1234 on a repeat)
	//
	// i.e. UNCHANGED. Tiles were never actually lost: another path -- the
	// server's own invalidation following `clientvisiblearea` -- fetches them
	// about 1.2 s after the gesture, and it did so before this existed. One
	// run showed 262 ms on its first gesture and that was an outlier on a cold
	// document, not a result; two repeat runs did not reproduce it.
	//
	// This is kept anyway, and the reason is not the tiles. `_moveEnd`'s
	// trailing `_move` genuinely could not run -- `_moveInProgress` is cleared
	// on the statement below the call -- so the comment there described
	// behaviour that did not exist, and the next person to rely on moveend to
	// settle anything would have inherited that. The cost is one update per
	// GESTURE, which is what the raw `_move()` did before the throttle went
	// in; the per-FRAME cost the throttle removed stays removed.
	_scheduleMoveSettle: function () {
		if (this._moveSettleTimer)
			clearTimeout(this._moveSettleTimer);
		this._moveSettleTimer = setTimeout(window.L.bind(function () {
			this._moveSettleTimer = null;
			RenderManager.update();
			RenderManager.resetPreFetching(true);
		}, this), this.options.updateInterval);
	},

	_cancelMoveSettle: function () {
		if (this._moveSettleTimer) {
			clearTimeout(this._moveSettleTimer);
			this._moveSettleTimer = null;
		}
	},

	_requestNewTiles: function () {
		this.handleInvalidateTilesMsg('invalidatetiles: EMPTY');
		RenderManager.update();
	},

	_sendClientZoom: function (forceUpdate) {
		if (!this._map._docLoaded)
			return;

		var newClientZoom = 'tilepixelwidth=' + RenderManager.tileSize + ' ' +
		    'tilepixelheight=' + RenderManager.tileSize + ' ' +
		    'tiletwipwidth=' + app.tile.size.x + ' ' +
		    'tiletwipheight=' + app.tile.size.y;

		// Calc phone chrome only: withhold the zoom pair so our zoom never
		// reaches the saved document.
		//
		// zoompercent becomes ScViewData::oExportZoom in core
		// (ChildSession.cpp setViewOption "zoom" -> init.cxx setExportZoom),
		// and the Excel exporter writes it straight into the file:
		// xeview.cxx `moExportZoom ? *moExportZoom : mnNormalZoom` -> the
		// sheet's zoomScale/zoomScaleNormal. Upstream does that on purpose,
		// because on desktop the zoom IS the user's intent and is worth
		// persisting. On the phone chrome it is OURS -- a legibility constant
		// picked for a 390px screen -- so persisting it would silently rewrite
		// a workbook a customer had stored at, say, zoomScale="75".
		//
		// THIS WITHHOLD IS NECESSARY BUT NOT SUFFICIENT ON ITS OWN, and the
		// other half of the fix is in the engine. Unsetting oExportZoom only
		// takes the first branch of that ternary; the `: mnNormalZoom`
		// fallback is derived from OUR zoom by a second, ungated route:
		//
		//   tiletwipwidth (sent UNCONDITIONALLY, four lines above this gate)
		//     -> ScModelObj::setClientZoom derives newZoomX from it
		//     -> SetZoom(bAll=true) sets every tab's fZoomY = 1.2
		//     -> WriteExtOptions sets mnNormalZoom = fZoomY*100 = 120
		//     -> xeview.cxx:387 falls back to it -> zoomScale="120"
		//
		// Index 11 was chosen partly because its reported percentage equals
		// its real scale, so the two branches of that ternary carried the SAME
		// number and withholding alone bought nothing.
		//
		// That second route is now CLOSED in the engine, and .ods's third one
		// with it. tiletwipwidth cannot be withheld -- the tile grid is the
		// rendering zoom -- so the fix is at the serialisation sites instead,
		// copying OverrideWithKitFreeze: ScViewData::SetZoom snapshots the
		// DOCUMENT's zoom before a COKit client's first zoom overwrites
		// fZoomY, and all three writers (WriteExtOptions for .xlsx, both
		// WriteUserDataSequence for .ods) export
		// ScViewData::GetKitExportZoomPercent instead of the live value. See
		// engine/sc/source/ui/view/viewdata.cxx GetKitExportZoomPercent.
		//
		// Keep the withhold anyway: it removes one route, it costs nothing,
		// and it is what keeps the Calc phone chrome from depending on a
		// vendored core patch surviving the next upstream rebase.
		//
		// Both halves are pinned by scripts/display-state-export-guard.mjs --
		// W1 fails if this gate is removed, widened or steps off the zoom
		// pair, and E1 fails if any of the three engine call sites or the
		// snapshot goes away. Wet-tested end to end by
		// a host end-to-end test,
		// which stores zoomScale=75, drives the phone at live zoom 120, saves,
		// and asserts the stored pair came back 75.
		//
		// ChildSession requires all 7 tokens before it calls setViewOption at
		// all, so the shorter form is an already-supported shape and needs no
		// wsd or core change. dpiscale rides the same gate but is a no-op in
		// the engine (only "zoom" is handled), so dropping it costs nothing.
		// Desktop, tablet and the other doctypes are untouched.
		var withholdExportZoom = this.isCalc() &&
			window.mode.isSmallScreenDevice() &&
			document.documentElement.classList.contains('vulcan-mobile-chrome');

		if (!withholdExportZoom)
			newClientZoom += ' dpiscale=' + app.dpiScale + ' ' +
			    'zoompercent=' + this._map.getZoomPercent();

		if (this._clientZoom !== newClientZoom || forceUpdate || this.isImpress()) {
			// the zoom level has changed
			app.socket.sendMessage('clientzoom ' + newClientZoom);

			if (!this._map._fatal && app.idleHandler._active && app.socket.connected())
				this._clientZoom = newClientZoom;
		}
	},

	_twipsRectangleToPixelBounds: function (strRectangle) {
		// TODO use this more
		// strRectangle = x, y, width, height
		var strTwips = strRectangle.match(/\d+/g);
		if (!strTwips) {
			return null;
		}
		var topLeftTwips = new cool.Point(parseInt(strTwips[0]), parseInt(strTwips[1]));
		var offset = new cool.Point(parseInt(strTwips[2]), parseInt(strTwips[3]));
		var bottomRightTwips = topLeftTwips.add(offset);
		return new cool.Bounds(
			this._twipsToPixels(topLeftTwips),
			this._twipsToPixels(bottomRightTwips));
	},

	_twipsRectanglesToPixelBounds: function (strRectangles) {
		// used when we have more rectangles
		strRectangles = strRectangles.split(';');
		var boundsList = [];
		for (var i = 0; i < strRectangles.length; i++) {
			var bounds = this._twipsRectangleToPixelBounds(strRectangles[i]);
			if (bounds) {
				boundsList.push(bounds);
			}
		}
		return boundsList;
	},

	getMaxDocSize: function () {
		return undefined;
	},

	getSnapDocPosX: function (docPosPixX) {
		return docPosPixX;
	},

	getSnapDocPosY: function (docPosPixY) {
		return docPosPixY;
	},

	getSplitPanesContext: function () {
		return undefined;
	},

	_createNewMouseEvent: function (type, inputEvent) {
		var event = inputEvent;
		if (inputEvent.type == 'touchstart' || inputEvent.type == 'touchmove') {
			event = inputEvent.touches[0];
		}
		else if (inputEvent.type == 'touchend') {
			event = inputEvent.changedTouches[0];
		}
		var newEvent = document.createEvent('MouseEvents');
		newEvent.initMouseEvent(
			type, true, true, window, 1,
			event.screenX, event.screenY,
			event.clientX, event.clientY,
			false, false, false, false, 0, null
		);
		return newEvent;
	},

	_getToolbarCommandsValues: function() {
		for (var i = 0; i < this._map.unoToolbarCommands.length; i++) {
			var command = this._map.unoToolbarCommands[i];
			app.socket.sendMessage('commandvalues command=' + command);
		}
	},

	_parseCellRange: function(cellRange) {
		var strTwips = cellRange.match(/\d+/g);
		var startCellAddress = [parseInt(strTwips[0]), parseInt(strTwips[1])];
		var endCellAddress = [parseInt(strTwips[2]), parseInt(strTwips[3])];
		return new cool.Bounds(startCellAddress, endCellAddress);
	},

	_cellRangeToTwipRect: function(cellRange) {
		var startCell = cellRange.getTopLeft();
		var startCellRectPixel = this.sheetGeometry.getCellRect(startCell.x, startCell.y);
		var topLeftTwips = this._corePixelsToTwips(startCellRectPixel.min);
		var endCell = cellRange.getBottomRight();
		var endCellRectPixel = this.sheetGeometry.getCellRect(endCell.x, endCell.y);
		var bottomRightTwips = this._corePixelsToTwips(endCellRectPixel.max);
		return new cool.Bounds(topLeftTwips, bottomRightTwips);
	},

	_onMessage: function (textMsg, img) {
		this._saveMessageForReplay(textMsg);
		// 'tile:' is the most common message type; keep this the first.
		if (textMsg.startsWith('tile:') || textMsg.startsWith('delta:')) {
			RenderManager.onTileMsg(textMsg, img);
		}
		else if (textMsg.startsWith('commandvalues:')) {
			this._onCommandValuesMsg(textMsg);
		}
		else if (textMsg.startsWith('cursorvisible:')) {
			this._onCursorVisibleMsg(textMsg);
		}
		else if (textMsg.startsWith('downloadas:')) {
			this._onDownloadAsMsg(textMsg);
		}
		else if (textMsg.startsWith('exportfile:')) {
			this._onExportFileMsg(textMsg);
		}
		else if (textMsg.startsWith('error:')) {
			this._onErrorMsg(textMsg);
		}
		else if (textMsg.startsWith('getchildid:')) {
			this._onGetChildIdMsg(textMsg);
		}
		else if (textMsg.startsWith('shapeselectioncontent:')) {
			GraphicSelection.onShapeSelectionContent(textMsg);
		}
		else if (textMsg.startsWith('graphicselection:')) {
			this._map.fire('resettopbottompagespacing');
			GraphicSelection.onMessage(textMsg);
			if (app.definitions && app.definitions.vulcanCalcCursorEcho && !textMsg.match('EMPTY'))
				app.definitions.vulcanCalcCursorEcho.onGraphicSelection();
		}
		else if (textMsg.startsWith('graphicinnertextarea:')) {
			return; // Not used.
		}
		else if (textMsg.startsWith('shapedragpreview:')) {
			GraphicSelection.onShapeDragPreview(textMsg);
		}
		else if (textMsg.startsWith('cellcursor:')) {
			this._onCellCursorMsg(textMsg);
		}
		else if (textMsg.startsWith('celladdress:')) {
			this._onCellAddressMsg(textMsg);
		}
		else if (textMsg.startsWith('cellformula:')) {
			this._onCellFormulaMsg(textMsg);
		}
		else if (textMsg.startsWith('referencemarks:')) {
			this._onReferencesMsg(textMsg);
		}
		else if (textMsg.startsWith('referenceclear:')) {
			this._clearReferences();
			// The one message that means "there are no references any more".
			// _clearReferences itself is NOT the site: _updateReferenceMarks
			// calls it on every sheet switch before re-adding the marks for
			// the new part, and dropping the colours there would blank the
			// formula text on a state that still has references.
			if (window.VulcanFormulaRefColors)
				window.VulcanFormulaRefColors.clear();
		}
		else if (textMsg.startsWith('invalidatecursor:')) {
			this._onInvalidateCursorMsg(textMsg);
		}
		else if (textMsg.startsWith('invalidatetiles:')) {
			console.error("Message should be filterd during slurp");
		}
		else if (textMsg.startsWith('mousepointer:')) {
			this._onMousePointerMsg(textMsg);
		}
		else if (textMsg.startsWith('searchnotfound:')) {
			this._onSearchNotFoundMsg(textMsg);
		}
		else if (textMsg.startsWith('searchresultselection:')) {
			this._onSearchResultSelection(textMsg);
		}
		else if (textMsg.startsWith('setpart:')) {
			this._onSetPartMsg(textMsg);
		}
		else if (textMsg.startsWith('statechanged:')) {
			this._onStateChangedMsg(textMsg);
		}
		else if (textMsg.startsWith('status:') || textMsg.startsWith('statusupdate:')) {
			this._onStatusMsg(textMsg);

			// update tiles and selection because mode could be changed
			RenderManager.update();
			OtherViewGraphicSelectionSection.updateVisibilities();
			TextCursorSection.updateVisibilities();
		}
		else if (textMsg.startsWith('partstatus:')) {
			this._onStatusMsg(textMsg);
		}
		else if (textMsg.startsWith('textselection:')) {
			this._onTextSelectionMsg(textMsg);
		}
		else if (textMsg.startsWith('textselectioncontent:')) {
			let textMsgContent = textMsg.substr(22);

			if (this._map._clip && this._map._clip.isActionCopy()) {
				// This is the Action_Copy PostMessage API, create the response and
				// don't touch the clipboard.
				this._map._clip.setActionCopy(false);
				const message = {
					msgId: 'Action_Copy_Resp',
					args: {
						content: textMsgContent
					}
				};
				this._map.fire('postMessage', message);
				return;
			}

			let textMsgHtml = '';
			let textMsgPlainText = '';
			if (textMsgContent.startsWith('{')) {
				// Multiple formats: JSON.
				let textMsgJson = JSON.parse(textMsgContent);
				textMsgHtml = textMsgJson['text/html'];
				textMsgPlainText = textMsgJson['text/plain;charset=utf-8'];
			} else {
				// Single format: as-is.
				textMsgHtml = textMsgContent;
			}

			if (this._map._clip) {
				this._map._clip.setTextSelectionHTML(textMsgHtml, textMsgPlainText);
			} else
				// hack for ios and android to get selected text into hyperlink insertion dialog
				this._selectedTextContent = textMsgHtml;

			// Fire map event for external listeners
			if (this._map) {
				this._map.fire('textselectioncontent', {
					msg: textMsg,
					html: textMsgHtml,
					plainText: textMsgPlainText
				});
			}
	}
		else if (textMsg.startsWith('clipboardchanged')) {
			var jMessage = JSON.parse(textMsg.substr(17));

			if (jMessage.mimeType === 'text/plain') {
				this._map._clip.setTextSelectionHTML(jMessage.content);

				// If _navigatorClipboardWrite is available, use it.
				if (window.L.Browser.clipboardApiAvailable || window.ThisIsTheiOSApp)
					this._map.fire('clipboardchanged', { commandName: '.uno:CopyHyperlinkLocation' });
				else // Or use previous method.
					this._map._clip._execCopyCutPaste('copy');
			}
		}
		else if (textMsg.startsWith('clipboardmimetypes:')) {
			if (window.ThisIsTheQtApp)
				window.postMobileMessage('CLIPBOARDMIMETYPES' + textMsg.substr(19));
		}
		else if (textMsg.startsWith('textselectionend:')) {
			this._onTextSelectionEndMsg(textMsg);
		}
		else if (textMsg.startsWith('textselectionstart:')) {
			this._onTextSelectionStartMsg(textMsg);
		}
		else if (textMsg.startsWith('cellselectionarea:')) {
			this._onCellSelectionAreaMsg(textMsg);
		}
		else if (textMsg.startsWith('cellautofillarea:')) {
			this._onCellAutoFillAreaMsg(textMsg);
		}
		else if (textMsg.startsWith('complexselection:')) {
			if (this._map._clip)
				this._map._clip.onComplexSelection(textMsg.substr('complexselection:'.length));
			if (this._map)
				this._map.fire('complexselection', { msg: textMsg });
		}
		else if (textMsg.startsWith('windowpaint:')) {
			this._onDialogPaintMsg(textMsg, img);
		}
		else if (textMsg.startsWith('window:')) {
			this._onDialogMsg(textMsg);
		}
		else if (textMsg.startsWith('unocommandresult:')) {
			this._onUnoCommandResultMsg(textMsg);
		}
		else if (textMsg.startsWith('transformeddocumentstructure:')) {
			// Ack for an interactive transformdocumentstructure (the Impress
			// agent bridge's SlideCommand batches). The kit answers on this
			// broker-shaped frame, not unocommandresult; surface it as the
			// 'commandresult' event the bridge awaits.
			try {
				var transformResult = JSON.parse(
					textMsg.substring('transformeddocumentstructure:'.length));
				this._map.fire('commandresult', {
					commandName: '.uno:TransformDocumentStructure',
					success: !transformResult || transformResult.success !== false,
					result: transformResult,
				});
			} catch (e) {
				window.app.console.error('Failed to parse transformeddocumentstructure: ' + e);
			}
		}
		else if (textMsg.startsWith('aichatresult:')) {
			try {
				var json = JSON.parse(textMsg.substring('aichatresult:'.length));
				this._map.fire('aichatresult', json);
			} catch (e) {
				window.app.console.error('Failed to parse aichatresult: ' + e);
			}
		}
		else if (textMsg.startsWith('aichatprogress:')) {
			try {
				var json = JSON.parse(textMsg.substring('aichatprogress:'.length));
				this._map.fire('aichatprogress', json);
			} catch (e) {
				window.app.console.error('Failed to parse aichatprogress: ' + e);
			}
		}
		else if (textMsg.startsWith('aichatapproval:')) {
			try {
				var json = JSON.parse(textMsg.substring('aichatapproval:'.length));
				this._map.fire('aichatapproval', json);
			} catch (e) {
				window.app.console.error('Failed to parse aichatapproval: ' + e);
			}
		}
		else if (textMsg.startsWith('aichatchoices:')) {
			try {
				var json = JSON.parse(textMsg.substring('aichatchoices:'.length));
				this._map.fire('aichatchoices', json);
			} catch (e) {
				window.app.console.error('Failed to parse aichatchoices: ' + e);
			}
		}
		else if (textMsg.startsWith('hrulerupdate:')) {
			this._onRulerUpdate(textMsg);
		}
		else if (textMsg.startsWith('vrulerupdate:')) {
			this._onRulerUpdate(textMsg);
		}
		else if (textMsg.startsWith('contextmenu:')) {
			this._onContextMenuMsg(textMsg);
		}
		else if (textMsg.startsWith('invalidateviewcursor:')) {
			this._onInvalidateViewCursorMsg(textMsg);
		}
		else if (textMsg.startsWith('viewcursorvisible:')) {
			this._onViewCursorVisibleMsg(textMsg);
		}
		else if (textMsg.startsWith('cellviewcursor:')) {
			this._onCellViewCursorMsg(textMsg);
		}
		else if (textMsg.startsWith('viewlock')) {
			this._onViewLockInfoMsg(textMsg);
		}
		else if (textMsg.startsWith('viewinfo:')) {
			this._onViewInfoMsg(textMsg);
		}
		else if (textMsg.startsWith('textviewselection:')) {
			this._onTextViewSelectionMsg(textMsg);
		}
		else if (textMsg.startsWith('graphicviewselection:')) {
			this._onGraphicViewSelectionMsg(textMsg);
		}
		else if (textMsg.startsWith('tableselected:')) {
			app.activeDocument.tableMiddleware.onTableSelectedMsg(textMsg);
		}
		else if (textMsg.startsWith('editor:')) {
			this._updateEditor(textMsg);
		}
		else if (textMsg.startsWith('validitylistbutton:')) {
			this._onValidityListButtonMsg(textMsg);
		}
		else if (textMsg.startsWith('validityinputhelp:')) {
			this._onValidityInputHelpMsg(textMsg);
		}
		else if (textMsg.startsWith('signaturestatus:')) {
			var signstatus = textMsg.substring('signaturestatus:'.length + 1);
			this._map.onChangeSignStatus(signstatus);
		}
		else if (textMsg.startsWith('removesession')) {
			var viewId = parseInt(textMsg.substring('removesession'.length + 1));
			if (this._map._docLayer._viewId === viewId)
				app.dispatcher.dispatch('closeapp');
		}
		else if (textMsg.startsWith('calcfunctionlist:')) {
			this._onCalcFunctionListMsg(textMsg.substring('calcfunctionlist:'.length + 1));
		}
		else if (textMsg.startsWith('tooltip:')) {
			var tooltipInfo = JSON.parse(textMsg.substring('tooltip:'.length + 1));
			if (tooltipInfo.type === 'formulausage') {
				this._onCalcFunctionUsageMsg(tooltipInfo.text);
			}
			else if (tooltipInfo.type === 'generaltooltip') {
				var tooltipInfo = JSON.parse(textMsg.substring(textMsg.indexOf('{')));
				this._map.uiManager.showDocumentTooltip(tooltipInfo);
			}
			else if (tooltipInfo.type === 'autofillpreviewtooltip') {

				var strTwips = textMsg.match(/\d+/g);
				if (strTwips != null && this._map.isEditMode())
					this._map.fire('openautofillpreviewpopup', { data: tooltipInfo });
			}
			else {
				console.error('unknown tooltip type');
			}
		}
		else if (textMsg.startsWith('tabstoplistupdate:')) {
			this._onTabStopListUpdate(textMsg);
		}
		else if (textMsg.startsWith('context:')) {
			var message = textMsg.substring('context:'.length + 1);
			message = message.split(' ');
			if (message.length > 1) {
				var old = this._map.context || {};
				// The context of the selection itself comes first, followed by
				// the contexts of the structures that enclose the selection.
				var newContext = {appId: message[0], context: message[1], contexts: message.slice(1)};
				var oldContexts = old.contexts || (old.context ? [old.context] : []);
				if (old.appId !== newContext.appId || oldContexts.join(' ') !== newContext.contexts.join(' ')) {
					this._map.context = newContext;
					app.events.fire('contextchange', {
						appId: newContext.appId, context: newContext.context, contexts: newContext.contexts,
						oldAppId: old.appId, oldContext: old.context, oldContexts: oldContexts
					});
				}
			}
		}
		else if (textMsg.startsWith('formfieldbutton:')) {
			this._onFormFieldButtonMsg(textMsg);
		}
		else if (textMsg.startsWith('canonicalidchange:')) {
			var payload = textMsg.substring('canonicalidchange:'.length + 1);
			var viewRenderedState = payload.split('=')[3].split(' ')[0];
			if (this._debug.overlayOn) {
				var viewId = payload.split('=')[1].split(' ')[0];
				var canonicalId = payload.split('=')[2].split(' ')[0];
				this._debug.setOverlayMessage('canonicalViewId',
					'Canonical id changed to: ' + canonicalId + ' for view id: ' + viewId + ' with view renderend state: ' + viewRenderedState
				);
			}
			if (!this._canonicalIdInitialized) {
				this._canonicalIdInitialized = true;
				RenderManager.update();
			} else {
				this._requestNewTiles();
				this._invalidateAllPreviews();
				RenderManager.redraw();
			}
		}
		else if (textMsg.startsWith('comment:')) {
			var obj = JSON.parse(textMsg.substring('comment:'.length + 1));
			app.sectionContainer.getSectionWithName(app.CSections.CommentList.name).onACKComment(obj);
			this._map.fire('comment', obj);
		}
		else if (textMsg.startsWith('redlinetablemodified:')) {
			obj = JSON.parse(textMsg.substring('redlinetablemodified:'.length + 1));
			app.sectionContainer.getSectionWithName(app.CSections.CommentList.name).onACKComment(obj);
			// Surface the engine's push as a map event (same pattern as
			// 'comment:' above) so listeners — the Writer agent bridge's
			// event-driven redline ack — see it without polling.
			this._map.fire('redlinetablemodified', obj);
		}
		else if (textMsg.startsWith('redlinetablechanged:')) {
			obj = JSON.parse(textMsg.substring('redlinetablechanged:'.length + 1));
			app.sectionContainer.getSectionWithName(app.CSections.CommentList.name).onACKComment(obj);
			this._map.fire('redlinetablechanged', obj);
		}
		else if (textMsg.startsWith('applicationbackgroundcolor:')) {
			app.sectionContainer.setClearColor('#' + textMsg.substring('applicationbackgroundcolor:'.length + 1).trim());
			app.sectionContainer.requestReDraw();
		}
		else if (textMsg.startsWith('documentbackgroundcolor:')) {
			app.sectionContainer.setDocumentBackgroundColor('#' + textMsg.substring('documentbackgroundcolor:'.length + 1).trim());
		}
		else if (textMsg.startsWith('contentcontrol:')) {
			textMsg = textMsg.substring('contentcontrol:'.length + 1);
			if (!app.sectionContainer.doesSectionExist(app.CSections.ContentControl.name)) {
				app.sectionContainer.addSection(new cool.ContentControlSection());
			}
			var section = app.sectionContainer.getSectionWithName(app.CSections.ContentControl.name);
			section.drawContentControl(JSON.parse(textMsg));
		}
		else if (textMsg.startsWith('versionbar:')) {
			obj = JSON.parse(textMsg.substring('versionbar:'.length + 1));
			this._map.fire('versionbar', obj);
		}
		else if (textMsg.startsWith('lockaccessibilityon')) {
			// a11y forced on by DocumentBroker, from interface settings overrides.
			this._map.lockAccessibilityOn();
		}
		else if (textMsg.startsWith('a11y')) {
			if (!window.isAccessibilityStateEffective()) {
				window.app.console.warn(
					'dropping a11y event received with accessibility disabled: ' + textMsg);
				return;
			}

			if (textMsg.startsWith('a11yfocuschanged:')) {
				obj = JSON.parse(textMsg.substring('a11yfocuschanged:'.length + 1));
				var listPrefixLength = obj.listPrefixLength !== undefined ? parseInt(obj.listPrefixLength) : 0;
				if (typeof this._map._textInput.onAccessibilityFocusChanged === 'function') {
					this._map._textInput.onAccessibilityFocusChanged(
						obj.content,
						parseInt(obj.position),
						parseInt(obj.start),
						parseInt(obj.end),
						listPrefixLength,
						parseInt(obj.force) > 0);
				}
			}
			else if (textMsg.startsWith('a11ycaretchanged:')) {
				obj = JSON.parse(textMsg.substring('a11yfocuschanged:'.length + 1));
				if (typeof this._map._textInput.onAccessibilityCaretChanged === 'function')
					this._map._textInput.onAccessibilityCaretChanged(parseInt(obj.position));
			}
			else if (textMsg.startsWith('a11ytextselectionchanged:')) {
				obj = JSON.parse(textMsg.substring('a11ytextselectionchanged:'.length + 1));
				this._map._textInput.onAccessibilityTextSelectionChanged(parseInt(obj.start), parseInt(obj.end));
			}
			else if (textMsg.startsWith('a11yfocusedcellchanged:')) {
				obj = JSON.parse(textMsg.substring('a11yfocusedcellchanged:'.length + 1));
				var outCount = obj.outCount !== undefined ? parseInt(obj.outCount) : 0;
				var inList = obj.inList !== undefined ? obj.inList : [];
				var row = parseInt(obj.row);
				var col = parseInt(obj.col);
				var rowSpan = obj.rowSpan !== undefined ? parseInt(obj.rowSpan) : 1;
				var colSpan = obj.colSpan !== undefined ? parseInt(obj.colSpan) : 1;
				this._map._textInput.onAccessibilityFocusedCellChanged(
						outCount, inList, row, col, rowSpan, colSpan, obj.paragraph);
			}
			else if (textMsg.startsWith('a11yeditinginselectionstate:')) {
				obj = JSON.parse(textMsg.substring('a11yeditinginselectionstate:'.length + 1));
				this._map._textInput.onAccessibilityEditingInSelectionState(
					parseInt(obj.cell) > 0, parseInt(obj.enabled) > 0, obj.selection, obj.paragraph);
			}
			else if (textMsg.startsWith('a11yselectionchanged:')) {
				obj = JSON.parse(textMsg.substring('a11yselectionchanged:'.length + 1));
				this._map._textInput.onAccessibilitySelectionChanged(
					parseInt(obj.cell) > 0, obj.action, obj.name, obj.text);
			}
			else if (textMsg.startsWith('a11yfocusedparagraph:')) {
				obj = JSON.parse(textMsg.substring('a11yfocusedparagraph:'.length + 1));
				this._map._textInput.setA11yFocusedParagraph(
					obj.content, parseInt(obj.position), parseInt(obj.start), parseInt(obj.end));
			}
			else if (textMsg.startsWith('a11ycaretposition:')) {
				var pos = textMsg.substring('a11ycaretposition:'.length + 1);
				this._map._textInput.setA11yCaretPosition(parseInt(pos));
			}
		}
		else if (textMsg.startsWith('colorpalettes:')) {
			var json = JSON.parse(textMsg.substring('colorpalettes:'.length + 1));

			for (var key in json) {
				if(key === 'ColorNames') {
					window.app.colorNames = json[key];
					continue;
				}
				if (app.colorPalettes[key]) {
					app.colorPalettes[key].colors = json[key];
				} else {
					window.app.console.warn('Unknown palette: "' + key + '"');
				}
			}

			// Remove empty palettes, eg. Document colors in Impress are empty
			for (var key in app.colorPalettes) {
				if (!app.colorPalettes[key].colors || !app.colorPalettes[key].colors.length) {
					delete app.colorPalettes[key];
				}
			}
		} else if (textMsg.startsWith('serveraudit:')) {
			var serverAudit = textMsg.substr(12).trim();
			if (serverAudit !== 'disabled') {
				// if isAdminUser property is not set by integration - enable audit dialog for all users
				if (app.isAdminUser !== false) {
					this._map.serverAuditDialog = JSDialog.serverAuditDialog(this._map);

					if (this._map.uiManager.notebookbar) {
						this._map.uiManager.notebookbar.showItem('server-audit');
						this._map.uiManager.notebookbar.showItem('help-serveraudit-break');
					}
				}

				var json = JSON.parse(serverAudit);
				app.setServerAuditFromCore(json.serverAudit);
			}
		} else if (textMsg.startsWith('adminuser:')) {
			var value = textMsg.substr(10).trim();
			if (value === 'true')
				app.isAdminUser = true;
			else if (value === 'false')
				app.isAdminUser = false;
			else
				app.isAdminUser = null;

			this._map.fire('adminuser');
		} else if (textMsg.startsWith('presentationinfo:')) {
			var content = JSON.parse(textMsg.substring('presentationinfo:'.length + 1));
			this._map.fire('presentationinfo', content);
		} else if (textMsg.startsWith('slidesections:')) {
			var sections = JSON.parse(textMsg.substring('slidesections:'.length + 1));
			app.impress.sections = sections;
			this._map.fire('updatesections', {sections: sections});
		} else if (textMsg.startsWith('slideshowfollow')) {
			const eventInfo = textMsg.substr('slideshowfollow '.length);
			const parameterStartIndex = eventInfo.indexOf('{');
			if (parameterStartIndex === -1) {
				this._map.fire(eventInfo);
			} else {
				const event = eventInfo.substring(0, parameterStartIndex).trim();
				const parameter = JSON.parse(eventInfo.substring(parameterStartIndex));
				this._map.fire(event, parameter);
			}
		} else if (textMsg.startsWith('changepagezoom:')) {
			const payload = textMsg.substring('changepagezoom:'.length).trim();
			const strZoomPercent = payload.match(/\d+/);
			const zoomPercent = strZoomPercent ? parseInt(strZoomPercent[0], 10) : NaN;
			if (zoomPercent) {
				const zoomIndex = this._map.getZoomIndex(zoomPercent);
				this._map.setZoom(zoomIndex, null, false);
			}
		}
	},

	_onInvalidateTilesMsg: function (textMsg) {
		const command = app.socket.parseServerCmd(textMsg);
		if (command.x === undefined || command.y === undefined || command.part === undefined) {
			var strTwips = textMsg.match(/\d+/g);
			command.x = parseInt(strTwips[0]);
			command.y = parseInt(strTwips[1]);
			command.width = parseInt(strTwips[2]);
			command.height = parseInt(strTwips[3]);
			command.part = this._selectedPart;
		}

		if (isNaN(command.mode))
			command.mode = app.activeDocument.activeModes[0];

		const invalidArea = new cool.SimpleRectangle(command.x, command.y, command.width, command.height);
		RenderManager.overlapInvalidatedRectangleWithView(command.part, command.mode, command.wireId, invalidArea, textMsg);

		if (this.isImpress() || this.isDraw()) {
			if (command.part === this._selectedPart &&
				app.activeDocument.isModeActive(command.mode) &&
				command.part !== this._lastValidPart) {
				this._map.fire('updatepart', {part: this._lastValidPart, docType: this._docType});
				this._lastValidPart = command.part;
				this._map.fire('updatepart', {part: command.part, docType: this._docType});
			}

			const preview = this._map._docPreviews ? this._map._docPreviews[command.part] : null;
			if (preview) { preview.invalid = true; }

			// A vector-rendered view has no tiles. A whole-document EMPTY
			// invalidation carries no part, so refresh every part;
			// otherwise drop just the one that changed.
			if (isNaN(command.part))
				RenderManager.clearAllParts();
			else
				RenderManager.clearCachedPart(command.part);

			const topLeftTwips = new cool.Point(command.x, command.y);
			const offset = new cool.Point(command.width, command.height);
			const bottomRightTwips = topLeftTwips.add(offset);
			this._previewInvalidations.push(new cool.Bounds(topLeftTwips, bottomRightTwips));
			// 1s after the last invalidation, update the preview
			clearTimeout(this._previewInvalidator);
			this._previewInvalidator = setTimeout(window.L.bind(this._invalidatePreviews, this), this.options.previewInvalidationTimeout);
		}

		return command;
	},


	handleInvalidateTilesMsg: function(textMsg) {
		var payload = textMsg.substring('invalidatetiles:'.length + 1);
		if (!payload.startsWith('EMPTY')) {
			this._onInvalidateTilesMsg(textMsg);
		}
		else {
			var msg = 'invalidatetiles: ';

			// see invalidatetiles: in wsd/protocol.txt for structure
			var tmp = payload.substring('EMPTY'.length).replaceAll(',', ' , ');
			var tokens = tmp.split(/[ \n]+/);

			var wireIdToken = undefined;
			var commaargs = [];

			var commaarg = false;
			for (var i = 0; i < tokens.length; i++) {
				if (tokens[i] === ',') {
					commaarg = true;
					continue;
				}
				if (commaarg) {
					commaargs.push(tokens[i]);
					commaarg = false;
				}
				else if (tokens[i].startsWith('wid=')) {
					wireIdToken = tokens[i];
				}
				else if (tokens[i])
					console.error('unsupported invalidatetile token: ' + tokens[i]);
			}

			if (this.isWriter()) {
				msg += 'part=0 ';
			} else {

				var part = parseInt(commaargs.length > 0 ? commaargs[0] : '');
				var mode = parseInt(commaargs.length > 1 ? commaargs[1] : '');

				mode = (isNaN(mode) ? app.activeDocument.activeModes[0] : mode);
				msg += 'part=' + (isNaN(part) ? this._selectedPart : part)
					+ ((mode && mode !== 0) ? (' mode=' + mode) : '')
					+ ' ';
			}
			msg += 'x=0 y=0 ';
			msg += 'width=' + Number.MAX_SAFE_INTEGER + ' ';
			msg += 'height=' + Number.MAX_SAFE_INTEGER;
			if (wireIdToken !== undefined)
				msg += ' ' + wireIdToken;
			this._onInvalidateTilesMsg(msg);
		}
	},

	// Process messages early that won't mess with the DOM
	filterSlurpedMessage: function(evt) {
		var textMsg = evt.textMsg;

		if (textMsg.startsWith('invalidatetiles:')) {
			app.socket._logSocket('INCOMING', textMsg);
			this.handleInvalidateTilesMsg(textMsg);
			return true; // filter
		}

		return false; // continue processing
	},

	_onTabStopListUpdate: function (textMsg) {
		textMsg = textMsg.substring('tabstoplistupdate:'.length + 1);
		var json = JSON.parse(textMsg);
		this._map.fire('tabstoplistupdate', json);
	},

	_onCommandValuesMsg: function (textMsg) {
		var jsonIdx = textMsg.indexOf('{');
		if (jsonIdx === -1) {
			return;
		}
		var obj = JSON.parse(textMsg.substring(jsonIdx));
		if (obj.commandName === '.uno:DocumentRepair') {
			this._onDocumentRepair(obj);
		}
		else if (obj.commandName === '.uno:CellCursor') {
			this._onCellCursorMsg(obj.commandValues);
		}
		else if (this._map.unoToolbarCommands.indexOf(obj.commandName) !== -1) {
			this._toolbarCommandValues[obj.commandName] = obj.commandValues;
			this._map.fire('updatetoolbarcommandvalues', {
				commandName: obj.commandName,
				commandValues: obj.commandValues
			});
		}
		else {
			this._map.fire('commandvalues', {
				commandName: obj.commandName,
				commandValues: obj.commandValues,
				// Fork: Writer/Impress engine responses carry no commandName
				// wrapper ({redlines}/{Targets}/{DocStructure}); the Vulcan
				// bridges match on the raw payload's key instead.
				rawValues: obj
			});
		}
	},

	_onCellAddressMsg: function (textMsg) {
		// When the user moves the focus to a different cell, a 'cellformula'
		// message is received from coolwsd, *then* a 'celladdress' message.
		var address = textMsg.substring(13);
		if (this._map._clip && !this._map['wopi'].DisableCopy) {
			this._map._clip.setTextSelectionText(this._lastFormula);
		}
		this._map.fire('celladdress', {address: address});
	},

	_onCellFormulaMsg: function (textMsg) {
		// When a 'cellformula' message from coolwsd is received,
		// store the text contents of the cell, but don't push
		// them to the clipboard container (yet).
		// This is done because coolwsd will send several 'cellformula'
		// messages during text composition, and resetting the contents
		// of the clipboard container mid-composition will easily break it.

		let newFormula = textMsg.substring(13);
		if (this._lastFormula) {
			let minLength = Math.min(newFormula.length, this._lastFormula.length);
			let index = -1;
			for (let i = 0; i < minLength; i++) {
				if (newFormula.charAt(i) !== this._lastFormula.charAt(i)) {
					index = i;
					break;
				}
			}

			if (index === -1)
				index = newFormula.length-1;

			// newFormulaDiffIndex have index of last added character in formula
			// It is used during Formula Autocomplete to find partial remaining text
			this._newFormulaDiffIndex = index;
		}
		this._lastFormula = newFormula;
		this._map.fire('cellformula', {formula: newFormula});
		// Vulcan: the cell text confirms (or contradicts) the Calc echo.
		if (app.definitions && app.definitions.vulcanCalcTextEcho)
			app.definitions.vulcanCalcTextEcho.onCellFormula(newFormula);

		// Clear pending error; statechanged CellFormulaError will set it
		// if the new cell has one.
		this._pendingCellError = null;
	},

	_onCellFormulaError: function (state) {
		if (state && typeof state === 'object' && state.error) {
			this._pendingCellError = state;
		} else {
			this._pendingCellError = null;
			app.definitions.formulaErrorHelpSection.hide();
		}
		this._showPendingCellError();
	},

	_showPendingCellError: function () {
		if (!this._pendingCellError || !app.calc.cellCursorVisible)
			return;
		var rect = app.calc.cellCursorRectangle;
		var pos = new cool.SimplePoint(rect.x1, rect.y2);
		app.definitions.formulaErrorHelpSection.show(pos, this._pendingCellError);
	},

	_onCalcFunctionUsageMsg: function (textMsg) {
		this._map.fire('closepopup');
		this._map.fire('sendformulausagetext', {data: textMsg});
	},

	_onCalcFunctionListMsg: function (textMsg) {
		if (textMsg.startsWith('hidetip')) {
			this._map.fire('closepopup');
			// The phone owns nothing for 'closepopup' on this surface
			// (AutoCompletePopup's jsdialog id never exists there), so core's
			// last-writer-wins tip convergence — hidetip bursts per keystroke
			// and at ✓-commit — was a no-op: the suggestion surface froze at
			// its last list, survived the commit, and a tap aimed at the grid
			// sent `completefunction` into the committed cell. Honour hidetip
			// by clearing the rail's function face.
			if (window.mode.isSmallScreenDevice())
				this._vulcanScheduleSuggestionRailClear();
		} else {
			var funcData = JSON.parse(textMsg);

			if (window.mode.isSmallScreenDevice()) {
				this._vulcanCancelSuggestionRailClear();

				// G28-REVISED (c): a typed-prefix suggestion list is the
				// RAIL's face, not a wizard. The fx BROWSE list — the whole,
				// categorised catalogue — keeps the full screen, which is the
				// right shape for it, so the two are told apart before either
				// surface is built. Both discriminators are core's own and
				// neither is a marker this file stamps: `wholeList` is set for
				// the browse payload (and is what assigns _functionWizardData
				// below), `categories` only ever arrives on it.
				if (this._vulcanRouteCalcSuggestionsToRail(funcData))
					return;

				this._closeMobileWizard();

				var data = {
					id: 'funclist',
					type: '',
					text: _('Functions'),
					enabled: true,
					children: []
				};

				if (funcData.categories)
					this._onCalcFunctionListWithCategories(funcData, data);
				else
					this._onCalcFunctionList(funcData, data);

				if (funcData.wholeList)
					this._map._functionWizardData = data;

				// VO-P-0003. The categorised BROWSE catalogue is a full-screen
				// four-surface browser on phone chrome, not a wizard tree: the
				// reference renders it that way (M-0010/M-0011) and the wizard
				// is the A/+ bottom-sheet machinery, which is the wrong shape.
				//
				// This re-renders the SAME payload the wizard was already
				// given — no new data source, no second catalogue — so the
				// _functionWizardData assignment above is left intact for the
				// desktop/tablet paths that still read it.
				//
				// Falls through to the wizard whenever the browser is not
				// available, so a failure here degrades to the old surface
				// rather than to nothing.
				var vulcanBrowser = window.VulcanCalcFunctionBrowser;
				if (funcData.categories && vulcanBrowser &&
				    document.documentElement.classList.contains('vulcan-mobile-chrome')) {
					vulcanBrowser.open(funcData);
					return;
				}

				this._openMobileWizard(data);
			}
			else {
				var functionList = this._getFunctionList(textMsg);
				this._map.fire('sendformulatext', {data: functionList});
			}
		}
	},

	/*
	 * The typed-prefix arm of `calcfunctionlist:` — true when this payload was
	 * handed to the rail and the wizard must not open for it.
	 *
	 * Fails CLOSED in every direction: no live edit, a categorised or
	 * whole-list payload, or no rail built, and the caller falls through to
	 * the wizard exactly as it always did.
	 *
	 * The phone-chrome gate is the RAIL'S OWN EXISTENCE and is not re-derived
	 * here: Control.UIManager builds calcOperatorStrip nowhere but behind
	 * `isSmallScreenDevice() && vulcan-mobile-chrome` (a registered gate), so
	 * a second inline copy of that test could only ever drift from it.
	 *
	 * The live-edit marker is likewise REUSED — it is the same signal
	 * §13-CALC.5 raises the rail on, so the rail's visibility and its contents
	 * cannot drift apart about whether an edit is live, and tapping fx with no
	 * edit live keeps the browse list's full screen.
	 */
	_vulcanRouteCalcSuggestionsToRail: function (funcData) {
		if (!document.documentElement.classList.contains('vulcan-formula-editing'))
			return false;
		if (!this._map || !this._map.calcOperatorStrip)
			return false;
		if (!funcData || funcData.wholeList || funcData.categories)
			return false;
		// The typed-prefix payload is a bare ARRAY of {index, signature,
		// description} — the same shape _onCalcFunctionList walks below, which
		// is the only shape that ever reaches its flat arm. Anything else is
		// not a suggestion list and belongs to the wizard.
		if (!Array.isArray(funcData))
			return false;
		var names = [];
		for (var i = 0; i < funcData.length; ++i) {
			var signature = funcData[i] && funcData[i].signature;
			if (typeof signature === 'string' && signature !== '')
				names.push(signature.split('(')[0]);
		}
		this._map.fire('vulcancalcfunctions', { names: names });
		return true;
	},

	// One frame of settle between core's hidetip and the face clearing: core
	// interleaves list and hidetip WITHIN a keystroke (measured list@t,
	// hidetip@t+115ms), so an immediate clear would blink the rail back to
	// symbols per character typed. A fresh calcfunctionlist inside the frame
	// cancels it.
	_vulcanScheduleSuggestionRailClear: function () {
		if (this._vulcanSuggestionClearFrame !== undefined) return;
		this._vulcanSuggestionClearFrame = requestAnimationFrame(function () {
			this._vulcanSuggestionClearFrame = undefined;
			if (this._map && typeof this._map.fire === 'function')
				this._map.fire('vulcancalcfunctions', { names: [] });
		}.bind(this));
	},

	_vulcanCancelSuggestionRailClear: function () {
		if (this._vulcanSuggestionClearFrame === undefined) return;
		cancelAnimationFrame(this._vulcanSuggestionClearFrame);
		this._vulcanSuggestionClearFrame = undefined;
	},

	_getCalcFunctionListEntry: function(name, category, index, signature, description) {
		return  {
			id: '',
			type: 'calcfuncpanel',
			text: name,
			functionName: name,
			index: index,
			category: category,
			enabled: true,
			children: [
				{
					id: '',
					type: 'fixedtext',
					html: '<div class="func-info-sig">' + signature + '</div>' + '<div class="func-info-desc">' + description + '</div>',
					enabled: true,
					style: 'func-info'
				}
			]
		};
	},

	_onCalcFunctionList: function (funcList, data) {
		var entries = data.children;
		for (var idx = 0; idx < funcList.length; ++idx) {
			var func =  funcList[idx];
			var name = func.signature.split('(')[0];
			entries.push(this._getCalcFunctionListEntry(
				name, undefined, func.index, func.signature, func.description));
		}
	},

	_onCalcFunctionListWithCategories: function (funcData, data) {
		var categoryList = funcData.categories;
		var categoryEntries = data.children;
		for (var idx = 0; idx < categoryList.length; ++idx) {
			var category = categoryList[idx];
			var categoryEntry = {
				id: '',
				type: 'panel',
				text: category.name,
				index: idx,
				enabled: true,
				children: []
			};
			categoryEntries.push(categoryEntry);
		}

		var funcList = funcData.functions;
		for (idx = 0; idx < funcList.length; ++idx) {
			var func =  funcList[idx];
			var name = func.signature.split('(')[0];
			var funcEntries = categoryEntries[func.category].children;
			funcEntries.push(this._getCalcFunctionListEntry(
				name, func.category, func.index, func.signature, func.description));
		}
	},

	_onCursorVisibleMsg: function(textMsg) {
		var command = textMsg.match('cursorvisible: true');
		app.setCursorVisibility(command ? true : false);
		this._onUpdateCursor();
		app.events.fire('TextCursorVisibility', { visible: app.file.textCursor.visible });
	},

	_onDownloadAsMsg: function (textMsg) {
		var command = app.socket.parseServerCmd(textMsg);
		var parser = document.createElement('a');
		parser.href = window.host;

		var url = window.makeHttpUrlWopiSrc('/' + this._map.options.urlPrefix + '/',
			this._map.options.doc, '/download/' + command.downloadid);

		this._map.hideBusy();
		var hostWordDownload = command.id === 'export' &&
			this._map['wopi'].HostWordDownloads &&
			/\.docx?$/i.test(command.filename || '');
		if (this._map['wopi'].DownloadAsPostMessage || hostWordDownload) {
			var exportArgs = {Type: command.id, URL: url, filename: command.filename};
			if (command.id === 'export') {
				var registered = this._map['wopi']._registerHostExport(url);
				if (registered) Object.assign(exportArgs, registered);
			}
			this._map.fire('postMessage', {msgId: 'Download_As', args: exportArgs});
		}
		else if (command.id === 'print') {
			if (this._map.options.print === false || window.L.Browser.cypressTest) {
				// open the pdf in a new tab, it can be printed directly in the browser's pdf viewer
				url = window.makeHttpUrlWopiSrc('/' + this._map.options.urlPrefix + '/',
					this._map.options.doc, '/download/' + command.downloadid,
					'attachment=0');

				if ('processCoolUrl' in window) {
					url = window.processCoolUrl({ url: url, type: 'print' });
				}

				window.open(url, '_blank');
			}
			else {
				if ('processCoolUrl' in window) {
					url = window.processCoolUrl({ url: url, type: 'print' });
				}

				this._map.fire('filedownloadready', {url: url});
			}
		}
		else if (command.id === 'slideshow') {
			this._map.fire('slidedownloadready', {url: url});
		}
		else if (command.id === 'export') {
			if ('processCoolUrl' in window) {
				url = window.processCoolUrl({ url: url, type: 'export' });
			}

			// Don't do a real download during testing
			if (!window.L.Browser.cypressTest)
				this._map._fileDownloader.src = url;
			else
				this._map._fileDownloader.setAttribute('data-src', url);
		}
	},

	_onExportFileMsg: function (textMsg) {
		this._map.hideBusy();
		var command = app.socket.parseServerCmd(textMsg);
		if (command.url) {
			window.postMobileMessage('exportfile url=' + command.url);
		}
	},

	_onErrorMsg: function (textMsg) {
		var command = app.socket.parseServerCmd(textMsg);

		// let's provide some convenience error codes for the UI
		var errorId = 1; // internal error
		if (command.errorCmd === 'load') {
			errorId = 2; // document cannot be loaded
		}
		else if (command.errorCmd === 'save' || command.errorCmd === 'saveas') {
			errorId = 5; // document cannot be saved
		}

		var errorCode = -1;
		if (command.errorCode !== undefined) {
			errorCode = command.errorCode;
		}

		this._map.fire('error', { cmd: command.errorCmd, kind: command.errorKind, id: errorId, code: errorCode, errorDetail: command.errorDetail });
	},

	_onGetChildIdMsg: function (textMsg) {
		var command = app.socket.parseServerCmd(textMsg);
		this._map.fire('childid', {id: command.id});
	},

	_openMobileWizard: function(data) {
		this._map.fire('mobilewizard', {data: data});
	},

	_closeMobileWizard: function() {
		this._map.fire('closemobilewizard');
	},

	_onGraphicViewSelectionMsg: function (textMsg) {
		var obj = JSON.parse(textMsg.substring('graphicviewselection:'.length + 1));
		var viewId = parseInt(obj.viewId);

		// Ignore if viewid is ours or not in our db
		if (viewId === this._viewId || !this._map._viewInfo[viewId]) {
			return;
		}

		var strTwips = obj.selection.match(/\d+/g);

		OtherViewGraphicSelectionSection.addOrUpdateGraphicSelectionIndicator(viewId, strTwips, parseInt(obj.part), obj.mode !== undefined ? parseInt(obj.mode): 0);

		this._vulcanNoteViewPart(viewId, parseInt(obj.part));

		if (app.getFollowedViewId() === viewId && app.isFollowingUser()) {
			if (this.isImpress() || this.isDraw() || this.isWriter()) {
				this.goToOtherUserView(viewId);
			}
		}

		this._vulcanNoteViewActivity(viewId, textMsg);
		this._saveMessageForReplay(textMsg, viewId);
	},

	// the people list's "Active now" / "Active 6m ago" comes from
	// other views' cursor and selection messages. UserList.noteViewMessage
	// decides which of them are moves; replays and join-time state are not.
	_vulcanNoteViewActivity: function (viewId, textMsg) {
		if (this._map.userList) this._map.userList.noteViewMessage(viewId, textMsg);
	},

	// Which slide each OTHER view is on, fed by the per-view messages that
	// already carry a part. Presence surfaces (the filmstrip dots) listen
	// for 'vulcanviewparts' instead of re-parsing view messages.
	_vulcanNoteViewPart: function (viewId, part) {
		if (!this.isImpress() && !this.isDraw()) return;
		if (isNaN(part)) return;
		if (!this._vulcanViewParts) this._vulcanViewParts = {};
		if (this._vulcanViewParts[viewId] === part) return;
		this._vulcanViewParts[viewId] = part;
		this._map.fire('vulcanviewparts');
	},

	_onCellCursorMsg: function (textMsg) {
		var cellfillMarkerSection = app.sectionContainer.getSectionWithName(app.CSections.CellFillMarker.name);

		var oldCursorAddress = app.calc.cellAddress.clone();

		if (textMsg.match('EMPTY')) {
			app.calc.cellCursorVisible = false;
			if (cellfillMarkerSection)
				cellfillMarkerSection.calculatePositionViaCellCursor(null);
			if (this._map._clip)
				this._map._clip.clearSelection();
		}
		else {
			var strTwips = textMsg.match(/\d+/g);
			var topLeftTwips = new cool.Point(parseInt(strTwips[0]), parseInt(strTwips[1]));
			var offset = new cool.Point(parseInt(strTwips[2]), parseInt(strTwips[3]));
			var bottomRightTwips = topLeftTwips.add(offset);
			let _cellCursorTwips = this._convertToTileTwipsSheetArea(new cool.Bounds(topLeftTwips, bottomRightTwips));

			app.calc.cellAddress = new cool.SimplePoint(parseInt(strTwips[4]), parseInt(strTwips[5]));
			let tempRectangle = _cellCursorTwips.toRectangle();
			app.calc.cellCursorRectangle = new cool.SimpleRectangle(tempRectangle[0], tempRectangle[1], tempRectangle[2], tempRectangle[3]);
			this._cellCursorSection.size[0] = app.calc.cellCursorRectangle.pWidth;
			this._cellCursorSection.size[1] = app.calc.cellCursorRectangle.pHeight;
			this._cellCursorSection.setPosition(app.calc.cellCursorRectangle.pX1, app.calc.cellCursorRectangle.pY1);
			app.calc.cellCursorVisible = true;

			app.sectionContainer.onCellAddressChanged();
			if (cellfillMarkerSection)
				cellfillMarkerSection.calculatePositionViaCellCursor([app.calc.cellCursorRectangle.pX2, app.calc.cellCursorRectangle.pY2]);
		}

		var sameAddress = oldCursorAddress.equals(app.calc.cellAddress.toArray());

		var isFollowingOwnCursor = parseInt(app.getFollowedViewId()) === parseInt(this._viewId);
		var notJump = sameAddress || !isFollowingOwnCursor;
		var scrollToCursor = this._sheetSwitch.tryRestore(notJump, this._selectedPart);

		this._onUpdateCellCursor(scrollToCursor, notJump, sameAddress);

		// Remove the validity input help only when the cursor really moved away
		// from the cell it belongs to, that is a different address or a hidden
		// cursor. The kit resends the cellcursor for the unchanged cell on view
		// updates and the engine never resends the help, so removing it on every
		// cellcursor would make a help that should stay visible disappear right
		// after it appears. Removal on a sheet change is handled where the sheet
		// switch happens, because switching sheets does not always produce a
		// cellcursor with a changed address.
		var cursorHidden = !!textMsg.match('EMPTY');
		if (!sameAddress || cursorHidden)
			app.definitions.validityInputHelpSection.removeValidityInputHelp();

		// Reposition formula error button with the updated cursor rect.
		app.definitions.formulaErrorHelpSection.hide();
		this._showPendingCellError();

		// Vulcan: core's cursor answers the Calc echoes' predictions.
		if (app.definitions && app.definitions.vulcanCalcCursorEcho)
			app.definitions.vulcanCalcCursorEcho.onCellCursor();
		if (app.definitions && app.definitions.vulcanCalcTextEcho)
			app.definitions.vulcanCalcTextEcho.onCellCursor();
	},

	_onDocumentRepair: function (textMsg) {
		if (!this._docRepair) {
			this._docRepair = window.L.control.documentRepair();
		}

		if (!this._docRepair.isVisible()) {
			this._docRepair.addTo(this._map);
			this._docRepair.fillActions(textMsg);
			this._docRepair.show();
		}
	},

	_onMousePointerMsg: function (textMsg) {
		textMsg = textMsg.substring(14); // "mousepointer: "
		textMsg = Cursor.getCustomCursor(textMsg) || textMsg;
		this._coreMousePointer = textMsg;
		const canvas = document.getElementById('document-canvas');
		if (canvas && canvas.style.cursor !== textMsg) {
			canvas.style.cursor = textMsg;
		}
	},

	_getFunctionList: function(textMsg) {
		var resultList = [];
		var suggestionArray = JSON.parse(textMsg);
		for (var i = 0; i < suggestionArray.length; i++) {
			var signature = suggestionArray[i].signature;
			var namedRange = suggestionArray[i].namedRange;
			var name, description;
			if (namedRange) {
				name = signature;
				description = _('Named Range');
			} else {
				name = signature.substring(0,signature.indexOf('('));
				description = suggestionArray[i].description;
			}
			resultList.push({'name': name, 'description': description, 'namedRange': namedRange});
		}
		return resultList;
	},

	_isMultiPageView: function() {
		const layout = app.activeDocument ? (app.activeDocument.activeLayout ?  app.activeDocument.activeLayout.type : "") : "";
		return layout === 'ViewLayoutMultiPage';
	},

	_onInvalidateCursorMsg: function (textMsg) {
		textMsg = textMsg.substring('invalidatecursor:'.length + 1);
		var obj = JSON.parse(textMsg);
		var recCursor = this._getEditCursorRectangle(obj);
		if (recCursor === undefined || this.persistCursorPositionInWriter) {
			this.persistCursorPositionInWriter = false;
			return;
		}

		// tells who trigerred cursor invalidation, but recCursors is still "ours"
		var modifierViewId = parseInt(obj.viewId);
		var weAreModifier = (modifierViewId === this._viewId);
		// The agent bridge's searches move this view's cursor and it puts
		// the reader back afterwards: while it holds the view, the moved
		// cursor is not followed, scrolled to, or taken for the reader's input.
		var bridgeHoldsView = this._bridgeHoldsView();
		if (weAreModifier && app.isFollowingOff() && !bridgeHoldsView)
			app.setFollowingUser(this._viewId);

		this._cursorAtMispelledWord = obj.mispelledWord ? Boolean(parseInt(obj.mispelledWord)).valueOf() : false;

		if (obj.controlEvent === true)
			this._formID = obj.windowId;
		else
			this._formID = null;

		// Remember the last position of the caret (in core pixels).
		this._cursorPreviousPositionCorePixels = app.file.textCursor.rectangle.clone();

		app.file.textCursor.rectangle = new cool.SimpleRectangle(recCursor.getTopLeft().x, recCursor.getTopLeft().y, recCursor.getSize().x, recCursor.getSize().y);

		if (weAreModifier && app.definitions && app.definitions.vulcanCalcTextEcho)
			app.definitions.vulcanCalcTextEcho.onCaret();

		if (this.isWriter()) {
			app.sectionContainer.onCursorPositionChanged();
		}

		if (!this._map.editorHasFocus() && app.file.textCursor.visible && weAreModifier && !bridgeHoldsView) {
			// Regain cursor if we had been out of focus and now have input.
			// Unless the focus is in the Calc Formula-Bar, don't steal the focus.
			if (!this._map.calcInputBarHasFocus())
				this._map.fire('editorgotfocus');
		}

		//first time document open, set last cursor position
		if (!this.lastCursorPos)
			this.lastCursorPos = app.file.textCursor.rectangle.clone();

		var updateCursor = false;
		if (!this.lastCursorPos.equals(app.file.textCursor.rectangle.toArray())) {
			updateCursor = true;
			this.lastCursorPos = app.file.textCursor.rectangle.clone();
		}

		const isHyperlinkChanged = this._isHyperlinkChanged(obj.hyperlink);
		this._map.hyperlinkUnderCursor = obj.hyperlink;
		if (URLPopUpSection.isOpen() && !(obj.hyperlink && obj.hyperlink.link))
			URLPopUpSection.closeURLPopUp();

		if (obj.hyperlink && obj.hyperlink.link &&
			( !URLPopUpSection.isOpen() || updateCursor || isHyperlinkChanged))
			URLPopUpSection.showURLPopUP(obj.hyperlink.link, new cool.SimplePoint(app.file.textCursor.rectangle.x1, app.file.textCursor.rectangle.y1));

		// If modifier view is different than the current view
		// we'll keep the caret position at the same point relative to screen.
		this._onUpdateCursor(
			/* scroll */ updateCursor && weAreModifier && !bridgeHoldsView,
			/* zoom */ undefined,
			/* keepCaretPositionRelativeToScreen */ !weAreModifier);

		// Only for reference equality comparison.
		this._lastVisibleCursorRef = app.file.textCursor.rectangle.clone();

		// Normally we don't need to refresh the ruler offset.
		// But in multi page view, user may have clicked at the page next to the current one.
		// In that case, we need to fix offset again (if required - it checks values before changing offset).
		if (this._isMultiPageView() && app.UI.horizontalRuler)
			app.UI.horizontalRuler.fixOffset();
	},

	_isHyperlinkChanged: function(hyperlink)
	{
		// If there is a new hyperlink or existing hyperlink changed or deleted
		if (hyperlink && hyperlink.link)
		{
			if ((this._map.hyperlinkUnderCursor == null || this._map.hyperlinkUnderCursor == undefined) ||
				(this._map.hyperlinkUnderCursor.link != hyperlink.link ||
			     this._map.hyperlinkUnderCursor.text != hyperlink.text))
				return true;
		}
		else if (this._map.hyperlinkUnderCursor != null && this._map.hyperlinkUnderCursor != undefined)
				return true;

		return false;
	},

	_updateEditor: function(textMsg) {
		textMsg = textMsg.substring('editor:'.length + 1);
		var editorId = parseInt(textMsg);
		var docLayer = this._map._docLayer;

		docLayer._editorId = editorId;

		if (app.isFollowingEditor()) {
			app.setFollowingEditor(editorId);
		}

		if (this._map._viewInfo[editorId])
			this._map.fire('updateEditorName', {username: this._map._viewInfo[editorId].username});
	},

	_onInvalidateViewCursorMsg: function (textMsg) {
		var obj = JSON.parse(textMsg.substring('invalidateviewcursor:'.length + 1));
		var viewId = parseInt(obj.viewId);

		// Ignore if viewid is same as ours or not in our db
		if (viewId === this._viewId || !this._map._viewInfo[viewId]) {
			return;
		}

		const username = this._map._viewInfo[viewId].username;
		const mode = obj.mode ? parseInt(obj.mode): 0;

		let rectangle;
		if (obj.refpoint) {
			let refPoint = obj.refpoint.split(',');
			refPoint = new cool.SimplePoint(parseInt(refPoint[0]), parseInt(refPoint[1]));

			if (this.sheetGeometry) {
				this.sheetGeometry.convertToTileTwips(refPoint);

				rectangle = obj.relrect.split(',');
				for (let i = 0; i < rectangle.length; i++) rectangle[i] = parseInt(rectangle[i]);

				rectangle[0] += refPoint.x;
				rectangle[1] += refPoint.y;
			}
		}
		else {
			rectangle = obj.rectangle.split(',');
			for (let i = 0; i < rectangle.length; i++) rectangle[i] = parseInt(rectangle[i]);
		}

		TextCursorSection.addOrUpdateOtherViewCursor(viewId, username, rectangle, parseInt(obj.part), mode);

		this._vulcanNoteViewPart(viewId, parseInt(obj.part));

		if (app.getFollowedViewId() === viewId && (app.isFollowingEditor() || app.isFollowingUser())) {
			if (this.isWriter() || this.isImpress() || this.isDraw()) {
				this.goToViewCursor(viewId);
			}
			else if (this._map.getDocType() === 'spreadsheet') {
				this.goToCellViewCursor(viewId);
			}
		}

		this._vulcanNoteViewActivity(viewId, textMsg);
		this._saveMessageForReplay(textMsg, viewId);
	},

	_convertRawTwipsToTileTwips: function(strTwips) {
		if (!strTwips)
			return null;

		var topLeftTwips = new cool.Point(parseInt(strTwips[0]), parseInt(strTwips[1]));
		var offset = new cool.Point(parseInt(strTwips[2]), parseInt(strTwips[3]));
		var bottomRightTwips = topLeftTwips.add(offset);
		strTwips = this._convertToTileTwipsSheetArea(new cool.Bounds(topLeftTwips, bottomRightTwips)).toRectangle();
		return strTwips;
	},

	_onViewLockInfoMsg: function(textMsg) {
		var obj = JSON.parse(textMsg.substring('viewlock:'.length + 1));
		const viewId = parseInt(obj.viewId);

		if (obj.rectangle !== "EMPTY")
			OtherViewGraphicSelectionSection.setViewLockInfo(viewId, obj);
		else
			OtherViewGraphicSelectionSection.setViewLockInfo(viewId, null);
	},

	_onCellViewCursorMsg: function (textMsg) {
		var obj = JSON.parse(textMsg.substring('cellviewcursor:'.length + 1));
		var viewId = parseInt(obj.viewId);

		// Ignore if viewid is same as ours
		if (viewId === this._viewId) {
			return;
		}

		if (obj.rectangle.match('EMPTY'))
			OtherViewCellCursorSection.removeView(viewId);
		else {
			let strTwips = obj.rectangle.match(/\d+/g);
			strTwips = this._convertRawTwipsToTileTwips(strTwips);

			OtherViewCellCursorSection.addOrUpdateOtherViewCellCursor(viewId, this._map.getViewName(viewId), strTwips, parseInt(obj.part));
			CursorHeaderSection.deletePopUpNow(viewId);
		}

		this._vulcanNoteViewActivity(viewId, textMsg);
		if (this.isCalc()) {
			this._saveMessageForReplay(textMsg, viewId);
		}
	},

	goToCellViewCursor: function(viewId) {
		if (OtherViewCellCursorSection.doesViewCursorExist(viewId)) {
			const viewCursorSection = OtherViewCellCursorSection.getViewCursorSection(viewId);

			if (this._selectedPart !== viewCursorSection.sectionProperties.part)
				this._map.setPart(viewCursorSection.sectionProperties.part);

			if (!viewCursorSection.isVisible) {
				const scrollX = viewCursorSection.position[0];
				const scrollY = viewCursorSection.position[1];
				this.scrollToPos(new cool.SimplePoint(scrollX * app.pixelsToTwips, scrollY * app.pixelsToTwips));
			}

			OtherViewCellCursorSection.showPopUpForView(viewId);
		}
	},

	_onViewCursorVisibleMsg: function(textMsg) {
		textMsg = textMsg.substring('viewcursorvisible:'.length + 1);
		var obj = JSON.parse(textMsg);
		var viewId = parseInt(obj.viewId);

		// Ignore if viewid is same as ours or not in our db
		if (viewId === this._viewId || !this._map._viewInfo[viewId]) {
			return;
		}

		const section = TextCursorSection.getViewCursorSection(viewId);
		if (section) {
			const showCursor = obj.visible === 'true';
			section.sectionProperties.showCursor = showCursor;
			section.setShowSection(section.checkMyVisibility());
			if (!section.showSection)
				CursorHeaderSection.deletePopUpNow(viewId);
		}
	},

	_addView: function(viewInfo) {
		if (viewInfo.color === 0 && this._map.getDocType() !== 'text') {
			viewInfo.color = app.LOUtil.getViewIdColor(viewInfo.id);
		}

		this._map.addView(viewInfo);
	},

	_removeView: function(viewId) {
		// Remove selection, if any.
		app.activeDocument.removeView(viewId);

		TextCursorSection.removeView(viewId);

		OtherViewCellCursorSection.removeView(viewId);
		OtherViewGraphicSelectionSection.removeView(viewId);

		if (this._vulcanViewParts && this._vulcanViewParts[viewId] !== undefined) {
			delete this._vulcanViewParts[viewId];
			this._map.fire('vulcanviewparts');
		}

		this._map.removeView(viewId);
	},

	removeAllViews: function() {
		for (var viewInfoIdx in this._map._viewInfo) {
			this._removeView(parseInt(viewInfoIdx));
		}
	},

	_onViewInfoMsg: function(textMsg) {
		textMsg = textMsg.substring('viewinfo: '.length);
		var viewInfo = JSON.parse(textMsg);
		this._map.fire('viewinfo', viewInfo);

		// A new view
		var viewIds = [];
		for (var viewInfoIdx in viewInfo) {
			if (!(parseInt(viewInfo[viewInfoIdx].id) in this._map._viewInfo)) {
				this._addView(viewInfo[viewInfoIdx]);
			}
			viewIds.push(viewInfo[viewInfoIdx].id);
		}

		// Check if any view is deleted
		for (viewInfoIdx in this._map._viewInfo) {
			if (viewIds.indexOf(parseInt(viewInfoIdx)) === -1) {
				this._removeView(parseInt(viewInfoIdx));
			}
		}

		// Sending postMessage about View_Added / View_Removed is
		// deprecated, going forward we prefer sending the entire information.
		this._map.fire('updateviewslist');
	},

	// The Writer agent bridge's own searches (VulcanWriterBridge: its match
	// counts and its anchor FINDs) answer through the same messages as the
	// reader's. A claimed answer is not the reader's search: it is fired
	// with vulcanBridge: true, which the find bar ignores, and never becomes
	// _searchTerm / _searchResults. A count (keepView) is not followed
	// either. Returns null for the reader's own search.
	_claimBridgeSearch: function (phrase) {
		var bridge = app.writerBridge;
		if (!bridge || typeof bridge.claimSearchAnswer !== 'function')
			return null;
		return bridge.claimSearchAnswer(phrase);
	},

	// True while the Writer agent bridge moves this view's cursor with its
	// own searches and will put it back (VulcanWriterBridge.holdsView).
	_bridgeHoldsView: function () {
		var bridge = app.writerBridge;
		return !!(bridge && typeof bridge.holdsView === 'function' && bridge.holdsView());
	},

	_onSearchNotFoundMsg: function (textMsg) {
		var originalPhrase = textMsg.substring(16);
		if (this._claimBridgeSearch(originalPhrase)) {
			this._map.fire('search', {originalPhrase: originalPhrase, count: 0, vulcanBridge: true});
			return;
		}
		this._clearSearchResults();
		this._map.fire('search', {originalPhrase: originalPhrase, count: 0});
	},

	_getSearchResultRectangles: function (obj, results) {
		for (var i = 0; i < obj.searchResultSelection.length; i++) {
			results.push({
				part: parseInt(obj.searchResultSelection[i].part),
				rectangles: this._twipsRectanglesToPixelBounds(obj.searchResultSelection[i].rectangles),
				twipsRectangles: obj.searchResultSelection[i].rectangles
			});
		}
	},

	_getSearchResultRectanglesFileBasedView: function (obj, results) {
		var additionPerPart = this._partHeightTwips + this._spaceBetweenParts;

		for (var i = 0; i < obj.searchResultSelection.length; i++) {
			var rectangles = obj.searchResultSelection[i].rectangles;
			var part = parseInt(obj.searchResultSelection[i].part);
			rectangles = rectangles.split(',');
			rectangles = rectangles.map(function(element, index) {
				element = parseInt(element);
				if (index < 2)
					element += additionPerPart * part;
				return element;
			});

			rectangles = String(rectangles[0]) + ', ' + String(rectangles[1]) + ', ' + String(rectangles[2]) + ', ' + String(rectangles[3]);

			results.push({
				part: parseInt(obj.searchResultSelection[i].part),
				rectangles: this._twipsRectanglesToPixelBounds(rectangles),
				twipsRectangles: rectangles
			});
		}
	},

	_onSearchResultSelection: function (textMsg) {
		textMsg = textMsg.substring(23);
		var obj = JSON.parse(textMsg);
		var originalPhrase = obj.searchString;
		var count = obj.searchResultSelection.length;
		var highlightAll = obj.highlightAll;
		var results = [];

		if (!app.file.fileBasedView)
			this._getSearchResultRectangles(obj, results);
		else
			this._getSearchResultRectanglesFileBasedView(obj, results);

		var bridgeSearch = this._claimBridgeSearch(originalPhrase);
		if (bridgeSearch) {
			this._map.fire('search', {originalPhrase: originalPhrase, count: count, highlightAll: highlightAll, results: results, vulcanBridge: true});
			if (bridgeSearch.keepView)
				return;
			app.setFollowingUser(this._viewId);
			if (app.file.textCursor.visible)
				this._onUpdateCursor(/* scroll */ true);
			return;
		}

		// do not cache search results if there is only one result.
		// this way regular searches works fine
		if (count > 1)
		{
			this._clearSearchResults();
			this._searchResults = results;
			if (!app.file.fileBasedView)
				this._map.setPart(results[0].part); // go to first result.
			else
				this._map._docLayer._preview._scrollViewToPartPosition(results[0].part);
		} else if (count === 1) {
			this._lastSearchResult = results[0];
		}
		this._searchTerm = originalPhrase;
		this._map.fire('search', {originalPhrase: originalPhrase, count: count, highlightAll: highlightAll, results: results});

		app.setFollowingUser(this._viewId);

		// always jump to search result - we already received cell / text cursor before so we need
		// to force it in case we had following OFF
		if (app.file.textCursor.visible)
			this._onUpdateCursor(/* scroll */ true);
		else if (app.calc.cellCursorVisible)
			this._onUpdateCellCursor(/* scroll */ true);
	},

	_clearSearchResults: function() {
		if (this._searchTerm)
			app.activeDocument.activeView.clearTextSelection();

		this._lastSearchResult = null;
		this._searchResults = null;
		this._searchTerm = null;
	},

	_onStateChangedMsg: function (textMsg) {
		textMsg = textMsg.substr(14);
		let json = null;

		if (textMsg.trim().startsWith('{') && textMsg.trim().endsWith('}')) {
			try {
				json = JSON.parse(textMsg);
			} catch (e) {
				// Not a valid JSON.
			}
		}

		if (json) {
			// json.state as empty string is fine, for example it means no selection
			// when json.commandName is '.uno:RowColSelCount'.
			// A command may only carry 'enabled' flag (.uno:DatabaseSettings).
			if (json.commandName && (json.state !== undefined || json.enabled !== undefined)) {
				this._map.fire('commandstatechanged', json);
				if (window.ThisIsTheMacOSApp || window.ThisIsTheQtApp) {
					window.postMobileMessage('COMMANDSTATECHANGED ' + JSON.stringify(json));
				}
			}
		}
		else if (textMsg.startsWith('.uno:Context=') && this.isImpress()) {
			this._selectionContextChanged(textMsg.replace('.uno:Context=', ''));
		}
		else if (textMsg.startsWith('headerfooterboundary=')) {
			textMsg = textMsg.substring('headerfooterboundary='.length);
			if (!app.sectionContainer.doesSectionExist(app.CSections.HeaderFooterBoundary.name)) {
				app.sectionContainer.addSection(new cool.HeaderFooterBoundarySection());
			}
			var hfBoundarySection = app.sectionContainer.getSectionWithName(app.CSections.HeaderFooterBoundary.name);
			hfBoundarySection.update(JSON.parse(textMsg));
		}
		else {
			var index = textMsg.indexOf('=');
			var commandName = index !== -1 ? textMsg.substr(0, index) : '';
			var state = index !== -1 ? textMsg.substr(index + 1) : '';
			const json = {commandName : commandName, state : state};
			this._map.fire('commandstatechanged', json);
			if (window.ThisIsTheMacOSApp || window.ThisIsTheQtApp) {
				window.postMobileMessage('COMMANDSTATECHANGED ' + JSON.stringify(json));
			}
		}
	},

	_onUnoCommandResultMsg: function (textMsg) {
		// window.app.console.log('_onUnoCommandResultMsg: "' + textMsg + '"');
		textMsg = textMsg.substring(18);
		var obj = JSON.parse(textMsg);
		var commandName = obj.commandName;
		if (obj.success === 'true' || obj.success === true) {
			var success = true;
		}
		else if (obj.success === 'false' || obj.success === false) {
			success = false;
		}

		this._map.hideBusy();
		this._map.fire('commandresult', {commandName: commandName, success: success, result: obj.result});
		if (window.ThisIsTheMacOSApp || window.ThisIsTheQtApp) {
			window.postMobileMessage('COMMANDRESULT ' + textMsg);
		}

		if (this._map.CallPythonScriptSource != null) {
			this._map.CallPythonScriptSource.postMessage(JSON.stringify({'MessageId': 'CallPythonScript-Result',
										     'SendTime': Date.now(),
										     'Values': obj
										    }),
								     '*');
			this._map.CallPythonScriptSource = null;
		}
	},

	_onRulerUpdate: function (textMsg) {
		var horizontalRuler = true;
		if(textMsg.startsWith('vrulerupdate:')) {
			horizontalRuler = false;
		}
		textMsg = textMsg.substring(13);
		var obj = JSON.parse(textMsg);
		if (!horizontalRuler) {
			this._map.fire('vrulerupdate', obj);
		}
		else {
			/*
			 * VULCAN: keep the TEXT COLUMN width for the opening fit.
			 *
			 * `margin2` is the text width in mm100 (not a margin -- see
			 * VulcanWriterFit.textFitLevel for the decoded payload and the
			 * two checks that confirm it). The first update after load is all
			 * zeros, so only a positive pair is worth recording; a zero would
			 * otherwise latch and pin every later fit to a bogus geometry.
			 */
			if (obj && obj.margin2 > 0 && obj.pageWidth > 0) {
				var vulcanFirstRuler = !(this._vulcanTextWidthMm100 > 0);
				this._vulcanTextWidthMm100 = obj.margin2;
				this._vulcanPageWidthMm100 = obj.pageWidth;
				// leftOffset is the left margin in mm100; the scroll band is
				// measured from the page's left edge, so it needs both.
				this._vulcanLeftMarginMm100 = obj.leftOffset > 0 ? obj.leftOffset : 0;

				/*
				 * THE OPENING FIT RUNS BEFORE THIS ARRIVES.
				 *
				 * MEASURED on build a2a3e82a: a document settled at level 12
				 * with the text geometry present (margin2 16510) in a 1217px
				 * column, where the text rule gives 13. The fit had already run
				 * at load, when the only ruler payload was the all-zero one core
				 * sends first, so textFitLevel returned null and the commit fell
				 * back to the stock page-fit floor. Nothing re-fitted afterwards
				 * because the column never moved.
				 *
				 * So the first REAL payload re-runs the fit. Guarded on the
				 * document still sitting at the zoom the last fit applied,
				 * so a reader who has already zoomed by hand keeps their
				 * zoom.
				 */
				// A reader who switched smart zoom off asked for their own
				// rung: the opening fit already honoured that, and the
				// re-fit must not overrule it.
				if (vulcanFirstRuler && this.isWriter() &&
					document.documentElement.classList.contains('vulcan-desktop-chrome') &&
					window.prefs.get('smartZoom') != 'false' &&
					this._lastFitZoom > 0 &&
					this._map.getZoom() === this._lastFitZoom &&
					!this._vulcanWriterUserViewport) {
					this._fitWidthZoom(null, null, true);
				}
			}
			this._map.fire('rulerupdate', obj);
		}
	},

	_onContextMenuMsg: function (textMsg) {
		textMsg = textMsg.substring(13);
		var obj = JSON.parse(textMsg);

		this._map.fire('locontextmenu', obj);
	},

	_convertToPointSet(rectangleArray) {
		const result = CPolyUtil.rectanglesToPointSet(rectangleArray,
			function (twipsPoint) {
				var corePxPt = app.map._docLayer._twipsToCorePixels(twipsPoint);
				corePxPt.round();
				return corePxPt;
			});

		return result;
	},

	_getRawRectangles(message) {
		let rawRectangles = message.split('::')[0].split(';');

		let refpoint = new cool.SimplePoint(0, 0);
		if (message.indexOf('::') !== -1) {
			refpoint = message.split('::')[1].split(',');
			refpoint = new cool.SimplePoint(parseInt(refpoint[0]), parseInt(refpoint[1]));
		}

		if (message !== '' && message !== 'EMPTY') {
			rawRectangles = rawRectangles.map((rectangle) => {
				const temp = rectangle.split(',');
				return [parseInt(temp[0]) + refpoint.x, parseInt(temp[1]) + refpoint.y, parseInt(temp[2]), parseInt(temp[3])];
			});
		}
		else rawRectangles = [];

		if (this.isCalc() && this.sheetGeometry) {
			for (let i = 0; i < rawRectangles.length; i++) {
				this.sheetGeometry.convertRawRectangleToTileTwips(rawRectangles[i]);
			}
		}

		return rawRectangles;
	},

	_onTextSelectionMsg: function (textMsg) {
		textMsg = textMsg.replace('textselection:', '').trim();
		const rawRectangles = this._getRawRectangles(textMsg);

		if (rawRectangles.length > 0) {
			TextSelections.activate();

			if (app.file.fileBasedView && this._lastSearchResult) {
				// We rely on that _lastSearchResult has been updated before this function is called.
				const additionPerPart = this._partHeightTwips + this._spaceBetweenParts;

				for (let i = 0; i < rawRectangles.length; i++) {
					rawRectangles[i][1] += additionPerPart * this._lastSearchResult.part;
				}

				this._map._docLayer._preview._scrollViewToPartPosition(this._lastSearchResult.part);
				RenderManager.updateFileBasedView();
				setTimeout(function () {app.sectionContainer.requestReDraw();}, 100);
			}

			app.activeDocument.activeView.updateSelectionRawData(app.activeDocument.activeModes[0], this._selectedPart, rawRectangles);

			if (this._map._textInput._cursorHandler)
				this._map._textInput._cursorHandler.setShowSection(false); // User selected text, we remove the carret marker.

			if (window.L.Browser.clipboardApiAvailable) {
				// Just set the selection type, no fetch of the content.
				this._map._clip.setTextSelectionType('text');
			} else {
				// Trigger fetching the selection content, we already need to have
				// it locally by the time 'copy' is executed.
				if (this._selectionContentRequest) {
					clearTimeout(this._selectionContentRequest);
				}
				this._selectionContentRequest = setTimeout(window.L.bind(function () {
					app.socket.sendMessage('gettextselection mimetype=text/html,text/plain;charset=utf-8');}, this), 100);
			}

			if (this._map.contextToolbar)
				this._map.contextToolbar.showContextToolbar();
		}
		else {
			TextSelections.deactivate();
			app.activeDocument.activeView.clearTextSelection();
			this._selectedTextContent = '';
			if (this._map.contextToolbar)
				this._map.contextToolbar.hideContextToolbar();
			if (this._map._clip && this._map._clip._selectionType === 'complex')
				this._map._clip.clearSelection();
		}
	},

	_onTextViewSelectionMsg: function (textMsg) {
		const obj = JSON.parse(textMsg.substring('textviewselection:'.length + 1));
		const viewId = parseInt(obj.viewId);
		const viewMode = (obj.mode !== undefined) ? parseInt(obj.mode) : 0;

		// Ignore if viewid is same as ours or not in our db
		if (viewId === this._viewId || !this._map._viewInfo[viewId])
			return;

		// Get raw rectangles.
		const rawRectangles = this._getRawRectangles(obj.selection.trim());

		app.activeDocument.getView(viewId).updateSelectionRawData(viewMode, parseInt(obj.part), rawRectangles);

		this._vulcanNoteViewActivity(viewId, textMsg);
		this._saveMessageForReplay(textMsg, viewId);
	},

	_updateReferenceMarks: function() {
		this._clearReferences();

		if (!this._referencesAll)
			return;

		for (var i = 0; i < this._referencesAll.length; i++) {
			// Avoid doubled marks, add only marks for current sheet
			if (!this._references.hasMark(this._referencesAll[i].mark)
				&& this._selectedPart === this._referencesAll[i].part) {
				this._references.addMark(this._referencesAll[i].mark);
			}
		}
	},

	// Build the list of {mark, part} references from the marks array of a
	// referencemarks/SparklineGroup payload. Each mark becomes a CPolygon that
	// fills the cell range with a translucent highlight.
	//
	// `phoneDashed` (G34, device exhibit EX-13) swaps that fill for Google's
	// DASHED OUTLINE in the mark's own colour, at full opacity. It is passed
	// only by the formula-reference call site: a sparkline group highlight is a
	// group shading, not a formula reference, and must keep its fill. The
	// colours are core's either way, so the outline on the grid and the
	// coloured token in the formula bar (VulcanFormulaRefColors) agree by
	// construction.
	//
	// Why the fill had to go rather than be tinted: at 25% fill + a 25%-opacity
	// hairline, a reference mark on a phone reads as nothing — which is why
	// "we do neither" was a fair description of a client that was already
	// receiving and drawing the marks.
	_marksToReferences: function (marks, phoneDashed) {
		var references = [];

		for (var mark = 0; mark < marks.length; mark++) {
			var strTwips = marks[mark].rectangle.match(/\d+/g);
			var strColor = marks[mark].color;
			var part = parseInt(marks[mark].part);

			if (strTwips != null) {
				var rectangles = [];
				for (var i = 0; i < strTwips.length; i += 4) {
					var topLeftTwips = new cool.Point(parseInt(strTwips[i]), parseInt(strTwips[i + 1]));
					var offset = new cool.Point(parseInt(strTwips[i + 2]), parseInt(strTwips[i + 3]));
					var boundsTwips = this._convertToTileTwipsSheetArea(
						new cool.Bounds(topLeftTwips, topLeftTwips.add(offset)));
					rectangles.push([boundsTwips.getBottomLeft(), boundsTwips.getBottomRight(),
						boundsTwips.getTopLeft(), boundsTwips.getTopRight()]);
				}

				var docLayer = this;
				var pointSet = CPolyUtil.rectanglesToPointSet(rectangles, function (twipsPoint) {
					var corePxPt = docLayer._twipsToCorePixels(twipsPoint);
					corePxPt.round();
					return corePxPt;
				});
				var reference = phoneDashed
					? new CPolygon(pointSet, {
						pointerEvents: 'none',
						fill: false,
						color: '#' + strColor,
						// [4, 3] is the fork's own dash art — the same pattern
						// ShapeHandlesSection already draws its outlines with —
						// scaled to device pixels so it does not vanish at 3x.
						dashArray: [4 * app.dpiScale, 3 * app.dpiScale],
						weight: 2 * app.dpiScale,
						opacity: 1})
					: new CPolygon(pointSet, {
						pointerEvents: 'none',
						fillColor: '#' + strColor,
						fillOpacity: 0.25,
						weight: 2 * app.dpiScale,
						opacity: 0.25});

				references.push({mark: reference, part: part});
			}
		}

		return references;
	},

	_onReferencesMsg: function (textMsg) {
		textMsg = textMsg.substr(textMsg.indexOf(' ') + 1);
		var marks = JSON.parse(textMsg);
		this._referencesAll = this._marksToReferences(marks.marks, this._vulcanPhoneChrome());
		this._updateReferenceMarks();
		// G34's text half. The same payload, in the same order, so the token
		// colours in the formula bar cannot drift from the outlines on the
		// grid. Inert off the phone chrome (VulcanFormulaRefColors.setMarks
		// returns before storing anything).
		if (window.VulcanFormulaRefColors)
			window.VulcanFormulaRefColors.setMarks(marks.marks);
	},

	// Highlight of the cells belonging to the sparkline group of the current
	// cell. Kept independent of the formula reference marks above so that the
	// two highlights do not clear each other.
	_updateSparklineGroupReferences: function() {
		if (!this._sparklineGroupReferences)
			return;

		this._sparklineGroupReferences.clear();

		if (!this._sparklineGroupReferencesAll)
			return;

		for (var i = 0; i < this._sparklineGroupReferencesAll.length; i++) {
			if (this._selectedPart === this._sparklineGroupReferencesAll[i].part)
				this._sparklineGroupReferences.addMark(this._sparklineGroupReferencesAll[i].mark);
		}
	},

	_onSparklineGroupMsg: function (state) {
		this._sparklineGroupReferencesAll = (state && state.marks)
			? this._marksToReferences(state.marks) : [];
		this._updateSparklineGroupReferences();
	},

	_getStringPart: function (string) {
		var code = '';
		var i = 0;
		while (i < string.length) {
			if (string.charCodeAt(i) < 48 || string.charCodeAt(i) > 57) {
				code += string.charAt(i);
			}
			i++;
		}
		return code;
	},

	_getNumberPart: function (string) {
		var number = '';
		var i = 0;
		while (i < string.length) {
			if (string.charCodeAt(i) >= 48 && string.charCodeAt(i) <= 57) {
				number += string.charAt(i);
			}
			i++;
		}
		return parseInt(number);
	},

	_isWholeColumnSelected: function (cellAddress) {
		if (!cellAddress)
			cellAddress = document.querySelector('#addressInput input').value;

		var startEnd = cellAddress.split(':');
		if (startEnd.length === 1)
			return false; // Selection is not a range.

		var rangeStart = this._getNumberPart(startEnd[0]);
		if (rangeStart !== 1)
			return false; // Selection doesn't start at first row.

		var rangeEnd = this._getNumberPart(startEnd[1]);
		if (rangeEnd === app.calc.maxRowCount) // Last row's number.
			return true;
		else
			return false;
	},

	_isWholeRowSelected: function (cellAddress) {
		if (!cellAddress)
			cellAddress = document.querySelector('#addressInput input').value;

		var startEnd = cellAddress.split(':');
		if (startEnd.length === 1)
			return false; // Selection is not a range.

		var rangeStart = this._getStringPart(startEnd[0]);
		if (rangeStart !== 'A')
			return false; // Selection doesn't start at first column.

		var rangeEnd = this._getStringPart(startEnd[1]);
		if (this._columnLabelToNumber(rangeEnd) === app.calc.maxColumnCount) // Last column.
			return true;
		else
			return false;
	},

	// Converts a spreadsheet column label ('A', 'AA', 'XFD'...) to its 1-based number.
	_columnLabelToNumber: function (label) {
		var number = 0;
		for (var i = 0; i < label.length; i++)
			number = number * 26 + (label.charCodeAt(i) - 64); // 'A'.charCodeAt(0) === 65.
		return number;
	},

	_updateScrollOnCellSelection: function (oldSelection, newSelection) {
		if (!oldSelection)
			return;

		if (newSelection.equals(oldSelection.toArray()))
			return;

		const viewedRectangle = app.activeDocument.activeLayout.viewedRectangle;
		const directionDownOrRight = (newSelection.pX2 !== oldSelection.pX2) || (newSelection.pY2 !== oldSelection.pY2);

		let needsScroll = false;
		let xVisible;
		let yVisible;

		if (directionDownOrRight) {
			xVisible = app.isXVisibleInTheDisplayedArea(newSelection.x2);
			yVisible = app.isYVisibleInTheDisplayedArea(newSelection.y2);
			needsScroll = !xVisible || !yVisible;
		}
		else {
			xVisible = app.isXVisibleInTheDisplayedArea(newSelection.x1);
			yVisible = app.isYVisibleInTheDisplayedArea(newSelection.y1);
			needsScroll = !xVisible || !yVisible;
		}

		if (needsScroll) {
			const spacingX = Math.abs(app.calc.cellCursorRectangle.pWidth) / 4.0;
			const spacingY = Math.abs(app.calc.cellCursorRectangle.pHeight) / 2.0;
			let scrollX = 0, scrollY = 0;

			if (directionDownOrRight) {
				if (!xVisible)
					scrollX = newSelection.pX2 - viewedRectangle.pX2 + spacingX;

				if (!yVisible)
					scrollY = newSelection.pY2 - viewedRectangle.pY2 + spacingY;
			}
			else {
				if (!xVisible)
					scrollX = newSelection.pX1 - viewedRectangle.pX1 - spacingX;

				if (!yVisible)
					scrollY = newSelection.pY1 - viewedRectangle.pY1 - spacingY;
			}

			if (!this._map.wholeColumnSelected && !this._map.wholeRowSelected) {
				const address = document.querySelector('#addressInput input').value;
				if (!this._isWholeColumnSelected(address) && !this._isWholeRowSelected(address)) {
					// Reset previous scroll for cell selection message. Because cell selection already includes latest position (shouldn't accumulate).
					app.activeDocument.activeLayout.scrollProperties.moveBy = null;
					app.activeDocument.activeLayout.scroll(scrollX, scrollY);
				}
			}
		}
	},

	_onTextSelectionEndMsg: function (textMsg) {
		var rectangles = this._getTextSelectionRectangles(textMsg);

		if (rectangles.length) {
			var topLeftTwips = rectangles[0].getTopLeft();
			var bottomRightTwips = rectangles[0].getBottomRight();
			TextSelections.setEndRectangle(new cool.SimpleRectangle(topLeftTwips.x, topLeftTwips.y, (bottomRightTwips.x - topLeftTwips.x), (bottomRightTwips.y - topLeftTwips.y)));
		}
		else
			TextSelections.setEndRectangle(null);
	},

	_onTextSelectionStartMsg: function (textMsg) {
		var rectangles = this._getTextSelectionRectangles(textMsg);

		if (rectangles.length) {
			var topLeftTwips = rectangles[0].getTopLeft();
			var bottomRightTwips = rectangles[0].getBottomRight();
			TextSelections.setStartRectangle(new cool.SimpleRectangle(topLeftTwips.x, topLeftTwips.y, (bottomRightTwips.x - topLeftTwips.x), (bottomRightTwips.y - topLeftTwips.y)));
		}
		else
			TextSelections.setStartRectangle(null);
	},

	_refreshRowColumnHeaders: function () {
		if (app.sectionContainer.doesSectionExist(app.CSections.RowHeader.name))
			app.sectionContainer.getSectionWithName(app.CSections.RowHeader.name)._updateCanvas();
		if (app.sectionContainer.doesSectionExist(app.CSections.ColumnHeader.name))
			app.sectionContainer.getSectionWithName(app.CSections.ColumnHeader.name)._updateCanvas();
	},

	/*
	 * S6 -- THE CLEAR ON THE EMPTY MESSAGE IS PROVISIONAL, AND NOTHING USED TO
	 * MAKE IT SO.
	 *
	 * The line below says it in its own comment: the whole-axis flags are
	 * dropped "because a RowColSelCount message is on the way". That premise
	 * holds for a selection CHANGE and fails for a selection RESTATEMENT.
	 *
	 * Measured on the wire (round-10 R4b, p4-cols-and-wire.json): tapping an
	 * already-selected row header answers with
	 *
	 *     cellselectionarea: EMPTY          <- both flags cleared here
	 *     cellselectionarea: <the same rect> <- 1 ms later, identical
	 *
	 * and NO '.uno:RowColSelCount' statechanged at all, because the count did
	 * not change and core dedupes unchanged state. So the provisional clear
	 * became permanent, and it stayed permanent for the life of the selection.
	 *
	 * What that costs a finger, and why the owner said "resize not working on
	 * rows, period": the resize grip is drawn only while the whole-axis flag
	 * is set (Header.shouldDrawResizeGrip), and the widened phone hit band is
	 * keyed on the same predicate (Header._vulcanTappedResizeBand). With the
	 * flag stuck false the grip disappears from the canvas (pixel-verified,
	 * darkPct 45.3 -> 3.9) and the band collapses to the stock quarter-row --
	 * about 5 CSS px on a phone row. Re-tapping a header is what every human
	 * does when unsure the first tap landed, so the feature dies on the second
	 * tap. Columns survive it only because their stock fallback band is 15 CSS
	 * px, which a finger can still hit: that asymmetry is why the report names
	 * rows specifically.
	 *
	 * THE FIX RESTORES ONLY WHAT WAS TRUE ONE MESSAGE AGO, FOR A SELECTION
	 * THAT DID NOT CHANGE. The EMPTY branch remembers the flags together with
	 * the rectangle they described; the next non-empty message restores them
	 * if and only if it describes the SAME rectangle. A different rectangle is
	 * a real selection change and keeps the clear, which is the behaviour
	 * every other path shipped with -- and `_onRowColSelCount` remains the
	 * authority whenever core does restate, because it runs after and writes
	 * both flags outright. This invents no `true` that was not true 1 ms
	 * earlier for the identical selection, so it is not a second opinion about
	 * what is selected.
	 */
	_vulcanSelectionSignature: function (area) {
		return area ? area.x1 + ',' + area.y1 + ',' + area.width + ',' + area.height : null;
	},

	_onCellSelectionAreaMsg: function (textMsg) {
		var cellfillMarkerSection = app.sectionContainer.getSectionWithName(app.CSections.CellFillMarker.name);
		var strTwips = textMsg.match(/\d+/g);
		if (strTwips != null) {
			var topLeftTwips = new cool.Point(parseInt(strTwips[0]), parseInt(strTwips[1]));
			var offset = new cool.Point(parseInt(strTwips[2]), parseInt(strTwips[3]));
			var bottomRightTwips = topLeftTwips.add(offset);
			var boundsTwips = this._convertToTileTwipsSheetArea(new cool.Bounds(topLeftTwips, bottomRightTwips));

			var oldSelection = this._cellSelectionArea ? this._cellSelectionArea.clone(): null;
			const adjustedTwipsWidth = boundsTwips.max.x - boundsTwips.min.x;
			const adjustedTwipsHeight = boundsTwips.max.y - boundsTwips.min.y;
			this._cellSelectionArea = new cool.SimpleRectangle(boundsTwips.min.x, boundsTwips.min.y, adjustedTwipsWidth, adjustedTwipsHeight);

			// The restatement half of the provisional clear above. Consumed
			// whatever the answer, so a stale note can never outlive the one
			// message it was written for.
			var provisional = this._vulcanWholeAxisProvisional;
			this._vulcanWholeAxisProvisional = null;
			if (provisional &&
			    provisional.signature !== null &&
			    provisional.signature === this._vulcanSelectionSignature(this._cellSelectionArea)) {
				this._map.wholeColumnSelected = provisional.column;
				this._map.wholeRowSelected = provisional.row;
				if (this._refreshRowColumnHeaders)
					this._refreshRowColumnHeaders();
			}

			if (cellfillMarkerSection)
				cellfillMarkerSection.calculatePositionViaCellSelection([this._cellSelectionArea.pX2, this._cellSelectionArea.pY2]);

			this._updateScrollOnCellSelection(oldSelection, this._cellSelectionArea);

			CellSelectionMarkers.update();
		} else {
			this._vulcanWholeAxisProvisional = {
				column: !!this._map.wholeColumnSelected,
				row: !!this._map.wholeRowSelected,
				signature: this._vulcanSelectionSignature(this._cellSelectionArea),
			};
			this._cellSelectionArea = null;
			if (cellfillMarkerSection)
				cellfillMarkerSection.calculatePositionViaCellSelection(null);
			this._cellSelections = Array(0);
			this._map.wholeColumnSelected = false; // Message related to whole column/row selection should be on the way, we should update the variables now.
			this._map.wholeRowSelected = false;
			if (this._refreshRowColumnHeaders)
				this._refreshRowColumnHeaders();
		}
	},

	_onCellAutoFillAreaMsg: function (textMsg) {
		var strTwips = textMsg.match(/\d+/g);
		if (strTwips != null && this._map.isEditMode()) {
			var topLeftTwips = new cool.Point(parseInt(strTwips[0]), parseInt(strTwips[1]));
			var offset = new cool.Point(parseInt(strTwips[2]), parseInt(strTwips[3]));

			var topLeftPixels = this._twipsToCorePixels(topLeftTwips);
			var offsetPixels = this._twipsToCorePixels(offset);
			this._cellAutoFillAreaPixels = app.LOUtil.createRectangle(topLeftPixels.x, topLeftPixels.y, offsetPixels.x, offsetPixels.y);
		}
		else {
			this._cellAutoFillAreaPixels = null;
		}
	},

	_onDialogPaintMsg: function(textMsg, img) {
		var command = app.socket.parseServerCmd(textMsg);

		// app.socket.sendMessage('DEBUG _onDialogPaintMsg: hash=' + command.hash + ' img=' + typeof(img) + (typeof(img) == 'string' ? (' (length:' + img.length + ':"' + img.substring(0, 30) + (img.length > 30 ? '...' : '') + '")') : '') + ', cache size ' + this._pngCache.length);
		if (command.nopng) {
			var found = false;
			for (var i = 0; i < this._pngCache.length; i++) {
				if (this._pngCache[i].hash == command.hash) {
					found = true;
					// app.socket.sendMessage('DEBUG - Found in cache');
					img = this._pngCache[i].img;
					// Remove item (and add it below at the start of the array)
					this._pngCache.splice(i, 1);
					break;
				}
			}
			if (!found) {
				var message = 'windowpaint: message assumed PNG for hash ' + command.hash
				    + ' is cached here in the client but not found';
				if (window.L.Browser.cypressTest)
					throw new Error(message);
				app.socket.sendMessage('ERROR ' + message);
				// Not sure what to do. Ask the server to re-send the windowpaint: message but this time including the PNG?
			}
		} else {
			// Sanity check: If we get a PNG it should be for a hash that we don't have cached
			for (i = 0; i < this._pngCache.length; i++) {
				if (this._pngCache[i].hash == command.hash) {
					message = 'windowpaint: message included PNG for hash ' + command.hash
					    + ' even if it was already cached here in the client';
					if (window.L.Browser.cypressTest)
						throw new Error(message);
					app.socket.sendMessage('ERROR ' + message);
					// Remove the extra copy, code below will add it at the start of the array
					this._pngCache.splice(i, 1);
					break;
				}
			}
		}

		// If cache is max size, drop the last element
		if (this._pngCache.length == app.socket.TunnelledDialogImageCacheSize) {
			// app.socket.sendMessage('DEBUG - Dropping last cache element');
			this._pngCache.pop();
		}

		// Add element to cache
		this._pngCache.unshift({hash: command.hash, img:img});

		// app.socket.sendMessage('DEBUG - Cache size now ' + this._pngCache.length);

		this._map.fire('windowpaint', {
			id: command.id,
			img: img,
			width: command.width,
			height: command.height,
			rectangle: command.rectangle,
			hash: command.hash
		});
	},

	_onDialogMsg: function(textMsg) {
		textMsg = textMsg.substring('window: '.length);
		var dialogMsg = JSON.parse(textMsg);
		// e.type refers to signal type
		dialogMsg.winType = dialogMsg.type;
		this._map.fire('window', dialogMsg);
	},

	_mapOnError: function (e) {
		if (e.msg && this._map.isEditMode() && e.critical !== false) {
			this._map.setPermission('view');
		}
	},

	_clearSelections: function (calledFromSetPartHandler) {
		// hide the cursor if not editable
		this._onUpdateCursor(calledFromSetPartHandler);
		// hide the text selection
		app.activeDocument.activeView.clearTextSelection();
		// hide the ole selection
		this._oleCSelections.clear();

		this._onUpdateCellCursor();
		if (this._map._clip)
			this._map._clip.clearSelection();
		else
			this._selectedTextContent = '';
	},

	_clearReferences: function () {
		this._references.clear();
	},

	_resetReferencesMarks: function (type) {
		this._clearReferences();

        if (type === undefined)
		    this._referencesAll = [];
        else if (type === 'focuscell')
            this._referencesAll = this._referencesAll.filter(function(e) { return e.type !== 'focuscell' });

		this._updateReferenceMarks();
	},

	_postMouseEvent: function(type, x, y, count, buttons, modifier) {
		if (!this._map._docLoaded)
			return;

		if (this._map.calcInputBarHasFocus() && type === 'move') {
			// When the Formula-bar has the focus, sending
			// mouse move with the document coordinates
			// hides the cursor (lost focus?). This is clearly
			// a bug in Core, but we need to work around it
			// until fixed. Just don't send mouse move.
			return;
		}

		const verticalOffset = this.getFiledBasedViewVerticalOffset();
		if (verticalOffset) {
			y -= verticalOffset;
		}

		if (this._map.contextToolbar)
			this._map.contextToolbar.setLastInputEventType({input: "mouse", type: type});

		app.socket.sendMessage('mouse type=' + type +
				' x=' + x + ' y=' + y + ' count=' + count +
				' buttons=' + buttons + ' modifier=' + modifier);


		const tempPageLinks = this._map['stateChangeHandler'].getItemValue('PageLinks');
		const thereArePageLinks =  tempPageLinks && tempPageLinks.length > 0;
		if (type === 'buttonup' && thereArePageLinks) {
			URLPopUpSection.closeURLPopUp();
			for (const link of this._map['stateChangeHandler'].getItemValue('PageLinks')) {
				if (link.rectangle.containsPoint([x, y])) {
					URLPopUpSection.showURLPopUP(link.uri, new cool.SimplePoint(x, y + this.getFiledBasedViewVerticalOffset()), undefined, /*linkIsClientSide:*/true);
				}
			}
		}

		if (type === 'move' && thereArePageLinks) {
			let overLink = false;
			for (const link of tempPageLinks) {
				if (link.rectangle.containsPoint([x, y])) {
					overLink = true;
					break;
				}
			}
			const canvas = document.getElementById('document-canvas');
			if (overLink) {
				if (canvas && canvas.style.cursor !== 'pointer')
					canvas.style.cursor = 'pointer';
			} else if (canvas && canvas.style.cursor === 'pointer') {
				canvas.style.cursor = '';
			}
		}

		if (type === 'buttondown')
			this._clearSearchResults();

		if (this._map && this._map._docLayer && (type === 'buttondown' || type === 'buttonup'))
			this._map.userList.followUser(this._map._docLayer._getViewId(), false);
	},

	// If viewing multi-page PDF files, get the twips offset of the current part. This is
	// needed, because core has multiple draw pages in such a case, but we have just one canvas.
	getFiledBasedViewVerticalOffset: function() {
		if (!app.file.fileBasedView) {
			return;
		}

		const additionPerPart = this._partHeightTwips + this._spaceBetweenParts;
		const verticalOffset = additionPerPart * this._selectedPart;

		return verticalOffset;
	},

	// If viewing multi-page PDF files, no precise tracking of invalidations is implemented yet,
	// so this allows requesting new tiles when we know a viewed PDF changes for some special
	// reason.
	requestNewFiledBasedViewTiles: function() {
		if (!app.file.fileBasedView) {
			return;
		}

		this._requestNewTiles();
		RenderManager.redraw();
	},

	// Given a character code and a UNO keycode, send a "key" message to coolwsd.
	//
	// "type" is either "input" for key presses (akin to the DOM "keypress"
	// / "beforeinput" events) and "up" for key releases (akin to the DOM
	// "keyup" event).
	//
	// PageUp/PageDown and select column & row are handled as special cases for spreadsheets - in
	// addition of sending messages to coolwsd, they move the cell cursor around.
	postKeyboardEvent: function(type, charCode, unoKeyCode) {
		if (!this._map._docLoaded)
			return;

		if (window.L.Browser.mac) {
			// Map Mac standard shortcuts to the LO shortcuts for the corresponding
			// functions when possible. Note that the Cmd modifier comes here as CTRL.

			// Cmd+UpArrow -> Ctrl+Home
			if (unoKeyCode == UNOKey.UP + app.UNOModifier.CTRL)
				unoKeyCode = UNOKey.HOME + app.UNOModifier.CTRL;
			// Cmd+DownArrow -> Ctrl+End
			else if (unoKeyCode == UNOKey.DOWN + app.UNOModifier.CTRL)
				unoKeyCode = UNOKey.END + app.UNOModifier.CTRL;
			// Cmd+LeftArrow -> Home
			else if (unoKeyCode == UNOKey.LEFT + app.UNOModifier.CTRL)
				unoKeyCode = UNOKey.HOME;
			// Cmd+RightArrow -> End
			else if (unoKeyCode == UNOKey.RIGHT + app.UNOModifier.CTRL)
				unoKeyCode = UNOKey.END;
			// Option+LeftArrow -> Ctrl+LeftArrow
			else if (unoKeyCode == UNOKey.LEFT + app.UNOModifier.ALT)
				unoKeyCode = UNOKey.LEFT + app.UNOModifier.CTRL;
			// Option+RightArrow -> Ctrl+RightArrow (Not entirely equivalent, should go
			// to end of word (or next), LO goes to beginning of next word.)
			else if (unoKeyCode == UNOKey.RIGHT + app.UNOModifier.ALT)
				unoKeyCode = UNOKey.RIGHT + app.UNOModifier.CTRL;
		}

		var completeEvent = app.socket.createCompleteTraceEvent('L.TileSectionManager.postKeyboardEvent', { type: type, charCode: charCode });

		if (this._map.contextToolbar)
			this._map.contextToolbar.setLastInputEventType({input: "key", type: type});
		var winId = this._map.getWinId();
		if (
			this.isCalc() &&
			type === 'input' &&
			winId === 0
		) {
			if (unoKeyCode === UNOKey.SPACE + app.UNOModifier.CTRL) { // Select whole column.
				this._map.wholeColumnSelected = true;
			}
			else if (unoKeyCode === UNOKey.SPACE + app.UNOModifier.SHIFT) { // Select whole row.
				this._map.wholeRowSelected = true;
			}
		}

		if (winId === 0) {
			app.socket.sendMessage(
				'key' +
				' type=' + type +
				' char=' + charCode +
				' key=' + unoKeyCode +
				'\n'
			);
		} else {
			app.socket.sendMessage(
				'windowkey id=' + winId +
				' type=' + type +
				' char=' + charCode +
				' key=' + unoKeyCode +
				'\n'
			);
		}
		// Vulcan: Calc echoes (cell text and cell cursor) observe document
		// key sends, AFTER the socket write; the cursor echo first, as in
		// TextInput._sendKeyEvent.
		if (winId === 0 && app.definitions) {
			if (app.definitions.vulcanCalcCursorEcho)
				app.definitions.vulcanCalcCursorEcho.onKey(charCode, unoKeyCode, type);
			if (app.definitions.vulcanCalcTextEcho)
				app.definitions.vulcanCalcTextEcho.onKey(charCode, unoKeyCode, type);
		}
		if (completeEvent)
			completeEvent.finish();
	},

	_postSelectTextEvent: function(type, x, y) {
		app.socket.sendMessage('selecttext type=' + type +
				' x=' + x + ' y=' + y);
	},

	_onZoomStart: function () {
		this._isZooming = true;
	},


	_onZoomEnd: function () {
		this._isZooming = false;
		app.sectionContainer.setPostZoomReplay(true);
		if (!this.isCalc())
			this._replayPrintTwipsMsgs(false);
		app.sectionContainer.setPostZoomReplay(false);
		this._onUpdateCursor(null, true);
		TextCursorSection.updateVisibilities();
	},

	_updateCursorPos: function () {
		if (!this._cursorMarker) {
			this._cursorMarker = new Cursor(app.file.textCursor.rectangle.clone(), this._map, { blink: true });
		} else {
			this._cursorMarker.setRectangle(app.file.textCursor.rectangle.clone());
		}
	},

	goToTarget: function(target) {
		var command = {
			'Name': {
				type: 'string',
				value: 'URL'
			},
			'URL': {
				type: 'string',
				value: '#' + target
			}
		};

		this._map.sendUnoCommand('.uno:OpenHyperlink', command);
	},

	_allowViewJump: function() {
		return (!this._map._clip || this._map._clip._selectionType !== 'complex');
	},

	// Scrolls the view to selected position
	scrollToPos: function(pos) {
		// The multipage layout arranges pages in a grid and its scrollTo() takes a
		// document point, locates the page containing it and brings that page into
		// view. Pass the document point straight to the layout.
		if (pos instanceof cool.SimplePoint &&
			app.activeDocument.activeLayout.type === 'ViewLayoutMultiPage') {
			app.activeDocument.activeLayout.scrollTo(pos.pX, pos.pY);
			return;
		}

		if (pos instanceof cool.SimplePoint) // Turn into lat/lng if required (pos may also be a simplePoint.).
			pos = this._twipsToIntern({ x: pos.x, y: pos.y });

		var center = this._map.project(pos);

		let needsXScroll = false;
		let needsYScroll = false;
		const CSSPixelsToTwips = app.dpiScale * app.pixelsToTwips;

		// If x coordinate is already within visible area, we won't scroll to that direction.
		if (app.isXVisibleInTheDisplayedArea(Math.round(center.x * CSSPixelsToTwips)))
			center.x = app.activeDocument.activeLayout.viewedRectangle.cX1;
		else {
			center.x -= this._map.getSize().divideBy(2).x;
			center.x = Math.round(center.x < 0 ? 0 : center.x);
			needsXScroll = true;
		}

		// If y coordinate is already within visible area, we won't scroll to that direction.
		const controlYDown = center.y + (app.file.textCursor.visible ? app.file.textCursor.rectangle.cHeight :
			(app.calc.cellCursorVisible ? app.calc.cellCursorRectangle.cHeight : 0));

		const controlYUp = center.y - (app.file.textCursor.visible ? app.file.textCursor.rectangle.cHeight :
			(app.calc.cellCursorVisible ? app.calc.cellCursorRectangle.cHeight : 0));

		if (app.isYVisibleInTheDisplayedArea(Math.round(controlYDown * CSSPixelsToTwips)) && app.isYVisibleInTheDisplayedArea(Math.round(controlYUp * CSSPixelsToTwips)))
			center.y = app.activeDocument.activeLayout.viewedRectangle.cY1;
		else {
			center.y -= this._map.getSize().divideBy(2).y;
			center.y = Math.round(center.y < 0 ? 0 : center.y);
			needsYScroll = true;
		}

		if (needsXScroll || needsYScroll) {
			const section = app.sectionContainer.getSectionWithName(app.CSections.Scroll.name);
			if (section) {
				section.onScrollTo({x: center.x * app.dpiScale, y: center.y * app.dpiScale});
			}
		}
	},

	// Scroll the view by an amount given by a simplePoint
	scrollByPoint: function(offset) {
		this._map.fire('scrollby', {x: offset.cX, y: offset.cY});
	},

	// Update cursor layer (blinking cursor).
	_onUpdateCursor: function (scroll, zoom, keepCaretPositionRelativeToScreen) {

		if (this._map.ignoreCursorUpdate()) {
			return;
		}

		// While a reconnect view restore is pending, scroll straight to the
		// saved offset and clear the pending state. The multipage layout's
		// scrollTo expects a document point, not a viewport top-left, so there
		// the normal cursor path below runs instead.
		if (this._restoringViewScroll && this._savedScrollPos &&
			app.activeDocument.activeLayout.type !== 'ViewLayoutMultiPage') {
			app.activeDocument.activeLayout.scrollTo(this._savedScrollPos.pX1, this._savedScrollPos.pY1);
			this._restoringViewScroll = false;
			this._savedScrollPos = null;
			this._updateCursorAndOverlay();
			TextCursorSection.updateVisibilities();
			return;
		}

		if (!app.file.textCursor.visible && !GraphicSelection.hasActiveSelection()) {
			this._updateCursorAndOverlay();
			TextCursorSection.updateVisibilities();
			return;
		}

		if (!zoom
		&& scroll !== false
		&& (app.file.textCursor.visible || GraphicSelection.hasActiveSelection())
		// Do not center view in Calc if no new cursor coordinates have arrived yet.
		// ie, 'invalidatecursor' has not arrived after 'cursorvisible' yet.
		&& (!this.isCalc() || (this._lastVisibleCursorRef && !this._lastVisibleCursorRef.equals(app.file.textCursor.rectangle.toArray())))
		&& this._allowViewJump()) {

			// Cursor invalidation should take most precedence among all the scrolling to follow the cursor
			// so here we disregard all the pending scrolling
			app.sectionContainer.getSectionWithName(app.CSections.Scroll.name).pendingScrollEvent = null;
			var correctedCursor = app.file.textCursor.rectangle.clone();

			if (this.isWriter()) {
				// For Writer documents, disallow scrolling to cursor outside of the page (horizontally)
				// Use document dimensions to approximate page width
				correctedCursor.x1 = clamp(correctedCursor.x1, 0, app.activeDocument.activeLayout.viewSize.x);
				correctedCursor.x2 = clamp(correctedCursor.x2, 0, app.activeDocument.activeLayout.viewSize.x);
			}

			if (!app.isPointVisibleInTheDisplayedArea(new cool.SimplePoint(correctedCursor.x1, correctedCursor.y1).toArray()) ||
				!app.isPointVisibleInTheDisplayedArea(new cool.SimplePoint(correctedCursor.x2, correctedCursor.y2).toArray())) {
				if (app.isFollowingUser() && app.getFollowedViewId() === this._viewId && !this._map.calcInputBarHasFocus()) {
					this.scrollToPos(new cool.SimplePoint(correctedCursor.x1, correctedCursor.y1));
				}
			}
		}
		else if (keepCaretPositionRelativeToScreen) {
			/* We should be here when:
				Another view updated the text.
				That edit changed our cursor position.
			Now we already set the cursor position to another point.
			We want to keep the cursor position at the same point relative to screen.
			Do that only when we are reaching the end of screen so we don't flicker.
			*/
			var that = this;

			var isCursorVisible = app.isPointVisibleInTheDisplayedArea(app.file.textCursor.rectangle.toArray());

			if (!isCursorVisible) {
				setTimeout(function () {
					var y = app.file.textCursor.rectangle.pY1 - that._cursorPreviousPositionCorePixels.pY1;
					if (y) {
						app.sectionContainer.getSectionWithName(app.CSections.Scroll.name).scrollVerticalWithOffset(y);
					}
				}, 0);
			}
		}

		this._updateCursorAndOverlay();

		TextCursorSection.updateVisibilities();
	},

	activateCursor: function () {
		this._replayPrintTwipsMsg('invalidatecursor');
	},

	// enable or disable blinking cursor and the cursor overlay depending on
	// the state of the document (if the flags are set)
	/*
		VULCAN (lane B, pending UI-B-004 option B): on an Android phone, a
		double tap on a PICTURE in a slide leaves the keyboard down. A double
		tap on a shape, a text box or a table I can type in brings it up,
		EMPTY or not, and so does typing in a title.

		Why a picture gets a caret at all: core's double click on a selected
		object it can text-edit dispatches SID_TEXTEDIT (sd FuDraw::DoubleClick,
		fudraw.cxx:670-679), and a graphic is one (SdrGrafObj : SdrRectObj,
		svdograf.hxx:67; SdrRectObj : SdrTextObj, svdorect.hxx:38). So core
		opens text edit INSIDE the picture, and this caret path's focus(true)
		raised the Android keyboard over the picture and left it up (redroid,
		lane-b runs/run2/pic-dtap).
		Google Slides edits no text on a picture.

		The test is the object's KIND, never its text. Core writes
		extraInfo.type = the SdrObjKind of the selected object
		(svdmrkv.cxx:1018-1022; include/svx/svdobjkind.hxx: Graphic 22, OLE2
		23, CustomShape 33, Media 34, Table 35). Measured on the device: a PNG
		picture is type 22, a text box 33, a table 35 (runs/run2/pic-kind/k1,
		runs/run2/table-kind/tk1). Only 22 counts: a chart or other OLE object
		(23) is activated by the double click, not given a caret
		(fudraw.cxx:653-661), and media (34) has no text edit
		(svdomedia.cxx:96). NOT innerTextRect: core writes it only for an
		object that already HAS rendered text (CreateInnerTextRectString,
		svdmrkv.cxx:878-901), so an empty rectangle, text box or new table has
		none, and keying on it (4ceee1422a) gave a double tap into an empty
		shape a caret with no keyboard. innerTextRect may only ADD a keyboard:
		a picture that already holds typed text (a graphic can, in an .odp
		authored on the desktop) names it, and keeps the keyboard IF a caret
		opens in it. On a phone a double tap no longer opens one in a picture
		at all (UI-B-004, Google's path: VulcanImpressOverlap.isTextlessKind
		stops the count 2), so that text is not reachable by double tap on a
		phone. That covers core's payload BEFORE the edit only:
		mid-edit, core may suppress the picture's text primitives
		(sdrdecompositiontools.cxx:843-851, texthierarchyprimitive2d.cxx:153-159),
		so a resend can drop innerTextRect, and the keyboard may then go after
		the 2 s hold (unmeasured on the device). A RASTER picture's own pixels
		never name it (TextExtractor2D skips bitmap, metafile and mask
		primitives, textextractor2d.cxx:61-69), but an SVG/EMF/WMF vector
		picture with drawn text can: it decomposes into text primitives the
		extractor walks (graphicprimitivehelper2d.cxx:628-652), so it names
		innerTextRect and keeps the keyboard. A known gap.

		B-0288: while I type in the eval deck's slide-1 title, core reports the
		slide-sized background (OrdNum 0) as the selection for the rest of the
		edit (runs/run2/b0288 t13, g1), and the caret is in another object
		(MouseControl.vulcanImpressCaretHolder). A selection that covers the
		whole slide therefore never counts, even when it is a picture.

		Android host only (TextInput's B-0094 gate), phone Impress only: the
		iPhone and every other doctype keep focus(true). Both routes that turn
		a caret into a keyboard ask this (here and
		GraphicSelection.updateGraphicSelection), and so does
		ShapeHandlesSection.onDoubleClick's keyboard door, so the door never
		raises a keyboard this takes back, nor stays shut for a caret it keeps
		(the door also stays shut for a chart, audio, and a group with no
		text, where core opens no caret, except a single-member group whose
		member core marks: see onDoubleClick).
	*/
	_vulcanCaretInTextlessObject: function () {
		if (!window.vulcanPhoneChrome || !this.isImpress()) return false;
		var ti = this._map._textInput;
		if (!ti || typeof ti.vulcanAndroidKeyboardBranch !== 'function' || !ti.vulcanAndroidKeyboardBranch())
			return false;
		if (typeof GraphicSelection === 'undefined' || !GraphicSelection.hasActiveSelection())
			return false;
		var extraInfo = GraphicSelection.extraInfo;
		// A picture is SdrObjKind::Graphic (22) holding no text of its own.
		if (!extraInfo || extraInfo.type !== 22 || extraInfo.innerTextRect)
			return false;
		var selection = GraphicSelection.rectangle;
		if (typeof VulcanImpressOverlap === 'undefined' || VulcanImpressOverlap.coversWholeSlide(
			[selection.x1, selection.y1, selection.x2, selection.y2], this._partWidthTwips, this._partHeightTwips))
			return false;
		return true;
	},

	_updateCursorAndOverlay: function (/*update*/) {
		if (app.file.textCursor.visible   // only when COKit has told us it is ok
			&& this._map.editorHasFocus()   // not when document is not focused
			&& !this._map.isSearching()  	// not when searching within the doc
			&& !this._isZooming             // not when zooming
			&& this._map._permission !== 'readonly' // not when we don't have permission to edit
		) {
			this._updateCursorPos();

			var scrollSection = app.sectionContainer.getSectionWithName(app.CSections.Scroll.name);
			if (!scrollSection.sectionProperties.mouseIsOnVerticalScrollBar && !scrollSection.sectionProperties.mouseIsOnHorizontalScrollBar) {
				this._map._textInput.showCursor();
			}

			var hasMobileWizardOpened = this._map.uiManager.mobileWizard ? this._map.uiManager.mobileWizard.isOpen() : false;
			var hasIframeModalOpened = $('.iframe-dialog-modal').is(':visible');
			// VULCAN: core's cursor is no gesture in this
			// frame. Edit-mode entry (updatepermission -> updateGraphicSelection
			// -> here), at load and at a reload the server ordered, took the
			// keyboard from the host page, and what the person pasted or typed
			// into the agent composer went into the document as their own saved
			// edit. While the host owns the keyboard (Vulcan_FocusPolicy, or the
			// embedded default Map.initialize sets) and this frame does not hold
			// it, the caret is drawn but focus stays where it is. The policy
			// test comes first so rigs that lift this method over a stub map
			// never read `document`.
			var vulcanKeyboardInHost = this._map._vulcanAutoFocusOnLoad === false && !document.hasFocus();
			// Don't show the keyboard when the Wizard is visible, or when we have just been in a zoom
			if (!vulcanKeyboardInHost && !window.mobileWizard && !window.pageMobileWizard &&
				!window.insertionMobileWizard && !hasMobileWizardOpened &&
				!JSDialog.IsAnyInputFocused() && !hasIframeModalOpened && !app.sectionContainer.isPostZoomReplay()) {
				// If the user is editing, show the keyboard, but don't change
				// anything if nothing is changed.

				// We will focus map if no comment is being edited (writer only for now).
				if (this.isWriter()) {
					var section = app.sectionContainer.getSectionWithName(app.CSections.CommentList.name);
					if (!section || !section.sectionProperties.selectedComment || !section.sectionProperties.selectedComment.isEdit())
						this._map.focus(true);
				}
				// A caret core opened inside a picture takes focus WITHOUT the
				// Android keyboard (see _vulcanCaretInTextlessObject).
				// UI-B-004: a double tap on an object painted above the selected
				// photo opens the keyboard door (ShapeHandlesSection.onDoubleClick)
				// before core says what that object is. When it is a picture too (a
				// logo), core opens its caret in it, and the door's 2 s hold
				// (TextInput.focus) would swallow this focus(false): a caret in the
				// logo with the keyboard up. Ending the door's hold here takes the
				// keyboard down. It runs only on this branch, where the caret is in
				// a picture; a caret in text takes focus(true) below and keeps the
				// hold.
				else if (this._vulcanCaretInTextlessObject()) {
					this._map._textInput._vulcanImpressDoorAt = 0;
					this._map.focus(false);
				}
				else
					this._map.focus(true);
			}
		} else {
			this._map._textInput.hideCursor();
			// VULCAN: THE UNLATCH ARM ONLY EVER RAN ON IMPRESS. The stock
			// `_preview && !_preview.partsFocused` term asks "the parts
			// preview is not what holds focus", but `_preview` is assigned in
			// exactly one place in the tree (ImpressTileLayer), so on Calc and
			// Writer it is undefined, the whole term is falsy, and core saying
			// the cursor is gone never reached focus(false) at all. On the
			// phone chrome that is the leak: the edit ends, the caret is
			// hidden, and _acceptInput stays latched true for the next zoom
			// settle to replay as a real keyboard raise. Read the term for
			// what it means -- no parts preview cannot be a parts preview
			// holding focus -- and only where the leak has a cost, so desktop
			// and tablet keep the arm exactly as dead as upstream shipped it.
			var vulcanNoPartsPreview = window.vulcanPhoneChrome && !this._map._docLayer._preview;
			// VULCAN: ...BUT NOT WHILE A COMMIT-AND-ADVANCE IS IN FLIGHT.
			// Map._onEditorGotFocus reaches this method through
			// _changeFocusWidget BEFORE it ends the cell edit session, so the
			// arm above gets to answer the keyboard question first -- and on
			// the Return commit-and-advance it answers the opposite of what
			// that site decides one line later (dismissKeyboard:false, so a
			// serial data-entry run keeps typing). Measured: Enter committed,
			// the cursor advanced a row, and activeElement was left on BODY.
			// Ask it the way that site asks it, so the two agree instead of
			// racing: the live-edit marker says the session end has not run
			// yet, and a Return verb that is NOT a newline says this arrival
			// is the advance rather than a tap-away out of a door-opened
			// edit. Whatever the session end then decides stands, its own
			// dismissal included. The latch test comes FIRST so the door
			// site's absence short-circuits before `document` is read -- the
			// extraction rigs lift these statements into a bare vm context.
			var vulcanReturnKey = window.vulcanPhoneChrome ? window.VulcanCalcReturnKey : null;
			var vulcanAdvanceInFlight = !!vulcanReturnKey &&
				!vulcanReturnKey.returnInsertsNewline() &&
				document.documentElement.classList.contains('vulcan-formula-editing');
			// VULCAN (VO-P-0022): ...NOR WHILE A GESTURE-OPENED DOOR IS IN
			// FLIGHT. The phone Calc double tap raises the keyboard inside tap
			// 2's click and core answers the count-2 with cellcursor ->
			// invalidatecursor -> cursorvisible; the first two reach this arm
			// from message context while the caret is still hidden (cellcursor
			// through _onUpdateCellCursor's 'editorgotfocus' fire, because the
			// editable now holds focus). A cursor-gone inside the edit-intent
			// window a gesture stamped is that round trip, not an edit that
			// ended -- measured on the served fork under WebKit: each pass ran
			// focus(false) -> dismissSoftKeyboard (blur, window zeroed), so
			// the caret's own focus(true) at cursorvisible was vetoed and
			// focused edit opened with no keyboard. Ask the window's owner,
			// TextInput.vulcanGestureDoorInFlight: bounded by the window, false
			// for a live gesture (tap 2's own fire still dismisses; the raise
			// after it re-stamps), false outside phone Calc. The existence
			// test is real, as for dismissSoftKeyboard's callers: the
			// extraction rigs lift these statements over a stub _textInput.
			var vulcanDoorInput = window.vulcanPhoneChrome ? this._map._textInput : null;
			var vulcanDoorInFlight = !!vulcanDoorInput && !!vulcanDoorInput.vulcanGestureDoorInFlight &&
				vulcanDoorInput.vulcanGestureDoorInFlight();
			// VULCAN (B-0099/B-0100/B-0102): ...NOR WHILE QUICK ENTRY HOLDS THE
			// KEYBOARD. An edit that ended with the keyboard kept (the Return
			// commit-and-advance, a tap on another cell) leaves it up over a
			// selected cell on purpose, and this arm's next caret-less pass
			// (the first key's answer, a resize ~3 s later) dropped it mid-run.
			// TextInput.vulcanQuickEntryHolds: Android, phone Calc, released by
			// every deliberate exit. The existence test as for the door above.
			var vulcanQuickEntryHeld = !!vulcanDoorInput && !!vulcanDoorInput.vulcanQuickEntryHolds &&
				vulcanDoorInput.vulcanQuickEntryHolds();
			// VULCAN: ...NOR WHILE THE HOST PAGE HOLDS THE KEYBOARD
			// (the same test as for the caret above). Off the phone this
			// focus(false) is a real focus: a deck that loaded while the person
			// typed in the agent composer took the keyboard here. On the phone
			// it takes none and only releases the keyboard latch, so the phone
			// keeps it. The phone and policy tests come first for the rigs that
			// lift this arm alone.
			var vulcanHostKeepsKeyboard = !window.vulcanPhoneChrome &&
				this._map._vulcanAutoFocusOnLoad === false && !document.hasFocus();
			// Maintain input if a dialog or search-box has the focus.
			if (this._map.editorHasFocus() && !this._map.uiManager.isAnyDialogOpen() && !this._map.isSearching()
				&& !JSDialog.IsAnyInputFocused() && !vulcanAdvanceInFlight && !vulcanDoorInFlight && !vulcanQuickEntryHeld
				&& !vulcanHostKeepsKeyboard
				&& (vulcanNoPartsPreview || (this._map._docLayer._preview && !this._map._docLayer._preview.partsFocused)))
				this._map.focus(false);
		}

		if (app.map._textInput && app.activeDocument)
			app.map._textInput.update();

		// when first time we updated the cursor - document is loaded
		// let's move cursor to the target
		if (this._map.options.docTarget !== '') {
			this.goToTarget(this._map.options.docTarget);
			this._map.options.docTarget = '';
		}
	},

	// Jump to view of user with given *viewId*
	goToOtherUserView: function(viewId) {
		const graphicSection = OtherViewGraphicSelectionSection.getViewSection(viewId);

		if (graphicSection) {
			if (this._selectedPart !== graphicSection.sectionProperties.part) {
				this._map.deselectAll();
				this._map.setPart(graphicSection.sectionProperties.part);
			}
			graphicSection.goToSection();
		}
	},

	goToViewCursor: function(viewId) {
		if (viewId === this._viewId) {
			this._onUpdateCursor();
			return;
		}

		const section = TextCursorSection.getViewCursorSection(viewId);

		if (section) {
			if ((this.isImpress() || this.isDraw()) && this._selectedPart !== section.sectionProperties.part) {
				this._map.deselectAll();
				this._map.setPart(section.sectionProperties.part);
			}

			if (section.showSection) {
				section.goToSection();
				app.definitions.cursorHeaderSection.showCursorHeader(viewId);
			}
		}
	},

	eachView: function (views, method, context, item) {
		for (var key in views) {
			method.call(context, item ? views[key] : key);
		}
	},

	// TODO: used only in calc: move to CalcTileLayer
	_onUpdateCellCursor: function (scrollToCursor, sameAddress, addressUnchanged) {
		CellSelectionMarkers.update();

		if (app.calc.cellCursorVisible) {
			if (scrollToCursor &&
			    !this._map.calcInputBarHasFocus()) {
				const scroll = this._calculateScrollForNewCellCursor();
				if (scroll.x !== 0 || scroll.y !== 0) {
					// ORDER IS LOAD-BEARING: read scroll.pX/pY BEFORE the two
					// += lines below. Until then `scroll` is a RELATIVE delta,
					// which is what vulcanSmoothScrollBy wants; the += turn it
					// into an absolute document position for scrollTo.
					// The section refuses hops longer than four lines, refuses
					// entirely off-phone, and refuses while another section
					// holds the container's single animation slot (it cannot
					// pay the delta out then), so every other case and every
					// other device falls straight through to the stock teleport.
					const scrollSection = app.sectionContainer.getSectionWithName(app.CSections.Scroll.name);
					const smoothed = !!(scrollSection && scrollSection.vulcanSmoothScrollBy
						&& scrollSection.vulcanSmoothScrollBy(scroll.pX, scroll.pY));
					if (!smoothed) {
						scroll.x += app.activeDocument.activeLayout.viewedRectangle.x1;
						scroll.y += app.activeDocument.activeLayout.viewedRectangle.y1;
						app.activeDocument.activeLayout.scrollTo(scroll.pX, scroll.pY);
					}
				}

				this._prevCellCursorAddress = app.calc.cellAddress.clone();
			}

			this._addCellDropDownArrow();

			var focusOutOfDocument = document.activeElement === document.body;
			var dontFocusDocument = JSDialog.IsAnyInputFocused() || focusOutOfDocument;
			var dontStealFocus = sameAddress && this._map.calcInputBarHasFocus();
			// VULCAN: THE PHONE CELL EDITOR GREW; THE CURSOR DID NOT MOVE.
			// Phone Calc edits in the cell (#clipboard-area, the map's text
			// input), not in the formula-bar input, so the stock guard above
			// never matches it. While that edit is live, core answers the
			// keystroke that makes the text wider than its column with a
			// cellcursor for the SAME cell and a wider rectangle. Firing
			// 'editorgotfocus' for it ended the edit mid-word
			// (Map._onEditorGotFocus -> vulcanEndCellEditSession): the keyboard
			// dropped and the next keystrokes landed on the grid -- measured in
			// desktop Chromium at 360x683 and on Android, 3-7 of 20 typed
			// characters lost, while a text that still fits kept the edit
			// (mocha_tests/CalcPhoneCellEditGrows.test.ts). A cursor that
			// moved still fires, and off the phone or outside a live edit
			// nothing changes. The existence test on _vulcanPhoneChrome is real:
			// the extraction rigs lift this block over a stub `this`.
			// `addressUnchanged`, not `sameAddress`: the caller passes notJump
			// as sameAddress, which is also true for a cursor that moved once
			// the member panned it out of view (own-cursor following off), and
			// that move must still end the edit. And a same cell right after a
			// Return that commits is core answering a commit that could not
			// move the cursor (last row or column, "Enter moves selection"
			// off), which must end the edit too (VulcanCalcReturnKey.ts).
			var vulcanCellEditGrew = addressUnchanged &&
				!!this._vulcanPhoneChrome && this._vulcanPhoneChrome() &&
				document.documentElement.classList.contains('vulcan-formula-editing') &&
				!!this._map._textInput && this._map._textInput.hasFocus() &&
				!(window.VulcanCalcReturnKey && window.VulcanCalcReturnKey.commitReturnPending());
			dontFocusDocument = dontFocusDocument || dontStealFocus || vulcanCellEditGrew;

			// when the cell cursor is moving, the user is in the document,
			// and the focus should leave the cell input bar
			// exception: when dialog opened don't focus the document
			if (!dontFocusDocument)
				this._map.fire('editorgotfocus');
			// VULCAN: A STAMPED EDIT WITH NOTHING FOCUSED IS A STRANDED EDIT.
			//
			// 'editorgotfocus' is the ONLY thing that ends a phone-Calc cell
			// edit on the Return commit-and-advance route -- Map._onEditorGotFocus
			// -> vulcanEndCellEditSession -> onFormulaBarBlur is what drops
			// vulcan-formula-editing, drops vulcan-chrome-hidden, re-emits the
			// posture and clears the Return-verb latch. And the guard above
			// suppresses that fire exactly when `document.activeElement` is
			// `document.body`, i.e. when nothing at all holds focus.
			//
			// Those two facts meet on the one route that matters. Measured on
			// device: Enter in B2 committed and advanced to B3, focus left
			// #clipboard-area, and vulcan-formula-editing + vulcan-chrome-hidden
			// stayed stamped for the rest of the session -- keyboard gone, sheet
			// strip gone, host chrome still withdrawn, ✕/✓ still in the fx bar,
			// the escape ladder still claiming a live edit. The ✓ path is fine
			// because docdispatcher calls vulcanEndCellEditSession outright;
			// only this route depends on a focus test to notice.
			//
			// The invariant is flat: vulcan-formula-editing CLAIMS a live cell
			// editor, and activeElement === body says there is none. Both cannot
			// be true, and the cursor answer is when we learn it. So end the
			// session here instead -- the same call the fire would have reached,
			// minus the focus grab this branch exists to avoid.
			//
			// dismissKeyboard:false, matching what Map._onEditorGotFocus passes
			// for this same gesture: nothing holds focus, so on a phone there is
			// no keyboard left to collapse, and serial entry must never lose one
			// mid-run. The cell stays ENGAGED -- vulcan-calc-edit-ready is
			// monotone and untouched here -- so this lands in EDIT-READY, one
			// tap from the next edit, which is the honest reading of a screen
			// with no editor on it.
			//
			// Idempotent by construction: the marker is what arms it, and the
			// first thing the call does is clear the marker.
			else if (focusOutOfDocument &&
			         this.isCalc() && this._vulcanPhoneChrome() &&
			         document.documentElement.classList.contains('vulcan-formula-editing'))
				this._map.vulcanEndCellEditSession({ dismissKeyboard: false });
		}

		this._removeCellDropDownArrow();
		URLPopUpSection.closeURLPopUp();
	},

	_onValidityListButtonMsg: function(textMsg) {
		var strXY = textMsg.match(/\d+/g);
		var validatedCellAddress = new cool.SimplePoint(parseInt(strXY[0]), parseInt(strXY[1])); // Cell address of the validity list.
		var show = parseInt(strXY[2]) === 1;
		if (show) {
			if (this._validatedCellAddress && !validatedCellAddress.equals(this._validatedCellAddress.toArray())) {
				this._validatedCellAddress = null;
				this._removeCellDropDownArrow();
			}
			this._validatedCellAddress = validatedCellAddress;
			this._addCellDropDownArrow();
		}
		else if (this._validatedCellAddress && validatedCellAddress.equals(this._validatedCellAddress.toArray())) {
			this._validatedCellAddress = null;
			this._removeCellDropDownArrow();
		}
	},

	_onValidityInputHelpMsg: function(textMsg) {
		app.definitions.validityInputHelpSection.removeValidityInputHelp();
		app.definitions.validityInputHelpSection.showValidityInputHelp(textMsg, new cool.SimplePoint(app.calc.cellCursorRectangle.x2, app.calc.cellCursorRectangle.y1));
	},

	_addCellDropDownArrow: function () {
		if (this._validatedCellAddress && app.calc.cellCursorVisible && this._validatedCellAddress.equals(app.calc.cellAddress.toArray())) {
			let position;
			if (this.sheetGeometry) {
				position = this.sheetGeometry.getCellRect(this._validatedCellAddress.x, this._validatedCellAddress.y);
				position = new cool.SimplePoint(app.calc.cellCursorRectangle.x2, (position.max.y - CalcValidityDropDown.dropDownArrowSize * app.dpiScale) * app.pixelsToTwips);
			}
			else
				position = new cool.SimplePoint(app.calc.cellCursorRectangle.x2, app.calc.cellCursorRectangle.y2 - CalcValidityDropDown.dropDownArrowSize * app.dpiScale * app.pixelsToTwips);

			if (!app.sectionContainer.getSectionWithName(app.CSections.CalcValidityDropDown.name)) {
				let dropDownSection = new CalcValidityDropDown(position);
				app.sectionContainer.addSection(dropDownSection);
			}
			else {
				app.sectionContainer.getSectionWithName(app.CSections.CalcValidityDropDown.name).setPosition(position.pX, position.pY);
			}
		}
	},

	_removeCellDropDownArrow: function () {
		if (!this._validatedCellAddress)
			app.sectionContainer.removeSection(app.CSections.CalcValidityDropDown.name);
	},

	_removeSelection: function() {
		this._selectedTextContent = '';
		app.activeDocument.activeView.clearTextSelection();
	},

	// A drag that carries this type is a slide preview being reordered in
	// the slide sorter; the document area takes no drops from it.
	_isSlideDrag: function (e) {
		return e.dataTransfer && e.dataTransfer.types &&
			Array.prototype.indexOf.call(e.dataTransfer.types, 'application/x-cool-slide') !== -1;
	},

	_onDragOver: function (e) {
		e = e.originalEvent;
		if (this._isSlideDrag(e))
			return;
		e.preventDefault();
	},

	_onDrop: function (e) {
		if (this._isSlideDrag(e.originalEvent))
			return;

		// Move the cursor, so that the insert position is as close to the drop coordinates as possible.
		var intern = e.intern;
		var docLayer = this._map._docLayer;
		var mousePos = docLayer._internToTwips(intern);
		var count = 1;
		var buttons = 1;
		var modifier = this._map.keyboard.modifier;
		this._postMouseEvent('buttondown', mousePos.x, mousePos.y, count, buttons, modifier);
		this._postMouseEvent('buttonup', mousePos.x, mousePos.y, count, buttons, modifier);

		e = e.originalEvent;
		e.preventDefault();

		if (this._map._clip) {
			// Always capture the html content separate as we may lose it when we
			// pass the clipboard data to a different context (async calls, f.e.).
			var htmlText = e.dataTransfer.getData('text/html');
			this._map._clip.dataTransferToDocument(e.dataTransfer, /* preferInternal = */ false, htmlText);
		}
	},

	/* in impress, we always recalculate zoom on resize to keep the slide in-view.
	 * so the second condition is unnecessary, but we keep it for consistency. */
	recalculateZoomOnResize: function() {
		const isWriterSinglePageView = this.isWriter() && !this._isMultiPageView();
		if (isWriterSinglePageView || this.isImpress())
			this._invalidateZoomFirstFit = true;
	},

	_getWriterDefaultZoom: function() {
		const ZOOM_LEVEL_20 = 1;
		const ZOOM_LEVEL_400 = 18;
		const ZOOM_LEVEL_100 = 10;

		let defaultZoom = parseInt(window.prefs.get('defaultZoom'));
		defaultZoom = isNaN(defaultZoom) ? ZOOM_LEVEL_100 : defaultZoom + 1;
		if (ZOOM_LEVEL_20 <= defaultZoom && defaultZoom <= ZOOM_LEVEL_400) {
			return defaultZoom;
		} else {
			return ZOOM_LEVEL_100;
		}
	},

	_getMaxZoom: function() {
		if (this.isImpress())
			return 13; /* 170% */
		if (this.isWriter())
			return 13; /* 170% */

		window.app.console.error('_getMaxZoom should only be called for Impress or Writer.');
		return 10; /* failsafe 100% */
	},

	/*
	 * The phone-chrome gate, BOTH halves.
	 *
	 * `isSmallScreenDevice()` alone is not the gate: `?vulcanChrome=desktop`
	 * forces desktop chrome on any device regardless of screen size, and the
	 * `vulcan-mobile-chrome` marker class on <html> is what records the
	 * decision that was actually taken. Substituting `false` for this must
	 * reproduce stock behaviour exactly on every non-phone surface.
	 */
	_vulcanPhoneChrome: function () {
		return window.mode.isSmallScreenDevice() &&
			document.documentElement.classList.contains('vulcan-mobile-chrome');
	},

	_recalcZoom: function(newSize, bringCommentsIntoView, maxZoom) {
		let _zoom;

		const commentWidth = app.sectionContainer.getSectionWithName(app.CSections.CommentList.name).sectionProperties.commentWidth;
		let documentWidth = app.activeDocument.fileSize.pX;
		let documentHeight = app.activeDocument.fileSize.pY;
		if (this.isWriter() && bringCommentsIntoView) newSize.x -= commentWidth;

		var ratio = newSize.x / documentWidth;
		_zoom = this._map.getScaleZoom(ratio);

		/* assume that this is the range of diagonal sizes we are going to get
		 * for the window and find where the current window size lies in these,
		 * clamping it between [0,1]. then find appropriate margin between 4-9%
		 * based on the window size factor. */
		if (this.isImpress()) {
			const MAX_DIAGONAL = 2200;
			const MIN_DIAGONAL = 1000;
			// KNOWN LATENT BUG, deliberately not fixed here: the height term is
			// `+ innerHeight` twice where it should be `* innerHeight`, so this
			// computes 392 instead of 930 at 390x844. It changes NOTHING on a
			// phone -- both values fall below MIN_DIAGONAL, so factor clamps to
			// 0 either way -- but it does understate the diagonal on tablets and
			// desktops, giving them a smaller margin than intended. Fixing it
			// changes tablet and desktop zoom, which is out of scope for a phone
			// change and untested; carve it separately rather than smuggling it in.
			const diagonal = Math.sqrt(window.innerWidth * window.innerWidth + window.innerHeight + window.innerHeight);
			const factor = clamp((diagonal - MIN_DIAGONAL) / (MAX_DIAGONAL - MIN_DIAGONAL), 0, 1);

			const percentMargin = 0.04 + factor * (0.09 - 0.04);
			const availW = newSize.x * (1 - percentMargin);
			const availH = newSize.y * (1 - percentMargin);

			// Fit ONE SLIDE on the phone, not the whole deck.
			//
			// In fileBasedView every part is stacked vertically and
			// app.activeDocument.fileSize becomes the STACKED extent -- max
			// width across parts, and the SUM of all part heights (see
			// ImpressTileLayer's _computeFileBasedFileSize). Contain-fitting
			// that means yRatio is availH/(N * slideHeight), so yRatio overtakes
			// xRatio at about four slides and every deck of five or more opens
			// pinned to the minZoom floor -- a 205x115 CSS px slide, the same
			// size whether the deck has 5 slides or 50. Longer deck, smaller
			// slide, which is exactly backwards.
			//
			// Fit ONE slide, and let the existing filebased scroll move between
			// them. The single-part dimensions are already tracked --
			// ImpressTileLayer records them from statusJSON BEFORE it overwrites
			// fileSize with the stacked extent.
			//
			// ⚠ THE JUSTIFICATION HERE USED TO BE "Google Slides shows ONE slide
			// filling the viewport and you swipe between them." That is not what
			// Slides does on a phone and it is not why this substitution is
			// right. Google REPLACED a one-slide-at-a-time pager with a vertical
			// stream in August 2020, and said why: "enables you to see more
			// information at once, which can help you review slides faster",
			// replacing "swiping to view slides one by one" (Workspace Updates
			// 2020-08-05). More than one slide visible is the stated goal. The
			// claim was downstream of the same mis-transcription of
			// google-slides.json #27 that MouseControl's read-posture block
			// documents; #27 now carries Google's verbatim sentence.
			//
			// The substitution stands on its own defect, which is the stacked
			// extent above, not on a parity claim about how many slides fit on
			// screen. What Google's geometry actually contributes is the NEXT
			// decision -- which axis binds -- and that is fitRatio below.
			//
			// Phone only: desktop and tablet keep the deck-fit, and the guard is
			// the same two-part test the rest of the phone chrome uses.
			let fitWidth = documentWidth;
			let fitHeight = documentHeight;
			const vulcanPhoneImpress = this._vulcanPhoneChrome();
			if (vulcanPhoneImpress && app.file.fileBasedView &&
				this._partWidthTwips > 0 && this._partHeightTwips > 0) {
				fitWidth = Math.round(this._partWidthTwips * app.twipsToPixels);
				fitHeight = Math.round(this._partHeightTwips * app.twipsToPixels);
			}

			// PHONE PORTRAIT: THE WIDTH BINDS AND THE HEIGHT IS NOT CONSULTED.
			//
			// Everything about why is in VulcanImpressFit.fitRatio's header,
			// including the measured sweep it comes from and why the
			// obvious-looking `xRatio * fitHeight <= availH` form of this is
			// algebraically a no-op. The short version: a contain-fit against a
			// box whose height moves is a slide size that moves. Google's box
			// height does not move on a phone in portrait; ours is inset by the
			// phone chrome, the speaker-notes strip, the bottom sheet and the
			// software keyboard, none of which are a change of form factor. So
			// the height term goes, and the vertical stream that is already
			// there absorbs a slide taller than the canvas.
			//
			// Landscape still contain-fits and pillarboxes: the caller-side
			// predicate is orientation, not box aspect, so a keyboard cannot
			// flip it (DomUtil.isPortrait is matchMedia('(orientation:
			// portrait)'), resolved against the LAYOUT viewport).
			//
			// Phone only. Substituting `false` for _vulcanPhoneChrome() gives
			// back Math.min(xRatio, yRatio) on desktop and tablet exactly.
			const widthBound = vulcanPhoneImpress && window.L.DomUtil.isPortrait();
			ratio = VulcanImpressFit.fitRatio(availW, availH, fitWidth, fitHeight, widthBound);
			_zoom = this._map.getScaleZoom(ratio);
		}

		if (maxZoom) _zoom = Math.min(maxZoom, Math.max(0.1, _zoom));
		return _zoom;
	},

	/**
	 * This is really just called on zoomend
	 *
	 * @param recalcFirstFit
	 * 		Passed by the UI dispatches like 'Zoom to Fit Page Width' button
	 *		in order to reset the zoom. It is used to recalculate/reset the
	 *		document zoom level to the maximum possible value based on the
	 *		window size (available canvas area).
	 *
	 * 		The `smartZoom` option should not block fit-width-zoom if this
	 * 		parameter is set to `true`, in case smartZoom is disabled (== false).
	 */
	_fitWidthZoom: function (e, maxZoom, recalcFirstFit=false) {
		if (this.isCalc() || this.isDraw() || this._isMultiPageView())
			return;
		/*
		 * VULCAN (Lane W, W1): the CLIENT half of the browse-width ratchet.
		 *
		 * Fixing only the engine leaves this loop turning. In web view the
		 * page width is BY DEFINITION the viewport -- the engine reflows to
		 * the width the client states -- so "zoom until the page width fits
		 * the viewport" is not a second opinion about the same quantity, it
		 * is a second WRITER of it. The two rules chase each other: reflow
		 * narrows the document, `_recalcZoom` reads the narrower
		 * `app.activeDocument.fileSize.x` and zooms in to fit it, the
		 * narrower viewport-in-twips produces a narrower reflow, and around
		 * again. That is the client-side half of the measured
		 * 35035 -> 19110 -> 12800 twips slide (see ImplCalcBrowseWidth).
		 *
		 * So in web view the zoom belongs to the user and to
		 * VulcanWriterReflow's legibility target, and nothing else writes it.
		 * Acceptance criterion 2 -- browse width identical across three
		 * scroll and three zoom cycles -- is only reachable with this
		 * return: a zoom cycle that ends where it started must produce the
		 * width it started with, which is true of a pure function of
		 * (viewport, zoom) and false of anything with a fit-to-width term in
		 * the loop.
		 *
		 * Page view is completely untouched: `isBrowseMode()` is false until
		 * the engine broadcasts `.uno:BrowseView=true`, which only happens
		 * after a deliberate toggle. Substituting `false` for the whole
		 * condition reproduces HEAD.
		 */
		if (this.isWriter() && app.writerReflow && app.writerReflow.isBrowseMode())
			return;
		if (app.activeDocument.fileSize.x === 0)
			return;
		if (this._map.uiManager.getStartCompareChanges()) // comparechanges view, don't zoom in, to have space for two pages side by side.
			return;

		/*
		 * Phone Impress: a resize must not throw away the zoom the user pinched to.
		 *
		 * `isImpress()` forces `recalcFirstFit` true below, unconditionally, which
		 * clears `_firstFitDone` -- so the "already fitted, width unchanged" early
		 * return never fires for Impress and the "keep the current zoom" branch
		 * (`if (this._firstFitDone) zoom = this._map._zoom;`) is dead. Every
		 * `resize` therefore recomputes the fit zoom and calls setZoom with it.
		 *
		 * On a phone `resize` is not a rare event. A ResizeObserver on
		 * #document-container (see _initContainer) runs `_syncTileContainerSize`,
		 * which calls this argument-less, on the software keyboard opening or
		 * closing, on a bottom sheet appearing, on rotation, and on browser chrome
		 * retracting. Each of those discarded the pinch.
		 *
		 * That matters because of what Slides says pinch is FOR: "Two-finger pinch
		 * zooms into a slide in both read and edit posture, letting you place small
		 * objects accurately on a phone-sized canvas" (google-slides.json, "Pinch
		 * to zoom the slide canvas"). Placing accurately and typing are exactly the
		 * actions that raise the keyboard, so the refit was cancelling the gesture
		 * on the very interactions it exists to serve -- and on a viewer-first
		 * product the pinch is also the one recovery gesture for a slide that has
		 * been fitted too small to read.
		 *
		 * So: once the user has zoomed by hand, a resize keeps their zoom. An
		 * EXPLICIT refit still wins and re-arms the automatic fit -- 'Zoom to Fit
		 * Slide' (dispatcher 'fitwidthzoom' -> ViewLayout.adjustViewZoomLevel) is
		 * the caller that passes recalcFirstFit = true, and it is the deliberate
		 * "put it back" control. The initial fit on load is unaffected: the latch
		 * starts false.
		 *
		 * 🔴 THE PARAGRAPH ABOVE SHIPPED A ONE-WAY DOOR. It is right about what the
		 * latch is for and wrong about it having a way out. `_vulcanUserZoomed` is
		 * initialised false in `onAdd` -- ONCE PER DOCUMENT LOAD, not per resize --
		 * set by any pinch or ctrl+wheel in `zoomStepEnd`, and cleared only on
		 * `recalcFirstFit === true`. Every caller that passes true is behind the
		 * 'fitwidthzoom' action, and 'fitwidthzoom' had no phone surface:
		 * `fitwidthzoom-impress` is a status-bar item (Control.StatusBar.js:291)
		 * and vulcan-theme.css §13i.13 sets `display: none !important` on
		 * `#toolbar-down` for phone presentations, while the phone kebab's View
		 * submenu carried only spellonline / notesmode / fullscreen /
		 * toggledarktheme. So one pinch disabled the automatic fit for the rest of
		 * the session and there was no way back on the device.
		 *
		 * The visible consequence is a rotation. Portrait -> landscape changes the
		 * available box by roughly three 1.2x zoom steps, and the deck kept the
		 * portrait zoom -- a crop, which is the "not showing the slides properly"
		 * half of the report. Google Slides re-fits on rotation.
		 *
		 * THE NARROWING: the latch survives an INSET but not a SHAPE CHANGE. An
		 * inset (keyboard, bottom sheet, notes strip, browser chrome) leaves the
		 * device orientation alone and must keep the pinch, for every reason the
		 * paragraph above gives. A rotation is a real size-class change: the box
		 * the pinch was chosen for no longer exists, so the pinch expires with it.
		 *
		 * ORIENTATION, NOT BOX ASPECT. `DomUtil.isPortrait()` is
		 * `matchMedia('(orientation: portrait)')`, which resolves against the
		 * LAYOUT viewport, and the software keyboard cannot flip it -- iOS shrinks
		 * only the visual viewport, and an Android resize of 390x844 to 390x544 is
		 * still portrait. Comparing the aspect of the canvas BOX instead would flip
		 * spuriously, because that box is inset by the top bar and the speaker-notes
		 * strip on top of the keyboard and can genuinely end up wider than tall in
		 * portrait. `ImpressTileLayer.onResizeImpress` already picks its
		 * portrait/landscape layout off the same predicate.
		 *
		 * SLIDE CHANGE IS DELIBERATELY NOT A THIRD RELEASE, and that is a recorded
		 * refusal rather than an oversight. The obvious next trigger -- expire the
		 * pinch when the user moves to another slide -- has no source behind it.
		 * SLIDES-SCROLL-MODEL-SPEC R24a is explicit: "UNCERTAIN -- whether a user
		 * zoom survives a slide change. Not catalogued, not measured. Do not
		 * encode a guess." Rotation is the one that IS measured (R25), which is
		 * why rotation is the one implemented.
		 *
		 * On our geometry the question is moot as well, which is the stronger
		 * half of the argument because it does not expire when someone finally
		 * measures Slides. The phone fit is computed from `_partWidthTwips` /
		 * `_partHeightTwips` -- a SINGLE part's size, substituted in `_recalcZoom`
		 * above -- and Impress gives every slide in a document the same page size.
		 * So moving between slides cannot change the box the pinch was chosen
		 * for, and there is nothing for the latch to expire against. Contrast a
		 * rotation, which changes that box by about three 1.2x steps.
		 *
		 * Google's read posture does not even have a current slide to change
		 * (google-slides.json #27, as corrected: the read-mode verbs are swipe to
		 * scroll, pinch to zoom, tap, double-tap -- no slide-change event); ours
		 * resolves a part only to answer "which slide did you just tap".
		 *
		 * Phone only. The gate is the same two-part phone-chrome test as the rest
		 * of the phone work, so substituting `false` for `_vulcanPhoneChrome()`
		 * reproduces HEAD on desktop and tablet.
		 */
		const vulcanPhoneImpress = this.isImpress() && this._vulcanPhoneChrome();
		const vulcanPhoneWriter = this.isWriter() && this._vulcanPhoneChrome();
		if (vulcanPhoneImpress) {
			if (recalcFirstFit === true) {
				// The deliberate "put it back" re-arms the automatic fit. On the
				// phone this is the kebab's 'Zoom to Fit Slide' row, added to
				// Control.Menubar.ts mobilepresentation for exactly this purpose.
				this._vulcanUserZoomed = false;
			} else if (this._vulcanUserZoomed) {
				if (window.L.DomUtil.isPortrait() === this._vulcanZoomedPortrait)
					return;
				this._vulcanUserZoomed = false;
			}
		}

		var oldSize = e && e.oldSize ? e.oldSize : this._map.getSize();
		var newSize = e && e.newSize ? e.newSize : this._map.getSize();
		newSize.x *= app.dpiScale;
		newSize.y *= app.dpiScale;
		oldSize.x *= app.dpiScale;
		oldSize.y *= app.dpiScale;

		let bringCommentsIntoView = false;
		let changeZoom = false;
		const vulcanDesktopWriter = this.isWriter() && !vulcanPhoneWriter;
		if (vulcanDesktopWriter) {
			// The map can still carry the pre-split inline width until the
			// container observer runs. Never fit beyond the visible workspace.
			const containerWidth = this._getDocumentContainerSize()[0] * app.dpiScale;
			if (!(containerWidth > 0) || !(newSize.x > 0)) return;
			newSize.x = Math.min(newSize.x, containerWidth);
			if (recalcFirstFit) this._vulcanWriterUserViewport = false;
		}

		// The VIEWPORT width, snapshotted before `_recalcZoom` subtracts the
		// comment rail from `newSize.x` IN PLACE (:4132). The desktop-Writer
		// dead-band below asks a viewport question -- "has the pane changed
		// since the fit landed?" -- so its baseline has to be the pane, not the
		// comment-reduced content width. Recording the post-subtraction value
		// made the NEXT pass see a commentWidth-sized change at an unmoved pane,
		// refit with `bringCommentsIntoView` already latched false, and throw the
		// rail allowance away -- on every document that has comments, which is
		// the document this product exists for.
		const vulcanFitViewportX = newSize.x;

		if (this.isWriter()) {
			const smartZoomEnabled = window.prefs.get('smartZoom') != 'false';
			if (smartZoomEnabled) {
				if (this._invalidateZoomFirstFit) {
					recalcFirstFit = true;
					this._invalidateZoomFirstFit = false;
				}
			}

			// this isn't being triggered now when the sidebar shows up
			const considerCommentWidthInOffset = () => {
				// Phones never render the comment rail -- CommentSection does
				// not even attach its container to #document-container on a
				// small screen -- so reserving room for it shrinks the fit-width
				// calculation by the width of something that is not on screen.
				// On a 390px phone that is a large fraction of the viewport, and
				// it fires only on documents that HAVE comments, i.e. exactly the
				// reviewed contracts this product exists for. Skipping the flag
				// rather than the subtraction also avoids the side effects below,
				// which force an extra first-fit recalculation.
				if (window.mode.isSmallScreenDevice())
					return;
				if (app.activeDocument.partHasComments) {
					// The ALLOWANCE is not one-shot. It was safe to arm it once
					// while a Writer fit happened once: #9272 turned the desktop
					// branch into a REPEATING fit that follows the pane, and the
					// refit that follows the split workspace into its real width
					// -- the whole point of that PR -- then ran with this latched
					// false and fitted the text to the full pane, over the column
					// the comments occupy. #9305 fixed the other half of this
					// (which width the dead-band RECORDS); the allowance itself
					// still has to be reserved on every fit that has comments.
					bringCommentsIntoView = true;
					// The RE-FIT TRIGGER stays one-shot, for the reason above:
					// clearing _firstFitDone forces an extra first-fit
					// recalculation, and doing that on every pane change is the
					// side effect this latch exists to avoid.
					if ((recalcFirstFit || !this._includedCommentsInFirstFit)) {
						this._includedCommentsInFirstFit = true;
						// ...and it never outranks a reader who took the
						// viewport. Now that desktop Writer reaches here on every
						// fit, this runs on the plain refit that follows the
						// first comment arriving (a co-editor's, or the agent's
						// addComment); clearing _firstFitDone would skip the
						// dead-band below, and with it `_vulcanWriterUserViewport`,
						// and fit over the reader's own zoom. Zoom to Fit is
						// unaffected: recalcFirstFit has already cleared that latch.
						if (!(vulcanDesktopWriter && this._vulcanWriterUserViewport))
							this._firstFitDone = false;
					}
				}
			}

			// Phone Writer must still take its FIRST fit when a stored
			// smartZoom=false would otherwise open the document at 100%.
			changeZoom  = smartZoomEnabled || recalcFirstFit ||
				(vulcanPhoneWriter && !this._firstFitDone);
			// Desktop Writer computes a fit at the `vulcanDesktopWriter` clause
			// below whether or not `changeZoom` is set -- smartZoom is FALSE by
			// default, so on a stock profile `changeZoom` is false on exactly the
			// width-follow refits #9272 added. The rail has to be considered on
			// the same terms as the fit, or the refit reserves nothing.
			if (changeZoom || vulcanDesktopWriter)
				considerCommentWidthInOffset();
		} else if (this.isImpress() && !vulcanPhoneImpress) {
			// STOCK, minus the phone. See the block below for why the phone is
			// carved out; desktop and tablet Impress keep discarding the fit
			// state on every resize exactly as before.
			recalcFirstFit = true;
		}

		if (recalcFirstFit)
			this._firstFitDone = false;

		/*
		 * The no-op guard, and on this surface it is being allowed to run for
		 * the first time.
		 *
		 * WHAT WAS WRONG. `else if (this.isImpress()) recalcFirstFit = true;`
		 * was UNCONDITIONAL, and `if (recalcFirstFit) this._firstFitDone =
		 * false;` immediately below it then cleared the latch that the next line
		 * tests. So for a presentation the width-only early return was DEAD
		 * CODE, and so was the keep-the-current-zoom branch further down. Every
		 * resize ran the whole fit.
		 *
		 * That is the mechanism behind the reported "it keeps resizing". A phone
		 * browser retracting its chrome as you scroll changes the viewport
		 * HEIGHT; js/global.js writes that height onto <body>; #document-container
		 * changes box; the ResizeObserver runs _syncTileContainerSize, which
		 * both fires `resize` (wired to this function) and calls this function
		 * again itself. None of that is a document scroll -- it is exactly the
		 * "something that feels like it should be a scroll" in the report -- and
		 * none of it is a change of the only dimension the fit is allowed to
		 * depend on.
		 *
		 * The stock comparison is WIDTH ONLY, which is the right instinct and
		 * the thing to preserve: completing it with a height term would let
		 * every chrome tick through, which is the defect, not the fix. Somebody
		 * already wrote the correct guard; it was disabled three lines above
		 * itself.
		 *
		 * WHY THE PHONE GETS A DIFFERENT COMPARISON RATHER THAN THE STOCK ONE.
		 * The stock test reads `newSize.x - oldSize.x === 0`, and this function
		 * is called BOTH with a resize event and argument-less (from
		 * _syncTileContainerSize). Argument-less, `oldSize` and `newSize` are
		 * the same map size read twice, so the test is vacuously true and says
		 * nothing about whether the width changed since anything was fitted.
		 * That is survivable when the guard is dead; it is not something to
		 * build on when it is live, because the ordering hazard it creates lands
		 * squarely on first paint: an early argument-less call against a 0x0
		 * container (iframe mount) can latch `_firstFitDone` at width 0, and
		 * every later argument-less call would then match itself and skip the
		 * real fit. VulcanImpressFit.shouldSkipRefit compares against a width
		 * RECORDED when a fit was actually applied and refuses a zero baseline,
		 * so that sequence cannot arise. Its header carries the full first-paint
		 * argument, and mocha_tests/VulcanImpressFit.test.ts calibrates it
		 * against a variant with the preconditions dropped, which does suppress
		 * first paint.
		 *
		 * NOT SUPPRESSED, checked rather than assumed:
		 *   - Rotation. Both axes change, so the width differs from the recorded
		 *     one and this falls through. (R25: rotation is the legitimate refit
		 *     trigger, and the one the phone must not lose.)
		 *   - 🔴 LANDSCAPE INSETS (round-8 G9). The whole "a height change must
		 *     produce no work" argument is PORTRAIT's: it holds because
		 *     `fitRatio` drops the height term when `widthBound`, and
		 *     `widthBound` is `isPortrait()`. In landscape the height BINDS,
		 *     so the AI rail / notes strip / bottom sheet / keyboard each
		 *     genuinely change the slide size at an unchanged width -- and
		 *     until this was passed the orientation, every one of them was
		 *     skipped and the deck sat at a stale scale. The flag and the two
		 *     heights are read from the same `newSize` this function already
		 *     has; `_lastFitSizeY` is recorded beside `_lastFitSizeX` at the
		 *     one place a fit is applied.
		 *   - The explicit 'Zoom to Fit Slide' path and the other refit callers
		 *     (docdispatcher, ViewLayout) pass recalcFirstFit = true, which
		 *     clears _firstFitDone above and bypasses this entirely -- and still
		 *     re-arms the automatic fit in the latch block at the top.
		 *   - The read -> edit posture flip (ImpressTileLayer.
		 *     _switchToPartBasedView) does not need a refit at an unchanged
		 *     width: fileBasedView already substitutes the SINGLE-part size in
		 *     _recalcZoom, and partBasedView's fileSize IS that same single
		 *     part, so the ratio is the same number on both sides of the flip.
		 *
		 * Phone only; substituting `false` for _vulcanPhoneChrome() leaves the
		 * stock branch, which is byte-identical to what shipped.
		 */
		if (vulcanPhoneImpress) {
			// The SAME predicate `_recalcZoom` uses to decide which axis binds
			// (`vulcanPhoneImpress && DomUtil.isPortrait()`, :4053) -- read
			// here rather than re-derived, so the guard and the fit can never
			// disagree about whether the height matters. We are already inside
			// the vulcanPhoneImpress branch, so the phone half is implied.
			var vulcanWidthBound = window.L.DomUtil.isPortrait();
			if (VulcanImpressFit.shouldSkipRefit(
				this._firstFitDone, this._lastFitSizeX, newSize.x,
				vulcanWidthBound, this._lastFitSizeY, newSize.y))
				return;
		} else if (vulcanDesktopWriter) {
			// A first fit can precede the workspace settling into its split
			// width. Refit the automatic view when that width changes, but
			// permanently relinquish it after a deliberate horizontal pan/zoom.
			// Comparing zoom numbers alone would reclaim a user's
			// zoom-away-and-back.
			if (this._firstFitDone && (this._vulcanWriterUserViewport ||
				Math.abs(newSize.x - this._lastFitSizeX) < 2 * app.dpiScale))
				return;
		} else if (this._firstFitDone && newSize.x - oldSize.x === 0) {
			return;
		}

		maxZoom = maxZoom || this._getMaxZoom();

		var zoom;
		// A width re-fit must compute the fit even where a stored
		// smartZoom=false would otherwise hand back the default rung.
		// `changeZoom` is gated on the stored smartZoom preference, which is
		// FALSE by default -- MEASURED on a live document: smartZoomPref false,
		// column 1241px, page 854px, zoom pinned at 100%. So the fit computed a
		// level and then never applied it, and the "amber gutter" was fit-width
		// being switched off rather than any rounding. Desktop Writer always
		// fits; the preference still governs every other surface.
		if (this.isImpress() || changeZoom /* writer */ || vulcanDesktopWriter) {
			zoom = this._recalcZoom(newSize, bringCommentsIntoView, maxZoom);
		} else {
			zoom = this._getWriterDefaultZoom();
		}

		// Not clear why we wanted to zoom in the past.
		// This resets the view & scroll area and does a 'panTo'
		// to keep the cursor in view.
		// But of course, zoom to fit the first time.
		//
		// PHONE IMPRESS KEEPS THE RECOMPUTED FIT, and that is not a new
		// behaviour -- it is the behaviour that has to be carried across the
		// change above. `_firstFitDone` was cleared on every Impress resize
		// until three lines of this function stopped clearing it, so this
		// discard branch has never once run for a presentation and the phone has
		// always applied the freshly computed fit. Leaving the branch reachable
		// now would silently invert that: past the guard above, the width has
		// genuinely changed since the last applied fit -- a rotation, a sidebar,
		// a real form-factor change -- and those are exactly the cases that MUST
		// refit. R25 [MEASURED]: rotation is the legitimate refit trigger, and a
		// portrait zoom kept across a rotation is a crop, which is the other
		// half of the same report ("not showing the slides properly").
		// ...and desktop Writer keeps its recomputed fit for the same reason the
		// phone deck does: past the guard above, the column has genuinely moved
		// since the last applied fit, which is precisely the case that MUST
		// re-fit. Discarding it here is what left the page clipped behind an
		// opened sidebar.
		if (this._firstFitDone && !vulcanPhoneImpress && !vulcanDesktopWriter)
			zoom = this._map._zoom;
		this._firstFitDone = true;

		// The commit stays an integer rung either way (MouseControl invariant).
		// Phone Writer may snap a near-fit level UP instead of losing a whole
		// 1.2x rung to the floor; every other surface keeps the stock floor.
		if (zoom > 1) {
			// Desktop Writer opens at the tightest rung that still shows the
			// whole text column, margins allowed to run off the ends. Only the
			// AUTOMATIC fit is bound by it -- `_getMaxZoom` is untouched, so the
			// user's own zoom still goes past it and the page scrolls sideways.
			var vulcanTextLevel = vulcanDesktopWriter
				? VulcanWriterFit.textFitLevel(
					newSize.x,
					app.activeDocument.fileSize.pX,
					app.activeDocument.fileSize.x,
					this._vulcanTextWidthMm100,
					this._map.getZoom())
				: null;
			if (vulcanTextLevel !== null)
				zoom = Math.min(vulcanTextLevel, maxZoom);
			else
				zoom = vulcanPhoneWriter
					? VulcanWriterFit.snapFitLevel(zoom)
					: Math.floor(zoom);
		}
		//
		// AND PHONE WRITER NEVER COMMITS AN ILLEGIBLE RUNG. This function's
		// whole job is fitting the PAGE WIDTH, and until now nothing on its
		// path had a term for type size: Letter on a 393px phone fits at
		// level 5.74, snaps to rung 6, and renders 11pt body at 7.07 CSS px
		// (round-12 D8). floorToLegible carries the derivation and the page-
		// view trade it accepts. Deliberately OUTSIDE the `zoom > 1` guard,
		// which exists only to keep snapFitLevel off levels it declines to
		// round: a fit that lands at or below 1 is the most illegible answer
		// this function can give, so a floor that skipped it would fail open
		// exactly where it is needed -- the failure mode the Calc fit floor
		// was deleted for (MouseControl.pinchNavigationFloorCalc).
		//
		// Phone Writer only; the desktop arms above are untouched.
		if (vulcanPhoneWriter)
			zoom = VulcanWriterFit.floorToLegible(zoom, maxZoom);

		/*
		 * Phone Impress: do not write a zoom that is already the zoom.
		 *
		 * This is the equality guard the function is missing. Stock HAS one --
		 * `if (this._firstFitDone && newSize.x - oldSize.x === 0) return;` a few
		 * lines up -- but Impress cannot reach it: the `else if (this.isImpress())
		 * recalcFirstFit = true` branch above runs on EVERY call, unconditionally,
		 * and `if (recalcFirstFit) this._firstFitDone = false;` then clears the
		 * very latch that guard tests. So for a presentation the early return is
		 * dead code and every resize falls through to setZoom.
		 *
		 * On a phone that is not a rare path. `resize` arrives from a
		 * ResizeObserver on #document-container (_initContainer) and from
		 * `map.on('resize', ...)`, which is wired to BOTH this function and
		 * `_syncTileContainerSize` -- which itself calls this function again. So a
		 * single browser-chrome retraction while scrolling the deck lands here
		 * more than once, and each time re-enters Map.setZoom: setZoomChanged(true),
		 * _limitCenter, _getCenterOffset, panBy, setZoomChanged(false). panBy
		 * early-returns on a zero offset, but _limitCenter clamps the centre to
		 * maxBounds first, so the offset is only zero while the view is already
		 * inside them.
		 *
		 * Compare against `_limitZoom(zoom)`, not `zoom`, because that is the value
		 * setZoom will actually apply -- Map.setView re-limits it and Map's minZoom
		 * is 1. That distinction is what makes the guard work on a deck-fitted
		 * document: _recalcZoom's `Math.min(maxZoom, Math.max(0.1, _zoom))` floor
		 * returns 0.1, which is NEVER equal to the pinned _zoom of 1, so a raw
		 * comparison would re-write on every resize forever. Limiting first makes
		 * the two comparable and the write stops.
		 *
		 * This is a no-op guard, not a debounce. The recompute is legitimate -- a
		 * real size change must refit -- and it still happens; what is suppressed is
		 * only the write of a value equal to what is already there. Nothing is
		 * delayed and no coalescing window is introduced, so a genuine resize still
		 * refits on the same frame.
		 *
		 * The centre re-clamp is not lost with the write. Every resize path that
		 * reaches here also runs `_syncTileContainerSize`, which does its own
		 * `this._map.setView(this._map.getCenter())` immediately after calling this
		 * function.
		 *
		 * NOTE FOR THE EXPLICIT PATH, which is the one exception to the sentence
		 * above: 'fitwidthzoom' -> `ViewLayout.adjustViewZoomLevel` calls
		 * `_fitWidthZoom(undefined, undefined, true)` on its own, with no
		 * `_syncTileContainerSize` behind it, so when the map is ALREADY at the fit
		 * zoom this guard suppresses the write and nothing re-centres. That is
		 * deliberate and it does not strand the kebab's 'Zoom to Fit Slide' row:
		 * the row's real job is clearing `_vulcanUserZoomed`, and that happens at
		 * the TOP of this function on `recalcFirstFit === true`, before anything
		 * here runs. What is skipped is a `_limitCenter` re-clamp at a zoom that is
		 * already correct -- i.e. nothing the user asked for. Do not "fix" this by
		 * exempting recalcFirstFit; that reintroduces a write of an unchanged value
		 * on a path a user can tap repeatedly.
		 *
		 * Phone only, and the gate is the single `_vulcanPhoneChrome()` evaluation
		 * already taken at the top of this function -- substituting `false` for it
		 * reproduces HEAD on desktop and tablet.
		 */
		if (vulcanPhoneImpress && this._map._limitZoom(zoom) === this._map.getZoom())
			return;

		// The baseline the guard above compares against, recorded HERE and
		// nowhere else: immediately before the write that applies a fit, so it
		// can only ever hold a width at which a fit actually landed. Setting it
		// next to `_firstFitDone = true` would look tidier and would be wrong --
		// it would record widths for passes that returned without writing, and
		// the point of the second precondition is that it cannot be satisfied by
		// a pass that did not fit anything.
		this._lastFitSizeX = vulcanFitViewportX;
		// The height half of the same baseline (round-8 G9). Recorded in the
		// same breath and at the same place, because in landscape the fit is
		// height-bound and the guard above compares BOTH axes there. Writing
		// it anywhere else would let the two baselines describe different
		// passes, which is the failure the width comment warns about.
		this._lastFitSizeY = newSize.y;
		// The zoom half of the same baseline. Recorded in the same breath and
		// at the same place, so it can only ever hold a zoom that a fit
		// actually applied -- that is what lets the first-ruler re-fit in
		// _onRulerUpdate read "the document is still on our fit" off a
		// comparison instead of a latch. Limited, because _limitZoom is what
		// setZoom will really land on and getZoom() will report back.
		this._lastFitZoom = this._map._limitZoom(zoom);
		// VULCAN (Lane W): announce this write to the Writer reflow
		// controller. Its zoomend handler cannot otherwise tell an app fit
		// write from the reader's pinch, and the two demand opposite
		// treatment: a pinch retargets the reflow ask, a fit write serves
		// the PAGINATED posture and says nothing about the reading zoom.
		// MEASURED on build #2 (wr1-open-trace, 3/3): the open's fit pass
		// fired zoomend at the page-fit level and the untagged handler
		// re-sized the parity-default ask to 20209 twips — 5.3x the screen
		// at the legible level — whose granted answer the verdict then
		// withdrew from ~900ms into every docx open. A bracket rather than
		// a bare flag, because a setZoom to the level the map is already at
		// fires no zoomend, and a leaked flag would mislabel the reader's
		// next pinch. setZoom fires zoomend synchronously, so the scope is
		// tight. Writer only; the controller is Writer-scoped and every
		// other doctype leaves the bracket alone.
		const vulcanWriterReflowFitTag =
			this.isWriter() &&
			app.writerReflow &&
			typeof app.writerReflow.noteFitZoomWrite === 'function';
		if (vulcanWriterReflowFitTag)
			app.writerReflow.noteFitZoomWrite();
		this._vulcanWriterFitInProgress = vulcanDesktopWriter;
		try {
			this._map.setZoom(zoom, {animate: false});
		} finally {
			this._vulcanWriterFitInProgress = false;
			if (vulcanWriterReflowFitTag)
				app.writerReflow.clearFitZoomWrite();
		}
	},

	// Cells can change position during changes of zoom level in calc
	// hence we need to request an updated cell cursor position for this level.
	_onCellCursorShift: function (force) {
		if ((this._cellCursorSection && !this.options.sheetGeometryDataEnabled) || force) {
			this.requestCellCursor();
		}
	},

	requestCellCursor: function() {
		app.socket.sendMessage('commandvalues command=.uno:CellCursor'
			+ '?outputHeight=' + RenderManager.tileSize
			+ '&outputWidth=' + RenderManager.tileSize
			+ '&tileHeight=' + app.tile.size.x
			+ '&tileWidth=' + app.tile.size.y);
	},

	_invalidateAllPreviews: function () {
		this._previewInvalidations = [];
		for (var key in this._map._docPreviews) {
			var preview = this._map._docPreviews[key];
			preview.invalid = true;
			this._previewInvalidations.push(new cool.Bounds(new cool.Point(0, 0), new cool.Point(preview.maxWidth, preview.maxHeight)));
		}
		this._invalidatePreviews();
	},

	_invalidatePreviews: function () {
		if (this._map && this._map._docPreviews && this._previewInvalidations.length > 0) {
			var toInvalidate = {};
			for (var i = 0; i < this._previewInvalidations.length; i++) {
				var invalidBounds = this._previewInvalidations[i];
				for (var key in this._map._docPreviews) {
					// find preview tiles that need to be updated and add them in a set
					var preview = this._map._docPreviews[key];
					if (preview.index >= 0) {
						// we have a preview for a part
						if (preview.invalid || preview.index === this._selectedPart ||
								(preview.index === this._prevSelectedPart && this._prevSelectedPartNeedsUpdate)) {
							// if the current part needs its preview updated OR
							// the part has been changed and we need to update the previous part preview
							if (preview.index === this._prevSelectedPart) {
								this._prevSelectedPartNeedsUpdate = false;
							}
							toInvalidate[key] = true;
						}
					}
					else {
						// we have a custom preview
						var bounds = new cool.Bounds(
							new cool.Point(preview.tilePosX, preview.tilePosY),
							new cool.Point(preview.tilePosX + preview.tileWidth, preview.tilePosY + preview.tileHeight));
						if (preview.invalid || (preview.part === this._selectedPart ||
								(preview.part === this._prevSelectedPart && this._prevSelectedPartNeedsUpdate)) &&
								invalidBounds.intersects(bounds)) {
							// if the current part needs its preview updated OR
							// the part has been changed and we need to update the previous part preview
							if (preview.index === this._prevSelectedPart) {
								this._prevSelectedPartNeedsUpdate = false;
							}
							toInvalidate[key] = true;
						}

					}
				}

			}

			for (key in toInvalidate) {
				// update invalid preview tiles
				preview = this._map._docPreviews[key];
				if (preview.autoUpdate) {
					if (preview.index >= 0) {
						this._map.getPreview(preview.id, preview.index, preview.maxWidth, preview.maxHeight, {autoUpdate: true});
					}
					else {
						this._map.getCustomPreview(preview.id, preview.part, preview.width, preview.height, preview.tilePosX,
							preview.tilePosY, preview.tileWidth, preview.tileHeight, {autoUpdate: true});
					}
				}
			}
		}
		this._previewInvalidations = [];
	},

	_onFormFieldButtonMsg: function (textMsg) {
		textMsg = textMsg.substring('formfieldbutton:'.length + 1);
		var json = JSON.parse(textMsg);
		if (json.action === 'show') {
			if (this._formFieldButton)
				app.sectionContainer.removeSection(this._formFieldButton.name);

			this._formFieldButton = new FormFieldButton(json);
			app.sectionContainer.addSection(this._formFieldButton);
		} else if (this._formFieldButton)
			app.sectionContainer.removeSection(this._formFieldButton.name);
	},

	// converts rectangle in print-twips to tile-twips rectangle of the smallest cell-range that encloses it.
	_convertToTileTwipsSheetArea: function (rectangle) {
		if (!(rectangle instanceof cool.Bounds) || !this.options.printTwipsMsgsEnabled || !this.sheetGeometry) {
			return rectangle;
		}

		return this.sheetGeometry.getTileTwipsSheetAreaFromPrint(rectangle);
	},

	_getEditCursorRectangle: function (msgObj) {

		if (typeof msgObj !== 'object' || !Object.prototype.hasOwnProperty.call(msgObj,'rectangle')) {
			window.app.console.error('invalid edit cursor message');
			return undefined;
		}

		return cool.Bounds.parse(msgObj.rectangle);
	},

	_getTextSelectionRectangles: function (textMsg) {

		if (typeof textMsg !== 'string') {
			window.app.console.error('invalid text selection message');
			return [];
		}

		return cool.Bounds.parseArray(textMsg);
	},

	// Needed for the split-panes feature to determine the active split-pane.
	// Needs to be implemented by the app specific TileLayer.
	getCursorPos: function () {
		window.app.console.error('No implementations available for getCursorPos!');
		return new cool.Point(0, 0);
	},

	/// onlyThread - takes annotation indicating which thread will be generated
	getCommentWizardStructure: function(menuStructure, onlyThread) {
		var customTitleBar = window.L.DomUtil.create('div');
		window.L.DomUtil.addClass(customTitleBar, 'mobile-wizard-titlebar-btn-container');
		var title = window.L.DomUtil.create('span', '', customTitleBar);
		title.innerText = _('Comment');
		var button = window.L.DomUtil.createWithId('button', 'insert_comment', customTitleBar);
		window.L.DomUtil.addClass(button, 'mobile-wizard-titlebar-btn');
		button.innerText = '+';
		button.onclick = this._map.insertComment.bind(this._map);

		if (menuStructure === undefined) {
			menuStructure = {
				id : 'comment',
				type : 'mainmenu',
				enabled : true,
				text : _('Comment'),
				executionType : 'menu',
				data : [],
				children : []
			};

			if (app.isCommentEditingAllowed())
				menuStructure['customTitle'] = customTitleBar;
		}

		app.sectionContainer.getSectionWithName(app.CSections.CommentList.name).createCommentStructure(menuStructure, onlyThread);

		if (menuStructure.children.length === 0) {
			var noComments = {
				id: 'emptyWizard',
				enable: true,
				type: 'emptyCommentWizard',
				text: _('No Comments'),
				children: []
			};
			menuStructure['children'].push(noComments);
		}
		return menuStructure;
	},

	_openCommentWizard: function(annotation) {
		window.commentWizard = true;
		var menuData = this._map._docLayer.getCommentWizardStructure();
		this._map.fire('mobilewizard', {data: menuData});

		// if annotation is provided we can select particular comment
		if (annotation) {
			$('#comment' + annotation.sectionProperties.data.id).click();
		}
	},

	_saveMessageForReplay: function (textMsg, viewId) {
		// We will not get some messages (with coordinates)
		// from core when zoom changes because print-twips coordinates are zoom-invariant. So we need to
		// remember the last version of them and replay, when zoom is changed.
		// In calc we need to replay the messages when sheet-geometry changes too. This is because it is possible for
		// the updated print-twips messages to arrive before the sheet-geometry update message arrives.

		if (!this._printTwipsMessagesForReplay) {
			var ownViewTypes = this.isCalc() ? [
				'cellcursor',
				'referencemarks',
				'cellselectionarea',
				'textselection',
				'invalidatecursor',
				'textselectionstart',
				'textselectionend',
				'graphicselection',
			] : [
				'invalidatecursor',
				'textselection',
				'graphicselection'
			];

			if (this.isWriter())
				ownViewTypes.push('contentcontrol');

			var otherViewTypes = this.isCalc() ? [
				'cellviewcursor',
				'textviewselection',
				'invalidateviewcursor',
				'graphicviewselection',
			] : [
				'textviewselection',
				'invalidateviewcursor',
				'graphicviewselection'
			];

			this._printTwipsMessagesForReplay = new window.L.MessageStore(ownViewTypes, otherViewTypes);
		}

		var colonIndex = textMsg.indexOf(':');
		if (colonIndex === -1) {
			return;
		}

		var msgType = textMsg.substring(0, colonIndex);
		this._printTwipsMessagesForReplay.save(msgType, textMsg, viewId);
	},

	_clearMsgReplayStore: function (notOtherMsg) {
		if (!this._printTwipsMessagesForReplay) {
			return;
		}

		this._printTwipsMessagesForReplay.clear(notOtherMsg);
	},

	_replayPrintTwipsMsgs: function (differentSheet) {
		if (!this._printTwipsMessagesForReplay) {
			return;
		}

		this._printTwipsMessagesForReplay.forEach(function (msg) {
			// don't try and replace graphic selection if the sheet/page has changed
			var skipMessage = differentSheet && msg.startsWith('graphicselection:');
			if (!skipMessage)
				this._onMessage(msg);
		}.bind(this));
	},

	_replayPrintTwipsMsg: function (msgType) {
		var msg = this._printTwipsMessagesForReplay.get(msgType);
		this._onMessage(msg);
	},

	_replayPrintTwipsMsgAllViews: function (msgType) {
		Object.keys(this._map._viewInfo).forEach(function (viewId) {
			var msg = this._printTwipsMessagesForReplay.get(msgType, parseInt(viewId));
			if (msg)
				this._onMessage(msg);
		}.bind(this));
	},

	_syncTilePanePos: function () {
		if (this._container) {
			var mapPanePos = this._map._getMapPanePos();
			window.L.DomUtil.setPosition(this._container, new cool.Point(-mapPanePos.x , -mapPanePos.y));
		}
		var documentBounds = this._map.getPixelBoundsCore();
		var documentPos = documentBounds.min;
		var documentEndPos = documentBounds.max;

		const size = [documentEndPos.x - documentPos.x, documentEndPos.y - documentPos.y];

		app.activeDocument.activeLayout.viewedRectangle = new cool.SimpleRectangle(
			documentPos.x * app.pixelsToTwips, documentPos.y * app.pixelsToTwips, size[0] * app.pixelsToTwips, size[1] * app.pixelsToTwips
		);
	},

	/*
	 * VULCAN (slides-blank-zoom): the painted world's viewport top-left, in
	 * the map's document core pixels.
	 *
	 * On phone Impress the pixels on screen come from the SECTION world —
	 * activeLayout.viewedRectangle / scrollProperties with the document
	 * anchor — while tile fetch, tilecombine culling and the pinch commit
	 * all read the leaflet map's view. The two are allowed to part company:
	 * the read-posture deck scroll moves only the layout, and
	 * ViewLayoutFileBased.restoreScrollAnchor deliberately re-anchors the
	 * painted world on zoomend (a zoom keeps you on the slide you were
	 * reading) with no corresponding map write. MEASURED on build #5 (i2b
	 * two-worlds trace): one pinch left the map a constant ~13.5k twips off
	 * the painted world; the next pinch committed the map viewport at
	 * y=16803..21043 on a 10,801-twip slide — tilecombine followed the
	 * bogus rect, haveAllTilesInView() read true, and the canvas painted
	 * background until the next gesture.
	 *
	 * canvasToDocumentPoint owns the anchor on every layout, and feeding it
	 * the document anchor's own canvas position yields exactly the painted
	 * viewport's top-left: for ViewLayoutBase that is the viewedRectangle
	 * corner (the map-following world, so reconciling there is a no-op),
	 * and for the MultiPage/FileBased override it is scroll viewX/viewY
	 * mapped into stacked document space. Null when no layout can answer.
	 */
	_vulcanPaintedWorldTopLeft: function () {
		const layout = app.activeDocument && app.activeDocument.activeLayout;
		if (!layout || typeof layout.canvasToDocumentPoint !== 'function')
			return null;
		if (!app.sectionContainer ||
			typeof app.sectionContainer.getDocumentAnchorSection !== 'function' ||
			!app.sectionContainer.getDocumentAnchorSection())
			return null;
		const anchor = app.sectionContainer.getDocumentAnchor();
		const topLeft = layout.canvasToDocumentPoint(
			cool.SimplePoint.fromCorePixels([anchor[0], anchor[1]]));
		if (isNaN(topLeft.pX) || isNaN(topLeft.pY)) return null;
		return new cool.Point(topLeft.pX, topLeft.pY);
	},

	/*
	 * Reconcile the leaflet map onto the painted section world: a pan-only
	 * setView at the current zoom, taken when the two viewports have
	 * drifted apart. Phone chrome only. Where the painted world follows the
	 * map by construction (the part-based layouts through _syncTilePanePos)
	 * this is a structural no-op; where it does not (fileBasedView), this
	 * is the one writer that brings the map back. Called from
	 * MouseControl.onMultiTouchStart — so the whole pinch pipeline,
	 * _getZoomDocPos's panePortion included, computes against a truthful
	 * pane — and from _vulcanClampCommittedView below. Returns whether a
	 * setView was taken.
	 */
	_vulcanReconcileMapToPaintedWorld: function () {
		if (!this._vulcanPhoneChrome()) return false;
		const painted = this._vulcanPaintedWorldTopLeft();
		if (!painted) return false;
		const bounds = this._map.getPixelBoundsCore();
		if (Math.abs(bounds.min.x - painted.x) < 2 &&
			Math.abs(bounds.min.y - painted.y) < 2)
			return false;
		const size = bounds.getSize();
		this._map.setView(
			this._map.unproject(
				new cool.Point(
					(painted.x + size.x / 2) / app.dpiScale,
					(painted.y + size.y / 2) / app.dpiScale)),
			this._map.getZoom());
		return true;
	},

	/*
	 * The other direction: scroll the PAINTED section world onto the map's
	 * committed viewport. The zoom commit's map center is the one carrier
	 * of the pinch anchor — MouseControl latched the document point under
	 * the fingers through the section world and every zoom frame and the
	 * commit's _getZoomMapCenter kept it — while the layout's own zoomend
	 * re-anchor (ViewLayoutFileBased.restoreScrollAnchor) preserves only
	 * the TOP-EDGE part+fraction and knows nothing of the gesture.
	 *
	 * MEASURED on build #6 (g5c frozen-viewport trace, Dinosaurs dpr3): a
	 * center-anchored pinch from the opening fit committed with the
	 * section world back at the deck top (scrollProperties viewY=0 after
	 * BOTH rungs, 3->9->15) because the top-edge anchor at the open IS the
	 * deck top; the shipped map->painted reconcile then yanked the map
	 * onto that stale painted world (leaflet {6,0,2364,4240} — on-slide,
	 * so the on-part belt below reads "nothing to heal"), and at zoom 15
	 * the viewport is the featureless white top-left corner of slide 1:
	 * a solid-white paint of CORRECT tiles, reported as a frozen viewport.
	 *
	 * So the painted world follows the commit FIRST — a scroll by
	 * (map - painted), both read as stacked-document core pixels
	 * (_vulcanPaintedWorldTopLeft converts through canvasToDocumentPoint,
	 * which owns the anchor; the delta is frame-invariant because the
	 * view<->document x/y mappings differ by per-part constants). The
	 * layout's scroll() applies its own clamps and re-runs the tile queue
	 * (updateViewData), exactly what the tile wait below needs. Returns
	 * whether a scroll was taken.
	 */
	_vulcanCommitPaintedWorldToMap: function () {
		if (!this._vulcanPhoneChrome()) return false;
		const layout = app.activeDocument && app.activeDocument.activeLayout;
		if (!layout || typeof layout.scroll !== 'function') return false;
		const painted = this._vulcanPaintedWorldTopLeft();
		if (!painted) return false;
		const mapTopLeft = this._map.getPixelBoundsCore().min;
		const dX = mapTopLeft.x - painted.x;
		const dY = mapTopLeft.y - painted.y;
		if (Math.abs(dX) < 2 && Math.abs(dY) < 2) return false;
		layout.scroll(dX, dY);
		return true;
	},

	/*
	 * VULCAN belt (slides-blank-zoom): a committed zoom must land the map
	 * viewport where painted content exists. Runs right after the commit's
	 * mapUpdater in the painter's zoomStepEnd finishing block, before the
	 * tile wait starts polling — converting ANY residual drift, whatever
	 * produces it next, into a correct paint instead of a multi-second
	 * blank at rest. Scoped per doctype:
	 *
	 *  - fileBasedView (the read-posture deck; Draw/PDF): the map's
	 *    committed viewport carries the pinch anchor and the layout's
	 *    zoomend re-anchor does not (it keeps the top edge, not the
	 *    gesture — the build-#6 frozen-viewport residual), so the PAINTED
	 *    world scrolls onto the map first
	 *    (_vulcanCommitPaintedWorldToMap). Then the reconcile pulls the
	 *    map onto wherever the layout's clamps actually let the painted
	 *    world land — a commit past the deck end settles at the end, on
	 *    both worlds. Where the two already agree both halves are no-ops:
	 *    multi-part scrolling legitimately parks the viewport across slide
	 *    boundaries, so "inside the current part" is not an invariant this
	 *    view can assert.
	 *  - every part-based world (Impress edit posture, Writer, Calc): the
	 *    painted world follows the map by construction, so the only
	 *    independent truth is the document bounds. If the committed
	 *    viewport does not intersect them at all — a state that is blank
	 *    by definition — clamp the center onto the document. Impress edit
	 *    posture's document IS the current part, so this is "clamp onto
	 *    the part"; Writer and Calc cannot reach the state today and are
	 *    only belted.
	 *
	 * Phone chrome only; desktop and tablet keep the stock pipeline.
	 */
	_vulcanClampCommittedView: function () {
		if (!this._vulcanPhoneChrome()) return;
		if (app.file.fileBasedView) {
			this._vulcanCommitPaintedWorldToMap();
			this._vulcanReconcileMapToPaintedWorld();
			return;
		}
		if (!(this._docWidthTwips > 0) || !(this._docHeightTwips > 0)) return;
		const bounds = this._map.getPixelBounds();
		const min = this._pixelsToTwips(bounds.min);
		const max = this._pixelsToTwips(bounds.max);
		if (max.x > 0 && max.y > 0 &&
			min.x < this._docWidthTwips && min.y < this._docHeightTwips)
			return; // The viewport holds document: nothing to heal.
		const center = new cool.Point(
			Math.min(Math.max((min.x + max.x) / 2, 0), this._docWidthTwips),
			Math.min(Math.max((min.y + max.y) / 2, 0), this._docHeightTwips));
		this._map.setView(
			this._twipsToIntern(center, this._map.getZoom()),
			this._map.getZoom());
	},

	pauseDrawing: function () {
		if (this._painter && app.sectionContainer)
			app.sectionContainer.pauseDrawing();
	},

	resumeDrawing: function (topLevel) {
		if (this._painter && app.sectionContainer)
			app.sectionContainer.resumeDrawing(topLevel);
	},

	// used in Calc, see CalcTileLayer
	allowDrawing: function() {},

	enableDrawing: function () {
		if (this._painter && app.sectionContainer)
			app.sectionContainer.enableDrawing();
	},

	_getUIWidth: function () {
		var section = app.sectionContainer.getSectionWithName(app.CSections.RowHeader.name);
		if (section) {
			return Math.round(section.size[0] / app.dpiScale);
		}
		else {
			return 0;
		}
	},

	_getUIHeight: function () {
		var section = app.sectionContainer.getSectionWithName(app.CSections.ColumnHeader.name);
		if (section) {
			return Math.round(section.size[1] / app.dpiScale);
		}
		else {
			return 0;
		}
	},

	_getGroupWidth: function () {
		var section = app.sectionContainer.getSectionWithName(app.CSections.RowGroup.name);
		if (section) {
			return Math.round(section.size[0] / app.dpiScale);
		}
		else {
			return 0;
		}
	},

	_getGroupHeight: function () {
		var section = app.sectionContainer.getSectionWithName(app.CSections.ColumnGroup.name);
		if (section) {
			return Math.round(section.size[1] / app.dpiScale);
		}
		else {
			return 0;
		}
	},

	_getTilesSectionRectangle: function () {
		var section = app.sectionContainer.getSectionWithName(app.CSections.Tiles.name);
		if (section) {
			return app.LOUtil.createRectangle(section.myTopLeft[0] / app.dpiScale, section.myTopLeft[1] / app.dpiScale, section.size[0] / app.dpiScale, section.size[1] / app.dpiScale);
		}
		else {
			return app.LOUtil.createRectangle(0, 0, 0, 0);
		}
	},

	_getRealMapSize: function() {
		this._map._sizeChanged = true; // force using real size
		return this._map.getPixelBounds().getSize();
	},

	_getDocumentContainerSize: function() {
		let documentContainerSize = document.getElementById('document-container').getBoundingClientRect();
		documentContainerSize = [documentContainerSize.width, documentContainerSize.height];
		return documentContainerSize;
	},

	_resizeMapElementAndTilesLayer: function(sizeRectangle) {
		const mapElement = document.getElementById('map'); // map's size = tiles section's size.
		mapElement.style.left = sizeRectangle.getPxX1() + 'px';
		mapElement.style.top = sizeRectangle.getPxY1() + 'px';
		mapElement.style.width = sizeRectangle.getPxWidth() + 'px';
		mapElement.style.height = sizeRectangle.getPxHeight() + 'px';

		this._container.style.width = sizeRectangle.getPxWidth() + 'px';
		this._container.style.height = sizeRectangle.getPxHeight() + 'px';
	},

	_mobileChecksAfterResizeEvent: function(heightIncreased) {
		if (!window.mode.isSmallScreenDevice()) return;

		const hasMobileWizardOpened = this._map.uiManager.mobileWizard ? this._map.uiManager.mobileWizard.isOpen() : false;
		const hasIframeModalOpened = $('.iframe-dialog-modal').is(':visible');
		// when integrator has opened dialog in parent frame (eg. save as) we shouldn't steal the focus
		const focusedUI = document.activeElement === document.body;
		if (!hasMobileWizardOpened && !hasIframeModalOpened && !focusedUI) {
			if (heightIncreased) {
				// if the keyboard is hidden - be sure we setup correct state in TextInput
				this._map.setAcceptInput(false);
			} else {
				/*
					A SHRINKING RESIZE MUST NOT MOVE X ON PHONE IMPRESS.

					`_onUpdateCursor(true)` ends in `scrollToPos`, which moves
					BOTH axes whenever the caret's column is off screen. That is
					the displacement `_nonDesktopChecksAfterResizeEvent` below
					was already narrowed to a y-only reveal for -- and the two
					run from the SAME `_syncTileContainerSize` pass, on the same
					`heightIncreased === false` branch, against the same caret.
					So the narrowing covered one half of one caller: the panTo
					honoured it and this call still slammed the slide sideways.
					Measured on prod 8/24 (robert-08) at the read -> edit flip,
					where the keyboard provided the resize and the caret was the
					read posture's leftover: 117 CSS px off-screen left. The flip
					retires that caret now (ImpressTileLayer.
					_vulcanReanchorPartBasedFlip); every LATER resize still
					reaches this line with whatever caret the edit posture holds.

					Refusing the scroll leaves the overlay refresh, which is what
					this call is for, and leaves the vertical follow to the
					sibling that already owns it -- so no caret goes unrevealed.

					Phone Impress only; substituting `false` for
					`_vulcanPhoneChrome()` passes `true`, which is stock.
				*/
				const vulcanPhoneImpress =
					this.isImpress() && this._vulcanPhoneChrome();
				this._onUpdateCursor(/* scroll */ !vulcanPhoneImpress);
			}
		}
	},

	_nonDesktopChecksAfterResizeEvent: function(heightIncreased) {
		// We want to keep cursor visible when we show the keyboard on mobile device or tablet
		if (!window.mode.isSmallScreenDevice() && !window.mode.isTablet()) return;

		const hasVisibleCursor = app.file.textCursor.visible
			&& this._map._docLayer._cursorMarker && this._map._docLayer._cursorMarker.isDomAttached();
		if (!heightIncreased && this._map._docLoaded && hasVisibleCursor) {
			const cursorPos = this._map._docLayer._twipsToIntern({ x: app.file.textCursor.rectangle.x1, y: app.file.textCursor.rectangle.y2 });
			const cursorPositionInView = this._isInternInView(cursorPos);
			if (!cursorPositionInView) {
				// Under phone chrome a keyboard shrink must never move x:
				// panTo recenters BOTH axes and can slam the caret column to
				// the left edge. Reuse VulcanCaretReveal's y-only contract;
				// its deferred controller pass then recomputes to 0.
				if (this._vulcanPhoneChrome())
					this._vulcanRevealCaretVertically();
				else
					this._map.panTo(cursorPos);
			}
		}
	},

	_vulcanRevealCaretVertically: function () {
		const layout = app.activeDocument.activeLayout;
		const band = layout.viewedRectangle;
		const caret = app.file.textCursor.rectangle;
		if (!band || !caret || !app.sectionContainer)
			return;
		const scroll = app.sectionContainer.getSectionWithName(app.CSections.Scroll.name);
		if (!scroll || typeof scroll.scrollVerticalWithOffset !== 'function')
			return;
		// Against the band PLUS any scroll already queued this turn: one resize
		// runs this more than once (B-0219 in Writer, B-0294 on an Android
		// Impress retap; see revealCaretVertically).
		VulcanCaretReveal.revealCaretVertically(
			band, caret, VulcanCaretReveal.pendingVerticalScrollCorePx(layout),
			VulcanCaretReveal.MARGIN_CSS_PX * app.dpiScale,
			(dy) => scroll.scrollVerticalWithOffset(dy));
	},

	/*
		THE EDIT POSTURE HAS NO RE-CENTRE AND EVERY CONTAINER RESIZE NEEDS ONE.

		`_syncTileContainerSize` ends by re-imposing the map's own centre on the
		freshly measured pane. In the READ posture that centre is rebuilt from
		the new width a few lines further down: `ViewLayoutFileBased.reset()`
		re-bakes every part's X origin against the container's view size, so a
		displaced deck is put back on the next resize. The EDIT posture swaps in
		`ViewLayoutBase`, which has no such pass, and the only thing between the
		collapsed single-slide extent and the new pane is `_limitCenter` -- which
		clamps to the nearest EDGE of maxBounds, not to the slide. The result is
		a one-way ratchet: any X the view picks up while editing is re-imposed by
		every later resize and nothing ever puts it back.

		That is what makes this the residual half of the flip fix rather than a
		second opinion about it. `_vulcanReanchorPartBasedFlip` retires the two
		pre-flip origins AT THE FLIP; the paths that can displace X afterwards --
		the caret follow directly above, the entry/exit text zoom, an engine
		scroll -- all land in the same posture, and the read posture's recovery
		is not reachable from there. The resize is not a rare carrier either: the
		ResizeObserver on #document-container runs this on the software keyboard,
		a bottom sheet, the notes strip, browser chrome retracting and rotation.

		X ONLY, AND ONLY WITH NO HORIZONTAL FREEDOM. A slide narrower than the
		pane has no pan to preserve -- every X offset it can hold is slack -- so
		re-seating on the slide's own centre cannot discard a gesture. Once the
		user pinches past fit the slide is WIDER than the pane, that offset IS
		their pan, and this returns the map's centre untouched. The Y axis is
		left alone at both sizes: the height-moving resizes are the keyboard and
		the sheets, i.e. exactly the moments a caret owns the vertical position,
		and a re-centre would fight the reveal that serves it.

		DELIBERATELY NOT INSIDE `_fitWidthZoom`. The measured trigger was a
		keyboard-provided resize -- height only -- and in portrait
		`VulcanImpressFit.shouldSkipRefit` returns before `_fitWidthZoom`
		computes anything, correctly, because the portrait fit does not read the
		height. A centring correction placed past that guard would be absent from
		the one path the prod trace named.

		Phone Impress only; substituting `false` for `_vulcanPhoneChrome()`
		returns the map's own centre, which is the argument that shipped.
	*/
	_vulcanImpressResizeCenter: function () {
		const center = this._map.getCenter();
		if (!this.isImpress() || !this._vulcanPhoneChrome()) return center;
		if (!this._map._docLoaded || app.file.fileBasedView) return center;

		const slideCss = app.activeDocument.fileSize.pX / app.dpiScale;
		if (!(slideCss > 0)) return center;
		if (slideCss > this._map.getSize().x) return center;

		const centerPx = this._map.project(center);
		centerPx.x = slideCss / 2;
		return this._map.unproject(centerPx);
	},

	_syncTileContainerSize: function () {
		if (!this._map) return;

		if (this.isImpress() || this.isDraw()) this.onResizeImpress();

		if (!this._container) return;

		const documentContainerSize = this._getDocumentContainerSize();

		app.sectionContainer.onResize(documentContainerSize[0], documentContainerSize[1]); // Canvas's size = documentContainer's size.

		const oldSize = this._getRealMapSize();

		this._resizeMapElementAndTilesLayer(this._getTilesSectionRectangle());

		const newSize = this._getRealMapSize();
		const heightIncreased = oldSize.y < newSize.y;
		const widthIncreased = oldSize.x < newSize.x;

		if (oldSize.x !== newSize.x || oldSize.y !== newSize.y)
			this._map.invalidateSize(false, oldSize);

		this._mobileChecksAfterResizeEvent(heightIncreased);

		this._fitWidthZoom();

		// Center the view w.r.t the new map-pane position using the current zoom.
		this._map.setView(this._vulcanImpressResizeCenter());

		this._nonDesktopChecksAfterResizeEvent(heightIncreased);

		if (heightIncreased || widthIncreased) {
			app.sectionContainer.requestReDraw();
			this._map.fire('sizeincreased');
		}

		//Recompute the file-based layout here, after the width has settled, so the
		//stacked pages stay centered.
		if (
			app.file.fileBasedView &&
			app.activeDocument.activeLayout.type === 'ViewLayoutFileBased'
		) {
			app.activeDocument.activeLayout.reset();
		}
	},

	hasSplitPanesSupport: function () {
		// Only enabled for Calc for now
		// It may work without this.options.sheetGeometryDataEnabled but not tested.
		// The overlay-pane with split-panes is still based on svg renderer,
		// and not available for VML or canvas yet.
		if (this.isCalc() &&
			this.options.sheetGeometryDataEnabled) {
			return true;
		}

		return false;
	},

	setZoomChanged: function (zoomChanged) {
		app.sectionContainer.setZoomChanged(zoomChanged);
	},

	onAdd: function (map) {
		this._initContainer();

		/*
			Because of special handling of delete and backspace chars, we need to know which Writer form is focused.
			When sending removeTextContext event to core side, we send the formID instead of the map id.
		*/
		this._formID = null;

		// Initiate selection handles.
		TextSelections.initiate();

		// Initiate cell selection handles.
		CellSelectionMarkers.initiate();

		if (this.isCalc()) {
			var cursorStyle = new CStyleData(this._cursorDataDiv);
			var weight = cursorStyle.getFloatPropWithoutUnit('border-top-width') * app.dpiScale;
			var color = cursorStyle.getPropValue('border-top-color');
			this._cellCursorSection = new CellCursorSection(color, weight);
			app.sectionContainer.addSection(this._cellCursorSection);
		}

		this._getToolbarCommandsValues();
		this._oleCSelections = new CSelections(undefined, this._canvasOverlay,
			this._selectionsDataDiv, this._map, false /* isView */, undefined, 'ole');
		this._references = new CReferences(this._canvasOverlay);
		this._sparklineGroupReferences = new CReferences(this._canvasOverlay);

		/*
		 * `recalculateZoomOnResize` sets this flag to `true`. Then in `_fitWidthZoom`
		 * we set the `recalcFirstFit` to `true` & set this flag to `false`. It helps
		 * deal with delayed resizes as the 'resize' events are fired separately from the
		 * UI code which triggers them.
		 */
		this._invalidateZoomFirstFit = false;
		this._includedCommentsInFirstFit = false;

		/*
		 * Phone Impress only: set by `zoomStepEnd` when the user ends a zoom
		 * gesture, read by `_fitWidthZoom` so a resize does not discard it.
		 * Cleared by an explicit 'Zoom to Fit Slide', and by a rotation.
		 *
		 * `_vulcanZoomedPortrait` is the orientation the pinch was taken in, and
		 * it is what makes the latch expire instead of latching for the session:
		 * `_fitWidthZoom` keeps the zoom only while the orientation still matches.
		 * It is read only when `_vulcanUserZoomed` is true, but it is seeded from
		 * the real orientation rather than a bare `false` so the pair is never in
		 * a state the device was not actually in.
		 *
		 * Note this runs on document LOAD, not on resize -- that is precisely why
		 * a latch cleared only here is a one-way door. Inert everywhere else.
		 */
		this._vulcanUserZoomed = false;
		this._vulcanZoomedPortrait = window.L.DomUtil.isPortrait();

		// One-shot: set by VulcanImpressTextEntry around its programmatic
		// edit-entry/exit zooms, spent by `zoomStepEnd` so those animated zooms
		// do not arm `_vulcanUserZoomed` as if the user had pinched.
		this._vulcanProgrammaticZoom = false;

		// The container width at which _fitWidthZoom last APPLIED a fit, and the
		// second of the two preconditions on its no-op guard. Zero rather than
		// undefined so the field has a stated value on every layer, and zero
		// specifically because `VulcanImpressFit.shouldSkipRefit` refuses any
		// baseline that is not > 0 -- a fit has to have happened before the
		// guard is allowed to skip one. Cleared here, i.e. per document load,
		// alongside the rest of the fit state.
		this._lastFitSizeX = 0;
		// The height baseline, cleared with the width one for the same
		// reason and on the same schedule. `shouldSkipRefit` refuses any
		// height baseline that is not > 0 in landscape, so zero here means
		// "no fit has landed" in both orientations rather than only one.
		this._lastFitSizeY = 0;
		// The zoom baseline, on the same schedule as the two above: zero means
		// "no fit has landed", which the first-ruler re-fit treats as "not
		// ours to re-fit".
		this._lastFitZoom = 0;
		this._vulcanWriterUserViewport = false;
		this._vulcanWriterFitInProgress = false;
		// Text-column geometry from `hrulerupdate`; 0 until core sends a real
		// payload, which is what makes textFitLevel fall back rather than guess.
		this._vulcanTextWidthMm100 = 0;
		this._vulcanPageWidthMm100 = 0;
		this._vulcanLeftMarginMm100 = 0;

		this._referencesAll = [];
		this._sparklineGroupReferencesAll = [];

		this._debug = map._debug;

		app.socket.sendMessage('commandvalues command=.uno:AcceptTrackedChanges');

		map._fadeAnimated = false;
		this._viewReset();

		map.on('dragover', this._onDragOver, this);
		map.on('drop', this._onDrop, this);

		map.on('zoomstart', this._onZoomStart, this);
		map.on('zoomend', this._onZoomEnd, this);
		if (this._docType === 'spreadsheet') {
			map.on('zoomend', this._onCellCursorShift, this);
		}
		map.on('error', this._mapOnError, this);
		if (map.options.autoFitWidth !== false) {
			// always true since autoFitWidth is never set
			map.on('resize', this._fitWidthZoom, this);
		}
		this._map.on('resize', this._syncTileContainerSize, this);
		// Retrieve the initial cell cursor position (as COKit only sends us an
		// updated cell cursor when the selected cell is changed and not the initial
		// cell).
		map.on('statusindicator',
			function (e) {
				if (e.statusType === 'alltilesloaded' && this._docType === 'spreadsheet') {
					if (!this._map.uiManager.isAnyDialogOpen())
						this._onCellCursorShift(true);
				}
			},
			this);

		app.events.on('updatepermission', function(e) {
			if (e.detail.perm !== 'edit') {
				this._clearSelections();
			}
			RenderManager.update();
		}.bind(this));

		map.setPermission(app.file.permission);

		map.fire('statusindicator', {statusType: 'coolloaded'});

		this._map.sendInitUNOCommands();

		this._resetClientVisArea();
		this._requestNewTiles();

		map.setZoom();

		// This is called when page size is increased
		// the content of the page that become visible may stay empty
		// unless we have the tiles in the cache already
		// This will only fetch the tiles which are invalid or does not exist
		map.on('sizeincreased', function() {
			RenderManager.update();
		}.bind(this));
	},

	onRemove: function (map) {
		window.L.DomUtil.remove(this._container);
		map._removeZoomLimit(this);
		this._container = null;
		this._tileZoom = null;
		RenderManager.clearPreFetch();
		clearTimeout(this._previewInvalidator);

		app.activeDocument.activeView.clearTextSelection();

		if (!this._oleCSelections.empty()) {
			this._oleCSelections.clear();
		}

		if (this._cursorMarker && this._cursorMarker.isDomAttached()) {
			this._cursorMarker.remove();
		}

		TextSelections.dispose();

		this._cancelMoveSettle();
		this._removeSplitters();
		window.L.DomUtil.remove(this._canvasContainer);
	},

	getEvents: function () {
		// Hold ONE throttled instance rather than building it inline, so the
		// lock survives across getEvents calls. _moveEnd no longer shares it
		// -- see the note there: a leading-edge throttle cannot answer "has
		// the gesture stopped", and sharing it deleted the settle.
		if (!this._moveThrottled)
			this._moveThrottled = app.util.throttle(this._moveThrottledUpdate, this.options.updateInterval, this);

		var events = {
			viewreset: this._viewReset,
			movestart: this._moveStart,
			// update tiles on move, but not more often than once per given interval
			move: this._moveThrottled,
			moveend: this._moveEnd,
			splitposchanged: this._move,
		};

		return events;
	},

	// zoom is the new intermediate zoom level (log scale : 1 to 14)
	zoomStep: function (zoom, newCenter) {
		this._painter.zoomStep(zoom, newCenter);
	},

	zoomStepEnd: function (zoom, newCenter, mapUpdater, runAtFinish, noGap) {
		// Pinches can reach setView directly without Map.setZoom.
		//
		// `isWriter` is read defensively for the same reason the PAINTER's copy of
		// this method reads `isCalc` and `isWriter` that way (:370, :393): the phone
		// pinch suites extract this method's SHIPPED TEXT and run it against a
		// minimal Impress layer stub, so a method the stub does not carry must read
		// as "not Writer" rather than throw. ImpressPhoneZoomLatch.test.ts happens to
		// stub `isWriter`; ImpressPhoneEditZoomAnimated.test.ts does not, and all
		// five of its cases died on "this.isWriter is not a function" -- the whole
		// fork mocha gate red -- until this read was made defensive.
		if (typeof this.isWriter === 'function' && this.isWriter() &&
			this._firstFitDone && !this._vulcanWriterFitInProgress &&
			document.documentElement.classList.contains('vulcan-desktop-chrome') &&
			zoom !== this._map.getZoom())
			this._vulcanWriterUserViewport = true;
		/*
		 * The one place a USER-CHOSEN zoom is knowable, which is what the phone
		 * Impress guard in `_fitWidthZoom` needs. Everything that ends a zoom
		 * gesture lands here: a pinch (MouseControl.onMultiTouchEnd), a
		 * ctrl+wheel (Map.Scroll), and the animated zoom controls
		 * (runZoomAnimation, reached from Map.setZoom when animate is true).
		 *
		 * `_fitWidthZoom` itself cannot reach this method: it calls
		 * `setZoom(zoom, {animate: false})`, and Map.setZoom takes `animate` as
		 * its THIRD argument -- which is undefined there -- so it goes down the
		 * non-animated branch and calls its mapUpdater directly. The automatic
		 * fit therefore cannot latch itself on.
		 *
		 * `_firstFitDone` gates the latch so nothing during document load can
		 * set it before the first fit has happened, and the zoom comparison
		 * keeps it meaning "the user CHANGED the zoom": the map has not been
		 * moved to `zoom` yet at this point -- that is what the mapUpdater
		 * passed in here goes on to do -- so `getZoom()` is still the zoom the
		 * gesture started from, and a two-finger touch that ends where it began
		 * leaves the automatic fit armed.
		 *
		 * The orientation is stamped alongside the latch, and that is what stops
		 * the latch being permanent. `_fitWidthZoom` keeps this zoom across a
		 * resize only while the device is still in the orientation the gesture
		 * happened in; a rotation is a size-class change and re-fits. Recording it
		 * HERE rather than deriving it later is the point -- "the box the user
		 * chose this zoom for" is only knowable at the moment they chose it.
		 */
		// One-shot exemption: a zoom REQUESTED BY CODE (VulcanImpressTextEntry's
		// edit-entry zoom and its exit restore) also lands here once animated,
		// and must not read as "the user chose this zoom". Spent unconditionally
		// so a call that never reaches the arm below still consumes it -- a real
		// pinch can never inherit the exemption.
		const vulcanProgrammaticZoom = this._vulcanProgrammaticZoom === true;
		this._vulcanProgrammaticZoom = false;

		if (!vulcanProgrammaticZoom
			&& this.isImpress() && this._firstFitDone && zoom !== this._map.getZoom()
			&& this._vulcanPhoneChrome()) {
			this._vulcanUserZoomed = true;
			this._vulcanZoomedPortrait = window.L.DomUtil.isPortrait();
		}

		this._painter.zoomStepEnd(zoom, newCenter, mapUpdater, runAtFinish, noGap);
	},

	preZoomAnimation: function (pinchStartCenter) {
		// A new zoom gesture must not race a pending release settle.
		this.flushVulcanPinchSettle();
		this._pinchStartCenter = this._map.project(pinchStartCenter).multiplyBy(app.dpiScale); // in core pixels
		this._painter._offset = new cool.Point(0, 0);
		// Snapshot the starting scale. Each zoom frame drives app.twipsToPixels
		// to base * _zoomFrameScale (see TilesSection.drawZoomFrame) so vector
		// document sections scale in lockstep with the tiles.
		this._painter._zoomBaseTwipsToPixels = app.twipsToPixels;

		if (this._cursorMarker && app.file.textCursor.visible) {
			this._cursorMarker.setOpacity(0);
		}
		if (this._map._textInput._cursorHandler)
			this._map._textInput._cursorHandler.setOpacity(0);

		TextSelections.hideHandles();

		TextCursorSection.updateVisibilities();
	},

	postZoomAnimation: function () {
		// The _cursorMarker guard mirrors preZoomAnimation's: a two-finger
		// tap can land here before the marker has ever been built.
		if (this._cursorMarker && app.file.textCursor.visible) {
			this._cursorMarker.setOpacity(1);
		}

		// Not setOpacity(1): on a phone the knob is tap-summoned and may be
		// mid-fade, and restoring it flat would put back what the fade removed.
		if (this._map._textInput._cursorHandler)
			this._map._textInput._cursorHandler.restoreOpacity();

		TextSelections.showHandles();

		if (this._annotations) {
			var annotations = this._annotations;
			if (annotations.update)
				setTimeout(function() {
					annotations.update();
				}, 250 /* ms */);
		}
	},

	// Meant for desktop case, where the ending zoom and centers are all known in advance.
	runZoomAnimation: function (zoomEnd, pinchCenter, mapUpdater, runAtFinish) {

		if (this._map.getDocType() === 'spreadsheet')
			OtherViewCellCursorSection.closePopups();

		// The 10-step ramp exists to hide tile latency behind scaled
		// stale frames. Vector Impress repaints the target zoom in a
		// single frame, and the ramp's only visible product there is the
		// transition stack of page chrome ("a deeper shadow for a
		// second") — so the discrete zoom lands noGap, like the pinch
		// settle above whose eased frames already closed the gap.
		var noGap = RenderManager.isVectorRendering();
		this.preZoomAnimation(pinchCenter);
		this.zoomStep(this._map.getZoom(), pinchCenter);
		var thisObj = this;
		this.zoomStepEnd(zoomEnd, pinchCenter,
			mapUpdater,
			// runAtFinish
			function () {
				thisObj.postZoomAnimation();
				runAtFinish();
			},
			noGap);
	},

	/*
	 * Phone pinch release. The rung commit is load-bearing (tiles address the
	 * rounded zoom), but stepping the view most of a rung in one frame reads
	 * as a jerk; Google holds the released scale. Close the gap on a clock
	 * instead: the SAME continuous zoomStep frames the live gesture just
	 * rendered, eased over pinchSettleDurationMs, then the commit through
	 * zoomStepEnd -- whose finishing block owns the user-zoom latch, the
	 * same-rung fast arms and the settle restore. noGap, because the eased
	 * frames have already closed the visual gap the 10-step finisher exists
	 * to close.
	 */
	runVulcanPinchSettleAnimation: function (fromZoom, zoomEnd, center, mapUpdater, runAtFinish) {
		this.flushVulcanPinchSettle();
		var thisObj = this;
		var startTime;
		this._vulcanPinchSettleCommit = function () {
			thisObj._vulcanPinchSettleCommit = undefined;
			thisObj._vulcanPinchSettleRAF = undefined;
			thisObj.zoomStepEnd(zoomEnd, center, mapUpdater, runAtFinish, true /* noGap */);
		};
		var frame = function (now) {
			// A flush landed the commit while this frame was queued.
			if (thisObj._vulcanPinchSettleCommit === undefined)
				return;
			if (startTime === undefined)
				startTime = now;
			var t = Math.min(1, (now - startTime) / thisObj.pinchSettleDurationMs);
			// Ease-out: fast off the finger, soft landing on the rung.
			var eased = t * (2 - t);
			thisObj.zoomStep(fromZoom + (zoomEnd - fromZoom) * eased, center);
			if (t < 1) {
				thisObj._vulcanPinchSettleRAF = requestAnimationFrame(frame);
				return;
			}
			thisObj._vulcanPinchSettleCommit();
		};
		this._vulcanPinchSettleRAF = requestAnimationFrame(frame);
	},

	pinchSettleDurationMs: 150,

	/*
	 * Land a pending release settle NOW; the commit is load-bearing, only its
	 * easing is optional. preZoomAnimation calls this so any newly starting
	 * zoom gesture begins from a committed rung. The programmatic-zoom
	 * exemption is parked across the commit: the flushed pinch is the USER's
	 * zoom and must judge the latch on its own, while the caller that raised
	 * the flag has not reached its own zoomStepEnd yet.
	 */
	flushVulcanPinchSettle: function () {
		if (!this._vulcanPinchSettleCommit)
			return;
		if (this._vulcanPinchSettleRAF !== undefined)
			cancelAnimationFrame(this._vulcanPinchSettleRAF);
		var programmatic = this._vulcanProgrammaticZoom;
		this._vulcanProgrammaticZoom = false;
		this._vulcanPinchSettleCommit();
		this._vulcanProgrammaticZoom = programmatic;
	},

	_viewReset: function (e) {
		this._reset(e && e.hard);
		if (this._docType === 'spreadsheet' && this._annotations !== undefined) {
			app.socket.sendMessage('commandvalues command=.uno:ViewAnnotationsPosition');
		}
	},

	_removeSplitters: function () {
		if (this._xSplitter) {
			this._canvasOverlay.removePath(this._xSplitter);
			this._xSplitter = undefined;
		}

		if (this._ySplitter) {
			this._canvasOverlay.removePath(this._ySplitter);
			this._ySplitter = undefined;
		}
	},

	_cssPixelsToCore: function (cssPixels) {
		return cssPixels.multiplyBy(app.dpiScale);
	},

	_twipsToCorePixels: function (twips) {
		return new cool.Point(
			twips.x * app.twipsToPixels,
			twips.y * app.twipsToPixels);
	},

	_twipsToCorePixelsBounds: function (twips) {
		return new cool.Bounds(
			this._twipsToCorePixels(twips.min),
			this._twipsToCorePixels(twips.max)
		);
	},

	_corePixelsToTwips: function (corePixels) {
		return new cool.Point(
			corePixels.x * app.pixelsToTwips,
			corePixels.y * app.pixelsToTwips);
	},

	_twipsToCssPixels: function (twips) {
		return new cool.Point(
			(twips.x / app.tile.size.x) * (RenderManager.tileSize / app.dpiScale),
			(twips.y / app.tile.size.y) * (RenderManager.tileSize / app.dpiScale));
	},

	_cssPixelsToTwips: function (pixels) {
		return new cool.Point(
			(pixels.x * app.dpiScale) * app.pixelsToTwips,
			(pixels.y * app.dpiScale) * app.pixelsToTwips);
	},

	_twipsToIntern: function (twips, zoom) {
		var pixels = this._twipsToCssPixels(twips);
		return this._map.unproject(pixels, zoom);
	},

	_internToTwips: function (intern, zoom) {
		var pixels = this._map.project(intern, zoom);
		return this._cssPixelsToTwips(pixels);
	},

	_twipsToPixels: function (twips) { // css pixels
		return this._twipsToCssPixels(twips);
	},

	_pixelsToTwips: function (pixels) { // css pixels
		return this._cssPixelsToTwips(pixels);
	},

	_updateMaxBounds: function (sizeChanged, allPages = true) {
		if (app.activeDocument.fileSize.x === 0 || app.activeDocument.fileSize.y === 0) {
			return;
		}

		var docPixelLimits = new cool.Point(app.activeDocument.fileSize.pX / app.dpiScale, app.activeDocument.fileSize.pY / app.dpiScale);
		var scrollPixelLimits = new cool.Point(app.activeDocument.activeLayout.viewSize.pX / app.dpiScale, app.activeDocument.activeLayout.viewSize.pY / app.dpiScale);
		var topLeft = this._map.unproject(new cool.Point(0, 0));
		// VULCAN: vector Impress editing keeps a HALF-INCH APRON of
		// space past the slide edge (720 twips of slide space) — a
		// zoomed-in view may keep that much off-slide context, and the
		// letterbox center is unchanged because the pad is symmetric.
		// The wheel-pan clamp carries the same apron (ViewLayout's
		// vulcanScrollPadCore).
		if ((this.isImpress() || this.isDraw()) && !app.file.fileBasedView &&
			window.RenderManager && RenderManager.isVectorRendering()) {
			var apronCss = 720 * app.twipsToPixels / app.dpiScale;
			topLeft = this._map.unproject(new cool.Point(-apronCss, -apronCss));
			scrollPixelLimits = scrollPixelLimits.add(new cool.Point(apronCss, apronCss));
		}
		// VULCAN: phone Writer READ scrolls a bottom apron past the
		// document's end (ViewLayoutWriter.vulcanBottomApronCore). The layout's
		// own clamp carries it, and these bounds must too: panBy's far-pan branch
		// (_limitCenterInsideDocument) stopped one apron short of the layout's
		// end, and a size change with the reader at the end (here, then
		// setMaxBounds -> panInsideBounds) pulled the view back up. Bottom only,
		// as in the layout, and 0 everywhere else, so every other bound is
		// unchanged.
		var bottomApronCss = this._vulcanBottomApronCss();
		if (bottomApronCss > 0)
			scrollPixelLimits = scrollPixelLimits.add(new cool.Point(0, bottomApronCss));

		if (this._documentInfo === '' || sizeChanged) {
			// we just got the first status so we need to center the document
			this._map.setMaxBounds(InternBoundsUtil.flexConstruct(topLeft, this._map.unproject(scrollPixelLimits)));
			this._vulcanBoundsApronCss = bottomApronCss;
		}

		this._docPixelSize = {x: docPixelLimits.x, y: docPixelLimits.y};
		if (allPages) this._map.fire('scrolllimits', {});
		else this._map.fire('scrolllimit', {})
	},

	// the layout's bottom apron in CSS px, 0 where it has none.
	_vulcanBottomApronCss: function () {
		var layout = app.activeDocument && app.activeDocument.activeLayout;
		if (!layout || typeof layout.vulcanBottomApronCore !== 'function')
			return 0;
		return layout.vulcanBottomApronCore() / app.dpiScale;
	},

	// the apron follows the posture and the host's strip, not the
	// document size, so the bounds _updateMaxBounds last built can miss it.
	// Rebuild them when the apron they carry is not the current one. Nothing
	// to do before any bounds are built, or for a layer that builds its own
	// (Calc), whose apron is always 0.
	_vulcanRefreshApronBounds: function () {
		if (this._vulcanBoundsApronCss === undefined)
			return;
		if (this._vulcanBottomApronCss() === this._vulcanBoundsApronCss)
			return;
		this._updateMaxBounds(true);
	},

	// Used with filebasedview.
	_getMostVisiblePart: function (queue) {
		var parts = [];
		var found = false;

		for (var i = 0; i < queue.length; i++) {
			for (var j = 0; j < parts.length; j++) {
				if (parts[j].part === queue[i].part) {
					found = true;
					break;
				}
			}
			if (!found)
				parts.push({part: queue[i].part});
			found = false;
		}

		const layout = app.activeDocument.activeLayout;
		const useLayoutRects = layout.viewRectangles && layout.viewRectangles.length === this._parts;
		var partHeightPixels = Math.round((this._partHeightTwips + this._spaceBetweenParts) * app.twipsToPixels);
		var partWidthPixels = Math.round(this._partWidthTwips * app.twipsToPixels);

		var rectangle;
		var maxArea = -1;
		// Use the actual canvas viewport instead of layout.viewedRectangle:
		// ViewLayoutFileBased inflates viewedRectangle to the full bounds of every
		// intersecting page, which would make all visible parts report the same
		// area here and freeze the selection on _selectedPart.
		let visibleRect;
		if (useLayoutRects) {
			const documentAnchor = app.sectionContainer.getSectionWithName(app.CSections.Tiles.name);
			visibleRect = [
				layout.scrollProperties.viewX,
				layout.scrollProperties.viewY,
				documentAnchor.size[0],
				documentAnchor.size[1],
			];
		} else {
			visibleRect = layout.viewedRectangle.pToArray();
		}
		const candidates = [];
		for (i = 0; i < parts.length; i++) {
			if (useLayoutRects) {
				const vr = layout.viewRectangles[parts[i].part];
				rectangle = [vr.pX1, vr.pY1, vr.pWidth, vr.pHeight];
			} else {
				rectangle = [0, partHeightPixels * parts[i].part, partWidthPixels, Math.round(this._partHeightTwips * app.twipsToPixels)];
			}
			rectangle = app.LOUtil._getIntersectionRectangle(rectangle, visibleRect);
			if (rectangle) {
				const currentArea = rectangle[2] * rectangle[3];
				if (currentArea > maxArea) {
					candidates.length = 0;
					maxArea = currentArea;
					candidates.push({part: parts[i].part, area: currentArea});
				}
				else if (currentArea === maxArea)
					candidates.push({part: parts[i].part, area: currentArea});
			}
		}

		// If one of the most visible parts is the selected part, return it.
		for (let i = 0; i < candidates.length; i++) {
			if (candidates[i].area === maxArea && candidates[i].part === this._selectedPart) {
				return this._selectedPart;
			}
		}

		// Otherwise return the first most visible part.
		return candidates[0].part;
	},

	highlightCurrentPart: function (part) {
		var previews = document.getElementsByClassName('preview-frame');
		for (var i = 0; i < previews.length; i++) {
			const img = previews[i].querySelector('img');
			if (parseInt(previews[i].id.replace('preview-frame-part-', '')) === part) {
				window.L.DomUtil.addClass(img, 'preview-img-currentpart');
			}
			else {
				window.L.DomUtil.removeClass(img, 'preview-img-currentpart');
			}
		}
	},

	// Used with file based view. Check the most visible part and set the selected part if needed.
	//
	// The filmstrip scroll is INSIDE the part-changed guard. It used to sit
	// after it and run on every call, which was survivable while the callers
	// were a wheel notch, a scrollbar-drag frame and a layout reset, and
	// stopped being survivable when MouseControl.reconcileVulcanFileBasedPart
	// added a touch-drag frame and a kinetic-fling draw frame: a pan across one
	// slide then asked _scrollToPart to move the strip dozens of times, and
	// every one of those asks reached a scrollIntoView that walks the page.
	// VulcanFilmstripFollow.planReconcile holds the guard, and its test pins
	// that scrollStrip is never true for an unchanged part.
	_checkSelectedPart: function () {
		var queue = RenderManager.updateFileBasedView(true);
		if (queue.length > 0) {
			var partToSelect = this._getMostVisiblePart(queue);
			var plan = VulcanFilmstripFollow.planReconcile(this._selectedPart, partToSelect);
			if (plan.notifyServer) {
				this._selectedPart = partToSelect;
				app.socket.sendMessage('setclientpart part=' + this._selectedPart);
				this._map.fire('setpart', {
					selectedPart: this._selectedPart,
					parts: this._parts,
					docType: this._docType
				});
			}
			if (plan.scrollStrip)
				this._preview._scrollToPart();
			if (plan.highlight)
				this.highlightCurrentPart(partToSelect);
		}
	},

	// Update debug overlay for a tile
	_showDebugForTile: function(key) {
		if (!this._debug.debugOn)
			return;

		const tile = RenderManager.get(key);
		tile._debugTime = this._debug.getTimeArray();
	},

	_coordsToPixBounds: function (coords) {
		// coords.x and coords.y are the pixel coordinates of the top-left corner of the tile.
		var topLeft = new cool.Point(coords.x, coords.y);
		var bottomRight = topLeft.add(new cool.Point(RenderManager.tileSize, RenderManager.tileSize));
		return new cool.Bounds(topLeft, bottomRight);
	},

	hasXSplitter: function () {
		return !!(this._xSplitter);
	},

	hasYSplitter: function () {
		return !!(this._ySplitter);
	},

	getTileSectionPos: function () {
		return this._painter.getTileSectionPos();
	},

	isCalcRTL: function () {
		return !!(this.isCalc() && app.calc && app.calc.isRTL && app.calc.isRTL());
	}

});

window.L.MessageStore = window.L.Class.extend({

	// ownViewTypes : The types of messages related to own view.
	// otherViewTypes: The types of messages related to other views.
	initialize: function (ownViewTypes, otherViewTypes) {

		if (!Array.isArray(ownViewTypes) || !Array.isArray(otherViewTypes)) {
			window.app.console.error('Unexpected argument types');
			return;
		}

		var ownMessages = {};
		ownViewTypes.forEach(function (msgType) {
			ownMessages[msgType] = '';
		});
		this._ownMessages = ownMessages;

		var othersMessages = {};
		otherViewTypes.forEach(function (msgType) {
			othersMessages[msgType] = [];
		});
		this._othersMessages = othersMessages;
	},

	clear: function (notOtherMsg) {
		var msgs = this._ownMessages;
		Object.keys(msgs).forEach(function (msgType) {
			msgs[msgType] = '';
		});

		if (!notOtherMsg) {
			msgs = this._othersMessages;
			Object.keys(msgs).forEach(function (msgType) {
				msgs[msgType] = [];
			});
		}
	},

	save: function (msgType, textMsg, viewId) {

		var othersMessage = (typeof viewId === 'number');

		if (!othersMessage && Object.prototype.hasOwnProperty.call(this._ownMessages, msgType)) {
			this._ownMessages[msgType] = textMsg;
			return;
		}

		if (othersMessage && Object.prototype.hasOwnProperty.call(this._othersMessages, msgType)) {
			this._othersMessages[msgType][viewId] = textMsg;
		}
	},

	get: function (msgType, viewId) {

		var othersMessage = (typeof viewId === 'number');

		if (!othersMessage && Object.prototype.hasOwnProperty.call(this._ownMessages, msgType)) {
			return this._ownMessages[msgType];
		}

		if (othersMessage && Object.prototype.hasOwnProperty.call(this._othersMessages, msgType)) {
			return this._othersMessages[msgType][viewId];
		}
	},

	forEach: function (callback) {
		if (typeof callback !== 'function') {
			window.app.console.error('Invalid callback type');
			return;
		}

		this._cleanUpSelectionMessages(this._ownMessages);

		var ownMessages = this._ownMessages;
		Object.keys(this._ownMessages).forEach(function (msgType) {
			callback(ownMessages[msgType]);
		});

		var othersMessages = this._othersMessages;
		Object.keys(othersMessages).forEach(function (msgType) {
			othersMessages[msgType].forEach(callback);
		});
	},

	_cleanUpSelectionMessages: function(messages) {
		// must be called only from _replayPrintTwipsMsg !!
		// check if textselection is empty
		// if it is, we need to handle textselectionstart and textselectionend
		// otherwise we get handles without selection and they also may appear in the wrong cell
		// but it is also reproducible on the same cell too. e.g. selection handles without selection
		if (!messages && !messages['textselection'] && messages['textselection'] !== 'textselection: ')
			return;
		messages['textselectionstart'] = 'textselectionstart: ';
		messages['textselectionend'] = 'textselectionend: ';
	}
});
