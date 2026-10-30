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

describe('ShortcutsUtil', function () {

	// 'search' is a UNO_ALIAS for vnd.sun.star.findbar:FocusToFindbar,
	// resolved via the generated unoShortcutsMap (loaded by sources.ts
	// from browser/src/unoshortcuts.js) — Ctrl+F by default.

	describe('getTooltipLabel()', function () {

		it('appends the shortcut in parentheses', function () {
			nodeassert.strictEqual(
				JSDialog.ShortcutsUtil.getTooltipLabel('Find', 'search'),
				'Find (Ctrl+F)');
		});

		it('strips the mnemonic tilde from the label', function () {
			nodeassert.strictEqual(
				JSDialog.ShortcutsUtil.getTooltipLabel('~Find', 'search'),
				'Find (Ctrl+F)');
		});

		it('returns the text unchanged for unknown commands', function () {
			nodeassert.strictEqual(
				JSDialog.ShortcutsUtil.getTooltipLabel('Find', '.uno:NoSuch'),
				'Find');
		});
	});

	describe('impress arrangement hotkey registrations', function () {
		it('registers the browser-bound alignment shortcuts', function () {
			const util = JSDialog.ShortcutsUtil;
			const expected: Record<string, string> = {
				'.uno:ObjectAlignLeft': 'Ctrl+Shift+←',
				'.uno:ObjectAlignRight': 'Ctrl+Shift+→',
				'.uno:AlignUp': 'Ctrl+Shift+↑',
				'.uno:AlignDown': 'Ctrl+Shift+↓',
				'.uno:AlignCenter': 'Ctrl+Shift+H',
				'.uno:AlignMiddle': 'Ctrl+Shift+M',
				'.uno:DistributeHorzDistance': 'Ctrl+Alt+Shift+H',
				'.uno:DistributeVertDistance': 'Ctrl+Alt+Shift+M',
				'.uno:FitFrameToText': 'Ctrl+Shift+F',
				'.uno:FormatGroup': 'Ctrl+G',
				'.uno:FormatUngroup': 'Ctrl+Shift+G',
				'.uno:ObjectForwardOne': 'Ctrl+]',
				'.uno:ObjectBackOne': 'Ctrl+[',
				'.uno:BringToFront': 'Ctrl+Shift+]',
				'.uno:SendToBack': 'Ctrl+Shift+[',
			};
			// The guard used to assert only hasShortcut() and let a wrong
			// label or binding sail through (adversarial review). Assert
			// the LABELS, and that the Impress-only set resolves ONLY in
			// presentations - registered doc-type-blind these overwrote
			// real XCU labels in Writer and Calc menus.
			const priorMap = (globalThis as any).app?.map;
			try {
				(globalThis as any).app.map = {
					getDocType: () => 'presentation',
				};
				for (const command of Object.keys(expected)) {
					nodeassert.strictEqual(util.hasShortcut(command), true);
					nodeassert.strictEqual(
						util.getShortcutText(command),
						expected[command],
						command,
					);
				}
				(globalThis as any).app.map = {
					getDocType: () => 'text',
				};
				// In Writer, the Impress arrange bindings must NOT answer
				// (the stock XCU value, or nothing, takes over).
				nodeassert.notStrictEqual(
					util.getShortcutText('.uno:AlignCenter'),
					expected['.uno:AlignCenter'],
				);
				nodeassert.notStrictEqual(
					util.getShortcutText('.uno:BringToFront'),
					expected['.uno:BringToFront'],
				);
			} finally {
				(globalThis as any).app.map = priorMap;
			}
		});
	});

	describe('getMenuLabel()', function () {

		it('wraps the shortcut in span.shortcut for right-aligned rendering', function () {
			nodeassert.strictEqual(
				JSDialog.ShortcutsUtil.getMenuLabel('Find', 'search'),
				'Find <span class="shortcut">Ctrl+F</span>');
		});

		it('strips the mnemonic tilde from the label', function () {
			nodeassert.strictEqual(
				JSDialog.ShortcutsUtil.getMenuLabel('~Find', 'search'),
				'Find <span class="shortcut">Ctrl+F</span>');
		});

		it('returns the text unchanged for unknown commands', function () {
			nodeassert.strictEqual(
				JSDialog.ShortcutsUtil.getMenuLabel('Find', '.uno:NoSuch'),
				'Find');
		});
	});
});

// Its own top-level describe: 'ShortcutsUtil' is on the CI skip list, and a
// guard parked inside a tolerated suite can never gate.
describe('KeyboardShortcuts save table', function () {

	// LEGE-A1: unclaimed, physical Ctrl+S on a Mac fell through to core's
	// callback-less kit-save — ModifiedStatus{false} showed a "Saved" pill
	// with no PutFile while storage stayed stale.

	let savedBrowserMac: boolean;
	let savedDispatcher: any;
	let savedMap: any;
	let savedMode: any;
	let dispatched: Array<{ action: string; data: any }>;

	beforeEach(function () {
		const w = window as any;
		savedBrowserMac = w.L.Browser.mac;
		savedDispatcher = (app as any).dispatcher;
		savedMap = w.KeyboardShortcuts.map;
		savedMode = w.mode;
		dispatched = [];
		w.L.Browser.mac = true;
		(app as any).dispatcher = {
			dispatch: (action: string, data: any) => {
				dispatched.push({ action: action, data: data });
			},
		};
		w.KeyboardShortcuts.map = {
			_docLayer: { _docType: 'text' },
			isEditMode: () => true,
		};
		if (!w.mode)
			w.mode = { isChromebook: () => false };
	});

	afterEach(function () {
		const w = window as any;
		w.L.Browser.mac = savedBrowserMac;
		(app as any).dispatcher = savedDispatcher;
		w.KeyboardShortcuts.map = savedMap;
		w.mode = savedMode;
	});

	function keydown(init: any): KeyboardEvent {
		return new (window as any).KeyboardEvent('keydown', init);
	}

	it('physical Ctrl+S on a Mac dispatches the UI save path', function () {
		const handled = (window as any).KeyboardShortcuts.processEvent(
			'default', keydown({ ctrlKey: true, key: 's' }));
		nodeassert.strictEqual(handled, true,
			'physical Ctrl+S fell through the table on mac — core will kit-save with no PutFile');
		nodeassert.deepStrictEqual(dispatched,
			[{ action: 'save', data: 'keyboard' }]);
	});

	it('Cmd+S on a Mac still dispatches the same save', function () {
		const handled = (window as any).KeyboardShortcuts.processEvent(
			'default', keydown({ metaKey: true, key: 's' }));
		nodeassert.strictEqual(handled, true);
		nodeassert.deepStrictEqual(dispatched,
			[{ action: 'save', data: 'keyboard' }]);
	});
});
