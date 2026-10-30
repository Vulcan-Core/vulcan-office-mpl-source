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

describe('CanvasSectionContainer', function() {

addCanvasToDom();
addMockCanvas(window);
global.requestAnimationFrame = window.requestAnimationFrame;
global.cancelAnimationFrame = window.cancelAnimationFrame;

const canvasWidth = 1024;
const canvasHeight = 768;
const halfWidth = Math.floor(canvasWidth / 2);
const halfHeight = Math.floor(canvasHeight / 2);
const originX = 0;
const originY = 0;

describe('Singleton section container', function() {

    beforeEach(function () {
        setupCanvasContainer(canvasWidth, canvasHeight);

        app.sectionContainer.enableDrawing();

        const docLayer = {};
        const tsManager = {};

        let onlySection = new CanvasSectionObject('OnlySection');
        onlySection.anchor = ['top', 'left'];
        onlySection.position = [originX, originY];
        onlySection.size = [1, 1];
        onlySection.expand = ['bottom', 'right'];
        onlySection.processingOrder = onlySection.drawingOrder = onlySection.zIndex = 1;
        onlySection.interactable = false;
        onlySection.sectionProperties = {
            docLayer: docLayer,
            tsManager: tsManager,
            strokeStyle: '#c0c0c0'
        };

        app.sectionContainer.addSection(onlySection);
    });

    it('Container should have OnlySection', function() {
        nodeassert.ok(app.sectionContainer.doesSectionExist('OnlySection'));
    });

    it('OnlySection PosSize checks', function () {
        const only = app.sectionContainer.getSectionWithName('OnlySection');
        const onlyRect = getSectionRectangle(only);
        assertPosSize(onlyRect,
            {
                x: originX,
                y: originY,
                width: canvasWidth - originX,
                height: canvasHeight - originY
            });
    });
});

describe('Touch gesture lifecycle', function() {

    let section: CanvasSectionObject;
    let mouseUpCalls: number;
    let clickCalls: number;
    let clickPointerType: string;
    let draggingSeenByMouseUp: boolean;
    let multiTouchEndCalls: number;
    let multiTouchCancelCalls: number;
    let multiTouchSeenByCancel: boolean;
    let mouseMoveCalls: number;
    let priorMode: any;

    function touchEvent(x: number, y: number, ended = false): TouchEvent {
        const touch = { clientX: x, clientY: y } as Touch;
        return {
            touches: ended ? [] : [touch],
            changedTouches: [touch]
        } as unknown as TouchEvent;
    }

    function multiTouchEvent(points: Array<[number, number]>): TouchEvent {
        const touches = points.map(([clientX, clientY]) => ({
            clientX,
            clientY
        } as Touch));
        return { touches, changedTouches: touches } as unknown as TouchEvent;
    }

    function installTouchSection(): void {
        setupCanvasContainer(canvasWidth, canvasHeight);

        mouseUpCalls = 0;
        clickCalls = 0;
        clickPointerType = null;
        draggingSeenByMouseUp = false;
        multiTouchEndCalls = 0;
        multiTouchCancelCalls = 0;
        multiTouchSeenByCancel = null;
        mouseMoveCalls = 0;
        section = new CanvasSectionObject('TouchSection');
        section.anchor = ['top', 'left'];
        section.position = [originX, originY];
        section.size = [1, 1];
        section.expand = ['bottom', 'right'];
        section.processingOrder = section.drawingOrder = section.zIndex = 1;
        section.onMouseUp = function () {
            mouseUpCalls++;
            draggingSeenByMouseUp = app.sectionContainer.isDraggingSomething();
        };
        section.onMouseMove = function () { mouseMoveCalls++; };
        section.onClick = function (_point, e) {
            clickCalls++;
            clickPointerType = (e as PointerEvent).pointerType;
        };
        section.onMultiTouchEnd = function () { multiTouchEndCalls++; };
        section.onMultiTouchCancel = function () {
            multiTouchCancelCalls++;
            multiTouchSeenByCancel =
                (app.sectionContainer as any).multiTouch;
        };
        app.sectionContainer.addSection(section);
        app.sectionContainer.enableDrawing();
    }

    interface CancelLifecycleOutcome {
        cancelAfterCancel: number;
        multiTouchSeenByCancel: boolean;
        endAfterCancel: number;
        mouseUpAfterTrailingEnd: number;
        mouseMoveAfterRecovery: number;
        mouseUpAfterRecovery: number;
        endAfterRecovery: number;
    }

    function runCancelLifecycle(
        cancelOverride?: (this: any, e: TouchEvent) => void,
        deliverTrailingEnd = true
    ): CancelLifecycleOutcome {
        installTouchSection();
        if (cancelOverride)
            (app.sectionContainer as any).onTouchCancel = cancelOverride;

        app.sectionContainer.onTouchStart(touchEvent(20, 20));
        app.sectionContainer.onTouchStart(
            multiTouchEvent([[20, 20], [80, 80]]));
        app.sectionContainer.onTouchMove(
            multiTouchEvent([[15, 15], [90, 90]]));
        app.sectionContainer.onTouchCancel(multiTouchEvent([]));

        const cancelAfterCancel = multiTouchCancelCalls;
        const endAfterCancel = multiTouchEndCalls;

        // Browsers may still deliver the terminal touchend that was queued
        // before touchcancel. It must not become a second terminal callback.
        if (deliverTrailingEnd)
            app.sectionContainer.onTouchEnd(touchEvent(90, 90, true));
        const mouseUpAfterTrailingEnd = mouseUpCalls;

        // The very next one-finger gesture must use the ordinary drag path.
        app.sectionContainer.onTouchStart(touchEvent(30, 30));
        app.sectionContainer.onTouchMove(touchEvent(60, 30));
        app.sectionContainer.onTouchEnd(touchEvent(60, 30, true));

        return {
            cancelAfterCancel,
            multiTouchSeenByCancel,
            endAfterCancel,
            mouseUpAfterTrailingEnd,
            mouseMoveAfterRecovery: mouseMoveCalls,
            mouseUpAfterRecovery: mouseUpCalls,
            endAfterRecovery: multiTouchEndCalls
        };
    }

    beforeEach(function () {
        priorMode = (window as any).mode;
        (window as any).mode = { isSmallScreenDevice: () => false };
        installTouchSection();
    });

    afterEach(function () {
        (window as any).mode = priorMode;
    });

    it('clears a completed touch drag without waiting for a compatibility click', function() {
        app.sectionContainer.onTouchStart(touchEvent(20, 20));
        app.sectionContainer.onTouchMove(touchEvent(80, 20));

        nodeassert.strictEqual(app.sectionContainer.isDraggingSomething(), true);

        app.sectionContainer.onTouchEnd(touchEvent(80, 20, true));
        nodeassert.strictEqual(draggingSeenByMouseUp, true);
        nodeassert.strictEqual(app.sectionContainer.isDraggingSomething(), false);

        const compatibilityMouse = {
            button: 0,
            clientX: 80,
            clientY: 20
        };
        app.sectionContainer.onMouseDown(new window.MouseEvent(
            'mousedown', compatibilityMouse));
        (app.sectionContainer as any).onMouseUp(new window.MouseEvent(
            'mouseup', compatibilityMouse));
        app.sectionContainer.onClick(new window.MouseEvent(
            'click', compatibilityMouse));

        nodeassert.strictEqual(mouseUpCalls, 1);
        nodeassert.strictEqual(clickCalls, 0);
        nodeassert.strictEqual(app.sectionContainer.isDraggingSomething(), false);
    });

    it('clears a latched drag after the final finger of a multi-touch gesture', function() {
        app.sectionContainer.onTouchStart(touchEvent(20, 20));
        app.sectionContainer.onTouchMove(touchEvent(80, 20));
        app.sectionContainer.onTouchStart(multiTouchEvent([[80, 20], [100, 40]]));

        app.sectionContainer.onTouchEnd(multiTouchEvent([[100, 40]]));

        nodeassert.strictEqual(multiTouchEndCalls, 0);
        nodeassert.strictEqual(app.sectionContainer.isDraggingSomething(), true);

        app.sectionContainer.onTouchEnd(multiTouchEvent([]));

        nodeassert.strictEqual(multiTouchEndCalls, 1);
        nodeassert.strictEqual(app.sectionContainer.isDraggingSomething(), false);
    });

    it('releases a two-touch start that never acquired a section owner', function() {
        app.sectionContainer.onTouchStart(
            multiTouchEvent([[20, 20], [80, 80]]));
        app.sectionContainer.onTouchEnd(multiTouchEvent([]));

        const compatibilityMouse = {
            button: 0,
            clientX: 80,
            clientY: 80
        };
        app.sectionContainer.onMouseDown(new window.MouseEvent(
            'mousedown', compatibilityMouse));
        (app.sectionContainer as any).onMouseUp(new window.MouseEvent(
            'mouseup', compatibilityMouse));
        app.sectionContainer.onClick(new window.MouseEvent(
            'click', compatibilityMouse));

        nodeassert.strictEqual(mouseUpCalls, 0);
        nodeassert.strictEqual(clickCalls, 0);

        app.sectionContainer.onTouchStart(touchEvent(30, 30));
        app.sectionContainer.onTouchMove(touchEvent(60, 30));
        app.sectionContainer.onTouchEnd(touchEvent(60, 30, true));

        nodeassert.strictEqual(mouseMoveCalls, 1);
        nodeassert.strictEqual(mouseUpCalls, 1);
        nodeassert.strictEqual(multiTouchEndCalls, 0);
    });

    it('routes one cancel, ignores a trailing end, and recovers one-finger input', function() {
        const outcome = runCancelLifecycle();

        nodeassert.deepStrictEqual(outcome, {
            cancelAfterCancel: 1,
            multiTouchSeenByCancel: false,
            endAfterCancel: 0,
            mouseUpAfterTrailingEnd: 0,
            mouseMoveAfterRecovery: 1,
            mouseUpAfterRecovery: 1,
            endAfterRecovery: 0
        });
    });

    it('calibrates the exact legacy touchcancel handler', function() {
        const outcome = runCancelLifecycle(function (e: TouchEvent): void {
            this.clearMousePositions();
            this.stopLongPress();
        }, false);

        nodeassert.strictEqual(outcome.cancelAfterCancel, 0);
        nodeassert.strictEqual(outcome.mouseMoveAfterRecovery, 0);
        nodeassert.strictEqual(outcome.endAfterRecovery, 1);
    });

    it('calibrates retained multi-touch and duplicate-end mutations', function() {
        const retainedMultiTouch = runCancelLifecycle(function (e: TouchEvent): void {
            this.stopLongPress();
            const owner = this.getSectionWithName(this.sectionOnMouseDown);
            if (owner)
                this.propagateOnMultiTouchCancel(owner, e);
            this.clearMousePositions();
        }, false);
        nodeassert.strictEqual(retainedMultiTouch.cancelAfterCancel, 1);
        nodeassert.strictEqual(retainedMultiTouch.multiTouchSeenByCancel, true);
        nodeassert.strictEqual(retainedMultiTouch.mouseMoveAfterRecovery, 0);
        nodeassert.strictEqual(retainedMultiTouch.endAfterRecovery, 1);

        const duplicateEnd = runCancelLifecycle(function (e: TouchEvent): void {
            this.stopLongPress();
            if (this.multiTouch) {
                this.multiTouch = false;
                const owner = this.getSectionWithName(this.sectionOnMouseDown);
                if (owner)
                    this.propagateOnMultiTouchCancel(owner, e);
            }
        });
        nodeassert.strictEqual(duplicateEnd.cancelAfterCancel, 1);
        nodeassert.strictEqual(duplicateEnd.mouseUpAfterTrailingEnd, 1);
        nodeassert.strictEqual(duplicateEnd.mouseUpAfterRecovery, 2);
    });

    it('keeps a touch tap available to the compatibility click', function() {
        app.sectionContainer.onTouchStart(touchEvent(20, 20));
        app.sectionContainer.onTouchEnd(touchEvent(20, 20, true));

        nodeassert.strictEqual(mouseUpCalls, 1);
        nodeassert.strictEqual(clickCalls, 0);

        app.sectionContainer.onClick(new window.MouseEvent('click', {
            clientX: 20,
            clientY: 20
        }));

        nodeassert.strictEqual(clickCalls, 1);
        nodeassert.strictEqual(clickPointerType, 'touch');
        nodeassert.strictEqual(app.sectionContainer.isDraggingSomething(), false);
    });
});

describe('Mouse click across a container resize', function() {

    let mouseUpCalls: number;
    let clickCalls: number;

    beforeEach(function () {
        setupCanvasContainer(canvasWidth, canvasHeight);

        mouseUpCalls = 0;
        clickCalls = 0;
        const section = new CanvasSectionObject('ClickSection');
        section.anchor = ['top', 'left'];
        section.position = [originX, originY];
        section.size = [1, 1];
        section.expand = ['bottom', 'right'];
        section.processingOrder = section.drawingOrder = section.zIndex = 1;
        section.onMouseUp = function () { mouseUpCalls++; };
        section.onClick = function () { clickCalls++; };
        app.sectionContainer.addSection(section);
        app.sectionContainer.enableDrawing();
    });

    // The host pulses the editor iframe 1 px wider for one frame 250 ms after
    // the editor shows (vulcan-office-viewport-sync.ts), so a first click into
    // a freshly opened document straddles a +1 px and a -1 px resize.
    it('delivers the release and the click of a press that straddles a 1 px pulse', function() {
        const mouse = { button: 0, clientX: 300, clientY: 200 };
        app.sectionContainer.onMouseDown(new window.MouseEvent('mousedown', mouse));
        app.sectionContainer.onResize(canvasWidth + 1, canvasHeight);
        app.sectionContainer.onResize(canvasWidth, canvasHeight);
        (app.sectionContainer as any).onMouseUp(new window.MouseEvent('mouseup', mouse));
        app.sectionContainer.onClick(new window.MouseEvent('click', mouse));

        nodeassert.deepStrictEqual({ mouseUpCalls, clickCalls }, { mouseUpCalls: 1, clickCalls: 1 });
    });

    // The window blurred with the button held and the button came up outside
    // it, so the release never arrived. A resize keeps a held press, and the
    // next move past the drag tolerance must not start a drag with no button held.
    it('does not turn a press whose release was lost into a drag after a resize', function() {
        app.sectionContainer.onMouseDown(new window.MouseEvent('mousedown', { button: 0, buttons: 1, clientX: 300, clientY: 200 }));
        (app.sectionContainer as any).onWindowBlur();
        app.sectionContainer.onResize(canvasWidth + 1, canvasHeight);
        (app.sectionContainer as any).onMouseMove(new window.MouseEvent('mousemove', { buttons: 0, clientX: 320, clientY: 200 }));

        nodeassert.strictEqual(app.sectionContainer.isDraggingSomething(), false, 'a 20 px move with no button held started a drag');
    });
});

describe('Horizontally packed two section container', function() {

    beforeEach(function () {
        setupCanvasContainer(canvasWidth, canvasHeight);

        const docLayer = {};
        const tsManager = {};

        let leftSection = new CanvasSectionObject('LeftSection');
        leftSection.anchor = ['top', 'left'];
        leftSection.position = [originX, originY];
        leftSection.size = [halfWidth, 1];
        leftSection.expand = ['bottom'];
        leftSection.processingOrder = leftSection.drawingOrder = leftSection.zIndex = 1;
        leftSection.interactable = false;
        leftSection.sectionProperties = {
            docLayer: docLayer,
            tsManager: tsManager,
            strokeStyle: '#c0c0c0'
        };
        app.sectionContainer.addSection(leftSection);

        let rightSection = new CanvasSectionObject('RightSection');
        rightSection.anchor = ['top', ['LeftSection', 'right', 'left']] as (string[] | Array<Array<string>>);
        rightSection.position = [originX, originY];
        rightSection.size = [1, 1];
        rightSection.expand = ['bottom', 'right'];
        rightSection.processingOrder = rightSection.drawingOrder = 2;
        rightSection.zIndex = 1;
        rightSection.interactable = false;
        rightSection.sectionProperties = {
            docLayer: docLayer,
            tsManager: tsManager,
            strokeStyle: '#c0c0c0'
        };
        app.sectionContainer.addSection(rightSection);

        app.sectionContainer.enableDrawing();
    });

    it('Container should have LeftSection', function() {
        nodeassert.ok(app.sectionContainer.doesSectionExist('LeftSection'));
    });

    it('Container should have RightSection', function() {
        nodeassert.ok(app.sectionContainer.doesSectionExist('RightSection'));
    });

    it('LeftSection PosSize checks', function () {
        const left = app.sectionContainer.getSectionWithName('LeftSection');
        const leftRect = getSectionRectangle(left);
        assertPosSize(leftRect,
            {
                x: originX,
                y: originY,
                width: halfWidth,
                height: canvasHeight - originY
            });
    });

    it('RightSection PosSize checks', function () {
        const right = app.sectionContainer.getSectionWithName('RightSection');
        const rightRect = getSectionRectangle(right);
        assertPosSize(rightRect,
            {
                x: 1 + halfWidth + originX,
                y: originY,
                width: halfWidth - 1 - originX,
                height: canvasHeight - originY
            });
    });
});

describe('Vertically packed two section container', function() {

    beforeEach(function () {
        setupCanvasContainer(canvasWidth, canvasHeight);

        const docLayer = {};
        const tsManager = {};

        let topSection = new CanvasSectionObject('TopSection');
        topSection.anchor = ['top', 'left'];
        topSection.position = [originX, originY];
        topSection.size = [1, halfHeight];
        topSection.expand = ['right'];
        topSection.processingOrder = topSection.drawingOrder = topSection.zIndex = 1;
        topSection.interactable = false;
        topSection.sectionProperties = {
            docLayer: docLayer,
            tsManager: tsManager,
            strokeStyle: '#c0c0c0'
        };
        app.sectionContainer.addSection(topSection);

        let bottomSection = new CanvasSectionObject('BottomSection');
        bottomSection.anchor = [['TopSection', 'bottom', 'top'], 'left'] as (string[] | Array<Array<string>>);
        bottomSection.position = [originX, originY];
        bottomSection.size = [1, 1];
        bottomSection.expand = ['bottom', 'right'];
        bottomSection.processingOrder = bottomSection.drawingOrder = 2;
        bottomSection.zIndex = 1;
        bottomSection.interactable = false;
        bottomSection.sectionProperties = {
            docLayer: docLayer,
            tsManager: tsManager,
            strokeStyle: '#c0c0c0'
        };
        app.sectionContainer.addSection(bottomSection);

        app.sectionContainer.enableDrawing();
    });

    it('Container should have TopSection', function() {
        nodeassert.ok(app.sectionContainer.doesSectionExist('TopSection'));
    });

    it('Container should have BottomSection', function() {
        nodeassert.ok(app.sectionContainer.doesSectionExist('BottomSection'));
    });

    it('TopSection PosSize checks', function () {
        const top = app.sectionContainer.getSectionWithName('TopSection');
        const topRect = getSectionRectangle(top);
        assertPosSize(topRect,
            {
                x: originX,
                y: originY,
                width: canvasWidth - originX,
                height: halfHeight
            });
    });

    it('BottomSection PosSize checks', function () {
        const bottom = app.sectionContainer.getSectionWithName('BottomSection');
        const bottomRect = getSectionRectangle(bottom);
        assertPosSize(bottomRect,
            {
                x: originX,
                y: 1 + halfHeight + originY,
                width: canvasWidth - originX,
                height: halfHeight - 1 - originY
            });
    });
});

// '-left' layout is usually used for RTL where it is used to attach a section's right to the left of another section.
describe('Horizontally packed two section container with -left layout', function() {

    beforeEach(function () {
        setupCanvasContainer(canvasWidth, canvasHeight);

        const docLayer = {};
        const tsManager = {};

        let rightSection = new CanvasSectionObject('RightSection');
        rightSection.anchor = ['top', 'right'];
        rightSection.position = [originX, originY];
        rightSection.size = [halfWidth, 1];
        rightSection.expand = ['bottom'];
        rightSection.processingOrder = rightSection.drawingOrder = rightSection.zIndex = 1;
        rightSection.interactable = false;
        rightSection.sectionProperties = {
            docLayer: docLayer,
            tsManager: tsManager,
            strokeStyle: '#c0c0c0'
        };
        app.sectionContainer.addSection(rightSection);

        let leftSection = new CanvasSectionObject('LeftSection');
        leftSection.anchor = ['top', ['RightSection', '-left', 'right']] as (string[] | Array<Array<string>>); // Attach LeftSection's right to left of RightSection.
        leftSection.position = [originX, originY];
        leftSection.size = [1, 1];
        leftSection.expand = ['bottom', 'left'];
        leftSection.processingOrder = leftSection.drawingOrder = 2;
        leftSection.zIndex = 1;
        leftSection.interactable = false;
        leftSection.sectionProperties = {
            docLayer: docLayer,
            tsManager: tsManager,
            strokeStyle: '#c0c0c0'
        };
        app.sectionContainer.addSection(leftSection);

        app.sectionContainer.enableDrawing();
    });


    it('Container should have LeftSection', function() {
        nodeassert.ok(app.sectionContainer.doesSectionExist('LeftSection'));
    });

    it('Container should have RightSection', function() {
        nodeassert.ok(app.sectionContainer.doesSectionExist('RightSection'));
    });

    it('LeftSection PosSize checks', function () {
        const left = app.sectionContainer.getSectionWithName('LeftSection');
        const leftRect = getSectionRectangle(left);
        assertPosSize(leftRect,
            {
                x: 0,
                y: originY,
                width: halfWidth - 1,
                height: canvasHeight - originY
            });
    });

    it('RightSection PosSize checks', function () {
        const right = app.sectionContainer.getSectionWithName('RightSection');
        const rightRect = getSectionRectangle(right);
        assertPosSize(rightRect,
            {
                x: canvasWidth - originX - halfWidth,
                y: originY,
                width: halfWidth,
                height: canvasHeight - originY
            });
    });
});

describe('Display density changes', function() {

    afterEach(function () {
        restoreMatchMedia();
        setDevicePixelRatio(1);
    });

    it('re-lays out the container when the display density changes', function () {
        installFakeMatchMedia();
        // Construct at the baseline density. onResize during setup syncs
        // app.dpiScale to it, so the container starts in step with the display.
        setDevicePixelRatio(1);
        setupCanvasContainer(canvasWidth, canvasHeight);

        let resizeCalls = 0;
        app.sectionContainer.onResize = function () { resizeCalls++; };

        // The display density moves; app.dpiScale still holds the old value
        // until a relayout catches up.
        setDevicePixelRatio(2);

        // A listener was registered while the container was constructed.
        nodeassert.ok(fakeMediaQueries.length > 0);
        fakeMediaQueries[fakeMediaQueries.length - 1].fireChange();

        nodeassert.strictEqual(resizeCalls, 1);
    });

    it('does not re-lay out when the density has not actually moved', function () {
        installFakeMatchMedia();
        setDevicePixelRatio(1);
        setupCanvasContainer(canvasWidth, canvasHeight);

        let resizeCalls = 0;
        app.sectionContainer.onResize = function () { resizeCalls++; };

        // A change event fires but the density still matches app.dpiScale.
        fakeMediaQueries[fakeMediaQueries.length - 1].fireChange();

        nodeassert.strictEqual(resizeCalls, 0);
    });
});

describe('Zoom settling', function() {

    it('requests one redraw when the zoom-changed state settles', function () {
        setupCanvasContainer(canvasWidth, canvasHeight);

        let redrawCalls = 0;
        app.sectionContainer.requestReDraw = function () { redrawCalls++; };

        // A repeated settled value is not a new transition.
        app.sectionContainer.setZoomChanged(false);
        nodeassert.strictEqual(redrawCalls, 0);

        app.sectionContainer.setZoomChanged(true);
        app.sectionContainer.setZoomChanged(false);
        nodeassert.strictEqual(redrawCalls, 1);

        app.sectionContainer.setZoomChanged(false);
        nodeassert.strictEqual(redrawCalls, 1);
    });
});

describe('Phone Calc selection handle edge target', function() {

    it('keeps the full hit box on-screen without moving the painted anchor', function () {
        const oldMap = app.map;
        const handle = Object.create(CellSelectionHandle.prototype) as CellSelectionHandle;
        handle.sectionProperties = { mobileChrome: true, hitRadius: 22 };
        handle.documentObject = true;
        handle.myTopLeft = [364.3, 208];
        handle.size = [44, 44];
        handle.containerObject = <any>{ getWidth: () => 393, getHeight: () => 607 };
        (<any>app).map = { _docLayer: { isCalcRTL: () => false } };

        try {
            nodeassert.strictEqual(handle.isHit([348.9, 230]), false);
            nodeassert.strictEqual(handle.isHit([349, 230]), true);
            nodeassert.strictEqual(handle.isHit([392.9, 230]), true);
            nodeassert.strictEqual(handle.isHit([393.1, 230]), false);
            nodeassert.deepEqual(handle.myTopLeft, [364.3, 208]);
            nodeassert.strictEqual(handle.myTopLeft[0] + handle.sectionProperties.hitRadius, 386.3);

            handle.myTopLeft = [100, 590];
            nodeassert.strictEqual(handle.isHit([122, 562.9]), false);
            nodeassert.strictEqual(handle.isHit([122, 563]), true);
            nodeassert.strictEqual(handle.isHit([122, 606.9]), true);
        } finally {
            (<any>app).map = oldMap;
        }
    });

    it('preserves the stock box off-phone and clamps the RTL edge on-phone', function () {
        const oldMap = app.map;
        const handle = Object.create(CellSelectionHandle.prototype) as CellSelectionHandle;
        handle.sectionProperties = { mobileChrome: false };
        handle.documentObject = true;
        handle.myTopLeft = [364.3, 208];
        handle.size = [44, 44];
        handle.containerObject = <any>{ getWidth: () => 393, getHeight: () => 607 };
        (<any>app).map = { _docLayer: { isCalcRTL: () => false } };

        try {
            nodeassert.strictEqual(handle.isHit([349, 230]), false);
            nodeassert.strictEqual(handle.isHit([365, 230]), true);

            handle.sectionProperties.mobileChrome = true;
            handle.myTopLeft = [15, 208];
            (<any>app).map._docLayer.isCalcRTL = () => true;
            nodeassert.strictEqual(handle.isHit([0, 230]), true);
            nodeassert.strictEqual(handle.isHit([44.1, 230]), false);
        } finally {
            (<any>app).map = oldMap;
        }
    });
});
});
