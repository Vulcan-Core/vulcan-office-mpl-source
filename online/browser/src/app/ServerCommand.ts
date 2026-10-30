/* -*- js-indent-level: 8; fill-column: 100 -*- */
/*
 * Copyright the Collabora Online contributors.
 *
 * SPDX-License-Identifier: MPL-2.0
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

class ServerCommand {
	// TODO: make mandatory fields non-optional.
	public filename?: string;
	public url?: string;
	public type?: string;
	public mode?: number;
	public id?: string;
	public errorCmd?: string;
	public errorCode?: string;
	public errorKind?: string;
	public errorDetail?: string;
	public jail?: string;
	public dir?: string;
	public downloadid?: string;
	public name?: string;
	public port?: string;
	public font?: string;
	public char?: string;
	public viewid?: string;
	public nviewid?: string;
	public params?: string[];
	public rendercount?: number;
	public wireId?: string;
	public title?: string;
	public dialogwidth?: string;
	public dialogheight?: string;
	public rectangle?: string;
	public hiddenparts?: number[];
	public rtlParts?: number[];
	public protectedParts?: number[];
	public hash?: string;
	public nopng?: boolean;
	public username?: string;
	public pageRectangleList?: number[][];
	public lastcolumn?: number;
	public lastrow?: number;
	public readonly?: number;
	public externallinksdisabled?: boolean;
	// Vulcan: `error: cmd=storage kind=savefailed ... vulcanunanswered=1`,
	// a save the WOPI host never answered, which wsd sends again
	// (DocumentBroker::reportUploadUnanswered).
	public vulcanUnanswered?: boolean;
	// Vulcan: `error: cmd=storage kind=documentconflict ...
	// vulcankeepssave=1`, a save sent from the conflict dialog would be kept as
	// a version if refused (DocumentBroker::vulcanConflictDialogFrame).
	public vulcanKeepsSave?: boolean;

	public x?: number;
	public y?: number;
	public tileWidth?: number;
	public tileHeight?: number;
	public width?: number;
	public height?: number;
	public zoom?: number;
	public part?: number;
	public parts?: number;
	public selectedPart?: number;

	constructor(msg: string, map: MapZoomInterface) {
		this.parse(msg, map);
	}

	public static getParameterValue(s: string): string | undefined {
		const i = s.indexOf('=');
		if (i === -1) return undefined;
		return s.substring(i + 1);
	}

	private parse(msg: string, map: MapZoomInterface): void {
		const tokens = msg.split(/[ \n]+/);
		for (let i = 0; i < tokens.length; i++) {
			if (tokens[i].startsWith('tileposx=')) {
				this.x = parseInt(tokens[i].substring(9));
			} else if (tokens[i].startsWith('tileposy=')) {
				this.y = parseInt(tokens[i].substring(9));
			} else if (tokens[i].startsWith('x=')) {
				this.x = parseInt(tokens[i].substring(2));
			} else if (tokens[i].startsWith('y=')) {
				this.y = parseInt(tokens[i].substring(2));
			} else if (tokens[i].startsWith('tilewidth=')) {
				this.tileWidth = parseInt(tokens[i].substring(10));
			} else if (tokens[i].startsWith('tileheight=')) {
				this.tileHeight = parseInt(tokens[i].substring(11));
			} else if (tokens[i].startsWith('width=')) {
				this.width = parseInt(tokens[i].substring(6));
			} else if (tokens[i].startsWith('height=')) {
				this.height = parseInt(tokens[i].substring(7));
			} else if (tokens[i].startsWith('part=')) {
				this.part = parseInt(tokens[i].substring(5));
			} else if (tokens[i].startsWith('parts=')) {
				this.parts = parseInt(tokens[i].substring(6));
			} else if (tokens[i].startsWith('mode=')) {
				this.mode = parseInt(tokens[i].substring(5));
			} else if (tokens[i].startsWith('current=')) {
				this.selectedPart = parseInt(tokens[i].substring(8));
			} else if (tokens[i].startsWith('id=')) {
				// remove newline characters
				this.id = tokens[i].substring(3).replace(/(\r\n|\n|\r)/gm, '');
			} else if (tokens[i].startsWith('type=')) {
				// remove newline characters
				this.type = tokens[i].substring(5).replace(/(\r\n|\n|\r)/gm, '');
			} else if (tokens[i].startsWith('cmd=')) {
				this.errorCmd = tokens[i].substring(4);
			} else if (tokens[i].startsWith('code=')) {
				this.errorCode = tokens[i].substring(5);
			} else if (tokens[i].startsWith('kind=')) {
				this.errorKind = tokens[i].substring(5);
			} else if (tokens[i].startsWith('errordetail=')) {
				this.errorDetail = decodeURIComponent(tokens[i].substring(12));
			} else if (tokens[i].startsWith('jail=')) {
				this.jail = tokens[i].substring(5);
			} else if (tokens[i].startsWith('dir=')) {
				this.dir = tokens[i].substring(4);
			} else if (tokens[i].startsWith('downloadid=')) {
				this.downloadid = tokens[i].substring(11);
			} else if (tokens[i].startsWith('name=')) {
				this.name = tokens[i].substring(5);
			} else if (tokens[i].startsWith('filename=')) {
				this.filename = tokens[i].substring(9);
			} else if (tokens[i].startsWith('port=')) {
				this.port = tokens[i].substring(5);
			} else if (tokens[i].startsWith('font=')) {
				this.font = tokens[i].substring(5);
			} else if (tokens[i].startsWith('char=')) {
				this.char = tokens[i].substring(5);
			} else if (tokens[i].startsWith('url=')) {
				this.url = tokens[i].substring(4);
			} else if (tokens[i].startsWith('viewid=')) {
				this.viewid = tokens[i].substring(7);
			} else if (tokens[i].startsWith('nviewid=')) {
				this.nviewid = tokens[i].substring(8);
			} else if (tokens[i].startsWith('params=')) {
				this.params = tokens[i].substring(7).split(',');
			} else if (tokens[i].startsWith('rendercount=')) {
				this.rendercount = parseInt(tokens[i].substring(12));
			} else if (tokens[i].startsWith('wid=')) {
				this.wireId = ServerCommand.getParameterValue(tokens[i]);
			} else if (tokens[i].startsWith('title=')) {
				this.title = tokens[i].substring(6);
			} else if (tokens[i].startsWith('dialogwidth=')) {
				this.dialogwidth = tokens[i].substring(12);
			} else if (tokens[i].startsWith('dialogheight=')) {
				this.dialogheight = tokens[i].substring(13);
			} else if (tokens[i].startsWith('rectangle=')) {
				this.rectangle = tokens[i].substring(10);
			} else if (tokens[i].startsWith('hiddenparts=')) {
				const hiddenparts = tokens[i].substring(12).split(',');
				this.hiddenparts = hiddenparts.map((item: string) => parseInt(item));
			} else if (tokens[i].startsWith('rtlparts=')) {
				const rtlParts = tokens[i].substring(9).split(',');
				this.rtlParts = rtlParts.map((item: string) => parseInt(item));
			} else if (tokens[i].startsWith('protectedparts=')) {
				const protectedParts = tokens[i].substring(15).split(',');
				this.protectedParts = protectedParts.map((item: string) =>
					parseInt(item),
				);
			} else if (tokens[i].startsWith('hash=')) {
				this.hash = tokens[i].substring('hash='.length);
			} else if (tokens[i] === 'nopng') {
				this.nopng = true;
			} else if (tokens[i].startsWith('username=')) {
				this.username = tokens[i].substring(9);
			} else if (tokens[i].startsWith('pagerectangles=')) {
				const pageRectangleList = tokens[i].substring(15).split(';');
				this.pageRectangleList = pageRectangleList.map(function (
					rect: string,
				): number[] {
					const rectCoords = rect.split(',');
					return [
						parseInt(rectCoords[0]),
						parseInt(rectCoords[1]),
						parseInt(rectCoords[2]),
						parseInt(rectCoords[3]),
					];
				});
			} else if (tokens[i].startsWith('lastcolumn=')) {
				this.lastcolumn = parseInt(tokens[i].substring(11));
			} else if (tokens[i].startsWith('lastrow=')) {
				this.lastrow = parseInt(tokens[i].substring(8));
			} else if (tokens[i].startsWith('readonly=')) {
				this.readonly = parseInt(tokens[i].substring(9));
			} else if (tokens[i] === 'vulcanunanswered=1') {
				this.vulcanUnanswered = true;
			} else if (tokens[i] === 'vulcankeepssave=1') {
				this.vulcanKeepsSave = true;
			}
		}
		if (this.tileWidth && this.tileHeight && map._docLayer) {
			const defaultZoom = map.options.zoom;
			const scale = this.tileWidth / map._docLayer.options.tileWidthTwips;
			// scale = 1.2 ^ (defaultZoom - zoom)
			// zoom = defaultZoom -log(scale) / log(1.2)
			this.zoom = Math.round(defaultZoom - Math.log(scale) / Math.log(1.2));
		}
	}
}
