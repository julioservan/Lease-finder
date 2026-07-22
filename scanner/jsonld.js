/**
 * Extractor de datos estructurados JSON-LD (schema.org) de webs de
 * concesionarios. Las 4 grandes plataformas de webs de dealers (Dealer.com,
 * DealerInspire, DealerOn, CDK) incrustan el inventario y las promociones
 * como <script type="application/ld+json"> — mucho más fiable que rascar el
 * HTML renderizado, y disponible aunque la maquetación cambie.
 *
 * Da dos cosas:
 *  - vehicles(html):  vehículos del inventario (VIN, precio, condición…)
 *  - offerTexts(html): textos de ofertas/promos (se pasan al OfferParser
 *    por si contienen términos de lease: "$299/mo, 36 months…")
 */
'use strict';

var SCRIPT_RE = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/** Todos los bloques JSON-LD parseados de un HTML (tolerante a errores). */
function extractBlocks(html) {
  var out = [];
  var m;
  SCRIPT_RE.lastIndex = 0;
  while ((m = SCRIPT_RE.exec(String(html || ''))) !== null) {
    var raw = m[1].trim();
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw));
    } catch (e) {
      // Algunos sitios meten caracteres de control sin escapar: reintento suave.
      try { out.push(JSON.parse(raw.replace(/[\u0000-\u001f]/g, ' '))); }
      catch (e2) { /* bloque ilegible: ignorar */ }
    }
  }
  return out;
}

/** Aplana @graph / arrays / listas anidadas en una lista de nodos con @type. */
function flatten(node, out, depth) {
  out = out || [];
  depth = depth || 0;
  if (!node || depth > 6) return out;
  if (Array.isArray(node)) {
    node.forEach(function (n) { flatten(n, out, depth + 1); });
    return out;
  }
  if (typeof node !== 'object') return out;
  if (node['@type']) out.push(node);
  ['@graph', 'itemListElement', 'mainEntity', 'item', 'offers', 'itemOffered'].forEach(function (k) {
    if (node[k]) flatten(node[k], out, depth + 1);
  });
  return out;
}

function allNodes(html) {
  var nodes = [];
  extractBlocks(html).forEach(function (b) { flatten(b, nodes); });
  return nodes;
}

function typeOf(node) {
  var t = node['@type'];
  if (Array.isArray(t)) t = t.join(' ');
  return String(t || '').toLowerCase();
}

function asNumber(v) {
  if (v == null) return null;
  var n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
  return isFinite(n) && n > 0 ? n : null;
}

function brandName(v) {
  var b = v.brand || v.manufacturer;
  if (!b) return null;
  if (typeof b === 'string') return b;
  return b.name || null;
}

function firstOffer(v) {
  var o = v.offers;
  if (Array.isArray(o)) o = o[0];
  return o && typeof o === 'object' ? o : null;
}

function offerPrice(v) {
  var o = firstOffer(v);
  if (!o) return asNumber(v.price);
  var p = asNumber(o.price);
  if (p == null && o.priceSpecification) p = asNumber(o.priceSpecification.price);
  return p;
}

function conditionOf(v) {
  var c = String(v.itemCondition || '').toLowerCase();
  var name = String(v.name || '');
  if (/certified|cpo/i.test(name) || /certified/.test(c)) return 'cpo';
  if (/newcondition/.test(c) || /^new\b/i.test(name)) return 'new';
  if (/usedcondition/.test(c) || /^(used|pre-?owned)\b/i.test(name)) return 'used';
  return null;
}

function yearOf(v) {
  var y = asNumber(v.vehicleModelDate || v.modelDate || v.productionDate);
  if (y && y > 1990 && y < 2100) return Math.round(y);
  var m = String(v.name || '').match(/\b(20\d{2})\b/);
  return m ? parseInt(m[1], 10) : null;
}

/** ¿Este nodo describe un vehículo del inventario? */
function isVehicle(node) {
  var t = typeOf(node);
  if (/vehicle|(^|\s|,)car(\s|,|$)/.test(t)) return true;
  // Algunos sitios usan Product para coches: exigir señal de vehículo.
  if (/product/.test(t) && (node.vehicleIdentificationNumber || node.vin)) return true;
  return false;
}

/** Vehículos normalizados encontrados en el JSON-LD de una página. */
function vehicles(html) {
  var seen = {};
  var out = [];
  allNodes(html).forEach(function (n) {
    if (!isVehicle(n)) return;
    var vin = String(n.vehicleIdentificationNumber || n.vin || '').toUpperCase() || null;
    var key = vin || (n.name || '') + '|' + (offerPrice(n) || '');
    if (!key || seen[key]) return; // dedupe por VIN (o por nombre+precio)
    seen[key] = true;
    out.push({
      name: n.name || null,
      vin: vin,
      make: brandName(n),
      model: n.model && n.model.name ? n.model.name : (typeof n.model === 'string' ? n.model : null),
      trim: n.vehicleConfiguration || n.trim || null,
      year: yearOf(n),
      price: offerPrice(n),
      msrp: asNumber(n.msrp) || null,
      condition: conditionOf(n),
      drivetrain: n.driveWheelConfiguration || null,
      miles: n.mileageFromOdometer ? asNumber(n.mileageFromOdometer.value != null ? n.mileageFromOdometer.value : n.mileageFromOdometer) : null,
      color: n.color || null,
      image: typeof n.image === 'string' ? n.image : (Array.isArray(n.image) ? n.image[0] : null),
      url: n.url || null
    });
  });
  return out;
}

/**
 * Textos de ofertas/promociones del JSON-LD (nombre + descripción +
 * letra pequeña). Se devuelven como bloques de texto para pasarlos por el
 * OfferParser: si la promo es un lease, ahí suele estar la mensualidad.
 */
function offerTexts(html) {
  var out = [];
  allNodes(html).forEach(function (n) {
    var t = typeOf(n);
    if (!/offer|specialannouncement|event|promotion/.test(t) && !isVehicle(n)) return;
    var bits = [n.name, n.description, n.disclaimer, n.text]
      .filter(function (x) { return typeof x === 'string' && x.length > 0; });
    var txt = bits.join('\n').trim();
    // Solo interesa si menciona una mensualidad (señal de lease/promo).
    if (txt && /(\/|per\s+|al\s+|por\s+)(mo|month|mes)\b|month(ly)?\s+payment|mensualidad/i.test(txt)) {
      out.push(txt);
    }
  });
  return out;
}

module.exports = {
  extractBlocks: extractBlocks,
  vehicles: vehicles,
  offerTexts: offerTexts
};
