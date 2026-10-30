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

declare var Autolinker: any;
declare var DOMPurify : any;

// By default DOMPurify will strip all targets, so set everything
// as target=_blank with rel=noopener
DOMPurify.addHook('afterSanitizeAttributes', function (node: HTMLElement) {
	if (node.tagName === 'A' && !node.classList.contains('context-menu-link')) {
		node.setAttribute('target', '_blank');
		node.setAttribute('rel', 'noopener');
	}
});

namespace cool {

/*
	data.layoutStatus: Enumartion sent from the core side.
	0: INVISIBLE, 1: VISIBLE, 2: INSERTED, 3: DELETED, 4: NONE, 5: HIDDEN
	Ex: "DELETED" means that the comment is deleted while the "track changes" is on.
*/
export enum CommentLayoutStatus {
	INVISIBLE,
	VISIBLE,
	INSERTED,
	DELETED,
	NONE,
	HIDDEN
}

export class Comment extends CanvasSectionObject {
	// Cache the expensive to localize frequently created strings
	static readonly editCommentLabel = _('Edit comment');
	static readonly replyCommentLabel = _('Reply comment');
	static readonly openMenuLabel = _('Open menu');

	processingOrder: number = app.CSections.Comment.processingOrder;
	drawingOrder: number = app.CSections.Comment.drawingOrder;
	zIndex: number = app.CSections.Comment.zIndex;

	valid: boolean = true;
	map: any;
	pendingInit: boolean = true;

	cachedCommentHeight: number | null = null;
	cachedIsEdit: boolean = false;
	hidden: boolean | null = null;

	containerPosX: number = 0;
	containerPosY: number = 0;
	// Final top after clamping (canvas-relative CSS px), so children can follow a clamped parent.
	renderedPosY: number = 0;
	canvasContainerBounds: DOMRect = new DOMRect();

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	public static makeName(data: any): string {
		return data.id === 'new' ? 'new comment' : 'comment ' + data.id;
	}

	/*
		The gate for every Vulcan phone-only piece of comment GEOMETRY in this
		file (indicator size, touch box). Two halves, the same pair the 44 px
		Impress marker box already uses at createMarkerSubSection: a small
		screen AND the pre-paint html.vulcan-mobile-chrome marker js/global.js
		stamps iff !desktopChrome && mode.isSmallScreenDevice().

		Both halves matter. ?vulcanChrome=desktop forces desktop chrome onto a
		small screen, and when it does, desktop geometry has to come back with
		it -- a 44 px box drawn against a desktop hover affordance is worse
		than either alone.

		Note the deliberate asymmetry with openCommentOnPhone(), which gates on
		isSmallScreenDevice() ALONE: that one picks a ROUTE, and the route it
		picks (the mobile wizard) is the upstream phone surface, which exists
		whether or not our chrome is painted. Geometry is ours; the route is
		not.
	*/
	public static usesPhoneCommentChrome (): boolean {
		return (<any>window).mode.isSmallScreenDevice()
			&& document.documentElement.classList.contains('vulcan-mobile-chrome');
	}

	// The 44 CSS px touch floor, in the core pixels sections are measured in.
	public static phoneTouchSize (): number {
		return Math.round(44 * app.dpiScale);
	}

	// The on-canvas comment indicator's painted size, in core pixels. 14 CSS
	// px: big enough to read as a deliberate mark at arm's length, small
	// enough not to cover the cell text or the commented word it sits on. The
	// TARGET around it is phoneTouchSize(), not this.
	public static phoneIndicatorSize (): number {
		return Math.round(14 * app.dpiScale);
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	constructor (name: string, data: any, options: any, commentListSectionPointer: cool.CommentSection) {
		super(name);

		this.myTopLeft = [0, 0];
		this.documentObject = true;
		this.map = window.L.Map.THIS;

		if (!options)
			options = {};

		this.sectionProperties.commentListSection = commentListSectionPointer;
		this.sectionProperties.docLayer = this.map._docLayer;

		this.sectionProperties.selectedAreaPoint = null;
		this.sectionProperties.cellCursorPoint = null;

		this.sectionProperties.draggingStarted = false;
		this.sectionProperties.dragStartPosition = null;

		this.sectionProperties.minWidth = options.minWidth ? options.minWidth : 160;
		this.sectionProperties.maxHeight = options.maxHeight ? options.maxHeight : 50;
		this.sectionProperties.imgSize = options.imgSize ? options.imgSize : [32, 32];
		this.sectionProperties.margin = options.margin ? options.margin : [40, 40];
		this.sectionProperties.noMenu = options.noMenu ? options.noMenu : false;

		if (data.parent === undefined)
			data.parent = '0';

		this.setData(data);

		/*
			possibleParentCommentId:
				* User deletes a parent comment.
				* User deletes also its child comment.
				* User reverts the last change (deletion of child comment).
				* A comment "Add" action is sent from the core side.
				* The child comment has also its parent id.
				* But there is no such parent at the moment.
				* So we will remember its possible parent comment in case user also reverts the deletion of parent comment.
				* In that case, parent comment will come with its old id.
				* Child comment can now find its parent.
				* We will check child comment to see if its parent has also been revived.
		*/
		this.sectionProperties.possibleParentCommentId = null;
		this.sectionProperties.wrapper = null;
		this.sectionProperties.container = null;
		this.sectionProperties.author = null;
		this.sectionProperties.resolvedTextElement = null;
		this.sectionProperties.removedTextElement = null;
		this.sectionProperties.authorAvatarImg = null;
		this.sectionProperties.authorAvatartdImg = null;
		this.sectionProperties.contentAuthor = null;
		this.sectionProperties.contentDate = null;
		this.sectionProperties.acceptButton = null;
		this.sectionProperties.rejectButton = null;
		// The <td> wrappers are kept so the pair can be removed again when the
		// redline permission goes away (destroyTrackChangeButtons).
		this.sectionProperties.acceptButtonCell = null;
		this.sectionProperties.rejectButtonCell = null;
		this.sectionProperties.menu = null;
		this.sectionProperties.menuBarCell = null;
		this.sectionProperties.captionNode = null;
		this.sectionProperties.captionText = null;

		this.sectionProperties.contentNode = null;
		this.sectionProperties.nodeModify = null;
		this.sectionProperties.nodeModifyText = null;
		this.sectionProperties.saveButton = null;
		this.sectionProperties.cancelButton = null;
		this.sectionProperties.replyButton = null;
		this.sectionProperties.cancelReplyButton = null;
		this.sectionProperties.contentText = null;
		this.sectionProperties.lastContentRaw = '';
		this.sectionProperties.nodeReply = null;
		this.sectionProperties.nodeReplyText = null;
		this.sectionProperties.contextMenu = false;

		this.sectionProperties.highlightedTextColor = '#777777'; // Writer.
		this.sectionProperties.usedTextColor = this.sectionProperties.data.color; // Writer.
		this.sectionProperties.showSelectedCoordinate = true; // Writer.

		if (app.map._docLayer._docType === 'presentation' || app.map._docLayer._docType === 'drawing') {
			this.sectionProperties.parthash = parseInt(this.sectionProperties.data.parthash);
			this.sectionProperties.partIndex = app.impress.getIndexFromSlideHash(this.sectionProperties.parthash);
		}

		this.sectionProperties.isHighlighted = false;

		this.sectionProperties.commentContainerRemoved = false;
		this.sectionProperties.children = []; // This is used for Writer comments. There is parent / child relationship between comments in Writer files.
		this.sectionProperties.childLinesNode = null;
		this.sectionProperties.childLines = [];
		this.sectionProperties.childCommentOffset = 8;
		this.sectionProperties.commentMarkerSubSection = null; // For Impress and Draw documents.
		this.sectionProperties.commentAnchorAreaSubSection = null; // For comments with an explicit anchor area (PDF /Rect, drag-to-area).
		this.sectionProperties.calcCommentAreaWidth = 40; // Calc comment area doesn't cover the whole cell, in order to allow multi-cell selections.

		app.map.on('sheetgeometrychanged', this.setPositionAndSize.bind(this));
	}

	// Comments import can be costly if the document has a lot of them. If they are all imported/initialized
	// when online gets comments message from core, the initial doc render is delayed. To avoid that we do
	// lazy import of each comment when it needs to be shown (based on its coordinates).
	private doPendingInitializationInView (force: boolean = false): void {
		if (!this.pendingInit)
			return;

		if (!force) {
			if (!this.convertRectanglesToViewCoordinates())
				return;

			// skip comments on other tabs than the current
			if (app.map._docLayer._docType === 'spreadsheet' && parseInt(this.sectionProperties.data.tab) !== app.map._docLayer._selectedPart)
				return;
		}

		var button = window.L.DomUtil.create('div', 'annotation-btns-container', this.sectionProperties.nodeModify);
		window.L.DomEvent.on(this.sectionProperties.nodeModifyText, 'focus', this.onFocus, this);
		window.L.DomEvent.on(this.sectionProperties.nodeReplyText, 'focus', this.onFocusReply, this);
		window.L.DomEvent.on(this.sectionProperties.nodeModifyText, 'input', this.textAreaInput, this);
		window.L.DomEvent.on(this.sectionProperties.nodeReplyText, 'input', this.textAreaInput, this);
		window.L.DomEvent.on(this.sectionProperties.nodeModifyText, 'keydown', this.textAreaKeyDown, this);
		window.L.DomEvent.on(this.sectionProperties.nodeReplyText, 'keydown', this.textAreaKeyDown, this);
		this.sectionProperties.cancelButton = this.createButton(button, 'annotation-cancel-' + this.sectionProperties.data.id, 'annotation-button button', _('Cancel'), this.handleCancelCommentButton);
		this.sectionProperties.saveButton = this.createButton(button, 'annotation-save-' + this.sectionProperties.data.id, 'annotation-button button button-primary',_('Save'), this.handleSaveCommentButton);
		button = window.L.DomUtil.create('div', '', this.sectionProperties.nodeReply);
		this.sectionProperties.cancelReplyButton = this.createButton(button, 'annotation-cancel-reply-' + this.sectionProperties.data.id, 'annotation-button button', _('Cancel'), this.handleCancelCommentButton);
		this.sectionProperties.replyButton = this.createButton(button, 'annotation-reply-' + this.sectionProperties.data.id, 'annotation-button button button-primary', _('Reply'), this.handleReplyCommentButton);
		window.L.DomEvent.disableScrollPropagation(this.sectionProperties.container);

		// Since this is a late called function, if the width is enough, we shouldn't collapse the comments.
		if (app.map._docLayer._docType !== 'text' || this.sectionProperties.commentListSection.isCollapsed === true)
			this.sectionProperties.container.style.visibility = 'hidden';

		this.sectionProperties.nodeModify.style.display = 'none';
		this.sectionProperties.nodeReply.style.display = 'none';

		var events = ['click', 'dblclick', 'mousedown', 'mouseup', 'mouseover', 'mouseout', 'keydown', 'keypress', 'keyup', 'touchstart', 'touchmove', 'touchend'];
		window.L.DomEvent.on(this.sectionProperties.container, 'click', this.onMouseClick, this);
		window.L.DomEvent.on(this.sectionProperties.container, 'keydown', this.onCommentKeyDown, this);

		for (var it = 0; it < events.length; it++) {
			window.L.DomEvent.on(this.sectionProperties.container, events[it], window.L.DomEvent.stopPropagation, this);
		}

		window.L.DomEvent.on(this.sectionProperties.container, 'touchstart',
			function (e: TouchEvent) {
				if (e && e.touches.length > 1) {
					window.L.DomEvent.preventDefault(e);
				}
			},
			this);

		this.update();

		this.pendingInit = false;
	}

	public onInitialize (): void {
		this.createContainerAndWrapper();

		this.createAuthorTable();

		if (this.sectionProperties.data.trackchange && !this.map.isReadOnlyMode() && !app.map['wopi'].HideChangeTrackingControls) {
			this.createTrackChangeButtons();
		}

		// Always create the menu if allowed; its visibility is kept in sync with
		// the current edit permission by updateEditability() so the Viewing/
		// Editing toggle can show or hide the Edit/Reply/Delete affordances
		// without re-rendering the comment.
		if (this.sectionProperties.noMenu !== true) {
			this.createMenu();
		}

		if (this.sectionProperties.data.trackchange) {
			this.sectionProperties.captionNode = window.L.DomUtil.create('div', 'cool-annotation-caption', this.sectionProperties.wrapper);
			this.sectionProperties.captionText = window.L.DomUtil.create('div', '', this.sectionProperties.captionNode);
		}

		this.sectionProperties.contentNode = window.L.DomUtil.create('div', 'cool-annotation-content cool-dont-break', this.sectionProperties.wrapper);
		this.sectionProperties.contentNode.id = 'annotation-content-area-' + this.sectionProperties.data.id;
		this.sectionProperties.contentNode.setAttribute('tabindex', '-1');

		const commentFooter = window.L.DomUtil.create('div', 'cool-annotation-footer', this.sectionProperties.wrapper);
		this.sectionProperties.contentDate = window.L.DomUtil.create('div', 'cool-annotation-date', commentFooter);
		const resolvedEl = window.L.DomUtil.create('div', 'cool-annotation-content-resolved', commentFooter);
		this.sectionProperties.resolvedTextElement = resolvedEl;
		this.updateResolvedField(this.sectionProperties.data.resolved);


		this.sectionProperties.nodeModify = window.L.DomUtil.create('div', 'cool-annotation-edit' + ' modify-annotation', this.sectionProperties.wrapper);
		this.sectionProperties.nodeModifyText = window.L.DomUtil.create('div', 'cool-annotation-textarea', this.sectionProperties.nodeModify);
		this.createReplyHint(this.sectionProperties.nodeModify);
		this.sectionProperties.nodeModifyText.setAttribute('contenteditable', 'true');
		this.sectionProperties.nodeModifyText.setAttribute('role', 'textbox');
		this.sectionProperties.nodeModifyText.setAttribute('aria-label', Comment.editCommentLabel);
		this.sectionProperties.nodeModifyText.id = 'annotation-modify-textarea-' + this.sectionProperties.data.id;
		this.sectionProperties.contentText = window.L.DomUtil.create('div', '', this.sectionProperties.contentNode);
		this.sectionProperties.nodeReply = window.L.DomUtil.create('div', 'cool-annotation-edit' + ' reply-annotation', this.sectionProperties.wrapper);
		this.sectionProperties.nodeReplyText = window.L.DomUtil.create('div', 'cool-annotation-textarea', this.sectionProperties.nodeReply);
		this.createReplyHint(this.sectionProperties.nodeReply);
		this.sectionProperties.nodeReplyText.setAttribute('contenteditable', 'true');
		this.sectionProperties.nodeReplyText.setAttribute('role', 'textbox');
		this.sectionProperties.nodeReplyText.setAttribute('aria-label', Comment.replyCommentLabel);
		this.sectionProperties.nodeReplyText.id = 'annotation-reply-textarea-' + this.sectionProperties.data.id;
		this.createChildLinesNode();

		this.sectionProperties.container.style.visibility = 'hidden';

		if (this.sectionProperties.commentMarkerSubSection === null && app.map._docLayer._docType === 'presentation' || app.map._docLayer._docType === 'drawing')
			this.createMarkerSubSection();

		this.doPendingInitializationInView();

		if (!(<any>window).mode.isSmallScreenDevice())
			document.getElementById('document-container').appendChild(this.sectionProperties.container);

		this.updateEditability();
		this.sectionProperties.onUpdatePermissionBound = this.updateEditability.bind(this);
		app.events.on('updatepermission', this.sectionProperties.onUpdatePermissionBound);
	}

	// Syncs visible edit affordances with the current comment-editing
	// permission. The editable=true branch only re-shows the menubar
	// cell: nodeModify/nodeReply remain hidden until the user explicitly
	// triggers edit()/reply(), so we deliberately do NOT auto-reopen a
	// previously open edit/reply pane when permission is restored.
	private makeEditable (editable: boolean): void {
		const props = this.sectionProperties;
		if (props.menuBarCell?.style)
			props.menuBarCell.style.display = editable ? '' : 'none';
		if (editable) return;
		if (props.nodeModify?.style) props.nodeModify.style.display = 'none';
		if (props.nodeReply?.style) props.nodeReply.style.display = 'none';
		if (props.contentNode?.style) props.contentNode.style.display = '';
		props.container.classList.remove('modify-annotation-container');
		props.container.classList.remove('reply-annotation-container');
		this.cachedIsEdit = false;
	}

	// Invoked at init and on every updatepermission event, so toggling
	// between Viewing and Editing mode immediately hides or restores the
	// per-comment controls.
	private updateEditability (): void {
		this.makeEditable(app.isCommentEditingAllowed());
		this.updateTrackChangeButtons();
	}

	// PHONE GATE for the redline half of the comment deadlock. Writer on a
	// phone opens in the touch read POSTURE (Permission.js
	// _usesTouchReadPosture), so every comment is constructed while
	// map.isReadOnlyMode() is true; onInitialize's one-shot
	// `!isReadOnlyMode()` test therefore never built the Accept/Reject
	// buttons, and nothing revisited that decision when the user later tapped
	// the pencil. Redline cards reached the comment wizard with no per-change
	// controls in EITHER posture.
	//
	// Substituting false here makes updateTrackChangeButtons a no-op and
	// leaves onInitialize's build-once decision standing exactly as before,
	// which is what desktop and tablet get: neither satisfies
	// isSmallScreenDevice(), and js/global.js only stamps
	// html.vulcan-mobile-chrome when it does. Calc and Impress are excluded
	// too -- they have no track changes, but the doctype test keeps the gate
	// honest rather than relying on that.
	private usesDynamicRedlineButtons (): boolean {
		return (<any>window).mode.isSmallScreenDevice()
			&& document.documentElement.classList.contains('vulcan-mobile-chrome')
			&& app.map._docLayer._docType === 'text';
	}

	// Keeps the Accept/Reject pair in sync with the redline PERMISSION rather
	// than with the map's posture. app.isRedlineManagementAllowed() is the
	// flag the server sets over the wire (Socket.ts filemode: ->
	// app.setRedlineManagementAllowed) and that the menubar already uses to
	// decide whether the Changes menu survives read-only
	// (Control.Menubar._checkItemVisibility). HideChangeTrackingControls is a
	// host suppression and is honored exactly as in onInitialize. A genuinely
	// read-only session keeps whatever core granted it, because
	// _applyViewReadOnly early-returns for those and never forces the flag.
	private updateTrackChangeButtons (): void {
		if (!this.usesDynamicRedlineButtons())
			return;
		if (!this.sectionProperties.data.trackchange)
			return;

		const wopi = app.map['wopi'];
		const allowed = app.isRedlineManagementAllowed()
			&& !(wopi && wopi.HideChangeTrackingControls);
		const present = !!this.sectionProperties.acceptButton;
		if (allowed === present)
			return;

		if (allowed)
			this.createTrackChangeButtons();
		else
			this.destroyTrackChangeButtons();
	}

	private destroyTrackChangeButtons (): void {
		const props = this.sectionProperties;
		[props.acceptButtonCell, props.rejectButtonCell].forEach((cell: HTMLElement) => {
			if (cell && cell.parentNode)
				cell.parentNode.removeChild(cell);
		});
		props.acceptButtonCell = null;
		props.rejectButtonCell = null;
		props.acceptButton = null;
		props.rejectButton = null;
	}

	private createContainerAndWrapper (): void {
		var isRTL = document.documentElement.dir === 'rtl';
		this.sectionProperties.container = window.L.DomUtil.create('div', 'cool-annotation' + (isRTL ? ' rtl' : ''));
		this.sectionProperties.container.id = 'comment-container-' + this.sectionProperties.data.id;
		window.L.DomEvent.on(this.sectionProperties.container, 'focusout', this.onLostFocus, this);

		var mobileClass = (<any>window).mode.isSmallScreenDevice() ? ' wizard-comment-box': '';

		if (this.sectionProperties.data.trackchange) {
			this.sectionProperties.wrapper = window.L.DomUtil.create('div', 'cool-annotation-redline-content-wrapper' + mobileClass, this.sectionProperties.container);
		} else {
			this.sectionProperties.wrapper = window.L.DomUtil.create('div', 'cool-annotation-content-wrapper' + mobileClass, this.sectionProperties.container);
		}

		this.sectionProperties.wrapper.style.marginLeft = this.sectionProperties.childCommentOffset*this.getChildLevel() + 'px';

		if (document.documentElement.dir === 'rtl')
			this.sectionProperties.wrapper.dir = 'rtl';

		// We make comment directly visible when its transitioned to its determined position
		if (cool.CommentSection.autoSavedComment)
			this.sectionProperties.container.style.visibility = 'hidden';
	}

	private createAuthorTable (): void {
		this.sectionProperties.author = window.L.DomUtil.create('table', 'cool-annotation-table', this.sectionProperties.wrapper);

		var tbody = window.L.DomUtil.create('tbody', '', this.sectionProperties.author);

		var tr = window.L.DomUtil.create('tr', 'cool-annotation-author-header', tbody);
		this.sectionProperties.authorRow = tr;
		tr.id = 'author table row ' + this.sectionProperties.data.id;
		var tdImg = window.L.DomUtil.create('td', 'cool-annotation-img', tr);
		var tdAuthor = window.L.DomUtil.create('td', 'cool-annotation-author', tr);
		var imgAuthor = window.L.DomUtil.create('img', 'avatar-img', tdImg);
		imgAuthor.setAttribute('alt', this.sectionProperties.data.author);
		var viewId = this.map.getViewId(this.sectionProperties.data.author);
		if (this.map['wopi'] && this.map['wopi'].CommentAvatarUrl)
			imgAuthor.setAttribute('src', this.map['wopi'].CommentAvatarUrl);
		else
			app.LOUtil.setUserImage(imgAuthor, this.map, viewId);
		imgAuthor.setAttribute('width', this.sectionProperties.imgSize[0]);
		imgAuthor.setAttribute('height', this.sectionProperties.imgSize[1]);

		if (app.map._docLayer._docType !== 'spreadsheet') {
			this.sectionProperties.collapsedInfoNode = window.L.DomUtil.create('div', 'cool-annotation-info-collapsed', tdImg);
			this.sectionProperties.collapsedInfoNode.style.display = 'none';
		}

		this.sectionProperties.authorAvatarImg = imgAuthor;
		this.sectionProperties.authorAvatartdImg = tdImg;
		this.sectionProperties.contentAuthor = window.L.DomUtil.create('div', 'cool-annotation-content-author', tdAuthor);
	}

	private createMenu (): void {
		var tdMenu = window.L.DomUtil.create('td', 'cool-annotation-menubar', this.sectionProperties.authorRow);
		this.sectionProperties.menuBarCell = tdMenu;
		if (this.isAuthor()) {
			const edit = window.L.DomUtil.create('div', 'cool-annotation-menu-edit', tdMenu);
			edit.id = 'comment-annotation-menu-edit-' + this.sectionProperties.data.id;
			// Honor an earlier Hide_Command for .uno:EditAnnotation; the class
			// is toggled symmetrically by UIManager.showCommand later.
			if (!app.map.uiManager.isCommandVisible('.uno:EditAnnotation'))
				edit.classList.add('hidden-by-command');
			edit.tabIndex = 0;
			edit.onclick = this.onEditComment.bind(this);
			edit.onkeypress = this.editOnKeyPress.bind(this);
			edit.dataset.title = Comment.editCommentLabel;
			edit.setAttribute('aria-label', Comment.editCommentLabel);
		}

		this.sectionProperties.menu = window.L.DomUtil.create('div', this.sectionProperties.data.trackchange ? 'cool-annotation-menu-redline' : 'cool-annotation-menu', tdMenu);
		this.sectionProperties.menu.id = 'comment-annotation-menu-' + this.sectionProperties.data.id;
		this.sectionProperties.menu.tabIndex = 0;
		this.sectionProperties.menu.onclick = this.menuOnMouseClick.bind(this);
		this.sectionProperties.menu.onkeypress = this.menuOnKeyPress.bind(this);
		this.sectionProperties.menu.dataset.title = Comment.openMenuLabel;
		this.sectionProperties.menu.setAttribute('aria-label', Comment.openMenuLabel);
	}

	// Returns the final (post-clamp) top in canvas-relative CSS px, so a thread's
	// replies can follow a parent that was clamped to stay in view.
	public setContainerPos(forceUpdate: boolean, canvasContainerBounds?: DOMRect, left?: number, top?: number): number {
		if ((<any>window).mode.isSmallScreenDevice()) {
			return this.renderedPosY;
		}

		if (canvasContainerBounds === undefined) {
			canvasContainerBounds = this.canvasContainerBounds;
		}

		if (left === undefined) {
			left = this.containerPosX;
		}

		if (top === undefined) {
			top = this.containerPosY;
		}

		if (this.containerPosX === left
				&& this.containerPosY === top
				&& this.canvasContainerBounds.left === canvasContainerBounds.left
				&& this.canvasContainerBounds.right === canvasContainerBounds.right
				&& this.canvasContainerBounds.top === canvasContainerBounds.top
				&& this.canvasContainerBounds.bottom === canvasContainerBounds.bottom
				&& !forceUpdate
		) {
			return this.renderedPosY;
		}

		this.containerPosX = left;
		this.containerPosY = top;
		this.canvasContainerBounds = canvasContainerBounds;

		left += canvasContainerBounds.left;
		top += canvasContainerBounds.top;

		if (this.isSelected() || this.isEdit()) {
			// Gap kept between the comment and the toolbar/canvas edges.
			const margin = this.sectionProperties.commentListSection.sectionProperties.marginY / app.dpiScale;

			if (left < canvasContainerBounds.left) {
				left = canvasContainerBounds.left;
			}

			if (top < canvasContainerBounds.top + margin) {
				top = canvasContainerBounds.top + margin;
			}

			const width = this.getCommentWidth() / app.dpiScale;
			if (left + width > canvasContainerBounds.right) {
				left = canvasContainerBounds.right - width;
			}

			const height = this.getCommentHeight();
			if (top + height > canvasContainerBounds.bottom - margin) {
				top = canvasContainerBounds.bottom - height - margin;
			}

			// A comment taller than the view would be pushed up by the line above until
			// its top slips under the toolbar; keep the top below the toolbar.
			if (top < canvasContainerBounds.top + margin) {
				top = canvasContainerBounds.top + margin;
			}
		}

		if (this.isSelected()) {
			this.sectionProperties.container.style.zIndex = 14;
		} else if (this.isEdit()) {
			this.sectionProperties.container.style.zIndex = 13;
		} else {
			this.sectionProperties.container.style.zIndex = ''; // Default for .cool-annotation is 12
		}

		this.sectionProperties.container.style.left = Math.round(left) + 'px';
		this.sectionProperties.container.style.top = Math.round(top) + 'px';

		this.renderedPosY = top - canvasContainerBounds.top;
		return this.renderedPosY;
	}

	private createReplyHint (commentType: HTMLElement): void {
		this.sectionProperties.replyHint = window.L.DomUtil.create('p', '', commentType);
		var small = document.createElement('small');
		small.classList.add('cool-font');
		small.innerText = _('Press Ctrl + Enter to post');
		this.sectionProperties.replyHint.appendChild(small);
	}

	private createChildLinesNode (): void {
		this.sectionProperties.childLinesNode = window.L.DomUtil.create('div', '', this.sectionProperties.container);
		this.sectionProperties.childLinesNode.id = 'annotation-child-lines-' + this.sectionProperties.data.id;
		this.sectionProperties.childLinesNode.style.width = this.sectionProperties.childCommentOffset*(this.getChildLevel() + 1) + 'px';
	}

	public getContainerPosX(): number {
		return this.containerPosX;
	}

	public getContainerPosY(): number {
		return this.containerPosY;
	}

	public updateChildLines (): void {
		if (!this.isContainerVisible())
			return;
		this.sectionProperties.wrapper.style.marginLeft =  this.sectionProperties.childCommentOffset*this.getChildLevel() + 'px';
		this.sectionProperties.childLinesNode.style.width = this.sectionProperties.childCommentOffset*(this.getChildLevel() + 1) + 'px';

		const childPositions = [];
		for (let i = 0; i < this.sectionProperties.children.length; i++) {
			if (this.sectionProperties.children[i].isContainerVisible())
				childPositions.push({ id: this.sectionProperties.children[i].sectionProperties.data.id,
					posY: this.sectionProperties.children[i].renderedPosY
				});
		}
		childPositions.sort((a, b) => { return a.posY - b.posY; });
		// Use renderedPosY (post-clamp), not getContainerPosY (pre-clamp): a clamped
		// parent renders elsewhere than its requested top, so the line must follow where
		// things actually are, otherwise it stretches down to the stale position.
		let lastPosY = this.renderedPosY + this.getCommentHeight(false);
		let i = 0;
		for (; i < childPositions.length; i++) {
			if (this.sectionProperties.childLines[i] === undefined) {
				this.sectionProperties.childLines[i] = window.L.DomUtil.create('div', 'cool-annotation-child-line', this.sectionProperties.childLinesNode);
				this.sectionProperties.childLines[i].id = 'annotation-child-line-' + this.sectionProperties.data.id + '-' + i;
				this.sectionProperties.childLines[i].style.width = this.sectionProperties.childCommentOffset/2 + 'px';
			}
			this.sectionProperties.childLines[i].style.marginLeft =  (this.sectionProperties.childCommentOffset*this.getChildLevel() + 4) + 'px';
			this.sectionProperties.childLines[i].style.height = (childPositions[i].posY + 24 - lastPosY) + 'px';
			lastPosY = childPositions[i].posY + 24;
		}
		while (i < this.sectionProperties.childLines.length) {
			this.sectionProperties.childLinesNode.removeChild(this.sectionProperties.childLines[i]);
			this.sectionProperties.childLines.splice(i, 1);
		}

	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	public setData (data: any): void {
		this.sectionProperties.data = data;
		const rectangles = this.sectionProperties.data.rectangles;

		if (rectangles) {
			// Convert the rectangles into simple rectangles as soon as possible.
			for (let i = 0; i < rectangles.length; i++) {
				rectangles[i] = new cool.SimpleRectangle(rectangles[i][0], rectangles[i][1], rectangles[i][2], rectangles[i][3]);
			}
		}
	}

	private createTrackChangeButtons (): void {
		// When this runs late (updateTrackChangeButtons, after a posture
		// change) the menu cell already exists, so insert ahead of it: the
		// author row's cell order must stay accept · reject · menu, the order
		// onInitialize produces when it builds all three in sequence.
		// Widget.Comment.ts addresses `.cool-annotation-menubar`[0] by index
		// when it collapses a thread into a drill-in row, so the order is
		// load-bearing rather than cosmetic. insertBefore(el, null) appends,
		// which is exactly the original behaviour when no menu cell exists.
		var authorRow = this.sectionProperties.authorRow;
		var beforeCell = this.sectionProperties.menuBarCell || null;

		var tdAccept = this.sectionProperties.acceptButtonCell = window.L.DomUtil.create('td', 'cool-annotation-menubar');
		authorRow.insertBefore(tdAccept, beforeCell);
		var acceptButton = this.sectionProperties.acceptButton = window.L.DomUtil.create('button', 'cool-redline-accept-button', tdAccept);

		var tdReject = this.sectionProperties.rejectButtonCell = window.L.DomUtil.create('td', 'cool-annotation-menubar');
		authorRow.insertBefore(tdReject, beforeCell);
		var rejectButton = this.sectionProperties.rejectButton = window.L.DomUtil.create('button', 'cool-redline-reject-button', tdReject);

		acceptButton.dataset.title = _('Accept change');
		acceptButton.setAttribute('aria-label', _('Accept change'));

		window.L.DomEvent.on(acceptButton, 'click', function() {
			this.map.fire('RedlineAccept', {id: this.sectionProperties.data.id});
		}, this);

		rejectButton.dataset.title = _('Reject change');
		rejectButton.setAttribute('aria-label', _('Reject change'));

		window.L.DomEvent.on(rejectButton, 'click', function() {
			this.map.fire('RedlineReject', {id: this.sectionProperties.data.id});
		}, this);
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	private createButton (container: any, id: any, cssClass: string, value: any, handler: any): HTMLButtonElement {
		var button = window.L.DomUtil.create('input', cssClass, container);
		button.id = id;
		button.type = 'button';
		button.value = value;
		window.L.DomEvent.on(button, 'mousedown', window.L.DomEvent.preventDefault);
		window.L.DomEvent.on(button, 'click', handler, this);
		return button;
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	public parentOf (comment: any): boolean {
		return this.sectionProperties.data.id === comment.sectionProperties.data.parent;
	}

	public updateResolvedField (state: string): void {
		this.sectionProperties.resolvedTextElement.innerText = state === 'true' ? _('Resolved') : '';
	}

	public updateRemovedField (): void {
		var isDeleted = this.sectionProperties.data.layoutStatus === CommentLayoutStatus.DELETED;
		if (isDeleted && !this.sectionProperties.removedTextElement) {
			var commentFooter = this.sectionProperties.contentDate.parentNode;
			this.sectionProperties.removedTextElement = window.L.DomUtil.create('div', 'cool-annotation-content-removed', commentFooter);
		}
		if (this.sectionProperties.removedTextElement) {
			this.sectionProperties.removedTextElement.innerText = isDeleted ? _('Removed') : '';
		}
		if (isDeleted) {
			this.sectionProperties.resolvedTextElement.innerText = '';
		} else {
			this.updateResolvedField(this.sectionProperties.data.resolved);
		}
	}

	private isNewPara(): boolean {
		const selection = window.getSelection();
		if (!selection.rangeCount) return;

		const range = selection.getRangeAt(0);
		const cursorPosition = range.startOffset;
		const node = range.startContainer;

		const beforeCursor = node.textContent.slice(0, cursorPosition);
		return /^\s*$/.test(beforeCursor.slice(0, -1));
	}

	private textAreaInput(ev: any): void {
		if (ev && app.map._docLayer._docType === 'text') {
			// special handling for mentions
			this.map?.mention.handleMentionInput(ev, this.isNewPara());
		}
	}

	private handleKeyDownForPopup (ev: any, id: string): void {
		var popup = this.map._textInput._handleKeyDownForPopup(ev, id);
		// Block Esc from propagating if it closes the comment mention Popup
		if (popup && id === 'mentionPopup' && ev.key === 'Escape') {
			ev.preventDefault();
			ev.stopPropagation();
		}
	}

	private isCtrlEnter(ev: KeyboardEvent): boolean {
		return !!ev && ev.ctrlKey && ev.key === "Enter";
	}

	private handleCommentCtrlEnter(ev: KeyboardEvent): void {
		this.map.mention?.closeMentionPopup(false);
		const targetId = (ev.target as HTMLElement).id;
		if (this.sectionProperties.nodeReplyText.id === targetId) {
			this.handleReplyCommentButton(ev);
		} else {
			this.handleSaveCommentButton(ev);
		}
	}

	private textAreaKeyDown(ev: KeyboardEvent): void {
		if (window.KeyboardShortcuts.processEvent(app.UI.language.fromURL, ev)) {
			return;
		}
		this.handleKeyDownForPopup(ev, 'mentionPopup');
	}

	private onFocus() {
		this.resetControl(this.sectionProperties.saveButton, _('Save'), 'annotation-button-autosaved');
	}

	private onFocusReply() {
		this.resetControl(this.sectionProperties.replyButton, _('Reply'), 'annotation-button-autosaved');
	}

	private updateContent (): void {
		let contentModified = true;
		let contentRaw = '';

		if (this.sectionProperties.data.html)
			contentRaw = app.LOUtil.sanitize(this.sectionProperties.data.html);
		else
			contentRaw = this.sectionProperties.data.text ? this.sectionProperties.data.text: '';

		if (this.sectionProperties.lastContentRaw === contentRaw) contentModified = false;

		// happens when comment anchor is moved due to typing in the same paragraph
		if (!contentModified) return;

		this.sectionProperties.lastContentRaw = contentRaw;

		if (this.sectionProperties.data.html)
			this.sectionProperties.contentText.innerHTML = app.LOUtil.sanitize(this.sectionProperties.data.html);
		else
			this.sectionProperties.contentText.innerText = this.sectionProperties.data.text ? this.sectionProperties.data.text: '';
		// Get the escaped HTML out and find for possible, useful links
		var linkedText = Autolinker.link(this.sectionProperties.contentText.outerHTML);
		this.sectionProperties.contentText.innerHTML = app.LOUtil.sanitize(linkedText);
		// Original unlinked text
		this.sectionProperties.contentText.origText = this.sectionProperties.data.text ? this.sectionProperties.data.text: '';
		this.sectionProperties.contentText.origHTML = this.sectionProperties.data.html ? this.sectionProperties.data.html: '';
		this.sectionProperties.nodeModifyText.innerText = this.sectionProperties.data.text ? this.sectionProperties.data.text: '';
		if (this.sectionProperties.data.html) {
			this.sectionProperties.nodeModifyText.innerHTML = app.LOUtil.sanitize(this.sectionProperties.data.html);
		}
	}

	private updateMetadata (): void {
		this.sectionProperties.contentAuthor.innerText = this.sectionProperties.data.author;

		this.updateResolvedField(this.sectionProperties.data.resolved);
		this.updateRemovedField();
		if (this.map['wopi'] && this.map['wopi'].CommentAvatarUrl) {
			this.sectionProperties.authorAvatarImg.setAttribute('src', this.map['wopi'].CommentAvatarUrl);
		}
		else if (this.sectionProperties.data.avatar) {
			this.sectionProperties.authorAvatarImg.setAttribute('src', this.sectionProperties.data.avatar);
		}
		else {
			$(this.sectionProperties.authorAvatarImg).css('padding', '1.8px');
		}
		var user = this.map.getViewId(this.sectionProperties.data.author);
		if (user >= 0) {
			var color = app.LOUtil.rgbToHex(this.map.getViewColor(user));
			this.sectionProperties.authorAvatartdImg.style.borderColor = color;
		}

		// dateTime is already in UTC, so we will not append Z that will create issues while converting date
		var d = new Date(this.sectionProperties.data.dateTime.replace(/,.*/, ''));
		var dateOptions: any = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric'};
		this.sectionProperties.contentDate.innerText = isNaN(d.getTime()) ? this.sectionProperties.data.dateTime: d.toLocaleDateString((<any>String).locale, dateOptions);

		if (this.sectionProperties.data.trackchange) {
			this.sectionProperties.captionText.innerText = this.sectionProperties.data.description;
		}
	}

	private updateLayout (): void {
		var style = this.sectionProperties.wrapper.style;
		style.width = '';
		style.whiteSpace = 'nowrap';

		style.whiteSpace = '';
	}

	private setPositionAndSize (): void {
		var rectangles = this.sectionProperties.data.rectanglesOriginal;
		if (rectangles && app.map._docLayer._docType === 'text') {
			var xMin: number = Infinity, yMin: number = Infinity, xMax: number = 0, yMax: number = 0;
			for (var i = 0; i < rectangles.length; i++) {
				if (rectangles[i][0] < xMin)
					xMin = rectangles[i][0];

				if (rectangles[i][1] < yMin)
					yMin = rectangles[i][1];

				if (rectangles[i][0] + rectangles[i][2] > xMax)
					xMax = rectangles[i][0] + rectangles[i][2];

				if (rectangles[i][1] + rectangles[i][3] > yMax)
					yMax = rectangles[i][1] + rectangles[i][3];
			}
			// Rectangles are in twips. Convert them to core pixels.
			xMin = Math.round(xMin * app.twipsToPixels);
			yMin = Math.round(yMin * app.twipsToPixels);
			xMax = Math.round(xMax * app.twipsToPixels);
			yMax = Math.round(yMax * app.twipsToPixels);

			// Phone Writer: the indicator's touch box is centred on the LAST
			// line and is taller than it (phoneWriterIndicatorBox), so it
			// overhangs this bounding box above and below. isHit tests the
			// SECTION first, so without this the enlarged target would be
			// enlarged only on paper -- the extra pixels would belong to the
			// tiles section and never reach onMouseUp. Zero everywhere else,
			// so this reduces to the two lines it replaced.
			const phonePad = this.phoneIndicatorVerticalPad();
			yMin -= phonePad;
			yMax += phonePad;

			this.setPosition(xMin, yMin); // This function is added by section container.
			this.size = [xMax - xMin, yMax - yMin];
			if (this.size[0] < 5)
				this.size[0] = 5;
		}
		else if (this.sectionProperties.data.cellRange && app.map._docLayer._docType === 'spreadsheet') {
			// calcTouchSizeForCalc() === calcOptimumSizeForCalc() off the phone
			// chrome. Taking it BEFORE the position is computed is the point:
			// position is derived from this.size below so the box stays
			// right-anchored to the cell's right edge, which keeps the widened
			// box inside the cell instead of spilling into its neighbour.
			this.size = this.calcTouchSizeForCalc();
			var cellPos = app.map._docLayer._cellRangeToTwipRect(this.sectionProperties.data.cellRange).toRectangle();
			let startX = cellPos[0];
			if (this.isCalcRTL()) { // Mirroring is done in setPosition
				const sizeX = cellPos[2];
				startX += sizeX;  // but adjust for width of the cell.
			}
			this.setShowSection(true);
			var position: Array<number> = [Math.round((cellPos[0] + cellPos[2]) * app.twipsToPixels - this.size[0]), Math.round(cellPos[1] * app.twipsToPixels)];

			this.setPosition(position[0], position[1]);
		}
		else if (app.map._docLayer._docType === 'presentation' || app.map._docLayer._docType === 'drawing') {
			this.size = [Math.round(this.sectionProperties.imgSize[0] * app.dpiScale), Math.round(this.sectionProperties.imgSize[1] * app.dpiScale)];
			this.setPosition(Math.round(this.sectionProperties.data.rectangle[0] * app.twipsToPixels), Math.round(this.sectionProperties.data.rectangle[1] * app.twipsToPixels));
		}
	}

	public removeHighlight (): void {
		if (app.map._docLayer._docType === 'text') {
			this.sectionProperties.usedTextColor = this.sectionProperties.data.color;

			this.sectionProperties.isHighlighted = false;
		}
		else if (app.map._docLayer._docType === 'spreadsheet') {
			this.backgroundColor = null;
			this.backgroundOpacity = 1;
		}
	}

	public highlight (): void {
		if (app.map._docLayer._docType === 'text') {
			this.sectionProperties.usedTextColor = this.sectionProperties.highlightedTextColor;

			var x: number = Math.round(this.position[0] / app.dpiScale);
			var y: number = Math.round(this.position[1] / app.dpiScale);
			(this.containerObject.getSectionWithName(app.CSections.Scroll.name) as any as cool.ScrollSection).onScrollTo({x: x, y: y});
		}
		else if (app.map._docLayer._docType === 'spreadsheet') {
			this.backgroundColor = '#777777'; //background: rgba(119, 119, 119, 0.25);
			this.backgroundOpacity = 0.25;

			var x: number = Math.round(this.position[0] / app.dpiScale);
			var y: number = Math.round(this.position[1] / app.dpiScale);
			(this.containerObject.getSectionWithName(app.CSections.Scroll.name) as any as cool.ScrollSection).onScrollTo({x: x, y: y});
		}

		this.containerObject.requestReDraw();
		this.sectionProperties.isHighlighted = true;
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	private static doesRectIntersectView(pos: number[], size: number[], viewContext: any): boolean {
		var paneBoundsList = <any[]>viewContext.paneBoundsList;
		var endPos = [pos[0] + size[0], pos[1] + size[1]];
		for (var i = 0; i < paneBoundsList.length; ++i) {
			var paneBounds = paneBoundsList[i];
			var rectInvisible = (endPos[0] < paneBounds.min.x || endPos[1] < paneBounds.min.y ||
				pos[0] > paneBounds.max.x || pos[1] > paneBounds.max.y);
			if (!rectInvisible)
				return true;
		}
		return false;
	}

	// This is for svg elements that will be bound to document-container.
	// This also returns whether any rectangle has an intersection with the visible area/panes.
	// This function calculates the core pixel coordinates then converts them into view coordinates.
	private convertRectanglesToViewCoordinates () : boolean {
		var rectangles = this.sectionProperties.data.rectangles;
		var viewContext = this.map.getTileSectionMgr()._paintContext();
		var intersectsVisibleArea = false;

		if (rectangles) {
			for (let i = 0; i < rectangles.length; i++) {
				if (app.activeDocument.activeLayout.viewedRectangle.intersectsRectangle(rectangles[i].toArray())) {
					intersectsVisibleArea = true;
					break;
				}
			}
		} else if (this.sectionProperties.data.trackchange && this.sectionProperties.data.anchorPos) {
			// For redline comments there are no 'rectangles' or 'rectangleOriginal' properties in sectionProperties.data
			// So use the comment rectangle stored in anchorPos (in display? twips).
			intersectsVisibleArea = Comment.doesRectIntersectView(this.getPosition(), this.getSize(), viewContext);
		}

		return intersectsVisibleArea;
	}

	public getPosition (): number[] {
		// For redline comments there are no 'rectangles' or 'rectangleOriginal' properties in sectionProperties.data
		// So use the comment rectangle stored in anchorPos (in display? twips).
		if (this.sectionProperties.data.trackchange && this.sectionProperties.data.anchorPos) {
			var anchorPos = this.sectionProperties.data.anchorPos;
			return [
				Math.round(anchorPos[0] * app.twipsToPixels),
				Math.round(anchorPos[1] * app.twipsToPixels)
			];
		} else {
			return this.position;
		}
	}

	public getSize(): number[] {
		// For redline comments there are no 'rectangles' or 'rectangleOriginal' properties in sectionProperties.data
		// So use the comment rectangle stored in anchorPos (in display? twips).
		if (this.sectionProperties.data.trackchange && this.sectionProperties.data.anchorPos) {
			var anchorPos = this.sectionProperties.data.anchorPos;
			return [
				Math.round(anchorPos[2] * app.twipsToPixels),
				Math.round(anchorPos[3] * app.twipsToPixels)
			];
		} else {
			return this.size;
		}
	}

	private updatePosition (): void {
		this.setPositionAndSize();
		if (app.map._docLayer._docType === 'spreadsheet')
			this.positionCalcComment();
		else if (app.map._docLayer._docType === "presentation" || app.map._docLayer._docType === "drawing") {
			if (this.sectionProperties.commentMarkerSubSection !== null) {
				this.sectionProperties.commentMarkerSubSection.sectionProperties.data = this.sectionProperties.data;
				this.sectionProperties.commentMarkerSubSection.setPosition(
					this.sectionProperties.data.anchorPos[0] * app.twipsToPixels,
					this.sectionProperties.data.anchorPos[1] * app.twipsToPixels
				);
			}
			if (this.sectionProperties.commentAnchorAreaSubSection !== null) {
				const data = this.sectionProperties.data;
				this.sectionProperties.commentAnchorAreaSubSection.sectionProperties.data = data;
				this.sectionProperties.commentAnchorAreaSubSection.setPosition(
					data.anchorPos[0] * app.twipsToPixels,
					data.anchorPos[1] * app.twipsToPixels
				);
				// rectangle = [x, y, width, height] in twips (ImpressTileLayer.newAnnotation
				// builds it from the data; the JSON form coming back from core uses the
				// same shape via tools::Rectangle::toString()).
				this.sectionProperties.commentAnchorAreaSubSection.resize(
					data.rectangle[2] * app.twipsToPixels / app.dpiScale,
					data.rectangle[3] * app.twipsToPixels / app.dpiScale
				);
			}
		}
	}

	private createMarkerSubSection() {
		if (this.sectionProperties.data.rectangle === null)
			return;

		const showMarker = app.impress.partList[app.map._docLayer._selectedPart].hash === this.sectionProperties.data.parthash ||
							app.file.fileBasedView;

		// Anchor-area outline: only when the comment carries an explicit
		// area (set by core via the hasArea JSON field for PDF /Rect or
		// the Width/Height args of .uno:InsertAnnotation). Added before
		// the marker sub-section so findSectionContainingPoint, which
		// iterates last-to-first, lets the smaller marker icon take a
		// click at the rectangle's top-left while the area catches
		// clicks elsewhere inside the rectangle.
		if (this.sectionProperties.data.hasArea) {
			const widthCssPx = this.sectionProperties.data.rectangle[2]
				* app.twipsToPixels / app.dpiScale;
			const heightCssPx = this.sectionProperties.data.rectangle[3]
				* app.twipsToPixels / app.dpiScale;
			this.sectionProperties.commentAnchorAreaSubSection = new CommentAnchorAreaSubSection(
				this.name + this.sectionProperties.data.id + '-area' + String(Math.random()),
				widthCssPx,
				heightCssPx,
				new SimplePoint(this.sectionProperties.data.anchorPos[0], this.sectionProperties.data.anchorPos[1]),
				showMarker,
				this,
				this.sectionProperties.data
			);
			app.sectionContainer.addSection(this.sectionProperties.commentAnchorAreaSubSection);
		}

		this.sectionProperties.commentMarkerSubSection = new CommentMarkerSubSection(
			this.name + this.sectionProperties.data.id + String(Math.random()), // Section name - only as a placeholder.
			28, 28, // Width and height.
			new SimplePoint(this.sectionProperties.data.anchorPos[0], this.sectionProperties.data.anchorPos[1]), // Document position.
			'annotation-marker', // Extra class.
			showMarker, // Show section.
			this, // Parent section.
			this.sectionProperties.data
		);

		/*
			Phone Impress: grow the GRAB box, keep the 28 px icon.

			In this architecture the section bounds ARE the hit area
			(CanvasSectionObject.isHit tests myTopLeft + size, there is no
			separate hit geometry in the stack) and HTMLObjectSection derives
			both the bounds and the div's CSS box from the same number, so the
			28x28 above was the target as well as the art: 64% of the 44 px
			finger floor, 41% of its area. Growing `size` alone leaves the div
			at 28 px, so the icon does not change.

			The three-part gate, matching MouseControl.isVulcanPhoneImpress:
			small screen, AND the vulcan-mobile-chrome marker global.js stamps
			pre-paint (?vulcanChrome=desktop forces desktop chrome onto a small
			screen and the desktop geometry must come back with it), AND a
			presentation - the condition guarding createMarkerSubSection lets
			Draw build these markers too, and Draw keeps the stock size.

			The box grows DOWN and RIGHT rather than around the icon, which is
			deliberate. CommentMarkerSubSection.onDragEnd posts
			`this.position * app.pixelsToTwips` to .uno:EditAnnotation as the
			marker's new document position, and updatePosition() writes that
			same position straight from data.anchorPos. Re-centring the box
			would put its origin 8 px up-left of the icon, and every drag would
			then walk the comment 8 px up-left of where it was dropped. Anchored
			growth keeps position === icon top-left, so nothing downstream
			shifts and every point that hit the marker before still hits it -
			this is strictly additive. Centring needs the same offset taught to
			CommentMarkerSubSection, which is not in this change.

			No teleport comes with the bigger box here: onMouseMove tracks
			dragStartPosition + dragDistance, a delta, so the grab point already
			cancels out.

			Where a comment also carries an anchor area, nothing changes: that
			sub-section sets pointerEvents 'auto' on its own div and listens for
			the click there, so the DOM takes it before the canvas hit test
			runs, and both paths end in the same selectById.
		*/
		if (
			(<any>window).mode.isSmallScreenDevice() &&
			document.documentElement.classList.contains('vulcan-mobile-chrome') &&
			app.map._docLayer._docType === 'presentation'
		) {
			const marker = this.sectionProperties.commentMarkerSubSection;
			const hitSize = 44 * app.dpiScale;
			marker.size = [
				Math.max(marker.size[0], hitSize),
				Math.max(marker.size[1], hitSize),
			];
		}

		app.sectionContainer.addSection(this.sectionProperties.commentMarkerSubSection);
	}

	public isContainerVisible (): boolean {
		return this.sectionProperties.container.style &&
			this.sectionProperties.container.style.display !== 'none' &&
			(
				this.sectionProperties.container.style.visibility === 'visible' ||
				this.sectionProperties.container.style.visibility === ''
			);
	}

	public update (): void {
		this.updateContent();
		this.updateMetadata();
		this.updateLayout();
		this.updatePosition();
	}

	private showMarker (): void {
		if (this.sectionProperties.commentMarkerSubSection != null) {
			this.sectionProperties.commentMarkerSubSection.showSection = true;
			this.sectionProperties.commentMarkerSubSection.onSectionShowStatusChange();
		}
		if (this.sectionProperties.commentAnchorAreaSubSection != null) {
			this.sectionProperties.commentAnchorAreaSubSection.showSection = true;
			this.sectionProperties.commentAnchorAreaSubSection.onSectionShowStatusChange();
		}
	}

	private hideMarker (): void {
		if (this.sectionProperties.commentMarkerSubSection != null) {
			this.sectionProperties.commentMarkerSubSection.showSection = false;
			this.sectionProperties.commentMarkerSubSection.onSectionShowStatusChange();
		}
		if (this.sectionProperties.commentAnchorAreaSubSection != null) {
			this.sectionProperties.commentAnchorAreaSubSection.showSection = false;
			this.sectionProperties.commentAnchorAreaSubSection.onSectionShowStatusChange();
		}
	}

	private showWriter() {
		if (!this.isCollapsed || this.isSelected()) {
			this.sectionProperties.container.style.visibility = '';
			this.sectionProperties.container.style.display = '';
		}
		if (this.sectionProperties.data.resolved !== 'true' || this.sectionProperties.commentListSection.sectionProperties.showResolved) {
			window.L.DomUtil.addClass(this.sectionProperties.container, 'cool-annotation-collapsed-show');
			this.sectionProperties.showSelectedCoordinate = true;
		}
		this.sectionProperties.contentNode.style.display = '';
		this.sectionProperties.nodeModify.style.display = 'none';
		this.sectionProperties.nodeReply.style.display = 'none';
		this.sectionProperties.collapsedInfoNode.style.visibility = '';
		this.cachedIsEdit = false;
		this.setContainerPos(true);
	}

	private showCalc() {
		this.sectionProperties.container.style.display = '';
		this.sectionProperties.contentNode.style.display = '';
		this.sectionProperties.nodeModify.style.display = 'none';
		this.sectionProperties.nodeReply.style.display = 'none';
		this.cachedIsEdit = false;

		this.positionCalcComment();
		if (!(<any>window).mode.isSmallScreenDevice()) {
			this.sectionProperties.commentListSection.select(this);
		}
		this.sectionProperties.container.style.visibility = '';
	}

	private getCommentWidth() {
		// note: getComputedStyle can be an exceptional bottle-neck with many comments
		return parseFloat(getComputedStyle(this.sectionProperties.container).width) * app.dpiScale;
	}

	public positionCalcComment(): void {
		if (!(<any>window).mode.isSmallScreenDevice()) {
			const cellSize = this.calcOptimumSizeForCalc()[0];
			const startX = this.isCalcRTL()
				? this.myTopLeft[0] - cellSize - this.getCommentWidth() + 3
				: this.myTopLeft[0] + cellSize - 3;

			var pos: Array<number> = [Math.round(startX / app.dpiScale), Math.round(this.myTopLeft[1] / app.dpiScale)];
			this.sectionProperties.container.style.transform = 'translate3d(' + pos[0] + 'px, ' + pos[1] + 'px, 0px)';
		}
	}

	private showImpressDraw() {
		if (this.isInsideActivePart()) {
			this.sectionProperties.container.style.display = '';
			this.sectionProperties.nodeModify.style.display = 'none';
			this.sectionProperties.nodeReply.style.display = 'none';
			this.sectionProperties.contentNode.style.display = '';
			this.cachedIsEdit = false;
			this.setContainerPos(true);
			if (this.isSelected() || !this.isCollapsed) {
				this.sectionProperties.container.style.visibility = '';
			}
			else {
				this.sectionProperties.container.style.visibility = 'hidden';
			}
			window.L.DomUtil.addClass(this.sectionProperties.container, 'cool-annotation-collapsed-show');
		}
	}

	public setLayoutClass(): void {
		this.sectionProperties.container.classList.remove('tracked-deleted-comment-show');
		this.sectionProperties.container.classList.remove('tracked-deleted-comment-hide');

		var showTrackedChanges: boolean = this.map['stateChangeHandler'].getItemValue('.uno:ShowTrackedChanges') === 'true';
		var layoutClass: string = showTrackedChanges ? 'tracked-deleted-comment-show' : 'tracked-deleted-comment-hide';
		if (this.sectionProperties.data.layoutStatus === CommentLayoutStatus.DELETED) {
			this.sectionProperties.container.classList.add(layoutClass);
		}
		this.updateRemovedField();
	}

	public show(): void {
		this.doPendingInitializationInView(true /* force */);

		if (this.hidden === false && !this.isEdit()) return;

		this.showMarker();

		// On mobile, container shouldn't be 'document-container', but it is 'document-container' on initialization. So we hide the comment until comment wizard is opened.
		if ((<any>window).mode.isSmallScreenDevice() && this.sectionProperties.container.parentElement === document.getElementById('document-container'))
			this.sectionProperties.container.style.visibility = 'hidden';

		if (cool.CommentSection.commentWasAutoAdded)
			return;

		// We don't cache the hidden state for spreadsheets. Only one comment can be
		// visible and they're hidden when scrolling, so it's easier this way.
		if (app.map._docLayer._docType === 'text') {
			this.showWriter();
			this.hidden = false;
		} else if (app.map._docLayer._docType === 'presentation' || app.map._docLayer._docType === 'drawing') {
			this.showImpressDraw();
			this.hidden = false;
		} else if (app.map._docLayer._docType === 'spreadsheet')
			this.showCalc();

		this.setLayoutClass();
	}

	private hideWriter() {
		this.sectionProperties.container.style.visibility = 'hidden';
		this.sectionProperties.nodeModify.style.display = 'none';
		this.sectionProperties.nodeReply.style.display = 'none';
		this.sectionProperties.showSelectedCoordinate = false;
		window.L.DomUtil.removeClass(this.sectionProperties.container, 'cool-annotation-collapsed-show');
		this.cachedIsEdit = false;
		this.setContainerPos(true);
		this.hidden = true;
	}

	private hideCalc() {
		this.sectionProperties.container.style.visibility = 'hidden';
		this.sectionProperties.nodeModify.style.display = 'none';
		this.sectionProperties.nodeReply.style.display = 'none';
		this.cachedIsEdit = false;

		if (this.sectionProperties.commentListSection.sectionProperties.selectedComment === this)
			this.sectionProperties.commentListSection.sectionProperties.selectedComment = null;
	}

	private hideImpressDraw() {
		if (!this.isInsideActivePart()) {
			this.sectionProperties.container.style.display = 'none';
			this.hideMarker();
		}
		else {
			this.sectionProperties.container.style.display = '';
			if (this.isCollapsed)
				this.sectionProperties.container.style.visibility = 'hidden';

			this.sectionProperties.nodeModify.style.display = 'none';
			this.sectionProperties.nodeReply.style.display = 'none';
			this.cachedIsEdit = false;
			this.setContainerPos(true);
		}
		window.L.DomUtil.removeClass(this.sectionProperties.container, 'cool-annotation-collapsed-show');
		this.hidden = true;
	}

	public isAuthor(): boolean {
		return this.map.getViewName(app.map._docLayer._viewId) === this.sectionProperties.data.author;
	}

	public canRemove(): boolean {
		return this.isAuthor() || !this.map.isReadOnlyMode();
	}

	public canModerate(): boolean {
		return this.isAuthor() || app.isCommentEditingAllowed();
	}

	// check if this is "our" autosaved comment
	// core is not aware it's autosaved one so use this simplified detection based on content
	public isAutoSaved (): boolean {
		var autoSavedComment = cool.CommentSection.autoSavedComment;
		if (!autoSavedComment)
			return false;

		return this.isAuthor();
	}

	public hide (): void {
		if (this.hidden === true || this.isEdit()) {
			return;
		}

		if (this.sectionProperties.data.id === 'new') {
			this.sectionProperties.commentListSection.removeItem(this.sectionProperties.data.id);
			return;
		}

		if (app.map._docLayer._docType === 'text')
			this.hideWriter();
		else if (app.map._docLayer._docType === 'spreadsheet')
			this.hideCalc();
		else if (app.map._docLayer._docType === 'presentation' || app.map._docLayer._docType === 'drawing')
			this.hideImpressDraw();
	}

	/*
	 * Core has put this view on sheet `part` while this comment is
	 * still open for editing on another sheet. A plain Ctrl+PgUp/PgDn from the
	 * grid and a Name Box jump switch the sheet in core, so the comment guard
	 * in Map.setPart never sees them, and hide() keeps a comment that is being
	 * edited: the box stayed open over the new sheet. Close the edit when that
	 * loses nothing: the caret has left the box, and the box holds no text
	 * that was not sent (onLostFocus autosaves when the caret leaves). A 'new'
	 * draft is dropped. If its autosave is unconfirmed, autoSavedComment no
	 * longer points at it, so the comment core adds arrives closed.
	 */
	public closeEditLeftOnAnotherSheet(part: number): void {
		const props = this.sectionProperties;
		if (parseInt(props.data.tab) === part
			|| props.container.contains(document.activeElement)
			|| props.nodeModifyText.innerText !== props.contentText.origText
			|| props.nodeReplyText.innerText !== '')
			return;

		cool.CommentSection.autoSavedComment = null;
		cool.CommentSection.commentWasAutoAdded = false;
		cool.CommentSection.needFocus = null;
		props.contentText.uneditedText = null;
		props.contentText.uneditedHTML = null;
		props.commentListSection.removeCommentAttention(this);
		if (props.data.id === 'new')
			props.commentListSection.removeItem(props.data.id);
		else
			this.hideCalc();
	}

	private isInsideActivePart() {
		// Impress and Draw only.
		return this.sectionProperties.partIndex === app.map._docLayer._selectedPart;
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	private menuOnMouseClick (e: any): void {
		this.openContextMenu();
		window.L.DomEvent.stopPropagation(e);
	}

	private onEditComment (e: any): void {
		this.sectionProperties.commentListSection.modify(this);
		window.L.DomEvent.stopPropagation(e);
	}

	private editOnKeyPress (e: any): void {
		if (e.code === 'Space' || e.code === 'Enter')
		{
			this.onEditComment(e);
			window.L.DomEvent.stopPropagation(e);
		}
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	private menuOnKeyPress (e: any): void {
		if (e.code === 'Space' || e.code === 'Enter')
			this.openContextMenu();
		window.L.DomEvent.stopPropagation(e);
	}

	private openContextMenu (): void {
		const listSection = this.sectionProperties.commentListSection;
		const data = this.sectionProperties.data;
		const docLayer = app.map._docLayer;
		const entries: Array<any> = [];
		let pos = 0;
		// Honor Hide_Command for entries that map to a UNO command, so a host
		// can suppress comment-dialog actions the same way it suppresses
		// menubar / toolbar items.
		const isShown = (uno: string): boolean =>
			app.map.uiManager.isCommandVisible(uno);

		if (data.trackchange) {
			entries.push({ text: _('Comment'), type: 'action', id: 'modify', pos: String(pos++) });
		} else {
			const isAuthor = this.isAuthor();
			const canRemove = this.canRemove();
			const canModerate = this.canModerate();
			const removeUno = docLayer._docType === 'text' ? '.uno:DeleteComment'
				: (docLayer._docType === 'spreadsheet' ? '.uno:DeleteNote'
					: '.uno:DeleteAnnotation');
			if (isAuthor && isShown('.uno:EditAnnotation'))
				entries.push({ text: _('Modify'), type: 'action', id: 'modify', pos: String(pos++) });

			// REPLY IS WRITER-ONLY, AND FOR IMPRESS THAT IS A REFUSAL RATHER
			// THAN AN OVERSIGHT. Commit 0ba0fcbe6a ungated this row for
			// presentation on the strength of the dispatch chain existing; the
			// chain does exist, and the thing at the end of it is not a reply.
			// .uno:ReplyToAnnotation REWRITES THE COMMENT YOU REPLIED TO AND
			// SIGNS YOUR NAME TO IT.
			//
			// AnnotationManagerImpl::ExecuteReplyToAnnotation
			// (engine/sd/source/ui/annotations/annotationmanager.cxx:654-757)
			// resolves ONE annotation by SID_ATTR_POSTIT_ID (:663-668) and then
			// mutates that same object:
			//   :700-710  composes `<original author> (<original date>): "<old
			//             text>"`, keeping the colleague's words only as an
			//             italic quote inside the new body;
			//   :733      pTextApi->SetText(*pOPO) -- overwrites the original
			//             comment's text with that composite;
			//   :735-745  sReplyAuthor = mrBase.GetKitAuthor() under
			//             comphelper::COKit::isActive(), the desktop arm reads
			//             SvtUserOptions, and BOTH then run
			//             xAnnotation->setAuthor(sReplyAuthor);
			//   :747      setDateTime(getCurrentDateTime()).
			// It closes on a Modify notification (:750). There is no Add, no
			// child annotation, and no SetThreaded anywhere on the path.
			//
			// Net effect on a phone: tapping Reply on a colleague's comment
			// republishes THEIR comment under YOUR name and timestamp, silently.
			// The words survive inside the quote, so this is misattribution
			// rather than data loss -- which is worse than it sounds, because
			// nothing on the card ever says it happened.
			//
			// This is not fixable from here. The slot above is the entire reply
			// API sd exposes, both COKit arms reattribute, and the client cannot
			// un-ring a Modify. Writer is unaffected and stays open because it
			// is a genuinely different mechanism: FN_REPLY registers an ANSWER
			// and inserts a new note (sw/source/uibase/docvw/AnnotationWin2.cxx
			// :1103-1112), leaving the parent's author alone -- which is also
			// why only Writer has IsRootNote and FN_PROMOTE_COMMENT.
			//
			// Doing it properly is an ENGINE change and NOT a small one. The
			// model already carries the field -- svx Annotation has m_ParentId
			// with SetParentId/GetParentId (include/svx/annotation/Annotation.hxx
			// :99, :203-204) and sd's own test asserts a root/reply pair
			// (sd/qa/unit/AnnotationTest.cxx:565-570) -- but the only production
			// writer is the PDF import filter (sd/source/filter/pdf/
			// sdpdffilter.cxx:339), and GetParentId has exactly two production
			// readers, both in unomodel.cxx and both inside `if (IsThreaded())`
			// (:3599 PDF export, :4775 the LOK JSON writer). No odp or pptx
			// filter reads or writes parentId or threaded at all, so a reply
			// built as a real child would survive the session and vanish on
			// round-trip. Reinstating this row without that persistence work
			// re-ships the misattribution.
			if (docLayer._docType === 'text' && isShown('.uno:ReplyComment'))
				entries.push({ text: _('Reply'), type: 'action', id: 'reply', pos: String(pos++) });

			if (canRemove && isShown(removeUno))
				entries.push({ text: _('Remove'), type: 'action', id: 'remove', pos: String(pos++) });

			if (docLayer._docType === 'text' && this.isRootComment() && canRemove
				&& isShown('.uno:DeleteCommentThread'))
				entries.push({ text: _('Remove Thread'), type: 'action', id: 'removeThread', pos: String(pos++) });

			// RESOLVE IS LEFT GATED FOR IMPRESS, ON PURPOSE. `data.threaded` is
			// not a client-side habit that can be relaxed; it is the client's
			// faithful mirror of a capability the engine does not have for
			// odp/pptx, and dropping it would ship a menu row that silently
			// does nothing:
			//   - the flag arrives from core, not from us. SdXImpressDocument's
			//     comment serialiser (sd/source/ui/unoidl/unomodel.cxx, the
			//     getPostIts JSON writer) emits "threaded" and "resolved" only
			//     inside `if (xAnnotation->IsThreaded())`, so for a normal
			//     presentation the key is simply absent;
			//   - IsThreaded() is set for Impress in exactly two places, both
			//     PDF: the import filter (sd/source/filter/pdf/sdpdffilter.cxx)
			//     and new annotations created while the open document came from
			//     a *_pdf_import filter (AnnotationManagerImpl at the
			//     createAnnotation site). Nothing in the odp/pptx path sets it,
			//     and ExecuteReplyToAnnotation does not set it either -- an
			//     Impress reply rewrites one annotation's text rather than
			//     adding a child, so replying never creates a thread;
			//   - the slot itself refuses. AnnotationManagerImpl::
			//     ExecuteResolveAnnotation returns early on !IsThreaded()
			//     before touching SetResolved, so .uno:ResolveComment on a
			//     pptx/odp comment is a no-op that sends no notification back;
			//   - and there is nowhere to keep the answer even if it were set:
			//     `resolved` round-trips for Writer annotations only
			//     (xmloff/source/text/txtflde.cxx writes loext:resolved) and
			//     for PDF export via PDFNote::mbResolved, again gated on
			//     IsThreaded(). No Impress export writes it.
			// Closing this row is an engine change (give sd annotations real
			// child comments, or a resolved bit that persists), not a client
			// one. Ungating here would only put a dead control on the card.
			const isNonWriterComponent = ['spreadsheet', 'drawing', 'presentation'].includes(docLayer._docType);
			if (canModerate
				&& (docLayer._docType === 'text' || (isNonWriterComponent && data.threaded))
				&& isShown('.uno:ResolveComment'))
				entries.push({
					text: data.resolved === 'false' ? _('Resolve') : _('Unresolve'),
					type: 'action', id: 'resolve', pos: String(pos++),
				});

			if (docLayer._docType === 'text' && this.isRootComment() && canModerate
				&& isShown('.uno:ResolveCommentThread'))
				entries.push({
					text: listSection.isThreadResolved(this) ? _('Unresolve Thread') : _('Resolve Thread'),
					type: 'action', id: 'resolveThread', pos: String(pos++),
				});

			if (docLayer._docType === 'text' && !this.isRootComment() && isAuthor
				&& isShown('.uno:PromoteComment'))
				entries.push({ text: _('Promote to top comment'), type: 'action', id: 'promote', pos: String(pos++) });

			if (docLayer._docType === 'text' && !window.mode.isSmallScreenDevice()) {
				const isShownBig = listSection.isShownBig(this);
				entries.push({
					text: isShownBig ? _('Show on the side') : _('Open in full view'),
					type: 'action', id: 'showBigger', pos: String(pos++),
				});
			}

			if ((docLayer._docType === 'text' || docLayer._docType === 'spreadsheet')
				&& !window.mode.isSmallScreenDevice())
				entries.push({ text: _('Show in navigator'), type: 'action', id: 'showInNavigator', pos: String(pos++) });
		}

		if (entries.length === 0)
			return;

		const menuEl = this.sectionProperties.menu;
		menuEl._onDropDown = function (open: boolean) {
			this.sectionProperties.contextMenu = open;
		}.bind(this);

		if (window.mode.isSmallScreenDevice()) {
			const menu: any[] = [];
			entries.forEach((entry: any) => {
				menu.push({
					name: entry.text,
					command: entry.text,
					callback: () => {
						this.handleMenuAction(entry.id);
						if (entry.id !== 'reply' && entry.id !== 'modify')
							app.map.fire('mobilewizardback');
					},
				});
			});
			const menuData =
				window.L.Control.JSDialogBuilder.getMenuStructureForMobileWizard(
					menu,
					true,
					'',
				);
			app.map.fire('mobilewizard', { data: menuData });
			return;
		}

		const dropdownId = 'comment-menu-' + data.id;
		const callback = function (_objectType: string, eventType: string, _object: any, _data: any, entry: any) {
			if (eventType !== 'selected')
				return false;
			// reply and modify set focus on the comment textbox
			// tell the dropdown not to restore focus in those cases
			const focusHandled = entry?.id === 'reply' || entry?.id === 'modify';
			JSDialog.CloseDropdown(dropdownId, focusHandled);
			this.handleMenuAction(entry?.id);
			return true;
		}.bind(this);

		JSDialog.OpenDropdown(
			dropdownId,
			menuEl,
			entries,
			callback,
			'',
			false,
			false,
			true,
		);
	}

	private handleMenuAction (id: string): void {
		const listSection = this.sectionProperties.commentListSection;
		switch (id) {
		case 'modify': listSection.modify(this); break;
		case 'reply': listSection.reply(this); break;
		case 'remove': listSection.remove(this.sectionProperties.data.id); break;
		case 'removeThread': listSection.removeThread(this.sectionProperties.data.id); break;
		case 'resolve': listSection.resolve(this); break;
		case 'resolveThread': listSection.resolveThread(this); break;
		case 'promote': listSection.promote(this); break;
		case 'showBigger': listSection.toggleShowBigger(this); break;
		case 'showInNavigator': listSection.showInNavigator(this); break;
		}
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	private onMouseClick (e: any): void {
		if (((<any>window).mode.isSmallScreenDevice() || (<any>window).mode.isTablet())
			&& this.map.getDocType() == 'spreadsheet'
			&& !this.map.uiManager.mobileWizard.isOpen()) {
			this.hide();
		}
		window.L.DomEvent.stopPropagation(e);
		this.sectionProperties.commentListSection.click(this);
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	public onCommentKeyDown(e: KeyboardEvent): void {
		if (!(<any>window).mode.isDesktop()) {
			return;
		}

		if (this.isCtrlEnter(e)) {
			e.preventDefault();
			e.stopPropagation();
			this.handleCommentCtrlEnter(e);
			return;
		}

		if (e.keyCode === 27 /* Esc */) {
			// When a comment is being edited and focus is in the textbox,
			// Esc should not close it but mark it with attention.
			const editingComment = Comment.isAnyEdit();
			if (editingComment) {
				e.preventDefault();
				e.stopPropagation();
				this.sectionProperties.commentListSection
					.addCommentAttention(editingComment);
			}
			return;
		}

		if (e.keyCode === 33 || e.keyCode === 34) {
			this.handleCommentPageNav(e);
			return;
		}
	}

	/**
	 * Workaround for Chrome desktop bug where PageUp/PageDown in a textarea
	 * scrolls the page instead of moving the caret.
	 * https://issues.chromium.org/issues/41417806
	 */
	private handleCommentPageNav(e: KeyboardEvent): void {
		window.L.DomEvent.preventDefault(e);
		const target = e.target as HTMLTextAreaElement;
		const pos = e.keyCode === 33 ? 0 : target.textLength;
		const currentPos = target.selectionStart;
		if (e.shiftKey) {
			const [start, end] = currentPos <= pos
				? [currentPos, pos]
				: [pos, currentPos];
			target.setSelectionRange(
				start, end,
				currentPos > pos ? 'backward' : 'forward');
		} else {
			target.setSelectionRange(pos, pos);
		}
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	public handleReplyCommentButton (e: any): void {
		cool.CommentSection.autoSavedComment = null;
		cool.CommentSection.commentWasAutoAdded = false;
		this.textAreaInput(null);
		this.onReplyClick(e);
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	public onReplyClick (e: any): void {
		window.L.DomEvent.stopPropagation(e);
		if ((<any>window).mode.isSmallScreenDevice()) {
			this.sectionProperties.data.reply = this.sectionProperties.data.text;
			this.sectionProperties.commentListSection.saveReply(this);
		} else {
			this.removeLastBRTag(this.sectionProperties.nodeReplyText);
			this.sectionProperties.data.reply = this.sectionProperties.nodeReplyText.innerText;
			this.sectionProperties.data.html = this.sectionProperties.nodeReplyText.innerHTML;
			// Assigning an empty string to .innerHTML property in some browsers will convert it to 'null'
			// While in browsers like Chrome and Firefox, a null value is automatically converted to ''
			// Better to assign '' here instead of null to keep the behavior same for all
			this.sectionProperties.nodeReplyText.innerText = '';
			this.show();
			this.sectionProperties.commentListSection.saveReply(this);
		}
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	public handleCancelCommentButton (e: any): void {
		if (cool.CommentSection.commentWasAutoAdded) {
			app.sectionContainer.getSectionWithName(app.CSections.CommentList.name).remove(this.sectionProperties.data.id);
		}

		if (cool.CommentSection.autoSavedComment) {
			this.sectionProperties.contentText.origText = this.sectionProperties.contentText.uneditedText;
			this.sectionProperties.contentText.uneditedText = null;
			this.sectionProperties.contentText.origHTML = this.sectionProperties.contentText.uneditedHTML;
			this.sectionProperties.contentText.uneditedHTML = null;
		}

		// These lines are repeated in onCancelClick,
		// it makes things simple by not adding so many condition for different apps and different situation
		// It is mandatory to change these values before handleSaveCommentButton is called
		// calling handleSaveCommentButton in onCancelClick causes problem because that is also called from many other events/function (i.e: onPartChange)
		if (this.sectionProperties.contentText.origHTML) {
			this.sectionProperties.nodeModifyText.innerHTML = app.LOUtil.sanitize(this.sectionProperties.contentText.origHTML);
		}
		else {
			this.sectionProperties.nodeModifyText.innerText = this.sectionProperties.contentText.origText;
		}
		this.sectionProperties.nodeReplyText.innerText = '';

		if (cool.CommentSection.autoSavedComment)
			this.handleSaveCommentButton(e);

		this.onCancelClick(e);
		if (app.map._docLayer._docType === 'spreadsheet')
			this.hideCalc();
		cool.CommentSection.commentWasAutoAdded = false;
		cool.CommentSection.autoSavedComment = null;
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	public onCancelClick (e: any): void {
		if (e)
			window.L.DomEvent.stopPropagation(e);
		if (this.sectionProperties.contentText.origHTML) {
			this.sectionProperties.nodeModifyText.innerHTML = app.LOUtil.sanitize(this.sectionProperties.contentText.origHTML);
		}
		else {
			this.sectionProperties.nodeModifyText.innerText = this.sectionProperties.contentText.origText;
		}
		this.sectionProperties.nodeReplyText.innerText = '';
		if (app.map._docLayer._docType !== 'spreadsheet')
			this.show();
		this.sectionProperties.commentListSection.cancel(this);
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	public handleSaveCommentButton (e: any): void {
		cool.CommentSection.autoSavedComment = null;
		cool.CommentSection.commentWasAutoAdded = false;
		this.sectionProperties.contentText.uneditedText = null;
		this.sectionProperties.contentText.uneditedHTML = null;
		this.textAreaInput(null);
		this.onSaveComment(e);
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	public onSaveComment (e: any): void {
		this.sectionProperties.commentContainerRemoved = true;
		window.L.DomEvent.stopPropagation(e);
		this.removeLastBRTag(this.sectionProperties.nodeModifyText);
		this.sectionProperties.data.text = this.sectionProperties.nodeModifyText.innerText;
		this.sectionProperties.data.html = this.sectionProperties.nodeModifyText.innerHTML;
		this.updateContent();
		this.updateMetadata();
		if (!cool.CommentSection.autoSavedComment)
			this.show();
		this.sectionProperties.commentListSection.save(this);
	}

	// for some reason firefox adds <br> at of the end of text in contenteditable div
	// there have been similar reports: https://bugzilla.mozilla.org/show_bug.cgi?id=1615852
	private removeLastBRTag(element: HTMLElement) {
		if (!window.L.Browser.gecko)
			return;
		const brElements = element.querySelectorAll('br');
		if (brElements.length > 0)
			brElements[brElements.length-1].remove();
	}

	private isNodeEmpty(): boolean {
		this.removeLastBRTag(this.sectionProperties.nodeModifyText);
		if (this.sectionProperties.nodeModifyText.innerText == "" &&
			this.sectionProperties.nodeModifyText.innerHTML == "")
			return true;
		return false;
	}

	private updateControl(
		button: HTMLButtonElement | null,
		label: string,
		className: string
	): void {
		if (button) {
			button.value = label;
			button.classList.add(className);
		}
	}

	private updateSaveControls() {
		this.updateControl(this.sectionProperties.saveButton, _('Saved'), 'annotation-button-autosaved');
		this.updateControl(this.sectionProperties.cancelButton, _('Delete'), 'annotation-button-delete');
	}

	private updateReplyControls() {
		this.updateControl(this.sectionProperties.replyButton, _('Saved'), 'annotation-button-autosaved');
		this.updateControl(this.sectionProperties.cancelReplyButton, _('Delete'), 'annotation-button-delete');
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	public onLostFocus (e: any): void {

		if (!this.isEdit() || this.sectionProperties.container.contains(e.relatedTarget))
			return;
		if (this.sectionProperties.nodeReply.contains(e.target)) {
			this.onLostFocusReply(e);
			return;
		}

		if (app.map._docLayer._docType === 'text' && this.map.mention?.isTypingMention()) {
			return;
		}
		if (!this.sectionProperties.commentContainerRemoved) {
			$(this.sectionProperties.container).removeClass('annotation-active reply-annotation-container modify-annotation-container');
			this.removeLastBRTag(this.sectionProperties.nodeModifyText);
			if (this.sectionProperties.contentText.origText !== this.sectionProperties.nodeModifyText.innerText ||
			    this.sectionProperties.contentText.origHTML !== this.sectionProperties.nodeModifyText.innerHTML) {
				if(!document.hasFocus())
					app.definitions.CommentSection.needFocus = this;
				if (!this.sectionProperties.contentText.uneditedHTML)
					this.sectionProperties.contentText.uneditedHTML = this.sectionProperties.contentText.origHTML;
				if (!this.sectionProperties.contentText.uneditedText)
					this.sectionProperties.contentText.uneditedText = this.sectionProperties.contentText.origText;
				cool.CommentSection.autoSavedComment = this;
				this.onSaveComment(e);
			}
			else if (this.containerObject.testing) {
				var insertButton = document.getElementById('menu-insertcomment');
				if (insertButton) {
					if (window.getComputedStyle(insertButton).display === 'none') {
						this.onCancelClick(e);
					}
				}
			}
			else if (app.map._docLayer._docType === 'text' && this.isNodeEmpty())
				this.onCancelClick(e);
		}
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	public onLostFocusReply (e: any): void {
		if (app.map._docLayer._docType === 'text' && this.map.mention?.isTypingMention()) {
			return;
		}
		if (this.sectionProperties.nodeReplyText.innerText !== '') {
			if(!document.hasFocus())
				app.definitions.CommentSection.needFocus = this;
			if (!this.sectionProperties.contentText.uneditedHTML)
				this.sectionProperties.contentText.uneditedHTML = this.sectionProperties.contentText.origHTML;
			if (!this.sectionProperties.contentText.uneditedText)
				this.sectionProperties.contentText.uneditedText = this.sectionProperties.contentText.origText;
			cool.CommentSection.autoSavedComment = this;
			this.onReplyClick(e);
		}
		else {
			this.sectionProperties.nodeReply.style.display = 'none';
			if (!this.sectionProperties.nodeModify || this.sectionProperties.nodeModify.style.display === 'none') {
				this.cachedIsEdit = false;
				if (app.map._docLayer._docType !== 'spreadsheet') {
					this.setContainerPos(true);
				}
			}
		}
	}

	private resetControl(
		button: HTMLButtonElement | null,
		label: string,
		className: string
	): void {
		if (button) {
			button.value = label;
			button.classList.remove(className);
		}
	}

	private resetSaveControls(): void {
		this.resetControl(this.sectionProperties.saveButton, _('Save'), 'annotation-button-autosaved');
		this.resetControl(this.sectionProperties.cancelButton, _('Cancel'), 'annotation-button-delete');
	}

	private resetReplyControls(): void {
		this.resetControl(this.sectionProperties.replyButton, _('Reply'), 'annotation-button-autosaved');
		this.resetControl(this.sectionProperties.cancelReplyButton, _('Cancel'), 'annotation-button-delete');
	}

	public focus (): void {
		this.sectionProperties.container.classList.add('annotation-active');
		this.sectionProperties.nodeModifyText.focus({ focusVisible: true });
		this.sectionProperties.nodeReplyText.focus({ focusVisible: true });

		// set cursor at the last position on refocus after autosave
		if (this.isModifying() && this.sectionProperties.nodeModifyText.childNodes.length > 0) {
			var range = document.createRange()
			var sel = document.getSelection()
			range.setStartAfter(this.sectionProperties.nodeModifyText.lastChild)
			range.collapse(true)
			sel.removeAllRanges()
			sel.addRange(range)
		}

		this.resetSaveControls();
		this.resetReplyControls();
	}

	public focusLost (): void {
		this.updateSaveControls();
		this.updateReplyControls();
	}

	public reply (): Comment {
		this.sectionProperties.container.classList.add('reply-annotation-container');
		this.sectionProperties.container.style.visibility = '';
		this.sectionProperties.contentNode.style.display = '';
		this.sectionProperties.nodeModify.style.display = 'none';
		this.sectionProperties.nodeReply.style.display = '';
		this.cachedIsEdit = true;
		if (app.map._docLayer._docType !== 'spreadsheet') {
			this.setContainerPos(true);
		}
		return this;
	}

	public edit (): Comment {
		this.doPendingInitializationInView(true /* force */);
		this.sectionProperties.container.classList.add('modify-annotation-container');
		this.sectionProperties.nodeModify.style.display = '';
		this.sectionProperties.nodeReply.style.display = 'none';
		this.sectionProperties.container.style.visibility = '';
		this.sectionProperties.contentNode.style.display = 'none';
		this.cachedIsEdit = true;
		if (app.map._docLayer._docType !== 'spreadsheet') {
			this.setContainerPos(true);
		}
		return this;
	}

	public isEdit (): boolean {
		return this.cachedIsEdit;
	}

	public isModifying(): boolean {
		return !this.pendingInit && this.sectionProperties.nodeModify && this.sectionProperties.nodeModify.style.display !== 'none';
	}

	public static isAnyEdit (): Comment {
		var section = app.sectionContainer && app.sectionContainer instanceof CanvasSectionContainer ?
			app.sectionContainer.getSectionWithName(app.CSections.CommentList.name) : null;
		if (!section) {
			return null;
		}

		var commentList = section.sectionProperties.commentList;
		for (var i in commentList) {
			var modifyNode = commentList[i].sectionProperties.nodeModify;
			var replyNode = commentList[i].sectionProperties.nodeReply;
			if (!commentList[i].pendingInit &&
				((modifyNode && modifyNode.style.display !== 'none') ||
				(replyNode && replyNode.style.display !== 'none')))
					return commentList[i];
		}
		return null;
	}

	public static isAnyFocus(): boolean {
		const comment_: Comment = Comment.isAnyEdit();

		// We have a comment in edit mode. Is it focused?
		if (comment_ && (document.activeElement === comment_.sectionProperties.nodeModifyText || document.activeElement === comment_.sectionProperties.nodeReplyText))
			return true;

		return false;
	}

	public isDisplayed (): boolean {
		return (this.sectionProperties.container.style && this.sectionProperties.container.style.visibility === '');
	}

	public onResize (): void {
		this.updatePosition();
	}

	private isSelected(): boolean {
		return this.sectionProperties.commentListSection.sectionProperties.selectedComment === this;
	}

	/*
		point is the core pixel coordinate of the cursor.
		Not adjusted according to the view.
		For adjusting, we need to take document top left and documentAnchor top left into account.
		No need to do that for now.
	*/
	private checkIfCursorIsOnThisCommentWriter(newPosition: cool.SimpleRectangle) {
		if (this.sectionProperties.commentListSection.sectionProperties.show == false)
			return;

		const rectangles: cool.SimpleRectangle[] = this.sectionProperties.data.rectangles;

		for (var i: number = 0; i < rectangles.length; i++) {
			if (rectangles[i].containsPoint([newPosition.x1, newPosition.y1])) {
				if (!this.isSelected())
					this.sectionProperties.commentListSection.selectById(this.sectionProperties.data.id);

				this.stopPropagating();
				return;
			}
		}

		// If we are here, this comment is not selected.
		if (this.isSelected()) {
			if (this.isCollapsed)
				this.setCollapsed();
			this.sectionProperties.commentListSection.unselect();
		}
	}

	/// This event is Writer-only. Fired by CanvasSectionContainer.
	public onCursorPositionChanged(newPosition: cool.SimpleRectangle): void {
		if (this.sectionProperties.data.rectangles) {
			this.checkIfCursorIsOnThisCommentWriter(newPosition);
		}
	}

	/// This event is Calc-only. Fired by CanvasSectionContainer.
	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	public onCellAddressChanged(): void {
		if (this.sectionProperties.data.rectangles) {
			if (this.sectionProperties.data.rectangles[0].containsPoint(app.calc.cellCursorRectangle.center))
				this.sectionProperties.commentListSection.sectionProperties.calcCurrentComment = this;
			else if (this.isSelected()) {
				if (!this.sectionProperties.commentListSection.sectionProperties.doNotHideCommentTimer) {
					this.hide();
					this.sectionProperties.commentListSection.sectionProperties.calcCurrentComment = null;
				}
			}
			else if (this.sectionProperties.commentListSection.sectionProperties.calcCurrentComment == this)
				this.sectionProperties.commentListSection.sectionProperties.calcCurrentComment = null;
		}
	}

	private sendClickToCore(point: cool.SimplePoint, count: number) {
		/*
			On Calc, comments are shown when user focuses to the cell or moves the mouse pointer over the cell.
			Comment class (this class) covers the cell area. So the document is blocked now.
			We need to pass the click and double click events to the document.
		*/
		app.map._docLayer._postMouseEvent('buttondown', point.x, point.y, count, 1, 0);
		app.map._docLayer._postMouseEvent('buttonup', point.x, point.y, count, 1, 0);
		app.map.focus();
	}

	public onClick (point: cool.SimplePoint, e: MouseEvent): void {
		const docType = app.map._docLayer._docType;

		if (['presentation', 'drawing'].includes(docType)) {
			this.sectionProperties.commentListSection.selectById(this.sectionProperties.data.id);
			// This click selected the comment. Stop it from reaching the document
			// view, where the canvas-targeted listener would treat it as a click
			// outside the comment and close it again. The marker sub section stops
			// its own click for the same reason.
			e.stopPropagation();
			this.stopPropagating();
		}
		else if (docType === 'text') {
			app.activeDocument.mouseControl.onClick(this.toMouseControlLocal(point), e);
		}
		else if (docType === 'spreadsheet') {
			point.pX += this.position[0];
			point.pY += this.position[1];
			this.sendClickToCore(point, 1);
		}
	}

	public onDoubleClick(point: cool.SimplePoint, e: MouseEvent): void {
		if ('spreadsheet' === app.map._docLayer._docType) {
			point.pX += this.position[0];
			point.pY += this.position[1];
			this.sendClickToCore(point, 2);
		}
	}

	/*
		Writer phone indicator geometry, in the section-local core pixels
		onMouseUp is handed, or null when there is nothing to draw.

		One box for both jobs so the paint and the hit test cannot drift: onDraw
		fills a dot inside it, onMouseUp tests the whole of it.

		🔴 THE HEIGHT USED TO BE CLAMPED TO THE LINE AND THAT DEFEATED THE
		WHOLE 44 px FLOOR. This read

		    const size = Math.min(phoneTouchSize(), lineHeight, lineWidth);

		i.e. a SQUARE whose side was the smallest of the three. lineHeight is
		the smallest of the three on any ordinary body text: 11 pt at the zoom
		the phone reflow settles on is a ~20 CSS px line, so the touch floor of
		44 collapsed to 20 and the target was ~20x20 -- under a fifth of the
		area the 44 px floor advertises, and squarely in the range where a
		fingertip misses more often than it hits. The comment was present, the
		dot was painted, and it could not reliably be tapped: from the reader's
		side that is indistinguishable from the defect the indicator was added
		to fix.

		WHAT IS TRADED, STATED RATHER THAN HIDDEN. The two clamps were not the
		same kind of thing and they are not treated the same way.

		  - lineWidth STAYS. It is the promise that the box never reaches left
		    of the commented text into words this comment says nothing about.
		    A short range keeps a short target; that is correct, because a
		    two-character range IS a small thing to aim at, and widening it
		    would steal taps from its neighbours.

		  - lineHeight GOES, replaced by a floor. The box is now
		    phoneTouchSize() tall (or the line, when the line is taller) and
		    CENTRED on the line rather than hung from its top, so the overhang
		    is split: at a 20 CSS px line it reaches ~12 CSS px above and ~12
		    below, one line each way, inside a column at most 44 px wide at the
		    trailing end of the range. That is the cost, and it buys a target
		    that can be hit.

		Splitting the overhang is what keeps it to one line either side. Left
		hanging from the top, a 44 px box over a 20 px line reaches 24 px down
		-- more than a whole line pitch, so it could take taps from the line
		below AND the one after it.

		The section box has to grow with it or none of this is reachable:
		CanvasSectionContainer.findSectionContainingPoint -> isHit tests the
		section's own position/size first, so a hit box outside the section is
		a hit box nothing ever tests. setPositionAndSize applies exactly this
		pad; see phoneIndicatorVerticalPad.
	*/
	private phoneWriterIndicatorBox (): { x: number, y: number, width: number, height: number } | null {
		if (!Comment.usesPhoneCommentChrome())
			return null;
		if (app.map._docLayer._docType !== 'text')
			return null;

		const rectangles: Array<cool.SimpleRectangle> = this.sectionProperties.data.rectangles;
		if (!rectangles || !rectangles.length)
			return null;

		// The trailing corner of the range, which is where a reader looks for
		// "there is a note about this" -- Docs, Word and Pages all put it
		// after the commented words rather than before them.
		const last = rectangles[rectangles.length - 1];
		const lineHeight = Math.max(last.v4Y - last.v1Y, 1);
		const lineWidth = Math.max(last.v4X - last.v1X, 1);
		const width = Math.min(Comment.phoneTouchSize(), lineWidth);
		const height = Math.max(Comment.phoneTouchSize(), lineHeight);
		if (width <= 0 || height <= 0)
			return null;

		// v* are canvas-absolute core pixels; the section's own frame starts at
		// myTopLeft, which is what onDraw undoes with its translate and what
		// convertPositionToSectionLocale has already taken off the point
		// onMouseUp receives.
		return {
			x: last.v4X - width - this.myTopLeft[0],
			y: last.v1Y - Math.floor((height - lineHeight) / 2) - this.myTopLeft[1],
			width: width,
			height: height,
		};
	}

	/*
		CORE px the indicator box overhangs the comment's own rectangles above
		and below, and therefore the amount setPositionAndSize has to add to
		the section box so the container will route a tap there at all. Zero on
		every surface but phone Writer, so setPositionAndSize keeps its exact
		shipped geometry everywhere else.

		Read off rectanglesOriginal (twips) rather than rectangles (the
		SimpleRectangle view) because that is what setPositionAndSize already
		has in hand at the point it needs this; the two carry the same numbers
		(CommentListSection.stringToRectangles feeds both, Comment.setData only
		wraps one of them). Math.ceil, and only ever upward, so a rounding
		disagreement between the twips path and the v* path can leave the
		section box a pixel too BIG -- never a pixel too small, which is the
		direction that would clip the target it exists to expose.
	*/
	private phoneIndicatorVerticalPad (): number {
		if (!Comment.usesPhoneCommentChrome())
			return 0;
		if (app.map._docLayer._docType !== 'text')
			return 0;

		const rectangles = this.sectionProperties.data.rectanglesOriginal;
		if (!rectangles || !rectangles.length)
			return 0;

		const last = rectangles[rectangles.length - 1];
		const lineHeight = Math.max(last[3] * app.twipsToPixels, 1);
		return Math.max(0, Math.ceil((Comment.phoneTouchSize() - lineHeight) / 2));
	}

	// Should this comment show an on-canvas indicator at all? Mirrors the
	// visibility rule the cards follow (CommentSection.showHideComment): a
	// resolved comment is out unless resolved comments are being shown, and
	// nothing is drawn while the whole comment layer is switched off via
	// .uno:ShowAnnotations. `show` is null before the first setView, and a
	// null must not suppress the indicator -- that is the state a phone
	// Writer sits in at load, and suppressing there would reproduce exactly
	// the "loaded but never rendered" defect this is fixing.
	private phoneIndicatorIsVisible (): boolean {
		const listProps = this.sectionProperties.commentListSection.sectionProperties;
		if (listProps.show === false)
			return false;
		if (this.sectionProperties.data.resolved === 'true' && !listProps.showResolved)
			return false;
		if (this.sectionProperties.data.layoutStatus === CommentLayoutStatus.DELETED)
			return false;
		return true;
	}

	public onDraw (): void {
		if (this.sectionProperties.showSelectedCoordinate) {
			if (app.map._docLayer._docType === 'text') {
				const rectangles: Array<cool.SimpleRectangle> = this.sectionProperties.data.rectangles;
				if (rectangles) {
					this.context.translate(-this.myTopLeft[0], -this.myTopLeft[1]);

					this.context.fillStyle = this.sectionProperties.usedTextColor;
					this.context.globalAlpha = 0.25;

					for (let i = 0; i < rectangles.length;i ++) {
						const height = Math.max(rectangles[i].v4Y - rectangles[i].v1Y, 3);
						const width = Math.max(rectangles[i].v4X - rectangles[i].v1X, 3);
						this.context.fillRect(rectangles[i].v1X, rectangles[i].v1Y, width, height);
					}

					this.context.globalAlpha = 1;
					this.context.translate(this.myTopLeft[0], this.myTopLeft[1]);
				}
			}
			else if (app.map._docLayer._docType === 'spreadsheet' &&
				 parseInt(this.sectionProperties.data.tab) === app.map._docLayer._selectedPart &&
				 // Don't draw with stale section myTopLeft after a tab-switch.
				 // Wait for a 'commandstatechanged'.
				 this.sectionProperties.commentListSection.sectionProperties.calcCommandStateChanged === true) {

				// Anchor the indicator on the section's OWN box, not on
				// calcOptimumSizeForCalc(): on the phone chrome
				// setPositionAndSize sizes and right-anchors the section with
				// calcTouchSizeForCalc(), so the cell's right edge is at
				// section-local x = calcTouchSizeForCalc()[0]. Using the
				// optimum size here instead would slide the triangle left by
				// the difference. Off the phone chrome the two are the same
				// call, so this keeps the desktop pixel-identical -- and it
				// still recomputes rather than reading this.size, which may be
				// artificially wide after a mouseEnter with no mouseLeave.
				var cellSize = this.calcTouchSizeForCalc();
				if (cellSize[0] !== 0 && cellSize[1] !== 0) { // don't draw notes in hidden cells
					// `zoom` represents the current zoom level of the map, retrieved from `this.map.getZoom()`.
					// `baseSize` is a constant that defines the base size of the square at the initial zoom level.
					// `squareDim` calculates the dimension of the square, which dynamically adjusts based on the current zoom level.
					// The dimension increases proportionally to the zoom level by adding `zoom` to `baseSize`.
					var margin = 1;
					var baseSize = 2;
					var zoom = this.map.getZoom();
					var squareDim = baseSize + zoom;

					// PHONE: baseSize + zoom is CORE pixels, so on a dpr 3
					// phone the stock triangle lands at ~4 CSS px and measured
					// ~2. It is the whole of what tells a reader this cell
					// carries a comment. Paint it at phoneIndicatorSize(),
					// clamped to the cell so a narrow column or a short row
					// still gets a triangle that fits inside its own cell
					// rather than one that overruns the gridline.
					if (Comment.usesPhoneCommentChrome()) {
						squareDim = Math.max(squareDim, Comment.phoneIndicatorSize());
						squareDim = Math.min(squareDim, cellSize[0] - margin, cellSize[1]);
						squareDim = Math.max(squareDim, baseSize);
					}

					const isRTL = this.isCalcRTL();

					// this.size may currently have an artificially wide size if mouseEnter without moveLeave seen
					// so fetch the real size.
					// In RTL the section anchors at the cell's visual-right
					// edge and extends leftward (per CanvasSectionObject.isHit),
					// so the visual top-left corner of the cell sits at
					// section-local x = -cellSize[0].
					var x = isRTL ? -cellSize[0] + margin : cellSize[0] - squareDim - margin;
					var commentColor = getComputedStyle(document.body).getPropertyValue('--color-calc-comment');
					this.context.fillStyle = commentColor;
					var region = new Path2D();
					region.moveTo(x, 0);
					region.lineTo(x + squareDim, 0);
					region.lineTo(x + (isRTL ? 0 : squareDim), squareDim);
					region.closePath();
					this.context.fill(region);
				}
			}
		}

		// Last, so the dot sits on top of the 0.25-alpha range wash above
		// rather than under it, on the phones where both happen to paint.
		this.drawPhoneWriterIndicator();
	}

	/*
		Writer phone: paint the comment indicator.

		DELIBERATELY OUTSIDE the showSelectedCoordinate gate that wraps the
		rest of onDraw. That flag is set by showWriter() and cleared by
		hideWriter(), i.e. it tracks whether a comment CARD is on screen -- and
		on a phone no card is ever on screen, because Comment.onInitialize
		never puts the container in the document. Hanging the only phone hint
		off a desktop card's visibility is how "loaded and never rendered"
		happens. phoneIndicatorIsVisible() carries the rules that do apply
		(resolved, tracked-deletion, comment layer off).

		A filled dot, not the 0.25-alpha range wash the desktop paints: the
		wash marks WHICH WORDS are commented, which is worth 393 px of screen
		only when you can also read the comment; the dot says a comment is
		here and can be tapped, which is the thing the phone was missing.
	*/
	private drawPhoneWriterIndicator (): void {
		const box = this.phoneWriterIndicatorBox();
		if (!box || !this.phoneIndicatorIsVisible())
			return;

		// The dot is centred in the touch box and painted at the indicator
		// size, so the target is 44 px while the mark stays 14 px. Clamped to
		// the box's SHORTER side: the box is no longer square once the height
		// floor lifts it off a short line, and clamping to the longer side
		// would let a 14 px dot spill out of a narrower one.
		const dot = Math.min(Comment.phoneIndicatorSize(), box.width, box.height);
		const cx = box.x + box.width / 2;
		const cy = box.y + box.height / 2;

		this.context.save();
		this.context.fillStyle = this.sectionProperties.usedTextColor;
		this.context.beginPath();
		this.context.arc(cx, cy, dot / 2, 0, 2 * Math.PI);
		this.context.fill();
		// A hairline in the canvas clear colour separates the dot from text of
		// the same colour underneath it.
		this.context.strokeStyle = this.containerObject.getClearColor();
		this.context.lineWidth = Math.max(1, Math.round(app.dpiScale));
		this.context.stroke();
		this.context.restore();
	}

	// Comment-local + this.myTopLeft is the canvas-pixel coordinate; MouseControl
	// is bound to the tiles section and expects its argument in that section's
	// local frame, which is offset from canvas by the document anchor (e.g. the
	// ruler height in Writer). Without removing the anchor, forwarded events
	// drift by that amount.
	private toMouseControlLocal(point: cool.SimplePoint): cool.SimplePoint {
		const docAnchor = app.sectionContainer.getDocumentAnchor();
		const result = point.clone();
		result.pX += this.myTopLeft[0] - docAnchor[0];
		result.pY += this.myTopLeft[1] - docAnchor[1];
		return result;
	}

	// In Writer, a comment-highlighted region overlays the document. By default
	// this section would swallow mouse events, so neither a text selection drag
	// nor a plain hover started on top of a commented passage ever reaches core.
	// That means e.g. the tracked-change tooltip is never requested when the
	// change is also covered by a comment. Forward the drag lifecycle
	// (down/move/up) and hover moves to MouseControl while leaving click handling
	// to the existing onClick path.
	private forwardWriterMouseEventToCore(handler: 'onMouseDown' | 'onMouseMove' | 'onMouseUp', point: cool.SimplePoint, dragDistance: Array<number>, e: MouseEvent): void {
		const mousePoint = this.toMouseControlLocal(point);
		const mouseControl = app.activeDocument.mouseControl;
		if (handler === 'onMouseMove')
			mouseControl.onMouseMove(mousePoint, dragDistance, e);
		else if (handler === 'onMouseDown')
			mouseControl.onMouseDown(mousePoint, e);
		else
			mouseControl.onMouseUp(mousePoint, e);
	}

	public onMouseDown(point: cool.SimplePoint, e: MouseEvent): void {
		if (app.map._docLayer._docType === 'text')
			this.forwardWriterMouseEventToCore('onMouseDown', point, [0, 0], e);
	}

	public onMouseMove(point: cool.SimplePoint, dragDistance: Array<number>, e: MouseEvent): void {
		// Forward both drags (text selection) and plain hovers (so core can
		// request tooltips, e.g. for tracked changes under the comment).
		if (app.map._docLayer._docType === 'text')
			this.forwardWriterMouseEventToCore('onMouseMove', point, dragDistance, e);
	}

	public onMouseUp (point: cool.SimplePoint, e: MouseEvent): void {
		// A drag finishing on top of a commented region: let MouseControl
		// send the matching buttonup so core completes the selection.
		if (this.containerObject.isDraggingSomething() && app.map._docLayer._docType === 'text') {
			this.forwardWriterMouseEventToCore('onMouseUp', point, [0, 0], e);
			return;
		}

		// Hammer.js doesn't fire onClick event after touchEnd event.
		// CanvasSectionContainer fires the onClick event. But since Hammer.js is used for map, it disables the onClick for SectionContainer.
		// We will use this event as click event on touch devices, until we remove Hammer.js (then this code will be removed from here).
		// Control.ColumnHeader.js file is not affected by this situation, because map element (so Hammer.js) doesn't cover headers.
		if (!this.containerObject.isDraggingSomething() && (<any>window).mode.isSmallScreenDevice() || (<any>window).mode.isTablet()) {
			if (app.map._docLayer._docType === 'presentation' || app.map._docLayer._docType === 'drawing')
				app.map._docLayer._openCommentWizard(this);

			// WRITER PHONE READ ROUTE. Checked BEFORE onClick, because onClick
			// forwards a text tap to MouseControl to place a caret and this is
			// the one place in the range where the tap means something else.
			//
			// The cost, stated rather than hidden: a box at most 44 CSS px
			// wide, at the trailing end of the range's LAST rectangle, opens
			// the comment instead of placing a caret. It is 44 CSS px TALL
			// too, centred on that line, so on ordinary body text it also
			// takes ~12 CSS px of the line above and ~12 of the line below --
			// one line each way, in that one narrow column. Everything else in
			// the range, and every other line of it, still places a caret
			// exactly as before.
			//
			// That vertical overhang is deliberate and it is the second half
			// of this fix: clamping the box to the line height, which is what
			// shipped, made the target ~20x20 CSS px on the type a phone
			// actually renders and it could not be hit. A target you cannot
			// hit is the same defect as no target at all, which is what this
			// route was added to end.
			if (app.map._docLayer._docType === 'text'
				&& this.phoneIndicatorIsVisible()
				&& this.isPointInPhoneWriterIndicator(point)
				&& this.sectionProperties.commentListSection.openCommentOnPhone(this))
				return;

			this.onMouseEnter();
			this.onClick(point, e);

			// CALC PHONE READ ROUTE. After onClick, so core has had the tap and
			// moved the cell cursor onto the noted cell before the sheet opens
			// over it -- which also means the cell context menu that a
			// following long-press builds is evaluated against the right cell.
			//
			// Nothing steals a tap here: the section is at most a 44 px box
			// pinned inside the noted cell's right edge (calcTouchSizeForCalc),
			// so hitting it at all IS aiming at the indicator. Without this the
			// tap ended at onMouseEnter -> selectById -> select(), which styles
			// and repositions a DOM card that is not in the document on a
			// phone: the comment stayed invisible and the only affordance left
			// on the cell was "insert", i.e. an offer to write a second one.
			if (app.map._docLayer._docType === 'spreadsheet')
				this.sectionProperties.commentListSection.openCommentOnPhone(this);
		}
	}

	// Section-local hit test against phoneWriterIndicatorBox(). Same geometry
	// the dot is painted from, so the two cannot drift apart.
	private isPointInPhoneWriterIndicator (point: cool.SimplePoint): boolean {
		const box = this.phoneWriterIndicatorBox();
		if (!box)
			return false;
		return point.pX >= box.x && point.pX <= box.x + box.width
			&& point.pY >= box.y && point.pY <= box.y + box.height;
	}

	private calcContinueWithMouseEvent (): boolean {
		if (app.map._docLayer._docType === 'spreadsheet') {
			var conditions: boolean = !this.isEdit();
			if (conditions) {
				var sc = this.sectionProperties.commentListSection.sectionProperties.selectedComment;
				if (sc)
					conditions = sc.sectionProperties.data.id !== 'new';
			}
			return conditions;
		}
		else {
			return false;
		}
	}

	private calcCellSize(): number[] {
		var cellPos = app.map._docLayer._cellRangeToTwipRect(this.sectionProperties.data.cellRange).toRectangle();
		return [Math.round((cellPos[2]) * app.twipsToPixels), Math.round((cellPos[3]) * app.twipsToPixels)];
	}

	private calcOptimumSizeForCalc(): number[] {
		const size = this.calcCellSize();

		if (size[0] > this.sectionProperties.calcCommentAreaWidth) size[0] = this.sectionProperties.calcCommentAreaWidth;

		return size;
	}

	/*
		The Calc comment section's TOUCH box. Identical to
		calcOptimumSizeForCalc() everywhere except the Vulcan phone chrome.

		calcCommentAreaWidth is 40 CORE pixels, and it is capped there on
		purpose ("doesn't cover the whole cell, in order to allow multi-cell
		selections", constructor). On a dpr 3 phone 40 core px is 13 CSS px
		wide: the section that carries the comment's only on-canvas affordance
		is a 13 px strip, well under the 44 px floor the rest of this chrome
		holds to, which is why the corner triangle measured untappable rather
		than merely small.

		Widen it to the floor, and CLAMP TO THE CELL. Never past the cell:
		this section swallows the events it is hit by and hands them back to
		core (sendClickToCore), and a box that reached into the neighbouring
		cell would put that cell's taps through this comment's code path and
		pop this comment's sheet. Where a row is shorter than 44 px the cell
		itself is the ceiling and we stop there -- a short row cannot host a
		44 px target without stealing the row above or below, and stealing a
		row is worse than a 30 px target.

		Desktop and tablet get calcOptimumSizeForCalc() unchanged, so the
		hover-to-show behaviour keeps its exact geometry.
	*/
	private calcTouchSizeForCalc(): number[] {
		const size = this.calcOptimumSizeForCalc();
		if (!Comment.usesPhoneCommentChrome())
			return size;

		const cell = this.calcCellSize();
		const touch = Comment.phoneTouchSize();
		return [
			Math.min(Math.max(size[0], touch), cell[0]),
			Math.min(Math.max(size[1], touch), cell[1]),
		];
	}

	public onMouseEnter(): void {
		if (this.calcContinueWithMouseEvent()) {
			// When mouse is above this section, comment's HTML element will be shown.
			// If mouse pointer goes to HTML element, onMouseLeave event shouldn't be fired.
			// But mouse pointer will have left the borders of this section and onMouseLeave event will be fired.
			// Let's do it properly, when mouse is above this section, we will make this section's size bigger and onMouseLeave event will not be fired.
			if (parseInt(this.sectionProperties.data.tab) === app.map._docLayer._selectedPart) {
				var sc = this.sectionProperties.commentListSection.sectionProperties.selectedComment;
				if (sc) {
					if (!sc.isEdit())
						sc.hide();
					else
						return; // Another comment is being edited. Return.
				}

				if (Comment.usesPhoneCommentChrome()) {
					// The widening below exists so the pointer can travel from
					// the cell onto the card that popped up beside it without
					// crossing outside the section and firing onMouseLeave.
					// On a phone there is no pointer and no card beside the
					// cell -- the card is in the wizard sheet -- so there is no
					// journey to protect, and widening by the container's
					// measured width would blow the touch box out to the width
					// of the sheet. Keep the box we sized for the finger.
					this.size = this.calcTouchSizeForCalc();
				} else {
					var containerWidth: number = this.sectionProperties.container.getBoundingClientRect().width;
					var cellPos = app.map._docLayer._cellRangeToTwipRect(this.sectionProperties.data.cellRange).toRectangle();
					this.size = [Math.round((cellPos[2]) * app.twipsToPixels + containerWidth), Math.round((cellPos[3]) * app.twipsToPixels)];
				}
				this.sectionProperties.commentListSection.selectById(this.sectionProperties.data.id);
				this.show();
			}
		}
	}

	public onMouseLeave(point: cool.SimplePoint): void {
		if (this.calcContinueWithMouseEvent()) {
			if (parseInt(this.sectionProperties.data.tab) === app.map._docLayer._selectedPart) {
				// Revert the changes we did on "onMouseEnter" event. Reverts to
				// the touch box on the phone chrome, which is what
				// setPositionAndSize wrote and what the finger needs; identical
				// to calcOptimumSizeForCalc() everywhere else.
				this.size = this.calcTouchSizeForCalc();
				if (point) {
					this.hide();
				}
			}
		}
	}

	public onNewDocumentTopLeft (): void {
		this.doPendingInitializationInView();
		this.updatePosition();
	}

	public onCommentDataUpdate(): void {
		this.doPendingInitializationInView();
		this.updatePosition();
	}

	public onRemove (): void {
		this.sectionProperties.commentContainerRemoved = true;

		if (this.sectionProperties.onUpdatePermissionBound) {
			app.events.off('updatepermission', this.sectionProperties.onUpdatePermissionBound);
			this.sectionProperties.onUpdatePermissionBound = null;
		}

		if (this.sectionProperties.commentListSection.sectionProperties.selectedComment === this)
			this.sectionProperties.commentListSection.sectionProperties.selectedComment = null;

		this.sectionProperties.commentListSection.hideArrow();
		var container = this.sectionProperties.container;

		if (this.sectionProperties.commentMarkerSubSection !== null)
			app.sectionContainer.removeSection(this.sectionProperties.commentMarkerSubSection.name);

		if (this.sectionProperties.commentAnchorAreaSubSection !== null)
			app.sectionContainer.removeSection(this.sectionProperties.commentAnchorAreaSubSection.name);

		if (container && container.parentElement) {
			var c: number = 0;
			while (c < 10) {
				try {
					container.parentElement.removeChild(container);
					break;
				}
				catch (e) {
					c++;
				}
			}
		}
	}

	public isRootComment(): boolean {
		return this.sectionProperties.data.parent === '0';
	}

	public setAsRootComment(): void {
		this.sectionProperties.data.parent = '0';
		if (app.map._docLayer._docType === 'text')
			this.sectionProperties.data.parentId = '0';
	}

	public getChildrenLength(): number {
		return this.sectionProperties.children.length;
	}

	public getChildByIndex(index: number): Comment {
		if (this.sectionProperties.children.length > index)
			return this.sectionProperties.children[index];
		else
			return null;
	}

	public removeChildByIndex(index: number): void {
		if (this.sectionProperties.children.length > index)
			this.sectionProperties.children.splice(index, 1);
	}

	public getParentCommentId(): string {
		if (this.sectionProperties.data.parent && this.sectionProperties.data.parent !== '0')
			return this.sectionProperties.data.parent;
		else
			return null;
	}

	public getIndexOfChild(comment: Comment): number {
		return this.sectionProperties.children.indexOf(comment);
	}

	public getChildLevel(): number {
		if (this.isRootComment()) return 0;
		const parentComment = this.sectionProperties.commentListSection.getComment(this.getParentCommentId());
		if (parentComment) return parentComment.getChildLevel() + 1;
		return 1; // Comment list not fully initialized but we know we are not root
	}

	public getCommentHeight(invalidateCache: boolean = true): number {
		if (invalidateCache)
			this.cachedCommentHeight = null;
		if (this.cachedCommentHeight === null)
			this.cachedCommentHeight = this.sectionProperties.container.getBoundingClientRect().height
			- this.sectionProperties.childLinesNode.getBoundingClientRect().height;
		return this.cachedCommentHeight;
	}

	public setCollapsed(): void {
		this.isCollapsed = true;

		if (this.sectionProperties.commentListSection.sectionProperties.show != false && !this.isEdit()) {
			this.show();
			this.sectionProperties.commentListSection.removeCommentAttention(this);
		}

		if (this.isRootComment() || app.map._docLayer._docType === 'presentation' || app.map._docLayer._docType === 'drawing') {
			this.sectionProperties.container.style.display = '';
			this.sectionProperties.container.style.visibility = 'hidden';
		}
		this.updateThreadInfoIndicator();
		if (this.sectionProperties.data.resolved === 'false'
		|| this.sectionProperties.commentListSection.sectionProperties.showResolved
		|| app.map._docLayer._docType === 'presentation'
		|| app.map._docLayer._docType === 'drawing')
			window.L.DomUtil.addClass(this.sectionProperties.container, 'cool-annotation-collapsed-show');
	}

	public updateThreadInfoIndicator(replycount:number | string = -1): void {
		if (app.map._docLayer._docType === 'spreadsheet')
			return;

		var innerText;
		if (this.isEdit())
			innerText = '!';
		else if (replycount === '!' || typeof replycount === "number" && replycount > 0)
			innerText = replycount;
		else
			innerText = '';

		if (this.sectionProperties.collapsedInfoNode.innerText != innerText)
			this.sectionProperties.collapsedInfoNode.innerText = innerText;

		const containerVisible = this.isContainerVisible();
		if (innerText === '' || containerVisible)
			this.sectionProperties.collapsedInfoNode.style.display = 'none';
		else if (!containerVisible && innerText !== '')
			this.sectionProperties.collapsedInfoNode.style.display = '';
	}

	public setExpanded(): void {
		if (!this.isCollapsed)
			return;
		this.isCollapsed = false;
		if (app.map.getDocType() !== 'text' // Comments are resolved only in writer, always show in other apps
		|| this.sectionProperties.data.resolved === 'false'
		|| this.sectionProperties.commentListSection.sectionProperties.showResolved) {
			this.sectionProperties.container.style.display = '';
			// For presentations, only expand if the comment is on the active slide.
			if ((app.map.getDocType() !== 'presentation' && app.map.getDocType() !== 'drawing') || this.isInsideActivePart()) {
				this.sectionProperties.container.style.visibility = '';
			}
		}
		if (app.map._docLayer._docType === 'text')
			this.sectionProperties.collapsedInfoNode.style.display = 'none';
		window.L.DomUtil.removeClass(this.sectionProperties.container, 'cool-annotation-collapsed-show');
	}

	public selectText(startParagraph: number, startIndex: number, endParagraph: number, endIndex: number): void {
		const selection = window.getSelection();
		selection.removeAllRanges();

		const paragraphElements = Array.from(this.sectionProperties.contentText.firstChild.children);
		if (paragraphElements.length === 0) {
			return;
		}
		if (startParagraph > paragraphElements.length - 1 || endParagraph > paragraphElements.length - 1) {
			return;
		}

		// Find start position
		const startElement = paragraphElements[startParagraph] as HTMLElement;
		const startWalker = document.createTreeWalker(
			startElement,
			NodeFilter.SHOW_TEXT,
			null
		);
		const startTextNode = startWalker.nextNode();
		if (!startTextNode) {
			return;
		}

		// Find end position
		const endElement = paragraphElements[endParagraph] as HTMLElement;
		const endWalker = document.createTreeWalker(
			endElement,
			NodeFilter.SHOW_TEXT,
			null
		);
		const endTextNode = endWalker.nextNode();
		if (!endTextNode)
			return;

		// Create and apply the selection range
		const range = document.createRange();
		range.setStart(startTextNode, startIndex);
		range.setEnd(endTextNode, endIndex);

		selection.addRange(range);

		// Ensure the selection is visible
		this.sectionProperties.contentText.focus();
	}

	public autoCompleteMention(username: string, profileLink: string, replacement: string): void {
		const selection = window.getSelection();
		if (!selection)
			return;

		const editorElement = this.getActiveEditorElement();
		let range: Range | null = null;
		if (selection.rangeCount) {
			const candidateRange = selection.getRangeAt(0);
			if (
				!editorElement ||
				editorElement.contains(candidateRange.startContainer)
			)
				range = candidateRange;
		}
		const container = range ? range.startContainer : null;
		let textNode: Text | null = null;
		let cursorPosition = range ? range.endOffset : 0;

		if (container && container.nodeType === Node.TEXT_NODE) {
			textNode = container as Text;
		} else if (!range) {
			if (!editorElement) return;
			const walker = document.createTreeWalker(
				editorElement,
				NodeFilter.SHOW_TEXT,
				null,
			);
			textNode = walker.nextNode() as Text | null;
			if (!textNode) {
				textNode = document.createTextNode('');
				editorElement.appendChild(textNode);
			}
			cursorPosition = textNode.textContent?.length ?? 0;
		}

		const containerText = textNode?.textContent || container?.textContent || editorElement?.textContent || '';
		const mentionStart = containerText.lastIndexOf(replacement, cursorPosition);

		if (mentionStart !== -1) {
			const mentionEnd = mentionStart + replacement.length;

			const beforeMention = containerText.substring(0, mentionStart);
			const afterMention = containerText.substring(mentionEnd);

			const hyperlink = document.createElement('a');
			hyperlink.href = profileLink;
			hyperlink.textContent = `@${username}`;

			if (!textNode || !textNode.parentNode) {
				return;
			}

			textNode.textContent = beforeMention;
			textNode.parentNode?.insertBefore(hyperlink, textNode.nextSibling);

			const afterTextNode = document.createTextNode(afterMention);
			const extraSpaceNode = document.createTextNode('\u00A0');
			hyperlink.parentNode?.insertBefore(extraSpaceNode, hyperlink.nextSibling);
			hyperlink.parentNode?.insertBefore(afterTextNode, extraSpaceNode.nextSibling);

			const newRange = document.createRange();
			newRange.setStartAfter(extraSpaceNode);
			newRange.setEndAfter(extraSpaceNode);

			selection.removeAllRanges();
			selection.addRange(newRange);
		}
	}

	private getActiveEditorElement(): HTMLElement | null {
		if ((<any>window).mode.isSmallScreenDevice()) {
			const commentSection = app.sectionContainer.getSectionWithName(
				app.CSections.CommentList.name,
			);
			const isMobileCommentActive = commentSection?.isMobileCommentActive();
			if (!isMobileCommentActive) return null;
			const mobileCommentModalId = commentSection?.getMobileCommentModalId();
			return document.getElementById(mobileCommentModalId);
		}
		if (
			this.sectionProperties.nodeModify &&
			this.sectionProperties.nodeModify.style.display !== 'none'
		)
			return this.sectionProperties.nodeModifyText;
		if (
			this.sectionProperties.nodeReply &&
			this.sectionProperties.nodeReply.style.display !== 'none'
		)
			return this.sectionProperties.nodeReplyText;
		return (
			this.sectionProperties.nodeModifyText ||
			this.sectionProperties.nodeReplyText ||
			null
		);
	}

	public onContextMenu(point: cool.SimplePoint, e: MouseEvent): void {
		Util.ensureValue(app.activeDocument);
		Util.ensureValue(app.activeDocument.mouseControl);

		const viewed = app.activeDocument.activeLayout.viewedRectangle;
		const anchor = this.containerObject.getDocumentAnchor();
		point.pX = this.myTopLeft[0] + point.pX + viewed.pX1 - anchor[0];
		point.pY = this.myTopLeft[1] + point.pY + viewed.pY1 - anchor[1];
		app.activeDocument.mouseControl.setMousePosition(point);
		app.activeDocument.mouseControl.onContextMenu(point, e);
	}
}

}

app.definitions.Comment = cool.Comment;
