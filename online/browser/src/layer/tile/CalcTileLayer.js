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
 * Calc tile layer is used to display a spreadsheet document
 */

/* global app RenderManager cool FocusCellSection SplitterLinesSection InternBoundsUtil */

window.L.CalcTileLayer = window.L.CanvasTileLayer.extend({
	options: {
		// TODO: sync these automatically from SAL_LOK_OPTIONS
		sheetGeometryDataEnabled: true,
		printTwipsMsgsEnabled: true,
		syncSplits: true, // if false, the splits/freezes are not synced with other users viewing the same sheet.
	},

	twipsToHMM: function (twips) {
		return (twips * 127 + 36) / 72;
	},

	newAnnotation: function (commentData) {
		var commentList = app.sectionContainer.getSectionWithName(app.CSections.CommentList.name).sectionProperties.commentList;
		var comment = null;

		for (var i = 0; i < commentList.length; i++) {
			if (commentList[i].sectionProperties.data.tab == this._selectedPart) {
				if (commentList[i].sectionProperties.data.cellRange.contains(app.calc.cellAddress.toArray())) {
					comment = commentList[i];
					break;
				}
			}
		}

		if (!comment) {
			var pixelStart = new cool.Point(app.calc.cellCursorRectangle.pX1, app.calc.cellCursorRectangle.pY1);
			var rangeStart = this.sheetGeometry.getCellFromPos(pixelStart, 'corepixels');
			var pixelEnd = new cool.Point(app.calc.cellCursorRectangle.pX2 - 1, app.calc.cellCursorRectangle.pY2 - 1);
			var rangeEnd = this.sheetGeometry.getCellFromPos(pixelEnd, 'corepixels');

			var newComment = {
				cellRange: new cool.Bounds(rangeStart, rangeEnd),
				anchorPos: app.calc.cellCursorRectangle.toArray(),
				id: 'new',
				tab: this._selectedPart,
				dateTime: new Date().toISOString(),
				author: this._map.getViewName(this._viewId),
				threaded: commentData ? commentData.threaded : undefined,
			};

			if (app.sectionContainer.doesSectionExist('new comment')) // If adding a new comment has failed, we need to remove the leftover.
				app.sectionContainer.removeSection('new comment');

			comment = app.sectionContainer.getSectionWithName(app.CSections.CommentList.name).add(newComment);
			comment.positionCalcComment();
		}
		app.sectionContainer.getSectionWithName(app.CSections.CommentList.name).modify(comment);
		comment.focus();
	},

	beforeAdd: function (map) {
		map._addZoomLimit(this);
		map.on('zoomend', this._onZoomRowColumns, this);
		map.on('updateparts', this._onUpdateParts, this);
		map.on('splitposchanged', this.setSplitCellFromPos, this);
		map.on('commandstatechanged', this._onCommandStateChanged, this);
		map.uiManager.initializeSpecializedUI('spreadsheet');
		window.keyboard.hintOnscreenKeyboard(window.keyboard.guessOnscreenKeyboard());
	},

	onAdd: function (map) {
		map.addControl(window.L.control.tabs());
		window.L.CanvasTileLayer.prototype.onAdd.call(this, map);

		map.on('resize', function () {
			if (app.file.textCursor.visible) {
				this._onUpdateCursor(true /* scroll */);
			}
		}.bind(this));

		// Google Sheets has no separate fill marker (docs/mobile-redesign/02 §5).
		// Its phone model is ONE round handle at the CORNER of the selection:
		// you drag that across the target cells, then tap the selection and
		// choose Autofill. We were drawing a third affordance — a 16px filled
		// square centred on the cell's bottom-EDGE MIDPOINT — on top of the two
		// corner handles. On a default 85x17 cell that occludes ~23% of the
		// cell and covers the bottom 47% of the row right across the value, and
		// reaching for the corner handle to extend a range lands your thumb on
		// it and starts a fill instead.
		//
		// Dropped on the phone chrome. The corner range handle owns that corner
		// (CellSelectionHandleSection, now a 44px grab box), and the second half
		// of the gesture is the Autofill entry in the selection context menu,
		// which is why it comes off mobileDenylist in the same change.
		// Desktop and tablet keep the marker exactly as before.
		if (!(window.mode.isSmallScreenDevice() &&
			document.documentElement.classList.contains('vulcan-mobile-chrome')))
			app.sectionContainer.addSection(new app.definitions.CellFillMarkerSection());

		app.sectionContainer.addSection(new SplitterLinesSection());
		app.sectionContainer.addSection(new app.definitions.TableFillMarkerSection());

		this.insertMode = false;
		this._resetInternalState();

		// Google-Sheets phone chrome (docs/mobile-redesign/02 §1): open the
		// grid zoomed in enough to read.
		//
		// Calc otherwise opens at index 10 (100%) on every device: _fitWidthZoom
		// returns early for Calc, and _getWriterDefaultZoom is Writer-only, so
		// nothing in the zoom chain branches on screen size. At 100% the 10pt
		// default cell font renders at 13.3 CSS px, which is below the legible
		// floor for dense tabular text on a phone.
		//
		// Index 11 is scale 1.2 exactly (InternUtil SCALE), putting that font on
		// 16.0 CSS px and leaving ~4.5 default-width columns on a 390px screen.
		// It is also the only rung above 100% whose reported percentage (120)
		// equals its real scale -- index 12 renders 1.44 but reports 150.
		//
		// Deliberately NOT a pref: the host omits SavedUIState=false on the
		// mobile branch, so server-stored browser settings outrank ui_defaults
		// and a prefs key would be shadowed per-user and non-deterministically
		// (04-constraints.md Part 4). This is a form-factor constant, the same
		// class of decision as vulcanChrome.
		//
		// 🔴 Apply this AFTER load, not before. The earlier version called
		// map.setZoom(11) here and justified it as "safe before load: setZoom
		// takes the !_loaded branch and only assigns _zoom, so it costs no extra
		// tile round-trip". That reasoning is exactly backwards -- the early
		// branch is `this._zoom = this._limitZoom(zoom); return this;`
		// (Map.js:729-732), which returns BEFORE anything tells the tile layer.
		// The map then renders at zoom 11 while _docLayer._tileZoom stays at the
		// default 10, so every tilecombine asks for z=10 tiles and every paint
		// looks for z=11 tiles. Measured on-device: 200 tiles held, 100 with
		// content -- all of them z=10 -- and the 28 tiles actually in view (z=11)
		// carried no content at all, a perfect disjunction. The grid furniture
		// still drew (it is client-side, off the map zoom), so the document
		// opened with correct headers, gridlines and selection and PERMANENTLY
		// EMPTY CELLS. It cost no tile round-trip because it fetched the wrong
		// tiles forever.
		//
		// Deferring to 'load' makes it a real zoom operation, which reconciles
		// _tileZoom and re-requests: verified live, 0 -> 63 decoded bitmaps and
		// the sheet's text appeared. The extra round-trip the old comment was
		// avoiding is the price of showing the document at all.
		//
		// Never reaches the saved file. Two halves, because the withhold gate
		// alone was never enough: withholdExportZoom in
		// CanvasTileLayer._sendClientZoom keeps `zoompercent` off the wire,
		// and ScViewData::GetKitExportZoomPercent in the engine swaps the
		// document's own zoom back in at the three export sites, closing the
		// tiletwipwidth -> mnNormalZoom route that the withhold cannot reach.
		if (window.mode.isSmallScreenDevice() &&
			document.documentElement.classList.contains('vulcan-mobile-chrome')) {
			map.setZoom(11);

			// ...then RECONCILE THE TILE LAYER once the document has finished
			// loading. Setting the zoom is not enough on its own: the layer only
			// adopts a zoom inside _reset() (CanvasTileLayer.js:587-597), which
			// runs when it observes a CHANGE. Applied before load, setZoom
			// returns early and the layer never hears about it; applied on
			// 'load' it is still too early, and _reset lands again with the old
			// zoom -- measured, tileZoom went back to 10 both ways. 'docloaded'
			// is late enough. The guard makes it a no-op whenever the two
			// already agree, so the normal path costs one comparison.
			//
			// Verified on-device, this exact call: tileZoom 10 -> 11 and decoded
			// bitmaps 0 -> 16, with cell text appearing.
			map.once('docloaded', function () {
				var docLayer = map._docLayer;
				if (docLayer && docLayer._reset &&
					docLayer._tileZoom !== Math.round(map.getZoom()))
					docLayer._reset(true);
			});
		}

		this._sheetSwitch = new cool.SheetSwitchViewRestore(map);
		this._sheetGrid = true;

		if (window.prefs.getBoolean('ColumnRowHighlightEnabled', false))
			FocusCellSection.addFocusCellSection();
	},

	_resetInternalState: function() {
		this._cellSelections = Array(0);
		app.calc.cellCursorVisible = false;
		this._gotFirstCellCursor = false;
		this._lastColumn = 0; // with data
		this._lastRow = 0; // with data
		this.requestCellCursor();
	},

	_onUpdateParts: function (e) {
		if (typeof this._prevSelectedPart === 'number' && !e.source) {
			this.refreshViewData(undefined, false /* compatDataSrcOnly */, true /* sheetGeometryChanged */);
			this._switchSplitPanesContext();
		}
	},

	_onMessage: function (textMsg, img) {
		if (textMsg.startsWith('invalidateheader: column')) {
			this.refreshViewData({x: this._map._getTopLeftPoint().x, y: 0,
				offset: {x: undefined, y: 0}}, true /* compatDataSrcOnly */);
		} else if (textMsg.startsWith('invalidateheader: row')) {
			this.refreshViewData({x: 0, y: this._map._getTopLeftPoint().y,
				offset: {x: 0, y: undefined}}, true /* compatDataSrcOnly */);
		} else if (textMsg.startsWith('invalidateheader: all')) {
			this.refreshViewData({x: this._map._getTopLeftPoint().x, y: this._map._getTopLeftPoint().y,
				offset: {x: undefined, y: undefined}}, true /* compatDataSrcOnly */);
		} else if (this.options.sheetGeometryDataEnabled &&
				textMsg.startsWith('invalidatesheetgeometry:')) {
			var params = textMsg.substring('invalidatesheetgeometry:'.length).trim().split(' ');
			var flags = {};
			params.forEach(function (param) {
				flags[param] = true;
			});
			this.requestSheetGeometryData(flags);
		} else if (textMsg.startsWith('printranges:')) {
			this._onPrintRangesMsg(textMsg);
		} else {
			window.L.CanvasTileLayer.prototype._onMessage.call(this, textMsg, img);
		}
	},

	// This is used to read and parse printranges so that the next
	// canvas grid paint will show the visual indication of the print range
	// in the current sheet if any.
	_onPrintRangesMsg: function (textMsg) {
		textMsg = textMsg.substr('printranges:'.length);
		var msgData = JSON.parse(textMsg);
		if (!msgData['printranges'] || !Array.isArray(msgData['printranges']))
			return;

		if (!this._printRanges) {
			this._printRanges = [];
		}

		msgData['printranges'].forEach(function (sheetPrintRange) {
			if (typeof sheetPrintRange['sheet'] !== 'number' || !Array.isArray(sheetPrintRange['ranges'])) {
				return;
			}

			this._printRanges[sheetPrintRange['sheet']] = sheetPrintRange['ranges'];
		}, this);
	},

	_onSetPartMsg: function (textMsg) {
		var part = parseInt(textMsg.match(/\d+/g)[0]);
		if (!app.calc.isPartHidden(part)) {
			this.refreshViewData(undefined, true /* compatDataSrcOnly */, false /* sheetGeometryChanged */);
			this._replayPrintTwipsMsgAllViews('cellviewcursor');
			this._replayPrintTwipsMsgAllViews('textviewselection');
			// Hide previous tab's shown comment (if any), after closing one left
			// open for editing on the sheet the view has left.
			this._closeCommentEditLeftOnAnotherSheet(part);
			app.sectionContainer.getSectionWithName(app.CSections.CommentList.name).hideAllComments();
			this._sheetSwitch.gotSetPart(part);
			this._syncTileContainerSize();
		}
	},

	// hide() skips a comment that is being edited, so a comment left open for
	// editing on the sheet the view has left would stay over the new one. Close
	// its edit when that loses nothing (Comment.closeEditLeftOnAnotherSheet,
	// ).
	_closeCommentEditLeftOnAnotherSheet: function (part) {
		var editingComment = cool.Comment.isAnyEdit();
		if (editingComment)
			editingComment.closeEditLeftOnAnotherSheet(part);
	},

	_onZoomRowColumns: function () {
		this._sendClientZoom();
		if (this.sheetGeometry) {
			this.sheetGeometry.setTileGeometryData(app.tile.size.x, app.tile.size.y,
				RenderManager.tileSize);
		}
		this._restrictDocumentSize();
		this.dontSendSplitPosToCore = true;
		this.setSplitPosFromCell();
		this.dontSendSplitPosToCore = false;
		this._map.fire('zoomchanged');
		this.refreshViewData();
		this._replayPrintTwipsMsgs(false);
	},

	_restrictDocumentSize: function () {
		if (this._documentSizeFrozen) {
			return;
		}

		if (!this.sheetGeometry || !this._lastColumn || !this._lastRow) {
			return;
		}

		var maxDocSize = this.sheetGeometry.getSize('tiletwips');
		var newDocWidth = Math.min(maxDocSize.x, app.activeDocument.fileSize.x);
		var newDocHeight = Math.min(maxDocSize.y, app.activeDocument.fileSize.y);

		var lastCellPixel = this.sheetGeometry.getCellRect(this._lastColumn, this._lastRow);
		var isCalcRTL = this._map._docLayer.isCalcRTL();
		lastCellPixel = isCalcRTL ? lastCellPixel.getBottomRight() : lastCellPixel.getBottomLeft();
		var lastCellTwips = this._corePixelsToTwips(lastCellPixel);
		var mapSizeTwips = this._pixelsToTwips(this._map.getSize());
		var mapPosTwips = this._pixelsToTwips(this._map._getTopLeftPoint());

		// margin outside data area we allow to scroll
		// has to be bigger on mobile to allow scroll
		// to the next place where we extend that area
		// (allow few mobile screens down and right)
		var limitMargin = mapSizeTwips;
		if (!window.mode.isDesktop()) {
			limitMargin.x *= 8;
			limitMargin.y *= 8;
		}

		var limitWidth = mapPosTwips.x + mapSizeTwips.x < lastCellTwips.x && !this.widthShrinked;
		var limitHeight = mapPosTwips.y + mapSizeTwips.y < lastCellTwips.y && !this.heightShrinked;

		// limit to data area only (and map size for margin)
		if (limitWidth)
			newDocWidth = lastCellTwips.x + limitMargin.x;

		if (limitHeight)
			newDocHeight = lastCellTwips.y + limitMargin.y;

		var extendedLimit = false;

		if (!limitWidth && maxDocSize.x > app.activeDocument.fileSize.x) {
			newDocWidth = Math.min(app.activeDocument.fileSize.x + mapSizeTwips.x, maxDocSize.x);
			extendedLimit = true;
		}

		if (!limitHeight && maxDocSize.y > app.activeDocument.fileSize.y) {
			newDocHeight = Math.min(app.activeDocument.fileSize.y + mapSizeTwips.y, maxDocSize.y);
			extendedLimit = true;
		}

		var shouldRestrict = (newDocWidth !== app.activeDocument.fileSize.x ||
				newDocHeight !== app.activeDocument.fileSize.y);

		if (!shouldRestrict) {
			return;
		}

		// When there will be a Intern conversion, we should use CSS pixels.
		var newSizePx = this._twipsToPixels(new cool.Point(newDocWidth, newDocHeight));

		var topLeft = this._map.unproject(new cool.Point(0, 0));
		var bottomRight = this._map.unproject(newSizePx);

		this._docPixelSize = newSizePx.clone();
		app.activeDocument.fileSize = new cool.SimplePoint(newDocWidth, newDocHeight);
		app.activeDocument.activeLayout.viewSize = app.activeDocument.fileSize.clone();

		this._map.setMaxBounds(InternBoundsUtil.flexConstruct(topLeft, bottomRight));

		this._map.fire('scrolllimits', newSizePx.clone());

		if (!this._syncTileContainerSize() && (limitWidth || limitHeight || extendedLimit))
			app.sectionContainer.requestReDraw();
	},

	// While the document size is frozen, the scrollable area does not grow or
	// shrink. A size received from the engine in the meantime is stored and
	// applied when the freeze ends.
	freezeDocumentSize: function () {
		this._documentSizeFrozen = true;
	},

	unfreezeDocumentSize: function () {
		if (!this._documentSizeFrozen)
			return;

		this._documentSizeFrozen = false;

		if (this._pendingDocumentSize) {
			app.activeDocument.fileSize = this._pendingDocumentSize.clone();
			app.activeDocument.activeLayout.viewSize = app.activeDocument.fileSize.clone();
			this._pendingDocumentSize = null;
			this._syncTileContainerSize();
		}

		this._restrictDocumentSize();
	},

	_getCursorPosSize: function () {
		var x = -1, y = -1;
		var size = new cool.Point(0, 0);

		if (app.calc.cellCursorVisible) {
			x = app.calc.cellAddress.x + 1;
			y = app.calc.cellAddress.y + 1;

			size = { x: app.calc.cellCursorRectangle.width, y: app.calc.cellCursorRectangle.height };
		}

		return { curX: x, curY: y, width: size.x, height: size.y };
	},

	_hasPartsCountOrNamesChanged(lastStatusJSON, statusJSON) {
		if (!lastStatusJSON)
			return true;

		if (lastStatusJSON.parts.length !== statusJSON.parts.length)
			return true;
		else {
			for (let i = 0; i < statusJSON.parts.length; i++) {
				if (statusJSON.parts[i].name !== lastStatusJSON.parts[i].name)
					return true;
			}
			return false;
		}
	},

	_refreshPartNames(statusJSON) {
		this._partNames = [];

		for (let i = 0; i < statusJSON.parts.length; i++) {
			this._partNames.push(statusJSON.parts[i].name);
		}
	},

	_refreshPartHashes(statusJSON) {
		app.calc.partHashes = [];

		for (let i = 0; i < statusJSON.parts.length; i++) {
			app.calc.partHashes.push(statusJSON.parts[i].hash);
		}
	},

	_getMarginPropertiesForTheMap: function() {
		const rowHeaderSection = app.sectionContainer.getSectionWithName(app.CSections.RowHeader.name);
		const columnHeaderSection = app.sectionContainer.getSectionWithName(app.CSections.ColumnHeader.name);
		const rowGroupSection = app.sectionContainer.getSectionWithName(app.CSections.RowGroup.name);
		const columnGroupSection = app.sectionContainer.getSectionWithName(app.CSections.ColumnGroup.name);
		const scrollSection = app.sectionContainer.getSectionWithName(app.CSections.Scroll.name);
		// VO-P-0007 / M-0015 §A: THE PHONE INDICATOR RESERVES NOTHING.
		//
		// In the reference's at-rest frame the grid paints to the LAST pixel
		// column of the viewport -- cell white and the grid rule, never a flat
		// container grey -- and the indicator is an overlay drawn on top of live
		// content that occupies no space of its own. Upstream's reserve is our
		// divergence, and it is this one term. It is subtracted from BOTH axes
		// in _syncTileContainerSize (`availableSpace`), which shortens #map and
		// therefore _map.getSize(); and when the sheet is smaller than the
		// viewport the SAME term is added back onto the canvas in
		// _calculateNewCanvasAndMapSizes, which is a literal empty strip of
		// #document-container background with nothing in it but the thumb.
		// Returning zero here removes both, in one place.
		//
		// Desktop and tablet keep it, and must: there the bar is a real CONTROL
		// with a 20px usableThickness grab strip (ScrollSection.isMouseOnScrollBar
		// / quickScroll*), so the lane it reserves is space a pointer needs. The
		// phone refuses that grab outright (ScrollSection onMouseDown's
		// vulcanPhoneFade branch), which is what makes the lane pure loss there.
		const scrollBarThickness = (scrollSection && !this._vulcanPhoneChrome())
			? scrollSection.sectionProperties.scrollBarThickness : 0;

		const marginLeft = (rowHeaderSection ? rowHeaderSection.size[0] : 0) + (rowGroupSection ? rowGroupSection.size[0] : 0);
		const marginTop = (columnHeaderSection ? columnHeaderSection.size[1] : 0) + (columnGroupSection ? columnGroupSection.size[1] : 0);

		return { marginLeft, marginTop, scrollBarThickness };
	},

	_calculateNewCanvasAndMapSizes: function(documentContainerSize, availableSpace, marginLeft, marginTop, scrollBarThickness) {
		let newMapSize = availableSpace.slice();
		let newCanvasSize = documentContainerSize.slice();

		const fileSizePixels = app.activeDocument.fileSize.pToArray();

		// If we don't need that much space.
		if (fileSizePixels[0] < availableSpace[0]) {
			newMapSize[0] = fileSizePixels[0];
			newCanvasSize[0] = fileSizePixels[0] + marginLeft + scrollBarThickness;
			this.widthShrinked = true;
		}
		else this.widthShrinked = false;

		if (fileSizePixels[1] < availableSpace[1]) {
			newMapSize[1] = fileSizePixels[1];
			newCanvasSize[1] = fileSizePixels[1] + marginTop + scrollBarThickness;
			this.heightShrinked = true;
		}
		else this.heightShrinked = false;

		newMapSize = [Math.round(newMapSize[0] / app.dpiScale), Math.round(newMapSize[1] / app.dpiScale)];
		newCanvasSize = [Math.round(newCanvasSize[0] / app.dpiScale), Math.round(newCanvasSize[1] / app.dpiScale)];

		return { newMapSize, newCanvasSize };
	},

	_resizeMapElementAndTilesLayer: function(mapElement, marginLeft, marginTop, newMapSize) {
		mapElement.style.left = Math.round(marginLeft / app.dpiScale) + 'px';
		mapElement.style.top = Math.round(marginTop / app.dpiScale) + 'px';
		mapElement.style.width = newMapSize[0] + 'px';
		mapElement.style.height = newMapSize[1] + 'px';

		this._container.style.width = newMapSize[0] + 'px';
		this._container.style.height = newMapSize[1] + 'px';
	},

	_updateHeaderSections: function() {
		if (app.sectionContainer.doesSectionExist(app.CSections.RowHeader.name)) {
			app.sectionContainer.getSectionWithName(app.CSections.RowHeader.name)._updateCanvas();
			app.sectionContainer.getSectionWithName(app.CSections.ColumnHeader.name)._updateCanvas();
		}
	},

	_syncTileContainerSize: function(force = false) {
		if (!this._map) return false;

		if (!this._container) return false;

		// Phone anchor (item 2.4d): the document position that must not move
		// across this resize, captured BEFORE any geometry changes. The cell
		// cursor when there is one -- that is what the user is looking at -- and
		// the top-left of the view otherwise. Twips, because they survive the
		// resize; device px would not if the zoom moved.
		let vulcanAnchor = null;
		if (window.mode.isSmallScreenDevice() &&
			document.documentElement.classList.contains('vulcan-mobile-chrome')) {
			const layout = app.activeDocument.activeLayout;
			// `cellY2` rides along so the restore is a pure function of this
			// anchor plus the POST-resize view: see the keyboard clamp in
			// _vulcanRestoreAnchor.
			vulcanAnchor = app.calc.cellCursorVisible
				? { y: app.calc.cellCursorRectangle.y1,
					offset: app.calc.cellCursorRectangle.y1 - layout.viewedRectangle.y1,
					cell: true,
					cellY2: app.calc.cellCursorRectangle.y2 }
				: { y: layout.viewedRectangle.y1, offset: 0, cell: false, cellY2: 0 };
		}

		// Document container size is up to date as of now.
		const documentContainerSize = this._getDocumentContainerSize();
		documentContainerSize[0] *= app.dpiScale;
		documentContainerSize[1] *= app.dpiScale;

		// Size has changed. Our map and canvas are not resized yet.
		// But the row header, row group, column header and column group sections don't need to be resized.
		// We can get their width and height from the sections' properties.
		const { marginLeft, marginTop, scrollBarThickness } = this._getMarginPropertiesForTheMap();

		// Available for tiles section.
		const availableSpace = [documentContainerSize[0] - marginLeft - scrollBarThickness, documentContainerSize[1] - marginTop - scrollBarThickness];
		const { newMapSize, newCanvasSize } = this._calculateNewCanvasAndMapSizes(documentContainerSize, availableSpace, marginLeft, marginTop, scrollBarThickness);

		const mapElement = document.getElementById('map'); // map's size = tiles section's size.
		const oldMapSize = [mapElement.clientWidth, mapElement.clientHeight];
		const widthIncreased = oldMapSize[0] < newMapSize[0];
		const heightIncreased = oldMapSize[1] < newMapSize[1];
		const sizeChanged = oldMapSize[0] !== newMapSize[0] || oldMapSize[1] !== newMapSize[1];

		// Early exit. If there is no need to update the size, return here.
		if (sizeChanged || force) {
			this._resizeMapElementAndTilesLayer(mapElement, marginLeft, marginTop, newMapSize);

			this._map.invalidateSize(false, new cool.Point(oldMapSize[0], oldMapSize[1]));
			app.sectionContainer.onResize(newCanvasSize[0], newCanvasSize[1]); // Canvas's size = documentContainer's size.
			this._updateHeaderSections();

			this._mobileChecksAfterResizeEvent(heightIncreased);
		}

		// Center the view w.r.t the new map-pane position using the current zoom.
		//
		// PHONE (item 2.4d): centre-preserving is the WRONG invariant when the
		// viewport loses height off the bottom -- the content the user is reading
		// slides up by half of what was lost. And this line runs on EVERY
		// container resize: note it sits outside the `if (sizeChanged || force)`
		// above, so it also runs on resizes that changed nothing. Worse, the
		// ResizeObserver driving us (CanvasTileLayer.js:34-37) has no throttle
		// and js/global.js:2856 animates <body> height across the host's keyboard
		// duration, so this fires once per FRAME for the whole IME animation.
		//
		// Nothing else preserves the anchor: _nonDesktopChecksAfterResizeEvent
		// (CanvasTileLayer.js:3972) reads app.file.textCursor -- the in-cell text
		// caret -- which does not exist for a user who has merely SELECTED a cell.
		//
		// This is NOT the keyboard contract and does not touch it: no
		// Vulcan_HostKeyboard, no data-vulcan-keyboard-open, no height maths. It
		// is keyboard-agnostic, and equally fixes rotation, the sidebar, and the
		// formula bar growing.
		if (vulcanAnchor)
			this._vulcanRestoreAnchor(vulcanAnchor);
		else
			this._map.setView(this._map.getCenter());

		if (sizeChanged || force) {
			// We want to keep cursor visible when we show the keyboard on mobile device or tablet
			this._nonDesktopChecksAfterResizeEvent(heightIncreased);

			if (heightIncreased || widthIncreased) {
				app.sectionContainer.requestReDraw();
				this._map.fire('sizeincreased');
				return true;
			}
		}

		return false;
	},

	/*
		C7 -- THE KEYBOARD MUST NOT SWALLOW THE CELL YOU ARE EDITING.

		Preserving the view's TOP edge is the right invariant for a resize that
		takes height off the bottom... right up until the thing the user is
		working on was IN that bottom strip. On a phone the soft keyboard takes
		roughly 45% of an 852px viewport, and the anchored cell cursor is then
		simply behind it, with no way back: the two stock keyboard reveals both
		require `app.file.textCursor.visible`, the IN-CELL CARET.

		That caret is the wrong test twice over on phone Calc:

		  * a cell that is merely SELECTED has no caret at all, and

		  * even for a cell being edited the caret has not arrived yet.
		    MouseControl.onVulcanTouchDown raises the keyboard OPTIMISTICALLY,
		    on the second finger-down of the double tap, and the host starts
		    its lift at focusin (js/global.js, the Vulcan_HostKeyboard
		    contract) -- both deliberately EARLY, both long before F2 has been
		    round-tripped and `invalidatecursor` has come back. So the resize
		    that this method answers lands with textCursor.visible false, and
		    _mobileChecksAfterResizeEvent -> _onUpdateCursor returns at its own
		    `!app.file.textCursor.visible` guard.

		So the clamp below asks the question the caret cannot: does the
		ANCHORED CELL still fit above the new bottom edge? If it does, this is
		byte-for-byte the top-edge restore that shipped, which is what keeps
		rotation, the sidebar and a growing formula bar behaving exactly as
		they did. If it does not, the view gives up the top edge to keep the
		cell -- by the smallest amount that works, and never so far that the
		cell's own top leaves the view.

		The reveal margin is the one _calculateScrollForNewCellCursor already
		uses (24 CSS px, a little over one row at the phone's opening zoom), so
		a cell revealed by the keyboard and a cell revealed by an arrow key
		come to rest in the same place.

		SAFE ACROSS THE WHOLE IME ANIMATION, which matters because the
		ResizeObserver above has no throttle and <body> is animated across the
		host's keyboard duration, so this runs once per frame. Each frame
		re-derives the anchor's offset from the live view, so `wantY1` is the
		current top; the clamp is monotonic in the view height and idempotent
		once the cell fits. It cannot oscillate and it cannot walk.
	*/
	_vulcanKeyboardSafeY1: function (wantY1, anchor, layout) {
		if (!anchor.cell) return wantY1;

		const viewHeight = layout.viewedRectangle.height;
		if (viewHeight <= 0) return wantY1;

		// app.pixelsToTwips converts DEVICE px, so scale by dpiScale first --
		// the same shape _calculateScrollForNewCellCursor uses.
		const margin = Math.round(24 * app.dpiScale * app.pixelsToTwips);

		// The highest the view's top may sit and still show the cell's bottom
		// edge, plus the reveal sliver, above the view's own bottom edge.
		const lowestY1 = anchor.cellY2 + margin - viewHeight;
		if (wantY1 >= lowestY1) return wantY1; // the cell still fits: unchanged

		// Never scroll so far that the cell's TOP leaves the view -- for a cell
		// taller than the remaining strip that would show only its bottom edge,
		// which is worse than showing where it starts.
		const highestY1 = Math.max(0, anchor.y - margin);
		return Math.max(0, Math.min(lowestY1, highestY1));
	},

	// Put the anchor back where it sat relative to the top of the view. Runs
	// after the canvas, the map element and the header sections have all been
	// resized, so viewedRectangle already describes the new box.
	//
	// A DOUBLE TAP IS ONE GESTURE ON ONE CELL: while a tap run is open the
	// C7 reveal waits. Tap 1 of a run engages the cell unit
	// (vulcan-calc-edit-ready), the cell bar takes ~60 px off the grid's
	// bottom, and this restore answers that resize -- while the anchored cell
	// cursor is still the OLD one, because core has not answered tap 1 yet.
	// When that cursor sat in the strip the bar now covers (a document reopened
	// on its saved cursor, a commit that left the cursor near the bottom), the
	// clamp scrolled the grid a row between the two taps: tap 2 landed on the
	// neighbour, core got count=1 and count=2 on different cells, and no edit
	// opened (desktop Chromium at 360x683, 8 of 8 pairs; on Android the split
	// pair opened an edit that swallowed every key). So while
	// MouseControl.vulcanMultiClickPending() holds, keep the top edge (the
	// shipped 2.4d restore, exactly), and reveal once the run has resolved --
	// against the cursor the run produced, so C7 still keeps an edited cell
	// clear of the keyboard, at most one multi-click window late.
	_vulcanRestoreAnchor: function (anchor) {
		const layout = app.activeDocument.activeLayout;
		const holdForTapRun = anchor.cell && this._vulcanTapRunOpen();
		if (holdForTapRun)
			this._vulcanRevealAfterTapRun();
		const wantY1 = holdForTapRun
			? anchor.y - anchor.offset
			: this._vulcanKeyboardSafeY1(anchor.y - anchor.offset, anchor, layout);
		if (wantY1 === layout.viewedRectangle.y1) return; // nothing moved
		// SimplePoint's constructor takes twips (src/core/geometry.ts) and pY
		// converts with the live app.twipsToPixels; ViewLayout.scrollTo takes
		// ABSOLUTE device px and subtracts viewedRectangle itself.
		const target = new cool.SimplePoint(layout.viewedRectangle.x1, wantY1);
		layout.scrollTo(layout.viewedRectangle.pX1, target.pY);
	},

	// The existence tests are real: the extraction rigs run this file against
	// the real `app` with no document or timer registry wired.
	_vulcanTapRunOpen: function () {
		const mouse = app.activeDocument && app.activeDocument.mouseControl;
		return !!(mouse && mouse.vulcanMultiClickPending && mouse.vulcanMultiClickPending());
	},

	// One pending re-run, however many resize frames were held. It re-enters
	// _syncTileContainerSize, which re-captures the anchor from the cursor the
	// run left and applies the clamp; if the run is still open (tap 2 re-arms
	// the window) it waits again.
	_vulcanRevealAfterTapRun: function () {
		if (this._vulcanTapRunRevealTimer || !app.timerRegistry) return;
		const retry = () => {
			this._vulcanTapRunRevealTimer = null;
			if (this._vulcanTapRunOpen()) {
				this._vulcanTapRunRevealTimer = app.timerRegistry.setTimeout('vulcantaprunreveal', retry, 60);
				return;
			}
			this._syncTileContainerSize();
		};
		this._vulcanTapRunRevealTimer = app.timerRegistry.setTimeout('vulcantaprunreveal', retry, 60);
	},

	_onStatusMsg: function (textMsg) {
		console.log('DEBUG: onStatusMsg: ' + textMsg);

		const statusJSON = JSON.parse(textMsg.replace('status:', '').replace('statusupdate:', ''));

		if (statusJSON.width && statusJSON.height && this._documentInfo !== textMsg) {
			const previousStatusJSON = this._lastStatusJSON ? Object.assign({}, this._lastStatusJSON): null;
			this._lastStatusJSON = statusJSON;

			if (statusJSON.readonly && !this._documentInfo)
				this._map.setPermission('readonly');

			this._documentInfo = textMsg;

			var firstSelectedPart = (typeof this._selectedPart !== 'number');

			if (this._documentSizeFrozen) {
				this._pendingDocumentSize = new cool.SimplePoint(statusJSON.width, statusJSON.height);
			}
			else {
				app.activeDocument.fileSize = new cool.SimplePoint(statusJSON.width, statusJSON.height);
				app.activeDocument.activeLayout.viewSize = app.activeDocument.fileSize.clone();

				if (app.map._docLoaded)
					this._syncTileContainerSize();
			}

			this._docType = statusJSON.type;
			this._parts = statusJSON.partscount;

			if (app.socket._reconnecting) {
				app.socket.sendMessage('setclientpart part=' + this._selectedPart);
				this._resetInternalState();
				window.keyboard.hintOnscreenKeyboard(window.keyboard.guessOnscreenKeyboard());
			} else {
				this._selectedPart = statusJSON.selectedpart;
			}

			this._lastColumn = statusJSON.lastcolumn;
			this._lastRow = statusJSON.lastrow;

			const mode = (statusJSON.mode !== undefined) ? statusJSON.mode : 0;
			app.activeDocument.activeModes = [mode];

			if (this.sheetGeometry && this._selectedPart != this.sheetGeometry.getPart()) {
				// Core initiated sheet switch, need to get full sheetGeometry data for the selected sheet.
				this.requestSheetGeometryData();
			}

			this._viewId = statusJSON.viewid;
			app.activeDocument.setActiveViewID(this._viewId);

			console.assert(this._viewId >= 0, 'Incorrect viewId received: ' + this._viewId);

			var mapSize = this._map.getSize();
			var sizePx = this._twipsToPixels(new cool.Point(app.activeDocument.fileSize.x, app.activeDocument.fileSize.y));
			var width = sizePx.x;
			var height = sizePx.y;

			if (width < mapSize.x || height < mapSize.y) {
				width = Math.max(width, mapSize.x);
				height = Math.max(height, mapSize.y);
				var topLeft = this._map.unproject(new cool.Point(0, 0));
				var bottomRight = this._map.unproject(new cool.Point(width, height));
				this._map.setMaxBounds(InternBoundsUtil.flexConstruct(topLeft, bottomRight));
				this._docPixelSize = {x: width, y: height};
				this._map.fire('scrolllimits', {x: width, y: height});
			}
			else {
				this._updateMaxBounds(true);
			}

			this._adjustCanvasSectionsForLayoutChange();

			this._refreshPartNames(statusJSON);
			this._refreshPartHashes(statusJSON);

			// if the number of parts, or order has changed then refresh comment positions
			if (this._hasPartsCountOrNamesChanged(previousStatusJSON, statusJSON))
				app.socket.sendMessage('commandvalues command=.uno:ViewAnnotationsPosition');


			// A sheet switch core makes by itself (a plain Ctrl+PgUp/PgDn from the
			// grid, a Name Box jump) reaches this view only as a status whose
			// selectedpart changed; core sends no setpart: for it.
			// Close before 'updateparts': the comment list loads the new sheet's
			// comments on it, and loads none while a comment is in edit.
			if (previousStatusJSON && previousStatusJSON.selectedpart !== statusJSON.selectedpart)
				this._closeCommentEditLeftOnAnotherSheet(this._selectedPart);

			this._map.fire('updateparts', {
				selectedPart: this._selectedPart,
				parts: this._parts,
				docType: this._docType,
				source: 'status',
				partNames: this._partNames
			});

			RenderManager.resetPreFetching(true);

			/*
				Side note: There is a getPrintRanges function on the core side that sends the JSON inside a printranges object.
				When we get the printranges object, we put it into another printranges object on the server side. So we have a longer path here.
			*/
			if (statusJSON.printranges && statusJSON.printranges.printranges) {
				this._printRanges = [];
				const info = statusJSON.printranges.printranges;
				for (let i = 0; i < info.length; i++)
					this._printRanges[info[i]['sheet']] = info[i]['ranges'];
			}

			if (firstSelectedPart || (previousStatusJSON && previousStatusJSON.selectedpart !== statusJSON.selectedpart))
				this._switchSplitPanesContext();

			this._map.fire('statusupdated');
		} else {
			this._adjustCanvasSectionsForLayoutChange();
		}

		var scrollSection = app.sectionContainer.getSectionWithName(app.CSections.Scroll.name);
		scrollSection.stepByStepScrolling = true;
	},

	// This initiates a selective repainting of row/col headers and
	// gridlines based on the settings of coordinatesData.offset. This
	// should be called whenever the view area changes (scrolling, panning,
	// zooming, cursor moving out of view-area etc.).  Depending on the
	// active sheet geometry data-source, it may ask core to send current
	// view area's data or the global data on geometry changes.
	refreshViewData: function (coordinatesData, compatDataSrcOnly, sheetGeometryChanged) {

		if (this.options.sheetGeometryDataEnabled && compatDataSrcOnly) {
			return;
		}
		// There are places that call this function with no arguments to indicate that the
		// command arguments should be the current map area coordinates.
		if (typeof coordinatesData != 'object') {
			coordinatesData = {};
		}

		var offset = coordinatesData.offset || {};

		var topLeftPoint = new cool.Point(coordinatesData.x, coordinatesData.y);
		var sizePx = this._map.getSize();

		if (topLeftPoint.x === undefined) {
			topLeftPoint.x = this._map._getTopLeftPoint().x;
		}
		if (topLeftPoint.y === undefined) {
			topLeftPoint.y = this._map._getTopLeftPoint().y;
		}

		var updateRows = true;
		var updateCols = true;

		if (offset.x === 0) {
			updateCols = false;
			if (!this.options.sheetGeometryDataEnabled) {
				topLeftPoint.x = -1;
				sizePx.x = 0;
			}
		}
		if (offset.y === 0) {
			updateRows = false;
			if (!this.options.sheetGeometryDataEnabled) {
				topLeftPoint.y = -1;
				sizePx.y = 0;
			}
		}

		var pos = this._pixelsToTwips(topLeftPoint);
		var size = this._pixelsToTwips(sizePx);

		if (!this.options.sheetGeometryDataEnabled) {
			this.requestViewRowColumnData(pos, size);
			return;
		}

		if (sheetGeometryChanged || !this.sheetGeometry) {
			this.requestSheetGeometryData(
				{columns: updateCols, rows: updateRows});
			return;
		}

		if (this.sheetGeometry) {
			this.sheetGeometry.setViewArea(pos, size);
			this._updateHeadersGridLines(undefined, updateCols, updateRows);
		}
	},

	// This send .uno:ViewRowColumnHeaders command to core with the new view coordinates (tile-twips).
	requestViewRowColumnData: function (pos, size) {

		var payload = 'commandvalues command=.uno:ViewRowColumnHeaders?x=' + Math.round(pos.x) + '&y=' + Math.round(pos.y) +
			'&width=' + Math.round(size.x) + '&height=' + Math.round(size.y);

		app.socket.sendMessage(payload);
	},

	// sends the .uno:SheetGeometryData command optionally with arguments.
	requestSheetGeometryData: function (flags) {
		if (!this.sheetGeometry) {
			// Suppress multiple requests at document load, till we get a response.
			if (this._sheetGeomFirstWait === true) {
				return;
			}
			this._sheetGeomFirstWait = true;
		}
		var unoCmd = '.uno:SheetGeometryData';
		var haveArgs = (typeof flags == 'object' &&
			(flags.columns === true || flags.rows === true || flags.all === true));
		var payload = 'commandvalues command=' + unoCmd;

		if (haveArgs) {
			var argList = [];
			var both = (flags.all === true);
			if (both || flags.columns === true) {
				argList.push('columns=1');
			}
			if (both || flags.rows === true) {
				argList.push('rows=1');
			}

			var dataTypeFlagNames = ['sizes', 'hidden', 'filtered', 'groups'];
			var dataTypesPresent = false;
			dataTypeFlagNames.forEach(function (name) {
				if (flags[name] === true) {
					argList.push(name + '=1');
					dataTypesPresent = true;
				}
			});

			if (!dataTypesPresent) {
				dataTypeFlagNames.forEach(function (name) {
					argList.push(name + '=1');
				});
			}

			payload += '?' + argList.join('&');
		}

		app.socket.sendMessage(payload);
	},

	// Sends a notification to the row/col header and gridline controls that
	// they need repainting.
	// viewAreaData is the parsed .uno:ViewRowColumnHeaders JSON if that source is used.
	// else it should be undefined.
	_updateHeadersGridLines: function (viewAreaData, updateCols, updateRows) {
		this._map.fire('viewrowcolumnheaders', {
			data: viewAreaData,
			updaterows: updateRows,
			updatecolumns: updateCols,
			cursor: this._getCursorPosSize(),
			context: this
		});
	},

	_addRemoveGroupSections: function () {
		// If there are row and column groups at the same time, add CornerGroup section.
		if (this.sheetGeometry._rows._outlines._outlines.length > 0 && this.sheetGeometry._columns._outlines._outlines.length > 0) {
			if (!app.sectionContainer.doesSectionExist(app.CSections.CornerGroup.name))
				app.sectionContainer.addSection(new cool.CornerGroup());
		}
		else { // If not, remove CornerGroup section.
			app.sectionContainer.removeSection(app.CSections.CornerGroup.name);
		}

		// If there are row groups, add RowGroup section.
		if (this.sheetGeometry._rows._outlines._outlines.length > 0) {
			if (!app.sectionContainer.doesSectionExist(app.CSections.RowGroup.name))
				app.sectionContainer.addSection(new cool.RowGroup());
		}
		else { // If not, remove RowGroup section.
			app.sectionContainer.removeSection(app.CSections.RowGroup.name);
		}

		// If there are column groups, add ColumnGroup section.
		if (this.sheetGeometry._columns._outlines._outlines.length > 0) {
			if (!app.sectionContainer.doesSectionExist(app.CSections.ColumnGroup.name)) {
				app.sectionContainer.addSection(new cool.ColumnGroup());
				app.sectionContainer.canvas.style.border = '1px solid darkgrey';
			}
		}
		else { // If not, remove ColumnGroup section.
			app.sectionContainer.removeSection(app.CSections.ColumnGroup.name);
			app.sectionContainer.canvas.style.border = '0px solid darkgrey';
		}
	},

	_setAnchor: function(name, section, value) {
		if (!section) {
			console.debug('_setAnchor: no section found: "' + name + '"');
			return;
		}

		section.anchor = value;
	},

	_adjustCanvasSectionsForLayoutChange: function () {
		var sheetIsRTL = app.calc.isRTL();
		if (sheetIsRTL && this._layoutIsRTL !== true) {
			console.log('debug: in LTR -> RTL canvas section adjustments');
			var sectionContainer = app.sectionContainer;

			var tilesSection = sectionContainer.getSectionWithName(app.CSections.Tiles.name);
			var rowHeaderSection = sectionContainer.getSectionWithName(app.CSections.RowHeader.name);
			var columnHeaderSection = sectionContainer.getSectionWithName(app.CSections.ColumnHeader.name);
			var cornerHeaderSection = sectionContainer.getSectionWithName(app.CSections.CornerHeader.name);
			var columnGroupSection = sectionContainer.getSectionWithName(app.CSections.ColumnGroup.name);
			var rowGroupSection = sectionContainer.getSectionWithName(app.CSections.RowGroup.name);
			var cornerGroupSection = sectionContainer.getSectionWithName(app.CSections.CornerGroup.name);
			// Scroll section covers the entire document area, and needs RTL adjustments internally.

			this._setAnchor('cornerGroupSection', cornerGroupSection, ['top', 'right']);

			this._setAnchor('rowGroupSection', rowGroupSection,
				[[app.CSections.CornerGroup.name, 'bottom', 'top'], 'right']);

			this._setAnchor('columnGroupSection', columnGroupSection,
				['top', [app.CSections.CornerGroup.name, '-left', 'right']]);

			this._setAnchor('cornerHeaderSection', cornerHeaderSection,
				[[app.CSections.ColumnGroup.name, 'bottom', 'top'], [app.CSections.RowGroup.name, '-left', 'right']]);

			this._setAnchor('rowHeaderSection', rowHeaderSection,
				[[app.CSections.CornerHeader.name, 'bottom', 'top'], [app.CSections.RowGroup.name, '-left', 'right']]);

			this._setAnchor('columnHeaderSection', columnHeaderSection,
				[[app.CSections.ColumnGroup.name, 'bottom', 'top'], [app.CSections.CornerHeader.name, '-left', 'right']]);
			if (columnHeaderSection) columnHeaderSection.expand = ['left'];

			this._setAnchor('tilesSection', tilesSection,
				[[app.CSections.ColumnHeader.name, 'bottom', 'top'], [app.CSections.RowHeader.name, '-left', 'right']]);

			// Do not set layoutIsRtl to true prematurely. If set before all sections are defined
			// (e.g., during load with onStatusMsg), some sections may not update to their correct positions.
			// Ensure all sections are adjusted first, then set layoutIsRtl to true to show that they have moved.
			if (rowHeaderSection)
				this._layoutIsRTL = true;

			sectionContainer.reNewAllSections(true);
			this._syncTileContainerSize();

		} else if (!sheetIsRTL && this._layoutIsRTL === true) {

			console.log('debug: in RTL -> LTR canvas section adjustments');
			var sectionContainer = app.sectionContainer;

			var tilesSection = sectionContainer.getSectionWithName(app.CSections.Tiles.name);
			var rowHeaderSection = sectionContainer.getSectionWithName(app.CSections.RowHeader.name);
			var columnHeaderSection = sectionContainer.getSectionWithName(app.CSections.ColumnHeader.name);
			var cornerHeaderSection = sectionContainer.getSectionWithName(app.CSections.CornerHeader.name);
			var columnGroupSection = sectionContainer.getSectionWithName(app.CSections.ColumnGroup.name);
			var rowGroupSection = sectionContainer.getSectionWithName(app.CSections.RowGroup.name);
			var cornerGroupSection = sectionContainer.getSectionWithName(app.CSections.CornerGroup.name);

			if (cornerGroupSection) {
				cornerGroupSection.anchor = ['top', 'left'];
			}

			if (rowGroupSection) {
				rowGroupSection.anchor = [[app.CSections.CornerGroup.name, 'bottom', 'top'], 'left'];
			}

			if (columnGroupSection) {
				columnGroupSection.anchor = ['top', [app.CSections.CornerGroup.name, 'right', 'left']];
			}

			cornerHeaderSection.anchor = [[app.CSections.ColumnGroup.name, 'bottom', 'top'], [app.CSections.RowGroup.name, 'right', 'left']];

			rowHeaderSection.anchor = [[app.CSections.CornerHeader.name, 'bottom', 'top'], [app.CSections.RowGroup.name, 'right', 'left']];

			columnHeaderSection.anchor = [[app.CSections.ColumnGroup.name, 'bottom', 'top'], [app.CSections.CornerHeader.name, 'right', 'left']];
			columnHeaderSection.expand = ['right'];

			if (rowHeaderSection)
				this._layoutIsRTL = false;

			tilesSection.anchor = [[app.CSections.ColumnHeader.name, 'bottom', 'top'], [app.CSections.RowHeader.name, 'right', 'left']];

			sectionContainer.reNewAllSections(true);
			this._syncTileContainerSize();
		}
	},

	_handleSheetGeometryDataMsg: function (jsonMsgObj, differentSheet) {
		// When an autofilter change is incoming, remember which row sits at
		// the top of the view right now, so we can keep it there after the
		// geometry update. The cached view range is only refreshed on header
		// updates, not on every scroll, so read the row from the live scroll
		// position against the current (pre-update) geometry instead.
		let autoFilterAnchorRow = -1;
		if (this.sheetGeometry && this.sheetGeometry.autoFilterChanged) {
			this.sheetGeometry.setViewArea(
				this._pixelsToTwips(this._map._getTopLeftPoint()),
				this._pixelsToTwips(this._map.getSize()));
			autoFilterAnchorRow = this.sheetGeometry.getViewRowRange().start;
		}

		if (!this.sheetGeometry) {
			this._sheetGeomFirstWait = false;
			this.sheetGeometry = new cool.SheetGeometry(jsonMsgObj,
				app.tile.size.x, app.tile.size.y,
				RenderManager.tileSize, this._selectedPart);

			app.sectionContainer.addSection(new cool.CornerHeader());
			app.sectionContainer.addSection(new app.definitions.rowHeader());
			app.sectionContainer.addSection(new app.definitions.columnHeader());
		}
		else {
			this.sheetGeometry.update(jsonMsgObj, /* checkCompleteness */ false, this._selectedPart);
		}

		this._replayPrintTwipsMsgs(differentSheet);

		if (this.sheetGeometry.autoFilterChanged) {
			this.sheetGeometry.autoFilterChanged = false;
			const targetData = this.sheetGeometry.getRowsGeometry().getElementData(autoFilterAnchorRow);
			if (targetData) {
				app.activeDocument.activeLayout.scrollTo(
					this._map._getTopLeftPoint().x,
					targetData.startpos);
			}
		} else {
			this.sheetGeometry.setViewArea(
				this._pixelsToTwips(this._map._getTopLeftPoint()),
				this._pixelsToTwips(this._map.getSize()));
		}

		this._addRemoveGroupSections();

		console.log('debug: got sheetGeometry: this._rtlParts = ' + this._rtlParts + ' this._selectedPart = ' + this._selectedPart);

		this._adjustCanvasSectionsForLayoutChange();

		this._updateHeadersGridLines(undefined, true /* updateCols */,
			true /* updateRows */);

		this.dontSendSplitPosToCore = true;
		this.setSplitPosFromCell();
		this.dontSendSplitPosToCore = false;

		app.sectionContainer.reNewAllSections(true);
		this._syncTileContainerSize();

		this._map.fire('sheetgeometrychanged');
	},

	// Calculates the split position in (core-pixels) from the split-cell.
	//
	// VULCAN: this direction is core -> client, so it never writes a
	// split back to core. Mapping the position back to a cell is lossy: with
	// column A (or row 1) hidden, position 0 maps to index 1, and a freeze wider
	// than the pane is clamped to a smaller index. Sending either one is a
	// .uno:FreezePanesColumn/Row that rewrites the document's freeze, dirties a
	// file nobody edited and reaches storage as an editor save. The zoom and
	// sheet-geometry callers already suppressed the send; the sheet switch
	// (_switchSplitPanesContext) and core's state echo (_onSplitStateChanged)
	// did not. Deliberate freezes do not come through here: menu commands go
	// straight to core and the phone header bar calls sendSplitIndex directly.
	setSplitPosFromCell: function (forceSplittersUpdate) {
		if (!this.sheetGeometry || !this._splitPanesContext) {
			return;
		}

		var wasSuppressed = this.dontSendSplitPosToCore;
		this.dontSendSplitPosToCore = true;
		try {
			this._splitPanesContext.setSplitPosFromCell(forceSplittersUpdate);
		} finally {
			this.dontSendSplitPosToCore = wasSuppressed;
		}
	},

	// Calculates the split-cell from the split position in (core-pixels).
	setSplitCellFromPos: function () {

		if (!this.sheetGeometry || !this._splitPanesContext) {
			return;
		}

		this._splitPanesContext.setSplitCellFromPos();
	},

	_switchSplitPanesContext: function () {

		if (!this.hasSplitPanesSupport()) {
			return;
		}

		if (!this._splitPaneCache) {
			this._splitPaneCache = {};
		}

		window.app.console.assert(typeof this._selectedPart === 'number', 'invalid selectedPart');

		var spContext = this._splitPaneCache[this._selectedPart];
		if (!spContext) {
			spContext = new cool.CalcSplitPanesContext(this);
			this._splitPaneCache[this._selectedPart] = spContext;
		}

		this._splitPanesContext = spContext;
		if (this.sheetGeometry) {
			// Force update of the splitter lines.
			this.setSplitPosFromCell(true);
		}

		var splitPos = spContext.getSplitPos();
		app.calc.splitCoordinate.pX = Math.round(splitPos.x * app.dpiScale);
		app.calc.splitCoordinate.pY = Math.round(splitPos.y * app.dpiScale);
	},

	_onRowColSelCount: function (state) {
		if (state.trim() !== '') {
			var rowCount = parseInt(state.split(', ')[0].trim().split(' ')[0].replace(',', '').replace(',', ''));
			var columnCount = parseInt(state.split(', ')[1].trim().split(' ')[0].replace(',', '').replace(',', ''));
			if (rowCount === app.calc.maxRowCount)
				this._map.wholeColumnSelected = true;
			else
				this._map.wholeColumnSelected = false;

			if (columnCount === app.calc.maxColumnCount)
				this._map.wholeRowSelected = true;
			else
				this._map.wholeRowSelected = false;
		}
		else {
			this._map.wholeColumnSelected = false;
			this._map.wholeRowSelected = false;
		}

		// After BOTH flags, never between them: the phone cross-axis
		// suppression (Control.Header.isHeaderEntryHighLighted) reads the
		// pair, so a repaint taken mid-restatement is a repaint of a
		// half-switched selection. Nothing else repaints on this message --
		// on an axis switch the header already painted from its own tap,
		// before core's counts landed, so the band the user left behind
		// keeps the old tint until some unrelated rebuild.
		this._refreshRowColumnHeaders();
	},

	_onCommandStateChanged: function (e) {

		if (e.commandName === '.uno:FreezePanesColumn') {
			this._onSplitStateChanged(e, true /* isSplitCol */);
		}
		else if (e.commandName === '.uno:FreezePanesRow') {
			this._onSplitStateChanged(e, false /* isSplitCol */);
		}
		else if (e.commandName === '.uno:RowColSelCount') {
			// We also call the function when state is empty, because row/column variables should be set.
			if (e.state.trim() === '' || e.state.startsWith('Selected'))
				this._onRowColSelCount(e.state.replace('Selected:', '').replace('row', '').replace('column', '').replace('s', ''));
		}
		else if (e.commandName === '.uno:InsertMode') {
			/* If we get textselection message from core:
				When insertMode is active:  User is selecting some text.
				When insertMode is passive: User is selecting cells.
			*/
			this.insertMode = e.state.trim() === '' ? false: true;
			if (!this.insertMode) {
				app.setCursorVisibility(false);
				if (this._map._docLayer._cursorMarker)
					this._map._docLayer._cursorMarker.remove();

				var grid = document.getElementById('document-canvas');
				grid.classList.add('spreadsheet-cursor');
				grid.style.cursor = '';
				// More of a workaround, clear displayed references outside insert mode
				this._map._docLayer._clearReferences();
			}
		}
		else if (e.commandName === '.uno:ToggleSheetGrid') {
			let trimmedState = e.state.trim();
			// Disabled mean we don't change the sheet grid state.
			if (trimmedState != 'disabled') {
				let newState = trimmedState === 'true';
				if (this._sheetGrid != newState) {
					this._sheetGrid = newState;
					app.sectionContainer.requestReDraw();
				}
			}
		}
		else if (e.commandName === 'AutoFilterInfo') {
			app.calc.autoFilterCell = { 'row': e.state.row, 'column': e.state.column };
		}
		else if (e.commandName === 'AutoFilterChange')
		{
			this.sheetGeometry.autoFilterChanged = true;
		}
		else if (e.commandName === 'PivotTableFilterInfo') {
			app.calc.pivotTableFilterCell = { 'row': e.state.row, 'column': e.state.column };
		}
		else if (e.commandName === 'TableAutoFillInfo') {
			this._onTableAutoFillStateChanged(e.state.rectangle);
		}
		else if (e.commandName === 'SparklineGroup') {
			this._onSparklineGroupMsg(e.state);
		}
		else if (e.commandName === 'CellFormulaError') {
			this._onCellFormulaError(e.state);
		}
	},

	_onTableAutoFillStateChanged: function (textMsg) {
		var tablefillMarkerSection = app.sectionContainer.getSectionWithName(app.CSections.TableFillMarker.name);
		if (textMsg.match('EMPTY')) {
			if (tablefillMarkerSection)
				tablefillMarkerSection.calculatePositionViaCellCursor(null);
			this._tableAutoFillAreaPixels = null;
		}
		else
		{
			var strTwips = textMsg.match(/\d+/g);
			if (strTwips != null && this._map.isEditMode()) {
				var topLeftTwips = new cool.Point(parseInt(strTwips[0]), parseInt(strTwips[1]));
				var offset = new cool.Point(parseInt(strTwips[2]), parseInt(strTwips[3]));

				var topLeftPixels = this._twipsToCorePixels(topLeftTwips);
				var offsetPixels = this._twipsToCorePixels(offset);
				this._tableAutoFillAreaPixels = app.LOUtil.createRectangle(topLeftPixels.x, topLeftPixels.y, offsetPixels.x, offsetPixels.y);

				if (tablefillMarkerSection)
					tablefillMarkerSection.calculatePositionViaCellCursor([this._tableAutoFillAreaPixels.x1, this._tableAutoFillAreaPixels.y1]);
			}
			else {
				this._tableAutoFillAreaPixels = null;
			}
		}
	},

	_onSplitStateChanged: function (e, isSplitCol) {
		if (!this._splitPanesContext) {
			return;
		}

		if (!this._splitCellState) {
			this._splitCellState = new cool.Point(-1, -1);
		}

		if (!e.state || e.state.length === 0) {
			window.app.console.warn('Empty argument for ' + e.commandName);
			return;
		}

		var values = e.state.split('/');
		var newSplitIndex = Math.floor(parseInt(values[0]));
		window.app.console.assert(!isNaN(newSplitIndex) && newSplitIndex >= 0, 'invalid argument for ' + e.commandName);

		// This stores the current split-cell state of core, so this should not be modified.
		this._splitCellState[isSplitCol ? 'x' : 'y'] = newSplitIndex;

		if (!this.options.syncSplits) {
			return;
		}

		var changed = isSplitCol ? this._splitPanesContext.setSplitCol(newSplitIndex) :
			this._splitPanesContext.setSplitRow(newSplitIndex);

		if (changed) {
			this.setSplitPosFromCell();
		}
	},

	sendSplitIndex: function (newSplitIndex, isSplitCol) {

		if (!this._map.isEditMode() || !this._splitCellState || !this.options.syncSplits) {
			return false;
		}

		var splitColState = this._splitCellState.x;
		var splitRowState = this._splitCellState.y;
		if (splitColState === -1 || splitRowState === -1) {
			// Did not get the 'first' FreezePanesColumn/FreezePanesRow messages from core yet.
			return false;
		}

		var currentState = isSplitCol ? splitColState : splitRowState;
		if (currentState === newSplitIndex) {
			return false;
		}

		var unoName = isSplitCol ? 'FreezePanesColumn' : 'FreezePanesRow';
		var command = {};
		command['Index'] = {
			type: 'int32',
			value: newSplitIndex
		};

		this._map.sendUnoCommand('.uno:' + unoName, command);
		return true;
	},

	_onCommandValuesMsg: function (textMsg) {
		var jsonIdx = textMsg.indexOf('{');
		if (jsonIdx === -1)
			return;

		var values = JSON.parse(textMsg.substring(jsonIdx));
		if (!values) {
			return;
		}

		var comment;
		if (values.commandName === '.uno:ViewRowColumnHeaders') {
			this._updateHeadersGridLines(values);

		} else if (values.commandName === '.uno:SheetGeometryData') {
			var differentSheet = this.sheetGeometry === undefined || this._selectedPart !== this.sheetGeometry.getPart();
			// duplicate sheet-geometry for same sheet triggers replay of other messages that
			// disrupt the view restore during sheet switch.
			if (this._oldSheetGeomMsg === textMsg && !differentSheet)
				return;

			this._oldSheetGeomMsg = textMsg;
			this._handleSheetGeometryDataMsg(values, differentSheet);
			this._syncTileContainerSize();
		} else if (values.comments) {
			values.comments.forEach(function(comment) {
				comment.id = String(comment.id);
			});
			app.sectionContainer.getSectionWithName(app.CSections.CommentList.name).importComments(values.comments);
		} else if (values.commentsPos) {
			var section = app.sectionContainer.getSectionWithName(app.CSections.CommentList.name);
			// invalidate all comments
			section.sectionProperties.commentList.forEach(function (comment) {
				comment.valid = false;
			});
			for (var index in values.commentsPos) {
				comment = values.commentsPos[index];
				var commentObject = section.getComment(String(comment.id));
				if (commentObject) {
					if (commentObject.sectionProperties.data.tab !== comment.tab) {
						// tabs can be moved around and we need to update the tab because the id is still valid.
						commentObject.sectionProperties.data.tab = comment.tab;
					}
					commentObject.valid = true;

					// turn cell range string into Bounds
					commentObject.sectionProperties.data.cellRange = this._parseCellRange(comment.cellRange);

				}
			}

			section.onCommentsDataUpdate();

		} else {
			window.L.CanvasTileLayer.prototype._onCommandValuesMsg.call(this, textMsg);
		}
	},

	_onTextSelectionMsg: function (textMsg) {
		window.L.CanvasTileLayer.prototype._onTextSelectionMsg.call(this, textMsg);
		// If this is a cellSelection message, user shouldn't be editing a cell. Below check is for ensuring that.
		if ((this.insertMode === false || app.file.textCursor.visible === false) && app.calc.cellCursorVisible) {
			// When insertMode is false, this is a cell selection message.
			textMsg = textMsg.replace('textselection:', '').trim();
			if (textMsg !== 'EMPTY' && textMsg !== '') {
				this._cellSelections = this._getRawRectangles(textMsg);

				this._cellSelections = this._cellSelections.map(function(element) {
					return new cool.SimpleRectangle(element[0], element[1], element[2], element[3]);
				});
			}
			else {
				this._cellSelections = Array(0);
			}
			this._refreshRowColumnHeaders();
		}
	},

	allowDrawing: function () {
		// Drawing is disabled from CalcTileLayer construction, enable it now.
		this._gotFirstCellCursor = true;

		// ...and ACTUALLY enable it. Setting the flag alone is a one-way brick:
		// enableDrawing()'s only Calc caller is inside _onCellCursorMsg's
		// `if (!this._gotFirstCellCursor)` block below, so whoever sets the flag
		// first decides whether drawing is ever turned on. IdleHandler._activate
		// (Control.IdleHandler.ts) calls allowDrawing() on reactivation; if that
		// lands BEFORE the first cellcursor -- which is exactly what happens when
		// a document idles out before it has finished loading, as it does on a
		// phone where the fork boots inside a hidden/animating iframe -- the
		// branch is consumed, enableDrawing() is never reached, and the canvas
		// stays disabled for the life of the document. The symptom is a grid that
		// never paints and never errors.
		//
		// Idempotent: CanvasSectionContainer.enableDrawing() early-returns when
		// drawing is already on, so the in-order path costs one predictable call.
		this.enableDrawing();
	},

	_onCellCursorMsg: function (textMsg) {
		window.L.CanvasTileLayer.prototype._onCellCursorMsg.call(this, textMsg);
		this._refreshRowColumnHeaders();
		if (!this._gotFirstCellCursor) {
			this.allowDrawing();
			RenderManager.update();
			this.enableDrawing();
		}
	},

	_getEditCursorRectangle: function (msgObj) {

		if (!this.options.printTwipsMsgsEnabled || !this.sheetGeometry ||
			!Object.prototype.hasOwnProperty.call(msgObj, 'relrect') || !Object.prototype.hasOwnProperty.call(msgObj, 'refpoint')) {
			// 1) non-print-twips messaging mode OR
			// 2) the edit-cursor belongs to draw/chart objects.
			return window.L.CanvasTileLayer.prototype._getEditCursorRectangle.call(this, msgObj);
		}

		if (typeof msgObj !== 'object') {
			window.app.console.error('invalid edit cursor message');
			return undefined;
		}

		var relrect = cool.Bounds.parse(msgObj.relrect);
		var refpoint = cool.Point.parse(msgObj.refpoint);
		refpoint = this.sheetGeometry.getTileTwipsPointFromPrint(refpoint);
		return relrect.add(refpoint);
	},

	_getTextSelectionRectangles: function (textMsg) {

		if (!this.options.printTwipsMsgsEnabled || !this.sheetGeometry) {
			return window.L.CanvasTileLayer.prototype._getTextSelectionRectangles.call(this, textMsg);
		}

		if (typeof textMsg !== 'string') {
			window.app.console.error('invalid text selection message');
			return [];
		}

		var refpointDelim = '::';
		var delimIndex = textMsg.indexOf(refpointDelim);
		if (delimIndex === -1) {
			// No refpoint information available, treat it as cell-range selection rectangle.
			var rangeRectArray = cool.Bounds.parseArray(textMsg);
			rangeRectArray = rangeRectArray.map(function (rect) {
				return this._convertToTileTwipsSheetArea(rect);
			}, this);
			return rangeRectArray;
		}

		var refpoint = cool.Point.parse(textMsg.substring(delimIndex + refpointDelim.length));
		refpoint = this.sheetGeometry.getTileTwipsPointFromPrint(refpoint);

		var rectArray = cool.Bounds.parseArray(textMsg.substring(0, delimIndex));
		rectArray.forEach(function (rect) {
			rect._add(refpoint); // compute absolute coordinates and update in-place.
		});

		return rectArray;
	},

	getSnapDocPosX: function (docPosX, unit) {
		if (!this.options.sheetGeometryDataEnabled) {
			return docPosX;
		}

		unit = unit || 'corepixels';

		return this.sheetGeometry.getSnapDocPosX(docPosX, unit);
	},

	getSnapDocPosY: function (docPosY, unit) {
		if (!this.options.sheetGeometryDataEnabled) {
			return docPosY;
		}

		unit = unit || 'corepixels';

		return this.sheetGeometry.getSnapDocPosY(docPosY, unit);
	},

	getSplitPanesContext: function () {
		if (!this.hasSplitPanesSupport()) {
			return undefined;
		}

		return this._splitPanesContext;
	},

	getMaxDocSize: function () {

		if (this.sheetGeometry) {
			return this.sheetGeometry.getSize('corepixels');
		}

		return this._twipsToPixels(new cool.Point(app.activeDocument.fileSize.x, app.activeDocument.fileSize.y));
	},

	_calculateScrollForNewCellCursor: function () {
		var scroll = new cool.SimplePoint(0, 0);

		if (!app.calc.cellCursorVisible) {
			return scroll;
		}

		let paneRectangles = app.getViewRectangles(); // SimpleRectangle array.
		let contained = false;
		for (let i = 0; i < paneRectangles.length; i++) {
			if (paneRectangles[i].containsRectangle(app.calc.cellCursorRectangle.toArray()))
				contained = true;
		}

		if (contained)
			return scroll; // No scroll needed.

		var noSplit = !this._splitPanesContext || this._splitPanesContext.getSplitPos().equals(new cool.Point(0, 0));

		// No split panes. Check if target cell is bigger than screen but partially visible.
		if (noSplit && app.calc.cellCursorRectangle.intersectsRectangle(paneRectangles[0].toArray())) {
			if (app.calc.cellCursorRectangle.width > paneRectangles[0].width || app.calc.cellCursorRectangle.height > paneRectangles[0].height)
				return scroll; // no scroll needed.
		}

		let freePane = paneRectangles[paneRectangles.length - 1]; // Last pane, this should be the scrollable - not frozen one.

		// Phone reveal margin (item 2.4c). The arithmetic below lands the cell
		// FLUSH with the pane edge: arrow down and its bottom border sits on the
		// seam above the bottom-docked formula bar (docs/mobile-redesign/02 §2),
		// arrow up and its top sits under the column header. Sheets always keeps
		// a sliver of the neighbouring row showing so you can see where you are.
		// Desktop and tablet get 0 and the arithmetic is unchanged for them.
		let vRevealMargin = 0;
		let hRevealMargin = 0;
		if (window.mode.isSmallScreenDevice() &&
			document.documentElement.classList.contains('vulcan-mobile-chrome')) {
			// 24 CSS px is a little over one default row at the phone's opening
			// zoom (index 11 = 1.2x, CalcTileLayer.onAdd). app.pixelsToTwips
			// converts DEVICE px, so scale by dpiScale first -- the same shape
			// CanvasTileLayer.js:3366 uses.
			const marginTwips = Math.round(24 * app.dpiScale * app.pixelsToTwips);
			// Never ask for more clearance than the pane can give, or the top and
			// bottom clamps below fight each other and the cell oscillates.
			vRevealMargin = Math.min(marginTwips,
				Math.max(0, Math.floor((freePane.height - app.calc.cellCursorRectangle.height) / 2)));
			hRevealMargin = Math.min(marginTwips,
				Math.max(0, Math.floor((freePane.width - app.calc.cellCursorRectangle.width) / 2)));
		}

		// Horizontal split
		if (app.calc.cellCursorRectangle.x2 > app.calc.splitCoordinate.x) {
			if (app.calc.cellCursorRectangle.width > freePane.width)
				return scroll; // no scroll needed.

			if (app.calc.cellCursorRectangle.x1 - hRevealMargin < freePane.x1) {
				scroll.x = app.calc.cellCursorRectangle.x1 - hRevealMargin - freePane.x1;
			}
			else if (app.calc.cellCursorRectangle.x2 + hRevealMargin > freePane.x2) {
				scroll.x = app.calc.cellCursorRectangle.x2 + hRevealMargin - freePane.x2;
			}
		}

		// Vertical split
		if (app.calc.cellCursorRectangle.y2 > app.calc.splitCoordinate.y) {
			if (app.calc.cellCursorRectangle.height > freePane.height)
				return scroll; // no scroll needed.

			// try to center in free pane the top of a cell
			if (app.calc.cellCursorRectangle.y1 - vRevealMargin < freePane.y1)
				scroll.y = app.calc.cellCursorRectangle.y1 - vRevealMargin - freePane.y1;

			// then check if end of a cell is visible
			if (app.calc.cellCursorRectangle.y2 + vRevealMargin > freePane.y2 + scroll.y)
				scroll.y = scroll.y + (app.calc.cellCursorRectangle.y2 + vRevealMargin - freePane.y2);
		}

		return scroll;
	},

	getSelectedPart: function () {
		return this._selectedPart;
	},
});
