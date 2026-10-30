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
 * Util.MessageRouter - helper for routing JSDialog messages to correct components
 */

declare var JSDialog: any;

class JSDialogMessageRouter {
	// Per-jsontype queues for messages with target component not yet ready
	private pendingByJsontype: Map<string, Array<() => void>> = new Map();

	// show labels instead of editable fields in message boxes
	private _preProcessMessageDialog(msgData: WidgetJSON) {
		if (!msgData.children) return;

		for (var i in msgData.children) {
			var child = msgData.children[i];
			if (child.type === 'multilineedit') child.type = 'fixedtext';
			else if (child.children) this._preProcessMessageDialog(child);
		}
	}

	private isReady(jsontype: string): boolean {
		if (jsontype === 'notebookbar')
			return !!(
				app.socket._map.uiManager && app.socket._map.uiManager.notebookbar
			);
		if (jsontype === 'addressinputfield')
			return !!app.socket._map.addressInputField;
		if (jsontype === 'formulabar') return !!app.socket._map.formulabar;
		return true;
	}

	public flushPending(jsontype: string): void {
		const queue = this.pendingByJsontype.get(jsontype);
		if (!queue) return;
		this.pendingByJsontype.delete(jsontype);
		for (const fire of queue) fire();
	}

	public processMessage(msgData: JSDialogJSON, callbackFn: JSDialogCallback) {
		// update existing component
		if (msgData.action) {
			var fireJSDialogEvent = function () {
				switch (msgData.action) {
					case 'update':
						app.socket._map.fire('jsdialogupdate', { data: msgData });
						return true;

					case 'action':
						app.socket._map.fire('jsdialogaction', { data: msgData });
						return true;
				}

				return false;
			};

			const jsontype = msgData.jsontype;
			const queue = this.pendingByJsontype.get(jsontype);
			if (queue || !this.isReady(jsontype)) {
				// target is not initialized yet or earlier messages
				// of the same jsontype are still queued.
				const q = queue || [];
				q.push(fireJSDialogEvent);
				if (!queue) this.pendingByJsontype.set(jsontype, q);
				return;
			} else if (fireJSDialogEvent() === true) {
				return;
			}
		}

		if (msgData.type === 'messagebox') this._preProcessMessageDialog(msgData);

		// appears in autofilter dropdown for hidden popups, we can ignore that
		if (msgData.jsontype === 'popup') return;

		// re/create component
		if (window.mode.isSmallScreenDevice()) {
			// allow to use desktop's JSDialog component to show dropdowns
			if (
				msgData.type === 'dropdown' ||
				msgData.type === 'snackbar' ||
				(msgData.type === 'modalpopup' &&
					msgData.id === JSDialog.generateModalId(app.idleHandlerId))
			) {
				app.socket._map.fire('jsdialog', {
					data: msgData,
					callback: callbackFn,
				});
				return;
			}

			// use mobile wizard
			if (msgData.type == 'borderwindow') return;
			if (msgData.jsontype === 'formulabar') {
				app.socket._map.fire('formulabar', { data: msgData });
				return;
			}
			// Same early-out as formulabar above, for the same reason: this
			// payload has a component of its own and must not be posted into
			// the wizard as a generic dialog. On a phone the navigator is a
			// whole panel -- search field, three tabs, two toolbars, fifteen
			// content categories -- so falling through would drop a desktop
			// dialog into a 390px bottom sheet. The phone consumer is
			// VulcanDocumentOutline, which reads the headings out of this and
			// renders its own sheet (writer-no-document-outline).
			//
			// This is also a live defect fix independent of that sheet: F5 is
			// bound to .uno:Navigator for text documents
			// (Map.KeyboardShortcuts.ts:411), so a phone with a hardware
			// keyboard could already reach the fall-through today.
			if (msgData.jsontype === 'navigator') {
				app.socket._map.fire('navigator', { data: msgData });
				return;
			}
			// Map.hideBusy fades the busy popup out on every socket close,
			// open or not. The wizard builds a window for an id it does not hold,
			// only to remove it again: that hid the member's open sheet and,
			// with none open, focused the map, once per close of an outage.
			if (
				msgData.id === 'busypopup' &&
				(msgData.action === 'fadeout' || msgData.action === 'close')
			) {
				const wizard = app.socket._map.uiManager
					? app.socket._map.uiManager.mobileWizard
					: null;
				if (wizard && !wizard._getContentForWindowId(msgData.id)) return;
			}
			if (
				msgData.enabled ||
				msgData.jsontype === 'dialog' ||
				msgData.type === 'modalpopup'
			) {
				app.socket._map.fire('mobilewizard', {
					data: msgData,
					callback: callbackFn,
				});
			} else {
				console.warn(
					'jsdialog: unhandled jsdialog mobile message: {jsontype: "' +
						msgData.jsontype +
						'", type: "' +
						msgData.type +
						'" ... }',
				);
			}
		} else if (msgData.jsontype === 'dialog') {
			app.socket._map.fire('jsdialog', { data: msgData, callback: callbackFn });
		} else if (msgData.jsontype === 'sidebar') {
			app.socket._map.fire('sidebar', { data: msgData });
		} else if (msgData.jsontype === 'navigator') {
			app.socket._map.fire('navigator', { data: msgData });
		} else if (msgData.jsontype === 'formulabar') {
			app.socket._map.fire('formulabar', { data: msgData });
		} else if (msgData.jsontype === 'notebookbar') {
			if (msgData.children) {
				for (var i = 0; i < msgData.children.length; i++) {
					if (msgData.children[i].type === 'control') {
						msgData.children[i].id = msgData.id;
						app.socket._map.fire('notebookbar', msgData.children[i]);
						return;
					}
				}
			}
		} else if (msgData.jsontype === 'quickfind') {
			app.socket._map.fire('quickfind', { data: msgData });
		} else {
			console.warn(
				'Unhandled jsdialog message: {jsontype: "' +
					msgData.jsontype +
					'", type: "' +
					msgData.type +
					'" ... }',
			);
		}
	}
}

JSDialog.MessageRouter = new JSDialogMessageRouter();
