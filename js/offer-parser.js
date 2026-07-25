/**
 * Escáner de ofertas: extrae los datos de un lease a partir de texto libre
 * (anuncios pegados de correos, WhatsApp, portales o páginas HTML).
 *
 * Reconoce patrones en español e inglés:
 *   - mensualidad:  "$399/mes", "399 al mes", "$450/mo + tax", "mensualidad de $8,499"
 *   - plazo:        "36 meses", "36-month", "plazo de 24"
 *   - pago inicial: "$3,500 due at signing", "$25,000 de enganche", "sign and drive"
 *   - MSRP:         "MSRP $57,900", "precio de lista $749,900"
 *   - km/millas:    "10,000 millas por año", "20.000 km al año"
 *   - residual, money factor y TAE si el anuncio los menciona
 *
 * Puntuación de una oferta escaneada (sin residual/MF, solo con los números
 * publicados): si el pago inicial parece incluir el primer mes (inicial ≥
 * mensualidad) el costo total = inicial + mensualidad × (plazo − 1); si es un
 * enganche puro o $0, costo total = inicial + mensualidad × plazo.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.OfferParser = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var NUM = '([\\d.,]+k?)';
  var CUR = '(?:\\$|€|£)';

  var MONTHLY_PATTERNS = [
    // "$399/mes", "$450 + tax /mo", "$399 mo"
    new RegExp(CUR + '\\s*' + NUM + '\\s*(?:\\+\\s*(?:tax|iva|impuestos)\\s*)?\\/?\\s*(?:mes|month|mo)\\b', 'i'),
    // "399 al mes", "399 + tax per month", "399/mo"
    new RegExp(NUM + '\\s*(?:\\+\\s*(?:tax|iva|impuestos)\\s*)?(?:\\/|al\\s+|por\\s+|per\\s+)\\s*(?:mes|month|mo)\\b', 'i'),
    // "mensualidad de $8,499", "pago mensual: 7,999", "renta mensual de 9,500"
    new RegExp('(?:mensualidad(?:es)?|(?:pago|renta)\\s+mensual)\\s*(?:de|:)?\\s*' + CUR + '?\\s*' + NUM, 'i'),
    // "399 mensuales"
    new RegExp(CUR + '?\\s*' + NUM + '\\s+mensuales\\b', 'i')
  ];

  var TERM_PATTERNS = [
    /(\d{2,3})\s*-?\s*(?:meses\b|months?\b|mos\b)/i,
    /(?:plazo|term)\s*(?:de|of|:)?\s*(\d{2,3})/i
  ];

  var ZERO_DOWN = /(?:sin\s+enganche|cero\s+enganche|zero\s+down|\$0\s+down|sign\s*(?:&|and)\s*drive)/i;

  var DAS_PATTERNS = [
    // "$3,500 due at signing", "$25,000 de enganche", "3000 down"
    new RegExp(CUR + '?\\s*' + NUM + '\\s*(?:de\\s+)?(?:enganche|de\\s+inicial|down\\b|due\\s+at\\s+signing|drive[- ]?off|al\\s+firmar)', 'i'),
    // "enganche de $25,000", "due at signing: $3,500", "pago inicial de 30,000"
    new RegExp('(?:enganche|pago\\s+inicial|down\\s+payment|due\\s+at\\s+signing|drive[- ]?off|al\\s+firmar)\\s*(?:de|of|:)?\\s*' + CUR + '?\\s*' + NUM, 'i')
  ];

  var MSRP_PATTERNS = [
    new RegExp('(?:msrp|precio\\s+de\\s+lista|p\\.?v\\.?p\\.?)\\s*(?:de|:)?\\s*' + CUR + '?\\s*' + NUM, 'i')
  ];

  var PRICE_PATTERNS = [
    new RegExp('(?:selling\\s+price|sale\\s+price|precio\\s+(?:de\\s+venta|negociado|final))\\s*(?:de|:)?\\s*' + CUR + '?\\s*' + NUM, 'i')
  ];

  var MILES_PATTERNS = [
    // "10,000 millas por año", "12k miles/yr", "20.000 km al año"
    new RegExp(NUM + '\\s*(?:millas|miles|mi|km|kil[oó]metros)\\s*(?:\\/|\\s*(?:per|por|al)\\s*)(?:año|year|yr)', 'i'),
    // "10,000 millas anuales", "12,000 miles annually"
    new RegExp(NUM + '\\s*(?:millas|miles|mi|km)\\s+(?:anuales|annually)', 'i')
  ];

  var RESIDUAL_PATTERNS = [
    /residual\s*(?:de|:)?\s*([\d.,]+)\s*%/i,
    /([\d.,]+)\s*%\s*(?:de\s+)?residual/i
  ];

  var MF_PATTERNS = [
    /(?:money\s*factor|\bmf\b)\s*(?:de|:)?\s*(0?\.\d+)/i
  ];

  var APR_PATTERNS = [
    /(?:apr|tae|inter[eé]s)\s*(?:de|:)?\s*([\d.,]+)\s*%/i,
    /([\d.,]+)\s*%\s*(?:apr|tae)/i
  ];

  /** Convierte "45,000", "45.000", "1.234,56", "$399", "10k" → número. */
  function parseAmount(raw) {
    if (raw == null) return null;
    var s = String(raw).trim().toLowerCase().replace(/[$€£]/g, '').trim();
    var mult = 1;
    if (/k$/.test(s)) { mult = 1000; s = s.slice(0, -1); }
    s = s.replace(/\s/g, '').replace(/[.,]+$/, '');
    var lastComma = s.lastIndexOf(',');
    var lastDot = s.lastIndexOf('.');
    if (lastComma >= 0 && lastDot >= 0) {
      if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (lastComma >= 0) {
      var decC = s.length - lastComma - 1;
      s = (decC === 3 && s.length > 4) || s.split(',').length > 2
        ? s.replace(/,/g, '')
        : s.replace(',', '.');
    } else if (lastDot >= 0) {
      var decD = s.length - lastDot - 1;
      if ((decD === 3 && s.length > 4) || s.split('.').length > 2) s = s.replace(/\./g, '');
    }
    var n = parseFloat(s);
    return isFinite(n) ? n * mult : null;
  }

  function firstMatch(text, patterns) {
    for (var i = 0; i < patterns.length; i++) {
      var m = text.match(patterns[i]);
      if (m) return parseAmount(m[1]);
    }
    return null;
  }

  function nameCandidate(line) {
    line = line.replace(/^[\s>*•\-–—#]+/, '').trim();
    if (!line) return null;
    var letters = (line.match(/[a-záéíóúñü]/gi) || []).length;
    return letters >= 3 && line.length <= 90 && !looksLikeData(line) ? line.slice(0, 70) : null;
  }

  /**
   * El nombre suele ser la línea inmediatamente anterior a la mensualidad
   * (así no se cuela el título de la página u otra basura del encabezado).
   */
  function pickName(block) {
    var lines = block.split('\n');
    var monthlyIdx = -1;
    outer:
    for (var i = 0; i < lines.length; i++) {
      for (var j = 0; j < MONTHLY_PATTERNS.length; j++) {
        if (MONTHLY_PATTERNS[j].test(lines[i])) { monthlyIdx = i; break outer; }
      }
    }
    for (var k = (monthlyIdx >= 0 ? monthlyIdx - 1 : lines.length - 1); k >= 0; k--) {
      var above = nameCandidate(lines[k]);
      if (above) return above;
    }
    for (var l = 0; l < lines.length; l++) {
      var first = nameCandidate(lines[l]);
      if (first) return first;
    }
    return null;
  }

  /**
   * Busca un VIN (17 caracteres, sin I/O/Q) en el texto. Exige al menos un
   * dígito para no confundirlo con palabras de 17 letras. Devuelve el primero.
   */
  function findVin(text) {
    var re = /\b[A-HJ-NPR-Z0-9]{17}\b/gi;
    var s = String(text || ''), m;
    while ((m = re.exec(s)) !== null) {
      var v = m[0].toUpperCase();
      if (/[0-9]/.test(v) && /[A-Z]/.test(v)) return v; // VIN real: mezcla letras y números
    }
    return null;
  }

  /** Extrae los datos de UNA oferta a partir de un bloque de texto. */
  function parseBlock(block) {
    var das = ZERO_DOWN.test(block) ? 0 : firstMatch(block, DAS_PATTERNS);
    return {
      name: pickName(block),
      monthly: firstMatch(block, MONTHLY_PATTERNS),
      term: firstMatch(block, TERM_PATTERNS),
      dueAtSigning: das,
      msrp: firstMatch(block, MSRP_PATTERNS),
      price: firstMatch(block, PRICE_PATTERNS),
      milesPerYear: firstMatch(block, MILES_PATTERNS),
      residualPct: firstMatch(block, RESIDUAL_PATTERNS),
      moneyFactor: firstMatch(block, MF_PATTERNS),
      apr: firstMatch(block, APR_PATTERNS),
      vin: findVin(block),
      raw: block.trim()
    };
  }

  function hasData(p) {
    return p.monthly != null || p.msrp != null || p.dueAtSigning != null;
  }

  /** Divide el texto en bloques por líneas de --- / === o 2+ líneas en blanco. */
  function splitBlocks(text) {
    return String(text || '')
      .split(/\n[ \t]*[-=_*]{3,}[ \t]*\n|\n(?:[ \t]*\n){2,}/)
      .map(function (b) { return b.trim(); })
      .filter(Boolean);
  }

  var YEAR = /\b(?:19|20)\d{2}\b/;

  /** Escanea texto con separadores explícitos entre ofertas. */
  function parseOffers(text) {
    var parsed = splitBlocks(text).map(parseBlock);

    // En páginas de agencias el nombre del vehículo suele venir en un bloque
    // propio ("2026 Honda Odyssey FWD EX-L") antes del bloque con la oferta:
    // heredarlo cuando el bloque con datos no trae nombre. Solo se aceptan
    // nombres con año para no confundir encabezados genéricos con vehículos.
    parsed.forEach(function (p, i) {
      if (!hasData(p) || p.name) return;
      for (var j = i - 1; j >= 0 && j >= i - 6; j--) {
        if (parsed[j].monthly != null) break; // no cruzar otra oferta
        var candidate = parsed[j].name;
        if (candidate && YEAR.test(candidate)) { p.name = candidate; break; }
      }
    });

    var offers = parsed.filter(hasData);

    // El mismo pago suele repetirse en el resumen ("36 mos. $429/mo") sin
    // nombre: descartar los anónimos que duplican una oferta ya nombrada.
    return offers.filter(function (o) {
      if (o.name) return true;
      return !offers.some(function (other) {
        return other.name && other.monthly === o.monthly && other.term === o.term;
      });
    });
  }

  function looksLikeData(line) {
    var groups = [MONTHLY_PATTERNS, DAS_PATTERNS, MSRP_PATTERNS, TERM_PATTERNS, MILES_PATTERNS];
    for (var g = 0; g < groups.length; g++) {
      for (var i = 0; i < groups[g].length; i++) {
        if (groups[g][i].test(line)) return true;
      }
    }
    return false;
  }

  /** Busca el nombre en el texto previo a la mensualidad (la línea más cercana). */
  function pickNameNear(backward) {
    var lines = backward.split('\n');
    for (var i = lines.length - 1; i >= 0; i--) {
      var candidate = nameCandidate(lines[i]);
      if (candidate) return candidate;
    }
    return null;
  }

  /**
   * Escaneo "suelto" para páginas largas (HTML convertido a texto) sin
   * separadores: cada mención de mensualidad abre un segmento. Los demás
   * datos (inicial, plazo, MSRP…) se buscan hacia ADELANTE hasta la
   * siguiente oferta —en los anuncios suelen ir después del precio— y el
   * nombre hacia atrás, sin invadir la oferta anterior.
   */
  function scanLoose(text, windowSize) {
    text = String(text || '');
    var win = windowSize || 450;
    var finder = new RegExp(
      CUR + '\\s*[\\d.,]+k?\\s*(?:\\+\\s*(?:tax|iva|impuestos)\\s*)?\\/?\\s*(?:mes|month|mo)\\b' +
      '|[\\d.,]+k?\\s*(?:\\/|al\\s+|por\\s+|per\\s+)\\s*(?:mes|month|mo)\\b' +
      '|(?:mensualidad(?:es)?|(?:pago|renta)\\s+mensual)\\s*(?:de|:)?\\s*' + CUR + '?\\s*[\\d.,]+k?',
      'gi'
    );
    var matches = [];
    var m;
    while ((m = finder.exec(text)) !== null) {
      matches.push({ index: m.index, end: m.index + m[0].length });
      if (m.index === finder.lastIndex) finder.lastIndex++;
    }

    var results = [];
    var seen = {};
    var MERGE_KEYS = ['dueAtSigning', 'msrp', 'price', 'term', 'milesPerYear', 'residualPct', 'moneyFactor', 'apr'];

    matches.forEach(function (mt, i) {
      var fwdEnd = i < matches.length - 1 ? matches[i + 1].index : Math.min(text.length, mt.end + win);
      var forward = text.slice(mt.index, fwdEnd);
      var backStart = Math.max(i > 0 ? matches[i - 1].end : 0, mt.index - Math.min(win, 250));
      var backward = text.slice(backStart, mt.index);

      var parsed = parseBlock(forward);
      if (parsed.monthly == null) return;
      // Campos que el anuncio pone antes del precio (ej. "con $25,000 de
      // enganche, mensualidad de..."): complétalos desde el texto previo.
      var back = parseBlock(backward);
      MERGE_KEYS.forEach(function (k) {
        if (parsed[k] == null && back[k] != null) parsed[k] = back[k];
      });
      parsed.name = pickNameNear(backward) || parsed.name;
      if (parsed.vin == null) parsed.vin = findVin(backward); // el VIN suele ir antes del precio
      parsed.raw = (backward + forward).trim();

      var key = [parsed.monthly, parsed.term, parsed.dueAtSigning, parsed.msrp].join('|');
      if (seen[key]) return;
      seen[key] = true;
      results.push(parsed);
    });
    return results;
  }

  /**
   * Escaneo general: usa los separadores explícitos y, si el texto parece
   * una página larga con varias ofertas sin separar, cae al escaneo suelto.
   */
  /**
   * ¿El texto es una estimación de FINANCIACIÓN/compra en vez de un lease?
   * Los agregadores (p. ej. CarsDirect) muestran una calculadora de préstamo
   * ("Payment Estimate $X per month … Total cost: $Y for the [coche]") cuya
   * mensualidad NO es un lease (amortiza el coche entero, ~2% del MSRP/mes).
   * Esas colaban como si fueran leases carísimos; aquí se descartan.
   */
  function looksLikeFinancing(raw) {
    var t = String(raw || '').toLowerCase();
    if (/payment estimate/.test(t) && /(total cost|calculate payment)/.test(t)) return true;
    if (/total cost:\s*\$[\d,]+\s+for the\b/.test(t)) return true;
    var mm = t.match(/based on\s+(\d+)[- ]month/); // plazo de préstamo (leases < 60m)
    if (mm && parseInt(mm[1], 10) >= 60) return true;
    return false;
  }

  function scanText(text) {
    var byBlocks = parseOffers(text);
    var result = byBlocks;
    if (byBlocks.length <= 1) {
      var loose = scanLoose(text);
      if (loose.length > byBlocks.length) result = loose;
    }
    return result.filter(function (o) { return !looksLikeFinancing(o.raw); });
  }

  /** Métricas comparables (mismas columnas que la calculadora). */
  function scoreOffer(p) {
    p = p || {};
    var term = p.term && p.term > 0 ? Math.round(p.term) : 36;
    var monthly = p.monthly;
    if (monthly == null || monthly <= 0) {
      return {
        term: term, monthlyPayment: monthly, driveOff: p.dueAtSigning,
        totalCost: null, effectiveMonthly: null, pctOfMsrp: null, score: null
      };
    }
    var das = p.dueAtSigning == null ? 0 : p.dueAtSigning;
    // das ≥ mensualidad → asumimos que ya incluye el primer mes.
    var total = das >= monthly ? das + monthly * (term - 1) : das + monthly * term;
    var effective = total / term;
    var hasMsrp = p.msrp != null && p.msrp > 0;
    return {
      term: term,
      monthlyPayment: monthly,
      driveOff: das,
      totalCost: total,
      effectiveMonthly: effective,
      pctOfMsrp: hasMsrp ? (effective / p.msrp) * 100 : null,
      score: hasMsrp ? p.msrp / (effective * 12) : null
    };
  }

  /** Convierte HTML a texto plano para poder escanearlo. */
  function htmlToText(html) {
    return String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&#?\w+;/g, ' ')
      .replace(/[ \t]+/g, ' ');
  }

  return {
    parseAmount: parseAmount,
    parseBlock: parseBlock,
    parseOffers: parseOffers,
    scanLoose: scanLoose,
    scanText: scanText,
    scoreOffer: scoreOffer,
    findVin: findVin,
    looksLikeFinancing: looksLikeFinancing,
    htmlToText: htmlToText,
    splitBlocks: splitBlocks
  };
});
