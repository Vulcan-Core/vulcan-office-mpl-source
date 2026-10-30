/* -*- js-indent-level: 8 -*- */
/*
 * window.L.Handler.Scroll is used by window.L.Map to enable mouse scroll wheel zoom on the map.
 */

/* global app OtherViewCellCursorSection InternPointUtil RenderManager VulcanLiveCanvas */
window.L.Map.mergeOptions({
	scrollHandler: true,
	wheelDebounceTime: 40,
	// Max idle time w.r.t ctrl+wheel events before invoking "zoomStepEnd".
	// At 500 every tick showed a soft preview for about 0.6 s. A
	// tick that lands while the last one commits is replayed, not dropped.
	wheelZoomStepEndAfter: 150,
	// Step size in zoom level(log scale) for ctrl + wheel zoom animation.
	zoomLevelStepSize: 0.3,
	// Trackpad pinch travel for one zoom step (x1.2): Chrome sends a pinch
	// of scale s as ctrl+wheel deltaY adding up to -100 * ln(s) pixels.
	wheelPinchPxPerStep: 100 * Math.log(1.2),
});

window.L.Map.Scroll = window.L.Handler.extend({
	_mouseOnlyPreventDefault: window.touch.mouseOnly(window.L.DomEvent.preventDefault),
	addHooks: function () {
		window.L.DomEvent.on(this._map._container, {
			wheel: this._onWheelScroll,
			mousewheel: this._onWheelScroll,
			MozMousePixelScroll: this._mouseOnlyPreventDefault
		}, this);

		this._delta = 0;
		this._heldSteps = 0;
		this._vertical = 1;
		this.lastY = 0;
		this.lastX = 0;
	},

	removeHooks: function () {
		window.L.DomEvent.off(this._map._container, {
			mousewheel: this._onWheelScroll,
			MozMousePixelScroll: this._mouseOnlyPreventDefault
		}, this);
	},

	_onWheelScroll: window.touch.mouseOnly(function (e) {
		var delta =  -1 * e.deltaY; // window.L.DomEvent.getWheelDelta(e);
		var debounce = this._map.options.wheelDebounceTime;

		var viewCenter = this._map.getCenter();
		var mousePos = this._map.mouseEventToIntern(e);

		var docLayer = this._map._docLayer;
		if (docLayer && docLayer.isCalc()) {
			this._zoomCenter = mousePos;
		} else if (docLayer && docLayer.isWriter()) {
			// Preserve the y coordinate position of the document where the mouse is.
			// Also preserve x coordinate if the current view does not have margins.
			//  If view has margins, we cannot center w.r.t arbitrary position in the page because
			//  writer will eventually re-adjust page to the view's center after setting map zoom.
			var part = docLayer._currentPage;
			var rectangle = app.file.writer.pageRectangleList[part];
			var minX = Math.round(rectangle[0] * app.twipsToPixels);
			var maxX = minX + Math.round(rectangle[2] * app.twipsToPixels);
			var viewBounds = this._map.getPixelBoundsCore();
			var useMouseXCenter = viewBounds.min.x >= 0 && viewBounds.max.x <= maxX;

			this._zoomCenter = InternPointUtil.flexConstruct(useMouseXCenter ? mousePos.x : viewCenter.x, mousePos.y);

		} else if (docLayer && VulcanLiveCanvas.isCanvasDocType(docLayer._docType) &&
			window.RenderManager && RenderManager.isVectorRendering()) {
			// Zoom-in anchors at the MOUSE; zoom-out ignores the anchor
			// (the discrete path lands centered via the view clamps).
			this._zoomCenter = mousePos;
		} else {
			this._zoomCenter = viewCenter;
		}

		if (!this._startTime) {
			this._startTime = +new Date();
		}

		var left = Math.max(debounce - (+new Date() - this._startTime), 0);

		clearTimeout(this._timer);
		if (e.ctrlKey) {
			this._delta += this._wheelSteps(e, delta);
			this._timer = setTimeout(window.L.bind(this._performZoom, this), left);
		} else {
			this._delta = 0;
		}

		window.L.DomEvent.stop(e);
	}),

	// Zoom steps one ctrl+wheel event asks for. A wheel notch is one step;
	// a macOS mouse notch is a multiple of 4.000244140625 px. A trackpad
	// pinch is a stream of pixel deltas under 4 px (maplibre-gl's wheel
	// rule): it steps each time it has moved half a step past the last
	// one, so it zooms as far as the fingers move, not for as long as they
	// move.
	_wheelSteps: function (e, delta) {
		if (!delta)
			return 0;
		if (e.deltaMode !== 0 || Math.abs(delta) >= 4)
			return delta > 0 ? 1 : -1;
		var now = +new Date();
		if (!(now - this._pinchAt <= this._map.options.wheelZoomStepEndAfter))
			this._pinchPx = 0;
		this._pinchAt = now;
		this._pinchPx += delta;
		var perStep = this._map.options.wheelPinchPxPerStep;
		var steps = Math.round(this._pinchPx / perStep);
		this._pinchPx -= steps * perStep;
		return steps;
	},

	_performZoom: function () {
		if (this._map.getDocType() === 'spreadsheet')
			OtherViewCellCursorSection.closePopups();

		var lastScrollTime = this._zoomScrollTime;
		this._zoomScrollTime = new Date();
		var map = this._map;
		var mapZoom = map.getZoom();

		var newAnimation = !lastScrollTime ||
			(this._zoomScrollTime - lastScrollTime) > this._map.options.wheelZoomStepEndAfter;

		// A batch moves at most one step: restrict delta to { -1, 0, 1 }
		var delta = this._delta;
		delta = delta > 0 ? Math.ceil(delta) : Math.floor(delta);
		delta = Math.max(Math.min(delta, 1), -1);
		this._delta = 0;
		this._startTime = null;

		if (newAnimation && this._inZoomAnimation) {
			// The last tick is still committing. Hold this batch's step;
			// the finish replays every held step as one target, so a
			// slow spin keeps each notch however long the tiles take.
			this._heldSteps += delta;
			this._zoomScrollTime = undefined;
			return;
		}

		delta += this._heldSteps;
		this._heldSteps = 0;
		map.stop(); // stop panning and fly animations if any

		if (!delta) {
			// A pinch short of a step: a running animation keeps its
			// preview, and with none the next batch starts one.
			if (newAnimation)
				this._zoomScrollTime = undefined;
			else
				this._stopZoomInterpolateRAFAt = this._zoomScrollTime.valueOf() + this._map.options.wheelZoomStepEndAfter;
			return;
		}

		// Compute current zoom-frame's level.
		var prevZoom = newAnimation ? mapZoom : this._zoom;
		this._zoom = map._limitZoom(prevZoom + delta);
		if (newAnimation && this._zoom === mapZoom) {
			// We hit limits, don't start a new animation.
			this._zoomScrollTime = undefined;
			return;
		}

		this._stopZoomInterpolateRAFAt = this._zoomScrollTime.valueOf() + this._map.options.wheelZoomStepEndAfter;

		// In multi-page or compare changes view, skip animation and zoom directly.
		if (app.activeDocument && app.activeDocument.activeLayout &&
			['ViewLayoutMultiPage', 'ViewLayoutCompareChanges'].includes(app.activeDocument.activeLayout.type)) {
			map.setZoom(this._zoom, null, false);
			this._zoomScrollTime = undefined;
			return;
		}

		// Vector Impress: every wheel tick is a DISCRETE zoom through
		// Map.setZoom's slide law — zoom-out lands centered, zoom-in
		// keeps the view (pad-clamped), each instantly. The animated
		// zoomStep pipeline scales around a fixed anchor and then
		// re-derives its own settle center, which is exactly the
		// "delayed jerk" on release; skipping it removes the second
		// geometry rather than reconciling with it.
		var scrollDocLayer = map._docLayer;
		if (scrollDocLayer && VulcanLiveCanvas.isCanvasDocType(scrollDocLayer._docType) &&
			window.RenderManager && RenderManager.isVectorRendering()) {
			map.setZoom(this._zoom,
				this._zoom > mapZoom ? { around: this._zoomCenter } : null,
				false);
			this._zoomScrollTime = undefined;
			return;
		}

		if (newAnimation) {
			// Start from the map zoom. A frame zoom left from the last wheel
			// animation can equal this target after a status-bar or toolbar
			// zoom, and then no zoomStep runs.
			this._lastFrameZoom = undefined;
			this._inZoomAnimation = true;
			this._map._docLayer.preZoomAnimation(this._zoomCenter);
			this._zoomInterpolateRAF = requestAnimationFrame(this._zoomInterpolateRAFFunc.bind(this));
		}
	},

	// RAF function that generates intermediate zoom-levels between scroll events.
	_zoomInterpolateRAFFunc: function () {
		var lastZoom = this._lastFrameZoom || this._map.getZoom();
		var toZoom = this._zoom; // This can vary while RAF is running.
		var step = this._map.options.zoomLevelStepSize;
		var zoomOut = toZoom < lastZoom;
		var frameZoom = zoomOut ? Math.max(toZoom, lastZoom - step) :
			Math.min(toZoom, lastZoom + step);

		if (frameZoom !== toZoom)
			this._map._docLayer.zoomStep(frameZoom, this._zoomCenter);

		this._lastFrameZoom = frameZoom;
		var now = (new Date()).valueOf();
		if (now < this._stopZoomInterpolateRAFAt)
			this._zoomInterpolateRAF = requestAnimationFrame(this._zoomInterpolateRAFFunc.bind(this));
		else
			this._stopZoomAnimation();
	},

	_stopZoomAnimation: function () {
		cancelAnimationFrame(this._zoomInterpolateRAF); // Already cancelled by now ?
		// The painter calls runAtFinish only for an animation it is running.
		// When it has none (another zoom finishing dropped every zoomStep of
		// this tick) or is finishing another zoom, zoomStepEnd returns without
		// it, and _inZoomAnimation would drop every later tick until reload
		// End the tick here instead.
		var painter = this._map._docLayer._painter;
		if (!painter._inZoomAnim || painter._finishingZoom) {
			this._map._docLayer.postZoomAnimation();
			this._inZoomAnimation = false;
			if (this._delta || this._heldSteps)
				this._performZoom();
			return;
		}
		var zoom = this._zoom;
		var lastCenter = InternPointUtil.flexConstruct(this._zoomCenter.x, this._zoomCenter.y);
		var map = this._map;
		map._docLayer.zoomStepEnd(zoom, lastCenter,
			// mapUpdater
			function (newMapCenter) {
				map.setView(newMapCenter || lastCenter, zoom);
			},
			// showMarkers
			function () {
				map._docLayer.postZoomAnimation();
				this._inZoomAnimation = false;
				if (this._delta || this._heldSteps)
					this._performZoom();
			}.bind(this),
			true /* noGap */);
	},
});
