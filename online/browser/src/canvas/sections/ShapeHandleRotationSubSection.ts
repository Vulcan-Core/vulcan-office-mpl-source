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

class ShapeHandleRotationSubSection extends ShapeHandleSubSection {
	constructor (parentHandlerSection: ShapeHandlesSection, sectionName: string, size: number[], documentPosition: cool.SimplePoint, ownInfo: any) {
		super(parentHandlerSection, sectionName, size, documentPosition, ownInfo);

		this.sectionProperties.lastDraggingDistance = null;
		this.sectionProperties.cursorStyle = 'url(' + app.LOUtil.getURL('images/cursors/rotate.svg') + ') 12 12, pointer';

		app.events.on('TextCursorVisibility', this.onTextCursorVisibility.bind(this));
	}

	calculateAngle(center: cool.SimplePoint, target: cool.SimplePoint): number {
		let angle = Math.atan2(target.y - center.y, target.x - center.x);

		while (angle < 0)
			angle += 2 * Math.PI;

		while (angle > Math.PI * 2)
			angle -= Math.PI * 2;

		angle = (angle * 180) / Math.PI;
		angle *= 100; // Core side multiplies degrees with 100.

		return angle;
	}

	onMouseEnter(point: cool.SimplePoint, e: MouseEvent): void {
		this.context.canvas.style.cursor = this.sectionProperties.cursorStyle;
	}

	onDraw(frameCount?: number, elapsedTime?: number): void {
		if (VulcanImpressSelectEcho.suppressesSelectionChrome()) return;
		// A live move drag displaces frame and content; stationary
		// grip dots would trail the old position, so they stand down.
		if (this.sectionProperties.parentHandlerSection?.isMoveDragLive?.()) return;
		if (HelperLineStyles.handleFillStyle === null) HelperLineStyles.initiate();

		const addition = (this.documentObject === true && app.map._docLayer.isCalcRTL()) ? -this.size[0] : 0;
		const centerX = this.size[0] * 0.5 + addition;
		const centerY = this.size[1] * 0.5;

		// The disc PAINTS at the drawn size. this.size is the grab box, 44 px
		// on a phone, and a 44 px white disc floating above the shape would
		// read as an object rather than a handle. The centre stays the box
		// centre because that is where the handle point is; only the radii come
		// from the drawn size, and on desktop the two sizes are equal.
		const drawnWidth = this.sectionProperties.parentHandlerSection
			.sectionProperties.rotationHandleWidth;

		// White disc with a thin gray ring, matching the scaling handles.
		this.context.fillStyle = HelperLineStyles.handleFillStyle;
		this.context.strokeStyle = HelperLineStyles.handleStrokeStyle;
		this.context.lineWidth = app.dpiScale;
		this.context.beginPath();
		this.context.arc(centerX, centerY, drawnWidth * 0.5 - app.dpiScale, 0, Math.PI * 2);
		this.context.closePath();
		this.context.fill();
		this.context.stroke();

		// Circular-arrow glyph inside the disc.
		const glyphRadius = drawnWidth * 0.24;
		this.context.beginPath();
		this.context.lineWidth = 1.2 * app.dpiScale;
		this.context.arc(centerX, centerY, glyphRadius, -Math.PI * 0.35, Math.PI * 0.85);
		this.context.stroke();

		// Arrowhead at the end of the arc, tangent to it (clockwise).
		const endAngle = Math.PI * 0.85;
		const tipBaseX = centerX + glyphRadius * Math.cos(endAngle);
		const tipBaseY = centerY + glyphRadius * Math.sin(endAngle);
		const tangentAngle = endAngle + Math.PI * 0.5; // Direction of travel along the arc.
		const arrowSize = 2.6 * app.dpiScale;

		this.context.beginPath();
		this.context.moveTo(tipBaseX + arrowSize * Math.cos(tangentAngle), tipBaseY + arrowSize * Math.sin(tangentAngle));
		this.context.lineTo(tipBaseX + arrowSize * 0.8 * Math.cos(tangentAngle - Math.PI * 0.66), tipBaseY + arrowSize * 0.8 * Math.sin(tangentAngle - Math.PI * 0.66));
		this.context.lineTo(tipBaseX + arrowSize * 0.8 * Math.cos(tangentAngle + Math.PI * 0.66), tipBaseY + arrowSize * 0.8 * Math.sin(tangentAngle + Math.PI * 0.66));
		this.context.closePath();
		this.context.fillStyle = HelperLineStyles.handleStrokeStyle;
		this.context.fill();
	}

	/*
		On a phone, measure both angles to the handle's CENTRE.

		this.position and initialPosition are section TOP-LEFTS, so each angle
		is taken to a point half a box up and left of the handle it stands for;
		the two biased angles do not cancel, they leave error in the delta. On
		desktop that bias is half of the 15 px drawn handle and it is exactly
		what HEAD ships - correcting it there would be an unrequested,
		browser-untested change to desktop rotation maths, so the offset is 0
		and getAngleDifference reduces to HEAD line for line. The phone grab box
		is 44 px, which would triple the bias, so there the correction applies.
	*/
	private handleHalfBox(): number[] {
		if (!this.sectionProperties.parentHandlerSection.sectionProperties.phoneChrome)
			return [0, 0];

		return [this.size[0] * 0.5, this.size[1] * 0.5];
	}

	// Where the dragged handle is right now, in document coordinates: the
	// angle maths and the chip's anchor read the same point.
	private draggedHandleCentre(): cool.SimplePoint {
		const distance = this.sectionProperties.lastDraggingDistance;
		const point = new cool.SimplePoint(distance[0] * app.pixelsToTwips, distance[1] * app.pixelsToTwips);
		const halfBox = this.handleHalfBox();

		point.pX += this.position[0] + halfBox[0];
		point.pY += this.position[1] + halfBox[1];

		return point;
	}

	// This is called after dragging the rotation handler. It re-calculates initial angle with the handler's new position.
	// snapTo15Degrees (Shift held) rounds the resulting absolute angle to the nearest 15° (PowerPoint).
	getAngleDifference(snapTo15Degrees: boolean = false): number {
		const draggedToPoint = this.draggedHandleCentre();
		const halfBox = this.handleHalfBox();

		Util.ensureValue(GraphicSelection.rectangle);
		const selectionCenter = new cool.SimplePoint(GraphicSelection.rectangle.center[0], GraphicSelection.rectangle.center[1]);

		// Clone: this runs on every mouse move and initialPosition must not
		// drift by half a box each time. Kept unconditional - on desktop the
		// two additions below are zero, so the clone is the only difference
		// from HEAD and it is unobservable.
		const initialPoint = this.sectionProperties.ownInfo.initialPosition.clone();
		initialPoint.pX += halfBox[0];
		initialPoint.pY += halfBox[1];

		const initialAngle = this.calculateAngle(selectionCenter, initialPoint);
		const newAngle = this.calculateAngle(selectionCenter, draggedToPoint);

		let difference = initialAngle - newAngle;

		if (snapTo15Degrees) {
			// Angles are in 1/100 degree. Snap the absolute angle, not the delta.
			const currentAngle = GraphicSelection.selectionAngle ?? 0;
			const targetAngle = Math.round((currentAngle + difference) / 1500) * 1500;
			difference = targetAngle - currentAngle;
		}

		return difference;
	}

	onMouseUp(point: cool.SimplePoint, e: MouseEvent): void {
		if (this.containerObject.isDraggingSomething()) {
			if (this.sectionProperties.parentHandlerSection.consumeDragCancelled()) {
				this.sectionProperties.parentHandlerSection.hideSVG();
				return;
			}

			if (this.sectionProperties.lastDraggingDistance) {
				Util.ensureValue(GraphicSelection.rectangle);
				const center = GraphicSelection.rectangle.center;

				const commandParameters = {
					'TransformRotationDeltaAngle': {
						'type': 'long',
						'value': this.getAngleDifference(e.shiftKey)
					},
					'TransformRotationX': {
						'type': 'long',
						'value': center[0]
					},
					'TransformRotationY': {
						'type': 'long',
						'value': center[1]
					}
				};

				app.map.sendUnoCommand('.uno:TransformDialog ', commandParameters);
			}
			// The ghost stays visible until the post-commit graphicselection
			// arrives, so the shape doesn't blink back to its old angle.
			this.sectionProperties.parentHandlerSection.scheduleGhostFallbackHide();
		}
	}

	onMouseMove(position: cool.SimplePoint, distance: number[], e?: MouseEvent) {
		if (!this.containerObject.isDraggingSomething()) return;

		const parentHandlerSection = this.sectionProperties.parentHandlerSection;
		if (parentHandlerSection.isDragCancelled())
			return;

		this.sectionProperties.lastDraggingDistance = distance;

		if (parentHandlerSection.sectionProperties.phoneChrome) {
			// The reference app leaves the live object axis-aligned mid-rotate
			// and states the angle twice instead — a wireframe at the
			// destination angle and a chip reading it — so the ghost's rotate
			// transform has nothing left to say here.
			parentHandlerSection.setRotationFeedback(
				this.getAngleDifference(e?.shiftKey ?? false),
				this.draggedHandleCentre(),
			);
			this.containerObject.requestReDraw();
			return;
		}

		if (parentHandlerSection.sectionProperties.svg) {
			parentHandlerSection.sectionProperties.svg.style.opacity = 1;
			const differenceDegree100 = this.getAngleDifference(e?.shiftKey ?? false);
			parentHandlerSection.sectionProperties.svg.style.transform = 'rotate(' + (-differenceDegree100 / 100) + 'deg)';
			this.containerObject.requestReDraw();
			parentHandlerSection.showSVG();
		}
	}
}

app.definitions.shapeHandleRotationSubSection = ShapeHandleRotationSubSection;
