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
	MouseControl class is for handling mouse events if no other section (bound to tiles)
	handles it. This section is responsible for sending events to core side.
	This section is bound to tiles section. Tiles section represents the document view.
	Since this MouseControl class will handle mouse events that need to be sent to the core side,
	binding this class to tiles is normal. This class shouldn't cover all the canvas but only the document area.
*/

type VulcanImpressTapDecision = 'miss' | 'single' | 'double';

// A double tap is not merely two nearby touchends. The first tap raises the
// read-posture bar for one resolved slide; only a second tap while that bar is
// still visible, on that same slide, may take the direct-edit shortcut.
// Keeping this decision free of map/DOM state makes every boundary explicit
// and lets the browser unit bundle calibrate it against the former
// time-and-position-only grammar.
class VulcanImpressTapGrammar {
	private candidate: {
		time: number;
		x: number;
		y: number;
		part: number;
	} | null = null;

	public reset(): void {
		this.candidate = null;
	}

	public planTap(
		now: number,
		point: cool.PointLike,
		part: number | null,
		barVisible: boolean,
	): VulcanImpressTapDecision {
		if (part === null) {
			this.reset();
			return 'miss';
		}

		// The bar is the visible trust boundary for the shortcut. If another
		// surface dismissed it, the old candidate is no longer actionable.
		if (!barVisible) this.reset();

		const previous = this.candidate;
		const elapsed = previous ? now - previous.time : -1;
		const doubleTap =
			previous !== null &&
			elapsed >= 0 &&
			elapsed < 300 &&
			previous.part === part &&
			Math.abs(point.x - previous.x) < 30 &&
			Math.abs(point.y - previous.y) < 30;

		if (doubleTap) {
			this.reset();
			return 'double';
		}

		this.candidate = { time: now, x: point.x, y: point.y, part: part };
		return 'single';
	}
}

/*
 * Is the point under a shape that is painted ON TOP of the one being edited?
 *
 * Pure, and kept that way for the same reason VulcanImpressTapGrammar above is:
 * every boundary is then explicit and the whole decision can be tabulated in
 * mocha_tests/ImpressPhoneTapIntoShape.test.ts against the case that motivated
 * it, instead of being inferred from a device session.
 *
 * The inputs are core pixels, and the caller's note at vulcanImpressWantsCaret
 * carries the argument for why that space is the right one and why it is not
 * stale across a zoom.
 */
class VulcanImpressOverlap {
	/*
	 * `rectangles` is `extraInfo.ObjectRectangles`: one `[x, y, w, h, ordNum]`
	 * per object on the slide, the selected one included. `ownOrdNum` is
	 * `extraInfo.OrdNum`.
	 *
	 * EVERY UNCERTAIN ANSWER IS `false`, i.e. "keep doing what you were doing".
	 * That is not defensive padding; it is the direction the caller can afford
	 * to be wrong in. A false positive here converts a caret move into an entry
	 * attempt — a count 2 that selects the word under the finger — which is a
	 * regression against a gesture that already worked. A false negative leaves
	 * the shipped behaviour untouched. So an absent OrdNum, an absent array and
	 * a short row all decline to answer rather than guess.
	 *
	 * `ordNum > ownOrdNum` and not `!==`: an object painted BELOW the edited one
	 * cannot be what the finger hit, because core's hit testing takes the
	 * topmost too. Using `!==` would send a pair for a tap over a background
	 * rectangle the edited text box sits on, which is the commonest layout in a
	 * deck and would break the ordinary caret move everywhere.
	 */
	public static coveredByHigherObject(
		pointCorePxX: number,
		pointCorePxY: number,
		rectangles: number[][] | null | undefined,
		ownOrdNum: number | null | undefined,
	): boolean {
		if (!rectangles || !rectangles.length) return false;
		if (typeof ownOrdNum !== 'number' || !isFinite(ownOrdNum)) return false;
		if (!isFinite(pointCorePxX) || !isFinite(pointCorePxY)) return false;

		for (let i = 0; i < rectangles.length; i++) {
			const rectangle = rectangles[i];
			if (!rectangle || rectangle.length < 5) continue;

			const ordNum = rectangle[4];
			if (typeof ordNum !== 'number' || !isFinite(ordNum)) continue;
			if (!(ordNum > ownOrdNum)) continue;

			// Width and height are normalised rather than trusted: core emits a
			// negative extent for a shape mirrored on that axis, and an
			// un-normalised compare would silently never match it.
			const x1 = Math.min(rectangle[0], rectangle[0] + rectangle[2]);
			const x2 = Math.max(rectangle[0], rectangle[0] + rectangle[2]);
			const y1 = Math.min(rectangle[1], rectangle[1] + rectangle[3]);
			const y2 = Math.max(rectangle[1], rectangle[1] + rectangle[3]);
			if (!isFinite(x1) || !isFinite(x2) || !isFinite(y1) || !isFinite(y2))
				continue;

			if (
				pointCorePxX >= x1 &&
				pointCorePxX <= x2 &&
				pointCorePxY >= y1 &&
				pointCorePxY <= y2
			)
				return true;
		}

		return false;
	}

	/*
	 * B-0288: which object is actually being edited? Answer: the topmost one
	 * that HOLDS THE CARET, when that is painted above the object core
	 * reports as selected. Returns its box, normalised to [x1, y1, x2, y2],
	 * and its ordinal. Returns null when the reported selection is already
	 * that object or higher, so the caller keeps the selection.
	 *
	 * Why this is needed: measured on redroid, after a double tap into the
	 * eval deck's slide-1 title (OrdNum 3), core's graphicselection became
	 * the slide-sized background rectangle (OrdNum 0) for the rest of the
	 * edit. Measured against that background, every tap inside the title's
	 * own text read as "covered by a higher object".
	 *
	 * Uncertain inputs return null, which keeps the shipped decision, the
	 * same fail-safe as coveredByHigherObject.
	 */
	public static objectHoldingCaret(
		caretCorePxX: number,
		caretCorePxY: number,
		rectangles: number[][] | null | undefined,
		selectedOrdNum: number | null | undefined,
	): { rect: number[]; ordNum: number } | null {
		if (!rectangles || !rectangles.length) return null;
		if (typeof selectedOrdNum !== 'number' || !isFinite(selectedOrdNum))
			return null;
		if (!isFinite(caretCorePxX) || !isFinite(caretCorePxY)) return null;

		let best: { rect: number[]; ordNum: number } | null = null;
		for (let i = 0; i < rectangles.length; i++) {
			const rectangle = rectangles[i];
			if (!rectangle || rectangle.length < 5) continue;
			const ordNum = rectangle[4];
			if (typeof ordNum !== 'number' || !isFinite(ordNum)) continue;
			const x1 = Math.min(rectangle[0], rectangle[0] + rectangle[2]);
			const x2 = Math.max(rectangle[0], rectangle[0] + rectangle[2]);
			const y1 = Math.min(rectangle[1], rectangle[1] + rectangle[3]);
			const y2 = Math.max(rectangle[1], rectangle[1] + rectangle[3]);
			if (!isFinite(x1) || !isFinite(x2) || !isFinite(y1) || !isFinite(y2))
				continue;
			if (
				caretCorePxX < x1 ||
				caretCorePxX > x2 ||
				caretCorePxY < y1 ||
				caretCorePxY > y2
			)
				continue;
			if (!best || ordNum > best.ordNum)
				best = { rect: [x1, y1, x2, y2], ordNum: ordNum };
		}
		return best && best.ordNum > selectedOrdNum ? best : null;
	}

	/*
	 * B-0288, narrowed: does core's reported selection cover the whole slide?
	 * That is the one state in which the caret, not the selection, names the
	 * object being edited. On redroid it was graphicselection 0, 0, 19199,
	 * 10799 (twips) on a 19200 x 10800 slide, the background, OrdNum 0. In any
	 * other state the reported selection IS the edited object, and an arrow
	 * or label whose box happens to hold the caret must not replace it.
	 *
	 * `selection` is [x1, y1, x2, y2] in twips, like the slide's size. The
	 * slack is one core px at zoom 1, because core reports the last twip
	 * (19199), not the size. An unknown slide size answers false, which keeps
	 * the reported selection.
	 */
	public static coversWholeSlide(
		selection: number[] | null | undefined,
		slideWidthTwips: number | null | undefined,
		slideHeightTwips: number | null | undefined,
	): boolean {
		if (!selection || selection.length < 4) return false;
		if (typeof slideWidthTwips !== 'number' || !(slideWidthTwips > 0))
			return false;
		if (typeof slideHeightTwips !== 'number' || !(slideHeightTwips > 0))
			return false;
		const slack = 15;
		return (
			selection[0] <= slack &&
			selection[1] <= slack &&
			selection[2] >= slideWidthTwips - slack &&
			selection[3] >= slideHeightTwips - slack
		);
	}

	/*
	 * UI-B-004 (Design review: follow Google Slides' path for text entry; pending
	 * the Google reference clips): on a phone, a double tap on a PICTURE
	 * edits no text and raises no keyboard. The picture stays selected with
	 * its bar. Is core's selection one?
	 *
	 * `info` is `GraphicSelection.extraInfo`; `type` is the SdrObjKind
	 * (svdmrkv.cxx:1018-1022). Left to core, a count 2 goes through sd
	 * FuDraw::DoubleClick (fudraw.cxx:653-679): a picture (Graphic, 22), which
	 * is an SdrTextObj, gets text edit INSIDE it (SID_TEXTEDIT): a caret in a
	 * photo. Google does not do that.
	 *
	 * Pictures only (Design review, 2026-10-03). An embedded object (OLE2, 23: a
	 * chart, a Math formula, an embedded sheet) keeps its count 2, which
	 * activates it in place (SID_OBJECT) as before UI-B-004. That opens no
	 * caret, so it raises no keyboard either (isEmbeddedKind).
	 *
	 * One object only. A multi-selection answers false and keeps what ships.
	 */
	public static isTextlessKind(info: any): boolean {
		return VulcanImpressOverlap.isOneOfKind(info, 22);
	}

	// An embedded (OLE2, 23) object, alone: see isTextlessKind.
	public static isEmbeddedKind(info: any): boolean {
		return VulcanImpressOverlap.isOneOfKind(info, 23);
	}

	private static isOneOfKind(info: any, kind: number): boolean {
		return (
			!!info &&
			info.type === kind &&
			(!Array.isArray(info.selectedOrdNums) ||
				info.selectedOrdNums.length <= 1)
		);
	}
}

/*
 * WHERE IS THE NEAREST RENDERED TEXT TO THIS POINT?
 *
 * A phone tap inside the shape whose text is already open goes out as a bare
 * count 1, because that is what "move the caret" means on the wire. Core enters
 * an object's text on a count 1 ONLY when the hit point is inside a text
 * portion; a count 1 that lands anywhere else in the shape is core's "select
 * the object", which tears down text editing and destroys the caret. MEASURED
 * on the built image, a 20-point lattice over a shape already in text edit:
 * on-glyph 10/10 moved the caret, off-glyph 5/10 moved it and the other 5 LOST
 * it, with all five losses INSIDE the shape being edited (the rectangle read
 * off the wire, not inferred). A double tap at the same point recovered 1 of 5.
 *
 * So the tap does not need a different WIRE SEQUENCE, it needs a different
 * POINT. Google Slides puts the caret at the nearest text position for a tap
 * anywhere inside the box; the client already has the rendered text on the
 * canvas, so it can find that position itself and aim the count 1 at it. The
 * two halves below are that search, kept pure — no canvas, no map, no app —
 * so the whole decision can be tabulated in
 * mocha_tests/ImpressPhoneCaretSnap.test.ts instead of inferred from a device
 * session. The caller (MouseControl.vulcanImpressSnapCaretTap) owns everything
 * impure: the gate, the region, the readback.
 *
 * EVERY UNCERTAIN ANSWER IS `null`, i.e. "send the point the finger actually
 * touched". That is the direction this can afford to be wrong in: a `null`
 * reproduces what ships today, byte for byte, while a confident wrong answer
 * moves the caret somewhere the user did not point at — worse than the miss it
 * replaces, because a miss is at least legible as a miss.
 */
interface VulcanInkPoint {
	col: number;
	row: number;
}

class VulcanImpressInk {
	/*
	 * HALF ONE — A PATCH OF CANVAS BECOMES AN INK MASK.
	 *
	 * `pixels` is RGBA as `getImageData` returns it, `width` x `height`.
	 *
	 * "Ink" here is not "not the page colour" — inside a shape there IS no page
	 * colour, there is whatever fill the author chose. It is "differs from what
	 * this patch is mostly made of", and the background estimate is the MEDIAN
	 * luminance, not the mean and not the modal bucket. The median is the one
	 * that survives the case this runs in: a patch of a text line is >50%
	 * background by area at every font size a phone renders, so the median IS
	 * the fill, while the mean is dragged toward the glyphs and a modal bucket
	 * splits across the fill's own dithering.
	 *
	 * WHAT THIS DELIBERATELY DOES NOT TRY TO TELL APART. A photo fill, a
	 * gradient, a chart: all of them read as ink almost everywhere. That is not
	 * a bug to fix here, because of what the caller does with the answer — the
	 * nearest ink to the finger is then the finger's own pixel, the snap
	 * distance collapses to zero, and the tap goes out where it always would
	 * have. `maxInkFraction` is the backstop for the rest: a patch that is
	 * mostly ink is not a line of text on a fill, and answering `null` there is
	 * cheaper than reasoning about what it might be instead.
	 */
	public static mask(
		pixels: Uint8ClampedArray | number[] | null | undefined,
		width: number,
		height: number,
		threshold: number,
		maxInkFraction: number,
	): Uint8Array | null {
		if (!pixels) return null;
		if (!isFinite(width) || !isFinite(height)) return null;
		if (width < 1 || height < 1) return null;

		const count = width * height;
		if (pixels.length < count * 4) return null;

		// -1 marks a pixel that is not painted document. It neither votes for
		// the background nor can ever be ink. The canvas is created with
		// `alpha: true` and the container clears it to a solid colour, so in
		// practice nothing inside a shape is transparent; this is here so that
		// a canvas which for any reason is NOT painted answers "no idea"
		// instead of answering from the zeroes.
		const luminance = new Int16Array(count);
		const histogram = new Int32Array(256);
		let opaque = 0;
		for (let i = 0; i < count; i++) {
			const at = i * 4;
			if (pixels[at + 3] < 128) {
				luminance[i] = -1;
				continue;
			}
			// Rec. 601 luma in integers; 77 + 151 + 28 = 256, so the shift is
			// exact and the result is always 0..255.
			const value =
				(pixels[at] * 77 + pixels[at + 1] * 151 + pixels[at + 2] * 28) >> 8;
			luminance[i] = value;
			histogram[value]++;
			opaque++;
		}
		if (opaque === 0) return null;

		let background = -1;
		let seen = 0;
		const half = opaque >> 1;
		for (let value = 0; value < 256; value++) {
			seen += histogram[value];
			if (seen > half) {
				background = value;
				break;
			}
		}
		if (background < 0) return null;

		const ink = new Uint8Array(count);
		let inked = 0;
		for (let i = 0; i < count; i++) {
			const value = luminance[i];
			if (value < 0) continue;
			if (Math.abs(value - background) < threshold) continue;
			ink[i] = 1;
			inked++;
		}
		// A patch with no ink at all is a blank part of the shape, and a patch
		// that is nearly all ink is not text on a fill. Neither can say where a
		// glyph is.
		if (inked === 0) return null;
		if (inked > count * maxInkFraction) return null;
		return ink;
	}

	/*
	 * HALF TWO — WHICH INK PIXEL DID THE FINGER MEAN?
	 *
	 * `tapCol` / `tapRow` are the finger in mask coordinates and MAY sit
	 * outside the mask: the caller clips the patch to the shape rectangle, and
	 * a tap in the few pixels of margin that clip removes is exactly the tap
	 * this is for.
	 *
	 * ROWS FIRST, NOT NEAREST PIXEL. A text line is a band of rows that all
	 * carry ink; the gap above and below it carries none. Choosing the band and
	 * then the column inside it answers the two cases a plain nearest-pixel
	 * search gets wrong: a tap in the gap AFTER a short line lands on that
	 * line's last glyph (Google's end-of-line), and a tap below the last line
	 * lands on the last line rather than on whichever stray pixel happened to
	 * be closest in a straight line.
	 *
	 * THE RETURNED POINT IS ALWAYS AN INK PIXEL. That is the invariant the
	 * whole fix rests on, because "on ink" is the state the measurement scores
	 * 10/10, and it is what makes the row and column choices below answerable
	 * separately rather than jointly.
	 *
	 * THE FINGER ALREADY ON INK RETURNS `null`. Not "returns the same point":
	 * the caller must be able to tell "no correction needed" from "corrected to
	 * here", and the arm that already works has to leave here untouched.
	 */
	public static planSnap(
		ink: Uint8Array | number[] | null | undefined,
		width: number,
		height: number,
		tapCol: number,
		tapRow: number,
		minRowInk: number,
	): VulcanInkPoint | null {
		if (!ink) return null;
		if (!isFinite(width) || !isFinite(height)) return null;
		if (width < 1 || height < 1) return null;
		if (ink.length < width * height) return null;
		if (!isFinite(tapCol) || !isFinite(tapRow)) return null;

		if (
			tapCol >= 0 &&
			tapCol < width &&
			tapRow >= 0 &&
			tapRow < height &&
			ink[tapRow * width + tapCol] === 1
		)
			return null;

		const rowInk = new Int32Array(height);
		for (let row = 0; row < height; row++) {
			const base = row * width;
			let inked = 0;
			for (let col = 0; col < width; col++) if (ink[base + col] === 1) inked++;
			rowInk[row] = inked;
		}

		// A row joins a band on `minRowInk` pixels, never on one: a single lit
		// pixel is as likely to be the antialiased corner of a fill or a stray
		// mark as it is to be a glyph, and one such row between two lines is
		// all it takes to fuse them into one band.
		const floor = minRowInk > 1 ? minRowInk : 1;
		let bandTop = -1;
		let bandBottom = -1;
		let bandDistance = -1;
		let row = 0;
		while (row < height) {
			if (rowInk[row] < floor) {
				row++;
				continue;
			}
			const top = row;
			while (row < height && rowInk[row] >= floor) row++;
			const bottom = row - 1;
			const distance =
				tapRow < top ? top - tapRow : tapRow > bottom ? tapRow - bottom : 0;
			// Strictly nearer wins, so a finger exactly between two lines takes
			// the one ABOVE it. Arbitrary, but fixed: the alternative is a
			// caret that lands on a different line depending on which way the
			// scan ran.
			if (bandTop < 0 || distance < bandDistance) {
				bandTop = top;
				bandBottom = bottom;
				bandDistance = distance;
			}
		}
		if (bandTop < 0) return null;

		let targetRow: number;
		if (bandDistance === 0) {
			// The finger is already on this line's rows — it missed
			// horizontally, in a space or past the end of a short line. Keep
			// its row: moving it would be inventing a vertical correction the
			// finger did not ask for, and this row carries ink by the band's
			// own definition, so a column is guaranteed below.
			targetRow = tapRow;
		} else {
			// Coming from outside the band, take the row with the most ink —
			// the x-height, whose inked columns track the line's real extent,
			// rather than the fringe row nearest the finger, which may hold
			// nothing but one descender a long way from where they pointed.
			//
			// Restricted to the HALF of the band facing the finger, which is
			// what keeps a fused band (two lines with a descender bridging
			// them) from answering a tap below the text with the line above.
			const middle = (bandTop + bandBottom) >> 1;
			const from = tapRow < bandTop ? bandTop : middle;
			const to = tapRow < bandTop ? middle : bandBottom;
			targetRow = from;
			for (let candidate = from + 1; candidate <= to; candidate++)
				if (rowInk[candidate] > rowInk[targetRow]) targetRow = candidate;
		}

		const base = targetRow * width;
		let targetCol = -1;
		let best = -1;
		for (let col = 0; col < width; col++) {
			if (ink[base + col] !== 1) continue;
			const distance = Math.abs(col - tapCol);
			if (targetCol < 0 || distance < best) {
				targetCol = col;
				best = distance;
			}
		}
		if (targetCol < 0) return null;

		return { col: targetCol, row: targetRow };
	}
}

class MouseControl extends CanvasSectionObject {
	zIndex: number = app.CSections.MouseControl.zIndex;
	drawingOrder: number = app.CSections.MouseControl.drawingOrder;
	processingOrder: number = app.CSections.MouseControl.processingOrder;
	boundToSection: string = app.CSections.Tiles.name;

	mouseMoveTimer: any | null = null;
	clickTimer: any | null = null;
	currentPosition: cool.SimplePoint = new cool.SimplePoint(0, 0);
	clickCount: number = 0;
	pendingClickInfo: any | null = null;
	// UI-B-004: the phone-Impress double tap whose count 2 waits for core's
	// answer to tap 1 (see vulcanImpressDoubleTapAnswer). Read with `!= null`
	// everywhere: the mocha rigs build this receiver with Object.create.
	vulcanDoubleTapHold: any | null = null;
	// When this section took tap 2 of a touch double tap (Date.now(), 0 for
	// never). ShapeHandlesSection.onDoubleClick spends the browser's dblclick
	// inside its window as this pair's echo.
	vulcanTouchPairAt: number = 0;
	// ...held no longer than this from tap 2 (vulcanTap2At). Its own number,
	// not the keyboard door's verdict: the cap and the verdict used to be the
	// same due time (tap 2 + 800 ms), the verdict was armed first, so it
	// dismissed the keyboard just before the held count 2 went (the door
	// race). The verdict now waits on TextInput's door stamp
	// (VulcanImpressTextEntry.onDoorCount2Sent), and the count 2 still reaches
	// core by tap 2 + 800 ms whatever the door does.
	static readonly VULCAN_COUNT2_HOLD_CAP_MS: number = 800;
	positionOnMouseDown: cool.SimplePoint | null = null;

	/*
		Where the finger started, canvas-local, in CORE PIXELS.

		I2 — WHY THIS IS A NUMBER PAIR AND NOT A SimplePoint. It used to be
		`point.clone()`, and cloning a SimplePoint stores TWIPS: the container
		builds the point it hands us with `SimplePoint.fromCorePixels` at the
		`app.pixelsToTwips` in force when the event is delivered
		(CanvasSectionContainer.propagateOnMouseDown). Read the same field back
		at touchend and `.cX` re-derives it through whatever
		`app.twipsToPixels` is CURRENT — so if the zoom changed between the two
		events, the gesture's own start point moved.

		That is not hypothetical here: VulcanImpressTextEntry.applyZoom lands a
		hard `map.setZoom` 120-480 ms after a caret appears, which is squarely
		inside the next gesture. MEASURED against the real onMouseUp, with the
		entry rung this lane picks (0.2791 -> 0.8574): a perfectly still finger
		at canvas-local (200, 300) CSS px, 80 ms, reaches the caret path with no
		zoom change and is classified a SWIPE when the zoom lands mid-gesture.
		The finger had not moved at all.

		Canvas-local core px are a SCREEN quantity and do not scale with zoom,
		so an anchor kept in them cannot be rewritten under the gesture. This is
		the same reasoning, and the same representation, as vulcanPanAnchor
		below; that anchor got it right and this one did not.
	*/
	localPositionOnMouseDown: number[] | null = null;
	mouseDownSent: boolean = false;

	// C1 — the pan anchor, captured once per touch gesture at touchstart.
	//
	// [originX, originY] in core px, read from the layout's getScrollOrigin():
	// the position the gesture started from, in the space that layout's
	// scrollTo() speaks. The touch pan in onMouseMove is an ABSOLUTE map from
	// finger travel to view position off this anchor -- target = originOnDown
	// - fingerTravel -- so the same 250 px of travel lands on the same view
	// whether the browser delivered 3 touchmove events or 30. See the long
	// note at the pan itself for why the previous document-coordinate form
	// could not hold that property across a frozen pane.
	vulcanPanAnchor: number[] | null = null;

	// Where the touch pan's current leg began, as finger travel from
	// touchstart in core px. Reset at touchstart with the anchor.
	vulcanLegX: number = 0;
	vulcanLegY: number = 0;
	// The sideways travel, leftward and rightward, that the drag's legs
	// further up or down than sideways have built up, less a quarter of
	// their vertical travel, in core px. Reset at touchstart.
	vulcanDiagonalLeft: number = 0;
	vulcanDiagonalRight: number = 0;

	// How long a click waits to learn whether it is the first of a double (or
	// triple) click. Named because the phone tap grammar below reads it as the
	// multi-tap window too; the value is the one this class always used.
	multiClickWindow: number = 250;

	/*
		ROUND-10 S3 -- THE MODE A TOUCH GESTURE BEGAN IN, AND WHY NOTHING MAY
		READ THE LIVE MODE INSTEAD.

		The round-10 grammar gives the double tap opposite meanings in the two
		edit modes: in SHEET EDIT it opens the cell editor, in FOCUSED EDIT it
		closes it. A double tap is two taps, and on the already-selected cell
		TAP 1 IS THE TAP-AGAIN DOOR -- it opens the editor by itself, so by the
		time tap 2 arrives the live mode already reads focused edit. A rule that
		asked "what mode am I in?" at tap 2 would therefore read the mode tap 1
		had just created and run the exit, and every double tap meant as an
		entrance would immediately undo itself.

		So the discriminator is the mode the RUN began in, sampled once at tap 1
		and carried forward, never re-read. Two carriers, because there are two
		gestures with different lifetimes:

		  pendingClickInfo.vulcanOriginMode   the multi-click run. Set on tap 1,
		    copied onto tap 2's clickInfo, and dies with the run when
		    flushPendingClick clears pendingClickInfo. No new latch, no cleanup
		    path that can leak.

		  vulcanGestureOriginMode             one touch gesture (down..up), for
		    the drag rule, which has no click at all to hang state on.

		Both are sampled BEFORE the work that could change the mode: onClick
		fires 'editorgotfocus' -- which ends the cell edit session -- as its
		third statement, so a sample taken after it reads the post-transition
		mode for every tap.
	*/
	vulcanGestureOriginMode: string | null = null;

	// --- Vulcan phone tap grammar (docs/mobile-redesign/02 §5) -------------
	// What counts as a tap here, for Writer and for Calc alike. The tap
	// decisions sit on the touch path, which the container always propagates,
	// because the click path can be discarded once the container's drag latch
	// trips.
	//
	// The travel budget is LOCAL to this section on purpose: it is not the
	// container's touch drag latch, which feeds isDraggingSomething() and is
	// read by grid pan, the scrollbars, cell
	// drag-select, every shape handle, the autofill marker, the cell selection
	// handles, the table resize marker and comments — so a touch the container
	// has already called a drag can still be a tap in here. The two are set
	// separately and do not match: the container latches at 8 CSS px under
	// phone chrome (CanvasSectionContainer.onTouchMove, raised in this same
	// change from 0.1 CORE px, which no real finger could stay under), tapSlop
	// here is 10. That gap is deliberate — this section is the more forgiving
	// of the two — but it is a gap, not an untouched baseline. The
	// dwell cap is the long-press delay: past it the press has already
	// produced the menu through CanvasSectionContainer.startLongPress and this
	// path must not produce a second one.
	static tapSlop: number = 10; // CSS px
	static tapMaxDwell: number = 500; // ms -- CanvasSectionContainer.startLongPress

	// The deferred cell menu. A tap-again cannot know yet that it is not the
	// first half of a double tap, so the menu waits out the same window the
	// click deferral uses and the next finger-down cancels it.
	vulcanMenuTimer: any | null = null;

	// A range tap-again's first click, held instead of sent: an immediate
	// count 1 left click inside a multi-cell selection collapses it before
	// the cell menu timer can ask core about the RANGE (Autofill lives on
	// that menu). Dropped when the menu timer wins or a flush closes the
	// run; sent, still count 1, when a second tap turns the run into the
	// double-tap edit. Only ever set on phone Calc (see onClick).
	vulcanHeldRangeTapClick: any | null = null;

	// Time of the last finger-up that counted as a tap. Lets a tap tell that
	// it is on its own rather than tap 2 of a double tap.
	vulcanLastTapEndTime: number = 0;

	/*
		ROUND-11 C2 -- THE SELECTION AS IT STOOD BEFORE THE GESTURE, AND WHY
		NOTHING MAY ASK THE LIVE SELECTION INSTEAD.

		The hover toolbar's rule is "a second tap on an area that was ALREADY
		selected". Every predicate in this file answered the easier question --
		"is the finger inside what is selected NOW?" -- and isVulcanTapAgain's
		own comment concedes the limit: it "only answers correctly while core
		has not yet been told about this tap". For the SECOND event of a slow
		pair that premise is simply false. Core heard about tap 1 a second ago
		and moved the cursor to wherever tap 1 landed, so a slow pair on a cell
		that was never selected reads as "on the selection" purely because tap 1
		selected it. That is the toolbar appearing where the designer says it must
		never appear, and no amount of tightening a live containment test can
		reach it: the missing information is historical, not geometric.

		So sample it. Three carriers, and the shape of them is the whole fix:

		  vulcanPreGestureSelection    the selection signature read at THIS
		    gesture's touchstart -- before onVulcanTouchDown, before any click,
		    so it is the selection the finger came down on.

		  vulcanPendingTapSelection    what this gesture will hand forward IF it
		    ends as a Calc tap. Null until onVulcanDocumentTapEnd says so, which
		    is what makes a pan or a fling break a pair rather than extend it.

		  vulcanPriorTapSelection      the promoted value: non-null exactly when
		    the gesture IMMEDIATELY BEFORE this one was a tap, and then equal to
		    the selection THAT tap came down on.

		The pair test is then one comparison. Prior equals pre means the tap
		before this one did not move the selection, i.e. the area was already
		selected when the pair began; prior differs means tap 1 is what selected
		it, and this is the gesture that must produce nothing. Signatures rather
		than rectangles because a rectangle that compares equal is the same
		rectangle, and the containment test can then read the live one.

		READ-ONLY over _cellSelectionArea. The S6 restore in CanvasTileLayer
		(_onCellSelectionAreaMsg) owns that field's EMPTY -> same-rect
		restatement dance and nothing here writes it or re-times a message;
		sampling is driven by the finger, not by the wire.
	*/
	vulcanPreGestureSelection: string | null = null;
	vulcanPendingTapSelection: string | null = null;
	vulcanPriorTapSelection: string | null = null;

	// Set for the rest of a touch gesture once this section has already told
	// core about that gesture's tap, so onClick can consume the browser click
	// that follows instead of sending a second one. Two arming paths, both
	// phone-only:
	//
	//   Writer  replayTapAsClick — belt and braces. The replay only runs when
	//           the container has latched its touch drag, which is precisely
	//           when the container drops the browser click, so a click should
	//           never arrive after one.
	//   Impress vulcanImpressTapAsClick — the same replay, same reasoning.
	//
	// Cleared on the next finger-down. Never armed off the phone path, so
	// onClick's read of it is dead code on desktop and tablet.
	vulcanTapReplayed: boolean = false;

	// Set when phone Impress ENTERS EDIT MODE (Permission.js _enterEditMode ->
	// vulcanArmImpressEditEntryClickGuard), cleared on the next real
	// finger-down or by consuming one click, whichever comes first.
	//
	// The gesture that enters edit mode does not end when the mode flips. The
	// read bar's 'Edit slide' runs on POINTERUP (MobileSelectionBar.armButton,
	// which must act on the up for the Cut/Delete data-loss reasons documented
	// there) and hides the bar synchronously -- and the tap's
	// browser-synthesised click is dispatched AFTER that, hit-tested against a
	// screen the bar has already left. WebKit re-targets it at the canvas,
	// onClick sends it to core as a count 1 in the NOW-EDITABLE session, and
	// core selects whatever sits under where the button was. Measured on
	// slot-01 (probe A3): 'Edit slide' landed at L3 with the tapped slide's
	// TITLE placeholder selected -- depth 2 'object' instead of depth 1
	// 'posture' -- and every later rung of the walk cascaded off that extra
	// rung. The double-tap entry has the same trailer: onVulcanTapEnd's cancel
	// covers only the multi-click THIS section armed, not the browser's own
	// click for tap 2.
	//
	// The discriminator is structural, not a timer: a REAL tap always begins
	// with a canvas touchstart, which clears this latch before that tap's
	// click can arrive -- so a genuine next tap can never be eaten, on any
	// engine. The only click that can be consumed is one arriving with NO
	// finger-down since the entry: exactly the entry gesture's synthetic
	// trailer. On engines that keep targeting the trailing click at the
	// (hidden) button instead of re-hit-testing, nothing reaches the canvas
	// and the latch dies quietly at the next finger-down.
	vulcanImpressEditEntryClickGuard: boolean = false;

	// Set for the rest of a touch gesture once the container's long press has
	// actually reached onContextMenu, on any phone document type, and cleared
	// on the next finger-down.
	//
	// This records the EVENT, where vulcanLongPressFired below records a Writer
	// DECISION taken on the back of it. The tap grammar needs the event: its
	// dwell cap was standing in for "the long press owns this gesture", and a
	// clock cannot answer that, because CanvasSectionContainer.onTouchMove
	// cancels the long-press timer on its first event whatever the distance.
	// A press that outlasts the cap and was cancelled anyway is still a tap,
	// and before this it was nothing at all. See onVulcanDocumentTapEnd.
	//
	// Only ever set inside the phone chrome, so every read of it is inert on
	// desktop and tablet, where onContextMenu means a real right click.
	vulcanLongPressServed: boolean = false;

	// Set for the rest of a touch gesture once a long press has posted its
	// own click -- phone Writer's word select, or phone Impress's edit-mode
	// object select -- and cleared on the next finger-down.
	//
	// When the finger lifts after a long press the browser synthesises a
	// click, and the container hands it to onClick whenever its touch drag
	// latch stayed clear. onClick fires 'closemobilewizard' and sends a count 1
	// left click -- collapsing the word the press just selected (and, in the
	// read posture, shutting whatever the right button produced). No gesture
	// wants a long press AND a trailing click, so the click is consumed.
	//
	// This is not new with the tap replay. The replay only runs under the dwell
	// cap, and tapMaxDwell IS the long-press delay, so a fired long press does
	// not reach it; the trailing click reached onClick in exactly the same
	// condition (latch clear) before the replay existed. Whether the browser
	// dispatches that click at all after a 500ms press under
	// `touch-action: none` is device behaviour, so this is armed either way.
	// Never armed outside those two arms -- Calc retains its shipped click
	// behavior, while a desktop right-click produces 'contextmenu' and no
	// click -- so onClick's read of it is dead code on those paths.
	vulcanLongPressFired: boolean = false;

	// The last mouse position during a button-down drag, in canvas-local
	// coordinates that do not include the scroll offset, together with the
	// keyboard modifier that was active then. Kept so the drag position can be
	// recomputed and re-sent when the view scrolls under a stationary mouse.
	lastDragLocalPoint: cool.SimplePoint | null = null;
	lastDragModifier: number = 0;

	inSwipeAction: boolean = false;
	swipeVelocity: number[] = [0, 0];
	swipeTimeStamp: number = 0;
	amplitude: number[] = [0, 0];
	touchstart: number = 0;

	// Finger positions during a phone touch drag: canvas-local core pixels on a
	// performance.now() stamp. Only the trailing vulcanVelocityWindowMs is ever
	// read, but a few more are kept so a window always has two samples in it.
	vulcanTouchSamples: { x: number; y: number; t: number }[] = [];

	// Set while onDraw is running the projected coast instead of upstream's
	// exponential-of-net-displacement. Cleared by cancelSwipe, so every
	// existing arrest path (second finger, touchdown, document edge) already
	// ends it.
	vulcanFlingActive: boolean = false;
	vulcanFlingTarget: number[] = [0, 0]; // total projected travel, core px
	vulcanFlingTravelled: number[] = [0, 0]; // paid out so far, core px
	vulcanFlingDuration: number = 0; // ms until the tail reaches the end speed
	// Last frame's scroll origin, to check if we hit the borders of the
	// document. The ORIGIN and not the viewed rectangle: on a stacked layout
	// the rectangle covers whole pages and does not change every frame.
	previousScrollOrigin: number[] | null = null;

	// Per-axis edge-ease segments for the projected coast. Null while the
	// shared curve owns the axis; once the coast is provably going to overrun
	// the document edge on that axis, a segment re-projects it to land ON the
	// edge at the tail speed instead of dead-stopping at full speed. `done`
	// keeps the axis pinned exactly at the edge for the remaining frames.
	vulcanFlingEase: ({
		t0: number; // segment clock start, ms
		from: number; // scroll origin at re-projection, core px
		edge: number; // the clamp the segment lands on, core px
		rate: number; // per-ms retention chosen for velocity continuity
		duration: number; // ms until the tail reaches the end speed
		done: boolean;
	} | null)[] = [null, null];

	pinchStartCenter: any;
	zoom: any;
	origCenter: any;
	pinchLength: number = 0;

	// Which rung grammar THIS pinch commits under, latched when the gesture
	// starts rather than re-read when it ends. Two reasons, both load-bearing:
	// the settle runs after the gesture is over, when the document layer may
	// already have been swapped or torn down, so the surface a gesture began on
	// is the honest answer; and finishMultiTouchGesture is executed as
	// standalone source text by the phone pinch unit
	// (mocha_tests/ImpressPhonePinch.test.ts), whose receiver can carry fields
	// but not this class's private predicates. Both stay false off the phone
	// chrome, which is exactly the stock commit behavior.
	vulcanPinchPhone: boolean = false;
	vulcanPinchPhoneCalc: boolean = false;

	// The SECTION-world document point under the pinch center at gesture
	// start, [pX, pY] core pixels — latched by vulcanImpressPinchStartIntern
	// on phone Impress only, undefined everywhere else. While it is set,
	// every center the pinch pipeline sees derives from THIS point plus raw
	// screen travel, never from the map's own (possibly drifted) view. See
	// the header on vulcanImpressPinchStartIntern for the two-worlds bug
	// this closes.
	vulcanImpressPinchDoc: number[] | undefined = undefined;

	// --- Vulcan phone pinch (docs/mobile-redesign/02 §5) --------------------
	// Zoom units per CSS px of finger-separation change. Upstream is 0.01: a
	// full two-thumb spread on a 390px-wide phone is about 300px of separation
	// change, i.e. only 3 zoom units, and Calc's usable range is wider than
	// that -- the gesture ran out of fingers before it ran out of zoom.
	//
	// The two constants below are read through DIFFERENT gates, and they are
	// no longer the same set. The sensitivity is read through
	// isVulcanPhonePinch() in onMultiTouchMove, which is phone Calc AND phone
	// Writer -- the argument above is about the gesture and the screen, and a
	// phone document's ladder is as wide as a sheet's. The snap is read
	// through the vulcanPinchPhoneCalc flag latched at pinch start, which is
	// phone Calc alone. Desktop and tablet are outside both, on every
	// doctype, so their pinch is untouched. The nearest-rung commit the other
	// phone surfaces use is in finishMultiTouchGesture.
	static pinchZoomPerCssPx: number = 0.02;

	// How close to an integer rung the pinch has to finish before it is read
	// as aiming at that rung. Past it the gesture keeps upstream's
	// direction-of-travel snap. The committed zoom stays integral either way
	// -- see finishMultiTouchGesture.
	static pinchSnapDistance: number = 0.35;

	// Under this gap between the released fractional zoom and its committed
	// rung the correction is too small to see; above it the commit is eased
	// through the layer's runVulcanPinchSettleAnimation so the rung snap
	// reads as a settle, not a one-frame jerk. Phone pinches only.
	static pinchSettleEpsilon: number = 0.05;

	// --- Vulcan phone legibility floor (R6-7 doctrine, lever L5) ------------
	// A phone pinch-out on WRITER must not COMMIT below the rung where body
	// text stops being readable. Like the fit floors, it clamps only the
	// COMMITTED rung: mid-gesture undershoot springs back on release, which
	// on a document is the behaviour the founder ruled correct ("docs allows
	// you to do this, which is fine, because tiny text doesn't look as bad as
	// tiny gridlines"). Desktop and tablet never read it.
	//
	// A MIRROR OF VulcanWriterFit.LEGIBLE_FLOOR_LEVEL, which carries the
	// derivation, the measurement of the reference app behind it, and the
	// page-view trade it accepts. Duplicated as a literal for one reason:
	// ImpressPhonePinch.test.ts runs finishMultiTouchGesture's source text
	// inside a bare Function scope that is handed `app` and `MouseControl`
	// and nothing else, so a read of another bundle global would throw there.
	// The same constraint VulcanWriterReflow's mirrored ladder constants
	// document, answered the same way: the two are pinned equal by
	// WriterPhoneFitWidth.test.ts, so neither can move alone.
	//
	// 🔴 IT WAS 8, and that was the D8 defect on this path. Rung 8 renders
	// 11pt body at 10.19 CSS px against the 16 px VulcanWriterReflow's own
	// LEGIBLE_MIN_CSS_PX calls readable -- its measured sweep files that rung
	// under "Still unreadable". The old derivation reasoned in 12pt and
	// landed at 11.1 px, still short; it was never checked against the
	// constant three files away that had already answered the question.
	//
	// CALC IS NOT ON THIS CONSTANT and must not be put back on it. It shared
	// this floor at rung 7 until R8 C0, on arithmetic that only ever worked
	// for Writer: a 10pt cell is 13.33 px at rung 10, so rung 7 renders 7.7
	// px, not the "~9.3" the old comment claimed -- 9.3 is the rung-ELEVEN
	// size scaled by the rung-7 factor, an off-by-one-rung slip. Phone Calc
	// also OPENS one rung IN at 11 (CalcTileLayer.js:163), so rung 7 was the
	// whole zoom-out range, spent by one ordinary gesture, after which every
	// pinch shrank the grid mid-gesture and the settle eased it back: the
	// founder's "I can't zoom out", with no other affordance to escape it
	// (the phone spreadsheet View menu carries no zoom rows and #toolbar-down
	// is display:none there).
	//
	// Calc's floor is NAVIGATIONAL, not legibility, and is the next static
	// down. Impress keeps its own fit floor and has never had a text floor.
	static pinchLegibilityFloorWriter: number = 11;

	// --- Vulcan phone Calc navigation floor (G32, exhibit EX-12) ------------
	// The deepest rung a phone Calc pinch-out may COMMIT. At the bottom of a
	// spreadsheet's zoom range navigation beats legibility: seeing where you
	// are in a big sheet is worth more than reading the cells. So this is not
	// a legibility target and it is deliberately far below one.
	//
	// The number is EX-12, measured on the Google Sheets iPhone app: ~13
	// columns x ~90 rows of unreadable-but-navigable grid at full zoom-out.
	// Translated onto this ladder (1.2^(k-10)) with Calc's default cell,
	// 85.4 x 17.0 CSS px at rung 10 (1280 x 255 twips at 96dpi), and the
	// phone the fork's cases use, 393 x 852 CSS px:
	//
	//   rung 5 (40.2%): 34.3 px columns, 6.8 px rows -> ~11 x ~93
	//   rung 4 (33.5%): 28.6 px columns, 5.7 px rows -> ~14 x ~112
	//
	// Rung 5 is within ~12% of the exhibit on BOTH axes; rung 4 matches the
	// column count only by running the row pitch 20% below the pitch Google
	// itself stops at, and 90 rows would need 512 px of grid, i.e. 340 px of
	// phone chrome, which this surface does not have. Rung 5 also reproduces
	// the exhibit's zoom-out RANGE independently of any cell-size assumption:
	// 11 -> 5 is 1.2^6 = 2.99x per axis against Google's ~3x from its own
	// opening 100%.
	//
	// A CONSTANT, unlike Impress's fit floor, because that is the shape of
	// the thing being copied -- Google's phone zoom-out is a fixed minimum,
	// not a function of the sheet. It REPLACED a used-range fit floor (R8 C0,
	// ruling X-4 option ii), which EX-12 revises: fit was too tight on
	// narrow sheets and, worse, failed open on the sheets it was meant to
	// bound. From ~20 used columns up the fit rung lands at or below the map
	// minimum (85.4 px columns at rung 10 into 393 px is rung 1.94 at 20,
	// 2.22 at 19), so the floor evaluated to rung 1 -- a 16 px x 3 px hairline
	// grid; below the live rung it did not apply at all and rung 1 was
	// reachable anyway. One constant closes both ends.
	static pinchNavigationFloorCalc: number = 5;

	// --- Vulcan phone fling physics (docs/mobile-redesign/02 §2.1b) ---------
	//
	// Copied, with attribution, from the HOST's
	// motion code (`velocityFromSamples`,
	// `project`), which is in turn chpwn's reverse-engineering of UIScrollView
	// plus WWDC 2018 session 803 "Designing Fluid Interfaces".
	//
	// There is no import to write instead. This package builds with
	// `module: none` and an ordered concatenation list in Makefile.am, so it
	// cannot consume an ESM module from another workspace package, and adding
	// a bundler step for two pure functions is disproportionate. They are
	// static members of the one class that consumes them, which also means the
	// copy introduces NO new top-level name into the global scope the
	// concatenation shares -- unlike a new file with a new class.
	//
	// UNITS, exactly as in the host file: every velocity below is px per
	// MILLISECOND. Getting this wrong is a silent 1000x error.

	// Host `PHYSICS.velocityWindowMs`.
	static vulcanVelocityWindowMs: number = 60;

	// Host `PHYSICS.decelNormal` -- `UIScrollView.DecelerationRate.normal`.
	static vulcanFlingDecel: number = 0.998;

	// Release speed below which the gesture was a drag that stopped, not a
	// flick, and the view stays where the finger left it. CSS px/ms.
	static vulcanFlingMinVelocity: number = 0.15;

	// Release speed ceiling, CSS px/ms. 4 px/ms is 4000 CSS px/s, faster than
	// any real finger. The clamp is here because velocityFromSamples falls
	// back to the full sample span when fewer than two samples lie outside the
	// window, so a 2ms span can turn one coalesced 20px move into a 10 px/ms
	// spike. At the ceiling the projection is ~1996 CSS px, about 2.4 phone
	// screens -- which is what keeps a hard flick well short of four screens.
	static vulcanFlingMaxVelocity: number = 4;

	// Where the tail stops, CSS px/s. Upstream terminated on a PER-FRAME delta
	// of 0.2 core px, which at dpr 3 and 60fps is about 4 CSS px/s: slow
	// enough to read as the view being stuck rather than as it settling.
	static vulcanFlingEndVelocity: number = 20;

	// Enough history to always cover the velocity window (24 frames is ~400ms
	// at 60Hz, ~200ms at 120Hz), capped so a long drag cannot grow it.
	static vulcanMaxTouchSamples: number = 24;

	// A coast headed for the document edge starts easing inside this distance
	// of it, CSS px. Inside the zone the axis is re-projected onto the same
	// exponential family with the asymptote AT the edge and the initial speed
	// equal to the coast's current speed, so the hand-off is seamless and the
	// landing arrives at the tail speed instead of a dead stop.
	static vulcanFlingEdgeEaseZone: number = 120;

	// Velocity over the trailing `windowMs` of samples, in px/ms; positive
	// means increasing coordinate, 0 when it cannot be measured.
	//
	// Measuring across the WHOLE gesture -- which is precisely what the
	// upstream fling did, passing net displacement where a velocity was
	// wanted -- makes a slow drag ending in a flick read as slow, a fast drag
	// ending parked read as fast, and an out-and-back read as its small net.
	// Only the last ~60ms describes what the finger was doing at release.
	//
	// One adaptation from the host's 1-D `PointerSample`: a sample here
	// carries both axes against one timestamp, so the axis is chosen by
	// argument rather than by building a second array per gesture.
	static velocityFromSamples(
		samples: readonly { x: number; y: number; t: number }[],
		axis: 'x' | 'y',
		windowMs: number = MouseControl.vulcanVelocityWindowMs,
	): number {
		if (samples.length < 2) return 0;
		const last = samples[samples.length - 1];
		let i = samples.length - 1;
		while (i > 0 && last.t - samples[i].t < windowMs) i--;
		const dt = last.t - samples[i].t;
		return dt > 0 ? (last[axis] - samples[i][axis]) / dt : 0;
	}

	// Projected resting point of a flick per WWDC 2018 session 803: the extra
	// distance the content travels after release, in px.
	//
	// `rate` is the per-millisecond retention. The host's `project()` DEFAULTS
	// it to 0.99 (`.fast`, for pagers, which are supposed not to coast) while
	// this path always wants 0.998 (`.normal`), which travels five times as
	// far. That default is a live footgun, so this copy deliberately has no
	// default and makes every caller state the rate.
	static projectFling(v: number, rate: number): number {
		if (rate <= 0 || rate >= 1) return 0;
		return (v * rate) / (1 - rate);
	}

	// Phone Impress read posture (see onVulcanTapEnd) owns a double-tap grammar
	// SEPARATE from the deferred core click counter Writer and Calc share: the
	// grammar rides the touch path rather than the click timer above, and it
	// answers on the resolved slide and the read-posture bar, not on time and
	// position alone. vulcanBarShown is a plain boolean so the scroll hot path
	// (onNewDocumentTopLeft) costs one read when there is no bar or tap
	// candidate to dismiss.
	vulcanTapGrammar: VulcanImpressTapGrammar = new VulcanImpressTapGrammar();
	vulcanBarShown: boolean = false;

	// One bounded slide-part commit per Impress scroll gesture.
	vulcanPartCommit: VulcanImpressPartCommit = new VulcanImpressPartCommit();

	// R8 S2 — the zoomed slide-turn latch: one armed, decaying edge intent
	// per surface. All policy lives in the planner (src/app); every
	// disqualifying event this class sees routes through its clear().
	vulcanImpressZoomIntent: VulcanImpressZoomIntent =
		new VulcanImpressZoomIntent();

	constructor(name: string) {
		super(name);
	}

	static readModifier(e: MouseEvent) {
		let modifier = 0;
		const shift = e.shiftKey ? app.UNOModifier.SHIFT : 0;
		const ctrl = e.ctrlKey ? app.UNOModifier.CTRL : 0;
		const alt = e.altKey ? app.UNOModifier.ALT : 0;
		const cmd = e.metaKey ? app.UNOModifier.CTRLMAC : 0;
		modifier = shift | ctrl | alt | cmd;

		return modifier;
	}

	// PowerPoint multi-select parity: Ctrl+click (Cmd on macOS, where plain
	// Ctrl+click is the right-click convention) toggles an Impress object in
	// and out of the selection. Core already implements click-toggling for
	// SHIFT, so translate the modifier at the click send — both for clicks on
	// unselected canvas (MouseControl) and clicks landing on the selected
	// area (ShapeHandlesSection.onClick), so a modifier-click can un-toggle
	// a selected member too. Text edit keeps its native ctrl-click
	// semantics, and ctrl-DRAG stays core's copy-drag.
	static impressToggleModifier(modifier: number): number {
		if (
			VulcanLiveCanvas.isCanvasDoc() &&
			!app.file.textCursor.visible &&
			(modifier === app.UNOModifier.CTRL ||
				modifier === app.UNOModifier.CTRLMAC)
		)
			return app.UNOModifier.SHIFT;
		return modifier;
	}

	/*
		We need to map view coordinates to document coordinates.
		When user clicks at a position on the screen, we have its document coordinate according to
		traditional document view: It starts from top-left and ends at bottom-right. Now the new ViewLayouts
		can paint multiple parts at the same time and they can paint objects in different locations than the objects' original positions.
		This means that the point user clicks/taps may not overlap with the document through simple math.
		During this transition phase (to view layouts), we need both point.pX and point.vX properties. Later, we may use only vX, vY etc.

		This function should be used only for real user interactions. If you want to simulate a click at a certain position, call _postMouseEvent directly.
	*/
	private postCoreMouseEvent(
		eventType: string,
		point: cool.SimplePoint,
		clickCount: number,
		buttons: number,
		modifier: number,
	) {
		// UI-B-004: a double tap still waiting for core's answer goes out
		// first, so core reads the events in the order the finger made them
		// (1, 2, then this drag or press).
		if (this.vulcanDoubleTapHold != null) this.flushPendingClick();

		let viewToDocumentPos = point.clone();
		Util.ensureValue(app.activeDocument);

		// Convert to pure canvas html element coordinate.
		viewToDocumentPos.pX +=
			-app.activeDocument.activeLayout.viewedRectangle.pX1 +
			app.sectionContainer.getDocumentAnchor()[0];
		viewToDocumentPos.pY +=
			-app.activeDocument.activeLayout.viewedRectangle.pY1 +
			app.sectionContainer.getDocumentAnchor()[1];

		viewToDocumentPos =
			app.activeDocument.activeLayout.canvasToDocumentPoint(viewToDocumentPos);

		if (Number.isNaN(viewToDocumentPos.x) || Number.isNaN(viewToDocumentPos.y))
			return;
		else {
			app.map._docLayer._postMouseEvent(
				eventType,
				viewToDocumentPos.x,
				viewToDocumentPos.y,
				clickCount,
				buttons,
				modifier,
			);
		}
	}

	public onContextMenu(point: cool.SimplePoint, e: MouseEvent): void {
		// We need this to prevent native context menu.
		e.preventDefault();

		// We will remove below ones after we remove map HTML element.
		e.stopPropagation();
		e.stopImmediatePropagation();

		const buttons = app.LOButtons.right;
		const modifier = MouseControl.readModifier(e);

		// A double-click (count=2) is deferred by the 250ms timer.
		// If the user right-clicks before it fires, flush it now.
		this.flushPendingClick();

		if (modifier === 0) {
			// The event itself, ahead of any per-doctype decision taken on it:
			// this gesture reached the long press, so the tap grammar must not
			// also answer it. Gated on the phone chrome alone, which is what
			// makes "the sole caller is startLongPress" below true.
			if (this.isVulcanPhone()) this.vulcanLongPressServed = true;

			// R8 S2 — a long press is the user doing something else: drop
			// any standing zoomed slide-turn intent. (The planner also
			// refuses on the served latch at touchend; this clears the arm a
			// PRIOR swipe left, which that refusal alone would leave live.)
			// Null-guarded for the Object.create'd mocha receivers.
			if (this.vulcanImpressZoomIntent)
				this.vulcanImpressZoomIntent.clear();

			// Inside the phone chrome this can only be a long press: there is
			// no right button on a phone, so the sole caller is
			// CanvasSectionContainer.startLongPress -> its own onMouseMove ->
			// propagateOnContextMenu. Latch it so the click the finger-up
			// synthesises cannot close the menu that is about to open.
			//
			// Only the arms that post their own click below: swallowing that
			// trailing click also swallows onClick's 'closepopups' /
			// 'editorgotfocus' / 'closemobilewizard' and the count 1 left
			// click it sends, so a press that posted an explicit click must
			// consume the trailing one or core hears the press twice. Calc's
			// tap grammar shipped and is verified as it stands and must not
			// have its long press change as a side effect. Substituting false
			// here recovers the pre-Vulcan behaviour on every doctype.
			//
			// Calc joins on the OPPOSITE reason: its press posts nothing at
			// all, and the trailing click's count 1 would draw the
			// `celladdress` that retires the popover the press just raised.
			const impressSelects = this.shouldSelectObjectOnLongPress();
			const calcPopover = this.shouldRaiseCellPopoverOnLongPress();
			const longPress =
				this.isVulcanPhoneWriter() || impressSelects || calcPopover;
			// One press can arrive here twice: the container's own 500ms timer
			// fires this, and a browser that also dispatches a native
			// 'contextmenu' for the same press reaches it a second time
			// through canvas.oncontextmenu -> propagateOnContextMenu. The
			// latch doubles as the "already handled this press" mark so the
			// word is selected once. The duplicate right button below is
			// pre-existing behaviour and is left alone.
			const firstOfThisPress = longPress && !this.vulcanLongPressFired;
			if (longPress) this.vulcanLongPressFired = true;

			// Writer, phone: a long press selects the word under the finger
			// first, the way every other phone text surface does.
			//
			// Sent as an ordinary count 2 click at the press point: exactly
			// what a double tap already sends, so core's own word boundaries
			// decide what gets selected and no new UNO command is involved
			// (nothing in this tree sends .uno:SelectWord, and nothing here
			// starts). It goes out before the read posture's right button
			// below, so when that posture does build a menu it is the
			// selection's rather than the caret's.
			if (firstOfThisPress && this.shouldSelectWordOnLongPress())
				this.sendClick(
					{
						sendingPosition: this.currentPosition.clone(),
						buttons: app.LOButtons.left,
						modifier: 0,
					},
					2,
				);

			// Impress, phone, EDIT posture, nothing selected: the long
			// press's product below is the selected object with its pill, but
			// nothing here used to make that selection -- it rode the click
			// some engines synthesise after a 500ms press, which the
			// vulcanLongPressFired note calls device behaviour. Select
			// explicitly with the count 1 the trailing click would have sent
			// (consumed above via the latch), so the pill rises
			// deterministically on every engine.
			if (firstOfThisPress && impressSelects)
				this.sendClick(
					{
						sendingPosition: this.currentPosition.clone(),
						buttons: app.LOButtons.left,
						modifier: 0,
					},
					1,
				);

			// Writer and Impress, phone, EDIT posture: the long press's whole
			// product is the selection surface -- Writer's word select above
			// with the selection pill, Impress's selected object with its
			// pill. The right button below would make core answer with a
			// context menu, Control.ContextMenu routes that reply into the
			// mobile wizard on a small screen, and the 'mobilewizard' event
			// hides the pill (Control.MobileSelectionBar) -- the sheet trades
			// Google's long-press inventory for an uncurated one. Calc is out
			// of THIS predicate but reaches the same conclusion one branch
			// below, through calcPopover: its surface is raised here rather
			// than kept, so it needs the anchor as well as the refusal. Read
			// postures are out too:
			// Control.ContextMenu drops core's menu when !isEditMode(), and
			// Writer's read pill rides the word select above. Substituting
			// false here recovers the shipped sheet on both doctypes.
			if (this.vulcanLongPressKeepsSelectionSurface()) return;

			// Calc, phone, on what is already selected: the cell menu's door.
			// Anchored where the finger is, in the space the bar positions in,
			// exactly as the range timer anchors its own raise. The duplicate
			// contextmenu dispatch some engines send for one press is what
			// firstOfThisPress keeps out, so the row is built once.
			if (calcPopover) {
				if (firstOfThisPress)
					this.vulcanRaiseCellPopover(
						this._documentToCssPosition(this.currentPosition.clone(), false),
					);
				return;
			}

			this.postContextMenuDown(this.currentPosition, buttons);
		}
	}

	// See the gate in onContextMenu. Phone chrome, edit posture, Writer or
	// Impress only -- every other combination still posts the right button.
	private vulcanLongPressKeepsSelectionSurface(): boolean {
		if (!app.map.isEditMode()) return false;
		return this.isVulcanPhoneWriter() || this.isVulcanPhoneImpress();
	}

	// Whether the phone long press should select the word under the finger.
	//
	// Writer only. A count 2 click means "select the word" in a text flow, but
	// in Calc it opens the in-cell editor and in Impress it enters the shape's
	// text -- neither is what a long press asked for, and both already have a
	// shipped grammar of their own that this must not fight.
	//
	// In the READ posture too: a reader long-pressing a citation gets the word
	// selected with the read pill's Copy attached (MobileSelectionBar builds a
	// copy-only inventory when !isEditMode()). Core allows text selection in a
	// view-readonly session — this is the same selection desktop readers get
	// with a double-click. Control.ContextMenu still drops core's context menu
	// when !isEditMode(), which is wanted: the pill is the read affordance.
	//
	// Not over a selected object: with a shape or an image selected, a
	// count 2 click enters the object instead of selecting a word.
	private shouldSelectWordOnLongPress(): boolean {
		if (!this.isVulcanPhoneWriter()) return false;
		if (GraphicSelection.hasActiveSelection()) return false;
		return true;
	}

	// Whether the phone long press should select the OBJECT under the finger.
	//
	// Impress, edit posture, nothing selected: the press's product is the
	// selected object with its pill (see onContextMenu), and with no explicit
	// click posted the selection rode the browser's trailing compat click --
	// which after a 500ms press under touch-action:none is device behaviour,
	// so on engines that drop it the gesture produced nothing at all. A
	// count 1 is what that click would have sent, so core's own hit-testing
	// still decides what selects.
	//
	// Not over an existing selection: the press changes nothing there, and
	// the trailing click keeps its shipped behaviour (a count 1 on a selected
	// shape is ShapeHandlesSection's grammar, not this one's). Read posture
	// is out too -- its long press keeps the shipped right-button path.
	private shouldSelectObjectOnLongPress(): boolean {
		if (!this.isVulcanPhoneImpress()) return false;
		if (!app.map.isEditMode()) return false;
		return !GraphicSelection.hasActiveSelection();
	}

	// The right-button press that makes core send a context menu back. Two
	// callers: the long press (CanvasSectionContainer.startLongPress -> its
	// own onMouseMove (long press active) -> propagateOnContextMenu ->
	// onContextMenu above), where the Writer/Impress edit postures and Calc's
	// own popover door now return before reaching it, and the phone Calc
	// range tap-again menu timer (armVulcanCellMenu). On a small screen
	// Control.ContextMenu routes core's reply into the mobile wizard.
	private postContextMenuDown(
		point: cool.SimplePoint,
		buttons: number,
	): void {
		this.postCoreMouseEvent('buttondown', point, 1, buttons, 0);
	}

	// Transforms a point in document coordinates (twips) into a css-pixel
	// position, either relative to the browser page or within the canvas.
	private _documentToCssPosition(
		pagePosition: cool.SimplePoint,
		browserPage: boolean,
	): cool.PointLike {
		Util.ensureValue(app.activeDocument);
		let docTLx = app.activeDocument.activeLayout.viewedRectangle.pX1;
		let docTLy = app.activeDocument.activeLayout.viewedRectangle.pY1;
		if (app.map.getDocType() === 'spreadsheet') {
			if (app.isXOrdinateInFrozenPane(pagePosition.pX)) {
				docTLx = 0;
			}

			if (app.isYOrdinateInFrozenPane(pagePosition.pY)) {
				docTLy = 0;
			}
		}
		pagePosition.pX -= docTLx - this.containerObject.getDocumentAnchor()[0];
		pagePosition.pY -= docTLy - this.containerObject.getDocumentAnchor()[1];
		if (browserPage) {
			const boundingClientRectangle =
				this.context.canvas.getBoundingClientRect();
			return {
				x: pagePosition.cX + boundingClientRectangle.x,
				y: pagePosition.cY + boundingClientRectangle.y,
			};
		}
		return {
			x: pagePosition.cX,
			y: pagePosition.cY,
		};
	}

	// Gets the mouse position either on browser page or within the
	// canvas in css pixels.
	private _getMousePosition(browserPage: boolean): cool.PointLike {
		return this._documentToCssPosition(
			this.currentPosition.clone(),
			browserPage,
		);
	}

	// Gets the mouse position on browser page in CSS pixels.
	public getMousePagePosition() {
		return this._getMousePosition(true);
	}

	// Gets the mouse position on canvas in CSS pixels.
	public getMouseCanvasPosition() {
		return this._getMousePosition(false);
	}

	// Gets the text caret (Writer, Impress) or active cell (Calc) position on
	// the canvas in css pixels, or null when there is no visible cursor.
	public getCursorCanvasPosition(): cool.PointLike | null {
		let rectangle: cool.SimpleRectangle | null = null;
		if (app.calc.cellCursorVisible) rectangle = app.calc.cellCursorRectangle;
		else if (app.file.textCursor.visible)
			rectangle = app.file.textCursor.rectangle;

		if (!rectangle) return null;

		// Anchor at the bottom-left corner so the menu opens just below the
		// caret or active cell instead of covering it.
		const point = new cool.SimplePoint(rectangle.x1, rectangle.y2);
		return this._documentToCssPosition(point, false);
	}

	// This is useful when a section handles the event but wants to set the document mouse position.
	public setMousePosition(point: cool.SimplePoint) {
		this.currentPosition = point.clone();
	}

	private refreshPosition(point: cool.SimplePoint) {
		Util.ensureValue(app.activeDocument);
		let topLeftX = app.activeDocument.activeLayout.viewedRectangle.pX1;
		let topLeftY = app.activeDocument.activeLayout.viewedRectangle.pY1;

		if (app.map.getDocType() === 'spreadsheet') {
			if (app.isXOrdinateInFrozenPane(point.pX)) topLeftX = 0;

			if (app.isYOrdinateInFrozenPane(point.pY)) topLeftY = 0;
		}

		this.currentPosition.pX = point.pX + topLeftX;
		this.currentPosition.pY = point.pY + topLeftY;
	}

	private setCursorType() {
		const corePointer = app.map._docLayer._coreMousePointer;

		if (app.map._docLayer._docType === 'spreadsheet') {
			// Core asks for a hand cursor over hyperlinks etc. The
			// 'spreadsheet-cursor' class ('cursor: cell !important') would
			// override the inline pointer core sets, so drop the class to let
			// it show.
			if (corePointer === 'pointer') {
				const change =
					this.context.canvas.style.cursor !== 'pointer' ||
					this.context.canvas.classList.contains('spreadsheet-cursor');
				if (change) {
					this.context.canvas.classList.remove('spreadsheet-cursor');
					this.context.canvas.style.cursor = 'pointer';
				}
				return;
			}

			const textCursor =
				app.file.textCursor.visible &&
				app.calc.cellCursorRectangle &&
				app.calc.cellCursorRectangle.pContainsPoint(
					this.currentPosition.pToArray(),
				);

			if (textCursor) {
				const change =
					this.context.canvas.style.cursor !== 'text' ||
					this.context.canvas.classList.contains('spreadsheet-cursor');
				if (change) {
					this.context.canvas.classList.remove('spreadsheet-cursor');
					this.context.canvas.style.cursor = 'text';
				}
			} else {
				const change =
					this.context.canvas.style.cursor !== '' ||
					!this.context.canvas.classList.contains('spreadsheet-cursor');
				if (change) {
					this.context.canvas.style.cursor = '';
					this.context.canvas.classList.add('spreadsheet-cursor');
				}
			}
			return;
		}

		// If the core has set a specific pointer (e.g. 'pointer' for
		// hyperlinks), let it take precedence over our client-side cursor.
		if (corePointer && corePointer !== 'default') return;

		// If we have blinking cursor visible
		// we need to change cursor from default style.
		if (app.file.textCursor.visible) {
			this.context.canvas.style.cursor = 'text';
		} else if (app.map._docLayer._docType === 'presentation') {
			this.context.canvas.style.cursor = '';
		}
	}

	private cancelSwipe() {
		this.inSwipeAction = false;
		this.vulcanFlingActive = false;

		if (this.containerObject.getAnimatingSectionName() === this.name)
			this.containerObject.stopAnimating();

		// The fling is over, whichever way it ended: the decay fell under the
		// 0.2 px threshold, the deck hit its bounds and the viewed rectangle
		// stopped changing, or a finger came back down and stopped it. All
		// three funnel through here, which is why the commit lives here rather
		// than at any one of them. See vulcanCommitGestureEnd.
		this.vulcanCommitGestureEnd();
	}

	/*
	 * Record one finger sample for the phone fling: the CONTAINER's
	 * dragDistance — canvas-local travel since touchstart — never the
	 * per-section `point`.
	 *
	 * C2 established that `point` arrives in the sectionOnMouseDown's frame
	 * and adopted dragDistance for the PAN; the velocity samples stayed on
	 * `point`, and that is the build-#6 frozen-viewport residual. When the
	 * touch starts on a document-anchored section — at zoom>=15 the slide
	 * covers the whole viewport, so on phone Impress that is EVERY pan (the
	 * marquee section ImpressSelectionRectangle owns the touch) — that
	 * section's myTopLeft moves 1:1 opposite the scroll the drag itself
	 * makes. MEASURED (g5c/g5h frozen-viewport traces, Dinosaurs dpr3,
	 * slot-02 build #6): the drag panned viewY 0->703 core px at gear 1.00
	 * while the samples' pY held at 967 for all eight moves and jumped +88
	 * on the release — so velocityFromSamples answered the SCROLL's
	 * velocity, positive, and vY = -fingerY projected a -692 px coast that
	 * un-scrolled the whole drag. Net pan per fling: ~31 px; on the white
	 * top-left of a slide at zoom 15 that reads as a frozen viewport, 6
	 * flings moving nothing, only a pinch-in recovering.
	 *
	 * dragDistance is two convertPositionToCanvasLocale readings against a
	 * rect cached for the gesture; no layout can rewrite it mid-gesture.
	 * Velocity needs only deltas, so travel-since-down measures the same
	 * finger speed the absolute position did, in the same sign convention
	 * (finger up => decreasing y).
	 */
	private pushVulcanTouchSample(dragDistance: Array<number>): void {
		this.vulcanTouchSamples.push({
			x: dragDistance[0],
			y: dragDistance[1],
			t: performance.now(),
		});

		if (this.vulcanTouchSamples.length > MouseControl.vulcanMaxTouchSamples)
			this.vulcanTouchSamples.shift();
	}

	// The scrollable range of the active layout in scroll-origin space:
	// [maxX, maxY], with 0 the other bound of both axes. All three phone
	// scroll layouts clamp their origin to exactly this pair --
	// ViewLayoutCalc.scroll and ViewLayoutFileBased.scroll spell out
	// max(0, viewSize - documentAnchor.size), and the base layout's scrollbar
	// geometry reduces to the same range plus its bottom apron (phone Writer
	// read; 0 everywhere else). Without the apron here a fling
	// would ease to a stop at the old end, short of the layout's own.
	// In a frozen Calc split origin 0 IS
	// the split's inner edge, so easing there never crosses the freeze.
	//
	// Used only to decide WHEN the coast starts easing; the layout's own
	// clamp stays the authority on where scrolling stops, so an estimate that
	// disagrees with it merely ends the coast through the bounds stop below,
	// at ease-tail speed. Substituting null here recovers the dead-stop coast
	// byte for byte: no ease segment is ever created.
	private vulcanFlingEdgeLimits(): number[] | null {
		Util.ensureValue(app.activeDocument);
		const layout = app.activeDocument.activeLayout;
		const anchor = app.sectionContainer.getDocumentAnchorSection();
		if (!anchor) return null;
		return [
			Math.max(0, layout.viewSize.pX - anchor.size[0]),
			Math.max(
				0,
				layout.viewSize.pY + layout.vulcanBottomApronCore() - anchor.size[1],
			),
		];
	}

	// One frame of the projected coast.
	//
	// The position is computed from elapsed time rather than accumulated frame
	// by frame, so the distance travelled is the same on a 60Hz and a 120Hz
	// phone and a dropped frame costs smoothness but not travel:
	//
	//   travelled(t) = D * (1 - rate^t),  D = projectFling(v0, rate)
	//
	// which lands on exactly the projected distance and leaves at the release
	// velocity: d/dt at t=0 is D * -ln(rate), i.e. v0 * 0.999 at rate 0.998.
	//
	// EDGE EASE (Google/iOS parity, the spring-back-only half). A coast whose
	// projection overruns the document edge used to run into the layout clamp
	// at full speed -- the origin froze and the bounds stop below read it as
	// the settle, so the view dead-stopped mid-decay. Now each axis that is
	// provably going to overrun is re-projected, inside the last
	// vulcanFlingEdgeEaseZone CSS px, onto its own segment of the same curve
	// family with the asymptote AT the edge and the initial speed equal to
	// the coast's current speed on that axis:
	//
	//   pos(t) = from + dist * (1 - r^t),  r = e^(-v/dist)
	//
	// (v = -D ln(rate) rate^elapsed, the derivative of the shared curve), so
	// the hand-off keeps both position and velocity and the landing is the
	// segment's own tail. The segment ends ON the edge exactly; there is no
	// visual overshoot anywhere, so the layout scroll position stays the only
	// source of truth and desktop/tablet -- which never reach this method --
	// are untouched.
	private drawVulcanFling(): void {
		Util.ensureValue(app.activeDocument);

		const now = Date.now();
		const elapsed = now - this.swipeTimeStamp;
		const ease = this.vulcanFlingEase;
		const easing =
			(ease[0] !== null && !ease[0].done) ||
			(ease[1] !== null && !ease[1].done);

		// The tail has decayed to vulcanFlingEndVelocity. Stop, instead of
		// creeping on for another second below what the eye reads as motion.
		// An ease segment runs on its own clock, so the shared duration only
		// ends the coast once no segment is still travelling.
		if (elapsed >= this.vulcanFlingDuration && !easing) {
			this.cancelSwipe();
			return;
		}

		const remaining = Math.pow(MouseControl.vulcanFlingDecel, elapsed);
		const layout = app.activeDocument.activeLayout;
		const origin = layout.getScrollOrigin();
		const limits = this.vulcanFlingEdgeLimits();
		const target = [origin[0], origin[1]];

		for (let axis = 0; axis < 2; axis++) {
			const seg = ease[axis];
			if (seg) {
				// The segment owns this axis to the end of the gesture. Past
				// its duration it answers the edge itself, exactly, every
				// frame -- which is what makes the settle position the clamp
				// with no residual.
				const segElapsed = now - seg.t0;
				if (segElapsed >= seg.duration) {
					target[axis] = seg.edge;
					seg.done = true;
				} else {
					target[axis] =
						seg.from +
						(seg.edge - seg.from) * (1 - Math.pow(seg.rate, segElapsed));
				}
				continue;
			}

			const delta =
				this.vulcanFlingTarget[axis] * (1 - remaining) -
				this.vulcanFlingTravelled[axis];
			this.vulcanFlingTravelled[axis] += delta;
			target[axis] = origin[axis] + delta;

			// Does the rest of this axis's projection fit inside the
			// document? While it does, the natural decay is the ease.
			if (!limits) continue;
			const dir = Math.sign(this.vulcanFlingTarget[axis]);
			if (dir === 0) continue;
			const edge = dir > 0 ? limits[axis] : 0;
			const distToEdge = dir * (edge - target[axis]);
			const remainingTravel =
				dir * (this.vulcanFlingTarget[axis] - this.vulcanFlingTravelled[axis]);
			if (remainingTravel <= distToEdge) continue;
			if (distToEdge > MouseControl.vulcanFlingEdgeEaseZone * app.dpiScale)
				continue;

			// Too close to shape a curve in (a hard flick released at the
			// edge): pin at the edge outright. The clamp would have done the
			// same one write later.
			if (distToEdge <= 1) {
				target[axis] = edge;
				ease[axis] = {
					t0: now,
					from: edge,
					edge: edge,
					rate: MouseControl.vulcanFlingDecel,
					duration: 0,
					done: true,
				};
				continue;
			}

			const v =
				-Math.log(MouseControl.vulcanFlingDecel) *
				Math.abs(this.vulcanFlingTarget[axis]) *
				remaining;
			const vEnd = MouseControl.vulcanFlingEndVelocity * 0.001 * app.dpiScale;
			const rate = Math.exp(-v / distToEdge);
			ease[axis] = {
				t0: now,
				from: target[axis],
				edge: edge,
				rate: rate,
				duration: v > vEnd ? Math.log(vEnd / v) / Math.log(rate) : 0,
				done: false,
			};
		}

		layout.scrollTo(target[0], target[1]);
		// Free scroll, the fling half: arm the ONE gesture-end commit
		// (VulcanImpressPartCommit). Both settles of this coast -- the decay
		// above and the bounds stop below -- funnel through cancelSwipe,
		// which commits; so does a finger that stops it (onMouseDown).
		this.vulcanArmGestureCommit();
		app.sectionContainer.requestReDraw();

		// Ran into the end of the document: the clamp in the layout's scroll
		// refused the move, so there is nothing left to coast into.
		//
		// Asked of the scroll origin, not of the viewed rectangle. On a
		// stacked layout that rectangle is the bounding box of the VISIBLE
		// PAGES, so it reads "unchanged" for every frame that stays inside the
		// same page -- which on a phone deck is most of them, and stopped a
		// coast that was still travelling within its second frame.
		const moved = layout.getScrollOrigin();
		if (
			this.previousScrollOrigin &&
			moved[0] === this.previousScrollOrigin[0] &&
			moved[1] === this.previousScrollOrigin[1]
		) {
			this.cancelSwipe();
			return;
		}

		this.previousScrollOrigin = moved;
	}

	onDraw(frameCount?: number, elapsedTime?: number): void {
		// The phone coast is projected from a measured release velocity and
		// settles on a SPEED; upstream's curve below is an exponential on net
		// displacement that settles on a per-frame delta. They share only
		// inSwipeAction and the scroll call, so they are separate branches
		// rather than one parameterised curve.
		if (this.vulcanFlingActive) {
			if (this.inSwipeAction) this.drawVulcanFling();
			return;
		}

		if (this.inSwipeAction) {
			const elapsed = Date.now() - this.swipeTimeStamp;
			const delta = [
				this.amplitude[0] * Math.exp(-elapsed / 650),
				this.amplitude[1] * Math.exp(-elapsed / 650),
			];

			Util.ensureValue(app.activeDocument);

			if (Math.abs(delta[0]) > 0.2 || Math.abs(delta[1]) > 0.2) {
				const origin = app.activeDocument.activeLayout.getScrollOrigin();
				app.activeDocument.activeLayout.scrollTo(
					origin[0] + delta[0],
					origin[1] + delta[1],
				);
				// No arm here any more: the deck's read posture rides
				// drawVulcanFling, which owns the fling half of the arm, and
				// every surface that still reaches this coast fails
				// vulcanArmGestureCommit's gates.
				app.sectionContainer.requestReDraw();

				const moved = app.activeDocument.activeLayout.getScrollOrigin();
				if (
					this.previousScrollOrigin &&
					moved[0] === this.previousScrollOrigin[0] &&
					moved[1] === this.previousScrollOrigin[1]
				)
					this.cancelSwipe();

				this.previousScrollOrigin = moved;
			} else this.cancelSwipe();
		}
	}

	// Comment from original author:
	/*
		Code and maths for the ergonomic scrolling is inspired by formulas at
		https://ariya.io/2013/11/javascript-kinetic-scrolling-part-2
		Some constants are changed based on the testing/experimenting/trial-error
	*/
	private swipe(e: any): void {
		this.previousScrollOrigin = null;

		const velocityX = app.map._docLayer.isCalcRTL()
			? -e.velocityX
			: e.velocityX;
		const pointVelocity = [velocityX, e.velocityY];

		if (this.inSwipeAction) {
			this.swipeVelocity[0] += pointVelocity[0];
			this.swipeVelocity[1] += pointVelocity[1];
		} else {
			this.swipeVelocity = pointVelocity;
			this.inSwipeAction = true;
		}

		this.amplitude = [this.swipeVelocity[0] * 0.1, this.swipeVelocity[1] * 0.1];
		this.swipeTimeStamp = Date.now();

		const animatingSection = this.containerObject.getAnimatingSectionName();

		if (!animatingSection) this.startAnimating({ defer: true });

		app.idleHandler.notifyActive();
	}

	// Begin a projected coast from a measured release velocity, core px/ms.
	//
	// Unlike swipe() this does NOT accumulate: a second fling replaces the
	// first outright. Accumulating made sense only while "velocity" was really
	// net displacement, when repeating the flick was the only way to build
	// speed. Adding two measured release velocities together describes no
	// gesture anybody made -- and it was actively harmful, because a quick
	// touch meant as a brake reached swipe() and sped the coast up. The phone
	// never reaches swipe() now, so the accumulation above stays exactly as it
	// is for the tablets that still take that path.
	private startVulcanFling(vX: number, vY: number): void {
		this.previousScrollOrigin = null;
		this.vulcanFlingEase = [null, null];

		const rate = MouseControl.vulcanFlingDecel;
		this.vulcanFlingTarget = [
			MouseControl.projectFling(vX, rate),
			MouseControl.projectFling(vY, rate),
		];
		this.vulcanFlingTravelled = [0, 0];

		// v(t) = v0 * rate^t, so the tail reaches the end speed at
		// t = ln(vEnd / v0) / ln(rate). Terminating on a speed instead of on a
		// per-frame delta is what removes the 4 CSS px/s crawl.
		const v0 = Math.hypot(vX, vY);
		const vEnd = MouseControl.vulcanFlingEndVelocity * 0.001 * app.dpiScale;
		this.vulcanFlingDuration =
			v0 > vEnd ? Math.log(vEnd / v0) / Math.log(rate) : 0;

		this.vulcanFlingActive = true;
		this.inSwipeAction = true;
		this.swipeTimeStamp = Date.now();

		const animatingSection = this.containerObject.getAnimatingSectionName();

		if (!animatingSection) this.startAnimating({ defer: true });

		app.idleHandler.notifyActive();
	}

	// The phone fling. Replaces upstream's gate -- `timeDiff < 200` over a NET
	// displacement -- with a real release velocity:
	//
	//  * a 400ms half-screen drag could not coast AT ALL, because the whole
	//    gesture had to finish inside 200ms;
	//  * an out-and-back netting +10px flung the +10px direction, because the
	//    "velocity" was start-minus-end across the whole gesture.
	//
	// Sampling starts only once CanvasSectionContainer has latched the drag,
	// which on phones now needs 8 CSS px of slop, so a gesture too small to be
	// a drag has no samples and can never fling.
	//
	// Returns true when a coast was started, i.e. when this finger-up was a
	// flick rather than something the tap grammar should see.
	private vulcanFling(): boolean {
		// The release is itself a sample. Without it, a finger that travelled
		// fast, stopped, and lifted a beat later would fling on the stale
		// window rather than on the standstill it actually ended in. It is
		// the container's whole-gesture travel at release — the same
		// canvas-local frame every other sample is in; the per-section up
		// point carried the section-frame drift that inverted the coast
		// (see pushVulcanTouchSample). typeof-guarded because the mocha rigs
		// drive this path with minimal containers, which must read as "no
		// release sample", not throw.
		const releaseTravel =
			typeof (this.containerObject as any).getReleaseDragDistance ===
			'function'
				? this.containerObject.getReleaseDragDistance()
				: null;
		if (releaseTravel) this.pushVulcanTouchSample(releaseTravel);

		const samples = this.vulcanTouchSamples;
		const fingerX = MouseControl.velocityFromSamples(samples, 'x');
		const fingerY = MouseControl.velocityFromSamples(samples, 'y');
		this.vulcanTouchSamples = [];

		// The view travels opposite the finger, and RTL Calc mirrors x -- both
		// exactly as swipe() does for the upstream path, where velocityX is
		// (start - end) and is negated again when isCalcRTL().
		let vX = app.map._docLayer.isCalcRTL() ? fingerX : -fingerX;
		let vY = -fingerY;

		const speed = Math.hypot(vX, vY);
		if (!(speed >= MouseControl.vulcanFlingMinVelocity * app.dpiScale))
			return false;

		const maxSpeed = MouseControl.vulcanFlingMaxVelocity * app.dpiScale;
		if (speed > maxSpeed) {
			vX *= maxSpeed / speed;
			vY *= maxSpeed / speed;
		}

		this.startVulcanFling(vX, vY);
		return true;
	}

	// Whether a latched drag outranks the multi-click deferral that is still
	// pending -- see the long note in onMouseMove. Named rather than inlined so
	// the suite can substitute `false` and run the pre-fix gate, byte for byte,
	// out of this same file as its known positive.
	private vulcanDragOutranksPendingClick(): boolean {
		return this.containerObject.isDraggingSomething();
	}

	public onMouseMove(
		point: cool.SimplePoint,
		dragDistance: Array<number>,
		e: MouseEvent,
	): void {
		// Update the position first so the cursor type is computed for the
		// current mouse location.
		this.refreshPosition(point);

		// Cursor style is meaningless under a finger, and the style write
		// forces the next layout read mid-pan.
		if (e.type !== 'touchmove') this.setCursorType();

		/*
			C6 -- SWALLOW-THEN-BURST. A pending multi-click must not freeze the
			view.

			`if (this.clickTimer) return` used to be unconditional, and
			clickTimer is armed by EVERY tap for multiClickWindow (250 ms) so
			that a second tap can be upgraded to a double. Nothing clears it
			early on the Calc path: not a mousedown, not a touchstart, not the
			drag latch. So the very ordinary phone sequence

			    tap a cell -> swipe to scroll

			had every touchmove in the first 250 ms of the swipe dropped on this
			line. The finger moved and the sheet did not. Then the timer fired,
			the next touchmove was processed, and because the pan below is an
			ABSOLUTE map off the gesture anchor it landed the whole swallowed
			travel in ONE frame: input swallowed, then delivered as a burst.
			That is the smoothness defect an acceptance run saw on 6 gestures
			and had to exclude from its averages -- the burst is not a
			measuring artifact, it is this return.

			A DRAG ENDS THE MULTI-CLICK RUN. Once the container has latched a
			drag, no later click can join this run: the container suppresses the
			click that follows a drag (CanvasSectionContainer.onClick, gated on
			!draggingSomething). Waiting out the rest of the window therefore
			buys nothing and costs a quarter second of dead input, so flush the
			deferral and carry on.

			FLUSHING IS NOT DROPPING. flushPendingClick sends the deferred
			count 2 (or 3) immediately; at count 1 it sends nothing, because the
			first click of a run always went out at onClick. It also puts that
			click BEFORE the drag's own buttondown, which is the order the user
			performed them -- the timer would otherwise have delivered a double
			click into the MIDDLE of the drag.

			AT THE LATCH, NOT AT THE PRESS. This cannot be done at touchstart
			instead: at press time the gesture may still turn out to be the
			second tap of a double tap, and cancelling the run there would
			delete the double click. The latch is the first moment the gesture
			is known not to be a tap.

			The hover half is untouched: a move with no drag still returns here,
			so the core mouse-move posts this gate was written to keep out of a
			multi-click run stay out of it.
		*/
		if (this.clickTimer) {
			if (!this.vulcanDragOutranksPendingClick()) return;
			this.flushPendingClick();
		}

		clearTimeout(this.mouseMoveTimer);

		const count = 1;
		const modifier = MouseControl.readModifier(e);

		if (!this.containerObject.isDraggingSomething()) {
			this.mouseMoveTimer = setTimeout(() => {
				this.postCoreMouseEvent(
					'move',
					this.currentPosition,
					count,
					0,
					modifier,
				);
			}, 100);
		} else if (
			e.type === 'touchmove' &&
			this.positionOnMouseDown &&
			!this.vulcanDragSelectsRange()
		) {
			// For non-touch events, we can select text etc, so we send the mouse button events to core while dragging.
			// Users can scroll the view using keyboard or mouse wheel, or the scroll bars in those devices.
			// On touch devices, dragging (touchmove) is used to scroll the view.
			// We don't send the mouse button down and up events to core while dragging (touchmove). Instead, we scroll the view.

			// The velocity sample is the container's dragDistance, for the
			// same reason the pan below is (C2): `point` is in the
			// sectionOnMouseDown's frame, which on a document-anchored
			// section moves opposite this drag's own scroll — sampled there,
			// the fling measured the scroll instead of the finger and
			// coasted the drag back out (the build-#6 frozen-viewport
			// residual; see pushVulcanTouchSample). dragDistance is absent
			// only for synthesised events, which also cannot fling.
			if (this.isVulcanPhoneScroll() && dragDistance)
				this.pushVulcanTouchSample(dragDistance);
			// Phone Impress EDIT samples too, for the turn law's flick leg
			// (VulcanImpressEditCarousel.isSwipeShaped, at fit and zoomed): the
			// deck's edit posture is not a fling surface (isVulcanPhoneScroll
			// is the read posture's), so before this its release speed read 0
			// on the device and a flick could never turn a slide. Nothing here
			// starts a fling: vulcanFling() stays behind isVulcanPhoneScroll.
			else if (
				dragDistance &&
				this.isVulcanPhoneImpress() &&
				!app.file.fileBasedView
			)
				this.pushVulcanTouchSample(dragDistance);

			Util.ensureValue(app.activeDocument);

			/*
				C1 — pan gearing. Measure the pan in CANVAS-LOCAL px against
				the anchor this gesture started from, never in document px
				against the live viewed rectangle.

				The form this replaced was

				    diff       = currentPosition - positionOnMouseDown
				    scrollTo(viewedRectangle.pX1 - diff.pX, ...)

				where currentPosition is the DOCUMENT position of the finger,
				rebuilt every move by refreshPosition(). Off a split that
				expands to viewX(n) + localX(n), the viewX(n) terms cancel
				against the viewedRectangle.pX1 the target is measured from,
				and what survives is

				    target = viewX(0) - (localX(n) - localX(0))

				which is absolute: the same finger travel gives the same view,
				at any event count. Gear 1.00, and that is why the un-split
				sheet always measured 1.00.

				The cancellation is what a frozen pane breaks.
				refreshPosition() drops the viewX term for a finger inside the
				frozen pane -- correctly, because a frozen pane does not
				scroll, so there the document x IS the screen x. But then

				    target = viewX(n) - localX(n) + localX(0) + viewX(0)

				still names viewX(n), so every touchmove adds
				(viewX(0) + localX(0) - localX(n)) to a view that already
				moved by it. The travel becomes proportional to the number of
				events the browser happened to deliver, which is why a SLOWER
				drag went FURTHER: 250 px of finger scrolled 1,899 px over
				200 ms and 5,361 px over 800 ms on a sheet frozen at column A,
				and exactly 250 px on an unfrozen one. A left-swipe on a 393 px
				phone sweeps the finger across a frozen column A near the end
				of its travel, so this fires on ordinary panning.

				`point` is canvas-local and has no document mapping to lose, so
				the anchored form below holds gear 1.00 on both sheet kinds and
				at every event count. It is algebraically identical to the old
				expression wherever refreshPosition() did not remap -- i.e.
				every Writer and Impress pan, and every Calc pan clear of a
				frozen pane -- so this is a Calc-split fix, not a re-gearing of
				the pan everyone else already has.

				C2 -- and the finger travel is the CONTAINER's dragDistance,
				not a subtraction of two `point`s.

				`point` is canvas-local MINUS this section's myTopLeft, and
				myTopLeft is not stationary on every layout. MEASURED on phone
				Impress (ViewLayoutFileBased), one finger held at the same
				screen position while the deck sat at different offsets: the
				`point` this method receives carries an extra
				(viewY - viewedRectangle.pY1) -- 0 px at the top of the deck,
				482 px a slide and a half in, tracking that difference exactly
				across six offsets.

				That term moves DURING the gesture, because viewY moves and
				viewedRectangle.pY1 only steps when a slide leaves the screen,
				so `point - anchorPoint` is not the finger travel: it is the
				finger travel minus however far this pan has already scrolled
				within the current slide. Feeding that back into the scroll
				position halves the gearing and makes the view judder -- the
				measured series alternated forward 122 px, back 67 px, forward
				122, for a deck that should have tracked the finger.

				dragDistance is built by CanvasSectionContainer.onTouchMove
				from two convertPositionToCanvasLocale readings -- clientY
				minus the canvas rect, nothing else -- so no layout can rewrite
				it mid-gesture. Where myTopLeft does hold still the two forms
				are the same number, which is every surface the C1 measurements
				above were taken on.
			*/
			const anchor = this.vulcanPanAnchor;

			// Use scrollTo, or repeating events break the scrolling.
			// CanvasSectionContainer.onTouchMove always supplies dragDistance,
			// so the fallback is for synthesised events only.
			if (anchor && dragDistance) {
				app.activeDocument.activeLayout.scrollTo(
					anchor[0] - dragDistance[0],
					anchor[1] - dragDistance[1],
				);
			} else {
				// No touchstart was seen for this gesture (a synthesised
				// touchmove). Keep the historical behaviour rather than
				// silently refusing to pan.
				const diff = this.currentPosition.clone();
				diff.x -= this.positionOnMouseDown.x;
				diff.y -= this.positionOnMouseDown.y;

				const origin = app.activeDocument.activeLayout.getScrollOrigin();

				app.activeDocument.activeLayout.scrollTo(
					origin[0] - diff.pX,
					origin[1] - diff.pY,
				);
			}
			// A leg of the drag that goes past the tap slop further sideways than
			// up or down is the reader choosing this horizontal view. scrollTo
			// moves both axes, so a vertical swipe's wobble moves the view too
			// and is not a choice: a leg that went further up or down starts the
			// next leg where it ended, so drift never adds up across a swipe,
			// its way back up, or its one-pixel steps, and a sideways leg after
			// a swipe down still counts. Such legs still count toward a diagonal
			// pan: their sideways travel one way, less a quarter of their travel
			// up or down, and past two tap slops it is the same choice. A
			// drift shallower than one in four, or a turn back the other way,
			// wears it down.
			const panned = app.activeDocument.activeLayout;
			if (panned instanceof ViewLayoutWriter && dragDistance) {
				const slop = MouseControl.tapSlop * app.dpiScale;
				const dx = dragDistance[0] - this.vulcanLegX;
				const dy = dragDistance[1] - this.vulcanLegY;
				if (Math.max(Math.abs(dx), Math.abs(dy)) > slop) {
					if (Math.abs(dx) > Math.abs(dy)) {
						panned.vulcanHorizontalTouchPan();
					} else {
						this.vulcanDiagonalLeft = Math.max(0, this.vulcanDiagonalLeft - dx - Math.abs(dy) / 4);
						this.vulcanDiagonalRight = Math.max(0, this.vulcanDiagonalRight + dx - Math.abs(dy) / 4);
						if (Math.max(this.vulcanDiagonalLeft, this.vulcanDiagonalRight) > 2 * slop)
							panned.vulcanHorizontalTouchPan();
						this.vulcanLegX = dragDistance[0];
						this.vulcanLegY = dragDistance[1];
					}
				}
			}
			// Free scroll, the drag half: arm the ONE gesture-end commit. Same
			// replacement as the fling half in onDraw, same reason.
			this.vulcanArmGestureCommit();
		} else {
			this.lastDragLocalPoint = point.clone();
			this.lastDragModifier = modifier;

			// A press the select echo owns (vector Impress: a modifier-less
			// press on an object outside the selection) is selected by
			// ordinal and moved by position from there — no raw
			// buttondown/move/buttonup reaches core for it, so core's own
			// hit-test can never turn the drag into a rubber band or a
			// text selection. Autoscroll below is the client's and stays.
			const owned = VulcanImpressSelectEcho.ownsPress();

			if (!this.mouseDownSent && this.positionOnMouseDown && !owned) {
				this.postCoreMouseEvent(
					'buttondown',
					this.positionOnMouseDown,
					count,
					app.LOButtons.left,
					modifier,
				);
				this.mouseDownSent = true;
			}

			if (!this.containerObject.isMouseInside()) {
				point.pX += this.position[0];
				point.pY += this.position[1];
				app.map.fire('handleautoscroll', {
					pos: { x: point.cX, y: point.cY },
					map: app.map,
				});
			} else app.map.fire('scrollvelocity', { vx: 0, vy: 0 });

			if (!owned) {
				this.postCoreMouseEvent(
					'move',
					this.currentPosition,
					count,
					app.LOButtons.left,
					modifier,
				);

				this.showShapeDragPreview(dragDistance);
			}
		}

		app.idleHandler.notifyActive();
	}

	// Shows unselected shapes drag preview
	private showShapeDragPreview(dragDistance: number[]): void {
		// Do not show in edit mode of inner edit engine
		if (app.file.textCursor.visible || TextSelections.isActive()) return;

		// The vector path translates the object's own content with the
		// drag (VectorContentSection._getDragOverride) — the raster SVG
		// preview on top of that would be a second moving copy.
		if (RenderManager.isVectorRendering()) return;

		const handles = GraphicSelection.handlesSection;
		if (!handles?.sectionProperties?.svg) return;
		if (handles?.sectionProperties?.hasVideo) return;
		if (!GraphicSelection.extraInfo?.isDraggable) return;

		handles.sectionProperties.svg.style.left =
			String((handles.myTopLeft[0] + dragDistance[0]) / app.dpiScale) + 'px';
		handles.sectionProperties.svg.style.top =
			String((handles.myTopLeft[1] + dragDistance[1]) / app.dpiScale) + 'px';
		handles.sectionProperties.svg.style.opacity = '1';
		handles.showSVG();
	}

	private hideShapeDragPreview(): void {
		const handles = GraphicSelection.handlesSection;
		if (!handles?.sectionProperties?.svg) return;

		handles.sectionProperties.svg.style.opacity = '1';
		handles.hideSVG();
	}

	// Called whenever the document scrolls or pans. During a button-down drag
	// the mouse can stay still while the view moves, so the mouse now points at
	// a different document position. Recompute that position from the unchanged
	// screen point and re-send the drag move so the selection follows the view.
	public onNewDocumentTopLeft(): void {
		// The read-posture bar is positioned against the viewport, not against
		// the document, so it would hang over a slide that has scrolled away.
		// Scrolling the deck is therefore one of its dismissals.
		if (this.vulcanBarShown) {
			this.vulcanTapGrammar.reset();
			const bar = (app.map as any).vulcanSlideReadBar;
			if (bar) bar.hide();
			this.vulcanBarShown = false;
		}

		if (!this.mouseDownSent || !this.lastDragLocalPoint) return;

		this.refreshPosition(this.lastDragLocalPoint);

		this.postCoreMouseEvent(
			'move',
			this.currentPosition,
			1,
			app.LOButtons.left,
			this.lastDragModifier,
		);
	}

	onMouseDown(point: cool.SimplePoint, e: MouseEvent): void {
		this.refreshPosition(point);
		this.positionOnMouseDown = this.currentPosition.clone();

		if (e.type === 'touchstart') {
			// For swipe action. Core px, not a clone — see the field comment.
			this.localPositionOnMouseDown = [point.pX, point.pY];

			// C1 — the pan anchor. Captured here, and only here, so the pan in
			// onMouseMove can be an absolute map off the gesture's start
			// instead of a per-event increment on the live view. Stored raw
			// rather than as a rectangle+point pair because it is read on
			// every touchmove and must not allocate.
			//
			// ensureValue before the dereference, matching this file's own
			// convention (see :369, :505, :574). The differential gate in
			// scripts/ci/check-vulcan-office-browser.sh compiles with the
			// ordinary tsconfig and passes without it; the IMAGE build runs a
			// second, stricter pass (Makefile `tsc-strict`, 353 files) where
			// the same two lines are TS18047 "possibly null" and fail the
			// build.
			Util.ensureValue(app.activeDocument);
			this.vulcanPanAnchor =
				app.activeDocument.activeLayout.getScrollOrigin();
			this.vulcanLegX = 0;
			this.vulcanLegY = 0;
			this.vulcanDiagonalLeft = 0;
			this.vulcanDiagonalRight = 0;

			this.touchstart = Date.now();
			// A new gesture measures its own velocity; nothing from the last
			// one may leak into it.
			this.vulcanTouchSamples = [];

			// Planting a finger arrests a coast, on touchDOWN. Two arrest
			// paths existed before this and neither covers the common case:
			// onMultiTouchStart stops the coast only for a SECOND finger, and
			// the onMouseUp branch below only fires when the finger LIFTS, so
			// content kept sliding under a planted finger for the whole hold.
			// Worse, a quick (<200ms) touch travelling >5px meant as a brake
			// instead reached swipe(), which ACCUMULATES into swipeVelocity --
			// so trying to stop a coast sped it up. Phone Calc and phone
			// Writer, matching the rest of this grammar (isVulcanPhoneScroll);
			// every other platform keeps the lift-only behaviour byte for
			// byte.
			if (this.inSwipeAction && this.isVulcanPhoneScroll())
				this.cancelSwipe();

			// A new gesture: whatever the previous one replayed is finished
			// with. Cleared here rather than on the click so a replay whose
			// click never arrives -- the normal case -- cannot leave the latch
			// set and eat the next gesture's click.
			this.vulcanTapReplayed = false;

			// Same reasoning for the long-press latch, and the same reason to
			// clear it here rather than on the click: on the devices that
			// synthesise no click after a long press, nothing else would.
			// Ordering is safe -- CanvasSectionContainer.onTouchStart arms the
			// long press before it propagates this event, and the timer cannot
			// fire for another 500ms.
			this.vulcanLongPressFired = false;
			this.vulcanLongPressServed = false;

			// A real finger-down means any edit-entry gesture is over: the
			// trailing click the entry could have synthesised would have been
			// dispatched before a new touch could begin. Clearing here, like
			// the two latches above, is what guarantees the guard can never
			// eat a genuine tap's click on any engine.
			this.vulcanImpressEditEntryClickGuard = false;

			// ROUND-10 S3, the drag rule's carrier. Sampled BEFORE
			// onVulcanTouchDown, which raises the keyboard on the second
			// finger-down of a double tap and would otherwise make this read
			// the mode the gesture is about to create rather than the one it
			// began in.
			this.vulcanGestureOriginMode = this.vulcanCalcModeNow();

			// ROUND-11 C2, the same reasoning one field over: the selection this
			// gesture came down on, sampled before onVulcanTouchDown and before
			// any click of this gesture can reach core.
			this.vulcanSampleSelectionAtGestureStart();

			this.onVulcanTouchDown();
		}
	}

	onMouseUp(point: cool.SimplePoint, e: MouseEvent): void {
		this.refreshPosition(point);

		this.hideShapeDragPreview();

		if (this.mouseDownSent) {
			// The drop commits a move: count it so speculative holds can
			// retire against trees tagged at-or-after it (a response to a
			// request sent BEFORE the drop must not retire the hold with
			// a pre-move tree - adversarial review #8).
			RenderManager.noteMutatingInputSent();
			this.postCoreMouseEvent(
				'buttonup',
				this.currentPosition,
				1,
				app.LOButtons.left,
				MouseControl.readModifier(e),
			);

			// S3 T-B's second half, and it must follow the buttonup: the range
			// is core's to commit, and only then does the mode come back down
			// to sheet edit.
			this.vulcanEndDragSelectSession();

			app.map.fire('scrollvelocity', { vx: 0, vy: 0 });
		} else if (e.type === 'touchend' && this.localPositionOnMouseDown) {
			// For swipe action. Built from the CORE PIXEL travel so that a zoom
			// landing between touchstart and touchend cannot rewrite it (see
			// the localPositionOnMouseDown field comment). `.cX`/`.cY` are the
			// CSS px travel and `.pX`/`.pY` the core px travel exactly as
			// before, so every consumer below is unchanged.
			const diff = cool.SimplePoint.fromCorePixels([
				this.localPositionOnMouseDown[0] - point.pX,
				this.localPositionOnMouseDown[1] - point.pY,
			]);
			const timeDiff = Date.now() - this.touchstart;

			/*
				I2 — A GESTURE THE TAP GRAMMAR ACCEPTS IS NEVER A SWIPE.

				MEASURED, driving this method with its real body: at every dwell
				under 200 ms — which is where ordinary taps live — a tap that
				drifted 6 to 10 CSS px reached `swipe()` and never reached the
				tap grammar at all. So the effective tap slop on a phone was 5
				CSS px, not the 10 this class declares, and not the 8 the
				container latches at. Three thresholds, one gesture, and the
				smallest one silently won.

				What the user got in that band was not "nothing". Below the
				container's 8 px latch the browser click still arrived, so
				onClick sent a lone count 1 — which in a deck is "select the
				object". That is the reported I2 symptom exactly: you tap the
				words and the shape gets a selection box instead of a caret.
				Between 8 and 10 px the container had latched and dropped the
				click too, so the tap vanished outright. Both bands also fed
				`swipe()` a 6-10 px "velocity", nudging the deck under the
				finger for good measure.

				The fix is not a new threshold, it is the removal of one: under
				the phone chrome the swipe test may no longer claim a gesture
				that isVulcanTapTravel() calls a tap. Upstream's 5 px is kept
				for everything else, so desktop and tablet are byte-identical,
				and a real flick — which travels far more than 10 px — is
				untouched. Nothing is lost by declining the 6-10 px "flick":
				swipe() turns net displacement into `amplitude = 0.1 *`, i.e.
				under two core px of coast.
			*/
			const tapTravel = this.isVulcanPhone() && this.isVulcanTapTravel(diff);
			const isSwipe =
				timeDiff < 200 &&
				(Math.abs(diff.cX) > 5 || Math.abs(diff.cY) > 5) &&
				!tapTravel;

			let swiped = false;
			// R6-6 — the edit-posture carousel turn, decided BEFORE the
			// kinetic branches: at fit zoom the layout has no scroll range,
			// so the only thing a horizontal swipe can mean there is
			// "next/previous slide", and a turned gesture must not also
			// coast or tap. One narrow call; the WHEN lives in
			// VulcanImpressEditCarousel (see vulcanImpressEditSwipeTurn).
			if (this.vulcanImpressEditSwipeTurn(diff)) {
				swiped = true;
				if (this.inSwipeAction) this.cancelSwipe();
			} else if (this.isVulcanPhoneScroll()) {
				// A phone page measures the release velocity instead of
				// reading the gesture's net displacement as if it were one.
				// Substitute this gate false and the upstream expression below
				// is what runs, unchanged, for desktop, tablet and the phone
				// deck.
				swiped = this.vulcanFling();
				if (!swiped && this.inSwipeAction) this.cancelSwipe();
			} else if (isSwipe) {
				this.swipe({ velocityX: diff.pX, velocityY: diff.pY });
				swiped = true;
			} else if (this.inSwipeAction) this.cancelSwipe();

			// A flick is not a tap; every other finger-up inside the phone
			// chrome is offered to the tap grammar, whatever the document is.
			if (!swiped && this.isVulcanPhone())
				this.onVulcanDocumentTapEnd(point, diff, timeDiff, e);

			// (d) Gesture end. A touchend that BECAME a fling is not an end:
			// the deck is still moving and the commit belongs at the settle,
			// which cancelSwipe reaches. A touchend that stopped a fling has
			// already committed inside cancelSwipe above and this call is a
			// disarmed no-op; a plain drag-and-lift commits here.
			if (!swiped) this.vulcanCommitGestureEnd();

			this.localPositionOnMouseDown = null;

			// A finger that neither flicked the deck nor wandered is a tap.
			// This is decided here, on touchend, and never from onClick: the
			// container's shared phone latch is 8 CSS px and then it swallows
			// the click. Decide the read-posture tap on this touch path so the
			// threshold itself does not make delivery browser-dependent.
			//
			// I2 — this used to carry its own pair of thresholds, `<= 8` CSS px
			// and `< 500` ms, which made the read posture the STRICTEST of the
			// three tap tests in this one method: measured, a 9 px tap raised
			// the slide bar at no dwell at all. It now asks the same two
			// questions the edit-posture tap asks, so "what counts as a tap"
			// has one answer on this surface instead of three. onVulcanTapEnd
			// early-returns off phone Impress, so this reaches no other
			// document type.
			if (
				!swiped &&
				!this.vulcanLongPressServed &&
				this.isVulcanTapTravel(diff)
			)
				this.onVulcanTapEnd();
		}

		this.positionOnMouseDown = null;
		this.mouseDownSent = false;
		this.lastDragLocalPoint = null;
		// Hygiene only: the pan branch is gated on positionOnMouseDown, which
		// every mousedown re-sets, and every touchstart overwrites the anchor
		// before it can be read. A touchcancel never reaches this method
		// (CanvasSectionContainer.onTouchCancel propagates nothing for a
		// single finger), so a stale anchor must not be able to matter -- and
		// it cannot.
		this.vulcanPanAnchor = null;

		if (this.containerObject.isDraggingSomething()) {
			// A drag-release during a LIVE phone-Calc cell edit re-acquires:
			// the stock bare focus() runs TextInput._setAcceptInput(false) +
			// blur on an onscreen-keyboard device while core's edit stays
			// live, so momentum keystrokes land on <body>, are silently
			// discarded, and the typed prefix force-commits later (R7 hunt
			// #7/#17). In-gesture focus(true) is honoured on iOS; Sheets
			// grammar keeps the edit and its keyboard through a pan. The
			// liveness signal is the synchronous fx marker class — every exit
			// removes it, so a post-commit release takes the stock arm.
			if (
				this.isVulcanPhoneCalc() &&
				document.documentElement.classList.contains(
					'vulcan-formula-editing',
				)
			)
				app.map.focus(true);
			else app.map.focus();
		}
	}

	/*
		Phone Impress read posture (Google Slides parity).

		Slides opens a deck on a phone to READ, and answers a tap accordingly:
		"Tapping a slide does NOT enter editing - it raises a small contextual
		bar offering 'Edit slide', 'Add comment', and 'View comment'.
		Double-tapping a slide is the shortcut straight into edit mode."

		The methods below are that grammar, and every branch is gated to phone
		Impress. They share the phone-wide drag latch and leave the browser click
		path alone; the read-posture action is additive on touchend.
	*/

	// Phone Impress only: a small screen, the phone chrome class global.js
	// stamps pre-paint, and a presentation. window.mode.isTablet() is DEFINED
	// as !isSmallScreenDevice(), so tablets are excluded by construction, and
	// desktop fails both of the first two tests.
	private isVulcanPhoneImpress(): boolean {
		return (
			(<any>window).mode.isSmallScreenDevice() &&
			document.documentElement.classList.contains('vulcan-mobile-chrome') &&
			!!app.map._docLayer &&
			app.map._docLayer._docType === 'presentation'
		);
	}

	/*
		Called by Permission.js _enterEditMode on every entry into edit mode.
		Phone Impress only, and the gate lives HERE so the caller stays a
		one-liner: the read-posture entry doors ('Edit slide' / 'Add comment'
		on the read bar, the canvas double tap) are Impress grammar, and they
		are the doors whose gesture trails a browser-synthesised click into
		the freshly editable session (see vulcanImpressEditEntryClickGuard).
		Writer's pencil FAB acts on the click itself -- the LAST event of the
		browser's synthesis chain -- so it has no trailer and is deliberately
		not covered.
	*/
	public vulcanArmImpressEditEntryClickGuard(): void {
		if (!this.isVulcanPhoneImpress()) return;
		this.vulcanImpressEditEntryClickGuard = true;
	}

	/*
		FREE SCROLL DOES NOT DECIDE WHICH SLIDE YOU ARE ON.

		This block replaces one that argued the opposite, at the same length and
		with the same care, from a premise that turned out to be false. That
		block's own header already carried the correction and said the code was
		still to follow (spec steps P5-P7); this is the code catching up, so the
		reasoning is restated here in full rather than left as a diff.

		WHAT THE OLD BLOCK ARGUED, reconstructed so the next reader does not
		re-derive it: it quoted parity-work/google-slides.json feature 27 as an
		`importance: core` CATALOGUED fact -- "in the read posture you swipe up
		and down to move THROUGH SLIDES, a continuous vertical scroll" --
		concluded "on this fork the swipe IS the slide navigation", observed
		that ViewLayoutFileBased.scroll() reconciles the selected part while its
		sibling scrollTo() does not, and that both touch paths in this file use
		scrollTo. It therefore restored the missing reconciliation by calling
		_checkSelectedPart from the touchmove drag branch and from the
		kinetic-fling draw loop -- i.e. per FRAME.

		🔴 THE PREMISE WAS A MIS-TRANSCRIPTION IN OUR OWN CATALOGUE. Google's
		text at the URL that entry itself cites reads, verbatim and identically
		on the Android and iOS variants of
		support.google.com/docs/answer/2763168:

		    "Swipe up and down to scroll through the slides. You can also pinch
		     to zoom into a slide."

		The swipe SCROLLS. Google's sentence does not say it navigates slides.
		"Move through slides" was the cataloguer's gloss, google-slides.json #27
		has been corrected to carry the quotation, and the stated defect the
		reconciler existed to fix -- "free scroll must reconcile which slide you
		are on" -- is not a defect in Slides' model. It was a requirement
		invented by the mis-read.

		WHAT SLIDES ACTUALLY DOES (SLIDES-SCROLL-MODEL-SPEC.md §1; the source
		class travels with each claim, because the epistemic rule applies to the
		correction as much as to what it corrects):

		  R5  [DOCUMENTED by absence + structure] In the phone read stream there
		      is NO current slide. The documented read-mode verbs are the whole
		      list: swipe to scroll · pinch to zoom · tap -> Edit slide / Add
		      comment / View comment · double-tap -> edit. No counter, no
		      filmstrip, no current-slide chrome. The thumbnail strip is an
		      EDIT-surface element.
		  R6  [DOCUMENTED] The commit point is the TAP, and identity comes from
		      HIT-TESTING it: "Tap the slide" -> "Edit slide". Scroll position
		      is never consulted.
		  R9  [DOCUMENTED, structural] A fling across several slides produces
		      ZERO slide-change events.
		  R16 [DOCUMENTED] The one place in the product where Slides does derive
		      slide changes from scroll input -- the desktop web editor's "slide
		      focus" -- is the place users asked Google to switch off, and
		      Google shipped the switch. We had built a per-FRAME version of
		      exactly that.

		SO THE COMMIT POINTS ARE THE ACTIONS, not points on the scroll timeline:

		  (a) tap on the canvas -> hit-test the touch ... vulcanCommitTappedPart
		  (b) explicit turn (filmstrip, bridge gotoSlide, menu) ... Parts.js
		  (c) rotation / document load / explicit fit ... the existing refit path
		  (d) gesture end ... vulcanCommitGestureEnd -- DEVIATION D1

		⚠ (d) IS NOT PARITY AND MUST NOT BE PRESENTED AS IT. Slides sends
		nothing during a scroll (R9); we cannot, because we have a server that
		tracks a per-client part (via the part-selection socket message) which later inserts,
		present-from-here and the edit-mode collapse
		(ImpressTileLayer._switchToPartBasedView) all read. Slides' protocol is
		UNCERTAIN -- spec R11, no public source describes it -- so there is no
		answer of theirs to copy here. (d) is bounded to EXACTLY ONE commit per
		gesture, which preserves R9's OBSERVABLE property (a fling does not step
		through slides) without claiming its event count. If R11 is ever settled
		and Slides turns out to send nothing, delete (d); nothing else depends
		on it.

		WHAT THE OLD PATH'S THREE STATED HARMS BECOME. They were real and they
		are still fixed, at a different rate and by a better resolver:

		  - "Edit slide opens the slide you left" -- now (a): the read bar acts
		    on the slide the finger LANDED ON, which is strictly more correct
		    than most-visible-by-area, and is R6 exactly.
		  - "the server's current part goes stale" -- now (d), once per gesture.
		  - "the filmstrip highlight stays behind" -- now driven from the
		    committed value by both (a) and (d), through the same
		    VulcanFilmstripFollow.planReconcile that _checkSelectedPart uses, so
		    the two cannot disagree about when the strip moves.

		WHAT ELSE HEARS `setpart`, re-checked rather than carried over from the
		old block: Map.js:265 re-broadcasts it as doc-part-changed (host
		notification, moves nothing) · Map.WOPI.js:1340 and
		Control.PartsPreview.js:925 arm `once` waiters transiently around their
		own setPart · VulcanImpressBridge.ts:535 awaits it for gotoSlide ·
		Control.SpeakerNotes.ts:201 re-renders the notes strip, which is the one
		listener that can move layout, and css/vulcan-theme.css §13i.19 now
		gives that strip a height its content cannot change · and
		VulcanTelemetry.ts:141 records one `slide_switch` per event.

		🔴 THE TELEMETRY BREAK IS DELIBERATE. A fling used to record one
		`slide_switch` per slide crossed and now records at most one per
		gesture, so a `slide_switch` series spanning this change is NOT
		comparable across the cut. Named here so the metric break is a decision
		rather than a discovery.

		Gated on both halves plus the doctype via isVulcanPhoneImpress(), and on
		fileBasedView, so gate === false reproduces HEAD exactly. As before that
		is a SCOPE choice and not a claim that the other form factors are fine:
		a tablet, or a desktop touchscreen reading a deck, still derives the
		part from scroll geometry through the stock scroll() and scrollbar
		callers. _getMostVisiblePart stays exactly as it is -- it is STOCK, it
		is the right resolver for a viewport moved with no touch point to
		hit-test, and its incumbent-wins hysteresis tiebreak becomes MORE
		load-bearing after this change, not less, because it now settles a
		COMMITTED value once per gesture instead of damping a per-frame stream.
	*/

	// (d) THE ARM, and the whole of what the two touch scroll frames now do.
	// A gesture that never moves the deck -- a tap -- never arms, so it cannot
	// produce a commit at its end. That is structural rather than an early
	// return, and it is the first half of the guard against the port's most
	// likely bug: a tap committing part N by hit-test and the same gesture's
	// touchend re-committing part N±1 by area.
	private vulcanArmGestureCommit(): void {
		if (!app.file.fileBasedView) return;
		if (!this.isVulcanPhoneImpress()) return;

		this.vulcanPartCommit.armScroll();
	}

	/*
		(d) THE COMMIT, at gesture end. At most once per gesture.

		Called from EVERY exit a touch gesture has, because a missed exit is the
		quiet failure mode: `_selectedPart` and its server notification would simply
		stop tracking, and "no event fired" looks exactly like "nothing
		changed" -- a quieter version of the bug being fixed, and harder to
		notice. The exits, enumerated rather than assumed:

		  - a touchend that did not become a fling ...... onMouseUp
		  - the fling decayed under the 0.2px threshold . onDraw -> cancelSwipe
		  - the fling hit the document bounds ........... onDraw -> cancelSwipe
		  - a finger stopped a running fling ............ onMouseUp -> cancelSwipe
		  - a pinch stopped a running fling ............. onMultiTouchStart

		The last one does NOT go through cancelSwipe -- onMultiTouchStart calls
		containerObject.stopAnimating() directly and leaves inSwipeAction set --
		so it is called explicitly there rather than assumed to be covered.

		Duplicate calls are free: planGestureEnd disarms on every call including
		the ones it answers false to, so a second end within one gesture cannot
		produce a second commit.
	*/
	private vulcanCommitGestureEnd(): void {
		if (!this.vulcanPartCommit.isArmed()) return;
		if (!app.file.fileBasedView) return;
		if (!this.isVulcanPhoneImpress()) return;

		Util.ensureValue(app.activeDocument);
		const scroll: any = (<any>app.activeDocument.activeLayout).scrollProperties;
		if (!scroll) return;

		if (!this.vulcanPartCommit.planGestureEnd(scroll.viewX, scroll.viewY))
			return;

		// _checkSelectedPart is STOCK and unchanged, and so is the
		// _getMostVisiblePart it calls. Only the caller and the rate change.
		app.map._docLayer._checkSelectedPart();
		VulcanImpressPartCommit.noteCommit(scroll.viewX, scroll.viewY);
	}

	/*
		The device's portrait width in CSS px, the basis for both postures'
		travel gates. The RULE is the planner's (portraitWidthCssPx); this only
		reads the environment and tolerates a rig with no window.screen,
		answering 0 so the shape test refuses.

		window.screen, not app.map.getSize(): the map container's short axis is
		the screen's short axis MINUS all the vertical chrome once the phone is
		turned, which made the same swipe 12-25% cheaper in landscape. See the
		resolver's header. screen is per-display, so this reads the same number
		from inside the host's iframe as it would at the top level, and it does
		not move when chrome opens or closes under the user's finger.
	*/
	private vulcanPortraitScreenCssPx(): number {
		const screen: any = window.screen;
		if (!screen) return 0;
		return VulcanImpressEditCarousel.portraitWidthCssPx(
			screen.width,
			screen.height,
		);
	}

	/*
		R6-6 SEAM — the edit-posture slide carousel's ONE canvas hook.

		The phone edit posture is a slide-focused carousel (the part-based
		collapse), and its horizontal verb is a slide turn. Everything about
		WHEN lives in VulcanImpressEditCarousel (src/app), drivable
		browser-free; this wrapper only gathers the state the decision needs
		and acts on the answer through Parts.js setPart — the same explicit
		route (b) the filmstrip and the bridge use, so every setpart listener
		(strip highlight, server part, speaker notes) hears a swipe turn
		exactly like any other turn.

		Guard order is cheapest-first so the tap- and scroll-shaped gestures
		every harness drives bail before any ENVIRONMENT is touched — the
		shape test is pure arithmetic, which is what lets the minimal
		mouse-control rigs (ImpressPhonePinchTwoWorlds' pan payloads carry
		no window.mode at all) keep driving the real onMouseUp:

		- the SHAPE (VulcanImpressEditCarousel.isSwipeShaped — travel floor
		  and axis dominance, planner-owned so there is one rule);
		- phone Impress, by the two-halves predicate;
		- the posture: NOT fileBasedView (the read stream's swipe is the
		  deck scroll) and edit permission;
		- "at fit zoom" from vulcanImpressFitRung — the SAME rung the pinch
		  floor commits against, so the carousel and the pinch cannot
		  disagree about where "fit" is. A null rung (layer cannot answer)
		  refuses, keeping the shipped no-op.

		Object grammar is honoured by construction and by the planner: a
		selected shape's drag belongs to the handles section and never
		reaches onMouseUp's touchend branch; the marquee declines touch; and
		the planner refuses under a live caret or a served long press.

		A shape merely SELECTED does not refuse — G35. That posture is the
		handles-and-no-keyboard state a single tap produces, and the device
		navigates out of it; only the in-element edit state (keyboard up)
		locks the deck. Because the handles section owns drags that START on
		the selection, the swipe that reaches here with something selected is
		a swipe on BARE CANVAS, which is the one this turn is for.
	*/
	private vulcanImpressEditSwipeTurn(diff: cool.SimplePoint): boolean {
		// Cheapest first, and for the common case byte-identical to the
		// shipped bail: a gesture that is not swipe-shaped can matter here
		// only while a zoomed intent is standing (a tap between the two
		// swipes is a disqualifier and must reach the latch to clear it).
		// hasArm() is a bare field read, so the minimal mouse-control rigs
		// (whose pan payloads carry no window.mode at all) keep bailing on
		// pure arithmetic exactly as before.
		const portraitCssPx = this.vulcanPortraitScreenCssPx();
		// The release speed the turn law's flick leg reads, at fit and zoomed:
		// the trailing-window samples, PLUS a release sample stamped now, at
		// touchend, exactly as vulcanFling() pushes one before reading. Without
		// it the window held the last MOVEMENT, so a quick drag that parked
		// ~500 ms before lifting still read fast and turned the slide, where
		// Google snaps it back (batch-20 P1 on 16899c0940). Read from a copy:
		// the samples stay vulcanFling()'s on the scroll surfaces. The release
		// travel is the container's whole-gesture travel, the frame every
		// sample is in; without it (the rigs' minimal containers) the last
		// sample's position stands for it. 0 when nothing was sampled.
		const samples = this.vulcanTouchSamples || [];
		let rawVelocity = 0;
		if (samples.length) {
			const last = samples[samples.length - 1];
			const container: any = this.containerObject;
			const releaseTravel =
				container && typeof container.getReleaseDragDistance === 'function'
					? container.getReleaseDragDistance()
					: null;
			rawVelocity = MouseControl.velocityFromSamples(
				samples.concat([
					{
						x: releaseTravel ? releaseTravel[0] : last.x,
						y: releaseTravel ? releaseTravel[1] : last.y,
						t: performance.now(),
					},
				]),
				'x',
			);
		}
		// Only speed TOWARD the travel counts. Samples run current minus
		// touchdown (finger left = negative), diff runs touchdown minus
		// current (finger left = positive). A release flicking back against
		// the travel reads 0, so the flick leg refuses it and the slide snaps
		// back as in Google Slides (R8); the 0.65-width travel leg is unchanged.
		const forward = -rawVelocity * Math.sign(diff.cX);
		const velocity = forward > 0 ? forward / app.dpiScale : 0;
		// ONE turn law for both postures (the Google reference, 03:54Z: the
		// same ~0.65 travel or flick at every zoom); the zoomed posture adds
		// only its own gates, so its stricter 3:1 shape implies this one.
		const shaped = VulcanImpressEditCarousel.isSwipeShaped(
			diff.cX,
			diff.cY,
			portraitCssPx,
			velocity,
		);
		// `intent` is null-tolerated everywhere in this method and the branch
		// below, this file's own rig convention (see getReleaseDragDistance's
		// typeof guard): the mocha receivers are Object.create'd off the
		// prototype, so the field initializer never ran there and an absent
		// latch must read as "nothing armed", not throw.
		const intent = this.vulcanImpressZoomIntent;
		if (!shaped && !(intent && intent.hasArm())) return false;
		if (!this.isVulcanPhoneImpress()) return false;
		if (app.file.fileBasedView || !app.map.isEditMode()) return false;

		const fitRung = this.vulcanImpressFitRung();
		if (fitRung === null) return false;

		const docLayer: any = app.map._docLayer;
		// The commit floor means the map can rest below the rung only
		// transiently; <= is "the slide is fully in view".
		const atFitZoom = Math.round(app.map.getZoom()) <= fitRung;

		// R8 S2 — zoomed, the single-swipe carousel grammar does not apply:
		// a slide turn takes TWO tries, decided by the armed-intent latch.
		if (!atFitZoom)
			return this.vulcanImpressZoomedSwipeIntent(
				diff,
				shaped,
				docLayer,
				portraitCssPx,
				velocity,
			);

		// At (or back at) fit any standing intent is stale — committed zoom
		// returning to fit is one of the latch's disqualifiers, and this is
		// the seam that learns about it at exactly the right moment.
		if (intent) intent.clear();
		if (!shaped) return false;

		const target = VulcanImpressEditCarousel.planSwipeTurn({
			atFitZoom: true,
			hasTextCursor: !!app.file.textCursor.visible,
			longPressServed: this.vulcanLongPressServed,
			travelCssX: diff.cX,
			travelCssY: diff.cY,
			velocityCssPxPerMs: velocity,
			portraitViewportCssPx: portraitCssPx,
			part: docLayer._selectedPart,
			parts: docLayer._parts,
		});
		if (target === null) return false;

		app.map.setPart(target);
		return true;
	}

	/*
		R8 S2 SEAM — the zoomed armed-intent latch's ONE canvas hook.

		Everything about WHEN lives in VulcanImpressZoomIntent (src/app),
		drivable browser-free; this wrapper gathers the state the decision
		needs and acts on the answer. Three outcomes:

		- 'arm'    -> return false. Swipe 1 must be indistinguishable from a
		             refusal at the router: the gesture falls through to the
		             shipped pan/fling, so the slide eases into its own edge
		             and stops — the natural "there is no more slide here"
		             feel — while the latch remembers the intent. Consuming
		             the gesture here would kill that feedback AND the
		             interruptibility of the coast it rides on.
		- 'commit' -> setPart, then land the new slide at FIT (the round-8
		             device ruling: the post-commit zoom is fit-width, and on
		             this surface the fit rung IS width-bound in portrait —
		             VulcanImpressFit.fitRatio consults only the width term
		             there). _fitWidthZoom(recalcFirstFit=true) is the one
		             shipped route that also re-arms the automatic fit, the
		             same call the kebab's 'Zoom to Fit Slide' row makes, so
		             no second zoom path exists. Returning true routes the
		             router through its existing cancelSwipe() funnel and
		             refuses the tap grammar, exactly as a carousel turn does.
		- 'ignore' -> return false; the shipped grammar owns the gesture.

		A TAP between the two swipes clears the arm (the user said something
		else); a pan that is neither tap- nor swipe-shaped leaves the arm to
		its own window — the user is looking around, and the clock is the
		judge. Pinch (onMultiTouchStart) and the long press (the served
		latch) clear at their own sites; a zoom that returns to fit clears in
		the seam above.

		The at-the-edge-at-TOUCHDOWN input reads vulcanPanAnchor — captured
		at touchstart, nulled only after this runs (see the hygiene note at
		the end of onMouseUp) — against vulcanFlingEdgeLimits(), both in core
		px, converted once. The release speed is the one the seam above
		measured (see `velocity` there) and passes in.
	*/
	private vulcanImpressZoomedSwipeIntent(
		diff: cool.SimplePoint,
		shaped: boolean,
		docLayer: any,
		portraitCssPx: number,
		velocity: number,
	): boolean {
		const intent = this.vulcanImpressZoomIntent;
		// Rig tolerance, same convention as the seam above: no latch on the
		// receiver = the shipped zoomed refusal, byte for byte.
		if (!intent) return false;

		if (this.isVulcanTapTravel(diff)) {
			intent.clear();
			return false;
		}
		if (!shaped) return false;

		const advancing = diff.cX > 0;
		const anchor = this.vulcanPanAnchor;
		const limits = this.vulcanFlingEdgeLimits();
		const atEdgeAtTouchdown =
			anchor !== null &&
			limits !== null &&
			VulcanImpressZoomIntent.isAtEdge(
				anchor[0] / app.dpiScale,
				limits[0] / app.dpiScale,
				advancing,
			);

		const verdict = intent.plan({
			atEdgeAtTouchdown: atEdgeAtTouchdown,
			hasTextCursor: !!app.file.textCursor.visible,
			longPressServed: this.vulcanLongPressServed,
			travelCssX: diff.cX,
			travelCssY: diff.cY,
			velocityCssPxPerMs: velocity,
			portraitViewportCssPx: portraitCssPx,
			part: docLayer._selectedPart,
			parts: docLayer._parts,
			nowMs: Date.now(),
		});
		if (verdict.verdict !== 'commit' || verdict.target === null)
			return false;

		app.map.setPart(verdict.target);
		if (docLayer && typeof docLayer._fitWidthZoom === 'function')
			docLayer._fitWidthZoom(null, null, true);
		return true;
	}

	/*
		(a) THE TAP, resolved by HIT TEST -- R6, the clearest statement in the
		reference set: the slide you get is the slide your finger landed on.

		NOT `_getMostVisiblePart`. On a phone in portrait those two answers
		DIFFER whenever a slide boundary crosses the viewport, which during a
		free scroll is most of the time, and the one the user means is the one
		under their finger.

		NOT `map.setPart` either, which is the other obvious reuse and is wrong
		here: setPart's fileBasedView branch runs _scrollViewToPartPosition
		first, which SCROLLS the deck to align the chosen part. That is right
		for a filmstrip tap (b) and wrong for a canvas tap -- Google's read
		stream does not move when you tap it. So this does what Parts.js's
		fileBasedView branch does MINUS that scroll: adopt, tell the server,
		move the strip, repaint the highlight.

		The two strip calls are deliberate and are the same two Parts.js makes.
		An explicit path that skips them leaves the filmstrip tracking
		filmstrip-initiated turns and not canvas-initiated ones, which reads as
		intermittent breakage rather than as a missing call. Routing them
		through VulcanFilmstripFollow.planReconcile keeps this path and
		_checkSelectedPart from disagreeing about when the strip may move.
	*/
	private vulcanCommitTappedPart(): number | null {
		if (!app.file.fileBasedView) return null;

		Util.ensureValue(app.activeDocument);
		const layout: any = app.activeDocument.activeLayout;
		const docLayer: any = app.map._docLayer;
		if (!layout || !docLayer) return null;

		const scroll: any = layout.scrollProperties;
		if (!scroll) return null;

		// Canvas-local core pixels: refreshPosition() built currentPosition by
		// adding the layout's viewedRectangle origin to the section-local
		// point, so subtracting it again recovers the point on the canvas.
		const localPY = this.currentPosition.pY - layout.viewedRectangle.pY1;

		// The same two branches _getMostVisiblePart walks, with the point given
		// in the space each of them works in. viewRectangles live in the
		// layout's view space, which is what scrollProperties.viewY measures;
		// the uniform fallback lives in the stacked-document space
		// viewedRectangle measures, which is what currentPosition already is.
		// Mixing the two is the one way to get a plausible-looking wrong
		// answer here, which is why the choice is made next to the point.
		let geometry: VulcanImpressPartGeometry;
		let pY: number;
		if (
			layout.viewRectangles &&
			layout.viewRectangles.length === docLayer._parts
		) {
			geometry = { kind: 'rects', rects: layout.viewRectangles };
			pY = scroll.viewY + localPY;
		} else {
			geometry = {
				kind: 'uniform',
				count: docLayer._parts,
				stridePixels: Math.round(
					(docLayer._partHeightTwips + docLayer._spaceBetweenParts) *
						app.twipsToPixels,
				),
				heightPixels: Math.round(docLayer._partHeightTwips * app.twipsToPixels),
			};
			pY = this.currentPosition.pY;
		}

		const part = VulcanImpressPartCommit.partAtDocumentY(geometry, pY);
		// null means the finger landed in the gap between two slides or past
		// the end of the deck. Commit nothing; the current part stands. It
		// never means "guess".
		if (part === null) return null;

		const plan = VulcanFilmstripFollow.planReconcile(
			docLayer._selectedPart,
			part,
		);
		if (plan.notifyServer) {
			docLayer._selectedPart = part;
			app.socket.sendMessage('setclientpart part=' + part);
			app.map.fire('setpart', {
				selectedPart: part,
				parts: docLayer._parts,
				docType: docLayer._docType,
			});
		}
		if (plan.scrollStrip && docLayer._preview)
			docLayer._preview._scrollToPart(part);
		if (plan.highlight) docLayer.highlightCurrentPart(part);

		// Recorded even when the part did not change: the ledger's job is to
		// stop a later gesture-end from overwriting a DELIBERATE choice with a
		// most-visible guess, and "you tapped the slide you were already on" is
		// as deliberate as any other tap.
		VulcanImpressPartCommit.noteCommit(scroll.viewX, scroll.viewY);
		return part;
	}

	// The read-posture bar is Control.MobileSelectionBar in its 'slide' mode.
	// Control.UIManager hands presentations the ImpressSelectionBar instead -
	// that one is the EDIT-mode element pill (Cut/Copy/Paste/Delete) - so this
	// instance is built lazily on the first phone tap and cached on the map.
	private vulcanSlideBar(): any {
		const map = app.map as any;
		if (!map.vulcanSlideReadBar) {
			const factory = (<any>window).VulcanMobileSelectionBar;
			if (!factory) return null;
			map.vulcanSlideReadBar = factory.create(map);
		}
		return map.vulcanSlideReadBar;
	}

	private onVulcanTapEnd(): void {
		if (!this.isVulcanPhoneImpress()) return;

		// Read posture only. In edit mode a tap selects an object and
		// Control.ImpressSelectionBar raises the element pill over it; that is
		// Slides' edit-mode grammar and it is left exactly as it is.
		if (app.map.isEditMode()) return;

		// (a) FIRST, before anything can act on the current slide. Both of the
		// branches below act on it: the single tap raises a bar whose "Edit
		// slide" collapses the stack to _selectedPart, and the double tap goes
		// straight into edit mode, which collapses it too. Resolving the part
		// after either of those would be resolving it too late, which is the
		// "tap Edit on the slide you are looking at and land on the slide you
		// left" defect in its newest form. It is also deliberately ahead of the
		// `if (!bar)` bail: a missing bar factory is a reason not to show a
		// bar, not a reason to leave the current slide wrong.
		const part = this.vulcanCommitTappedPart();
		if (part === null) {
			// A gap is not a slide. Fail closed: dismiss any trusted action bar,
			// discard its double-tap candidate, and do not lazily create a bar.
			const existingBar = (app.map as any).vulcanSlideReadBar;
			if (existingBar) existingBar.hide();
			this.vulcanBarShown = false;
			this.vulcanTapGrammar.reset();
			return;
		}

		const bar = this.vulcanSlideBar();
		if (!bar) {
			this.vulcanTapGrammar.reset();
			return;
		}

		const position = this.getMouseCanvasPosition();
		const tapDecision = this.vulcanTapGrammar.planTap(
			Date.now(),
			position,
			part,
			bar.isVisible(),
		);

		if (tapDecision === 'double') {
			bar.hide();
			this.vulcanBarShown = false;

			// Cancel the pending multi-click BEFORE flipping to edit.
			//
			// This grammar rides touchend, but the stock click machinery is
			// untouched and runs after it on the same gesture: the trailing
			// click re-arms a 250ms timer whose flush posts buttondown/buttonup
			// with count = 2 — a real core double-click at the tapped point.
			// _switchToEditMode is SYNCHRONOUS for a presentation (no server
			// round trip on that branch), so that count=2 used to land in a
			// view-readonly session and be inert, and would now land in an
			// editable one — dropping the user straight into text editing,
			// which is a level deeper than Slides' "shortcut straight into edit
			// mode" goes.
			//
			// It would also have been INTERMITTENT, which is worse: the click
			// path is gated on the container's 8 CSS px phone dragging latch, so
			// whether the stray double-click arrived would still vary with the
			// finger's travel around that boundary.
			if (this.clickTimer) {
				app.timerRegistry.clearTimeout(this.clickTimer);
				this.clickTimer = null;
			}
			this.pendingClickInfo = null;
			this.clickCount = 0;

			app.map._switchToEditMode();
			return;
		}

		/*
			I4 — A SLOW SECOND TAP MUST NOT PUT THE USER BACK WHERE THEY STARTED.

			This branch used to read: `if (bar.isVisible()) { bar.hide(); reset();
			return; }` — "the gesture that raised it also puts it away". Measured
			on the built image, that is the whole of what two deliberate taps
			produce when the second one is slow: tap 1 raises the bar, tap 2 lands
			after the 300 ms window in VulcanImpressTapGrammar.planTap, comes back
			'single', and takes the dismiss. Net zero, twice the effort, and no
			signal that anything was registered — which reads as breakage, not as
			a toggle, because nothing on screen distinguishes "your tap was
			rejected" from "your tap undid your last tap".

			The rule now is monotonic: a tap that resolves to a slide always
			leaves the bar UP, re-anchored to where the finger actually landed.
			On the same slide that is a visible acknowledgement in place of a
			disappearance; on a different slide the bar follows the finger, which
			is the same acknowledgement plus the information about which slide is
			now the subject. `planTap` has already recorded this tap as the new
			double-tap candidate, so a following FAST tap still reads 'double' and
			still takes the shortcut into edit mode — the escalation path is
			preserved, not spent.

			Dismissal is not lost with it, only moved off the canvas: the bar
			carries a leading ✕ ('slide-dismiss', Control.MobileSelectionBar
			buildSlideButtons), scrolling the deck dismisses it
			(onNewDocumentTopLeft), and so do opening the mobile wizard and
			entering edit mode. The one exit that disappears is the accidental
			one.
		*/
		bar.showForSlide(position.x, position.y);
		this.vulcanBarShown = true;
	}

	onMouseEnter(point: cool.SimplePoint, e: MouseEvent): void {
		if (app.map._docLayer._docType === 'spreadsheet') {
			this.context.canvas.classList.add('spreadsheet-cursor');
		}
		this.context.canvas.style.cursor = '';
	}

	onMouseLeave(point: cool.SimplePoint, e: MouseEvent): void {
		// Normally, we don't change the cursor style on mouse leave.
		// That is responsibility of the new target section.
		// But this is a class name and we need to remove it.
		if (app.map._docLayer._docType === 'spreadsheet') {
			this.context.canvas.classList.remove('spreadsheet-cursor');
		}
	}

	public getMobileKeyboardVisibility(): boolean {
		if (!app.map._docLayer) return false;
		else if (app.map._docLayer._docType === 'text') return true;
		else if (app.map._docLayer._docType === 'spreadsheet') {
			const acceptInput =
				app.calc.cellCursorVisible &&
				app.calc.cellCursorRectangle &&
				app.calc.cellCursorRectangle.containsPoint(
					this.currentPosition.toArray(),
				);
			return acceptInput as boolean;
		} else if (app.map._docLayer._docType === 'presentation') {
			// A tap while a shape's text is OPEN, classified as the caret
			// MOVE (inside the edited shape, not covered by a higher object
			// -- vulcanImpressWantsCaret's one false), is an edit
			// continuation: Google Slides keeps the keyboard up when the
			// caret moves inside the text being edited. The blanket false
			// this replaces blurred the hidden editable on every mid-edit
			// caret tap (and on tap 1 of the word-select double tap),
			// leaving the latch dark until core's cursor round trip
			// re-raised it from MESSAGE context -- the platform-gated raise
			// iOS is free to refuse (measured on build #8, r6-13 p2/p2c:
			// focus(false) on the wire for every mid-edit caret tap, the
			// recovery riding cursorvisible ~50ms later). Every OTHER
			// Impress tap keeps the shipped false: select-taps and entry
			// attempts summon the keyboard at their own entry door
			// (CanvasTileLayer's cursor handler), never from the click.
			return (
				app.file.textCursor.visible && !this.vulcanImpressWantsCaret()
			);
		} else return false;
	}

	// The ONE predicate that lets a click-grammar path raise the mobile
	// keyboard, shared by onClick and onMiddleClick so the two halves of the
	// click grammar cannot re-diverge. isDesktop() reads the resolved mode,
	// which on an OLD fork image is pure UA — so on a phone the host declared
	// DESKTOP chrome for, isDesktop() is false while every phone suppressor
	// (gated on the chrome class via isVulcanPhone()) is dead. Keep such a
	// mis-declared phone on the desktop no-raise path; tablets fail
	// isSmallScreenDevice() and keep the stock raise.
	private acceptsMobileKeyboardFocus(): boolean {
		return (
			!(<any>window).mode.isDesktop() &&
			(this.isVulcanPhone() ||
				!(<any>window).mode.isSmallScreenDevice())
		);
	}

	// True only inside the Vulcan phone chrome, whatever the document is: a
	// small-screen device AND the pre-paint html.vulcan-mobile-chrome marker
	// (js/global.js adds it iff !desktopChrome && mode.isSmallScreenDevice()).
	// Desktop and tablet fail BOTH halves -- isTablet() is *defined* as
	// !isSmallScreenDevice() -- so every phone-only branch below is
	// unreachable for them: substituting false here recovers the original
	// code at every call site.
	private isVulcanPhone(): boolean {
		if (!(<any>window).mode.isSmallScreenDevice()) return false;
		return document.documentElement.classList.contains('vulcan-mobile-chrome');
	}

	// ...and on a Calc sheet. Kept for the two branches that are genuinely
	// about a spreadsheet: the deferred cell menu and the optimistic
	// double-tap keyboard, both of which read the cell cursor.
	private isVulcanPhoneCalc(): boolean {
		if (!this.isVulcanPhone()) return false;
		return !!app.map._docLayer && app.map._docLayer._docType === 'spreadsheet';
	}

	// The phone Calc mode as one token, or null when the grammar does not
	// apply. VulcanCalcMode is a pure derivation over the root markers with no
	// state of its own, so sampling it costs a classList read; it is optional
	// here for the same reason the Return door latch is -- the mocha rigs that
	// drive this class build their own globals and carry no bundle.
	private vulcanCalcModeNow(): string | null {
		const svc = (window as any).VulcanCalcMode;
		return svc && svc.current ? svc.current() : null;
	}

	// ROUND-10 S3. "This gesture began in FOCUSED EDIT on phone Calc", the one
	// question the three focused-edit exit rules share. Reads the sampled
	// origin, never the live mode -- see the vulcanGestureOriginMode note.
	private vulcanRunBeganInFocusedEdit(originMode: string | null): boolean {
		return originMode === 'full-edit' && this.isVulcanPhoneCalc();
	}

	/*
	 * S3 T-B — A DRAG THAT BEGAN IN FOCUSED EDIT SELECTS CELLS INSTEAD OF
	 * PANNING THE SHEET.
	 *
	 * Every touch drag on the grid pans, for every doctype and every mode,
	 * because the touchmove branch below maps finger travel onto scrollTo and
	 * never tells core a button went down. That is right for reading and wrong
	 * for the one mode the round-10 grammar rules on: mid-edit, a tap-drag is
	 * how a phone selects a range, and ours could not select one at all.
	 *
	 * Answering true here hands the gesture to the branch that already exists
	 * for a mouse -- buttondown at the anchor, move per event, buttonup in
	 * onMouseUp -- so core does the selecting, and core (not this class)
	 * decides what becomes of the edit. That matters for the formula case: with
	 * a live '=' in the cell, core reads the same drag as picking a range
	 * REFERENCE and keeps editing, which a client-side commit here would have
	 * broken.
	 *
	 * Scoped to phone Calc IN FOCUSED EDIT and to the gesture's ORIGIN mode, so
	 * reading, sheet edit, Writer, Impress, tablet and desktop all keep the pan
	 * they shipped with -- substitute `false` and this file is unchanged.
	 */
	private vulcanDragSelectsRange(): boolean {
		return this.vulcanRunBeganInFocusedEdit(this.vulcanGestureOriginMode);
	}

	/*
	 * ...and when that drag ends, the mode goes back to SHEET EDIT: "does
	 * select the cells and pops you back into sheet edit".
	 *
	 * THE ONE CARVE-OUT, and it is core's call rather than a guess: a drag
	 * taken while a FORMULA is being written is a reference pick, and the edit
	 * survives it. `_lastFormula` is the cell text core last stated for the
	 * edited cell (CanvasTileLayer._onCellFormulaMsg), and charAt(0) === '='
	 * is the fork's own formula split -- never indexOf, because `a=b` is an
	 * ordinary label (VulcanCalcCellPreview.isFormula says the same thing for
	 * the same reason).
	 */
	private vulcanEndDragSelectSession(): void {
		if (!this.vulcanDragSelectsRange()) return;
		if (!this.mouseDownSent) return; // the gesture never became a drag

		const docLayer: any = app.map._docLayer;
		const formula: string = (docLayer && docLayer._lastFormula) || '';
		if (formula.charAt(0) === '=') return; // core keeps the edit, so do we

		if (app.map.vulcanEndCellEditSession) app.map.vulcanEndCellEditSession();
	}

	// ...and on a text document. The tap replay is scoped to Writer on
	// purpose. Calc's tap grammar shipped and is verified as it stands, and
	// Impress owns its own in-slide gesture handling; neither should start
	// receiving a second source of taps as a side effect of fixing Writer.
	private isVulcanPhoneWriter(): boolean {
		if (!this.isVulcanPhone()) return false;
		return !!app.map._docLayer && app.map._docLayer._docType === 'text';
	}

	/*
	 * ...and on a document whose phone gesture IS scrolling a long page.
	 *
	 * 🔴 SHARED SEAM. This predicate widens three gates that shipped reading
	 * isVulcanPhoneCalc(), and it is the likeliest merge point in this file.
	 * The three are the velocity SAMPLE (onMouseMove), the brake on
	 * touchDOWN (onMouseDown) and the fling on touchUP (onMouseUp); the
	 * physics behind them -- pushVulcanTouchSample, velocityFromSamples,
	 * projectFling, startVulcanFling, drawVulcanFling -- was already doctype
	 * agnostic and is not touched.
	 *
	 * WHY WRITER BELONGS IN IT. Nothing about the defect the phone fling fixed
	 * was about spreadsheets. Writer took upstream's path, which is
	 *
	 *     isSwipe = timeDiff < 200 && (|diff.cX| > 5 || |diff.cY| > 5)
	 *
	 * over the gesture's NET displacement, so on a phone document:
	 *
	 *   - an ordinary 400ms page flick could not coast AT ALL -- the whole
	 *     gesture had to finish inside 200ms;
	 *   - an out-and-back that netted +10px flung +10px, because "velocity"
	 *     was start-minus-end across the whole gesture rather than the speed
	 *     at release;
	 *   - and planting a finger to STOP a coast reached swipe(), which
	 *     accumulates into swipeVelocity, so braking sped the document up.
	 *
	 * A long document is where all three are felt most. Reading is the phone
	 * Writer posture, and scrolling is the whole of reading.
	 *
	 * WHY THE DECK'S READ POSTURE IS IN TOO. The fileBasedView stream is a
	 * long page by construction, so it had all three defects above verbatim
	 * -- a >=200ms flick coasted ZERO, coast amplitude was 0.1x NET
	 * displacement, and a braking touch ACCUMULATED. Its one extra contract,
	 * exactly ONE part commit per gesture (VulcanImpressPartCommit), is
	 * settle-shaped, not curve-shaped: the drag frame and drawVulcanFling
	 * both arm, every projected-coast exit funnels through cancelSwipe, and
	 * cancelSwipe commits. The filmstrip only moves on that commit
	 * (VulcanFilmstripFollow.planReconcile), so a longer coast moves it
	 * later, not more often.
	 *
	 * The EDIT posture (partBasedView) stays out: a drag there manipulates
	 * the slide's objects, and the shipped path is what that grammar was
	 * verified on. Substituting `false` for this predicate recovers
	 * upstream's behaviour at all three sites, and substituting
	 * isVulcanPhoneCalc() recovers the Calc-only fling exactly.
	 */
	private isVulcanPhoneScroll(): boolean {
		if (!this.isVulcanPhone()) return false;
		if (!app.map._docLayer) return false;
		const type = app.map._docLayer._docType;
		if (type === 'spreadsheet' || type === 'text') return true;
		return type === 'presentation' && !!app.file.fileBasedView;
	}

	/*
	 * ...and on a document whose phone pinch is a TEXT SIZE control.
	 *
	 * Deliberately a separate predicate from isVulcanPhoneScroll(), and the
	 * two no longer answer the same set: scroll is about the fling physics on
	 * a long page (the deck's read posture is in), this is about how much
	 * zoom a spread of the fingers buys on a LINEAR px gearing. The deck is
	 * out of THIS one because its pinch owns a ratio-tracking branch in
	 * onMultiTouchMove instead.
	 *
	 * Its ONE call site is the sensitivity ternary in onMultiTouchMove.
	 * Substituting isVulcanPhoneCalc() there recovers the shipped behaviour
	 * exactly, and substituting false recovers upstream's.
	 */
	private isVulcanPhonePinch(): boolean {
		if (!this.isVulcanPhone()) return false;
		if (!app.map._docLayer) return false;
		const type = app.map._docLayer._docType;
		return type === 'spreadsheet' || type === 'text';
	}

	// A tap that lands inside what is ALREADY selected: the "tap-again" of
	// the phone grammar. Reads the live cell cursor and selection, so it only
	// answers correctly while core has not yet been told about this tap.
	private isVulcanTapAgain(): boolean {
		if (!this.isVulcanPhoneCalc()) return false;
		if (!app.map.isEditMode()) return false;
		// Inside the live cell cursor -- which is exactly what
		// getMobileKeyboardVisibility() answers for a spreadsheet, and exactly
		// the condition that raises the keyboard today -- OR inside the live
		// multi-cell selection, whose tap-again asks for the RANGE menu (the
		// count 1 hold in onClick is what keeps that range alive until the
		// menu timer fires)...
		if (!this.getMobileKeyboardVisibility() && !this.isVulcanRangeTap())
			return false;
		// ...but not while the in-cell editor is open, where a tap is the user
		// placing the caret (the same test setCursorType uses to decide it
		// should draw an I-beam over the cell).
		return !app.file.textCursor.visible;
	}

	// The tap landed inside a live multi-cell selection. _cellSelectionArea
	// is the same client-side rectangle the selection handles and marker draw
	// from (CellSelectionMarkerMiddleware): twips, and null unless the
	// selection spans more than the cursor cell. Substituting false here
	// recovers the anchor-cell-only gate and the immediate first click
	// exactly.
	private isVulcanRangeTap(): boolean {
		if (!this.isVulcanPhoneCalc()) return false;
		const area = app.map._docLayer._cellSelectionArea;
		if (!area) return false;
		return area.containsPoint(this.currentPosition.toArray());
	}

	// The selection this document is showing, as one comparable string: the
	// multi-cell area when there is one, the cursor cell otherwise, '' when
	// there is neither. Same four-number shape CanvasTileLayer's own
	// _vulcanSelectionSignature uses for the S6 restore, for the same reason —
	// two selections are the same selection when their rectangles agree.
	private vulcanSelectionSignature(): string {
		// DOCTYPE BEFORE CHROME, and the order is load-bearing rather than
		// stylistic. This runs from the touchstart branch of onMouseDown, which
		// every document type reaches on every finger-down, and it is the only
		// reader of `window.mode` on that path that is not already
		// short-circuited — the swipe arrest is gated on inSwipeAction, and
		// onVulcanTouchDown is the seam the deck and Writer rigs stub out. A
		// chrome test first therefore throws on a finger-down that has nothing
		// to do with a spreadsheet. The doctype test costs nothing and cannot.
		const layer = app.map._docLayer;
		if (!layer || layer._docType !== 'spreadsheet') return '';
		if (!this.isVulcanPhoneCalc()) return '';
		const area = layer._cellSelectionArea || app.calc.cellCursorRectangle;
		if (!area) return '';
		return area.x1 + ',' + area.y1 + ',' + area.width + ',' + area.height;
	}

	// Every touchstart, before anything this gesture does can move the
	// selection. Promotes what the previous gesture left behind and takes this
	// gesture's own sample. See the field block for why the promotion is a
	// separate carrier from the sample.
	private vulcanSampleSelectionAtGestureStart(): void {
		this.vulcanPriorTapSelection = this.vulcanPendingTapSelection;
		this.vulcanPendingTapSelection = null;
		this.vulcanPreGestureSelection = this.vulcanSelectionSignature();
	}

	// The area under the finger was already selected when this gesture began,
	// and the gesture before it did not put it there.
	//
	// A null prior is not a failure: it means no TAP preceded this gesture, so
	// nothing this grammar controls moved the selection and whatever is
	// selected predates the gesture by definition. That is the standing case —
	// a press on a selection that has been sitting there through a pan, a
	// scroll, or since the document opened.
	//
	// `== null` on purpose, and it is load-bearing rather than lax: the mocha
	// rigs build this receiver with Object.create, which runs no field
	// initializers, so an unsampled carrier reads `undefined` and a strict
	// `=== null` would take the wrong branch on every one of them.
	private vulcanSelectionPredatesGesture(): boolean {
		const prior = this.vulcanPriorTapSelection;
		if (prior == null) return true;
		return prior === this.vulcanPreGestureSelection;
	}

	// ...and the stricter form the TOOLBAR needs: the same, plus a preceding
	// tap to be the first half of the pair. A lone tap inside a selection is
	// not a double tap and must raise nothing, which is the trigger the designer most
	// likely hit — one tap inside a marquee used to arm the menu outright.
	private vulcanTapPairOnSettledSelection(): boolean {
		const prior = this.vulcanPriorTapSelection;
		if (prior == null) return false;
		return prior === this.vulcanPreGestureSelection;
	}

	private cancelVulcanMenu(): void {
		if (this.vulcanMenuTimer === null) return;
		app.timerRegistry.clearTimeout(this.vulcanMenuTimer);
		this.vulcanMenuTimer = null;
	}

	// Every finger-down. Kills a cell menu that has not opened yet, and on the
	// second finger-down of a double tap raises the keyboard immediately
	// instead of after the multi-click deferral AND the round trip behind it
	// (core answers the count=2 click with a text cursor, and CanvasTileLayer's
	// cursor handler is what calls map.focus(true) today).
	//
	// The gate is the deferral's own state, not a second timer: clickTimer
	// armed with exactly one click behind it means tap 1's click reached
	// onClick and is being held, so core is going to be told count=2. When
	// tap 1's click never arrived -- the container drops the click event once
	// its touch drag latch trips -- clickTimer is null, this does nothing, and
	// no keyboard is raised over a cell that will not enter edit mode.
	private onVulcanTouchDown(): void {
		this.cancelVulcanMenu();

		if (!this.isVulcanPhoneCalc()) return;
		if (this.clickTimer === null || this.clickCount !== 1) return;
		if (!app.map.isEditMode()) return;
		if (!this.getMobileKeyboardVisibility()) return;

		// Idempotent: TextInput._setAcceptInput early-outs when the state is
		// unchanged, so the round trip's own focus(true) is a no-op later.
		app.map.focus(true);

		// This branch fires exactly on the second finger-down of a double tap
		// over the selected cell — the gesture door into in-cell edit mode, so
		// Return inside now means newline (VulcanCalcReturnKey.ts).
		if (window.VulcanCalcReturnKey)
			window.VulcanCalcReturnKey.enterCellEditDoor();
	}

	// Every finger-up inside the phone chrome that was not a flick. Runs on
	// touchend, not on click, because the container drops the click event once
	// its touch drag latch trips. Under phone chrome that latch trips at 8 CSS
	// px while this section accepts up to 10, so the touch path owns the narrow
	// gap where a finger still means "tap" but the browser click is discarded.
	//
	// What counts as a tap is decided once, here, for every document type:
	// past the dwell cap the press has already produced a menu through
	// CanvasSectionContainer.startLongPress and neither branch below may
	// produce a second one; past the slop it was a drag.
	private onVulcanDocumentTapEnd(
		point: cool.SimplePoint,
		diff: cool.SimplePoint,
		dwell: number,
		e: MouseEvent,
	): void {
		if (!this.isVulcanTapTravel(diff)) return; // past the slop it was a drag

		/*
			I2 — "PAST THE DWELL CAP THE LONG PRESS OWNS IT" WAS NOT TRUE.

			tapMaxDwell IS the container's long-press delay, and the reasoning
			was that a press outlasting it has already produced a menu through
			CanvasSectionContainer.startLongPress, so this path must not also
			act. The premise is false whenever the finger moved: onTouchMove
			calls stopLongPress() UNCONDITIONALLY, on its first event, before
			any distance test. A 600 ms press that wobbles a single pixel
			therefore cancels the long press and then fails this gate too, and
			the gesture produces nothing whatsoever.

			That is the failure a user walks straight into, because it is what
			they do NEXT: the first quick tap missed, so they press again more
			deliberately, and pressing more deliberately is precisely what
			guarantees the second attempt cannot work either. It matches the
			device measurement — "four slow taps never escalate", "two
			deliberate taps in the read posture netted zero".

			So ask whether the long press actually fired instead of assuming it
			from the clock. Impress only: Writer and Calc keep the dwell cap
			they shipped and were verified with, because relaxing it there
			would change a long-press grammar this lane has not measured.
		*/
		if (this.isVulcanPhoneImpress()) {
			if (this.vulcanLongPressServed) return;
			this.vulcanImpressTapAsClick(point, e);
			return;
		}

		if (dwell >= MouseControl.tapMaxDwell) return; // the long-press owns it

		if (this.isVulcanPhoneWriter()) this.replayTapAsClick(point, e);
		else if (this.isVulcanPhoneCalc()) {
			this.armVulcanCellMenu();

			// ROUND-11 C2. This gesture ended as a tap, so it can be the first
			// half of a pair: hand its OPENING selection forward. Written after
			// the arm above, which is still asking about the pair this tap
			// closes rather than the one it opens.
			this.vulcanPendingTapSelection = this.vulcanPreGestureSelection;
		}
	}

	// The travel half of "this gesture was a tap", in CSS px. One budget, read
	// by all three consumers on this surface: the swipe test, the edit-posture
	// tap and the read-posture tap. See the I2 note in onMouseUp for what
	// having three separate budgets cost.
	private isVulcanTapTravel(diff: cool.SimplePoint): boolean {
		return (
			Math.abs(diff.cX) <= MouseControl.tapSlop &&
			Math.abs(diff.cY) <= MouseControl.tapSlop
		);
	}

	/*
		THE PHONE TAP IS ONE CLICK — Google's Slides grammar, restored.

		AUDIT-slides.md divergence #2/#3 (2026-08-19, measured on slot-01
		against SPEC-slides.md): a single tap in canvas edit must SELECT the
		object it lands on — handles, no keyboard (SPEC L3, assertion A4) — and
		text editing is entered from the selection, by tapping the selected
		shape again or double-tapping (SPEC 3.6). The previous arm here sent a
		synthetic count 1 + count 2 pair for every tap, so a caret was the only
		reachable state: L3 had no entry gesture, single and double tap meant
		the same thing, and the only exits left were the teleporting kind.

		So this arm forwards the tap as EXACTLY what the finger did: one click,
		through the same replay Writer uses (replayTapAsClick is a no-op unless
		the container's drag latch already swallowed the browser click). Core's
		own hit-testing then answers every case with no client second-guessing:
		a tap on a shape selects it; on empty canvas it deselects; while text
		is being edited, a tap inside the edited shape moves the caret (aimed
		at the nearest ink by vulcanImpressSnapCaretTap in onClick, I7) and a
		tap outside ends the text edit — the everyday reference-app exit that
		did not exist while every tap synthesised a fresh entry.

		The double-tap entry into text lives in ShapeHandlesSection
		.onDoubleClick (I5): while a shape is selected that section owns taps
		inside it, and a second SINGLE tap is deliberately inert — the
		reference's tap-again is a no-op, and only double-tap escalates
		(G-P0-2; the ruled Sheets tap-again grammar must not leak into this
		surface). The group entry-round escalation that the old pair needed is
		gone with the pair — a group now selects on one tap and enters through
		the stock double-click path, like every other shape.
	*/
	private vulcanImpressTapAsClick(point: cool.SimplePoint, e: MouseEvent): void {
		// Read posture has its own grammar (onVulcanTapEnd): a tap there raises
		// the slide bar and a double tap enters edit mode.
		if (!app.map.isEditMode()) return;
		if (this.vulcanTapReplayed) return;

		this.refreshPosition(point);
		this.replayTapAsClick(point, e);
	}

	/*
		B-0288: the object whose text is open, WHEN core's reported selection
		cannot be it, i.e. the selection covers the whole slide (the measured
		background). Then it is the topmost object painted above the
		selection whose box holds the caret. Otherwise null: the reported
		selection is the edited object, and a higher arrow or label whose box
		merely holds the caret must not take its place. Both the caret-move
		decision and the ink snap read this, so they agree on which object
		bounds the tap.
	*/
	private vulcanImpressCaretHolder(): { rect: number[]; ordNum: number } | null {
		const rectangle = GraphicSelection.hasActiveSelection()
			? GraphicSelection.rectangle
			: null;
		const layer: any = app.map._docLayer;
		if (
			!rectangle ||
			!layer ||
			!VulcanImpressOverlap.coversWholeSlide(
				[rectangle.x1, rectangle.y1, rectangle.x2, rectangle.y2],
				layer._partWidthTwips,
				layer._partHeightTwips,
			)
		)
			return null;

		const caret = app.file.textCursor.rectangle;
		if (!caret) return null;
		const extraInfo = GraphicSelection.extraInfo;
		return VulcanImpressOverlap.objectHoldingCaret(
			(caret.pX1 + caret.pX2) / 2,
			(caret.pY1 + caret.pY2) / 2,
			extraInfo ? extraInfo.ObjectRectangles : null,
			extraInfo ? extraInfo.OrdNum : null,
		);
	}

	/*
		UI-B-004 (pending the Google reference clips): what did core say the
		finger is on, for a phone-Impress entry double tap (`ci` is its
		clickInfo)? Core answers tap 1's count 1 with a graphicselection
		(GraphicSelection.vulcanAnswers counts them); a pair whose tap 1 has
		not been answered yet cannot know.
		  'n/a'      not an entry double tap in phone Impress: everything
		             ships as before (Calc, Writer, desktop, tablet, a word
		             select inside open text).
		  'unknown'  no answer since tap 1.
		  'text'     the answer is something else, or tap 2 is off the
		             answered object, or on an object painted above it (a
		             caption over a photo): send the count 2 as before.
		  'none'     a picture under tap 2: send no count 2, so core opens no
		             caret in the picture (fudraw.cxx:670-679).
		  'activate' an embedded object (a chart, a Math formula, an
		             embedded sheet) under tap 2: send the count 2, so core
		             activates it in place (fudraw.cxx:653-661), but open no
		             keyboard door: no caret comes.
	*/
	private vulcanImpressDoubleTapAnswer(
		ci: any,
	): 'n/a' | 'unknown' | 'text' | 'none' | 'activate' {
		if (!ci || !ci.vulcanImpressEntry || ci.vulcanAnswerMark == null)
			return 'n/a';
		if (!(GraphicSelection.vulcanAnswers > ci.vulcanAnswerMark))
			return 'unknown';
		const info = GraphicSelection.extraInfo;
		const rect = GraphicSelection.hasActiveSelection()
			? GraphicSelection.rectangle
			: null;
		const picture = VulcanImpressOverlap.isTextlessKind(info);
		if (!rect || !(picture || VulcanImpressOverlap.isEmbeddedKind(info)))
			return 'text';
		const p = ci.sendingPosition;
		if (!rect.containsPoint(p.toArray())) return 'text';
		if (
			VulcanImpressOverlap.coveredByHigherObject(
				p.pX,
				p.pY,
				info.ObjectRectangles,
				info.OrdNum,
			)
		)
			return 'text';
		return picture ? 'none' : 'activate';
	}

	// The count vulcanAnswerMark samples. A method, not an inline read, so
	// onClick's body names no new bundle global (the Calc mocha rig
	// re-evaluates that body outside the bundle).
	private vulcanImpressAnswersSoFar(): number {
		return GraphicSelection.vulcanAnswers;
	}

	/*
		UI-B-004: GraphicSelection.onMessage calls this with each answer from
		core. A double tap waiting on it is decided now: on a picture nothing
		is sent, on an embedded object the count 2 goes, and either way the
		keyboard tap 2 raised goes down in this same task (device: the answer
		lands 40-182 ms after tap 2, runs/run3/dtap-gap); a held count 2 on
		anything else goes out now.
	*/
	public vulcanImpressOnSelectionAnswer(): void {
		if (this.pendingClickInfo == null || !(this.clickCount >= 2)) return;
		const answer = this.vulcanImpressDoubleTapAnswer(this.pendingClickInfo);
		if (
			this.vulcanDoubleTapHold != null ||
			answer === 'none' ||
			answer === 'activate'
		)
			this.flushPendingClick();
	}

	// Should this tap ask for a caret, or is it a caret MOVE inside the text
	// that is already open? Asked before core hears about the tap, so it reads
	// the state the finger acted on.
	private vulcanImpressWantsCaret(): boolean {
		// Nothing is being edited: any tap is an entry attempt.
		if (!app.file.textCursor.visible) return true;

		const rectangle = GraphicSelection.hasActiveSelection()
			? GraphicSelection.rectangle
			: null;
		// Editing with no graphic selection to bound it — there is nothing to
		// be "inside of", so treat the tap as an entry attempt rather than
		// silently sending a count 1 that may land nowhere.
		if (!rectangle) return true;

		/*
			B-0288: THE CARET NAMES THE OBJECT BEING EDITED, NOT THE SELECTION.

			Core can report a LOWER object as selected while another object's
			text is open. Measured on redroid (runs/run2/b0288 t13-t14): after
			the double tap into the eval deck's slide-1 title (OrdNum 3),
			graphicselection became the slide-sized background rectangle
			(OrdNum 0), 3.5 s before the tap and for the rest of the edit.
			Measured against that, the rectangle below contains every tap and
			the title itself "covers" every tap inside its own text. So a tap
			beside the caret went out as an entry attempt, and onClick's
			focus(false) dropped the keyboard while the edit stayed open.

			In that state (vulcanImpressCaretHolder), measure against the
			object holding the caret. A tap outside it is still an entry
			attempt, and a shape painted above it still covers.
		*/
		const objects = GraphicSelection.extraInfo
			? GraphicSelection.extraInfo.ObjectRectangles
			: null;
		const edited = this.vulcanImpressCaretHolder();
		if (edited) {
			const px = this.currentPosition.pX;
			const py = this.currentPosition.pY;
			if (
				px < edited.rect[0] ||
				px > edited.rect[2] ||
				py < edited.rect[1] ||
				py > edited.rect[3]
			)
				return true;
			return VulcanImpressOverlap.coveredByHigherObject(
				px,
				py,
				objects,
				edited.ordNum,
			);
		}

		// Outside the shape being edited: the user is leaving for another
		// shape, and the count 1 / count 2 pair does both halves of that in one
		// gesture (the 1 leaves and selects, the 2 enters).
		if (!rectangle.containsPoint(this.currentPosition.toArray())) return true;

		/*
			I6 — INSIDE THE RECT IS NOT THE SAME AS ON THE SHAPE.

			`GraphicSelection.rectangle` is an axis-aligned BOUNDING BOX, so
			"inside it" is a much bigger claim than "on the thing I am editing":
			any shape that overlaps that box — and, for a rotated or non-
			rectangular shape, most of the box itself — reads as a caret move.
			The tap then goes out as a bare count 1, core hit-tests it, selects
			the OTHER shape, and the caret you were told you were moving is
			gone. One whole gesture spent, with the deck now in a state the user
			did not ask for.

			The dinosaur fixture deck has the case on purpose (overlapping
			shapes, slide 9), and it is not exotic authoring: a caption over a
			picture and a label over an autoshape are both this.

			WHAT MAKES IT ANSWERABLE. Core sends the rectangles of the OTHER
			objects on the slide with every graphicselection —
			`extraInfo.ObjectRectangles`, `[x, y, w, h, ordNum]`, converted to
			core px for presentations by
			GraphicSelectionMiddleware.convertObjectRectangleTwipsToPixels —
			together with the selected object's own `extraInfo.OrdNum`. The
			shape-snapping code two files over already consumes exactly this.
			`ordNum` is the draw-page ordinal, so a HIGHER one is painted later,
			i.e. on top: that is the whole test, and it is the same question
			core's own hit testing will answer a moment later.

			STALE-SCALE HAZARD, CHECKED. The conversion above multiplies by
			`app.twipsToPixels`, which moves with the zoom — and the entry zoom
			lands 120-480 ms after a caret appears. It is not stale, because
			`graphicselection` is in CanvasTileLayer's print-twips replay set
			and `_replayPrintTwipsMsgs` re-delivers it on every zoom change, so
			the numbers are re-derived at the new scale. `SimplePoint.pX` is the
			same core-pixel space.

			FAIL-SAFE TOWARD WHAT SHIPPED. Every uncertain answer — no
			rectangles, an unusable OrdNum, a malformed row — returns "no
			overlap", which leaves the decision exactly where this method had it
			before. The new information can only ever ADD entry attempts, never
			take away a caret move that was already correct.
		*/
		return VulcanImpressOverlap.coveredByHigherObject(
			this.currentPosition.pX,
			this.currentPosition.pY,
			GraphicSelection.extraInfo ? GraphicSelection.extraInfo.ObjectRectangles : null,
			GraphicSelection.extraInfo ? GraphicSelection.extraInfo.OrdNum : null,
		);
	}

	/*
		I7 — A TAP INSIDE THE TEXT YOU ARE EDITING MOVES THE CARET, WHEREVER
		INSIDE IT LANDS.

		WHAT WAS MEASURED, on the built image, phone viewport, Dinosaurs.pptx: a
		20-point lattice over a shape ALREADY in text edit, every tap classified
		by whether the caret RECTANGLE changed, so a stale caret could not read
		as a hit. 15/20 moved the caret, 5/20 LOST it, 0 left it unchanged.
		Split by what the tap landed on: on-glyph 10/10 moved it, off-glyph
		5/10, and all five losses were INSIDE the shape being edited — read
		from the `graphicselection:` rectangle off the websocket, not inferred
		from the screen. A double tap at the same point recovered 1 of the 5.
		No tap on empty canvas ever created a caret, so there are no false
		positives to trade against.

		WHY, and it is the same mechanism as I2's, seen from the other side. The
		caret-move arm below deliberately sends a bare count 1, because a count
		2 would select the word under the finger instead of moving the caret to
		it. But core enters an object's text on a count 1 only when the hit
		point is inside a TEXT PORTION; everywhere else in the shape a count 1
		is core's "select the object", which tears down text editing. The 6-12
		px live band inside a 45-70 px shape IS the glyph, and on a phone the
		ink is 5-7 px tall (see VulcanImpressTextZoom). A finger does not have
		that target.

		SO THE FIX IS A DIFFERENT POINT, NOT A DIFFERENT SEQUENCE. Google Slides
		puts the caret at the nearest text position for a tap anywhere in the
		box; the client already has the rendered text sitting on its own canvas,
		so it can find that position and aim the count 1 at it. On-glyph is the
		arm measured at 10/10 — this converts the off-glyph tap into an
		on-glyph one and hands core the case it already answers correctly. No
		new UNO command, no new wire sequence, and core's own hit testing still
		decides what was tapped.

		EXPLICITLY NOT DONE BY SENDING THE PAIR ON THIS ARM. A count 2 selects
		the word, which is not what a caret move asked for, and the measurement
		says the pair rescues 1 of 5 anyway. Nor by widening the double-tap
		window, for the reason I2 already gives.

		WHY HERE AND NOT AT THE GESTURE END. The caret-move arm sends nothing
		itself — it hands the tap to `replayTapAsClick`, which forwards to
		`onClick` only when the container's drag latch has tripped, and
		otherwise lets the ORDINARY browser click carry it. Both routes end in
		`onClick`, and only one of them passes through
		`vulcanImpressTapAsClick` at all. A correction applied at the gesture end
		would therefore be applied to the tap that latched and skipped for the
		tap that did not — i.e. skipped for the still finger, which is most of
		them. `onClick`, immediately after `refreshPosition`, is the one place
		both routes are already standing in, before anything downstream has read
		the position.

		FAIL TOWARD WHAT SHIPS TODAY, at every step: outside the gate, no
		canvas, a readback that throws, a patch with no ink in it, ink too far
		away, a snapped point that a higher object covers — all of them leave
		`currentPosition` exactly as `refreshPosition` built it, and the tap
		goes out where the finger touched. The correction can only ever convert
		a miss into a hit; there is no path here that takes a working caret move
		away.

		⚠ STATIC ANALYSIS ONLY on the client side of the boundary. What core
		does with a count 1 that is genuinely on a glyph is measured (10/10);
		that the pixels this reads are the glyphs core rendered is an inference
		from the fact that they are the tiles core sent, and only the lattice
		re-run on a built image can settle it.
	*/

	// The search budget, in CSS px, scaled by app.dpiScale at use because the
	// canvas is in core pixels. The vertical reach is the load-bearing one: the
	// common miss is above or below the line, and 55 px covers a 45-70 px shape
	// from any point inside it. The horizontal reach only has to find the end
	// of the line the finger is on.
	static vulcanInkSnapRadiusX: number = 110;
	static vulcanInkSnapRadiusY: number = 55;

	// Kept off the shape's own boundary, where things that are NOT the
	// document's text are painted onto the same canvas: ShapeHandlesSection
	// draws 12 px handle art centred on the edge (6 px of it inward) and a 1 px
	// frame along it, and both keep drawing while a caret is live — only
	// `interactable` flips, and that gates targeting, not painting.
	static vulcanInkSnapInset: number = 8;

	// Core px. Below this a patch has no room for a line of text and the
	// readback is not worth making.
	static vulcanInkSnapMinRegion: number = 8;

	// Luminance out of 255. Low enough for grey-on-white body text (#666 on
	// white is 153, #ccc on white is 51), high enough to ignore a fill's own
	// dithering. Text that misses it produces no ink, which is a no-op.
	static vulcanInkSnapThreshold: number = 40;

	// A patch this inked is a picture or a gradient, not text on a fill.
	static vulcanInkSnapMaxFraction: number = 0.45;

	// Core px per row. See VulcanImpressInk.planSnap for why it is not 1.
	static vulcanInkSnapMinRowInk: number = 2;

	// Reused across taps, grown but never shrunk. Its one job is to keep the
	// DOCUMENT canvas out of `getImageData` entirely: a readback marks its
	// canvas as read-frequently in the browser's eyes and can cost it GPU
	// acceleration, and the document canvas is the last one that can afford
	// that. Here it is only ever a `drawImage` SOURCE.
	vulcanInkScratch: HTMLCanvasElement | null = null;

	// The impure half: hand back the RGBA of one bounded patch of the canvas,
	// or null if anything at all is in the way. Separated from the decision so
	// the decision can be driven in a unit test without a canvas, and so this
	// is the only place that has to be defensive about the DOM.
	private vulcanImpressReadInk(
		x: number,
		y: number,
		width: number,
		height: number,
	): Uint8ClampedArray | null {
		try {
			const source = this.context ? this.context.canvas : null;
			if (!source) return null;

			let scratch = this.vulcanInkScratch;
			if (!scratch) {
				scratch = document.createElement('canvas');
				this.vulcanInkScratch = scratch;
			}
			// Assigning either dimension resets the canvas, so only grow.
			if (scratch.width < width) scratch.width = width;
			if (scratch.height < height) scratch.height = height;

			const target = scratch.getContext('2d', { willReadFrequently: true });
			if (!target) return null;

			target.clearRect(0, 0, width, height);
			target.drawImage(source, x, y, width, height, 0, 0, width, height);
			return target.getImageData(0, 0, width, height).data;
		} catch (exception) {
			// A tainted canvas throws SecurityError from getImageData. Nothing
			// in this tree paints a cross-origin image into the document
			// canvas, but a caret move is not worth an exception if something
			// ever does.
			return null;
		}
	}

	// The gate, the patch, and the correction. Called from onClick, which is
	// where both of the caret-move arm's delivery routes meet.
	private vulcanImpressSnapCaretTap(): void {
		// The doctype first, deliberately ahead of isVulcanPhoneImpress() even
		// though that method asks the same question inside itself. onClick runs
		// for every click in every document; this correction is for exactly one
		// of them, so the cheapest term that rules the other two out belongs at
		// the top rather than four tests in. It is a strict SUBSET of the gate
		// below, so it can only ever decline earlier — it cannot admit anything
		// isVulcanPhoneImpress() would refuse.
		const layer: any = app.map._docLayer;
		if (!layer || layer._docType !== 'presentation') return;

		if (!this.isVulcanPhoneImpress()) return;
		if (!app.map.isEditMode()) return;
		// The caret-move arm and nothing else. vulcanImpressWantsCaret() is
		// false for exactly one tap: inside the shape whose text is open, not
		// covered by anything painted above it. An entry attempt answers true
		// and leaves here immediately, so the count 1 / count 2 pair still goes
		// out at the point the finger touched.
		if (this.vulcanImpressWantsCaret()) return;

		// Guaranteed non-null by the test above (it answers true when there is
		// no rectangle to be inside of); restated because the geometry below
		// reads it and a silent NaN would be a wrong snap, not a missing one.
		const rectangle = GraphicSelection.rectangle;
		if (!rectangle) return;

		// The object being edited bounds the search and is what a covering
		// shape must be painted above. In the B-0288 state that is the object
		// holding the caret, not the whole-slide selection: bounded by the
		// slide, the snap could land on master-page art outside the title,
		// and checked against OrdNum 0 it vetoed the title's own ink.
		const holder = this.vulcanImpressCaretHolder();
		const edited = holder
			? holder.rect
			: [rectangle.pX1, rectangle.pY1, rectangle.pX2, rectangle.pY2];
		const editedOrdNum = holder
			? holder.ordNum
			: GraphicSelection.extraInfo
				? GraphicSelection.extraInfo.OrdNum
				: null;

		Util.ensureValue(app.activeDocument);
		const layout: any = app.activeDocument
			? app.activeDocument.activeLayout
			: null;
		if (!layout || !layout.viewedRectangle) return;

		const anchor = this.containerObject.getDocumentAnchor();
		if (!anchor) return;

		const source = this.context ? this.context.canvas : null;
		if (!source || source.width < 1 || source.height < 1) return;

		// Document core px -> canvas core px, the inverse of what
		// refreshPosition just did and the same expression
		// _documentToCssPosition uses. Its frozen-pane branch is spreadsheet
		// only and cannot apply here.
		const offsetX = anchor[0] - layout.viewedRectangle.pX1;
		const offsetY = anchor[1] - layout.viewedRectangle.pY1;

		const scale = app.dpiScale > 0 ? app.dpiScale : 1;
		const inset = Math.round(MouseControl.vulcanInkSnapInset * scale);
		const reachX = Math.round(MouseControl.vulcanInkSnapRadiusX * scale);
		const reachY = Math.round(MouseControl.vulcanInkSnapRadiusY * scale);
		const tapX = this.currentPosition.pX + offsetX;
		const tapY = this.currentPosition.pY + offsetY;

		// Three bounds at once, and each is load-bearing: the canvas, so the
		// readback is in range; the shape, so no correction can leave the text
		// being edited; the reach, so the work per tap is bounded whatever the
		// shape's size.
		const left = Math.max(0, edited[0] + offsetX + inset, tapX - reachX);
		const right = Math.min(
			source.width - 1,
			edited[2] + offsetX - inset,
			tapX + reachX,
		);
		const top = Math.max(0, edited[1] + offsetY + inset, tapY - reachY);
		const bottom = Math.min(
			source.height - 1,
			edited[3] + offsetY - inset,
			tapY + reachY,
		);

		const width = right - left + 1;
		const height = bottom - top + 1;
		if (width < MouseControl.vulcanInkSnapMinRegion) return;
		if (height < MouseControl.vulcanInkSnapMinRegion) return;

		const ink = VulcanImpressInk.mask(
			this.vulcanImpressReadInk(left, top, width, height),
			width,
			height,
			MouseControl.vulcanInkSnapThreshold,
			MouseControl.vulcanInkSnapMaxFraction,
		);
		const snap = VulcanImpressInk.planSnap(
			ink,
			width,
			height,
			tapX - left,
			tapY - top,
			MouseControl.vulcanInkSnapMinRowInk,
		);
		if (!snap) return;

		const documentX = left + snap.col - offsetX;
		const documentY = top + snap.row - offsetY;

		// The corrected point has to pass the same test the tap had to pass to
		// get here (I6): ink inside the bounding box can belong to a shape
		// painted ON TOP of the one being edited, and aiming the count 1 at
		// that shape's text is how you select it and lose the caret — the exact
		// failure this method exists to remove.
		if (
			VulcanImpressOverlap.coveredByHigherObject(
				documentX,
				documentY,
				GraphicSelection.extraInfo
					? GraphicSelection.extraInfo.ObjectRectangles
					: null,
				editedOrdNum,
			)
		)
			return;

		this.currentPosition.pX = documentX;
		this.currentPosition.pY = documentY;
	}

	// Writer: the tap the container is about to throw away.
	//
	// onClick is the only thing in Writer that tells core about a tap, and the
	// container hands it over only while draggingSomething is clear. Under
	// phone chrome the container latches at 8 CSS px while the tap grammar here
	// allows 10; replay that 8--10px gap through the ordinary click path, so the
	// caret, keyboard, popup dismissal and multi-tap counting are all the same
	// code that a surviving click uses -- and two taps still add up to the
	// count=2 that makes core select the word.
	//
	// It cannot double-send. The container propagates onClick only under
	// `!draggingSomething && positionOnMouseDown !== null && positionOnMouseUp
	// !== null`, and the sole writer of `draggingSomething = false` is
	// clearMousePositions(), which nulls both of those positions in the same
	// statement. So a gesture that has latched the drag at finger-up can never
	// go on to deliver a click: either the latch is still set and the click is
	// dropped, or it was cleared and the positions went with it. Reading the
	// latch here -- before CanvasSectionContainer.onTouchEnd has finished --
	// is therefore an exact prediction, not a guess. The vulcanTapReplayed
	// flag is a second line only.
	//
	// The converse is deliberate: when the latch is clear the real click is
	// coming, and this does nothing at all. That leaves the handful of other
	// ways a click can be lost (no section under the finger-up, a browser that
	// synthesises no click) behaving exactly as they do today, which is the
	// trade that keeps a double caret off the table.
	private replayTapAsClick(point: cool.SimplePoint, e: MouseEvent): void {
		if (this.vulcanTapReplayed) return;
		if (!this.containerObject.isDraggingSomething()) return;

		this.onClick(point, e);
		this.vulcanTapReplayed = true;
	}

	/*
		ROUND-11 C2 -- THE HOVER TOOLBAR IS THE SLOW SECOND TAP, AND ONLY THAT.

		The designer's grammar, and the whole of it: a QUICK double tap goes from sheet
		edit to focused edit; a second tap that is arbitrarily slower raises the
		toolbar; and a pair that does not land on an area that was ALREADY
		selected raises nothing at all.

		Fast versus slow is the `isolated` test below, unchanged and already
		exact: inside the multi-tap window this finger-up belongs to the
		double-tap edit and this method declines it, so the editor door keeps
		every gesture it had. There is deliberately no upper bound on the other
		side -- "arbitrarily slow" is the spec, and the pair is defined by the
		second tap finding the selection where the first tap left it, not by a
		deadline.

		WHAT THIS SUPERSEDES, on purpose. Round 10 (G24, and S3's own open
		sub-question) made the single-cell tap-again the KEYBOARD's and hung the
		menu off the long press. Round 11 answers that question the other way,
		so the single cell is admitted here again -- but not on the terms round 9
		had it. Round 9 raised the menu for a LONE tap, which is what put a
		popover in front of a user who meant to type; the pair test below is what
		makes this the second tap of a deliberate double tap instead. The range
		arrives at the same place from the other side: a single tap inside a
		marquee used to arm the menu outright, and one tap is not a double tap.

		The menu is armed, not opened: this finger-up may still turn out to be
		the first half of a FASTER pair, and only the multi-tap window can tell.
		onVulcanTouchDown cancels it if a second finger arrives.
	*/
	private armVulcanCellMenu(): void {
		// Only an isolated tap can be a tap-again. Anything inside the
		// multi-tap window is tap 2+ of a double tap and belongs to the edit
		// gesture, whether or not its click survived the container.
		const now = Date.now();
		const isolated =
			this.clickTimer === null &&
			now - this.vulcanLastTapEndTime >= this.multiClickWindow;
		this.vulcanLastTapEndTime = now;
		if (!isolated) return;

		if (!this.isVulcanTapAgain()) return;
		// ...and the historical half isVulcanTapAgain() cannot answer: a tap
		// before this one, on the selection as it stands now. Without it the
		// live containment test above says yes to the second contact of a slow
		// pair anywhere on the sheet, because the first contact selected it.
		if (!this.vulcanTapPairOnSettledSelection()) return;

		const menuPosition = this.currentPosition.clone();
		// The popover's anchor, resolved NOW rather than at fire time, so the
		// bar cannot be placed against a position the gesture has since moved
		// off. Canvas CSS pixels — the space #vulcan-selection-bar is positioned
		// in. _documentToCssPosition mutates its argument, hence the clone.
		const menuAnchor = this._documentToCssPosition(
			this.currentPosition.clone(),
			false,
		);
		this.vulcanMenuTimer = app.timerRegistry.setTimeout(
			'vulcancellmenu',
			() => {
				this.vulcanMenuTimer = null;
				// The menu won: drop the held click either way, whatever the
				// selection's shape. Over a range a count 1 LEFT click collapses
				// the very selection the menu is about to be about; over a single
				// cell it draws the `celladdress` that retires the popover it
				// would be answering (see the note at hasCellPopover).
				this.vulcanHeldRangeTapClick = null;
				if (this.vulcanRaiseCellPopover(menuAnchor)) return;
				this.postContextMenuDown(menuPosition, app.LOButtons.right);
			},
			this.multiClickWindow,
		);
	}

	/*
		G24's headline case: a phone Calc cell menu is the POPOVER, not the
		mobile-wizard bottom sheet.

		What it replaces. The right button below used to be the whole mechanism:
		core answered it with a context menu, Control.ContextMenu routed that
		reply into the wizard sheet on a small screen, and firing 'mobilewizard'
		is precisely what HIDES the selection pill — the two idioms were mutually
		exclusive by construction, and the sheet won the commonest selection in
		the commonest phone doctype. The popover's inventory is declared
		client-side (Control.MobileSelectionBar buildCellButtons) off state the
		client already receives, so nothing is posted at all: the round trip is
		gone from the gesture, and the ORDER is Google's rather than core's.

		Why a boolean and a fallback rather than an unconditional swap. The bar
		is constructed by Control.UIManager only under the phone chrome, so
		everywhere it does not exist — desktop, tablet, `?vulcanChrome=desktop` —
		hasCellPopover() returns false and the shipped sheet answers exactly as
		it always has, on the long press and on the range timer alike. That is
		the desktop row, and it is one branch rather than a second gate that
		could disagree with the first. Substituting `false` in hasCellPopover()
		restores the shipped behaviour byte for byte, which is the calibration
		CalcPhoneCellPopover.test.ts runs.

		WHICH GESTURE RAISES IT. The long press, plus the range tap-again's
		timer. It used to be the SINGLE-CELL tap-again, and that was Google's
		grammar inverted: there a second tap on the selected cell starts
		editing and the cell menu is the press. Ours spent the tap on the menu
		and denied the keyboard with it, so the commonest way into a cell
		produced a floating pill and no caret.

		The press posts NOTHING, and that is load-bearing rather than tidy: the
		popover retires itself on any `celladdress` (Control.MobileSelectionBar
		onCellAddress), so a gesture that told core about itself would be
		answered with the address that tears its own popover down. That is why
		shouldRaiseCellPopoverOnLongPress requires the press to land on what is
		ALREADY selected — nothing has to move for the menu to be about the
		right cell — and why onContextMenu latches vulcanLongPressFired for it,
		swallowing the trailing click that would otherwise post a count 1.
	*/
	private hasCellPopover(): boolean {
		if (!this.isVulcanPhoneCalc()) return false;
		const bar = (app.map as any).mobileSelectionBar;
		return !!bar && typeof bar.showForCell === 'function';
	}

	private vulcanRaiseCellPopover(anchor: cool.PointLike): boolean {
		if (!this.hasCellPopover()) return false;
		(app.map as any).mobileSelectionBar.showForCell(anchor.x, anchor.y);
		return true;
	}

	// Whether the phone long press should raise the CELL POPOVER instead of
	// posting the right button core answers with the bottom sheet.
	//
	// isVulcanTapAgain() is most of the test, reused rather than restated: phone
	// Calc, edit posture, inside the live cell cursor or the live range, and
	// not while the in-cell editor is open. A press anywhere else keeps the
	// shipped reply, which is also the route to everything the popover's short
	// tail does not carry — the popover's own Format segment dispatches
	// `mobile_wizard`, so the sheet stays one tap away from the menu too.
	//
	// ROUND-11 C2 adds the historical half, because the press is a route into
	// the same defect: a slow pair whose second contact dwells past the
	// container's 500 ms is a LONG PRESS, and it used to find the cell that the
	// pair's own first tap had just selected. The press keeps a null prior —
	// the standing press on a selection nothing recent moved — and loses only
	// the case where the gesture before it did the selecting.
	//
	// The press REMAINS a trigger. The designer's sentence names the double tap and
	// is silent on the press, the press was round 10's deliberate G24 ruling,
	// and parity with the reference is the default; retiring a ruled behaviour
	// on that silence would be inference, not evidence.
	private shouldRaiseCellPopoverOnLongPress(): boolean {
		if (!this.hasCellPopover()) return false;
		if (!this.isVulcanTapAgain()) return false;
		return this.vulcanSelectionPredatesGesture();
	}

	private sendClick(clickInfo: any, count: number) {
		// Vulcan: Calc echoes - a plain click moves the cell cursor (drawn at
		// once), and the edit the text echo models may be over.
		if (app.definitions && app.definitions.vulcanCalcCursorEcho)
			app.definitions.vulcanCalcCursorEcho.onClick(
				clickInfo.sendingPosition,
				clickInfo.buttons,
				clickInfo.modifier,
				count,
			);
		if (app.definitions && app.definitions.vulcanCalcTextEcho)
			app.definitions.vulcanCalcTextEcho.onPointerInput();
		this.postCoreMouseEvent(
			'buttondown',
			clickInfo.sendingPosition,
			count,
			clickInfo.buttons,
			clickInfo.modifier,
		);
		this.postCoreMouseEvent(
			'buttonup',
			clickInfo.sendingPosition,
			count,
			clickInfo.buttons,
			clickInfo.modifier,
		);
	}

	onClick(point: cool.SimplePoint, e: MouseEvent): void {
		// A long press has already fired for this gesture: it selected the
		// word (phone Writer) or the object (phone Impress edit) under the
		// finger, with the edit posture's sheet suppressed in onContextMenu.
		// Left alone the trailing synthetic click would send a second count 1
		// left click on top of the press's own.
		// Checked before the replay latch so it also covers the sliver
		// where a finger lifting within a millisecond of the long press firing
		// measures a dwell just under the cap and reaches replayTapAsClick,
		// which calls straight into here. Only ever armed on those two arms,
		// so phone Calc keeps the trailing click it shipped with.
		if (this.vulcanLongPressFired) {
			this.vulcanLongPressFired = false;
			return;
		}

		// This gesture's tap already went out from replayTapAsClick, so a
		// click arriving after it is the same finger counted twice. Reaching
		// here means the container's own guard let a click through after its
		// drag latch was set, which the code says cannot happen; consume it
		// rather than place a second caret if it ever does. Only ever armed
		// on the phone path, so this is inert on desktop and tablet.
		if (this.vulcanTapReplayed) {
			this.vulcanTapReplayed = false;
			return;
		}

		// The gesture that ENTERED edit mode is still in flight: this click is
		// its browser-synthesised trailer, re-targeted at the canvas after the
		// control that took the tap (the read bar, hidden on entry) left the
		// screen. Sending it on would click the now-editable slide at the old
		// button position -- measured on slot-01: 'Edit slide' auto-selected
		// the title placeholder sitting under the bar (probe A3). A real tap
		// cannot reach this branch: its own touchstart cleared the latch
		// before its click was dispatched.
		if (this.vulcanImpressEditEntryClickGuard) {
			this.vulcanImpressEditEntryClickGuard = false;
			return;
		}

		// ROUND-10 S3. Sampled HERE, one statement before the fire that ends
		// the cell edit session: 'editorgotfocus' reaches Map._onEditorGotFocus
		// synchronously and takes the session down, so every read after this
		// line answers for the mode this tap has already left.
		const modeAtGestureStart = this.vulcanCalcModeNow();

		app.map.fire('closepopups');
		app.map.fire('editorgotfocus');

		// The one place a tap on the document is told to core, for every
		// doctype, so the one place that knows a POINTER is about to place the
		// caret -- which is what summons its grab knob for a few seconds.
		// Taps that place no caret cost nothing: the policy also requires a
		// live text cursor, which they do not produce.
		CursorHandler.noteCaretPlacedByPointer();

		this.refreshPosition(point);

		// Phone Impress, mid text edit: aim this tap at the nearest rendered
		// glyph before anything below reads the position. Inert everywhere else,
		// and inert here too unless it finds ink to aim at. See the I7 block at
		// vulcanImpressSnapCaretTap for why the correction lives on this line and
		// not at the gesture end.
		this.vulcanImpressSnapCaretTap();

		// Asked before anything below tells core about this tap, because it
		// reads the cell cursor as it stands now.
		const tapAgain = this.isVulcanTapAgain();

		// ROUND-11 C2. The toolbar armed for THIS tap, at the finger-up a
		// moment ago (armVulcanCellMenu runs on touchend, this click follows
		// it), so the two arms below know they are looking at the toolbar's own
		// gesture rather than at an edit gesture that happens to look like one.
		//
		// `!= null` and not `!== null`: the field is initialized to null in
		// production but the mocha rigs build this receiver with Object.create,
		// which runs no field initializers, so a strict test reads `undefined
		// !== null` as an ARMED MENU on every rig that does not set it — and
		// then holds the click and denies the keyboard for taps that never
		// asked for a toolbar. Measured: it took the round-10 pan and
		// edit-mode suites down together.
		const menuArmedForThisTap = this.vulcanMenuTimer != null;

		// Phone: cap a run of taps at two, whatever the document is. Left
		// alone, a third tap inside the window reaches flushPendingClick's
		// count===3 branch and is sent as a triple click; on a phone that is a
		// mis-hit of the double tap, and what the finger meant is a fresh tap
		// (in Writer that places the caret; in an open cell editor likewise).
		// Flushing here sends the double that is already pending and restarts
		// the run, so this tap goes out as count 1. Widened from the Calc-only
		// predicate: for a spreadsheet the two agree exactly, so Calc keeps
		// the behaviour it shipped with.
		if (this.clickCount >= 2 && this.isVulcanPhone()) this.flushPendingClick();

		this.clickCount++;

		if (!(<any>window).mode.isDesktop()) app.map.fire('closemobilewizard');

		// Right click is not supported. And click event doesn't have "buttons" property set. Safe to set it here to default.
		let buttons = app.LOButtons.left;

		let modifier = MouseControl.readModifier(e);
		const sendingPosition = this.currentPosition.clone();

		// Turn ctrl-left-click into right-click for browsers on macOS
		if (window.L.Browser.mac) {
			if (modifier == app.UNOModifier.CTRL && buttons == app.LOButtons.left) {
				modifier = 0;
				buttons = app.LOButtons.right;
			}
		}

		// See impressToggleModifier: Ctrl/Cmd+click toggle-selects.
		if (buttons === app.LOButtons.left)
			modifier = MouseControl.impressToggleModifier(modifier);

		const clickInfo = {
			sendingPosition: sendingPosition,
			buttons: buttons,
			modifier: modifier,
			// ROUND-10 S3: the run's origin mode. Tap 1 samples it; every later
			// tap of the same run inherits tap 1's answer rather than taking a
			// fresh one, because tap 1 may itself have changed the mode.
			vulcanOriginMode: this.clickTimer && this.pendingClickInfo
				? this.pendingClickInfo.vulcanOriginMode
				: modeAtGestureStart,
			// UI-B-004: how many of core's selection answers had arrived when
			// tap 1 of this run was made (tap 2 inherits it), so the double tap
			// can tell core's answer to tap 1 from the state it acted on.
			vulcanAnswerMark: this.clickTimer && this.pendingClickInfo
				? this.pendingClickInfo.vulcanAnswerMark
				: this.vulcanImpressAnswersSoFar(),
			// Set by tap 2 of a phone-Impress entry double tap (below).
			vulcanImpressEntry: false,
			// ...and when that tap 2 landed (Date.now()): the hold's cap
			// counts from here (flushPendingClick).
			vulcanTap2At: 0,
		};

		if (this.clickTimer) {
			// This section sends this pair's count 2 (or deliberately none), so the
			// browser's dblclick 2-4 ms later is its echo, also when core's answer
			// to tap 1 has put a shape's handles section under the finger in
			// between (code review). A mouse never stamps.
			if ((e as any).pointerType === 'touch') this.vulcanTouchPairAt = Date.now();
			// Tap 2 of a double tap: a held range tap-again's count 1 goes
			// out first, so core still sees the 1, 2 run the unheld path
			// sends for the double-tap edit.
			if (this.vulcanHeldRangeTapClick) {
				this.sendClick(this.vulcanHeldRangeTapClick, 1);
				this.vulcanHeldRangeTapClick = null;
			}
			app.timerRegistry.clearTimeout(this.clickTimer);

			// S3 T-C — DOUBLE TAP TOGGLES THE TWO EDIT MODES, so a double tap
			// that BEGAN in focused edit is the way back out to sheet edit.
			//
			// Dismissed here, at tap 2, rather than at the flush 250 ms later:
			// the gesture is complete and the user is watching for the keyboard
			// to go. The commit itself already happened -- tap 1 fired
			// 'editorgotfocus', which ended the session and (round 10) KEPT the
			// keyboard; this is the one owner that takes it away.
			//
			// map.focus(false) is a real soft-keyboard dismissal on phone Calc,
			// not just a blur: TextInput._setAcceptInput routes it to
			// dismissSoftKeyboard.
			//
			// VO-P-0022 — THE DOOR IN CLAIMS THE KEYBOARD HERE, INSIDE TAP 2's
			// OWN CLICK, and it has to be AFTER the 'editorgotfocus' fired
			// above. That fire reaches CanvasTileLayer._updateCursorAndOverlay
			// while the in-cell caret is still hidden (the count-2 goes out at
			// the flush, 250 ms from now), so its cursor-gone arm runs
			// map.focus(false) -> TextInput.dismissSoftKeyboard: DOM blur, and
			// the edit-intent window closed. Every earlier raise on the pair
			// dies there -- tap 1's tap-again raise and onVulcanTouchDown's
			// second-touchdown raise alike -- and a pair on a cell the cursor
			// is not on never had one (tap 1 asks with acceptInput false; the
			// touchdown gate wants the finger inside the LIVE cursor, which
			// core has not moved ~110 ms after tap 1). Nothing later can put
			// it back: the round trip's own focus(true) arrives from message
			// context, where iOS grants DOM focus no keyboard and
			// TextInput._vulcanMayAcquireKeyboardFocus vetoes it outright once
			// the window is closed. Measured on the round-16 simulator tour:
			// focused edit at +1.6 s, fx pill, 123 chip, NO keyboard.
			//
			// So the raise lives on the one event of the pair that is both a
			// trusted gesture AND the last thing to touch focus before core
			// answers; it re-stamps the window, and the arm's own door guard
			// (TextInput.vulcanGestureDoorInFlight) then carries the keyboard
			// through the answer. Phone Calc only, and only the pair that is a
			// door IN: the exit pair above keeps its dismissal, and desktop,
			// tablet, Writer and Impress keep the branch byte for byte.
			if (this.vulcanRunBeganInFocusedEdit(clickInfo.vulcanOriginMode))
				app.map.focus(false);
			else if (this.isVulcanPhoneCalc()) app.map.focus(true);
			// B-0287: phone Impress's keyboard door, after the same fire and for
			// entry attempts only (a pair inside open text is a word select). The
			// Android-host gate lives in the callee: on the iPhone it is inert.
			// UI-B-004: an entry pair whose tap 1 core has ALREADY answered with
			// a picture or an embedded object under the finger gets no door at
			// all: no keyboard ever rises over it.
			else if (
				this.isVulcanPhoneImpress() &&
				app.map.isEditMode() &&
				this.vulcanImpressWantsCaret()
			) {
				clickInfo.vulcanImpressEntry = true;
				clickInfo.vulcanTap2At = Date.now();
				const known = this.vulcanImpressDoubleTapAnswer(clickInfo);
				if (
					typeof VulcanImpressTextEntry !== 'undefined' &&
					known !== 'none' &&
					known !== 'activate'
				)
					VulcanImpressTextEntry.openKeyboardDoor();
			}
		} else {
			// A range tap-again HOLDS its first click: sent now, the count 1
			// left click would collapse the multi-cell selection before the
			// cell menu timer (armVulcanCellMenu) can ask core about the
			// RANGE. The menu timer drops it; a second tap flushes it above;
			// any flush that closes the run drops it (flushPendingClick).
			//
			// ROUND-11 C2 widens the hold to the tap the toolbar armed for,
			// whatever the selection's shape: over a single cell the count 1
			// draws the `celladdress` that retires the popover this same
			// gesture is raising. The range clause stays as it was, so a tap
			// inside a marquee that raises nothing still holds and still
			// collapses on the flush exactly as round 10 left it.
			if (menuArmedForThisTap || (tapAgain && this.isVulcanRangeTap()))
				this.vulcanHeldRangeTapClick = clickInfo;
			// The click trailing a select-echo-owned press: the press
			// already selected by ordinal, so the click is forwarded only
			// when it has more to say (a press on text glyphs enters the
			// caret through core's quick-edit rule). Otherwise the first
			// click of a run always goes out, as it always did.
			else if (!VulcanImpressSelectEcho.consumesClick())
				this.sendClick(clickInfo, 1);

			// For future: Here, we are checking the window size to determine the view mode, we can also check the event type (touch/click).
			// The tap-again used to be denied the keyboard here, to spend it on
			// the cell menu instead. The menu moved to the long press
			// (shouldRaiseCellPopoverOnLongPress), so a second tap inside the
			// cell cursor is once again the phone's way into a cell and the
			// keyboard is the whole of what it asks for.
			// The mis-declared-phone clause lives in
			// acceptsMobileKeyboardFocus(), shared with onMiddleClick.
			let acceptInput: boolean | undefined;
			if (this.acceptsMobileKeyboardFocus())
				acceptInput = this.getMobileKeyboardVisibility();

			// ROUND-11 C2 — ONE GESTURE, ONE SURFACE. The toolbar is already
			// armed for this tap, and granting the keyboard on top of it would
			// answer a single deliberate second tap with a popover AND a caret.
			// The slow pair is the toolbar's; the QUICK pair is the editor's and
			// never reaches here (it takes the tap-2 branch above, and its door
			// is armed on the second finger-down in onVulcanTouchDown).
			//
			// Placed before tapAgainDoor is read, so the Return-means-newline
			// latch cannot arm off a tap that opens no cell.
			if (menuArmedForThisTap) acceptInput = false;

			// THE DOOR IS THE RAISE OVER THE LIVE CELL CURSOR, and it has to be
			// read HERE, before T-D can widen the raise below. Both branches
			// end at focus(true), but only this one is a door: T-D's tap lands
			// on ANOTHER cell and leaves the user in quick-entry posture there,
			// where Return commits and advances. Arming the latch off the
			// widened value would make Return insert a newline for the rest of
			// a serial-entry run — the round-9 defect, re-introduced from the
			// other side.
			const tapAgainDoor = acceptInput === true;

			// S3 T-D — SINGLE TAP ON ANOTHER CELL COMMITS AND MOVES, AND STAYS
			// IN FOCUSED EDIT.
			//
			// getMobileKeyboardVisibility() asks "is the finger inside the live
			// cell cursor?", which is the right question from a standing start
			// and the wrong one mid-edit: a tap on a DIFFERENT cell is outside
			// the cursor by definition, so it computed false and dropped the
			// keyboard on every cell-to-cell move. That is what made serial
			// data entry cost a keyboard round trip per cell.
			//
			// The commit still happens -- 'editorgotfocus' above ended the
			// session -- and this only decides whether the keyboard survives it.
			// The three gestures that DO close focused edit each dismiss at
			// their own site (the checkmark, the double tap above, the drag in
			// onMouseUp), so nothing here is left without an exit.
			if (this.vulcanRunBeganInFocusedEdit(clickInfo.vulcanOriginMode))
				acceptInput = true;

			app.map.focus(acceptInput);

			// A true here raised the keyboard over the LIVE cell cursor,
			// which is the tap-again — the same gesture door into in-cell
			// edit mode that onVulcanTouchDown arms for the double tap, so
			// Return inside means newline (VulcanCalcReturnKey.ts). Two
			// deliberate taps a second apart never reach that site: its gate
			// is the double-tap deferral's own clickTimer/clickCount state,
			// and a tap-again arriving outside the window is a first tap by
			// that measure. One door latch, one writer per door — without
			// this arm returnInsertsNewline() reads a false negative for
			// every tap-again edit, and each of its consumers (Map's
			// tap-away discriminator, TextInput's newline keycode) inherits
			// it. The previous tap's latch is already gone: onClick fires
			// 'editorgotfocus' above, which clears it at onFormulaBarBlur.
			//
			// Reads tapAgainDoor, NOT acceptInput: round-10 T-D above raises the
			// keyboard for a tap on another cell too, and that one is not a door.
			if (
				tapAgainDoor &&
				this.isVulcanPhoneCalc() &&
				window.VulcanCalcReturnKey
			)
				window.VulcanCalcReturnKey.enterCellEditDoor();

			// B-0094 — A TAP INSIDE THE CELL BEING EDITED KEEPS THE EDIT.
			//
			// The 'editorgotfocus' fire above ended the fx session, and on the
			// phone chrome that session end clears the client's caret mirror
			// (Toolbar vulcanEndCellEditSession: setCursorVisibility(false)),
			// trusting core to restate 'cursorvisible: true' if it keeps the
			// edit. This tap is that case -- core keeps the edit and only moves
			// its caret -- and a caret that never hid is never restated. The
			// stale mirror then reads core's next cursor message as "the edit
			// ended": the cursor-gone arm of _updateCursorAndOverlay calls
			// focus(false), which blurs on Android, so the keyboard drops after
			// the first key and the client falls to edit-ready over a live edit
			// (measured: 'abc', a tap on the cell, 'x' -> 'xabc', keyboard
			// gone). Put the mirror back for the door the tap just opened: a run
			// begun in focused edit, the finger inside the live cell cursor.
			// Android only (TextInput.vulcanAndroidKeyboardBranch). The iPhone
			// loses the keyboard the same way -- an explicit focus(false) is a
			// dismissal in phone Calc there too -- and is not changed here.
			// The fork's TextInput members are not on the map's declared
			// _textInput type: read them through an untyped local, as
			// VulcanCalcFunctionBrowser does.
			const vulcanTextInput: any = app.map._textInput;
			if (
				tapAgainDoor &&
				this.isVulcanPhoneCalc() &&
				this.vulcanRunBeganInFocusedEdit(clickInfo.vulcanOriginMode) &&
				vulcanTextInput &&
				typeof vulcanTextInput.vulcanAndroidKeyboardBranch === 'function' &&
				vulcanTextInput.vulcanAndroidKeyboardBranch()
			)
				app.setCursorVisibility(true);

			// THE TAP THAT ENGAGES THE CELL UNIT IS THE ENTRY TO EDIT-READY.
			// This line is the single place that has already decided what
			// this tap does with the keyboard, and that decision IS the
			// transition — computing it again earlier, or stamping from the
			// gesture end, would be a second opinion.
			//
			// It is NOT conditioned on the keyboard staying down. Doing that
			// made the transition fire on a SELECTION CHANGE by accident:
			// the one tap that raises the keyboard from a standing start is
			// a tap on the cell the cursor is ALREADY on, which is exactly
			// what a document reopened on a saved cursor hands you. Measured:
			// reopen, tap that cell, and the caret is granted while the mode
			// stays FULL VIEW — sheet strip up, style rail never drawn, and
			// the commit afterwards falls to FULL VIEW instead of EDIT-READY.
			// Stamping unconditionally is safe because edit-ready is the
			// monotone PARENT of full edit: the accessor tests the editing
			// markers first, so a tap that goes straight through to FULL EDIT
			// still reads FULL EDIT while this rides along underneath it.
			//
			// Deliberately inside this `else` — the first tap of a run. The
			// `if (this.clickTimer)` branch above is tap 2 of a double tap,
			// which goes FULL VIEW -> FULL EDIT and has already stamped
			// edit-ready from tap 1.
			//
			// The mutator is DECLARED on MapInterface now, beside its sibling
			// vulcanEndCellEditSession, so this is a typed call and not a
			// cast. It is declared OPTIONAL and the guard below is real: the
			// mocha rigs that drive this method build `app.map` by hand and
			// carry no Toolbar mixin, so an unguarded call takes 15 rows down
			// with it (measured). See the declaration's own note.
			if (this.isVulcanPhoneCalc() && app.map.vulcanEnterCalcEditReady)
				app.map.vulcanEnterCalcEditReady();
		}

		this.pendingClickInfo = clickInfo;

		this.clickTimer = app.timerRegistry.setTimeout(
			'clicktimer',
			() => {
				this.flushPendingClick(true);
			},
			this.multiClickWindow,
		);

		this.vulcanOpenLinkOnReadTap(buttons, modifier);
	}

	/**
	 * A tap on a hyperlink OPENS it while reading. Every reader on a phone does
	 * this, Google included, and ours did nothing at all.
	 *
	 * NOTHING WAS SUPPRESSING IT ON OUR SIDE -- core simply never fires
	 * `hyperlinkclicked`. sw's edit window wants either a read-only DocShell or
	 * KEY_MOD1 before it follows a link, and COOL only ever sets the read-only
	 * flag on the VIEW, while `HyperlinksWithCtrlClick` defaults true with no
	 * override in the tree. A finger cannot send Ctrl, so the condition can
	 * never be met by touch. Hunting for the client gate that "blocks" this is
	 * a dead end; there isn't one.
	 *
	 * So ask for the same thing the edit-mode context menu asks for.
	 * `.uno:OpenHyperlinkOnCursor` is declared `ReadOnlyDoc = TRUE` in
	 * svx.sdi, which is what lets it through the read-only dispatch filter, and
	 * it is inert when the cursor is not on a link -- so no guess about what
	 * was tapped is needed, and no hit-testing has to be duplicated here.
	 *
	 * ORDER MATTERS AND IS GUARANTEED: the click above already went out on the
	 * socket, and core processes messages in order, so the cursor is on the
	 * tapped word by the time this arrives. That is the whole reason this sits
	 * at the END of onClick rather than anywhere earlier.
	 *
	 * READ POSTURE ONLY, and that is not timidity. In edit mode a plain tap on
	 * a link has to place the caret so the link TEXT can be edited -- opening
	 * instead would make link text uneditable by touch, which trades one gap
	 * for a worse one. Ctrl+click still opens there, as it always did.
	 *
	 * Left button only: a right-click is the context menu's job.
	 */
	private vulcanOpenLinkOnReadTap(buttons: number, modifier: number): void {
		if (app.map.isEditMode()) return;
		if (buttons !== app.LOButtons.left) return;
		if (modifier !== 0) return;
		app.map.sendUnoCommand('.uno:OpenHyperlinkOnCursor');
	}

	// The middle button opens a hyperlink under the pointer, the same as
	// Ctrl+Click. Send a single left-button click carrying the platform's
	// link modifier so core reports the hyperlink. On macOS the link
	// modifier is the command key; elsewhere it is the control key.
	public onMiddleClick(point: cool.SimplePoint, e: MouseEvent): void {
		this.refreshPosition(point);

		const modifier = window.L.Browser.mac
			? app.UNOModifier.CTRLMAC
			: app.UNOModifier.CTRL;

		this.sendClick(
			{
				sendingPosition: this.currentPosition.clone(),
				buttons: app.LOButtons.left,
				modifier: modifier,
			},
			1,
		);

		// Same predicate family as onClick's raise (the mis-declared-phone
		// clause included): a middle click on a link carries no edit intent
		// that would justify a keyboard the phone chrome cannot dress.
		app.map.focus(
			this.acceptsMobileKeyboardFocus()
				? this.getMobileKeyboardVisibility()
				: undefined,
		);
	}

	/**
	 * True while a tap run is open: a tap has landed and the multi-click
	 * window has not closed, so the next tap joins it as a double (or triple)
	 * click. CalcTileLayer._vulcanRestoreAnchor reads it: nothing may move the
	 * grid under the run's pending tap, or tap 2 lands on another cell.
	 */
	public vulcanMultiClickPending(): boolean {
		return !!this.clickTimer;
	}

	// Send the deferred multi-click immediately and cancel the pending timer.
	// `fromClickTimer`: the 250 ms multi-click window ran out (the one caller
	// that may hold a phone-Impress double tap for core's answer, UI-B-004).
	// Every other caller (a new tap, a drag, a long press) sends as before.
	private flushPendingClick(fromClickTimer?: boolean): void {
		if (this.clickTimer) {
			app.timerRegistry.clearTimeout(this.clickTimer);
			this.clickTimer = null;
		}

		/*
			UI-B-004: on a phone, a double tap on a PICTURE edits no text and
			raises no keyboard (Google Slides' path); the picture stays
			selected with its bar. Core would put a caret inside it
			(fudraw.cxx:670-679), so the count 2 must not go when core's answer
			to tap 1 says the finger is on one (vulcanImpressDoubleTapAnswer).
			An embedded object (a chart, a Math formula, an embedded sheet)
			still gets its count 2, which activates it in place, but no
			keyboard: no caret comes. Measured on the device (lane-b
			runs/run3/dtap-gap, 8/8 pairs): that answer lands at tap 1 + 167-245
			ms, after tap 2 and before this flush. When it is LATER than the
			flush, the count 2 is held until it comes ('vulcandoubletaphold'),
			never past VULCAN_COUNT2_HOLD_CAP_MS from tap 2 (armed from tap 2's
			time, so a late flush does not move it); a new tap, a drag or a long
			press releases it first, in order. Every count 2 of an entry pair
			then extends the keyboard door (onDoorCount2Sent, below).
		*/
		const released = this.vulcanDoubleTapHold != null;
		if (released) {
			app.timerRegistry.clearTimeout(this.vulcanDoubleTapHold);
			this.vulcanDoubleTapHold = null;
		}
		const answer =
			this.clickCount === 2
				? this.vulcanImpressDoubleTapAnswer(this.pendingClickInfo)
				: 'n/a';
		if (answer === 'unknown' && !released && fromClickTimer) {
			// The cap counts from tap 2, not from this flush: a click timer
			// that fires late (the main thread busy with the keyboard's
			// relayout) must not push the count 2 later still. It does not read
			// the keyboard door: the door waits for this send, not the other
			// way round (onDoorCount2Sent).
			const capMs = Math.max(
				0,
				this.pendingClickInfo.vulcanTap2At +
					MouseControl.VULCAN_COUNT2_HOLD_CAP_MS -
					Date.now(),
			);
			this.vulcanDoubleTapHold = app.timerRegistry.setTimeout(
				'vulcandoubletaphold',
				() => {
					this.flushPendingClick();
				},
				capMs,
			);
			return;
		}

		const clickInfo = this.pendingClickInfo;
		if (clickInfo) {
			const beganFocused =
				this.clickCount > 1 &&
				this.vulcanRunBeganInFocusedEdit(clickInfo.vulcanOriginMode);

			if (beganFocused) {
				// S3 T-C, the other half. The count-2 click is what core reads
				// as "open the editor on this cell", so sending it would REOPEN
				// the edit the double tap just closed -- the exact inversion
				// the round-10 grammar names. Tap 1's count 1 already went out
				// and already moved the selection, so suppressing this loses no
				// information: the cell under the finger stays selected, and
				// the mode lands in sheet edit as ruled.
			} else if (answer === 'none' || answer === 'activate') {
				// UI-B-004: a picture. Tap 1's count 1 selected it and its bar
				// is up; nothing more goes to core. An embedded object: the
				// count 2 goes, and core activates it in place. Either way no
				// caret comes, so a keyboard tap 2 raised on the Android host
				// goes down now, with the answer, instead of at the door's
				// no-caret verdict.
				if (answer === 'activate') this.sendClick(clickInfo, 2);
				if (typeof VulcanImpressTextEntry !== 'undefined')
					VulcanImpressTextEntry.closeKeyboardDoor();
			} else if (this.clickCount === 3 && app.map._docLayer.isCalc()) {
				// Also send a double click for a triple click in Calc.
				this.sendClick(clickInfo, 2);
				this.sendClick(clickInfo, 3);
			} else if (this.clickCount > 1) {
				this.sendClick(clickInfo, this.clickCount);

				// THE DOOR RACE: the caret answers THIS count 2, so the keyboard
				// door tap 2 opened stays open until at least this send + the
				// door's floor, whenever and however the send happened: on time
				// at the flush, behind a late click timer, released by core's
				// answer, at the cap with no answer, or flushed first by a new
				// tap, a drag or a long press. A no-op when no door is pending
				// (the iPhone; a caret already in).
				if (
					clickInfo.vulcanImpressEntry &&
					typeof VulcanImpressTextEntry !== 'undefined'
				)
					VulcanImpressTextEntry.onDoorCount2Sent();

				// S3 T-A — the double tap is a DOOR into the cell editor, so
				// Return inside the edit it opens means newline, exactly as it
				// does through the other two doors (VulcanCalcReturnKey).
				//
				// The two existing arms cannot cover this one. onVulcanTouchDown
				// arms only when tap 2 lands inside the LIVE cell cursor, and
				// onClick's tap-again arm needs acceptInput true, which a first
				// tap on a not-yet-selected cell never has. So a double tap on a
				// cell the user had not already selected -- the ordinary way to
				// use the new entrance -- opened an edit whose Return advanced
				// instead of breaking the line. The writes are idempotent
				// booleans, so overlapping with the other two arms costs
				// nothing.
				if (
					this.isVulcanPhoneCalc() &&
					app.map._docLayer.isCalc() &&
					window.VulcanCalcReturnKey
				)
					window.VulcanCalcReturnKey.enterCellEditDoor();
			}
		}

		this.pendingClickInfo = null;
		this.clickCount = 0;
		// A held range tap-again's count 1 dies with the run it was part of:
		// by the time anything else flushes (a drag, a long press, the timer
		// on a lone tap), sending it would collapse the selection for a
		// gesture that is no longer a tap-again.
		this.vulcanHeldRangeTapClick = null;
	}

	onMultiTouchStart(e: TouchEvent): void {
		// Latch the surface this gesture will commit under before anything
		// else, unconditionally: a two-finger touch that never becomes a pinch
		// (the e.touches.length guard below) must not leave the previous
		// gesture's answer standing, and finishMultiTouchGesture reads these
		// after the gesture is over. Off the phone chrome both stay false and
		// the commit keeps upstream's direction-of-travel behavior.
		this.vulcanPinchPhone = this.isVulcanPhone();
		this.vulcanPinchPhoneCalc =
			this.vulcanPinchPhone && this.isVulcanPhoneCalc();

		// R8 S2 — a second finger is never the second half of a slide-turn
		// intent: the user is zooming, not navigating. Unconditional (an
		// unarmed clear is a no-op) so a two-finger touch that never becomes
		// a pinch still disqualifies. Null-guarded for the Object.create'd
		// mocha receivers, which carry no field initializers.
		if (this.vulcanImpressZoomIntent) this.vulcanImpressZoomIntent.clear();

		if (this.inSwipeAction) {
			this.containerObject.stopAnimating();
			// (d) The fifth gesture-end exit, and the only one that does not
			// go through cancelSwipe: this stops the animation directly and
			// leaves inSwipeAction set, so onDraw never reaches its settle and
			// no commit would otherwise happen for a fling a pinch caught.
			this.vulcanCommitGestureEnd();
		}

		if (e.touches.length !== 2) return;

		const centerX = Math.round(
			(e.touches[0].clientX + e.touches[1].clientX) * 0.5,
		);
		const centerY = Math.round(
			(e.touches[0].clientY + e.touches[1].clientY) * 0.5,
		);

		if (isNaN(centerX) || isNaN(centerY)) return;

		this.pinchLength = Math.sqrt(
			Math.pow(e.touches[0].clientX - e.touches[1].clientX, 2) +
				Math.pow(e.touches[0].clientY - e.touches[1].clientY, 2),
		);

		this.pinchStartCenter = { x: centerX, y: centerY };

		// Phone Impress: convert the pinch center through the SECTION world
		// and reconcile the map FROM it before the gesture reads anything.
		// The flush mirrors preZoomAnimation's own first line — a pending
		// release settle must land (restoring the per-frame twips writes)
		// before the layout is read at rest scale — and the reconcile puts
		// the leaflet view back onto the painted world so the whole pinch
		// pipeline (the panePortion in _getZoomDocPos included) computes
		// against a truthful pane. Every other surface keeps the stock
		// mouseEventToIntern conversion, and phone Impress falls back to it
		// whenever the section world cannot answer.
		this.vulcanImpressPinchDoc = undefined;
		let _pinchStartIntern: any = null;
		if (this.isVulcanPhoneImpress()) {
			const docLayer: any = app.map._docLayer;
			if (docLayer && typeof docLayer.flushVulcanPinchSettle === 'function')
				docLayer.flushVulcanPinchSettle();
			if (
				docLayer &&
				typeof docLayer._vulcanReconcileMapToPaintedWorld === 'function'
			)
				docLayer._vulcanReconcileMapToPaintedWorld();
			_pinchStartIntern = this.vulcanImpressPinchStartIntern(
				centerX,
				centerY,
			);
		}
		if (_pinchStartIntern === null)
			_pinchStartIntern = app.map.mouseEventToIntern({
				clientX: centerX,
				clientY: centerY,
			});
		app.map._docLayer.preZoomAnimation(_pinchStartIntern);
	}

	onMultiTouchMove(
		point: cool.SimplePoint,
		dragDistance: number,
		e: TouchEvent,
	): void {
		const centerX = Math.round(
			(e.touches[0].clientX + e.touches[1].clientX) * 0.5,
		);
		const centerY = Math.round(
			(e.touches[0].clientY + e.touches[1].clientY) * 0.5,
		);

		if (!this.pinchStartCenter || isNaN(centerX) || isNaN(centerY)) return;

		// we need to invert the offset or the map is moved in the opposite direction
		var offset = {
			x: centerX - this.pinchStartCenter.x,
			y: centerY - this.pinchStartCenter.y,
		};
		var center = {
			x: this.pinchStartCenter.x - offset.x,
			y: this.pinchStartCenter.y - offset.y,
		};

		const newPinchLength = Math.sqrt(
			Math.pow(e.touches[0].clientX - e.touches[1].clientX, 2) +
				Math.pow(e.touches[0].clientY - e.touches[1].clientY, 2),
		);
		const diff = newPinchLength - this.pinchLength;
		if (
			this.isVulcanPhoneImpress() &&
			this.pinchLength > 0 &&
			newPinchLength > 0
		) {
			// RATIO tracking: fingers 2x apart mean content 2x bigger, so the
			// mid-gesture target is start + log1.2(lengthRatio) rungs --
			// which is exactly getScaleZoom(ratio) on the map's own ladder
			// (InternPointUtil.SCALE; no second constant). Upstream's linear
			// gearing bought ~1.31x for a doubling. Mid-gesture ONLY:
			// zoomStep renders continuous values, and the release settle in
			// finishMultiTouchGesture stays the load-bearing integer commit.
			this.zoom = app.map.getScaleZoom(newPinchLength / this.pinchLength);
		} else {
			// Phone Calc AND phone Writer. Widened from the Calc-only gate:
			// upstream's 0.01 spends a full two-thumb spread (~300 px on a
			// 390 px phone) on three zoom units, an argument about the
			// GESTURE and the SCREEN, not spreadsheets. On reflowed Writer a
			// committed zoom re-votes the browse width (VulcanWriterReflow),
			// so the pinch is "make the text bigger", as in Docs.
			//
			// Substituting isVulcanPhoneCalc() here recovers the shipped
			// Calc-only gearing exactly; the constant itself is unchanged.
			const zoomPerCssPx = this.isVulcanPhonePinch()
				? MouseControl.pinchZoomPerCssPx
				: 0.01;
			this.zoom = app.map.getZoom() + diff * zoomPerCssPx;
		}
		this.zoom = app.map._limitZoom(this.zoom);

		// PHONE CALC STOPS HERE. It does not over-travel and spring back.
		//
		// The limit above is the map's GLOBAL minZoom of 1, so a phone Calc
		// pinch-out PAINTED its way down to a rung-1 hairline grid and
		// finishMultiTouchGesture's navigation floor hauled it back on
		// release. The founder ruled on the reference app: "You can't zoom in
		// past the allowed min size and then snap back out like in collabora;
		// it just won't let you (this is correct)." So the rung the gesture
		// may not pass is the rung the commit refuses, read the same way and
		// from the same constant -- the two cannot disagree. The min with the
		// live rung is load-bearing and its argument is on the commit-side
		// block; app.map.getZoom() is constant across a gesture (the map is
		// written only by setView at commit), so both sites evaluate it
		// identically.
		//
		// WRITER IS DELIBERATELY NOT HERE, and the asymmetry is the founder's
		// too: "docs allows you to do this, which is fine, because tiny text
		// doesn't look as bad as tiny gridlines." A document keeps the
		// undershoot and the eased settle back to its legibility rung.
		//
		// Gated on the latch onMultiTouchStart stamped rather than a live
		// doctype read, like the commit-side floors: one gesture, one
		// surface. Substituting `false` reproduces HEAD everywhere.
		if (this.vulcanPinchPhoneCalc) {
			const calcFloor = Math.min(
				MouseControl.pinchNavigationFloorCalc,
				app.map.getZoom(),
			);
			if (this.zoom < calcFloor) this.zoom = calcFloor;
		}

		// While the phone-Impress section-world anchor is latched, the moved
		// center derives from it by raw screen travel (see
		// vulcanImpressPinchMoveIntern); everywhere else — and whenever the
		// anchor could not be latched — the stock conversion stands.
		const vulcanSectionIntern = this.vulcanImpressPinchMoveIntern(center);
		this.origCenter =
			vulcanSectionIntern !== null
				? vulcanSectionIntern
				: app.map.mouseEventToIntern({
						clientX: center.x,
						clientY: center.y,
				  });

		if (app.map._docLayer.zoomStep)
			app.map._docLayer.zoomStep(this.zoom, this.origCenter);

		app.idleHandler.notifyActive();
	}

	// The rung the automatic fit would commit right now: the layer's own
	// _recalcZoom at the dpi-scaled live size -- the single authority the
	// refit path (_fitWidthZoom) reads -- then the same integer floor and
	// limit its tail applies. No constant is duplicated here. Null when the
	// layer cannot answer. Kept OUT of the finishMultiTouchGesture..onDrop
	// span, which ImpressPhonePinch.test.ts executes as source text.
	private vulcanImpressFitRung(): number | null {
		const docLayer: any = app.map._docLayer;
		if (!docLayer || !docLayer._recalcZoom || !docLayer._getMaxZoom)
			return null;
		const size: any = app.map.getSize();
		size.x *= app.dpiScale;
		size.y *= app.dpiScale;
		/*
		 * ASK IN THE REST FRAME, not the gesture frame. This runs from
		 * finishMultiTouchGesture, while the zoom animation's per-frame
		 * app.twipsToPixels writes (TilesSection.drawZoomFrame) are still
		 * standing: on a pinch-out the live scale is BELOW the rest scale,
		 * so every twips→px read inside _recalcZoom (fileSize.pX, the
		 * single-part substitution) shrinks, the fit ratio inflates, and
		 * getScaleZoom — anchored on the UNCHANGED map zoom — answers the
		 * true fit PLUS the whole pinch magnitude. The floor then commits
		 * ABOVE the deck's opening fit and one pinch makes the opening view
		 * unreachable by gesture. The painter's _zoomBaseTwipsToPixels is
		 * the rest snapshot preZoomAnimation took for exactly this gesture;
		 * park the globals there for the one call and restore the live
		 * values byte-for-byte (zoomStepEnd owns the real restore). Guarded
		 * so a layer without a painter — the mocha mirror rigs included —
		 * keeps the shipped path.
		 */
		const painter: any = docLayer._painter;
		const baseTtp =
			painter && typeof painter._zoomBaseTwipsToPixels === 'number'
				? painter._zoomBaseTwipsToPixels
				: null;
		let fit;
		if (baseTtp !== null && baseTtp > 0 && baseTtp !== app.twipsToPixels) {
			const liveTtp = app.twipsToPixels;
			const livePtt = app.pixelsToTwips;
			app.twipsToPixels = baseTtp;
			app.pixelsToTwips = 1 / baseTtp;
			try {
				fit = docLayer._recalcZoom(size, false, docLayer._getMaxZoom());
			} finally {
				app.twipsToPixels = liveTtp;
				app.pixelsToTwips = livePtt;
			}
		} else {
			fit = docLayer._recalcZoom(size, false, docLayer._getMaxZoom());
		}
		if (typeof fit !== 'number' || isNaN(fit)) return null;
		if (fit > 1) fit = Math.floor(fit);
		return app.map._limitZoom(fit);
	}

	/*
	 * Phone Impress pinch anchors: the document point under the fingers,
	 * converted through the SECTION world — the world that painted the
	 * pixels being pinched. Like vulcanImpressFitRung above, these are kept
	 * OUT of the finishMultiTouchGesture..onDrop span that
	 * ImpressPhonePinch.test.ts executes as source text.
	 *
	 * mouseEventToIntern is the map's container→layerPoint→intern chain
	 * (Map.js:1270) and knows nothing about the layout's document anchor or
	 * its scroll. On phone Impress the painted truth is the section world —
	 * activeLayout.viewedRectangle with the letterbox anchor
	 * (ViewLayout.ts:115-134) — and the two worlds part company whenever
	 * the layout moves without the map: the read-posture deck scroll pans
	 * only the layout, and ViewLayoutFileBased.restoreScrollAnchor
	 * deliberately re-anchors the painted world on zoomend with no
	 * corresponding map write. MEASURED on build #5 (i2b two-worlds trace,
	 * Dinosaurs dpr2): after one pinch commit the map sat a constant
	 * ~13.5k twips below the painted world — the fit letterbox height —
	 * and the second pinch committed the viewport at y=16803..21043 on a
	 * 10,801-twip slide. Tilecombine followed the bogus rect,
	 * haveAllTilesInView() read true, and the canvas painted background
	 * until the next gesture.
	 *
	 * So the pinch center goes through canvasToDocumentPoint — the one
	 * function that owns the anchor — and the map is handed the intern
	 * whose PROJECTION is that document point. project/unproject are pure
	 * functions of (point, zoom) (Map.js), so every consumer downstream —
	 * preZoomAnimation's _pinchStartCenter, the zoom frames, the commit's
	 * _getZoomMapCenter/unproject — anchors on the painted truth instead
	 * of the map's own view. Where the two worlds agree (edit posture at
	 * rest, desktop is never here) the conversion is numerically identical
	 * to mouseEventToIntern.
	 */
	private vulcanImpressPinchStartIntern(
		centerX: number,
		centerY: number,
	): any | null {
		const layout: any = app.activeDocument?.activeLayout;
		if (!layout || typeof layout.canvasToDocumentPoint !== 'function')
			return null;
		if (!app.sectionContainer?.getCanvasBoundingClientRect) return null;
		const rect = app.sectionContainer.getCanvasBoundingClientRect();
		const docPoint = layout.canvasToDocumentPoint(
			cool.SimplePoint.fromCorePixels([
				Math.round((centerX - rect.left) * app.dpiScale),
				Math.round((centerY - rect.top) * app.dpiScale),
			]),
		);
		if (isNaN(docPoint.pX) || isNaN(docPoint.pY)) return null;
		this.vulcanImpressPinchDoc = [docPoint.pX, docPoint.pY];
		return this.vulcanImpressDocIntern(docPoint.pX, docPoint.pY);
	}

	// The move-side companion: the latched start point plus raw finger
	// travel, in core pixels. Screen pixels are a scale-free quantity, so
	// the moved center is immune to the per-frame app.twipsToPixels writes
	// the zoom animation makes (TilesSection.drawZoomFrame) — a layout read
	// mid-gesture would mix frame-scaled and rest-scaled pixels. Null when
	// no anchor is latched (every non-phone-Impress surface).
	private vulcanImpressPinchMoveIntern(center: {
		x: number;
		y: number;
	}): any | null {
		const doc = this.vulcanImpressPinchDoc;
		if (doc === undefined || !this.pinchStartCenter) return null;
		return this.vulcanImpressDocIntern(
			doc[0] + (center.x - this.pinchStartCenter.x) * app.dpiScale,
			doc[1] + (center.y - this.pinchStartCenter.y) * app.dpiScale,
		);
	}

	// Document core px → the intern whose projection at the current zoom is
	// exactly that point (the same /dpiScale preZoomAnimation's project
	// multiplies back out).
	private vulcanImpressDocIntern(pX: number, pY: number): any {
		return app.map.unproject(
			new cool.Point(pX / app.dpiScale, pY / app.dpiScale),
			app.map.getZoom(),
		);
	}

	/*
	 * A two-finger TAP in phone Writer's EDIT posture re-arms typing.
	 *
	 * The tap is the caret's RESTORE gesture — the round-1 grammar exists so
	 * a re-grip after an accidental pinch/scroll brings the edit back. Its
	 * zoom terminal already restores the PAINT (the painter's Writer fast
	 * arm runs the finish callback, which re-shows the caret marker and the
	 * teardrops), but nothing on that path touched the keyboard latch:
	 * measured on build #8 (slot-02, the UC-D3 re-take and the r6-13 p1
	 * probe), the tap painted the caret at the correct position with
	 * acceptInput still false — typing went nowhere — while a plain direct
	 * tap at the same spot armed fine. The gesture's whole product is
	 * "restore typing", so its terminal arms input too. Running inside the
	 * touch-end call stack, the focus(true) is a within-gesture acquisition
	 * iOS honours.
	 *
	 * What must NOT arm, and does not:
	 *   - a real moving pinch (a numeric gesture zoom): its keyboard
	 *     contract is the settle's focus(canAcceptKeyboardInput()) —
	 *     restore the latch, never re-arm it;
	 *   - a cancelled gesture: it commits nothing and arms nothing;
	 *   - the read posture, where there is no typing to restore;
	 *   - no live text cursor: the tap restored no edit.
	 *
	 * Writer only, matching the restore this completes: Impress and Calc
	 * summon their keyboards at their own entry doors (CanvasTileLayer's
	 * cursor handler, the Calc double tap). The defensive window.mode read
	 * keeps minimal test rigs — which drive the gesture terminal with bare
	 * receivers and no mode global — on the shipped path.
	 */
	private vulcanWriterTwoFingerTapArm(
		cancelled: boolean,
		gestureZoom: number | undefined,
	): void {
		if (cancelled) return;
		if (typeof gestureZoom === 'number' && !isNaN(gestureZoom)) return;
		const mode: any = (<any>window).mode;
		if (!mode || typeof mode.isSmallScreenDevice !== 'function') return;
		if (!this.isVulcanPhoneWriter()) return;
		if (!app.map || typeof app.map.isEditMode !== 'function') return;
		if (!app.map.isEditMode()) return;
		if (!app.file || !app.file.textCursor || !app.file.textCursor.visible)
			return;
		if (typeof app.map.focus === 'function') app.map.focus(true);
	}

	onMultiTouchEnd(e: TouchEvent): void {
		this.finishMultiTouchGesture(false);
	}

	onMultiTouchCancel(e: TouchEvent): void {
		// All doctypes. A cancel commits nothing -- the cancelled arm's
		// mapUpdater is a no-op -- but it must still reach zoomStepEnd, the
		// only code that stops the zoom RAF loop, clears _inZoomAnim and
		// restores the per-frame app.twipsToPixels writes. The old
		// phone-Impress-only gate left all three latched on a cancelled
		// Calc/Writer pinch: the canvas repainted the zoom frame every frame,
		// every later tap converted through the stale twips mapping, and the
		// next two-finger tap committed the cancelled pinch's rung. The stock
		// tile-wait tail the old gate deferred is benign for this same-rung,
		// no-commit settle: nothing was refetched, so haveAllTilesInView()
		// exits the wait on its first check.
		this.finishMultiTouchGesture(true);
	}

	private finishMultiTouchGesture(cancelled: boolean): void {
		// A valid move writes a continuous zoom; a no-move gesture stays at its
		// start. Phone Impress settles to the nearest rung, while every stock path
		// retains its historical directional ceil/floor behavior. A cancellation
		// always settles the visual animation back to the current map rung without
		// committing its transient center or zoom.
		//
		// What `pinched` is for: a two-finger TAP never reaches onMultiTouchMove,
		// and `this.zoom` is an instance property that onMultiTouchStart does not
		// clear. So on a tap it holds either undefined (first gesture of the
		// session) or a STALE zoom left behind by an earlier pinch -- measured:
		// 4.6 still sitting there after the map had settled on 4.
		//
		// That guard is HYGIENE, NOT A BUG FIX, and an earlier version of this
		// comment claimed otherwise. The garbage is computed and then thrown away:
		// zoomStepEnd returns on its own !_inZoomAnim guard before it ever calls
		// mapUpdater, so neither the stale value nor the undefined/NaN variant
		// reaches the map. Verified on the rig -- a tap moves the map zoom 4 -> 4
		// on both builds. Clearing the field keeps the arithmetic honest for
		// anyone who later moves this code out from behind that guard.
		//
		// Every committed zoom, from every branch below, remains an INTEGER. The
		// tile pipeline addresses tiles at Math.round(app.map.getZoom()) while
		// _updateTileTwips scales from the raw value, so committing a fraction
		// would make the rendered tiles and the client's twips-to-pixels mapping
		// disagree.
		const oldZoom = app.map.getZoom();
		const finalCenter = this.origCenter;
		const pinched = typeof this.zoom === 'number' && !isNaN(this.zoom);
		let settledZoom = oldZoom;

		if (!cancelled && pinched) {
			if (this.isVulcanPhoneImpress()) settledZoom = Math.round(this.zoom);
			else {
				const zoomDelta = this.zoom - oldZoom;
				settledZoom =
					zoomDelta > 0 ? Math.ceil(this.zoom) : Math.floor(this.zoom);
			}
		}

		const finalZoom = app.map._limitZoom(settledZoom);

		// THE REST OF THE PHONE CHROME ROUNDS TOO, and phone Calc rounds by its
		// own grammar. Layered on top of the block above rather than folded into
		// it on purpose: mocha_tests/ImpressPhonePinch.test.ts executes that
		// block's exact source text and mutates it back to the legacy settle to
		// calibrate, so it stays byte-for-byte the shape that calibration knows.
		//
		// MEASURED ON THE RIG (6 pinches per magnitude, base zoom 5): this.zoom
		// is continuous -- getZoom() + pinchLengthDelta * zoomPerCssPx, so 100px
		// of finger travel is one whole level -- and rounding AWAY from oldZoom
		// meant there was no such thing as a small pinch. A 5px spread read
		// ceil(10.05) = 11, a 5px squeeze read floor(9.95) = 9. Every two-finger
		// touch committed a full level, a full-viewport refetch, and a frozen
		// input-disabled canvas behind it -- the owner's "janky loading
		// constantly", on the zoom axis. Settles per pinch read a flat 1.0 at
		// every magnitude before and 0.0 inside about +/- 0.4 levels after.
		//
		// Phone Calc keeps the more sensitive grammar it shipped with: nearest
		// rung inside pinchSnapDistance, direction of travel beyond it. Phone
		// Impress arrives at the same nearest rung here that the block above
		// already gave it. Desktop and tablet reach neither branch and keep
		// upstream's directional commit.
		let committedZoom = finalZoom;
		if (
			!cancelled &&
			this.vulcanPinchPhone &&
			typeof this.zoom === 'number' &&
			!isNaN(this.zoom)
		) {
			// Re-derived rather than read from `pinched`/`settledZoom`: the
			// calibration above replaces that whole block with its legacy form,
			// which declares neither name.
			const zoom = this.zoom;
			const nearest = Math.round(zoom);
			let snapped = nearest;
			if (
				this.vulcanPinchPhoneCalc &&
				Math.abs(zoom - nearest) >= MouseControl.pinchSnapDistance
			)
				snapped = zoom > oldZoom ? Math.ceil(zoom) : Math.floor(zoom);
			committedZoom = app.map._limitZoom(snapped);
		}

		// Pinch-out FLOOR: phone Impress never COMMITS below the fit rung
		// (map minZoom is a global 1, so nothing else stops a pinch-out at
		// ~69% of fit, and the _vulcanUserZoomed latch then pins it there).
		// Mid-gesture undershoot is allowed and springs back here. Gated and
		// re-derived like the block above -- the calibration mutation
		// replaces the settle block wholesale, so no name from it is read.
		if (
			!cancelled &&
			this.isVulcanPhoneImpress() &&
			typeof this.zoom === 'number' &&
			!isNaN(this.zoom)
		) {
			const fitRung = this.vulcanImpressFitRung();
			if (fitRung !== null && committedZoom < fitRung)
				committedZoom = fitRung;
		}

		// NAVIGATION FLOOR for phone Calc (G32, exhibit EX-12): the commit
		// never lands below pinchNavigationFloorCalc, whose derivation is on
		// the statics. It replaces a used-range fit floor that EX-12 revises.
		//
		// TAKING THE MIN WITH THE LIVE RUNG IS LOAD-BEARING, not decoration,
		// and it does two jobs. It stops the floor zooming the user IN on a
		// pinch-OUT from below it -- C0 again, and worse -- which is the only
		// job the fit floor's `<=` did. It ALSO makes a pinch-out started
		// below the floor a no-op rather than a slide: without the min, that
		// gesture falls straight through to the map minimum, and a rung-1
		// spreadsheet is a canvas nothing can navigate and no screenshot
		// detector reads as broken. Standing exactly ON the floor still
		// commits it again, since the min is then the floor itself.
		//
		// Gated and re-derived like the two blocks above -- the calibration
		// mutation in ImpressPhonePinch.test.ts replaces the settle block
		// wholesale, so no name from it is read here and the live rung is
		// asked for again rather than borrowed.
		if (
			!cancelled &&
			this.vulcanPinchPhone &&
			this.vulcanPinchPhoneCalc &&
			!this.isVulcanPhoneImpress() &&
			typeof this.zoom === 'number' &&
			!isNaN(this.zoom)
		) {
			const calcFloor = Math.min(
				MouseControl.pinchNavigationFloorCalc,
				app.map.getZoom(),
			);
			if (committedZoom < calcFloor)
				committedZoom = app.map._limitZoom(calcFloor);
		}

		// LEGIBILITY FLOOR for phone WRITER (R6-7 lever L5): the commit never
		// lands below the rung where body text stops being readable --
		// constant and its derivation on the statics above. Calc is excluded
		// by name because it has a navigation floor of its own
		// (pinchNavigationFloorCalc, the block immediately above -- the
		// derived fit floor this text used to name was deleted with it);
		// Impress keeps only its fit floor. Gated and re-derived like the
		// blocks above, for the same calibration reason.
		if (
			!cancelled &&
			this.vulcanPinchPhone &&
			!this.vulcanPinchPhoneCalc &&
			!this.isVulcanPhoneImpress() &&
			typeof this.zoom === 'number' &&
			!isNaN(this.zoom)
		) {
			const textFloor = MouseControl.pinchLegibilityFloorWriter;
			if (committedZoom < textFloor)
				committedZoom = app.map._limitZoom(textFloor);
		}

		// The eased routing below still needs the released fractional zoom
		// after the gesture state is cleared.
		const gestureZoom = this.zoom;

		this.pinchStartCenter = undefined;
		this.zoom = undefined;
		this.origCenter = undefined;
		this.pinchLength = 0;
		this.vulcanImpressPinchDoc = undefined;

		if (app.map._docLayer.zoomStepEnd) {
			const mapUpdater = cancelled
				? function (_newMapCenter: any) {
						return;
				  }
				: function (newMapCenter: any) {
						app.map.setView(newMapCenter, committedZoom);
				  };
			const showMarkers = function () {
				app.map._docLayer.postZoomAnimation();
			};
			// A committed rung further than pinchSettleEpsilon from the
			// released zoom would re-scale the view in one frame; ease it
			// through the layer's own zoomStep frames instead. The eased path
			// funnels into the very zoomStepEnd below, so the same-rung fast
			// arms, the settle restore and the user-zoom latch still run at
			// its end. The typeof read keeps minimal test layers on the
			// direct call.
			if (
				!cancelled &&
				this.vulcanPinchPhone &&
				typeof gestureZoom === 'number' &&
				!isNaN(gestureZoom) &&
				Math.abs(committedZoom - gestureZoom) >
					MouseControl.pinchSettleEpsilon &&
				typeof app.map._docLayer.runVulcanPinchSettleAnimation ===
					'function'
			) {
				app.map._docLayer.runVulcanPinchSettleAnimation(
					gestureZoom,
					committedZoom,
					finalCenter,
					mapUpdater,
					showMarkers,
				);
				return;
			}
			app.map._docLayer.zoomStepEnd(
				committedZoom,
				finalCenter,
				mapUpdater,
				showMarkers,
			);
		}

		// A two-finger TAP in phone Writer's edit posture restores TYPING,
		// not just the caret paint the terminal above re-shows — the whole
		// story is on vulcanWriterTwoFingerTapArm. The typeof read keeps the
		// source-extraction rigs, whose bare receivers carry no prototype,
		// on the shipped path.
		if (typeof this.vulcanWriterTwoFingerTapArm === 'function')
			this.vulcanWriterTwoFingerTapArm(cancelled, gestureZoom);
	}

	onDrop(position: cool.SimplePoint, e: DragEvent): void {
		this.refreshPosition(position);

		// The drop point, for placing what the paste inserts: the engine's
		// paste carries no position (VulcanImpressInsertPlace).
		VulcanImpressInsertPlace.armDrop(
			app.map._docLayer._selectedPart,
			this.currentPosition.x,
			this.currentPosition.y,
		);

		const modifier = MouseControl.readModifier(e);

		// Move the cursor, so that the insert position is as close to the drop coordinates as possible.
		this.postCoreMouseEvent(
			'buttondown',
			this.currentPosition,
			1,
			app.LOButtons.left,
			modifier,
		);
		this.postCoreMouseEvent(
			'buttonup',
			this.currentPosition,
			1,
			app.LOButtons.left,
			modifier,
		);

		if (app.map._clip && e.dataTransfer) {
			// Always capture the html content separate as we may lose it when we
			// pass the clipboard data to a different context (async calls, f.e.).
			const htmlText = e.dataTransfer.getData('text/html');
			app.map._clip.dataTransferToDocument(
				e.dataTransfer,
				/* preferInternal = */ false,
				htmlText,
			);
		}
	}
}
