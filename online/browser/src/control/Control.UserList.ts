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
 * window.L.Control.UserList
 */
/* global app */

interface UserExtraInfo {
	avatar: string;
	// Vulcan: the host marks agent sessions in UserExtraInfo so the roster
	// can style/count them separately from humans.
	vulcan_agent?: boolean;
}

interface User {
	username: string;
	extraInfo: UserExtraInfo;
	color: string;
	readonly: boolean;
	you: boolean;
	// Vulcan: WOPI UserId — stable person identity across that person's
	// sessions (views). Absent on hosts that don't send it.
	userid?: string;
	isAgent?: boolean;
	cachedHeaderAvatar?: HTMLImageElement;
	cachedUserListAvatar?: HTMLImageElement;
}

interface UserEvent {
	viewId: number;
	username: string;
	extraInfo: UserExtraInfo;
	readonly: boolean;
	userid?: string;
}

// Vulcan: one PERSON (grouped by WOPI UserId) owning one or more sessions.
// The roster renders persons; the internal `users` Map stays keyed by viewId
// so follow-user keeps working on concrete views.
interface Person {
	key: string;
	sessions: [number, User][];
	// Representative view: for you, this tab's own view; for anyone else,
	// their most-recent writable view (falls back to their most-recent view
	// when all are readonly).
	primary: [number, User];
	isAgent: boolean;
	you: boolean;
}

// Vulcan: what the roster says about a person's last move.
interface PersonActivity {
	active: boolean;
	label: string;
}

class UserList extends window.L.Control {
	options: {
		userLimitHeader: number;
		userLimitHeaderWhenFollowing: number;
		userPopupTimeout: null | ReturnType<typeof setTimeout>;
		userJoinedPopupMessage: string;
		userLeftPopupMessage: string;
		followingChipTextUser: string;
		followingChipTextEditor: string;
		followingChipTooltipText: string;
		userAvatarAlt: string;
		nUsers?: string;
		oneUser?: string;
		noUser?: string;
		dropdownId: string;
	} = {
		userLimitHeader: 6,
		userLimitHeaderWhenFollowing: 3,
		userPopupTimeout: null,
		userJoinedPopupMessage: _('{user} has joined'),
		userLeftPopupMessage: _('{user} has left'),
		followingChipTextUser: _('Following {user}'),
		followingChipTextEditor: _('Following the editor'),
		followingChipTooltipText: _('Stop following'),
		userAvatarAlt: _('Avatar for {user}'),
		nUsers: undefined,
		oneUser: undefined,
		noUser: undefined,
		dropdownId: 'userlist',
	};

	users: Map<number, User> = new Map();

	// Vulcan: a person reads "Active now" for this long after any
	// of their views last moved a cursor or a selection.
	static readonly ACTIVE_WINDOW_MS = 2 * 60 * 1000;
	// While the avatar strip is shown, "Active 6m ago" ages on this tick.
	static readonly ACTIVITY_TICK_MS = 30 * 1000;

	// When each other view last moved (Date.now() ms).
	lastActive: Map<number, number> = new Map();
	// Each view's last cursor/selection message, per message type.
	private lastViewMessages: Map<number, Map<string, string>> = new Map();
	private activityTick: ReturnType<typeof setInterval> | null = null;
	// The activity labels the strip and the list last showed.
	private renderedActivity = '';

	onAdd(map: any) {
		this.map = map;

		map.on('addview', this.onAddView, this);
		map.on('removeview', this.onRemoveView, this);
		map.on('deselectuser', this.deselectUser, this);

		if (window.mode.isSmallScreenDevice() || window.mode.isTablet()) {
			this.options.nUsers = '%n';
			this.options.oneUser = '1';
			this.options.noUser = '0';
		} else {
			this.options.nUsers = _('%n users');
			this.options.oneUser = _('1 user');
			this.options.noUser = _('0 users');
		}

		const userListElement = document.getElementById('userListSummaryButton');
		userListElement.setAttribute('aria-label', _('User List Summary'));
		userListElement.setAttribute('aria-haspopup', 'menu');
		userListElement.setAttribute('aria-expanded', 'false');
		userListElement.setAttribute('aria-controls', 'userlist-dropdown');
		(userListElement as any)._onDropDown = (open: boolean) => {
			userListElement.setAttribute('aria-expanded', String(open));
		};

		this.registerHeaderAvatarEvents();
	}

	selectUser(viewId: number) {
		const user = this.users.get(viewId);

		if (user === undefined) {
			console.debug("User doesn't exist: " + viewId);
			return;
		}

		this.renderAll();
	}

	getFollowedUser(): undefined | [number, User] {
		const followedId = app.getFollowedViewId();
		const myViewId =
			this.map && this.map._docLayer && this.map._docLayer._viewId;

		if (
			myViewId === followedId ||
			followedId === -1 ||
			!app.isFollowingUser()
		) {
			return undefined;
		}

		const followedUser = this.users.get(followedId);

		if (followedUser === undefined) {
			return undefined;
		}

		return [followedId, followedUser];
	}

	unfollowAll() {
		app.setFollowingOff();
	}

	followUser(viewId: number, instantJump: boolean = true) {
		const myViewId = this.map._docLayer._viewId;
		const followingViewId = app.getFollowedViewId();
		const followMyself = viewId === myViewId;

		if (followingViewId === viewId) return;

		app.setFollowingUser(viewId);

		if (followMyself) {
			this.map._setFollowing(true, myViewId, instantJump);
		} else if (viewId !== -1) {
			this.map._setFollowing(true, viewId, instantJump);
		} else {
			this.unfollowAll();
			this.map._setFollowing(false, -1);
		}

		this.selectUser(viewId);
	}

	createAvatar(
		cachedElement: HTMLImageElement | undefined,
		viewId: number,
		username: string,
		extraInfo: UserExtraInfo,
		color: string,
		zIndex?: number | 'auto',
	) {
		if (zIndex === undefined) {
			zIndex = 'auto';
		}

		let img = cachedElement;

		if (img === undefined) {
			img = window.L.DomUtil.create('img', 'avatar-img') as HTMLImageElement;
		}

		app.LOUtil.setUserImage(img, this.map, viewId);

		img.alt = this.options.userAvatarAlt.replace('{user}', username);

		img.style.zIndex = zIndex.toString();
		img.style.borderColor = color;
		img.style.backgroundColor = 'var(--color-background-lighter)';

		img.setAttribute('data-view-id', viewId.toString());

		return img;
	}

	getUserItem(
		viewId: number,
		username: string,
		extraInfo: UserExtraInfo,
		color: string,
	) {
		var content = window.L.DomUtil.create('tr', 'useritem');
		content.id = 'user-' + viewId;
		$(document).on(
			'click',
			'#' + content.id,
			this.onUseritemClicked.bind(this),
		);

		var iconTd = window.L.DomUtil.create('td', 'usercolor', content);
		var nameTd = window.L.DomUtil.create('td', 'username cool-font', content);

		const avatarElement = this.createAvatar(
			undefined,
			viewId,
			username,
			extraInfo,
			color,
		);
		iconTd.appendChild(avatarElement);
		nameTd.textContent = username;

		return content;
	}

	openDropdown() {
		const userListSummary = document.getElementById(
			'userListSummaryBackground',
		);
		const userListPopover = JSDialog.GetDropdown(this.options.dropdownId);
		// checking case ''(empty string) is because when element loads first time it does not have any inline display style
		const canShowDropdown =
			!userListPopover &&
			userListSummary &&
			userListSummary.style.display !== 'none';
		if (canShowDropdown) {
			JSDialog.OpenDropdown(
				this.options.dropdownId,
				document.getElementById('userListSummaryButton'),
				JSDialog.MenuDefinitions.get('UsersListMenu'),
			);
		} else {
			app.console.debug('UserList: already opened');
		}
	}

	registerHeaderAvatarEvents() {
		document.getElementById('userListSummaryButton').addEventListener(
			'click',
			function (e: MouseEvent) {
				e.stopPropagation();
				this.openDropdown();
			}.bind(this),
		);
	}

	hideUserList() {
		return (
			(window as any) /* TODO: remove cast after gh#8221 */.ThisIsAMobileApp ||
			(this.map['wopi'].HideUserList !== null &&
				this.map['wopi'].HideUserList !== undefined &&
				$.inArray('true', this.map['wopi'].HideUserList) >= 0) ||
			(window.mode.isSmallScreenDevice() &&
				$.inArray('mobile', this.map['wopi'].HideUserList) >= 0) ||
			(window.mode.isTablet() &&
				$.inArray('tablet', this.map['wopi'].HideUserList) >= 0) ||
			(window.mode.isDesktop() &&
				$.inArray('desktop', this.map['wopi'].HideUserList) >= 0)
		);
	}

	getSortedUsers(): Generator<[number, User], undefined, undefined> {
		return function* (
			this: UserList,
		): Generator<[number, User], undefined, undefined> {
			const self = this.users.get(this.map._docLayer._viewId);

			if (this.users.get(this.map._docLayer._viewId) === undefined) {
				return;
			}

			const followedUser = this.getFollowedUser();

			if (followedUser !== undefined) {
				yield followedUser;
			}

			yield [this.map._docLayer._viewId, self];

			const readonlyUsers: [number, User][] = [];

			for (const [viewId, user] of Array.from(this.users.entries()).reverse()) {
				const isSelf = viewId === this.map._docLayer._viewId;
				const isFollowed =
					followedUser !== undefined && viewId === followedUser[0];
				if (isSelf || isFollowed) {
					continue;
				}

				if (user.readonly) {
					readonlyUsers.push([viewId, user]);
					continue;
				}

				yield [viewId, user];
			}

			yield* readonlyUsers;
		}.bind(this)();
	}

	// Vulcan person-grouping helpers ------------------------------------

	personKeyFor(viewId: number, user: User): string {
		// Fall back to a per-view key when the host sends no UserId, which
		// degrades to the old one-entry-per-view roster.
		return user.userid !== undefined &&
			user.userid !== null &&
			user.userid !== ''
			? 'uid:' + user.userid
			: 'view:' + viewId;
	}

	// Persons in display order: humans first (in getSortedUsers order:
	// followed, you, editors, readonly), agents after all humans.
	getSortedPersons(): Person[] {
		const persons = new Map<string, Person>();

		for (const [viewId, user] of this.getSortedUsers()) {
			const key = this.personKeyFor(viewId, user);
			let person = persons.get(key);
			if (person === undefined) {
				person = {
					key: key,
					sessions: [],
					primary: [viewId, user],
					isAgent: user.isAgent === true,
					you: false,
				};
				persons.set(key, person);
			}
			person.sessions.push([viewId, user]);
			person.you = person.you || user.you;
			person.isAgent = person.isAgent && user.isAgent === true;
		}

		const myViewId = this.map._docLayer._viewId;
		for (const person of persons.values()) {
			// Your own row stands for THIS tab, whatever your other tabs
			// are: it reads "You", and a click on it follows you.
			const own = person.sessions.find(([viewId]) => viewId === myViewId);
			if (own !== undefined) {
				person.primary = own;
				continue;
			}
			const writable = person.sessions.filter(
				([, user]) => !user.readonly,
			);
			const pool = writable.length > 0 ? writable : person.sessions;
			// viewIds are allocated monotonically, so the highest viewId is
			// the person's most recent session.
			person.primary = pool.reduce((a, b) => (b[0] > a[0] ? b : a));
		}

		const all = Array.from(persons.values());
		return all
			.filter((person) => !person.isAgent)
			.concat(all.filter((person) => person.isAgent));
	}

	// Vulcan activity ----------------------------------------

	// A cursor or selection message from another view (CanvasTileLayer).
	// Only a CHANGE is that person doing something: the first message of
	// each type is where their cursor already was when we met them (the
	// burst a join brings), a repeat of the last one is a replay (zoom,
	// sheet switch) or a resend, and a caret pushed down the page by
	// somebody else's edit did not move itself.
	noteViewMessage(viewId: number, textMsg: string): void {
		// A view that left still sends its cleared cursor ("EMPTY") after
		// the roster dropped it.
		if (!this.users.has(viewId)) return;
		const type = textMsg.substring(0, textMsg.indexOf(':'));
		let seen = this.lastViewMessages.get(viewId);
		if (seen === undefined) {
			seen = new Map();
			this.lastViewMessages.set(viewId, seen);
		}
		const previous = seen.get(type);
		seen.set(type, textMsg);
		if (previous === undefined || previous === textMsg) return;
		if (
			(type === 'invalidateviewcursor' || type === 'textviewselection') &&
			UserList.isVerticalPush(previous, textMsg)
		) {
			return;
		}
		this.noteViewActivity(viewId);
	}

	// Writer moves every caret and text selection below an edit up or down
	// the page when lines are added or removed above it. Such a message
	// differs from the last one only in that all its rectangles moved by
	// one vertical offset. (Not for Calc's cell cursor: Enter moves it the
	// same way.)
	static isVerticalPush(previous: string, next: string): boolean {
		const before = UserList.viewRects(previous);
		const after = UserList.viewRects(next);
		if (
			before === null ||
			after === null ||
			before.rest !== after.rest ||
			before.rects.length !== after.rects.length
		) {
			return false;
		}
		const dy = after.rects[0][1] - before.rects[0][1];
		return (
			dy !== 0 &&
			before.rects.every((rect, i) => {
				const moved = after.rects[i];
				return (
					moved[0] === rect[0] &&
					moved[1] - rect[1] === dy &&
					moved[2] === rect[2] &&
					moved[3] === rect[3]
				);
			})
		);
	}

	// The "x, y, w, h; ..." rectangles of a view cursor or text selection
	// message, and the rest of the message as a comparable string.
	private static viewRects(
		textMsg: string,
	): { rects: number[][]; rest: string } | null {
		let payload: any;
		try {
			payload = JSON.parse(textMsg.substring(textMsg.indexOf(':') + 1));
		} catch (e) {
			return null;
		}
		const key =
			typeof payload.rectangle === 'string'
				? 'rectangle'
				: typeof payload.selection === 'string'
					? 'selection'
					: null;
		if (key === null) return null;
		const rects = (payload[key] as string)
			.split(';')
			.map((rect) => rect.split(',').map((n) => parseInt(n, 10)));
		if (rects.some((rect) => rect.length !== 4 || rect.some(isNaN))) {
			return null;
		}
		delete payload[key];
		return { rects: rects, rest: JSON.stringify(payload) };
	}

	noteViewActivity(viewId: number): void {
		const now = Date.now();
		const previous = this.lastActive.get(viewId);
		this.lastActive.set(viewId, now);
		// A view that was already active changes no label: it still reads
		// "Active now". Only a move after a quiet spell (or the first one)
		// can, so typing never re-renders the roster.
		if (
			previous === undefined ||
			now - previous >= UserList.ACTIVE_WINDOW_MS
		) {
			this.refreshActivity();
		}
	}

	// null until the person's first move, and always null for you.
	personActivity(person: Person, now: number): PersonActivity | null {
		if (person.you) return null;
		let last: number | undefined;
		for (const [viewId] of person.sessions) {
			const seen = this.lastActive.get(viewId);
			if (seen !== undefined && (last === undefined || seen > last)) {
				last = seen;
			}
		}
		if (last === undefined) return null;
		const age = now - last;
		if (age < UserList.ACTIVE_WINDOW_MS) {
			return { active: true, label: _('Active now') };
		}
		const minutes = Math.floor(age / 60000);
		const label =
			minutes < 60
				? _('Active %nm ago').replace('%n', minutes.toString())
				: _('Active %nh ago').replace('%n', Math.floor(minutes / 60).toString());
		return { active: false, label: label };
	}

	private activitySignature(persons: Person[], now: number): string {
		return persons
			.map((person) => {
				const activity = this.personActivity(person, now);
				return person.key + '=' + (activity ? activity.label : '');
			})
			.join('|');
	}

	// Re-render only when a label on screen would read differently.
	refreshActivity(): void {
		const signature = this.activitySignature(
			this.getSortedPersons(),
			Date.now(),
		);
		if (signature !== this.renderedActivity) this.renderAll();
	}

	private setActivityTick(running: boolean): void {
		if (running && this.activityTick === null) {
			this.activityTick = setInterval(
				() => this.refreshActivity(),
				UserList.ACTIVITY_TICK_MS,
			);
		} else if (!running && this.activityTick !== null) {
			clearInterval(this.activityTick);
			this.activityTick = null;
		}
	}

	// Does any OTHER view than skipViewId belong to the same person?
	private personHasOtherSessions(key: string, skipViewId: number): boolean {
		for (const [viewId, user] of this.users.entries()) {
			if (viewId === skipViewId) continue;
			if (this.personKeyFor(viewId, user) === key) return true;
		}
		return false;
	}

	renderHeaderAvatars() {
		const userListElementBackground = document.getElementById(
			'userListSummaryBackground',
		);
		const userListElement = document.getElementById('userListSummaryButton');

		// Vulcan: the strip shows PERSONS (grouped sessions), so a person
		// with two open views is one avatar and "just me in two tabs" hides
		// the strip entirely.
		const persons = this.getSortedPersons();

		if (
			window.mode.isSmallScreenDevice() ||
			this.hideUserList() ||
			persons.length <= 1
		) {
			userListElement.removeAttribute('accesskey');
			userListElementBackground.style.display = 'none';
			this.setActivityTick(false);
			return;
		}

		let displayCount: number;

		if (this.getFollowedUser() === undefined && !app.isFollowingEditor()) {
			displayCount = this.options.userLimitHeader;
		} else {
			displayCount = this.options.userLimitHeaderWhenFollowing;
		}

		// The human userLimit only budgets humans; agents render after them
		// and never displace a human avatar.
		const humans = persons.filter((person) => !person.isAgent);
		const agents = persons.filter((person) => person.isAgent);
		const avatarPersons = humans.slice(0, displayCount).concat(agents);
		const followed = this.getFollowedUser();

		userListElement.setAttribute('accesskey', 'UP');

		const now = Date.now();
		userListElement.replaceChildren(
			...avatarPersons.map((person, index) => {
				const [viewId, user] = person.primary;
				const img = this.createAvatar(
					user.cachedHeaderAvatar,
					viewId,
					user.username,
					user.extraInfo,
					user.color,
					avatarPersons.length - index,
				);
				user.cachedHeaderAvatar = img;

				img.classList.toggle('vulcan-agent-avatar', person.isAgent);

				const followedIsThisPerson =
					followed !== undefined &&
					person.sessions.some(([sessionViewId]) => {
						return sessionViewId === followed[0];
					});
				if (followedIsThisPerson) {
					img.classList.add('following');
				} else {
					img.classList.remove('following');
				}

				const activity = this.personActivity(person, now);
				img.classList.toggle(
					'vulcan-inactive',
					activity !== null && !activity.active,
				);
				if (activity !== null) {
					img.title = user.username + ' · ' + activity.label;
				} else {
					img.removeAttribute('title');
				}

				return img;
			}),
		);

		userListElementBackground.style.display = 'block';
		this.setActivityTick(true);
	}

	updateUserListCount() {
		// Vulcan: count distinct persons, humans and agents separately
		// ("2 users · 1 agent"), instead of raw session views.
		const persons = this.getSortedPersons();
		const humanCount = persons.filter((person) => !person.isAgent).length;
		const agentCount = persons.length - humanCount;

		let text = '';
		if (humanCount > 1) {
			text = this.options.nUsers.replace('%n', humanCount.toString());
		} else if (humanCount === 1) {
			text = this.options.oneUser;
		} else {
			text = this.options.noUser;
		}

		if (agentCount > 0) {
			const agentText =
				agentCount === 1
					? _('1 agent')
					: _('%n agents').replace('%n', agentCount.toString());
			text = text + ' · ' + agentText;
		}

		const userListElement = document.getElementById('userListSummaryButton');
		if (userListElement) {
			userListElement.setAttribute('data-cooltip', text);
			userListElement.setAttribute(
				'aria-label',
				_('User List Summary') + ' — ' + text,
			);
		}

		if (this.map.mobileTopBar) {
			if (!this.hideUserList() && persons.length > 1)
				this.map.mobileTopBar.showItem('userlist', true);
			else this.map.mobileTopBar.showItem('userlist', false);
		}
	}

	deselectUser(e: UserEvent) {
		const user = this.users.get(e.viewId);

		if (user === undefined) {
			console.debug("User doesn't exist: " + e.viewId);
			return;
		}

		this.renderAll();
	}

	onAddView(e: UserEvent) {
		let color;
		let username;
		let you;

		if (e.viewId === this.map._docLayer._viewId) {
			username = _('You');
			color = 'var(--color-main-text)';
			you = true;
		} else {
			username = e.username;
			color = app.LOUtil.rgbToHex(this.map.getViewColor(e.viewId));
			you = false;
		}

		const user: User = {
			you: you,
			username: username,
			extraInfo: e.extraInfo,
			color: color,
			readonly: e.readonly,
			userid: e.userid,
			isAgent:
				(e.extraInfo && e.extraInfo.vulcan_agent === true) ||
				(e as any).isAgent === true,
		};

		// Vulcan: announce a PERSON only on their first session joining —
		// a second tab/view of someone already here is not a "join".
		const personKey = this.personKeyFor(e.viewId, user);
		const personAlreadyPresent = this.personHasOtherSessions(
			personKey,
			e.viewId,
		);

		this.users.set(e.viewId, user);

		if (!personAlreadyPresent) {
			this.showJoinLeaveMessage('join', e.viewId, username, color);
		}

		this.renderAll();
	}

	onRemoveView(e: UserEvent) {
		const user = this.users.get(e.viewId);
		this.users.delete(e.viewId);
		this.lastActive.delete(e.viewId);
		this.lastViewMessages.delete(e.viewId);

		if (e.viewId === app.getFollowedViewId()) {
			this.unfollowAll();
		}

		if (user !== undefined) {
			// Vulcan: announce a leave only when the PERSON's last session
			// closed — closing one of two tabs is not a "leave".
			const personKey = this.personKeyFor(e.viewId, user);
			if (!this.personHasOtherSessions(personKey, e.viewId)) {
				this.showJoinLeaveMessage(
					'leave',
					e.viewId,
					user.username,
					user.color,
				);
			}
		}

		this.renderAll();
	}

	renderAll() {
		this.renderedActivity = this.activitySignature(
			this.getSortedPersons(),
			Date.now(),
		);
		this.updateUserListCount();
		this.renderHeaderAvatars();
		const popoverElement = document.getElementById(
			JSDialog.CreateDropdownEntriesId(this.options.dropdownId),
		);
		if (popoverElement) this.renderHeaderAvatarPopover(popoverElement);
		this.renderFollowingChip();
	}

	showTooltip(text: string) {
		const userList = $('#userListHeader');
		if (userList) {
			userList.get(0).title = text;
			userList.tooltip({
				content: text,
			});
			userList.tooltip('enable');
			userList.tooltip('open');
		}
	}

	hideTooltip() {
		const userList = $('#userListHeader');
		if (userList) {
			userList.get(0).title = undefined;
			userList.tooltip('option', 'disabled', true);
		}
		// Vulcan: disabling the jQuery UI tooltip strips `title` from every
		// element inside #userListHeader, so the strip's avatars would lose
		// "Ada · Active 6m ago" until the next label change. Put them back.
		this.renderHeaderAvatars();
	}

	showJoinLeaveMessage(
		type: 'join' | 'leave',
		viewId: number,
		username: string, // As the user no longer exists when we are showing a leave message, we can't get this from the viewId
		_color: string /* TODO: make this display in user colors */,
	) {
		let message;

		if (viewId === this.map._docLayer._viewId) {
			return;
		}

		if (type === 'join') {
			message = this.options.userJoinedPopupMessage.replace('{user}', username);
		} else {
			message = this.options.userLeftPopupMessage.replace('{user}', username);
		}

		const sanitizer = document.createElement('div');
		sanitizer.innerText = message;

		this.showTooltip(sanitizer.innerHTML);

		clearTimeout(this.options.userPopupTimeout);
		this.options.userPopupTimeout = setTimeout(() => {
			this.hideTooltip();
		}, 3000);
	}

	renderHeaderAvatarPopover(popoverElement: Element) {
		// Popover rendering
		const focusedInside =
			document.activeElement && popoverElement.contains(document.activeElement)
				? (document.activeElement as HTMLElement)
				: null;
		const activeViewId = focusedInside?.getAttribute('data-view-id') ?? null;
		const focusedFollowEditor = focusedInside?.id === 'follow-editor';

		// Vulcan: one row per PERSON; clicking follows the person's
		// most-recent writable view (their primary session).
		const persons = this.getSortedPersons();

		const following = this.getFollowedUser();
		const now = Date.now();

		const userElements = persons.map((person, rowIndex) => {
			const [viewId, user] = person.primary;
			const userLabel = window.L.DomUtil.create('div', 'user-list-item--name');
			userLabel.innerText = user.username;
			const activity = this.personActivity(person, now);

			const userFollowingLabel = window.L.DomUtil.create(
				'div',
				'user-list-item--following-label',
			);
			userFollowingLabel.innerText = _('Following');

			const userLabelContainer = window.L.DomUtil.create(
				'div',
				'user-list-item--name-container',
			);
			userLabelContainer.appendChild(userLabel);
			if (activity !== null) {
				const activityLabel = window.L.DomUtil.create(
					'div',
					'user-list-item--activity',
				);
				activityLabel.textContent = activity.label;
				userLabelContainer.appendChild(activityLabel);
			}
			userLabelContainer.appendChild(userFollowingLabel);

			const listItem = window.L.DomUtil.create('div', 'user-list-item');
			listItem.setAttribute('data-view-id', viewId);
			listItem.setAttribute('role', 'button');
			listItem.setAttribute('tabindex', '0');
			// JSDialog.KeyboardGridNavigation reads row:col from `index` to move
			// focus on ArrowUp/ArrowDown - without it getRowColumn returns
			// [-1,-1] and arrows do nothing.
			listItem.setAttribute('index', rowIndex + ':0');

			if (person.isAgent) {
				listItem.classList.add('vulcan-agent-item');
			}

			const followedIsThisPerson =
				following !== undefined &&
				person.sessions.some(([sessionViewId]) => {
					return sessionViewId === following[0];
				});
			if (followedIsThisPerson) {
				$(listItem).addClass('selected-user');
			}

			const avatar = this.createAvatar(
				user.cachedUserListAvatar,
				viewId,
				user.username,
				user.extraInfo,
				user.color,
			);
			avatar.alt = '';
			avatar.setAttribute('aria-hidden', 'true');
			avatar.classList.toggle('vulcan-agent-avatar', person.isAgent);
			avatar.classList.toggle(
				'vulcan-inactive',
				activity !== null && !activity.active,
			);
			user.cachedUserListAvatar = avatar;

			listItem.appendChild(avatar);
			listItem.appendChild(userLabelContainer);

			// N-sessions badge: a person in several tabs is still one row.
			if (person.sessions.length > 1) {
				const sessionBadge = window.L.DomUtil.create(
					'span',
					'user-list-item--session-count',
				);
				sessionBadge.textContent = person.sessions.length.toString();
				sessionBadge.title = _('%n sessions').replace(
					'%n',
					person.sessions.length.toString(),
				);
				listItem.appendChild(sessionBadge);
			}

			const activate = () => {
				this.followUser(viewId);
				JSDialog.CloseDropdown(this.options.dropdownId);
			};
			listItem.addEventListener('click', activate);
			listItem.addEventListener('keydown', (e: KeyboardEvent) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					activate();
				}
			});

			return listItem;
		});

		const followEditorWrapper = window.L.DomUtil.create('div', '');
		followEditorWrapper.id = 'follow-editor';
		followEditorWrapper.setAttribute('role', 'checkbox');
		followEditorWrapper.setAttribute('tabindex', '0');
		followEditorWrapper.setAttribute('index', persons.length + ':0');
		followEditorWrapper.setAttribute(
			'aria-label',
			_('Always follow the editor'),
		);
		followEditorWrapper.setAttribute(
			'aria-checked',
			String(app.isFollowingEditor()),
		);

		const followEditorCheckbox = window.L.DomUtil.create(
			'input',
			'follow-editor-checkbox jsdialog ui-checkbox',
			followEditorWrapper,
		);
		followEditorCheckbox.id = 'follow-editor-checkbox';
		followEditorCheckbox.setAttribute('type', 'checkbox');
		followEditorCheckbox.setAttribute('tabindex', '-1');
		followEditorCheckbox.setAttribute('aria-hidden', 'true');
		followEditorCheckbox.onchange = (event: Event) => {
			(window as any).editorUpdate(event);
			this.renderAll();
		};
		(followEditorCheckbox as HTMLInputElement).checked =
			app.isFollowingEditor();

		followEditorWrapper.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === ' ' || e.key === 'Enter') {
				e.preventDefault();
				(followEditorCheckbox as HTMLInputElement).click();
			}
		});

		const followEditorCheckboxLabel = window.L.DomUtil.create(
			'label',
			'follow-editor-label',
			followEditorWrapper,
		);
		followEditorCheckboxLabel.innerText = _('Always follow the editor');
		followEditorCheckboxLabel.setAttribute('for', 'follow-editor-checkbox');
		followEditorCheckboxLabel.setAttribute('aria-hidden', 'true');

		popoverElement.replaceChildren(...userElements, followEditorWrapper);

		if (activeViewId !== null) {
			const restored = popoverElement.querySelector(
				'.user-list-item[data-view-id="' + activeViewId + '"]',
			) as HTMLElement | null;
			if (restored) restored.focus();
		} else if (focusedFollowEditor) {
			followEditorWrapper.focus();
		}
	}

	renderFollowingChip() {
		const followingChipBackground = document.getElementById(
			'followingChipBackground',
		);
		const followingChip = document.getElementById('followingChip');

		const following = this.getFollowedUser();

		if (following === undefined && !app.isFollowingEditor()) {
			followingChipBackground.style.display = 'none';
			return;
		}

		const topAvatarZIndex = this.options.userLimitHeaderWhenFollowing;

		if (app.isFollowingEditor()) {
			followingChip.innerText = this.options.followingChipTextEditor;
			followingChip.style.borderColor = 'var(--color-main-text)';
		} else {
			followingChip.innerText = this.options.followingChipTextUser.replace(
				'{user}',
				following[1].username,
			);
			followingChip.style.borderColor = following[1].color;
		}

		followingChip.onclick = () => {
			this.unfollowAll();
			this.renderAll();
		};

		followingChip.title = this.options.followingChipTooltipText;
		$(followingChip).tooltip();

		followingChipBackground.style.display = 'block';
		followingChipBackground.style.zIndex = topAvatarZIndex.toString();
	}
}

window.L.control.userList = function () {
	return new UserList();
};

window.L.control.createUserListWidget = function () {
	// TODO: this is not interactive
	const userlistElement = window.L.DomUtil.create('div');
	app.map.userList.renderHeaderAvatarPopover(userlistElement);
	return userlistElement;
};
