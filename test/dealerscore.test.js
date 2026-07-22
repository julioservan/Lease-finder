/* Tests de la nota del concesionario. Ejecutar: node test/dealerscore.test.js */
'use strict';

var DS = require('../js/dealerscore.js');
var assert = require('assert');

var failures = 0;
function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { failures++; console.error('  ✗ ' + name + '\n    ' + e.message); }
}

function offer(source, monthly, das, raw, opts) {
  opts = opts || {};
  var term = opts.term || 36;
  var total = (das || 0) + monthly * term;
  return {
    source: source, region: opts.region || 'Brooklyn, NY', isTarget: opts.isTarget !== false,
    name: opts.name || '2026 Honda CR-V LX', parsed: { raw: raw || '' },
    firstSeen: '2026-07-01T00:00:00Z', lastSeen: '2026-07-20T00:00:00Z',
    metrics: { monthlyPayment: monthly, driveOff: das, term: term, effectiveMonthly: total / term }
  };
}

console.log('Lease Finder — tests de la nota del concesionario\n');

check('concesionario transparente saca nota A', function () {
  var offers = [
    offer('Honesto Honda', 289, 0, 'first month payment due at signing'),
    offer('Honesto Honda', 319, 0, ''),
    offer('Honesto Honda', 249, 500, '')
  ];
  var d = DS.analyze(offers)[0];
  assert.strictEqual(d.name, 'Honesto Honda');
  assert.strictEqual(d.grade, 'A');
  assert.ok(d.avgRatio < 1.2, 'ratio bajo');
});

check('mensualidad gancho (entrada gorda) baja la nota', function () {
  var offers = [
    offer('Anzuelo Motors', 199, 6000, ''), // efectivo ~$366: +84%
    offer('Anzuelo Motors', 229, 7000, '')
  ];
  var d = DS.analyze(offers)[0];
  assert.ok(d.avgRatio > 1.45, 'ratio alto: ' + d.avgRatio);
  assert.ok(d.score < 7, 'penalizado');
  assert.ok(d.reasons.some(function (r) { return /gancho/.test(r); }));
});

check('condiciones escondidas en la mayoría penalizan', function () {
  var offers = [
    offer('Condiciones Cars', 299, 0, 'Must finance through dealer. Loyalty required.'),
    offer('Condiciones Cars', 309, 0, 'Trade-in required for advertised price.')
  ];
  var d = DS.analyze(offers)[0];
  assert.ok(d.condShare === 1);
  assert.ok(d.flagCounts.financing === 1 && d.flagCounts.tradein === 1 && d.flagCounts.loyalty === 1);
  assert.ok(d.score < 8, 'penalizado');
});

check('agregadores no se puntúan', function () {
  var offers = [
    offer('CarsDirect — CR-V', 299, 0, '', { region: 'agregador por modelo' }),
    offer('Dealer Real', 299, 0, '')
  ];
  var res = DS.analyze(offers);
  assert.strictEqual(res.length, 1);
  assert.strictEqual(res[0].name, 'Dealer Real');
});

check('con 1 sola oferta la nota es "?" (pocos datos)', function () {
  var d = DS.analyze([offer('Nuevo Dealer', 299, 0, '')])[0];
  assert.strictEqual(d.grade, '?');
});

check('offerFlags detecta financiación y grupos', function () {
  var fl = DS.offerFlags('Special requires financing through Honda Financial. Military appreciation offer.');
  var keys = fl.map(function (f) { return f.key; });
  assert.ok(keys.indexOf('financing') >= 0);
  assert.ok(keys.indexOf('group') >= 0);
});

check('ofertas sin mensualidad no cuentan', function () {
  var res = DS.analyze([{ source: 'X', region: 'NY', metrics: { monthlyPayment: null } }]);
  assert.strictEqual(res.length, 0);
});

if (failures) { console.error('\n' + failures + ' test(s) fallaron ❌'); process.exit(1); }
console.log('\nTodos los tests pasaron ✅');
