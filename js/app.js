/* Lease Finder — UI: cálculo en vivo, guardado de ofertas y comparador. */
(function () {
  'use strict';

  var STORAGE_KEY = 'lease-finder-offers';
  var CURRENCY_KEY = 'lease-finder-currency';
  var WATCH_KEY = 'lease-finder-watchlist';

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
    watchlist: []
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

  function currency() { return $('currency').value || '$'; }

  function fmtMoney(v) {
    if (v == null || !isFinite(v)) return '—';
    return currency() + ' ' + v.toLocaleString('es', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function fmtMoney2(v) {
    if (v == null || !isFinite(v)) return '—';
    return currency() + ' ' + v.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
      runScan();
      $('scanner-card').scrollIntoView({ behavior: 'smooth' });
      return;
    }
    fillForm(offer.input);
    state.editingId = id;
    $('save-btn').textContent = '💾 Actualizar oferta';
    recalc();
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
      btn.className = 'btn';
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

  /* ---------------- ofertas encontradas online ---------------- */

  var onlineData = { latest: null, status: null };

  /* ---------------- seguimiento de modelos ---------------- */

  function loadWatchlist() {
    try {
      var w = JSON.parse(localStorage.getItem(WATCH_KEY));
      if (Array.isArray(w) && w.length) return w;
    } catch (e) { /* usar defaults */ }
    return [
      { make: 'Jeep', model: 'Cherokee' },
      { make: 'Ford', model: 'Bronco Sport' },
      { make: 'Mazda', model: 'CX-50' }
    ];
  }

  function persistWatchlist() {
    localStorage.setItem(WATCH_KEY, JSON.stringify(state.watchlist));
  }

  function offersForModel(model) {
    var offers = (onlineData.latest && onlineData.latest.offers) || [];
    var f = normalizeModel(model);
    return offers.filter(function (e) {
      var hay = normalizeModel((e.name || '') + ' ' + ((e.parsed && e.parsed.raw) || ''));
      return hay.indexOf(f) >= 0;
    });
  }

  function renderWatchlist() {
    var grid = $('watch-grid');
    grid.innerHTML = '';
    var hasData = !!(onlineData.latest && onlineData.latest.updatedAt);

    state.watchlist.forEach(function (w, idx) {
      var matches = offersForModel(w.model);
      var withPrice = matches.filter(function (e) { return e.metrics && isNum(e.metrics.effectiveMonthly); });
      withPrice.sort(function (a, b) { return a.metrics.effectiveMonthly - b.metrics.effectiveMonthly; });
      var best = withPrice[0];

      var card = document.createElement('div');
      card.className = 'watch-item ' + (matches.length ? 'found' : 'empty');

      var head = document.createElement('div');
      head.className = 'watch-head';
      var title = document.createElement('strong');
      title.textContent = w.make + ' ' + w.model;
      var del = document.createElement('button');
      del.className = 'btn danger';
      del.textContent = '✕';
      del.title = 'Dejar de seguir';
      del.addEventListener('click', function (ev) {
        ev.stopPropagation();
        state.watchlist.splice(idx, 1);
        persistWatchlist();
        renderWatchlist();
      });
      head.appendChild(title);
      head.appendChild(del);
      card.appendChild(head);

      var statusEl = document.createElement('div');
      statusEl.className = 'watch-status';
      if (matches.length) {
        var line = document.createElement('div');
        line.className = 'watch-found';
        line.textContent = '✅ ' + matches.length + ' oferta(s) encontrada(s)';
        statusEl.appendChild(line);
        if (best) {
          var bestLine = document.createElement('div');
          bestLine.textContent = 'Mejor: ' + fmtMoney2(best.metrics.effectiveMonthly) + '/mes efectivo' +
            (isNum(best.metrics.score) ? ' · score ' + best.metrics.score.toFixed(1) : '');
          statusEl.appendChild(bestLine);
          var srcLine = document.createElement('small');
          srcLine.className = 'hint';
          srcLine.textContent = (best.name || 'sin nombre') + ' — ' + best.source +
            (best.firstSeen ? ' · vista desde ' + new Date(best.firstSeen).toLocaleDateString('es') : '');
          statusEl.appendChild(srcLine);
        }
      } else {
        var empty = document.createElement('div');
        empty.textContent = hasData
          ? '🔎 Sin ofertas todavía — el robot sigue buscando a diario'
          : '⏳ Esperando la primera búsqueda…';
        statusEl.appendChild(empty);
      }
      card.appendChild(statusEl);

      card.addEventListener('click', function () {
        // Ver las ofertas de este modelo en la sección online
        var sel = $('online-model');
        var exists = Array.prototype.some.call(sel.options, function (o) { return o.value === w.model; });
        sel.value = exists ? w.model : '';
        if (onlineData.latest) renderOnline(onlineData.latest, onlineData.status);
        $('online-card').scrollIntoView({ behavior: 'smooth' });
      });
      grid.appendChild(card);
    });

    var meta = $('watch-meta');
    if (hasData) {
      var okCount = onlineData.status && onlineData.status.sources
        ? onlineData.status.sources.filter(function (s) { return /^ok/.test(s.status); }).length +
          '/' + onlineData.status.sources.length + ' fuentes respondieron · '
        : '';
      meta.textContent = 'Última búsqueda: ' + new Date(onlineData.latest.updatedAt).toLocaleString('es') +
        ' · ' + okCount + 'el robot busca solo 3 veces al día (~9 am, 1 pm y 5 pm NY).';
    } else {
      meta.textContent = 'El robot busca automáticamente 3 veces al día (~9 am, 1 pm y 5 pm NY).';
    }
  }

  function loadOnline() {
    var meta = $('online-meta');
    meta.textContent = 'Cargando resultados del escáner…';
    Promise.all([
      fetch('data/offers-latest.json', { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }),
      fetch('data/scan-status.json', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; })
    ]).then(function (res) {
      onlineData.latest = res[0] || {};
      onlineData.status = res[1];
      renderOnline(onlineData.latest, onlineData.status);
      renderWatchlist();
    }).catch(function () {
      renderWatchlist();
      $('online-wrap').hidden = true;
      $('online-status-box').hidden = true;
      meta.textContent = 'Aún no hay resultados publicados del escáner online. Corre a diario ' +
        '(~9 am NY) sobre las agencias vigiladas; puedes lanzarlo ya con “Escanear ahora”.';
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
      (fModel ? offers.length + ' de ' + allOffers.length : allOffers.length) + ' oferta(s) activa(s)' +
      (okCount != null ? ' · ' + okCount + '/' + status.sources.length + ' fuentes respondieron' : '') +
      '. Las 🎯 son tus SUVs objetivo.' +
      (fModel && !offers.length ? ' Ninguna fuente publicó ese modelo en la última corrida.' : '');

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
        '<span class="offer-meta">' + escapeHtml('visto desde ' +
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
      btn.className = 'btn';
      btn.textContent = '💾 Guardar';
      btn.addEventListener('click', function () {
        saveScanned(e.parsed || {});
        btn.textContent = '✅ Guardada';
        btn.disabled = true;
      });
      td.appendChild(btn);
      tr.appendChild(td);
      body.appendChild(tr);
    });
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
      'presiona “Run workflow”, espera ~3 minutos y dale a ↻ Recargar.';
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
            $('online-meta').textContent = 'La búsqueda tarda más de lo normal; presiona ↻ Recargar en un rato.';
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
    if (!m) return;
    try {
      var input = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
      fillForm(input);
    } catch (e) { /* hash inválido: ignorar */ }
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
    var savedCurrency = localStorage.getItem(CURRENCY_KEY);
    if (savedCurrency) $('currency').value = savedCurrency;

    loadFromHash();

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
    $('currency').addEventListener('input', function () {
      localStorage.setItem(CURRENCY_KEY, currency());
      recalc();
      renderOffers();
      renderScanResults();
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

    // Filtros por selector en el comparador
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

    // Selector de modelo de la sección online (agrupado por marca)
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
