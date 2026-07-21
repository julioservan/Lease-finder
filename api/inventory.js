/**
 * Función serverless (Vercel): consulta inventario REAL de concesionarios
 * cerca de Downtown Brooklyn usando la API de Auto.dev, sin exponer la clave
 * en la página.
 *
 * Configuración (una vez, en Vercel → proyecto lease-finder → Settings →
 * Environment Variables):
 *   AUTO_DEV_KEY   clave de https://www.auto.dev (1.000 llamadas/mes gratis)
 *
 * Uso desde la app:  GET /api/inventory?make=Honda&model=CR-V&zip=11201&radius=25
 * Devuelve un resumen normalizado: nº en stock, rango de precio, el más
 * barato (con concesionario y enlace) y una muestra de listados.
 */
'use strict';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://julioservan.github.io');
  if (req.method === 'OPTIONS') return res.status(204).end();

  var q = req.query || {};
  var make = (q.make || '').toString().trim();
  var model = (q.model || '').toString().trim();
  var trim = (q.trim || '').toString().trim();
  // Condición: 'new' (default, foco del proyecto: nuevo + lease), 'cpo', 'used' o 'all'.
  var cond = (q.cond || 'new').toString().trim().toLowerCase();
  var zip = (q.zip || '11201').toString().trim();
  var radius = (q.radius || '25').toString().trim();
  // Año mínimo (default 2025): filtra fuera los usados viejos y ahorra cuota.
  var minYear = parseInt(q.minYear, 10);
  if (!(minYear >= 1990)) minYear = 2025;
  var MAX_YEAR = 2027; // año-modelo máximo disponible
  var yearList = [];
  for (var y = minYear; y <= MAX_YEAR; y++) yearList.push(y);
  if (!make || !model) {
    return res.status(400).json({ ok: false, message: 'Faltan make y model.' });
  }

  var key = process.env.AUTO_DEV_KEY;
  if (!key) {
    return res.status(501).json({
      ok: false, needsKey: true,
      message: 'Falta AUTO_DEV_KEY en Vercel. Consíguela gratis en auto.dev (1.000 consultas/mes).'
    });
  }

  // Auto.dev usa parámetros con notación de punto (vehicle.make, vehicle.model)
  // e includes=total para conocer el total real de unidades.
  // Filtro de condición a Auto.dev (condition=New|Certified|Used).
  var CONDMAP = { new: 'New', cpo: 'Certified', used: 'Used' };
  var condParam = CONDMAP[cond] ? '&condition=' + CONDMAP[cond] : '';

  var base = 'https://api.auto.dev/listings' +
    '?vehicle.make=' + encodeURIComponent(make) +
    '&vehicle.model=' + encodeURIComponent(model) +
    (trim ? '&vehicle.trim=' + encodeURIComponent(trim) : '') +
    condParam +
    '&vehicle.year=' + encodeURIComponent(yearList.join(',')) +
    '&zip=' + encodeURIComponent(zip) +
    '&distance=' + encodeURIComponent(radius) +
    '&limit=50&includes=total';
  var MAX_PAGES = 3; // hasta ~60 unidades por consulta (cuida la cuota)

  function num(v) {
    if (v == null) return null;
    var n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
    return isFinite(n) ? n : null;
  }

  // Mapea la estructura real de Auto.dev (vehicle + retailListing).
  function normalize(listing) {
    var rl = listing.retailListing || {};
    var v = listing.vehicle || {};
    var used = rl.used === true;
    var cpo = rl.cpo === true;
    var vin = listing.vin || v.vin || '';
    return {
      title: [v.year, (v.make || make), (v.model || model), v.trim].filter(Boolean).join(' '),
      trim: v.trim || '',
      year: v.year || null,
      price: num(rl.price),
      msrp: num(v.baseMsrp),
      miles: num(rl.miles),
      condition: !used ? 'Nuevo' : (cpo ? 'CPO' : 'Usado'),
      dealer: typeof rl.dealer === 'string' ? rl.dealer : '',
      city: rl.city || '',
      state: rl.state || '',
      vin: vin,
      // Auto.dev (plan gratuito) NO expone la URL del anuncio del dealer (el
      // campo vdp es un fragmento interno). El enlace que SÍ aterriza en este
      // coche exacto es una búsqueda del VIN + concesionario; el Carfax por VIN
      // es el otro enlace real y directo que trae la API.
      url: vin
        ? 'https://www.google.com/search?q=' +
          encodeURIComponent('"' + vin + '" ' + (typeof rl.dealer === 'string' ? rl.dealer : (v.make || make) + ' ' + (v.model || model)))
        : '',
      carfax: rl.carfaxUrl || ''
    };
  }

  function extract(data) {
    var recs = data.records || data.listings || data.results || data.data ||
      (Array.isArray(data) ? data : []);
    return Array.isArray(recs) ? recs : [];
  }

  async function getPage(page) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 9000);
    try {
      var r = await fetch(base + '&page=' + page, {
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!r.ok) return { err: r.status, body: (await r.text()).slice(0, 160) };
      return { data: await r.json() };
    } catch (e) {
      clearTimeout(timer);
      return { err: e.name === 'AbortError' ? 'timeout' : e.message };
    }
  }

  try {
    var first = await getPage(1);
    if (first.err) {
      return res.status(502).json({ ok: false, message: 'Auto.dev respondió ' + first.err + (first.body ? ': ' + first.body : '') });
    }
    var data = first.data;
    var total = data.total != null ? data.total : (data.totalCount != null ? data.totalCount :
      (data.meta && data.meta.total != null ? data.meta.total : null));
    var records = extract(data);

    if (q.debug) {
      return res.status(200).json({ ok: true, topKeys: Object.keys(data), total: total, page1: records.length });
    }

    // Trae páginas extra hasta MAX_PAGES o hasta cubrir el total.
    for (var pg = 2; pg <= MAX_PAGES; pg++) {
      if (total != null && records.length >= total) break;
      var more = await getPage(pg);
      if (more.err || !more.data) break;
      var rec = extract(more.data);
      if (!rec.length) break;
      records = records.concat(rec);
    }

    var items = records.map(normalize).filter(function (x) {
      return x.price != null && (!x.year || x.year >= minYear); // red de seguridad del año
    });
    // Red de seguridad del trim: si la API ignorase vehicle.trim, filtramos aquí.
    if (trim) {
      var before = items.length;
      var tLow = trim.toLowerCase();
      items = items.filter(function (x) {
        return (x.trim || x.title || '').toLowerCase().indexOf(tLow) >= 0;
      });
      // El total de la API ya no sería fiable si tuvo que filtrarse localmente.
      if (items.length < before) total = null;
    }
    items.sort(function (a, b) { return a.price - b.price; });

    var prices = items.map(function (x) { return x.price; });
    function ofCond(c) { return items.filter(function (x) { return x.condition === c; }); }
    function condCount(c) { return ofCond(c).length; }
    function cheapestOf(c) { return ofCond(c)[0] || null; }
    // Rango de precio por condición (items ya viene ordenado asc por precio).
    function rangeOf(c) {
      var g = ofCond(c);
      if (!g.length) return null;
      return { count: g.length, min: g[0].price, max: g[g.length - 1].price };
    }
    res.setHeader('Cache-Control', 's-maxage=3600'); // cachea 1h en el edge (cuida la cuota)
    return res.status(200).json({
      ok: true,
      minYear: minYear,
      cond: cond,
      trim: trim || null,
      total: total != null ? total : items.length,
      shown: items.length,
      byCondition: { nuevo: condCount('Nuevo'), cpo: condCount('CPO'), usado: condCount('Usado') },
      priceByCondition: { nuevo: rangeOf('Nuevo'), cpo: rangeOf('CPO'), usado: rangeOf('Usado') },
      minPrice: prices.length ? Math.min.apply(null, prices) : null,
      maxPrice: prices.length ? Math.max.apply(null, prices) : null,
      cheapest: items[0] || null,
      cheapestNew: cheapestOf('Nuevo'),
      cheapestCpo: cheapestOf('CPO'),
      cheapestUsed: cheapestOf('Usado'),
      listings: items.slice(0, 60)
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: 'Error: ' + (err.name === 'AbortError' ? 'timeout' : err.message) });
  }
};
