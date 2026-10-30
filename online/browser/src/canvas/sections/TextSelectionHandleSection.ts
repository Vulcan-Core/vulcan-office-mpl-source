// @ts-strict-ignore
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

class TextSelectionHandle extends HTMLObjectSection {
	_showSection: boolean = true; // Store the internal show/hide section through forced non-touchscreen hides...

	/*
		GEOMETRY. Every number in this block is CSS px; `position`, `size`,
		`point.pX/pY` and `myTopLeft` are CORE px. The two are related by
		app.dpiScale (= window.devicePixelRatio, CanvasSectionContainer.ts
		L1615), so a CSS-px constant entering any of those must be MULTIPLIED
		by dpiScale. Mixing them is exactly how the start-handle drop bug
		below was written, so every conversion in this file names its units.

		The art is the SVG behind .text-selection-handle-* in
		css/selectionMarkers.css, intrinsically 30x44: a 30x30 teardrop in the
		TOP 30 px, with the bottom 14 px of the image deliberately empty so
		the box already reaches a little below the art. Desktop and tablet
		draw it 1:1; the phone draws it smaller (round-8 D1) through
		mask-size / background-size, uniformly, so every phone art number
		below is the intrinsic one at phoneArtWidth/30 scale.
	*/
	private static readonly stockArtWidth = 30; // CSS px — the SVG's intrinsic width.
	private static readonly stockArtBoxHeight = 44; // CSS px — intrinsic height (30 art + 14 empty grab).

	/*
		Round-8 D1 (ruling X-1): the phone teardrop shrinks, conservatively.
		22 CSS px is Material v1's published 22 dp text-selection handle — the
		only sourced size anchor; Google's own Docs teardrop is UNMEASURED
		(the atlas has no exhibit of a Docs iOS text selection). JUDGMENT:
		refine this one number when the designer supplies a Docs screenshot —
		nothing else in the geometry moves with it by hand, everything below
		derives. Keep equal to the phone mask-size/background-size width in
		css/selectionMarkers.css (the mocha suite pins the pair).
	*/
	private static readonly phoneArtWidth = 22; // CSS px.

	// Drawn art width for the CURRENT chrome. A bare constant here would
	// shrink desktop and tablet too — the accessor is the phone gate.
	public static artWidth(): number {
		return TextSelectionHandle.isPhoneChrome()
			? TextSelectionHandle.phoneArtWidth
			: TextSelectionHandle.stockArtWidth;
	}

	// The SVG scales uniformly (mask-size: <w>px auto), so the drawn box
	// height is the intrinsic 44 at the same scale. Fractional is fine — it
	// only sizes the div and the section.
	public static artBoxHeight(): number {
		return (
			(TextSelectionHandle.stockArtBoxHeight *
				TextSelectionHandle.artWidth()) /
			TextSelectionHandle.stockArtWidth
		);
	}

	/*
		SPLIT from artWidth (round-8 X-1, the :291 trap): the start handle's
		art points up-RIGHT, so its art origin sits one drawn-art-width LEFT
		of the character it selects — this offset converts between the art
		origin and the selection edge core is told about, in postSelectionEdge
		and in TextSelections.updateMarkers. For this SVG the tip is at the
		art's right edge, so the value IS the drawn width — but the two answer
		different questions, and while they were one readonly field a CSS-only
		art shrink would have silently moved where Writer thinks the selection
		edge is by exactly the size delta. The mocha suite pins the identity
		(and the CSS registration), so a drift fails red instead of shipping a
		floating tip.
	*/
	public static startTipOffsetX(): number {
		return TextSelectionHandle.artWidth();
	}

	/*
		Decouple the GRAB box from the DRAWN art: the same split
		CellSelectionHandleSection ships as hitRadius vs circleRadius. It
		cannot be expressed the same way here — that section
		paints itself in onDraw and can simply centre a small arc in a big box,
		while this one is an HTML div with a background-image — so the phone
		treatment is a bigger section `size` plus a compensating
		background-position in CSS, which comes to the same thing: the art does
		not move, only the invisible hit region grows.

		Stock is a 30 CSS px box with the art filling it edge to edge: ZERO
		slop either side of the teardrop, and the box top IS the art top, so
		ZERO grab above it. You are aiming a ~44 px fingertip at 30 px, and a
		miss does not no-op — it falls through to the canvas underneath and
		collapses the very selection you were extending. The side slop is
		whatever takes the box to the 44 px floor this chrome advertises
		(vulcan-theme.css §13 "48px touch targets") — it GROWS as the art
		shrinks, so the finger target never moves with a D1 size refinement;
		12 px above is the number the shipped Calc handle already uses.
		Desktop and tablet keep box == art exactly as before — both offsets
		are 0 and every expression below reduces to the line it replaced.

		Keep phoneSlop equal to the background-position / mask-position in
		the phone block of css/selectionMarkers.css. They are the only place
		the split is decided.
	*/
	private static readonly phoneTouchFloor = 44; // CSS px.
	private static readonly phoneSlopX = // CSS px, each side: (44 − 22) / 2 = 11.
		(TextSelectionHandle.phoneTouchFloor - TextSelectionHandle.phoneArtWidth) / 2;
	private static readonly phoneSlopTop = 12; // CSS px, above the art.

	/*
		D4: while the finger drags, post the moving edge to core instead of
		waiting for finger-up. CellSelectionHandle.onDrag posts on EVERY move;
		this one is throttled because a Writer edge post makes core re-run a
		text selection over a document (not a cell range) and broadcast a
		`textselection` to every view in the session, while touchmove fires at
		60 Hz — 120 Hz on a ProMotion phone.

		40 ms = 25 Hz. Above ~20 Hz discrete updates stop reading as steps and
		start reading as motion, and at a normal drag speed the finger travels
		well under one character between posts, so the highlight never visibly
		trails. It is also roughly one post per 2.4 frames at 60 Hz — anything
		faster is work the screen cannot show. The exact round trip to core on
		a real handset is UNKNOWN without a device; if it turns out to be
		slower than 40 ms this number should go UP, never down.
	*/
	private static readonly dragPostIntervalMs = 40;

	public static isPhoneChrome(): boolean {
		// js/global.js L471-472 stamps this for small-screen devices only;
		// tablets and desktop never carry it. Flipping this one predicate to
		// false restores the stock geometry everywhere.
		return document.documentElement.classList.contains('vulcan-mobile-chrome');
	}

	// CSS px the SVG's own origin is inset from the section (and div) origin.
	public static artOffsetX(): number {
		return TextSelectionHandle.isPhoneChrome() ? TextSelectionHandle.phoneSlopX : 0;
	}

	public static artOffsetY(): number {
		return TextSelectionHandle.isPhoneChrome() ? TextSelectionHandle.phoneSlopTop : 0;
	}

	// CSS px. HTMLObjectSection turns these into the section's CORE-px `size`
	// AND the div's inline width/height, so this is the single source for both
	// the hit box and the painted box.
	public static boxWidth(): number {
		return TextSelectionHandle.artWidth() + 2 * TextSelectionHandle.artOffsetX();
	}

	public static boxHeight(): number {
		return TextSelectionHandle.artBoxHeight() + TextSelectionHandle.artOffsetY();
	}

	constructor (sectionName: string, objectWidth: number, objectHeight: number, documentPosition: cool.SimplePoint,  extraClass: string = "", showSection: boolean = false) {
		super(sectionName, objectWidth, objectHeight, documentPosition, extraClass, showSection);

		this.sectionProperties.dragActive = false;
		// Section-local CORE px where this gesture grabbed the box. Preserving
		// this offset makes the handle translate with the finger instead of
		// snapping its art origin under the finger on the first move.
		this.sectionProperties.grabOffset = [0, 0];
		// Where the finger was at this drag's latest move, in viewport CORE
		// px, or null when no drag is in progress. onMultiTouchStart ends the
		// drag there.
		this.sectionProperties.lastDragFinger = null;

		// Util.throttle (src/app/Util.ts L43) is leading edge + trailing: the
		// first move posts at once so the highlight starts following
		// immediately, and the last move inside a window is still delivered
		// when the window closes, so a finger that stops between ticks does
		// not leave the selection short of where it is pointing.
		this.sectionProperties.postWhileDragging = Util.throttle(
			(x: number, y: number) => {
				// A queued trailing call can land after the finger lifted.
				// onDragEnd has posted the exact edge by then, so replaying a
				// mid-drag point would drag the selection back off it.
				if (this.sectionProperties.dragActive) this.postSelectionEdge(x, y);
			},
			TextSelectionHandle.dragPostIntervalMs,
			this,
		);
	}

	onDrag(point: cool.SimplePoint) {
		// point is section-local CORE px; myTopLeft and position are CORE px.
		const fingerX = this.myTopLeft[0] + point.pX; // CORE px, viewport space.
		const fingerY = this.myTopLeft[1] + point.pY; // CORE px, viewport space.
		this.sectionProperties.lastDragFinger = [fingerX, fingerY];

		// Keep the exact point grabbed inside the enlarged box under the finger,
		// so the first move translates the handle instead of snapping it. The
		// art remains inset from that box by artOffset. CSS-px constants cross
		// into CORE px with * dpiScale; desktop offsets are 0.
		const artDX = TextSelectionHandle.artOffsetX() * app.dpiScale; // CORE px.
		const artDY = TextSelectionHandle.artOffsetY() * app.dpiScale; // CORE px.

		const grabOffset = this.sectionProperties.grabOffset;
		const candidateX = Math.round(
			(fingerX - grabOffset[0]) / app.dpiScale,
		); // CSS px, box origin for style.left.
		const candidateY = Math.round(
			(fingerY - grabOffset[1]) / app.dpiScale,
		); // CSS px, box origin for style.top.

		this.sectionProperties.objectDiv.style.left = candidateX + 'px';
		this.sectionProperties.objectDiv.style.top = candidateY + 'px';

		// Autoscroll asks where the FINGER is relative to the viewport edge,
		// not where the art is, so it keeps the unshifted value and its input
		// is byte-identical on every form factor. CSS px, as before.
		app.map.fire('handleautoscroll', {
			pos: {
				x: Math.round(fingerX / app.dpiScale),
				y: Math.round(fingerY / app.dpiScale),
			},
			map: app.map,
		});

		// D4, phone only. Document-space CORE px, the same pair onDragEnd
		// posts. Desktop and tablet keep the stock behaviour — one post, on
		// release — so the whole change reduces to nothing behind one
		// predicate. (CellSelectionHandle posts from onDrag unconditionally;
		// it is a different section and is not touched by any of this.)
		if (TextSelectionHandle.isPhoneChrome()) {
			this.notifySelectionBar('onSelectionHandleDrag');
			this.sectionProperties.dragActive = true;
			const artX =
				this.position[0] + point.pX - grabOffset[0] + artDX;
			const artY =
				this.position[1] + point.pY - grabOffset[1] + artDY;
			this.sectionProperties.postWhileDragging(
				artX,
				artY,
			);
		}
	}

	setShowSection(show: boolean) {
		this._showSection = show;

		/*
		 * VULCAN: on phone chrome the handles are not conditional on the last
		 * event having been a touch.
		 *
		 * `currentlyUsingTouchscreen()` is a LAST-EVENT test, not a device
		 * test: it returns `touch.lastEventWasTouch` and only falls back to
		 * "is there a touchscreen" while that is still null (js/global.js).
		 * The fallback itself is `hasAnyTouchscreen()`, which on some phones
		 * with a paired peripheral answers through a `(pointer: fine)` match.
		 *
		 * Either way the failure is the same and it is a trap: one non-touch
		 * event -- a stylus hover, a paired mouse, a synthetic click from an
		 * assistive tool -- hides both teardrops, and the way a user asks for
		 * them back is to touch the handle that is no longer drawn. On a
		 * phone that is a dead end.
		 *
		 * Phone chrome is a touch surface by construction: the class is
		 * stamped only when `isSmallScreenDevice()` holds and the host has not
		 * asked for desktop chrome (js/global.js). There is no phone-chrome
		 * session where hiding the handles is the right answer, so the veto
		 * does not apply there. Every other surface keeps the stock test byte
		 * for byte -- substitute `false` for the phone term to recover it.
		 */
		if (
			!window.vulcanPhoneChrome &&
			!window.touch.currentlyUsingTouchscreen()
		) {
			super.setShowSection(false);
		} else {
			super.setShowSection(this._showSection);
		}
	}

	setOpacity(value: number) {
		this.getHTMLObject().style.opacity = value;
	}

	onDragEnd(point: cool.SimplePoint) {
		this.sectionProperties.lastDragFinger = null;

		const grabOffset = this.sectionProperties.grabOffset;
		const artDX = TextSelectionHandle.artOffsetX() * app.dpiScale;
		const artDY = TextSelectionHandle.artOffsetY() * app.dpiScale;
		const rawX =
			this.position[0] + point.pX - grabOffset[0] + artDX; // Art origin, CORE px.
		const y =
			this.position[1] + point.pY - grabOffset[1] + artDY; // Art origin, CORE px.
		this.sectionProperties.grabOffset = [0, 0];

		// Commit the translated box origin (see onDrag). Both offsets are 0
		// off-phone, so this is the stock setPosition(x, y).
		this.setPosition(
			rawX - artDX,
			y - artDY,
		);

		app.map.fire('scrollvelocity', {vx: 0, vy: 0});

		// Anything the throttle still holds is a mid-drag point, and the post
		// below is the exact one. Close the gate before posting.
		this.sectionProperties.dragActive = false;

		this.postSelectionEdge(rawX, y);

		this.notifySelectionBar('onSelectionHandleDragEnd');
	}

	/*
	 * The Writer pill (Control.MobileSelectionBar) is anchored in viewport
	 * space, so a document shift strands it over moved text. These sections
	 * hear every shift (onNewDocumentTopLeft) and every handle gesture, so
	 * they are its notifier. The typeof guard is load-bearing: on desktop
	 * there is no bar, and on phone Impress `map.mobileSelectionBar` is
	 * Control.ImpressSelectionBar, which has none of these methods.
	 */
	private notifySelectionBar(method: string): void {
		const bar: any = app.map && (app.map as any).mobileSelectionBar;
		if (bar && typeof bar[method] === 'function') bar[method]();
	}

	public onNewDocumentTopLeft(): void {
		super.onNewDocumentTopLeft();
		this.notifySelectionBar('onDocumentViewShift');
	}

	// rawX/rawY are the translated art origin in document-space CORE px, BEFORE
	// the start handle's tip correction. Shared by the throttled drag posts (D4)
	// and by onDragEnd, so both send the identical edge for the identical box
	// translation — the release can never disagree with the drag preview.
	private postSelectionEdge(rawX: number, rawY: number) {
		const type = this.name === 'selection_start_handle' ? 'start' : 'end';

		// The start handle's art points up-RIGHT, so its art origin sits one
		// tip offset left of the character it selects; shift back before
		// telling core where the selection edge is.
		//
		// startTipOffsetX is a CSS-px value (see its comment for the split
		// from artWidth) but `rawX` is in CORE px, so it must be MULTIPLIED
		// by dpiScale, not divided. Dividing is correct only at DPR 1 --
		// which is every desktop, i.e. everywhere anyone would have tested
		// it. At DPR 3 it under-corrected by 80 core px, so every
		// start-handle drag landed about 27 CSS px left of the finger on a
		// real phone.
		//
		// The phone slop does NOT belong in this conversion: `rawX` is already
		// the art origin, so its tip is one tip offset away on every form
		// factor. artOffsetX only converts between the BOX origin and the ART
		// origin, once each in onDrag, onDragEnd and
		// TextSelections.updateMarkers.
		let x = rawX; // CORE px.
		if (type === 'start')
			x += TextSelectionHandle.startTipOffsetX() * app.dpiScale;
		if (!app.map._docLayer.isCalcRTL()) {
			app.map._docLayer._postSelectTextEvent(type, Math.round(x * app.pixelsToTwips), Math.round(rawY * app.pixelsToTwips));
		}
		else {
			// Mirrors the UNCORRECTED x, as it always has: this used to read
			// this.position[0] straight after setPosition(x, y) wrote it, so
			// the Math.round is setPosition's (CanvasSectionObject L171-172)
			// and is kept here rather than depending on that side effect.
			const referenceX = app.activeDocument.activeLayout.viewedRectangle.pX1 + (app.activeDocument.activeLayout.viewedRectangle.pX2 - Math.round(rawX));
			app.map._docLayer._postSelectTextEvent(type, Math.round(referenceX * app.pixelsToTwips), Math.round(rawY * app.pixelsToTwips));
		}
	}

	onMouseMove(point: cool.SimplePoint, dragDistance: number[], e: MouseEvent): void {
		e.stopPropagation();
		if (this.containerObject.isDraggingSomething()) {
			this.stopPropagating();
			this.onDrag(point);
		}
	}

	onDocumentObjectVisibilityChange(): void {
		if (this.showSection && this.isVisible)
			this.sectionProperties.objectDiv.style.display = '';
		else
			this.sectionProperties.objectDiv.style.display = 'none';
	}

	onClick(point: cool.SimplePoint, e: MouseEvent): void {
		e.stopPropagation();
		this.stopPropagating();
	}

	onMouseDown(point: cool.SimplePoint, e: MouseEvent): void {
		e.stopPropagation();
		this.stopPropagating();

		// Remember where in the box the finger landed, so the drag can move the
		// glyph BY the finger's travel instead of TO the finger. Both the mouse
		// and the touch path reach here: CanvasSectionContainer.onTouchStart
		// calls propagateOnMouseDown with the same section-local point.
		this.sectionProperties.grabOffset = TextSelectionHandle.isPhoneChrome()
			? [point.pX, point.pY]
			: [0, 0];
		// A new gesture. A drag the browser cancelled never reached onDragEnd,
		// and its finger must not be replayed by this gesture's second finger.
		this.sectionProperties.lastDragFinger = null;
	}

	onMouseUp(point: cool.SimplePoint, e: MouseEvent): void {
		e.stopPropagation();
		if (this.containerObject.isDraggingSomething()) {
			this.stopPropagating();
			this.onDragEnd(point);
		}
	}

	/*
	 * A second finger during a handle drag never reaches onMouseUp:
	 * CanvasSectionContainer latches the gesture as multi-touch until the LAST
	 * finger lifts and then sends onMultiTouchEnd, never a mouse-up (pinned by
	 * its "clears a latched drag after the final finger" test), and it ignores
	 * the first finger's moves in between. onDragEnd is the only thing that
	 * sends `scrollvelocity {0,0}`, so a handle held near the screen edge left
	 * ScrollSection's autoscroll running to the end of the document. A second
	 * finger turns the gesture into a multi-touch one (ScrollSection's
	 * onMultiTouchStart stands its scrubber down for the same reason): end the
	 * drag where the finger is.
	 *
	 * Where it is NOW, not the last move's section-local point: core's reply to
	 * that move repositions this handle (TextSelections.updateMarkers), and the
	 * autoscroll may have moved the view, so that point read against the
	 * current position would land the edge as far past the finger as the
	 * handle has moved. The finger's viewport position, read against the
	 * current myTopLeft, is the section-local point a mouse-up there would get.
	 */
	onMultiTouchStart(e: TouchEvent): void {
		const finger = this.sectionProperties.lastDragFinger;
		if (!finger) return;
		this.onDragEnd(
			cool.SimplePoint.fromCorePixels([finger[0] - this.myTopLeft[0], finger[1] - this.myTopLeft[1]]),
		);
	}
}
