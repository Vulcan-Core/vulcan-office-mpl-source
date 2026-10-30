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
 * JSDialog.MobileSearchBar - mobile search bar
 */

/* global _ _UNO app */
class MobileSearchBar extends Toolbar {
	/*
		SvxSearchCmd, read off the enum and not off a memory of it:
		engine/include/svl/srchitem.hxx:35-41 declares FIND = 0, FIND_ALL = 1,
		REPLACE = 2, REPLACE_ALL = 3. Two independent confirmations that these
		are the numbers the wire actually carries:

		  - engine/sd/qa/unit/tiledrendering/KitSearchTest.cxx:56-68 drives
		    Impress replace through the SAME .uno:ExecuteSearch property bag
		    this file ends up sending (SearchItem.SearchString /
		    .ReplaceString / .Command), casting the enum straight to the
		    integer;
		  - src/app/VulcanWriterBridge.ts:97-99 already hard-codes 0/2/3 with
		    the same meanings in this tree.

		Impress honours both: sd/source/ui/view/Outliner.cxx:916-923 replaces
		the CURRENT selection when the command is REPLACE and then searches on,
		which is exactly the "step through matches, then Replace" grammar the
		Slides row describes, and :940 loops the whole document for
		REPLACE_ALL.
	*/
	private static readonly REPLACE = 2;
	private static readonly REPLACE_ALL = 3;

	/*
		Declared WITHOUT initialisers, deliberately. Toolbar's constructor calls
		create() itself (Component.Toolbar.ts:35), so a subclass field
		initialiser — even `= null` — would run when super() returns, i.e. AFTER
		create() has stored these, and would wipe them. tsconfig.json sets
		useDefineForClassFields: false, so a bare declaration emits no
		assignment at all. Keep it bare.
	*/
	private replaceInput: HTMLInputElement;
	private replaceButtons: Array<HTMLButtonElement>;
	private ordinal: HTMLElement;
	private ordinalPending: boolean;
	private ordinalBound: boolean;

	// The synthetic state name the Writer producer sends
	// (sw/source/uibase/uiview/viewsrch.cxx, the FIND arm). NOT a dispatchable
	// UNO command and it must never be added to a command-state whitelist --
	// it is a one-way value channel that happens to ride the state-change
	// message, the same way `.uno:CurrentTrackedChangeId` does.
	private static readonly ORDINAL_COMMAND = '.uno:SearchOrdinal';
	private static readonly ORDINAL_ID = 'vulcan-search-ordinal';

	constructor(map: any) {
		super(map, 'MobileSearchBar', 'toolbar-search');
	}

	getToolItems(): Array<ToolItemWidgetJSON> {
		return [
			{
				type: 'customtoolitem',
				id: 'hidesearchbar',
				w2icon: 'prevrecord',
				text: _('Hide the search bar'),
			},
			{ type: 'searchedit', id: 'search', placeholder: _('Search'), text: '' },
			{
				type: 'customtoolitem',
				id: 'cancelsearch',
				text: _('Clear the search field'),
				enabled: false,
			},
			{
				type: 'customtoolitem',
				id: 'searchprev',
				text: _UNO('.uno:UpSearch'),
				enabled: false,
				pressAndHold: true,
			},
			{
				type: 'customtoolitem',
				id: 'searchnext',
				text: _UNO('.uno:DownSearch'),
				enabled: false,
				pressAndHold: true,
			},
			{ type: 'spacer', id: 'left' },
		];
	}

	create() {
		const items = this.getToolItems();
		this.builder.build(this.parentContainer, items, undefined);
		// Both no-ops unless their phone gates are true, so the desktop and
		// tablet search bars are byte-for-byte what they were.
		//
		// The ordinal goes LAST on purpose. create() is called from Toolbar's
		// constructor with nothing between it and the caller, so anything that
		// throws in here takes the whole search bar with it -- and the newest,
		// least important control is the one that should be downstream of the
		// others when that happens, not upstream of them.
		this.buildReplaceRow();
		this.buildOrdinal();
	}

	/*
		"3/12" BETWEEN THE FIELD AND THE ARROWS -- the count Google Docs shows
		on every phone find and this bar did not.

		WHY THE NUMBER HAS TO COME OFF THE WIRE, because the obvious client-side
		answers are all wrong and one of them looks right:

		  - `searchresultselection` cannot supply it. A plain FIND resolves ONE
		    match, so CanvasTileLayer._onSearchResultSelection always computes
		    `count = 1` on this path and the `search` event carries that 1. It
		    is a "did we find something" flag, not a total.
		  - Asking for the total with a FIND_ALL is worse than no total:
		    SvxSearchCmd::FIND_ALL selects EVERY match, which destroys the
		    current match the ordinal would be counting from and moves the
		    user's cursor. SearchService.highlightAll is the dead remains of
		    that idea (no callers, and it passes '1' in the replaceString slot
		    rather than as the command).
		  - Core already computes the real pair on every phone FIND
		    (viewsrch.cxx lcl_PublishPhoneMatchOrdinal, a read-only sweep on a
		    private SwUnoCursor), but its only sink was
		    SvxSearchDialogWrapper::SetSearchLabel, which reaches a client ONLY
		    while the Find & Replace SHEET is open. The number existed and this
		    bar could not see it. The engine change alongside this one adds the
		    second sink; nothing here invents a number.

		STATE HANDLING, and the ordering it depends on. One search produces, in
		this order on one socket: `searchresultselection` (or `searchnotfound`)
		-> the map's `search` event -> `statechanged: .uno:SearchOrdinal`. So
		the `search` event is the signal that whatever is on screen is now
		stale, and the state change is the signal that fills it back in. Three
		states, all of them honest:

		  no query / typing      cleared, by the field's own input listener
		  searching              cleared and ARMED -- blank, never a stale
		                         number from the previous term
		  0 matches              cleared and NOT armed: the producer runs only
		                         on the found path, so no ordinal is coming.
		                         `count === 0` already gets the red flash from
		                         Control.Toolbar.js; a "0/0" on top of it would
		                         be a second, redundant way to say the same
		                         thing
		  n of m                 rendered

		THE ARMING IS WHAT MAKES REPLAY SAFE. ChildSession records every state
		change (`_stateRecorder.recordState`) and replays it to a view that
		joins or reconnects, so an unguarded listener would paint a count from
		somebody else's search minutes ago. An ordinal is only accepted while
		this bar is waiting for one, which no replay can satisfy.
	*/
	private isPhoneOrdinalSurface(): boolean {
		return (
			window.mode.isSmallScreenDevice() &&
			document.documentElement.classList.contains('vulcan-mobile-chrome')
		);
	}

	/*
		Raw DOM and not a toolbar item, for the reason buildReplaceRow gives at
		length: this toolbar defines no builder.callback, so introducing one to
		carry a new widget would re-route the EXISTING searchedit's events away
		from _defaultCallbackHandler as a side effect. A span that only ever
		receives textContent changes nothing about the row it joins.

		Inserted before `#searchprev` rather than appended, because that is
		where Docs puts it -- field, count, previous, next -- and because
		anchoring on the arrows keeps the position right whatever the row's
		container turns out to be.

		Scoped with parentContainer.querySelector and NOT document.getElementById:
		`searchprev` is also a StatusBar item id, and resolving this against the
		document would let a desktop-shaped session hand back the wrong bar's
		arrow. This bar's own subtree cannot be the wrong answer.

		Built for every phone doctype, not just Writer. Only Writer's producer
		is wired today, so on phone Calc/Impress/Draw no `.uno:SearchOrdinal`
		ever arrives and the span stays empty and `hidden` -- zero pixels, zero
		behaviour. When Calc's producer (sc/source/ui/view/viewfun2.cxx already
		computes the same pair for the sheet) grows the same second sink, this
		lights up with no client change.
	*/
	private buildOrdinal(): void {
		if (!this.isPhoneOrdinalSurface()) return;

		const parent = this.parentContainer as HTMLElement;
		if (!parent) return;

		const anchor = parent.querySelector('#searchprev');
		if (!anchor || !anchor.parentNode) return;

		// create() runs once per toolbar, but never leave two behind.
		const stale = parent.querySelector('#' + MobileSearchBar.ORDINAL_ID);
		if (stale && stale.parentNode) stale.parentNode.removeChild(stale);

		const label = document.createElement('span');
		label.id = MobileSearchBar.ORDINAL_ID;
		// role=status + aria-live: the count changes without focus moving, and
		// a match position is exactly the kind of thing a screen reader user
		// otherwise has to hunt for. Polite, because stepping through matches
		// already announces the selection.
		label.setAttribute('role', 'status');
		label.setAttribute('aria-live', 'polite');
		anchor.parentNode.insertBefore(label, anchor);
		this.ordinal = label;
		this.clearOrdinal();

		/*
			Guarded twice.

			ordinalBound: create() can in principle run again on a rebuilt
			toolbar, and a second subscription would double every update.

			typeof this.map.on: a match count is a nicety and the search bar is
			not, so the nicety is not allowed to be able to take the bar down.
			That is not a hypothetical -- adding this control unguarded broke
			`resyncs replace actions through the real programmatic clear path`
			in mocha_tests/CalcPhoneFindReplaceMenu.test.ts with `this.map.on is
			not a function`, thrown out of the CONSTRUCTOR, i.e. the whole bar
			never got built. A stub map found it; a real surface that builds
			this bar before the map is fully wired would have found it on a
			phone instead, and there the failure is a search that does not open.
		*/
		if (!this.ordinalBound && this.map && typeof this.map.on === 'function') {
			this.ordinalBound = true;
			this.map.on('search', this.onSearchOrdinalReset, this);
			this.map.on('commandstatechanged', this.onOrdinalState, this);
		}

		const term = parent.querySelector('#search-input');
		if (term) term.addEventListener('input', this.clearOrdinal.bind(this));
	}

	/*
		A completed search invalidates whatever is on screen. Arm the wait only
		when something was found -- see the state table above.
	*/
	private onSearchOrdinalReset(e: any): void {
		// The Writer agent bridge's own searches are not the reader's
		// (CanvasTileLayer._claimBridgeSearch): the reader's "3 of 12" stays.
		if (e && e.vulcanBridge) return;
		this.clearOrdinal();
		this.ordinalPending = !!e && e.count !== 0;
	}

	private onOrdinalState(e: any): void {
		if (!e || e.commandName !== MobileSearchBar.ORDINAL_COMMAND) return;
		if (!this.ordinalPending) return;
		this.ordinalPending = false;

		const parsed = MobileSearchBar.parseOrdinal(e.state);
		/*
			An unparseable or out-of-range payload leaves the label CLEARED,
			which is the same answer the engine gives itself:
			SetSearchLabel(nCurrent, nTotal) drops out-of-range input rather
			than clamping it (svx/source/dialog/srchdlg.cxx), because a
			fabricated position hides the producer bug that made it.

			A NEGATIVE TOTAL IS A DIAGNOSIS, NOT A COUNT, and it lands here on
			purpose. The producer answers a search it cannot number with a
			reason code in the total (viewsrch.cxx PHONE_ORDINAL_*: -1 search
			attributes, -2 selection-scoped, -3 over the node budget, -4 sweep
			cancelled, -5 sweep found nothing, -6/-7 a match outside the body,
			-8 the two walks disagreed, -9 no shell cursor) and an auxiliary
			number in the `current` field. Both are for whoever is reading the
			socket; neither is for the user. The rule that makes that safe is
			one line up in parseOrdinal -- digits only, total >= 1 -- so
			rendering a reason code is not something this class can start doing
			by accident. Do not "improve" this into a message.
		*/
		if (!parsed) return;
		this.showOrdinal(parsed.current, parsed.total);
	}

	/*
		The whole of the wire format, in one pure function so it can be tested
		without a map, a socket or a DOM: two decimal integers separated by ';'.

		Deliberately strict. Anything that is not exactly two digit-only fields
		in a sane range is rejected rather than coerced -- `Number('')` is 0 and
		`parseInt('3 of 12')` is 3, so a lenient parse here is how a malformed
		payload becomes a confident wrong number on screen.
	*/
	public static parseOrdinal(
		state: any,
	): { current: number; total: number } | null {
		if (typeof state !== 'string') return null;
		const parts = state.split(';');
		if (parts.length !== 2) return null;
		if (!/^[0-9]+$/.test(parts[0]) || !/^[0-9]+$/.test(parts[1])) return null;
		const current = Number(parts[0]);
		const total = Number(parts[1]);
		if (total < 1 || current < 1 || current > total) return null;
		return { current: current, total: total };
	}

	private showOrdinal(current: number, total: number): void {
		if (!this.ordinal) return;
		this.ordinal.textContent = _('%1/%2')
			.replace('%1', String(current))
			.replace('%2', String(total));
		// The compact form is what fits between a 188px find field and two
		// arrows; the spoken form is the one a person would say. aria-label on
		// an element with text content replaces that text for assistive tech,
		// which is exactly the split wanted here.
		this.ordinal.setAttribute(
			'aria-label',
			_('Result %1 of %2')
				.replace('%1', String(current))
				.replace('%2', String(total)),
		);
		this.ordinal.classList.remove('hidden');
	}

	/*
		Cleared means BOTH empty and hidden, not just hidden. The class is the
		display mechanism, but the text is the guarantee: if some future rule
		defeats `.hidden`, an empty span shows nothing, whereas a hidden span
		holding "3/12" would show the wrong search's answer.
	*/
	private clearOrdinal(): void {
		this.ordinalPending = false;
		if (!this.ordinal) return;
		this.ordinal.textContent = '';
		this.ordinal.removeAttribute('aria-label');
		this.ordinal.classList.add('hidden');
	}

	/*
		BOTH halves of the phone gate, plus the doctype.

		  - isSmallScreenDevice() alone is NOT the gate. `?vulcanChrome=desktop`
		    puts the stock desktop chrome on a small screen without consulting
		    screen size (js/global.js:472 only stamps the marker when the
		    desktop-chrome probe said no), and every rule that styles the row
		    below is scoped html.vulcan-mobile-chrome. Building a control whose
		    entire appearance depends on a class that is not present is the
		    defect this session has already shipped six times.
		  - The doctype is the third part because this bar is shared by Writer,
		    Calc, Impress and Draw on every phone, and the row being answered
		    here is a Google SLIDES row. §13i.14 raises the bar's height only
		    for body[data-doctype='presentation'], so a Writer phone that grew
		    a replace row would grow it inside a 39px box and be clipped. If
		    Docs/Sheets want the same row, they widen BOTH gates together.

		this.docType is Toolbar's own copy of map.getDocType()
		(Component.Toolbar.ts:29), assigned before createBuilder()/create() run,
		so it is safe to read from here.
	*/
	private isPhoneReplaceSurface(): boolean {
		return (
			window.mode.isSmallScreenDevice() &&
			document.documentElement.classList.contains('vulcan-mobile-chrome') &&
			this.docType === 'presentation'
		);
	}

	/*
		The second row: "Replace with" + Replace + Replace all.

		A SECOND ROW rather than four more items on the existing one, because
		one row does not fit. At 390px the existing row already spends its width
		on back / find / clear / prev / next; a 44px finger target for each of
		the four buttons is 176px, and two word-labelled actions ("Replace",
		"Replace all") are ~186px more. 176 + 186 = 362 of 390 leaves 28px for
		TWO text fields. The arithmetic that does work is §13i.14's, on a row of
		its own.

		This is raw DOM rather than toolbar JSON on purpose: a customtoolitem
		routes its click through the dispatcher's actionsMap
		(Widget.Toolitem.ts:114 -> docdispatcher.ts:24), which is a different
		file, and a pushbutton would route through builder.callback — which this
		toolbar does not define, so defining one would re-route the EXISTING
		searchedit's change/activate events away from _defaultCallbackHandler
		as a side effect. Building the row directly changes nothing about row
		one. Control.ImpressSelectionBar.ts builds its pill the same way.

		Deliberately NOT here, because Google does not have them on phone:
		regex, match case, whole words, search-all. No `.uno:SearchDialog`
		either — core's phone find-replace variant still shows Match case, and
		a second find surface in the kebab is a divergence, not parity.
	*/
	private buildReplaceRow(): void {
		if (!this.isPhoneReplaceSurface()) return;

		const parent = this.parentContainer as HTMLElement;
		if (!parent) return;

		// create() is called once, from Toolbar's constructor — insertItem(),
		// the only other caller of a Toolbar create(), is used on the top
		// toolbar only. Belt and braces: never leave two rows behind.
		const stale = document.getElementById('vulcan-search-replace-row');
		if (stale && stale.parentNode) stale.parentNode.removeChild(stale);

		const row = document.createElement('div');
		row.id = 'vulcan-search-replace-row';
		row.setAttribute('role', 'group');
		row.setAttribute('aria-label', _('Replace'));

		const input = document.createElement('input');
		input.id = 'vulcan-search-replace-input';
		input.type = 'text';
		input.dir = 'auto';
		input.setAttribute('autocomplete', 'off');
		input.setAttribute('placeholder', _('Replace with'));
		input.setAttribute('aria-label', _('Replace with'));
		row.appendChild(input);

		this.replaceInput = input;
		this.replaceButtons = [
			this.addReplaceAction(
				row,
				'vulcan-search-replace',
				_('Replace'),
				MobileSearchBar.REPLACE,
			),
			this.addReplaceAction(
				row,
				'vulcan-search-replace-all',
				_('Replace all'),
				MobileSearchBar.REPLACE_ALL,
			),
		];

		parent.appendChild(row);

		// Both actions are dead without a term, and both are dead in the
		// read-only posture the search bar is also shown in
		// (docdispatcher.ts:304-311 shows it there deliberately).
		const term = document.getElementById('search-input');
		if (term) term.addEventListener('input', this.syncEnabled.bind(this));
		app.events.on('updatepermission', this.syncEnabled.bind(this));
		this.syncEnabled();
	}

	/*
		Replace is destructive and Replace all more so, so neither commits on
		finger-DOWN. pointerdown cancels the default (which keeps focus, and so
		the keyboard, where the user put it) and does nothing else; the commit
		is on pointerup, and only if the finger let go ON the button — a
		gesture that turned into a scroll, or slid from Replace onto Replace
		all, is a cancel.

		No confirmation dialog: the direction forbids adding friction, and the
		cancel is already in the gesture.
	*/
	private addReplaceAction(
		row: HTMLElement,
		id: string,
		label: string,
		command: number,
	): HTMLButtonElement {
		const button = document.createElement('button');
		button.id = id;
		button.type = 'button';
		button.textContent = label;
		button.setAttribute('aria-label', label);

		button.addEventListener('pointerdown', (event: Event) => {
			event.preventDefault();
			event.stopPropagation();
		});
		button.addEventListener('pointerup', (event: PointerEvent) => {
			event.preventDefault();
			event.stopPropagation();
			if (button.disabled) return;
			if (!MobileSearchBar.releasedOn(button, event)) return;
			this.runReplace(command);
		});

		row.appendChild(button);
		return button;
	}

	/*
		Did the finger let go ON the button it pressed? Measured, not assumed:
		a touch pointer gets IMPLICIT pointer capture on its pointerdown
		target, so this listener fires even when the finger lifted two
		segments away. Same test, and the same reasoning, as
		Control.ImpressSelectionBar.releasedOn — the button is a >=44px finger
		target, so the box IS the slop and no tolerance is invented.
	*/
	private static releasedOn(button: HTMLElement, event: PointerEvent): boolean {
		const box = button.getBoundingClientRect();
		return (
			event.clientX >= box.left &&
			event.clientX <= box.right &&
			event.clientY >= box.top &&
			event.clientY <= box.bottom
		);
	}

	private searchTerm(): string {
		const input = document.getElementById('search-input') as HTMLInputElement;
		return input ? input.value : '';
	}

	/*
		Map.cancelSearch() clears the input programmatically, which does not emit
		an input event, and then disables cancelsearch through this toolbar API.
		Use that existing call to resync the separate replacement row without
		synthesizing an input event for the shared Writer/Calc search behavior.
	*/
	public enableItem(command: string, enable: boolean): void {
		super.enableItem(command, enable);
		if (command === 'cancelsearch' && !enable) {
			this.syncEnabled();
			// The ordinal needs the same hook for the same reason: a
			// programmatic clear emits no input event, so its own listener on
			// the field never fires and the count would outlive the term it
			// counted.
			this.clearOrdinal();
		}
	}

	private syncEnabled(): void {
		if (!this.replaceButtons) return;
		const usable = this.searchTerm() !== '' && this.map.isEditMode();
		for (const button of this.replaceButtons) {
			button.disabled = !usable;
			button.setAttribute('aria-disabled', usable ? 'false' : 'true');
		}
	}

	/*
		The same SearchService call the arrows already make
		(SearchService.ts:24-104), with the two parameters the four existing
		callers all leave defaulted: the replacement string, and the command.

		The guards are re-checked here rather than trusted to button.disabled,
		because a disabled attribute is a rendering fact and this is the
		destructive edge.
	*/
	private runReplace(command: number): void {
		const term = this.searchTerm();
		if (term === '') return;
		if (!this.map.isEditMode()) return;

		app.searchService.search(
			term,
			false,
			this.replaceInput ? this.replaceInput.value : '',
			command,
		);
	}
}

JSDialog.MobileSearchBar = function (map: any) {
	return new MobileSearchBar(map);
};
