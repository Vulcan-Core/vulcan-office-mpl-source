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

describe('ViewLayout', function() {

var _ = function(text: string) { return text; };

class ResizeObserver {
	constructor(f: Function) {}

	disconnect() {}

	observe() {}

	unobserve() {}
}

function initializeJSDOM() {
	addCanvasToDom();
	addMockCanvas(window);
	global.requestAnimationFrame = window.requestAnimationFrame;
	global.cancelAnimationFrame = window.cancelAnimationFrame;
	// DocumentBase / TableMiddleware call bare `getComputedStyle(...)`.
	// In the browser it's a window global; in node we forward to jsdom's.
	global.getComputedStyle = window.getComputedStyle.bind(window);
	global.ResizeObserver = ResizeObserver;

	const canvasWidth = 1024;
	const canvasHeight = 768;
	setupCanvasContainer(canvasWidth, canvasHeight);
	app.events = new DocEvents();
}

describe('View Layout Tests', function () {
    this.beforeAll(initializeJSDOM);

	// Install the app-level stubs.
	function setupAppStubs(pixelsToTwips: number): void {
		// CSections read by MouseControl / TextSelectionSection field
		// initialisers. Values mirror browser/src/canvas/CanvasSectionProps.js.
		(app.CSections as any).MouseControl = {
			name: 'mouse-control', zIndex: 5,
			processingOrder: 72, drawingOrder: 51,
		};
		(app.CSections as any).Tiles = {
			name: 'tiles', zIndex: 5,
			processingOrder: 60, drawingOrder: 50,
		};
		(app.CSections as any).TextSelection = {
			name: 'text selection', zIndex: 5,
			processingOrder: 74, drawingOrder: 52,
		};

		// app.file is populated by docstate.ts in the browser. ViewLayoutMultiPage
		// reset() reads app.file.writer.pageRectangleList.
		(app as any).file = { writer: { pageRectangleList: [] } };

		// Use the real twips/pixel convention (1 pixel = 15 twips by default).
		app.pixelsToTwips = pixelsToTwips;
		app.twipsToPixels = 1 / pixelsToTwips;

		// app.map stub.
		app.map = {
			on: function () {},
			uiManager: null,
			_docLayer: {
				_docType: 'text',
				isWriter: function () { return true; },
				_sendClientZoom: function () {},
			},
			getScaleZoom: function () { return 1; },
			setZoom: function () {},
			getZoom: function () { return 10; },
		} as any;

		// sendTileCombineMessage reads app.tile.size.{x,y} and calls
		// app.socket.sendMessage. Provide both.
		(app.tile as any).size = { x: 3840, y: 3840 };
		(app.socket as any).sendMessage = function () {};

		// The tile grid is enumerated in steps of window.tileSize pixels. The
		// browser sets this from the server; tests fix it at 256 pixels, which
		// matches a 3840 twip tile at the default 15 twips per pixel.
		window.tileSize = 256;

		// CanvasSectionContainer.getDocumentAnchorSection returns null until a
		// section has been registered as the anchor. adjustViewZoomLevel and
		// refreshCurrentCoordList both dereference .size, so give it a minimal
		// section-like object. The size matches setupCanvasContainer(1024, 768).
		(app.sectionContainer as any).getDocumentAnchorSection = function () {
			return { size: [1024, 768], myTopLeft: [0, 0] };
		};
	}

	// Record every tile-combine request the production code sends. The return
	// value includes a `sentRequests` history array (grown in-place on every
	// call) and a `restore` hook to revert the patch.
	function instrumentTileCombineRequests(tileManager: any): {
		sentRequests: Array<Array<TileCoordData>>;
		restore: () => void;
	} {
		const sentRequests: Array<Array<TileCoordData>> = [];
		const original: Function = tileManager.sendTileCombineRequest;
		tileManager.sendTileCombineRequest = function (queue: Array<TileCoordData>) {
			if (queue.length > 0) {
				// Snapshot: the caller may mutate the queue after returning.
				sentRequests.push(queue.slice());
			}
			original.call(tileManager, queue);
		};
		return {
			sentRequests,
			restore: () => {
				tileManager.sendTileCombineRequest = original;
			},
		};
	}

	// Observe bitmap production & reclamation. The state machine:
	// `renderedKeys` is the set of tiles currently considered to have a
	// produced image. Every visible tile ends up here once the
	// request/response round-trip completes.
	function instrumentTileRendering(tileManager: any): {
		renderedKeys: Set<string>;
		restore: () => void;
	} {
		const renderedKeys: Set<string> = new Set();
		const origSet: Function = tileManager.setBitmapOnTile;
		const origCreate: Function = tileManager.createTileBitmap;
		const origReclaim: Function = tileManager.reclaimTileBitmapMemory;

		tileManager.setBitmapOnTile = function (tile: Tile, bitmap: ImageBitmap) {
			renderedKeys.add(tile.coords.key());
			return origSet.call(tileManager, tile, bitmap);
		};
		tileManager.createTileBitmap = function (
			tile: Tile,
			delta: any,
			deltas: any[],
			bitmaps: Promise<ImageBitmap>[],
		) {
			renderedKeys.add(tile.coords.key());
			return origCreate.call(tileManager, tile, delta, deltas, bitmaps);
		};
		tileManager.reclaimTileBitmapMemory = function (tile: Tile) {
			renderedKeys.delete(tile.coords.key());
			return origReclaim.call(tileManager, tile);
		};

		return {
			renderedKeys,
			restore: () => {
				tileManager.setBitmapOnTile = origSet;
				tileManager.createTileBitmap = origCreate;
				tileManager.reclaimTileBitmapMemory = origReclaim;
			},
		};
	}

	// Stand in for the browser receiving a rendered bitmap for `tile`: bump
	// wireId so needsFetch() returns false, then drive the real
	// setBitmapOnTile path with a stand-in bitmap so the test can move past
	// the request/response boundary without wiring up fzstd +
	// createImageBitmap. Ordering mirrors BitmapTileManager.onTileMsg.
	function simulateTileArrival(tileManager: any, tile: Tile): void {
		if (tile.wireId === 0) tile.wireId = 1;
		const fakeBitmap = { close: function () {} } as any;
		tileManager.setBitmapOnTile(tile, fakeBitmap);
	}

	// Reclaim every tile we previously installed a bitmap on. Returns the
	// shared state to "needs fetch" so the next scenario's request list is
	// independent of earlier scenarios'. In production, off-screen tiles
	// are dropped via garbage collection over time.
	function clearRenderedTiles(
		tileManager: any,
		renderedKeys: Set<string>,
	): void {
		for (const key of Array.from(renderedKeys)) {
			const tile = tileManager.tiles.get(key);
			if (tile) tileManager.reclaimTileBitmapMemory(tile);
		}
		nodeassert.strictEqual(renderedKeys.size, 0);
	}

	// Shallow "expected subset of actual" assertion over sorted tile keys.
	// The real layout may request more tiles than our hand-computed minimum
	// (prefetch, overdraw); the contract we verify is that every hand-
	// computed tile IS in the request.
	function assertSubset(
		label: string,
		expected: string[],
		actual: string[],
	): void {
		const actualSet = new Set(actual);
		const missing = expected.filter((k) => !actualSet.has(k));
		if (missing.length > 0) {
			console.error('[' + label + '] expected tiles missing from request.');
			console.error('  missing:   ' + JSON.stringify(missing));
			console.error('  expected:  ' + JSON.stringify(expected));
			console.error('  requested: ' + JSON.stringify(actual));
		}
		nodeassert.deepStrictEqual(
			missing,
			[],
			label + ': every expected tile must appear in the request',
		);
	}

	// Install a fresh BitmapTileManager as the RenderManager singleton so each
	// scenario starts from clean state instead of inheriting tiles, caches and
	// queues left behind by earlier tests.
	function resetRenderManagerState(): any {
		const tileManager: any = new BitmapTileManager();
		(RenderManager as any)._instance = tileManager;
		return tileManager;
	}

	// ========================================================================
	// Shared test context and scenario assertions
	// ========================================================================

	// Create a test context: reset the RenderManager singleton, install
	// monkey-patches, and return everything needed for lifecycle
	// assertions. Caller must call ctx.restore() in a finally block.
	function createTestContext(layout: any): {
		layout: any;
		tileManager: any;
		sentRequests: Array<Array<TileCoordData>>;
		renderedKeys: Set<string>;
		restore: () => void;
	} {
		const tileManager: any = resetRenderManagerState();
		const tileCombine = instrumentTileCombineRequests(tileManager);
		const rendering = instrumentTileRendering(tileManager);
		return {
			layout,
			tileManager,
			sentRequests: tileCombine.sentRequests,
			renderedKeys: rendering.renderedKeys,
			restore: () => {
				rendering.restore();
				tileCombine.restore();
			},
		};
	}

	// Request all visible tiles and simulate their arrival so the
	// tile map is fully populated. Returns the visible coordinate
	// list.
	function requestAndRenderAll(ctx: any): TileCoordData[] {
		(ctx.layout as any).refreshCurrentCoordList();
		RenderManager.checkRequestTiles(
			ctx.layout.getCurrentCoordList().slice(),
		);
		const visibleCoords: TileCoordData[] =
			ctx.layout.getCurrentCoordList().slice();
		for (const coords of visibleCoords) {
			simulateTileArrival(ctx.tileManager, ctx.tileManager.get(coords));
		}
		return visibleCoords;
	}

	// After all visible tiles are rendered, invalidate a subset and
	// verify only those tiles are re-requested.
	function assertInvalidationCycle(ctx: any): void {
		const visibleCoords = requestAndRenderAll(ctx);

		const before = ctx.sentRequests.length;
		(ctx.layout as any).refreshCurrentCoordList();
		RenderManager.checkRequestTiles(
			ctx.layout.getCurrentCoordList().slice(),
		);
		nodeassert.strictEqual(
			ctx.sentRequests.length,
			before,
			'no request expected before invalidation',
		);

		const toInvalidate = visibleCoords.slice(0, 3);
		const toKeep = visibleCoords.slice(3);

		for (const coords of toInvalidate) {
			ctx.tileManager.get(coords).invalidFrom =
				ctx.tileManager.get(coords).wireId;
		}

		(ctx.layout as any).refreshCurrentCoordList();
		RenderManager.checkRequestTiles(
			ctx.layout.getCurrentCoordList().slice(),
		);

		nodeassert.ok(
			ctx.sentRequests.length > before,
			'invalidation should trigger a new tile-combine request',
		);

		const requestKeys = new Set(
			ctx.sentRequests[ctx.sentRequests.length - 1].map(
				function (c: any) { return c.key(); },
			),
		);

		for (const coords of toInvalidate) {
			nodeassert.ok(
				requestKeys.has(coords.key()),
				'invalidated tile ' + coords.key() +
					' must be re-requested',
			);
		}

		for (const coords of toKeep) {
			nodeassert.ok(
				!requestKeys.has(coords.key()),
				'non-invalidated tile ' + coords.key() +
					' must not be re-requested',
			);
		}
	}

	// After all visible tiles are rendered, forceKeyframe on a subset
	// and verify only those are re-requested.
	function assertForceKeyframeCycle(ctx: any): void {
		const visibleCoords = requestAndRenderAll(ctx);

		const toForce = visibleCoords.slice(0, 2);
		const toKeep = visibleCoords.slice(2);

		for (const coords of toForce) {
			ctx.tileManager.get(coords).forceKeyframe();
		}

		const before = ctx.sentRequests.length;
		(ctx.layout as any).refreshCurrentCoordList();
		RenderManager.checkRequestTiles(
			ctx.layout.getCurrentCoordList().slice(),
		);

		nodeassert.ok(
			ctx.sentRequests.length > before,
			'forceKeyframe should trigger a new tile-combine request',
		);

		const requestKeys = new Set(
			ctx.sentRequests[ctx.sentRequests.length - 1].map(
				function (c: any) { return c.key(); },
			),
		);

		for (const coords of toForce) {
			nodeassert.ok(
				requestKeys.has(coords.key()),
				'force-keyframed tile ' + coords.key() +
					' must be re-requested',
			);
		}

		for (const coords of toKeep) {
			nodeassert.ok(
				!requestKeys.has(coords.key()),
				'untouched tile ' + coords.key() +
					' must not be re-requested',
			);
		}
	}

	// Verify that an invalidation arriving while a tile request is
	// in flight survives the stale response.
	function assertRaceProtection(ctx: any): void {
		(ctx.layout as any).refreshCurrentCoordList();
		RenderManager.checkRequestTiles(
			ctx.layout.getCurrentCoordList().slice(),
		);

		const visibleCoords: TileCoordData[] =
			ctx.layout.getCurrentCoordList().slice();

		const raceTile = ctx.tileManager.get(visibleCoords[0]);
		raceTile.invalidFrom = 5;

		simulateTileArrival(ctx.tileManager, raceTile);

		nodeassert.ok(
			raceTile.needsFetch(),
			'tile must still need fetch after stale arrival ' +
				'(race protection)',
		);

		for (let i = 1; i < visibleCoords.length; i++) {
			simulateTileArrival(
				ctx.tileManager,
				ctx.tileManager.get(visibleCoords[i]),
			);
		}

		const before = ctx.sentRequests.length;
		(ctx.layout as any).refreshCurrentCoordList();
		RenderManager.checkRequestTiles(
			ctx.layout.getCurrentCoordList().slice(),
		);

		nodeassert.ok(
			ctx.sentRequests.length > before,
			'race-affected tile should trigger a new request',
		);

		const raceKeys = new Set(
			ctx.sentRequests[ctx.sentRequests.length - 1].map(
				function (c: any) { return c.key(); },
			),
		);

		nodeassert.ok(
			raceKeys.has(visibleCoords[0].key()),
			'race-affected tile ' + visibleCoords[0].key() +
				' must be re-requested',
		);

		for (let i = 1; i < visibleCoords.length; i++) {
			nodeassert.ok(
				!raceKeys.has(visibleCoords[i].key()),
				'normally-rendered tile ' +
					visibleCoords[i].key() +
					' must not be re-requested',
			);
		}
	}

	// ========================================================================
	// Layout setup helpers
	// ========================================================================

	// Three-page Writer document at pixelsToTwips=7.5 (zoomed in).
	// pageRectangleList is set AFTER the constructor so that reset()
	// returns early (empty list) and does not queue an async task
	// that would interfere with test state.
	function setupMultiPageForTest(): ViewLayoutMultiPage {
		setupAppStubs(7.5);

		const activeDocument = new DocumentBase();
		(activeDocument as any)._fileSize =
			new cool.SimplePoint(7500, 49000);
		app.activeDocument = activeDocument;

		const layout = new ViewLayoutMultiPage();

		app.file.writer.pageRectangleList = [
			[0, 0, 7500, 15000],
			[0, 17000, 7500, 15000],
			[0, 34000, 7500, 15000],
		];

		layout.scrollProperties.viewX = 0;
		layout.scrollProperties.viewY = 0;
		(layout as any).resetViewLayout();
		return layout;
	}

	// Side-by-side compare view at pixelsToTwips=7.5. Sets
	// _viewedRectangle and _viewSize directly to avoid calling
	// updateViewData which needs a live socket / docLayer.
	function setupCompareChangesForTest(): ViewLayoutCompareChanges {
		setupAppStubs(7.5);

		const activeDocument = new DocumentBase();
		(activeDocument as any)._fileSize =
			new cool.SimplePoint(7500, 49000);
		app.activeDocument = activeDocument;

		const layout = new ViewLayoutCompareChanges();

		// The constructor queues an async task that would call
		// updateViewData and overwrite the state we set below.
		// Drain the queue so it never fires.
		(app.layoutingService as any)._layoutTasks.length = 0;

		// Reproduce refreshVisibleAreaRectangle + updateViewData
		// inline.  The margin, yStart and viewGap values match the
		// class defaults when app.dpiScale === 1.
		const margin = 15;
		const yStart = 20;
		const viewGap = 20;
		(layout as any)._viewedRectangle =
			cool.SimpleRectangle.fromCorePixels([
				-margin,
				-yStart,
				app.activeDocument.fileSize.pX + 2 * margin,
				768,
			]);
		(layout as any)._viewSize = cool.SimplePoint.fromCorePixels([
			Math.max(
				1024,
				2 * app.activeDocument.fileSize.pX + 2 * viewGap,
			),
			Math.max(768, app.activeDocument.fileSize.pY + yStart),
		]);
		return layout;
	}

	// ========================================================================
	// Tests
	// ========================================================================

    it('Check Pan Direction', function () {
		app.map = {
			on: function() {}
		} as any

        const viewLayout = new ViewLayoutBase();

        viewLayout.viewedRectangle = new cool.SimpleRectangle(100, 100, 100, 100);
        let panDirection = viewLayout.getLastPanDirection();

        nodeassert.ok(panDirection[0] === 1 && panDirection[1] === 1);

        viewLayout.viewedRectangle = new cool.SimpleRectangle(50, 50, 100, 100);
        panDirection = viewLayout.getLastPanDirection();
        nodeassert.ok(panDirection[0] === -1 && panDirection[1] === -1);
	});

	it('MultiPage tracks requested tiles across zoom and scroll', function () {
		setupAppStubs(15);

		// Assign a real DocumentBase instance. _fileSize must cover all 3
		// pages because BitmapTileManager.isValidTile rejects tile coordinates
		// outside fileSize.
		const activeDocument = new DocumentBase();
		(activeDocument as any)._fileSize = new cool.SimplePoint(7500, 49000);
		app.activeDocument = activeDocument;

		const multiPageViewLayout = new ViewLayoutMultiPage();

		// Reset to a fresh BitmapTileManager, then install monkey patches on
		// the two observation points: the tile-combine request queue and the
		// bitmap production and reclamation state machine.
		const tileManager: any = resetRenderManagerState();

		const tileCombine = instrumentTileCombineRequests(tileManager);
		const rendering = instrumentTileRendering(tileManager);
		const sentTileCombineRequests = tileCombine.sentRequests;
		const renderedKeys = rendering.renderedKeys;

		// A Writer document with three identical pages.
		const pageRectangles = [
			[0, 0, 7500, 15000],
			[0, 17000, 7500, 15000],
			[0, 34000, 7500, 15000],
		];
		app.file.writer.pageRectangleList = pageRectangles;

		// Drive the layout step directly; the public reset() defers via
		// LayoutingService and would also invoke updateViewData which
		// expects a live socket / docLayer.
		(multiPageViewLayout as any).resetViewLayout();

		// Feed the layout's visible-tile list through checkRequestTiles;
		// every fresh tile has needsFetch() === true, so the monkey-patched
		// wrapper records a queue equal to the visible list.
		const triggerRequest = (): void => {
			(multiPageViewLayout as any).refreshCurrentCoordList();
			RenderManager.checkRequestTiles(
				multiPageViewLayout.getCurrentCoordList().slice(),
			);
		};

		const lastRequestedKeys = (): string[] => {
			nodeassert.ok(
				sentTileCombineRequests.length > 0,
				'expected a new tile-combine request to be recorded',
			);
			return sentTileCombineRequests[sentTileCombineRequests.length - 1]
				.map(function (c: any) { return c.key(); })
				.sort();
		};

		const visibleCoords = (): TileCoordData[] =>
			multiPageViewLayout.getCurrentCoordList().slice();

		// Run a single scenario's invariants: every expected tile must be
		// requested, then after a simulated response every visible tile must
		// be recorded as rendered and drawable, and a second pass must not
		// emit any new request because all visible tiles are now current.
		const runScenarioInvariants = (
			label: string,
			expectedKeys: string[],
		): void => {
			triggerRequest();
			assertSubset(label, expectedKeys, lastRequestedKeys());

			for (const coords of visibleCoords()) {
				const tile = tileManager.get(coords);
				nodeassert.ok(
					tile,
					label + ': tile ' + coords.key() + ' should exist after request',
				);
				simulateTileArrival(tileManager, tile);
			}

			for (const coords of visibleCoords()) {
				nodeassert.ok(
					renderedKeys.has(coords.key()),
					label + ': visible tile ' + coords.key() +
						' has no bitmap produced',
				);
				nodeassert.ok(
					tileManager.get(coords).isReadyToDraw(),
					label + ': visible tile ' + coords.key() +
						' is not ready to draw',
				);
			}

			const beforeNoOp = sentTileCombineRequests.length;
			triggerRequest();
			nodeassert.strictEqual(
				sentTileCombineRequests.length,
				beforeNoOp,
				label + ': no new tile-combine request expected once all ' +
					'visible tiles are rendered',
			);
		};

		// Expected lists below are hand-derived from the scenario inputs
		// (page rectangles, viewport, pixelsToTwips, tileSize = 256, fileSize
		// = (7500, 49000)) without calling refreshCurrentCoordList, so they
		// are an independent reference rather than a self-comparison.
		try {
			// --- Scenario 1: Zoom in -------------------------------------
			// Halve twips-per-pixel so a page grows from 500x1000 to
			// 1000x2000 px. Only page 0 fits vertically; the viewport shows
			// its top portion in core-pixel doc space (0, 0)..(1000, 748).
			// tileSize=256 enumerates x in {0,256,512,768,1024} and
			// y in {0,256,512,768}. isValidTile drops x=1024 because
			// 1024 * 7.5 = 7680 >= fileSize.x (7500). Result: a 4x4 grid.
			app.pixelsToTwips = 7.5;
			app.twipsToPixels = 1 / 7.5;
			(multiPageViewLayout as any).resetViewLayout();

			const expectedZoomIn = [
				'0:0:10:0:0', '0:256:10:0:0', '0:512:10:0:0', '0:768:10:0:0',
				'256:0:10:0:0', '256:256:10:0:0', '256:512:10:0:0', '256:768:10:0:0',
				'512:0:10:0:0', '512:256:10:0:0', '512:512:10:0:0', '512:768:10:0:0',
				'768:0:10:0:0', '768:256:10:0:0', '768:512:10:0:0', '768:768:10:0:0',
			].sort();

			runScenarioInvariants('zoom-in', expectedZoomIn);

			// --- Scenario 2: Scroll down by one viewport -----------------
			// Stay at the zoomed-in scale. Sliding viewY to 768 exposes
			// doc-y 748..1516 of page 0; page 1 starts at view-y 2040 and is
			// still off-screen. tile y in {512,768,1024,1280,1536}, tile x
			// in {0,256,512,768} (1024 dropped as above). Result: 4x5.
			//
			// Reset rendered state first so the subset assertion sees every
			// tile go through the fetch path - not just the non-overlapping
			// ones left over from zoom-in.
			clearRenderedTiles(tileManager, renderedKeys);
			multiPageViewLayout.scrollProperties.viewY = 768;

			const expectedAfterScroll = [
				'0:512:10:0:0', '0:768:10:0:0', '0:1024:10:0:0', '0:1280:10:0:0', '0:1536:10:0:0',
				'256:512:10:0:0', '256:768:10:0:0', '256:1024:10:0:0', '256:1280:10:0:0', '256:1536:10:0:0',
				'512:512:10:0:0', '512:768:10:0:0', '512:1024:10:0:0', '512:1280:10:0:0', '512:1536:10:0:0',
				'768:512:10:0:0', '768:768:10:0:0', '768:1024:10:0:0', '768:1280:10:0:0', '768:1536:10:0:0',
			].sort();

			runScenarioInvariants('scroll-down', expectedAfterScroll);

			// --- Scenario 3: Zoom out so all three pages fit -------------
			// At pixelsToTwips = 70 each page is 107x214 px. Two pages fit
			// side-by-side on the top row, the third lives on a second row,
			// and the full stack is < 768 px tall so everything is on-screen.
			// Per-page tiles before isValidTile: page 0 {(0,0),(0,256)},
			// page 1 {(0,0),(0,256),(0,512)}, page 2 {(0,256),(0,512),(0,768)}.
			// isValidTile drops every x >= 256 (256*70 = 17920 >= 7500) and
			// y = 768 for page 2 (768*70 = 53760 >= 49000). Deduped union:
			// (0,0), (0,256), (0,512).
			clearRenderedTiles(tileManager, renderedKeys);
			app.pixelsToTwips = 70;
			app.twipsToPixels = 1 / 70;
			multiPageViewLayout.scrollProperties.viewX = 0;
			multiPageViewLayout.scrollProperties.viewY = 0;
			(multiPageViewLayout as any).resetViewLayout();

			const expectedZoomOut = [
				'0:0:10:0:0', '0:256:10:0:0', '0:512:10:0:0',
			].sort();

			runScenarioInvariants('zoom-out', expectedZoomOut);

			// --- Scenario 4: Reclaim a few tiles, verify re-request ------
			// reclaimTileBitmapMemory drops tiles out of renderedKeys (via
			// our patch) AND nulls tile.image (via the real impl), so
			// needsFetch() returns true for them again. The next request
			// should enumerate exactly the reclaimed tiles; the still-
			// rendered one must NOT be re-fetched.
			const visibleAtZoomOut = visibleCoords();
			const toReclaim = visibleAtZoomOut.slice(0, 2);
			const toKeep = visibleAtZoomOut.slice(2);

			for (const coords of toReclaim) {
				tileManager.reclaimTileBitmapMemory(tileManager.get(coords));
				nodeassert.ok(
					!renderedKeys.has(coords.key()),
					'reclaim: tile ' + coords.key() +
						' should have been dropped from renderedKeys',
				);
			}

			const beforeReclaim = sentTileCombineRequests.length;
			triggerRequest();
			nodeassert.ok(
				sentTileCombineRequests.length > beforeReclaim,
				'reclaim: a new tile-combine request should have been recorded',
			);
			const reclaimRequestKeys = new Set(lastRequestedKeys());
			for (const coords of toReclaim) {
				nodeassert.ok(
					reclaimRequestKeys.has(coords.key()),
					'reclaim: expected ' + coords.key() + ' in re-request',
				);
			}
			for (const coords of toKeep) {
				nodeassert.ok(
					!reclaimRequestKeys.has(coords.key()),
					'reclaim: still-rendered tile ' + coords.key() +
						' must not be re-fetched',
				);
			}
		} finally {
			// Always restore the original methods so later tests in this
			// suite (or a future addition) see untouched production code.
			rendering.restore();
			tileCombine.restore();
		}
	});

	it('MultiPage invalidation triggers re-request for affected tiles only', function () {
		const ctx = createTestContext(setupMultiPageForTest());
		try { assertInvalidationCycle(ctx); }
		finally { ctx.restore(); }
	});

	it('MultiPage forceKeyframe causes tile re-request', function () {
		const ctx = createTestContext(setupMultiPageForTest());
		try { assertForceKeyframeCycle(ctx); }
		finally { ctx.restore(); }
	});

	// ----------------------------------------------------------------
	// When the viewport intersects two pages, tiles from BOTH pages
	// must appear in the request. The page-1-only tiles (y=2304) are
	// the canary: if the page intersection check in
	// refreshCurrentCoordList misses the second page, those tiles
	// disappear and the bottom sliver of the viewport goes blank.
	//
	// At pixelsToTwips=7.5 with viewport 1024x768:
	//   page 0 view rect: (12, 20) .. (1012, 2020)
	//   page 1 view rect: (12, 2040) .. (1012, 4040)
	//   viewY=1280 -> viewport y 1280..2048, overlapping both pages.
	//
	//   page 0 doc visible: y 1260..2000 -> tiles y {1024..2048}
	//   page 1 doc visible: y 2267..2275 -> tiles y {2048, 2304}
	//   After dedup: y=2048 shared, y=2304 is page-1-only.
	// ----------------------------------------------------------------
	it('MultiPage scroll to page boundary includes tiles from both pages', function () {
		setupAppStubs(7.5);

		const activeDocument = new DocumentBase();
		(activeDocument as any)._fileSize = new cool.SimplePoint(7500, 49000);
		app.activeDocument = activeDocument;

		const layout = new ViewLayoutMultiPage();

		const tileManager: any = resetRenderManagerState();

		const tileCombine = instrumentTileCombineRequests(tileManager);
		const rendering = instrumentTileRendering(tileManager);

		app.file.writer.pageRectangleList = [
			[0, 0, 7500, 15000],
			[0, 17000, 7500, 15000],
			[0, 34000, 7500, 15000],
		];

		layout.scrollProperties.viewX = 0;
		layout.scrollProperties.viewY = 0;
		(layout as any).resetViewLayout();

		try {
			layout.scrollProperties.viewY = 1280;

			// These tiles come exclusively from page 1's document
			// region and would be missing if page intersection
			// detection failed.
			const expectedPage1Only = [
				'0:2304:10:0:0',
				'256:2304:10:0:0',
				'512:2304:10:0:0',
				'768:2304:10:0:0',
			];

			const expectedAll = [
				'0:1024:10:0:0', '0:1280:10:0:0', '0:1536:10:0:0',
				'0:1792:10:0:0', '0:2048:10:0:0', '0:2304:10:0:0',
				'256:1024:10:0:0', '256:1280:10:0:0', '256:1536:10:0:0',
				'256:1792:10:0:0', '256:2048:10:0:0', '256:2304:10:0:0',
				'512:1024:10:0:0', '512:1280:10:0:0', '512:1536:10:0:0',
				'512:1792:10:0:0', '512:2048:10:0:0', '512:2304:10:0:0',
				'768:1024:10:0:0', '768:1280:10:0:0', '768:1536:10:0:0',
				'768:1792:10:0:0', '768:2048:10:0:0', '768:2304:10:0:0',
			].sort();

			(layout as any).refreshCurrentCoordList();
			RenderManager.checkRequestTiles(
				layout.getCurrentCoordList().slice(),
			);

			const requestedKeys = tileCombine.sentRequests[
				tileCombine.sentRequests.length - 1
			]
				.map(function (c: any) { return c.key(); })
				.sort();

			assertSubset('page-boundary', expectedAll, requestedKeys);

			// Verify page-1-only tiles explicitly.
			const requestedSet = new Set(requestedKeys);
			for (const key of expectedPage1Only) {
				nodeassert.ok(
					requestedSet.has(key),
					'page-1-only tile ' + key +
						' must be present at page boundary',
				);
			}

			// Full round-trip: render and verify all visible tiles
			// are drawable.
			for (const coords of layout.getCurrentCoordList().slice()) {
				simulateTileArrival(tileManager, tileManager.get(coords));
			}

			for (const coords of layout.getCurrentCoordList().slice()) {
				nodeassert.ok(
					tileManager.get(coords).isReadyToDraw(),
					'boundary tile ' + coords.key() +
						' must be ready to draw after arrival',
				);
			}
		} finally {
			rendering.restore();
			tileCombine.restore();
		}
	});

	it('MultiPage invalidation during pending response is not lost', function () {
		const ctx = createTestContext(setupMultiPageForTest());
		try { assertRaceProtection(ctx); }
		finally { ctx.restore(); }
	});

	// ================================================================
	// ViewLayoutCompareChanges tests
	// ================================================================

	// CompareChanges duplicates every base tile with LeftSide and
	// RightSide modes. Verify that both sets are present with
	// identical base coordinates, and that the hand-derived tile
	// grid matches the production output.
	//
	// At pixelsToTwips=7.5 with _viewedRectangle from
	// fromCorePixels([-15, -20, 1030, 768]):
	//   startX = floor(-15/256)*256 = -256
	//   startY = floor(-20/256)*256 = -256
	//   columnCount = ceil(1030/256) = 5, rowCount = ceil(768/256) = 3
	//   j=0..3 -> y = {-256, 0, 256, 512}; y=-256 invalid
	//   isValidTile drops x<0, y<0, x>=1024 (1024*7.5=7680>=7500)
	//   Valid base: x in {0,256,512,768}, y in {0,256,512} = 12
	//   After mode duplication: 12 LeftSide + 12 RightSide = 24
	it('CompareChanges produces left and right mode tiles', function () {
		const ctx = createTestContext(setupCompareChangesForTest());
		try {
			(ctx.layout as any).refreshCurrentCoordList();
			const coordList: TileCoordData[] =
				ctx.layout.getCurrentCoordList().slice();

			const leftKeys = new Set<string>();
			const rightKeys = new Set<string>();

			for (const coords of coordList) {
				const base =
					coords.x + ':' + coords.y + ':' +
					coords.z + ':' + coords.part;
				if (coords.mode === TileMode.LeftSide) {
					leftKeys.add(base);
				} else if (coords.mode === TileMode.RightSide) {
					rightKeys.add(base);
				}
			}

			nodeassert.ok(leftKeys.size > 0, 'should have LeftSide tiles');
			nodeassert.ok(
				rightKeys.size > 0,
				'should have RightSide tiles',
			);
			nodeassert.deepStrictEqual(
				Array.from(leftKeys).sort(),
				Array.from(rightKeys).sort(),
				'LeftSide and RightSide must cover identical coordinates',
			);
			nodeassert.strictEqual(
				coordList.length,
				leftKeys.size + rightKeys.size,
				'total tiles must equal left + right (no extra modes)',
			);

			// Verify against hand-derived expected base coordinates.
			const expectedBases = [
				'0:0:10:0', '0:256:10:0', '0:512:10:0',
				'256:0:10:0', '256:256:10:0', '256:512:10:0',
				'512:0:10:0', '512:256:10:0', '512:512:10:0',
				'768:0:10:0', '768:256:10:0', '768:512:10:0',
			].sort();

			nodeassert.deepStrictEqual(
				Array.from(leftKeys).sort(),
				expectedBases,
				'LeftSide base coordinates must match hand-derived grid',
			);
		} finally {
			ctx.restore();
		}
	});

	it('CompareChanges invalidation triggers re-request for affected tiles only', function () {
		const ctx = createTestContext(setupCompareChangesForTest());
		try { assertInvalidationCycle(ctx); }
		finally { ctx.restore(); }
	});

	it('CompareChanges forceKeyframe causes tile re-request', function () {
		const ctx = createTestContext(setupCompareChangesForTest());
		try { assertForceKeyframeCycle(ctx); }
		finally { ctx.restore(); }
	});

	it('CompareChanges invalidation during pending response is not lost', function () {
		const ctx = createTestContext(setupCompareChangesForTest());
		try { assertRaceProtection(ctx); }
		finally { ctx.restore(); }
	});

	// ========================================================================
	// ViewLayoutFileBased: the scroll offset across a zoom change
	//
	// scrollProperties.viewX/viewY are plain numbers holding CORE PIXELS
	// (ViewLayout.ts:25,40). Every other quantity in this layout is a
	// cool.SimpleRectangle / cool.SimplePoint, which stores twips and converts
	// on each pixel read, so it re-derives itself whenever app.twipsToPixels
	// moves. The scroll offset does not, and no writer of it is zoom-aware.
	//
	// These tests drive ViewLayoutFileBased.reset() the way 'zoomend' does:
	// CanvasTileLayer._updateTileTwips has already rewritten app.twipsToPixels
	// by the time the handler runs, because Map._resetView fires 'viewreset'
	// (-> _reset -> _updateTileTwips) before it fires 'zoomend'
	// (Map.js:1374-1403).
	// ========================================================================

	const SLIDE_W_TWIPS = 25400; // 16:9 slide, the Impress default.
	const SLIDE_H_TWIPS = 14288;
	const SLIDE_GAP_TWIPS = 300;
	const DECK_PARTS = 10;

	// A ten-slide deck in fileBasedView at pixelsToTwips = 15 (100%).
	// The constructor queues updateViewData, which needs a live socket and
	// RenderManager; drain the queue so it never fires and the tests stay on
	// the synchronous scroll-anchoring path.
	function setupFileBasedForTest(): ViewLayoutFileBased {
		setupAppStubs(15);

		// DocumentBase builds an ImpressSelectionMiddleware for presentations,
		// which registers a SelectionRectangle section. Values mirror
		// browser/src/canvas/CanvasSectionProps.js:52,111,128.
		(app.CSections as any).SelectionRectangle = {
			name: 'selection-rectangle', zIndex: 5,
			processingOrder: 73, drawingOrder: 72,
		};

		// That section is a documentObject, so registering it walks
		// locateSections -> documentToViewX -> getDocumentAnchor. The harness
		// already fakes getDocumentAnchorSection; this is its position
		// counterpart, kept consistent with that stub's myTopLeft.
		(app.sectionContainer as any).getDocumentAnchor = function () {
			return [0, 0];
		};

		// refreshVisibleAreaRectangleImpl pushes the new top-left into every
		// document section on its success path. These tests assert scroll
		// offsets, not painting, and the harness has no real section geometry
		// to move.
		(app.sectionContainer as any).onNewDocumentTopLeft = function () {};

		// ImpressSelectionMiddleware adds its section without an existence
		// check, so a second setup in the same process warns. Drop it first.
		if (app.sectionContainer.doesSectionExist('selection-rectangle'))
			app.sectionContainer.removeSection('selection-rectangle');

		(app.map as any)._docLayer = {
			_docType: 'presentation',
			_parts: DECK_PARTS,
			_partDimensions: [],
			_partWidthTwips: SLIDE_W_TWIPS,
			_partHeightTwips: SLIDE_H_TWIPS,
			_spaceBetweenParts: SLIDE_GAP_TWIPS,
			isWriter: function () { return false; },
			_sendClientZoom: function () {},
			_checkSelectedPart: function () {},
		};
		(app.file as any).fileBasedView = true;

		const activeDocument = new DocumentBase();
		(activeDocument as any)._fileSize = new cool.SimplePoint(
			SLIDE_W_TWIPS,
			DECK_PARTS * (SLIDE_H_TWIPS + SLIDE_GAP_TWIPS),
		);
		app.activeDocument = activeDocument;

		const layout = new ViewLayoutFileBased();
		(app.layoutingService as any)._layoutTasks.length = 0;
		return layout;
	}

	// What CanvasTileLayer._updateTileTwips does for a `steps`-step zoom.
	// Positive steps zoom OUT (each step divides the scale by 1.2), matching
	// the `Math.pow(1.2, options.zoom - _tileZoom)` tile-width factor.
	function applyZoomSteps(steps: number): void {
		app.twipsToPixels = app.twipsToPixels / Math.pow(1.2, steps);
		app.pixelsToTwips = 1 / app.twipsToPixels;
	}

	// Run queued layouting tasks by hand, up to `limit`. Returns how many ran.
	// A task that re-queues itself unchanged will consume the whole budget,
	// which is exactly what the retry-loop test measures.
	function drainLayoutingTasks(limit: number): number {
		let ran = 0;
		while (
			ran < limit &&
			(app.layoutingService as any)._layoutTasks.length > 0
		) {
			app.layoutingService.runTheTopTask();
			ran++;
		}
		return ran;
	}

	it('FileBased keeps the same slide across a zoom step', function () {
		const layout = setupFileBasedForTest();

		// Park the viewport on the top edge of slide 8 (index 7).
		const targetPart = 7;
		layout.scrollProperties.viewY =
			layout.documentRectangles[targetPart].pY1;
		nodeassert.strictEqual(
			layout.getPartIndexAtDocumentY(layout.scrollProperties.viewY),
			targetPart,
			'precondition: the viewport starts on slide 8',
		);

		// One zoom-out step, then the handler 'zoomend' would call.
		applyZoomSteps(1);
		layout.reset();
		(app.layoutingService as any)._layoutTasks.length = 0;

		nodeassert.strictEqual(
			layout.getPartIndexAtDocumentY(layout.scrollProperties.viewY),
			targetPart,
			'a zoom step must not move the viewport to a different slide',
		);
		nodeassert.strictEqual(
			layout.scrollProperties.viewY,
			layout.documentRectangles[targetPart].pY1,
			'the viewport must land back on the same edge of the same slide',
		);
	});

	it('FileBased zoom-out near the end of the deck does not snap to slide 1', function () {
		const layout = setupFileBasedForTest();

		// Last slide: the case where a stale offset lands past the new stacked
		// extent, no view rectangle intersects, and
		// ViewLayoutNewBase.refreshVisibleAreaRectangleImpl snaps the axis to 0.
		const lastPart = DECK_PARTS - 1;
		layout.scrollProperties.viewY = layout.documentRectangles[lastPart].pY1;

		applyZoomSteps(1);
		layout.reset();
		(app.layoutingService as any)._layoutTasks.length = 0;

		// Drive the snap path itself, then let any retry it queued actually run.
		(layout as any).refreshVisibleAreaRectangle();
		drainLayoutingTasks(8);

		nodeassert.notStrictEqual(
			layout.scrollProperties.viewY,
			0,
			'zooming out on the last slide must not throw the deck back to slide 1',
		);

		// The predicate refreshVisibleAreaRectangleImpl itself uses: with the
		// offset left at the old scale this is false for every part, which is
		// what produces the snap.
		const documentAnchor = (layout as any).getDocumentAnchorSection();
		const viewport = cool.SimpleRectangle.fromCorePixels([
			layout.scrollProperties.viewX,
			layout.scrollProperties.viewY,
			documentAnchor.size[0],
			documentAnchor.size[1],
		]);
		nodeassert.ok(
			viewport.intersectsRectangle(
				layout.viewRectangles[lastPart].toArray(),
			),
			'the last slide must still be inside the viewport after zooming out',
		);
		nodeassert.strictEqual(
			layout.getPartIndexAtDocumentY(layout.scrollProperties.viewY),
			lastPart,
			'the viewport must still be on the last slide after zooming out',
		);
	});

	it('FileBased reset is a no-op when nothing moved', function () {
		const layout = setupFileBasedForTest();

		layout.scrollProperties.viewY = layout.documentRectangles[4].pY1;
		layout.scrollProperties.viewX = 0;
		const viewY = layout.scrollProperties.viewY;
		const startY = layout.scrollProperties.startY;

		// Five resizes with no zoom change and no canvas change -- what a phone
		// produces from the keyboard, a sheet, rotation and browser chrome.
		for (let i = 0; i < 5; i++) {
			layout.reset();
			(app.layoutingService as any)._layoutTasks.length = 0;
			nodeassert.strictEqual(
				layout.scrollProperties.viewY,
				viewY,
				'a resize that moved nothing must not rewrite viewY (pass ' + i + ')',
			);
			nodeassert.strictEqual(
				layout.scrollProperties.startY,
				startY,
				'a resize that moved nothing must not rewrite startY (pass ' + i + ')',
			);
		}
	});

	it('FileBased does not re-queue an identical visible-area retry forever', function () {
		const layout = setupFileBasedForTest();

		// No rectangles: nothing can intersect the viewport at any offset. With
		// the axis already at 0 the snap changes nothing, so re-running the
		// computation can only produce the same answer again.
		layout.documentRectangles.length = 0;
		layout.viewRectangles.length = 0;
		layout.scrollProperties.viewX = 0;
		layout.scrollProperties.viewY = 0;
		(app.layoutingService as any)._layoutTasks.length = 0;

		(layout as any).refreshVisibleAreaRectangle();

		const budget = 20;
		const ran = drainLayoutingTasks(budget);

		nodeassert.ok(
			ran < budget,
			'the visible-area retry must terminate, not re-queue itself every ' +
				'layouting frame (ran ' + ran + ' of a ' + budget + ' budget)',
		);
		nodeassert.strictEqual(
			(app.layoutingService as any)._layoutTasks.length,
			0,
			'no layouting task may be left pending once the retry has settled',
		);
	});

	// ========================================================================
	// getScrollOrigin: the space a pan target is absolute in.
	//
	// MEASURED on slot-01, phone profile, Dinosaurs.pptx: a touch drag on a
	// deck landed at (viewedRectangle.pY1 + travel) instead of
	// (viewY + travel) — i.e. it clipped UP the deck by exactly the distance
	// already scrolled into the current slide, on the first move of every
	// gesture. 0 px at the top of the deck, 122 / 282 / 482 px at three
	// offsets further in, matching viewY - viewedRectangle.pY1 every time.
	// ========================================================================

	// Park the viewport a given fraction into one slide, so that viewY and the
	// visible-parts bounding box genuinely disagree.
	function parkMidSlide(
		layout: ViewLayoutFileBased,
		part: number,
		fraction: number,
	): number {
		const rect = layout.documentRectangles[part];
		layout.scrollProperties.viewY = Math.round(
			rect.pY1 + fraction * rect.pHeight,
		);
		(layout as any).refreshVisibleAreaRectangle();
		(app.layoutingService as any)._layoutTasks.length = 0;
		return layout.scrollProperties.viewY;
	}

	it('a deck parked mid-slide reports a scroll origin the viewed rectangle does not', function () {
		const layout = setupFileBasedForTest();
		const viewY = parkMidSlide(layout, 4, 0.5);

		nodeassert.strictEqual(
			layout.getScrollOrigin()[1],
			viewY,
			'the scroll origin must be the offset the layout renders from',
		);

		// The known positive for every assertion below: if these two agreed,
		// the anchor could be read from either and nothing here would bite.
		nodeassert.ok(
			viewY - layout.viewedRectangle.pY1 > 0,
			'precondition: mid-slide, the viewed rectangle must still start at ' +
				'the top of that slide (viewY ' + viewY + ', pY1 ' +
				layout.viewedRectangle.pY1 + ')',
		);
	});

	it('a pan anchored on the scroll origin lands where the finger asked', function () {
		const layout = setupFileBasedForTest();
		parkMidSlide(layout, 4, 0.5);

		const origin = layout.getScrollOrigin();
		const travel = 300;
		layout.scrollTo(origin[0], origin[1] + travel);

		nodeassert.strictEqual(
			layout.scrollProperties.viewY,
			origin[1] + travel,
			'300 px of finger must move the deck 300 px',
		);
	});

	it('the pre-fix anchor clips the deck back up by the distance into the slide', function () {
		const layout = setupFileBasedForTest();
		const viewY = parkMidSlide(layout, 4, 0.5);

		// The expression this fix replaced, driven against the real layout:
		// anchor on the viewed rectangle, write through scrollTo.
		const staleAnchorY = layout.viewedRectangle.pY1;
		const travel = 300;
		layout.scrollTo(layout.viewedRectangle.pX1, staleAnchorY + travel);

		const shortfall = viewY + travel - layout.scrollProperties.viewY;
		nodeassert.strictEqual(
			shortfall,
			viewY - staleAnchorY,
			'the pre-fix anchor must land short by exactly the distance already ' +
				'scrolled into the current slide — the symptom this rig has to ' +
				'be able to see',
		);
		nodeassert.ok(
			shortfall > 0,
			'and the error is always UPWARD, never down the deck',
		);
	});

	it('the scroll origin moves on a pan that leaves the viewed rectangle untouched', function () {
		const layout = setupFileBasedForTest();
		parkMidSlide(layout, 4, 0.1);

		const rectBefore = layout.viewedRectangle.toArray();
		const originBefore = layout.getScrollOrigin();

		// One coast frame: far less than a slide, so the same slides stay on
		// screen. The fling's end-of-document test used to ask the viewed
		// rectangle whether it had moved and got "no" for frames like this.
		layout.scrollTo(originBefore[0], originBefore[1] + 40);
		(layout as any).refreshVisibleAreaRectangle();

		nodeassert.deepStrictEqual(
			layout.viewedRectangle.toArray(),
			rectBefore,
			'precondition: a sub-slide pan does not change which slides are visible',
		);
		nodeassert.notStrictEqual(
			layout.getScrollOrigin()[1],
			originBefore[1],
			'so only the scroll origin can tell a moving coast from a stalled one',
		);
	});

	it('layouts whose scrollTo speaks the viewed rectangle keep anchoring on it', function () {
		setupAppStubs(15);
		const layout = new ViewLayoutBase();
		(layout as any)._viewedRectangle = cool.SimpleRectangle.fromCorePixels([
			120, 340, 393, 852,
		]);

		nodeassert.deepStrictEqual(
			layout.getScrollOrigin(),
			[120, 340],
			'Calc and Writer must be byte-identical: their scrollTo subtracts ' +
				'the viewed rectangle before delegating to scroll()',
		);
	});
});

});
