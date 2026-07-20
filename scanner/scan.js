#!/usr/bin/env node
/**
 * Escáner de ofertas por línea de comandos.
 *
 * Uso:
 *   node scanner/scan.js <url | archivo.txt | archivo.html> [...más fuentes]
 *   node scanner/scan.js ofertas.txt --json salida.json
 *
 * - Acepta URLs (http/https), archivos de texto o HTML.
 * - Extrae las ofertas con el mismo parser de la app web y las imprime
 *   ordenadas por costo efectivo mensual.
 * - Con --json genera un archivo compatible con "Importar JSON" de la app,
 *   para sumar las ofertas escaneadas al comparador.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var lib = require('./lib.js');
var browser = require('./browser.js');
var OfferParser = require('../js/offer-parser.js');

function usage() {
  console.log('Uso: node scanner/scan.js <url|archivo> [...más fuentes] [--json salida.json]');
  process.exit(1);
}

function fmt(v, decimals) {
  if (v == null || !isFinite(v)) return '—';
  return v.toLocaleString('es', {
    minimumFractionDigits: decimals || 0,
    maximumFractionDigits: decimals == null ? 0 : decimals
  });
}

function pad(s, w) {
  s = String(s);
  return s.length >= w ? s.slice(0, w) : s + new Array(w - s.length + 1).join(' ');
}

function padL(s, w) {
  s = String(s);
  return s.length >= w ? s : new Array(w - s.length + 1).join(' ') + s;
}

function main() {
  var args = process.argv.slice(2);
  var jsonOut = null;
  var jsonIdx = args.indexOf('--json');
  if (jsonIdx >= 0) {
    jsonOut = args[jsonIdx + 1];
    if (!jsonOut) usage();
    args.splice(jsonIdx, 2);
  }
  if (!args.length) usage();

  function scanContent(content) {
    var text = lib.looksLikeHtml(content) ? OfferParser.htmlToText(content) : content;
    return OfferParser.scanText(text);
  }

  // Si fetch falla o no encuentra ofertas, reintenta con navegador headless
  // (solo si playwright está instalado y la fuente es una URL).
  function scanWithFallback(source) {
    return lib.readSource(source).then(scanContent, function (err) {
      if (browser.isAvailable() && /^(https?|file):\/\//i.test(source)) return null;
      throw err;
    }).then(function (offers) {
      if (offers && offers.length > 0) return { offers: offers, via: 'fetch' };
      if (browser.isAvailable() && /^(https?|file):\/\//i.test(source)) {
        return browser.renderPage(source).then(function (html) {
          return { offers: scanContent(html), via: 'navegador' };
        });
      }
      return { offers: offers || [], via: 'fetch' };
    });
  }

  var all = [];
  var chain = Promise.resolve();
  args.forEach(function (source) {
    chain = chain.then(function () {
      return scanWithFallback(source).then(function (r) {
        console.log('• ' + source + ': ' + r.offers.length + ' oferta(s) detectada(s)' +
          (r.via === 'navegador' ? ' (con navegador)' : ''));
        r.offers.forEach(function (o) { all.push({ source: source, parsed: o }); });
      }, function (err) {
        console.error('• ' + source + ': ERROR — ' + err.message);
      });
    });
  });

  chain = chain.then(function () {
    if (!all.length) {
      console.log('\nNo se detectaron ofertas.');
      process.exitCode = 2;
      return;
    }

    var scored = all.map(function (o) {
      return { source: o.source, parsed: o.parsed, m: OfferParser.scoreOffer(o.parsed) };
    });
    scored.sort(function (a, b) {
      var av = a.m.effectiveMonthly, bv = b.m.effectiveMonthly;
      return (av == null ? Infinity : av) - (bv == null ? Infinity : bv);
    });

    console.log('\nOfertas ordenadas por costo efectivo mensual:\n');
    console.log(
      pad('#', 3) + pad('Oferta', 40) + padL('Mensual', 12) + padL('Plazo', 7) +
      padL('Inicial', 12) + padL('MSRP', 12) + padL('Efectivo', 12) + padL('% MSRP', 9) + padL('Score', 7)
    );
    scored.forEach(function (r, i) {
      console.log(
        pad(i + 1, 3) +
        pad(r.parsed.name || 'Oferta sin nombre', 40) +
        padL(fmt(r.m.monthlyPayment, 2), 12) +
        padL(r.m.term + ' m', 7) +
        padL(fmt(r.m.driveOff), 12) +
        padL(fmt(r.parsed.msrp), 12) +
        padL(fmt(r.m.effectiveMonthly, 2), 12) +
        padL(r.m.pctOfMsrp == null ? '—' : fmt(r.m.pctOfMsrp, 2) + '%', 9) +
        padL(r.m.score == null ? '—' : fmt(r.m.score, 1), 7)
      );
    });

    if (jsonOut) {
      var payload = scored.map(function (r, i) {
        return {
          id: 'scan-' + Date.now() + '-' + i,
          savedAt: new Date().toISOString(),
          kind: 'scanned',
          parsed: r.parsed,
          raw: r.parsed.raw,
          source: r.source
        };
      });
      fs.writeFileSync(path.resolve(jsonOut), JSON.stringify(payload, null, 2));
      console.log('\nGuardado ' + payload.length + ' oferta(s) en ' + jsonOut +
        ' — impórtalo en la app con “Importar JSON”.');
    }
  });

  chain.finally(function () { return browser.close(); });
}

main();
