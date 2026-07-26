/**
 * Función serverless (Vercel): consulta PROGRAMAS DE LEASE del fabricante
 * (incentivos OEM) vía la API de MarketCheck, sin exponer la clave en la
 * página. Sirve de "benchmark" para los modelos cuyos concesionarios bloquean
 * el scraping (403): el fabricante publica residual, money factor, lease cash
 * y plazo por zona, y con eso calculamos una mensualidad estimada.
 *
 * Configuración (una vez, en Vercel → proyecto lease-finder → Settings →
 * Environment Variables):
 *   MARKETCHECK_API_KEY   clave de https://www.marketcheck.com/apis
 *   (el plan debe incluir "Incentives"/OEM lease programs)
 *
 * Uso desde la app:  GET /api/incentives?make=Toyota&model=RAV4&zip=11201
 *   &debug=1  → añade la primera respuesta cruda para afinar el mapeo de campos.
 *
 * IMPORTANTE: la clave NUNCA se commitea (repo público). Solo vive en Vercel.
 */
'use strict';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://julioservan.github.io');
  if (req.method === 'OPTIONS') return res.status(204).end();

  var q = req.query || {};
  var make = (q.make || '').toString().trim();
  var model = (q.model || '').toString().trim();
  var zip = (q.zip || '11201').toString().trim();
  var year = (q.year || '').toString().trim();
  var debug = q.debug === '1' || q.debug === 'true';
  if (!make || !model) {
    return res.status(400).json({ ok: false, message: 'Faltan make y model.' });
  }

  var key = process.env.MARKETCHECK_API_KEY;
  if (!key) {
    return res.status(501).json({
      ok: false, needsKey: true,
      message: 'Falta MARKETCHECK_API_KEY en Vercel. Consíguela en marketcheck.com/apis (plan con Incentives).'
    });
  }

  // Endpoint de incentivos OEM. Se pasan varios nombres de parámetro geográfico
  // porque la doc está tras Cloudflare; el de más son ignorados por la API.
  var url = 'https://api.marketcheck.com/v2/search/car/incentive/oem' +
    '?api_key=' + encodeURIComponent(key) +
    '&make=' + encodeURIComponent(make) +
    '&model=' + encodeURIComponent(model) +
    '&zip=' + encodeURIComponent(zip) +
    (year ? '&year=' + encodeURIComponent(year) : '') +
    '&car_type=new';

  function num(v) {
    if (v == null) return null;
    var n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
    return isFinite(n) ? n : null;
  }
  // Busca el primer valor no nulo entre varias rutas posibles del objeto.
  function pick(obj, paths) {
    for (var i = 0; i < paths.length; i++) {
      var parts = paths[i].split('.'), cur = obj, ok = true;
      for (var j = 0; j < parts.length; j++) {
        if (cur == null || typeof cur !== 'object' || !(parts[j] in cur)) { ok = false; break; }
        cur = cur[parts[j]];
      }
      if (ok && cur != null && cur !== '') return cur;
    }
    return null;
  }

  /** Mensualidad de lease estándar a partir de los parámetros del programa. */
  function computeMonthly(msrp, sellPrice, residualPct, residualAmt, mf, apr, term, cashDown) {
    if (!term) term = 36;
    var cap = num(sellPrice) != null ? num(sellPrice) : num(msrp);
    if (cap == null) return null;
    cap -= (num(cashDown) || 0); // lease cash reduce el capital
    var resid = num(residualAmt);
    if (resid == null && residualPct != null && msrp != null) resid = num(msrp) * (num(residualPct) / 100);
    if (resid == null) return null;
    var factor = num(mf);
    if (factor == null && apr != null) factor = num(apr) / 2400; // APR→MF
    if (factor == null) factor = 0;
    var depreciation = (cap - resid) / term;
    var rent = (cap + resid) * factor;
    var monthly = depreciation + rent;
    return monthly > 0 && isFinite(monthly) ? Math.round(monthly) : null;
  }

  function normalize(it) {
    var msrp = pick(it, ['msrp', 'base_msrp', 'price', 'vehicle.msrp']);
    var sell = pick(it, ['selling_price', 'sale_price', 'dealer_price', 'net_price']);
    var residualPct = pick(it, ['residual_percent', 'residual_pct', 'residual_percentage', 'lease.residual_percent']);
    var residualAmt = pick(it, ['residual', 'residual_value', 'residual_amount', 'lease.residual']);
    var mf = pick(it, ['money_factor', 'mf', 'lease.money_factor']);
    var apr = pick(it, ['apr', 'lease_apr', 'interest_rate', 'lease.apr']);
    var term = pick(it, ['term', 'months', 'lease_term', 'term_months', 'lease.term']);
    var cash = pick(it, ['lease_cash', 'cash', 'rebate', 'total_rebate', 'incentive_amount', 'amount']);
    var monthly = pick(it, ['monthly_payment', 'payment', 'lease_payment', 'monthly']);
    var due = pick(it, ['due_at_signing', 'cash_due', 'total_due', 'down_payment']);
    var name = pick(it, ['program_name', 'name', 'title', 'description', 'incentive_name']);

    var computed = num(monthly);
    var estimated = false;
    if (computed == null) {
      computed = computeMonthly(msrp, sell, residualPct, residualAmt, mf, apr, num(term), cash);
      estimated = computed != null;
    }
    return {
      program: name || (make + ' ' + model + ' — programa OEM'),
      monthly: computed,
      estimated: estimated, // true = calculado por nosotros, no anunciado
      term: num(term) || 36,
      dueAtSigning: num(due),
      msrp: num(msrp),
      residualPct: num(residualPct),
      moneyFactor: num(mf),
      leaseCash: num(cash)
    };
  }

  try {
    var r = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!r.ok) {
      var body = await r.text().catch(function () { return ''; });
      return res.status(r.status === 401 || r.status === 403 ? 502 : r.status).json({
        ok: false,
        message: 'MarketCheck respondió ' + r.status + (r.status === 401 ? ' (clave inválida o plan sin Incentives).' : '.'),
        detail: body.slice(0, 300)
      });
    }
    var data = await r.json();
    var list = Array.isArray(data) ? data
      : (data.incentives || data.listings || data.programs || data.results || data.data || []);
    var programs = (Array.isArray(list) ? list : []).map(normalize)
      .filter(function (p) { return p.monthly != null; })
      .sort(function (a, b) { return a.monthly - b.monthly; });

    var out = {
      ok: true, make: make, model: model, zip: zip,
      count: programs.length,
      best: programs[0] || null,
      programs: programs.slice(0, 8),
      source: 'MarketCheck OEM incentives'
    };
    // Modo debug: devuelve la primera cruda para poder afinar el mapeo real.
    if (debug) { out.rawSample = (Array.isArray(list) ? list[0] : data) || null; out.rawKeys = Array.isArray(list) && list[0] ? Object.keys(list[0]) : Object.keys(data || {}); }
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ ok: false, message: 'Error consultando MarketCheck: ' + (e && e.message ? e.message : e) });
  }
};
