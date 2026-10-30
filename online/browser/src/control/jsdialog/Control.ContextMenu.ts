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

interface PositionInterface {
	x: number;
	y: number;
}

interface MenuEntry {
	enabled: string;
	type: string;
	text?: string;
	menu?: MenuEntry[];
	command: string;
	checked?: string;
	checktype?: string;
}

interface CtxtCommandEntry {
	name: string;
	isHtmlName: boolean;
	icon?: string;
	command?: string;
	items?: Record<string, CtxtValueType>;
	// Small-screen only. JSDialogBuilder.getMenuStructureForMobileWizard turns
	// a `callback` into executionType 'callback', and the wizard's click
	// handler calls it INSTEAD of sendUnoCommand(data.command). This is how the
	// phone path reaches the client-side handlers the desktop path already has
	// in _addMenu's callback; nothing sets it on the desktop structure.
	callback?: () => void;
}

type CtxtValueType = CtxtCommandEntry | string;

interface MenuCfg {
	entries: Array<ComboBoxEntry>;
	innerCallback: JSDialogMenuCallback;
}

class ContextMenuControl extends JSControl {
	private _prevMousePos: PositionInterface | null = null;
	private _currMousePos: PositionInterface | null = null;
	private _menuID: string = 'jsd-context-menu';
	private _menuPosID: string = 'canvas-context-menupos';
	private _menuPosEl: HTMLElement | null = null;
	private _autoFillContextMenu: boolean = false;
	private _spellingContextMenu: boolean = false;
	public hasContextMenu: boolean = false;

	constructor(options?: Record<string, any>) {
		super(options);
		this.options.allowlist = JSDialog.MenuCommands.allowlist;
		this.options.smallScreenAllowlist =
			JSDialog.MenuCommands.smallScreenAllowlist;
		this.options.mobileDenylist = JSDialog.MenuCommands.mobileDenylist;
	}

	public onAdd(map: MapInterface): HTMLElement | null {
		this._prevMousePos = null;
		this._autoFillContextMenu = false;

		map._contextMenu = this;
		map.on('locontextmenu', this._onContextMenu, this);
		map.on('mousedown', this._onMouseDown, this);
		map.on('mouseup', this._onMouseUp, this);
		map.on('keydown', this._onKeyDown, this);
		map.on('closepopups', this._onClosePopup, this);
		return null;
	}

	private _onClosePopup() {
		if (!this.hasContextMenu) {
			return;
		}

		if (this._autoFillContextMenu) {
			this._autoFillContextMenu = false;
			app.map._docLayer._resetReferencesMarks();
		}
		JSDialog.CloseDropdown(this._menuID);
		this.hasContextMenu = false;

		// Give the stolen focus back to map
		app.map.focus();
	}

	private _onMouseDown(): void {
		if (app.activeDocument && app.activeDocument.mouseControl)
			this._prevMousePos =
				app.activeDocument.mouseControl.getMousePagePosition();

		this._onClosePopup();
	}

	private _onMouseUp(): void {
		if (app.activeDocument && app.activeDocument.mouseControl)
			this._currMousePos =
				app.activeDocument.mouseControl.getMousePagePosition();
	}

	private _onKeyDown(e: Event) {
		if ((e as any).originalEvent.keyCode === 27 /* ESC */) {
			this._onClosePopup();
		}
	}

	private _onContextMenu(obj: any): void {
		Util.ensureValue(this._map);
		const map = this._map;

		const keyboardInvoked = obj.mouse === 'false';

		if (!map.isEditMode()) {
			return;
		}

		this._amendContextMenuData(obj);

		const contextMenu = this._createContextMenuStructure(obj);

		if (Object.keys(contextMenu).length == 0) {
			// We can sometimes end up filtering out everything in the menu ... in this case, there's nothing to display
			return;
		}

		this._spellingContextMenu = false;
		this._autoFillContextMenu = false;
		for (const menuItem in contextMenu) {
			if (menuItem.indexOf('.uno:SpellCheckIgnore') !== -1) {
				this._spellingContextMenu = true;
				break;
			} else if (menuItem.indexOf('.uno:AutoFill') !== -1) {
				// we should close the autofill preview popup before open autofill context menu
				map.fire('closeautofillpreviewpopup');
				this._autoFillContextMenu = true;
				break;
			}
		}

		// ESCAPE-HATCH MEASUREMENT, recorded because three separate audit passes
		// reported "the canvas context menu has no measured back/close control"
		// and left it as the one open ❓ in the phone escape-hatch list. It is
		// NOT missing, and the reason it kept reading as missing is that on a
		// phone THERE IS NO CONTEXT MENU: this branch never builds the desktop
		// `.context-menu-list` popup at all (that is the else at :149-152), it
		// hands the same items to the mobile wizard, so anyone looking for an
		// exit on a context-menu widget was looking at a surface that does not
		// exist on the device.
		//
		// What the wizard actually gives it, measured rather than assumed:
		//   - the control is `#mobile-wizard-back`, the FIRST cell of
		//     #mobile-wizard-titlebar (html/cool.html.m4:232-236), i.e. upper
		//     left, which is the invariant the direction fixes.
		//   - it is shown, not merely present: _softReset() calls
		//     _setupBackButton() (Control.MobileWizardWindow.js:105-110), which
		//     is `backButton.show()` plus the 'close-button' class (:129-131),
		//     and titleBar.show() on the same path. The two places the titlebar
		//     is hidden do not apply here -- setTabs() (:218, tab mode) and the
		//     isPopup branch (:606).
		//   - the box is 48x44 on a presentation: css/mobilewizard.css:264-270
		//     gives .mobile-wizard-back width 48px / height 20px, and
		//     css/vulcan-theme.css:2242-2245 raises height and min-height to
		//     44px under body[data-doctype='presentation']. So it clears the
		//     >=44px hit box on phone Impress. ⚠ On phone WRITER and CALC it is
		//     still 48x20, because that override is doctype-scoped -- that is a
		//     Calc/Writer finding, not an Impress one, and it is not fixed here.
		//   - one tap exits one layer: at root depth goLevelUp() takes the
		//     `window.contextMenuWizard` arm (:310-312) and fires
		//     'closemobilewizard', returning to the canvas.
		//
		// ⚠ Still device-only: whether the wizard sheet actually opens on a
		// long-press over the canvas. This measures the exit, not the entry.
		if (window.mode.isSmallScreenDevice()) {
			window.contextMenuWizard = true;
			this._attachPhoneCommentCallbacks(contextMenu);
			const menuData =
				window.L.Control.JSDialogBuilder.getMenuStructureForMobileWizard(
					contextMenu,
					true,
					'',
				);
			map.fire('mobilewizard', { data: menuData });
		} else {
			this._addMenu(contextMenu, keyboardInvoked);
			$('#' + this._menuPosID).focus();
			this.hasContextMenu = true;
		}
	}

	private _addMenu(
		contextMenu: Record<string, CtxtValueType>,
		keyboardInvoked: boolean,
	): void {
		Util.ensureValue(this._map);
		const map = this._map;
		Util.ensureValue(app.activeDocument);
		Util.ensureValue(app.activeDocument.mouseControl);
		// A keyboard-opened menu is placed at the caret or active cell, falling
		// back to the mouse when there is no visible cursor.
		const position =
			(keyboardInvoked &&
				app.activeDocument.mouseControl.getCursorCanvasPosition()) ||
			app.activeDocument.mouseControl.getMouseCanvasPosition();
		Util.ensureValue(position);
		const container = document.getElementById('canvas-container');
		Util.ensureValue(container);
		if (!this._menuPosEl) {
			this._menuPosEl = document.createElement('div');
			this._menuPosEl.id = this._menuPosID;
			container.append(this._menuPosEl);
		}
		const menuPosEl = this._menuPosEl;
		menuPosEl.style.position = 'absolute';
		menuPosEl.style.zIndex = '1500';
		menuPosEl.style.left = position.x + 'px';
		menuPosEl.style.top = position.y + 'px';
		const entries = this._getMenuEntries(contextMenu);
		const callback = (
			objectType: string,
			eventType: string,
			object: any,
			data: any,
			entry: JSBuilder | MenuDefinition,
		): boolean => {
			const key = (entry as MenuDefinition).id;
			if (key === '.uno:InsertAnnotation') {
				app.map.insertComment();
				return false;
			}

			if (key === 'saveimagetowopi') {
				var ext =
					GraphicSelection.extraInfo &&
					GraphicSelection.extraInfo.graphicExtension
						? GraphicSelection.extraInfo.graphicExtension
						: 'png';
				map._saveImageToWopi = true;
				map.openSaveAs(ext);
				return false;
			}

			const unoentry = entry as MenuDefinition;
			Util.ensureValue(unoentry.uno);
			const uno =
				unoentry.uno.indexOf('.uno:') === 0
					? unoentry.uno
					: '.uno:' + unoentry.uno;
			if (
				app.map._clip === undefined ||
				!app.map._clip.filterExecCopyPaste(uno)
			) {
				app.map.sendUnoCommand(uno);
				// For spelling context menu we need to remove selection
				if (this._spellingContextMenu) app.map._docLayer._clearSelections();
				// Give the stolen focus back to map
				app.map.focus();
			}

			this._map?.focus();
			return false;
		};

		JSDialog.OpenDropdown(
			this._menuID,
			menuPosEl,
			entries,
			callback,
			'',
			false,
			true /* earlyCallbackCall? */,
			// When opened from the keyboard, select and focus the first entry
			// so the arrow keys work at once. A right-click opens with no entry
			// preselected.
			!keyboardInvoked /* noDefaultSelection? */,
		);
	}

	private _getMenuEntries(
		contextMenu: Record<string, CtxtValueType>,
	): MenuDefinition[] {
		const entries: MenuDefinition[] = [];
		for (const [command, value] of Object.entries(contextMenu)) {
			if (typeof value === 'string') {
				entries.push({
					id: command,
					type: 'separator',
				});
				continue;
			}

			if (!value.items) {
				// Shortcut is set only on leaf entries. Submenu entries use the
				// .ui-has-menu fixed-column grid with a chevron in the trailing
				// column, leaving no room for a shortcut span.
				entries.push({
					id: command,
					uno: command,
					type: 'comboboxentry',
					text: value.name,
					img: command,
					class: this._commandClass(command),
					shortcut: JSDialog.ShortcutsUtil.getShortcutText(command),
				});
				continue;
			}

			const items = this._getMenuEntries(value.items);
			entries.push({
				id: command,
				uno: command,
				type: 'comboboxentry',
				text: value.name,
				items: items,
				img: command,
				class: this._commandClass(value.command || command),
			});
		}

		return entries;
	}

	private _commandClass(command: string): string {
		// allow only latin characters and numbers in a class name we generate
		return command.replace(/[^a-zA-Z0-9]/g, '');
	}

	private _amendContextMenuData(obj: any): void {
		// The in-canvas "Ask AI" context-menu entry is RETRACTED for
		// now (per design review, 2026-08-30): its current behavior — a toast plus
		// a scope preamble dropped into the chat input — is not worth the
		// menu slot. The host flow (Vulcan_AIAction/ask_ai in
		// VulcanOfficeEditor → handleEditorAIAction) stays for a better
		// entry point later.

		// Add a 'delete' entry  for graphic selection on desktop and mobile device (in browser or app).
		if (GraphicSelection.hasActiveSelection()) {
			const menu: MenuEntry[] = obj.menu;
			let insertIndex = -1;
			menu.forEach(function (item: MenuEntry, index: number) {
				if (item.command === '.uno:Paste') {
					insertIndex = index + 1;
				}
			});

			if (insertIndex != -1) {
				menu.splice(insertIndex, 0, {
					text: _('Delete'),
					type: 'command',
					command: '.uno:Delete',
					enabled: 'true',
				});
			}

			Util.ensureValue(this._map);
			// Add "Save Image to Server" after SaveGraphic when WOPI supports save-as
			if (!this._map['wopi'].UserCanNotWriteRelative) {
				let saveGraphicIndex = -1;
				menu.forEach((item: MenuEntry, index: number) => {
					if (item.command === '.uno:SaveGraphic') {
						saveGraphicIndex = index + 1;
					}
				});

				if (saveGraphicIndex != -1) {
					menu.splice(saveGraphicIndex, 0, {
						text: _('Save Image to Server'),
						type: 'command',
						command: 'saveimagetowopi',
						enabled: 'true',
					});
				}
			}
		}
	}

	// Small-screen-only allowlist additions (JSDialog.MenuCommands
	// .smallScreenAllowlist). Returning false on a desktop or a tablet is what
	// keeps those menus byte-identical to before.
	private _isSmallScreenAllowed(docType: string, commandName: string): boolean {
		if (!window.mode.isSmallScreenDevice()) return false;
		const extra = this.options.smallScreenAllowlist;
		if (!extra) return false;
		const commands = extra[docType];
		return !!commands && commands.indexOf(commandName) !== -1;
	}

	/*
		Phone: give the comment entries of the canvas context menu the same
		client-side handlers the desktop menu already has, and route the two
		Calc note commands that core cannot usefully serve a tiled phone client.

		The desktop menu does this in _addMenu's dropdown callback, which
		intercepts '.uno:InsertAnnotation' and calls map.insertComment()
		instead of sending the command. The phone branch has no equivalent
		hook: JSDialogBuilder's mobile-wizard menu entry ends in
		`builder.map.sendUnoCommand(data.command)`. So "Insert Comment" tapped
		from a phone context menu asked CORE to insert an annotation, skipping
		the client composer that every other insertion path in the tree goes
		through (docdispatcher, Control.MobileSelectionBar, VulcanCalcBridge).
		A `callback` on the entry is the documented way to override that.

		The two Calc redirections:
		  - EditAnnotation raw runs ScViewFunc::EditNote, i.e. shows the note's
		    SdrObject caption and starts an in-place edit inside it. That is a
		    desktop interaction; on a phone it produces an editable object the
		    touch stack cannot drive. modify() is the phone editor the comment
		    wizard already uses for exactly this.
		  - ShowNote raw pins the caption on the sheet at its authored size,
		    which on a 393 px viewport is a box the reader still cannot read.
		    "Show" on a phone means the comment sheet.
		HideNote is left alone: it un-pins a caption that a desktop or tablet
		collaborator pinned, and that is the same act on any device.

		Every redirection falls back to sending the command when the comment
		cannot be resolved, so a miss degrades to today's behaviour instead of
		to nothing happening.
	*/
	private _attachPhoneCommentCallbacks(
		contextMenu: Record<string, CtxtValueType>,
	): void {
		const attach = (key: string, fn: () => void): void => {
			const entry = contextMenu[key];
			if (entry && typeof entry !== 'string') entry.callback = fn;
		};

		const listSection = (): any =>
			app.sectionContainer.getSectionWithName(app.CSections.CommentList.name);

		attach('.uno:InsertAnnotation', () => {
			app.map.insertComment();
		});

		Util.ensureValue(this._map);
		if (this._map.getDocType() !== 'spreadsheet') return;

		attach('.uno:EditAnnotation', () => {
			const section = listSection();
			const comment = section ? section.getCalcCommentAtCursor() : null;
			// CommentListSection.modify() opens nothing for a comment the
			// current view did not author (`if (!annotation.isAuthor()) return`),
			// while cellsh.cxx enables SID_EDIT_POSTIT for any editable cell
			// carrying a note. Without the isAuthor() test here, tapping Edit
			// Comment on a colleague's note would be a silent no-op. Fall back
			// to the read route, which is the most the viewer can do with it.
			if (comment && comment.isAuthor()) section.modify(comment);
			else if (!comment || !section.openCommentOnPhone(comment))
				app.map.sendUnoCommand('.uno:EditAnnotation');
		});

		attach('.uno:ShowNote', () => {
			const section = listSection();
			const comment = section ? section.getCalcCommentAtCursor() : null;
			if (!comment || !section.openCommentOnPhone(comment))
				app.map.sendUnoCommand('.uno:ShowNote');
		});
	}

	private _createContextMenuStructure(obj: any): Record<string, CtxtValueType> {
		Util.ensureValue(this._map);
		const docType: string = this._map.getDocType();
		const contextMenu: Record<string, any> = {};
		let sepIdx = 1;
		let itemName: string;
		let subMenuIdx = 1;
		let isLastItemText = false;
		const menu: MenuEntry[] = obj.menu;
		for (const idx in menu) {
			const item = menu[idx];
			if (item.enabled === 'false') {
				continue;
			}

			// If the command was hidden with the Hide_Command postmessage...
			if (this._map.uiManager.hiddenCommands[item.command]) {
				continue;
			}

			// reduce Paste Special submenu
			if (
				item.type === 'menu' &&
				item.text &&
				item.text.replace('~', '') === 'Paste Special' &&
				item.menu &&
				item.menu.length
			) {
				item.text = _('Paste Special');
				item.command = '.uno:PasteSpecial';
				item.type = item.menu[0].type;
				item.menu = undefined;
			}

			if (
				item.type === 'command' &&
				item.text &&
				item.text.replace('~', '') === 'Copy Cells'
			) {
				item.text = _('Copy Cells');
				item.command = '.uno:AutoFill?Copy:bool=true';
			}

			if (
				item.type === 'command' &&
				item.text &&
				item.text.replace('~', '') === 'Fill Series'
			) {
				item.text = _('Fill Series');
				item.command = '.uno:AutoFill?Copy:bool=false';
			}

			if (item.type === 'separator') {
				if (isLastItemText) {
					contextMenu['sep' + sepIdx++] = '';
				}
				isLastItemText = false;
			} else if (item.type === 'command') {
				// Custom commands (not .uno:) injected by _amendContextMenuData
				if (item.command && !item.command.startsWith('.uno:')) {
					Util.ensureValue(item.text);
					itemName = item.text;
					contextMenu[item.command] = {
						name: _(itemName),
						isHtmlName: false,
					};
					isLastItemText = true;
					continue;
				}

				// Only show allowlisted items
				// Command name (excluding '.uno:') starts from index = 5
				let commandName = item.command.substring(5);

				// Command might have paramateres (e.g. .uno:SpellCheckIgnore?Type:string=Grammar)
				let hasParam = false;
				if (commandName.indexOf('?') !== -1) {
					commandName = commandName.substring(0, commandName.indexOf('?'));
					hasParam = true;
				}

				// We use a special character dialog in spelling context menu with a parameter
				if (commandName === 'FontDialog' && !hasParam) continue;

				Util.ensureValue(this.options.allowlist);
				Util.ensureValue(this.options.mobileDenylist);
				if (
					commandName !== 'None' &&
					!this._isSmallScreenAllowed(docType, commandName) &&
					this.options.allowlist.general.indexOf(commandName) === -1 &&
					(this._map['wopi'].HideChangeTrackingControls ||
						this.options.allowlist.tracking.indexOf(commandName) === -1) &&
					!(
						docType === 'text' &&
						this.options.allowlist.text.indexOf(commandName) !== -1
					) &&
					!(
						docType === 'spreadsheet' &&
						this.options.allowlist.spreadsheet.indexOf(commandName) !== -1
					) &&
					!(
						docType === 'presentation' &&
						this.options.allowlist.presentation.indexOf(commandName) !== -1
					) &&
					!(
						docType === 'drawing' &&
						this.options.allowlist.drawing.indexOf(commandName) !== -1
					)
				) {
					continue;
				}

				if (
					window.mode.isSmallScreenDevice() &&
					this.options.mobileDenylist.indexOf(commandName) !== -1
				)
					continue;

				if (commandName == 'None' && !item.text) continue;

				if (
					hasParam ||
					commandName === 'None' ||
					commandName === 'FontDialogForParagraph' ||
					commandName === 'Delete' ||
					commandName == 'PasteSpecial' ||
					commandName === 'UpdateCurIndex' ||
					commandName === 'RemoveTableOf' ||
					commandName === 'EditCurIndex'
				) {
					Util.ensureValue(item.text);
					// These commands have a custom item.text, don't overwrite
					// that with a label based on 'item.command'.
					itemName = window.removeAccessKey(item.text);
					itemName = itemName.replace(' ', '\u00a0');
				} else {
					// Get the translated text associated with the command
					itemName = _UNO(item.command, docType, true);
				}

				contextMenu[item.command] = {
					name: _(itemName),
					isHtmlName: true,
				};

				if (item.checktype === 'checkmark') {
					if (item.checked === 'true') {
						contextMenu[item.command]['icon'] = 'lo-checkmark';
					}
				} else if (item.checktype === 'radio') {
					if (item.checked === 'true') {
						contextMenu[item.command]['icon'] = 'radio';
					}
				}

				isLastItemText = true;
			} else if (item.type === 'menu') {
				Util.ensureValue(item.text);
				itemName = item.text;
				const submenu = this._createContextMenuStructure(item);
				// ignore submenus with all items disabled
				if (Object.keys(submenu).length === 0) {
					continue;
				}

				contextMenu['submenu' + subMenuIdx++] = {
					name: _(itemName)
						.replace(/\(~[A-Za-z]\)/, '')
						.replace('~', ''),
					command: item.command,
					items: submenu,
				};
				isLastItemText = true;
			}
		}

		// Remove separator, if present, at the end
		const lastItem =
			Object.keys(contextMenu)[Object.keys(contextMenu).length - 1];
		if (lastItem !== undefined && lastItem.startsWith('sep')) {
			delete contextMenu[lastItem];
		}

		return contextMenu;
	}
}
