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
  var VIEWS = ['board', 'usados', 'calc', 'coste', 'decide'];

  var FIELDS = [
    'make', 'model', 'trim', 'name', 'msrp', 'price', 'incentives', 'downPayment', 'tradeIn',
    'zeroDriveOff', 'term',
    'milesPerYear', 'residualPct', 'rateType', 'rate', 'acqFee',
    'capitalizeAcq', 'dispositionFee', 'upfrontFees', 'capFees',
    'taxPct', 'taxMethod', 'capitalizeTaxes', 'postIncentives', 'notes'
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
    boardMake: '',
    boardSort: { key: 'sent', desc: true },
    expanded: {}
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
    var vehicle = [input.make, input.model, input.trim].filter(Boolean).join(' ');
    if (vehicle && input.name) return vehicle + ' — ' + input.name;
    return vehicle || input.name || 'Oferta sin nombre';
  }

  /** Modelo del ranking (info) al que corresponde "Make Model", o null. */
  function rankedByLabel(label) {
    for (var i = 0; i < RankedModels.length; i++) {
      if (RankedModels[i].make + ' ' + RankedModels[i].model === label) return RankedModels[i];
    }
    return null;
  }

  /** Detecta el trim dentro de un texto usando la lista de trims del modelo.
   *  Prueba primero los más largos: "EX-L" debe ganar a "EX". */
  function findTrimIn(info, text) {
    if (!info || !info.trims || !text) return '';
    var t = String(text);
    var byLen = info.trims.slice().sort(function (a, b) { return b.length - a.length; });
    for (var i = 0; i < byLen.length; i++) {
      var re = new RegExp('\\b' + byLen[i].replace(/[.*+?^${}()|[\]\\-]/g, '\\$&') + '\\b', 'i');
      if (re.test(t)) return byLen[i];
    }
    return '';
  }

  /** Rellena el datalist de trims según la marca/modelo elegidos. */
  function populateTrims() {
    var dl = $('trim-list');
    if (!dl) return;
    dl.innerHTML = '';
    var info = findRanked($('make').value, $('model').value);
    ((info && info.trims) || []).forEach(function (t) {
      var o = document.createElement('option');
      o.value = t;
      dl.appendChild(o);
    });
  }

  /** Modelo / trim / fecha de una oferta guardada (manual o escaneada). */
  function offerVehicleCells(o) {
    var date = o.savedAt ? new Date(o.savedAt).toLocaleDateString('es') : '—';
    if (o.kind === 'scanned') {
      var p = o.parsed || {};
      var label = offerModelName({ name: p.name || '', parsed: p });
      var info = label ? rankedByLabel(label) : null;
      return {
        model: label || p.name || '—',
        detail: label ? (p.name || '') : '🔍 escaneada',
        trim: info ? findTrimIn(info, (p.name || '') + ' ' + (p.raw || '')) : '',
        date: date
      };
    }
    var input = o.input || {};
    return {
      model: [input.make, input.model].filter(Boolean).join(' ') || input.name || '—',
      detail: input.name || '',
      trim: input.trim || '',
      date: date
    };
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
    populateTrims();
    if (input.trim != null && $('trim')) $('trim').value = input.trim;
  }

  /* ---------------- pestañas ---------------- */

  function showView(name) {
    if (VIEWS.indexOf(name) < 0) name = 'board';
    VIEWS.forEach(function (v) {
      $('view-' + v).classList.toggle('active', v === name);
    });
    document.querySelectorAll('.tab').forEach(function (b) {
      b.classList.toggle('active', b.dataset.view === name);
    });
    try { localStorage.setItem(TAB_KEY, name); } catch (e) { /* sin persistencia */ }
    if (name === 'board') renderBoard();
    if (name === 'usados') renderUsados();
    if (name === 'coste') renderCoste();
  }

  /* ---------------- Coste real al mes (coste total de tenerlo) ---------------- */

  // Lo básico (siempre visible) + extras opcionales (plegados). La entrada NO
  // va aquí: es un pago único, no mensual, y se muestra aparte.
  var COSTE_ITEMS = [
    { name: 'Lease', note: 'pago mensual', color: '#6fb2f0', get: function (v) { return v.lease; } },
    // En NY el impuesto va SOBRE la cuota del lease: los anuncios dicen
    // "$339/mes + tax", así que sin esta línea el total sale corto.
    { name: 'Impuesto de NY', note: 'sobre la cuota (los anuncios ponen «+ tax»)', color: '#e0808a', get: function (v) { return v.tax; } },
    { name: 'Seguro', note: null, color: '#4dab6d', get: function (v) { return v.ins; } },
    { name: 'Gasolina', note: null, color: '#d9a84b', get: function (v) { return v.fuel; } },
    { name: 'Aparcamiento', note: null, color: '#c58bb0', get: function (v) { return v.park; } },
    { name: 'Mantenimiento', note: null, color: '#9aa4b2', get: function (v) { return v.maint; } },
    { name: 'Peajes (E-ZPass)', note: 'opcional', color: '#8bb45a', get: function (v) { return v.toll; } },
    { name: 'Peaje de congestión', note: 'opcional', color: '#d98a5a', get: function (v) { return v.cong; } },
    { name: 'Registro + inspección', note: 'DMV NY · anual ÷ 12', color: '#a99adf', get: function (v) { return v.reg; } }
  ];

  var costeModelFilled = false;

  function fillCosteModels() {
    if (costeModelFilled) return;
    var sel = $('c-model');
    if (!sel) return;
    RankedModels.forEach(function (info, i) {
      var b = LeaseDB.bestOffer(info);
      var eff = b && b.metrics ? b.metrics.effectiveMonthly : null;
      if (!isNum(eff)) return; // solo modelos con oferta real
      var o = document.createElement('option');
      o.value = String(i);
      o.textContent = info.make + ' ' + info.model + ' — ' + fmtMoney(eff) + '/mes';
      o.dataset.eff = String(Math.round(eff));
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () {
      var opt = sel.options[sel.selectedIndex];
      if (opt && opt.dataset.eff) {
        $('c-lease').value = opt.dataset.eff;
        $('c-tag').textContent = opt.textContent.split(' — ')[0];
        renderCoste();
      }
    });
    costeModelFilled = true;
  }

  /** Abre "Coste al mes" con el mejor lease real de un modelo ya puesto. */
  function prefillCoste(info) {
    fillCosteModels();
    var b = LeaseDB.bestOffer(info);
    var eff = b && b.metrics ? b.metrics.effectiveMonthly : null;
    if (isNum(eff)) {
      $('c-lease').value = Math.round(eff);
      $('c-tag').textContent = info.make + ' ' + info.model;
      // Sincroniza el selector si el modelo está en la lista.
      var sel = $('c-model');
      for (var i = 0; i < sel.options.length; i++) {
        if (sel.options[i].textContent.indexOf(info.make + ' ' + info.model + ' —') === 0) { sel.selectedIndex = i; break; }
      }
    } else {
      // Sin oferta: usa el MSRP × regla 1% como estimación de partida.
      if (info.msrp) $('c-lease').value = Math.round(info.msrp * 0.01);
      $('c-tag').textContent = info.make + ' ' + info.model + ' (estimado)';
    }
    renderCoste();
  }

  function costeNum(id) { var x = parseFloat(($(id) || {}).value); return isFinite(x) && x > 0 ? x : 0; }

  function renderCoste() {
    if (!$('c-lines')) return;
    fillCosteModels();

    var miles = costeNum('c-miles'), mpg = costeNum('c-mpg') || 1, gas = costeNum('c-gas');
    var leaseAmt = costeNum('c-lease');
    var taxRate = costeNum('c-tax'); // % (Brooklyn/NYC: 8,875 + 0,5 de recargo)
    var v = {
      lease: leaseAmt, tax: leaseAmt * (taxRate / 100), ins: costeNum('c-ins'),
      fuel: (miles / mpg) * gas, park: costeNum('c-park'), toll: costeNum('c-toll'),
      cong: costeNum('c-cong') * 9, maint: costeNum('c-maint'),
      reg: costeNum('c-reg') / 12
    };
    var down = costeNum('c-down'); // entrada: pago único, aparte del mensual
    var budget = costeNum('c-budget');

    var parts = COSTE_ITEMS.map(function (it) { return { it: it, amt: it.get(v) }; });
    var total = parts.reduce(function (s, p) { return s + p.amt; }, 0);

    var insurer = ($('c-insurer') && $('c-insurer').value || '').trim();
    $('c-lines').innerHTML = parts.map(function (p) {
      var note = p.it.note;
      if (p.it.name === 'Seguro' && insurer) note = escapeHtml(insurer); // aseguradora del usuario
      return '<div class="rec-line' + (p.amt <= 0 ? ' rec-zero' : '') + '">' +
        '<span class="rec-dot" style="background:' + p.it.color + '"></span>' +
        '<span class="rec-name">' + p.it.name + (note ? '<small>' + note + '</small>' : '') + '</span>' +
        '<span class="rec-amt">' + fmtMoney(p.amt) + '</span></div>';
    }).join('');

    var vis = parts.filter(function (p) { return p.amt > 0; });
    $('c-bar').innerHTML = vis.map(function (p) {
      return '<i style="width:' + (total > 0 ? (p.amt / total * 100).toFixed(2) : 0) + '%;background:' + p.it.color + '"></i>';
    }).join('');
    $('c-legend').innerHTML = vis.map(function (p) {
      return '<span><b style="background:' + p.it.color + '"></b>' + p.it.name + ' ' +
        (total > 0 ? Math.round(p.amt / total * 100) : 0) + '%</span>';
    }).join('');

    $('c-total').textContent = fmtMoney(total);
    $('c-year').textContent = fmtMoney(total * 12) + ' al año';
    $('c-fuel-out').textContent = fmtMoney(v.fuel) + '/mes';
    $('c-cong-out').textContent = fmtMoney(v.cong) + '/mes';

    // Entrada como pago ÚNICO (no mensual): se muestra aparte, sin sumar al /mes.
    var oneoff = $('c-oneoff');
    if (oneoff) oneoff.innerHTML = down > 0
      ? 'más <strong>' + fmtMoney(down) + '</strong> de entrada al firmar (una sola vez)'
      : 'sin entrada al firmar ($0)';

    var bs = $('c-bstat'), pill = $('c-bpill'), msg = $('c-bmsg');
    if (budget <= 0) {
      bs.className = 'bstat none'; pill.textContent = '—';
      msg.textContent = 'Pon vuestro tope y te digo si entra.';
    } else if (total <= budget) {
      bs.className = 'bstat ok'; pill.textContent = '✅ Entra';
      msg.textContent = 'Cabe con ' + fmtMoney(budget - total) + '/mes de margen. La cuenta sale.';
    } else {
      bs.className = 'bstat no'; pill.textContent = 'Se pasa';
      msg.textContent = 'Se pasa ' + fmtMoney(total - budget) + '/mes. Baja el lease o el seguro para que cuadre.';
    }
  }

  /* ---------------- perfiles de coche (Coste al mes) ---------------- */

  var COSTE_PROFILES_KEY = 'lf-coste-profiles-v1';
  var COSTE_FIELDS = ['c-lease', 'c-tax', 'c-down', 'c-term', 'c-ins', 'c-insurer', 'c-park',
    'c-maint', 'c-miles', 'c-mpg', 'c-gas', 'c-toll', 'c-cong', 'c-reg', 'c-budget'];

  function loadProfiles() {
    try { return JSON.parse(localStorage.getItem(COSTE_PROFILES_KEY)) || { list: [], activeId: null }; }
    catch (e) { return { list: [], activeId: null }; }
  }
  function saveProfiles(p) { try { localStorage.setItem(COSTE_PROFILES_KEY, JSON.stringify(p)); } catch (e) { /* lleno */ } }

  function costeGather() {
    var o = {};
    COSTE_FIELDS.forEach(function (id) { var el = $(id); if (el) o[id] = el.value; });
    o.tag = $('c-tag') ? $('c-tag').textContent : '';
    return o;
  }
  function costeApply(fields) {
    COSTE_FIELDS.forEach(function (id) { var el = $(id); if (el && fields[id] != null) el.value = fields[id]; });
    if (fields.tag && $('c-tag')) $('c-tag').textContent = fields.tag;
    renderCoste();
  }

  function refreshProfileSelect(activeId) {
    var sel = $('c-profile');
    if (!sel) return;
    var db = loadProfiles();
    sel.innerHTML = '<option value="">— Perfil nuevo —</option>' +
      db.list.map(function (p) { return '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>'; }).join('');
    sel.value = activeId || '';
  }

  function saveCosteProfile() {
    var db = loadProfiles();
    var name = ($('c-profile-name').value || '').trim() ||
      ($('c-tag') && $('c-tag').textContent) || 'Mi coche';
    var fields = costeGather();
    // Actualiza si ya existe un perfil activo/con ese nombre; si no, crea.
    var active = $('c-profile').value;
    var existing = db.list.filter(function (p) { return p.id === active || p.name.toLowerCase() === name.toLowerCase(); })[0];
    if (existing) { existing.name = name; existing.fields = fields; db.activeId = existing.id; }
    else {
      var id = 'p' + (db.list.length + 1) + '-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 8);
      db.list.push({ id: id, name: name, fields: fields });
      db.activeId = id;
    }
    saveProfiles(db);
    refreshProfileSelect(db.activeId);
    flashSaved($('c-profile-save'));
  }

  function deleteCosteProfile() {
    var db = loadProfiles();
    var active = $('c-profile').value;
    if (!active) return;
    db.list = db.list.filter(function (p) { return p.id !== active; });
    db.activeId = null;
    saveProfiles(db);
    $('c-profile-name').value = '';
    refreshProfileSelect('');
  }

  function selectCosteProfile() {
    var db = loadProfiles();
    var id = $('c-profile').value;
    var p = db.list.filter(function (x) { return x.id === id; })[0];
    db.activeId = id || null;
    saveProfiles(db);
    if (p) { $('c-profile-name').value = p.name; costeApply(p.fields); }
  }

  /** Copia de reserva cuando no hay navigator.clipboard (http, navegadores viejos). */
  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    } catch (e) { /* nada que hacer */ }
  }

  /** Copiar al portapapeles desde un botón con data-copy (VIN, etc.). Global:
   *  se llama vía onclick inline para que el stopPropagation de los <details>
   *  del stock no lo bloquee. */
  function lfCopy(btn) {
    var val = btn.getAttribute('data-copy') || '';
    function done() {
      var t = btn.getAttribute('data-label') || btn.textContent;
      btn.setAttribute('data-label', t);
      btn.textContent = '✅ Copiado'; btn.classList.add('ok');
      setTimeout(function () { btn.textContent = t; btn.classList.remove('ok'); }, 1400);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(val).then(done, function () { fallbackCopy(val); done(); });
    } else { fallbackCopy(val); done(); }
  }
  window.lfCopy = lfCopy;

  function flashSaved(btn) {
    if (!btn) return;
    var t = btn.textContent; btn.textContent = '✅ Guardado';
    setTimeout(function () { btn.textContent = t; }, 1200);
  }

  /* ---------------- cálculo en vivo ---------------- */

  function recalc() {
    var input = readForm();
    var r = LeaseCalc.computeLease(input);
    var hasData = LeaseCalc.num(input.msrp) > 0 && LeaseCalc.num(input.price) > 0;

    $('r-pretax').textContent = hasData ? fmtMoney2(r.basePayment) : '—';
    $('r-monthly').textContent = hasData ? fmtMoney2(r.monthlyPayment) : '—';
    $('r-dep').textContent = hasData ? fmtMoney2(r.monthlyDepreciation) : '—';
    $('r-rent').textContent = hasData ? fmtMoney2(r.monthlyRent) : '—';
    $('r-tax').textContent = hasData ? fmtMoney2(r.monthlyTax) : '—';
    $('r-driveoff').textContent = hasData ? fmtMoney2(r.driveOff) : '—';
    var dob = r.driveOffBreakdown || {};
    $('r-do-down').textContent = hasData ? fmtMoney2(dob.downPayment || 0) : '—';
    $('r-do-first').textContent = hasData ? fmtMoney2(dob.firstMonth || 0) : '—';
    $('r-do-fees').textContent = hasData ? fmtMoney2(dob.fees || 0) : '—';
    $('r-do-tax').textContent = hasData ? fmtMoney2(dob.upfrontTax || 0) : '—';
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

    // MODO "OFERTA DIRECTA": sin precio/residual/MF (p. ej. una URL de PND
    // importada) la calculadora hacia-delante no puede construir la cuota,
    // pero la cuota YA la sabemos. Calcula Resultados directo de la cuota +
    // el "al firmar" importado, y dilo claramente.
    var modeEl = $('r-mode');
    var quoted = LeaseCalc.num($('quotedMonthly') ? $('quotedMonthly').value : 0);
    var msrpN = LeaseCalc.num(input.msrp);
    if (!hasData && quoted > 0 && window.OfferParser) {
      var das = (calcImportOffer && isNum(calcImportOffer.dueAtSigning))
        ? calcImportOffer.dueAtSigning
        : LeaseCalc.num(input.downPayment);
      var m2 = OfferParser.scoreOffer({
        monthly: quoted,
        term: LeaseCalc.num(input.term) || 36,
        dueAtSigning: das,
        msrp: msrpN > 0 ? msrpN : null
      });
      $('r-pretax').textContent = fmtMoney2(quoted);
      $('r-monthly').textContent = fmtMoney2(quoted) + ' + tax';
      $('r-driveoff').textContent = fmtMoney(das);
      $('r-total').textContent = fmtMoney(m2.totalCost);
      $('r-effective').textContent = fmtMoney2(m2.effectiveMonthly);
      var milesN = LeaseCalc.num(input.milesPerYear);
      var totalMiles = milesN > 0 ? milesN * (m2.term / 12) : 0;
      $('r-permile').textContent = totalMiles > 0 ? fmtMoney2(m2.totalCost / totalMiles) : '—';
      var lhScore = msrpN > 0 && m2.effectiveMonthly > 0 ? msrpN / (m2.effectiveMonthly * 12) : null;
      $('r-score').textContent = lhScore != null ? lhScore.toFixed(1) : '—';
      $('r-pct').textContent = isNum(m2.pctOfMsrp) ? m2.pctOfMsrp.toFixed(2) + ' %' : '—';
      setScoreClass($('score-box'), lhScore != null ? (lhScore >= 8 ? 'good' : lhScore >= 6 ? 'warn' : 'bad') : '');
      setScoreClass($('pct-box'), isNum(m2.pctOfMsrp) ? (m2.pctOfMsrp <= 1 ? 'good' : m2.pctOfMsrp <= 1.25 ? 'warn' : 'bad') : '');
      if (modeEl) {
        modeEl.hidden = false;
        modeEl.textContent = 'Modo oferta directa: calculado con la cuota anunciada y el "al firmar" importados (la página no trae precio, residual ni MF). El impuesto va aparte.';
      }
    } else if (modeEl) {
      modeEl.hidden = true;
    }

    if ($('mf-result')) updateImpliedMF(); // el detector usa los mismos campos

    return r;
  }

  function setScoreClass(el, cls) {
    el.classList.remove('good', 'warn', 'bad');
    if (cls) el.classList.add(cls);
  }

  /* ---------- 🔍 detector de money factor implícito (calculadora) ---------- */

  /** Nivel del MF: dónde suelen moverse los bancos de marca. */
  function mfLevel(mf) {
    if (mf < 0) return { cls: 'good', txt: 'Mejor que 0% — hay incentivos fuertes detrás' };
    if (mf <= 0.0015) return { cls: 'good', txt: 'Bajo / promocional — buen tipo' };
    if (mf <= 0.0025) return { cls: 'ok', txt: 'Normal para bancos de marca' };
    if (mf <= 0.0035) return { cls: 'wait', txt: 'Alto — pide el buy rate al vendedor' };
    return { cls: 'pricey', txt: 'Muy alto — probablemente inflado (markup)' };
  }

  function mfLine(r, note) {
    var lvl = mfLevel(r.moneyFactor);
    return '<div class="mf-out">' +
      '<span class="sent ' + lvl.cls + '">MF ' + r.moneyFactor.toFixed(5) + ' · ≈' + r.aprEquivalent.toFixed(2) + '% TAE</span> ' +
      '<span>' + escapeHtml(lvl.txt) + '</span>' +
      '<div class="hint" style="margin-top:4px">Interés implícito: <b>' + fmtMoney2(Math.max(0, r.monthlyRent)) + '</b>/mes' +
      (note ? ' · ' + note : '') + '</div></div>';
  }

  function updateImpliedMF() {
    var out = $('mf-result');
    if (!out) return;
    var input = readForm();
    input.quotedMonthly = $('quotedMonthly') ? $('quotedMonthly').value : '';
    if (!(LeaseCalc.num(input.quotedMonthly) > 0)) { out.innerHTML = ''; return; }
    var r = LeaseCalc.impliedMF(input);
    if (r) {
      var note = LeaseCalc.num(input.price) > 0
        ? null
        : 'sin precio negociado (asumí MSRP): el MF real será ≥ este — pide el selling price';
      out.innerHTML = mfLine(r, note);
      return;
    }
    // Sin residual en la hoja: rango honesto con residuales típicos de SUV.
    var lo = LeaseCalc.impliedMF(Object.assign({}, input, { residualPct: 60 }));
    var hi = LeaseCalc.impliedMF(Object.assign({}, input, { residualPct: 55 }));
    if (lo && hi) {
      var negNote = hi.moneyFactor < 0
        ? ' La cuota queda por DEBAJO de la depreciación estimada: hay lease cash / descuento fuerte sin publicar (buena señal), o falta el precio real.'
        : '';
      out.innerHTML = '<div class="mf-out"><span class="sent ' + (hi.moneyFactor < 0 ? 'good' : 'wait') + '">MF entre ' + lo.moneyFactor.toFixed(5) +
        ' y ' + hi.moneyFactor.toFixed(5) + ' (≈' + lo.aprEquivalent.toFixed(1) + '–' + hi.aprEquivalent.toFixed(1) + '% TAE)</span>' +
        '<div class="hint" style="margin-top:4px">La hoja no trae el residual (estimado 55–60%). Pídeselo al vendedor para clavar el número.' + negNote + '</div></div>';
    } else {
      out.innerHTML = '<p class="hint">Me faltan datos para despejarlo: necesito al menos MSRP, plazo y cuota (y mejor precio + residual).</p>';
    }
  }

  /* ---------- 📸 foto → veredicto (importador de la calculadora) ---------- */

  /**
   * Una hoja/página = UNA oferta. El HTML crudo de muchas webs (p. ej. PND de
   * Leasehackr) trocea cada dato en su propia línea/bloque ("$", "299",
   * "per month"…), así que la oferta elegida se completa parseando el
   * documento ENTERO — incluida la cuota — y con dos reglas de honestidad:
   * el "due at signing" declarado manda sobre un "$0 down" suelto.
   */
  function mergedOfferFromText(joined) {
    joined = String(joined || '').trim();
    if (!joined) return null;
    var offers = OfferParser.scanText(joined);
    var whole = OfferParser.parseBlock(joined);
    if (!offers.length && whole.monthly == null) return null;
    // Prefiere ofertas que traen mensualidad; sin ninguna, parte del doc entero.
    var withMonthly = offers.filter(function (o) { return o.monthly != null; });
    var pool = withMonthly.length ? withMonthly : offers;
    pool.sort(function (a, b) { return costeCompleteness(b) - costeCompleteness(a); });
    var best = pool[0] || whole;
    ['monthly', 'msrp', 'price', 'milesPerYear', 'residualPct', 'residualAmount', 'dueAtSigning', 'downPayment',
     'acqFee', 'dealerFee', 'docFee', 'securityDeposit', 'term', 'moneyFactor', 'apr', 'vin'].forEach(function (k) {
      if (best[k] == null && whole[k] != null) best[k] = whole[k];
    });
    // "$0 down" en un bloque no anula el "due at signing" declarado en otro.
    if (best.dueAtSigning === 0 && whole.dueAtSigning > 0 && /due\s+at\s+signing|al\s+firmar/i.test(joined)) {
      best.dueAtSigning = whole.dueAtSigning;
    }
    best.raw = joined;
    return best;
  }

  /** Texto plano de una oferta → autorrellenar la calculadora. */
  function ingestCalcText(joined, setStatus, srcLabel) {
    var best = mergedOfferFromText(joined);
    if (!best) { setStatus('⚠ No encontré una mensualidad. ¿Se ve bien el precio en la página/hoja?'); return; }
    applyCalcImport(best, srcLabel);
    setStatus('✅ Oferta leída. Revisa los campos, el MF implícito y el veredicto de abajo.');
  }

  function importCalcFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length || !window.LeaseImport) return;
    var status = $('calc-import-status');
    function setStatus(t) { if (status) status.textContent = t; }
    var acc = [];
    var i = 0;
    (function next() {
      if (i >= files.length) { ingestCalcText(acc.join('\n---\n'), setStatus); return; }
      var f = files[i++];
      setStatus('Leyendo ' + (f.name || 'archivo') + '…');
      window.LeaseImport.fromFile(f, setStatus).then(function (res) {
        if (res && res.text) acc.push(res.text);
        next();
      }, function (err) {
        setStatus('⚠ ' + (err && err.message ? err.message : 'No se pudo leer el archivo'));
        next();
      });
    })();
  }

  /** 🔗 Pegar URL (Leasehackr PND, etc.) → descargar vía api/fetch-page → autorrellenar. */
  function importCalcUrl() {
    var inp = $('calc-url');
    var status = $('calc-import-status');
    function setStatus(t) { if (status) status.textContent = t; }
    var url = (inp && inp.value || '').trim();
    if (!url) { setStatus('Pega primero una URL (p. ej. una oferta de pnd.leasehackr.com).'); return; }
    setStatus('🔗 Descargando la página…');
    fetch('api/fetch-page?url=' + encodeURIComponent(url))
      .then(function (r) { return r.json().catch(function () { return null; }).then(function (d) { return { status: r.status, d: d }; }); })
      .then(function (res) {
        if (!res.d || !res.d.ok || !res.d.html) {
          setStatus('⚠ ' + ((res.d && res.d.message) || ('No pude leer la URL (HTTP ' + res.status + ').')) );
          return;
        }
        var host = '';
        try { host = new URL(url).hostname; } catch (e) { /* noop */ }
        ingestCalcText(OfferParser.htmlToText(res.d.html), setStatus, host);
      }, function () {
        setStatus('⚠ Sin conexión con api/fetch-page (¿estás en la versión de Vercel?). Plan B: guarda la página con Ctrl+S y súbela como .mhtml.');
      });
  }

  /** Trim buscado SOLO cerca de la mención del modelo (la página entera
   *  arrastra trims de otras ofertas, p. ej. un "Hybrid" lejano). */
  function findTrimNear(info, name, raw) {
    var inName = findTrimIn(info, name || '');
    if (inName) return inName;
    var t = String(raw || '');
    var idx = t.toLowerCase().indexOf(String(info.model).toLowerCase());
    if (idx < 0) return '';
    // Primero HACIA DELANTE ("Sportage EX AWD"): el trim va tras el modelo.
    // Solo si no hay nada, mira un poco hacia atrás (evita que un "Hybrid"
    // de los filtros de la página, antes del título, gane al trim real).
    return findTrimIn(info, t.slice(idx, idx + 300)) ||
      findTrimIn(info, t.slice(Math.max(0, idx - 120), idx));
  }

  // Última oferta importada en la Calculadora (para el modo "oferta directa"
  // de Resultados: la página trae cuota y al firmar, no residual/MF/precio).
  var calcImportOffer = null;

  function applyCalcImport(p, srcLabel) {
    calcImportOffer = p;
    function set(id, v) { var el = $(id); if (el && v != null && v !== '') el.value = v; }
    // Marca / modelo / trim: si la hoja identifica un modelo del ranking,
    // rellena los selects y detecta el trim con la lista de ese modelo.
    var label = offerModelName({ name: p.name || '', parsed: p });
    var info = label ? rankedByLabel(label) : null;
    if (info) {
      $('make').value = info.make;
      populateModels($('model'), info.make, '— Modelo —');
      $('model').value = info.model;
      populateTrims();
      var trim = findTrimNear(info, p.name, p.raw);
      if (trim) set('trim', trim);
    }
    // Detalle: el nombre parseado solo si aporta algo ("Kia" a secas no);
    // si vino de una URL, la fuente (p. ej. pnd.leasehackr.com) es más útil.
    var meaningfulName = p.name && (/\b20\d{2}\b/.test(p.name) || p.name.trim().indexOf(' ') > 0);
    set('name', meaningfulName ? p.name : (srcLabel || p.name));
    set('msrp', p.msrp);
    set('price', p.price);
    set('term', p.term);
    set('milesPerYear', p.milesPerYear);
    if (p.residualPct != null) set('residualPct', p.residualPct);
    else if (p.residualAmount != null && p.msrp) set('residualPct', Math.round(p.residualAmount / p.msrp * 1000) / 10);
    if (p.moneyFactor != null) { set('rateType', 'mf'); set('rate', p.moneyFactor); }
    else if (p.apr != null) { set('rateType', 'apr'); set('rate', p.apr); }
    set('acqFee', p.acqFee);
    set('downPayment', p.downPayment);
    var otherFees = (p.dealerFee || 0) + (p.docFee || 0);
    if (otherFees > 0) set('upfrontFees', otherFees);
    set('quotedMonthly', p.monthly);
    recalc();
    updateImpliedMF();
    // Veredicto completo (transparencia, condiciones, comparación con el robot).
    var box = $('calc-verdict');
    if (box) {
      var m = OfferParser.scoreOffer(p);
      box.innerHTML = costeVerdictHtml(p, m);
      box.hidden = false;
    }
  }

  /* ---------------- ofertas ---------------- */

  function saveOffer(ev) {
    ev.preventDefault();
    var input = readForm();
    if (!(LeaseCalc.num(input.msrp) > 0)) {
      alert('Captura al menos el MSRP antes de guardar.');
      return;
    }
    // Muchas hojas no traen el precio negociado: asume MSRP (peor caso) y
    // dilo, en vez de bloquear el guardado.
    if (!(LeaseCalc.num(input.price) > 0)) {
      input.price = input.msrp;
      toast('Sin precio negociado: guardada asumiendo precio = MSRP (peor caso). Edítala cuando lo tengas.', 'warn', 5000);
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
    persistOffers();
    renderOffers();
    // Confirmación visible: sin esto, la oferta "desaparece" hacia otra
    // pestaña (Tablero → Ofertas guardadas) y parece que no se guardó.
    var btn = $('save-btn');
    btn.textContent = '✅ Guardada';
    setTimeout(function () { btn.textContent = '💾 Guardar oferta'; }, 1800);
    var vc = offerVehicleCells(offer);
    toast('💾 Guardada: <b>' + escapeHtml([vc.model, vc.trim].filter(Boolean).join(' ')) +
      '</b> · ya tienes ' + state.offers.length + '. Ábrelas con “📂 Ver guardadas”.', 'success', 5000);
  }

  /** Salta a la lista de guardadas (Tablero) y la abre. */
  function goToSaved() {
    showView('board');
    var card = $('saved-card');
    if (card) {
      card.open = true;
      setTimeout(function () { card.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
    }
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
      var vc = offerVehicleCells(r.offer);
      tr.appendChild(cell(
        '<span class="offer-name">' + escapeHtml(vc.model) + '</span>' +
        (vc.detail ? '<span class="offer-meta">' + escapeHtml(vc.detail) + '</span>' : ''), true));
      tr.appendChild(cell(vc.trim || '—'));
      tr.appendChild(cell(vc.date));
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

    // contador del botón "Ver guardadas" de la Calculadora
    var vsb = $('view-saved-btn');
    if (vsb) vsb.textContent = '📂 Ver guardadas' + (state.offers.length ? ' (' + state.offers.length + ')' : '');

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

  /** Importa archivos (PDF/HTML/imagen/texto), extrae el texto y autorrellena. */
  function importOfferFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length || !window.LeaseImport) return;
    var status = $('import-status');
    function setStatus(t) { if (status) status.textContent = t; }
    var acc = [];
    var i = 0;
    (function next() {
      if (i >= files.length) {
        // Vuelca el texto extraído en el área y lánzalo por el parser.
        var joined = acc.join('\n---\n').trim();
        if (joined) {
          var prev = $('scan-input').value.trim();
          $('scan-input').value = prev ? (prev + '\n---\n' + joined) : joined;
          runScan();
          var n = state.scanResults.length;
          setStatus(n ? '✅ ' + n + ' oferta(s) detectada(s) — revísalas abajo y guarda.'
                      : '⚠ No se detectó ninguna mensualidad. Revisa el texto extraído abajo.');
        } else {
          setStatus('⚠ No se pudo extraer texto de ese archivo. Prueba con otro o pega el texto.');
        }
        return;
      }
      var f = files[i++];
      setStatus('Procesando ' + (f.name || 'archivo') + '…');
      window.LeaseImport.fromFile(f, setStatus).then(function (res) {
        if (res && res.text) acc.push(res.text);
        next();
      }, function (err) {
        setStatus('⚠ ' + (err && err.message ? err.message : 'No se pudo leer ' + (f.name || 'el archivo')));
        next();
      });
    })();
  }

  /**
   * "Coste al mes": importa la hoja de una oferta (PDF/HTML/captura), rellena
   * pago/entrada/plazo y muestra un veredicto honesto de qué tal es la oferta.
   */
  function importCosteFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length || !window.LeaseImport) return;
    var status = $('c-import-status');
    function setStatus(t) { if (status) status.textContent = t; }
    var acc = [];
    var i = 0;
    (function next() {
      if (i >= files.length) {
        var joined = acc.join('\n---\n').trim();
        if (!joined) { setStatus('⚠ No se pudo extraer texto. Prueba con otro archivo o usa la pestaña Tablero → Añadir una oferta.'); return; }
        // Misma lógica robusta que la Calculadora (fusiona el doc entero,
        // incluida la cuota, y respeta el due-at-signing declarado).
        var best = mergedOfferFromText(joined);
        if (!best) { setStatus('⚠ No encontré ninguna mensualidad en el archivo. ¿Es la hoja de la oferta?'); return; }
        applyImportedOffer(best);
        setStatus('✅ Oferta importada. Revisa el veredicto y el recibo.');
        return;
      }
      var f = files[i++];
      setStatus('Procesando ' + (f.name || 'archivo') + '…');
      window.LeaseImport.fromFile(f, setStatus).then(function (res) {
        if (res && res.text) acc.push(res.text);
        next();
      }, function (err) {
        setStatus('⚠ ' + (err && err.message ? err.message : 'No se pudo leer ' + (f.name || 'el archivo')));
        next();
      });
    })();
  }

  function costeCompleteness(p) {
    return ['monthly', 'term', 'dueAtSigning', 'downPayment', 'msrp', 'milesPerYear', 'residualPct', 'acqFee'].reduce(function (n, k) {
      return n + (p[k] != null ? 1 : 0);
    }, 0);
  }

  function applyImportedOffer(parsed) {
    var m = OfferParser.scoreOffer(parsed);
    if (isNum(m.monthlyPayment)) $('c-lease').value = Math.round(m.monthlyPayment);
    // La "entrada al firmar" del recibo es TODO el dinero del día uno.
    var upfront = isNum(m.oneTimeCosts) ? m.oneTimeCosts : (isNum(m.driveOff) ? m.driveOff : null);
    if (upfront != null) $('c-down').value = Math.round(upfront);
    if (m.term) $('c-term').value = m.term;
    $('c-tag').textContent = (parsed.name || 'Oferta importada').slice(0, 40);
    renderCoste();
    var box = $('c-import-verdict');
    if (box) { box.innerHTML = costeVerdictHtml(parsed, m); box.hidden = false; }
  }

  /** Veredicto de la oferta importada: qué tal es, qué revela y sus condiciones. */
  function costeVerdictHtml(p, m) {
    var conds = OfferParser.conditions ? OfferParser.conditions(p.raw) : [];
    var ds = m.dealScore;
    var pill = ds == null ? { cls: 'none', txt: 'Sin MSRP — puntuación parcial' }
      : ds >= 85 ? { cls: 'good', txt: 'Muy buena oferta · ' + ds + '/100' }
      : ds >= 70 ? { cls: 'good', txt: 'Buena oferta · ' + ds + '/100' }
      : ds >= 50 ? { cls: 'ok', txt: 'Correcta · ' + ds + '/100' }
      : { cls: 'pricey', txt: 'Floja · ' + ds + '/100' };

    var summary = '<div class="odx-summary">' +
      '<div class="odx-s"><span>💵 Mensual</span><strong>' + (isNum(m.monthlyPayment) ? fmtMoney2(m.monthlyPayment) + '<small>/mes</small>' : '—') + '</strong></div>' +
      '<div class="odx-s"><span>💳 Al firmar</span><strong>' + (isNum(m.oneTimeCosts) ? '~' + fmtMoney(m.oneTimeCosts) : (isNum(m.driveOff) ? '~' + fmtMoney(m.driveOff) : '—')) + '</strong></div>' +
      '<div class="odx-s"><span>🚗 Millas</span><strong>' + (p.milesPerYear ? p.milesPerYear.toLocaleString('es') + '<small>/año</small>' : '—') + '</strong></div>' +
      '<div class="odx-s"><span>📉 Efectivo</span><strong>' + (isNum(m.effectiveMonthly) ? fmtMoney2(m.effectiveMonthly) + '<small>/mes</small>' : '—') + '</strong></div>' +
      '<div class="odx-s"><span>📊 Deal Score</span><strong>' + (ds != null ? ds + '<small>/100</small>' : '—') + '</strong></div>' +
      '</div>';

    var transpHtml = '';
    if (OfferParser.transparency) {
      var tr = OfferParser.transparency(p);
      var TM = {
        high: { dot: '🟢', txt: 'Muy transparente', desc: 'La hoja desglosa los pagos iniciales, el residual y las millas.' },
        mid: { dot: '🟡', txt: 'Transparencia media', desc: 'Se entiende el coste, pero faltan datos — pregunta lo que no aclara antes de firmar.' },
        low: { dot: '🔴', txt: 'Poco transparente', desc: 'Solo se ve el mensual; pide el desglose completo del "due at signing" antes de firmar.' }
      };
      var tm = TM[tr.level];
      transpHtml = '<div class="odx-transp odx-transp-' + tr.level + '"><span class="odx-transp-dot">' + tm.dot + '</span>' +
        '<div class="odx-transp-body"><div class="odx-transp-h">' + tm.txt + ' <span class="odx-transp-score">' + tr.score + '% revelado</span></div>' +
        '<div class="odx-transp-desc">' + tm.desc + '</div>' +
        (tr.missing.length ? '<div class="odx-transp-miss">No aclara: ' + tr.missing.map(escapeHtml).join(' · ') + '</div>' : '') +
        '</div></div>';
    }

    var condHtml = conds.length
      ? '<div class="odx-conds" style="margin-top:8px">' + conds.map(function (c) { return '<span class="odx-cond">' + escapeHtml(c.label) + '</span>'; }).join('') + '</div>'
      : '';

    // Explicación equilibrada, con el modelo del ranking si lo reconocemos.
    var info = null;
    for (var i = 0; i < RankedModels.length && !info; i++) {
      var hay = LeaseDB.normalizeModel((p.name || '') + ' ' + (p.raw || ''));
      if (hay.indexOf(LeaseDB.normalizeModel(RankedModels[i].model)) >= 0) info = RankedModels[i];
    }
    var explain = explainOffer({}, info || { make: (p.name || 'este coche'), model: '' }, m, p, conds);
    var cmp = '';
    if (info) {
      var best = LeaseDB.bestOffer(info);
      if (best && isNum(best.metrics.effectiveMonthly) && isNum(m.effectiveMonthly)) {
        var diff = m.effectiveMonthly - best.metrics.effectiveMonthly;
        cmp = Math.abs(diff) < 5
          ? ' Está a la par del mejor ' + info.model + ' que ha visto el robot.'
          : diff < 0
            ? ' Es ' + fmtMoney(Math.abs(diff)) + '/mes MÁS BARATA (en efectivo) que el mejor ' + info.model + ' que ha visto el robot — muy fuerte.'
            : ' El robot ha visto un ' + info.model + ' por ' + fmtMoney(Math.abs(diff)) + '/mes menos en efectivo (' + escapeHtml(best.source || '') + ').';
      }
    }

    return '<div class="odx" style="margin-top:12px">' +
      '<div style="margin-bottom:8px"><span class="sent ' + pill.cls + '">' + pill.txt + '</span></div>' +
      summary + transpHtml + condHtml +
      (explain || cmp ? '<div class="odx-explain">' + escapeHtml(explain) + escapeHtml(cmp) + '</div>' : '') +
      '</div>';
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
      var vinHtml = r.parsed.vin
        ? '<div class="sc-vin"><span class="sc-vin-label">VIN</span><code class="sc-vin-code">' +
          escapeHtml(r.parsed.vin) + '</code><button type="button" class="sc-copy" onclick="lfCopy(this)" data-copy="' +
          escapeHtml(r.parsed.vin) + '" title="Copiar el VIN para la aseguradora">📋</button></div>'
        : '';
      tr.appendChild(cell('<span class="offer-name">' + escapeHtml(name) + '</span>' + vinHtml, true));
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

  /* ---------------- avisos (toasts) + barra de carga ---------------- */

  /** Muestra un aviso flotante. type: info | success | warn | error. */
  function toast(msg, type, ms) {
    var host = document.getElementById('toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toast-host';
      host.className = 'toast-host';
      document.body.appendChild(host);
    }
    var el = document.createElement('div');
    el.className = 'toast toast-' + (type || 'info');
    el.setAttribute('role', 'status');
    el.innerHTML = msg;
    var close = document.createElement('button');
    close.type = 'button'; close.className = 'toast-x'; close.textContent = '×';
    close.setAttribute('aria-label', 'Cerrar');
    close.addEventListener('click', function () { dismiss(); });
    el.appendChild(close);
    host.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); });
    var timer = setTimeout(dismiss, ms || 5000);
    function dismiss() {
      clearTimeout(timer);
      el.classList.remove('show');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
    }
    return el;
  }

  /** Barra de progreso indeterminada arriba del todo (varios trabajos a la vez). */
  var loadingJobs = 0;
  function loadingStart() {
    loadingJobs++;
    var bar = document.getElementById('load-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'load-bar';
      bar.innerHTML = '<div class="load-bar-fill"></div>';
      document.body.appendChild(bar);
    }
    bar.classList.add('on');
  }
  function loadingDone() {
    loadingJobs = Math.max(0, loadingJobs - 1);
    if (loadingJobs === 0) {
      var bar = document.getElementById('load-bar');
      if (bar) bar.classList.remove('on');
    }
  }

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
  // Fotos: usamos las FOTOS REALES de los anuncios que devuelve Auto.dev
  // (campo `image` de cada listing). Esas URLs suelen estar protegidas contra
  // hotlink (403 si el Referer no es el suyo), así que las servimos a través
  // de nuestra función serverless `api/photo?url=...`, que descarga los bytes
  // en el servidor con las cabeceras correctas. No gasta cuota de Auto.dev
  // (ya tenemos la URL) y no depende de Wikimedia ni de renders de terceros.
  var PHOTO_CACHE = 'lf-photo8-'; // guarda la foto representativa por modelo

  /** Envuelve la URL de la foto de un anuncio en nuestro proxy de bytes. */
  function photoProxy(url) {
    if (!url) return '';
    if (url.indexOf('api/photo') === 0) return url; // ya envuelta
    return 'api/photo?url=' + encodeURIComponent(url);
  }

  /** Foto representativa cacheada de un modelo (lista para <img src>), o ''. */
  function modelPhotoUrl(info) {
    try {
      var c = localStorage.getItem(PHOTO_CACHE + info.make + '-' + info.model);
      if (c) return photoProxy(c);
    } catch (e) { /* sin caché */ }
    return '';
  }

  /** Guarda la foto representativa de un modelo (URL de anuncio, sin envolver). */
  function cacheModelPhoto(info, rawUrl) {
    if (!rawUrl) return;
    try { localStorage.setItem(PHOTO_CACHE + info.make + '-' + info.model, rawUrl); } catch (e) { /* lleno */ }
  }

  // Nombre de color → hex para el swatch (coincidencia por subcadena).
  var COLOR_HEX = {
    white: '#eef0f2', pearl: '#eae6da', ivory: '#efe9d6', black: '#15171b', charcoal: '#33363b',
    silver: '#c7cacd', gray: '#83888d', grey: '#83888d', granite: '#6a6d70', platinum: '#d3d6d9',
    gunmetal: '#4a4e54', red: '#c0392b', maroon: '#6e1f2a', burgundy: '#6e1f2a', crimson: '#b01e2e',
    blue: '#2c5aa0', navy: '#1f3a5f', teal: '#1f7a7a', green: '#2e7d46', olive: '#5b6a2b',
    brown: '#6b4a2b', bronze: '#8a6a45', beige: '#d8c7a0', tan: '#cdb58a', gold: '#c9a94b',
    orange: '#d97b28', copper: '#a55a34', yellow: '#e6c828', purple: '#6b3fa0', pink: '#d96a9a'
  };
  function colorHex(name) {
    var n = (name || '').toLowerCase();
    for (var k in COLOR_HEX) { if (n.indexOf(k) >= 0) return COLOR_HEX[k]; }
    return null;
  }

  /**
   * Carga la foto representativa de un modelo en un <img>: usa la foto real
   * de un anuncio (a través de `api/photo`). Si aún no se ha descubierto
   * ninguna, intenta sacarla del stock ya cacheado; si no hay, deja el hueco
   * con el marcador (la celda muestra un placeholder por CSS).
   */
  function loadPhoto(info, img) {
    // 1) foto ya cacheada para este modelo
    var cached = modelPhotoUrl(info);
    if (cached) { img.src = cached; return; }

    // 2) derivarla del stock de nuevos ya consultado (si existe)
    var raw = firstStockImage(info);
    if (raw) {
      cacheModelPhoto(info, raw);
      img.src = photoProxy(raw);
      return;
    }
    // 3) sin foto todavía: sin src; quien pinta la celda marca el placeholder.
    img.removeAttribute('src');
  }

  /** Primera foto de anuncio disponible en el stock cacheado del modelo. */
  function firstStockImage(info) {
    var conds = ['new', 'used'];
    for (var i = 0; i < conds.length; i++) {
      var c = stockCacheGet(info, '', conds[i]);
      var list = c && c.data && c.data.listings;
      if (!list) continue;
      for (var j = 0; j < list.length; j++) {
        if (list[j] && list[j].image) return list[j].image;
      }
    }
    return '';
  }

  /* ---------------- inventario real (Auto.dev vía Vercel) ---------------- */

  // Dos datasets por modelo/trim: 'new' (nuevos, foco) y 'used' (segunda mano).
  function stockKey(info, trim, cond) {
    return STOCK_PREFIX + info.make + '-' + info.model + (trim ? '::' + trim : '') + '#' + (cond || 'new');
  }

  function stockCacheGet(info, trim, cond) {
    try {
      var raw = localStorage.getItem(stockKey(info, trim, cond));
      if (!raw) return null;
      var o = JSON.parse(raw);
      return o && o.data ? o : null;
    } catch (e) { return null; }
  }

  function stockCachePut(info, trim, cond, data) {
    try {
      localStorage.setItem(stockKey(info, trim, cond),
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
    var c = stockCacheGet(info, '', 'new');
    if (c && c.data && c.data.listings) c.data.listings.forEach(function (l) { add(l.trim); });
    add(getTrimSel(info));
    return out;
  }

  /** Consulta el inventario (cond 'new'|'used') y lo cachea. Devuelve promesa. */
  function fetchInventory(info, trim, cond) {
    cond = cond === 'used' ? 'used' : 'new';
    return fetch('api/inventory?make=' + encodeURIComponent(info.make) +
      '&model=' + encodeURIComponent(info.model) +
      (trim ? '&trim=' + encodeURIComponent(trim) : '') +
      '&cond=' + cond + '&zip=11201&radius=25&minYear=2025')
      .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
      .then(function (res) {
        if (res.status === 200 && res.data.ok) {
          stockCachePut(info, trim, cond, res.data);
          return res.data;
        }
        var err = new Error((res.data && res.data.message) || 'error');
        err.needsKey = !!(res.data && res.data.needsKey);
        throw err;
      });
  }

  /**
   * Caja de stock de una tarjeta: selector de trim + NUEVOS (foco) con caché
   * persistente + apartado "Segunda mano" que se consulta al abrirlo.
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

    var c = stockCacheGet(info, trim, 'new');
    if (c) { renderStock(c.data, info, content, c.t, trim); return; }
    if (autoFetch) { fetchStockInto(info, content, trim); return; }
    var btn = document.createElement('button');
    btn.className = 'btn mini';
    btn.textContent = '📦 Ver nuevos cerca (lease)';
    btn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      fetchStockInto(info, content, trim);
    });
    content.appendChild(btn);
  }

  function fetchStockInto(info, box, trim) {
    box.innerHTML = '<small class="hint">📦 Buscando nuevos…</small>';
    fetchInventory(info, trim, 'new')
      .then(function (d) { renderStock(d, info, box, Date.now(), trim); })
      .catch(function (err) {
        box.innerHTML = '<small class="hint">' +
          (err.needsKey
            ? '📦 Falta la clave de Auto.dev en Vercel (mira el README). '
            : 'No se pudo consultar el stock ahora. ') +
          '<a href="' + info.linkNew + '" target="_blank" rel="noopener">Ver en cars.com ↗</a></small>';
      });
  }

  function stockItemRow(c, pimg) {
    var cls = c.condition === 'Nuevo' ? 'nuevo' : (c.condition === 'CPO' ? 'cpo' : 'usado');
    // Foto REAL del anuncio (vía proxy de bytes); si no hay, la del modelo.
    var src = c.image ? photoProxy(c.image) : (pimg || '');
    var photo = src
      ? '<div class="sc-photo"><img loading="lazy" src="' + escapeHtml(src) + '"' +
        ' alt="' + escapeHtml(c.title) + '" onerror="this.parentNode.classList.add(\'noimg\');this.remove();"></div>'
      : '<div class="sc-photo noimg"></div>';

    var priceBlock = '<strong>' + fmtMoney(c.price) + '</strong>';
    if (c.discount && c.discount >= 250) priceBlock += '<span class="sc-off">−' + fmtMoney(c.discount) + ' vs MSRP</span>';
    else if (c.msrp && c.price && c.price > c.msrp) priceBlock += '<span class="sc-over">+' + fmtMoney(c.price - c.msrp) + ' sobre MSRP</span>';

    var color = '';
    if (c.color) {
      var hx = colorHex(c.color);
      color = '<span class="sc-color">' + (hx ? '<span class="sc-swatch" style="background:' + hx + '"></span>' : '') +
        escapeHtml(c.color) + (c.interior ? ' / ' + escapeHtml(c.interior) : '') + '</span>';
    }

    var specs = [];
    if (c.drivetrain) specs.push(escapeHtml(c.drivetrain));
    if (c.fuel) specs.push(escapeHtml(c.fuel));
    if (c.miles != null) specs.push(c.miles.toLocaleString('es') + ' mi');
    else if (c.condition === 'Nuevo') specs.push('nuevo');

    var hist = [];
    if (c.condition !== 'Nuevo') {
      if (c.accidents === 0) hist.push('<span class="sc-ok">✓ sin accidentes</span>');
      else if (c.accidents > 0) hist.push('<span class="sc-warn">⚠ ' + c.accidents + ' accidente(s)</span>');
      if (c.oneOwner) hist.push('<span class="sc-ok">✓ 1 dueño</span>');
      else if (c.owners > 1) hist.push(c.owners + ' dueños');
    }

    var links = [];
    if (c.url) links.push('<a href="' + c.url + '" target="_blank" rel="noopener" title="Busca este VIN exacto y su concesionario">buscar VIN ↗</a>');
    if (c.carfax) links.push('<a href="' + c.carfax + '" target="_blank" rel="noopener">Carfax ↗</a>');

    // VIN copiable: para pegarlo en la aseguradora (GEICO, etc. → "añadir por VIN").
    var vinLine = c.vin
      ? '<div class="sc-line sc-vin"><span class="sc-vin-label">VIN</span>' +
        '<code class="sc-vin-code">' + escapeHtml(c.vin) + '</code>' +
        '<button type="button" class="sc-copy" onclick="lfCopy(this)" data-copy="' + escapeHtml(c.vin) +
        '" title="Copiar el VIN para pegarlo en la aseguradora">📋 Copiar</button></div>'
      : '';

    return '<div class="stock-card">' + photo +
      '<div class="sc-body">' +
        '<div class="sc-top"><span class="cond-pill ' + cls + '">' + c.condition + '</span>' +
          '<span class="sc-price">' + priceBlock + '</span></div>' +
        '<div class="sc-title">' + escapeHtml(c.title) + '</div>' +
        (color ? '<div class="sc-line">' + color + '</div>' : '') +
        (specs.length ? '<div class="sc-line">' + specs.join(' · ') + '</div>' : '') +
        (hist.length ? '<div class="sc-line sc-hist">' + hist.join(' · ') + '</div>' : '') +
        (c.dealer ? '<div class="sc-line sc-dealer">🏬 ' + escapeHtml(c.dealer) +
          (c.city ? ' · ' + escapeHtml(c.city) + ', ' + escapeHtml(c.state || '') : '') + '</div>' : '') +
        vinLine +
        (links.length ? '<div class="sc-line sc-links">' + links.join(' · ') + '</div>' : '') +
      '</div></div>';
  }

  /** Pinta el bloque de NUEVOS (protagonista, para lease) desde datos cond=new. */
  function renderStock(d, info, box, when, trim) {
    var refreshBtn = '<button type="button" class="btn mini subtle stock-refresh" title="Actualizar">↻</button>';
    var trimTag = trim ? ' <span class="trim-chip">' + escapeHtml(trim) + '</span>' : '';
    var age = '<span class="stock-age">' + (when ? fmtAge(when) : '') + ' ' + refreshBtn + '</span>';
    var bc = d.byCondition || {};
    var pc = d.priceByCondition || {};
    var newList = (d.listings || []).filter(function (c) { return c.condition === 'Nuevo'; });

    // Enriquece el tablero: guarda la 1ª foto real de un anuncio como
    // foto representativa del modelo (así el Tablero deja de ser un hueco).
    var repImg = (newList.concat(d.listings || [])).filter(function (c) { return c && c.image; })[0];
    if (repImg && !modelPhotoUrl(info)) cacheModelPhoto(info, repImg.image);

    var html;
    if (bc.nuevo) {
      var nr = pc.nuevo || {};
      var totalNew = d.total || bc.nuevo;
      html = '<div class="stock-summary"><span class="cond-chip nuevo">🆕 ' + totalNew + ' nuevos · lease ✓</span>' +
        trimTag + age + '</div>' +
        '<div class="stock-range">' + (nr.min != null ? fmtMoney(nr.min) + ' – ' + fmtMoney(nr.max) : fmtMoney(d.minPrice) + ' – ' + fmtMoney(d.maxPrice)) +
        ' · 2025+ · ~25 mi</div>';
      if (newList.length) {
        var pimg = modelPhotoUrl(info);
        html += '<details class="stock-list"><summary>Ver ' + newList.length + ' nuevos (los más baratos)</summary>' +
          '<div class="stock-cards">' + newList.map(function (c) { return stockItemRow(c, pimg); }).join('') + '</div></details>';
      }
    } else {
      html = '<div class="stock-summary"><span class="cond-chip nuevo" style="opacity:.7">🆕 0 nuevos ahora</span>' +
        trimTag + age + '</div>' +
        '<small class="hint"><a href="' + info.linkNew + '" target="_blank" rel="noopener">Buscar nuevos en cars.com ↗</a></small>';
    }

    // La segunda mano (CPO/usados) vive en su propia pestaña.
    box.innerHTML = html;
    bindStockRefresh(box, info, trim);
    box.querySelectorAll('details.stock-list').forEach(function (det) {
      det.addEventListener('click', function (ev) { ev.stopPropagation(); });
    });
  }

  function renderSecondhand(d, body, info) {
    var list = d.listings || [];
    var pc = d.priceByCondition || {};
    var pimg = info ? modelPhotoUrl(info) : '';
    var row = function (c) { return stockItemRow(c, pimg); };
    var cpoList = list.filter(function (c) { return c.condition === 'CPO'; });
    var usedList = list.filter(function (c) { return c.condition === 'Usado'; });
    if (!cpoList.length && !usedList.length) {
      body.innerHTML = '<small class="hint">Sin CPO ni usados 2025+ cerca.</small>';
      return;
    }
    var inner = '';
    if (cpoList.length) {
      var cr = pc.cpo || {};
      inner += '<div class="stock-group cpo">CPO (seminuevo certificado) — ' + cpoList.length +
        ' <em>' + (cr.min != null ? fmtMoney(cr.min) + '–' + fmtMoney(cr.max) + ' · ' : '') + 'normalmente se financian</em></div>' +
        '<div class="stock-cards">' + cpoList.map(row).join('') + '</div>';
    }
    if (usedList.length) {
      var ur = pc.usado || {};
      inner += '<div class="stock-group usado">Usados — ' + usedList.length +
        ' <em>' + (ur.min != null ? fmtMoney(ur.min) + '–' + fmtMoney(ur.max) + ' · ' : '') + 'solo compra / financiación</em></div>' +
        '<div class="stock-cards">' + usedList.map(row).join('') + '</div>';
    }
    body.innerHTML = inner;
  }

  function bindStockRefresh(box, info, trim) {
    var b = box.querySelector('.stock-refresh');
    if (b) b.addEventListener('click', function (ev) {
      ev.stopPropagation();
      fetchStockInto(info, box, trim);
    });
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

  /* ---------------- TABLERO (base de datos de leases) ---------------- */

  var SENT_META = {
    best:   { txt: '⭐ La mejor', cls: 'best' },
    good:   { txt: 'Buena',       cls: 'good' },
    ok:     { txt: 'Normal',      cls: 'ok' },
    wait:   { txt: 'Espera',      cls: 'wait' },
    pricey: { txt: 'Cara',        cls: 'pricey' },
    none:   { txt: 'Sin datos',   cls: 'none' }
  };
  function sentRank(level) {
    return { best: 5, good: 4, ok: 3, wait: 2, pricey: 1, none: 0 }[level] || 0;
  }

  /** Mini-gráfico de la serie de precios (SVG puro, sin librerías). */
  function sparkline(series, w, h) {
    w = w || 72; h = h || 22;
    var pts = (series || []).filter(function (p) { return isNum(p.best); });
    if (pts.length < 2) return '<span class="spark-na">—</span>';
    var vals = pts.map(function (p) { return p.best; });
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    var rng = (max - min) || 1;
    var step = w / (pts.length - 1);
    var d = pts.map(function (p, i) {
      return (i * step).toFixed(1) + ',' + (h - 1 - ((p.best - min) / rng) * (h - 3)).toFixed(1);
    }).join(' ');
    var down = vals[vals.length - 1] <= vals[0];
    return '<svg class="spark ' + (down ? 'down' : 'up') + '" width="' + w + '" height="' + h +
      '" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
      '<polyline points="' + d + '" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  }

  function trendCell(tr) {
    if (!tr || tr.points < 2 || tr.deltaToday == null || tr.dir === 0) {
      return '<span class="trend-flat">—</span>';
    }
    var down = tr.dir < 0;
    return '<span class="trend ' + (down ? 'down' : 'up') + '">' + (down ? '▼' : '▲') + ' ' +
      fmtMoney(Math.abs(tr.deltaToday)) + '</span>';
  }

  /** Datos calculados de un modelo para el tablero (solo dealers/brokers reales:
   *  los agregadores se filtran dentro de LeaseDB.offersFor). */
  function boardData(info) {
    var offers = LeaseDB.offersFor(info);
    var best = offers.length ? offers[0].metrics.effectiveMonthly : null;
    var a = LeaseDB.assess(info, intelFor(info.make, info.model));
    var c = stockCacheGet(info, '', 'new');
    var stockNew = c && c.data ? ((c.data.byCondition && c.data.byCondition.nuevo) || c.data.total || 0) : null;
    return {
      info: info, offers: offers, best: best,
      pct: a.pct, assess: a, trend: a.trend, stockNew: stockNew,
      photo: modelPhotoUrl(info)
    };
  }

  function renderBoard() {
    var body = $('board-body');
    if (!body) return;
    body.innerHTML = '';

    var make = state.boardMake || '';
    var rows = RankedModels
      .filter(function (m) { return !make || m.make === make; })
      .map(boardData);

    // Promociona a "la mejor" el modelo con menor % (regla 1%) entre las buenas.
    var cand = rows.filter(function (r) { return (r.assess.level === 'good' || r.assess.level === 'ok') && isNum(r.pct); });
    if (cand.length) {
      cand.sort(function (a, b) { return a.pct - b.pct; });
      cand[0].assess.level = 'best';
    }

    // Orden
    var sk = state.boardSort.key, desc = state.boardSort.desc;
    function val(r) {
      switch (sk) {
        case 'name': return (r.info.make + ' ' + r.info.model).toLowerCase();
        case 'best': return isNum(r.best) ? r.best : Infinity;
        case 'pct': return isNum(r.pct) ? r.pct : Infinity;
        case 'trend': return r.trend && r.trend.deltaToday != null ? r.trend.deltaToday : Infinity;
        case 'offers': return r.offers.length;
        case 'stock': return isNum(r.stockNew) ? r.stockNew : -1;
        default: return sentRank(r.assess.level) + (isNum(r.pct) ? (2 - Math.min(2, r.pct)) : 0);
      }
    }
    rows.sort(function (a, b) {
      var x = val(a), y = val(b), d;
      if (typeof x === 'string') d = x < y ? -1 : x > y ? 1 : 0;
      else d = x - y;
      return desc ? -d : d;
    });

    rows.forEach(function (r) {
      body.appendChild(boardRow(r));
      var key = r.info.make + '|' + r.info.model;
      if (state.expanded[key]) body.appendChild(boardExpand(r));
    });

    // meta + indicadores de orden
    var withOffers = rows.filter(function (r) { return r.offers.length; }).length;
    var meta = $('board-meta');
    if (onlineData.latest && onlineData.latest.updatedAt) {
      meta.textContent = 'Base de datos: ' + withOffers + '/' + rows.length + ' modelos con leases · robot: ' +
        new Date(onlineData.latest.updatedAt).toLocaleString('es') + ' (3×/día). Crece con cada búsqueda.';
    } else {
      meta.textContent = 'La base de datos crece con cada búsqueda del robot (3×/día) y con lo que pegues en “Añadir una oferta”.';
    }
    document.querySelectorAll('#board-table th.sortable').forEach(function (th) {
      th.classList.toggle('sorted', th.dataset.sort === sk);
    });

    boardPreload(); // rellena foto + Nuevos de los modelos que aún no tienen stock
    renderTopDealers();
    renderDealers();
  }

  /* ---------------- nota del concesionario ---------------- */

  var GRADE_TXT = { A: 'juega limpio', B: 'bien, con matices', C: 'ojo con la letra pequeña', D: 'mensualidad gancho / condiciones', '?': 'pocos datos aún' };

  var dealerCache = { src: null, cards: [] };

  function dealerCards() {
    var src = onlineData.latest;
    if (dealerCache.src !== src) {
      dealerCache.src = src;
      dealerCache.cards = DealerScore.analyze((src && src.offers) || []);
    }
    return dealerCache.cards;
  }

  function gradeChip(grade, title) {
    var cls = grade === '?' ? 'q' : grade.toLowerCase();
    return '<span class="dgrade dgrade-' + cls + '" title="' + escapeHtml(title || GRADE_TXT[grade] || '') + '">' + grade + '</span>';
  }

  /**
   * Distancia y peaje de cada concesionario desde 1 City Point (Downtown
   * Brooklyn, 11201). Direcciones verificadas por búsqueda; distancias/tiempos
   * son estimaciones (dependen del tráfico). Las ofertas nuevas del robot ya
   * traen dist/toll; para las históricas se resuelve aquí por el nombre.
   */
  var DEALER_GEO = [
    { m: ['premier ford', 'bay ridge ford'], dist: 8.5, toll: false, addr: '612 86th St, Brooklyn 11228' },
    { m: ['starks ford'], dist: 9, toll: false, addr: '57-01 Northern Blvd, Woodside 11377' },
    { m: ['dana ford'], dist: 15, toll: 'Verrazzano', addr: '266 W Service Rd, Staten Island 10314' },
    { m: ['stevens'], dist: 13, toll: 'túnel + peaje', addr: '740 Route 440, Jersey City 07304' },
    { m: ['freehold ford'], dist: 40, toll: 'lejos', addr: 'Freehold, NJ' },
    { m: ['bical'], dist: 7.5, toll: false, addr: '2859 Flatbush Ave, Brooklyn 11234' },
    { m: ['island buick gmc'], dist: 13, toll: 'Verrazzano', addr: '1855 Hylan Blvd, Staten Island 10305' },
    { m: ['north bergen'], dist: 16, toll: 'túnel + peaje', addr: '7027 JFK Blvd, North Bergen 07047' },
    { m: ['milea'], dist: 16, toll: false, addr: 'Bronx, NY' },
    { m: ['lester glenn'], dist: 65, toll: 'lejos', addr: 'Toms River, NJ' },
    // Otros concesionarios reales que ya producen ofertas (direcciones verificadas)
    { m: ['bay ridge honda'], dist: 9, toll: false, addr: '8801 4th Ave, Brooklyn 11209' },
    { m: ['hyundai city'], dist: 9, toll: false, addr: '9013 4th Ave, Brooklyn 11209' },
    { m: ['paragon honda'], dist: 9, toll: false, addr: '57-02 Northern Blvd, Woodside 11377' },
    { m: ['plaza honda'], dist: 6, toll: false, addr: '2721 Nostrand Ave, Brooklyn 11210' },
    { m: ['plaza toyota'], dist: 6.5, toll: false, addr: '2721 Nostrand Ave, Brooklyn 11210' },
    { m: ['plaza kia'], dist: 6.5, toll: false, addr: '2740 Nostrand Ave, Brooklyn 11210' },
    { m: ['plaza hyundai'], dist: 6.5, toll: false, addr: 'Nostrand Ave, Brooklyn' },
    { m: ['bay ridge subaru'], dist: 9, toll: false, addr: 'Brooklyn 11209' },
    { m: ['bay ridge nissan'], dist: 9, toll: false, addr: 'Brooklyn 11209' },
    { m: ['bay ridge toyota'], dist: 9, toll: false, addr: 'Brooklyn' },
    { m: ['bay ridge vw', 'bay ridge volkswagen'], dist: 9, toll: false, addr: 'Brooklyn 11209' },
    { m: ['garden state honda'], dist: 16, toll: 'túnel + peaje', addr: 'Clifton, NJ' },
    { m: ['garden state'], dist: 16, toll: 'túnel + peaje', addr: 'NJ' },
    { m: ['open road mazda'], dist: 30, toll: 'lejos', addr: 'Morristown, NJ' },
    { m: ['ramsey mazda'], dist: 30, toll: 'lejos', addr: 'Ramsey, NJ' },
    { m: ['koeppel'], dist: 10, toll: false, addr: 'Woodside/Jackson Heights, Queens' },
    { m: ['metro honda'], dist: 12, toll: 'túnel + peaje', addr: 'Jersey City, NJ' },
    { m: ['hudson toyota'], dist: 12, toll: 'túnel + peaje', addr: 'Jersey City, NJ' },
    // Tanda nueva: dealers scrapeables para los modelos que estaban vacíos
    { m: ['westbury toyota'], dist: 22, toll: false, addr: '1121 Old Country Rd, Westbury 11590' },
    { m: ['penn toyota'], dist: 18, toll: false, addr: '2400 Northern Blvd, Greenvale 11548' },
    { m: ['star subaru'], dist: 14, toll: false, addr: '206-26 Northern Blvd, Bayside 11361' },
    { m: ['kings nissan'], dist: 7, toll: false, addr: '2758 Coney Island Ave, Brooklyn 11235' },
    { m: ['star nissan'], dist: 14, toll: false, addr: 'Bayside, Queens 11361' },
    { m: ['teddy volkswagen', 'teddy vw'], dist: 15, toll: 'puente RFK/Whitestone', addr: 'Bronx 10466' },
    { m: ['westbury jeep'], dist: 22, toll: false, addr: '100 Jericho Tpke, Westbury 11590' },
    { m: ['garden city jeep'], dist: 20, toll: false, addr: 'Garden City, LI 11530' },
    { m: ['yonkers kia'], dist: 20, toll: 'puente RFK', addr: '1850 Central Park Ave, Yonkers 10710' },
    { m: ['autoworld kia'], dist: 25, toll: false, addr: '2520 Hempstead Tpke, East Meadow 11554' }
  ];
  function dealerGeo(offerOrName) {
    var o = offerOrName;
    if (o && typeof o === 'object') {
      if (o.dist != null || o.toll != null) return { dist: o.dist, toll: o.toll, addr: o.addr || '' };
      o = o.source || o.name || '';
    }
    var name = String(o || '').toLowerCase();
    for (var i = 0; i < DEALER_GEO.length; i++) {
      if (DEALER_GEO[i].m.some(function (s) { return name.indexOf(s) >= 0; })) return DEALER_GEO[i];
    }
    return null;
  }
  /** Chip visual "📍 ~7,5 mi · sin peaje" (verde cerca / ámbar peaje / rojo lejos). */
  function dealerGeoChip(offerOrName) {
    var g = dealerGeo(offerOrName);
    if (!g || g.dist == null) return '';
    var far = typeof g.dist === 'number' && g.dist > 20;
    var cls = g.toll === false ? 'geo-near' : (far || g.toll === 'lejos' ? 'geo-far' : 'geo-mid');
    var tollTxt = g.toll === false ? 'sin peaje' : (g.toll === 'lejos' ? 'muy lejos' : '⚠ ' + g.toll);
    var n = typeof g.dist === 'number' ? g.dist.toLocaleString('es') : g.dist;
    return '<span class="geo-chip ' + cls + '" title="' + escapeHtml((g.addr ? g.addr + ' · ' : '') +
      'distancia aprox. en coche desde 1 City Point (según tráfico)') + '">📍 ~' + n + ' mi · ' + tollTxt + '</span>';
  }

  function renderDealers() {
    var body = $('dealers-body');
    if (!body) return;
    var cards = dealerCards();
    if (!cards.length) {
      body.innerHTML = '<tr><td colspan="6" class="hint">Aún no hay concesionarios con ofertas descubiertas.</td></tr>';
      return;
    }
    body.innerHTML = cards.map(function (d) {
      var conds = Object.keys(d.flagCounts).length
        ? Object.keys(d.flagCounts).map(function (k) {
            var def = { financing: 'financiación', tradein: 'trade-in', loyalty: 'loyalty', group: 'militar/estudiante', deposit: 'depósito' }[k] || k;
            return def + ' ×' + d.flagCounts[k];
          }).join(', ')
        : '—';
      return '<tr><td>' + gradeChip(d.grade, d.reasons.join(' · ')) + '</td>' +
        '<td>' + escapeHtml(d.name) + ' ' + dealerGeoChip(d.name) + '<span class="offer-meta">' + escapeHtml(d.region) + ' · ' + escapeHtml(d.reasons.join(' · ')) + '</span></td>' +
        '<td>' + d.offers + '</td>' +
        '<td>' + Math.round(d.dasPct * 100) + '%' + (d.zeroDown ? ' <span class="offer-meta">(' + d.zeroDown + ' con $0)</span>' : '') + '</td>' +
        '<td>' + (d.avgRatio != null ? '+' + Math.round((d.avgRatio - 1) * 100) + '%' : '—') + '</td>' +
        '<td>' + escapeHtml(conds) + '</td></tr>';
    }).join('');
  }

  /**
   * Benchmark del fabricante vía MarketCheck (api/incentives). NO es un
   * concesionario: es la referencia OEM para juzgar si un lease es bueno.
   * Bajo demanda (botón) para no gastar cuota de la API.
   */
  var oemLoading = false;
  // Caché de 24 h: el plan gratuito de MarketCheck son 500 llamadas/mes (no
  // acumulables) y cada pulsación consulta los 13 modelos. Sin caché, unas
  // pocas pulsaciones al día se comerían la cuota.
  var OEM_KEY = 'lf-oem-v1';
  var OEM_TTL = 24 * 60 * 60 * 1000;
  function oemCacheGet() {
    try {
      var c = JSON.parse(localStorage.getItem(OEM_KEY) || 'null');
      if (c && c.t && (Date.now() - c.t) < OEM_TTL && c.rows && c.rows.length) return c;
    } catch (e) { /* noop */ }
    return null;
  }
  function oemCacheSet(rows) {
    try { localStorage.setItem(OEM_KEY, JSON.stringify({ t: Date.now(), rows: rows })); } catch (e) { /* noop */ }
  }

  function loadIncentives(force) {
    if (oemLoading) return;
    var box = $('oem-results');
    var btn = $('oem-load');
    if (!box) return;
    if (!force) {
      var cached = oemCacheGet();
      if (cached) {
        renderOemRows(cached.rows, new Date(cached.t));
        return;
      }
    }
    oemLoading = true;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Consultando…'; }
    box.innerHTML = '<p class="hint"><span class="spin"></span> Pidiendo los programas del fabricante para tus modelos…</p>';

    var models = RankedModels.slice();
    var rows = [];
    var needsKey = false, errMsg = '';
    var i = 0;
    (function next() {
      if (i >= models.length) return done();
      var m = models[i++];
      fetch('api/incentives?make=' + encodeURIComponent(m.make) + '&model=' + encodeURIComponent(m.model) + '&zip=11201')
        .then(function (r) { return r.json().then(function (d) { return { status: r.status, d: d }; }); })
        .then(function (res) {
          if (res.status === 501 && res.d && res.d.needsKey) { needsKey = true; return done(); }
          // Fallo de cuenta (clave, plan sin incentivos, cuota): no tiene
          // sentido seguir con los otros 12 modelos — abortamos y avisamos.
          if (res.d && res.d.status && [401, 403, 429].indexOf(res.d.status) >= 0) {
            errMsg = res.d.message; return done();
          }
          if (res.d && res.d.ok && res.d.best && isNum(res.d.best.monthly)) {
            rows.push({ info: m, best: res.d.best });
          } else if (res.d && res.d.message && !errMsg) {
            errMsg = res.d.message;
          }
          next();
        }, function () { next(); });
    })();

    function done() {
      oemLoading = false;
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Actualizar programas OEM'; }
      if (needsKey) {
        box.innerHTML = '<p class="hint">🔑 Falta configurar la clave <code>MARKETCHECK_API_KEY</code> en Vercel (proyecto → Settings → Environment Variables). Consíguela en <a href="https://www.marketcheck.com/apis" target="_blank" rel="noopener">marketcheck.com/apis</a> (plan con «Incentives») y pégala ahí — <b>nunca</b> en el repo. Luego pulsa «Cargar programas OEM».</p>';
        return;
      }
      if (!rows.length) {
        box.innerHTML = '<p class="hint">No se obtuvieron programas' + (errMsg ? ' (' + escapeHtml(errMsg) + ')' : '') + '. Revisa que el plan de MarketCheck incluya incentivos de lease.</p>';
        return;
      }
      rows.sort(function (a, b) { return a.best.monthly - b.best.monthly; });
      oemCacheSet(rows.map(function (r) { return { name: r.info.make + ' ' + r.info.model, best: r.best }; }));
      renderOemRows(rows.map(function (r) { return { name: r.info.make + ' ' + r.info.model, best: r.best }; }), new Date());
    }
  }

  /** Pinta la tabla del benchmark OEM (desde la API o desde la caché de 24 h). */
  function renderOemRows(rows, when) {
    var box = $('oem-results');
    if (!box) return;
    box.innerHTML = '<div class="table-wrap"><table class="offers-table"><thead><tr>' +
      '<th>Modelo</th><th>Mensual (ref.)</th><th>Plazo</th><th>Residual</th><th>Money factor</th><th>Lease cash</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var b = r.best;
        return '<tr><td>' + escapeHtml(r.name) + '</td>' +
          '<td><b>' + fmtMoney(b.monthly) + '</b>/mes' + (b.estimated ? ' <span class="offer-meta">estimado</span>' : '') + '</td>' +
          '<td>' + (b.term || '—') + 'm</td>' +
          '<td>' + (isNum(b.residualPct) ? b.residualPct + '%' : '—') + '</td>' +
          '<td>' + (isNum(b.moneyFactor) ? b.moneyFactor : '—') + '</td>' +
          '<td>' + (isNum(b.leaseCash) ? fmtMoney(b.leaseCash) : '—') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="hint">«Ref.» = mensualidad orientativa del programa OEM (impuestos/DMV aparte). Compárala con lo que te ofrezca un concesionario: si te piden bastante más, hay margen para negociar.' +
      (when ? ' <span class="offer-meta">Consultado el ' + when.toLocaleString('es') + ' · se guarda 24 h para no gastar cuota.</span>' : '') + '</p>' +
      '<button type="button" class="btn mini subtle" id="oem-refresh">🔄 Forzar actualización (gasta cuota)</button>';
    var rb = $('oem-refresh');
    if (rb) rb.addEventListener('click', function () { loadIncentives(true); });
  }

  /** Nota del concesionario de UNA oferta (para el desplegable del Tablero). */
  function dealerGradeFor(source) {
    var d = dealerCards().filter(function (x) { return x.name === source; })[0];
    return d ? gradeChip(d.grade, d.reasons.join(' · ')) : '';
  }

  /** ¿Oferta oficial del fabricante? (no es un concesionario: es el precio de fábrica). */
  function isOemOffer(o) {
    return /fabricante/i.test((o && o.region) || '') || /—\s*ofertas oficiales|ofertas Greater NY/i.test((o && o.source) || '');
  }

  /**
   * ¿Excluir del TOP de concesionarios? Brokers y agregadores siempre; también
   * las ofertas oficiales de fabricante (son la referencia, no un dealer donde
   * firmas). Ojo: sí cuentan en la cobertura por modelo del Tablero.
   */
  function isBrokerOrAgg(o) {
    return (window.LeaseDB && LeaseDB.isBroker && LeaseDB.isBroker(o)) ||
      /agregador|por modelo/i.test(o.region || '') || /carsdirect|edmunds|truecar/i.test(o.source || '') ||
      isOemOffer(o);
  }

  var TD_MAKES = /honda|toyota|ford|gmc|hyundai|kia|mazda|subaru|nissan|jeep|volkswagen|chevrolet|buick|bmw/i;
  /** Modelo del ranking al que corresponde una oferta (nombre limpio, no el título crudo). */
  function offerModelName(o) {
    if (!window.LeaseDB || !LeaseDB.normalizeModel) return null;
    var name = o.name || '';
    var useName = /\b20\d{2}\b/.test(name) && TD_MAKES.test(name);
    var hay = LeaseDB.normalizeModel(useName ? name : name + ' ' + ((o.parsed && o.parsed.raw) || ''));
    for (var i = 0; i < RankedModels.length; i++) {
      if (hay.indexOf(LeaseDB.normalizeModel(RankedModels[i].model)) >= 0) {
        return RankedModels[i].make + ' ' + RankedModels[i].model;
      }
    }
    return null;
  }

  /**
   * 🏆 Top de concesionarios REALES (nunca brokers/agregadores), ordenados por
   * un compuesto transparente: cercanía a 1 City Point + peaje + nota de
   * honestidad + transparencia de sus anuncios + nº de ofertas.
   */
  function renderTopDealers() {
    var box = $('top-dealers');
    if (!box) return;
    var offers = (onlineData.latest && onlineData.latest.offers) || [];
    var groups = {};
    offers.forEach(function (o) {
      if (!o || !o.source || isBrokerOrAgg(o)) return;
      var m = o.metrics || {};
      if (!isNum(m.effectiveMonthly)) return;
      (groups[o.source] = groups[o.source] || []).push(o);
    });
    var gradeBy = {};
    dealerCards().forEach(function (c) { gradeBy[c.name] = c; });

    var rows = Object.keys(groups).map(function (name) {
      var offs = groups[name];
      var geo = dealerGeo(name) || {};
      var card = gradeBy[name];
      var grade = (card && card.grade) || '?';
      var tscores = offs.map(function (o) {
        return (window.OfferParser && OfferParser.transparency) ? OfferParser.transparency(o.parsed || {}).score : 0;
      });
      var tavg = tscores.reduce(function (a, b) { return a + b; }, 0) / (tscores.length || 1);
      var bestEff = Math.min.apply(null, offs.map(function (o) { return o.metrics.effectiveMonthly; }));
      var models = [];
      offs.forEach(function (o) {
        var nm = offerModelName(o);
        if (nm && models.indexOf(nm) < 0) models.push(nm);
      });
      // Compuesto (0–100 aprox.)
      var s = 0, d = geo.dist;
      if (d != null) s += d <= 10 ? 40 : d <= 16 ? 28 : d <= 25 ? 15 : d <= 40 ? 6 : 0;
      else s += 12; // distancia desconocida: neutral
      if (geo.toll && geo.toll !== false && geo.toll !== 'lejos') s -= 8;
      s += ({ A: 30, B: 22, C: 12, D: 2, '?': 10 })[grade] || 10;
      s += Math.round(tavg / 100 * 18);
      s += Math.min(offs.length, 5) * 2;
      return { name: name, offs: offs, geo: geo, grade: grade, card: card, tavg: tavg, bestEff: bestEff, models: models, score: s };
    });

    if (!rows.length) {
      box.innerHTML = '<p class="hint">Todavía no hay ofertas de concesionarios reales. El robot las irá encontrando en sus próximas búsquedas (3×/día); también puedes pegar una oferta en “Añadir una oferta”.</p>';
      return;
    }
    rows.sort(function (a, b) { return b.score - a.score; });

    var MEDAL = ['🥇', '🥈', '🥉'];
    box.innerHTML = '<ol class="topd">' + rows.map(function (r, i) {
      var tlevel = r.tavg >= 70 ? 'high' : r.tavg >= 45 ? 'mid' : 'low';
      var tlabel = tlevel === 'high' ? 'muy transparente' : tlevel === 'mid' ? 'transparencia media' : 'poco transparente';
      var reasons = (r.card && r.card.reasons && r.card.reasons.length) ? r.card.reasons.slice(0, 2).join(' · ') : '';

      // Enlaces: la MEJOR oferta del dealer conserva la URL exacta donde el
      // robot la encontró (su página de specials); el nombre → la portada.
      var bestOff = r.offs.reduce(function (a, b) { return b.metrics.effectiveMonthly < a.metrics.effectiveMonthly ? b : a; });
      var offerUrl = bestOff.url || (r.offs.filter(function (o) { return o.url; })[0] || {}).url || '';
      var homeUrl = '';
      try { if (offerUrl) homeUrl = new URL(offerUrl).origin; } catch (e) { /* noop */ }
      if (!offerUrl) offerUrl = 'https://www.google.com/search?q=' + encodeURIComponent(r.name + ' lease specials');
      var mapsUrl = 'https://www.google.com/maps/dir/?api=1&origin=' + encodeURIComponent('1 City Point, Brooklyn, NY 11201') +
        '&destination=' + encodeURIComponent(r.geo.addr ? r.name + ', ' + r.geo.addr : r.name);
      var nameHtml = homeUrl
        ? '<a class="topd-name" href="' + homeUrl + '" target="_blank" rel="noopener" title="Abrir la web del concesionario">' + escapeHtml(r.name) + ' ↗</a>'
        : '<span class="topd-name">' + escapeHtml(r.name) + '</span>';

      return '<li class="topd-row">' +
        '<div class="topd-rank">' + (MEDAL[i] || (i + 1)) + '</div>' +
        '<div class="topd-main">' +
          '<div class="topd-head">' + gradeChip(r.grade, (r.card && r.card.reasons.join(' · ')) || '') +
            ' ' + nameHtml + ' ' + dealerGeoChip(r.name) + '</div>' +
          '<div class="topd-sub">' +
            '<span class="transp-dot transp-' + tlevel + '" title="' + tlabel + ' (' + Math.round(r.tavg) + '% revelado)"></span>' +
            escapeHtml(String(r.offs.length)) + ' oferta' + (r.offs.length > 1 ? 's' : '') +
            ' · desde <b>' + fmtMoney2(r.bestEff) + '</b>/mes efectivo' +
            (r.geo.addr ? ' · ' + escapeHtml(r.geo.addr) : '') +
          '</div>' +
          (r.models.length ? '<div class="topd-models">' + r.models.slice(0, 4).map(escapeHtml).join(' · ') + '</div>' : '') +
          (reasons ? '<div class="topd-reasons">' + escapeHtml(reasons) + '</div>' : '') +
          '<div class="topd-actions">' +
            '<a class="btn mini primary" href="' + offerUrl + '" target="_blank" rel="noopener" title="La página de ofertas donde el robot encontró la más barata">🔗 Ver la oferta ↗</a>' +
            '<a class="btn mini" href="' + mapsUrl + '" target="_blank" rel="noopener">📍 Cómo llegar</a>' +
          '</div>' +
        '</div></li>';
    }).join('') + '</ol>';
  }

  // Precarga CONTROLADA del inventario para que el tablero se llene solo:
  // 1 intento por modelo cada 3 días (aunque recargues la página), así no se
  // quema la cuota de Auto.dev. Los modelos con stock cacheado se saltan.
  var PRELOAD_TTL = 3 * 864e5;

  function preloadAttempted(info) {
    try {
      var t = +localStorage.getItem('lf-preload-' + info.make + '-' + info.model) || 0;
      return (Date.now() - t) < PRELOAD_TTL;
    } catch (e) { return false; }
  }

  function boardPreload() {
    var make = state.boardMake || '';
    var pend = RankedModels.filter(function (info) {
      if (make && info.make !== make) return false;
      if (stockCacheGet(info, '', 'new')) return false; // ya hay stock cacheado
      if (preloadAttempted(info)) return false;          // intentado hace poco
      return true;
    });
    pend.forEach(function (info, i) {
      setTimeout(function () {
        try { localStorage.setItem('lf-preload-' + info.make + '-' + info.model, String(Date.now())); } catch (e) { /* lleno */ }
        fetchInventory(info, '', 'new')
          .then(function (d) { updateBoardRow(info, d); })
          .catch(function () { /* sin stock o sin clave: se queda con el placeholder */ });
      }, i * 450); // escalonado para no disparar 13 peticiones a la vez
    });
  }

  /** Actualiza en sitio la foto + Nuevos de una fila del tablero tras precargar. */
  function updateBoardRow(info, d) {
    var rep = (d.listings || []).filter(function (c) { return c && c.image; })[0];
    if (rep && !modelPhotoUrl(info)) cacheModelPhoto(info, rep.image);

    var tr = document.querySelector('#board-body tr.brow[data-key="' + info.make + '|' + info.model + '"]');
    if (!tr) return;

    var stockNew = (d.byCondition && d.byCondition.nuevo) || d.total || 0;
    var tdNuevos = tr.querySelector('td[data-l="Nuevos"]');
    if (tdNuevos) tdNuevos.textContent = stockNew || 0;

    // Si no había oferta de lease pero sí stock, etiqueta honesta.
    var sent = tr.querySelector('td[data-l="Valoración"] .sent.none');
    if (sent && stockNew > 0) sent.textContent = 'Sin lease aún';

    var purl = modelPhotoUrl(info);
    var img = tr.querySelector('.brow-img');
    if (img && purl) { img.style.display = ''; img.src = purl; }
  }

  function boardRow(r) {
    var info = r.info, a = r.assess, sm = SENT_META[a.level] || SENT_META.none;
    var tr = document.createElement('tr');
    tr.className = 'brow sent-' + sm.cls;

    // Foto
    var tdP = document.createElement('td');
    tdP.className = 'bt-photo';
    var im = document.createElement('img');
    im.className = 'brow-img';
    im.alt = info.make + ' ' + info.model;
    im.loading = 'lazy';
    im.addEventListener('error', function () { tdP.classList.add('noimg'); im.style.display = 'none'; });
    im.addEventListener('load', function () { tdP.classList.remove('noimg'); im.style.display = ''; });
    loadPhoto(info, im); // foto real del anuncio vía api/photo (sin Wikimedia)
    tdP.appendChild(im);
    if (!im.getAttribute('src')) { tdP.classList.add('noimg'); im.style.display = 'none'; } // sin foto → placeholder
    tr.appendChild(tdP);

    // Modelo
    var tdN = document.createElement('td');
    tdN.setAttribute('data-l', 'Modelo');
    tdN.innerHTML = '<span class="brow-chev">▸</span><span class="brow-name">' +
      '<span class="make">' + escapeHtml(info.make) + '</span> ' + escapeHtml(info.model) + '</span>' +
      (info.priority ? ' <span class="prio-chip">❤</span>' : '');
    tr.appendChild(tdN);

    tr.appendChild(cellTd('Mejor lease', isNum(r.best)
      ? '<strong>' + fmtMoney2(r.best) + '</strong><span class="u">/mes</span>' : '<span class="muted">—</span>'));

    var pctCls = isNum(r.pct) ? (r.pct <= 1 ? 'good' : r.pct <= 1.25 ? 'warn' : 'bad') : '';
    tr.appendChild(cellTd('Regla 1%', isNum(r.pct)
      ? '<span class="pct ' + pctCls + '">' + r.pct.toFixed(2) + '%</span>' : '<span class="muted">—</span>'));

    tr.appendChild(cellTd('Tendencia', sparkline(LeaseDB.seriesFor(info)) + ' ' + trendCell(r.trend)));
    tr.appendChild(cellTd('Ofertas', r.offers.length ? String(r.offers.length) : '<span class="muted">0</span>'));
    tr.appendChild(cellTd('Nuevos', isNum(r.stockNew) ? String(r.stockNew) : '<span class="muted">·</span>'));
    // Sin oferta de lease pero con stock real → etiqueta honesta (no "Sin datos").
    var sTxt = sm.txt;
    if (a.level === 'none' && isNum(r.stockNew) && r.stockNew > 0) sTxt = 'Sin lease aún';
    tr.appendChild(cellTd('Valoración', '<span class="sent ' + sm.cls + '">' + sTxt + '</span>'));

    var key = info.make + '|' + info.model;
    tr.dataset.key = key; // para refrescar la fila en sitio tras la precarga
    tr.addEventListener('click', function () { toggleBoardExpand(tr, r, key); });
    if (state.expanded[key]) tr.classList.add('open');
    return tr;
  }

  function cellTd(label, html) {
    var td = document.createElement('td');
    td.setAttribute('data-l', label);
    td.innerHTML = html;
    return td;
  }

  function toggleBoardExpand(tr, r, key) {
    if (state.expanded[key]) {
      delete state.expanded[key];
      tr.classList.remove('open');
      if (tr.nextSibling && tr.nextSibling.classList && tr.nextSibling.classList.contains('bexpand')) {
        tr.parentNode.removeChild(tr.nextSibling);
      }
    } else {
      state.expanded[key] = true;
      tr.classList.add('open');
      var ex = boardExpand(r);
      tr.parentNode.insertBefore(ex, tr.nextSibling);
    }
  }

  /** Ficha completa de una oferta descubierta (números, condiciones, letra pequeña, enlace). */
  /** Importe conocido → $X; desconocido → "Desconocido". */
  function fmtKnown(v) { return isNum(v) && v > 0 ? fmtMoney(v) : '<span class="unk">Desconocido</span>'; }

  /**
   * Explicación equilibrada de una oferta (qué la hace atractiva y qué
   * compromisos tiene) — generada a partir de los datos, no un veredicto seco.
   */
  function explainOffer(o, info, m, p, conds) {
    var model = (info.make + ' ' + info.model);
    var bits = [];
    var ds = m.dealScore;
    if (isNum(m.monthlyPayment)) {
      var q = ds == null ? 'Precio mensual' : (ds >= 85 ? 'Excelente precio mensual' : ds >= 70 ? 'Buen precio mensual' : ds >= 50 ? 'Precio mensual correcto' : 'Precio mensual algo alto');
      bits.push(q + ' para un ' + model + ' (' + fmtMoney2(m.monthlyPayment) + '/mes' + (m.term ? ' a ' + m.term + ' meses' : '') + ').');
    }
    if (isNum(m.oneTimeCosts) && m.oneTimeCosts > 0) {
      bits.push('Necesitas ~' + fmtMoney(m.oneTimeCosts) + ' al firmar (entrada, primer pago y comisiones)' +
        (isNum(m.effectiveMonthly) ? ', que repartidos dejan el coste real en ~' + fmtMoney2(m.effectiveMonthly) + '/mes.' : '.'));
    }
    if (p.milesPerYear && p.milesPerYear <= 7500) bits.push('Ojo: solo ' + p.milesPerYear.toLocaleString('es') + ' millas/año — ajustado si conduces poco, caro si te pasas.');
    if (conds && conds.length) bits.push('Requiere ' + conds.map(function (c) { return c.label.replace(/^Requires\s+/i, ''); }).join(' + ') + ', así que no todos podrán acceder.');
    return bits.join(' ');
  }

  /** Punto de color de transparencia para la lista de ofertas (escaneo rápido). */
  var TRANSP_TXT = { high: '🟢 Muy transparente', mid: '🟡 Transparencia media', low: '🔴 Poco transparente — puede ocultar coste de entrada' };
  function transpDot(parsed) {
    if (!window.OfferParser || !OfferParser.transparency) return '';
    var tr = OfferParser.transparency(parsed || {});
    return '<span class="transp-dot transp-' + tr.level + '" title="' + TRANSP_TXT[tr.level] + ' (' + tr.score + '% revelado). No cambia el Deal Score."></span>';
  }

  function offerDetailHtml(o, info, i) {
    var m = o.metrics || {};
    var p = o.parsed || {};
    var conds = (window.OfferParser && OfferParser.conditions) ? OfferParser.conditions(p.raw) : [];
    var title = o.name || (info.make + ' ' + info.model);
    var link = o.url ||
      ('https://www.google.com/search?q=' + encodeURIComponent('"' + title + '" ' + (o.source || '') + ' lease'));

    // --- Tarjeta resumen visual (5 s) ---
    var restr = conds.length ? conds.slice(0, 2).map(function (c) { return c.label.replace(/^Requires\s+/i, ''); }).join(' + ') + (conds.length > 2 ? '…' : '') : 'Ninguna';
    var summary = '<div class="odx-summary">' +
      '<div class="odx-s"><span>💵 Mensual</span><strong>' + (isNum(m.monthlyPayment) ? fmtMoney2(m.monthlyPayment) + '<small>/mes</small>' : '—') + '</strong></div>' +
      '<div class="odx-s"><span>💳 Al firmar</span><strong>' + (isNum(m.oneTimeCosts) ? '~' + fmtMoney(m.oneTimeCosts) : '—') + '</strong></div>' +
      '<div class="odx-s"><span>🚗 Millas</span><strong>' + (p.milesPerYear ? p.milesPerYear.toLocaleString('es') + '<small>/año</small>' : '—') + '</strong></div>' +
      '<div class="odx-s"><span>⚠ Restricciones</span><strong class="' + (conds.length ? 'warn' : '') + '">' + escapeHtml(restr) + '</strong></div>' +
      '<div class="odx-s"><span>📊 Deal Score</span><strong>' + (isNum(m.dealScore) ? m.dealScore + '<small>/100</small>' : '—') + '</strong></div>' +
      '</div>';

    // --- Transparencia de la oferta (NO afecta al Deal Score) ---
    var transpHtml = '';
    if (window.OfferParser && OfferParser.transparency) {
      var tr = OfferParser.transparency(p);
      var TMETA = {
        high: { dot: '🟢', txt: 'Muy transparente', desc: 'Desglosa los pagos iniciales, el due at signing, el residual y las millas.' },
        mid: { dot: '🟡', txt: 'Transparencia media', desc: 'Se entiende el coste, pero hay que leer la letra pequeña para verlo todo.' },
        low: { dot: '🔴', txt: 'Poco transparente', desc: 'Anuncia el mensual pero oculta parte del coste real de entrada.' }
      };
      var tm = TMETA[tr.level] || TMETA.mid;
      var missHtml = tr.missing.length
        ? '<div class="odx-transp-miss">No aclara: ' + tr.missing.map(function (x) { return escapeHtml(x); }).join(' · ') + '</div>'
        : '';
      transpHtml = '<div class="odx-transp odx-transp-' + tr.level + '" ' +
        'title="Mide qué revela el anuncio sobre el coste real. No cambia el Deal Score.">' +
        '<span class="odx-transp-dot">' + tm.dot + '</span>' +
        '<div class="odx-transp-body"><div class="odx-transp-h">' + tm.txt +
        ' <span class="odx-transp-score">' + tr.score + '% revelado</span></div>' +
        '<div class="odx-transp-desc">' + tm.desc + '</div>' + missHtml + '</div></div>';
    }

    // --- 💵 Mensual (protagonista) ---
    var hero = '<div class="odx-hero"><div class="odx-monthly">' +
      (isNum(m.monthlyPayment) ? '<span class="big">' + fmtMoney2(m.monthlyPayment) + '</span><span class="u">/mes</span>' : '—') +
      '</div><div class="odx-term">' + (m.term ? m.term + ' meses' : 'plazo n/d') + '</div></div>';

    // --- 💳 Due at signing (desglose) ---
    var sd = p.securityDeposit;
    var due = '<div class="odx-sec"><div class="odx-h">💳 Al firmar' +
      (isNum(m.oneTimeCosts) ? ' · <strong>' + fmtMoney(m.oneTimeCosts) + '</strong>' : '') + '</div><ul class="odx-list">' +
      '<li>Entrada (down): <b>' + fmtKnown(p.downPayment) + '</b></li>' +
      '<li>Primer pago: <b>' + (isNum(m.monthlyPayment) ? fmtMoney(m.monthlyPayment) : '<span class="unk">Desconocido</span>') + '</b></li>' +
      '<li>Comisión de adquisición: <b>' + fmtKnown(p.acqFee) + '</b></li>' +
      '<li>Comisión del concesionario: <b>' + fmtKnown(p.dealerFee) + '</b></li>' +
      (p.docFee ? '<li>Documentación: <b>' + fmtKnown(p.docFee) + '</b></li>' : '') +
      '<li>Depósito de seguridad: <b>' + (sd === 0 ? 'Ninguno' : fmtKnown(sd)) + '</b></li>' +
      (p.accessories ? '<li>Accesorios obligatorios: <b>' + fmtKnown(p.accessories) + '</b></li>' : '') +
      '</ul></div>';

    // --- 🚗 Detalles del lease ---
    var resid = p.residualAmount ? fmtMoney(p.residualAmount) : (p.residualPct ? p.residualPct + '%' : null);
    var details = '<div class="odx-sec"><div class="odx-h">🚗 Detalles</div><ul class="odx-list">' +
      '<li>Millas: <b>' + (p.milesPerYear ? p.milesPerYear.toLocaleString('es') + '/año' : '<span class="unk">Desconocido</span>') + '</b></li>' +
      (resid ? '<li>Residual: <b>' + resid + '</b></li>' : '') +
      '<li>MSRP: <b>' + fmtKnown(p.msrp) + '</b></li>' +
      '</ul></div>';

    // --- ⚠ Condiciones (siempre visibles) ---
    var condHtml = '<div class="odx-sec"><div class="odx-h">⚠ Condiciones</div>' +
      (conds.length
        ? '<div class="odx-conds">' + conds.map(function (c) { return '<span class="odx-cond">' + escapeHtml(c.label) + '</span>'; }).join('') + '</div>'
        : '<div class="odx-conds-none">Sin restricciones detectadas en el anuncio</div>') +
      '</div>';

    // --- Efectivo (secundario, con tooltip) ---
    var eff = isNum(m.effectiveMonthly)
      ? '<div class="odx-eff" title="Incluye los costes únicos repartidos a lo largo del lease. No incluye impuestos, DMV ni exceso de millas.">' +
        'Efectivo/mes ≈ <strong>' + fmtMoney2(m.effectiveMonthly) + '</strong>' +
        (isNum(m.pctOfMsrp) ? ' · ' + m.pctOfMsrp.toFixed(2) + '% del MSRP' : '') + ' <span class="odx-i">ⓘ</span></div>'
      : '';

    var explain = explainOffer(o, info, m, p, conds);
    var explainHtml = explain ? '<div class="odx-explain">' + escapeHtml(explain) + '</div>' : '';

    var vin = (o.vin || p.vin)
      ? '<div class="sc-vin" style="margin-top:6px"><span class="sc-vin-label">VIN</span>' +
        '<code class="sc-vin-code">' + escapeHtml(o.vin || p.vin) + '</code>' +
        '<button type="button" class="sc-copy" onclick="lfCopy(this)" data-copy="' + escapeHtml(o.vin || p.vin) +
        '" title="Copiar el VIN para la aseguradora">📋 Copiar</button></div>'
      : '';

    var seen = '<div class="offer-meta">' + escapeHtml(o.source || '') + (o.region ? ' · ' + escapeHtml(o.region) : '') +
      (o.firstSeen ? ' · vista el ' + new Date(o.firstSeen).toLocaleDateString('es') : '') + '</div>' +
      (dealerGeoChip(o) ? '<div class="odx-geo">' + dealerGeoChip(o) + '</div>' : '');

    var raw = p.raw
      ? '<details class="bxd-rawbox"><summary>Ver el anuncio original (letra pequeña)</summary><div class="bxd-raw">' + escapeHtml(p.raw) + '</div></details>'
      : '';

    return '<div class="bxd odx">' +
      '<div class="bxd-title">' + escapeHtml(title) + '</div>' + seen +
      summary + transpHtml + hero +
      '<div class="odx-cols">' + due + details + '</div>' +
      condHtml + eff + explainHtml + vin + raw +
      '<div class="card-actions">' +
        '<a class="btn mini primary" href="' + link + '" target="_blank" rel="noopener">' + (o.url ? 'Abrir la fuente ↗' : 'Buscar esta oferta ↗') + '</a>' +
        '<button type="button" class="btn mini bx-coste" data-i="' + i + '">💸 ¿Cuánto al mes?</button>' +
      '</div></div>';
  }

  function boardExpand(r) {
    var info = r.info, a = r.assess;
    var tr = document.createElement('tr');
    tr.className = 'bexpand';
    var td = document.createElement('td');
    td.colSpan = 8;
    tr.appendChild(td);

    var box = document.createElement('div');
    box.className = 'bexpand-inner';
    td.appendChild(box);

    // Valoración + serie
    var head = document.createElement('div');
    head.className = 'bx-head';
    head.innerHTML = '<div class="bx-verdict"><span class="sent ' + (SENT_META[a.level] || SENT_META.none).cls + '">' +
      (SENT_META[a.level] || SENT_META.none).txt + '</span> ' + escapeHtml(a.reason || '') + '</div>' +
      '<div class="bx-spark">' + sparkline(LeaseDB.seriesFor(info), 160, 40) + '</div>';
    box.appendChild(head);

    // Ofertas descubiertas (solo concesionarios/brokers; agregadores ocultos).
    if (r.offers.length) {
      var sorted = r.offers;
      var t = '<div class="bx-sub">Ofertas descubiertas (' + r.offers.length + ')</div>' +
        '<div class="table-wrap"><table class="offers-table bx-offers"><thead><tr>' +
        '<th>Fuente</th><th>Efectivo/mes</th><th>Mensual</th><th>Plazo</th><th>Vista</th><th></th></tr></thead><tbody>';
      sorted.slice(0, 12).forEach(function (o, i) {
        var m = o.metrics || {};
        var flags = DealerScore.offerFlags(o.parsed && o.parsed.raw);
        var flagHtml = flags.length
          ? ' <span class="dflag" title="' + escapeHtml(flags.map(function (f) { return f.label; }).join(' · ')) + '">⚠</span>'
          : '';
        var tdot = transpDot(o.parsed);
        var oemTag = isOemOffer(o)
          ? ' <span class="oem-tag" title="Oferta oficial del fabricante: es la referencia publicada por la marca, no un concesionario donde firmes. Llévala a tu dealer.">🏷️ fabricante</span>'
          : '';
        t += '<tr class="bx-row" data-i="' + i + '" title="Toca para ver la oferta en detalle">' +
          '<td>' + tdot + '<span class="brow-chev">▸</span>' + dealerGradeFor(o.source) + ' ' + escapeHtml(o.source || o.name || '—') + flagHtml + oemTag + ' ' + dealerGeoChip(o) +
          (o.region ? '<span class="offer-meta">' + escapeHtml(o.region) + '</span>' : '') + '</td>' +
          '<td>' + fmtMoney2(m.effectiveMonthly) + '</td>' +
          '<td>' + fmtMoney2(m.monthlyPayment) + '</td>' +
          '<td>' + (m.term || '—') + 'm</td>' +
          '<td>' + (o.firstSeen ? new Date(o.firstSeen).toLocaleDateString('es') : '—') + '</td>' +
          '<td><button type="button" class="btn mini bx-save" data-i="' + i + '">💾</button></td></tr>' +
          '<tr class="bx-detail" hidden><td colspan="6">' + offerDetailHtml(o, r.info, i) + '</td></tr>';
      });
      t += '</tbody></table></div>';
      var offBox = document.createElement('div');
      offBox.innerHTML = t;
      offBox.querySelectorAll('.bx-save').forEach(function (b) {
        b.addEventListener('click', function (ev) {
          ev.stopPropagation();
          saveScanned(sorted[+b.dataset.i].parsed || {});
          b.textContent = '✅'; b.disabled = true;
        });
      });
      // Toca una oferta → se despliega su ficha completa (letra pequeña incluida).
      offBox.querySelectorAll('.bx-row').forEach(function (row) {
        row.addEventListener('click', function (ev) {
          ev.stopPropagation();
          if (ev.target.closest && ev.target.closest('a,button')) return;
          var det = row.nextElementSibling;
          var open = det && !det.hidden;
          if (det) det.hidden = open;
          row.classList.toggle('open', !open);
        });
      });
      offBox.querySelectorAll('.bx-coste').forEach(function (b) {
        b.addEventListener('click', function (ev) {
          ev.stopPropagation();
          var o = sorted[+b.dataset.i];
          var m = o.metrics || {};
          fillCosteModels();
          if (isNum(m.monthlyPayment)) $('c-lease').value = Math.round(m.monthlyPayment);
          if (m.driveOff != null) $('c-down').value = Math.round(m.driveOff);
          if (m.term) $('c-term').value = m.term;
          $('c-tag').textContent = (o.name || r.info.make + ' ' + r.info.model).slice(0, 40);
          renderCoste();
          showView('coste');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      });
      box.appendChild(offBox);
    } else {
      var no = document.createElement('div');
      no.className = 'hint';
      no.textContent = 'Sin ofertas de lease descubiertas todavía para este modelo.';
      box.appendChild(no);
    }

    // Stock de nuevos (reutiliza la caja con selector de trim)
    var stock = document.createElement('div');
    stock.className = 'stock-box';
    renderStockBox(info, stock);
    box.appendChild(stock);

    // Acciones
    var acts = document.createElement('div');
    acts.className = 'card-actions';
    var dec = document.createElement('button');
    dec.className = 'btn mini primary';
    dec.textContent = '⚖️ ¿Qué me conviene?';
    dec.addEventListener('click', function (ev) {
      ev.stopPropagation();
      prefillDecide(info);
      showView('decide');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    acts.appendChild(dec);
    var cst = document.createElement('button');
    cst.className = 'btn mini';
    cst.textContent = '💸 ¿Cuánto al mes?';
    cst.addEventListener('click', function (ev) {
      ev.stopPropagation();
      prefillCoste(info);
      showView('coste');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    acts.appendChild(cst);
    [['Nuevos ↗', info.linkNew], ['CPO ↗', info.linkCpo]].forEach(function (pair) {
      var link = document.createElement('a');
      link.className = 'btn mini subtle';
      link.textContent = pair[0]; link.href = pair[1]; link.target = '_blank'; link.rel = 'noopener';
      link.addEventListener('click', function (ev) { ev.stopPropagation(); });
      acts.appendChild(link);
    });
    box.appendChild(acts);

    box.addEventListener('click', function (ev) {
      // no cerrar al interactuar dentro del panel
      if (ev.target.closest && ev.target.closest('a,button,select,summary,details')) ev.stopPropagation();
    });
    return tr;
  }

  /* ---------------- CPO / segunda mano (pestaña) ---------------- */

  /** Modelos a mostrar en la pestaña de segunda mano: tu lista seguida, priorizada. */
  function usadosModels() {
    function rankIndex(w) {
      var info = findRanked(w.make, w.model);
      if (info && info.priority) return info.priority;
      var i = RankedModels.findIndex(function (m) { return m.make === w.make && m.model === w.model; });
      return i < 0 ? 999 : 100 + i;
    }
    return state.watchlist.slice()
      .sort(function (a, b) { return rankIndex(a) - rankIndex(b); })
      .map(function (w) { return findRanked(w.make, w.model); })
      .filter(Boolean);
  }

  function renderUsados() {
    var grid = $('usados-grid');
    if (!grid) return;
    grid.innerHTML = '';
    usadosModels().forEach(function (info) {
      var card = document.createElement('div');
      card.className = 'watch-item';

      var photo = document.createElement('div');
      photo.className = 'model-photo';
      var ph = document.createElement('span');
      ph.className = 'photo-fallback';
      ph.textContent = info.make + ' ' + info.model;
      photo.appendChild(ph);
      var img = document.createElement('img');
      img.alt = info.make + ' ' + info.model;
      img.addEventListener('load', function () { photo.classList.add('has-img'); });
      photo.appendChild(img);
      loadPhoto(info, img);
      card.appendChild(photo);

      var body = document.createElement('div');
      body.className = 'watch-body';
      card.appendChild(body);

      var head = document.createElement('div');
      head.className = 'watch-head';
      head.innerHTML = '<div class="watch-title"><span class="make">' + escapeHtml(info.make) + '</span> ' +
        escapeHtml(info.model) + '</div>';
      body.appendChild(head);

      var content = document.createElement('div');
      content.className = 'secondhand-body';
      body.appendChild(content);

      var c = stockCacheGet(info, '', 'used');
      if (c) {
        renderSecondhand(c.data, content, info);
        var age = document.createElement('small');
        age.className = 'hint';
        age.textContent = 'Actualizado ' + fmtAge(c.t);
        body.appendChild(age);
      } else {
        var btn = document.createElement('button');
        btn.className = 'btn mini';
        btn.textContent = '♻️ Ver CPO / usados';
        btn.addEventListener('click', function () {
          content.innerHTML = '<small class="hint">Buscando segunda mano…</small>';
          fetchInventory(info, '', 'used')
            .then(function (d) { renderSecondhand(d, content, info); })
            .catch(function () { content.innerHTML = '<small class="hint">No se pudo consultar ahora.</small>'; });
        });
        content.appendChild(btn);
      }
      grid.appendChild(card);
    });
  }

  /** Actualiza el stock de segunda mano de todos los modelos seguidos (en serie). */
  function usadosLoadAll() {
    var btn = $('usados-load');
    var infos = usadosModels();
    var pending = infos.filter(function (m) {
      var c = stockCacheGet(m, '', 'used');
      return !c || (Date.now() - c.t) > STOCK_FRESH_MS;
    });
    if (!pending.length) { renderUsados(); return; }
    btn.disabled = true;
    var done = 0;
    function next() {
      if (done >= pending.length) {
        btn.disabled = false;
        btn.textContent = '📦 Actualizar todo';
        renderUsados();
        return;
      }
      var m = pending[done];
      btn.textContent = '📦 ' + (done + 1) + '/' + pending.length + ' — ' + m.model + '…';
      fetchInventory(m, '', 'used')
        .catch(function () { /* seguir */ })
        .then(function () { done++; next(); });
    }
    next();
  }

  /* ---------------- ofertas online ---------------- */

  var lastLoadAt = 0;
  function loadOnline(opts) {
    opts = opts || {};
    lastLoadAt = Date.now();
    var meta = $('board-meta');
    if (meta) meta.innerHTML = '<span class="spin"></span> Buscando ofertas en concesionarios y brokers…';
    loadingStart();
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
      var offers = onlineData.latest.offers || [];
      // Acumula en la base de datos local (crece con cada carga).
      try { LeaseDB.ingest(offers, onlineData.history, RankedModels); } catch (e) { /* noop */ }
      renderSources(onlineData.status);
      renderBoard();
      loadingDone();

      // --- Avisos de actualización ---
      var withOffers = 0;
      try { withOffers = LeaseDB.modelsWithOffers(RankedModels); } catch (e) { /* noop */ }
      var total = RankedModels.length;
      var news = { firstRun: false, fresh: [] };
      try { news = LeaseDB.markNewSeen(offers); } catch (e) { /* noop */ }
      if (news.firstRun) {
        toast('✅ Base de datos cargada · <b>' + offers.length + '</b> ofertas en <b>' + withOffers + '/' + total + '</b> modelos', 'success');
      } else if (news.fresh.length) {
        toast('🔔 <b>' + news.fresh.length + '</b> oferta' + (news.fresh.length > 1 ? 's' : '') + ' nueva' + (news.fresh.length > 1 ? 's' : '') + ' desde tu última visita', 'success', 6500);
      } else if (!opts.silent) {
        toast('✔ Actualizado · ' + offers.length + ' ofertas · ' + withOffers + '/' + total + ' modelos con leases', 'info');
      }
    }).catch(function () {
      try { LeaseDB.ingest([], onlineData.history, RankedModels); } catch (e) { /* noop */ }
      renderBoard();
      loadingDone();
      if (meta) meta.textContent = 'No se pudo cargar la base de datos (¿sin conexión?). Pulsa ↻ para reintentar, o “▶ Buscar ahora” para lanzar el robot.';
      if (!opts.silent) toast('⚠️ No se pudieron cargar las ofertas. Pulsa ↻ para reintentar.', 'error', 6000);
    });
  }

  /** Lista el estado de las fuentes del robot (desplegable del tablero). */
  function renderSources(status) {
    if (!status || !status.sources || !status.sources.length) return;
    var ul = $('online-status');
    ul.innerHTML = '';
    status.sources.forEach(function (s) {
      var li = document.createElement('li');
      li.textContent = s.name + (s.region ? ' (' + s.region + ')' : '') + ': ' + s.status;
      ul.appendChild(li);
    });
    $('online-status-box').hidden = false;
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
    var cNew = stockCacheGet(info, '', 'new');
    if (cNew && cNew.data && cNew.data.cheapestNew) $('decide-new').value = cNew.data.cheapestNew.price;
    var cUsed = stockCacheGet(info, '', 'used');
    if (cUsed && cUsed.data && cUsed.data.cheapestCpo) $('decide-cpo').value = cUsed.data.cheapestCpo.price;
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
        ($('board-meta')||{}).innerHTML = '<span class="spin"></span> ' + escapeHtml(r.data.message || 'Robot lanzado.') + ' La página se actualizará sola.';
        loadingStart();
        toast('🔎 Robot lanzado. Rastreando concesionarios… (~3-4 min). Te aviso al terminar.', 'info', 6000);
        pollForUpdate();
      } else if (r.status === 429 && r.data) {
        resetScanBtn();
        toast('⏳ ' + escapeHtml(r.data.message || 'Espera un poco antes de volver a buscar.'), 'warn', 6000);
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
    loadingDone();
    ($('board-meta')||{}).innerHTML =
      '⚠️ El lanzamiento directo no está disponible' +
      (reason ? ' (' + escapeHtml(reason) + ')' : '') + '. Plan B: ' +
      '<a href="' + SCAN_WORKFLOW_URL + '" target="_blank" rel="noopener">abre GitHub aquí</a>, ' +
      'presiona “Run workflow”, espera ~3 minutos y dale a ↻.';
    toast('⚠️ No pude lanzar el robot directamente. Mira el aviso del Tablero para el plan B.', 'warn', 7000);
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
            loadingDone();
            toast('✅ ¡Búsqueda terminada! Cargando los resultados nuevos…', 'success');
            loadOnline();
          } else if (tries >= 20) { // ~10 minutos
            clearInterval(timer);
            resetScanBtn();
            loadingDone();
            ($('board-meta')||{}).textContent = 'La búsqueda tarda más de lo normal; presiona ↻ en un rato.';
            toast('La búsqueda tarda más de lo normal. Pulsa ↻ en un rato.', 'warn', 6000);
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
    calcImportOffer = null; // limpiar también la oferta importada
    if ($('quotedMonthly')) $('quotedMonthly').value = '';
    if ($('calc-url')) $('calc-url').value = '';
    var cv = $('calc-verdict');
    if (cv) { cv.hidden = true; cv.innerHTML = ''; }
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

    // Coste al mes: recalcula al escribir en cualquier campo de la vista.
    ['c-lease', 'c-tax', 'c-down', 'c-term', 'c-ins', 'c-insurer', 'c-maint', 'c-miles', 'c-mpg', 'c-gas',
     'c-park', 'c-toll', 'c-cong', 'c-reg', 'c-budget'].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('input', renderCoste);
    });

    // Perfiles de coche (guardar/cargar/borrar escenarios completos).
    if ($('c-profile')) {
      $('c-profile').addEventListener('change', selectCosteProfile);
      $('c-profile-save').addEventListener('click', saveCosteProfile);
      $('c-profile-del').addEventListener('click', deleteCosteProfile);
      var pdb = loadProfiles();
      refreshProfileSelect(pdb.activeId);
      var act = pdb.list.filter(function (p) { return p.id === pdb.activeId; })[0];
      if (act) { $('c-profile-name').value = act.name; costeApply(act.fields); }
    }
    var sharedOffer = loadFromHash();
    var savedTab = null;
    try { savedTab = localStorage.getItem(TAB_KEY); } catch (e) { /* default */ }
    showView(sharedOffer ? 'calc' : (savedTab || 'models'));

    $('lease-form').addEventListener('input', recalc);
    $('lease-form').addEventListener('change', recalc);
    $('lease-form').addEventListener('submit', saveOffer);
    $('clear-btn').addEventListener('click', clearForm);
    if ($('view-saved-btn')) $('view-saved-btn').addEventListener('click', goToSaved);
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
      populateTrims();
      recalc();
    });
    $('model').addEventListener('change', populateTrims);

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

    // Tablero: watchlist = todos los modelos del ranking (para el tablero y CPO).
    state.watchlist = RankedModels.map(function (m) { return { make: m.make, model: m.model }; });

    // Filtro de marca del tablero
    var boardMake = $('board-make');
    RankedModels.map(function (m) { return m.make; })
      .filter(function (mk, i, arr) { return arr.indexOf(mk) === i; })
      .forEach(function (mk) {
        var o = document.createElement('option');
        o.value = mk; o.textContent = mk;
        boardMake.appendChild(o);
      });
    boardMake.addEventListener('change', function () {
      state.boardMake = boardMake.value;
      renderBoard();
    });

    // Orden por cabecera del tablero (dirección por defecto sensata por columna)
    var DEFAULT_DESC = { name: false, best: false, pct: false, trend: false, offers: true, stock: true, sent: true };
    document.querySelectorAll('#board-table th.sortable').forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.dataset.sort;
        if (state.boardSort.key === key) state.boardSort.desc = !state.boardSort.desc;
        else state.boardSort = { key: key, desc: !!DEFAULT_DESC[key] };
        renderBoard();
      });
    });

    renderBoard();

    $('board-refresh').addEventListener('click', function () { loadOnline(); });
    if ($('oem-load')) $('oem-load').addEventListener('click', loadIncentives);
    $('usados-load').addEventListener('click', usadosLoadAll);

    // Al volver a la pestaña tras un rato, recarga en silencio (se siente vivo).
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && Date.now() - lastLoadAt > 120000) {
        loadOnline({ silent: true });
      }
    });

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

    $('scan-now-btn').addEventListener('click', scanNow);
    loadOnline();

    $('scan-btn').addEventListener('click', runScan);
    $('scan-save-all').addEventListener('click', function () {
      state.scanResults.forEach(saveScanned);
      state.scanResults = [];
      renderScanResults();
      $('offers-table').scrollIntoView({ behavior: 'smooth' });
    });

    // Importar ofertas desde archivo (PDF / HTML / captura / texto).
    if ($('import-pick')) {
      var fileInput = $('import-file-offer');
      $('import-pick').addEventListener('click', function () { fileInput.click(); });
      fileInput.addEventListener('change', function () { importOfferFiles(fileInput.files); fileInput.value = ''; });
      var zone = $('import-zone');
      ['dragenter', 'dragover'].forEach(function (ev) {
        zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('drag'); });
      });
      ['dragleave', 'drop'].forEach(function (ev) {
        zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove('drag'); });
      });
      zone.addEventListener('drop', function (e) {
        if (e.dataTransfer && e.dataTransfer.files) importOfferFiles(e.dataTransfer.files);
      });
    }

    // 📸 Importador de la Calculadora (foto/PDF de la hoja del dealer).
    if ($('calc-import-pick')) {
      var kFile = $('calc-import-file');
      $('calc-import-pick').addEventListener('click', function () { kFile.click(); });
      kFile.addEventListener('change', function () { importCalcFiles(kFile.files); kFile.value = ''; });
      var kZone = $('calc-import-zone');
      ['dragenter', 'dragover'].forEach(function (ev) {
        kZone.addEventListener(ev, function (e) { e.preventDefault(); kZone.classList.add('drag'); });
      });
      ['dragleave', 'drop'].forEach(function (ev) {
        kZone.addEventListener(ev, function (e) { e.preventDefault(); kZone.classList.remove('drag'); });
      });
      kZone.addEventListener('drop', function (e) {
        if (e.dataTransfer && e.dataTransfer.files) importCalcFiles(e.dataTransfer.files);
      });
    }
    if ($('quotedMonthly')) $('quotedMonthly').addEventListener('input', updateImpliedMF);
    if ($('calc-url-btn')) {
      $('calc-url-btn').addEventListener('click', importCalcUrl);
      $('calc-url').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); importCalcUrl(); } });
    }

    // Importador del "Coste al mes": rellena y valora la oferta subida.
    if ($('c-import-pick')) {
      var cFile = $('c-import-file');
      $('c-import-pick').addEventListener('click', function () { cFile.click(); });
      cFile.addEventListener('change', function () { importCosteFiles(cFile.files); cFile.value = ''; });
      var cZone = $('c-import-zone');
      ['dragenter', 'dragover'].forEach(function (ev) {
        cZone.addEventListener(ev, function (e) { e.preventDefault(); cZone.classList.add('drag'); });
      });
      ['dragleave', 'drop'].forEach(function (ev) {
        cZone.addEventListener(ev, function (e) { e.preventDefault(); cZone.classList.remove('drag'); });
      });
      cZone.addEventListener('drop', function (e) {
        if (e.dataTransfer && e.dataTransfer.files) importCosteFiles(e.dataTransfer.files);
      });
    }

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
