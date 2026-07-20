#!/usr/bin/env node
/**
 * Herramienta de depuración: renderiza una URL con el navegador headless,
 * la convierte a texto y muestra el contexto alrededor de cada mención de
 * mensualidad. Sirve para afinar el parser cuando una fuente entrega
 * ofertas sin nombre o mal atribuidas.
 *
 * Uso: node scanner/debug-page.js <url> [maxSegmentos]
 */
'use strict';

var browser = require('./browser.js');
var lib = require('./lib.js');
var OfferParser = require('../js/offer-parser.js');

var url = process.argv[2];
var maxSegments = parseInt(process.argv[3], 10) || 10;
if (!url) {
  console.error('Uso: node scanner/debug-page.js <url> [maxSegmentos]');
  process.exit(1);
}

function getContent() {
  if (browser.isAvailable()) return browser.renderPage(url);
  return lib.readSource(url);
}

getContent().then(function (content) {
  var text = lib.looksLikeHtml(content) ? OfferParser.htmlToText(content) : content;
  console.log('Longitud del texto:', text.length, 'caracteres\n');

  var finder = /(?:\$|€|£)\s*[\d.,]+k?\s*(?:\+\s*(?:tax|iva|impuestos)\s*)?\/?\s*(?:mes|month|mo)\b|[\d.,]+k?\s*(?:\/|al\s+|por\s+|per\s+)\s*(?:mes|month|mo)\b/gi;
  var m;
  var count = 0;
  while ((m = finder.exec(text)) !== null && count < maxSegments) {
    count++;
    var back = text.slice(Math.max(0, m.index - 600), m.index);
    var fwd = text.slice(m.index, Math.min(text.length, m.index + 250));
    console.log('================ SEGMENTO ' + count + ' (match: "' + m[0] + '") ================');
    console.log('--- 600 chars ANTES ---');
    console.log(JSON.stringify(back));
    console.log('--- match + 250 chars DESPUÉS ---');
    console.log(JSON.stringify(fwd));
    console.log('');
  }
  console.log('Total de menciones de mensualidad recorridas:', count);

  var offers = OfferParser.scanText(text);
  console.log('\nOfertas que extrae el parser actual: ' + offers.length);
  offers.slice(0, 15).forEach(function (o) {
    console.log('- name=' + JSON.stringify(o.name) + ' monthly=' + o.monthly +
      ' term=' + o.term + ' das=' + o.dueAtSigning + ' msrp=' + o.msrp);
  });
}).then(function () {
  return browser.close();
}, function (err) {
  console.error('ERROR: ' + err.message);
  return browser.close().then(function () { process.exit(1); });
});
