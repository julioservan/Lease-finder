/**
 * Ranking curado de SUVs compactos (notas del dueño de la app).
 * Cada modelo trae specs, foto automática (Wikipedia), y enlaces a
 * inventario nuevo y usado/CPO cerca de Downtown Brooklyn (ZIP 11201).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RankedModels = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ZIP = '11201';

  function cars(stock, makeSlug, modelSlug) {
    return 'https://www.cars.com/shopping/results/?stock_type=' + stock +
      '&makes[]=' + makeSlug + '&models[]=' + modelSlug +
      '&zip=' + ZIP + '&maximum_distance=50';
  }

  var MODELS = [
    {
      make: 'Ford', model: 'Bronco Sport', trim: '', rating: 9.5, top: true,
      price: [31590, 40000],
      engine: '1.5T 181 hp · 2.0T 245 hp (Badlands)', drive: 'AWD de serie', mpg: '~25/28 mpg',
      blurb: 'Estética Bronco, AWD de serie y capacidad off-road real en tamaño compacto. El favorito.',
      wiki: 'Ford Bronco Sport', slug: ['ford', 'ford-bronco_sport']
    },
    {
      make: 'Mazda', model: 'CX-50', trim: '', rating: 9.3,
      price: [31720, 45400],
      engine: '2.5L 187 hp · 2.5T 256 hp', drive: 'AWD de serie', mpg: '~25/31 mpg',
      blurb: 'El interior y manejo más premium del segmento; versión híbrida disponible.',
      wiki: 'Mazda CX-50', slug: ['mazda', 'mazda-cx_50']
    },
    {
      make: 'Subaru', model: 'Forester', trim: 'Wilderness', rating: 9.2,
      price: [37390, 40000],
      engine: '2.5L bóxer 180 hp', drive: 'AWD simétrico · 9.3" de despeje', mpg: '~25/28 mpg',
      blurb: 'El off-road más honesto: X-Mode, suspensión elevada y visibilidad enorme.',
      wiki: 'Subaru Forester', slug: ['subaru', 'subaru-forester']
    },
    {
      make: 'Jeep', model: 'Cherokee', trim: '2026', rating: 9.1,
      price: [36995, 42500],
      engine: '1.6T híbrido 210 hp', drive: 'AWD', mpg: '~37 mpg combinado',
      blurb: 'El regreso 2026: ahora híbrido, eficiente y con ADN Jeep de verdad.',
      wiki: 'Jeep Cherokee', slug: ['jeep', 'jeep-cherokee']
    },
    {
      make: 'Kia', model: 'Sportage', trim: 'X-Pro', rating: 9.0,
      price: [34090, 38490],
      engine: '2.5L 187 hp', drive: 'AWD · llantas todo terreno', mpg: '~23/28 mpg',
      blurb: 'Mucho equipo por el dinero y garantía de 10 años/100k millas.',
      wiki: 'Kia Sportage', slug: ['kia', 'kia-sportage']
    },
    {
      make: 'Toyota', model: 'RAV4', trim: 'Woodland', rating: 8.9,
      price: [36000, 39000],
      engine: 'Híbrido 226 hp (toda la gama 2026)', drive: 'AWD', mpg: '~38-44 mpg',
      blurb: 'Fiabilidad y valor de reventa imbatibles; Woodland lista para el bosque.',
      wiki: 'Toyota RAV4', slug: ['toyota', 'toyota-rav4']
    },
    {
      make: 'Hyundai', model: 'Tucson', trim: 'XRT', rating: 8.8,
      price: [34900, 37500],
      engine: '2.5L 187 hp', drive: 'AWD', mpg: '~24/30 mpg',
      blurb: 'Diseño llamativo, look aventurero y gran garantía.',
      wiki: 'Hyundai Tucson', slug: ['hyundai', 'hyundai-tucson']
    },
    {
      make: 'GMC', model: 'Terrain', trim: 'AT4', rating: 8.7,
      price: [36400, 41000],
      engine: '1.5T 175 hp', drive: 'AWD', mpg: '~24/29 mpg',
      blurb: 'Renovado 2026 con pantalla de 15" y modo todoterreno AT4.',
      wiki: 'GMC Terrain', slug: ['gmc', 'gmc-terrain']
    },
    {
      make: 'Nissan', model: 'Rogue', trim: 'Rock Creek', rating: 8.4,
      price: [34760, 37500],
      engine: '1.5T VC-Turbo 201 hp', drive: 'AWD · suspensión off-road', mpg: '~28/33 mpg',
      blurb: 'Cómodo, eficiente, y la versión Rock Creek le pone botas.',
      wiki: 'Nissan Rogue', slug: ['nissan', 'nissan-rogue']
    },
    {
      make: 'Honda', model: 'CR-V', trim: 'TrailSport', rating: 8.4,
      price: [38800, 41000],
      engine: 'Híbrido 204 hp', drive: 'AWD', mpg: '~40 mpg ciudad',
      blurb: 'La compra sensata de siempre, ahora con sabor aventurero e híbrido.',
      wiki: 'Honda CR-V', slug: ['honda', 'honda-cr_v']
    },
    {
      make: 'Volkswagen', model: 'Tiguan', trim: '', rating: 8.3,
      price: [30930, 41000],
      engine: '2.0T 201 hp', drive: 'FWD/AWD', mpg: '~26/33 mpg',
      blurb: 'Nueva generación: más ligero, más equipado y con manejo europeo.',
      wiki: 'Volkswagen Tiguan', slug: ['volkswagen', 'volkswagen-tiguan']
    }
  ];

  /** Concesionarios cercanos por marca (Brooklyn / Queens / NJ). */
  var DEALERS = {
    Ford: [
      { n: 'Bay Ridge Ford (Brooklyn)', u: 'https://www.bayridgeford.com/' },
      { n: 'All American Ford (NJ)', u: 'https://www.allamericanford.com/' }
    ],
    Mazda: [
      { n: 'Koeppel Mazda (Queens)', u: 'https://www.koeppelmazda.com/' },
      { n: 'Wayne Mazda (NJ)', u: 'https://www.waynemazda.com/' }
    ],
    Subaru: [{ n: 'Bay Ridge Subaru (Brooklyn)', u: 'https://www.bayridgesubaru.com/' }],
    Jeep: [{ n: 'Manhattan Jeep CDJR', u: 'https://www.manhattanjeep.com/' }],
    Kia: [{ n: 'Concesionarios Kia cercanos (inventario)', u: cars('new', 'kia', 'kia-sportage') }],
    Toyota: [
      { n: 'Plaza Toyota (Brooklyn)', u: 'https://www.plazatoyota.net/' },
      { n: 'Bay Ridge Toyota (Brooklyn)', u: 'https://www.bayridgetoyota.com/' },
      { n: 'Hudson Toyota (Jersey City)', u: 'https://www.hudsontoyota.com/' }
    ],
    Hyundai: [{ n: 'Plaza Hyundai (Brooklyn)', u: 'https://www.plazahyundai.com/' }],
    GMC: [{ n: 'Concesionarios GMC cercanos (inventario)', u: cars('new', 'gmc', 'gmc-terrain') }],
    Nissan: [{ n: 'Bay Ridge Nissan (Brooklyn)', u: 'https://www.bayridgenissan.com/' }],
    Honda: [
      { n: 'Bay Ridge Honda (Brooklyn)', u: 'https://www.bayridgehonda.com/' },
      { n: 'Paragon Honda (Queens)', u: 'https://www.paragonhonda.com/' },
      { n: 'Metro Honda (Jersey City)', u: 'https://www.metrohonda.com/' }
    ],
    Volkswagen: [{ n: 'Concesionarios VW cercanos (inventario)', u: cars('new', 'volkswagen', 'volkswagen-tiguan') }]
  };

  /** Página oficial de ofertas de cada fabricante. */
  var BRAND_OFFERS = {
    Ford: 'https://www.ford.com/deals/',
    Mazda: 'https://www.mazdausa.com/shopping-tools/special-offers',
    Subaru: 'https://www.subaru.com/special-offers.html',
    Jeep: 'https://www.jeep.com/current-offers.html',
    Kia: 'https://www.kia.com/us/en/special-offers',
    Toyota: 'https://www.toyota.com/deals/',
    Hyundai: 'https://www.hyundaiusa.com/us/en/special-offers',
    GMC: 'https://www.gmc.com/current-deals',
    Nissan: 'https://www.nissanusa.com/shopping-tools/special-offers',
    Honda: 'https://automobiles.honda.com/tools/current-offers',
    Volkswagen: 'https://www.vw.com/en/offers.html'
  };

  var EDMUNDS_SLUG = {
    'Bronco Sport': 'ford/bronco-sport', 'CX-50': 'mazda/cx-50', 'Forester': 'subaru/forester',
    'Cherokee': 'jeep/cherokee', 'Sportage': 'kia/sportage', 'RAV4': 'toyota/rav4',
    'Tucson': 'hyundai/tucson', 'Terrain': 'gmc/terrain', 'Rogue': 'nissan/rogue',
    'CR-V': 'honda/cr-v', 'Tiguan': 'volkswagen/tiguan'
  };

  MODELS.forEach(function (m) {
    m.msrp = Math.round((m.price[0] + m.price[1]) / 2);
    m.linkNew = cars('new', m.slug[0], m.slug[1]);
    m.linkUsed = cars('used', m.slug[0], m.slug[1]);
    m.linkCpo = cars('cpo', m.slug[0], m.slug[1]);
    m.dealers = DEALERS[m.make] || [];
    m.sites = [
      { n: 'Ofertas oficiales de ' + m.make, u: BRAND_OFFERS[m.make] },
      { n: 'Edmunds: lease deals del ' + m.model, u: 'https://www.edmunds.com/' + EDMUNDS_SLUG[m.model] + '/lease-deals/' },
      { n: 'Foro Leasehackr (tratos reales)', u: 'https://forum.leasehackr.com/search?q=' + encodeURIComponent(m.make + ' ' + m.model) }
    ];
  });

  return MODELS;
});
