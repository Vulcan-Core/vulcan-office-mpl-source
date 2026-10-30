/* global Proxy _ */
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
	This class is for the sub sections (handles) of ShapeHandlesSection.
	Shape is rendered on the core side. Only the handles are drawn here and modification commands are sent to the core side.
*/

class ShapeHandleScalingSubSection extends ShapeHandleSubSection {
	// Ring width in CSS px, outside the drawn disc. Art, not hit geometry: the
	// grab box stays at ShapeHandlesSection.phoneHandleHitCss whatever this is.
	public static phoneHaloCss = 2;

	constructor(parentHandlerSection: ShapeHandlesSection, sectionName: string, size: number[], documentPosition: cool.SimplePoint, ownInfo: any, cropModeEnabled: boolean, localAnchor?: number[]) {
		super(parentHandlerSection, sectionName, size, documentPosition, ownInfo);

		this.sectionProperties.mousePointerType = null;

		this.sectionProperties.initialAngle = null; // Initial angle of the point (handle) to the center in radians.
		this.sectionProperties.distanceToCenter = null; // Distance to center.
		this.sectionProperties.cropModeEnabled = cropModeEnabled;
		this.sectionProperties.cropCursor = 'url(' + app.LOUtil.getURL("images/cursors/crop.svg") + ') 8 8, auto';
		this.sectionProperties.grabOffset = null; // See onMouseDown.
		this.sectionProperties.localAnchor = localAnchor || [size[0] * 0.5, size[1] * 0.5];

		this.setMousePointerType();

		app.events.on('TextCursorVisibility', this.onTextCursorVisibility.bind(this));
	}

	onDraw(frameCount?: number, elapsedTime?: number): void {
		if (VulcanImpressSelectEcho.suppressesSelectionChrome()) return;
		// A live move drag displaces frame and content; stationary
		// grip dots would trail the old position, so they stand down.
		if (this.sectionProperties.parentHandlerSection?.isMoveDragLive?.()) return;
		if (HelperLineStyles.handleFillStyle === null) HelperLineStyles.initiate();

		this.context.save();
		this.context.setTransform(1, 0, 0, 1, 0, 0);

		const multiplier = app.map._docLayer.isCalcRTL() ? -1 : 1;

		if (this.sectionProperties.cropModeEnabled) {
			this.context.fillStyle = 'white';
			this.context.strokeStyle = 'black';
			this.context.beginPath();
			this.drawCropHandles();
			this.context.closePath();
			this.context.fill();
			this.context.stroke();
		}
		else {
			// The section keeps its full size as the hit area; only the visual is
			// smaller. Other postures retain the stock round white handle.
			const centerX = this.documentPosition.vX + this.sectionProperties.localAnchor[0] * multiplier;
			const centerY = this.documentPosition.vY + this.sectionProperties.localAnchor[1];
			const parentProperties =
				this.sectionProperties.parentHandlerSection.sectionProperties;

			if (parentProperties.phoneChrome) {
				const width = parentProperties.handleWidth;
				/*
					THE SLIDE CANVAS DRAWS A DISC IN A RING, NOT A SQUARE.

					Measured off the reference's own selected-object frames: a
					navy disc ~11.4 dp across, standing in a pale ring, inside a
					48 dp target. Every previous claim in this file that the
					square was the reference's vocabulary was wrong about the
					art; the SIZES it was written for are right and unchanged —
					the disc keeps the 12 CSS px drawn width and the box keeps
					its 44 (ShapeHandlesSection's statics).

					The ring is ink OUTSIDE the disc, as it is in the reference,
					so the drawn width still names the handle and the ring costs
					the grab box nothing.

					Both colours come from the doctype's own CSS section, and
					the navy there is chosen rather than sampled: the reference
					renders two of them across a session boundary, and the
					darker is the one the phone text-run handles are already
					pinned to, so this surface speaks a single navy.

					PRESENTATION ONLY. phoneChrome now spans every phone doctype
					(the parent's constructor has the story); the other three
					keep the square until their own reference is measured.
				*/
				if (app.map._docLayer._docType === 'presentation') {
					const radius = width * 0.5;
					this.context.fillStyle = HelperLineStyles.handleHaloStyle;
					this.context.beginPath();
					this.context.arc(
						centerX,
						centerY,
						radius + ShapeHandleScalingSubSection.phoneHaloCss * app.dpiScale,
						0,
						Math.PI * 2,
					);
					this.context.closePath();
					this.context.fill();

					this.context.fillStyle = HelperLineStyles.handleStrokeStyle;
					this.context.beginPath();
					this.context.arc(centerX, centerY, radius, 0, Math.PI * 2);
					this.context.closePath();
					this.context.fill();
				} else {
					this.context.fillStyle = HelperLineStyles.handleStrokeStyle;
					this.context.fillRect(
						centerX - width * 0.5,
						centerY - width * 0.5,
						width,
						width,
					);
				}
			} else {
				const radius = 4.5 * app.dpiScale;
				this.context.fillStyle = HelperLineStyles.handleFillStyle;
				this.context.strokeStyle = HelperLineStyles.handleStrokeStyle;
				this.context.lineWidth = app.dpiScale;
				this.context.beginPath();
				this.context.arc(centerX, centerY, radius, 0, Math.PI * 2);
				this.context.closePath();
				this.context.fill();
				this.context.stroke();
			}
		}

		this.context.restore();
	}

	/*
		Crop markers PAINT at the drawn handle size, never at this.size.

		this.size is the GRAB box, and on a phone that is 44 px - reading it
		here would stamp four 44 px brackets across the corners of the photo you
		are trying to crop, hiding the very edges you are dragging. Desktop and
		tablet build the section at the drawn size, so there the two numbers are
		identical and nothing about the painting changes.
	*/
	private get cropMarkerWidth(): number {
		return this.sectionProperties.parentHandlerSection.sectionProperties.handleWidth;
	}

	drawCropCornerHandle() {
		const markerWidth = this.cropMarkerWidth;
		const halfMarkerWidth = markerWidth * 0.5;
		const shapeAngle = this.sectionProperties.parentHandlerSection.sectionProperties.shapeRectangleProperties.angleRadian;
		let x = halfMarkerWidth, y = halfMarkerWidth;
		this.context.translate(x, y);
		this.context.rotate(shapeAngle * -1);
		this.context.translate(-x, -y);
		this.context.moveTo(x, y);
		x += markerWidth;
		this.context.lineTo(x, y);
		y += halfMarkerWidth;
		this.context.lineTo(x, y);
		x -= halfMarkerWidth;
		this.context.lineTo(x, y);
		y += halfMarkerWidth;
		this.context.lineTo(x, y);
		x -= halfMarkerWidth;
		this.context.lineTo(x, y);
	}

	drawCropSideHandle() {
		const markerWidth = this.cropMarkerWidth;
		const halfMarkerWidth = markerWidth * 0.5;
		const shapeAngle = this.sectionProperties.parentHandlerSection.sectionProperties.shapeRectangleProperties.angleRadian;
		let x = halfMarkerWidth, y = halfMarkerWidth;
		this.context.translate(x, y);
		this.context.rotate(shapeAngle * -1);
		this.context.translate(-x, -y);
		this.context.moveTo(x, y);
		x += markerWidth;
		this.context.lineTo(x, y);
		y += halfMarkerWidth;
		this.context.lineTo(x, y);
		x -= markerWidth;
		this.context.lineTo(x, y);
	}

	drawCropHandles() {
		const markerWidth = this.cropMarkerWidth;
		// Re-centre the drawn marker inside the grab box. Every case below is
		// expressed purely in terms of markerWidth and this origin, so shifting
		// the origin by half the difference reproduces the desktop geometry
		// exactly - and on desktop the difference is 0.
		const insetX = (this.size[0] - markerWidth) * 0.5;
		const insetY = (this.size[1] - markerWidth) * 0.5;
		this.context.save();
		// Shift the local-origin markers to this handle's view position.
		this.context.translate(this.documentPosition.vX + insetX, this.documentPosition.vY + insetY);
		switch (this.sectionProperties.ownInfo.kind) {
			case '1':
				this.drawCropCornerHandle();
				break;
			case '2':
				this.drawCropSideHandle();
				break;
			case '3':
				this.context.rotate(Math.PI / 2);
				this.context.translate(0, -markerWidth);
				this.drawCropCornerHandle();
				break;
			case '4':
				this.context.rotate(-Math.PI / 2);
				this.context.translate(-markerWidth, 0);
				this.drawCropSideHandle();
				break;
			case '5':
				this.context.rotate(Math.PI / 2);
				this.context.translate(0, -markerWidth);
				this.drawCropSideHandle();
				break;
			case '6':
				this.context.rotate(-Math.PI / 2);
				this.context.translate(-markerWidth, 0);
				this.drawCropCornerHandle();
				break;
			case '7':
				this.context.rotate(Math.PI);
				this.context.translate(-markerWidth, -markerWidth);
				this.drawCropSideHandle();
				break;
			case '8':
				this.context.rotate(Math.PI);
				this.context.translate(-markerWidth, -markerWidth);
				this.drawCropCornerHandle();
				break;
		}
		this.context.restore();
	}

	setMousePointerType() {
		// The outward direction of each handle in degrees (0 = east, counter-
		// clockwise positive, screen coordinates), before shape rotation.
		const kindDirection: { [kind: string]: number } = {
			'1': 135, '2': 90, '3': 45,
			'4': 180,           '5': 0,
			'6': 225, '7': 270, '8': 315
		};

		const base = kindDirection[this.sectionProperties.ownInfo.kind];
		if (base === undefined) {
			this.sectionProperties.mousePointerType = 'default';
			return;
		}

		// Rotate the cursor with the shape, so a rotated shape's handles show
		// the resize direction they actually work in.
		const angleRadian = this.sectionProperties.parentHandlerSection?.sectionProperties?.shapeRectangleProperties?.angleRadian ?? 0;
		let direction = base + angleRadian * 180 / Math.PI;
		direction = ((Math.round(direction / 45) * 45) % 180 + 180) % 180;

		if (direction === 0)
			this.sectionProperties.mousePointerType = 'ew-resize';
		else if (direction === 45)
			this.sectionProperties.mousePointerType = 'nesw-resize';
		else if (direction === 90)
			this.sectionProperties.mousePointerType = 'ns-resize';
		else
			this.sectionProperties.mousePointerType = 'nwse-resize';
	}

	onMouseEnter(point: cool.SimplePoint, e: MouseEvent) {
		if (this.sectionProperties.cropModeEnabled)
			this.context.canvas.style.cursor = this.sectionProperties.cropCursor;
		else {
			this.setMousePointerType(); // The shape's angle may have changed since construction.
			this.context.canvas.style.cursor = this.sectionProperties.mousePointerType;
		}
	}

	/*
		Resolve overlapping phone grab boxes to the nearest VISIBLE dot.

		Eight nominal 44 px boxes cannot be disjoint when the selected object is
		itself under 44 px in an axis. CanvasSectionContainer otherwise resolves
		overlap by reverse insertion order, so the same point can select a corner
		the user was visibly farther from. Partition the overlap as a Voronoi
		region around each dot instead. A numeric kind tie-break makes an exact
		bisector deterministic and independent of section array order.

		This is phone scoped through phoneChrome — every phone doctype except
		Calc RTL (the parent's constructor has the story: this arbitration is
		written in unmirrored screen coordinates, and RTL mirrors the axis).
		Desktop, tablet and a Calc RTL sheet return the stock rectangular
		isHit result exactly.
	*/
	isHit(point: number[]): boolean {
		if (!super.isHit(point)) return false;

		const parent = this.sectionProperties.parentHandlerSection;
		if (
			!parent?.sectionProperties?.phoneChrome ||
			this.sectionProperties.cropModeEnabled
		)
			return true;

		const ownKind = Number(this.sectionProperties.ownInfo?.kind);
		if (!Number.isInteger(ownKind) || ownKind < 1 || ownKind > 8) return true;

		const ownAnchor = this.sectionProperties.localAnchor;
		const ownX = this.myTopLeft[0] + ownAnchor[0];
		const ownY = this.myTopLeft[1] + ownAnchor[1];
		const ownDistance = (point[0] - ownX) ** 2 + (point[1] - ownY) ** 2;

		for (const sibling of parent.sectionProperties.subSections) {
			if (sibling === this || !sibling.showSection || !sibling.interactable)
				continue;

			const siblingKind = Number(sibling.sectionProperties.ownInfo?.kind);
			if (!Number.isInteger(siblingKind) || siblingKind < 1 || siblingKind > 8)
				continue;

			if (
				point[0] < sibling.myTopLeft[0] ||
				point[0] > sibling.myTopLeft[0] + sibling.size[0] ||
				point[1] < sibling.myTopLeft[1] ||
				point[1] > sibling.myTopLeft[1] + sibling.size[1]
			)
				continue;

			const siblingAnchor = sibling.sectionProperties.localAnchor;
			const siblingX = sibling.myTopLeft[0] + siblingAnchor[0];
			const siblingY = sibling.myTopLeft[1] + siblingAnchor[1];
			const siblingDistance =
				(point[0] - siblingX) ** 2 + (point[1] - siblingY) ** 2;

			if (
				siblingDistance < ownDistance ||
				(siblingDistance === ownDistance && siblingKind < ownKind)
			)
				return false;
		}

		return true;
	}

	private doWeKeepRatio(e: MouseEvent) {
		if (this.sectionProperties.cropModeEnabled)
			return false;

		// PowerPoint semantics: only corner handles constrain the ratio;
		// edge handles always stretch a single axis.
		if (!['1', '3', '6', '8'].includes(this.sectionProperties.ownInfo.kind))
			return false;

		// Images keep their aspect ratio by default. Shapes and text boxes
		// keep it only while Shift is held.
		if (app.map.context && app.map.context.context === 'Graphic')
			return true;

		return e.shiftKey;
	}

	// PowerPoint's Ctrl-resize: the shape grows/shrinks symmetrically about
	// its center instead of the opposite edge staying put.
	private doWeResizeAroundCenter(e: MouseEvent) {
		return e.ctrlKey && !this.sectionProperties.cropModeEnabled;
	}

	private getNewPosition(handleID: string, rectangle: cool.SimpleRectangle): number[] {
		const isRTL = app.map._docLayer.isCalcRTL();
		const leftHandleX = isRTL ? rectangle.x2 : rectangle.x1;
		const rightHandleX = isRTL ? rectangle.x1 : rectangle.x2;

		if (handleID === '0')
			return [leftHandleX, rectangle.y1];
		else if (handleID === '1')
			return [rectangle.center[0], rectangle.y1];
		else if (handleID === '2')
			return [rightHandleX, rectangle.y1];
		else if (handleID === '3')
			return [leftHandleX, rectangle.center[1]];
		else if (handleID === '4')
			return [rightHandleX, rectangle.center[1]];
		else if (handleID === '5')
			return [leftHandleX, rectangle.y2];
		else if (handleID === '6')
			return [rectangle.center[0], rectangle.y2];
		else // handleID === '7'
			return [rightHandleX, rectangle.y2];
	}
	// In Calc RTL the canvas is mirrored, so the section-local mouse offset
	// runs opposite to the doc-X axis. Convert the section-local point.pX
	// into the doc-pixel X of the mouse cursor, the same coordinate system
	// that this.position[0] and shapeRectangleProperties live in.
	private mouseToDocX(point: cool.SimplePoint): number {
		return app.map._docLayer.isCalcRTL()
			? this.position[0] - point.pX
			: this.position[0] + point.pX;
	}

	/*
		The finger is not the handle.

		The section IS the grab box, and on a phone that box is 44 px, so the
		point you press can sit up to 22 px away from the corner it stands for.
		The geometry below treats the pointer position AS the handle position,
		so without a correction the corner teleports to the fingertip before it
		starts tracking - on a slide canvas, which has no grid to hide it.
		Record where inside the box the press landed and take it back out of
		every point for the rest of the drag.

		Desktop and tablet keep posting the raw position: there the box is the
		12 px art, the error is bounded by 6 px, and snap-to-cursor is long
		established behaviour. On a phone the correction now travels with the
		44 px box to every doctype the box does - a 22 px teleport is not
		something Calc's cell snap or Writer's anchor can absorb, it happens
		BEFORE either sees the position - which is why the two are one flag:
		a doctype that gets the box without this offset gets the teleport.

		The one exclusion is Calc RTL, and it lives in the parent's
		phoneChrome flag rather than here: mouseToDocX mirrors the X axis
		there (this.position[0] - point.pX), and this offset, subtracted in
		unmirrored section-local coordinates, would be applied in the wrong
		direction. An RTL sheet therefore keeps the stock 12 px handles and
		the raw posting - HEAD's behaviour exactly - until the mirrored signs
		travel too.
	*/
	onMouseDown(point: cool.SimplePoint, e: MouseEvent): void {
		this.sectionProperties.grabOffset = this.sectionProperties.parentHandlerSection
			.sectionProperties.phoneChrome
			? [
				point.pX - this.sectionProperties.localAnchor[0],
				point.pY - this.sectionProperties.localAnchor[1],
			]
			: null;
	}

	/*
		Run the snap probe on the candidate handle point BEFORE the geometry is
		computed and return a snapped copy for the geometry to consume, so the
		ghost, the handles, the guides and the commit all share one position.
		Probing p itself (not the section top-left) puts the guide through the
		handle; returning a copy keeps the raw pointer authoritative for the
		next event (a written-back snap would feed on itself).

		Under keep-ratio only the primary axis is snapped: the secondary axis
		is derived from the primary delta by calculateRatioPoint, so a snap on
		the derived axis could not be honored - its guide would be a lie. The
		suppressed axis therefore also draws no guide.
	*/
	private snapHandlePoint(p: cool.SimplePoint, e: MouseEvent): cool.SimplePoint {
		const parentProps = this.sectionProperties.parentHandlerSection.sectionProperties;

		// Size 0: we are checking a single point.
		this.sectionProperties.parentHandlerSection.checkHelperLinesAndSnapPoints([0, 0], [p.pX, p.pY], [0, 0], ShapeHandlesSection.snapBypassed(e));

		if (this.doWeKeepRatio(e)) {
			if (['2', '7'].includes(this.sectionProperties.ownInfo.kind)) {
				parentProps.closestX = null;
				parentProps.centerSnapX = null;
				parentProps.centerToCenterX = false;
				parentProps.guideLinesX = [];
				parentProps.snapSourceX = null;
			}
			else {
				parentProps.closestY = null;
				parentProps.centerSnapY = null;
				parentProps.centerToCenterY = false;
				parentProps.guideLinesY = [];
				parentProps.snapSourceY = null;
			}
		}

		const snapped = p.clone();
		if (parentProps.closestX !== null)
			snapped.pX = parentProps.closestX;
		if (parentProps.closestY !== null)
			snapped.pY = parentProps.closestY;
		return snapped;
	}

	// The section-local point with that grab offset removed, so everything
	// downstream sees the handle rather than the fingertip.
	private handleLocalPoint(point: cool.SimplePoint): cool.SimplePoint {
		const grabOffset = this.sectionProperties.grabOffset;
		if (!grabOffset) return point;

		const corrected = point.clone();
		corrected.pX = point.pX - grabOffset[0];
		corrected.pY = point.pY - grabOffset[1];
		return corrected;
	}

	onMouseUp(point: cool.SimplePoint, e: MouseEvent): void {
		if (this.containerObject.isDraggingSomething()) {
			Util.ensureValue(app.activeDocument);
			this.stopPropagating();
			e.stopPropagation();

			const parentHandlerSection = this.sectionProperties.parentHandlerSection;

			if (parentHandlerSection.consumeDragCancelled()) {
				parentHandlerSection.clearHelperLines();
				parentHandlerSection.hideSVG();
				return;
			}

			const handleId = this.sectionProperties.ownInfo.id;
			const local = this.handleLocalPoint(point);

			const p = local.clone();
			p.pX = this.mouseToDocX(local);
			p.pY += this.position[1];

			// The same snap the ghost tracked: the commit is derived from the
			// snapped geometry once, never re-applied on top of it.
			const shapeRecProps = this.calculateNewShapeRectangleProperties(this.snapHandlePoint(p, e), e);

			const tempRectangle = cool.SimpleRectangle.fromCorePixels([
				shapeRecProps.center.pX - shapeRecProps.width * 0.5,
				shapeRecProps.center.pY - shapeRecProps.height * 0.5,
				shapeRecProps.width, shapeRecProps.height
			]);

			if (this.doWeResizeAroundCenter(e)) {
				// A single moving handle cannot express a symmetric resize, so
				// commit the full geometry instead.
				let yTwips = tempRectangle.y1;
				const verticalOffset = app.map._docLayer.getFiledBasedViewVerticalOffset();
				if (verticalOffset)
					yTwips -= verticalOffset; // Canvas twips to core twips.

				const parameters = {
					TransformPosX: { type: 'long', value: Math.round(tempRectangle.x1) },
					TransformPosY: { type: 'long', value: Math.round(yTwips) },
					TransformWidth: { type: 'long', value: Math.round(tempRectangle.width) },
					TransformHeight: { type: 'long', value: Math.round(tempRectangle.height) }
				};

				app.map.sendUnoCommand('.uno:TransformDialog', parameters);
				parentHandlerSection.clearHelperLines();
				parentHandlerSection.scheduleGhostFallbackHide();
				return;
			}

			const newPoint = this.getNewPosition(handleId, tempRectangle);

			// Core un-rotates the handle point it receives, so the commit
			// must be the point's TRUE document position on the rotated
			// shape. getNewPosition answers in the axis-aligned frame;
			// rotate it about the center by the shape's angle (visual CCW,
			// y-down doc coords — the same convention the crop handles and
			// the SVG ghost draw with) or releasing a mid grip on a rotated
			// shape widens it by (1+cosθ)/(2cosθ) (adversarial review P1-5).
			const commitAngle = shapeRecProps.angleRadian ?? 0;
			if (commitAngle) {
				const cx = tempRectangle.center[0];
				const cy = tempRectangle.center[1];
				const dx = newPoint[0] - cx;
				const dy = newPoint[1] - cy;
				const cos = Math.cos(commitAngle);
				const sin = Math.sin(commitAngle);
				newPoint[0] = cx + dx * cos + dy * sin;
				newPoint[1] = cy - dx * sin + dy * cos;
			}

			const parameters = {
				HandleNum: { type: 'long', value: handleId },
				NewPosX: { type: 'long', value: Math.round(newPoint[0]) },
				NewPosY: { type: 'long', value: Math.round(newPoint[1]) }
			};

			app.map.sendUnoCommand('.uno:MoveShapeHandle', parameters);
			parentHandlerSection.clearHelperLines();
			// The ghost stays visible until the post-commit graphicselection
			// arrives (adjustSVGProperties hides it), avoiding the settle-jump.
			parentHandlerSection.scheduleGhostFallbackHide();
		}
	}

	adjustSVGProperties(shapeRecProps: any) {
		if (this.sectionProperties.parentHandlerSection.sectionProperties.svg) {
			const svg = this.sectionProperties.parentHandlerSection.sectionProperties.svg;

			const scaleX = shapeRecProps.width / this.sectionProperties.parentHandlerSection.sectionProperties.shapeRectangleProperties.width;
			const scaleY = shapeRecProps.height / this.sectionProperties.parentHandlerSection.sectionProperties.shapeRectangleProperties.height;

			let diffX = shapeRecProps.center.pX - this.sectionProperties.parentHandlerSection.sectionProperties.shapeRectangleProperties.center.pX;
			let diffY = shapeRecProps.center.pY - this.sectionProperties.parentHandlerSection.sectionProperties.shapeRectangleProperties.center.pY;

			diffX = diffX / app.dpiScale;
			diffY = diffY / app.dpiScale;

			svg.children[0].style.transform = 'translate(' + Math.round(diffX) + 'px, ' + Math.round(diffY) + 'px)' + 'rotate(' + -shapeRecProps.angleRadian + 'rad) scale(' + scaleX + ', ' + scaleY + ') rotate(' + shapeRecProps.angleRadian + 'rad)';

			this.sectionProperties.parentHandlerSection.showSVG();
		}
	}

	// Uses the given "point" parameter and modifies it.
	private calculateRatioPoint(point: cool.SimplePoint, shapeRecProps: any) {
		const isVerticalHandler = ['2', '7'].includes(this.sectionProperties.ownInfo.kind);

		const primaryDelta = isVerticalHandler
			? point.pY - shapeRecProps.center.pY
			: point.pX - shapeRecProps.center.pX;

		const aspectRatio = isVerticalHandler
			? shapeRecProps.width / shapeRecProps.height
			: shapeRecProps.height / shapeRecProps.width;

		// The kind-based direction table assumes LTR doc-X. In RTL, the abs in
		// convertToTileTwipsIfNeeded mirrors the X axis (kinds 1/4/6 sit at
		// doc-max-X, 3/5/8 at doc-min-X), so the secondary axis runs opposite
		// to user intent.
		let secondaryDelta = primaryDelta * aspectRatio;
		if (app.map._docLayer.isCalcRTL())
			secondaryDelta = -secondaryDelta;

		const direction = ['3', '4', '6', '2'].includes(this.sectionProperties.ownInfo.kind) ? -1 : 1;

		if (isVerticalHandler)
			point.pX = shapeRecProps.center.pX + secondaryDelta * direction;
		else
			point.pY = shapeRecProps.center.pY + secondaryDelta * direction;
	}

	calculateNewShapeRectangleProperties(point: cool.SimplePoint, e: MouseEvent) {
		const shapeRecProps: any = structuredClone(this.sectionProperties.parentHandlerSection.sectionProperties.shapeRectangleProperties);
		shapeRecProps.center = this.sectionProperties.parentHandlerSection.sectionProperties.shapeRectangleProperties.center.clone();
		const keepRatio = this.doWeKeepRatio(e);

		if (keepRatio)
			this.calculateRatioPoint(point, shapeRecProps);

		const diff = [point.pX - shapeRecProps.center.pX, -(point.pY - shapeRecProps.center.pY)];
		const length = Math.pow(Math.pow(diff[0], 2) + Math.pow(diff[1], 2), 0.5);
		const pointAngle = Math.atan2(diff[1], diff[0]);
		point.pX = shapeRecProps.center.pX + length * Math.cos(pointAngle - shapeRecProps.angleRadian);
		point.pY = shapeRecProps.center.pY - length * Math.sin(pointAngle - shapeRecProps.angleRadian);

		const rectangle = new cool.SimpleRectangle(
			(shapeRecProps.center.pX - shapeRecProps.width * 0.5) * app.pixelsToTwips,
			(shapeRecProps.center.pY - shapeRecProps.height * 0.5) * app.pixelsToTwips,
			shapeRecProps.width * app.pixelsToTwips,
			shapeRecProps.height * app.pixelsToTwips
		);

		const oldpCenter = rectangle.pCenter;

		// In RTL, convertToTileTwipsIfNeeded's abs flips handle doc-X: kinds
		// 1/4/6 land at doc-max-X (= pX2 side) and 3/5/8 at doc-min-X (pX1).
		// So the edge each handle modifies is swapped relative to LTR.
		const isRTL = app.map._docLayer.isCalcRTL();
		const isMinXHandle = isRTL
			? ['3', '5', '8'].includes(this.sectionProperties.ownInfo.kind)
			: ['1', '4', '6'].includes(this.sectionProperties.ownInfo.kind);
		const isMaxXHandle = isRTL
			? ['1', '4', '6'].includes(this.sectionProperties.ownInfo.kind)
			: ['3', '5', '8'].includes(this.sectionProperties.ownInfo.kind);

		if (isMinXHandle) {
			const pX2 = rectangle.pX2;
			rectangle.pX1 = point.pX;
			rectangle.pX2 = pX2;
		}
		else if (isMaxXHandle)
			rectangle.pX2 = point.pX;

		if (['1', '2', '3'].includes(this.sectionProperties.ownInfo.kind)) {
			const pY2 = rectangle.pY2;
			rectangle.pY1 = point.pY;
			rectangle.pY2 = pY2;
		}
		else if (['6', '7', '8'].includes(this.sectionProperties.ownInfo.kind))
			rectangle.pY2 = point.pY;

		if (keepRatio) {
			if (['4', '5'].includes(this.sectionProperties.ownInfo.kind)) {
				rectangle.pY2 = point.pY;
			} else if (['2', '7'].includes(this.sectionProperties.ownInfo.kind)) {
				if (isRTL) {
					const pX2 = rectangle.pX2;
					rectangle.pX1 = point.pX;
					rectangle.pX2 = pX2;
				} else {
					rectangle.pX2 = point.pX;
				}
			}
		}

		if (this.doWeResizeAroundCenter(e)) {
			// Mirror the moved edge(s) about the original center so the shape
			// scales symmetrically and its center stays put.
			const kind = this.sectionProperties.ownInfo.kind;
			const centerX = shapeRecProps.center.pX;
			const centerY = shapeRecProps.center.pY;

			const xChanged = isMinXHandle || isMaxXHandle || (keepRatio && ['2', '7'].includes(kind));
			const yChanged = !['4', '5'].includes(kind) || keepRatio;

			if (xChanged) {
				const movedX = isMinXHandle || (keepRatio && ['2', '7'].includes(kind) && isRTL) ? rectangle.pX1 : rectangle.pX2;
				const halfWidth = Math.abs(movedX - centerX);
				const pX2 = centerX + halfWidth;
				rectangle.pX1 = centerX - halfWidth;
				rectangle.pX2 = pX2;
			}

			if (yChanged) {
				const movedY = ['1', '2', '3'].includes(kind) ? rectangle.pY1 : rectangle.pY2;
				const halfHeight = Math.abs(movedY - centerY);
				const pY2 = centerY + halfHeight;
				rectangle.pY1 = centerY - halfHeight;
				rectangle.pY2 = pY2;
			}
		}

		const centerAngle = Math.atan2(oldpCenter[1] - rectangle.pCenter[1], rectangle.pCenter[0] - oldpCenter[0]);
		const centerLength = Math.pow(Math.pow(rectangle.pCenter[1] - oldpCenter[1], 2) + Math.pow(rectangle.pCenter[0] - oldpCenter[0], 2), 0.5);

		const x = centerLength * Math.cos(shapeRecProps.angleRadian + centerAngle);
		const y = centerLength * Math.sin(shapeRecProps.angleRadian + centerAngle);

		shapeRecProps.center.pX += x;
		shapeRecProps.center.pY -= y;
		shapeRecProps.width = rectangle.pWidth;
		shapeRecProps.height = rectangle.pHeight;

		return shapeRecProps;
	}

	// While dragging a handle, we want to simulate handles to their final positions.
	moveHandlesOnDrag(point: cool.SimplePoint, e: MouseEvent) {
		Util.ensureValue(app.activeDocument);

		const local = this.handleLocalPoint(point);

		const p = local.clone();
		p.pX = this.mouseToDocX(local);
		p.pY += this.position[1];

		const shapeRecProps = this.calculateNewShapeRectangleProperties(this.snapHandlePoint(p, e), e);

		// Live geometry of the ghost, for the live resize frame. Not the
		// shapeRectangleProperties key: adjustSVGProperties scales the ghost
		// against that original, so overwriting it would corrupt the ghost.
		this.sectionProperties.parentHandlerSection.sectionProperties.liveShapeRecProps = shapeRecProps;

		this.sectionProperties.parentHandlerSection.calculateInitialAnglesOfShapeHandlers(shapeRecProps);

		// Each scaling section keeps the visible dot at its own local anchor.
		// Desktop anchors are the stock half-size; phone anchors push the grab
		// box outward and therefore cannot use one shared half-size here.
		// Unchanged on desktop, where the two sizes are equal.
		//
		// Note this loop applies the SCALING half to every entry in subSections,
		// not just the scaling ones - it always did. It is harmless only because
		// calculateInitialAnglesOfShapeHandlers assigns distanceToCenter and
		// initialAngle for kinds '1'-'8' alone, so anchor, glue and rotation
		// sub sections are already positioned to NaN here. Pre-existing on
		// desktop; not this lane's to change.
		const subSections = this.sectionProperties.parentHandlerSection.sectionProperties.subSections;

		let x = 0, y = 0;
		let pointAngle = 0;

		for (let i = 0; i < subSections.length; i++) {
			const subSection = subSections[i];

			pointAngle = subSection.sectionProperties.initialAngle + shapeRecProps.angleRadian;
			x = shapeRecProps.center.pX + subSection.sectionProperties.distanceToCenter * Math.cos(pointAngle);
			y = shapeRecProps.center.pY - subSection.sectionProperties.distanceToCenter * Math.sin(pointAngle);
			const localAnchor = subSection.sectionProperties.localAnchor || [
				subSection.size[0] * 0.5,
				subSection.size[1] * 0.5,
			];
			subSection.setPosition(x - localAnchor[0], y - localAnchor[1]);
		}

		if (!this.sectionProperties.cropModeEnabled) {
			// VULCAN: a text box on the vector path re-wraps its text
			// LIVE and un-stretched instead of showing the CSS-scaled
			// ghost (which lied — the glyphs snapped back on release).
			// The wrap is computed client-side from cached structure,
			// zero server round-trip, so it stays smooth.
			if (this.tryLiveResizeReflow(shapeRecProps)) return;
			this.adjustSVGProperties(shapeRecProps);
		}
	}

	// True when this drag frame was handled as a live text re-wrap: the
	// object is a vector-Impress text box, so instead of scaling a ghost
	// we hand the vector section the re-laid-out portions for the new
	// frame and hide the stretch ghost. Captures the paragraph structure
	// once, on the first frame of the drag.
	private tryLiveResizeReflow(shapeRecProps: any): boolean {
		if (typeof RenderManager === 'undefined' ||
			!RenderManager.isVectorRendering() ||
			!VulcanLiveCanvas.isCanvasDoc())
			return false;
		const extraInfo: any = GraphicSelection.extraInfo;
		if (!extraInfo || typeof extraInfo.OrdNum !== 'number') return false;
		const selected = extraInfo.selectedOrdNums;
		if (Array.isArray(selected) && selected.length > 1) return false;
		const part = app.map._docLayer._selectedPart;
		const ordNum = extraInfo.OrdNum;
		if (!VulcanImpressResizeReflow.hasCapture(ordNum)) {
			if (!VulcanImpressResizeReflow.capture(part, ordNum)) return false;
		}
		// New frame in the vector page's twips, the same rectangle the
		// commit sends.
		const rect = cool.SimpleRectangle.fromCorePixels([
			shapeRecProps.center.pX - shapeRecProps.width * 0.5,
			shapeRecProps.center.pY - shapeRecProps.height * 0.5,
			shapeRecProps.width, shapeRecProps.height,
		]);
		let yTwips = rect.y1;
		const verticalOffset = app.map._docLayer.getFiledBasedViewVerticalOffset();
		if (verticalOffset) yTwips -= verticalOffset;
		const primitives = VulcanImpressResizeReflow.reflow(
			[rect.x1, yTwips, rect.width, rect.height]);
		if (!primitives) return false;
		VulcanImpressResizeReflow.setLiveOverride(ordNum, primitives);
		// Hide the stretch ghost; the vector content is the preview now.
		this.sectionProperties.parentHandlerSection.hideSVG();
		this.containerObject.requestReDraw();
		return true;
	}

	// True while a live text re-wrap is standing in for the ghost.
	private isReflowActive(): boolean {
		const ov = VulcanImpressResizeReflow.getLiveOverride();
		const extraInfo: any = GraphicSelection.extraInfo;
		return !!ov && !!extraInfo && ov.ordNum === extraInfo.OrdNum;
	}

	onMouseMove(point: cool.SimplePoint, dragDistance: Array<number>, e: MouseEvent) {
		if (this.containerObject.isDraggingSomething()) {
			this.stopPropagating();
			e.stopPropagation();

			if (this.sectionProperties.parentHandlerSection.isDragCancelled())
				return;

			this.moveHandlesOnDrag(point, e);
			this.containerObject.requestReDraw();

			// The re-wrap preview replaces the ghost; only show the ghost
			// when the drag is NOT being previewed as live text.
			if (!this.isReflowActive()) {
				this.sectionProperties.parentHandlerSection.sectionProperties.svg.style.opacity = 0.85;
				this.sectionProperties.parentHandlerSection.showSVG();
			}
		}
	}
}
