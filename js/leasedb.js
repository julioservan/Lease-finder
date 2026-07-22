/**
 * LeaseDB — base de datos local que CRECE a medida que descubrimos leases.
 *
 * Acumula en localStorage (clave lf-db-v1) todas las ofertas vistas (del robot,
 * de escaneos manuales, etc.) y una serie temporal del mejor precio por modelo,
 * y calcula la TENDENCIA (mejora/empeora desde hoy) y un SENTIMENT (valoración:
 * buena / espera / cara / la mejor). Puro: navegador y Node (para tests).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LeaseDB = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DB_KEY = 'lf-db-v1';

  function normalizeModel(s) {
    return String(s || '').toLowerCase().replace(/[\s\-]/g, '');
  }
  function isNum(v) { return v != null && isFinite(v); }
  function round2(n) { return Math.round(n * 100) / 100; }

  function nowISO() {
    try { return new Date().toISOString(); } catch (e) { return '1970-01-01T00:00:00.000Z'; }
  }
  function dayOf(iso) { return String(iso || '').slice(0, 10); }

  function load() {
    try {
      var raw = localStorage.getItem(DB_KEY);
      var db = raw ? JSON.parse(raw) : null;
      if (!db || typeof db !== 'object') db = {};
    } catch (e) { db = {}; }
    if (!db.offers) db.offers = {};   // key -> offer
    if (!db.series) db.series = {};   // "Make Model" -> [{t, best, count}]
    return db;
  }
  function save(db) {
    try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch (e) { /* lleno */ }
  }

  function modelKey(info) { return info.make + ' ' + info.model; }

  /** ¿La oferta menciona este modelo? (substring normalizado sobre nombre+raw) */
  var MAKES_RE = /honda|toyota|ford|gmc|hyundai|kia|mazda|subaru|nissan|jeep|volkswagen|chevrolet|buick|bmw|chrysler|dodge|ram|acura|lexus|audi|volvo/i;

  /**
   * ¿Estimación de agregador (CarsDirect/Edmunds/TrueCar)? Se OCULTAN en toda
   * la app: no son ofertas de un sitio donde puedas firmar. Los brokers de
   * lease (VIP…) sí se muestran — con ellos sí se firma.
   */
  function isAggregator(offer) {
    return /agregador|por modelo/i.test(offer.region || '') ||
      /carsdirect|edmunds|truecar/i.test(offer.source || '');
  }

  function offerMatches(offer, info) {
    // Si el nombre ya identifica el vehículo (año + marca), manda el nombre:
    // el texto crudo arrastra modelos vecinos de la misma página y provocaba
    // atribuciones falsas (un lease del HR-V contado como CR-V).
    var name = offer.name || '';
    var vehicleName = /\b20\d{2}\b/.test(name) && MAKES_RE.test(name);
    var hay = vehicleName
      ? normalizeModel(name)
      : normalizeModel(name + ' ' + ((offer.parsed && offer.parsed.raw) || ''));
    return hay.indexOf(normalizeModel(info.model)) >= 0;
  }

  /**
   * Vuelca en la BD local las ofertas del robot y la serie de precios del
   * servidor, y añade un snapshot del mejor precio de hoy por modelo. Devuelve
   * la BD ya persistida.
   */
  function ingest(offers, history, infos) {
    var db = load();
    var now = nowISO();

    // 1) Ofertas: unión por key, conservando firstSeen.
    (offers || []).forEach(function (o) {
      if (!o || !o.key) return;
      var prev = db.offers[o.key];
      db.offers[o.key] = {
        key: o.key,
        source: o.source || (prev && prev.source) || '',
        region: o.region || (prev && prev.region) || '',
        url: o.url || (prev && prev.url) || '',
        name: o.name || (prev && prev.name) || '',
        parsed: o.parsed || (prev && prev.parsed) || {},
        metrics: o.metrics || (prev && prev.metrics) || {},
        firstSeen: (prev && prev.firstSeen) || o.firstSeen || now,
        lastSeen: o.lastSeen || now
      };
    });

    // 2) Serie del servidor (price-history.json): fusiona por (model, t).
    (history || []).forEach(function (p) {
      if (!p || !p.model) return;
      var arr = db.series[p.model] || (db.series[p.model] = []);
      if (!arr.some(function (x) { return x.t === p.t; })) {
        arr.push({ t: p.t, best: p.best, count: p.count });
      }
    });

    // 3) Snapshot local de hoy: el mejor efectivo actual por modelo. Añade un
    //    punto si el día cambió o el mejor precio cambió (así crece sola).
    (infos || []).forEach(function (info) {
      var mk = modelKey(info);
      var b = bestOffer(db, info);
      var best = b ? round2(b.metrics.effectiveMonthly) : null;
      var arr = db.series[mk] || (db.series[mk] = []);
      var last = arr.length ? arr[arr.length - 1] : null;
      var changed = !last || dayOf(last.t) !== dayOf(now) || last.best !== best;
      if (changed && (best != null || (last && last.best != null))) {
        arr.push({ t: now, best: best, count: b ? offersFor(db, info).length : 0 });
      }
      if (arr.length > 400) db.series[mk] = arr.slice(arr.length - 400);
    });

    save(db);
    return db;
  }

  function offersFor(db, info) {
    var out = [];
    for (var k in db.offers) {
      var o = db.offers[k];
      if (!o || isAggregator(o)) continue; // solo concesionarios/brokers reales
      if (offerMatches(o, info) && o.metrics && isNum(o.metrics.effectiveMonthly)) out.push(o);
    }
    out.sort(function (a, b) { return a.metrics.effectiveMonthly - b.metrics.effectiveMonthly; });
    return out;
  }
  function bestOffer(db, info) { var a = offersFor(db, info); return a[0] || null; }

  function seriesFor(db, info) {
    var arr = (db.series[modelKey(info)] || []).filter(function (p) { return isNum(p.best); });
    arr.sort(function (a, b) { return a.t < b.t ? -1 : a.t > b.t ? 1 : 0; });
    return arr;
  }

  /**
   * Tendencia del mejor precio: dir -1 baja (mejora, bueno para lease),
   * +1 sube, 0 estable. Además deltas desde hoy y desde el primer registro,
   * y el mínimo histórico.
   */
  function trendFor(db, info) {
    var s = seriesFor(db, info);
    if (!s.length) return { dir: 0, points: 0, last: null, low: null, deltaToday: null, deltaFirst: null, atLow: false };
    var last = s[s.length - 1].best;
    var low = Math.min.apply(null, s.map(function (p) { return p.best; }));
    var firstOverall = s[0].best;
    // baseline "desde hoy": primer punto cuyo día == día del último punto
    var lastDay = dayOf(s[s.length - 1].t);
    var baseToday = firstOverall;
    for (var i = 0; i < s.length; i++) { if (dayOf(s[i].t) === lastDay) { baseToday = s[i].best; break; } }
    // dirección: último vs punto distinto anterior
    var prev = null;
    for (var j = s.length - 2; j >= 0; j--) { if (s[j].best !== last) { prev = s[j].best; break; } }
    var dir = 0;
    if (prev != null) dir = last < prev ? -1 : 1;
    else if (last < baseToday - 0.5) dir = -1;
    else if (last > baseToday + 0.5) dir = 1;
    return {
      dir: dir, points: s.length, last: last, low: low, prev: prev,
      deltaToday: round2(last - baseToday),
      deltaFirst: round2(last - firstOverall),
      atLow: last <= low + 0.5
    };
  }

  /**
   * Valoración automática de un modelo a partir de la regla del 1% (pago
   * efectivo ÷ MSRP), la tendencia y su mínimo histórico. Devuelve
   * { level, label, pct, best, trend, reason }. El nivel 'best' (⭐ la mejor)
   * lo asigna la app tras comparar todos los modelos.
   */
  function assess(db, info, intel) {
    var offers = offersFor(db, info);
    var trend = trendFor(db, info);
    if (!offers.length) {
      return { level: 'none', label: 'Sin datos', pct: null, best: null, trend: trend,
        reason: 'El robot aún no ha encontrado ofertas de lease de este modelo.' };
    }
    var best = offers[0].metrics.effectiveMonthly;
    var pct = (info.msrp > 0) ? (best / info.msrp) * 100 : null;

    var level, label;
    if (pct != null && pct <= 1.0) { level = 'good'; label = 'Buena'; }
    else if (trend.dir < 0 && !trend.atLow) { level = 'wait'; label = 'Espera · bajando'; }
    else if (pct != null && pct > 1.35) { level = 'pricey'; label = 'Cara'; }
    else { level = 'ok'; label = 'Normal'; }

    var bits = [];
    if (pct != null) bits.push('Regla 1%: ' + pct.toFixed(2) + '% del MSRP');
    if (trend.dir < 0 && trend.deltaToday != null) bits.push('📉 baja ' + Math.abs(trend.deltaToday).toFixed(0) + '$/mes hoy');
    else if (trend.dir > 0 && trend.deltaToday != null) bits.push('📈 sube ' + Math.abs(trend.deltaToday).toFixed(0) + '$/mes hoy');
    if (trend.atLow && trend.points > 1) bits.push('en su mínimo visto');
    if (intel && intel.verdict) bits.push(intel.verdict);

    return { level: level, label: label, pct: pct, best: best, trend: trend, offers: offers.length, reason: bits.join(' · ') };
  }

  // API pública: recibe la BD internamente (load) para simplificar el uso.
  return {
    ingest: ingest,
    offersFor: function (info) { return offersFor(load(), info); },
    bestOffer: function (info) { return bestOffer(load(), info); },
    seriesFor: function (info) { return seriesFor(load(), info); },
    trendFor: function (info) { return trendFor(load(), info); },
    assess: function (info, intel) { return assess(load(), info, intel); },
    normalizeModel: normalizeModel,
    _load: load
  };
});
