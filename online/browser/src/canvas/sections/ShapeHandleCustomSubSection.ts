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
	This class is for custom handlers of shapes.
*/

class ShapeHandleCustomSubSection extends ShapeHandleSubSection {
	constructor (parentHandlerSection: ShapeHandlesSection, sectionName: string, size: number[], documentPosition: cool.SimplePoint, ownInfo: any) {
		super(parentHandlerSection, sectionName, size, documentPosition, ownInfo);

		this.sectionProperties.mousePointerType = 'url(' + app.LOUtil.getURL('images/cursors/grab.svg') + ') 12 12, grab';
	}

	onDraw(frameCount?: number, elapsedTime?: number): void {
		if (VulcanImpressSelectEcho.suppressesSelectionChrome()) return;
		// A live move drag displaces frame and content; stationary
		// grip dots would trail the old position, so they stand down.
		if (this.sectionProperties.parentHandlerSection?.isMoveDragLive?.()) return;
		if (HelperLineStyles.handleStrokeStyle === null) HelperLineStyles.initiate();

		const rtlShift = app.map._docLayer.isCalcRTL() ? this.size[0] : 0;
		// Adjustment handle: yellow like PowerPoint's, with the shared gray ring.
		this.context.fillStyle = '#ffc83d';
		this.context.strokeStyle = HelperLineStyles.handleStrokeStyle;
		this.context.lineWidth = app.dpiScale;
		this.context.beginPath();
		this.context.arc(this.size[0] * 0.5 - rtlShift, this.size[1] * 0.5, 4.5 * app.dpiScale, 0, Math.PI * 2);
		this.context.closePath();
		this.context.fill();
		this.context.stroke();
	}

	onMouseEnter(point: cool.SimplePoint, e: MouseEvent) {
		this.context.canvas.style.cursor = this.sectionProperties.mousePointerType;
	}

	onMouseUp(point: cool.SimplePoint, e: MouseEvent): void {
		if (this.containerObject.isDraggingSomething()) {
			if (this.sectionProperties.parentHandlerSection.consumeDragCancelled()) {
				this.stopPropagating();
				e.stopPropagation();
				return;
			}

			const isRTL = app.map._docLayer.isCalcRTL();
			const docX = isRTL ? this.position[0] - point.pX : this.position[0] + point.pX;
			const parameters = {
				HandleNum: { type: 'long', value: this.sectionProperties.ownInfo.id },
				NewPosX: { type: 'long', value: Math.round(docX * app.pixelsToTwips) },
				NewPosY: { type: 'long', value: Math.round((point.pY + this.position[1]) * app.pixelsToTwips) }
			};

			app.map.sendUnoCommand('.uno:MoveShapeHandle', parameters);

			this.stopPropagating();
			e.stopPropagation();
		}
	}

	onMouseMove(point: cool.SimplePoint, dragDistance: Array<number>, e: MouseEvent) {
		if (this.containerObject.isDraggingSomething()) {
			this.stopPropagating();
			e.stopPropagation();
		}
	}
}

app.definitions.shapeHandleCustomSubSection = ShapeHandleCustomSubSection;
