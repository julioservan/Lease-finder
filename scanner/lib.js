/** Utilidades compartidas del escáner CLI (scan.js y watch.js). */
'use strict';

var fs = require('fs');
var path = require('path');

var USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function looksLikeHtml(content) {
  return /<\s*(?:html|body|div|p|table|span|!doctype)/i.test(content);
}

/** Lee una URL (http/https) o un archivo local y devuelve su contenido. */
function readSource(source, timeoutMs) {
  if (/^https?:\/\//i.test(source)) {
    if (typeof fetch !== 'function') {
      return Promise.reject(new Error('Este Node no tiene fetch; usa Node 18+ o descarga la página a un archivo.'));
    }
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeoutMs || 30000);
    return fetch(source, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-US,en;q=0.8,es;q=0.6' },
      redirect: 'follow',
      signal: controller.signal
    }).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    }, function (err) {
      clearTimeout(timer);
      throw err.name === 'AbortError' ? new Error('timeout') : err;
    });
  }
  return new Promise(function (resolve, reject) {
    fs.readFile(path.resolve(source), 'utf8', function (err, data) {
      if (err) reject(err); else resolve(data);
    });
  });
}

module.exports = {
  USER_AGENT: USER_AGENT,
  looksLikeHtml: looksLikeHtml,
  readSource: readSource
};
