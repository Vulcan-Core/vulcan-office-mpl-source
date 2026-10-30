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

/*
	This class is for the modifier handles of shape objects.
	Shape is rendered on the core side. Only the handles are drawn here and modification commands are sent to the core side.
*/

class HelperLineStyles {
	static initiated: false;
	static gridSolidStyle: string = null;
	static gridDashedStyle: string = null;
	static smartGuidesStyle: string = null;
	static handleFillStyle: string = null;
	static handleStrokeStyle: string = null;
	// The ring OUTSIDE a phone slide handle. Declared only by that doctype's
	// own section, so every other surface reads the transparent fallback and
	// paints no ring at all.
	static handleHaloStyle: string = null;
	static selectionFrameStyle: string = null;
	static marqueeStyle: string = null;
	static pageShadowSoftStyle: string = null;
	static pageShadowNearStyle: string = null;
	static pageBorderStyle: string = null;
	static darkModeListenerAdded = false;

	private static addListener() {
		app.map.on('darkmodechanged', function() {
			this.gridSolidStyle = null;
			this.gridDashedStyle = null;
			this.smartGuidesStyle = null;
			this.handleFillStyle = null;
			this.handleStrokeStyle = null;
			this.handleHaloStyle = null;
			this.selectionFrameStyle = null;
			this.marqueeStyle = null;
			this.pageShadowSoftStyle = null;
			this.pageShadowNearStyle = null;
			this.pageBorderStyle = null;
		}.bind(this));

		this.darkModeListenerAdded = true;
	}

	public static initiate() {
		if (!this.darkModeListenerAdded) this.addListener();

		const tempElement = document.createElement('div');

		tempElement.style.display = 'none';
		document.body.appendChild(tempElement);

		// The fallback arm is for a variable no palette declares: without it an
		// undeclared custom property leaves `color` at its inherited value and
		// the read silently returns the surrounding text colour.
		const readColor = (variable: string, fallback?: string): string => {
			tempElement.style.color = fallback
				? 'var(' + variable + ', ' + fallback + ')'
				: 'var(' + variable + ')';
			return window.getComputedStyle(tempElement).color;
		};

		this.gridSolidStyle = readColor('--color-grid-helper-line-solid');
		this.gridDashedStyle = readColor('--color-grid-helper-line-dashed');
		this.smartGuidesStyle = readColor('--color-smart-guides-helper-line');
		this.handleFillStyle = readColor('--color-shape-handle-fill');
		this.handleStrokeStyle = readColor('--color-shape-handle-stroke');
		this.handleHaloStyle = readColor('--color-shape-handle-halo', 'transparent');
		this.selectionFrameStyle = readColor('--color-shape-selection-frame');
		this.marqueeStyle = readColor('--color-primary');
		this.pageShadowSoftStyle = readColor('--vulcan-page-shadow-soft');
		this.pageShadowNearStyle = readColor('--vulcan-page-shadow-near');
		this.pageBorderStyle = readColor('--vulcan-glass-border');

		tempElement.remove();
	}
}

class ShapeHandlesSection extends CanvasSectionObject {
	processingOrder: number = app.CSections.ShapeHandlesSection.processingOrder;
	drawingOrder: number = app.CSections.ShapeHandlesSection.drawingOrder;
	zIndex: number = app.CSections.ShapeHandlesSection.zIndex;
	documentObject: boolean = true;
	showSection: boolean = false;

	/*
		Phone HIT geometry, CSS px — named statics because two files depend on
		the same two numbers (round-8 X-1: "splitting these loses it"):

		- this file's constructor and getRotationHandlePosition build the grab
		  boxes and the rotation standoff from them;
		- Control.ImpressSelectionBar.handleClearance() derives the band its
		  pill must not park in from them, so a future change here moves the
		  pill automatically instead of leaving a stale mirror that either
		  floats uselessly far from the object or sits on the rotation handle
		  (the exact defect that clearance was written to fix).

		phoneRotationStandoffCss is box-packing, not art: the corner boxes
		hold the 44 floor wholly outside the edge, the rotation box is another
		44, and 66 is where the two merely meet. It cannot shrink while the
		44 px floor stands, whatever the drawn art does.
	*/
	public static phoneHandleHitCss = 44;
	public static phoneRotationStandoffCss = 66;

	/*
		The touch double-tap window, ms: onClick builds a double tap from two
		touch taps on this section closer than this, and onDoubleClick spends a
		native dblclick that lands within it of a built one (its echo). One
		number, both readers: a native dblclick the builder did not handle
		needs a click at least this long after the tap before it, so it can
		never fall inside the echo bound.
	*/
	public static readonly doubleTapWindowMs: number = 250;

	/*
		M-0017 §D — PARITY, and the select-table chip's own arming condition.

		"With a live cell selection the body drag is INERT" is what the
		reference does too, so the condition below is kept exactly as it was
		when it lived inline in onMouseMove. It is extracted for ONE reason:
		VulcanImpressTableChipSection is the escape from this block, and an
		escape armed by a second copy of its own trigger is a drift waiting to
		happen. One address, both readers.

		The whole live-canvas family (a deck, or a PDF page canvas) takes the
		block — VulcanLiveCanvas is the one definition of that family. The
		chip that escapes it is phone grammar and the page canvas is desktop
		only, so on the phone this still reads exactly `presentation`.
	*/
	public static impressCellSelectionBlocksDrag(): boolean {
		if (!app.map || !VulcanLiveCanvas.isCanvasDocType(app.map.getDocType()))
			return false;

		// Tables get selected when multiple cells are selected. In this case, we check if DeleteRows is disabled.
		// Because in non-edit mode, deleteRows is disabled. So we can drag the table.
		const deleteRowsState =
			app.map.stateChangeHandler.getItemValue('.uno:DeleteRows');

		return deleteRowsState ? deleteRowsState !== 'disabled' : false;
	}

	/*
		Mid-gesture feedback vocabulary, pixel-scanned off the reference app's
		own rotate still (1080 px capture, 2.63 device px per CSS px): grey
		wireframe #999999; chip #323232 filled, bold white label, 196x109
		device px = 75x42 CSS px with 20 px of side padding and a ~3 px radius.

		chipStandoffCss is the chip centre ABOVE the dragged handle, derived
		from that one still (chip centre sat 213 device px over the handle's
		destination position) - the readout has to clear the fingertip that is
		holding the handle, which is why it is not centred on the object.
	*/
	public static phoneGestureFeedback = {
		wireframeStroke: '#999999',
		chipFill: '#323232',
		chipTextFill: '#ffffff',
		chipHeightCss: 42,
		chipPaddingCss: 20,
		chipRadiusCss: 3,
		chipFontCss: 20,
		chipStandoffCss: 80,
	};

	constructor (info: any) {
		super(app.CSections.ShapeHandlesSection.name);

		this.sectionProperties.info = null;
		this.sectionProperties.handles = [];
		this.sectionProperties.subSections = [];
		this.sectionProperties.activeHandleIndex = null;
		/*
			Phone chrome, every doctype but one exclusion. Three parts:

			- isSmallScreenDevice() alone is not the gate. ?vulcanChrome=desktop
			  forces the desktop chrome onto a small screen, and then the desktop
			  geometry must come back with it, so the marker class is the second
			  half.
			- NOT Calc RTL, the third. This gate used to be
			  `_docType === 'presentation'` - the Impress lane scoped its 44px
			  boxes to the slide canvas for blast radius - which left every
			  chart, image and shape in phone Calc, Writer and Draw on the drawn
			  12px targets: 27% of the 44px finger floor, an ergonomic argument
			  that was never doctype-specific. The doctype half is dropped and
			  the whole treatment travels - hit sizes, outward anchors, the
			  grab-offset correction, the Voronoi overlap arbitration, the
			  small-shape crop clamp - because they are one mechanism: a 44px
			  box without the outward anchor tiles the shape's drag-to-move
			  interior, and without the grab offset it teleports the corner up
			  to 22px to the fingertip (ShapeHandleScalingSubSection has the
			  measurements).
			  The one deliberate survivor is Calc RTL: the subsection's
			  grab-offset and overlap maths are written in unmirrored
			  section-local coordinates, and Calc RTL mirrors the X axis
			  (mouseToDocX is `position - pX` there), so shipping them as-is
			  would push corrections in the wrong direction. An RTL sheet keeps
			  the stock handles - exactly HEAD's behaviour - until the mirrored
			  signs travel too. isCalcRTL() is per-sheet state, read once here
			  like the rest: a sheet switch tears down the selection, so it
			  cannot go stale within one section's life.

			NOTE this is now a different scope than
			MouseControl.isVulcanPhoneImpress, which keeps its presentation
			term: that flag gates slide TAP GRAMMAR, this one gates handle
			GEOMETRY. The two grammar behaviours in this file — the spent
			tap-again and the glyph the sub section paints — carry their own
			explicit presentation terms (vulcanPhoneTapAgainIsInert).
		*/
		this.sectionProperties.phoneChrome =
			(<any>window).mode.isSmallScreenDevice() &&
			document.documentElement.classList.contains('vulcan-mobile-chrome') &&
			!!app.map._docLayer &&
			!app.map._docLayer.isCalcRTL();

		// The DRAWN size of a handle and its GRAB box are two different numbers
		// on a phone - the same split CellSelectionHandleSection makes between
		// circleRadius and hitRadius. In this architecture the section bounds
		// ARE the hit area (findSectionContainingPoint -> section.isHit), there
		// is no separate hit geometry anywhere, so a 12 px drawn handle was
		// also a 12 px target: 27% of the 44 px finger floor, with ~9 px of
		// actual art inside it. Phones keep the art and grow the box; desktop
		// and tablet keep box == art exactly as before. These are canvas
		// pixels, so the bigger box costs no layout space at all.
		this.sectionProperties.handleWidth = 12 * app.dpiScale; // Drawn.
		this.sectionProperties.handleHeight = 12 * app.dpiScale; // Drawn.
		this.sectionProperties.handleMaxHitWidth =
			ShapeHandlesSection.phoneHandleHitCss * app.dpiScale;
		// All eight phone targets keep the 44 px floor. Their boxes are displaced
		// OUTWARD below, so none of that area covers the shape's drag-to-move
		// interior and no per-shape size clamp is needed.
		this.sectionProperties.handleHitWidth = this.sectionProperties.phoneChrome
			? this.sectionProperties.handleMaxHitWidth
			: this.sectionProperties.handleWidth;
		this.sectionProperties.handleHitHeight = this.sectionProperties.phoneChrome
			? this.sectionProperties.handleMaxHitWidth
			: this.sectionProperties.handleHeight;
		this.sectionProperties.anchorWidth = 20 * app.dpiScale;
		this.sectionProperties.anchorHeight = 20 * app.dpiScale;
		this.sectionProperties.rotationHandleWidth = 15 * app.dpiScale; // Drawn.
		this.sectionProperties.rotationHandleHeight = 15 * app.dpiScale; // Drawn.
		// The rotation handle stands off OUTSIDE the shape, so it never competes
		// with the drag-to-move interior and keeps the full 44 whatever the
		// shape's size.
		this.sectionProperties.rotationHandleHitWidth = this.sectionProperties.phoneChrome
			? this.sectionProperties.handleMaxHitWidth
			: this.sectionProperties.rotationHandleWidth;
		this.sectionProperties.rotationHandleHitHeight = this.sectionProperties.phoneChrome
			? this.sectionProperties.handleMaxHitWidth
			: this.sectionProperties.rotationHandleHeight;
		// Glue points deliberately do NOT get a phone hit box. The sub section
		// defines no mouse handler at all and its boundsList is just itself, so
		// a grown box would swallow taps into a dead zone instead of letting
		// them reach the shape underneath. Growing them needs the sub section
		// to become interactive first; tracked as its own defect.
		this.sectionProperties.gluePointRadius = 10 * app.dpiScale;
		this.sectionProperties.subSectionPrefix = 'shape-handle-';
		this.sectionProperties.svg = null; // This is for preview of modifications.
		this.sectionProperties.hasVideo = false; // Don't hide svg when there is video content.
		this.sectionProperties.shapeRectangleProperties = null; // Not null when there are scaling handles.
		this.sectionProperties.liveShapeRecProps = null; // Ghost geometry while a scaling drag is live (the live resize frame reads it).
		// The snap probe's state: one bag, shared by shape with the detached
		// gesture probe (createGestureSnapProbe), so every probe method and
		// guide painter reads either host without knowing which.
		Object.assign(this.sectionProperties, ShapeHandlesSection.newSnapState());
		this.sectionProperties.mathObjectBorderColor = 'red'; // Border color for Math objects.
		this.sectionProperties.lastTapTime = 0;
		// When onClick last built a double tap (Date.now()); 0 = never.
		this.sectionProperties.vulcanBuiltDoubleTapAt = 0;
		this.sectionProperties.clickTimer = null;
		this.sectionProperties.viewedRectangleOnMouseDown = new cool.SimpleRectangle(0, 0, 0, 0);
		this.sectionProperties.initialPosition = this.position.slice();
		this.sectionProperties.positionOnMouseDown = new cool.SimplePoint(0, 0);

		// Drag preview polyline sent by core while a handle is dragged.
		// Array of polygons, each an array of [x, y] in core pixels.
		this.sectionProperties.shapeDragPreviewPolygons = null;
		this.sectionProperties.shapeDragPreviewRequestTime = null;
		this.sectionProperties.queuedShapeDragPreview = null;

		// Mid-gesture feedback: the gesture being delivered right now, named by
		// its target section, the sub sections it took down, and the rotate
		// readout the rotation sub section publishes into it.
		this.sectionProperties.activeGesture = null;
		this.sectionProperties.activeGestureTarget = null;
		this.sectionProperties.suppressedSubSections = null;
		this.sectionProperties.rotationAngleHundredths = null;
		this.sectionProperties.rotationScreenRadians = 0;
		this.sectionProperties.rotationChipAnchor = null;

		this.refreshInfo(info);

		if (HelperLineStyles.gridDashedStyle === null) HelperLineStyles.initiate();

		// Escape cancels an in-progress drag (PowerPoint behavior). Capture
		// phase, so the map's keyboard handler doesn't deselect the shape.
		this.sectionProperties.escapeListener = (ke: KeyboardEvent) => {
			if (ke.key !== 'Escape' || !this.containerObject.isDraggingSomething())
				return;

			const target = this.containerObject.targetSection;
			if (target !== this.name && !(target && target.startsWith(this.sectionProperties.subSectionPrefix)))
				return;

			ke.stopPropagation();
			ke.preventDefault();
			this.cancelDrag();
		};
		window.addEventListener('keydown', this.sectionProperties.escapeListener, true);
	}

	public onRemove(): void {
		window.removeEventListener('keydown', this.sectionProperties.escapeListener, true);
	}

	// The snap probe's state, one bag for both hosts: a landed section's
	// sectionProperties and the detached probe a one-gesture drag runs before
	// its selection lands (createGestureSnapProbe). Same fields, same
	// defaults, so checkHelperLinesAndSnapPoints, the guide painters and
	// snappedDragDelta read either without knowing which.
	public static newSnapState(): any {
		return {
			lastDragDistance: [0, 0],
			snapOffsetX: 0, // Distance from the dragged shape's left edge to the point that snapped.
			snapOffsetY: 0, // Distance from the dragged shape's top edge to the point that snapped.
			// These are for snapping the objects to the same level with others' boundaries.
			closestX: null,
			closestY: null,
			// When the snap is a center-to-center match, these hold the [x, y] center
			// (in pixels) of the other object so we can mark it with a red dot.
			centerSnapX: null,
			centerSnapY: null,
			// True when the active object's own center is what snapped to another
			// object's center on that axis (true center-to-center alignment).
			centerToCenterX: false,
			centerToCenterY: false,
			// [x, y] center (in pixels) of the active (dragged or scaled) object,
			// set when a center-to-center match happens so we can mark it too.
			draggedCenter: null,
			// Equal-spacing (distribution) guides: when the dragged object sits
			// between two neighbors with (nearly) equal gaps, we snap it to the
			// exact middle and draw the two gap segments with arrowheads.
			// { ordinate: <cross-axis position>, segments: [[from, to], [from, to]] } or null.
			gapGuideX: null,
			gapGuideY: null,
			// Draw-only multi-guide lists: every alignment that still holds once the
			// winning snap is applied (PowerPoint draws them all). The snap DECISION
			// stays the single closestX / closestY winner; these only add lines.
			guideLinesX: [],
			guideLinesY: [],
			// Draw-only "level" line: set when the dragged shape's top joins a row
			// of two or more other tops on the snapped ordinate ("each layer
			// should be level"). Never a snap decision — only a stronger line.
			levelGuideY: null,
			// Who won each axis ('object' | 'grid' | null): object alignments and
			// grid snap blend per axis, and each draws its own guide style.
			snapSourceX: null,
			snapSourceY: null,
			// True while a drag was cancelled with Escape and the button is still down.
			dragCancelled: false,
		};
	}

	// A detached snap probe for the one-gesture drag (VulcanImpressSelectEcho):
	// the press-time selection has not landed, so no handles section exists
	// yet, but the vector payload already knows every object's snap
	// rectangle. The probe IS this section's prototype over a fresh snap
	// state — the same checkHelperLinesAndSnapPoints, the same guide
	// painters, the same snappedDragDelta — with the target list supplied by
	// the caller instead of read from the landed selection. So the guides
	// and the magnet on the first frame of a first-click drag are, to the
	// pixel, what the landed section computes when it takes over one round
	// trip later. `objects` are [x, y, w, h, ordNum] in core pixels, the
	// layout of extraInfo.ObjectRectangles; `excluded` are the dragged
	// ordinals (never snap targets).
	public static createGestureSnapProbe(
		container: any,
		position: number[],
		size: number[],
		targets: () => { objects: number[][]; excluded: Set<number> },
	): ShapeHandlesSection {
		const probe: any = Object.create(ShapeHandlesSection.prototype);
		probe.name = 'gesture-snap-probe';
		probe.containerObject = container;
		probe.position = position.slice();
		probe.size = size.slice();
		probe.myTopLeft = [0, 0];
		probe.context = null;
		probe.sectionProperties = ShapeHandlesSection.newSnapState();
		probe.getSnapObjectRectangles = () => targets().objects;
		probe.getSnapRectangles = () => {
			const rectangles = targets().objects.slice();
			const slide = ShapeHandlesSection.slideSnapRectangle();
			if (slide) rectangles.push(slide);
			return rectangles;
		};
		probe.getExcludedOrdNums = () => targets().excluded;
		return probe as ShapeHandlesSection;
	}

	// Paint this probe's guides into another section's context — the
	// marquee's, for the one-gesture drag before its selection lands. The
	// same two painters the landed section runs from onDraw, in the absolute
	// canvas frame.
	public paintGuidesInto(context: CanvasRenderingContext2D): void {
		if (!this.anythingToDraw()) return;
		if (HelperLineStyles.gridDashedStyle === null) HelperLineStyles.initiate();
		this.context = context;
		this.myTopLeft = [0, 0];
		context.save();
		context.setTransform(1, 0, 0, 1, 0, 0);
		this.drawGridHelperLines();
		this.drawShapeAlignmentHelperLines();
		context.restore();
	}

	// Modifier that temporarily disables all client-side snapping while held
	// (Alt on Windows/Linux, Option/Cmd on Mac) — PowerPoint behavior.
	public static snapBypassed(e?: MouseEvent): boolean {
		return e ? (e.altKey || e.metaKey) : false;
	}

	public isDragCancelled(): boolean {
		return this.sectionProperties.dragCancelled;
	}

	// True while the object BODY (not a grip) is being drag-moved: frame
	// and content ride the drag, so stationary grip dots would trail the
	// old position. The grip painters stand down on this and return on
	// drop or Escape-cancel (reference-app behavior).
	public isMoveDragLive(): boolean {
		if (this.containerObject.isDraggingSomething() && !this.isDragCancelled()) {
			if (this.containerObject.targetSection === this.name) return true;
			// Select-and-drag in ONE gesture: the drag targets the
			// document surface (this section did not exist at the press)
			// while the content echo translates the object — the grips
			// stand down exactly as they do for a handles-target move.
			if (ShapeHandlesSection.gestureDragTravel() !== null) return true;
		}
		// Post-drop travel hold: the frame rides the release travel until
		// the moved rectangle lands; grips at the pre-drop rect would
		// strand for that round trip, so they wait for the same message.
		return VulcanImpressSelectEcho.getReleaseTravel() !== null;
	}

	// Read and reset the cancel flag; called from mouse-up handlers.
	public consumeDragCancelled(): boolean {
		const cancelled = this.sectionProperties.dragCancelled;
		this.sectionProperties.dragCancelled = false;
		return cancelled;
	}

	public clearHelperLines(): void {
		this.sectionProperties.closestX = null;
		this.sectionProperties.closestY = null;
		this.sectionProperties.centerSnapX = null;
		this.sectionProperties.centerSnapY = null;
		this.sectionProperties.centerToCenterX = false;
		this.sectionProperties.centerToCenterY = false;
		this.sectionProperties.draggedCenter = null;
		this.sectionProperties.gapGuideX = null;
		this.sectionProperties.gapGuideY = null;
		this.sectionProperties.guideLinesX = [];
		this.sectionProperties.guideLinesY = [];
		this.sectionProperties.levelGuideY = null;
		this.sectionProperties.snapSourceX = null;
		this.sectionProperties.snapSourceY = null;
		this.sectionProperties.liveShapeRecProps = null;
		this.containerObject.requestReDraw();
	}

	private cancelDrag(): void {
		this.sectionProperties.dragCancelled = true;
		this.hideSVG();
		// A cancelled resize drops its live re-wrap preview at once (no
		// commit follows, so no authoritative tree would clear it).
		VulcanImpressResizeReflow.clear();

		// Drop any live scale/rotate transform so the next drag starts from a
		// clean ghost, and put it back over the object's real position.
		if (this.sectionProperties.svg) {
			this.sectionProperties.svg.style.transform = '';
			if (this.sectionProperties.svg.children[0])
				this.sectionProperties.svg.children[0].style.transform = '';
			this.updateSVGPosition();
		}

		this.clearShapeDragPreview();
		this.sectionProperties.closestX = null;
		this.sectionProperties.closestY = null;
		this.sectionProperties.centerSnapX = null;
		this.sectionProperties.centerSnapY = null;
		this.sectionProperties.draggedCenter = null;
		this.sectionProperties.gapGuideX = null;
		this.sectionProperties.gapGuideY = null;
		this.sectionProperties.levelGuideY = null;
		this.sectionProperties.lastDragDistance = [0, 0];
		this.endGestureFeedback();

		// Put the handles back where the last core update left them.
		this.refreshInfo(this.sectionProperties.info);
		app.map.fire('scrollvelocity', { vx: 0, vy: 0 });
		this.containerObject.requestReDraw();
	}

	public refreshInfo(info: any) {
		this.sectionProperties.info = info;
		this.convertToTileTwipsIfNeeded();
		this.getHandles();
		this.updateSize();

		if (GraphicSelection?.extraInfo?.isMathObject === true) {
			// Math objects don't need handles. They are not resizable or rotateable.
			// In this case, we want to draw a rectangle around it. So the user can be sure that they selected the object.

			// For drawing the rectangle, use CanvasSectionContainer's awesome border drawing feature.
			this.borderColor = this.sectionProperties.mathObjectBorderColor;
		} else {
			this.addSubSections();
			this.sectionProperties.shapeRectangleProperties = this.getShapeRectangleProperties();
			this.calculateInitialAnglesOfShapeHandlers();
			this.borderColor = null;
		}
	}

	private convertToTileTwipsIfNeeded() {
		if (app.map._docLayer._docType !== 'spreadsheet' || !app.map._docLayer.sheetGeometry)
			return;

		const kinds = this.sectionProperties.info?.handles?.kinds;
		if (!kinds) return;

		// Core can send handle X coordinates as negative print twips in RTL
		// (its internal sign convention). Normalize to positive so the
		// downstream print->tile conversion and doc->view mapping work.
		const normalize = (entry: any): void => {
			const rawX = parseInt(entry.point.x);
			const rawY = parseInt(entry.point.y);
			const point = new cool.SimplePoint(Math.abs(rawX), rawY);
			app.map._docLayer.sheetGeometry.convertToTileTwips(point);
			entry.point.x = point.x;
			entry.point.y = point.y;
		};

		// Core groups handles into rectangle / poly / custom / anchor / others
		// (see SdrMarkView in svdmrkv.cxx). Convert positions for every group,
		// not just rectangle, otherwise custom-shape adjustment handles (kind
		// 22) and others render in print twips while the shape is in tile
		// twips, leaving them visually detached from the shape.
		for (const group of Object.values(kinds) as Record<string, any[]>[]) {
			if (!group) continue;
			for (const handles of Object.values(group)) {
				if (!Array.isArray(handles)) continue;
				for (const handle of handles) {
					const point = new cool.SimplePoint(Math.abs(parseInt(handle.point.x)), parseInt(handle.point.y));
					app.map._docLayer.sheetGeometry.convertToTileTwips(point);
					handle.point.x = point.x;
					handle.point.y = point.y;
				}
			}
		}

		if (Array.isArray(kinds.custom?.['22'])) {
			for (const entry of kinds.custom['22']) normalize(entry);
		}
	}

	public calculateInitialAnglesOfShapeHandlers(shapeRecProps?: any) {
		if (this.sectionProperties.info?.handles?.kinds?.rectangle) {
			if (!shapeRecProps)
				shapeRecProps = this.sectionProperties.shapeRectangleProperties;

			const halfDiagonal = Math.pow(Math.pow(shapeRecProps.width * 0.5, 2) + Math.pow(shapeRecProps.height * 0.5, 2), 0.5);
			// In Calc RTL, convertToTileTwipsIfNeeded's abs flips the handle
			// doc-X: core's internal topLeft (min internal X) becomes the
			// shape's doc-max-X (= visual top-left on the mirrored canvas).
			// So kind '1' is at (+w/2, +h/2) relative to center, not (-w/2, +h/2).
			// Flip the X factor for every non-vertical handle.
			const xSign = app.map._docLayer.isCalcRTL() ? 1 : -1;
			for (let i = 0; i < this.sectionProperties.subSections.length; i++) {
				const subSection = this.sectionProperties.subSections[i];

				if (subSection.sectionProperties.ownInfo.kind === '1') {
					subSection.sectionProperties.distanceToCenter = halfDiagonal;
					subSection.sectionProperties.initialAngle = Math.atan2(shapeRecProps.height * 0.5, xSign * shapeRecProps.width * 0.5);
				}
				else if (subSection.sectionProperties.ownInfo.kind === '2') {
					subSection.sectionProperties.distanceToCenter = shapeRecProps.height * 0.5;
					subSection.sectionProperties.initialAngle = Math.atan2(shapeRecProps.height * 0.5, 0);
				}
				else if (subSection.sectionProperties.ownInfo.kind === '3') {
					subSection.sectionProperties.distanceToCenter = halfDiagonal;
					subSection.sectionProperties.initialAngle = Math.atan2(shapeRecProps.height * 0.5, -xSign * shapeRecProps.width * 0.5);
				}
				else if (subSection.sectionProperties.ownInfo.kind === '4') {
					subSection.sectionProperties.distanceToCenter = shapeRecProps.width * 0.5;
					subSection.sectionProperties.initialAngle = Math.atan2(0, xSign * shapeRecProps.width * 0.5);
				}
				else if (subSection.sectionProperties.ownInfo.kind === '5') {
					subSection.sectionProperties.distanceToCenter = shapeRecProps.width * 0.5;
					subSection.sectionProperties.initialAngle = Math.atan2(0, -xSign * shapeRecProps.width * 0.5);
				}
				else if (subSection.sectionProperties.ownInfo.kind === '6') {
					subSection.sectionProperties.distanceToCenter = halfDiagonal;
					subSection.sectionProperties.initialAngle = Math.atan2(-shapeRecProps.height * 0.5, xSign * shapeRecProps.width * 0.5);
				}
				else if (subSection.sectionProperties.ownInfo.kind === '7') {
					subSection.sectionProperties.distanceToCenter = shapeRecProps.height * 0.5;
					subSection.sectionProperties.initialAngle = Math.atan2(-shapeRecProps.height * 0.5, 0);
				}
				else if (subSection.sectionProperties.ownInfo.kind === '8') {
					subSection.sectionProperties.distanceToCenter = halfDiagonal;
					subSection.sectionProperties.initialAngle = Math.atan2(-shapeRecProps.height * 0.5, -xSign * shapeRecProps.width * 0.5);
				}
			}
		}
	}

	getShapeWidth(twips = true) {
		let middleLeft = this.sectionProperties.info.handles.kinds.rectangle['4'][0];
		middleLeft = new cool.SimplePoint(parseInt(middleLeft.point.x), parseInt(middleLeft.point.y));

		let middleRight = this.sectionProperties.info.handles.kinds.rectangle['5'][0];
		middleRight = new cool.SimplePoint(parseInt(middleRight.point.x), parseInt(middleRight.point.y));

		if (twips)
			return Math.abs(middleLeft.distanceTo(middleRight.toArray()));
		else
			return Math.abs(middleLeft.pDistanceTo(middleRight.pToArray()));
	}

	getShapeHeight(twips = true) {
		let topMiddle = this.sectionProperties.info.handles.kinds.rectangle['2'][0];
		topMiddle = new cool.SimplePoint(parseInt(topMiddle.point.x), parseInt(topMiddle.point.y));

		let bottomMiddle = this.sectionProperties.info.handles.kinds.rectangle['7'][0];
		bottomMiddle = new cool.SimplePoint(parseInt(bottomMiddle.point.x), parseInt(bottomMiddle.point.y));

		if (twips)
			return Math.abs(topMiddle.distanceTo(bottomMiddle.toArray()));
		else
			return Math.abs(topMiddle.pDistanceTo(bottomMiddle.pToArray()))
	}

	/*
		This is also sent from the core side.
	*/
	getShapeAngleRadians() {
		let topMiddle = this.sectionProperties.info.handles.kinds.rectangle['2'][0];
		topMiddle = new cool.SimplePoint(parseInt(topMiddle.point.x), parseInt(topMiddle.point.y));

		const center = this.getShapeCenter();

		const radians = Math.atan2((center.y - topMiddle.y), (topMiddle.x - center.x));
		return radians - Math.PI * 0.5;
	}

	private getShapeCenter() {
		let topLeft = this.sectionProperties.info.handles.kinds.rectangle['1'][0];
		topLeft = new cool.SimplePoint(parseInt(topLeft.point.x), parseInt(topLeft.point.y));

		let bottomRight = this.sectionProperties.info.handles.kinds.rectangle['8'][0];
		bottomRight = new cool.SimplePoint(parseInt(bottomRight.point.x), parseInt(bottomRight.point.y));

		const center = new cool.SimplePoint((topLeft.x + bottomRight.x) * 0.5, (topLeft.y + bottomRight.y) * 0.5);

		return center;
	}

	/*
		Selection rectangle is different from the object's inner rectangle.
		Handlers are positioned based on object's inner rectangle (~borders). So we need to get the object's inner rectangle and its rotation angle.
	*/
	private getShapeRectangleProperties() {
		if (!this.sectionProperties.info.handles?.kinds?.rectangle)
			return null;

		return {
			angleRadian: this.getShapeAngleRadians(),
			center: this.getShapeCenter(),
			height: this.getShapeHeight(false),
			width: this.getShapeWidth(false)
		};
	}

	/*
		All eight rectangle handles are real verbs, not decoration: the four
		midpoints stretch one axis and the four corners resize proportionally for
		images. Keep all eight on the phone. Their invisible boxes are separated
		by phoneHandleAnchor() rather than by deleting half the capability.
	*/
	private scalingHandleKinds(): string[] {
		return ['1', '2', '3', '4', '5', '6', '7', '8'];
	}

	/*
		Where the visible dot sits inside its invisible grab box.

		Stock centres the dot at [half, half]. Phone Impress places the box on the
		OUTSIDE of the selected object. `kind` identifies the handle in the
		SHAPE'S frame, so rotate that outward vector by the core-reported shape
		angle, then quantize each screen component to left/centre/right and
		top/centre/bottom. The box remains screen-axis-aligned, but its chosen
		quadrant follows the rotated edge instead of pointing to stale page axes.
		That keeps the nominal 44 px box usable without covering the object's
		drag-to-move surface. On a shape whose own handles are under 44 px apart,
		sibling boxes must overlap; ShapeHandleScalingSubSection.isHit resolves
		that overlap to the nearest visible dot instead of array order. The
		visible dot is unchanged because onDraw reads this anchor and still paints
		at the core handle point.

		Desktop keeps centred boxes EXCEPT on an axis where the shape is so
		thin that the two centred edge rows would meet in its middle: there a
		press anywhere inside the shape lands on a grip, so drag-to-move is
		unreachable and a horizontal pull on a top/bottom grip is a resize
		no-op (a 12 px-tall divider reproduced this). Exactly the starved
		axis displaces its boxes outward, the other axis stays centred, and
		the drawn dot stays at the core handle point either way.

		Crop deliberately stays centred. A crop handle controls the boundary
		inside the image and its bracket painting is already written around that
		stock origin; ordinary resize is the parity row here.
	*/
	private phoneHandleAnchor(kind: string, hitWidth: number, hitHeight: number): number[] {
		const centred = [hitWidth * 0.5, hitHeight * 0.5];
		if (GraphicSelection.extraInfo?.isCropMode)
			return centred;

		const phone: boolean = this.sectionProperties.phoneChrome;
		let displaceX = phone;
		let displaceY = phone;
		if (!phone) {
			// Screen-space bounding box: a rotated thin shape starves the
			// screen axis its short side currently spans.
			const rectangle = GraphicSelection.rectangle;
			if (!rectangle) return centred;
			const minimumCorridor = 8 * app.dpiScale;
			displaceX = rectangle.pWidth - hitWidth < minimumCorridor;
			displaceY = rectangle.pHeight - hitHeight < minimumCorridor;
			if (!displaceX && !displaceY) return centred;
		}

		const directions: { [kind: string]: number[] } = {
			'1': [-1, -1], '2': [0, -1], '3': [1, -1],
			'4': [-1, 0],                  '5': [1, 0],
			'6': [-1, 1],  '7': [0, 1],   '8': [1, 1],
		};
		const direction = directions[kind] || [0, 0];
		const angle = this.getShapeAngleRadians();
		const screenX = direction[0] * Math.cos(angle) - direction[1] * Math.sin(angle);
		const screenY = direction[0] * Math.sin(angle) + direction[1] * Math.cos(angle);
		// The angle is derived from parseInt-truncated handle coordinates,
		// so an unrotated shape can read as a few milliradians of tilt (a
		// 0.5-twip midpoint truncation on a small shape is ~0.006 rad).
		// The tolerance must swallow that noise or an axis-aligned edge
		// handle quantizes into the wrong lane; 0.02 rad (~1.1°) is far
		// from any real quantization boundary.
		const epsilon = 0.02;
		const x = screenX < -epsilon
			? hitWidth
			: (screenX > epsilon ? 0 : hitWidth * 0.5);
		const y = screenY < -epsilon
			? hitHeight
			: (screenY > epsilon ? 0 : hitHeight * 0.5);

		return [
			displaceX ? x : hitWidth * 0.5,
			displaceY ? y : hitHeight * 0.5,
		];
	}

	private getScalingHandles() {
		if (this.sectionProperties.info?.handles?.kinds?.rectangle) {
			const rectangle = this.sectionProperties.info.handles.kinds.rectangle;

			for (const kind of this.scalingHandleKinds()) {
				const handle = rectangle[kind][0];
				const localAnchor = this.phoneHandleAnchor(
					kind,
					this.sectionProperties.handleHitWidth,
					this.sectionProperties.handleHitHeight,
				);
				this.sectionProperties.handles.push({
					info: handle,
					point: new cool.SimplePoint(
						handle.point.x - app.pixelsToTwips * localAnchor[0],
						handle.point.y - app.pixelsToTwips * localAnchor[1],
					),
					localAnchor,
				});
			}
		}
	}

	private getAnchorHandle(halfWidth: number, halfHeight: number) {
		if (this.sectionProperties.info?.handles?.kinds?.anchor) {
			const anchor = this.sectionProperties.info.handles.kinds.anchor['16'][0];
			this.sectionProperties.handles.push({ info: anchor, point: new cool.SimplePoint(anchor.point.x - halfWidth, anchor.point.y - halfHeight) });
		}
	}

	public getRotationInfo(): any {
		if (!this.sectionProperties.info?.handles?.kinds?.rectangle)
			return;

		let coreAngle = GraphicSelection.selectionAngle;
		if (this.sectionProperties.svg)
			coreAngle = this.sectionProperties.svg.innerHTML.includes('class="Group"') ? 0: coreAngle;

		if (coreAngle !== undefined && coreAngle !== null) {
			coreAngle = coreAngle / 100;
			coreAngle = (coreAngle * Math.PI) / 180;

			while (coreAngle > Math.PI * 2) coreAngle -= Math.PI * 2;
			while (coreAngle < 0) coreAngle += Math.PI * 2;
		}
		else
			coreAngle = null;

		const result = {
			kind: 'ShapeRotationHandle',
			coreAngle: coreAngle
		};

		return result;
	}

	getRotationHandlePosition(rotationInfo: any) {
		const centerX = parseInt(this.sectionProperties.info.handles.kinds.rectangle['2'][0].point.x) * app.twipsToPixels - this.position[0];
		const centerY = parseInt(this.sectionProperties.info.handles.kinds.rectangle['2'][0].point.y) * app.twipsToPixels - this.position[1];
		// Standoff from the shape's top edge. Phone resize boxes now sit wholly
		// outside the edge, reaching 44 px from it; the rotation box is another
		// 44 px wide. The standoff centres it where the two boxes merely meet
		// at their boundaries instead of one fingertip hitting both — see the
		// phoneRotationStandoffCss comment (the selection bar derives its
		// clearance from the same static). Desktop keeps the stock 30 px
		// geometry.
		const diff =
			(this.sectionProperties.phoneChrome
				? ShapeHandlesSection.phoneRotationStandoffCss
				: 30) * app.dpiScale;

		let y = centerY - diff * Math.sin(rotationInfo.coreAngle + Math.PI * 0.5);
		let x = centerX + diff * Math.cos(rotationInfo.coreAngle + Math.PI * 0.5);

		// Centre the section on the handle point using the HIT size, which is
		// what the sub section is actually built with.
		x -= this.sectionProperties.rotationHandleHitWidth * 0.5;
		y -= this.sectionProperties.rotationHandleHitHeight * 0.5;

		return new cool.SimplePoint((this.position[0] + x) * app.pixelsToTwips, (this.position[1] + y) * app.pixelsToTwips);
	}

	private getRotationHandle() {
		// M-0017 §A/§C ("rotation handle — ABSENT" on a table; "rotate a
		// table: NO affordance at all") is PARITY here, by construction, and
		// the guard that delivers it is the `isRotatable !== false` term
		// below. Core computes that flag per selection from every marked
		// object's TakeObjInfo().bRotateFreeAllowed
		// (engine/svx/source/svdraw/svdmrkv.cxx:1088-1102) and SdrTableObj
		// answers false (engine/svx/source/table/svdotable.cxx:1465-1469), so
		// a table selection reaches this line with isRotatable:false already
		// on the wire and no handle is pushed — no paint, and no 44 px grab
		// box either, because the rotation sub section is only ever built
		// from a handle of this kind. A second client-side "is this a table"
		// test here would be a duplicate of a fact the wire already carries.
		if (
			this.sectionProperties.info?.handles?.kinds?.rectangle &&
			GraphicSelection.extraInfo?.isRotatable !== false &&
			!this.sectionProperties.hasVideo
		) {
			const rotationInfo = this.getRotationInfo(); // Rotation section will read the information from this (parent) class.
			const rotationHandlePosition: cool.SimplePoint = this.getRotationHandlePosition(rotationInfo);
			rotationInfo.initialPosition = rotationHandlePosition.clone();

			// Core side doesn't send a position information for rotation handle. We add this.
			this.sectionProperties.handles.push({ info: rotationInfo, point: rotationHandlePosition });
		}
	}

	private getCustomHandles(halfWidth: number, halfHeight: number) {
		if (this.sectionProperties.info?.handles?.kinds?.custom) {
			const customHandleList = this.sectionProperties.info.handles.kinds.custom['22'];

			if (customHandleList && customHandleList.length > 0) {
				for (let i = 0; i < customHandleList.length; i++) {
					const customHandler = customHandleList[i];
					this.sectionProperties.handles.push({ info: customHandler, point: new cool.SimplePoint(customHandler.point.x - halfWidth, customHandler.point.y - halfHeight) });
				}
			}
		}
	}

	private getPolyHandles(halfWidth: number, halfHeight: number) {
		if (this.sectionProperties.info?.handles?.kinds?.poly) {
			if (Array.isArray(this.sectionProperties.info.handles.kinds.poly['9'])) {
				const polyArray = this.sectionProperties.info.handles.kinds.poly['9'];

				for (let i = 0; i < polyArray.length; i++) {
					const poly = polyArray[i];
					this.sectionProperties.handles.push({ info: poly, point: new cool.SimplePoint(poly.point.x - halfWidth, poly.point.y - halfHeight) });
				}
			}
		}
	}

	private getGluePoints() {
		if (this.sectionProperties.info?.GluePoints?.shapes) {
			if (Array.isArray(this.sectionProperties.info.GluePoints.shapes)) {
				const shapeArray = this.sectionProperties.info.GluePoints.shapes;

				for (let i = 0; i < shapeArray.length; i++) {
					const shape = shapeArray[i];
					shape.kind = 'GluePoint';
					const glueArray = shape.gluepoints;

					for (let j = 0; j < glueArray.length; j++) {
						const info = Object.assign({}, shape);
						info.id = String(i) + String(j);
						this.sectionProperties.handles.push({ info: info, point: new cool.SimplePoint(glueArray[j].point.x, glueArray[j].point.y) });
					}
				}
			}
		}
	}

	private getDiagram(halfWidth: number, halfHeight: number) {
		if (this.isDiagram() && this.sectionProperties.info?.handles?.kinds?.rectangle) {
			// get a scaled oversize measurement in X and Y
			const scaleFactor = 3;
			halfWidth *= scaleFactor;
			halfHeight *= scaleFactor;

			// get object size as base for calculations
			const topLeft = this.sectionProperties.info.handles.kinds.rectangle['1'][0];

			// create a shape with overhang of halfWidth/Height on all sides,
			const width : number = this.getShapeWidth(true) + 2 * halfWidth;
			const height : number = this.getShapeHeight(true) + 2 * halfHeight;
			const info = {
				kind: 'DiagramHandle',
				size: new cool.SimplePoint(width, height),
				halfWidth: halfWidth,
				halfHeight: halfHeight
			};
			this.sectionProperties.handles.push({
				info: info,
				point: new cool.SimplePoint(
					topLeft.point.x - info.halfWidth,
					topLeft.point.y - info.halfHeight) });
		}
	}

	private clampHitToHalfSide(side: number, drawn: number): number {
		const max = this.sectionProperties.handleMaxHitWidth;
		if (!isFinite(side) || side <= 0) return max;
		return Math.min(max, Math.max(drawn, side * 0.5));
	}

	private updateHandleHitSizes(): void {
		// Desktop and tablet: box == art, already set in the constructor.
		if (!this.sectionProperties.phoneChrome) return;

		this.sectionProperties.handleHitWidth = this.sectionProperties.handleMaxHitWidth;
		this.sectionProperties.handleHitHeight = this.sectionProperties.handleMaxHitWidth;

		// Crop is outside this parity change. Preserve its established centred,
		// per-axis-clamped targets exactly; only ordinary resize moves the full
		// box outward.
		if (GraphicSelection.extraInfo?.isCropMode) {
			const rectangle = this.sectionProperties.info?.handles?.kinds?.rectangle;
			if (rectangle?.['2']?.[0] && rectangle['4']?.[0] && rectangle['5']?.[0] && rectangle['7']?.[0]) {
				this.sectionProperties.handleHitWidth = this.clampHitToHalfSide(
					this.getShapeWidth(false),
					this.sectionProperties.handleWidth,
				);
				this.sectionProperties.handleHitHeight = this.clampHitToHalfSide(
					this.getShapeHeight(false),
					this.sectionProperties.handleHeight,
				);
			}
		}
	}

	// Get the handle positions and other information from the info that core side sent us.
	private getHandles() {
		this.sectionProperties.handles = [];

		this.updateHandleHitSizes();

		const halfWidth = app.pixelsToTwips * (this.sectionProperties.handleWidth * 0.5);
		const halfHeight = app.pixelsToTwips * (this.sectionProperties.handleHeight * 0.5);

		// A multi-selection builds no scaling/rotation grips (PowerPoint
		// look: every member draws its own frame and dot ring, see
		// drawMemberFrames). Core streams one handle entry per member per
		// kind but reuses the handle ids across members, so a functional
		// grip would resize an ambiguous member; a press inside any member
		// stays a drag-move of the whole selection instead.
		if (!this.isMultiSelection()) {
			this.getDiagram(halfWidth, halfHeight);
			this.getScalingHandles();
			this.getAnchorHandle(halfWidth, halfHeight);
			this.getRotationHandle();
			this.getCustomHandles(halfWidth, halfHeight);
			this.getPolyHandles(halfWidth, halfHeight);
			this.getGluePoints();
		}
	}

	// Update this section's size according to handle coordinates.
	updateSize() {
		this.size = [0, 0];

		if (GraphicSelection.hasActiveSelection())
			this.size = [GraphicSelection.rectangle.pWidth, GraphicSelection.rectangle.pHeight];

		this.boundingRectangle = cool.SimpleRectangle.fromCorePixels([...this.position, ...this.size]);

		if (this.sectionProperties.svg)
			this.adjustSVGProperties();
	}

	isSVGVisible() {
		if (this.sectionProperties.svg)
			return this.sectionProperties.svg.style.display === '';
		else
			return false;
	}

	isDiagram() {
		if (GraphicSelection?.extraInfo?.isDiagram === true)
			return true;
		else
			return false;
	}

	removeSVG() {
		if (this.sectionProperties.svg)
			this.sectionProperties.svg.remove();
	}

	addVideoSupportHandlers(videos: any) {
		if (!videos)
			return;

		// slide show may have more than one video and it does not require any selection
		for (var i = 0; i < videos.length; i++) {
			var video = videos[i];
			var sources = video.getElementsByTagName('source');

			video.addEventListener('playing', function() {
				window.setTimeout(function() {
					if (video.webkitDecodedFrameCount === 0 && video.webkitAudioDecodedByteCount === 0) {
						this.showUnsupportedMediaWarning();
					}
				}.bind(this), 1000);
			}.bind(this));

			video.addEventListener('error', function() {
				this.showUnsupportedMediaWarning();
			}.bind(this));

			if (sources.length) {
				sources[0].addEventListener('error', function(error: string) {
					this.showUnsupportedMediaWarning();
				}.bind(this));
			}
		}
	}

	showUnsupportedMediaWarning() {
		var videoWarning = _('Document contains unsupported media');
		window.L.Map.THIS.uiManager.showSnackbar(videoWarning);
	}

	addEmbeddedVideo(svgString: any) {
		this.sectionProperties.hasVideo = true;
		this.setSVG(svgString);
		this.sectionProperties.svg.style.opacity = 0.5;
		this.sectionProperties.svg.remove();
		document.getElementById('canvas-container').appendChild(this.sectionProperties.svg);
		this.sectionProperties.svg.style.zIndex = 11; // Update z-index or video buttons are unreachable.

		if (!app.map.isEditMode()) {
			this.sectionProperties.svg.style.opacity = 1;
			this.sectionProperties.svg.style.pointerEvents = '';
			this.hideSubSections();
		}

		if (!this.sectionProperties.svg.innerHTML.includes('foreignObject')) {
			console.error('Failed to parse svg for embedded video');
			return;
		}

		var videoContainer = this.sectionProperties.svg;
		var videos = this.sectionProperties.svg.getElementsByTagName('video');

		// fix URL, it's important to have correct WOPISrc, we need to decode "&" before other params
		// like ServerId and Tag so load balancer will not use it as a part of WOPISrc
		// this has to be done here (after parseSVG), because it other case we will fail to get
		// the svg object
		var source = this.sectionProperties.svg.getElementsByTagName('source');
		source[0].src = decodeURIComponent(source[0].src);

		this.addVideoSupportHandlers(videos);
	}

	removeTagFromHTML(data: string, startString: string, endString: string): string {
		let startIndex = data.indexOf(startString);
		let endIndex = data.indexOf(endString, startIndex + 1);

		while (startIndex !== -1 && endIndex !== -1) {
			const toRemove = data.substring(startIndex, endIndex + endString.length);
			data = data.replace(toRemove, '');

			startIndex = data.indexOf(startString);
			endIndex = data.indexOf(endString, startIndex + 1);
		}

		return data;
	}

	getTagFromHTML(data: string, startString: string, endString: string): string {
		const startIndex = data.indexOf(startString);
		const endIndex = data.indexOf(endString, startIndex + 1);

		if (startIndex !== -1 && endIndex !== -1) {
			const pickedData = data.substring(startIndex, endIndex + endString.length);
			return pickedData;
		}
		else {
			return '';
		}
	}

	setSVG(data: string) {
		this.removeSVG();

		data = this.removeTagFromHTML(data, ' style="', '"');

		this.sectionProperties.svg = document.createElement('svg');
		this.sectionProperties.svg.style.pointerEvents = 'none';
		document.getElementById('canvas-container').appendChild(this.sectionProperties.svg);

		this.sectionProperties.svg.innerHTML = app.LOUtil.sanitize(data, 'svg');
		this.sectionProperties.svg.style.position = 'absolute';
		this.sectionProperties.svg.children[0].style.width = this.sectionProperties.svg.children[0].style.height = 'auto';
		this.sectionProperties.svg.children[0].style.transformOrigin = 'center';
		this.sectionProperties.svg.children[0].setAttribute('preserveAspectRatio', 'none');

		this.adjustSVGProperties();
	}

	showSVG() {
		if (this.sectionProperties.svg)
			this.sectionProperties.svg.style.display = '';
	}

	hideSVG() {
		if (this.sectionProperties.svg && !this.sectionProperties.hasVideo)
			this.sectionProperties.svg.style.display = 'none';
	}

	onSectionShowStatusChange() {
		for (let i = 0; i < this.sectionProperties.subSections.length; i++)
			this.sectionProperties.subSections[i].setShowSection(this.showSection);

		// Don't call showSVG() here: the SVG overlay may contain stale
		// content from a previous render.  A new shapeselectioncontent
		// message will arrive and setSVG() will set the up-to-date SVG.
		// The overlay is only made visible on demand (e.g. during drag).
		if (!this.showSection)
			this.hideSVG();
	}

	checkAnchorSubSection(handle: any): any {
		let newSubSection = app.sectionContainer.getSectionWithName(this.sectionProperties.subSectionPrefix + handle.info.id);

		if (!newSubSection) {
			newSubSection = new ShapeHandleAnchorSubSection(
				this,
				this.sectionProperties.subSectionPrefix + handle.info.id,
				[this.sectionProperties.anchorWidth / app.dpiScale, this.sectionProperties.anchorHeight / app.dpiScale],
				handle.point.clone(),
				handle.info
			);
			return newSubSection;
		}
		else {
			newSubSection.sectionProperties.ownInfo = handle.info;
			newSubSection.setPosition(handle.point.pX, handle.point.pY);
			return null;
		}
	}

	checkScalingSubSection(handle: any): any {
		let newSubSection = app.sectionContainer.getSectionWithName(this.sectionProperties.subSectionPrefix + handle.info.id);

		if (!newSubSection) {
			newSubSection = new ShapeHandleScalingSubSection(
				this,
				this.sectionProperties.subSectionPrefix + handle.info.id,
				[this.sectionProperties.handleHitWidth, this.sectionProperties.handleHitHeight],
				handle.point.clone(),
				handle.info,
				GraphicSelection.extraInfo.isCropMode,
				handle.localAnchor,
			);
			return newSubSection;
		}
		else {
			newSubSection.sectionProperties.ownInfo = handle.info;
			newSubSection.sectionProperties.localAnchor = handle.localAnchor || [
				this.sectionProperties.handleHitWidth * 0.5,
				this.sectionProperties.handleHitHeight * 0.5,
			];
			// The hit size is derived from the shape, so a resized shape can
			// need a different box on an already-existing sub section.
			// setSize() early-returns when nothing changed, which is always the
			// case on desktop.
			newSubSection.setSize(this.sectionProperties.handleHitWidth, this.sectionProperties.handleHitHeight);
			newSubSection.setPosition(handle.point.pX, handle.point.pY);
			newSubSection.sectionProperties.cropModeEnabled = !!GraphicSelection.extraInfo.isCropMode;
			return null;
		}
	}

	checkRotationSubSection(handle: any) {
		let newSubSection = app.sectionContainer.getSectionWithName(this.sectionProperties.subSectionPrefix + 'rotation');

		if (!newSubSection) {
			newSubSection = new app.definitions.shapeHandleRotationSubSection(
				this,
				this.sectionProperties.subSectionPrefix + 'rotation',
				[this.sectionProperties.rotationHandleHitWidth, this.sectionProperties.rotationHandleHitHeight],
				handle.point.clone(),
				handle.info
			);
			return newSubSection;
		}
		else {
			newSubSection.sectionProperties.ownInfo = handle.info;
			newSubSection.setPosition(handle.point.pX, handle.point.pY);
			return null;
		}
	}

	checkDiagramSubSection(handle: any) {
		let newSubSection = app.sectionContainer.getSectionWithName(this.sectionProperties.subSectionPrefix + 'diagram');

		if (!newSubSection) {
			newSubSection = new app.definitions.shapeHandleDiagramSubSection(
				this,
				this.sectionProperties.subSectionPrefix + 'diagram',
				[handle.info.size.pX, handle.info.size.pY],
				new cool.SimplePoint(
					handle.point.x,
					handle.point.y),
				handle.info
			);
			return newSubSection;
		}
		else {
			newSubSection.sectionProperties.ownInfo = handle.info;
			newSubSection.setPosition(
				handle.point.pX,
				handle.point.pY);
			newSubSection.setSize(
				handle.info.size.pX,
				handle.info.size.pY);

			// we also need to update the edit button by resetting it's
			// last remembered zoom value
			if (GraphicSelection.diagramButton)
				GraphicSelection.diagramButton.forceNextReposition();

			return null;
		}
	}

	checkCustomSubSection(handle: any): any {
		let newSubSection = app.sectionContainer.getSectionWithName(this.sectionProperties.subSectionPrefix + handle.info.id);

		if (!newSubSection) {
			newSubSection = new app.definitions.shapeHandleCustomSubSection(
				this,
				this.sectionProperties.subSectionPrefix + handle.info.id,
				[this.sectionProperties.handleWidth, this.sectionProperties.handleHeight],
				handle.point.clone(),
				handle.info
			);
			return newSubSection;
		}
		else {
			newSubSection.sectionProperties.ownInfo = handle.info;
			newSubSection.setPosition(handle.point.pX, handle.point.pY);
			return null;
		}
	}

	checkPolySubSection(handle: any): any {
		let newSubSection = app.sectionContainer.getSectionWithName(this.sectionProperties.subSectionPrefix + handle.info.id);

		if (!newSubSection) {
			newSubSection = new app.definitions.shapeHandlePolySubSection(
				this,
				this.sectionProperties.subSectionPrefix + handle.info.id,
				[this.sectionProperties.handleWidth, this.sectionProperties.handleHeight],
				handle.point.clone(),
				handle.info
			);
			return newSubSection;
		}
		else {
			newSubSection.sectionProperties.ownInfo = handle.info;
			newSubSection.setPosition(handle.point.pX, handle.point.pY);
			return null;
		}
	}

	/*
		Phone Impress: the glue dots stop EATING TAPS.

		The constructor above says glue points deliberately get no grown hit
		box, because ShapeHandleGluePointSubSection declares no mouse handler at
		all. That is only half the story, and this is the other half: a section
		with no handler is not a section that ignores you. CanvasSectionObject's
		onMouseDown / onMouseUp / onClick are empty `return;` bodies
		(CanvasSectionObject.ts:59,60,86), and findSectionContainingPoint
		returns exactly ONE section and never walks down to the next
		(CanvasSectionContainer.ts:1676-1689). So a tap that lands on a glue dot
		is delivered to a no-op and dies there. It is the same failure
		pruneStaleSubSections already names below - "stay in the container
		drawing themselves at stale positions and eating taps" - reached by a
		different route.

		`interactable = false` is the tree's own answer, with the semantics
		written down at GraphicSelectionMiddleware.ts:481-483: "When
		'interactable' is false, canvas section container events pass through
		the section." findSectionContainingPoint skips it (`:1683`) and the tap
		reaches the shape underneath, which on a phone is what the user was
		aiming at. The dot still DRAWS - showSection is untouched, and
		interactable gates only targeting, not painting
		(CanvasSectionContainer.ts:97) - so the connector's anchor points remain
		visible. Nothing is removed; a dead target becomes a decoration, which
		is what it always was.

		HOW OFTEN THIS BITES, from the engine in this repo rather than a guess.
		GluePoints rides the graphic-selection payload and is emitted only when
		the marked object is a connector:
		`svx/source/svdraw/svdmrkv.cxx:999-1002` gates dumpGluePointsToJSON on
		`GetObjIdentifier() == SdrObjKind::Edge`, and `:1302-1305` appends the
		"GluePoints" key. But dumpGluePointsToJSON then walks
		`mpMarkedPV->GetObjList()` - EVERY object on the page - so selecting a
		single connector sprays 10 px dots across every shape on the slide. A
		flowchart or org chart authored on desktop and opened on a 390 px phone
		is the case: tap the connector once and most of the canvas becomes
		targets that answer nothing.

		Phone-gated rather than fixed everywhere on purpose. The defect is not
		phone-specific - a desktop click on a glue dot dies the same way - but a
		mouse can aim between 10 px dots and a fingertip cannot, and `gate ===
		false` has to reproduce HEAD exactly. Making them interactable for real
		(so they could be dragged) is the other possible fix and is a bigger,
		non-phone change; this one only stops them lying about where to tap.
	*/
	checkGluePointSubSection(handle: any): any {
		let newSubSection = app.sectionContainer.getSectionWithName(this.sectionProperties.subSectionPrefix + handle.info.id);

		if (!newSubSection) {
			newSubSection = new app.definitions.shapeHandleGluePointSubSection(
				this,
				this.sectionProperties.subSectionPrefix + handle.info.id,
				[this.sectionProperties.gluePointRadius, this.sectionProperties.gluePointRadius],
				handle.point.clone(),
				handle.info
			);
			if (this.sectionProperties.phoneChrome)
				newSubSection.interactable = false;
			return newSubSection;
		}
		else {
			newSubSection.sectionProperties.ownInfo = handle.info;
			newSubSection.setPosition(handle.point.pX, handle.point.pY);
			return null;
		}
	}

	addSubSections() {
		for (let i = 0; i < this.sectionProperties.handles.length; i++) {
			let newSubSection: any = null;
			if (this.sectionProperties.handles[i].info.kind === '16')
				newSubSection = this.checkAnchorSubSection(this.sectionProperties.handles[i]);
			else if (['1', '2', '3', '4', '5', '6', '7', '8'].includes(this.sectionProperties.handles[i].info.kind))
				newSubSection = this.checkScalingSubSection(this.sectionProperties.handles[i]);
			else if (this.sectionProperties.handles[i].info.kind === 'ShapeRotationHandle')
				newSubSection = this.checkRotationSubSection(this.sectionProperties.handles[i]);
			else if (this.sectionProperties.handles[i].info.kind === 'DiagramHandle')
				newSubSection = this.checkDiagramSubSection(this.sectionProperties.handles[i]);
			else if (this.sectionProperties.handles[i].info.kind === '22')
				newSubSection = this.checkCustomSubSection(this.sectionProperties.handles[i]);
			else if (this.sectionProperties.handles[i].info.kind === '9')
				newSubSection = this.checkPolySubSection(this.sectionProperties.handles[i]);
			else if (this.sectionProperties.handles[i].info.kind === 'GluePoint')
				newSubSection = this.checkGluePointSubSection(this.sectionProperties.handles[i]);

			if (newSubSection) {
				this.containerObject.addSection(newSubSection as any);
				this.sectionProperties.subSections.push(newSubSection);
			}
		}

		// Not mid-drag: the container is holding a reference to whatever section
		// is being dragged. The constructor's first refresh runs before addSection
		// attaches the container; anything stale is pruned on the next refreshInfo.
		if (
			this.containerObject &&
			!this.containerObject.isDraggingSomething()
		)
			this.pruneStaleSubSections();
	}

	/*
		Drop sub sections this posture no longer produces.

		Needed because the handle set is not constant: on a phone, entering
		crop brings the four edge midpoints back and leaving crop takes them
		away again on the SAME shape; on desktop, a Ctrl/Cmd+click growing a
		single selection into a multi-selection empties the handle list (a
		multi-selection builds no grips) while the selection itself never
		changes, so GraphicSelectionMiddleware's removeSubSections() does not
		run and the first member's grips and rotation handle would linger,
		drawing at stale positions and eating clicks.
	*/
	private pruneStaleSubSections(): void {
		const liveNames = new Set<string>();

		for (const handle of this.sectionProperties.handles) {
			liveNames.add(this.sectionProperties.subSectionPrefix + handle.info.id);
			// These two are named by role, not by an info id — live only
			// while the current handle set actually produces them.
			if (handle.info.kind === 'ShapeRotationHandle')
				liveNames.add(this.sectionProperties.subSectionPrefix + 'rotation');
			if (handle.info.kind === 'DiagramHandle')
				liveNames.add(this.sectionProperties.subSectionPrefix + 'diagram');
		}

		for (let i = this.sectionProperties.subSections.length - 1; i > -1; i--) {
			const subSection = this.sectionProperties.subSections[i];
			if (liveNames.has(subSection.name)) continue;

			this.containerObject.removeSection(subSection.name);
			this.sectionProperties.subSections.splice(i, 1);
		}
	}

	onMouseEnter() {
		this.context.canvas.style.cursor = 'move';
	}

	adjustSnapTransformCoordinate(x: number, y: number) {
		// Transform command accepts the difference from top left corner.
		// closestX / closestY are the snapped position of the matched point
		// (left edge, center or right edge), so subtract that point's offset
		// from the top left corner to get the new top left position.

		if (x !== null) x -= this.sectionProperties.snapOffsetX;
		if (y !== null) y -= this.sectionProperties.snapOffsetY;

		return x !== null ? x: y;
	}

	/*
		The top-left the drag would commit right now, in core twips: the same
		math sendTransformCommand sends. 0 is a legitimate
		snap ordinate (the slide's own left/top edge), so only null means
		"no snap on this axis".
	*/
	private dragCommitTopLeftTwips(): number[] {
		let x = this.sectionProperties.closestX;
		if (x === null) x = this.sectionProperties.lastDragDistance[0] + this.position[0];
		else x = this.adjustSnapTransformCoordinate(x, null);

		let y = this.sectionProperties.closestY;
		if (y === null) y = this.sectionProperties.lastDragDistance[1] + this.position[1];
		else y = this.adjustSnapTransformCoordinate(null, y);

		let yTwips = y * app.pixelsToTwips;
		const verticalOffset = app.map._docLayer.getFiledBasedViewVerticalOffset();
		if (verticalOffset) {
			// Transform from canvas twips to core twips.
			yTwips -= verticalOffset;
		}

		return [x * app.pixelsToTwips, yTwips];
	}

	sendTransformCommand(point: cool.SimplePoint) {
		const commitPosition = this.dragCommitTopLeftTwips();
		let xTwips = commitPosition[0];
		const docLayer = app.map._docLayer;

		if (docLayer.isCalcRTL())
			xTwips = (-this.size[0] + this.sectionProperties.lastDragDistance[0] - this.position[0]) * app.pixelsToTwips;

		const parameters = {
			'TransformPosX': {
				'type': 'long',
				'value': Math.round(xTwips)
			},
			'TransformPosY': {
				'type': 'long',
				'value': Math.round(commitPosition[1])
			}
		};

		app.map.sendUnoCommand('.uno:TransformDialog', parameters);

		docLayer.requestNewFiledBasedViewTiles();

		this.sectionProperties.lastDragDistance = [0, 0];
	}

	/*
		Ask core for the geometry the shape would get if the dragged handle
		was dropped at the given position. Core answers with a
		shapedragpreview message. At most one request is in flight, newer
		positions replace the queued one until the answer arrives.
	*/
	public requestShapeDragPreview(handleId: any, point: cool.SimplePoint) {
		const requestTime = this.sectionProperties.shapeDragPreviewRequestTime;
		if (requestTime !== null && Date.now() - requestTime < 250) {
			this.sectionProperties.queuedShapeDragPreview = { handleId: handleId, point: point };
			return;
		}

		this.sendShapeDragPreviewRequest(handleId, point);
	}

	private sendShapeDragPreviewRequest(handleId: any, point: cool.SimplePoint) {
		this.sectionProperties.shapeDragPreviewRequestTime = Date.now();
		this.sectionProperties.queuedShapeDragPreview = null;

		const parameters = {
			HandleNum: { type: 'long', value: handleId },
			NewPosX: { type: 'long', value: Math.round(point.x) },
			NewPosY: { type: 'long', value: Math.round(point.y) },
			Preview: { type: 'boolean', value: true }
		};

		app.map.sendUnoCommand('.uno:MoveShapeHandle', parameters);
	}

	public onShapeDragPreview(preview: any) {
		this.sectionProperties.shapeDragPreviewRequestTime = null;

		if (!this.containerObject.isDraggingSomething()) {
			// The drag has ended in the meantime, this preview is stale.
			this.clearShapeDragPreview();
			return;
		}

		const polygons: number[][][] = [];
		if (Array.isArray(preview?.polygons)) {
			for (const polygonText of preview.polygons) {
				const points: number[][] = [];
				for (const pointText of String(polygonText).split(' ')) {
					const coordinates = pointText.split(',');
					if (coordinates.length !== 2) continue;
					points.push([
						parseInt(coordinates[0]) * app.twipsToPixels,
						parseInt(coordinates[1]) * app.twipsToPixels
					]);
				}
				if (points.length > 1) polygons.push(points);
			}
		}

		this.sectionProperties.shapeDragPreviewPolygons = polygons.length > 0 ? polygons : null;
		this.containerObject.requestReDraw();

		const queued = this.sectionProperties.queuedShapeDragPreview;
		if (queued) this.sendShapeDragPreviewRequest(queued.handleId, queued.point);
	}

	public clearShapeDragPreview() {
		this.sectionProperties.shapeDragPreviewPolygons = null;
		this.sectionProperties.shapeDragPreviewRequestTime = null;
		this.sectionProperties.queuedShapeDragPreview = null;
		this.containerObject.requestReDraw();
	}

	private drawShapeDragPreview() {
		const polygons = this.sectionProperties.shapeDragPreviewPolygons;
		if (!polygons) return;

		this.context.save();
		this.context.strokeStyle = app.map.uiManager.isBackgroundDark() ? 'white' : 'black';
		this.context.lineWidth = app.dpiScale;
		this.context.beginPath();

		for (let i = 0; i < polygons.length; i++) {
			const points = polygons[i];
			this.context.moveTo(points[0][0] - this.position[0], points[0][1] - this.position[1]);
			for (let j = 1; j < points.length; j++)
				this.context.lineTo(points[j][0] - this.position[0], points[j][1] - this.position[1]);
		}

		this.context.stroke();
		this.context.restore();
	}

	public onMouseDown(point: cool.SimplePoint, e: MouseEvent): void {
		Util.ensureValue(app.activeDocument);

		this.clearGhostFallbackHide();
		this.sectionProperties.dragCancelled = false;
		this.sectionProperties.viewedRectangleOnMouseDown = app.activeDocument.activeLayout.viewedRectangle.clone();
		this.sectionProperties.initialPosition = this.position.slice();
		this.sectionProperties.positionOnMouseDown = point.clone();
		this.sectionProperties.positionOnMouseDown.pX += this.position[0];
		this.sectionProperties.positionOnMouseDown.pY += this.position[1];
	}

	onMouseUp(point: cool.SimplePoint, e: MouseEvent): void {
		if (this.sectionProperties.svg)
			this.sectionProperties.svg.style.opacity = 1;

		if (!this.containerObject.isDraggingSomething()) {
			this.hideSVG();
			return;
		}

		app.map.fire('scrollvelocity', { vx: 0, vy: 0 });

		if (this.consumeDragCancelled()) {
			this.hideSVG();
			return;
		}

		if (e.ctrlKey && !app.map._docLayer.isCalcRTL()) {
			// Ctrl+drag duplicates (PowerPoint). Core's mouse path implements
			// copy-drag natively, so replay the gesture there instead of
			// moving the original.
			this.sendDuplicateDrag();
		}
		else {
			point.x += app.activeDocument.activeLayout.viewedRectangle.x1 - this.sectionProperties.viewedRectangleOnMouseDown.x1;
			point.y += app.activeDocument.activeLayout.viewedRectangle.y1 - this.sectionProperties.viewedRectangleOnMouseDown.y1;
			this.sendTransformCommand(point);
		}

		// Snap guides are drag feedback. Keeping their ordinates after pointer-up
		// repaints full-canvas dotted axes through later selection updates and Undo.
		this.clearHelperLines();

		// Don't hide the ghost yet: it stays at the drop position until the
		// post-commit graphicselection arrives (adjustSVGProperties hides it),
		// which removes the settle-jump. The timer is only a safety net.
		this.scheduleGhostFallbackHide();
	}

	public scheduleGhostFallbackHide() {
		// Every gesture's commit path already lands here — the body drag's
		// mouse-up, both resize branches and the rotate commit — which is what
		// makes it the one disarm site the mid-gesture feedback needs.
		this.endGestureFeedback();
		this.clearGhostFallbackHide();
		this.sectionProperties.ghostHideTimer = app.timerRegistry.setTimeout(
			'shapeGhostFallbackHide',
			() => {
				this.sectionProperties.ghostHideTimer = null;
				if (!this.containerObject.isDraggingSomething())
					this.hideSVG();
			},
			1000,
		);
	}

	private clearGhostFallbackHide() {
		if (this.sectionProperties.ghostHideTimer) {
			app.timerRegistry.clearTimeout(this.sectionProperties.ghostHideTimer);
			this.sectionProperties.ghostHideTimer = null;
		}
	}

	private sendDuplicateDrag() {
		const start = this.sectionProperties.positionOnMouseDown.clone();
		const end = start.clone();
		end.pX += this.sectionProperties.lastDragDistance[0];
		end.pY += this.sectionProperties.lastDragDistance[1];

		// Land the copy exactly where the (possibly snapped) ghost sits.
		if (this.sectionProperties.closestX !== null) {
			const unsnappedLeft = this.position[0] + this.sectionProperties.lastDragDistance[0];
			const snappedLeft = this.sectionProperties.closestX - this.sectionProperties.snapOffsetX;
			end.pX += snappedLeft - unsnappedLeft;
		}
		if (this.sectionProperties.closestY !== null) {
			const unsnappedTop = this.position[1] + this.sectionProperties.lastDragDistance[1];
			const snappedTop = this.sectionProperties.closestY - this.sectionProperties.snapOffsetY;
			end.pY += snappedTop - unsnappedTop;
		}

		// Account for viewport scrolling that happened during the drag.
		end.x += app.activeDocument.activeLayout.viewedRectangle.x1 - this.sectionProperties.viewedRectangleOnMouseDown.x1;
		end.y += app.activeDocument.activeLayout.viewedRectangle.y1 - this.sectionProperties.viewedRectangleOnMouseDown.y1;

		const modifier = app.UNOModifier.CTRL;
		app.map._docLayer._postMouseEvent('buttondown', start.x, start.y, 1, 1, modifier);
		app.map._docLayer._postMouseEvent('move', end.x, end.y, 1, 1, modifier);
		app.map._docLayer._postMouseEvent('buttonup', end.x, end.y, 1, 1, modifier);

		this.sectionProperties.lastDragDistance = [0, 0];
	}

	// The slide itself is a snap target: its edges and its center, like
	// PowerPoint's slide-center guides. Same [x, y, w, h, ordNum] layout as
	// ObjectRectangles (core pixels); OrdNum -1 never collides with an object.
	public static slideSnapRectangle(): number[] | null {
		const part = app.impress?.partList?.[app.map._docLayer._selectedPart];
		if (!part || app.map._docLayer._docType !== 'presentation') return null;
		const factor = app.impress.twipsCorrection * app.twipsToPixels;
		return [0, 0, part.width * factor, part.height * factor, -1];
	}

	private getSnapRectangles(): number[][] {
		const rectangles: number[][] = GraphicSelection.extraInfo.ObjectRectangles ? GraphicSelection.extraInfo.ObjectRectangles.slice() : [];
		const slide = ShapeHandlesSection.slideSnapRectangle();
		if (slide) rectangles.push(slide);
		return rectangles;
	}

	// The other objects' rectangles alone (no slide), for the equal-gap
	// neighbor search; null when the landed selection carries none.
	private getSnapObjectRectangles(): number[][] | null {
		return GraphicSelection.extraInfo.ObjectRectangles || null;
	}

	// Every selected object is excluded as a snap target, not just the first:
	// on multi-select drags the selection used to snap to its own members.
	// Older kits only send OrdNum, so fall back to excluding just that one.
	private getExcludedOrdNums(): Set<number> {
		const selected = GraphicSelection.extraInfo.selectedOrdNums;
		if (Array.isArray(selected) && selected.length > 0)
			return new Set(selected);
		return new Set([GraphicSelection.extraInfo.OrdNum]);
	}

	private static readonly maxGuideLinesPerAxis = 6;

	// Draw-only companions to the snap decision: every distinct target
	// ordinate that coincides with one of the shape's [start, center, end]
	// points once the winning snap is applied. PowerPoint draws each such
	// alignment as its own guide. Deduped, capped, winner first.
	private collectAlignedGuides(rectangles: number[][], excluded: Set<number>, list: number[], pick: number, snapOffset: number, horizontal: boolean): number[] {
		const start = pick - snapOffset;
		const snappedPoints = [start, start + (list[1] - list[0]), start + (list[2] - list[0])];
		const guides: number[] = [pick];

		for (let i = 0; i < rectangles.length; i++) {
			if (guides.length >= ShapeHandlesSection.maxGuideLinesPerAxis) break;
			if (excluded.has(rectangles[i][4])) continue;

			const begin = horizontal ? rectangles[i][0] : rectangles[i][1];
			const extent = horizontal ? rectangles[i][2] : rectangles[i][3];
			const targets = [begin, begin + extent / 2, begin + extent];

			for (const target of targets) {
				if (guides.some((guide) => Math.abs(guide - target) < 0.5)) continue;
				if (!snappedPoints.some((point) => Math.abs(point - target) < 0.5)) continue;
				guides.push(target);
				if (guides.length >= ShapeHandlesSection.maxGuideLinesPerAxis) break;
			}
		}

		return guides;
	}

	// A "level" line: the dragged shape's TOP is joining a row that is
	// already level — two or more other objects whose tops sit on the
	// snapped ordinate ("each layer should be level"). A row reads as one
	// line, so it paints as one solid line instead of one more dashed
	// alignment. The slide rect (ordNum -1) is a page edge, not a row.
	private findLevelRow(rectangles: number[][], excluded: Set<number>, pick: number, snapOffset: number): number | null {
		if (snapOffset !== 0) return null; // Only a top-edge snap joins a row of tops.

		let tops = 0;
		for (let i = 0; i < rectangles.length; i++) {
			if (excluded.has(rectangles[i][4]) || rectangles[i][4] === -1) continue;
			if (Math.abs(rectangles[i][1] - pick) < 0.5) tops++;
		}

		return tops >= 2 ? pick : null;
	}

	// xList holds the dragged shape's [left edge, center, right edge].
	// We look for the closest left/center/right ordinate of any other object.
	findClosestX(xList: number[]) {
		let closest = 1000;
		let pickX = null;
		let pickIsCenterTarget = false;
		let snapOffset = 0;
		let centerSnap = null;
		let centerToCenter = false;
		const rectangles = this.getSnapRectangles();
		const excluded = this.getExcludedOrdNums();

		for (let i = 0; i < rectangles.length; i++) {
			if (excluded.has(rectangles[i][4])) continue; // Selected objects are not snap targets.

			// Candidate snap ordinates of the other object: left edge, center, right edge.
			const targets = [
				rectangles[i][0],
				rectangles[i][0] + rectangles[i][2] / 2,
				rectangles[i][0] + rectangles[i][2],
			];

			for (let j = 0; j < xList.length; j++) {
				for (let k = 0; k < targets.length; k++) {
					const distance = Math.abs(targets[k] - xList[j]);
					// Nearest wins. On a distance tie an edge target beats a
					// center target; otherwise the earlier find stands.
					const tie = Math.abs(distance - closest) < 0.001;
					if ((distance < closest && !tie) || (tie && pickIsCenterTarget && k !== 1)) {
						closest = distance;
						pickX = targets[k];
						pickIsCenterTarget = k === 1;
						snapOffset = xList[j] - xList[0]; // 0, half width or full width.
						// k === 1 means the other object's center was the snap target.
						centerSnap = k === 1 ? [targets[1], rectangles[i][1] + rectangles[i][3] / 2] : null;
						// Both centers meet when the matched point is the active object's center too.
						centerToCenter = k === 1 && xList[j] === xList[1];
					}
				}
			}
		}

		if (closest < ShapeHandlesSection.snapRadius()) {
			this.sectionProperties.closestX = pickX;
			this.sectionProperties.snapOffsetX = snapOffset;
			this.sectionProperties.centerSnapX = centerSnap;
			this.sectionProperties.centerToCenterX = centerToCenter;
			this.sectionProperties.guideLinesX = this.collectAlignedGuides(rectangles, excluded, xList, pickX, snapOffset, true);
		}
		else {
			this.sectionProperties.closestX = null;
			this.sectionProperties.centerSnapX = null;
			this.sectionProperties.centerToCenterX = false;
			this.sectionProperties.guideLinesX = [];
		}
	}

	// yList holds the dragged shape's [top edge, center, bottom edge].
	// We look for the closest top/center/bottom ordinate of any other object.
	findClosestY(yList: number[]) {
		let closest = 1000;
		let pickY = null;
		let pickIsCenterTarget = false;
		let snapOffset = 0;
		let centerSnap = null;
		let centerToCenter = false;
		const rectangles = this.getSnapRectangles();
		const excluded = this.getExcludedOrdNums();

		for (let i = 0; i < rectangles.length; i++) {
			if (excluded.has(rectangles[i][4])) continue; // Selected objects are not snap targets.

			// Candidate snap ordinates of the other object: top edge, center, bottom edge.
			const targets = [
				rectangles[i][1],
				rectangles[i][1] + rectangles[i][3] / 2,
				rectangles[i][1] + rectangles[i][3],
			];

			for (let j = 0; j < yList.length; j++) {
				for (let k = 0; k < targets.length; k++) {
					const distance = Math.abs(targets[k] - yList[j]);
					// Nearest wins. On a distance tie an edge target beats a
					// center target; otherwise the earlier find stands.
					const tie = Math.abs(distance - closest) < 0.001;
					if ((distance < closest && !tie) || (tie && pickIsCenterTarget && k !== 1)) {
						closest = distance;
						pickY = targets[k];
						pickIsCenterTarget = k === 1;
						snapOffset = yList[j] - yList[0]; // 0, half height or full height.
						// k === 1 means the other object's center was the snap target.
						centerSnap = k === 1 ? [rectangles[i][0] + rectangles[i][2] / 2, targets[1]] : null;
						// Both centers meet when the matched point is the active object's center too.
						centerToCenter = k === 1 && yList[j] === yList[1];
					}
				}
			}
		}

		if (closest < ShapeHandlesSection.snapRadius()) {
			this.sectionProperties.closestY = pickY;
			this.sectionProperties.snapOffsetY = snapOffset;
			this.sectionProperties.centerSnapY = centerSnap;
			this.sectionProperties.centerToCenterY = centerToCenter;
			this.sectionProperties.guideLinesY = this.collectAlignedGuides(rectangles, excluded, yList, pickY, snapOffset, false);
			this.sectionProperties.levelGuideY = this.findLevelRow(rectangles, excluded, pickY, snapOffset);
		}
		else {
			this.sectionProperties.closestY = null;
			this.sectionProperties.centerSnapY = null;
			this.sectionProperties.centerToCenterY = false;
			this.sectionProperties.guideLinesY = [];
			this.sectionProperties.levelGuideY = null;
		}
	}

	private cloneSelectedPartInfoForGridSnap() {
		const selectedPart = Object.assign({}, app.impress.partList[app.map._docLayer._selectedPart]);
		selectedPart.leftBorder *= app.impress.twipsCorrection;
		selectedPart.upperBorder *= app.impress.twipsCorrection;
		selectedPart.rightBorder *= app.impress.twipsCorrection;
		selectedPart.lowerBorder *= app.impress.twipsCorrection;
		selectedPart.gridCoarseWidth *= app.impress.twipsCorrection;
		selectedPart.gridCoarseHeight *= app.impress.twipsCorrection;

		return selectedPart;
	}

	private getInnerRecrangleForGridSnap(selectedPart: any) {
		return new cool.SimpleRectangle(
			selectedPart.leftBorder,
			selectedPart.upperBorder,
			(selectedPart.width - selectedPart.leftBorder - selectedPart.rightBorder),
			(selectedPart.height - selectedPart.upperBorder - selectedPart.lowerBorder)
		);
	}

	private getCornerPointsForGridSnap(size: number[], position: number[], dragDistance: number[]) {
		return [
			new cool.SimplePoint((position[0] + dragDistance[0]) * app.pixelsToTwips, (position[1] + dragDistance[1]) * app.pixelsToTwips),
			new cool.SimplePoint((size[0] + position[0] + dragDistance[0]) * app.pixelsToTwips, (position[1] + dragDistance[1]) * app.pixelsToTwips),
			new cool.SimplePoint((position[0] + dragDistance[0]) * app.pixelsToTwips, (size[1] + position[1] + dragDistance[1]) * app.pixelsToTwips),
			new cool.SimplePoint((size[0] + position[0] + dragDistance[0]) * app.pixelsToTwips, (size[1] + position[1] + dragDistance[1]) * app.pixelsToTwips),
		];
	}

	private findClosestGridPoint(size: number[], position: number[], dragDistance: number[]) {
		// First rule of snap-to-grid: If you enable snap-to-grid, you have to snap.

		const selectedPart = this.cloneSelectedPartInfoForGridSnap();

		// The 4 corners of selected object's rectangle.
		const checkList = this.getCornerPointsForGridSnap(size, position, dragDistance);

		// The rectangle that is shaped by the page margins.
		const innerRectangle = this.getInnerRecrangleForGridSnap(selectedPart);

		const gapX = selectedPart.gridCoarseWidth / (selectedPart.innerSpacesX > 0 ? selectedPart.innerSpacesX : 1);
		const gapY = selectedPart.gridCoarseHeight / (selectedPart.innerSpacesY > 0 ? selectedPart.innerSpacesY : 1);

		let minX = 100000;
		let minY = 100000;
		let pickX: number = null;
		let pickY: number = null;
		let offsetX = 0;
		let offsetY = 0;
		for (let i = 0; i < 1; i++) {
			if (innerRectangle.containsPoint(checkList[i].toArray())) {

				const countX = Math.round((checkList[i].x - innerRectangle.x1) / gapX);
				const countY = Math.round((checkList[i].y - innerRectangle.y1) / gapY);

				const diffX = Math.abs(checkList[i].x - innerRectangle.x1 - gapX * countX);
				const diffY = Math.abs(checkList[i].y - innerRectangle.y1 - gapY * countY);

				if (diffX < minX) {
					minX = diffX;
					pickX = innerRectangle.x1 + (countX * gapX);
					offsetX = [1, 3].includes(i) ? size[0] : 0; // Subtract width when a right corner snapped.
				}
				if (diffY < minY) {
					minY = diffY;
					pickY = innerRectangle.y1 + (countY * gapY);
					offsetY = [2, 3].includes(i) ? size[1] : 0; // Subtract height when a bottom corner snapped.
				}
			}
		}

		// The grid fills only the axes no object alignment claimed: an
		// alignment with another object (or the slide) is a stronger
		// statement of intent than the nearest grid line. A no-match axis
		// stays null — it must not become a phantom snap at document 0.
		if (pickX !== null && this.sectionProperties.closestX === null) {
			this.sectionProperties.closestX = pickX * app.twipsToPixels;
			this.sectionProperties.snapOffsetX = offsetX;
			this.sectionProperties.snapSourceX = 'grid';
		}
		if (pickY !== null && this.sectionProperties.closestY === null) {
			this.sectionProperties.closestY = pickY * app.twipsToPixels;
			this.sectionProperties.snapOffsetY = offsetY;
			this.sectionProperties.snapSourceY = 'grid';
		}
	}

	// PowerPoint's distribution guides: if no edge/center guide matched on an
	// axis and the dragged object sits between two neighbors (with cross-axis
	// overlap), snap it to the position where both gaps are equal.
	private findEqualGapSnap(xList: number[], yList: number[], axis: 'x' | 'y') {
		const horizontal = axis === 'x';
		const mainList = horizontal ? xList : yList;
		const crossList = horizontal ? yList : xList;

		if (this.sectionProperties[horizontal ? 'closestX' : 'closestY'] !== null)
			return;
		if (mainList[0] === mainList[2]) // Degenerate (single point, e.g. resize checks).
			return;
		const objects = this.getSnapObjectRectangles();
		if (!objects) return;

		const excluded = this.getExcludedOrdNums();
		const dragMin = mainList[0], dragMax = mainList[2];
		const crossMin = crossList[0], crossMax = crossList[2];

		// Nearest neighbor on each side, requiring cross-axis overlap.
		let before: number = null; // Far edge of the nearest neighbor before the object.
		let after: number = null; // Near edge of the nearest neighbor after the object.

		for (const rectangle of objects) {
			if (excluded.has(rectangle[4])) continue;

			const mainStart = horizontal ? rectangle[0] : rectangle[1];
			const mainEnd = mainStart + (horizontal ? rectangle[2] : rectangle[3]);
			const crossStart = horizontal ? rectangle[1] : rectangle[0];
			const crossEnd = crossStart + (horizontal ? rectangle[3] : rectangle[2]);

			if (crossEnd < crossMin || crossStart > crossMax) continue;

			if (mainEnd <= dragMin && (before === null || mainEnd > before))
				before = mainEnd;
			if (mainStart >= dragMax && (after === null || mainStart < after))
				after = mainStart;
		}

		if (before === null || after === null)
			return;

		const gapBefore = dragMin - before;
		const gapAfter = after - dragMax;

		if (Math.abs(gapBefore - gapAfter) >= ShapeHandlesSection.snapRadius())
			return;

		const size = dragMax - dragMin;
		const targetCenter = (before + after) / 2;
		const snappedMin = targetCenter - size / 2;
		const snappedMax = targetCenter + size / 2;

		if (horizontal) {
			this.sectionProperties.closestX = targetCenter;
			this.sectionProperties.snapOffsetX = size / 2;
			this.sectionProperties.gapGuideX = {
				ordinate: crossList[1],
				segments: [[before, snappedMin], [snappedMax, after]]
			};
		}
		else {
			this.sectionProperties.closestY = targetCenter;
			this.sectionProperties.snapOffsetY = size / 2;
			this.sectionProperties.gapGuideY = {
				ordinate: crossList[1],
				segments: [[before, snappedMin], [snappedMax, after]]
			};
		}
	}

	public checkObjectsBoundaries(xListToCheck: number[], yListToCheck: number[]) {
		if (VulcanLiveCanvas.isCanvasDoc()) {
			this.findClosestX(xListToCheck);
			this.findClosestY(yListToCheck);
			this.findEqualGapSnap(xListToCheck, yListToCheck, 'x');
			this.findEqualGapSnap(xListToCheck, yListToCheck, 'y');

			// On a center-to-center match, also mark the active object's own center.
			// The object is not snapped until mouse up, so on a matched axis use the
			// snapped ordinate (closestX / closestY) to place the dot on the helper
			// line instead of the still-offset live position (xList[1] / yList[1]).
			if (this.sectionProperties.centerToCenterX || this.sectionProperties.centerToCenterY) {
				this.sectionProperties.draggedCenter = [
					this.sectionProperties.centerToCenterX ? this.sectionProperties.closestX : xListToCheck[1],
					this.sectionProperties.centerToCenterY ? this.sectionProperties.closestY : yListToCheck[1],
				];
			}
			else
				this.sectionProperties.draggedCenter = null;

			this.sectionProperties.snapSourceX =
				this.sectionProperties.closestX !== null ? 'object' : null;
			this.sectionProperties.snapSourceY =
				this.sectionProperties.closestY !== null ? 'object' : null;
		}
	}

	public checkHelperLinesAndSnapPoints(size: number[], position: number[], dragDistance: number[], bypassSnap: boolean = false) {
		// The one per-frame call BOTH the body drag and a resize drag already
		// make into this section, so the feedback arm needs no hook in the
		// scaling sub section.
		this.updateGestureFeedback();
		this.sectionProperties.closestX = null;
		this.sectionProperties.closestY = null;
		this.sectionProperties.centerSnapX = null;
		this.sectionProperties.centerSnapY = null;
		this.sectionProperties.draggedCenter = null;
		this.sectionProperties.gapGuideX = null;
		this.sectionProperties.gapGuideY = null;
		this.sectionProperties.guideLinesX = [];
		this.sectionProperties.guideLinesY = [];
		this.sectionProperties.levelGuideY = null;
		this.sectionProperties.snapSourceX = null;
		this.sectionProperties.snapSourceY = null;

		if (bypassSnap) {
			// Alt held: no snapping, no guides.
			this.containerObject.requestReDraw();
			return;
		}

		// Object-alignment guides run FIRST, whether or not grid snap is on:
		// an alignment with another object (or the slide) is a stronger
		// statement of intent than the nearest grid line, so it wins its
		// axis and grid snap fills the axes nothing aligned on — PowerPoint
		// blends the two the same way. (Grid snap used to suppress object
		// guides entirely, and decks default to snap-to-grid ON, so object
		// guides never appeared at all.) Core does not re-snap our commits:
		// moves send absolute positions and resize handles ride SetNoSnap,
		// so the client's blend is authoritative.
		const left = position[0] + dragDistance[0];
		const top = position[1] + dragDistance[1];
		this.checkObjectsBoundaries(
			[left, left + size[0] / 2, left + size[0]],
			[top, top + size[1] / 2, top + size[1]]
		);

		if (app.map.stateChangeHandler.getItemValue('.uno:GridUse') === 'true')
			this.findClosestGridPoint(size, position, dragDistance);

		this.containerObject.requestReDraw();
	}

	private constrainDragToSheetArea(dragDistance: number[]) {
		if (app.map.getDocType() === 'spreadsheet') {
			// Cap the drag distance to the document boundaries
			const calcGridSection = app.sectionContainer.getSectionWithName(
				app.CSections.CalcGrid.name,
			);
			const rowHeaderSection = app.sectionContainer.getSectionWithName(
				app.CSections.RowHeader.name,
			) as cool.RowHeader;
			const columnHeaderSection = app.sectionContainer.getSectionWithName(
				app.CSections.ColumnHeader.name,
			) as cool.ColumnHeader;

			if (calcGridSection && rowHeaderSection && columnHeaderSection) {
				dragDistance[0] = Math.max(
					calcGridSection.myTopLeft[0] -
						this.myTopLeft[0] -
						columnHeaderSection.getHeaderInfo().getDocVisStart(),
					dragDistance[0],
				);
				dragDistance[1] = Math.max(
					calcGridSection.myTopLeft[1] -
						this.myTopLeft[1] -
						rowHeaderSection.getHeaderInfo().getDocVisStart(),
					dragDistance[1],
				);
				// Clip svg at the header edges
				if (this.sectionProperties.svg) {
					const cropLeft =
						Math.max(
							calcGridSection.myTopLeft[0] -
								this.myTopLeft[0] -
								dragDistance[0],
							0,
						) / app.dpiScale;
					const cropTop =
						Math.max(
							calcGridSection.myTopLeft[1] -
								this.myTopLeft[1] -
								dragDistance[1],
							0,
						) / app.dpiScale;
					this.sectionProperties.svg.style.clipPath = `inset(${cropTop}px 0px 0px ${cropLeft}px)`;
				}
			}
		}
	}

	onMouseMove(position: cool.SimplePoint, dragDistance: number[], e?: MouseEvent) {
		let canDrag = !app.file.textCursor.visible;

		// M-0017 §D measures the same inertness in the reference, so this
		// block is parity and stays. The expression now lives in
		// impressCellSelectionBlocksDrag because the select-table chip is its
		// escape hatch and must be armed by the same fact.
		if (canDrag && ShapeHandlesSection.impressCellSelectionBlocksDrag())
			canDrag = false;

		if (this.containerObject.isDraggingSomething() && canDrag) {
			if (this.isDragCancelled())
				return;

			// Shift constrains the move to the dominant axis (PowerPoint),
			// re-evaluated continuously during the drag.
			if (e?.shiftKey) {
				if (Math.abs(dragDistance[0]) >= Math.abs(dragDistance[1]))
					dragDistance[1] = 0;
				else
					dragDistance[0] = 0;
			}

			this.constrainDragToSheetArea(dragDistance);

			if (!app.activeDocument.activeLayout.viewedRectangle.equals(this.sectionProperties.viewedRectangleOnMouseDown.toArray())) {
				const diff = new cool.SimplePoint(
					app.activeDocument.activeLayout.viewedRectangle.x1 - this.sectionProperties.viewedRectangleOnMouseDown.x1,
					app.activeDocument.activeLayout.viewedRectangle.y1 - this.sectionProperties.viewedRectangleOnMouseDown.y1
				);

				this.setPosition(this.sectionProperties.initialPosition[0] + diff.pX, this.sectionProperties.initialPosition[1] + diff.pY);
			}

			// On the vector path the object's own content translates with
			// the drag (VectorContentSection._getDragOverride), so the SVG
			// ghost stays out of it: the ghost depends on a
			// shapeselectioncontent answer that lands ~1 RTT after the
			// selection, and a select-then-drag inside that window moved
			// only the frame while the content sat still.
			// Snap state FIRST: the ghost magnet below reads closest/
			// lastDragDistance, and computing it against the previous
			// event's state made the ghost shiver around the guide by one
			// mouse delta per move (adversarial review F1).
			this.sectionProperties.lastDragDistance = [dragDistance[0], dragDistance[1]];
			this.checkHelperLinesAndSnapPoints(this.size, this.position, dragDistance, ShapeHandlesSection.snapBypassed(e));

			const vectorDrag = RenderManager.isVectorRendering();
			if (this.sectionProperties.svg && !vectorDrag) {
				const addition = app.map._docLayer.isCalcRTL() ? -this.size[0] : 0;
				const ghostMagnet = this.snappedDragDelta();
				this.sectionProperties.svg.style.left = String((this.myTopLeft[0] + dragDistance[0] + ghostMagnet[0] + addition) / app.dpiScale) + 'px';
				this.sectionProperties.svg.style.top = String((this.myTopLeft[1] + dragDistance[1] + ghostMagnet[1]) / app.dpiScale) + 'px';
				// Full opacity: the ghost exactly covers the object at the drag
				// start, so this reads as the real object moving (PowerPoint).
				this.sectionProperties.svg.style.opacity = 1;
			}

			if (!vectorDrag) this.showSVG();
			else this.containerObject.requestReDraw();

			if (!this.containerObject.isMouseInside()) {
				position.pX += this.myTopLeft[0];
				position.pY += this.myTopLeft[1];
				app.map.fire('handleautoscroll', { pos: { x: position.cX, y: position.cY }, map: app.map });
			}
			else app.map.fire('scrollvelocity', { vx: 0, vy: 0 });
		}
	}

	getViewBox(svg: any): number[] {
		let viewBox: any = svg.getAttribute('viewBox');

		if (viewBox) {
			viewBox = viewBox.split(' ');
			for (let i = 0; i < viewBox.length; i++) viewBox[i] = parseInt(viewBox[i]);
		}
		else
			viewBox = null;

		return viewBox;
	}

	adjustSVGProperties() {
		if (this.sectionProperties.svg && this.sectionProperties.svg.style.display === '' && GraphicSelection.hasActiveSelection()) {
			const widthText = GraphicSelection.rectangle.cWidth + 'px';
			const heightText = GraphicSelection.rectangle.cHeight + 'px';

			const viewBox: number[] = this.getViewBox(this.sectionProperties.svg.children[0]);
			const isImage = this.sectionProperties.svg.querySelectorAll('.Graphic').length > 0;

			const clientRect = (this.sectionProperties.svg.children[0] as SVGElement).getBoundingClientRect();

			if (viewBox && !isImage && clientRect.width > 0 && clientRect.height > 0) {
				this.sectionProperties.svg.children[0].style.width = widthText;
				this.sectionProperties.svg.children[0].style.height = heightText;
			}
			else {
				this.sectionProperties.svg.style.width = widthText;
				this.sectionProperties.svg.style.height = heightText;

				if (isImage) {
					this.sectionProperties.svg.children[0].style.width = widthText;
					this.sectionProperties.svg.children[0].style.height = heightText;
				}
			}

			// New view layouts are not tested for Calc yet. Transition to new structure is not complete.
			this.updateSVGPosition();
		}
		this.hideSVG();
	}

	// Shared positioning logic used by both adjustSVGProperties (initial
	// placement) and onNewDocumentTopLeft (viewport change update).
	private updateSVGPosition(): void {
		if (!this.sectionProperties.svg || !GraphicSelection.hasActiveSelection()) return;

		const left = GraphicSelection.rectangle.v1X;
		const top = GraphicSelection.rectangle.v1Y;

		const leftAddition = app.activeDocument.activeLayout.type === 'ViewLayoutBase' ? 0 : this.containerObject.getDocumentAnchor()[0];
		const topAddition = app.activeDocument.activeLayout.type === 'ViewLayoutBase' ? 0 : this.containerObject.getDocumentAnchor()[1];

		this.sectionProperties.svg.style.left = Math.round((left + leftAddition) / app.dpiScale) + 'px';
		this.sectionProperties.svg.style.top = Math.round((top + topAddition) / app.dpiScale) + 'px';
		this.sectionProperties.svgPosition = [left, top];
	}

	onNewDocumentTopLeft(): void {
		if (this.sectionProperties.svgPosition) {
			this.updateSVGPosition();
		}
	}

	drawXAxis(x: number) {
		this.context.moveTo(x, 0);
		this.context.lineTo(x, this.context.canvas.height);
		this.context.stroke();
	}

	drawYAxis(y: number) {
		this.context.moveTo(0, y);
		this.context.lineTo(this.context.canvas.width, y);
		this.context.stroke();
	}

	// Marks the center of the other object we are aligning to with a small red dot.
	// centerPoint is the [x, y] center of that object in pixels.
	drawCenterSnapDot(centerPoint: number[]) {
		const x = this.containerObject.getDocumentAnchor()[0] + centerPoint[0] - app.activeDocument.activeLayout.viewedRectangle.pX1;
		const y = this.containerObject.getDocumentAnchor()[1] + centerPoint[1] - app.activeDocument.activeLayout.viewedRectangle.pY1;

		this.context.beginPath();
		this.context.fillStyle = 'red';
		this.context.arc(x, y, 3 * app.dpiScale, 0, 2 * Math.PI);
		this.context.fill();
		this.context.closePath();
	}

	// Converts a document core-pixel coordinate to view (canvas) coordinates.
	private docToViewX(x: number): number {
		return this.containerObject.getDocumentAnchor()[0] + x - app.activeDocument.activeLayout.viewedRectangle.pX1;
	}

	private docToViewY(y: number): number {
		return this.containerObject.getDocumentAnchor()[1] + y - app.activeDocument.activeLayout.viewedRectangle.pY1;
	}

	// A dashed segment with small arrowheads at both ends, marking one of the
	// equal gaps of a distribution guide.
	private drawGapSegment(fromX: number, fromY: number, toX: number, toY: number) {
		const arrowSize = 3 * app.dpiScale;
		const angle = Math.atan2(toY - fromY, toX - fromX);

		this.context.beginPath();
		this.context.moveTo(fromX, fromY);
		this.context.lineTo(toX, toY);
		this.context.stroke();

		this.context.setLineDash([]);
		for (const [tipX, tipY, tipAngle] of [[fromX, fromY, angle], [toX, toY, angle + Math.PI]] as Array<[number, number, number]>) {
			this.context.beginPath();
			this.context.moveTo(tipX, tipY);
			this.context.lineTo(tipX + arrowSize * Math.cos(tipAngle + Math.PI * 0.25), tipY + arrowSize * Math.sin(tipAngle + Math.PI * 0.25));
			this.context.moveTo(tipX, tipY);
			this.context.lineTo(tipX + arrowSize * Math.cos(tipAngle - Math.PI * 0.25), tipY + arrowSize * Math.sin(tipAngle - Math.PI * 0.25));
			this.context.stroke();
		}
		this.context.setLineDash([4, 3]);
	}

	private drawGapGuides() {
		const guideX = this.sectionProperties.gapGuideX;
		if (guideX) {
			const y = this.docToViewY(guideX.ordinate);
			for (const segment of guideX.segments)
				this.drawGapSegment(this.docToViewX(segment[0]), y, this.docToViewX(segment[1]), y);
		}

		const guideY = this.sectionProperties.gapGuideY;
		if (guideY) {
			const x = this.docToViewX(guideY.ordinate);
			for (const segment of guideY.segments)
				this.drawGapSegment(x, this.docToViewY(segment[0]), x, this.docToViewY(segment[1]));
		}
	}

	drawShapeAlignmentHelperLines() {
		this.context.save();

		this.context.setLineDash([4, 3]);
		this.context.strokeStyle = HelperLineStyles.smartGuidesStyle;
		this.context.translate(-this.myTopLeft[0], -this.myTopLeft[1]);

		this.context.beginPath();

		// A distribution (equal-gap) snap is drawn as gap segments, not as an
		// alignment axis through the snapped center.
		if (this.sectionProperties.closestX !== null && this.sectionProperties.snapSourceX !== 'grid' && !this.sectionProperties.gapGuideX) {
			const guides = this.sectionProperties.guideLinesX.length ? this.sectionProperties.guideLinesX : [this.sectionProperties.closestX];
			for (const guide of guides)
				this.drawXAxis(this.docToViewX(guide));
		}

		if (this.sectionProperties.closestY !== null && this.sectionProperties.snapSourceY !== 'grid' && !this.sectionProperties.gapGuideY) {
			const guides = this.sectionProperties.guideLinesY.length ? this.sectionProperties.guideLinesY : [this.sectionProperties.closestY];
			for (const guide of guides)
				this.drawYAxis(this.docToViewY(guide));
		}

		// The level line repaints solid and heavier over its dashed twin: a
		// row of tops reads as one layer line, not one more alignment. Own
		// path, or the stroke would restyle every dashed guide drawn above.
		if (this.sectionProperties.levelGuideY !== null && this.sectionProperties.snapSourceY !== 'grid' && !this.sectionProperties.gapGuideY) {
			this.context.save();
			this.context.beginPath();
			this.context.setLineDash([]);
			this.context.lineWidth = 1.5 * app.dpiScale;
			this.drawYAxis(this.docToViewY(this.sectionProperties.levelGuideY));
			this.context.restore();
		}

		this.context.closePath();

		this.drawGapGuides();

		// When snapping to another object's center, mark that center with a red dot.
		if (this.sectionProperties.centerSnapX !== null)
			this.drawCenterSnapDot(this.sectionProperties.centerSnapX);

		if (this.sectionProperties.centerSnapY !== null)
			this.drawCenterSnapDot(this.sectionProperties.centerSnapY);

		// On a center-to-center match, also mark the active object's own center.
		if (this.sectionProperties.draggedCenter !== null)
			this.drawCenterSnapDot(this.sectionProperties.draggedCenter);

		this.context.restore();
	}

	drawGridHelperLines() {
		this.context.save();

		this.context.translate(-this.myTopLeft[0], -this.myTopLeft[1]);

		this.context.beginPath();

		if (this.sectionProperties.closestX !== null && this.sectionProperties.snapSourceX === 'grid') {
			this.context.strokeStyle = HelperLineStyles.gridSolidStyle;
			this.context.setLineDash([]);

			const x = this.containerObject.getDocumentAnchor()[0] + this.sectionProperties.closestX - app.activeDocument.activeLayout.viewedRectangle.pX1;

			this.drawXAxis(x);

			// Draw a second line on top of solid white-ish line.
			this.context.setLineDash([4, 3]);
			this.context.strokeStyle = HelperLineStyles.gridDashedStyle;

			this.drawXAxis(x);
		}

		if (this.sectionProperties.closestY !== null && this.sectionProperties.snapSourceY === 'grid') {
			this.context.strokeStyle = HelperLineStyles.gridSolidStyle;
			this.context.setLineDash([]);

			const y = this.containerObject.getDocumentAnchor()[1] + this.sectionProperties.closestY - app.activeDocument.activeLayout.viewedRectangle.pY1;

			this.drawYAxis(y);

			// Draw a second line on top of solid white-ish line.
			this.context.setLineDash([4, 3]);
			this.context.strokeStyle = HelperLineStyles.gridDashedStyle;

			this.drawYAxis(y);
		}

		this.context.closePath();

		this.context.restore();
	}

	private anythingToDraw(): boolean {
		return 	this.sectionProperties.closestX !== null ||
				this.sectionProperties.closestY !== null;
	}

	/*
		THE MID-GESTURE FEEDBACK ARM.

		The reference app states a drag three ways at once, and each gesture
		gets its own dialect:

		  - MOVE   all nine handles on the live object, grey wireframe at the
		           ORIGIN;
		  - RESIZE only the dragged handle;
		  - ROTATE only the rotation handle, grey wireframe at the DESTINATION
		           angle while the live object holds its own, and a dark chip
		           reading the live angle.

		So the wireframe means origin during a move and destination during a
		rotate — same art, opposite roles. Resize takes no wireframe here
		because a handle drag never offsets the selection frame: the original
		rectangle is already drawn, in the frame's own colour.

		Armed from checkHelperLinesAndSnapPoints and from the rotation sub
		section's readout; disarmed from scheduleGhostFallbackHide, which every
		gesture's commit already calls, and from cancelDrag. Phone only — a
		desktop drag leaves the whole handle set standing.
	*/
	private currentGestureTarget(): string {
		if (!this.containerObject || !this.containerObject.isDraggingSomething())
			return null;

		const target = this.containerObject.targetSection;
		if (target === this.name) return target;
		if (target && target.startsWith(this.sectionProperties.subSectionPrefix))
			return target;

		return null;
	}

	private gestureOfTarget(target: string): string {
		if (target === null) return null;
		if (target === this.name) return 'move';
		if (target === this.sectionProperties.subSectionPrefix + 'rotation')
			return 'rotate';

		return 'resize';
	}

	public updateGestureFeedback(): void {
		if (!this.sectionProperties.phoneChrome) return;

		const target = this.currentGestureTarget();
		if (target === this.sectionProperties.activeGestureTarget) return;

		this.releaseHandleSuppression();
		this.sectionProperties.activeGestureTarget = target;
		this.sectionProperties.activeGesture = this.gestureOfTarget(target);

		const gesture = this.sectionProperties.activeGesture;
		if (gesture === 'resize' || gesture === 'rotate')
			this.applyHandleSuppression(target);

		if (gesture !== 'rotate')
			this.clearRotationFeedback();
		else
			// The live object holds its angle until the drop, so a rotated
			// ghost would state a second, contradicting angle over it.
			this.hideSVG();
	}

	public endGestureFeedback(): void {
		if (this.sectionProperties.activeGestureTarget === null) return;

		this.releaseHandleSuppression();
		this.sectionProperties.activeGestureTarget = null;
		this.sectionProperties.activeGesture = null;
		this.clearRotationFeedback();
		this.containerObject.requestReDraw();
	}

	private applyHandleSuppression(keepName: string): void {
		const suppressed: any[] = [];

		for (const subSection of this.sectionProperties.subSections) {
			if (subSection.name === keepName || !subSection.showSection) continue;

			subSection.setShowSection(false);
			suppressed.push(subSection);
		}

		this.sectionProperties.suppressedSubSections = suppressed;
	}

	// Back to the parent's own state, which is what onSectionShowStatusChange
	// hands them, and only to the ones this arm took down.
	private releaseHandleSuppression(): void {
		const suppressed = this.sectionProperties.suppressedSubSections;
		if (!suppressed) return;

		for (const subSection of suppressed)
			subSection.setShowSection(this.showSection);

		this.sectionProperties.suppressedSubSections = null;
	}

	/*
		The rotate readout, published every frame by the rotation sub section.
		The chip carries the ABSOLUTE angle, core's counter-clockwise 1/100
		degree: the delta alone reads 0° on a shape that is already rotated and
		is nudged by nothing.
	*/
	public setRotationFeedback(angleDifference: number, draggedPoint: cool.SimplePoint): void {
		this.updateGestureFeedback();

		if (!this.sectionProperties.phoneChrome) return;

		this.sectionProperties.rotationAngleHundredths =
			(GraphicSelection.selectionAngle ?? 0) + angleDifference;
		// Screen radians, clockwise-positive: the same sign the ghost's CSS
		// rotate takes on the desktop path.
		this.sectionProperties.rotationScreenRadians =
			((-angleDifference / 100) * Math.PI) / 180;
		this.sectionProperties.rotationChipAnchor = draggedPoint;
	}

	private clearRotationFeedback(): void {
		this.sectionProperties.rotationAngleHundredths = null;
		this.sectionProperties.rotationScreenRadians = 0;
		this.sectionProperties.rotationChipAnchor = null;
	}

	// Whole degrees, 0-359. The chip states the shape's angle, not the drag's.
	public static formatAngle(angleHundredths: number): string {
		const degrees = Math.round(angleHundredths / 100);
		return String(((degrees % 360) + 360) % 360) + '°';
	}

	// View-pixel corners in draw order. A rotate turns them about the
	// rectangle's centre; a move leaves them where the object started.
	public gestureWireframeCorners(gesture: string): number[][] {
		const rectangle = this.boundingRectangle;
		const corners = [
			[rectangle.v1X, rectangle.v1Y],
			[rectangle.v2X, rectangle.v2Y],
			[rectangle.v4X, rectangle.v4Y],
			[rectangle.v3X, rectangle.v3Y],
		];

		if (gesture !== 'rotate') return corners;

		const radians = this.sectionProperties.rotationScreenRadians;
		const centerX = (corners[0][0] + corners[2][0]) * 0.5;
		const centerY = (corners[0][1] + corners[2][1]) * 0.5;
		const cos = Math.cos(radians);
		const sin = Math.sin(radians);

		return corners.map(function (corner: number[]): number[] {
			const x = corner[0] - centerX;
			const y = corner[1] - centerY;
			return [centerX + x * cos - y * sin, centerY + x * sin + y * cos];
		});
	}

	private drawGestureWireframe(): void {
		const gesture = this.sectionProperties.activeGesture;
		if (gesture !== 'move' && gesture !== 'rotate') return;

		const corners = this.gestureWireframeCorners(gesture);

		this.context.save();
		this.context.setTransform(1, 0, 0, 1, 0, 0);
		this.context.strokeStyle = ShapeHandlesSection.phoneGestureFeedback.wireframeStroke;
		this.context.lineWidth = app.dpiScale;
		this.context.setLineDash([]);
		this.context.beginPath();
		this.context.moveTo(corners[0][0], corners[0][1]);
		for (let i = 1; i < corners.length; i++)
			this.context.lineTo(corners[i][0], corners[i][1]);
		this.context.closePath();
		this.context.stroke();
		this.context.restore();
	}

	private fillRoundedRect(x: number, y: number, width: number, height: number, radius: number): void {
		this.context.beginPath();
		this.context.moveTo(x + radius, y);
		this.context.arcTo(x + width, y, x + width, y + height, radius);
		this.context.arcTo(x + width, y + height, x, y + height, radius);
		this.context.arcTo(x, y + height, x, y, radius);
		this.context.arcTo(x, y, x + width, y, radius);
		this.context.closePath();
		this.context.fill();
	}

	private drawRotationAngleChip(): void {
		const anchor = this.sectionProperties.rotationChipAnchor;
		if (!anchor || this.sectionProperties.rotationAngleHundredths === null)
			return;

		const metrics = ShapeHandlesSection.phoneGestureFeedback;
		const label = ShapeHandlesSection.formatAngle(
			this.sectionProperties.rotationAngleHundredths,
		);

		this.context.save();
		this.context.setTransform(1, 0, 0, 1, 0, 0);
		this.context.font = 'bold ' + metrics.chipFontCss * app.dpiScale + 'px Verdana';

		const height = metrics.chipHeightCss * app.dpiScale;
		const width =
			this.context.measureText(label).width +
			2 * metrics.chipPaddingCss * app.dpiScale;

		// The chip is the only mid-gesture chrome that can leave the canvas —
		// a shape rotated near the top edge carries it off — so the whole box
		// is clamped inside it.
		const left = Math.min(
			Math.max(this.docToViewX(anchor.pX) - width * 0.5, 0),
			this.context.canvas.width - width,
		);
		const top = Math.min(
			Math.max(
				this.docToViewY(anchor.pY) -
					metrics.chipStandoffCss * app.dpiScale -
					height * 0.5,
				0,
			),
			this.context.canvas.height - height,
		);

		this.context.fillStyle = metrics.chipFill;
		this.fillRoundedRect(left, top, width, height, metrics.chipRadiusCss * app.dpiScale);

		this.context.fillStyle = metrics.chipTextFill;
		this.context.textAlign = 'center';
		this.context.textBaseline = 'middle';
		this.context.fillText(label, left + width * 0.5, top + height * 0.5);
		this.context.restore();
	}

	// The selection frame rectangle for the CURRENT live resize re-wrap,
	// built from the drag's new geometry (the same core-pixel center and
	// size the handle dots move to), or null when no such resize is
	// active. Only while the reflow override is live for this object, so
	// move drags and non-text resizes are untouched.
	private liveResizeFrameRect(): cool.SimpleRectangle | null {
		const reflow = app.definitions.vulcanImpressResizeReflow;
		const ov = reflow?.getLiveOverride?.();
		if (!ov) return null;
		const extraInfo: any = GraphicSelection.extraInfo;
		if (!extraInfo || ov.ordNum !== extraInfo.OrdNum) return null;
		const rp = this.sectionProperties.liveShapeRecProps;
		if (!rp || !rp.center) return null;
		return cool.SimpleRectangle.fromCorePixels([
			rp.center.pX - rp.width * 0.5,
			rp.center.pY - rp.height * 0.5,
			rp.width,
			rp.height,
		]);
	}

	private drawSelectionFrame() {
		if (HelperLineStyles.selectionFrameStyle === null) HelperLineStyles.initiate();

		this.context.save();
		this.context.setTransform(1, 0, 0, 1, 0, 0);

		this.context.beginPath();
		this.context.strokeStyle = HelperLineStyles.selectionFrameStyle;
		this.context.lineWidth = app.dpiScale;

		// PowerPoint's mode indicator: solid border while the object is
		// selected, dashed border while editing text inside it.
		if (app.file.textCursor.visible)
			this.context.setLineDash([3 * app.dpiScale, 3 * app.dpiScale]);
		else
			this.context.setLineDash([]);

		let offsetX = 0;
		let offsetY = 0;
		if (this.containerObject.isDraggingSomething() && this.containerObject.targetSection === this.name) {
			offsetX = app.calc.isRTL() ? -this.sectionProperties.lastDragDistance[0] : this.sectionProperties.lastDragDistance[0];
			offsetY = this.sectionProperties.lastDragDistance[1];
			// Magnetize: the frame rides the guide the drop will land on.
			const magnet = this.snappedDragDelta();
			offsetX += magnet[0];
			offsetY += magnet[1];
		}
		else if (this.containerObject.isDraggingSomething() &&
			VulcanImpressSelectEcho.isDocumentPressTarget(
				this.containerObject.targetSection)) {
			// Select-and-drag in one gesture: the press selected the object
			// and the SAME drag is moving it (core moves on the latched
			// buttondown). The marquee window section measures the travel;
			// the content echo follows it too (VectorContentSection).
			const gestureTravel = ShapeHandlesSection.gestureDragTravel();
			if (gestureTravel) {
				offsetX = gestureTravel[0];
				offsetY = gestureTravel[1];
			}
		}
		else {
			// Post-drop of a select-and-drag gesture: the drag latch is
			// already cleared by the click event, so the dragging branch
			// above is unreachable - the release travel keeps the frame
			// at the drop until the moved rectangle lands (review F2).
			// Cleared by the same message that updates the rectangle, so
			// it can never double-offset the moved rect.
			const releaseTravel = VulcanImpressSelectEcho.getReleaseTravel();
			if (releaseTravel) {
				offsetX = releaseTravel[0];
				offsetY = releaseTravel[1];
			} else {
				// A held arrow-key nudge draws the frame at the gesture's
				// intent; the addend shrinks to zero by construction as
				// the authoritative rectangles land (read per frame,
				// never stored here — zoom replay rebuilds these
				// sections).
				const nudge = app.definitions.vulcanImpressNudge;
				const nudgeOffset = nudge ? nudge.getFramePixelOffset() : null;
				if (nudgeOffset) {
					offsetX = nudgeOffset[0];
					offsetY = nudgeOffset[1];
				}
			}
		}

		// A multi-selection is NOT a group (PowerPoint vocabulary): every
		// member draws its OWN frame and its own handle dots, and no
		// extra rectangle appears — core's reported selection rectangle
		// is just the last-added member for click-adds, and drawing it
		// double-framed that one member while the rest wore bare
		// outlines. A real group draws the single union frame with the
		// working handles, so the two states look different, and
		// grouping stays the explicit Ctrl+G.
		// A live text-box RESIZE reflows the content and hides the scale
		// ghost, so the frame must track the NEW geometry itself — the
		// offset branches above only follow MOVE drags, and without this
		// the box stayed at the original size while the handle dots moved
		// to the new corners.
		const resizeRect = this.liveResizeFrameRect();
		if (resizeRect) {
			this.drawViewRectangle(resizeRect);
		} else if (this.isMultiSelection()) {
			this.drawMemberFrames(offsetX, offsetY);
		} else {
			const rectangle = this.boundingRectangle.clone();
			rectangle.pX1 += offsetX;
			rectangle.pY1 += offsetY;
			this.drawViewRectangle(rectangle);
		}

		this.context.setLineDash([]);
		this.context.closePath();

		this.context.restore();
	}

	private isMultiSelection(): boolean {
		// selectedOrdNums is appended by SdrMarkView::SetMarkHandlesForKit
		// for EVERY app -- unlike the ObjectRectangles append a few lines
		// below it, which IS IsImpress()-guarded -- so this predicate has
		// to scope itself. Ungated, Writer and Calc take the multi-select
		// branch on any 2+ object selection and lose BOTH their handles
		// (getHandles() skips all seven builders) and their selection
		// frame (drawMemberFrames() returns early with no ObjectRectangles),
		// leaving an invisible selection that still drags. Drawings take
		// the branch with decks: ObjectRectangles are converted for the
		// whole sd family (GraphicSelection.convertObjectRectangleTwipsToPixels).
		//
		// Gating here rather than at the C++ append is deliberate:
		// SdDrawDocument's ctor calls SetImpress(true) unconditionally, so
		// IsImpress() is true for Draw too, and the client must stay correct
		// against older pinned images that still stream the field.
		if (!VulcanLiveCanvas.isCanvasDoc()) return false;
		const selected = GraphicSelection.extraInfo?.selectedOrdNums;
		return Array.isArray(selected) && selected.length > 1;
	}

	private drawMemberFrames(offsetX: number, offsetY: number) {
		const extraInfo = GraphicSelection.extraInfo;
		const selected = extraInfo?.selectedOrdNums;
		if (!Array.isArray(selected) || selected.length < 2) return;
		// Inside an entered group, the streamed ObjectRectangles are the page's
		// TOP-LEVEL objects, whose ordinals collide with the selected members'
		// — drawing per member would frame the wrong page objects. Draw one
		// frame at the combined selection rectangle instead.
		if (VulcanImpressSelectEcho.isInGroupContext()) {
			const rectangle = this.boundingRectangle.clone();
			rectangle.pX1 += offsetX;
			rectangle.pY1 += offsetY;
			this.context.strokeStyle = HelperLineStyles.selectionFrameStyle;
			this.context.lineWidth = app.dpiScale;
			this.drawViewRectangle(rectangle);
			this.drawMemberHandleDots(rectangle);
			return;
		}
		const rectangles = extraInfo.ObjectRectangles;
		if (!Array.isArray(rectangles)) return;
		for (const entry of rectangles) {
			// [x, y, w, h, ordNum], core pixels (the snap-target layout).
			if (!Array.isArray(entry) || entry.length < 5) continue;
			if (selected.indexOf(entry[4]) === -1) continue;
			const rectangle = cool.SimpleRectangle.fromCorePixels([
				entry[0] + offsetX,
				entry[1] + offsetY,
				entry[2],
				entry[3],
			]);
			// The dot pass restyles the context; re-assert the frame style
			// for every member.
			this.context.strokeStyle = HelperLineStyles.selectionFrameStyle;
			this.context.lineWidth = app.dpiScale;
			this.drawViewRectangle(rectangle);
			this.drawMemberHandleDots(rectangle);
		}
	}

	// The same white dots the working single-selection handles paint,
	// at each member's corners and edge midpoints — presentation only,
	// PowerPoint's multi-select look. Draw-only: multi-selections build
	// no grip sub-sections (see getHandles), so a press inside any
	// member stays a drag-move of the whole selection.
	private drawMemberHandleDots(rectangle: cool.SimpleRectangle) {
		ShapeHandlesSection.drawHandleDotRing(this.context, rectangle);
	}

	// The snap correction the DROP will apply, live: how far the drawn
	// object must shift so its snapping edge sits ON the guide. Zero on
	// axes with no snap (or with Alt held - the check nulls closest).
	// Same math as sendDuplicateDrag/sendTransformCommand, so what
	// magnetizes during the drag is exactly where the object lands.
	public snappedDragDelta(): [number, number] {
		let dx = 0;
		let dy = 0;
		if (this.sectionProperties.closestX !== null) {
			const unsnappedLeft =
				this.position[0] + this.sectionProperties.lastDragDistance[0];
			dx =
				this.sectionProperties.closestX -
				this.sectionProperties.snapOffsetX -
				unsnappedLeft;
		}
		if (this.sectionProperties.closestY !== null) {
			const unsnappedTop =
				this.position[1] + this.sectionProperties.lastDragDistance[1];
			dy =
				this.sectionProperties.closestY -
				this.sectionProperties.snapOffsetY -
				unsnappedTop;
		}
		return [dx, dy];
	}

	// The live travel of a select-and-drag gesture on THIS part's
	// selection, in core px — non-null only while a tiles-target drag is
	// moving the object the press hit (single objects and groups).
	public static gestureDragTravel(): [number, number] | null {
		// Live: the marquee window section's travel plus the snap magnet
		// once the press-time selection has landed (the echo owns the
		// gesture and reads both).
		const live = VulcanImpressSelectEcho.getLiveGestureTravelPx();
		if (live) return live;
		// Post-drop: the frame holds the drop travel until the moved
		// rectangle lands, mirroring the content release-hold - without
		// this the frame snapped back to the origin for one round trip.
		return VulcanImpressSelectEcho.getReleaseTravel();
	}

	// A select-and-drag gesture whose selection answer landed mid-drag
	// borrows this section's snap probe and guides: the drag
	// targets the document surface (this section did not exist at the
	// press), so onMouseMove never runs for it. Same inputs as the
	// handles-target drag, so guides and magnet behave identically —
	// and identical to the detached probe (createGestureSnapProbe) that
	// ran the frames before this section landed.
	public mirrorGestureDrag(travelPx: [number, number], e?: MouseEvent): void {
		// A live mirrored drag: an Escape from an earlier document-surface
		// drag left the cancel flag set (this section's own mouse-up never
		// ran to consume it), and a stale flag would keep the grips from
		// standing down.
		this.sectionProperties.dragCancelled = false;
		this.sectionProperties.lastDragDistance = [travelPx[0], travelPx[1]];
		this.checkHelperLinesAndSnapPoints(this.size, this.position, [travelPx[0], travelPx[1]], ShapeHandlesSection.snapBypassed(e));
	}

	// The top-left the mirrored gesture drag commits, in core twips — the
	// identical math sendTransformCommand uses, snap included — and the
	// mirror is released.
	public gestureCommitTopLeftTwips(travelPx: [number, number]): number[] {
		this.sectionProperties.lastDragDistance = [travelPx[0], travelPx[1]];
		const topLeft = this.dragCommitTopLeftTwips();
		this.clearGestureMirror();
		return topLeft;
	}

	public clearGestureMirror(): void {
		this.sectionProperties.lastDragDistance = [0, 0];
		this.clearHelperLines();
	}

	// One magnet strength for every snap family (edge/center align and
	// equal-gap): 15 CSS px, up from 10 — stronger magnet pull, per design review.
	public static snapRadius(): number {
		return 15 * app.dpiScale;
	}

	// Shared with the select echo (VulcanImpressSelectEcho draws the same
	// ring from the marquee section while its press awaits the server).
	// Expects an absolute (identity-transform) context.
	public static drawHandleDotRing(
		context: CanvasRenderingContext2D,
		rectangle: cool.SimpleRectangle,
	) {
		const left = rectangle.v1X;
		const top = rectangle.v1Y;
		const right = rectangle.v4X;
		const bottom = rectangle.v4Y;
		const midX = (left + right) / 2;
		const midY = (top + bottom) / 2;
		const dots: [number, number][] = [
			[left, top], [midX, top], [right, top],
			[left, midY], [right, midY],
			[left, bottom], [midX, bottom], [right, bottom],
		];
		const radius = 4.5 * app.dpiScale;
		context.fillStyle = HelperLineStyles.handleFillStyle;
		context.strokeStyle = HelperLineStyles.handleStrokeStyle;
		context.lineWidth = app.dpiScale;
		for (const [x, y] of dots) {
			context.beginPath();
			context.arc(x, y, radius, 0, Math.PI * 2);
			context.fill();
			context.stroke();
		}
	}

	public onDraw() {
		// A held select-echo press means core is about to replace or
		// clear this selection: the stale chrome standing next to the
		// echo frame would read as a multi-selection. Draw-time gate —
		// dropping the echo restores everything on the next redraw.
		if (VulcanImpressSelectEcho.suppressesSelectionChrome()) {
			this.hideSVG();
			return;
		}
		this.drawSelectionFrame();
		this.drawShapeDragPreview();
		this.drawGestureWireframe();
		this.drawRotationAngleChip();
		if (!this.showSection || !this.isVisible)
			this.hideSVG();
		else if (this.anythingToDraw()) {
			// Per-axis provenance: a grid-won axis draws its grid line, an
			// object-won axis its alignment guides — both can be live at once.
			this.drawGridHelperLines();
			this.drawShapeAlignmentHelperLines();
		}
	}

	removeSubSections(): void {
		// The selection is going away, so a live feedback arm would be holding
		// references to sections that no longer exist.
		this.endGestureFeedback();
		this.removeSVG();
		for (let i = 0; i < this.sectionProperties.subSections.length; i++) {
			this.containerObject.removeSection(this.sectionProperties.subSections[i].name);
		}
	}

	onContextMenu(point: cool.SimplePoint, e: MouseEvent): void {
		const viewed = app.activeDocument.activeLayout.viewedRectangle;
		const anchor = this.containerObject.getDocumentAnchor();
		point.pX = this.myTopLeft[0] + point.pX + viewed.pX1 - anchor[0];
		point.pY = this.myTopLeft[1] + point.pY + viewed.pY1 - anchor[1];
		app.activeDocument.mouseControl.setMousePosition(point);
		app.activeDocument.mouseControl.onContextMenu(point, e);
	}

	private hideSubSections() {
		for (let i = 0; i < this.sectionProperties.subSections.length; i++)
			this.sectionProperties.subSections[i].setShowSection(false);
	}

	/*
		THE SLIDE CANVAS SPENDS A TAP-AGAIN ON THE OBJECT IT ALREADY HOLDS.

		This method IS that grammar. While a shape is selected with no caret in
		it, the section is `interactable` (GraphicSelectionMiddleware
		.onTextCursorVisibility) and CanvasSectionContainer
		.findSectionContainingPoint returns exactly one section and never walks
		down — so every tap inside the selection rect lands HERE and MouseControl
		never sees it.

		The reference answers such a tap with NOTHING: select is the middle
		rung, and only a double tap escalates into the object's text. That is
		the ruled divergence from the cell grammar, where tapping the cell you
		are already on opens it — the two surfaces do not share this rung, and
		the cell reflex is the one thing that must not cross to a slide.

		So the single tap is spent: the deferred count 1 below is not armed and
		nothing reaches the wire. The touch double-tap bookkeeping still runs,
		because escalation is the SECOND tap's job: the builder in onClick
		sends the count 2 inside tap 2's own click. A phone does have a native
		dblclick: Android's Chromium fires one 2-4 ms after tap 2's click
		(lane B device runs cp-uib1, cp-d1), and whether the iPhone's WKWebView
		fires one is unmeasured. onDoubleClick spends that dblclick as the
		echo of a built double tap and takes it as the route in only when the
		builder did not run, so one double tap is one count 2 either way.

		WHAT ALREADY GATES THIS, so no term is decorative:
		  - `phoneChrome`, the section's own three-part test, read once in the
		    constructor. Substituting false leaves the stock path exactly.
		  - the explicit presentation term: phoneChrome is now every phone
		    doctype (the constructor has the story) and this is slide tap
		    GRAMMAR, not handle geometry. Calc, Writer and Draw keep HEAD's
		    deferral, against their own entry rounds in MouseControl.
		  - `hasVideo`, which owns the tail of this method: a tap there has a
		    different job (reveal the player), so it keeps the stock path.
		  - `textCursor.visible`. `interactable` is already false while a caret
		    lives, but it flips on a server round trip (`cursorvisible:`), so
		    there is a window where the caret is live and the flag has not
		    caught up; a caret tap is a caret move, not a tap-again.
		  - a HIGHER object covering the point, which is not a tap-again at all
		    — it is a tap on something else, and only core's own hit test can
		    select it. Same rectangles and same OrdNum comparison MouseControl
		    reads for the mirror-image decision (VulcanImpressOverlap). Its
		    uncertain answers are all "no higher object", which lands on the
		    ruled no-op rather than on a guess about what is under the finger.
	*/
	private vulcanPhoneTapAgainIsInert(point: cool.SimplePoint): boolean {
		if (!this.sectionProperties.phoneChrome) return false;
		if (app.map._docLayer._docType !== 'presentation') return false;
		if (this.sectionProperties.hasVideo) return false;
		if (app.file.textCursor.visible) return false;

		return !VulcanImpressOverlap.coveredByHigherObject(
			this.position[0] + point.pX,
			this.position[1] + point.pY,
			GraphicSelection.extraInfo
				? GraphicSelection.extraInfo.ObjectRectangles
				: null,
			GraphicSelection.extraInfo ? GraphicSelection.extraInfo.OrdNum : null,
		);
	}

	onClick(point: cool.SimplePoint, e: MouseEvent): void {
		// A click whose PRESS the select echo owned: the press selected the
		// object by ordinal, and the answer landed within the press-release
		// window (a human click is 100-200 ms, the answer ~70-150 ms), so the
		// browser's click now finds THIS section under the pointer instead
		// of the document surface that took the press. The echo already
		// decided what that click means (swallowed off ink; forwarded on
		// text glyphs for the caret) — a second, delayed raw click here
		// made core UNMARK a text box pressed on its empty interior, or
		// click through to the object behind. One physical gesture, one
		// action.
		if (VulcanImpressSelectEcho.consumesClick()) return;

		// Read while `point` is still section-local; the method offsets it
		// itself, and the pair below mutates it in place.
		const tapAgainInert = this.vulcanPhoneTapAgainIsInert(point);

		point.pX += this.position[0];
		point.pY += this.position[1];
		// Ctrl/Cmd+click on the SELECTED area un-toggles that member from a
		// multi-selection (see MouseControl.impressToggleModifier).
		var modifier = MouseControl.impressToggleModifier(
			MouseControl.readModifier(e),
		);

		// On a canvas doc (deck or PDF page canvas) the select echo owns
		// toggle-clicks and has already marked the toggled set by ordinal on
		// the press; replaying the toggle here would double-toggle it straight
		// back (the member never leaves the selection). The plain replay below
		// still runs for a non-toggle click that collapses a multi-selection.
		const echoOwnsToggle =
			VulcanLiveCanvas.isCanvasDoc() && modifier === app.UNOModifier.SHIFT;

		// Capture position for the timer callback.
		const clickX = point.x;
		const clickY = point.y;

		// Cancel any pending click timer from a previous click.
		if (this.sectionProperties.clickTimer) {
			app.timerRegistry.clearTimeout(this.sectionProperties.clickTimer);
			this.sectionProperties.clickTimer = null;
		}

		// Delay the click so that a double-click can cancel it. The deferred
		// count 1 is the whole of what one tap does here, so withholding it is
		// what makes the slide canvas's tap-again inert. On a canvas doc the
		// select echo already took a toggle-click (echoOwnsToggle, above).
		// A mouse click on the words of the selected text or card (page
		// canvas) puts the caret there; core's single click would only keep
		// it selected, for the next Backspace to delete. Phone chrome keeps
		// its own tap grammar.
		const mayEnterCardText =
			modifier === 0 &&
			(e as any).pointerType !== 'touch' &&
			!this.sectionProperties.phoneChrome;
		if (!tapAgainInert && !echoOwnsToggle) {
			this.sectionProperties.clickTimer = app.timerRegistry.setTimeout(
				'shapeClickTimer',
				() => {
					if (
						mayEnterCardText &&
						VulcanImpressSelectEcho.enterSelectedText(clickX, clickY)
					) {
						this.sectionProperties.clickTimer = null;
						return;
					}
					app.map._docLayer._postMouseEvent(
						'buttondown',
						clickX,
						clickY,
						1,
						1,
						modifier,
					);
					app.map._docLayer._postMouseEvent(
						'buttonup',
						clickX,
						clickY,
						1,
						1,
						modifier,
					);
					this.sectionProperties.clickTimer = null;
				},
				250,
			);
		}

		// The touch double tap, built here so the count 2 (and the keyboard
		// door) go inside tap 2's own click. Android's Chromium also fires a
		// native dblclick 2-4 ms later; onDoubleClick spends it as this
		// build's echo, which is why the build is stamped.
		if ((e as any).pointerType === 'touch') {
			if (this.sectionProperties.lastTapTime && (Date.now() - this.sectionProperties.lastTapTime) < ShapeHandlesSection.doubleTapWindowMs) {
				point.pX -= this.position[0]; // Take the addition back. It will be added in onDoubleClick.
				point.pY -= this.position[1];
				this.sectionProperties.vulcanBuiltDoubleTapAt = Date.now();
				this.onDoubleClick(point, e);
			}

			this.sectionProperties.lastTapTime = Date.now();
		}

		if (this.sectionProperties.hasVideo && this.sectionProperties.svg) {
			const videoObject = this.sectionProperties.svg.querySelector('video');

			if (videoObject) {
				this.sectionProperties.svg.style.opacity = 1;
				this.sectionProperties.svg.style.pointerEvents = '';
				this.hideSubSections();
			}
		}
	}

	onDoubleClick(point: cool.SimplePoint, e: MouseEvent): void {
		// Cancel the pending click - a double-click replaces it.
		if (this.sectionProperties.clickTimer) {
			app.timerRegistry.clearTimeout(this.sectionProperties.clickTimer);
			this.sectionProperties.clickTimer = null;
		}

		// THE DOUBLE DBLCLICK (lane B, runs/run3/dblclick-design.md). On
		// Android one double tap on a selected object reached this method
		// TWICE: from onClick's builder inside tap 2's click, and from
		// Chromium's own dblclick 2-4 ms later (device: cp-uib1, cp-d1,
		// uib004/t-uib1: two count-2 pairs, two door raises). Core takes
		// both pairs as async user events. It worked only while pair 2 beat
		// pair 1's SID_TEXTEDIT; when it lands after text edit has begun, a
		// count 2 in text is SelectWord (editeng impedit2.cxx:325-330), so my
		// first key replaces the word under my finger, and in an empty table
		// cell it selects the cell and hides the caret
		// (tablecontroller.cxx:324-339).
		// So a native dblclick within the builder's window of a built double
		// tap is that tap's echo, and it ends here. Not keyed on lastTapTime:
		// every touch tap sets it, so a slow pair (tap 2 more than the window
		// after tap 1, inside Android's 300 ms double-tap timeout), which the
		// builder did not handle, would lose its only route in. A dblclick
		// the builder did not handle needs a click at least the window after
		// the tap before it, so it always falls outside the bound and takes
		// the path below; so does a stale stamp (a built double tap with no
		// echo). A mouse never stamps: desktop is unchanged.
		// MouseControl's stamp counts the same (code review): when core's
		// answer to tap 1 lands between tap 2's click, which MouseControl took,
		// and the dblclick, this section comes up in the answer's task and the
		// dblclick reaches it although MouseControl sends that pair itself.
		const builtAt = Math.max(
			this.sectionProperties.vulcanBuiltDoubleTapAt || 0,
			app.activeDocument?.mouseControl?.vulcanTouchPairAt || 0,
		);
		if (
			e &&
			e.type === 'dblclick' &&
			builtAt > 0 &&
			Date.now() - builtAt < ShapeHandlesSection.doubleTapWindowMs
		)
			return;

		// UI-B-004 (Design review: follow Google Slides' path for text entry; pending
		// the Google reference clips): on a phone, a double tap on a selected
		// PICTURE edits no text and raises no keyboard; it stays selected with
		// its bar. Core would put a caret inside the picture (sd
		// FuDraw::DoubleClick, fudraw.cxx:670-679), so no count 2 goes and no
		// door opens. Pictures only: an embedded object (a chart, a Math
		// formula, an embedded sheet) gets its count 2 below and is activated
		// in place, with the door shut (noCaretToType). The
		// browser's own dblclick that follows the built one 2-4 ms later
		// never gets this far (the echo guard above); one the builder did not
		// handle returns here. Both reads take `point` while it is still
		// section-local (the tap-again test offsets it itself). `onSelected`
		// is the slide tap grammar's own "on the selected object" (phone
		// deck, no caret, no video, nothing painted above the finger), so a
		// tap on a caption over the photo still goes to core.
		const info: any = GraphicSelection.extraInfo;
		const onSelected = this.vulcanPhoneTapAgainIsInert(point);
		const coveredAbove = VulcanImpressOverlap.coveredByHigherObject(
			this.position[0] + point.pX,
			this.position[1] + point.pY,
			info ? info.ObjectRectangles : null,
			info ? info.OrdNum : null,
		);
		if (onSelected && VulcanImpressOverlap.isTextlessKind(info)) return;

		if (app.map._docLayer.isCalcRTL()) {
			point.pX = (-point.pX + this.position[0]);
		} else {
			point.pX += this.position[0];
		}
		point.pY += this.position[1];
		app.map._docLayer._postMouseEvent('buttondown', point.x, point.y, 2, 1, 0);
		app.map._docLayer._postMouseEvent('buttonup', point.x, point.y, 2, 1, 0);
		// B-0287: the selected-shape double tap (I5) is the same keyboard door,
		// raised inside this dblclick; not for a video. Inert off the Android host.
		// The door stays shut where no caret I can type in will come (lane B,
		// pending UI-B-004), or the keyboard comes up inside the gesture, the
		// door's no-caret verdict takes it back when the door's one clock
		// (TextInput VULCAN_EDIT_INTENT_MS) runs out, and the slide relays out
		// twice. It stays OPEN for a shape, text box or table, EMPTY or not.
		// By core's extraInfo.type, the SdrObjKind (svdobjkind.hxx):
		// - a PICTURE (22): core opens a caret in it (fudraw.cxx:670-679), and
		//   the caret rule gives that caret no keyboard, so the door asks the
		//   rule itself (CanvasTileLayer._vulcanCaretInTextlessObject: type 22
		//   holding no text, not the B-0288 whole-slide selection);
		// - a chart or other OLE object (23): activated, no caret (sd
		//   FuDraw::DoubleClick, fudraw.cxx:653-661);
		// - audio (34; a video is hasVideo): SID_TEXTEDIT, but a media object
		//   has no text edit (svdomedia.cxx:96);
		// - a group (1) with no text in it: a count 2 on a selected group
		//   ENTERS it (FuSelection, fusel.cxx:355-373); EnterGroup unmarks
		//   everything (svdpagv.cxx:839-856), so FuDraw::DoubleClick finds no
		//   mark and opens no caret. Except a single-member group: EnterGroup
		//   marks that member, and SID_TEXTEDIT can open a caret in it. A group
		//   that holds text (innerTextRect) keeps the door, which is right for
		//   a single member with text; a group of several members is entered
		//   with nothing marked, so there the keyboard comes up and the no-caret
		//   verdict takes it back (unmeasured). A single EMPTY member gets a
		//   caret with the door shut, as at 4ceee1422a.
		// Keyed on kind, not innerTextRect: core sends none for an object with
		// no text yet (svdmrkv.cxx:878-901), and keying on it (4ceee1422a) shut
		// the door on an empty shape: a caret, no keyboard.
		// UI-B-004: none of that applies to a tap on an object painted ABOVE
		// the selected one (a caption or text box over a photo): core's hit
		// test gives the count 2 to that object and opens its text, so the
		// door opens and I can type in the caption. Batch 47 kept it shut
		// there (a caret and no keyboard). Not gated on `onSelected`: a live
		// caret makes that false, and the door must stay shut over a caret in
		// a picture (the CanvasTileLayer backstop's tail). The cover is only a
		// box: when the object above is itself a picture (a logo), core opens
		// its caret in the logo, and the caret backstop (CanvasTileLayer's
		// caret path, GraphicSelection.updateGraphicSelection) ends this door's
		// hold and takes the keyboard down.
		const docLayer: any = app.map._docLayer;
		const kind = info ? info.type : undefined;
		const noCaretToType =
			!coveredAbove &&
			((typeof docLayer._vulcanCaretInTextlessObject === 'function' &&
				docLayer._vulcanCaretInTextlessObject()) ||
			kind === 23 || kind === 34 || (kind === 1 && !info.innerTextRect));
		if (
			!this.sectionProperties.hasVideo &&
			!noCaretToType &&
			typeof VulcanImpressTextEntry !== 'undefined'
		)
			VulcanImpressTextEntry.openKeyboardDoor();
	}
}

app.definitions.shapeHandlesSection = ShapeHandlesSection;
