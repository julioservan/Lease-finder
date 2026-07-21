/**
 * ¿Lease, CPO o compra nueva? — compara el costo total de tener el auto
 * durante un horizonte de años, con supuestos editables.
 *
 * Modelo:
 *  - LEASE: pagas el costo efectivo mensual todo el horizonte (encadenando
 *    leases). No acumulas patrimonio.
 *  - COMPRA (nueva o CPO): enganche + mensualidades del crédito; al final
 *    del horizonte te queda un auto con valor (depreciación compuesta
 *    anual). Costo neto = todo lo pagado + saldo pendiente − valor del auto.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Decide = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Pago mensual de un crédito amortizado. */
  function amortMonthly(principal, aprPct, months) {
    if (principal <= 0 || months <= 0) return 0;
    var r = aprPct / 1200;
    if (r === 0) return principal / months;
    return principal * r / (1 - Math.pow(1 + r, -months));
  }

  /** Saldo restante después de `paid` mensualidades. */
  function remainingBalance(principal, aprPct, months, paid) {
    var r = aprPct / 1200;
    if (r === 0) return principal * (1 - paid / months);
    var pay = amortMonthly(principal, aprPct, months);
    return principal * Math.pow(1 + r, paid) - pay * (Math.pow(1 + r, paid) - 1) / r;
  }

  function buyOption(price, aprPct, opts) {
    var years = opts.years;
    var horizonMonths = years * 12;
    var down = price * (opts.downPct == null ? 10 : opts.downPct) / 100;
    var principal = price - down;
    var term = opts.loanMonths == null ? 60 : opts.loanMonths;
    var monthly = amortMonthly(principal, aprPct, term);
    var paidMonths = Math.min(term, horizonMonths);
    var payments = monthly * paidMonths;
    var balance = paidMonths >= term ? 0 : Math.max(0, remainingBalance(principal, aprPct, term, paidMonths));
    var value = price * Math.pow(1 - (opts.depPct == null ? 12 : opts.depPct) / 100, years);
    var cost = down + payments + balance - value;
    return {
      monthly: monthly,
      down: down,
      totalPaid: down + payments + balance,
      valueAtEnd: value,
      cost: cost,
      effectiveMonthly: cost / horizonMonths
    };
  }

  /**
   * @param {object} o
   *  years         horizonte en años (default 6)
   *  leaseMonthly  costo efectivo mensual del lease (null si no hay dato)
   *  newPrice      precio del auto nuevo
   *  aprNew        TAE del crédito nuevo (default 5.9)
   *  depNew        depreciación anual % del nuevo (default 12)
   *  cpoPrice      precio del CPO (null para omitir)
   *  aprCpo        TAE del crédito usado (default 6.9)
   *  depCpo        depreciación anual % del CPO (default 9)
   *  downPct       enganche % en compras (default 10)
   *  loanMonths    plazo del crédito en meses (default 60)
   */
  function computeDecision(o) {
    o = o || {};
    var years = o.years > 0 ? o.years : 6;
    var horizonMonths = years * 12;
    var options = {};

    if (o.leaseMonthly != null && o.leaseMonthly > 0) {
      var leaseCost = o.leaseMonthly * horizonMonths;
      options.lease = {
        label: 'Lease',
        monthly: o.leaseMonthly,
        totalPaid: leaseCost,
        valueAtEnd: 0,
        cost: leaseCost,
        effectiveMonthly: o.leaseMonthly
      };
    }
    if (o.newPrice != null && o.newPrice > 0) {
      var n = buyOption(o.newPrice, o.aprNew == null ? 5.9 : o.aprNew,
        { years: years, downPct: o.downPct, loanMonths: o.loanMonths, depPct: o.depNew == null ? 12 : o.depNew });
      n.label = 'Compra nueva';
      options.buyNew = n;
    }
    if (o.cpoPrice != null && o.cpoPrice > 0) {
      var c = buyOption(o.cpoPrice, o.aprCpo == null ? 6.9 : o.aprCpo,
        { years: years, downPct: o.downPct, loanMonths: o.loanMonths, depPct: o.depCpo == null ? 9 : o.depCpo });
      c.label = 'CPO (seminuevo)';
      options.cpo = c;
    }

    var winner = null;
    Object.keys(options).forEach(function (k) {
      if (!winner || options[k].cost < options[winner].cost) winner = k;
    });

    return { years: years, horizonMonths: horizonMonths, options: options, winner: winner };
  }

  return {
    amortMonthly: amortMonthly,
    remainingBalance: remainingBalance,
    computeDecision: computeDecision
  };
});
