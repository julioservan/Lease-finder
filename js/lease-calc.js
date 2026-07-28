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
    var tradeIn = num(input.tradeIn); // equity de permuta aplicada (reduce cap. cost)
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
    var postIncentives = num(input.postIncentives); // bonos post-venta (llegan después)
    var capitalizeTaxes = !!input.capitalizeTaxes;  // impuesto inicial → a la cuota
    var zeroDriveOff = !!input.zeroDriveOff;        // $0 al firmar: capitaliza TODO
    var milesPerYear = num(input.milesPerYear);

    var grossCap = price + capFees + (capitalizeAcq ? acqFee : 0);
    var capReduction = downPayment + incentives + tradeIn;
    var adjustedCap = grossCap - capReduction;

    function pay(cap) {
      return { dep: (cap - residual) / term, rent: (cap + residual) * moneyFactor };
    }

    // Extras que pueden capitalizarse (sumarse a la cuota en vez de pagarse
    // al firmar). El impuesto inicial depende del propio pago, así que se
    // resuelve por iteración (converge en pocas vueltas). El primer mes NO se
    // capitaliza: en un "cero al firmar" solo se APLAZA (se factura con el
    // mes 1), no es deuda adicional.
    var extraFees = zeroDriveOff ? (capitalizeAcq ? 0 : acqFee) + upfrontFees : 0;
    var rollTax = (capitalizeTaxes || zeroDriveOff) && taxMethod === 'upfront';
    var taxCap = 0;
    var p = pay(adjustedCap + extraFees);
    for (var it = 0; it < 8 && rollTax; it++) {
      p = pay(adjustedCap + extraFees + taxCap);
      taxCap = (p.dep + p.rent) * term * taxPct / 100;
    }
    p = pay(adjustedCap + extraFees + taxCap);
    var adjustedCapEff = adjustedCap + extraFees + taxCap;
    var monthlyDepreciation = p.dep;
    var monthlyRent = p.rent;
    var basePayment = monthlyDepreciation + monthlyRent;

    var monthlyTax = 0;
    var upfrontTax = 0;
    if (taxMethod === 'monthly') {
      monthlyTax = basePayment * taxPct / 100;
    } else if (taxMethod === 'upfront' && !rollTax) {
      upfrontTax = basePayment * term * taxPct / 100;
    }
    var monthlyPayment = basePayment + monthlyTax;

    // Pago inicial (drive-off). Con "cero al firmar", tarifas + impuesto +
    // primer mes van dentro de la cuota y solo queda el enganche (si lo hay).
    var firstMonthAtSigning = zeroDriveOff ? 0 : monthlyPayment;
    var feesUpfront = zeroDriveOff ? 0 : (capitalizeAcq ? 0 : acqFee) + upfrontFees;
    var driveOff = downPayment + firstMonthAtSigning + feesUpfront + upfrontTax;

    // Costo total: con cero al firmar se pagan los `term` meses por cuota;
    // si no, el primer mes ya va dentro del drive-off. Los bonos post-venta
    // vuelven al bolsillo después de firmar.
    var paymentsAfterSigning = zeroDriveOff ? term : term - 1;
    var totalCost = driveOff + monthlyPayment * paymentsAfterSigning + dispositionFee - postIncentives;

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
      adjustedCap: adjustedCapEff,
      // Desglose del pago inicial (para mostrarlo, no solo el total)
      driveOffBreakdown: {
        downPayment: downPayment,
        firstMonth: firstMonthAtSigning,
        fees: feesUpfront,
        upfrontTax: upfrontTax
      },
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

  /**
   * MONEY FACTOR IMPLÍCITO: despeja el MF que el concesionario está cobrando
   * a partir de la cuota que te ofrece. El dealer nunca lo enseña — ahí
   * esconde el margen — pero es álgebra:
   *
   *   cuota = (cap - residual)/plazo + (cap + residual) × MF
   *   →  MF = (cuota - (cap - residual)/plazo) / (cap + residual)
   *
   * `quotedMonthly` debe ser la cuota SIN impuesto (en NY el impuesto va
   * aparte, así que la cuota cotizada suele ser pre-tax).
   * Devuelve null si faltan datos (MSRP+residual y precio).
   */
  function impliedMF(input) {
    input = input || {};
    var quoted = num(input.quotedMonthly);
    var msrp = num(input.msrp);
    var price = num(input.price) || msrp; // sin precio negociado, asume MSRP (peor caso honesto)
    var term = Math.max(1, Math.round(num(input.term)) || 36);
    var residual = num(input.residualAmount);
    if (!residual && num(input.residualPct) > 0 && msrp > 0) {
      residual = msrp * num(input.residualPct) / 100;
    }
    if (quoted <= 0 || price <= 0 || residual <= 0) return null;

    var acqFee = num(input.acqFee);
    var cap = price + num(input.capFees) + (input.capitalizeAcq ? acqFee : 0) -
      num(input.downPayment) - num(input.incentives) - num(input.tradeIn);

    var depreciation = (cap - residual) / term;
    var rent = quoted - depreciation;               // $ de interés/mes implícito
    var mf = rent / (cap + residual);
    return {
      moneyFactor: mf,
      aprEquivalent: mf * 2400,
      monthlyRent: rent,
      monthlyDepreciation: depreciation,
      cap: cap,
      residual: residual
    };
  }

  return { computeLease: computeLease, impliedMF: impliedMF, num: num };
});
