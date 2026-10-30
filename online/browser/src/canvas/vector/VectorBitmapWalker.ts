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
	/// Walk a JSON primitive tree and collect the checksums of every
	/// image-bearing primitive seen. Recurses into the children container,
	/// and into a transparence's mask, which can draw images too.
	export class VectorBitmapWalker {
		private _checksums: Set<number>;

		constructor(checksums: Set<number>) {
			this._checksums = checksums;
		}

		walkObjects(objects: SlideObject[]): void {
			for (const obj of objects) {
				if (obj.primitives) this.walkPrimitives(obj.primitives);
			}
		}

		walkPrimitives(primitives: Primitive[]): void {
			for (const p of primitives) this._walkPrimitive(p);
		}

		private _walkPrimitive(primitive: Primitive): void {
			if (GraphicResource.is(primitive))
				this._checksums.add(primitive.checksum);
			if (primitive.children) this.walkPrimitives(primitive.children);
			// Only a transparence carries a mask subtree there; a
			// unifiedTransparence uses the same field for a number.
			if (primitive.type === TransparencePrimitive.type) {
				const mask = (primitive as TransparencePrimitive).transparence;
				if (mask) this.walkPrimitives(mask);
			}
		}
	}
}
