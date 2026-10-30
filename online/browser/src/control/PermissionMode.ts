/* -*- js-indent-level: 8 -*- */
/**
 * Copyright the Collabora Online contributors.
 *
 * SPDX-License-Identifier: MPL-2.0
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * PermissionMode.ts - Manages the Permission and View Mode UI
 *
 * This file owns the right-hand slot of the top chrome (#viewMode): what the
 * document says about its own permission state, and the save chip.
 *
 * ### THE MODE DROPDOWN IS GONE
 *
 * It used to be a two-item menubutton ("Viewing Mode" / "Editing Mode") shown
 * in every state but hard read-only. Nobody switches a document they are
 * editing back to viewing on purpose, so in the state where the dropdown was
 * shown most — EDITING — it was a menu whose only real entry was the one you
 * were already on, occupying the most valuable slot in the bar.
 *
 * That slot now carries the SAVE CHIP instead (Saving / Saved / Not saved / a
 * compact unsaved dot). The host owns the save state and pushes it in over
 * Vulcan_SetSaveState, because states like "acked by core but not yet
 * confirmed in WOPI storage" are host knowledge this frame does not have.
 * Same reasoning as the Share pill removed from this container before it:
 * what is removed is the BUTTON, not the capability — map.setPermission() is
 * untouched and the menubar/API paths still reach it.
 *
 * ### BUT VIEWING IS NOT ALWAYS A DEAD END, AND THIS IS THE TRAP
 *
 * Deleting the control outright strands desktop users. The dropdown was the
 * ONLY desktop route into edit mode from two states that start read-only but
 * ARE writable:
 *
 *   B  app.file.permission === 'edit' && _shouldStartReadOnly()
 *      — .csv and pdf-class extensions, server-configured view-mode formats,
 *        and ?startreadonly=true (Permission.js).
 *   C  app.file.permission === 'readonly' && wopi.UserCanWrite
 *      && map.options.canTryLock === true
 *      — a writer's session that wsd demoted because its WOPI lock failed
 *        ('perm: readonly' + 'lockfailed:'). This is the state's ONLY real
 *        member: CanvasTileLayer._mapOnError demotes the MAP to 'view' and
 *        leaves app.file.permission 'edit', which lands on the label below.
 *
 * State C is SERVER-enforced. The client cannot edit its way out of it: a
 * view flipped to editing here takes keystrokes that no save can ever bring
 * to storage (the 9/29 data loss). So in state C the button does not enter
 * edit mode -- it asks wsd for the lock (map.attemptEditLock -> attemptlock)
 * and reads "Getting edit access..." until wsd answers: 'perm: edit' enters
 * edit mode through Permission.setPermission, another 'lockfailed:' puts the
 * button back. With no retry allowed (canTryLock !== true) there is nothing
 * the button could do, so the session gets the inert label instead.
 *
 * The pencil FAB that covers this elsewhere is gated to small screens and
 * tablets (Permission.js), and the statusbar #PermissionMode badge is a text
 * label with no click handler. So those two states keep an affordance — but a
 * single-purpose "Edit" BUTTON rather than a two-item menu. One click instead
 * of a menu, and the pointless half of the selector is still gone.
 *
 * Only the genuinely stuck state — readonly with no write permission — is a
 * plain, inert "Viewing" label.
 *
 * ### AND, BESIDE IT, "TRACK AGENT EDITS"
 *
 * The slot Google Docs gives Editing / Suggesting. A per-FILE setting the
 * host owns: whether the agent's edits to this Word document arrive as
 * tracked changes (on) or go straight in (off, the default). It is NOT the
 * document's own Record flag (Edit > Track Changes > Record), which tracks a
 * person's typing; that stays where it is.
 *
 * The host decides everything and this frame decides nothing:
 *   host -> Vulcan_SetAgentEditMode { tracked, available }  (setAgentEditMode)
 *   click -> Vulcan_ToggleAgentEditMode { tracked: <requested> }
 * A click is a REQUEST for a state. The chip does not flip itself; it shows
 * what the host sends back (at once — the host writes optimistically — and
 * again if the write fails and rolls back). Hidden until the host says
 * `available`, so a host that never sends the message, or a spreadsheet, or a
 * reader who cannot edit, sees nothing.
 *
 * ### Guidelines:
 * - `updateReadonlyIndicator()` refreshes the slot from current permissions.
 * - `setSaveState(state)` and `setAgentEditMode(values)` are the host's entry
 *   points; both are safe to call before or without a successful
 *   setupContainer().
 */

declare var JSDialog: any;

class PermissionViewMode extends JSDialogComponent {
	viewModeContainer!: HTMLElement;
	readonlyIndicator!: HTMLElement;
	viewModeDropdown!: HTMLElement;
	saveChip?: HTMLElement;
	saveChipLabel?: HTMLElement;
	editButton?: HTMLElement;
	agentEditsChip?: HTMLButtonElement;
	/** Re-fits the chip's word when anything in the menu row changes size. */
	private agentEditsFit: ResizeObserver | null = null;
	/** State C: an attemptlock is out and wsd has not answered yet. */
	private lockAttemptPending = false;
	private lockAttemptTimer: ReturnType<typeof setTimeout> | null = null;
	/**
	 * wsd answers attemptlock with 'perm: edit' or 'lockfailed:', after one
	 * WOPI LOCK round trip. An image whose wsd never answers must not leave
	 * the button disabled for good: past this, the user may ask again.
	 */
	static readonly LOCK_ATTEMPT_TIMEOUT_MS = 30000;
	/** Last state the host pushed, replayed if the chip is built afterwards. */
	private pendingSaveState: string | null = null;
	/** Same, for the agent-edits chip. Hidden until the host says otherwise. */
	private agentEditMode: { tracked: boolean; available: boolean } = {
		tracked: false,
		available: false,
	};

	constructor(map: MapInterface) {
		super(map, 'PermissionViewMode', 'permission');
	}

	init(): void {
		this.setupContainer();
		if (this.viewModeContainer) {
			app.events.on(
				'updatepermission',
				this.updateReadonlyIndicator.bind(this),
			);
			this.updateReadonlyIndicator();
		}
	}

	// The notebookbar builder that used to live here existed only to build and
	// show the #shareAsContainer Share pill; both are gone (see setupContainer).
	/**
	 * No builder. JSDialogComponent declares createBuilder() abstract, so this
	 * has to exist — but the slot no longer holds a JSDialog widget at all: the
	 * mode menubutton is gone and the chip, the Edit button and the "Viewing"
	 * label are plain DOM (see setupContainer for why that matters). The base
	 * class guards every use with `if (!this.builder) return false`, so leaving
	 * it unset is the supported state, and constructing one we never route
	 * events through would just be a live object with no purpose.
	 */
	protected createBuilder(): void {
		// Intentionally empty — see above.
	}

	protected setupContainer(parentContainer?: HTMLElement): void {
		this.viewModeContainer = window.L.DomUtil.get('viewMode');
		if (!this.viewModeContainer) return;

		// Requested manual DOM structure for readonly mode indicator
		this.readonlyIndicator = window.L.DomUtil.create(
			'div',
			'unotoolbutton notebookbar ui-content unospan readonly inline hidden',
			this.viewModeContainer,
		);
		this.readonlyIndicator.id = 'readonlyMode';
		this.readonlyIndicator.setAttribute('tabindex', '-1');
		this.readonlyIndicator.setAttribute('data-cooltip', _('Permission Mode'));

		const label = window.L.DomUtil.create(
			'span',
			'ui-content unolabel',
			this.readonlyIndicator,
		);
		// "Viewing", not "Read-only": this indicator is now the ONLY thing shown
		// in the stuck state, so it says what the user is doing rather than
		// naming a permission bit.
		label.textContent = _('Viewing');

		this.viewModeDropdown = window.L.DomUtil.create(
			'div',
			'viewModeDropdown notebookbar',
			this.viewModeContainer,
		);
		this.viewModeDropdown.id = 'viewModeDropdown';

		// "Track agent edits" leads the slot, LEFT of the save chip. The save
		// chip's word changes width with every state (Saved / Saving / Not
		// saved), so anything after it would shift on each save; before it,
		// this control holds still. Built first for that reason. Plain DOM for
		// the same reason as the chip below.
		this.agentEditsChip = this.buildAgentEditsChip(this.viewModeDropdown);

		// PLAIN DOM, NOT A JSDIALOG WIDGET. JSDialogBuilder.updateWidget()
		// rebuilds a widget from scratch into a fragment and swaps it in, which
		// would destroy any host-pushed chip state on the next permission
		// change; both executeAction and updateWidget also defer through
		// app.layoutingService, so they are async relative to the
		// 'updatepermission' that triggered them. classList.toggle is
		// synchronous and survives.
		const saveChip: HTMLElement = window.L.DomUtil.create(
			'div',
			'vulcan-save-chip hidden',
			this.viewModeDropdown,
		);
		saveChip.setAttribute('role', 'status');
		saveChip.setAttribute('aria-live', 'polite');
		saveChip.setAttribute('aria-atomic', 'true');
		this.saveChip = saveChip;
		this.saveChipLabel = window.L.DomUtil.create(
			'span',
			'vulcan-save-chip-label',
			saveChip,
		);

		// The one surviving affordance: states B and C above, where the document
		// opens read-only but the user may write. One button, not a menu.
		const editButton: HTMLButtonElement = window.L.DomUtil.create(
			'button',
			'vulcan-edit-button hidden',
			this.viewModeDropdown,
		);
		this.editButton = editButton;
		editButton.setAttribute('type', 'button');
		editButton.accessKey = 'VM';
		editButton.textContent = _('Edit');
		editButton.addEventListener('click', () => {
			// State C (server read-only after a failed lock): ask wsd, never
			// enter edit mode here. See the header.
			if (app.isReadOnly()) {
				const map = this.map as any;
				if (typeof map.attemptEditLock === 'function') map.attemptEditLock();
				return;
			}
			if (typeof this.map._switchToEditMode === 'function')
				this.map._switchToEditMode();
			else this.map.setPermission('edit');
		});

		if (this.pendingSaveState !== null) this.setSaveState(this.pendingSaveState);
		this.setAgentEditMode(this.agentEditMode);
		this.watchAgentEditsFit();
		// No Share affordance is built here. #shareAsContainer — the pill this
		// class used to insert before #closebuttonwrapperseparator — is gone
		// from the fork chrome entirely, in every mode and on every surface.
		// Sharing is the HOST's concern: the embedding app draws its own share
		// control, and a second one in the document chrome was redundant. The
		// paths that hand off to that host UI (menubar File > Share..., the
		// Backstage share tile, Draw's File-tab ShareAs) are untouched — they
		// dispatch 'shareas' -> UI_Share postMessage and are how the host gets
		// asked. What is removed is the BUTTON, not the capability.

	}

	/**
	 * Host entry point (Vulcan_SetSaveState). Safe to call at any time: the
	 * host can push a state before init() has run, or when #viewMode is absent
	 * altogether and setupContainer() bailed — the value is held and replayed.
	 *
	 * `null`/'idle' is the host's "never modified this session", and it reads
	 * as SAVED: what is on screen is what is in storage, which is the same
	 * fact 'saved' states after a write. It used to show nothing, and that
	 * had two costs. The reader saw no status at all until their first
	 * keystroke ("Saving / Edited has disappeared"), and the chip's slot had
	 * no width until then, so the row laid itself out without it and the
	 * chip's arrival either pushed the search field or fell off the bar. A
	 * chip that is always there is a slot that is always budgeted.
	 */
	setSaveState(state: string | null): void {
		this.pendingSaveState = state;
		if (!this.saveChip || !this.saveChipLabel) return;

		// EVERY state says a word. The dirty state used to show a bare dot
		// with no label, which is the one state a reader most needs named: an
		// amber dot alone reads as a warning without saying what is wrong.
		// 'saving' already has its own word, so 'dirty' -- modified, not yet
		// being written -- is "Edited".
		const settled = state === null || state === 'idle' || state === 'saved';
		const label =
			state === 'saving' || state === 'unverified'
				? _('Saving')
				: settled
					? _('Saved')
					: state === 'save-failed'
						? _('Not saved')
						: state === 'dirty'
							? _('Edited')
							: null;

		this.saveChip.dataset.saveState = settled ? 'saved' : (state ?? 'idle');
		this.saveChipLabel.textContent = label ?? '';
		this.saveChip.classList.remove('is-dot');
		// Only an editing session shows it (updateReadonlyIndicator sets
		// is-permitted). The host keeps pushing while the slot says "Viewing"
		// or Edit; the state is held and shown when editing resumes.
		this.saveChip.classList.toggle(
			'hidden',
			!label || !this.saveChip.classList.contains('is-permitted'),
		);
	}

	/**
	 * The agent-edits chip:
	 *
	 *   <button type="button" class="vulcan-agent-edits-chip hidden"
	 *           aria-pressed="false" aria-label="Track agent edits"
	 *           data-cooltip="…">
	 *     <span class="vulcan-agent-edits-chip-glyph" aria-hidden="true"></span>
	 *     <span class="vulcan-agent-edits-chip-label">Track agent edits</span>
	 *   </button>
	 *
	 * A real <button> so it is in the tab order and Enter/Space press it, and
	 * aria-pressed because it is a toggle. The accessible name is set outright
	 * rather than left to the label text: when the menu row has no room the
	 * label is not drawn (fitAgentEditsChip) and the name must not go with it.
	 * The glyph is a CSS mask — the editor frame's content-security policy
	 * drops inline style attributes, so nothing here sets one.
	 */
	private buildAgentEditsChip(parent: HTMLElement): HTMLButtonElement {
		const chip: HTMLButtonElement = window.L.DomUtil.create(
			'button',
			'vulcan-agent-edits-chip hidden',
			parent,
		);
		chip.setAttribute('type', 'button');
		chip.setAttribute('aria-pressed', 'false');
		chip.setAttribute('aria-label', _('Track agent edits'));
		const glyph = window.L.DomUtil.create(
			'span',
			'vulcan-agent-edits-chip-glyph',
			chip,
		);
		glyph.setAttribute('aria-hidden', 'true');
		const label = window.L.DomUtil.create(
			'span',
			'vulcan-agent-edits-chip-label',
			chip,
		);
		label.textContent = _('Track agent edits');
		chip.addEventListener('click', () => {
			// Ask for the OTHER state, and name it: a request that carries
			// the wanted value cannot flip twice under a double click.
			this.map.fire('postMessage', {
				msgId: 'Vulcan_ToggleAgentEditMode',
				args: { tracked: !this.agentEditMode.tracked },
			});
		});
		// data-cooltip only shows once the tooltip control listens on the
		// element; guarded because the mocha rig has no L.control.
		if (
			window.L.control &&
			typeof window.L.control.attachTooltipEventListener === 'function'
		)
			window.L.control.attachTooltipEventListener(chip, this.map);
		return chip;
	}

	/**
	 * Host entry point (Vulcan_SetAgentEditMode). Safe to call at any time:
	 * the value is held and applied when the chip is built. Anything that is
	 * not a real boolean reads as false, so a malformed message hides the chip
	 * rather than showing a state nobody sent.
	 */
	setAgentEditMode(values: { tracked?: unknown; available?: unknown } | null): void {
		const tracked = !!values && values.tracked === true;
		const available = !!values && values.available === true;
		this.agentEditMode = { tracked, available };
		const chip = this.agentEditsChip;
		if (!chip) return;
		chip.classList.toggle('hidden', !available);
		chip.setAttribute('aria-pressed', tracked ? 'true' : 'false');
		chip.dataset.tracked = tracked ? 'true' : 'false';
		// The tooltip names the control AND says what its current state does:
		// the words on the chip cannot say the second, and in a row with no
		// room (fitAgentEditsChip) the chip has no words at all.
		chip.setAttribute(
			'data-cooltip',
			tracked
				? _('Track agent edits is on: the agent\'s edits arrive as tracked changes to accept or reject')
				: _('Track agent edits is off: the agent\'s edits go straight into the document'),
		);
		// Showing it is the moment the row is complete (the host only speaks
		// after Vulcan_Ready, when the menus, find field and presence strip
		// exist), so that is when to start watching what the row holds.
		// Hiding it is a ~150px change in the row either way.
		if (available) this.watchAgentEditsFit();
		this.fitAgentEditsChip();
	}

	/**
	 * The chip's WORD is the menu row's second give (theme §4b): the find
	 * field yields first, then this label, and only then do the menus scroll
	 * in their track.
	 *
	 * Measured, not a breakpoint. What else the row holds decides whether the
	 * word fits: the presence avatars (two people plus the agent, while it
	 * edits, is ~70px), the save chip's current word, the Edit button. A
	 * fixed width was right for one of those rows and wrong for the rest. So
	 * this lays the row out WITH the word and takes it away only if the row
	 * then overflows. Both steps are synchronous, so the browser never paints
	 * the in-between state.
	 */
	fitAgentEditsChip(): void {
		const chip = this.agentEditsChip;
		if (!chip) return;
		const nav = chip.closest('nav');
		const row = (nav && (nav.querySelector('#vulcan-menu-track') || nav)) as HTMLElement | null;
		chip.classList.remove('is-compact');
		// Not drawn (withdrawn, the phone chrome, no menu row): nothing to fit,
		// and the word stays on so the chip is whole whenever it is shown.
		const view = chip.ownerDocument.defaultView;
		if (!row || !view || chip.classList.contains('hidden')) return;
		if (view.getComputedStyle(chip).display === 'none') return;
		// Reading scrollWidth lays the row out with the word; 1px of slack
		// absorbs sub-pixel rounding between the two integer widths.
		if (row.scrollWidth - row.clientWidth > 1) chip.classList.add('is-compact');
	}

	/**
	 * Re-fit whenever the row, or something in it that can change width,
	 * resizes: the row itself (the window width), each of its other
	 * children and those of the menus' track (the menus, the presence strip
	 * as avatars come and go, Share), and, inside this slot, the save chip
	 * (Saved / Saving / Not saved) and the Edit button. NOT the find field,
	 * the track or this slot — the fit resizes them, and observing them
	 * would feed the fit its own output (and risk the browser's
	 * ResizeObserver loop error).
	 */
	private watchAgentEditsFit(): void {
		if (this.agentEditsFit) this.agentEditsFit.disconnect();
		this.agentEditsFit = null;
		const chip = this.agentEditsChip;
		const view: any = chip && chip.ownerDocument.defaultView;
		const Observer = view && view.ResizeObserver;
		if (!chip || typeof Observer !== 'function') return;
		const row = chip.closest('nav');
		if (!row) return;
		const track = row.querySelector('#vulcan-menu-track');
		const observer: ResizeObserver = new Observer(() => this.fitAgentEditsChip());
		observer.observe(row);
		const parts = Array.from(row.children).concat(track ? Array.from(track.children) : []);
		for (const child of parts) {
			if (child === track || child.contains(chip) || child.id === 'vulcan-find-box') continue;
			observer.observe(child);
		}
		if (this.saveChip) observer.observe(this.saveChip);
		if (this.editButton) observer.observe(this.editButton);
		this.agentEditsFit = observer;
	}

	/**
	 * State C's request in flight (Permission.attemptEditLock sets it; its
	 * answer, onLockFailed or the 'perm: edit' that enters edit mode, clears
	 * it). While pending the button says so and takes no second click.
	 */
	setLockAttemptPending(pending: boolean): void {
		if (this.lockAttemptTimer !== null) {
			clearTimeout(this.lockAttemptTimer);
			this.lockAttemptTimer = null;
		}
		this.lockAttemptPending = pending;
		if (pending)
			this.lockAttemptTimer = setTimeout(() => {
				this.lockAttemptTimer = null;
				this.setLockAttemptPending(false);
			}, PermissionViewMode.LOCK_ATTEMPT_TIMEOUT_MS);
		this.updateReadonlyIndicator();
	}

	updateReadonlyIndicator(): void {
		// Safety check for map methods which might be missing in some contexts
		const isEditMode = this.map.isEditMode ? this.map.isEditMode() : false;
		const shouldStartReadOnly = this.map._shouldStartReadOnly
			? this.map._shouldStartReadOnly()
			: false;

		// Three outcomes now, not two:
		//   editing            -> the save chip (nothing else)
		//   viewing, writable  -> the Edit button (states B and C in the header)
		//   viewing, stuck     -> the inert "Viewing" label
		//
		// `showReadonly` keeps its name deliberately: ChromeHasNoShareButton's
		// source-text guard looks for that identifier to prove the read-only
		// path survived the Share removal, and renaming it broke that suite
		// while changing nothing about behaviour.
		let showSaveChip = false;
		let showEdit = false;
		let showReadonly = false;

		if (isEditMode) {
			showSaveChip = true;
		} else if (app.file.permission === 'edit' && shouldStartReadOnly) {
			showEdit = true;
		} else if (app.file.permission === 'readonly') {
			// State C: only while wsd allows a lock retry. See the header.
			showEdit = Boolean(
				this.map['wopi'] &&
					this.map['wopi'].UserCanWrite &&
					this.map.options &&
					this.map.options.canTryLock === true,
			);
			showReadonly = !showEdit;
		} else {
			// Unknown permission: offer nothing rather than a button that may
			// not work. The menubar route still exists.
			showReadonly = true;
		}

		if (this.readonlyIndicator)
			this.readonlyIndicator.classList.toggle('hidden', !showReadonly);
		// A request can only be pending while its button is up: editing (the
		// lock was granted) or any other state ends it.
		if (!showEdit && this.lockAttemptPending) {
			this.lockAttemptPending = false;
			if (this.lockAttemptTimer !== null) {
				clearTimeout(this.lockAttemptTimer);
				this.lockAttemptTimer = null;
			}
		}
		if (this.editButton) {
			const button = this.editButton as HTMLButtonElement;
			button.classList.toggle('hidden', !showEdit);
			button.textContent = this.lockAttemptPending
				? _('Getting edit access…')
				: _('Edit');
			button.disabled = this.lockAttemptPending;
			if (this.lockAttemptPending) button.setAttribute('aria-busy', 'true');
			else button.removeAttribute('aria-busy');
		}
		if (this.saveChip) {
			// The chip's own state decides whether it has anything to say; the
			// permission only decides whether it is allowed to speak at all.
			this.saveChip.classList.toggle('is-permitted', showSaveChip);
			if (!showSaveChip) this.saveChip.classList.add('hidden');
			else this.setSaveState(this.pendingSaveState);
		}
	}
}
