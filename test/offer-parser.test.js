/* Tests del escáner de ofertas. Ejecutar con: node test/offer-parser.test.js */
'use strict';

var OfferParser = require('../js/offer-parser.js');
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
    actual != null && Math.abs(actual - expected) <= (tolerance == null ? 0.01 : tolerance),
    (label || 'valor') + ': se esperaba ~' + expected + ', se obtuvo ' + actual
  );
}

console.log('Lease Finder — tests del escáner de ofertas\n');

check('parseAmount: formatos de número', function () {
  assert.strictEqual(OfferParser.parseAmount('45,000'), 45000);
  assert.strictEqual(OfferParser.parseAmount('45.000'), 45000);
  assert.strictEqual(OfferParser.parseAmount('1.234,56'), 1234.56);
  assert.strictEqual(OfferParser.parseAmount('$1,234.56'), 1234.56);
  assert.strictEqual(OfferParser.parseAmount('7,5'), 7.5);
  assert.strictEqual(OfferParser.parseAmount('0.00135'), 0.00135);
  assert.strictEqual(OfferParser.parseAmount('10k'), 10000);
  assert.strictEqual(OfferParser.parseAmount('399.'), 399);
  assert.strictEqual(OfferParser.parseAmount('abc'), null);
});

check('anuncio en inglés estilo Leasehackr', function () {
  var p = OfferParser.parseBlock(
    '2026 BMW i4 eDrive40\n' +
    '$499/mes + tax, 36 meses\n' +
    '$3,500 due at signing\n' +
    'MSRP: $57,900\n' +
    '10,000 millas por año\n' +
    'Residual 59%, MF .00131'
  );
  assert.strictEqual(p.name, '2026 BMW i4 eDrive40');
  close(p.monthly, 499, 0.001, 'mensualidad');
  close(p.term, 36, 0.001, 'plazo');
  close(p.dueAtSigning, 3500, 0.001, 'inicial');
  close(p.msrp, 57900, 0.001, 'MSRP');
  close(p.milesPerYear, 10000, 0.001, 'millas/año');
  close(p.residualPct, 59, 0.001, 'residual');
  close(p.moneyFactor, 0.00131, 0.000001, 'money factor');
});

check('anuncio en español (México)', function () {
  var p = OfferParser.parseBlock(
    'Tesla Model 3 — Agencia Polanco\n' +
    'Mensualidad de $8,499 con $25,000 de enganche\n' +
    'Plazo de 24 meses, 20.000 km al año\n' +
    'Precio de lista $749,900'
  );
  close(p.monthly, 8499, 0.001, 'mensualidad');
  close(p.dueAtSigning, 25000, 0.001, 'enganche');
  close(p.term, 24, 0.001, 'plazo');
  close(p.milesPerYear, 20000, 0.001, 'km/año');
  close(p.msrp, 749900, 0.001, 'precio de lista');
});

check('sign and drive → inicial 0', function () {
  var p = OfferParser.parseBlock(
    'Honda Civic — sign and drive, $0 down\n$329 per month, 36 months'
  );
  close(p.monthly, 329, 0.001, 'mensualidad');
  assert.strictEqual(p.dueAtSigning, 0, 'inicial debe ser 0');
});

check('varias ofertas separadas por ---', function () {
  var offers = OfferParser.parseOffers(
    'Oferta A\n$400/mes, 36 meses\n---\nOferta B\n$500/mes, 24 meses'
  );
  assert.strictEqual(offers.length, 2, 'debe detectar 2 ofertas');
  close(offers[0].monthly, 400, 0.001);
  close(offers[1].term, 24, 0.001);
});

check('varias ofertas separadas por líneas en blanco', function () {
  var offers = OfferParser.parseOffers(
    'Oferta A\n$400/mes, 36 meses\n\n\nOferta B\n$500/mes, 24 meses'
  );
  assert.strictEqual(offers.length, 2, 'debe detectar 2 ofertas');
});

check('scanLoose encuentra ofertas en texto largo sin separar', function () {
  var page =
    'Promociones de julio. Aprovecha nuestras ofertas de lease. ' +
    'Mazda CX-5 2026 desde $429/mo con $2,999 due at signing, 36 months, MSRP $32,500. ' +
    'También tenemos el Mazda 3 2026 por $359/mo con $2,499 due at signing, 36 months, MSRP $26,800. ' +
    'Visítanos hoy mismo.';
  var offers = OfferParser.scanLoose(page);
  assert.ok(offers.length >= 2, 'debe detectar al menos 2 ofertas, detectó ' + offers.length);
  var monthlies = offers.map(function (o) { return o.monthly; });
  assert.ok(monthlies.indexOf(429) >= 0, 'debe incluir la de $429');
  assert.ok(monthlies.indexOf(359) >= 0, 'debe incluir la de $359');
});

check('scoreOffer: inicial incluye el primer mes cuando inicial ≥ mensualidad', function () {
  var m = OfferParser.scoreOffer({ monthly: 499, term: 36, dueAtSigning: 3500, msrp: 57900 });
  close(m.totalCost, 3500 + 499 * 35, 0.5, 'costo total');
  close(m.effectiveMonthly, 582.36, 0.01, 'efectivo mensual');
  close(m.pctOfMsrp, 1.006, 0.001, '% MSRP');
  close(m.score, 8.29, 0.01, 'score');
});

check('scoreOffer: enganche puro cuando inicial < mensualidad', function () {
  var m = OfferParser.scoreOffer({ monthly: 329, term: 36, dueAtSigning: 0 });
  close(m.totalCost, 329 * 36, 0.5, 'costo total sign-and-drive');
  assert.strictEqual(m.pctOfMsrp, null, 'sin MSRP no hay % MSRP');
  assert.strictEqual(m.score, null, 'sin MSRP no hay score');
});

check('scoreOffer: plazo por defecto 36', function () {
  var m = OfferParser.scoreOffer({ monthly: 400 });
  assert.strictEqual(m.term, 36);
});

check('htmlToText + scanText sobre una página HTML', function () {
  var html =
    '<html><head><style>.x{color:red}</style><script>var a=1;</script></head><body>' +
    '<div><h2>Toyota RAV4 2026</h2><p>$389/mo con $2,999 due at signing</p>' +
    '<p>36 months, MSRP $34,200</p></div>' +
    '<div><h2>Toyota Corolla 2026</h2><p>$299/mo con $1,999 due at signing</p>' +
    '<p>36 months, MSRP $25,100</p></div>' +
    '</body></html>';
  var offers = OfferParser.scanText(OfferParser.htmlToText(html));
  assert.ok(offers.length >= 2, 'debe detectar 2 ofertas en el HTML, detectó ' + offers.length);
});

check('hereda el nombre del bloque anterior (páginas de agencias)', function () {
  // Estructura real de Bay Ridge Honda: nombre en bloque propio, oferta en
  // el bloque narrativo, y un resumen "36 mos. $X /mo" duplicado sin nombre.
  var offers = OfferParser.parseOffers(
    '2026 Honda Odyssey FWD EX-L\n\n\n' +
    'Available Specials and Offers\n\n\n' +
    'Lease the Honda Odyssey with just $3,999 down – plus taxes and fees. ' +
    'Get behind the wheel for only $429/mo. for 36 months.\n\n\n' +
    'Lease Special\n\n\nDETAILS: Lease Offer\n\n\n36 mos. $429 /mo\n\n\n' +
    'Special APR\n\n\n48 mos. 3.99% APR\n\n\nOffer $500\n\n\n' +
    '2026 Honda Civic Hatchback 2WD Sport\n\n\n' +
    'Available Specials and Offers\n\n\n' +
    'Lease the Honda Civic Hatchback with just $2,999 down for only $249/mo. for 36 months.\n\n\n' +
    '36 mos. $249 /mo'
  );
  var named = offers.filter(function (o) { return o.name; });
  assert.strictEqual(named.length, 2, 'debe nombrar 2 ofertas, nombró ' + named.length);
  assert.strictEqual(named[0].name, '2026 Honda Odyssey FWD EX-L');
  close(named[0].monthly, 429, 0.001, 'mensualidad Odyssey');
  close(named[0].dueAtSigning, 3999, 0.001, 'enganche Odyssey');
  assert.strictEqual(named[1].name, '2026 Honda Civic Hatchback 2WD Sport');
  // los resúmenes anónimos duplicados deben desaparecer
  var anon = offers.filter(function (o) { return !o.name && (o.monthly === 429 || o.monthly === 249); });
  assert.strictEqual(anon.length, 0, 'no debe haber duplicados sin nombre');
});

check('texto sin ofertas → lista vacía', function () {
  assert.strictEqual(OfferParser.scanText('Hola, ¿cómo estás? Nos vemos mañana.').length, 0);
  assert.strictEqual(OfferParser.scanText('').length, 0);
});

console.log('');
if (failures) {
  console.error(failures + ' test(s) fallaron.');
  process.exit(1);
} else {
  console.log('Todos los tests pasaron ✅');
}
