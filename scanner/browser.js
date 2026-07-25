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
  var opts = {
    headless: true,
    args: [
      '--no-sandbox', '--disable-dev-shm-usage',
      // Menos señales de automatización (algunos concesionarios bloquean por esto).
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process'
    ]
  };
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

/** Hace scroll por la página en pasos para disparar la carga diferida (lazy). */
async function autoScroll(page) {
  try {
    await page.evaluate(function () {
      return new Promise(function (resolve) {
        var total = 0, step = 700;
        var timer = setInterval(function () {
          window.scrollBy(0, step);
          total += step;
          var done = total >= (document.body ? document.body.scrollHeight : 0) - window.innerHeight;
          if (done || total > 15000) { clearInterval(timer); window.scrollTo(0, 0); resolve(); }
        }, 200);
      });
    });
  } catch (e) { /* ignora */ }
}

/**
 * Abre la URL en Chromium, ejecuta el JavaScript y devuelve el HTML final.
 * Los concesionarios (DealerOn/Dealer.com/DealerInspire) pintan sus
 * lease-specials con JS, a menudo en IFRAMES de terceros y con carga diferida
 * al hacer scroll. Por eso: hacemos scroll, esperamos señales de oferta y
 * reunimos el HTML del marco principal MÁS el de todos los iframes.
 */
async function renderPage(url, timeoutMs) {
  var browser = await getBrowser();
  var context = await browser.newContext({
    userAgent: lib.USER_AGENT,
    viewport: { width: 1366, height: 768 },
    locale: 'en-US',
    // Cabeceras de un Chrome real: reduce rechazos 403 de sitios con anti-bot.
    extraHTTPHeaders: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1'
    }
  });
  // Oculta las huellas típicas de headless (navigator.webdriver, plugins…).
  await context.addInitScript(function () {
    try {
      Object.defineProperty(navigator, 'webdriver', { get: function () { return undefined; } });
      Object.defineProperty(navigator, 'languages', { get: function () { return ['en-US', 'en']; } });
      Object.defineProperty(navigator, 'plugins', { get: function () { return [1, 2, 3, 4, 5]; } });
      window.chrome = window.chrome || { runtime: {} };
    } catch (e) { /* ignora */ }
  });
  try {
    var page = await context.newPage();
    // Sin imágenes/fuentes/videos: solo necesitamos el texto (y va más rápido).
    await page.route('**/*', function (route) {
      var type = route.request().resourceType();
      if (type === 'image' || type === 'font' || type === 'media') return route.abort();
      return route.continue();
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs || 25000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(function () {});
    // Dispara los widgets de specials con carga diferida.
    await autoScroll(page);
    // Espera hasta ~7 s a que aparezca una señal de oferta de lease
    // (un precio + una palabra tipo mo/month/lease) en cualquier marco.
    await page.waitForFunction(function () {
      function hit(doc) {
        try {
          var t = (doc.body && doc.body.innerText) || '';
          return /\$\s?\d/.test(t) && /(per mo\b|\/mo\b|\bmonth|\blease|\bmes\b)/i.test(t);
        } catch (e) { return false; }
      }
      if (hit(document)) return true;
      var ifr = document.querySelectorAll('iframe');
      for (var i = 0; i < ifr.length; i++) {
        try { if (hit(ifr[i].contentDocument)) return true; } catch (e) { /* cross-origin */ }
      }
      return false;
    }, { timeout: 7000 }).catch(function () {});
    await page.waitForTimeout(700).catch(function () {});

    // Reúne el HTML del marco principal + TODOS los iframes (specials de terceros).
    // Playwright sí puede leer iframes cross-origin (controla el navegador).
    var parts = [];
    var frames = page.frames();
    for (var i = 0; i < frames.length; i++) {
      try {
        var html = await frames[i].content();
        if (html) parts.push(html);
      } catch (e) { /* marco inaccesible: lo saltamos */ }
    }
    if (!parts.length) parts.push(await page.content());
    return parts.join('\n<!-- frame -->\n');
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
