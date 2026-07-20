#!/usr/bin/env node
/**
 * Vigilante de ofertas: escanea las fuentes de scanner/sources.json (y los
 * archivos que dejes en data/inbox/), compara contra la corrida anterior y
 * reporta ofertas NUEVAS o MEJORADAS.
 *
 * Uso:
 *   node scanner/watch.js            # escaneo + reporte en consola
 *   node scanner/watch.js --ci       # además escribe resumen para GitHub Actions
 *   node scanner/watch.js --sources otra/config.json
 *
 * Archivos:
 *   data/offers-latest.json — estado acumulado (histórico de ofertas vistas)
 *   data/report.md          — solo se crea cuando hay novedades (lo usa el
 *                             GitHub Action para abrir un issue)
 */
'use strict';

var fs = require('fs');
var path = require('path');
var lib = require('./lib.js');
var OfferParser = require('../js/offer-parser.js');

var ROOT = path.join(__dirname, '..');
var DATA_DIR = path.join(ROOT, 'data');
var LATEST = path.join(DATA_DIR, 'offers-latest.json');
var REPORT = path.join(DATA_DIR, 'report.md');

function arg(flag) {
  var i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] || true) : null;
}

function fmt(v, dec) {
  if (v == null || !isFinite(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec == null ? 0 : dec });
}

function offerKey(sourceName, parsed, metrics) {
  return (sourceName + '|' + (parsed.name || 's/n') + '|' + metrics.term).toLowerCase();
}

function scanContent(content) {
  var text = lib.looksLikeHtml(content) ? OfferParser.htmlToText(content) : content;
  return OfferParser.scanText(text);
}

/** Intenta las URLs de una fuente en orden hasta que alguna dé ofertas. */
function scanSource(source) {
  var urls = source.urls || [source.url];
  var attempt = function (i, errors) {
    if (i >= urls.length) {
      return Promise.resolve({ source: source, offers: [], status: errors.join(' · ') || 'sin ofertas detectadas' });
    }
    return lib.readSource(urls[i]).then(function (content) {
      var offers = scanContent(content);
      if (offers.length > 0) {
        return { source: source, url: urls[i], offers: offers, status: 'ok (' + offers.length + ' ofertas)' };
      }
      return attempt(i + 1, errors.concat('sin ofertas en ' + urls[i]));
    }, function (err) {
      return attempt(i + 1, errors.concat(err.message + ' en ' + urls[i]));
    });
  };
  return attempt(0, []);
}

function scanInbox(inboxDir) {
  var dir = path.join(ROOT, inboxDir || 'data/inbox');
  var results = [];
  var files;
  try {
    files = fs.readdirSync(dir).filter(function (f) { return /\.(txt|md|html?)$/i.test(f); });
  } catch (e) {
    return results;
  }
  files.forEach(function (f) {
    try {
      var offers = scanContent(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (offers.length) {
        results.push({
          source: { name: 'inbox/' + f, region: 'local' },
          offers: offers,
          status: 'ok (' + offers.length + ' ofertas)'
        });
      }
    } catch (e) { /* archivo ilegible: ignorar */ }
  });
  return results;
}

function loadPrevious() {
  try {
    var parsed = JSON.parse(fs.readFileSync(LATEST, 'utf8'));
    return Array.isArray(parsed.offers) ? parsed.offers : [];
  } catch (e) {
    return [];
  }
}

function mdRow(cells) { return '| ' + cells.join(' | ') + ' |'; }

function offerLine(e, extra) {
  var cells = [
    e.name || 'Oferta sin nombre',
    e.source + (e.region ? ' (' + e.region + ')' : ''),
    '$' + fmt(e.metrics.monthlyPayment, 2) + '/mes',
    e.metrics.term + ' m',
    '$' + fmt(e.metrics.driveOff),
    e.parsed.msrp ? '$' + fmt(e.parsed.msrp) : '—',
    '$' + fmt(e.metrics.effectiveMonthly, 2),
    e.metrics.score == null ? '—' : fmt(e.metrics.score, 1)
  ];
  if (extra !== undefined) cells.push(extra);
  return mdRow(cells);
}

function tableHead(extra) {
  var cols = ['Oferta', 'Fuente', 'Mensual', 'Plazo', 'Inicial', 'MSRP', 'Efectivo/mes', 'Score'];
  if (extra !== undefined) cols.push(extra);
  return [
    mdRow(cols),
    mdRow(cols.map(function () { return '---'; }))
  ];
}

function main() {
  var sourcesPath = arg('--sources') || path.join(__dirname, 'sources.json');
  var ci = process.argv.indexOf('--ci') >= 0;
  var config = JSON.parse(fs.readFileSync(sourcesPath, 'utf8'));
  var settings = config.settings || {};
  var alertScoreMin = settings.alertScoreMin == null ? 7 : settings.alertScoreMin;
  var staleDays = settings.staleDays == null ? 45 : settings.staleDays;
  var now = new Date().toISOString();

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(REPORT)) fs.unlinkSync(REPORT);

  var enabled = (config.sources || []).filter(function (s) { return s.enabled !== false; });
  console.log('Vigilando ' + enabled.length + ' fuente(s) + inbox…\n');

  Promise.all(enabled.map(scanSource)).then(function (results) {
    results = results.concat(scanInbox(settings.inboxDir));

    var statusLines = results.map(function (r) {
      var line = '• ' + r.source.name + ': ' + r.status;
      console.log(line);
      return line;
    });

    // Entradas actuales con métricas
    var current = [];
    results.forEach(function (r) {
      r.offers.forEach(function (parsed) {
        var metrics = OfferParser.scoreOffer(parsed);
        if (metrics.monthlyPayment == null) return;
        current.push({
          key: offerKey(r.source.name, parsed, metrics),
          source: r.source.name,
          region: r.source.region || '',
          url: r.url || '',
          name: parsed.name,
          parsed: parsed,
          metrics: metrics
        });
      });
    });

    // Diff contra el estado anterior
    var previous = loadPrevious();
    var prevByKey = {};
    previous.forEach(function (e) { prevByKey[e.key] = e; });

    var news = [];
    var improved = [];
    current.forEach(function (e) {
      var prev = prevByKey[e.key];
      if (!prev) {
        news.push(e);
      } else if (isFinite(e.metrics.effectiveMonthly) && isFinite(prev.metrics.effectiveMonthly) &&
                 e.metrics.effectiveMonthly < prev.metrics.effectiveMonthly - 0.5) {
        e.previousEffective = prev.metrics.effectiveMonthly;
        improved.push(e);
      }
    });

    // Estado acumulado: actualiza vistas, conserva no-vistas hasta staleDays
    var merged = {};
    previous.forEach(function (e) { merged[e.key] = e; });
    current.forEach(function (e) {
      var prev = merged[e.key];
      merged[e.key] = {
        key: e.key, source: e.source, region: e.region, url: e.url,
        name: e.name, parsed: e.parsed, metrics: e.metrics,
        firstSeen: prev ? prev.firstSeen : now,
        lastSeen: now
      };
    });
    var cutoff = Date.now() - staleDays * 24 * 60 * 60 * 1000;
    var offers = Object.keys(merged).map(function (k) { return merged[k]; })
      .filter(function (e) { return new Date(e.lastSeen).getTime() >= cutoff; });
    offers.sort(function (a, b) {
      var av = a.metrics.effectiveMonthly, bv = b.metrics.effectiveMonthly;
      return (av == null ? Infinity : av) - (bv == null ? Infinity : bv);
    });
    fs.writeFileSync(LATEST, JSON.stringify({ updatedAt: now, offers: offers }, null, 2));

    var highlights = news.concat(improved).filter(function (e) {
      return e.metrics.score != null && e.metrics.score >= alertScoreMin;
    });

    console.log('\nResumen: ' + current.length + ' oferta(s) activa(s), ' +
      news.length + ' nueva(s), ' + improved.length + ' mejorada(s), ' +
      highlights.length + ' destacada(s) (score ≥ ' + alertScoreMin + ').');

    // Reporte solo si hay novedades
    if (news.length || improved.length) {
      var md = ['# 🚗 Novedades del escáner de leases', ''];
      if (highlights.length) {
        md.push('## ⭐ Destacadas (score ≥ ' + alertScoreMin + ')', '');
        md = md.concat(tableHead(), highlights.map(function (e) { return offerLine(e); }), ['']);
      }
      if (news.length) {
        md.push('## Nuevas (' + news.length + ')', '');
        md = md.concat(tableHead(), news.map(function (e) { return offerLine(e); }), ['']);
      }
      if (improved.length) {
        md.push('## Mejoraron de precio (' + improved.length + ')', '');
        md = md.concat(tableHead('Antes'), improved.map(function (e) {
          return offerLine(e, '⬇ $' + fmt(e.previousEffective, 2));
        }), ['']);
      }
      md.push('## Estado de las fuentes', '');
      statusLines.forEach(function (l) { md.push('- ' + l.slice(2)); });
      md.push('', '_Generado por `scanner/watch.js` — ' + now + '_');
      fs.writeFileSync(REPORT, md.join('\n'));
      console.log('\nReporte con novedades: data/report.md');
    } else {
      console.log('\nSin novedades hoy.');
    }

    if (ci && process.env.GITHUB_STEP_SUMMARY) {
      var summary = fs.existsSync(REPORT)
        ? fs.readFileSync(REPORT, 'utf8')
        : '## Escáner de leases\n\nSin novedades. Fuentes:\n' +
          statusLines.map(function (l) { return '- ' + l.slice(2); }).join('\n');
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
    }
  }).catch(function (err) {
    console.error('Error inesperado: ' + (err && err.stack || err));
    process.exit(1);
  });
}

main();
