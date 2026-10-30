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
 * Util.SnackbarController - helper for managing the snackbars queue
 */

declare var JSDialog: any;

type SnackbarData = {
	label: string;
	action: string | undefined;
	callback: () => void | undefined;
	timeout: number;
	hasProgress: boolean | undefined;
	withDismiss: boolean | undefined;
	infinite: boolean | undefined;
	// A snackbar that stays until dismissed by this key (showSticky).
	key?: string;
	// Shown again after it gave its place to a sticky one (showSticky): it
	// took focus when it first showed, and does not take it again.
	focusHandled?: boolean;
};

class SnackbarController {
	snackbarTimeout: number = 10000;
	snackbarQueue: Array<SnackbarData>;
	showingSnackbar: boolean = false;
	// The snackbar on screen.
	current: SnackbarData | null = null;
	// A close sent, the next snackbar not yet scheduled.
	closing: boolean = false;

	constructor() {
		this.snackbarQueue = new Array<SnackbarData>();
	}

	// focusHandled: the close leaves focus where it is, where by default
	// JSDialog moves it back to what had it when the snackbar opened.
	public closeSnackbar(focusHandled?: boolean) {
		var closeMessage = {
			id: 'snackbar',
			jsontype: 'dialog',
			type: 'snackbar',
			action: 'close',
			focusHandled: focusHandled,
		};
		app.socket._onMessage({
			textMsg: 'jsdialog: ' + JSON.stringify(closeMessage),
		});

		this.current = null;
		if (this.closing) return;
		this.closing = true;
		// JSDialog deletes the closed snackbar's entry in a layouting task. A
		// snackbar shown before that task runs is built over the entry and
		// deleted with it, so it never appears; the next one waits for it.
		app.layoutingService.appendLayoutingTask(() => {
			this.closing = false;
			this.showingSnackbar = false;
			this.scheduleSnackbar();
		});
	}

	// A snackbar with no timeout that shows `label` until dismiss(key). Showing
	// a key already on screen or queued does nothing, so it stays up, without
	// blinking, for as long as its owner keeps asking for it.
	public showSticky(key: string, label: string) {
		if (!app.socket) return;
		// JSDialog.closeAll closes the snackbar without telling this controller
		// when the view is inactive (an error dialog's closeAll during an
		// outage). One that is gone is not on screen.
		const jsdialog = app.map && app.map.jsdialog;
		if (
			this.showingSnackbar &&
			!this.closing &&
			jsdialog &&
			!jsdialog.hasSnackbarOpened()
		) {
			this.showingSnackbar = false;
			this.current = null;
		}
		if (
			(this.current && this.current.key === key) ||
			this.snackbarQueue.some((data) => data.key === key)
		)
			return;
		// First in line: a notice waiting for the slot can wait for this.
		this.snackbarQueue.unshift({
			label: label,
			action: undefined,
			callback: undefined,
			timeout: -1,
			hasProgress: false,
			withDismiss: false,
			infinite: false,
			key: key,
		});
		// One on screen that never times out (an action bar, a progress bar)
		// would keep it off for good: it gives up the slot and comes back
		// after this one.
		const shown = this.showingSnackbar && !this.closing ? this.current : null;
		if (shown && !shown.key && this.extractTimeout(shown) < 0) {
			shown.focusHandled = true;
			this.snackbarQueue.splice(1, 0, shown);
			this.closeSnackbar(true);
			return;
		}
		this.scheduleSnackbar();
	}

	// UIManager.closeSnackbar: the caller closes the snackbar it showed, which
	// has no key. While a keyed one holds the slot, the caller's waits in the
	// queue (showSticky), and goes from there.
	public closeUnkeyed() {
		if (this.current && this.current.key) {
			const i = this.snackbarQueue.findIndex((data) => !data.key);
			if (i >= 0) this.snackbarQueue.splice(i, 1);
			return;
		}
		this.closeSnackbar();
	}

	// Takes down showSticky(key)'s snackbar, or drops it from the queue,
	// without moving focus.
	public dismiss(key: string) {
		this.snackbarQueue = this.snackbarQueue.filter((data) => data.key !== key);
		if (this.current && this.current.key === key) this.closeSnackbar(true);
	}

	public showSnackbar(
		label: string,
		action: string | undefined,
		callback: () => void | undefined,
		timeout: number | undefined,
		hasProgress: boolean | undefined,
		withDismiss: boolean | undefined,
		infinite: boolean | undefined,
	) {
		if (!app.socket) return;

		this.snackbarQueue.push({
			label: label,
			action: action,
			callback: callback,
			timeout: timeout,
			hasProgress: hasProgress,
			withDismiss: withDismiss,
			infinite: infinite,
		});

		this.scheduleSnackbar();
	}

	private extractTimeout(snackbarData: SnackbarData): number {
		return snackbarData.timeout || this.snackbarTimeout;
	}

	private scheduleSnackbar() {
		if (this.showingSnackbar || !this.snackbarQueue.length) return;

		const snackbarData = this.snackbarQueue.shift();
		this.current = snackbarData;
		this.showSnackbarImpl(snackbarData);
		this.showingSnackbar = true;
	}

	private showSnackbarImpl(snackbarData: SnackbarData) {
		var buttonId = 'button';
		var labelId = 'label';

		var json = {
			id: 'snackbar',
			jsontype: 'dialog',
			type: 'snackbar',
			timeout: this.extractTimeout(snackbarData),
			init_focus_id: snackbarData.action ? buttonId : undefined,
			focusHandled: snackbarData.focusHandled,
			children: [
				{
					id: snackbarData.hasProgress
						? 'snackbar-container-progress'
						: 'snackbar-container',
					type: 'container',
					children: [
						snackbarData.action
							? {
									id: labelId,
									type: 'fixedtext',
									text: snackbarData.label,
									labelFor: buttonId,
								}
							: {
									id: 'label-no-action',
									type: 'fixedtext',
									text: snackbarData.label,
								},
						snackbarData.withDismiss
							? {
									id: 'snackbar-dismiss-button',
									type: 'pushbutton',
									text: _('Dismiss'),
								}
							: {},
						snackbarData.hasProgress
							? {
									id: 'progress',
									type: 'progressbar',
									value: 0,
									maxValue: 100,
									infinite: snackbarData.infinite,
								}
							: {},
						snackbarData.action
							? {
									id: buttonId,
									type: 'pushbutton',
									text: snackbarData.action,
									labelledBy: labelId,
								}
							: {},
					],
				},
			],
		};

		var builderCallback: JSDialogCallback = (
			objectType: string,
			eventType: string,
			object: any,
			data: any,
			builder: JSBuilder,
		) => {
			window.app.console.debug(
				"control: '" +
					objectType +
					"' id:'" +
					object.id +
					"' event: '" +
					eventType +
					"' state: '" +
					data +
					"'",
			);

			if (
				object.id === buttonId &&
				objectType === 'pushbutton' &&
				eventType === 'click'
			) {
				if (typeof snackbarData.callback === 'function')
					snackbarData.callback();

				this.closeSnackbar();
			} else if (
				object.id === '__POPOVER__' &&
				objectType === 'popover' &&
				eventType === 'close'
			) {
				this.closeSnackbar();
			}

			if (
				object.id === 'snackbar-dismiss-button' &&
				objectType === 'pushbutton' &&
				eventType === 'click'
			) {
				this.closeSnackbar();
			}
		};

		app.socket._onMessage({
			textMsg: 'jsdialog: ' + JSON.stringify(json),
			callback: builderCallback,
		});
	}

	// value should be in range 0-100
	public setSnackbarProgress(value: number, infinite: boolean) {
		if (!app.socket) return;

		var json = {
			id: 'snackbar',
			jsontype: 'dialog',
			type: 'snackbar',
			action: 'update',
			control: {
				id: 'progress',
				type: 'progressbar',
				value: value,
				maxValue: 100,
				infinite: infinite,
			},
		};

		app.socket._onMessage({ textMsg: 'jsdialog: ' + JSON.stringify(json) });
	}
}

JSDialog.SnackbarController = new SnackbarController();
