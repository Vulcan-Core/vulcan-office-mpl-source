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
 *
 * Logger contains methods for logging the activity
 */

type Direction = 'INCOMING' | 'OUTGOING';
interface LogMsg {
	msg: string;
	direction: Direction;
	status: string;
	time: number;
}

class Logger {
	private _logs: LogMsg[];
	// Ring write index: once _logs is at capacity, new entries overwrite the
	// oldest slot instead of shift()ing the whole array per entry.
	private _ringIndex: number;
	private startTime: number;
	private _cypressTest: boolean;

	constructor() {
		this._logs = [];
		this._ringIndex = 0;
		this.startTime = null;
		this._cypressTest =
			typeof navigator !== 'undefined' &&
			navigator.userAgent.toLowerCase().indexOf('cypress') !== -1;
	}

	public log(msg: string, direction: Direction, status: string = ''): void {
		const time = Date.now();
		if (!this.startTime) this.startTime = time;

		// Limit memory usage of log by only keeping the latest entries
		let maxEntries = 100;
		if ((window as any).enableDebug || this._cypressTest) maxEntries = 1000;

		if (time - this.startTime < 60 * 1000 /* ms */) maxEntries = 500; // enough to capture early start.

		// Limit memory usage of log by limiting length of message
		const maxMsgLen = this._cypressTest ? 1024 : 128;
		if (msg.length > maxMsgLen) msg = msg.substring(0, maxMsgLen);
		if (msg.indexOf('\n') !== -1 || msg.indexOf('\r') !== -1)
			msg = msg.replace(/(\r\n|\n|\r)/gm, ' ');
		const entry: LogMsg = {
			msg: msg,
			direction: direction,
			status: status,
			time: time,
		};
		// The shift() loop this replaces settled at maxEntries + 1 entries;
		// keep that exact capacity so retention is byte-identical.
		const capacity = maxEntries + 1;
		if (this._logs.length < capacity) {
			this._logs.push(entry);
			this._ringIndex = 0; // a chronological array's oldest slot is 0
			return;
		}
		if (this._logs.length > capacity) {
			// The cap just shrank (the 60 s startup window ended). The array
			// may be a rotated ring, so unrotate before keeping the newest.
			const chrono = this._logs
				.slice(this._ringIndex)
				.concat(this._logs.slice(0, this._ringIndex));
			this._logs = chrono.slice(chrono.length - capacity);
			this._ringIndex = 0;
		}
		this._logs[this._ringIndex] = entry;
		this._ringIndex = (this._ringIndex + 1) % capacity;
	}

	private _getEntries(): string {
		this._logs.sort(function (a, b) {
			if (a.time < b.time) {
				return -1;
			}
			if (a.time > b.time) {
				return 1;
			}
			return 0;
		});
		let data: string = '';
		for (let i = 0; i < this._logs.length; i++) {
			data +=
				this._logs[i].time +
				'.' +
				this._logs[i].direction +
				this._logs[i].status +
				'.' +
				this._logs[i].msg;
			data += '\n';
		}
		return data;
	}

	public print(): void {
		window.app.console.log('Queued log messages:');
		window.app.console.log(this._getEntries());
		window.app.console.log('End of queued log messages:');
	}

	public save(): void {
		const blob = new Blob([this._getEntries()], { type: 'text/csv' });
		const a = document.createElement('a');

		a.download = Date.now() + '.csv';
		a.href = window.URL.createObjectURL(blob);
		a.dataset.downloadurl = ['text/csv', a.download, a.href].join(':');

		const e = new MouseEvent('click', {
			bubbles: true,
			cancelable: false,
			view: window,
			detail: 0,
			screenX: 0,
			screenY: 0,
			clientX: 0,
			clientY: 0,
			ctrlKey: false,
			altKey: false,
			shiftKey: false,
			metaKey: false,
			button: 0,
			relatedTarget: null,
		});
		a.dispatchEvent(e);
	}

	public clear(): void {
		this._logs = [];
		this._ringIndex = 0;
	}
}

app.Log = new Logger();
