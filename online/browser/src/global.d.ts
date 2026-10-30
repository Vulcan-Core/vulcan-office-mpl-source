/* -*- tab-width: 4 -*- */
/*
 * Copyright the Collabora Online contributors.
 *
 * SPDX-License-Identifier: MPL-2.0
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

// TypeScript declarations for the global scope (e.g., window, document, etc.)

interface DocumentMetadata {
	modifiedBy: string;
	modificationDate: string;
}

interface CompareDocumentsMetadata {
	otherDocument: DocumentMetadata;
	thisDocument: DocumentMetadata;
}

interface CompareDocumentProperties {
	metadata: CompareDocumentsMetadata;
}

interface COOLTouch {
	isTouchEvent: (e: Event | HammerInput) => boolean;
	touchOnly: <F extends (e: Event | HammerInput) => void>(
		f: F,
	) => (e: Event | HammerInput) => ReturnType<F> | undefined;
	mouseOnly: <F extends (e: Event | HammerInput) => void>(
		f: F,
	) => (e: Event | HammerInput) => ReturnType<F> | undefined;
	hasPrimaryTouchscreen: () => boolean;
	hasAnyTouchscreen: () => boolean;
	lastEventWasTouch: boolean | null;
	lastEventTime: Date | null;
	currentlyUsingTouchscreen: () => boolean;
}

interface Window {
	touch: COOLTouch;
	setLogging(value: boolean): void;
	postMobileMessage(msg: string): void;
	// Pixel side length of one document tile.
	tileSize: number;
}

/*
// Extend the JSDialog namespace
declare namespace JSDialog {
    class StatusBar {
        constructor();
        show(text: string, timeout?: number): void;
        hide(): void;
        setText(text: string): void;
        showProgress(text: string, progress: number): void;
        hideProgress(): void;
    }
}

// Extend the global L namespace
declare namespace L {
    class Map {
        constructor(element: string | HTMLElement, options?: any);
        setView(center: [number, number], zoom: number): this;
        addLayer(layer: any): this;
        removeLayer(layer: any): this;
        fire(type: string, data?: any, propagate?: boolean): this;
        on(type: string, fn: (event: any) => void, context?: any): this;
        off(type: string, fn?: (event: any) => void, context?: any): this;
        once(type: string, fn: (event: any) => void, context?: any): this;
        hasEventListeners(type: string): boolean;
        addEventListener(type: string, fn: (event: any) => void, context?: any): this;
        removeEventListener(type: string, fn?: (event: any) => void, context?: any): this;
        eachLayer(fn: (layer: any) => void, context?: any): this;
        invalidateSize(options?: boolean, oldSize?: any): this;
        getBounds(): any; // Replace 'any' with the appropriate type if known
        getZoom(): number;
        getCenter(): [number, number];
        fitBounds(bounds: any, options?: any): this; // Replace 'any' with the appropriate type if known
        panTo(center: [number, number]): this;
        zoomIn(delta?: number, options?: any): this;
        zoomOut(delta?: number, options?: any): this;

        statusBar: JSDialog.StatusBar
    }

    class Control {
        protected _map: window.L.Map; // Expose _map as a protected property

        constructor(options?: any);
        addTo(map: window.L.Map): this;
        remove(): this;
        // Add other methods and properties as needed
        getPosition(): string;
        setPosition(position: string): this;
        getContainer(): HTMLElement | undefined;
        onAdd(map: window.L.Map): HTMLElement;
        onRemove(map: window.L.Map): void;

            // Properties
            options: any; // Replace 'any' with the appropriate type if known
            _container: HTMLElement | undefined;
            _position: string;

            // Methods
            addControl(control: window.L.Control): this;
            removeControl(control: window.L.Control): this;
            getContainer(): HTMLElement | undefined;
            setContainer(container: HTMLElement): void;
            getOptions(): any;
            setOptions(options: any): void;
            getMap(): window.L.Map | undefined;
            setMap(map: window.L.Map): void;
            menubar(): void; // Add menubar functionality if applicable

        static extend(props: any): any;
    }

    const control: Control;
    const map: window.L.Map;
}
*/

interface AppInterface {
	sectionContainer: CanvasSectionContainer;
	LOUtil: typeof LOUtil;
	socket: Socket;
	setPermission: (permission: string) => void;
	util: typeof Util;
	CSections: any;
	activeDocument: null | DocumentBase;
	definitions: any;
	dpiScale: number;
	canvasSize: null | cool.SimplePoint;
	viewId: null | number;
	isAdminUser: null | boolean;
	UNOModifier: { SHIFT: number; CTRL: number; ALT: number; CTRLMAC: number };
	JSButtons: {
		left: number;
		middle: number;
		right: number;
	};
	LOButtons: {
		left: number;
		middle: number;
		right: number;
	};
	calc: {
		maxColumnCount: number;
		maxRowCount: number;
		cellAddress: null | cool.SimplePoint;
		cellCursorVisible: boolean;
		cellCursorRectangle: null | cool.SimpleRectangle;
		decimalSeparator: null | string; // Current cell's decimal separator.
		otherCellCursors: any;
		splitCoordinate: null | cool.SimplePoint;
		partHashes: null | Array<any>; // hashes used to distinguish parts (we use sheet name)
		autoFilterCell: any; // The cell of the current autofilter popup.
		pivotTableFilterCell: any; // The cell of the current pivot table filter popup.
		isRTL(): boolean;
		isSelectedPartSheetView(): boolean;
	};
	impress: {
		partList: any; // Info for parts.
		notesMode: boolean;
		savedViewMode: string | null; // 'normal' | 'notes' | 'master' | null
		twipsCorrection: number;
		getIndexFromSlideHash(hash: number): number;
		isSlideHidden(partNo: number): boolean;
		areAllSlidesHidden(): boolean;
	};
	writer: {
		compareDocumentProperties: CompareDocumentProperties | null;
		compareDocumentOldFileName: string | null;
		savedViewMode: string | null; // 'multipage' | 'normal' | null
	};
	IconUtil: typeof IconUtil;
	Evented: typeof Evented;
	Log: Logger;
	DebugManager: typeof DebugManager;
	dispatcher: any;
	layoutingService: any;
	serverConnectionService: any;
	// Fork-side metadata-only telemetry batcher (src/app/VulcanTelemetry.ts);
	// posts Vulcan_Telemetry batches to the host application over postMessage.
	telemetry: any;
	// Fork-side session-replay forwarder (src/app/VulcanReplay.ts); runs the
	// bundled rrweb recorder in cross-origin child mode so the host page's
	// PostHog replay can see inside the editor frame. Armed by vulcanReplay=1.
	replay: any;
	// Fork-side Calc agent bridge (src/app/VulcanCalcBridge.ts); answers the
	// host's nonce-acked spreadsheet round-trips (capability calc_bridge_v1).
	calcBridge: any;
	// Fork-side Writer agent bridge (src/app/VulcanWriterBridge.ts);
	// tracked-changes document round-trips (capability writer_bridge_v1).
	writerBridge: any;
	// Fork-side Impress agent bridge (src/app/VulcanImpressBridge.ts);
	// deck inventory + FillApi slide round-trips (capability impress_bridge_v1).
	impressBridge: any;
	// Fork-side selection-based Writer/Impress bridge (src/app/VulcanDocBridge.ts);
	// the doctype bridges delegate Vulcan_* verbs they don't own to it. It
	// advertises no capability of its own (the doctype bridges are the sole
	// Vulcan_Ready.Capabilities advertisers).
	docBridge: any;
	// Fork-side Writer web-view reflow controller
	// (src/app/VulcanWriterReflow.ts): states the browse-mode reflow width to
	// the engine in twips and owns the phone View row's toggle + zoom restore.
	writerReflow: any;
	// Fork-side phone caret reveal (src/app/VulcanCaretReveal.ts): scrolls the
	// line you are typing on clear of the soft keyboard when the visible band
	// shrinks.
	caretReveal: any;
	// Fork-side phone READ immersion (src/app/VulcanReadImmersion.ts): the
	// scroll-direction chrome posture and the scrubber's visibility. Owned and
	// constructed by ScrollSection (which feeds it from doMove); published here
	// so Control.UIManager's posture stamp can force the chrome back when the
	// document leaves read mode without waiting for a scroll.
	readImmersion: any;
	// CheckFileInfo-derived WOPI props cache + idempotent subscription
	// (installed by Map.WOPI initialize/_setWopiProps): cb fires immediately
	// when the props already arrived, and on every arrival/refresh.
	wopiProps: any;
	onWopiProps: (cb: (wopiInfo: any) => void) => void;
	_wopiPropsSubscribers: Array<(wopiInfo: any) => void>;
	timerRegistry: any;
	twipsToPixels: number;
	pixelsToTwips: number;
	accessibilityState: boolean;
	UI: {
		language: {
			fromURL: string;
			fromBrowser: string;
			notebookbarAccessibility: any;
		};
		notebookbarAccessibility: any;
		compactViewAccessibility: any;
		horizontalRuler: HRuler | null;
		verticalRuler: VRuler | null;
	};
	colorPalettes: any; // TODO declare according to Widget.ColorPicker.ts
	colorNames: any; // TODO declare according to Widget.ColorPicker.ts
	console: Console;
	map: MapInterface; // TODO should be window.L.Map
	// file defined in: src/docstate.ts
	file: {
		editComment: boolean;
		allowManageRedlines: boolean;
		readOnly: boolean;
		modified: boolean;
		permission: string;
		viewModeExtensions: string;
		disableSidebar: boolean;
		textCursor: {
			visible: boolean;
			rectangle: null | cool.SimpleRectangle;
		};
		fileBasedView: boolean;
		writer: {
			pageRectangleList: Array<any>;
		};
		exportFormats: Array<any>;
	};
	roundedDpiScale: number;
	following: {
		mode: string;
		viewId: number;
	};
	tile: {
		size: null | cool.SimplePoint;
	};
	languages: Array<{ translated: string; neutral: string; iso: string }>;
	favouriteLanguages: Array<string>;
	tableStyles: TableStylesService;
	colorLastSelection: any;
	serverAudit: any;
	events: DocEvents;
	showNavigator: boolean;

	// Below are only used for Cypress tests
	allDialogs?: string[];
	a11yValidator?: A11yValidator;
	A11yValidatorException?: typeof A11yValidatorException;
	serverInfo: ServerInfo;
	[key: string]: any; // other properties as needed
}

// Add the app declaration
declare const app: AppInterface;

// Extend the global Document interface
interface Document {
	mozFullscreenElement: Element | null;
	msFullscreenElement: Element | null;
	webkitFullscreenElement: Element | null;
}

// Extend StringConstructor
interface StringConstructor {
	locale: string; // from cool-src.js
}

// Common interface of all types of sockets created by createWebSocket().
interface SockInterface {
	onclose: (event: CloseEvent) => void;
	onerror: (event: Event) => void;
	onmessage: (event: MessageEvent) => void;
	onopen: (event: Event) => void;
	close: (code?: number, reason?: string) => void;
	send: (data: MessageInterface) => void;
	setUnloading?: () => void;

	readyState: 0 | 1 | 2 | 3;
	binaryType: 'blob' | 'arraybuffer';
}

interface ServerInfo {
	coolwsdVersion: string;
	coolwsdHash: string;
	serverId: string;
	osInfo: string;
	wsdOptions: any;
}

interface ErrorMessages {
	diskfull: string;
	emptyhosturl: string;
	limitreached: string;
	infoandsupport: string;
	limitreachedprod: string;
	serviceunavailable: string;
	unauthorized: string;
	verificationerror: string;
	wrongwopisrc: string;
	sessionexpiry: string;
	sessionexpired: string;
	faileddocloading: string;
	invalidLink: string;
	leavind: string;
	docloadtimeout: string;
	docunloadingretry: string;
	docunloadinggiveup: string;
	clusterconfiguration: string;
	websocketproxyfailure: string;
	websocketgenericfailure: string;

	storage: {
		loadfailed: string;
		savediskfull: string;
		savetoolarge: string;
		saveunauthorized: string;
		savefailed: string;
		renamefailed: string;
		saveasfailed?: string;
	};

	uploadfile: {
		notfound: string;
		toolarge: string;
	};
}

// Accessibility validator interface for Cypress tests
interface A11yValidator {
	checkWidget(type: string, element: HTMLElement): void;
}

// Extend the global Window interface
// Defined in: js/global.js
interface Window {
	// app defined in: js/bundle.js
	app: AppInterface;
	// The real window.open, stashed before the mobile/desktop app redirects
	// window.open to its own handler. Used to open real slideshow and
	// presenter console windows. Defined in js/global.js.
	origOpen?: typeof window.open;
	// Vulcan Office: the trimmed phone slide-layout set, shared by the
	// Impress filmstrip '+' tile and the phone kebab's Slide ▸ Change layout
	// so the two cannot drift. Defined in src/control/Control.MobileSlide.js.
	getVulcanSlideLayouts(): Array<{
		layout: number;
		img: string;
		text: string;
	}>;
	// Vulcan Office: phone Calc's two Return verbs (quick entry advances,
	// in-cell edit mode inserts a newline). Optional because the mocha
	// extraction rigs run door sites without it. Defined in
	// src/app/VulcanCalcReturnKey.ts.
	VulcanCalcReturnKey?: {
		enterCellEditDoor(): void;
		clear(): void;
		returnInsertsNewline(): boolean;
		newlineUnoKeyCode(): number;
		noteCommitReturn(): void;
		noteTyping(): void;
		commitReturnPending(): boolean;
	};
	// coolParams defined in: js/global.js
	coolParams: {
		p: URLSearchParams;

		get(name: string): string;
	};
	mode: {
		isSmallScreenDevice(): boolean;
		isDesktop(): boolean;
		isTablet(): boolean;
		isCODesktop(): boolean;
		isChromebook(): boolean;
		getDeviceFormFactor(): string;
	};
	prefs: {
		useBrowserSetting: boolean;
		getBoolean(key: string, defaultValue?: boolean): boolean;
		get(key: string, defaultValue?: any): any;
		_initializeBrowserSetting(msg: string): void;
		set(key: string, value: any): void;
		remove(key: string): void;
		setMultiple(prefs: Record<string, string>): void;
		sendPendingBrowserSettingsUpdate(): void;
		canPersist: boolean;
	};
	KeyboardShortcuts: KeyboardShortcuts;

	starterScreen: boolean;
	allowUpdateNotification: boolean;
	autoShowWelcome: boolean;
	bundlejsLoaded: boolean;
	canvasSlideshowEnabled: boolean;
	deeplEnabled: boolean;
	documentSigningEnabled: boolean;
	deviceFormFactor?: string;
	enableAccessibility: boolean;
	enableExperimentalFeatures: boolean;
	enableDebug: boolean;
	simulateError: (name: string) => boolean;
	enableMacrosExecution: boolean;
	enableWelcomeMessage: boolean;
	expectedServerId: string;
	extraExportFormats: string[];
	fullyLoadedAndReady: boolean;
	imgDatas: string[];
	indirectSocket: boolean;
	migrating: boolean;
	mobileMenuWizard: boolean;
	pageMobileWizard: boolean;
	protocolDebug: boolean;
	routeToken: string;
	mobileDialogId?: number;
	sidebarId: number;
	userInterfaceMode: string;
	vulcanPhoneChrome: boolean;
	ThisIsAMobileApp: boolean;
	ThisIsTheAndroidApp: boolean;
	ThisIsTheEmscriptenApp: boolean;
	ThisIsTheiOSApp: boolean;
	ThisIsTheMacOSApp: boolean;
	ThisIsTheQtApp: boolean;
	ThisIsTheWindowsApp: boolean;
	wopiSrc: string;
	zoteroEnabled: boolean;
	accessToken: string;
	accessTokenTTL: string;
	wopiSettingBaseUrl: string;
	socketProxy: boolean;
	langParam: string;
	logoURL?: string;
	MobileAppName: string;
	geolocationSetup: boolean;
	wopiHostId: string;
	vendor: string;
	copyrightYear: string;

	socket: SockInterface;
	errorMessages: ErrorMessages;
	queueMsg: MessageInterface[];

	makeWopiCoolWsUrl(path: string, docUrlParams: string): string;
	makeWsUrlWopiSrc(
		path: string,
		docUrlParams: string,
		suffix?: string,
		wopiSrcParam?: string,
	): string;
	createShapesPanel(shapeType: string, groups?: string[]): HTMLDivElement;
	// Slides' phone shape categories — see Control.Toolbar.js.
	VulcanPhoneShapeGroups: string[];
	initializedUI?: () => void; // initializedUI is an optional function, potentially defined in branding
	setupToolbar(map: any): void; // TODO should be L.Map
	makeWsUrl: (url: string) => string;
	getBorderStyleUNOCommand: (
		a: number,
		b: number,
		c: number,
		d: number,
		e: number,
		f: number,
		g: number,
	) => string;
	L: any;
	createWebSocket(url: string): SockInterface;
	getAccessibilityState(): boolean;
	isAccessibilityStateEffective(): boolean;
	makeClientVisibleArea(): string;
	postMobileDebug(msg: string): void;

	removeAccessKey(text: string): string;
	contextMenuWizard: boolean;
}

// For localization
declare function _(text: string): string;
