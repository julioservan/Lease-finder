/* Tests de la lógica de cálculo. Ejecutar con: node test/lease-calc.test.js */
'use strict';

var LeaseCalc = require('../js/lease-calc.js');
var assert = require('assert');

var failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('  ✓ ' + name);
  } catch (e) {
    failures++;
    console.error('  ✗ ' + name + '\n    ' + e.message);
  }
}

function close(actual, expected, tolerance, label) {
  assert.ok(
    Math.abs(actual - expected) <= (tolerance == null ? 0.01 : tolerance),
    (label || 'valor') + ': se esperaba ~' + expected + ', se obtuvo ' + actual
  );
}

console.log('Lease Finder — tests de cálculo\n');

check('lease básico sin tarifas ni impuestos', function () {
  var r = LeaseCalc.computeLease({
    msrp: 40000, price: 36000, term: 36, residualPct: 60,
    rateType: 'mf', rate: 0.00125, taxMethod: 'none'
  });
  close(r.residual, 24000, 0.001, 'residual');
  close(r.monthlyDepreciation, 333.33, 0.01, 'depreciación');
  close(r.monthlyRent, 75, 0.001, 'cargo financiero');
  close(r.monthlyPayment, 408.33, 0.01, 'pago mensual');
  // drive-off = solo el primer mes
  close(r.driveOff, 408.33, 0.01, 'drive-off');
  close(r.totalCost, 14700, 0.5, 'costo total');
  close(r.effectiveMonthly, 408.33, 0.01, 'efectivo mensual');
  close(r.score, 8.16, 0.01, 'score');
  close(r.pctOfMsrp, 1.0208, 0.001, '% del MSRP');
});

check('TAE se convierte a money factor (TAE / 2400)', function () {
  var a = LeaseCalc.computeLease({
    msrp: 40000, price: 36000, term: 36, residualPct: 60,
    rateType: 'apr', rate: 3.0, taxMethod: 'none'
  });
  var b = LeaseCalc.computeLease({
    msrp: 40000, price: 36000, term: 36, residualPct: 60,
    rateType: 'mf', rate: 0.00125, taxMethod: 'none'
  });
  close(a.monthlyPayment, b.monthlyPayment, 0.001, 'pago mensual equivalente');
  close(a.aprEquivalent, 3.0, 0.001, 'TAE equivalente');
});

check('enganche e incentivos reducen el cap. cost', function () {
  var r = LeaseCalc.computeLease({
    msrp: 40000, price: 36000, term: 36, residualPct: 60,
    rateType: 'mf', rate: 0.00125, taxMethod: 'none',
    downPayment: 2000, incentives: 1000
  });
  close(r.adjustedCap, 33000, 0.001, 'cap ajustado');
  close(r.monthlyDepreciation, 250, 0.01, 'depreciación');
  close(r.monthlyRent, 71.25, 0.001, 'cargo financiero');
  // el enganche entra al drive-off, el incentivo no
  close(r.driveOff, 2000 + 321.25, 0.01, 'drive-off');
});

check('tarifa de adquisición: capitalizada vs. pagada al inicio', function () {
  var base = {
    msrp: 40000, price: 36000, term: 36, residualPct: 60,
    rateType: 'mf', rate: 0.00125, taxMethod: 'none', acqFee: 900
  };
  var cap = LeaseCalc.computeLease(Object.assign({}, base, { capitalizeAcq: true }));
  var up = LeaseCalc.computeLease(Object.assign({}, base, { capitalizeAcq: false }));
  close(cap.adjustedCap, 36900, 0.001, 'cap con tarifa capitalizada');
  close(up.adjustedCap, 36000, 0.001, 'cap con tarifa al inicio');
  assert.ok(cap.monthlyPayment > up.monthlyPayment, 'capitalizar sube el pago mensual');
  assert.ok(up.driveOff > cap.driveOff, 'pagarla al inicio sube el drive-off');
});

check('impuesto sobre el pago mensual', function () {
  var r = LeaseCalc.computeLease({
    msrp: 40000, price: 36000, term: 36, residualPct: 60,
    rateType: 'mf', rate: 0.00125, taxMethod: 'monthly', taxPct: 10
  });
  close(r.monthlyTax, 40.83, 0.01, 'impuesto mensual');
  close(r.monthlyPayment, 449.17, 0.01, 'pago con impuesto');
});

check('impuesto pagado por adelantado sobre la suma de pagos', function () {
  var r = LeaseCalc.computeLease({
    msrp: 40000, price: 36000, term: 36, residualPct: 60,
    rateType: 'mf', rate: 0.00125, taxMethod: 'upfront', taxPct: 10
  });
  close(r.monthlyTax, 0, 0.001, 'sin impuesto mensual');
  close(r.upfrontTax, 1470, 0.5, 'impuesto por adelantado');
  close(r.driveOff, 408.33 + 1470, 0.51, 'drive-off incluye impuesto');
});

check('tarifa de devolución se suma al costo total', function () {
  var sin = LeaseCalc.computeLease({
    msrp: 40000, price: 36000, term: 36, residualPct: 60,
    rateType: 'mf', rate: 0.00125, taxMethod: 'none'
  });
  var con = LeaseCalc.computeLease({
    msrp: 40000, price: 36000, term: 36, residualPct: 60,
    rateType: 'mf', rate: 0.00125, taxMethod: 'none', dispositionFee: 400
  });
  close(con.totalCost - sin.totalCost, 400, 0.001, 'diferencia de costo total');
});

check('costo por km/milla', function () {
  var r = LeaseCalc.computeLease({
    msrp: 40000, price: 36000, term: 36, residualPct: 60,
    rateType: 'mf', rate: 0.00125, taxMethod: 'none', milesPerYear: 12000
  });
  close(r.totalMiles, 36000, 0.001, 'total de km');
  close(r.costPerMile, 14700 / 36000, 0.001, 'costo por km');
});

check('entradas vacías o inválidas no truenan', function () {
  var r = LeaseCalc.computeLease({});
  assert.ok(isFinite(r.monthlyPayment), 'pago mensual finito');
  r = LeaseCalc.computeLease({ msrp: 'abc', price: null, term: -5 });
  assert.ok(isFinite(r.totalCost), 'costo total finito');
});

check('acepta decimales con coma', function () {
  var a = LeaseCalc.computeLease({
    msrp: 40000, price: 36000, term: 36, residualPct: '60,5',
    rateType: 'mf', rate: 0.00125, taxMethod: 'none'
  });
  var b = LeaseCalc.computeLease({
    msrp: 40000, price: 36000, term: 36, residualPct: 60.5,
    rateType: 'mf', rate: 0.00125, taxMethod: 'none'
  });
  close(a.monthlyPayment, b.monthlyPayment, 0.001, 'pago equivalente');
});

console.log('');
if (failures) {
  console.error(failures + ' test(s) fallaron.');
  process.exit(1);
} else {
  console.log('Todos los tests pasaron ✅');
}

check('trade-in reduce el cap. cost igual que el enganche', function () {
  var a = LeaseCalc.computeLease({ msrp: 40000, price: 36000, term: 36, residualPct: 60, rateType: 'mf', rate: 0.00125, taxMethod: 'none', downPayment: 2000 });
  var b = LeaseCalc.computeLease({ msrp: 40000, price: 36000, term: 36, residualPct: 60, rateType: 'mf', rate: 0.00125, taxMethod: 'none', tradeIn: 2000 });
  close(a.monthlyPayment, b.monthlyPayment, 0.001, 'misma cuota');
});

check('capitalizar impuestos: el impuesto inicial pasa a la cuota', function () {
  var base = { msrp: 40000, price: 36000, term: 36, residualPct: 60, rateType: 'mf', rate: 0.00125, taxPct: 8.875, taxMethod: 'upfront' };
  var cash = LeaseCalc.computeLease(base);
  var rolled = LeaseCalc.computeLease(Object.assign({ capitalizeTaxes: true }, base));
  assert.ok(cash.upfrontTax > 1000, 'al contado hay impuesto inicial');
  close(rolled.upfrontTax, 0, 0.001, 'capitalizado no hay impuesto inicial');
  assert.ok(rolled.monthlyPayment > cash.monthlyPayment, 'la cuota sube al capitalizar');
  assert.ok(rolled.driveOff < cash.driveOff - 1000, 'el drive-off baja en ~el impuesto');
  // el total apenas cambia (solo el cargo financiero sobre lo capitalizado)
  assert.ok(Math.abs(rolled.totalCost - cash.totalCost) < 250, 'total similar, fue ' + (rolled.totalCost - cash.totalCost));
});

check('cero al firmar: drive-off $0 y total similar', function () {
  var base = { msrp: 40000, price: 36000, term: 36, residualPct: 60, rateType: 'mf', rate: 0.00125, taxPct: 8.875, taxMethod: 'upfront', acqFee: 695, upfrontFees: 400 };
  var normal = LeaseCalc.computeLease(base);
  var zero = LeaseCalc.computeLease(Object.assign({ zeroDriveOff: true }, base));
  close(zero.driveOff, 0, 0.001, 'nada al firmar');
  close(zero.driveOffBreakdown.firstMonth, 0, 0.001, 'primer mes capitalizado');
  assert.ok(zero.monthlyPayment > normal.monthlyPayment, 'cuota más alta');
  assert.ok(Math.abs(zero.totalCost - normal.totalCost) < 400, 'total similar, dif=' + (zero.totalCost - normal.totalCost));
});

check('bonos post-venta reducen el costo total, no la cuota', function () {
  var a = LeaseCalc.computeLease({ msrp: 40000, price: 36000, term: 36, residualPct: 60, rateType: 'mf', rate: 0.00125, taxMethod: 'none' });
  var b = LeaseCalc.computeLease({ msrp: 40000, price: 36000, term: 36, residualPct: 60, rateType: 'mf', rate: 0.00125, taxMethod: 'none', postIncentives: 1000 });
  close(a.monthlyPayment, b.monthlyPayment, 0.001, 'misma cuota');
  close(a.totalCost - b.totalCost, 1000, 0.01, 'total 1000 menos');
});

check('desglose del drive-off suma el total', function () {
  var r = LeaseCalc.computeLease({ msrp: 40000, price: 36000, term: 36, residualPct: 60, rateType: 'mf', rate: 0.00125, taxPct: 8.875, taxMethod: 'upfront', downPayment: 1500, acqFee: 695, upfrontFees: 300 });
  var b = r.driveOffBreakdown;
  close(b.downPayment + b.firstMonth + b.fees + b.upfrontTax, r.driveOff, 0.01, 'desglose = total');
});

check('impliedMF recupera el money factor de una cuota conocida', function () {
  // Genera una cuota con MF conocido y comprueba que el inverso lo despeja.
  var fwd = LeaseCalc.computeLease({
    msrp: 38900, price: 36500, term: 36, residualPct: 61,
    rateType: 'mf', rate: 0.00173, taxMethod: 'none'
  });
  var inv = LeaseCalc.impliedMF({
    quotedMonthly: fwd.basePayment, msrp: 38900, price: 36500,
    term: 36, residualPct: 61
  });
  close(inv.moneyFactor, 0.00173, 0.000001, 'MF recuperado');
  close(inv.aprEquivalent, 0.00173 * 2400, 0.01, 'TAE equivalente');
});

check('impliedMF: enganche e incentivos reducen el cap antes de despejar', function () {
  var fwd = LeaseCalc.computeLease({
    msrp: 38900, price: 36500, term: 36, residualPct: 61,
    rateType: 'mf', rate: 0.002, taxMethod: 'none', downPayment: 2000, incentives: 1000
  });
  var inv = LeaseCalc.impliedMF({
    quotedMonthly: fwd.basePayment, msrp: 38900, price: 36500,
    term: 36, residualPct: 61, downPayment: 2000, incentives: 1000
  });
  close(inv.moneyFactor, 0.002, 0.000001, 'MF con reducciones');
});

check('impliedMF devuelve null si falta el residual o la cuota', function () {
  assert.strictEqual(LeaseCalc.impliedMF({ quotedMonthly: 400, msrp: 38900, term: 36 }), null);
  assert.strictEqual(LeaseCalc.impliedMF({ msrp: 38900, term: 36, residualPct: 61 }), null);
});

check('impliedMF con residual en dólares (residualAmount)', function () {
  var inv = LeaseCalc.impliedMF({ quotedMonthly: 459, msrp: 38900, price: 36500, term: 36, residualAmount: 23729 });
  close(inv.moneyFactor, 0.001731, 0.00002, 'MF de la hoja del dealer');
});
