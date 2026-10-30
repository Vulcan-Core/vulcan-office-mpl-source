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
	ROUND-11 C2 — ONE GRIP DESCRIPTOR PER GRABBABLE PART OF THE SELECTION.

	The designer's rule for a selection rectangle is corners first, then edges, then
	the centre — "if you're zoomed out you basically always get a corner", and a
	press in the middle pans the sheet and does nothing to the selection. Before
	this there were exactly TWO grips, the top-left and bottom-right corners, and
	no edges at all, so three quarters of the rule had nothing to run on.

	WHAT `posts` SOLVES. Core's selection protocol is two verbs, `start` and
	`end`, which move the top-left and bottom-right of the rectangle: it can say
	"move this corner" and cannot say "drag the top edge". The gap closes by
	noticing that every grip IS a start and/or an end move in which some
	coordinates come from the finger and the rest are RESTATED from the selection
	as it currently stands. Dragging the top edge is `start` at (the live x1, the
	finger's y) — x pinned, y free, which is exactly "a horizontal edge drags up
	and down". The pinned value is re-read from the live rectangle on every move
	rather than frozen at the press, because the press lands somewhere inside a
	grab band and not on the edge line itself.

	The two incumbent corners are the free/free rows of this table, so they
	resolve to the single `_postSelectTextEvent(verb, point.x, point.y)` they
	always sent.
*/
interface CellSelectionGripPost {
	verb: string; // 'start' (the rectangle's top-left) or 'end' (bottom-right)
	x: string; // 'free' takes the finger; 'x1'/'x2' restate the live rectangle
	y: string; // likewise
}

interface CellSelectionGrip {
	corner: boolean;
	drawn: boolean; // whether this grip carries art; only the two incumbents do
	left: boolean; // corner: which side. edge: the band sits on x1 rather than x2
	top: boolean; // corner: which side. edge: the band sits on y1 rather than y2
	horizontal: boolean; // edge only: the edge LINE runs horizontally, so y is free
	posts: CellSelectionGripPost[];
}

class CellSelectionHandle extends CanvasSectionObject {
	showSection: boolean = false;
	processingOrder: number = app.CSections.DefaultForDocumentObjects.processingOrder;
	drawingOrder: number = app.CSections.DefaultForDocumentObjects.drawingOrder;
	zIndex: number = app.CSections.DefaultForDocumentObjects.zIndex;
	documentObject: boolean = true;

	// The four corners, then the four edges. Names are the section names, so
	// this doubles as the roster CellSelectionMarkerMiddleware builds from.
	public static readonly CORNER_NAMES: string[] = [
		'cell_selection_handle_start',
		'cell_selection_handle_end',
		'cell_selection_handle_topright',
		'cell_selection_handle_bottomleft',
	];

	public static readonly EDGE_NAMES: string[] = [
		'cell_selection_edge_top',
		'cell_selection_edge_bottom',
		'cell_selection_edge_left',
		'cell_selection_edge_right',
	];

	private static readonly GRIPS: { [name: string]: CellSelectionGrip } = {
		cell_selection_handle_start: {
			corner: true, drawn: true, left: true, top: true, horizontal: false,
			posts: [{ verb: 'start', x: 'free', y: 'free' }],
		},
		cell_selection_handle_end: {
			corner: true, drawn: true, left: false, top: false, horizontal: false,
			posts: [{ verb: 'end', x: 'free', y: 'free' }],
		},
		// The top-right corner moves the TOP edge and the RIGHT edge at once,
		// which is one coordinate of each verb; the other two are restated.
		cell_selection_handle_topright: {
			corner: true, drawn: false, left: false, top: true, horizontal: false,
			posts: [
				{ verb: 'start', x: 'x1', y: 'free' },
				{ verb: 'end', x: 'free', y: 'y2' },
			],
		},
		cell_selection_handle_bottomleft: {
			corner: true, drawn: false, left: true, top: false, horizontal: false,
			posts: [
				{ verb: 'start', x: 'free', y: 'y1' },
				{ verb: 'end', x: 'x2', y: 'free' },
			],
		},
		cell_selection_edge_top: {
			corner: false, drawn: false, left: true, top: true, horizontal: true,
			posts: [{ verb: 'start', x: 'x1', y: 'free' }],
		},
		cell_selection_edge_bottom: {
			corner: false, drawn: false, left: true, top: false, horizontal: true,
			posts: [{ verb: 'end', x: 'x2', y: 'free' }],
		},
		cell_selection_edge_left: {
			corner: false, drawn: false, left: true, top: true, horizontal: false,
			posts: [{ verb: 'start', x: 'free', y: 'y1' }],
		},
		cell_selection_edge_right: {
			corner: false, drawn: false, left: false, top: true, horizontal: false,
			posts: [{ verb: 'end', x: 'free', y: 'y2' }],
		},
	};

	// Unknown names fall to the end corner, which is what the pre-round-11
	// `name === 'cell_selection_handle_start' ? ... : ...` ternary did for
	// every name that was not the start handle.
	public static grip(name: string): CellSelectionGrip {
		return (
			CellSelectionHandle.GRIPS[name] ||
			CellSelectionHandle.GRIPS.cell_selection_handle_end
		);
	}

	// This instance's grip. The constructor caches it, but every read goes
	// through here and falls back to the NAME, because the section is also
	// built by Object.create in the mocha rigs — which run no constructor at
	// all — and a grip that could be undefined would put a throw on the hit-test
	// path of a live phone.
	private gripHere(): CellSelectionGrip {
		return (
			this.sectionProperties.grip || CellSelectionHandle.grip(this.name)
		);
	}

	/*
		ROUND-12 D6-b — AN UNDRAWN GRIP DOES NOT GET A SINGLE CELL.

		Design review: "The selection box around a cell doesn't always move correctly
		with the cell." MEASURED on the round-11 vehicle, single-cell selection,
		a purely vertical 110 CSS px pan-shaped drag from the centre of each
		region: from the cell's interior the sheet pans (2/2), and from the new
		`topright` box it does not — the selection jumps five rows and widens by
		a column instead (2/2 independent runs); `edge_top` does the same. The
		finger was a few millimetres above and right of the cell, over blank
		grid, and the box followed it.

		WHAT WENT WRONG IS THE TERRITORY, NOT THE PRIORITY. The container binds
		a gesture to whatever section is under the finger at touchstart and
		never re-resolves it (CanvasSectionContainer.onTouchStart writes
		sectionOnMouseDown; onTouchMove only ever looks that name up again), so
		a press inside a grip box is a grip drag before the finger has moved at
		all. Round 11's six new grips carry no art and — like the two
		incumbents, by round-8's outward anchoring — sit ENTIRELY outside the
		selection. MEASURED on one selected default cell: 4,612 CSS px² of new
		invisible drag capture against the cell's own 2,556, essentially all of
		it over the neighbours.

		THE THREE FIXES THAT DO NOT WORK, and why, since each looks plausible:

		  Requiring the press to land inside the selection. Every grip here is
		  anchored fully outside it — the ladder suite asserts exactly that, to
		  protect the interior pan — so this disables all eight, round 8
		  included.

		  Shrinking the outward overhang. It shrinks the trap without removing
		  it, and the edge bands were ALREADY only 20 CSS px deep in the build
		  The designer tested; `edge_top` stole a pan at that depth. A finger cannot
		  aim at an invisible target, so no depth is small enough.

		  Requiring travel before a grip claims. The measured theft was a
		  straight vertical drag on a CORNER, and a corner serves every
		  direction — travel and direction cannot tell it from a pan. The
		  discriminator would have to be something the user can see.

		SO CONDITION THEM ON THE SELECTION INSTEAD, which is where the designer's own
		sentence conditions them: "if you are BANDBOX SELECTING a cell, that
		works based on corners, so corners get priority, then edges, then
		centers." The ladder is stated about a dragged-out rectangle, and this
		is the same shape of rule round 11 already built for the bands — a side
		shorter than two corner grabs has no band at all — moved up one level to
		the rectangle. On a bare cell cursor the vocabulary is the two DRAWN
		handles, which is also the reference's own single-cell vocabulary and
		what shipped before round 11; grab a corner and you have a bandbox, and
		the full ladder is there for it.

		The argument the file already makes for the fill marker is the general
		one: an invisible convenience must never take a gesture away from
		something the user can see. Off the selection's own rectangle the
		gesture it was taking is the sheet pan — the thing every other cell on
		the screen does.

		ROUND 16 NOTE. The geometry this block describes ("sit ENTIRELY outside
		the selection", "the ladder suite asserts exactly that") is the round-8
		/ round-11 geometry it was written against. Round 16 (VO-P-0019) moved
		the phone's grips onto the reference's centred 30 px corner and
		straddling band — see the bands block below — so every grip now
		reaches INTO the rectangle by half its size.

		🔴 ROUND 16 WAVE E RETIRED THE GATE ITSELF — M-0020 §1 (R1) MEASURED
		THE BARE SINGLE CELL. The round-12 decision above was made against a
		question its own text left open ("the reference's own single-cell
		vocabulary" was asserted, never measured), and the measurement
		answers it the other way: reference/M-0020.md §1, a bare cell B3
		under the finger model, is "a perimeter of axis-constrained bands"
		with a 2-D corner halo — corner + (d,d) for d in −12…+12 EXTENDs in
		two axes, the right edge + (d,0) for d in −12…+12 EXTENDs, the corner
		at d = −18/−24 EXTENDs VERTICALLY ONLY (it is inside the top/bottom
		band), and the interior press EXTENDs downward (B3 → B3:B6). A
		single cell IS a bandbox to the reference; the six grips exist for
		it as they do for a range. What the round-12 theft actually measured
		was the 44 px OUTWARD box over the neighbours, and that box is gone
		(cornerOffset): the perimeter now reaches 15 px out, the measured
		halo, and 12 px out on an edge, the measured band.

		The function is kept (the middleware reads it) and is unconditional:
		the six grips it gates are constructed only under the phone chrome
		(CellSelectionMarkers.initiate), so "apply" already means "apply on
		the phone", and there is no second gate to carry the argument. It
		is not deleted because the middleware's call site is the one
		registered phone gate on that file and this is the smaller diff.
	*/
	public static undrawnGripsApply(cellSelectionArea: any): boolean {
		return true;
	}

	// Corners keep the default every document object has; an edge band sits one
	// below it. The container's live search order is (zIndex, drawingOrder,
	// processingOrder) — applyDrawingOrders is the LAST sort reNewAllSections
	// runs, and findSectionContainingPoint walks that list from the end — and
	// every grip here shares one drawingOrder, so processingOrder is the
	// tiebreak that decides between a corner and an edge under the same
	// finger. The lower number is the weaker claim, which is what "corners get
	// priority, then edges" is, expressed where the container can act on it.
	public static processingOrderFor(name: string): number {
		const base = app.CSections.DefaultForDocumentObjects.processingOrder;
		return CellSelectionHandle.grip(name).corner ? base : base - 1;
	}

	/*
		THE BANDS — ROUND 16, VO-P-0019: SIZED TO THE REFERENCE'S REACH, NOT TO
		THE PLATFORM'S BUTTON FLOOR.

		The designer, round 16: "what works with a stylus / precise mouse controls on
		an emulator doesn't work with my giant monkey fingers ... if you tap on
		a cell and then tap-drag from near the corner, you're probably trying
		to expand it ... it's still very difficult to tap-and-drag to select."

		The measured reference (RU-17, rounds 11–13): the corner grab is a
		30 dp box CENTRED on the corner — 15 dp INTO the selection and 15 out,
		in every quadrant — and the edge band STRADDLES the edge (RU-17 read
		it as ~14.7 dp; M-0020, round 16, re-measured it with the finger model
		as ±12 dp, 24 wide — see the band paragraph below). Priority corners
		> edges > centres, and the centre pans.

		Our shipped geometry, read back at L0 and pinned at L2 by the round-16
		recon: a 44 px corner box entirely OUTSIDE the selection, in one
		diagonal quadrant, so its reach into the thing the finger is aiming at
		was ZERO; a 20 px edge band entirely outside. A finger aiming at a
		corner lands on the corner and scatters around it; half of that
		scatter — the inward half — was a pan. That is the defect in one
		sentence, and it is why two recorded decisions are reversed here:

		THE CORNER IS 30 CENTRED, NOT 44 OUTWARD. Round 8 kept 44 as "the
		platform minimum touch target" and pushed it into the outward quadrant
		so the cell body stayed pannable. Both halves of that were about a
		finger that lands ON the corner; a finger lands NEAR it, on both sides,
		and the reference's answer is a smaller box that straddles the corner
		rather than a bigger one that avoids it. 15 in / 15 out on every
		quadrant is the measured number. The tablet's box was always centred
		(box == art there), so the phone now differs from it only in size and
		in the document-edge clamp below.

		THE EDGE BAND IS 24 AND STRADDLES — 12 IN, 12 OUT, MEASURED. Round 11
		refused to straddle because two 20 px bands would meet in the interior
		of a default-height row and leave nothing to pan; wave C shipped
		RU-17's ~14.7 as 7.5 / 7.5. M-0020 (reference/M-0020.md, the finger
		model, density 3) then measured the band directly, and it is wider:
		§2 R2, a range's right edge + (d,0) EXTENDs for d in −12…+12 and PANs
		at −18/+18 — "band ±12 dp straddling the edge"; §1 R1, the same on a
		bare cell; §3 R3(a), the rule below the header on a whole column,
		"~±12 dp band on the rule". The number is ±12 on every edge swept.

		THE COST, STATED, AND IT IS THE REFERENCE'S OWN. Two 24 px bands on a
		20.5 CSS px phone row OVERLAP by 3.5 px: a default-height single cell
		or one-row range has NO pannable strip between its top and bottom
		bands. M-0020 §1 says exactly that of the reference's 21 dp row — "a
		21-dp-tall cell is entirely covered by its two horizontal edge bands
		(±12 dp), which is why a press almost anywhere on it extends
		downward" — and §4 R4(b) the same of a whole row ("thin row: the
		whole body is within the band"). A range two or more rows tall keeps
		its interior pan (§2 R2: "the interior pans"). In the 3.5 px overlap
		the container's tie-break (equal processingOrder, so list order) hands
		the press to the bottom band; both bands are vertical-only, so the
		verb is the same and only which rule moves differs.

		WHAT DID NOT MOVE. The art (a ~4.5 px square ON the corner) is
		unchanged; the document-edge clamp (clampedCornerOffset) is unchanged
		and keeps a straddling band inside the document, for the reason given
		at anchorToSelectionEdge; the axis constraint (a horizontal band posts
		the finger's y and restates x — sharedOnDragAndEnd) is unchanged, and
		M-0020 §1 measures it on the bare cell too: the corner at d = −18 grows
		B3 → B3:B5 "down, column C not included".

		THE END INSET IS ONE CORNER REACH — THE BAND STARTS WHERE THE CORNER'S
		2-D HALO ENDS. Wave C kept it at 2r ("a 15 px strip at each end of the
		band is claimed by neither grip ... the inset moves when that number
		lands"). M-0020 §1 R1 lands it: on the bare cell the corner + (d,d)
		press is 2-D EXTEND for d in −12…+12 (the ~15 dp halo) and at
		d = −18/−24 it is already "inside the cell's top/bottom edge band" —
		vertical-only EXTEND, not the interior. So the band is present 18 dp
		from the corner along the edge, i.e. it begins no later than the halo
		ends, and there is no unclaimed strip between them. At r the two
		claims stay DISJOINT (the corner box ends at corner ± r along the
		edge; the band starts there), which is what keeps the ladder an order
		rather than an overlap. A side shorter than two corner reaches
		(2r = 30 CSS px) still has no band at all and the corners own it
		outright — "if you're zoomed out you basically always get a corner";
		on a default 20.5 px row that is both SHORT sides of a single cell,
		whose left and right strips the TL/BL and TR/BR corner boxes already
		cover end to end (each box reaches 15 px up and 15 down from a corner
		of a 20.5 px side).
	*/
	public static edgeBandSize(): number {
		return 24 * app.dpiScale;
	}

	public static edgeEndInset(hitRadius: number): number {
		return hitRadius;
	}

	/*
		RU-17: "30dp corner grab (15dp reach)". The reference's box is 30 dp
		centred on the corner; this is its half-size, in device px. Phone only —
		off the phone the box is the drawn ring (circleRadius), as it always was.
	*/
	public static phoneHitRadius(): number {
		return 15 * app.dpiScale;
	}

	constructor (name: string) {
        super(name);

		const mobileChrome = document.documentElement.classList.contains(
			'vulcan-mobile-chrome',
		);
		this.sectionProperties.mobileChrome = mobileChrome;
		this.sectionProperties.grip = CellSelectionHandle.grip(name);

		// CORNERS BEAT EDGES, and the container is what enforces it:
		// findSectionContainingPoint walks the section list from the end, and
		// the order that list is in when a finger lands is applyDrawingOrders'
		// — (zIndex, drawingOrder, processingOrder), the last sort
		// reNewAllSections runs. Every grip here shares one drawingOrder, so
		// processingOrder is the tiebreak and the highest one under a finger
		// wins. (An earlier comment here cited orderSections' (zIndex,
		// processingOrder) sort; that is the LAYOUT order, and it is
		// overwritten before any hit test runs — see the round-16 R5 skeptic.)
		// The corners keep the default they shipped with — byte-identical
		// against every other document object — and the edge bands sit one
		// below it, which is also the right answer against everything else at
		// this zIndex: an invisible band is the weakest claim on the canvas.
		this.processingOrder = CellSelectionHandle.processingOrderFor(name);

		// Desktop/tablet ring radius — stock upstream geometry, and (off
		// phone) the hit-box radius below.
		this.sectionProperties.circleRadius = 10 * app.dpiScale;
		this.sectionProperties.artHalfSize =
			CellSelectionHandle.artHalfSize(mobileChrome);

		// Decouple the GRAB box from the DRAWN art (docs/mobile-redesign/02 §5).
		// The section bounds are the hit area, so tying them to circleRadius
		// gave a 20 CSS px target — on a 17 px row you are aiming a ~44 px
		// fingertip at 20 px, half of which overhangs the neighbouring cells,
		// and every miss moves the cell cursor and destroys the selection you
		// were extending. Phones get the reference's 30 px box CENTRED on the
		// corner (phoneHitRadius, cornerOffset — round 16, VO-P-0019); desktop
		// and tablet keep box == art exactly as before.
		this.sectionProperties.hitRadius = mobileChrome
			? CellSelectionHandle.phoneHitRadius()
			: this.sectionProperties.circleRadius;
		this.size = [
			this.sectionProperties.hitRadius * 2,
			this.sectionProperties.hitRadius * 2,
		];

		// The ACTUAL box-to-corner offset in force, refreshed by
		// anchorToSelectionCorner. onDraw and the drag inversion read this
		// stored value — never the raw quadrant constant — so an edge-clamped
		// box cannot drift from its own art or drag math.
		this.sectionProperties.actualCornerOffset = CellSelectionHandle.cornerOffset(
			name,
			this.sectionProperties.hitRadius,
			mobileChrome,
		);

		// Stroke the handle with the cell-cursor/view color instead of binary
		// black/white — same source AutoFillBaseSection reads (the
		// .cell-cursor-data div's border color). Derived once here, not per
		// draw (getComputedStyle is too expensive for onDraw).
		//
		// This used to be gated on vulcan-desktop-chrome, so the phone fell to
		// the stock branch and drew hollow BLACK rings either side of an accent
		// cyan cursor — one selection reading as three unrelated marks in two
		// colour families, and a hollow black ring is genuinely hard to find
		// over dense grey text. The phone needs this more than desktop does.
		this.sectionProperties.cursorStrokeColor = null;
		// Via sectionProperties (any-typed) like AutoFillBaseSection:
		// _cursorDataDiv is real at runtime but absent from
		// DocLayerInterface, and the image build's tsc-strict pass
		// rejects the typed access.
		this.sectionProperties.docLayer = app.map._docLayer;
		if (
			this.sectionProperties.docLayer &&
			this.sectionProperties.docLayer._cursorDataDiv
		) {
			const cursorColor = getComputedStyle(
				this.sectionProperties.docLayer._cursorDataDiv,
			).getPropertyValue('border-top-color');
			if (cursorColor)
				this.sectionProperties.cursorStrokeColor = cursorColor;
		}
	}

	/*
		Drawn-art half-size, DEVICE px. Round-8 C1 (ruling X-1): phone art is
		a ~4.5 CSS px filled accent SQUARE — Google Sheets' measured handle is
		≈4×4 CSS px squares on a 16 px row (EX-8, measured), and squares are
		the resize vocabulary (a circle rotates). The halo is dropped with the
		shrink: at this size the ring was most of the object, and the wash +
		cursor ring now carry the selection signal. Desktop and tablet keep
		the stock 10 px hollow-ring radius, box == art, byte-identical.
	*/
	public static artHalfSize(mobileChrome: boolean): number {
		return (mobileChrome ? 2.25 : 10) * app.dpiScale;
	}

	public static edgeSafeHitStart(start: number, size: number, limit: number): number {
		return Math.min(Math.max(start, 0), Math.max(0, limit - size));
	}

	/*
		Box top-left relative to the true selection corner: CENTRED, on every
		platform and every quadrant — [-r, -r].

		ROUND 16 (VO-P-0019) RETIRED THE PHONE'S OUTWARD QUADRANT. Rounds 8 and
		11 put the phone box entirely outside the selection (a left corner
		pushed left by 2r, a top corner up by 2r) so a 44 px box could not
		blanket a 20 px row's body. The measured reference (RU-17) centres a
		30 dp box on the corner — 15 in, 15 out — and that inward half is the
		half a finger aiming at the corner most often lands on. So the box is
		the reference's, and the pannable interior is protected by SIZE (r =
		phoneHitRadius) rather than by exile.

		`name` and `phone` stay in the signature on purpose: the quadrant
		arithmetic they fed is the retired branch the mocha ladder re-instates
		as a planted mutation to prove its reach rows can fail, and
		clampedCornerOffset below still needs `phone` to decide whether the
		document-edge clamp applies.
	*/
	public static cornerOffset(name: string, hitRadius: number, phone: boolean): number[] {
		return [-hitRadius, -hitRadius];
	}

	// A centred box hangs half off the document at column A / row 1 (and at
	// the far corner), where the half outside is never visible or hittable.
	// Slide the box inward per axis, only as far as the document edge forces;
	// away from the edges the raw centred offset is returned byte-identical.
	// Returns the ACTUAL box-to-corner offset. Phone only: the tablet's box
	// was never clamped and is not clamped now.
	public static clampedCornerOffset(name: string, hitRadius: number, phone: boolean, corner: number[], limit: number[]): number[] {
		const off = CellSelectionHandle.cornerOffset(name, hitRadius, phone);
		if (!phone) return off; // Tablet/desktop centred box, as before.
		return [
			CellSelectionHandle.edgeSafeHitStart(corner[0] + off[0], 2 * hitRadius, limit[0]) - corner[0],
			CellSelectionHandle.edgeSafeHitStart(corner[1] + off[1], 2 * hitRadius, limit[1]) - corner[1],
		];
	}

	// Drawn-art centre in box coordinates, derived from the ACTUAL offset:
	// on phones the art sits CENTRED ON the true selection corner (round-8
	// C1 — Google centres its squares on the corner, measured in EX-8; the
	// pre-fix tangent placement pushed it one artPad outside) and stays
	// there even while the box slides off the corner at a document edge;
	// the tablet's centred, unclamped box keeps centred art. `name` and
	// `artPad` stay in the signature: the tangent arithmetic they fed is the
	// retired branch the mocha suite's calibration re-instates to prove its
	// corner assertion can fail.
	public static artCentre(name: string, hitRadius: number, artPad: number, phone: boolean, actualOffset: number[]): number[] {
		if (!phone) return [hitRadius, hitRadius];
		// `0 -` rather than unary minus: the end handle's raw offset is
		// [0, 0], and negating that is JavaScript's -0.
		return [0 - actualOffset[0], 0 - actualOffset[1]];
	}

	/*
		ROUND-12 D6-a — THE ART FOLLOWS THE CORNER'S LIVE VIEW POSITION, NOT
		THE OFFSET THE BOX WAS ANCHORED WITH.

		artCentre above derives the art from the box's INTENT: "the box sits
		2r up-and-left of the corner, therefore the corner is 2r down-and-right
		of the box." That is true in DOCUMENT space and stops being true on
		SCREEN the moment the view clamps the box.

		A document object's canvas origin is documentPosition.vX/vY, which
		routes through ViewLayoutCalc.splitAwareOffset: a coordinate scrolled
		above the viewport start is pinned to the split line (0 with no frozen
		panes) rather than going negative. The start box's document position is
		the corner MINUS 2r, so it reaches that line 2r BEFORE the corner does,
		and inside that window myTopLeft is pinned at the grid edge while
		artCentre still adds a full +2r.

		MEASURED on the round-11 vehicle (dpiScale 2, 48-core-px rows, no
		frozen panes) as the selected cell was walked into the window: the
		drawn top-left square detached from its cell and parked up to 44 CSS px
		— nearly two default rows — below and right of it, the error rising
		monotonically as 2r − (cellTop − viewedTop). The bottom-right square,
		whose actual offset is [0, 0] and which therefore never crosses early,
		was [0, 0] wrong at every step of the same sweep: the error IS the
		offset, which is what pins the cause to this arithmetic and not to the
		selection message.

		So ask the LAYOUT where the corner is instead of assuming. The same map
		clamps the corner the same way, and the art is the difference.

		NO OUT-OF-BOX GUARD, and that is a claim rather than an oversight. The
		box is anchored at corner + off with off ∈ [−size, 0] per axis, and
		splitAwareOffset is non-decreasing in its coordinate, so cornerView ≥
		boxView; and the widest the two can separate is the offset itself, so
		the difference is bounded by size. The centre therefore lies inside the
		box for every scroll position and every split, and a clamp here would
		be a line that never runs. (Round 11 got the same result by luck, since
		its intended offset was constant.)

		RTL IS LEFT ALONE. ViewLayoutCalc.documentToViewX mirrors x about the
		document anchor for an RTL sheet, which inverts the sign of this
		difference; the drawn handles' RTL placement is stock and unexamined,
		so the caller keeps the shipped expression there rather than trading
		one wrong number for another.
	*/
	public static artCentreOnCorner(boxView: number[], cornerView: number[] | null, fallback: number[]): number[] {
		if (!cornerView) return fallback;
		return [cornerView[0] - boxView[0], cornerView[1] - boxView[1]];
	}

	// The document's extent in core px, for the edge clamps. A zero fileSize
	// (before the first size message) must not pin a box to the origin.
	private static documentLimit(): number[] {
		const fileSize = app.activeDocument ? app.activeDocument.fileSize : null;
		return fileSize && fileSize.pX > 0 && fileSize.pY > 0
			? [fileSize.pX, fileSize.pY]
			: [Infinity, Infinity];
	}

	// The one position authority (CellSelectionMarkerMiddleware calls this):
	// compute the clamped offset once, remember it for onDraw and the drag
	// inversion, then place the box at corner + offset.
	public anchorToSelectionCorner(cornerX: number, cornerY: number): void {
		const limit = CellSelectionHandle.documentLimit();
		const off = CellSelectionHandle.clampedCornerOffset(
			this.name,
			this.sectionProperties.hitRadius,
			this.sectionProperties.mobileChrome,
			[cornerX, cornerY],
			limit,
		);
		this.sectionProperties.actualCornerOffset = off;
		// The corner itself, kept so onDraw can ask the layout where it is NOW
		// rather than reconstruct it from the offset. A SimplePoint because
		// that is what documentToViewX/Y take, and the box's own myTopLeft is
		// derived through the identical call — so both carry the same rounding.
		this.sectionProperties.selectionCorner = cool.SimplePoint.fromCorePixels(
			[cornerX, cornerY],
		);
		this.setPosition(cornerX + off[0], cornerY + off[1]);
	}

	// The corner this grip is steering, in VIEW core px, or null when nothing
	// can answer: no remembered corner (the mocha rigs build this class with
	// Object.create and run no constructor), no layout yet, or an RTL sheet,
	// whose mirrored x is not this difference. See artCentreOnCorner.
	private cornerViewPosition(): number[] | null {
		const corner = this.sectionProperties.selectionCorner;
		if (!corner) return null;
		const layout = app.activeDocument ? app.activeDocument.activeLayout : null;
		if (!layout) return null;
		const docLayer = app.map ? app.map._docLayer : null;
		if (docLayer && docLayer.isCalcRTL && docLayer.isCalcRTL()) return null;
		return [
			layout.documentToViewX(corner),
			layout.documentToViewY(corner),
		];
	}

	/*
		Place an EDGE band. The band runs along one side of the rectangle,
		STRADDLING it — 12 in, 12 out (M-0020 §2 R2 / §1 R1: the reference's
		band is ±12 dp on the edge, not beside it; round 16) — and stops
		`edgeEndInset` (one corner reach) short of each end so the corners
		keep the ends of the side to themselves. A side too short to leave
		anything over hides the section outright rather than claiming a
		zero-width strip, which is the "zoomed out you always get a corner"
		case.

		THE STRADDLE IS CLAMPED AT THE DOCUMENT EDGE, and this is not tidiness.
		The outward half of a band on row 1 / column A lies at NEGATIVE
		document coordinates, and ViewLayoutCalc.splitAwareOffset passes a
		coordinate below the split line through unchanged — so that half would
		be painted and HIT over the header band's inner 12 px, and a grip at
		zIndex 9 outranks a header at 5. Round 11's fully-outward band never
		met this: a rectangle that only touches the document does not
		intersect it (LOUtil._doRectanglesIntersect) and the section was simply
		invisible on row 1. The clamp is the corner's own (edgeSafeHitStart —
		slide inward only as far as the edge forces), so a row-1 top band
		becomes [0, 24] inside the document rather than [-12, 12] across the
		header. Same idiom, same helper, same limit.

		All four arguments are the rectangle in canvas CORE px, the same frame
		anchorToSelectionCorner takes.
	*/
	public anchorToSelectionEdge(x1: number, y1: number, x2: number, y2: number): void {
		const grip = this.gripHere();
		const band = CellSelectionHandle.edgeBandSize();
		const inset = CellSelectionHandle.edgeEndInset(
			this.sectionProperties.hitRadius,
		);
		const limit = CellSelectionHandle.documentLimit();

		// The band's own anchor line, and its offset from it: half the band
		// back across the line, then clamped into the document.
		let anchor: number[];
		let off: number[];
		let size: number[];
		if (grip.horizontal) {
			const length = x2 - x1 - 2 * inset;
			anchor = [x1 + inset, grip.top ? y1 : y2];
			off = [
				0,
				CellSelectionHandle.edgeSafeHitStart(anchor[1] - band / 2, band, limit[1]) - anchor[1],
			];
			size = [length, band];
		} else {
			const length = y2 - y1 - 2 * inset;
			anchor = [grip.left ? x1 : x2, y1 + inset];
			off = [
				CellSelectionHandle.edgeSafeHitStart(anchor[0] - band / 2, band, limit[0]) - anchor[0],
				0,
			];
			size = [band, length];
		}

		if (size[0] <= 0 || size[1] <= 0) {
			this.setShowSection(false);
			return;
		}

		this.setShowSection(true);
		this.size = size;
		this.sectionProperties.actualCornerOffset = off;
		this.setPosition(anchor[0] + off[0], anchor[1] + off[1]);
	}

	// position = anchor + actualCornerOffset, so this recovers the corner (or
	// the edge line) the finger is steering no matter where an edge clamp slid
	// the box. Half the section's own size on each axis, so wherever inside the
	// grab region the finger pressed, the thing being steered tracks as if the
	// press had been at the region's centre. For a corner that half IS
	// hitRadius, which is the arithmetic this always did.
	private anchorToCorner(point: cool.SimplePoint): void {
		const off = this.sectionProperties.actualCornerOffset;
		point.pX += this.position[0] - off[0] - this.size[0] * 0.5;
		point.pY += this.position[1] - off[1] - this.size[1] * 0.5;
	}

	/*
		THE AUTOFILL MARKER OUTRANKS AN EDGE BAND, and only the section list's
		own ordering would have said otherwise. The marker is a DRAWN 16 px
		affordance sitting on the selection's bottom edge (AutoFillBaseSection),
		and it lives at zIndex 6 while every grip here lives at 9 — so the bottom
		band would have swallowed the one visible target in the region. An
		invisible convenience must never take a gesture away from something the
		user can see, so the ladder is corners, then the fill marker, then edges,
		then the interior's pan. Corners stay above it: they are drawn too, and
		they are the grip the designer puts first.
	*/
	private static autofillClaims(point: number[]): boolean {
		if (!app.sectionContainer) return false;
		const props = app.CSections ? app.CSections.CellFillMarker : null;
		if (!props) return false;
		const marker = app.sectionContainer.getSectionWithName(props.name);
		if (!marker || !marker.showSection || !marker.isVisible) return false;
		return marker.isHit(point);
	}

	/*
		THE RESIZE DISC OUTRANKS EVERY GRIP — round 16, VO-P-0005's second ask.

		The header's resize disc is centred on the header's INNER edge (M-0012
		§2), so half of its paint lies over the grid — and on a whole-row or
		whole-column selection that half lies exactly on this section's
		bottom-left / top-right corner box, because the selection's corner IS
		the disc's centre. The header claims that half through its own hit
		test (Header.vulcanDiscSliverContains), but a grip at zIndex 9 is
		searched before any header at 5, so without this yield the corner grip
		took the finger and reshaped the selection where the user was aiming at
		the one drawn control in the region. Same argument as the fill marker
		above, one rung higher: the disc is drawn, the grips' inward halves are
		not, and the ladder is disc > corner > edge band > pan.

		Asked of BOTH headers rather than the one whose axis matches: the point
		is a canvas point and a header either claims it or does not.
	*/
	private static resizeDiscClaims(point: number[]): boolean {
		if (!app.sectionContainer || !app.CSections) return false;
		for (const props of [app.CSections.RowHeader, app.CSections.ColumnHeader]) {
			if (!props) continue;
			// `any`: the container hands back the base section type, and the
			// predicate is Header's own — duck-typed here rather than imported,
			// the way autofillClaims reads the marker.
			const header: any = app.sectionContainer.getSectionWithName(props.name);
			if (!header || !header.showSection || !header.vulcanDiscSliverContains)
				continue;
			if (header.vulcanDiscSliverContains(point)) return true;
		}
		return false;
	}

	/*
		A DRAWN CORNER OUTRANKS AN UNDRAWN ONE WHERE THEIR BOXES OVERLAP —
		round 16 wave E, the single cell. On a rectangle shorter than a box
		(a 20.5 CSS px row against a 30 px box: every default-height single
		cell and one-row range) the top-right box overlaps the bottom-right
		one by 9.5 px (30 minus the row), and the bottom-left the top-left. The container's search
		is (zIndex, drawingOrder, processingOrder) with list order breaking
		the tie, and the two undrawn corners are added after the two drawn
		ones (CellSelectionMarkers.initiate), so the undrawn box took the
		overlap — a press 12 px up-left of the drawn bottom-right square, the
		exact point M-0020 §1 measures as the reference's 2-D corner EXTEND
		toward the finger, went to `topright`, whose verb pair (start at
		(x1, finger y), end at (finger x, y2)) is the wrong shape for a drag
		that goes DOWN and right. Same rule as the fill marker and the disc,
		applied inside the family: the square the user can see keeps its
		box. processingOrder is not touched (it is layout order too).
	*/
	private static drawnCornerClaims(point: number[]): boolean {
		if (!app.sectionContainer) return false;
		for (const name of CellSelectionHandle.CORNER_NAMES) {
			if (!CellSelectionHandle.grip(name).drawn) continue;
			const drawn = app.sectionContainer.getSectionWithName(name);
			if (!drawn || !drawn.showSection || !drawn.isVisible) continue;
			if (drawn.isHit(point)) return true;
		}
		return false;
	}

	isHit(point: number[]): boolean {
		if (this.sectionProperties.mobileChrome && CellSelectionHandle.resizeDiscClaims(point))
			return false;

		if (!this.gripHere().corner && CellSelectionHandle.autofillClaims(point))
			return false;

		if (this.sectionProperties.mobileChrome && this.gripHere().corner
			&& !this.gripHere().drawn && CellSelectionHandle.drawnCornerClaims(point))
			return false;

		if (!this.sectionProperties.mobileChrome || !this.containerObject)
			return super.isHit(point);

		// Keep a CORNER's finger box reachable when its anchored art hangs
		// over a canvas edge. Only hit testing moves; paint and drag
		// coordinates stay anchored to the true selection corner.
		//
		// 🔴 CORNERS ONLY. An edge band has no art to reach and is routinely
		// LONGER than the canvas (a whole-column selection's side runs the
		// document's height), and edgeSafeHitStart answers a box longer than
		// its limit with 0 — so the slide put the band's hit region at the
		// canvas ORIGIN: a whole-column selection's right band claimed x in
		// [rule - 7.5, rule + 7.5] (wave C's band; 12 / 12 since wave E) from
		// the top of the canvas down, i.e. the column header band beside the
		// disc (round 16, caught by
		// CalcPhoneResizeAffordance H4's boundary and pinned by GripLadder
		// R5e). 🔴 On base the same slide was LIVE, not hidden: the band
		// claimed the header band past the rule ([rule, rule + 20] on a
		// whole-column selection; the gutter strip below the rule on a
		// whole-row one), so the disc's header half past the rule belonged
		// to the edge band — a drag there reshaped the selection, and the
		// disc owned roughly a quarter of its own paint. That was a live
		// mechanism of VO-P-0005's second ask, proven at L2 in round 16's
		// verification, not a quirk hidden under the corner box. A band's
		// hit region is its own geometry; a point off the canvas cannot be
		// pressed anyway.
		const rtlOffset = app.map._docLayer.isCalcRTL() ? -this.size[0] : 0;
		const corner = this.gripHere().corner;
		const left = corner
			? CellSelectionHandle.edgeSafeHitStart(
				this.myTopLeft[0] + rtlOffset,
				this.size[0],
				this.containerObject.getWidth(),
			)
			: this.myTopLeft[0] + rtlOffset;
		const top = corner
			? CellSelectionHandle.edgeSafeHitStart(
				this.myTopLeft[1],
				this.size[1],
				this.containerObject.getHeight(),
			)
			: this.myTopLeft[1];
		return point[0] >= left && point[0] <= left + this.size[0]
			&& point[1] >= top && point[1] <= top + this.size[1];
	}

	private onDragEnd(point: cool.SimplePoint) {
		app.map.focus();
		app.map.fire('scrollvelocity', {vx: 0, vy: 0});

		this.anchorToCorner(point);

		this.sharedOnDragAndEnd(point);
		CellSelectionMarkers.update();
		app.map.scrollingIsHandled = false;
	}

	// The rectangle a restated coordinate is read from: the multi-cell area when
	// there is one, the cursor cell otherwise — the same expression
	// CellSelectionMarkerMiddleware positions every grip from.
	private static selectionRectangle(): any {
		const layer = app.map._docLayer;
		return (
			(layer ? layer._cellSelectionArea : null) ||
			app.calc.cellCursorRectangle ||
			null
		);
	}

	/*
		THE EDGE CONSTRAINT LIVES HERE, as the difference between a coordinate
		the finger supplies and one restated from the rectangle. A horizontal
		edge posts the live x and the finger's y, so it can only move up and
		down; a vertical edge is the mirror; a corner posts both from the finger
		and goes anywhere. Nothing clamps the finger — the constraint is that the
		pinned coordinate is never asked for.

		The restatement is re-read every move rather than captured at the press
		precisely because the press lands somewhere inside a grab band: freezing
		the value there would post the band's coordinate as if it were the
		selection's, and drag the edge sideways by the grab offset.
	*/
	/*
		🔴 B-0067 / B-0066 — A RESTATED SIDE NAMES THE SELECTION'S OWN EDGE
		CELL, NOT A RULE.

		x2 / y2 is the selection's right / bottom rule, and a rule belongs to
		the cell that STARTS there. Core truncates the posted twips to a pixel
		and reads the cell under it (GetPosFromPixel), so wherever rounding
		lands x2 on core's rule, the pinned side names the NEXT column. Every
		move re-reads x2 from the selection core has just widened, so a drag
		on the bottom band walked the column bound one column per round trip,
		until a rule that rounding happened to land short of. Traced on
		redroid (runs/run2/b0067/t2): bare B3 is x 1550-3100; the band posted
		x 3100 and core answered B3:C; it posted 4650 and core answered B3:D;
		5981 held. A drag that lifted inside column B made B3:D6 (B3:F6 at
		another scroll position), and B3:C6 made B3:D9.
		The start side is the mirror, and walks the other way. x1 / y1 is the
		first cell's own rule, but the same trace shows core can read a rule as
		the cell BEFORE it (5981, E's left rule, came back as D). So a top band
		pinned to x1 = 5981 would anchor its start in D, and each move would
		walk the left bound one column further left.

		So restate the centre of the side's own cell (the last cell for x2 /
		y2, the first for x1 / y1), as far from both of its rules as it can
		be. With no sheet geometry to ask, the shipped value stands.
	*/
	public static restatedSide(
		area: cool.SimpleRectangle,
		side: string,
		geometry: any,
		wholeAtPress?: { row: boolean; column: boolean } | null,
	): number {
		const value: number = (area as any)[side];
		if (!geometry) return value;
		const dimension =
			side === 'x1' || side === 'x2'
				? geometry.getColumnsGeometry()
				: geometry.getRowsGeometry();
		if (!dimension) return value;
		// A WHOLE row's x sides (a whole column's y sides) are the sheet's own
		// edges: post them raw, exactly as dev does. Core reads 0 as the first
		// column (row) even when it is hidden, and a point at or past the last
		// visible rule as the last one (it walks a hidden unused tail). So
		// a whole row keeps a hidden column A on its top band and stays whole
		// on its bottom band, while a BOX that merely starts in the first
		// VISIBLE column (B with A hidden, also at x 0) restates below and is
		// not widened onto hidden A. "Whole" is core's own report, latched at
		// the gesture's first move (wholeNow, sharedOnDragAndEnd).
		const isX = side === 'x1' || side === 'x2';
		const state = wholeAtPress || CellSelectionHandle.wholeNow();
		if (state && (isX ? state.row : state.column)) {
			// The far side a little PAST the last visible rule: at the rule
			// itself core's rounding held the last VISIBLE column (posted x
			// 27655, Z's right rule with AA:XFD hidden, answered Z: the rows
			// stopped being whole; runs/run2/hiddenA m1). Past it there are
			// only zero-width hidden columns (or nothing), which core walks
			// to the sheet's last column.
			if (side === 'x2' || side === 'y2')
				return value + CellSelectionHandle.wholeEndOvershootTwips;
			return value;
		}
		// Last fallback at the origin, when core's report is not available:
		// the far side reaching the sheet's last tiled column (row).
		if ((side === 'x1' || side === 'y1') && value <= 0) {
			const far: number = (area as any)[side === 'x1' ? 'x2' : 'y2'];
			if (dimension.getIndexFromPos(far - 1, 'tiletwips') >= dimension.getMaxIndex())
				return value;
		}
		// One twip inside the selection: the last cell ENDS on x2 / y2, the
		// first STARTS on x1 / y1.
		const inside = side === 'x2' || side === 'y2' ? value - 1 : value + 1;
		const own = dimension.getIndexFromPos(inside, 'tiletwips');
		const cell = dimension.getElementDataAny(own, 'tiletwips');
		if (!cell || !(cell.size > 0)) return value;
		return Math.round(cell.startpos + cell.size / 2);
	}

	/*
		Core's own report that the selection is a whole row (column): its
		whole-row (whole-column) state, which RowColSelCount sets, OR its
		range name in the address box ('A7:XFD7', parsed by the doc layer).
		The name survives what the state does not: a header-to-header select
		leaves the state false, because core does not restate an unchanged
		RowColSelCount (self-review round 5; vo-p-notes). Null without a map.
	*/
	// How far past a whole row's (column's) end its restated far side is
	// posted: any distance clears the rule, because only zero-width hidden
	// cells (or nothing) lie beyond it. 1000 twips is a few core px at any zoom.
	public static wholeEndOvershootTwips: number = 1000;

	public static wholeNow(): { row: boolean; column: boolean } | null {
		const map: any = typeof app !== 'undefined' && app ? app.map : null;
		if (!map) return null;
		const layer: any = map._docLayer;
		const byName = (fn: string): boolean => {
			try {
				return !!(layer && typeof layer[fn] === 'function' && layer[fn]());
			} catch (e) {
				return false; // no address box (a rig, before load)
			}
		};
		return {
			row: !!map.wholeRowSelected || byName('_isWholeRowSelected'),
			column: !!map.wholeColumnSelected || byName('_isWholeColumnSelected'),
		};
	}

	// Core's whole-row / whole-column state, latched at the gesture's first
	// move and cleared at press and release. On the device the live flags
	// read false between a restated selection's EMPTY message and the
	// RowColSelCount that follows it, so a whole row dragged by its top band
	// lost hidden column A on its second move (runs/run2/hiddenA f1).
	private vulcanWholeAtPress: { row: boolean; column: boolean } | null = null;

	private sharedOnDragAndEnd(point: cool.SimplePoint) {
		const grip = this.gripHere();
		const area = CellSelectionHandle.selectionRectangle();
		const geometry = app.map._docLayer.sheetGeometry;
		if (!this.vulcanWholeAtPress)
			this.vulcanWholeAtPress = CellSelectionHandle.wholeNow() || {
				row: false,
				column: false,
			};

		for (let i = 0; i < grip.posts.length; i++) {
			const post = grip.posts[i];
			const x =
				post.x === 'free' || !area
					? point.x
					: CellSelectionHandle.restatedSide(area, post.x, geometry, this.vulcanWholeAtPress);
			const y =
				post.y === 'free' || !area
					? point.y
					: CellSelectionHandle.restatedSide(area, post.y, geometry, this.vulcanWholeAtPress);
			app.map._docLayer._postSelectTextEvent(post.verb, x, y);
		}
	}

	/*
		The document point the drag would post for a finger sitting at
		`cssX, cssY` of the VIEWPORT right now. Autoscroll owns the clock while
		the sheet moves under a still finger, so it hands this back the viewport
		position it stored and gets the extent that position names THIS frame.
		Inverse of the section-local -> document walk anchorToCorner does:
		canvasToDocumentPoint undoes the scroll offset in force this frame, then
		the same corner compensation recovers the corner the finger is steering.
	*/
	public repostFromViewport(cssX: number, cssY: number): void {
		const layout = app.activeDocument ? app.activeDocument.activeLayout : null;
		if (!layout) return;

		const point = layout.canvasToDocumentPoint(cool.SimplePoint.fromCorePixels(
			[cssX * app.dpiScale, cssY * app.dpiScale]));
		const off = this.sectionProperties.actualCornerOffset;
		point.pX -= off[0] + this.sectionProperties.hitRadius;
		point.pY -= off[1] + this.sectionProperties.hitRadius;

		this.sharedOnDragAndEnd(point);
	}

	private onDrag(point: cool.SimplePoint) {
		// Autoscroll asks where the FINGER is relative to the viewport edge, and
		// this section is a documentObject: anchorToCorner below adds `position`
		// and leaves the point in DOCUMENT space, where an edge test against the
		// viewport means nothing. Take the viewport-frame value first —
		// myTopLeft is this section's canvas origin, so myTopLeft + a
		// section-local point is viewport CORE px (the idiom
		// TextSelectionHandleSection.onDrag already ships). Ungated: the stock
		// tablet branch reads the same payload and wants the same frame.
		const fingerX = this.myTopLeft[0] + point.pX;
		const fingerY = this.myTopLeft[1] + point.pY;

		this.anchorToCorner(point);

		app.map.fire('handleautoscroll', {
			pos: {
				x: Math.round(fingerX / app.dpiScale),
				y: Math.round(fingerY / app.dpiScale),
			},
			map: app.map,
			// Lets the autoscroll re-post the extent on ITS clock. A finger held
			// still emits no touchmove — the sheet moves under it while its
			// client coordinates do not — so without this the extent is a
			// function of accumulated scroll and no retreat can subtract it.
			repost: (cssX: number, cssY: number): void =>
				this.repostFromViewport(cssX, cssY),
		});

		this.sharedOnDragAndEnd(point);
	}

	public onDraw() {
		// THE SIX NEW GRIPS ARE GRAB-ONLY. The reference draws two dots and
		// grabs four corners, and C7's whole direction for this round is lighter
		// rather than busier: two more squares and four bands would put six new
		// marks around a selection to buy reach the finger already has. Reach is
		// the ask; ink is not.
		if (!this.gripHere().drawn) return;

		// The corner's LIVE view position is the authority (round-12 D6-a); the
		// stored actual offset — which keeps the art on the corner whether the
		// box sits in its outward quadrant or was slid inward at a DOCUMENT
		// edge — is what answers when no layout can be asked.
		const centre = CellSelectionHandle.artCentreOnCorner(
			this.myTopLeft,
			this.cornerViewPosition(),
			CellSelectionHandle.artCentre(
				this.name,
				this.sectionProperties.hitRadius,
				this.sectionProperties.circleRadius,
				this.sectionProperties.mobileChrome,
				this.sectionProperties.actualCornerOffset,
			),
		);
		const accent = this.sectionProperties.cursorStrokeColor
			? this.sectionProperties.cursorStrokeColor
			: (<any>window).prefs.getBoolean('darkTheme') ? 'white' : 'black';

		if (this.sectionProperties.mobileChrome) {
			// Phone: a tiny filled accent SQUARE, no halo — see artHalfSize.
			// Painting a few px past the box edge is fine: sections translate
			// but do not clip, and the box parks in the corner's outward
			// quadrant while the art owns the corner itself.
			const half = this.sectionProperties.artHalfSize;
			this.context.fillStyle = accent;
			this.context.fillRect(
				centre[0] - half,
				centre[1] - half,
				2 * half,
				2 * half,
			);
		} else {
			// Desktop/tablet: unchanged hollow ring.
			this.context.beginPath();
			this.context.arc(
				centre[0],
				centre[1],
				this.sectionProperties.circleRadius,
				0,
				2 * Math.PI,
			);
			this.context.strokeStyle = accent;
			this.context.lineWidth = 2;
			this.context.stroke();
		}
	}

	onMouseMove(point: cool.SimplePoint, dragDistance: number[], e: MouseEvent): void {
		e.stopPropagation();
		if (this.containerObject.isDraggingSomething()) {
			app.map.scrollingIsHandled = true;
			this.stopPropagating();
			this.onDrag(point);
		}
	}

	/*
		🔴 ROUND 16 WAVE E REPAIR — A GRIP FORWARDS THE CELL'S OWN TAP GRAMMAR,
		ON THE TOUCH PATH, NOT ONLY THE CLICK.

		The wave-E skeptic measured this with the real container search and
		the real propagateOnMouseDown / propagateOnContextMenu / propagateOn-
		MouseUp over constructor-built grips: on a SELECTED bare 103 x 21 cell
		the fraction of the cell whose touch-down reached mouse-control was
		77.6% on wave C's tree and 0.0% once the bandbox gate was retired (a
		one-row range 36.5% -> 0.0%; a two-row range 60.4% -> 28.8%). The
		grips tile the whole selected cell now, and onMouseDown's
		stopPropagating() kept every press from MouseControl.

		WHY THAT IS A DEFECT AND NOT A REORDERING. Phone Calc's tap grammar
		that is NOT the click runs only from MouseControl's OWN touch path
		(MouseControl.ts): the tap-again cell menu (armVulcanCellMenu <-
		onVulcanDocumentTapEnd <- onMouseUp, gated on localPositionOnMouseDown,
		which only MouseControl.onMouseDown sets), the gesture-start selection
		sample and the second-touchdown keyboard door (vulcanSample-
		SelectionAtGestureStart, onVulcanTouchDown, in onMouseDown), and the
		long-press cell popover (MouseControl.onContextMenu, reached through
		the container's own long-press route, which walks the section under
		the press with lowestPropagatedBoundSection still latched at the
		grip). The D-A forward below carries the CLICK only. So a tap or a
		long press on the selected cell — RU-17's slow second tap that raises
		the hover toolbar, M-0020 §5 R5's "a tap inside an existing range
		KEEPS the range and raises the hover toolbar" — could not run from the
		cell the user was looking at. The reference's bands do not eat the
		tap; ours must not.

		THE SHAPE IS THE D-A IDIOM, EXTENDED. Every phone press on a grip is
		forwarded to MouseControl.onMouseDown at the finger's point restated
		in MouseControl's frame (myTopLeft difference, the inverse of the
		container's convertPositionToSectionLocale), with the real event so
		its touchstart branch runs. An UNARMED release (the container's drag
		latch never tripped: a tap, or a sub-latch wobble) is forwarded to
		MouseControl.onMouseUp the same way, so the tap-end grammar sees the
		true travel (its own press point minus this release point, both in
		its frame). A long press — the container's timer, or a native
		contextmenu — is forwarded to MouseControl.onContextMenu. An ARMED
		release is the grip's own (onDragEnd) and is NOT forwarded: forwarding
		a touchend there would run the swipe/fling and tap tests on a drag
		that reshaped the selection. MouseControl is left holding that
		gesture's start (localPositionOnMouseDown, the pan anchor, its clock);
		the next press on the sheet or on a grip overwrites all of it, and a
		release that reaches MouseControl.onMouseUp without a press of its own
		(a header press whose sub-latch release wobbles onto the grid) meets a
		travel that is not a tap and a dwell past the long-press cap, so the
		grammar declines it — the same standing MouseControl has always been
		left in by a press on the grid whose release wobbled onto a grip.

		The forwards are DIRECT calls, not a propagation change, and that is
		the whole mechanism: the container's real bound-section lists
		(updateBoundSectionLists) bind each grip to itself alone — nothing a
		grip hears ever propagates to MouseControl, in any frame — so a press
		on a grip reached MouseControl from nowhere before this. The
		stopPropagating() after each forward is therefore inert with respect
		to MouseControl and kept only as the grip's own contract. (Round-16
		wave-E verification: the rig's hand-built boundsList had suggested
		releases leaking to MouseControl in the grip's frame; the container
		produces no such list.)

		Phone only, on the same predicate as the click forward: off the phone
		the box is the art and a mouse expects a handle to eat its own press.
		Desktop and tablet are byte-identical.
	*/
	onMouseDown(point: cool.SimplePoint, e: MouseEvent): void {
		e.stopPropagation();
		this.stopPropagating();
		this.vulcanWholeAtPress = null;
		const target = this.mouseControlTarget(point);
		if (!target) return;
		CellSelectionHandle.vulcanPressedGrip = {
			grip: this,
			point: this.canvasPoint(point),
		};
		target.mouse.onMouseDown(target.point, e);
	}

	onContextMenu(point: cool.SimplePoint, e: MouseEvent): void {
		const target = this.mouseControlTarget(point);
		if (!target) return;
		this.stopPropagating();
		target.mouse.onContextMenu(target.point, e);
	}

	// MouseControl, and `point` (this section's local frame) restated in
	// MouseControl's, or null off the phone / with nothing to forward to.
	// The one frame crossing every forward here uses, so the four cannot
	// disagree about where the finger is.
	private mouseControlTarget(point: cool.SimplePoint): { mouse: any; point: cool.SimplePoint } | null {
		if (!this.sectionProperties.mobileChrome || !this.containerObject)
			return null;
		if (!app.CSections || !app.CSections.MouseControl) return null;
		// `any`: the container hands back the base section type, whose
		// handlers are the no-ops MouseControl overrides.
		const mouse: any = this.containerObject.getSectionWithName(
			app.CSections.MouseControl.name,
		);
		if (!mouse || !mouse.myTopLeft) return null;
		return {
			mouse: mouse,
			point: cool.SimplePoint.fromCorePixels([
				this.myTopLeft[0] + point.pX - mouse.myTopLeft[0],
				this.myTopLeft[1] + point.pY - mouse.myTopLeft[1],
			]),
		};
	}

	// A section-local point as a whole canvas px, the frame the container
	// measures a gesture's travel in (getReleaseDragDistance).
	private canvasPoint(point: cool.SimplePoint): number[] {
		return [
			Math.round(this.myTopLeft[0] + point.pX),
			Math.round(this.myTopLeft[1] + point.pY),
		];
	}

	/*
		THE PRESS THIS GESTURE BEGAN WITH, when it began on a grip. Read by
		the unarmed release to decide whether the container's own click is
		coming (see forwardDroppedClick). Cleared on every grip release; a
		press whose release lands off every grip leaves it standing, and the
		point is what keeps a standing record from matching a later gesture:
		a later press at a different point never matches, and a later press
		at the SAME point resolves to the same grip (the container's search is
		a function of the point) and refreshes the record first. The one way
		a standing record can match a press that was not this grip's is the
		geometry moving between the two gestures (a scroll or a new selection
		puts the sheet under that exact px) — and the cost there is the
		container's own: a click not synthesised, never one doubled.
	*/
	private static vulcanPressedGrip: { grip: CellSelectionHandle; point: number[] } | null = null;

	/*
		THE CLICK THE CONTAINER IS ABOUT TO DROP. CanvasSectionContainer.onClick
		hands the browser's click on only when the press and the release
		resolved to the SAME section (its `s1 == s2`), and the phone's drag
		latch is 8 CSS px, so a tap whose ±2 dp wobble crosses one of the
		grips' invisible internal boundaries — TL box to top band at x1 + 15,
		top band to bottom band at the 3.5 px overlap of a one-row rectangle,
		the interior to a band — is a tap the browser clicks and the container
		swallows. The wave-E skeptic counted the points of a selected 103 x 21
		cell whose 2 px neighbourhood spans two claimants: 11.2% on wave C's
		tree, 24.5% once the grips tiled the cell. The click is the tap-again
		keyboard raise and half of the double-tap edit, so that is a verb
		lost, not a detail.

		Synthesise the click at the LIFTED point — the browser's own rule —
		exactly when the container will not: the press of this gesture was
		not on this grip (a different grip, or the sheet). Exclusive with the
		browser's click by the container's own rule, so no gesture can be
		clicked twice: when the press WAS on this grip the container delivers
		the browser's click (to whichever section the click's coordinates
		resolve to — this grip's onClick forward, or MouseControl directly),
		and this does nothing. A release the container cannot measure (a
		synthetic release from a window blur, whose positions are already
		cleared) is left alone; no click follows those either.

		The one case this cannot reach is a press on a grip whose release
		wobbles onto the sheet: the container hands that release to
		MouseControl, not to any grip, and drops the click — as it did on
		every tree before this. The same event and forward the header's own
		sliver uses for its unarmed release (Control.Header._vulcanForward-
		SliverTap), so MouseControl.onClick sees one shape of synthetic tap.

		🔴 ONLY FOR A PRESS THE CELL'S GRAMMAR HEARD. The container keeps the
		press's section (sectionOnMouseDown) through an unarmed release's
		propagation, and the click is synthesised only when that section was
		MouseControl or a grip — the click family. A press anywhere else
		whose sub-latch wobble lifts on a grip — the selected column's letter
		or row's number within ~2 CSS px of the header's inner edge, lifting
		on the clamped top band or a corner box while row 1 / column A is on
		screen — must not become the cell's click: the header never handed
		MouseControl a press, so a click there is a tap the header should
		have kept (round-16 wave-E verification measured 1560 of 4992 such
		wobble pairs clicking C1 / A5 without this guard; base lost the tap,
		which is the container's own behaviour and the one kept).
	*/
	private static readonly CLICK_FAMILY_PREFIX = 'cell_selection_';

	private forwardDroppedClick(target: { mouse: any; point: cool.SimplePoint }, point: cool.SimplePoint): void {
		const container: any = this.containerObject;
		if (typeof container.getReleaseDragDistance !== 'function') return;
		const travel = container.getReleaseDragDistance();
		if (!travel) return;
		const pressSection: unknown = container.sectionOnMouseDown;
		const pressInClickFamily =
			typeof pressSection === 'string' &&
			(pressSection === target.mouse.name ||
				pressSection.indexOf(CellSelectionHandle.CLICK_FAMILY_PREFIX) === 0);
		if (!pressInClickFamily) return;
		const lifted = this.canvasPoint(point);
		const pressed = [lifted[0] - travel[0], lifted[1] - travel[1]];
		const record = CellSelectionHandle.vulcanPressedGrip;
		const pressedHere =
			!!record && record.grip === this &&
			record.point[0] === pressed[0] && record.point[1] === pressed[1];
		if (pressedHere) return;
		target.mouse.onClick(
			target.point,
			new window.MouseEvent('click', { button: 0, buttons: 0 }),
		);
	}

	/*
		D-A (round 8): a tap inside the (then 44 px, now 30 px) box used to
		produce NOTHING — onMouseDown's stopPropagating() kept the click from
		ever reaching MouseControl (clearMousePositions runs only after
		propagateOnClick has already stopped here), this class never overrode
		onClick, and the base onClick is a no-op. Two invisible dead zones per
		selection, each half over a NEIGHBOURING cell. With the art shrunk to
		~4.5 px the box is ~98% invisible, so the shrink must not ship without
		this.

		Forward the tap to MouseControl as the document click it would have
		been. The point crosses frames by myTopLeft difference — the inverse
		of the container's own convertPositionToSectionLocale — so the click
		lands at the exact finger position and MouseControl's whole tap
		grammar (tap-again menu, double-tap edit, keyboard policy) applies
		unchanged rather than being re-implemented here. Phone only: off the
		phone the box IS the art and a mouse expects a handle to eat its own
		click.

		Round 16 wave E: this is the browser's click, which the container
		delivers only for a press and release on the same section; the
		touch-path forwards above and forwardDroppedClick carry the rest of
		the tap.
	*/
	onClick(point: cool.SimplePoint, e: MouseEvent): void {
		e.stopPropagation();
		this.stopPropagating();
		const target = this.mouseControlTarget(point);
		if (!target) return;
		target.mouse.onClick(target.point, e);
	}

	onMouseUp(point: cool.SimplePoint, e: MouseEvent): void {
		e.stopPropagation();
		if (this.containerObject.isDraggingSomething()) {
			CellSelectionHandle.vulcanPressedGrip = null;
			this.stopPropagating();
			this.onDragEnd(point);
			this.vulcanWholeAtPress = null;
			return;
		}
		this.vulcanWholeAtPress = null;
		const target = this.mouseControlTarget(point);
		if (!target) return;
		this.stopPropagating();
		target.mouse.onMouseUp(target.point, e);
		this.forwardDroppedClick(target, point);
		CellSelectionHandle.vulcanPressedGrip = null;
	}
}
