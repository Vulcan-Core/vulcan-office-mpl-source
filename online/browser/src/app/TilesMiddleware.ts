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

/// Static facade exposing the RenderManager API as static methods.
class RenderManager {
	private static _instance: RenderManagerBase;

	/// True when the document renders from vector primitives: an Impress or
	/// Draw document with the vector rendering option enabled.
	private static wantsVector(docType?: string): boolean {
		return (
			(docType === 'presentation' || docType === 'drawing') &&
			cool.VectorRenderingConfig.isEnabled()
		);
	}

	/// Callbacks registered through the facade. Kept here — not only on
	/// the instance — because makeInstance can REPLACE the instance (the
	/// provisional BitmapTileManager gives way to a VectorManager once
	/// the document type is known), and listeners registered on the old
	/// instance would silently die with it.
	private static _vectorChangeListeners: ((
		update?: VectorPartUpdate,
	) => void)[] = [];

	/// Pick the manager for the document type, replacing the instance when
	/// an earlier one is of the wrong kind.
	private static makeInstance(docType?: string): RenderManagerBase {
		const wantVector = RenderManager.wantsVector(docType);
		const haveVector = RenderManager._instance instanceof VectorManager;
		if (!RenderManager._instance || wantVector !== haveVector) {
			RenderManager._instance = wantVector
				? new VectorManager()
				: new BitmapTileManager();
			for (const listener of RenderManager._vectorChangeListeners)
				RenderManager._instance.onVectorChanged(listener);
		}
		return RenderManager._instance;
	}

	private static ensureInstance(): RenderManagerBase {
		// Provisional default before the document type is known.
		if (!RenderManager._instance)
			RenderManager._instance = new BitmapTileManager();
		return RenderManager._instance;
	}

	static get tileSize(): number {
		return window.tileSize;
	}

	static initialize(docType?: string): void {
		RenderManager.makeInstance(docType).initialize();
	}

	static appendAfterFirstTileTask(task: AfterFirstTileTask): void {
		RenderManager.ensureInstance().appendAfterFirstTileTask(task);
	}

	static updateOverlayMessages(): void {
		RenderManager.ensureInstance().updateOverlayMessages();
	}

	static getExpiryFactor(tile: Tile): number {
		return RenderManager.ensureInstance().getExpiryFactor(tile);
	}

	static beginTransaction(): void {
		RenderManager.ensureInstance().beginTransaction();
	}

	static endTransaction(callback: any = null): void {
		RenderManager.ensureInstance().endTransaction(callback);
	}

	static refreshTilesInBackground(): void {
		RenderManager.ensureInstance().refreshTilesInBackground();
	}

	static setDebugDeltas(state: boolean): void {
		RenderManager.ensureInstance().setDebugDeltas(state);
	}

	static get(coords: TileCoordData): Tile {
		return RenderManager.ensureInstance().get(coords);
	}

	static getTiles(): Map<string, Tile> {
		return RenderManager.ensureInstance().getTiles();
	}

	static overlapInvalidatedRectangleWithView(
		part: number,
		mode: number,
		wireId: number,
		invalidatedRectangle: cool.SimpleRectangle,
		textMsg: string,
	): void {
		RenderManager.ensureInstance().overlapInvalidatedRectangleWithView(
			part,
			mode,
			wireId,
			invalidatedRectangle,
			textMsg,
		);
	}

	static resetPreFetching(resetBorder: boolean): void {
		RenderManager.ensureInstance().resetPreFetching(resetBorder);
	}

	static clearPreFetch(): void {
		RenderManager.ensureInstance().clearPreFetch();
	}

	static sendProcessedResponse(): void {
		RenderManager.ensureInstance().sendProcessedResponse();
	}

	static onTileMsg(textMsg: string, img: any): void {
		RenderManager.ensureInstance().onTileMsg(textMsg, img);
	}

	static predictTilesToSlurp(): number {
		return RenderManager.ensureInstance().predictTilesToSlurp();
	}

	static pruneTiles(): void {
		RenderManager.ensureInstance().pruneTiles();
	}

	static reclaimGraphicsMemory(): void {
		RenderManager.ensureInstance().reclaimGraphicsMemory();
	}

	static discardAllCache(): void {
		RenderManager.ensureInstance().discardAllCache();
	}

	static isValidTile(coords: TileCoordData): boolean {
		return RenderManager.ensureInstance().isValidTile(coords);
	}

	static redraw(): RenderManagerBase {
		return RenderManager.ensureInstance().redraw();
	}

	static update(center: any = null, zoom: number = null): void {
		RenderManager.ensureInstance().update(center, zoom);
	}

	// R6-7 lever L3: speculative settle prefetch — see BitmapTileManager.
	static prefetchZoomStop(targetZoom: number, centerCorePx: any): void {
		RenderManager.ensureInstance().prefetchZoomStop(targetZoom, centerCorePx);
	}

	static onWorkerEndTransaction(e: any): void {
		RenderManager.ensureInstance().onWorkerEndTransaction(e);
	}

	static onWorkerError(e: any): void {
		RenderManager.ensureInstance().onWorkerError(e);
	}

	static updateOnChangePart(): void {
		RenderManager.ensureInstance().updateOnChangePart();
	}

	static expandTileRange(range: cool.Bounds): cool.Bounds {
		return RenderManager.ensureInstance().expandTileRange(range);
	}

	static pxBoundsToTileRange(bounds: any): cool.Bounds {
		return RenderManager.ensureInstance().pxBoundsToTileRange(bounds);
	}

	static checkRequestTiles(
		currentCoordList: TileCoordData[],
		sendTileCombine: boolean = true,
	): TileCoordData[] {
		return RenderManager.ensureInstance().checkRequestTiles(
			currentCoordList,
			sendTileCombine,
		);
	}

	static updateFileBasedView(
		checkOnly: boolean = false,
		zoomFrameBounds: any = null,
		forZoom: any = null,
	): TileCoordData[] {
		return RenderManager.ensureInstance().updateFileBasedView(
			checkOnly,
			zoomFrameBounds,
			forZoom,
		);
	}

	static invalidateTile(key: string, wireId: number): void {
		RenderManager.ensureInstance().invalidateTile(key, wireId);
	}

	static touchImage(tile: Tile): void {
		RenderManager.ensureInstance().touchImage(tile);
	}

	// vector rendering specific

	static isVectorRendering(): boolean {
		return RenderManager.ensureInstance().isVectorRendering();
	}

	static requestThumbnail(
		id: cool.PreviewId,
		part: number,
		maxWidth: number,
		maxHeight: number,
	): void {
		RenderManager.ensureInstance().requestThumbnail(
			id,
			part,
			maxWidth,
			maxHeight,
		);
	}

	static requestPart(part: number): cool.VectorPrimitivesData | undefined {
		return RenderManager.ensureInstance().requestPart(part);
	}

	/// The most recent tree for a part, cached or last seen — never cold
	/// between a mutating input and the engine's answer (see
	/// VectorManager.peekPart). For readers at a gesture's release.
	static peekPart(part: number): cool.VectorPrimitivesData | undefined {
		return RenderManager.ensureInstance().peekPart(part);
	}

	static hitTestPoint(
		part: number,
		xTwips: number,
		yTwips: number,
		toleranceTwips: number,
	): { ordNum: number; bounds: number[]; isGroup: boolean } | null {
		return RenderManager.ensureInstance().hitTestPoint(
			part,
			xTwips,
			yTwips,
			toleranceTwips,
		);
	}

	static hitTestChildren(
		part: number,
		groupOrdNum: number,
		xTwips: number,
		yTwips: number,
		toleranceTwips: number,
	): { ordNum: number; bounds: number[]; isGroup: boolean } | null {
		return RenderManager.ensureInstance().hitTestChildren(
			part,
			groupOrdNum,
			xTwips,
			yTwips,
			toleranceTwips,
		);
	}

	static isTextBearing(
		part: number,
		ordNum: number,
		childOrdNum?: number,
	): boolean {
		return RenderManager.ensureInstance().isTextBearing(
			part,
			ordNum,
			childOrdNum,
		);
	}

	static isEmptyPlaceholder(
		part: number,
		ordNum: number,
		childOrdNum?: number,
	): boolean {
		return RenderManager.ensureInstance().isEmptyPlaceholder(
			part,
			ordNum,
			childOrdNum,
		);
	}

	static isMoveProtected(part: number, ordNum: number): boolean {
		return RenderManager.ensureInstance().isMoveProtected(part, ordNum);
	}

	static hitTestInk(
		part: number,
		ordNum: number,
		xTwips: number,
		yTwips: number,
		toleranceTwips: number,
		childOrdNum?: number,
	): boolean {
		return RenderManager.ensureInstance().hitTestInk(
			part,
			ordNum,
			xTwips,
			yTwips,
			toleranceTwips,
			childOrdNum,
		);
	}

	static hitTestRect(
		part: number,
		xTwips: number,
		yTwips: number,
		widthTwips: number,
		heightTwips: number,
	): { ordNum: number; bounds: number[] }[] {
		return RenderManager.ensureInstance().hitTestRect(
			part,
			xTwips,
			yTwips,
			widthTwips,
			heightTwips,
		);
	}

	static hitTestPointFast(
		part: number,
		xTwips: number,
		yTwips: number,
		toleranceTwips: number,
	): { ordNum: number; bounds: number[] } | null {
		return RenderManager.ensureInstance().hitTestPointFast(
			part,
			xTwips,
			yTwips,
			toleranceTwips,
		);
	}

	static findTopLevelObject(
		part: number,
		ordNum: number,
	): cool.SlideObject | null {
		return RenderManager.ensureInstance().findTopLevelObject(part, ordNum);
	}

	static classifySelection(
		part: number,
		rect: number[],
		selectionOrdNum: number | null,
	): { kind: 'top' } | { kind: 'child'; groupOrdNum: number } | null {
		return RenderManager.ensureInstance().classifySelection(
			part,
			rect,
			selectionOrdNum,
		);
	}

	/// Before each editor frame; liveZoom while the zoom animates. A no-op
	/// on the bitmap path.
	static beginEditorFrame(liveZoom: boolean): void {
		RenderManager.ensureInstance().beginEditorFrame(liveZoom);
	}

	static renderInto(
		context: CanvasRenderingContext2D,
		data: cool.VectorPrimitivesData,
		override?: cool.VectorRenderOverride,
		editView?: boolean,
	): void {
		RenderManager.ensureInstance().renderInto(
			context,
			data,
			override,
			editView,
		);
	}

	static onVectorChanged(callback: (update?: VectorPartUpdate) => void): void {
		RenderManager._vectorChangeListeners.push(callback);
		RenderManager.ensureInstance().onVectorChanged(callback);
	}

	/// Count a mutating input message at send time (textinput /
	/// removetextcontext / key). A no-op on the bitmap path.
	static noteMutatingInputSent(): void {
		RenderManager.ensureInstance().noteMutatingInputSent();
	}

	static noteWebFontsChanged(): void {
		RenderManager.ensureInstance().noteWebFontsChanged();
	}

	static getLastInputSeq(): number {
		return RenderManager.ensureInstance().getLastInputSeq();
	}

	/// Ask for a minimum interval between primitives fetches per part.
	/// Owner-keyed: the text echo and the nudge echo each hold their own
	/// window (the effective interval is the max of the active ones), so
	/// one controller tearing down cannot zero the window out from under
	/// the other mid-burst. A no-op on the bitmap path.
	static requestFetchCoalesce(owner: string, ms: number): void {
		RenderManager.ensureInstance().requestFetchCoalesce(owner, ms);
	}

	/// Drop one owner's coalescing window (see requestFetchCoalesce).
	static releaseFetchCoalesce(owner: string): void {
		RenderManager.ensureInstance().releaseFetchCoalesce(owner);
	}

	static handleVectorPrimitivesResponse(
		values: cool.VectorPrimitivesResponse,
	): void {
		RenderManager.ensureInstance().handleVectorPrimitivesResponse(values);
	}

	static handleVectorRenderingGraphicsResponse(
		values: cool.VectorRenderingGraphicsResponse,
	): void {
		RenderManager.ensureInstance().handleVectorRenderingGraphicsResponse(
			values,
		);
	}

	static clearCachedPart(part: number): void {
		RenderManager.ensureInstance().clearCachedPart(part);
	}

	static clearAllParts(): void {
		RenderManager.ensureInstance().clearAllParts();
	}

	static noteHistoryCommandSent(): void {
		RenderManager.ensureInstance().noteHistoryCommandSent();
	}
}

(window as any).RenderManager = RenderManager;
