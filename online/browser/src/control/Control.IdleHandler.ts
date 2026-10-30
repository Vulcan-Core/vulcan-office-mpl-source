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
/*
 * Class for idle handling of the view.
 */

/* global app L RenderManager */

// FIXME: These should surely be somewhere else and not in this random .ts file.
declare var mode: any;
declare var ThisIsTheAndroidApp: any;
declare var postMobileMessage: any;
declare var postMobileCall: any;
declare var idleTimeoutSecs: number;
declare var outOfFocusTimeoutSecs: number;

/**/

app.idleHandlerId = 'inactive_user_message';

class IdleHandler {
    _serverRecycling: boolean = false;
    _documentIdle: boolean = false;
	_lastActivity: number = Date.now();
	_inactivityTimer: ReturnType<typeof setTimeout> = null;
	_outOfFocusTimer: ReturnType<typeof setTimeout> = null;
    _active: boolean = true;
    map: any;
	dimId: string = app.idleHandlerId;

	getIdleMessage(): string {
		if (this.map['wopi'] && this.map['wopi'].DisableInactiveMessages) {
			return '';
		} else if (window.mode.isDesktop()) {
			return _('Idle document - please click to reload and resume editing');
		} else {
			return _('Idle document - please tap to reload and resume editing');
		}
	}

	isDimActive(): boolean {
		return !!document.getElementById(this.map.uiManager.generateModalId(this.dimId));
	}

	// time from the last activity in [s]
	getElapsedFromActivity(): number {
		return (Date.now() - this._lastActivity) / 1000;
	}

	refreshAnnotations() {
		var docLayer = this.map._docLayer;
		if (docLayer.isCalc() && docLayer.options.sheetGeometryDataEnabled) {
			docLayer.requestSheetGeometryData();
		}
		app.socket.sendMessage('commandvalues command=.uno:ViewAnnotations');
	}

	// Vulcan Office: @allowFocusGrab false reactivates without taking
	// the caret, for the load path of a host that asked us not to
	// (Vulcan_FocusPolicy). It defaults to the upstream grab, so the idle-resume
	// and reconnect callers are unchanged.
	_activate(allowFocusGrab: boolean = true) {
		window.app.console.debug('IdleHandler: _activate()');

		if (this._serverRecycling || this._documentIdle) {
			return false;
		}

		this._startInactiveTimer();
		this._stopOutOfFocusTimer();

		if (!this._active) {
			// Only activate when we are connected.
			if (app.socket.connected()) {
				app.socket.sendMessage('useractive');
				this._active = true;
				if (app.telemetry) app.telemetry.record('doc_active', {});

				/*
				  If we have the docLayer then refresh annotations now. If not then
				  postpone until we do have the docLayer so we know if this is calc
				  or not, because for calc we have to ensure we have the sheet
				  geometry before requesting annotations otherwise we will lack the
				  requirements to position them.
				*/
				if (this.map._docLayer) {
					this.map._docLayer.allowDrawing();
					this.refreshAnnotations();

					// Re-ask for the tiles we are looking at. Reactivation restores
					// DRAWING but nothing re-requests CONTENT: _dim() tears down the
					// prefetch timers and this path issues no tilecombine, so a
					// document that idles out comes back with correct furniture --
					// headers, gridlines, selection all repaint -- and permanently
					// empty cells. Measured on a phone: 288 tiles in the store, 157
					// holding content, ZERO holding a decoded bitmap, and tapping the
					// "Idle document" overlay did not change that.
					this.map._docLayer._requestNewTiles();
				}
				else {
					this.map.once('doclayerinit', this.refreshAnnotations, this);
				}

				if (this.isDimActive()) {
					this.map.jsdialog.closeDialog(this.dimId, false);
					return true;
				}
			} else {
				this.map.loadDocument();
				// Vulcan Office (R7): a view not connected yet has
				// nothing to type into, and every mousemove and wheel over the
				// document lands here while it reconnects, so on desktop Calc
				// each one took the host's caret. The socket's open reactivates
				// it (Socket._onSocketOpen) and makes the upstream grab there.
				return false;
			}
		}

		// Ideally instead of separate isAnyEdit check here, we could check isAnyEdit inside isAnyDialogOpen,
		// but unfortunately that causes problem in _deactivate and unnecessary 'userinactive' message is sent
		if (allowFocusGrab
		&& window.mode.isDesktop()
		&& !this.map.uiManager.isAnyDialogOpen()
		&& !cool.Comment.isAnyEdit()
		&& (this.map.formulabar && !this.map.formulabar.hasFocus())
		&& $('input:focus').length === 0) {
			this.map.focus();
		}

		return false;
	}

	_startInactiveTimer() {
		if (this._serverRecycling || this._documentIdle || !this.map._docLoaded) {
			return;
		}

		clearTimeout(this._inactivityTimer);

		this._inactivityTimer = setTimeout(() => {
			this._dimIfInactive();
		}, (window.L.Browser.cypressTest ? 1000 : 1 * 60 * 1000)); // Check once a minute
	}

	_startOutOfFocusTimer() {
		if (this._serverRecycling || this._documentIdle || !this.map._docLoaded) {
			return;
		}

		this._stopOutOfFocusTimer();

		this._outOfFocusTimer = setTimeout(() => {
			this._dim();
		}, window.outOfFocusTimeoutSecs * 1000);
	}

	_stopOutOfFocusTimer() {
		clearTimeout(this._outOfFocusTimer);
	}

	_dimIfInactive() {
		if (this.map._docLoaded && (this.getElapsedFromActivity() >= window.idleTimeoutSecs)) {
			this._dim();
		} else {
			this._startInactiveTimer();
		}
	}

	_dim() {
		if (this.map.slideShowPresenter && this.map.slideShowPresenter._checkAlreadyPresenting())
			return; // do not stop presentation

		this.map.fire('closealldialogs');
		const message = this.getIdleMessage();

		window.app.console.debug('IdleHandler: _dim()');

		if (document.getElementById(this.dimId))
			return;

		this._active = false;
		if (app.telemetry) app.telemetry.record('doc_idle', {});
		var map = this.map;

		// VULCAN (code review): waking a dimmed view is no
		// gesture in this frame. The mouse only crossed the dim's overlay, yet
		// two steps of the wake gave the keyboard to the document: the
		// overlay's closeModal, whose close hands focus back to what had it
		// when the dim opened (nothing in this frame, so the document), and
		// the second restartConnectionFn below, run when the dim leaves the
		// DOM with _active already true, which went on to the desktop Calc
		// grab. On the vbox rig (#10704's image) a sheet the out-of-focus timer
		// had dimmed took the keyboard from the agent composer that way, and
		// what the person typed next went into a cell and was saved as their
		// own edit. While the host owns the keyboard (Vulcan_FocusPolicy, or
		// the embedded default Map.initialize sets) and this frame does not
		// hold it, both leave focus where it is: the caret path's test
		// (CanvasTileLayer._updateCursorAndOverlay). A click into the sheet
		// still takes the keyboard; a top-level editor, or a frame that holds
		// the keyboard, keeps the upstream grabs. The policy test comes first
		// for the rigs that run this over a stub map.
		const vulcanHostKeepsKeyboard = () =>
			map._vulcanAutoFocusOnLoad === false && !document.hasFocus();

		var restartConnectionFn = () => {
			if (app.idleHandler._documentIdle)
			{
				window.app.console.debug('idleness: reactivating');
				map.fire('postMessage', {msgId: 'User_Active'});
				app.idleHandler._documentIdle = false;
				app.setCursorVisibility(true);
			}
			const allowFocusGrab = !vulcanHostKeepsKeyboard();
			return app.idleHandler._activate(allowFocusGrab);
		};

		this.map._textInput.hideCursor();

		const uiManager = this.map.uiManager;
		const dialogId = uiManager.generateModalId(this.dimId);
		uiManager.showInfoModal(this.dimId);

		app.layoutingService.appendLayoutingTask(() => {
			const dimNode = document.getElementById(this.dimId);
			if (!dimNode)
				return;

			dimNode.textContent = message;

			const restartConnection = () => { restartConnectionFn(); };

			if (message === '') {
				const dialogNode = document.getElementById(dialogId);
				if (dialogNode) dialogNode.style.display = 'none';
				app.LOUtil.onRemoveHTMLElement(dimNode, restartConnection);
			} else {
				const overlayId = dialogId + '-overlay';
				const overlay = document.getElementById(overlayId);
				if (overlay) overlay.onmouseover = () => {
					restartConnection();
					uiManager.closeModal(dialogId, vulcanHostKeepsKeyboard());
				};
				app.LOUtil.onRemoveHTMLElement(overlay, restartConnection);
			}
		});

		this._sendInactiveMessage();

		RenderManager.clearPreFetch();
	}

	notifyActive() {
		this._lastActivity = Date.now();
		this._stopOutOfFocusTimer();
		if (!this._active) {
			this._activate();
		}

		if (window.ThisIsTheAndroidApp) {
			window.postMobileMessage('LIGHT_SCREEN');
		}
	}

	_sendInactiveMessage() {
		this.map._doclayer && this.map._docLayer._onMessage('textselection:', null);
		this.map.fire('postMessage', {msgId: 'User_Idle'});
		if (app.socket.connected()) {
			app.socket.sendMessage('userinactive');
		}
	}

	_deactivate() {
		window.app.console.debug('IdleHandler: _deactivate()');

		if (this._serverRecycling || this._documentIdle || !this.map._docLoaded) {
			return;
		}

		if (window.mode.isDesktop() && (!this._active || this.isDimActive())) {
			// A dialog is already dimming the screen and probably
			// shows an error message. Leave it alone.
			this._active = false;
			this._sendInactiveMessage();

			return;
		}

		if (app.map && app.map.formulabar &&
			(app.map.formulabar.hasFocus() || app.map.formulabar.isInEditMode()))
			app.dispatcher.dispatch('acceptformula'); // save data from the edited cell on exit

		this._startOutOfFocusTimer();
	}
}

// Initiate the class.
app.idleHandler = new IdleHandler();
