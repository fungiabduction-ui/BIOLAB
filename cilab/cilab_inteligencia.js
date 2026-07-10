(function() {
'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   BIOLAB ENGINE — CILAB · INTELIGENCIA
   cilab_inteligencia.js

   Motor de atribución de ingredientes via regresión ridge (OLS regularizada).
   Lee bl2_crec (registros cerrados), construye matriz de features y ajusta
   coeficientes que explican el score final empírico.

   DEPENDENCIAS (via window._cilab_*):
     _cilab_loadMeta           — metadata de ingredientes (rangoOptimo.max)
     _cilab_getActiveFormulaId — formulaId activo en el Analizador
     _cilab_readForms          — array de fórmulas
     _cilab_readIngredientes   — array de ingredientes
   STORAGE:
     bl2_crec               — fuente de datos (solo lectura)
     bl2_inteligencia_model — modelo cacheado (escritura propia)
   ═══════════════════════════════════════════════════════════════════════════ */

// ── Storage ──────────────────────────────────────────────────────────────────
var K_MODEL = 'bl2_inteligencia_model';
var K_CREC  = 'bl2_crec';
var K_EXCL  = 'bl2_crec_excluded_formulas';
var _building = false;

function _modelRead() {
  try { return JSON.parse(localStorage.getItem(K_MODEL)) || null; } catch(e) { return null; }
}

function _modelWrite(m) {
  try { localStorage.setItem(K_MODEL, JSON.stringify(m)); } catch(e) {}
}

function _creRead() {
  try { return JSON.parse(localStorage.getItem(K_CREC)) || []; } catch(e) { return []; }
}

function _creFilterMotor(records) {
  var excluded = {};
  try {
    var ex = JSON.parse(localStorage.getItem(K_EXCL)) || [];
    ex.forEach(function(id) { excluded[id] = true; });
  } catch(e) {}
  return records.filter(function(r) { return !excluded[r.formulaId]; });
}

function invalidate() {
  try { localStorage.removeItem(K_MODEL); } catch(e) {}
}

function getModel() {
  return _modelRead();
}

// ── Álgebra matricial (interno) ───────────────────────────────────────────────

function _matMul(A, B) {
  var m = A.length, n = B[0].length, k = B.length;
  var C = [];
  for (var i = 0; i < m; i++) {
    C[i] = [];
    for (var j = 0; j < n; j++) {
      var s = 0;
      for (var l = 0; l < k; l++) s += A[i][l] * B[l][j];
      C[i][j] = s;
    }
  }
  return C;
}

function _matTranspose(A) {
  var m = A.length, n = A[0].length;
  var T = [];
  for (var j = 0; j < n; j++) {
    T[j] = [];
    for (var i = 0; i < m; i++) T[j][i] = A[i][j];
  }
  return T;
}

// Resuelve Ax = b via eliminación gaussiana con pivoteo parcial.
// Retorna x (array) o null si la matriz es singular.
function _solveLinear(A, b) {
  var n = A.length;
  var M = [];
  for (var i = 0; i < n; i++) {
    M[i] = A[i].slice();
    M[i].push(b[i]);
  }
  for (var col = 0; col < n; col++) {
    var maxRow = col;
    for (var r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[maxRow][col])) maxRow = r;
    }
    var tmp = M[col]; M[col] = M[maxRow]; M[maxRow] = tmp;
    if (Math.abs(M[col][col]) < 1e-12) return null;
    var pivot = M[col][col];
    for (var r2 = 0; r2 < n; r2++) {
      if (r2 === col) continue;
      var factor = M[r2][col] / pivot;
      for (var c = col; c <= n; c++) M[r2][c] -= factor * M[col][c];
    }
  }
  var x = [];
  for (var i2 = 0; i2 < n; i2++) x[i2] = M[i2][n] / M[i2][i2];
  return x;
}

// ── Pipeline de datos ─────────────────────────────────────────────────────────

// Fallback: mergea extras desde bl2_experimentos sin modificar storage
function _mergeExtrasFromStorage(record, baseIngs, allIngs, exps) {
  if (!exps) {
    try { exps = JSON.parse(localStorage.getItem('bl2_experimentos')) || []; } catch(e) { exps = []; }
  }
  var exp = exps.find(function(e) { return e.id === record.experimentoId; });
  if (!exp) return baseIngs;
  var fr = (exp.frascos || []).find(function(f) { return f.label === record.frascoId; });
  if (!fr || !fr.extras || !fr.extras.length) return baseIngs;

  var merged     = baseIngs.slice();
  var normFactor = (fr.volFrasco > 0) ? (1000 / fr.volFrasco) : 1;
  fr.extras.forEach(function(ex) {
    if (!ex.ingId || !(ex.qty > 0)) return;
    var normalizedQty = ex.qty * normFactor;
    var exists = merged.find(function(i) { return i.id === ex.ingId; });
    if (exists) {
      exists.qty += normalizedQty;
    } else {
      var ing = allIngs.find(function(i) { return i.id === ex.ingId; });
      merged.push({ id: ex.ingId, nombre: (ing && ing.nombre) || ex.ingId, qty: normalizedQty, unidad: (ing && ing.unidad) || 'gr' });
    }
  });
  return merged;
}

function _getRecordIngs(record, allIngs, exps) {
  var ings = (record.formulaSnapshot && record.formulaSnapshot.ings) || [];
  if (record.experimentoId && record.frascoId && !record._extrasBackfilled) {
    ings = _mergeExtrasFromStorage(record, ings, allIngs, exps);
  }
  return ings;
}

function _buildFeatureMatrix(records, minRecords) {
  minRecords = minRecords || 5;
  var meta    = typeof window._cilab_loadMeta === 'function' ? window._cilab_loadMeta() : {};
  var allIngs = typeof window._cilab_readIngredientes === 'function' ? window._cilab_readIngredientes() : [];
  var cachedExps = null;
  try { cachedExps = JSON.parse(localStorage.getItem('bl2_experimentos')) || []; } catch(e) { cachedExps = []; }

  // Incluir features obs_* solo cuando hay masa crítica de registros con wizard —
  // si son escasos, los ceros esparcidos corrompen los coeficientes de ingredientes reales.
  var _enrichedCount = records.filter(function(r) {
    return (r.observaciones || []).some(function(o) {
      return o.enriched && o.enriched.complete === true;
    });
  }).length;
  var hasAnyEnriched = _enrichedCount >= 5 && (_enrichedCount / records.length) >= 0.40;

  // Recolectar ingredientes únicos y estadísticas
  var ingQtyMax = {};
  var ingCount  = {};

  records.forEach(function(r) {
    _getRecordIngs(r, allIngs, cachedExps).forEach(function(ing) {
      if (!ing.id || !(ing.qty > 0)) return;
      ingQtyMax[ing.id] = Math.max(ingQtyMax[ing.id] || 0, ing.qty);
      ingCount[ing.id]  = (ingCount[ing.id] || 0) + 1;
    });
  });

  // ── Synthetic Baseline Records para pares A/B de experimento ─────────────────
  // Cuando variante B = base A + extras con n=1, los extras no entran en la
  // regresión (ingCount < 2) y los feature vectors de A y B son idénticos con
  // targets distintos → OLS confunde coefs de los ingredientes compartidos.
  // Fix: generar un pseudo-record sintético en memoria para cada variante: tiene
  // los ingredientes del frasco base (sin extras) y el mismo score del frasco base.
  // La ausencia del extra en el synthetic cuenta como una observación adicional,
  // haciendo ingCount[extraId] >= 2 y permitiendo que entre en la regresión.
  var _syntheticRecords = [];
  if (cachedExps && cachedExps.length) {
    var _expGroups = {};
    records.forEach(function(r) {
      if (!r.experimentoId) return;
      if (!_expGroups[r.experimentoId]) _expGroups[r.experimentoId] = [];
      _expGroups[r.experimentoId].push(r);
    });

    Object.keys(_expGroups).forEach(function(expId) {
      var expRecs = _expGroups[expId];
      var exp = cachedExps.find(function(e) { return e.id === expId; });
      if (!exp || !exp.frascos || !exp.frascos.length) return;

      // Frasco base = el primero sin extras definidos
      var baseFrasco = exp.frascos.find(function(f) {
        return !f.extras || !f.extras.length;
      });
      if (!baseFrasco) return;

      var baseRec = expRecs.find(function(r) {
        return r.frascoId === baseFrasco.label;
      });
      if (!baseRec || baseRec.scoreFinalNorm == null) return;

      var baseIngs = _getRecordIngs(baseRec, allIngs, cachedExps);
      var baseIngSet = {};
      baseIngs.forEach(function(i) { if (i.id && i.qty > 0) baseIngSet[i.id] = true; });

      var _synthPushedForExp = false;
      expRecs.forEach(function(variantRec) {
        if (variantRec === baseRec) return;
        var variantIngs = _getRecordIngs(variantRec, allIngs, cachedExps);

        // Extras = ingredientes presentes en variante pero ausentes en base
        var extras = variantIngs.filter(function(i) {
          return i.id && i.qty > 0 && !baseIngSet[i.id];
        });
        if (!extras.length) return;

        // La ausencia del extra en el synthetic cuenta como una observación adicional.
        // Esto hace ingCount[extraId] >= 2 y permite que entre en la regresión.
        extras.forEach(function(ex) {
          ingCount[ex.id]  = (ingCount[ex.id] || 0) + 1;
          ingQtyMax[ex.id] = Math.max(ingQtyMax[ex.id] || 0, ex.qty);
        });

        // Solo un synthetic por experimento — el mismo row de base sirve para
        // todas las variantes. Múltiples synthetics idénticos sesgarían OLS.
        if (!_synthPushedForExp) {
          _synthPushedForExp = true;
          _syntheticRecords.push({
            _synthetic:      true,
            formulaSnapshot: { ings: baseIngs },
            scoreFinalNorm:  baseRec.scoreFinalNorm,
            geneticaId:      baseRec.geneticaId,
            rizoPozitivas:   null,
            totalPlacas:     0,
            observaciones:   [],
            experimentoId:   null,
            frascoId:        null,
          });
        }
      });
    });
  }

  // ── Delta Substitution Records para variantes de experimento ─────────────────
  // Frasco A (o "A (Control)") es SIEMPRE el control. B/C/D son SIEMPRE variantes.
  // Para cada variante con control.scoreFinalNorm >= _DELTA_CONTROL_THRESHOLD:
  //   la variante se reemplaza en X/y por [solo_extras] → delta/10.
  //   Los ingredientes base quedan en 0 → OLS no puede atribuirles el delta.
  var _DELTA_CONTROL_THRESHOLD = 50;
  var _deltaSkip = [];
  var _deltaRows = [];

  if (cachedExps && cachedExps.length) {
    var _dGroups = {};
    records.forEach(function(r) {
      if (!r.experimentoId || !r.frascoId) return;
      if (!_dGroups[r.experimentoId]) _dGroups[r.experimentoId] = [];
      _dGroups[r.experimentoId].push(r);
    });

    Object.keys(_dGroups).forEach(function(expId) {
      var expRecs = _dGroups[expId];

      // Controles: frascoId empieza con 'A' (cubre "A" y "A (Control)")
      var controlByGenetica = {};
      var firstControl = null;
      expRecs.forEach(function(r) {
        if (!r.frascoId || r.frascoId.charAt(0) !== 'A') return;
        if (r.scoreFinalNorm == null) return;
        if (!firstControl) firstControl = r;
        if (r.geneticaId) controlByGenetica[r.geneticaId] = r;
      });

      expRecs.forEach(function(r) {
        if (!r.frascoId || r.frascoId.charAt(0) === 'A') return;
        if (r.scoreFinalNorm == null) return;

        // Matching por cepa; fallback al primer control disponible
        var ctrl = (r.geneticaId && controlByGenetica[r.geneticaId])
          ? controlByGenetica[r.geneticaId]
          : firstControl;
        if (!ctrl) return;
        if (ctrl.scoreFinalNorm < _DELTA_CONTROL_THRESHOLD) return;

        // Extras = ings en variante ausentes en control
        var ctrlIngs  = _getRecordIngs(ctrl, allIngs, cachedExps);
        var ctrlIngSet = {};
        ctrlIngs.forEach(function(i) { if (i.id && i.qty > 0) ctrlIngSet[i.id] = true; });
        var variantIngs = _getRecordIngs(r, allIngs, cachedExps);
        var extras = variantIngs.filter(function(i) {
          return i.id && i.qty > 0 && !ctrlIngSet[i.id];
        });
        if (!extras.length) return;

        _deltaSkip.push(r);
        _deltaRows.push({
          deltaY:     (r.scoreFinalNorm - ctrl.scoreFinalNorm) / 10, // scoreFinalNorm es 0-100; /10 alinea con escala y [0-10]
          extras:     extras,
          geneticaId: r.geneticaId
        });
      });
    });
  }

  // Solo ingredientes con n >= 2 entran en la regresión
  var ingIds = Object.keys(ingCount).filter(function(id) { return ingCount[id] >= 2; });
  if (!ingIds.length || records.length < minRecords) return null;

  // Features cuadráticas: ingredientes con rango calibrado (min+max) y n≥4
  // Capturan efectos meseta (arginina, etc.) sin necesitar más datos
  var _quadBaseIds = ingIds.filter(function(id) {
    var m = meta[id];
    return m && m.rangoOptimo && m.rangoOptimo.min > 0 && m.rangoOptimo.max > 0
      && (ingCount[id] || 0) >= 4;
  }).slice(0, 4);
  var _quadFeatIds = _quadBaseIds.map(function(id) { return '__quad__' + id; });
  if (_quadFeatIds.length) {
    _quadFeatIds.forEach(function(qId) { ingCount[qId] = ingCount[qId.slice(8)]; });
    ingIds = ingIds.concat(_quadFeatIds);
  }

  function normQty(ingId, qty) {
    var m      = meta[ingId];
    var maxOpt = m && m.rangoOptimo && m.rangoOptimo.max > 0 ? m.rangoOptimo.max : null;
    var denom  = maxOpt || ingQtyMax[ingId] || qty || 1;
    return Math.min(1, qty / denom);
  }

  // C/N como feature empírico: cn/20 normalizado, imputado con media cuando falta.
  // Separa el efecto de la ratio nutricional global del efecto por ingrediente individual.
  var _calcCN  = typeof window._cilab_calcCN === 'function' ? window._cilab_calcCN : null;
  var CN_DENOM = 20;
  var cnByRec  = {}, cnSum = 0, cnRealN = 0;
  if (_calcCN) {
    records.forEach(function(r, ri) {
      if (r.scoreFinalNorm == null) return;
      var res = _calcCN(_getRecordIngs(r, allIngs, cachedExps), allIngs);
      var cn  = (res && res.cn != null && res.cn > 0 && res.cn < 50) ? res.cn : null;
      cnByRec[ri] = cn;
      if (cn !== null) { cnSum += cn; cnRealN++; }
    });
  }
  var useCN  = _calcCN && cnRealN >= 2;
  var cnMean = useCN ? cnSum / cnRealN : null;
  if (useCN) { ingIds = ingIds.concat(['__cn__']); ingCount['__cn__'] = cnRealN; }

  var X = [], y = [], validRecords = [], nIncidence = 0;

  records.forEach(function(r, ri) {
    // Saltar variantes de experimento reemplazadas por filas delta
    if (_deltaSkip.indexOf(r) !== -1) return;

    // Aceptar records con incidencia objetiva aunque no tengan scoreObservado subjetivo
    var hasIncidence = r.rizoPozitivas != null && r.totalPlacas > 0;
    if (r.scoreFinalNorm == null && !hasIncidence) return;

    var ings     = _getRecordIngs(r, allIngs, cachedExps);
    var ingSlice = useCN ? ingIds.slice(0, -1) : ingIds;
    var row      = ingSlice.map(function(id) {
      if (id.indexOf('__quad__') === 0) {
        var _qRId = id.slice(8);
        var _qIng = ings.find(function(i) { return i.id === _qRId; });
        var _nq   = _qIng && _qIng.qty > 0 ? normQty(_qRId, _qIng.qty) : 0;
        return _nq * _nq;
      }
      var ing = ings.find(function(i) { return i.id === id; });
      return ing && ing.qty > 0 ? normQty(id, ing.qty) : 0;
    });
    if (useCN) {
      var cn = (cnByRec[ri] !== undefined && cnByRec[ri] !== null) ? cnByRec[ri] : cnMean;
      row.push(Math.min(1, cn / CN_DENOM));
    }

    // Target: incidencia objetiva (rizoPozitivas/totalPlacas) × 10 cuando disponible,
    // fallback a scoreObservado subjetivo. Misma escala [0-10] para compatibilidad.
    var incidenceTarget = hasIncidence ? (r.rizoPozitivas / r.totalPlacas) * 10 : null;
    if (incidenceTarget !== null) nIncidence++;

    // Features obs_* — extraídas de la obs definitiva con enriched.complete === true
    var _yPenalty = 0;
    if (hasAnyEnriched) {
      var _defObs = null;
      var _obsArr = r.observaciones || [];
      for (var _oi = _obsArr.length - 1; _oi >= 0; _oi--) {
        if (_obsArr[_oi].tipo === 'definitiva' && _obsArr[_oi].enriched && _obsArr[_oi].enriched.complete === true) {
          _defObs = _obsArr[_oi];
          break;
        }
      }
      var _sig = _defObs ? (_defObs.enriched.signals || {}) : {};

      // Penalizaciones fenotípicas al target Y
      if (_defObs) {
        if (_sig.oxidacion_agar && _sig.oxidacion_agar.presente) {
          var _oxAgarInt = _sig.oxidacion_agar.intensidad;
          if      (_oxAgarInt === 'leve')     _yPenalty += 0.5;
          else if (_oxAgarInt === 'moderado') _yPenalty += 1.0;
          else if (_oxAgarInt === 'intenso')  _yPenalty += 1.5;
        }
        if (_sig.sectoring    && _sig.sectoring.presente)    _yPenalty += 1.0;
        if (_sig.autolisis    && _sig.autolisis.presente)    _yPenalty += 1.5;
        if (_sig.exudados     && _sig.exudados.presente) {
          var _exColor = _sig.exudados.color;
          if (_exColor === 'amarillo' || _exColor === 'marrón' || _exColor === 'marron') _yPenalty += 0.5;
          else _yPenalty += 0.2;
        }
        if (_sig.cristalizacion && _sig.cristalizacion.presente) _yPenalty += 0.3;
        if (_sig.velocidadRel  === 'lento')                      _yPenalty += 0.3;
        if (_sig.fenotipoAereo === 'tomentoso')                   _yPenalty += 0.4;
      }

      var _oxIntMap = { leve: 0.33, moderado: 0.66, intenso: 1.0 };
      // oxidacion_inoculo = estrés de fórmula anterior; oxidacion_agar = estrés fórmula actual
      // Backward compat: acepta 'oxidacion' legacy además de los IDs nuevos
      var _oxInoc  = (_sig.oxidacion_inoculo && _sig.oxidacion_inoculo.presente) || (_sig.oxidacion && _sig.oxidacion.presente) ? 1 : 0;
      var _oxAgar  = (_sig.oxidacion_agar    && _sig.oxidacion_agar.presente)    ? 1 : 0;
      var _oxPres  = Math.max(_oxInoc, _oxAgar); // legacy compat: 1 si cualquiera
      var _oxInt   = (_sig.oxidacion_agar && _sig.oxidacion_agar.intensidad)
        ? (_oxIntMap[_sig.oxidacion_agar.intensidad] || 0)
        : ((_sig.oxidacion && _sig.oxidacion.intensidad) ? (_oxIntMap[_sig.oxidacion.intensidad] || 0) : 0);
      var _exPres  = (_sig.exudados && _sig.exudados.presente) ? 1 : 0;
      var _crist   = (_sig.cristalizacion && _sig.cristalizacion.presente) ? 1 : 0;
      var _sect    = (_sig.sectoring && _sig.sectoring.presente) ? 1 : 0;
      var _autol   = (_sig.autolisis && _sig.autolisis.presente) ? 1 : 0;
      var _velLent = _sig.velocidadRel === 'lento'  ? 1 : 0;
      var _velRap  = _sig.velocidadRel === 'rapido' ? 1 : 0;
      var _patIrr  = _sig.patronInvasion === 'irregular' ? 1 : 0;
      var _tomen   = _sig.fenotipoAereo  === 'tomentoso'  ? 1 : 0;

      row = row.concat([_oxPres, _oxInt, _oxInoc, _oxAgar, _exPres, _crist, _sect, _autol, _velLent, _velRap, _patIrr, _tomen]);
    }

    X.push(row);
    var _yRaw = incidenceTarget !== null ? incidenceTarget : r.scoreFinalNorm / 10;
    y.push(Math.max(0, _yRaw - _yPenalty));
    validRecords.push(r);
  });

  // Synthetics — mismo pipeline que reales, pero sin C/N real ni señales enriched.
  // No se agregan a validRecords: no participan en pairwise ni byStrain.
  _syntheticRecords.forEach(function(sr) {
    if (sr.scoreFinalNorm == null) return;
    var sIngs    = sr.formulaSnapshot.ings || [];
    var ingSlice = useCN ? ingIds.slice(0, -1) : ingIds;
    var row      = ingSlice.map(function(id) {
      if (id.indexOf('__quad__') === 0) {
        var _qRId = id.slice(8);
        var _qIng = sIngs.find(function(i) { return i.id === _qRId; });
        var _nq   = _qIng && _qIng.qty > 0 ? normQty(_qRId, _qIng.qty) : 0;
        return _nq * _nq;
      }
      var ing = sIngs.find(function(i) { return i.id === id; });
      return ing && ing.qty > 0 ? normQty(id, ing.qty) : 0;
    });
    if (useCN) row.push(cnMean !== null ? Math.min(1, cnMean / CN_DENOM) : 0);
    // obs_* features: 12 ceros — synthetic no tiene señales fenotípicas observadas
    if (hasAnyEnriched) row = row.concat([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

    X.push(row);
    y.push(Math.max(0, sr.scoreFinalNorm / 10));
    // No agrega a validRecords — synthetics no participan en pairwise ni byStrain
  });

  // Delta rows — variantes de experimento: [solo_extras] → delta/10
  // No van a validRecords: escala y diferente a registros absolutos.
  _deltaRows.forEach(function(dr) {
    if (dr.deltaY == null) return;
    // Skip delta rows cuyo extra no entró en ingIds (ingCount insuficiente):
    // un vector de ceros con y != 0 distorsionaría el intercepto.
    var _hasUsableExtra = dr.extras.some(function(e) {
      return ingIds.indexOf(e.id) !== -1;
    });
    if (!_hasUsableExtra) return;
    var ingSlice = useCN ? ingIds.slice(0, -1) : ingIds;
    var row = ingSlice.map(function(id) {
      if (id.indexOf('__quad__') === 0) return 0;
      var extra = dr.extras.find(function(e) { return e.id === id; });
      return extra && extra.qty > 0 ? normQty(id, extra.qty) : 0;
    });
    if (useCN) row.push(0);
    if (hasAnyEnriched) row = row.concat([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    X.push(row);
    y.push(dr.deltaY);
    // No push a validRecords
  });

  if (X.length < minRecords) return null;

  // Varianza normalizada por feature: detecta ingredientes sin variación real.
  // Coefs de features con varianza < 0.01 son efectos no estimables — se marcan
  // "indeterminate" en el output del modelo para no engañar al usuario.
  var _ingVariance = {};
  if (X.length > 1) {
    ingIds.forEach(function(ingId, j) {
      var vals     = X.map(function(row) { return row[j]; });
      var mean     = vals.reduce(function(s, v) { return s + v; }, 0) / vals.length;
      var variance = vals.reduce(function(s, v) { return s + Math.pow(v - mean, 2); }, 0) / vals.length;
      _ingVariance[ingId] = Math.round(variance * 1000) / 1000;
    });
  }

  return { X: X, y: y, ingIds: ingIds, ingCount: ingCount, records: validRecords, nIncidence: nIncidence, ingVariance: _ingVariance, nTotal: X.length };
}

// ── Motor Ridge ───────────────────────────────────────────────────────────────

function _ridgeRegression(X, y, lambda) {
  var n = X.length, p = X[0].length;
  if (n < 2 || p < 1) return null;

  // Centrar X e y
  var xMean = [];
  var yMean = 0;
  for (var j0 = 0; j0 < p; j0++) xMean[j0] = 0;
  for (var i0 = 0; i0 < n; i0++) {
    for (var j1 = 0; j1 < p; j1++) xMean[j1] += X[i0][j1];
    yMean += y[i0];
  }
  for (var j2 = 0; j2 < p; j2++) xMean[j2] /= n;
  yMean /= n;

  var Xc = X.map(function(row) { return row.map(function(v, j) { return v - xMean[j]; }); });
  var yc = y.map(function(v) { return v - yMean; });

  var Xt  = _matTranspose(Xc);
  var XtX = _matMul(Xt, Xc);
  var Xty = [];
  for (var j3 = 0; j3 < p; j3++) {
    Xty[j3] = 0;
    for (var i1 = 0; i1 < n; i1++) Xty[j3] += Xt[j3][i1] * yc[i1];
  }

  // Intentar con lambda, fallback con 0.1 si singular
  var beta = null;
  var lambdas = [lambda, 0.1];
  for (var li = 0; li < lambdas.length && !beta; li++) {
    var lam = lambdas[li];
    var A = XtX.map(function(row, i) {
      return row.map(function(v, j) { return i === j ? v + lam : v; });
    });
    beta = _solveLinear(A, Xty);
  }
  if (!beta) {
    var zeroBeta = [];
    for (var zi = 0; zi < p; zi++) zeroBeta[zi] = 0;
    return { beta: zeroBeta, r2: 0, intercept: yMean };
  }

  // Intercept
  var intercept = yMean;
  for (var j4 = 0; j4 < p; j4++) intercept -= beta[j4] * xMean[j4];

  // R²
  var ssTot = 0, ssRes = 0;
  for (var i2 = 0; i2 < n; i2++) {
    var yhat = intercept;
    for (var j5 = 0; j5 < p; j5++) yhat += beta[j5] * X[i2][j5];
    ssTot += Math.pow(y[i2] - yMean, 2);
    ssRes += Math.pow(y[i2] - yhat, 2);
  }
  var r2 = ssTot > 1e-10 ? Math.max(0, 1 - ssRes / ssTot) : 0;

  // Desescalar a score 0-10 (y estaba en 0-1 → ×10)
  var betaScaled = beta.map(function(b) { return Math.round(b * 10 * 100) / 100; });

  return { beta: betaScaled, r2: r2, intercept: Math.round(intercept * 10 * 100) / 100 };
}

function _confidenceLevel(n) {
  if (n >= 8) return 'alta';
  if (n >= 4) return 'media';
  if (n >= 2) return 'baja';
  return 'insuficiente';
}

// ── Interacciones pairwise ────────────────────────────────────────────────────

function _computePairwise(records, ingIds) {
  var pairs   = {};
  var n       = ingIds.length;
  var allIngs = typeof window._cilab_readIngredientes === 'function' ? window._cilab_readIngredientes() : [];
  var cachedExps = null;
  try { cachedExps = JSON.parse(localStorage.getItem('bl2_experimentos')) || []; } catch(e) { cachedExps = []; }

  function mean(arr) {
    if (!arr.length) return null;
    return arr.reduce(function(s, v) { return s + v; }, 0) / arr.length;
  }

  for (var a = 0; a < n; a++) {
    for (var b = a + 1; b < n; b++) {
      var idA = ingIds[a], idB = ingIds[b];
      if (idA === '__cn__' || idB === '__cn__') continue;
      if (idA.indexOf('__quad__') === 0 || idB.indexOf('__quad__') === 0) continue;
      var gAB = [], gA = [], gB = [], gNone = [];

      records.forEach(function(r) {
        var ings = _getRecordIngs(r, allIngs, cachedExps);
        var hasA = ings.some(function(i) { return i.id === idA && i.qty > 0; });
        var hasB = ings.some(function(i) { return i.id === idB && i.qty > 0; });
        if (r.scoreFinalNorm == null) return;
        var score = r.scoreFinalNorm / 10;
        if (hasA && hasB)  gAB.push(score);
        else if (hasA)     gA.push(score);
        else if (hasB)     gB.push(score);
        else               gNone.push(score);
      });

      if (gAB.length < 3) continue;

      var mAB   = mean(gAB);
      var mA    = mean(gA);
      var mB    = mean(gB);
      var mNone = mean(gNone);

      // Usar media global como baseline para grupos vacíos
      var allScores  = gAB.concat(gA, gB, gNone);
      var globalMean = mean(allScores);
      if (mA    === null) mA    = globalMean;
      if (mB    === null) mB    = globalMean;
      if (mNone === null) mNone = globalMean;

      var interaction       = mAB - mA - mB + mNone;
      var interactionScaled = Math.round(interaction * 10 * 100) / 100;

      if (Math.abs(interaction) < 0.05) continue;

      pairs[idA + '|' + idB] = {
        ingIdA:      idA,
        ingIdB:      idB,
        interaction: interactionScaled,
        n:           gAB.length,
        type:        interaction > 0 ? 'sinergica' : 'antagonica',
      };
    }
  }
  return pairs;
}

// ── Diagnóstico de Fórmula — constantes y helpers de datos ───────────────────

var ROUTE_LABELS = {
  N0_GRADIENT:  { name: 'Gradiente nutricional',           icon: '↘', short: 'Gradiente' },
  N1_GLYC:      { name: 'Glucólisis → ATP base',           icon: '⚡', short: 'ATP base' },
  N1_ETC:       { name: 'Cadena respiratoria (ETC)',        icon: '⛓', short: 'ETC' },
  N2_ODC:       { name: 'Síntesis de poliaminas (ODC)',     icon: '⊕', short: 'ODC' },
  N2_NO_PKG:    { name: 'NO → GMPc → PKG (señal rizo)',    icon: '⚛', short: 'NO/PKG' },
  N3_SAM:       { name: 'SAM → Espermina (membrana)',       icon: '✦', short: 'SAM' },
  N3_CHITIN:    { name: 'Síntesis de quitina (pared)',      icon: '▦', short: 'Quitina' },
  N3_SPITZ:     { name: 'Spitzenkörper (Ca²⁺)',            icon: '◈', short: 'Spitzenkörper' },
  N2_REDOX:     { name: 'Control Redox / ROS / NADPH',     icon: '⚖', short: 'Redox' },
  N2_CAMP:      { name: 'Señalización cAMP / PKA',         icon: '◇', short: 'cAMP/PKA' },
  N2_AUTOPHAGY: { name: 'Autofagia / Reciclado de N',      icon: '♻', short: 'Autofagia' },
  N3_ZINC:      { name: 'Zinc — Síntesis proteica apical', icon: '⬡', short: 'Zn apical' },
  N3_MEMBRANE:  { name: 'Fluidez de membrana',              icon: '◉', short: 'Membrana' },
};

/**
 * Retorna { empiricalMean: number|null, nEnsayos: number }
 * para una fórmula + cepa específica desde bl2_crec.
 */
function _getEmpiricalStats(formulaId, cepaId) {
  var records = _creRead().filter(function(r) {
    return r.formulaId === formulaId
      && r.geneticaId === cepaId
      && r.status === 'cerrado'
      && r.scoreFinalNorm != null;
  });
  if (!records.length) return { empiricalMean: null, nEnsayos: 0 };
  var sum = records.reduce(function(s, r) { return s + r.scoreFinalNorm; }, 0);
  return {
    empiricalMean: Math.round(sum / records.length * 10) / 10,
    nEnsayos:      records.length,
  };
}

/**
 * Para cada ingrediente de ingRows con qty > 0 y coef OLS disponible,
 * calcula su contribución estimada al gap: coef × qty_norm.
 * Retorna array ordenado por |delta| descendente.
 */
function _getGapContributions(ingRows, coefs, meta) {
  var result = [];

  ingRows.forEach(function(fi) {
    var ingId = fi.id || fi.ingId;
    if (!ingId || !(fi.qty > 0)) return;
    var d = coefs && coefs[ingId];
    if (!d || d.confidence === 'insuficiente') return;

    var m      = meta[ingId] || {};
    var optMax = m.rangoOptimo && m.rangoOptimo.max > 0 ? m.rangoOptimo.max : null;
    var denom  = optMax || fi.qty || 1;
    var qtyNorm = Math.min(1, fi.qty / denom);
    var delta   = Math.round(d.coef * qtyNorm * 100) / 100;

    var routes = [];
    if (m.contribuciones) {
      Object.keys(m.contribuciones).forEach(function(rId) {
        if ((m.contribuciones[rId] || 0) > 0) routes.push(rId);
      });
    }

    result.push({
      ingId:      ingId,
      delta:      delta,
      coef:       d.coef,
      n:          d.n,
      confidence: d.confidence,
      routes:     routes,
    });
  });

  result.sort(function(a, b) { return Math.abs(b.delta) - Math.abs(a.delta); });
  return result;
}

function _diagRouteCard(routeId, state, routeIngs, isUnderestimated) {
  var lbl    = ROUTE_LABELS[routeId] || { name: routeId, icon: '●', short: routeId };
  var statusColors = {
    ACTIVA: '#22c55e', LIMITADA: '#f5c542',
    DEFICIENTE: '#f87171', INACTIVA: '#555555',
    EXCESO: '#fb923c', EXCESO_CRIT: '#dc2626',
  };
  var color     = statusColors[state.status] || '#555555';
  var intensity = state.intensity != null ? Math.round(state.intensity) : 0;

  var html = '<div class="cdiag-route-card" style="border-left-color:' + color + '">'
    + '<div class="cdiag-route-header">'
    + '<span class="cdiag-route-icon">' + _esc(lbl.icon) + '</span>'
    + '<span class="cdiag-route-name" style="color:' + color + '">' + _esc(lbl.name) + '</span>'
    + '<span class="cdiag-route-status" style="color:' + color + '">'
      + _esc(state.status) + ' ' + intensity + '%'
    + '</span>'
    + '</div>';

  if (routeIngs.length) {
    html += '<div class="cdiag-route-ings">';
    routeIngs.forEach(function(ri) {
      var coefStr = ri.coef !== null
        ? ' <span style="color:' + (ri.coef > 0.5 ? '#4ade80' : ri.coef < -0.5 ? '#f87171' : '#a0a0a0') + '">OLS ' + (ri.coef >= 0 ? '+' : '') + ri.coef.toFixed(1) + '</span>'
        : ' <span style="color:#555">sin datos OLS</span>';
      html += '<div class="cdiag-route-ing">• ' + _esc(ri.nombre)
        + ' (' + Math.round(ri.pct) + '%)'
        + coefStr + '</div>';
    });
    html += '</div>';
  }

  if (isUnderestimated) {
    html += '<div class="cdiag-underest-badge">↑ Subestimada — los datos empíricos dicen más</div>';
  }

  return html + '</div>';
}

function _diagRenderRoutes(routeStates, ingRows, coefs, meta, ingMap) {
  ingMap = ingMap || {};

  var formulaQty = {};
  ingRows.forEach(function(fi) {
    var id = fi.id || fi.ingId;
    if (id && fi.qty > 0) formulaQty[id] = fi.qty;
  });

  var routeEntries = Object.keys(ROUTE_LABELS).map(function(routeId) {
    var state = routeStates[routeId] || { status: 'INACTIVA', intensity: 0 };

    var routeIngs = [];
    Object.keys(formulaQty).forEach(function(ingId) {
      var m = meta[ingId];
      if (!m || !m.contribuciones) return;
      var pct = m.contribuciones[routeId] || 0;
      if (pct <= 0) return;
      var d = coefs && coefs[ingId];
      routeIngs.push({
        ingId:  ingId,
        nombre: ingMap[ingId] || ingId,
        pct:    pct,
        coef:   d ? d.coef : null,
      });
    });

    var posCoefs = routeIngs.filter(function(ri) { return ri.coef !== null && ri.coef > 0.5; });
    var isUnderestimated = posCoefs.length > 0
      && (posCoefs.reduce(function(s, ri) { return s + ri.coef; }, 0) / posCoefs.length) > 0.5;

    return {
      routeId:          routeId,
      state:            state,
      routeIngs:        routeIngs,
      isUnderestimated: isUnderestimated,
      hasIngs:          routeIngs.length > 0,
      intensity:        state.intensity || 0,
    };
  });

  routeEntries.sort(function(a, b) {
    var scoreA = (a.isUnderestimated ? 2 : 0) + (a.hasIngs ? 1 : 0);
    var scoreB = (b.isUnderestimated ? 2 : 0) + (b.hasIngs ? 1 : 0);
    if (scoreA !== scoreB) return scoreB - scoreA;
    return b.intensity - a.intensity;
  });

  var relevant   = routeEntries.filter(function(e) { return e.hasIngs || e.intensity > 10; });
  var irrelevant = routeEntries.filter(function(e) { return !e.hasIngs && e.intensity <= 10; });

  var html = '<div class="cdiag-panel-title">Rutas activas en tu fórmula</div>';

  relevant.forEach(function(e) {
    html += _diagRouteCard(e.routeId, e.state, e.routeIngs, e.isUnderestimated);
  });

  if (irrelevant.length) {
    html += '<div id="cdiag-routes-hidden" style="display:none">';
    irrelevant.forEach(function(e) {
      html += _diagRouteCard(e.routeId, e.state, [], false);
    });
    html += '</div>';
    html += '<button class="clab-btn clab-btn-s clab-btn-sm" style="width:100%;margin-top:4px;font-size:9px"'
      + ' onclick="var el=document.getElementById(\'cdiag-routes-hidden\');'
      + 'if(el){var show=el.style.display===\'none\';el.style.display=show?\'block\':\'none\';'
      + 'this.textContent=show?\'▲ Ocultar\':\' ▼ ' + irrelevant.length + ' rutas más\'}">'
      + '▼ ' + irrelevant.length + ' rutas más</button>';
  }

  return html;
}

function _diagRenderHeader(thScore, stats) {
  var gap      = stats.empiricalMean != null ? (stats.empiricalMean - thScore) : null;
  var gapStr   = gap === null ? '' : (gap >= 0 ? '+' : '') + Math.round(gap) + ' pts';
  var gapColor = gap === null ? '#666' : gap > 0 ? '#4ade80' : gap < 0 ? '#f87171' : '#a0a0a0';

  return '<div class="cdiag-header">'
    + '<span class="cdiag-title">🔬 Diagnóstico empírico</span>'
    + (stats.nEnsayos > 0
      ? '<span class="cdiag-n">' + stats.nEnsayos + ' ensayo' + (stats.nEnsayos > 1 ? 's' : '') + ' cerrado' + (stats.nEnsayos > 1 ? 's' : '') + ' con esta cepa</span>'
      : '<span class="cdiag-n">Sin ensayos cerrados aún</span>')
    + '<div class="cdiag-gap-bar">'
    + '<span class="cdiag-score-lbl">Teórico</span>'
    + '<span class="cdiag-score-val" style="color:var(--tx2)">' + Math.round(thScore) + '</span>'
    + '<span style="color:var(--tx3);font-size:9px">→</span>'
    + (stats.empiricalMean != null
      ? '<span class="cdiag-score-val" style="color:#4ade80">' + stats.empiricalMean + '</span>'
        + '<span class="cdiag-score-lbl">Empírico</span>'
        + '<span class="cdiag-gap-badge" style="border-color:' + gapColor + ';color:' + gapColor + '">' + _esc(gapStr) + '</span>'
      : '<span style="color:var(--tx3);font-size:9px">sin datos</span>')
    + '</div>'
    + '</div>';
}

function _diagRenderHypothesis(gap, nEnsayos, ingRows, coefs, meta, ingMap) {
  if (nEnsayos === 0) {
    return '<div class="cdiag-hypothesis cdiag-hyp-neutral">'
      + 'Sin datos empíricos aún — el diagnóstico se completará al cerrar ensayos en Conocimiento.'
      + '</div>';
  }
  if (nEnsayos < 3) {
    return '<div class="cdiag-hypothesis cdiag-hyp-warn">'
      + '⚠ Con ' + nEnsayos + ' ensayo' + (nEnsayos > 1 ? 's' : '')
      + ' el diagnóstico es exploratorio — acumulá más para mayor confianza.'
      + '</div>';
  }

  ingMap = ingMap || {};

  var contribs = _getGapContributions(ingRows, coefs, meta);
  var top3 = contribs.filter(function(c) { return c.delta > 0; }).slice(0, 3);
  var top3Names = top3.map(function(c) {
    return (ingMap[c.ingId] || c.ingId) + ' (+' + c.delta.toFixed(2) + ' pts)';
  }).join(', ');

  var cls, text;
  if (gap > 10) {
    cls  = 'cdiag-hyp-pos';
    text = '⚡ El modelo subestima esta fórmula.'
      + (top3.length ? ' Ingredientes clave: ' + top3Names + '.' : '');
  } else if (gap < -10) {
    cls  = 'cdiag-hyp-neg';
    text = '⚠ El modelo sobreestima esta fórmula. Puede haber un inhibidor activo'
      + ' o la cepa responde menos de lo esperado.';
  } else {
    cls  = 'cdiag-hyp-neutral';
    text = '✓ El modelo predice bien esta fórmula para esta cepa'
      + ' (gap ' + (gap >= 0 ? '+' : '') + Math.round(gap) + ' pts).';
  }

  return '<div class="cdiag-hypothesis ' + cls + '">' + _esc(text) + '</div>';
}

function _diagRenderGapIngredients(ingRows, coefs, meta, gap, cepaBias, ingMap) {
  var html = '<div class="cdiag-panel-title">¿Qué ingredientes explican el gap?</div>';

  if (gap === null) {
    return html + '<div style="color:var(--tx3);font-size:10px;padding:4px 0">'
      + 'Sin ensayos cerrados — aparecerá al cerrar ensayos en Conocimiento.</div>';
  }

  ingMap = ingMap || {};
  var ingMap2 = ingMap;

  var contribs = _getGapContributions(ingRows, coefs, meta);
  var top5     = contribs.slice(0, 5);

  if (!top5.length) {
    return html + '<div style="color:var(--tx3);font-size:10px;padding:4px 0">'
      + 'Sin ingredientes con datos OLS suficientes.</div>';
  }

  var maxAbs = top5.reduce(function(m, c) { return Math.max(m, Math.abs(c.delta)); }, 0.01);

  top5.forEach(function(c) {
    var barW   = Math.round(Math.abs(c.delta) / maxAbs * 100);
    var color  = c.delta > 0 ? '#4ade80' : '#f87171';
    var dSign  = c.delta >= 0 ? '+' : '';
    var rNames = c.routes.map(function(rId) {
      return ROUTE_LABELS[rId] ? ROUTE_LABELS[rId].short : rId;
    }).join(', ');

    html += '<div class="cdiag-gap-ing">'
      + '<div class="cdiag-gap-ing-top">'
      + '<span class="cdiag-gap-ing-name" style="color:' + color + '">' + _esc(ingMap2[c.ingId] || c.ingId) + '</span>'
      + '<span class="cdiag-gap-ing-delta" style="color:' + color + '">' + dSign + c.delta.toFixed(2) + ' pts del gap</span>'
      + '</div>'
      + '<div class="cdiag-gap-bar-bg"><div class="cdiag-gap-bar-fill" style="width:' + barW + '%;background:' + color + '"></div></div>'
      + '<div class="cdiag-gap-ing-meta">'
        + 'coef OLS ' + (c.coef >= 0 ? '+' : '') + c.coef.toFixed(1)
        + (rNames ? ' · ' + _esc(rNames) : '')
        + ' · ' + _confDots(c.confidence)
      + '</div>'
      + '</div>';
  });

  var explained = Math.round(contribs.reduce(function(s, c) { return s + c.delta; }, 0) * 100) / 100;
  var biasStr   = cepaBias != null ? (cepaBias >= 0 ? '+' : '') + Math.round(cepaBias) : '?';
  var gapRound  = Math.round(gap);

  html += '<div class="cdiag-gap-footer">'
    + '<div class="cdiag-gap-footer-row">'
    + '<span>Gap explicado por OLS</span>'
    + '<span style="color:#86efac">' + (explained >= 0 ? '+' : '') + explained + ' / ' + (gapRound >= 0 ? '+' : '') + gapRound + ' pts</span>'
    + '</div>'
    + '<div class="cdiag-gap-footer-row">'
    + '<span>Bias de cepa</span>'
    + '<span style="color:var(--tx2)">' + biasStr + ' pts</span>'
    + '</div>'
    + '</div>';

  return html;
}

/**
 * Genera HTML para la sección "Señales observadas" en el panel de diagnóstico.
 * Solo para records con al menos una obs enriched.complete === true.
 * Toma la obs más reciente (definitiva > preliminar > temprana > lag) con enriched completo.
 * @returns {string} HTML string (may be empty)
 */
function _renderObsSignals(record, routeStates) {
  var obs = (record.observaciones || []).filter(function(o) {
    return o.enriched && o.enriched.complete === true;
  });
  if (!obs.length) return '';

  var SIGNAL_BANK = window._cilab_SIGNAL_BANK || [];
  var attributeSignalFn = typeof window._cilab_attributeSignal === 'function'
    ? window._cilab_attributeSignal : null;
  var meta = typeof window._cilab_loadMeta === 'function' ? window._cilab_loadMeta() : {};

  // Tomar la obs más reciente con enriched completo (definitiva primero)
  var TIPO_PRIO = { definitiva: 0, preliminar: 1, temprana: 2, lag: 3 };
  obs.sort(function(a, b) {
    return (TIPO_PRIO[a.tipo] != null ? TIPO_PRIO[a.tipo] : 9)
         - (TIPO_PRIO[b.tipo] != null ? TIPO_PRIO[b.tipo] : 9);
  });
  var bestObs = obs[0];
  var signals = bestObs.enriched.signals || {};
  var formulaIngs = (record.formulaSnapshot && record.formulaSnapshot.ings) || [];

  var positive = SIGNAL_BANK.filter(function(sig) {
    var s = signals[sig.id];
    if (s == null) return false;
    if (sig.id === 'oxidacion_inoculo' || sig.id === 'oxidacion_agar' || sig.id === 'oxidacion' || sig.id === 'exudados') return s.presente === true;
    if (typeof s === 'object' && s !== null) return s.presente === true;
    return s !== null && s !== false;
  });

  if (!positive.length) {
    return '<div class="cdiag-obs-section">'
      + '<div class="cdiag-obs-title">Señales observadas (' + _esc(bestObs.tipo) + ')</div>'
      + '<div style="color:var(--tx3);font-size:11px;padding:4px 0">Sin señales detectadas en esta observación.</div>'
      + '</div>';
  }

  var html = '<div class="cdiag-obs-section">'
    + '<div class="cdiag-obs-title">Señales observadas (' + _esc(bestObs.tipo) + ')</div>';

  positive.forEach(function(sig) {
    var sigVal = signals[sig.id];
    var valStr = '';
    if ((sig.id === 'oxidacion_inoculo' || sig.id === 'oxidacion_agar' || sig.id === 'oxidacion') && sigVal) valStr = sigVal.intensidad || '';
    else if (sig.id === 'exudados' && sigVal) valStr = sigVal.color || '';
    else if (typeof sigVal === 'string') valStr = sigVal;

    html += '<div class="cdiag-obs-signal">'
      + '<div class="cdiag-obs-sig-name">' + _esc(sig.id) + (valStr ? ' — ' + _esc(valStr) : '') + '</div>'
      + '<div class="cdiag-obs-sig-q">' + _esc(sig.pregunta) + '</div>';

    if (attributeSignalFn && routeStates) {
      var attrs = attributeSignalFn(sig.id, routeStates, formulaIngs, meta);
      attrs.forEach(function(a) {
        html += '<div class="cdiag-obs-attr">'
          + '<span class="cdiag-obs-ing">' + _esc(a.ingNombre) + '</span>'
          + '<span class="cdiag-obs-razon">' + _esc(a.razon) + '</span>'
          + '</div>';
      });
    }

    html += '</div>';
  });

  return html + '</div>';
}

function renderDiagnostico(containerId, params) {
  var wrap = document.getElementById(containerId);
  if (!wrap) return;

  var model = _modelRead();
  if (!model || model.error) {
    wrap.innerHTML = '<div class="cdiag-empty">'
      + '🔬 Calculá el modelo en la tab <b>🔬 Inteligencia</b> para ver el diagnóstico empírico.'
      + '</div>';
    return;
  }

  var meta   = typeof window._cilab_loadMeta === 'function' ? window._cilab_loadMeta() : {};
  var stats  = _getEmpiricalStats(params.formulaId, params.cepaId);
  var gap    = stats.empiricalMean != null ? (stats.empiricalMean - params.thScore) : null;

  var coefs = (params.cepaId && model.byStrain && model.byStrain[params.cepaId])
    ? model.byStrain[params.cepaId].coefs
    : model.coefs;

  var cepaBias = null;
  if (typeof window._cilab_getCalibrationModel === 'function') {
    var cm = window._cilab_getCalibrationModel();
    if (cm && cm.strains && cm.strains[params.cepaId]) {
      cepaBias = cm.strains[params.cepaId].bias;
    }
  }

  // Build ingMap once — passed to all render functions to avoid triple localStorage read
  var _allIngsOnce = typeof window._cilab_readIngredientes === 'function'
    ? window._cilab_readIngredientes() : [];
  var _ingMapOnce = {};
  _allIngsOnce.forEach(function(i) { _ingMapOnce[i.id] = i.nombre || i.id; });

  // Señales observadas del record más reciente con enriched
  var _creRecs = [];
  try { _creRecs = JSON.parse(localStorage.getItem('bl2_crec')) || []; } catch(e) {}
  var _matchRec = _creRecs.filter(function(r) {
    return r.formulaId === params.formulaId
      && r.geneticaId  === params.cepaId
      && r.status      === 'cerrado';
  }).sort(function(a, b) {
    // Most recent first
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  })[0] || null;

  var _obsSignalsHtml = '';
  if (_matchRec) {
    var _recRouteStates = null;
    if (typeof window._cilab_calcEstadoRutas === 'function' && _matchRec.formulaSnapshot && _matchRec.formulaSnapshot.ings) {
      try { _recRouteStates = window._cilab_calcEstadoRutas(_matchRec.formulaSnapshot.ings, _matchRec.geneticaId); }
      catch(e) {}
    }
    _obsSignalsHtml = _renderObsSignals(_matchRec, _recRouteStates);
  }

  wrap.innerHTML = _diagRenderHeader(params.thScore, stats)
    + _diagRenderHypothesis(gap, stats.nEnsayos, params.ingRows, coefs, meta, _ingMapOnce)
    + '<div class="cdiag-grid">'
    + '<div class="cdiag-panel">' + _diagRenderRoutes(params.routeStates, params.ingRows, coefs, meta, _ingMapOnce) + '</div>'
    + '<div class="cdiag-panel">' + _diagRenderGapIngredients(params.ingRows, coefs, meta, gap, cepaBias, _ingMapOnce) + '</div>'
    + '</div>'
    + _obsSignalsHtml;
}

// ── Bootstrap Confidence Intervals ────────────────────────────────────────────
// Re-muestrea con reemplazo NBOOT veces y calcula IC90 por coeficiente.
// Un IC que cruza cero indica señal ambigua — no actuar sobre ese ingrediente.

function _bootstrapCI(X, y, ingIds, lambda) {
  var NBOOT = 100;
  var n     = X.length;
  var boots = {};
  ingIds.forEach(function(id) { boots[id] = []; });

  for (var b = 0; b < NBOOT; b++) {
    var Xb = [], yb = [];
    for (var i = 0; i < n; i++) {
      var idx = Math.floor(Math.random() * n);
      Xb.push(X[idx]);
      yb.push(y[idx]);
    }
    var reg = _ridgeRegression(Xb, yb, lambda);
    if (!reg) continue;
    ingIds.forEach(function(id, j) {
      if (reg.beta[j] !== undefined) boots[id].push(reg.beta[j]);
    });
  }

  var ci = {};
  ingIds.forEach(function(id) {
    var vals = boots[id].slice().sort(function(a, b) { return a - b; });
    if (vals.length < 40) return;
    ci[id] = {
      lo: Math.round(vals[Math.floor(vals.length * 0.05)] * 100) / 100,
      hi: Math.round(vals[Math.floor(vals.length * 0.95)] * 100) / 100,
    };
  });
  return ci;
}

// ── Modelo jerárquico entre cepas ─────────────────────────────────────────────
// Blend: w_own * coef_cepa + (1 - w_own) * coef_global
// w_own crece con N de la cepa hasta N_FULL (fully trusted at 10 records).
// Cepas con < 3 registros (sin modelo propio) usan 100% global como prior.

function _buildHierarchicalStrains(globalCoefs, globalIntercept, byStrain) {
  var N_FULL = 10;
  var result = {};

  Object.keys(byStrain).forEach(function(gId) {
    var sm  = byStrain[gId];
    var w   = Math.min(1, sm.nRecords / N_FULL);

    var allIds = {};
    Object.keys(sm.coefs).forEach(function(id) { allIds[id] = true; });
    Object.keys(globalCoefs).forEach(function(id) { allIds[id] = true; });

    var hCoefs = {};
    Object.keys(allIds).forEach(function(ingId) {
      var own   = sm.coefs[ingId]    || null;
      var glob  = globalCoefs[ingId] || null;
      var ownC  = own  ? own.coef  : null;
      var globC = glob ? glob.coef : 0;
      hCoefs[ingId] = {
        coef: ownC !== null
          ? Math.round((w * ownC + (1 - w) * globC) * 100) / 100
          : Math.round(globC * 100) / 100,
        n:          own ? own.n : 0,
        confidence: ownC !== null ? (w >= 0.5 ? own.confidence : 'baja') : 'insuficiente',
        ci90:       own ? (own.ci90 || null) : null,
        w_own:      Math.round(w * 100) / 100,
      };
    });

    result[gId] = {
      coefs:     hCoefs,
      intercept: Math.round((w * (sm.intercept || 0) + (1 - w) * (globalIntercept || 0)) * 100) / 100,
      w_own:     Math.round(w * 100) / 100,
      nOwn:      sm.nRecords,
    };
  });

  return result;
}

// ── buildModel() — orquestación ───────────────────────────────────────────────

function buildModel() {
  if (_building) return { error: 'building_in_progress' };
  _building = true;
  try {
  var allRecords = _creRead();
  var records    = _creFilterMotor(allRecords).filter(function(r) { return r.status === 'cerrado'; });

  if (records.length < 5) {
    return { error: 'insufficient_data', nRecords: records.length, minRequired: 5 };
  }

  var fm = _buildFeatureMatrix(records, 5);
  if (!fm) {
    return { error: 'insufficient_data', nRecords: records.length, minRequired: 5 };
  }

  // Lambda adaptativo: más regularización cuando hay pocas muestras por feature
  var _nSamp  = fm.X.length;
  var _nFeat  = fm.X[0] ? fm.X[0].length : 1;
  var _ratio  = _nSamp / Math.max(1, _nFeat);
  var _lambda = _ratio >= 10 ? 0.01 : _ratio >= 5 ? 0.05 : _ratio >= 2 ? 0.30 : 1.0;
  var reg = _ridgeRegression(fm.X, fm.y, _lambda);
  if (!reg) {
    return { error: 'regression_failed', nRecords: records.length };
  }

  // Coeficientes de ingredientes en la regresión
  var coefs = {};
  fm.ingIds.forEach(function(ingId, idx) {
    var n          = fm.ingCount[ingId] || 0;
    var variance   = fm.ingVariance ? (fm.ingVariance[ingId] != null ? fm.ingVariance[ingId] : null) : null;
    var confidence = _confidenceLevel(n);
    // Ingrediente con varianza casi nula: el coef es referencial, no predictivo.
    // No aplica a features auxiliares (__cn__, __quad__).
    if (variance !== null && variance < 0.01
        && ingId.indexOf('__') !== 0
        && confidence !== 'insuficiente') {
      confidence = 'indeterminate';
    }
    // Ingrediente ubicuo: OLS no tiene grupo control suficiente para deconfundir
    // su efecto del intercept. Dos condiciones independientes:
    //   1) >75% de records → ratio de control demasiado chico para regresión confiable
    //   2) <8 records sin el ingrediente → control group insuficiente en términos absolutos
    if (ingId.indexOf('__') !== 0
        && confidence !== 'insuficiente'
        && confidence !== 'indeterminate') {
      var _totalN    = fm.nTotal || fm.records.length; // nTotal incluye delta rows y synthetics
      var _ubiquity  = _totalN > 0 ? n / _totalN : 0;
      var _controlN  = _totalN - n;
      if (_ubiquity > 0.75 || _controlN < 8) confidence = 'indeterminate';
    }
    coefs[ingId] = { coef: reg.beta[idx], n: n, confidence: confidence, varianceNorm: variance };
  });

  // Bootstrap IC90 — añade ci90 a cada coef del modelo global
  var _bootCI = _bootstrapCI(fm.X, fm.y, fm.ingIds, _lambda);
  fm.ingIds.forEach(function(id) {
    if (coefs[id] && _bootCI[id]) coefs[id].ci90 = _bootCI[id];
  });

  // Ingredientes con n < 2 — no entran en regresión pero se muestran como insuficiente
  var allIngIds = {};
  var allIngsForScan = typeof window._cilab_readIngredientes === 'function' ? window._cilab_readIngredientes() : [];
  records.forEach(function(r) {
    _getRecordIngs(r, allIngsForScan).forEach(function(i) { if (i.id && i.qty > 0) allIngIds[i.id] = true; });
  });
  Object.keys(allIngIds).forEach(function(ingId) {
    if (!coefs[ingId]) {
      coefs[ingId] = { coef: 0, n: fm.ingCount[ingId] || 1, confidence: 'insuficiente' };
    }
  });

  // Conflicto bioquímico: ingrediente con rutas teóricas activas pero coef OLS negativo.
  // El Analizador asigna rutas positivas → el ingrediente DEBERÍA ayudar al rizomorfismo.
  // Si OLS dice < -2 pts con confianza real, hay contradicción — posible confounding.
  var _bioIngMap = {};
  allIngsForScan.forEach(function(i) { if (i.id) _bioIngMap[i.id] = i; });
  Object.keys(coefs).forEach(function(ingId) {
    if (ingId.indexOf('__') === 0) return;
    var coefObj = coefs[ingId];
    if (!coefObj || coefObj.confidence === 'indeterminate' || coefObj.confidence === 'insuficiente') return;
    if (coefObj.coef >= -2) return;
    var ing = _bioIngMap[ingId];
    var hasRoutes = ing && ing.contribuciones && Object.keys(ing.contribuciones).some(function(r) {
      return (ing.contribuciones[r] || 0) > 0;
    });
    if (hasRoutes) coefObj.bioConflict = true;
  });

  // Interacciones pairwise
  var pairs = _computePairwise(records, fm.ingIds);

  // Modelos por cepa (mínimo 3 registros)
  var byStrain   = {};
  var strainGroups = {};
  records.forEach(function(r) {
    var gId = r.geneticaId || '__unknown__';
    if (!strainGroups[gId]) strainGroups[gId] = [];
    strainGroups[gId].push(r);
  });
  Object.keys(strainGroups).forEach(function(gId) {
    var srecs = strainGroups[gId];
    if (srecs.length < 3) return;
    var sfm = _buildFeatureMatrix(srecs, 3);
    if (!sfm) return;
    var _sRatio  = sfm.X.length / Math.max(1, sfm.X[0] ? sfm.X[0].length : 1);
    var _sLambda = _sRatio >= 10 ? 0.01 : _sRatio >= 5 ? 0.05 : _sRatio >= 2 ? 0.30 : 1.0;
    var sreg = _ridgeRegression(sfm.X, sfm.y, _sLambda);
    if (!sreg) return;
    var scoefs = {};
    sfm.ingIds.forEach(function(ingId, idx) {
      scoefs[ingId] = {
        coef:       sreg.beta[idx],
        n:          sfm.ingCount[ingId] || 0,
        confidence: _confidenceLevel(sfm.ingCount[ingId] || 0),
      };
    });
    var gLabel = srecs.reduce(function(lbl, r) { return lbl || r.geneticaLabel || ''; }, '') || gId;
    byStrain[gId] = { geneticaLabel: gLabel, coefs: scoefs, r2: sreg.r2, nRecords: srecs.length, intercept: sreg.intercept };
  });

  var _hierarchicalStrains = _buildHierarchicalStrains(coefs, reg.intercept, byStrain);

  var model = {
    computedAt:          new Date().toISOString(),
    nRecords:            records.length,
    nIngredients:        fm.ingIds.filter(function(id) {
                           return id !== '__cn__' && id.indexOf('__quad__') !== 0;
                         }).length,
    r2:                  Math.round(reg.r2 * 1000) / 1000,
    intercept:           reg.intercept,
    lambda:              Math.round(_lambda * 1000) / 1000,
    coefs:               coefs,
    pairs:               pairs,
    byStrain:            byStrain,
    hierarchicalStrains: _hierarchicalStrains,
    nIncidence:          fm.nIncidence || 0,
  };

  _modelWrite(model);
  return model;
  } finally {
    _building = false;
  }
}

// ── UI Helpers ────────────────────────────────────────────────────────────────

function _ingName(ingId) {
  if (ingId === '__cn__') return 'Ratio C/N';
  if (ingId.indexOf('__quad__') === 0) {
    var realId  = ingId.slice(8);
    var qIngs   = typeof window._cilab_readIngredientes === 'function' ? window._cilab_readIngredientes() : [];
    var qIng    = qIngs.find(function(i) { return i.id === realId; });
    return '² ' + ((qIng && qIng.nombre) || realId) + ' (curvatura)';
  }
  var ings = typeof window._cilab_readIngredientes === 'function' ? window._cilab_readIngredientes() : [];
  var ing  = ings.find(function(i) { return i.id === ingId; });
  return (ing && ing.nombre) || ingId;
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function _onStrainChipClick(el) {
  var gId = el && el.getAttribute('data-strainid');
  if (window.cilabInt && typeof window.cilabInt.selectStrain === 'function') {
    window.cilabInt.selectStrain(gId || null);
  }
}

function _confDots(level) {
  var map = { alta: '●●●', media: '●●○', baja: '●○○', insuficiente: '○○○', indeterminate: '◌◌◌' };
  return map[level] || '○○○';
}

function _confLabel(level) {
  var map = {
    alta:          'Confianza alta',
    media:         'Confianza media',
    baja:          'Confianza baja',
    insuficiente:  'Datos insuficientes',
    indeterminate: 'Sin variación o grupo control insuficiente — coef referencial',
  };
  return map[level] || level;
}

// Abrevia "Psilocybe cubensis / APE / 244" → "PC / APE / 244"
function _abrevEspecie(label) {
  if (!label) return '?';
  var partes = label.split(' / ');
  if (partes.length < 2) return label;
  var especie = partes[0].trim();
  var resto   = partes.slice(1);
  var abrev   = especie.split(/\s+/).map(function(w) { return (w[0] || '').toUpperCase(); }).join('');
  return resto.length ? [abrev].concat(resto).join(' / ') : abrev;
}

function _renderRanking(coefs, activeStrainModel) {
  var _ings    = typeof window._cilab_readIngredientes === 'function' ? window._cilab_readIngredientes() : [];
  var _ingMap  = {};
  _ings.forEach(function(i) { _ingMap[i.id] = i.nombre || i.id; });
  function _localIngName(id) {
    if (id === '__cn__') return 'Ratio C/N';
    if (id.indexOf('__quad__') === 0) {
      var _rId = id.slice(8);
      return '² ' + (_ingMap[_rId] || _rId) + ' (curvatura)';
    }
    return _ingMap[id] || id;
  }

  var displayCoefs = activeStrainModel ? activeStrainModel.coefs : coefs;
  var entries = Object.keys(displayCoefs).map(function(id) {
    return { id: id, data: displayCoefs[id] };
  });

  var withData = entries.filter(function(e) { return e.data.confidence !== 'insuficiente'; });
  var noData   = entries.filter(function(e) { return e.data.confidence === 'insuficiente'; });

  withData.sort(function(a, b) { return Math.abs(b.data.coef) - Math.abs(a.data.coef); });

  var maxAbs = withData.reduce(function(m, e) { return Math.max(m, Math.abs(e.data.coef)); }, 0.01);
  var html = '<div class="cint-filter-bar">'
    + '<button class="cint-filter-btn active" onclick="_cintFilterRanking(this,\'all\')">Todos</button>'
    + '<button class="cint-filter-btn btn-pos" onclick="_cintFilterRanking(this,\'pos\')">↑ Potencia</button>'
    + '<button class="cint-filter-btn btn-neg" onclick="_cintFilterRanking(this,\'neg\')">↓ Inhibe</button>'
    + '<button class="cint-filter-btn btn-amb" onclick="_cintFilterRanking(this,\'amb\')">⚠ Ambiguos</button>'
    + '</div>'
    + '<div id="cint-ranking-list">';

  withData.forEach(function(e) {
    var c       = e.data.coef;
    var cls     = c > 0.5 ? 'pos' : c < -0.5 ? 'neg' : 'neu';
    var barW    = Math.round(Math.abs(c) / maxAbs * 100);
    var barDir  = c >= 0 ? 'pos' : 'neg';
    var coefStr = (c >= 0 ? '+' : '') + c.toFixed(1) + ' pts';
    var isQuad = e.id.indexOf('__quad__') === 0;
    var efectoStr = e.id === '__cn__'
      ? (c > 0.5 ? 'C/N alto favorece rizomorfismo' : c < -0.5 ? 'C/N bajo favorece rizomorfismo' : 'Sin efecto lineal del C/N')
      : isQuad
        ? (c < -0.5 ? 'Efecto meseta — dosis alta reduce el aporte' : c > 0.5 ? 'Refuerzo no-lineal — más es mejor en este rango' : 'Sin curvatura clara')
        : (c > 0.5 ? 'Potencia el rizomorfismo' : c < -0.5 ? 'Inhibe el rizomorfismo' : 'Sin efecto claro');

    var bioConflict = !isQuad && e.id !== '__cn__' && !!e.data.bioConflict;

    // Bootstrap IC90
    var ci = e.data.ci90 || null;
    var ciAmbiguous = ci && ci.lo <= 0 && ci.hi >= 0;
    var ciStr = ci
      ? (ciAmbiguous
          ? ' · ⚠ IC₉₀ cruza cero'
          : ' · IC₉₀ [' + (ci.lo >= 0 ? '+' : '') + ci.lo + ', ' + (ci.hi >= 0 ? '+' : '') + ci.hi + ']')
      : '';

    var bioConflictTitle = bioConflict
      ? ' · ⚠ Conflicto bioquímico: el Analizador le asigna rutas positivas pero el modelo empírico lo señala inhibidor — posible confounding en los datos.'
      : '';
    var titleStr = efectoStr + ' · ' + _confLabel(e.data.confidence) + ' · ' + e.data.n + ' ensayos'
      + (ci ? ' · IC₉₀ [' + ci.lo + ', ' + ci.hi + ']' : '')
      + bioConflictTitle;
    var rowOpacity = ciAmbiguous ? 'opacity:0.65;' : '';
    var bioConflictBadge = bioConflict
      ? '<span style="font-size:8px;background:rgba(245,158,11,0.15);color:#f59e0b;border:1px solid rgba(245,158,11,0.3);border-radius:3px;padding:0 3px;margin-left:4px">⚠ confounding?</span>'
      : '';

    html += '<div class="cint-ing-row ' + cls + '" data-ci-ambiguous="' + (ciAmbiguous ? '1' : '0') + '" style="' + rowOpacity + '" title="' + _esc(titleStr) + '">'
      + '<div class="cint-ing-bar-wrap"><div class="cint-ing-bar ' + barDir + '" style="width:' + barW + '%"></div></div>'
      + '<div style="flex:1;min-width:0">'
      + '<div class="cint-ing-name">' + _esc(_localIngName(e.id)) + '' + bioConflictBadge + '</div>'
      + '<div style="font-size:9px;color:' + (cls === 'pos' ? '#4a8a6a' : cls === 'neg' ? '#9a3a3a' : 'var(--tx3)') + '">'
        + _esc(efectoStr) + ' · ' + _confDots(e.data.confidence) + ' ' + e.data.n + ' ens.'
        + '<span style="color:' + (ciAmbiguous ? '#f87171' : '#666') + '">' + _esc(ciStr) + '</span>'
      + '</div>'
      + '</div>'
      + '<span class="cint-ing-coef">' + _esc(coefStr) + '</span>'
      + '</div>';
  });

  html += '</div>'; // cierra cint-ranking-list
  if (noData.length) {
    html += '<div class="cint-ing-insuf">+ ' + noData.length + ' ingrediente(s) sin datos suficientes (n&lt;2)</div>';
  }
  return html || '<div class="cint-ing-insuf">Sin ingredientes con datos suficientes</div>';
}

function _renderPairs(pairs) {
  var _ings2   = typeof window._cilab_readIngredientes === 'function' ? window._cilab_readIngredientes() : [];
  var _ingMap2 = {};
  _ings2.forEach(function(i) { _ingMap2[i.id] = i.nombre || i.id; });
  function _localIngName2(id) { return id === '__cn__' ? 'Ratio C/N' : (_ingMap2[id] || id); }

  var keys = Object.keys(pairs);
  if (!keys.length) {
    return '<div style="color:var(--tx3);font-size:11px;padding:4px 0">Sin interacciones detectadas con n≥3</div>';
  }
  keys.sort(function(a, b) { return Math.abs(pairs[b].interaction) - Math.abs(pairs[a].interaction); });
  var _pairsBar = '<div class="cint-filter-bar">'
    + '<button class="cint-filter-btn active" onclick="_cintFilterPairs(this,\'all\')">Todas</button>'
    + '<button class="cint-filter-btn btn-sin" onclick="_cintFilterPairs(this,\'sin\')">⚡ Sinérgicas</button>'
    + '<button class="cint-filter-btn btn-ant" onclick="_cintFilterPairs(this,\'ant\')">⚠ Antagónicas</button>'
    + '</div>'
    + '<div id="cint-pairs-list">';
  return _pairsBar + keys.map(function(k) {
    var p     = pairs[k];
    var cls   = p.type === 'sinergica' ? 'sin' : 'ant';
    var label = p.type === 'sinergica' ? '⚡ SINÉRGICA' : '⚠ ANTAGÓNICA';
    var valStr = (p.interaction >= 0 ? '+' : '') + p.interaction.toFixed(1) + ' pts';
    var explainStr = p.type === 'sinergica'
      ? 'Juntos suben el score más que cada uno por separado'
      : 'Juntos bajan el score más de lo esperado por cada uno';
    return '<div class="cint-pair-card ' + cls + '">'
      + '<div><span class="cint-pair-badge ' + cls + '">' + label + '</span>'
      + ' <span class="cint-pair-n">' + p.n + ' ensayos con ambos</span></div>'
      + '<div class="cint-pair-title ' + cls + '">'
        + _esc(_localIngName2(p.ingIdA)) + ' + ' + _esc(_localIngName2(p.ingIdB)) + ' → <b>' + _esc(valStr) + '</b>'
      + '</div>'
      + '<div style="font-size:9px;color:var(--tx3);margin-top:3px">' + _esc(explainStr) + '</div>'
      + '</div>';
  }).join('') + '</div>'; // cierra cint-pairs-list
}

function _renderStats(model) {
  var r2Pct  = Math.round(model.r2 * 100);
  var r2Color = r2Pct >= 50 ? '#22c55e' : r2Pct >= 30 ? '#f5c542' : '#f87171';
  var html = '<div style="margin-bottom:10px">'
    + '<div style="display:flex;justify-content:space-between;margin-bottom:4px">'
    + '<span style="font-size:10px;color:var(--tx2)">Ajuste R²</span>'
    + '<span style="font-size:10px;font-weight:bold;color:' + r2Color + '">' + r2Pct + '%</span>'
    + '</div>'
    + '<div class="cint-r2-bar-bg"><div class="cint-r2-bar" style="width:' + r2Pct + '%;background:' + r2Color + '"></div></div>'
    + '<div style="font-size:9px;color:var(--tx3);margin-top:3px">El modelo explica el ' + r2Pct + '% de la varianza observada</div>'
    + '</div>'
    + '<div class="cint-stats-grid">'
    + '<div class="cint-stat-box"><div class="cint-stat-val">' + model.nRecords + '</div><div class="cint-stat-lbl">registros usados</div></div>'
    + '<div class="cint-stat-box"><div class="cint-stat-val">' + model.nIngredients + '</div><div class="cint-stat-lbl">ingredientes analizados</div></div>'
    + '<div class="cint-stat-box"><div class="cint-stat-val">' + Object.keys(model.pairs).length + '</div><div class="cint-stat-lbl">interacciones detectadas</div></div>'
    + '<div class="cint-stat-box"><div class="cint-stat-val" style="font-size:13px">λ=' + (model.lambda != null ? model.lambda : 0.01) + '</div><div class="cint-stat-lbl">regularización Ridge</div></div>'
    + '</div>'
    + (model.nIncidence > 0
      ? '<div class="cint-info">📊 Target: ' + model.nIncidence + ' registros usan incidencia objetiva (rizoPozitivas/totalPlacas), '
        + (model.nRecords - model.nIncidence) + ' usan score subjetivo.</div>'
      : '<div class="cint-warning">⚠ Sin datos de incidencia de placas — el modelo entrena solo sobre score subjetivo. Registrá placas positivas en cada ensayo definitivo para mejorar la señal.</div>');
  if (r2Pct >= 90 && model.nRecords < 30) {
    html += '<div class="cint-warning">⚠ R²=' + r2Pct + '% con solo ' + model.nRecords + ' ensayos — el modelo memorizó los datos en lugar de aprender patrones generales. Los coeficientes son indicativos. Acumulá más ensayos para validar.</div>';
  } else if (r2Pct < 30) {
    html += '<div class="cint-warning">⚠ Ajuste bajo (R²=' + r2Pct + '%) — los ingredientes solos no explican bien las diferencias de score. Puede haber otros factores (cepa, técnica, temperatura).</div>';
  } else if (model.nRecords < 10) {
    html += '<div class="cint-info">Con ' + model.nRecords + ' registros el modelo es exploratorio — los coeficientes pueden cambiar bastante al agregar nuevos ensayos.</div>';
  }
  return html;
}

function _renderSuggestions(model, strainId) {
  var _ings3    = typeof window._cilab_readIngredientes === 'function' ? window._cilab_readIngredientes() : [];
  var _ingMap3  = {};
  var _unitMap3 = {};
  _ings3.forEach(function(i) { _ingMap3[i.id] = i.nombre || i.id; _unitMap3[i.id] = i.unidad || 'g'; });
  function _localIngName3(id) { return id === '__cn__' ? 'Ratio C/N' : (_ingMap3[id] || id); }
  function _localIngUnit3(id) { return _unitMap3[id] || 'g'; }

  if (model.r2 < 0.30 || model.nRecords < 5) {
    return '<div style="color:var(--tx3);font-size:11px">Modelo con datos insuficientes para sugerencias (R²=' + Math.round(model.r2 * 100) + '%)</div>';
  }

  var coefs  = strainId && model.byStrain && model.byStrain[strainId] ? model.byStrain[strainId].coefs : model.coefs;
  var meta   = typeof window._cilab_loadMeta === 'function' ? window._cilab_loadMeta() : {};
  var forms  = typeof window._cilab_readForms === 'function' ? window._cilab_readForms() : [];
  var frmId  = typeof window._cilab_getActiveFormulaId === 'function' ? window._cilab_getActiveFormulaId() : null;
  var form   = frmId ? forms.find(function(f) { return f.id === frmId; }) : null;
  var activeIngs = {};
  if (form && form.ingredientes) {
    form.ingredientes.forEach(function(fi) { if (fi.qty > 0) activeIngs[fi.id] = fi.qty; });
  }

  var sugs = [];
  Object.keys(coefs).forEach(function(ingId) {
    var d = coefs[ingId];
    if (!d || d.confidence === 'insuficiente' || Math.abs(d.coef) < 0.5) return;
    if (ingId === '__cn__' || ingId.indexOf('__quad__') === 0) return;
    var m      = meta[ingId] || {};
    var optMin = m.rangoOptimo && m.rangoOptimo.min > 0 ? m.rangoOptimo.min : null;
    var optMax = m.rangoOptimo && m.rangoOptimo.max > 0 ? m.rangoOptimo.max : null;

    if (d.coef > 0.5) {
      var currQty = activeIngs[ingId] || 0;
      if (currQty === 0 && optMin) {
        var qtyNorm = optMax ? optMin / optMax : 0.5;
        sugs.push({ type: 'add', ingId: ingId, coef: d.coef, delta: Math.round(d.coef * qtyNorm * 100) / 100, meta: 'ausente · agregar ' + optMin + _localIngUnit3(ingId) });
      } else if (currQty > 0 && optMin && currQty < optMin) {
        var qtyNorm2 = optMax ? (optMin - currQty) / optMax : 0.3;
        sugs.push({ type: 'up', ingId: ingId, coef: d.coef, delta: Math.round(d.coef * qtyNorm2 * 100) / 100, meta: 'actual ' + currQty + ' → sugerido ' + optMin + _localIngUnit3(ingId) });
      }
    } else if (d.coef < -0.5 && activeIngs[ingId] > 0) {
      var downQty    = activeIngs[ingId];
      var downTarget = (optMin !== null && optMin < downQty) ? optMin : 0;
      var downUnit   = _localIngUnit3(ingId);
      var downMeta   = downQty + downUnit + ' → ' + (downTarget === 0 ? 'retirar' : downTarget + downUnit);
      sugs.push({ type: 'down', ingId: ingId, coef: d.coef, delta: d.coef, meta: downMeta });
    }
  });

  if (!sugs.length) {
    return '<div style="color:var(--tx3);font-size:11px">' + (frmId ? 'Sin sugerencias para la fórmula activa' : 'Seleccioná una fórmula en el Analizador para ver sugerencias') + '</div>';
  }

  sugs.sort(function(a, b) { return Math.abs(b.delta) - Math.abs(a.delta); });
  sugs = sugs.slice(0, 5);

  var sugHdr = '<div style="font-size:9px;color:var(--tx3);margin-bottom:8px">Estimaciones basadas en los coeficientes del modelo — no son garantías, son hipótesis para probar.</div>';
  return sugHdr + sugs.map(function(s) {
    var icon  = s.type === 'add' ? '＋ Agregar' : s.type === 'up' ? '↑ Subir' : '↓ Reducir';
    var dSign = s.delta >= 0 ? '+' : '';
    var dCls  = s.delta >= 0 ? 'pos' : 'neg';
    var aCls  = s.type === 'down' ? 'down' : (s.type === 'up' ? 'up' : 'add');
    return '<div class="cint-sug-row ' + s.type + '">'
      + '<div><span class="cint-sug-action ' + aCls + '">' + icon + ' <b>' + _esc(_localIngName3(s.ingId)) + '</b></span>'
      + '<div class="cint-sug-meta">' + _esc(s.meta) + '</div></div>'
      + '<span class="cint-sug-delta ' + dCls + '" title="Estimación orientativa">~' + dSign + s.delta.toFixed(1) + ' pts</span>'
      + '</div>';
  }).join('');
}

// ── Panel de auditoría de datos ────────────────────────────────────────────────

function _renderAudit() {
  var allRecords = _creRead();

  var excludedFormulas = {};
  try {
    var ex = JSON.parse(localStorage.getItem(K_EXCL)) || [];
    ex.forEach(function(id) { excludedFormulas[id] = true; });
  } catch(e) {}

  var allIngs = typeof window._cilab_readIngredientes === 'function' ? window._cilab_readIngredientes() : [];
  var ingMap  = {};
  var unitMap = {};
  allIngs.forEach(function(i) { ingMap[i.id] = i.nombre || i.id; unitMap[i.id] = i.unidad || 'ud'; });

  var cachedExps = [];
  try { cachedExps = JSON.parse(localStorage.getItem('bl2_experimentos')) || []; } catch(e) {}

  var _calcCN = typeof window._cilab_calcCN === 'function' ? window._cilab_calcCN : null;

  var nUsed = 0, nIncidencia = 0, nSubjetivo = 0, nExcluidos = 0;
  var uniqueIngs = {}, uniqueCepas = {};

  var rows = allRecords.map(function(r) {
    var isExcluded   = !!excludedFormulas[r.formulaId];
    var isOpen       = r.status !== 'cerrado';
    var hasIncidence = r.rizoPozitivas != null && r.totalPlacas > 0;
    var hasScore     = r.scoreFinalNorm != null;

    if (isExcluded) nExcluidos++;

    var estado, estadoCls;
    if (isExcluded)                    { estado = 'Excluido';   estadoCls = 'caud-excl'; }
    else if (isOpen)                   { estado = 'Abierto';    estadoCls = 'caud-open'; }
    else if (!hasIncidence && !hasScore) { estado = 'Sin target'; estadoCls = 'caud-notarget'; }
    else                               { estado = 'Usado';      estadoCls = 'caud-used'; nUsed++; }

    var targetStr, targetCls;
    if (hasIncidence) {
      var pct   = (r.rizoPozitivas / r.totalPlacas * 100).toFixed(1);
      targetStr = pct + '% (' + r.rizoPozitivas + '/' + r.totalPlacas + ')';
      targetCls = 'caud-tincid';
      if (!isExcluded && !isOpen) nIncidencia++;
    } else if (hasScore) {
      targetStr = (r.scoreFinalNorm / 10).toFixed(1) + '/10';
      targetCls = 'caud-tsubj';
      if (!isExcluded && !isOpen) nSubjetivo++;
    } else {
      targetStr = '—';
      targetCls = '';
    }

    var recIngs = _getRecordIngs(r, allIngs, cachedExps);

    var cnStr = '—';
    if (_calcCN) {
      try {
        var res = _calcCN(recIngs, allIngs);
        if (res && res.cn != null && res.cn > 0 && res.cn < 100) cnStr = res.cn.toFixed(1);
      } catch(e) {}
    }

    var extrasStr = '—';
    if (r.experimentoId && r.frascoId) {
      var exp    = cachedExps.find(function(e) { return e.id === r.experimentoId; });
      var fr     = exp && (exp.frascos || []).find(function(f) { return f.label === r.frascoId; });
      var extras = fr && fr.extras ? fr.extras.filter(function(ex) { return ex.ingId && ex.qty > 0; }) : [];
      if (extras.length) extrasStr = extras.map(function(ex) {
        return (ingMap[ex.ingId] || ex.ingId) + ' ' + ex.qty + ' ' + (unitMap[ex.ingId] || 'ud');
      }).join(', ');
    }

    if (estado === 'Usado') {
      recIngs.forEach(function(i) { if (i.id && i.qty > 0) uniqueIngs[i.id] = true; });
      if (r.geneticaId) uniqueCepas[r.geneticaId] = true;
    }

    return {
      r:             r,
      estado:        estado,
      estadoCls:     estadoCls,
      targetStr:     targetStr,
      targetCls:     targetCls,
      cnStr:         cnStr,
      extrasStr:     extrasStr,
      formulaNombre: (r.formulaSnapshot && r.formulaSnapshot.nombre) || r.formulaId || '?',
      idShort:       (r.id || '').slice(-8),
      cepaStr:       (r.geneticaLabel ? _abrevEspecie(r.geneticaLabel) : null) || (r.geneticaId ? r.geneticaId.slice(0, 8) : '?'),
    };
  });

  var ORDER = { 'Usado': 0, 'Sin target': 1, 'Abierto': 2, 'Excluido': 3 };
  rows.sort(function(a, b) { return (ORDER[a.estado] || 0) - (ORDER[b.estado] || 0); });

  var tableRows = rows.map(function(row) {
    var r = row.r;
    var canDelete = row.estado === 'Usado' || row.estado === 'Sin target';
    var delCell = canDelete
      ? '<td><button class="caud-del-btn" data-id="' + _esc(r.id || '') + '" onclick="cilabInt.deleteAuditRecord(this.getAttribute(\'data-id\'))" title="Eliminar registro de bl2_crec">✕</button></td>'
      : '<td></td>';
    return '<tr>'
      + '<td class="caud-col-id" title="' + _esc(r.id || '') + '">' + _esc(row.idShort) + '</td>'
      + '<td class="caud-col-form">' + _esc(row.formulaNombre) + '</td>'
      + '<td class="caud-col-frasco">' + _esc(r.frascoId || '—') + '</td>'
      + '<td class="caud-col-cepa">' + _esc(row.cepaStr) + '</td>'
      + '<td class="caud-col-extras" title="' + _esc(row.extrasStr) + '">' + _esc(row.extrasStr) + '</td>'
      + '<td class="caud-col-target ' + row.targetCls + '">' + _esc(row.targetStr) + '</td>'
      + '<td class="caud-col-cn">' + _esc(row.cnStr) + '</td>'
      + '<td><span class="caud-badge ' + row.estadoCls + '">' + _esc(row.estado) + '</span></td>'
      + delCell
      + '</tr>';
  }).join('');

  var nTotal     = allRecords.length;
  var nIngUnicos = Object.keys(uniqueIngs).length;
  var nCepas     = Object.keys(uniqueCepas).length;

  return '<div class="caud-header">'
    + '<span style="font-size:12px;font-weight:600;color:var(--tx)">Auditoría de registros · datos de entrenamiento</span>'
    + '<button class="clab-btn clab-btn-s clab-btn-sm" onclick="cilabInt.hideAudit()">← Volver al análisis</button>'
    + '</div>'
    + '<div class="caud-summary">'
    + '<div class="caud-sum-box"><div class="caud-sum-val">' + nTotal + '</div><div class="caud-sum-lbl">total</div></div>'
    + '<div class="caud-sum-box caud-used"><div class="caud-sum-val">' + nUsed + '</div><div class="caud-sum-lbl">en modelo</div></div>'
    + '<div class="caud-sum-box caud-tincid"><div class="caud-sum-val">' + nIncidencia + '</div><div class="caud-sum-lbl">incid. obj.</div></div>'
    + '<div class="caud-sum-box caud-tsubj"><div class="caud-sum-val">' + nSubjetivo + '</div><div class="caud-sum-lbl">score subj.</div></div>'
    + '<div class="caud-sum-box caud-excl"><div class="caud-sum-val">' + nExcluidos + '</div><div class="caud-sum-lbl">excluidos</div></div>'
    + '<div class="caud-sum-box"><div class="caud-sum-val">' + nIngUnicos + '</div><div class="caud-sum-lbl">ings únicos</div></div>'
    + '<div class="caud-sum-box"><div class="caud-sum-val">' + nCepas + '</div><div class="caud-sum-lbl">cepas</div></div>'
    + '</div>'
    + '<div class="caud-scroll">'
    + '<table class="caud-table">'
    + '<thead><tr>'
    + '<th>ID</th><th>Fórmula</th><th>Frasco</th><th>Cepa</th><th>Extras</th><th>Target</th><th>C/N</th><th>Estado</th><th></th>'
    + '</tr></thead>'
    + '<tbody>' + tableRows + '</tbody>'
    + '</table>'
    + '</div>';
}

// ── Panel de madurez del motor ────────────────────────────────────────────────

function _renderMaturityPanel() {
  var allRecords = _creRead();
  var closedRecords = _creFilterMotor(allRecords).filter(function(r) { return r.status === 'cerrado'; });
  var N = closedRecords.length;

  var strainCounts = {};
  closedRecords.forEach(function(r) {
    var gId = r.geneticaId || '__unknown__';
    strainCounts[gId] = (strainCounts[gId] || 0) + 1;
  });
  var nStrains = Object.keys(strainCounts).length;
  var strainsWithModel = Object.keys(strainCounts).filter(function(gId) { return strainCounts[gId] >= 3; }).length;

  var allIngsM  = typeof window._cilab_readIngredientes === 'function' ? window._cilab_readIngredientes() : [];
  var expsCacheM = null;
  try { expsCacheM = JSON.parse(localStorage.getItem('bl2_experimentos')) || []; } catch(e) { expsCacheM = []; }
  var uniqueIngsM = {};
  closedRecords.forEach(function(r) {
    _getRecordIngs(r, allIngsM, expsCacheM).forEach(function(i) {
      if (i.id && i.qty > 0) uniqueIngsM[i.id] = true;
    });
  });
  var nUniqueIngs = Object.keys(uniqueIngsM).length;

  var TARGET_RELIABLE = 20;
  var TARGET_SIGNAL   = 15;
  var TARGET_MIN      = 5;

  var pct = Math.min(100, Math.round(N / TARGET_RELIABLE * 100));
  var barColor = N >= TARGET_RELIABLE ? '#22c55e' : N >= TARGET_SIGNAL ? '#f5c542' : N >= TARGET_MIN ? '#f87171' : '#555';

  var statusText, statusColor;
  if (N >= TARGET_RELIABLE) {
    statusText = '✓ Motor confiable — los coeficientes reflejan patrones reales';
    statusColor = '#22c55e';
  } else if (N >= TARGET_SIGNAL) {
    statusText = '↑ Señal emergente — coeficientes útiles, seguirán ajustándose';
    statusColor = '#f5c542';
  } else if (N >= TARGET_MIN) {
    statusText = '⚠ Exploratorio — el motor calcula pero no distingue señal de ruido';
    statusColor = '#f87171';
  } else {
    statusText = '✕ Insuficiente — necesitás al menos ' + TARGET_MIN + ' registros cerrados para activar el motor';
    statusColor = '#888';
  }

  var nextN, nextLabel;
  if (N < TARGET_MIN)      { nextN = TARGET_MIN;      nextLabel = 'Mínimo para activar el motor'; }
  else if (N < TARGET_SIGNAL)  { nextN = TARGET_SIGNAL;  nextLabel = 'Señal real empieza a emerger'; }
  else if (N < TARGET_RELIABLE){ nextN = TARGET_RELIABLE; nextLabel = 'Motor confiable'; }
  else { nextN = null; }

  var html = '<div class="cmat-panel">'
    + '<div class="cmat-title">🧠 Madurez del motor de aprendizaje</div>'
    + '<div class="cmat-status" style="color:' + statusColor + '">' + _esc(statusText) + '</div>'
    + '<div class="cmat-bar-row">'
    + '<div class="cmat-bar-bg"><div class="cmat-bar-fill" style="width:' + pct + '%;background:' + barColor + '"></div></div>'
    + '<span class="cmat-bar-label">' + N + ' / ' + TARGET_RELIABLE + ' registros</span>'
    + '</div>';

  if (nextN !== null) {
    var toGo = nextN - N;
    html += '<div class="cmat-next">Próximo hito: <b>' + _esc(nextLabel) + '</b> — falt' + (toGo === 1 ? 'a' : 'an') + ' <b>' + toGo + ' registro' + (toGo > 1 ? 's' : '') + '</b></div>';
  }

  html += '<div class="cmat-grid">'
    + '<div class="cmat-stat">'
      + '<div class="cmat-stat-val" style="color:' + barColor + '">' + N + '</div>'
      + '<div class="cmat-stat-lbl">registros cerrados</div>'
    + '</div>'
    + '<div class="cmat-stat">'
      + '<div class="cmat-stat-val" style="color:' + (strainsWithModel > 0 ? '#22c55e' : '#888') + '">' + strainsWithModel + '</div>'
      + '<div class="cmat-stat-lbl">cepas con modelo propio</div>'
    + '</div>'
    + '<div class="cmat-stat">'
      + '<div class="cmat-stat-val">' + nUniqueIngs + '</div>'
      + '<div class="cmat-stat-lbl">ingredientes en el pool</div>'
    + '</div>'
    + '<div class="cmat-stat">'
      + '<div class="cmat-stat-val">' + nStrains + '</div>'
      + '<div class="cmat-stat-lbl">cepas distintas</div>'
    + '</div>'
    + '</div>';

  if (nStrains > 0) {
    html += '<div class="cmat-strains">';
    Object.keys(strainCounts).forEach(function(gId) {
      var cnt   = strainCounts[gId];
      var label = gId;
      try {
        var rec = closedRecords.find(function(r) { return r.geneticaId === gId; });
        if (rec && rec.geneticaLabel) label = rec.geneticaLabel;
      } catch(e) {}
      var fillPct  = Math.min(100, Math.round(cnt / 3 * 100));
      var fillColor = cnt >= 3 ? '#22c55e' : '#f5c542';
      html += '<div class="cmat-strain-row">'
        + '<span class="cmat-strain-name" title="' + _esc(label) + '">' + _esc(_abrevEspecie(label)) + '</span>'
        + '<div class="cmat-strain-bar-bg"><div class="cmat-strain-bar" style="width:' + fillPct + '%;background:' + fillColor + '"></div></div>'
        + '<span class="cmat-strain-cnt" style="color:' + fillColor + '">' + cnt + ' reg.</span>'
        + (cnt >= 3
          ? '<span class="cmat-model-badge">✓ modelo</span>'
          : '<span class="cmat-model-missing">+' + (3 - cnt) + ' para modelo propio</span>')
        + '</div>';
    });
    html += '</div>';
  }

  html += '</div>';
  return html;
}

// ── UI principal ──────────────────────────────────────────────────────────────

function renderInteligencia() {
  var wrap = document.getElementById('clab-sub-inteligencia');
  if (!wrap) return;

  var model      = _modelRead();
  var strainId   = null;
  var _showAudit = false;

  function _strainModel() {
    return strainId && model && model.byStrain && model.byStrain[strainId]
      ? model.byStrain[strainId] : null;
  }

  function _getStrainLabel(gId) {
    // Primary: use label stored in model (derived from bl2_crec.geneticaLabel)
    if (model && model.byStrain && model.byStrain[gId] && model.byStrain[gId].geneticaLabel) {
      return _abrevEspecie(model.byStrain[gId].geneticaLabel);
    }
    // Fallback: GE genetics lookup
    try {
      var gens = window.ge && typeof window.ge.getSelectableGenetics === 'function'
        ? window.ge.getSelectableGenetics()
        : (JSON.parse(localStorage.getItem('biolab.ge.v4') || '{"nodes":[]}').nodes || []);
      var g = gens.find(function(x) { return x.id === gId || x.value === gId; });
      if (g) return _abrevEspecie(g.label || g.nombre || gId);
    } catch(e) {}
    return gId;
  }

  function _renderFull() {
    if (_showAudit) { wrap.innerHTML = _renderAudit(); return; }
    if (!model || model.error) {
      var errMsg = !model ? '' : (model.error === 'insufficient_data'
        ? 'Necesitás al menos 5 ensayos cerrados. Tenés ' + (model.nRecords || 0) + '.'
        : 'Error al calcular el modelo.');
      wrap.innerHTML = _renderMaturityPanel()
        + '<div style="padding:8px 14px;background:var(--bg-secondary);border-bottom:1px solid #333;display:flex;gap:8px">'
        + '<button class="clab-btn clab-btn-p" onclick="cilabInt.buildAndRender()">⚡ Calcular modelo</button>'
        + '<label class="clab-btn clab-btn-s clab-btn-sm" style="cursor:pointer" title="Importar análisis guardado"><input type="file" accept=".json" style="display:none" onchange="cilabInt.importModel(this)">⬆ Importar análisis</label>'
        + '<button class="clab-btn clab-btn-s clab-btn-sm" onclick="cilabInt.showAudit()" title="Ver todos los registros y por qué cada uno entró o no al modelo">🔍 Auditar datos</button>'
        + '</div>'
        + '<div class="cint-empty">'
        + '<span>🔬 Motor de Inteligencia Empírica</span>'
        + (errMsg ? '<div class="cint-error-banner">' + _esc(errMsg) + '</div>' : '<div style="font-size:11px;color:var(--tx3);text-align:center;max-width:360px">Analizá cuáles ingredientes potencian o inhiben el rizomorfismo en tus datos empíricos.<br>Necesitás al menos 5 ensayos cerrados en Conocimiento.</div>')
        + '</div>';
      return;
    }

    var sm    = _strainModel();
    var tsStr = model.computedAt ? new Date(model.computedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '?';
    var r2Str = Math.round(model.r2 * 100) + '%';

    var chips = '<span class="cint-strain-chip' + (!strainId ? ' active' : '') + '" data-strainid="" onclick="_cintStrainClick(this)">Global</span>';
    Object.keys(model.byStrain || {}).forEach(function(gId) {
      var sm2 = model.byStrain[gId];
      var lbl = _getStrainLabel(gId);
      if (lbl.length > 20) lbl = lbl.slice(0, 18) + '…';
      chips += '<span class="cint-strain-chip' + (strainId === gId ? ' active' : '') + '" data-strainid="' + _esc(gId) + '" onclick="_cintStrainClick(this)">'
        + _esc(lbl) + ' <small>(' + _esc(String(sm2.nRecords)) + ')</small></span>';
    });

    var statsModel = sm
      ? { r2: sm.r2, nRecords: sm.nRecords, nIngredients: Object.keys(sm.coefs).length, pairs: model.pairs }
      : model;

    var activeLabel = strainId ? _getStrainLabel(strainId) : 'todos tus ensayos';
    var introText   = strainId
      ? 'Analizando ' + model.byStrain[strainId].nRecords + ' ensayos de <b>' + _esc(activeLabel) + '</b>'
      : 'Analizando <b>' + model.nRecords + ' ensayos</b> cerrados de todas tus cepas';
    var chipsHint = Object.keys(model.byStrain || {}).length
      ? '<span style="font-size:9px;color:var(--tx3);margin-left:4px">↑ Clic en una cepa para ver su análisis individual</span>'
      : '';

    var html = _renderMaturityPanel()
      + '<div class="cint-toolbar">'
      + '<button class="clab-btn clab-btn-p clab-btn-sm" onclick="cilabInt.buildAndRender()">⚡ Recalcular</button>'
      + '<button class="clab-btn clab-btn-s clab-btn-sm" onclick="cilabInt.exportModel()" title="Exportar análisis como JSON">⬇ Exportar</button>'
      + '<label class="clab-btn clab-btn-s clab-btn-sm" style="cursor:pointer" title="Importar análisis desde JSON"><input type="file" accept=".json" style="display:none" onchange="cilabInt.importModel(this)">⬆ Importar</label>'
      + '<button class="clab-btn clab-btn-sm cre-danger-btn" onclick="cilabInt.resetModel()" title="Borrar análisis y recalcular desde cero">🗑 Resetear</button>'
      + '<button class="clab-btn clab-btn-s clab-btn-sm" onclick="cilabInt.showAudit()" title="Ver todos los registros y por qué cada uno entró o no al modelo">🔍 Auditar datos</button>'
      + '<span class="cint-toolbar-meta">' + tsStr + ' · R²=' + r2Str + '</span>'
      + '<div class="cint-strain-chips">' + chips + chipsHint + '</div>'
      + '</div>'
      // Intro card
      + '<div style="padding:10px 14px;background:rgba(124,111,255,0.08);border-bottom:1px solid #333;font-size:11px;color:var(--tx2)">'
      + '🔬 ' + introText + '. '
      + 'Los coeficientes muestran cómo cada ingrediente afecta el score de rizomorfismo en tus propios datos. '
      + '<span style="color:var(--tx3)">Verde = potencia · Rojo = inhibe · Gris = sin efecto claro o datos insuficientes</span>'
      + ' <button onclick="var el=document.getElementById(\'cint-how-it-works\');el.style.display=el.style.display===\'none\'?\'block\':\'none\'" style="background:none;border:1px solid #555;color:var(--tx3);font-size:9px;padding:1px 6px;border-radius:3px;cursor:pointer;margin-left:6px">¿Cómo funciona?</button>'
      + '</div>'
      // Panel "Cómo funciona el motor"
      + '<div id="cint-how-it-works" style="display:none;padding:14px 16px;background:#1a1a2e;border-bottom:1px solid #333;font-size:10px;color:var(--tx2);line-height:1.7">'
      + '<div style="font-size:11px;font-weight:600;color:var(--tx1);margin-bottom:12px">Cómo razona este motor</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px 24px">'

      // ── Modo 1: registros normales ──
      + '<div>'
        + '<div style="color:#a78bfa;font-weight:600;margin-bottom:4px">📋 Modo 1 — Registros normales</div>'
        + 'Para cada ensayo cerrado, el motor anota: <i>¿qué ingredientes tenía la fórmula y en qué cantidad? ¿Qué score rizomórfico obtuvo?</i> '
        + 'Con todos los ensayos acumulados aplica <b>regresión OLS ridge</b> para asignarle a cada ingrediente su contribución marginal — '
        + 'separando el efecto de cada uno de los que co-aparecen juntos.'
      + '</div>'

      // ── Modo 2: experimentos A/B ──
      + '<div>'
        + '<div style="color:#4ade80;font-weight:600;margin-bottom:4px">🔬 Modo 2 — Experimentos multi-frasco</div>'
        + 'Cuando registrás un experimento con <b>Frasco A = control</b> (fórmula base) y <b>Frascos B/C/D = variantes</b> (base + extra), '
        + 'el motor calcula el <b>delta de score</b> de cada variante respecto al control y entrena con ese delta — '
        + 'usando <i>solo el ingrediente extra como feature</i>. '
        + 'Los ingredientes base <b>no pueden ser culpados</b> del resultado: solo el extra recibe el crédito o la culpa.'
      + '</div>'

      // ── Niveles de confianza ──
      + '<div>'
        + '<div style="color:#a78bfa;font-weight:600;margin-bottom:4px">Niveles de confianza</div>'
        + '<b>●●●</b> Alta — variación real, n suficiente<br>'
        + '<b>●●○</b> Media — estimable, más ensayos mejorarían<br>'
        + '<b>●○○</b> Baja — señal débil, orientativo<br>'
        + '<b>◌◌◌</b> Indeterminado — aparece en casi todos los ensayos o en muy pocos; el motor no puede aislar su efecto. Ignorar.<br>'
        + '<b>○○○</b> Insuficiente — menos de 2 ensayos'
      + '</div>'

      // ── IC₉₀ + Optimizador ──
      + '<div>'
        + '<div style="color:#a78bfa;font-weight:600;margin-bottom:4px">IC₉₀ y el Optimizador</div>'
        + '<b>IC₉₀</b> = intervalo de confianza por bootstrap (100 remuestreos). Si cruza cero, el efecto no es estadísticamente distinguible de "sin efecto".<br>'
        + '<b>El Optimizador</b> usa estos coeficientes para sugerir: agregar un ingrediente con coef positivo, reducir uno con coef negativo, '
        + 'o ajustar cantidades hacia el rango óptimo calibrado. Las sugerencias son hipótesis para probar, no garantías.'
      + '</div>'

      // ── Confounding + Limitación ──
      + '<div style="grid-column:1/-1;border-top:1px solid #333;padding-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:10px 24px">'
      + '<div>'
        + '<b style="color:#f59e0b">⚠ confounding?</b> '
        + 'El Analizador asigna rutas bioquímicas positivas a este ingrediente, pero el modelo empírico lo señala inhibidor. '
        + 'Ocurre cuando el ingrediente se introdujo en un batch que falló <b>por otras razones</b> — correlación espuria. '
        + 'Priorizá tu conocimiento sobre el coef.'
      + '</div>'
      + '<div>'
        + '<b style="color:#ef4444">Limitación del OLS:</b> '
        + 'No puede separar ingredientes que <b>siempre aparecen juntos</b> fuera de experimentos controlados — quedan marcados ◌◌◌. '
        + 'Cada experimento A/B que registrás entrena al motor con señal limpia y aumenta la precisión de los coeficientes de los extras testeados.'
      + '</div>'
      + '</div>'

      + '</div>'
      + '</div>'
      + '<div class="cint-grid">'
      + '<div class="cint-panel">'
        + '<div class="cint-panel-title">¿Qué ingrediente hace la diferencia?</div>'
        + '<div style="font-size:9px;color:var(--tx3);margin-bottom:8px">Cada fila muestra cuánto subió o bajó el score cuando ese ingrediente estaba en la fórmula. Pasá el cursor para más detalle.</div>'
        + _renderRanking(model.coefs, sm)
      + '</div>'
      + '<div class="cint-panel">'
        + '<div class="cint-panel-title">¿Qué funciona mejor en combinación?</div>'
        + '<div style="font-size:9px;color:var(--tx3);margin-bottom:8px">Sinérgica = juntos rinden más que cada uno por separado. Antagónica = se interfieren entre sí.</div>'
        + _renderPairs(model.pairs)
      + '</div>'
      + '<div class="cint-panel">'
        + '<div class="cint-panel-title">¿Cuánto podés confiar en esto?</div>'
        + '<div style="font-size:9px;color:var(--tx3);margin-bottom:8px">R² mide cuánto de la variación en scores explica el modelo. Más ensayos = mayor confianza.</div>'
        + _renderStats(statsModel)
      + '</div>'
      + '<div class="cint-panel">'
        + '<div class="cint-panel-title">¿Qué cambiarías en tu fórmula activa?</div>'
        + '<div style="font-size:9px;color:var(--tx3);margin-bottom:8px">Basado en los coeficientes. Seleccioná una fórmula en el Analizador para ver sugerencias específicas.</div>'
        + _renderSuggestions(model, strainId)
      + '</div>'
      + '</div>';
    wrap.innerHTML = html;
  }

  window.cilabInt.buildAndRender = function() {
    _showAudit = false;
    wrap.innerHTML = '<div class="cint-empty"><span>Calculando modelo...</span></div>';
    setTimeout(function() {
      model = buildModel();
      _renderFull();
    }, 20);
  };

  window.cilabInt.selectStrain = function(gId) {
    strainId = gId || null;
    _renderFull();
  };

  window.cilabInt.exportModel = function() {
    var m = _modelRead();
    if (!m) { alert('No hay modelo calculado. Hacé clic en ⚡ Recalcular primero.'); return; }
    var json = JSON.stringify(m, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    var ts   = new Date().toISOString().slice(0, 10);
    a.href = url; a.download = 'cilab_inteligencia_' + ts + '.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  window.cilabInt.importModel = function(input) {
    var file = input && input.files && input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var m = JSON.parse(e.target.result);
        if (!m || !m.coefs || !m.computedAt) { alert('Archivo inválido — no es un modelo de inteligencia exportado por este sistema.'); return; }
        _modelWrite(m);
        model = m;
        strainId = null;
        _renderFull();
      } catch(err) { alert('Error al leer el archivo: ' + err.message); }
    };
    reader.readAsText(file);
    input.value = '';
  };

  window.cilabInt.resetModel = function() {
    if (!confirm('¿Borrar el análisis actual? Se puede recalcular en cualquier momento.')) return;
    invalidate();
    model      = null;
    strainId   = null;
    _showAudit = false;
    _renderFull();
  };

  window.cilabInt.showAudit = function() { _showAudit = true;  _renderFull(); };
  window.cilabInt.hideAudit = function() { _showAudit = false; _renderFull(); };

  window.cilabInt.deleteAuditRecord = function(id) {
    if (!id) return;
    var shortId = id.slice(-8);
    if (!confirm('Eliminar CRE-' + shortId + ' de bl2_crec? Esta acción no se puede deshacer.')) return;
    try {
      var arr = JSON.parse(localStorage.getItem(K_CREC) || '[]');
      arr = arr.filter(function(r) { return r.id !== id; });
      localStorage.setItem(K_CREC, JSON.stringify(arr));
    } catch(e) { alert('Error al eliminar el registro: ' + e.message); return; }
    invalidate();
    cilabInt.showAudit();
  };

  _renderFull();
}

// ── Exponer API pública ───────────────────────────────────────────────────────
window.cilabInt = {
  buildModel:          buildModel,
  getModel:            getModel,
  invalidate:          invalidate,
  renderInteligencia:  renderInteligencia,
  renderDiagnostico:   renderDiagnostico,
};

window._cintStrainClick = _onStrainChipClick;

window._cintFilterRanking = function(btn, filter) {
  var bar = btn && btn.parentNode;
  if (bar) {
    var btns = bar.querySelectorAll('.cint-filter-btn');
    for (var i = 0; i < btns.length; i++) btns[i].classList.remove('active');
    btn.classList.add('active');
  }
  var list = document.getElementById('cint-ranking-list');
  if (!list) return;
  var rows = list.querySelectorAll('.cint-ing-row');
  for (var j = 0; j < rows.length; j++) {
    var row  = rows[j];
    var show = filter === 'all'
      || (filter === 'pos' && row.classList.contains('pos'))
      || (filter === 'neg' && row.classList.contains('neg'))
      || (filter === 'amb' && row.getAttribute('data-ci-ambiguous') === '1');
    row.style.display = show ? '' : 'none';
  }
};

window._cintFilterPairs = function(btn, filter) {
  var bar = btn && btn.parentNode;
  if (bar) {
    var btns = bar.querySelectorAll('.cint-filter-btn');
    for (var i = 0; i < btns.length; i++) btns[i].classList.remove('active');
    btn.classList.add('active');
  }
  var list = document.getElementById('cint-pairs-list');
  if (!list) return;
  var cards = list.querySelectorAll('.cint-pair-card');
  for (var j = 0; j < cards.length; j++) {
    var card = cards[j];
    card.style.display = (filter === 'all' || card.classList.contains(filter)) ? '' : 'none';
  }
};

})();
