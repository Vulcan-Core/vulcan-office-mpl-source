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
/* See CanvasSectionContainer.ts for explanations. */

// We will keep below definitions until we use tsconfig.json.

namespace cool {

export class ScrollSection extends CanvasSectionObject {
	// The fraction of the line-height per 16.6ms to accelerate
	static readonly scrollAnimationAcceleration: number = 0.1;

	// The number of lines a scroll-wheel tick should travel. Note that
	// this is approximate, as it doesn't include deceleration once the target is reached.
	static readonly scrollWheelDelta: number = 3;

	// Any scroll events within this number of milliseconds after direct (e.g. touchpad)
	// scrolling will be treated as direct scroll events.
	static readonly scrollDirectTimeoutMs: number = 100;

	// Phone autoscroll law, all in CSS px so the felt speed is identical on
	// every DPR. The activation zone lives INSIDE the viewport, because a finger
	// cannot leave the glass: a law measured on how far PAST the edge the
	// pointer reaches collapses to its intercept on touch and leaves the user
	// one speed with no way to modulate it. The zone tracks the viewport but is
	// floored near one touch target — a zone thinner than a fingertip cannot be
	// steered — and capped so it never swallows a whole phone screen.
	static readonly vulcanAutoScrollZoneFraction: number = 0.12;
	static readonly vulcanAutoScrollZoneMinCss: number = 48;
	static readonly vulcanAutoScrollZoneMaxCss: number = 120;
	// Penetration saturates at 85% of the zone. The outermost band is where the
	// contact patch is partly off-glass and the coordinate is clamped or noisy,
	// so it carries no usable signal and is spent as a plateau instead.
	static readonly vulcanAutoScrollSaturation: number = 0.85;
	// Mild power, not linear. The inner half of the zone is where a finger
	// trying to land on a particular row dwells, and a linear map spends most of
	// a ~72 px zone at speeds nobody can aim; past about 2.0 the outer band goes
	// uncontrollable again.
	static readonly vulcanAutoScrollExponent: number = 1.7;
	// RULED CEILING. 550 CSS px/s turns a phone viewport over in about a second,
	// which is the fastest a user can still read where they are. The predecessor
	// 1200 — and the 900..2000 library defaults it was drawn from — are
	// desktop-window numbers: at those speeds the sheet is past the target row
	// before anyone can react, which is the runaway this law exists to end.
	static readonly vulcanAutoScrollMaxCss: number = 550;
	// The first few px inside the zone are a finger steering, not a finger
	// asking to travel; velocity is exactly zero there.
	static readonly vulcanAutoScrollDeadCss: number = 4;

	processingOrder: number = app.CSections.Scroll.processingOrder
	drawingOrder: number = app.CSections.Scroll.drawingOrder;
	zIndex: number = app.CSections.Scroll.zIndex;
	windowSection: boolean = true; // This section covers the entire canvas.

	map: any;
	autoScrollTimer: any;
	pendingScrollEvent: any = null;
	stepByStepScrolling: boolean = false; // quick scroll will move "page up/down" not "jump to"

	isRTL: () => boolean;

	constructor (isRTL?: () => boolean) {
		super(app.CSections.Scroll.name);

		this.map = window.L.Map.THIS;

		this.isRTL = isRTL ?? (() => false);

		this.map.on('scrollby', this.onScrollBy, this);
		this.map.on('scrollvelocity', this.onScrollVelocity, this);
		this.map.on('handleautoscroll', this.onHandleAutoScroll, this);
	}

	public onInitialize (): void {
		this.sectionProperties.previousDragDistance = null;

		this.sectionProperties.scrollBarThickness = 6 * app.roundedDpiScale;

		this.sectionProperties.drawScrollBarRailway = true;
		this.sectionProperties.scrollBarRailwayThickness = 6 * app.roundedDpiScale;
		this.sectionProperties.scrollBarRailwayAlpha = this.map._docLayer._docType === 'spreadsheet' ? 1.0 : 0.5;

		// Google-Sheets phone chrome (docs/mobile-redesign/02 §10 feature-cut
		// discipline): on a phone the scroll bars are a transient INDICATOR, not
		// a control. Read the gate once here -- js/global.js:472 stamps
		// html.vulcan-mobile-chrome exactly once at boot, iff !desktopChrome &&
		// mode.isSmallScreenDevice(), and nothing anywhere removes it, so a
		// cached read can never go stale. Desktop and tablet fail BOTH halves
		// (isTablet() is *defined* as !isSmallScreenDevice()) and every branch
		// keyed off this flag is unreachable for them.
		//
		// 🔴 Read BEFORE refreshScrollBarColors, not after: that function now
		// picks the phone indicator's ink off this flag (M-0015 §C), and it is
		// also the 'darkmodechanged' handler, so an unset flag on the first call
		// would give the phone the theme's translucent thumb until the user
		// happened to flip the theme.
		this.sectionProperties.vulcanPhoneFade =
			(<any>window).mode.isSmallScreenDevice()
			&& document.documentElement.classList.contains('vulcan-mobile-chrome');

		this.refreshScrollBarColors();
		this.map.on('darkmodechanged', this.refreshScrollBarColors, this);

		this.sectionProperties.drawVerticalScrollBar = ((<any>window).mode.isDesktop() ? true: false);
		this.sectionProperties.drawHorizontalScrollBar = ((<any>window).mode.isDesktop() ? true: false);

		// Unconditional: cancelAutoScroll() reads this on every device, and an
		// unset sectionProperties key is `undefined`, which is !== null.
		this.sectionProperties.vulcanAutoScrollRaf = null;
		this.sectionProperties.vulcanAutoScrollVelocity = [0, 0];
		this.sectionProperties.vulcanAutoScrollLast = 0;
		// Viewport CSS px, the single live input the rAF re-reads every frame.
		this.sectionProperties.vulcanAutoScrollPointer = null;
		this.sectionProperties.vulcanAutoScrollRepost = null;
		// Sub-CSS-px carry for the ramp's slow end -- see phoneAutoScrollStep.
		this.sectionProperties.vulcanAutoScrollResidue = [0, 0];
		this.sectionProperties.vulcanRevealRemaining = [0, 0];

		// R6-18 immersive read. The state machine is unconditional -- it arms
		// itself from isPhoneWriterRead() at each movement -- because the arming
		// facts (read posture) change at runtime while this runs once. Desktop
		// and tablet never arm it and every branch below is unreachable there.
		//
		// Published on `app` so the ONE other reader (UIManager's posture stamp,
		// which has to force the chrome back when the pencil leaves read mode)
		// can reach it without this section and that controller importing each
		// other. Same handle shape as app.writerReflow / app.caretReveal.
		this.sectionProperties.vulcanImmersion = new VulcanReadImmersion();
		this.sectionProperties.vulcanImmersionTimer = null;
		this.sectionProperties.vulcanScrubGrab = null;
		app.readImmersion = this.sectionProperties.vulcanImmersion;

		if (this.sectionProperties.vulcanPhoneFade) {
			// No railway. scrollBarRailwayAlpha is 1.0 for spreadsheets (:62), so
			// leaving the railway on would trade a 48px disc for a full-height
			// OPAQUE strip laid down the data -- strictly worse than the puck.
			this.sectionProperties.drawScrollBarRailway = false;
			// Both bars always enabled; visibility is the fade and nothing else.
			// They cannot be enabled the stock way: that runs through
			// isMouseOnScrollBar() on HOVER, and a phone has none -- which is why
			// the horizontal indicator has effectively never appeared on a phone
			// (drawHorizontalScrollBar starts false at :68 and only
			// showHorizontalScrollBar() at :510 sets it true).
			this.sectionProperties.drawVerticalScrollBar = true;
			this.sectionProperties.drawHorizontalScrollBar = true;
		}

		this.sectionProperties.clickScrollVertical = false; // true when user presses on the scroll bar drawing.
		this.sectionProperties.clickScrollHorizontal = false;

		this.sectionProperties.mouseIsOnVerticalScrollBar = false;
		this.sectionProperties.mouseIsOnHorizontalScrollBar = false;

		this.sectionProperties.minimumScrollSize = 80 * app.roundedDpiScale;

		// Opacity.
		this.sectionProperties.alphaWhenVisible = 0.5; // Scroll bar is visible but not being used.
		this.sectionProperties.alphaWhenBeingUsed = 0.8; // Scroll bar is being used.
		this.sectionProperties.currentAlpha = 1.0; // This variable will be updated while animating. When not animating, this will be equal to one of the above variables.

		// Durations.
		this.sectionProperties.idleDuration = 2000; // In milliseconds. Scroll bar will be visible for this period of time after being used.
		this.sectionProperties.fadeOutStartingTime = 1800; // After this period, scroll bar starts to disappear. This duration is included in "idleDuration".
		this.sectionProperties.fadeOutDuration = this.sectionProperties.idleDuration - this.sectionProperties.fadeOutStartingTime;

		this.sectionProperties.animatingScroll = false;

		// Scroll in discrete steps instead of animating when the user has asked
		// the system for reduced motion.
		this.sectionProperties.reducedMotionQuery = window.matchMedia ?
			window.matchMedia('(prefers-reduced-motion: reduce)') : null;
		this.updateAnimateWheelScroll();
		if (this.sectionProperties.reducedMotionQuery) {
			this.sectionProperties.reducedMotionQuery.addEventListener(
				'change', this.updateAnimateWheelScroll.bind(this));
		}
		this.sectionProperties.lastElapsedTime = 0;
		this.sectionProperties.scrollAnimationDelta = [0, 0];
		this.sectionProperties.scrollAnimationAcc = [0, 0];
		this.sectionProperties.scrollAnimationVelocity = [0, 0];
		this.sectionProperties.scrollAnimationDirection = [0, 0];
		this.sectionProperties.scrollAnimationDisableTimeout = null;
		this.sectionProperties.scrollWheelDelta = [0, 0];	// Used for non-animated scrolling

		// Step by step scrolling interval in ms
		this.sectionProperties.stepDuration = 50;
		this.sectionProperties.quickScrollHorizontalTimer = null;

		// Chrome's mouse-wheel events are extremely inconsistent between platforms and they don't
		// use the deltaMode property, so we need to apply heuristics to determine when a wheel event
		// comes from a mouse-wheel or a touchpad.
		this.sectionProperties.scrollQuirks = true;

		this.sectionProperties.alwaysDrawVerticalScrollBar =
			(this.map._docLayer._docType === 'spreadsheet' &&
				!(<any>window).mode.isDesktop()) ||
			(app.map.getDocType() === 'text' && (<any>window).mode.isDesktop());
	}

	private updateAnimateWheelScroll(): void {
		const reduceMotion = this.sectionProperties.reducedMotionQuery !== null
			&& this.sectionProperties.reducedMotionQuery.matches;
		// macOS already smooths wheel and trackpad scrolling at the system
		// level, so animating it again here scrolls too far and feels wrong.
		// Always scroll in discrete steps there.
		const isMac = window.L.Browser.mac;
		this.sectionProperties.animateWheelScroll =
			(<any>window).mode.isDesktop() && !reduceMotion && !isMac;
	}

	public completePendingScroll(): void {
		if (this.pendingScrollEvent) {
			this.onScrollTo(this.pendingScrollEvent);
			this.pendingScrollEvent = null;
		}
	}

	private refreshScrollBarColors(): void {
		const style = getComputedStyle(document.documentElement);
		// vulcan-theme.css re-points --color-scrollbar-* onto the theme's
		// --vulcan-scrollbar-* tokens; the fallbacks below only matter if the
		// theme css failed to load.
		this.sectionProperties.scrollBarThumbColor =
			style.getPropertyValue('--color-scrollbar-thumb').trim() || '#7E8182';
		this.sectionProperties.scrollBarRailwayColor =
			style.getPropertyValue('--color-scrollbar-railway').trim() || '#EFEFEF';
		// VO-P-0007 / M-0015 §C. The phone indicator is BLACK at alpha 0.50 --
		// read over three backgrounds in the same frames: 255 -> 127, 232 -> 116,
		// and 58 where the two bars cross (0.5 applied twice). An opaque #7F7F7F
		// would have read 127 on all three; it does not. The designer's "simply a grey
		// bar" is a grey bar because it is half-black over white paper.
		//
		// The alpha is NOT baked into this colour: alphaWhenVisible (0.5, below)
		// is the fade machinery's own value and the fade animates it to zero, so
		// the ink has to stay opaque or the two would multiply and the whole bar
		// would land at 0.175 over the grid. --vulcan-scrollbar-thumb, which the
		// theme feeds --color-scrollbar-thumb from, is exactly such a translucent
		// token; that is why the phone takes a different one.
		//
		// 🔴 The DARK value is a mirror, not a measurement: M-0015 was captured
		// in the light theme only. It flips on the same polarity as the token
		// above it, and needs a capture before anyone treats it as parity.
		if (this.sectionProperties.vulcanPhoneFade)
			this.sectionProperties.scrollBarThumbColor =
				style.getPropertyValue('--vulcan-scroll-indicator').trim() || '#000000';
		// R6-18 scrubber. Cached HERE, with the thumb colors, for the reason
		// that cache exists: onDraw runs per repaint and getComputedStyle on the
		// root element per frame is a forced style recalc on a phone that is
		// mid-scroll. Re-read on 'darkmodechanged' like everything else above.
		this.sectionProperties.vulcanScrubFill =
			style.getPropertyValue('--vulcan-surface').trim() || '#FFFFFF';
		this.sectionProperties.vulcanScrubInk =
			style.getPropertyValue('--vulcan-text').trim() || '#0F172A';
		// --vulcan-border is the theme's hairline token (§1), and it flips with
		// dark mode like the two above it. The literal is only reachable if the
		// theme sheet failed to load at all.
		this.sectionProperties.vulcanScrubEdge =
			style.getPropertyValue('--vulcan-border').trim() || 'rgba(15,23,42,0.14)';
	}

	// Fill a pill-shaped bar (fully rounded ends) — the host overlay
	// scrollbar look. Falls back to square corners where the canvas lacks
	// roundRect (old WebKit).
	private fillRoundedBar(x: number, y: number, w: number, h: number): void {
		if (w <= 0 || h <= 0) return;
		const ctx = this.context as any;
		if (typeof ctx.roundRect === 'function') {
			ctx.beginPath();
			ctx.roundRect(x, y, w, h, Math.min(w, h) / 2);
			ctx.fill();
		} else
			ctx.fillRect(x, y, w, h);
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	public onScrollTo (e: any): void {
		if (!this.containerObject.drawingAllowed()) {
			// Only remember the last scroll-to position.
			this.pendingScrollEvent = e;
			return;
		}
		// Triggered by the document (e.g. search result out of the viewing area).
		app.activeDocument.activeLayout.scrollTo(e.x, e.y);
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	public onScrollBy (e: any): void {
		app.activeDocument.activeLayout.scroll(e.x, e.y);
	}

	public cancelAutoScroll(): void {
		if (this.autoScrollTimer !== null) {
			app.timerRegistry.clearInterval(this.autoScrollTimer);
			this.autoScrollTimer = null;
		}
		// Every existing stop already funnels through here: all eight
		// fire('scrollvelocity', {vx: 0, vy: 0}) callers reach onScrollVelocity,
		// which calls this first. Cancelling the phone rAF here means not one of
		// those callers has to change.
		if (this.sectionProperties.vulcanAutoScrollRaf !== null) {
			cancelAnimationFrame(this.sectionProperties.vulcanAutoScrollRaf);
			this.sectionProperties.vulcanAutoScrollRaf = null;
		}
		// Drop the closure with the run it belonged to: the drag that supplied it
		// may already be over, and a stale one would post an extent for a finger
		// that is no longer on the glass.
		this.sectionProperties.vulcanAutoScrollRepost = null;
		// The carry belongs to the run that earned it. A fraction left over from
		// a finished drag would otherwise be paid out on the first frame of the
		// next one, in whatever direction the last one happened to end.
		this.sectionProperties.vulcanAutoScrollResidue = [0, 0];
		this.map.isAutoScrolling = false;
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	public onScrollVelocity (e: any): void {
		if (e.vx === 0 && e.vy === 0) {
			this.cancelAutoScroll();
		} else {
			this.cancelAutoScroll();
			this.map.isAutoScrolling = true;
			this.autoScrollTimer = app.timerRegistry.setInterval('autoscroll', window.L.bind(function() {
				this.onScrollBy({x: e.vx, y: e.vy});
			}, this), 100);
		}
	}

	// The activation zone for one axis, CSS px, measured inward from each edge.
	public static phoneAutoScrollZone(size: number): number {
		return Math.min(ScrollSection.vulcanAutoScrollZoneMaxCss,
			Math.max(ScrollSection.vulcanAutoScrollZoneMinCss,
				ScrollSection.vulcanAutoScrollZoneFraction * size));
	}

	// Signed CSS px/s for one axis, a pure function of where the finger is now:
	// zero inside the sheet, zero in the dead band at the zone's inner boundary,
	// and zero at the end of the document in the direction of travel — a drag
	// pinned against the wall must stop the clock, not tick into it. Reversal is
	// the same curve mirrored on the near edge, so it needs no special case.
	public static phoneAutoScrollAxis(
		pos: number,
		size: number,
		canScrollBack: boolean,
		canScrollForward: boolean,
	): number {
		const zone = ScrollSection.phoneAutoScrollZone(size);
		const speed = (pen: number): number => {
			if (pen <= ScrollSection.vulcanAutoScrollDeadCss) return 0;
			const p = Math.min(1,
				pen / (ScrollSection.vulcanAutoScrollSaturation * zone));
			return ScrollSection.vulcanAutoScrollMaxCss
				* Math.pow(p, ScrollSection.vulcanAutoScrollExponent);
		};

		if (pos > size - zone)
			return canScrollForward ? speed(pos - (size - zone)) : 0;
		if (pos < zone) return canScrollBack ? -speed(zone - pos) : 0;
		return 0;
	}

	/*
		[canScrollBack, canScrollForward] per axis, x then y, in scroll-bar space.
		canScrollHorizontal/canScrollVertical cannot answer this: they ask whether
		the document is larger than the viewport at all, which is session-static
		and still true when the last row is on screen. The real end-of-document
		clamp is inside ViewLayout.scrollHorizontal/scrollVertical, which silently
		zero the move and tell nobody — so read the same scrollProperties those
		clamps compare, refreshed by the scroll() this loop just performed.
	*/
	private phoneAutoScrollReach(): boolean[] {
		const sp: ScrollProperties =
			(app.activeDocument as DocumentBase).activeLayout.scrollProperties;
		const at = [sp.startX - sp.xOffset, sp.startY - sp.yOffset];
		const travel = [
			sp.horizontalScrollLength - sp.horizontalScrollSize,
			sp.verticalScrollLength - sp.verticalScrollSize,
		];
		// One canvas px of slack: the clamps land the thumb ON the end, and an
		// exact compare would leave the loop alive for one more no-op frame.
		return [
			at[0] > 1, at[0] < travel[0] - 1,
			at[1] > 1, at[1] < travel[1] - 1,
		];
	}

	/*
		The band's frame: where the sheet starts inside the canvas and how far it
		runs, in the CANVAS-frame CSS px the fire sites speak, so the axis law
		stays a pure function of position.

		It is the GRID, not the canvas. The canvas carries Calc's row and column
		header bands (~33/27 CSS px) and no drag scrolls through them, so
		measured against the canvas the top band engaged a whole column-header
		short (live: grid top 75 against canvas top 49) and the left band spent
		33 of its 48 px over the row header. The document-anchor section is that
		inset by definition — the point where the document starts inside the
		canvas element — and its extent still reaches the canvas edge, so the far
		bands keep the rates measured on device while the near ones move onto the
		sheet. map._size is NOT this frame: its box stops short of the canvas on
		both far edges, which is the pairing that ran the bottom band 55% and the
		right band 79% too wide. Writer and Impress anchor at the canvas origin,
		so their two frames coincide and this changes nothing there.

		The canvas rect is the fallback for the window before the first section
		layout, when there is no anchor to read.
	*/
	private phoneAutoScrollFrame(): {
		origin: { x: number, y: number },
		size: { x: number, y: number },
	} {
		const grid: CanvasSectionObject =
			this.containerObject.getDocumentAnchorSection();
		if (!grid) {
			const rect = this.containerObject.getCanvasBoundingClientRect();
			return { origin: { x: 0, y: 0 }, size: { x: rect.width, y: rect.height } };
		}
		// myTopLeft and size are core px; the pointer arrives in CSS px.
		return {
			origin: {
				x: grid.myTopLeft[0] / app.dpiScale,
				y: grid.myTopLeft[1] / app.dpiScale,
			},
			size: {
				x: grid.size[0] / app.dpiScale,
				y: grid.size[1] / app.dpiScale,
			},
		};
	}

	/*
		Whole CSS px out of a fractional frame, the remainder carried.

		Map.panBy ROUNDS its CSS-px offset and returns early when that rounds to
		zero, and doMove nulls scrollProperties.moveBy on the very next line — so
		a frame worth less than half a CSS px scrolls nothing AND leaves nothing
		behind to add to the next one. The ramp's slow end is exactly that size
		BY DESIGN: the dead band ends at 4px of penetration and the curve is
		still under 30 CSS px/s for the next five, while 30 CSS px/s is half a px
		per frame. Measured on the graft, top band, finger 8px inside the band:
		the loop stored a live -23 CSS px/s, ran for 1.5s, and moved the sheet
		zero px — 61 of 104 pans rounded away. The inner sixth of every band, on
		both axes, was glass that answered the law with nothing. The right band
		hid it only because the sample that walks it sits deeper in, at 163 px/s.

		So pay out whole px and keep the change. Truncation, not rounding: a
		frame must never travel further than the velocity asked for, and the
		carry makes the average exact either way.
	*/
	public static phoneAutoScrollWholePx(
		residue: number[],
		wantCss: number[],
	): number[] {
		const whole: number[] = [0, 0];
		for (let axis = 0; axis < 2; axis++) {
			residue[axis] += wantCss[axis];
			whole[axis] = Math.trunc(residue[axis]);
			residue[axis] -= whole[axis];
		}
		return whole;
	}

	// CSS px/s for both axes from the STORED pointer — never from the event that
	// started the scroll. A finger held still emits no touchmove, so a velocity
	// latched at the last move is a velocity the user has no way to revoke.
	private phoneAutoScrollVelocity(): number[] {
		const pos: number[] = this.sectionProperties.vulcanAutoScrollPointer;
		if (!pos) return [0, 0];

		const frame = this.phoneAutoScrollFrame();
		const size = frame.size;
		const gridX: number = pos[0] - frame.origin.x;
		const gridY: number = pos[1] - frame.origin.y;
		const reach = this.phoneAutoScrollReach();
		// RTL mirrors the x axis, so the two ends of the document swap with it.
		const rtl = this.isRTL();
		const posX: number = rtl ? size.x - gridX : gridX;

		return [
			ScrollSection.phoneAutoScrollAxis(posX, size.x,
				rtl ? reach[1] : reach[0], rtl ? reach[0] : reach[1]),
			ScrollSection.phoneAutoScrollAxis(gridY, size.y, reach[2], reach[3]),
		];
	}

	private startPhoneAutoScroll(e: any): void {
		// e.pos is CANVAS-frame CSS px (every handleautoscroll fire site passes
		// a canvas-local finger position), and the velocity law re-expresses it
		// in the grid frame from the same canvas origin — see
		// phoneAutoScrollFrame. One frame, one unit, until the very last line.
		this.sectionProperties.vulcanAutoScrollPointer = [e.pos.x, e.pos.y];
		// Optional: only the fire sites that own a selection extent supply one.
		this.sectionProperties.vulcanAutoScrollRepost =
			typeof e.repost === 'function' ? e.repost : null;

		const v: number[] = this.phoneAutoScrollVelocity();
		this.sectionProperties.vulcanAutoScrollVelocity = v;
		if (v[0] === 0 && v[1] === 0) {
			this.cancelAutoScroll();
			return;
		}

		this.map.isAutoScrolling = true;
		// Already running: step() re-derives everything from the pointer stored
		// above, so there is nothing else to hand it.
		if (this.sectionProperties.vulcanAutoScrollRaf !== null) return;

		this.sectionProperties.vulcanAutoScrollLast = performance.now();
		const step = (): void => {
			const now = performance.now();
			// Clamp dt: a backgrounded tab hands back one enormous frame, and an
			// unclamped dt would teleport the sheet on resume.
			const dt = Math.min(0.05,
				(now - this.sectionProperties.vulcanAutoScrollLast) / 1000);
			this.sectionProperties.vulcanAutoScrollLast = now;

			const vel: number[] = this.phoneAutoScrollVelocity();
			this.sectionProperties.vulcanAutoScrollVelocity = vel;
			if (vel[0] === 0 && vel[1] === 0) {
				this.cancelAutoScroll();
				return;
			}

			// CSS px/s -> whole CSS px for this frame, the fraction carried into
			// the next one so the ramp's slow end is not rounded out of
			// existence downstream (phoneAutoScrollWholePx). app.dpiScale turns
			// that into the device px onScrollBy consumes; it is applied HERE
			// and only here, and that single multiply is the DPR fix.
			const stepCss: number[] = ScrollSection.phoneAutoScrollWholePx(
				this.sectionProperties.vulcanAutoScrollResidue,
				[vel[0] * dt, vel[1] * dt],
			);
			if (stepCss[0] !== 0 || stepCss[1] !== 0)
				this.onScrollBy({
					x: stepCss[0] * app.dpiScale,
					y: stepCss[1] * app.dpiScale,
				});

			// The finger names a cell by where it is NOW. Re-project the stored
			// viewport point through the offset the scroll above just changed, or
			// the extent is a function of accumulated travel and only ever grows.
			const repost = this.sectionProperties.vulcanAutoScrollRepost;
			if (this.map.isAutoScrolling && typeof repost === 'function') {
				const pos: number[] = this.sectionProperties.vulcanAutoScrollPointer;
				repost(pos[0], pos[1]);
			}

			this.sectionProperties.vulcanAutoScrollRaf = requestAnimationFrame(step);
		};
		this.sectionProperties.vulcanAutoScrollRaf = requestAnimationFrame(step);
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	public onHandleAutoScroll (e: any): void {
		// Phone autoscroll (item 2.4b). Stock below is 10Hz x a flat +-50, and
		// that 50 is consumed by ViewLayout.scroll() as DEVICE px, so the higher
		// the phone's DPR the SLOWER the drag: 50/3 = 16.7 CSS px per 100ms tick
		// = ~167 CSS px/s on a 3x screen, with no way to go faster however far
		// past the edge you reach. Sheets ramps with distance and runs on the
		// frame clock. Desktop and tablet keep the tagged interval exactly --
		// the desktop cypress specs wait on it by tag
		// (cypress_test/.../desktop/calc4/scrolling_spec.js:96 and :183 ->
		// helper.js:1442 -> timerRegistry.hasActive('autoscroll')).
		if (this.sectionProperties.vulcanPhoneFade) {
			this.startPhoneAutoScroll(e);
			return;
		}

		var vx = 0;
		var vy = 0;

		if (e.pos.y > e.map._size.y - 50) {
			vy = 50;
		} else if (e.pos.y < 50 && e.map._getTopLeftPoint().y > 50) {
			vy = -50;
		}

		const mousePosX: number = this.isRTL() ? e.map._size.x - e.pos.x : e.pos.x;
		const mapLeft: number = this.isRTL() ? e.map._size.x - e.map._getTopLeftPoint().x : e.map._getTopLeftPoint().x;
		if (mousePosX > e.map._size.x - 50) {
			vx = 50;
		} else if (mousePosX < 50 && mapLeft > 50) {
			vx = -50;
		}

		this.onScrollVelocity({ vx: vx, vy: vy, pos: e.pos });
	}

	public onUpdateScrollOffset (): void {
		if (this.map._docLayer._docType === 'spreadsheet') {
			this.map._docLayer.refreshViewData();
			this.map._docLayer._restrictDocumentSize();
		}
	}

	private drawVerticalScrollBar(): void {
		// Phone: refuse to paint an axis that cannot scroll.
		// alwaysDrawVerticalScrollBar (:119-122) is unconditionally true for
		// phone Calc and C2 pins drawVerticalScrollBar true, so nothing else
		// would stop a thumb appearing on a sheet with no vertical overflow --
		// the only canScroll* gate in the tree lives in isMouseOnScrollBar,
		// which the phone no longer reaches. Desktop cannot take this branch,
		// so its test-div write below stays unconditional.
		if (this.sectionProperties.vulcanPhoneFade
			&& !app.activeDocument.activeLayout.canScrollVertical(
				app.sectionContainer.getSectionWithName(app.CSections.Tiles.name)))
			return;

		const scrollProps: ScrollProperties = (app.activeDocument as DocumentBase).activeLayout.scrollProperties;
		const isDarkBackground = this.map.uiManager.isBackgroundDark();
		const docType = app.map._docLayer._docType;

		var startX = this.isRTL() ? scrollProps.edgeOffset : this.size[0] - this.sectionProperties.scrollBarThickness - scrollProps.edgeOffset;

		const alpha = this.sectionProperties.clickScrollVertical
			? this.sectionProperties.alphaWhenBeingUsed : this.scrollBarAlpha();

		if (isDarkBackground && (docType === 'text' || docType === 'drawing')) {
			this.sectionProperties.scrollBarRailwayColor = 'transparent';
		}

		// Wrapped, NOT an early return: the containerObject.testing block below
		// is a test hook, not chrome, and three desktop cypress specs read it.
		if (alpha > 0) {
			if (this.sectionProperties.drawScrollBarRailway) {
				this.context.globalAlpha = this.sectionProperties.scrollBarRailwayAlpha;
				this.context.fillStyle = this.sectionProperties.scrollBarRailwayColor;
				this.fillRoundedBar(
					this.myTopLeft[0] + this.size[0] - scrollProps.edgeOffset - this.sectionProperties.scrollBarRailwayThickness,
					scrollProps.verticalScrollRailwayOffset,
					this.sectionProperties.scrollBarRailwayThickness,
					scrollProps.verticalScrollRailwayLength
				);
			}

			this.context.globalAlpha = alpha;

			this.context.fillStyle = this.sectionProperties.scrollBarThumbColor;

			this.fillRoundedBar(startX, scrollProps.startY, this.sectionProperties.scrollBarThickness, scrollProps.verticalScrollSize - this.sectionProperties.scrollBarThickness);

			this.context.globalAlpha = 1.0;
		}

		if (this.containerObject.testing) {
			var element: HTMLDivElement = <HTMLDivElement>document.getElementById('test-div-vertical-scrollbar');
			if (!element) {
				element = document.createElement('div');
				element.id = 'test-div-vertical-scrollbar';
				document.body.appendChild(element);
			}
			element.textContent = String(scrollProps.startY);
			element.style.display = 'none';
			element.style.position = 'fixed';
			element.style.zIndex = '-1';
		}
	}

	private drawHorizontalScrollBar(): void {
		const desktopWriter = this.map._docLayer._docType === 'text' &&
			document.documentElement.classList.contains('vulcan-desktop-chrome');
		// Phone: refuse to paint an axis that cannot scroll. C2 pins
		// drawHorizontalScrollBar true and this function has never had a
		// canScrollHorizontal check of its own, so without this a sheet with no
		// sideways overflow would flash a full-width bar on every vertical pan.
		// Desktop Writer also starts with the drawing flag set. Its fitted
		// text can be fully visible while the paper margins still overhang;
		// do not show a partly advanced thumb until the next mouse event.
		if ((this.sectionProperties.vulcanPhoneFade || desktopWriter)
			&& !app.activeDocument.activeLayout.canScrollHorizontal(
				app.sectionContainer.getSectionWithName(app.CSections.Tiles.name)))
			return;

		const scrollProps: ScrollProperties = (app.activeDocument as DocumentBase).activeLayout.scrollProperties;

		var startY = this.size[1] - this.sectionProperties.scrollBarThickness - scrollProps.edgeOffset;

		const sizeX = scrollProps.horizontalScrollSize - this.sectionProperties.scrollBarThickness;
		const docWidth: number = app.sectionContainer.getWidth();
		const startX = this.isRTL() ? docWidth - scrollProps.startX - sizeX : scrollProps.startX;

		const alpha = this.sectionProperties.clickScrollHorizontal
			? this.sectionProperties.alphaWhenBeingUsed : this.scrollBarAlpha();

		// Wrapped, NOT an early return: the containerObject.testing block below
		// is a test hook, not chrome, and desktop cypress specs read it.
		if (alpha > 0) {
			if (this.sectionProperties.drawScrollBarRailway) {
				this.context.globalAlpha = this.sectionProperties.scrollBarRailwayAlpha;
				this.context.fillStyle = this.sectionProperties.scrollBarRailwayColor;
				this.fillRoundedBar(
					scrollProps.horizontalScrollRailwayOffset,
					this.myTopLeft[1] + this.size[1] - scrollProps.edgeOffset - this.sectionProperties.scrollBarRailwayThickness,
					scrollProps.horizontalScrollRailwayLength,
					this.sectionProperties.scrollBarRailwayThickness
				);
			}

			this.context.globalAlpha = alpha;

			this.context.fillStyle = this.sectionProperties.scrollBarThumbColor;

			this.fillRoundedBar(startX, startY, sizeX, this.sectionProperties.scrollBarThickness);

			this.context.globalAlpha = 1.0;
		}

		if (this.containerObject.testing) {
			var element: HTMLDivElement = <HTMLDivElement>document.getElementById('test-div-horizontal-scrollbar');
			if (!element) {
				element = document.createElement('div');
				element.id = 'test-div-horizontal-scrollbar';
				document.body.appendChild(element);
			}
			element.textContent = String(scrollProps.startX);
			element.style.display = 'none';
			element.style.position = 'fixed';
			element.style.zIndex = '-1';
		}

	}

	private calculateCurrentAlpha(elapsedTime: number): void {
		if (elapsedTime >= this.sectionProperties.fadeOutStartingTime) {
			// Floor 0, not 0.1. The idle target is zero running animations AND
			// zero painted transient chrome; 0.1 leaves a grey ghost parked on
			// the right edge of every phone sheet forever.
			this.sectionProperties.currentAlpha = Math.max((1 - ((elapsedTime - this.sectionProperties.fadeOutStartingTime) / this.sectionProperties.fadeOutDuration)) * this.sectionProperties.alphaWhenVisible, 0);
		}
		else {
			this.sectionProperties.currentAlpha = this.sectionProperties.alphaWhenVisible;
		}
	}

	// The idle alpha for a scroll bar thumb.
	//
	// Desktop and tablet keep the flat alphaWhenVisible they have always had.
	// calculateCurrentAlpha has been computing currentAlpha into the void since
	// it was written -- before this change nothing in src/ or js/ READ it -- and
	// wiring it in unconditionally would start fading the desktop scroll bars,
	// which is not this change.
	//
	// On a phone it is the whole point, and idle means idle: zero, not a floor.
	// A floored alpha is a permanent mark on the data, which is the defect the
	// puck had.
	private scrollBarAlpha(): number {
		if (!this.sectionProperties.vulcanPhoneFade)
			return this.sectionProperties.alphaWhenVisible;
		// Not animating => the idle window closed, or never opened.
		return this.isAnimating ? this.sectionProperties.currentAlpha : 0;
	}

	private doMove() {
		const scrollProps: ScrollProperties = (app.activeDocument as DocumentBase).activeLayout.scrollProperties;

		// R6-18: read the delta BEFORE panBy consumes it and the line below
		// nulls it. moveBy is device px (ViewLayout.addToMoveBy) and everything
		// past the seam is CSS px, so this is the one and only place the DPR
		// division happens for the immersion -- exactly as panBy does one line
		// down for the pan itself.
		const immersionDyCss: number = scrollProps.moveBy[1] / app.dpiScale;

		this.map.panBy(new cool.Point(scrollProps.moveBy[0] / app.dpiScale, scrollProps.moveBy[1] / app.dpiScale));
		scrollProps.moveBy = null;
		this.onUpdateScrollOffset();

		if (app && app.file.fileBasedView === true)
			app.map._docLayer._checkSelectedPart();

		app.activeDocument.activeLayout.refreshScrollProperties();

		this.kickPhoneScrollFade();
		this.feedVulcanImmersion(immersionDyCss);
	}

	/*
	 * R6-18 — the scroll-direction posture, fed from the ONE place that runs iff
	 * the document actually moved.
	 *
	 * doMove is that place and onDraw is not: onDraw runs for every repaint,
	 * cursor blinks included, and a posture derived there would hide the chrome
	 * while nothing had scrolled. scrollProperties.moveBy is written only by
	 * ViewLayout.addToMoveBy, from scrollHorizontal/scrollVertical, so a delta
	 * arriving here is a real movement by construction -- the same argument that
	 * put kickPhoneScrollFade on this line.
	 */
	private feedVulcanImmersion(dyCss: number): void {
		const im: VulcanReadImmersion = this.sectionProperties.vulcanImmersion;
		if (!im) return;

		// Re-arm every movement: the read/edit stamp flips at runtime and this
		// is the cheapest place that certainly runs after it. Leaving read
		// posture ALSO reaches the machine through UIManager's stamp, which
		// cannot wait for a scroll that may never come.
		if (this.setVulcanImmersionArmed(VulcanReadImmersion.isPhoneWriterRead()))
			this.publishVulcanChrome();
		if (!im.isEnabled()) return;

		const docTopCss = this.map._getTopLeftPoint().y;
		const effect = im.feedMove(dyCss, docTopCss, performance.now());
		if (effect.chromeChanged) this.publishVulcanChrome();
		if (effect.repaint) this.armVulcanImmersionTick();
	}

	/** Arm/disarm, reporting whether the chrome posture flipped as a result. */
	public setVulcanImmersionArmed(armed: boolean): boolean {
		const im: VulcanReadImmersion = this.sectionProperties.vulcanImmersion;
		if (!im) return false;
		if (armed === im.isEnabled()) return false;
		const changed = im.setEnabled(armed);
		if (!armed) this.clearVulcanImmersionTick();
		return changed;
	}

	/*
	 * The stop-reveal and the scrubber fade both need a clock, and neither can
	 * use the container's single animation slot: measured on build #10, this
	 * section held it in 0 of 219 samples during a real read -- MouseControl
	 * owns it for the whole drag, and outside a drag the first onAnimate frame
	 * arrives with elapsedTime === 0, which makes `animatingScrollbar` falsy and
	 * tears the animation down before one fade frame runs. So the immersion owns
	 * a plain timer, re-armed per movement and self-terminating once the pill
	 * has faded and the chrome has settled. Bounded by construction: every path
	 * that keeps it alive is a monotone function of elapsed quiet time.
	 */
	private armVulcanImmersionTick(): void {
		if (this.sectionProperties.vulcanImmersionTimer !== null) return;
		const step = (): void => {
			this.sectionProperties.vulcanImmersionTimer = null;
			const im: VulcanReadImmersion = this.sectionProperties.vulcanImmersion;
			if (!im || !im.isEnabled()) return;
			const effect = im.tick(performance.now());
			if (effect.chromeChanged) this.publishVulcanChrome();
			this.containerObject.requestReDraw();
			// Still owed work: a chrome reveal that has not landed yet, or a
			// pill still fading. Both converge, so this always stops.
			if (effect.repaint || im.isChromeHidden()) this.armVulcanImmersionTick();
		};
		// ~30fps. The fade is 240ms, so 8 frames is plenty for a 34px pill and a
		// quarter of the work a rAF loop would do on a phone that is scrolling.
		this.sectionProperties.vulcanImmersionTimer = setTimeout(step, 33);
	}

	private clearVulcanImmersionTick(): void {
		if (this.sectionProperties.vulcanImmersionTimer === null) return;
		clearTimeout(this.sectionProperties.vulcanImmersionTimer);
		this.sectionProperties.vulcanImmersionTimer = null;
	}

	/*
	 * Stamp the posture and tell the host.
	 *
	 * The CLASS is written first and the message is derived from the DOM by
	 * emitPosture, not passed in: the class is what vulcan-theme.css matches on,
	 * so a message read back off it cannot disagree with what is painted. That
	 * is the same contract `vulcan-read-posture` has carried since one-bar.
	 *
	 * The host half rides Vulcan_Posture -- an existing fork->host channel that
	 * already carries Posture/PhoneChrome/DocType -- as one more sibling field.
	 * A host that predates the field ignores it and keeps its header, which is
	 * today's behaviour: fork-new + host-old is a real deployment state here,
	 * because the fork ships as a pinned image and the host is a separate
	 * deploy.
	 */
	private publishVulcanChrome(): void {
		const im: VulcanReadImmersion = this.sectionProperties.vulcanImmersion;
		if (!im) return;
		document.documentElement.classList.toggle(
			VulcanReadImmersion.HIDDEN_CLASS, im.isChromeHidden());
		if (this.map.uiManager && typeof this.map.uiManager.emitPosture === 'function')
			this.map.uiManager.emitPosture();
		this.containerObject.requestReDraw();
	}

	// Re-arm the phone scroll indicator. doMove() is the ONLY place that runs iff
	// the document actually moved: scrollProperties.moveBy is written only by
	// ViewLayout.addToMoveBy (ViewLayout.ts:407), from scrollHorizontal /
	// scrollVertical. onDraw is not that signal -- it runs for every repaint,
	// including cursor blinks.
	//
	// startAnimating is single-occupancy at the container
	// (CanvasSectionContainer.ts:2311). If another section owns the animation the
	// indicator just does not fade this time and stays at alphaWhenVisible until
	// something redraws -- degraded, never wrong, and never a second rAF loop.
	//
	// Returns whether THIS section holds the container's animation slot when it
	// is done, because vulcanSmoothScrollBy needs that answer and the boolean
	// from startAnimating does not carry it: startAnimating also returns false
	// when this section ALREADY owns the slot, which is the case where the
	// resetAnimation above simply re-arms the timer and onAnimate keeps running.
	// Only the other-owner case means onAnimate will not run for us, so ask the
	// container who holds it rather than trusting the boolean.
	private kickPhoneScrollFade(): boolean {
		if (!this.sectionProperties.vulcanPhoneFade) return false;
		this.sectionProperties.currentAlpha = this.sectionProperties.alphaWhenVisible;
		if (!this.startAnimating({ 'duration': this.sectionProperties.idleDuration }))
			this.resetAnimation();
		return this.containerObject.getAnimatingSectionName() === this.name;
	}

	public onDraw(frameCount: number, elapsedTime: number): void {
		if (app.activeDocument.activeLayout.scrollProperties.moveBy !== null)
			this.doMove();
		else
			app.activeDocument.activeLayout.refreshScrollProperties();

		if (this.isAnimating && frameCount >= 0)
			this.calculateCurrentAlpha(elapsedTime);

		if ((this.sectionProperties.drawVerticalScrollBar || this.sectionProperties.alwaysDrawVerticalScrollBar))
			this.drawVerticalScrollBar();

		if (this.sectionProperties.drawHorizontalScrollBar) {
			this.drawHorizontalScrollBar();
		}

		this.drawVulcanScrubber();
	}

	/*
	 * ── R6-18 scrubber ──────────────────────────────────────────────────────
	 *
	 * How far through the document the reader is, 0..1, from the numbers the
	 * layout already publishes: startY is the thumb top and (scrollLength -
	 * scrollSize) is the distance it can travel. Reusing them rather than
	 * measuring the document keeps the pill and the (unpainted) stock thumb
	 * describing the same position, and costs nothing -- refreshScrollProperties
	 * has already run this frame.
	 */
	private vulcanScrubProgress(): number {
		const sp: ScrollProperties = (app.activeDocument as DocumentBase).activeLayout.scrollProperties;
		const travel = sp.verticalScrollLength - sp.verticalScrollSize;
		if (!(travel > 0)) return 0;
		return Math.min(1, Math.max(0, (sp.startY - sp.yOffset) / travel));
	}

	/** The pill's box in CSS px. Null when there is nothing to scrub. */
	private vulcanScrubPill(): any {
		const im: VulcanReadImmersion = this.sectionProperties.vulcanImmersion;
		if (!im || !im.isEnabled()) return null;
		// Refuse to offer travel on an axis that cannot travel -- the same
		// refusal drawVerticalScrollBar makes, for the same reason.
		if (!app.activeDocument.activeLayout.canScrollVertical(
			app.sectionContainer.getSectionWithName(app.CSections.Tiles.name)))
			return null;
		const wCss = this.size[0] / app.dpiScale;
		const hCss = this.size[1] / app.dpiScale;
		return VulcanReadImmersion.pillRect(wCss, hCss, this.vulcanScrubProgress());
	}

	/*
	 * The boxes that OUTRANK the pill at the same pixel, in CSS px.
	 *
	 * The two text-selection handles and the comment rail: a handle dragged into
	 * the right margin sits under the pill, and the handle is the more specific
	 * intent. Sections are asked by name and only while actually shown, so on a
	 * document with no selection this loop is three misses and no allocation
	 * beyond the empty array.
	 */
	private vulcanScrubReserved(): any[] {
		const names = ['selection_start_handle', 'selection_end_handle',
			app.CSections.CommentList ? app.CSections.CommentList.name : null];
		const out: any[] = [];
		for (const name of names) {
			if (!name) continue;
			const s: CanvasSectionObject = app.sectionContainer.getSectionWithName(name);
			if (!s || !s.isSectionShown() || !s.size || !s.size[0] || !s.size[1]) continue;
			out.push({
				x: s.myTopLeft[0] / app.dpiScale, y: s.myTopLeft[1] / app.dpiScale,
				w: s.size[0] / app.dpiScale, h: s.size[1] / app.dpiScale,
			});
		}
		return out;
	}

	/*
	 * The pill itself: an opaque rounded surface with the two travel chevrons,
	 * Google's read-mode scrubber shape (benchmark g2). OPAQUE, not a tint --
	 * the hard mobile rule in vulcan-theme.css §13 -- so it reads as chrome
	 * floating over the text rather than a stain on it, and it fades to zero
	 * rather than to a floor so an idle document carries no mark at all.
	 */
	private drawVulcanScrubber(): void {
		const im: VulcanReadImmersion = this.sectionProperties.vulcanImmersion;
		if (!im || !im.isEnabled()) return;
		const alpha = im.scrubAlpha(performance.now());
		if (alpha <= 0) return;
		const pill = this.vulcanScrubPill();
		if (!pill) return;

		const d = app.dpiScale;
		const x = this.myTopLeft[0] + pill.x * d;
		const y = this.myTopLeft[1] + pill.y * d;
		const w = pill.w * d;
		const h = pill.h * d;
		const ctx = this.context as any;

		ctx.save();
		ctx.globalAlpha = alpha;
		// Level-2 shadow. The pill floats over the document, never against the
		// iframe edge, so this shadow may decay freely (same argument as the
		// pencil FAB in §13.3).
		ctx.shadowColor = 'rgba(15, 23, 42, 0.22)';
		ctx.shadowBlur = 6 * d;
		ctx.shadowOffsetY = 2 * d;
		ctx.fillStyle = this.sectionProperties.vulcanScrubFill;
		this.fillRoundedBar(x, y, w, h);
		ctx.shadowColor = 'transparent';
		ctx.shadowBlur = 0;
		ctx.shadowOffsetY = 0;

		// Hairline edge: on a white document a white pill needs one.
		ctx.strokeStyle = this.sectionProperties.vulcanScrubEdge;
		ctx.lineWidth = Math.max(1, Math.round(d));
		if (typeof ctx.roundRect === 'function') {
			ctx.beginPath();
			ctx.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, Math.min(w, h) / 2);
			ctx.stroke();
		}

		// ▲ ▼, 5 CSS px tall, 5 CSS px either side of centre.
		const cx = x + w / 2;
		const cy = y + h / 2;
		const arm = 5 * d;
		const gap = 5 * d;
		ctx.strokeStyle = this.sectionProperties.vulcanScrubInk;
		ctx.lineWidth = 2 * d;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.beginPath();
		ctx.moveTo(cx - arm, cy - gap);
		ctx.lineTo(cx, cy - gap - arm * 0.8);
		ctx.lineTo(cx + arm, cy - gap);
		ctx.moveTo(cx - arm, cy + gap);
		ctx.lineTo(cx, cy + gap + arm * 0.8);
		ctx.lineTo(cx + arm, cy + gap);
		ctx.stroke();
		ctx.restore();
		ctx.globalAlpha = 1.0;
	}

	/*
	 * The grab. Returns true when the touch belongs to the pill, so the phone
	 * early-returns in onMouseDown/onMouseMove can let exactly this through and
	 * nothing else.
	 *
	 * The phone build stopped arming the stock scroll-bar grab because its box
	 * was the 20px usableThickness strip down the WHOLE edge -- a strip a thumb
	 * lands in constantly, where every pixel of pan was multiplied by the scroll
	 * ratio. Nothing here reopens that: the box is the painted pill's own 50x68
	 * rect, it exists only while the pill is painted, and it stands down under a
	 * selection handle.
	 */
	private vulcanScrubGrabAt(point: cool.SimplePoint): boolean {
		const im: VulcanReadImmersion = this.sectionProperties.vulcanImmersion;
		if (!im || !im.isEnabled()) return false;
		const pill = this.vulcanScrubPill();
		if (!pill) return false;
		return im.canGrab(point.cX, point.cY, pill, this.vulcanScrubReserved(), performance.now());
	}

	/*
	 * Finger travel -> document travel, in one conversion with no hidden term.
	 *
	 * verticalScrollRatio is document px per THUMB px, and the thumb's travel is
	 * a different distance from the pill's, so using it raw would scroll by the
	 * wrong amount -- subtly, and only on documents where the thumb is clamped
	 * to its minimum length, which is exactly the long documents this feature is
	 * for. Re-base it onto the pill's own travel: the document distance is the
	 * same either way, so the ratio scales by the travel ratio.
	 */
	private vulcanScrubDocPerPillPx(): number {
		const sp: ScrollProperties = (app.activeDocument as DocumentBase).activeLayout.scrollProperties;
		const thumbTravel = sp.verticalScrollLength - sp.verticalScrollSize;
		const pillTravel = (this.size[1] / app.dpiScale - VulcanReadImmersion.PILL_H_CSS) * app.dpiScale;
		if (!(pillTravel > 0) || !(thumbTravel > 0)) return sp.verticalScrollRatio;
		return sp.verticalScrollRatio * thumbTravel / pillTravel;
	}

	// A short eased reveal instead of a teleport, for the small hops the cell
	// cursor makes (arrow key, tab, tapping the next row). Phone only, and SHORT
	// only -- a jump to A1 from row 5000 must stay instant or the user watches a
	// 5000-row flight. Returns false when it declines, so the caller falls back
	// to the stock scrollTo with no branching of its own.
	public vulcanSmoothScrollBy(pX: number, pY: number): boolean {
		if (!this.sectionProperties.vulcanPhoneFade) return false;
		const maxHop = 4 * this.containerObject.getScrollLineHeight() * app.dpiScale;
		if (Math.abs(pX) > maxHop || Math.abs(pY) > maxHop) return false;
		// ORDER IS LOAD-BEARING, and not the order you would guess. Queue the
		// delta BEFORE kicking the fade, because kickPhoneScrollFade passes no
		// `defer` and so startAnimating runs the first onAnimate frame
		// SYNCHRONOUSLY inside the call (CanvasSectionContainer.ts:2387). That
		// frame arrives with elapsedTime === 0, which makes `animatingScrollbar`
		// falsy in the tail of onAnimate below -- so if the queue is still empty
		// when it runs, the tail calls stopAnimating() and the container tears
		// the animation down on the very next frame. onAnimate is then never
		// called again and the delta is never paid out at all. Queuing first
		// means frame 0 sees the outstanding reveal and keeps the slot alive.
		const reveal: number[] = this.sectionProperties.vulcanRevealRemaining;
		const previousX = reveal[0];
		const previousY = reveal[1];
		reveal[0] += pX;
		reveal[1] += pY;
		// a reveal IS a scroll: show the indicator, and find out whether we hold
		// the container's single animation slot. If another section has it
		// (MouseControl.startVulcanFling holds it for the whole coast) onAnimate
		// will not run for us: un-queue exactly what we just added and return
		// false, so the caller teleports instead of leaving a delta to be
		// applied later as a jump by a stale amount. kickPhoneScrollFade cannot
		// have touched the queue on that path -- startAnimating refused, and
		// resetAnimation is a no-op when another section owns the slot.
		if (!this.kickPhoneScrollFade()) {
			reveal[0] = previousX;
			reveal[1] = previousY;
			return false;
		}
		return true;
	}

	public onAnimate(frameCount: number, elapsedTime: number): void {
		const timeDelta = (elapsedTime - this.sectionProperties.lastElapsedTime) / (1000/60);

		// Consume any pending eased reveal first. Exponential approach, so it is
		// frame-rate independent and always finishes: ~95% of the distance in
		// ~120ms. Rides the fade's animation slot, which kickPhoneScrollFade has
		// already opened for 2s -- far longer than this needs.
		const reveal: number[] = this.sectionProperties.vulcanRevealRemaining;
		if (reveal[0] !== 0 || reveal[1] !== 0) {
			const dtSec = Math.min(0.05,
				Math.max(0, elapsedTime - this.sectionProperties.lastElapsedTime) / 1000);
			const k = 1 - Math.pow(0.0001, dtSec / 0.12);
			for (let i = 0; i < 2; ++i) {
				if (reveal[i] === 0) continue;
				let stepPx = reveal[i] * k;
				if (Math.abs(reveal[i]) - Math.abs(stepPx) < 0.5) stepPx = reveal[i];
				reveal[i] -= stepPx;
				if (Math.abs(reveal[i]) < 0.5) reveal[i] = 0;
				// scroll*WithOffset returns undefined when its axis cannot
				// scroll (:587-588, :599-600). Without zeroing on that, the
				// residual is never consumed, never falls under the 0.5 snap,
				// and holds the container's single animation slot for the full
				// 2s doing nothing.
				const moved = (i === 0)
					? this.scrollHorizontalWithOffset(stepPx)
					: this.scrollVerticalWithOffset(stepPx);
				if (!moved) reveal[i] = 0;
			}
		}

		if (this.sectionProperties.animatingScroll) {
			const lineHeight = this.containerObject.getScrollLineHeight();
			// Smoothness will be affected by Firefox bug #1967935
			// Note that we should really use geometric series to calculate acceleration when frames
			// are skipped, but given we expect consistent performance, this shouldn't make a
			// noticeable difference and isn't worth the added complication.
			const accel = lineHeight * ScrollSection.scrollAnimationAcceleration * timeDelta * app.dpiScale;

			// Calculate horizontal and vertical scroll deltas for this animation step
			const deltas = [0, 0];
			for (let i = 0; i < 2; ++i) {
				const sign = this.sectionProperties.scrollAnimationDirection[i];

				// Note for future implementers: if we wanted to accelerate the scroll distance over time,
				// we ought to multiply the scrollAnimationDelta here by some factor that increases with
				// elapsedTime.
				this.sectionProperties.scrollAnimationAcc[i] += this.sectionProperties.scrollAnimationDelta[i];
				this.sectionProperties.scrollAnimationDelta[i] = 0;

				this.sectionProperties.scrollAnimationVelocity[i] += this.sectionProperties.scrollAnimationAcc[i] != 0 ? accel : -accel;
				this.sectionProperties.scrollAnimationVelocity[i] = Math.max(0, this.sectionProperties.scrollAnimationVelocity[i]);

				deltas[i] = this.sectionProperties.scrollAnimationVelocity[i] * sign;

				if (Math.abs(deltas[i]) >= Math.abs(this.sectionProperties.scrollAnimationAcc[i]))
					this.sectionProperties.scrollAnimationAcc[i] = 0;
				else
					this.sectionProperties.scrollAnimationAcc[i] -= deltas[i];
			}

			// Perform scrolling, if necessary
			if (deltas[0] !== 0)
				this.scrollHorizontalWithOffset(deltas[0]);
			if (deltas[1] !== 0)
				this.scrollVerticalWithOffset(deltas[1]);
		} else {
			if (this.sectionProperties.scrollWheelDelta[0] !== 0) {
				const delta = this.sectionProperties.scrollWheelDelta[0];
				this.sectionProperties.scrollWheelDelta[0] = 0;
				this.scrollHorizontalWithOffset(delta);
			}
			if (this.sectionProperties.scrollWheelDelta[1] !== 0) {
				const delta = this.sectionProperties.scrollWheelDelta[1];
				this.sectionProperties.scrollWheelDelta[1] = 0;
				this.scrollVerticalWithOffset(delta);
			}
		}

		this.sectionProperties.lastElapsedTime = elapsedTime;

		// fadeOutDuration is 200ms, but the ramp does not START until
		// fadeOutStartingTime (1800ms), so the stock window shuts 1600ms before
		// calculateCurrentAlpha's fade branch can ever be reached. Phones get the
		// full idleDuration so the ramp actually runs. Desktop keeps the 200ms
		// window exactly: widening it there would hold a requestAnimationFrame
		// loop alive for two seconds after every wheel tick.
		const idleWindow = this.sectionProperties.vulcanPhoneFade
			? this.sectionProperties.idleDuration
			: this.sectionProperties.fadeOutDuration;
		const animatingScrollbar = elapsedTime && (elapsedTime < idleWindow);
		const animatingScroll = this.sectionProperties.animatingScroll
			&& (timeDelta <= 0 || this.sectionProperties.scrollAnimationVelocity.reduce((a: number, x: number) => a + x, 0) !== 0);
		// An outstanding reveal is a THIRD reason to keep the slot. Without it
		// the first frame of a fresh kick (elapsedTime === 0, so
		// animatingScrollbar is falsy, and animatingScroll is false because
		// animatingScroll is only ever set by the wheel path a phone does not
		// have) tears the animation down before the reveal has moved a pixel.
		// Off-phone this term is always false: vulcanRevealRemaining is written
		// only by vulcanSmoothScrollBy, which returns early unless
		// vulcanPhoneFade. There is no runaway -- the container's own duration
		// cap (idleDuration, 2s) still ends the animation regardless, and the
		// reveal converges to 0 in ~120ms.
		const animatingReveal = reveal[0] !== 0 || reveal[1] !== 0;
		if (!animatingScrollbar && !animatingScroll && !animatingReveal) this.containerObject.stopAnimating();
	}

	public onAnimationEnded(frameCount: number, elapsedTime: number): void {
		// Last line of defence for the reveal contract: vulcanSmoothScrollBy
		// returning true told the caller not to teleport, so the delta must not
		// survive the animation that was supposed to pay it out. It can still
		// get here -- the container's duration cap fires in animate() before
		// onAnimate is called, and a reveal can land in the one frame between a
		// stopAnimating() and the teardown that follows it (a pan re-kicks the
		// fade with an empty queue, and the cell-cursor message is a socket
		// callback, not rAF-aligned). Pay the remainder out now rather than
		// leaving it to surface later as a jump by a stale amount. No-op on
		// every other platform and on every animation that ends cleanly.
		const reveal: number[] = this.sectionProperties.vulcanRevealRemaining;
		if (reveal[0] !== 0) { this.scrollHorizontalWithOffset(reveal[0]); reveal[0] = 0; }
		if (reveal[1] !== 0) { this.scrollVerticalWithOffset(reveal[1]); reveal[1] = 0; }
		this.sectionProperties.animatingScroll = false;
		this.sectionProperties.scrollAnimationAcc = [0, 0];
		this.sectionProperties.scrollAnimationVelocity = [0, 0];
		this.sectionProperties.scrollAnimationDirection = [0, 0];
	}

	private increaseScrollBarThickness () : void {
		this.sectionProperties.scrollBarThickness = this.sectionProperties.scrollBarRailwayThickness = 8 * app.roundedDpiScale;
		this.containerObject.requestReDraw();
	}

	private decreaseScrollBarThickness () : void {
		this.sectionProperties.scrollBarThickness = this.sectionProperties.scrollBarRailwayThickness = 6 * app.roundedDpiScale;
		this.containerObject.requestReDraw();
	}

	private hideHorizontalScrollBar(): void {
		this.sectionProperties.drawHorizontalScrollBar = false;

		if (this.sectionProperties.mouseIsOnHorizontalScrollBar) {
			this.sectionProperties.mouseIsOnHorizontalScrollBar = false;
		}

		this.decreaseScrollBarThickness();
	}

	private hideVerticalScrollBar (): void {
		if (this.sectionProperties.mouseIsOnVerticalScrollBar) {
			this.sectionProperties.mouseIsOnVerticalScrollBar = false;
		}

		this.decreaseScrollBarThickness();

		if (!(<any>window).mode.isDesktop() || app.map._docLayer._docType !== 'spreadsheet') { // On desktop, we don't want to hide the vertical scroll bar.
			this.sectionProperties.drawVerticalScrollBar = false;
		}
	}

	private showHorizontalScrollBar (): void {
		this.sectionProperties.drawHorizontalScrollBar = true;

		// Prevent Instant Mouse hover
		setTimeout(() => {
			if (this.sectionProperties.mouseIsOnHorizontalScrollBar) {
				this.increaseScrollBarThickness();
			}
		}, 100);

		if (!this.containerObject.isDraggingSomething() && !(<any>window).mode.isDesktop())
			this.containerObject.requestReDraw();
	}

	private showVerticalScrollBar (): void {
		this.sectionProperties.drawVerticalScrollBar = true;

		// Prevent Instant Mouse hover
		setTimeout(() => {
			if (this.sectionProperties.mouseIsOnVerticalScrollBar) {
				this.increaseScrollBarThickness();
			}
		}, 100);

		if (!this.containerObject.isDraggingSomething() && !(<any>window).mode.isDesktop())
			this.containerObject.requestReDraw();
	}

	private setCursorForScrollBar(): void {
		this.context.canvas.style.cursor = 'pointer';
		if (this.context.canvas.classList.contains('spreadsheet-cursor'))
			this.context.canvas.classList.remove('spreadsheet-cursor');
	}

	private isMouseOnScrollBar (point: cool.SimplePoint): void {
		const scrollProps: ScrollProperties = (app.activeDocument as DocumentBase).activeLayout.scrollProperties;
		const documentAnchor: CanvasSectionObject = app.sectionContainer.getSectionWithName(app.CSections.Tiles.name);

		const mirrorX = this.isRTL();

		let temp = point.pY >= this.size[1] - scrollProps.usableThickness;
		temp = temp && ((!mirrorX && point.pX <= this.size[0] - scrollProps.horizontalScrollRightOffset && point.pX >= scrollProps.xOffset)
					|| (mirrorX && point.pX >= scrollProps.horizontalScrollRightOffset && point.pX >= scrollProps.xOffset));

		this.sectionProperties.mouseIsOnHorizontalScrollBar = temp;

		if (app.activeDocument.activeLayout.canScrollHorizontal(documentAnchor)) {
			if ((<any>window).mode.isDesktop() || this.sectionProperties.mouseIsOnHorizontalScrollBar)
				this.showHorizontalScrollBar();
			else if (this.sectionProperties.drawHorizontalScrollBar === true)
				this.hideHorizontalScrollBar();
		}
		else if (this.sectionProperties.drawHorizontalScrollBar === true) this.hideHorizontalScrollBar();

		temp = point.pX >= this.size[0] - scrollProps.usableThickness;
		temp = temp && (!mirrorX && point.pX >= this.size[0] - scrollProps.usableThickness) || (mirrorX && point.pX <= scrollProps.usableThickness);
		this.sectionProperties.mouseIsOnVerticalScrollBar = temp;

		if (app.activeDocument.activeLayout.canScrollVertical(documentAnchor)) {
			if ((<any>window).mode.isDesktop() || this.sectionProperties.mouseIsOnVerticalScrollBar)
				this.showVerticalScrollBar();
			else
				this.hideVerticalScrollBar();
		}
		else this.hideVerticalScrollBar();

		if (this.sectionProperties.mouseIsOnHorizontalScrollBar || this.sectionProperties.mouseIsOnVerticalScrollBar) {
			this.setCursorForScrollBar();
		}
	}

	public onMouseLeave (): void {
		// Phone has no hover; a synthetic mouse-out must not switch the
		// indicators off permanently (hideHorizontalScrollBar sets
		// drawHorizontalScrollBar = false, and on a phone nothing sets it back).
		if (this.sectionProperties.vulcanPhoneFade) return;

		this.hideVerticalScrollBar();
		this.hideHorizontalScrollBar();
	}

	public scrollVerticalWithOffset (offset: number): boolean {
		if (!app.activeDocument.activeLayout.canScrollVertical(app.sectionContainer.getSectionWithName(app.CSections.Tiles.name)))
			return;

		const userIsScrolling: boolean = true;
		app.activeDocument.activeLayout.scroll(0, offset, userIsScrolling);

		if (app.file.fileBasedView) this.map._docLayer._checkSelectedPart();

		return true;
	}

	public scrollHorizontalWithOffset (offset: number): boolean {
		if (!app.activeDocument.activeLayout.canScrollHorizontal(app.sectionContainer.getSectionWithName(app.CSections.Tiles.name)))
			return;

		const userIsScrolling: boolean = true;
		app.activeDocument.activeLayout.scroll(offset, 0, userIsScrolling);

		return true;
	}

	/*
		previousDragDistance is a MOUSEDOWN anchor, not a latch anchor. Do not
		"fix" it to the drag distance observed when the latch fired.

		dragDistance arrives measured from mousedown, so seeding the
		accumulator with [0, 0] - the drag distance at mousedown, by definition
		- makes the per-move diffs telescope: they sum to the total finger
		travel no matter where the latch fired. That is what keeps the thumb
		stuck to the finger, and it is why raising the touch latch in
		CanvasSectionContainer.getTouchDragLatchSquared() is safe here. The
		only visible consequence of a wider latch is that the first diff after
		it fires is the slop rather than a pixel, which scrolls the document by
		exactly the amount the finger has already earned - the thumb catching
		up to the finger, bounded by the slop. The desktop path already does
		this: draggingTolerance is 5 core px, so a mouse thumb-drag has always
		eaten a 5 px first diff.

		Seeding with the latch-time drag distance instead would subtract the
		slop from the total for the rest of the gesture, leaving the thumb
		trailing the finger by the slop permanently. It would introduce the
		defect it looks like it removes.

		The reset below is a different bug and a real one. previousDragDistance
		was only ever cleared in onMouseUp, but onTouchCancel clears the
		container's own state without propagating a mouse-up to any section
		(CanvasSectionContainer.onTouchCancel calls clearMousePositions and
		nothing else). A scrollbar drag interrupted by the browser therefore
		left a stale accumulator behind, and the next grab of the thumb
		computed its first diff against the previous gesture's distance - a
		jump of arbitrary size and sign. Clearing at drag start closes that:
		this section is a windowSection (:34), so it receives every mousedown
		regardless of where the touch landed.
	*/
	public onMouseMove (position: cool.SimplePoint, dragDistance: Array<number>, e: MouseEvent): void {
		const scrollProps: ScrollProperties = (app.activeDocument as DocumentBase).activeLayout.scrollProperties;

		// Phone: none of the three branches below apply. Two are scroll bar
		// DRAGS, which C6a stops arming, and the third is hover feedback for a
		// pointer a phone does not have -- but it still called stopPropagating()
		// (:648) for a finger merely resting in the edge strip, which is how a
		// pan that started near the bezel went nowhere.
		//
		// R6-18 is the ONE exception, and it is narrow by construction: the
		// grab was armed in onMouseDown against the painted pill's own box, so
		// reaching this branch means the finger is dragging that pill and
		// nothing else. Everything C6a refuses stays refused.
		if (this.sectionProperties.vulcanPhoneFade) {
			if (this.sectionProperties.vulcanScrubGrab !== null
				&& this.containerObject.isDraggingSomething())
				this.dragVulcanScrubber(dragDistance);
			return;
		}

		this.clearQuickScrollTimeout();

		if (this.sectionProperties.clickScrollVertical && this.containerObject.isDraggingSomething()) {
			if (!this.sectionProperties.previousDragDistance) {
				this.sectionProperties.previousDragDistance = [0, 0];
			}

			this.showVerticalScrollBar();

			var diffY: number = dragDistance[1] - this.sectionProperties.previousDragDistance[1];
			this.scrollVerticalWithOffset(diffY * scrollProps.verticalScrollRatio);

			this.sectionProperties.previousDragDistance[1] = dragDistance[1];

			this.stopPropagating(); // Don't propagate to other sections.
		}
		else if (this.sectionProperties.clickScrollHorizontal && this.containerObject.isDraggingSomething()) {
			if (!this.sectionProperties.previousDragDistance) {
				this.sectionProperties.previousDragDistance = [0, 0];
			}

			this.showHorizontalScrollBar();

			var diffX: number = dragDistance[0] - this.sectionProperties.previousDragDistance[0];
			this.scrollHorizontalWithOffset(scrollProps.horizontalScrollRatio * diffX);

			this.sectionProperties.previousDragDistance[0] = dragDistance[0];
			this.stopPropagating(); // Don't propagate to other sections.
		}
		else {
			const draggingOnDocument = this.containerObject.isDraggingSomething();

			this.isMouseOnScrollBar(position);
			const onScrollBar = this.sectionProperties.mouseIsOnVerticalScrollBar || this.sectionProperties.mouseIsOnHorizontalScrollBar;

			// To stop propagation, user shouldn't be dragging something and mouse should be on a scroll bar.
			if (!draggingOnDocument && onScrollBar)
				this.stopPropagating(); // Don't propagate to other sections.
		}
	}

	/*
		When user presses the button while the mouse pointer is on the railway of the scroll bar but not on the scroll bar directly,
		we quickly scroll the document to that position.
	*/
	private quickScrollVertical (point: cool.SimplePoint, originalSign?: number): void {
		// Desktop only for now.
		if (!(<any>window).mode.isDesktop())
			return;

		window.L.DomUtil.addClass(document.documentElement, 'prevent-select');
		const scrollProps: ScrollProperties = app.activeDocument.activeLayout.scrollProperties;

		if (this.stepByStepScrolling) {
			var sign = (point.pY - (scrollProps.startY + scrollProps.verticalScrollSize)) > 0
				? 1 : ((point.pY - scrollProps.startY) < 0 ? -1 : 0);
			var offset = scrollProps.verticalScrollStep * sign;

			if (this.sectionProperties.quickScrollVerticalTimer)
				clearTimeout(this.sectionProperties.quickScrollVerticalTimer);
			if (this.sectionProperties.clickScrollVertical)
				this.sectionProperties.quickScrollVerticalTimer = setTimeout(() => {
					if (!originalSign || originalSign === sign) {
						this.quickScrollVertical(point, sign);
					}
				}, this.sectionProperties.stepDuration);
		} else {
			offset = (point.pY - (scrollProps.startY + scrollProps.verticalScrollSize * 0.5)) * scrollProps.verticalScrollRatio
		}

		this.scrollVerticalWithOffset(offset);
	}

	/*
		When user presses the button while the mouse pointer is on the railway of the scroll bar but not on the scroll bar directly,
		we quickly scroll the document to that position.
	*/
	private quickScrollHorizontal (point: cool.SimplePoint, originalSign?: number): void {
		// Desktop only for now.
		if (!(<any>window).mode.isDesktop())
			return;

		window.L.DomUtil.addClass(document.documentElement, 'prevent-select');
		const scrollProps: ScrollProperties = app.activeDocument.activeLayout.scrollProperties;
		const sizeX = scrollProps.horizontalScrollSize - this.sectionProperties.scrollBarThickness;
		const docWidth: number = app.sectionContainer.getWidth();
		const startX = this.isRTL() ? docWidth - scrollProps.startX - sizeX : scrollProps.startX;

		if (this.stepByStepScrolling) {
			var sign = (point.pX - (startX + sizeX)) > 0
				? 1 : ((point.pX - startX) < 0 ? -1 : 0);
			var offset = scrollProps.horizontalScrollStep * sign;

			if (this.sectionProperties.quickScrollHorizontalTimer)
				clearTimeout(this.sectionProperties.quickScrollHorizontalTimer);
			if (this.sectionProperties.clickScrollHorizontal)
				this.sectionProperties.quickScrollHorizontalTimer = setTimeout(() => {
					if (!originalSign || originalSign === sign) {
						this.quickScrollHorizontal(point, sign);
					}
				}, this.sectionProperties.stepDuration);
		} else {
			offset = (point.pX - (scrollProps.startX + scrollProps.horizontalScrollSize * 0.5)) * scrollProps.horizontalScrollRatio;
		}

		this.scrollHorizontalWithOffset(offset);
	}

	private clearQuickScrollTimeout() {
		if (this.sectionProperties.quickScrollVerticalTimer) {
			clearTimeout(this.sectionProperties.quickScrollVerticalTimer);
			this.sectionProperties.quickScrollVerticalTimer = null;
		}
		if (this.sectionProperties.quickScrollHorizontalTimer) {
			clearTimeout(this.sectionProperties.quickScrollHorizontalTimer);
			this.sectionProperties.quickScrollHorizontalTimer = null;
		}
	}

	/*
		Scroll bar dragging maps the mouse movement to a document position with
		the current ratio between the scroll bar length and the scrollable area.
		In spreadsheets the scrollable area grows when the view reaches its end,
		which changes that ratio mid-drag: the scroll bar shrinks and jumps under
		the pointer and the document grows without limit while the user keeps
		dragging. So freeze the document size when the scroll bar is grabbed and
		recalculate it once when it is released.
	*/
	private freezeDocumentSize(): void {
		if (this.map._docLayer._docType === 'spreadsheet')
			this.map._docLayer.freezeDocumentSize();
	}

	private unfreezeDocumentSize(): void {
		if (this.map._docLayer._docType === 'spreadsheet')
			this.map._docLayer.unfreezeDocumentSize();
	}

	public onMouseDown (point: cool.SimplePoint, e: MouseEvent): void {
		const layout = (app.activeDocument as DocumentBase).activeLayout;
		const scrollProps: ScrollProperties = layout.scrollProperties;
		// A touchcancel never reaches onMouseUp, so every new gesture resets the
		// absolute-distance accumulator before either capture path can use it.
		this.sectionProperties.previousDragDistance = null;

		// Phone: the scroll bar is an indicator, not a control, and everything
		// below exists to grab it. The grab box is the 20px usableThickness strip
		// down each edge (ViewLayout.ts:43) -- a strip a thumb lands in
		// constantly. Once grabbed, onMouseMove multiplies every pixel of the pan
		// by verticalScrollRatio and stopPropagation keeps the grid from ever
		// seeing the gesture, so a flick near the bezel jumps hundreds of rows.
		// quickScrollVertical/Horizontal already refuse to run off-desktop
		// (:658, :690); this refuses the CAPTURE that precedes them.
		//
		// R6-18: the scrubber is the one control on this edge a phone DOES get,
		// and it earns the capture the honest way -- the touch is inside the
		// pill that is painted right now, and no selection handle or comment
		// rail claims the same pixel. There is no path here to the old
		// full-height edge strip: vulcanScrubGrabAt is false whenever the pill
		// is invisible, which is most of the time.
		if (this.sectionProperties.vulcanPhoneFade) {
			this.sectionProperties.vulcanScrubGrab = null;
			if (!this.vulcanScrubGrabAt(point)) return;
			this.sectionProperties.vulcanScrubGrab = [0, 0];
			this.sectionProperties.vulcanImmersion.setScrubbing(true, performance.now());
			this.map.scrollingIsHandled = true;
			this.containerObject.capturePointerForDrag();
			e.stopPropagation();  // Don't propagate to map.
			this.stopPropagating(); // Don't propagate to bound sections.
			this.containerObject.requestReDraw();
			return;
		}

		this.clearQuickScrollTimeout();
		this.onMouseMove(point, null, e);
		this.isMouseOnScrollBar(point);

		const mirrorX = this.isRTL();
		const documentAnchor = app.sectionContainer.getSectionWithName(app.CSections.Tiles.name);

		// For CompareChanges view, viewedRectangle.pY1 can be negative while scrolling is possible.
		const initialVerticalCheck = layout.type === 'ViewLayoutCompareChanges' ? true : layout.viewedRectangle.pY1 >= 0;

		if (initialVerticalCheck) {
			if ((!mirrorX && point.pX >= this.size[0] - scrollProps.usableThickness)
				|| (mirrorX && point.pY <= scrollProps.usableThickness)) {
				if (point.pY > scrollProps.yOffset) {
					this.sectionProperties.clickScrollVertical = true;
					this.map.scrollingIsHandled = true;
					this.containerObject.capturePointerForDrag();
					this.freezeDocumentSize();
					this.quickScrollVertical(point);
					e.stopPropagation(); // Don't propagate to map.
					this.stopPropagating(); // Don't propagate to bound sections.
				}
				else {
					this.sectionProperties.clickScrollVertical = false;
				}
			}
			else {
				this.sectionProperties.clickScrollVertical = false;
			}
		}

		// Same reasoning as vertical: CompareChanges can have negative pX1.
		const canScrollH = layout.type === 'ViewLayoutCompareChanges'
			? layout.canScrollHorizontal(documentAnchor)
			: layout.viewedRectangle.pX1 >= 0;

		if (canScrollH) {
			if (point.pY >= this.size[1] - scrollProps.usableThickness) {
				if ((!mirrorX && point.pX >= scrollProps.xOffset && point.pX <= this.size[0] - scrollProps.horizontalScrollRightOffset)
					|| (mirrorX && point.pX >= scrollProps.xOffset && point.pX >= scrollProps.horizontalScrollRightOffset)) {
					this.sectionProperties.clickScrollHorizontal = true;
					this.map.scrollingIsHandled = true;
					this.containerObject.capturePointerForDrag();
					this.freezeDocumentSize();
					this.quickScrollHorizontal(point);
					e.stopPropagation(); // Don't propagate to map.
					this.stopPropagating(); // Don't propagate to bound sections.
				}
				else {
					this.sectionProperties.clickScrollHorizontal = false;
				}
			}
			else {
				this.sectionProperties.clickScrollHorizontal = false;
			}
		}
	}

	/*
	 * One drag step of the pill.
	 *
	 * previousDragDistance is seeded with [0, 0] at the grab and the per-move
	 * diffs telescope from there, exactly as the desktop thumb drag does -- so
	 * the pill stays stuck to the finger however wide the container's touch
	 * latch is. See the long note above onMouseMove for why seeding with the
	 * latch-time distance instead would leave it permanently trailing.
	 */
	private dragVulcanScrubber(dragDistance: Array<number>): void {
		if (!dragDistance) return;
		const previous: number[] = this.sectionProperties.vulcanScrubGrab;
		const diffY = dragDistance[1] - previous[1];
		previous[1] = dragDistance[1];
		if (diffY !== 0) this.scrollVerticalWithOffset(diffY * this.vulcanScrubDocPerPillPx());
		this.stopPropagating(); // Don't propagate to other sections.
	}

	/** Release the pill. Safe to call when nothing was grabbed. */
	private releaseVulcanScrubber(): void {
		if (this.sectionProperties.vulcanScrubGrab === null) return;
		this.sectionProperties.vulcanScrubGrab = null;
		const im: VulcanReadImmersion = this.sectionProperties.vulcanImmersion;
		if (im) {
			im.setScrubbing(false, performance.now());
			// The idle clock restarts at the RELEASE, so the pill has to be
			// given a frame budget from here or it would sit lit forever with
			// nothing left to redraw the canvas.
			this.armVulcanImmersionTick();
		}
		this.containerObject.releasePointerForDrag();
		this.containerObject.requestReDraw();
	}

	public onMouseUp (point: cool.SimplePoint, e: MouseEvent): void {
		window.L.DomUtil.removeClass(document.documentElement, 'prevent-select');
		this.map.scrollingIsHandled = false;
		this.clearQuickScrollTimeout();
		this.unfreezeDocumentSize();

		// R6-18. Before the phone early-returns below, and unconditional: a
		// grab that is never released leaves the pointer captured and every
		// later pan multiplied by the scrub ratio.
		if (this.sectionProperties.vulcanScrubGrab !== null) {
			this.releaseVulcanScrubber();
			e.stopPropagation();
			this.stopPropagating();
			this.sectionProperties.previousDragDistance = null;
			return;
		}

		if (this.sectionProperties.clickScrollVertical) {
			this.containerObject.releasePointerForDrag();
			e.stopPropagation(); // Don't propagate to map.
			this.stopPropagating(); // Don't propagate to bound sections.
			this.sectionProperties.clickScrollVertical = false;
		}
		else if (this.sectionProperties.clickScrollHorizontal) {
			this.containerObject.releasePointerForDrag();
			e.stopPropagation(); // Don't propagate to map.
			this.stopPropagating(); // Don't propagate to bound sections.
			this.sectionProperties.clickScrollHorizontal = false;
		}

		this.sectionProperties.previousDragDistance = null;
		this.onMouseMove(point, null, e);
	}

	public onClick(point: cool.SimplePoint, e: MouseEvent): void {
		if (this.isAnimating && this.sectionProperties.animatingWheelScrollVertical)
			this.containerObject.stopAnimating();
	}

	/*
	 * A second finger means a pinch, and R6-13's grammar is that a pinch arms
	 * nothing: stand the scrubber down rather than let a zoom gesture drag the
	 * document by the scrub ratio. This is also the touch-cancel path that
	 * onMouseUp cannot cover -- CanvasSectionContainer.onTouchCancel clears its
	 * own state and propagates no mouse-up to any section, which is the same
	 * hole that used to strand previousDragDistance.
	 */
	public onMultiTouchStart(e: TouchEvent): void {
		this.releaseVulcanScrubber();
	}

	private animateScroll(delta: [number, number]): void {
		const lineHeight = this.containerObject.getScrollLineHeight();

		for (let i = 0; i < 2; ++i) {
			if (Math.abs(delta[i]) === 0) continue;

			const sign = delta[i] > 0 ? 1 : -1;
			if (sign !== this.sectionProperties.scrollAnimationDirection[i]) {
				// Stop animation on scroll change direction
				this.sectionProperties.scrollAnimationVelocity[i] = 0;
				this.sectionProperties.scrollAnimationAcc[i] = 0;
				this.sectionProperties.scrollAnimationDirection[i] = sign;
			}

			this.sectionProperties.scrollAnimationDelta[i] =
				lineHeight * ScrollSection.scrollWheelDelta * sign * app.dpiScale;
		}

		if (!this.sectionProperties.animatingScroll) {
			this.sectionProperties.animatingScroll = true;
			this.sectionProperties.lastElapsedTime = 0;
			// We're about to start a duration-less animation, so we need to
			// ensure the animation is reset.
			if (!this.startAnimating({ 'defer': true })) this.resetAnimation();
		}
	}

	public onMouseWheel (point: cool.SimplePoint, delta: Array<number>, e: WheelEvent): void {
		// VULCAN: a reserved gesture does not interrupt an active one. While
		// an object drag/resize is live, swallow wheel zoom AND scroll —
		// rescaling or scrolling the document under an in-flight move
		// desyncs it (reference vector editors keep zoom/pan out of a drag). The drag owns
		// the pointer until release.
		if (this.containerObject.isDraggingSomething()) {
			e.preventDefault();
			this.stopPropagating();
			return;
		}
		if (e.ctrlKey) {
			e.preventDefault();
			e.stopImmediatePropagation();
			this.stopPropagating();
			app.map.scrollHandler._onWheelScroll(e);
			return;
		}

		this.map.fire('closepopups'); // close all popups when scrolling

		if (e.deltaX !== 0)
			e.preventDefault();

		let hscroll = 0, vscroll = 0;
		if (Math.abs(delta[1]) > Math.abs(delta[0])) {
			if (e.shiftKey)
				hscroll = delta[1];
			else
				vscroll = delta[1];
		} else
			hscroll = delta[0];

		let shouldAnimate = this.sectionProperties.animateWheelScroll
			&& !this.sectionProperties.scrollAnimationDisableTimeout;

		// We don't want to animate in the case of touchpad events. There is no
		// completely browser/OS-agnostic way of determining if a wheel event was
		// generated by a touchpad or a mouse-wheel.
		if (shouldAnimate) {
			// Firefox sends line scroll events for the mouse-wheel and pixel events
			// for the touch-pad. If we receive a non-pixel mousewheel scroll, we know
			// that we can rely on this and disable other heuristics that may cause
			// false-positives.
			if (e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) {
				this.sectionProperties.scrollQuirks = false;
				// Some touchpads with bad drivers generate mousewheel events. In those cases, the
				// line height will be much smaller and we can treat them as a janky touchpad. Not
				// doing so otherwise makes scrolling difficult to control.
				if (Math.abs((e as any).wheelDeltaY) <= 32 && Math.abs((e as any).wheelDeltaX) <= 32)
					shouldAnimate = false;
			} else if (!this.sectionProperties.scrollQuirks)
				shouldAnimate = false;

			if (e.deltaX !== 0 && e.deltaY !== 0) {
				// It's not a mouse-wheel if both components are non-zero. I suppose it's
				// theoretically possible to scroll in both directions at once with a wheel,
				// but very difficult.
				shouldAnimate = false;
			} else if (this.sectionProperties.scrollQuirks) {
				const nowIsAccurate = performance.now() % 1 !== 0;
				const hasFractionalComponent = (e.deltaX % 1 !== 0) || (e.deltaY % 1 !== 0);
				const deltaMaybeDiscrete = Math.abs((e as any).wheelDelta) % 60 === 0;

				if (hasFractionalComponent && (!nowIsAccurate || !deltaMaybeDiscrete)) {
					// Firefox touchpad deltas always seem to have a fractional
					// component on Linux, but this is also true of wheel events for
					// Chrome on Mac.
					// To distinguish Firefox from Chrome, we can use the fact that
					// Firefox performance.now() is rounded to a whole number and that
					// the wheelDelta on Mac will be discrete.
					shouldAnimate = false;
				} else if (nowIsAccurate && !deltaMaybeDiscrete) {
					// In Chrome, performance.now can (and usually does) have a
					// fractional component. We can use this to single it out, then
					// check if the delta is discrete. This would indicate the event
					// was generated by a mouse-wheel.
					shouldAnimate = false;
				}
			}
		}

		hscroll *= app.dpiScale;
		vscroll *= app.dpiScale;

		if (shouldAnimate)
			this.animateScroll([hscroll, vscroll]);
		else {
			this.sectionProperties.animatingScroll = false;

			if (this.sectionProperties.scrollAnimationDisableTimeout)
				clearTimeout(this.sectionProperties.scrollAnimationDisableTimeout);
			this.sectionProperties.scrollAnimationDisableTimeout =
				setTimeout(() => { this.sectionProperties.scrollAnimationDisableTimeout = null; },
					ScrollSection.scrollDirectTimeoutMs);

			this.sectionProperties.scrollWheelDelta[0] += hscroll;
			this.sectionProperties.scrollWheelDelta[1] += vscroll;

			if (!this.isAnimating) this.startAnimating({});
		}
	}
}

}
