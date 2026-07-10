(function() {
'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   BIOLAB ENGINE — CILAB · FORMULA INTELLIGENCE
   cilab_formula_intelligence.js

   Motor de inteligencia para diseño de fórmulas.
   Fusiona motor teórico (calcRizomorfico) con modelo empírico (OLS).
   Provee: HybridScorer, RouteAttributionBridge, ExperimentAdvisor, FormulaGenerator.

   DEPENDENCIAS (globals de cilab_app.js — via window._cilab_*):
     window._cilab_calcEstadoRutas(ings, geneticaId)  — score por rutas
     window._cilab_calcRizomorfico(routeStates, cn)   — score teórico 0-100
     window._cilab_calcCN(ings, allIngs)              — ratio C/N
   DEPENDENCIAS (via window._cilab_*):
     _cilab_loadMeta()                  — metadata de ingredientes
     _cilab_readIngredientes()          — array de ingredientes
     _cilab_readForms()                 — array de fórmulas
     _cilab_getCalibratedScore()        — bias de cepa
   STORAGE:
     bl2_crec                           — solo lectura
     bl2_inteligencia_model             — solo lectura (via cilabInt.getModel())
     bl2_crec_excluded_formulas         — solo lectura
     bl2_formula_intel                  — escritura propia (cache)
   ═══════════════════════════════════════════════════════════════════════════ */

// ── Constantes configurables ──────────────────────────────────────────────
var FI_KEY          = 'bl2_formula_intel';
var FI_VERSION      = 1;
var FI_ALPHA_MIN    = 0.10;   // peso mínimo del prior teórico (nunca llega a cero)
var FI_ALPHA_N_FULL = 50;     // N a partir del cual α alcanza su mínimo
var FI_CN_MIN       = 6;      // límite inferior C/N biológicamente seguro
var FI_CN_MAX       = 14;     // límite superior C/N
var FI_MAX_INGS     = 12;     // máximo ingredientes en FormulaGenerator
var FI_OVERFIT_R2   = 0.98;   // umbral R² para warning de sobreajuste
var FI_OVERFIT_N    = 20;     // N mínimo para confiar en R² alto

// ── Estado interno ────────────────────────────────────────────────────────
var _fiBuilding = false;

// ── Storage ───────────────────────────────────────────────────────────────
function _fiRead() {
  try {
    var cache = JSON.parse(localStorage.getItem(FI_KEY)) || null;
    if (cache && cache.version !== FI_VERSION) { localStorage.removeItem(FI_KEY); return null; }
    return cache;
  } catch(e) { return null; }
}

function _fiWrite(cache) {
  try { localStorage.setItem(FI_KEY, JSON.stringify(cache)); }
  catch(e) { console.warn('[FI] write failed', e); }
}

function invalidate() {
  try { localStorage.removeItem(FI_KEY); } catch(e) {}
}

function getFormulaIntel() { return _fiRead(); }

// ── Helpers internos ──────────────────────────────────────────────────────
function _computeAlpha(N) {
  return Math.max(FI_ALPHA_MIN, 1 - N / FI_ALPHA_N_FULL);
}

function _confidenceLevel(n) {
  if (n >= 8) return 'alta';
  if (n >= 4) return 'media';
  if (n >= 2) return 'baja';
  return 'insuficiente';
}

function _loadMeta() {
  return typeof window._cilab_loadMeta === 'function' ? window._cilab_loadMeta() : {};
}

function _loadIngs() {
  return typeof window._cilab_readIngredientes === 'function'
    ? window._cilab_readIngredientes() : [];
}

function _readRecords() {
  try {
    var all  = JSON.parse(localStorage.getItem('bl2_crec')) || [];
    var excl = JSON.parse(localStorage.getItem('bl2_crec_excluded_formulas') || '[]');
    var exclSet = {};
    excl.forEach(function(id) { exclSet[id] = true; });
    return all.filter(function(r) {
      return r.status === 'cerrado' && !exclSet[r.formulaId];
    });
  } catch(e) { return []; }
}

function _normQty(qty, ingId, meta) {
  var m = meta[ingId];
  var maxOpt = m && m.rangoOptimo && m.rangoOptimo.max > 0 ? m.rangoOptimo.max : null;
  var denom = maxOpt || qty || 1;
  return Math.min(1, qty / denom);
}

// ── RouteAttributionBridge ────────────────────────────────────────────────
function _buildRouteAttribution() {
  var model = window.cilabInt ? window.cilabInt.getModel() : null;
  if (!model || model.error) return null;

  var meta  = _loadMeta();
  var coefs = model.coefs || {};
  var accum = {};

  Object.keys(coefs).forEach(function(ingId) {
    var entry = coefs[ingId];
    if (entry.confidence === 'insuficiente') return;
    var m = meta[ingId];
    if (!m || !m.contribuciones || typeof m.contribuciones !== 'object') return;

    Object.keys(m.contribuciones).forEach(function(routeId) {
      var w = m.contribuciones[routeId];
      if (typeof w !== 'number' || w <= 0) return;
      if (!accum[routeId]) accum[routeId] = { wCoef: 0, wSum: 0, nSum: 0, count: 0 };
      // entry.coef already in 0-100 scale (scaled x10 in _ridgeRegression)
      accum[routeId].wCoef  += entry.coef * w;
      accum[routeId].wSum   += w;
      accum[routeId].nSum   += entry.n;
      accum[routeId].count  += 1;
    });
  });

  var attribution = {};
  Object.keys(accum).forEach(function(routeId) {
    var a = accum[routeId];
    if (a.wSum === 0) return;
    var avgN = a.count ? a.nSum / a.count : 0;
    attribution[routeId] = {
      olsSignal:  Math.round(a.wCoef / a.wSum * 10) / 10,
      confidence: _confidenceLevel(Math.round(avgN)),
      n:          Math.round(avgN)
    };
  });

  return Object.keys(attribution).length ? attribution : null;
}

// ── ExperimentAdvisor ─────────────────────────────────────────────────────
function _buildExperimentAdvice() {
  var model = window.cilabInt ? window.cilabInt.getModel() : null;
  if (!model || model.error) return null;

  var coefs   = model.coefs || {};
  var allIngs = _loadIngs();

  // Uncertainty per ingredient: high |coef| + low n = high priority to test
  var uncertainties = [];
  Object.keys(coefs).forEach(function(ingId) {
    // Features auxiliares (__cn__, __quad__*) no son ingredientes reales — sin este
    // filtro (ya usado en cilab_inteligencia.js) aparecían en el panel de Optimizador
    // como si fueran un ingrediente a probar (bug encontrado en auditoría ronda 2, 2026-07-10).
    if (ingId.indexOf('__') === 0) return;
    var entry   = coefs[ingId];
    var absCoef = Math.abs(entry.coef); // already in 0-100 scale
    var unc     = absCoef / (entry.n + 1);
    var ingObj  = allIngs.find(function(i) { return i.id === ingId; });
    uncertainties.push({
      ingId:       ingId,
      ingNombre:   ingObj ? ingObj.nombre : ingId,
      n:           entry.n,
      coef:        Math.round(entry.coef * 10) / 10,
      uncertainty: Math.round(unc * 100) / 100,
      reason:      entry.coef > 0
        ? 'senal positiva con solo ' + entry.n + ' ensayo(s) — aumentar evidencia'
        : 'senal inhibidora con solo ' + entry.n + ' ensayo(s) — confirmar'
    });
  });

  uncertainties.sort(function(a, b) { return b.uncertainty - a.uncertainty; });
  var topUncertain = uncertainties.slice(0, 5);
  var topIngIds    = topUncertain.map(function(u) { return u.ingId; });

  // Existing formulas that contain high-uncertainty ingredients and are under-tested
  var suggestedFormulas = [];
  try {
    var forms   = typeof window._cilab_readForms === 'function' ? window._cilab_readForms() : [];
    var records = _readRecords();
    var testedCount = {};
    records.forEach(function(r) {
      testedCount[r.formulaId] = (testedCount[r.formulaId] || 0) + 1;
    });

    forms.forEach(function(f) {
      if ((testedCount[f.id] || 0) >= 2) return; // already well tested
      var formIngIds = (f.ings || []).map(function(i) { return i.id; });
      var matches    = topIngIds.filter(function(id) { return formIngIds.indexOf(id) >= 0; });
      if (matches.length === 0) return;
      var matchedNames = matches.map(function(id) {
        var u = topUncertain.find(function(u2) { return u2.ingId === id; });
        return u ? u.ingNombre : id;
      });
      suggestedFormulas.push({
        formulaId:        f.id,
        formulaNombre:    f.nombre,
        targetIngs:       matches,
        targetIngNames:   matchedNames,
        expectedInfoGain: Math.round(matches.length / Math.max(1, topIngIds.length) * 100) / 100,
        reason:           'contiene ingrediente(s) de alta incertidumbre: ' + matchedNames.join(', ')
      });
    });
  } catch(e) { console.warn('[FI] ExperimentAdvisor form scan failed', e); }

  suggestedFormulas.sort(function(a, b) { return b.expectedInfoGain - a.expectedInfoGain; });

  return {
    topUncertainIngredients: topUncertain,
    suggestedFormulas:       suggestedFormulas.slice(0, 3)
  };
}

// ── buildFormulaIntel ─────────────────────────────────────────────────────
function buildFormulaIntel() {
  if (_fiBuilding) return;
  _fiBuilding = true;
  try {
    var model   = window.cilabInt ? window.cilabInt.getModel() : null;
    var records = _readRecords();
    var N       = records.length;

    if (!model || model.error || N < 1) return;

    var routeAttribution = _buildRouteAttribution();
    var experimentAdvice = _buildExperimentAdvice();

    var cache = {
      version:          FI_VERSION,
      computedAt:       new Date().toISOString(),
      nRecords:         N,
      alpha:            Math.round(_computeAlpha(N) * 100) / 100,
      routeAttribution: routeAttribution,
      experimentAdvice: experimentAdvice
    };

    _fiWrite(cache);
  } finally {
    _fiBuilding = false;
  }
}

// ── HybridScorer ──────────────────────────────────────────────────────────
function scoreFormula(ings, geneticaId) {
  var model   = window.cilabInt ? window.cilabInt.getModel() : null;
  var records = _readRecords();
  var N       = records.length;
  var alpha   = _computeAlpha(N);
  var allIngs = _loadIngs();

  // Score teórico — expuestos por cilab_app.js IIFE como window._cilab_*
  var thScore = 0;
  var cnResult = { cn: null };
  if (typeof window._cilab_calcEstadoRutas === 'function' && typeof window._cilab_calcRizomorfico === 'function') {
    var routeStates = window._cilab_calcEstadoRutas(ings, geneticaId);
    if (typeof window._cilab_calcCN === 'function') cnResult = window._cilab_calcCN(ings, allIngs);
    thScore = window._cilab_calcRizomorfico(routeStates, cnResult.cn);
  }

  // Sin modelo OLS — degradar al comportamiento actual (thScore + strainBias)
  if (!model || model.error) {
    var calibResult = typeof window._cilab_getCalibratedScore === 'function'
      ? window._cilab_getCalibratedScore(ings, geneticaId) : null;
    var degradedBias = calibResult ? (calibResult.bias || 0) : 0;
    return {
      hybridScore:      Math.round(Math.max(0, Math.min(100, thScore + degradedBias))),
      thScore:          Math.round(thScore),
      olsProjection:    null,
      strainBias:       degradedBias,
      alpha:            1.0,
      N:                N,
      confidence:       'insuficiente',
      usingStrainModel: false,
      overfitWarning:   false
    };
  }

  // Preferir modelo jerárquico (blend empírico de cepa + prior global)
  var _hs = model.hierarchicalStrains && model.hierarchicalStrains[geneticaId];
  var useStrain, coefs, intercept;
  if (_hs) {
    useStrain = true;
    coefs     = _hs.coefs || {};
    intercept = _hs.intercept != null ? _hs.intercept : (model.intercept || 0);
  } else {
    useStrain = !!(model.byStrain && model.byStrain[geneticaId] &&
                   model.byStrain[geneticaId].nRecords >= 3);
    var _activeModel = useStrain ? model.byStrain[geneticaId] : model;
    coefs     = _activeModel.coefs || {};
    intercept = _activeModel.intercept != null ? _activeModel.intercept : (model.intercept || 0);
  }

  // Proyección OLS: intercept + Σ(coef_i × normQty_i) + términos cuadráticos
  var meta   = _loadMeta();
  var olsSum = intercept;
  ings.forEach(function(ing) {
    if (!ing.id || !(ing.qty > 0)) return;
    var entry = coefs[ing.id];
    if (!entry || entry.confidence === 'insuficiente') return;
    var nq = _normQty(ing.qty, ing.id, meta);
    olsSum += entry.coef * nq;
    // Término cuadrático si el modelo aprendió curvatura de dosis-respuesta
    var qEntry = coefs['__quad__' + ing.id];
    if (qEntry && qEntry.confidence !== 'insuficiente') {
      olsSum += qEntry.coef * nq * nq;
    }
  });
  // Incluir contribución empírica del ratio C/N si el modelo lo tiene
  var cnEntry = coefs['__cn__'];
  if (cnEntry && cnEntry.confidence !== 'insuficiente') {
    var cnRes = typeof window._cilab_calcCN === 'function'
      ? window._cilab_calcCN(ings, allIngs) : null;
    var cnVal = (cnRes && cnRes.cn != null && cnRes.cn > 0 && cnRes.cn < 50) ? cnRes.cn : null;
    if (cnVal !== null) olsSum += cnEntry.coef * Math.min(1, cnVal / 20);
  }
  var olsProjection = Math.max(0, Math.min(100, olsSum));

  // Bias de cepa: solo si usamos modelo global (el modelo de cepa ya lo codifica)
  var strainBias = 0;
  if (!useStrain) {
    var cb = typeof window._cilab_getCalibratedScore === 'function'
      ? window._cilab_getCalibratedScore(ings, geneticaId) : null;
    strainBias = cb ? (cb.bias || 0) : 0;
  }

  // Detección de sobreajuste
  var overfitWarning = model.r2 > FI_OVERFIT_R2 && N < FI_OVERFIT_N;
  var effectiveBeta  = overfitWarning ? (1 - alpha) * 0.5 : (1 - alpha);

  var raw         = alpha * thScore + effectiveBeta * olsProjection + strainBias;
  var hybridScore = Math.round(Math.max(0, Math.min(100, raw)));

  // Confianza: promedio de n de los ingredientes en la formula que tienen coef
  var ingNs = ings.map(function(ing) {
    return (coefs[ing.id] && coefs[ing.id].n) ? coefs[ing.id].n : 0;
  }).filter(function(n) { return n > 0; });
  var avgN       = ingNs.length
    ? ingNs.reduce(function(a, b) { return a + b; }, 0) / ingNs.length : 0;
  var confidence = overfitWarning ? 'baja' : _confidenceLevel(Math.round(avgN));

  return {
    hybridScore:      hybridScore,
    thScore:          Math.round(thScore),
    olsProjection:    Math.round(olsProjection),
    strainBias:       strainBias,
    alpha:            Math.round(alpha * 100) / 100,
    N:                N,
    confidence:       confidence,
    usingStrainModel: useStrain,
    overfitWarning:   overfitWarning
  };
}

// ── FormulaGenerator ──────────────────────────────────────────────────────
function _buildCandidate(label, ingScores, maxIngs, geneticaId, allIngs, targetScore) {
  var formula = [];

  for (var iter = 0; iter < 60 && formula.length < maxIngs; iter++) {
    var best = null, bestHybrid = -Infinity;

    ingScores.forEach(function(c) {
      if (formula.find(function(f) { return f.id === c.ing.id; })) return;

      var testIngs = formula.concat([{
        id:     c.ing.id,
        nombre: c.ing.nombre,
        qty:    c.optQty,
        unidad: c.ing.unidad || 'g'
      }]);

      // Verify C/N constraint
      if (typeof window._cilab_calcCN === 'function') {
        var cnR = window._cilab_calcCN(testIngs, allIngs);
        if (cnR && cnR.cn != null && (cnR.cn < FI_CN_MIN || cnR.cn > FI_CN_MAX)) return;
      }

      var r = scoreFormula(testIngs, geneticaId);
      if (r.hybridScore > bestHybrid) {
        bestHybrid = r.hybridScore;
        best = { ing: c.ing, qty: c.optQty, score: r.hybridScore };
      }
    });

    if (!best) break;
    var currentScore = formula.length
      ? scoreFormula(formula, geneticaId).hybridScore : 0;
    if (best.score - currentScore < 0.5) break; // convergence

    formula.push({
      id:     best.ing.id,
      nombre: best.ing.nombre,
      qty:    best.qty,
      unidad: best.ing.unidad || 'g'
    });
    // Parar si ya alcanzamos el target pedido (no over-engineer)
    if (targetScore != null && best.score >= targetScore) break;
  }

  if (formula.length === 0) return null;

  var finalResult = scoreFormula(formula, geneticaId);
  var cnFinal = typeof window._cilab_calcCN === 'function'
    ? window._cilab_calcCN(formula, allIngs) : { cn: null };

  return {
    label:                label,
    ings:                 formula,
    projectedHybridScore: finalResult.hybridScore,
    projectedThScore:     finalResult.thScore,
    projectedCN:          cnFinal.cn != null ? Math.round(cnFinal.cn * 10) / 10 : null,
    confidence:           finalResult.confidence,
    N:                    finalResult.N
  };
}

function generateFormula(targetScore, geneticaId) {
  var model   = window.cilabInt ? window.cilabInt.getModel() : null;
  var records = _readRecords();
  var N       = records.length;

  if (N < 5) return [];

  var meta    = _loadMeta();
  var allIngs = _loadIngs();
  var alpha   = _computeAlpha(N);
  var useStrain = !!(model && model.byStrain && model.byStrain[geneticaId] &&
                     model.byStrain[geneticaId].nRecords >= 3);
  var activeModel = useStrain ? model.byStrain[geneticaId] : (model || {});
  var coefs   = activeModel.coefs || {};

  // Score each ingredient: combined theoretical + empirical contribution
  var ingScores = allIngs.map(function(ing) {
    if (!ing.id) return null;
    var m = meta[ing.id];
    if (!m || !m.rangoOptimo || !m.rangoOptimo.max) return null;
    if (m.disabled) return null;
    var _rMin = m.rangoOptimo.min > 0 ? m.rangoOptimo.min : null;
    var _rMax = m.rangoOptimo.max;
    // Punto medio del rango: más representativo que el mínimo (que era el valor anterior).
    // Para ingredientes estructurales (agar, agua) el mínimo funcional ≠ dosis de trabajo.
    var optQty = (_rMin && _rMax) ? (_rMin + _rMax) / 2 : (_rMin || _rMax);

    // Theoretical contribution: sum of route weights from contribuciones
    var thContrib = 0;
    if (m.contribuciones && typeof m.contribuciones === 'object') {
      Object.keys(m.contribuciones).forEach(function(r) {
        thContrib += (m.contribuciones[r] || 0);
      });
      thContrib = thContrib / 100; // normalize to 0-1
    }

    var olsEntry   = coefs[ing.id];
    var olsContrib = olsEntry && olsEntry.confidence !== 'insuficiente'
      ? olsEntry.coef : 0; // already in 0-100 scale

    var combined = alpha * thContrib * 100 + (1 - alpha) * olsContrib;
    return { ing: ing, combined: combined, optQty: optQty };
  }).filter(Boolean).sort(function(a, b) { return b.combined - a.combined; });

  var results = [];

  // Candidate A: maximum hybrid score (sin límite de target)
  var cA = _buildCandidate('Maximo hibrido', ingScores, FI_MAX_INGS, geneticaId, allIngs, null);
  if (cA) results.push(cA);

  // Candidate B: compacta que se detiene al alcanzar el target (o máx 8 ingredientes)
  var cBLabel = targetScore != null
    ? 'Target ' + targetScore + ' pts (compacta)'
    : 'Compacta (8 ingredientes max)';
  var cB = _buildCandidate(cBLabel, ingScores, 8, geneticaId, allIngs, targetScore || null);
  if (cB && (!cA || cB.ings.length < cA.ings.length)) results.push(cB);

  // Candidate C: theory-only (alpha forced to 1 via thContrib-only sorted list)
  var ingScoresThOnly = allIngs.map(function(ing) {
    if (!ing.id) return null;
    var m = meta[ing.id];
    if (!m || !m.rangoOptimo || !m.rangoOptimo.max) return null;
    if (m.disabled) return null;
    // Candidato conservador usa el mínimo del rango (arrancar con poco)
    var optQty = (m.rangoOptimo.min && m.rangoOptimo.min > 0)
      ? m.rangoOptimo.min : m.rangoOptimo.max;
    var thContrib = 0;
    if (m.contribuciones && typeof m.contribuciones === 'object') {
      Object.keys(m.contribuciones).forEach(function(r) {
        thContrib += (m.contribuciones[r] || 0);
      });
    }
    return { ing: ing, combined: thContrib, optQty: optQty };
  }).filter(Boolean).sort(function(a, b) { return b.combined - a.combined; });

  var cC = _buildCandidate('Conservadora (teorica)', ingScoresThOnly, FI_MAX_INGS, geneticaId, allIngs, null);
  // Skip C if identical to A (happens when OLS is insuficiente — both degrade to theory)
  if (cC && cA) {
    var aIds = cA.ings.map(function(i) { return i.id; }).sort().join(',');
    var cIds = cC.ings.map(function(i) { return i.id; }).sort().join(',');
    if (aIds === cIds) cC = null;
  }
  if (cC) results.push(cC);

  return results.filter(Boolean);
}

// ── API pública (stubs — se implementan en tasks siguientes) ──────────────
window.cilabFI = {
  buildFormulaIntel:   buildFormulaIntel,
  getFormulaIntel:     getFormulaIntel,
  invalidate:          invalidate,
  scoreFormula:        scoreFormula,
  generateFormula:     generateFormula,
  getExperimentAdvice: function() { var c = _fiRead(); return c ? (c.experimentAdvice || null) : null; },
  getRouteAttribution: function() { var c = _fiRead(); return c ? (c.routeAttribution || null) : null; },
};

})();
