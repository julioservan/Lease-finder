/**
 * Renderizado con navegador headless (opcional) para fuentes que pintan sus
 * ofertas con JavaScript o rechazan peticiones simples.
 *
 * Requiere playwright (o playwright-core + un Chromium ya instalado):
 *   npm install -D playwright && npx playwright install chromium
 *
 * Si no está instalado, todo sigue funcionando con fetch normal; este módulo
 * simplemente reporta que no está disponible. Se puede apuntar a un Chromium
 * concreto con la variable de entorno LEASE_SCANNER_CHROMIUM.
 */
'use strict';

var lib = require('./lib.js');

var CANDIDATE_EXECUTABLES = [
  process.env.LEASE_SCANNER_CHROMIUM,
  '/opt/pw-browsers/chromium'
].filter(Boolean);

function loadPlaywright() {
  var names = ['playwright', 'playwright-core'];
  for (var i = 0; i < names.length; i++) {
    try { return require(names[i]); } catch (e) { /* siguiente */ }
  }
  return null;
}

var pw = loadPlaywright();
var browserPromise = null;

function isAvailable() { return !!pw; }

function tryLaunch(i) {
  var opts = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] };
  if (i < CANDIDATE_EXECUTABLES.length) opts.executablePath = CANDIDATE_EXECUTABLES[i];
  return pw.chromium.launch(opts).catch(function (err) {
    if (i < CANDIDATE_EXECUTABLES.length) return tryLaunch(i + 1);
    throw err;
  });
}

function getBrowser() {
  if (!pw) return Promise.reject(new Error('playwright no está instalado'));
  if (!browserPromise) browserPromise = tryLaunch(0);
  return browserPromise;
}

/** Abre la URL en Chromium, espera el JavaScript y devuelve el HTML final. */
async function renderPage(url, timeoutMs) {
  var browser = await getBrowser();
  var context = await browser.newContext({
    userAgent: lib.USER_AGENT,
    viewport: { width: 1366, height: 768 },
    locale: 'en-US'
  });
  try {
    var page = await context.newPage();
    // Sin imágenes/fuentes/videos: solo necesitamos el texto.
    await page.route('**/*', function (route) {
      var type = route.request().resourceType();
      if (type === 'image' || type === 'font' || type === 'media') return route.abort();
      return route.continue();
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs || 25000 });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(function () {});
    return await page.content();
  } finally {
    await context.close().catch(function () {});
  }
}

/** Cierra el navegador compartido (llámalo al final o el proceso no termina). */
function close() {
  if (!browserPromise) return Promise.resolve();
  var p = browserPromise;
  browserPromise = null;
  return p.then(function (b) { return b.close(); }).catch(function () {});
}

module.exports = {
  isAvailable: isAvailable,
  renderPage: renderPage,
  close: close
};
