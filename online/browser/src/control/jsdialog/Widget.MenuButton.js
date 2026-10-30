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
 * JSDialog.MenuButton - button which can trigger some action or open a menu
 *
 * Example JSON:
 * {
 *     id: 'id:MenuId', (where MenuId is custom menu id, menu is stored in the builder)
 *     type: 'menubutton',
 *     text: 'Label',
 *     image: 'base64 encoded icon',
 *     command: '.uno:Command',
 *     enabled: false
 * }
 */

/* global JSDialog $ app */

function _menubuttonControl (parentContainer, data, builder) {
	var ids;
	var menuId = null;

	if (data.id.includes(':')) {
		ids = data.id.split(':');
		menuId = ids[1];
		data.id = ids[0];
	}
	else if (data.id.includes('-')) {
		ids = data.id.split('-');
		if (ids.length === 2) {
			menuId = ids[1];
			data.id = ids[0];
		} else if (!data.menu){
			console.error('Menubutton without correct menu id: ' + data.id);
		}
	}
	else
		menuId = data.id;

	// import menu
	if (data.menu) {
		// command is needed to generate image
		if (!data.command)
			data.command = data.id;

		menuId = data.id + '-menu';
		var builtMenu = [];
		for (var i in data.menu)
			builtMenu.push(data.menu[i]);
		builder._menus.set(menuId, builtMenu);
	}

	var menuEntries = menuId ? builder._menus.get(menuId) : null;

	if (menuEntries) {
		var noLabels = builder.options.noLabelsForUnoButtons;
		builder.options.noLabelsForUnoButtons = data.noLabel ? data.noLabel : false;

		// command is needed to generate image
		if (!data.command)
			data.command = menuId;

		var isSplitButton = !!data.applyCallback;
		var options = {hasDropdownArrow: menuEntries.length > 1 || isSplitButton};
		var control = builder._unoToolButton(parentContainer, data, builder, options);

		if (!window.L.DomUtil.hasClass(control.container, 'selected')) {
			control.button.removeAttribute('aria-pressed');
		}
		// can be function or string with command identifier
		const applyCallback =
			(typeof data.applyCallback === 'function') ?
				data.applyCallback
				: () => {
					if (data.applyCallback.indexOf('.uno:') === 0)
						app.map.sendUnoCommand(data.applyCallback);
					else
						app.dispatcher.dispatch(data.applyCallback);
				};

		if (menuEntries.length == 0) {
			control.container.setAttribute('disabled', true);
		}

		$(control.container).addClass('menubutton' + (isSplitButton ? ' splitbutton' : ''));

		$(control.button).unbind('click');
		$(control.label).unbind('click');

		var dropdownId = data.id;
		var vulcanPhoneMenu = data.vulcanPhoneMenu;
		var clickFunction = function () {
			if (control.container.hasAttribute('disabled'))
				return;

			/*
			 * VULCAN — A MENUBUTTON MAY DECLARE ITS OWN PHONE SURFACE.
			 *
			 * The dropdown this function otherwise opens is a DESKTOP combobox
			 * and the phone chrome has no tier for one: every
			 * `.jsdialog-window.modalpopup` / `.ui-combobox-entry` restyling
			 * rule the fork owns is scoped `html.vulcan-desktop-chrome`. So on
			 * a phone it renders exactly as upstream draws it, and that was
			 * measured on the one menubutton a finger can reach in Calc (the
			 * sheet list): 30px rows under the 44px floor, entries 15px wider
			 * than the card holding them, the active row painted in the raw
			 * per-doctype accent, and -- the reason this is a behaviour hook
			 * and not a stylesheet -- a card that lands ON TOP of the button
			 * that opened it, because Control.JSDialog.setPosition NUDGES an
			 * overflowing dropdown back inside the viewport instead of
			 * flipping it above its anchor. For a bottom-docked trigger the
			 * nudge always parks the list over the trigger, so the universal
			 * "tap it again to dismiss" gesture lands on a list row: measured
			 * selectedPart 0 -> 1, a document-state change from a dismissal,
			 * with no undo affordance.
			 *
			 * Rather than invent a phone tier for a surface class this fork
			 * does not otherwise have, an owner can hand over its own phone
			 * surface -- in practice a #mobile-wizard bottom sheet, which is
			 * what every other phone menu here already is, and which is
			 * 44px-row, fork-skinned and safe-area-aware by construction.
			 *
			 * OPT-IN, so nothing that does not ask for it changes: desktop and
			 * tablet never reach this branch (the predicate is both halves of
			 * the phone-chrome test), and a menubutton without the property
			 * opens the same dropdown it always did.
			 */
			/* Screen half FIRST, class half last: the gate registry's shape
			 * layer reads a window that ENDS at the class reference, so a
			 * screen term written below it is outside what the matcher can
			 * see and this both-halves gate would have to register as
			 * 'class-only' — a weaker claim than the one made above. Same
			 * conjunction, same value; only the order is load-bearing. */
			if (vulcanPhoneMenu &&
				window.mode && window.mode.isSmallScreenDevice() &&
				document.documentElement.classList.contains('vulcan-mobile-chrome')) {
				vulcanPhoneMenu();
				return;
			}

			var callback = function(objectType, eventType, object, data, entry /* : MenuDefinition | JSBuilder */) {
				if ((eventType === 'selected' && entry && entry.items) || eventType === 'showsubmenu') {
					return true;
				} else if (eventType === 'selected' && entry && entry.uno) {
					var uno = (entry.uno.indexOf('.uno:') === 0) ? entry.uno : '.uno:' + entry.uno;
					builder.map.sendUnoCommand(uno);
					JSDialog.CloseDropdown(dropdownId);
					return true;
				} else if (eventType === 'selected' && entry && entry.action) {
					app.dispatcher.dispatch(entry.action, entry);
					const opensExternal = entry.action.startsWith('exportas-') || entry.action.startsWith('saveas-');
					JSDialog.CloseDropdown(dropdownId, opensExternal);
					return true;
				} else if (eventType === 'selected' && entry && entry.id) {
					builder.callback('menubutton', 'select', {id: dropdownId}, entry.id, builder);
					JSDialog.CloseDropdown(dropdownId);
					return true;
				} else /* note: entry can be a builder instance as in regular JSDialog callback */ {
					// custom popup - execute generic action
					builder.callback(objectType, eventType, object, data, builder);
					JSDialog.CloseDropdown(dropdownId);
					return true;
				}
			};

			var freshMenu = builder._menus.get(menuId); // refetch to apply dynamic changes
			if (freshMenu.length && freshMenu[0].type === 'colorpicker') {
				// make copy and fill with information to identify color command
				freshMenu = JSON.parse(JSON.stringify(freshMenu));
				freshMenu[0].command = data.command;
				freshMenu[0].id = data.id;
			}

			if (freshMenu.length === 1 && !isSplitButton) {
				callback(null, 'selected', null, null, freshMenu[0]);
			} else {
				JSDialog.OpenDropdown(dropdownId, control.container, freshMenu, callback);
			}
		};

		// make it possible to setup separate callbacks for split button
		if (isSplitButton) {
			JSDialog.AddOnClick(control.button, applyCallback);
		} else {
			JSDialog.AddOnClick(control.button, clickFunction);
			// Only wire the label separately when it isn't a descendant of
			// the button - otherwise a click on the label fires both
			// handlers (its own and the button's via bubbling), and any
			// toggle-style action ends up firing twice.
			if (control.label && !control.button.contains(control.label))
				JSDialog.AddOnClick(control.label, clickFunction);
		}

		if (control.arrow)
			JSDialog.AddOnClick(control.arrow, clickFunction);

		builder._preventDocumentLosingFocusOnClick(control.container);

		builder.options.noLabelsForUnoButtons = noLabels;

		return control;
	} else if (data.text !== undefined || data.image) {
		var button = window.L.DomUtil.create('button', 'menubutton ' + builder.options.cssClass, parentContainer);
		button.id = data.id;
		button.title = data.text;
		button.setAttribute('aria-haspopup', true);

		JSDialog.SetupA11yLabelForNonLabelableElement(button, data, builder);

		if (data.image) {
			var image = window.L.DomUtil.create('img', '', button);
			image.src = data.image;
			image.setAttribute('alt', '');
		}
		var label = window.L.DomUtil.create('span', 'unolabel', button);
		label.innerText = data.text ? data.text : '';
		window.L.DomUtil.create('i', 'arrow', button);

		$(button).click(function () {
			if (!button.hasAttribute('disabled')) {
				builder.callback('menubutton', 'toggle', button, undefined, builder);
			}
		});

		var enabled = Boolean(data.enabled);
		button.setAttribute('aria-disabled', !enabled);

		if (data.enabled === false)
			button.disabled = true;

		if (data.visible === false)
			button.classList.add('hidden');

	} else {
		window.app.console.warn('Not found menu "' + menuId + '"');
	}

	return false;
}

JSDialog.menubuttonControl = function (parentContainer, data, builder) {
	var buildInnerData = _menubuttonControl(parentContainer, data, builder);
	return buildInnerData;
};
