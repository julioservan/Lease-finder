/**
 * Lógica de cálculo de leases, inspirada en la calculadora de Leasehackr
 * (https://leasehackr.com/calculator).
 *
 * Modelo de lease cerrado (closed-end):
 *   - Costo capitalizado bruto  = precio negociado + tarifas capitalizadas
 *   - Reducción de cap. cost    = enganche + incentivos
 *   - Costo capitalizado ajust. = bruto - reducción
 *   - Valor residual            = MSRP × residual%
 *   - Depreciación mensual      = (cap ajustado - residual) / plazo
 *   - Cargo financiero mensual  = (cap ajustado + residual) × money factor
 *   - Money factor              = TAE% / 2400
 *
 * Métricas de comparación:
 *   - Costo efectivo mensual = costo total del lease / plazo
 *   - Regla del 1%           = efectivo mensual / MSRP (≤ 1% es buena señal)
 *   - Score (estilo LH)      = MSRP / (efectivo mensual × 12)
 *                              "cuántos años de lease equivalen al MSRP";
 *                              más alto = mejor (≥ 8 suele ser excelente).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LeaseCalc = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function num(v) {
    var n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v);
    return isFinite(n) ? n : 0;
  }

  /**
   * @param {object} input
   * @param {number} input.msrp           Precio de lista (MSRP)
   * @param {number} input.price          Precio negociado de venta
   * @param {number} input.incentives     Incentivos/bonos aplicados como reducción
   * @param {number} input.downPayment    Enganche (reducción de cap. cost)
   * @param {number} input.term           Plazo en meses
   * @param {number} input.residualPct    Residual como % del MSRP
   * @param {'mf'|'apr'} input.rateType   Tipo de tasa capturada
   * @param {number} input.rate           Money factor (ej. 0.00125) o TAE % (ej. 3.0)
   * @param {number} input.acqFee         Tarifa de adquisición del banco
   * @param {boolean} input.capitalizeAcq true = se suma al cap. cost; false = se paga al inicio
   * @param {number} input.upfrontFees    Otras tarifas pagadas al inicio (doc, placas...)
   * @param {number} input.capFees        Otras tarifas capitalizadas
   * @param {number} input.taxPct         Impuesto %
   * @param {'none'|'monthly'|'upfront'} input.taxMethod  Cómo se aplica el impuesto
   * @param {number} input.dispositionFee Tarifa de devolución al final del lease
   * @param {number} input.milesPerYear   Km o millas por año (para costo por unidad)
   */
  function computeLease(input) {
    input = input || {};
    var msrp = num(input.msrp);
    var price = num(input.price);
    var incentives = num(input.incentives);
    var downPayment = num(input.downPayment);
    var term = Math.max(1, Math.round(num(input.term)) || 36);
    var residualPct = num(input.residualPct);
    var residual = msrp * residualPct / 100;
    var moneyFactor = input.rateType === 'apr' ? num(input.rate) / 2400 : num(input.rate);
    var acqFee = num(input.acqFee);
    var capitalizeAcq = !!input.capitalizeAcq;
    var upfrontFees = num(input.upfrontFees);
    var capFees = num(input.capFees);
    var taxPct = num(input.taxPct);
    var taxMethod = input.taxMethod || 'monthly';
    var dispositionFee = num(input.dispositionFee);
    var milesPerYear = num(input.milesPerYear);

    var grossCap = price + capFees + (capitalizeAcq ? acqFee : 0);
    var capReduction = downPayment + incentives;
    var adjustedCap = grossCap - capReduction;

    var monthlyDepreciation = (adjustedCap - residual) / term;
    var monthlyRent = (adjustedCap + residual) * moneyFactor;
    var basePayment = monthlyDepreciation + monthlyRent;

    var monthlyTax = 0;
    var upfrontTax = 0;
    if (taxMethod === 'monthly') {
      monthlyTax = basePayment * taxPct / 100;
    } else if (taxMethod === 'upfront') {
      upfrontTax = basePayment * term * taxPct / 100;
    }
    var monthlyPayment = basePayment + monthlyTax;

    // Pago inicial (drive-off): enganche + primer mes + adquisición no
    // capitalizada + otras tarifas iniciales + impuesto pagado por adelantado.
    var driveOff = downPayment + monthlyPayment +
      (capitalizeAcq ? 0 : acqFee) + upfrontFees + upfrontTax;

    // Costo total: drive-off (ya incluye el primer mes) + los pagos restantes
    // + tarifa de devolución. Los incentivos no son dinero del cliente.
    var totalCost = driveOff + monthlyPayment * (term - 1) + dispositionFee;

    var effectiveMonthly = totalCost / term;
    var pctOfMsrp = msrp > 0 ? (effectiveMonthly / msrp) * 100 : 0;
    var score = effectiveMonthly > 0 ? msrp / (effectiveMonthly * 12) : 0;

    var totalMiles = milesPerYear * term / 12;
    var costPerMile = totalMiles > 0 ? totalCost / totalMiles : 0;

    return {
      residual: residual,
      moneyFactor: moneyFactor,
      aprEquivalent: moneyFactor * 2400,
      grossCap: grossCap,
      capReduction: capReduction,
      adjustedCap: adjustedCap,
      monthlyDepreciation: monthlyDepreciation,
      monthlyRent: monthlyRent,
      basePayment: basePayment,
      monthlyTax: monthlyTax,
      upfrontTax: upfrontTax,
      monthlyPayment: monthlyPayment,
      driveOff: driveOff,
      totalCost: totalCost,
      effectiveMonthly: effectiveMonthly,
      pctOfMsrp: pctOfMsrp,
      score: score,
      totalMiles: totalMiles,
      costPerMile: costPerMile,
      term: term
    };
  }

  return { computeLease: computeLease, num: num };
});
