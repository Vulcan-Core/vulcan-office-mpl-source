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

namespace cool {
	/// A group member: ordinal within its PARENT's list (what
	/// graphicselection's OrdNum reports once the group is entered) and
	/// absolute snap-rect bounds. Geometry only — the group's whole
	/// primitive tree rides on the top-level entry.
	export interface SlideObjectChild {
		ordNum?: number;
		bounds?: number[];
		/// An empty presentation placeholder inside the group.
		emptyPresObj?: boolean;
		children?: SlideObjectChild[];
	}

	/// One drawable object on a slide, carrying its primitive tree.
	export interface SlideObject {
		id?: number;
		name?: string;
		/// Model z-order index — joins the object to the client's selection
		/// identity (GraphicSelection extraInfo OrdNum). Absent on kits
		/// that predate it.
		ordNum?: number;
		/// Snap rectangle [x, y, w, h] in twips — the same rectangle the
		/// graphicselection message reports, so a client-side hit places
		/// the speculative selection frame exactly where the authoritative
		/// one will land. Absent on kits that predate it.
		bounds?: number[];
		/// Group members, recursively. Absent on non-groups and on kits
		/// that predate it.
		children?: SlideObjectChild[];
		/// An empty presentation placeholder ("Click to add Title"): its
		/// only ink is the edit-view prompt, and a click into it starts
		/// typing. Absent (never false) otherwise, and on kits that
		/// predate it.
		emptyPresObj?: boolean;
		/// The protected graphic a PDF page opens as (the page's whole
		/// content until DecomposePdfPages replaces it with objects): the
		/// page's picture, never a gesture target. Absent otherwise.
		pdfPage?: boolean;
		/// A LOCKED object (an edited scan's kept scan or overlay): core
		/// refuses to mark it, so it is never a gesture target — a press on
		/// it is a press on the page. Absent otherwise.
		locked?: boolean;
		/// A hidden-ink OCR line of an edited scan: its text paints nothing
		/// (the scan shows the words) but it IS text to click into, so its
		/// whole box counts as ink. Absent otherwise.
		hiddenInk?: boolean;
		/// Core refuses to move or resize it (a hidden line before its first
		/// text change): a press on it gets no drag echo. Absent otherwise.
		moveProtect?: boolean;
		primitives?: Primitive[];
	}

	/// A speculative per-object override applied while rendering one part.
	/// The object matching ordNum is either drawn shifted by (dxTwips,
	/// dyTwips) — the nudge/drag echo — or, when `primitives` is present,
	/// drawn from that REPLACEMENT tree instead of its own (the live
	/// resize re-wrap: absolute-positioned portions the client laid out
	/// at the drag width, zero server round-trip). Both are transient:
	/// the authoritative render replaces them.
	export interface VectorRenderOverride {
		ordNum: number;
		/// Further objects translated by the same offset — a multi-
		/// selection drag moves every member together. Never carries
		/// replacement primitives.
		ordNums?: number[];
		/// A member drag inside an entered group: only the group's
		/// immediate member with this ordinal (its objectChild subtree)
		/// translates; the group's other members stay put.
		childOrdNum?: number;
		dxTwips: number;
		dyTwips: number;
		primitives?: Primitive[];
	}
}
