/* -*- js-indent-level: 8; fill-column: 100 -*- */
/*
 * Copyright the Collabora Online contributors.
 *
 * SPDX-License-Identifier: MPL-2.0
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
/* eslint-disable @typescript-eslint/no-empty-function */

// Bound kit churn after three failed loads. Production also saw recoveries after
// three failures, which need a fourth attempt; this policy makes those recoveries
// require explicit Retry rather than continuing automatic attempts indefinitely.
const MAX_CONSECUTIVE_LOAD_FAILURES = 3;

// After a dropped socket's immediate reconnect fails, retry on a backoff whose
// ceiling doubles from 1 s to 30 s, each wait jittered between half the ceiling
// and the ceiling. Nothing used to retry at all.
const RECONNECT_RETRY_BASE_MS = 1000;
const RECONNECT_RETRY_MAX_MS = 30000;
// A WebSocket handshake younger than this is left to finish. An older one is
// presumed hung, and the next reconnect trigger may replace it.
const HANDSHAKE_PATIENCE_MS = 10000;

// the notice for a save the WOPI host never answered (_onSaveUnanswered):
// its snackbar key, and how long it stays up.
const SAVE_UNANSWERED_KEY = 'vulcan-save-unanswered';
const SAVE_UNANSWERED_NOTICE_MS = 10000;

class Socket {
	private ProtocolVersionNumber: string = '0.1';
	private ReconnectCount: number = 0;
	// Consecutive FAILED document loads for this client. Deliberately NOT ReconnectCount:
	// that one guards only the `docunloading` wait-and-retry, and it is reset by
	// `progress: ready`, which WSD sends once the broker is obtained — BEFORE the load is
	// requested. A document that fails to load every single time therefore resets it on
	// every attempt and can never accumulate it. This counter is reset only where a
	// document genuinely loads, so an always-failing load cannot hide from it.
	private _consecutiveLoadFailures: number = 0;
	// The attempt (its _connectCount) whose server close already spent the
	// budget. Its queued load-error frame can drain after that close, even after
	// input has started the next attempt, and must not spend it again. 0: none
	// (attempts count from 1).
	private _loadFailureClosedAttempt: number = 0;
	private _loadFailureGiveUpNotified: boolean = false;
	private WasShownLimitDialog: boolean = false;
	public WSDServer: WSDServerInfo = {
		Id: '',
		Version: '',
		Hash: '',
		Protocol: '',
		Options: '',
		TimeZone: '',
	};
	private IndirectSocketReconnectCount: number = 0;
	private _initialConnectRetries: number = 0;
	// Once the compact /cool/ws URL has failed to connect and we have dropped
	// back to the legacy /cool/<doc>/ws URL, stay on the legacy URL for the
	// rest of the session.
	private _forceLegacyWsUrl: boolean = false;
	private _connectCount: number = 0;
	private _connectStartedAt: number = 0;
	private _reconnectRetries: number = 0;
	private _reconnectRetryTimer: TimeoutHdl | undefined;
	// The first load's handshake watchdog (_armInitialHandshakeWatchdog).
	private _initialHandshakeTimer: TimeoutHdl | undefined;
	// Reconnect handshakes replaced while still connecting since a document
	// last loaded: by the watchdog, or by input once past their patience.
	private _hungHandshakes: number = 0;
	// How long the handshake in flight may take before anything replaces it:
	// HANDSHAKE_PATIENCE_MS, or the watchdog's grown patience on a reconnect.
	private _handshakePatience: number = HANDSHAKE_PATIENCE_MS;
	// The reload interval a 'close: recycling' armed in this.timer. The
	// socket's close clears idleHandler._serverRecycling, so this handle is what
	// still says the recycle owns reconnecting.
	private _recycleTimer: ReturnType<typeof setInterval> | undefined;
	// takes down the notice _onSaveUnanswered put up.
	private _saveUnansweredTimer: TimeoutHdl | undefined;
	// a reload the server ordered (_onCloseMsg) while the frame did not
	// hold the keyboard; until its document is back, reactivating it leaves the
	// caret where it is.
	private _reloadLeavesCaret: boolean = false;

	/// Whether Trace Event recording is enabled or not. ("Enabled" here means whether it can be
	/// turned on (and off again), not whether it is on.)
	private enableTraceEventLogging: boolean = false;

	// Will be set from lokitversion message
	private TunnelledDialogImageCacheSize: number = 0;

	public _map: MapInterface;
	private _msgQueue: MessageInterface[];
	private _delayedMessages: DelayedMessageInterface[];
	private _slurpQueue: SlurpMessageEvent[];
	private _handlingDelayedMessages: boolean;
	private _inLayerTransaction: boolean;
	private _slurpDuringTransaction: boolean;
	private _accessTokenExpireTimeout: TimeoutHdl | undefined;
	private _accessTokenExpireWarningCount: number = 0;
	private _reconnecting: boolean;
	private _slurpTimer: TimeoutHdl | undefined;
	private _renderEventTimer: TimeoutHdl | undefined;
	private _renderEventTimerStart: DOMHighResTimeStamp | undefined;
	private _slurpTimerDelay: number | undefined;
	private _slurpTimerLaunchTime: number | undefined;
	private timer: ReturnType<typeof setInterval> | undefined;
	private workers: Worker[] = [];
	private workerMessageHandlers: Map<string, any> = new Map();
	private workerErrorHandlers: any[] = [];
	public threadLocalLoggingLevelToggle: boolean;

	private socket?: SockInterface;
	public traceEvents: TraceEvents;

	constructor(map: MapInterface) {
		window.app.console.debug('socket.initialize:');
		this._map = map;
		this._slurpQueue = [];
		this._msgQueue = [];
		this._delayedMessages = [];
		this._handlingDelayedMessages = false;
		this._inLayerTransaction = false;
		this._slurpDuringTransaction = false;
		this.threadLocalLoggingLevelToggle = false;
		this._accessTokenExpireTimeout = undefined;
		this._reconnecting = false;
		this._slurpTimer = undefined;
		this._renderEventTimer = undefined;
		this._renderEventTimerStart = undefined;
		this._slurpTimerDelay = undefined;
		this._slurpTimerLaunchTime = undefined;
		this.timer = undefined;
		this.socket = undefined;
		this.traceEvents = new TraceEvents(this);

		// Retries back off to 30 s. Coming back online or into view should not
		// wait that out.
		window.addEventListener('online', () => this._retryReconnect());
		document.addEventListener('visibilitychange', () => this._retryReconnect());

		if (
			window.Worker &&
			(!(window as any).ThisIsAMobileApp || (window as any).mode.isCODesktop())
		) {
			window.app.console.info('Creating TaskWorkers');
			for (let i = 0; i < 4; ++i) {
				try {
					this.workers.push(
						new Worker(app.LOUtil.getURL('/src/app/TaskWorker.js')),
					);
					this.workers[i].addEventListener('message', (e: any) =>
						this.onWorkerMessage(e),
					);
					this.workers[i].addEventListener('error', (e: any) =>
						this.onWorkerError(e),
					);
				} catch (e) {
					this.onWorkerError(e);
					break;
				}
			}
		}
	}

	public getTaskWorkers(): Worker[] {
		return this.workers.slice();
	}

	public setTaskHandler(message: string, callback: any) {
		if (this.workerMessageHandlers.has(message))
			window.app.console.warn(
				'Duplicate task handler for ' + message,
				callback,
			);
		this.workerMessageHandlers.set(message, callback);
	}

	public addTaskErrorHandler(callback: any) {
		this.workerErrorHandlers.push(callback);
	}

	private onWorkerMessage(e: any) {
		const callback = this.workerMessageHandlers.get(e.data.message);
		if (!callback) {
			window.app.console.warn('Unhandled worker message', e);
			return;
		}

		callback(e);
	}

	private onWorkerError(e: any) {
		if (e) window.app.console.error('Worker-related error encountered', e);
		while (this.workers.length) {
			const worker = this.workers.shift();
			if (!worker) continue;
			try {
				worker.terminate();
			} catch (e) {
				window.app.console.error('Error terminating worker thread', e);
			}
		}
		this.workerMessageHandlers.clear();
		if (e) for (const callback of this.workerErrorHandlers) callback(e);
		this.workerErrorHandlers = [];
	}

	public disableTaskWorkers() {
		this.onWorkerError(null);
	}

	// Wrap the active socket in a DelaySocket so all incoming and outgoing
	// messages are delayed by delayMs (preserving FIFO order). No-op if
	// already wrapped or no socket is connected.
	public enableMessageDelay(delayMs: number): void {
		if (!this.socket || this.socket instanceof DelaySocket) return;

		const wrapper = new DelaySocket(this.socket, delayMs);
		wrapper.onerror = this._onSocketError.bind(this);
		wrapper.onclose = this._onSocketClose.bind(this);
		wrapper.onopen = this._onSocketOpen.bind(this);
		wrapper.onmessage = this._slurpMessage.bind(this);
		this.socket = wrapper;
	}

	public setMessageDelay(delayMs: number): void {
		if (this.socket instanceof DelaySocket) this.socket.setDelay(delayMs);
	}

	// Unwrap a previously-installed DelaySocket, restoring the raw socket.
	// No-op if there is no wrapper.
	public disableMessageDelay(): void {
		if (!this.socket || !(this.socket instanceof DelaySocket)) return;

		const inner = this.socket.unwrap();
		inner.onerror = this._onSocketError.bind(this);
		inner.onclose = this._onSocketClose.bind(this);
		inner.onopen = this._onSocketOpen.bind(this);
		inner.onmessage = this._slurpMessage.bind(this);
		this.socket = inner;
	}

	public sendMessage(msg: MessageInterface): void {
		const isTokenReset = typeof msg === 'string' && msg.startsWith('resetaccesstoken ');
		// Renewals update docParams separately. A closed socket will use those
		// values on its scheduled reconnect; do not start another reconnect here.
		// CONNECTING must keep the renewal queued: its URL already holds the old token.
		if (isTokenReset) {
			// A failed connection can leave an older reset in the queue. Never
			// replay it over a newer token, including one received while closed.
			this._msgQueue = this._msgQueue.filter((queued) =>
				typeof queued !== 'string' || !queued.startsWith('resetaccesstoken '));
			if (!this.socket || this.socket.readyState >= 2) return;
		}

		if (!this.socket) {
			console.error('sendMessage() called with non-existent socket!');
			return;
		}

		if (this._map._debug.eventDelayWatchdog) this._map._debug.timeEventDelay();

		if (this._map._fatal) {
			// Avoid communicating when we're in fatal state
			return;
		}

		if (!app.idleHandler._active) {
			// Avoid communicating when we're inactive.
			if (typeof msg !== 'string') return;

			// resetaccesstoken rides through too: a dimmed view's coolwsd
			// session has to keep taking the host's renewals, or its token
			// dies while the user is in another tab and their first save on
			// return is a 401 (App_TokenExpired). Without the exemption the
			// renewal was logged here and dropped, and the host never knew.
			if (
				!msg.startsWith('useractive') &&
				!msg.startsWith('userinactive') &&
				!msg.startsWith('resetaccesstoken')
			) {
				window.app.console.log(
					'Ignore outgoing message due to inactivity: "' + msg + '"',
				);
				return;
			}
		}

		// Busy UI blocks document commands, but token maintenance must continue.
		if (!isTokenReset && this._map.uiManager && this._map.uiManager.isUIBlocked()) return;

		const socketState = this.socket.readyState;
		if (socketState === 2 || socketState === 3) {
			this._map.loadDocument();
		}

		if (socketState === 1) {
			this._doSend(msg);
		} else {
			// push message while trying to connect socket again.
			this._msgQueue.push(msg);
		}
	}

	public sendTraceEvent(
		name: any,
		ph: string,
		timeRange: undefined | string,
		args?: any,
		id?: number | string,
		tid?: number | string,
	): void {
		this.traceEvents.send(name, ph, timeRange, args, id, tid);
	}

	get traceEventRecordingToggle(): boolean {
		return this.traceEvents.getRecordingToggle();
	}

	public setTraceEventLogging(enabled: boolean) {
		this.traceEvents.setLogging(enabled);
	}

	public createAsyncTraceEvent(
		name: string,
		args?: any,
	): CompleteTraceEvent | null {
		return this.traceEvents.createAsync(name, args);
	}

	public _stringifyArgs(args: any): string {
		return args == null ? '' : ' args=' + JSON.stringify(args);
	}

	public createCompleteTraceEvent(
		name: string,
		args?: any,
	): CompleteTraceEvent | null {
		return this.traceEvents.createComplete(name, args);
	}

	public createCompleteTraceEventFromEvent(
		textMsg?: string,
	): CompleteTraceEvent | null {
		return this.traceEvents.createCompleteFromEvent(textMsg);
	}

	public parseServerCmd(msg: string): ServerCommand {
		return new ServerCommand(msg, this._map);
	}

	private getWebSocketBaseURI(map: MapInterface): string {
		if (map.options.wopiSrc && !this._forceLegacyWsUrl) {
			// Use the new Cool WS URL for WOPI documents.
			return window.makeWopiCoolWsUrl(
				window.makeWsUrl('/cool'),
				$.param(map.options.docParams),
			);
		} else {
			return window.makeWsUrlWopiSrc(
				'/cool/',
				map.options.doc + '?' + $.param(map.options.docParams),
			);
		}
	}

	public connect(socket: SockInterface): void {
		// Focus/activity can call connect directly, bypassing reconnect scheduling.
		if (this._stopAfterLoadFailures()) return;
		// Every mousemove, touchmove, key and focus lands here while the view is
		// inactive. Replacing the handshake in flight on each one meant a slow
		// link never finished one; the attempt already running is the reconnect.
		if (this._handshakeInFlight()) return;
		const map = this._map;
		map.options.docParams['permission'] = app.getPermission();
		if (this.socket) {
			// A reconnect's handshake replaced while still connecting hung,
			// whatever replaces it. Counted only when the watchdog fired, the
			// patience never grew for a member who kept working: input replaced
			// the handshake first, from its patience on.
			if (this._reconnecting && this.socket.readyState === 0)
				this._hungHandshakes++;
			this.close();
		}
		if (socket && (socket.readyState === 1 || socket.readyState === 0)) {
			this.socket = socket;
		} else if (window.ThisIsAMobileApp) {
			// We have already opened the FakeWebSocket or MobileSocket over in global.js
			// With the FakeWebSocket do we then set this.socket at all?
			// With the MobileSocket we definitely do - this is load-bearing for opening password protected documents
		} else {
			try {
				this.socket = window.createWebSocket(this.getWebSocketBaseURI(map));
				window.socket = this.socket;
			} catch (e) {
				this._map.fire('error', {
					msg:
						_('Oops, there is a problem connecting to {productname}: ').replace(
							'{productname}',
							typeof brandProductName !== 'undefined'
								? brandProductName
								: 'Vulcan Office',
						) + e,
					cmd: 'socket',
					kind: 'failed',
					id: 3,
				});
				return;
			}
		}

		if (!this.socket) {
			console.error('connect: this.socket is still undefined!');
			return;
		}

		this.socket.onerror = this._onSocketError.bind(this);
		this.socket.onclose = this._onSocketClose.bind(this);
		this.socket.onopen = this._onSocketOpen.bind(this);
		this.socket.onmessage = this._slurpMessage.bind(this);
		this.socket.binaryType = 'arraybuffer';

		this._connectCount++;
		this._connectStartedAt = Date.now();
		this._handshakePatience = HANDSHAKE_PATIENCE_MS;
		if (this._reconnecting) this._armHandshakeWatchdog(this.socket);
		else if (!this._map._docLoadedOnce && this.ReconnectCount === 0)
			this._armInitialHandshakeWatchdog(this.socket);
		this._faultInjection();
		this.resetTokenExpiryTimer();

		// process messages for early socket connection
		this._emptyQueue();
	}

	public resetTokenExpiryTimer(): void {
		clearTimeout(this._accessTokenExpireTimeout); // Always clear the old timer.
		this._accessTokenExpireWarningCount = 0;
		const ttl = parseInt(
			this._map.options.docParams.access_token_ttl as string,
		);
		if (this._map.options.docParams.access_token && ttl) {
			const tokenExpiryWarning = 900 * 1000; // Warn when 15 minutes remain
			const delayMs = ttl - Date.now() - tokenExpiryWarning;
			if (delayMs > 0) {
				this._accessTokenExpireTimeout = setTimeout(
					this._sessionExpiredWarning.bind(this),
					delayMs,
				);
			} else {
				// Token is already inside the 15-minute warning window (or has
				// expired). Fire immediately; _sessionExpiredWarning picks the
				// right "expiring" vs "expired" message based on ttl - now().
				this._sessionExpiredWarning();
				// Retrigger every 2 minutes, as a reminder.
				this._accessTokenExpireTimeout = setTimeout(
					this.resetTokenExpiryTimer.bind(this),
					2 * 60 * 1000,
				);
			}
		}
	}

	public close(code?: number, reason?: string): void {
		if (!this.socket) {
			console.error('Tried close() on non-existent socket!');
			return;
		}
		this.socket.onerror = function () {};
		this.socket.onclose = function () {};
		this.socket.onmessage = function () {};
		this.socket.close();

		// Reset wopi's app loaded so that reconnecting again informs outerframe about initialization
		this._map['wopi'].resetAppLoaded();
		this._map.fire('docloaded', { status: false });
		clearTimeout(this._accessTokenExpireTimeout);
	}

	private _doSend(msg: MessageInterface): void {
		if (!this.socket) {
			console.error('_doSend() called when socket is non-existent!');
			return;
		}
		// Only attempt to log text frames, not binary ones.
		if (typeof msg === 'string') this._logSocket('OUTGOING', msg);

		this.socket.send(msg);
	}

	private _onSocketOpen(evt: Event): void {
		window.app.console.debug('_onSocketOpen:');
		app.idleHandler._serverRecycling = false;
		app.idleHandler._documentIdle = false;

		// Telemetry load milestone; also resolves a pending reconnect attempt
		// as successful.
		if (app.telemetry) app.telemetry.noteWebSocketConnected();

		// Always send the protocol version number.
		// TODO: Move the version number somewhere sensible.

		// Note there are two socket "onopen" handlers, this one which ends up as part of
		// bundle.js and the other in browser/js/global.js. The global.js one attempts to
		// set up the connection early while bundle.js is still loading. If bundle.js
		// starts before global.js has connected, then this _onSocketOpen will do the
		// connection instead, after taking over the socket in "connect"

		// Typically in a "make run" scenario it is the global.js case that sends the
		// 'coolclient' and 'load' messages while currently in the "WASM app" case it is
		// this code that gets invoked.

		// Also send information about our performance timer epoch
		const now0 = Date.now();
		const now1 = performance.now();
		const now2 = Date.now();
		this._doSend(
			'coolclient ' +
				this.ProtocolVersionNumber +
				' ' +
				(now0 + now2) / 2 +
				' ' +
				now1,
		);

		let msg = 'load url=' + encodeURIComponent(this._map.options.doc);
		if (this._map._docLayer) {
			this._reconnecting = true;
			// we are reconnecting after a lost connection
			msg += ' part=' + this._map.getCurrentPartNumber();
		}
		if (this._map.options.timestamp) {
			msg += ' timestamp=' + this._map.options.timestamp;
		}
		if (this._map._docPassword) {
			msg += ' password=' + this._map._docPassword;
		}
		if (String.locale) {
			msg += ' lang=' + String.locale;
		}
		if (window.deviceFormFactor) {
			msg += ' deviceFormFactor=' + window.deviceFormFactor;
		}

		msg += ' timezone=' + Intl.DateTimeFormat().resolvedOptions().timeZone;

		if (this._map.options.renderingOptions) {
			const options = {
				rendering: this._map.options.renderingOptions,
			};
			msg += ' options=' + JSON.stringify(options);
		}
		const spellOnline = window.prefs.get('spellOnline');
		if (spellOnline) {
			msg += ' spellOnline=' + spellOnline;
		}

		const darkTheme = window.prefs.getBoolean('darkTheme');
		msg += ' darkTheme=' + darkTheme;

		const darkBackground = window.prefs.getBoolean(
			'darkBackgroundForTheme.' + (darkTheme ? 'dark' : 'light'),
			darkTheme,
		);
		msg += ' darkBackground=' + darkBackground;
		this._map.uiManager.initDarkBackgroundUI(darkBackground);

		msg += ' vulcanPhoneChrome=' + (window.vulcanPhoneChrome === true);
		msg += ' accessibilityState=' + window.getAccessibilityState();

		msg += ' clientvisiblearea=' + window.makeClientVisibleArea();

		this._doSend(msg);
		for (let i = 0; i < this._msgQueue.length; i++) {
			this._doSend(this._msgQueue[i]);
		}
		this._msgQueue = [];

		const allowFocusGrab = this._reconnectMayGrabFocus();
		app.idleHandler._activate(allowFocusGrab);
	}

	private _onSocketClose(event: CloseEvent): void {
		window.app.console.debug(
			'_onSocketClose: code=' +
				event.code +
				' wasClean=' +
				event.wasClean +
				' reason=' +
				event.reason,
		);
		if (!this._map._docLoadedOnce && this.ReconnectCount === 0) {
			let errorType: string = '';
			let errorMsg: string;
			let errorDetail: string | undefined;
			const reason = event.reason;
			if (reason && reason.startsWith('error:')) {
				var command = this.parseServerCmd(reason);
				errorDetail = command.errorDetail;
				if (
					command.errorCmd === 'internal' &&
					command.errorKind === 'unauthorized'
				) {
					errorType = 'websocketunauthorized';
					errorMsg = this._buildUnauthorizedMessage(command);
				} else if (
					command.errorCmd === 'storage' &&
					command.errorKind === 'loadfailed'
				) {
					errorType = 'websocketloadfailed';
					errorMsg = window.errorMessages.storage.loadfailed;
				} else {
					errorType = 'websocketgenericfailure';
					errorMsg = window.errorMessages.websocketgenericfailure;
				}
			} else if (this._initialConnectRetries++ < 3) {
				// Transient connection failure with no server error.
				// Retry the initial connection before giving up.
				window.app.console.debug(
					'_onSocketClose: transient failure during initial load, attempt ' +
						this._initialConnectRetries,
				);
				this._map['wopi'].resetAppLoaded();
				setTimeout(() => {
					this._scheduleReconnect();
				}, 1);
				return;
			} else if (this._map.options.wopiSrc && !this._forceLegacyWsUrl) {
				// The compact /cool/ws URL never connected.
				//
				// Perhaps a reverse proxy that only tunnels the legacy
				// /cool/<doc>/ws URL drops the upgrade for the compact URL.
				// So fall back to the legacy URL, which such a proxy still tunnels.
				this._forceLegacyWsUrl = true;
				this._initialConnectRetries = 0;
				this._map['wopi'].resetAppLoaded();
				setTimeout(() => {
					this._scheduleReconnect();
				}, 1);
				return;
			} else {
				errorType = 'websocketproxyfailure';
				errorMsg = window.errorMessages.websocketproxyfailure;
			}
			// Telemetry: class only, never the message text.
			if (app.telemetry)
				app.telemetry.record('error_shown', { error_class: errorType });
			this._map.fire('error', {
				msg: errorMsg,
				cmd: 'socket',
				kind: 'closed',
				id: 4,
				errorDetail: errorDetail,
			});
			const postMessageObj = {
				errorType: errorType,
				success: false,
				errorMsg: errorMsg,
				result: '',
			};
			this._map.fire('postMessage', {
				msgId: 'Action_Load_Resp',
				args: postMessageObj,
			});
			return;
		}
		if (this.ReconnectCount > 0) return;

		const isActive = app.idleHandler._active;
		this._map.hideBusy();
		app.idleHandler._active = false;
		app.idleHandler._serverRecycling = false;

		if (this._map._docLayer) {
			// Remember the scroll offset before teardown changes the layout, so
			// a reconnect can put the view back where it was. Save it only on
			// the first close of a reconnect cycle. A second close can arrive
			// once teardown has already moved the view, and saving again then
			// would replace the real offset with that moved-away one. While a
			// reconnect is already in progress the offset from the first close
			// is the one to keep.
			if (app.activeDocument && !this._reconnecting)
				this._map._docLayer._savedScrollPos =
					app.activeDocument.activeLayout.viewedRectangle.clone();
			this._map._docLayer._restoringViewScroll = false;
			this._map._docLayer.removeAllViews();
			this._map._docLayer._resetClientVisArea();
			if (GraphicSelection.hasActiveSelection())
				GraphicSelection.rectangle = null;
			if (this._map._docLayer._docType === 'presentation')
				app.setCursorVisibility(false);

			this._map._docLayer._resetCanonicalIdStatus();
			this._map._docLayer._resetViewId();
			this._map._docLayer._resetDocumentInfo();
		}

		// We don't want them back on re-connection.
		this._delayedMessages = [];

		// A reconnect that opened (a kit took the load) and that the server
		// closed before its document loaded is a failed load, error frame or not,
		// or the retry timer would repeat it forever. A transport drop is not:
		// the browser reports 1006, with no close frame, when the Wi-Fi or a
		// proxy dropped the connection, and the server may be fine. Counting
		// those took a lossy link to the Retry card within seconds; they retry
		// on the backoff, which tops out at 30 s.
		if (isActive && this._reconnecting && !Socket._isTransportDrop(event)) {
			this._consecutiveLoadFailures++;
			this._loadFailureClosedAttempt = this._connectCount;
			// This dialog says it through the wait (see _showReconnecting).
			this._hideReconnecting();
			// Don't show this before first transparently trying to reconnect.
			// Its AlertDialog closes every open dialog, so a transport drop,
			// which keeps retrying by itself, does not show it.
			this._map.fire('error', {
				msg: _(
					'Well, this is embarrassing, we cannot connect to your document. Please try again.',
				),
				cmd: 'socket',
				kind: 'closed',
				id: 4,
			});
		}

		// Reset wopi's app loaded so that reconnecting again informs outerframe about initialization
		this._map['wopi'].resetAppLoaded();
		this._map.fire('docloaded', { status: false });

		// We need to make sure that the message slurping processes the
		// events first, because there could have been a message like
		// "close: idle" from the server.
		// Without the timeout, we'd immediately reconnect (because the
		// "close: idle" was not processed yet).
		setTimeout(() => this._reconnectAfterClose(), 1 /* ms */);

		if (this._map.isEditMode()) {
			this._map.setPermission('view');
		}
	}

	// Simulate error conditions for testing via the
	// simulateError URL parameter.
	private _faultInjection(): void {
		if (
			this._connectCount === 1 &&
			this.socket &&
			window.simulateError('socket:initialClose')
		) {
			const sock = this.socket;
			if (sock.readyState === 1) {
				// global.js may have already connected the socket
				// before bundle.js loaded - close after current
				// event processing
				setTimeout(function () {
					sock.close();
				}, 0);
			} else {
				const realOnOpen = sock.onopen;
				sock.onopen = function (evt: Event) {
					realOnOpen(evt);
					setTimeout(function () {
						sock.close();
					}, 0);
				};
			}
		}
	}

	/**
	 * The reconnect decision after a socket close, named so it is reachable from a
	 * test. Inline inside the setTimeout it could only be exercised by standing up
	 * the whole of _onSocketClose, which is exactly why this path went uncapped.
	 */
	private _reconnectAfterClose(): void {
		if (this._stopAfterLoadFailures()) return;
		if (!this._reconnecting) {
			this._reconnecting = true;
			// No user gesture drives this one either, so it leaves the caret alone.
			this._scheduleReconnect(false);
			return;
		}
		// The reconnect itself failed. Nothing used to retry it: the view sat
		// view-only until the user touched it.
		clearTimeout(this._reconnectRetryTimer);
		// Say so for the whole wait: a drop (1006) shows no error dialog, so the
		// view looked loaded while it was view-only and dropped what the user
		// typed.
		this._showReconnecting();
		const ceiling = Math.min(
			RECONNECT_RETRY_MAX_MS,
			RECONNECT_RETRY_BASE_MS * Math.pow(2, this._reconnectRetries++),
		);
		// Jittered, so a fleet that dropped together does not retry together.
		this._reconnectRetryTimer = setTimeout(
			() => this._retryReconnect(),
			ceiling / 2 + (Math.random() * ceiling) / 2,
		);
	}

	/**
	 * Retry a reconnect whose last attempt failed: the backoff timer, 'online'
	 * and the tab coming into view all land here. It acts only while a reconnect
	 * is outstanding and nothing is connected or handshaking. An idle-closed
	 * document, a recycling server and a fatal error keep their own handling, a
	 * hidden tab waits until it is seen, and _scheduleReconnect still applies
	 * the load-failure cap.
	 */
	private _retryReconnect(): void {
		if (!this._reconnecting || this._map._fatal) return;
		if (app.idleHandler._documentIdle || app.idleHandler._serverRecycling)
			return;
		// _serverRecycling is gone once the recycled socket closes; the
		// recycle's own 5-10 s interval is still the one reconnecting.
		if (this._recycleIntervalLive()) return;
		if (document.visibilityState === 'hidden') return;
		if (this.connected() || this._handshakeInFlight()) return;
		clearTimeout(this._reconnectRetryTimer);
		// No user gesture here, so this reactivation leaves the caret alone. A
		// retry that connects still makes the upstream grab once, from
		// _onSocketOpen.
		this._scheduleReconnect(false);
	}

	private _handshakeInFlight(): boolean {
		return (
			!!this.socket &&
			this.socket.readyState === 0 &&
			Date.now() - this._connectStartedAt < this._handshakePatience
		);
	}

	/**
	 * A reconnect handshake that hangs (a frozen task never answers the
	 * upgrade) is replaced once it is past its patience. Nothing else would:
	 * the backoff arms only from a close, and a passive viewer gives no input.
	 * The patience starts at HANDSHAKE_PATIENCE_MS and doubles with each
	 * handshake found hung, up to RECONNECT_RETRY_MAX_MS, and each wait adds up
	 * to half of it again as jitter (30-45 s at the cap). The patience is the
	 * handshake's own: input, focus, 'online' and the tab coming into view
	 * leave it alone for as long (_handshakeInFlight), so a slow link's
	 * handshake gets long enough to finish for a member who keeps working, not
	 * only for one who is watching. Only a handshake still connecting is
	 * replaced: one that answered, or that the client closed for a frame the
	 * server ended it with, is left to that frame's own handling.
	 */
	private _armHandshakeWatchdog(handshake: SockInterface): void {
		clearTimeout(this._reconnectRetryTimer);
		const patience = Math.min(
			RECONNECT_RETRY_MAX_MS,
			HANDSHAKE_PATIENCE_MS * Math.pow(2, this._hungHandshakes),
		);
		// What _handshakeInFlight reads, for input, focus, 'online' and
		// visibility as for this watchdog.
		this._handshakePatience = patience;
		// The 100 ms margin makes _handshakeInFlight see it as hung.
		this._reconnectRetryTimer = setTimeout(
			() => {
				if (handshake.readyState !== 0) return;
				this._retryReconnect();
			},
			patience + 100 + (Math.random() * patience) / 2,
		);
	}

	/**
	 * The first load's handshake gets the same patience as a reconnect's. A
	 * network that holds the upgrade without answering it (a filtering proxy:
	 * one customer's state network held about one in three on 2026-10-16)
	 * never closes the socket, so _onSocketClose's initial-load retries and its
	 * legacy-URL fallback never ran, and the document sat loading until the
	 * host gave up at 105 s. Past its patience the handshake is closed and
	 * handed to _onSocketClose as the transport drop it is, which spends one of
	 * those retries. The patience grows as a reconnect's does, so a slow link
	 * still finishes one.
	 */
	private _armInitialHandshakeWatchdog(handshake: SockInterface): void {
		clearTimeout(this._initialHandshakeTimer);
		const patience = Math.min(
			RECONNECT_RETRY_MAX_MS,
			HANDSHAKE_PATIENCE_MS * Math.pow(2, this._hungHandshakes),
		);
		this._handshakePatience = patience;
		this._initialHandshakeTimer = setTimeout(() => {
			if (handshake !== this.socket || handshake.readyState !== 0) return;
			if (this._map._docLoadedOnce || this.ReconnectCount > 0) return;
			this._hungHandshakes++;
			this.close();
			this._onSocketClose({
				code: 1006,
				wasClean: false,
				reason: '',
			} as CloseEvent);
		}, patience + 100);
	}

	/**
	 * A close the browser made up because the connection died (1006: no close
	 * frame arrived), as opposed to one the server sent. wsd closes a session
	 * it failed or refused with a close frame (1001, 1008), so its failures
	 * are never this, even when the TCP teardown after that frame then fails
	 * and the browser reports wasClean false with the server's code.
	 */
	private static _isTransportDrop(event: CloseEvent): boolean {
		return event.code === 1006;
	}

	// Still the live this.timer: replaced (docunloading, a reload-after-close)
	// or cleared (connected, `progress: ready`, manualReconnect) means it stood
	// down.
	private _recycleIntervalLive(): boolean {
		return (
			this._recycleTimer !== undefined && this._recycleTimer === this.timer
		);
	}

	// A fatal load-error frame spends the budget, unless its own attempt's
	// server close already did: wsd sends the frame and closes at once, and the
	// native close can run before the slurped frame drains, even after input
	// has started the next attempt. `frameAttempt` is the attempt the frame
	// came from (a slurped frame's vulcanAttempt), passed down from _onMessage
	// rather than kept on the socket: the handler's own hideBusy() re-enters
	// _onMessage (UIManager's busy-popup fadeout) before this runs.
	private _countLoadErrorFrame(frameAttempt: number | undefined): void {
		const attempt =
			frameAttempt !== undefined ? frameAttempt : this._connectCount;
		// `> 0` also reads a receiver built without field initializers (the
		// mocha rigs' Object.create) as no close having counted.
		if (
			this._loadFailureClosedAttempt > 0 &&
			attempt === this._loadFailureClosedAttempt
		)
			return;
		this._consecutiveLoadFailures++;
	}

	private _stopAfterLoadFailures(): boolean {
		if (this._consecutiveLoadFailures >= MAX_CONSECUTIVE_LOAD_FAILURES) {
			this._giveUpAfterLoadFailures();
			return true;
		}
		return false;
	}

	private _giveUpAfterLoadFailures(): void {
		// The error path and already-queued close callbacks can both reach this.
		if (this._loadFailureGiveUpNotified) return;
		this._loadFailureGiveUpNotified = true;
		if (app.telemetry) {
			app.telemetry.noteReconnectGiveUp();
			app.telemetry.record('error_shown', {
				error_class: 'loadfailuregiveup',
			});
		}
		// Same channel the storage-failure path uses, so the host's existing
		// App_LoadingStatus handler paints the Cancel/Retry card without new plumbing.
		this._map.fire('postMessage', {
			msgId: 'App_LoadingStatus',
			args: {
				Status: 'Failed',
				Reason: 'loadfailuregiveup',
			},
		});
	}

	/**
	 * Whether a reactivation no gesture in this frame drove (the socket's
	 * opening, an unloading document's retry) may make the desktop Calc grab
	 * (IdleHandler._activate). Not for a reload the server ordered while the
	 * frame did not hold the keyboard (_onCloseMsg), until its document is back.
	 * Not for any reconnect while the frame does not hold the keyboard now: the
	 * person types in the host page (the agent composer), and after a
	 * dropped connection the grab took that caret mid-word.
	 */
	private _reconnectMayGrabFocus(): boolean {
		if (this._reloadLeavesCaret) return false;
		return !this._reconnecting || document.hasFocus();
	}

	private _scheduleReconnect(allowFocusGrab: boolean = true): void {
		// Initial-load close callbacks do not pass through _reconnectAfterClose.
		if (this._stopAfterLoadFailures()) return;
		app.idleHandler._active = false;
		if (app.telemetry) app.telemetry.noteReconnectScheduled();
		app.idleHandler._activate(allowFocusGrab);
		// After the attempt _activate starts: a wait the server ended is
		// over once there is a next attempt (see _showReconnecting).
		this._showReconnecting();
	}

	/**
	 * "Reconnecting..." for a loaded document, from its first close until the
	 * reconnect's document is back, or an error frame or the server's close
	 * says why not (_hideReconnecting). A snackbar with no timeout: it has no
	 * overlay and never takes focus, on a phone too, where the router sends
	 * snackbars to the desktop dialog layer, not the wizard. The busy popup was
	 * a dimmed modal over the document (a wizard sheet on a phone) that blocked
	 * the input that retries, and its fadeouts focused the frame. Each close,
	 * wait and retry, and the reload's progress, asks again, which does nothing
	 * while it is up. Before a document has loaded it is the loading bar, as
	 * before.
	 */
	private _showReconnecting(): void {
		if (app.idleHandler._documentIdle) return;
		if (!this._map._docLayer) {
			this._map.showBusy(_('Reconnecting...'), false);
			return;
		}
		// A fatal error says what happened; nothing is reconnecting.
		if (this._map._fatal) return;
		// The server closed this attempt: the "cannot connect" dialog says so
		// through its wait. The next attempt asks again.
		if (
			this._loadFailureClosedAttempt > 0 &&
			this._loadFailureClosedAttempt === this._connectCount
		)
			return;
		if (!app.sectionContainer || app.sectionContainer.testing) return;
		// On a phone the "cannot connect" dialog is a wizard sheet at the bottom
		// of the frame, where the card goes: the card came back over it at the
		// next attempt, covered its Close button and swallowed the tap. The
		// dialog says it while it is open; once the member closes it, the next
		// close, wait or retry asks again.
		const wizard = this._map.uiManager.mobileWizard;
		if (
			wizard &&
			wizard._getContentForWindowId(
				this._map.uiManager.generateModalId('cool_alert'),
			)
		)
			return;
		this._map.uiManager.showStickySnackbar(
			'reconnecting',
			_('Reconnecting...'),
		);
	}

	private _hideReconnecting(): void {
		if (this._map.uiManager)
			this._map.uiManager.dismissSnackbar('reconnecting');
	}

	private _onSocketError(evt: Event): void {
		window.app.console.warn('_onSocketError:', evt);
		this._map.hideBusy();
		// Let onclose (_onSocketClose) report errors.
	}

	// The problem: if we process one websocket message at a time, the
	// browser -loves- to trigger a re-render as we hit the main-loop,
	// this takes ~200ms on a large screen, and worse we get
	// producer/consumer issues that can fill a multi-second long
	// buffer of web-socket messages in the client that we can't
	// process so - slurp and then emit at idle - its faster to delay!
	private _slurpMessage(evt: MessageEvent): void {
		const e = evt as SlurpMessageEvent;
		this._extractTextImg(e);

		// Some messages - we want to process & filter early.
		const docLayer = this._map ? this._map._docLayer : undefined;
		if (docLayer && docLayer.filterSlurpedMessage(e)) return;

		const predictedTiles = RenderManager.predictTilesToSlurp();
		// scale delay, to a max of 50ms, according to the number of
		// tiles predicted to arrive.
		const delayMS = Math.max(Math.min(predictedTiles, 50), 1);

		if (!this._slurpQueue) this._slurpQueue = [];
		// Only the current socket's onmessage is live (close() detaches the old
		// one's), so this frame belongs to the latest attempt.
		e.vulcanAttempt = this._connectCount;
		this._slurpQueue.push(e);
		this._queueSlurpEventEmission(delayMS);
	}

	private _emptyQueue(): void {
		if (window.queueMsg && window.queueMsg.length > 0) {
			for (let it = 0; it < window.queueMsg.length; it++) {
				const msg: MessageInterface = window.queueMsg[it];
				const evt: any = { data: msg, textMsg: msg };
				this._slurpMessage(evt);
			}
			window.queueMsg = [];
		}
	}

	private _sessionExpiredWarning(): void {
		clearTimeout(this._accessTokenExpireTimeout);
		const remainingMs =
			parseInt(this._map.options.docParams.access_token_ttl as string) -
			Date.now();
		// Let the host renew the token without a session-expiry popup, including
		// when the token has already expired.
		this._map.fire('postMessage', {
			msgId: 'App_TokenExpiring',
			args: {
				Timeout: Math.max(remainingMs, 0),
			},
		});

		// Repeat the host notification while renewal is outstanding.
		// Cap at 10 retries (~20 minutes, i.e. ~5 minutes after the access_token
		// expires) so we don't spam the host indefinitely.
		this._accessTokenExpireWarningCount++;
		if (this._accessTokenExpireWarningCount < 10) {
			this._accessTokenExpireTimeout = setTimeout(
				this._sessionExpiredWarning.bind(this),
				120 * 1000,
			);
		}
	}

	public setUnloading(): void {
		if (this.socket && this.socket.setUnloading) this.socket.setUnloading();
	}

	public connected(): boolean {
		return this.socket !== undefined && this.socket.readyState === 1;
	}

	private _logSocket(type: Direction, msg: string): void {
		const logMessage =
			this._map._debug.debugNeverStarted ||
			this._map._debug.logIncomingMessages;
		if (!logMessage) return;

		if (window.ThisIsTheQtApp) window.postMobileDebug(type + ' ' + msg);

		const debugOn = this._map._debug.debugOn;

		if (this._map._debug.overlayOn) {
			this._map._debug.setOverlayMessage('postMessage', type + ': ' + msg);
		}

		if (!debugOn && !window.L.Browser.cypressTest && msg.length > 256)
			// for reasonable performance.
			msg =
				msg.substring(0, 256) + '<truncated ' + (msg.length - 256) + 'chars>';

		let status = '';
		if (!window.fullyLoadedAndReady) status += '[!fullyLoadedAndReady]';
		if (!window.bundlejsLoaded) status += '[!bundlejsLoaded]';

		app.Log.log(msg, type, status);

		if (!window.protocolDebug && !debugOn) return;

		const color = type === 'OUTGOING' ? 'color:red' : 'color:#2e67cf';
		window.app.console.log(
			+new Date() +
				' %c' +
				type +
				status +
				'%c: ' +
				msg.concat(' ').replace(' ', '%c '),
			'background:#ddf;color:black',
			color,
			'color:',
		);
	}

	private _getParameterByName(url: string, name: string): string {
		// Escape all regex characters.
		const escape = (str: string): string => {
			return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		};
		const regex = new RegExp('[\\?&]' + escape(name) + '=([^&#]*)');
		const results = regex.exec(url);
		return results === null ? '' : results[1].replace(/\+/g, ' ');
	}

	private _utf8ToString(data: Uint8Array): string {
		let strBytes = '';
		for (let it = 0; it < data.length; it++) {
			strBytes += String.fromCharCode(data[it]);
		}
		return strBytes;
	}

	// Returns true if, and only if, we are ready to start loading
	// the tiles and rendering the document.
	private _isReady(): boolean {
		if (window.bundlejsLoaded == false || window.fullyLoadedAndReady == false) {
			return false;
		}

		if (
			typeof this._map == 'undefined' ||
			isNaN(this._map.options.tileWidthTwips) ||
			isNaN(this._map.options.tileHeightTwips)
		) {
			return false;
		}

		const center = this._map.getCenter();
		if (isNaN(center.x) || isNaN(center.y) || isNaN(this._map.getZoom())) {
			return false;
		}

		return true;
	}

	private _queueSlurpEventEmission(delayMS: number): void {
		let now = Date.now();
		if (this._slurpTimer && this._slurpTimerDelay != delayMS) {
			// The timer already exists, but now want to change timeout _slurpTimerDelay to delayMS.
			// Cancel it and reschedule by replacement with another timer using the desired delayMS
			// adjusted as if used at the original launch time.
			clearTimeout(this._slurpTimer);
			this._slurpTimer = undefined;
			this._slurpTimerDelay = delayMS;

			now = Date.now();
			if (this._slurpTimerLaunchTime === undefined) {
				console.assert(
					false,
					'_slurpTimerLaunchTime is undefined when _slurpTimer exists!',
				);
				return;
			}
			const sinceLaunchMS = now - this._slurpTimerLaunchTime;
			delayMS -= sinceLaunchMS;
			if (delayMS <= 0) delayMS = 1;
		}

		if (!this._slurpTimer) {
			if (!this._slurpTimerLaunchTime) {
				// The initial launch of the timer, rescheduling replacements retain
				// the launch time
				this._slurpTimerLaunchTime = now;
				this._slurpTimerDelay = delayMS;
			}
			this._slurpTimer = setTimeout(
				function (this: Socket) {
					this._slurpTimer = undefined;
					this._slurpTimerLaunchTime = undefined;
					this._slurpTimerDelay = undefined;
					if (this._inLayerTransaction) {
						this._slurpDuringTransaction = true;
						return;
					}
					this._emitSlurpedEvents();
				}.bind(this),
				delayMS,
			);
		}
	}

	private _emitSlurpedEvents(): void {
		if (this._map._debug.eventDelayWatchdog) this._map._debug.timeEventDelay();

		const queueLength = this._slurpQueue.length;
		const completeEventWholeFunction = this.createCompleteTraceEvent(
			'emitSlurped-' + String(queueLength),
			{ '_slurpQueue.length': String(queueLength) },
		);
		if (this._map && this._map._docLayer) {
			RenderManager.beginTransaction();
			this._inLayerTransaction = true;

			// Queue an instant timeout early to try to measure the
			// re-rendering delay before we get back to the main-loop.
			if (this.traceEventRecordingToggle) {
				if (!this._renderEventTimer)
					this._renderEventTimer = setTimeout(function (this: Socket) {
						if (this._renderEventTimerStart === undefined) {
							console.assert(
								false,
								'_renderEventTimerStart is undefined when renderEvent is run!',
							);
							return;
						}
						const now = performance.now();
						const delta = now - this._renderEventTimerStart;
						if (delta >= 2 /* ms */) {
							// significant
							this.sendTraceEvent(
								name,
								'X',
								'ts=' +
									Math.round(this._renderEventTimerStart * 1000) +
									' dur=' +
									Math.round((now - this._renderEventTimerStart) * 1000),
							);
							this._renderEventTimerStart = undefined;
						}
						this._renderEventTimer = undefined;
					}, 0);
			}
		}
		// window.app.console.log('Slurp events ' + that._slurpQueue.length);
		let complete = true;
		try {
			for (let i = 0; i < queueLength; ++i) {
				const evt = this._slurpQueue[i];

				if (evt.isComplete()) {
					let textMsg;
					if (typeof evt.data === 'string') {
						textMsg = evt.data.replace(/\s+/g, '.');
					} else if (typeof evt.data === 'object') {
						textMsg = evt.textMsg.replace(/\s+/g, '.');
					}

					const completeEventOneMessage =
						this.createCompleteTraceEventFromEvent(textMsg);
					try {
						// it is - are you ?
						this._onMessage(evt);
					} catch (e: any) {
						// unpleasant - but stops this one problem event
						// stopping an unknown number of others.
						const msg =
							'Exception ' + e + ' emitting event ' + evt.data + '\n' + e.stack;
						window.app.console.error(msg);

						// When debugging let QA know something is up.
						if (window.enableDebug || window.L.Browser.cypressTest)
							this._map.uiManager.showInfoModal(
								'cool_alert',
								'',
								msg,
								'',
								_('Close'),
								function () {
									/* Do nothing. */
								},
								false,
							);

						// If we're cypress testing, fail the run. Cypress will fail anyway, but this way we may get
						// a nice error in the logs rather than guessing that the run failed from our popup blocking input...
						if (
							window.L.Browser.cypressTest &&
							window.parent !== window &&
							e !== null
						) {
							console.log('Sending event error to Cypress...', e);
							window.parent.postMessage(e);
						}
					} finally {
						if (completeEventOneMessage) completeEventOneMessage.finish();
					}
				} else {
					// Stop emitting, re-start when we async images load.
					this._slurpQueue = this._slurpQueue.slice(i, queueLength);
					complete = false;
					break;
				}
			}
		} finally {
			if (completeEventWholeFunction) completeEventWholeFunction.finish();
		}

		if (complete)
			// Finished all elements in the queue.
			this._slurpQueue = [];

		if (this._map) {
			const completeCallback = () => {
				// Let other layers / overlays catch up.
				this._map.fire('messagesdone');

				this._renderEventTimerStart = performance.now();

				this._inLayerTransaction = false;
				if (this._slurpDuringTransaction) {
					this._slurpDuringTransaction = false;
					this._queueSlurpEventEmission(1);
				}
			};

			if (this._inLayerTransaction && this._map._docLayer) {
				// Resume with redraw if dirty due to previous _onMessage() calls.
				RenderManager.endTransaction(completeCallback);
			} else {
				completeCallback();
			}
		}
	}

	private _exportAsCallback(command: ServerCommand): void {
		this._map.hideBusy();
		Util.ensureValue(command.filename);
		this._map.uiManager.showInfoModal(
			'exported-success',
			_('Exported to storage'),
			_('Successfully exported: ') + decodeURIComponent(command.filename),
			'',
			_('OK'),
		);
	}

	private _onStatusMsg(textMsg: string, command: ServerCommand): void {
		if (!this._isReady()) {
			// Retry in a bit.
			setTimeout(() => {
				this._onStatusMsg(textMsg, command);
			}, 10);
			return;
		}

		// Vulcan Office: a reconnect's status still in the slurp queue when its
		// socket dropped is from an attempt that is gone. Taken as the document
		// being back, it took "Reconnecting..." down, cleared the backoff the
		// drop had armed and ended the reconnect on a dead socket, so nothing
		// retried until the member gave input. The drop's own retry stands.
		if (this._reconnecting && this._map._docLayer && !this.connected()) return;

		if (!this._map._docLayer) {
			Util.ensureValue(command.type);
			// initialize and append text input before doc layer
			this._map.initTextInput(command.type);

			// Reinitialize the menubar and top toolbar if browser settings are enabled.
			// During the initial `initializeBasicUI` call, we don't know if compact mode is enabled.
			// Before `doclayerinit`, we recheck the compact mode setting and if conditions are met,
			// add the top toolbar and menubar controls to the map.
			if (window.prefs.useBrowserSetting) {
				if (
					!window.mode.isSmallScreenDevice() &&
					this._map.uiManager.getCurrentMode() === 'notebookbar'
				)
					this._map.uiManager.removeClassicUI();
				else if (!this._map.menubar)
					this._map.uiManager.initializeMenubarAndTopToolbar();
			}

			// first status message, we need to create the document layer
			//
			// THE TILE GEOMETRY MUST DIVIDE BY THE SCALE THE CANVAS WILL
			// RENDER AT. docstate.ts seeds app.dpiScale with the RAW
			// devicePixelRatio at bundle eval; the phone tile-dpi clamp
			// (VulcanTilePerf.TILE_DPI_CAP — dpr 3 -> 2) is stamped by the
			// CanvasSectionContainer CONSTRUCTOR, which runs inside
			// map.addLayer(docLayer) BELOW — i.e. AFTER the division a few
			// lines down. On a dpr-3 phone the docLayer's tileWidthTwips was
			// therefore divided by 3 while every tile is rasterised and
			// displayed at 2: each tile covered two-thirds the twips it
			// claimed, and the whole document rendered rawDpr/TILE_DPI_CAP =
			// 1.5x wider than every analytic twips<->css conversion computes.
			// MEASURED on build #2 (evidence rows WR-1/WR-2): a granted
			// 4700-twip Writer reflow that VulcanWriterReflow's arithmetic
			// read as 376 CSS px ("fits") painted ~564 CSS px on a 392 px
			// viewport — 44% of horizontal overflow, headings cut mid-word —
			// and the phone fit-zoom landed two rungs lower than the same
			// document fits on an unclamped context. Apply the same clamp
			// rule here, before the division; the constructor's later stamp
			// is then idempotent. Desktop and tablet: clampTileDpi returns
			// the raw value and this is a no-op.
			app.dpiScale = VulcanTilePerf.clampTileDpi(
				window.devicePixelRatio,
				VulcanTilePerf.isVulcanPhoneChrome(),
			);
			app.roundedDpiScale = Math.round(app.dpiScale);
			let tileWidthTwips = this._map.options.tileWidthTwips;
			let tileHeightTwips = this._map.options.tileHeightTwips;
			if (this._map.options.zoom !== this._map.options.defaultZoom) {
				const scale = InternPointUtil.scale(
					this._map.options.defaultZoom - this._map.options.zoom,
				);
				tileWidthTwips = Math.round(tileWidthTwips * scale);
				tileHeightTwips = Math.round(tileHeightTwips * scale);
			}

			let docLayer: DocLayerInterface | null = null;
			const options = {
				tileWidthTwips: tileWidthTwips / app.dpiScale,
				tileHeightTwips: tileHeightTwips / app.dpiScale,
				docType: command.type,
				viewId: command.viewid,
			};
			if (command.type === 'text')
				docLayer = new window.L.WriterTileLayer(options);
			else if (command.type === 'spreadsheet')
				docLayer = new window.L.CalcTileLayer(options);
			else if (command.type === 'presentation' || command.type === 'drawing')
				docLayer = new window.L.ImpressTileLayer(options);

			Util.ensureValue(docLayer);
			this._map._docLayer = docLayer;
			this._map.addLayer(docLayer);
			this._map.fire('doclayerinit');
		} else if (this._reconnecting) {
			// we are reconnecting ...
			this._map._docLayer._resetClientVisArea();
			RenderManager.refreshTilesInBackground();
			this._map.fire('statusindicator', { statusType: 'reconnected' });

			const darkTheme = window.prefs.getBoolean('darkTheme');
			this._map.uiManager.activateDarkModeInCore(darkTheme);
			this._map.uiManager.applyInvert();
			this._map.uiManager.setCanvasColorAfterModeChange();

			if (!window.mode.isSmallScreenDevice())
				this._map.uiManager.initializeNotebookbarInCore();

			// The document is back.
			this._hideReconnecting();
			// close all the popups otherwise document textArea will not get focus
			// The snackbar is not one: the "Reconnecting..." just taken down
			// would be closed again, with focus moved back to what had it when
			// it opened.
			// Vulcan Office: no gesture in this frame drives this
			// close either. While the frame does not hold the keyboard (the
			// person types in the host page, in the agent composer), the close
			// leaves focus where it is: it gave focus back to what had it when
			// each dialog opened (JSDialog.focusToLastElement), and the rest of
			// the word typed there landed in the document, as at the reload's
			// close (_onCloseMsg).
			this._map.uiManager.closeAll(
				/* leaveSnackbar */ true,
				/* focusHandled */ !document.hasFocus(),
			);
			this._map.setPermission(app.file.permission);
			window.migrating = false;
			this._map.uiManager.initializeSidebar();
			this._map.uiManager.refreshTheme();
		}

		// The one place the counter may be cleared: a document actually loaded. Clearing it
		// anywhere earlier (as `progress: ready` does for ReconnectCount) is what made the
		// existing cap unreachable.
		this._consecutiveLoadFailures = 0;
		this._loadFailureGiveUpNotified = false;
		this._reconnectRetries = 0;
		this._hungHandshakes = 0;
		this._reloadLeavesCaret = false;
		clearTimeout(this._reconnectRetryTimer);
		this._map.fire('docloaded', { status: true });
		if (this._map._docLayer) {
			this._map._docLayer._onMessage(textMsg);

			// call update view list viewId if it is not defined yet
			if (!this._map._docLayer._getViewId()) this._map.fire('updateviewslist');

			this._reconnecting = false;

			// Applying delayed messages
			// note: delayed messages cannot be done before:
			// a) docLayer.map is set by map.addLayer(docLayer)
			// b) docLayer._onStatusMsg (via _docLayer._onMessage)
			// has set the viewid
			this._handleDelayedMessages(this._map._docLayer);
		}

		this._maybeOfferExternalLinks(command);
	}

	// Let the user agree to load this document's disabled external links.
	// Editors only; the choice lasts the session.
	private _maybeOfferExternalLinks(command: ServerCommand): void {
		if (!command.externallinksdisabled || this._map.isReadOnlyMode()) return;

		this._map.uiManager.showSnackbar(
			_('This document has links to external content.'),
			_('Allow'),
			() => {
				this.sendMessage('allowlinkupdate');
			},
			-1 /* no timeout */,
			false /* no progress */,
			true /* dismissable - dismiss keeps links blocked */,
		);
	}

	private _onJSDialog(
		textMsg: string,
		callback?: JSDialogCallback | DefCallBack,
	): void {
		const msgData = JSON.parse(textMsg.substring('jsdialog:'.length + 1));

		if (msgData.children && !app.util.isArray(msgData.children)) {
			window.app.console.warn(
				"_onJSDialogMsg: The children's data should be created of array type",
			);
			return;
		}

		JSDialog.MessageRouter.processMessage(msgData, callback);
	}

	private _onHyperlinkClickedMsg(textMsg: string): void {
		let link: string | null = null;
		let coords: string | null = null;
		const hyperlinkMsgStart = 'hyperlinkclicked: ';
		const coordinatesMsgStart = ' coordinates: ';

		if (textMsg.indexOf(coordinatesMsgStart) !== -1) {
			const coordpos = textMsg.indexOf(coordinatesMsgStart);
			link = textMsg.substring(hyperlinkMsgStart.length, coordpos);
			coords = textMsg.substring(coordpos + coordinatesMsgStart.length);
		} else link = textMsg.substring(hyperlinkMsgStart.length);

		this._map.fire('hyperlinkclicked', { url: link, coordinates: coords });
	}

	private _delayMessage(textMsg: string): void {
		const message = { msg: textMsg };
		this._delayedMessages.push(message);
	}

	private _handleDelayedMessages(docLayer: DocLayerInterface): void {
		this._handlingDelayedMessages = true;

		while (this._delayedMessages.length) {
			const message = this._delayedMessages.shift();
			Util.ensureValue(message);
			try {
				// Delayed messages predate the docLayer, so the slurp-time
				// filter never saw them; offer it first for the same reason
				// as the tail of _onMessage (a late invalidatetiles: would
				// otherwise die in the docLayer's "should be filterd during
				// slurp" branch, its payload dropped).
				const evt = {
					textMsg: message.msg,
				} as unknown as SlurpMessageEvent;
				if (!docLayer.filterSlurpedMessage(evt))
					docLayer._onMessage(message.msg);
			} catch (e) {
				// unpleasant - but stops this one problem
				// event stopping an unknown number of others.
				window.app.console.error(
					'Exception ' + e + ' emitting event ' + message,
					(e as Error).stack,
				);
			}
		}

		this._handlingDelayedMessages = false;
	}

	public _onMessage(e: SlurpMessageEvent | MinimalMessageEvent): void {
		let textMsg = e.textMsg;
		const imgBytes: Uint8Array | undefined = (e as SlurpMessageEvent).imgBytes;

		if (window.L.Browser.cypressTest) {
			window.L.initial._stubMessage(textMsg);
		}

		this._logSocket('INCOMING', textMsg);

		const command = this.parseServerCmd(textMsg);

		if (textMsg.startsWith('coolserver ')) {
			if (this._onCoolServerMsg(textMsg)) {
				return;
			}
		} else if (textMsg.startsWith('lokitversion ')) {
			this._onLokitVersionMsg(textMsg);
		} else if (textMsg.startsWith('enabletraceeventlogging ')) {
			this.enableTraceEventLogging = true;
		} else if (textMsg.startsWith('osinfo ')) {
			this._onOsInfoMsg(textMsg);
		} else if (textMsg.startsWith('clipboardkey: ')) {
			this._onClipboardKeyMsg(textMsg);
		} else if (textMsg.startsWith('executescriptresult: ')) {
			try {
				const result = JSON.parse(
					textMsg.substring('executescriptresult: '.length),
				);
				this._map.fire('executescriptresult', result);
			} catch (e) {
				app.console.error('Failed to parse executescriptresult: ' + e);
			}
			return;
		} else if (textMsg.startsWith('proxycall: ')) {
			try {
				const call = JSON.parse(textMsg.substring('proxycall: '.length));
				this._map.fire('proxycall', call);
			} catch (ex) {
				app.console.error('Failed to parse proxycall: ' + ex);
			}
			return;
		} else if (textMsg.startsWith('legacyunoapinotice:')) {
			this._map.fire('legacyunoapinotice');
			return;
		} else if (textMsg.startsWith('perm:')) {
			this._onPermMsg(textMsg);
			return;
		} else if (textMsg.startsWith('filemode:')) {
			this._onFileModeMsg(textMsg);
		} else if (textMsg.startsWith('lockfailed:')) {
			this._map.onLockFailed(textMsg.substring('lockfailed:'.length).trim());
			return;
		} else if (textMsg.startsWith('wopi: ')) {
			this._onWopiMsg(textMsg);
			return;
		} else if (textMsg.startsWith('loadstorage: ')) {
			this._onLoadStorageMsg(textMsg);
		} else if (textMsg.startsWith('lastmodtime: ')) {
			this._onLastModTimeMsg(textMsg);
			return;
		} else if (textMsg.startsWith('commandresult: ')) {
			this._onCommandResultMsg(textMsg);
			return;
		} else if (textMsg.startsWith('migrate:') && window.indirectSocket) {
			this._onMigrateMsg(textMsg);
			return;
		} else if (textMsg.startsWith('tokenexpired')) {
			// Server got a 401 on save. Ask the host for a fresh token.
			this._map.fire('postMessage', {
				msgId: 'App_TokenExpired',
				args: {},
			});
			return;
		} else if (textMsg.startsWith('close: ')) {
			this._onCloseMsg(textMsg);
			return;
		} else if (textMsg.startsWith('error:')) {
			const frameAttempt = (e as SlurpMessageEvent).vulcanAttempt;
			if (this._onErrorMsg(textMsg, command, frameAttempt)) return;
		} else if (textMsg.startsWith('fontsmissing:')) {
			this._onFontsMissing(textMsg, command);
		} else if (textMsg.startsWith('info:') && command.errorCmd === 'socket') {
			this._onInfoMsg(textMsg, command);
		} else if (textMsg.startsWith('pong ') && this._map._debug.pingOn) {
			this._map._debug.reportPong(
				command.rendercount ? command.rendercount : 0,
			);
		} else if (textMsg.startsWith('serverloadtimings: ')) {
			this._onServerLoadTimingsMsg(
				textMsg.substring('serverloadtimings: '.length),
			);
			return;
		} else if (
			textMsg.startsWith('saveas:') ||
			textMsg.startsWith('renamefile:')
		) {
			this._renameOrSaveAsCallback(textMsg, command);
		} else if (textMsg.startsWith('exportas:')) {
			this._exportAsCallback(command);
		} else if (textMsg.startsWith('warn:')) {
			this._onWarnMsg(textMsg, command);
		} else if (window.ThisIsAMobileApp && textMsg.startsWith('mobile:')) {
			// allow passing some events easily from the mobile app
			const mobileEvent = textMsg.substring('mobile: '.length);
			this._map.fire(mobileEvent);
		} else if (textMsg.startsWith('blockui:')) {
			this._onBlockUIMsg(textMsg);
			return;
		} else if (textMsg.startsWith('unblockui:')) {
			this._map.fire('unblockUI');
			return;
		} else if (textMsg.startsWith('featurelock: ')) {
			// Handle feature locking related messages
			const lockInfo = JSON.parse(textMsg.substring(textMsg.indexOf('{')));
			this._map._setLockProps(lockInfo);
			return;
		} else if (textMsg.startsWith('restrictedCommands: ')) {
			// Handle restriction related messages
			const restrictionInfo = JSON.parse(
				textMsg.substring(textMsg.indexOf('{')),
			);
			this._map._setRestrictions(restrictionInfo);
			return;
		} else if (textMsg.startsWith('blockedcommand: ')) {
			this._onBlockedCommandMsg(textMsg);
			return;
		} else if (
			textMsg.startsWith('updateroutetoken') &&
			window.indirectSocket
		) {
			window.routeToken = textMsg.split(' ')[1];
			window.app.console.log('updated routeToken: ' + window.routeToken);
		} else if (textMsg.startsWith('reload')) {
			// Switching modes.
			// boolean argument is deprecated. false is default.
			window.location.reload();
		} else if (textMsg.startsWith('slidelayer:')) {
			this._onSlideLayerMsg(textMsg, e);
			return;
		} else if (textMsg.startsWith('zstdslidelayer:')) {
			this._onZstdSlideLayerMsg(textMsg, e);
			return;
		} else if (textMsg.startsWith('zstdvectorprimitives:')) {
			this._onZstdVectorPrimitivesMsg(e);
			return;
		} else if (textMsg.startsWith('sliderenderingcomplete:')) {
			this._onSlideRenderingCompleteMsg(textMsg, e);
			return;
		} else if (
			!textMsg.startsWith('tile:') &&
			!textMsg.startsWith('delta:') &&
			!textMsg.startsWith('slidelayer:') &&
			!textMsg.startsWith('zstdslidelayer:') &&
			!textMsg.startsWith('windowpaint:')
		) {
			if (imgBytes !== undefined) {
				try {
					// if it's not a tile, parse the whole message
					textMsg = String.fromCharCode.apply(
						null,
						imgBytes as unknown as number[],
					);
				} catch (error) {
					// big data string
					textMsg = this._utf8ToString(imgBytes);
				}
			}

			// Decode UTF-8 in case it is binary frame. Disable this block
			// in the iOS app as the image data is not URL encoded.
			if (typeof (e as SlurpMessageEvent).data === 'object') {
				// FIXME: Not sure what this code is supposed to do. Doesn't
				// decodeURIComponent() exactly reverse what window.escape() (which
				// is a deprecated equivalent of encodeURIComponent()) does? In what
				// case is this code even hit? If somebody figures out what is going
				// on here, please replace this comment with an explanation.
				textMsg = decodeURIComponent(window.escape(textMsg));
			}
		}

		if (textMsg.startsWith('status:')) {
			this._onStatusMsg(
				textMsg,
				JSON.parse(textMsg.replace('status:', '').replace('statusupdate:', '')),
			);
			return;
		}

		// These can arrive very early during the startup, and never again.
		if (textMsg.startsWith('progress:')) {
			this._onProgressMsg(textMsg);
			return;
		} else if (textMsg.startsWith('jsdialog:')) {
			this._onJSDialog(textMsg, e.callback);
		} else if (textMsg.startsWith('hyperlinkclicked:')) {
			this._onHyperlinkClickedMsg(textMsg);
		} else if (textMsg.startsWith('browsersetting:')) {
			window.prefs._initializeBrowserSetting(textMsg);
		} else if (textMsg.startsWith('presetconfigid:')) {
			app.presetConfigId = textMsg.substring('presetconfigid:'.length).trim();
		} else if (textMsg.startsWith('userpresetconfigid:')) {
			app.userPresetConfigId = textMsg
				.substring('userpresetconfigid:'.length)
				.trim();
		} else if (textMsg.startsWith('viewsetting:')) {
			const settingJSON = JSON.parse(
				textMsg.substring('viewsetting:'.length + 1),
			);
			app.serverConnectionService.onViewSetting(settingJSON);

			// Desktop bootstrap: the native bridge syncs the raw
			// viewsetting.json at startup (no aiConfigured/aiModelName yet).
			// Push it back via updateviewsettings so the session applies the
			// AI credentials. The handleUpdateViewSettings echo carries
			// aiConfigured, which is how we avoid re-sending and looping.
			if (window.ThisIsAMobileApp && settingJSON.aiConfigured === undefined) {
				this.sendMessage('updateviewsettings ' + JSON.stringify(settingJSON));
			}
		}

		if (textMsg.startsWith('downloadas:') || textMsg.startsWith('exportas:')) {
			const postMessageObj = {
				success: true,
				result: 'exportas',
				errorMsg: '',
			};

			this._map.fire('postMessage', {
				msgId: 'Action_Save_Resp',
				args: postMessageObj,
			});
			// intentional falltrough
		}

		if (!this._map._docLayer || this._handlingDelayedMessages) {
			this._delayMessage(textMsg);
		} else {
			// Messages slurped before the docLayer existed (the load window)
			// were never offered to filterSlurpedMessage (_slurpMessage only
			// filters when a docLayer is present), so early slurp-filtered
			// types — calc emits invalidatetiles: in its initial load burst —
			// reach this tail instead. Offer the filter now: the docLayer's
			// own _onMessage branch for these just logs "Message should be
			// filterd during slurp" and DROPS the payload. When the docLayer
			// existed at slurp time such messages never get here, so for
			// steady-state traffic this is one startsWith per message.
			if (
				this._map._docLayer.filterSlurpedMessage(e as SlurpMessageEvent)
			)
				return;
			this._map._docLayer._onMessage(textMsg, (e as SlurpMessageEvent).image);
		}
	}

	private _extractTextImg(e: SlurpMessageEvent): void {
		if (
			(window.ThisIsTheiOSApp ||
				window.ThisIsTheWindowsApp ||
				window.ThisIsTheMacOSApp ||
				window.ThisIsTheEmscriptenApp ||
				window.ThisIsTheQtApp) &&
			typeof e.data === 'string'
		) {
			// Another fix for issue #5843 limit splitting on the first newline
			// to only certain message types on iOS. Also, fix mangled UTF-8
			// text on iOS in jsdialogs when using languages like Greek and
			// Japanese by only setting the image bytes for only the same set
			// of message types.
			if (
				e.data.startsWith('tile:') ||
				e.data.startsWith('tilecombine:') ||
				e.data.startsWith('delta:') ||
				e.data.startsWith('rendersearchlist:') ||
				e.data.startsWith('slidelayer:') ||
				e.data.startsWith('zstdslidelayer:') ||
				e.data.startsWith('zstdvectorprimitives:') ||
				e.data.startsWith('windowpaint:')
			) {
				let index: number;
				index = e.data.indexOf('\n');
				if (index < 0) index = e.data.length;
				e.imgBytes = new Uint8Array(e.data.length);
				for (let i = 0; i < e.data.length; i++) {
					e.imgBytes[i] = e.data.charCodeAt(i);
				}
				e.imgIndex = index + 1;
				e.textMsg = e.data.substring(0, index);
			} else {
				e.textMsg = e.data;
			}
		} else if (typeof e.data === 'string') {
			e.textMsg = e.data;
		} else if (typeof e.data === 'object') {
			this._extractCopyObject(e);
		}
		e.isComplete = function () {
			if (this.image) return !!this.imageIsComplete;
			return true;
		};

		const isTile = e.textMsg.startsWith('tile:');
		const isDelta = e.textMsg.startsWith('delta:');
		if (
			!isTile &&
			!isDelta &&
			!e.textMsg.startsWith('slidelayer:') &&
			!e.textMsg.startsWith('windowpaint:')
		)
			return;

		if (e.textMsg.indexOf(' nopng') !== -1) return;

		// pass deltas through quickly.
		if (
			e.imgBytes &&
			e.imgIndex !== undefined &&
			(isTile || isDelta) &&
			e.imgBytes[e.imgIndex] != 80 /* P(ng) */
		) {
			// window.app.console.log('Passed through delta object');
			const imgEl: CoolHTMLImageElement = new Image();
			imgEl.rawData = e.imgBytes.subarray(e.imgIndex);
			imgEl.isKeyframe = isTile;
			e.image = imgEl;
			e.imageIsComplete = true;
			return;
		}

		// window.app.console.log('PNG preview');

		// lazy-loaded PNG slide previews
		const img = this._extractImage(e);
		if (isTile) {
			const imgEl: CoolHTMLImageElement = new Image();
			imgEl.src = img;
			e.image = imgEl;
			e.imageIsComplete = true;
			return;
		}

		// PNG dialog bits
		const imageElement: CoolHTMLImageElement = new Image();
		e.image = imageElement;
		imageElement.onload = function (this: Socket) {
			e.imageIsComplete = true;
			this._queueSlurpEventEmission(1);
			if (imageElement.completeTraceEvent)
				imageElement.completeTraceEvent.finish();
		}.bind(this);
		// imageElement.onerror expects a different type of handler according to tsc.
		// (event: Event | string, source?: string, lineno?: number, colno?: number, error?: Error): any;
		// So use addEventListener() for 'error' event.
		imageElement.addEventListener(
			'error',
			function (this: Socket, err: ErrorEvent) {
				window.app.console.log('Failed to load image ' + img + ' fun ' + err);
				e.imageIsComplete = true;
				this._queueSlurpEventEmission(1);
				if (imageElement.completeTraceEvent)
					imageElement.completeTraceEvent.abort();
			}.bind(this),
		);

		// This can return null.
		const traceEvt = this.createAsyncTraceEvent('loadTile');
		imageElement.completeTraceEvent = traceEvt ? traceEvt : undefined;
		imageElement.src = img;
	}

	// make profiling easier
	private _extractCopyObject(e: SlurpMessageEvent): void {
		let index: number;

		e.imgBytes = new Uint8Array(e.data as ArrayBufferLike);

		// search for the first newline which marks the end of the message
		index = e.imgBytes.indexOf(10);
		if (index < 0) index = e.imgBytes.length;

		e.textMsg = String.fromCharCode.apply(
			null,
			e.imgBytes.subarray(0, index) as unknown as number[],
		);

		e.imgIndex = index + 1;
	}

	// convert to string of bytes without blowing the stack if data is large.
	private _strFromUint8(prefix: string, data: Uint8Array): string {
		let i: number;
		const chunk = 4096;
		let strBytes = prefix;
		for (i = 0; i < data.length; i += chunk)
			strBytes += String.fromCharCode.apply(
				null,
				data.slice(i, i + chunk) as unknown as number[],
			);
		strBytes += String.fromCharCode.apply(
			null,
			data.slice(i) as unknown as number[],
		);
		return strBytes;
	}

	private _extractImage(e: SlurpMessageEvent): string {
		if (!e.imgBytes) {
			console.assert(
				false,
				'Called _extractImage with and event that does not have imgBytes member!',
			);
			return '';
		}

		if (e.imgIndex === undefined) {
			console.assert(false, '_extractImage: event does not have imgIndex!');
			return '';
		}

		const data = e.imgBytes.subarray(e.imgIndex);
		let prefix = '';
		// FIXME: so we prepend the PNG pre-byte here having removed it in TileCache::appendBlob
		if (data[0] != 0x89) prefix = String.fromCharCode(0x89);
		const img =
			'data:image/png;base64,' + window.btoa(this._strFromUint8(prefix, data));
		if (
			window.L.Browser.cypressTest &&
			window.prefs.getBoolean('image_validation_test')
		) {
			if (!window.imgDatas) window.imgDatas = [];
			window.imgDatas.push(img);
		}
		return img;
	}

	private _buildUnauthorizedMessage(command: ServerCommand): string {
		let unauthorizedMsg = window.errorMessages.unauthorized;
		if (command.errorCode) {
			// X509_verify_cert_error_string output
			const authError = window.atob(command.errorCode);
			const verifyError = window.errorMessages.verificationerror.replace(
				'{errormessage}',
				authError,
			);
			unauthorizedMsg += ' ' + verifyError;
		}
		return unauthorizedMsg;
	}

	public manualReconnect(timeout: number): void {
		if (this._map._docLayer) {
			this._map._docLayer.removeAllViews();
		}
		app.idleHandler._active = false;
		this.close();
		clearTimeout(this.timer);
		this._recycleTimer = undefined;
		setTimeout(function () {
			try {
				app.idleHandler._activate();
			} catch (error) {
				window.app.console.warn('Cannot activate map');
			}
		}, timeout);
	}

	// Vulcan: wsd marks a savefailed frame vulcanunanswered=1 when the
	// WOPI host never answered the save (a PutFile timeout) and advertises the
	// save handshake. The host may well have stored it, and wsd sends it
	// again for the host to judge. Upstream's "Document cannot be saved, please
	// check your permissions." modal is false there (in it sat under the
	// conflict dialog), so this says what is true, in a notice that blocks
	// nothing and never takes focus: the keyed snackbar, taken down without
	// moving focus (a plain snackbar's timeout gives focus back to the frame,
	// which takes the host's caret). The host still hears that the save failed,
	// marked vulcanUnanswered so it can tell this from a real failure (
	// its save pill keeps "Saving" for the retry instead of "Not saved";
	// Map.WOPI.js _noteStorageState). Without the token (an older wsd, or a
	// host without the handshake) the modal stays.
	private _onSaveUnanswered(command: ServerCommand): void {
		const notice = _(
			'Saving is taking longer than expected. Your edits are still in the editor and will be saved again.',
		);
		if (app.telemetry)
			app.telemetry.record('error_shown', {
				error_class: 'savefailed_unanswered',
			});
		this._map.uiManager.showStickySnackbar(SAVE_UNANSWERED_KEY, notice);
		clearTimeout(this._saveUnansweredTimer);
		this._saveUnansweredTimer = setTimeout(() => {
			this._saveUnansweredTimer = undefined;
			this._map.uiManager.dismissSnackbar(SAVE_UNANSWERED_KEY);
		}, SAVE_UNANSWERED_NOTICE_MS);
		this._map.fire('postMessage', {
			msgId: 'Action_Save_Resp',
			args: {
				success: false,
				cmd: command.errorCmd,
				result: command.errorKind,
				errorMsg: notice,
				Phase: 'storage',
				vulcanUnanswered: true,
			},
		});
	}

	// @keepsSave: wsd marked the frame vulcankeepssave=1 (the WOPI host has the
	// handshake and has not just refused a save without keeping it).
	private _showDocumentConflictPopUp(
		errorDetail?: string,
		keepsSave: boolean = false,
	): void {
		const buttonList: { id: string; text: string; has_default?: boolean }[] =
			[];
		const callbackList: { id: string; func_: (() => void) | null }[] = [];

		// Vulcan: the choices say what happens to the edits.
		if (keepsSave) {
			// Our WOPI host refuses a save made on a moved head and keeps its
			// bytes as a version (or combines them with the newer version and
			// keeps a backup), and the fork then reloads (handleDocumentConflict,
			// reloadResolved). So the first button is a real save, the toolbar's
			// own (never 'savetostorage force=1', which sends no timestamp and
			// can overwrite the newer version): the host's verdict decides what
			// follows. A refusal it kept reloads; a 200 means storage had not
			// moved after all and the edits are in the document; a refusal it
			// could not keep brings this dialog back without the promise. There
			// is no Cancel: it only put off the same refusal to the next
			// autosave while the person kept typing into a document about to
			// reload. Once pressed the modal closes; the guard keeps a double
			// click from sending a second save before it does.
			let saveSent = false;
			buttonList.push({
				id: 'save-edits-as-version',
				text: _('Save my edits as a version, then reload'),
				has_default: true,
			});
			callbackList.push({
				id: 'save-edits-as-version',
				func_: () => {
					if (saveSent) return;
					saveSent = true;
					this._map.save(
						false /* An explicit save should terminate cell edit */,
						false /* An explicit save should save it again */,
					);
				},
			});
		} else {
			// Nothing would keep a save sent from here: the host just refused
			// one without keeping it (it could not write the copy, or another
			// editor holds the document), or it has no handshake. A save would
			// get the same answer and this dialog again, so none is offered,
			// and the person can go on editing: the edits stay in this editor
			// and the next save tries again.
			buttonList.push({
				id: 'keep-editing',
				text: _('Keep editing'),
				has_default: true,
			});
			callbackList.push({ id: 'keep-editing', func_: null });
		}

		buttonList.push({
			id: 'discard-button',
			text: _('Discard my edits and reload'),
		});

		callbackList.push({
			id: 'discard-button',
			func_: function (this: Socket) {
				this.sendMessage('closedocument');
			}.bind(this),
		});

		// Vulcan: no "Overwrite" button. Since the vulcanConflictResolution
		// handshake (#6356), a stale-based write parks server-side as a
		// conflicted copy and can never become the current revision, so a
		// force-save ('savetostorage force=1') just loops back into this
		// same conflict popup.

		if (!this._map['wopi'].UserCanNotWriteRelative) {
			buttonList.push({ id: 'save-to-new-file', text: _('Save to new file') });
			callbackList.push({
				id: 'save-to-new-file',
				func_: function (this: Socket) {
					let filename = this._map['wopi'].BaseFileName;
					if (filename) {
						filename = app.LOUtil.generateNewFileName(filename, '_new');
						this._map.saveAs(filename);
					}
				}.bind(this),
			});
		}

		const title = _('This document changed while you were editing');
		const message = keepsSave
			? _(
					'A newer version of this document was saved while you had unsaved edits. Saving keeps a copy of your edits in Version history, then opens the newer version. Discarding opens the newer version without your edits.',
				)
			: _(
					'A newer version of this document was saved while you had unsaved edits. Your edits are not saved anywhere yet: they are only in this editor. Keep editing to hold on to them while saving is tried again, or discard them to open the newer version.',
				);

		// Opened while the person types in the host page (the agent
		// composer), it takes no focus: the next keys typed there would land in
		// the dialog, and an Enter or a Space would press a button in it.
		this._map.uiManager.showModalWithCustomButtons(
			'document-conflict-popup',
			title,
			message,
			false,
			buttonList,
			callbackList,
			errorDetail,
			/* focusHandled */ !document.hasFocus(),
		);
	}

	private _askForDocumentPassword(passwordType: string, msg: string): void {
		this._map.uiManager.showInputModal(
			'password-popup',
			'',
			msg,
			'',
			_('OK'),
			function (this: Socket, data: string): void {
				if (data) {
					this._map._docPassword = data;
					if (window.ThisIsAMobileApp) {
						window.postMobileMessage('loadwithpassword password=' + data);
					}
					this._map.loadDocument();
				} else if (passwordType === 'to-modify') {
					this._map._docPassword = '';
					this._map.loadDocument();
				} else {
					this._map.fire('postMessage', { msgId: 'UI_Cancel_Password' });
					this._map.hideBusy();
				}
			}.bind(this),
			true /* password input */,
		);
	}

	private _renameOrSaveAsCallback(
		textMsg: string,
		command: ServerCommand,
	): void {
		this._map.hideBusy();
		if (
			command !== undefined &&
			command.url !== undefined &&
			command.url !== ''
		) {
			const url = command.url;

			// setup for loading the new document, and trigger the load
			const docUrl = url.split('?')[0];
			this._map.options.doc = docUrl;
			// After save-as op, we may connect to another server, then
			// code will think that server has restarted. In this case,
			// we don't want to reload the page (detect the file name is
			// different).
			this._map.options.previousWopiSrc = this._map.options.wopiSrc;
			this._map.options.wopiSrc = docUrl;
			window.wopiSrc = this._map.options.wopiSrc;

			if (textMsg.startsWith('renamefile:')) {
				this._map.uiManager.documentNameInput.showLoadingAnimation();
				if (command.filename)
					this._map['wopi'].onRenameFile(decodeURIComponent(command.filename));
				this._map.fire('postMessage', {
					msgId: 'File_Rename',
					args: {
						NewName: command.filename,
					},
				});
			} else if (textMsg.startsWith('saveas:')) {
				const accessToken = this._getParameterByName(url, 'access_token');
				let accessTokenTtl = this._getParameterByName(url, 'access_token_ttl');
				const noAuthHeader = this._getParameterByName(url, 'no_auth_header');

				if (accessToken !== undefined) {
					if (accessTokenTtl === '') {
						accessTokenTtl = '0';
					}
					this._map.options.docParams = {
						access_token: accessToken,
						access_token_ttl: accessTokenTtl,
					};
					if (noAuthHeader == '1' || noAuthHeader == 'true') {
						this._map.options.docParams.no_auth_header = noAuthHeader;
					}
				} else {
					this._map.options.docParams = {};
				}

				// if this is save-as, we need to load the document with
				// edit permission otherwise the user has to close the
				// doc then re-open it again in order to be able to
				// edit.
				app.setPermission('edit');
				this.close();
				if (window.ThisIsTheQtApp || window.ThisIsTheWindowsApp) {
					window.postMobileMessage('loaddocument url=' + this._map.options.doc);
					this.socket?.onopen(new Event('open'));
				}
				this._map.loadDocument();
				this._map.sendInitUNOCommands();
				Util.ensureValue(command.filename);
				this._map.fire('postMessage', {
					msgId: 'Action_Save_Resp',
					args: {
						success: true,
						// Routes this ack to the Action_SaveAs/export entry
						// in Map.WOPI's funnel — untagged it would be misread
						// as the kit ack of a pending Action_Save.
						cmd: 'saveas',
						fileName: decodeURIComponent(command.filename),
					},
				});
			}
		}
		// let name = command.name; - ignored, we get the new name via the wopi's BaseFileName
	}

	/* _onMessage() subtasks */

	// 'coolserver ' message.
	// returns boolean whether or not to return immediately from _onMessage().
	private _onCoolServerMsg(textMsg: string): boolean {
		// This must be the first message, unless we reconnect.
		let oldVersion = '';
		let oldHash = '';
		let sameFile = true;
		// Check if we are reconnecting.
		if (this.WSDServer && this.WSDServer.Id) {
			// Yes we are reconnecting.
			// If our connection was lost and is ready again, we will not need to refresh the page.
			oldVersion = this.WSDServer.Version;
			oldHash = this.WSDServer.Hash;

			window.app.console.assert(
				this._map.options.wopiSrc === window.wopiSrc,
				'wopiSrc mismatch!: ' +
					this._map.options.wopiSrc +
					' != ' +
					window.wopiSrc,
			);
			// If another file is opened, we will not refresh the page.
			if (this._map.options.previousWopiSrc && this._map.options.wopiSrc) {
				if (this._map.options.previousWopiSrc !== this._map.options.wopiSrc)
					sameFile = false;
			}
		}

		this.WSDServer = JSON.parse(
			textMsg.substring(textMsg.indexOf('{')),
		) as WSDServerInfo;

		if (oldVersion && sameFile) {
			// The hash is the build's, so an image change reloads too: this
			// page's script was served by the build it last spoke to.
			if (
				this.WSDServer.Version !== oldVersion ||
				this.WSDServer.Hash !== oldHash
			) {
				let reloadMessage = _(
					'Server is now reachable. We have to refresh the page now.',
				);
				if (window.mode.isSmallScreenDevice())
					reloadMessage = _('Server is now reachable...');

				const reloadFunc = function () {
					window.location.reload();
				};
				if (!this._map['wopi'].DisableInactiveMessages)
					this._map.uiManager.showSnackbar(
						reloadMessage,
						_('RELOAD'),
						reloadFunc,
					);
				else
					this._map.fire('postMessage', {
						msgId: 'Reloading',
						args: { Reason: 'Reconnected' },
					});
				setTimeout(reloadFunc, 5000);
			}
		}
		if (window.indirectSocket) {
			if (
				window.expectedServerId &&
				window.expectedServerId != this.WSDServer.Id
			) {
				if (this.IndirectSocketReconnectCount++ >= 3) {
					let msg = window.errorMessages.clusterconfiguration.replace(
						'{productname}',
						typeof brandProductName !== 'undefined'
							? brandProductName
							: 'Vulcan Office',
					);
					msg = msg.replace('{0}', window.expectedServerId);
					msg = msg.replace('{1}', window.routeToken);
					msg = msg.replace('{2}', this.WSDServer.Id);
					this._map.uiManager.showInfoModal(
						'wrong-server-modal',
						_('Cluster configuration warning'),
						msg,
						'',
						_('OK'),
						null,
						false,
					);
					this.IndirectSocketReconnectCount = 0;
				} else {
					this._map.showBusy(_('Wrong server, reconnecting...'), false);
					this.manualReconnect(3000);
					// request to indirection server to sanity check the tokens
					this.sendMessage('routetokensanitycheck');
					return true;
				}
			}
		}

		Object.assign(window.app.serverInfo, {
			coolwsdVersion: this.WSDServer.Version || '',
			coolwsdHash: this.WSDServer.Hash || '',
			serverId: this.WSDServer.Id || '',
			wsdOptions: this.WSDServer.Options || '',
		});

		// TODO: For now we expect perfect match in protocol versions
		if (this.WSDServer.Protocol !== this.ProtocolVersionNumber) {
			this._map.fire('error', {
				msg: window.mode.isCODesktop()
					? _('Unsupported version.')
					: _('Unsupported server version.'),
			});
		}

		return false;
	}

	// 'lokitversion ' message.
	private _onLokitVersionMsg(textMsg: string): void {
		const lokitVersionObj = JSON.parse(textMsg.substring(textMsg.indexOf('{')));

		this.TunnelledDialogImageCacheSize =
			lokitVersionObj.tunnelled_dialog_image_cache_size;
	}

	// 'osinfo ' message.
	private _onOsInfoMsg(textMsg: string) {
		const osInfo = textMsg.replace('osinfo ', '');
		window.app.serverInfo.osInfo = osInfo;
	}

	// 'clipboardkey:' message.
	private _onClipboardKeyMsg(textMsg: string): void {
		const key = textMsg.substring('clipboardkey: '.length);
		if (this._map._clip) this._map._clip.setKey(key);
	}

	// 'perm:' message.
	private _onPermMsg(textMsg: string): void {
		const perm = textMsg.substring('perm:'.length).trim();

		// Never make the permission more permissive than it originally was.
		// One exception: readonly imposed by a failed WOPI lock (canTryLock)
		// is transient, and 'perm: edit' is wsd granting an attemptlock retry.
		if (!app.isReadOnly()) app.setPermission(perm);
		else if (perm === 'edit' && this._map.options.canTryLock)
			app.setPermission(perm);

		if (this._map._docLayer) this._map.setPermission(app.file.permission);

		app.file.disableSidebar = app.isReadOnly();
	}

	// 'filemode:' message.
	private _onFileModeMsg(textMsg: string): void {
		const json = JSON.parse(textMsg.substring('filemode:'.length).trim());

		// Never make the permission more permissive than it originally was.
		if (!app.isReadOnly() && json.readOnly) {
			app.setPermission('readonly');
		}

		if (this._map._docLayer) {
			this._map.setPermission(app.file.permission);
		}

		// Store the view mode extensions list from server configuration
		if (json.viewModeExtensions) {
			app.file.viewModeExtensions = json.viewModeExtensions;
		}

		app.setCommentEditingPermission(json.editComment); // May be allowed even in readonly mode.
		app.setRedlineManagementAllowed(json.manageRedlines); // May be allowed even in readonly mode.
	}

	// 'wopi:' message.
	private _onWopiMsg(textMsg: string): void {
		// Handle WOPI related messages
		const wopiInfo = JSON.parse(textMsg.substring(textMsg.indexOf('{')));
		this._map.fire('wopiprops', wopiInfo);
	}

	// 'loadstorage: ' message.
	private _onLoadStorageMsg(textMsg: string): void {
		if (textMsg.substring(textMsg.indexOf(':') + 2) === 'failed') {
			window.app.console.debug('Loading document from a storage failed');
			this._map.fire('postMessage', {
				msgId: 'App_LoadingStatus',
				args: {
					Status: 'Failed',
				},
			});
		}
	}

	// 'lastmodtime: ' message.
	private _onLastModTimeMsg(textMsg: string): void {
		const time = textMsg.substring(textMsg.indexOf(' ') + 1);
		// wsd broadcasts lastmodtime: at the end of every successful storage
		// upload (DocumentBroker::handleUploadToStorageSuccessful) and
		// otherwise only at session join. No affirmative upload-success
		// commandresult exists on the wire, so this is the storage-success
		// signal: Map.WOPI's funnel forwards it only while a host save is
		// awaiting its storage verdict and otherwise just marks storage
		// clean (save-contract.md §4, incl. the in-flight-upload residual).
		this._map.fire('postMessage', {
			msgId: 'Action_Save_Resp',
			args: {
				success: true,
				result: 'uploaded',
				Phase: 'storage',
			},
		});
		this._map.updateModificationIndicator(time);
	}

	private _onServerLoadTimingsMsg(payload: string): void {
		const parsed: { [k: string]: number } = {};
		for (const tok of payload.split(/\s+/)) {
			if (!tok) continue;
			const eq = tok.indexOf('=');
			if (eq < 0) continue;
			const k = tok.substring(0, eq);
			const v = Number(tok.substring(eq + 1));
			if (!isFinite(v)) continue;
			parsed[k] = v;
		}
		this._map._serverLoadTimings = parsed;
		if (this._map._debug && this._map._debug.dumpServerLoadTimings) {
			this._map._debug.dumpServerLoadTimings();
		}
	}

	// 'commandresult: ' message.
	private _onCommandResultMsg(textMsg: string): void {
		const commandresult = JSON.parse(textMsg.substring(textMsg.indexOf('{')));
		// Telemetry: save/load outcomes — success boolean and command word
		// only; the error message text never leaves the frame.
		if (
			app.telemetry &&
			(commandresult['command'] === 'savetostorage' ||
				commandresult['command'] === 'save' ||
				commandresult['command'] === 'load')
		) {
			app.telemetry.record('command_result', {
				command: String(commandresult['command']),
				success: commandresult['success'] !== false,
				had_error: !!commandresult['errorMsg'],
			});
		}
		if (
			commandresult['command'] === 'savetostorage' ||
			commandresult['command'] === 'save'
		) {
			const postMessageObj = {
				success: commandresult['success'],
				result: commandresult['result'],
				errorMsg: commandresult['errorMsg'],
				// `commandresult: command=save` frames are DocumentBroker's
				// broadcastSaveResult — the STORAGE-side verdict, distinct
				// from the kit's unocommandresult jail ack (which reaches the
				// host untagged via Control.Toolbar). Map.WOPI's funnel routes
				// on this tag (see save-contract.md).
				Phase: 'storage',
			};

			this._map.fire('postMessage', {
				msgId: 'Action_Save_Resp',
				args: postMessageObj,
			});
		} else if (commandresult['command'] === 'load') {
			const postMessageObj = {
				success: commandresult['success'],
				result: commandresult['result'],
				errorMsg: commandresult['errorMsg'],
			};
			this._map.fire('postMessage', {
				msgId: 'Action_Load_Resp',
				args: postMessageObj,
			});
		}
	}

	// 'migrate: ' message.
	private _onMigrateMsg(textMsg: string): void {
		const migrate = JSON.parse(textMsg.substring(textMsg.indexOf('{')));
		const afterSave = migrate.afterSave as boolean;
		app.idleHandler._serverRecycling = false;
		if (!afterSave) {
			window.migrating = true;
			this._map.uiManager.closeAll();
			if (this._map.isEditMode()) {
				this._map.setPermission('view');
				this._map.uiManager.showSnackbar(
					_('Document is getting migrated'),
					null,
					null,
					3000,
				);
			}
			if (migrate.saved) {
				window.routeToken = migrate.routeToken;
				window.expectedServerId = migrate.serverId;
				this.manualReconnect(2000);
			}
			return;
		}
		// even after save attempt, if document is unsaved reset the file permission
		if (migrate.saved) {
			window.routeToken = migrate.routeToken;
			window.expectedServerId = migrate.serverId;
			this.manualReconnect(2000);
		} else {
			this._map.setPermission(app.file.permission);
			window.migrating = false;
		}
	}

	// 'close: ' message.
	private _onCloseMsg(textMsg: string): void {
		textMsg = textMsg.substring('close: '.length);
		// Telemetry: kit/server-initiated close taxonomy. The leading token is
		// a fixed protocol constant (ownertermination|idle|oom|shuttingdown|
		// docdisconnected|recycling|documentconflict|…) — never user text.
		if (app.telemetry)
			app.telemetry.record('kit_disconnect', {
				reason: (textMsg.split(/[\s:]/)[0] || 'unknown')
					.toLowerCase()
					.slice(0, 32),
			});
		const postMsgData: any = {};
		let showMsgAndReload = false;
		// This is due to document owner terminating the session
		if (textMsg === 'ownertermination') {
			postMsgData['Reason'] = 'OwnerTermination';
		} else if (textMsg === 'idle' || textMsg === 'oom') {
			app.idleHandler._documentIdle = true;
			this._map._docLayer._documentInfo = undefined;
			postMsgData['Reason'] = 'DocumentIdle';
			if (textMsg === 'oom') postMsgData['Reason'] = 'OOM';
		} else if (textMsg === 'shuttingdown') {
			postMsgData['Reason'] = 'ShuttingDown';
			app.idleHandler._active = false;
			app.idleHandler._serverRecycling = true;
		} else if (textMsg === 'docdisconnected') {
			postMsgData['Reason'] = 'DocumentDisconnected';
		} else if (textMsg === 'recycling') {
			app.idleHandler._active = false;
			app.idleHandler._serverRecycling = true;

			// Prevent reconnecting the world at the same time.
			const min = 5000;
			const max = 10000;
			const timeoutMs = Math.floor(Math.random() * (max - min) + min);

			clearTimeout(this.timer);
			this.timer = setInterval(() => {
				if (this.connected()) {
					// We're connected: cancel timer and dialog.
					clearTimeout(this.timer);
					this._recycleTimer = undefined;
					return;
				}

				try {
					this._map.loadDocument(this.socket);
				} catch (error) {
					window.app.console.warn('Cannot load document.');
				}
			}, timeoutMs);
			this._recycleTimer = this.timer;
		} else if (textMsg.startsWith('documentconflict')) {
			showMsgAndReload = true;
		} else if (textMsg.startsWith('versionrestore:')) {
			textMsg = textMsg.substring('versionrestore:'.length).trim();
			if (textMsg === 'prerestore_ack') {
				this._map.fire('postMessage', {
					msgId: 'App_VersionRestore',
					args: { Status: 'Pre_Restore_Ack' },
				});
				showMsgAndReload = true;
			}
		} else if (textMsg.startsWith('reloadafterrename')) {
			showMsgAndReload = true;
		}

		// Vulcan Office (R7): the server sent this close; it is
		// no gesture in this frame. When the frame does not hold the keyboard
		// (the person is typing in the host page, in the agent composer), nothing
		// here may move focus into it: closing the dialogs below would give focus
		// back to what had it when each opened (JSDialog.focusToLastElement), and
		// the reload's reactivation grabs it on desktop Calc. In a
		// documentconflict reload took the composer's caret, and the rest of the
		// word typed there landed in the document. A frame that holds the
		// keyboard keeps upstream's focus handling.
		const leaveCaret = !document.hasFocus();

		if (showMsgAndReload) {
			if (this._map._docLayer) {
				this._map._docLayer.removeAllViews();
			}
			// Detach all the handlers from current socket, otherwise _onSocketClose tries to reconnect again
			// However, we want to reconnect manually here.
			this.close();

			// Reload the document
			app.idleHandler._active = false;
			// Read by _onSocketOpen, until the reloaded document is back.
			this._reloadLeavesCaret = leaveCaret;
			const allowFocusGrab = !leaveCaret;
			clearTimeout(this.timer);
			this.timer = setInterval(() => {
				try {
					// Activate and cancel timer and dialogs.
					app.idleHandler._activate(allowFocusGrab);
					this._map.uiManager.documentNameInput.hideLoadingAnimation();
				} catch (error) {
					window.app.console.warn('Cannot activate map');
				}
			}, 3000);
		}

		// Close any open dialogs first.
		this._map.uiManager.closeAll(/* leaveSnackbar */ false, leaveCaret);

		if (textMsg === 'idle' || textMsg === 'oom') {
			app.idleHandler._dim();
			RenderManager.discardAllCache();
		}

		if (postMsgData['Reason']) {
			// Tell WOPI host about it which should handle this situation
			this._map.fire('postMessage', {
				msgId: 'Session_Closed',
				args: postMsgData,
			});
		}

		if (textMsg === 'ownertermination') {
			this._map.remove();
		}
	}

	// 'error: ' message.
	// returns true if the caller need to exit immediately.
	private _onErrorMsg(
		textMsg: string,
		command: ServerCommand,
		frameAttempt?: number,
	): boolean {
		const errorMessages = window.errorMessages;
		let msg = '';
		let passwordType: string = '';
		if (
			textMsg.startsWith('error:') &&
			command.errorCmd === 'transformdocumentstructure'
		) {
			// VULCAN (R6-10): the only client-socket sender of
			// `transformdocumentstructure` is the Impress agent bridge
			// (VulcanImpressBridge.slideTransform), and IT owns the outcome:
			// the host tool that dispatched the verb receives the rejection
			// and decides what the user sees against canvas reality. Left
			// unconsumed, this frame fell through to the docLayer's generic
			// dialog — "The server encountered a(n) <kind> error while
			// parsing the transformdocumentstructure command" — a modal
			// blaming the user's turn for a wire-internal failure, shown even
			// when the edit later landed by another lane. Route it to the
			// bridge's pending transform instead; telemetry, not a toast.
			if (app.telemetry)
				app.telemetry.record('error_shown', {
					error_class: 'transformdocumentstructure_' + (command.errorKind ?? 'unknown'),
				});
			window.app.console.error(
				'transformdocumentstructure refused by server: kind=' +
					command.errorKind,
			);
			this._map.fire('vulcantransformerror', {
				kind: command.errorKind ? command.errorKind : 'unknown',
				errorDetail: command.errorDetail,
			});
			return true; // consumed: the bridge ack carries the outcome.
		}
		if (textMsg.startsWith('error:') && command.errorCmd === 'save') {
			// wsd refuses `save` on a session without storage write permission
			// (ClientSession.cpp `!isWritable()` -> `error: cmd=save
			// kind=savefailed`). This errorCmd was unrouted: no ack reached
			// the host (its pending save burned the full timeout) and the
			// frame fell through to the docLayer's generic "error while
			// parsing the save command" dialog. Fail the save fast and
			// attributably instead (save-contract.md, finding 26).
			this._map.hideBusy();
			if (app.telemetry)
				app.telemetry.record('error_shown', {
					error_class: 'savefailed_readonly',
				});
			this._map.fire('postMessage', {
				msgId: 'Action_Save_Resp',
				args: {
					success: false,
					cmd: 'save',
					result: command.errorKind ? command.errorKind : 'savefailed',
					errorMsg: errorMessages.storage.savefailed,
					// The save never ran in core: a kit-phase terminal
					// failure, not a storage-upload verdict.
					Phase: 'core',
				},
			});
			this._map.fire('warn', {
				msg: errorMessages.storage.savefailed,
				errorDetail: command.errorDetail,
			});
			return true; // consumed: suppress the generic parse-error dialog.
		}
		if (
			(textMsg.startsWith('error:') &&
				(command.errorCmd === 'storage' || command.errorCmd === 'saveas')) ||
			command.errorCmd === 'downloadas' ||
			command.errorCmd === 'exportas'
		) {
			if (command.errorCmd !== 'storage') {
				this._map.fire('postMessage', {
					msgId: 'Action_Save_Resp',
					args: {
						success: false,
						cmd: command.errorCmd,
						result: command.errorKind,
						Phase: 'storage',
					},
				});
			}

			this._map.hideBusy();
			if (
				command.errorCmd === 'storage' &&
				command.errorKind === 'savefailed' &&
				command.vulcanUnanswered
			) {
				this._onSaveUnanswered(command);
				return true; // caller should exit immediately.
			}
			let storageError: string | undefined = undefined;
			if (command.errorKind === 'savediskfull') {
				storageError = errorMessages.storage.savediskfull;
			} else if (command.errorKind === 'savetoolarge') {
				storageError = errorMessages.storage.savetoolarge;
			} else if (command.errorKind === 'savefailed') {
				storageError = errorMessages.storage.savefailed;
			} else if (command.errorKind === 'renamefailed') {
				storageError = errorMessages.storage.renamefailed;
			} else if (command.errorKind === 'saveunauthorized') {
				storageError = errorMessages.storage.saveunauthorized;
			} else if (command.errorKind === 'saveasfailed') {
				storageError = errorMessages.storage.saveasfailed;
			} else if (command.errorKind === 'loadfailed') {
				storageError = errorMessages.storage.loadfailed;
				// Since this is a document load failure, wsd will disconnect the socket anyway,
				// better we do it first so that another error message doesn't override this one
				// upon socket close.
				this.close();
				this._hideReconnecting();
			} else if (command.errorKind === 'documentconflict') {
				console.error(
					'Document conflict: storage copy changed underneath unsaved edits.',
					'\nTechnical details: ' + command.errorDetail,
				);
				// Ack a pending host-initiated Action_Save instead of letting
				// the host burn its timeout; Map.WOPI's _postMessage funnel
				// drops this when no Notify save is pending.
				this._map.fire('postMessage', {
					msgId: 'Action_Save_Resp',
					args: {
						success: false,
						cmd: command.errorCmd,
						result: command.errorKind,
						errorMsg: _('Document has been changed in storage.'),
						Phase: 'storage',
					},
				});
				if (this._map.isReadOnlyMode())
					return true; // caller should exit immediately.
				else
					this._showDocumentConflictPopUp(
						command.errorDetail,
						!!command.vulcanKeepsSave,
					);

				return true; // caller should exit immediately.
			}

			// Skip empty errors (and allow for suppressing errors by making them blank).
			if (storageError && storageError != '') {
				// Parse the storage url as link
				const tmpLink = document.createElement('a');
				tmpLink.href = this._map.options.doc;
				// Insert the storage server address to be more friendly
				storageError = storageError.replace('%storageserver', tmpLink.host);

				// show message to the user in Control.AlertDialog
				this._map.fire('warn', {
					msg: storageError,
					errorDetail: command.errorDetail,
				});

				// send to wopi handler so we can respond
				const postMessageObj = {
					success: false,
					cmd: command.errorCmd,
					result: command.errorKind,
					errorMsg: storageError,
					Phase: 'storage',
				};

				this._map.fire('postMessage', {
					msgId: 'Action_Save_Resp',
					args: postMessageObj,
				});

				return true; // caller should exit immediately.
			}
		} else if (
			textMsg.startsWith('error:') &&
			command.errorCmd === 'internal'
		) {
			this._map.hideBusy();
			this._hideReconnecting();
			this._map._fatal = true;
			if (command.errorKind === 'diskfull') {
				this._map.fire('error', {
					msg: errorMessages.diskfull,
					errorDetail: command.errorDetail,
				});
			} else if (command.errorKind === 'unauthorized') {
				const postMessageObj = {
					errorType: 'websocketunauthorized',
					success: false,
					errorMsg: this._buildUnauthorizedMessage(command),
					result: '',
				};
				this._map.fire('postMessage', {
					msgId: 'Action_Load_Resp',
					args: postMessageObj,
				});
			}

			if (this._map._docLayer) {
				this._map._docLayer.removeAllViews();
				this._map._docLayer._resetClientVisArea();
			}
			this.close();

			return true; // caller should exit immediately.
		} else if (textMsg.startsWith('error:') && command.errorCmd === 'load') {
			// A frame queued from an attempt that input has since replaced: that
			// attempt is gone, and the one in progress is not closed, muted or
			// reported for it. A failed load still spends the budget, once.
			if (frameAttempt !== undefined && frameAttempt !== this._connectCount) {
				const kind = command.errorKind || '';
				if (!/^(passwordrequired|wrongpassword|docunloading)/.test(kind))
					this._countLoadErrorFrame(frameAttempt);
				this._stopAfterLoadFailures();
				return true;
			}
			this._map.hideBusy();
			this.close();

			const errorKind = command.errorKind ? command.errorKind : '';
			// From here the error says what happened, except that the document
			// is still unloading, which this reconnect waits out and retries.
			if (!errorKind.startsWith('docunloading')) this._hideReconnecting();
			let passwordNeeded = false;
			if (errorKind.startsWith('passwordrequired')) {
				passwordNeeded = true;
				msg = '';
				passwordType = errorKind.split(':')[1];
				if (passwordType === 'to-view') {
					msg += _('Document requires password to view.');
				} else if (passwordType === 'to-modify') {
					msg += _('Document requires password to modify.');
					msg += ' ';
					msg += _('Hit Cancel to open in view-only mode.');
				}
			} else if (errorKind.startsWith('wrongpassword')) {
				passwordNeeded = true;
				msg = _('Wrong password provided. Please try again.');
			} else if (errorKind.startsWith('faileddocloading')) {
				this._countLoadErrorFrame(frameAttempt);
				this._map._fatal = true;
				this._map.fire('error', {
					msg: errorMessages.faileddocloading,
					errorDetail: command.errorDetail,
				});
			} else if (errorKind.startsWith('docloadtimeout')) {
				this._countLoadErrorFrame(frameAttempt);
				this._map._fatal = true;
				this._map.fire('error', { msg: errorMessages.docloadtimeout });
			} else if (errorKind.startsWith('docunloading')) {
				// The document is unloading. Have to wait a bit.
				app.idleHandler._active = false;

				clearTimeout(this.timer);
				if (this.ReconnectCount++ >= 10) {
					this._map.fire('error', { msg: errorMessages.docunloadinggiveup });
					if (app.telemetry) {
						app.telemetry.noteReconnectGiveUp();
						app.telemetry.record('error_shown', {
							error_class: 'docunloadinggiveup',
						});
					}
					// Give up.
					return true; // caller should exit immediately.
				}

				// A reload the server ordered while the frame did not hold the
				// keyboard, or a reconnect while it does not hold it at the tick,
				// waits out the unloading document without the grab.
				this.timer = setInterval(
					() => {
						try {
							// Activate and cancel timer and dialogs.
							const allowFocusGrab = this._reconnectMayGrabFocus();
							app.idleHandler._activate(allowFocusGrab);
						} catch (error) {
							window.app.console.warn('Cannot activate map');
						}
						// .5, 2, 4.5, 8, 12.5, 18, 24.5, 32, 40.5 seconds
					},
					500 * this.ReconnectCount * this.ReconnectCount,
				); // Quadratic back-off.

				if (this.ReconnectCount > 1) {
					if (this._reconnecting && this._map._docLayer)
						this._showReconnecting();
					else this._map.showBusy(errorMessages.docunloadingretry, false);
				}
			} else {
				// Any other load error (io, network, etc.)
				this._countLoadErrorFrame(frameAttempt);
				this._map._fatal = true;
				this._map.fire('error', {
					msg: errorMessages.faileddocloading,
					errorDetail: command.errorDetail,
				});
			}

			if (passwordNeeded) {
				this._askForDocumentPassword(passwordType, msg);
				return true; // caller should exit immediately.
			}
			// close() detaches onclose, so fatal error processing must notify the
			// host itself rather than relying on a later native close callback.
			this._stopAfterLoadFailures();
		} else if (
			textMsg.startsWith('error:') &&
			command.errorCmd === 'dialogevent' &&
			command.errorKind === 'cantchangepass'
		) {
			const msg = _('Only the document owner can change the password.');
			this._map.uiManager.showInfoModal('cool_alert', '', msg, '', _('OK'));
			return true; // caller should exit immediately.
		} else if (textMsg.startsWith('error:') && !this._map._docLayer) {
			textMsg = textMsg.substring(6);
			if (command.errorKind === 'hardlimitreached') {
				textMsg = errorMessages.limitreachedprod;
				if (command.params) {
					textMsg = textMsg.replace('{0}', command.params[0]);
					textMsg = textMsg.replace('{1}', command.params[1]);
				}
			} else if (command.errorKind === 'serviceunavailable') {
				textMsg = errorMessages.serviceunavailable;
			}
			this._map._fatal = true;
			app.idleHandler._active = false; // Practically disconnected.
			this._map.fire('error', {
				msg: textMsg,
				errorDetail: command.errorDetail,
			});
		}

		return false;
	}

	// 'fontsmissing: ' message.
	private _onFontsMissing(textMsg: string, command: ServerCommand): void {
		const fontsMissingObj = JSON.parse(textMsg.substring(textMsg.indexOf('{')));
		let msg = ' ';
		for (let i = 0; i < fontsMissingObj.fontsmissing.length; ++i) {
			if (i > 0) msg += ', ';
			msg += fontsMissingObj.fontsmissing[i];
		}

		this._map.uiManager.showInfoModal(
			'fontsmissing',
			_('Missing Fonts'),
			msg,
			null,
			_('Close'),
		);
	}

	// 'info: ' message.
	private _onInfoMsg(textMsg: string, command: ServerCommand): void {
		if (command.errorKind === 'limitreached' && !this.WasShownLimitDialog) {
			this.WasShownLimitDialog = true;
			textMsg = window.errorMessages.limitreached;
			if (command.params === undefined) {
				console.error('_onInfoMsg(): command.params is undefined!');
			} else {
				textMsg = textMsg.replace('{docs}', command.params[0]);
				textMsg = textMsg.replace('{connections}', command.params[1]);
			}
			textMsg = textMsg.replace(
				'{productname}',
				typeof brandProductName !== 'undefined'
					? brandProductName
					: 'Vulcan Office',
			);
			this._map.fire('infobar', {
				msg: textMsg,
				action: app.util.getProduct(),
				actionLabel: window.errorMessages.infoandsupport,
			});
		}
	}

	// 'warn: ' message.
	private _onWarnMsg(textMsg: string, command: ServerCommand): void {
		const len = 'warn: '.length;
		textMsg = textMsg.substring(len);
		if (textMsg.startsWith('saveas:')) {
			const userName = command.username ? command.username : _('Someone');
			const message = _(
				'{username} saved this document as {filename}. Do you want to join?',
			)
				.replace('{username}', userName)
				.replace('{filename}', command.filename as string);

			this._map.uiManager.showConfirmModal(
				'save-as-warning',
				'',
				message,
				_('OK'),
				function (this: Socket) {
					this._renameOrSaveAsCallback(textMsg, command);
				}.bind(this),
			);
		}
	}

	// 'blockui: ' message.
	private _onBlockUIMsg(textMsg: string): void {
		textMsg = textMsg.substring('blockui:'.length).trim();
		let msg: string | null = null;

		if (textMsg === 'rename') {
			msg = _('The document is being renamed and will reload shortly');
		} else if (textMsg === 'switchingtooffline') {
			msg = _(
				'The document is switching to Offline mode and will reload shortly',
			);
		}

		this._map.fire('blockUI', { message: msg });
	}

	// 'blockedcommand: ' message.
	private _onBlockedCommandMsg(textMsg: string): void {
		const blockedInfo = app.socket.parseServerCmd(textMsg.substring(16));
		if (blockedInfo.errorKind === 'restricted')
			window.app.console.log(
				'Restricted command "' + blockedInfo.errorCmd + '" was blocked',
			);
		else if (blockedInfo.errorKind === 'locked')
			this._map.openUnlockPopup(blockedInfo.errorCmd as string);
	}

	// 'slidelayer: ' message.
	private _onSlideLayerMsg(
		textMsg: string,
		e: SlurpMessageEvent | MinimalMessageEvent,
	): void {
		const content = JSON.parse(textMsg.substring('slidelayer:'.length + 1));
		this._map.fire('slidelayer', {
			message: content,
			image: (e as SlurpMessageEvent).image,
		});
	}

	// 'zstdslidelayer: ' message.
	private _onZstdSlideLayerMsg(
		textMsg: string,
		e: SlurpMessageEvent | MinimalMessageEvent,
	): void {
		const content = JSON.parse(textMsg.substring('zstdslidelayer:'.length + 1));
		const event = e as SlurpMessageEvent;
		if (event.imgBytes && event.imgIndex !== undefined)
			this._map.fire('slidelayer', {
				message: content,
				imgBytes: event.imgBytes.subarray(event.imgIndex),
			});
		else window.app.console.warn('zstdslidelayer with no image');
	}

	// 'zstdvectorprimitives:' message: a zstd-compressed .uno:VectorPrimitives response.
	// Decompress the binary payload and route it through the normal
	// command-values handler.
	private _onZstdVectorPrimitivesMsg(
		e: SlurpMessageEvent | MinimalMessageEvent,
	): void {
		const event = e as SlurpMessageEvent;
		if (!event.imgBytes || event.imgIndex === undefined) {
			window.app.console.warn('zstdvectorprimitives with no payload');
			return;
		}
		const json = new TextDecoder().decode(
			(window as any).fzstd.decompress(event.imgBytes.subarray(event.imgIndex)),
		);
		const docLayer = (this._map as any)?._docLayer;
		if (docLayer && docLayer._onCommandValuesMsg)
			docLayer._onCommandValuesMsg('commandvalues: ' + json);
	}

	// 'sliderenderingcomplete: ' message.
	private _onSlideRenderingCompleteMsg(
		textMsg: string,
		e: SlurpMessageEvent | MinimalMessageEvent,
	): void {
		const json = JSON.parse(
			textMsg.substring('sliderenderingcomplete:'.length + 1),
		);
		this._map.fire('sliderenderingcomplete', {
			message: json,
			success: json.status === 'success',
		});
	}

	// 'progress: ' message.
	private _onProgressMsg(textMsg: string): void {
		const info = JSON.parse(textMsg.substring(textMsg.indexOf('{')));
		if (!info) {
			window.app.console.error('Missing info in progress: message');
			return;
		}
		info.statusType = info.id;
		info.background = info.type == 'bg';

		// A loaded document's reconnect says it in the card through its reload
		// as through its waits. Map.showBusy raises the busy popup there, a
		// modal over the document (a wizard sheet on a phone) whose fadeout
		// moves focus into the frame.
		const reconnecting = this._reconnecting && !!this._map._docLayer;
		if (info.id == 'find' || info.id == 'connect' || info.id == 'ready') {
			if (reconnecting) this._showReconnecting();
			else
				this._map.showBusy(
					window.ThisIsAMobileApp ? _('Loading...') : _('Connecting...'),
					true,
				);
			if (info.id == 'ready') {
				// We're connected: cancel timer and dialog.
				this.ReconnectCount = 0;
				clearTimeout(this.timer);
				this._recycleTimer = undefined;
			}
		} else if (info.id == 'start' && reconnecting && !info.background) {
			// The document's own load (Map._onUpdateProgress: Map.showBusy).
			this._showReconnecting();
		} else if (info.id == 'start' || info.id == 'setvalue') {
			this._map.fire('statusindicator', info);
		} else if (info.id == 'finish') {
			this._map.fire('statusindicator', info);
			this._map._fireInitComplete('statusindicatorfinish');
			// show shutting down popup after saving is finished
			// if we show the popup just after the shuttingdown message, it will be overwitten by save popup
			if (app.idleHandler._serverRecycling) {
				this._map.showBusy(_('Server is shutting down'), false);
			}
		} else {
			window.app.console.error('Unknown progress status ' + info.id);
		}
	}
}

app.definitions.Socket = Socket;
