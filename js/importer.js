/**
 * Importador de ofertas: convierte un archivo (PDF, HTML, imagen/captura o
 * texto) en TEXTO plano para que el OfferParser lo lea y autorrellene.
 *
 *   LeaseImport.fromFile(file, onProgress) -> Promise<{ kind, text }>
 *
 * - HTML / .htm / .txt: se leen en local (sin dependencias).
 * - PDF: se lee con pdf.js (se carga bajo demanda desde CDN; capa de texto,
 *   ideal para hojas de oferta y PDFs de correo — no para PDFs escaneados).
 * - Imagen (PNG/JPG/captura): OCR con Tesseract.js (bajo demanda desde CDN;
 *   más lento y aproximado, revisa siempre lo detectado).
 *
 * Las librerías pesadas SOLO se cargan cuando importas ese tipo de archivo,
 * así el uso normal de la app sigue sin dependencias externas.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.LeaseImport = factory(root);
}(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  // Versiones fijadas (builds UMD estables que exponen un global).
  var PDF_JS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
  var PDF_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  var TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

  var loaded = {};
  function loadScript(src) {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { loaded[src] = null; reject(new Error('No se pudo cargar ' + src)); };
      document.head.appendChild(s);
    });
    return loaded[src];
  }

  function readText(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result || '')); };
      r.onerror = function () { reject(new Error('No se pudo leer el archivo')); };
      r.readAsText(file);
    });
  }

  function htmlToText(html) {
    if (root.OfferParser && root.OfferParser.htmlToText) return root.OfferParser.htmlToText(html);
    return String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ');
  }

  async function pdfText(file, prog) {
    await loadScript(PDF_JS);
    var pdfjs = root.pdfjsLib;
    if (!pdfjs) throw new Error('El lector de PDF no está disponible (¿sin conexión?). Pega el texto a mano.');
    try { pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER; } catch (e) { /* da igual */ }
    var buf = await file.arrayBuffer();
    var pdf = await pdfjs.getDocument({ data: buf }).promise;
    var pages = [];
    for (var i = 1; i <= pdf.numPages; i++) {
      if (prog) prog('Leyendo PDF… página ' + i + '/' + pdf.numPages);
      var page = await pdf.getPage(i);
      var tc = await page.getTextContent();
      pages.push(tc.items.map(function (it) { return it.str; }).join(' '));
    }
    return pages.join('\n');
  }

  async function imageText(file, prog) {
    await loadScript(TESSERACT);
    var T = root.Tesseract;
    if (!T || !T.recognize) throw new Error('El lector de imágenes (OCR) no está disponible (¿sin conexión?). Pega el texto a mano.');
    if (prog) prog('Reconociendo texto de la captura… (puede tardar unos segundos)');
    var res = await T.recognize(file, 'eng', {
      logger: function (m) {
        if (prog && m && m.status === 'recognizing text') prog('OCR… ' + Math.round((m.progress || 0) * 100) + '%');
      }
    });
    return (res && res.data && res.data.text) || '';
  }

  /* ---- MHTML: "Guardar como…" de Chrome guarda la web en UN archivo ---- */

  /** Decodifica quoted-printable (=3D → '=', '=\n' une líneas partidas). */
  function decodeQP(s) {
    return String(s || '')
      .replace(/=\r?\n/g, '')
      .replace(/=([0-9A-F]{2})/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); });
  }

  /** Extrae la parte text/html de un archivo MHTML y la decodifica. */
  function mhtmlToHtml(raw) {
    raw = String(raw || '');
    var ct = raw.search(/Content-Type:\s*text\/html/i);
    if (ct < 0) return raw; // no parece MHTML: trátalo como HTML normal
    var afterCt = raw.slice(ct);
    var blank = afterCt.match(/\r?\n\r?\n/); // línea en blanco = fin de cabeceras
    if (!blank) return raw;
    var bodyStart = ct + blank.index + blank[0].length;
    var boundary = (raw.match(/boundary="?([^";\r\n]+)"?/i) || [])[1];
    var bodyEnd = boundary ? raw.indexOf('--' + boundary, bodyStart) : -1;
    var body = raw.slice(bodyStart, bodyEnd > 0 ? bodyEnd : raw.length);
    var partHead = raw.slice(Math.max(0, ct - 300), bodyStart);
    if (/Content-Transfer-Encoding:\s*quoted-printable/i.test(partHead)) body = decodeQP(body);
    else if (/Content-Transfer-Encoding:\s*base64/i.test(partHead)) {
      try { body = atob(body.replace(/\s+/g, '')); } catch (e) { /* se queda como está */ }
    }
    return body;
  }

  function kindOf(file) {
    var name = (file.name || '').toLowerCase(), type = file.type || '';
    if (/\.pdf$/.test(name) || /pdf/.test(type)) return 'pdf';
    if (/^image\//.test(type) || /\.(png|jpe?g|webp|gif|bmp|heic)$/.test(name)) return 'image';
    if (/\.mht(ml)?$/.test(name) || /multipart\/related/.test(type)) return 'mhtml';
    if (/\.(html?|htm)$/.test(name) || /html/.test(type)) return 'html';
    return 'text';
  }

  function fromFile(file, prog) {
    var kind = kindOf(file);
    if (kind === 'pdf') return pdfText(file, prog).then(function (t) { return { kind: 'pdf', text: t }; });
    if (kind === 'image') return imageText(file, prog).then(function (t) { return { kind: 'image', text: t }; });
    if (kind === 'mhtml') return readText(file).then(function (r) { return { kind: 'mhtml', text: htmlToText(mhtmlToHtml(r)) }; });
    if (kind === 'html') return readText(file).then(function (h) { return { kind: 'html', text: htmlToText(h) }; });
    return readText(file).then(function (t) { return { kind: 'text', text: t }; });
  }

  return { fromFile: fromFile, kindOf: kindOf, _mhtmlToHtml: mhtmlToHtml, _decodeQP: decodeQP };
}));
