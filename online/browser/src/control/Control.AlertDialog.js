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
 * window.L.Control.Dialog used for displaying alerts
 */

/* global _ sanitizeUrl JSDialog */
window.L.Control.AlertDialog = window.L.Control.extend({
	onAdd: function (map) {
		// TODO: Better distinction between warnings and errors
		map.on('error', this._onError, this);
		map.on('warn', this._onError, this);
	},

	_onError: function(e) {
		if (!this._map._fatal &&
		    e.cmd !== 'notasync' &&
		    e.type !== 'warn') {
			this._map.uiManager.closeAll();
		}

		if (e.msg) {
			if (window.ThisIsAMobileApp && this._map._fatal) {
				this._map.uiManager.showErrorModal(e.msg, e.errorDetail, _('Close'), function() {
					window.postMobileMessage('BYE');
					this._map.uiManager.closeAll();
				}.bind(this));
			}
			else
				this._map.uiManager.showErrorModal(e.msg, e.errorDetail);

			window.app.console.error('AlertDialog: ' + e.msg + (e.errorDetail ? ' (' + e.errorDetail + ')' : ''));
		}
		else if (e.cmd == 'load' && e.kind == 'docunloading') {
			// Handled by transparently retrying.
			return;
		} else if (e.cmd == 'openlink') {
			var url = e.url;
			var messageText = window.errorMessages.leaving;

			var isLinkValid = sanitizeUrl(url) !== 'about:blank';

			if (!isLinkValid) {
				messageText = window.errorMessages.invalidLink;
			}

			/*
			 * P1. THIS MODAL HAD NO WAY OUT ON A PHONE.
			 *
			 * Measured on the built image at 393x852: #mobile-wizard came up
			 * position:fixed, z-index 2001, 393x800 -- the whole frame -- with
			 * "Open link" as its only control. Five touch gestures (tap below
			 * the content, tap top-left, swipe down, tap the grabber, tap the
			 * host header) all failed; only a hardware Escape closed it, and a
			 * phone does not have one. The only remaining move was to follow a
			 * link the dialog exists to let you decline.
			 *
			 * withCancel puts a second button in the modal's OWN buttonbox, and
			 * that button is wired without touching any of the chrome the other
			 * fixes in this change add: showInfoModal passes `openlink-cancel`
			 * to showModal as cancelButtonId, and showModal registers
			 * {id: cancelButtonId, func: () => this.closeModal(dialogId)}
			 * unconditionally (Control.UIManager.ts). So this path fires even if
			 * the sheet is mis-sized, the scrim is unreachable and the close
			 * control never renders -- which is the property worth having on the
			 * one defect where a plausible-looking fix that does not fire leaves
			 * a user trapped.
			 *
			 * Gated on isSmallScreenDevice() ALONE, deliberately unlike the
			 * sheet geometry and the close control, which are also gated on
			 * html.vulcan-mobile-chrome because they have CSS behind them. The
			 * full-frame wizard path is taken by every small-screen device
			 * (Util.MessageRouter routes modalpopup to the wizard on that test
			 * by itself), so a phone loaded with `?vulcanChrome=desktop` is in
			 * the trap with none of the chrome-class fixes applying to it. This
			 * button is pure dialog JSON with no stylesheet dependency, so it is
			 * the one path that can cover that configuration too — and it is the
			 * path worth having cover it.
			 *
			 * Desktop is untouched: its dialog is a small centred box with a
			 * titlebar ✕ and a reachable scrim already.
			 */
			var isSmallScreen = window.mode.isSmallScreenDevice();

			this._map.uiManager.showInfoModal('openlink', _('External link'), messageText, url,
				isLinkValid ? _('Open link') : _('OK'), function() {
					if (!isLinkValid)
						return;
					if ('processCoolUrl' in window) {
						url = window.processCoolUrl({ url: url, type: 'doc' });
					}

					// SANITIZE THE URL WE ACTUALLY OPEN. `sanitizeUrl(url)`
					// above is computed only to pick the dialog's wording --
					// its result was thrown away and the RAW url was opened, so
					// the check told the user a link was unsafe and then
					// followed it anyway if they tapped through. It also has to
					// happen AFTER processCoolUrl, which can rewrite the url.
					// The sibling call site gets this right
					// (Control.UIManager.ts:2817).
					//
					// `noopener` closes reverse tabnabbing: without it the page
					// we open inherits window.opener and can navigate THIS tab
					// -- the one holding the document -- to anywhere it likes.
					// A .docx is untrusted input that arrives by email, so a
					// link in one is exactly the vector that matters here.
					window.open(sanitizeUrl(url), '_blank', 'noopener');
				}, /* withCancel: */ isSmallScreen);
		} else if (e.kind == 'network' && e.code == 24581) {
			if (e.cmd == 'paste') {
				var alertId = 'paste_network_access_error';
				var title = _('Copied external sources are not allowed');
				var message1 = _('It seems you have copied a selection that includes external images.');
				var message2 = _('Downloading external resources is forbidden but pasting images is still possible. Please right click in the image, choose "Copy Image" and paste it into the document instead.');
			} else {
				// insert image for example, it should not happen with correct coolwsd.xml configuration of net.lok_allow
				alertId = 'insert_network_access_error';
				title = _('External data source not allowed');
				message1 = _('It seems you have tried to insert external data.');
				message2 = _('Selected external data source is forbidden. Please contact the system administrator.');
			}

			if (JSDialog.shouldShowAgain(alertId)) {
				var alertOptions = {
					title: title,
					messages: [
						message1,
						message2
					],
					buttons: [
						{
							text: _('Don’t show this again'),
							callback: function() {
								JSDialog.setShowAgain(alertId, false);
								return false; // Close modal
							}
						}
					],
					withCancel: false,
					focusId: JSDialog.generateModalId(alertId) + '-cancel'
				};

				JSDialog.showInfoModalWithOptions(alertId, alertOptions);
			}
		} else if (e.cmd == 'notasync') { // developer only no translation needed
			this._map.uiManager.showInfoModal(
				'cool_alert', '', 'This dialog is non-async', '', _('Close'), function() { /* Do nothing. */ }, false);
		} else if (e.cmd && e.kind) {
			this._map.fire('hidebusy');

			var msg = window.mode.isCODesktop()
				? _('A {0} error occurred while processing the {1} command.')
				: _('The server encountered a {0} error while parsing the {1} command.');
			msg = msg.replace('{0}', e.kind);
			msg = msg.replace('{1}', e.cmd);
			this._map.uiManager.showErrorModal(msg, e.errorDetail);

			window.app.console.error('AlertDialog: ' + msg + (e.errorDetail ? ' (' + e.errorDetail + ')' : ''));
		}
	}
});

window.L.control.alertDialog = function (options) {
	return new window.L.Control.AlertDialog(options);
};
