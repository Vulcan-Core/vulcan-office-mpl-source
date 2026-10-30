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

/* global app _ */

declare var JSDialog: any;

/*
	app.dispatcher.dispatch() will be used to call some actions so we can share the code
	This is mostly used by keyboard shortcuts etc, which need a base (for simplicity) to call actions.
*/

class Dispatcher {
	private actionsMap: any = {};

	private addGeneralCommands() {
		// Page the view by one screenful. Used by PageUp/PageDown in read-only
		// mode, where the keys must scroll the view rather than move the
		// (hidden) cursor in core.
		this.actionsMap['scrollpageup'] = function () {
			app.map.fire('scrollby', {
				x: 0,
				y: -app.activeDocument.activeLayout.viewedRectangle.pHeight,
			});
		};

		this.actionsMap['scrollpagedown'] = function () {
			app.map.fire('scrollby', {
				x: 0,
				y: app.activeDocument.activeLayout.viewedRectangle.pHeight,
			});
		};

		this.actionsMap['save'] = function (source?: string) {
			// Save only when not read-only.
			if (!app.map.isReadOnlyMode() && !app.map['wopi'].HideSaveOption) {
				app.map.fire('postMessage', {
					msgId: 'UI_Save',
					args: { source: source || 'toolbar' },
				});
				if (!app.map._disableDefaultAction['UI_Save']) {
					app.map.save(
						false /* An explicit save should terminate cell edit */,
						false /* An explicit save should save it again */,
					);
				}
			}
		};

		this.actionsMap['closeapp'] = () => {
			if (
				(window as any).ThisIsAMobileApp &&
				!(window as any).ThisIsTheEmscriptenApp
			) {
				window.postMobileMessage('BYE');
			} else {
				if (
					app.map &&
					app.map.formulabar &&
					(app.map.formulabar.hasFocus() || app.map.formulabar.isInEditMode())
				) {
					this.dispatch('acceptformula'); // save data from the edited cell on exit
				}

				window.prefs.sendPendingBrowserSettingsUpdate();
				app.map.fire('postMessage', {
					msgId: 'close',
					args: { EverModified: app.map._everModified, Deprecated: true },
				});
				app.map.fire('postMessage', {
					msgId: 'UI_Close',
					args: { EverModified: app.map._everModified },
				});
			}
			if (!app.map._disableDefaultAction['UI_Close']) app.map.remove();
		};

		this.actionsMap['userlist'] = () => {
			if (app.map.userList) app.map.userList.openDropdown();
		};

		this.actionsMap['print'] = function () {
			app.map.print();
		};
		this.actionsMap['print-notespages'] = function () {
			// To Export only notes with slides both should be true (ExportNotesPages, ExportOnlyNotesPages).
			// As ExportOnlyNotesPages is kind of child condition to ExportNotesPages.
			const options = {
				ExportNotesPages: {
					type: 'boolean',
					value: true,
				},
				ExportOnlyNotesPages: {
					type: 'boolean',
					value: true,
				},
			};
			const optionsString = JSON.stringify(options);
			app.map.print(optionsString);
		};
		this.actionsMap['repair'] = function () {
			app.socket.sendMessage('commandvalues command=.uno:DocumentRepair');
		};

		this.actionsMap['remotelink'] = function () {
			app.map.fire('postMessage', { msgId: 'UI_PickLink' });
		};
		this.actionsMap['remoteaicontent'] = function () {
			app.map.fire('postMessage', { msgId: 'UI_InsertAIContent' });
		};
		// TODO: deduplicate
		this.actionsMap['hyperlinkdialog'] = function () {
			app.map.sendUnoCommand('.uno:HyperlinkDialog');
		};
		this.actionsMap['inserthyperlink'] = () => {
			app.map.sendUnoCommand('.uno:HyperlinkDialog');
		};
		this.actionsMap['rev-history'] = function () {
			app.map.openRevisionHistory();
		};
		this.actionsMap['shareas'] = function () {
			app.map.openShare();
		};

		this.actionsMap['savecomments'] = function () {
			if (app.isCommentEditingAllowed()) {
				app.map.fire('postMessage', { msgId: 'UI_Save' });
				if (!app.map._disableDefaultAction['UI_Save']) {
					app.map.save(false, false);
				}
			}
		};

		this.actionsMap['insertmultimedia'] = function () {
			window.L.DomUtil.get('insertmultimedia').click();
		};
		this.actionsMap['remotemultimedia'] = function () {
			app.map.fire('postMessage', {
				msgId: 'UI_InsertFile',
				args: {
					callback: 'Action_InsertMultimedia',
					mimeTypeFilter: app.LOUtil.mediaMimeFilter,
				},
			});
		};

		this.actionsMap['localcomparedocuments'] = function () {
			window.L.DomUtil.get('comparedocuments').click();
		};
		this.actionsMap['remotecomparedocuments'] = function () {
			app.map.fire('postMessage', {
				msgId: 'UI_InsertFile',
				args: {
					callback: 'Action_CompareDocuments',
					mimeTypeFilter: app.LOUtil.documentMimeFilter,
				},
			});
		};

		this.actionsMap['closetablet'] = function () {
			app.map.uiManager.enterReadonlyOrClose();
		};

		this.actionsMap['toggledarktheme'] = function () {
			app.map.uiManager.toggleDarkMode();
		};
		this.actionsMap['invertbackground'] = function () {
			app.map.uiManager.toggleInvert();
		};
		this.actionsMap['home-search'] = function () {
			app.map.uiManager.focusSearch();
		};
		this.actionsMap['backstage-new'] = function () {
			if (app.map.backstageView) {
				app.map.backstageView.show('new');
			}
		};
		this.actionsMap['renamedocument'] = function () {
			app.map.uiManager.renameDocument();
		};
		this.actionsMap['togglewasm'] = function () {
			app.map.uiManager.toggleWasm();
		};

		this.actionsMap['languagemenu'] = function () {
			app.map.fire('morelanguages');
		};
		this.actionsMap['morelanguages-selection'] = function () {
			app.map.fire('morelanguages', { applyto: 'selection' });
		};
		this.actionsMap['morelanguages-paragraph'] = function () {
			app.map.fire('morelanguages', { applyto: 'paragraph' });
		};
		this.actionsMap['morelanguages-all'] = function () {
			app.map.fire('morelanguages', { applyto: 'all' });
		};
		this.actionsMap['localgraphic'] = function () {
			window.L.DomUtil.get('insertgraphic').click();
		};
		this.actionsMap['remotegraphic'] = this.actionsMap['insertremotegraphic'] =
			function () {
				app.map.fire('postMessage', { msgId: 'UI_InsertGraphic' });
			};

		this.actionsMap['showhelp'] = function () {
			app.map.showHelp('online-help-content');
		};

		this.actionsMap['focustonotebookbar'] = function () {
			const tabsContainer = document.getElementsByClassName(
				'notebookbar-tabs-container',
			)[0].children[0];
			let elementToFocus: HTMLButtonElement;
			if (tabsContainer) {
				for (let i = 0; i < tabsContainer.children.length; i++) {
					if (tabsContainer.children[i].classList.contains('selected')) {
						elementToFocus = tabsContainer.children[i] as HTMLButtonElement;
						break;
					}
				}
			}
			if (!elementToFocus)
				elementToFocus = document.getElementById(
					'Home-tab-label',
				) as HTMLButtonElement;

			elementToFocus.focus();
		};

		// F6 steps forward and Shift+F6 back through the on-screen regions.
		this.actionsMap['focusnextregion'] = () => {
			this.focusRegion(1);
		};
		this.actionsMap['focuspreviousregion'] = () => {
			this.focusRegion(-1);
		};

		this.actionsMap['saveas'] = function () {
			if (app.map && app.map.uiManager.getCurrentMode() === 'notebookbar') {
				app.map.openSaveAs(); // Opens save as dialog if integrator supports it.
			}
		};

		this.actionsMap['insertcomment'] = function () {
			app.map.insertComment();
		};

		this.actionsMap['insertthreadedcomment'] = function () {
			app.map.insertThreadedComment();
		};

		this.actionsMap['showcommentsnavigator'] = function (data?: any) {
			if (
				!document
					.getElementById('navigation-sidebar')
					.classList.contains('visible')
			)
				app.map.sendUnoCommand('.uno:Navigator');
			app.map.sendUnoCommand(
				'.uno:NavigatorSelectComment?CommentId:short=' +
					(data ? (data as number) : 0),
			);
		};

		this.actionsMap['zoomin'] = () => {
			app.map.zoomIn(1, null, true /* animate? */);
		};
		this.actionsMap['zoomout'] = () => {
			app.map.zoomOut(1, null, true /* animate? */);
		};
		this.actionsMap['zoomreset'] = () => {
			app.map.setZoom(app.map.options.zoom, null, true);
		};
		this.actionsMap['fitwidthzoom'] = () => {
			if (app.activeDocument.activeLayout)
				app.activeDocument.activeLayout.adjustViewZoomLevel();
		};

		this.actionsMap['zoomSettings'] = () => {
			(app.map as any).settings.showSettingsDialog(
				'common-smartZoom-container',
			);
		};

		this.actionsMap['searchprev'] = () => {
			app.searchService.searchPrevious();
		};
		this.actionsMap['searchnext'] = () => {
			app.searchService.searchNext();
		};
		this.actionsMap['cancelsearch'] = () => {
			app.map.cancelSearch();
		};
		this.actionsMap['showsearchbar'] = () => {
			$('#toolbar-down').hide();
			$('#showsearchbar').removeClass('over');
			$('#toolbar-search').show();
			if (!app.isReadOnly() && app.map.isReadOnlyMode())
				$('#mobile-edit-button').hide();
			window.L.DomUtil.get('search-input').focus();
		};
		this.actionsMap['hidesearchbar'] = () => {
			$('#toolbar-search').hide();
			if (app.map.isEditMode()) $('#toolbar-down').show();
			/** show edit button if only we are able to edit but in readonly mode */
			if (!app.isReadOnly() && app.map.isReadOnlyMode())
				$('#mobile-edit-button').css('display', 'flex');
		};

		this.actionsMap['prev'] = () => {
			if (app.map._docLayer._docType === 'text') app.map.goToPage('prev');
			else app.map.setPart('prev');
		};
		this.actionsMap['next'] = () => {
			if (app.map._docLayer._docType === 'text') app.map.goToPage('next');
			else app.map.setPart('next');
		};

		this.actionsMap['inserttextbox'] = () => {
			app.map.sendUnoCommand('.uno:Text?CreateDirectly:bool=true');
		};
		this.actionsMap['insertannotation'] = () => {
			app.map.insertComment();
		};

		// PDF page-canvas document actions. On desktop the fork's bar is the ONE
		// bar (the host header hides while we are active), so these dispatch to
		// the host, which owns the password and combine flows and their save
		// gate. Form-field AUTHORING is edit behaviour: arm a draw tool; the
		// next drag on the page inserts a movable form control.
		this.actionsMap['formtext'] = () => {
			VulcanImpressInsertPlace.armTool('formtext');
		};
		this.actionsMap['formcheck'] = () => {
			VulcanImpressInsertPlace.armTool('formcheck');
		};
		this.actionsMap['setpassword'] = () => {
			app.map.fire('postMessage', { msgId: 'Vulcan_DocumentAction', args: { Action: 'password' } });
		};
		this.actionsMap['combinepdfs'] = () => {
			app.map.fire('postMessage', { msgId: 'Vulcan_DocumentAction', args: { Action: 'combine' } });
		};
		// Save and view: the host owns the save (its own acknowledged save,
		// then the swap back to the viewer), so this only asks; a save
		// requested here would race the host's.
		this.actionsMap['savedone'] = () => {
			VulcanImpressInsertPlace.disarmTool();
			app.map.fire('postMessage', { msgId: 'Vulcan_DocumentAction', args: { Action: 'view' } });
		};

		this.actionsMap['fold'] = () => {
			app.map.uiManager.toggleMenubar();
		};

		this.actionsMap['close'] = this.actionsMap['closemobile'] = () => {
			app.map.uiManager.enterReadonlyOrClose();
		};

		this.actionsMap['serveraudit'] = () => {
			app.map.serverAuditDialog.open();
		};

		this.actionsMap['togglea11ystate'] = () => {
			if (app.map._lockAccessibilityOn) {
				return;
			}
			var prevAccessibilityState =
				window.prefs.getBoolean('accessibilityState');
			app.map.setAccessibilityState(!prevAccessibilityState);
		};

		this.actionsMap['toggleuimode'] = () => {
			if (app.map.uiManager.shouldUseNotebookbarMode()) {
				app.map.uiManager.onChangeUIMode({ mode: 'classic', force: true });
			} else {
				app.map.uiManager.onChangeUIMode({ mode: 'notebookbar', force: true });
			}
		};

		this.actionsMap['showruler'] = () => {
			app.map.uiManager.toggleRuler();
		};

		this.actionsMap['showstylelistdeck'] = () => {
			app.map.uiManager.showStyleListDeck();
		};

		this.actionsMap['showstatusbar'] = () => {
			app.map.uiManager.toggleStatusBar();
		};

		this.actionsMap['collapsenotebookbar'] = () => {
			app.map.uiManager.collapseNotebookbar();
		};

		this.actionsMap['validatedialogsa11y'] = () => {
			if (window.app.a11yValidator) {
				window.app.a11yValidator.validateAllOpenDialogs();
			} else {
				console.warn('A11yValidator not available');
			}
		};

		this.actionsMap['validatesidebara11y'] = () => {
			if (window.app.a11yValidator) {
				window.app.a11yValidator.validateSidebar();
			} else {
				console.warn('A11yValidator not available');
			}
		};

		this.actionsMap['validatenotebookbara11y'] = () => {
			if (window.app.a11yValidator) {
				window.app.a11yValidator.validateNotebookbar();
			} else {
				console.warn('A11yValidator not available');
			}
		};
	}

	// Move keyboard focus into the the notebookbar (or the menubar when
	// the classic interface is in use). Returns false when there is
	// nothing to focus.
	private focusTopBar(): boolean {
		if (app.map.uiManager.getCurrentMode() === 'notebookbar') {
			this.actionsMap['focustonotebookbar']();
			return true;
		}
		const firstMenu = document.querySelector<HTMLElement>(
			'#main-menu > li > a[tabindex="0"]',
		);
		if (!firstMenu) return false;
		firstMenu.focus();
		return true;
	}

	// The focusable areas of the application, in the order F6 walks through
	// them.
	//
	// focus returns true when it actually moved keyboard focus into the
	// area, so focusRegion can skip to the next area instead of swallowing
	// the key press.
	//
	// An area defines blur only when it leaves sticky focus state behind that
	// has to be cleared as focus moves away from it.
	private getFocusRegions(): Array<{
		available: () => boolean;
		hasFocus: () => boolean;
		focus: () => boolean;
		blur?: () => void;
	}> {
		const contains = (element: HTMLElement | null) =>
			!!element && element.contains(document.activeElement);
		const isVisible = (element: HTMLElement | null) =>
			!!element && element.offsetParent !== null;
		const docType = app.map._docLayer ? app.map._docLayer._docType : '';
		const preview = () =>
			app.map._docLayer && (app.map._docLayer as any)._preview;

		const focusFirstIn = (element: HTMLElement | null) => {
			const focusables = element && JSDialog.GetFocusableElements(element);
			if (!focusables || !focusables.length) return false;
			focusables[0].focus();
			return true;
		};

		const topBar = {
			available: () => true,
			hasFocus: () =>
				contains(document.querySelector('.notebookbar-tabs-container')) ||
				contains(document.getElementById('main-menu')),
			focus: () => this.focusTopBar(),
		};

		const formulaBar = {
			available: () =>
				!app.isReadOnly() &&
				isVisible(document.getElementById('sc_input_window')),
			hasFocus: () => app.map.calcInputBarHasFocus(),
			focus: () => app.map.formulabar.focus(),
			blur: () => {
				if (app.map.formulabar) app.map.onFormulaBarBlur();
			},
		};

		const slidePanel = {
			available: () =>
				app.map.isPresentationOrDrawing() &&
				isVisible(document.getElementById('slide-sorter')),
			hasFocus: () => contains(document.getElementById('navigation-sidebar')),
			focus: () => {
				if (!preview()) return false;
				preview().focusCurrentSlide();
				preview().partsFocused = true;
				return true;
			},
			blur: () => {
				if (preview()) preview().partsFocused = false;
			},
		};

		const documentArea = {
			available: () => true,
			hasFocus: () => app.map.hasFocus() && !app.map.calcInputBarHasFocus(),
			focus: () => {
				app.map.focus();
				return true;
			},
		};

		const sidebar = {
			available: () => !!app.map.sidebar && app.map.sidebar.isVisible(),
			hasFocus: () => !!app.map.sidebar && contains(app.map.sidebar.wrapper),
			focus: () => focusFirstIn(app.map.sidebar.wrapper),
		};

		const statusBar = {
			available: () => {
				const bar = document.getElementById('toolbar-down');
				if (!isVisible(bar)) return false;
				const focusables = JSDialog.GetFocusableElements(bar);
				return !!focusables && focusables.length > 0;
			},
			hasFocus: () => contains(document.getElementById('toolbar-down')),
			focus: () => focusFirstIn(document.getElementById('toolbar-down')),
		};

		const sheetTabs = {
			available: () =>
				isVisible(document.getElementById('spreadsheet-toolbar')),
			hasFocus: () => {
				const active = document.activeElement;
				return !!active && active.classList.contains('spreadsheet-tab');
			},
			focus: () => {
				const tab =
					document.querySelector<HTMLElement>('.spreadsheet-tab-selected') ||
					document.querySelector<HTMLElement>('.spreadsheet-tab');
				if (!tab) return false;
				tab.focus();
				return true;
			},
		};

		const regions = [topBar];
		if (docType === 'spreadsheet') regions.push(formulaBar);
		if (docType === 'presentation' || docType === 'drawing')
			regions.push(slidePanel);
		regions.push(documentArea);
		regions.push(sidebar);
		if (docType === 'spreadsheet') regions.push(sheetTabs);
		regions.push(statusBar);
		return regions;
	}

	private focusRegion(direction: number) {
		const regions = this.getFocusRegions().filter((region) =>
			region.available(),
		);
		if (!regions.length) return;

		const wrap = (index: number) =>
			((index % regions.length) + regions.length) % regions.length;
		const current = regions.findIndex((region) => region.hasFocus());

		// The first region to try is the neighbour in the requested direction.
		// When nothing is focused yet, start at the near end of the ring.
		let start;
		if (current !== -1) start = wrap(current + direction);
		else start = direction > 0 ? 0 : regions.length - 1;

		// Walk the ring from there, skipping any region that declines
		// focus, until one takes it. Clear that region's sticky focus
		// state only when there is another region to move to (so a
		// ring that has only one region is left unchanged).
		let blurred = false;
		for (let step = 0; step < regions.length; step++) {
			const index = wrap(start + direction * step);
			if (index === current) break;
			if (!blurred && current !== -1 && regions[current].blur) {
				regions[current].blur();
				blurred = true;
			}
			if (regions[index].focus()) return;
		}
	}

	// An AI action was triggered before a provider was configured. On the
	// desktop app the Options dialog opens right here, over the document,
	// scrolled to the AI section, so the user sets the provider up in place
	// and lands back on the document when they save. In a browser the File
	// menu leads straight to the same dialog, so a snackbar with the path
	// is enough.
	private static promptAISetup() {
		if (window.mode.isCODesktop()) {
			(app.map as any).settings.showSettingsDialog('ai-section');
		} else {
			app.map.uiManager.showSnackbar(
				_(
					'AI is not configured. Go to File > Options > AI Assistant to set it up.',
				),
			);
		}
	}

	private addAICommands() {
		this.actionsMap['aichat'] = function () {
			if (!app.map.isAIConfigured) {
				Dispatcher.promptAISetup();
				return;
			}
			const sidebar = JSDialog.getAIChatSidebar();
			sidebar.toggle();
		};

		this.actionsMap['helpfixformulaerror'] = function () {
			if (!app.map.isAIConfigured) {
				Dispatcher.promptAISetup();
				return;
			}
			const sidebar = JSDialog.getAIChatSidebar();
			if (!sidebar.isVisible()) sidebar.show();
			sidebar.diagnoseFormulaError();
		};
	}

	private addExportCommands() {
		this.actionsMap['exportpdf'] = function () {
			app.map.sendUnoCommand('.uno:ExportToPDF', {
				SynchronMode: {
					type: 'boolean',
					value: false,
				},
			});
		};

		this.actionsMap['exportdirectpdf'] = function () {
			// A PDF opened on the page canvas is a drawing, and its fields must
			// come back out as real AcroForm fields. ExportDirectToPDF (sfx2)
			// skips doc_saveAs, so the PDF filter falls back to its config
			// default ExportFormFields=false and flattens them; the ordinary
			// download (doc_saveAs, as the backstage's fallback does) keeps them.
			if (app.map.getDocType && app.map.getDocType() === 'drawing') {
				const fileName: string = app.map['wopi']?.BaseFileName || 'document';
				const dot = fileName.lastIndexOf('.');
				app.map.downloadAs(
					(dot > 0 ? fileName.substring(0, dot) : fileName) + '.pdf',
					'pdf',
				);
				return;
			}
			app.map.sendUnoCommand('.uno:ExportDirectToPDF', {
				SynchronMode: {
					type: 'boolean',
					value: false,
				},
			});
		};

		this.actionsMap['exportepub'] = function () {
			app.map.sendUnoCommand('.uno:ExportToEPUB', {
				SynchronMode: {
					type: 'boolean',
					value: false,
				},
			});
		};
	}

	private addCalcCommands() {
		this.actionsMap['sheettabmenu'] = function () {
			if (app.map.tabsControl)
				app.map.tabsControl.openContextMenuForFocusedTab();
		};

		this.actionsMap['acceptformula'] = function () {
			// ✓ is ACCEPT, not accept-and-advance. Google Sheets' phone grammar
			// keeps them distinct: ✓ commits and the SAME cell stays selected;
			// only the return key commits-and-moves-down (SPEC-sheets §3.1/§9.5).
			// The phone branch used to post a raw Enter here, which is the
			// return verb — and with no edit live it still moved the selection,
			// so a double-tapped ✓ walked the cursor down the sheet. Core's
			// SID_ACCEPT_FORMULA (engine sc/source/ui/view/cellsh3.cxx) commits
			// via InputEnterHandler with no cursor move and is a no-op without a
			// live edit view, for the fx-bar and in-cell editors alike — the
			// same one desktop ✓ has always sent. The VulcanEscape celledit rung
			// and closeapp's exit save both dispatch this action, so all three
			// commit surfaces keep the cell in place.
			app.map.sendUnoCommand('.uno:AcceptFormula');

			// The whole teardown (cursor-mirror prologue, suggestion-strip
			// close, chrome + blur, publish-last) is ONE seam —
			// Toolbar.vulcanEndCellEditSession. A direct blur pair here would
			// be a second, prologue-less exit path: the resize re-arm zombie's
			// door (R7 hunt #6).
			app.map.vulcanEndCellEditSession();
			app.map.formulabarSetDirty();
		};

		this.actionsMap['cancelformula'] = function () {
			app.map.sendUnoCommand('.uno:Cancel');
			app.map.vulcanEndCellEditSession();
			app.map.formulabarSetDirty();
		};

		this.actionsMap['startformula'] = function () {
			app.map.sendUnoCommand('.uno:StartFormula');
			app.map.onFormulaBarFocus();
			app.map.formulabarFocus();
			app.map.formulabarSetDirty();
		};

		this.actionsMap['functiondialog'] = function () {
			if (window.mode.isSmallScreenDevice() && app.map._functionWizardData) {
				app.map._docLayer._closeMobileWizard();
				app.map._docLayer._openMobileWizard(app.map._functionWizardData);
				app.map.formulabarSetDirty();
			} else {
				app.map.sendUnoCommand('.uno:FunctionDialog');
			}
		};

		this.actionsMap['print-active-sheet'] = function () {
			const currentSheet = app.map._docLayer._selectedPart + 1;
			const options = {
				ExportFormFields: {
					type: 'boolean',
					value: false,
				},
				ExportNotes: {
					type: 'boolean',
					value: false,
				},
				SheetRange: {
					type: 'string',
					value: currentSheet + '-' + currentSheet,
				},
			};
			const optionsString = JSON.stringify(options);
			app.map.print(optionsString);
		};

		this.actionsMap['print-all-sheets'] = function () {
			app.map.print();
		};
		this.actionsMap['togglerelative'] = function () {
			app.map.sendUnoCommand('.uno:ToggleRelative');
		};
		this.actionsMap['focusonaddressinput'] = function () {
			const addressInput = document.querySelector<HTMLInputElement>(
				'#addressInput input',
			);
			addressInput?.focus();
		};

		// sheets toolbar
		this.actionsMap['insertsheet'] = function () {
			var nPos = $('#spreadsheet-tab-scroll')[0].childElementCount;
			app.map.insertPage(nPos);
			app.map.insertPage.scrollToEnd = true;
		};
		this.actionsMap['firstrecord'] = function () {
			$('#spreadsheet-tab-scroll').scrollLeft(0);
		};
		// ‹ › page through the sheet tabs by the strip's visible width (less a
		// sliver of overlap), like the arrows in Sheets and Excel. A fixed
		// 60px step (30px back) meant several clicks per tab on a workbook
		// with dozens of sheets.
		const pageSheetTabs = function (direction: number) {
			const strip = document.getElementById('spreadsheet-tab-scroll');
			if (!strip) return;
			strip.scrollBy({
				left: direction * Math.max(80, strip.clientWidth - 48),
				behavior: 'smooth',
			});
		};
		this.actionsMap['nextrecord'] = function () {
			pageSheetTabs(1);
		};
		this.actionsMap['prevrecord'] = function () {
			pageSheetTabs(-1);
		};
		this.actionsMap['lastrecord'] = function () {
			// Set a very high value, so that scroll is set to the maximum possible value internally.
			// https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollLeft
			window.L.DomUtil.get('spreadsheet-tab-scroll').scrollLeft = 100000;
		};
		this.actionsMap['columnrowhighlight'] = function () {
			var newState = !app.map.uiManager.getHighlightMode();
			app.map.uiManager.setHighlightMode(newState);

			if (newState) FocusCellSection.showFocusCellSection();
			else FocusCellSection.hideFocusCellSection();

			app.sectionContainer.requestReDraw();
		};

		this.actionsMap['defaultborderstyle'] = () => {
			app.map.sendUnoCommand(
				window.getBorderStyleUNOCommand(0, 0, 1, 0, 0, 0, 0),
			);
		};
	}

	private addImpressAndDrawCommands() {
		this.actionsMap['presentation'] = this.actionsMap[
			'fullscreen-presentation'
		] = () => {
			const isWelcomePresentation =
				window.coolParams.get('welcome') === 'true' ? true : false;
			if (window.canvasSlideshowEnabled) {
				// The Presenter View toggle decides whether the start buttons open
				// the presenter console. The welcome slideshow always plays plain.
				if (
					!isWelcomePresentation &&
					app.map.uiManager.shouldShowPresenterConsole()
				)
					app.map.fire('newpresentinconsole', {});
				else app.map.fire('newfullscreen', { isWelcomePresentation });
			} else app.map.fire('fullscreen');
		};

		this.actionsMap['presentation-currentslide'] = () => {
			const startSlideNumber = app.map.getCurrentPartNumber();
			if (window.canvasSlideshowEnabled) {
				if (app.map.uiManager.shouldShowPresenterConsole())
					app.map.fire('newpresentinconsole', { startSlideNumber });
				else app.map.fire('newfullscreen', { startSlideNumber });
			} else app.map.fire('fullscreen', { startSlideNumber });
		};

		this.actionsMap['presentinwindow'] = this.actionsMap['present-in-window'] =
			() => {
				const welcomePresentation =
					window.coolParams.get('welcome') === 'true' ? true : false;
				if (window.canvasSlideshowEnabled)
					app.map.fire('newpresentinwindow', {
						isWelcomePresentation: welcomePresentation,
					});
				else
					app.map.fire('presentinwindow', {
						isWelcomePresentation: welcomePresentation,
					});
			};

		this.actionsMap['followmepresentation'] = this.actionsMap[
			'presentation-follow-me'
		] = () => {
			app.map.slideShowPresenter.setLeader(true);
			app.map.fire('newpresentinwindow');
		};

		this.actionsMap['followpresentation'] = this.actionsMap[
			'presentation-follow'
		] = () => {
			app.map.slideShowPresenter.setLeader(false);
			app.map.slideShowPresenter.setFollower(true);
			app.map.slideShowPresenter.setFollowing(true);
			app.map.fire('newfollowmepresentation');
		};

		this.actionsMap['presenterconsole'] = () => {
			if (window.canvasSlideshowEnabled)
				app.map.uiManager.togglePresenterConsole();
		};

		this.actionsMap['fullscreen-drawing'] = () => {
			app.util.toggleFullScreen();
		};

		this.actionsMap['deletepage'] = function () {
			let msg: string;
			if (app.map.getDocType() === 'presentation') {
				msg = _('Are you sure you want to delete this slide?');
			} else {
				/* drawing */
				msg = _('Are you sure you want to delete this page?');
			}
			app.map.uiManager.showInfoModal(
				'deleteslide-modal',
				_('Delete'),
				msg,
				'',
				_('OK'),
				function () {
					app.map.deletePage();
				},
				true,
				'deleteslide-modal-response',
			);
		};

		this.actionsMap['previouspart'] = function () {
			// In file based view all parts are in one endless scroll; in the
			// part based view (e.g. Viewing mode entered from an edit
			// session) scrolling within the single visible part is a no-op,
			// so switch the part instead.
			if (app.file.fileBasedView)
				app.map._docLayer._preview._scrollViewByDirection('prev');
			else app.map.setPart('prev');
		};

		this.actionsMap['nextpart'] = function () {
			if (app.file.fileBasedView)
				app.map._docLayer._preview._scrollViewByDirection('next');
			else app.map.setPart('next');
		};

		this.actionsMap['lastpart'] = function () {
			if (app && app.file.fileBasedView === true) {
				const partToSelect = app.map._docLayer._parts - 1;
				app.map._docLayer._preview._scrollViewToPartPosition(partToSelect);
			}
		};

		// The statusbar Overview button: toggle the all-slides view. The
		// upstream item carried a placeholder uno command that INSERTED a
		// blank slide on every press.
		this.actionsMap['overview'] = function () {
			// The view-switch methods are Impress-only and live on the JS
			// tile layer, not DocLayerInterface.
			const docLayer: any = app.map._docLayer;
			if (!docLayer || app.map.getDocType() !== 'presentation') return;
			if (app.file.fileBasedView) docLayer._switchToPartBasedView();
			else docLayer._switchToFileBasedView();
			app.map.focus();
		};

		this.actionsMap['firstpart'] = function () {
			if (app && app.file.fileBasedView === true) {
				const partToSelect = 0;
				app.map._docLayer._preview._scrollViewToPartPosition(partToSelect);
			}
		};

		this.actionsMap['hideslide'] = function () {
			app.map.hideSlide();
		};
		this.actionsMap['showslide'] = function () {
			app.map.showSlide();
		};
		this.actionsMap['duplicatepage'] = function () {
			app.map.duplicatePage();
		};
		this.actionsMap['insertpage'] = function () {
			app.map.insertPage();
		};

		this.actionsMap['leftpara'] = function () {
			app.map.sendUnoCommand(
				(window as any).getUNOCommand({
					textCommand: '.uno:LeftPara',
					objectCommand: '.uno:ObjectAlignLeft',
					unosheet: '.uno:AlignLeft',
				}),
			);
		};
		this.actionsMap['centerpara'] = function () {
			app.map.sendUnoCommand(
				(window as any).getUNOCommand({
					textCommand: '.uno:CenterPara',
					objectCommand: '.uno:AlignCenter',
					unosheet: '.uno:AlignHorizontalCenter',
				}),
			);
		};
		this.actionsMap['rightpara'] = function () {
			app.map.sendUnoCommand(
				(window as any).getUNOCommand({
					textCommand: '.uno:RightPara',
					objectCommand: '.uno:ObjectAlignRight',
					unosheet: '.uno:AlignRight',
				}),
			);
		};

		this.actionsMap['selectbackground'] = function () {
			window.L.DomUtil.get('selectbackground').click();
		};

		this.actionsMap['notesmode'] = function () {
			// PHONE IMPRESS TAKES THE READ-ONLY STRIP, NOT CORE'S NOTES VIEW.
			//
			// The kebab row that lands here already says "Speaker Notes"
			// (Control.Menubar.ts, mobilepresentation > view), and what it
			// did was .uno:NotesMode — which swaps the whole canvas for the
			// notes PAGE: a full A4 notes layout with the slide shrunk into
			// its top half, rendered into a 390px-wide phone. That is the
			// desktop authoring view, and it is the opposite of the row
			// google-slides.json describes: "a region appears below the
			// slide", with the slide still the hero.
			//
			// So under the Vulcan phone chrome the same row raises
			// Control.SpeakerNotes.ts instead. Everywhere else — desktop,
			// tablet, and a phone forced to desktop chrome with
			// ?vulcanChrome=desktop — falls through to the stock behaviour
			// below unchanged, which is also what the desktop View menu's
			// own "Notes View" row (Control.Menubar.ts) still means.
			//
			// The gate lives in isPhoneImpressChrome() so the dispatcher and
			// the strip's stylesheet cannot disagree about who is on the
			// phone surface: both halves of the phone gate plus the
			// presentation doctype.
			//
			// 🔴 THE ROW REALLY DOES RENDER IN BOTH PHONE POSTURES, traced
			// rather than assumed, because "the array contains it" is not the
			// same claim as "it ships" and this row is the strip's ONLY entry
			// point. A first pass here got it backwards and added a
			// read-posture allowance in Control.Menubar.ts that does nothing;
			// that edit was withdrawn. The actual chain, for the next person:
			//   - the phone kebab does NOT build the <ul> menubar. #main-menu-
			//     state's change handler calls generateFullMenuStructure() and
			//     fires 'mobilewizard' with it (Control.Menubar.ts), so the
			//     wizard is what the ⋮ opens on a small-screen device.
			//   - that structure filters through _checkItemVisibility ONLY —
			//     for the top-level items and again for each child. It never
			//     consults allowedViewModeActions, which is the read-only
			//     action filter and lives exclusively in the <ul> path.
			//   - walking _checkItemVisibility for this row: no mobileapp /
			//     iosapp flag; type is 'action', so the read-only
			//     allowedReadonlyMenus test (which applies to type 'menu')
			//     does not reach it; 'notesmode' is in neither the read-only
			//     nor the edit-mode id switch; and none of the ~25 later
			//     id-keyed WOPI tests names it. It returns true.
			//   - its parent, the 'view' drill-in, IS type 'menu' and IS in
			//     allowedReadonlyMenus, so the drill-in opens in the read
			//     posture too.
			//   - selection routes back here: JSDialogBuilder calls
			//     menubar._executeAction, whose 'notesmode' case dispatches
			//     this action.
			// So the strip is reachable in the read posture — where a viewer-
			// first product wants a display verb — without any menu change.
			if (VulcanSpeakerNotes.isPhoneImpressChrome()) {
				VulcanSpeakerNotes.get().toggle();
				return;
			}
			if (app.impress.notesMode)
				app.map.sendUnoCommand('.uno:NormalMultiPaneGUI');
			else app.map.sendUnoCommand('.uno:NotesMode');
		};

		this.actionsMap['animationdeck'] = () => {
			app.map.sidebarFromNotebookbar.toggleAnimationsSidebar();
		};

		this.actionsMap['transitiondeck'] = () => {
			app.map.sidebarFromNotebookbar.toggleTransitionsSidebar();
		};
	}

	private addZoteroCommands() {
		this.actionsMap['zoteroaddeditcitation'] = function () {
			app.map.zotero.handleItemList();
		};
		this.actionsMap['zoterosetdocprefs'] = function () {
			app.map.zotero.handleStyleList();
		};
		this.actionsMap['zoteroaddeditbibliography'] = function () {
			app.map.zotero.insertBibliography();
		};
		this.actionsMap['zoteroaddnote'] = function () {
			app.map.zotero.handleInsertNote();
		};
		this.actionsMap['zoterorefresh'] = function () {
			app.map.zotero.refreshCitationsAndBib();
		};
		this.actionsMap['zoterounlink'] = function () {
			app.map.zotero.unlinkCitations();
		};
	}

	private addWriterCommands() {
		// Word-parity heading shortcuts (Ctrl+Alt+1/2/3). JSON args instead of
		// the .uno:StyleApply?Style=… query form: style names contain spaces
		// and the kit's 'uno' message tokenizes on them.
		const applyParagraphStyle = (style: string) => {
			app.map.sendUnoCommand('.uno:StyleApply', {
				Style: { type: 'string', value: style },
				FamilyName: { type: 'string', value: 'ParagraphStyles' },
			});
		};
		this.actionsMap['applyheading1'] = () => applyParagraphStyle('Heading 1');
		this.actionsMap['applyheading2'] = () => applyParagraphStyle('Heading 2');
		this.actionsMap['applyheading3'] = () => applyParagraphStyle('Heading 3');

		this.actionsMap['.uno:ShowResolvedAnnotations'] = function () {
			const items = app.map['stateChangeHandler'];
			let val = items.getItemValue('.uno:ShowResolvedAnnotations');
			val = val === 'true' || val === true;
			app.map.showResolvedComments(!val);
		};

		this.actionsMap['showannotations'] = function () {
			const items = app.map['stateChangeHandler'];
			let val = items.getItemValue('showannotations');
			val = val === 'true' || val === true;
			app.map.showComments(!val);
		};

		this.actionsMap['.uno:AcceptAllTrackedChanges'] = function () {
			app.map.sendUnoCommand('.uno:AcceptAllTrackedChanges');
			app.socket.sendMessage('commandvalues command=.uno:ViewAnnotations');
		};

		this.actionsMap['.uno:RejectAllTrackedChanges'] = function () {
			app.map.sendUnoCommand('.uno:RejectAllTrackedChanges');
			const commentSection = app.sectionContainer.getSectionWithName(
				app.CSections.CommentList.name,
			);
			commentSection.rejectAllTrackedCommentChanges();
		};

		this.actionsMap['toggletracking'] = () => {
			const TrackChangesCurrentState =
				app.map['stateChangeHandler'].getItemValue('.uno:TrackChanges');
			if (
				TrackChangesCurrentState === 'true' ||
				TrackChangesCurrentState === true
			)
				app.map.sendUnoCommand('.uno:TrackChanges?TrackChanges:bool=false');
			else app.map.sendUnoCommand('.uno:TrackChangesInAllViews');
		};

		this.actionsMap['acceptTrackedChangeToNext'] = function () {
			app.map.sendUnoCommand('.uno:AcceptTrackedChangeToNext');
		};

		this.actionsMap['rejectTrackedChangeToNext'] = function () {
			app.map.sendUnoCommand('.uno:RejectTrackedChangeToNext');
		};

		this.actionsMap['multipageview'] = function () {
			if (app.activeDocument && app.activeDocument.activeLayout) {
				let commandState = false;
				if (app.activeDocument.activeLayout.type === 'ViewLayoutMultiPage') {
					app.activeDocument.activeLayout = new ViewLayoutWriter();
					app.activeDocument.activeLayout.adjustViewZoomLevel();
				} else {
					app.activeDocument.activeLayout = new ViewLayoutMultiPage();
					commandState = true;
				}

				app.map.fire('commandstatechanged', {
					commandName: 'multipageview',
					state: commandState ? 'true' : 'false',
				});
				app.activeDocument.activeLayout.sendClientVisibleArea();
				app.sectionContainer.requestReDraw();

				// Remember the choice per user per document so the next open
				// restores it. updateviewmode persists through the WOPI host;
				// the native app builds have no WOPI host and no handler for
				// it, so the bridge rejects it as an unknown command.
				if (!window.ThisIsAMobileApp)
					app.socket.sendMessage(
						'updateviewmode mode=' + (commandState ? 'multipage' : 'normal'),
					);
			}
		};

		this.actionsMap['comparechanges'] = function () {
			if (app.activeDocument && app.activeDocument.activeLayout) {
				Util.ensureValue(app.activeDocument);
				app.socket.sendMessage('uno .uno:RedlineRenderMode');

				const commandState =
					app.activeDocument.activeLayout.type === 'ViewLayoutCompareChanges';

				app.map.fire('commandstatechanged', {
					commandName: 'comparechanges',
					state: !commandState ? 'true' : 'false',
				});

				app.activeDocument.activeLayout = commandState
					? new ViewLayoutWriter()
					: new ViewLayoutCompareChanges();

				// Do this only if we are switching to Writer normal layout.
				// Try to handle this in constructor for compare-changes layout.
				if (commandState) {
					RenderManager.redraw();
					app.map._docLayer._fitWidthZoom(null, null, true);
					app.activeDocument.activeLayout.sendClientVisibleArea();
					app.sectionContainer.requestReDraw();
				}
			}
		};

		// View Changes menu: radio-style actions (Inline / Side by Side / Hidden).
		// Each action activates its mode and deactivates the others.

		const updateViewChangesState = function (mode: string) {
			const states: Record<string, boolean> = {
				'viewchanges-inline': mode === 'inline',
				'viewchanges-sidebyside': mode === 'sidebyside',
				'viewchanges-hidden': mode === 'hidden',
				viewchanges: mode !== 'hidden',
			};

			for (const key in states) {
				const val = states[key] ? 'true' : 'false';
				app.map['stateChangeHandler'].setItemValue(key, val);
				app.map.fire('commandstatechanged', {
					commandName: key,
					state: val,
				});
			}
		};

		const switchToWriterLayout = function () {
			if (
				app.activeDocument?.activeLayout?.type === 'ViewLayoutCompareChanges'
			) {
				app.activeDocument.activeLayout = new ViewLayoutWriter();
				RenderManager.redraw();
				app.map._docLayer._fitWidthZoom(null, null, true);
				app.activeDocument.activeLayout.sendClientVisibleArea();
				app.sectionContainer.requestReDraw();
			}
		};

		this.actionsMap['viewchanges-inline'] = function () {
			if (!app.activeDocument?.activeLayout) return;

			switchToWriterLayout();

			// Ensure inline tracked changes are visible.
			const showState = app.map['stateChangeHandler'].getItemValue(
				'.uno:ShowTrackedChanges',
			);
			if (showState !== 'true')
				app.map.sendUnoCommand('.uno:ShowTrackedChanges');

			updateViewChangesState('inline');
		};

		this.actionsMap['viewchanges-sidebyside'] = function () {
			if (!app.activeDocument?.activeLayout) return;

			Util.ensureValue(app.activeDocument);
			app.socket.sendMessage('uno .uno:RedlineRenderMode');

			if (app.activeDocument.activeLayout.type !== 'ViewLayoutCompareChanges')
				app.activeDocument.activeLayout = new ViewLayoutCompareChanges();

			updateViewChangesState('sidebyside');
		};

		this.actionsMap['viewchanges-hidden'] = function () {
			if (!app.activeDocument?.activeLayout) return;

			switchToWriterLayout();

			// Ensure inline tracked changes are hidden.
			const showState = app.map['stateChangeHandler'].getItemValue(
				'.uno:ShowTrackedChanges',
			);
			if (showState === 'true')
				app.map.sendUnoCommand('.uno:ShowTrackedChanges');

			updateViewChangesState('hidden');
		};
	}

	private addMobileCommands() {
		this.actionsMap['comment_wizard'] = function () {
			const configuration = window as any;
			if (configuration.commentWizard) {
				configuration.commentWizard = false;
				app.sectionContainer
					.getSectionWithName(app.CSections.CommentList.name)
					.removeHighlighters();
				app.map.fire('closemobilewizard');
				app.map.mobileTopBar.selectItem('comment_wizard', false);
			} else {
				if (configuration.insertionMobileWizard)
					app.dispatcher.dispatch('insertion_mobile_wizard');
				else if (configuration.mobileWizard)
					app.dispatcher.dispatch('mobile_wizard');
				configuration.commentWizard = true;
				var menuData = app.map._docLayer.getCommentWizardStructure();
				app.map.fire('mobilewizard', { data: menuData });
				app.map.mobileTopBar.selectItem('comment_wizard', true);
			}
		};
		this.actionsMap['mobile_wizard'] = () => {
			const configuration = window as any;
			// Google-style "A" sheet (docs/mobile-redesign/01 §3, 02 §4;
			// supersedes 03-impress.md §4, which recorded Impress keeping
			// the LO sidebar drill-in "this phase"): on phones the format
			// button opens the client-built
			// sheet — Text/Paragraph for Writer, Text/Cell for Calc,
			// Text/Paragraph/Shape for Impress — instead of the LO sidebar
			// drill-in. Google Slides: "Select text or an object, then tap
			// the Format icon (an 'A' with lines) in the bottom bar. A
			// draggable bottom sheet rises with tabbed formatting."
			//
			// Impress was left out of this gate when the sheet was built, so
			// the same glyph the user learned in Calc fell through to
			// .uno:SidebarShow — a server round trip, then the desktop
			// LibreOffice sidebar deck rendered inside a 390px wizard. Only
			// Draw still takes that path.
			//
			// This widens the doctype list and nothing else: the form-factor
			// half of the condition is left exactly as the Writer and Calc
			// branches already had it, so all three doctypes keep one rule.
			//
			// 🔴 That one rule is isSmallScreenDevice() ALONE, not the usual
			// both-halves phone-chrome gate. It is deliberate here (matching
			// the shipped Writer/Calc branches beats making Impress the odd
			// doctype out), but it means ?vulcanChrome=desktop on a phone
			// STILL opens this sheet — the class is off while the gate is
			// true. Anything that has to be true wherever the sheet opens
			// must therefore not be scoped to html.vulcan-mobile-chrome. The
			// live case is the 44px back box: vulcan-theme.css §13i.10 is
			// keyed on body[data-doctype='presentation'] only, for exactly
			// this reason. If this gate is ever tightened to both halves,
			// tighten that selector with it — and do it for all three
			// doctypes at once.
			const useVulcanFormatSheet =
				window.mode.isSmallScreenDevice() &&
				app.map._docLayer &&
				(app.map._docLayer._docType === 'text' ||
					app.map._docLayer._docType === 'spreadsheet' ||
					app.map._docLayer._docType === 'presentation') &&
				(window as any).VulcanMobileFormat;
			if (configuration.mobileWizard) {
				configuration.mobileWizard = false;
				if (!useVulcanFormatSheet)
					app.map.sendUnoCommand('.uno:SidebarHide');
				app.map.fire('closemobilewizard');
				app.map.mobileTopBar.selectItem('mobile_wizard', false);
			} else {
				if (configuration.insertionMobileWizard)
					app.dispatcher.dispatch('insertion_mobile_wizard');
				else if (configuration.commentWizard)
					app.dispatcher.dispatch('comment_wizard');
				configuration.mobileWizard = true;
				if (useVulcanFormatSheet) {
					(window as any).VulcanMobileFormat.open(app.map);
				} else {
					app.map.sendUnoCommand('.uno:SidebarShow');
					app.map.fire('showwizardsidebar');
				}
				app.map.mobileTopBar.selectItem('mobile_wizard', true);
			}
		};

		this.actionsMap['insertion_mobile_wizard'] = () => {
			const configuration = window as any;
			if (configuration.insertionMobileWizard) {
				configuration.insertionMobileWizard = false;
				app.map.fire('closemobilewizard');
				app.map.mobileTopBar.selectItem('insertion_mobile_wizard', false);
			} else {
				if (configuration.mobileWizard)
					app.dispatcher.dispatch('mobile_wizard');
				else if (configuration.commentWizard)
					app.dispatcher.dispatch('comment_wizard');
				configuration.insertionMobileWizard = true;
				const menuData = app.map.menubar.generateInsertMenuStructure();
				app.map.fire('mobilewizard', { data: menuData });
				app.map.mobileTopBar.selectItem('insertion_mobile_wizard', true);
			}
		};

		this.actionsMap['fontcolor'] = () => {
			app.map.fire('mobilewizard', {
				data: (window as any).getColorPickerData('Font Color'),
			});
		};
		this.actionsMap['backcolor'] = () => {
			app.map.fire('mobilewizard', {
				data: (window as any).getColorPickerData('Highlight Color'),
			});
		};
		// TODO: leftover from mobile bottom bar
		// if (id === 'fontcolor' && typeof e.color !== 'undefined') {
		// 	onColorPick(id, e.color, e.themeData);
		// }
		// else if (id === 'backcolor' && typeof e.color !== 'undefined') {
		// 	onColorPick(id, e.color, e.themeData);
		// }
		// else if (id === 'backgroundcolor' && typeof e.color !== 'undefined') {
		// 	onColorPick(id, e.color, e.themeData);
		// }
	}

	/// optional docType specifies which commands should we load
	constructor(docType: string = undefined) {
		docType = docType ? docType : app.map._docLayer._docType;

		this.addGeneralCommands();
		this.addExportCommands();
		this.addAICommands();

		if (docType === 'text') {
			this.addWriterCommands();
			this.addZoteroCommands();
		} else if (docType === 'spreadsheet') {
			this.addCalcCommands();
		} else if (['presentation', 'drawing'].includes(docType)) {
			this.addImpressAndDrawCommands();
		}

		if (window.mode.isSmallScreenDevice()) this.addMobileCommands();
	}

	public dispatch(action: string, data?: any) {
		// Named-action telemetry (save/showsearchbar/presentation/…): action
		// ids are a fixed code-defined vocabulary — never user text.
		if (app.telemetry)
			app.telemetry.recordAppAction(action);

		// Don't allow to execute new actions while any dialog is visible.
		// It prevents launching multiple instances of the same dialog.
		// Exception: validatedialogsa11y needs to run when dialogs are open.
		if (
			action !== 'validatedialogsa11y' &&
			(app.map.dialog.hasOpenedDialog() ||
				(app.map.jsdialog && app.map.jsdialog.hasDialogOpened()))
		) {
			app.map.dialog.blinkOpenDialog();
			console.debug('Cannot dispatch: ' + action + ' when dialog is opened.');
			return;
		}

		if (action.indexOf('saveas-') === 0) {
			const format = action.substring('saveas-'.length);
			app.map.openSaveAs(format);
			return;
		} else if (action.indexOf('downloadas-') === 0) {
			const format = action.substring('downloadas-'.length);
			let fileName = app.map['wopi'].BaseFileName;
			fileName = fileName.substr(0, fileName.lastIndexOf('.'));
			fileName = fileName === '' ? 'document' : fileName;
			app.map.downloadAs(fileName + '.' + format, format);
			return;
		}

		if (action.indexOf('exportas-') === 0) {
			const format = action.substring('exportas-'.length);
			app.map.openSaveAs(format);
			return;
		}

		if (action.startsWith('extension-toggle-')) {
			const id = action.substring('extension-toggle-'.length);
			const ext = app.map._extensions && app.map._extensions[id];
			if (ext) ext.toggle();
			return;
		}

		if (
			action === '.uno:Copy' ||
			action === '.uno:Cut' ||
			action === '.uno:Paste' ||
			action === '.uno:PasteSpecial'
		) {
			app.map._clip.filterExecCopyPaste(action);
			return;
		}

		if (this.actionsMap[action] !== undefined) {
			this.actionsMap[action](data);
			return;
		}

		if (window.ThisIsTheWindowsApp && action.startsWith('new-')) {
			window.postMobileMessage(action);
			return;
		}

		// Generic fallback for bare .uno:* commands with no JS-side handler.
		// Forwards to core via sendUnoCommand — typically a fire-and-forget
		// toggle (the slot reads current state and flips). Optional args go
		// through `data` if the caller supplied any.
		if (action.startsWith('.uno:')) {
			app.map.sendUnoCommand(action, data);
			return;
		}

		console.error('unknown dispatch: "' + action + '"');
	}
}

app.definitions['dispatcher'] = Dispatcher;
