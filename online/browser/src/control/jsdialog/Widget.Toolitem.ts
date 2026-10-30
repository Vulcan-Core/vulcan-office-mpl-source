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
 * JSDialog.Toolitem - collection of items which can be inserted into toolbox in core
 *                     or used as standalone buttons in JSDialogs. They fire command
 *                     on user interaction (uno command, or dispatch command) and get
 *                     state from the state change multiplexer so we can show selected
 *                     or disabled state.
 */

declare var JSDialog: any;

function _mapDispatchToolItem(
	parentContainer: HTMLElement,
	data: ToolItemWidgetJSON,
	builder: JSBuilder,
) {
	if (!data.command) data.command = data.id;

	if (data.id && data.id !== 'exportas' && data.id.startsWith('export')) {
		const format = data.id.substring('export'.length);
		app.registerExportFormat(data.text, format);

		if (builder.map['wopi'].HideExportOption) return false;
	}

	const backupInlineText = builder.options.useInLineLabelsForUnoButtons;
	if (data.inlineLabel !== undefined)
		builder.options.useInLineLabelsForUnoButtons = data.inlineLabel;

	const control = builder._unoToolButton(parentContainer, data, builder);

	if (data.inlineLabel !== undefined)
		builder.options.useInLineLabelsForUnoButtons = backupInlineText;

	$(control.button).unbind('click');
	$(control.label).unbind('click');

	if (!builder.map.isLockedItem(data)) {
		/*
		 * VULCAN: PRESS-AND-HOLD WAS DECLARED FOR MOBILE AND BOUND FOR MOUSE.
		 *
		 * `pressAndHold` is typed `// for mobile` (Definitions.Types.ts) and
		 * every consumer is a phone control -- the find bar's prev/next arrows
		 * (Control.MobileSearchBar.ts), the sheet-tab arrows
		 * (Control.SheetsBar.js). The stock implementation started a 500 ms
		 * timer on `mousedown` and cancelled it on `mouseup`.
		 *
		 * A touch device never delivers `mousedown` while the finger is DOWN.
		 * The compatibility mouse burst -- mousemove, mousedown, mouseup,
		 * click -- is synthesised AFTER `touchend`, back to back. So on the
		 * only platform this feature exists for, the hold timer started after
		 * the release and was cleared by the `mouseup` a few milliseconds
		 * later. The repeat could not fire once, on any build, ever. It is
		 * present in every bundle and has never run on a phone.
		 *
		 * The press is now tracked on whichever pointer family actually
		 * started it, and the two are kept APART rather than merged: the
		 * synthesised burst following a real touch would otherwise open a
		 * SECOND hold just as the first one ended. A touch stamps
		 * `nLastTouchAt` and the mouse path stands down for 700 ms after it --
		 * the usual ghost-click window.
		 *
		 * A repeat that fired also swallows the trailing `click`. Without
		 * that, a three-second hold on `searchnext` advances N times and then
		 * once more on release, which reads as an off-by-one in the find
		 * ordinal rather than as a stuck button, and is the harder of the two
		 * to recognise. The flag is cleared when the next press STARTS, not
		 * when the click consumes it, because a long press does not always
		 * produce a click (a browser that opens its own long-press menu
		 * suppresses it) and a flag cleared only on consumption would then eat
		 * the next genuine tap.
		 *
		 * NOT VERIFIED ON A DEVICE. This is static reasoning about synthesised
		 * event ordering plus the reachability chain
		 * (`customtoolitem` -> `_controlHandlers` -> `JSDialog.dispatchToolitem`,
		 * Control.JSDialogBuilder.js:156). The reading that settles it: hold
		 * find-next on a phone for ~2 s on a document with many matches and
		 * watch the ordinal in the search bar; it must climb roughly every
		 * 100 ms and must NOT take one extra step on release.
		 */
		let bPressAndHoldFired = false;
		let nLastTouchAt = 0;
		let nHoldTimer: ReturnType<typeof setTimeout> | null = null;
		let nRepeatTimer: ReturnType<typeof setInterval> | null = null;
		let nPressX = 0;
		let nPressY = 0;

		const endPress = () => {
			if (nHoldTimer !== null) {
				clearTimeout(nHoldTimer);
				nHoldTimer = null;
			}
			if (nRepeatTimer !== null) {
				clearInterval(nRepeatTimer);
				nRepeatTimer = null;
			}
		};

		const beginPress = () => {
			bPressAndHoldFired = false;
			endPress();
			if (control.container.getAttribute('disabled') !== null) return;

			nHoldTimer = setTimeout(() => {
				nHoldTimer = null;
				// The hold IS the first repeat. The plain click is suppressed
				// below once this has fired, so without dispatching here a
				// 500 ms press would do strictly less than a tap.
				bPressAndHoldFired = true;
				app.dispatcher.dispatch(data.command);
				nRepeatTimer = setInterval(() => {
					// An arrow that greys out mid-hold (last match reached)
					// must stop, not keep firing into a disabled control.
					if (control.container.getAttribute('disabled') !== null) {
						endPress();
						return;
					}
					app.dispatcher.dispatch(data.command);
				}, 100);
			}, 500);
		};

		// Handle "Press+Hold" Event
		if (data.pressAndHold) {
			control.container.addEventListener(
				'touchstart',
				(e: TouchEvent) => {
					nLastTouchAt = Date.now();
					const touch = e.touches[0];
					nPressX = touch ? touch.clientX : 0;
					nPressY = touch ? touch.clientY : 0;
					beginPress();
				},
				{ passive: true },
			);
			// A finger that has left the arrow is not still pressing it. The
			// threshold is there because a finger held still on glass still
			// emits touchmove -- cancelling on any movement at all would
			// reintroduce the dead feature by a different route.
			control.container.addEventListener(
				'touchmove',
				(e: TouchEvent) => {
					const touch = e.touches[0];
					if (!touch) return;
					if (
						Math.abs(touch.clientX - nPressX) > 10 ||
						Math.abs(touch.clientY - nPressY) > 10
					)
						endPress();
				},
				{ passive: true },
			);
			control.container.addEventListener('touchend', () => {
				nLastTouchAt = Date.now();
				endPress();
			});
			control.container.addEventListener('touchcancel', endPress);

			$(control.container).on('mousedown', (e) => {
				if (
					e.button !== 0 || // Only handle left mouse button
					Date.now() - nLastTouchAt < 700 // synthesised after a touch
				)
					return;

				beginPress();
				$(document).one('mouseup', endPress);
			});
		}

		$(control.container).click(() => {
			if (bPressAndHoldFired) return;
			if (control.container.getAttribute('disabled') === null)
				app.dispatcher.dispatch(data.command);
		});
	}

	builder._preventDocumentLosingFocusOnClick(control.container);
}

function _mapBigDispatchToolItem(
	parentContainer: HTMLElement,
	data: ToolItemWidgetJSON,
	builder: JSBuilder,
) {
	if (!data.command) data.command = data.id;

	const noLabels = builder.options.noLabelsForUnoButtons;
	builder.options.noLabelsForUnoButtons = false;

	const control = builder._unoToolButton(parentContainer, data, builder);

	builder.options.noLabelsForUnoButtons = noLabels;

	$(control.button).unbind('click');
	$(control.label).unbind('click');

	if (!builder.map.isLockedItem(data)) {
		$(control.container).click((e: any) => {
			e.preventDefault();
			app.dispatcher.dispatch(data.command);
		});
	}

	builder._preventDocumentLosingFocusOnClick(control.container);
}

JSDialog.dispatchToolitem = function (
	parentContainer: HTMLElement,
	data: ToolItemWidgetJSON,
	builder: JSBuilder,
) {
	return _mapDispatchToolItem(parentContainer, data, builder);
};

JSDialog.bigDispatchToolitem = function (
	parentContainer: HTMLElement,
	data: ToolItemWidgetJSON,
	builder: JSBuilder,
) {
	return _mapBigDispatchToolItem(parentContainer, data, builder);
};
