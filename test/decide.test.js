/* Tests del comparador Lease vs CPO vs compra. Ejecutar: node test/decide.test.js */
'use strict';

var Decide = require('../js/decide.js');
var assert = require('assert');

var failures = 0;
function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { failures++; console.error('  ✗ ' + name + '\n    ' + e.message); }
}
function close(actual, expected, tol, label) {
  assert.ok(actual != null && Math.abs(actual - expected) <= tol,
    (label || 'valor') + ': se esperaba ~' + expected + ', se obtuvo ' + actual);
}

console.log('Lease Finder — tests del comparador de decisión\n');

check('amortización a 0% = principal / meses', function () {
  close(Decide.amortMonthly(30000, 0, 60), 500, 0.001);
});

check('amortización a 6% / 60 meses', function () {
  close(Decide.amortMonthly(30000, 6, 60), 579.98, 0.05);
});

check('saldo restante llega a 0 al final del plazo', function () {
  close(Decide.remainingBalance(30000, 6, 60, 60), 0, 0.5);
});

check('saldo restante a mitad de plazo (0%) = mitad', function () {
  close(Decide.remainingBalance(30000, 0, 60, 30), 15000, 0.001);
});

check('decisión: compra nueva gana a lease caro', function () {
  var d = Decide.computeDecision({
    years: 6, leaseMonthly: 450,
    newPrice: 36000, aprNew: 0, depNew: 12, downPct: 0, loanMonths: 60
  });
  close(d.options.lease.cost, 32400, 0.5, 'costo lease');
  close(d.options.buyNew.valueAtEnd, 16718.55, 1, 'valor final nuevo');
  close(d.options.buyNew.cost, 19281.45, 1, 'costo neto nuevo');
  assert.strictEqual(d.winner, 'buyNew');
});

check('decisión: CPO gana cuando es mucho más barato', function () {
  var d = Decide.computeDecision({
    years: 6, leaseMonthly: 450,
    newPrice: 36000, aprNew: 0, depNew: 12,
    cpoPrice: 26000, aprCpo: 0, depCpo: 9,
    downPct: 0, loanMonths: 60
  });
  close(d.options.cpo.valueAtEnd, 26000 * Math.pow(0.91, 6), 1, 'valor final CPO');
  assert.strictEqual(d.winner, 'cpo');
  assert.ok(d.options.cpo.cost < d.options.buyNew.cost, 'CPO más barato que nuevo');
});

check('decisión: lease gana en horizonte corto con pago bajo', function () {
  var d = Decide.computeDecision({
    years: 2, leaseMonthly: 300,
    newPrice: 40000, aprNew: 6, depNew: 18, downPct: 10, loanMonths: 60
  });
  assert.strictEqual(d.winner, 'lease', 'ganó ' + d.winner);
});

check('opciones ausentes no truenan', function () {
  var d = Decide.computeDecision({ years: 6, newPrice: 36000 });
  assert.ok(!d.options.lease && !d.options.cpo && d.options.buyNew);
  assert.strictEqual(d.winner, 'buyNew');
});

console.log('');
if (failures) { console.error(failures + ' test(s) fallaron.'); process.exit(1); }
else console.log('Todos los tests pasaron ✅');
