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
 * JSDialog.MobileTopBar - component of top bar on mobile
 */

/*
 * The id showItem() can actually resolve for the permission chip.
 *
 * The chip is registered by _generateHtmlItem('permissionmode') below as a
 * CONTAINER `permissionmode-container` wrapping an `htmlcontent` whose
 * rendered element (Widget.HTMLContent.ts getPermissionModeElements) carries
 * no id at all. Component.Toolbar.getItemElement looks up [modelId='…'] then
 * [id='…'] -- attribute VALUES are case-sensitive and modelId is only stamped
 * for real UNO buttons -- so the previous 'PermissionMode' matched nothing and
 * every call logged `executeAction: not found control with id:
 * "PermissionMode"` (Control.JSDialogBuilder.js:2006-2009) and did nothing.
 * 'permissionmode' would fail the same way; the container is the only id in
 * the DOM. Control.StatusBar.js:465-509 shows/hides the same widget by the
 * same container id, which is why the desktop status bar has always worked.
 */
const PERMISSION_MODE_ITEM = 'permissionmode-container';

class MobileTopBar extends JSDialog.Toolbar {
	constructor(map: any) {
		super(map, 'MobileTopBar', 'toolbar-up');

		app.events.on('updatepermission', this.onUpdatePermission.bind(this));
		map.on('commandstatechanged', this.onCommandStateChanged, this);
	}

	private getToolItems() {
		if (this.docType == 'text') {
			// Google Docs phone edit bar (docs/mobile-redesign/01 §2):
			// ✓ Done · undo · redo · (spacer) · + insert · A format — the
			// ✓ Done at far left is the STOCK #toolbar-mobile-back button
			// (blue check in edit mode, exits to the read-only posture); the
			// kebab overflow is the stock hamburger at the row's end (both
			// restyled in vulcan-theme.css §13). Comments are ADDED via + and
			// the selection pill; the comment wizard button is how an existing
			// thread is read and answered, and for Writer it now shows in both
			// postures (see onUpdatePermission).
			return [
				{type: 'toolitem', id: 'signstatus', command: '.uno:Signature', w2icon: '', text: _UNO('.uno:Signature'), visible: false},
				{type: 'toolitem',  id: 'undo', text: _UNO('.uno:Undo'), command: '.uno:Undo', enabled: false},
				{type: 'toolitem',  id: 'redo', text: _UNO('.uno:Redo'), command: '.uno:Redo', enabled: false},
				{type: 'spacer', id: 'before-permissionmode'},
				this._generateHtmlItem('permissionmode'),
				{type: 'spacer', id: 'after-permissionmode'},
				{type: 'customtoolitem',  id: 'insertion_mobile_wizard', command: 'insertion_mobile_wizard'},
				{type: 'customtoolitem',  id: 'mobile_wizard', command: 'mobile_wizard'},
				{type: 'customtoolitem',  id: 'comment_wizard', command: 'comment_wizard', w2icon: 'viewcomments'},
				{type: 'menubutton', id: 'userlist:UsersListMenu', visible: false},
			];
		} else if (this.docType == 'spreadsheet') {
			// Google Sheets phone edit bar (docs/mobile-redesign/02 §3),
			// mirroring the Writer treatment above: ✓ Done (stock
			// #toolbar-mobile-back) · undo · redo · (spacer) · + insert ·
			// A format · ⋮ (stock hamburger). acceptformula/cancelformula
			// stay for the STOCK phone chrome only — under vulcan-mobile-chrome
			// they live in the bottom-docked formula bar instead
			// (Control.FormulaBarJSDialog.js / Toolbar.js) and these two are
			// never shown. Comments move behind the read-only posture /
			// kebab per the 02 §3 invariant set (see onUpdatePermission).
			return [
				{type: 'toolitem', id: 'signstatus', command: '.uno:Signature', w2icon: '', text: _UNO('.uno:Signature'), visible: false},
				{type: 'toolitem',  id: 'undo', text: _UNO('.uno:Undo'), command: '.uno:Undo', enabled: false},
				{type: 'toolitem',  id: 'redo', text: _UNO('.uno:Redo'), command: '.uno:Redo', enabled: false},
				{type: 'customtoolitem', visible: false, id: 'acceptformula', command: 'acceptformula', text: _('Accept')},
				{type: 'customtoolitem', visible: false, id: 'cancelformula', command: 'cancelformula', text: _('Cancel')},
				{type: 'spacer', id: 'before-PermissionMode'},
				this._generateHtmlItem('permissionmode'),
				{type: 'spacer', id: 'after-PermissionMode'},
				{type: 'customtoolitem',  id: 'insertion_mobile_wizard', command: 'insertion_mobile_wizard'},
				{type: 'customtoolitem',  id: 'mobile_wizard', command: 'mobile_wizard'},
				{type: 'customtoolitem',  id: 'comment_wizard', command: 'comment_wizard', w2icon: 'viewcomments'},
				{type: 'menubutton', id: 'userlist:UsersListMenu', visible: false},
			];
		} else if (this.docType == 'presentation') {
			// Google Slides phone bar (docs/mobile-redesign/03 §2), TWO
			// postures — see onUpdatePermission for the split and for the
			// width arithmetic that forces it:
			//
			//   read   ✓ Done · (spacer) · 💬 comments · ▶ present · ⋮
			//   edit   ✓ Done · undo · redo · (spacer) · + insert · A format · ▶ present · ⋮
			//
			// Mirrors the Writer ordering (+ before A); the ✓ Done is the
			// stock #toolbar-mobile-back and the kebab is the stock
			// hamburger, both restyled in vulcan-theme.css §13. The present
			// item needs an explicit command: its id ends in
			// '-toolbar-mobile' which has no dispatcher action, so without
			// it the tap was a no-op ("unknown dispatch").
			//
			// Everything is DECLARED here in both postures; the stock phone
			// chrome (?vulcanChrome=desktop on a phone) keeps the untouched
			// always-on set, exactly as the Calc treatment above does.
			return [
				{type: 'toolitem', id: 'signstatus', command: '.uno:Signature', w2icon: '', text: _UNO('.uno:Signature'), visible: false},
				{type: 'toolitem',  id: 'undo', text: _UNO('.uno:Undo'), command: '.uno:Undo', enabled: false},
				{type: 'toolitem',  id: 'redo', text: _UNO('.uno:Redo'), command: '.uno:Redo', enabled: false},
				{type: 'spacer', id: 'before-permissionmode'},
				this._generateHtmlItem('permissionmode'),
				{type: 'spacer', id: 'after-permissionmode'},
				{type: 'customtoolitem',  id: 'insertion_mobile_wizard', command: 'insertion_mobile_wizard'},
				{type: 'customtoolitem',  id: 'mobile_wizard', command: 'mobile_wizard'},
				{type: 'customtoolitem',  id: 'comment_wizard', command: 'comment_wizard', w2icon: 'viewcomments'},
				{type: 'customtoolitem', id: 'fullscreen-' + this.docType + '-toolbar-mobile', command: 'fullscreen-' + this.docType, text: _UNO('.uno:FullScreen', this.docType)},
				{type: 'menubutton', id: 'userlist:UsersListMenu', visible: false},
			];
		} else if (this.docType == 'drawing') {
			return [
				{type: 'toolitem', id: 'signstatus', command: '.uno:Signature', w2icon: '', text: _UNO('.uno:Signature'), visible: false},
				{type: 'toolitem',  id: 'undo', text: _UNO('.uno:Undo'), command: '.uno:Undo', enabled: false},
				{type: 'toolitem',  id: 'redo', text: _UNO('.uno:Redo'), command: '.uno:Redo', enabled: false},
				{type: 'spacer', id: 'before-PermissionMode'},
				this._generateHtmlItem('permissionmode'),
				{type: 'spacer', id: 'after-PermissionMode'},
				{type: 'customtoolitem',  id: 'mobile_wizard', command: 'mobile_wizard'},
				{type: 'customtoolitem',  id: 'insertion_mobile_wizard', command: 'insertion_mobile_wizard'},
				{type: 'customtoolitem',  id: 'comment_wizard', command: 'comment_wizard', w2icon: 'viewcomments'},
				{type: 'menubutton', id: 'userlist:UsersListMenu', visible: false},
			];
		}
	}

	create() {
		const items = this.getToolItems();
		this.builder.build(this.parentContainer, items);
	}

	onUpdatePermission(e: any) {
		// Google posture (01 §2/§6): edit mode shows session controls + the
		// two entry points. The ✓ Done affordance is the stock
		// #toolbar-mobile-back element, managed by the editmode-on/off
		// classes.
		//
		// WRITER COMMENT DEADLOCK. The wizard is the ONLY comment-reading
		// surface on a phone -- the right-margin rail is off by construction
		// (CommentListSection commentsAreListed) and Writer draws no anchor
		// to tap. Hiding the wizard button in edit mode therefore made
		// comments write-only there, while the read posture makes them
		// read-only (Permission.js _applyViewReadOnly clears
		// app.file.editComment, so CommentSection.updateEditability hides
		// every per-comment action). Between the two there was NO posture in
		// which a Writer phone user could read a comment and answer it.
		// Writer now keeps the button in both postures; the read posture is
		// still the default and nothing about entering edit mode changed.
		// Calc keeps its existing policy; Impress gets its own posture split below.
		const editButtons: string[] = ['undo', 'redo', 'mobile_wizard', 'insertion_mobile_wizard'];
		const isText: boolean = this.docType === 'text';
		// Calc under the Google-style phone chrome mirrors Writer: comments
		// are reached via + / long-press while editing (02 §3); the stock
		// phone chrome keeps the comment button in the edit posture.
		const isVulcanCalc: boolean = this.docType === 'spreadsheet' &&
			document.documentElement.classList.contains('vulcan-mobile-chrome');
		// The gate for the Writer deadlock fix, and the only new term in the
		// comment_wizard expression below: substituting false restores the
		// previous `!isText && !isVulcanCalc && !isVulcanImpress` byte for
		// byte, so the Impress posture split below is untouched by it. This
		// class is also constructed only under
		// `if (window.mode.isSmallScreenDevice())` (Control.UIManager.ts), so
		// desktop and tablet never run this code.
		const isVulcanWriter: boolean = isText &&
			document.documentElement.classList.contains('vulcan-mobile-chrome');
		// Impress under the phone chrome: the EDIT posture is curated down to
		// five controls. The six-control row does not fit, but Present is part
		// of Slides' primary edit bar; only the duplicate comment entry moves.
		//
		// The budget, measured off the declared CSS rather than guessed. On a
		// 390px viewport #toolbar-row lays out logo(0, device-mobile.css:40) ·
		// back(44: width:42px!important at device-mobile.css:49 is clamped up
		// by min-width:44px at vulcan-theme.css:1264) · outer spacer(0) ·
		// #toolbar-up · kebab(44, flex:0 0 44px, vulcan-theme.css:2291). Only
		// #toolbar-up shrinks (min-width:0, vulcan-theme.css:2302), so it is
		// left 390-44-44 = 302px. Inside it the builder wraps the items in
		// .root-container > .vertical (Control.JSDialogBuilder.js:2397-2400)
		// and that row carries `padding: 0 5px` (toolbar.css:97), leaving
		// 292px. Each button is min-width:48px (vulcan-theme.css:1238), plus
		// two 1px borders and `margin: auto 2px` (toolbar.css:105) = 54px;
		// min-width means they cannot shrink to fit.
		//
		//   edit, before  undo·redo·+·A·💬·▶     6 x 54 = 324px into 292px
		//   edit, then    undo·redo·+·A·▶        5 x 54 = 270px
		//   edit, now     undo·redo·+·▶          4 x 54 = 216px
		//   read          💬·▶                   2 x 54 = 108px
		//
		// The 20px that did not fit did not clip: the row's overflow is
		// visible, so the tail ran under #toolbar-hamburger, which carries
		// z-index:1002 (device-mobile.css:28) and therefore took the taps.
		//
		// The hidden controls are not stranded:
		//   💬 — same rule Writer and Calc already apply on this line. Add
		//        comment is on page 2 of BOTH modes of the phone selection
		//        pill: search Control.ImpressSelectionBar.ts setPage() for
		//        the two `id: 'comment'` entries (text mode and shape mode),
		//        both running VulcanSlideComment.insert. That is also where
		//        the reference's own catalogue files it — "select text/an
		//        object in edit mode and use More > Add comment", quoted in
		//        that file's header comment.
		//   A  — the mode-scoped contextual row's pinned Format chip
		//        (VulcanImpressFormatRow.ts, §13i.21), which opens the same
		//        sheet this seat opened. This is the CORRECTION, not a saving:
		//        the reference's top bar carries Format in exactly ONE mode (a
		//        bare selection) and drops it entirely while typing, so a
		//        fixed seat here was a mode-scoped affordance rebuilt as a
		//        fixture. The row is on screen for exactly the modes the sheet
		//        has anything to say about, and it takes ONE tap to Bold where
		//        this seat took two. Gated on the phone chrome with the rest:
		//        the stock phone bar keeps the untouched always-on set, and
		//        with ?vulcanChrome=desktop the row is never built either, so
		//        the two halves cannot leave a phone with no Format door.
		// Present deliberately stays direct in both postures. It is one of the
		// exact edit-bar actions in the Slides phone contract, and five 54px
		// controls fit the measured 292px middle budget with 22px to spare.
		//
		// (Symbol-anchored, not line-anchored, on purpose: both files are
		// edited often enough that a line number here would be wrong before
		// anyone read it.)
		//
		// Gated on the chrome class alone, deliberately: this line's
		// neighbour isVulcanCalc is, the class is stamped by global.js only
		// on small-screen devices, and ?vulcanChrome=desktop removes it — so
		// the stock phone bar keeps the untouched always-on set.
		const isVulcanImpress: boolean = this.docType === 'presentation' &&
			document.documentElement.classList.contains('vulcan-mobile-chrome');
		const presentId: string =
			'fullscreen-' + this.docType + '-toolbar-mobile';
		if (e.detail.perm === 'edit') {
			editButtons.forEach((id) => {
				this.showItem(id, true);
			});
			this.showItem(
				'comment_wizard',
				isVulcanWriter || (!isText && !isVulcanCalc && !isVulcanImpress),
			);
			// Present is direct in BOTH postures (see the budget above): the
			// edit row is undo·redo·+·▶, four 54px controls in 292px. The
			// duplicate comment entry and the A both have named homes above.
			if (isVulcanImpress) {
				this.showItem('mobile_wizard', false);
				this.showItem(presentId, true);
			}
			this.showItem(PERMISSION_MODE_ITEM, false);
		} else {
			editButtons.forEach((id) => {
				this.showItem(id, false);
			});
			this.showItem('comment_wizard', true);
			if (isVulcanImpress) this.showItem(presentId, true);
			if ($('#mobile-edit-button').is(':hidden')) {
				this.showItem(PERMISSION_MODE_ITEM, true);
			}
		}
	}

	onCommandStateChanged(e: any) {
		const commandName: string = e.commandName;
		const state: string = e.state;

		if (this.map.isEditMode() && (state === 'enabled' || state === 'disabled')) {
			const id: string = (window as any).unoCmdToToolbarId(commandName);

			if (state === 'enabled') {
				this.enableItem(id, true);
			} else {
				//this.uncheck(id);
				this.enableItem(id, false);
			}
		}
	}

	_generateHtmlItem(id: string) {
		const isReadOnlyMode: boolean = app.map ? app.isReadOnly() : true;
		const canUserWrite: boolean = !app.isReadOnly();

		// `visible: false` belongs on the CONTAINER, exactly as
		// Control.StatusBar.js:182-196 puts it. On the htmlcontent child it
		// was inert: JSDialogBuilder.postProcess resolves the flag by looking
		// the id up inside the container, the rendered chip carries no id
		// (Widget.HTMLContent.ts:107), and `parent.id` is
		// '<id>-container' -- so neither branch matched and nothing was ever
		// hidden. Paired with PERMISSION_MODE_ITEM above, the chip now starts
		// hidden and the show/hide calls reach it.
		return {
			type: 'container',
			id: id + '-container',
			children: [
				{type: 'htmlcontent', id: id, htmlId: id, text: '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp', isReadOnlyMode: isReadOnlyMode, canUserWrite: canUserWrite},
				{type: 'spacer', id: id + '-break'}
			],
			vertical: false,
			visible: false,
		};
	}
}

JSDialog.MobileTopBar = function (map: any) {
	return new MobileTopBar(map);
};
