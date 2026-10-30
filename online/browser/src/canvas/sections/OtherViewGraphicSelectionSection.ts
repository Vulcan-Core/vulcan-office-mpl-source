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

// This is used for other views' graphic selections.

class OtherViewGraphicSelectionSection extends CanvasSectionObject {
    documentObject: boolean = true;
    interactable: boolean = false; // We don't bother with events.
    zIndex: number = app.CSections.DefaultForDocumentObjects.processingOrder;
    drawingOrder: number = app.CSections.DefaultForDocumentObjects.drawingOrder;
    processingOrder: number = app.CSections.DefaultForDocumentObjects.processingOrder;

    static sectionNamePrefix = 'OtherViewGraphicSelection ';
    static sectionPointers: Array<OtherViewGraphicSelectionSection> = [];

    // Remote frames GLIDE between reports instead of teleporting: a short
    // transition makes a collaborator's move read as motion. Transient
    // only — no repaints at idle.
    private static readonly TRANSITION_MS = 140;

    constructor(viewId: number, rectangle: cool.SimpleRectangle, part: number, mode: number) {
        super(OtherViewGraphicSelectionSection.sectionNamePrefix + viewId);

        this.size = [rectangle.pWidth, rectangle.pHeight];
        this.position = [rectangle.pX1, rectangle.pY1];
        this.sectionProperties.color = app.LOUtil.rgbToHex(app.LOUtil.getViewIdColor(viewId));

        this.sectionProperties.viewId = viewId;
        this.sectionProperties.part = part;
        this.sectionProperties.mode = mode;
        this.sectionProperties.viewLockInfo = null;
        // {from: [x,y,w,h] core px, start: ms} while a glide is live.
        this.sectionProperties.transition = null;
    }

    // Linear interpolation of the frame geometry; exposed for tests.
    public static lerpFrame(from: number[], to: number[], t: number): number[] {
        const k = Math.max(0, Math.min(1, t));
        return [
            from[0] + (to[0] - from[0]) * k,
            from[1] + (to[1] - from[1]) * k,
            from[2] + (to[2] - from[2]) * k,
            from[3] + (to[3] - from[3]) * k,
        ];
    }

    public beginTransition(fromRect: number[], samePart: boolean): void {
        // Never glide across a slide change - that is navigation, not motion.
        if (!samePart) {
            this.sectionProperties.transition = null;
            return;
        }
        this.sectionProperties.transition = {
            from: fromRect,
            start: performance.now(),
        };
    }

    onDraw(frameCount?: number, elapsedTime?: number): void {
		this.context.save();
		this.context.setTransform(1, 0, 0, 1, 0, 0);
        this.context.strokeStyle = this.sectionProperties.color;
        this.context.lineWidth = 2;

        let rectangle = this.boundingRectangle;
        const transition = this.sectionProperties.transition;
        if (transition) {
            const t =
                (performance.now() - transition.start) /
                OtherViewGraphicSelectionSection.TRANSITION_MS;
            if (t >= 1) this.sectionProperties.transition = null;
            else {
                const frame = OtherViewGraphicSelectionSection.lerpFrame(
                    transition.from,
                    [this.position[0], this.position[1], this.size[0], this.size[1]],
                    t,
                );
                rectangle = cool.SimpleRectangle.fromCorePixels(frame);
                this.containerObject.requestReDraw();
            }
        }

        this.drawViewRectangle(rectangle);
        // Canvas documents (decks and pages) show WHO holds the selection:
        // they resorted to typing slide numbers at each other. Writer/Calc
        // already name remote users on their cursors.
        if (VulcanLiveCanvas.isCanvasDoc())
            this.drawNameChip(rectangle);
        this.context.restore();
    }

    // A small color pill above the frame's top-left carrying the view's
    // username. Same identity color as the frame; skipped when the roster
    // has no name for the view yet. Anchored to the rect being DRAWN, so
    // it rides a live glide.
    private drawNameChip(anchorRectangle: cool.SimpleRectangle): void {
        // getViewName lives on the runtime Leaflet map, not MapInterface.
        const map: any = app.map;
        const name = map && map.getViewName
            ? map.getViewName(this.sectionProperties.viewId)
            : null;
        if (!name) return;

        const fontPx = 10 * app.dpiScale;
        this.context.font = String(fontPx) + 'px sans-serif';
        this.context.textAlign = 'left';
        this.context.textBaseline = 'middle';
        const padX = 5 * app.dpiScale;
        const height = 15 * app.dpiScale;
        const width = this.context.measureText(name).width + 2 * padX;
        const radius = height / 2;
        const left = anchorRectangle.v1X - 0.5;
        const top = anchorRectangle.v1Y - height - 3 * app.dpiScale;

        this.context.beginPath();
        this.context.moveTo(left + radius, top);
        this.context.arcTo(left + width, top, left + width, top + height, radius);
        this.context.arcTo(left + width, top + height, left, top + height, radius);
        this.context.arcTo(left, top + height, left, top, radius);
        this.context.arcTo(left, top, left + width, top, radius);
        this.context.closePath();
        this.context.fillStyle = this.sectionProperties.color;
        this.context.fill();

        this.context.fillStyle = '#ffffff';
        this.context.fillText(name, left + padX, top + height / 2);
    }

    checkMyVisibility() {
        Util.ensureValue(app.activeDocument);

        let result = this.size[0] > 0 && this.size[1] > 0;

        if (result) {
            if (!app.map._docLayer.isWriter()) {
                if (this.sectionProperties.part !== app.map._docLayer._selectedPart ||
                    !app.activeDocument.isModeActive(this.sectionProperties.mode))
                    result = false;
            }
        }
        return result;
    }

    public static addOrUpdateGraphicSelectionIndicator(viewId: number, rectangleData: Array<string>, part: number, mode: number) {
        let rectangle = new cool.SimpleRectangle(0, 0, 0, 0);
        if (rectangleData)
            rectangle = new cool.SimpleRectangle(parseInt(rectangleData[0]), parseInt(rectangleData[1]), parseInt(rectangleData[2]), parseInt(rectangleData[3]));

        if (app.map._docLayer.isCalc() && app.map._docLayer.sheetGeometry)
            app.map._docLayer.sheetGeometry.convertRectangleToTileTwipsWithoutGridSnap(rectangle);

        const sectionName = OtherViewGraphicSelectionSection.sectionNamePrefix + viewId;
        let section: OtherViewGraphicSelectionSection;
        if (app.sectionContainer.doesSectionExist(sectionName)) {
            section = app.sectionContainer.getSectionWithName(sectionName) as OtherViewGraphicSelectionSection;
            const samePart = section.sectionProperties.part === part;
            const fromRect = [
                section.position[0],
                section.position[1],
                section.size[0],
                section.size[1],
            ];
            const moved =
                fromRect[0] !== rectangle.pX1 ||
                fromRect[1] !== rectangle.pY1 ||
                fromRect[2] !== rectangle.pWidth ||
                fromRect[3] !== rectangle.pHeight;
            section.sectionProperties.part = part;
            section.sectionProperties.mode = mode;
            section.size[0] = rectangle.pWidth;
            section.size[1] = rectangle.pHeight;
            section.setPosition(rectangle.pX1, rectangle.pY1);
            if (moved && rectangle.pWidth > 0)
                section.beginTransition(fromRect, samePart);
        }
        else {
            section = new OtherViewGraphicSelectionSection(viewId, rectangle, part, mode);
            app.sectionContainer.addSection(section);
            OtherViewGraphicSelectionSection.sectionPointers.push(section);
        }

        section.setShowSection(section.checkMyVisibility());
        app.sectionContainer.requestReDraw();
    }

    public static removeView(viewId: number) {
        const sectionName = OtherViewGraphicSelectionSection.sectionNamePrefix + viewId;
        if (app.sectionContainer.doesSectionExist(sectionName)) {
            const section = app.sectionContainer.getSectionWithName(sectionName) as OtherViewGraphicSelectionSection;
            OtherViewGraphicSelectionSection.sectionPointers.splice(OtherViewGraphicSelectionSection.sectionPointers.indexOf(section), 1);
            app.sectionContainer.removeSection(sectionName);
            app.sectionContainer.requestReDraw();
        }
    }

    public static setViewLockInfo(viewId: number, viewLockInfo: any) {
        const sectionName = OtherViewGraphicSelectionSection.sectionNamePrefix + viewId;
        if (app.sectionContainer.doesSectionExist(sectionName)) {
            const section = app.sectionContainer.getSectionWithName(sectionName) as OtherViewGraphicSelectionSection;
            section.sectionProperties.viewLockInfo = viewLockInfo;
        }
    }

    public static hasViewLockInfo(viewId: number) {
        const sectionName = OtherViewGraphicSelectionSection.sectionNamePrefix + viewId;
        if (app.sectionContainer.doesSectionExist(sectionName)) {
            const section = app.sectionContainer.getSectionWithName(sectionName) as OtherViewGraphicSelectionSection;
            return section.sectionProperties.viewLockInfo !== null;
        }
        else return false;
    }

    public static doesViewExist(viewId: number): boolean {
        const name = OtherViewGraphicSelectionSection.sectionNamePrefix + viewId;
        return app.sectionContainer.doesSectionExist(name);
    }

    public static getViewSection(viewId: number): OtherViewGraphicSelectionSection | null {
        if (OtherViewGraphicSelectionSection.doesViewExist(viewId)) {
            const name = OtherViewGraphicSelectionSection.sectionNamePrefix + viewId;
            return app.sectionContainer.getSectionWithName(name) as OtherViewGraphicSelectionSection;
        }
        return null;
    }

    public static updateVisibilities() {
        for (let i = 0; i < OtherViewGraphicSelectionSection.sectionPointers.length; i++) {
            const section = OtherViewGraphicSelectionSection.sectionPointers[i];
            section.setShowSection(section.checkMyVisibility());
        }
        app.sectionContainer.requestReDraw();
    }
}
