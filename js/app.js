/* Lease Finder — UI: cálculo en vivo, guardado de ofertas y comparador. */
(function () {
  'use strict';

  var STORAGE_KEY = 'lease-finder-offers';
  var CURRENCY_KEY = 'lease-finder-currency';

  var FIELDS = [
    'name', 'msrp', 'price', 'incentives', 'downPayment', 'term',
    'milesPerYear', 'residualPct', 'rateType', 'rate', 'acqFee',
    'capitalizeAcq', 'dispositionFee', 'upfrontFees', 'capFees',
    'taxPct', 'taxMethod', 'notes'
  ];

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    offers: loadOffers(),
    sortKey: 'effectiveMonthly',
    sortDesc: false,
    editingId: null
  };

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
    if (!isFinite(v)) return '—';
    return currency() + ' ' + v.toLocaleString('es', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function fmtMoney2(v) {
    if (!isFinite(v)) return '—';
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
      id: state.editingId || String(Date.now()) + '-' + Math.random().toString(36).slice(2, 7),
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
    var name = offer && offer.input.name ? '"' + offer.input.name + '"' : 'esta oferta';
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

    var rows = state.offers.map(function (o) {
      return { offer: o, calc: LeaseCalc.computeLease(o.input) };
    });

    rows.sort(function (a, b) {
      var d = a.calc[state.sortKey] - b.calc[state.sortKey];
      return state.sortDesc ? -d : d;
    });

    // Mejor valor por columna (min salvo score, que es max).
    var best = {};
    ['monthlyPayment', 'driveOff', 'effectiveMonthly', 'totalCost', 'pctOfMsrp'].forEach(function (k) {
      best[k] = Math.min.apply(null, rows.map(function (r) { return r.calc[k]; }));
    });
    best.score = Math.max.apply(null, rows.map(function (r) { return r.calc.score; }));

    rows.forEach(function (r) {
      var tr = document.createElement('tr');
      tr.dataset.id = r.offer.id;
      var name = r.offer.input.name || 'Oferta sin nombre';
      var date = r.offer.savedAt ? new Date(r.offer.savedAt).toLocaleDateString('es') : '';
      tr.appendChild(cell(
        '<span class="offer-name">' + escapeHtml(name) + '</span>' +
        '<span class="offer-meta">' + escapeHtml(date) + '</span>', true));
      tr.appendChild(cell(r.calc.term + ' m'));
      tr.appendChild(numCell(fmtMoney2(r.calc.monthlyPayment), r.calc.monthlyPayment === best.monthlyPayment && rows.length > 1));
      tr.appendChild(numCell(fmtMoney(r.calc.driveOff), r.calc.driveOff === best.driveOff && rows.length > 1));
      tr.appendChild(numCell(fmtMoney2(r.calc.effectiveMonthly), r.calc.effectiveMonthly === best.effectiveMonthly && rows.length > 1));
      tr.appendChild(numCell(fmtMoney(r.calc.totalCost), r.calc.totalCost === best.totalCost && rows.length > 1));
      tr.appendChild(numCell(r.calc.pctOfMsrp.toFixed(2) + ' %', r.calc.pctOfMsrp === best.pctOfMsrp && rows.length > 1));
      tr.appendChild(numCell(r.calc.score.toFixed(1), r.calc.score === best.score && rows.length > 1));

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
          if (o && o.input && !existing[o.id]) {
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
