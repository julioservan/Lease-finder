/* Lease Finder — UI: pestañas, modelos, comparador entre marcas, ofertas y calculadora. */
(function () {
  'use strict';

  var STORAGE_KEY = 'lease-finder-offers';
  var CURRENCY_KEY = 'lease-finder-currency';
  var WATCH_KEY = 'lease-finder-watchlist-v4';
  var COMPARE_KEY = 'lf-compare-v1';
  var TAB_KEY = 'lf-tab';
  var STOCK_PREFIX = 'lf-stock2-';
  var STOCK_FRESH_MS = 6 * 3600 * 1000; // frescura para re-consultar (cuida la cuota)
  var VIEWS = ['models', 'compare', 'offers', 'calc', 'decide'];

  var FIELDS = [
    'make', 'model', 'name', 'msrp', 'price', 'incentives', 'downPayment', 'term',
    'milesPerYear', 'residualPct', 'rateType', 'rate', 'acqFee',
    'capitalizeAcq', 'dispositionFee', 'upfrontFees', 'capFees',
    'taxPct', 'taxMethod', 'notes'
  ];

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    offers: loadOffers(),
    sortKey: 'effectiveMonthly',
    sortDesc: false,
    editingId: null,
    scanResults: [],
    filterMake: '',
    filterModel: '',
    watchlist: [],
    compare: []
  };

  /** Normaliza para comparar modelos: minúsculas, sin espacios ni guiones. */
  function normalizeModel(s) {
    return String(s || '').toLowerCase().replace(/[\s\-]/g, '');
  }

  /** Llena un <select> de modelos según la marca elegida. */
  function populateModels(selectEl, make, emptyLabel) {
    var models = (VehicleCatalog[make] || []);
    selectEl.innerHTML = '';
    var opt = document.createElement('option');
    opt.value = '';
    opt.textContent = emptyLabel;
    selectEl.appendChild(opt);
    models.forEach(function (m) {
      var o = document.createElement('option');
      o.value = m;
      o.textContent = m;
      selectEl.appendChild(o);
    });
    selectEl.disabled = !make || models.length === 0;
  }

  function genId() {
    return String(Date.now()) + '-' + Math.random().toString(36).slice(2, 7);
  }

  /** Métricas comparables para cualquier tipo de oferta guardada. */
  function metricsFor(offer) {
    if (offer.kind === 'scanned') return OfferParser.scoreOffer(offer.parsed || {});
    return LeaseCalc.computeLease(offer.input);
  }

  function isNum(v) { return v != null && isFinite(v); }

  function offerName(offer) {
    if (offer.kind === 'scanned') return (offer.parsed && offer.parsed.name) || 'Oferta sin nombre';
    var input = offer.input || {};
    var vehicle = [input.make, input.model].filter(Boolean).join(' ');
    if (vehicle && input.name) return vehicle + ' — ' + input.name;
    return vehicle || input.name || 'Oferta sin nombre';
  }

  /* ---------------- utilidades ---------------- */

  function loadOffers() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function persistOffers() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.offers));
  }

  function currency() {
    try { return localStorage.getItem(CURRENCY_KEY) || '$'; } catch (e) { return '$'; }
  }

  function fmtMoney(v) {
    if (v == null || !isFinite(v)) return '—';
    return currency() + ' ' + v.toLocaleString('es', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function fmtMoney2(v) {
    if (v == null || !isFinite(v)) return '—';
    return currency() + ' ' + v.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtAge(t) {
    var mins = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (mins < 60) return 'hace ' + mins + ' min';
    var h = Math.round(mins / 60);
    if (h < 48) return 'hace ' + h + ' h';
    return 'hace ' + Math.round(h / 24) + ' días';
  }

  function readForm() {
    var input = {};
    FIELDS.forEach(function (f) {
      var el = $(f);
      input[f] = el.type === 'checkbox' ? el.checked : el.value;
    });
    return input;
  }

  function fillForm(input) {
    FIELDS.forEach(function (f) {
      var el = $(f);
      if (!(f in input)) return;
      if (el.type === 'checkbox') el.checked = !!input[f];
      else el.value = input[f] == null ? '' : input[f];
    });
    // El select de modelos depende de la marca: repoblarlo y reaplicar el valor.
    populateModels($('model'), $('make').value, '— Modelo —');
    if (input.model != null) $('model').value = input.model;
  }

  /* ---------------- pestañas ---------------- */

  function showView(name) {
    if (VIEWS.indexOf(name) < 0) name = 'models';
    VIEWS.forEach(function (v) {
      $('view-' + v).classList.toggle('active', v === name);
    });
    document.querySelectorAll('.tab').forEach(function (b) {
      b.classList.toggle('active', b.dataset.view === name);
    });
    try { localStorage.setItem(TAB_KEY, name); } catch (e) { /* sin persistencia */ }
    if (name === 'compare') renderCompare();
  }

  /* ---------------- cálculo en vivo ---------------- */

  function recalc() {
    var input = readForm();
    var r = LeaseCalc.computeLease(input);
    var hasData = LeaseCalc.num(input.msrp) > 0 && LeaseCalc.num(input.price) > 0;

    $('r-monthly').textContent = hasData ? fmtMoney2(r.monthlyPayment) : '—';
    $('r-dep').textContent = hasData ? fmtMoney2(r.monthlyDepreciation) : '—';
    $('r-rent').textContent = hasData ? fmtMoney2(r.monthlyRent) : '—';
    $('r-tax').textContent = hasData ? fmtMoney2(r.monthlyTax) : '—';
    $('r-driveoff').textContent = hasData ? fmtMoney2(r.driveOff) : '—';
    $('r-total').textContent = hasData ? fmtMoney(r.totalCost) : '—';
    $('r-effective').textContent = hasData ? fmtMoney2(r.effectiveMonthly) : '—';
    $('r-permile').textContent = hasData && r.costPerMile > 0 ? fmtMoney2(r.costPerMile) : '—';
    $('r-adjcap').textContent = hasData ? fmtMoney(r.adjustedCap) : '—';
    $('r-residual').textContent = hasData ? fmtMoney(r.residual) : '—';
    $('r-apr').textContent = hasData ? r.aprEquivalent.toFixed(2) + ' %' : '—';

    $('r-score').textContent = hasData ? r.score.toFixed(1) : '—';
    $('r-pct').textContent = hasData ? r.pctOfMsrp.toFixed(2) + ' %' : '—';

    setScoreClass($('score-box'), hasData ? (r.score >= 8 ? 'good' : r.score >= 6 ? 'warn' : 'bad') : '');
    setScoreClass($('pct-box'), hasData ? (r.pctOfMsrp <= 1 ? 'good' : r.pctOfMsrp <= 1.25 ? 'warn' : 'bad') : '');

    var msrp = LeaseCalc.num(input.msrp);
    var price = LeaseCalc.num(input.price);
    $('discount-hint').textContent = msrp > 0 && price > 0
      ? ((1 - price / msrp) * 100).toFixed(1) + ' % de descuento sobre MSRP'
      : '';

    $('rate-hint').textContent = input.rateType === 'mf' && LeaseCalc.num(input.rate) > 0
      ? 'Equivale a ' + r.aprEquivalent.toFixed(2) + ' % TAE'
      : (input.rateType === 'apr' && LeaseCalc.num(input.rate) > 0
        ? 'Money factor: ' + r.moneyFactor.toFixed(5)
        : '');

    return r;
  }

  function setScoreClass(el, cls) {
    el.classList.remove('good', 'warn', 'bad');
    if (cls) el.classList.add(cls);
  }

  /* ---------------- ofertas ---------------- */

  function saveOffer(ev) {
    ev.preventDefault();
    var input = readForm();
    if (!(LeaseCalc.num(input.msrp) > 0 && LeaseCalc.num(input.price) > 0)) {
      alert('Captura al menos el MSRP y el precio negociado antes de guardar.');
      return;
    }
    var offer = {
      id: state.editingId || genId(),
      savedAt: new Date().toISOString(),
      input: input
    };
    if (state.editingId) {
      var idx = state.offers.findIndex(function (o) { return o.id === state.editingId; });
      if (idx >= 0) state.offers[idx] = offer; else state.offers.push(offer);
    } else {
      state.offers.push(offer);
    }
    state.editingId = null;
    $('save-btn').textContent = '💾 Guardar oferta';
    persistOffers();
    renderOffers();
  }

  function deleteOffer(id) {
    var offer = state.offers.find(function (o) { return o.id === id; });
    var name = offer ? '"' + offerName(offer) + '"' : 'esta oferta';
    if (!confirm('¿Eliminar ' + name + '?')) return;
    state.offers = state.offers.filter(function (o) { return o.id !== id; });
    if (state.editingId === id) {
      state.editingId = null;
      $('save-btn').textContent = '💾 Guardar oferta';
    }
    persistOffers();
    renderOffers();
  }

  function loadOfferIntoForm(id) {
    var offer = state.offers.find(function (o) { return o.id === id; });
    if (!offer) return;
    if (offer.kind === 'scanned') {
      // Las ofertas escaneadas se reabren en el escáner con su texto original.
      $('scan-input').value = offer.raw || (offer.parsed && offer.parsed.raw) || '';
      $('scanner-card').open = true;
      runScan();
      $('scanner-card').scrollIntoView({ behavior: 'smooth' });
      return;
    }
    fillForm(offer.input);
    state.editingId = id;
    $('save-btn').textContent = '💾 Actualizar oferta';
    recalc();
    showView('calc');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderOffers() {
    var body = $('offers-body');
    body.innerHTML = '';
    $('no-offers').style.display = state.offers.length ? 'none' : 'block';

    var fMake = normalizeModel(state.filterMake);
    var fModel = normalizeModel(state.filterModel);
    var rows = state.offers
      .filter(function (o) {
        if (!fMake && !fModel) return true;
        var raw = o.kind === 'scanned' ? (o.raw || '') : '';
        var haystack = normalizeModel(offerName(o) + ' ' + raw);
        if (fMake && haystack.indexOf(fMake) < 0) return false;
        if (fModel && haystack.indexOf(fModel) < 0) return false;
        return true;
      })
      .map(function (o) {
        return { offer: o, calc: metricsFor(o) };
      });

    function sortVal(r) {
      var v = r.calc[state.sortKey];
      if (!isNum(v)) return state.sortDesc ? -Infinity : Infinity;
      return v;
    }
    rows.sort(function (a, b) {
      var d = sortVal(a) - sortVal(b);
      return state.sortDesc ? -d : d;
    });

    // Mejor valor por columna (min salvo score, que es max); ignora faltantes.
    var best = {};
    ['monthlyPayment', 'driveOff', 'effectiveMonthly', 'totalCost', 'pctOfMsrp'].forEach(function (k) {
      var vals = rows.map(function (r) { return r.calc[k]; }).filter(isNum);
      best[k] = vals.length ? Math.min.apply(null, vals) : null;
    });
    var scores = rows.map(function (r) { return r.calc.score; }).filter(isNum);
    best.score = scores.length ? Math.max.apply(null, scores) : null;

    function isBest(k, v) {
      return rows.length > 1 && isNum(v) && v === best[k];
    }

    rows.forEach(function (r) {
      var tr = document.createElement('tr');
      tr.dataset.id = r.offer.id;
      var isScanned = r.offer.kind === 'scanned';
      var date = r.offer.savedAt ? new Date(r.offer.savedAt).toLocaleDateString('es') : '';
      var meta = (isScanned ? '🔍 escaneada · ' : '') + date;
      tr.appendChild(cell(
        '<span class="offer-name">' + escapeHtml(offerName(r.offer)) + '</span>' +
        '<span class="offer-meta">' + escapeHtml(meta) + '</span>', true));
      tr.appendChild(cell(r.calc.term + ' m'));
      tr.appendChild(numCell(fmtMoney2(r.calc.monthlyPayment), isBest('monthlyPayment', r.calc.monthlyPayment)));
      tr.appendChild(numCell(fmtMoney(r.calc.driveOff), isBest('driveOff', r.calc.driveOff)));
      tr.appendChild(numCell(fmtMoney2(r.calc.effectiveMonthly), isBest('effectiveMonthly', r.calc.effectiveMonthly)));
      tr.appendChild(numCell(fmtMoney(r.calc.totalCost), isBest('totalCost', r.calc.totalCost)));
      tr.appendChild(numCell(isNum(r.calc.pctOfMsrp) ? r.calc.pctOfMsrp.toFixed(2) + ' %' : '—', isBest('pctOfMsrp', r.calc.pctOfMsrp)));
      tr.appendChild(numCell(isNum(r.calc.score) ? r.calc.score.toFixed(1) : '—', isBest('score', r.calc.score)));

      var del = document.createElement('td');
      var btn = document.createElement('button');
      btn.className = 'btn danger';
      btn.textContent = '✕';
      btn.title = 'Eliminar oferta';
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        deleteOffer(r.offer.id);
      });
      del.appendChild(btn);
      tr.appendChild(del);

      tr.addEventListener('click', function () { loadOfferIntoForm(r.offer.id); });
      body.appendChild(tr);
    });

    // indicador de orden en encabezados
    var ths = document.querySelectorAll('#offers-table th.sortable');
    ths.forEach(function (th) {
      th.classList.toggle('sorted', th.dataset.sort === state.sortKey);
    });
  }

  function cell(html, isHtml) {
    var td = document.createElement('td');
    if (isHtml) td.innerHTML = html; else td.textContent = html;
    return td;
  }

  function numCell(text, isBest) {
    var td = document.createElement('td');
    td.textContent = text;
    if (isBest) td.classList.add('best');
    return td;
  }

  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  /* ---------------- escáner de ofertas ---------------- */

  function runScan() {
    var text = $('scan-input').value;
    state.scanResults = OfferParser.scanText(text);
    renderScanResults();
  }

  function saveScanned(parsed) {
    state.offers.push({
      id: genId(),
      savedAt: new Date().toISOString(),
      kind: 'scanned',
      parsed: parsed,
      raw: parsed.raw
    });
    persistOffers();
    renderOffers();
  }

  function renderScanResults() {
    var body = $('scan-results-body');
    body.innerHTML = '';
    var results = state.scanResults;
    var hasText = $('scan-input').value.trim().length > 0;
    $('scan-results-wrap').hidden = results.length === 0;
    $('scan-save-all').hidden = results.length === 0;
    $('scan-empty').hidden = results.length > 0 || !hasText;

    var scored = results.map(function (p) {
      return { parsed: p, m: OfferParser.scoreOffer(p) };
    });
    scored.sort(function (a, b) {
      var av = isNum(a.m.effectiveMonthly) ? a.m.effectiveMonthly : Infinity;
      var bv = isNum(b.m.effectiveMonthly) ? b.m.effectiveMonthly : Infinity;
      return av - bv;
    });

    scored.forEach(function (r, i) {
      var tr = document.createElement('tr');
      var name = r.parsed.name || 'Oferta ' + (i + 1);
      tr.appendChild(cell('<span class="offer-name">' + escapeHtml(name) + '</span>', true));
      tr.appendChild(numCell(fmtMoney2(r.m.monthlyPayment), false));
      tr.appendChild(cell(r.m.term + ' m'));
      tr.appendChild(numCell(fmtMoney(r.m.driveOff), false));
      tr.appendChild(numCell(fmtMoney(r.parsed.msrp), false));
      tr.appendChild(numCell(fmtMoney2(r.m.effectiveMonthly), i === 0 && scored.length > 1 && isNum(r.m.effectiveMonthly)));
      tr.appendChild(numCell(isNum(r.m.pctOfMsrp) ? r.m.pctOfMsrp.toFixed(2) + ' %' : '—', false));
      tr.appendChild(numCell(isNum(r.m.score) ? r.m.score.toFixed(1) : '—', false));

      var td = document.createElement('td');
      var btn = document.createElement('button');
      btn.className = 'btn mini';
      btn.textContent = '💾 Guardar';
      btn.addEventListener('click', function () {
        saveScanned(r.parsed);
        btn.textContent = '✅ Guardada';
        btn.disabled = true;
      });
      td.appendChild(btn);
      tr.appendChild(td);
      body.appendChild(tr);
    });
  }

  /* ---------------- datos online (robot + research) ---------------- */

  var onlineData = { latest: null, status: null, history: [], intel: null };

  /* ---------------- seguimiento de modelos ---------------- */

  function loadWatchlist() {
    try {
      var w = JSON.parse(localStorage.getItem(WATCH_KEY));
      if (Array.isArray(w) && w.length) return w;
    } catch (e) { /* usar defaults */ }
    // Por defecto: el ranking curado completo
    return RankedModels.map(function (m) { return { make: m.make, model: m.model }; });
  }

  function persistWatchlist() {
    localStorage.setItem(WATCH_KEY, JSON.stringify(state.watchlist));
  }

  function findRanked(make, model) {
    for (var i = 0; i < RankedModels.length; i++) {
      if (RankedModels[i].make === make && RankedModels[i].model === model) return RankedModels[i];
    }
    return null;
  }

  // Palabras que delatan una foto que NO queremos (interiores, detalles…)
  var PHOTO_BAD = /interior|engine|dashboard|badge|logo|wheel|\brear\b|taillight|headlight|seat|trunk|cargo|boot|gauge|console|infotainment|grille|emblem|patent|concept/i;
  // Render de imagin.studio (clave demo pública → con marca de agua). Cambia
  // por tu propia clave de imagin.studio para obtener imágenes sin watermark.
  var IMAGIN_KEY = 'hrjavascript-mastery';

  /**
   * Foto del modelo: render de imagin si hay clave; si no, foto real de
   * Wikimedia Commons o la imagen del artículo de Wikipedia. Cachea la URL.
   */
  function loadPhoto(info, img) {
    var cacheKey = 'lf-photo7-' + info.make + '-' + info.model;
    var cached = null;
    try { cached = localStorage.getItem(cacheKey); } catch (e) { /* sin caché */ }
    img.addEventListener('load', function () {
      try { localStorage.setItem(cacheKey, img.src); } catch (e) { /* lleno */ }
    });
    if (cached) { img.src = cached; return; }

    function setPhoto(url) { if (url) img.src = url; }

    // Última red: imagen del artículo de Wikipedia
    function fallbackSummary() {
      fetch('https://en.wikipedia.org/api/rest_v1/page/summary/' +
        encodeURIComponent((info.wiki || (info.make + ' ' + info.model)).replace(/ /g, '_')))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          var thumb = d && d.thumbnail && d.thumbnail.source;
          if (thumb) setPhoto(thumb.replace(/\/(\d+)px-/, '/512px-'));
        })
        .catch(function () { /* placeholder */ });
    }

    // Principal: foto real del año actual en Commons (CORS con origin=*)
    function tryCommons() {
      var query = info.photoQuery || (info.make + ' ' + info.model);
      var api = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*' +
        '&generator=search&gsrnamespace=6&gsrlimit=20&gsrsearch=' + encodeURIComponent(query) +
        '&prop=imageinfo&iiprop=url&iiurlwidth=640';
      fetch(api)
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          var pages = d && d.query && d.query.pages ? Object.keys(d.query.pages).map(function (k) { return d.query.pages[k]; }) : [];
          var model = normalizeModel(info.model);
          var best = null;
          pages.forEach(function (p) {
            var t = p.title || '';
            if (!/\.(jpe?g)$/i.test(t)) return;
            if (PHOTO_BAD.test(t)) return;
            var ii = p.imageinfo && p.imageinfo[0];
            if (!ii || !ii.thumburl) return;
            var rel = normalizeModel(t).indexOf(model) >= 0 ? 0 : 1;
            var order = (p.index || 99) + rel * 100;
            if (!best || order < best.order) best = { url: ii.thumburl, order: order };
          });
          if (best) setPhoto(best.url); else fallbackSummary();
        })
        .catch(fallbackSummary);
    }

    // Con clave propia de imagin: render limpio, primero.
    if (IMAGIN_KEY && info.img) {
      var imagin = 'https://cdn.imagin.studio/getimage?customer=' + IMAGIN_KEY +
        '&make=' + encodeURIComponent(info.img.make) +
        '&modelFamily=' + encodeURIComponent(info.img.family) +
        (info.img.year ? '&modelYear=' + info.img.year : '') +
        '&angle=23&width=640&fileType=png';
      var probe = new Image();
      probe.onload = function () {
        if (probe.naturalWidth >= 320) setPhoto(imagin); else tryCommons();
      };
      probe.onerror = tryCommons;
      probe.src = imagin;
    } else {
      tryCommons();
    }
  }

  /* ---------------- inventario real (Auto.dev vía Vercel) ---------------- */

  function stockKey(info, trim) {
    return STOCK_PREFIX + info.make + '-' + info.model + (trim ? '::' + trim : '');
  }

  function stockCacheGet(info, trim) {
    try {
      var raw = localStorage.getItem(stockKey(info, trim));
      if (!raw) return null;
      var o = JSON.parse(raw);
      return o && o.data ? o : null;
    } catch (e) { return null; }
  }

  function stockCachePut(info, trim, data) {
    try {
      localStorage.setItem(stockKey(info, trim),
        JSON.stringify({ t: Date.now(), data: data }));
    } catch (e) { /* lleno */ }
  }

  /** Trim elegido por modelo (persistente). */
  function getTrimSel(info) {
    try { return localStorage.getItem('lf-trimsel-' + info.make + '-' + info.model) || ''; } catch (e) { return ''; }
  }

  function setTrimSel(info, v) {
    try { localStorage.setItem('lf-trimsel-' + info.make + '-' + info.model, v || ''); } catch (e) { /* lleno */ }
  }

  /** Opciones de trim: las curadas del modelo + las vistas en el stock cacheado. */
  function trimOptions(info) {
    var seen = {};
    var out = [];
    function add(t) {
      if (!t) return;
      var k = t.toLowerCase();
      if (!seen[k]) { seen[k] = true; out.push(t); }
    }
    (info.trims || []).forEach(add);
    var c = stockCacheGet(info, '');
    if (c && c.data && c.data.listings) c.data.listings.forEach(function (l) { add(l.trim); });
    add(getTrimSel(info));
    return out;
  }

  /** Consulta el inventario y lo guarda en caché. Devuelve una promesa con los datos. */
  function fetchInventory(info, trim) {
    return fetch('api/inventory?make=' + encodeURIComponent(info.make) +
      '&model=' + encodeURIComponent(info.model) +
      (trim ? '&trim=' + encodeURIComponent(trim) : '') +
      '&zip=11201&radius=25&minYear=2025')
      .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
      .then(function (res) {
        if (res.status === 200 && res.data.ok) {
          stockCachePut(info, trim, res.data);
          return res.data;
        }
        var err = new Error((res.data && res.data.message) || 'error');
        err.needsKey = !!(res.data && res.data.needsKey);
        throw err;
      });
  }

  /**
   * Pinta la caja de stock de una tarjeta: selector de trim + resultados
   * persistentes (caché) + botón actualizar. Con autoFetch (cambio de trim
   * del usuario) consulta al momento si no hay caché para ese trim.
   */
  function renderStockBox(info, box, autoFetch) {
    var trim = getTrimSel(info);
    box.innerHTML = '';

    var head = document.createElement('div');
    head.className = 'stock-head';
    var sel = document.createElement('select');
    sel.className = 'trim-select';
    var all = document.createElement('option');
    all.value = '';
    all.textContent = 'Todos los trims';
    sel.appendChild(all);
    trimOptions(info).forEach(function (t) {
      var o = document.createElement('option');
      o.value = t;
      o.textContent = t;
      sel.appendChild(o);
    });
    sel.value = trim;
    sel.addEventListener('change', function () {
      setTrimSel(info, sel.value);
      renderStockBox(info, box, true);
    });
    head.appendChild(sel);
    box.appendChild(head);

    var content = document.createElement('div');
    content.className = 'stock-content';
    box.appendChild(content);

    var c = stockCacheGet(info, trim);
    if (c) { renderStock(c.data, info, content, c.t, trim); return; }
    if (autoFetch) { fetchStockInto(info, content, trim); return; }
    var btn = document.createElement('button');
    btn.className = 'btn mini';
    btn.textContent = '📦 Ver stock cerca';
    btn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      fetchStockInto(info, content, trim);
    });
    content.appendChild(btn);
  }

  function fetchStockInto(info, box, trim) {
    box.innerHTML = '<small class="hint">📦 Buscando stock…</small>';
    fetchInventory(info, trim)
      .then(function (d) { renderStock(d, info, box, Date.now(), trim); })
      .catch(function (err) {
        box.innerHTML = '<small class="hint">' +
          (err.needsKey
            ? '📦 Falta la clave de Auto.dev en Vercel (mira el README). '
            : 'No se pudo consultar el stock ahora. ') +
          '<a href="' + info.linkNew + '" target="_blank" rel="noopener">Ver en cars.com ↗</a></small>';
      });
  }

  function renderStock(d, info, box, when, trim) {
    var refreshBtn = '<button type="button" class="btn mini subtle stock-refresh" title="Actualizar">↻</button>';
    var trimTag = trim ? ' <span class="trim-chip">' + escapeHtml(trim) + '</span>' : '';
    if (!d.shown) {
      box.innerHTML = '<div class="stock-summary">📦 Sin unidades 2025+ en ~25 mi' + trimTag +
        '<span class="stock-age">' + (when ? fmtAge(when) : '') + ' ' + refreshBtn + '</span></div>' +
        '<small class="hint"><a href="' + info.linkNew + '" target="_blank" rel="noopener">Ampliar en cars.com ↗</a></small>';
      bindStockRefresh(box, info, trim);
      return;
    }
    var bc = d.byCondition || {};
    var total = d.total || d.shown;
    var chips = condChipsHtml(bc);
    var html = '<div class="stock-summary">📦 <strong>' + total + '</strong> cerca' + trimTag +
      '<span class="stock-age">' + (when ? fmtAge(when) : '') + ' ' + refreshBtn + '</span></div>' +
      (chips ? '<div class="cond-row">' + chips + '</div>' : '') +
      '<div class="stock-range">' + fmtMoney(d.minPrice) + ' – ' + fmtMoney(d.maxPrice) +
      ' · 2025+ · ~25 mi</div>';

    var list = d.listings || [];
    if (list.length) {
      // Agrupados por condición, con la clave de lease en cada grupo.
      var groups = [
        { key: 'Nuevo', cls: 'nuevo', label: 'Nuevos', note: 'se pueden hacer lease' },
        { key: 'CPO', cls: 'cpo', label: 'CPO (seminuevo certificado)', note: 'lease poco común · se financian' },
        { key: 'Usado', cls: 'usado', label: 'Usados', note: 'solo compra / financiación' }
      ];
      function itemRow(c) {
        var cls = c.condition === 'Nuevo' ? 'nuevo' : (c.condition === 'CPO' ? 'cpo' : 'usado');
        return '<li><span class="cond-pill ' + cls + '">' + c.condition + '</span> ' +
          '<strong>' + fmtMoney(c.price) + '</strong> · ' + escapeHtml(c.title) +
          (c.miles ? ' · ' + c.miles.toLocaleString('es') + ' mi' : '') +
          (c.dealer ? ' · ' + escapeHtml(c.dealer) + (c.city ? ' (' + escapeHtml(c.city) + ', ' + escapeHtml(c.state || '') + ')' : '') : '') +
          (c.url ? ' · <a href="' + c.url + '" target="_blank" rel="noopener" title="Busca este VIN exacto y su concesionario">buscar este VIN ↗</a>' : '') +
          (c.carfax ? ' · <a href="' + c.carfax + '" target="_blank" rel="noopener">Carfax ↗</a>' : '') +
          '</li>';
      }
      var body = '';
      groups.forEach(function (g) {
        var items = list.filter(function (c) { return c.condition === g.key; });
        if (!items.length) return;
        body += '<div class="stock-group ' + g.cls + '">' + g.label + ' — ' + items.length +
          ' <em>' + g.note + '</em></div>' +
          '<ol class="stock-items">' + items.map(itemRow).join('') + '</ol>';
      });
      html += '<details class="stock-list"><summary>Ver las ' + list.length + ' unidades</summary>' +
        body + '</details>';
    }
    box.innerHTML = html;
    bindStockRefresh(box, info, trim);
    var det = box.querySelector('details.stock-list');
    if (det) det.addEventListener('click', function (ev) { ev.stopPropagation(); });
  }

  function bindStockRefresh(box, info, trim) {
    var b = box.querySelector('.stock-refresh');
    if (b) b.addEventListener('click', function (ev) {
      ev.stopPropagation();
      fetchStockInto(info, box, trim);
    });
  }

  /** Chips de condición con la clave de si se puede lease. */
  function condChipsHtml(bc) {
    var out = [];
    if (bc.nuevo) out.push('<span class="cond-chip nuevo" title="Los autos nuevos se pueden lease con la financiera de la marca">' + bc.nuevo + ' nuevos · lease ✓</span>');
    if (bc.cpo) out.push('<span class="cond-chip cpo" title="Seminuevo certificado: lease poco común, normalmente se financia">' + bc.cpo + ' CPO</span>');
    if (bc.usado) out.push('<span class="cond-chip usado" title="Usados: solo compra o financiación, sin lease">' + bc.usado + ' usados</span>');
    return out.join(' ');
  }

  /* ---------------- tarjetas de modelos ---------------- */

  function offersForModel(model) {
    var offers = (onlineData.latest && onlineData.latest.offers) || [];
    var f = normalizeModel(model);
    return offers.filter(function (e) {
      var hay = normalizeModel((e.name || '') + ' ' + ((e.parsed && e.parsed.raw) || ''));
      return hay.indexOf(f) >= 0;
    });
  }

  /** Tendencia del mejor precio de un modelo según el histórico del robot. */
  function trendForModel(makeModel) {
    var h = onlineData.history || [];
    var pts = h.filter(function (e) { return e.model === makeModel && e.best != null; });
    if (pts.length < 2) return null;
    var last = pts[pts.length - 1];
    var prev = null;
    for (var i = pts.length - 2; i >= 0; i--) {
      if (pts[i].best !== last.best) { prev = pts[i]; break; }
    }
    if (!prev) return { dir: 0, since: pts[0].t };
    return { dir: last.best < prev.best ? -1 : 1, prev: prev.best, last: last.best };
  }

  function intelFor(make, model) {
    return (onlineData.intel && onlineData.intel.models &&
      onlineData.intel.models[make + ' ' + model]) || null;
  }

  function renderWatchlist() {
    var grid = $('watch-grid');
    grid.innerHTML = '';
    var hasData = !!(onlineData.latest && onlineData.latest.updatedAt);

    // ¿Qué modelo tiene hoy la mejor relación pago/valor (efectivo ÷ MSRP)?
    var bestValueModel = null;
    var bestValuePct = Infinity;
    state.watchlist.forEach(function (w) {
      var info = findRanked(w.make, w.model);
      if (!info) return;
      var ms = offersForModel(w.model).filter(function (e) { return e.metrics && isNum(e.metrics.effectiveMonthly); });
      if (!ms.length) return;
      var best = Math.min.apply(null, ms.map(function (e) { return e.metrics.effectiveMonthly; }));
      var pct = best / info.msrp;
      if (pct < bestValuePct) { bestValuePct = pct; bestValueModel = w.model; }
    });

    // Orden: primero tus 4 prioritarios, luego el resto de tu lista
    function rankIndex(w) {
      var info = findRanked(w.make, w.model);
      if (info && info.priority) return info.priority;
      var i = RankedModels.findIndex(function (m) { return m.make === w.make && m.model === w.model; });
      return i < 0 ? 999 : 100 + i;
    }
    var sorted = state.watchlist.slice().sort(function (a, b) {
      return rankIndex(a) - rankIndex(b);
    });

    sorted.forEach(function (w) {
      var info = findRanked(w.make, w.model);
      var matches = offersForModel(w.model);
      var withPrice = matches.filter(function (e) { return e.metrics && isNum(e.metrics.effectiveMonthly); });
      withPrice.sort(function (a, b) { return a.metrics.effectiveMonthly - b.metrics.effectiveMonthly; });
      var best = withPrice[0];

      var card = document.createElement('div');
      card.className = 'watch-item';

      // Foto
      var photo = document.createElement('div');
      photo.className = 'model-photo';
      var ph = document.createElement('span');
      ph.className = 'photo-fallback';
      ph.textContent = w.make + ' ' + w.model;
      photo.appendChild(ph);
      if (info) {
        var img = document.createElement('img');
        img.alt = w.make + ' ' + w.model;
        img.addEventListener('load', function () { photo.classList.add('has-img'); });
        photo.appendChild(img);
        loadPhoto(info, img);
      }
      card.appendChild(photo);

      var body = document.createElement('div');
      body.className = 'watch-body';
      card.appendChild(body);

      // Título + prioridad + quitar
      var head = document.createElement('div');
      head.className = 'watch-head';
      var title = document.createElement('div');
      title.className = 'watch-title';
      title.innerHTML = '<span class="make">' + escapeHtml(w.make) + '</span> ' + escapeHtml(w.model);
      if (info && info.priority) {
        var prio = document.createElement('span');
        prio.className = 'prio-chip';
        prio.textContent = '❤ Prioridad';
        title.appendChild(prio);
      }
      var del = document.createElement('button');
      del.className = 'btn danger';
      del.textContent = '✕';
      del.title = 'Dejar de seguir';
      del.addEventListener('click', function () {
        state.watchlist = state.watchlist.filter(function (x) {
          return !(x.make === w.make && x.model === w.model);
        });
        persistWatchlist();
        renderWatchlist();
      });
      head.appendChild(title);
      head.appendChild(del);
      body.appendChild(head);

      // Ficha en una línea
      if (info) {
        var sub = document.createElement('div');
        sub.className = 'model-sub';
        sub.title = info.blurb;
        sub.innerHTML = '<strong>' + fmtMoney(info.price[0]) + ' – ' + fmtMoney(info.price[1]) + '</strong> · ' +
          escapeHtml(info.engine) + ' · ' + escapeHtml(info.mpg);
        body.appendChild(sub);
      }

      // Estado del lease
      var statusEl = document.createElement('div');
      statusEl.className = 'watch-status';
      if (matches.length) {
        var line = document.createElement('div');
        line.className = 'watch-found';
        line.textContent = '✅ ' + matches.length + ' oferta(s) de lease' +
          (best ? ' · mejor ' + fmtMoney2(best.metrics.effectiveMonthly) + '/mes' : '');
        line.title = best ? ((best.name || '') + ' — ' + best.source) : '';
        line.addEventListener('click', function () {
          var sel = $('online-model');
          var exists = Array.prototype.some.call(sel.options, function (o) { return o.value === w.model; });
          sel.value = exists ? w.model : '';
          if (onlineData.latest) renderOnline(onlineData.latest, onlineData.status);
          showView('offers');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        statusEl.appendChild(line);
        if (w.model === bestValueModel) {
          var chip = document.createElement('div');
          chip.className = 'value-chip';
          chip.textContent = '🏅 Mejor valor ahora mismo';
          statusEl.appendChild(chip);
        }
        var trend = trendForModel(w.make + ' ' + w.model);
        if (trend && trend.dir !== 0) {
          var tLine = document.createElement('div');
          tLine.className = 'hint';
          tLine.textContent = trend.dir < 0
            ? '📉 Bajó: antes ' + fmtMoney2(trend.prev) + '/mes'
            : '📈 Subió: antes ' + fmtMoney2(trend.prev) + '/mes';
          statusEl.appendChild(tLine);
        }
      } else {
        var none = document.createElement('div');
        none.className = 'watch-none';
        none.textContent = hasData ? '🔎 Lease: sin ofertas aún' : '⏳ Esperando la primera búsqueda…';
        statusEl.appendChild(none);
      }
      card.querySelector('.watch-body').appendChild(statusEl);

      // Research resumido en una línea (si existe para este modelo)
      var intel = intelFor(w.make, w.model);
      if (intel && intel.verdict) {
        var il = document.createElement('div');
        il.className = 'intel-line';
        il.textContent = intel.verdict;
        if (intel.benchmark) il.title = '🎯 ' + intel.benchmark;
        body.appendChild(il);
      }

      // Stock persistente (se restaura de la caché al cargar)
      if (info) {
        var stock = document.createElement('div');
        stock.className = 'stock-box';
        renderStockBox(info, stock);
        body.appendChild(stock);
      }

      // Acciones
      if (info) {
        var actionsEl = document.createElement('div');
        actionsEl.className = 'card-actions';
        var cmp = document.createElement('button');
        cmp.className = 'btn mini primary';
        cmp.textContent = '⚖️ ¿Qué me conviene?';
        cmp.addEventListener('click', function () {
          prefillDecide(info);
          showView('decide');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        actionsEl.appendChild(cmp);
        [['Nuevos ↗', info.linkNew], ['CPO ↗', info.linkCpo]].forEach(function (pair) {
          var a = document.createElement('a');
          a.className = 'btn mini subtle';
          a.textContent = pair[0];
          a.href = pair[1];
          a.target = '_blank';
          a.rel = 'noopener';
          actionsEl.appendChild(a);
        });
        body.appendChild(actionsEl);

        // Directorio compacto
        var where = document.createElement('details');
        where.className = 'where';
        var sum = document.createElement('summary');
        sum.textContent = '📍 Dónde mirar';
        where.appendChild(sum);
        var ul = document.createElement('ul');
        ul.className = 'where-list';
        info.dealers.concat(info.sites.map(function (s) { return { n: s.n, u: s.u }; }))
          .forEach(function (d) {
            var li = document.createElement('li');
            li.innerHTML = '<a href="' + d.u + '" target="_blank" rel="noopener">' + escapeHtml(d.n) + '</a>';
            ul.appendChild(li);
          });
        where.appendChild(ul);
        body.appendChild(where);
      }

      grid.appendChild(card);
    });

    var meta = $('watch-meta');
    if (hasData) {
      meta.textContent = 'Robot: última búsqueda ' + new Date(onlineData.latest.updatedAt).toLocaleString('es') +
        ' · corre 3 veces al día.';
    } else {
      meta.textContent = 'El robot busca ofertas de lease 3 veces al día.';
    }
  }

  /* ---------------- comparador entre marcas y modelos ---------------- */

  function loadCompare() {
    try {
      var a = JSON.parse(localStorage.getItem(COMPARE_KEY));
      if (Array.isArray(a) && a.length) return a;
    } catch (e) { /* defaults */ }
    // Por defecto: tus 4 prioritarios
    return RankedModels
      .filter(function (m) { return m.priority; })
      .sort(function (a, b) { return a.priority - b.priority; })
      .map(function (m) { return m.make + '|' + m.model; });
  }

  function persistCompare() {
    try { localStorage.setItem(COMPARE_KEY, JSON.stringify(state.compare)); } catch (e) { /* lleno */ }
  }

  function compareInfos() {
    return state.compare.map(function (key) {
      var p = key.split('|');
      return findRanked(p[0], p[1]);
    }).filter(Boolean);
  }

  function renderCompareChips() {
    var box = $('compare-chips');
    box.innerHTML = '';
    RankedModels.forEach(function (m) {
      var key = m.make + '|' + m.model;
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip' + (state.compare.indexOf(key) >= 0 ? ' on' : '');
      chip.innerHTML = '<span class="chip-make">' + escapeHtml(m.make) + '</span>' + escapeHtml(m.model);
      chip.addEventListener('click', function () {
        var i = state.compare.indexOf(key);
        if (i >= 0) state.compare.splice(i, 1); else state.compare.push(key);
        persistCompare();
        renderCompareChips();
        renderCompare();
      });
      box.appendChild(chip);
    });
  }

  function renderCompare() {
    var table = $('compare-table');
    var infos = compareInfos();
    $('compare-empty').hidden = infos.length > 0;
    table.innerHTML = '';
    if (!infos.length) return;

    var thead = document.createElement('thead');
    var hr = document.createElement('tr');
    var corner = document.createElement('th');
    corner.className = 'rowlabel';
    hr.appendChild(corner);
    infos.forEach(function (m) {
      var th = document.createElement('th');
      th.innerHTML = escapeHtml(m.model) + (m.priority ? ' <span class="prio-chip">❤</span>' : '') +
        '<span class="make">' + escapeHtml(m.make) + '</span>';
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    table.appendChild(tbody);

    function addRow(label, cellFn, bestIdx) {
      var tr = document.createElement('tr');
      var td0 = document.createElement('td');
      td0.className = 'rowlabel';
      td0.textContent = label;
      tr.appendChild(td0);
      infos.forEach(function (m, i) {
        var td = document.createElement('td');
        cellFn(m, td, i);
        if (bestIdx != null && bestIdx === i) td.classList.add('best');
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
      return tr;
    }

    // Foto
    addRow('', function (m, td) {
      var div = document.createElement('div');
      div.className = 'cmp-photo';
      var img = document.createElement('img');
      img.alt = m.make + ' ' + m.model;
      div.appendChild(img);
      loadPhoto(m, img);
      td.appendChild(div);
    });

    // Datos de stock cacheados por modelo (todos los trims)
    var caches = infos.map(function (m) { return stockCacheGet(m, ''); });

    function bestIndexBy(vals, lowerIsBetter) {
      var idx = null, bestV = null;
      vals.forEach(function (v, i) {
        if (!isNum(v)) return;
        if (bestV == null || (lowerIsBetter ? v < bestV : v > bestV)) { bestV = v; idx = i; }
      });
      return vals.filter(isNum).length > 1 ? idx : null;
    }

    // Precio de lista
    var msrps = infos.map(function (m) { return m.price[0]; });
    addRow('Precio (MSRP)', function (m, td) {
      td.innerHTML = '<strong>' + fmtMoney(m.price[0]) + '</strong><span class="sub">hasta ' + fmtMoney(m.price[1]) + '</span>';
    }, bestIndexBy(msrps, true));

    // Ficha
    addRow('Ficha', function (m, td) {
      td.innerHTML = escapeHtml(m.engine) + '<span class="sub">' + escapeHtml(m.drive) + ' · ' + escapeHtml(m.mpg) + '</span>';
    });

    // Stock cerca
    var totals = caches.map(function (c) { return c && c.data ? (c.data.total || c.data.shown) : null; });
    addRow('Stock cerca (2025+)', function (m, td, i) {
      var c = caches[i];
      if (!c) { td.innerHTML = '<span class="sub">— pulsa “Actualizar stock”</span>'; return; }
      var chips = condChipsHtml(c.data.byCondition || {});
      td.innerHTML = '<strong>' + (c.data.total || c.data.shown) + '</strong> unidades' +
        (chips ? '<span class="cond-row">' + chips + '</span>' : '') +
        '<span class="sub">' + fmtAge(c.t) + '</span>';
    }, bestIndexBy(totals, false));

    // Nuevo más barato
    var newPrices = caches.map(function (c) {
      return c && c.data && c.data.cheapestNew ? c.data.cheapestNew.price : null;
    });
    addRow('Nuevo más barato', function (m, td, i) {
      var c = caches[i];
      var ch = c && c.data && c.data.cheapestNew;
      if (!ch) { td.textContent = '—'; return; }
      td.innerHTML = '<strong>' + fmtMoney(ch.price) + '</strong>' +
        '<span class="sub">' + escapeHtml(ch.dealer || '') +
        (ch.url ? ' · <a href="' + ch.url + '" target="_blank" rel="noopener">buscar VIN ↗</a>' : '') + '</span>';
    }, bestIndexBy(newPrices, true));

    // CPO más barato
    var cpoPrices = caches.map(function (c) {
      return c && c.data && c.data.cheapestCpo ? c.data.cheapestCpo.price : null;
    });
    addRow('CPO más barato', function (m, td, i) {
      var c = caches[i];
      var ch = c && c.data && c.data.cheapestCpo;
      if (!ch) { td.textContent = '—'; return; }
      td.innerHTML = '<strong>' + fmtMoney(ch.price) + '</strong>' +
        '<span class="sub">' + escapeHtml(ch.dealer || '') +
        (ch.url ? ' · <a href="' + ch.url + '" target="_blank" rel="noopener">buscar VIN ↗</a>' : '') + '</span>';
    }, bestIndexBy(cpoPrices, true));

    // Mejor lease encontrado por el robot
    var leases = infos.map(function (m) {
      var ms = offersForModel(m.model).filter(function (e) { return e.metrics && isNum(e.metrics.effectiveMonthly); });
      if (!ms.length) return null;
      ms.sort(function (a, b) { return a.metrics.effectiveMonthly - b.metrics.effectiveMonthly; });
      return ms[0];
    });
    addRow('Mejor lease', function (m, td, i) {
      var b = leases[i];
      if (!b) { td.innerHTML = '<span class="sub">sin ofertas aún</span>'; return; }
      td.innerHTML = '<strong>' + fmtMoney2(b.metrics.effectiveMonthly) + '/mes</strong>' +
        '<span class="sub">' + escapeHtml(b.source || '') + '</span>';
    }, bestIndexBy(leases.map(function (b) { return b ? b.metrics.effectiveMonthly : null; }), true));

    // Análisis (research)
    var anyIntel = infos.some(function (m) { return intelFor(m.make, m.model); });
    if (anyIntel) {
      addRow('Análisis', function (m, td) {
        var it = intelFor(m.make, m.model);
        if (!it) { td.textContent = '—'; return; }
        td.innerHTML = '<span class="sub">' + escapeHtml(it.verdict || '') +
          (it.benchmark ? '<br>🎯 ' + escapeHtml(it.benchmark) : '') + '</span>';
      });
    }

    // Decidir
    addRow('', function (m, td) {
      var b = document.createElement('button');
      b.className = 'btn mini';
      b.textContent = '⚖️ Decidir';
      b.addEventListener('click', function () {
        prefillDecide(m);
        showView('decide');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      td.appendChild(b);
    });
  }

  /** Actualiza el stock de los modelos seleccionados (en serie, cuidando la cuota). */
  function compareLoadStock() {
    var btn = $('compare-load');
    var infos = compareInfos();
    // Solo consulta los que no tienen caché fresca
    var pending = infos.filter(function (m) {
      var c = stockCacheGet(m, '');
      return !c || (Date.now() - c.t) > STOCK_FRESH_MS;
    });
    if (!pending.length) { renderCompare(); return; }
    btn.disabled = true;
    var done = 0;
    function next() {
      if (done >= pending.length) {
        btn.disabled = false;
        btn.textContent = '📦 Actualizar stock';
        renderCompare();
        renderWatchlist();
        return;
      }
      var m = pending[done];
      btn.textContent = '📦 ' + (done + 1) + '/' + pending.length + ' — ' + m.model + '…';
      fetchInventory(m, '')
        .catch(function () { /* seguir con el resto */ })
        .then(function () {
          done++;
          renderCompare();
          next();
        });
    }
    next();
  }

  /* ---------------- ofertas online ---------------- */

  function loadOnline() {
    var meta = $('online-meta');
    meta.textContent = 'Cargando…';
    Promise.all([
      fetch('data/offers-latest.json', { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }),
      fetch('data/scan-status.json', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; }),
      fetch('data/price-history.json', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; }),
      fetch('data/market-intel.json', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; })
    ]).then(function (res) {
      onlineData.latest = res[0] || {};
      onlineData.status = res[1];
      onlineData.history = Array.isArray(res[2]) ? res[2] : [];
      onlineData.intel = res[3];
      renderOnline(onlineData.latest, onlineData.status);
      renderWatchlist();
      renderCompare();
    }).catch(function () {
      renderWatchlist();
      $('online-wrap').hidden = true;
      $('online-status-box').hidden = true;
      meta.textContent = 'Aún no hay resultados del robot. Puedes lanzarlo con “▶ Buscar ahora”.';
    });
  }

  function renderOnline(latest, status) {
    var allOffers = latest.offers || [];
    var meta = $('online-meta');
    var body = $('online-body');
    body.innerHTML = '';

    // Filtro por modelo seleccionado
    var fModel = normalizeModel($('online-model').value);
    var offers = !fModel ? allOffers : allOffers.filter(function (e) {
      var hay = normalizeModel((e.name || '') + ' ' + ((e.parsed && e.parsed.raw) || ''));
      return hay.indexOf(fModel) >= 0;
    });

    var when = latest.updatedAt ? new Date(latest.updatedAt).toLocaleString('es') : '—';
    var okCount = status && status.sources
      ? status.sources.filter(function (s) { return /^ok/.test(s.status); }).length
      : null;
    meta.textContent = 'Última corrida: ' + when + ' · ' +
      (fModel ? offers.length + ' de ' + allOffers.length : allOffers.length) + ' oferta(s)' +
      (okCount != null ? ' · ' + okCount + '/' + status.sources.length + ' fuentes' : '') +
      (fModel && !offers.length ? ' · ninguna fuente publicó ese modelo.' : '');

    if (status && status.sources && status.sources.length) {
      var ul = $('online-status');
      ul.innerHTML = '';
      status.sources.forEach(function (s) {
        var li = document.createElement('li');
        li.textContent = s.name + (s.region ? ' (' + s.region + ')' : '') + ': ' + s.status;
        ul.appendChild(li);
      });
      $('online-status-box').hidden = false;
    }

    $('online-wrap').hidden = offers.length === 0;
    if (!offers.length) return;

    // Tus SUVs objetivo primero; después por costo efectivo mensual.
    offers.sort(function (a, b) {
      if (!!b.isTarget !== !!a.isTarget) return b.isTarget ? 1 : -1;
      var av = a.metrics && isNum(a.metrics.effectiveMonthly) ? a.metrics.effectiveMonthly : Infinity;
      var bv = b.metrics && isNum(b.metrics.effectiveMonthly) ? b.metrics.effectiveMonthly : Infinity;
      return av - bv;
    });

    offers.forEach(function (e) {
      var m = e.metrics || {};
      var tr = document.createElement('tr');
      var name = (e.isTarget ? '🎯 ' : '') + (e.name || 'Oferta sin nombre');
      tr.appendChild(cell(
        '<span class="offer-name">' + escapeHtml(name) + '</span>' +
        '<span class="offer-meta">' + escapeHtml('vista desde ' +
          (e.firstSeen ? new Date(e.firstSeen).toLocaleDateString('es') : '—')) + '</span>', true));
      tr.appendChild(cell(e.source + (e.region ? ' · ' + e.region : '')));
      tr.appendChild(numCell(fmtMoney2(m.monthlyPayment), false));
      tr.appendChild(cell((m.term || '—') + ' m'));
      tr.appendChild(numCell(fmtMoney(m.driveOff), false));
      tr.appendChild(numCell(fmtMoney(e.parsed && e.parsed.msrp), false));
      tr.appendChild(numCell(fmtMoney2(m.effectiveMonthly), false));
      tr.appendChild(numCell(isNum(m.score) ? m.score.toFixed(1) : '—', false));

      var td = document.createElement('td');
      var btn = document.createElement('button');
      btn.className = 'btn mini';
      btn.textContent = '💾 Guardar';
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        saveScanned(e.parsed || {});
        btn.textContent = '✅ Guardada';
        btn.disabled = true;
      });
      td.appendChild(btn);
      tr.appendChild(td);
      body.appendChild(tr);
    });
  }

  /* ---------------- ¿lease, CPO o compra? ---------------- */

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }

  function prefillDecide(info) {
    var sel = $('decide-model');
    sel.value = info.make + '|' + info.model;
    applyDecideModel();
  }

  function applyDecideModel() {
    var val = $('decide-model').value;
    if (!val) { runDecide(); return; }
    var parts = val.split('|');
    var info = findRanked(parts[0], parts[1]);
    if (!info) { runDecide(); return; }
    $('decide-new').value = info.msrp;
    $('decide-cpo').value = Math.round(info.msrp * 0.74 / 50) * 50;
    // Si hay stock real cacheado, usa los precios reales más baratos.
    var c = stockCacheGet(info, '');
    if (c && c.data) {
      if (c.data.cheapestNew) $('decide-new').value = c.data.cheapestNew.price;
      if (c.data.cheapestCpo) $('decide-cpo').value = c.data.cheapestCpo.price;
    }
    // Lease: la mejor oferta real encontrada, o estimación (~1.2% del MSRP)
    var matches = offersForModel(info.model).filter(function (e) {
      return e.metrics && isNum(e.metrics.effectiveMonthly);
    });
    matches.sort(function (a, b) { return a.metrics.effectiveMonthly - b.metrics.effectiveMonthly; });
    var intel = intelFor(info.make, info.model);
    var intelDeal = intel && intel.deals && intel.deals.filter(function (d) { return d.effective != null; })[0];
    if (matches.length) {
      $('decide-lease').value = Math.round(matches[0].metrics.effectiveMonthly);
      $('decide-lease-hint').textContent = 'Oferta real encontrada: ' + (matches[0].name || matches[0].source);
    } else if (intelDeal) {
      $('decide-lease').value = Math.round(intelDeal.effective);
      $('decide-lease-hint').textContent = 'Del research: ' + intelDeal.title + ' (' + intelDeal.source + ').';
    } else {
      $('decide-lease').value = Math.round(info.msrp * 0.012);
      $('decide-lease-hint').textContent = 'Estimación (~1.2% del MSRP); edítalo si tienes una cotización real.';
    }
    runDecide();
  }

  function decideResultCard(opt, isWinner, horizonMonths) {
    var div = document.createElement('div');
    div.className = 'decide-option' + (isWinner ? ' decide-win' : '');
    var rows = [
      '<h3>' + (isWinner ? '🏆 ' : '') + escapeHtml(opt.label) + '</h3>',
      '<div class="decide-big">' + fmtMoney(opt.cost) + '</div>',
      '<small class="hint">costo total en el horizonte</small>',
      '<div>' + fmtMoney2(opt.cost / horizonMonths) + ' equivalentes/mes</div>',
      '<div class="hint">Pago: ' + fmtMoney2(opt.monthly) + '/mes' +
        (opt.down ? ' · enganche ' + fmtMoney(opt.down) : '') + '</div>'
    ];
    rows.push('<div class="hint">' + (opt.valueAtEnd > 0
      ? 'Al final el auto vale ' + fmtMoney(opt.valueAtEnd) + ' (tuyo)'
      : 'Al final no te queda auto (entregas el lease)') + '</div>');
    div.innerHTML = rows.join('');
    return div;
  }

  function runDecide() {
    var res = Decide.computeDecision({
      years: num($('decide-years').value) || 6,
      leaseMonthly: num($('decide-lease').value),
      newPrice: num($('decide-new').value),
      aprNew: num($('decide-apr-new').value),
      cpoPrice: num($('decide-cpo').value),
      aprCpo: num($('decide-apr-cpo').value),
      downPct: num($('decide-down').value),
      loanMonths: num($('decide-loan').value),
      depNew: num($('decide-dep-new').value),
      depCpo: num($('decide-dep-cpo').value),
      taxPct: num($('decide-tax').value)
    });
    var box = $('decide-results');
    box.innerHTML = '';
    var keys = ['lease', 'cpo', 'buyNew'];
    keys.forEach(function (k) {
      if (res.options[k]) box.appendChild(decideResultCard(res.options[k], res.winner === k, res.horizonMonths));
    });
    if (!Object.keys(res.options).length) {
      box.innerHTML = '<p class="hint">Captura al menos un precio o un pago de lease para comparar.</p>';
    }
  }

  /* ---------------- buscar ahora (vía función en Vercel) ---------------- */

  var SCAN_WORKFLOW_URL = 'https://github.com/julioservan/Lease-finder/actions/workflows/lease-scan.yml';

  function resetScanBtn() {
    var btn = $('scan-now-btn');
    btn.disabled = false;
    btn.textContent = '▶ Buscar ahora';
  }

  function scanNow() {
    var btn = $('scan-now-btn');
    btn.disabled = true;
    btn.textContent = '⏳ Lanzando…';
    fetch('api/scan', { method: 'POST' }).then(function (r) {
      return r.json()
        .catch(function () { return null; })
        .then(function (data) { return { status: r.status, data: data }; });
    }).then(function (r) {
      if (r.status === 200 && r.data && r.data.ok) {
        btn.textContent = '⏳ Buscando…';
        $('online-meta').textContent = '🔎 ' + r.data.message + ' La página se actualizará sola.';
        pollForUpdate();
      } else if (r.status === 429 && r.data) {
        resetScanBtn();
        alert(r.data.message);
      } else {
        // Sin función o sin token: plan B, lanzar desde GitHub a mano.
        showGithubFallback(r.data && r.data.message);
      }
    }).catch(function () {
      showGithubFallback(null);
    });
  }

  function showGithubFallback(reason) {
    resetScanBtn();
    $('online-meta').innerHTML =
      '⚠️ El lanzamiento directo no está disponible' +
      (reason ? ' (' + escapeHtml(reason) + ')' : '') + '. Plan B: ' +
      '<a href="' + SCAN_WORKFLOW_URL + '" target="_blank" rel="noopener">abre GitHub aquí</a>, ' +
      'presiona “Run workflow”, espera ~3 minutos y dale a ↻.';
  }

  /** Espera a que el escaneo publique datos nuevos y refresca la página sola. */
  function pollForUpdate() {
    var startedWith = onlineData.latest && onlineData.latest.updatedAt;
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      fetch('data/offers-latest.json', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.updatedAt && d.updatedAt !== startedWith) {
            clearInterval(timer);
            resetScanBtn();
            loadOnline();
          } else if (tries >= 20) { // ~10 minutos
            clearInterval(timer);
            resetScanBtn();
            $('online-meta').textContent = 'La búsqueda tarda más de lo normal; presiona ↻ en un rato.';
          }
        })
        .catch(function () { /* reintenta en el siguiente tick */ });
    }, 30000);
  }

  /* ---------------- exportar / importar / compartir ---------------- */

  function exportOffers() {
    var blob = new Blob([JSON.stringify(state.offers, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'lease-finder-ofertas.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importOffers(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var imported = JSON.parse(reader.result);
        if (!Array.isArray(imported)) throw new Error('formato');
        var existing = {};
        state.offers.forEach(function (o) { existing[o.id] = true; });
        var added = 0;
        imported.forEach(function (o) {
          if (o && (o.input || o.parsed) && !existing[o.id]) {
            state.offers.push(o);
            added++;
          }
        });
        persistOffers();
        renderOffers();
        alert(added + ' oferta(s) importada(s).');
      } catch (e) {
        alert('No se pudo leer el archivo: no parece un JSON de Lease Finder.');
      }
    };
    reader.readAsText(file);
  }

  function shareLink() {
    var input = readForm();
    var encoded = btoa(unescape(encodeURIComponent(JSON.stringify(input))));
    var url = location.origin + location.pathname + '#offer=' + encoded;
    var done = function () {
      var btn = $('share-btn');
      btn.textContent = '✅ Enlace copiado';
      setTimeout(function () { btn.textContent = '🔗 Copiar enlace'; }, 2000);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () { prompt('Copia el enlace:', url); });
    } else {
      prompt('Copia el enlace:', url);
    }
  }

  function loadFromHash() {
    var m = location.hash.match(/#offer=(.+)/);
    if (!m) return false;
    try {
      var input = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
      fillForm(input);
      return true;
    } catch (e) { return false; }
  }

  function clearForm() {
    $('lease-form').reset();
    state.editingId = null;
    $('save-btn').textContent = '💾 Guardar oferta';
    history.replaceState(null, '', location.pathname);
    recalc();
  }

  /* ---------------- arranque ---------------- */

  function init() {
    // Pestañas
    document.querySelectorAll('.tab').forEach(function (b) {
      b.addEventListener('click', function () { showView(b.dataset.view); });
    });
    var sharedOffer = loadFromHash();
    var savedTab = null;
    try { savedTab = localStorage.getItem(TAB_KEY); } catch (e) { /* default */ }
    showView(sharedOffer ? 'calc' : (savedTab || 'models'));

    $('lease-form').addEventListener('input', recalc);
    $('lease-form').addEventListener('change', recalc);
    $('lease-form').addEventListener('submit', saveOffer);
    $('clear-btn').addEventListener('click', clearForm);
    $('share-btn').addEventListener('click', shareLink);
    $('export-btn').addEventListener('click', exportOffers);
    $('import-btn').addEventListener('click', function () { $('import-file').click(); });
    $('import-file').addEventListener('change', function (ev) {
      if (ev.target.files[0]) importOffers(ev.target.files[0]);
      ev.target.value = '';
    });

    // Selectores de marca/modelo del formulario
    var makeSel = $('make');
    var makeOpt = document.createElement('option');
    makeOpt.value = '';
    makeOpt.textContent = '— Marca —';
    makeSel.appendChild(makeOpt);
    Object.keys(VehicleCatalog).forEach(function (make) {
      var o = document.createElement('option');
      o.value = make;
      o.textContent = make;
      makeSel.appendChild(o);
    });
    populateModels($('model'), '', '— Modelo —');
    makeSel.addEventListener('change', function () {
      populateModels($('model'), makeSel.value, '— Modelo —');
      recalc();
    });

    // Filtros por selector en el comparador de guardadas
    var filterMake = $('filter-make');
    Object.keys(VehicleCatalog).forEach(function (make) {
      var o = document.createElement('option');
      o.value = make;
      o.textContent = make;
      filterMake.appendChild(o);
    });
    filterMake.addEventListener('change', function () {
      state.filterMake = filterMake.value;
      state.filterModel = '';
      populateModels($('filter-model'), filterMake.value, 'Todos los modelos');
      renderOffers();
    });
    $('filter-model').addEventListener('change', function () {
      state.filterModel = $('filter-model').value;
      renderOffers();
    });

    // Selector de modelo de la sección de ofertas (agrupado por marca)
    var onlineSel = $('online-model');
    Object.keys(VehicleCatalog).forEach(function (make) {
      if (!VehicleCatalog[make].length) return;
      var group = document.createElement('optgroup');
      group.label = make;
      VehicleCatalog[make].forEach(function (model) {
        var o = document.createElement('option');
        o.value = model;
        o.textContent = model;
        group.appendChild(o);
      });
      onlineSel.appendChild(group);
    });
    onlineSel.addEventListener('change', function () {
      if (onlineData.latest) renderOnline(onlineData.latest, onlineData.status);
    });

    // Seguimiento de modelos
    state.watchlist = loadWatchlist();
    var watchMake = $('watch-make');
    var wOpt = document.createElement('option');
    wOpt.value = '';
    wOpt.textContent = '— Marca —';
    watchMake.appendChild(wOpt);
    Object.keys(VehicleCatalog).forEach(function (make) {
      if (!VehicleCatalog[make].length) return;
      var o = document.createElement('option');
      o.value = make;
      o.textContent = make;
      watchMake.appendChild(o);
    });
    populateModels($('watch-model'), '', '— Modelo —');
    watchMake.addEventListener('change', function () {
      populateModels($('watch-model'), watchMake.value, '— Modelo —');
    });
    $('watch-add').addEventListener('click', function () {
      var make = watchMake.value;
      var model = $('watch-model').value;
      if (!make || !model) { alert('Elige marca y modelo primero.'); return; }
      var dup = state.watchlist.some(function (w) { return w.make === make && w.model === model; });
      if (!dup) {
        state.watchlist.push({ make: make, model: model });
        persistWatchlist();
      }
      $('watch-model').value = '';
      renderWatchlist();
    });
    renderWatchlist();

    // Comparador entre marcas
    state.compare = loadCompare();
    renderCompareChips();
    renderCompare();
    $('compare-load').addEventListener('click', compareLoadStock);

    // Comparador ¿lease, CPO o compra?
    var decideSel = $('decide-model');
    var dOpt = document.createElement('option');
    dOpt.value = '';
    dOpt.textContent = '— Elige un modelo —';
    decideSel.appendChild(dOpt);
    RankedModels.forEach(function (m) {
      var o = document.createElement('option');
      o.value = m.make + '|' + m.model;
      o.textContent = m.make + ' ' + m.model;
      decideSel.appendChild(o);
    });
    decideSel.addEventListener('change', applyDecideModel);
    ['decide-years', 'decide-lease', 'decide-new', 'decide-apr-new', 'decide-cpo',
     'decide-apr-cpo', 'decide-tax', 'decide-down', 'decide-loan', 'decide-dep-new', 'decide-dep-cpo']
      .forEach(function (id) { $(id).addEventListener('input', runDecide); });

    $('online-refresh').addEventListener('click', loadOnline);
    $('scan-now-btn').addEventListener('click', scanNow);
    loadOnline();

    $('scan-btn').addEventListener('click', runScan);
    $('scan-save-all').addEventListener('click', function () {
      state.scanResults.forEach(saveScanned);
      state.scanResults = [];
      renderScanResults();
      $('offers-table').scrollIntoView({ behavior: 'smooth' });
    });

    document.querySelectorAll('#offers-table th.sortable').forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.dataset.sort;
        if (state.sortKey === key) {
          state.sortDesc = !state.sortDesc;
        } else {
          state.sortKey = key;
          state.sortDesc = key === 'score'; // score: más alto = mejor
        }
        renderOffers();
      });
    });

    recalc();
    renderOffers();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
