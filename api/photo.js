/**
 * Función serverless (Vercel): sirve una FOTO REAL de coche evitando el
 * bloqueo anti-hotlink de los CDNs de anuncios (muchos devuelven 403 si el
 * Referer no es suyo). Descarga los bytes en el servidor con las cabeceras
 * correctas y los reenvía con caché larga, así el navegador los muestra con
 * un simple <img src="api/photo?url=...">.
 *
 * Modo principal (SIN gastar cuota de Auto.dev):
 *   GET /api/photo?url=<url-imagen-del-anuncio>   (host de la lista blanca)
 *
 * Modo por VIN (usa la API de fotos de Auto.dev, gasta 1 llamada):
 *   GET /api/photo?vin=XXXXXXXXXXXXXXXXX
 *
 * Diagnóstico:
 *   GET /api/photo?...&debug=1  → JSON con qué endpoint respondió.
 */
'use strict';

// Sufijos de host permitidos (evita convertir esto en un proxy abierto).
var ALLOW = [
  'retail.photos.vin', 'photos.vin', '.auto.dev', 'auto.dev',
  '.imagin.studio', '.edmunds-media.com', '.dealer.com', '.dealereprocess.com',
  '.homenetiol.com', '.dealercarsearch.com', '.pixelmotion.com', '.cars.com',
  '.carfax.com', '.akamaized.net', '.cloudfront.net', '.dealerinspire.com',
  '.dealeraccelerate.com', '.dealercdn.com', '.chromedata.com'
];

function hostAllowed(host) {
  host = (host || '').toLowerCase();
  for (var i = 0; i < ALLOW.length; i++) {
    var a = ALLOW[i];
    if (a[0] === '.') { if (host === a.slice(1) || host.slice(-a.length) === a) return true; }
    else if (host === a) return true;
  }
  return false;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://julioservan.github.io');
  if (req.method === 'OPTIONS') return res.status(204).end();

  var UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  var key = process.env.AUTO_DEV_KEY || '';
  var debug = !!req.query.debug;

  async function get(url, headers) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 9000);
    try {
      var r = await fetch(url, { headers: headers || {}, redirect: 'follow', signal: controller.signal });
      clearTimeout(timer);
      return r;
    } catch (e) {
      clearTimeout(timer);
      return { ok: false, status: e.name === 'AbortError' ? 'timeout' : e.message, headers: { get: function () { return null; } } };
    }
  }

  // Descarga una URL de imagen y, si es una imagen de verdad, la reenvía.
  async function stream(url, report) {
    var refHost;
    try { refHost = new URL(url).origin; } catch (e) { refHost = 'https://www.auto.dev/'; }
    var headers = { 'User-Agent': UA, 'Accept': 'image/avif,image/webp,image/*,*/*', 'Referer': refHost + '/' };
    if (/api\.auto\.dev/.test(url) && key) headers.Authorization = 'Bearer ' + key;
    var ir = await get(url, headers);
    var ct = ir.headers && ir.headers.get ? (ir.headers.get('content-type') || '') : '';
    if (report) report.push({ url: String(url).slice(0, 90), status: ir.status, ct: ct });
    if (ir.ok && /^image\//.test(ct)) {
      var buf = Buffer.from(await ir.arrayBuffer());
      if (!debug) {
        res.setHeader('Content-Type', ct);
        res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800');
        res.status(200).send(buf);
      }
      return true;
    }
    return false;
  }

  // -------- Modo 1: proxy directo de la URL del anuncio (sin gastar cuota) --------
  var direct = (req.query.url || '').toString().trim();
  if (direct) {
    var host;
    try { host = new URL(direct).hostname; } catch (e) { return res.status(400).json({ ok: false, message: 'url inválida' }); }
    if (!/^https?:$/i.test(new URL(direct).protocol) || !hostAllowed(host)) {
      return res.status(400).json({ ok: false, message: 'host no permitido', host: host });
    }
    var rep1 = [];
    var ok1 = await stream(direct, rep1);
    if (debug) return res.status(200).json({ ok: ok1, mode: 'url', host: host, report: rep1 });
    if (ok1) return; // ya enviado
    return res.status(404).json({ ok: false, message: 'no se pudo cargar esa imagen' });
  }

  // -------- Modo 2: por VIN vía la API de fotos de Auto.dev --------
  var vin = (req.query.vin || '').toString().trim().toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{11,17}$/.test(vin)) return res.status(400).json({ ok: false, message: 'falta url o vin válido' });

  var apiTry = { status: null, keys: null, sample: null };
  var photoUrls = [];
  if (key) {
    var pr = await get('https://api.auto.dev/photos/' + vin, { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' });
    apiTry.status = pr.status;
    if (pr.ok) {
      try {
        var pj = await pr.json();
        apiTry.keys = Object.keys(pj);
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

  var candidates = photoUrls.concat(['https://retail.photos.vin/' + vin + '-1.jpg', 'https://photos.vin/' + vin + '-1.jpg']);
  var report = [];
  for (var i = 0; i < candidates.length; i++) {
    var ok = await stream(candidates[i], report);
    if (ok && !debug) return; // ya enviado
    if (ok && debug) return res.status(200).json({ ok: true, vin: vin, mode: 'vin', apiTry: apiTry, report: report });
  }

  if (debug) return res.status(200).json({ ok: false, vin: vin, hasKey: !!key, mode: 'vin', apiTry: apiTry, report: report });
  return res.status(404).json({ ok: false, message: 'sin foto para ese VIN' });
};
