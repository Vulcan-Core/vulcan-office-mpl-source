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
 * L.WOPI contains WOPI related logic
 */

/* global _ app _UNO JSDialog errorMessages URLPopUpSection brandProductName $ VulcanLiveCanvas VulcanPdfCanvas */
window.L.Map.WOPI = window.L.Handler.extend({
	// If the CheckFileInfo call fails on server side, we won't have any PostMessageOrigin.
	// So use '*' because we still needs to send 'close' message to the parent frame which
	// wouldn't be possible otherwise.
	PostMessageOrigin: window.postmessageOriginExt || '*',
	BaseFileName: '',
	BreadcrumbDocName: '',
	DocumentLoadedTime: false,
	HidePrintOption: false,
	HideSaveOption: false,
	HideExportOption: false,
	HideRepairOption: false,
	HideChangeTrackingControls: false,
	DisablePrint: false,
	DisableExport: false,
	DisableCopy: false,
	DisableInactiveMessages: false,
	DownloadAsPostMessage: false,
	HostWordDownloads: false,
	// Vulcan: the host draws the "Revert AI changes" pointer for a refused
	// undo (VulcanUndoNotice); set by Vulcan_HostUndoNotices.
	HostUndoNotices: false,
	UserCanNotWriteRelative: true,
	EnableInsertRemoteImage: false,
	EnableInsertRemoteFile: false, /* Separate, because requires explicit integration support */
	DisableInsertLocalImage: false,
	EnableInsertRemoteLink: false,
	EnableRemoteAIContent: false,
	DisableAISettings: false,
	IsAnonymousUser: false,
	AIConfigured: false,
	AIModelName: '',
	EnableShare: false,
	HideUserList: null,
	CallPythonScriptSource: null,
	SupportsRename: false,
	UserCanRename: false,
	UserCanWrite: false,
	DisablePresentation: false,
	PresentationLeader: '',

	_appLoadedConditions: {
		docloaded: false,
		updatepermission: false,
		viewinfo: false, /* Whether view information has already arrived */
		initializedui: false,
	},

	_appLoaded: false,
	_insertImageMenuSetupDone: false,

	postLoadEnable: function() {
		this._map.on('docloaded', this._postLoaded, this);
		app.events.on('updatepermission', this._postLoadedBound);
		this._map.on('viewinfo', this._postLoaded, this);
		this._map.on('initializedui', this._postLoaded, this);
	},

	postLoadDisable: function() {
		this._map.off('docloaded', this._postLoaded, this);
		app.events.off('updatepermission', this._postLoadedBound);
		this._map.off('viewinfo', this._postLoaded, this);
		this._map.off('initializedui', this._postLoaded, this);
	},

	initialize: function(map) {
		this._map = map;
		this._postLoadedBound = this._postLoaded.bind(this);
		// Per-request save/export correlation queue plus the document-level
		// storage-clean bit (see ~/.cache/voffice-evidence/save-contract.md).
		// Replaces the old single {_notifySave, _pendingSaveNonce} slot,
		// which overwrote on every Action_Save and consumed on the FIRST
		// Action_Save_Resp — mis-attributing verdicts across overlapping
		// saves and dropping the storage-upload verdict entirely.
		this._pendingSaves = [];
		this._hostExports = new Map();
		this._exportControllers = new Set();
		this._hostExportSession = null;
		// null = unknown, true = storage holds the last saved bytes,
		// false = a kit-save or storage-upload failure is unresolved.
		this._storageClean = null;
		// init messages handlers should be available as soon as possible
		this.postLoadEnable();

		// Idempotent CheckFileInfo-props subscription. The props arrive over
		// the websocket AFTER initializeBasicUI, so UI built from a direct
		// map.wopi read at init time races the round-trip and loses (the
		// Share-pill bug's shape). Subscribers registered before arrival fire
		// on arrival; subscribers registered after arrival fire immediately
		// with the cached payload; every subscriber also fires on later
		// refreshes. The callback receives the same raw wopiInfo object the
		// 'wopiprops' map event carries (see _setWopiProps).
		if (!app.onWopiProps) {
			app.wopiProps = null;
			app._wopiPropsSubscribers = [];
			app.onWopiProps = function(cb) {
				app._wopiPropsSubscribers.push(cb);
				if (app.wopiProps)
					cb(app.wopiProps);
			};
		}
	},

	addHooks: function() {
		this._map.on('postMessage', this._postMessage, this);

		// Telemetry only exists for embedded (WOPI) sessions — exactly when
		// the postMessage channel can be up. Batches are dropped silently
		// until PostMessageOrigin is known (see VulcanTelemetry.canPost).
		if (app.telemetry)
			app.telemetry.start(this._map);

		// Session-replay forwarder — inert unless the host armed it with
		// vulcanReplay=1 (see src/app/VulcanReplay.ts for the contract).
		if (app.replay)
			app.replay.start();

		// Agent bridges — answer the host's nonce-acked editing round-trips
		// (see src/app/VulcanCalcBridge.ts / VulcanWriterBridge.ts /
		// VulcanImpressBridge.ts for the per-doctype contracts).
		if (app.calcBridge)
			app.calcBridge.start(this._map);
		if (app.writerBridge)
			app.writerBridge.start(this._map);
		if (app.impressBridge)
			app.impressBridge.start(this._map);

		// Writer/Impress agent bridge — same nonce-acked round-trips for
		// text and presentation/drawing documents (see
		// src/app/VulcanDocBridge.ts for the contract).
		if (app.docBridge)
			app.docBridge.start(this._map);

		this._map.on('wopiprops', this._setWopiProps, this);
		window.L.DomEvent.on(window, 'message', this._postMessageListener, this);

		this._map.on('updateviewslist', function() { this._postViewsMessage('Views_List'); }, this);

		if (!window.ThisIsAMobileApp) {
			// override the window.open to issue a postMessage, so that
			// it is possible to handle the hyperlink in the integration
			var that = this;
			window.open = function (open) {
				return function (url, name, features) {
					const eSignature = that._map.eSignature;
					const eSignInProgress = eSignature && eSignature.signInProgress;
					if (eSignInProgress) {
						return open.call(window, url, name, features);
					}

					that._map.fire('postMessage', {
						msgId: 'UI_Hyperlink',
						args: {
							Url: url,
							Name: name,
							Features: features
						}
					});
					if (!that._map._disableDefaultAction['UI_Hyperlink'])
						return open.call(window, url, name, features);
					else
						return null;
				};
			}(window.open);
		}
	},

	removeHooks: function() {
		this._clearHostExports();
		this._map.off('postMessage', this._postMessage, this);

		this.postLoadDisable();

		this._map.off('wopiprops', this._setWopiProps, this);
		window.L.DomEvent.off(window, 'message', this._postMessageListener, this);

		this._map.off('updateviewslist');
	},

	// Return whether there is the capability to rename, not the permission.
	// Since we fall back on Save As for rename isn't supported.
	_supportsRename: function() {
		return !!this.SupportsRename || !this.UserCanNotWriteRelative;
	},

	_setWopiProps: function(wopiInfo) {
		var overridenFileInfo = window.checkFileInfoOverride;
		// Store postmessageorigin property, if it exists
		if (wopiInfo['PostMessageOrigin']) {
			this.PostMessageOrigin = wopiInfo['PostMessageOrigin'];
		}

		this.BaseFileName = wopiInfo['BaseFileName'];
		this.BreadcrumbDocName = wopiInfo['BreadcrumbDocName'];
		if (this.BreadcrumbDocName === undefined)
			this.BreadcrumbDocName = this.BaseFileName;
		this._updateDocumentTitle();
		this.HidePrintOption = !!wopiInfo['HidePrintOption'];
		this.HideSaveOption = !!wopiInfo['HideSaveOption'];
		this.HideExportOption = !!wopiInfo['HideExportOption'];
		this.HideRepairOption = !!wopiInfo['HideRepairOption'];
		this.HideChangeTrackingControls = !!wopiInfo['HideChangeTrackingControls'];
		this.DisablePrint = !!wopiInfo['DisablePrint'];
		this.DisableExport = !!wopiInfo['DisableExport'];
		this.DisableCopy = !!wopiInfo['DisableCopy'];
		this.DisableInactiveMessages = !!wopiInfo['DisableInactiveMessages'];
		this.DownloadAsPostMessage = Object.prototype.hasOwnProperty.call(overridenFileInfo, 'DownloadAsPostMessage') ?
			overridenFileInfo.DownloadAsPostMessage : !!wopiInfo['DownloadAsPostMessage'];
		this.UserCanNotWriteRelative = !!wopiInfo['UserCanNotWriteRelative'];
		this.EnableInsertRemoteImage = !!wopiInfo['EnableInsertRemoteImage'];
		this.EnableInsertRemoteFile = !!wopiInfo['EnableInsertRemoteFile'];
		this.DisableInsertLocalImage = !!wopiInfo['DisableInsertLocalImage'];
		this.EnableRemoteLinkPicker = !!wopiInfo['EnableRemoteLinkPicker'];
		this.EnableRemoteAIContent = !!wopiInfo['EnableRemoteAIContent'];
		this.DisableAISettings = !!wopiInfo['DisableAISettings'];
		this.IsAnonymousUser = !!wopiInfo['IsAnonymousUser'];
		this.AIConfigured = !!wopiInfo['AIConfigured'];
		this.AIModelName = wopiInfo['AIModelName'] || '';
		this.AIEthicalRating = wopiInfo['AIEthicalRating'] || 'U';
		app.serverConnectionService.onWopiProps({
			AIConfigured: this.AIConfigured,
			AIModelName: this.AIModelName,
			AIEthicalRating: this.AIEthicalRating,
		});
		this.SupportsRename = !!wopiInfo['SupportsRename'];
		this.UserCanRename = !!wopiInfo['UserCanRename'];
		this.EnableShare = !!wopiInfo['EnableShare'];
		this.UserCanWrite = !!wopiInfo['UserCanWrite'];
		this.DisablePresentation = wopiInfo['DisablePresentation'];
		this.PresentationLeader = wopiInfo['PresentationLeader'];
		this.CommentAvatarUrl = wopiInfo['CommentAvatarUrl'];

		if (this.UserCanWrite && !app.isReadOnly()) // There are 2 places that set the file permissions, WOPI and URI. Don't change permission if URI doesn't allow.
			app.setPermission('edit');

		this.IsOwner = !!wopiInfo['IsOwner'];

		if (wopiInfo['HideUserList'])
			this.HideUserList = wopiInfo['HideUserList'].split(',');

		this.sendFrameReady();

		if ('TemplateSaveAs' in wopiInfo) {
			this._map.showBusy(_('Creating new file from template...'), false);
			this._map.saveAs(wopiInfo['TemplateSaveAs']);
		}

		this.setupImageInsertionMenu();

		// Cache + flush for app.onWopiProps subscribers (see initialize) —
		// last, so callbacks can read this fully-applied handler (map.wopi)
		// or the raw payload interchangeably.
		app.wopiProps = wopiInfo;
		var subscribers = app._wopiPropsSubscribers || [];
		for (var i = 0; i < subscribers.length; i++) {
			try {
				subscribers[i](wopiInfo);
			} catch (err) { // silent-ok: one broken subscriber must not starve the rest of CheckFileInfo props
				window.app.console.error('onWopiProps subscriber failed', err);
			}
		}
	},

	_updateDocumentTitle: function() {
		var docName = this.BreadcrumbDocName || this.BaseFileName;
		if (!docName)
			return;

		var moduleByDocType = {
			'text': 'Writer',
			'spreadsheet': 'Calc',
			'presentation': 'Impress',
			'drawing': 'Draw',
		};
		var docType = this._map.getDocType();
		var moduleName = moduleByDocType[docType];

		var brand = (typeof brandProductName !== 'undefined' && brandProductName) ? brandProductName : 'Vulcan Office';
		var product = moduleName ? brand.replace(/Online$/, moduleName).trim() : brand;
		if (moduleName && product === brand)
			product = brand + ' ' + moduleName;

		var title = docName + ' - ' + product;
		if (title === this._lastDocTitle)
			return;
		this._lastDocTitle = title;
		document.title = title;

		this._map.fire('postMessage', {
			msgId: 'Doc_Title',
			args: {
				Title: title,
				DocName: docName,
				DocType: docType || '',
				ProductName: product,
			},
		});
	},

	// Called after an in-place rename so cached WOPI props and the page title
	// refresh without waiting for a fresh CheckFileInfo round trip. Only
	// update BreadcrumbDocName if it was the default fallback (== BaseFileName);
	// a host-customized breadcrumb (friendly title, path prefix, extension-less
	// name) is left alone and will be refreshed by the next CheckFileInfo.
	onRenameFile: function(newName) {
		if (!newName)
			return;
		if (this.BreadcrumbDocName === this.BaseFileName)
			this.BreadcrumbDocName = newName;
		this.BaseFileName = newName;
		this._updateDocumentTitle();
	},

	sendFrameReady: function() {
		this._map.fire('postMessage', {
			msgId: 'App_LoadingStatus',
			args: {
				Status: 'Frame_Ready',
				Features: {
					VersionStates: true
				}
			}
		});
	},

	sendDocumentLoaded: function() {
		this._map.fire('postMessage', {
			msgId: 'App_LoadingStatus',
			args: {
				Status: 'Document_Loaded',
				DocumentLoadedTime: this.DocumentLoadedTime
			}
		});

		// Fork-clock load milestone (+ doc-shape buckets) for telemetry.
		if (app.telemetry)
			app.telemetry.noteDocumentLoaded();

		// Replay: the parent's recorder attached this frame long before
		// Document_Loaded, so a full snapshot now reliably reaches it.
		if (app.replay)
			app.replay.notifyHostReady();
	},

	// Advertise that this is the Vulcan Office fork (not the stock engine). The
	// The host application gates every fork-only feature - crucially the live
	// Vulcan_SetTheme fast path - behind receiving this message; until it
	// arrives the host drops those messages. The host replies to Vulcan_Ready
	// with the current theme, so emitting this is what actually turns theme sync
	// (and the other fork features) on. Fired once the document is loaded and
	// the postMessage channel (PostMessageOrigin/enabled) is up.
	sendVulcanReady: function() {
		var theme = 'light';
		try {
			if (document.documentElement.getAttribute('data-theme') === 'dark')
				theme = 'dark';
		} catch (err) { /* default to light */ }
		this._map.fire('postMessage', {
			msgId: 'Vulcan_Ready',
			args: {
				Fork: 'vulcan-office',
				theme: theme,
				DocType: this._map.getDocType ? this._map.getDocType() : undefined,
				// Host gates live-editing features on these (old pinned
				// images simply omit the field and the host fails fast).
				// Each bridge reports only for its own doctype; the doctype
				// bridges (writer/impress/calc) are the sole capability
				// advertisers and docBridge is their non-advertising delegate
				// (capabilities() === []). The Set stays as cheap insurance
				// against a future accidental double-claim.
				Capabilities: Array.from(new Set([].concat(
					app.calcBridge ? app.calcBridge.capabilities() : [],
					app.docBridge && app.docBridge.capabilities ? app.docBridge.capabilities() : [],
					app.writerBridge ? app.writerBridge.capabilities() : [],
					app.impressBridge ? app.impressBridge.capabilities() : [],
					// Person-grouped roster: this build groups the userlist
					// by WOPI UserId and styles vulcan_agent sessions
					// distinctly, so the host may enable agent-frame styling
					// and per-person presence UI against this frame.
					// This build's App_SaveStorageState announces EVERY
					// upload, not only the session's first
					// (_noteStorageState). The host's persistence watchdog
					// only demands upload evidence when it sees this, because
					// on a transitions-only image the silence after autosave
					// #1 would age every healthy save into a false "Not
					// saved". Host and image deploy independently, so the
					// image has to say so.
					// This build draws the "Track agent edits" chip from
					// Vulcan_SetAgentEditMode (PermissionMode.setAgentEditMode).
					// An older image ignores that message and draws nothing;
					// without this the host could not tell the two apart and
					// would assume a control the reader cannot see.
					// A refused undo/redo is a notice, never the stock
					// conflict dialog, and the AI one can be handed to the
					// host (Vulcan_HostUndoNotices -> Vulcan_UndoBlocked).
					// An upload the WOPI host never answered reaches the host
					// as App_SaveStorageState Unanswered:true
					// (_noteStorageState), so its pill may wait out wsd's own
					// upload timeout and retry before calling silence a
					// failure. An older image reports it as a plain failure,
					// and the host keeps its short deadline for that one.
					// This build opens its own find on Vulcan_OpenFind, so the
					// host may route Cmd/Ctrl+F pressed in its page here
					// Without it the host leaves the key alone.
					['collab_identity_v1', 'save_storage_every_upload_v1', 'save_storage_unanswered_v1', 'word_export_delivery_v1', 'export_request_ack_v1', 'export_bytes_v1', 'agent_edit_mode_v1', 'undo_notice_v1', 'find_open_v1'],
					// The drain handoff signals: desktop edit state
					// (Vulcan_EditState, Get_User_State_Resp.EditState) and the
					// view anchor and its restore verbs (Vulcan_GetViewAnchor,
					// Vulcan_GoToPage, Vulcan_SetZoom). VulcanEditState.ts and
					// VulcanViewAnchor.ts carry the contracts.
					window.VulcanEditState ? window.VulcanEditState.capabilities() : [],
					window.VulcanViewAnchor ? window.VulcanViewAnchor.capabilities(this._map.getDocType ? this._map.getDocType() : '') : [])))
			}
		});
		// Re-announce the phone top bar AFTER readiness. The host drops every
		// Vulcan_* message that arrives before Vulcan_Ready, and
		// VulcanTopBar.attach() publishes as soon as the toolbar exists --
		// which is earlier than this. Without the re-announce the first (and
		// possibly only) inventory is discarded, no ack comes back, and the
		// fork keeps drawing a bar the host was ready to draw. Fails safe
		// either way; this makes it deterministic instead of depending on a
		// later commandstatechanged to save it.
		if (window.VulcanTopBar)
			window.VulcanTopBar.republish();

		// Re-announce the posture on the same signal the host treats as "fork
		// features on". stampReadPosture already emits on every permission
		// change, but permission can settle BEFORE the host has finished
		// mounting its listener, and posture otherwise re-fires only on a
		// change that may never come. A dropped first message would leave the
		// one-bar contract silently off for the whole session -- failing safe,
		// band intact, and therefore completely invisible.
		//
		// Guarded rather than assumed: uiManager is built for every doctype,
		// but this runs on the load path and a throw here would take
		// Vulcan_Ready -- and with it theme sync and the live-edit bridges --
		// down with it.
		try {
			if (this._map.uiManager && this._map.uiManager.emitPosture)
				this._map.uiManager.emitPosture();
		} catch (err) { /* posture is best-effort; Vulcan_Ready is not */ }

		// Start the desktop edit-state mirror on the same signal, for the same
		// reason: the host drops Vulcan_* until Vulcan_Ready, so the first
		// Vulcan_EditState must follow it. start() pushes once unconditionally
		// and keeps a single resample timer across repeat announcements.
		try {
			if (window.VulcanEditState)
				window.VulcanEditState.start(this._map);
		} catch (err) { /* edit state is best-effort; Vulcan_Ready is not */ }
	},

	setupImageInsertionMenu: function() {
		if (this._insertImageMenuSetupDone) {
			return;
		}

		if (this.DisableInsertLocalImage) {
			JSDialog.MenuDefinitions.set('InsertImageMenu', []);
			JSDialog.MenuDefinitions.set('InsertMultimediaMenu', []);
			JSDialog.MenuDefinitions.set('CompareDocumentsMenu', []);
		}

		var menuEntriesImage = JSDialog.MenuDefinitions.get('InsertImageMenu');
		var menuEntriesMultimedia = JSDialog.MenuDefinitions.get('InsertMultimediaMenu');
		var menuEntriesCompare = JSDialog.MenuDefinitions.get('CompareDocumentsMenu');

		if (this.EnableInsertRemoteImage) {
			menuEntriesImage.push({action: 'remotegraphic', text: _UNO('.uno:InsertGraphic', '', true)});
		}

		if (this.EnableInsertRemoteFile) {
			/* Separate, because needs explicit integration support */
			menuEntriesMultimedia.push({action: 'remotemultimedia', text: _UNO('.uno:InsertAVMedia', '', true)});

			menuEntriesCompare.unshift({action: 'remotecomparedocuments', text: _('Compare Document...')});
		}

		this._insertImageMenuSetupDone = true;
	},

	// Hand the running session its next access token (the host's
	// Reset_Access_Token). Three things move together; the receiver this
	// replaces moved only the second, and that gap was the prod "Well, this
	// is embarrassing, we cannot connect to your document" dialog of
	// 2026-09-14..17:
	//   1. docParams.access_token — the token EVERY reconnect presents.
	//      Socket.ts getWebSocketBaseURI() rebuilds the /cool/ws URL from
	//      $.param(map.options.docParams), and coolwsd runs CheckFileInfo on
	//      that token before it will even look for the DocBroker. With only
	//      the ttl updated, a session renewed N times still reconnected with
	//      its ORIGINAL token; at the host's 30-minute TTL every socket drop
	//      after minute 30 was a CheckFileInfo 401, a POLICY_VIOLATION close
	//      inside the reconnect cycle, and the dialog (Socket.ts
	//      _onSocketClose, isActive && _reconnecting) — on a loop, since each
	//      retry replayed the same dead token. 179 of 200 sampled 401 URLs
	//      in prod carried a ttl NEWER than the token's own exp: this
	//      receiver's signature.
	//   2. docParams.access_token_ttl — what resetTokenExpiryTimer() and
	//      App_TokenExpiring are armed against.
	//   3. The coolwsd session, via `resetaccesstoken`. sendMessage sends on
	//      OPEN, queues on CONNECTING (whose URL already holds the old token),
	//      and skips closing/closed sockets without starting another reconnect.
	// Reset_Access_Token_Resp reports the browser update and whether the socket
	// was open. The host does not currently depend on this acknowledgement.
	_resetAccessToken: function(values) {
		if (!values || !values.token)
			return;
		// No ttl implies no expiry tracking, matching the legacy
		// single-arg form of the resetaccesstoken protocol command.
		var ttl = values.ttl ? values['ttl'] : '0';
		var live = app.socket.connected();
		this._map.options.docParams.access_token = values.token;
		this._map.options.docParams.access_token_ttl = ttl;
		// global.js keeps its own copy for the early-connect path; keep the
		// two from disagreeing about which token this page holds.
		window.accessToken = values.token;
		window.accessTokenTTL = ttl;
		app.socket.sendMessage('resetaccesstoken ' + values.token + ' ' + ttl);
		app.socket.resetTokenExpiryTimer();
		this._postMessage({msgId: 'Reset_Access_Token_Resp', args: {
			Applied: true,
			Live: live
		}});
	},

	resetAppLoaded: function() {
		this._appLoaded = false;
		for (var key in this._appLoadedConditions) {
			// this happens when we reload document eg. save as
			// UI is already initialized as it is done once per HTML load
			// without skip -> we will be locked
			if (key === 'initializedui') continue;

			this._appLoadedConditions[key] = false;
		}
	},

	_postLoaded: function(e) {
		app.console.debug('PostMessage: _postLoaded - ' + e.type);

		if (this._appLoaded) {
			return;
		}

		if (e.type === 'docloaded') {
			// doc unloaded
			if (!e.status)
			{
				this._appLoadedConditions[e.type] = false;
				return;
			}

			this.DocumentLoadedTime = Date.now();
			this._updateDocumentTitle();
		}
		this._appLoadedConditions[e.type] = true;
		for (var key in this._appLoadedConditions) {
			if (!this._appLoadedConditions[key])
				return;
		}

		this._appLoaded = true;
		this.sendDocumentLoaded();
		this.sendVulcanReady();
	},

	// Naturally we set a CSP to catch badness, but check here as well.
	// Checking whether a message came from our iframe's parents is
	// un-necessarily difficult.
	_allowMessageOrigin: function(e) {
		// e.origin === 'null' when sandboxed
		if (e.origin === 'null')
			return false;

		// cache - to avoid regexps.
		if (this._cachedGoodOrigin && this._cachedGoodOrigin === e.origin)
			return true;

		try {
			if (e.origin === window.parent.origin)
				return true;
		} catch (secErr) { // security error de-referencing window.parent.origin.
		}

		// sent from the server
		var i;
		if (!this._allowedOrigins && window.frameAncestors)
		{
			var ancestors = window.frameAncestors.trim().split(' ');
			this._allowedOrigins = ancestors;
			// convert to JS regexps from localhost:* to https*://localhost:.*
			for (i = 0; i < ancestors.length; i++) {
				this._allowedOrigins[i] = '^(http|https)://' + ancestors[i].replace(/:\*/, ':?.*') + '$';
			}
		}

		if (this._allowedOrigins)
		{
			for (i = 0; i < this._allowedOrigins.length; i++) {
				if (e.origin.match(this._allowedOrigins[i]))
				{
					this._cachedGoodOrigin = e.origin;
					return true;
				}
			}
		}

		// chrome only
		if (window.location.ancestorOrigins &&
		    window.location.ancestorOrigins.contains(e.origin))
		{
			this._cachedGoodOrigin = e.origin;
			return true;
		}

		const eSignature = this._map.eSignature;
		if (eSignature && eSignature.url === e.origin) {
			// The sender is our esign popup: accept it.
			return true;
		}

		return false;
	},

	// Apply the host's design-token values (Host_ThemeChanged.cssVars) as a
	// single managed adopted stylesheet, so the host can drive exact live values
	// on top of the vulcan-theme.css defaults. Mirrors the init-css-vars
	// contract in js/global.js: the payload is a CSS string, optionally
	// base64-encoded. One reused sheet keeps repeated toggles from accumulating.
	_applyHostCssVars: function(cssVars) {
		var css = cssVars;
		// A raw CSS payload contains a declaration/rule; otherwise assume base64.
		if (css.indexOf('{') === -1 && css.indexOf(':') === -1) {
			try { css = atob(css); } catch (err) { /* not base64; use as-is */ }
		}
		try {
			if (!this._hostThemeSheet && typeof CSSStyleSheet === 'function') {
				this._hostThemeSheet = new CSSStyleSheet();
				document.adoptedStyleSheets.push(this._hostThemeSheet);
			}
			if (this._hostThemeSheet) {
				if (typeof this._hostThemeSheet.replaceSync === 'function')
					this._hostThemeSheet.replaceSync(css);
				else if (typeof this._hostThemeSheet.replace === 'function')
					this._hostThemeSheet.replace(css);
			}
		} catch (err) {
			window.app.console.error('Host_ThemeChanged: failed to apply cssVars', err);
		}
	},

	// A byte relay is stricter than the general integrator command allowlist:
	// only the exact current parent may opt in or consume a registered export.
	_isExportParent: function(e) {
		return this.PostMessageOrigin && this.PostMessageOrigin !== '*' &&
			e.origin === this.PostMessageOrigin && e.source === window.parent;
	},

	_clearHostExports: function() {
		if (this._hostExports) {
			this._hostExports.forEach(function(entry) { clearTimeout(entry.timer); });
			this._hostExports.clear();
		}
		if (this._exportControllers) {
			this._exportControllers.forEach(function(controller) { controller.abort(); });
			this._exportControllers.clear();
		}
	},

	_registerHostExport: function(url) {
		if (!this._hostExportSession || !this.PostMessageOrigin || this.PostMessageOrigin === '*') return null;
		var parsed;
		try { parsed = new URL(url, window.location.href); }
		catch (error) { return null; } // silent-ok: omitted ExportId makes the host report unavailable delivery
		if (parsed.origin !== window.location.origin || !window.crypto || !window.crypto.randomUUID) return null;
		if (this._hostExports.size + this._exportControllers.size >= 4) return null;
		var id = window.crypto.randomUUID();
		var self = this;
		var timer = setTimeout(function() { self._hostExports.delete(id); }, 30000);
		this._hostExports.set(id, { url: parsed.href, timer: timer });
		return { ExportId: id, Session: this._hostExportSession };
	},

	_sendHostExport: async function(values) {
		if (!values || values.Session !== this._hostExportSession || !this._hostExportSession) return;
		var entry = this._hostExports.get(values.ExportId);
		if (!entry) return;
		this._hostExports.delete(values.ExportId); // exactly one GET may consume this URL
		clearTimeout(entry.timer);
		var session = this._hostExportSession;
		var origin = this.PostMessageOrigin;
		var controller = new AbortController();
		this._exportControllers.add(controller);
		var result = { ExportId: values.ExportId, Session: session };
		try {
			var response = await fetch(entry.url, { credentials: 'same-origin', signal: controller.signal });
			if (!response.ok) throw new Error('Export fetch failed');
			result.Bytes = await response.arrayBuffer();
			result.MimeType = response.headers.get('Content-Type') || 'application/octet-stream';
		} catch (error) {
			// Never navigate or fetch again: even an unreadable response spends
			// the download ID. The host reports failure and offers a NEW export.
			result.Error = 'export-transfer-failed';
		} finally {
			this._exportControllers.delete(controller);
		}
		if (this._hostExportSession !== session || this.PostMessageOrigin !== origin) return;
		window.parent.postMessage({ MessageId: 'Vulcan_ExportBytes', Values: result }, origin,
			result.Bytes ? [result.Bytes] : []);
	},

	_postMessageListener: function(e) {
		if (!this._allowMessageOrigin(e)) {
			window.app.console.error('PostMessage not allowed due to incorrect origin.');
			return;
		}

		var msg;

		if (('data' in e) && Object.hasOwnProperty.call(e.data, 'MessageId')) {
			// when e.data already contains the right props, but isn't JSON (a blob is passed for ex)
			msg = e.data;
		} else if (typeof e.data === 'object') {
			// E.g. the esign popup sends us an object, no need to JSON-parse it.
			msg = e.data;
		} else {
			try {
				msg = JSON.parse(e.data);
			} catch (e) {
				window.app.console.error(e);
				return;
			}
		}

		// allow closing documents before they are completely loaded
		if (msg.MessageId === 'Close_Session') {
			app.socket.sendMessage('closedocument');
			return;
		}

		// Vulcan Office live theme sync. The host application drives dark/light and
		// design-token values through two messages (see DESIGN.md + the fork
		// contract). Both switch live via UIManager.applyDarkMode, which flips the
		// data-theme attribute the vulcan-theme.css tokens react to - no reload.
		// Handled here (like the other UI-modification messages) so the theme can
		// apply before WOPIPostmessageReady.
		// Opt in per frame only after a capable host undertakes delivery. This
		// leaves Print, Slide Show, and hosts on older releases unchanged.
		if (msg.MessageId === 'Vulcan_HostWordDownloads') {
			this.HostWordDownloads = !!(msg.Values && msg.Values.Enabled === true);
			return;
		}
		// Per-view undo: a host that can point at its AI changes card takes
		// the "Revert AI changes" notice (Vulcan_UndoBlocked) instead of the
		// frame's own line. See VulcanUndoNotice.
		if (msg.MessageId === 'Vulcan_HostUndoNotices') {
			this.HostUndoNotices = !!(msg.Values && msg.Values.Enabled === true);
			return;
		}
		if (msg.MessageId === 'Vulcan_HostExportBytes') {
			if (!this._isExportParent(e)) return;
			var exportSession = msg.Values && msg.Values.Session;
			var enabled = msg.Values && msg.Values.Enabled === true &&
				typeof exportSession === 'string' && exportSession.length > 0 && exportSession.length <= 128;
			if (!enabled || this._hostExportSession !== exportSession) this._clearHostExports();
			this._hostExportSession = enabled ? exportSession : null;
			return;
		}
		if (msg.MessageId === 'Vulcan_GetExportBytes') {
			if (this._isExportParent(e)) void this._sendHostExport(msg.Values);
			return;
		}
		// An opted-in caller always gets a receipt, including during the
		// transparent reconnect window. A receipt acknowledges dispatch only.
		if (msg.MessageId === 'Action_Export' && msg.Values && typeof msg.Values.RequestId === 'string') {
			if (!this._isExportParent(e) || msg.Values.RequestId.length > 128) return;
			var accepted = false;
			if (window.WOPIPostmessageReady && this._appLoaded &&
				typeof msg.Values.Format === 'string' && /^[a-z0-9]+$/i.test(msg.Values.Format)) {
				var exportName = this.BaseFileName;
				exportName = exportName.substr(0, exportName.lastIndexOf('.')) || 'document';
				accepted = this._map.downloadAs(exportName + '.' + msg.Values.Format, msg.Values.Format) === true;
				if (accepted) this._pushPendingSave('export', msg.Values);
			}
			this._postMessage({ msgId: 'Vulcan_ExportRequestResult', args: {
				RequestId: msg.Values.RequestId, Status: accepted ? 'accepted' : 'rejected',
			} });
			return;
		}
		if (msg.MessageId === 'Vulcan_SetTheme') {
			if (this._map.uiManager && msg.Values &&
				(msg.Values.theme === 'dark' || msg.Values.theme === 'light'))
				this._map.uiManager.applyDarkMode(msg.Values.theme === 'dark', false);
			return;
		}
		// Vulcan Office save-state contract. The chip in the top chrome's right
		// slot (PermissionMode.ts) reports whether this document is saved, and
		// the HOST is the only one that knows: 'unverified' means core acked
		// the edit but the WOPI PutFile has not landed yet, which is a fact
		// about storage this frame cannot observe. So the host reduces the
		// state machine and pushes the result in.
		//
		// Handled up here with the other UI-modification messages, before
		// WOPIPostmessageReady, for the same reason as the theme and keyboard
		// cases: a document can be modified and saved during load, and a
		// message dropped then leaves the chip lying about a saved document.
		// PermissionMode.setSaveState holds the value if the chip is not built
		// yet and replays it, so an early message is never lost either.
		if (msg.MessageId === 'Vulcan_SetSaveState') {
			var permissionMode =
				this._map.uiManager && this._map.uiManager.permissionViewMode;
			if (permissionMode && typeof permissionMode.setSaveState === 'function')
				permissionMode.setSaveState(msg.Values ? msg.Values.state : null);
			return;
		}
		// "Track agent edits" — the chip beside the save chip. A per-file
		// setting the HOST stores and decides (it knows who may edit the file
		// and whether it is a Word document); this frame only draws
		// { tracked, available } and posts Vulcan_ToggleAgentEditMode back on
		// a click. Pre-ready with the save state, for the same reason: a
		// setting that arrives during load must not be dropped, and
		// PermissionMode holds the value until its chip exists.
		if (msg.MessageId === 'Vulcan_SetAgentEditMode') {
			var agentEditsMode =
				this._map.uiManager && this._map.uiManager.permissionViewMode;
			if (agentEditsMode && typeof agentEditsMode.setAgentEditMode === 'function')
				agentEditsMode.setAgentEditMode(msg.Values || null);
			return;
		}
		// Vulcan Office soft-keyboard contract. This frame's own visualViewport
		// describes the IFRAME, so it can never see that the platform put a
		// keyboard over the bottom of the page - only the embedding host can,
		// and it knows before the platform confirms it. Handled up here with
		// the other UI-modification messages rather than after
		// WOPIPostmessageReady: the keyboard can already be up when a document
		// finishes loading, and a message dropped then leaves the bottom-docked
		// phone chrome sitting behind it. The consumer (global.js) gates itself
		// on phone chrome and falls back to visualViewport when no host speaks.
		if (msg.MessageId === 'Vulcan_HostKeyboard') {
			if (window.VulcanKeyboard)
				window.VulcanKeyboard.setHostGeometry(msg.Values);
			// A keyboard the PLATFORM took down -- an app switch, a paired
			// hardware keyboard, a host-side dismissal -- is a teardown the
			// fork never hears about any other way, and it used to leave
			// _acceptInput latched true over a keyboard that is gone. The
			// next zoom settle replays that latch through
			// map.focus(map.canAcceptKeyboardInput()) as a real raise. The
			// correction is the latch and the intent window only, never a
			// blur: the host reports geometry, and geometry is not authority
			// over which element holds focus in this frame.
			if (msg.Values && msg.Values.open === false &&
			    this._map._textInput && this._map.canAcceptKeyboardInput()) {
				this._map._textInput._vulcanEditIntentAt = 0;
				this._map._textInput._setAcceptInput(false);
			}
			return;
		}
		// The host is dismissing the soft keyboard on our behalf: its
		// swipe-down and its app-switch resync both stand over a keyboard
		// THIS frame raised, and neither can reach it -- blurring the
		// cross-origin frame element does not blur the editable inside it,
		// and the host cannot see what holds focus here. Same
		// before-the-handshake placement as the escape verbs above: a
		// keyboard can be up before a document finishes loading.
		if (msg.MessageId === 'Vulcan_DismissKeyboard') {
			if (this._map._textInput && this._map._textInput.dismissSoftKeyboard)
				this._map._textInput.dismissSoftKeyboard();
			return;
		}
		// A file dropped on the editor by the HOST. A card dragged out of the
		// workspace's Files list carries an id, not bytes, and its drop lands
		// on the host's document, never on ours; the host resolves the bytes
		// and hands them here with the drop point (CSS px in this frame).
		// They take the road an OS drop takes — a synthetic drop on the
		// document canvas — so the paste lands where the pointer was
		// (VulcanImpressInsertPlace.armDrop) with nothing more to teach.
		if (msg.MessageId === 'Vulcan_DropFile') {
			try {
				var dropValues = msg.Values || {};
				var dropBinary = atob(String(dropValues.base64 || ''));
				var dropBytes = new Uint8Array(dropBinary.length);
				for (var dropIndex = 0; dropIndex < dropBinary.length; dropIndex++)
					dropBytes[dropIndex] = dropBinary.charCodeAt(dropIndex);
				var dropFile = new File([dropBytes], String(dropValues.name || 'dropped'),
					{ type: String(dropValues.type || 'application/octet-stream') });
				var dropTransfer = new DataTransfer();
				dropTransfer.items.add(dropFile);
				var dropCanvas = document.getElementById('document-canvas');
				if (dropCanvas) {
					var dropX = Number(dropValues.x), dropY = Number(dropValues.y);
					['dragenter', 'dragover', 'drop'].forEach(function (dropType) {
						dropCanvas.dispatchEvent(new DragEvent(dropType, {
							bubbles: true, cancelable: true,
							clientX: dropX, clientY: dropY, dataTransfer: dropTransfer,
						}));
					});
				}
			} catch (dropError) {
				window.app.console.log('Vulcan_DropFile: ' + dropError);
			}
			return;
		}
		// The PDF canvas left a page a view-only picture because an earlier
		// import did not complete (Vulcan_PdfDecomposeUnavailable); the user
		// asked to try again. Lifts the crash fuse and re-runs the build.
		if (msg.MessageId === 'Vulcan_PdfRetryDecompose') {
			if (typeof VulcanPdfCanvas !== 'undefined')
				VulcanPdfCanvas.retryDecompose();
			return;
		}
		// The host's upper-left Back was tapped (or its edge-swipe, or
		// Escape -- they all funnel through one handler there) while the
		// host's mirror of our depth was non-zero. Pop exactly one rung.
		// Handled up here with the other UI-modification messages, before
		// the WOPIPostmessageReady gate: escape must not depend on a
		// save handshake, because a session where the handshake did not complete
		// is exactly a session a user needs to get out of. If the ladder
		// turns out to be empty after all, say so rather than silently
		// eating the tap -- the host closes on the next one.
		if (msg.MessageId === 'Vulcan_EscapeBack') {
			var popped = window.VulcanEscape
				? window.VulcanEscape.popOneLayer() : false;
			if (!popped)
				this._map.fire('postMessage', {
					msgId: 'Vulcan_EscapeDepth',
					args: { depth: 0, top: null, overlays: 0 },
				});
			return;
		}
		// The host's ✓ Done was tapped: close every overlay AND exit the top
		// edit unit in one tap (owner ruling — Google's ✓). Same
		// before-the-handshake placement and same honest-empty answer as
		// EscapeBack above.
		if (msg.MessageId === 'Vulcan_EscapeDone') {
			var doneHandled = window.VulcanEscape && window.VulcanEscape.popDone
				? window.VulcanEscape.popDone() : false;
			if (!doneHandled)
				this._map.fire('postMessage', {
					msgId: 'Vulcan_EscapeDepth',
					args: { depth: 0, top: null, overlays: 0 },
				});
			return;
		}
		// The host is now drawing our top-bar inventory in its own header
		// (SPEC-one-topbar). This ACK -- not a deploy order -- is what
		// collapses #toolbar-row, so a host that never sends it, or that
		// rolls back, leaves the phone with the full fork bar it has today.
		// Handled before the WOPIPostmessageReady gate with the other
		// UI-modification messages: the host sends it the moment it sees our
		// first Vulcan_TopBarItems, which can precede the handshake.
		if (msg.MessageId === 'Vulcan_TopBarHosted') {
			if (window.VulcanTopBar)
				window.VulcanTopBar.setHosted(
					!msg.Values || msg.Values.Hosted !== false);
			return;
		}
		// The user tapped one of our controls in the host's bar. Runs the real
		// element, so every stock binding fires exactly as it would for a tap
		// on our own row.
		if (msg.MessageId === 'Vulcan_TopBarInvoke') {
			if (window.VulcanTopBar && msg.Values)
				window.VulcanTopBar.invoke(msg.Values.Role);
			return;
		}

		// The home-indicator strip, measured by the host because THIS FRAME
		// CANNOT MEASURE IT. env(safe-area-inset-*) resolves against the
		// top-level viewport; in a nested iframe it is 0 no matter what, and
		// adding viewport-fit=cover to cool.html would not change that. So the
		// fork's own CSS cannot see the indicator, and a rule written as
		// `calc(24px + env(safe-area-inset-bottom))` here is silently inert --
		// which is exactly what the first draft of the FAB fix was.
		//
		// The host reads it (it IS top-level, and already carries the value as
		// --safe-area-bottom) and hands it down. Same rail as
		// Vulcan_HostKeyboard, same replay-on-Vulcan_Ready, for the same reason:
		// host-old + fork-new is a real deployment state, and with no message on
		// the wire the variable stays unset and every consumer falls back to 0px
		// -- i.e. exactly the pre-change layout, on desktop and on any phone
		// without an indicator.
		//
		// `left`/`right` joined the payload later than `bottom`: landscape
		// puts the notch on a LONG edge — rotation decides which — and the
		// edge-docked chrome had no side inset at all. Validated per field so
		// a host that still sends only `bottom` (the shipped publisher)
		// changes nothing here: the side variables stay unset and every
		// consumer's 0px fallback keeps today's layout. Zero is a real value
		// and MUST be written -- rotation swaps the notch side, and a
		// republish that skipped the now-zero side would leave the previous
		// rotation's inset stuck on an edge that no longer has a rail.
		// Contract pinned in mocha_tests/PhoneSafeAreaSideRails.test.ts.
		if (msg.MessageId === 'Vulcan_HostSafeArea') {
			var bottom = msg.Values && msg.Values.bottom;
			if (typeof bottom === 'number' && isFinite(bottom) && bottom >= 0) {
				document.documentElement.style.setProperty(
					'--vulcan-safe-bottom', bottom + 'px');
			}
			var safeLeft = msg.Values && msg.Values.left;
			if (typeof safeLeft === 'number' && isFinite(safeLeft) && safeLeft >= 0) {
				document.documentElement.style.setProperty(
					'--vulcan-safe-left', safeLeft + 'px');
			}
			var safeRight = msg.Values && msg.Values.right;
			if (typeof safeRight === 'number' && isFinite(safeRight) && safeRight >= 0) {
				document.documentElement.style.setProperty(
					'--vulcan-safe-right', safeRight + 'px');
			}
			// R6-6: the host's bottom-docked chrome (the AI composer bar) is
			// painted OVER this iframe and is exactly as invisible to it as
			// the home indicator — so it rides the SAME message as a fourth
			// field. 0 is a real value (the bar closed must lower the dock);
			// absent stays unset so host-old skew keeps today's layout
			// through every consumer's own 0px fallback. Contract pinned in
			// mocha_tests/PhoneSafeAreaSideRails.test.ts (SR6/SR7).
			var hostRail = msg.Values && msg.Values.rail;
			if (typeof hostRail === 'number' && isFinite(hostRail) && hostRail >= 0) {
				document.documentElement.style.setProperty(
					'--vulcan-host-rail', hostRail + 'px');
			}
			// the `bottom` of the state where the host's
			// immersive-read header SHOWS (its strip below the screen plus the
			// home indicator). Unlike `bottom` it holds still while the header
			// hides, so it can size the scroll extent
			// (ViewLayoutWriter.vulcanBottomApronCore). 0 is a real value (the
			// layout went inert); absent stays unset, so an old host keeps
			// today's extent.
			var scrollApron = msg.Values && msg.Values.scrollApron;
			if (typeof scrollApron === 'number' && isFinite(scrollApron) && scrollApron >= 0) {
				document.documentElement.style.setProperty(
					'--vulcan-scroll-apron', scrollApron + 'px');
			}
			return;
		}
		// Vulcan Office one-bar contract, host half. The host says "I am now
		// painting the controls your top band uniquely carries"; only then does
		// §13-WRITER.4 hide the band.
		//
		// This is a HANDSHAKE and not a static CSS rule for a deployment reason:
		// the fork ships as a pinned image and the host is a separate Next.js
		// deploy, so fork-new + host-old is a state that really occurs. In it a
		// CSS-only hide would strand a phone reader with no comment surface and
		// no document menu. Stamping the class only on this message makes the
		// bad ordering safe by construction -- no message, no hide, stock band.
		//
		// Pre-ready like the theme and keyboard messages above: the host can
		// know it owns the chrome before the document finishes loading, and
		// handling it late would paint the band and then snatch it away.
		if (msg.MessageId === 'Vulcan_HostChrome') {
			var ownsChrome = !!(msg.Values && msg.Values.OwnsChrome);
			document.documentElement.classList.toggle('vulcan-host-chrome', ownsChrome);
			return;
		}
		if (msg.MessageId === 'Host_ThemeChanged') {
			if (msg.Values) {
				if (typeof msg.Values.cssVars === 'string' && msg.Values.cssVars.length)
					this._applyHostCssVars(msg.Values.cssVars);
				if (this._map.uiManager && typeof msg.Values.DarkMode === 'boolean')
					this._map.uiManager.applyDarkMode(msg.Values.DarkMode, false);
			}
			return;
		}

		// Vulcan Office focus policy. Upstream grabs the caret as soon
		// as the document is loaded (Map.js 'docloaded'), which is right for a
		// full-tab editor and wrong for a host that embeds one: the grab lands
		// while the user is renaming the file, typing a comment, or talking to
		// an agent, and the keystrokes go to the frame. Only the host knows
		// whether the user is looking at the editor, so it decides:
		//   { MessageId: 'Vulcan_FocusPolicy', Values: { AutoFocusOnLoad: false } }
		// switches the load-time grab off. TRUE is upstream's behaviour. A host
		// that never sends this message gets upstream's behaviour in a top-level
		// editor only: an embedded one starts as if it had been sent false
		// (Map.initialize), because this message often lands after
		// 'docloaded'. Gesture-driven focus (click, Grab_Focus, the mobile
		// keyboard) is not affected either way.
		//
		// Handled up here with the theme and chrome messages, before
		// WOPIPostmessageReady, for the same reason: 'docloaded' can arrive
		// before ready, and a policy dropped then would steal focus exactly
		// once - the case it exists to prevent. The host has Frame_Ready (which
		// this handler emits long before the document loads) as its cue to post
		// the policy in time; a policy that arrives after 'docloaded' applies to
		// subsequent loads in the same frame.
		if (msg.MessageId === 'Vulcan_FocusPolicy') {
			// Only an explicit false turns the grab off; anything else (absent
			// Values, a non-boolean, a typo) leaves the upstream behaviour.
			this._map._vulcanAutoFocusOnLoad =
				!(msg.Values && msg.Values.AutoFocusOnLoad === false);
			return;
		}

		// Exception: UI modification can be done before WOPIPostmessageReady was fulfilled
		if (msg.MessageId === 'Show_Button' || msg.MessageId === 'Hide_Button' || msg.MessageId === 'Remove_Button') {
			if (!msg.Values) {
				window.app.console.error('Property "Values" not set');
				return;
			}

			if (!msg.Values.id) {
				window.app.console.error('Property "Values.id" not set');
				return;
			}
			var show = msg.MessageId === 'Show_Button';
			this._map.uiManager.showButton(msg.Values.id, show);
			return;
		}
		else if (msg.MessageId === 'Show_Command' || msg.MessageId === 'Hide_Command') {
			if (!msg.Values) {
				window.app.console.error('Property "Values" not set');
				return;
			}

			if (!msg.Values.id) {
				window.app.console.error('Property "Values.id" not set');
				return;
			}
			var show = msg.MessageId === 'Show_Command';
			this._map.uiManager.showCommand(msg.Values.id, show);
			return;
		}
		else if (msg.MessageId === 'Remove_Statusbar_Element') {
			if (!msg.Values) {
				window.app.console.error('Property "Values" not set');
				return;
			}
			if (!msg.Values.id) {
				window.app.console.error('Property "Values.id" not set');
				return;
			}
			// TODO: remove
			window.app.map.statusBar.showItem(msg.Values.id, false);
			return;
		}
		else if (msg.MessageId === 'Show_Menubar') {
			this._map.uiManager.showMenubar();
			return;
		}
		else if (msg.MessageId === 'Hide_Menubar') {
			this._map.uiManager.hideMenubar();
			return;
		}
		else if (msg.MessageId === 'Show_Ruler') {
			this._map.uiManager.showRuler();
			return;
		}
		else if (msg.MessageId === 'Hide_Ruler') {
			this._map.uiManager.hideRuler();
			return;
		}
		else if (msg.MessageId === 'Show_StatusBar') {
			this._map.uiManager.showStatusBar();
			return;
		}
		else if (msg.MessageId === 'Hide_StatusBar') {
			this._map.uiManager.hideStatusBar(false);
			return;
		}
		else if (msg.MessageId === 'Collapse_Notebookbar') {
			this._map.uiManager.collapseNotebookbar();
			return;
		}
		else if (msg.MessageId === 'Extend_Notebookbar') {
			this._map.uiManager.extendNotebookbar();
			return;
		}
		else if (msg.MessageId === 'Show_NotebookTab' || msg.MessageId === 'Hide_NotebookTab') {
			if (!msg.Values) {
				window.app.console.error('Property "Values" not set');
				return;
			}
			if (!msg.Values.id) {
				window.app.console.error('Property "Values.id" not set');
				return;
			}

			let show = msg.MessageId === 'Show_NotebookTab';
			this._map.uiManager.showNotebookTab(msg.Values.id, show);
			return;
		}
		else if (msg.MessageId === 'Show_Sidebar') {
			/* id is optional */
			if (msg.Values) {
				switch (msg.Values.id) {
				case 'Navigator':
				case 'ModifyPage':
				case 'CustomAnimation':
				case 'MasterSlidesPanel':
					this._map.sendUnoCommand(`.uno:${msg.Values.id}`);
					return;
				}
			}
			this._map.sendUnoCommand('.uno:SidebarDeck.PropertyDeck');
			return;
		}
		else if (msg.MessageId === 'Hide_Sidebar') {
			this._map.sendUnoCommand('.uno:SidebarHide');
			return;
		}
		else if (msg.MessageId === 'Show_Menu_Item' || msg.MessageId === 'Hide_Menu_Item') {
			if (!msg.Values) {
				window.app.console.error('Property "Values" not set');
				return;
			}
			if (!msg.Values.id) {
				window.app.console.error('Property "Values.id" not set');
				return;
			}
			if (!this._map.menubar || !this._map.menubar.hasItem(msg.Values.id)) {
				window.app.console.error('Menu item with id "' + msg.Values.id + '" not found.');
				if (this._map.uiManager.getCurrentMode() === 'notebookbar') {
					window.app.console.error('No menu items in notebookbar');
				}
				return;
			}

			if (msg.MessageId === 'Show_Menu_Item') {
				if (!this._map.menubar.showItem(msg.Values.id)) {
					window.app.console.error('Menu entry with id "' + msg.Values.id + '" not found.');
				}
			} else if (!this._map.menubar.hideItem(msg.Values.id)) {
				window.app.console.error('Menu entry with id "' + msg.Values.id + '" not found.');
			}
			return;
		}
		else if (msg.MessageId === 'Insert_Button' &&
			msg.Values && msg.Values.id) {
			this._map.uiManager.insertButton(msg.Values);
			return;
		}
		else if (msg.MessageId === 'Insert_ContextualButton' &&
			msg.Values && msg.Values.id) {
			this._map.uiManager.map.contextToolbar.insertAdditionalContextButton(msg.Values);
			return;
		}
		else if (msg.MessageId === 'Vulcan_ReadRange' && msg.Values && msg.Values.Nonce && app.calcBridge) {
			// Calc agent bridge round-trips (nonce-acked; see VulcanCalcBridge.ts).
			app.calcBridge.handleReadRange(msg.Values);
			return;
		}
		else if (msg.MessageId === 'Vulcan_GetSheetInfo' && msg.Values && msg.Values.Nonce && app.calcBridge) {
			app.calcBridge.handleGetSheetInfo(msg.Values);
			return;
		}
		else if (msg.MessageId === 'Vulcan_HighlightCells' && msg.Values && app.calcBridge) {
			// Non-persistent AI-change review overlay (calc_highlight_v1).
			app.calcBridge.handleHighlightCells(msg.Values);
			return;
		}
		else if (msg.MessageId === 'Vulcan_ClearHighlights' && app.calcBridge) {
			app.calcBridge.handleClearHighlights(msg.Values || {});
			return;
		}
		else if (msg.MessageId === 'Vulcan_GetDocInfo' && msg.Values && msg.Values.Nonce && app.docBridge) {
			// Writer/Impress agent bridge round-trips (nonce-acked; see
			// VulcanDocBridge.ts).
			app.docBridge.handleGetDocInfo(msg.Values);
			return;
		}
		else if (msg.MessageId === 'Vulcan_GetDeckInfo' && msg.Values && msg.Values.Nonce && app.docBridge) {
			app.docBridge.handleGetDeckInfo(msg.Values);
			return;
		}
		else if (msg.MessageId === 'Send_UNO_Command' && msg.Values && msg.Values.Command && msg.Values.Nonce) {
			// Nonce'd UNO commands want a Send_UNO_Command_Resp ack; each
			// bridge also expands its virtual .uno:Vulcan_* verbs. Route by
			// the open document's type: the doctype bridges own the anchored
			// verb sets (VulcanWriterBridge/VulcanImpressBridge) and delegate
			// verbs they don't know to the selection-based VulcanDocBridge,
			// so both verb families stay reachable on one channel.
			var docType = this._map.getDocType ? this._map.getDocType() : '';
			var bridge = null;
			if (docType === 'text' && app.writerBridge)
				bridge = app.writerBridge;
			else if (VulcanLiveCanvas.isCanvasDocType(docType) && app.impressBridge)
				bridge = app.impressBridge;
			else if (docType !== 'spreadsheet' && app.docBridge)
				bridge = app.docBridge;
			else if (app.calcBridge)
				bridge = app.calcBridge;
			if (bridge) {
				bridge.handleUnoCommand(msg.Values);
				return;
			}
		}
		else if (msg.MessageId === 'Send_UNO_Command' && msg.Values && msg.Values.Command) {
			// Commands to insert comments without args initiate interactive insertion,
			// showing in-place editor, and in PDF, entering a click-to-place mode.
			if (!msg.Values.Args) {
				if (msg.Values.Command === '.uno:InsertAnnotation') {
					this._map.insertComment();
					return;
				}
				if (msg.Values.Command === '.uno:InsertThreadedComment') {
					this._map.insertThreadedComment();
					return;
				}
			}
			// Same commands shipped with full args plus an InteractiveAnchor
			// sentinel: the host has the text ready and wants the browser to
			// pick the anchor (PDF picker), then dispatch the command with the
			// picked PositionX/Y (and Width/Height for a drag) substituted in.
			// The sentinel is browser-directed (stripped before dispatch), not
			// a UNO arg, so any truthy value enables it.
			else if (msg.Values.Args.InteractiveAnchor
				&& (msg.Values.Command === '.uno:InsertAnnotation'
					|| msg.Values.Command === '.uno:InsertThreadedComment')) {
				this._map.insertCommentInteractive(msg.Values.Command, msg.Values.Args);
				return;
			}
			this._map.sendUnoCommand(msg.Values.Command, msg.Values.Args || '');
			return;
		}
		else if (msg.MessageId === 'Hint_OnscreenKeyboard') {
			window.keyboard.hintOnscreenKeyboard(true);
			return;
		}
		else if (msg.MessageId === 'Hint_NoOnscreenKeyboard') {
			window.keyboard.hintOnscreenKeyboard(false);
			return;
		}
		else if (msg.MessageId === 'Disable_Default_UIAction') {
			// Disable the default handler and action for a UI command.
			// When set to true, the given UI command will issue a postmessage
			// only. For example, UI_Save will be issued for invoking the save
			// command (from the menu, toolbar, or keyboard shortcut) and no
			// action will take place if 'UI_Save' is disabled via
			// the Disable_Default_UIAction command.
			if (msg.Values && msg.Values.action && msg.Values.disable !== undefined) {
				this._map._disableDefaultAction[msg.Values.action] = msg.Values.disable;
			}
			return;
		}
		else if (msg.MessageId === 'Error_Messages') {
			if (msg.Values && msg.Values.list) {
				msg.Values.list.forEach(function (item) {
					if (Object.prototype.hasOwnProperty.call(errorMessages.storage, item.type)) {
						errorMessages.storage[item.type] = item.msg;
					} else if (Object.prototype.hasOwnProperty.call(errorMessages.uploadfile, item.type)) {
						errorMessages.uploadfile[item.type] = item.msg;
					} else if (Object.prototype.hasOwnProperty.call(errorMessages, item.type)) {
						errorMessages[item.type] = item.msg;
					}
				});
			}
		}

		// All following actions must be done after initialization is completed.
		if (!window.WOPIPostmessageReady) {
			window.app.console.error('PostMessage ignored: not ready.');
			return;
		}

		if (msg.MessageId === 'Host_PostmessageReady') {
			// cool.html's listener owns the WOPIPostmessageReady flag; this
			// handler's job is the OTHER half of that handshake: Vulcan_Ready
			// is sent exactly once, at _appLoaded — so when the host's ready
			// arrives AFTER the document loaded (a warm fork can beat a slow
			// host commit), the announce went to a host that was not
			// listening yet and every fork feature stays dark for the whole
			// session: no theme sync, no bridges, and the host drops each
			// Vulcan_TopBarItems at its own not-ready gate, leaving the phone
			// with two toolbars. Re-announce once, so whichever side comes up
			// last completes the handshake.
			if (this._appLoaded && !this._vulcanReadyReannounced) {
				this._vulcanReadyReannounced = true;
				this.sendVulcanReady();
			}
			return;
		}

		if (msg.MessageId === 'Grab_Focus') {
			app.idleHandler._activate();
			app.map.focus();
			return;
		}

		// allow closing documents before they are completely loaded
		if (msg.MessageId === 'Close_Session') {
			app.socket.sendMessage('closedocument');
			return;
		}

		// when user goes idle we have 'this._appLoaded == false'
		if (msg.MessageId === 'Get_User_State') {
			var isIdle = app.idleHandler.isDimActive();
			var userState = {
				State: (isIdle ? 'idle' : 'active'),
				Elapsed: app.idleHandler.getElapsedFromActivity()
			};
			// edit_state_v1: the desktop edits a reload would lose, read at
			// the ask (VulcanEditState.ts). On every form factor.
			if (window.VulcanEditState)
				userState.EditState = window.VulcanEditState.read(this._map);
			this._postMessage({msgId: 'Get_User_State_Resp', args: userState});
		}

		// view_anchor_v1 (VulcanViewAnchor.ts): where the person is, asked by a
		// host about to reload this document so the next session can reopen
		// there. Above the _appLoaded gate on purpose: resetAppLoaded() runs on
		// every socket close, and a silent drop would cost the host its whole
		// anchor budget; an unreadable term answers null instead.
		if (msg.MessageId === 'Vulcan_GetViewAnchor') {
			var anchor = window.VulcanViewAnchor
				? window.VulcanViewAnchor.read(this._map)
				: {Part: null, CalcSheet: null, CalcCell: null, WriterPage: null, Zoom: null};
			anchor.Nonce = (msg.Values && msg.Values.Nonce) || null;
			this._postMessage({msgId: 'Vulcan_GetViewAnchor_Resp', args: anchor});
			return;
		}

		// Reset_Access_Token must NOT wait for _appLoaded. The host renews on
		// its own schedule, and resetAppLoaded() runs on EVERY socket close,
		// so _appLoaded is false for the whole reconnect window — which is
		// exactly when the renewal matters most: it is the token the
		// reconnect has to present. Behind the gate it was logged as
		// "Vulcan Office not loaded yet … Ignoring" and lost, with no signal
		// to the host.
		if (msg.MessageId === 'Reset_Access_Token') {
			this._resetAccessToken(msg.Values);
			return;
		}

		// For all other messages, warn if trying to interact before we are completely loaded
		if (!this._appLoaded) {
			window.app.console.error('Vulcan Office not loaded yet. Listen for App_LoadingStatus (Document_Loaded) event before using PostMessage API. Ignoring post message \'' + msg.MessageId + '\'.');
			return;
		}

		if (msg.MessageId === 'Set_Settings') {
			if (msg.Values) {
				var alwaysActive = msg.Values.AlwaysActive;
				this._map.options.alwaysActive = !!alwaysActive;
			}
		}
		else if (msg.MessageId === 'Get_Views') {
			this._postViewsMessage('Get_Views_Resp');
		}
		else if (msg.MessageId === 'Action_Save') {
			var dontTerminateEdit = msg.Values && msg.Values['DontTerminateEdit'];
			var dontSaveIfUnmodified = msg.Values && msg.Values['DontSaveIfUnmodified'];
			var extendedData = msg.Values && msg.Values['ExtendedData'];
			extendedData = encodeURIComponent(extendedData);
			// Per-request correlation entry consumed by _routeSaveResp: the
			// kit (jail) ack and the later storage-upload verdict are both
			// stamped with THIS request's Nonce, in FIFO order (the host
			// serializes save dispatch). While the page canvas's own autosave
			// is in flight the request waits for it (see clientSave).
			// BeforeClose: the host closes this view once the save lands
			//, so wsd saves it as the view's final write.
			var hostSave = {
				values: msg.Values,
				dontTerminateEdit: dontTerminateEdit,
				dontSaveIfUnmodified: dontSaveIfUnmodified,
				extendedData: extendedData,
				beforeClose: !!(msg.Values && msg.Values['BeforeClose'])
			};
			if (this._clientSaveInFlight())
				this._holdHostSave(hostSave);
			else
				this._dispatchHostSave(hostSave);
		}
		else if (msg.MessageId === 'Action_Close') {
			this._map.remove();
		}
		else if (msg.MessageId === 'Action_Fullscreen') {
			app.util.toggleFullScreen();
		}
		// One-bar contract, the two controls the hidden band uniquely carried.
		// Below the WOPIPostmessageReady gate on purpose -- both drive document
		// UI, so neither means anything before the document exists.
		//
		// Deliberately NOT routed as `.uno:Vulcan_*` bridge verbs, which is the
		// cheaper-looking option: VulcanOfficeEditor.tsx rejects every
		// `.uno:Vulcan_*` unless the fork advertised `writer_bridge_v1`, so a
		// build where the agent bridge did not announce itself would leave two
		// pieces of CHROME silently dead. Dedicated MessageIds have no such
		// coupling.
		else if (msg.MessageId === 'Vulcan_OpenComments') {
			// Same action the band's comment button ran (Control.MobileTopBar
			// forces it visible in READ). It toggles: a second call closes.
			app.dispatcher.dispatch('comment_wizard');
		}
		else if (msg.MessageId === 'Vulcan_OpenMenu') {
			// The kebab. #main-menu-state is a checkbox inside nav.main-nav,
			// which phone chrome hides -- but hidden is not disabled, and the
			// change handler renders the menu into #mobile-wizard rather than
			// the hidden #main-menu (Control.Menubar.ts). This is the same call
			// the fork already makes on itself from Control.JSDialogBuilder and
			// Control.MobileWizardWindow, so it keeps working with the band
			// display:none.
			$('#main-menu-state').click();
		}
		// Cmd/Ctrl+F pressed while the keyboard is in the HOST page.
		// An embedded editor starts without the keyboard, so until
		// the person clicks in, that keypress reaches the host, and the
		// browser's find bar cannot see a canvas. The host moves the keyboard
		// into this frame on the keypress and asks for the same action Ctrl+F
		// and the menu's Find run here: the navigator search in desktop
		// Writer, the search bar on a phone, .uno:SearchDialog in Calc and
		// Impress. Advertised as find_open_v1. Below the _appLoaded gate:
		// there is nothing to search before the document exists.
		else if (msg.MessageId === 'Vulcan_OpenFind') {
			app.dispatcher.dispatch('home-search');
		}
		// The view-anchor restore verbs (VulcanViewAnchor.ts), below the
		// _appLoaded gate because both move a loaded document's view. Neither
		// saves. Each replies with the Nonce echoed, so the host can tell a
		// landed restore from a refused or clamped one; before the load
		// nothing runs and nothing replies.
		else if (msg.MessageId === 'Vulcan_GoToPage') {
			var page = window.VulcanViewAnchor
				? window.VulcanViewAnchor.goToPage(this._map, msg.Values)
				: null;
			this._postMessage({msgId: 'Vulcan_GoToPage_Resp', args: {
				Nonce: (msg.Values && msg.Values.Nonce) || null,
				Applied: page !== null,
				Page: page
			}});
		}
		else if (msg.MessageId === 'Vulcan_SetZoom') {
			var zoomNonce = (msg.Values && msg.Values.Nonce) || null;
			var replyZoom = function (applied) {
				this._postMessage({msgId: 'Vulcan_SetZoom_Resp', args: {
					Nonce: zoomNonce,
					Applied: applied === true
				}});
			}.bind(this);
			if (window.VulcanViewAnchor)
				window.VulcanViewAnchor.setZoom(this._map, msg.Values, replyZoom);
			else
				replyZoom(false);
		}
		else if (msg.MessageId === 'Action_FullscreenPresentation' && this._map.getDocType() === 'presentation') {
			if (msg.Values) {
				var slideNumber;
				if (typeof msg.Values.StartSlideNumber != 'undefined') {
					slideNumber = msg.Values.StartSlideNumber;
				} else if (msg.Values.CurrentSlide) {
					slideNumber = this._map.getCurrentPartNumber();
				}
				this._map.fire('fullscreen',
					       {
						       startSlideNumber: slideNumber
					       });
			} else {
				this._map.fire('fullscreen');
			}
		}
		else if (msg.MessageId === 'Action_Print') {
			this._map.print();
		}
		else if (msg.MessageId === 'Action_Export') {
			if (msg.Values) {
				this._pushPendingSave('export', msg.Values);
				var format = msg.Values.Format;
				var fileName = this._map['wopi'].BaseFileName;
				fileName = fileName.substr(0, fileName.lastIndexOf('.'));
				fileName = fileName === '' ? 'document' : fileName;
				this._map.downloadAs(fileName + '.' + format, format);
			}
		}
		else if (msg.MessageId == 'Action_InsertGraphic') {
			if (msg.Values) {
				this._map.insertURL(msg.Values.url, "graphicurl");
			}
		}
		else if (msg.MessageId == 'Action_InsertMultimedia') {
			if (msg.Values) {
				this._map.insertURL(msg.Values.url, "multimediaurl");
			}
		}
		else if (msg.MessageId == 'Action_CompareDocuments') {
			if (msg.Values) {
				if (msg.Values.filename) {
					// Remember old file name for CompareChangesLabelSection.
					app.writer.compareDocumentOldFileName = msg.Values.filename;
				}

				this._map.insertURL(msg.Values.url, "comparedocumentsurl");
			}
		}
		else if (msg.MessageId == 'Action_InsertLink') {
			if (msg.Values) {
				var link = this._map.makeURLFromStr(msg.Values.url);
				// Hyperlink.TextIsHint tells the engine to keep the existing
				// selection (if any) and use this text only as a fallback.
				var text = (msg.Values.text ? String(msg.Values.text).trim() : '') || link;

				var command = {
					'Hyperlink.Text': {
						type: 'string',
						value: text
					},
					'Hyperlink.URL': {
						type: 'string',
						value: link
					},
					'Hyperlink.TextIsHint': {
						type: 'boolean',
						value: true,
					}
				};
				this._map.sendUnoCommand('.uno:SetHyperlink', command);
				this._map.focus();
			}
		}
		else if (msg.MessageId == 'Action_GetLinkPreview_Resp') {
			var popup = URLPopUpSection.getCurrent();
			if (popup)
				popup.updatePreview(msg.Values);
		}
		else if (msg.MessageId === 'Action_InsertFile') {
			if (msg.Values && (msg.Values.File instanceof Blob)) {
				this._map.fire('insertfile', {file: msg.Values.File});
			}
		}
		else if (msg.MessageId == 'Action_Paste') {
			if (msg.Values && msg.Values.Mimetype && msg.Values.Data) {
				var blob = new Blob(['paste mimetype=' + msg.Values.Mimetype + '\n', msg.Values.Data]);
				app.socket.sendMessage(blob);
			}
		}
		else if (msg.MessageId == 'Action_Copy') {
			// Request the current text selection in some format.
			if (msg.Values && msg.Values.Mimetype && this._map._clip) {
				this._map._clip.setActionCopy(true);
				app.socket.sendMessage('gettextselection mimetype=' + msg.Values.Mimetype);
			}
		}
		else if (msg.MessageId === 'Action_ShowBusy') {
			if (msg.Values && msg.Values.Label) {
				this._map.fire('showbusy', {label: msg.Values.Label});
			}
		}
		else if (msg.MessageId === 'Action_HideBusy') {
			this._map.fire('hidebusy');
		}
		else if (msg.MessageId === 'Get_Export_Formats') {
			var exportFormatsResp = [];
			for (var index in app.file.exportFormats) {
				exportFormatsResp.push({
					Label: app.file.exportFormats[index].label,
					Format: app.file.exportFormats[index].format
				});
			}

			this._postMessage({msgId: 'Get_Export_Formats_Resp', args: exportFormatsResp});
		}
		else if (msg.MessageId === 'Get_Comments') {
			let commentsResp = [];
			const commentSection = app.sectionContainer.getSectionWithName(app.CSections.CommentList.name);
			if (commentSection) {
				if (this._map._docLayer._docType === 'spreadsheet') {
					// calcMasterList has raw data for all sheets.
					const masterList = commentSection.sectionProperties.calcMasterList;
					for (let i = 0; i < masterList.length; i++) {
						const data = masterList[i];
						const entry = {
							Id: data.id,
							Author: data.author,
							DateTime: data.dateTime,
							Text: data.text,
						};
						if (data.threaded) {
							entry.Resolved = data.resolved;
							entry.Parent = data.parent;
						}
						commentsResp.push(entry);
					}
				} else {
					const commentList = commentSection.sectionProperties.commentList;
					for (let i = 0; i < commentList.length; i++) {
						const data = commentList[i].sectionProperties.data;
						if (data.trackchange)
							continue;
						const entry = {
							Id: data.id,
							Author: data.author,
							DateTime: data.dateTime,
							Text: commentList[i].sectionProperties.contentText.textContent,
							Resolved: data.resolved,
							Parent: data.parent,
						};
						// Flag threaded comments so consumers can tell which ones support resolve.
						// Writer comments don't set data.threaded; Draw PDF comments do.
						if (data.threaded)
							entry.Threaded = 'true';
						commentsResp.push(entry);
					}
				}
			}
			this._postMessage({msgId: 'Get_Comments_Resp', args: { Comments: commentsResp }});
		}
		else if (msg.MessageId === 'Action_SaveAs') {
			if (msg.Values) {
				if (msg.Values.Filename !== null && msg.Values.Filename !== undefined) {
					this._pushPendingSave('export', msg.Values);
					var nameParts = msg.Values.Filename.split('.');
					var format = undefined;
					if (nameParts.length > 1)
						format = nameParts.pop();
					else {
						this._map.uiManager.showInfoModal('error', _('Error'), _('File name should contain an extension.'), '', _('OK'));
						return;
					}

					var isExport = format === 'pdf' || format === 'epub' || this._map._saveImageToWopi;
					this._map._saveImageToWopi = false;
					if (isExport) {
						this._map.exportAs(msg.Values.Filename);
					} else {
						this._map.showBusy(_('Creating copy...'), false);
						this._map.saveAs(msg.Values.Filename, format);
					}
				}
			}
		}
		else if (msg.MessageId === 'Action_FollowUser') {
			if (msg.Values) {
				this._map._setFollowing(msg.Values.Follow, msg.Values.ViewId);
			}
			else {
				this._map._setFollowing(true, null);
			}
		}
		else if (msg.MessageId === 'Host_VersionRestore') {
			if (msg.Values.Status === 'Pre_Restore') {
				app.socket.sendMessage('versionrestore prerestore');
			}
		}
		else if (msg.MessageId === 'CallPythonScript' &&
			 Object.prototype.hasOwnProperty.call(msg, 'ScriptFile') &&
			 Object.prototype.hasOwnProperty.call(msg, 'Function')) {
			this._map.CallPythonScriptSource = e.source;
			this._map.sendUnoCommand('vnd.sun.star.script:' + msg.ScriptFile + '$' + msg.Function + '?language=Python&location=share', msg.Values);
		}
		else if (msg.MessageId === 'Action_RemoveView') {
			if (msg.Values && msg.Values.ViewId !== null && msg.Values.ViewId !== undefined) {
				app.socket.sendMessage('removesession ' + msg.Values.ViewId);
			}
		}
		else if (msg.MessageId === 'Action_ChangeUIMode') {
			this._map.uiManager.onChangeUIMode({mode: msg.Values.Mode, force: true});
		}
		else if (msg.MessageId === 'Action_Mention') {
			var list = msg.Values.list;
			this._map.mention.openMentionPopup(list);
		}
		else if (msg.MessageId === 'Action_ResolveComment') {
			var docType = this._map._docLayer._docType;
			if (msg.Values && ['text', 'spreadsheet', 'drawing'].includes(docType)) {
				const commentSection = app.sectionContainer.getSectionWithName(app.CSections.CommentList.name);
				if (commentSection) {
					const comment = commentSection.getComment(msg.Values.Id);
					// Writer allows resolve on every comment; Calc and Draw only on threaded ones.
					if (comment && comment.sectionProperties.data.resolved !== 'true'
						&& (docType === 'text' || comment.sectionProperties.data.threaded)) {
						commentSection.resolve(comment);
					}
				}
			}
		}
		else if (msg.MessageId === 'Action_GoToComment') {
			if (msg.Values) {
				var commentSection = app.sectionContainer.getSectionWithName(app.CSections.CommentList.name);
				if (!commentSection) {
					this._sendGoToCommentResp(msg.Values.Id, false, 'Comment section not available');
					return;
				}
				var docType = this._map._docLayer._docType;
				if (docType === 'spreadsheet')
					this._goToCalcComment(commentSection, msg.Values.Id);
				else if (docType === 'text')
					this._goToComment(commentSection, msg.Values.Id);
				else if (['drawing', 'presentation'].includes(docType))
					this._goToDrawComment(commentSection, msg.Values.Id);
				else
					this._sendGoToCommentResp(msg.Values.Id, false, 'Unsupported document type');
			}
		}
		else if (msg.sender === 'EIDEASY_SINGLE_METHOD_SIGNATURE') {
			// This is produced by the esign popup.
			const eSignature = this._map.eSignature;
			if (eSignature) {
				eSignature.handleSigned(msg);
			}
		}
	},

	_goToComment: function(commentSection, commentId) {
		// Writer and Calc use different types for Id: string vs. integer?
		var comment = commentSection.getComment(commentId);
		if (!comment)
			comment = commentSection.getComment(parseInt(commentId));
		if (!comment) {
			this._sendGoToCommentResp(commentId, false, 'Comment not found');
			return;
		}

		this._map.showComments(true);
		if (comment.sectionProperties.data.resolved === 'true')
			this._map.showResolvedComments(true);

		// Move the cursor to the comment's anchor
		var clickX, clickY;
		var cellRange = comment.sectionProperties.data.cellRange;
		if (this._map._docLayer._docType === 'spreadsheet' && cellRange) {
			var cellRect = this._map._docLayer._cellRangeToTwipRect(cellRange).toRectangle();
			clickX = Math.round(cellRect[0] + cellRect[2] / 2);
			clickY = Math.round(cellRect[1] + cellRect[3] / 2);
		} else {
			var anchorPos = comment.sectionProperties.data.anchorPos;
			clickX = anchorPos[0];
			clickY = anchorPos[1];
		}
		if (clickX && clickY) {
			this._map._docLayer._postMouseEvent('buttondown', clickX, clickY, 1, 1, 0);
			this._map._docLayer._postMouseEvent('buttonup', clickX, clickY, 1, 1, 0);
		}

		commentSection.navigateAndFocusComment(comment);

		if (this._map._docLayer._docType === 'spreadsheet') {
			// The sheet switch and mouse click (which sets cursor to anchor) trigger
			// async events (_onSetPartMsg, onNewDocumentTopLeft, onCellAddressChanged)
			// that would normally hide the comment. Set a guard to prevent that, show
			// the comment, then clear the guard after a timeout to let events settle.
			// 2 s timeout is an arbitrary value, hoped to cover typical cases, and at
			// the same time, not block expected responsiveness, when user expects it
			// to hide.
			var props = commentSection.sectionProperties;
			if (props.doNotHideCommentTimer)
				clearTimeout(props.doNotHideCommentTimer);
			props.doNotHideCommentTimer = setTimeout(function() {
				props.doNotHideCommentTimer = null;
			}, 2000);

			// Finally, an additional operation specific to Calc (maybe also Draw?):
			// it actually shows the comment on mouse hover
			comment.onMouseEnter();
		}

		this._sendGoToCommentResp(commentId, true);
	},

	_goToCalcComment: function(commentSection, commentId) {
		var map = this._map;
		var props = commentSection.sectionProperties;

		// Try to find the comment in the current calcMasterList.
		var entry = props.calcMasterList.find(el => el.id == commentId);
		if (!entry) {
			this._sendGoToCommentResp(commentId, false, 'Comment not found');
			return;
		}

		// If timeout from previous command is still active, stop it; and hide any shown comment,
		// to avoid a case when doNotHideCommentTimer would prevent another comment from hiding.
		if (props.doNotHideCommentTimer)
			clearTimeout(props.doNotHideCommentTimer);
		props.doNotHideCommentTimer = null;
		commentSection.hideAllComments();

		var targetTab = parseInt(entry.tab);
		if (map._docLayer._selectedPart == targetTab) {
			// Already on the right sheet - navigate immediately.
			this._goToComment(commentSection, commentId);
			return;
		}

		// The comment is on a different sheet. Switch to it and wait for
		// sheetgeometrychanged so the geometry is ready for positioning.

		var safetyTimer = null;
		var self = this;

		function cleanup() {
			clearTimeout(safetyTimer);
			map.off('sheetgeometrychanged', onGeometry);
		}

		function onGeometry() {
			cleanup();
			self._goToComment(commentSection, commentId);
		}

		safetyTimer = setTimeout(function() {
			cleanup();
			self._sendGoToCommentResp(commentId, false, 'Timed out waiting for server');
		}, 10000);

		map.once('sheetgeometrychanged', onGeometry);
		map.setPart(targetTab);
	},

	_goToDrawComment: function(commentSection, commentId) {
		// Draw and Impress share Writer's per-page annotation shape, but comments
		// live on specific parts (slides or pages). If the target is on a different
		// part than the current one, switch parts first so the annotation becomes
		// reachable.
		const comment = commentSection.getComment(commentId)
			|| commentSection.getComment(parseInt(commentId));
		if (!comment) {
			this._sendGoToCommentResp(commentId, false, 'Comment not found');
			return;
		}

		const map = this._map;
		const self = this;

		function finish() {
			// _goToComment -> navigateAndFocusComment -> scrollCommentIntoView
			// scrolls the anchor into view for every docType.
			self._goToComment(commentSection, commentId);
			// Guard the freshly-selected comment against async events that
			// would otherwise cancel it during the settling window. Calc uses
			// this same flag to keep the comment visible across
			// _onSetPartMsg / onNewDocumentTopLeft / onCellAddressChanged;
			// for Draw/Impress on a cross-part navigation, a status-msg-driven
			// 'updateparts' fires right after setPart and would hit
			// onPartChange which cancels selectedComment, and an annotations
			// refresh rebuilds the comment list and drops the selection too.
			const props = commentSection.sectionProperties;
			if (props.doNotHideCommentTimer)
				clearTimeout(props.doNotHideCommentTimer);
			props.doNotHideCommentTimer = setTimeout(function() {
				props.doNotHideCommentTimer = null;
			}, 2000);
		}

		const targetPart = comment.sectionProperties.partIndex;
		if (targetPart < 0 || targetPart === map._docLayer._selectedPart) {
			finish();
			return;
		}

		// Cross-part: setPart triggers an async round-trip with the server.
		// ImpressTileLayer._onSetPartMsg fires 'setpart' after
		// _scrollViewToPartPosition has settled the viewport. Wait for that,
		// then run finish() - the doNotHideCommentTimer set there prevents a
		// later status-msg-driven 'updateparts' from canceling the selection.
		let safetyTimer = null;
		function cleanup() {
			clearTimeout(safetyTimer);
			map.off('setpart', onPart);
		}
		function onPart() {
			cleanup();
			finish();
		}
		safetyTimer = setTimeout(function() {
			cleanup();
			self._sendGoToCommentResp(commentId, false, 'Timed out waiting for server');
		}, 10000);
		map.once('setpart', onPart);
		map.setPart(targetPart);
	},

	_sendGoToCommentResp: function(commentId, success, errorMsg) {
		var args = { Id: String(commentId), success: success };
		if (errorMsg)
			args.errorMsg = errorMsg;
		this._map.fire('postMessage', {
			msgId: 'Action_GoToComment_Resp',
			args: args
		});
	},

	// ── Save-response routing (see ~/.cache/voffice-evidence/save-contract.md)
	//
	// One host Action_Save produces up to TWO wire verdicts: the kit (jail)
	// ack — Control.Toolbar's .uno:Save commandresult, which fires the moment
	// core wrote the child-process jail file, BEFORE coolwsd uploads to WOPI
	// storage — and the storage-upload verdict (Socket.ts tags those
	// Phase:'storage': broadcastSaveResult commandresults, error: cmd=storage
	// frames, and the lastmodtime:-derived upload-success signal). The old
	// funnel consumed its single notify slot on the FIRST Resp, so the host
	// rendered "Saved" on the jail ack and the actual persistence verdict was
	// structurally dropped. This queue forwards both, stamped with the
	// originating request's Nonce and Phase/Final markers; hosts that predate
	// the markers resolve on the first Resp exactly as before.

	// Entries older than this forward nothing (the host's own save timeout is
	// at most 20s; a leftover entry is a save whose verdicts will never come,
	// e.g. wsd's silent manualSave refusal while a save is active).
	_pendingSaveTTLMs: 90 * 1000,

	_pushPendingSave: function(kind, values, client) {
		values = values || {};
		this._pendingSaves.push({
			kind: kind,
			nonce: values['Nonce'] || null,
			notify: !!values['Notify'],
			// The editor's own save (clientSave): never answers the host.
			client: !!client,
			coreAcked: false,
			born: Date.now()
		});
	},

	// ── The page canvas's own autosave vs the host's saves ──────────────
	//
	// VulcanCanvasAutosave saves a PDF page canvas a few seconds after an
	// edit. Its verdicts come back on the same wire as a host save's, with
	// no nonce, and _routeSaveResp answers the OLDEST pending entry — so
	// without an entry of its own, this happened:
	//
	//   t0     autosave: map.save()               (no pending entry)
	//   t0+.5  host: Action_Save → entry E pushed, map.save()
	//   t0+.6  kit ack for the AUTOSAVE           → marks E coreAcked
	//   t0+2   storage verdict for the AUTOSAVE   → resolves E: the host's
	//          "save, then wait" returns on the older upload, and the host's
	//          own verdicts arrive later, unmatched.
	//
	// (wsd also silently refuses a manual save while one is active, so the
	// host's save could be dropped outright.) So the two never overlap: the
	// autosave carries its own entry (client:true, notify:false — its
	// verdicts are consumed and dropped), goes out only when no save is
	// pending, and a host Action_Save that arrives meanwhile is HELD until
	// the autosave's entry leaves the queue — at most _clientSaveHoldMs,
	// after which the autosave is presumed refused and its entry dropped.
	_clientSaveHoldMs: 10 * 1000,
	_heldHostSaves: null,
	_heldHostSaveTimer: null,

	/// The editor's own save. Returns false (nothing sent) while any save is
	/// pending, so the caller re-arms instead of overlapping it.
	clientSave: function(dontTerminateEdit, dontSaveIfUnmodified) {
		// Unembedded, no verdict is ever routed, so an entry would never
		// leave the queue: save plainly.
		if (!this.PostMessageOrigin || window.parent === window.self) {
			this._map.save(dontTerminateEdit, dontSaveIfUnmodified);
			return true;
		}
		this._prunePendingSaves();
		if (this._findPendingSave('save') !== -1 ||
		    (this._heldHostSaves && this._heldHostSaves.length))
			return false;
		this._pushPendingSave('save', { Notify: false }, true);
		this._map.save(dontTerminateEdit, dontSaveIfUnmodified);
		return true;
	},

	_clientSaveInFlight: function() {
		for (var i = 0; i < this._pendingSaves.length; i++)
			if (this._pendingSaves[i].client)
				return true;
		return false;
	},

	_dispatchHostSave: function(hostSave) {
		this._pushPendingSave('save', hostSave.values);
		this._map.save(hostSave.dontTerminateEdit, hostSave.dontSaveIfUnmodified,
			hostSave.extendedData, hostSave.beforeClose);
	},

	_holdHostSave: function(hostSave) {
		if (!this._heldHostSaves)
			this._heldHostSaves = [];
		this._heldHostSaves.push(hostSave);
		if (this._heldHostSaveTimer)
			return;
		var that = this;
		this._heldHostSaveTimer = setTimeout(function() {
			that._heldHostSaveTimer = null;
			// The autosave never answered (refused, or its verdict lost):
			// drop its entry so it cannot eat the host save's verdicts.
			that._pendingSaves = that._pendingSaves.filter(function(entry) {
				return !entry.client;
			});
			that._releaseHeldHostSaves();
		}, this._clientSaveHoldMs);
	},

	/// Dispatch the held host saves once no autosave is in flight.
	_releaseHeldHostSaves: function() {
		if (!this._heldHostSaves || !this._heldHostSaves.length)
			return;
		if (this._clientSaveInFlight())
			return;
		if (this._heldHostSaveTimer) {
			clearTimeout(this._heldHostSaveTimer);
			this._heldHostSaveTimer = null;
		}
		var held = this._heldHostSaves;
		this._heldHostSaves = [];
		for (var i = 0; i < held.length; i++)
			this._dispatchHostSave(held[i]);
	},

	_prunePendingSaves: function() {
		var now = Date.now();
		var ttl = this._pendingSaveTTLMs;
		this._pendingSaves = this._pendingSaves.filter(function(entry) {
			return now - entry.born < ttl;
		});
	},

	// Oldest entry of `kind`; coreAcked (when not undefined) further narrows
	// to entries before/after their kit ack. FIFO matches request order —
	// the host serializes saves.
	_findPendingSave: function(kind, coreAcked) {
		for (var i = 0; i < this._pendingSaves.length; i++) {
			var entry = this._pendingSaves[i];
			if (entry.kind === kind &&
			    (coreAcked === undefined || entry.coreAcked === coreAcked))
				return i;
		}
		return -1;
	},

	// Document-level storage state, fed by every storage verdict (matched or
	// not) and by kit-save failures. This is what makes the Augustus mode
	// (wsd autosave failing with no host save in flight) visible: the host
	// hears App_SaveStorageState even though no Action_Save_Resp is owed.
	// Only upload evidence may set Clean:true — never a jail ack.
	//
	// ASYMMETRIC ON PURPOSE, and it is not a style choice:
	//   Clean:false is a CONDITION. It persists until an upload fixes it, and
	//   the failing-autosave lane repeats every 30s, so it is announced on
	//   entry and coalesced while it holds.
	//   Clean:true is EVIDENCE OF AN EVENT — one upload actually happened —
	//   and every occurrence is announced. The host pill and the host's
	//   persistence watchdog can no longer treat Doc_ModifiedStatus
	//   {Modified:false} as a save success (LEGE-A1: on a Mac a physical
	//   Ctrl+S clears core's modified flag with no wsd save and no upload;
	//   ~/.cache/voffice-evidence/round6/legea1-ctrl-s/verdict.json measured
	//   399s of frozen storage under a "Saved" pill, LIVE ON PROD), so they
	//   corroborate EACH cleared flag against a real upload. Coalescing these
	//   would announce only the FIRST upload of a session and leave autosave
	//   #2 onward uncorroborated — turning every healthy save into a false
	//   "Not saved". That is what `save_storage_every_upload_v1` in
	//   sendVulcanReady's Capabilities promises the host.
	//
	// UNANSWERED: a Clean:false that opens a failure is marked
	// Unanswered:true when the WOPI host never answered the upload
	// (Socket._onSaveUnanswered). wsd sends that save again by itself
	// and the host may already have stored it, so the host keeps its pill on
	// "Saving" for the retry's answer instead of "Not saved". The coalescing
	// is unchanged: the first Clean:false of a failure decides the marking.
	// wsd follows its unanswered frame with a plain "Save failed" verdict for
	// the same upload, and that one must not turn the condition into a
	// failure. That is what `save_storage_unanswered_v1` in sendVulcanReady's
	// Capabilities promises the host.
	_noteStorageState: function(clean, kind, errorMsg, unanswered) {
		clean = !!clean;
		if (!clean && this._storageClean === false)
			return;
		this._storageClean = clean;
		var args = { Clean: clean };
		if (!clean) {
			if (kind)
				args.Kind = kind;
			if (errorMsg)
				args.ErrorMsg = errorMsg;
			if (unanswered)
				args.Unanswered = true;
		}
		this._postMessage({msgId: 'App_SaveStorageState', args: args});
	},

	_stampSaveResp: function(values, entry, terminal, phase) {
		var stamped = {};
		for (var key in values)
			stamped[key] = values[key];
		if (entry && entry.nonce)
			stamped['Nonce'] = entry.nonce;
		stamped['Phase'] = phase;
		stamped['Final'] = !!terminal;
		return stamped;
	},

	// Conflict wire-vocabulary normalization (verify-build2 SV-3/F2). The
	// REAL storage-conflict verdict is NOT `error: cmd=storage
	// kind=documentconflict`: on the rescue (parked/duplicate) lane wsd
	// broadcasts only broadcastSaveResult's commandresult with the human
	// string "Conflict: Document changed in storage" and the WOPI 409 body
	// (double quotes flattened to ') as errorMsg (DocumentBroker.cpp:3883),
	// then a bare `close: documentconflict` — so that string is the only
	// per-save conflict vocabulary on the wire. Every current host keys its
	// banner, fail-all-pending and conflict telemetry on the literal result
	// 'documentconflict' (save-contract.md §2): normalize here, and hoist
	// the parked-copy name out of the 409 body so the host can name the
	// rescue file (parkedCopyNameFromSaveResp reads Values, not errorMsg).
	_normalizeSaveResp: function(values) {
		if (values['result'] === 'documentconflict')
			return values;
		var errorMsg = typeof values['errorMsg'] === 'string' ? values['errorMsg'] : '';
		var isConflict = values['success'] !== true &&
			(values['result'] === 'Conflict: Document changed in storage' ||
			 /'COOLStatusCode'\s*:\s*1010\b/.test(errorMsg));
		if (!isConflict)
			return values;
		var normalized = {};
		for (var key in values)
			normalized[key] = values[key];
		normalized['result'] = 'documentconflict';
		if (!normalized['cmd'])
			normalized['cmd'] = 'storage';
		// The name is the 409 body's last field (contents route
		// conflictResponse) and file names may themselves contain quotes, so
		// match greedily to the body's closing brace; absent or unparseable
		// means the host words its notice generically — never fabricate.
		var nameMatch = errorMsg.match(/'vulcanConflictParkedCopyName':'(.*)'\s*\}\s*$/);
		if (nameMatch && nameMatch[1])
			normalized['vulcanConflictParkedCopyName'] = nameMatch[1];
		return normalized;
	},

	// Returns the stamped Values to post, or null to drop the Resp.
	_routeSaveResp: function(values) {
		this._prunePendingSaves();
		values = this._normalizeSaveResp(values);
		var result = values['result'];
		var phase = values['Phase'];
		var cmd = values['cmd'];
		var success = values['success'] === true;
		var idx, entry;

		// Export/SaveAs lane: one terminal verdict per request.
		if (result === 'exportas' || cmd === 'exportas' ||
		    cmd === 'saveas' || cmd === 'downloadas') {
			idx = this._findPendingSave('export');
			if (idx === -1)
				return null;
			entry = this._pendingSaves.splice(idx, 1)[0];
			return entry.notify ?
				this._stampSaveResp(values, entry, true, phase || 'storage') : null;
		}

		// Storage-upload verdicts (tagged by Socket.ts): terminal.
		if (phase === 'storage') {
			this._noteStorageState(success, result, values['errorMsg'],
				values['vulcanUnanswered'] === true);
			if (result === 'documentconflict') {
				// Document-level: every pending save against this document
				// is doomed (the host fails them all on this verdict), so
				// consume them all; forward once, stamped with the oldest
				// entry's nonce.
				idx = this._findPendingSave('save', true);
				if (idx === -1)
					idx = this._findPendingSave('save');
				if (idx === -1)
					return null;
				entry = this._pendingSaves[idx];
				this._pendingSaves = this._pendingSaves.filter(function(en) {
					return en.kind !== 'save';
				});
				return entry.notify ?
					this._stampSaveResp(values, entry, true, 'storage') : null;
			}
			idx = this._findPendingSave('save', true);
			if (idx === -1)
				return null; // unmatched (e.g. autosave verdict): state noted above.
			entry = this._pendingSaves.splice(idx, 1)[0];
			return entry.notify ?
				this._stampSaveResp(values, entry, true, 'storage') : null;
		}

		// Kit (jail) verdict: untagged (Control.Toolbar's .uno:Save
		// commandresult) or Phase:'core' (Socket's error: cmd=save routing).
		var coreFailure = !success && result !== 'unmodified';
		if (coreFailure)
			this._noteStorageState(false, result || 'savefailed', values['errorMsg']);
		idx = this._findPendingSave('save', false);
		if (idx === -1)
			return null; // in-frame/autosave ack: no host request to answer.
		entry = this._pendingSaves[idx];
		// Terminal when no storage verdict can follow: a kit failure means
		// these bytes will never be uploaded, and an 'unmodified' shortcut
		// with storage not known-dirty means there is nothing left to upload
		// (when storage IS dirty, wsd retries the pending upload on every
		// save, so the storage verdict is still owed).
		var terminal = coreFailure ||
			(result === 'unmodified' && this._storageClean !== false);
		if (terminal)
			this._pendingSaves.splice(idx, 1);
		else
			entry.coreAcked = true;
		return entry.notify ?
			this._stampSaveResp(values, entry, terminal, 'core') : null;
	},

	_postMessage: function(e) {
		if (!this.enabled) { return; }
		var msgId = e.msgId;
		var values = e.args || {};
		if (!!this.PostMessageOrigin && window.parent !== window.self) {
			// Correlate save responses to their requests; drop the unwanted.
			if (msgId === 'Action_Save_Resp') {
				values = this._routeSaveResp(values);
				// An autosave verdict may have just emptied the queue of its
				// entry: a host save held behind it goes out now.
				this._releaseHeldHostSaves();
				if (!values)
					return;
			}

			var msg = {
				'MessageId': msgId,
				'SendTime': Date.now(),
				'Values': values
			};
			window.parent.postMessage(JSON.stringify(msg), this.PostMessageOrigin);
		}
	},

	_postViewsMessage: function(messageId) {
		var getMembersRespVal = [];
		for (var viewInfoIdx in this._map._viewInfo) {
			getMembersRespVal.push({
				ViewId: viewInfoIdx,
				UserName: this._map._viewInfo[viewInfoIdx].username,
				UserId: this._map._viewInfo[viewInfoIdx].userid,
				UserExtraInfo: this._map._viewInfo[viewInfoIdx].userextrainfo,
				Color: this._map._viewInfo[viewInfoIdx].color,
				ReadOnly: this._map._viewInfo[viewInfoIdx].readonly,
				IsCurrentView: this._map._docLayer._viewId === parseInt(viewInfoIdx, 10)
			});
		}

		this._postMessage({msgId: messageId, args: getMembersRespVal});
	}
});

// This handler would only get 'enabled' by map if map.options.wopi = true
window.L.Map.addInitHook('addHandler', 'wopi', window.L.Map.WOPI);
