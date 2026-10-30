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

class URLPopUpSection extends HTMLObjectSection {
    static sectionName = 'URL PopUp';
	containerId = 'hyperlink-pop-up-preview';
	linkId = 'hyperlink-pop-up';
	static cssClass = 'hyperlink-pop-up-container';
	copyButtonId = 'hyperlink-pop-up-copy';
	editButtonId = 'hyperlink-pop-up-edit';
	removeButtonId = 'hyperlink-pop-up-remove';
	openButtonId = 'hyperlink-pop-up-open';
	static horizontalPadding = 5;
	static popupVerticalMargin = 12;
	/// Gap kept between the card and each viewport edge when it is clamped.
	static phoneEdgeMargin = 8;
	static phoneCardClass = 'vulcan-phone-link-card';

	/*
	 * Phone chrome only, same predicate global.js stamps the class from: a
	 * desktop carries vulcan-desktop-chrome and a tablet carries NEITHER class,
	 * so both read false and keep the desktop card verbatim.
	 */
	private static isPhoneChrome(): boolean {
		return document.documentElement.classList.contains('vulcan-mobile-chrome')
			&& !!(window as any).mode
			&& (window as any).mode.isSmallScreenDevice();
	}

	/**
	 * Keep the span [pos, pos + size] inside [min, max].
	 *
	 * Math.max LAST, so a card bigger than the frame pins to the LEADING edge
	 * rather than being pushed off the other one — that ordering is the shipped
	 * left clamp's, lifted here so both axes and both placement paths share one
	 * expression instead of four hand-written Math.min/Math.max pairs.
	 */
	private static clampSpan(pos: number, size: number, min: number, max: number): number {
		return Math.max(min, Math.min(pos, max - size));
	}

	preview: HTMLDivElement;
	link: HTMLAnchorElement;

	constructor(url: string, documentPosition: cool.SimplePoint, linkPosition?: cool.SimplePoint, linkIsClientSide = false) {
        super(URLPopUpSection.sectionName, null, null, documentPosition, URLPopUpSection.cssClass);

		const objectDiv = this.getHTMLObject();
		objectDiv.remove();
		document.getElementById('document-container').appendChild(objectDiv);

		this.sectionProperties.url = url;
		this.sectionProperties.linkIsClientSide = linkIsClientSide;

		this.createUIElements(url);
		this.setUpCallbacks(linkPosition);

		this.link.title = url;

		if (app.map['wopi'].EnableRemoteLinkPicker)
			app.map.fire('postMessage', { msgId: 'Action_GetLinkPreview', args: { url: url } });

		this.sectionProperties.documentPosition = documentPosition.clone();
		this.getHTMLObject().style.pointerEvents = '';
    }

	adjustHTMLObjectPosition() {
		if (app.map._docLayer.isCalc()) {
			super.adjustHTMLObjectPosition();
			return;
		}

		const divBoundingRectangle = this.sectionProperties.objectDiv.getBoundingClientRect();

		let leftNumber = Math.round(this.sectionProperties.documentPosition.vX / app.dpiScale);
		let topNumber = Math.round((this.sectionProperties.documentPosition.vY / app.dpiScale) - divBoundingRectangle.height);

		/*
		 * CLAMP THE CARD INTO THE FRAME. Writer/Impress anchor this card at the
		 * caret and then never look at where its RIGHT edge lands, so a link
		 * struck anywhere past (viewportWidth - cardWidth) renders with the URL
		 * and the action buttons cut off the side of the screen. Measured on the
		 * built image at 393px: the card came up at x=240 w=186, i.e. a right
		 * edge of 426 against a 393 viewport -- 33px of it, including the
		 * rightmost button, simply not there.
		 *
		 * resetPosition() already clamps the LEFT edge for the mirror case
		 * (`if (checkLeft < 0)`), so a one-sided clamp is not the design, it is
		 * a gap in it.
		 *
		 * The frame is the offset parent, not the window: the div is appended to
		 * #document-container in the constructor, so its left/top are measured
		 * from that box and clamping against innerWidth would be off by the
		 * container's own inset.
		 *
		 * Phone-gated. A desktop cursor can put a link anywhere the same way,
		 * but the desktop card is 288px in a >=1000px frame and the fix here has
		 * to be verifiable on the surface it was measured on. The one-sided
		 * clamp above is left alone for the same reason.
		 */
		if (URLPopUpSection.isPhoneChrome()) {
			const parent = this.sectionProperties.objectDiv.parentElement as HTMLElement | null;
			const margin = URLPopUpSection.phoneEdgeMargin;
			const frameWidth = parent ? parent.clientWidth : window.innerWidth;
			const frameHeight = parent ? parent.clientHeight : window.innerHeight;
			leftNumber = URLPopUpSection.clampSpan(
				leftNumber, divBoundingRectangle.width, margin, frameWidth - margin);

			// Above the caret is the preferred side (it does not sit on the line
			// being read), but a link on the first line has nothing above it.
			// Flip below rather than render a card with its head off-screen.
			if (topNumber < margin)
				topNumber = Math.round(this.sectionProperties.documentPosition.vY / app.dpiScale)
					+ URLPopUpSection.popupVerticalMargin;

			/*
			 * ...AND THE BOTTOM EDGE, which nothing bounded (H-3, EX-5: "the
			 * URL toast overlaps chrome"). The card is appended to
			 * #document-container, so its offset parent ENDS where the phone's
			 * bottom chrome begins — the formula bar, the operator strip and
			 * the sheet strip in Calc, the utility bar in Writer/Impress. The
			 * frame does not clip (overflow is visible), so a card placed past
			 * that edge simply paints ON TOP of the bar: a link low on the page
			 * anchors below the frame, and the flip-below branch directly above
			 * pushes a first-line card down by its whole height. Applied after
			 * the flip so the flip cannot reintroduce the overhang, and the
			 * leading edge still wins for a card taller than the frame.
			 */
			topNumber = URLPopUpSection.clampSpan(
				topNumber, divBoundingRectangle.height, margin, frameHeight - margin);
		}

		const left = leftNumber + 'px';
		const top = topNumber + 'px';

		if (this.sectionProperties.objectDiv.style.left !== left)
			this.sectionProperties.objectDiv.style.left = left;

		if (this.sectionProperties.objectDiv.style.top !== top)
			this.sectionProperties.objectDiv.style.top = top;
	}

	getPopUpWidth(): number {
		return this.getHTMLObject().getBoundingClientRect().width;
	}

	getPopUpHeight(): number {
		return this.getHTMLObject().getBoundingClientRect().height;
	}

	getPopUpBoundingRectangle() {
		return this.getHTMLObject().getBoundingClientRect();
	}

	createUIElements(url: string) {
		const parent = this.getHTMLObject();
		this.preview = window.L.DomUtil.createWithId('div', this.containerId, parent) as HTMLDivElement;

		const linkRow = window.L.DomUtil.create('div', 'hyperlink-pop-up-link-row', parent);

        this.link = window.L.DomUtil.createWithId('a', this.linkId, linkRow) as HTMLAnchorElement;
		this.link.innerText = url;

		/*
		 * PHONE: AN EXPLICIT "OPEN" BUTTON.
		 *
		 * On desktop the only way to follow the link from this card is to click
		 * the URL text itself, which is a single 14px line -- fine for a cursor,
		 * and measured at exactly 14px tall on the phone, where it is a third of
		 * the finger floor. The card already carries three real buttons for the
		 * three destructive-ish actions and none for the one action a reader
		 * actually wants, so Open is added as a peer of Copy/Edit/Remove and
		 * sized with them by .vulcan-phone-link-card (vulcan-theme.css 13.9).
		 *
		 * WHAT THE PHONE CARD CARRIES, and why it is the same four: Google Docs'
		 * phone link card is Open / Copy / Edit / Remove, and the two that could
		 * plausibly be cut are already permission-gated below -- Edit and Remove
		 * are hidden outright in readonly, which is the posture a phone reader
		 * spends its time in. Cutting them from edit mode too would remove the
		 * only phone route to changing a link.
		 *
		 * It is created FIRST so it is the leading action in the row.
		 */
		if (URLPopUpSection.isPhoneChrome()) {
			window.L.DomUtil.addClass(parent, URLPopUpSection.phoneCardClass);

			const openLinkText = _('Open link');
			const openBtn = window.L.DomUtil.createWithId('div', this.openButtonId, linkRow);
			window.L.DomUtil.addClass(openBtn, 'hyperlink-popup-btn');
			openBtn.setAttribute('title', openLinkText);
			openBtn.setAttribute('role', 'button');
			openBtn.setAttribute('aria-label', openLinkText);

			const imgOpenBtn = window.L.DomUtil.create('img', 'hyperlink-pop-up-openimg', openBtn);
			app.LOUtil.setImage(imgOpenBtn, 'lc_open.svg', app.map);
			imgOpenBtn.setAttribute('width', 18);
			imgOpenBtn.setAttribute('height', 18);
			imgOpenBtn.setAttribute('alt', openLinkText);
			imgOpenBtn.style.padding = '4px';
		}

		const copyLinkText = _('Copy link location');
		const copyBtn = window.L.DomUtil.createWithId('div', this.copyButtonId, linkRow);
		window.L.DomUtil.addClass(copyBtn, 'hyperlink-popup-btn');
		copyBtn.setAttribute('title', copyLinkText);
		copyBtn.setAttribute('role', 'button');
		copyBtn.setAttribute('aria-label', copyLinkText);

        const imgCopyBtn = window.L.DomUtil.create('img', 'hyperlink-pop-up-copyimg', copyBtn);
		app.LOUtil.setImage(imgCopyBtn, 'lc_copyhyperlinklocation.svg', app.map);
		imgCopyBtn.setAttribute('width', 18);
		imgCopyBtn.setAttribute('height', 18);
		imgCopyBtn.setAttribute('alt', copyLinkText);
		imgCopyBtn.style.padding = '4px';

		const editLinkText = _('Edit link');
		const editBtn = window.L.DomUtil.createWithId('div', this.editButtonId, linkRow);
		window.L.DomUtil.addClass(editBtn, 'hyperlink-popup-btn');
		editBtn.setAttribute('title', editLinkText);
		editBtn.setAttribute('role', 'button');
		editBtn.setAttribute('aria-label', copyLinkText);


		const imgEditBtn = window.L.DomUtil.create('img', 'hyperlink-pop-up-editimg', editBtn);
		app.LOUtil.setImage(imgEditBtn, 'lc_edithyperlink.svg', app.map);
		imgEditBtn.setAttribute('width', 18);
		imgEditBtn.setAttribute('height', 18);
		imgEditBtn.setAttribute('alt', editLinkText);
		imgEditBtn.style.padding = '4px';

		const removeLinkText = _('Remove link');
		const removeBtn = window.L.DomUtil.createWithId('div', this.removeButtonId, linkRow);
		window.L.DomUtil.addClass(removeBtn, 'hyperlink-popup-btn');
		removeBtn.setAttribute('title', removeLinkText);
		removeBtn.setAttribute('role', 'button');
		removeBtn.setAttribute('aria-label', removeLinkText);

		const imgRemoveBtn = window.L.DomUtil.create('img', 'hyperlink-pop-up-removeimg', removeBtn);
		app.LOUtil.setImage(imgRemoveBtn, 'lc_removehyperlink.svg', app.map);
		imgRemoveBtn.setAttribute('width', 18);
		imgRemoveBtn.setAttribute('height', 18);
		imgRemoveBtn.setAttribute('alt', removeLinkText);
		imgRemoveBtn.style.padding = '4px';

		if (app.map._permission === 'readonly') {
			editBtn.style.display = 'none';
			removeBtn.style.display = 'none';
		}
	}

	openLink() {
		if (!this.sectionProperties.url.startsWith('#'))
			app.map.fire('warn', {url: this.sectionProperties.url, map: app.map, cmd: 'openlink'});
		else
			app.map.sendUnoCommand('.uno:JumpToMark?Bookmark:string=' + encodeURIComponent(this.sectionProperties.url.substring(1)));
	}

	setUpCallbacks(linkPosition?: cool.SimplePoint) {
		this.link.onclick = () => this.openLink();

		// Same handler as the link text, so the two cannot drift apart.
		// getElementById because createUIElements only builds it under phone
		// chrome; on desktop this is a no-op.
		const openBtn = document.getElementById(this.openButtonId);
		if (openBtn) openBtn.onclick = () => this.openLink();

		var params: any;
		if (linkPosition) {
			params = {
				PositionX: {
					type: 'long',
					value: linkPosition.x
				},
				PositionY: {
					type: 'long',
					value: linkPosition.y
				}
			};
		}

		document.getElementById(this.copyButtonId).onclick = () => {
			if (window.ThisIsTheiOSApp || window.ThisIsTheMacOSApp
					|| window.ThisIsTheWindowsApp || window.ThisIsTheQtApp) {
				app.map._clip.filterExecCopyPaste('.uno:CopyHyperlinkLocation', params);
			} else {
				const url = this.sectionProperties.url;
				if (navigator.clipboard && navigator.clipboard.writeText) {
					navigator.clipboard.writeText(url);
				} else {
					const ta = document.createElement('textarea');
					ta.value = url;
					ta.style.cssText = 'position:fixed;opacity:0';
					document.body.appendChild(ta);
					ta.select();
					document.execCommand('copy');
					document.body.removeChild(ta);
				}
			}
		};

		document.getElementById(this.editButtonId).onclick = () => {
			if (!this.sectionProperties.linkIsClientSide) // For now link in client side works only on readonly mode
				app.map.sendUnoCommand('.uno:EditHyperlink', params);
		};

		document.getElementById(this.removeButtonId).onclick = () => {
			if (!this.sectionProperties.linkIsClientSide) // For now link in client side works only on readonly mode
				app.map.sendUnoCommand('.uno:RemoveHyperlink', params);
			URLPopUpSection.closeURLPopUp();
		};
	}

	public static getCurrent(): URLPopUpSection {
		return app.sectionContainer.getSectionWithName(URLPopUpSection.sectionName) as URLPopUpSection;
	}

	public updatePreview(values: { url: string; image?: string; title?: string }) {
		// Guard against a stale response for a link that is no longer displayed.
		// Compare against sectionProperties.url since DOM text gets overwritten below.
		if (this.sectionProperties.url !== values.url)
			return;

		this.preview.innerText = '';
		if (values.image && values.image.indexOf('data:') === 0) {
			const image = window.L.DomUtil.create('img', '', this.preview) as HTMLImageElement;
			image.src = values.image;
			image.alt = values.title;
			image.onload = function () {
				URLPopUpSection.resetPosition();
			};
		} else {
			window.L.DomUtil.addClass(this.preview, 'no-preview');
		}
		if (values.title) {
			// The fetched page title is promoted to the link row (next to the
			// action buttons) and the raw URL is shown in the preview area.
			// The URL stays clickable there, since it is what the user
			// recognizes as the hyperlink.
			const urlAnchor = window.L.DomUtil.create('a', '', this.preview) as HTMLAnchorElement;
			urlAnchor.innerText = values.url;
			urlAnchor.title = values.url;
			urlAnchor.onclick = () => this.openLink();
			this.link.innerText = values.title;
			URLPopUpSection.resetPosition();
		}
	}

	public static resetPosition(section?: URLPopUpSection) {
		if (!section) section = URLPopUpSection.getCurrent();
		if (!section) return;

		let originalLeft = section.sectionProperties.documentPosition.pX - section.getPopUpWidth() * 0.5 * app.dpiScale;
		let originalTop = section.sectionProperties.documentPosition.pY - (section.getPopUpHeight() + URLPopUpSection.popupVerticalMargin) * app.dpiScale;

		const checkLeft = originalLeft - app.activeDocument.activeLayout.viewedRectangle.pX1;
		const checkTop = originalTop - app.activeDocument.activeLayout.viewedRectangle.pY1;

		if (checkTop < 0) {
			originalTop = section.sectionProperties.documentPosition.pY + (URLPopUpSection.popupVerticalMargin * 2 * app.dpiScale);
		}

		if (checkLeft < 0) originalLeft = app.activeDocument.activeLayout.viewedRectangle.pX1;

		/*
		 * The RIGHT-edge and BOTTOM-edge halves of the clamp directly above.
		 * This is the branch Calc's DOM placement actually uses --
		 * adjustHTMLObjectPosition defers to the base class for spreadsheets,
		 * which reads myTopLeft, which is what setPosition below writes -- so
		 * the clamp has to exist in both places to cover all three doctypes.
		 *
		 * The viewed rectangle is the visible document area, i.e. it already
		 * ENDS where the bottom chrome begins, so clamping into it is exactly
		 * "the card can never overlap the utility bar" (H-3 / EX-5). Applied
		 * after the flip above so a card wider or taller than the viewport
		 * still starts at the leading edge.
		 */
		if (URLPopUpSection.isPhoneChrome()) {
			const viewed = app.activeDocument.activeLayout.viewedRectangle;
			originalLeft = URLPopUpSection.clampSpan(
				originalLeft, section.getPopUpWidth() * app.dpiScale, viewed.pX1, viewed.pX2);
			originalTop = URLPopUpSection.clampSpan(
				originalTop, section.getPopUpHeight() * app.dpiScale, viewed.pY1, viewed.pY2);
		}

		section.setPosition(originalLeft, originalTop);
		section.adjustHTMLObjectPosition();
		section.containerObject.requestReDraw();
	}

	public static showURLPopUP(url: string, documentPosition: cool.SimplePoint, linkPosition?: cool.SimplePoint, linkIsClientSide?: boolean) {
		if (URLPopUpSection.isOpen())
			URLPopUpSection.closeURLPopUp();

		const section = new URLPopUpSection(url, documentPosition, linkPosition, linkIsClientSide);
		app.sectionContainer.addSection(section);
		this.resetPosition(section);
    }

    public static closeURLPopUp() {
		if (URLPopUpSection.isOpen())
			app.sectionContainer.removeSection(URLPopUpSection.sectionName);
	}

    public static isOpen() {
		return app.sectionContainer.doesSectionExist(URLPopUpSection.sectionName);
    }
}
