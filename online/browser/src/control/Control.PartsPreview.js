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
/*
 * window.L.Control.PartsPreview
 */

/* global _ app $ Hammer _UNO cool JSDialog VulcanFilmstripFollow VulcanLiveCanvas */
window.L.Control.PartsPreview = window.L.Control.extend({
	options: {
		fetchThumbnail: true,
		autoUpdate: true,
		imageClass: '',
		frameClass: '',
		axis: '',
		allowOrientation: true,
		maxWidth: window.mode.isDesktop() ? 180: (window.mode.isTablet() ? 120: 60),
		maxHeight: window.mode.isDesktop() ? 180: (window.mode.isTablet() ? 120: 60),
		// The phone card strip paints a fixed-height card, not a square box:
		// vulcan-theme.css §13i.4 gives .preview-img height 58px inside a
		// 128px width cap. Asking for that box makes the aspect fit in
		// Parts.getPreview() return the card the CSS already reserves room
		// for, so the inline width/height it writes agree with the sheet
		// instead of overriding it. Keep these two numbers equal to §13i.4.
		phoneCardMaxWidth: 128,
		phoneCardHeight: 58
	},
	partsFocused: false,

	initialize: function (container, preview, options) {
		window.L.setOptions(this, options);

		if (!container) {
			container = window.L.DomUtil.get('presentation-controls-wrapper');
		}

		if (!preview) {
			preview = window.L.DomUtil.get('slide-sorter');
		}

		this._container = container;
		this._partsPreviewCont = preview;
		this._partsPreviewCont.setAttribute('role', 'listbox');
		this._partsPreviewCont.setAttribute('aria-multiselectable', 'true');
		this._partsPreviewCont.onscroll = this._onScroll.bind(this);
		this._idNum = 0;
		this._width = 0;
		this._height = 0;
		this.scrollTimer = null;
		this._menuPosEl = null;
		this.partsFocusedApplied = false;
		this._dragState = null;
		this._phoneSlideSelectionMode = false;
		this._phoneDeleteUndoSelection = null;
		this._phoneSlideSuppressedClick = null;
		this._phoneSlideSuppressedClickTimer = null;
		this._previewTouchGesture = null;
		// Part hashes of the preview requests that are under way, keyed by
		// the part index the request was made with.
		this._pendingPreviewHashes = {};
		// Which of the two card geometries the previews are currently sized
		// to (see _previewRequestBox). Stays false off the phone strip, so
		// the rotation re-fit in _resize can never fire there.
		this._phoneCardStripApplied = false;

		// A click clears the slide sorter focus mode, unless that same click
		// re-focused a preview.
		document.addEventListener('click', () => {
			this.partsFocusedApplied = false;
		}, true);
		document.body.addEventListener('click', () => {
			if (!this.partsFocusedApplied && this.partsFocused)
				this.partsFocused = false;
		});

		// R6-6: edit entry SHOWS the phone strip (vulcan-theme.css 13i.1c
		// hides it for the whole read posture) — load its cards then. Same
		// registration shape as ImpressTileLayer's own permission listener;
		// lives for the document session like the control itself. Here and
		// not in onAdd: onAdd is lifted as source text by
		// ImpressMasterThemeInvalidation's map-event harness, which stubs
		// only the map contract.
		app.events.on('updatepermission', this._onVulcanPermissionChanged.bind(this));
	},

	onAdd: function (map) {
		this._previewInitialized = false;
		this._previewTiles = [];
		this._sectionHeaders = []; // Section header DOM elements
		this._collapsedSections = new Set(); // Names of sections collapsed by the user
		this._direction = this.options.allowOrientation ?
			(!window.mode.isDesktop() && window.L.DomUtil.isPortrait() ? 'x' : 'y') :
			this.options.axis;

		map.on('updateparts', this._updateDisabled, this);
		map.on('beforeundocommand', this._onPhoneUndoCommand, this);
		map.on('updatepart', this._updatePart, this);
		map.on('invalidateparts', this._invalidateParts, this);
		map.on('tilepreview', this._updatePreview, this);
		map.on('insertpage', this._insertPreview, this);
		map.on('deletepage', this._deletePreview, this);
		map.on('scrolllimit', this._invalidateCurrentPart, this);
		map.on('scrolllimits', this._invalidateParts, this);
		map.on('scrolltopart', this._scrollToPart, this);
		map.on('beforerequestpreview', this._beforeRequestPreview, this);
		map.on('updatesections', this._updateSections, this);
		// Slide-presence dots: repaint when a remote view changes slide,
		// joins, leaves, or the filmstrip rebuilds.
		map.on('vulcanviewparts addview removeview updateparts', this._updatePresenceDots, this);
		map.on('docloaded', this._focusCurrentSlideOnLoad, this);
		// A growing canvas can reveal a lazy card without scrolling the sorter.
		map.on('sizeincreased', this._onScroll, this);

		window.addEventListener('resize', window.L.bind(this._resize, this));
	},

	createScrollbar: function () {
		this._partsPreviewCont.style.whiteSpace = 'nowrap';
	},

	_updateDisabled: function () {
		this._reconcilePhoneSlideSelectionMode();
		this._reconcilePhoneDeleteUndoSelection();
		const selectedPart = app.map._docLayer._selectedPart;

		const docType = app.map._docLayer._docType;

		if (docType === 'presentation' || docType === 'drawing') {
			if (!this._previewInitialized)
			{
				// Draw documents have pages, presentations have slides.
				this._partsPreviewCont.setAttribute('aria-label',
					docType === 'drawing' ? _('Pages') : _('Slides'));

				// make room for the preview
				var docContainer = this._map.options.documentContainer;

				if (!window.L.DomUtil.hasClass(docContainer, 'parts-preview-document'))
					window.L.DomUtil.addClass(docContainer, 'parts-preview-document');

				this._addContainerDnDHandlers();

				// Add a special frame just as a drop-site for reordering.
				var frameClass = 'preview-frame ' + this.options.frameClass;
				var frame = window.L.DomUtil.create('div', frameClass, this._partsPreviewCont);
				this._addDnDHandlers(frame);
				frame.setAttribute('draggable', false);
				frame.setAttribute('id', 'first-drop-site');
				// reorder-only drop target, not a slide - keep it out of the listbox
				frame.setAttribute('aria-hidden', 'true');

				if (window.mode.isDesktop()) {
					window.L.DomUtil.setStyle(frame, 'height', '20px');
					window.L.DomUtil.setStyle(frame, 'margin', '0em');
				}

				// Create the preview parts
				for (var i = 0; i < app.impress.partList.length; i++) {
					this._previewTiles.push(this._createPreview(i, app.impress.partList[i].hash));
				}
				window.L.DomUtil.addClass(this._previewTiles[selectedPart], 'preview-img-currentpart');
				this._ensureVisiblePreviews(); // Load previews.
				this._previewInitialized = true;
				this._updateSelectedSection();
			}
			else
			{
				this._syncPreviews();

				if (!app.file.fileBasedView) {
					// change the border style of the selected preview.
					for (let j = 0; j < app.impress.partList.length; j++) {
						window.L.DomUtil.removeClass(this._previewTiles[j], 'preview-img-currentpart');
						window.L.DomUtil.removeClass(this._previewTiles[j], 'preview-img-selectedpart');
						if (j === selectedPart)
							window.L.DomUtil.addClass(this._previewTiles[j], 'preview-img-currentpart');
						else if (app.impress.partList[j].selected)
							window.L.DomUtil.addClass(this._previewTiles[j], 'preview-img-selectedpart');
					}
				}
				this._updateSelectedSection();
			}

			this._updateA11ySelection();

			if (!this.options.allowOrientation) {
				return;
			}

			// update portrait / landscape
			var removePreviewImg = 'preview-img-portrait';
			var addPreviewImg = 'preview-img-landscape';
			var removePreviewFrame = 'preview-frame-portrait';
			var addPreviewFrame = 'preview-frame-landscape';
			if (window.L.DomUtil.isPortrait()) {
				removePreviewImg = 'preview-img-landscape';
				addPreviewImg = 'preview-img-portrait';
				removePreviewFrame = 'preview-frame-landscape';
				addPreviewFrame = 'preview-frame-portrait';
			}

			for (i = 0; i < app.impress.partList.length; i++) {
				window.L.DomUtil.removeClass(this._previewTiles[i], removePreviewImg);
				window.L.DomUtil.addClass(this._previewTiles[i], addPreviewImg);
				if (app.impress.isSlideHidden(i))
					window.L.DomUtil.addClass(this._previewTiles[i], 'hidden-slide');
				else
					window.L.DomUtil.removeClass(this._previewTiles[i], 'hidden-slide');
			}

			var previewFrame = $(this._partsPreviewCont).find('.preview-frame');
			previewFrame.removeClass(removePreviewFrame);
			previewFrame.addClass(addPreviewFrame);

			// re-create scrollbar with new direction
			this._direction = !window.mode.isDesktop() && !window.mode.isTablet() && window.L.DomUtil.isPortrait() ? 'x' : 'y';
		}
	},

	// Keep the listbox selection state current: aria-selected on every
	// selected slide, and the roving tab stop (tabindex 0) on the current one.
	_updateA11ySelection: function () {
		var selectedPart = this._map._docLayer._selectedPart;
		var partList = (app.impress && app.impress.partList) || [];
		var activeTab = (selectedPart >= 0 && selectedPart < this._previewTiles.length)
			? selectedPart : 0;
		for (var i = 0; i < this._previewTiles.length; i++) {
			var img = this._previewTiles[i];
			if (!img)
				continue;
			var selected = app.file.fileBasedView
				? i === activeTab
				: (i === selectedPart || (partList[i] && partList[i].selected));
			img.setAttribute('aria-selected', selected ? 'true' : 'false');
			img.setAttribute('tabindex', i === activeTab ? '0' : '-1');
		}
	},

	isPaddingClick: function (element, e, part) {
		var style = window.getComputedStyle(element, null);
		var nTop = parseInt(style.getPropertyValue('padding-top'));
		var nRight = parseFloat(style.getPropertyValue('padding-right'));
		var nLeft = parseFloat(style.getPropertyValue('padding-left'));
		var nBottom = parseFloat(style.getPropertyValue('padding-bottom'));
		var width = element.offsetWidth;
		var height = element.offsetHeight;
		var x = parseFloat(e.offsetX);
		var y = parseFloat(e.offsetY);

		if (part === 'top')         // Clicked on top padding?
			return !(y > nTop);
		else if (part === 'bottom') // Clicked on bottom padding?
			return !(y < height - nBottom);
		else                        // Clicked on any padding?
			return !((x > nLeft && x < width - nRight) && (y > nTop && y < height - nBottom));
	},

	_getMenuPosEl: function () {
		if (!this._menuPosEl) {
			this._menuPosEl = document.createElement('div');
			this._menuPosEl.id = 'slide-context-menu-pos';
			this._menuPosEl.style.position = 'absolute';
			this._container.appendChild(this._menuPosEl);
		}
		return this._menuPosEl;
	},

	// True only on the surface vulcan-theme.css §13i.1-13i.5 restyles: the
	// Google-Slides phone filmstrip. The conditions mirror that selector
	// exactly (html.vulcan-mobile-chrome + body[data-doctype='presentation'] +
	// #slide-sorter.portrait) because the point of the card box below is that
	// the inline size and the stylesheet describe the same card. Landscape
	// keeps the stock rail, whose device-mobile.css caps .preview-img at 60px
	// wide - a 58px-tall card there would be clamped in one axis only and
	// come out squashed.
	// True inside the Vulcan phone chrome, in either orientation: a
	// small-screen device AND the pre-paint html.vulcan-mobile-chrome marker
	// (js/global.js stamps it iff !desktopChrome && isSmallScreenDevice()).
	// Both halves matter -- ?vulcanChrome=desktop forces desktop chrome on a
	// phone-sized screen, and isTablet() is *defined* as
	// !isSmallScreenDevice(). Unlike _isPhoneCardStrip below this does not
	// require portrait or presentation: it gates what the chrome offers, not
	// how the filmstrip is laid out.
	_isVulcanPhoneChrome: function () {
		return !!(window.mode.isSmallScreenDevice() &&
			document.documentElement.classList.contains('vulcan-mobile-chrome'));
	},

	// The phone presentation card is the interaction target, not merely its
	// bitmap. In short landscape a 16:9 preview can be only 60x34 CSS pixels;
	// the frame supplies the accessible card box around it. Binding navigation
	// and long press to the frame makes that whole box live while preserving the
	// stock image-only owner for tablets, Draw, and forced desktop chrome.
	_getPreviewInteractionTarget: function (frame, img) {
		return this._isVulcanPhoneChrome() &&
			this._map && this._map.getDocType() === 'presentation' ? frame : img;
	},

	_isPhoneCardStrip: function () {
		return !!(window.mode.isSmallScreenDevice() &&
			document.documentElement.classList.contains('vulcan-mobile-chrome') &&
			this._map && this._map.getDocType() === 'presentation' &&
			window.L.DomUtil.isPortrait());
	},

	// Multi-select is a phone Impress interaction, in both orientations. Draw
	// shares PartsPreview but not the Google Slides selection contract.
	_isPhonePresentationSelectionSurface: function () {
		return !!(this._isVulcanPhoneChrome() &&
			this._map && this._map.getDocType() === 'presentation' &&
			this._map.isEditMode());
	},

	_setPhoneSlideSelectionMode: function (enabled) {
		enabled = !!enabled && this._isPhonePresentationSelectionSurface();
		this._phoneSlideSelectionMode = enabled;
		if (!this._partsPreviewCont)
			return;
		this._partsPreviewCont.classList.toggle('vulcan-slide-selection-mode', enabled);
		var baseLabel = this._map && this._map.getDocType() === 'drawing' ?
			_('Pages') : _('Slides');
		this._partsPreviewCont.setAttribute(
			'aria-label',
			enabled ? _('Slides, selection mode') : baseLabel,
		);
	},

	_reconcilePhoneSlideSelectionMode: function () {
		if (!this._phoneSlideSelectionMode)
			return;
		// One selected slide is the intentional initial state of this mode: the
		// long press arms it before the user taps a second card. Do not use a
		// later updateparts event with that same count as evidence that a deck
		// mutation collapsed the batch. Our mutation paths and the explicit
		// non-current toggle handle their own exits; reconciliation is the
		// safety net for losing the phone/edit/presentation surface.
		if (!this._isPhonePresentationSelectionSurface())
			this._exitPhoneSlideSelectionMode(false);
	},

	// Prepare the pressed card without switching away from an existing batch.
	// setPart is forbidden after mode entry: core's SwitchPage clears every
	// selected page before making the new current page selected.
	_preparePhoneSlidePress: function (partId) {
		if (!this._isPhonePresentationSelectionSurface())
			return false;
		// A new explicit selection supersedes any pending normalization from a
		// prior batch delete. Its later Undo must not collapse this new batch.
		if (!this._phoneSlideSelectionMode)
			this._phoneDeleteUndoSelection = null;
		if (this._phoneSlideSelectionMode) {
			if (!app.impress.isSlideSelected(partId))
				this._map.selectPart(partId, 1, false);
			return true;
		}
		this._map.deselectAll();
		this._map.setPart(partId);
		this._map.selectPart(partId, 1, false);
		return true;
	},

	_collapsePhoneSlideSelectionToCurrent: function () {
		var current = this._map._docLayer._selectedPart;
		this._map.deselectAll();
		// ChildSession ignores selectclientpart for the current page, which is
		// fine: core already keeps it selected. This restores the client model
		// without a setPart that would race and erase a new batch.
		this._map.selectPart(current, 1, false);
	},

	_exitPhoneSlideSelectionMode: function (collapse) {
		if (!this._phoneSlideSelectionMode)
			return;
		this._setPhoneSlideSelectionMode(false);
		if (collapse === false)
			return;
		this._collapsePhoneSlideSelectionToCurrent();
	},

	_handlePhoneSlideSelectionTap: function (partId) {
		if (!this._isPhonePresentationSelectionSurface() ||
			!this._phoneSlideSelectionMode)
			return false;
		var current = this._map._docLayer._selectedPart;
		if (partId === current) {
			this._exitPhoneSlideSelectionMode(true);
			return true;
		}
		this._map.selectPart(
			partId,
			app.impress.isSlideSelected(partId) ? 0 : 1,
			false,
		);
		// Core can report the current page separately from partList.selected,
		// but it remains the semantic anchor of the phone selection.
		var semanticSelectedCount = app.impress.getSelectedSlidesCount();
		if (!app.impress.isSlideSelected(current))
			semanticSelectedCount++;
		if (semanticSelectedCount <= 1)
			this._exitPhoneSlideSelectionMode(false);
		return true;
	},

	// Undo reinserts deleted slides but intentionally preserves the low-level
	// page-selection bits. On the phone those bits are hidden after the batch
	// action, yet a later Delete would still consume them. Wait until an
	// authoritative status first proves the deck shrank and then grew again;
	// a queued pre-delete status with the original count must never collapse
	// the batch before .uno:DeletePage consumes it.
	_reconcilePhoneDeleteUndoSelection: function () {
		var pending = this._phoneDeleteUndoSelection;
		if (!pending)
			return;
		if (!this._isPhonePresentationSelectionSurface()) {
			this._phoneDeleteUndoSelection = null;
			return;
		}
		var partList = app.impress && app.impress.partList;
		if (!partList || !partList.length)
			return;
		var partCount = partList.length;
		if (pending.minimumCount === null) {
			if (partCount < pending.beforeCount)
				pending.minimumCount = partCount;
			else if (partCount > pending.beforeCount)
				this._phoneDeleteUndoSelection = null;
			return;
		}
		// Core emits a status for each removed or reinserted page, so a batch
		// can report 3 -> 2 -> 1 and Undo 1 -> 2 -> 3. Keep the shrink floor
		// through those intermediate frames and accept only the original count
		// as restoration.
		if (partCount < pending.minimumCount) {
			pending.minimumCount = partCount;
			return;
		}
		if (partCount === pending.minimumCount)
			return;
		if (!pending.undoRequested) {
			this._phoneDeleteUndoSelection = null;
			return;
		}
		if (partCount < pending.beforeCount)
			return;

		this._phoneDeleteUndoSelection = null;
		if (partCount === pending.beforeCount)
			this._collapsePhoneSlideSelectionToCurrent();
	},

	_onPhoneUndoCommand: function () {
		if (this._phoneDeleteUndoSelection &&
			this._isPhonePresentationSelectionSurface())
			this._phoneDeleteUndoSelection.undoRequested = true;
	},

	// Deck mutations end the transient phone selection posture, but must not
	// collapse the selected pages first: the action has already consumed that
	// selection and its resulting insert/delete/update will reconcile it.
	_phoneDeckMutationCompleted: function (preserveDeleteReconciliation) {
		if (!preserveDeleteReconciliation)
			this._phoneDeleteUndoSelection = null;
		this._exitPhoneSlideSelectionMode(false);
	},

	_deleteSlidesFromCardMenu: function () {
		if (!this._phoneSlideSelectionMode ||
			!this._isPhonePresentationSelectionSurface()) {
			app.dispatcher.dispatch('deletepage');
			return;
		}

		// Google Slides removes the selected slide batch immediately. This is
		// still recoverable: map.deletePage dispatches .uno:DeletePage, whose
		// Impress handler groups every selected page removal into one undo step;
		// the phone edit top bar keeps .uno:Undo directly exposed.
		this._phoneDeleteUndoSelection = {
			beforeCount: app.impress.partList.length,
			minimumCount: null,
			undoRequested: false,
		};
		this._map.deletePage();
		this._phoneDeckMutationCompleted(true);
	},

	_runPhoneSlideMutationAction: function (entryId, part) {
		switch (entryId) {
		case 'paste':
			this._pasteSlide(part);
			return true;
		case 'newslide':
			this._map.insertPage();
			this._phoneDeckMutationCompleted();
			return true;
		case 'duplicateslide':
			this._map.duplicatePage();
			this._phoneDeckMutationCompleted();
			return true;
		case 'delete':
			this._deleteSlidesFromCardMenu();
			return true;
		default:
			return false;
		}
	},

	_armPhoneSlideCompatibilityClickSuppression: function (img, e) {
		if (e && e.preventDefault)
			e.preventDefault();
		if (e && e.originalEvent && e.originalEvent.preventDefault)
			e.originalEvent.preventDefault();
		clearTimeout(this._phoneSlideSuppressedClickTimer);
		this._phoneSlideSuppressedClick = img;
		this._phoneSlideSuppressedClickTimer = setTimeout(function () {
			if (this._phoneSlideSuppressedClick === img)
				this._phoneSlideSuppressedClick = null;
		}.bind(this), 700);
	},

	_consumePhoneSlideCompatibilityClick: function (img, e) {
		if (this._phoneSlideSuppressedClick !== img)
			return false;
		clearTimeout(this._phoneSlideSuppressedClickTimer);
		this._phoneSlideSuppressedClickTimer = null;
		this._phoneSlideSuppressedClick = null;
		if (e && e.preventDefault)
			e.preventDefault();
		if (e && e.stopPropagation)
			e.stopPropagation();
		return true;
	},

	_completePhoneSlideLongPress: function (img, e) {
		this._armPhoneSlideCompatibilityClickSuppression(img, e);
		this._openCardMenuFromPress(img, e);
	},

	_shouldUpdatePhoneTouchDrag: function (state, clientX, clientY) {
		if (!state.touchOrigin || state.touchDragStarted)
			return true;
		var deltaX = clientX - state.touchOrigin.x;
		var deltaY = clientY - state.touchOrigin.y;
		// Ten CSS pixels keeps normal finger jitter in long-press territory.
		// Once crossed, the decision is latched so returning toward the origin
		// cannot turn a real reorder back into a menu-opening press.
		if (deltaX * deltaX + deltaY * deltaY < 100)
			return false;
		state.touchDragStarted = true;
		return true;
	},

	// The box every preview request is fitted into. Parts.getPreview() shrinks
	// it to the slide's aspect ratio and returns what it settled on, which is
	// what gets written to the img as an inline size.
	_previewRequestBox: function () {
		if (this._isPhoneCardStrip())
			return { maxWidth: this.options.phoneCardMaxWidth, maxHeight: this.options.phoneCardHeight };

		return { maxWidth: this.options.maxWidth, maxHeight: this.options.maxHeight };
	},

	_handlePreviewInteractionClick: function (e, frame, img) {
		// The frame stays pointer-active so its first touch can continue to send
		// move/end events. Consume any second pointer/click while that gesture is
		// live instead of changing the selection under its drag state.
		if (this._previewTouchGesture) {
			window.L.DomEvent.stopPropagation(e);
			window.L.DomEvent.stop(e);
			return;
		}
		if (this._consumePhoneSlideCompatibilityClick(img, e))
			return;
		window.L.DomEvent.stopPropagation(e);
		window.L.DomEvent.stop(e);
		var part = this._findClickedPart(frame);
		// _findClickedPart reports "no frame here" as -1, never as null.
		if (part !== -1)
			var partId = parseInt(part) - 1; // The first part is just a drop-site for reordering.
		if (part !== -1 && this._handlePhoneSlideSelectionTap(partId)) {
			img.focus();
			return;
		}
		if (!window.mode.isDesktop() && partId === this._map._docLayer._selectedPart && !app.file.fileBasedView) {
			// A second tap opens the phone format sheet or the tablet Property deck.
			if (this._map._permission === 'edit') {
				// Remove object selection so the slide properties are targeted.
				app.socket.sendMessage('resetselection');
				setTimeout(function () {
					if (window.mode.isSmallScreenDevice())
						app.dispatcher.dispatch('mobile_wizard');
					else
						app.map.sendUnoCommand('.uno:SidebarDeck.PropertyDeck');
				}, 0);
			}
		} else {
			this._setPart(e, frame);
			if (!window.mode.isDesktop()) {
				// needed so on-screen keyboard doesn't pop up when switching slides,
				// but would cause PgUp/Down to not work on desktop in slide sorter
				document.activeElement.blur();
			}
		}
		img.focus();
	},

	// Colored dots on a slide's preview frame for the OTHER views sitting
	// on that slide — collaborators used to type slide numbers at each
	// other. Inline-styled so both chromes render it; the data source is
	// the docLayer's _vulcanViewParts map, fed by the per-view messages
	// that already carry a part.
	_updatePresenceDots: function () {
		if (!this._map || !VulcanLiveCanvas.isCanvasDocType(this._map.getDocType())) return;
		var docLayer = this._map._docLayer;
		var viewParts = (docLayer && docLayer._vulcanViewParts) || {};
		var viewInfo = this._map._viewInfo || {};

		var byPart = {};
		for (var viewId in viewParts) {
			if (!viewInfo[viewId]) continue;
			var part = viewParts[viewId];
			if (!byPart[part]) byPart[part] = [];
			byPart[part].push(parseInt(viewId));
		}

		for (var i = 0; i < this._previewTiles.length; i++) {
			var img = this._previewTiles[i];
			var frame = img && img.parentNode;
			if (!frame) continue;
			var holder = frame.querySelector('.vulcan-preview-presence');
			var viewIds = byPart[i];
			if (!viewIds || !viewIds.length) {
				if (holder) holder.remove();
				continue;
			}
			if (!holder) {
				if (window.getComputedStyle(frame).position === 'static')
					frame.style.position = 'relative';
				holder = window.L.DomUtil.create('div', 'vulcan-preview-presence', frame);
				holder.style.position = 'absolute';
				holder.style.right = '6px';
				holder.style.bottom = '6px';
				holder.style.display = 'flex';
				holder.style.gap = '3px';
				holder.style.pointerEvents = 'none';
				holder.style.zIndex = '3';
				holder.setAttribute('aria-hidden', 'true');
			}
			while (holder.children.length > viewIds.length)
				holder.removeChild(holder.lastChild);
			while (holder.children.length < viewIds.length) {
				var dot = window.L.DomUtil.create('span', 'vulcan-preview-presence-dot', holder);
				dot.style.width = '8px';
				dot.style.height = '8px';
				dot.style.borderRadius = '50%';
				dot.style.border = '1.5px solid rgba(255,255,255,0.9)';
				dot.style.boxSizing = 'border-box';
			}
			for (var d = 0; d < viewIds.length; d++) {
				holder.children[d].style.background =
					app.LOUtil.rgbToHex(app.LOUtil.getViewIdColor(viewIds[d]));
			}
		}
	},

	_createPreview: function (i, hashCode) {
		var frameClass = 'preview-frame ' + this.options.frameClass;
		var frame = window.L.DomUtil.create('div', frameClass, this._partsPreviewCont);
		frame.id = 'preview-frame-part-' + this._idNum;
		this._addDnDHandlers(frame);
		window.L.DomUtil.create('span', 'preview-helper', frame);

		// The visible digit is written by _setPreviewPositionLabels below,
		// alongside the alt text and tooltip.
		const slideNumber = window.L.DomUtil.create('span', 'preview-slide-number', frame);
		slideNumber.setAttribute('aria-hidden', 'true');

		var imgClassName = 'preview-img ' + this.options.imageClass;
		var img = window.L.DomUtil.create('img', imgClassName, frame);
		img.slideNumber = slideNumber;
		this._setPreviewPositionLabels(img, i);
		// A drag grabbed on the picture starts from the frame, the nearest
		// draggable ancestor, so it carries the slide marker data and shows
		// the framed preview as its ghost.
		img.draggable = false;
		img.setAttribute('role', 'option');
		img.setAttribute('aria-selected', 'false');
		// roving tabindex - only the current slide is a tab stop so Tab
		// enters the list once and the arrow keys move within it
		img.setAttribute('tabindex', '-1');
		window.L.control.attachTooltipEventListener(img, this._map);
		img.id = 'preview-img-part-' + this._idNum;
		img.hash = hashCode;
		img.src = document.querySelector('meta[name="previewSmile"]').content;
		img.fetched = false;
		var interactionTarget = this._getPreviewInteractionTarget(frame, img);
		if (!window.mode.isDesktop()) {
			var hammerOptions = { recognizers: [[Hammer.Press]] };
			if (interactionTarget === frame) {
				// PointerEventInput binds pointerdown to Hammer's manager element,
				// so the frame itself must be that element for its padding/number to
				// take the press. Preserve native mouse/trackpad reorder by omitting
				// only Hammer's `userDrag: none` manager CSS on that draggable frame.
				var hammerCssProps = Object.assign({}, Hammer.defaults.cssProps);
				delete hammerCssProps.userDrag;
				hammerOptions.cssProps = hammerCssProps;
			}
			(new Hammer(interactionTarget, hammerOptions))
				.on('press', function (e) {
					// A MOUSE MUST NOT ARM THIS. What the press arms is a
					// TOUCH state machine: _addDnDTouchHandlers binds its only
					// teardown to touchmove/touchcancel/touchend, and
					// _handleTouchMove steers off e.originalEvent.touches[0].
					// Hammer does not filter for us -- with window.PointerEvent
					// present it builds PointerEventInput, whose handler takes
					// any pointerdown with button 0 (hammer.js:892), and
					// PressRecognizer weighs only pointer count, distance and
					// time (hammer.js:1889-1897). So a 251ms mouse hold armed a
					// gesture nothing could release: `pointer-events: none`
					// stayed on every .preview-img, the ghost stayed in the
					// body, and the collapsed frames stayed collapsed until
					// reload. !isDesktop() is UA-mobile, which iPadOS Safari
					// reports with a trackpad or mouse attached, so this is a
					// live posture, not a lab one -- and the filmstrip is the
					// read-posture navigation, so the wedge takes the deck away.
					//
					// NARROWED RATHER THAN MADE SYMMETRIC. A symmetric teardown
					// alone would not produce a working mouse gesture -- the
					// MOVE half is touch-only too, so the ghost would freeze at
					// the press point -- and a pointer-generic rewrite would be
					// a second mouse reorder racing the one already here: the
					// native HTML5 drag (_addDnDHandlers, bound unconditionally
					// in _createPreview) reorders through the SAME _updateDropGap
					// parting, and `contextmenu` -> openCardMenu opens the SAME
					// card menu the long press opens. Arming from a mouse never
					// added an affordance, it disabled the working one, since
					// `pointer-events: none` kills the native drag. It is also
					// Slides' shape: touch-and-hold is the touch idiom, a mouse
					// drags straight away and right-clicks for the menu, and
					// putting a 251ms hold in front of a mouse drag would be
					// friction added on purpose.
					//
					// A STYLUS KEEPS THE GESTURE. On a UA-mobile device a pen
					// (Apple Pencil, Android stylus) dispatches real touch
					// events, so it can release what it arms; only 'mouse' is
					// turned away. pointerType is never undefined -- every
					// Hammer input backend labels it (hammer.js:828, 912, 969,
					// 1024) -- so this tests the one value that cannot finish.
					// Same idiom as HRuler.ts:1477.
					if (e.pointerType === 'mouse')
						return;
					if (this._previewTouchGesture)
						return;
					if (this._map.isEditMode()) {
						this._addDnDTouchHandlers(e, interactionTarget, frame, img);
					}
				}.bind(this));
		}
		window.L.DomEvent.on(interactionTarget, 'click', function (e) {
			this._handlePreviewInteractionClick(e, frame, img);
		}, this);

		var that = this;
		img.onfocus = function () {
			that._map._clip.clearSelection();
			that._map._clip.setTextSelectionType('slide');
			that.partsFocused = true;
			that.partsFocusedApplied = true;
		};

		var that = this;
		window.L.DomEvent.on(frame, 'contextmenu', function(e) {
			var isMasterView = this._map['stateChangeHandler'].getItemValue('.uno:SlideMasterPage');
			if (isMasterView === 'true')
				return;
			e.preventDefault();
			// A LONG PRESS ALREADY OWNS THIS GESTURE. On the phone strip the
			// Hammer press has armed _previewTouchGesture and the _dragState
			// whose release opens the card menu, and set `pointer-events: none`
			// on every card image, before the Android WebView raises its own
			// long-press `contextmenu` (~500 ms in, finger still down). With the
			// image out of hit testing that event lands HERE, on the frame, and
			// opened this Paste / New slide menu; the release then opened the
			// card menu over it (_handleTouchEnd -> _openCardMenuFromPress): two
			// stacked menus for one press (redroid event log, 9/30). The release
			// decides what opens, a menu or a drop, so this event only keeps the
			// system menu away. Both halves are needed: a tablet arms the gesture
			// but no _dragState (phone chrome only, _addDnDTouchHandlers), its
			// release opens nothing, and this menu stays that press's one menu;
			// a desktop drag holds _dragState with no gesture. A mouse never
			// arms the gesture (the Hammer 'press' above) and iOS raises no
			// `contextmenu` for a touch.
			if (this._previewTouchGesture && this._dragState)
				return;
			// The frame area only offers Paste and Insert, both of which need
			// edit access, so in read-only mode just suppress the system menu.
			if (app.map.isReadOnlyMode())
				return;

			var nPos = undefined;
			if (this.isPaddingClick(frame, e, 'top'))
				nPos = that._findClickedPart(frame) - 1;
			else if (this.isPaddingClick(frame, e, 'bottom'))
				nPos = that._findClickedPart(frame);
			else if (this.isPaddingClick(frame, e, 'right') || this.isPaddingClick(frame, e, 'left'))
				nPos = that._findClickedPart(frame);

			if (!that._isSelected(e))
				that._setPart(e);
			img.focus();

			var entries = [];
			// Offer Paste whenever we can read the clipboard: the browser Clipboard
			// API, or the Mac app's native clipboard bridge. (The other apps drive
			// slide copy/paste through their own native clipboard, which is not
			// wired up for slides yet, so leave them on the Clipboard-API check.)
			if (window.L.Browser.clipboardApiAvailable || window.ThisIsTheMacOSApp) {
				entries.push({
					id: 'paste',
					type: 'comboboxentry',
					text: _('Paste'),
					img: 'Paste',
					class: 'unoPaste',
					pos: 0,
				});
			}
			entries.push({
				id: 'newslide',
				type: 'comboboxentry',
				text: _UNO(that._map._docLayer._docType == 'presentation' ? '.uno:InsertSlide' : '.uno:InsertPage', 'presentation'),
				img: 'InsertPage',
				class: 'unoInsertPage',
				pos: 0,
			});

			var menuPosEl = that._getMenuPosEl();
			var rect = that._container.getBoundingClientRect();
			menuPosEl.style.left = (e.clientX - rect.left) + 'px';
			menuPosEl.style.top = (e.clientY - rect.top) + 'px';

			var callback = function(objectType, eventType, object, data, entry) {
				if (eventType !== 'selected')
					return false;
				if (entry.id === 'paste') {
					if (nPos === undefined)
						nPos = that._findClickedPart(frame);
					that._pasteSlide(nPos);
				} else if (entry.id === 'newslide') {
					that._map.insertPage(nPos);
					that._phoneDeckMutationCompleted();
				}
				JSDialog.CloseAllDropdowns();
				return true;
			};

			JSDialog.OpenDropdown(
				'slide-frame-menu',
				menuPosEl,
				entries,
				callback,
				'',
				false,
				false,
				true,
			);
		}, this);

		// THE CARD MENU. Named rather than inlined into the listener because
		// the phone reaches it from a LONG PRESS, not from a `contextmenu`
		// event, and both routes have to arrive at the same menu — see
		// _handleTouchEnd for the gesture and for why there is no second menu
		// definition here.
		var openCardMenu = function(e) {
			e.stopPropagation();
			var isMasterView = this._map['stateChangeHandler'].getItemValue('.uno:SlideMasterPage');
			if (isMasterView === 'true')
				return;
			e.preventDefault();

			if (!that._isSelected(e))
				that._setPart(e);
			img.focus();

			var part = that._findClickedPart(img.parentNode);
			var partIndex = parseInt(part) - 1;
			var isPresentation = that._map._docLayer._docType === 'presentation';

			var entries = [];
			if (!(app.impress.hasOverviewPage && that._map._docLayer._selectedPart === 0)) {
				entries.push({
					id: 'copy',
					type: 'comboboxentry',
					text: _('Copy'),
					img: 'Copy',
					class: 'unoCopy',
					pos: 0,
				});
			}
			entries.push({
				id: 'paste',
				type: 'comboboxentry',
				text: _('Paste'),
				img: 'Paste',
				class: 'unoPaste',
				pos: 0,
			});
			entries.push({
				id: 'newslide',
				type: 'comboboxentry',
				text: _UNO(isPresentation ? '.uno:InsertSlide' : '.uno:InsertPage', 'presentation'),
				img: 'InsertPage',
				class: 'unoInsertPage',
				pos: 0,
			});
			entries.push({
				id: 'duplicateslide',
				type: 'comboboxentry',
				text: _UNO(isPresentation ? '.uno:DuplicateSlide' : '.uno:DuplicatePage', 'presentation'),
				img: 'DuplicatePage',
				class: 'unoDuplicatePage',
				pos: 0,
			});
			if (that._map._docLayer._parts > 1) {
				entries.push({
					id: 'delete',
					type: 'comboboxentry',
					text: _UNO(isPresentation ? '.uno:DeleteSlide' : '.uno:DeletePage', 'presentation'),
					img: 'DeletePage',
					class: 'unoDeletePage',
					pos: 0,
				});
			}
			// Slide setup / page setup is desktop-only on phones. Google:
			// "no slide-size/page-setup control [...] on phone". It is the
			// one entry in this menu that changes the deck rather than a
			// slide, and it opens a core dialog sized for a desktop. Every
			// other entry here is a direct slide operation and stays.
			if (!that._isVulcanPhoneChrome()) {
				entries.push({
					id: 'slideproperties',
					type: 'comboboxentry',
					text: _UNO(isPresentation ? '.uno:SlideSetup' : '.uno:PageSetup', 'presentation'),
					img: 'PageSetup',
					class: 'slideproperties',
					pos: 0,
				});
			}
			if (isPresentation && app.impress.isSlideHidden(partIndex)) {
				entries.push({
					id: 'showslide',
					type: 'comboboxentry',
					text: _UNO('.uno:ShowSlide', 'presentation'),
					img: 'ShowSlide',
					class: 'showslide',
					pos: 0,
				});
			}
			if (isPresentation && !app.impress.isSlideHidden(partIndex)) {
				entries.push({
					id: 'hideslide',
					type: 'comboboxentry',
					text: that._isVulcanPhoneChrome()
						? _('Skip Slide')
						: _UNO('.uno:HideSlide', 'presentation'),
					img: 'Hideslide',
					class: 'hideslide',
					pos: 0,
				});
			}

			// Add Section is desktop-only on phones, and it is a CUT rather
			// than a gap: SECTIONS DO NOT EXIST IN GOOGLE SLIDES AT ALL.
			// google-slides.json is searched, not remembered — the string
			// "section" occurs in exactly one of its 76 features, "Offline
			// section in the nav drawer", which is a list heading in the file
			// browser and not a deck structure. There is no phone flow to
			// copy and no desktop flow either, so this row cannot be scored
			// against Slides; the standing rule is that what Slides does not
			// ship is a cut.
			//
			// It is also the wrong SHAPE for this menu on a phone. Every
			// other entry here acts on the slide you long-pressed — copy it,
			// duplicate it, delete it, hide it. A section is a deck-wide
			// grouping, the same "changes the deck rather than a slide"
			// objection that already took Slide Setup out five lines above,
			// and the filmstrip has no way to SHOW a section once you have
			// made one: the phone strip renders slide cards only, so the
			// result of tapping this is invisible on the surface you tapped
			// it from. Renaming or deleting the section afterwards lives on
			// the section HEADER's own context menu (_renameSection below),
			// which the phone strip never draws — so on a phone this is a
			// one-way door into a state with no control.
			//
			// Where it lives instead: this same menu on desktop, which takes
			// the gate's false branch and is byte-identical to HEAD, plus the
			// desktop slide-sorter's section headers.
			//
			// Both halves of the gate, per the branch rule: isSmallScreenDevice()
			// alone is not it, because ?vulcanChrome=desktop puts the desktop
			// chrome back on a phone-sized screen and must keep the desktop
			// menu with it. _isVulcanPhoneChrome() (:270-274) reads the
			// pre-paint html.vulcan-mobile-chrome marker as well.
			//
			// Deliberately NOT doctype-scoped, matching the Slide Setup gate
			// directly above: Draw on a phone shares this menu and loses the
			// entry too. That is if anything more correct there — app.impress
			// .sections is a presentation namespace, so in a Draw document
			// `sections` is falsy, isFirstSectionSlide never becomes true and
			// the row is pushed unconditionally today.
			//
			// if not the first section slide then add entry for section
			var isFirstSectionSlide = false;
			const sections = app.impress.sections;
			if (sections) {
				for (let i = 0; i < sections.length; i++) {
					if (sections[i].startIndex === partIndex) {
						isFirstSectionSlide = true;
						break;
					}
				}
			}
			if (!isFirstSectionSlide && !that._isVulcanPhoneChrome()) {
				entries.push({
					id: 'addsection',
					type: 'comboboxentry',
					text: _('Add Section'),
					img: 'addslidesection',
					class: 'addsection',
					pos: 0,
				});
			}

			// In read-only mode the slide cannot be changed, but copying it is
			// still allowed, so keep only Copy and drop the editing entries. The
			// system menu is already suppressed, so when nothing is left (for
			// example the overview page, which has no Copy entry) just close out.
			if (app.map.isReadOnlyMode())
				entries = entries.filter(function(entry) { return entry.id === 'copy'; });
			if (entries.length === 0)
				return;

			var menuPosEl = that._getMenuPosEl();
			var rect = that._container.getBoundingClientRect();
			menuPosEl.style.left = (e.clientX - rect.left) + 'px';
			menuPosEl.style.top = (e.clientY - rect.top) + 'px';

			var callback = function(objectType, eventType, object, data, entry) {
				if (eventType !== 'selected')
					return false;
				if (!that._runPhoneSlideMutationAction(entry.id, part)) {
					switch (entry.id) {
				case 'copy':
					that._map._clip.clearSelection();
					that._map._clip.setTextSelectionType('slide');
					that._map._clip._execCopyCutPaste('copy', '.uno:CopySlide');
					break;
				case 'slideproperties':
					app.socket.sendMessage('uno .uno:PageSetup');
					break;
				case 'showslide':
					that._map.showSlide();
					break;
				case 'hideslide':
					that._map.hideSlide();
					break;
				case 'addsection':
					app.socket.sendMessage('uno .uno:AddSlideSection');
					break;
					}
				}
				JSDialog.CloseAllDropdowns();
				return true;
			};

			JSDialog.OpenDropdown(
				'slide-img-menu',
				menuPosEl,
				entries,
				callback,
				'',
				false,
				false,
				true,
			);
		};

		window.L.DomEvent.on(img, 'contextmenu', openCardMenu, this);
		// The phone's entry point. Bound here, next to the definition, so the
		// touch path cannot pick up a different `this` than the mouse path.
		img.vulcanOpenCardMenu = window.L.bind(openCardMenu, this);

		var box = this._previewRequestBox();
		// Remembered so _resize can tell a rotation that changes the box from
		// one that does not.
		this._phoneCardStripApplied = this._isPhoneCardStrip();
		var imgSize = this._map.getPreview(i, i,
						   box.maxWidth,
						   box.maxHeight,
						   {autoUpdate: this.options.autoUpdate,
						    fetchThumbnail: false});

		window.L.DomUtil.setStyle(img, 'width', imgSize.width + 'px');
		window.L.DomUtil.setStyle(img, 'height', imgSize.height + 'px');

		this._idNum++;

		return img;
	},

	// The visible digit, alt text and tooltip only ever hold the position
	// they were given here. Callers that move a preview to a different
	// position must call this again with the new position.
	//
	// The digit used to be a CSS counter keyed off DOM order, but Chromium
	// does not recount when a frame is removed while the counter-increment
	// sits on a descendant of it (the number span): deleting slide 5 left
	// the rail reading 4, 6, 7. A counter also skips frames hidden in a
	// collapsed section, which shifted every later number down. The digit
	// is now an attribute that partsPreviewControl.css paints as generated
	// content, so the browser's own Find still does not match rail numbers.
	_setPreviewPositionLabels: function (img, i) {
		// A drop relabels the whole deck; most previews keep their position.
		if (img.labelledPosition === i)
			return;
		img.labelledPosition = i;
		img.setAttribute('alt', _('preview of page %1').replace('%1', String(i + 1)));
		// A Draw document (the PDF page canvas) has pages, not slides — same
		// split as the panel title above.
		img.setAttribute('data-cooltip',
			(app.map._docLayer._docType === 'drawing' ? _('Page %1') : _('Slide %1'))
				.replace('%1', String(i + 1)));
		img.slideNumber.setAttribute('data-slide-number', String(i + 1));
	},

	// Relabels every preview from startIndex onward to match its current
	// position in _previewTiles, for callers that insert or remove a
	// preview and thereby shift the position of every one that follows it.
	_updatePreviewPositionLabelsFrom: function (startIndex) {
		for (var i = startIndex; i < this._previewTiles.length; i++) {
			this._setPreviewPositionLabels(this._previewTiles[i], i);
		}
	},

	_updateSections: function (e) {
		if (!this._previewInitialized)
			return;

		var sections = e.sections || [];

		// Remove existing section headers
		for (var i = 0; i < this._sectionHeaders.length; i++) {
			window.L.DomUtil.remove(this._sectionHeaders[i]);
		}
		this._sectionHeaders = [];

		if (!sections || sections.length === 0) {
			this._collapsedSections.clear();
			return;
		}

		// Drop any remembered names that no longer correspond to a section
		// (e.g. after a rename or removal).
		var liveNames = new Set();
		for (var ln = 0; ln < sections.length; ln++)
			liveNames.add(sections[ln].name);
		this._collapsedSections.forEach(function (name) {
			if (!liveNames.has(name))
				this._collapsedSections.delete(name);
		}, this);

		// Insert section headers before the frame of each section's first slide.
		// The container children are: #first-drop-site, frame0, frame1, ...
		// So slide index N corresponds to child index N+1.
		for (var s = 0; s < sections.length; s++) {
			var section = sections[s];
			var slideIndex = section.startIndex;

			if (slideIndex < 0 || slideIndex >= this._previewTiles.length)
				continue;

			var header = this._createSectionHeader(section, s);
			this._sectionHeaders.push(header);

			// Insert before the frame of this section's first slide
			var slideFrame = this._previewTiles[slideIndex].parentNode;
			slideFrame.parentNode.insertBefore(header, slideFrame);
		}

		this._applyAllSectionsCollapse();

		this._updateSelectedSection();
	},

	_updateSelectedSection: function () {
		if (!this._sectionHeaders || this._sectionHeaders.length === 0)
			return;

		var sections = (app.impress && app.impress.sections) || [];
		var partList = (app.impress && app.impress.partList) || [];
		var fullySelected = new Set();
		for (var s = 0; s < sections.length; s++) {
			var start = sections[s].startIndex;
			var end = (s + 1 < sections.length)
				? sections[s + 1].startIndex - 1
				: this._previewTiles.length - 1;
			if (start < 0 || end < start)
				continue;

			var allSelected = true;
			for (var p = start; p <= end; p++) {
				if (!partList[p] || !partList[p].selected) {
					allSelected = false;
					break;
				}
			}
			if (allSelected)
				fullySelected.add(s);
		}

		for (var h = 0; h < this._sectionHeaders.length; h++) {
			var header = this._sectionHeaders[h];
			var nameSpan = header.querySelector('.slide-section-name');
			if (!nameSpan)
				continue;
			var headerSectionIndex = parseInt(header.getAttribute('data-section-index'), 10);
			if (fullySelected.has(headerSectionIndex))
				window.L.DomUtil.addClass(nameSpan, 'selected');
			else
				window.L.DomUtil.removeClass(nameSpan, 'selected');
		}
	},

	_createSectionHeader: function (section, sectionIndex) {
		var that = this;

		var header = window.L.DomUtil.create('div', 'slide-section-header');
		header.setAttribute('data-section-index', sectionIndex);
		header.setAttribute('data-start-index', section.startIndex);
		header.setAttribute('draggable', 'false');

		var toggleBtn = window.L.DomUtil.create('button', 'slide-section-toggle ui-expander-btn', header);
		toggleBtn.type = 'button';
		toggleBtn.setAttribute('aria-label',
			_('Toggle section %1').replace('%1', section.name));

		var nameSpan = window.L.DomUtil.create('span', 'slide-section-name', header);
		nameSpan.textContent = section.name;
		nameSpan.setAttribute('title', section.name);

		window.L.DomEvent.on(toggleBtn, 'click', function (e) {
			window.L.DomEvent.stopPropagation(e);
			window.L.DomEvent.preventDefault(e);
			that._toggleSectionCollapse(sectionIndex);
		}, this);

		// Click on the header (but not the toggle) selects all slides in the section.
		window.L.DomEvent.on(header, 'click', function (e) {
			if (toggleBtn.contains(e.target))
				return;
			window.L.DomEvent.stopPropagation(e);
			window.L.DomEvent.preventDefault(e);
			that._selectSection(sectionIndex);
		}, this);

		// Section context menu
		if (this._map.isEditMode()) {
			window.L.DomEvent.on(header, 'contextmenu', function(e) {
				window.L.DomEvent.stopPropagation(e);
				window.L.DomEvent.preventDefault(e);

				if (app.map.isReadOnlyMode())
					return;

				that._openSectionContextMenu(section, sectionIndex, e);
			}, this);
		}

		// Drop target: dropping a slide onto a section header makes it the
		// new first slide of that section.  Dropping above the header (on
		// the preceding slide frame) keeps the default behaviour of placing
		// the slide outside the section.
		if (!app.file.fileBasedView) {
			header.addEventListener('dragenter', function (e) {
				if (e.preventDefault) e.preventDefault();
			});
			header.addEventListener('dragover', function (e) {
				if (e.preventDefault) e.preventDefault();
				e.dataTransfer.dropEffect = 'move';
				header.classList.add('slide-section-dropsite');
				return false;
			});
			header.addEventListener('dragleave', function () {
				header.classList.remove('slide-section-dropsite');
			});
			header.addEventListener('drop', function (e) {
				if (e.stopPropagation) e.stopPropagation();
				if (e.preventDefault) e.preventDefault();
				header.classList.remove('slide-section-dropsite');
				var startIndex = section.startIndex;
				var position = startIndex > 0 ? startIndex - 1 : -1;
				app.socket.sendMessage(
					'moveselectedclientparts position=' + position +
					' intoSection=' + sectionIndex);
				// The dropped slides become the first slides of the section:
				// settle them locally in front of its current first slide.
				const state = that._dragState;
				if (state) {
					that._applyDropLocally(startIndex, state.draggedParts, true);
					that._finishDrag(false);
				}
				return false;
			});
		}

		return header;
	},

	_selectSection: function (sectionIndex) {
		var sections = app.impress && app.impress.sections;
		if (!sections || !sections[sectionIndex])
			return;

		var start = sections[sectionIndex].startIndex;
		var end = (sectionIndex + 1 < sections.length)
			? sections[sectionIndex + 1].startIndex - 1
			: this._previewTiles.length - 1;

		if (start < 0 || end < start)
			return;

		var applyRange = () => {
			this._map.selectPart(start, 1, false);
			for (var id = start + 1; id <= end; ++id)
				this._map.selectPart(id, 1, false);
			this._selectedPartRange = [start, end];
		};

		this._map.deselectAll();

		if (this._map._docLayer._selectedPart === start) {
			applyRange();
			return;
		}

		// setPart(start) triggers SwitchPage in core, which posts itself
		// for async execution when a paint is in progress (common under
		// CI load). SwitchPage deselects every page before selecting the
		// new current one, so issuing the multi-select before it runs
		// loses slides start+1..end. Wait for the kit's setpart:
		// confirmation - it only fires after SwitchPage actually
		// completes - before extending the selection.
		var done = false;
		var onSetPart = function () {
			if (done) return;
			done = true;
			applyRange();
		};
		this._map.once('setpart', onSetPart);
		// Safety net in case setpart: never arrives.
		setTimeout(onSetPart, 2000);

		this._map.setPart(start);
	},

	_toggleSectionCollapse: function (sectionIndex) {
		var sections = app.impress.sections || [];
		var section = sections[sectionIndex];
		if (!section)
			return;

		if (this._collapsedSections.has(section.name))
			this._collapsedSections.delete(section.name);
		else
			this._collapsedSections.add(section.name);

		this._applySectionCollapse(sectionIndex);
		// Expanding may reveal thumbnails whose images were never fetched.
		this._ensureVisiblePreviews();
	},

	// Apply the collapsed class to one section's header and its slide frames.
	_applySectionCollapse: function (sectionIndex) {
		var section = app.impress.sections && app.impress.sections[sectionIndex];
		if (!section)
			return;

		var collapsed = this._collapsedSections.has(section.name);
		var end = section.startIndex + section.slideCount;

		var header = this._sectionHeaders[sectionIndex];
		if (header) {
			var toggleBtn = header.querySelector('.slide-section-toggle');
			header.classList.toggle('collapsed', collapsed);
			if (toggleBtn)
				toggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
		}

		for (var i = section.startIndex; i < end; i++) {
			var frame = this._previewTiles[i] && this._previewTiles[i].parentNode;
			if (frame)
				frame.classList.toggle('section-collapsed', collapsed);
		}
	},

	// Apply collapsed state to every section.
	_applyAllSectionsCollapse: function () {
		var sections = app.impress.sections || [];
		for (var s = 0; s < sections.length; s++)
			this._applySectionCollapse(s);
	},

	// Collapse every section.
	_collapseAllSections: function () {
		const sections = app.impress.sections || [];
		if (sections.length === 0)
			return;
		for (let i = 0; i < sections.length; i++)
			this._collapsedSections.add(sections[i].name);
		this._applyAllSectionsCollapse();
	},

	// Expand every section.
	_expandAllSections: function () {
		if (this._collapsedSections.size === 0)
			return;
		this._collapsedSections.clear();
		this._applyAllSectionsCollapse();
		// Expanding may reveal thumbnails whose images were never fetched.
		this._ensureVisiblePreviews();
	},

	_openSectionContextMenu: function (section, sectionIndex, e) {
		var that = this;
		var sections = app.impress.sections || [];

		const hasCollapsed = this._collapsedSections.size > 0;
		const hasExpanded = this._collapsedSections.size < sections.length;

		var entries = [{
			id: 'renameSection',
			type: 'comboboxentry',
			text: _('Rename Section'),
			img: 'renameslidesection',
			pos: 0,
		}];
		entries.push({
			id: 'removeSection',
			type: 'comboboxentry',
			text: _('Remove Section'),
			img: 'removeslidesection',
			pos: 0,
		});
		if (sections.length > 1) {
			entries.push({
				id: 'removeSectionAndSlides',
				type: 'comboboxentry',
				text: _('Remove Section & Slides'),
				img: 'removesectionandslides',
				pos: 0,
			});
		}
		if (sectionIndex > 0) {
			entries.push({
				id: 'moveSectionUp',
				type: 'comboboxentry',
				text: _('Move Section Up'),
				img: 'arrowup',
				pos: 0,
			});
		}
		if (sectionIndex < sections.length - 1) {
			entries.push({
				id: 'moveSectionDown',
				type: 'comboboxentry',
				text: _('Move Section Down'),
				img: 'arrowdown',
				pos: 0,
			});
		}
		if (sections.length > 1 && hasExpanded) {
			entries.push({
				id: 'collapseAllSections',
				type: 'comboboxentry',
				text: _('Collapse All Sections'),
				pos: 0,
			});
		}
		if (sections.length > 1 && hasCollapsed) {
			entries.push({
				id: 'expandAllSections',
				type: 'comboboxentry',
				text: _('Expand All Sections'),
				pos: 0,
			});
		}

		var menuPosEl = this._getMenuPosEl();
		var rect = this._container.getBoundingClientRect();
		menuPosEl.style.left = (e.clientX - rect.left) + 'px';
		menuPosEl.style.top = (e.clientY - rect.top) + 'px';

		var callback = function (objectType, eventType, object, data, entry) {
			if (eventType !== 'selected')
				return false;
			switch (entry.id) {
			case 'renameSection':
				that._renameSection(section, sectionIndex);
				break;
			case 'moveSectionUp':
				that._map.setPart(section.startIndex);
				that._map.selectPart(section.startIndex, 1, false);
				app.socket.sendMessage('uno .uno:MoveSlideSectionUp');
				break;
			case 'moveSectionDown':
				that._map.setPart(section.startIndex);
				that._map.selectPart(section.startIndex, 1, false);
				app.socket.sendMessage('uno .uno:MoveSlideSectionDown');
				break;
			case 'removeSection':
				that._map.setPart(section.startIndex);
				that._map.selectPart(section.startIndex, 1, false);
				app.socket.sendMessage('uno .uno:RemoveSlideSection');
				break;
			case 'removeSectionAndSlides': {
				var n = section.slideCount;
				var msg = _('Delete section "%1" and its %2 slide(s)?')
					.replace('%1', section.name)
					.replace('%2', String(n));
				app.map.uiManager.showInfoModal(
					'remove-section-slides-modal',
					_('Delete'),
					msg,
					'',
					_('OK'),
					function () {
						that._map.setPart(section.startIndex);
						that._map.selectPart(section.startIndex, 1, false);
						app.socket.sendMessage('uno .uno:RemoveSlideSectionAndSlides');
					},
					true,
					'remove-section-slides-modal-response',
				);
				break;
			}
			case 'collapseAllSections':
				that._collapseAllSections();
				break;
			case 'expandAllSections':
				that._expandAllSections();
				break;
			}
			JSDialog.CloseAllDropdowns();
			return true;
		};

		JSDialog.OpenDropdown(
			'slide-section-menu',
			menuPosEl,
			entries,
			callback,
			'',
			false,
			false,
			true,
		);
	},

	_renameSection: function (section, sectionIndex) {
		var currentName = section.name;

		app.map.uiManager.showInputModal(
			'rename-section',
			_('Rename Section'),
			_('Enter new section name:'),
			currentName,
			_('OK'),
			function (newName) {
				if (newName && newName !== currentName) {
					var command = {
						'SectionIndex': {
							'type': 'long',
							'value': sectionIndex
						},
						'Name': {
							'type': 'string',
							'value': newName
						}
					};
					app.socket.sendMessage('uno .uno:RenameSlideSection ' + JSON.stringify(command));
				}
			}
		);
	},

	// part is optional: Parts.js fires 'scrolltopart' with no data, but
	// Events.fire still hands every listener an event object, so "no part was
	// named" reaches us as {type, target} rather than as undefined. Anything
	// that is not a part number therefore means the current part - without
	// that test the event object was used as an index, the tile lookup came
	// back undefined and the strip silently stopped following the slide in
	// edit mode (view mode passes a real number and kept working).
	_scrollToPart: function(part) {
		var partNo = typeof part === 'number' ? part : this._map.getCurrentPartNumber();
		// Use the preview tile's parent frame directly instead of child index
		var node = this._previewTiles[partNo] ? this._previewTiles[partNo].parentNode : null;

		if (node && (!this._previewTiles[partNo] || !this._isPreviewFullyVisible(partNo))) {
			if (this.scrollTimer) clearTimeout(this.scrollTimer);

			 this.scrollTimer = setTimeout(() => {
				// Inside the phone chrome, scroll only the strip -- and only as
				// far as it takes. A bare scrollIntoView() defaults to
				// block:'start' and walks EVERY scrollable ancestor, up to the
				// document and on into the host document the fork's iframe sits
				// in. 'nearest' is a no-op for an axis already in view, so the
				// strip moves the minimum distance and nothing outside it moves
				// at all. Desktop keeps the stock bare call.
				//
				// The gate is _isVulcanPhoneChrome(), NOT _isPhoneCardStrip():
				// the card strip predicate also requires isPortrait(), because
				// it additionally decides the portrait card BOX, and
				// MouseControl.isVulcanPhoneImpress -- which gates the
				// per-pan-frame caller -- does not test orientation. A phone in
				// LANDSCAPE therefore satisfied the caller and failed this
				// branch, and took the page-walking call. Landscape is not a
				// case where the bare call was right either: vulcan-theme.css
				// §13i.6 makes #slide-sorter.landscape a VERTICAL rail
				// (flex-direction: column; overflow-y: auto), so block:'start'
				// jams the current card to the top of the rail rather than
				// moving it the least it can. 'nearest' is correct in both
				// orientations; only the axis it acts on differs.
				node.scrollIntoView(
					VulcanFilmstripFollow.scrollIntoViewArg(this._isVulcanPhoneChrome()));
				this.scrollTimer = null;
			}, 50);
		}
	},

	// Returns the logical child index (counting only frames, not section headers).
	_findClickedPart: function (element) {
		var frameIndex = 0;
		for (var i = 0; i < this._partsPreviewCont.children.length; i++) {
			var child = this._partsPreviewCont.children[i];
			if (child === element || child === element.parentNode) {
				return frameIndex;
			}
			// Only count non-section-header children as frames
			if (!child.classList.contains('slide-section-header'))
				frameIndex++;
		}
		return -1;
	},

	// This is used with fileBasedView.
	_scrollViewToPartPosition: function (partNumber, fromBottom) {
		if (this._map._docLayer && this._map._docLayer._isZooming)
			return;

		if (partNumber < 0) partNumber = 0;
		if (partNumber >= this._map._docLayer._parts) partNumber = this._map._docLayer._parts - 1;

		var viewHeight = app.sectionContainer.getViewSize()[1];
		var currentScrollX = app.activeDocument.activeLayout.viewedRectangle.pX1;

		var layout = app.activeDocument.activeLayout;
		var scrollTop;
		var partHeightPixels;
		if (layout.viewRectangles && layout.viewRectangles[partNumber]) {
			scrollTop = layout.viewRectangles[partNumber].pY1;
			partHeightPixels = layout.viewRectangles[partNumber].pHeight + Math.round(this._map._docLayer._spaceBetweenParts * app.twipsToPixels);
		} else {
			partHeightPixels = Math.round((this._map._docLayer._partHeightTwips + this._map._docLayer._spaceBetweenParts) * app.twipsToPixels);
			scrollTop = partHeightPixels * partNumber;
		}

		if (viewHeight > partHeightPixels && partNumber > 0)
			scrollTop -= Math.round((viewHeight - partHeightPixels) * 0.5);

		// scroll to the bottom of the selected part/page instead of its top px
		if (fromBottom)
			scrollTop += partHeightPixels - viewHeight;

		app.activeDocument.activeLayout.scrollTo(currentScrollX, scrollTop);
	},

	_scrollViewByDirection: function(buttonType) {
		if (this._map._docLayer && this._map._docLayer._isZooming)
			return;
		var viewHeight = Math.floor(app.sectionContainer.getViewSize()[1]);
		var viewHeightScaled = Math.round(Math.floor(viewHeight) / app.dpiScale);
		var scrollBySize = Math.floor(viewHeightScaled * 0.75);
		var currentScrollX = app.activeDocument.activeLayout.viewedRectangle.cX1;

		app.sectionContainer.getSectionWithName(app.CSections.Scroll.name).onScrollBy({x: currentScrollX, y: buttonType === 'prev' ? -scrollBySize : scrollBySize});
	},

	// Paste a slide. Always read from the system clipboard and force-upload
	// to the local Kit (skipping the same-tab pTransferClip shortcut),
	// so that a copy from another tab/document wins over any stale local copy.
	// nPos: insertion position for the frame context menu (may be undefined for img context menu).
	_pasteSlide: async function(nPos) {
		if (this._pastePending)
			return;
		this._pastePending = true;
		try {
			if (nPos !== undefined)
				this._map.setPart(Math.max(0, nPos - 1));

			const clip = this._map._clip;

			// Read the system clipboard so a copy from another tab/document wins
			// over a stale local copy. _readClipboardItems handles the CODA/mobile
			// app native bridges (where navigator.clipboard.read() is unavailable
			// or would pop up the WebView's system "Paste" confirmation).
			const canReadClipboard = window.L.Browser.clipboardApiAvailable
				|| window.ThisIsTheiOSApp || window.ThisIsTheMacOSApp || window.ThisIsTheWindowsApp;
			if (canReadClipboard) {
				let html = '';
				let readRefused = false;
				try {
					const items = await clip._readClipboardItems();
					let foundItem = null;
					for (const item of (items || [])) {
						if (item.types.includes('text/html')) {
							foundItem = item;
							break;
						}
					}

					if (foundItem) {
						const blob = await foundItem.getType('text/html');
						html = await blob.text();
					}
				} catch (e) {
					html = '';
					readRefused = true;
				}
				if (html) {
					// preferInternal=false skips the pTransferClip shortcut,
					// so the most recent system-clipboard content wins.
					clip.dataTransferToDocument(null, false, html, false);
					this._phoneDeckMutationCompleted();
					return;
				}
				// B-0254: the Android WebView REFUSES the clipboard read. No
				// PermissionRequest resource exists for it on Android, so the
				// host cannot grant it. The fallback below then raised the
				// 'very limited access to the clipboard' sheet and never
				// pasted (redroid: Copy then Paste on card 3, 10 slides stayed
				// 10). Core still holds the slide that .uno:CopySlide put in
				// its own clipboard (pTransferClip), so paste it without the
				// system clipboard, the way the internal paste does. Only with
				// the phone chrome on the Android host (the B-0074/B-0094 gate,
				// _vulcanAndroidReadRefused): an Android tablet keeps the stock
				// chrome this phase, so it keeps the fallback below, and so does
				// desktop, where a refusal is the user's own permission answer.
				if (readRefused && clip._vulcanAndroidReadRefused()) {
					clip._doInternalPaste(this._map, false);
					this._phoneDeckMutationCompleted();
					return;
				}
			}

			// No usable HTML on the clipboard (or the native app reported an
			// internal copy): let the paste event / native clipboard bridge
			// drive things.
			clip.filterExecCopyPaste('.uno:Paste');
			this._phoneDeckMutationCompleted();
		} finally {
			this._pastePending = false;
		}
	},

	_isSelected: function (e) {
		var part = this._findClickedPart(e.target.parentNode);
		var partId = parseInt(part) - 1; // The first part is just a drop-site for reordering.
		if (partId < 0)
			return false;
		else
			return app.impress.isSlideSelected(partId);
	},

	_setPart: function (e, previewFrame) {
		const editingComment = cool.Comment.isAnyEdit();
		if (editingComment) {
			const commentSection = app.sectionContainer.getSectionWithName(app.CSections.CommentList.name);
			if (commentSection) {
				commentSection.navigateAndFocusComment(editingComment);
			}
			return;
		}
		if (this._isPhonePresentationSelectionSurface())
			this._phoneDeleteUndoSelection = null;

		var part = this._findClickedPart(previewFrame || e.target.parentNode);
		if (part !== -1) {
			var partId = parseInt(part) - 1; // The first part is just a drop-site for reordering.

			if (app.file.fileBasedView) {
				this._map.setPart(partId);
				this._scrollViewToPartPosition(partId);
				return;
			}

			if (e.ctrlKey) {
				this._map.selectPart(partId, 2, false); // Toggle selection on ctrl+click.
			} else if (e.altKey) {
				window.app.console.log('alt');
			} else if (e.shiftKey) {
				this._selectPartRange(this._map._docLayer._selectedPart, partId);
			} else {
				this._map.deselectAll();
				this._map.setPart(partId);
				this._map.selectPart(partId, 1, false); // And select.
			}
		}
	},

	_selectPartRange: function (start, end, scrollToEnd = true) {
		if (start === undefined || start === null)
			start = this._map._docLayer._selectedPart;

		var maxIndex = this._partsPreviewCont.children.length - 1;
		start = Math.max(0, Math.min(start, maxIndex));
		end = Math.max(0, Math.min(end, maxIndex));

		//deselect all slides
		this._map.deselectAll();

		//reselect the first original selection
		this._map.setPart(start);
		this._map.selectPart(start, 1, false);

		if (start < end) {
			for (var id = start + 1; id <= end; ++id) {
				this._map.selectPart(id, 1, false);
			}
		} else if (start > end) {
			for (id = start - 1; id >= end; --id) {
				this._map.selectPart(id, 1, false);
			}
		}
		this._selectedPartRange = [start, end];
		if (scrollToEnd)
			this._scrollToPart(end);
	},

	_modifySelectedPartRange: function (direction) {
		var start, end;
		if (this._selectedPartRange) {
			start = this._selectedPartRange[0];
			end = this._selectedPartRange[1];
		} else {
			start = end = this._map._docLayer._selectedPart;
		}

		if (direction === "UP")
			this._selectPartRange(start, end - 1);
		if (direction === "DOWN")
			this._selectPartRange(start, end + 1);
	},

	_updatePart: function (e) {
		if ((e.docType === 'presentation' || e.docType === 'drawing') && e.part >= 0) {
			var box = this._previewRequestBox();
			this._map.getPreview(e.part, e.part, box.maxWidth, box.maxHeight, {autoUpdate: this.options.autoUpdate});
		}
	},

	_syncPreviews: function () {
		var it = 0;

		if (app.impress.partList.length !== this._previewTiles.length) {
			if (Math.abs(app.impress.partList.length - this._previewTiles.length) === 1) {
				if (app.impress.partList.length > this._previewTiles.length) {
					for (it = 0; it < app.impress.partList.length; it++) {
						if (it === this._previewTiles.length) {
							this._insertPreview({selectedPart: it - 1, hashCode: app.impress.partList[it].hash});
							break;
						}
						if (this._previewTiles[it].hash !== app.impress.partList[it].hash) {
							// new slide is at it; _insertPreview adds at selectedPart + 1
							this._insertPreview({selectedPart: it - 1, hashCode: app.impress.partList[it].hash});
							break;
						}
					}
				}
				else {
					for (it = 0; it < this._previewTiles.length; it++) {
						if (it === app.impress.partList.length ||
						    this._previewTiles[it].hash !== app.impress.partList[it].hash) {
							this._deletePreview({selectedPart: it});
							break;
						}
					}
				}
			}
			else {
				// sync all, should never happen
				while (this._previewTiles.length < app.impress.partList.length) {
					this._insertPreview({selectedPart: this._previewTiles.length - 1,
							     hashCode: app.impress.partList[this._previewTiles.length].hash});
				}

				while (this._previewTiles.length > app.impress.partList.length) {
					this._deletePreview({selectedPart: this._previewTiles.length - 1});
				}

				for (it = 0; it < app.impress.partList.length; it++) {
					this._previewTiles[it].hash = app.impress.partList[it].hash;
					this._previewTiles[it].src = document.querySelector('meta[name="previewSmile"]').content;
					this._previewTiles[it].fetched = false;
				}
			}
		}
		else {
			// The same number of slides with hashes at new indices means the
			// slides were reordered (or an index holds a new slide). A part's
			// hash stays the same for its whole lifetime, so the preview
			// image that already carries it can move to the part's new index
			// and show up there immediately; only a hash no preview carries
			// needs a fetch.
			const previewByHash = {};
			for (it = 0; it < this._previewTiles.length; it++) {
				if (this._previewTiles[it].hash) {
					previewByHash[this._previewTiles[it].hash] = {
						src: this._previewTiles[it].src,
						fetched: this._previewTiles[it].fetched
					};
				}
			}
			for (it = 0; it < app.impress.partList.length; it++) {
				const newHash = app.impress.partList[it].hash;
				if (this._previewTiles[it].hash !== newHash) {
					this._previewTiles[it].hash = newHash;
					const knownPreview = newHash ? previewByHash[newHash] : undefined;
					if (knownPreview) {
						this._previewTiles[it].src = knownPreview.src;
						this._previewTiles[it].fetched = knownPreview.fetched;
					} else {
						var box = this._previewRequestBox();
						this._map.getPreview(it, it, box.maxWidth, box.maxHeight, {autoUpdate: this.options.autoUpdate});
					}
				}
			}
			// A moved preview that was never fetched keeps its placeholder;
			// fetch the ones that are in view now.
			this._ensureVisiblePreviews();
		}
	},

	_resize: function () {
		if (this._height == window.innerHeight &&
		    this._width == window.innerWidth)
			return;

		if (this._previewInitialized) {
			// A rotation swaps the phone card strip for the stock landscape
			// rail, and the two ask for different preview boxes. The inline
			// size is only written when a preview is (re)requested, so
			// without this the size fitted for the old orientation survives
			// into the new one's CSS. Nothing else can reach this branch:
			// every other form factor's box is orientation-independent.
			var cardStrip = this._isPhoneCardStrip();
			if (cardStrip !== this._phoneCardStripApplied)
				this._invalidateParts();

			clearTimeout(this._resizeTimer);
			this._resizeTimer = setTimeout(window.L.bind(this._onScroll, this), 50);
		}

		this._height = window.innerHeight;
		this._width = window.innerWidth;
	},

	_beforeRequestPreview: function (e) {
		if (e.part !== undefined && e.part >= 0 && e.part < this._previewTiles.length) {
			// The response comes back carrying this part index; the hash
			// remembers which slide that index held when the request went
			// out, in case the previews get reordered in the meantime.
			this._pendingPreviewHashes[e.part] = this._previewTiles[e.part].hash;
			if (this._previewTiles[e.part].src === document.querySelector('meta[name="previewSmile"]').content)
				this._previewTiles[e.part].src = document.querySelector('meta[name="previewImg"]').content;
		}
	},

	_updatePreview: function (e) {
		if (this._map.isPresentationOrDrawing()) {
			this._map._previewRequestsOnFly--;
			if (this._map._previewRequestsOnFly < 0) {
				this._map._previewRequestsOnFly = 0;
				this._map._timeToEmptyQueue = new Date();
			}
			this._map._processPreviewQueue();
			if (!this._previewInitialized)
				return;
			const partId = parseInt(e.id);
			let tile = this._previewTiles[partId];
			const requestHash = this._pendingPreviewHashes[partId];
			delete this._pendingPreviewHashes[partId];
			if (requestHash && (!tile || tile.hash !== requestHash)) {
				// The previews were reordered while the request was under
				// way; the image belongs to the slide that held this index
				// when the request went out. Without that slide the image
				// has no preview to go to.
				tile = this._previewTiles.find(function (candidate) {
					return candidate.hash === requestHash;
				});
			}
			if (tile) {
				tile.src = e.tile.src;
				tile.fetched = true;
				window.app.console.debug('PREVIEW: part fetched : ' + partId);
			}
		}
	},

	_insertPreview: function (e) {
		if (this._map.isPresentationOrDrawing()) {
			// The frames are about to change; a drag in progress cannot
			// keep its collapsed frames and gap bookkeeping.
			this._finishDrag(false);
			var newIndex = e.selectedPart + 1;
			var newPreview = this._createPreview(newIndex, (e.hashCode === undefined ? null : e.hashCode));

			// insert newPreview to newIndex position
			this._previewTiles.splice(newIndex, 0, newPreview);
			// newPreview already carries the right label from _createPreview;
			// everything after it moved up by one position.
			this._updatePreviewPositionLabelsFrom(newIndex + 1);

			var newFrame = newPreview.parentNode;
			if (e.selectedPart >= 0) {
				// after selectedPart's frame (null sibling appends at the end)
				var selectedFrame = this._previewTiles[e.selectedPart].parentNode;
				selectedFrame.parentNode.insertBefore(newFrame, selectedFrame.nextSibling);
			} else {
				// no preceding slide: before the old first tile, now at index 1
				var followingFrame = this._previewTiles[1] ? this._previewTiles[1].parentNode : null;
				newFrame.parentNode.insertBefore(newFrame, followingFrame);
			}

			this._ensureVisiblePreviews(); // Load previews

			// B-0247: follow the slide the user just added. The add-slide
			// button (and the card menu's New Slide / Duplicate / Paste on the
			// last card) makes the new slide current, but nothing on this
			// 'updateparts' path scrolled the strip, so its card was left off
			// screen: redroid, 10 slides, the new card at x 1156-1271 against
			// a 360 px strip at scrollLeft 0, with no strip scroll at all.
			// Only the CURRENT slide is followed (a collaborator's insert
			// does not move this user's strip), and only on the phone
			// chrome (desktop keeps the stock behaviour).
			if (this._isVulcanPhoneChrome() &&
				newIndex === this._map._docLayer._selectedPart)
				this._scrollToPart(newIndex);
		}
	},

	_deletePreview: function (e) {
		if (this._map.isPresentationOrDrawing()) {
			// The frames are about to change; a drag in progress cannot
			// keep its collapsed frames and gap bookkeeping.
			this._finishDrag(false);
			var selectedFrame = this._previewTiles[e.selectedPart].parentNode;
			window.L.DomUtil.remove(selectedFrame);

			this._previewTiles.splice(e.selectedPart, 1);
			// Everything after the removed preview moved down by one position.
			this._updatePreviewPositionLabelsFrom(e.selectedPart);
			if (this._map._deletePageFromPreview || this.partsFocused)
				this.focusCurrentSlide(); // came from focus + Delete key -> keep focus in preview
			else
				this._map.focus();

			this._map._deletePageFromPreview = false;
		}
	},

	_ensureVisiblePreviews: function () {
		if (this._previewTimer) clearTimeout(this._previewTimer);
		this._previewTimer = setTimeout(window.L.bind(function () {
			// R6-6: the phone read posture hides the strip outright
			// (vulcan-theme.css 13i.1c). Hidden, every getBoundingClientRect
			// below is 0x0 and the intersection test degenerates to TRUE for
			// every card — a browse-mode open would fetch the WHOLE deck's
			// previews. Refuse while the strip is not laid out;
			// _onVulcanPermissionChanged re-kicks this the moment edit entry
			// shows it. Phone chrome only: the desktop Navigation card's
			// sorter can also be hidden (panel closed) and stock has always
			// fetched there — that stays byte for byte.
			if (this._isVulcanPhoneChrome() &&
				this._partsPreviewCont &&
				this._partsPreviewCont.offsetParent === null)
				return;
			var box = this._previewRequestBox();
			for (var i = 0; i < this._previewTiles.length; ++i) {
				if (this._isPreviewVisible(i)) {
					var img = this._previewTiles[i];
					if (img && !img.fetched) {
						this._map.getPreview(i, i, box.maxWidth, box.maxHeight, {autoUpdate: this.options.autoUpdate});
					}
				}
			}
		}, this), 0);
	},

	_onScroll: function () {
		this._ensureVisiblePreviews();
	},

	// R6-6: the read posture hides the strip (vulcan-theme.css 13i.1c) and
	// the loader above refuses a hidden strip, so the flip INTO edit is the
	// moment the freshly shown cards must load — nothing else fires on the
	// posture flip alone. The measurement itself is deferred inside
	// _ensureVisiblePreviews (setTimeout 0), so by the time the strip is
	// measured the posture class flip has landed whatever order the
	// permission listeners ran in.
	_onVulcanPermissionChanged: function (e) {
		if (!e || !e.detail || e.detail.perm !== 'edit') return;
		if (!this._isVulcanPhoneChrome()) return;
		this._onScroll();
	},

	_isPreviewVisible: function(part) {
		var el = this._previewTiles[part];
		if (!el)
			return false;

		var elemRect = el.getBoundingClientRect();
		var viewRect = document.getElementById('slide-sorter').getBoundingClientRect();

		return (elemRect.left <= viewRect.right &&
			viewRect.left <= elemRect.right &&
			elemRect.top <= viewRect.bottom &&
			viewRect.top <= elemRect.bottom)
	},

	// Stricter than _isPreviewVisible, which asks whether the tile overlaps
	// the strip at all - the right question for "is it worth fetching this
	// bitmap", the wrong one for "has the user already got a good look at
	// it". A tile with a few pixels poking past the edge intersects, so the
	// intersection test declines to scroll and leaves the current slide
	// clipped at the end of the strip. Only a tile that is wholly inside the
	// strip needs no scrolling.
	_isPreviewFullyVisible: function(part) {
		var el = this._previewTiles[part];
		if (!el)
			return false;

		var elemRect = el.getBoundingClientRect();
		var viewRect = document.getElementById('slide-sorter').getBoundingClientRect();

		return (elemRect.left >= viewRect.left &&
			elemRect.right <= viewRect.right &&
			elemRect.top >= viewRect.top &&
			elemRect.bottom <= viewRect.bottom)
	},

	_addDnDHandlers: function (elem) {
		if (app.file.fileBasedView) // No drag & drop for pdf files and the like.
			return;

		if (elem) {
			elem.setAttribute('draggable', true);
			elem.addEventListener('dragstart', this._handleDragStart, false);
			elem.addEventListener('dragend', this._handleDragEnd, false);
			elem.partsPreview = this;
		}
	},

	// The insertion point moves with the pointer rather than being tied to
	// the frame under it, so the drag position and the drop are handled on
	// the whole sorter.
	_addContainerDnDHandlers: function () {
		if (app.file.fileBasedView || this._containerDnDHandlersAdded)
			return;

		this._partsPreviewCont.addEventListener('dragover', this._handleContainerDragOver.bind(this), false);
		this._partsPreviewCont.addEventListener('dragleave', this._handleContainerDragLeave.bind(this), false);
		this._partsPreviewCont.addEventListener('drop', this._handleContainerDrop.bind(this), false);
		this._containerDnDHandlersAdded = true;
	},

	_addDnDTouchHandlers: function (e, owner, frame, img) {
		// Hammer can report a second press before the first touch has released.
		// Keep the original owner/state intact so its teardown cannot be orphaned.
		if (this._previewTouchGesture)
			return;
		this._previewTouchGesture = { owner: owner, frame: frame, img: img };
		$(owner).bind('touchmove', this._handleTouchMove.bind(this));
		$(owner).bind('touchcancel', this._handleTouchCancel.bind(this));
		$(owner).bind('touchend', this._handleTouchEnd.bind(this));

		// To avoid having to add a new message to move an arbitrary part, let's select the
		// slide that is being dragged.
		var part = this._findClickedPart(frame);
		// -1, not null, is how _findClickedPart says the press landed outside
		// every frame; the old null test let that through as part -2, which
		// selectPart then dereferenced off the end of the part list.
		if (part !== -1) {
			var partId = parseInt(part) - 1; // The first part is just a drop-site for reordering.
			if (!this._preparePhoneSlidePress(partId)) {
				this._map.setPart(partId);
				this._map.selectPart(partId, 1, false); // And select.
			}
		}
		this.draggedSlide = window.L.DomUtil.create('img', '', document.body);
		this.draggedSlide.setAttribute('src', img.currentSrc);
		$(this.draggedSlide).css('position', 'absolute');
		$(this.draggedSlide).css('height', img.height);
		$(this.draggedSlide).css('width', img.width);
		$(this.draggedSlide).css('left', e.center.x - (img.width/2));
		$(this.draggedSlide).css('top', e.center.y - img.height);
		$(this.draggedSlide).css('z-index', '10');
		$(this.draggedSlide).css('opacity', '75%');
		$(this.draggedSlide).css('pointer-events', 'none');
		$('.preview-img').css('pointer-events', 'none');

		// google-slides.json (reorder slides): "drag the selection
		// horizontally to the new position. Neighbors part to show the drop
		// target." A touch drag used to get neither half of that: it held the
		// strip still, so only the positions already on screen were reachable,
		// and it marked the drop with a border on the frame under the finger
		// rather than by parting anything.
		//
		// So on the phone the touch drag runs the same _dragState the
		// drag-and-drop path runs. The pressed slides' frames close, the edge
		// auto-scroll steers off the same {pointer, autoScrollId} fields, and
		// _updateDropGap opens a slide-sized gap at the insertion point: the
		// neighbours part. _handleTouchEnd then drops on that gap's
		// insertIndex, so what the gap shows and where the slide lands are the
		// same number.
		//
		// includeSelection is true: the press above just set the selection,
		// and 'moveselectedclientparts' moves whatever is selected, so the
		// frames that close have to be exactly the slides app.impress reports
		// as selected -- which is what _beginDrag(_, true) collects.
		//
		// Phone-gated on BOTH halves (?vulcanChrome=desktop forces desktop
		// chrome on a phone-sized screen). With the gate false _dragState
		// stays null here, every touch handler below takes its pre-existing
		// dropsite-highlight path, and the drag behaves exactly as before.
		if (this._isVulcanPhoneChrome() && part !== -1 && partId >= 0) {
			// The ghost's own size was fixed above from img, so the grab
			// offset is taken from the same measurement at the same moment
			// rather than re-read from the live picture on every move: the
			// frame under it is about to collapse, and a ghost whose offset
			// and size disagree would slide out from under the finger.
			this._touchGhostGrab = { x: img.width / 2, y: img.height };
			this._beginDrag(partId, true);
			this._dragState.touchOrigin = { x: e.center.x, y: e.center.y };
			this._dragState.touchDragStarted = false;
		}

		this.currentNode = null;
		this.previousNode = null;
	},

	_removeDnDTouchHandlers: function () {
		var gesture = this._previewTouchGesture;
		if (gesture && gesture.owner) {
			$(gesture.owner).unbind('touchmove');
			$(gesture.owner).unbind('touchcancel');
			$(gesture.owner).unbind('touchend');
		}
		this._previewTouchGesture = null;
		$('.preview-img').css('pointer-events', '');

		// A phone touch drag's own state is _dragState, ended by the
		// _finishDrag call in _handleTouchEnd/_handleTouchCancel -- which also
		// cancels its auto-scroll frame. Only the ghost's grab offset is left.
		this._touchGhostGrab = null;
	},

	// The drop-site highlight for the frame under a point, and the
	// this.currentNode that _handleTouchEnd reads as the drop position.
	// Called from touchmove, and from the edge auto-scroll, which moves the
	// frames under a finger that is holding still.
	_updateTouchDropTarget: function (clientX, clientY) {
		this.currentNode = document.elementFromPoint(clientX, clientY);

		if (this.currentNode !== this.previousNode && this.previousNode !== null) {
			$('.preview-frame').removeClass('preview-img-dropsite');
		}

		if (this.currentNode.draggable || this.currentNode.id === 'first-drop-site') {
			this.currentNode.classList.add('preview-img-dropsite');
		}

		this.previousNode = this.currentNode;
	},

	_handleTouchMove: function (e) {
		if (e.preventDefault) {
			e.preventDefault();
		}
		const gesture = this._previewTouchGesture;
		const img = gesture && gesture.img;
		if (!img)
			return false;

		const touchX = e.originalEvent.touches[0].clientX;
		const touchY = e.originalEvent.touches[0].clientY;

		// A phone drag (_dragState set in _addDnDTouchHandlers) shows the drop
		// position by parting the neighbours, and the under-the-finger
		// highlight is deliberately not applied on top of it: the two do not
		// always name the same position -- with the finger on the left half of
		// a slide the gap opens before that slide while the highlight sits on
		// it -- and only the gap matches where the release inserts.
		//
		// The finger position also feeds the shared edge auto-scroll, which
		// only scrolls the strip's own scrollLeft/scrollTop, never
		// scrollIntoView, so it cannot walk up to the page and yank it
		// vertically.
		const state = this._dragState;
		if (state) {
			if (this._shouldUpdatePhoneTouchDrag(state, touchX, touchY)) {
				state.pointer = { x: touchX, y: touchY };
				this._updateDropGap();
				this._ensureAutoScroll();
			}
		} else {
			this._updateTouchDropTarget(touchX, touchY);
		}

		const grab = state && this._touchGhostGrab ?
			this._touchGhostGrab : { x: img.width / 2, y: img.height };
		$(this.draggedSlide).css('left', touchX - grab.x);
		$(this.draggedSlide).css('top', touchY - grab.y);
		return false;
	},

	_handleTouchCancel: function() {
		// A cancelled phone drag puts the slides back: the gap closes and the
		// collapsed frames grow again at their original position.
		this._finishDrag(true);
		$('.preview-frame').removeClass('preview-img-dropsite');
		$('.slide-section-dropsite').removeClass('slide-section-dropsite');
		$(this.draggedSlide).remove();
		this._removeDnDTouchHandlers();
	},

	_handleTouchEnd: function (e) {
		if (e.stopPropagation) {
			e.stopPropagation();
		}
		// A phone drag drops on the gap it has been showing. insertIndex is
		// the slide the dragged ones go in front of, so position is the slide
		// they land after (-1 = the front of the deck) -- the same message and
		// the same instant local settle _handleContainerDrop sends, off the
		// same field, so the parting and the drop cannot disagree.
		//
		// insertIndex is null when the finger never moved (no pointer, so no
		// gap was ever placed): that is a long-press with no drag, not a
		// reorder, and it puts the slide back rather than moving it.
		// A long press that never moved is not a cancelled reorder, it is
		// Google's slide-selection gesture, and it is where SKIP SLIDE lives
		// on a phone (parity matrix row 23).
		//
		// google-slides.json is explicit that these are the SAME press:
		// "Drag-to-reorder slides" is "Long-press a slide in the filmstrip
		// (optionally tap more to select several), THEN drag the selection
		// horizontally"; "Slide long-press multi-select in filmstrip" is
		// "Touch and hold a slide in the bottom strip to select it"; and
		// "Skip slide / Show slide" is "Long-press a slide, More > Skip
		// Slide". One gesture, and what it does is decided by whether the
		// finger then travels. So no new gesture is invented here and none is
		// taken away — the drag keeps the press it already had, and the press
		// that ends where it started stops being a no-op.
		//
		// WHY THE MENU WAS UNREACHABLE, since the entries themselves are not
		// new: Show slide / Hide slide have been in the card menu the whole
		// time (see openCardMenu in _createPreview, which pushes one or the
		// other off app.impress.isSlideHidden and is NOT among the two rows
		// the phone gate removes). The menu's only opener was a DOM
		// `contextmenu` bind, and on the phone strip the long-press slot that
		// would raise it is taken by the Hammer.Press that arms this drag
		// (_createPreview -> _addDnDTouchHandlers), which additionally sets
		// `pointer-events: none` on every .preview-img for the duration. The
		// gap was the opener, not the command.
		//
		// The idiom is the house one: Control.Tabs.js answers Hammer.Press on
		// a sheet tab by opening that tab's menu on small screens. Same
		// gesture, same "the press IS the menu" contract; the only difference
		// is that a slide card's press has to let a drag win first, which is
		// what the insertIndex test below is.
		//
		// Already both-halves gated, with nothing added: _dragState is only
		// ever set under this._isVulcanPhoneChrome() (_addDnDTouchHandlers),
		// so ?vulcanChrome=desktop takes the `else if (this.currentNode)`
		// path below and behaves exactly as it does today.
		var pressNoDrag = null;
		const gesture = this._previewTouchGesture;
		const dragState = this._dragState;
		if (dragState) {
			if (dragState.insertIndex === null) {
				this._finishDrag(true);
				this._setPhoneSlideSelectionMode(true);
				// Opened after the cleanup at the bottom of this function,
				// not here: _removeDnDTouchHandlers has to restore
				// `pointer-events` on the cards first, or the menu would come
				// up over a strip that cannot be tapped.
				pressNoDrag = gesture && gesture.img;
			} else {
				app.socket.sendMessage('moveselectedclientparts position=' +
					(dragState.insertIndex - 1));
				this._applyDropLocally(dragState.insertIndex, dragState.draggedParts);
				this._finishDrag(false);
			}
		} else if (this.currentNode) {
			var part = this._findClickedPart(this.currentNode);
			// A release that landed on no frame at all - the strip's own
			// background, the dead band under the cards, anywhere off the
			// strip - is not a drop position. _findClickedPart says so with
			// -1, which the old null test let through: -1 - 1 clamped back to
			// -1 and moved the slide to the front of the deck instead.
			if (part !== -1) {
				var partId = parseInt(part) - 1; // First frame is a drop-site for reordering.
				if (partId < 0)
					partId = -1; // First item is -1.
				app.socket.sendMessage('moveselectedclientparts position=' + partId);
			}
		}
		$('.preview-frame').removeClass('preview-img-dropsite');
		$('.slide-section-dropsite').removeClass('slide-section-dropsite');
		$(this.draggedSlide).remove();
		this._removeDnDTouchHandlers();
		if (pressNoDrag)
			this._completePhoneSlideLongPress(pressNoDrag, e);
		return false;
	},

	// Raise the card menu for a long press that ended where it began.
	//
	// It calls the SAME openCardMenu the desktop `contextmenu` listener calls,
	// through the reference _createPreview stashed on the card, rather than
	// building a second list of entries. That is the point: Show slide / Hide
	// slide, Copy, Paste, New slide, Duplicate and Delete are defined once,
	// the read-only filter at the end of that function applies once, and a row
	// added to the desktop menu later cannot silently miss the phone.
	//
	// The argument is a plain object rather than a synthesised MouseEvent
	// because that function only ever reads five things off its event, and a
	// real dispatched `contextmenu` would additionally bubble to the FRAME's
	// own listener (Paste / New slide, for the gap between cards) — a second,
	// wrong menu behind the right one. openCardMenu guards that for the mouse
	// with e.stopPropagation(); calling it directly means there is nothing to
	// stop.
	//
	// The coordinates are the release point, which for a press with no drag is
	// also the press point, so the menu opens under the finger that asked for
	// it.
	_openCardMenuFromPress: function (img, touchEvent) {
		if (!img || typeof img.vulcanOpenCardMenu !== 'function')
			return;

		var touch = touchEvent && touchEvent.originalEvent &&
			touchEvent.originalEvent.changedTouches &&
			touchEvent.originalEvent.changedTouches[0];
		// A release with no reported touch point still gets a menu, anchored
		// to the card instead of to the finger: losing the only phone route to
		// Skip slide is worse than a menu that opens a few pixels off.
		var rect = img.getBoundingClientRect();
		var clientX = touch ? touch.clientX : rect.left + rect.width / 2;
		var clientY = touch ? touch.clientY : rect.top + rect.height / 2;

		var noop = function () {};
		img.vulcanOpenCardMenu({
			target: img,
			clientX: clientX,
			clientY: clientY,
			preventDefault: noop,
			stopPropagation: noop,
		});
	},

	_handleDragStart: function (e) {
		const partsPreview = this.partsPreview;
		if (!partsPreview._map.isEditMode()) {
			e.preventDefault();
			return;
		}
		// To avoid having to add a new message to move an arbitrary part, let's select the
		// slide that is being dragged.
		const targetNode = (e.target.id.startsWith('preview') ? e.target : e.target.parentNode);
		const part = partsPreview._findClickedPart(targetNode);
		const partId = parseInt(part) - 1; // The first part is just a drop-site for reordering.
		if (part === -1 || partId < 0) {
			e.preventDefault();
			return;
		}
		const alreadySelected = app.impress.isSlideSelected(partId);
		if (partsPreview._map._docLayer && !alreadySelected)
		{
			// Same selection change as a plain click on the slide: the
			// previous selection is dropped on the client and the server
			// alike, so both agree on which slides the move applies to.
			partsPreview._map.deselectAll();
			partsPreview._map.setPart(partId);
			partsPreview._map.selectPart(partId, 1, false); // And select.
		}
		// By default we move when dragging, but can
		// support duplication with ctrl in the future.
		e.dataTransfer.effectAllowed = 'move';
		e.dataTransfer.setData('application/x-cool-slide', String(partId));

		// The drag ghost is the slide picture at its on-screen size with
		// the standard preview border, held at the grab point.
		const img = partsPreview._previewTiles[partId];
		if (img && e.dataTransfer.setDragImage) {
			const rect = img.getBoundingClientRect();
			const ghost = document.createElement('div');
			ghost.className = 'slide-drag-ghost';
			const ghostImg = document.createElement('img');
			ghostImg.src = img.src;
			ghostImg.style.width = rect.width + 'px';
			ghostImg.style.height = rect.height + 'px';
			ghost.appendChild(ghostImg);
			document.body.appendChild(ghost);
			e.dataTransfer.setDragImage(ghost, e.clientX - rect.left, e.clientY - rect.top);
			// The snapshot is taken when the dragstart handler returns;
			// the ghost element itself is no longer needed after that.
			setTimeout(function () { ghost.remove(); }, 0);
		}

		partsPreview._beginDrag(partId, alreadySelected);
	},

	// Collect the slides taking part in the drag and start the drag
	// visuals: the dragged frames close smoothly, so the remaining slides
	// move in to take their place.
	_beginDrag: function (partId, includeSelection) {
		const draggedParts = [];
		if (includeSelection) {
			for (let i = 0; i < this._previewTiles.length; i++) {
				if (i === partId || app.impress.isSlideSelected(i))
					draggedParts.push(i);
			}
		} else {
			draggedParts.push(partId);
		}

		// In the horizontal sorter layout the frames close and the gap
		// opens along the x axis.
		const sizeProperty = this._direction === 'x' ? 'width' : 'height';
		const frames = [];
		const sizes = [];
		let gapSize = 0;
		for (let i = 0; i < draggedParts.length; i++) {
			const frame = this._previewTiles[draggedParts[i]].parentNode;
			const size = frame.getBoundingClientRect()[sizeProperty];
			frames.push(frame);
			sizes.push(size);
			gapSize += size;
		}

		this._dragState = {
			draggedParts: draggedParts,
			frames: frames,
			sizes: sizes,
			sizeProperty: sizeProperty,
			gapSize: gapSize,
			gapFrame: null,
			gapSide: null,
			insertIndex: null,
			pointer: null,
			autoScrollId: null
		};

		this._partsPreviewCont.classList.add('dragging-slide');

		// The browser takes its snapshot for the drag ghost when the
		// dragstart handler returns, so the collapse runs afterwards and
		// the ghost shows the frame at full size.
		const state = this._dragState;
		setTimeout(() => {
			if (this._dragState !== state)
				return;
			for (let i = 0; i < frames.length; i++) {
				frames[i].style.boxSizing = 'border-box';
				frames[i].style[sizeProperty] = sizes[i] + 'px';
				frames[i].style.overflow = 'hidden';
			}
			// Give the frames their measured size first, so the change
			// animates from the real value.
			void this._partsPreviewCont.offsetHeight;
			for (let i = 0; i < frames.length; i++) {
				frames[i].style[sizeProperty] = '0px';
				frames[i].style.padding = '0px';
				frames[i].style.opacity = '0';
			}
			// Closing the dragged frames pulls slides from below the view
			// into it; load their previews once the frames have closed.
			this._schedulePreviewRefresh();
		}, 0);
	},

	// Load the previews that a layout change brought into view, once the
	// size and margin transitions have settled. Debounced, and fetching
	// stays limited to slides that are visible and have no preview yet.
	_schedulePreviewRefresh: function () {
		clearTimeout(this._layoutPreviewTimer);
		this._layoutPreviewTimer = setTimeout(() => {
			this._layoutPreviewTimer = null;
			this._ensureVisiblePreviews();
		}, 200);
	},

	_handleContainerDragOver: function (e) {
		const state = this._dragState;
		// A drag that did not start on a slide (a file from the desktop,
		// for example) has no drop target here; refusing it keeps the
		// browser from opening the file in place of the editor.
		if (!state) {
			e.preventDefault();
			if (e.dataTransfer)
				e.dataTransfer.dropEffect = 'none';
			return;
		}

		// Over a section header the header itself is the drop target and
		// shows its own highlight, so no insertion gap. Clearing the
		// pointer also pauses the edge auto-scroll.
		if (e.target && e.target.closest && e.target.closest('.slide-section-header')) {
			this._removeDropGap(state);
			state.insertIndex = null;
			state.pointer = null;
			return;
		}

		e.preventDefault();
		if (e.dataTransfer)
			e.dataTransfer.dropEffect = 'move';

		// dragover keeps firing while the pointer rests; the gap only
		// needs recomputing when the pointer moved.
		if (state.pointer && state.pointer.x === e.clientX && state.pointer.y === e.clientY)
			return;

		state.pointer = { x: e.clientX, y: e.clientY };
		this._updateDropGap();
		this._ensureAutoScroll();
	},

	_handleContainerDragLeave: function (e) {
		const state = this._dragState;
		if (!state)
			return;
		// Moving between children of the sorter also fires dragleave, on
		// some browsers with a null relatedTarget; the gap only closes
		// when the pointer really left the sorter area.
		if (e.relatedTarget && this._partsPreviewCont.contains(e.relatedTarget))
			return;
		const rect = this._partsPreviewCont.getBoundingClientRect();
		if (e.clientX >= rect.left && e.clientX < rect.right &&
		    e.clientY >= rect.top && e.clientY < rect.bottom)
			return;
		this._removeDropGap(state);
		state.insertIndex = null;
		state.pointer = null;
	},

	_handleContainerDrop: function (e) {
		const state = this._dragState;
		if (!state) {
			e.preventDefault();
			return;
		}
		e.preventDefault();
		e.stopPropagation();

		const insertIndex = state.insertIndex;
		if (insertIndex === null) {
			this._finishDrag(true);
			return;
		}

		// Insert after the slide preceding the gap; -1 inserts before the
		// first slide.
		app.socket.sendMessage('moveselectedclientparts position=' + (insertIndex - 1));

		this._applyDropLocally(insertIndex, state.draggedParts);
		this._finishDrag(false);
	},

	// Choose the insertion point from the pointer position and open a
	// slide-sized gap there. The gap is a margin on the frame the dragged
	// slides would be inserted before (or after the last frame, when the
	// pointer is past it), and it moves along with the pointer.
	_updateDropGap: function () {
		const state = this._dragState;
		if (!state || !state.pointer)
			return;

		const horizontal = this._direction === 'x';
		const pointerPosition = horizontal ? state.pointer.x : state.pointer.y;

		let insertIndex = this._previewTiles.length;
		let gapFrame = null;
		let gapSide = 'before';
		let lastFrame = null;
		for (let i = 0; i < this._previewTiles.length; i++) {
			if (state.draggedParts.indexOf(i) !== -1)
				continue;
			const frame = this._previewTiles[i].parentNode;
			if (frame.classList.contains('section-collapsed'))
				continue;
			const rect = frame.getBoundingClientRect();
			const middle = horizontal ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
			if (pointerPosition < middle) {
				insertIndex = i;
				gapFrame = frame;
				break;
			}
			lastFrame = frame;
		}
		if (!gapFrame && lastFrame) {
			gapFrame = lastFrame;
			gapSide = 'after';
		}

		state.insertIndex = insertIndex;
		if (gapFrame === state.gapFrame && gapSide === state.gapSide)
			return;

		this._removeDropGap(state);
		state.gapFrame = gapFrame;
		state.gapSide = gapSide;
		if (gapFrame)
			gapFrame.style[this._gapMarginProperty(gapSide)] = state.gapSize + 'px';

		// A gap move shifts the slides around it; load the previews of the
		// ones it brought into view.
		this._schedulePreviewRefresh();
	},

	_gapMarginProperty: function (side) {
		if (this._direction === 'x')
			return side === 'before' ? 'marginLeft' : 'marginRight';
		return side === 'before' ? 'marginTop' : 'marginBottom';
	},

	_removeDropGap: function (state) {
		if (!state || !state.gapFrame)
			return;
		state.gapFrame.style[this._gapMarginProperty(state.gapSide)] = '';
		state.gapFrame = null;
		state.gapSide = null;
	},

	// Scroll the sorter when the pointer is near one of its edges during a
	// drag, so slides outside the visible area can be reached. Runs as an
	// animation frame loop; the speed grows the closer the pointer is to
	// the edge, and the loop ends when the pointer moves away from it.
	//
	// One state serves both drags that can want it -- the HTML5
	// drag-and-drop one on a pointer device and the phone's touch drag --
	// because the phone touch drag is a _dragState too. They never overlap:
	// dragstart does not fire for a touch drag.
	_autoScrollStep: function () {
		const state = this._dragState;
		if (!state)
			return;
		state.autoScrollId = null;
		if (!state.pointer)
			return;

		const horizontal = this._direction === 'x';
		const rect = this._partsPreviewCont.getBoundingClientRect();
		const zone = 48;
		const maxSpeed = 14;
		const pointerPosition = horizontal ? state.pointer.x : state.pointer.y;
		const start = horizontal ? rect.left : rect.top;
		const end = horizontal ? rect.right : rect.bottom;

		let speed = 0;
		if (pointerPosition < start + zone)
			speed = -maxSpeed * Math.min(1, (start + zone - pointerPosition) / zone);
		else if (pointerPosition > end - zone)
			speed = maxSpeed * Math.min(1, (pointerPosition - (end - zone)) / zone);
		if (!speed)
			return;

		if (horizontal)
			this._partsPreviewCont.scrollLeft += speed;
		else
			this._partsPreviewCont.scrollTop += speed;

		// Scrolling moved the frames under the pointer, so the insertion gap
		// is re-placed: it keeps naming the position the finger is over as
		// slides scroll past under a finger that is holding still.
		this._updateDropGap();

		state.autoScrollId = requestAnimationFrame(this._autoScrollStep.bind(this));
	},

	_ensureAutoScroll: function () {
		const state = this._dragState;
		if (state && state.autoScrollId === null)
			state.autoScrollId = requestAnimationFrame(this._autoScrollStep.bind(this));
	},

	// Rearrange the local previews into the order the server will confirm.
	// The sorter settles instantly, each preview image travels with its
	// slide, and the status update that follows finds every preview
	// already at its part's index. intoSection is true when the slides
	// become the first slides of the section starting at the insertion
	// point, and false when they stay outside it.
	_applyDropLocally: function (insertIndex, draggedParts, intoSection) {
		const draggedTiles = [];
		for (let i = 0; i < draggedParts.length; i++)
			draggedTiles.push(this._previewTiles[draggedParts[i]]);
		// The frames land in front of the first slide at or after the
		// insertion point that is not itself being dragged.
		let anchorIndex = insertIndex;
		while (anchorIndex < this._previewTiles.length &&
		       draggedParts.indexOf(anchorIndex) !== -1)
			anchorIndex++;
		const anchorTile = anchorIndex < this._previewTiles.length ?
			this._previewTiles[anchorIndex] : null;

		// The client's part bookkeeping moves along, so selection changes
		// made before the server confirms the move already address the
		// parts at their new indices.
		const parts = app.impress.partList;
		if (parts && parts.length === this._previewTiles.length) {
			const draggedEntries = [];
			for (let i = 0; i < draggedParts.length; i++)
				draggedEntries.push(parts[draggedParts[i]]);
			const anchorEntry = anchorIndex < parts.length ? parts[anchorIndex] : null;
			const remainingEntries = parts.filter(function (entry) {
				return draggedEntries.indexOf(entry) === -1;
			});
			const entriesInsertAt = anchorEntry ?
				remainingEntries.indexOf(anchorEntry) : remainingEntries.length;
			Array.prototype.splice.apply(remainingEntries,
				[entriesInsertAt, 0].concat(draggedEntries));
			app.impress.partList = remainingEntries;
		}

		this._previewTiles = this._previewTiles.filter(function (tile) {
			return draggedTiles.indexOf(tile) === -1;
		});
		let anchorNode = anchorTile ? anchorTile.parentNode : null;
		// When the slides stay outside the section that starts at the
		// anchor, they also go in front of its header.
		if (!intoSection && anchorNode) {
			const nodeBefore = anchorNode.previousElementSibling;
			if (nodeBefore && nodeBefore.classList.contains('slide-section-header'))
				anchorNode = nodeBefore;
		}
		for (let i = 0; i < draggedTiles.length; i++) {
			const frame = draggedTiles[i].parentNode;
			// Moving takes a slide out of its section; when it lands in a
			// collapsed one, the next sections update hides it again.
			frame.classList.remove('section-collapsed');
			this._partsPreviewCont.insertBefore(frame, anchorNode);
		}
		const insertAt = anchorTile ?
			this._previewTiles.indexOf(anchorTile) : this._previewTiles.length;
		Array.prototype.splice.apply(this._previewTiles, [insertAt, 0].concat(draggedTiles));

		// The visible digit, alt text and tooltip are positional, so
		// renumber every preview after the previews change order.
		this._updatePreviewPositionLabelsFrom(0);
	},

	// End the drag visuals. After a completed drop (animate = false) the
	// dragged frames have just been moved into the gap, so restoring their
	// size while the gap margin goes away in the same step is not a visible
	// change. After a cancelled drag (animate = true) the gap closes and
	// the dragged frames grow back at their original position.
	_finishDrag: function (animate) {
		const state = this._dragState;
		if (!state)
			return;
		this._dragState = null;

		if (state.autoScrollId !== null)
			cancelAnimationFrame(state.autoScrollId);

		const container = this._partsPreviewCont;
		const restoreFrame = function (frame) {
			frame.style.width = '';
			frame.style.height = '';
			frame.style.padding = '';
			frame.style.opacity = '';
			frame.style.overflow = '';
			frame.style.boxSizing = '';
		};

		if (!animate)
			container.classList.add('drag-no-transition');

		this._removeDropGap(state);

		if (!animate) {
			state.frames.forEach(restoreFrame);
			void container.offsetHeight;
			container.classList.remove('drag-no-transition');
			container.classList.remove('dragging-slide');
			this._schedulePreviewRefresh();
			return;
		}

		// Grow the frames back to their measured size so the change
		// animates, then drop the inline styles once the transition is over.
		for (let i = 0; i < state.frames.length; i++) {
			state.frames[i].style[state.sizeProperty] = state.sizes[i] + 'px';
			state.frames[i].style.padding = '';
			state.frames[i].style.opacity = '';
		}
		const that = this;
		setTimeout(function () {
			// A drag that started during the restore owns the drag visuals:
			// its frames keep their styles and the container keeps its class.
			const activeDrag = that._dragState;
			for (let i = 0; i < state.frames.length; i++) {
				if (!activeDrag || activeDrag.frames.indexOf(state.frames[i]) === -1)
					restoreFrame(state.frames[i]);
			}
			if (!activeDrag)
				container.classList.remove('dragging-slide');
			that._schedulePreviewRefresh();
		}, 200);
	},

	_handleDragEnd: function () {
		// Reached without a drop when the drag was cancelled or released
		// outside a drop target: put the dragged slides back where they were.
		this.partsPreview._finishDrag(true);
		document.querySelectorAll('.slide-section-dropsite').forEach(function (el) {
			el.classList.remove('slide-section-dropsite');
		});
	},

	_invalidateParts: function () {
		if (!this._container ||
		    !this._partsPreviewCont ||
		    !this._previewInitialized ||
		    !this._previewTiles)
			return;

		var box = this._previewRequestBox();
		this._phoneCardStripApplied = this._isPhoneCardStrip();
		for (var part = 0; part < this._previewTiles.length; part++) {
			this._previewTiles[part].fetched = false;
			var imgSize = this._map.getPreview(part, part,
					     box.maxWidth,
					     box.maxHeight,
					     {autoUpdate: this.options.autoUpdate,
					      fetchThumbnail: this.options.fetchThumbnail});
			window.L.DomUtil.setStyle(this._previewTiles[part], 'width', imgSize.width + 'px');
			window.L.DomUtil.setStyle(this._previewTiles[part], 'height', imgSize.height + 'px');
		}

	},

	_invalidateCurrentPart: function () {
		if (!this._container ||
		    !this._partsPreviewCont ||
		    !this._previewInitialized ||
		    !this._previewTiles)
			return;

		// When a new slide is inserted
		if (this._previewTiles[this._map._docLayer._selectedPart] === undefined) {
			this._invalidateParts();
			return;
		}
		this._previewTiles[this._map._docLayer._selectedPart].fetched = false;
		var box = this._previewRequestBox();
		this._map.getPreview(this._map._docLayer._selectedPart, this._map._docLayer._selectedPart,
				     box.maxWidth,
				     box.maxHeight,
				     {autoUpdate: this.options.autoUpdate,
				      fetchThumbnail: this.options.fetchThumbnail});
	},

	focusCurrentSlide: function () {
		if (this._previewTiles[this._map._docLayer._selectedPart])
			this._previewTiles[this._map._docLayer._selectedPart].focus();
	},

	// On load, move focus to the current slide preview so arrow keys
	// navigate the slides right away. Only take focus while it still rests
	// on the document itself; if the user has already moved it to another
	// control, leave it where they put it.
	_focusCurrentSlideOnLoad: function (e) {
		if (!e || !e.status)
			return;
		if (!this._previewInitialized)
			return;
		// Vulcan Office: the second load-time focus grab, gated by
		// the same host policy as the one in Map.js 'docloaded'. A host that
		// asked us not to take focus on load must not have it taken by the
		// slide filmstrip either. Absent policy keeps today's behaviour.
		if (this._map._vulcanAutoFocusOnLoad === false)
			return;

		var active = document.activeElement;
		if (active && active !== document.body &&
		    active !== this._map.getContainer() && !this._map.hasFocus())
			return;

		this.focusCurrentSlide();
		this.partsFocused = true;
	},
});

window.L.control.partsPreview = function (container, preview, options) {
	return new window.L.Control.PartsPreview(container, preview, options);
};
