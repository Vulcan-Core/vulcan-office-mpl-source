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

/// all tests based on the possible messages from wsd/protocol.txt
describe('ServerCommand', function() {

	const mapzoom: MapZoomInterface = {
		_docLayer: {
			options: {
				tileWidthTwips: 256 * 15,
			},
		},
		options: {
			zoom: 10,
		},
	};

	it('downloadas', function() {
		const downloadid = 'SWhzgceoAoUXjc6XxSfKduleBU3pFKPI5jUQFnmRsgRxAPMqOhI8hhY0uWmg6tSp';
		const port = '9980';
		const id = 'export';

		const msg = 'downloadas: downloadid=' + downloadid + ' port=' + port + ' id=' + id;
		const sc = new ServerCommand(msg, mapzoom);
		nodeassert.equal(downloadid, sc.downloadid);
		nodeassert.equal(port, sc.port);
		nodeassert.equal(id, sc.id);
	});

	// The export name stays percent-encoded here: the kit encodes it for the
	// space-delimited frame, and each consumer decodes it once. Socket.ts's
	// three readers call decodeURIComponent themselves, and the host decodes
	// the Download_As name that _onDownloadAsMsg posts to it. A decode here
	// would run twice, so a title's literal "%41" would come out as "A".
	it('downloadas keeps the export filename percent-encoded', function() {
		const msg = 'downloadas: downloadid=d1 port=9980 id=export filename=a%20b.docx';
		const sc = new ServerCommand(msg, mapzoom);
		nodeassert.equal('export', sc.id);
		nodeassert.equal('a%20b.docx', sc.filename);
	});

	it('getchildid', function() {
		const id = '23456';
		const msg = 'getchildid: id=' + id;
		const sc = new ServerCommand(msg, mapzoom);
		nodeassert.equal(id, sc.id);
	});

	it('invalidatetiles (specific region)', function() {
		const part = 0;
		const mode = 0;
		const x = 117690;
		const y = 256050;
		const width = 2100;
		const height = 2655;
		const wireId = '268';

		const msg = `invalidatetiles: part=${part} mode=${mode} x=${x} y=${y} width=${width} height=${height} wid=${wireId}`;

		const sc = new ServerCommand(msg, mapzoom);
		nodeassert.equal(part, sc.part);
		nodeassert.equal(mode, sc.mode);
		nodeassert.equal(x, sc.x);
		nodeassert.equal(y, sc.y);
		nodeassert.equal(width, sc.width);
		nodeassert.equal(height, sc.height);
		nodeassert.equal(wireId, sc.wireId);
	});

	it('invalidatetiles (all cached tiles)', function() {
		const part = 0;
		const mode = 0;
		const wireId = '268';

		const msg = `invalidatetiles: EMPTY, ${part}, ${mode}, wid=${wireId}`;

		const sc = new ServerCommand(msg, mapzoom);
		nodeassert.equal(wireId, sc.wireId);
	});

	it('loaded', function() {
		const viewid = '34';
		const views = 39;
		const isfirst = false;

		const msg = `loaded: viewid=${viewid} views=${views} isfirst=${isfirst}`;
		const sc = new ServerCommand(msg, mapzoom);
		nodeassert.equal(viewid, sc.viewid);
	});

	it('pong', function() {
		const rendercount = 546;
		const msg = `pong rendercount=${rendercount}`;

		const sc = new ServerCommand(msg, mapzoom);
		nodeassert.equal(rendercount, sc.rendercount);
	});

	// Pins the parse of every prefix the substring(0,N)->startsWith rewrite
	// touched that the suite did not already assert on.
	it('error message fields', function() {
		const msg = 'error: cmd=load kind=docunloading code=17 errordetail=some%20detail jail=j1 dir=d2';
		const sc = new ServerCommand(msg, mapzoom);
		nodeassert.equal('load', sc.errorCmd);
		nodeassert.equal('docunloading', sc.errorKind);
		nodeassert.equal('17', sc.errorCode);
		nodeassert.equal('some detail', sc.errorDetail);
		nodeassert.equal('j1', sc.jail);
		nodeassert.equal('d2', sc.dir);
	});

	it('renderfont fields', function() {
		const msg = 'renderfont: font=Liberation%20Serif char=q url=http://x/y';
		const sc = new ServerCommand(msg, mapzoom);
		nodeassert.equal('Liberation%20Serif', sc.font);
		nodeassert.equal('q', sc.char);
		nodeassert.equal('http://x/y', sc.url);
	});

	it('status fields', function() {
		const msg = 'status: type=text parts=5 current=2 viewid=7 rendercount=12 title=T dialogwidth=800 dialogheight=600 rectangle=0,0,10,10 hiddenparts=1,2,3 username=rob name=n1 filename=f.odt params=a,b,c id=9\r\n';
		const sc = new ServerCommand(msg, mapzoom);
		nodeassert.equal('text', sc.type);
		nodeassert.equal(5, sc.parts);
		nodeassert.equal(2, sc.selectedPart);
		nodeassert.equal('7', sc.viewid);
		nodeassert.equal(12, sc.rendercount);
		nodeassert.equal('T', sc.title);
		nodeassert.equal('800', sc.dialogwidth);
		nodeassert.equal('600', sc.dialogheight);
		nodeassert.equal('0,0,10,10', sc.rectangle);
		nodeassert.deepEqual([1, 2, 3], sc.hiddenparts);
		nodeassert.equal('rob', sc.username);
		nodeassert.equal('n1', sc.name);
		nodeassert.equal('f.odt', sc.filename);
		nodeassert.deepEqual(['a', 'b', 'c'], sc.params);
		nodeassert.equal('9', sc.id);
	});

	it('tile', function() {
		const nviewid = '1000';
		const part = 0;
		const width = 256;
		const height = 256;
		const tileposx = 122880;
		const tileposy = 215040;
		const tilewidth = 3840;
		const tileheight = 3840;
		const wireId = '423';
		const ver = '128';
		const imgsize = 800;

		const msg = `tile: nviewid=${nviewid} part=${part} width=${width} height=${height} tileposx=${tileposx} tileposy=${tileposy} tilewidth=${tilewidth} tileheight=${tileheight} wid=${wireId} ver=${ver} imgsize=${imgsize}`;

		const sc = new ServerCommand(msg, mapzoom);
		nodeassert.equal(nviewid, sc.nviewid);
		nodeassert.equal(part, sc.part);
		nodeassert.equal(width, sc.width);
		nodeassert.equal(height, sc.height);
		nodeassert.equal(tileposx, sc.x);
		nodeassert.equal(tileposy, sc.y);
		nodeassert.equal(tilewidth, sc.tileWidth);
		nodeassert.equal(tileheight, sc.tileHeight);
		nodeassert.equal(wireId, sc.wireId);
	});

	// wsd (DocumentBroker::reportUploadUnanswered) appends the token
	// after the percent-encoded errordetail of a save the host never answered.
	it('error: cmd=storage kind=savefailed with vulcanunanswered=1', function() {
		const msg = 'error: cmd=storage kind=savefailed errordetail=No%20response%20received. vulcanunanswered=1';
		const sc = new ServerCommand(msg, mapzoom);
		nodeassert.equal('storage', sc.errorCmd);
		nodeassert.equal('savefailed', sc.errorKind);
		nodeassert.equal('No response received.', sc.errorDetail);
		nodeassert.equal(true, sc.vulcanUnanswered);

		const upstream = new ServerCommand('error: cmd=storage kind=savefailed errordetail=500%20x', mapzoom);
		nodeassert.equal(undefined, upstream.vulcanUnanswered);
	});

	// wsd (DocumentBroker::vulcanConflictDialogFrame) appends the token
	// when a save from the conflict dialog would be kept as a version.
	it('error: cmd=storage kind=documentconflict with vulcankeepssave=1', function() {
		const msg = 'error: cmd=storage kind=documentconflict errordetail=Last%20known%20timestamp vulcankeepssave=1';
		const sc = new ServerCommand(msg, mapzoom);
		nodeassert.equal('storage', sc.errorCmd);
		nodeassert.equal('documentconflict', sc.errorKind);
		nodeassert.equal('Last known timestamp', sc.errorDetail);
		nodeassert.equal(true, sc.vulcanKeepsSave);

		const unkept = new ServerCommand('error: cmd=storage kind=documentconflict errordetail=x', mapzoom);
		nodeassert.equal(undefined, unkept.vulcanKeepsSave);
	});
});
