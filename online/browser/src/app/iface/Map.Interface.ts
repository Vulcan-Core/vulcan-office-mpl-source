/*
 * Copyright the Collabora Online contributors.
 *
 * SPDX-License-Identifier: MPL-2.0
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

interface ParsedJSONResult {
	[name: string]: any;
}

// One argument of a UNO command as carried over postMessage: the UNO value
// type (e.g. 'string', 'int32', 'boolean') and the value itself.
interface UnoCommandValue {
	type: string;
	value: string | number | boolean;
}

// Arguments for insertCommentInteractive(): the inserted comment's UNO command
// arguments (Text, Author, ...) keyed by argument name, plus the
// InteractiveAnchor flag that asks the browser to let the user pick the anchor
// before the command is dispatched.
interface InteractiveCommentArgs {
	InteractiveAnchor?: boolean;
	[arg: string]: UnoCommandValue | boolean | undefined;
}

interface MapInterface extends Evented {
	_docLayer: DocLayerInterface;
	uiManager: UIManager;
	_textInput: {
		debug(value: boolean): void;
		_isDebugOn: boolean;
		update(): void;
	};
	addressInputField: AddressInputField;

	tabsControl?: {
		openContextMenuForFocusedTab(): void;
	};

	removeLayer(layer: any): void;
	addLayer(layer: any): void;
	setZoom(
		targetZoom: number,
		options: { [key: string]: any } | null,
		animate?: boolean,
	): void;

	stateChangeHandler: {
		getItemValue(unoCmd: string): any;
		setItemValue(unoCmd: string, value: any): void;
	};

	// Returns true when the command was put on the wire, false when a silent
	// gate (read posture off the allowlist, blocking dialog, blocked UI)
	// dropped it. The agent bridges read this; UI callers may ignore it.
	sendUnoCommand(unoCmd: string, json?: any, force?: boolean): boolean;

	getDocType(): 'text' | 'presentation' | 'spreadsheet' | 'drawing';
	isText(): boolean;
	isPresentationOrDrawing(): boolean;

	getDocSize(): cool.Point;
	getSize(): cool.Point;
	getCenter(): InternPointLike;
	getContainer(): Element;
	_getCurrentFontName(): string;

	_docLoadedOnce: boolean;
	_debug: DebugManager;
	_fatal: boolean;
	_docPassword: string;
	_serverLoadTimings?: { [k: string]: number };

	options: {
		timestamp: number;
		doc: string;
		docParams: {
			access_token?: string;
			access_token_ttl?: string;
			no_auth_header?: string;
			permission?: 'edit' | 'readonly' | 'view';
		};
		renderingOptions: string;
		tileWidthTwips: number;
		tileHeightTwips: number;
		wopiSrc: string;
		previousWopiSrc: string;
		zoom: number;
		defaultZoom: number;
		// undefined until a 'lockfailed:' arrives; true while a lock retry is
		// allowed; false once the lock is held (see Permission.js).
		canTryLock?: boolean;
	};

	wopi: {
		resetAppLoaded(): void;
		onRenameFile(newName: string): void;
		DisableInactiveMessages: boolean;
		UserCanNotWriteRelative: boolean;
		IsOwner: boolean;
		BaseFileName: string;
		HideExportOption: boolean;
		DisableAISettings: boolean;
		AIConfigured: boolean;
		AIModelName: string;
		UserCanWrite: boolean;
		HideChangeTrackingControls: boolean;
		EnableRemoteLinkPicker: boolean;
		HideSaveOption: boolean;
	};

	loadDocument(socket?: SockInterface): void;
	getCurrentPartNumber(): number;
	getZoom(): number;
	showBusy(label: string, bar: boolean): void;
	hideBusy(): void;

	_clip: ClipboardInterface;

	setPermission(permission: string): void;
	onLockFailed(reason: string): void;
	updateModificationIndicator(newModificationTime: string): void;
	isEditMode(): boolean;
	isReadOnlyMode(): boolean;
	remove(): MapInterface;

	_setLockProps(lockInfo: ParsedJSONResult): void;
	_setRestrictions(restrictionInfo: ParsedJSONResult): void;
	hideRestrictedItems(it: any, item: any, button: any): void;
	disableLockedItem(it: any, item: any, button: any): void;
	isLockedItem(data: any): boolean;
	openUnlockPopup(cmd: ControlCommand): void;
	isLockedUser(): boolean;
	isRestrictedUser(): boolean;

	focus(acceptInput?: boolean): void;
	editorHasFocus(): boolean;
	// The one global "which window has focus" id; 0 is the document.
	// Map.js:1101 — declared here because callers in .ts need it.
	setWinId(id: number | string): void;

	_fireInitComplete(condition: string): void;
	sendInitUNOCommands(): void;
	initTextInput(docType: string): void;
	saveAs(filenme: string, format?: string, options?: string): void;

	addControl(control: any): void;
	removeControl(control: any): void;

	_shouldStartReadOnly(): boolean;
	_switchToEditMode(): void;

	_permission: 'edit' | 'readonly' | 'view';

	toolbarUpTemplate: any;
	menubar: Menubar;
	userList: UserList;
	sidebar: Sidebar;
	getViewColor(viewId: number): number;

	// TODO fix types:
	jsdialog: any;
	zotero: any;
	_extensions: { [id: string]: any };

	_cacheSVG: string[];
	calcInputBarHasFocus(): boolean;
	hasFocus(): boolean;
	lockAccessibilityOn(): void;
	getPixelBounds(center?: InternPointLike, zoom?: number): cool.Bounds;
	getPixelBoundsCore(center?: InternPointLike, zoom?: number): cool.Bounds;
	_partsDirection: number;
	getZoomScale(toZoom: number, fomZoom?: number): number;
	_docLoaded: boolean;
	contextToolbar?: ContextToolbar;
	getSplitPanesContext(): cool.SplitPanesContext | undefined;
	getScaleZoom(scale: number, fromZoom?: number): number;
	scrollingIsHandled: boolean;
	showComments(on?: boolean): void;
	showResolvedComments(on?: boolean): void;
	navigator: NavigatorPanel;
	setPart(
		part: number | string,
		external?: boolean,
		calledFromSetPartHandler?: boolean,
	): void;
	mouseEventToIntern(e: any): InternPointLike;
	// CSS-pixel document point → intern; pure in (point, zoom), independent
	// of the current view (Map.js). The phone-Impress pinch uses it to hand
	// the map an intern whose projection is a section-world document point.
	unproject(point: cool.Point, zoom?: number): InternPointLike;
	_limitZoom(zoom: number): number;
	setView(
		center: [number, number],
		zoom?: number,
		reset?: boolean,
	): MapInterface;
	isViewReadOnly(viewid: number): boolean;
	scrollHandler: typeof window.L.Map.Scroll;
	context?: { appId: string; context: string };
	eSignature?: cool.ESignature;

	// TODO: Fix type.
	formulabar: any;
	backstageView: any;
	topToolbar: any;
	statusBar: any;

	mobileSearchBar: MobileSearchBar;
	_disableDefaultAction: Record<string, boolean>;
	save(
		dontTerminateEdit: boolean,
		dontSaveIfUnmodified: boolean,
		extendedData?: string,
	): void;
	_everModified: boolean;
	print(options?: string): void;
	openRevisionHistory(): void;
	openShare(): void;
	showHelp(id: string): void;
	openSaveAs(format?: string): void;
	downloadAs(
		name: string,
		format?: string,
		options?: string | null,
		id?: string,
	): void;
	insertComment(): void;
	insertThreadedComment(): void;
	insertCommentInteractive(command: string, args: InteractiveCommentArgs): void;
	zoomIn(delta: number, options?: any, animate?: boolean): MapInterface;
	zoomOut(delta: number, options?: any, animate?: boolean): MapInterface;
	cancelSearch(): void;
	goToPage(page: string | number, options?: { quiet?: boolean }): void;
	serverAuditDialog?: ServerAuditDialog;
	_lockAccessibilityOn: boolean;
	setAccessibilityState(enable: boolean): void;

	// TODO: L.Map.Keyboard
	keyboard: any;

	onFormulaBarBlur(): void;
	onFormulaBarFocus(): void;
	formulabarBlur(): void;
	formulabarFocus(): void;
	/** The ONE phone-Calc cell-edit exit (Toolbar.js). */
	vulcanEndCellEditSession(opts?: { dismissKeyboard?: boolean }): void;
	/**
	 * The two writers of html.vulcan-calc-edit-ready — the phone-Calc
	 * EDIT-READY marker (src/app/VulcanCalcMode.ts). Both live on the same
	 * Toolbar.js map mixin as vulcanEndCellEditSession above, and the marker
	 * is MONOTONE by construction: one adder, one remover, nothing else
	 * touches it. Declared here so call sites read them off MapInterface
	 * instead of casting `app.map as any` — a cast hides a mixin that stops
	 * being loaded.
	 *
	 * 🔴 OPTIONAL, AND MEASURED SO. Both call sites test for the method
	 * before calling it (MouseControl's cell tap, VulcanEscape's editready
	 * rung), and those tests are NOT decoration: the mocha extraction rigs
	 * drive MouseControl.onClick against a hand-built `app.map` that carries
	 * no Toolbar mixin at all, and 15 rows across three suites go red the
	 * moment the guard is removed. A required declaration would type those
	 * guards as dead code and invite exactly that removal, so the type says
	 * what is true of every caller instead.
	 */
	vulcanEnterCalcEditReady?(): void;
	vulcanExitCalcEditReady?(): void;
	formulabarSetDirty(): void;
	_functionWizardData: WidgetJSON;

	insertPage: ((nPos?: number) => void) & { scrollToEnd: boolean };
	deletePage(nPos?: number): void;
	duplicatePage(pos?: number): void;
	slideShowPresenter?: SlideShowPresenter;
	hideSlide(): void;
	showSlide(): void;
	sidebarFromNotebookbar: SidebarFromNotebookbarPanel;
	mobileTopBar?: MobileTopBar;

	// TODO: window.L.control.lokDialog
	dialog: any;
	isAIConfigured?: boolean;
	aiRequestTimeout?: number;
	aiModelName?: string;
	aiEthicalRating?: string;
	// Set when a valid AI provider was just saved from the settings dialog;
	// consumed once isAIConfigured updates to open the AI sidebar.
	_aiJustConfigured?: boolean;

	_controlCorners: Record<string, Node>;
	_contextMenu: ContextMenuControl;
	_saveImageToWopi: boolean;
	tooltip?: any;
}
