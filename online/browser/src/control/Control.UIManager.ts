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

/**
 * Type for the toolbar button configuration.
 */

interface ToolbarButton {
	type: string;
	uno: string;
	id: string;
	img: string;
	hint: string;
	postmessage: boolean;
	command?: string; // Optional because it's added later
	w2icon?: string; // Optional because it's added later
	text?: string; // Optional because it's added later
}

type UIMode = 'classic' | 'notebookbar';

interface UIModeCommand {
	force?: boolean;
	mode: UIMode;
}

// Type of the 'statusindicator' event payload.
interface StatusIndicatorEvent {
	statusType: string;
}

/**
 * UIManager class – initializes UI elements (toolbars, menubar, ruler, etc.) and controls their visibility.
 */
class UIManager extends window.L.Control {
	mobileWizard: any = null;
	documentNameInput: any = null;
	blockedUI: any = false;
	busyPopupTimer: number | null = null;
	customButtons: any[] = []; // added by WOPI InsertButton
	hiddenButtons: { [key: string]: boolean } = {};
	hiddenCommands: { [key: string]: boolean } = {};
	// Hidden Notebookbar tabs.
	hiddenTabs: { [key: string]: boolean } = {};
	permissionViewMode?: PermissionViewMode;
	// Guards the one-time reconciliation of an integrator-forced theme with
	// the server-stored user setting (see reconcileIntegratorThemeOverride).
	private integratorThemeReconciled = false;

	/**
	 * Called when the UIManager control is added to the map.
	 * Initializes UI elements, clones original templates, and sets up event listeners.
	 * @param map - The Leaflet map instance.
	 * @returns A dummy container HTMLElement.
	 */
	onAdd(map: any) {
		this.map = map;
		this.notebookbar = null;
		// Every time the UI mode changes from 'classic' to 'notebookbar'
		// the two below elements will be destroyed.
		// Here we save the original state of the elements, as provided
		// by server, in order to apply to them the same initialization
		// code when activating the 'classic' mode as if the elements are
		// initialized for the first time since the start of the application.
		// It is important to use the same initial structure provided by server
		// in order to keep a single place (server) of initial properties setting.
		this.map.toolbarUpTemplate = $('#toolbar-up')[0].cloneNode(true);
		this.map.mainMenuTemplate = $('#main-menu')[0].cloneNode(true);

		map.on('infobar', this.showInfoBar, this);
		map.on('legacyunoapinotice', this.showLegacyUnoApiSnackbarOnce, this);
		map.on('docloaded', this._onDocLoadedForLegacyUnoApiSnackbar, this);
		app.events.on('updatepermission', this.onUpdatePermission.bind(this));

		if (window.mode.isSmallScreenDevice()) {
			window.addEventListener('popstate', this.onGoBack.bind(this));

			// provide entries in the history we can catch to close the app
			history.pushState({context: 'app-started'}, 'app-started');
			history.pushState({context: 'app-started'}, 'app-started');
		}

		map.on('blockUI', this.blockUI, this);
		map.on('unblockUI', this.unblockUI, this);

		$('#toolbar-wrapper').on('click', (event) => {
			const target = event.target as HTMLElement;
			if (target.parentElement?.id === 'toolbar-up') // checks if clicked on empty part of the toolbar on tabbed view
				this.map.fire('editorgotfocus');
		});

		$('.main-nav').on('click', (event) => {
			const target = event.target as HTMLElement;
			if (target.parentElement?.nodeName === 'NAV' || // checks if clicked on an container of an element
				target.nodeName === 'NAV' || // checks if clicked on navigation bar itself
				target.parentElement?.id === 'document-titlebar') { // checks if clicked on the document titlebar container
				this.map.fire('editorgotfocus');}
		});
		const mainNav = document.querySelector('.main-nav') as HTMLElement;
		mainNav.addEventListener('wheel', function(e: WheelEvent) {
			// The desktop menus scroll in their own track (Control.Menubar).
			const track = this.querySelector('#vulcan-menu-track') as HTMLElement | null;
			const el = track && track.scrollWidth > track.clientWidth ? track : this as HTMLElement;

			// Allow default scroll for Shift + scroll or if not horizontally scrollable
			if (e.shiftKey || el.scrollWidth <= el.clientWidth) return;

			// Scroll horizontally
			el.scrollLeft += e.deltaY;

			// Prevent vertical scroll only within this element
			e.preventDefault();
		  }, { passive: false });
		this.map.on('updateviewslist', this.onUpdateViews, this);

		this.map['stateChangeHandler'].setItemValue('toggledarktheme', 'false');
		this.map['stateChangeHandler'].setItemValue('invertbackground', 'false');
		this.map['stateChangeHandler'].setItemValue('showannotations', 'true');
		// A boolean here marks the Presenter View button as a toggle. The real
		// value is applied per document type in initializeSpecializedUI.
		this.map['stateChangeHandler'].setItemValue('presenterconsole', 'false');

		// View Changes menu: default to Hidden, sync with core state.
		this.map['stateChangeHandler'].setItemValue('viewchanges-hidden', 'true');
		this.map['stateChangeHandler'].setItemValue('viewchanges-inline', 'false');
		this.map['stateChangeHandler'].setItemValue('viewchanges-sidebyside', 'false');
		this.map['stateChangeHandler'].setItemValue('viewchanges', 'false');
		this.map.on('commandstatechanged', (e: any) => {
			if (e.commandName === '.uno:ShowTrackedChanges') {
				const isSideBySide =
					app.activeDocument?.activeLayout?.type === 'ViewLayoutCompareChanges';
				if (isSideBySide) return; // side-by-side mode manages its own state

				const isInline = e.state === 'true';
				this.map['stateChangeHandler'].setItemValue('viewchanges-inline', isInline ? 'true' : 'false');
				this.map['stateChangeHandler'].setItemValue('viewchanges-hidden', isInline ? 'false' : 'true');
				this.map['stateChangeHandler'].setItemValue('viewchanges', isInline ? 'true' : 'false');
			}
		});
		window.addEventListener('browsersettingchanged', () => {
			this.initDarkModeFromSettings();
		});
		// Cross-window live update: desktop windows share one profile, so a dark
		// mode change in another window fires a 'storage' event here. Drop the
		// cached value and re-apply from the (updated) localStorage. This is only
		// wanted on the desktop, where every window is the same user. In a browser
		// two tabs share localStorage but are independent views (often different
		// collaborating users), so syncing here would flip the other user's theme.
		if (window.mode.isCODesktop()) {
			window.addEventListener('storage', (e) => {
				if (e.key !== 'darkTheme') return;
				delete (window.prefs as any)._localStorageCache['darkTheme'];
				this.initDarkModeFromSettings();
				if (!window.starterScreen)
					this.refreshUIAfterThemeChange();
			});
		}
	}

	// UI initialization

	/**
	 * Shows a tooltip attached to an element and auto-hides it after a timeout.
	 */
	showTimedTooltip(element: HTMLElement, text: string, timeMs: number): void {
		if (!element || !this.map.tooltip)
			return;

		this.map.tooltip.show(element, text);
		clearTimeout(this.map._timedTooltipTimeout);
		this.map._timedTooltipTimeout = setTimeout(() => {
			if (this.map.tooltip && this.map.tooltip._current === element) {
				this.map.tooltip.hide();
			}
		}, timeMs);
	}

	/**
	 * Shows a timed tooltip on an element and optionally plays the attention animation.
	 */
	showAttention(element: HTMLElement, text: string, animate: boolean, timeMs: number = 3000): void {
		this.showTimedTooltip(element, text, timeMs);

		if (animate && !element.classList.contains('attention')) {
			element.classList.add('attention');
			element.addEventListener('animationend', function () {
				element.classList.remove('attention');
			}, { once: true });
		}
	}

	/**
	 * Shows a timed tooltip on the view mode button and optionally plays the attention animation.
	 */
	showViewModeAttention(): void {
		const permissionMode = this.permissionViewMode;
		const viewModeBtn = permissionMode && (permissionMode.viewModeDropdown || permissionMode.viewModeContainer);
		if (viewModeBtn) {
			this.showAttention(viewModeBtn, _('You are currently in View mode'), true, 5000);
		}
	}

	/**
	 * Returns the current UI mode ("notebookbar" or "classic").
	 */
	getCurrentMode(): UIMode {
		// no notebookbar on mobile
		if (window.mode.isSmallScreenDevice())
			return 'classic';

		return this.shouldUseNotebookbarMode() ? 'notebookbar' : 'classic';
	}

	/**
	 * Returns if the highlight of column/row is enabled.
	 */
	getHighlightMode(): boolean {
		return window.prefs.getBoolean('ColumnRowHighlightEnabled', false);
	}

	/**
	 * Changes status of the highlight of column/row is enabled.
	 */
	setHighlightMode(newState: boolean): void {
		window.prefs.set('ColumnRowHighlightEnabled', newState);
		const highlightState = newState? 'true' : 'false';
		this.map['stateChangeHandler'].setItemValue('columnrowhighlight', highlightState);
		this._map.fire('commandstatechanged', {commandName : 'columnrowhighlight', state : highlightState});
	}

	/**
	 * Determines whether to use notebookbar mode based on user preferences.
	 */
	shouldUseNotebookbarMode(): boolean {
		const forceCompact = window.prefs.get('compactMode', null); // getBoolean() does not accept null as the default value
		// all other cases should default to notebookbar
		const shouldUseClassic = (window.userInterfaceMode === 'classic' && forceCompact == null) || forceCompact === 'true';
		return !shouldUseClassic;
	}

	// Dark mode toggle

	/**
	 * Switches the UI to light mode.
	 */
	loadLightMode(): void {
		document.documentElement.setAttribute('data-theme','light');
		this._map.fire('commandstatechanged', {commandName : 'toggledarktheme', state : 'false'});
		this.map.fire('darkmodechanged');
	}

	/**
	 * Switches the UI to dark mode.
	 */
	loadDarkMode(): void {
		document.documentElement.setAttribute('data-theme','dark');
		this._map.fire('commandstatechanged', {commandName : 'toggledarktheme', state : 'true'});
		this.map.fire('darkmodechanged');
	}

	/**
	 * Adjusts the canvas color after a mode change.
	 */
	setCanvasColorAfterModeChange(): void {
		if (app.sectionContainer) {
			app.sectionContainer.setBackgroundColorMode(false);

			if (this.map.getDocType() == 'spreadsheet') {
				app.sectionContainer.setClearColor(window.getComputedStyle(document.documentElement).getPropertyValue('--color-background-document'));
			} else {
				app.sectionContainer.setClearColor(window.getComputedStyle(document.documentElement).getPropertyValue('--color-canvas'));
			}

			//change back to it's default value after setting canvas color
			app.sectionContainer.setBackgroundColorMode(true);
		}
	}

	/**
	 * Sets the document background based on the activation flag.
	 */
	setDarkBackground(activate: boolean): void {
		// The page canvas keeps white paper (see isPageCanvasPaper).
		if (this.isPageCanvasPaper()) activate = false;
		var cmd = { 'NewTheme': { 'type': 'string', 'value': '' } };
		activate ? cmd.NewTheme.value = 'Dark' : cmd.NewTheme.value = 'Light';
		app.socket.sendMessage('uno .uno:InvertBackground ' + JSON.stringify(cmd));
		this.initDarkBackgroundUI(activate);
	}

	/**
	 * Initializes UI changes related to the dark background.
	 */
	initDarkBackgroundUI(activate: boolean): void {
		document.documentElement.setAttribute('data-bg-theme', activate ? 'dark' : 'light');
		if (activate) {
			this._map.fire('commandstatechanged', {commandName : 'invertbackground', state : 'false'});
		}
		else {
			this._map.fire('commandstatechanged', {commandName : 'invertbackground', state : 'true'});
		}
		this.setCanvasColorAfterModeChange();
	}

	/**
	 * Applies background inversion (with an option to skip core changes).
	 */
	applyInvert(skipCore: boolean = false): void {
		// get the initial mode
		var backgroundDark = this.isBackgroundDark() && !this.isPageCanvasPaper();

		if (skipCore) {
			this.initDarkBackgroundUI(backgroundDark);
		} else {
			this.setDarkBackground(backgroundDark);
		}
	}

	/**
	 * Returns whether the document background should be dark.
	 */
	isBackgroundDark(): boolean {
		// get the initial mode If document background is inverted or not
		var inDarkTheme = window.prefs.getBoolean('darkTheme');
		var darkBackgroundPrefName = 'darkBackgroundForTheme.' + (inDarkTheme ? 'dark' : 'light');
		var backgroundDark = window.prefs.getBoolean(darkBackgroundPrefName, inDarkTheme);
		return backgroundDark;
	}

	/**
	 * Toggles the background inversion setting.
	 */
	toggleInvert(): void {
		// get the initial mode
		var inDarkTheme = window.prefs.getBoolean('darkTheme');
		var darkBackgroundPrefName = 'darkBackgroundForTheme.' + (inDarkTheme ? 'dark' : 'light');
		var backgroundDark = window.prefs.getBoolean(darkBackgroundPrefName, inDarkTheme);

		// swap them by invoking the appropriate load function and saving the state
		if (backgroundDark) {
			window.prefs.set(darkBackgroundPrefName, false);
			this.setDarkBackground(false);
		}
		else {
			window.prefs.set(darkBackgroundPrefName, true);
			this.setDarkBackground(true);
		}
	}

	/**
	 * Toggles the overall dark mode setting and refreshes related UI components.
	 */
	toggleDarkMode(): void {
		const inDarkTheme = window.prefs.getBoolean('darkTheme');
		this.applyDarkMode(!inDarkTheme, true);
	}

	/**
	 * Applies the given dark or light mode to the UI, the core document and the
	 * canvas, then refreshes the related UI components.
	 *
	 * When persist is true the choice becomes the saved preference: it is
	 * written to storage and, on the desktop, handed to the native app which
	 * owns dark mode and mirrors it to the other open windows. When persist is
	 * false the rendering changes for this window only - the saved preference
	 * keeps its value and the other windows keep their theme. A presentation
	 * switches to light while it runs and passes false, so showing the slides
	 * neither overwrites the saved choice nor flips the other windows.
	 */
	applyDarkMode(dark: boolean, persist: boolean): void {
		if (persist) {
			window.prefs.set('darkTheme', dark);
		} else {
			// Keep prefs.get('darkTheme') returning the mode the rendering
			// helpers below need, without writing the shared storage that a
			// storage event would carry to the other windows.
			(window.prefs as any)._localStorageCache['darkTheme'] = dark ? 'true' : 'false';
		}

		if (dark)
			this.loadDarkMode();
		else
			this.loadLightMode();
		this.activateDarkModeInCore(dark);

		// On the desktop the native app owns the saved dark-mode setting
		// (persists it and broadcasts it to the other windows).
		if (persist && window.mode.isCODesktop())
			window.postMobileMessage('SETDARKMODE ' + dark);

		this.applyInvert();
		this.setCanvasColorAfterModeChange();
		this.refreshUIAfterThemeChange();
	}

	/**
	 * Reloads the icons and theme-dependent components after a mode change.
	 *
	 * The menubar and toolbar icons are images chosen per theme, so they have
	 * to be reloaded to match the new mode; CSS variables alone do not change
	 * them. A spreadsheet also needs its grid lines redrawn in the new colour.
	 */
	refreshUIAfterThemeChange(): void {
		if (!window.mode.isSmallScreenDevice())
			this.refreshAfterThemeChange();

		// Both app.sectionContainer and app.map._docLayer are absent when a theme
		// is applied very early (the integrator-override reconciliation runs while
		// the document is still loading, before the canvas sections exist). Test
		// the container first so its presence also shields the _docLayer access;
		// the grid section is built later with the already-set theme anyway, so
		// there is nothing to reset here yet.
		if (app.sectionContainer && app.map._docLayer._docType === 'spreadsheet') {
			const calcGridSection = app.sectionContainer.getSectionWithName(app.CSections.CalcGrid.name);
			if (calcGridSection)
				calcGridSection.resetStrokeStyle();
		}

		this.map.fire('themechanged');
	}

	/**
	 * Reconciles an integrator-forced UI theme with the server-stored user theme.
	 *
	 * An integrator can force a theme through ui_defaults (UITheme) together with
	 * SavedUIState=false. SavedUIState=false means "ignore the saved user state,
	 * use the integrator default", so the client honours the integrator theme in
	 * prefs.get(). But the core engine keeps applying the server-stored user
	 * theme through overrideDocOption, which is unaware of SavedUIState. The
	 * document content is then drawn in one theme while the canvas background
	 * uses the other; in Calc this leaves text on default-background cells
	 * unreadable, and it does not fix itself.
	 *
	 * Rather than teach core about SavedUIState, keep a single source of truth:
	 * since SavedUIState=false forbids the saved value from winning anyway, make
	 * the saved value match the integrator default. Persist it exactly as a user
	 * theme toggle would - applyDarkMode stores it on the server (so core's
	 * overrideDocOption now agrees) and pushes it to core live. The rest of the
	 * normal flow then continues unchanged.
	 *
	 * Returns true when it reconciled (and therefore already applied the theme).
	 */
	reconcileIntegratorThemeOverride(): boolean {
		if (this.integratorThemeReconciled || (window as any).savedUIState)
			return false;

		const prefs = window.prefs as any;
		const integratorTheme = prefs._getUIDefault('darkTheme');
		if (integratorTheme === undefined)
			return false;

		// Only act on a genuine divergence. With no stored value the engine
		// already receives the integrator theme through the document load
		// command, so there is nothing to reconcile.
		const storedTheme = prefs._userBrowserSetting['darkTheme'];
		if (storedTheme === undefined || storedTheme === integratorTheme)
			return false;

		this.integratorThemeReconciled = true;
		this.applyDarkMode(integratorTheme === 'true', true);
		return true;
	}

	/**
	 * Initializes dark mode based on user settings.
	 */
	initDarkModeFromSettings(): void {
		// If the integrator forces a theme that the server-stored user setting
		// contradicts, reconcile them first. When that happens applyDarkMode has
		// already applied the theme to the UI and the core engine, so there is
		// nothing left to do here.
		if (this.reconcileIntegratorThemeOverride())
			return;

		var inDarkTheme = window.prefs.getBoolean('darkTheme');

		if (inDarkTheme) {
			this.loadDarkMode();
		} else {
			this.loadLightMode();
		}

		// On the desktop the load-time render option doesn't reliably override the
		// engine's persisted theme, so apply it to the engine here too - but not in
		// the starter screen, which has no document (and no socket) yet.
		const pushToEngine =
			window.mode.isCODesktop() && !(window as any).starterScreen;
		if (pushToEngine)
			this.activateDarkModeInCore(inDarkTheme);
		this.applyInvert(!pushToEngine);
	}

	/**
	 * Informs the core system about the dark mode change.
	 */
	activateDarkModeInCore(activate: boolean): void {
		var cmd = { 'NewTheme': { 'type': 'string', 'value': '' } };
		activate && !this.isPageCanvasPaper() ? cmd.NewTheme.value = 'Dark' : cmd.NewTheme.value = 'Light';
		app.socket.sendMessage('uno .uno:ChangeTheme ' + JSON.stringify(cmd));
	}

	/**
	 * The page canvas (a drawing — how a PDF opens to edit) keeps its paper
	 * white and its ink as the PDF drew it in every theme, like the host's
	 * PDF viewer: a rasterised page is theme-invariant, and a dark core theme
	 * would repaint the page dark and flip automatic text colour to white.
	 * The chrome around it still follows the theme.
	 *
	 * A presentation is the same: each slide paints the background and the
	 * text colours its author chose. A dark core theme repaints none of that
	 * and still recolours the text for a dark ground, so white text on a dark
	 * slide went grey, dark text in a box over a light card went pale on it,
	 * and a chart's dark labels went pale on a white slide.
	 */
	isPageCanvasPaper(): boolean {
		if (!this.map || typeof this.map.getDocType !== 'function') return false;
		const docType = this.map.getDocType();
		return docType === 'drawing' || docType === 'presentation';
	}

	/**
	 * Shows a modal dialog asking to rename document.
	 */
	renameDocument(): void {
		// todo: does this need _('rename document)
		var docNameInput = this.documentNameInput;
		var fileName = this.map['wopi'].BaseFileName ? this.map['wopi'].BaseFileName : '';
		this.showInputModal('rename-modal', _('Rename Document'), _('Enter new name'), fileName, _('Rename'),
			(newName: string) => {
				docNameInput.documentNameConfirm(newName);
		});
	}

	/**
	 * Toggles WASM mode (if applicable).
	 */
	toggleWasm(): void {
		if (window.ThisIsTheEmscriptenApp) {
			//TODO: Should use the "external" socket.
			// app.socket.sendMessage('switch_request online');
		} else {
			app.socket.sendMessage('switch_request offline');
		}

		// Wait for Coolwsd to initiate the switch.
	}

	/**
	 * Setup menubar and the top toolbar.
	 */
	initializeMenubarAndTopToolbar(): void {
		const enableNotebookbar = this.shouldUseNotebookbarMode();
		const isSmallScreenDevice = window.mode.isSmallScreenDevice();
		if (isSmallScreenDevice || !enableNotebookbar) {
			var menubar = new Menubar();
			this.map.menubar = menubar;
			this.map.addControl(menubar);
		}

		if (!isSmallScreenDevice && !enableNotebookbar)
			this.map.topToolbar = JSDialog.TopToolbar(this.map);

		this.permissionViewMode = new PermissionViewMode(this.map);
		this.permissionViewMode.init();

		// Vulcan: the fork chrome carries NO Share button. Three attempts at
		// one lived here and in PermissionMode — insertVulcanClassicShareButton
		// (which could never render: PermissionMode built a hidden #shareas
		// first, so the pill's getElementById guard always early-returned),
		// then PermissionMode's #shareAsContainer pill, then the notebookbar
		// options-section twin. All are removed: sharing is the embedding
		// host's affordance, and a second control in the document chrome was
		// redundant. Do not add another one here. The File-tab ShareAs items,
		// the menubar File > Share... entries and the Backstage tile remain —
		// they dispatch 'shareas' -> UI_Share and are how the host is asked.

		app.UI.compactViewAccessibility.initialize();
	}

	/**
	 * Initializes basic UI components.
	 */
	initializeBasicUI(): void {
		app.console.debug('UIManager: initialize basic UI');

		this.initializeMenubarAndTopToolbar();

		// CS-1: under phone chrome this control is not rendered and not bound
		// — upper-left is the HOST's back at every depth now. The stock phone
		// chrome, tablets and desktop keep it. Bound rather than merely
		// hidden matters: a hidden-but-bound element is still reachable by
		// keyboard and by anything that synthesises a click.
		if (window.mode.isSmallScreenDevice()
			&& !document.documentElement.classList.contains('vulcan-mobile-chrome')) {
			$('#toolbar-mobile-back').on('click', () => {
				// One layer per tap. The phone chrome now keeps this button
				// visible while the kebab is open (Control.Menubar), so it has to
				// unwind the menu FIRST -- otherwise the deepest surface's exit
				// would skip a layer and drop you out of edit mode entirely,
				// which is worse than the hidden button it replaced.
				//
				// The hamburger's class is the authority rather than a global
				// flag: it is toggled at both the open and close sites, so it
				// cannot drift. Closing goes through the same
				// $('#main-menu-state').click() path the wizard's own close uses,
				// so the existing close branch does the teardown and nothing here
				// duplicates it.
				if ($('#toolbar-hamburger').hasClass('menuwizard-opened')) {
					$('#main-menu-state').click();
					return;
				}
				// Notes view is the next layer down, and on Impress it is the
				// one layer with no exit of its own. See exitPhoneNotesView.
				if (this.exitPhoneNotesView())
					return;
				this.enterReadonlyOrClose();
			});
		}

		if (!window.mode.isSmallScreenDevice()) {
			this.map.statusBar = JSDialog.StatusBar(this.map);

			this.map.sidebar = JSDialog.Sidebar(this.map);

			this.map.navigator = JSDialog.NavigatorPanel(this.map);

			this.map.formulaautocomplete = new FormulaAutoCompletePopup(this.map);
			this.map.formulausage = new FormulaUsagePopup(this.map);
			this.map.autofillpreviewtooltip = new AutoFillPreviewTooltip(this.map);
		}

		this.map.jsdialog = window.L.control.jsDialog();
		this.map.addControl(this.map.jsdialog);

		window.setupToolbar(this.map);

		if (!((window as any).mode.isCODesktop())) {
			this.documentNameInput = window.L.control.documentNameInput();
			this.map.addControl(this.documentNameInput);
		}
		this.map.addControl(window.L.control.alertDialog());
		if (window.mode.isSmallScreenDevice()) {
			this.mobileWizard = window.L.control.mobileWizard();
			this.map.addControl(this.mobileWizard);
			// Start mirroring the back ladder to the host. Attaches after the
			// wizard exists because depth() reads its window stack. Self-gated
			// on phone chrome, so a tablet (which reaches this branch only if
			// the host sends stock chrome and the screen is small) still
			// publishes nothing.
			if ((window as any).VulcanEscape)
				(window as any).VulcanEscape.attach(this.map);
		}
		this.map.addControl(window.L.control.languageDialog());
		this.map.dialog = window.L.control.lokDialog();
		this.map.addControl(this.map.dialog);
		this.map.addControl(new ContextMenuControl());
		this.map.userList = window.L.control.userList();
		this.map.addControl(this.map.userList);
		this.map.aboutDialog = JSDialog.aboutDialog(this.map);

		var openBusyPopup = (label: string) => {
			this.busyPopupTimer = window.setTimeout(() => {
				var json = {
					id: 'busypopup',
					jsontype: 'dialog',
					type: 'modalpopup',
					children: [
						{
							id: 'busycontainer',
							type: 'container',
							vertical: 'true',
							children: [
								{id: 'busyspinner', type: 'spinnerimg'},
								{id: 'busylabel', type: 'fixedtext', text: label}
							]
						}
					]
				};
				if (app.socket) {
					var builderCallback = function() { /* Do nothing. */ };
					app.socket._onMessage({textMsg: 'jsdialog: ' + JSON.stringify(json), callback: builderCallback});
				}
			}, 700);
		};

		var fadeoutBusyPopup = () => {
			if (this.busyPopupTimer != null)
				window.clearTimeout(this.busyPopupTimer);
			var json = {
				id: 'busypopup',
				jsontype: 'dialog',
				type: 'modalpopup',
				action: 'fadeout'
			};
			if (app.socket)
				app.socket._onMessage({textMsg: 'jsdialog: ' + JSON.stringify(json)});
		};

		this.map.on('showbusy', (e: any) => {
			fadeoutBusyPopup();
			if (app.telemetry) app.telemetry.noteBusyShown(e.label);
			openBusyPopup(e.label);
		});

		this.map.on('hidebusy', (e: any) => {
			fadeoutBusyPopup();
		});

		app.serverConnectionService.onBasicUI();
	}


	initializeNonInteractiveUI() {
		app.console.debug('UIManager: initialize non-interactive basic UI');

		this.map.jsdialog = window.L.control.jsDialog();
		this.map.addControl(this.map.jsdialog);
		this.map.dialog = window.L.control.lokDialog();
		this.map.addControl(this.map.dialog);

		app.serverConnectionService.onBasicUI();
	}

	initializeBackstageView(): void {
		if (!(window as any).mode.isCODesktop())
			return;

		if (!this.map.backstageView) {
			this.map.backstageView = new window.L.Control.BackstageView(this.map);
			console.log('UIManager: BackstageView created for starter mode');
		}

		console.log('UIManager: Showing BackstageView for starter mode');

		this.initDarkModeFromSettings();

		// Use requestAnimationFrame to ensure DOM is ready
		window.requestAnimationFrame(() => {
			if (this.map.backstageView) {
				this.map.backstageView.show();
			}
		});
	}

	/**
	 * Initializes specialized UI components based on the document type.
	 * @param docType - Document type (e.g. 'spreadsheet', 'presentation', 'text').
	 */
	initializeSpecializedUI(docType: string): void {
		app.console.debug('UIManager: initialize specialized UI for: ' + docType);

		// Writer web-view reflow, and the phone caret reveal.
		//
		// These attach HERE, not in initializeBasicUI, because they are gated
		// on the document type and initializeBasicUI runs BEFORE there is one.
		// main.js calls it during map construction; the doc type only exists
		// once the tile layer is built, which is what calls THIS method
		// (WriterTileLayer.js -> initializeSpecializedUI('text')). Gating on
		// `this.map.getDocType() === 'text'` up there therefore tested a value
		// that was not populated yet, the guard was false on every load, and
		// both controllers stayed permanently unattached.
		//
		// Measured on a real phone viewport before this moved: vulcanPhoneChrome
		// true, isSmallScreenDevice true, docType 'text', app.writerReflow
		// present -- and reflowAttached false, wantsReflow false, lastVoteSent
		// null, ZERO .uno:BrowseWidth frames on the wire. Everything shipped,
		// nothing ran. Use the `docType` PARAMETER here, never a re-read.
		//
		// Reflow: attaching does NOT turn reflow on -- it means that if it IS
		// on, the engine is told a width instead of inferring one. Not gated on
		// screen size: any surface that can reach .uno:BrowseView needs the
		// width stated or it lands on MIN_BROWSE_WIDTH. The controller gates
		// the phone half itself.
		if (docType === 'text') {
			if (app.writerReflow) app.writerReflow.attach(this.map);
		}

		// The page canvas keeps white paper. The kit opens a drawing or a
		// presentation on the Light document theme whatever theme the load
		// asked for (Kit.cpp), because text laid out under the dark theme
		// keeps its recoloured ink after a later push. The chrome's own paper
		// setting was stamped from the theme before the document type was
		// known (Socket.ts, initDarkBackgroundUI), so set it now; the guards
		// in activateDarkModeInCore / setDarkBackground keep the core Light on
		// every later theme change and reconnect.
		if (docType === 'drawing' || docType === 'presentation') {
			this.activateDarkModeInCore(false);
			this.setDarkBackground(false);
		}

		/*
		 * CARET REVEAL: TEXT AND PRESENTATION, NOT SPREADSHEET.
		 *
		 * Calc is excluded for the reason it always was: it raises the keyboard
		 * optimistically at touchdown, before `invalidatecursor` returns, so the
		 * `textCursor.visible` test every reveal in the tree gates on is false
		 * exactly when it is needed. CalcTileLayer._vulcanKeyboardSafeY1 answers
		 * the same question from the anchored CELL instead, and two revealers
		 * would fight.
		 *
		 * PRESENTATION WAS EXCLUDED FOR A REASON THAT DOES NOT HOLD. The note
		 * here used to read "Impress edits inside a shape with its own zoom
		 * lane, so both would be moved twice". Two facts refute it:
		 *
		 *   1. Nothing moved it ONCE. This controller triggers on map 'resize'
		 *      — the container resize that republishes viewedRectangle — and on
		 *      the shipping mobile surface phone Impress's container provably
		 *      never resized for a keyboard: `vulcanApplyBodyHeight` discarded
		 *      the host geometry for this doctype, the iframe box is fixed, and
		 *      an iframe's visualViewport cannot see a keyboard. Attaching it
		 *      before that was fixed would have shipped a controller whose
		 *      trigger could not fire — the same defect this method's header
		 *      records for the two Writer controllers. The css/vulcan-theme.css
		 *      13i.0 keyboard inset is what makes the trigger real; this
		 *      attach and that rule are one change and neither works alone.
		 *   2. The zoom lane does not compete with it. VulcanImpressTextEntry's
		 *      entry zoom goes through Map.setZoom, which anchors on the caret
		 *      rectangle whenever the caret is visible and keeps it at the same
		 *      screen position across the rung change — so a caret this
		 *      controller has already lifted stays lifted through the zoom.
		 *
		 * Gated on the PARAMETER, never a re-read of getDocType(): see the
		 * header above for what that cost the last time.
		 */
		if (docType === 'text' || docType === 'presentation') {
			if (app.caretReveal) app.caretReveal.attach(this.map);
		}

		// Phone Writer always SHOWS tracked changes, and cannot be talked out
		// of it (the Show Changes toggle is absent from the phone kebab).
		//
		// Two reasons, and the second is the load-bearing one.
		//
		// 1. Product: on a phone you are reading someone else's document.
		//    Redlines are the document's CONTENT -- hiding them is a desktop
		//    reviewing posture, not a phone one.
		// 2. Correctness: hide-redlines is a per-VIEW setting, but the DOCX
		//    exporter writes it into the shared file as
		//    <w:revisionView insDel="0" formatting="0">, read from whichever
		//    collaborator's view last took focus (GetCurrentViewShell() is a
		//    bare pointer reassigned in SwView::GotFocus). So one person
		//    hiding changes can write "hide tracked changes" into everyone
		//    else's copy, Word included. Pinning phones to SHOW means a phone
		//    session can only ever write the SAFE value.
		//
		// This does NOT fix the desktop-originated case -- that needs the
		// exporter to read document state instead of the focused view, which
		// is a core patch and its own ticket. This closes the phone half at
		// zero cost and in the fail-safe direction.
		if (
			docType === 'text' &&
			window.mode.isSmallScreenDevice() &&
			document.documentElement.classList.contains('vulcan-mobile-chrome')
		) {
			// ShowTrackedChanges is a TOGGLE, so the state has to be KNOWN
			// before firing or we flip it the wrong way -- and at 'docloaded'
			// it provably is not. The only writer of that cache entry is a
			// core `statechanged:`, parsed in CanvasTileLayer._onMessage;
			// Socket.ts queues every message that arrives before
			// _map._docLayer exists and drains the queue AFTER it fires
			// 'docloaded', and nothing seeds the key (the seeds above cover
			// viewchanges-*, not this). So on a fresh load getItemValue()
			// returns undefined, `!== 'true'` is always true, and the toggle
			// would go out unconditionally and HIDE the redlines -- the
			// inverse of this block, and the exact unsafe value argument 2
			// says a phone must never write.
			//
			// Decide on the first commandstatechanged that carries a state
			// for the command instead: the earliest moment the answer is
			// real. One-shot. If core already has it shown, nothing is sent.
			// If core never sends the state, nothing is sent either and
			// core's own default (Show Changes ON) stands -- inert, not
			// inverted. A statechanged may carry only 'enabled' and no state
			// at all (CanvasTileLayer.js:2276), which is not an answer, so
			// those are skipped rather than treated as "not shown".
			const pinTrackedChangesShown = (e: any) => {
				if (e.commandName !== '.uno:ShowTrackedChanges') return;
				if (e.state === undefined) return;
				this.map.off(
					'commandstatechanged',
					pinTrackedChangesShown,
					this,
				);
				if (e.state !== 'true')
					this.map.sendUnoCommand('.uno:ShowTrackedChanges');
			};
			this.map.on('commandstatechanged', pinTrackedChangesShown, this);
		}

		const startWelcomePresentation = window.coolParams.get('welcome');

		// Return early when we are loading welcome slideshow
		if (startWelcomePresentation) {
			this.map.once('docloaded', () => {
				app.dispatcher.dispatch('presentinwindow');
			});
			this.map.slideShowPresenter = new SlideShow.SlideShowPresenter(
				this.map,
				window.enableAccessibility,
			);
			return;
		}

		var isDesktop = window.mode.isDesktop();
		var currentMode = this.getCurrentMode();
		var enableNotebookbar = currentMode === 'notebookbar' && !app.isReadOnly();

		document.body.setAttribute('data-userInterfaceMode', currentMode);
		document.body.setAttribute('data-docType', docType);

		// EnableShare is CheckFileInfo-derived and can land after this init
		// runs — a direct map.wopi read here raced it (same shape as the
		// Share-pill bug), leaving data-integratorSidebar unset.
		app.onWopiProps((wopiInfo: any) => {
			if (wopiInfo['EnableShare'])
				document.body.setAttribute('data-integratorSidebar', 'true');
		});

		if (window.mode.isSmallScreenDevice()) {
			$('#mobile-edit-button').css('display', 'flex');
			this.map.mobileBottomBar = JSDialog.MobileBottomBar(this.map);
			this.map.mobileTopBar = JSDialog.MobileTopBar(this.map);
			// Start mirroring the top bar's inventory to the host, which draws
			// it in the ONE app bar (SPEC-one-topbar). Attaches after
			// mobileTopBar exists because items() reads its item state. Self-
			// gated on phone chrome, and the row does not collapse until the
			// host acks with Vulcan_TopBarHosted — so a host that never
			// answers leaves this a no-op.
			if ((window as any).VulcanTopBar)
				(window as any).VulcanTopBar.attach(this.map);
			this.map.mobileSearchBar = JSDialog.MobileSearchBar(this.map);
			// Google-style floating selection pill: Writer selections
			// (docs/mobile-redesign/01 §6) and Calc row/column header
			// selections (02 §5 — shown from Control.Header.ts, phone
			// chrome only).
			//
			// BOTH halves of the phone gate, not just the small-screen half we
			// are already inside. Every rule that styles these pills is scoped
			// html.vulcan-mobile-chrome, and `?vulcanChrome=desktop` forces the
			// desktop chrome on ANY device without consulting screen size — so
			// under that param the bar was still CREATED and still given inline
			// display:flex on every selection, while matching no styling at all:
			// an unstyled in-flow row of buttons at the end of
			// #document-container, with no position, width or surface. Building
			// a control whose entire appearance depends on a class that is not
			// present is worse than not building it.
			const vulcanPhoneChrome =
				document.documentElement.classList.contains('vulcan-mobile-chrome');
			if (vulcanPhoneChrome &&
				(docType === 'text' || docType === 'spreadsheet') &&
				(window as any).VulcanMobileSelectionBar)
				this.map.mobileSelectionBar =
					(window as any).VulcanMobileSelectionBar.create(this.map);
			// Google-style Cut/Copy/Paste/Delete popup for Impress/Draw
			// shape and text-box selections (docs/mobile-redesign/03 §3).
			else if (
				vulcanPhoneChrome &&
				(docType === 'presentation' || docType === 'drawing') &&
				(window as any).VulcanImpressSelectionBar
			)
				this.map.mobileSelectionBar =
					(window as any).VulcanImpressSelectionBar.create(this.map);

			// Per-change Accept/Reject over the tapped redline (VulcanRedlineBar).
			//
			// Constructed HERE, alongside the selection pill and behind the
			// same phone-chrome gate, because this is the one initializer that
			// runs with a document type in hand: main.js calls
			// initializeBasicUI during map construction, before there is one,
			// and the tile layer calls THIS (WriterTileLayer.js:35) once there
			// is. Both phone Writer controllers were gated on getDocType() up
			// there and never attached at all; that is not a mistake to repeat
			// on a third.
			//
			// Constructing IS attaching for this control: the constructor is
			// what subscribes to 'commandstatechanged', which is the only
			// signal it has. Writer alone -- Calc and Impress have no redlines
			// and .uno:TrackedChangeIndex is a Writer payload.
			if (
				vulcanPhoneChrome &&
				docType === 'text' &&
				(window as any).VulcanRedlineBar
			)
				this.map.redlineBar = (window as any).VulcanRedlineBar.create(
					this.map,
				);
		} else {
			this.createNotebookbarControl(docType, enableNotebookbar);
			// makeSpaceForNotebookbar call in onUpdatePermission
		}

		if ((window as any).mode.isCODesktop()) {
			if (!this.map.backstageView) {
				this.map.backstageView = new window.L.Control.BackstageView(this.map);
				console.log('UIManager: BackstageView created and attached to map');
			} else {
				console.log('UIManager: BackstageView already exists');
			}
		} else {
			console.log('UIManager: Not a CODA app, skipping backstage view initialization');
		}

		if (!window.prefs.getBoolean(`${docType}.ShowToolbar`, true)) {
			this.collapseNotebookbar();
		}

		this.initDarkModeFromSettings();

		if (docType === 'presentation')
			this.syncPresenterConsoleToggle(this.shouldShowPresenterConsole());

		if (docType === 'spreadsheet') {
			this.sheetsBar = JSDialog.SheetsBar(this.map, isDesktop || window.mode.isTablet());

			// Desktop Calc on short / narrow panes: single-line
			// toolbar, ⋯ More, one bottom bar. Self-gated on desktop chrome.
			if ((window as any).VulcanCalcDesktopChrome)
				(window as any).VulcanCalcDesktopChrome.attach(this.map);

			const formulabarRow = document.getElementById('formulabar-row');
			const spreadsheetToolbar = document.getElementById('spreadsheet-toolbar');
			spreadsheetToolbar?.classList?.remove('hidden');
			formulabarRow?.classList?.remove('hidden');

			// Google-Sheets phone chrome (docs/mobile-redesign/02 §2): dock
			// the formula bar at the BOTTOM, directly above the soft keyboard
			// — the key mobile inversion vs desktop. Re-parent #formulabar-row
			// out of the top chrome to just before the sheet-tab strip (same
			// one-time re-parent precedent as ImpressTileLayer's
			// _putPCWOutsideFlex); global.js sizes <body> to the space the
			// keyboard leaves, so in-flow bottom rows ride above it. That
			// height comes from the host's Vulcan_HostKeyboard message when
			// there is one — embedded in a cross-origin iframe this frame's
			// own visualViewport never sees the keyboard at all — and from
			// visualViewport when the fork stands alone. Styling: vulcan-theme.css
			// §13-CALC. Phone chrome only — stock/tablet/desktop keep the
			// top placement.
			if (window.mode.isSmallScreenDevice() &&
				document.documentElement.classList.contains('vulcan-mobile-chrome') &&
				formulabarRow && spreadsheetToolbar && spreadsheetToolbar.parentNode)
				spreadsheetToolbar.parentNode.insertBefore(formulabarRow, spreadsheetToolbar);

			// Operator strip (docs/mobile-redesign/02 §2): sits below the
			// bottom-docked formula bar and above the keyboard so formula
			// symbols never require paging the soft keyboard. Its own element,
			// NOT inside #formulabar — createFormulabar() calls
			// replaceChildren() on that container. Visibility is CSS-only off
			// html.vulcan-formula-editing (§13-CALC.5), so there is nothing to
			// wire up here beyond construction.
			if (window.mode.isSmallScreenDevice() &&
				document.documentElement.classList.contains('vulcan-mobile-chrome') &&
				spreadsheetToolbar && spreadsheetToolbar.parentNode &&
				(window as any).VulcanCalcOperatorStrip)
				this.map.calcOperatorStrip =
					(window as any).VulcanCalcOperatorStrip.create(this.map);

			// The live aggregate readout (G33, EX-14): with a RANGE selected
			// and the keyboard down, Google Sheets phone puts SUM/AVG/MAX in
			// the formula-bar position; a single cell shows nothing. The
			// numbers come off `.uno:StateTableCell`, which core already
			// broadcasts for the desktop status bar — no client arithmetic and
			// no per-selection round trip. It REPLACES the formula bar rather
			// than stacking on it (§13-CALC.11), so it costs no height, and it
			// never shares the screen with the operator strip above, which
			// exists only while an edit is live. Visibility is CSS-only off
			// the one attribute the component publishes, so there is nothing
			// to wire up here beyond construction — the CalcOperatorStrip
			// contract, and the same both-halves phone gate it uses.
			if (window.mode.isSmallScreenDevice() &&
				document.documentElement.classList.contains('vulcan-mobile-chrome') &&
				formulabarRow && formulabarRow.parentNode &&
				(window as any).VulcanCalcAggregateStrip)
				this.map.calcAggregateStrip =
					(window as any).VulcanCalcAggregateStrip.create(this.map);

			// The EDIT-READY style rail (VulcanCalcFormatRow.ts): B/I/U/S,
			// both alignment axes, text colour, cell fill, wrap and merge, in
			// Google's published format-panel order. It TAKES THE SHEET-TAB
			// STRIP'S SLOT rather than adding a row — inserted before
			// #spreadsheet-toolbar, at the same 49px the strip and the
			// operator strip lockstep to. Visibility is CSS-only off the
			// EDIT-READY marker (§13-CALC.13), so there is nothing to wire up
			// here beyond construction — the CalcOperatorStrip contract, and
			// the same both-halves phone gate it uses.
			if (window.mode.isSmallScreenDevice() &&
				document.documentElement.classList.contains('vulcan-mobile-chrome') &&
				spreadsheetToolbar && spreadsheetToolbar.parentNode &&
				(window as any).VulcanCalcFormatRow)
				this.map.calcFormatRow =
					(window as any).VulcanCalcFormatRow.create(this.map);

			// The EDIT-READY cell preview (VulcanCalcCellPreview.ts): the
			// engaged cell's value in italic over its formula, with the ✎ door
			// at the trailing edge. It takes #formulabar-row's slot — the fx
			// bar belongs to FULL EDIT (§13-CALC.2c) — so like the rail above
			// it costs no height it did not replace, and it reads two map
			// events core already broadcasts rather than adding a round trip.
			// Visibility is CSS-only off the EDIT-READY marker (§13-CALC.14),
			// so there is nothing to wire up here beyond construction — the
			// CalcOperatorStrip contract, and the same both-halves phone gate.
			//
			// Constructed BEFORE JSDialog.FormulaBar below on purpose only for
			// readability (the three fork-added phone bars stay contiguous);
			// the pencil reaches map.formulabar lazily, at tap time.
			if (window.mode.isSmallScreenDevice() &&
				document.documentElement.classList.contains('vulcan-mobile-chrome') &&
				formulabarRow && formulabarRow.parentNode &&
				(window as any).VulcanCalcCellPreview)
				this.map.calcCellPreview =
					(window as any).VulcanCalcCellPreview.create(this.map);

			this.map.formulabar = JSDialog.FormulaBar(this.map);
			JSDialog.MessageRouter.flushPending('formulabar');
			this.map.addressInputField = JSDialog.AddressInputField(this.map);
			JSDialog.MessageRouter.flushPending('addressinputfield');
			this.map.calcNotifications = new CalcNotifications(this.map);
			$('#toolbar-wrapper').addClass('spreadsheet');

			// remove unused elements
			window.L.DomUtil.remove(window.L.DomUtil.get('presentation-controls-wrapper'));
			const selectBackground = document.getElementById('selectbackground');
			if (selectBackground != null)
				selectBackground.parentNode?.removeChild(selectBackground);

			const highlightState = this.getHighlightMode()? 'true' : 'false';
			this.map['stateChangeHandler'].setItemValue('columnrowhighlight', highlightState);
			this._map.fire('commandstatechanged', {commandName : 'columnrowhighlight', state : highlightState});
		}

		if (this.map.isPresentationOrDrawing()) {
			// remove unused elements
			window.L.DomUtil.remove(window.L.DomUtil.get('spreadsheet-toolbar'));
			this.revealPresentationControls(docType);
			this.initializeRuler();
			this.map.slideShowPresenter = new SlideShow.SlideShowPresenter(this.map, window.enableAccessibility);
			this.map.presenterConsole = new SlideShow.PresenterConsole(this.map, this.map.slideShowPresenter);

			// The Impress phone contextual format row (slides G-P1-1,
			// vulcan-theme.css §13i.22): per-noun row with the pinned Format
			// chip, docked above the keyboard in every editor mode — the
			// reference carries a contextual bar there in all of them, and in
			// caret modes its pinned chip is the only Format door. Presentation
			// only: drawing keeps its stock chrome. Construction here, the
			// same both-halves phone gate as the Writer strip; visibility is
			// CSS-only off the posture and keyboard markers.
			if (docType === 'presentation' &&
				window.mode.isSmallScreenDevice() &&
				document.documentElement.classList.contains('vulcan-mobile-chrome') &&
				(window as any).VulcanImpressFormatRow)
				this.map.impressFormatRow =
					(window as any).VulcanImpressFormatRow.create(this.map);
		}

		if (docType === 'text') {
			// remove unused elements
			window.L.DomUtil.remove(window.L.DomUtil.get('spreadsheet-toolbar'));
			window.L.DomUtil.remove(window.L.DomUtil.get('presentation-controls-wrapper'));
			const selectBackground = document.getElementById('selectbackground');
			if (selectBackground != null)
				selectBackground.parentNode?.removeChild(selectBackground);

			this.initializeRuler();
			this.initializeFormattingMarks();

			// The phone text-format strip (R6-17, vulcan-theme.css
			// §13-WRITER.6): B/I/U, text colour, highlight and alignment
			// docked directly above the soft keyboard, so formatting a
			// selection mid-edit no longer means the A sheet — measured on
			// build #10 at 325px of a 463px keyboard-shrunk viewport, and it
			// drops TextInput._acceptInput on the way in. Its own element
			// inserted before #toolbar-down (display:none on Writer since
			// §13-WRITER.1, but still the anchor of the bottom-docked column
			// global.js sizes to the keyboard). Visibility is CSS-only off
			// the read-posture and keyboard-open markers, so there is nothing
			// to wire up here beyond construction — the CalcOperatorStrip
			// contract, and the same both-halves phone gate it uses.
			if (window.mode.isSmallScreenDevice() &&
				document.documentElement.classList.contains('vulcan-mobile-chrome') &&
				(window as any).VulcanWriterFormatRow)
				this.map.writerFormatRow =
					(window as any).VulcanWriterFormatRow.create(this.map);

			var showResolved = this.getBooleanDocTypePref('ShowResolved', true);
			if (showResolved === false)
				this.map.sendUnoCommand('.uno:ShowResolvedAnnotations');
			this.map.mention = new Mention(this.map);

			if (!window.mode.isSmallScreenDevice()) {
				// setup quickfind panel
				this.map.quickFindPanel = JSDialog.QuickFindPanel(this.map);
				this.map.addControl(this.map.quickFindPanel);
			}

			if (this.getStartCompareChanges()) {
				// Don't switch to the comparechanges view yet, first wait for the
				// initializationcomplete event, which fires after
				// app.activeDocument.fileSize is set, otherwise the tile manager
				// would discard valid tiles.
				const enterCompareChanges = (
					e: StatusIndicatorEvent,
				) => {
					if (e.statusType !== 'initializationcomplete') {
						return;
					}
					app.dispatcher.dispatch('viewchanges-sidebyside');
					this.map.off('statusindicator', enterCompareChanges);
				};
				this.map.on('statusindicator', enterCompareChanges);
			}
		}

		if (this.map.isPresentationOrDrawing() && (isDesktop || window.mode.isTablet())) {
			JSDialog.PresentationBar(this.map);
			this.map.sidebarFromNotebookbar = JSDialog.SidebarFromNotebookbarPanel(this.map);
		}
		if (window.mode.isTablet() || window.mode.isDesktop()) {
			this.map.navigator.initializeNavigator(docType);
		}

		if (docType !== 'spreadsheet') this.initializeComments();

		this.map.on('changeuimode', this.onChangeUIMode, this);
		window.addEventListener('browsersettingchanged', () => {
			this.onChangeUIMode({ mode: this.getCurrentMode(), force: true });
		});
		this.map.on('backstagehide', () => {
			setTimeout(() => {
				this.map.invalidateSize(); // triggers Leaflet layout recalculation
				const docLayer = this.map._docLayer;
				if (docLayer && docLayer._docType === 'spreadsheet') {
					docLayer._resetClientVisArea();
					docLayer._requestNewTiles();
				}
			}, 0);
		});

		this.refreshTheme();

		var startFolloMePresntationGet = this.map.isPresentationOrDrawing();
		var presentationLeaderIdGet = this.map.isPresentationOrDrawing() && window.coolParams.get('presentationLeaderId');
		var startPresentationGet = this.map.isPresentationOrDrawing() && window.coolParams.get('startPresentation');
		if (this.map.wopi.PresentationLeader)
		{
			presentationLeaderIdGet = this.map.wopi.PresentationLeader;
		}
		// check for "presentation" dispatch event only after document gets fully loaded
		// in case if the leader is defined we have to wait a little longer to get the viewer info
		const startPresentation = () => {
			if (startPresentationGet === 'true' || startPresentationGet === '1') {
				app.dispatcher.dispatch('presentation');
			}
			else if (startFolloMePresntationGet) {
				const dispatchFollowPresentation = () => {
					app.dispatcher.dispatch('followpresentation');
					this.map.off('slideshowfollowon', dispatchFollowPresentation);
				}

				if (presentationLeaderIdGet !== ''){
					// we can start presentation and wait for the leader
					var myViewId = this.map._docLayer._viewId;
					if (!myViewId)
						return;
					var myViewData = this.map._viewInfo[myViewId];
					if (myViewData.userid === presentationLeaderIdGet) {
						app.dispatcher.dispatch('followmepresentation');
					}
					else {
						app.dispatcher.dispatch('followpresentation');
					}
				}
				else {
					// have to wait until we get all the leader slide details
					// if we start the follow me presentation directly then
					// it will start from beginning and not where the leader is
					// This also help with if the follow me presentation is not running
					this.map.on('slideshowfollowon', dispatchFollowPresentation);
				}
			}

			// docloaded event is fired multiple times, unfortunately
            // but presentation should start only once
			this.map.off('updateviewslist', startPresentation);
			this.map.off('docloaded', startPresentation);
		};
		if (presentationLeaderIdGet !== '')
			this.map.on('updateviewslist', startPresentation);
		else
			this.map.on('docloaded', startPresentation);
		this.map.contextToolbar = new ContextToolbar(this.map);

		app.serverConnectionService.onSpecializedUI(docType);
	}

	/**
	 * Initializes the heavy components which require core side to work.
	 * Scheduled to be executed after we do first tiles requests to not
	 * block the document content rendering on a load.
	 */
	initializeLateComponents(): void {
		app.console.debug('UIManager: late components init');
		this.initializeNotebookbarInCore();
		this.initializeSidebar();
		this.initializeNavigator();
		this.initializeQuickFindInCore();
	}

	/**
	 * Reopens the navigator panel on start when the saved state asks for it.
	 * The navigator is the panel on the left of the document and is separate
	 * from the sidebar on the right, so its restore does not depend on
	 * whether the sidebar is shown.
	 */
	initializeNavigator(): void {
		if (!window.mode.isDesktop() || window.ThisIsAMobileApp) return;

		// .uno:Navigator toggles the panel, and it starts closed, so send it
		// only when the saved state wants the navigator open.
		if (this.getBooleanDocTypePref('ShowNavigator', false))
			app.socket.sendMessage('uno .uno:Navigator');
	}

	/**
	 * Initializes the sidebar based on saved state and preferences.
	 */
	initializeSidebar(): void {
		// Hide the sidebar on start if saved state or UIDefault is set.
		if (window.mode.isDesktop() && !window.ThisIsAMobileApp) {
			// Vulcan Office fork default: the properties/Slide sidebar starts
			// COLLAPSED for Writer, Calc and Impress. The host application sets
			// TextSidebar/SpreadsheetSidebar/PresentationSidebar=false, but the
			// presentation scope is not always honoured by the ui_defaults
			// mapping, so Impress otherwise falls through to the stock `true`
			// default and auto-opens its Slide property deck. Defaulting to false
			// keeps all three collapsed on first load; a saved state or an
			// explicit UIDefault=true still wins, and the user can open it
			// normally from the sidebar toggle.
			var showSidebar = this.getBooleanDocTypePref('ShowSidebar', false);

			if (showSidebar && this.getBooleanDocTypePref('PropertyDeck', true)) {
				app.socket.sendMessage('uno .uno:SidebarShow');
				this.map.sidebar.setAsInitialized();
			}

			if (showSidebar && this.map.getDocType() === 'presentation') {
				if (this.getBooleanDocTypePref('SdSlideTransitionDeck', false)) {
					app.socket.sendMessage('uno .uno:SidebarShow');
					app.socket.sendMessage('uno .uno:SlideChangeWindow');
					this.map.sidebar.setupTargetDeck('.uno:SlideChangeWindow');
				} else if (this.getBooleanDocTypePref('SdCustomAnimationDeck', false)) {
					app.socket.sendMessage('uno .uno:SidebarShow');
					app.socket.sendMessage('uno .uno:CustomAnimation');
					this.map.sidebar.setupTargetDeck('.uno:CustomAnimation');
				} else if (this.getBooleanDocTypePref('SdMasterPagesDeck', false)) {
					app.socket.sendMessage('uno .uno:SidebarShow');
					app.socket.sendMessage('uno .uno:MasterSlidesPanel');
					this.map.sidebar.setupTargetDeck('.uno:MasterSlidesPanel');
				}
			} else if (showSidebar && this.getBooleanDocTypePref('StyleListDeck', false)) {
				app.socket.sendMessage('uno .uno:SidebarShow');
				app.socket.sendMessage('uno .uno:SidebarDeck.StyleListDeck');
				this.map.sidebar.setupTargetDeck('.uno:SidebarDeck.StyleListDeck');
			}

			if (showSidebar)
				this.map.sidebar.setAsInitialized();
			else
				app.socket.sendMessage('uno .uno:SidebarHide');
		}
		else if (window.mode.isChromebook() || window.mode.isSmallScreenDevice() || window.mode.isTablet()) {
			// HACK - currently the sidebar shows when loaded,
			// with the exception of mobile phones & tablets - but
			// there, it does not show only because they start
			// with read/only mode which hits an early exit in
			// _launchSidebar() in Control.LokDialog.js
			// So for the moment, let's just hide it on
			// Chromebooks early
			app.socket.sendMessage('uno .uno:SidebarHide');
		}
	}

	/**
	 * Initializes the ruler component.
	 */
	initializeRuler(): void {
		if ((window.mode.isTablet() || window.mode.isDesktop()) && !app.isReadOnly()) {
			var defaultShowRuler = (window as any).mode.isCODesktop();
			var showRuler = this.getBooleanDocTypePref('ShowRuler', defaultShowRuler);
			var interactiveRuler = this.map.isEditMode();
			// Call the static method from the Ruler class
			app.definitions.ruler.initializeRuler(this.map, {
				interactive: interactiveRuler,
				showruler: showRuler
			});

			const rulerState = showRuler ? 'true' : 'false';
			this.map['stateChangeHandler'].setItemValue('showruler', rulerState);
			this._map.fire('commandstatechanged', {commandName : 'showruler', state : rulerState});
		}
	}

	initializeComments(): void {
		// Record the saved on or off state before comments are imported. The
		// comment list reads this value as it imports and shows or hides itself
		// accordingly, so there is no comment section to act on here yet.
		const showComments = this.getBooleanDocTypePref('ShowAnnotations', true);
		const state = showComments ? 'true' : 'false';
		this.map['stateChangeHandler'].setItemValue('showannotations', state);
		this._map.fire('commandstatechanged', {commandName : 'showannotations', state : state});
	}

	initializeFormattingMarks(): void {
		// Formatting marks are toggled with .uno:ControlCodes, and core reports
		// the on or off result through that command's state. Capture the saved
		// preference now, before any state arrives, so the value to restore is
		// not lost when the state events start updating the preference.
		const wantMarks = this.getBooleanDocTypePref('ShowFormattingMarks', false);
		let initialStateSeen = false;

		this.map.on('commandstatechanged', (e: any) => {
			if (e.commandName !== '.uno:ControlCodes') return;
			const isOn = e.state === 'true';

			// The first state is core's starting value once the document view
			// is ready. Sending the toggle any earlier is lost. Correct the
			// state here with a single toggle when it does not match the saved
			// preference, and let the resulting change be persisted below.
			if (!initialStateSeen) {
				initialStateSeen = true;
				if (isOn !== wantMarks) {
					this.map.sendUnoCommand('.uno:ControlCodes');
					return;
				}
			}

			this.setDocTypePref('ShowFormattingMarks', isOn);
		});
	}

	/**
	 * Removes classic UI components.
	 */
	removeClassicUI(): void {
		if (this.map.menubar)
		{
			this.map.removeControl(this.map.menubar);
			this.map.menubar = null;
		}
		if (this.map.topToolbar)
		{
			this.map.topToolbar.onRemove();
			this.map.topToolbar = null;
		}
	}

	/**
	 * Adds classic UI components.
	 */
	addClassicUI(): void {
		this.map.menubar = new Menubar();
		this.map.addControl(this.map.menubar);
		this.map.topToolbar = JSDialog.TopToolbar(this.map);
		// (The toolbar replays cached CheckFileInfo props itself now — see
		// the app.wopiProps replay in the TopToolbar constructor.)

		this.map.menubar._onDocLayerInit();
		this.map.topToolbar.onDocLayerInit();
		this.map.sendInitUNOCommands();
		this.map._docLayer._resetClientVisArea();
		this.map._docLayer._requestNewTiles();

		this.map.topToolbar.updateControlsState();

		if (this._menubarShouldBeHidden)
			this.hideMenubar();

		app.UI.compactViewAccessibility.initialize();
	}

	/**
	 * Creates and adds a notebookbar control based on document type.
	 * @param docType - Document type (e.g. 'spreadsheet', 'presentation', etc.)
	 */
	createNotebookbarControl(docType: string, showUI: boolean): void {
		if (docType === 'spreadsheet') {
			var notebookbar = window.L.control.notebookbarCalc();
		} else if (docType === 'presentation') {
			notebookbar = window.L.control.notebookbarImpress();
		} else if (docType === 'drawing') {
			notebookbar = window.L.control.notebookbarDraw();
		} else {
			notebookbar = window.L.control.notebookbarWriter();
		}

		this.notebookbar = JSDialog.NotebookbarBase(this.map, notebookbar);
		JSDialog.MessageRouter.flushPending('notebookbar');
		if (showUI)
			this.showNotebookbarControl();
	}

	showNotebookbarControl(): void {
		this.notebookbar.onAdd();
		this.map.fire('a11ystatechanged');
		app.UI.notebookbarAccessibility.initialize();
	}

	/**
	 * Refreshes UI components after a theme change.
	 */
	refreshAfterThemeChange(): void {
		if (this.getCurrentMode() === 'classic' || this.map.isReadOnlyMode()) {
			this.refreshMenubar();
			this.refreshToolbar();
		}
		// jsdialog components like notebookbar or sidebar
		// doesn't require reload to change icons
	}

	/**
	 * Refreshes the notebookbar. WARNING: if we got core updates for JSDialog widgets, they will be lost.
	 */
	refreshNotebookbar(): void {
			var selectedTab = $('.ui-tab.notebookbar[aria-selected="true"]').attr('id') || 'Home-tab-label';
			this.removeNotebookbarUI();
			this.showNotebookbarControl();
			if (this._map._permission === 'edit') {
				$('.main-nav').removeClass('readonly');
			}
			$('#' + selectedTab).click();
			this.makeSpaceForNotebookbar();
			this.notebookbar._showNotebookbar = true;
			this.notebookbar.showTabs();
			$('#map').addClass('notebookbar-opened');
			this.insertCustomButtons();
			this.map.sendInitNotebookbarCommands();
			if (this.map.getDocType() === 'presentation')
				this.map.fire('toggleslidehide');
	}

	/**
	 * Refreshes the menubar.
	 */
	refreshMenubar(): void {
		if (this.map.menubar)
			this.map.menubar._onRefresh();
	}

	/**
	 * Placeholder method for refreshing the toolbar.
	 */
	refreshToolbar(): void {
		// TODO
	}

	/**
	 * Adds notebookbar UI components.
	 */
	addNotebookbarUI(): void {
		this.refreshNotebookbar();
		this.map._docLayer._resetClientVisArea();
		this.map._docLayer._requestNewTiles();
		var menubarWasHidden = this.isMenubarHidden();
		this.showMenubar();
		this._menubarShouldBeHidden = menubarWasHidden;
	}

	/**
	 * Removes notebookbar UI components.
	 */
	removeNotebookbarUI(): void {
		this.notebookbar.onRemove();
		$('#map').removeClass('notebookbar-opened');
	}

	/**
	 * Handles UI mode changes.
	 * @param uiMode - Object containing the new UI mode and additional flags.
	 */
	onChangeUIMode(uiMode: UIModeCommand): void {
		if (window.mode.isSmallScreenDevice())
			return;

		var currentMode = this.getCurrentMode();

		if (uiMode.mode === currentMode && !uiMode.force)
			return;

		if (uiMode.mode !== 'classic' && uiMode.mode !== 'notebookbar')
			return;

		document.body.setAttribute('data-userInterfaceMode', uiMode.mode);

		this.map.fire('postMessage', {msgId: 'Action_ChangeUIMode_Resp', args: {Mode: uiMode.mode}});

		window.userInterfaceMode = uiMode.mode;

		switch (uiMode.mode) {
		case 'classic':
			this.removeNotebookbarUI();
			this.addClassicUI();
			break;

		case 'notebookbar':
			this.removeClassicUI();
			this.addNotebookbarUI();
			break;
		}

		window.prefs.set('compactMode', uiMode.mode === 'classic');
		this.initializeLateComponents();
		this.insertCustomButtons();

		// this code ensures that elements in the notebookbar have their "selected" status
		// displayed correctly
		this.map.fire('rulerchanged');
		this.map.fire('statusbarchanged');

		if (typeof window.initializedUI === 'function')
			window.initializedUI();
		this.map.fire('darkmodechanged');
		this.map.fire('rulerchanged');
		this.map.fire('statusbarchanged');
		this.map.fire('a11ystatechanged');

		// be sure we hide old scrollable markers
		JSDialog.RefreshScrollables();

		// Recalculate overflow layout after all DOM modifications.
		// RefreshScrollables dispatches a resize event, but the
		// OverflowManager skips resize events when the window size
		// is unchanged. Fire refreshoverflows explicitly with layouting service
		// so the browser has time to lay out the new DOM before overflow is measured.
		app.layoutingService.appendLayoutingTask(() => {
			this.map.fire('refreshoverflows', { force: true });
		});
	}

	// UI modification

	/**
	 * Inserts a button into the classic toolbar.
	 * @param button - Button configuration object.
	 */
	insertButtonToClassicToolbar(button: any): void {
		if (this.map.isEditMode()) {
			// Position: Either specified by the caller, or defaulting to first position (before save)
			var insertBefore = button.insertBefore || 'save';

			var newButton: ToolbarButton[] = [
				{
					type: 'button',
					uno: button.unoCommand,
					id: button.id,
					img: button.id,
					hint: _(button.hint.replaceAll('"', '&quot;')), /* "Try" to localize ! */
					/* Notify the host back when button is clicked (only when unoCommand is not set) */
					postmessage: !Object.prototype.hasOwnProperty.call(button, 'unoCommand')
				}
			];

			// TODO: other
			var topToolbar = window.app.map.topToolbar;
			if (topToolbar && !topToolbar.hasItem(button.id)) {
				// translate to JSDialog JSON
				newButton[0].command = newButton[0].uno;
				newButton[0].type = 'toolitem';
				newButton[0].w2icon = newButton[0].img;
				newButton[0].text = newButton[0].hint;
				topToolbar.insertItem(insertBefore, newButton);

				// updated css rules to show custom button images
				this.setCssRulesForCustomButtons();
			}
		}

		if (this.map.isReadOnlyMode()) {
			// Just add a menu entry for it
			this.map.fire('addmenu', {id: button.id, label: button.hint});
		}
	}

	setCssRulesForCustomButtons(): void {
		for (var button of this.customButtons) {
			const item = document.querySelector(".w2ui-icon." + encodeURIComponent(button.id)) as HTMLElement | null;
			var imgUrl = button.imgurl;
			if (item) {
				if(button.imgurl === undefined || button.imgurl === "") {
					var iconName = app.LOUtil.getIconNameOfCommand(button.unoCommand);
					imgUrl = app.LOUtil.getImageURL(iconName);
				}
				item.style.background = 'url("' + encodeURI(imgUrl) + '")';
				item.style.backgroundRepeat = 'no-repeat';
				item.style.backgroundPosition = 'center';
			}
		}
	}

	/**
	 * Registers a new custom button.
	 *
	 * Called by the WOPI API to register new custom button
	 * @param button - Button configuration object.
	 */
	insertButton(button: any): void {
		for (var i in this.customButtons) {
			var item = this.customButtons[i];
			if (item.id === button.id)
				return;
		}

		this.customButtons.push(button);
		this.insertCustomButton(button);
	}

	/**
	 * Inserts a custom button into the current UI.
	 * @param button - Button configuration object.
	 */
	insertCustomButton(button: any): void {
		if (button.tablet === false && window.mode.isTablet())
			return;

		if (this.getCurrentMode() === 'classic')
			this.insertButtonToClassicToolbar(button);

		// we always  create notebookbar component, it should get the button in advance
		// in case of mode switch done by user later
		if (this.notebookbar)
			this.notebookbar.insertButtonToShortcuts(button);
		else
			app.console.error('UIManager: no notebookbar yet to insert button: ' + JSON.stringify(button));
	}

	/**
	 * Inserts all custom buttons into the current UI.
	 */
	insertCustomButtons(): void {
		for (var i in this.customButtons)
			this.insertCustomButton(this.customButtons[i]);
	}

	/**
	 * Shows or hides a button in the classic toolbar.
	 * @param buttonId - The button’s ID.
	 * @param show - Flag to show (true) or hide (false).
	 */
	showButtonInClassicToolbar(buttonId: string, show: boolean): boolean {
		// TODO: other
		const toolbars: any[] = [];
		let found = false;

		toolbars.forEach((toolbar) => {
			if (toolbar && toolbar.get(buttonId)) {
				found = true;
				toolbar.showItem(buttonId, show);
			}
		});
		if (!window.app.map.topToolbar)
			return found;
		const topToolbarHas = window.app.map.topToolbar.hasItem(buttonId);
		found = found || topToolbarHas;
		if (topToolbarHas)
			window.app.map.topToolbar.showItem(buttonId, show);

		return found;
	}

	/**
	 * Shows or hides a button in the current UI.
	 * @param buttonId - The button’s ID.
	 * @param show - Flag to show (true) or hide (false).
	 */
	showButton(buttonId: string, show: boolean): void {
		var found = false;

		if (show)
			delete this.hiddenButtons[buttonId];
		else
			this.hiddenButtons[buttonId] = true;

		if (this.getCurrentMode() === 'classic')
			found = this.showButtonInClassicToolbar(buttonId, show);

		if (this.notebookbar) {
			if (this.getCurrentMode() === 'notebookbar') this.notebookbar.reloadShortcutsBar();
			found = show ? this.notebookbar.showItem(buttonId) : this.notebookbar.hideItem(buttonId);
		}

		if (!found)
			window.app.console.error('UIManager: Button with id "' + buttonId + '" not found.');

		// When toggledarktheme is hidden, also hide the adjacent separator
		// to prevent two separators from being displayed in a row.
		if (buttonId === 'toggledarktheme')
			this.showButton('view-invertbackground-break', show);
	}

	/**
	 * Returns whether a button is currently visible.
	 * @param buttonId - The button’s ID.
	 */
	isButtonVisible(buttonId: string): boolean {
		return !(buttonId in this.hiddenButtons);
	}

	// Commands

	/**
	 * Shows or hides a command in the menubar.
	 * @param command - Command identifier.
	 * @param show - Flag to show (true) or hide (false).
	 */
	showCommandInMenubar(command: string, show: boolean): boolean {
		var menubar = this._map.menubar;
		if (show) {
			return menubar.showUnoItem(command);
		} else {
			return menubar.hideUnoItem(command);
		}
	}

	/**
	 * Shows or hides a command in the classic toolbar.
	 * @param command - Command identifier.
	 * @param show - Flag to show (true) or hide (false).
	 */
	showCommandInClassicToolbar(command: string, show: boolean): boolean {
		// TODO: other
		const toolbars: any[] = [];
		var found = false;

		toolbars.forEach((toolbar) => {
			if (!toolbar)
				return;
			toolbar.items.forEach((item: any) => {
				var commands = this.map._extractCommand(item);
				if (commands.indexOf(command) != -1) {
					found = true;
					if (show) {
						toolbar.showItem(item.id, true);
					} else {
						toolbar.showItem(item.id, false);
					}
				}
			});
		});

		return found;
	}

	/**
	 * Shows or hides a command in the current UI.
	 * @param command - Command identifier.
	 * @param show - Flag to show (true) or hide (false).
	 */
	showCommand(command: string, show: boolean): void {
		if (show)
			delete this.hiddenCommands[command];
		else
			this.hiddenCommands[command] = true;

		var found = false;

		// The standalone edit affordance on the comment dialog is keyed to
		// .uno:EditAnnotation. Toggle it for any comments already on screen;
		// createMenu also consults isCommandVisible for ones built later.
		// Done before the toolbar/menubar/notebookbar branches so a failure
		// in one of them cannot skip the comment-dialog update.
		if (command === '.uno:EditAnnotation') {
			document.querySelectorAll<HTMLElement>('.cool-annotation-menu-edit')
				.forEach(el => { el.classList.toggle('hidden-by-command', !show); });
			found = true;
		}

		if (this.getCurrentMode() === 'classic') {
			if (this.showCommandInClassicToolbar(command, show)) {
				found = true;
			}
			if (this.showCommandInMenubar(command, show)) {
				found = true;
			}
		}

		if (this.notebookbar) {
			if (this.getCurrentMode() === 'notebookbar') {
				this.notebookbar.reloadShortcutsBar();
			}
			if (this.notebookbar.showNotebookbarCommand(command, show)) {
				found = true;
			}
		}

		if (!found)
			window.app.console.error('UIManager: Item with command "' + command + '" not found.');
	}

	/**
	 * Returns whether a command is visible.
	 * @param command - Command identifier.
	 */
	isCommandVisible(command: string): boolean {
		return !(command in this.hiddenCommands);
	}

	// Menubar

	/**
	 * Shows the menubar.
	 */
	showMenubar(): void {
		this._menubarShouldBeHidden = false;
		if (!this.isMenubarHidden())
			return;
		$('.main-nav').show();
		if (window.L.Params.closeButtonEnabled && !window.mode.isTablet()) {
			$('#closebuttonwrapper').show();
			$('#closebuttonwrapperseparator').show();
		}
		const obj = document.getElementById('fold-button');
		if (obj != null)
			obj.style.transform = 'rotate(0deg)';

		$('#fold').prop('title', _('Hide Menu'));

		if (this._notebookbarShouldBeCollapsed)
			this.collapseNotebookbar();
	}

	/**
	 * Hides the menubar.
	 */
	hideMenubar(): void {
		this._menubarShouldBeHidden = true;
		if (this.isMenubarHidden() || this.shouldUseNotebookbarMode())
			return;

		var notebookbarWasCollapsed = this.isNotebookbarCollapsed();
		this.extendNotebookbar();  // The notebookbar has the button to show the menu bar, so having it hidden at the same time softlocks you
		this._notebookbarShouldBeCollapsed = notebookbarWasCollapsed;

		$('.main-nav').hide();
		if (window.L.Params.closeButtonEnabled) {
			$('#closebuttonwrapper').hide();
			$('#closebuttonwrapperseparator').hide();
		}
		const obj = document.getElementById('fold-button');
		if (obj != null)
			obj.style.transform = 'rotate(180deg)';

		$('#fold').prop('title', _('Show Menu'));
	}

	/**
	 * Returns whether the menubar is hidden.
	 */
	isMenubarHidden(): boolean {
		return $('.main-nav').css('display') === 'none';
	}

	/**
	 * Toggles the menubar’s visibility.
	 */
	toggleMenubar(): void {
		if (this.isMenubarHidden())
			this.showMenubar();
		else
			this.hideMenubar();
	}

	// Ruler

	/**
	 * Shows the rulers.
	 */
	showRuler(): void {
		this._map.sendUnoCommand('.uno:ShowRuler');

		if (app.UI.horizontalRuler) app.UI.horizontalRuler.show();
		if (app.UI.verticalRuler) app.UI.verticalRuler.show();

		$('#map').addClass('hasruler');
		this.setDocTypePref('ShowRuler', true);
		this.map.fire('rulerchanged');

		if (app.sectionContainer
			&& app.map?._docLayer?._docType === 'text'
			&& !app.sectionContainer.getSectionWithName(app.CSections.RulerSpacer.name)) {
			app.sectionContainer.addSection(new cool.RulerSpacerSection());
		}
	}

	/**
	 * Hides the rulers.
	 */
	hideRuler(): void {
		if (app.UI.horizontalRuler) app.UI.horizontalRuler.hide();
		if (app.UI.verticalRuler) app.UI.verticalRuler.hide();

		$('#map').removeClass('hasruler');
		this.setDocTypePref('ShowRuler', false);

		if (app.sectionContainer
			&& app.sectionContainer.getSectionWithName(app.CSections.RulerSpacer.name)) {
			app.sectionContainer.removeSection(app.CSections.RulerSpacer.name);
		}
	}

	/**
	 * Toggles the ruler’s visibility.
	 */
	toggleRuler(): void {
		if (this.isRulerVisible())
			this.hideRuler();
		else
			this.showRuler();
	}

	/**
	 * Returns whether the ruler is visible.
	 */
	isRulerVisible(): boolean {
		return $('.cool-ruler').is(':visible');
	}

	/*
	 * Shows the StyleListDeck (sidebar).
	 * If 'visible' already, then does nothing as this
	 * is called from 'stylesview' dropdown and buttons
	 * in a dropdown aren't toggle buttons.
	 */
	showStyleListDeck(): void {
		const styleListDeck = document.querySelector('#StyleListDeck');
		JSDialog.CloseAllDropdowns();
		if (styleListDeck && (styleListDeck as any).checkVisibility())
			return;
		this._map.sendUnoCommand('.uno:SidebarDeck.StyleListDeck');
	}

	/**
	 * Returns whether the document is in fullscreen mode.
	 */
	isFullscreen(): boolean {
		if (!document.fullscreenElement &&
			!document.mozFullscreenElement &&
			!document.msFullscreenElement &&
			!document.webkitFullscreenElement)
			return false;
		else
			return true;
	}

	// Notebookbar helpers

	initializeNotebookbarInCore(): void {
		// do it always apart of mobile as we need it for contextual toolbar
		if (window.mode.isSmallScreenDevice()) return;

		if (!this.notebookbar.impl.initialized) {
			this.map.sendUnoCommand('.uno:ToolbarMode?Mode:string=Default');
			this.map.sendUnoCommand('.uno:ToolbarMode?Mode:string=notebookbar_online.ui');
		}
	}

	// QuickFindPanel

	initializeQuickFindInCore(): void {
		if (!this.map.quickFindPanel) return;

		// Initialize QuickFindPanel in core
		app.socket.sendMessage('uno .uno:QuickFind');
	}

	/**
	 * Returns whether the notebookbar is currently shown.
	 */
	hasNotebookbarShown(): boolean {
		return $('#map').hasClass('notebookbar-opened');
	}

	/**
	 * Adjusts layout to make space for the notebookbar.
	 */
	makeSpaceForNotebookbar(): void {
		if (this.hasNotebookbarShown())
			return;

		$('#map').addClass('notebookbar-opened');
	}

	/**
	 * Collapses the notebookbar.
	 */
	collapseNotebookbar(): void {
		this._notebookbarShouldBeCollapsed = true;

		if (this.isNotebookbarCollapsed() || this.isMenubarHidden())
			return;

		$('#toolbar-row').css('display', 'none');

		$('#document-container').addClass('tabs-collapsed');
	}

	/**
	 * Extends (uncollapses) the notebookbar.
	 */
	extendNotebookbar(): void {
		this._notebookbarShouldBeCollapsed = false;

		if (!this.isNotebookbarCollapsed())
			return;

		$('#toolbar-row').css('display', '');

		$('#document-container').removeClass('tabs-collapsed');
	}

	showNotebookTab(id: string, show: boolean): void {
		if (show) {
			delete this.hiddenTabs[id];
		} else {
			this.hiddenTabs[id] = true;
		}
		if (this.notebookbar) {
			this.notebookbar.refreshContextTabsVisibility();
		}
	}

	/**
	 * Is the notebookbar's tab visible?
	 */
	isTabVisible(name: string): boolean {
		return !(name in this.hiddenTabs);
	}

	/**
	 * Returns whether the notebookbar is collapsed.
	 */
	isNotebookbarCollapsed(): boolean {
		return $('#document-container').hasClass('tabs-collapsed');
	}

	// UI Defaults functions

	/**
	 * Shows the status bar.
	 */
	showStatusBar(): void {
		$('#document-container').css('bottom', this.documentBottom);
		this.map.statusBar.show();
		this.setDocTypePref('ShowStatusbar', true);
		this.map.fire('statusbarchanged');
	}

	showNavigator(): void {
		this.map?.navigator?.requestShow();
	}

	/**
	 * Hides the status bar.
	 * @param firstStart - Optional flag indicating if this is the initial call.
	 */
	hideStatusBar(firstStart?: boolean): void {
		if (!firstStart && !this.isStatusBarVisible())
			return;

		this.documentBottom = $('#document-container').css('bottom');
		$('#document-container').css('bottom', '0px');
		this.map.statusBar.hide();
		if (!firstStart)
			this.setDocTypePref('ShowStatusbar', false);
		this.map.fire('statusbarchanged');
	}

	/**
	 * Toggles the status bar’s visibility.
	 */
	toggleStatusBar(): void {
		if (this.isStatusBarVisible())
			this.hideStatusBar();
		else
			this.showStatusBar();
	}

	/**
	 * Focuses the search functionality.
	 */
	focusSearch(): void {
		const isTextDoc = this.map.isText();

		/*
			🔴 ON A PHONE THIS THREW. The branch below dereferences
			this.map.navigator, and the Navigator is built only under
			`if (!window.mode.isSmallScreenDevice())` (:601-606) -- as is the
			QuickFind panel it would have focused (:1006-1010). So on a phone
			Writer the property is undefined and `home-search` was a
			TypeError, not a search. It is reachable: Ctrl-F, Ctrl-Alt-S and
			Ctrl-B all dispatch `home-search` for every doctype
			(Map.KeyboardShortcuts.ts:382, :471, :481), and a paired keyboard
			on a phone is ordinary for anyone reviewing a long document.

			Phone Writer's find surface is the MobileSearchBar, which IS built
			on every small screen (:866) and which the kebab's own "Search" row
			already opens through this exact action
			(Control.Menubar.ts recsearch -> docdispatcher 'showsearchbar').
			Sending the keyboard to the same place the menu goes is both the
			crash fix and the parity fix -- Ctrl-F on a phone now opens find,
			the way it does in Docs.

			The test is `!this.map.navigator` and NOT a fresh small-screen
			predicate on purpose: the property being absent is the exact
			condition that makes the next line unsafe, so the guard cannot
			drift away from the hazard it is guarding. Phone Calc and Impress
			are untouched -- they are not text documents and keep the
			.uno:SearchDialog route below, which is the phone surface they
			shipped with.
		*/
		if (isTextDoc && !this.map.navigator) {
			app.dispatcher.dispatch('showsearchbar');
			this.map.fire('focussearch');
			return;
		}

		if (isTextDoc && !app.showNavigator) {
			this.map.navigator.preFocusQuickFind();
			this.showNavigator();
		}
		else if(!isTextDoc){
			app.socket.sendMessage('uno .uno:SearchDialog');
		}
		this.map.fire('focussearch');
	}

	isNotebookbarInitialized() {
		// `.notebookbar-scroll-wrapper.initialized`.
		const wrapper = document.querySelector('.notebookbar-scroll-wrapper') as HTMLElement | null;
		return !!wrapper && wrapper.classList.contains('initialized');
	}

	/**
	 * Returns whether the status bar is visible.
	 */
	isStatusBarVisible(): boolean {
		return document.getElementById('toolbar-down')?.style?.display !== 'none';
	}

	/**
	 * Returns whether the multi-page view layout is active.
	 */
	isMultiPageView(): boolean {
		return app.activeDocument?.activeLayout?.type === 'ViewLayoutMultiPage';
	}

	// Event handlers

	/**
	 * True when the phone posture stylesheet, not inline style, owns the
	 * Impress filmstrip's visibility: Vulcan phone chrome, presentation
	 * doctype (13i.1c hides the strip in the read/browse posture, 13i.1d is
	 * the edit reveal — both keyed on the classes this file stamps).
	 *
	 * Everywhere the stock code writes the wrapper's INLINE display it must
	 * ask this first: cool.css hides #presentation-controls-wrapper by
	 * default, so jQuery .show() always materializes an inline
	 * `display: block`, and an inline style outranks every sheet rule —
	 * 13i.1c was shipped structurally dead that way (R6-6 acceptance
	 * residual: the filmstrip stayed docked in browse on build #9).
	 *
	 * `docType` mirrors initializeSpecializedUI's own rule (see its header):
	 * during that call the parameter is the truth. Every later caller omits
	 * it and the null-safe Parts.getDocType() re-read answers; pre-doclayer
	 * it returns null, the predicate is false, and stock behaviour runs —
	 * fail-safe in the direction that cannot lose the strip.
	 */
	vulcanPostureGovernsFilmstrip(docType?: string): boolean {
		return (
			window.mode.isSmallScreenDevice() &&
			document.documentElement.classList.contains('vulcan-mobile-chrome') &&
			(docType ?? this.map.getDocType()) === 'presentation'
		);
	}

	/**
	 * The initializeSpecializedUI reveal of #presentation-controls-wrapper.
	 *
	 * Stock (desktop, tablet, ?vulcanChrome=desktop phones, Draw): the
	 * jQuery .show() it always was, byte for byte — an inline
	 * `display: block` over cool.css's default hide.
	 *
	 * Vulcan phone Impress chrome: CLEAR the inline property instead and let
	 * the posture stylesheet govern — 13i.1d shows the strip in the edit
	 * posture, 13i.1c hides it in browse, and stampReadPosture flips the
	 * class both rules key on. Writing inline block here would outrank both
	 * forever (the R6-6 build #9 failure). Runtime contract pinned in
	 * mocha_tests/ImpressPhoneFilmstripPosture.test.ts.
	 */
	revealPresentationControls(docType?: string): void {
		if (this.vulcanPostureGovernsFilmstrip(docType)) {
			const pcw = document.getElementById('presentation-controls-wrapper');
			if (pcw) pcw.style.removeProperty('display');
		} else $('#presentation-controls-wrapper').show();
	}

	/**
	 * The mobile wizard's close-side restore of the filmstrip (the open side,
	 * MobileWizardWindow, hides it under the wizard with an inline
	 * `display: none`; portrait only, both sides). Lives HERE, next to the
	 * posture machinery, because the un-hide is posture business: stock
	 * restores the inline `block` it always did, but under the Vulcan phone
	 * Impress chrome that block would outlive the wizard and resurrect the
	 * filmstrip in the browse posture (hamburger menu open→close was enough),
	 * so there the restore is clearing the inline property — the posture
	 * stylesheet then answers per 13i.1c/13i.1d.
	 */
	restorePresentationControlsAfterWizard(): void {
		const container = document.getElementById('document-container');
		if (container && container.classList.contains('landscape')) return;
		const pcw = document.getElementById('presentation-controls-wrapper');
		if (!pcw) return;
		if (this.vulcanPostureGovernsFilmstrip()) pcw.style.removeProperty('display');
		else pcw.style.display = 'block';
	}

	/**
	 * Mirrors the READ posture onto <html> as `vulcan-read-posture`, so phone
	 * CSS can be scoped to it.
	 *
	 * There was NO read-posture signal reachable from the phone chrome before
	 * this. The stock one is `.readonly` on #toolbar-wrapper, and Map.js adds
	 * and removes it inside `if (window.mode.isDesktop() || window.mode
	 * .isTablet())` -- so on a phone it is never written, and cool.css
	 * `#toolbar-wrapper.readonly:not(.spreadsheet) { display: none }` never
	 * fires there. (Map.js DOES put `.readonly` on the map container's parent
	 * unconditionally, but that element is a descendant-side sibling of the
	 * toolbar, so it cannot scope a rule on the toolbar without :has().)
	 *
	 * Shape copied from `html.vulcan-formula-editing` (Control.Toolbar.js,
	 * consumed by §13-CALC.5): one class on the document element, written from
	 * the one handler that already runs on every permission change, so a CSS
	 * rule and the posture cannot drift apart.
	 *
	 * Phone only -- the caller is already inside `isSmallScreenDevice()`.
	 * Desktop and tablet never receive the class, so every rule scoped on it is
	 * unmatched there and substituting it away recovers the stock behaviour
	 * byte for byte.
	 *
	 * @param isReadPosture - true when the document is NOT in edit permission.
	 */
	stampReadPosture(isReadPosture: boolean): void {
		document.documentElement.classList.toggle(
			'vulcan-read-posture',
			isReadPosture,
		);
		// The stamp is the single posture authority, so it also clears any
		// inline display a stock write site left on the filmstrip wrapper —
		// an inline value outranks 13i.1c/13i.1d forever, which is exactly
		// how build #9 kept the strip docked in browse. Self-healing on BOTH
		// flips: a stray inline `block` dies at the read stamp, a stray
		// `none` dies at the edit stamp. Predicate false (desktop, tablet,
		// Draw, declared-desktop phones) leaves inline state untouched.
		if (this.vulcanPostureGovernsFilmstrip()) {
			const pcw = document.getElementById('presentation-controls-wrapper');
			if (pcw) pcw.style.removeProperty('display');
		}
		// R6-18: leaving READ must put the chrome back, and it cannot wait for
		// a scroll -- the pencil tap is exactly the case where no further scroll
		// arrives, and a reader who had scrolled the header away would land in
		// edit mode with a keyboard and no ✓ Done. Done HERE and not in the
		// section's own gate re-read for that reason: this is the one handler
		// that certainly runs on the flip. Idempotent both ways (setEnabled is a
		// no-op when the arming has not changed), and absent on desktop, tablet
		// and any document where nothing ever armed it.
		this.vulcanSyncReadImmersion(!isReadPosture);
		// the phone Writer read apron comes and goes with this
		// stamp, so the map's bounds follow it here.
		const docLayer: any = app.map && app.map._docLayer;
		if (docLayer && docLayer._vulcanRefreshApronBounds)
			docLayer._vulcanRefreshApronBounds();
		this.emitPosture();
	}

	/**
	 * Disarm the read immersion when the document leaves READ posture, forcing
	 * the chrome back and clearing the fork's own hidden stamp.
	 *
	 * Deliberately one-directional. Leaving read DISARMS here; entering read
	 * does not arm here, because arming is a decision the section re-reads from
	 * the DOM on every movement and the chrome should be SHOWN the moment a
	 * document becomes readable anyway. Failing toward chrome on both edges is
	 * the whole safety property.
	 */
	vulcanSyncReadImmersion(leftReadPosture: boolean): void {
		if (!leftReadPosture) return;
		const scroll: any = app.sectionContainer
			&& app.sectionContainer.getSectionWithName(app.CSections.Scroll.name);
		if (scroll && typeof scroll.setVulcanImmersionArmed === 'function')
			scroll.setVulcanImmersionArmed(false);
		else if (app.readImmersion)
			app.readImmersion.setEnabled(false);
		document.documentElement.classList.remove('vulcan-chrome-hidden');
	}

	/**
	 * Tell the host which posture and chrome the fork is actually in.
	 *
	 * NONE of the fork's other outbound messages carries permission, so without
	 * this the host cannot tell READ from EDIT -- and the one-bar contract needs
	 * it to. The host publishes Comment and the document menu into its own
	 * header only while the fork's band is hidden; in EDIT that band returns
	 * (it carries undo, redo and the two wizards), and a host still painting
	 * those two would be the duplicate-control defect §13-WRITER.2 exists to
	 * prevent, one row up.
	 *
	 * READ FROM THE DOM, not from a parameter, so this can be re-emitted at any
	 * time without a caller having to remember the current state. The class IS
	 * the source of truth -- it is what §13-WRITER.4 matches on -- so a message
	 * derived from it cannot drift from the CSS.
	 *
	 * Called from TWO places on purpose. stampReadPosture covers every
	 * permission change; sendVulcanReady re-announces at load. Only the second
	 * makes the feature reliable: permission can settle BEFORE the host has
	 * finished mounting its listener, and posture otherwise re-fires only on a
	 * change that may never come -- so a dropped first message would leave
	 * one-bar silently switched off for the whole session, with nothing in any
	 * log to say so. It fails safe (the band stays), which is exactly what
	 * makes it the kind of dead feature nobody notices.
	 *
	 * PhoneChrome is sent explicitly rather than implied: the host's breakpoint
	 * (useIsMobile, 768) and the fork's isSmallScreenDevice() DISAGREE on a
	 * 768px tablet, which renders the takeover header while getting stock fork
	 * chrome. The host has to gate on our answer, not on its own.
	 */
	emitPosture(): void {
		const root = document.documentElement.classList;
		this.map.fire('postMessage', {
			msgId: 'Vulcan_Posture',
			args: {
				Posture: root.contains('vulcan-read-posture') ? 'read' : 'edit',
				PhoneChrome: root.contains('vulcan-mobile-chrome'),
				DocType: this.map.getDocType(),
				// R6-18 immersive read, host half. A SIBLING FIELD on the
				// posture message the host already listens to, not a new
				// channel: the host's takeover header and this frame's own band
				// are two halves of one bar count, and splitting them across two
				// messages would let them disagree by one dropped frame.
				//
				// Read from the DOM for the same reason Posture is: the class is
				// what §13-WRITER.5 matches on, so a message derived from it
				// cannot drift from what is painted, and emitPosture stays
				// re-emittable from anywhere with no caller state.
				//
				// A host that predates the field ignores it and keeps its header
				// exactly as today -- fork-new + host-old is a real deployment
				// state, the fork being a pinned image and the host a separate
				// deploy, and the safe direction is chrome.
				Chrome: root.contains('vulcan-chrome-hidden') ? 'hidden' : 'shown',
			},
		});
	}

	/**
	 * Event handler for updating document permission.
	 * @param e - The event object containing permission details.
	 */
	onUpdatePermission(e: any): void {
		if (window.mode.isSmallScreenDevice()) {
			if (e.detail.perm === 'edit') {
				history.pushState({context: 'app-started'}, 'edit-mode');
				$('#toolbar-down').show();
			}
			else {
				history.pushState({context: 'app-started'}, 'readonly-mode');
				$('#toolbar-down').hide();
			}
			this.stampReadPosture(e.detail.perm !== 'edit');
		}

		var enableNotebookbar = this.shouldUseNotebookbarMode();
		if (enableNotebookbar && !window.mode.isSmallScreenDevice()) {
			if (e.detail.perm === 'edit') {
				this.removeClassicUI();
				// Avoid re-refreshing the notebookbar if it is already initialized.
				// `addNotebookbarUI()` triggers a full refresh (remove + re-add), which temporarily
				if (!this.isNotebookbarInitialized()) {
					this.makeSpaceForNotebookbar();
					this.addNotebookbarUI();
				} else {
					// Still refresh command values when switching back to edit.
					this.map.sendInitNotebookbarCommands();
				}
			} else if (e.detail.perm === 'readonly') {
				if (this.map.sidebar && this.map.sidebar.isVisible()) {
					this.map.sidebar.closeSidebar();
					app.socket.sendMessage('uno .uno:SidebarHide');
				}
				this.removeNotebookbarUI();
				this.addClassicUI();
			} else {
				app.socket.sendMessage('uno .uno:SidebarHide');
			}
		}
	}


	refreshTheme(): void {
		if (typeof window.initializedUI === 'function') {
			window.initializedUI();
		}
	}

	/**
	 * Updates the view information.
	 */
	onUpdateViews(): void {
		if (!this.map._docLayer || typeof this.map._docLayer._viewId === 'undefined')
			return;

		var myViewId = this.map._docLayer._viewId;
		var myViewData = this.map._viewInfo[myViewId];
		if (!myViewData) {
			console.error('Not found view data for viewId: "' + myViewId + '"');
			return;
		}

		var userPrivateInfo = myViewData.userprivateinfo;
		if (window.documentSigningEnabled) {
			if (userPrivateInfo && this.getCurrentMode() === 'notebookbar') {
				const show = userPrivateInfo.SignatureCert && userPrivateInfo.SignatureKey;
				// Show or hide the signature button on the notebookbar depending on if we
				// have a signing cert/key specified.
				this.showButton('signature', show);
			}
			const serverPrivateInfo = myViewData.serverprivateinfo;
			if (serverPrivateInfo) {
				const baseUrl = serverPrivateInfo.ESignatureBaseUrl;
				const clientId = serverPrivateInfo.ESignatureClientId;
				if (baseUrl !== undefined && !this.map.eSignature) {
					this.map.eSignature = new cool.ESignature(baseUrl, clientId);
				}
			}
		}
	}

	/**
	 * Enters read-only mode or closes the app.
	 */
	enterReadonlyOrClose(): void {
		if (this.map.isEditMode()) {
			const enterReadonly = () => {
				// The user may have kept typing while the notes write was in
				// flight. Do not let an older completion flip that newer draft to
				// readonly; flushBeforeReadonly resolves false in that case.
				if (!this.map.isEditMode()) return;
				this.map.setPermission('readonly');
				const toolbar = app.map.topToolbar;
				if (toolbar) {
					toolbar.selectItem('closemobile', false);
					toolbar.selectItem('close', false);
				}
			};

			// sendUnoCommand rejects document mutations after setPermission has
			// flipped. Speaker Notes therefore owns the one narrow asynchronous
			// seam here: wait for its exact command acknowledgement AND its
			// authoritative presentationinfo readback before leaving edit mode.
			if (VulcanSpeakerNotes.isPhoneImpressChrome()) {
				const speakerNotes = VulcanSpeakerNotes.get();
				if (speakerNotes.hasPendingEdits()) {
					speakerNotes.flushBeforeReadonly().then((saved) => {
						if (saved && !speakerNotes.hasPendingEdits()) enterReadonly();
					});
					return;
				}
			}

			enterReadonly();
		} else {
			app.dispatcher.dispatch('closeapp');
		}
	}

	/**
	 * Handles mobile back navigation.
	 * @param popStateEvent - The popstate event.
	 */
	/**
	 * Ends a running slide show, if there is one, so Back leaves the show
	 * before it starts unwinding the editor.
	 *
	 * A real full-screen show never gets here: the browser spends Back on
	 * leaving full screen and fires fullscreenchange instead of popstate. This
	 * is for the in-page fallback show, which used to swallow nothing — Back
	 * dropped the document to readonly or closed the app with the slides still
	 * covering the screen.
	 * @returns true when a show was ended and Back is spent.
	 */
	private exitSlideshowOnGoBack(): boolean {
		// BOTH halves of the phone gate, not just the small-screen half.
		// popstate is registered under isSmallScreenDevice() alone, which is
		// NOT the same thing: `?vulcanChrome=desktop` forces the desktop chrome
		// on ANY device without consulting screen size (js/global.js), so a
		// phone loaded that way has isSmallScreenDevice() true and no
		// vulcan-mobile-chrome class. There, the swipe rewrite and the pinned
		// exit are correctly off — and Back must stay off with them, or this is
		// the one change that does not reduce to HEAD when the gate is false.
		if (!(window as any).mode.isSmallScreenDevice() ||
			!document.documentElement.classList.contains('vulcan-mobile-chrome'))
			return false;

		const presenter = this.map.slideShowPresenter;
		if (!presenter || !presenter._checkAlreadyPresenting()) return false;

		presenter.endPresentation(true);
		// Back consumed one of the entries pushed in onAdd. Put it back so the
		// next Back still has one to spend on leaving the editor.
		history.pushState({context: 'app-started'}, 'app-started');
		return true;
	}

	/**
	 * Leaves the Impress Notes view, so an exit spends itself on getting the
	 * slide back before it starts unwinding the editor.
	 *
	 * WHAT NOTES VIEW ACTUALLY IS HERE, because it is not what Google Slides
	 * does. google-slides.json "Speaker notes pane" (formatting, common):
	 * "Toggle Speaker notes from the editor's overflow menu; a 'Tap to add
	 * speaker notes' region appears below the slide and is fully editable
	 * inline." The slide stays. Our kebab row dispatches the stock 'notesmode'
	 * action, which sends `.uno:NotesMode` (docdispatcher.ts) — a SERVER-side
	 * view-mode switch. Core then renders the notes page as the document, the
	 * context flips to 'NotesPage', and ImpressTileLayer._onContextChange
	 * swaps activeModes and refreshes every tile. It is a whole-canvas swap.
	 *
	 * 🔴 A Slides-shaped pane is NOT reachable from this fork and this change
	 * does not claim one. Notes exist client-side in exactly one place —
	 * SlideShowPresenter.getNotes(), reading _presentationInfo — and that is
	 * populated only by 'getpresentationinfo', which is sent when a
	 * presentation STARTS (SlideShowPresenter _onStart / _onStartInWindow).
	 * There is no editor-time notes feed to render beside the slide, and that
	 * text would be read-only anyway where Google's pane is editable inline.
	 * Showing notes without losing the slide needs a second rendered stream;
	 * that is a core/protocol change, not a browser one.
	 *
	 * So the swap stays, and what improves is that it is REVERSIBLE from the
	 * exit the user already has. Before this, the upper-left ✓ dropped you to
	 * the read posture with the notes page still on screen, and the kebab's own
	 * Speaker Notes row cannot get you back from there: in read-only mode
	 * Toolbar.js sendUnoCommand silently drops any command outside
	 * allowedCommands, and `.uno:NotesMode` is not in that list. Notes view was
	 * a one-way door on the phone — and a sticky one: ImpressTileLayer
	 * _handleViewModeState reports the switch as `updateviewmode mode=notes`,
	 * which the WOPI host persists per user per document.
	 *
	 * @returns true when notes view was left and the exit is spent.
	 */
	private exitPhoneNotesView(): boolean {
		// BOTH halves of the phone gate, exactly as exitSlideshowOnGoBack
		// argues above: the ✓ handler and popstate are registered under
		// isSmallScreenDevice() alone, and `?vulcanChrome=desktop` gives a
		// phone that half without the chrome class. With the gate false this
		// returns false and every caller reproduces HEAD.
		if (!(window as any).mode.isSmallScreenDevice() ||
			!document.documentElement.classList.contains('vulcan-mobile-chrome'))
			return false;

		if (this.map.getDocType() !== 'presentation') return false;
		if (!app.impress || !app.impress.notesMode) return false;

		// Only claim the layer if the way out can actually be sent. In the read
		// posture Toolbar.js sendUnoCommand drops `.uno:NormalMultiPaneGUI`
		// (not in allowedCommands), so taking the tap here would swallow it and
		// leave the notes page on screen — a dead exit, which is worse than the
		// one-way door. There, the tap falls through to the HEAD behaviour.
		// Notes view is only ENTERABLE in edit mode for the same reason, so the
		// read-only case needs the permission to have flipped underneath it.
		if (!this.map.isEditMode()) return false;

		// One owner for the toggle: the dispatcher action already chooses
		// .uno:NormalMultiPaneGUI vs .uno:NotesMode from app.impress.notesMode,
		// and it is the same action the kebab row sends, so the two cannot
		// disagree about which direction the toggle goes.
		app.dispatcher.dispatch('notesmode');
		return true;
	}

	/**
	 * Is the soft keyboard up, as far as this frame can know?
	 *
	 * ONE TERM, AND IT IS THE ONLY ONE THAT IS TRUE ON THIS SURFACE.
	 * `data-vulcan-keyboard-open` has a single writer — global.js'
	 * `vulcanSetHostKeyboard`, applying the host's `Vulcan_HostKeyboard`
	 * message — and on phone Impress the host is the ONLY source there is:
	 * Capacitor runs `Keyboard resize: 'none'`, the host mounts the editor in
	 * a fixed takeover whose iframe box never changes size, and inside a
	 * cross-origin iframe `visualViewport` describes THIS frame, so it never
	 * shrinks either (global.js' own trace, `vulcanApplyBodyHeight`). It is
	 * also the term the fork's own stylesheet already treats as "the keyboard
	 * is up" (vulcan-theme.css §13-CALC), so the Back arm below and the CSS
	 * cannot disagree about the keyboard's state.
	 *
	 * 🔴 NOT `_textInput.hasFocus()`, and not `getMobileKeyboardVisibility()`.
	 * The first over-reports exactly where the host is right: a keyboard the
	 * PLATFORM took down (app switch, hardware keyboard) is corrected by
	 * Map.WOPI's `open === false` arm as "the latch and the intent window
	 * only, never a blur", so the hidden editable still holds DOM focus over a
	 * keyboard that is gone. The second answers a different question entirely
	 * — may a CLICK raise the keyboard — and VO-P-0011 already paid for
	 * mistaking it for this one (its row B3 reads false whether the transition
	 * under it is right or wrong, because the keyboard on that leg is raised
	 * by core's cursor round trip, not by the click grammar).
	 *
	 * Fail-open, and in the direction that cannot descend: a host that never
	 * sends the message leaves the attribute absent, so a Back in text edit
	 * ends the text edit and keeps the selection on the FIRST press instead of
	 * the second. That is one press early, never one rung deep.
	 */
	private vulcanPhoneKeyboardUp(): boolean {
		return document.documentElement.hasAttribute('data-vulcan-keyboard-open');
	}

	/**
	 * The phone Impress floor for hardware Back / the iPhone edge-swipe-back:
	 * Back stops at the SELECTION instead of walking the exit ladder.
	 *
	 * WHAT THE REFERENCE DOES (M-0018, measured 2026-09-01 leg by leg, each
	 * leg asserting its origin, and calibrated against known positives in the
	 * same session — the same key dismissed a popup, collapsed the keyboard
	 * and left the document from the read stream, so the inertness below is
	 * the app's and not a dead injection):
	 *
	 *   S0  read stream                  Back leaves the document
	 *   S1  edit canvas, no selection     Back is INERT
	 *   S2  object selected               Back is INERT
	 *   S2t table selection               Back is INERT
	 *   S3  text edit, keyboard UP        Back is consumed by the IME ONLY
	 *   S3  text edit, keyboard DOWN      Back ends the text edit, keeps S2
	 *
	 * (Slides' own state names, per RU-16 — Impress is not mapped onto Calc's
	 * mode vocabulary.) Ours ran `VulcanEscape.popOneLayer()` once per press,
	 * so every press after the second was a rung the reference does not take:
	 * text edit -> selection -> edit posture -> read posture -> leave.
	 *
	 * 🔴 CS-4'S RATIONALE IS UNTOUCHED. A Back must never silently flip
	 * permission or close a sheet plus every dialog in one press, and it still
	 * cannot: this narrows WHICH rungs Back shares with the host's chevron
	 * (the top two) rather than reintroducing the multi-effect arms. The
	 * chevron's own ladder S3 -> S2 -> S1 -> S0 is unchanged — M-0018 measures
	 * the per-rung descent on the upper-left control, and VO-P-0011's group E
	 * pins it.
	 *
	 * THREE SCOPES, so nothing else moves:
	 *  · both halves of the phone gate, like `exitSlideshowOnGoBack` and
	 *    `exitPhoneNotesView` — with the gate false this returns false and the
	 *    caller reproduces HEAD;
	 *  · IMPRESS ONLY. M-0018 is an Impress record. Calc's and Writer's Back
	 *    rows are unmeasured, and nothing here licenses changing them;
	 *  · ABOVE THE CANVAS IS NOT OURS. With any wizard window open the ladder's
	 *    overlay rungs answer as they do today (popOneLayer -> goLevelUp), so
	 *    sheets, dialogs, the mobile wizard and the drill-in pickers keep their
	 *    own Back. Only the canvas rungs become a floor.
	 *
	 * @returns true when Back is spent on the canvas floor.
	 */
	private vulcanImpressBackStopsAtSelection(escape: any): boolean {
		// BOTH halves of the phone gate, exactly as exitSlideshowOnGoBack
		// argues: popstate is registered under isSmallScreenDevice() alone, and
		// `?vulcanChrome=desktop` gives a phone that half without the chrome
		// class. There, this returns false and Back keeps today's ladder.
		if (!(window as any).mode.isSmallScreenDevice() ||
			!document.documentElement.classList.contains('vulcan-mobile-chrome'))
			return false;

		if (this.map.getDocType() !== 'presentation') return false;
		// The upper rungs are unchanged: with a sheet, a dialog or a drill-in
		// picker open, this press belongs to that layer.
		if (escape.overlayCount() > 0) return false;
		// The read posture is M-0018's S0 row, and it is the one row where Back
		// still leaves — read as the permission, not as the ladder's posture
		// rung, so a canvas state the rung predicate cannot see still lands on
		// the floor rather than on `closeapp`.
		if (!this.map.isEditMode()) return false;

		if (escape.topKind() === 'textedit') {
			if (this.vulcanPhoneKeyboardUp()) {
				// S3 + keyboard up: the IME eats the press and NOTHING else —
				// the caret and the text edit stay. This is the door
				// VulcanImpressTextZoom already uses for the settled end of an
				// edit; it takes DOM focus off the hidden editable and sends
				// core nothing, so the text edit is untouched.
				const textInput: any = this.map ? this.map._textInput : null;
				if (textInput && typeof textInput.dismissSoftKeyboard === 'function')
					textInput.dismissSoftKeyboard();
			} else {
				// S3 + keyboard down: end the text edit and KEEP the selection
				// (S2/S2t). Exactly one rung, through the ladder that already
				// owns that boundary — one implementation, per CS-4 — which
				// here is the 'textedit' rung's core Escape. overlayCount() is
				// 0 and topKind() is 'textedit', so popOneLayer provably takes
				// that rung and cannot reach the object rung or the posture.
				escape.popOneLayer();
			}
		}
		// S1 / S2 / S2t: nothing at all. Not a deselect, not a posture pop, not
		// a permission change, not `closeapp`.

		// Back consumed one of the entries pushed in onAdd. Put it back — on
		// every arm above, including the pop — or the next press has nothing to
		// spend and Safari navigates away for real. Same bookkeeping as
		// exitNotesViewOnGoBack and exitSlideshowOnGoBack.
		history.pushState({context: 'app-started'}, 'app-started');
		return true;
	}

	onGoBack(popStateEvent: any): void {
		if (this.exitSlideshowOnGoBack()) return;

		if (popStateEvent.state && popStateEvent.state.context) {
			// CS-4. Under phone chrome the hardware/browser back runs the
			// SAME ladder as the host's chevron. Before this, two of the
			// three arms called enterReadonlyOrClose(), so a hardware back
			// could silently change the document's permission and — with a
			// sheet open — close the sheet, close every dialog and clear the
			// selection in one press (Control.Permission.js:701-702). One
			// press, one layer, one implementation.
			const escape = (window as any).VulcanEscape;
			if (escape
				&& document.documentElement.classList.contains('vulcan-mobile-chrome')
				&& window.mode.isSmallScreenDevice()) {
				// ...and on phone Impress the ladder Back shares with the
				// chevron stops at the selection (M-0018; VO-P-0017). Ahead of
				// popOneLayer because it is the arm that must NOT pop.
				if (this.vulcanImpressBackStopsAtSelection(escape)) return;
				// A press spent on a layer that pushed no history of its own
				// (the Calc function browser, Calc's cell edit and edit-ready
				// units: VulcanEscape.lastPopPushedNoHistory) puts the entry
				// back, as exitSlideshowOnGoBack does, so stepping them costs
				// the Android host's goBack() budget nothing.
				if (escape.popOneLayer()) {
					if (escape.lastPopPushedNoHistory())
						history.pushState({context: 'app-started'}, 'app-started');
					return;
				}
				app.dispatcher.dispatch('closeapp');
				return;
			}
			if (popStateEvent.state.context === 'mobile-wizard' && this.mobileWizard) {
				if (this.mobileWizard.isOpen()) {
					this.mobileWizard.goLevelUp(true);
				} else if (!this.exitNotesViewOnGoBack()) {
					this.enterReadonlyOrClose();
				}
			} else if (popStateEvent.state.context === 'app-started') {
				if (!this.exitNotesViewOnGoBack())
					this.enterReadonlyOrClose();
			}
		}
	}

	/**
	 * Back-button wrapper around exitPhoneNotesView: same layer, same both-
	 * halves gate, plus the history bookkeeping exitSlideshowOnGoBack does.
	 * @returns true when notes view was left and Back is spent.
	 */
	private exitNotesViewOnGoBack(): boolean {
		if (!this.exitPhoneNotesView()) return false;

		// Back consumed one of the entries pushed in onAdd. Put it back so the
		// next Back still has one to spend on leaving the editor.
		history.pushState({context: 'app-started'}, 'app-started');
		return true;
	}

	// Blocking UI

	/**
	 * Returns whether the UI is blocked.
	 */
	isUIBlocked(): boolean {
		return this.blockedUI;
	}

	/**
	 * Blocks the UI and displays a busy popup.
	 * @param event - Event containing an optional message.
	 */
	blockUI(event: any): void {
		this.blockedUI = true;
		this.map.fire('showbusy', {label: event ? event.message : null});

		const canvas = document.getElementById('document-canvas');
		if (canvas) canvas.style.pointerEvents = 'none'; // To remove the need for checking isUIBlocked.
	}

	/**
	 * Unblocks the UI and hides the busy popup.
	 */
	unblockUI(): void {
		this.blockedUI = false;
		this.map.fire('hidebusy');

		const canvas = document.getElementById('document-canvas');
		if (canvas) canvas.style.pointerEvents = '';
	}

	// Document area tooltip

	/**
	 * Sets the tooltip text for an element.
	 * @param element - The target element.
	 * @param text - Tooltip text.
	 */
	private _setTooltipText(element: any, text: string): void {
		var dummyNode = window.L.DomUtil.create('div');
		dummyNode.innerText = text;
		element.tooltip('option', 'content', dummyNode.innerHTML);
	}

	/**
	 * Shows general tooltips in the document area
	 * @param tooltipInfo - contains rectangle (position in twips) and text properties.
	 */
	showDocumentTooltip(tooltipInfo: any): void {
		// A redline tooltip (has redlineType) must not appear while tracked
		// changes are hidden in this view. Core reports the hover regardless of
		// the client-side show/hide state. Side-by-side compare mode always
		// shows redline tooltips and manages its own state.
		if (tooltipInfo.redlineType) {
			const isSideBySide =
				app.activeDocument?.activeLayout?.type === 'ViewLayoutCompareChanges';
			if (
				!isSideBySide &&
				this.map['stateChangeHandler'].getItemValue('.uno:ShowTrackedChanges') !== 'true'
			)
				return;
		}

		var split = tooltipInfo.rectangle.split(',');

		// Go via SimplePoint(), which is aware of the active layout.
		const point = new cool.SimplePoint(+split[0], +split[1]);

		const layout = app.activeDocument?.activeLayout;
		if (layout && layout.type === 'ViewLayoutCompareChanges') {
			// Map from document to canvas coordinates using the last used tile mode.
			const compareLayout = layout as ViewLayoutCompareChanges;
			point.mode = compareLayout.lastTileMode;
		}

		const pt = { x: Math.round(point.vX / app.dpiScale), y: Math.round(point.vY / app.dpiScale) };

		var elem = $('.leaflet-layer');

		elem.tooltip();
		elem.tooltip('enable');
		this._setTooltipText(elem, tooltipInfo.text);
		elem.tooltip('option', 'items', elem[0]);
		elem.tooltip('option', 'position', { my: 'left bottom-50%',  at: 'left+' + pt.x + ' top+' + pt.y, collision: 'fit fit' });
		elem.tooltip('open');

		if (
			tooltipInfo.anchorRectangles &&
			tooltipInfo.redlineType &&
			app.activeDocument?.activeLayout?.type === 'ViewLayoutCompareChanges'
		) {
			// Tooltip for a redline when comparing side by side: create the sections.
			const sides = [
				{ name: app.CSections.TooltipAnchorLeft.name, mode: TileMode.LeftSide },
				{ name: app.CSections.TooltipAnchorRight.name, mode: TileMode.RightSide },
			];
			for (const side of sides) {
				if (!app.sectionContainer.doesSectionExist(side.name)) {
					app.sectionContainer.addSection(new cool.TooltipAnchorSection(side.name, side.mode));
				}
				const section = app.sectionContainer.getSectionWithName(side.name) as cool.TooltipAnchorSection;
				section.drawAnchorRectangles(tooltipInfo.anchorRectangles, tooltipInfo.redlineType);
			}
		}

		const hideTooltip = function() {
			elem.tooltip('close');
			elem.tooltip('disable');

			// Tooltip for a redline when comparing side by side: delete the sections.
			const sideNames = [app.CSections.TooltipAnchorLeft.name, app.CSections.TooltipAnchorRight.name];
			for (const name of sideNames) {
				if (app.sectionContainer.doesSectionExist(name)) {
					const section = app.sectionContainer.getSectionWithName(name) as cool.TooltipAnchorSection;
					section.hideAnchorRectangles();
				}
			}
			document.removeEventListener('mousemove', hideTooltip);
			document.removeEventListener('wheel', hideTooltip);
			document.removeEventListener('pointerdown', hideTooltipOnTouch);
			document.removeEventListener('keydown', hideTooltipOnKey, { capture: true } as any);
		};

		const hideTooltipOnKey = function(e: KeyboardEvent) {
			if (e.key === 'PageUp' || e.key === 'PageDown') {
				hideTooltip();
			}
		};

		// A finger produces none of the three dismissers below, so on touch
		// this tooltip had none at all and stayed up until something else
		// moved a mouse. The next press is touch's "I am done with that".
		// Mouse pointers are excluded rather than gated on the phone chrome:
		// they already have mousemove, and a dismisser they do not have today
		// is a desktop behaviour change however small.
		const hideTooltipOnTouch = function(e: PointerEvent) {
			if (e.pointerType !== 'mouse') hideTooltip();
		};

		document.addEventListener('mousemove', hideTooltip);
		document.addEventListener('wheel', hideTooltip);
		document.addEventListener('pointerdown', hideTooltipOnTouch);
		document.addEventListener('keydown', hideTooltipOnKey, { capture: true });
	}

	// Snack bar

	/**
	 * Closes the snackbar the caller showed.
	 */
	closeSnackbar(): void {
		JSDialog.SnackbarController.closeUnkeyed();
	}

	/**
	 * Displays a snackbar notification.
	 * @param label - Message text.
	 * @param action - Action text.
	 * @param callback - Callback to execute on action.
	 * @param timeout - Duration before auto-dismiss.
	 * @param hasProgress - Whether to show a progress bar.
	 * @param withDismiss - Whether a dismiss button is included.
	 * @param infinite - If true, shows an indeterminate progress bar.
	 */
	showSnackbar(
		label: string,
		action?: string | null,
		callback?: any,
		timeout?: number,
		hasProgress?: boolean,
		withDismiss?: boolean,
	): void {
		JSDialog.SnackbarController.showSnackbar(label, action, callback, timeout, hasProgress, withDismiss);
	}

	/**
	 * Displays a snackbar with no timeout until dismissSnackbar(key). Showing a
	 * key already on screen or queued does nothing.
	 */
	showStickySnackbar(key: string, label: string): void {
		JSDialog.SnackbarController.showSticky(key, label);
	}

	/**
	 * Takes down showStickySnackbar(key)'s snackbar without moving focus.
	 */
	dismissSnackbar(key: string): void {
		JSDialog.SnackbarController.dismiss(key);
	}

	/**
	 * Displays a snackbar with a progress bar.
	 */
	showProgressBar(
		message: string,
		buttonText: string,
		callback: any,
		timeout?: number,
		withDismiss?: boolean,
		infinite?: boolean,
	): void {
		JSDialog.SnackbarController.showSnackbar(message, buttonText, callback, timeout ? timeout : -1, true, withDismiss, infinite);
	}

	/**
	 * Updates the progress value on the snackbar.
	 * @param value - Progress value (0–100).
	 * @param infinite - If true, shows an indeterminate progress bar.
	 */
	setSnackbarProgress(value: number, infinite?: boolean): void {
		JSDialog.SnackbarController.setSnackbarProgress(value, infinite);
	}

	private _legacyUnoApiSnackbarShown = false;
	private _legacyUnoApiSnackbarPending = false;
	private _legacyUnoApiDocLoaded = false;

	showLegacyUnoApiSnackbarOnce(): void {
		if (this._legacyUnoApiSnackbarShown) return;
		if (!this._legacyUnoApiDocLoaded) {
			this._legacyUnoApiSnackbarPending = true;
			return;
		}
		this._legacyUnoApiSnackbarShown = true;
		this.showSnackbar(
			_(
				'An embedded script uses the legacy com.sun.star UNO API, which may be removed in future releases.',
			),
			null,
			null,
			-1,
			false,
			true,
		);
	}

	private _onDocLoadedForLegacyUnoApiSnackbar(e: { status?: boolean }): void {
		if (!e || !e.status) return;
		this._legacyUnoApiDocLoaded = true;
		if (this._legacyUnoApiSnackbarPending) {
			this._legacyUnoApiSnackbarPending = false;
			this.showLegacyUnoApiSnackbarOnce();
		}
	}

	// Modals

	/**
	 * Displays a modal dialog.
	 * @param json - JSON configuration for the dialog.
	 * @param callbacks - Array of callback configurations.
	 * @param cancelButtonId - Optional ID for the cancel button.
	 */
	showModal(json: any, callbacks: any[], cancelButtonId?: string): void {
		var builderCallback = (objectType: any, eventType: any, object: any, data: any) => {
			window.app.console.debug("modal action: '" + objectType + "' id:'" + object.id + "' event: '" + eventType + "' state: '" + data + "'");

			// default close methods
			callbacks.push({id: (cancelButtonId ? cancelButtonId: 'response-cancel'), func: () => { this.closeModal(json.id); }});
			callbacks.push({id: '__POPOVER__', func: () => { this.closeModal(json.id); }});

			for (var i in callbacks) {
				var callback = callbacks[i];
				if (object.id === callback.id && (!callback.type || eventType === callback.type)) {
					callback.func(objectType, eventType, object, data);
				}
			}
		};

		app.socket._onMessage({textMsg: 'jsdialog: ' + JSON.stringify(json), callback: builderCallback});
	}

	/**
	 * Closes a modal dialog.
	 * @param dialogId - The ID of the dialog to close.
	 * @param focusHandled - Vulcan Office: leaves focus where it is, where by
	 * default the close gives it back to what had it when the dialog opened,
	 * or to the document.
	 */
	closeModal(dialogId: string, focusHandled?: boolean): void {
		var closeMessage: any = { id: dialogId, jsontype: 'dialog', type: 'modalpopup', action: 'close' };
		if (focusHandled)
			closeMessage.focusHandled = true;
		app.socket._onMessage({ textMsg: 'jsdialog: ' + JSON.stringify(closeMessage) });
	}

	/**
	 * Closes all open dialogs.
	 * @param leaveSnackbar - Leaves the snackbar open.
	 * @param focusHandled - Vulcan Office: leaves focus where it is, where by
	 * default each close gives it back to what had it when that dialog opened.
	 */
	closeAll(leaveSnackbar?: boolean, focusHandled?: boolean): void {
		if (this.map.jsdialog)
			this.map.jsdialog.closeAll(leaveSnackbar, /* leaveAlert */ false, focusHandled);
		else
			this.mobileWizard._closeWizard();
	}

	/**
	 * Returns whether any dialog is currently open.
	 */
	isAnyDialogOpen(): boolean {
		if (this.map.jsdialog)
			return this.map.jsdialog.hasDialogOpened();
		else if (this.mobileWizard)
			return this.mobileWizard.isOpen();
		else
			return false;
	}

	/**
	 * Returns whether any context menu is currently open.
	 */
	isAnyContextMenuOpened(): boolean {
		const jqContextMenu = document.querySelector(
			'.context-menu-root:not([style*="display: none"])',
		);

		const jsdContextMenu = document.querySelector(
			'#jsd-context-menu-dropdown-overlay:not([style*="display: none"])',
		);

		return (jqContextMenu !== null) || (jsdContextMenu !== null);
	}

	// TODO: remove and use JSDialog.generateModalId directly
	generateModalId(givenId: string): string {
		return JSDialog.generateModalId(givenId);
	}

	/**
	 * Constructs JSON for a modal dialog.
	 * @param id - Base ID.
	 * @param title - Dialog title. No titlebar if missing.
	 * @param cancellable - Whether the dialog is cancellable.
	 * @param widgets - Array of widget configurations.
	 * @param focusId - Optional focus element ID.
	 * @param clickToDismiss - Optional flag for click-to-dismiss behavior.
	 */
	private _modalDialogJSON(
		id: string,
		title: string | undefined,
		cancellable: boolean,
		widgets: any[],
		focusId?: string,
		clickToDismiss?: boolean,
	): any {
		var dialogId = this.generateModalId(id);
		return {
			id: dialogId,
			dialogid: id,
			type: 'modalpopup',
			title: title,
			hasClose: title !== undefined,
			hasOverlay: true,
			cancellable: cancellable,
			jsontype: 'dialog',
			'init_focus_id': focusId,
			clickToDismiss: clickToDismiss,
			children: [
				{
					id: 'info-modal-container',
					type: 'container',
					vertical: true,
					children: widgets,
				},
			]
		};
	}

	/// DEPRECATED: use JSDialog.showInfoModalWithOptions instead
	/// shows simple info modal (message + ok button)
	/// When called with just an id (one argument), the popup will be click dismissable.
	/// id - id of a dialog
	/// title - title of a dialog
	/// message1 - 1st line of message
	/// message2 - 2nd line of message
	/// buttonText - text inside button
	/// callback - callback on button press
	/// withCancel - specifies if needs cancel button also
	showInfoModal(
		id: string,
		title: string | undefined,
		message1: string,
		message2: string | null,
		buttonText: string,
		callback: any = null,
		withCancel: boolean = false,
		focusId?: string,
	): void {
		var dialogId = this.generateModalId(id);
		var responseButtonId = id + '-response';
		var cancelButtonId = id + '-cancel';
		// If called with only id, then we want clickToDismiss.
		var clickToDismiss = arguments.length < 2;

		var json = this._modalDialogJSON(id, title, true, [
			{
				id: 'info-modal-tile-m',
				type: 'fixedtext',
				text: title,
				hidden: !window.mode.isSmallScreenDevice()
			},
			{
				id: 'info-modal-label1',
				type: 'fixedtext',
				text: message1
			},
			{
				id: 'info-modal-label2',
				type: 'fixedtext',
				text: message2
			},
			{
				id: '',
				type: 'buttonbox',
				text: '',
				enabled: true,
				children: [
					withCancel ? {
						id: cancelButtonId,
						type: 'pushbutton',
						text: _('Cancel')
					} : { type: 'container' },
					{
						id: responseButtonId,
						type: 'pushbutton',
						text: buttonText,
						'has_default': true,
						hidden: buttonText ? false: true // Hide if no text is given. So we can use one modal type for various purposes.
					}
				],
				vertical: false,
				layoutstyle: 'end'
			},
		], focusId, clickToDismiss);

		this.showModal(json, [
			{id: responseButtonId, func: () => {
				var dontClose = false;
				if (typeof callback === 'function')
					dontClose = callback();
				if (!dontClose)
					this.closeModal(dialogId);
			}}
		], cancelButtonId);
		if (!buttonText && !withCancel) {
			// if no buttons better to set tabIndex to negative so the element is not reachable via sequential keyboard navigation but can be focused programmatically
			const dialogElement = document.getElementById(dialogId);
			if (dialogElement != null) {
				dialogElement.tabIndex = -1;
				// We hid the OK button, we need to set focus manually on the popup.
				dialogElement.focus();
				dialogElement.className += ' focus-hidden';
			}
		}
	}

	/**
	 * Displays a modal dialog with a progress bar.
	 */
	showProgressBarDialog(
		id: string,
		title: string,
		message: string,
		buttonText: string,
		callback: any,
		value?: number,
		cancelCallback?: any,
		infinite: boolean = false,
	): void {
		var dialogId = this.generateModalId(id);
		var responseButtonId = id + '-response';
		var cancelButtonId = id + '-cancel';

		var json = this._modalDialogJSON(id, title, true, [
			{
				id: 'info-modal-tile-m',
				type: 'fixedtext',
				text: title,
				hidden: !window.mode.isSmallScreenDevice()
			},
			{
				id: 'info-modal-label1',
				type: 'fixedtext',
				text: message
			},
			{
				id: dialogId + '-progressbar',
				type: 'progressbar',
				value: (value !== undefined && value !== null ? value: 0),
				maxValue: 100,
				infinite: infinite
			},
			{
				id: '',
				type: 'buttonbox',
				text: '',
				enabled: true,
				children: [
					{
						id: cancelButtonId,
						type: 'pushbutton',
						text: _('Cancel')
					},
					{
						id: responseButtonId,
						type: 'pushbutton',
						text: buttonText,
						'has_default': true,
						hidden: buttonText ? false: true // Hide if no text is given. So we can use one modal type for various purposes.
					}
				],
				vertical: false,
				layoutstyle: 'end'
			},
		], buttonText ? responseButtonId : cancelButtonId);

		this.showModal(json, [
			{id: responseButtonId, func: () => {
				var dontClose = false;
				if (typeof callback === 'function')
					dontClose = callback();
				if (!dontClose)
					this.closeModal(dialogId);
			}},
			{id: cancelButtonId, func: () => {
				if (typeof cancelCallback === 'function')
					cancelCallback();
			}}
		], cancelButtonId);
	}

	/**
	 * Updates the progress value in a progress dialog.
	 * @param value - Progress value (0–100).
	 * @param infinite - If true, shows an indeterminate progress bar.
	 */
	setDialogProgress(id: string, value: number, infinite: boolean): void {
		if (!app.socket)
			return;

		var dialogId = this.generateModalId(id);

		var json = {
			id: dialogId,
			jsontype: 'dialog',
			type: 'modalpopup',
			action: 'update',
			control: {
				id: dialogId + '-progressbar',
				type: 'progressbar',
				value: value,
				maxValue: 100,
				infinite: infinite
			}
		};

		app.socket._onMessage({textMsg: 'jsdialog: ' + JSON.stringify(json)});
	}

	/// buttonObjectList: [{id: button's id, text: button's text, ..other properties if needed}, ...]
	/// callbackList: [{id: button's id, func_: function}, ...]
	/// focusHandled: Vulcan Office, the modal opens without taking focus
	/// (JSDialog.setupInitialFocus), for a caller that leaves it where it is.
	showModalWithCustomButtons(
		id: string,
		title: string,
		message: string,
		cancellable: boolean,
		buttonObjectList: any[],
		callbackList: any[],
		errorDetail?: string,
		focusHandled?: boolean,
	): void {
		var dialogId = this.generateModalId(id);

		for (var i = 0; i < buttonObjectList.length; i++)
			buttonObjectList[i].type = 'pushbutton';

		var children: any[] = [
			{
				id: 'info-modal-tile-m',
				type: 'fixedtext',
				text: title,
				hidden: !window.mode.isSmallScreenDevice()
			},
			{
				id: 'info-modal-label1',
				type: 'fixedtext',
				text: message
			},
		];

		if (errorDetail)
			children.push(this._technicalDetailsExpander(errorDetail));

		children.push({
			id: '',
			type: 'buttonbox',
			text: '',
			enabled: true,
			children: buttonObjectList,
			vertical: false,
			layoutstyle: 'end'
		});

		var json = this._modalDialogJSON(id, title, !!cancellable, children);
		if (focusHandled)
			json.focusHandled = true;

		buttonObjectList.forEach((button) => {
			callbackList.forEach((callback) => {
				if (button.id === callback.id) {
					if (typeof callback.func_ === 'function') {
						callback.func = () => {
							callback.func_();
							this.closeModal(dialogId);
						};
					}
					else
						callback.func = () => { this.closeModal(dialogId); };
				}
			});
		});

		this.showModal(json, callbackList);
	}

	/// shows simple input modal (message + input + (cancel + ok) button)
	/// id - id of a dialog
	/// title - title of a dialog
	/// message - message
	/// defaultValue - default value of an input
	/// buttonText - text inside OK button
	/// callback - callback on button press
	showInputModal(
		id: string,
		title: string,
		message: string,
		defaultValue: string,
		buttonText: string,
		callback: (input: string) => void,
		passwordInput?: boolean,
	): void {
		var dialogId = this.generateModalId(id);
		var json = this._modalDialogJSON(id, title, !window.mode.isDesktop(), [
			{
				id: 'info-modal-label1',
				type: 'fixedtext',
				text: message,
				labelFor: 'input-modal',
			},
			{
				id: 'input-modal',
				type: 'edit',
				password: !!passwordInput,
				text: defaultValue,
				labelledBy: 'info-modal-label1'
			},
			{
				id: '',
				type: 'buttonbox',
				text: '',
				enabled: true,
				children: [
					{
						id: 'response-cancel',
						type: 'pushbutton',
						text: _('Cancel'),
					},
					{
						id: 'response-ok',
						type: 'pushbutton',
						text: buttonText,
						'has_default': true,
					}
				],
				vertical: false,
				layoutstyle: 'end'
			},
		], 'input-modal-input');

		this.showModal(json, [
			{id: 'response-ok', func: () => {
				if (typeof callback === 'function') {
					var input = document.getElementById('input-modal-input') as HTMLInputElement;
					callback(input.value);
				}
				this.closeModal(dialogId);
			}}
		]);
	}

	/// Shows an info bar at the bottom right of the view.
	/// This is called by map.fire('infobar', {data}).
	showInfoBar(e: any): void {
		var message = e.msg;
		var link = e.action;
		var linkText = e.actionLabel;

		var id = 'infobar' + Math.round(Math.random() * 10);
		var dialogId = this.generateModalId(id);
		var json = this._modalDialogJSON(id, ' ', !window.mode.isDesktop(), [
			{
				id: dialogId + '-text',
				type: 'fixedtext',
				text: message
			},
			{
				id: '',
				type: 'buttonbox',
				text: '',
				enabled: true,
				children: [
					{
						id: dialogId + '-response',
						type: 'pushbutton',
						text: _(linkText),
						'has_default': true,
					}
				],
				vertical: false,
				layoutstyle: 'end'
			},
		]);

		this.showModal(json,
		[{
			id : dialogId + '-response',
			func : () => {
				if (!link || !linkText)
					return;
				var win = window.open(window.sanitizeUrl(link), '_blank');
				win?.focus();
			}
		}]);

		if (!window.mode.isSmallScreenDevice()) {
			const dialogElement = document.getElementById(dialogId);
			if (dialogElement != null) {
				dialogElement.style.marginRight = '0';
				dialogElement.style.marginBottom = '0';
			}
		}
	}

	/**
	 * Displays a yes/no confirmation modal dialog.
	 */
	showYesNoButton(
		id: string,
		title: string,
		message: string,
		yesButtonText: string,
		noButtonText: string,
		yesFunction: () => void,
		noFunction: () => void,
		cancellable: boolean,
	): void {
		var dialogId = this.generateModalId(id);

		var json = this._modalDialogJSON(id, title, cancellable, [
			{
				id:  dialogId + '-title',
				type: 'fixedtext',
				text: title,
				hidden: !window.mode.isSmallScreenDevice()
			},
			{
				id: dialogId + '-label',
				type: 'fixedtext',
				text: message
			},
			{
				id: '',
				type: 'buttonbox',
				text: '',
				enabled: true,
				children: [
					noButtonText ? {
						id: dialogId + '-nobutton',
						type: 'pushbutton',
						text: noButtonText
					} : { type: 'container' },
					{
						id: dialogId + '-yesbutton',
						type: 'pushbutton',
						text: yesButtonText,
					}
				],
				vertical: false,
				layoutstyle: 'end'
			},
		]);

		this.showModal(json,
		[
			{
				id: dialogId + '-nobutton',
				func: () => {
					if (typeof noFunction === 'function')
						noFunction();
					this.closeModal(dialogId);
				}
			},
			{
				id: dialogId + '-yesbutton',
				func: () => {
					if (typeof yesFunction === 'function')
						yesFunction();
					this.closeModal(dialogId);
				}
			}
		]);
	}

	/// shows simple confirm modal (message + (cancel + ok) button)
	/// id - id of a dialog
	/// title - title of a dialog
	/// message - message
	/// buttonText - text inside OK button
	/// callback - callback on button press
	showConfirmModal(
		id: string,
		title: string,
		message: string,
		buttonText: string,
		callback: () => void,
		hideCancelButton?: boolean,
	): void {
		var dialogId = this.generateModalId(id);
		var json = this._modalDialogJSON(id, title, !window.mode.isDesktop(), [
			{
				id: 'info-modal-label1',
				type: 'fixedtext',
				text: message
			},
			{
				id: '',
				type: 'buttonbox',
				text: '',
				enabled: true,
				children: [
					{
						id: 'response-cancel',
						type: 'pushbutton',
						text: _('Cancel'),
						hidden: hideCancelButton === true ? true: false
					},
					{
						id: 'response-ok',
						type: 'pushbutton',
						text: buttonText,
						'has_default': true,
					}
				],
				vertical: false,
				layoutstyle: 'end'
			},
		]);

		this.showModal(json, [
			{id: 'response-ok', func: () => {
				if (typeof callback === 'function') {
					callback();
				}
				this.closeModal(dialogId);
			}}
		]);
	}

	/// shows an error modal (message + optional "Technical details")
	/// message - user facing error message
	/// errorDetail - optional technical detail shown in a collapsed expander
	/// buttonText - text inside the dismiss button
	/// callback - callback on dismiss
	showErrorModal(
		message: string,
		errorDetail?: string,
		buttonText: string = _('Close'),
		callback?: () => void,
	): void {
		const id = 'cool_alert';
		var dialogId = this.generateModalId(id);
		var children: any[] = [
			{
				id: 'info-modal-label1',
				type: 'fixedtext',
				text: message
			},
		];
		if (errorDetail) {
			children.push(this._technicalDetailsExpander(errorDetail));
		}
		const buttonChildren: any[] = [];
		if (errorDetail) {
			buttonChildren.push({
				id: 'copy-error-details',
				type: 'pushbutton',
				text: '',
				image: 'lc_copy.svg',
				aria: { label: _('Copy error details') },
			});
		}
		buttonChildren.push({
			id: 'response-ok',
			type: 'pushbutton',
			text: buttonText,
			'has_default': true,
		});
		children.push({
			id: '',
			type: 'buttonbox',
			text: '',
			enabled: true,
			children: buttonChildren,
			vertical: false,
			layoutstyle: 'end'
		});
		var json = this._modalDialogJSON(id, '', !window.mode.isDesktop(), children, 'response-ok');

		const responses: any[] = [
			{id: 'response-ok', func: () => {
				if (typeof callback === 'function') {
					callback();
				}
				this.closeModal(dialogId);
			}}
		];
		if (errorDetail) {
			responses.push({id: 'copy-error-details', func: () => {
				this._copyErrorDetailsToClipboard(message, errorDetail);
			}});
		}
		this.showModal(json, responses);
	}

	/// Builds a collapsed "Show technical details" expander holding the
	/// un-translated technical detail text. Shared by the error popups.
	private _technicalDetailsExpander(errorDetail: string): any {
		return {
			id: 'technical-details-expander',
			type: 'expander',
			expanded: false,
			children: [
				{
					id: 'technical-details-label',
					type: 'fixedtext',
					text: _('Show technical details'),
				},
				{
					id: 'technical-details-text',
					type: 'multilineedit',
					text: errorDetail,
					readonly: true,
					rows: 5,
				},
			],
		};
	}

	private _copyErrorDetailsToClipboard(message: string, technicalDetails: string): void {
		const text = message + '\n' + _('Technical Details:') + '\n' + technicalDetails;
		const timeout = 1000;

		const onSuccess = () => {
			this.showSnackbar(_('Error details copied to clipboard'), null, null, timeout);
			const img = document.querySelector('#copy-error-details img') as HTMLImageElement;
			if (img) {
				app.LOUtil.setImage(img, 'lc_clipboard-check.svg', this.map);
				setTimeout(() => app.LOUtil.setImage(img, 'lc_copy.svg', this.map), timeout);
			}
		};

		const onFailure = (err: unknown) => {
			window.console.error('Error copying text to clipboard:', err);
			this.showSnackbar(_('Failed to copy error details'), null, null, timeout);
		};

		if (window.mode.isCODesktop()) {
			(window as any).postMobileMessage('TEXTCLIPBOARD ' + text);
			onSuccess();
		} else if (navigator.clipboard && window.isSecureContext) {
			navigator.clipboard.writeText(text).then(onSuccess, onFailure);
		} else {
			const ta = document.createElement('textarea');
			ta.style.position = 'absolute';
			ta.style.opacity = '0';
			ta.value = text;
			document.body.appendChild(ta);
			ta.select();
			try {
				if (document.execCommand('copy')) onSuccess();
				else onFailure('execCommand returned false');
			} catch (err) {
				onFailure(err);
			} finally {
				document.body.removeChild(ta);
			}
		}
	}

	// Helper functions

	/**
	 * Moves a jQuery element vertically by a specified difference.
	 * @param obj - The jQuery element.
	 * @param diff - The vertical pixel difference.
	 */
	moveObjectVertically(obj: JQuery, diff: number): void {
		if (obj) {
			var prevTop = obj.css('top');
			if (prevTop) {
				prevTop = parseInt(prevTop.slice(0, -2)) + diff + 'px';
			}
			else {
				prevTop = diff + 'px';
			}
			obj.css({ top: prevTop });
			}
		}

	/**
	 * Sets a document type–specific preference.
	 * @param name - Preference name.
	 * @param value - Preference value.
	 */
	setDocTypePref(name: string, value: any): any {
		const docType = this.map.getDocType();
		return window.prefs.set(`${docType}.${name}`, value);
	}

	/**
	 * Sets several document type–specific preference items at once.
	 */
	setDocTypeMultiplePrefs(prefs: { [key: string]: string }) {
		const docType = this.map.getDocType();

		const deckPrefs: Record<string, string> = {};
		for (const [key, value] of Object.entries(prefs)) {
			deckPrefs[`${docType}.${key}`] = value
		}
		window.prefs.setMultiple(deckPrefs);
	}

	/**
	 * Retrieves a boolean preference for the current document type.
	 * @param name - Preference name.
	 * @param defaultValue - Default value if not set.
	 */
	getBooleanDocTypePref(name: string, defaultValue: boolean = false): boolean {
		const docType = this.map.getDocType();
		return window.prefs.getBoolean(`${docType}.${name}`, defaultValue);
	}

	/**
	 * Whether the start-presentation buttons open the presenter console.
	 * Defaults on for the CODA desktop app and off for browser-based online.
	 */
	shouldShowPresenterConsole(): boolean {
		return this.getBooleanDocTypePref(
			'ShowPresenterConsole',
			window.mode.isCODesktop(),
		);
	}

	togglePresenterConsole(): void {
		const isOn = !this.shouldShowPresenterConsole();
		window.prefs.set(this.map.getDocType() + '.ShowPresenterConsole', isOn);
		this.syncPresenterConsoleToggle(isOn);
	}

	private syncPresenterConsoleToggle(isOn: boolean): void {
		const state = isOn ? 'true' : 'false';
		this.map['stateChangeHandler'].setItemValue('presenterconsole', state);
		this.map.fire('commandstatechanged', {
			commandName: 'presenterconsole',
			state: state,
		});
	}

	getStartCompareChanges(): boolean {
		const compareChangesOption = window.coolParams.get('comparechanges');
		return compareChangesOption === 'true' || compareChangesOption === '1';
	}
}
