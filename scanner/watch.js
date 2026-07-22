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
var browser = require('./browser.js');
var JsonLd = require('./jsonld.js');
var OfferParser = require('../js/offer-parser.js');
var RankedModels = require('../js/models.js');

var ROOT = path.join(__dirname, '..');
var DATA_DIR = path.join(ROOT, 'data');
var LATEST = path.join(DATA_DIR, 'offers-latest.json');
var STATUS = path.join(DATA_DIR, 'scan-status.json');
var HISTORY = path.join(DATA_DIR, 'price-history.json');
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
  // Con nombre: clave estable por vehículo (permite detectar bajadas de
  // precio). Sin nombre: incluir la mensualidad para que varias ofertas
  // anónimas de la misma fuente no se aplasten entre sí.
  var namePart = parsed.name ? parsed.name : 's/n|' + metrics.monthlyPayment;
  return (sourceName + '|' + namePart + '|' + metrics.term).toLowerCase();
}

/** Normaliza para comparar modelos: minúsculas y sin espacios/guiones (cx-50 = cx50). */
function normalizeModel(s) {
  return String(s || '').toLowerCase().replace(/[\s\-]/g, '');
}

var MAKES_RE = /honda|toyota|ford|gmc|hyundai|kia|mazda|subaru|nissan|jeep|volkswagen|chevrolet|buick|bmw|chrysler|dodge|ram|acura|lexus|audi|volvo/i;

/** ¿El nombre identifica un vehículo concreto (año + marca)? */
function isVehicleName(name) {
  var n = String(name || '');
  return /\b20\d{2}\b/.test(n) && MAKES_RE.test(n);
}

/**
 * Texto contra el que clasificar el modelo de una oferta. Si el nombre ya
 * identifica el vehículo (año + marca), manda el nombre: el texto crudo
 * arrastra menciones de modelos VECINOS de la misma página y provocaba
 * atribuciones falsas (p. ej. un lease del HR-V contado como CR-V).
 */
function offerHaystack(name, raw) {
  return isVehicleName(name)
    ? normalizeModel(name)
    : normalizeModel((name || '') + ' ' + (raw || ''));
}

/**
 * Fuentes POR-MODELO (páginas de broker/dealer dedicadas a un solo coche,
 * p. ej. viplease.com/best-jeep-lease-deals-nyc/jeep-cherokee/): la página
 * ES de ese modelo, así que cualquier mensualidad que salga es de él. Si la
 * oferta no trae ya un nombre de vehículo, se le estampa el modelo de la
 * fuente para que la atribución sea infalible (aquí y en la web).
 */
function stampModel(parsed, source, year) {
  if (!source.model) return;
  if (isVehicleName(parsed.name)) return; // ya identifica un vehículo concreto
  parsed.name = (year ? year + ' ' : '') + source.model;
}

/** Clave del modelo (sin la marca): "Kia Sorento" → "sorento", "Mazda CX-50" → "cx50". */
function modelKeyOf(label) {
  return normalizeModel(String(label || '').replace(MAKES_RE, ' '));
}

/** ¿La oferta menciona alguno de los modelos objetivo? */
function matchesTarget(parsed, targetModels) {
  if (!targetModels || !targetModels.length) return false;
  var haystack = offerHaystack(parsed.name, parsed.raw);
  return targetModels.some(function (model) {
    return haystack.indexOf(normalizeModel(model)) >= 0;
  });
}

function scanContent(content) {
  var isHtml = lib.looksLikeHtml(content);
  var text = isHtml ? OfferParser.htmlToText(content) : content;
  var offers = OfferParser.scanText(text);
  if (!isHtml) return offers;

  // Además del texto visible, mira el JSON-LD (datos estructurados que
  // incrustan Dealer.com/DealerInspire/DealerOn/CDK): las promos ahí suelen
  // traer la mensualidad aunque la maquetación la esconda.
  JsonLd.offerTexts(content).forEach(function (t) {
    OfferParser.scanText(t).forEach(function (o) {
      var dup = offers.some(function (p) { return p.monthly === o.monthly && p.term === o.term; });
      if (!dup) offers.push(o);
    });
  });
  return offers;
}

/** Nota de diagnóstico: cuántos vehículos estructurados tiene la página. */
function jsonLdNote(content) {
  if (!lib.looksLikeHtml(content)) return '';
  var n = JsonLd.vehicles(content).length;
  return n > 0 ? ' [' + n + ' vehículos en JSON-LD]' : '';
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
      return attempt(i + 1, errors.concat('sin ofertas en ' + urls[i] + jsonLdNote(content)));
    }, function (err) {
      return attempt(i + 1, errors.concat(err.message + ' en ' + urls[i]));
    });
  };
  return attempt(0, []);
}

/** Reintenta UNA fuente con el navegador headless probando sus URLs en orden. */
async function browserRetryOne(r) {
  var urls = r.source.urls.filter(function (u) { return /^(https?|file):\/\//i.test(u); });
  var errors = [];
  for (var j = 0; j < urls.length; j++) {
    try {
      var html = await browser.renderPage(urls[j]);
      var offers = scanContent(html);
      if (offers.length > 0) {
        r.offers = offers;
        r.url = urls[j];
        r.status = 'ok (' + offers.length + ' ofertas, con navegador)';
        return;
      }
      errors.push('sin ofertas (navegador) en ' + urls[j] + jsonLdNote(html));
    } catch (e) {
      errors.push(e.message + ' (navegador) en ' + urls[j]);
    }
  }
  if (r.offers.length === 0 && errors.length) r.status += ' · ' + errors.join(' · ');
}

/**
 * Segunda pasada con navegador headless (si está instalado): reintenta las
 * fuentes que no dieron ofertas con fetch simple, ejecutando el JavaScript
 * de la página. En PARALELO con un límite de concurrencia (cada pestaña usa
 * su propio contexto), para que el escaneo no tarde varios minutos.
 */
async function browserRetry(results, concurrency) {
  var pending = results.filter(function (r) { return r.offers.length === 0 && r.source.urls; });
  var limit = concurrency || 4;
  var next = 0;
  async function worker() {
    while (next < pending.length) {
      var r = pending[next++];
      await browserRetryOne(r);
    }
  }
  var workers = [];
  for (var w = 0; w < Math.min(limit, pending.length); w++) workers.push(worker());
  await Promise.all(workers);
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
    (e.isTarget ? '🎯 ' : '') + (e.name || 'Oferta sin nombre'),
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
  var minMonthly = settings.minMonthly == null ? 80 : settings.minMonthly;
  var targetModels = settings.targetModels || [];
  var now = new Date().toISOString();

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(REPORT)) fs.unlinkSync(REPORT);

  var enabled = (config.sources || []).filter(function (s) { return s.enabled !== false; });
  console.log('Vigilando ' + enabled.length + ' fuente(s) + inbox…\n');

  var useBrowser = settings.useBrowser !== false && browser.isAvailable();

  Promise.all(enabled.map(scanSource)).then(function (results) {
    var anyFailed = results.some(function (r) { return r.offers.length === 0; });
    if (useBrowser && anyFailed) {
      console.log('Reintentando fuentes sin ofertas con navegador headless…\n');
      return browserRetry(results).then(function () { return results; });
    }
    if (!useBrowser && anyFailed && !browser.isAvailable()) {
      console.log('(Tip: instala playwright para reintentar con navegador las fuentes que fallan:');
      console.log(' npm i -D playwright && npx playwright install chromium)\n');
    }
    return results;
  }).then(function (results) {
    results = results.concat(scanInbox(settings.inboxDir));

    var statusLines = results.map(function (r) {
      var line = '• ' + r.source.name + ': ' + r.status;
      console.log(line);
      return line;
    });

    // Entradas actuales con métricas
    var current = [];
    var thisYear = new Date().getFullYear();
    results.forEach(function (r) {
      r.offers.forEach(function (parsed) {
        stampModel(parsed, r.source, thisYear); // fuentes por-modelo: atribución fiable
        // Guardarraíl: una fuente por-modelo aporta SOLO su modelo. Las páginas
        // de broker cruzan modelos ("ofertas relacionadas"); una oferta con
        // nombre de OTRO coche (p. ej. un Bronco Sport en la página del Sorento)
        // se descarta aquí — ya la recogerá la fuente de ESE modelo.
        if (r.source.model &&
            offerHaystack(parsed.name, parsed.raw).indexOf(modelKeyOf(r.source.model)) < 0) return;
        var metrics = OfferParser.scoreOffer(parsed);
        if (metrics.monthlyPayment == null) return;
        // Filtro de plausibilidad: mensualidades ínfimas suelen ser ruido
        // (tasas "por cada $1,000 financiados", promociones de accesorios…).
        if (metrics.monthlyPayment < minMonthly) return;
        // Tope de plausibilidad: ningún SUV compacto/medio de la lista se
        // leasea por >$950/mes; por encima suele ser un total o un misparse
        // de las páginas de broker (precios WooCommerce sueltos).
        if (metrics.monthlyPayment > 950) return;
        if (/per\s+\$?1[,.]?000|por\s+cada\s+\$?1[,.]?000/i.test(parsed.raw || '')) return;
        // Estimaciones de FINANCIACIÓN/compra disfrazadas de lease.
        if (OfferParser.looksLikeFinancing(parsed.raw || '')) return;
        // Red de seguridad: ningún lease real cuesta >1.7% del MSRP al mes
        // (eso es un pago de préstamo, no de lease).
        if (metrics.pctOfMsrp != null && metrics.pctOfMsrp > 1.7) return;
        // Sin ruido: si está activado, solo los modelos candidatos
        if (settings.onlyTargetModels && !matchesTarget(parsed, targetModels)) return;
        current.push({
          key: offerKey(r.source.name, parsed, metrics),
          source: r.source.name,
          region: r.source.region || '',
          url: r.url || '',
          name: parsed.name,
          parsed: parsed,
          metrics: metrics,
          isTarget: matchesTarget(parsed, targetModels)
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
        isTarget: e.isTarget,
        firstSeen: prev ? prev.firstSeen : now,
        lastSeen: now
      };
    });
    var cutoff = Date.now() - staleDays * 24 * 60 * 60 * 1000;
    var offers = Object.keys(merged).map(function (k) { return merged[k]; })
      .filter(function (e) { return new Date(e.lastSeen).getTime() >= cutoff; })
      .filter(function (e) { return !settings.onlyTargetModels || e.isTarget; })
      // Purga las que quedaron guardadas de antes de este filtro (financiación).
      .filter(function (e) { return !OfferParser.looksLikeFinancing((e.parsed && e.parsed.raw) || ''); })
      .filter(function (e) { return !(e.metrics && e.metrics.pctOfMsrp != null && e.metrics.pctOfMsrp > 1.7); })
      // Purga ofertas de agregadores retirados (TrueCar/Edmunds ya no son fuentes).
      .filter(function (e) { return !/^(truecar|edmunds)\s*—/i.test(e.source || ''); })
      // Purga mensualidades imposibles guardadas antes del tope $950.
      .filter(function (e) { return !(e.metrics && e.metrics.monthlyPayment > 950); })
      // Purga cruces guardados: una fuente por-modelo solo conserva SU modelo.
      .filter(function (e) {
        var m = /^Lease NYC — (.+)$/.exec(e.source || '');
        if (!m) return true;
        return offerHaystack(e.name, e.parsed && e.parsed.raw).indexOf(modelKeyOf(m[1])) >= 0;
      });
    offers.sort(function (a, b) {
      var av = a.metrics.effectiveMonthly, bv = b.metrics.effectiveMonthly;
      return (av == null ? Infinity : av) - (bv == null ? Infinity : bv);
    });
    fs.writeFileSync(LATEST, JSON.stringify({ updatedAt: now, offers: offers }, null, 2));

    // Histórico de precios por modelo candidato (para tendencias en la app)
    var history = [];
    try {
      history = JSON.parse(fs.readFileSync(HISTORY, 'utf8'));
      if (!Array.isArray(history)) history = [];
    } catch (e) { /* primera vez */ }
    RankedModels.forEach(function (mm) {
      var f = normalizeModel(mm.model);
      var ms = offers.filter(function (e) {
        // Solo concesionarios/brokers reales: los agregadores no marcan tendencia
        // (la app también los oculta — así lo que ves y la serie coinciden).
        if (/agregador|por modelo/i.test(e.region || '') || /carsdirect|edmunds|truecar/i.test(e.source || '')) return false;
        var hay = offerHaystack(e.name, e.parsed && e.parsed.raw);
        return hay.indexOf(f) >= 0 && e.metrics && isFinite(e.metrics.effectiveMonthly);
      });
      var best = ms.length
        ? Math.min.apply(null, ms.map(function (e) { return e.metrics.effectiveMonthly; }))
        : null;
      history.push({
        t: now,
        model: mm.make + ' ' + mm.model,
        best: best == null ? null : Math.round(best * 100) / 100,
        count: ms.length
      });
    });
    if (history.length > 2000) history = history.slice(history.length - 2000);
    fs.writeFileSync(HISTORY, JSON.stringify(history, null, 1));

    // Estado por fuente para mostrarlo en la app web.
    fs.writeFileSync(STATUS, JSON.stringify({
      updatedAt: now,
      sources: results.map(function (r) {
        return { name: r.source.name, region: r.source.region || '', status: r.status };
      })
    }, null, 2));

    // Destacadas: buen score O uno de tus modelos objetivo.
    var highlights = news.concat(improved).filter(function (e) {
      return e.isTarget || (e.metrics.score != null && e.metrics.score >= alertScoreMin);
    });
    var targets = offers.filter(function (e) { return e.isTarget; });

    console.log('\nResumen: ' + current.length + ' oferta(s) activa(s), ' +
      news.length + ' nueva(s), ' + improved.length + ' mejorada(s), ' +
      highlights.length + ' destacada(s), ' +
      targets.length + ' de tus SUVs objetivo 🎯.');

    // Reporte solo si hay novedades
    if (news.length || improved.length) {
      var md = ['# 🚗 Novedades del escáner de leases', ''];
      if (targets.length) {
        md.push('## 🎯 Tus SUVs objetivo (todas las activas)', '');
        md = md.concat(tableHead(), targets.map(function (e) { return offerLine(e); }), ['']);
      }
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
    process.exitCode = 1;
  }).finally(function () {
    return browser.close();
  });
}

main();
