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

  // --- Desglose del pago inicial (due at signing) ---
  var DOWN_PATTERNS = [
    new RegExp('(?:down\\s*payment|cash\\s*down|customer\\s*cash|cash\\s*(?:due|at\\s*signing)|cap(?:italized)?\\s*cost\\s*reduction|enganche)\\s*(?:of|:)?\\s*' + CUR + '?\\s*' + NUM, 'i'),
    new RegExp(CUR + '\\s*' + NUM + '\\s*(?:cash\\s+)?down\\b', 'i')
  ];
  var ACQ_PATTERNS = [
    new RegExp('(?:acquisition|bank|acq\\.?)\\s*fee\\s*(?:of|:)?\\s*' + CUR + '?\\s*' + NUM, 'i')
  ];
  var DEALER_FEE_PATTERNS = [
    new RegExp('(?:dealer|processing)\\s*(?:fee|charge)\\s*(?:of|:)?\\s*' + CUR + '?\\s*' + NUM, 'i')
  ];
  var DOC_FEE_PATTERNS = [
    new RegExp('(?:documentation|doc)\\s*fee\\s*(?:of|:)?\\s*' + CUR + '?\\s*' + NUM, 'i')
  ];
  var ACCESSORY_PATTERNS = [
    new RegExp('(?:mandatory|required)\\s+(?:accessor\\w+|add[- ]?ons?|equipment|package)\\s*(?:of|:)?\\s*' + CUR + '?\\s*' + NUM, 'i')
  ];
  var RESIDUAL_AMT_PATTERNS = [
    new RegExp('residual\\s*(?:value)?\\s*(?:of|:)?\\s*' + CUR + '\\s*' + NUM, 'i')
  ];

  /** Depósito de seguridad: 0 si "none/waived", número si hay importe, null si no se menciona. */
  function securityDeposit(text) {
    var t = String(text || '');
    if (/security\s+deposit[^.\n$]*\b(?:none|waived|no\b|\$?\s*0\b)/i.test(t)) return 0;
    var m = t.match(new RegExp('security\\s+deposit\\s*(?:of|:)?\\s*' + CUR + '?\\s*' + NUM, 'i'));
    return m ? parseAmount(m[1]) : null;
  }

  // Condiciones/restricciones de la oferta (se muestran SIEMPRE, no en letra pequeña).
  var COND_DEFS = [
    { key: 'loyalty', label: 'Requires Loyalty', re: /\bloyalty\b/i },
    { key: 'conquest', label: 'Requires Conquest', re: /\bconquest\b/i },
    { key: 'chargeup', label: 'Charge Up NJ', re: /charge\s*up\s*nj/i },
    { key: 'residents', label: 'NJ/NY residents only', re: /(?:nj|ny|new\s+jersey|new\s+york)\s+residents?\s+only/i },
    { key: 'toptier', label: 'Top-tier credit', re: /top[- ]?tier|well[- ]?qualified|tier\s*1\b|excellent\s+credit|800\+?\s*(?:fico|credit)/i },
    { key: 'finance', label: 'Must finance with dealer', re: /must\s+finance|finance\s+through|financing\s+required|when\s+financed/i },
    { key: 'tradein', label: 'Requires trade-in', re: /trade-?in\s+(?:required|assist)|must\s+trade/i },
    { key: 'military', label: 'Military / first responder', re: /\bmilitary\b|first\s+responder/i },
    { key: 'grad', label: 'College grad', re: /college\s+grad|recent\s+grad/i }
  ];
  /** Lista de condiciones detectadas en el texto de la oferta. */
  function conditions(text) {
    var t = String(text || '');
    return COND_DEFS.filter(function (c) { return c.re.test(t); })
      .map(function (c) { return { key: c.key, label: c.label }; });
  }

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
      residualAmount: firstMatch(block, RESIDUAL_AMT_PATTERNS),
      moneyFactor: firstMatch(block, MF_PATTERNS),
      apr: firstMatch(block, APR_PATTERNS),
      downPayment: firstMatch(block, DOWN_PATTERNS),
      acqFee: firstMatch(block, ACQ_PATTERNS),
      dealerFee: firstMatch(block, DEALER_FEE_PATTERNS),
      docFee: firstMatch(block, DOC_FEE_PATTERNS),
      accessories: firstMatch(block, ACCESSORY_PATTERNS),
      securityDeposit: securityDeposit(block),
      conditions: conditions(block),
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
    offers = offers.filter(function (o) {
      if (o.name) return true;
      return !offers.some(function (other) {
        return other.name && other.monthly === o.monthly && other.term === o.term;
      });
    });

    // Atribución del modelo (páginas de concesionario: un título de modelo y
    // debajo varias filas de precio con nombre genérico/basura). Si el nombre
    // de la oferta NO identifica la marca, hereda el encabezado de modelo más
    // cercano hacia arriba. Se hace DESPUÉS del dedup para no revivir los
    // resúmenes anónimos ya descartados.
    offers.forEach(function (o) {
      if (LOOSE_MAKES.test(o.name || '')) return;
      var idx = parsed.indexOf(o);
      for (var j = idx; j >= 0; j--) {
        var head = (j < idx ? vehicleHeading(parsed[j].name || '') : null) ||
          lastVehicleHeading(parsed[j].raw || '');
        if (head) { o.name = head; break; }
      }
    });
    return offers;
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

  // Marcas conocidas: una línea que las menciona es casi seguro el encabezado
  // del modelo (no letra pequeña). Sirve para atribuir el modelo en páginas de
  // concesionario donde un título va seguido de varias filas de precio.
  var LOOSE_MAKES = /\b(honda|toyota|ford|gmc|hyundai|kia|mazda|subaru|nissan|jeep|volkswagen|vw|chevrolet|chevy|buick|bmw|acura|lexus|audi|volvo|dodge|ram|chrysler|cadillac|infiniti|mitsubishi|genesis)\b/i;
  // Letra pequeña/legal que MENCIONA una marca pero NO es el título del modelo
  // (p. ej. "financing through VW Credit", "Toyota Financial Services").
  var HEADING_BOILERPLATE = /financ|\bcredit\b|qualif|\bapr\b|lease options|not responsible|stock photo|excludes|acquisition|security deposit|due at signing|per month|\/mo\b|\bmsrp\b|see dealer|dealer for|\btier\b|approved|lessee|copyright|through \w+ (credit|financial)/i;
  function vehicleHeading(line) {
    var c = nameCandidate(line);
    if (!c || !LOOSE_MAKES.test(c) || HEADING_BOILERPLATE.test(c)) return null;
    return c;
  }
  /**
   * Mejor encabezado de modelo dentro de un texto: prefiere títulos tipo
   * "Volkswagen Tiguan Lease Deals" o con año, sobre menciones sueltas; a
   * igualdad, el más cercano al precio (el último).
   */
  function lastVehicleHeading(text) {
    var lines = String(text || '').split('\n');
    var best = null, bestScore = -1;
    for (var i = 0; i < lines.length; i++) {
      var v = vehicleHeading(lines[i]);
      if (!v) continue;
      var score = 0;
      if (/lease|deal|special/i.test(v)) score += 3;
      if (/\b20\d{2}\b/.test(v)) score += 2;
      if (v.search(LOOSE_MAKES) < 20) score += 1;
      if (score >= bestScore) { bestScore = score; best = v; } // >= : gana el más reciente en empate
    }
    return best;
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
    var carryName = null; // último encabezado de modelo visto (se arrastra hacia abajo)
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
      // Atribución del modelo: en las webs de concesionario el título del
      // modelo aparece UNA vez y debajo van varias filas de precio. Busca un
      // encabezado con marca en TODO el hueco desde la oferta anterior; si esta
      // fila no trae encabezado, hereda el último visto. Así el modelo (Tiguan,
      // Rogue, RAV4…) no se pierde y la oferta no se descarta por no atribuirse.
      var gap = text.slice(i > 0 ? matches[i - 1].end : 0, mt.index);
      var veh = lastVehicleHeading(gap);
      if (veh) carryName = veh;
      parsed.name = veh || carryName || pickNameNear(backward) || parsed.name;
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
        totalCost: null, effectiveMonthly: null, pctOfMsrp: null, score: null,
        oneTimeCosts: oneTimeCosts(p, null), dealScore: null
      };
    }
    var das = p.dueAtSigning == null ? 0 : p.dueAtSigning;
    // das ≥ mensualidad → asumimos que ya incluye el primer mes.
    var total = das >= monthly ? das + monthly * (term - 1) : das + monthly * term;
    var effective = total / term;
    var hasMsrp = p.msrp != null && p.msrp > 0;
    var pct = hasMsrp ? (effective / p.msrp) * 100 : null;
    return {
      term: term,
      monthlyPayment: monthly,
      driveOff: das,
      totalCost: total,
      effectiveMonthly: effective,
      pctOfMsrp: pct,
      score: hasMsrp ? p.msrp / (effective * 12) : null,
      oneTimeCosts: oneTimeCosts(p, monthly),
      dealScore: dealScore(pct)
    };
  }

  /**
   * Coste único al firmar: suma de lo que sale del bolsillo el día 1
   * (entrada + comisiones + primer pago + depósito + accesorios). Si no hay
   * desglose pero sí un total "due at signing", usa ese total.
   */
  function oneTimeCosts(p, monthly) {
    p = p || {};
    var comps = [p.downPayment, p.acqFee, p.dealerFee, p.docFee, p.accessories,
      (p.securityDeposit && p.securityDeposit > 0) ? p.securityDeposit : null];
    if (monthly && monthly > 0) comps.push(monthly); // primer pago
    var sum = 0, any = false;
    comps.forEach(function (v) { if (typeof v === 'number' && isFinite(v) && v > 0) { sum += v; any = true; } });
    if (any) return Math.round(sum);
    if (p.dueAtSigning && p.dueAtSigning > 0) return Math.round(p.dueAtSigning); // respaldo: total
    return null;
  }

  /**
   * Deal Score 0–100 a partir del efectivo/mes como % del MSRP (más bajo =
   * mejor). Sirve para comparar/ordenar, NO para "castigar": un buen mensual
   * puntúa alto aunque pida bastante al firmar. Sin MSRP → null.
   */
  function dealScore(pctOfMsrp) {
    if (pctOfMsrp == null || !isFinite(pctOfMsrp)) return null;
    var s = 100 - (pctOfMsrp - 0.6) * 55; // 0.6%→100, 1%→78, 1.5%→50, 2%→23
    return Math.max(1, Math.min(100, Math.round(s)));
  }

  /**
   * Transparencia de la oferta: ¿cuánta información de coste revela el anuncio?
   * NO cambia la puntuación del deal — solo ayuda a distinguir quién juega
   * limpio (desglosa entrada, due at signing, residual y millas) de quien solo
   * anuncia "$169/mes" y esconde miles en costes iniciales.
   *
   *   🟢 high  desglosa los pagos iniciales + due at signing + residual + millas
   *   🟡 mid   se entiende el coste, pero falta desglose o algún dato clave
   *   🔴 low   solo el mensual; oculta el coste de entrada
   *
   * Devuelve { level, score(0–100), disclosed[], missing[] }.
   */
  function transparency(p) {
    p = p || {};
    function hasNum(v) { return typeof v === 'number' && isFinite(v); }
    var upfrontKnown = hasNum(p.dueAtSigning) || hasNum(p.downPayment);
    var feeCount = ['acqFee', 'dealerFee', 'docFee'].filter(function (k) { return hasNum(p[k]); }).length;
    var itemized = (hasNum(p.downPayment) && (feeCount >= 1 || p.securityDeposit != null)) || feeCount >= 2;
    var milesKnown = hasNum(p.milesPerYear);
    var residualKnown = hasNum(p.residualAmount) || hasNum(p.residualPct);
    var msrpKnown = hasNum(p.msrp);
    var termKnown = hasNum(p.term);

    var checks = [
      { ok: termKnown, label: 'Plazo del lease' },
      { ok: upfrontKnown, label: 'Coste de entrada (due at signing)' },
      { ok: itemized, label: 'Pagos iniciales desglosados' },
      { ok: milesKnown, label: 'Millas por año' },
      { ok: residualKnown, label: 'Valor residual' },
      { ok: msrpKnown, label: 'MSRP' }
    ];
    var disclosed = checks.filter(function (c) { return c.ok; });
    var score = Math.round(disclosed.length / checks.length * 100);

    var level;
    if (!upfrontKnown) level = 'low';                                 // esconde el coste de entrada
    else if (itemized && milesKnown && residualKnown) level = 'high'; // lo enseña todo
    else if (disclosed.length >= 3) level = 'mid';
    else level = 'low';

    return {
      level: level,
      score: score,
      disclosed: disclosed.map(function (c) { return c.label; }),
      missing: checks.filter(function (c) { return !c.ok; }).map(function (c) { return c.label; })
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
    conditions: conditions,
    securityDeposit: securityDeposit,
    oneTimeCosts: oneTimeCosts,
    dealScore: dealScore,
    transparency: transparency,
    looksLikeFinancing: looksLikeFinancing,
    htmlToText: htmlToText,
    splitBlocks: splitBlocks
  };
});
