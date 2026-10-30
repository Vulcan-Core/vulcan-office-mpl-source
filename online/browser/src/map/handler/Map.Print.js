/* -*- js-indent-level: 8 -*- */
/*
 * window.L.Map.Print is handling the print action
 */

/* global _ */

window.L.Map.mergeOptions({
	printHandler: true
});

window.L.Map.Print = window.L.Handler.extend({

	initialize: function (map) {
		this._map = map;
	},

	addHooks: function () {
		this._map.on('filedownloadready', this._onFileReady, this);
	},

	removeHooks: function () {
		this._map.off('filedownloadready', this._onFileReady, this);
	},

	_onFileReady: function (e) {
		// we need to load the pdf document and pass it to the iframe as an
		// object URL, because else we might have cross origin security problems
		var xmlHttp = new XMLHttpRequest();
		xmlHttp.onreadystatechange = window.L.bind(function () {
			if (xmlHttp.readyState === 4 && xmlHttp.status === 200) {
				this._onInitPrint(xmlHttp);
			}
		}, this);
		xmlHttp.open('GET', e.url, true);
		xmlHttp.responseType = 'blob';
		xmlHttp.send();
	},

	_onInitPrint: function (e) {
		var blob = new Blob([e.response], {type: 'application/pdf'});
		var url = URL.createObjectURL(blob);
		// A browser that says it will not show PDFs inline (Chrome/Edge "Download
		// PDF files", the AlwaysOpenPdfExternally policy) is handed the PDF up
		// front. Through the frame it may never fire load, so Print
		// did nothing, or save the PDF itself as well as the copy the fallback
		// below downloads. Where the browser does not say (undefined), the frame
		// and its fallback decide, as before.
		if (window.navigator && window.navigator.pdfViewerEnabled === false) {
			this._downloadForPrint(url);
			return;
		}
		this._printIframe = window.L.DomUtil.create('iframe', '', document.body);
		this._printIframe.title = _('Print dialog');
		this._printIframe.onload = window.L.bind(this._onIframeLoaded, this);
		window.L.DomUtil.setStyle(this._printIframe, 'visibility', 'hidden');
		if (window.L.Browser.safari) {
			// In Safari, 'visibility: hidden' does not work.
			window.L.DomUtil.setStyle(this._printIframe, 'display', 'none');
		}
		window.L.DomUtil.setStyle(this._printIframe, 'position', 'fixed');
		window.L.DomUtil.setStyle(this._printIframe, 'right', '0');
		window.L.DomUtil.setStyle(this._printIframe, 'bottom', '0');
		this._printIframe.src = url;
	},

	_onIframeLoaded: function () {
		this._printIframe.contentWindow.focus(); // Required for IE
		if (window.L.Browser.safari) {
			// In Safari, we have to wait until the PDF iframe is rendered.
			// Wait 2 paint cycles to be safe.
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					this._printOrDownload();
				});
			});
		} else {
			this._printOrDownload();
		}
		// couldn't find another way to remove it
		setTimeout(window.L.bind(this._closePrintIframe, this, this._printIframe), 300 * 1000);
	},

	// The frame holds the PDF only when the browser shows PDFs inline. A browser
	// set to download them instead (Chrome/Edge "Download PDF files", or the
	// AlwaysOpenPdfExternally policy) aborts the frame's navigation and leaves an
	// opaque cross-origin error page, whose print() throws a SecurityError. Hand
	// over the PDF we already hold rather than do nothing: the server
	// serves a download id once, so it cannot be fetched again.
	_printOrDownload: function () {
		try {
			this._printIframe.contentWindow.print();
		} catch (err) {
			window.app.console.warn('Print: the browser will not show the PDF, downloading it: ' + err);
			this._downloadForPrint(this._printIframe.src);
		}
	},

	_downloadForPrint: function (url) {
		var name = this._map['wopi'].BaseFileName || '';
		var dot = name.lastIndexOf('.');
		name = (dot > 0 ? name.substring(0, dot) : name) || 'document';
		var link = window.L.DomUtil.create('a', '', document.body);
		link.href = url;
		link.download = name + '.pdf';
		link.click();
		window.L.DomUtil.remove(link);
		this._map.uiManager.showSnackbar(
			_('Your browser downloads PDFs instead of opening them, so the print copy was downloaded. Open it to print.'));
	},

	_closePrintIframe: function (printIframe) {
		window.L.DomUtil.remove(printIframe);
		this._map.focus();
	}
});

window.L.Map.addInitHook('addHandler', 'printHandler', window.L.Map.Print);
