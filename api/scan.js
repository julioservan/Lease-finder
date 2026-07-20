/**
 * Función serverless (Vercel): lanza el escaneo de leases en GitHub Actions
 * desde el botón "Buscar ahora" de la app, sin exponer credenciales en la
 * página.
 *
 * Configuración (una sola vez, en Vercel → proyecto lease-finder →
 * Settings → Environment Variables):
 *   LEASE_GITHUB_TOKEN  token fine-grained de GitHub con permiso
 *                       "Actions: Read and write" SOLO sobre este repo.
 *
 * Protecciones: no relanza si ya hay una búsqueda corriendo y exige un
 * mínimo de 10 minutos entre búsquedas manuales.
 */
'use strict';

var OWNER = 'julioservan';
var REPO = 'Lease-finder';
var WORKFLOW = 'lease-scan.yml';
var BRANCH = process.env.LEASE_SCAN_BRANCH || 'claude/lease-offer-comparison-9ty6tq';
var MIN_INTERVAL_MIN = 10;

module.exports = async function handler(req, res) {
  // La copia de GitHub Pages también puede usar esta función
  res.setHeader('Access-Control-Allow-Origin', 'https://julioservan.github.io');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, message: 'Usa POST.' });
  }

  var token = process.env.LEASE_GITHUB_TOKEN;
  if (!token) {
    return res.status(501).json({
      ok: false,
      message: 'Falta configurar LEASE_GITHUB_TOKEN en Vercel (Settings → Environment Variables).'
    });
  }

  function gh(path, init) {
    init = init || {};
    init.headers = Object.assign({
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'lease-finder-app'
    }, init.headers);
    return fetch('https://api.github.com' + path, init);
  }

  try {
    // Límite: nada de spamear al robot
    var runsRes = await gh('/repos/' + OWNER + '/' + REPO + '/actions/workflows/' + WORKFLOW + '/runs?per_page=1');
    if (runsRes.ok) {
      var runs = await runsRes.json();
      var last = runs.workflow_runs && runs.workflow_runs[0];
      if (last) {
        if (last.status === 'queued' || last.status === 'in_progress') {
          return res.status(429).json({ ok: false, message: 'Ya hay una búsqueda corriendo; dale unos minutos y presiona ↻ Recargar.' });
        }
        var ageMin = (Date.now() - new Date(last.run_started_at).getTime()) / 60000;
        if (ageMin < MIN_INTERVAL_MIN) {
          return res.status(429).json({
            ok: false,
            message: 'La última búsqueda fue hace ' + Math.round(ageMin) + ' min; espera al menos ' + MIN_INTERVAL_MIN + ' entre búsquedas.'
          });
        }
      }
    }

    var dispatch = await gh('/repos/' + OWNER + '/' + REPO + '/actions/workflows/' + WORKFLOW + '/dispatches', {
      method: 'POST',
      body: JSON.stringify({ ref: BRANCH })
    });
    if (dispatch.status === 204) {
      return res.status(200).json({ ok: true, message: 'Búsqueda lanzada; resultados en ~3-4 minutos.' });
    }
    var body = await dispatch.text();
    return res.status(502).json({ ok: false, message: 'GitHub respondió ' + dispatch.status + ': ' + body.slice(0, 200) });
  } catch (err) {
    return res.status(500).json({ ok: false, message: 'Error: ' + err.message });
  }
};
