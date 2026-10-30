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

// This is used for showing mobile cursor handler. User can grab and move this section's HTML object to move the text cursor.

class CursorHandler extends HTMLObjectSection {
	/*
		GEOMETRY. Every constant in this block is CSS px. `position`, `size`,
		`myTopLeft` and `point.pX/pY` are CORE px, and the two are related by
		app.dpiScale (= window.devicePixelRatio, CanvasSectionContainer.ts
		L1615), so a CSS-px constant entering any of those must be MULTIPLIED
		by dpiScale. Every conversion below names its units on purpose: a `/`
		where a `*` belonged is how two separate bugs in this file family were
		written (TextSelectionHandleSection's start-handle drop, Cursor.onResize
		thinning the caret), and both were invisible on the DPR-1 desktop they
		were written on.

		The art is images/cursor-handler.svg behind .cursor-handler in
		css/selectionMarkers.css: a 30x44 image whose path is a tip at (15, 0)
		and an r=15 circle centred (15, 21.21), so the ink occupies the top
		30 x 36.21 of it and the bottom ~7.8 px are already empty grab.
	*/
	public static readonly artWidth = 30; // CSS px — SVG width.
	public static readonly artBoxHeight = 44; // CSS px — SVG height.

	/*
		`.cursor-handler { margin-left: -14px }` (css/selectionMarkers.css)
		paints the art 14 CSS px LEFT of the section origin. A margin moves the
		DIV and nothing else: the div carries pointer-events:none
		(HTMLObjectSection L49) so the container hit-tests the SECTION's
		myTopLeft + size (CanvasSectionObject.isHit L199-207), which the margin
		never saw. The grab box therefore sits 14 px right of the art it exists
		to grab — of 30 px of teardrop only the right 16 px can be grabbed at
		all, and 14 px of the grab box is empty air beside it. CSS cannot repair
		that: it can neither move nor grow a section.

		The same -14 also makes the section origin the CARET ANCHOR rather than
		the art origin. TextInput.showCursor parks the section on the caret's
		bottom-left (app.file.textCursor.rectangle.pX1/.pY2) and onMouseUp posts
		that same point straight back to core, which is what puts the caret
		where the user dropped the handle. That contract is preserved exactly;
		only the box around it moves. (It lands 1 CSS px left of the teardrop's
		tip — art-local x = 15, this offset 14 — on every form factor, before
		and after.)
	*/
	public static readonly stockArtNudgeLeft = 14; // CSS px — the margin-left above, unsigned.

	/*
		Decouple the GRAB box from the DRAWN art: the split the shipped Calc
		handle ships as hitRadius vs circleRadius (CellSelectionHandleSection)
		and the sibling TextSelectionHandleSection ships as phoneSlopX. It
		cannot be written the way Calc's is — that section paints itself in
		onDraw and can centre a small arc in a big box, while this one is a div
		with a background-image — so the phone treatment is a wider section
		`size` plus a compensating background/mask-position in CSS, which comes
		to the same thing: the art does not move, only the invisible hit region
		grows, and it grows to cover the art instead of sitting beside it.

		7 px each side takes the box from 30 to 44 CSS px, the floor
		vulcan-theme.css §13 advertises, and is the number the sibling already
		uses, so the two Writer handles come out the same width. Desktop and
		tablet keep box == art and the -14 exactly as before: with
		isPhoneChrome() false every expression below reduces to the line it
		replaced.
	*/
	private static readonly phoneSlopX = 7; // CSS px, each side.

	/*
		THE DRAWN ART, phone only — the eye's target, as opposed to the box
		above, which is the finger's.

		Measured against g4 (Google Docs, iOS, 360-wide render): its text
		handle is 6x8 px of ink, ~7x9 CSS px on a 393 px phone. Ours was 16 CSS
		px wide, which the 30x44 SVG makes 23.5 px tall — taller than the 21 px
		Writer line box measured on slot-02 build #10 — so for the whole dwell
		a teal droplet sat on top of the FOLLOWING line of text. That, not the
		box, is what reads as a pointer parked in the paragraph.

		10 px is the smallest that keeps the teardrop's tip legible under the
		drop-shadow, and 10 x 14.7 fits inside a line box. Nothing else moves:
		the grab box stays 44, the anchor stays anchorInsetX(), the drag
		contract is untouched.
	*/
	public static readonly artInkWidth = 10; // CSS px — phone only.

	/*
		CSS px from the box's left edge to the ink's. The SVG's tip is
		art-local x = 15 of 30 — the ink's horizontal centre — so centring the
		ink on anchorInsetX() puts the tip on the exact pixel the drop posts to
		core. (The 16 px art it replaces started at 14 and so pointed 1 px
		right of the anchor.)
	*/
	public static artInkLeft(): number {
		return CursorHandler.anchorInsetX() - CursorHandler.artInkWidth / 2;
	}

	/*
		The single writer of the art geometry. It used to live in three places:
		background-position/size in the phone .cursor-handler block of
		css/selectionMarkers.css, mask-position/size in the @supports one, and
		a note here claiming both equalled phoneSlopX — which the shipped 14
		had already outgrown, so the comment was a lie before this shrank
		anything. Inline beats both stylesheets, so those four declarations are
		gone and this is the only number.

		Both the masked path and the no-mask fallback are written, because they
		paint the same SVG and must land on the same pixels. Off-phone this
		writes nothing at all and the stylesheet keeps the stock 30 px art.
	*/
	public static applyArtGeometry(div: HTMLElement): void {
		if (!CursorHandler.isPhoneChrome()) return;
		const size = CursorHandler.artInkWidth + 'px auto';
		const position = CursorHandler.artInkLeft() + 'px 0';
		div.style.setProperty('-webkit-mask-size', size);
		div.style.setProperty('mask-size', size);
		div.style.setProperty('-webkit-mask-position', position);
		div.style.setProperty('mask-position', position);
		div.style.backgroundSize = size;
		div.style.backgroundPosition = position;
	}

	/*
		The box is deliberately NOT grown upwards, and there is no phoneSlopTop
		here rather than a zero one. The sibling can afford 12 px above its art
		because a selection handle hangs off an edge the user has finished with;
		this one hangs off the LIVE caret, so its box top IS the caret's bottom
		and slop above it would park an invisible drag target over the tail of
		the line being edited — where a drag pans the view today. The stock
		44 px height already meets the touch floor and already carries ~7.8 px
		of empty grab below the ink, so the vertical axis has nothing to win.
		Adding it later means an anchorInsetY() paired with anchorInsetX() below
		and a Y in the CSS background/mask-position to match.
	*/

	public static isPhoneChrome(): boolean {
		// js/global.js L471-472 stamps this for small-screen devices only;
		// tablets and desktop never carry it. Substituting this one predicate
		// with false restores the stock geometry exactly: boxWidth() goes back
		// to 30, anchorInsetX() to 0, and the phone CSS blocks stop matching
		// because the class is no longer on <html>.
		return document.documentElement.classList.contains('vulcan-mobile-chrome');
	}

	// CSS px of empty grab added on EACH side of the art. Zero off-phone.
	public static slopX(): number {
		return CursorHandler.isPhoneChrome() ? CursorHandler.phoneSlopX : 0;
	}

	// CSS px. HTMLObjectSection turns this into the section's CORE-px `size`
	// (L24, `* app.dpiScale`) AND the div's inline width (L32), and an inline
	// width beats the 30px in the stylesheet, so this is the single source for
	// both the hit box and the painted box. Read once, at construction from
	// TextInput._addCursorHandler — long after global.js stamped the class.
	public static boxWidth(): number {
		return CursorHandler.artWidth + 2 * CursorHandler.slopX();
	}

	public static boxHeight(): number {
		return CursorHandler.artBoxHeight; // No vertical slop — see the note above.
	}

	/*
		CSS px from the section's LEFT EDGE to the caret anchor: the document
		point TextInput parks this handle on, and the point onMouseUp posts back
		to core.

		Stock: the section origin IS the anchor — the -14 lives in the div's
		margin, which the section never sees — so 0.
		Phone: the phone CSS block drops that margin, and the box instead starts
		slopX left of the art, which is itself stockArtNudgeLeft left of the
		anchor. So the anchor sits slopX + stockArtNudgeLeft = 21 px in from the
		box's left edge, and the art still paints on exactly the pixel it did.

		Exactly two call sites cross this, in opposite directions, and they are
		a matched pair: TextInput.showCursor SUBTRACTS it when placing the box,
		onMouseUp ADDS it when posting. Break the pairing — or divide by
		dpiScale instead of multiplying — and every touch of the handle drags
		the user's caret sideways.
	*/
	public static anchorInsetX(): number {
		return CursorHandler.isPhoneChrome()
			? CursorHandler.phoneSlopX + CursorHandler.stockArtNudgeLeft
			: 0;
	}

	/*
		WHEN IT IS ON SCREEN.

		Stock keeps the teardrop up for the whole life of the caret, on every
		touchscreen, in every doctype: a marker permanently parked on the line
		you are reading, which is what reads as a "giant pointer" whatever size
		the art is. Google's phone editors treat it as a TAP-SUMMONED grab knob
		instead -- the blinking caret alone marks the position, and the knob
		appears only when a pointer has just put the caret somewhere, then
		leaves on the first keystroke or by itself.

		Phone only. Off-phone wantsVisible() returns the stock `true` and every
		summon/dismiss below is a no-op, the same way the geometry above
		reduces to stock.

		The dwell was 3000 — Cursor.headerTimeout's number, borrowed from the
		collaborator-name label rather than measured against anything — and on
		slot-02 build #10 it left the droplet on the line below the caret for a
		measured 3.0 s after every caret-placing tap. The benchmark's window is
		about a second, which is still long enough to reach for: a finger that
		lands on the knob holds it open (fadeOut below), and the drop re-arms.
	*/
	public static readonly idleFadeMs = 1000;
	public static readonly fadeOutMs = 200; // Keep equal to the transition in css/selectionMarkers.css.

	/*
		LIVE DRAG, phone only. Stock posts the caret once, in onMouseUp, so it
		jumps at release; Google's caret follows the finger. Same 40 ms = 25 Hz
		as TextSelectionHandle.dragPostIntervalMs, for the same reasons (a post
		re-runs a caret placement in core and touchmove is 60-120 Hz); if the
		round trip on a real handset is slower this goes UP, never down.
	*/
	private static readonly dragPostIntervalMs = 40;

	/*
		CORE px (CSS px * dpiScale at use) the anchor must move since the LAST
		post before another pair is worth sending. Click count crosses the wire
		explicitly (the count arg below; MouseControl authors its own
		clickCount), so core does not upgrade same-position pairs to a double
		click on its own clock — this gate exists so a resting finger's tremor
		does not spam identical pairs at 25 Hz.
	*/
	private static readonly dragPostThresholdCssPx = 2;

	/*
		The whole rule, as a pure function so it can be pinned without a canvas.
		`summonedAtMs` is the last caret placed BY A POINTER (MouseControl.onClick,
		or a drop of this handle); `typedAtMs` the last keystroke.

		textCursorVisible carries the Sheets/Slides half of the spec by itself:
		in Calc it is true only inside an open cell editor and in Impress only
		inside text edit, so a merely-selected cell and a selected shape get the
		knob-free state Google gives them without a doctype branch here.

		editMode carries the Writer half: read-posture taps still move the
		internal caret (link-follow and edit-entry depend on it), so the caret
		can be "visible" to core while the user is only reading. Google shows
		no caret UI in view mode, so a readonly posture never earns the knob.
	*/
	public static phoneVisibility(state: {
		textCursorVisible: boolean;
		editMode: boolean;
		summonedAtMs: number | null;
		typedAtMs: number | null;
		nowMs: number;
	}): boolean {
		if (!state.editMode) return false;
		if (!state.textCursorVisible || state.summonedAtMs === null) return false;
		// A keystroke at the same millisecond as the summon is still the
		// keystroke: typing is what the user asked for last.
		if (state.typedAtMs !== null && state.typedAtMs >= state.summonedAtMs)
			return false;
		return state.nowMs - state.summonedAtMs < CursorHandler.idleFadeMs;
	}

	private static current(): CursorHandler | null {
		const textInput = app.map ? (app.map as any)._textInput : null;
		return textInput && textInput._cursorHandler
			? textInput._cursorHandler
			: null;
	}

	public static noteCaretPlacedByPointer(): void {
		const handler = CursorHandler.current();
		if (handler) handler.summon();
	}

	public static noteTextTyped(): void {
		const handler = CursorHandler.current();
		if (handler) handler.dismiss();
	}

	private summonedAtMs: number | null = null;
	private typedAtMs: number | null = null;
	private fadeTimer: ReturnType<typeof setTimeout> | null = null;
	private hideTimer: ReturnType<typeof setTimeout> | null = null;

	// TextInput.showCursor asks this before showing the section; it owns the
	// position either way, so a hidden handle still tracks the caret and is in
	// the right place the moment the next tap summons it.
	public wantsVisible(): boolean {
		if (!CursorHandler.isPhoneChrome()) return true;
		return CursorHandler.phoneVisibility({
			textCursorVisible: !!(
				app.file &&
				app.file.textCursor &&
				app.file.textCursor.visible
			),
			editMode: !!(app.map && app.map.isEditMode()),
			summonedAtMs: this.summonedAtMs,
			typedAtMs: this.typedAtMs,
			nowMs: Date.now(),
		});
	}

	public summon(): void {
		if (!CursorHandler.isPhoneChrome()) return;
		this.summonedAtMs = Date.now();
		this.typedAtMs = null;
		this.clearTimers();
		this.setOpacity(1);
		// A retap at the caret's own position summons without MOVING the
		// caret, so core sends nothing and TextInput.showCursor — the only
		// other caller of setShowSection(true) — never runs: the section
		// stays hidden from the last fade while the policy reads visible.
		// Policy-guarded, because summon() fires on every canvas tap,
		// including ones that place no caret.
		if (!this.showSection && this.wantsVisible()) this.setShowSection(true);
		this.fadeTimer = setTimeout(() => this.fadeOut(), CursorHandler.idleFadeMs);
	}

	public dismiss(): void {
		if (!CursorHandler.isPhoneChrome()) return;
		this.typedAtMs = Date.now();
		this.clearTimers();
		this.setOpacity(1);
		this.setShowSection(false);
	}

	// preZoomAnimation drops every overlay to 0 and the stock restore puts them
	// all back at 1; this one must come back only as far as the policy allows,
	// or a zoom during the fade resurrects a knob that was on its way out.
	public restoreOpacity(): void {
		this.setOpacity(this.wantsVisible() ? 1 : 0);
	}

	// The same predicate onMouseMove and onMouseUp already trust to decide
	// that a gesture belongs to this section.
	private isBeingDragged(): boolean {
		return (
			!!this.containerObject &&
			this.containerObject.isDraggingSomething() &&
			this.containerObject.targetSection === this.name
		);
	}

	private fadeOut(): void {
		this.fadeTimer = null;
		/*
			A finger already on the knob outranks the clock. The dwell exists
			to get the art off the page when nobody wants it, and someone
			mid-drag manifestly does; at 3000 ms a drag that outlived it was
			rare, at 1000 ms it is the common case, and the cost is not
			cosmetic — fadeOutMs later setShowSection(false) takes the section
			out of hit-testing under the very touch driving it. Re-arm rather
			than cancel, so a gesture that ends without an onMouseUp for this
			section (a second finger promoting the touch to a pinch) still
			expires on its own instead of parking an invisible 44 px box on the
			line being edited.
		*/
		if (this.isBeingDragged()) {
			this.fadeTimer = setTimeout(
				() => this.fadeOut(),
				CursorHandler.idleFadeMs,
			);
			return;
		}
		this.setOpacity(0);
		// A transparent section is still hit-testable, and this one's 44px box
		// sits on the line being edited, so it has to actually go away.
		this.hideTimer = setTimeout(() => {
			this.hideTimer = null;
			this.setShowSection(false);
			this.setOpacity(1);
		}, CursorHandler.fadeOutMs);
	}

	// Map.setAccessibilityState rebuilds TextInput, and with it this section, so
	// a pending fade can outlive the div it was going to hide.
	public onRemove(): void {
		this.clearTimers();
		super.onRemove();
	}

	private clearTimers(): void {
		if (this.fadeTimer) {
			clearTimeout(this.fadeTimer);
			this.fadeTimer = null;
		}
		if (this.hideTimer) {
			clearTimeout(this.hideTimer);
			this.hideTimer = null;
		}
	}

	constructor() {
		super(
			app.CSections.CursorHandler.name,
			CursorHandler.boxWidth(),
			CursorHandler.boxHeight(),
			new cool.SimplePoint(0, 0),
			'cursor-handler',
			false,
		);

		this.sectionProperties.lastPosition = null;
		this.sectionProperties.dragActive = false;
		this.sectionProperties.lastPostedAnchor = null;

		// HTMLObjectSection has built the div by now, and sizes it inline from
		// the constructor arguments above; the art it carries is sized here for
		// the same reason — one source, no stylesheet to drift from it.
		CursorHandler.applyArtGeometry(this.getHTMLObject());
	}

	// this.position is the section's top-left in document-space CORE px — the
	// BOX corner. Core must be told where the CARET goes, which is
	// anchorInsetX() CSS px to its right: 21 on a phone, 0 off it, where this
	// reduces to the stock `this.position[0]` it replaced.
	//
	// CSS px -> CORE px is `* app.dpiScale`. MULTIPLY. Dividing is right only
	// at DPR 1, i.e. on every desktop anyone would test this on, and at DPR 3
	// it would leave the caret 14 CSS px adrift on every drop — the same shape
	// of bug as the start handle's.
	private anchorPosition(): [number, number] {
		return [
			this.position[0] + CursorHandler.anchorInsetX() * app.dpiScale, // CORE px.
			this.position[1], // CORE px — no vertical slop, so no inset.
		];
	}

	// One caret placement, CORE px in, twips out. The mid-drag follower and
	// onMouseUp's authoritative drop must send byte-identical pairs.
	private postCaretPlacement(anchorX: number, anchorY: number): void {
		app.map._docLayer._postMouseEvent(
			'buttondown',
			Math.round(anchorX * app.pixelsToTwips),
			Math.round(anchorY * app.pixelsToTwips),
			1,
			1,
			0,
		);
		app.map._docLayer._postMouseEvent(
			'buttonup',
			Math.round(anchorX * app.pixelsToTwips),
			Math.round(anchorY * app.pixelsToTwips),
			1,
			1,
			0,
		);
	}

	// Util.throttle (src/app/Util.ts) is leading edge + trailing, like the
	// sibling's postWhileDragging. Built on first use: the constructor stays
	// geometry-only and canvas-free rigs get one too.
	private dragPoster(): (x: number, y: number) => void {
		if (!this.sectionProperties.postWhileDragging) {
			this.sectionProperties.postWhileDragging = Util.throttle(
				(x: number, y: number) => {
					// A queued trailing call can land after the finger lifted.
					// onMouseUp has posted the exact drop point by then, so
					// replaying a mid-drag point would drag the caret back off
					// it.
					if (this.sectionProperties.dragActive) this.postCaretPlacement(x, y);
				},
				CursorHandler.dragPostIntervalMs,
				this,
			);
		}
		return this.sectionProperties.postWhileDragging;
	}

	onMouseMove(
		point: cool.SimplePoint,
		dragDistance: Array<number>,
		e: MouseEvent,
	): void {
		if (
			this.containerObject.isDraggingSomething() &&
			this.containerObject.targetSection === this.name
		) {
			this.stopPropagating();
			e.stopPropagation();

			/*
				lastPosition is a MOUSEDOWN anchor. Nothing has moved this
				section since the touch went down - the only writer during a
				drag is the setPosition below, which has not run yet on the
				call that seeds - so the value captured here is the handle's
				pre-drag position, and dragDistance is measured from mousedown
				too. Base plus TOTAL distance is therefore absolute tracking:
				the handle sits under the finger on every move, whatever
				threshold the container's touch latch used.

				Do not re-seed this with the drag distance observed at the
				latch. That would park the handle a slop's width behind the
				finger for the rest of the gesture. A wider latch costs one
				catch-up jump of at most the slop, which lands the handle where
				the finger already is; see
				CanvasSectionContainer.getTouchDragLatchSquared().
			*/
			if (!this.sectionProperties.lastPosition) {
				this.sectionProperties.lastPosition = this.position.slice();
				// Jitter baseline: measured from where the caret already is,
				// so a wobble around the grab point posts nothing at all.
				this.sectionProperties.lastPostedAnchor = this.anchorPosition();
			} else {
				this.setPosition(
					this.sectionProperties.lastPosition[0] + dragDistance[0],
					this.sectionProperties.lastPosition[1] + dragDistance[1],
				);

				// Live-post so the caret follows the finger; onMouseUp's post
				// stays the authoritative drop. Desktop and tablet keep the
				// stock post-on-release-only contract.
				if (CursorHandler.isPhoneChrome()) {
					this.sectionProperties.dragActive = true;
					const anchor = this.anchorPosition();
					const last = this.sectionProperties.lastPostedAnchor;
					const step = CursorHandler.dragPostThresholdCssPx * app.dpiScale;
					// Gated BEFORE the throttle: a sub-threshold move must not
					// burn the 40 ms window a real move would then queue behind.
					if (
						!last ||
						Math.abs(anchor[0] - last[0]) >= step ||
						Math.abs(anchor[1] - last[1]) >= step
					) {
						this.sectionProperties.lastPostedAnchor = anchor;
						this.dragPoster()(anchor[0], anchor[1]);
					}
				}
			}
		}
	}

	onMouseUp(point: cool.SimplePoint, e: MouseEvent): void {
		// FIRST: a queued trailing mid-drag post must never land after this —
		// only the authoritative pair below may speak for the drop point.
		this.sectionProperties.dragActive = false;
		if (
			this.containerObject.isDraggingSomething() &&
			this.containerObject.targetSection === this.name
		) {
			const anchor = this.anchorPosition();
			this.postCaretPlacement(anchor[0], anchor[1]);
			// The finger that just dropped this knob is a pointer placing the
			// caret, so restart the window rather than let the drop expire on
			// the clock the tap before it started.
			this.summon();
		}
		this.sectionProperties.lastPosition = null;
		this.sectionProperties.lastPostedAnchor = null;
	}

	setOpacity(value: number) {
		this.getHTMLObject().style.opacity = value;
	}
}
