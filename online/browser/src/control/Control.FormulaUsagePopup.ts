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
 * Control.FormulaUsagePopup
 */

/* global app */

class FormulaUsagePopup extends AutoCompletePopup {
	usageText: string;
	// Vulcan fork (Excel parity): the exact text run of the active argument
	// inside the signature row; rendered emphasized via the treeview's
	// highlightTerm mechanism. Null when no argument is active.
	activeArgTerm: string;
	lastActiveArgIndex: number;
	declare newPopupData: PopupData;

	constructor(map: any) {
		super(AutoCompleteDialogId.FormulaUsagePopup, map);
		this.newPopupData = {
			children: [
				{
					id: 'container',
					type: 'container',
					enabled: true,
					children: new Array<WidgetJSON>(),
					vertical: true,
				} as any as WidgetJSON,
			] as Array<WidgetJSON>,
			jsontype: 'dialog',
			type: 'dialog', // exception: dialog but it behaves like a popup
			cancellable: true,
			hasClose: false, // do not show titlebar
			isAutoCompletePopup: true, // don't steal focus
			popupParent: undefined,
			clickToClose: undefined,
			id: 'formulausagePopup',
			title: '', // no titlebar
		} as PopupData;
	}

	onAdd() {
		this.newPopupData.isAutoCompletePopup = true;
		this.activeArgTerm = null;
		this.lastActiveArgIndex = -1;
		this.map.on('openformulausagepopup', this.openFormulaUsagePopup, this);
		this.map.on('sendformulausagetext', this.sendFormulaUsageText, this);
		// Vulcan fork: re-emphasize the active argument as the user types.
		this.map.on('cellformula', this.onCellFormulaChanged, this);
	}

	openFormulaUsagePopup(ev: FireEvent) {
		this.openPopup({ data: ev });
		this.map.focus();
	}

	sendFormulaUsageText(ev: FireEvent) {
		this.openFormulaUsagePopup(ev);
	}

	// Vulcan fork: while the usage popup is open, every formula edit
	// recomputes which argument the caret sits in and refreshes the popup
	// when that changed. Core does not resend the tooltip per keystroke.
	onCellFormulaChanged() {
		if (!this.usageText) return;
		if (!window.L.DomUtil.get(this.popupId)) return;
		if (this.computeActiveArgIndex() === this.lastActiveArgIndex) return;
		this.openPopup({ data: { data: this.usageText } });
	}

	// Index of the argument the caret sits in, for the innermost open
	// function call. Counts unmatched '(' and top-level ';'/',' separators
	// left of the caret; separators inside double-quoted strings and array
	// constants ('{...}') are ignored. Returns -1 when no call is open.
	computeActiveArgIndex(): number {
		const docLayer = this.map._docLayer;
		if (!docLayer) return -1;
		const formula: string = docLayer._lastFormula;
		if (!formula) return -1;

		// The caret is right after the last typed character; when that is
		// unknown (e.g. tooltip arrived before any diff), assume the end.
		let caret = formula.length;
		const diffIndex: number = docLayer._newFormulaDiffIndex;
		if (
			typeof diffIndex === 'number' &&
			diffIndex >= 0 &&
			diffIndex < formula.length
		)
			caret = diffIndex + 1;

		const argCounters: number[] = [];
		let inString = false;
		let braceDepth = 0;
		for (let i = 0; i < caret; i++) {
			const ch = formula.charAt(i);
			if (ch === '"') {
				inString = !inString;
				continue;
			}
			if (inString) continue;
			if (ch === '{') braceDepth++;
			else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);
			else if (braceDepth > 0) continue;
			else if (ch === '(') argCounters.push(0);
			else if (ch === ')') {
				if (argCounters.length > 0) argCounters.pop();
			} else if (
				(ch === ';' || ch === ',') &&
				argCounters.length > 0
			)
				argCounters[argCounters.length - 1]++;
		}

		if (argCounters.length === 0) return -1;
		return argCounters[argCounters.length - 1];
	}

	// Wrap the active argument of 'FUNC(arg1; arg2; ...)' in '[...]' so the
	// treeview's highlightTerm mechanism renders exactly that run
	// emphasized (the brackets themselves are stripped when rendering).
	decorateActiveArgument(functionUsage: string): string {
		this.activeArgTerm = null;
		this.lastActiveArgIndex = this.computeActiveArgIndex();
		if (this.lastActiveArgIndex < 0) return functionUsage;

		const openIndex = functionUsage.indexOf('(');
		const closeIndex = functionUsage.lastIndexOf(')');
		if (openIndex < 0 || closeIndex <= openIndex) return functionUsage;

		// Split the parameter list at top-level ';' separators, tracking
		// nesting and quoted spans, keeping offsets into functionUsage.
		const segments: number[][] = []; // [start, end) pairs
		let segStart = openIndex + 1;
		let depth = 0;
		let inString = false;
		for (let i = openIndex + 1; i < closeIndex; i++) {
			const ch = functionUsage.charAt(i);
			if (ch === '"') inString = !inString;
			else if (inString) continue;
			else if (ch === '(') depth++;
			else if (ch === ')') depth--;
			else if (ch === ';' && depth === 0) {
				segments.push([segStart, i]);
				segStart = i + 1;
			}
		}
		segments.push([segStart, closeIndex]);

		// Signatures of variadic functions end in '...'; keep the emphasis
		// on the last named segment once the user goes past it.
		const segment =
			segments[Math.min(this.lastActiveArgIndex, segments.length - 1)];

		// Trim the segment to the argument text itself.
		let start = segment[0];
		let end = segment[1];
		while (start < end && functionUsage.charAt(start) === ' ') start++;
		while (end > start && functionUsage.charAt(end - 1) === ' ') end--;
		if (start >= end) return functionUsage;

		const argText = functionUsage.substring(start, end);
		// Square brackets in the run would confuse the marker syntax.
		if (argText.indexOf('[') >= 0 || argText.indexOf(']') >= 0)
			return functionUsage;

		this.activeArgTerm = argText;
		return (
			functionUsage.substring(0, start) +
			'[' +
			argText +
			']' +
			functionUsage.substring(end)
		);
	}

	getTreeJSON(): TreeWidgetJSON {
		const treeJSON = super.getTreeJSON();
		// Vulcan fork: emphasize the active argument. Only set when known —
		// an undefined highlightTerm keeps the stock rendering path.
		if (this.activeArgTerm) treeJSON.highlightTerm = this.activeArgTerm;
		return treeJSON;
	}

	getPopupEntries(ev: FireEvent): any[] {
		this.usageText = ev.data.data;
		var chIndex = this.usageText.indexOf(':');
		var functionUsage = this.decorateActiveArgument(
			this.usageText.substring(0, chIndex),
		);
		var usageDescription = this.usageText.substring(chIndex + 1);
		// 'text' mirrors the visible column: the highlightTerm rendering
		// path reads entry.text rather than the column text.
		const entries = [
			{
				row: 0,
				text: functionUsage,
				columns: [{ text: functionUsage }],
				collapsed: false,
				children: [
					{
						row: 1,
						text: usageDescription,
						columns: [{ text: usageDescription }],
					},
				],
			},
		];

		return entries;
	}

	callback(objectType: any, eventType: any, object: any, index: number) {
		if (eventType === 'close') {
			this.closePopup();
		}
		return false;
	}
}
