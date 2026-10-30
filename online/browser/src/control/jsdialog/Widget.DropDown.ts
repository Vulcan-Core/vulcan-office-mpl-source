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
 * JSDialog.DropDown - build dropdown container with dynamic list
 */

declare var JSDialog: any;

function setupHeaderDropdownNavigation(
	parentContainer: HTMLElement,
	headerId: string,
) {
	const header = parentContainer.querySelector('#' + headerId) as HTMLElement;
	const headerControl = header
		? (JSDialog.FindFocusableWithin(header, 'next') as HTMLElement)
		: null;
	const listbox = parentContainer.querySelector(
		'[role="listbox"]',
	) as HTMLElement;
	if (!headerControl || !listbox) return;

	const getOptions = () =>
		Array.from(
			listbox.querySelectorAll(
				'[role="option"]:not([disabled]):not(.hidden)',
			),
		) as HTMLElement[];
	const initialOptions = getOptions();
	initialOptions.forEach((option) => option.setAttribute('tabindex', '-1'));
	if (initialOptions[0]) initialOptions[0].setAttribute('tabindex', '0');

	const setActiveOption = (activeOption: HTMLElement | null) => {
		const options = getOptions();
		options.forEach((option) => {
			const active = option === activeOption;
			option.classList.toggle('selected', active);
			option.setAttribute('aria-selected', active ? 'true' : 'false');
			option.setAttribute('tabindex', active ? '0' : '-1');
		});
		if (activeOption) {
			listbox.setAttribute('aria-activedescendant', activeOption.id);
		} else {
			listbox.removeAttribute('aria-activedescendant');
			if (options[0]) options[0].setAttribute('tabindex', '0');
		}
	};

	headerControl.addEventListener('focus', () => setActiveOption(null));
	initialOptions.forEach((option) =>
		option.addEventListener('focus', () => setActiveOption(option)),
	);

	// Keep the popup at two Tab stops: Close and one active listbox option.
	// Combobox entries normally close on forward Tab, so only capture the
	// header-to-list and reverse list-to-header boundaries. Arrows cycle every
	// option without promoting all of them into the document's Tab order.
	parentContainer.addEventListener(
		'keydown',
		(event: KeyboardEvent) => {
			const activeElement = document.activeElement as HTMLElement;
			const options = getOptions();
			const optionIndex = options.indexOf(activeElement);
			if (activeElement !== headerControl && optionIndex < 0) return;
			const currentIndex = activeElement === headerControl ? 0 : optionIndex + 1;

			const cycle = [headerControl].concat(options);
			let target: HTMLElement;
			if (
				event.key === 'Tab' &&
				!event.shiftKey &&
				activeElement === headerControl
			) {
				target = options[0];
			} else if (event.key === 'Tab' && event.shiftKey && optionIndex >= 0) {
				target = headerControl;
			} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				const direction = event.key === 'ArrowDown' ? 1 : -1;
				const targetIndex =
					(currentIndex + direction + cycle.length) % cycle.length;
				target = cycle[targetIndex];
			} else {
				return;
			}
			if (!target) return;
			setActiveOption(target === headerControl ? null : target);
			target.focus();
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
		},
		true,
	);
}

JSDialog.Dropdown = function (
	parentContainer: HTMLElement,
	data: any,
	builder: JSBuilder,
) {
	builder.build(parentContainer, data.children, data.vertical === true);

	if (data.gridKeyboardNavigation) {
		JSDialog.KeyboardGridNavigation(parentContainer);
	} else if (data.dropdownHeaderId) {
		setupHeaderDropdownNavigation(parentContainer, data.dropdownHeaderId);
	} else {
		JSDialog.KeyboardListNavigation(parentContainer);
	}
	return false;
};
