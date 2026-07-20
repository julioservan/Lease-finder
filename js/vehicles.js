/**
 * Catálogo de marcas y modelos para los selectores de la app.
 * Enfocado en SUVs compactos/medianos (el segmento de interés) más algunas
 * opciones comunes. Edita libremente: agrega marcas, modelos o versiones.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.VehicleCatalog = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return {
    'Jeep': ['Cherokee', 'Grand Cherokee', 'Compass', 'Renegade', 'Wrangler', 'Gladiator'],
    'Ford': ['Bronco Sport', 'Bronco', 'Escape', 'Edge', 'Explorer', 'Maverick', 'F-150'],
    'Mazda': ['CX-30', 'CX-5', 'CX-50', 'CX-70', 'CX-90', 'Mazda3'],
    'Toyota': ['RAV4', 'Corolla Cross', 'Highlander', '4Runner', 'Tacoma', 'Camry', 'Corolla'],
    'Honda': ['CR-V', 'HR-V', 'Pilot', 'Passport', 'Civic', 'Accord'],
    'Subaru': ['Crosstrek', 'Forester', 'Outback', 'Ascent'],
    'Hyundai': ['Tucson', 'Santa Fe', 'Kona', 'Santa Cruz', 'Palisade', 'Elantra'],
    'Kia': ['Sportage', 'Sorento', 'Seltos', 'Telluride', 'Niro', 'K4'],
    'Nissan': ['Rogue', 'Kicks', 'Murano', 'Pathfinder', 'Frontier', 'Altima'],
    'Chevrolet': ['Equinox', 'Trailblazer', 'Blazer', 'Traverse', 'Colorado', 'Silverado'],
    'Volkswagen': ['Tiguan', 'Taos', 'Atlas', 'Atlas Cross Sport', 'Jetta'],
    'BMW': ['X1', 'X3', 'X5', 'i4', 'Serie 3'],
    'Tesla': ['Model 3', 'Model Y'],
    'Otra': []
  };
});
