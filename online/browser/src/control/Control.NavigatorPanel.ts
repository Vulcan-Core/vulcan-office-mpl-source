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
 * JSDialog.NavigatorPanel
 */

/* global app */
class NavigatorPanel extends SidebarBase {
	navigationPanel: HTMLElement;
	floatingNavIcon: HTMLElement;
	vulcanLibraryWrapper: HTMLElement;
	presentationControlsWrapper: HTMLElement;
	navigatorDockWrapper: HTMLElement;
	quickFindWrapper: HTMLElement;
	closeNavButton: HTMLElement;

	highlightTerm: string;
	focusQuickFind: boolean;
	// The face openNavigation asked for, and whether focus should land on it.
	// Consumed by applyPendingFace, either at once (the navigator is already
	// up, so no reply is coming) or from onNavigator when core's reply builds
	// the panel. Replaces the bare focusQuickFind flag for that path.
	pendingFace: { tab: string | null; focus: boolean } | null = null;
	// The text last SUBMITTED from the chrome search field (Enter, or the
	// magnifier). The magnifier closes the panel only when the field still
	// holds this -- a changed query is a new search, not a toggle.
	chromeQueryRun: string = '';
	dirtyWidth: boolean = true;
	currentWidth: number = 0;
	// Set when the document editor regains focus after a search, so the next
	// Enter on the search field re-runs the search instead of stepping through
	// possibly stale results.
	searchResultsStale: boolean = false;
	// Navigator updates held back while the Outline tab is hidden, keyed by
	// control id in arrival order: the newest update for that control and the
	// actions core sent after it. See onJSUpdate.
	deferredWhileHidden: Map<
		string,
		{ update: { data: UpdateData }; actions: { data: ActionData }[] }
	> = new Map();

	constructor(map: any) {
		super(map, SidebarType.Navigator);
	}

	onAdd(map: ReturnType<typeof window.L.map>) {
		super.onAdd(map);
		this.dirtyWidth = true;
		this.map.on('navigator', this.onNavigator, this);
		this.map.on('doclayerinit', this.onDocLayerInit, this);
		this.map.on('focussearch', this.focusSearch, this);
		this.map.on('editorgotfocus', this.markSearchResultsStale, this);
		this.navigationPanel = document.getElementById(`navigation-sidebar`);
		this.navigationPanel.setAttribute('aria-label', _('Navigation Panel'));
		this.navigationPanel.setAttribute('tabindex', '-1');

		this.floatingNavIcon = document.getElementById(`navigator-floating-icon`);
		this.presentationControlsWrapper = this.navigationPanel.querySelector(
			'#presentation-controls-wrapper',
		);
		this.navigatorDockWrapper = this.navigationPanel.querySelector(
			'#navigator-dock-wrapper',
		);
		this.quickFindWrapper = this.navigationPanel.querySelector(
			'#quickfind-dock-wrapper',
		);
		this.map.on(
			'zoomend',
			this.handleFloatingButtonVisibilityOnZoomChange,
			this,
		);
	}

	onRemove() {
		super.onRemove();
		this.map.off('navigator');
		this.map.off('zoomend');
		this.map.off('doclayerinit');
		this.map.off('editorgotfocus', this.markSearchResultsStale, this);
		this.dirtyWidth = true;
	}

	markSearchResultsStale() {
		this.searchResultsStale = true;
	}

	onDocLayerInit() {
		const allowedDocTypes = ['presentation', 'drawing'];
		// for presentation show slide sorter navigation panel by default
		if (
			allowedDocTypes.includes(app.map.getDocType()) &&
			!window.mode.isSmallScreenDevice()
		) {
			// A drawing (a PDF on the page canvas) opens on the page itself:
			// the Pages strip appears only once the document is known to
			// have more than one page. A deck opens with its strip.
			if (app.map.getDocType() === 'drawing') {
				this.showPagesStripWhenMultiPage();
				return;
			}
			// Navigator panel should be visible and by default we should open slide sorter in case of impress/draw
			this.showNavigationPanel(false);
		}
	}

	/// The page canvas: open the Pages strip when the part count says the
	/// document has more than one page, and not before.
	showPagesStripWhenMultiPage() {
		const map: any = app.map;
		const partsOf = (): number => {
			const layer: any = map && map._docLayer;
			return layer && typeof layer._parts === 'number' ? layer._parts : 0;
		};
		if (partsOf() > 1) {
			this.showNavigationPanel(false);
			return;
		}
		if (!map || typeof map.on !== 'function') return;
		const onParts = (e: any) => {
			const parts = e && typeof e.parts === 'number' ? e.parts : partsOf();
			if (parts <= 1) return;
			map.off('updateparts', onParts);
			if (!this.isNavigationPanelVisible()) this.showNavigationPanel(false);
		};
		map.on('updateparts', onParts);
	}

	initializeNavigator(docType: string) {
		app.layoutingService.appendLayoutingTask(() => {
			this.initializeImpl(docType);
		});
	}

	initializeImpl(docType: string) {
		// Create navigation container
		const navContainer = window.L.DomUtil.create(
			'div',
			'navigation-options-container',
		);
		navContainer.id = 'navigation-options-wrapper';

		/*
		 * The floating chip is the stock way back into this panel: a button
		 * parked ON the page at (12,94), measured directly below the menubar's
		 * leading slot at (18,14) and in the same gutter. Under the Vulcan
		 * desktop chrome that slot carries the Navigator instead, so building
		 * the chip too would put two triggers for one panel on screen and leave
		 * a surface floating over the paper. The placeholder div stays in the
		 * DOM either way, so the `visible` class toggles below are unaffected.
		 *
		 * Calc never had the chip at all.
		 */
		const vulcanDesktopChrome = document.documentElement.classList.contains(
			'vulcan-desktop-chrome',
		);
		if (docType !== 'spreadsheet' && !vulcanDesktopChrome) {
			// Create floating navigation button
			this.createFloatingNavigatorBtn();

			// Insert floatingNavIcon right after navigatorPanel
			this.navigationPanel.insertAdjacentElement(
				'afterend',
				this.floatingNavIcon,
			);
		}

		// Create header section
		var navHeader = window.L.DomUtil.create(
			'div',
			'navigation-header',
			navContainer,
		);

		var navTitle = window.L.DomUtil.create('h2', 'navigation-title', navHeader);
		navTitle.textContent = _('Navigation');

		// Create wrapper for search
		const navSearchWrapper = window.L.DomUtil.create(
			'div',
			'navigation-search-wrapper',
		);

		// Create a wrapper div
		const closeNavWrapper = window.L.DomUtil.create(
			'div',
			'close-navigation-wrapper',
			navHeader,
		);

		// Create the close button inside the div
		this.closeNavButton = window.L.DomUtil.create(
			'button',
			'close-navigation-button',
			closeNavWrapper,
		);
		const closeNavigationText = _('Close Navigation');
		this.closeNavButton.setAttribute('aria-label', closeNavigationText);
		this.closeNavButton.setAttribute('data-cooltip', closeNavigationText);
		window.L.control.attachTooltipEventListener(this.closeNavButton, this.map);
		this.closeNavButton.setAttribute('tabindex', '0');

		const clickFunction = function () {
			this.closeNavigation();
			if (app.showNavigator) {
				app.map.sendUnoCommand('.uno:Navigator');
			}
			app.map.focus();
		}.bind(this);

		this.closeNavButton.addEventListener('click', clickFunction);

		this.navigationPanel.addEventListener(
			'keydown',
			function (e: KeyboardEvent) {
				if (e.code === 'Escape') {
					const contextMenu = app.map.uiManager.isAnyContextMenuOpened();
					if (contextMenu) {
						// Do not close navigator if any context menu is open
						return;
					}
					clickFunction();
					e.preventDefault();
					e.stopPropagation();
				}
			},
		);

		const contentDivs = [];

		// build tabs if we are in an environment that supports them
		// e.g. in writer we have navigator and quickfind tabs
		// in impress/draw we have navigator and slide sorter tabs
		if (this.map.isPresentationOrDrawing() || this.map.isText()) {
			var navigationTabs = [];

			var navOptions = window.L.DomUtil.create(
				'div',
				'navigation-tabs',
				navContainer,
			);
			navOptions.id = 'navigation-options';
			navOptions.setAttribute('role', 'tablist');

			// A drawing (how a PDF opens for editing) is a page document, not a
			// deck: its strip is "Pages", and the deck-only tabs — the outline
			// of slide text and the slide-template library — stay out.
			const isPageCanvas = this.map.getDocType() === 'drawing';
			if (this.map.isPresentationOrDrawing()) {
				// Create Slide Sorter tab
				var slideSorterTab = window.L.DomUtil.create(
					'button',
					'tab',
					navOptions,
				);
				slideSorterTab.id = 'tab-slide-sorter';
				slideSorterTab.textContent = isPageCanvas ? _('Pages') : _('Slides');

				if (this.presentationControlsWrapper) {
					slideSorterTab.setAttribute(
						'aria-controls',
						'presentation-controls-wrapper',
					);

					this.presentationControlsWrapper.setAttribute('role', 'tabpanel');
					this.presentationControlsWrapper.setAttribute(
						'aria-labelledby',
						'tab-slide-sorter',
					);
					contentDivs.push(this.presentationControlsWrapper);
				}
				navigationTabs.push(slideSorterTab);
			}

			// Create Navigator tab
			if (!isPageCanvas) {
				var navigatorTab = window.L.DomUtil.create('button', 'tab', navOptions);
				navigatorTab.id = 'tab-navigator';
				navigatorTab.textContent = _('Outline');
				if (this.navigatorDockWrapper) {
					navigatorTab.setAttribute('aria-controls', 'navigator-dock-wrapper');

					this.navigatorDockWrapper.setAttribute('role', 'tabpanel');
					this.navigatorDockWrapper.setAttribute(
						'aria-labelledby',
						'tab-navigator',
					);
					contentDivs.push(this.navigatorDockWrapper);
				}
				navigationTabs.push(navigatorTab);
			}

			// Library tab (presentations): built-in pre-grouped assets and
			// slide template scaffolds, inserted through the same FillApi
			// batches the agent verbs ride. Global built-ins v1;
			// per-workspace libraries are a follow-up.
			if (this.map.isPresentationOrDrawing() && !isPageCanvas) {
				var libraryTab = window.L.DomUtil.create(
					'button',
					'tab',
					navOptions,
				);
				libraryTab.id = 'tab-vulcan-library';
				libraryTab.textContent = _('Library');

				this.vulcanLibraryWrapper = window.L.DomUtil.create(
					'div',
					'vulcan-library-wrapper',
					this.navigationPanel,
				);
				this.vulcanLibraryWrapper.id = 'vulcan-library-wrapper';
				this.vulcanLibraryWrapper.style.display = 'none';
				libraryTab.setAttribute('aria-controls', 'vulcan-library-wrapper');
				this.vulcanLibraryWrapper.setAttribute('role', 'tabpanel');
				this.vulcanLibraryWrapper.setAttribute(
					'aria-labelledby',
					'tab-vulcan-library',
				);
				contentDivs.push(this.vulcanLibraryWrapper);
				navigationTabs.push(libraryTab);
				this.populateVulcanLibrary();
			}

			if (this.map.isText()) {
				// Create Quick Find tab
				var quickFindTab = window.L.DomUtil.create('button', 'tab', navOptions);
				quickFindTab.id = 'tab-quick-find';
				quickFindTab.textContent = _('Results');

				if (this.quickFindWrapper) {
					quickFindTab.setAttribute('aria-controls', 'quickfind-dock-wrapper');

					this.quickFindWrapper.setAttribute('role', 'tabpanel');
					this.quickFindWrapper.setAttribute(
						'aria-labelledby',
						'tab-quick-find',
					);
					contentDivs.push(this.quickFindWrapper);
				}
				navigationTabs.push(quickFindTab);
			}

			if (navigationTabs.length > 0) {
				// Set up ARIA attributes for tabs
				navigationTabs.forEach((tab, index) => {
					tab.setAttribute('role', 'tab');
					// Only first tab initially selected
					if (index === 0) {
						tab.setAttribute('aria-selected', 'true');
						tab.classList.add('selected');
					} else {
						tab.setAttribute('aria-selected', 'false');
						tab.setAttribute('tabindex', '-1');
					}
				});

				// Tab Click Event Listener
				navigationTabs.forEach((tab) => {
					tab.addEventListener(
						'click',
						function () {
							this.switchNavigationTab(tab.id);
						}.bind(this),
					);
				});

				// Initialize keyboard navigation
				JSDialog.KeyboardTabNavigation(navigationTabs, contentDivs);
			}
		}

		if (this.navigationPanel) {
			// Insert navigation container as the first child & navHeader as next-child of navigator-panel
			this.navigationPanel.prepend(navContainer);
			if (this.map.isText()) {
				this.navigationPanel.prepend(navSearchWrapper);
				this.createSearchBar(navSearchWrapper);
			}
			this.navigationPanel.prepend(navHeader);
		}

		this.dirtyWidth = true;
	}

	createFloatingNavigatorBtn() {
		// Get or create the main wrapper div
		this.floatingNavIcon.className =
			'notebookbar unoNavigator unospan-view-navigator unotoolbutton visible';
		this.floatingNavIcon.setAttribute('tabindex', '-1');
		const navigatorText = _('Navigator');
		this.floatingNavIcon.setAttribute('data-cooltip', navigatorText);
		window.L.control.attachTooltipEventListener(this.floatingNavIcon, this.map);

		// Create the button wrapper (square container)
		const buttonWrapper = document.createElement('div');
		buttonWrapper.className = 'navigator-btn-wrapper'; // Class for styling

		// Create the button
		const button = document.createElement('button');
		button.className = 'ui-content unobutton';
		button.id = 'floating-navigator';
		button.accessKey = 'ZN';
		button.setAttribute('aria-label', navigatorText);

		// Create the image inside the button
		const img = document.createElement('img');
		img.alt = ''; // empty alt for accessibility
		app.LOUtil.setImage(img, 'lc_navigator.svg', this.map);

		// Append elements
		button.appendChild(img);
		buttonWrapper.appendChild(button);
		this.floatingNavIcon.appendChild(buttonWrapper);

		// Click event
		this.floatingNavIcon.addEventListener('click', () => this.openNavigation());
	}

	/*
	 * THE CHROME SEARCH FIELD IS THE PANEL'S OWN FIELD, BY PROXY.
	 *
	 * Two entry points, one rule: what is typed in the chrome box behaves
	 * as if it were typed in #navigator-search-input. That field is the one
	 * search state in the product; the chrome box never searches on its own.
	 *
	 *   chromeQueryTyped   every keystroke. Mirrors the text into the panel's
	 *                      field and, while the panel is open, runs the same
	 *                      'change' the panel's field runs per keystroke, so
	 *                      the results follow the typing.
	 *   chromeQuerySubmit  Enter. Opens the panel on the results face if it is
	 *                      closed, replaces the panel field's text, runs the
	 *                      query. Never closes.
	 *
	 * Focus stays in the chrome box on submit: the reader is typing there and
	 * may refine. The panel's own field takes focus on the Ctrl+F path, which
	 * opens it for typing.
	 */
	public chromeQueryTyped(text: string): void {
		const input = document.getElementById(
			'navigator-search-input',
		) as HTMLInputElement | null;
		if (!input) return;
		input.value = text;
		if (this.isNavigationPanelVisible())
			this.useSearchCallback(
				'edit',
				'change',
				{ id: 'navigator-search' },
				this.builder,
			);
	}

	public chromeQuerySubmit(text: string): void {
		this.chromeQueryRun = text;
		this.openNavigation('tab-quick-find', /* takeFocus */ false);

		// The panel builds asynchronously on first open; fill and fire once
		// its field exists. On a panel already up this runs at once.
		app.layoutingService.appendLayoutingTask(() => {
			const input = document.getElementById(
				'navigator-search-input',
			) as HTMLInputElement | null;
			if (!input) return;
			input.value = text;
			// The panel's own field sends core a 'change' per keystroke and
			// 'activate' on Enter, and core fills the Results list only for
			// that pair. Keystrokes in the chrome box while the panel is
			// closed send nothing (chromeQueryTyped), so a term the panel has
			// not searched gets its 'change' here, first. A term it has
			// already searched gets 'activate' alone: Enter on a live search
			// is "next match", and a second 'change' would make it two.
			// MEASURED without the 'change': Enter from the closed state
			// opened the panel with the match selected on the page and the
			// Results face still on its placeholder, where the panel's own
			// field shows "4 results".
			if (text !== this.highlightTerm || this.searchResultsStale) {
				this.useSearchCallback(
					'edit',
					'change',
					{ id: 'navigator-search' },
					this.builder,
				);
				// Until core answers that 'change' the list on screen is the
				// PREVIOUS term's, Next button and all -- and useSearchCallback
				// turns an 'activate' over a visible Next button into a click
				// on it. In the panel's own field the reply lands between the
				// keystroke and the Enter; here the two are back to back.
				// MEASURED: "dinosaur" searched, panel closed, box edited to
				// "dinosaurs", magnifier -- the panel reopened on "dinosaurs"
				// with an empty list, the 'activate' having gone to the old
				// list's Next button instead of core.
				this.searchResultsStale = true;
			}
			this.useSearchCallback(
				'pushbutton',
				'activate',
				{ id: 'navigator-search-button' },
				this.builder,
			);
		});
	}

	/*
	 * Open the Navigation panel from a chrome affordance.
	 *
	 * Extracted from the floating chip's own handler so the triggers cannot
	 * drift apart. Under the Vulcan desktop chrome there is no chip and the
	 * menubar carries two Word-shaped entry points instead -- an outline button
	 * and a search button (Control.Menubar._createFileIcon) -- and both come
	 * through here. The panel owns the behaviour; a caller only asks for it.
	 *
	 * `tab` picks which face opens, mirroring Word's Navigation pane: the
	 * headings tree ('tab-navigator') or the search results ('tab-quick-find').
	 * Omitted, it keeps the stock behaviour of focusing search.
	 */
	public openNavigation(tab?: string, takeFocus: boolean = true): void {
		this.showNavigationPanel(takeFocus);
		if (app.map.isPresentationOrDrawing()) {
			this.switchNavigationTab('tab-slide-sorter');
			app.layoutingService.appendLayoutingTask(() => {
				this.focusNavigationItem();
			});
			return;
		}

		this.pendingFace = {
			tab: tab === 'tab-navigator' || tab === 'tab-quick-find' ? tab : null,
			focus: takeFocus,
		};

		// `.uno:Navigator` TOGGLES core's navigator. It goes out once, and only
		// while core's is down. This used to send unconditionally and then let
		// switchNavigationTab('tab-navigator') send again from a layouting
		// task whose `!app.showNavigator` guard had not seen the reply yet: two
		// toggles, core answered `close`, and the panel shut itself 20ms after
		// opening -- or not, depending on whether the reply beat the task.
		// With the panel already up there is no reply coming, so the face is
		// applied here.
		if (!app.showNavigator) {
			app.map.sendUnoCommand('.uno:Navigator');
			return;
		}
		this.applyPendingFace();
	}

	// Land on the face openNavigation asked for. The outline lands focus on
	// the tree, not the search field, or the headings button would behave
	// like the search one; a chrome-driven open leaves focus where it is.
	private applyPendingFace(): void {
		const face = this.pendingFace;
		this.pendingFace = null;
		if (!face) return;
		if (face.tab === 'tab-navigator') {
			this.switchNavigationTab('tab-navigator');
			if (face.focus) this.focusNavigationItem();
		} else if (face.tab === 'tab-quick-find') {
			this.switchNavigationTab('tab-quick-find');
			if (face.focus) this.focusSearch();
		} else if (face.focus) {
			this.focusSearch();
		}
	}

	onNavigator(data: { data: JSDialogJSON }) {
		const navigatorData = data.data;
		let windowId = 0;
		try {
			windowId = parseInt(navigatorData.id);
		} catch (e) {
			app.console.warn('Navigator: cannot convert id to number');
		}

		this.builder.setWindowId(windowId);
		this.container.innerHTML = '';
		// A full build (or a close) supersedes anything held back.
		this.deferredWhileHidden.clear();

		if (navigatorData.action === 'close') {
			this.closeSidebar();
		} else if (navigatorData.children) {
			// Whether the navigator was already open before this message, so
			// focus is only moved into it on the closed-to-open transition and
			// not pulled off the document each time it merely rebuilds.
			const wasShown = app.showNavigator;

			if (navigatorData.children.length) {
				this.onResize();
			}

			this.markNavigatorTreeView(navigatorData);

			this.builder.build(this.container, [navigatorData], false);

			// There is case where user can directly click navigator from notebookbar view option
			// in that case we first show the navigation panel and then switch to tab view
			this.showNavigationPanel(false);
			this.navigatorDockWrapper.style.display = '';
			app.showNavigator = true;
			if (
				app.map.isPresentationOrDrawing() &&
				!this.isNavigationPanelVisible()
			) {
				this.switchNavigationTab('tab-slide-sorter');
			} else {
				this.switchNavigationTab('tab-navigator');
			}
			if (this.pendingFace) {
				this.applyPendingFace();
			} else if (this.focusQuickFind) {
				this.switchNavigationTab('tab-quick-find');
				this.focusSearch();
				this.focusQuickFind = false;
			} else if (!wasShown) {
				this.focusNavigatorOnShow();
			}
		} else {
			this.closeSidebar();
		}

		this.dirtyWidth = true;
	}

	// leaving the Outline tab only hides it, so core's navigator
	// stays open and resends its WHOLE tree on every click in the document
	// (FreshNavigatrTree -> set_cursor -> a full sendUpdate). On a long deck
	// that rebuilt 574 rows (~6,500 nodes) per click into a display:none
	// wrapper, and the session recorder serialized each rebuild again. Hold
	// the newest update per control (and the actions that follow it) until
	// the tab is shown; core's navigator itself stays open, because Writer's
	// Find face and the open/close toggle depend on it.
	isOutlineHidden(): boolean {
		return (
			!!this.navigatorDockWrapper &&
			this.navigatorDockWrapper.style.display === 'none'
		);
	}

	flushDeferredWhileHidden(): void {
		if (!this.deferredWhileHidden.size) return;
		const deferred = Array.from(this.deferredWhileHidden.values());
		this.deferredWhileHidden.clear();
		for (const entry of deferred) {
			this.onJSUpdate(entry.update);
			for (const action of entry.actions) this.onJSAction(action);
		}
	}

	protected onJSAction(e: { data: ActionData }) {
		const deferred =
			e?.data?.jsontype === this.allowedJsonType &&
			this.deferredWhileHidden.get(e.data.data?.control_id);
		if (deferred) {
			deferred.actions.push(e);
			return true;
		}
		return super.onJSAction(e);
	}

	onJSUpdate(e: { data: UpdateData }) {
		const id = e?.data?.control?.id;
		if (
			id &&
			e.data.jsontype === this.allowedJsonType &&
			this.isOutlineHidden()
		) {
			// Re-insert so the map keeps arrival order across controls.
			this.deferredWhileHidden.delete(id);
			this.deferredWhileHidden.set(id, { update: e, actions: [] });
			return true;
		}
		// Only restore focus to a tree row if focus was actually inside the
		// content tree. Checking the whole panel would also match the search
		// box, stealing focus from it after the first typed character.
		const treeHadFocus =
			this.container && this.container.contains(document.activeElement);
		if (this.highlightTerm && this.highlightTerm.trim().length > 0) {
			(e.data.control as TreeWidgetJSON).highlightTerm = this.highlightTerm;
		}
		const retval = super.onJSUpdate(e);
		if (treeHadFocus) {
			this.focusNavigationItem();
		}
		return retval;
	}

	closeSidebar() {
		this.closeNavigation();
		app.showNavigator = false;
		super.closeSidebar();
	}

	// Function to handle tab click
	switchNavigationTab(tabId: string) {
		// Tab ids are a fixed vocabulary (tab-slide-sorter|tab-navigator|
		// tab-quick-find|tab-vulcan-library) — safe metadata.
		if (app.telemetry)
			app.telemetry.record('nav_panel', { action: 'tab', tab: tabId });
		// Remove 'selected' class from all tabs
		this.navigationPanel
			.querySelectorAll('.navigation-tabs .tab')
			.forEach((t) => {
				t.classList.remove('selected');
				t.setAttribute('aria-selected', 'false');
				t.setAttribute('tabindex', '-1');
			});

		// Add 'selected' class to the clicked tab
		// In Calc we don't have tabs so far
		const tab = this.navigationPanel.querySelector('#' + tabId);
		if (tab) {
			tab.classList.add('selected');
			tab.setAttribute('aria-selected', 'true');
			tab.removeAttribute('tabindex');
		}

		// Toggle visibility based on tabId
		if (tabId === 'tab-slide-sorter') {
			// todo: must be a better way to handle this
			this.presentationControlsWrapper.style.display = 'block';
			this.navigatorDockWrapper.style.display = 'none';
			this.quickFindWrapper.style.display = 'none';
			if (this.vulcanLibraryWrapper)
				this.vulcanLibraryWrapper.style.display = 'none';
		} else if (tabId === 'tab-navigator') {
			if (!app.showNavigator) app.map.sendUnoCommand('.uno:Navigator');
			this.presentationControlsWrapper.style.display = 'none';
			this.navigatorDockWrapper.style.display = 'block';
			this.quickFindWrapper.style.display = 'none';
			if (this.vulcanLibraryWrapper)
				this.vulcanLibraryWrapper.style.display = 'none';
			this.flushDeferredWhileHidden();
		} else if (tabId === 'tab-quick-find') {
			if (!app.showQuickFind) app.map.sendUnoCommand('.uno:QuickFind'); // todo add showQuickFind to other areas of app
			this.presentationControlsWrapper.style.display = 'none';
			this.navigatorDockWrapper.style.display = 'none';
			this.quickFindWrapper.style.display = 'block';
		} else if (tabId === 'tab-vulcan-library') {
			this.presentationControlsWrapper.style.display = 'none';
			this.navigatorDockWrapper.style.display = 'none';
			this.quickFindWrapper.style.display = 'none';
			this.vulcanLibraryWrapper.style.display = 'block';
		}
	}

	// ── built-in slide library ──────────────────────────────────────────

	populateVulcanLibrary() {
		const library: any = (window as any).VulcanSlideLibrary;
		if (!library || !this.vulcanLibraryWrapper) return;
		this.vulcanLibraryWrapper.textContent = '';
		this.appendLibrarySection(_('Assets'), library.assets);
		this.appendLibrarySection(_('Slide templates'), library.templates);

		const hint = window.L.DomUtil.create(
			'div',
			'vulcan-library-hint',
			this.vulcanLibraryWrapper,
		);
		hint.textContent = _(
			'Insert a scaffold, then ask the agent for the content pass.',
		);
	}

	appendLibrarySection(title: string, entries: any[]) {
		const section = window.L.DomUtil.create(
			'div',
			'vulcan-library-section',
			this.vulcanLibraryWrapper,
		);
		const heading = window.L.DomUtil.create(
			'h3',
			'vulcan-library-section-title',
			section,
		);
		heading.textContent = title;
		for (const entry of entries) {
			const button = window.L.DomUtil.create(
				'button',
				'vulcan-library-entry',
				section,
			);
			button.id = 'vulcan-library-' + entry.id;
			button.textContent = entry.label;
			button.addEventListener('click', () => {
				this.insertLibraryEntry(entry);
			});
		}
	}

	// ONE batch for the whole entry: the inserts, then the groupings via
	// MarkCreated (the engine marks this batch's created objects by
	// identity - no ordNum round-trip), so the scaffold lands atomically
	// and a single undo removes it. The ack is matched by RequestId (the
	// engine echoes it), never by shape count - concurrent batches must
	// not adopt each other's results.
	vulcanLibraryPending = false;

	insertLibraryEntry(entry: any) {
		if (this.vulcanLibraryPending) return;
		const library: any = (window as any).VulcanSlideLibrary;
		const windowApp: any = (window as any).app;
		const part = (this.map._docLayer?._selectedPart as number) | 0;
		const partInfo = windowApp.impress?.partList?.[part];
		if (!library || !partInfo || !partInfo.width || !partInfo.height)
			return;

		const commands = library
			.buildInsertCommands(entry, part, partInfo.width, partInfo.height)
			.concat(library.buildGroupCommands(entry, part));

		const requestId =
			'library-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
		this.vulcanLibraryPending = true;
		const done = () => {
			this.vulcanLibraryPending = false;
			this.map.off('commandresult', onResult, this);
			clearTimeout(timer);
		};
		const onResult = (e: any) => {
			if (!e || e.commandName !== '.uno:TransformDocumentStructure')
				return;
			// R6-10: the standard envelope nests the payload as a typed
			// value; the bridge helper unwraps both shapes.
			const result = VulcanImpressBridgeService.transformResultOf(e);
			if (!result || result.requestId !== requestId) return;
			done();
		};
		const timer = setTimeout(done, 10000);
		this.map.on('commandresult', onResult, this);
		windowApp.socket.sendMessage(
			'transformdocumentstructure url=interactive transform=' +
				encodeURIComponent(
					JSON.stringify({
						RequestId: requestId,
						Transforms: { SlideCommands: commands },
					}),
				),
		);
		// Entry ids are a fixed built-in vocabulary — safe metadata.
		if (app.telemetry)
			app.telemetry.record('nav_panel', {
				action: 'library-insert',
				entry: entry.id,
			});
	}

	handleFloatingButtonVisibilityOnZoomChange() {
		// Handle special case for impress as the view there is landscape so better to hide Floating Nav ICON on lower zoom compare to other app
		if (
			this.map.getZoom() > 14 ||
			(this.map.getZoom() >= 13 && this.map.getDocType() === 'presentation')
		) {
			this.floatingNavIcon.classList.remove('visible');
		} else if (!this.navigationPanel.classList.contains('visible')) {
			this.floatingNavIcon.classList.add('visible');
		}
	}

	getCurrentWidth() {
		if (this.dirtyWidth) {
			// Consider navigations sidebar width to place marker at correct position
			const presentationControlsWrapper: HTMLDivElement =
				document.querySelector('#navigation-sidebar');
			let presentationControlsWrapperWidth: number = 0;

			if (presentationControlsWrapper)
				presentationControlsWrapperWidth =
					presentationControlsWrapper.getBoundingClientRect().width;

			this.currentWidth = presentationControlsWrapperWidth;
			this.dirtyWidth = false;
		}

		return this.currentWidth;
	}

	requestShow() {
		app.socket.sendMessage('uno .uno:Navigator');
	}

	showNavigationPanel(setFocus: boolean) {
		if (app.telemetry) app.telemetry.record('nav_panel', { action: 'open' });
		app.layoutingService.appendLayoutingTask(() => {
			this.navigationPanel.classList.add('visible');
			this.floatingNavIcon.classList.remove('visible');
			// this will update the indentation marks for elements like ruler
			app.map.fire('fixruleroffset');

			if (setFocus) this.navigationPanel.focus();
		});
	}

	focusNavigationItem() {
		// When the navigator contains a slide sorter focus the current
		// slide, rather than a tree row that does not exist for
		// presentations.
		if (
			app.map.isPresentationOrDrawing() &&
			this.presentationControlsWrapper &&
			// the wrapper's inline display is 'block' while its tab is shown, 'none' when hidden
			this.presentationControlsWrapper.style.display === 'block'
		) {
			app.map._docLayer._preview?.focusCurrentSlide();
			return;
		}
		const focusRow = this.navigationPanel.querySelector<HTMLElement>(
			'.ui-treeview-tree [tabindex="0"]',
		);
		focusRow?.focus();
	}

	// Move keyboard focus into the navigator tree when the user opens it, the
	// same way the sidebar focuses its first control on open. Deferred past the
	// open animation so it does not shift the page, and skipped while a dialog
	// is open so it does not steal focus from it.
	focusNavigatorOnShow() {
		app.timerRegistry.setTimeout(
			'navigatorstealfocus',
			() => {
				app.layoutingService.appendLayoutingTask(() => {
					if (
						this.map.dialog.hasOpenedDialog() ||
						(this.map.jsdialog && this.map.jsdialog.hasDialogOpened())
					)
						return;
					// Focus may already have moved into the navigator before this
					// deferred task runs (for example the user clicked the search
					// box). Leave it where it is rather than yanking it to the tree.
					if (this.navigationPanel.contains(document.activeElement)) return;
					this.focusNavigationItem();
				});
			},
			250,
		);
	}

	isNavigationPanelVisible(): boolean {
		return this.navigationPanel.classList.contains('visible');
	}

	closeNavigation() {
		if (app.telemetry) app.telemetry.record('nav_panel', { action: 'close' });
		app.layoutingService.appendLayoutingTask(() => {
			this.navigationPanel.classList.remove('visible');
			this.floatingNavIcon.classList.add('visible');
			this.handleFloatingButtonVisibilityOnZoomChange(); // on close panel we should check if we can display nav icon or not based on zoom level
		});
	}

	preFocusQuickFind() {
		this.focusQuickFind = true;
	}

	focusSearch() {
		const searchInput = document.getElementById(
			'navigator-search-input',
		) as HTMLInputElement;
		if (!searchInput) return;

		app.layoutingService.appendLayoutingTask(() => {
			searchInput.select();
			searchInput.focus();
		});
	}

	createSearchBar(wrapper: HTMLElement) {
		const findReplaceText = _('Find and Replace');

		const data = {
			id: '',
			type: 'container',
			children: [
				{
					id: 'navigator-search',
					type: 'edit',
					placeholder: _('Search...'),
					text: '',
				} as EditWidgetJSON,
				{
					id: '',
					type: 'toolbox',
					text: '',
					children: [
						{
							id: 'navigator-search-button',
							type: 'menubutton',
							text: '',
							icon: 'lc_recsearch.svg',
							noLabel: true,
							aria: { label: _('Search') },
							applyCallback: () => {
								this.useSearchCallback(
									'pushbutton',
									'activate',
									{ id: 'navigator-search-button' },
									this.builder,
								);
							},
							menu: [
								{
									type: 'action',
									id: 'navigator-find-replace',
									text: findReplaceText,
								} as MenuDefinition,
							],
						} as MenuButtonWidgetJSON,
					],
				},
			],
		} as WidgetJSON;

		this.builder.build(wrapper, [data], false);
	}

	useDefaultCallback(
		objectType: string,
		eventType: string,
		object: any,
		data: any,
		builder: JSBuilder,
	) {
		super.callback(objectType, eventType, object, data, builder);
	}

	getSearchTerm(): string | null {
		const searchInput = document.getElementById(
			'navigator-search-input',
		) as HTMLInputElement;

		if (searchInput) return searchInput.value;
		else return null;
	}

	useSearchCallback(
		objectType: string,
		eventType: string,
		object: any,
		builder: JSBuilder,
	) {
		// Switch to "Results tab" first.
		if (eventType === 'activate') {
			const resultsTab = this.navigationPanel.querySelector(
				'#tab-quick-find:not(.selected)',
			) as HTMLElement;
			if (resultsTab) resultsTab.click();
		}

		const nextButton = this.navigationPanel.querySelector(
			'#findnext button',
		) as HTMLElement;
		const nextButtonVisible =
			nextButton && (nextButton as any).checkVisibility();
		const searchTerm = this.getSearchTerm();

		// Search input doesn't exist, nothing to do below.
		if (searchTerm === null) return;

		// Field cleared: forget the stored term and remove the Outline
		// highlighting. Without this the yellow highlight stays and is
		// re-applied on the next navigator update via onJSUpdate (which
		// reuses highlightTerm).
		if (searchTerm.trim() === '') {
			this.highlightTerm = '';
			const treeContainer = document.getElementById('contenttree') as any;
			if (treeContainer) treeContainer.highlightEntries('');
			return;
		}

		const termChanged = searchTerm !== this.highlightTerm;
		this.highlightTerm = searchTerm;
		const newSearch =
			termChanged || !nextButtonVisible || this.searchResultsStale;
		this.searchResultsStale = false;

		if (newSearch) {
			if (object.id === 'navigator-search-button')
				super.callback('edit', 'activate', { id: 'Find' }, searchTerm, builder);
			else
				super.callback(
					objectType,
					eventType,
					{ id: 'Find' },
					searchTerm,
					builder,
				);
		} else if (nextButton) nextButton.click();

		// Update outline highlighting
		// Note: only update on 'activate' or button pressed events to be consistent with results tab
		if (eventType === 'activate') {
			var treeContainer = document.getElementById('contenttree') as any;
			if (treeContainer) treeContainer.highlightEntries(searchTerm);
		}
	}

	useFindReplaceCallback(_builder: JSBuilder) {
		const searchTerm = this.getSearchTerm();
		if (searchTerm && searchTerm.trim() !== '') {
			// The FindReplaceDialog modification callback reads this and injects
			// the term into the search field after the dialog DOM is built.
			window.JSDialog.pendingFindReplaceSearchTerm = searchTerm;
		}
		app.map.sendUnoCommand('.uno:SearchDialog');
	}

	override callback(
		objectType: string,
		eventType: string,
		object: any,
		data: any,
		builder: JSBuilder,
	): void {
		if (
			objectType === 'menubutton' &&
			eventType === 'select' &&
			data === 'navigator-find-replace'
		) {
			this.useFindReplaceCallback(builder);
		} else if (
			!['navigator-search-button', 'navigator-search'].includes(object.id)
		) {
			this.useDefaultCallback(objectType, eventType, object, data, builder);
		} else {
			this.useSearchCallback(objectType, eventType, object, builder);
		}
	}
}

JSDialog.NavigatorPanel = function (map: any) {
	return new NavigatorPanel(map);
};
