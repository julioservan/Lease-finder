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
      make: 'Ford', model: 'Bronco Sport', trim: '', rating: 9.5, top: true, priority: 1,
      price: [31590, 40000],
      engine: '1.5T 181 hp · 2.0T 245 hp (Badlands)', drive: 'AWD de serie', mpg: '~25/28 mpg',
      blurb: 'Estética Bronco, AWD de serie y capacidad off-road real en tamaño compacto. El favorito.',
      wiki: 'Ford Bronco Sport', slug: ['ford', 'ford-bronco_sport'],
      photoQuery: '2025 Ford Bronco Sport',
      trims: ['Big Bend', 'Heritage', 'Outer Banks', 'Badlands'],
      img: { make: 'ford', family: 'bronco-sport', year: 2024 }
    },
    {
      make: 'Mazda', model: 'CX-50', trim: '', rating: 9.3,
      price: [31720, 45400],
      engine: '2.5L 187 hp · 2.5T 256 hp', drive: 'AWD de serie', mpg: '~25/31 mpg',
      blurb: 'El interior y manejo más premium del segmento; versión híbrida disponible.',
      wiki: 'Mazda CX-50', slug: ['mazda', 'mazda-cx_50'],
      photoQuery: '2024 Mazda CX-50',
      trims: ['Select', 'Preferred', 'Premium', 'Premium Plus', 'Turbo', 'Hybrid'],
      img: { make: 'mazda', family: 'cx-50', year: 2024 }
    },
    {
      make: 'Subaru', model: 'Forester', trim: 'Wilderness', rating: 9.2,
      price: [37390, 40000],
      engine: '2.5L bóxer 180 hp', drive: 'AWD simétrico · 9.3" de despeje', mpg: '~25/28 mpg',
      blurb: 'El off-road más honesto: X-Mode, suspensión elevada y visibilidad enorme.',
      wiki: 'Subaru Forester', slug: ['subaru', 'subaru-forester'],
      photoQuery: '2025 Subaru Forester',
      trims: ['Base', 'Premium', 'Sport', 'Limited', 'Touring', 'Wilderness'],
      img: { make: 'subaru', family: 'forester', year: 2024 }
    },
    {
      make: 'Jeep', model: 'Cherokee', trim: '2026', rating: 9.1, priority: 3,
      price: [36995, 42500],
      engine: '1.6T híbrido 210 hp', drive: 'AWD', mpg: '~37 mpg combinado',
      blurb: 'El regreso 2026: ahora híbrido, eficiente y con ADN Jeep de verdad.',
      wiki: 'Jeep Cherokee', slug: ['jeep', 'jeep-cherokee'],
      photoQuery: '2026 Jeep Cherokee',
      trims: ['Laredo', 'Limited', 'Overland'],
      img: { make: 'jeep', family: 'cherokee', year: 2023 }
    },
    {
      make: 'Kia', model: 'Sportage', trim: 'X-Pro', rating: 9.0,
      price: [34090, 38490],
      engine: '2.5L 187 hp', drive: 'AWD · llantas todo terreno', mpg: '~23/28 mpg',
      blurb: 'Mucho equipo por el dinero y garantía de 10 años/100k millas.',
      wiki: 'Kia Sportage', slug: ['kia', 'kia-sportage'],
      photoQuery: '2024 Kia Sportage',
      trims: ['LX', 'EX', 'SX', 'X-Line', 'X-Pro', 'Hybrid'],
      img: { make: 'kia', family: 'sportage', year: 2024 }
    },
    {
      make: 'Kia', model: 'Sorento', trim: 'X-Pro', rating: 8.5,
      price: [33100, 46500],
      engine: '2.5L 191 hp · 2.5T 281 hp · Híbrido 227 hp', drive: 'FWD/AWD', mpg: '~24/29 mpg',
      blurb: 'Tres filas de serie, versátil y con versión X-Pro más campera.',
      wiki: 'Kia Sorento', slug: ['kia', 'kia-sorento'],
      photoQuery: '2025 Kia Sorento',
      trims: ['LX', 'S', 'EX', 'SX', 'X-Line', 'X-Pro', 'Hybrid'],
      img: { make: 'kia', family: 'sorento', year: 2024 }
    },
    {
      make: 'Toyota', model: 'RAV4', trim: 'Woodland', rating: 8.9,
      price: [36000, 39000],
      engine: 'Híbrido 226 hp (toda la gama 2026)', drive: 'AWD', mpg: '~38-44 mpg',
      blurb: 'Fiabilidad y valor de reventa imbatibles; Woodland lista para el bosque.',
      wiki: 'Toyota RAV4', slug: ['toyota', 'toyota-rav4'],
      photoQuery: '2026 Toyota RAV4',
      trims: ['LE', 'XLE', 'SE', 'XSE', 'Limited', 'Woodland'],
      img: { make: 'toyota', family: 'rav4', year: 2024 }
    },
    {
      make: 'Hyundai', model: 'Tucson', trim: 'XRT', rating: 8.8,
      price: [34900, 37500],
      engine: '2.5L 187 hp', drive: 'AWD', mpg: '~24/30 mpg',
      blurb: 'Diseño llamativo, look aventurero y gran garantía.',
      wiki: 'Hyundai Tucson', slug: ['hyundai', 'hyundai-tucson'],
      photoQuery: '2025 Hyundai Tucson',
      trims: ['SE', 'SEL', 'XRT', 'Limited', 'Hybrid'],
      img: { make: 'hyundai', family: 'tucson', year: 2024 }
    },
    {
      make: 'Hyundai', model: 'Santa Fe', trim: 'XRT', rating: 8.6,
      price: [35400, 47000],
      engine: '2.5T 277 hp · Híbrido 231 hp', drive: 'FWD/AWD', mpg: '~24/28 mpg (híbrido ~36)',
      blurb: 'Rediseño 2024 con look todoterreno, 3 filas opcionales y mucho espacio.',
      wiki: 'Hyundai Santa Fe', slug: ['hyundai', 'hyundai-santa_fe'],
      photoQuery: '2025 Hyundai Santa Fe',
      trims: ['SE', 'SEL', 'XRT', 'Limited', 'Calligraphy', 'Hybrid'],
      img: { make: 'hyundai', family: 'santa-fe', year: 2024 }
    },
    {
      make: 'GMC', model: 'Terrain', trim: 'AT4', rating: 8.7, priority: 4,
      price: [36400, 41000],
      engine: '1.5T 175 hp', drive: 'AWD', mpg: '~24/29 mpg',
      blurb: 'Renovado 2026 con pantalla de 15" y modo todoterreno AT4.',
      wiki: 'GMC Terrain', slug: ['gmc', 'gmc-terrain'],
      photoQuery: '2025 GMC Terrain',
      trims: ['Elevation', 'AT4', 'Denali'],
      img: { make: 'gmc', family: 'terrain', year: 2024 }
    },
    {
      make: 'Nissan', model: 'Rogue', trim: 'Rock Creek', rating: 8.4,
      price: [34760, 37500],
      engine: '1.5T VC-Turbo 201 hp', drive: 'AWD · suspensión off-road', mpg: '~28/33 mpg',
      blurb: 'Cómodo, eficiente, y la versión Rock Creek le pone botas.',
      wiki: 'Nissan Rogue', slug: ['nissan', 'nissan-rogue'],
      photoQuery: '2025 Nissan Rogue',
      trims: ['S', 'SV', 'SL', 'Platinum', 'Rock Creek'],
      img: { make: 'nissan', family: 'rogue', year: 2024 }
    },
    {
      make: 'Honda', model: 'CR-V', trim: 'TrailSport', rating: 8.4, priority: 2,
      price: [38800, 41000],
      engine: 'Híbrido 204 hp', drive: 'AWD', mpg: '~40 mpg ciudad',
      blurb: 'La compra sensata de siempre, ahora con sabor aventurero e híbrido.',
      wiki: 'Honda CR-V', slug: ['honda', 'honda-cr_v'],
      photoQuery: '2025 Honda CR-V',
      trims: ['LX', 'EX', 'EX-L', 'Sport', 'Sport-L', 'Sport Touring', 'TrailSport'],
      img: { make: 'honda', family: 'cr-v', year: 2024 }
    },
    {
      make: 'Volkswagen', model: 'Tiguan', trim: '', rating: 8.3,
      price: [30930, 41000],
      engine: '2.0T 201 hp', drive: 'FWD/AWD', mpg: '~26/33 mpg',
      blurb: 'Nueva generación: más ligero, más equipado y con manejo europeo.',
      wiki: 'Volkswagen Tiguan', slug: ['volkswagen', 'volkswagen-tiguan'],
      photoQuery: '2025 Volkswagen Tiguan',
      trims: ['S', 'SE', 'SE R-Line Black', 'SEL R-Line'],
      img: { make: 'volkswagen', family: 'tiguan', year: 2024 }
    }
  ];

  /** Concesionarios reales cerca de Downtown Brooklyn (5 boroughs + NJ cercano). */
  var DEALERS = {
    Ford: [
      { n: 'Premier Ford (Brooklyn)', u: 'https://www.premierfordinc.com/' },
      { n: 'Bay Ridge Ford (Brooklyn)', u: 'https://www.bayridgeford.com/' },
      { n: 'Starks Ford (Queens)', u: 'https://www.starksfordofqueens.com/' },
      { n: 'Dana Ford (Staten Island)', u: 'https://www.drivedanaford.com/' },
      { n: 'Stevens Ford (Jersey City, NJ)', u: 'https://www.stevensjerseycityford.com/' }
    ],
    Mazda: [
      { n: 'Koeppel Mazda (Queens)', u: 'https://www.koeppelmazda.com/' },
      { n: 'Wayne Mazda (NJ)', u: 'https://www.waynemazda.com/' },
      { n: 'Garden State Mazda (NJ)', u: 'https://www.gardenstatemazda.com/' }
    ],
    Subaru: [
      { n: 'Bay Ridge Subaru (Brooklyn)', u: 'https://www.bayridgesubaru.com/' },
      { n: 'Premier Subaru (Queens/Bronx)', u: 'https://www.premiersubaru.com/' },
      { n: 'Liberty Subaru (Emerson, NJ)', u: 'https://www.libertysubaru.com/' }
    ],
    Jeep: [
      { n: 'Brooklyn CDJR (Brooklyn)', u: 'https://www.brooklynchrysler.com/' },
      { n: 'United CDJR (Brooklyn)', u: 'https://www.unitedcdjr.com/' },
      { n: 'Manhattan Jeep CDJR', u: 'https://www.manhattanjeep.com/' },
      { n: 'Island CDJR (Staten Island)', u: 'https://www.myislandcdjr.com/' },
      { n: 'Eastchester CJDR (Bronx)', u: 'https://www.eastchesterchryslerjeepdodgeram.com/' }
    ],
    Kia: [
      { n: 'Plaza Kia (Brooklyn)', u: 'https://www.plazakia.com/' },
      { n: 'Kings Kia (Brooklyn)', u: 'https://www.kingskia.com/' },
      { n: 'Inventario Kia cercano', u: cars('new', 'kia', 'kia-sportage') }
    ],
    Toyota: [
      { n: 'Plaza Toyota (Brooklyn)', u: 'https://www.plazatoyota.net/' },
      { n: 'Bay Ridge Toyota (Brooklyn)', u: 'https://www.bayridgetoyota.com/' },
      { n: 'Toyota of Manhattan', u: 'https://www.manhattantoyota.com/' },
      { n: 'Hudson Toyota (Jersey City)', u: 'https://www.hudsontoyota.com/' }
    ],
    Hyundai: [
      { n: 'Plaza Hyundai (Brooklyn)', u: 'https://www.plazahyundai.com/' },
      { n: 'Advantage Hyundai (LI)', u: 'https://www.advantagehyundai.com/' },
      { n: 'Lynnes Hyundai (Bloomfield, NJ)', u: 'https://www.lynneshyundai.com/' }
    ],
    GMC: [
      { n: 'Bical Buick GMC (Brooklyn)', u: 'https://www.bicalbuickgmc.com/' },
      { n: 'Island Buick GMC (Staten Island)', u: 'https://www.myislandgmc.com/' },
      { n: 'Milea Buick GMC (Bronx)', u: 'https://www.mileabuickgmc.com/' },
      { n: 'North Bergen Buick GMC (NJ)', u: 'https://www.northbergenbuickgmc.com/' }
    ],
    Nissan: [
      { n: 'Bay Ridge Nissan (Brooklyn)', u: 'https://www.bayridgenissan.com/' },
      { n: 'Nissan of Manhattan', u: 'https://www.nissanofmanhattan.com/' },
      { n: 'Garden State Nissan (NJ)', u: 'https://www.gardenstatenissan.com/' }
    ],
    Honda: [
      { n: 'Bay Ridge Honda (Brooklyn)', u: 'https://www.bayridgehonda.com/' },
      { n: 'Plaza Honda (Brooklyn)', u: 'https://www.plazahonda.com/' },
      { n: 'Paragon Honda (Queens)', u: 'https://www.paragonhonda.com/' },
      { n: 'Metro Honda (Jersey City)', u: 'https://www.metrohonda.com/' },
      { n: 'Garden State Honda (Clifton, NJ)', u: 'https://www.gardenstatehonda.com/' }
    ],
    Volkswagen: [
      { n: 'Bay Ridge VW (Brooklyn)', u: 'https://www.bayridgevw.com/' },
      { n: 'Palisades VW (NJ)', u: 'https://www.palisadesvw.com/' },
      { n: 'Inventario VW cercano', u: cars('new', 'volkswagen', 'volkswagen-tiguan') }
    ]
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
    'CR-V': 'honda/cr-v', 'Tiguan': 'volkswagen/tiguan',
    'Santa Fe': 'hyundai/santa-fe', 'Sorento': 'kia/sorento'
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
