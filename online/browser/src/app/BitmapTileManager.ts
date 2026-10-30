// @ts-strict-ignore
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

// debugging aid.
function hex2string(inData: any, length: number) {
	var hexified = [];
	var data = new Uint8Array(inData);
	for (var i = 0; i < length; i++) {
		var hex = data[i].toString(16);
		var paddedHex = ('00' + hex).slice(-2);
		hexified.push(paddedHex);
	}
	return hexified.join('');
}

// real RAM sizes for keyframes + delta cache in memory.
let _highDeltaMemory = 120 * 1024 * 1024; // 120Mb
let _lowDeltaMemory = 100 * 1024 * 1024; // 100Mb
// number of tiles
let _highTileCount = 2048;
let _lowTileCount = _highTileCount - 128;

class BitmapTileManager extends RenderManagerBase {
	private _docLayer: any;
	private _zoom: number;
	private _preFetchPart: number;
	private _preFetchMode: number[] = [];

	// R6-7 lever L3: the settle stop a live pinch is predicted to commit —
	// set by prefetchZoomStop while the painter's zoom-animation window is
	// open, cleared by the commit's update(). updateTileDistance keeps this
	// rung's tiles near so a mid-gesture garbage collect cannot evict the
	// speculation before the swap consumes it.
	private _vulcanSpeculativeRung: number = -1;
	private _hasEditPerm: boolean;
	private _pixelBounds: any;
	private _splitPos: any;
	private _borders: any;
	private _cumTileCount: number;
	private _preFetchIdle: any;
	private _tilesPreFetcher: any;
	private _partTilePreFetcher: any;
	private _adjacentTilePreFetcher: any;
	private inTransaction: number = 0;
	private pendingDeltas: any = [];
	private transactionCallbacks: any[] = [];
	private nPendingWorkerTasks: number = 0;
	private nullDeltaUpdate = 0;
	private queuedProcessed: any = [];
	private fetchKeyframeQueue: any = []; // Queue of tiles which were GC'd earlier than coolwsd expected
	private emptyTilesCount: number = 0;
	private debugDeltas: boolean = false;
	private debugDeltasDetail: boolean = false;
	private tiles: Map<string, Tile> = new Map(); // stores all tiles, keyed by coordinates, and cached, compressed deltas
	private tileBitmapList: Tile[] = []; // stores all tiles with bitmaps, sorted by distance from view(s)
	private tileImageCache: Map<string, Uint8Array | null> = new Map();
	public tileSize: number = window.tileSize;

	// The tile distance around the visible tile area that will be requested when updating
	private visibleTileExpansion: number = 1;
	// The tile expansion ratio that the visible tile area will be expanded towards when
	// updating during scrolling.
	//
	// FOUR, NOT TWO, AND THE ARITHMETIC IS THE ARGUMENT. Tiles are 256px. At 2
	// the directional lookahead is 512px and the visible expansion adds one more
	// row, so a scroll ran about 768px ahead of the finger -- LESS THAN ONE
	// 844px phone screen. Any flick outruns it and you scroll into the loading
	// skeleton, which is the "janky loading constantly" a reader actually sees.
	// At 4 the lookahead is 1024px, comfortably more than a screen, so a normal
	// flick lands on tiles that were already requested.
	//
	// The cost is bounded by the bitmap cap (250 below 1280 physical px, i.e.
	// every phone), so this asks for tiles sooner rather than holding more of
	// them -- the eviction policy is unchanged.
	private directionalTileExpansion: number = 4;
	private pausedForCoherency: boolean = false;
	private dehydratedCurrentTiles: string[] = [];
	private shrinkCurrentId: any = null;

	//private static _debugTime: any = {}; Reserved for future.

	// Reused by overlapInvalidatedRectangleWithView; never holds state across
	// calls.
	private invalidateScratchKeys: string[] = [];

	// Decoded-bitmap cap input, latched: window.screen was read per decoded
	// tile, and screen.width follows orientation on Android so rotation
	// flipped the 250/500 cap mid-session. Refreshed only on a density change
	// (see initialize) -- rotation cannot reach it.
	private static cachedPhysicalScreenWidth: number = 0;
	private static physicalScreenWidthListener: DPIChangeListener = null;

	public static refreshPhysicalScreenWidth(): void {
		BitmapTileManager.cachedPhysicalScreenWidth = window.screen
			? window.screen.width * (window.devicePixelRatio || 1)
			: 0;
	}

	public static physicalScreenWidth(): number {
		if (!BitmapTileManager.cachedPhysicalScreenWidth)
			BitmapTileManager.refreshPhysicalScreenWidth();
		return BitmapTileManager.cachedPhysicalScreenWidth;
	}

	// Did we ever get a reply for a tilecombine request?
	private receivedFirstTile: boolean = false;

	// Tasks to be executed after we got our first tile.
	private afterFirstTileTasks: Array<AfterFirstTileTask> = [];

	public initialize() {
		window.app.socket.setTaskHandler(
			'endTransaction',
			this.onWorkerEndTransaction.bind(this),
		);
		window.app.socket.addTaskErrorHandler(this.onWorkerError.bind(this));

		if (!BitmapTileManager.physicalScreenWidthListener) {
			BitmapTileManager.refreshPhysicalScreenWidth();
			BitmapTileManager.physicalScreenWidthListener = new DPIChangeListener(
				BitmapTileManager.refreshPhysicalScreenWidth,
			);
			BitmapTileManager.physicalScreenWidthListener.start();
		}
	}

	public appendAfterFirstTileTask(task: AfterFirstTileTask): void {
		// in case we are already after the first tile -> do in next frame
		if (this.receivedFirstTile)
			app.layoutingService.appendLayoutingTask(() => {
				task();
			});
		// wait for it
		else this.afterFirstTileTasks.push(task);
	}

	/// Called before frame rendering to update details
	public updateOverlayMessages() {
		if (!app.map._debug.tileDataOn) return;

		var totalSize = 0;
		var n_bitmaps = 0;
		var n_current = 0;
		for (const tile of this.tiles.values()) {
			if (tile.image) ++n_bitmaps;
			if (tile.distanceFromView === 0) ++n_current;
			totalSize += tile.rawDeltas.reduce((a, c) => a + c.length, 0);
		}
		let mismatch = '';
		if (n_bitmaps != this.tileBitmapList.length)
			mismatch = '\nmismatch! ' + n_bitmaps + ' vs. ' + this.tileBitmapList;

		app.map._debug.setOverlayMessage(
			'top-tileMem',
			'Tiles: ' +
				String(this.tiles.size).padStart(4, ' ') +
				', bitmaps: ' +
				String(n_bitmaps).padStart(3, ' ') +
				' current ' +
				String(n_current).padStart(3, ' ') +
				', Delta size ' +
				Math.ceil(totalSize / 1024) +
				'(KB)' +
				', Bitmap size: ' +
				Math.ceil(n_bitmaps / 2) +
				'(MB)' +
				mismatch,
		);
	}

	private sortTileKeysByDistance(): string[] {
		return Array.from(this.tiles.keys()).sort((a: any, b: any) => {
			return (
				this.tiles.get(b).distanceFromView - this.tiles.get(a).distanceFromView
			);
		});
	}

	private static setCacheSize(
		lowKb: number,
		highKb: number,
		lowCount: number,
		highCount: number,
	) {
		_lowDeltaMemory = lowKb * 1024;
		_highDeltaMemory = highKb * 1024;
		_lowTileCount = lowCount;
		_highTileCount = highCount;
	}

	public static setDefaultCacheSize() {
		BitmapTileManager.setCacheSize(100 * 1024, 120 * 1024, 2048 - 128, 2048);
	}

	// to exercise manager harder
	public static setLimitedCacheSize() {
		BitmapTileManager.setCacheSize(128, 1024, 50, 100);
	}

	// Set a high and low watermark of how many bitmaps we want
	// and expire old ones
	private garbageCollect(discardAll = false) {
		let highDeltaMemory = _highDeltaMemory;
		let lowDeltaMemory = _lowDeltaMemory;
		let highTileCount = _highTileCount;
		let lowTileCount = _lowTileCount;

		if (discardAll) {
			highDeltaMemory = 0;
			lowDeltaMemory = 0;
			highTileCount = 0;
			lowTileCount = 0;
		}

		// FIXME: could maintain this as we go rather than re-accounting it regularly.
		var totalSize = 0;
		var tileCount = 0;
		for (const tile of this.tiles.values()) {
			// Don't count size of tiles that are visible. We don't have
			// a mechanism to immediately rehydrate tiles, so GC'ing visible tiles would
			// cause flickering.
			if (tile.distanceFromView !== 0) {
				totalSize += tile.rawDeltas.reduce((a, c) => a + c.length, 0);
				tileCount++;
			}
		}

		// FIXME: We should consider also sorting keys by wireId -
		// which is monotonic server rendering ~time.

		// Try to re-use sorting whenever we can - it's expensive
		let sortedKeys: string[] = [];

		// Trim memory down to size.
		if (totalSize > highDeltaMemory) {
			const keys = this.sortTileKeysByDistance();
			sortedKeys = keys;

			for (var i = 0; i < keys.length && totalSize > lowDeltaMemory; ++i) {
				const key = keys[i];
				const tile: Tile = this.tiles.get(key);
				if (tile.rawDeltas.length && tile.distanceFromView !== 0) {
					const rawDeltaSize = tile.rawDeltas.reduce((a, c) => a + c.length, 0);
					totalSize -= rawDeltaSize;
					if (this.debugDeltas)
						window.app.console.log(
							'Reclaim delta ' + key + ' memory: ' + rawDeltaSize + ' bytes',
						);
					this.reclaimTileBitmapMemory(tile);
					tile.rawDeltas = [];
					tile.forceKeyframe();
				}
			}
		}

		// Trim the number of tiles down too ...
		if (tileCount > highTileCount) {
			let keys = sortedKeys;
			if (!keys.length) keys = this.sortTileKeysByDistance();

			for (var i = 0; i < keys.length - lowTileCount; ++i) {
				const key = keys[i];
				const tile: Tile = this.tiles.get(key);
				if (tile.distanceFromView !== 0) this.removeTile(keys[i]);
			}
		}
	}

	// When a new bitmap is set on a tile we should see if we need to expire an old tile
	private setBitmapOnTile(tile: Tile, bitmap: ImageBitmap) {
		// 4k screen -> 8Mpixel, each tile is 64kpixel uncompressed
		// Most tablets and larger displays (physical width >= 1280) get a
		// higher cap so more tiles can stay decoded in memory.
		const highNumBitmaps = VulcanTilePerf.bitmapCapForPhysicalWidth(
			BitmapTileManager.physicalScreenWidth(),
		);

		if (tile.image) {
			// fast case - no impact on count of tiles or bitmap list:
			if (this.extraDebugChecks())
				window.app.console.assert(!!this.tileBitmapList.find((i) => i == tile));
			tile.image.close();
			tile.image = bitmap;
			return;
		}

		if (this.extraDebugChecks())
			window.app.console.assert(!this.tileBitmapList.find((i) => i == tile));

		// free the last tile if we need to
		if (this.tileBitmapList.length > highNumBitmaps) {
			let chosenTile = null;
			let i = this.tileBitmapList.length - 1;

			while (i >= 0) {
				if (this.tileBitmapList[i].distanceFromView > 0) {
					chosenTile = this.tileBitmapList[i];
					break;
				}
				i--;
			}

			if (chosenTile) this.reclaimTileBitmapMemory(chosenTile);
			else
				window.app.console.warn(
					'There are more visible tiles than the allowed cached tile count.',
				);
		}

		// current tiles are first:
		if (tile.distanceFromView === 0) this.tileBitmapList.unshift(tile);
		else {
			let low = 0;
			let high = this.tileBitmapList.length;
			const distance = tile.distanceFromView;

			// sort on insertion
			while (low < high) {
				const mid = Math.floor((low + high) / 2);
				if (this.tileBitmapList[mid].distanceFromView < distance) low = mid + 1;
				else high = mid;
			}
			this.tileBitmapList.splice(low, 0, tile);
		}

		tile.image = bitmap;
	}

	private sortTileBitmapList() {
		// furthest away at the end
		this.tileBitmapList.sort((a, b) => a.distanceFromView - b.distanceFromView);
	}

	// returns negative for not present, and otherwise proportion, low is low expiry.
	public getExpiryFactor(tile: Tile) {
		return (
			this.tileBitmapList.indexOf(tile) /
			Math.max(this.tileBitmapList.length, 1)
		);
	}

	private visibleTilesReady(): boolean {
		for (const tile of this.tiles.values()) {
			if (tile.distanceFromView === 0 && tile.lastPendingId && !tile.isReady())
				return false;
		}
		return true;
	}

	private endTransactionHandleBitmaps(deltas: any[], bitmaps: ImageBitmap[]) {
		while (deltas.length) {
			const delta = deltas.shift();
			const bitmap = bitmaps.shift();

			const tile = this.tiles.get(delta.key);
			if (!tile) continue;

			this.setBitmapOnTile(tile, bitmap);

			if (tile.isReady()) this.tileReady(tile.coords);
		}

		// Check if all current visible tiles are accounted for and resume drawing if so.
		if (this.visibleTilesReady()) {
			if (this.pausedForCoherency) {
				app.sectionContainer.resumeDrawing();
				this.pausedForCoherency = false;
			}
			app.sectionContainer.deferDrawing(null);
			// Ensure that requestReDraw is called at least once. It may not get called in tileReady function.
			app.sectionContainer.requestReDraw();
		}

		if (this.nPendingWorkerTasks === 0)
			while (this.transactionCallbacks.length)
				this.transactionCallbacks.pop()();

		this.garbageCollect();
	}

	private createTileBitmap(
		tile: Tile,
		delta: any,
		deltas: any[],
		bitmaps: Promise<ImageBitmap>[],
	) {
		const imageData = this.tileImageCache.get(tile.coords.toString());
		if (imageData) {
			const clampedData = new Uint8ClampedArray(
				imageData.buffer,
				imageData.byteOffset,
				imageData.byteLength,
			);
			const image = new ImageData(clampedData, this.tileSize, this.tileSize);

			// uncomment to dump each image as a data url to console to see each
			// tile snapshot
			/*
			const extremedebug = false;
			if (extremedebug) {
				const canvas = document.createElement('canvas');
				canvas.width = image.width;
				canvas.height = image.height;
				canvas.getContext('2d').putImageData(image, 0, 0);
				const pngDataUrl = canvas.toDataURL('image/png');
				console.log(pngDataUrl);
			}
			*/

			bitmaps.push(
				createImageBitmap(image, {
					premultiplyAlpha: 'none',
				}),
			);
			deltas.push(delta);
		} else {
			window.app.console.warn(
				'Unusual: Tried to create a tile bitmap with no image data',
			);
		}
	}

	private decompressPendingDeltas() {
		const workers = window.app.socket.getTaskWorkers();
		if (workers.length) {
			// The same tiles need to go to the same workers each time so that the image cache
			// is valid. Split work up based on the tile coords.
			const deltaBuckets = [];
			for (let i = 0; i < workers.length; ++i) {
				deltaBuckets.push([]);
			}
			while (this.pendingDeltas.length) {
				const delta = this.pendingDeltas.shift();
				const bucket =
					Math.round(
						delta.key.x / this.tileSize + delta.key.y / this.tileSize,
					) % workers.length;

				// Replace TileCoordData with string representation
				delta.key = delta.key.key();

				deltaBuckets[bucket].push(delta);
			}
			for (let i = 0; i < workers.length; ++i) {
				const deltas: any[] = deltaBuckets[i];
				const worker = workers[i];
				if (this.debugDeltas)
					window.app.console.debug(
						'XXX delta bucket (' + i + ') length: ' + deltas.length,
					);
				if (deltas.length) {
					++this.nPendingWorkerTasks;
					worker.postMessage(
						{
							message: 'endTransaction',
							deltas: deltas,
							cachedTiles: this.tileImageCache,
							tileSize: this.tileSize,
						},
						deltas.map((x: any) => x.rawDelta.buffer),
					);
				}
			}
		} else {
			// Synchronous path
			++this.nPendingWorkerTasks;

			// Replace TileCoords with string representation
			for (const delta of this.pendingDeltas) delta.key = delta.key.key();

			this.onWorkerEndTransaction({
				data: {
					message: 'endTransaction',
					deltas: this.pendingDeltas,
					tileSize: this.tileSize,
				},
			});
		}
		this.pendingDeltas.length = 0;
	}

	private applyCompressedDelta(
		tile: Tile,
		rawDeltas: cool.RawDelta[],
		isKeyframe: any,
		wireMessage: any,
		ids: number[],
	) {
		if (this.inTransaction === 0)
			window.app.console.warn(
				'applyCompressedDelta called outside of transaction',
			);

		// Concatenate the raw deltas for decompression. This also has the benefit of copying
		// them, which allows us to transfer full ownership of the memory to a worker.
		const rawDelta = new Uint8Array(
			rawDeltas.reduce((a, c) => a + c.length, 0),
		);
		rawDeltas.reduce((a, c) => {
			rawDelta.set(c.delta, a);
			return a + c.length;
		}, 0);

		var e = {
			key: tile.coords,
			rawDelta: rawDelta,
			isKeyframe: isKeyframe,
			wireMessage: wireMessage,
			ids: ids,
		};
		tile.lastPendingId = ids[1];

		this.pendingDeltas.push(e);
	}

	private checkTileMsgObject(msgObj: any) {
		if (
			typeof msgObj !== 'object' ||
			typeof msgObj.x !== 'number' ||
			typeof msgObj.y !== 'number' ||
			typeof msgObj.tileWidth !== 'number' ||
			typeof msgObj.tileHeight !== 'number' ||
			typeof msgObj.part !== 'number' ||
			(typeof msgObj.mode !== 'number' && typeof msgObj.mode !== 'undefined')
		) {
			window.app.console.error(
				'Unexpected content in the parsed tile message.',
			);
		}
	}

	private checkDocLayer() {
		if (this._docLayer) return true;
		else if (!this._docLayer && app.map._docLayer) {
			this._docLayer = app.map._docLayer;
			return true;
		} else return false;
	}

	private viewTileCounts(tileSize: number): [number, number] {
		return [
			Math.floor((app.sectionContainer.getWidth() + tileSize - 1) / tileSize),
			Math.floor((app.sectionContainer.getHeight() + tileSize - 1) / tileSize),
		];
	}

	private getMaxTileCountToPrefetch(tileSize: number): number {
		const [viewTileWidth, viewTileHeight] = this.viewTileCounts(tileSize);
		// Read-only views pre-load more aggressively — except on the phone
		// chrome, where read-only is the opening posture and the x4 rate is
		// what fed the fetch/evict treadmill (see TilePerfBudget.ts).
		return VulcanTilePerf.prefetchTileBudget(
			viewTileWidth,
			viewTileHeight,
			this._hasEditPerm,
			this.isVulcanPhoneChrome(),
		);
	}

	private updateProperties() {
		let updated: boolean = false;

		const zoom = app.map.getZoom();
		if (this._zoom !== zoom) {
			this._zoom = zoom;
			updated = true;
		}

		const part = this._docLayer._selectedPart;
		if (this._preFetchPart !== part) {
			this._preFetchPart = part;
			updated = true;
		}

		if (
			app.activeDocument &&
			!app.activeDocument.activeModes.every((item) => {
				return this._preFetchMode.includes(item);
			})
		) {
			this._preFetchMode = app.activeDocument.activeModes;
			updated = true;
		}

		const hasEditPerm = app.map.isEditMode();
		if (this._hasEditPerm !== hasEditPerm) {
			this._hasEditPerm = hasEditPerm;
			updated = true;
		}

		const center = app.map.getCenter();
		const pixelBounds = app.map.getPixelBoundsCore(center, this._zoom);
		if (!this._pixelBounds || !pixelBounds.equals(this._pixelBounds)) {
			this._pixelBounds = pixelBounds;
			updated = true;
		}

		const splitPanesContext = this._docLayer.getSplitPanesContext();
		const splitPos = splitPanesContext
			? splitPanesContext.getSplitPos()
			: new cool.Point(0, 0);
		if (!this._splitPos || !splitPos.equals(this._splitPos)) {
			this._splitPos = splitPos;
			updated = true;
		}

		return updated;
	}

	private computeBorders() {
		// Need to compute borders afresh and fetch tiles for them.
		this._borders = []; // Stores borders for each split-pane.
		const tileRanges = this.pxBoundsToTileRanges(this._pixelBounds);

		const splitPanesContext = this._docLayer.getSplitPanesContext();
		const paneStatusList = splitPanesContext
			? splitPanesContext.getPanesProperties()
			: [{ xFixed: false, yFixed: false }];

		window.app.console.assert(
			tileRanges.length === paneStatusList.length,
			'tileRanges and paneStatusList should agree on the number of split-panes',
		);

		for (let paneIdx = 0; paneIdx < tileRanges.length; ++paneIdx) {
			if (paneStatusList[paneIdx].xFixed && paneStatusList[paneIdx].yFixed) {
				continue;
			}

			const tileRange = tileRanges[paneIdx];
			const paneBorder = new cool.Bounds(
				tileRange.min.add(new cool.Point(-1, -1)),
				tileRange.max.add(new cool.Point(1, 1)),
			);

			this._borders.push(
				new PaneBorder(
					paneBorder,
					paneStatusList[paneIdx].xFixed,
					paneStatusList[paneIdx].yFixed,
				),
			);
		}
	}

	private clearTilesPreFetcher() {
		if (this._tilesPreFetcher !== undefined) {
			clearInterval(this._tilesPreFetcher);
			this._tilesPreFetcher = undefined;
		}
	}

	/*
	 * R6-7 lever L3 — SPECULATIVE SETTLE PREFETCH. A pinch renders scaled
	 * tiles all gesture and only requests the committed rung's tiles AFTER
	 * the release ease (~+154ms measured), so every zoom-in swapped at the
	 * wait deadline with holes (z1 rig: Impress +429ms allTiles=false, then
	 * a ~4.4s pop-in trail; server RTT for a full viewport is 70-90ms).
	 * The painter calls this mid-gesture with the rung the release grammar
	 * predicts: ONE viewport of that rung's missing tiles is requested —
	 * no rings, no parts fan-out (the round-4 budget spirit) — so the
	 * commit's own wait exits on its first poll. The receive side is
	 * already cross-rung (ServerCommand derives the rung from the reply's
	 * tilewidth); the send side rides the per-rung twips this class now
	 * threads through sendTileCombineRequest. Tile.requestingTooFast
	 * dedupes re-fires; a superseded prediction's tiles simply land in the
	 * cross-rung cache the zoom-out source hunt already reads.
	 *
	 * targetZoom: the predicted commit rung. centerCorePx: the predicted
	 * commit center, core px in targetZoom's frame (the painter's
	 * _getZoomMapCenter answer).
	 */
	public prefetchZoomStop(targetZoom: number, centerCorePx: any): void {
		if (!this.canDeriveRungTwips()) return;
		if (targetZoom === Math.round(app.map.getZoom())) return;
		this._vulcanSpeculativeRung = targetZoom;

		const size: any = app.map.getSize();
		const halfX = (size.x * app.dpiScale) / 2;
		const halfY = (size.y * app.dpiScale) / 2;
		const bounds = new cool.Bounds(
			new cool.Point(centerCorePx.x - halfX, centerCorePx.y - halfY),
			new cool.Point(centerCorePx.x + halfX, centerCorePx.y + halfY),
		);

		const queue: TileCoordData[] = [];
		const part = app.map._docLayer._selectedPart;
		const mode = app.activeDocument.activeModes[0];
		const consider = (coords: TileCoordData): void => {
			if (!this.isValidTile(coords)) return;
			if (!this.tileNeedsFetch(coords.key())) return;
			// Pre-created so requestingTooFast can dedupe re-fires and the
			// arrival finds its distance already ranked near.
			this.createTile(coords);
			queue.push(coords);
		};
		if (app.file.fileBasedView) {
			// The stacked read deck's tiles are per-part; the layout owns
			// that mapping and can answer for an arbitrary rung (the same
			// checkOnly route drawZoomFrame's walk uses — its coords already
			// carry targetZoom).
			const coordList = this.updateFileBasedView(true, bounds, targetZoom);
			for (let i = 0; i < coordList.length; i++) consider(coordList[i]);
		} else {
			const range = this.pxBoundsToTileRange(bounds);
			for (let j = range.min.y; j <= range.max.y; j++)
				for (let i = range.min.x; i <= range.max.x; i++)
					consider(
						new TileCoordData(
							i * this.tileSize,
							j * this.tileSize,
							targetZoom,
							part,
							mode,
						),
					);
		}
		this.sendTileCombineRequest(queue);
	}

	private preFetchPartTiles(part: number, modes: number[]): void {
		this.updateProperties();
		const tileRange = this.pxBoundsToTileRange(this._pixelBounds);

		for (let k = 0; k < modes.length; k++) {
			const tileCombineQueue = [];

			for (let j = tileRange.min.y; j <= tileRange.max.y; j++) {
				for (let i = tileRange.min.x; i <= tileRange.max.x; i++) {
					const coords = new TileCoordData(
						i * this.tileSize,
						j * this.tileSize,
						this._zoom,
						part,
						modes[k],
					);

					if (!this.isValidTile(coords)) continue;

					const key = coords.key();
					if (!this.tileNeedsFetch(key)) continue;

					tileCombineQueue.push(coords);
				}
			}

			this.sendTileCombineRequest(tileCombineQueue);
		}
	}

	private queueAcknowledgement(tileMsgObj: any) {
		// Queue acknowledgment, that the tile message arrived
		this.queuedProcessed.push(+tileMsgObj.wireId);
	}

	private twipsToCoords(twips: any) {
		return new TileCoordData(
			Math.round(twips.x / twips.tileWidth) * this.tileSize,
			Math.round(twips.y / twips.tileHeight) * this.tileSize,
		);
	}

	private tileMsgToCoords(tileMsg: any) {
		var coords = this.twipsToCoords(tileMsg);
		coords.z = tileMsg.zoom;
		coords.part = tileMsg.part;
		coords.mode = tileMsg.mode !== undefined ? tileMsg.mode : 0;
		return coords;
	}

	private checkPointers() {
		if (app.map && app.map._docLayer) return true;
		else return false;
	}

	public beginTransaction() {
		++this.inTransaction;
	}

	private tileZoomIsCurrent(coords: TileCoordData) {
		const scale = Math.pow(1.2, app.map.getZoom() - 10);
		return Math.round(coords.scale * 1000) === Math.round(scale * 1000);
	}

	private tileReady(coords: TileCoordData) {
		var key = coords.key();

		const tile: Tile = this.tiles.get(key);
		if (!tile) return;

		// Discard old raw deltas
		for (let i = tile.rawDeltas.length - 1; i > 0; --i) {
			if (tile.rawDeltas[i].isKeyframe) {
				tile.rawDeltas = tile.rawDeltas.splice(i);
				break;
			}
		}

		var emptyTilesCountChanged = false;
		if (this.emptyTilesCount > 0) {
			this.emptyTilesCount -= 1;
			emptyTilesCountChanged = true;
		}

		if (app.map && emptyTilesCountChanged && this.emptyTilesCount === 0) {
			app.map.fire('statusindicator', { statusType: 'alltilesloaded' });
		}

		// Request a redraw if the tile is visible
		const tileSizeTwips = Math.round(this.tileSize * app.pixelsToTwips);
		const tilePos = tile.coords.getPosSimplePoint();
		// tile.x/y are page-local for fileBasedView while viewedRectangle is
		// doc-space; without the part's stacked offset every part > 0 reads as
		// off-screen here.
		let tileX = tilePos.x;
		let tileY = tilePos.y;
		if (app.file.fileBasedView) {
			const layout = app.activeDocument?.activeLayout;
			if (layout && layout.type === 'ViewLayoutFileBased') {
				const partRect = (layout as ViewLayoutFileBased).getDocumentPartRect(
					tile.coords.part,
				);
				if (partRect) {
					tileX += partRect.x1;
					tileY += partRect.y1;
				}
			}
		}
		if (
			app.isRectangleVisibleInTheDisplayedArea([
				tileX,
				tileY,
				tileSizeTwips,
				tileSizeTwips,
			])
		)
			app.sectionContainer.requestReDraw();
	}

	private createTile(coords: TileCoordData) {
		const key = coords.key();
		if (this.tiles.has(key)) {
			if (this.debugDeltas)
				window.app.console.debug('Already created tile ' + key);
			return this.tiles.get(key);
		}
		const tile = new Tile(coords);

		this.tiles.set(key, tile);

		return tile;
	}

	// Make the given tile current and rehydrates if necessary. Returns true if the tile
	// has pending updates.
	private makeTileCurrent(tile: Tile): boolean {
		tile.distanceFromView = 0;
		tile.allowFastRequest();
		this.rehydrateTile(tile, false);

		return !tile.isReady();
	}

	private rehydrateTile(tile: Tile, wireMessage: boolean) {
		if (tile.needsRehydration()) {
			// If we dehydrate a visible tile, wait for it to be ready before drawing.
			// We may want to consider this being a threshold rather than definitely-visible as
			// dehydration is asynchronous and our scroll position may move.
			if (tile.distanceFromView === 0 && !this.pausedForCoherency) {
				app.sectionContainer.pauseDrawing();
				this.pausedForCoherency = true;
			}

			// Re-hydrate tile from cached raw deltas.
			if (this.debugDeltas)
				window.app.console.log(
					'Restoring a tile from cached delta at ' + tile.coords.key(),
				);

			// Get the index of the last stored keyframe
			// FIXME: EcmaScript 2023 has Array.findLastIndex
			let firstDelta = 0;
			for (let i = tile.rawDeltas.length - 1; i > 0; --i) {
				if (tile.rawDeltas[i].isKeyframe) {
					firstDelta = i;
					break;
				}
			}

			// Check if we have already decompressed data we can work from
			if (tile.lastPendingId > tile.rawDeltas[firstDelta].id) {
				const continuedIdIndex = tile.rawDeltas.findIndex(
					(d) => d.id === tile.lastPendingId,
				);
				if (continuedIdIndex !== -1) firstDelta = continuedIdIndex + 1;
			}
			const rawDeltas = tile.rawDeltas.slice(firstDelta);
			const lastId = tile.rawDeltas[tile.rawDeltas.length - 1].id;

			this.applyCompressedDelta(
				tile,
				rawDeltas,
				tile.rawDeltas[firstDelta].isKeyframe,
				wireMessage,
				[tile.rawDeltas[firstDelta].id, lastId],
			);
		}
	}

	private rehydrateCurrentTiles() {
		// Clear the deferred callback immediately. This function is a one-shot
		// callback that drains dehydratedCurrentTiles; keeping it registered
		// causes every subsequent requestReDraw() to invoke it instead of
		// scheduling a requestAnimationFrame, which freezes the canvas.
		// Drawing is paused via pauseDrawing()/resumeDrawing() inside
		// rehydrateTile() until worker bitmaps arrive, so clearing the
		// callback here does not cause premature draws.
		app.sectionContainer.deferDrawing(null);

		// If the graphics memory of visible tiles was reclaimed, we have tiles that
		// have a valid delta cache, but no corresponding bitmap.
		this.beginTransaction();
		while (this.dehydratedCurrentTiles.length) {
			const tile = this.tiles.get(this.dehydratedCurrentTiles.pop());
			if (tile) this.rehydrateTile(tile, false);
		}
		this.endTransaction(null);
	}

	public endTransaction(callback: any = null) {
		if (this.inTransaction === 0) {
			window.app.console.error('Mismatched endTransaction');
			return;
		}

		--this.inTransaction;
		if (callback) this.transactionCallbacks.push(callback);

		if (this.inTransaction !== 0) return;

		// Short-circuit if there's nothing to decompress
		if (!this.pendingDeltas.length) {
			if (callback) {
				this.transactionCallbacks.pop();
				callback();
			}
			return;
		}

		try {
			this.decompressPendingDeltas();
		} catch (e) {
			window.app.console.error('Failed to decompress pending deltas');
			window.app.socket.disableTaskWorkers();
			this.inTransaction = 0;
			if (callback) callback();
			return;
		}
	}

	private applyDelta(
		tile: Tile,
		rawDeltas: any[],
		deltas: any,
		keyframeDeltaSize: any,
		keyframeImage: Uint8Array,
	) {
		const rawDeltaSize = rawDeltas.reduce((a, c) => a + c.length, 0);

		if (this.debugDeltas) {
			const hexStrings = [];
			for (const rawDelta of rawDeltas)
				hexStrings.push(hex2string(rawDelta, rawDelta.length));
			const hexString = hexStrings.join('');

			window.app.console.log(
				'Applying a raw ' +
					(keyframeDeltaSize ? 'keyframe' : 'delta') +
					' of length ' +
					rawDeltaSize +
					(this.debugDeltasDetail ? ' hex: ' + hexString : ''),
			);
		}

		var traceEvent = app.socket.createCompleteTraceEvent(
			'L.CanvasTileLayer.applyDelta',
			{ keyFrame: !!keyframeDeltaSize, length: rawDeltaSize },
		);

		const key = tile.coords.toString();
		const imgData = keyframeImage
			? keyframeImage
			: this.tileImageCache.get(key);
		if (!imgData) {
			window.app.console.error(
				'Trying to apply delta with no image data cache',
			);
			return;
		}

		cool.CanvasTileUtils.updateImageFromDeltas(
			imgData,
			deltas,
			keyframeDeltaSize,
			this.tileSize,
			this.debugDeltas,
		);

		// hold onto the original imgData for reuse in the no keyframe case
		this.tileImageCache.set(key, imgData);

		if (traceEvent) traceEvent.finish();
	}

	private removeTile(key: string) {
		const tile = this.tiles.get(key);
		if (!tile) return;

		if (!tile.hasContent() && this.emptyTilesCount > 0)
			this.emptyTilesCount -= 1;

		this.reclaimTileBitmapMemory(tile);
		this.tiles.delete(key);
	}

	private removeAllTiles() {
		this.tileBitmapList = [];
		for (const key of Array.from(this.tiles.keys())) {
			this.removeTile(key);
		}
	}

	private sortFileBasedQueue(queue: any) {
		for (var i = 0; i < queue.length - 1; i++) {
			for (var j = i + 1; j < queue.length; j++) {
				var a = queue[i];
				var b = queue[j];
				var switchTiles = false;

				if (a.part === b.part) {
					if (a.y > b.y) {
						switchTiles = true;
					} else if (a.y === b.y) {
						switchTiles = a.x > b.x;
					} else {
						switchTiles = false;
					}
				} else {
					switchTiles = a.part > b.part;
				}

				if (switchTiles) {
					var temp = a;
					queue[i] = b;
					queue[j] = temp;
				}
			}
		}
	}

	private reclaimTileBitmapMemory(tile: Tile) {
		if (tile.image) {
			tile.image.close();
			tile.image = null;
			this.tileImageCache.delete(tile.coords.toString());

			tile.decompressedId = 0;
			tile.lastPendingId = 0;

			const n = this.tileBitmapList.findIndex((it) => it == tile);
			if (n !== -1) this.tileBitmapList.splice(n, 1);
		}
	}

	private initPreFetchPartTiles() {
		if (!this.checkDocLayer()) return;

		const targetPart = this._docLayer._selectedPart + app.map._partsDirection;

		if (targetPart < 0 || targetPart >= this._docLayer._parts) return;

		// check existing timeout and clear it before the new one
		if (this._partTilePreFetcher) clearTimeout(this._partTilePreFetcher);

		this._partTilePreFetcher = setTimeout(() => {
			this.preFetchPartTiles(targetPart, app.activeDocument.activeModes);
		}, 100);
	}

	private initPreFetchAdjacentTiles() {
		if (!this.checkDocLayer()) return;

		this.updateProperties();

		if (this._adjacentTilePreFetcher)
			clearTimeout(this._adjacentTilePreFetcher);

		this._adjacentTilePreFetcher = setTimeout(
			function () {
				// Extend what we request to include enough to populate a full
				// scroll in the direction we were going after or before
				// the current viewport
				//
				// request separately from the current viewPort to get
				// those tiles first.

				const direction = app.activeDocument.activeLayout.getLastPanDirection();

				// Conservatively enlarge the area to round to more tiles:
				const pixelTopLeft = this._pixelBounds.getTopLeft();
				pixelTopLeft.y =
					Math.floor(pixelTopLeft.y / this.tileSize) * this.tileSize;
				pixelTopLeft.y -= 1;

				const pixelBottomRight = this._pixelBounds.getBottomRight();
				pixelBottomRight.y =
					Math.ceil(pixelBottomRight.y / this.tileSize) * this.tileSize;
				pixelBottomRight.y += 1;

				this._pixelBounds = new cool.Bounds(pixelTopLeft, pixelBottomRight);

				// Translate the area in the direction we're going.
				this._pixelBounds.translate(
					this._pixelBounds.getSize().x * direction[0],
					this._pixelBounds.getSize().y * direction[1],
				);

				var queue = this.getMissingTiles(this._pixelBounds, this._zoom);

				if (this._docLayer.isCalc() || queue.length === 0) {
					// pre-load more aggressively
					this._pixelBounds.translate(
						(this._pixelBounds.getSize().x * direction[0]) / 2,
						(this._pixelBounds.getSize().y * direction[1]) / 2,
					);
					queue = queue.concat(
						this.getMissingTiles(this._pixelBounds, this._zoom),
					);
				}

				if (queue.length !== 0) this.addTiles(queue);
			}.bind(this),
			50 /*ms*/,
		);
	}

	private sendTileCombineMessage(
		part: number,
		mode: number,
		tilePositionsX: number[],
		tilePositionsY: number[],
		tileWids: number[],
		addedSize: number,
		// R6-7 lever L3: a speculative request addresses a rung the map is
		// not on yet, so its twips cannot come from the current-rung
		// globals. 0 keeps the shipped globals (every same-rung caller).
		tileTwipsX: number = 0,
		tileTwipsY: number = 0,
	) {
		var msg =
			'tilecombine ' +
			'nviewid=0 ' +
			'part=' +
			part +
			' ' +
			(mode !== 0 ? 'mode=' + mode + ' ' : '') +
			'width=' +
			this.tileSize +
			' ' +
			'height=' +
			this.tileSize +
			' ' +
			'tileposx=' +
			tilePositionsX.join(',') +
			' ' +
			'tileposy=' +
			tilePositionsY.join(',') +
			' ' +
			'oldwid=' +
			tileWids.join(',') +
			' ' +
			'tilewidth=' +
			(tileTwipsX || app.tile.size.x) +
			' ' +
			'tileheight=' +
			(tileTwipsY || app.tile.size.y);
		if (addedSize) app.socket.sendMessage(msg);
		else window.app.console.log('Skipped empty (too fast) tilecombine');
	}

	private sendTileCombineRequest(tileCombineQueue: Array<TileCoordData>) {
		if (tileCombineQueue.length <= 0) return;

		// Sort into buckets of consistent part, mode & rung. One message
		// carries ONE tilewidth, so mixed-rung queues (R6-7 speculative
		// prefetch) must split — a cross-rung position under the wrong
		// tilewidth would address a different tile.
		const partMode: any = {};
		for (var i = 0; i < tileCombineQueue.length; ++i) {
			const coords = tileCombineQueue[i];
			// mode is a small number - give it 8 bits; rungs fit above part.
			const pmKey = (coords.z << 16) + (coords.part << 8) + coords.mode;
			if (partMode[pmKey] === undefined) partMode[pmKey] = [];
			partMode[pmKey].push(coords);
		}

		var now = new Date();

		for (var pmKey in partMode) {
			// no keys method
			var partTileQueue = partMode[pmKey];
			var part = partTileQueue[0].part;
			var mode = partTileQueue[0].mode;

			// Rung twips for this bucket: the shipped globals on the current
			// rung (0 = "use the global" downstream), the coords' own rung
			// otherwise. (R6-7 lever L3)
			var bucketTwipsX = 0;
			var bucketTwipsY = 0;
			const anyMap: any = app.map;
			const offRung =
				anyMap &&
				typeof anyMap.getZoom === 'function' &&
				partTileQueue[0].z !== Math.round(anyMap.getZoom());
			if (offRung) {
				if (this.canDeriveRungTwips()) {
					bucketTwipsX = this.tileTwipsAtZoom(partTileQueue[0].z);
					bucketTwipsY = bucketTwipsX;
				} else {
					// A rung we cannot address on the wire (#7785's stale-zoom
					// leak, on a layer without rung-twips plumbing): serialised
					// with the CURRENT tilewidth these positions name the
					// current rung's tiles, duplicating the current bucket's
					// entries tile-for-tile — the same wire tile twice, merely
					// split across combines. The rung-split above keeps
					// coolwsd's per-message hasDuplicates() quiet, but the
					// request is still wrong twice over: a duplicate, and
					// mis-addressed (it could never satisfy the stale rung's
					// fetch anyway). Drop the bucket, as the shipped
					// wire-position uniqifier dropped the stale entry.
					continue;
				}
			}

			var tilePositionsX = [];
			var tilePositionsY = [];
			var tileWids = [];

			const added: Set<string> = new Set(); // uniqify
			for (var i = 0; i < partTileQueue.length; ++i) {
				const coords = partTileQueue[i];
				const key = coords.key();
				const tile = this.tiles.get(key);

				// don't send lots of duplicate, fast tilecombines
				if (tile && tile.requestingTooFast(now)) continue;

				const twips = new cool.Point(
					Math.floor(coords.x / this.tileSize) *
						(bucketTwipsX || app.tile.size.x),
					Math.floor(coords.y / this.tileSize) *
						(bucketTwipsY || app.tile.size.y),
				);

				// Uniqify on the wire position, not coords.key(): the key carries
				// zoom, the tilecombine wire format does not, so two coords that
				// differ only in z serialise to the same tile. coolwsd rejects the
				// WHOLE combine on a duplicate position (ClientSession.cpp), so one
				// stale-zoom entry costs every tile in the message.
				const wireKey = twips.x + ':' + twips.y;
				if (added.has(wireKey)) continue;
				added.add(wireKey);

				// build parameters
				tileWids.push(tile && tile.wireId !== undefined ? tile.wireId : 0);

				tilePositionsX.push(twips.x);
				tilePositionsY.push(twips.y);

				if (tile) tile.updateLastRequest(now);
			}

			this.sendTileCombineMessage(
				part,
				mode,
				tilePositionsX,
				tilePositionsY,
				tileWids,
				added.size,
				bucketTwipsX,
				bucketTwipsY,
			);

			// When Writer requests mode=2, also request mode=1.
			if (app.map._docLayer.isWriter() && mode === 2) {
				this.sendTileCombineMessage(
					part,
					/*mode=*/ 1,
					tilePositionsX,
					tilePositionsY,
					tileWids,
					added.size,
					bucketTwipsX,
					bucketTwipsY,
				);
			}
		}
	}

	private tileNeedsFetch(key: string) {
		const tile: Tile = this.tiles.get(key);
		return !tile || tile.needsFetch();
	}

	private pxBoundsToTileRanges(bounds: any) {
		if (!this.checkPointers()) return null;

		if (!app.map._docLayer._splitPanesContext) {
			return [this.pxBoundsToTileRange(bounds)];
		}

		var boundList = app.map._docLayer._splitPanesContext.getPxBoundList(bounds);
		return boundList.map((x: any) => this.pxBoundsToTileRange(x));
	}

	private updateTileDistance(tile: Tile, zoom: number) {
		if (
			tile.coords.z !== zoom ||
			tile.coords.part !== app.map._docLayer._selectedPart ||
			!app.activeDocument.isModeActive(tile.coords.mode)
		)
			// R6-7 lever L3: tiles of the PREDICTED settle stop are the next
			// swap's content, not stale cross-rung leftovers — rank them just
			// behind the visible set so a mid-gesture garbage collect cannot
			// evict the speculation before the commit consumes it. The
			// marker only lives between prefetchZoomStop and the commit's
			// update().
			tile.distanceFromView =
				tile.coords.z === this._vulcanSpeculativeRung &&
				tile.coords.part === app.map._docLayer._selectedPart &&
				app.activeDocument.isModeActive(tile.coords.mode)
					? 1
					: Number.MAX_SAFE_INTEGER;
		else {
			const tileSizeTwips = Math.round(this.tileSize * app.pixelsToTwips);

			if (
				app.isRectangleVisibleInTheDisplayedArea([
					tile.coords.getPosSimplePoint().x,
					tile.coords.getPosSimplePoint().y,
					tileSizeTwips,
					tileSizeTwips,
				])
			)
				tile.distanceFromView = 0;
			else {
				const tileCenter = [
					Math.round(tile.coords.x + tileSizeTwips * 0.5),
					Math.round(tile.coords.y + tileSizeTwips * 0.5),
				];
				const viewCenter =
					app.activeDocument.activeLayout.viewedRectangle.center;
				tile.distanceFromView = new cool.SimplePoint(
					tileCenter[0],
					tileCenter[1],
				).distanceTo(viewCenter);
			}
		}
	}

	private updateAllTileDistances() {
		// FIXME: updateFileBasedView seems to be doing a lot. Does it need to be special-cased?
		if (app.file.fileBasedView) this.updateFileBasedView(true);
		else {
			const zoom = Math.round(app.map.getZoom());

			for (const [_index, tile] of this.tiles.entries()) {
				this.updateTileDistance(tile, zoom);
			}

			this.sortTileBitmapList();
		}
	}

	private getMissingTiles(
		pixelBounds: cool.Bounds,
		zoom: number,
		isCurrent: boolean = false,
	) {
		if (
			['ViewLayoutCompareChanges', 'ViewLayoutMultiPage'].includes(
				app.activeDocument.activeLayout.type,
			)
		) {
			for (const tile of this.tiles.values()) {
				this.updateTileDistance(tile, zoom);
			}
			this.sortTileBitmapList();

			this.beginTransaction();
			const queue = this.checkRequestTiles(
				app.activeDocument.activeLayout.getCurrentCoordList(),
				false,
			);
			this.endTransaction(null);
			return queue;
		}

		var tileRanges = this.pxBoundsToTileRanges(pixelBounds);
		const queue = [];

		// If we're looking for tiles for the current (visible) area, update tile distance.
		if (isCurrent) {
			for (const tile of this.tiles.values()) {
				this.updateTileDistance(tile, zoom);
			}
			this.sortTileBitmapList();
		}

		// create a queue of coordinates to load tiles from. Rehydrate tiles if we're dealing
		// with the currently visible area.
		this.beginTransaction();
		for (var rangeIdx = 0; rangeIdx < tileRanges.length; ++rangeIdx) {
			// Expand the 'current' area to add a small buffer around the visible area that
			// helps us avoid visible tile updates.
			const tileRange =
				isCurrent && !this.shrinkCurrentId
					? this.expandTileRange(tileRanges[rangeIdx])
					: tileRanges[rangeIdx];

			for (var j = tileRange.min.y; j <= tileRange.max.y; ++j) {
				for (var i = tileRange.min.x; i <= tileRange.max.x; ++i) {
					var coords = new TileCoordData(
						i * this.tileSize,
						j * this.tileSize,
						zoom,
						app.map._docLayer._selectedPart,
						app.activeDocument.activeModes[0],
					);

					if (!this.isValidTile(coords)) continue;

					const key = coords.key();
					const tile = this.tiles.get(key);

					if (!tile || tile.needsFetch()) {
						queue.push(coords);
						// A visible tile that was invalidated and lost its
						// bitmap (e.g. permission change triggered an EMPTY
						// invalidate then a tab blur reclaimed graphics
						// memory) still has its cached rawDeltas. Core will
						// not resend content because our oldwid matches, so
						// without a rehydrate here the tile stays blank.
						// Rehydrate directly rather than via makeTileCurrent
						// to avoid bypassing the tilecombine cooldown.
						if (
							isCurrent &&
							tile &&
							tile.distanceFromView === 0 &&
							tile.hasKeyframe() &&
							!tile.image
						)
							this.rehydrateTile(tile, false);
					} else if (isCurrent) this.makeTileCurrent(tile);
				}
			}
		}
		this.endTransaction(null);

		return queue;
	}

	private removeIrrelevantsFromCoordsQueue(coordsQueue: Array<TileCoordData>) {
		const part: number = app.map._docLayer._selectedPart;

		// i >= 0: index 0 is not a distinguished tile — this runs before the
		// caller's sort, so it is just insertion order. The reachable case is a
		// stale MODE: updateProperties resyncs _preFetchPart from _selectedPart
		// every pass, but refreshes _preFetchMode only when activeModes GROWS,
		// so a shrink leaves the border walk queueing a mode we have left.
		for (let i = coordsQueue.length - 1; i >= 0; i--) {
			if (
				coordsQueue[i].part !== part ||
				!app.activeDocument.isModeActive(coordsQueue[i].mode) ||
				!this.tileNeedsFetch(coordsQueue[i].key())
			) {
				coordsQueue.splice(i, 1);
			} else if (app.map._docLayer._moveInProgress) {
				// While we are actively scrolling, filter out duplicate
				// (still) missing tiles requests during the scroll.
				if (app.map._docLayer._moveTileRequests.includes(coordsQueue[i].key()))
					coordsQueue.splice(i, 1);
				else app.map._docLayer._moveTileRequests.push(coordsQueue[i].key());
			}
		}
	}

	// create tiles if needed for queued coordinates, and build a
	// tilecombined request for any tiles we need to fetch.
	private addTiles(
		coordsQueue: Array<TileCoordData>,
		isCurrent: boolean = false,
	) {
		// Remove irrelevant tiles from the queue earlier.
		this.removeIrrelevantsFromCoordsQueue(coordsQueue);

		const zoom = Math.round(app.map.getZoom());

		// Ensure tiles exist for requested coordinates
		for (let i = 0; i < coordsQueue.length; i++) {
			const key = coordsQueue[i].key();
			let tile: Tile = this.tiles.get(key);

			if (!tile) {
				tile = this.createTile(coordsQueue[i]);

				// Newly created tiles have a distance of zero, which means they're current.
				if (!isCurrent) this.updateTileDistance(tile, zoom);
			}
		}

		// sort the tiles by the rows
		coordsQueue.sort(function (a, b) {
			if (a.y !== b.y) return a.y - b.y;
			else return a.x - b.x;
		});

		// try group the tiles into rectangular areas
		const rectangles = [];
		while (coordsQueue.length > 0) {
			const coords: TileCoordData = coordsQueue[0];

			const rectQueue: Array<TileCoordData> = [coords];
			const bound = coords.getPos(); // cool.Point

			// remove it
			coordsQueue.splice(0, 1);

			// find the close ones
			let rowLocked = false;
			let hasHole = false;
			let i = 0;
			while (i < coordsQueue.length) {
				const current: TileCoordData = coordsQueue[i];

				// extend the bound vertically if possible (so far it was continuous)
				if (!hasHole && current.y === bound.y + this.tileSize) {
					rowLocked = true;
					bound.y += this.tileSize;
				}

				if (current.y > bound.y) break;

				if (!rowLocked) {
					if (current.y === bound.y && current.x === bound.x + this.tileSize) {
						// extend the bound horizontally
						bound.x += this.tileSize;
						rectQueue.push(current);
						coordsQueue.splice(i, 1);
					} else {
						// ignore the rest of the row
						rowLocked = true;
						++i;
					}
				} else if (current.x <= bound.x && current.y <= bound.y) {
					// we are inside the bound
					rectQueue.push(current);
					coordsQueue.splice(i, 1);
				} else {
					// ignore this one, but there still may be other tiles
					hasHole = true;
					++i;
				}
			}

			rectangles.push(rectQueue);
		}

		for (let r = 0; r < rectangles.length; ++r)
			this.sendTileCombineRequest(rectangles[r]);

		if (
			app.map._docLayer._docType === 'presentation' ||
			app.map._docLayer._docType === 'drawing'
		)
			this.initPreFetchPartTiles();
	}

	public refreshTilesInBackground() {
		for (const tile of this.tiles.values()) {
			tile.forceKeyframe();
		}
	}

	public setDebugDeltas(state: boolean) {
		this.debugDeltas = state;
		this.debugDeltasDetail = state;
	}

	public get(coords: TileCoordData): Tile {
		return this.tiles.get(coords.key());
	}

	public getTiles(): Map<string, Tile> {
		return this.tiles;
	}

	private pixelCoordsToTwipTileBounds(coords: TileCoordData): number[] {
		// We need to calculate pixelsToTwips for the scale of this tile. 15 is the ratio between pixels and twips when the scale is 1.
		const pixelsToTwipsForTile = 15 / app.dpiScale / coords.scale;
		const x = coords.x * pixelsToTwipsForTile;
		const y = coords.y * pixelsToTwipsForTile;
		const width = app.tile.size.pX * pixelsToTwipsForTile;
		const height = app.tile.size.pY * pixelsToTwipsForTile;

		return [x, y, width, height];
	}

	public overlapInvalidatedRectangleWithView(
		part: number,
		mode: number,
		wireId: number,
		invalidatedRectangle: cool.SimpleRectangle,
		textMsg: string,
	) {
		let needsNewTiles = false;
		const calc = app.map._docLayer.isCalc();

		let modeArray = [mode];
		if (app.activeDocument.activeLayout.type === 'ViewLayoutCompareChanges')
			modeArray = [1, 2];
		// Only CompareChanges has more than one mode; -1 never matches a mode.
		const singleMode = modeArray.length === 1 ? modeArray[0] : -1;

		// invalidateTile can removeTile, so matches are collected first into a
		// reused scratch instead of snapshotting every entry with Array.from.
		const scratch = this.invalidateScratchKeys;
		scratch.length = 0;
		for (const [key, tile] of this.tiles) {
			const coords: TileCoordData = tile.coords;
			if (coords.part !== part) continue;
			if (
				singleMode !== -1
					? coords.mode !== singleMode
					: !modeArray.includes(coords.mode)
			)
				continue;
			if (
				// In calc, we invalidate all tiles with different zoom levels.
				!(calc && !this.tileZoomIsCurrent(coords)) &&
				!invalidatedRectangle.intersectsRectangle(
					this.pixelCoordsToTwipTileBounds(coords),
				)
			)
				continue;

			if (tile.distanceFromView === 0) needsNewTiles = true;
			scratch.push(key);
		}
		for (const key of scratch) this.invalidateTile(key, wireId);
		scratch.length = 0;

		if (
			app.map._docLayer._debug.tileInvalidationsOn &&
			part === app.map._docLayer._selectedPart
		) {
			app.map._docLayer._debug.addTileInvalidationRectangle(
				invalidatedRectangle.toArray(),
				textMsg,
			);

			if (needsNewTiles && app.activeDocument.isModeActive(mode))
				app.map._docLayer._debug.addTileInvalidationMessage(textMsg);
		}
	}

	public resetPreFetching(resetBorder: boolean) {
		if (!this.checkDocLayer()) return;

		this.clearPreFetch();

		if (resetBorder) this._borders = undefined;

		var interval = 250;
		var idleTime = 750;
		this._preFetchPart = this._docLayer._selectedPart;
		this._preFetchMode = app.activeDocument.activeModes;
		this._preFetchIdle = setTimeout(
			window.L.bind(function () {
				this._tilesPreFetcher = setInterval(
					window.L.bind(this.preFetchTiles, this),
					interval,
				);
				this._preFetchIdle = undefined;
				this._cumTileCount = 0;
			}, this),
			idleTime,
		);
	}

	public clearPreFetch() {
		if (!this.checkDocLayer()) return;

		this.clearTilesPreFetcher();
		if (this._preFetchIdle !== undefined) {
			clearTimeout(this._preFetchIdle);
			this._preFetchIdle = undefined;
		}
	}

	public preFetchTiles(forceBorderCalc: boolean) {
		if (!this.checkDocLayer()) return;

		if (app.file.fileBasedView && this._docLayer) this.updateFileBasedView();

		if (
			!this._docLayer ||
			this.emptyTilesCount > 0 ||
			!this._docLayer._canonicalIdInitialized
		)
			return;

		const propertiesUpdated = this.updateProperties();
		const tileSize = this.tileSize;
		const maxTilesToFetch = this.getMaxTileCountToPrefetch(tileSize);
		const [viewTilesX, viewTilesY] = this.viewTileCounts(tileSize);
		// On the phone the border walk is bounded by the decoded-bitmap
		// budget instead of a flat 40/10 — see TilePerfBudget.ts for the
		// arithmetic. Desktop and tablet keep the upstream constants.
		const maxBorderWidth = VulcanTilePerf.prefetchBorderLimit(
			viewTilesX,
			viewTilesY,
			this._hasEditPerm,
			this.isVulcanPhoneChrome(),
			VulcanTilePerf.bitmapCapForPhysicalWidth(
				BitmapTileManager.physicalScreenWidth(),
			),
		);

		// FIXME: when we are actually editing we should pre-load much less until we stop
		/*		if (isActiveEditing()) {
			maxTilesToFetch = 5;
			maxBorderWidth = 2;
		} */

		if (
			propertiesUpdated ||
			forceBorderCalc ||
			!this._borders ||
			this._borders.length === 0
		)
			this.computeBorders();

		var finalQueue = [];
		const visitedTiles: any = {};

		var validTileRange = new cool.Bounds(
			new cool.Point(0, 0),
			new cool.Point(
				Math.floor((app.activeDocument.fileSize.x - 1) / app.tile.size.x),
				Math.floor((app.activeDocument.fileSize.y - 1) / app.tile.size.y),
			),
		);

		var tilesToFetch = maxTilesToFetch; // total tile limit per call of preFetchTiles()
		var doneAllPanes = true;

		for (let paneIdx = 0; paneIdx < this._borders.length; ++paneIdx) {
			const queue = [];
			const paneBorder = this._borders[paneIdx];
			const borderBounds = paneBorder.getBorderBounds();
			const paneXFixed = paneBorder.isXFixed();
			const paneYFixed = paneBorder.isYFixed();

			while (tilesToFetch > 0 && paneBorder.getBorderIndex() < maxBorderWidth) {
				const clampedBorder = validTileRange.clamp(borderBounds) as cool.Bounds;
				const fetchTopBorder =
					!paneYFixed && borderBounds.min.y === clampedBorder.min.y;
				const fetchBottomBorder =
					!paneYFixed && borderBounds.max.y === clampedBorder.max.y;
				const fetchLeftBorder =
					!paneXFixed && borderBounds.min.x === clampedBorder.min.x;
				const fetchRightBorder =
					!paneXFixed && borderBounds.max.x === clampedBorder.max.x;

				if (
					!fetchLeftBorder &&
					!fetchRightBorder &&
					!fetchTopBorder &&
					!fetchBottomBorder
				) {
					break;
				}

				if (fetchBottomBorder) {
					for (var i = clampedBorder.min.x; i <= clampedBorder.max.x; i++) {
						// tiles below the visible area
						for (let j = 0; j < this._preFetchMode.length; j++) {
							queue.push(
								new TileCoordData(
									i * tileSize,
									borderBounds.max.y * tileSize,
									this._zoom,
									this._preFetchPart,
									this._preFetchMode[j],
								),
							);
						}
					}
				}

				if (fetchTopBorder) {
					for (i = clampedBorder.min.x; i <= clampedBorder.max.x; i++) {
						// tiles above the visible area
						for (let j = 0; j < this._preFetchMode.length; j++) {
							queue.push(
								new TileCoordData(
									i * tileSize,
									borderBounds.min.y * tileSize,
									this._zoom,
									this._preFetchPart,
									this._preFetchMode[j],
								),
							);
						}
					}
				}

				if (fetchRightBorder) {
					for (i = clampedBorder.min.y; i <= clampedBorder.max.y; i++) {
						// tiles to the right of the visible area
						for (let j = 0; j < this._preFetchMode.length; j++) {
							queue.push(
								new TileCoordData(
									borderBounds.max.x * tileSize,
									i * tileSize,
									this._zoom,
									this._preFetchPart,
									this._preFetchMode[j],
								),
							);
						}
					}
				}

				if (fetchLeftBorder) {
					for (i = clampedBorder.min.y; i <= clampedBorder.max.y; i++) {
						// tiles to the left of the visible area
						for (let j = 0; j < this._preFetchMode.length; j++) {
							queue.push(
								new TileCoordData(
									borderBounds.min.x * tileSize,
									i * tileSize,
									this._zoom,
									this._preFetchPart,
									this._preFetchMode[j],
								),
							);
						}
					}
				}

				var tilesPending = false;
				for (i = 0; i < queue.length; i++) {
					const coords = queue[i];
					const key: string = coords.key();

					if (
						visitedTiles[key] ||
						!this.isValidTile(coords) ||
						!this.tileNeedsFetch(key)
					)
						continue;

					if (tilesToFetch > 0) {
						visitedTiles[key] = true;
						finalQueue.push(coords);
						tilesToFetch -= 1;
					} else {
						tilesPending = true;
					}
				}

				if (tilesPending) {
					// don't update the border as there are still
					// some tiles to be fetched
					continue;
				}

				if (!paneXFixed) {
					if (borderBounds.min.x > 0) {
						borderBounds.min.x -= 1;
					}
					if (borderBounds.max.x < validTileRange.max.x) {
						borderBounds.max.x += 1;
					}
				}

				if (!paneYFixed) {
					if (borderBounds.min.y > 0) {
						borderBounds.min.y -= 1;
					}

					if (borderBounds.max.y < validTileRange.max.y) {
						borderBounds.max.y += 1;
					}
				}

				paneBorder.incBorderIndex();
			} // border width loop end

			if (paneBorder.getBorderIndex() < maxBorderWidth) {
				doneAllPanes = false;
			}
		} // pane loop end

		window.app.console.assert(
			finalQueue.length <= maxTilesToFetch,
			'finalQueue length(' +
				finalQueue.length +
				') exceeded maxTilesToFetch(' +
				maxTilesToFetch +
				')',
		);

		var tilesRequested = false;

		if (finalQueue.length > 0) {
			this._cumTileCount += finalQueue.length;
			this.addTiles(finalQueue);
			tilesRequested = true;
		}

		if (!tilesRequested || doneAllPanes) {
			this.clearTilesPreFetcher();
			this._borders = undefined;
		}
	}

	public sendProcessedResponse() {
		var toSend = this.queuedProcessed;
		this.queuedProcessed = [];
		if (toSend.length > 0) {
			app.socket.sendMessage('tileprocessed wids=' + toSend.join(','));
			// Vulcan: decoded tiles now carry what the Calc echo was drawing.
			app.definitions?.vulcanCalcTextEcho?.onTilesProcessed?.();
		}
		if (this.fetchKeyframeQueue.length > 0) {
			window.app.console.warn('re-fetching prematurely GCd keyframes');
			this.sendTileCombineRequest(this.fetchKeyframeQueue);
			this.fetchKeyframeQueue = [];
		}
	}

	public onTileMsg(textMsg: string, img: any) {
		const tileMsgObj: any = app.socket.parseServerCmd(textMsg);
		this.checkTileMsgObject(tileMsgObj);

		if (app.map._debug.tileDataOn) {
			app.map._debug.tileDataAddMessage();
		}

		// a rather different code-path with a png; should have its own msg perhaps.
		if (tileMsgObj.id !== undefined) {
			app.map.fire('tilepreview', {
				tile: img,
				id: tileMsgObj.id,
				width: tileMsgObj.width,
				height: tileMsgObj.height,
				part: tileMsgObj.part,
				mode: tileMsgObj.mode !== undefined ? tileMsgObj.mode : 0,
				docType: app.map._docLayer._docType,
			});
			this.queueAcknowledgement(tileMsgObj);
			return;
		}

		const coords = this.tileMsgToCoords(tileMsgObj);
		let tile = this.get(coords);

		if (!tile) {
			tile = this.createTile(coords);
			this.updateTileDistance(tile, Math.round(app.map.getZoom()));
		}

		tile.viewId = tileMsgObj.nviewid;
		// update monotonic timestamp
		tile.wireId = +tileMsgObj.wireId;
		if (tile.invalidFrom == tile.wireId)
			window.app.console.debug('Nasty - updated wireId matches old one');

		var hasContent = img != null && img.rawData.length > 0;

		// obscure case: we could have garbage collected the
		// keyframe content in JS but coolwsd still thinks we have
		// it and now we just have a delta with nothing to apply
		// it to; if so, mark it bad to re-fetch.
		if (img && !img.isKeyframe && !tile.hasKeyframe()) {
			window.app.console.debug(
				'Unusual: Delta sent - but we have no keyframe for ' + coords.key(),
			);
			// force keyframe
			tile.forceKeyframe();
			tile.gcErrors++;

			// queue a later fetch of this and any other
			// rogue tiles in this state
			this.fetchKeyframeQueue.push(coords);

			hasContent = false;
		}

		// updates don't need more chattiness with a tileprocessed
		if (hasContent) {
			// Store the compressed tile data for later decompression and
			// display. This lets us store many more tiles than if we were
			// to only store the decompressed tile data.
			const rawDelta = new cool.RawDelta(
				img.rawData,
				++tile.deltaId,
				img.isKeyframe,
			);
			if (img.isKeyframe || tile.hasKeyframe()) {
				tile.rawDeltas.push(rawDelta);
			} else {
				window.app.console.warn(
					'Unusual: attempt to append a delta when we have no keyframe.',
				);
			}
		}

		// Only decompress deltas for tiles that are current. This stops
		// prefetching from blowing past GC limits.
		if (tile.distanceFromView === 0) this.rehydrateTile(tile, true);

		this.queueAcknowledgement(tileMsgObj);

		// This was the first tile, exec the queued tasks.
		this.receivedFirstTile = true;
		while (this.afterFirstTileTasks.length > 0) {
			const task = this.afterFirstTileTasks.shift();
			task();
		}
	}

	// Returns a guess of how many tiles are yet to arrive
	public predictTilesToSlurp() {
		if (!this.checkPointers()) return 0;

		var size = app.map.getSize();

		if (size.x === 0 || size.y === 0) return 0;

		var zoom = Math.round(app.map.getZoom());
		var pixelBounds = app.map.getPixelBoundsCore(app.map.getCenter(), zoom);

		var queue = this.getMissingTiles(pixelBounds, zoom);

		return queue.length;
	}

	public pruneTiles() {
		this.updateAllTileDistances();
		this.garbageCollect();
	}

	public reclaimGraphicsMemory() {
		for (const [key, tile] of this.tiles.entries()) {
			if (tile.distanceFromView === 0) this.dehydratedCurrentTiles.push(key);
			this.reclaimTileBitmapMemory(tile);
		}
		if (this.dehydratedCurrentTiles.length)
			app.sectionContainer.deferDrawing(this.rehydrateCurrentTiles.bind(this));
	}

	public discardAllCache() {
		this.updateAllTileDistances();
		this.garbageCollect(true);
		this.reclaimGraphicsMemory();
	}

	/*
	 * Twips one tile covers at rung `zoom` — byte-identical formula to
	 * CanvasTileLayer._restoreRoundedRungTwips, so a speculative request
	 * and the commit's own request produce the SAME tile desc (the wireId
	 * dedupe and the cache key both hang off it). (R6-7 lever L3)
	 */
	public tileTwipsAtZoom(zoom: number): number {
		const map: any = app.map;
		return Math.round(
			map._docLayer.options.tileWidthTwips *
				Math.pow(1.2, map.options.zoom - zoom),
		);
	}

	// True when the rig around us can answer tileTwipsAtZoom — the minimal
	// mocha layers carry no options/zoom and must keep the shipped paths.
	private canDeriveRungTwips(): boolean {
		const map: any = app.map;
		return !!(
			map &&
			typeof map.getZoom === 'function' &&
			map.options &&
			typeof map.options.zoom === 'number' &&
			map._docLayer &&
			map._docLayer.options &&
			typeof map._docLayer.options.tileWidthTwips === 'number'
		);
	}

	public isValidTile(coords: TileCoordData) {
		if (coords.x < 0 || coords.y < 0) {
			return false;
		}
		/*
		 * R6-7 (speculative settle prefetch): coords carry their OWN rung,
		 * and a speculative request's rung differs from the map's while
		 * the gesture is still live. Convert with the coords' rung twips —
		 * the only frame those core pixels are meaningful in. Same-rung
		 * coords fall through to the shipped checks below (the R6-4
		 * zoom-anim window branch included), byte-for-byte.
		 */
		if (
			this.canDeriveRungTwips() &&
			coords.z !== Math.round(app.map.getZoom())
		) {
			const twipsPerPx = this.tileTwipsAtZoom(coords.z) / this.tileSize;
			return (
				coords.x * twipsPerPx < app.activeDocument.fileSize.x &&
				coords.y * twipsPerPx < app.activeDocument.fileSize.y
			);
		}
		/*
		 * VULCAN (R6-4 zoom-out snap): coords are core pixels in a tile
		 * rung's frame, but during a zoom animation TilesSection.
		 * drawZoomFrame drives app.pixelsToTwips by the live pinch scale
		 * every frame. Rest coords x live scale inflates the tile's twip
		 * position by 1/scale, so the document's right/bottom EDGE tiles
		 * cross fileSize and read invalid the moment the frame shrinks
		 * past tileX / docWidthPx — on the fit-width phone deck (714 px
		 * slide, third tile column at x=512) that is scale 0.717, the
		 * founder's "~70%": the zoom-frame draw walk skips the column and
		 * the right letterbox snaps over the slide, and the coord-list
		 * build drops it from the fetch set. MEASURED on build #8
		 * (s1-zoomout-snap, Dinosaurs dpr3): right content edge 669 -> 525
		 * core px in one frame at frameScale 0.700 with zero layout
		 * writes; un-snap on the release settle one frame after
		 * re-crossing 0.717.
		 *
		 * The painter parks the rest scale for exactly this window
		 * (preZoomAnimation -> _zoomBaseTwipsToPixels, alive while
		 * _inZoomAnim); judge validity there, in the frame the coords are
		 * actually in. At rest — and for layers without a painter, the
		 * mocha mirror rigs included — base is unset and this is
		 * byte-for-byte the shipped check.
		 */
		const painter: any = app.map?._docLayer?._painter;
		const baseTwipsToPixels =
			painter &&
			painter._inZoomAnim &&
			typeof painter._zoomBaseTwipsToPixels === 'number' &&
			painter._zoomBaseTwipsToPixels > 0
				? painter._zoomBaseTwipsToPixels
				: null;
		const pixelsToTwips =
			baseTwipsToPixels !== null ? 1 / baseTwipsToPixels : app.pixelsToTwips;
		if (
			coords.x * pixelsToTwips >= app.activeDocument.fileSize.x ||
			coords.y * pixelsToTwips >= app.activeDocument.fileSize.y
		) {
			return false;
		} else return true;
	}

	public redraw() {
		if (app.map) {
			this.removeAllTiles();
			this.update();
		}
		return this;
	}

	public update(center: any = null, zoom: number = null) {
		// Any real view update ends the speculation window: after the zoom
		// commit the predicted rung IS the current rung (its tiles rank by
		// the normal rules), and a pan/abort should not keep stale
		// cross-rung tiles pinned near. (R6-7 lever L3)
		this._vulcanSpeculativeRung = -1;

		const map: any = app.map;

		if (
			!map ||
			app.map._docLayer._documentInfo === '' ||
			!app.map._docLayer._canonicalIdInitialized
		) {
			return;
		}

		// Calc: do not set view area too early after load and before we get the cursor position.
		if (app.map._docLayer.isCalc() && !app.map._docLayer._gotFirstCellCursor)
			return;

		// be sure canvas is initialized already and has the correct size.
		const size: any = map.getSize();
		if (size.x === 0 || size.y === 0) {
			setTimeout(
				function () {
					this.update();
				}.bind(this),
				1,
			);
			return;
		}

		// If an update occurs while we're paused for visible tiles, we haven't been able to
		// keep up with scrolling. In this case, we should stop expanding the current area
		// so that it takes less time to dehydrate it.
		if (this.pausedForCoherency) {
			if (this.shrinkCurrentId) clearTimeout(this.shrinkCurrentId);
			this.shrinkCurrentId = setTimeout(() => {
				this.shrinkCurrentId = null;
			}, 100);
		}

		if (app.file.fileBasedView) {
			this.updateFileBasedView();
			return;
		} else if (app.activeDocument.activeLayout.type === 'ViewLayoutMultiPage')
			return;

		if (!center) {
			center = map.getCenter();
		}
		if (!zoom) {
			zoom = Math.round(map.getZoom());
		}

		var pixelBounds = map.getPixelBoundsCore(center, zoom);
		var queue = this.getMissingTiles(pixelBounds, zoom, true);

		app.map._docLayer._sendClientZoom();
		app.activeDocument.activeLayout.sendClientVisibleArea();

		if (queue.length !== 0) this.addTiles(queue, true);

		if (app.map._docLayer.isCalc() || app.map._docLayer.isWriter())
			this.initPreFetchAdjacentTiles();
	}

	public onWorkerEndTransaction(e: any) {
		const bitmaps: ImageBitmap[] = [];
		const bitmapPromises: Promise<ImageBitmap>[] = [];
		const pendingDeltas: any[] = [];

		if (this.nPendingWorkerTasks) --this.nPendingWorkerTasks;
		else window.app.console.warn('Unexpected worker message');

		for (const x of e.data.deltas) {
			const tile = this.tiles.get(x.key);

			if (!tile) {
				if (this.debugDeltas)
					window.app.console.warn(
						'Tile deleted during rawDelta decompression.',
					);
				continue;
			}

			let rawDeltas: any[] = [];
			const firstDelta = tile.rawDeltas.findIndex((d) => d.id === x.ids[0]);
			const lastDelta = tile.rawDeltas.findIndex((d) => d.id === x.ids[1]);
			if (firstDelta !== -1 && lastDelta !== -1)
				rawDeltas = tile.rawDeltas.slice(firstDelta, lastDelta + 1);
			else
				window.app.console.warn(
					'Unusual: Received unknown decompressed keyframe delta(s)',
				);

			const lastDecompressedId = tile.decompressedId;
			tile.decompressedId = x.ids[1];

			// if rehydrating from rawDeltas, don't update counts
			if (x.wireMessage) {
				if (x.isKeyframe) {
					tile.loadCount++;
					tile.deltaCount = 0;
					tile.updateCount = 0;
					if (app.map._debug.tileDataOn) {
						app.map._debug.tileDataAddLoad();
					}
				} else if (rawDeltas.length === 0) {
					tile.updateCount++;
					this.nullDeltaUpdate++;
					if (app.map._docLayer._emptyDeltaDiv) {
						app.map._docLayer._emptyDeltaDiv.innerText =
							this.nullDeltaUpdate.toString();
					}
					if (app.map._debug.tileDataOn) {
						app.map._debug.tileDataAddUpdate();
					}
					continue; // that was easy
				} else {
					tile.deltaCount++;
					if (app.map._debug.tileDataOn) {
						app.map._debug.tileDataAddDelta();
					}
				}
			}

			if (!x.isKeyframe) {
				if (lastDecompressedId !== 0) {
					if (x.ids[0] !== lastDecompressedId + 1) {
						window.app.console.warn(
							'Unusual: Received discontiguous decompressed delta',
						);
					}
				} else {
					if (this.debugDeltas)
						window.app.console.warn("Decompressed delta received on GC'd tile");
					continue;
				}
			}

			if (!x.bitmap) {
				// This path is taken when this is called on the DOM thread (i.e. the worker
				// hasn't decompressed the raw delta)
				x.deltas = (window as any).fzstd.decompress(x.rawDelta);
				if (x.isKeyframe) {
					x.keyframeBuffer = new Uint8Array(
						e.data.tileSize * e.data.tileSize * 4,
					);
					x.keyframeDeltaSize = cool.CanvasTileUtils.unrle(
						x.deltas,
						e.data.tileSize,
						e.data.tileSize,
						x.keyframeBuffer,
					);
				} else x.keyframeDeltaSize = 0;

				this.applyDelta(
					tile,
					rawDeltas,
					x.deltas,
					x.keyframeDeltaSize,
					x.keyframeBuffer,
				);

				this.createTileBitmap(tile, x, pendingDeltas, bitmapPromises);
			} else {
				this.tileImageCache.set(x.key, null);
				bitmaps.push(x.bitmap);
				pendingDeltas.push(x);
			}
		}

		if (bitmapPromises.length && bitmaps.length)
			window.app.console.warn(
				'Unusual: Sync and async tile decompression happening simultaneously',
			);
		if (bitmaps.length)
			this.endTransactionHandleBitmaps(pendingDeltas, bitmaps);
		else if (!bitmapPromises.length)
			// No-bitmap transaction (null/empty delta readies a tile without
			// producing a bitmap): still run the resume/callback/GC path so
			// coherency-paused drawing resumes.
			this.endTransactionHandleBitmaps([], []);
		if (bitmapPromises.length)
			Promise.all(bitmapPromises).then((bitmaps) => {
				this.endTransactionHandleBitmaps(pendingDeltas, bitmaps);
			});
	}

	public onWorkerError(e: any) {
		this.pendingDeltas.length = 0;
		this.nPendingWorkerTasks = 0;
		while (this.transactionCallbacks.length) this.transactionCallbacks.pop()();
		this.redraw();
	}

	public updateOnChangePart() {
		if (!this.checkPointers() || app.map._docLayer._documentInfo === '') {
			return;
		}
		var center = app.map.getCenter();
		var zoom = Math.round(app.map.getZoom());

		var pixelBounds = app.map.getPixelBoundsCore(center, zoom);

		// create a queue of coordinates to load tiles from
		const queue = this.getMissingTiles(pixelBounds, zoom, true);

		if (queue.length !== 0) {
			for (let i = 0; i < queue.length; i++) {
				const coords = queue[i];
				const key = coords.key();
				if (!this.tiles.has(key)) this.createTile(coords);
			}

			this.sendTileCombineRequest(queue);
		}
		if (
			app.map._docLayer._docType === 'presentation' ||
			app.map._docLayer._docType === 'drawing'
		)
			this.initPreFetchPartTiles();
	}

	// How far ahead of the viewport to prefetch, in tiles, at most. 8 tiles is
	// 2048 core px, which at dpr 3 is 683 CSS px -- about four fifths of an
	// 844px phone viewport, against the 256 CSS px the fixed margin gives.
	// Capped rather than unbounded because the ceiling is paid in tile
	// requests and decoded bitmaps: setBitmapOnTile allows 250 live bitmaps on
	// a sub-1280px physical screen, and a 6-column phone viewport spends 6 per
	// row of runway.
	private static readonly vulcanMaxLeadTiles: number = 8;

	// How much travel the runway should cover, in milliseconds. It has to
	// absorb the gap between two tile passes plus the round trip of the
	// requests made in one: the leaflet 'move' event that drives update() is
	// throttled to options.updateInterval = 200ms
	// (CanvasTileLayer.js:375,4220), so at 450ms the margin still reaches
	// beyond where the view will be when the NEXT pass runs.
	private static readonly vulcanLeadMs: number = 450;

	// True only inside the Vulcan phone chrome on a Calc sheet: a small-screen
	// device AND the pre-paint html.vulcan-mobile-chrome marker (js/global.js
	// adds it iff !desktopChrome && mode.isSmallScreenDevice()). Desktop and
	// tablet fail BOTH halves -- isTablet() is *defined* as
	// !isSmallScreenDevice() -- and Writer/Impress are excluded by the doctype.
	private isVulcanPhoneChrome(): boolean {
		return VulcanTilePerf.isVulcanPhoneChrome();
	}

	private isVulcanPhoneCalc(): boolean {
		if (!this.isVulcanPhoneChrome()) return false;
		return !!app.map._docLayer && app.map._docLayer.isCalc();
	}

	// Leading-edge expansion, in units of `grow`, for one axis.
	//
	// Upstream this is the constant `directionalTileExpansion`, so the range
	// always reaches `grow * (1 + directionalTileExpansion)` = 3 tiles ahead
	// however fast the view is moving -- expandTileRange consults
	// getLastPanDirection, which is Math.sign of the pan delta and carries no
	// magnitude at all. 3 tiles is 768 core px, i.e. 256 CSS px at dpr 3, under
	// a third of a phone viewport, and a properly projected fling outruns it
	// immediately.
	//
	// On the phone the runway instead covers the distance the view will
	// actually cross in vulcanLeadMs, so a slow pan keeps paying upstream's
	// small margin and only a fast one pays for a long one. Returns the
	// upstream constant whenever the gate is false or no speed is on record,
	// which restores the original expression exactly.
	private leadingTileExpansion(speed: number, grow: number): number {
		const base = this.directionalTileExpansion;
		if (!this.isVulcanPhoneCalc()) return base;
		if (!(speed > 0) || grow <= 0 || this.tileSize <= 0) return base;

		// Tiles the view crosses during one lead window. speed is core px/ms
		// (ViewLayoutBase.getPanSpeed) and tileSize is core px, so this is a
		// pure tile count.
		const leadTiles = Math.min(
			BitmapTileManager.vulcanMaxLeadTiles,
			Math.ceil((speed * BitmapTileManager.vulcanLeadMs) / this.tileSize),
		);

		// The range reaches grow * (1 + expansion) tiles ahead, so invert that
		// for the expansion which buys `leadTiles`, and never go below
		// upstream's margin.
		return Math.max(base, Math.ceil(leadTiles / grow - 1));
	}

	public expandTileRange(range: cool.Bounds): cool.Bounds {
		const grow = this.visibleTileExpansion;
		const direction = app.activeDocument.activeLayout.getLastPanDirection();
		const speed = app.activeDocument.activeLayout.getPanSpeed();
		const lead = [
			this.leadingTileExpansion(speed[0], grow),
			this.leadingTileExpansion(speed[1], grow),
		];
		const minOffset = new cool.Point(
			grow - grow * lead[0] * Math.min(0, direction[0]),
			grow - grow * lead[1] * Math.min(0, direction[1]),
		);
		const maxOffset = new cool.Point(
			grow + grow * lead[0] * Math.max(0, direction[0]),
			grow + grow * lead[1] * Math.max(0, direction[1]),
		);
		return new cool.Bounds(
			range.min.subtract(minOffset),
			range.max.add(maxOffset),
		);
	}

	public pxBoundsToTileRange(bounds: any) {
		return new cool.Bounds(
			bounds.min.divideBy(this.tileSize)._floor(),
			bounds.max.divideBy(this.tileSize)._floor(),
		);
	}

	// The "currentCoordList" is the currently visible coordinates list.
	public checkRequestTiles(
		currentCoordList: TileCoordData[],
		sendTileCombine = true,
	): TileCoordData[] {
		const tileCombineQueue = [];
		for (var i = 0; i < currentCoordList.length; i++) {
			let tile = this.get(currentCoordList[i]);

			if (!tile) tile = this.createTile(currentCoordList[i]);

			if (tile.needsFetch()) tileCombineQueue.push(currentCoordList[i]);
			else this.makeTileCurrent(tile);
		}

		// Prefetching algorithm etc doesn't need this function to send tile combine request.
		if (sendTileCombine) this.sendTileCombineRequest(tileCombineQueue);

		return tileCombineQueue;
	}

	public updateFileBasedView(
		checkOnly: boolean = false,
		zoomFrameBounds: any = null,
		forZoom: any = null,
	): TileCoordData[] {
		if (app.map._docLayer._partHeightTwips === 0)
			// This is true before status message is handled.
			return [];
		if (app.map._docLayer._isZooming) return [];

		if (!checkOnly) {
			// zoomFrameBounds and forZoom params were introduced to work only in checkOnly mode.
			window.app.console.assert(
				zoomFrameBounds === null,
				'zoomFrameBounds must only be supplied when checkOnly is true',
			);
			window.app.console.assert(
				forZoom === null,
				'forZoom must only be supplied when checkOnly is true',
			);
		}

		if (forZoom !== null) {
			window.app.console.assert(
				zoomFrameBounds,
				'zoomFrameBounds must be valid when forZoom is specified',
			);
		}

		var zoom = forZoom || Math.round(app.map.getZoom());
		var currZoom = Math.round(app.map.getZoom());
		var relScale = currZoom == zoom ? 1 : app.map.getZoomScale(zoom, currZoom);

		var ratio = (this.tileSize * relScale) / app.tile.size.y;
		var mode = 0; // mode is different only in Impress MasterPage mode so far

		const layout = app.activeDocument.activeLayout;
		if (!(layout && layout.type === 'ViewLayoutFileBased')) return [];
		const fbLayout = layout as ViewLayoutFileBased;
		const partCount = app.map._docLayer._parts;

		// Read per-part rectangles from the layout (X=0 baseline, cumulative Y)
		// at the queried zoom's pixel ratio.
		const rects: { x: number; y: number; w: number; h: number }[] = [];
		for (let p = 0; p < partCount; p++) {
			const r = fbLayout.getDocumentPartRectAtRatio(p, ratio);
			if (!r) return [];
			rects.push(r);
		}

		// Stacked extent is maintained in twips on app.activeDocument.fileSize
		// (refreshed on status / part-dimension changes); scale by ratio rather
		// than recomputing across rects every call.
		const fileSize = app.activeDocument.fileSize;
		const maxWidthPx = Math.round(fileSize.x * ratio);
		const totalHeightPx = Math.round(fileSize.y * ratio);

		// Every operand of this intersection must be in the queried zoom's
		// rung-px frame. zoomFrameBounds already is (drawZoomFrame's
		// docRangeScaled); the null case converts viewedRectangle's twips with
		// `ratio`, never through app.twipsToPixels -- drawZoomFrame mutates
		// that global by the live pinch scale, which mismatched the part rects
		// above and selected a wrong/empty part set (blank pinch frames). At
		// rest the global equals `ratio`, so the null case is a no-op.
		let visibleAreaRectangle: number[];
		if (zoomFrameBounds) {
			visibleAreaRectangle = [
				zoomFrameBounds.min.x,
				zoomFrameBounds.min.y,
				zoomFrameBounds.max.x - zoomFrameBounds.min.x,
				zoomFrameBounds.max.y - zoomFrameBounds.min.y,
			];
		} else {
			const viewedRectangle = fbLayout.viewedRectangle;
			visibleAreaRectangle = [
				Math.round(viewedRectangle.x1 * ratio),
				Math.round(viewedRectangle.y1 * ratio),
				Math.round(viewedRectangle.width * ratio),
				Math.round(viewedRectangle.height * ratio),
			];
		}

		var intersectionAreaRectangle = app.LOUtil._getIntersectionRectangle(
			visibleAreaRectangle,
			[0, 0, maxWidthPx, totalHeightPx],
		);

		var queue = [];

		if (intersectionAreaRectangle) {
			const viewX1 = intersectionAreaRectangle[0];
			const viewY1 = intersectionAreaRectangle[1];
			const viewX2 = viewX1 + intersectionAreaRectangle[2];
			const viewY2 = viewY1 + intersectionAreaRectangle[3];

			for (let i = 0; i < partCount; i++) {
				const partX1 = rects[i].x;
				const partY1 = rects[i].y;
				const partX2 = partX1 + rects[i].w;
				const partY2 = partY1 + rects[i].h;

				if (partY2 <= viewY1 || partY1 >= viewY2) continue;
				if (partX2 <= viewX1 || partX1 >= viewX2) continue;

				// Visible region of this part in stacked-view core pixels.
				const visX1 = Math.max(viewX1, partX1);
				const visY1 = Math.max(viewY1, partY1);
				const visX2 = Math.min(viewX2, partX2);
				const visY2 = Math.min(viewY2, partY2);

				// Convert to per-part local coords (tile.x/y are page-local for
				// fileBasedView). The tile grid is this.tileSize px in every
				// rung's frame; app.tile.size.pX rides the mutated global
				// mid-pinch and would step off-grid, onto keys no tile has.
				const tileSizePx = this.tileSize;
				const localX1 = visX1 - partX1;
				const localY1 = visY1 - partY1;
				const localX2 = visX2 - partX1;
				const localY2 = visY2 - partY1;

				const startX = Math.floor(localX1 / tileSizePx) * tileSizePx;
				const endX = Math.floor((localX2 - 1) / tileSizePx) * tileSizePx;
				const startY = Math.floor(localY1 / tileSizePx) * tileSizePx;
				const endY = Math.floor((localY2 - 1) / tileSizePx) * tileSizePx;

				for (let j = startX; j <= endX; j += tileSizePx) {
					for (let k = startY; k <= endY; k += tileSizePx) {
						queue.push(new TileCoordData(j, k, zoom, i, mode));
					}
				}
			}

			this.sortFileBasedQueue(queue);

			for (const tile of this.tiles.values()) {
				// Visible tiles' distance property will be set zero below by makeTileCurrent.
				tile.distanceFromView = Number.MAX_SAFE_INTEGER;
			}

			this.beginTransaction();
			for (i = 0; i < queue.length; i++) {
				const tempTile = this.tiles.get(queue[i].key());

				if (tempTile) this.makeTileCurrent(tempTile);
			}
			this.endTransaction(null);
			this.sortTileBitmapList();
		}

		if (checkOnly) {
			return queue;
		} else {
			app.activeDocument.activeLayout.sendClientVisibleArea();
			app.map._docLayer._sendClientZoom();

			var tileCombineQueue = [];
			for (var i = 0; i < queue.length; i++) {
				let tile = this.get(queue[i]);
				if (!tile) tile = this.createTile(queue[i]);
				if (tile.needsFetch()) tileCombineQueue.push(queue[i]);
			}
			this.sendTileCombineRequest(tileCombineQueue);
		}
	}

	// We keep tile content around, but it will need
	// refreshing if we show it again - and we need to
	// know what monotonic time the invalidate came from
	// so we match this to a new incoming tile to unset
	// the invalid state later.
	public invalidateTile(key: string, wireId: number) {
		const tile: Tile = this.tiles.get(key);
		if (!tile) {
			window.app.console.warn('invalidateTile called with invalid key', key);
			return;
		}

		tile.invalidateCount++;

		if (app.map._debug.tileDataOn) {
			app.map._debug.tileDataAddInvalidate();
		}

		if (!tile.hasContent()) this.removeTile(key);
		else {
			if (this.debugDeltas)
				window.app.console.debug(
					'invalidate tile ' + key + ' with wireId ' + wireId,
				);
			tile.forceKeyframe(wireId ? wireId : tile.wireId);
		}
	}

	// Indicate that we're about to render this image.
	public touchImage(tile: Tile) {
		if (!tile) return;
		tile.lastRendered = performance.now();
		if (!tile.image) tile.missingContent++;
	}

	// flip to true for extra bitmap list consistency checks
	private extraDebugChecks(): boolean {
		return false;
	}
}
