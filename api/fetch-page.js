/**
 * Función serverless (Vercel): descarga una página de oferta para que el
 * cliente la parsee y autorrellene la calculadora ("pegar URL → leer").
 *
 * Seguridad: SOLO dominios de la lista blanca (evita que el endpoint se use
 * como proxy abierto / SSRF). Hoy: leasehackr.com y subdominios (PND, SIGNED).
 * Para añadir otro dominio, amplía ALLOWED_HOSTS.
 *
 * Uso: GET /api/fetch-page?url=https://pnd.leasehackr.com/d/...
 * Respuesta: { ok, status, html } (html recortado a ~1,5 MB).
 */
'use strict';

// Lista blanca dinámica: leasehackr + TODOS los concesionarios que ya rastrea
// el robot (scanner/sources.json). Así puedes pegar la ficha de un coche de
// Autoworld Kia, Bay Ridge Honda, etc., sin abrir un proxy libre (SSRF).
var sources = { sources: [] };
try { sources = require('../scanner/sources.json'); } catch (e) { /* sin fuentes */ }

var ALLOWED = new Set(['leasehackr.com']);
(sources.sources || []).forEach(function (s) {
  (s.urls || []).forEach(function (u) {
    try { ALLOWED.add(new URL(u).hostname.replace(/^www\./i, '').toLowerCase()); } catch (e) { /* url mala */ }
  });
});

function hostAllowed(hostname) {
  var h = String(hostname || '').replace(/^www\./i, '').toLowerCase();
  if (ALLOWED.has(h)) return true;
  // subdominios de un dominio permitido (p. ej. pnd.leasehackr.com)
  for (var it = ALLOWED.values(), n = it.next(); !n.done; n = it.next()) {
    if (h.endsWith('.' + n.value)) return true;
  }
  return false;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://julioservan.github.io');
  if (req.method === 'OPTIONS') return res.status(204).end();

  var raw = (req.query && req.query.url ? String(req.query.url) : '').trim();
  var target;
  try { target = new URL(raw); } catch (e) { target = null; }
  if (!target || target.protocol !== 'https:') {
    return res.status(400).json({ ok: false, message: 'Pega una URL https válida.' });
  }
  if (!hostAllowed(target.hostname)) {
    return res.status(400).json({
      ok: false,
      message: 'Solo leo URLs de Leasehackr y de los concesionarios que rastrea el robot. Para otras webs: guarda la página (Ctrl+S) y súbela como .html/.mhtml.'
    });
  }

  try {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 15000);
    var r = await fetch(target.toString(), {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        // Cabeceras de navegador real: reduce rechazos del anti-bot.
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    clearTimeout(timer);
    var html = await r.text();
    if (!r.ok) {
      return res.status(502).json({
        ok: false, status: r.status,
        message: 'La página respondió ' + r.status +
          (r.status === 403 ? ' (bloqueo anti-bot). Plan B: guarda la página con Ctrl+S y súbela como .mhtml.' : '.')
      });
    }
    return res.status(200).json({ ok: true, status: r.status, html: html.slice(0, 1500000) });
  } catch (e) {
    var msg = e && e.name === 'AbortError' ? 'La página tardó demasiado (15 s).' : (e && e.message) || 'error';
    return res.status(500).json({ ok: false, message: 'No pude descargarla: ' + msg + ' Plan B: guárdala con Ctrl+S y súbela como .mhtml.' });
  }
};
