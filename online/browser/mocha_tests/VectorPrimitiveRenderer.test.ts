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

describe('VectorPrimitiveRenderer', function () {
	// The renderer constructs new Path2D and new Image. Stand-ins
	// capture the constructor arguments and let the renderer treat
	// the resulting object as a ready resource.
	let originalPath2D: any;
	let originalImage: any;

	before(function () {
		originalPath2D = (globalThis as any).Path2D;
		(globalThis as any).Path2D = Path2DRecorder;
		originalImage = (globalThis as any).Image;
		(globalThis as any).Image = ImageRecorder;
	});

	after(function () {
		(globalThis as any).Path2D = originalPath2D;
		(globalThis as any).Image = originalImage;
	});

	// Each fixture is a single primitive built with the drawinglayer
	// primitive constructor, so we can test the primitive in isolation.
	describe('Primitive references', function () {
		it('fills the slide rectangle for backgroundcolor', function () {
			const primitive = loadVectorRenderingReference('testBackgroundColor').primitives[0];
			nodeassert.strictEqual(primitive.type, 'backgroundcolor');
			nodeassert.strictEqual(typeof primitive.color, 'string');

			const recorder = new CanvasRecorder(200, 150);
			const renderer = new cool.VectorPrimitiveRenderer();
			// Slide smaller than the canvas: the fill must follow the slide,
			// leaving the surrounding area for the workspace color.
			renderer.setSlideBounds(120, 90);
			renderer.renderPrimitive(recorder as any, primitive);

			const fillRect = recorder.findCall('fillRect');
			nodeassert.ok(fillRect, 'fillRect not called');
			nodeassert.deepStrictEqual(fillRect.args, [0, 0, 120, 90]);
			nodeassert.strictEqual(recorder.properties.fillStyle, primitive.color);
			// The background fill must not leak its canvas state to
			// anything drawn after it.
			nodeassert.ok(recorder.findCall('save'), 'save not called');
			nodeassert.ok(recorder.findCall('restore'), 'restore not called');
		});

		it('respects backgroundcolor transparency', function () {
			const primitive = loadVectorRenderingReference(
				'testBackgroundColorTransparent',
			).primitives[0];
			nodeassert.strictEqual(primitive.type, 'backgroundcolor');
			nodeassert.strictEqual(typeof primitive.transparency, 'number');
			nodeassert.ok(primitive.transparency > 0, 'fixture must be partly transparent');

			const recorder = new CanvasRecorder();
			const renderer = new cool.VectorPrimitiveRenderer();
			renderer.renderPrimitive(recorder as any, primitive);

			nodeassert.strictEqual(recorder.properties.fillStyle, primitive.color);
			nodeassert.strictEqual(
				recorder.properties.globalAlpha,
				1 - primitive.transparency,
			);
		});

		it('renders polyPolygonColor with its fill colour', function () {
			const primitive = loadVectorRenderingReference('testPolyPolygonColor').primitives[0];
			nodeassert.strictEqual(primitive.type, 'polyPolygonColor');
			nodeassert.strictEqual(typeof primitive.color, 'string');
			nodeassert.strictEqual(typeof primitive.path, 'string');

			const recorder = new CanvasRecorder();
			const renderer = new cool.VectorPrimitiveRenderer();
			renderer.renderPrimitive(recorder as any, primitive);

			const fillCall = recorder.findCall('fill');
			nodeassert.ok(fillCall, 'fill not called');
			nodeassert.strictEqual(recorder.properties.fillStyle, primitive.color);
			nodeassert.strictEqual(fillCall.args.length, 2);
			nodeassert.strictEqual(
				(fillCall.args[0] as Path2DRecorder).path,
				primitive.path,
			);
			nodeassert.strictEqual(fillCall.args[1], 'evenodd');
		});

		it('applies transparency to polyPolygonRGBA at fill time', function () {
			// polyPolygonRGBA paints with its colour and respects the
			// optional transparency. The alpha must apply only to this
			// primitive and not leak to anything drawn after.
			const primitive = loadVectorRenderingReference(
				'testPolyPolygonRGBAPrimitive',
			).primitives[0];
			nodeassert.strictEqual(primitive.type, 'polyPolygonRGBA');
			nodeassert.strictEqual(typeof primitive.color, 'string');
			nodeassert.strictEqual(typeof primitive.transparency, 'number');
			nodeassert.ok(primitive.transparency > 0, 'fixture must be partly transparent');

			const recorder = new CanvasRecorder();
			const renderer = new cool.VectorPrimitiveRenderer();
			renderer.renderPrimitive(recorder as any, primitive);

			const fill = recorder.findCall('fill');
			nodeassert.ok(fill, 'fill not called');
			nodeassert.strictEqual(fill?.properties.fillStyle, primitive.color);
			nodeassert.strictEqual(
				fill?.properties.globalAlpha,
				1 - primitive.transparency,
			);
			nodeassert.strictEqual(
				(fill?.args[0] as Path2DRecorder).path,
				primitive.path,
			);
			nodeassert.ok(recorder.findCall('save'), 'save not called');
			nodeassert.ok(recorder.findCall('restore'), 'restore not called');
		});

		it('strokes a Path2D for polygonStroke', function () {
			const primitive = loadVectorRenderingReference('testPolygonStroke').primitives[0];
			nodeassert.strictEqual(primitive.type, 'polygonStroke');
			nodeassert.strictEqual(typeof primitive.path, 'string');
			nodeassert.strictEqual(typeof primitive.line?.color, 'string');
			nodeassert.strictEqual(typeof primitive.line?.width, 'number');

			const recorder = new CanvasRecorder();
			const renderer = new cool.VectorPrimitiveRenderer();
			renderer.renderPrimitive(recorder as any, primitive);

			const stroke = recorder.findCall('stroke');
			nodeassert.ok(stroke, 'stroke not called');
			// Use the per-call snapshot so we see the stroke properties
			// as they were when the renderer drew this primitive, not
			// whatever state another primitive left behind.
			nodeassert.strictEqual(stroke?.properties.strokeStyle, primitive.line.color);
			nodeassert.strictEqual(stroke?.properties.lineWidth, primitive.line.width);
			nodeassert.strictEqual(stroke?.properties.lineJoin, primitive.line.linejoin);
			nodeassert.strictEqual(stroke?.properties.lineCap, primitive.line.linecap);
			nodeassert.ok(stroke && stroke.depth > 0, 'stroke must be inside save/restore');
			nodeassert.strictEqual(
				(stroke?.args[0] as Path2DRecorder).path,
				primitive.path,
			);
		});

		it('applies dotDashArray for polygonStroke', function () {
			const primitive = loadVectorRenderingReference(
				'testPolygonStrokeDashed',
			).primitives[0];
			nodeassert.strictEqual(primitive.type, 'polygonStroke');
			nodeassert.ok(
				Array.isArray(primitive.stroke?.dotDashArray),
				'fixture must carry a dotDashArray',
			);

			const recorder = new CanvasRecorder();
			const renderer = new cool.VectorPrimitiveRenderer();
			renderer.renderPrimitive(recorder as any, primitive);

			const setLineDash = recorder.findCall('setLineDash');
			nodeassert.ok(setLineDash, 'setLineDash not called');
			nodeassert.deepStrictEqual(setLineDash.args, [primitive.stroke.dotDashArray]);
		});

		it('renders polyPolygonStroke as one stroked path', function () {
			// polyPolygonStroke ships an SVG-D path that describes
			// more than one disjoint subpath. The whole thing strokes
			// in a single canvas call.
			const primitive = loadVectorRenderingReference(
				'testPolyPolygonStroke',
			).primitives[0];
			nodeassert.strictEqual(primitive.type, 'polyPolygonStroke');
			nodeassert.strictEqual(typeof primitive.path, 'string');
			nodeassert.strictEqual(typeof primitive.line?.color, 'string');

			const recorder = new CanvasRecorder();
			const renderer = new cool.VectorPrimitiveRenderer();
			renderer.renderPrimitive(recorder as any, primitive);

			const stroke = recorder.findCall('stroke');
			nodeassert.ok(stroke, 'stroke not called');
			nodeassert.strictEqual(recorder.countOf('stroke'), 1);
			nodeassert.strictEqual(stroke?.properties.strokeStyle, primitive.line.color);
			nodeassert.strictEqual(
				(stroke?.args[0] as Path2DRecorder).path,
				primitive.path,
			);
		});

		it('clips a mask\'s children to its path', function () {
			// mask carries a clip path and a child subtree.
			const primitive = loadVectorRenderingReference('testMask').primitives[0];
			nodeassert.strictEqual(primitive.type, 'mask');
			nodeassert.strictEqual(typeof primitive.clip, 'string');
			nodeassert.strictEqual(primitive.children.length, 1);

			const recorder = new CanvasRecorder();
			const renderer = new cool.VectorPrimitiveRenderer();
			renderer.renderPrimitive(recorder as any, primitive);

			// The clip is applied once with the wire path.
			const clip = recorder.findCall('clip');
			nodeassert.ok(clip, 'clip not called');
			nodeassert.strictEqual(recorder.countOf('clip'), 1);
			nodeassert.strictEqual(
				(clip?.args[0] as Path2DRecorder).path,
				primitive.clip,
			);
			// Even-odd, so disjoint subpaths in the clip behave the
			// same way as in the source path.
			nodeassert.strictEqual(clip?.args[1], 'evenodd');

			// The single child draws once and the canvas state is
			// balanced around it.
			nodeassert.strictEqual(recorder.countOf('fill'), 1);
			nodeassert.ok(recorder.findCall('save'), 'save not called');
			nodeassert.ok(recorder.findCall('restore'), 'restore not called');
		});

		it('renders textSimplePortion at the matrix anchor', function () {
			// textSimplePortion paints text in the requested font and
			// colour at the matrix anchor. The substring offsets pick
			// out part of the carried text.
			const primitive = loadVectorRenderingReference(
				'testTextSimplePortion',
			).primitives[0];
			nodeassert.strictEqual(primitive.type, 'textSimplePortion');
			nodeassert.strictEqual(primitive.text, 'Hello');
			nodeassert.strictEqual(primitive.textPosition, 0);
			nodeassert.strictEqual(primitive.textLength, 5);

			const recorder = new CanvasRecorder();
			const renderer = new cool.VectorPrimitiveRenderer();
			renderer.renderPrimitive(recorder as any, primitive);

			const fillText = recorder.findCall('fillText');
			nodeassert.ok(fillText, 'fillText not called');
			nodeassert.strictEqual(fillText?.args[0], 'Hello');
			// The anchor (translation components of the matrix) lands
			// in args[1] and args[2].
			nodeassert.strictEqual(fillText?.args[1], primitive.matrix[4]);
			nodeassert.strictEqual(fillText?.args[2], primitive.matrix[5]);
			// The fillStyle at the call matches the wire fontcolor.
			nodeassert.strictEqual(fillText?.properties.fillStyle, primitive.fontcolor);
			// The font string carries the wire fontSize and family.
			nodeassert.ok(
				fillText?.properties.font.includes(`${primitive.fontSize}px`),
				'font string missing fontSize',
			);
			nodeassert.ok(
				fillText?.properties.font.includes(primitive.familyname),
				'font string missing family',
			);
		});

		it('draws underline and strikeout for textDecoratedPortion', function () {
			// textDecoratedPortion paints the same text as the simple
			// portion and adds underline, overline and strikeout lines
			// on top. Each decoration is one stroke at the right
			// vertical offset from the text anchor.
			const primitive = loadVectorRenderingReference(
				'testTextDecoratedPortion',
			).primitives[0];
			nodeassert.strictEqual(primitive.type, 'textDecoratedPortion');
			nodeassert.ok(primitive.underline > 0, 'fixture must have underline');
			nodeassert.ok(primitive.strikeout > 0, 'fixture must have strikeout');

			const recorder = new CanvasRecorder();
			const renderer = new cool.VectorPrimitiveRenderer();
			renderer.renderPrimitive(recorder as any, primitive);

			// Text is still drawn.
			nodeassert.ok(recorder.findCall('fillText'), 'fillText not called');

			// One decoration stroke per decoration. The fixture sets
			// underline and strikeout, so we expect two strokes.
			const strokes = recorder.callsOf('stroke');
			nodeassert.strictEqual(strokes.length, 2);

			// The fixture paints both decorations in black, so each
			// stroke uses that colour.
			for (const stroke of strokes)
				nodeassert.strictEqual(stroke.properties.strokeStyle, '#000000');

			// Both decoration lines are horizontal: each moveTo and
			// lineTo share a y coordinate.
			const moveTos = recorder.callsOf('moveTo');
			const lineTos = recorder.callsOf('lineTo');
			nodeassert.strictEqual(moveTos.length, 2);
			nodeassert.strictEqual(lineTos.length, 2);
			for (let i = 0; i < 2; i++)
				nodeassert.strictEqual(moveTos[i].args[1], lineTos[i].args[1]);
		});

		it('renders a bitmap at its declared bounds', function () {
			// bitmap maps the unit square (0,0)-(1,1) to its display
			// bounds through the wire matrix. The image content comes
			// from a checksum lookup populated by a separate fetch.
			const primitive = loadVectorRenderingReference('testBitmap').primitives[0];
			nodeassert.strictEqual(primitive.type, 'bitmap');
			nodeassert.strictEqual(typeof primitive.checksum, 'number');
			nodeassert.strictEqual(primitive.matrix.length, 6);

			const cachedImage = new ImageRecorder();
			const recorder = new CanvasRecorder();
			const renderer = new cool.VectorPrimitiveRenderer((checksum) =>
				checksum === primitive.checksum
					? (cachedImage as unknown as HTMLImageElement)
					: undefined,
			);
			renderer.renderPrimitive(recorder as any, primitive);

			// The matrix is applied to the context.
			const transform = recorder.findCall('transform');
			nodeassert.ok(transform, 'transform not called');
			nodeassert.strictEqual(transform.args.length, 6);
			for (let i = 0; i < 6; i++)
				nodeassert.strictEqual(transform.args[i], primitive.matrix[i]);

			// The image from the lookup is drawn into the unit square.
			const draw = recorder.findCall('drawImage');
			nodeassert.ok(draw, 'drawImage not called');
			nodeassert.strictEqual(draw.args[0], cachedImage);
			nodeassert.deepStrictEqual(draw.args.slice(1), [0, 0, 1, 1]);

			// The transform stays scoped to this primitive.
			nodeassert.ok(recorder.findCall('save'), 'save not called');
			nodeassert.ok(recorder.findCall('restore'), 'restore not called');
		});

		it('renders a raster graphic like a bitmap', function () {
			// A raster graphic carries a matrix and a checksum. The
			// renderer resolves the image through the same checksum
			// lookup as a bitmap and draws it into the unit square.
			const primitive = loadVectorRenderingReference('testGraphic')
				.primitives[0];
			nodeassert.strictEqual(primitive.type, 'graphic');
			nodeassert.strictEqual(primitive.vector, undefined);
			nodeassert.strictEqual(typeof primitive.checksum, 'number');
			nodeassert.strictEqual(primitive.matrix.length, 6);

			const cachedImage = new ImageRecorder();
			const recorder = new CanvasRecorder();
			const renderer = new cool.VectorPrimitiveRenderer((checksum) =>
				checksum === primitive.checksum
					? (cachedImage as unknown as HTMLImageElement)
					: undefined,
			);
			renderer.renderPrimitive(recorder as any, primitive);

			const transform = recorder.findCall('transform');
			nodeassert.ok(transform, 'transform not called');
			for (let i = 0; i < 6; i++)
				nodeassert.strictEqual(transform.args[i], primitive.matrix[i]);

			const draw = recorder.findCall('drawImage');
			nodeassert.ok(draw, 'drawImage not called');
			nodeassert.strictEqual(draw.args[0], cachedImage);
			nodeassert.deepStrictEqual(draw.args.slice(1), [0, 0, 1, 1]);
		});

		it('renders an SVG-backed graphic through the raster path', function () {
			// The engine's SVG branch emits the same wire shape as a
			// raster graphic. The renderer treats the primitive the
			// same way and resolves the image through the checksum
			// lookup.
			const primitive = loadVectorRenderingReference('testGraphicSvg')
				.primitives[0];
			nodeassert.strictEqual(primitive.type, 'graphic');
			nodeassert.strictEqual(primitive.vector, undefined);
			nodeassert.strictEqual(typeof primitive.checksum, 'number');
			nodeassert.strictEqual(primitive.matrix.length, 6);

			const cachedImage = new ImageRecorder();
			const recorder = new CanvasRecorder();
			const renderer = new cool.VectorPrimitiveRenderer((checksum) =>
				checksum === primitive.checksum
					? (cachedImage as unknown as HTMLImageElement)
					: undefined,
			);
			renderer.renderPrimitive(recorder as any, primitive);

			const draw = recorder.findCall('drawImage');
			nodeassert.ok(draw, 'drawImage not called');
			nodeassert.strictEqual(draw.args[0], cachedImage);
			nodeassert.deepStrictEqual(draw.args.slice(1), [0, 0, 1, 1]);
		});

		it('descends into a vector graphic instead of drawing it', function () {
			// An EMF-backed graphic arrives pre-decomposed. The
			// renderer must not call drawImage. It descends into the
			// children instead, so at least one canvas operation
			// comes from inside the subtree.
			const primitive = loadVectorRenderingReference('testGraphicEmf')
				.primitives[0];
			nodeassert.strictEqual(primitive.type, 'graphic');
			nodeassert.strictEqual(primitive.vector, true);
			nodeassert.ok(Array.isArray(primitive.children));
			nodeassert.ok(primitive.children.length > 0);

			const recorder = new CanvasRecorder();
			const renderer = new cool.VectorPrimitiveRenderer();
			renderer.renderPrimitive(recorder as any, primitive);

			nodeassert.strictEqual(
				recorder.findCall('drawImage'),
				undefined,
				'drawImage should not be called for a vector graphic',
			);
			nodeassert.ok(
				recorder.calls.length > 0,
				'expected the children subtree to produce canvas calls',
			);
		});

		it('applies the alpha attribute as globalAlpha', function () {
			// alpha is a byte where 255 is opaque. The renderer sets
			// globalAlpha to alpha / 255 inside the save/restore
			// scope, so the value does not leak to anything drawn
			// after this primitive.
			const primitive = loadVectorRenderingReference('testGraphicAlpha')
				.primitives[0];
			nodeassert.strictEqual(primitive.type, 'graphic');
			nodeassert.strictEqual(typeof primitive.alpha, 'number');
			nodeassert.ok(primitive.alpha < 255, 'fixture must be partly transparent');

			const cachedImage = new ImageRecorder();
			const recorder = new CanvasRecorder();
			const renderer = new cool.VectorPrimitiveRenderer((checksum) =>
				checksum === primitive.checksum
					? (cachedImage as unknown as HTMLImageElement)
					: undefined,
			);
			renderer.renderPrimitive(recorder as any, primitive);

			const draw = recorder.findCall('drawImage');
			nodeassert.ok(draw, 'drawImage not called');
			nodeassert.strictEqual(
				draw.properties.globalAlpha,
				primitive.alpha / 255,
			);
			nodeassert.ok(recorder.findCall('save'), 'save not called');
			nodeassert.ok(recorder.findCall('restore'), 'restore not called');
		});

		it('flips a mirrored graphic along the requested axes', function () {
			// mirror is a bitfield: bit 0 flips horizontally, bit 1
			// flips vertically. The renderer translates to the far
			// edge of each flipped axis, then scales by -1 on that
			// axis so the image still fills the unit square.
			const primitive = loadVectorRenderingReference('testGraphicMirror')
				.primitives[0];
			nodeassert.strictEqual(primitive.type, 'graphic');
			nodeassert.strictEqual(primitive.mirror, 3);

			const cachedImage = new ImageRecorder();
			const recorder = new CanvasRecorder();
			const renderer = new cool.VectorPrimitiveRenderer((checksum) =>
				checksum === primitive.checksum
					? (cachedImage as unknown as HTMLImageElement)
					: undefined,
			);
			renderer.renderPrimitive(recorder as any, primitive);

			// With both axes flipped, the translate goes to (1, 1)
			// and the scale is (-1, -1).
			const translate = recorder.findCall('translate');
			nodeassert.ok(translate, 'translate not called');
			nodeassert.deepStrictEqual(translate.args, [1, 1]);

			const scale = recorder.findCall('scale');
			nodeassert.ok(scale, 'scale not called');
			nodeassert.deepStrictEqual(scale.args, [-1, -1]);

			const draw = recorder.findCall('drawImage');
			nodeassert.ok(draw, 'drawImage not called');
			nodeassert.strictEqual(draw.args[0], cachedImage);
		});

		it('recolours a graphic through a CSS filter for drawMode', function () {
			// jsdom has no canvas, so this takes the CSS filter fallback.
			const primitive = loadVectorRenderingReference('testGraphicDrawMode')
				.primitives[0];
			nodeassert.strictEqual(primitive.type, 'graphic');
			nodeassert.strictEqual(primitive.drawMode, 'greys');

			const cachedImage = new ImageRecorder();
			const recorder = new CanvasRecorder();
			const renderer = new cool.VectorPrimitiveRenderer((checksum) =>
				checksum === primitive.checksum
					? (cachedImage as unknown as HTMLImageElement)
					: undefined,
			);
			renderer.renderPrimitive(recorder as any, primitive);

			const draw = recorder.findCall('drawImage');
			nodeassert.ok(draw, 'drawImage not called');
			nodeassert.strictEqual(draw.properties.filter, 'grayscale(1)');
		});

		it('draws only the cropped portion of a graphic', function () {
			// A graphic with crop attributes is drawn with a source
			// rectangle inset by the crop fractions of the image's
			// natural pixel size, into a destination rectangle inset
			// by the same fractions of the unit square. The crop
			// fractions come from dividing the wire crop (in slide
			// units) by the matrix-derived image size.
			const primitive = loadVectorRenderingReference('testGraphicCrop')
				.primitives[0];
			nodeassert.strictEqual(primitive.type, 'graphic');
			nodeassert.ok(primitive.crop, 'crop missing');
			nodeassert.strictEqual(typeof primitive.checksum, 'number');

			const cachedImage = new ImageRecorder();
			const recorder = new CanvasRecorder();
			const renderer = new cool.VectorPrimitiveRenderer((checksum) =>
				checksum === primitive.checksum
					? (cachedImage as unknown as HTMLImageElement)
					: undefined,
			);
			renderer.renderPrimitive(recorder as any, primitive);

			const draw = recorder.findCall('drawImage');
			nodeassert.ok(draw, 'drawImage not called');
			nodeassert.strictEqual(
				draw.args.length,
				9,
				'expected the 9-argument drawImage form',
			);

			const m = primitive.matrix;
			const imageW = Math.hypot(m[0], m[1]);
			const imageH = Math.hypot(m[2], m[3]);
			const left = (primitive.crop.left || 0) / imageW;
			const top = (primitive.crop.top || 0) / imageH;
			const right = (primitive.crop.right || 0) / imageW;
			const bottom = (primitive.crop.bottom || 0) / imageH;

			const expectedSx = Math.round(left * 100);
			const expectedSy = Math.round(top * 100);
			const expectedSw = Math.round((1 - left - right) * 100);
			const expectedSh = Math.round((1 - top - bottom) * 100);

			nodeassert.strictEqual(draw.args[0], cachedImage);
			nodeassert.strictEqual(draw.args[1], expectedSx);
			nodeassert.strictEqual(draw.args[2], expectedSy);
			nodeassert.strictEqual(draw.args[3], expectedSw);
			nodeassert.strictEqual(draw.args[4], expectedSh);
			nodeassert.strictEqual(draw.args[5], left);
			nodeassert.strictEqual(draw.args[6], top);
			nodeassert.strictEqual(draw.args[7], 1 - left - right);
			nodeassert.strictEqual(draw.args[8], 1 - top - bottom);
		});

		it('rotates a graphic around the centre of the unit square', function () {
			// The wire rotation is in tenths of a degree. The
			// renderer translates to the centre of the unit square,
			// rotates by that angle in radians, then translates back,
			// so the rotation pivots around the image's centre after
			// the matrix maps it onto the slide.
			const primitive = loadVectorRenderingReference('testGraphicRotation')
				.primitives[0];
			nodeassert.strictEqual(primitive.type, 'graphic');
			nodeassert.strictEqual(typeof primitive.rotation, 'number');
			nodeassert.strictEqual(typeof primitive.checksum, 'number');

			const cachedImage = new ImageRecorder();
			const recorder = new CanvasRecorder();
			const renderer = new cool.VectorPrimitiveRenderer((checksum) =>
				checksum === primitive.checksum
					? (cachedImage as unknown as HTMLImageElement)
					: undefined,
			);
			renderer.renderPrimitive(recorder as any, primitive);

			// Two translates frame a single rotate, with the centre
			// of the unit square as the pivot.
			const translates = recorder.callsOf('translate');
			nodeassert.strictEqual(translates.length, 2);
			nodeassert.deepStrictEqual(translates[0].args, [0.5, 0.5]);
			nodeassert.deepStrictEqual(translates[1].args, [-0.5, -0.5]);

			const rotate = recorder.findCall('rotate');
			nodeassert.ok(rotate, 'rotate not called');
			const expectedRadians = ((primitive.rotation / 10) * Math.PI) / 180;
			nodeassert.strictEqual(rotate.args[0], expectedRadians);

			// The image is still drawn into the unit square. The
			// rotation lives in the canvas transform.
			const draw = recorder.findCall('drawImage');
			nodeassert.ok(draw, 'drawImage not called');
			nodeassert.strictEqual(draw.args[0], cachedImage);
			nodeassert.deepStrictEqual(draw.args.slice(1), [0, 0, 1, 1]);
		});


		it('paints each point of a pointArray', function () {
			// pointArray lays down a single-pixel mark at every point,
			// all in the same colour.
			const primitive = loadVectorRenderingReference('testPointArray').primitives[0];
			nodeassert.strictEqual(primitive.type, 'pointArray');
			nodeassert.strictEqual(typeof primitive.color, 'string');
			nodeassert.ok(Array.isArray(primitive.points));

			const recorder = new CanvasRecorder();
			const renderer = new cool.VectorPrimitiveRenderer();
			renderer.renderPrimitive(recorder as any, primitive);

			const fills = recorder.callsOf('fillRect');
			nodeassert.strictEqual(fills.length, primitive.points.length);
			for (let i = 0; i < primitive.points.length; i++) {
				nodeassert.deepStrictEqual(fills[i].args, [
					primitive.points[i].x,
					primitive.points[i].y,
					1,
					1,
				]);
				nodeassert.strictEqual(fills[i].properties.fillStyle, primitive.color);
			}
		});

		it('renders a group\'s children in order', function () {
			// A group node carries no drawing of its own. The renderer
			// must descend into the children in order.
			const primitive = loadVectorRenderingReference('testGroup').primitives[0];
			nodeassert.strictEqual(primitive.type, 'group');
			nodeassert.ok(Array.isArray(primitive.children));
			nodeassert.strictEqual(primitive.children.length, 2);

			const recorder = new CanvasRecorder();
			const renderer = new cool.VectorPrimitiveRenderer();
			renderer.renderPrimitive(recorder as any, primitive);

			// One fill, one stroke, in that order. The group itself
			// contributes nothing.
			nodeassert.strictEqual(recorder.countOf('fill'), 1);
			nodeassert.strictEqual(recorder.countOf('stroke'), 1);
			const fillIndex = recorder.calls.findIndex((c) => c.method === 'fill');
			const strokeIndex = recorder.calls.findIndex((c) => c.method === 'stroke');
			nodeassert.ok(
				fillIndex >= 0 && strokeIndex > fillIndex,
				'fill should be recorded before stroke',
			);
		});

		it('handles an empty group without drawing anything', function () {
			const primitive = loadVectorRenderingReference('testGroupEmpty').primitives[0];
			nodeassert.strictEqual(primitive.type, 'group');
			nodeassert.strictEqual(primitive.children.length, 0);

			const recorder = new CanvasRecorder();
			const renderer = new cool.VectorPrimitiveRenderer();
			renderer.renderPrimitive(recorder as any, primitive);

			nodeassert.strictEqual(recorder.calls.length, 0);
			nodeassert.deepStrictEqual(recorder.properties, {});
		});

		it('renders children under the transform\'s matrix', function () {
			// The transform primitive applies an affine matrix to its
			// child subtree. Children render under the transformed
			// coordinates and must not affect anything drawn after.
			const primitive = loadVectorRenderingReference('testTransform').primitives[0];
			nodeassert.strictEqual(primitive.type, 'transform');
			nodeassert.strictEqual(primitive.matrix.length, 6);
			nodeassert.strictEqual(primitive.children.length, 1);

			const recorder = new CanvasRecorder();
			const renderer = new cool.VectorPrimitiveRenderer();
			renderer.renderPrimitive(recorder as any, primitive);

			// The fixture is a 30-degree rotation around the origin.
			const transform = recorder.findCall('transform');
			nodeassert.ok(transform, 'transform not called');
			nodeassert.strictEqual(recorder.countOf('transform'), 1);
			const cos30 = Math.cos(Math.PI / 6);
			const sin30 = Math.sin(Math.PI / 6);
			const expected = [cos30, sin30, -sin30, cos30, 0, 0];
			nodeassert.strictEqual(transform.args.length, expected.length);
			// The wire ships the matrix as fixed-precision strings, so
			// the last digit can differ from Math.cos/Math.sin by a
			// floating-point ulp. Allow a small tolerance per element.
			for (let i = 0; i < expected.length; i++)
				nodeassert.ok(
					Math.abs(transform.args[i] - expected[i]) < 1e-12,
					`matrix[${i}] expected ~${expected[i]}, got ${transform.args[i]}`,
				);

			// Anything drawn after the transform must not carry its matrix.
			nodeassert.ok(recorder.findCall('save'), 'save not called');
			nodeassert.ok(recorder.findCall('restore'), 'restore not called');
			nodeassert.strictEqual(transform.depth, 1);

			// The single child renders exactly once.
			nodeassert.strictEqual(recorder.countOf('fill'), 1);
		});

		it('skips hiddenGeometry entirely', function () {
			// hiddenGeometry is non-painting. Nothing is drawn,
			// even when a children array is present.
			const primitive = loadVectorRenderingReference('testHiddenGeometry').primitives[0];
			nodeassert.strictEqual(primitive.type, 'hiddenGeometry');

			const recorder = new CanvasRecorder();
			const renderer = new cool.VectorPrimitiveRenderer();
			renderer.renderPrimitive(recorder as any, primitive);

			nodeassert.strictEqual(
				recorder.calls.length,
				0,
				'hiddenGeometry must not produce any draw calls',
			);
			nodeassert.deepStrictEqual(recorder.properties, {});
		});

		it('renders objectInfo\'s children while exposing its metadata', function () {
			// objectInfo wraps a subtree with metadata: name, title and
			// description. The metadata travels on the wire alongside
			// the children.
			const primitive = loadVectorRenderingReference('testObjectInfoPrimitive').primitives[0];
			nodeassert.strictEqual(primitive.type, 'objectInfo');
			nodeassert.strictEqual(typeof primitive.name, 'string');
			nodeassert.strictEqual(typeof primitive.title, 'string');
			nodeassert.strictEqual(typeof primitive.desc, 'string');
			nodeassert.strictEqual(primitive.children.length, 1);

			const recorder = new CanvasRecorder();
			const renderer = new cool.VectorPrimitiveRenderer();
			renderer.renderPrimitive(recorder as any, primitive);

			// Exactly one child fill, matching the wrapped triangle.
			nodeassert.strictEqual(recorder.countOf('fill'), 1);
		});

		it('applies the wire transparence to the children for unifiedTransparence', function () {
			// unifiedTransparence carries one transparency value in
			// [0, 1] where 0 is fully opaque. The children draw with
			// (1 - transparence) as the canvas alpha, and the alpha
			// does not leak past the subtree.
			const primitive =
				loadVectorRenderingReference('testUnifiedTransparence').primitives[0];
			nodeassert.strictEqual(primitive.type, 'unifiedTransparence');
			const transparence: number = parseFloat(primitive.transparence);
			nodeassert.ok(
				transparence > 0 && transparence < 1,
				'fixture must be partly transparent',
			);

			const recorder = new CanvasRecorder();
			const renderer = new cool.VectorPrimitiveRenderer();
			renderer.renderPrimitive(recorder as any, primitive);

			// Use the per-call snapshot so we see the alpha as it was
			// when the child drew, not whatever the recorder saw last.
			const fill = recorder.findCall('fill');
			nodeassert.ok(fill, 'child fill missing');
			nodeassert.ok(
				Math.abs(fill!.properties.globalAlpha - (1 - transparence)) < 1e-9,
				'globalAlpha at fill time does not match 1 - transparence',
			);

			// Canvas state is balanced around the children.
			nodeassert.ok(recorder.findCall('save'), 'save not called');
			nodeassert.ok(recorder.findCall('restore'), 'restore not called');

			// The children render exactly once. A missing early return
			// in the dispatch would draw them again after the restore.
			nodeassert.strictEqual(recorder.countOf('fill'), 1);
		});

		it('skips exclusiveEditView entirely', function () {
			// exclusiveEditView wraps content meant only for an
			// exclusive edit view. It does not appear in the
			// view-only output.
			const primitive =
				loadVectorRenderingReference('testExclusiveEditView').primitives[0];
			nodeassert.strictEqual(primitive.type, 'exclusiveEditView');

			const recorder = new CanvasRecorder();
			const renderer = new cool.VectorPrimitiveRenderer();
			renderer.renderPrimitive(recorder as any, primitive);

			nodeassert.strictEqual(
				recorder.calls.length,
				0,
				'exclusiveEditView must not produce any draw calls',
			);
			nodeassert.deepStrictEqual(recorder.properties, {});
		});

		it('paints exclusiveEditView children in the editor view only', function () {
			// The prompt text of an empty placeholder ("Click to add
			// Title") rides under exclusiveEditView: the editor paints
			// it like the tile view does, previews and the slideshow
			// (the default) leave it out.
			const primitive: any = {
				type: 'exclusiveEditView',
				children: [{ type: 'backgroundcolor', color: '#ff0000' }],
			};
			const skipped = new CanvasRecorder();
			const renderer = new cool.VectorPrimitiveRenderer();
			renderer.setSlideBounds(1000, 800);
			renderer.renderPrimitive(skipped as any, primitive);
			nodeassert.strictEqual(skipped.calls.length, 0);

			const painted = new CanvasRecorder();
			renderer.setEditView(true);
			renderer.renderPrimitive(painted as any, primitive);
			nodeassert.ok(painted.calls.length > 0, 'edit view paints the children');
			renderer.setEditView(false);
			const again = new CanvasRecorder();
			renderer.renderPrimitive(again as any, primitive);
			nodeassert.strictEqual(again.calls.length, 0);
		});

		it('translates ONE objectChild member under a member override', function () {
			// A member drag inside an entered group: the matching
			// immediate member's subtree draws translated, its sibling
			// in place; a nested member with the same ordinal is not the
			// target (depth 0 only).
			const recorder = new CanvasRecorder();
			const renderer = new cool.VectorPrimitiveRenderer();
			renderer.setSlideBounds(1000, 800);
			renderer.setChildOverride({ ordNum: 1, dxTwips: 300, dyTwips: -50 });
			const group: any = {
				type: 'group',
				children: [
					{ type: 'objectChild', ordNum: 0, children: [{ type: 'backgroundcolor', color: '#00ff00' }] },
					{ type: 'objectChild', ordNum: 1, children: [
						{ type: 'objectChild', ordNum: 1, children: [{ type: 'backgroundcolor', color: '#0000ff' }] },
					] },
				],
			};
			renderer.renderPrimitive(recorder as any, group);
			renderer.setChildOverride(null);
			const translates = recorder.callsOf('translate');
			nodeassert.strictEqual(translates.length, 1, 'exactly one member translated');
			nodeassert.deepStrictEqual(translates[0].args, [300, -50]);
			// The untranslated sibling painted before the translate; the
			// nested subtree painted inside the translated one.
			const fills = recorder.callsOf('fillRect');
			nodeassert.strictEqual(fills.length, 2);
			nodeassert.strictEqual(fills[0].properties.fillStyle, '#00ff00');
			nodeassert.strictEqual(fills[1].properties.fillStyle, '#0000ff');
		});

		it('applies grayscale filter for modifiedColor gray', function () {
			// jsdom has no canvas, so this takes the CSS filter fallback.
			const primitive =
				loadVectorRenderingReference('testModifiedColorGray').primitives[0];
			nodeassert.strictEqual(primitive.type, 'modifiedColor');
			nodeassert.strictEqual(primitive.modifier, 'gray');

			const recorder = new CanvasRecorder();
			const renderer = new cool.VectorPrimitiveRenderer();
			renderer.renderPrimitive(recorder as any, primitive);

			nodeassert.strictEqual(recorder.properties.filter, 'grayscale(1)');
			nodeassert.ok(recorder.findCall('save'), 'save not called');
			nodeassert.ok(recorder.findCall('restore'), 'restore not called');
			// Exactly one child render. If the switch forgot the early
			// return, the child would draw a second time outside the
			// filter.
			nodeassert.strictEqual(recorder.countOf('fill'), 1);
		});

		it('applies invert filter for modifiedColor invert', function () {
			// The invert modifier maps to canvas filter "invert(1)".
			const primitive =
				loadVectorRenderingReference('testModifiedColorInvert').primitives[0];
			nodeassert.strictEqual(primitive.type, 'modifiedColor');
			nodeassert.strictEqual(primitive.modifier, 'invert');

			const recorder = new CanvasRecorder();
			const renderer = new cool.VectorPrimitiveRenderer();
			renderer.renderPrimitive(recorder as any, primitive);

			nodeassert.strictEqual(recorder.properties.filter, 'invert(1)');
			nodeassert.strictEqual(recorder.countOf('fill'), 1);
		});

		it('passes through modifiedColor replace without a filter', function () {
			// jsdom has no canvas, so no layer takes the replace colour.
			const primitive =
				loadVectorRenderingReference('testModifiedColorReplace').primitives[0];
			nodeassert.strictEqual(primitive.type, 'modifiedColor');
			nodeassert.strictEqual(primitive.modifier, 'replace');
			nodeassert.strictEqual(typeof primitive.color, 'string');

			const recorder = new CanvasRecorder();
			const renderer = new cool.VectorPrimitiveRenderer();
			renderer.renderPrimitive(recorder as any, primitive);

			nodeassert.strictEqual(recorder.properties.filter, undefined);
			// The wrapped child is a polyPolygonColor in its own
			// fill colour. The renderer must not override it.
			const fill = recorder.findCall('fill');
			nodeassert.ok(fill, 'child fill missing');
			nodeassert.strictEqual(
				fill?.properties.fillStyle,
				primitive.children[0].color,
			);
		});

		it('fills the bounds for filledRectangle', function () {
			const primitive = loadVectorRenderingReference(
				'testFilledRectangle',
			).primitives[0];
			nodeassert.strictEqual(primitive.type, 'filledRectangle');

			const recorder = new CanvasRecorder();
			const renderer = new cool.VectorPrimitiveRenderer();
			renderer.renderPrimitive(recorder as any, primitive);

			const fillRect = recorder.findCall('fillRect');
			nodeassert.ok(fillRect, 'fillRect not called');
			const [minX, minY, maxX, maxY] = primitive.bounds;
			nodeassert.deepStrictEqual(fillRect.args, [
				minX,
				minY,
				maxX - minX,
				maxY - minY,
			]);
			nodeassert.strictEqual(recorder.properties.fillStyle, primitive.color);
			nodeassert.ok(recorder.findCall('save'), 'save not called');
			nodeassert.ok(recorder.findCall('restore'), 'restore not called');
		});

		it('strokes the bounds for lineRectangle', function () {
			const primitive = loadVectorRenderingReference(
				'testLineRectangle',
			).primitives[0];
			nodeassert.strictEqual(primitive.type, 'lineRectangle');

			const recorder = new CanvasRecorder();
			const renderer = new cool.VectorPrimitiveRenderer();
			renderer.renderPrimitive(recorder as any, primitive);

			const strokeRect = recorder.findCall('strokeRect');
			nodeassert.ok(strokeRect, 'strokeRect not called');
			const [minX, minY, maxX, maxY] = primitive.bounds;
			nodeassert.deepStrictEqual(strokeRect.args, [
				minX,
				minY,
				maxX - minX,
				maxY - minY,
			]);
			nodeassert.strictEqual(
				recorder.properties.strokeStyle,
				primitive.color,
			);
			nodeassert.strictEqual(recorder.properties.lineWidth, 1);
			nodeassert.ok(recorder.findCall('save'), 'save not called');
			nodeassert.ok(recorder.findCall('restore'), 'restore not called');
		});

		it('strokes a single line from start to end', function () {
			const primitive = loadVectorRenderingReference(
				'testSingleLine',
			).primitives[0];
			nodeassert.strictEqual(primitive.type, 'singleLine');

			const recorder = new CanvasRecorder();
			const renderer = new cool.VectorPrimitiveRenderer();
			renderer.renderPrimitive(recorder as any, primitive);

			const moveTo = recorder.findCall('moveTo');
			const lineTo = recorder.findCall('lineTo');
			nodeassert.ok(moveTo, 'moveTo not called');
			nodeassert.ok(lineTo, 'lineTo not called');
			nodeassert.deepStrictEqual(moveTo.args, [primitive.startX, primitive.startY]);
			nodeassert.deepStrictEqual(lineTo.args, [primitive.endX, primitive.endY]);
			nodeassert.ok(recorder.findCall('stroke'), 'stroke not called');
			nodeassert.strictEqual(
				recorder.properties.strokeStyle,
				primitive.color,
			);
			nodeassert.strictEqual(recorder.properties.lineWidth, 1);
		});
	});

	// Fixtures from documents. Each fixture is a full reply built
	// by the same pipeline a real Impress document would go through,
	// so the renderer is exercised against a realistic primitive
	// tree rather than a single isolated primitive.
	describe('Document references', function () {
		it('renders the filled-rectangle slide from its document reference', function () {
			const primitiveTree = loadVectorRenderingReference('testSingleRectangle');

			nodeassert.strictEqual(primitiveTree.type, 'vectorprimitives');
			nodeassert.strictEqual(typeof primitiveTree.slideWidth, 'number');
			nodeassert.strictEqual(typeof primitiveTree.slideHeight, 'number');

			const recorder = new CanvasRecorder(
				primitiveTree.slideWidth,
				primitiveTree.slideHeight,
			);
			const renderer = new cool.VectorPrimitiveRenderer();
			renderer.setSlideBounds(
				primitiveTree.slideWidth,
				primitiveTree.slideHeight,
			);

			for (const primitive of primitiveTree.masterPage.primitives)
				renderer.renderPrimitive(recorder as any, primitive);

			for (const object of primitiveTree.objects)
				for (const primitive of object.primitives)
					renderer.renderPrimitive(recorder as any, primitive);

			// backgroundcolor fills the whole canvas at the white page color
			const fillRect = recorder.findCall('fillRect');
			nodeassert.ok(fillRect, 'backgroundcolor primitive should fillRect');
			nodeassert.deepStrictEqual(fillRect.args, [
				0,
				0,
				primitiveTree.slideWidth,
				primitiveTree.slideHeight,
			]);

			// 2x page-fill from polyPolygonColor
			const fills = recorder.callsOf('fill');
			nodeassert.ok(fills.length >= 2, 'expected at least two fills');

			// The blue rectangle renders with its declared colour.
			nodeassert.strictEqual(recorder.properties.fillStyle, '#4472c4');

			// Path2D should match the path string from the reference
			// for the blue fill.
			const lastFill = fills[fills.length - 1];
			nodeassert.ok(
				(lastFill.args[0] as Path2DRecorder).path.startsWith('m4251'),
				'last fill path does not match the reference',
			);

			// The black rectangle border should have stroked once.
			const strokes = recorder.callsOf('stroke');
			nodeassert.strictEqual(strokes.length, 1, 'expected one stroke');
			nodeassert.strictEqual(recorder.properties.strokeStyle, '#000000');
		});

		it('renders primitives from testStrokedRectangle.json reference', function () {
			// A stroke-only rectangle exercises polygonStroke against
			// the full pipeline. The slide carries no fill, so the only
			// stroke recorded is the rectangle's own border.
			const primitiveTree = loadVectorRenderingReference('testStrokedRectangle');

			const recorder = new CanvasRecorder(
				primitiveTree.slideWidth,
				primitiveTree.slideHeight,
			);
			const renderer = new cool.VectorPrimitiveRenderer();
			renderer.setSlideBounds(
				primitiveTree.slideWidth,
				primitiveTree.slideHeight,
			);

			for (const primitive of primitiveTree.masterPage.primitives)
				renderer.renderPrimitive(recorder as any, primitive);
			for (const object of primitiveTree.objects)
				for (const primitive of object.primitives)
					renderer.renderPrimitive(recorder as any, primitive);

			const stroke = recorder.findCall('stroke');
			nodeassert.ok(stroke, 'polygonStroke produced no stroke call');
			nodeassert.strictEqual(stroke?.properties.strokeStyle, '#000000');
			nodeassert.ok(stroke && stroke.depth > 0, 'stroke must be inside save/restore');
			nodeassert.ok(recorder.findCall('save'), 'save not called');
			nodeassert.ok(recorder.findCall('restore'), 'restore not called');
		});

		it('renders a group nested in a document tree', function () {
			// The engine test testSingleRectangle wraps the rectangle's
			// fill and stroke in a group node. Extract that group and
			// render it standalone to verify the group walks its
			// children in order in a real document tree.
			const primitiveTree = loadVectorRenderingReference('testSingleRectangle');

			// The slide object wraps the rectangle in
			// svx:N -> group -> [fill, stroke].
			const group = primitiveTree.objects[0].primitives[0].children[0];
			nodeassert.strictEqual(group.type, 'group');
			nodeassert.strictEqual(group.children.length, 2);

			const recorder = new CanvasRecorder();
			const renderer = new cool.VectorPrimitiveRenderer();
			renderer.renderPrimitive(recorder as any, group);

			nodeassert.strictEqual(recorder.countOf('fill'), 1);
			nodeassert.strictEqual(recorder.countOf('stroke'), 1);
			nodeassert.strictEqual(recorder.countOf('fillRect'), 0);

			const fillIndex = recorder.calls.findIndex((c) => c.method === 'fill');
			const strokeIndex = recorder.calls.findIndex((c) => c.method === 'stroke');
			nodeassert.ok(
				fillIndex >= 0 && strokeIndex > fillIndex,
				'fill should be recorded before stroke',
			);

			const fill = recorder.findCall('fill');
			const stroke = recorder.findCall('stroke');
			nodeassert.ok(
				(fill?.args[0] as Path2DRecorder).path.startsWith('m4251'),
				'fill path does not match the rectangle',
			);
			nodeassert.ok(
				(stroke?.args[0] as Path2DRecorder).path.startsWith('m4251'),
				'stroke path does not match the rectangle',
			);
			nodeassert.strictEqual(recorder.properties.strokeStyle, '#000000');

			nodeassert.ok(recorder.findCall('save'), 'save not called');
			nodeassert.ok(recorder.findCall('restore'), 'restore not called');
		});

		it('renders a rectangle with object metadata', function () {
			// A rectangle with metadata has its primitive sequence
			// wrapped in an objectInfo node at the top of the slide
			// object. The wire carries name, title and description
			// alongside the rectangle's drawing primitives.
			const primitiveTree = loadVectorRenderingReference('testObjectInfo');
			const objectInfoNode = primitiveTree.objects[0].primitives[0];
			nodeassert.strictEqual(objectInfoNode.type, 'objectInfo');
			nodeassert.strictEqual(objectInfoNode.name, 'Rectangle 1');
			nodeassert.strictEqual(objectInfoNode.title, 'My title');
			nodeassert.strictEqual(objectInfoNode.desc, 'My description');

			const recorder = new CanvasRecorder();
			const renderer = new cool.VectorPrimitiveRenderer();
			renderer.renderPrimitive(recorder as any, objectInfoNode);

			const fill = recorder.findCall('fill');
			nodeassert.ok(fill, 'child fill missing');
			nodeassert.strictEqual(fill?.properties.fillStyle, '#4472c4');
		});

		it('renders a transparent rectangle from a polyPolygonRGBA node', function () {
			// A solid-fill rectangle with a non-zero fill transparency
			// arrives as a polyPolygonRGBA node carrying the colour and
			// the transparency, nested under the slide object's svx and
			// group wrappers.
			const primitiveTree = loadVectorRenderingReference('testPolyPolygonRGBA');
			const rgbaNode =
				primitiveTree.objects[0].primitives[0].children[0].children[0];
			nodeassert.strictEqual(rgbaNode.type, 'polyPolygonRGBA');
			nodeassert.strictEqual(typeof rgbaNode.color, 'string');
			const transparency: number = parseFloat(rgbaNode.transparency);
			nodeassert.ok(
				transparency > 0 && transparency < 1,
				'expected non-zero transparency less than 1',
			);

			const recorder = new CanvasRecorder();
			const renderer = new cool.VectorPrimitiveRenderer();
			renderer.renderPrimitive(recorder as any, rgbaNode);

			const fill = recorder.findCall('fill');
			nodeassert.ok(fill, 'fill not called');
			nodeassert.strictEqual(fill?.properties.fillStyle, rgbaNode.color);
			nodeassert.ok(
				Math.abs(fill!.properties.globalAlpha - (1 - transparency)) < 1e-9,
				'globalAlpha at fill time does not match 1 - transparency',
			);
			nodeassert.ok(recorder.findCall('save'), 'save not called');
			nodeassert.ok(recorder.findCall('restore'), 'restore not called');
		});
	});

	it('renders polygonHairline from a document reference', function () {
		// Fixture: a slide with a single polygonHairline outline.
		const primitiveTree = loadVectorRenderingReference('testPolygonHairline');
		const hairlineNode = primitiveTree.objects[0].primitives[0];
		nodeassert.strictEqual(hairlineNode.type, 'polygonHairline');
		nodeassert.ok(hairlineNode.path, 'hairline must carry a path string');

		const recorder = new CanvasRecorder();
		const renderer = new cool.VectorPrimitiveRenderer();
		renderer.renderPrimitive(recorder as any, hairlineNode);

		// The hairline strokes at one canvas pixel in the wire colour.
		const stroke = recorder.findCall('stroke');
		nodeassert.ok(stroke, 'stroke not called');
		nodeassert.strictEqual(stroke?.properties.lineWidth, 1);
		nodeassert.strictEqual(
			stroke?.properties.strokeStyle,
			hairlineNode.color,
		);
		nodeassert.strictEqual(
			(stroke!.args[0] as Path2DRecorder).path,
			hairlineNode.path,
		);
		// Stroke settings do not leak to anything drawn after.
		nodeassert.ok(recorder.findCall('save'), 'save not called');
		nodeassert.ok(recorder.findCall('restore'), 'restore not called');
	});

	it('defaults polygonHairline color to black', function () {
		const recorder = new CanvasRecorder();
		const renderer = new cool.VectorPrimitiveRenderer();
		const primitive = { type: 'polygonHairline', path: 'M 0 0 L 1 1' };

		renderer.renderPrimitive(recorder as any, primitive);

		nodeassert.ok(recorder.findCall('stroke'), 'stroke not called');
		nodeassert.strictEqual(recorder.properties.strokeStyle, '#000000');
		nodeassert.strictEqual(recorder.properties.lineWidth, 1);
	});

	it('skips polygonHairline with missing path', function () {
		const recorder = new CanvasRecorder();
		const renderer = new cool.VectorPrimitiveRenderer();
		const primitive = { type: 'polygonHairline', color: '#000' };

		renderer.renderPrimitive(recorder as any, primitive);

		nodeassert.strictEqual(recorder.countOf('stroke'), 0);
	});

});

// Gates in CI (see the dxarray describe's note): no reference files needed.
describe('Vector renderer stroke width', function () {
	let originalPath2D: any;

	before(function () {
		originalPath2D = (globalThis as any).Path2D;
		(globalThis as any).Path2D = Path2DRecorder;
	});

	after(function () {
		(globalThis as any).Path2D = originalPath2D;
	});

	it('a thin stroke is at least one CSS pixel wide under the zoom scale', function () {
		// A form's checkbox border: 6.8 twips (a third of a point). Under
		// a 0.1333 twips-to-pixel scale that is 0.9 px and fades to
		// grey; the floor is one CSS pixel, i.e. dpr/scale in twips
		// (dpr is 1 here: no window).
		const primitive: any = {
			type: 'polygonStroke',
			path: 'm522 2106h184v184h-184v-184z',
			line: { color: '#000000', width: 6.8, linejoin: 'none', linecap: 'butt' },
		};
		const recorder: any = new CanvasRecorder(200, 150);
		recorder.getTransform = () => ({ a: 0.1333, b: 0, c: 0, d: 0.1333, e: 0, f: 0 });
		const renderer = new cool.VectorPrimitiveRenderer();
		renderer.renderPrimitive(recorder, primitive);
		const stroke = recorder.findCall('stroke');
		nodeassert.ok(stroke, 'stroke not called');
		nodeassert.ok(Math.abs(stroke.properties.lineWidth - 1 / 0.1333) < 1e-6, String(stroke.properties.lineWidth));

		// A width already wider than a pixel is left alone.
		const wide: any = { ...primitive, line: { ...primitive.line, width: 40 } };
		const recorder2: any = new CanvasRecorder(200, 150);
		recorder2.getTransform = () => ({ a: 0.1333, b: 0, c: 0, d: 0.1333, e: 0, f: 0 });
		renderer.renderPrimitive(recorder2, wide);
		nodeassert.strictEqual(recorder2.findCall('stroke').properties.lineWidth, 40);

		// A hairline is one device pixel by definition.
		const hair: any = { type: 'polygonHairline', path: 'm0 0h100', color: '#000000' };
		const recorder3: any = new CanvasRecorder(200, 150);
		recorder3.getTransform = () => ({ a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 });
		renderer.renderPrimitive(recorder3, hair);
		nodeassert.strictEqual(recorder3.findCall('stroke').properties.lineWidth, 2);
	});
});

// Titled apart from 'VectorPrimitiveRenderer' on purpose: that describe is
// skip-listed in ci-mocha-skip-suites.txt for its reference-file ENOENTs, and
// the skip entry covers every title that starts with 'VectorPrimitiveRenderer '.
// These placement pins need no engine artifacts, so they must gate.
describe('Vector renderer dxarray placement', function () {
	function textPortion(dxarray: number[]): any {
		return {
			type: 'textSimplePortion',
			text: 'abc',
			matrix: [1, 0, 0, 1, 100, 200],
			fontSize: 20,
			familyname: 'TestFace',
			dxarray: dxarray,
		};
	}

	it('a letter-spaced run is placed at the server advances: the spacing is part of the step', function () {
		// 10px glyphs spaced by 2: core's advances are 12, 24, 36. The
		// browser measures 30 for the string; with the spacing added back
		// the totals agree and every glyph lands on its server offset.
		const recorder = new CanvasRecorder(400, 300);
		const renderer = new cool.VectorPrimitiveRenderer();
		renderer.setSlideBounds(400, 300);
		renderer.renderPrimitive(recorder as any, { ...textPortion([12, 24, 36]), letterSpacing: 2 });
		const fills = recorder.callsOf('fillText');
		nodeassert.strictEqual(fills.length, 3, JSON.stringify(fills.map((c: any) => c.args)));
		nodeassert.deepStrictEqual(
			fills.map((c: any) => c.args),
			[
				['a', 100, 200],
				['b', 112, 200],
				['c', 124, 200],
			],
		);
	});

	it('a spaced run trusts the advances even when the declared spacing is in another unit', function () {
		// Declared 5 (not the advances' unit); the steps carry 2 per glyph.
		// The advances place the glyphs; the declared value is not added.
		const recorder = new CanvasRecorder(400, 300);
		const renderer = new cool.VectorPrimitiveRenderer();
		renderer.setSlideBounds(400, 300);
		renderer.renderPrimitive(recorder as any, { ...textPortion([12, 24, 36]), letterSpacing: 5 });
		const fills = recorder.callsOf('fillText');
		nodeassert.deepStrictEqual(
			fills.map((c: any) => c.args),
			[
				['a', 100, 200],
				['b', 112, 200],
				['c', 124, 200],
			],
		);
	});

	it('places each character at the server advance when the font agrees', function () {
		// CanvasRecorder measures 10px per character, so a dxarray whose
		// total matches (30) proves the resolved font agrees with the
		// server layout — per-character placement engages.
		const recorder = new CanvasRecorder(400, 300);
		const renderer = new cool.VectorPrimitiveRenderer();
		renderer.setSlideBounds(400, 300);
		renderer.renderPrimitive(recorder as any, textPortion([10, 20, 30]));

		const fills = recorder.callsOf('fillText');
		nodeassert.strictEqual(fills.length, 3);
		nodeassert.deepStrictEqual(
			fills.map((c: any) => c.args),
			[
				['a', 100, 200],
				['b', 110, 200],
				['c', 120, 200],
			],
		);
	});

	it('scales the resolved font\'s own spacing to the server total when glyph widths disagree', function () {
		// Steps 16/4/10 vs the recorder's 10px glyphs: the total (30)
		// matches exactly, but drawing 10px glyphs at those advances would
		// fuse 'b' into 'a' — the platform-fallback failure mode for a
		// missing deck font (deviation 6 > fontSize 20 * 0.1). Placement
		// keeps core's extent by scaling the resolved font's own prefix
		// widths to the server total (scale 1 here), instead of drifting
		// off it with one natural run.
		const recorder = new CanvasRecorder(400, 300);
		const renderer = new cool.VectorPrimitiveRenderer();
		renderer.setSlideBounds(400, 300);
		renderer.renderPrimitive(recorder as any, textPortion([16, 20, 30]));

		const fills = recorder.callsOf('fillText');
		nodeassert.strictEqual(fills.length, 3);
		nodeassert.deepStrictEqual(
			fills.map((c: any) => c.args),
			[
				['a', 100, 200],
				['b', 110, 200],
				['c', 120, 200],
			],
		);
	});

	it('spreads a small total disagreement evenly across the scaled run', function () {
		// Total 31 vs measured 30 (inside the 5% gate) with per-glyph
		// deviation (16 vs 10 > tolerance 2): lane 2 scales the 10px
		// prefixes by 31/30, so the run still ends at the server total.
		const recorder = new CanvasRecorder(400, 300);
		const renderer = new cool.VectorPrimitiveRenderer();
		renderer.setSlideBounds(400, 300);
		renderer.renderPrimitive(recorder as any, textPortion([16, 20, 31]));

		const fills = recorder.callsOf('fillText');
		nodeassert.strictEqual(fills.length, 3);
		nodeassert.deepStrictEqual(
			fills.map((c: any) => c.args),
			[
				['a', 100, 200],
				['b', 100 + (31 / 30) * 10, 200],
				['c', 100 + (31 / 30) * 20, 200],
			],
		);
	});

	it("carries a tracked run's character spacing into measurement and placement", function () {
		// Core lays a letter-spaced run out with the spacing folded into
		// every advance but the last (SvxFont::QuickGetTextSize) and
		// exports it beside the dxarray: 10px glyphs at 4px spacing are
		// 14/28/38. Applied to the canvas, the recorder measures 14 per
		// character (the last one included, as a real canvas does), the
		// placement measures like core, and the three-glyph run is a
		// metric twin placed at the server advances — spaced. Short
		// runs are the discriminating case: without the trailing
		// correction this one's total is off by a tenth and falls to the
		// unspaced single-run lane.
		const recorder = new CanvasRecorder(400, 300);
		const renderer = new cool.VectorPrimitiveRenderer();
		renderer.setSlideBounds(400, 300);
		const spaced = textPortion([14, 28, 38]);
		spaced.letterSpacing = 4;
		renderer.renderPrimitive(recorder as any, spaced);

		nodeassert.strictEqual(recorder.properties.letterSpacing, '4px');
		const fills = recorder.callsOf('fillText');
		nodeassert.strictEqual(fills.length, 3);
		nodeassert.deepStrictEqual(
			fills.map((c: any) => c.args),
			[
				['a', 100, 200],
				['b', 114, 200],
				['c', 128, 200],
			],
		);
	});

	it('a run without spacing resets the canvas spacing left by the previous run', function () {
		// The kicker on one slide must not leak its tracking into the
		// title drawn after it: every run sets the property, 0 included.
		const recorder = new CanvasRecorder(400, 300);
		const renderer = new cool.VectorPrimitiveRenderer();
		renderer.setSlideBounds(400, 300);
		const spaced = textPortion([14, 28, 38]);
		spaced.letterSpacing = 4;
		renderer.renderPrimitive(recorder as any, spaced);
		renderer.renderPrimitive(recorder as any, textPortion([10, 20, 30]));

		nodeassert.strictEqual(recorder.properties.letterSpacing, '0px');
		const fills = recorder.callsOf('fillText');
		nodeassert.strictEqual(fills.length, 6);
		nodeassert.deepStrictEqual(
			fills.slice(3).map((c: any) => c.args),
			[
				['a', 100, 200],
				['b', 110, 200],
				['c', 120, 200],
			],
		);
	});

	it('falls back to one run when the resolved font disagrees', function () {
		// dxarray total 150 vs measured 30: the browser substituted an
		// unrelated font, and its glyphs at the original advances would
		// read as gappy text. One internally consistent run instead.
		const recorder = new CanvasRecorder(400, 300);
		const renderer = new cool.VectorPrimitiveRenderer();
		renderer.setSlideBounds(400, 300);
		renderer.renderPrimitive(recorder as any, textPortion([50, 100, 150]));

		const fills = recorder.callsOf('fillText');
		nodeassert.strictEqual(fills.length, 1);
		nodeassert.deepStrictEqual(fills[0].args, ['abc', 100, 200]);
	});
});
