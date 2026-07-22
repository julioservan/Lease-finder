/* Tests del extractor JSON-LD de webs de concesionarios. Ejecutar: node test/jsonld.test.js */
'use strict';

var JsonLd = require('../scanner/jsonld.js');
var OfferParser = require('../js/offer-parser.js');
var assert = require('assert');

var failures = 0;
function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { failures++; console.error('  ✗ ' + name + '\n    ' + e.message); }
}

function script(json) {
  return '<script type="application/ld+json">' + JSON.stringify(json) + '</script>';
}

console.log('Lease Finder — tests del extractor JSON-LD\n');

// Estilo Dealer.com / DealerInspire: un nodo Vehicle por coche.
var VEHICLE = {
  '@context': 'https://schema.org', '@type': 'Vehicle',
  name: '2026 GMC Terrain Elevation', vehicleIdentificationNumber: '3GKALZEG0TL531149',
  brand: { '@type': 'Brand', name: 'GMC' }, model: 'Terrain',
  vehicleConfiguration: 'Elevation', vehicleModelDate: '2026',
  itemCondition: 'https://schema.org/NewCondition', color: 'Summit White',
  image: 'https://example.com/terrain.jpg',
  offers: { '@type': 'Offer', price: '33990', priceCurrency: 'USD' }
};

check('extrae un Vehicle con VIN, precio y condición', function () {
  var html = '<html><head>' + script(VEHICLE) + '</head><body></body></html>';
  var v = JsonLd.vehicles(html);
  assert.strictEqual(v.length, 1);
  assert.strictEqual(v[0].vin, '3GKALZEG0TL531149');
  assert.strictEqual(v[0].price, 33990);
  assert.strictEqual(v[0].condition, 'new');
  assert.strictEqual(v[0].make, 'GMC');
  assert.strictEqual(v[0].trim, 'Elevation');
  assert.strictEqual(v[0].year, 2026);
});

check('recorre @graph e ItemList (estilo DealerOn)', function () {
  var html = script({
    '@context': 'https://schema.org',
    '@graph': [{
      '@type': 'ItemList',
      itemListElement: [
        { '@type': 'ListItem', item: VEHICLE },
        { '@type': 'ListItem', item: Object.assign({}, VEHICLE, { vehicleIdentificationNumber: 'OTRA111111111VIN2', name: '2026 GMC Terrain AT4' }) }
      ]
    }]
  });
  assert.strictEqual(JsonLd.vehicles(html).length, 2);
});

check('dedupe por VIN aunque el coche salga dos veces', function () {
  var html = script(VEHICLE) + script(VEHICLE);
  assert.strictEqual(JsonLd.vehicles(html).length, 1);
});

check('Product sin señal de vehículo NO cuenta; con VIN sí', function () {
  var noVin = script({ '@type': 'Product', name: 'Alfombrillas GMC', offers: { price: '99' } });
  assert.strictEqual(JsonLd.vehicles(noVin).length, 0);
  var conVin = script({ '@type': 'Product', name: '2026 Kia Sorento EX', vin: 'KIA00000000000VIN', offers: { price: '38000' } });
  assert.strictEqual(JsonLd.vehicles(conVin).length, 1);
});

check('promo de lease en un Offer llega al parser con mensualidad y plazo', function () {
  var html = script({
    '@type': 'Offer',
    name: '2026 Honda CR-V LX AWD Lease Special',
    description: 'Lease for $299/mo for 36 months. $2,999 due at signing. MSRP $34,850.'
  });
  var texts = JsonLd.offerTexts(html);
  assert.strictEqual(texts.length, 1);
  var offers = OfferParser.scanText(texts[0]);
  assert.strictEqual(offers.length, 1);
  assert.strictEqual(offers[0].monthly, 299);
  assert.strictEqual(offers[0].term, 36);
  assert.strictEqual(offers[0].dueAtSigning, 2999);
});

check('ofertas sin mensualidad (venta normal) no generan textos de lease', function () {
  var html = script({ '@type': 'Offer', name: 'Descuento de $2,000 en accesorios', description: 'Solo este mes.' });
  assert.strictEqual(JsonLd.offerTexts(html).length, 0);
});

check('JSON roto no revienta y los bloques buenos sobreviven', function () {
  var html = '<script type="application/ld+json">{esto no es json…</script>' + script(VEHICLE);
  assert.strictEqual(JsonLd.vehicles(html).length, 1);
});

check('millas del odómetro y drivetrain se normalizan', function () {
  var html = script(Object.assign({}, VEHICLE, {
    itemCondition: 'https://schema.org/UsedCondition',
    mileageFromOdometer: { '@type': 'QuantitativeValue', value: 12345, unitCode: 'SMI' },
    driveWheelConfiguration: 'AWD'
  }));
  var v = JsonLd.vehicles(html)[0];
  assert.strictEqual(v.miles, 12345);
  assert.strictEqual(v.condition, 'used');
  assert.strictEqual(v.drivetrain, 'AWD');
});

if (failures) { console.error('\n' + failures + ' test(s) fallaron ❌'); process.exit(1); }
console.log('\nTodos los tests pasaron ✅');
