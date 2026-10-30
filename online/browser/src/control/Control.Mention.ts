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
 * Control.Mention
 */

/*
 * 🔴 TRACE, recorded because the phone-Impress parity matrix carried
 * google-slides.json's "@-mention with email notification" (comments / CORE) as
 * "server-side half still untraced" for four passes, and that description is
 * the wrong shape. It is not a client that works waiting on a server that does
 * not. On a PRESENTATION neither half runs, and the client half is the one that
 * stops first.
 *
 * 1. This class is never CONSTRUCTED for a presentation. Its single
 *    instantiation, Control.UIManager.ts:873, sits inside the
 *    `if (docType === 'text')` branch opened at :859. On Impress, Draw and Calc
 *    `map.mention` stays undefined for the life of the session.
 *
 * 2. Every entry point is independently doctype-gated to Writer as well, so the
 *    gate is not one line anyone could relax by accident:
 *      - CommentSection.ts:620      `app.map._docLayer._docType === 'text'`
 *      - CommentListSection.ts:810  same test, and this is the PHONE path --
 *                                   the 'input' listener on #input-modal-input,
 *                                   i.e. the mobile comment modal
 *      - TextInput.js:829           `this._map.getDocType() === 'text'`
 *      - A11yTextInput.js:599       same
 *    (CommentSection.ts:1615 and :1647 test it again before reading
 *    isTypingMention().)
 *
 * 3. The autocomplete list is not ours to produce and never was. sendMentionPostMsg
 *    below only fires a postMessage OUT — msgId 'UI_Mention',
 *    {type:'autocomplete'} — and the list comes back only if the WOPI host
 *    answers with 'Action_Mention', which Map.WOPI.js:1130-1132 feeds to
 *    openMentionPopup. The EMAIL is likewise entirely the host's: the only other
 *    thing we emit is 'UI_Mention' {type:'selected'} in callback() below. There
 *    is no mail path in this tree, and there is no bug here to fix — this is the
 *    designed division of labour.
 *
 * 4. OUR host implements neither message. In the host application the integration is
 *    the host's editor component, whose
 *    postMessage switch at :1344 handles App_LoadingStatus,
 *    Host_PostmessageReady, UI_Close, Action_RevisionHistory, rev-history,
 *    UI_FileVersions, UI_Share, Action_Save_Resp, View_Added, View_Removed,
 *    Get_Selection, Vulcan_AIAction, Doc_ModifiedStatus, Vulcan_Telemetry,
 *    Vulcan_Ready, Send_UNO_Command_Resp, Vulcan_ReadRange_Resp,
 *    Vulcan_GetSheetInfo_Resp, User_Idle, User_Active, Clicked_Button,
 *    State_Changed, Download_As, Action_Paste, Clicked_Special, Action_Error and
 *    Error. 'UI_Mention' is not among them, and 'Action_Mention' is never sent:
 *    grepping the repository for either token outside vendor/vulcan-office
 *    returns nothing. So the round trip is open at BOTH ends even in Writer.
 *
 * What that means for the row: closing it is not a phone-UI diff and not a
 * doctype gate to relax. It needs (a) core to give Impress comments a mention
 * anchor, and (b) the host to implement the UI_Mention/Action_Mention pair plus
 * the notification. Do not "fix" it by widening the four gates above — the
 * popup would open onto a list nobody sends.
 *
 * ⚠ LATENT, not currently reachable: Map.WOPI.js:1132 is
 * `this._map.mention.openMentionPopup(list)` with no optional chaining, so a
 * host that DID answer Action_Mention while a presentation is open would throw
 * a TypeError. Ours never sends it, so this cannot fire today. Worth an `?.`
 * whenever that file is next touched; it is outside this lane.
 */

/* global app cool */

interface MentionUserData {
	username: string;
	profile: string;
	label?: string;
}

class Mention extends AutoCompletePopup {
	declare map: any;
	declare newPopupData: PopupData;
	users: Array<MentionUserData>;
	filteredUsers: Array<MentionUserData>;
	declare data: MessageEvent<any>;
	debouceTimeoutId: NodeJS.Timeout;
	partialMention: Array<string>;
	typingMention: boolean;
	lastTypedChar: string;
	cursorPosAtStart: Point;

	constructor(map: any) {
		super(AutoCompleteDialogId.Mention, map);
	}

	onAdd() {
		this.newPopupData.isAutoCompletePopup = true;
		this.typingMention = false;
		this.partialMention = [];
		this.cursorPosAtStart = { x: 0, y: 0 } as Point;
	}

	sendMentionPostMsg(partialText: string) {
		if (this.debouceTimeoutId) clearTimeout(this.debouceTimeoutId);

		// happens when user deletes last character before '@'
		// if we send empty string to the WOPIHost. They might return us list
		// with thousand of users
		if (partialText === '') {
			this.closeMentionPopup(true);
			return;
		}

		this.debouceTimeoutId = setTimeout(() => {
			this.map.fire('postMessage', {
				msgId: 'UI_Mention',
				args: { type: 'autocomplete', text: partialText },
			});
		}, 300);
	}

	/* @ts-expect-error: Implementation is done before types are defined. Now there is a conflicting implementation. I need to keep it as is since this commit implies no functional changes. */
	getPopupEntries(users: Array<MentionUserData>): any[] {
		const entries: Array<TreeEntryJSON> = [];
		if (users === null) return entries;

		const text = this.getPartialMention();

		// filterout the users from list according to the text
		if (text.length > 1) {
			this.filteredUsers = users.filter((element: any) => {
				const uid = element.label ?? element.username;

				// case insensitive
				return uid.toLowerCase().includes(text.toLowerCase());
			});
		} else {
			this.filteredUsers = users;
		}

		if (this.filteredUsers.length !== 0) {
			for (const i in this.filteredUsers) {
				const currentUser = this.filteredUsers[i];
				const entry = {
					text: currentUser.label ?? currentUser.username,
					columns: [
						{
							text: currentUser.label ?? currentUser.username,
						},
					],
					row: i.toString(),
				} as TreeEntryJSON;
				entries.push(entry);
			}
		}
		return entries;
	}

	openMentionPopup(users: Array<MentionUserData>) {
		if (!this.typingMention) return;

		const entries = this.getPopupEntries(users);
		const commentSection = app.sectionContainer.getSectionWithName(
			app.CSections.CommentList.name,
		);

		const isMobileCommentActive = commentSection?.isMobileCommentActive();
		const mobileCommentModalId = commentSection?.getMobileCommentModalId();
		if (
			entries.length === 0 &&
			this.isSmallScreenDevice &&
			isMobileCommentActive
		) {
			const control = this.getTreeJSON();
			control.hideIfEmpty = true;
			const data = this.getPopupJSON(control, { x: 0, y: 0 });
			data.id = mobileCommentModalId;
			(data.control as TreeWidgetJSON).entries = [];
			this.sendUpdate(data);
			return;
		}

		// change start position if cursor Y position changes.
		// It happens when user is typing mention at the end where there is no
		// horizontal space and whole '@mention' goes to new line
		const currentPos = this.getCursorPosition();
		let cursorPos = { ...this.cursorPosAtStart }; // Make a copy so changes to cursorPos don’t affect the original position
		if (this.cursorPosAtStart.y !== currentPos.y) {
			cursorPos = currentPos;
			this.cursorPosAtStart = currentPos;
		}
		// For a mention typed in the document body the cursor position is
		// canvas-relative, so shift it by the canvas offset to reach viewport
		// coordinates: the top offset covers the navigation bar and toolbar above
		// the canvas, the left offset covers the navigation panel beside it. A
		// mention inside a comment already comes back in viewport coordinates, so
		// it must not be shifted again.
		if (!commentSection?.getActiveEdit()) {
			var canvasEl = this.map._docLayer._canvas.getBoundingClientRect();
			cursorPos.x += canvasEl.left;
			cursorPos.y += canvasEl.top;
		}
		if (entries.length === 0) {
			// If the key pressed was a space, and there are no matches, then just
			// dismiss the popup.
			const noMatchOnSpace = this.getPartialMention().indexOf(' ');
			if (noMatchOnSpace !== -1) {
				this.closeMentionPopup(false);
				return;
			}
			const control = this.getSimpleTextJSON();
			if (window.L.DomUtil.get(this.popupId + 'fixedtext')) {
				const data = this.getPopupJSON(control, cursorPos);
				this.sendUpdate(data);
				return;
			}
			if (window.L.DomUtil.get(this.popupId)) this.closeMentionPopup(true);
			const data = this.newPopupData;
			data.children[0].children[0] = control;
			data.posx = cursorPos.x;
			data.posy = cursorPos.y;
			this.sendJSON(data);
			return;
		}

		const control = this.getTreeJSON();
		if (isMobileCommentActive) control.hideIfEmpty = true;
		if (window.L.DomUtil.get(this.popupId + 'List')) {
			const data = this.getPopupJSON(control, cursorPos);
			if (isMobileCommentActive) data.id = mobileCommentModalId;
			(data.control as TreeWidgetJSON).entries = entries;
			this.sendUpdate(data);
			return;
		}

		if (window.L.DomUtil.get(this.popupId)) this.closeMentionPopup(true);
		const data = this.newPopupData;
		data.children[0].children[0] = control;
		(data.children[0].children[0] as TreeWidgetJSON).entries = entries;
		data.posx = cursorPos.x;
		data.posy = cursorPos.y;
		this.sendJSON(data);
	}

	private getSimpleTextJSON(): TextWidget {
		return {
			id: this.popupId + 'fixedtext',
			type: 'fixedtext',
			text: _('No search results found!'),
			enabled: true,
		} as TextWidget;
	}

	closeMentionPopup(typingMention: boolean): void {
		this.typingMention = typingMention;
		if (!typingMention) this.partialMention = [];

		const mentionPopup =
			window.L.DomUtil.get(this.popupId) ||
			window.L.DomUtil.get(this.popupId + 'List') ||
			window.L.DomUtil.get(this.popupId + 'fixedtext');
		if (!mentionPopup) return;

		this.map.jsdialog.focusToLastElement(this.popupId);
		if (this.isSmallScreenDevice) {
			const commentSection = app.sectionContainer.getSectionWithName(
				app.CSections.CommentList.name,
			);
			const isMobileCommentActive = commentSection?.isMobileCommentActive();
			const mobileCommentModalId = commentSection?.getMobileCommentModalId();

			if (isMobileCommentActive) {
				const control = this.getTreeJSON();
				control.hideIfEmpty = true;
				const data = this.getPopupJSON(control, { x: 0, y: 0 });
				data.id = mobileCommentModalId;
				(data.control as TreeWidgetJSON).entries = [];
				this.sendUpdate(data);
			} else {
				this.map.fire('closemobilewizard');
			}
		} else this.map.jsdialog.clearDialog(this.popupId);
	}

	// get partialMention excluding '@'
	getPartialMention(): string {
		return this.partialMention.join('').substring(1);
	}

	isTypingMention(): boolean {
		return this.typingMention;
	}

	handleMentionInput(ev: any, newPara: boolean) {
		if (!this.typingMention) {
			const isAtSymbol = ev.data === '@';
			const isLastCharAtOrSpace =
				this.lastTypedChar === ' ' || this.lastTypedChar === '@';
			if ((newPara && isAtSymbol) || (isAtSymbol && isLastCharAtOrSpace)) {
				this.partialMention.push(ev.data);
				this.typingMention = true;
				this.cursorPosAtStart = this.getCursorPosition();
				return;
			}
			this.lastTypedChar = ev.data;
			return;
		}

		const deleteEvent =
			ev.inputType === 'deleteContentBackward' ||
			ev.inputType === 'deleteContentForward';
		if (deleteEvent) {
			const ch = this.partialMention.pop();
			if (ch === '@') this.closeMentionPopup(false);
			else this.sendMentionPostMsg(this.getPartialMention());
			return;
		}

		if (ev.data === '@' && this.partialMention.length === 1) {
			return;
		}

		const regEx = /^[0-9a-zA-Z ]+$/;
		if (ev.data && ev.data.match(regEx)) {
			this.partialMention.push(ev.data);
			this.sendMentionPostMsg(this.getPartialMention());
		} else {
			this.closeMentionPopup(false);
		}
	}

	getMentionUserData(index: number): MentionUserData {
		if (index >= this.filteredUsers.length)
			return { username: '', profile: '', label: null } as MentionUserData;
		return this.filteredUsers[index];
	}

	private sendHyperlinkUnoCommand(
		uid: string,
		profile: string,
		replacement: string,
	) {
		var command = {
			'Hyperlink.Text': {
				type: 'string',
				value: '@' + uid,
			},
			'Hyperlink.URL': {
				type: 'string',
				value: profile,
			},
			'Hyperlink.ReplacementText': {
				type: 'string',
				value: replacement,
			},
		};
		this.map.sendUnoCommand('.uno:SetHyperlink', command, true);
	}

	callback(objectType: any, eventType: any, object: any, index: number) {
		const commentSection = app.sectionContainer.getSectionWithName(
			app.CSections.CommentList.name,
		);
		const comment = commentSection?.getActiveEdit();
		if (eventType === 'close') {
			this.closeMentionPopup(false);
		} else if (eventType === 'select' || eventType === 'activate') {
			const username = this.filteredUsers[index].username;
			const profileLink = this.filteredUsers[index].profile;
			const label = this.filteredUsers[index].label;
			const replacement = '@' + this.getPartialMention();

			if (comment) {
				comment.autoCompleteMention(
					label ?? username,
					profileLink,
					replacement,
				);
			} else {
				this.sendHyperlinkUnoCommand(
					label ?? username,
					profileLink,
					replacement,
				);
				this.map._textInput._sendText(' ');
			}
			this.map.fire('postMessage', {
				msgId: 'UI_Mention',
				args: { type: 'selected', username: username, label: label },
			});
			this.closeMentionPopup(false);
		} else if (eventType === 'keydown') {
			if (object.key !== 'Tab' && object.key !== 'Shift') {
				if (comment) comment.focus();
				else this.map.focus();
				return true;
			}
		}
		return false;
	}
}
