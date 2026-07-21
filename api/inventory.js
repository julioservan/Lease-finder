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
  var zip = (q.zip || '11201').toString().trim();
  var radius = (q.radius || '25').toString().trim();
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
  var url = 'https://api.auto.dev/listings' +
    '?vehicle.make=' + encodeURIComponent(make) +
    '&vehicle.model=' + encodeURIComponent(model) +
    '&zip=' + encodeURIComponent(zip) +
    '&distance=' + encodeURIComponent(radius) +
    '&limit=50';

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
      price: num(rl.price),
      msrp: num(v.baseMsrp),
      miles: num(rl.miles),
      condition: !used ? 'Nuevo' : (cpo ? 'CPO' : 'Usado'),
      dealer: typeof rl.dealer === 'string' ? rl.dealer : '',
      city: rl.city || '',
      state: rl.state || '',
      vin: vin,
      // vdp de Auto.dev es un fragmento, no una URL usable → buscamos el VIN
      url: vin ? 'https://www.google.com/search?q=' + encodeURIComponent(vin + ' for sale') : ''
    };
  }

  try {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 12000);
    var r = await fetch(url, {
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!r.ok) {
      var t = await r.text();
      return res.status(502).json({ ok: false, message: 'Auto.dev respondió ' + r.status + ': ' + t.slice(0, 160) });
    }
    var data = await r.json();
    var records = data.records || data.listings || data.results || data.data ||
      (Array.isArray(data) ? data : []);
    if (!Array.isArray(records)) records = [];

    // Diagnóstico: /api/inventory?...&debug=1 muestra la estructura real
    // para mapear los campos exactos si algo sale vacío.
    if (q.debug) {
      var first = records[0] || null;
      return res.status(200).json({
        ok: true,
        topKeys: Object.keys(data),
        count: records.length,
        sampleKeys: first ? Object.keys(first) : [],
        sampleRaw: first
      });
    }
    var items = records.map(normalize).filter(function (x) { return x.price != null; });
    items.sort(function (a, b) { return a.price - b.price; });

    var prices = items.map(function (x) { return x.price; });
    function condCount(c) { return items.filter(function (x) { return x.condition === c; }).length; }
    function cheapestOf(c) { return items.filter(function (x) { return x.condition === c; })[0] || null; }
    res.setHeader('Cache-Control', 's-maxage=3600'); // cachea 1h en el edge (cuida la cuota)
    return res.status(200).json({
      ok: true,
      shown: items.length,
      byCondition: { nuevo: condCount('Nuevo'), cpo: condCount('CPO'), usado: condCount('Usado') },
      minPrice: prices.length ? Math.min.apply(null, prices) : null,
      maxPrice: prices.length ? Math.max.apply(null, prices) : null,
      cheapest: items[0] || null,
      cheapestNew: cheapestOf('Nuevo'),
      cheapestCpo: cheapestOf('CPO'),
      listings: items.slice(0, 8)
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: 'Error: ' + (err.name === 'AbortError' ? 'timeout' : err.message) });
  }
};
