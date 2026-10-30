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
	/// Vector representation of a slide.
	export interface VectorPrimitivesData {
		slideWidth: number; // twips
		slideHeight: number; // twips
		/// The page's left/top border, twips: object geometry here is
		/// border-inset (logic) coordinates; the margin-inclusive frame
		/// InsertShape and the document structure use adds these.
		borderLeft?: number;
		borderTop?: number;
		masterPage: Primitive[];
		objects: SlideObject[];
	}
}
