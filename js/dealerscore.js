/**
 * Nota del concesionario ("dealer report card"): puntúa la FIABILIDAD de
 * cada concesionario a partir de sus propias ofertas descubiertas — no solo
 * qué coche es más barato, sino quién juega limpio.
 *
 * Señales (todas salen de datos que ya tenemos, nada inventado):
 *  - Transparencia: ¿declaran la entrada (due at signing) en sus ofertas?
 *  - Mensualidad gancho: diferencia entre lo anunciado y el coste efectivo
 *    real (mensualidad baja + entrada gorda = anzuelo).
 *  - Condiciones escondidas: descuentos que exigen financiar con ellos,
 *    trade-in, loyalty/conquest, militar/estudiante…
 *  - Surtido: cuántas ofertas de tus modelos objetivo publican.
 *
 * Nota A–D (o "?" con pocos datos). Los agregadores (CarsDirect…) no se
 * puntúan: no son concesionarios.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DealerScore = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  // Condiciones que limitan el descuento anunciado (letra pequeña).
  var FLAG_DEFS = [
    { key: 'financing', label: 'exige financiar con ellos', re: /must\s+finance|financing\s+required|when\s+financed|requires?\s+financing|finance\s+through/i },
    { key: 'tradein', label: 'exige/premia trade-in', re: /trade-?in\s+(required|assist|bonus|credit)|requires?\s+trade|must\s+trade/i },
    { key: 'loyalty', label: 'solo loyalty/conquest', re: /\bloyalty\b|\bconquest\b/i },
    { key: 'group', label: 'solo militar/estudiante/etc.', re: /\bmilitary\b|college\s+grad|recent\s+grad|first\s+responder/i },
    { key: 'deposit', label: 'pide security deposit', re: /security\s+deposit/i }
  ];

  /** Condiciones detectadas en la letra pequeña de UNA oferta. */
  function offerFlags(raw) {
    var t = String(raw || '');
    var out = [];
    FLAG_DEFS.forEach(function (f) { if (f.re.test(t)) out.push({ key: f.key, label: f.label }); });
    return out;
  }

  function isAggregator(entry) {
    return /agregador|por modelo/i.test(entry.region || '') || /carsdirect|edmunds|truecar/i.test(entry.source || '');
  }

  function gradeOf(score, n) {
    if (n < 2) return '?';
    if (score >= 8.5) return 'A';
    if (score >= 7) return 'B';
    if (score >= 5.5) return 'C';
    return 'D';
  }

  /**
   * Analiza la lista de ofertas (formato de data/offers-latest.json) y
   * devuelve una ficha por concesionario, ordenadas de mejor a peor nota.
   */
  function analyze(offers) {
    var by = {};
    (offers || []).forEach(function (e) {
      if (!e || !e.source || isAggregator(e)) return;
      var m = e.metrics || {};
      if (!isNum(m.monthlyPayment) || m.monthlyPayment <= 0) return;
      var d = by[e.source] || (by[e.source] = {
        name: e.source, region: e.region || '', offers: 0, targets: 0,
        dasKnown: 0, zeroDown: 0, ratios: [], flagged: 0, flagCounts: {}, tenures: []
      });
      d.offers++;
      if (e.isTarget) d.targets++;

      // Transparencia de la entrada: ¿declaran el due-at-signing?
      if (m.driveOff != null) {
        d.dasKnown++;
        if (m.driveOff === 0) d.zeroDown++;
      }

      // Mensualidad gancho: efectivo real / mensualidad anunciada.
      if (isNum(m.effectiveMonthly) && m.effectiveMonthly > 0) {
        d.ratios.push(m.effectiveMonthly / m.monthlyPayment);
      }

      // Letra pequeña con condiciones.
      var fl = offerFlags(e.parsed && e.parsed.raw);
      if (fl.length) {
        d.flagged++;
        fl.forEach(function (f) { d.flagCounts[f.key] = (d.flagCounts[f.key] || 0) + 1; });
      }

      // Antigüedad de la oferta (estabilidad de precios).
      if (e.firstSeen && e.lastSeen) {
        var days = (new Date(e.lastSeen) - new Date(e.firstSeen)) / 864e5;
        if (isFinite(days) && days >= 0) d.tenures.push(days);
      }
    });

    var out = Object.keys(by).map(function (k) {
      var d = by[k];
      var dasPct = d.offers ? d.dasKnown / d.offers : 0;
      var avgRatio = d.ratios.length ? d.ratios.reduce(function (a, b) { return a + b; }, 0) / d.ratios.length : null;
      var condShare = d.offers ? d.flagged / d.offers : 0;
      var avgTenure = d.tenures.length ? d.tenures.reduce(function (a, b) { return a + b; }, 0) / d.tenures.length : null;

      var score = 7;
      var reasons = [];
      if (dasPct >= 0.8) { score += 1.5; reasons.push('✓ declara la entrada en sus ofertas'); }
      else if (dasPct < 0.4) { score -= 1.5; reasons.push('✗ casi nunca dice cuánto es la entrada'); }
      if (avgRatio != null) {
        if (avgRatio <= 1.2) { score += 1.5; reasons.push('✓ la mensualidad anunciada se acerca al coste real'); }
        else if (avgRatio > 1.45) { score -= 3; reasons.push('✗ mensualidad gancho: el coste real es ' + Math.round((avgRatio - 1) * 100) + '% mayor por la entrada'); }
      }
      if (condShare === 0 && d.offers >= 2) { score += 1; reasons.push('✓ sin condiciones escondidas detectadas'); }
      else if (condShare > 0.5) { score -= 2.5; reasons.push('✗ la mayoría de descuentos exigen condiciones (financiación, trade-in…)'); }
      else if (condShare > 0.15) { score -= 0.5; reasons.push('△ algunos descuentos con condiciones'); }
      if (d.targets >= 3) { score += 0.5; reasons.push('✓ buen surtido de tus modelos'); }
      score = Math.max(0, Math.min(10, score));

      return {
        name: d.name, region: d.region, offers: d.offers, targets: d.targets,
        dasPct: dasPct, zeroDown: d.zeroDown, avgRatio: avgRatio,
        condShare: condShare, flagCounts: d.flagCounts, avgTenure: avgTenure,
        score: Math.round(score * 10) / 10,
        grade: gradeOf(score, d.offers),
        reasons: reasons
      };
    });

    out.sort(function (a, b) {
      if (a.grade === '?' && b.grade !== '?') return 1;
      if (b.grade === '?' && a.grade !== '?') return -1;
      return b.score - a.score;
    });
    return out;
  }

  return { analyze: analyze, offerFlags: offerFlags };
}));
