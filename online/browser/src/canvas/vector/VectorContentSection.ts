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

/*
 * VectorContentSection - Canvas section that draws the main view from
 * vector primitives, for Impress and Draw. The part data, bitmap cache
 * and renderer are shared through the RenderManager facade, so each part is
 * fetched and decoded only once.
 *
 * The section is bound to the bitmap tiles section and drawn right after
 * it. The background primitive is opaque, so the vector output fully
 * covers the tiles area.
 */

/* global app */

namespace cool {
	export class VectorContentSection extends CanvasSectionObject {
		processingOrder: number = app.CSections.VectorContent.processingOrder;
		drawingOrder: number = app.CSections.VectorContent.drawingOrder;
		zIndex: number = app.CSections.VectorContent.zIndex;
		boundToSection: string = 'tiles';
		interactable: boolean = false;

		private _docLayer: any;

		// Holds the rendered pixels of the current frame. Other sections
		// trigger frequent redraws, so a redraw reuses these pixels when the
		// part, scroll and zoom are unchanged.
		private _offscreen: HTMLCanvasElement = null;
		private _offscreenCtx: CanvasRenderingContext2D = null;
		private _lastRenderKey: string = '';
		// Part whose pixels are in the offscreen canvas, so a blit reuses
		// them only for that same part.
		private _offscreenPart: number = -1;

		// Last-good primitive tree per current part. During the window
		// between an invalidation clearing the cache and the fresh response
		// landing, the nudge echo re-renders THIS data with its current
		// offset — the offscreen blit alone would show the previous
		// generation's offset frozen.
		private _retainedData: cool.VectorPrimitivesData = null;
		private _retainedPart: number = -1;

		/// The last LIVE drag override returned, so the frame after the
		/// drop can convert it into a release hold.
		private _lastLiveDrag: {
			part: number;
			override: cool.VectorRenderOverride & { generation: number };
		} | null = null;

		/// Between the drop and the authoritative render of the moved
		/// object, the model still holds the origin (core commits a move
		/// on mouse-up): keep painting the drag's final offset so the
		/// object cannot snap back for one round trip. Retired by the
		/// next tagged tree for the part, or by the deadline.
		private _releaseHold: {
			part: number;
			override: cool.VectorRenderOverride & { generation: number };
			at: number;
			/// Input seq at drop: only trees tagged at-or-after this can
			/// contain the move and may retire the hold.
			seq: number;
		} | null = null;

		private static readonly RELEASE_HOLD_DEADLINE_MS = 1500;

		constructor() {
			super(app.CSections.VectorContent.name);

			// Redraw when a part's data arrives, a deferred bitmap decodes, or
			// the part is invalidated. Drop the cache key so the next draw
			// re-renders the part.
			RenderManager.onVectorChanged((update?: VectorPartUpdate) => {
				this._lastRenderKey = '';
				// A fresh authoritative tree carries the committed resize
				// re-wrap, so the client-side preview retires (unless the
				// drag is still live — a mid-drag tree must not drop it).
				const resizeReflow = app.definitions.vulcanImpressResizeReflow;
				if (
					resizeReflow?.getLiveOverride?.() &&
					!this.containerObject.isDraggingSomething()
				)
					resizeReflow.clear();
				// A fresh authoritative tree for the held part IS the moved
				// object: the post-drop hold retires.
				if (update) {
					if (
						this._releaseHold &&
						this._releaseHold.part === update.part &&
						update.tag >= this._releaseHold.seq
					)
						this._releaseHold = null;
					// A fresh tree between mouseup and the first
					// post-release draw must not re-arm a hold from the
					// stale live-drag snapshot (review F6).
					if (
						this._lastLiveDrag &&
						this._lastLiveDrag.part === update.part
					)
						this._lastLiveDrag = null;
				}
				if (app.sectionContainer) app.sectionContainer.requestReDraw();
			});
		}

		onInitialize(): void {
			this._docLayer = app.map._docLayer;
		}

		private _ensureOffscreen(width: number, height: number): void {
			if (!this._offscreen) {
				this._offscreen = document.createElement('canvas');
				this._offscreenCtx = this._offscreen.getContext('2d');
			}
			if (
				this._offscreen.width !== width ||
				this._offscreen.height !== height
			) {
				this._offscreen.width = width;
				this._offscreen.height = height;
			}
		}

		onDraw(): void {
			if (!this._docLayer) return;
			// Zoom animation: the tiles pass drives app.twipsToPixels and
			// the layout's viewedRectangle to the live zoom frame each RAF
			// precisely so vector sections follow it (drawZoomFrame's
			// freeDocRange block). The old upstream flat skip predated that
			// machinery and blanked the slide for the whole gesture. Stand
			// down only while the frame state is not driven yet — nothing
			// to follow then.
			if (this.containerObject.isInZoomAnimation()) {
				const painter: any = (this._docLayer as any)._painter;
				if (!painter || !painter._inZoomAnim || !painter._zoomFrameScale)
					return;
			}
			const liveZoom = this.containerObject.isInZoomAnimation();

			// The container's zoomChanged clear-skip does not apply while
			// vector rendering is active (CanvasSectionContainer clears
			// every frame then) — no ground-paint needed here.

			if (app.file.fileBasedView) {
				this._drawFileBasedView(liveZoom);
				return;
			}

			const part = this._docLayer._selectedPart;
			const cached = RenderManager.requestPart(part);
			const nudge = app.definitions.vulcanImpressNudge;
			// A live mouse drag outranks a nudge echo: both cannot be
			// active at once (a drag latch ends the keyboard gesture), and
			// the drag override is derived fresh per frame.
			const override =
				this._getDragOverride(part) ||
				(nudge ? nudge.getRenderOverride(part) : null);

			// While a refetch is in flight, fall back to the retained
			// last-good tree so a live nudge override still repaints at its
			// CURRENT offset instead of freezing at the blitted one.
			const data =
				cached ||
				(override && this._retainedPart === part
					? this._retainedData
					: null);
			if (!data) {
				// Data not ready. Blit the prior frame only when it holds
				// the part we want, so the view keeps the current part
				// until its fresh data arrives.
				if (this._offscreen && this._offscreenPart === part) {
					this.context.drawImage(this._offscreen, 0, 0);
				}
				return;
			}
			if (cached) {
				this._retainedData = cached;
				this._retainedPart = part;
			}

			const scale = app.twipsToPixels;
			const viewedRectangle = app.activeDocument.activeLayout.viewedRectangle;
			// The section container has translated the context to the
			// section top-left, which equals the document anchor. So the
			// scroll offset alone maps the part origin into place.
			const offsetX = -viewedRectangle.pX1;
			const offsetY = -viewedRectangle.pY1;

			const w = this.context.canvas.width;
			const h = this.context.canvas.height;
			this._ensureOffscreen(w, h);

			// The override component carries the GENERATION counter (any
			// change to a nudge intent or its base must invalidate the
			// blit, and a generation can never collide the way a recomputed
			// dx alone could) AND the offsets, because the drag override's
			// per-frame dx/dy are the only thing that changes while the
			// cursor moves. And liveZoom, so the frame after the zoom
			// animation renders again at its last scale, remaking the
			// composites it drew scaled.
			const renderKey =
				part + ':' + scale + ':' + liveZoom + ':' +
				offsetX + ':' + offsetY + ':' + w + ':' + h +
				':' + (override
					? override.generation + ':' + override.ordNum + ':' +
						(override.childOrdNum ?? '') + ':' +
						override.dxTwips + ':' + override.dyTwips
					: 0);
			if (renderKey !== this._lastRenderKey) {
				this._offscreenCtx.clearRect(0, 0, w, h);
				this._drawPageChrome(
					this._offscreenCtx,
					part,
					offsetX,
					offsetY,
					scale,
					w,
					h,
				);
				this._offscreenCtx.save();
				this._offscreenCtx.translate(offsetX, offsetY);
				this._offscreenCtx.scale(scale, scale);
				RenderManager.beginEditorFrame(liveZoom);
				// The editor's view: edit-view-only content (empty
				// placeholders' prompts) paints here, as in the tile view.
				RenderManager.renderInto(
					this._offscreenCtx,
					data,
					override || undefined,
					true,
				);
				this._offscreenCtx.restore();
				const page = this._pageRect(part, offsetX, offsetY, scale);
				if (page)
					this._drawPageOutline(
						this._offscreenCtx, page.x, page.y, page.w, page.h);
				this._lastRenderKey = renderKey;
				this._offscreenPart = part;
			}
			this.context.drawImage(this._offscreen, 0, 0);
		}

		// While the SELECTED object is being drag-moved, its vector
		// content translates with the cursor — the frame already follows
		// (drawSelectionFrame reads lastDragDistance), and without this
		// the content sat at the old position until the drop answered
		// ("the selection box moves but the text trails after"). Single
		// objects and groups only: a multi-selection has no single
		// payload identity to translate. Derived per frame, never stored.
		private _getDragOverride(
			part: number,
		): (cool.VectorRenderOverride & { generation: number }) | null {
			// A live text-box RESIZE re-wraps client-side (zero round
			// trip): the scaling drag hands us the re-laid-out portions
			// and we paint them in place of the object's stale tree until
			// the authoritative render lands. Takes precedence over the
			// translate echoes — a resize is not a move.
			const reflow = this._resizeReflowOverride(part);
			if (reflow) return reflow;

			const live = this._liveDragOverride(part);
			if (live) {
				this._lastLiveDrag = { part: part, override: live };
				return live;
			}
			// The drag just ended: hold its final offset until the moved
			// object's authoritative tree lands (see onVectorChanged). The
			// deadline arms a REAL timer: rendering is demand-driven, so
			// without one a hold whose answer never comes (a press core
			// answered with a rubber band, a refused move) painted the
			// object displaced until some unrelated redraw (review #2).
			if (this._lastLiveDrag) {
				this._releaseHold = {
					part: this._lastLiveDrag.part,
					override: this._lastLiveDrag.override,
					at: performance.now(),
					seq: RenderManager.getLastInputSeq(),
				};
				this._lastLiveDrag = null;
				setTimeout(() => {
					if (
						this._releaseHold &&
						performance.now() - this._releaseHold.at >=
							VectorContentSection.RELEASE_HOLD_DEADLINE_MS
					) {
						this._releaseHold = null;
						this._lastRenderKey = '';
						if (app.sectionContainer)
							app.sectionContainer.requestReDraw();
					}
				}, VectorContentSection.RELEASE_HOLD_DEADLINE_MS + 20);
			}
			if (this._releaseHold && this._releaseHold.part === part) {
				if (
					performance.now() - this._releaseHold.at <
					VectorContentSection.RELEASE_HOLD_DEADLINE_MS
				)
					return this._releaseHold.override;
				this._releaseHold = null;
			}
			return this._editGrowOverride(part);
		}

		// While TYPING grows the edited box, core's edit frame
		// (graphicselection) moves a render cycle before the re-rendered
		// text arrives, so painted glyphs hung at the old spot and then
		// jumped up ("there is a lag between the text box expanding and
		// the text shifting up as you type"). The container already
		// redraws the moment the frame moves; translating the edited
		// object's content by the frame's delta in that same draw makes
		// border and text travel together, and the authoritative render
		// then lands in the identical place. Measured: the visible
		// border-to-text gap drops from ~108ms to a frame.
		// Replacement content for a text box being live-resized: the
		// client-wrapped portions the scaling drag computed this frame,
		// scoped to the selected part's object. Empty (no wrapped lines)
		// still overrides — an empty box must not show its stale text.
		private _resizeReflowOverride(
			part: number,
		): (cool.VectorRenderOverride & { generation: number }) | null {
			const reflow = app.definitions.vulcanImpressResizeReflow;
			const ov = reflow?.getLiveOverride?.();
			if (!ov) return null;
			if (app.map._docLayer._selectedPart !== part) return null;
			const data = RenderManager.requestPart(part);
			const has = data?.objects?.some(
				(o: cool.SlideObject) => o.ordNum === ov.ordNum && !!o.bounds,
			);
			if (!has) return null;
			return {
				ordNum: ov.ordNum,
				dxTwips: 0,
				dyTwips: 0,
				primitives: ov.primitives,
				// Per-frame generation so the offscreen cache repaints
				// each new wrap (the key ignores the primitives array).
				generation: ov.generation,
			};
		}

		private _editGrowOverride(
			part: number,
		): (cool.VectorRenderOverride & { generation: number }) | null {
			if (!app.file?.textCursor?.visible) return null;
			if (app.map._docLayer._selectedPart !== part) return null;
			const rect: any = GraphicSelection.rectangle;
			const extraInfo: any = GraphicSelection.extraInfo;
			if (!rect || !extraInfo || typeof extraInfo.OrdNum !== 'number')
				return null;
			const selected = extraInfo.selectedOrdNums;
			if (Array.isArray(selected) && selected.length > 1) return null;
			const data = RenderManager.requestPart(part);
			const obj = data?.objects?.find(
				(o: cool.SlideObject) =>
					o.ordNum === extraInfo.OrdNum && !!o.bounds,
			);
			if (!obj) return null;
			const dx = rect.x1 - obj.bounds[0];
			const dy = rect.y1 - obj.bounds[1];
			if (dx === 0 && dy === 0) return null;
			// Growth recenters by fractions of a line; anything larger is
			// a stale frame that must not fling content.
			if (Math.abs(dx) > 3000 || Math.abs(dy) > 3000) return null;
			return {
				ordNum: extraInfo.OrdNum,
				dxTwips: dx,
				dyTwips: dy,
				generation: 0,
			};
		}

		private _liveDragOverride(
			part: number,
		): (cool.VectorRenderOverride & { generation: number }) | null {
			if (!this.containerObject.isDraggingSomething()) return null;
			if (app.map._docLayer._selectedPart !== part) return null;

			// A drag that STARTED on the selected object targets the
			// handles section and carries its measured distance.
			const handles = GraphicSelection.handlesSection;
			if (handles && this.containerObject.targetSection === handles.name) {
				const extraInfo: any = GraphicSelection.extraInfo;
				if (!extraInfo || typeof extraInfo.OrdNum !== 'number')
					return null;
				const distance = handles.sectionProperties.lastDragDistance;
				if (!distance || (distance[0] === 0 && distance[1] === 0))
					return null;
				// Magnetized: content rides the same guide the frame and
				// the drop land on.
				const magnet = handles.snappedDragDelta
					? handles.snappedDragDelta()
					: [0, 0];
				// A multi-selection moves every member together: the
				// override names them all (the frame already follows) —
				// without this the members sat still and teleported at
				// the drop.
				const selected = extraInfo.selectedOrdNums;
				const members: number[] | undefined =
					Array.isArray(selected) && selected.length > 1
						? selected.filter((n: any) => typeof n === 'number')
						: undefined;
				return {
					ordNum: extraInfo.OrdNum,
					ordNums: members,
					dxTwips: (distance[0] + magnet[0]) * app.pixelsToTwips,
					dyTwips: (distance[1] + magnet[1]) * app.pixelsToTwips,
					generation: 0,
				};
			}

			// Select-and-drag in ONE gesture: the press hit an unselected
			// object (the select echo recorded which), the drag targets
			// tiles/overlay, and core is moving that object. The marquee
			// window section - armed on exactly these presses - measures
			// the travel.
			const target = this.containerObject.targetSection;
			if (!VulcanImpressSelectEcho.isDocumentPressTarget(target))
				return null;
			// A page object, or one member of an entered group (the
			// group's ordNum plus the member's ordinal: only that
			// member's subtree translates).
			const identity = VulcanImpressSelectEcho.getPressHitIdentity(part);
			if (identity === null) return null;
			const ordNum = identity.ordNum;
			const marquee: any = this.containerObject.getSectionWithName(
				app.CSections.VulcanImpressMarquee.name,
			);
			const travel = marquee?.getDragTravelPx?.();
			if (!travel || (travel[0] === 0 && travel[1] === 0)) return null;
			// The owned gesture's magnet, once its selection has landed:
			// content, frame and drop share the guide.
			const magnet = VulcanImpressSelectEcho.getGestureMagnetPx();
			return {
				ordNum: ordNum,
				childOrdNum: identity.childOrdNum,
				dxTwips: (travel[0] + magnet[0]) * app.pixelsToTwips,
				dyTwips: (travel[1] + magnet[1]) * app.pixelsToTwips,
				generation: 0,
			};
		}

		// The page chrome the tile path gets from core's own paint: a
		// hairline page border and a soft drop shadow under the slide
		// (border rgb(148,149,153) and the ~3 px shadow ramp sampled off
		// the tile render, so the two paths keep pixel parity on the
		// slide edges). Deliberately NO workspace fill: everything
		// outside the page stays transparent so the container's own
		// background shows through exactly as it does on the tile path —
		// a repainted gradient can never match it pixel-for-pixel (a
		// first attempt measured ~10% parity diff across every deck).
		// The slide's rectangle in section pixels, or null before the part
		// list has its size.
		private _pageRect(
			part: number,
			offsetX: number,
			offsetY: number,
			scale: number,
		): { x: number; y: number; w: number; h: number } | null {
			const partInfo = app.impress?.partList?.[part];
			if (!partInfo || !partInfo.width || !partInfo.height) return null;
			const factor = app.impress.twipsCorrection * scale;
			return {
				x: offsetX,
				y: offsetY,
				w: partInfo.width * factor,
				h: partInfo.height * factor,
			};
		}

		private _drawPageChrome(
			context: CanvasRenderingContext2D,
			part: number,
			offsetX: number,
			offsetY: number,
			scale: number,
			_width: number,
			_height: number,
		): void {
			const page = this._pageRect(part, offsetX, offsetY, scale);
			if (!page) return;
			this._drawPageFrame(context, page.x, page.y, page.w, page.h);
		}

		// The page shadow, UNDER the content: the opaque page fill it is
		// cast from is what the vector primitives then paint over.
		private _drawPageFrame(
			context: CanvasRenderingContext2D,
			x: number,
			y: number,
			pageWidth: number,
			pageHeight: number,
		): void {
			// The host chrome's shadow language (--vulcan-glass-shadow),
			// emulated as two shadowed fills of the same opaque page rect:
			// a wide soft layer and a crisp near layer. The hairline border
			// follows the content (_drawPageOutline). Theme-aware via the
			// cached token reads; the parity harness diffs the page
			// interior, so this decoration may diverge from core's tile
			// chrome by design.
			if (HelperLineStyles.pageShadowSoftStyle === null)
				HelperLineStyles.initiate();

			// ONE recipe with the bars and the tile-lane pages: the shared
			// painter reads the same geometry tokens and emulates the bars'
			// -4px spread on the far layer.
			const g = VulcanPageShadow.read(getComputedStyle(document.documentElement));
			if (HelperLineStyles.pageShadowSoftStyle) g.soft = HelperLineStyles.pageShadowSoftStyle;
			if (HelperLineStyles.pageShadowNearStyle) g.near = HelperLineStyles.pageShadowNearStyle;
			VulcanPageShadow.paint(context, x, y, pageWidth, pageHeight, '#ffffff', g, app.dpiScale);
		}

		// The hairline, OVER the content, on the pixel column
		// TilesSection.pageOutlineStrokeRect picks -- the same rule the
		// Writer sheet and the tile-lane slides use, so the two lanes frame
		// a page identically. Outside the page where the section has a
		// column for it; on the page's own edge pixel where the slide sits
		// on the section edge, which is exactly where the contain fit
		// (VulcanImpressFit.fitRatio) puts the binding axis. That inside
		// column is why this runs after renderInto: drawn first, the slide
		// background painted over it and the fitted slide had no side edge.
		// One device pixel wide (app.roundedDpiScale, never a fractional
		// dpiScale that anti-aliases across two columns), ends on half
		// pixels.
		private _drawPageOutline(
			context: CanvasRenderingContext2D,
			x: number,
			y: number,
			pageWidth: number,
			pageHeight: number,
		): void {
			const unit = app.roundedDpiScale;
			const view = this.size
				? { left: 0, top: 0, right: this.size[0], bottom: this.size[1] }
				: { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
			const r = cool.TilesSection.pageOutlineStrokeRect(
				x, y, pageWidth, pageHeight, unit, view);
			context.save();
			context.strokeStyle =
				HelperLineStyles.pageBorderStyle || 'rgba(15, 23, 42, 0.14)';
			context.lineWidth = unit;
			context.strokeRect(r.x, r.y, r.w, r.h);
			context.restore();
		}

		private _drawFileBasedView(liveZoom: boolean): void {
			const docLayer = this._docLayer;
			const partHeightPixels = Math.round(
				(docLayer._partHeightTwips + docLayer._spaceBetweenParts) *
					app.twipsToPixels,
			);
			if (partHeightPixels <= 0) return;

			const viewedRectangle = app.activeDocument.activeLayout.viewedRectangle;
			let topVisible = Math.floor(viewedRectangle.pY1 / partHeightPixels);
			let bottomVisible = Math.ceil(
				(viewedRectangle.pY1 + viewedRectangle.pHeight) / partHeightPixels,
			);
			topVisible = Math.max(0, topVisible);
			bottomVisible = Math.min(bottomVisible, docLayer._parts - 1);

			const scale = app.twipsToPixels;
			const offsetX = -viewedRectangle.pX1;

			RenderManager.beginEditorFrame(liveZoom);
			for (let part = topVisible; part <= bottomVisible; part++) {
				const cached = RenderManager.requestPart(part);
				if (!cached) continue;

				const offsetY = -viewedRectangle.pY1 + part * partHeightPixels;

				const page = this._pageRect(part, offsetX, offsetY, scale);
				if (page)
					this._drawPageFrame(
						this.context, page.x, page.y, page.w, page.h);
				this.context.save();
				this.context.translate(offsetX, offsetY);
				this.context.scale(scale, scale);
				RenderManager.renderInto(this.context, cached, undefined, true);
				this.context.restore();
				if (page)
					this._drawPageOutline(
						this.context, page.x, page.y, page.w, page.h);
			}
		}
	}
}
