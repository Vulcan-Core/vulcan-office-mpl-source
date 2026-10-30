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

namespace cool {
	/// A function that resolves a bitmap checksum to the decoded image,
	/// or undefined when the image is not in the cache yet.
	export type BitmapLookup = (checksum: number) => HTMLImageElement | undefined;

	interface AffineMatrix {
		a: number;
		b: number;
		c: number;
		d: number;
		e: number;
		f: number;
	}

	/// Device pixels, x1 and y1 exclusive.
	interface DeviceBox {
		x0: number;
		y0: number;
		x1: number;
		y1: number;
	}

	/// Composites land on the whole device pixel (ix, iy); `local` keeps the
	/// translation's fraction, quantized to 1/_SUBPIXEL px (qx, qy). Boxes
	/// are relative to (ix, iy).
	interface CompositePlacement {
		ix: number;
		iy: number;
		qx: number;
		qy: number;
		local: AffineMatrix;
		full: DeviceBox;
		needed: DeviceBox;
	}

	/// What a node's composite depends on besides the node (_compositeKey).
	interface CompositeKey {
		exact: string;
		mode: string;
	}

	interface CompositeEntry {
		key: string;
		mode: string;
		local: AffineMatrix;
		full: DeviceBox;
		area: DeviceBox;
		canvas: HTMLCanvasElement;
		pixels: number;
		tree: object | null;
		frame: number;
		/// A composite drawn into it during a live zoom may have been a scaled
		/// stand-in, so the first frame after remakes it.
		live: boolean;
	}

	/// Renders JSON primitives with Canvas 2D drawing operations.
	export class VectorPrimitiveRenderer {
		private _bitmapLookup: BitmapLookup | undefined;
		// Slide size in twips. The background primitive fills this rectangle.
		private _slideWidth = 0;
		private _slideHeight = 0;

		/// Whether this render is the EDITOR's view: edit-view-only
		/// content (the prompt text of empty placeholders) paints there
		/// and nowhere else — previews and the slideshow leave it out,
		/// like core's own views do.
		private _editView = false;
		/// An ink probe: core's hit test ignores shadows.
		private _hitTest = false;
		/// A member drag inside an entered group: while the group's
		/// primitives render, the objectChild node with this ordinal (an
		/// IMMEDIATE member) is drawn translated, its siblings in place.
		private _childOverride: {
			ordNum: number;
			dxTwips: number;
			dyTwips: number;
		} | null = null;
		private _childDepth = 0;
		private _composites: Map<Primitive, CompositeEntry> = new Map();
		private _compositePixels = 0;
		private static readonly _COMPOSITE_PIXEL_BUDGET = 16_000_000;
		private _frame = 0;
		private _liveZoom = false;
		/// Finer steps split one scroll position in two under Firefox's
		/// float32 matrices.
		private static readonly _SUBPIXEL = 64;
		private static readonly _FULL_RANGE_PIXELS = 4_000_000;
		/// The longest canvas side every browser makes.
		private static readonly _CANVAS_SIDE = 32_767;
		private static readonly _WINDOW_MARGIN = 256;
		private readonly _cacheComposites: boolean;
		private _tree: object | null = null;
		/// Inside a replace layer, its colour: core renders a mask through the
		/// colour modifiers in force, so a transparence inside takes the
		/// luminance of its mask drawn in this colour.
		private _replaceColor: string | null = null;
		/// Shared by every renderer: the image under a checksum never changes.
		/// null: the image cannot be read back.
		private static readonly _drawModeImages = new WeakMap<
			object,
			Map<string, HTMLCanvasElement | null>
		>();
		/// A parsed tree never changes, so per-node results are memoized.
		private static readonly _childDrawCounts = new WeakMap<Primitive, number>();
		private static readonly _textReaches = new WeakMap<Primitive, number>();
		private static readonly _TEXT_REACH_EM = 0.2;
		private static _filterWorks: boolean | undefined;
		constructor(
			bitmapLookup?: BitmapLookup,
			options: { cacheComposites?: boolean } = {},
		) {
			this._bitmapLookup = bitmapLookup;
			this._cacheComposites = options.cacheComposites !== false;
		}
		/// An image or a font arrived, or the document reloaded: any of them
		/// can change what a subtree draws, so every composite is dropped.
		noteResourcesChanged(): void {
			for (const entry of this._composites.values())
				VectorPrimitiveRenderer._release(entry.canvas);
			this._composites.clear();
			this._compositePixels = 0;
		}
		/// Call before each frame of the editor's view, which can render several
		/// trees. A composite drawn in the frame is not evicted within it. While
		/// `liveZoom` holds, a kept composite made at another scale is drawn
		/// scaled instead of remade; the first frame after remakes it.
		beginFrame(liveZoom: boolean): void {
			this._frame++;
			this._liveZoom = liveZoom;
		}
		/// Call before rendering a tree: composites made from here on belong to
		/// it (forgetTree).
		beginTree(tree: { slideWidth: number; slideHeight: number }): void {
			this.setSlideBounds(tree.slideWidth, tree.slideHeight);
			this._tree = tree;
		}
		/// Frees now, not at eviction, the composites of a tree that will not
		/// be drawn again.
		forgetTree(tree: object): void {
			for (const [node, entry] of this._composites)
				if (entry.tree === tree) this._dropComposite(node, entry);
		}
		setEditView(editView: boolean): void {
			this._editView = editView;
		}
		setHitTest(hitTest: boolean): void {
			this._hitTest = hitTest;
		}
		setChildOverride(
			override: { ordNum: number; dxTwips: number; dyTwips: number } | null,
		): void {
			this._childOverride = override;
			this._childDepth = 0;
		}

		/// Set the slide size in twips before rendering a primitive tree, so the
		/// background fills the slide and leaves the area around it untouched.
		setSlideBounds(width: number, height: number): void {
			this._slideWidth = width;
			this._slideHeight = height;
		}

		renderPrimitive(
			context: CanvasRenderingContext2D,
			primitive: Primitive,
		): void {
			if (!primitive || !primitive.type) return;

			switch (primitive.type) {
				case BackgroundColorPrimitive.type:
					this._renderBackgroundColor(
						context,
						primitive as BackgroundColorPrimitive,
					);
					break;
				case PolyPolygonColorPrimitive.type:
				case PolyPolygonRGBAPrimitive.type:
					this._renderPolyPolygonColor(
						context,
						primitive as PolyPolygonRGBAPrimitive,
					);
					break;
				case PolygonStrokePrimitive.type:
				case PolyPolygonStrokePrimitive.type:
					this._renderPolygonStroke(
						context,
						primitive as PolygonStrokePrimitive,
					);
					break;
				case PolygonHairlinePrimitive.type:
					this._renderPolygonHairline(
						context,
						primitive as PolygonHairlinePrimitive,
					);
					break;
				case FilledRectanglePrimitive.type:
					this._renderFilledRectangle(
						context,
						primitive as FilledRectanglePrimitive,
					);
					break;
				case LineRectanglePrimitive.type:
					this._renderLineRectangle(
						context,
						primitive as LineRectanglePrimitive,
					);
					break;
				case SingleLinePrimitive.type:
					this._renderSingleLine(context, primitive as SingleLinePrimitive);
					break;
				case PointArrayPrimitive.type:
					this._renderPointArray(context, primitive as PointArrayPrimitive);
					break;
				case BitmapPrimitive.type:
					this._renderBitmap(context, primitive as BitmapPrimitive);
					break;
				case GraphicPrimitive.type:
					this._renderGraphic(context, primitive as GraphicPrimitive);
					break;
				case TextSimplePortionPrimitive.type:
					this._renderTextSimplePortion(
						context,
						primitive as TextSimplePortionPrimitive,
					);
					break;
				case TextDecoratedPortionPrimitive.type:
					this._renderTextDecoratedPortion(
						context,
						primitive as TextDecoratedPortionPrimitive,
					);
					break;
				case SvgLinearGradientPrimitive.type:
				case SvgRadialGradientPrimitive.type:
					// One canvas gradient, never the children: the engine
					// sends none, and an older engine sent its decomposition
					// without the unitMatrix this needs, so on such an
					// engine SVG gradients paint nothing.
					VectorSvgGradient.paint(
						context,
						primitive as
							| SvgLinearGradientPrimitive
							| SvgRadialGradientPrimitive,
					);
					return;
				case GroupPrimitive.type:
				case ObjectInfoPrimitive.type:
					// Pure container - recursion into children happens
					// below for every primitive type.
					break;
				case ObjectChildPrimitive.type: {
					// A group member's subtree. The member drag override
					// translates exactly the matching immediate member;
					// nested members and siblings draw in place.
					const child = primitive as ObjectChildPrimitive;
					const override = this._childOverride;
					const translated =
						override !== null &&
						this._childDepth === 0 &&
						child.ordNum === override.ordNum;
					if (translated) {
						context.save();
						context.translate(override.dxTwips, override.dyTwips);
					}
					this._childDepth++;
					if (primitive.children)
						this._renderPrimitives(context, primitive.children);
					this._childDepth--;
					if (translated) context.restore();
					return;
				}
				case TransformPrimitive.type:
					// Children must be drawn inside the transformed
					// coordinates. The helper recurses on its own, so
					// return here to skip the recursion at the end of
					// renderPrimitive.
					this._renderTransform(context, primitive as TransformPrimitive);
					return;
				case UnifiedTransparencePrimitive.type:
					// The helper scales globalAlpha and recurses on its
					// own, so return here to skip the recursion at the
					// end of renderPrimitive.
					this._renderUnifiedTransparence(
						context,
						primitive as UnifiedTransparencePrimitive,
					);
					return;
				case ModifiedColorPrimitive.type:
					this._renderModifiedColor(
						context,
						primitive as ModifiedColorPrimitive,
					);
					return;
				case FillGradientPrimitive.type:
				case PolyPolygonAlphaGradientPrimitive.type:
					if (
						this._replaceColor !== null &&
						VectorPrimitiveRenderer._paintsAlphaNatively(
							primitive as
								| FillGradientPrimitive
								| PolyPolygonAlphaGradientPrimitive,
						)
					) {
						this._renderOwnAlpha(context, primitive.children);
						return;
					}
					break;
				case ShadowPrimitive.type:
					// Its children are a copy of the content, which is
					// painted beside it: they paint only as the shadow.
					if (!this._hitTest)
						this._renderShadow(context, primitive as ShadowPrimitive);
					return;
				case GlowPrimitive.type:
					// The halo only; the content is painted beside it.
					this._renderGlow(context, primitive as GlowPrimitive);
					return;
				case SoftEdgePrimitive.type:
					this._renderSoftEdge(context, primitive as SoftEdgePrimitive);
					return;
				case MaskPrimitive.type:
					this._renderMask(context, primitive as MaskPrimitive);
					return;
				case TransparencePrimitive.type:
					// Composites its content through its mask on its own,
					// so return to skip the recursion below.
					this._renderTransparence(context, primitive as TransparencePrimitive);
					return;
				case HiddenGeometryPrimitive.type:
					// Non-painting subtree. Return so the recursion
					// at the end of renderPrimitive does not descend
					// into the children.
					return;
				case ExclusiveEditViewPrimitive.type:
					// Edit-view-only content: painted in the editor's
					// view (the recursion below descends), skipped in
					// previews and the slideshow.
					if (!this._editView) return;
					break;
			}

			if (primitive.children)
				this._renderPrimitives(context, primitive.children);
		}

		private _renderBackgroundColor(
			context: CanvasRenderingContext2D,
			primitive: BackgroundColorPrimitive,
		): void {
			if (!primitive.color) return;

			// Fill only the slide rectangle, in the current twip transform, so
			// the workspace color shows around the slide.
			context.save();
			context.globalAlpha *= 1 - (primitive.transparency ?? 0);
			context.fillStyle = primitive.color;
			context.fillRect(0, 0, this._slideWidth, this._slideHeight);
			context.restore();
		}

		private _renderPolyPolygonColor(
			context: CanvasRenderingContext2D,
			primitive: PolyPolygonColorPrimitive | PolyPolygonRGBAPrimitive,
		): void {
			if (!primitive.path || !primitive.color) return;

			const path = new Path2D(primitive.path);
			const transparency =
				(primitive as PolyPolygonRGBAPrimitive).transparency ?? 0;
			const needsAlphaBracket = transparency > 0;

			if (needsAlphaBracket) {
				context.save();
				context.globalAlpha *= 1 - transparency;
			}
			context.fillStyle = primitive.color;
			// Even-odd, as the tiles fill every polypolygon.
			context.fill(path, 'evenodd');
			if (needsAlphaBracket) context.restore();
		}

		private _renderPolygonStroke(
			context: CanvasRenderingContext2D,
			primitive: PolygonStrokePrimitive,
		): void {
			if (!primitive.path) return;

			const line = primitive.line ?? {};
			const path = new Path2D(primitive.path);

			context.save();
			context.strokeStyle = line.color ?? '#000000';
			// The path is in document twips under a context scaled to
			// pixels, so a width is in twips too — and a twip is a
			// fraction of a pixel at any zoom. A form's checkbox border
			// (a third of a point, seven twips) was fading to light grey
			// because a clamp of "1" here was one twip, an eighth of a
			// pixel. Thin strokes are at least one device pixel wide, as
			// the PDF viewer draws them.
			context.lineWidth = Math.max(
				line.width ?? 0,
				VectorPrimitiveRenderer._devicePixelInUnits(context),
			);
			// The wire format can carry "none" and "unknown" for linejoin
			// and linecap. Canvas has no matching option, so fall back
			// to "miter" and "butt".
			context.lineJoin =
				line.linejoin === 'round' || line.linejoin === 'bevel'
					? line.linejoin
					: 'miter';
			context.lineCap =
				line.linecap === 'round' || line.linecap === 'square'
					? line.linecap
					: 'butt';
			if (primitive.stroke?.dotDashArray?.length)
				context.setLineDash(primitive.stroke.dotDashArray);
			context.stroke(path);
			context.restore();
		}

		private _renderPolygonHairline(
			context: CanvasRenderingContext2D,
			primitive: PolygonHairlinePrimitive,
		): void {
			if (!primitive.path) return;

			const path = new Path2D(primitive.path);
			context.save();
			context.strokeStyle = primitive.color ?? '#000000';
			// Hairlines render at one device pixel by definition — in the
			// context's own units, which are twips under the zoom scale.
			context.lineWidth = VectorPrimitiveRenderer._devicePixelInUnits(context);
			context.stroke(path);
			context.restore();
		}

		/// One CSS pixel, in the units the context currently draws in: the
		/// device pixel ratio over the context's scale. A hairline a single
		/// DEVICE pixel wide is half a pixel on a 2x display and paints
		/// grey; one CSS pixel is the line a browser draws for a 1px
		/// border, and what a form's checkbox border reads as.
		private static _devicePixelInUnits(context: CanvasRenderingContext2D): number {
			const transform = context.getTransform();
			const scale = Math.hypot(transform.a, transform.b);
			const ratio = (globalThis as any).devicePixelRatio || 1;
			return scale > 0 ? ratio / scale : 1;
		}

		private _renderFilledRectangle(
			context: CanvasRenderingContext2D,
			primitive: FilledRectanglePrimitive,
		): void {
			if (!primitive.bounds || primitive.bounds.length < 4) return;

			const [minX, minY, maxX, maxY] = primitive.bounds;
			context.save();
			context.fillStyle = primitive.color ?? '#000000';
			context.fillRect(minX, minY, maxX - minX, maxY - minY);
			context.restore();
		}

		private _renderLineRectangle(
			context: CanvasRenderingContext2D,
			primitive: LineRectanglePrimitive,
		): void {
			if (!primitive.bounds || primitive.bounds.length < 4) return;

			const [minX, minY, maxX, maxY] = primitive.bounds;
			context.save();
			context.strokeStyle = primitive.color ?? '#000000';
			// LineRectangle is a one-canvas-pixel outline by definition.
			context.lineWidth = 1;
			context.strokeRect(minX, minY, maxX - minX, maxY - minY);
			context.restore();
		}

		private _renderSingleLine(
			context: CanvasRenderingContext2D,
			primitive: SingleLinePrimitive,
		): void {
			const startX = primitive.startX ?? 0;
			const startY = primitive.startY ?? 0;
			const endX = primitive.endX ?? 0;
			const endY = primitive.endY ?? 0;

			context.save();
			context.strokeStyle = primitive.color ?? '#000000';
			// SingleLine renders at one canvas pixel by definition.
			context.lineWidth = 1;
			context.beginPath();
			context.moveTo(startX, startY);
			context.lineTo(endX, endY);
			context.stroke();
			context.restore();
		}

		// Maps the wire font-weight value 0..10 to a CSS font-weight
		// number. The value 0 means unknown and renders as normal.
		private static readonly _FONT_WEIGHT_CSS: Record<number, number> = {
			0: 400,
			1: 100,
			2: 200,
			3: 300,
			4: 350,
			5: 400,
			6: 500,
			7: 600,
			8: 700,
			9: 800,
			10: 900,
		};

		// Metric-compatible font pairs, both directions: the wire carries
		// whichever name core's layout resolved, and the browser may have
		// only the other half of the pair installed. Falling back to the
		// metric twin keeps browser-measured advances close to the
		// server layout that produced the dxarray. The Arial Nova entries
		// at the end are the exception, marked there.
		private static readonly _FONT_METRIC_PAIRS: Record<string, string> = {
			Calibri: 'Carlito',
			Carlito: 'Calibri',
			Cambria: 'Caladea',
			Caladea: 'Cambria',
			Arial: 'Liberation Sans',
			'Liberation Sans': 'Arial',
			Helvetica: 'Liberation Sans',
			'Times New Roman': 'Liberation Serif',
			'Liberation Serif': 'Times New Roman',
			'Courier New': 'Liberation Mono',
			'Liberation Mono': 'Courier New',
			// The URW serif twins. Every name here is one the kit resolves to
			// the twin (the image's fc-match check holds that), so the canvas
			// falls back to the face the layout used.
			'Century Schoolbook': 'C059',
			'New Century Schoolbook': 'C059',
			C059: 'Century Schoolbook',
			'Palatino Linotype': 'P052',
			'Book Antiqua': 'P052',
			Palatino: 'P052',
			P052: 'Palatino Linotype',
			'Bookman Old Style': 'URW Bookman',
			'URW Bookman': 'Bookman Old Style',
			// Georgia's twin: Gelasio's advances match Georgia's to the font
			// unit (infrastructure/vulcan-office/fonts/substitutes).
			Georgia: 'Gelasio',
			Gelasio: 'Georgia',
			// Not metric twins: the faces the kit lays the Arial Nova families
			// out in (35-vulcan-office-substitutions.conf records how close
			// each is). The canvas falls back to the same file, so a reader
			// without Arial Nova draws core's layout. A reader with it draws
			// real Nova, placed on core's advances while the run's width
			// stays inside _placementOffsets' 5% gate. One direction only: a
			// run named after a stand-in draws in the stand-in itself, which
			// the image serves.
			'Arial Nova': 'Liberation Sans',
			'Arial Nova Light': 'Roboto Light',
			'Arial Nova Cond': 'Roboto Condensed',
			'Arial Nova Cond Light': 'Roboto Condensed Light',
		};

		// The metric twin a CSS stack for `family` falls back to, if any.
		// Own keys only, so a run named "constructor" pairs with nothing.
		public static metricPair(family: string): string | undefined {
			return Object.prototype.hasOwnProperty.call(
				VectorPrimitiveRenderer._FONT_METRIC_PAIRS,
				family,
			)
				? VectorPrimitiveRenderer._FONT_METRIC_PAIRS[family]
				: undefined;
		}

		// Builds the CSS font shorthand for a text portion's attributes.
		// Shared with the speculative text echo overlay, which must
		// construct the IDENTICAL font string so echoed glyphs land on
		// the same pixels the authoritative render will use.
		public static buildCssFont(
			italic: boolean | undefined,
			weight: number | undefined,
			fontSizePx: number,
			familyname: string | undefined,
			monospaced?: boolean,
		): string {
			const style = italic ? 'italic' : 'normal';
			const cssWeight =
				VectorPrimitiveRenderer._FONT_WEIGHT_CSS[weight ?? 5] ?? 400;
			const family = familyname ?? (monospaced ? 'monospace' : 'sans-serif');
			const pair = VectorPrimitiveRenderer._FONT_METRIC_PAIRS[family];
			const generic = monospaced ? 'monospace' : 'sans-serif';
			const families = pair
				? `"${family}", "${pair}", ${generic}`
				: `"${family}", ${generic}`;
			return `${style} ${cssWeight} ${fontSizePx}px ${families}`;
		}

		// Core lays a tracked run out with its character spacing folded
		// into every advance (editeng fixed kerning), and exports the
		// value alongside the dxarray. The canvas must carry the same
		// spacing, or every measurement here is narrower than core's
		// layout by one spacing per character: the placement gate then
		// reads a tracked run as a font mismatch and draws it as one
		// unspaced string, the caret (core's) lands the accumulated
		// spacing to the right of the drawn text, and the echo's predicted
		// caret drifts the same way. Applied wherever a text run is
		// measured or drawn; a context without the property (old
		// engines, test stubs) is left alone.
		public static applyLetterSpacing(
			context: CanvasRenderingContext2D,
			letterSpacing: number | undefined,
		): void {
			if (!('letterSpacing' in context)) return;
			const spacing =
				typeof letterSpacing === 'number' && Number.isFinite(letterSpacing)
					? letterSpacing
					: 0;
			(context as any).letterSpacing = `${spacing}px`;
		}

		// The spacing a measurement on this context actually carries:
		// the primitive's, or 0 where the context cannot apply one.
		private static _appliedLetterSpacing(
			context: CanvasRenderingContext2D,
			primitive: TextSimplePortionPrimitive | TextDecoratedPortionPrimitive,
		): number {
			if (!('letterSpacing' in context)) return 0;
			const spacing = primitive.letterSpacing;
			return typeof spacing === 'number' && Number.isFinite(spacing)
				? spacing
				: 0;
		}

		// Sets up the canvas font and (when needed) the rotation
		// transform for a text primitive, and returns the drawing
		// anchor and the substring to paint. Callers must save and
		// restore the context around the call. Returns null if there
		// is nothing to draw.
		private _setupTextFrame(
			context: CanvasRenderingContext2D,
			primitive: TextSimplePortionPrimitive | TextDecoratedPortionPrimitive,
		): { x: number; y: number; fontSize: number; text: string } | null {
			if (!primitive.text) return null;
			const start = primitive.textPosition ?? 0;
			const length = primitive.textLength ?? primitive.text.length - start;
			const text = primitive.text.substring(start, start + length);
			if (!text) return null;

			const [a = 0, b = 0, c = 0, , e = 0, f = 0] = primitive.matrix ?? [];
			const fontSize = primitive.fontSize ?? 12;

			context.font = VectorPrimitiveRenderer.buildCssFont(
				primitive.italic,
				primitive.weight,
				fontSize,
				primitive.familyname,
				primitive.monospaced,
			);
			VectorPrimitiveRenderer.applyLetterSpacing(
				context,
				primitive.letterSpacing,
			);
			const rotated = b !== 0 || c !== 0;
			if (rotated) {
				// Off-diagonal matrix entries mean the run is rotated.
				// Move to the anchor first, then rotate so the text
				// draws along the rotated direction.
				context.translate(e, f);
				context.rotate(Math.atan2(b, a));
			}
			return {
				x: rotated ? 0 : e,
				y: rotated ? 0 : f,
				fontSize,
				text,
			};
		}

		// Per-character start offsets from the run anchor, or null when
		// the run should draw as one browser-metric call. Three lanes:
		//
		// 1. The resolved font's own advances agree with the server
		//    layout PER GLYPH (a metric twin): the dxarray drives
		//    placement verbatim, so kerning/justification match core's
		//    layout - echo/authoritative pixel stability.
		// 2. The TOTAL width agrees within 5% but individual glyphs
		//    deviate (a platform fallback for a missing deck font):
		//    the original advances would fuse neighbors, while one
		//    natural run drifts off core's extents (the tile render's
		//    line geometry - the parity harness measures exactly this).
		//    Each character is placed at the resolved font's own prefix
		//    width SCALED to the server total: the run keeps core's
		//    extent, spacing stays internally consistent, and the
		//    squeeze/stretch is bounded by the 5% total gate.
		// 3. The totals disagree (unrelated substitution): one
		//    internally consistent run is the better degradation.
		private static _placementOffsets(
			context: CanvasRenderingContext2D,
			primitive: TextSimplePortionPrimitive | TextDecoratedPortionPrimitive,
			text: string,
			fontSize: number,
		): number[] | null {
			const dx = primitive.dxarray;
			if (!dx || dx.length !== text.length || text.length < 2) return null;
			if (primitive.rtl) return null;
			// Surrogates: dxarray indexes UTF-16 units, astral glyphs would
			// split. Combining marks: per-unit fillText would detach the
			// mark from its base (NFD 'e'+U+0301 renders a floating accent).
			// The lint rule assumes a lone combining mark in a class is a
			// mistake; here detecting one alone is precisely the intent.
			// eslint-disable-next-line no-misleading-character-class
			if (/[\uD800-\uDFFF\u0300-\u036F]/.test(text)) return null;
			const fromDx = (): number[] => {
				const offsets: number[] = [];
				for (let i = 0; i < text.length; i++)
					offsets.push(VectorPrimitiveRenderer._dxOffset(dx, i));
				return offsets;
			};
			if (typeof context.measureText !== 'function') return fromDx();
			const total = dx[dx.length - 1];
			if (!(total > 0)) return null;
			// Core omits the character spacing after a run's LAST glyph
			// (SvxFont::QuickGetTextSize: "the last one is a nKern too
			// big"); the canvas adds it after every glyph, the last one
			// included. Measure the way core does, or a tracked run's
			// total is one spacing long and its last glyph one spacing
			// wide — a tenth of a short label, enough to read a metric
			// twin as a font mismatch.
			const trailing = VectorPrimitiveRenderer._appliedLetterSpacing(
				context,
				primitive,
			);
			const measured = context.measureText(text).width - trailing;
			if (!(measured > 0)) return null;
			if (Math.abs(measured - total) > total * 0.05) {
				// A spaced run whose declared spacing does not explain its
				// advances (a PDF's Tc / the importer's ink-width correction is
				// not in the advances' unit: a form title declared 42.5 where
				// the steps carried ~30 twips). Its advances are the truth for
				// it, provided they are at least the font's own UNSPACED run —
				// otherwise the font is simply unrelated (lane 3).
				const declared =
					typeof primitive.letterSpacing === 'number' ? primitive.letterSpacing : 0;
				const unspaced = context.measureText(text).width - text.length * trailing;
				if (declared > 0 && unspaced > 0 && total >= unspaced) return fromDx();
				return null;
			}

			// The total agreeing is not enough: a substituted fallback for a
			// missing deck font can land within 5% OVERALL while individual
			// glyphs deviate by a fifth of the font size. Metric twins stay
			// well inside this bound; unrelated fonts blow through it.
			const glyphTolerance = fontSize * 0.1;
			let perGlyphAgreement = true;
			for (let i = 0; i < text.length; i++) {
				const step = i === 0 ? dx[0] : dx[i] - dx[i - 1];
				const width =
					context.measureText(text[i]).width -
					(i === text.length - 1 ? trailing : 0);
				if (Math.abs(width - step) > glyphTolerance) {
					perGlyphAgreement = false;
					break;
				}
			}
			if (perGlyphAgreement) return fromDx();

			// Lane 2: prefix widths (kerning included) scaled to the
			// server total.
			const scale = total / measured;
			const offsets: number[] = [0];
			for (let i = 1; i < text.length; i++)
				offsets.push(context.measureText(text.slice(0, i)).width * scale);
			return offsets;
		}

		// Character start offsets from the run anchor: the dxarray's
		// i-th value is the cumulative advance to the start of
		// character i+1.
		private static _dxOffset(dx: number[], index: number): number {
			return index === 0 ? 0 : dx[index - 1];
		}

		/// A shadow paints the filled glyphs only: core makes it before it
		/// outlines them.
		private _renderTextSimplePortion(
			context: CanvasRenderingContext2D,
			primitive: TextSimplePortionPrimitive | TextDecoratedPortionPrimitive,
			shadowColor?: string,
		): void {
			context.save();
			const frame = this._setupTextFrame(context, primitive);
			if (frame) {
				context.fillStyle = shadowColor ?? primitive.fontcolor ?? '#000000';

				// Place each character at the offset the placement decision
				// chose (server advances or scaled prefix widths), so glyph
				// positions track core's text layout instead of drifting
				// with the browser font's own metrics. A null means draw
				// the run in one call, browser-metric spaced.
				const offsets = VectorPrimitiveRenderer._placementOffsets(
					context,
					primitive,
					frame.text,
					frame.fontSize,
				);
				if (offsets) {
					for (let i = 0; i < frame.text.length; i++) {
						context.fillText(
							frame.text[i],
							frame.x + offsets[i],
							frame.y,
						);
					}
				} else {
					// Browser-metric layout, but spaced so the run still ends
					// where core's advances end and the next run starts. The
					// spacing is derived from the advances, not the declared
					// field (whose unit is not the advances').
					const dx = primitive.dxarray;
					const count = frame.text.length;
					let spacing = 0;
					if (dx && dx.length === count && count > 0 && typeof context.measureText === 'function') {
						// Spacing-free: _setupTextFrame already applied the
						// declared spacing, which the canvas adds per glyph.
						const natural =
							context.measureText(frame.text).width -
							count * VectorPrimitiveRenderer._appliedLetterSpacing(context, primitive);
						spacing = Math.max(0, (dx[dx.length - 1] - natural) / count);
					}
					if (spacing > 0 && 'letterSpacing' in context)
						(context as any).letterSpacing = spacing + 'px';
					context.fillText(frame.text, frame.x, frame.y);
				}

				if (primitive.outline && shadowColor === undefined) {
					context.strokeStyle = primitive.fontcolor ?? '#000000';
					// Outline thickness scales with the font size. A one-
					// pixel stroke becomes invisible on large text.
					context.lineWidth = Math.max(1, frame.fontSize / 20);
					if (offsets) {
						for (let i = 0; i < frame.text.length; i++) {
							context.strokeText(
								frame.text[i],
								frame.x + offsets[i],
								frame.y,
							);
						}
					} else {
						context.strokeText(frame.text, frame.x, frame.y);
					}
				}
			}
			context.restore();
		}

		/// TextDecoratedPortionPrimitive2D: a character shadow is a hard
		/// shadow of the run and its lines under it, moved right and down by
		/// 1/24 of the font size. Relief replaces it, and core's hit test
		/// ignores it.
		private _renderTextDecoratedPortion(
			context: CanvasRenderingContext2D,
			primitive: TextDecoratedPortionPrimitive,
		): void {
			if (primitive.shadow && !primitive.relief && !this._hitTest) {
				const offset = (primitive.fontSize ?? 12) / 24;
				context.save();
				context.translate(offset, offset);
				this._renderDecoratedRun(
					context,
					primitive,
					VectorPrimitiveRenderer._charShadowColor(primitive.fontcolor),
				);
				context.restore();
			}
			this._renderDecoratedRun(context, primitive);
		}

		/// Black, or light grey on text whose luminance is under 8/255.
		private static _charShadowColor(fontColor = '#000000'): string {
			const [r, g, b] = [1, 3, 5].map(
				(i) => parseInt(fontColor.slice(i, i + 2), 16) / 255,
			);
			return (77 * r + 151 * g + 28 * b) / 256 < 8 / 255 ? '#c0c0c0' : '#000000';
		}

		private _renderDecoratedRun(
			context: CanvasRenderingContext2D,
			primitive: TextDecoratedPortionPrimitive,
			shadowColor?: string,
		): void {
			// Paint the text body first. The decorations draw on
			// top below.
			this._renderTextSimplePortion(context, primitive, shadowColor);

			if (!primitive.underline && !primitive.overline && !primitive.strikeout)
				return;

			context.save();
			const frame = this._setupTextFrame(context, primitive);
			if (frame) {
				// Decorations must span exactly the glyphs above them: the
				// dxarray total when per-character placement engaged (both
				// its lanes end at the server total), the browser
				// measurement when placement fell back to one run.
				const dx = primitive.dxarray;
				const width = VectorPrimitiveRenderer._placementOffsets(
					context,
					primitive,
					frame.text,
					frame.fontSize,
				)
					? (dx as number[])[frame.text.length - 1]
					: context.measureText(frame.text).width -
						VectorPrimitiveRenderer._appliedLetterSpacing(context, primitive);
				const lineWidth = Math.max(1, frame.fontSize / 20);
				const textColor = primitive.fontcolor ?? '#000000';

				const drawLine = (lineY: number, color: string): void => {
					context.strokeStyle = shadowColor ?? color;
					context.lineWidth = lineWidth;
					context.beginPath();
					context.moveTo(frame.x, lineY);
					context.lineTo(frame.x + width, lineY);
					context.stroke();
				};

				if (primitive.underline) {
					const lineY = primitive.underlineAbove
						? frame.y - frame.fontSize * 0.85
						: frame.y + frame.fontSize * 0.15;
					drawLine(lineY, primitive.underlineColor ?? textColor);
				}
				if (primitive.overline)
					drawLine(
						frame.y - frame.fontSize * 0.85,
						primitive.overlineColor ?? textColor,
					);
				if (primitive.strikeout)
					drawLine(frame.y - frame.fontSize * 0.3, textColor);
			}
			context.restore();
		}

		private _renderBitmap(
			context: CanvasRenderingContext2D,
			primitive: BitmapPrimitive,
		): void {
			this._drawRaster(context, primitive.matrix, primitive.checksum);
		}

		private _renderGraphic(
			context: CanvasRenderingContext2D,
			primitive: GraphicPrimitive,
		): void {
			// Vector graphics arrive pre-decomposed. The children are
			// already in slide coordinates, so let the post-switch
			// recursion in renderPrimitive draw them.
			if (primitive.vector) return;
			this._drawRaster(
				context,
				primitive.matrix,
				primitive.checksum,
				primitive.crop,
				primitive.rotation,
				primitive.alpha,
				primitive.mirror,
				primitive.drawMode,
			);
		}

		// Resolve the image through the checksum lookup and draw it
		// into the unit square mapped by the wire matrix. Skips when
		// the matrix is missing, no lookup is registered, the lookup
		// has no entry yet, or the image is still decoding.
		//
		// When crop is set, the source rectangle is the corresponding
		// inset region of the image in pixels, and the destination is
		// the same inset region of the unit square. The matrix was
		// sized for the original image, so insetting both rectangles
		// keeps the visible content aligned with the slide bounds.
		//
		// rotation is in tenths of a degree and rotates around the
		// centre of the unit square, which the matrix maps to the
		// centre of the image in slide space.
		//
		// alpha is a byte where 255 is opaque. Values below 255
		// scale the globalAlpha in force, scoped to the save and
		// restore around the draw.
		//
		// mirror is a bitfield: bit 0 flips horizontally, bit 1
		// flips vertically. The flip is scoped to the unit square,
		// so the cropped or rotated content lands in the same place
		// but with the chosen axes reflected.
		//
		// drawMode recolours a copy of the image as core does
		// (VectorPixelMaps.applyDrawMode); CSS filters only
		// approximate it and serve where no copy can be made.
		private _drawRaster(
			context: CanvasRenderingContext2D,
			matrix: number[] | undefined,
			checksum: number,
			crop?: GraphicPrimitive['crop'],
			rotation?: number,
			alpha?: number,
			mirror?: number,
			drawMode?: GraphicPrimitive['drawMode'],
		): void {
			if (!matrix || matrix.length < 6) return;
			if (!this._bitmapLookup) return;

			const image = this._bitmapLookup(checksum);
			if (!image) return;
			if (!image.complete) return;

			context.save();
			if (typeof alpha === 'number' && alpha < 255)
				context.globalAlpha *= alpha / 255;
			let source: HTMLImageElement | HTMLCanvasElement = image;
			if (
				drawMode === 'greys' ||
				drawMode === 'mono' ||
				drawMode === 'watermark'
			) {
				const recoloured = VectorPrimitiveRenderer._drawModeImage(
					image,
					drawMode,
				);
				if (recoloured) source = recoloured;
				else
					context.filter = VectorPrimitiveRenderer._DRAW_MODE_FILTERS[drawMode];
			}
			// The matrix maps the unit square to the image's bounds,
			// so we draw the image into the unit square and let the
			// transform place it on the slide.
			context.transform(
				matrix[0],
				matrix[1],
				matrix[2],
				matrix[3],
				matrix[4],
				matrix[5],
			);

			if (mirror) {
				// Translate to the far edge of each flipped axis so
				// the scaled image still fills the unit square.
				const mx = mirror & 1 ? -1 : 1;
				const my = mirror & 2 ? -1 : 1;
				context.translate(mx < 0 ? 1 : 0, my < 0 ? 1 : 0);
				context.scale(mx, my);
			}

			if (rotation) {
				const radians = ((rotation / 10) * Math.PI) / 180;
				context.translate(0.5, 0.5);
				context.rotate(radians);
				context.translate(-0.5, -0.5);
			}

			if (crop && (crop.left || crop.top || crop.right || crop.bottom)) {
				// Image bounds in slide units, from the matrix's two
				// column vectors.
				const imageW = Math.hypot(matrix[0], matrix[1]);
				const imageH = Math.hypot(matrix[2], matrix[3]);
				const left = (crop.left ?? 0) / imageW;
				const top = (crop.top ?? 0) / imageH;
				const right = (crop.right ?? 0) / imageW;
				const bottom = (crop.bottom ?? 0) / imageH;
				const sx = Math.round(left * image.naturalWidth);
				const sy = Math.round(top * image.naturalHeight);
				const sw = Math.round((1 - left - right) * image.naturalWidth);
				const sh = Math.round((1 - top - bottom) * image.naturalHeight);
				context.drawImage(
					source,
					sx,
					sy,
					sw,
					sh,
					left,
					top,
					1 - left - right,
					1 - top - bottom,
				);
			} else {
				context.drawImage(source, 0, 0, 1, 1);
			}
			context.restore();
		}

		private static readonly _DRAW_MODE_FILTERS: Record<
			'greys' | 'mono' | 'watermark',
			string
		> = {
			greys: 'grayscale(1)',
			mono: 'grayscale(1) contrast(1000%)',
			watermark: 'grayscale(1) brightness(1.5) opacity(0.3)',
		};

		private static _drawModeImage(
			image: HTMLImageElement,
			drawMode: 'greys' | 'mono' | 'watermark',
		): HTMLCanvasElement | null {
			const R = VectorPrimitiveRenderer;
			let copies = R._drawModeImages.get(image);
			if (!copies) {
				copies = new Map();
				R._drawModeImages.set(image, copies);
			}
			const known = copies.get(drawMode);
			if (known !== undefined) return known;
			const width = image.naturalWidth;
			const height = image.naturalHeight;
			if (!(width > 0 && height > 0)) return null;
			if (width * height > R._COMPOSITE_PIXEL_BUDGET) return null;
			const copy = R._scratch(width, height, true);
			if (!copy) return null;
			let pixels: ImageData;
			try {
				copy.ctx.drawImage(image, 0, 0);
				pixels = copy.ctx.getImageData(0, 0, width, height);
			} catch {
				R._release(copy.canvas);
				copies.set(drawMode, null);
				return null;
			}
			VectorPixelMaps.applyDrawMode(pixels.data, drawMode);
			copy.ctx.putImageData(pixels, 0, 0);
			const plain = R._plainCopy(copy.canvas);
			copies.set(drawMode, plain);
			return plain;
		}

		private _renderPointArray(
			context: CanvasRenderingContext2D,
			primitive: PointArrayPrimitive,
		): void {
			if (!primitive.points?.length) return;

			context.save();
			context.fillStyle = primitive.color ?? '#000000';
			for (const point of primitive.points)
				context.fillRect(point.x, point.y, 1, 1);
			context.restore();
		}

		private _renderTransform(
			context: CanvasRenderingContext2D,
			primitive: TransformPrimitive,
		): void {
			const matrix = primitive.matrix;
			const hasMatrix = matrix !== undefined && matrix.length >= 6;

			if (hasMatrix) {
				context.save();
				context.transform(
					matrix[0],
					matrix[1],
					matrix[2],
					matrix[3],
					matrix[4],
					matrix[5],
				);
			}

			if (primitive.children)
				this._renderPrimitives(context, primitive.children);

			if (hasMatrix) context.restore();
		}

		private _renderModifiedColor(
			context: CanvasRenderingContext2D,
			primitive: ModifiedColorPrimitive,
		): void {
			const children = primitive.children;
			if (!children) return;
			const R = VectorPrimitiveRenderer;
			// The engine omits an empty range; an older engine never sends
			// one.
			const range =
				primitive.range && primitive.range.length >= 4
					? primitive.range
					: undefined;
			const modifier = primitive.modifier;
			if (modifier === 'replace') {
				// An EMF/WMF force-black raster op: core paints the subtree in
				// one colour, keeping coverage and alpha. Core applies the
				// innermost modifier first, so an enclosing replace decides a
				// nested mask's colour.
				const color = primitive.color;
				const layered =
					range &&
					color &&
					this._renderLayer(context, primitive, range, {
						children,
						replaceColor: this._replaceColor ?? color,
						colour: color,
					});
				if (!layered) this._renderPrimitives(context, children);
				return;
			}
			let filter: string;
			switch (modifier) {
				case 'gray':
					filter = 'grayscale(1)';
					break;
				case 'luminance_to_alpha':
					// Core's grey is 1 - luminance (white turns black, so an
					// SVG mask's white leaves its content opaque).
					filter = 'grayscale(1) invert(1)';
					break;
				case 'invert':
					filter = 'invert(1)';
					break;
				default:
					this._renderPrimitives(context, children);
					return;
			}
			// By hand where canvas filters do nothing (Safari before 18), and
			// for gray everywhere: CSS grayscale weighs green 0.7152, core
			// 151/256. Mapping the layer equals mapping each draw: each map
			// is affine on straight colour and leaves alpha alone.
			if (
				range &&
				(modifier === 'gray' || !R._canvasFilterWorks()) &&
				this._renderLayer(context, primitive, range, {
					children,
					replaceColor: this._replaceColor,
					pixels: ({ data }) =>
						VectorPixelMaps.applyColorModifier(data, modifier),
				})
			)
				return;
			context.save();
			context.filter = filter;
			this._renderPrimitives(context, children);
			context.restore();
		}

		/// Probed by drawing: Safari before 18 ignores `filter` but keeps the
		/// assignment as a plain property, so reading it back proves nothing.
		private static _canvasFilterWorks(): boolean {
			const R = VectorPrimitiveRenderer;
			if (R._filterWorks === undefined) {
				const probe = R._scratch(1, 1, true);
				if (!probe) return true;
				probe.ctx.filter = 'invert(1)';
				probe.ctx.fillStyle = '#000000';
				probe.ctx.fillRect(0, 0, 1, 1);
				R._filterWorks = probe.ctx.getImageData(0, 0, 1, 1).data[0] > 127;
				R._release(probe.canvas);
			}
			return R._filterWorks;
		}

		/// Whether core paints a fill's alpha gradient as one RGBA gradient
		/// rather than through the transparence its decomposition holds
		/// (CairoPixelProcessor2D::processFillGradientPrimitive2D and
		/// processPolyPolygonAlphaGradientPrimitive2D).
		private static _paintsAlphaNatively(
			node: FillGradientPrimitive | PolyPolygonAlphaGradientPrimitive,
		): boolean {
			// A fill's alpha gradient shares its colour gradient's geometry;
			// without one its decomposition holds no transparence.
			const gradient =
				node.type === FillGradientPrimitive.type
					? node.gradient
					: node.alphaGradient;
			if (!gradient) return false;
			const style = gradient.style;
			if (
				node.type === PolyPolygonAlphaGradientPrimitive.type &&
				(style === 'square' || style === 'rect')
			)
				return false;
			if ((gradient.border ?? 0) >= 1) return true;
			return (
				!gradient.steps &&
				(style === 'linear' ||
					style === 'axial' ||
					style === 'radial' ||
					style === 'elliptical')
			);
		}

		/// Inside a replace or a shadow, core recolours a native alpha
		/// gradient's stops and keeps their alpha, so the transparence in its
		/// decomposition takes its mask in its own colours.
		private _renderOwnAlpha(
			context: CanvasRenderingContext2D,
			children: Primitive[] | undefined,
		): void {
			if (!children) return;
			const outer = this._replaceColor;
			this._replaceColor = null;
			try {
				this._renderPrimitives(context, children);
			} finally {
				this._replaceColor = outer;
			}
		}

		private static _recolour(
			target: CanvasRenderingContext2D,
			width: number,
			height: number,
			color: string,
		): void {
			target.save();
			target.globalCompositeOperation = 'source-in';
			target.fillStyle = color;
			target.fillRect(0, 0, width, height);
			target.restore();
		}

		private _renderUnifiedTransparence(
			context: CanvasRenderingContext2D,
			primitive: UnifiedTransparencePrimitive,
		): void {
			const children = primitive.children;
			if (!children) return;
			context.save();
			// Canvas globalAlpha uses the opposite convention to the
			// wire transparence: 1 is opaque on the canvas, 0 on the
			// wire. Invert the value to translate. It scales the alpha
			// in force: the tiles paint each transparence as a group
			// with its alpha, so nested ones multiply.
			context.globalAlpha *= 1 - (primitive.transparence ?? 0);
			// Children that make two or more draws can overlap: as the tiles
			// do, they paint into one layer at full opacity, drawn once under
			// the group's alpha, so an overlap does not paint twice.
			const range = primitive.range;
			const layered =
				range &&
				range.length >= 4 &&
				VectorPrimitiveRenderer._childDraws(primitive) >= 2 &&
				this._renderLayer(context, primitive, range, {
					children,
					replaceColor: this._replaceColor,
				});
			if (!layered) this._renderPrimitives(context, children);
			context.restore();
		}

		/// Ports ShadowPrimitive2D: the subtree under the shadow matrix in the
		/// shadow colour, a blur through vcl's stack blur (VectorEffects). The
		/// enclosing unifiedTransparence gives it its transparency. Without a
		/// range or a layer it paints nothing, never the content in place.
		private _renderShadow(
			context: CanvasRenderingContext2D,
			primitive: ShadowPrimitive,
		): void {
			const children = primitive.children;
			const range = primitive.range;
			const matrix = primitive.matrix;
			const color = primitive.color;
			if (
				!children?.length ||
				!range ||
				range.length < 4 ||
				!matrix ||
				matrix.length < 6 ||
				!color
			)
				return;
			const blur = primitive.blur ?? 0;
			if (!(blur > 0)) {
				// Core paints it through a replace modifier, so a
				// transparence inside takes its mask in the shadow colour.
				this._renderLayer(context, primitive, range, {
					children,
					matrix,
					replaceColor: this._replaceColor ?? color,
					colour: color,
				});
				return;
			}
			// At the node: the shadow matrix's scale does not scale the
			// blur. Core paints nothing below one pixel.
			const deviceBlur = VectorPrimitiveRenderer._devicePixels(context, blur);
			if (!(deviceBlur >= 1)) return;
			const r = VectorEffects.blurRadius(deviceBlur);
			// Core blurs the alpha of the content painted black. The range
			// grows the content's by the blur before the matrix moves it, so
			// a matrix that shrinks the shadow leaves it short of the blur.
			this._renderLayer(context, primitive, range, {
				children,
				matrix,
				replaceColor: '#000000',
				grow: r,
				reach: r,
				pixels: ({ data, width, height }) => {
					const alpha = VectorPixelMaps.alphaOf(data);
					VectorEffects.stackBlur(alpha, width, height, r);
					VectorPixelMaps.setAlpha(data, alpha);
				},
				colour: color,
			});
		}

		/// Ports GlowPrimitive2D: the silhouette (any alpha counts) dilated by
		/// half the radius at the glow colour's opacity, blurred by half the
		/// radius, in the glow colour. Nothing below one pixel.
		private _renderGlow(
			context: CanvasRenderingContext2D,
			primitive: GlowPrimitive,
		): void {
			const children = primitive.children;
			const range = primitive.range;
			const color = primitive.color;
			if (!children?.length || !range || range.length < 4 || !color) return;
			const radius = VectorPrimitiveRenderer._devicePixels(
				context,
				primitive.radius ?? 0,
			);
			if (!(radius >= 1)) return;
			const half = Math.floor(radius / 2);
			const r = VectorEffects.blurRadius(half);
			const transparency = Math.round((primitive.transparency ?? 0) * 255);
			const opacity = 255 - Math.min(255, Math.max(0, transparency));
			// Core takes the silhouette from the content painted black.
			this._renderLayer(context, primitive, range, {
				children,
				replaceColor: '#000000',
				reach: half + r,
				pixels: ({ data, width, height }) => {
					const alpha = VectorPixelMaps.alphaOf(data);
					VectorEffects.binarize(alpha);
					VectorEffects.dilateSquare(alpha, width, height, half);
					for (let i = 0; i < alpha.length; i++)
						if (alpha[i] === 255) alpha[i] = opacity;
					VectorEffects.stackBlur(alpha, width, height, r);
					VectorPixelMaps.setAlpha(data, alpha);
				},
				colour: color,
			});
		}

		/// Ports SoftEdgePrimitive2D: the alpha times the silhouette (any alpha
		/// counts) eroded and blurred by the radius. Below one pixel, as in
		/// core, the subtree paints as it is.
		private _renderSoftEdge(
			context: CanvasRenderingContext2D,
			primitive: SoftEdgePrimitive,
		): void {
			const children = primitive.children;
			if (!children?.length) return;
			const range = primitive.range;
			const radius = VectorPrimitiveRenderer._devicePixels(
				context,
				primitive.radius ?? 0,
			);
			const r = VectorEffects.blurRadius(radius);
			// Core renders the content on its own, outside any colour
			// modifier in force, so a mask inside keeps its colours.
			const painted =
				range &&
				range.length >= 4 &&
				radius >= 1 &&
				this._renderLayer(context, primitive, range, {
					children,
					replaceColor: null,
					reach: radius + r,
					pixels: ({ data, width, height }) => {
						const mask = VectorPixelMaps.alphaOf(data);
						VectorEffects.binarize(mask);
						VectorEffects.erodeSquare(mask, width, height, radius);
						VectorEffects.stackBlur(mask, width, height, r);
						// AlphaMask::BlendWith: the product, truncated.
						for (let i = 0; i < mask.length; i++)
							data[i * 4 + 3] = Math.floor((data[i * 4 + 3] * mask[i]) / 255);
					},
				});
			if (!painted) this._renderPrimitives(context, children);
		}

		/// A length in the node's units as device pixels, rounded up as core
		/// rounds an effect's radius.
		private static _devicePixels(
			context: CanvasRenderingContext2D,
			length: number,
		): number {
			const t = context.getTransform();
			return Math.ceil(length * Math.hypot(t.a, t.b));
		}

		/// False where no layer can be made or read back: the caller falls
		/// back.
		private _renderLayer(
			context: CanvasRenderingContext2D,
			node: Primitive,
			range: number[],
			layer: {
				children: Primitive[];
				matrix?: number[];
				replaceColor: string | null;
				grow?: number;
				reach?: number;
				pixels?: (pixels: ImageData) => void;
				colour?: string;
			},
		): boolean {
			const R = VectorPrimitiveRenderer;
			const placement = R._placement(
				context,
				R._layerRange(node, range),
				layer.grow,
				layer.reach,
			);
			if (!placement) return true;
			const key = this._compositeKey(placement);
			if (this._drawKeptComposite(context, node, key, placement)) return true;

			const area = this._compositeArea(placement);
			const width = area.x1 - area.x0;
			const height = area.y1 - area.y0;
			const readBack = layer.pixels !== undefined;
			const scratch = R._scratch(width, height, readBack);
			if (!scratch) return false;
			const outer = this._replaceColor;
			this._replaceColor = layer.replaceColor;
			try {
				this._paintLayer(
					scratch.ctx,
					placement.local,
					area,
					layer.children,
					layer.matrix,
				);
			} finally {
				this._replaceColor = outer;
			}
			if (layer.pixels) {
				const pixels = R._readLayer(scratch.ctx, width, height);
				if (!pixels) {
					R._release(scratch.canvas);
					return false;
				}
				layer.pixels(pixels);
				scratch.ctx.putImageData(pixels, 0, 0);
			}
			if (layer.colour !== undefined)
				R._recolour(scratch.ctx, width, height, layer.colour);
			this._placeComposite(
				context,
				node,
				key,
				placement,
				area,
				scratch.canvas,
				readBack,
			);
			return true;
		}

		/// Null where a drawn image tainted the layer.
		private static _readLayer(
			layer: CanvasRenderingContext2D,
			width: number,
			height: number,
		): ImageData | null {
			try {
				return layer.getImageData(0, 0, width, height);
			} catch {
				return null;
			}
		}

		private static _childDraws(node: Primitive): number {
			const R = VectorPrimitiveRenderer;
			let count = R._childDrawCounts.get(node);
			if (count === undefined) {
				count = 0;
				for (const child of node.children || []) {
					count = Math.min(2, count + R._drawsOf(child));
					if (count === 2) break;
				}
				R._childDrawCounts.set(node, count);
			}
			return count;
		}

		private static _drawsOf(node: Primitive): number {
			let own = 0;
			switch (node.type) {
				case HiddenGeometryPrimitive.type:
					return 0;
				case TransparencePrimitive.type:
					return 1;
				case UnifiedTransparencePrimitive.type:
					// Two or more draw through one layer.
					return Math.min(1, VectorPrimitiveRenderer._childDraws(node));
				case BackgroundColorPrimitive.type:
				case PolyPolygonColorPrimitive.type:
				case PolyPolygonRGBAPrimitive.type:
				case PolygonStrokePrimitive.type:
				case PolyPolygonStrokePrimitive.type:
				case PolygonHairlinePrimitive.type:
				case FilledRectanglePrimitive.type:
				case LineRectanglePrimitive.type:
				case SingleLinePrimitive.type:
				case BitmapPrimitive.type:
					own = 1;
					break;
				case SvgLinearGradientPrimitive.type:
				case SvgRadialGradientPrimitive.type:
					// One fill; the children never paint.
					return 1;
				case ShadowPrimitive.type:
				case GlowPrimitive.type:
					// One composite; the children never paint in place.
					return Math.min(1, VectorPrimitiveRenderer._childDraws(node));
				case PointArrayPrimitive.type:
					// One fillRect per point, and points can coincide.
					own = Math.min(2, (node as PointArrayPrimitive).points?.length ?? 0);
					break;
				case GraphicPrimitive.type:
					own = (node as GraphicPrimitive).vector ? 0 : 1;
					break;
				case TextSimplePortionPrimitive.type:
				case TextDecoratedPortionPrimitive.type: {
					// A run placed glyph by glyph counts once: neighbouring
					// glyphs barely overlap.
					const text = node as TextDecoratedPortionPrimitive;
					own =
						1 +
						(text.outline ? 1 : 0) +
						(text.underline || text.overline || text.strikeout ? 1 : 0) +
						(text.shadow && !text.relief ? 1 : 0);
					break;
				}
			}
			return node.children && node.children.length
				? own + VectorPrimitiveRenderer._childDraws(node)
				: own;
		}

		private static _layerRange(node: Primitive, range: number[]): number[] {
			const reach = VectorPrimitiveRenderer._textReach(node);
			return reach > 0
				? [
						range[0] - reach,
						range[1] - reach,
						range[2] + reach,
						range[3] + reach,
					]
				: range;
		}

		/// Core's range of a run holds its own decorations, placed from the
		/// font's metrics; the client draws them and an outline at fixed
		/// fractions of the font size, which can pass that range by up to
		/// _TEXT_REACH_EM for common fonts.
		private static _textReach(node: Primitive): number {
			const R = VectorPrimitiveRenderer;
			let reach = R._textReaches.get(node);
			if (reach === undefined) {
				reach = 0;
				if (
					node.type === TextSimplePortionPrimitive.type ||
					node.type === TextDecoratedPortionPrimitive.type
				) {
					const text = node as TextDecoratedPortionPrimitive;
					if (text.outline || text.underline || text.overline || text.strikeout)
						reach = R._TEXT_REACH_EM * (text.fontSize ?? 12);
				}
				for (const child of node.children || [])
					reach = Math.max(reach, R._textReach(child));
				const matrix = (node as TransformPrimitive | ShadowPrimitive).matrix;
				if (
					reach > 0 &&
					(node.type === TransformPrimitive.type ||
						node.type === ShadowPrimitive.type) &&
					matrix &&
					matrix.length >= 6
				)
					reach *= R._largestScale(matrix);
				if (!Number.isFinite(reach)) reach = 0;
				R._textReaches.set(node, reach);
			}
			return reach;
		}

		/// The largest singular value of m's linear part.
		private static _largestScale(m: number[]): number {
			const [a, b, c, d] = m;
			const sum = a * a + b * b + c * c + d * d;
			const det = a * d - b * c;
			return Math.sqrt(
				(sum + Math.sqrt(Math.max(0, sum * sum - 4 * det * det))) / 2,
			);
		}

		private _renderMask(
			context: CanvasRenderingContext2D,
			primitive: MaskPrimitive,
		): void {
			context.save();
			if (primitive.clip) context.clip(new Path2D(primitive.clip), 'evenodd');
			if (primitive.children)
				this._renderPrimitives(context, primitive.children);
			context.restore();
		}

		// A transparence: the content masked by the luminance of the
		// transparence subtree - black opaque, white clear, and clear where
		// the subtree paints nothing, as core lays the mask over white. An
		// SVG picture's <mask> or stop-opacity gradient, a scrim fading in
		// over a photo, a fill under a transparency gradient. Canvas has no
		// luminance mask, so both subtrees draw into scratch canvases over
		// the device pixels of the node's range, the content's alpha is
		// scaled per pixel, and the result goes back through the context's
		// own clip, alpha and filter. Where that cannot run (no scratch
		// canvas, a scratch canvas the browser will not read back), the
		// content draws unmasked.
		private _renderTransparence(
			context: CanvasRenderingContext2D,
			primitive: TransparencePrimitive,
		): void {
			const content = primitive.children;
			if (!content || !content.length) return;
			if (!primitive.transparence || !primitive.transparence.length) return;
			// The engine leaves the range out when it is empty: nothing paints.
			if (!primitive.range || primitive.range.length < 4) return;
			const placement = VectorPrimitiveRenderer._placement(
				context,
				VectorPrimitiveRenderer._layerRange(primitive, primitive.range),
			);
			if (!placement) return;
			const key = this._compositeKey(placement);
			if (this._drawKeptComposite(context, primitive, key, placement)) return;

			const area = this._compositeArea(placement);
			const width = area.x1 - area.x0;
			const height = area.y1 - area.y0;
			const layer = VectorPrimitiveRenderer._scratch(width, height, true);
			const maskLayer =
				layer && VectorPrimitiveRenderer._scratch(width, height, true);
			if (!layer || !maskLayer) {
				if (layer) VectorPrimitiveRenderer._release(layer.canvas);
				this._renderPrimitives(context, content);
				return;
			}
			this._paintLayer(layer.ctx, placement.local, area, content);
			this._paintLayer(
				maskLayer.ctx,
				placement.local,
				area,
				primitive.transparence,
			);
			// Inside a replace, core's mask renderer inherits the modifier:
			// the mask keeps its coverage and paints in the replace colour.
			if (this._replaceColor !== null)
				VectorPrimitiveRenderer._recolour(
					maskLayer.ctx,
					width,
					height,
					this._replaceColor,
				);
			const mask = VectorPrimitiveRenderer._readLayer(
				maskLayer.ctx,
				width,
				height,
			);
			const pixels =
				mask && VectorPrimitiveRenderer._readLayer(layer.ctx, width, height);
			if (!mask || !pixels) {
				VectorPrimitiveRenderer._release(layer.canvas);
				VectorPrimitiveRenderer._release(maskLayer.canvas);
				this._renderPrimitives(context, content);
				return;
			}
			VectorPrimitiveRenderer._release(maskLayer.canvas);
			VectorPixelMaps.applyLuminanceMask(pixels.data, mask.data);
			layer.ctx.putImageData(pixels, 0, 0);
			this._placeComposite(
				context,
				primitive,
				key,
				placement,
				area,
				layer.canvas,
				true,
			);
		}

		private _paintLayer(
			target: CanvasRenderingContext2D,
			local: AffineMatrix,
			area: DeviceBox,
			subtree: Primitive[],
			matrix?: number[],
		): void {
			target.save();
			target.translate(-area.x0, -area.y0);
			target.transform(local.a, local.b, local.c, local.d, local.e, local.f);
			if (matrix)
				target.transform(
					matrix[0],
					matrix[1],
					matrix[2],
					matrix[3],
					matrix[4],
					matrix[5],
				);
			this._renderPrimitives(target, subtree);
			target.restore();
		}

		private _compositeKey(placement: CompositePlacement): CompositeKey {
			const override = this._childOverride;
			const l = placement.local;
			const mode = [
				this._editView ? 1 : 0,
				this._hitTest ? 1 : 0,
				// The override moves an immediate member of the group being
				// rendered, so only a node outside every member can contain
				// it; inside one, a move is already in the transform.
				override && this._childDepth === 0
					? `${override.ordNum}:${override.dxTwips}:${override.dyTwips}`
					: '',
				this._replaceColor ?? '',
			].join(',');
			const transform = [l.a, l.b, l.c, l.d, placement.qx, placement.qy];
			return { exact: transform.join(',') + ',' + mode, mode };
		}

		/// While the zoom animates, a composite made at another transform in
		/// the same mode stands in, drawn where its pixels now land: remaking
		/// it would cost every zoom frame a read-back and, for an effect, a
		/// blur. Re-inserting it keeps the Map in least-recently-drawn order.
		private _drawKeptComposite(
			context: CanvasRenderingContext2D,
			node: Primitive,
			key: CompositeKey,
			placement: CompositePlacement,
		): boolean {
			const R = VectorPrimitiveRenderer;
			const kept = this._composites.get(node);
			if (!kept) return false;
			const exact =
				kept.key === key.exact &&
				(this._liveZoom || !kept.live) &&
				R._covers(kept.area, placement.needed);
			const stretch =
				!exact && this._liveZoom && kept.mode === key.mode
					? R._stretch(kept, placement)
					: null;
			if (stretch)
				R._drawComposite(
					context,
					kept.canvas,
					kept.area.x0,
					kept.area.y0,
					stretch,
				);
			else if (exact)
				R._drawComposite(
					context,
					kept.canvas,
					placement.ix + kept.area.x0,
					placement.iy + kept.area.y0,
				);
			else return false;
			this._composites.delete(node);
			this._composites.set(node, kept);
			kept.frame = this._frame;
			return true;
		}

		/// Null where the kept pixels do not hold what is now visible (a zoom
		/// out past a composite that covered only part of a large range).
		private static _stretch(
			kept: CompositeEntry,
			placement: CompositePlacement,
		): AffineMatrix | null {
			const R = VectorPrimitiveRenderer;
			const unplace = R._invert(kept.local);
			const map = unplace && R._multiply(placement.local, unplace);
			const unmap = map && R._invert(map);
			if (!map || !unmap) return null;
			const wanted = R._intersect(
				R._mapBox(unmap, placement.needed),
				kept.full,
			);
			if (!R._covers(kept.area, wanted)) return null;
			return { ...map, e: map.e + placement.ix, f: map.f + placement.iy };
		}

		/// m after n.
		private static _multiply(m: AffineMatrix, n: AffineMatrix): AffineMatrix {
			return {
				a: m.a * n.a + m.c * n.b,
				b: m.b * n.a + m.d * n.b,
				c: m.a * n.c + m.c * n.d,
				d: m.b * n.c + m.d * n.d,
				e: m.a * n.e + m.c * n.f + m.e,
				f: m.b * n.e + m.d * n.f + m.f,
			};
		}

		private static _invert(m: AffineMatrix): AffineMatrix | null {
			const det = m.a * m.d - m.b * m.c;
			if (!(det !== 0 && Number.isFinite(det))) return null;
			return {
				a: m.d / det,
				b: -m.b / det,
				c: -m.c / det,
				d: m.a / det,
				e: (m.c * m.f - m.d * m.e) / det,
				f: (m.b * m.e - m.a * m.f) / det,
			};
		}

		private static _mapBox(m: AffineMatrix, box: DeviceBox): DeviceBox {
			const xs: number[] = [];
			const ys: number[] = [];
			for (const [x, y] of [
				[box.x0, box.y0],
				[box.x1, box.y0],
				[box.x0, box.y1],
				[box.x1, box.y1],
			]) {
				xs.push(m.a * x + m.c * y + m.e);
				ys.push(m.b * x + m.d * y + m.f);
			}
			return {
				x0: Math.min(...xs),
				y0: Math.min(...ys),
				x1: Math.max(...xs),
				y1: Math.max(...ys),
			};
		}

		/// Covering more than the visible part lets a scroll reuse a kept
		/// composite; the caps keep a margin round a canvas-sized part from
		/// pushing two composites past the budget, each frame evicting the
		/// other, and a long thin range past the side a canvas can have.
		private _compositeArea(placement: CompositePlacement): DeviceBox {
			const R = VectorPrimitiveRenderer;
			if (!this._cacheComposites) return placement.needed;
			if (R._keepable(placement.full)) return placement.full;
			const grown = R._intersect(
				R._grow(placement.needed, R._WINDOW_MARGIN),
				placement.full,
			);
			return R._keepable(grown) ? grown : placement.needed;
		}

		private static _keepable(box: DeviceBox): boolean {
			const R = VectorPrimitiveRenderer;
			return (
				R._pixels(box) <= R._FULL_RANGE_PIXELS &&
				box.x1 - box.x0 <= R._CANVAS_SIDE &&
				box.y1 - box.y0 <= R._CANVAS_SIDE
			);
		}

		/// A kept composite made for read-back is copied into a plain canvas:
		/// WebKit draws a read-back canvas far slower, and a kept one is drawn
		/// every frame.
		private _placeComposite(
			context: CanvasRenderingContext2D,
			node: Primitive,
			key: CompositeKey,
			placement: CompositePlacement,
			area: DeviceBox,
			canvas: HTMLCanvasElement,
			readBack: boolean,
		): void {
			const R = VectorPrimitiveRenderer;
			const pixels = canvas.width * canvas.height;
			const keep = this._cacheComposites && this._makeRoom(node, pixels);
			const drawn = keep && readBack ? R._plainCopy(canvas) : canvas;
			R._drawComposite(
				context,
				drawn,
				placement.ix + area.x0,
				placement.iy + area.y0,
			);
			if (!keep) {
				R._release(drawn);
				return;
			}
			this._composites.set(node, {
				key: key.exact,
				mode: key.mode,
				local: placement.local,
				full: placement.full,
				area,
				canvas: drawn,
				pixels,
				tree: this._tree,
				frame: this._frame,
				live: this._liveZoom,
			});
			this._compositePixels += pixels;
		}

		/// Frees a scratch canvas's backing store now rather than at GC:
		/// WebKit caps the total, and getContext returns null past it.
		private static _release(canvas: HTMLCanvasElement): void {
			canvas.width = 0;
			canvas.height = 0;
		}

		private static _plainCopy(canvas: HTMLCanvasElement): HTMLCanvasElement {
			const plain = VectorPrimitiveRenderer._scratch(
				canvas.width,
				canvas.height,
				false,
			);
			if (!plain) return canvas;
			plain.ctx.drawImage(canvas, 0, 0);
			VectorPrimitiveRenderer._release(canvas);
			return plain.canvas;
		}

		/// A composite is already in device pixels, placed through the
		/// caller's whole transform (a nudge echo's translate included), so it
		/// is drawn at the identity or under `stretch`; the caller's clip,
		/// alpha and filter still apply.
		private static _drawComposite(
			context: CanvasRenderingContext2D,
			canvas: HTMLCanvasElement,
			x: number,
			y: number,
			stretch?: AffineMatrix,
		): void {
			context.save();
			context.setTransform(1, 0, 0, 1, 0, 0);
			if (stretch)
				context.transform(
					stretch.a,
					stretch.b,
					stretch.c,
					stretch.d,
					stretch.e,
					stretch.f,
				);
			context.drawImage(canvas, x, y);
			context.restore();
		}

		/// Never evicts a composite drawn this frame: frames draw their nodes
		/// in the same order, so once a frame needs more than the budget,
		/// evicting an earlier one would evict the next one needed and every
		/// frame would remake every composite.
		private _makeRoom(node: Primitive, pixels: number): boolean {
			const budget = VectorPrimitiveRenderer._COMPOSITE_PIXEL_BUDGET;
			const old = this._composites.get(node);
			if (old) this._dropComposite(node, old);
			if (pixels > budget) return false;
			for (const [other, entry] of this._composites) {
				if (this._compositePixels + pixels <= budget) break;
				if (entry.frame !== this._frame) this._dropComposite(other, entry);
			}
			return this._compositePixels + pixels <= budget;
		}

		private _dropComposite(node: Primitive, entry: CompositeEntry): void {
			this._compositePixels -= entry.pixels;
			this._composites.delete(node);
			VectorPrimitiveRenderer._release(entry.canvas);
		}

		/// The translation is quantized before it is split, so 0.99999 and
		/// 0.00001 land on the same quantum instead of either side of a floor.
		private static _placement(
			context: CanvasRenderingContext2D,
			range: number[],
			grow = 0,
			reach = 0,
		): CompositePlacement | null {
			const R = VectorPrimitiveRenderer;
			const t = context.getTransform();
			const S = R._SUBPIXEL;
			const qe = Math.round(t.e * S);
			const qf = Math.round(t.f * S);
			const ix = Math.floor(qe / S);
			const iy = Math.floor(qf / S);
			const qx = qe - ix * S;
			const qy = qf - iy * S;
			const local = { a: t.a, b: t.b, c: t.c, d: t.d, e: qx / S, f: qy / S };
			const full = R._grow(R._paddedBounds(local, range), grow);
			const visible = R._intersect(full, {
				x0: -ix,
				y0: -iy,
				x1: context.canvas.width - ix,
				y1: context.canvas.height - iy,
			});
			if (!(visible.x1 > visible.x0 && visible.y1 > visible.y0)) return null;
			const needed = R._intersect(R._grow(visible, reach), full);
			return { ix, iy, qx, qy, local, full, needed };
		}

		/// Padded by half a CSS pixel: the engine's range has no view, so a
		/// hairline on its edge (one CSS pixel wide here) reaches past it.
		private static _paddedBounds(
			t: AffineMatrix,
			range: number[],
		): DeviceBox {
			const pad = Math.max(
				1,
				Math.ceil(((globalThis as any).devicePixelRatio || 1) / 2),
			);
			const box = VectorPrimitiveRenderer._mapBox(t, {
				x0: range[0],
				y0: range[1],
				x1: range[2],
				y1: range[3],
			});
			return {
				x0: Math.floor(box.x0) - pad,
				y0: Math.floor(box.y0) - pad,
				x1: Math.ceil(box.x1) + pad,
				y1: Math.ceil(box.y1) + pad,
			};
		}

		private static _intersect(a: DeviceBox, b: DeviceBox): DeviceBox {
			return {
				x0: Math.max(a.x0, b.x0),
				y0: Math.max(a.y0, b.y0),
				x1: Math.min(a.x1, b.x1),
				y1: Math.min(a.y1, b.y1),
			};
		}

		private static _grow(box: DeviceBox, margin: number): DeviceBox {
			return {
				x0: box.x0 - margin,
				y0: box.y0 - margin,
				x1: box.x1 + margin,
				y1: box.y1 + margin,
			};
		}

		private static _covers(outer: DeviceBox, inner: DeviceBox): boolean {
			return (
				outer.x0 <= inner.x0 &&
				outer.y0 <= inner.y0 &&
				outer.x1 >= inner.x1 &&
				outer.y1 >= inner.y1
			);
		}

		private static _pixels(box: DeviceBox): number {
			return (box.x1 - box.x0) * (box.y1 - box.y0);
		}

		private static _scratch(
			width: number,
			height: number,
			readBack: boolean,
		): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
			if (typeof document === 'undefined') return null;
			const canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			const ctx = readBack
				? canvas.getContext('2d', { willReadFrequently: true })
				: canvas.getContext('2d');
			return ctx ? { canvas, ctx } : null;
		}

		private _renderPrimitives(
			context: CanvasRenderingContext2D,
			primitives: Primitive[],
		): void {
			for (const primitive of primitives) {
				this.renderPrimitive(context, primitive);
			}
		}
	}
}
