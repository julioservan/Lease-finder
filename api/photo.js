/**
 * Función serverless (Vercel): sirve la FOTO REAL de un coche por VIN usando
 * la cuenta de Auto.dev (clave AUTO_DEV_KEY), evitando el bloqueo anti-hotlink
 * del host de imágenes (retail.photos.vin devuelve 403 al enlazarlo directo).
 *
 * Uso:  GET /api/photo?vin=XXXXXXXXXXXXXXXXX
 *       GET /api/photo?vin=...&debug=1   → diagnóstico (qué endpoint funciona)
 *
 * Descarga los bytes en el servidor y los reenvía con caché larga, así el
 * navegador puede mostrarlos con un simple <img src="api/photo?vin=...">.
 */
'use strict';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://julioservan.github.io');
  if (req.method === 'OPTIONS') return res.status(204).end();

  var vin = (req.query.vin || '').toString().trim().toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{11,17}$/.test(vin)) return res.status(400).json({ ok: false, message: 'VIN inválido' });

  var key = process.env.AUTO_DEV_KEY || '';
  var UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

  async function get(url, headers) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 9000);
    try {
      var r = await fetch(url, { headers: headers || {}, signal: controller.signal });
      clearTimeout(timer);
      return r;
    } catch (e) { clearTimeout(timer); return { ok: false, status: e.name === 'AbortError' ? 'timeout' : e.message, headers: { get: function () { return null; } } }; }
  }

  // 1) Preguntar a la API de fotos de Auto.dev por las URLs reales del VIN.
  var apiTry = { status: null, keys: null, sample: null };
  var photoUrls = [];
  if (key) {
    var pr = await get('https://api.auto.dev/photos/' + vin, { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' });
    apiTry.status = pr.status;
    if (pr.ok) {
      try {
        var pj = await pr.json();
        apiTry.keys = Object.keys(pj);
        // Busca cualquier array de fotos con url/src.
        var pools = [pj.photos, pj.data, pj.results, pj.images, Array.isArray(pj) ? pj : null].filter(Boolean);
        pools.forEach(function (arr) {
          (Array.isArray(arr) ? arr : []).forEach(function (p) {
            var u = typeof p === 'string' ? p : (p && (p.url || p.src || p.href || p.large || p.medium));
            if (u) photoUrls.push(u);
          });
        });
        apiTry.sample = JSON.stringify(pj).slice(0, 300);
      } catch (e) { apiTry.sample = 'json err: ' + e.message; }
    }
  }

  // 2) Fallbacks directos al host de imágenes (por si la API no da URLs).
  var directs = ['https://retail.photos.vin/' + vin + '-1.jpg', 'https://photos.vin/' + vin + '-1.jpg'];
  var candidates = photoUrls.concat(directs);

  var report = [];
  for (var i = 0; i < candidates.length; i++) {
    var u = candidates[i];
    var headers = { 'User-Agent': UA, 'Accept': 'image/avif,image/webp,image/*,*/*', 'Referer': 'https://www.auto.dev/' };
    if (/api\.auto\.dev/.test(u) && key) headers.Authorization = 'Bearer ' + key;
    var ir = await get(u, headers);
    var ct = ir.headers && ir.headers.get ? (ir.headers.get('content-type') || '') : '';
    report.push({ url: u.slice(0, 80), status: ir.status, ct: ct });
    if (ir.ok && /^image\//.test(ct)) {
      if (req.query.debug) return res.status(200).json({ ok: true, vin: vin, worked: u, apiTry: apiTry, report: report });
      var buf = Buffer.from(await ir.arrayBuffer());
      res.setHeader('Content-Type', ct);
      res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800');
      return res.status(200).send(buf);
    }
  }

  if (req.query.debug) return res.status(200).json({ ok: false, vin: vin, hasKey: !!key, apiTry: apiTry, report: report });
  return res.status(404).json({ ok: false, message: 'sin foto para ese VIN' });
};
