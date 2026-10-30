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

/*
 * VectorManager - Renders the document content with vector primitives.
 *
 * It owns the per-part vector data, the bitmap cache and the primitive
 * renderer. It exposes thumbnail rendering (requestThumbnail) and per-part
 * access with change notification (requestPart, renderInto, onVectorChanged)
 * over one shared cache, so each part is fetched and decoded only once. The
 * bitmap-grid behaviour stays as the no-ops inherited from RenderManagerBase:
 * a vector-rendered document has no bitmap tile grid.
 */

/// Passed to onVectorChanged listeners when the change is a primitives
/// response for one part. `tag` is the mutating-input sequence recorded when
/// the answered request was sent: the response reflects at least every input
/// counted up to it (single ordered socket + KitQueue's same-session
/// barrier), which is what lets speculative overlays retire safely.
interface VectorPartUpdate {
	part: number;
	tag: number;
}

class VectorManager extends RenderManagerBase {
	/// A filmstrip invalidation asks for every slide's thumbnail at once;
	/// bound the concurrent fetches like Parts._processPreviewQueue does for
	/// the bitmap path, so they cannot starve the document's own traffic.
	private static readonly THUMBNAIL_MAX_IN_FLIGHT = 3;

	/// A lost response would otherwise leave its part in flight forever,
	/// blocking re-fetches and thumbnail pumping.
	private static readonly IN_FLIGHT_WATCHDOG_MS = 2000;

	/// The editor's views: composites persist across frames.
	private _renderer: cool.VectorPrimitiveRenderer =
		new cool.VectorPrimitiveRenderer((checksum) =>
			this._bitmapCache.get(checksum),
		);
	/// Thumbnails, the slideshow and ink probes keep no composites, so
	/// they never evict the editor's.
	private _oneShotRenderer: cool.VectorPrimitiveRenderer =
		new cool.VectorPrimitiveRenderer(
			(checksum) => this._bitmapCache.get(checksum),
			{ cacheComposites: false },
		);

	// Cached parsed JSON primitive tree keyed by part number.
	private _cache: Map<number, cool.VectorPrimitivesData> = new Map();

	// Previews waiting for a JSON primitive tree response, keyed by part.
	private _pendingPreviews: Map<number, cool.PendingPreview[]> = new Map();

	// Parts for which a JSON primitive tree request is in flight. At most
	// one request is outstanding per part; an invalidation marks it stale
	// (_staleInFlightParts) instead of permitting a duplicate.
	private _inFlightParts: Set<number> = new Set();

	// Parts invalidated while their request was outstanding. The response
	// is still cached (newer than what the view holds) and a fresh request
	// is chained, so a reply can never regress the view to older content.
	private _staleInFlightParts: Set<number> = new Set();

	// Watchdog timers for in-flight requests, keyed by part.
	private _inFlightWatchdogs: Map<number, ReturnType<typeof setTimeout>> =
		new Map();

	// Consecutive watchdog re-issues per part. Bounded: endless 2s
	// whole-slide re-renders against a struggling kit are self-amplifying,
	// and a part deleted mid-fetch would otherwise be re-requested forever.
	private _watchdogRetriesByPart: Map<number, number> = new Map();

	private static readonly WATCHDOG_MAX_RETRIES = 3;

	// Monotonic count of mutating input messages (textinput /
	// removetextcontext / key) sent by this client. Meaningful only when
	// every mutating send is counted via noteMutatingInputSent().
	private _lastInputSeq: number = 0;

	// _lastInputSeq recorded when each in-flight request was sent.
	private _requestTagByPart: Map<number, number> = new Map();

	// Minimum interval between primitives requests for one part, keyed by
	// the owner that asked for it (effective = max of the active owners).
	// 0 (no owners) sends immediately. The speculative echoes raise it
	// while ops are pending: the echo covers the visual gap, so
	// per-keystroke whole-slide refetches can coalesce to a trailing-edge
	// cadence — and one echo tearing down cannot zero the window the other
	// still needs.
	private _fetchCoalesceByOwner: Map<string, number> = new Map();

	// Epoch ms of the last actually-sent request per part.
	private _lastSendAtByPart: Map<number, number> = new Map();

	// Deferred (coalesced) sends per part.
	private _deferredSendByPart: Map<number, ReturnType<typeof setTimeout>> =
		new Map();

	// Thumbnail fetches waiting for a free slot, in request order.
	private _thumbnailQueue: number[] = [];

	// Parts currently in flight on behalf of thumbnails (subset of
	// _inFlightParts), bounded by THUMBNAIL_MAX_IN_FLIGHT.
	private _thumbnailInFlight: Set<number> = new Set();

	// Decoded bitmap images keyed by their checksum.
	private _bitmapCache: Map<number, HTMLImageElement> = new Map();

	// Checksums for which a .uno:VectorRenderingGraphics request is
	// in flight.
	private _bitmapsInFlight: Set<number> = new Set();

	// Reverse index from bitmap checksum to the parts that reference
	// it. Lets a freshly-decoded bitmap re-render only the affected
	// thumbnails.
	private _checksumToParts: Map<number, Set<number>> = new Map();

	// Size and part of every preview that has been rendered. A redraw
	// triggered by a decoded bitmap reuses these so the re-fired
	// preview keeps the size and part it was rendered at.
	private _renderedPreviews: Map<cool.PreviewId, cool.RenderedPreview> =
		new Map();

	// Callbacks fired when cached vector data changes: a part's
	// primitive tree arrived (update carries {part, tag}), a deferred
	// bitmap decoded, or the cache was cleared (update is undefined).
	private _changeListeners: ((update?: VectorPartUpdate) => void)[] = [];

	// The Impress or Draw doc layer, read lazily so the manager can be
	// created before the layer is registered on the map.
	private get _docLayer(): cool.CanvasTileLayerInterface {
		return app.map._docLayer as unknown as cool.CanvasTileLayerInterface;
	}

	constructor() {
		super();
		// The metric-twin webfonts exist for this renderer alone; kicking
		// them off here keeps the tile path from ever fetching a byte.
		VulcanVectorWebFonts.ensure();
	}

	isVectorRendering(): boolean {
		return true;
	}

	/// A twin webfont finished loading: canvas measurements change, so
	/// every raster derived from them is stale. Re-render the thumbnails
	/// that have data and notify listeners (the content section drops its
	/// blit key on any change notification).
	noteWebFontsChanged(): void {
		this._renderer.noteResourcesChanged();
		for (const [id, info] of this._renderedPreviews) {
			const data = this._cache.get(info.part);
			if (!data) continue;
			this._renderAndFire(id, info.part, info.maxWidth, info.maxHeight, data);
		}
		this._fireChanged();
	}

	/// Register a callback fired whenever cached vector data changes.
	onVectorChanged(callback: (update?: VectorPartUpdate) => void): void {
		this._changeListeners.push(callback);
	}

	private _fireChanged(update?: VectorPartUpdate): void {
		for (const callback of this._changeListeners) callback(update);
	}

	/// Count a mutating input message (textinput / removetextcontext /
	/// key) at send time. Response tags only cover inputs that were
	/// counted, so callers must hook every mutating send path.
	noteMutatingInputSent(): void {
		this._lastInputSeq++;
	}

	/// The current mutating-input sequence (see noteMutatingInputSent).
	getLastInputSeq(): number {
		return this._lastInputSeq;
	}

	// The last tree that arrived for each part, kept across invalidations.
	// A reader of geometry right after a mutating input (a drop's armDrop,
	// an armed tool's commit reading the page border) lands
	// in the gap between a mutating input clearing the cache and the reply
	// refilling it; the last tree is the right answer for it, the empty
	// cache is not.
	private _lastKnownByPart: Map<number, cool.VectorPrimitivesData> = new Map();

	/// The most recent tree for a part, cached or last seen. Undefined only
	/// before the first reply.
	peekPart(part: number): cool.VectorPrimitivesData | undefined {
		return this._cache.get(part) ?? this._lastKnownByPart.get(part);
	}

	/// Return the cached primitive tree for a part, or undefined while a
	/// request is sent. Subscribers registered with onVectorChanged are
	/// notified once the data arrives.
	requestPart(part: number): cool.VectorPrimitivesData | undefined {
		const cached = this._cache.get(part);
		if (cached) return cached;

		if (!this._inFlightParts.has(part)) {
			this._inFlightParts.add(part);
			this._sendVectorPrimitivesRequest(part);
		}
		return undefined;
	}

	beginEditorFrame(liveZoom: boolean): void {
		this._renderer.beginFrame(liveZoom);
	}

	/// Render a part's primitive tree, master page first then the
	/// objects on top. The caller sets up the context transform that
	/// maps the part's twips to the target pixels. An override draws the
	/// object matching its ordNum translated (the speculative nudge
	/// echo); thumbnails never pass one. editView also selects the
	/// renderer that keeps composites.
	renderInto(
		context: CanvasRenderingContext2D,
		data: cool.VectorPrimitivesData,
		override?: cool.VectorRenderOverride,
		editView = false,
	): void {
		const renderer = editView ? this._renderer : this._oneShotRenderer;
		renderer.beginTree(data);
		// Edit-view-only content (empty placeholders' prompt text) paints
		// for the editor's own view only; previews (this class's
		// thumbnails) and the slideshow compositor take the default.
		renderer.setEditView(editView);
		for (const primitive of data.masterPage) {
			renderer.renderPrimitive(context, primitive);
		}
		for (const obj of data.objects) {
			if (!obj.primitives) continue;
			const overridden =
				override !== undefined &&
				obj.ordNum !== undefined &&
				(obj.ordNum === override.ordNum ||
					(Array.isArray(override.ordNums) &&
						override.ordNums.indexOf(obj.ordNum) !== -1));
			// Replacement content (live resize re-wrap) is already at
			// absolute positions, so it renders under the same part
			// transform with no translate; a bare translate override
			// (drag echo) shifts the object's own primitives.
			const replacement = overridden ? override.primitives : undefined;
			// A member drag: the renderer translates one objectChild
			// subtree of this group instead of the whole object.
			const memberDrag =
				overridden &&
				!replacement &&
				typeof override.childOrdNum === 'number';
			const translated = overridden && !replacement && !memberDrag;
			if (translated) {
				// save/translate composes for every primitive type: the
				// renderer never draws under a transform of its own (its one
				// reset blits a composite already in device pixels).
				context.save();
				context.translate(override.dxTwips, override.dyTwips);
			}
			if (memberDrag)
				renderer.setChildOverride({
					ordNum: override.childOrdNum as number,
					dxTwips: override.dxTwips,
					dyTwips: override.dyTwips,
				});
			for (const primitive of replacement || obj.primitives) {
				renderer.renderPrimitive(context, primitive);
			}
			if (memberDrag) renderer.setChildOverride(null);
			if (translated) context.restore();
		}
		renderer.setEditView(false);
	}

	/// The objectChild subtree of one IMMEDIATE member of a group, or
	/// null when the kit predates member nodes or the member is unknown.
	private findChildPrimitives(
		part: number,
		groupOrdNum: number,
		childOrdNum: number,
	): cool.Primitive[] | null {
		const group = this.findTopLevelObject(part, groupOrdNum);
		if (!group || !group.primitives) return null;
		for (const primitive of group.primitives) {
			if (
				primitive.type === cool.ObjectChildPrimitive.type &&
				(primitive as cool.ObjectChildPrimitive).ordNum === childOrdNum
			)
				return primitive.children || [];
		}
		return null;
	}

	/// The child record (ordinal + bounds + flags) of one immediate member.
	private findChildRecord(
		part: number,
		groupOrdNum: number,
		childOrdNum: number,
	): cool.SlideObjectChild | null {
		const group = this.findTopLevelObject(part, groupOrdNum);
		if (!group || !Array.isArray(group.children)) return null;
		for (const child of group.children) {
			if (child.ordNum === childOrdNum) return child;
		}
		return null;
	}

	/// Topmost object whose visible ink (or text area) covers the given
	/// document point, from the cached primitive tree of one part. Powers
	/// the speculative selection echo: a bare bounding-box test would
	/// false-hit the empty interior of diagonal connectors and unfilled
	/// frames, so a bbox prefilter (in z-order, topmost first) is
	/// confirmed by rendering the candidate into a small probe canvas
	/// around the point — except for text-bearing objects, which core
	/// hits on their whole snap area (Impress text-frame rules).
	/// Returns null when the part is not cached, the kit predates
	/// per-object bounds, or nothing covers the point — a MISS never
	/// draws, so every unknown is safe.
	hitTestPoint(
		part: number,
		xTwips: number,
		yTwips: number,
		toleranceTwips: number,
	): { ordNum: number; bounds: number[]; isGroup: boolean } | null {
		const data = this._cache.get(part);
		if (!data) return null;
		for (let i = data.objects.length - 1; i >= 0; i--) {
			const obj = data.objects[i];
			if (obj.ordNum === undefined || !obj.primitives) continue;
			// A PDF page's protected picture is not an object the user can
			// move: a press on it is a press on the page. Nor is a locked
			// object (an edited scan's kept scan): core refuses to mark it.
			if (obj.pdfPage === true || obj.locked === true) continue;
			const bounds = obj.bounds;
			if (!Array.isArray(bounds) || bounds.length < 4) continue;
			if (
				!VectorManager.boundsContain(
					bounds,
					xTwips,
					yTwips,
					toleranceTwips,
				)
			)
				continue;
			if (
				obj.emptyPresObj === true ||
				VectorManager.hasTextPortion(obj.primitives) ||
				this.inksPoint(data, obj, xTwips, yTwips, toleranceTwips)
			)
				return {
					ordNum: obj.ordNum,
					bounds: bounds.slice(),
					isGroup:
						Array.isArray(obj.children) && obj.children.length > 0,
				};
		}
		return null;
	}

	/// Does the top-level object carry text portions? (The gesture
	/// grammar's caret question: a click on such an object's glyphs is a
	/// text-edit entry, not a plain select.)
	isTextBearing(part: number, ordNum: number, childOrdNum?: number): boolean {
		if (typeof childOrdNum === 'number') {
			const record = this.findChildRecord(part, ordNum, childOrdNum);
			if (record && record.emptyPresObj === true) return true;
			const primitives = this.findChildPrimitives(part, ordNum, childOrdNum);
			return !!(primitives && VectorManager.hasTextPortion(primitives));
		}
		const obj = this.findTopLevelObject(part, ordNum);
		if (!obj) return false;
		if (obj.emptyPresObj === true) return true;
		return !!(obj.primitives && VectorManager.hasTextPortion(obj.primitives));
	}

	/// Is the immediate member an empty placeholder?
	isEmptyPlaceholder(part: number, ordNum: number, childOrdNum?: number): boolean {
		if (typeof childOrdNum === 'number') {
			const record = this.findChildRecord(part, ordNum, childOrdNum);
			return !!(record && record.emptyPresObj === true);
		}
		const obj = this.findTopLevelObject(part, ordNum);
		return !!(obj && obj.emptyPresObj === true);
	}

	/// Does ONE top-level object's own ink (glyphs, fill, stroke) cover
	/// the point? The gesture grammar's ink question for an object the
	/// bbox already hit: a click on a text box's glyphs places the caret,
	/// a click on its empty interior only selects. False when the part or
	/// object is unknown.
	hitTestInk(
		part: number,
		ordNum: number,
		xTwips: number,
		yTwips: number,
		toleranceTwips: number,
		childOrdNum?: number,
	): boolean {
		const data = this._cache.get(part);
		if (!data) return false;
		if (typeof childOrdNum === 'number') {
			const primitives = this.findChildPrimitives(part, ordNum, childOrdNum);
			if (!primitives) return false;
			return this.inksPoint(
				data,
				{ primitives: primitives },
				xTwips,
				yTwips,
				toleranceTwips,
			);
		}
		const obj = this.findTopLevelObject(part, ordNum);
		// A hidden-ink line paints nothing, yet a click on it is a click on
		// its words (the scan shows them): its whole box is ink.
		if (obj && obj.hiddenInk === true && Array.isArray(obj.bounds))
			return VectorManager.boundsContain(
				obj.bounds,
				xTwips,
				yTwips,
				toleranceTwips,
			);
		if (!obj || !obj.primitives) return false;
		return this.inksPoint(data, obj, xTwips, yTwips, toleranceTwips);
	}

	/// Does core refuse to move this top-level object (moveProtect)?
	isMoveProtected(part: number, ordNum: number): boolean {
		const obj = this.findTopLevelObject(part, ordNum);
		return !!(obj && obj.moveProtect === true);
	}

	/// Topmost IMMEDIATE member of one group's list covering the point —
	/// the select echo's descent once a group is entered. Bounding-box
	/// only: members carry no primitive tree of their own, and inside an
	/// entered group a bbox pick reconciles in one round trip.
	hitTestChildren(
		part: number,
		groupOrdNum: number,
		xTwips: number,
		yTwips: number,
		toleranceTwips: number,
	): { ordNum: number; bounds: number[]; isGroup: boolean } | null {
		const group = this.findTopLevelObject(part, groupOrdNum);
		if (!group || !Array.isArray(group.children)) return null;
		for (let i = group.children.length - 1; i >= 0; i--) {
			const child = group.children[i];
			if (child.ordNum === undefined) continue;
			const bounds = child.bounds;
			if (!Array.isArray(bounds) || bounds.length < 4) continue;
			if (
				VectorManager.boundsContain(
					bounds,
					xTwips,
					yTwips,
					toleranceTwips,
				)
			)
				return {
					ordNum: child.ordNum,
					bounds: bounds.slice(),
					isGroup:
						Array.isArray(child.children) &&
						child.children.length > 0,
				};
		}
		return null;
	}

	/// Every top-level object whose bounds INTERSECT the rectangle —
	/// the live marquee's covered set (core's under-kit marking selects
	/// what the band touches, so bbox intersection matches the outcome).
	hitTestRect(
		part: number,
		xTwips: number,
		yTwips: number,
		widthTwips: number,
		heightTwips: number,
	): { ordNum: number; bounds: number[] }[] {
		const data = this._cache.get(part);
		if (!data) return [];
		const covered: { ordNum: number; bounds: number[] }[] = [];
		for (const obj of data.objects) {
			if (obj.ordNum === undefined) continue;
			if (obj.pdfPage === true || obj.locked === true) continue;
			const bounds = obj.bounds;
			if (!Array.isArray(bounds) || bounds.length < 4) continue;
			if (
				bounds[0] + bounds[2] < xTwips ||
				bounds[0] > xTwips + widthTwips ||
				bounds[1] + bounds[3] < yTwips ||
				bounds[1] > yTwips + heightTwips
			)
				continue;
			covered.push({ ordNum: obj.ordNum, bounds: bounds.slice() });
		}
		return covered;
	}

	/// Topmost object whose BOUNDS contain the point — no ink probe, no
	/// text rules. For high-frequency callers (hover) where a coarse
	/// answer beats a per-event canvas render.
	hitTestPointFast(
		part: number,
		xTwips: number,
		yTwips: number,
		toleranceTwips: number,
	): { ordNum: number; bounds: number[] } | null {
		const data = this._cache.get(part);
		if (!data) return null;
		for (let i = data.objects.length - 1; i >= 0; i--) {
			const obj = data.objects[i];
			if (obj.ordNum === undefined) continue;
			if (obj.locked === true) continue;
			const bounds = obj.bounds;
			if (!Array.isArray(bounds) || bounds.length < 4) continue;
			if (
				VectorManager.boundsContain(
					bounds,
					xTwips,
					yTwips,
					toleranceTwips,
				)
			)
				return { ordNum: obj.ordNum, bounds: bounds.slice() };
		}
		return null;
	}

	findTopLevelObject(
		part: number,
		ordNum: number,
	): cool.SlideObject | null {
		const data = this._cache.get(part);
		if (!data) return null;
		for (const obj of data.objects) {
			if (obj.ordNum === ordNum) return obj;
		}
		return null;
	}

	/// Which payload node does an authoritative selection rectangle name?
	/// 'top' = a top-level object; a groupOrdNum = an IMMEDIATE member of
	/// that group (the view is inside it); null = unknown (bounds may be
	/// stale mid-edit — the caller keeps its current belief). Matches on
	/// the snap rect the kit itself reported, so a couple of twips of
	/// rounding are tolerated, tightened by the ordinal when readable.
	classifySelection(
		part: number,
		rect: number[],
		selectionOrdNum: number | null,
	): { kind: 'top' } | { kind: 'child'; groupOrdNum: number } | null {
		const data = this._cache.get(part);
		if (!data) return null;
		for (const obj of data.objects) {
			if (VectorManager.boundsMatchRect(obj.bounds, rect))
				return { kind: 'top' };
		}
		for (const obj of data.objects) {
			if (obj.ordNum === undefined || !Array.isArray(obj.children))
				continue;
			for (const child of obj.children) {
				if (!VectorManager.boundsMatchRect(child.bounds, rect))
					continue;
				if (
					selectionOrdNum !== null &&
					child.ordNum !== undefined &&
					child.ordNum !== selectionOrdNum
				)
					continue;
				return { kind: 'child', groupOrdNum: obj.ordNum };
			}
		}
		return null;
	}

	private static boundsContain(
		bounds: number[],
		xTwips: number,
		yTwips: number,
		toleranceTwips: number,
	): boolean {
		return (
			xTwips >= bounds[0] - toleranceTwips &&
			xTwips <= bounds[0] + bounds[2] + toleranceTwips &&
			yTwips >= bounds[1] - toleranceTwips &&
			yTwips <= bounds[1] + bounds[3] + toleranceTwips
		);
	}

	private static boundsMatchRect(
		bounds: number[] | undefined,
		rect: number[],
	): boolean {
		if (!Array.isArray(bounds) || bounds.length < 4) return false;
		const tolerance = 3;
		for (let i = 0; i < 4; i++) {
			if (Math.abs(bounds[i] - rect[i]) > tolerance) return false;
		}
		return true;
	}

	/// Core hits a text-bearing shape anywhere on its snap area, filled
	/// or not, so the presence of a text portion accepts the bbox hit.
	/// A picture's own text (an SVG's decomposed <text>) is not shape
	/// text: core selects the picture, it never enters text edit.
	public static hasTextPortion(primitives: cool.Primitive[]): boolean {
		for (const primitive of primitives) {
			if (
				primitive.type === cool.TextSimplePortionPrimitive.type ||
				primitive.type === cool.TextDecoratedPortionPrimitive.type
			)
				return true;
			if (primitive.type === cool.GraphicPrimitive.type) continue;
			if (primitive.children && this.hasTextPortion(primitive.children))
				return true;
		}
		return false;
	}

	/// Render ONE object into a probe canvas covering ±tolerance around
	/// the point and report whether any ink landed. Matches the picture,
	/// which is what the user aimed at. A context the environment cannot
	/// supply reads as a miss.
	private inksPoint(
		data: cool.VectorPrimitivesData,
		obj: { primitives?: cool.Primitive[] },
		xTwips: number,
		yTwips: number,
		toleranceTwips: number,
	): boolean {
		const scale = app.twipsToPixels;
		const sizePx = Math.max(
			3,
			Math.ceil(2 * toleranceTwips * scale) | 1,
		);
		const canvas = document.createElement('canvas');
		canvas.width = sizePx;
		canvas.height = sizePx;
		const context = canvas.getContext('2d');
		if (!context) return false;
		// Map document twips so the probed point sits at the canvas
		// center; the renderer draws in twips space (it never draws under
		// a transform of its own), so the clip stays honest.
		context.setTransform(
			scale,
			0,
			0,
			scale,
			sizePx / 2 - xTwips * scale,
			sizePx / 2 - yTwips * scale,
		);
		const renderer = this._oneShotRenderer;
		renderer.beginTree(data);
		if (!obj.primitives) return false;
		// The probe asks what the EDITOR paints: a placeholder's prompt
		// glyphs are ink the user can aim at. A shadow is not: core's hit
		// test ignores it.
		renderer.setEditView(true);
		renderer.setHitTest(true);
		try {
			for (const primitive of obj.primitives) {
				renderer.renderPrimitive(context, primitive);
			}
		} finally {
			renderer.setEditView(false);
			renderer.setHitTest(false);
		}
		const pixels = context.getImageData(0, 0, sizePx, sizePx).data;
		for (let i = 3; i < pixels.length; i += 4) {
			if (pixels[i] > 16) return true;
		}
		return false;
	}

	/// Request a thumbnail for a preview. Fetches are bounded: at most
	/// THUMBNAIL_MAX_IN_FLIGHT thumbnail-initiated requests are
	/// outstanding, and off-screen parts are dropped at dequeue time
	/// (the filmstrip re-requests visible unfetched previews on scroll,
	/// same recovery as Parts._processPreviewQueue).
	requestThumbnail(
		id: cool.PreviewId,
		part: number,
		maxWidth: number,
		maxHeight: number,
	): void {
		const cached = this._cache.get(part);
		if (cached) {
			this._renderAndFire(id, part, maxWidth, maxHeight, cached);
			return;
		}

		let queue = this._pendingPreviews.get(part);
		if (!queue) {
			queue = [];
			this._pendingPreviews.set(part, queue);
		}
		queue.push({ id: id, maxWidth: maxWidth, maxHeight: maxHeight });

		// A response for an already-in-flight part drains the pending
		// preview; no new request and no queue slot needed.
		if (this._inFlightParts.has(part)) return;

		if (this._thumbnailQueue.indexOf(part) < 0)
			this._thumbnailQueue.push(part);
		this._pumpThumbnailQueue();
	}

	private _isPreviewVisible(part: number): boolean {
		const preview = (this._docLayer as any)._preview;
		if (!preview || typeof preview._isPreviewVisible !== 'function')
			return true;
		return preview._isPreviewVisible(part) === true;
	}

	private _pumpThumbnailQueue(): void {
		while (
			this._thumbnailInFlight.size < VectorManager.THUMBNAIL_MAX_IN_FLIGHT
		) {
			const part = this._thumbnailQueue.shift();
			if (part === undefined) return;
			if (this._inFlightParts.has(part)) continue;
			const cached = this._cache.get(part);
			if (cached) {
				this._drainPending(part, cached);
				continue;
			}
			if (!this._isPreviewVisible(part)) {
				this._pendingPreviews.delete(part);
				// Mirror Parts._processPreviewQueue: the filmstrip's
				// scroll handler only re-requests previews whose tile has
				// fetched=false, so a dropped fetch must reset it or an
				// off-screen slide edited by a collaborator keeps its
				// stale thumbnail forever.
				const previewTile = (this._docLayer as any)?._preview
					?._previewTiles?.[part];
				if (previewTile) previewTile.fetched = false;
				continue;
			}
			this._thumbnailInFlight.add(part);
			this._inFlightParts.add(part);
			this._sendVectorPrimitivesRequest(part);
		}
	}

	/// Ask for a per-part minimum request interval on behalf of one owner
	/// (see _fetchCoalesceByOwner).
	requestFetchCoalesce(owner: string, ms: number): void {
		this._fetchCoalesceByOwner.set(owner, ms);
	}

	/// Drop one owner's coalescing window.
	releaseFetchCoalesce(owner: string): void {
		this._fetchCoalesceByOwner.delete(owner);
	}

	private _fetchCoalesceWindowMs(): number {
		let max = 0;
		for (const ms of this._fetchCoalesceByOwner.values())
			if (ms > max) max = ms;
		return max;
	}

	private _sendVectorPrimitivesRequest(part: number): void {
		const windowMs = this._fetchCoalesceWindowMs();
		if (windowMs > 0) {
			const last = this._lastSendAtByPart.get(part);
			const now = Date.now();
			if (last !== undefined && now - last < windowMs) {
				// Trailing-edge coalescing: one deferred send absorbs
				// every further demand inside the window.
				if (!this._deferredSendByPart.has(part)) {
					const handle = setTimeout(
						() => {
							this._deferredSendByPart.delete(part);
							this._sendNow(part);
						},
						windowMs - (now - last),
					);
					this._deferredSendByPart.set(part, handle);
				}
				return;
			}
		}
		this._sendNow(part);
	}

	private _sendNow(part: number, preserveReconcileState = false): void {
		this._lastSendAtByPart.set(part, Date.now());
		if (!preserveReconcileState) {
			// This send happens after every invalidation observed so far,
			// so a stale mark set while the send was deferred is already
			// satisfied.
			this._staleInFlightParts.delete(part);
			this._requestTagByPart.set(part, this._lastInputSeq);
		}
		this._armWatchdog(part);
		app.socket.sendMessage(
			'commandvalues command=.uno:VectorPrimitives?part=' + String(part),
		);
	}

	private _armWatchdog(part: number): void {
		this._clearWatchdog(part);
		const handle = setTimeout(() => {
			this._inFlightWatchdogs.delete(part);
			if (!this._inFlightParts.has(part)) return;
			const retries = (this._watchdogRetriesByPart.get(part) ?? 0) + 1;
			if (retries > VectorManager.WATCHDOG_MAX_RETRIES) {
				// Give up cleanly: drop every in-flight mark so the NEXT
				// demand (draw, invalidation, thumbnail) starts a fresh
				// request, instead of re-rendering a whole slide every 2s
				// against a kit that is not answering.
				this._watchdogRetriesByPart.delete(part);
				this._inFlightParts.delete(part);
				this._thumbnailInFlight.delete(part);
				this._staleInFlightParts.delete(part);
				this._requestTagByPart.delete(part);
				return;
			}
			this._watchdogRetriesByPart.set(part, retries);
			// The response was lost or the kit stalled. Re-issue, but
			// PRESERVE the original tag and stale mark: a merely-slow
			// original reply may still arrive, and crediting it with the
			// re-issue's later tag would retire echo ops for input that
			// reply predates.
			this._sendNow(part, /*preserveReconcileState=*/ true);
		}, VectorManager.IN_FLIGHT_WATCHDOG_MS);
		this._inFlightWatchdogs.set(part, handle);
	}

	private _clearWatchdog(part: number): void {
		const handle = this._inFlightWatchdogs.get(part);
		if (handle !== undefined) {
			clearTimeout(handle);
			this._inFlightWatchdogs.delete(part);
		}
	}

	/// Handle a vector primitives response.
	handleVectorPrimitivesResponse(values: cool.VectorPrimitivesResponse): void {
		const part =
			values.part !== undefined ? values.part : this._docLayer._selectedPart;

		const tag = this._requestTagByPart.get(part);
		this._requestTagByPart.delete(part);
		this._clearWatchdog(part);
		this._watchdogRetriesByPart.delete(part);
		this._inFlightParts.delete(part);
		this._thumbnailInFlight.delete(part);

		const masterPage =
			values.masterPage && values.masterPage.primitives
				? values.masterPage.primitives
				: [];
		const objects = values.objects || [];

		const data: cool.VectorPrimitivesData = {
			slideWidth: values.slideWidth || 0,
			borderLeft: values.borderLeft || 0,
			borderTop: values.borderTop || 0,
			slideHeight: values.slideHeight || 0,
			masterPage: masterPage,
			objects: objects,
		};
		// The part's previous tree is never drawn again: its composites
		// cannot hit.
		const superseded = this._lastKnownByPart.get(part);
		if (superseded) this._renderer.forgetTree(superseded);
		this._cache.set(part, data);
		this._lastKnownByPart.set(part, data);

		// Webfonts this part's text runs need. The URW serif twins load the
		// first time a part names one (or an Office name paired with one), on
		// every canvas. On-demand downloads - any family the image does not
		// ship (an arbitrary PDF's fonts) - are page canvas only: a deck's
		// families are the bundled set, and fetching per family on every
		// payload re-laid decks out mid-session. Bundled/attempted names are
		// skipped inside; a load repaints via noteWebFontsChanged.
		const families = VulcanVectorWebFonts.collectFamilies(masterPage, objects);
		VulcanVectorWebFonts.ensureTwinsFor(families);
		if (VulcanCanvasAutosave.isPageCanvas())
			VulcanVectorWebFonts.ensureFamilies(families);

		const required = new Set<number>();
		const walker = new cool.VectorBitmapWalker(required);
		walker.walkPrimitives(masterPage);
		walker.walkObjects(objects);
		this._indexChecksumsForPart(part, required);
		this._requestMissingBitmaps(required);

		this._drainPending(part, data);

		// Invalidated while this request was outstanding: the data just
		// cached is newer than what the view held, so keep and announce
		// it, but chain a fresh request so the view converges on the
		// post-invalidation state.
		if (this._staleInFlightParts.delete(part)) {
			this._inFlightParts.add(part);
			this._sendVectorPrimitivesRequest(part);
		}

		this._pumpThumbnailQueue();
		this._fireChanged(
			tag !== undefined ? { part: part, tag: tag } : undefined,
		);
	}

	/// Handle a fetched bitmap: cache it and re-render the
	/// previews that use it.
	handleVectorRenderingGraphicsResponse(
		values: cool.VectorRenderingGraphicsResponse,
	): void {
		if (this._bitmapCache.has(values.checksum)) {
			this._bitmapsInFlight.delete(values.checksum);
			return;
		}
		const image = new Image();
		// Add to the cache only on a successful decode. Clear
		// the in-flight mark on either outcome.
		image.onload = () => {
			this._bitmapCache.set(values.checksum, image);
			this._renderer.noteResourcesChanged();
			this._bitmapsInFlight.delete(values.checksum);
			this._redrawPreviewsFor(values.checksum);
			this._fireChanged();
		};
		image.onerror = () => {
			this._bitmapsInFlight.delete(values.checksum);
		};
		image.src = values.data;
	}

	private _indexChecksumsForPart(part: number, checksums: Set<number>): void {
		for (const checksum of checksums) {
			let parts = this._checksumToParts.get(checksum);
			if (!parts) {
				parts = new Set<number>();
				this._checksumToParts.set(checksum, parts);
			}
			parts.add(part);
		}
	}

	private _redrawPreviewsFor(checksum: number): void {
		const parts = this._checksumToParts.get(checksum);
		if (!parts) return;
		for (const part of parts) {
			const data = this._cache.get(part);
			if (!data) continue;
			for (const [id, info] of this._renderedPreviews) {
				if (info.part !== part) continue;
				this._renderAndFire(id, part, info.maxWidth, info.maxHeight, data);
			}
		}
	}

	private _requestMissingBitmaps(checksums: Set<number>): void {
		for (const checksum of checksums) {
			if (this._bitmapCache.has(checksum)) continue;
			if (this._bitmapsInFlight.has(checksum)) continue;
			this._bitmapsInFlight.add(checksum);
			app.socket.sendMessage(
				'commandvalues command=.uno:VectorRenderingGraphics?checksum=' +
					String(checksum),
			);
		}
	}

	/// Drop cached data for a part. An in-flight request is kept but
	/// marked stale rather than forgotten: forgetting it allowed a
	/// duplicate request whose OLDER reply could land after the newer
	/// one and regress the view to pre-invalidation content.
	clearCachedPart(part: number): void {
		this._cache.delete(part);
		this._forgetDroppedTrees([part]);
		if (this._inFlightParts.has(part)) this._staleInFlightParts.add(part);
		this._fireChanged();
	}

	/// Drop the cached primitive trees for every part so the views
	/// re-fetch them. Decoded bitmaps stay cached, since an image that
	/// actually changed comes back under a new checksum anyway.
	clearAllParts(): void {
		this._cache.clear();
		this._forgetDroppedTrees(this._lastKnownByPart.keys());
		for (const part of this._inFlightParts)
			this._staleInFlightParts.add(part);
		this._fireChanged();
	}

	/// Frees the composites of the dropped trees no view draws again before
	/// their parts' next trees arrive. The editor's view still draws the
	/// selected part's last tree under a drag or a nudge while the refetch
	/// is in flight, so that one keeps them.
	private _forgetDroppedTrees(parts: Iterable<number>): void {
		const selected = this._docLayer?._selectedPart;
		for (const part of parts) {
			const tree = this._lastKnownByPart.get(part);
			if (tree && part !== selected) this._renderer.forgetTree(tree);
		}
	}

	/// An undo or redo went out. The engine answers it with a modified-status
	/// change only when the flag flips, and never with a tile invalidation
	/// this view listens to — so a deleted run undone stayed gone until the
	/// next unrelated refetch. Every part is re-requested; the request
	/// queues behind the command on the same socket, so its reply already
	/// carries the undone page.
	noteHistoryCommandSent(): void {
		this.clearAllParts();
	}

	/// Drop all cached data for all parts.
	clearCache(): void {
		this._cache.clear();
		for (const part of this._inFlightParts)
			this._staleInFlightParts.add(part);
		this._pendingPreviews.clear();
		this._thumbnailQueue.length = 0;
		this._bitmapCache.clear();
		this._bitmapsInFlight.clear();
		this._checksumToParts.clear();
		this._renderedPreviews.clear();
		this._renderer.noteResourcesChanged();
		this._fireChanged();
	}

	private _drainPending(part: number, data: cool.VectorPrimitivesData): void {
		const queue = this._pendingPreviews.get(part);
		if (!queue) return;
		this._pendingPreviews.delete(part);

		for (const pending of queue) {
			this._renderAndFire(
				pending.id,
				part,
				pending.maxWidth,
				pending.maxHeight,
				data,
			);
		}
	}

	/// Render to an offscreen canvas and trigger rendering of the thumbnail.
	private _renderAndFire(
		id: cool.PreviewId,
		part: number,
		maxWidth: number,
		maxHeight: number,
		data: cool.VectorPrimitivesData,
	): void {
		if (data.slideWidth <= 0 || data.slideHeight <= 0) return;

		this._renderedPreviews.set(id, {
			part: part,
			maxWidth: maxWidth,
			maxHeight: maxHeight,
		});

		const pxW = Math.max(1, Math.round(maxWidth * app.roundedDpiScale));
		const pxH = Math.max(1, Math.round(maxHeight * app.roundedDpiScale));

		const canvas = document.createElement('canvas');
		canvas.width = pxW;
		canvas.height = pxH;
		const context = canvas.getContext('2d');
		if (!context) return;

		// Twips to canvas pixels.
		context.scale(pxW / data.slideWidth, pxH / data.slideHeight);

		this.renderInto(context, data);

		const previewImage = new Image();
		previewImage.width = maxWidth;
		previewImage.height = maxHeight;
		previewImage.src = canvas.toDataURL('image/png');

		app.map.fire('tilepreview', {
			tile: previewImage,
			id: id,
			width: maxWidth,
			height: maxHeight,
			part: part,
			mode: 0,
			docType: this._docLayer._docType,
		});
	}
}
