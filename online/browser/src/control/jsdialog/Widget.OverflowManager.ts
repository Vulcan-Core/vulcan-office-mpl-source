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
 * JSDialog.OverflowManager - parent for OverflowGroup, coordinates it's behavior
 */

declare var JSDialog: any;

class OverflowManager {
	parentContainer: HTMLElement;
	data: ContainerWidgetJSON;
	lastMaxWidth: number = -1;
	scheduledRefresh: TaskId = '';
	initialSizeResizeObserver: ResizeObserver | null = null;

	constructor(parentContainer: Element, data: ContainerWidgetJSON) {
		this.parentContainer = parentContainer as HTMLElement;
		this.data = data;

		window.addEventListener('resize', this.onResize.bind(this));
		// A real resize while this container was hidden leaves it unmeasured
		// (onRefresh bails); the next bar refresh after it is shown re-folds it.
		window.addEventListener('refreshscrollables', this.onResize.bind(this));
		if (app.map) app.map.on('refreshoverflows', this.onRefresh, this);
		else app.console.error('OverflowManager: no app.map available');

		// In classic mode the first onRefresh can fire before the parent has
		// been laid out, leaving scrollWidth at 0 and every group folded.
		// Re-run once the container actually has a measurable width.
		if (typeof ResizeObserver !== 'undefined') {
			this.initialSizeResizeObserver = new ResizeObserver(() => {
				if (this.parentContainer.scrollWidth > 0) {
					this.initialSizeResizeObserver?.disconnect();
					this.initialSizeResizeObserver = null;
					this.onRefresh({ force: true } as Event & { force?: boolean });
				}
			});
			this.initialSizeResizeObserver.observe(this.parentContainer);
		}
	}

	calculateMaxWidth(): number {
		const margin = 20; // how many px more has to be visible after last widget
		let nextElement = this.parentContainer.nextSibling as HTMLElement;
		// floating right element after spacer
		if (nextElement && nextElement.classList.contains('ui-spacer'))
			nextElement = nextElement.nextSibling as HTMLElement;

		let nextElementPosition = nextElement ? nextElement.offsetLeft : 0;
		if (nextElementPosition <= 0)
			// is a last visible sibling
			nextElementPosition = this.parentContainer.offsetWidth + margin + 1;
		if (nextElementPosition > window.innerWidth)
			nextElementPosition = window.innerWidth;

		const startPosition = this.parentContainer.offsetLeft;
		let maxWidth = nextElementPosition - startPosition - margin;

		// Vulcan Office: in the merged floating chrome the classic row can no
		// longer grow past the bar (#toolbar-up clips/scrolls instead of
		// overflowing the window), so the next-sibling heuristic above
		// overestimates the budget: once the trailing per-doctype items that
		// live OUTSIDE the overflow groups (Impress appends layout /
		// animation / master-slides… after the spacer) are pushed out of the
		// row, their offsetLeft no longer describes usable space and nothing
		// folds. Additionally clamp to the real scrollport: the row's right
		// edge minus the width the tail actually needs. min() keeps the
		// upstream behavior whenever there is genuinely room (and leaves the
		// notebookbar, which has no #toolbar-up scrollport, untouched).
		const scrollport = this.parentContainer.closest(
			'#toolbar-up',
		) as HTMLElement;
		if (scrollport) {
			// The flex spacer between the groups and the tail is elastic: it
			// is as wide as the free space, so counting it made the budget
			// the container's own width minus the margin on every wide
			// window — and the last foldable group folded no matter how much
			// room there was. Only the tail's real items need their width.
			let tailWidth = 0;
			for (
				let el = this.parentContainer.nextElementSibling as HTMLElement;
				el;
				el = el.nextElementSibling as HTMLElement
			) {
				if (el.classList.contains('ui-spacer')) continue;
				tailWidth += el.getBoundingClientRect().width;
			}

			const portMax =
				scrollport.getBoundingClientRect().right -
				tailWidth -
				this.parentContainer.getBoundingClientRect().left -
				margin;
			maxWidth = Math.min(maxWidth, portMax);
		}

		return maxWidth;
	}

	hasOverflow(maxWidth: number): boolean {
		const requiredWidth = this.parentContainer.scrollWidth;
		app.console.debug(
			'overflow manager: "' +
				this.data.id +
				'" max: ' +
				maxWidth +
				' req: ' +
				requiredWidth,
		);

		// Width not known yet -> defer the decision. The ResizeObserver
		// installed in the constructor will retrigger onRefresh once the
		// container has been measured; folding now would leave every group
		// collapsed until the next window resize.
		if (requiredWidth === 0) return false;

		return maxWidth < requiredWidth;
	}

	onResize(event: Event) {
		// Ignore resize when the window size has not actually changed.
		if (this.lastMaxWidth === window.innerWidth) return;

		app.console.debug(
			'OverflowManager: onResize, scheduledRefresh = ' +
				(this.scheduledRefresh !== '' ? 'true' : 'false'),
		);
		this.lastMaxWidth = -1;

		if (this.scheduledRefresh !== '') {
			// collapse events
			app.layoutingService.cancelLayoutingTask(this.scheduledRefresh);
		}

		this.scheduledRefresh = app.layoutingService.appendLayoutingTask(() =>
			this.onRefresh(event),
		);
	}

	// sometimes we want to call it synchronously as it is already in the task (tab switch)
	onRefresh(event: Event & { force?: boolean }) {
		app.console.debug(
			'OverflowManager: onRefresh, force = ' + (event.force ? 'true' : 'false'),
		);
		this.scheduledRefresh = '';
		if (!this.parentContainer) return;
		if (!event.force && this.lastMaxWidth === window.innerWidth) return;

		// check our visibility
		let parentNode = this.parentContainer;
		while (parentNode) {
			if (parentNode?.classList?.contains('hidden')) return;

			parentNode = parentNode.parentNode as HTMLElement;
		}

		// Bail when any ancestor is display:none (e.g. notebookbar
		// collapsed via #toolbar-row). Measuring a hidden container
		// gives near-zero width, which would fold every group into the
		// hiddenItems wrapper and corrupt the layout that needs to be
		// restored when the notebookbar is shown again.
		if (this.parentContainer.offsetParent === null) return;

		this.lastMaxWidth = window.innerWidth;

		// nofold groups have no fold-button twin (Widget.OverflowGroup
		// skips it), so folding one would make its content unreachable.
		const groups = this.parentContainer.querySelectorAll(
			'.ui-overflow-group:not(.nofold)',
		);

		/*
		 * VULCAN: A REFRESH MUST NOT DESTROY AN OPEN MENU IT PUTS BACK.
		 *
		 * THE DEFECT. This pass unfolds every group to measure and then
		 * re-folds whatever overflows, and BOTH legs used to call
		 * `JSDialog.CloseDropdown(dropdownId)` -- fold and unfold each tear
		 * the group's menu down because items migrate between the bar and the
		 * popup. That is right when a group's state really changes. It is
		 * wrong here: unfold-measure-fold is a MEASUREMENT, and for every
		 * group that ends the pass exactly where it started nothing needed to
		 * close. Any resize therefore killed whichever dropdown the user had
		 * open, even when the resulting layout was identical.
		 *
		 * MEASURED (build 0b5fad08 -- the one production serves -- driven in
		 * Chromium): open the font-colour dropdown, then change the window
		 * width by THREE PIXELS. `onRefresh` -> `foldGroup` ->
		 * `JSDialog.CloseDropdown` fired for all five toolbar groups and the
		 * popup count went 1 -> 0 and stayed 0. That is the reported
		 * "it appears for a fraction of a second, sometimes, then
		 * disappears": in the real app a layout tick lands moments after the
		 * click, and it is intermittent precisely because it is a race
		 * between the click and the next reflow.
		 *
		 * THE FIX. Suppress the teardown for the duration of the measurement,
		 * then close only the menus whose group's fold state actually flipped
		 * across the pass -- which is the case the teardown exists for. A
		 * group that starts and ends collapsed keeps its menu, so a stray
		 * reflow is no longer able to take it.
		 */
		const collapsedBefore = new Map<OverflowGroupContainer, boolean>();
		groups.forEach((element: OverflowGroupContainer) => {
			collapsedBefore.set(
				element,
				typeof element.isCollapsed === 'function'
					? element.isCollapsed()
					: false,
			);
		});

		// first show all the groups
		groups.forEach((element: OverflowGroupContainer) => {
			if (typeof element.unfoldGroup === 'function')
				element.unfoldGroup(/* keepMenu */ true);
		});

		const maxWidth = this.calculateMaxWidth();

		// then hide required
		for (let i = groups.length - 1; i >= 0; i--) {
			const element: OverflowGroupContainer = groups[i];
			if (maxWidth >= 0 && this.hasOverflow(maxWidth)) {
				if (typeof element.foldGroup === 'function')
					element.foldGroup(/* keepMenu */ true);
			}
		}

		// Only a group that genuinely changed shape has a stale menu.
		groups.forEach((element: OverflowGroupContainer) => {
			const after =
				typeof element.isCollapsed === 'function'
					? element.isCollapsed()
					: false;
			if (after !== collapsedBefore.get(element) &&
				typeof element.closeMenu === 'function')
				element.closeMenu();
		});
	}
}

JSDialog.OverflowManager = function (
	parentContainer: Element,
	data: ContainerWidgetJSON,
	builder: JSBuilder,
) {
	parentContainer.classList.add('ui-overflow-manager');
	// Just create manager which will attach itself to the container and resize event.
	// Builder will process children as in regular container.
	new OverflowManager(parentContainer, data);
	app.console.debug('Create OverflowManager for: "' + data.id + '"');
	return true;
} as JSWidgetHandler;
