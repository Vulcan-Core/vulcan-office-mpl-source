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

type DocumentSpacingInfo = {
	documentMarginsWidth: number;
	commentSectionWidth: number;
};

class ViewLayoutWriter extends ViewLayoutBase {
	public readonly type: string = 'ViewLayoutWriter';
	// Core lays every page out inside a DOCUMENTBORDER band on each side
	// (engine sw/inc/swtypes.hxx; SwXTextDocument::getDocumentSize adds it
	// twice to the width), so the first page's left edge is at x = 284.
	private static readonly DOCUMENT_BORDER_TWIPS = 284;
	private documentScrollOffset: number = 0;
	private centreTaskPending: boolean = false;
	private contentExtentTimer: ReturnType<typeof setTimeout> | null = null;

	constructor() {
		super();
		app.map.on('zoomlevelschange', this.documentZoomCallback, this);
		// A column that changes width changes where centred is.
		app.map.on('resize', this.documentZoomCallback, this);
		app.map.on('deleteannotation', this.annotationOperationsCallback, this);
		app.map.on('insertannotation', this.annotationOperationsCallback, this);
		app.map.on('importannotations', this.annotationOperationsCallback, this);
		app.map.on(
			'showannotationschanged',
			this.annotationOperationsCallback,
			this,
		);
		app.map.on('rulerupdate', this.rulerUpdateCallback, this);
		app.map.on('commandvalues', this.contentExtentCallback, this);
	}

	public unselectCommentOnScroll() {
		const commentSection = app.sectionContainer.getSectionWithName(
			app.CSections.CommentList.name,
		) as cool.CommentSection;

		if (commentSection && commentSection.sectionProperties.selectedComment) {
			commentSection.unselect();
		}
	}

	private getCommentAndDocumentSpacingInfo(): DocumentSpacingInfo {
		const commentSection = app.sectionContainer.getSectionWithName(
			app.CSections.CommentList.name,
		) as cool.CommentSection;

		return {
			documentMarginsWidth: commentSection.calculateAvailableSpace(),
			commentSectionWidth: commentSection.sectionProperties.commentWidth,
		} as DocumentSpacingInfo;
	}

	private documentCanMoveLeft(ignoreDocumentScrollOffset: boolean) {
		const spacingInfo = this.getCommentAndDocumentSpacingInfo();
		const offset = ignoreDocumentScrollOffset ? 0 : this.documentScrollOffset;

		const commentsWiderThanRightMargin =
			spacingInfo.documentMarginsWidth + offset <
			spacingInfo.commentSectionWidth;

		const haveEnoughLeftMarginForMove =
			spacingInfo.commentSectionWidth -
				(spacingInfo.documentMarginsWidth + offset) <=
			spacingInfo.documentMarginsWidth - offset;

		return commentsWiderThanRightMargin && haveEnoughLeftMarginForMove;
	}

	/*
		`cool.CommentSection.shouldCollapse()` doesn't need `documentScrollOffset`
		details to know if it `shouldCollapse` the comments or not.
	*/
	public viewHasEnoughSpaceToShowFullWidthComments() {
		const spacingInfo = this.getCommentAndDocumentSpacingInfo();
		return (
			spacingInfo.documentMarginsWidth * 2 >= spacingInfo.commentSectionWidth
		);
	}

	private documentMoveLeftByOffset(): number {
		const spacingInfo = this.getCommentAndDocumentSpacingInfo();
		return (
			spacingInfo.commentSectionWidth -
			(spacingInfo.documentMarginsWidth + this.documentScrollOffset)
		);
	}

	public getDocumentScrollOffset() {
		if (this.commentsHiddenOrNotPresent()) return 0;
		if (!this.viewHasEnoughSpaceToShowFullWidthComments()) return 0;

		if (this.documentCanMoveLeft(true)) {
			this.documentScrollOffset = 0;
			this.documentScrollOffset = this.documentMoveLeftByOffset();
			return this.documentScrollOffset;
		}

		return 0;
	}

	private recenterDocument() {
		if (this.documentScrollOffset == 0) return;

		this.scrollHorizontal(-this.documentScrollOffset, true);
		this.documentScrollOffset = 0;
		app.sectionContainer.requestReDraw();
	}

	private commentsHiddenOrNotPresent() {
		const commentSection = app.sectionContainer.getSectionWithName(
			app.CSections.CommentList.name,
		) as cool.CommentSection;

		if (commentSection.commentsHiddenOrNotPresent()) {
			this.recenterDocument();
			return true;
		}
		return false;
	}

	private unselectSelectedCommentIfAny() {
		const commentSection = app.sectionContainer.getSectionWithName(
			app.CSections.CommentList.name,
		) as cool.CommentSection;

		if (
			commentSection.sectionProperties.selectedComment &&
			!commentSection.sectionProperties.selectedComment.isEdit()
		) {
			commentSection.unselect();
		}
	}

	private adjustDocumentMarginsForComments(onZoom: boolean) {
		this.unselectSelectedCommentIfAny();

		if (this.commentsHiddenOrNotPresent()) return;

		if (this.documentCanMoveLeft(onZoom)) {
			if (onZoom) this.documentScrollOffset = 0;
			this.documentScrollOffset = this.documentMoveLeftByOffset();
			/*
			 * we scrollHorizontal by 1 to trigger the layouting tasks in
			 * the `ScrollSection.doMove` function, which calls `map.panBy`
			 * to adjust the document center, and there we add the offset
			 * to the x component to move the document to the left.
			 * we only do it for the zoom events because for resize,
			 * the layouting tasks are scheduled automatically by other
			 * code, like that in CommentListSection.ts (updateDOM)
			 */
			this.scrollHorizontal(1, true);
		}
	}

	/*
	 * VULCAN (desktop chrome): the page RESTS CENTRED whenever it cannot
	 * scroll -- wider than the column or narrower than it.
	 *
	 * The opening fit deliberately overhangs the margins, so the page is wider
	 * than the column while the text still fits. Nothing positioned it, so it
	 * sat flush LEFT and the whole overhang piled up on the right -- MEASURED
	 * on build 99ca6ea9: page 1476 in a 1216 viewport, leftOverhang 0,
	 * rightOverhang 260, where centred is 130 each side. The paper's left edge
	 * showed and its right edge did not, which reads as a document shoved
	 * against one side rather than one that overflows evenly.
	 *
	 * The narrow case is the same rule from the other side: zoomed out until
	 * the page no longer fills the column, it rests with equal mat each side.
	 *
	 * Only when it CANNOT scroll: once the text overflows, the horizontal
	 * position belongs to the reader and must not be dragged back. A table or
	 * picture wider than the pane hands it over only once the reader has
	 * panned or zoomed. Core's `.uno:ContentExtent` reply can land before the
	 * opening fit's centring, and standing down for it then left the page at
	 * the stock position with the end of every body line past the pane
	 * (MEASURED on build 468b2a5f: 16 of 18 opens at DPR 2).
	 *
	 * Runs on every resize, because the column is what changes: the
	 * Navigation panel opening takes 260px off it, and a page centred for
	 * the wide column is 130px off centre in the narrow one. MEASURED before
	 * this ran on resize: open the panel, page stays where it was.
	 *
	 * COMMENTS. Map.panBy adds the comment shift -- getDocumentScrollOffset,
	 * the push LEFT that makes room for the comment rail over the right
	 * margin -- to every horizontal pan. So the page comes to rest that much
	 * left of centre, which is what the comment layout intends. An earlier
	 * version stood down entirely while comments were present, to avoid
	 * "fighting" that shift; the effect was that a commented document never
	 * recentred at all. The delta is measured to the centred position, and
	 * the shift only decides whether there is anything left to do: at rest
	 * (pX1 == target + shift) the net pan is zero and nothing is queued.
	 *
	 * `scrollHorizontal(delta, true)` moves by document pixels with the
	 * scrollbar clamp bypassed -- the same call recenterDocument uses.
	 */
	public vulcanCentreDocument(): void {
		if (!document.documentElement.classList.contains('vulcan-desktop-chrome'))
			return;

		const anchor = app.sectionContainer.getDocumentAnchorSection();
		if (!anchor) return;
		const viewportWidth = this.getHorizontalViewportWidth(anchor);
		if (!(viewportWidth > 0)) return;
		if (this.canScrollHorizontal(anchor) && (super.canScrollHorizontal(anchor) ||
			(app.map._docLayer as any)._vulcanWriterUserViewport))
			return;

		const activeDocument = app.activeDocument;
		if (!activeDocument || !(activeDocument.fileSize.pX > 0)) return;

		// Half the difference, EITHER sign. A page wider than the column rests
		// with equal overhang each side (positive); a page narrower than it
		// rests with equal mat each side (negative -- the view starts left of
		// the document, which is how the map itself parks a narrow page).
		// This used to clamp at 0, and the clamp was a bug the reader found:
		// zoom out until the page is narrower than the column and it slid to
		// the left edge, every time, because 0 is not the centre of a page
		// that does not fill the view.
		let target = Math.round(
			(activeDocument.fileSize.pX - viewportWidth) / 2,
		);
		const shift = this.getDocumentScrollOffset();
		// Centring the paper must not hide text on an asymmetric page, or a
		// table past the margin. Keep both content edges in the viewport
		// whenever the content fits, and both text edges when only they do.
		let band = ViewLayoutWriter.vulcanContentBandPx(this.viewedRectangle);
		if (band && band.right - band.left > viewportWidth)
			band = ViewLayoutWriter.vulcanTextColumnPx();
		if (band && band.right <= activeDocument.fileSize.pX &&
			band.right - band.left <= viewportWidth)
			target = Math.max(band.right - viewportWidth,
				Math.min(target + shift, band.left)) - shift;
		// Layout tasks drain before ScrollSection paints. The viewed rectangle
		// therefore does not yet include a queued move; adding the full delta
		// again over-pans on a burst of load-time resize/zoom notifications.
		const pending = this.scrollProperties.moveBy?.[0] || 0;
		const delta = target - this.viewedRectangle.pX1 - pending;
		if (Math.abs(delta + shift) < 1) return;

		this.scrollHorizontal(delta, true);
		app.sectionContainer.requestReDraw();
	}

	/*
	 * The ruler's text column -- the caret's: the body text, or the table
	 * the caret is in -- in document pixels, or null before core has sent
	 * its geometry.
	 *
	 * Measured from the PAGE, not the document. The ruler's left
	 * margin starts at the page's left edge, and the page starts one
	 * DOCUMENTBORDER into the document: fileSize.x is 12808 for a 12240
	 * Letter page. Without it both edges sat one border (23px at 120%) left
	 * of the real text, and the right-edge arm parked the last characters of
	 * every line just past the pane.
	 */
	private static vulcanTextColumnPx(): { left: number; right: number } | null {
		const layer: any = app.map && app.map._docLayer;
		const fileSize = app.activeDocument && app.activeDocument.fileSize;
		if (!layer || !(layer._vulcanTextWidthMm100 > 0) || !fileSize || !(fileSize.x > 0))
			return null;
		const pxPerMm100 = fileSize.pX * 1440 / (fileSize.x * 2540);
		const pageLeft = ViewLayoutWriter.DOCUMENT_BORDER_TWIPS * fileSize.pX / fileSize.x;
		const left = pageLeft + (layer._vulcanLeftMarginMm100 || 0) * pxPerMm100;
		return { left: left, right: left + layer._vulcanTextWidthMm100 * pxPerMm100 };
	}

	/*
	 * The ruler's column widened to what core reports on the pages in view
	 * (`.uno:ContentExtent`): a table or picture past the margins, or the
	 * text of a wider page. The ruler alone is the caret's column, so a table
	 * the caret had not entered, or a landscape page after a portrait one,
	 * opened cut with nothing to scroll.
	 */
	private static vulcanContentBandPx(view: cool.SimpleRectangle): { left: number; right: number } | null {
		const band = ViewLayoutWriter.vulcanTextColumnPx();
		if (!band) return null;
		const layer: any = app.map._docLayer;
		const fileSize = app.activeDocument?.fileSize;
		if (!fileSize) return band;
		const pxPerTwip = fileSize.pX / fileSize.x;
		const top = view.pY1 / pxPerTwip;
		const bottom = view.pY2 / pxPerTwip;
		for (const [pageTop, pageBottom, left, right] of layer._vulcanContentPages || []) {
			if (pageBottom < top || pageTop > bottom) continue;
			band.left = Math.min(band.left, left * pxPerTwip);
			band.right = Math.max(band.right, right * pxPerTwip);
		}
		// Core does not clip a table or picture to its page, and the travel
		// stops at the document's edges: only the part inside them can be reached.
		band.left = Math.max(band.left, 0);
		band.right = Math.min(band.right, fileSize.pX);
		return band.left <= band.right ? band : null;
	}

	public override canScrollHorizontal(documentAnchor: CanvasSectionObject): boolean {
		const band = ViewLayoutWriter.vulcanContentBandPx(this.viewedRectangle);
		if (band && band.right - band.left > this.getHorizontalViewportWidth(documentAnchor))
			return true;
		return super.canScrollHorizontal(documentAnchor);
	}

	public requestContentExtent(): void {
		if (this.contentExtentTimer !== null || app.activeDocument?.activeLayout !== this ||
			!app.map._docLoaded ||
			!document.documentElement.classList.contains('vulcan-desktop-chrome'))
			return;
		this.contentExtentTimer = setTimeout(() => {
			this.contentExtentTimer = null;
			app.socket.sendMessage('commandvalues command=.uno:ContentExtent');
		}, 250);
	}

	private contentExtentCallback(e: any) {
		if (e.commandName !== '.uno:ContentExtent') return;
		const layer: any = app.map._docLayer;
		layer._vulcanContentPages = e.commandValues.pages;
		this.keepContentInView();
	}

	public override sendClientVisibleArea(forceUpdate: boolean = false): void {
		super.sendClientVisibleArea(forceUpdate);
		// Scrolling to another page changes which content counts.
		if (!app.sectionContainer.isInZoomAnimation()) this.keepContentInView();
	}

	private documentZoomCallback() {
		this.adjustDocumentMarginsForComments(true);
		this.queueCentreTask();
	}

	private queueCentreTask() {
		if (this.centreTaskPending) return;
		this.centreTaskPending = true;
		app.layoutingService.appendLayoutingTask(() => {
			this.centreTaskPending = false;
			this.vulcanCentreDocument();
		});
	}

	private rulerUpdateCallback() {
		this.requestContentExtent();
		this.keepContentInView();
	}

	/*
	 * the content moved to a band that fits the pane but is not in
	 * view -- the caret entered a table running into the right margin, or
	 * core reported one. Centring keeps the band in view, but it ran only on
	 * zoom and resize, and a band that fits offers nothing to scroll, so a
	 * Tab into the cut cell typed past the pane's edge.
	 *
	 * Only when an edge is out of view: a band already in view keeps the
	 * view where it is, or the caret's return to the body text would slide
	 * the table back out. A band wider than the pane scrolls, and its
	 * position is the reader's.
	 */
	private keepContentInView() {
		// A layout replaced by a view switch keeps its listeners.
		if (app.activeDocument?.activeLayout !== this ||
			!document.documentElement.classList.contains('vulcan-desktop-chrome'))
			return;
		const anchor = app.sectionContainer.getDocumentAnchorSection();
		const band = ViewLayoutWriter.vulcanContentBandPx(this.viewedRectangle);
		if (!anchor || !band || this.canScrollHorizontal(anchor)) return;
		const viewLeft = this.viewedRectangle.pX1;
		const viewRight = viewLeft + this.getHorizontalViewportWidth(anchor);
		if (band.left >= viewLeft && band.right <= viewRight) return;
		this.queueCentreTask();
	}

	/*
	 * `userIsScrolling` is not reader intent, so the width fit must not read it
	 * as a deliberate pan.
	 *
	 * ScrollSection.scrollVerticalWithOffset and scrollHorizontalWithOffset
	 * hardcode `const userIsScrolling = true` for EVERY caller, and their
	 * callers include paths no reader touched:
	 * CanvasTileLayer._onUpdateCursor's `keepCaretPositionRelativeToScreen`
	 * branch -- whose own comment says "another view updated the text", i.e. a
	 * CO-EDITOR's edit -- plus the caret reveals in
	 * CanvasTileLayer._vulcanRevealCaretVertically and
	 * VulcanCaretRevealController.reveal, and the reveal drain in
	 * ScrollSection.onAnimate and onAnimationEnded. Any one of those armed the
	 * latch below, and the desktop dead-band in CanvasTileLayer._fitWidthZoom
	 * then returns early for the rest of the document's life -- stranding it
	 * at whatever zoom the pane happened to carry while the split workspace
	 * was still settling, which is the exact clipping this fit exists to
	 * prevent.
	 *
	 * The axis is the honest discriminator, not the flag. This is a WIDTH fit:
	 * where the reader sits vertically cannot make it wrong, so no vertical
	 * move -- automatic or deliberate -- has any bearing on it. A HORIZONTAL
	 * pan is the one that means "I chose this horizontal view", and the one a
	 * refit would stomp. Zoom ownership is untouched and still exact: it is
	 * taken in Map.setZoom and CanvasTileLayer.zoomStepEnd.
	 */
	public scroll(pX: number, pY: number, userIsScrolling: boolean = false): void {
		if (userIsScrolling && pX !== 0 &&
			document.documentElement.classList.contains('vulcan-desktop-chrome')) {
			const layer: any = app.map && app.map._docLayer;
			if (layer) layer._vulcanWriterUserViewport = true;
		}
		super.scroll(pX, pY, userIsScrolling);
	}

	/*
	 * A leg of MouseControl's touch drag went past the tap slop further
	 * sideways than up or down, or its legs went diagonally sideways: the
	 * same choice as a wheel pan. It pans with scrollTo, which carries no
	 * userIsScrolling, and passing one would unselect the comment on every
	 * touch pan, phones included. Without the latch, the next resize,
	 * height-only included, centred a page whose table runs past the pane
	 * and undid the pan. Only while the view can pan sideways: on
	 * a page that cannot, the latch would end the width fit for nothing.
	 */
	public vulcanHorizontalTouchPan(): void {
		if (!document.documentElement.classList.contains('vulcan-desktop-chrome'))
			return;
		const anchor = app.sectionContainer.getDocumentAnchorSection();
		const layer: any = app.map && app.map._docLayer;
		if (anchor && layer && this.canScrollHorizontal(anchor))
			layer._vulcanWriterUserViewport = true;
	}

	/*
	 * on a phone, in READ posture, the end of the document must
	 * scroll clear of the host's sliding header.
	 *
	 * The host's immersive-read takeover makes this frame as tall as the
	 * screen and slides it DOWN by the header's height while the header shows.
	 * Shown is the resting state, because a stop re-shows the header
	 * (VulcanReadImmersion.STOP_REVEAL_MS). So at rest the last H px of this
	 * frame are below the screen. A scroll that ends at the canvas bottom left
	 * the end of every document there: about 2 lines in Safari and 4 in the
	 * notched app shell. No swipe could reach it, because at the limit nothing
	 * moves and so nothing hides the header.
	 *
	 * The host states that strip as a STABLE number: `scrollApron` on
	 * Vulcan_HostSafeArea, which Map.WOPI.js writes as --vulcan-scroll-apron.
	 * It is the `bottom` of the SHOWN state: the header strip plus the home
	 * indicator. `bottom` itself cannot serve, because it drops to the
	 * indicator alone whenever the header hides, and an extent that grew and
	 * shrank with every hide would make the view jump at the end. Scrolling
	 * this much further puts the end of the document just above the home
	 * indicator with the header shown, where the bottom-docked chrome sits.
	 * With the header hidden, the strip shows as blank space under the last
	 * line, as in Google Docs.
	 *
	 * 0 without the field (an old host) and 0 outside phone Writer read, so
	 * edit, tablet, desktop, Calc and Impress keep their extent exactly. The
	 * `mode` guard is for rigs that build a layout before window.mode exists.
	 */
	public override vulcanBottomApronCore(): number {
		if (!(<any>window).mode || !VulcanReadImmersion.isPhoneWriterRead())
			return 0;
		const css = parseFloat(
			document.documentElement.style.getPropertyValue('--vulcan-scroll-apron'),
		);
		if (!isFinite(css) || css <= 0) return 0;
		return Math.round(css * app.dpiScale);
	}

	private annotationOperationsCallback() {
		this.adjustDocumentMarginsForComments(false);
	}
}
