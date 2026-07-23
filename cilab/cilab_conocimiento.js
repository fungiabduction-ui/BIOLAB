(function() {
'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   BIOLAB ENGINE — CILAB · CONOCIMIENTO
   cilab_conocimiento.js

   Motor de ensayos de crecimiento y dashboard analítico.
   Confirma la teoría metabólica con observaciones reales.

   ─────────────────────────────────────────────────────────────────────────────
   DEPENDENCIAS — funciones de cilab_app.js en el mismo scope:
     readIngredientes, readForms, calcEstadoRutas, calcCN, calcRizomorfico
     notif, esc, now, gArr, s

   STORAGE     bl2_crec — Array<CRERecord>

   SCHEMA CRERecord {
     id, formulaId, tandaId?,
     formulaSnapshot: { nombre, ings: [{id, nombre, qty, unidad}] },
     geneticaId?, geneticaLabel,
     inoculationDate,        // YYYY-MM-DD — from CI data when linked
     createdAt,              // ISO
     status: 'activo' | 'cerrado',
     observaciones: Array<CREObs>,
     scoreFinal?,            // set on close (scoreObservado de definitiva)
     scoreFinalNorm?,        // scoreFinal × 10
     // CI link (optional — backward compatible)
     cultivoId?,             // bl2_cultivos.id — source of plate count + inoculationDate
     experimentoId?,         // bl2_experimentos.id
     frascoId?,              // frasco.id within the experiment
     // Record-level rizo (legacy + learning engine target)
     rizoPozitivas?,         // from definitiva obs (for computeRizoLearnIndex)
     totalPlacas?,           // from cultivoId or definitiva obs
     notasRizo?,             // global speculation
   }

   SCHEMA CREObs {
     tipo: 'lag' | 'temprana' | 'preliminar' | 'definitiva',
     dia,                    // días desde inoculación
     fecha,                  // YYYY-MM-DD
     // Legacy fields — kept for backward compat, no longer shown in new UI:
     contaminado?: bool,
     velocidad?,             // 'rapido' | 'normal' | 'lento'
     color?,                 // 'blanco_brillante' | 'gris' | 'amarillo' | 'alerta'
     // New fields:
     notasMorf?,             // free-text morphology notes (replaces velocidad+color)
     rizoPozitivas?,         // plates with rizo at this phase
     totalPlacas?,           // total plates at this phase
     // Existing:
     scoreObservado?,        // 0–10  (preliminar, definitiva)
     calidad?: 'excellent' | 'moderate' | 'poor' | null,  // rating cualitativo (tile/direct form)
     cordones?: bool,
     crecimientoDirigido?: bool,
     fenotipo?,              // 'rizo_extremo'|'rizo'|'normal'|'tomentoso'
     dominanciaApical?: bool,
     zonasRizo?: bool,
     notas: '',
     createdAt,              // ISO
   }

   INTEGRACIÓN CON CI
     Al guardar cada obs → escribe auto-nota en bl2_seg_notas[formulaId].
     Schema de CI no se modifica — solo un push() al array existente.

   ACCIÓN PENDIENTE (handoff desde CI)
     CI escribe bl2_pending_crec_action antes de navegar.
     renderConocimiento() lo consume al montar y lo borra.
   ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

// ── Puente a utilidades de cilab_app.js ──────────────────────────────────────
// cilab_app.js corre en una IIFE; sus helpers no son globales.
// Los expone con prefijo _cilab_* en window. Aquí creamos aliases locales.
/* eslint-disable no-unused-vars */
const esc              = window._cilab_esc              || (x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
const notif            = window._cilab_notif            || ((msg, type) => console.log('[CONOCIMIENTO]', type, msg));
const now              = window._cilab_now              || (() => new Date().toISOString());
const gArr             = window._cilab_gArr             || ((k) => { try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } });
const s                = window._cilab_s                || ((k, v) => localStorage.setItem(k, JSON.stringify(v)));
const readIngredientes = window._cilab_readIngredientes || (() => gArr('bl2_ings'));
const readForms        = window._cilab_readForms        || (() => gArr('bl2_forms'));
const calcEstadoRutas  = window._cilab_calcEstadoRutas  || null;
const calcCN           = window._cilab_calcCN           || null;
const calcRizomorfico  = window._cilab_calcRizomorfico  || null;
const SIGNAL_BANK_W    = window._cilab_SIGNAL_BANK      || [];
const sortSignals      = window._cilab_sortSignals       || ((sigs) => sigs.slice());
const attributeSignal  = window._cilab_attributeSignal   || (() => []);
/* eslint-enable no-unused-vars */

// Fecha local (no UTC) en formato YYYY-MM-DD. `new Date().toISOString().slice(0,10)`
// usa UTC — para un lab en Argentina (UTC-3), un click entre ~21:00 y 23:59 hora local
// cae en el día siguiente en UTC, corriendo `fecha`/`dia` un día de más. Mismo patrón
// que `hoyISO()` en fr/fr_app.js (allá sí es local; el de trace/trace_app.js NO lo es,
// ojo si se copia de ahí).
function _creHoyISO() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// ── Wizard de observación guiada ─────────────────────────────────────────────
// Estado vive solo en memoria — nada se persiste hasta que el usuario confirma.
let _wiz = null; // { recordId, obsIndex, recordCreatedAt, formulaIngs, geneticaId, routeStates, sorted, signals, step }

// ── Constantes ────────────────────────────────────────────────────────────────

const K_CREC         = 'bl2_crec';

const K_RIZO_LEARN = 'bl2_lab_rizo_learn';

function rizoLearnRead() {
  try { return JSON.parse(localStorage.getItem(K_RIZO_LEARN)) || null; } catch { return null; }
}

function rizoLearnWrite(idx) {
  try { localStorage.setItem(K_RIZO_LEARN, JSON.stringify(idx)); }
  catch (e) { console.warn('[RIZO_LEARN] write failed', e); }
}

function rizoLearnInvalidate() {
  try { localStorage.removeItem('bl2_lab_rizo_learn'); } catch { /* noop */ }
}

const K_CREC_EXCLUDED_FORMS = 'bl2_crec_excluded_formulas';
const K_CREC_FORM_SORT      = 'bl2_crec_formula_sort';
const K_CREC_NOTAS_KEY      = 'bl2_crec_notas';
const K_CREC_FASES_KEY      = 'bl2_crec_fases';
const K_CREC_CLEARED        = 'bl2_crec_cleared'; // tombstone: formulaId → ts

function _creIsCleared(formulaId) {
  try { return !!(JSON.parse(localStorage.getItem(K_CREC_CLEARED) || '{}')[formulaId]); } catch { return false; }
}
function _creSetCleared(formulaId) {
  try {
    var m = JSON.parse(localStorage.getItem(K_CREC_CLEARED) || '{}');
    m[formulaId] = Date.now();
    localStorage.setItem(K_CREC_CLEARED, JSON.stringify(m));
  } catch(e) {}
}
function _creLiftCleared(formulaId) {
  try {
    var m = JSON.parse(localStorage.getItem(K_CREC_CLEARED) || '{}');
    delete m[formulaId];
    localStorage.setItem(K_CREC_CLEARED, JSON.stringify(m));
  } catch(e) {}
}

function _creExcludedFormsRead() {
  try {
    const arr = JSON.parse(localStorage.getItem(K_CREC_EXCLUDED_FORMS) || '[]');
    return Array.isArray(arr) ? arr.filter(Boolean) : [];
  } catch { return []; }
}

function _creIsFormulaExcluded(formulaId) {
  return _creExcludedFormsRead().indexOf(formulaId) !== -1;
}

function _creFilterMotorRecords(records) {
  const excluded = new Set(_creExcludedFormsRead());
  return (records || []).filter(function(r) { return !excluded.has(r.formulaId); });
}

function _creFormulaSortRead() {
  try { return localStorage.getItem(K_CREC_FORM_SORT) || 'fecha_desc'; }
  catch { return 'fecha_desc'; }
}

function _creFormulaDateValue(f) {
  return (f && (f.fecha || f.createdAt || f.updatedAt || f.fechaCreacion)) || '';
}

function _creFormulaDateLabel(f) {
  var raw = _creFormulaDateValue(f);
  if (!raw) return 'sin fecha';
  try {
    return new Date(raw).toLocaleDateString('es-AR', {
      day: '2-digit', month: '2-digit', year: '2-digit',
    });
  } catch { return String(raw).slice(0, 10); }
}

function _creFormulaIngCount(f, snapshot) {
  if (snapshot && Array.isArray(snapshot.ings)) return snapshot.ings.length;
  if (f && Array.isArray(f.ingredientes)) return f.ingredientes.length;
  return 0;
}

function _creSortFormsForKnowledge(forms) {
  var mode = _creFormulaSortRead();
  return (forms || []).slice().sort(function(a, b) {
    var an = String(a.nombre || a.id || '').toLowerCase();
    var bn = String(b.nombre || b.id || '').toLowerCase();
    var ad = new Date(_creFormulaDateValue(a) || 0).getTime() || 0;
    var bd = new Date(_creFormulaDateValue(b) || 0).getTime() || 0;
    var ai = _creFormulaIngCount(a, null);
    var bi = _creFormulaIngCount(b, null);
    if (mode === 'fecha_asc') return ad - bd || an.localeCompare(bn);
    if (mode === 'nombre_asc') return an.localeCompare(bn) || bd - ad;
    if (mode === 'nombre_desc') return bn.localeCompare(an) || bd - ad;
    if (mode === 'ings_desc') return bi - ai || an.localeCompare(bn);
    if (mode === 'ings_asc') return ai - bi || an.localeCompare(bn);
    return bd - ad || an.localeCompare(bn);
  });
}

function creSetFormulaSort(mode) {
  try { localStorage.setItem(K_CREC_FORM_SORT, mode || 'fecha_desc'); } catch {}
  _creRenderGrid();
}

function creToggleFormulaMotor(formulaId) {
  var excluded = _creExcludedFormsRead();
  var idx = excluded.indexOf(formulaId);
  if (idx >= 0) {
    excluded.splice(idx, 1);
    notif('Formula reactivada para calibracion', 'ok');
  } else {
    excluded.push(formulaId);
    notif('Formula desacoplada del motor', 'info');
  }
  try { localStorage.setItem(K_CREC_EXCLUDED_FORMS, JSON.stringify(excluded)); } catch {}
  rizoLearnInvalidate();
  _creRenderGrid();
}

function computeRizoLearnIndex() {
  const records = _creFilterMotorRecords(creRead()).filter(function(r) { return r.status === 'cerrado'; });
  const data = {};

  records.forEach(function(rec) {
    const lastObs    = (rec.observaciones || []).slice(-1)[0] || {};
    const tipoCordon = lastObs.tipoCordon || null;
    const scoreVal   = (rec.scoreFinal != null) ? rec.scoreFinal : (lastObs.scoreObservado || 0);

    const isRizoPos =
      (rec.rizoPozitivas != null && rec.rizoPozitivas > 0) ||
      scoreVal >= 7 ||
      (rec.observaciones || []).some(function(o) {
        return o.fenotipo === 'rizo_extremo' || o.fenotipo === 'rizo' || (o.rizoPozitivas || 0) > 0;
      });

    // Rizo GRUESO: señal de síntesis de quitina activa — el más valioso
    const isRizoGrueso = isRizoPos && (tipoCordon === 'grueso' || tipoCordon === 'mixto' || (!tipoCordon && scoreVal >= 8));

    (rec.formulaSnapshot?.ings || []).forEach(function(ing) {
      if (!ing.id) return;
      if (!data[ing.id]) data[ing.id] = { avgQty: 0, rizoHits: 0, rizoGruesoHits: 0, totalFormulas: 0, _qtySum: 0 };
      data[ing.id].totalFormulas++;
      if (isRizoPos && (ing.qty || 0) > 0) {
        data[ing.id].rizoHits++;
        data[ing.id]._qtySum += ing.qty;
      }
      if (isRizoGrueso && (ing.qty || 0) > 0) {
        data[ing.id].rizoGruesoHits++;
      }
    });
  });

  Object.keys(data).forEach(function(id) {
    const d = data[id];
    d.avgQty = d.rizoHits > 0 ? Math.round((d._qtySum / d.rizoHits) * 100) / 100 : 0;
    delete d._qtySum;
  });

  const idx = { computedAt: new Date().toISOString(), data: data };
  rizoLearnWrite(idx);
  return idx;
}

function rizoLearnGet() {
  const idx = rizoLearnRead();
  if (!idx || !idx.computedAt) return computeRizoLearnIndex();
  return idx;
}

/**
 * Abrevia el nombre de especie en labels de genética.
 * "Psilocybe cubensis / APE / 244" → "PC / APE / 244"
 * Espejo de _segAbreviarEspecie (ci_app.js).
 */
function _creAbrevEspecie(label) {
  if (!label) return '?';
  const partes  = label.split(' / ');
  const especie = partes[0].trim();
  const resto   = partes.slice(1);
  const abrev   = especie.split(/\s+/).map(w => (w[0] || '').toUpperCase()).join('');
  return resto.length ? [abrev, ...resto].join(' / ') : abrev;
}

/**
 * Devuelve el array de tipos de fase PENDIENTES para un ensayo activo.
 * Desbloquea todas las fases — el orden es orientativo, no obligatorio.
 */

const K_CREC_PENDING = 'bl2_pending_crec_action';



// ═══════════════════════════════════════════════════════════════════════════
// 1. STORAGE LAYER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Migra un CRERecord legacy al schema actual.
 * Idempotente: aplicar N veces produce el mismo resultado.
 * Incrementar CRE_SCHEMA_VERSION cuando el schema evolucione.
 */
const CRE_SCHEMA_VERSION = 1;
function migrateCreRecord(r) {
  if (!r || typeof r !== 'object') return r;
  // v0 → v1: campos booleanos opcionales y predictedAtClose
  if (!r._schemaVersion) {
    if (r.observaciones) {
      r.observaciones = r.observaciones.map(o => ({
        cordones:            o.cordones            ?? false,
        crecimientoDirigido: o.crecimientoDirigido ?? false,
        dominanciaApical:    o.dominanciaApical    ?? false,
        zonasRizo:           o.zonasRizo           ?? false,
        ...o,
      }));
    }
    r._schemaVersion = CRE_SCHEMA_VERSION;
  }
  return r;
}

function creRead() {
  try {
    return (JSON.parse(localStorage.getItem(K_CREC)) || []).map(migrateCreRecord);
  } catch { return []; }
}

function creWrite(arr) {
  try { localStorage.setItem(K_CREC, JSON.stringify(arr)); }
  catch (e) { console.warn('[CREC] write failed', e); return; }
  try { localStorage.removeItem('bl2_inteligencia_model'); } catch(e) {}
  try { localStorage.removeItem('bl2_formula_intel'); } catch(e) {}
}

function creGet(id) {
  return creRead().find(r => r.id === id) || null;
}

function _creNextId() {
  // Re-leer storage fresco en lugar de usar array en memoria.
  // Minimiza la ventana de race condition en multi-tab (N12):
  // si otra pestaña creó un ensayo entre el creRead() de creCreate
  // y esta llamada, usamos el ID máximo actualizado.
  const _fresh = (() => {
    try { return JSON.parse(localStorage.getItem(K_CREC)) || []; } catch { return []; }
  })();
  let max = 0;
  _fresh.forEach(r => {
    const n = parseInt((r.id || '').replace('CRE-', '') || '0', 10);
    if (n > max) max = n;
  });
  return 'CRE-' + String(max + 1).padStart(4, '0');
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. CRUD
// ═══════════════════════════════════════════════════════════════════════════

function creCreate({ formulaId, tandaId, formulaSnapshot, geneticaId, geneticaLabel,
                     inoculationDate, cultivoId, experimentoId, frascoId }) {
  const arr = creRead();
  const rec = {
    id:              _creNextId(), // re-lee storage internamente (N12)
    formulaId:       formulaId       || '',
    tandaId:         tandaId         || null,
    formulaSnapshot: formulaSnapshot || null,
    geneticaId:      geneticaId      || null,
    geneticaLabel:   geneticaLabel   || '',
    inoculationDate: inoculationDate || new Date().toISOString().slice(0, 10),
    createdAt:       new Date().toISOString(),
    status:          'activo',
    observaciones:   [],
    _schemaVersion:  CRE_SCHEMA_VERSION,
  };
  if (cultivoId)     rec.cultivoId     = cultivoId;
  if (experimentoId) rec.experimentoId = experimentoId;
  if (frascoId)      rec.frascoId      = frascoId;
  // MEJ-0007: si el snapshot ya trae los extras del frasco mergeados
  // (creGetSnapshotWithExtras), no dejar que creAddObs() los vuelva a
  // aplicar al cerrar vía _creBackfillExtras() — duplicaba la dosis.
  if (formulaSnapshot && formulaSnapshot._extrasIncluded) rec._extrasBackfilled = true;
  arr.push(rec);
  creWrite(arr);
  return rec;
}

function creAddObs(creId, obs) {
  const arr = creRead();
  const idx = arr.findIndex(r => r.id === creId);
  if (idx === -1) return null;

  const full = { ...obs, createdAt: new Date().toISOString() };
  arr[idx].observaciones.push(full);

  // Cerrar al registrar definitiva
  if (obs.tipo === 'definitiva') {
    arr[idx].status         = 'cerrado';
    arr[idx].scoreFinal     = obs.scoreObservado ?? null;
    arr[idx].scoreFinalNorm = obs.scoreObservado != null
      ? +(obs.scoreObservado * 10).toFixed(1)
      : null;
    // Propagar incidencia al nivel de record para que el motor ML la use como target objetivo
    if (obs.totalPlacas   != null && obs.totalPlacas > 0) arr[idx].totalPlacas   = obs.totalPlacas;
    if (obs.rizoPozitivas != null)                        arr[idx].rizoPozitivas = obs.rizoPozitivas;
    if ((obs.fenotipo === 'tomentoso' || arr[idx].observaciones.some(o => o.fenotipo === 'tomentoso')) && arr[idx].rizoPozitivas == null) {
      arr[idx].rizoPozitivas = 0;
    }
    // Sellar extras del frasco en formulaSnapshot para que el record sea autónomo.
    // Sin esto, frascos del mismo experimento tienen formulaSnapshot idéntico y la regresión
    // ve vectores de features duplicados con scores distintos → ruido que corrompe coeficientes.
    if (!arr[idx]._extrasBackfilled && arr[idx].experimentoId && arr[idx].frascoId) {
      _creBackfillExtras(arr[idx]);
    }
  }

  creWrite(arr);
  // Mantiene el timeline de CI Seguimiento sincronizado.
  // tandaId = arr[idx].id (ej. "CRE-0068"): CI's segCargarNotas() deduplica
  // auto-notas por `_eventType + ':' + (tandaId || '__general__')`, y
  // _eventType se deriva del texto ANTES de " — " (que acá incluye el score,
  // no el id del record). Dos ensayos distintos que puntúan igual (mismo
  // score redondeado) generaban el mismo _eventType, y como esta nota nunca
  // llevaba tandaId, ambos caían en el mismo '__general__' — la migración
  // de CI borraba una de las dos notas como "duplicado", perdiendo el
  // registro de un ensayo real (bug encontrado y corregido 2026-07-22, ver
  // mejoras_app.md). Usar el id del record, que _creNextId() garantiza único,
  // asegura que la key de dedup nunca colisione entre records distintos.
  _creWriteAutoNota(arr[idx].formulaId, _creFormatAutoNota(arr[idx], full), 'none', arr[idx].id);
  if (obs.tipo === 'definitiva') {
    rizoLearnInvalidate();
    // Advertencia de calidad de datos para el motor de aprendizaje
    const rec = arr[idx];
    const missingPlacas  = rec.totalPlacas   == null || rec.totalPlacas <= 0;
    const missingRizo    = rec.rizoPozitivas == null;
    const fases          = _creFasesRead(rec.formulaId, rec.geneticaId);
    const colF           = fases.find(function(f) { return f.fase === 'colonizacion_completa'; });
    const missingColDia  = !colF || colF.auto === 'inferred' || colF.dia == null;
    const gaps = [];
    if (missingPlacas || missingRizo) gaps.push('placas (positivas + total)');
    if (missingColDia)                gaps.push('día de colonización completa');
    if (gaps.length) notif('📊 Datos de aprendizaje faltantes: ' + gaps.join(' · ') + ' — registrá estos valores para mejorar el modelo de inteligencia.', 'warn');
  }
  return arr[idx];
}

/**
 * Enriquece una obs existente escribiendo solo obs.enriched.
 * NUNCA modifica campos originales de la obs ni del record.
 * Incluye concurrency check: aborta si el record fue modificado desde que se leyó.
 *
 * @param {string} recordId   - id del CRERecord
 * @param {number} obsIndex   - índice en record.observaciones[]
 * @param {object} enrichedData - { complete: bool, signals: {...} }
 * @param {string} expectedCreatedAt - record.createdAt leído al abrir el wizard
 * @returns {{ ok: boolean, reason?: string }}
 */
function enrichObs(recordId, obsIndex, enrichedData, expectedCreatedAt) {
  const records = creRead();
  const recIdx  = records.findIndex(r => r.id === recordId);

  if (recIdx < 0)
    return { ok: false, reason: 'Registro no encontrado.' };

  const rec = records[recIdx];
  if (rec.createdAt !== expectedCreatedAt)
    return { ok: false, reason: 'El registro fue modificado externamente. Recargá e intentá de nuevo.' };

  const obs = rec.observaciones;
  if (!Array.isArray(obs) || obsIndex < 0 || obsIndex >= obs.length)
    return { ok: false, reason: 'Índice de observación inválido.' };

  // Escribir SOLO el sub-objeto enriched — campos originales intocados
  records[recIdx].observaciones[obsIndex].enriched = {
    version:  1,
    ts:       now(),
    complete: enrichedData.complete === true,
    signals:  enrichedData.signals  || {},
  };

  // Escritura atómica: todo el array bl2_crec de vuelta
  creWrite(records);
  return { ok: true };
}

/**
 * Sella los extras del frasco (bl2_experimentos) en formulaSnapshot.ings del record.
 * Modifica rec en-lugar. Caller es responsable de persistir (creWrite).
 * Idempotente: si ya fue backfilled o no hay extras, no modifica nada.
 */
function _creBackfillExtras(rec) {
  if (rec._extrasBackfilled) return;
  if (!rec.experimentoId || !rec.frascoId) return;
  try {
    var exps = JSON.parse(localStorage.getItem('bl2_experimentos') || '[]');
    var exp  = exps.find(function(e) { return e.id === rec.experimentoId; });
    if (!exp) return;
    var fr = (exp.frascos || []).find(function(f) { return f.label === rec.frascoId || f.id === rec.frascoId; });
    if (!fr || !fr.extras || !fr.extras.length) { rec._extrasBackfilled = true; return; }

    var allIngs   = typeof readIngredientes === 'function' ? readIngredientes() : [];
    var baseIngs  = (rec.formulaSnapshot && rec.formulaSnapshot.ings) ? rec.formulaSnapshot.ings.slice() : [];
    var normFactor = (fr.volFrasco > 0) ? (1000 / fr.volFrasco) : 1;

    fr.extras.forEach(function(ex) {
      if (!ex.ingId || !(ex.qty > 0)) return;
      var normalizedQty = ex.qty * normFactor;
      var already = baseIngs.find(function(i) { return i.id === ex.ingId; });
      if (already) {
        already.qty += normalizedQty;
      } else {
        var live = allIngs.find(function(i) { return i.id === ex.ingId; });
        baseIngs.push({
          id:     ex.ingId,
          nombre: (live && live.nombre) || ex.ingId,
          qty:    normalizedQty,
          unidad: (live && live.unidad) || 'gr',
          _extra: true
        });
      }
    });

    if (!rec.formulaSnapshot) rec.formulaSnapshot = { ings: [] };
    rec.formulaSnapshot.ings = baseIngs;
    rec._extrasBackfilled    = true;
  } catch(e) {
    console.warn('[CRE] backfillExtras failed for', rec.id, e);
  }
}

/**
 * Migración one-shot: sella extras en todos los records cerrados que aún no los tienen.
 * Retorna { updated, skipped }.
 */
function creBackfillAllExtras() {
  var arr     = creRead();
  var updated = 0, skipped = 0;
  arr.forEach(function(rec) {
    if (rec.status !== 'cerrado') { skipped++; return; }
    if (rec._extrasBackfilled)    { skipped++; return; }
    if (!rec.experimentoId || !rec.frascoId) { rec._extrasBackfilled = true; skipped++; return; }
    _creBackfillExtras(rec);
    if (rec._extrasBackfilled) updated++;
    else skipped++;
  });
  creWrite(arr);
  return { updated: updated, skipped: skipped };
}

function creBackfillTomentosoRizo() {
  var arr     = creRead();
  var updated = 0, skipped = 0;
  arr.forEach(function(rec) {
    if (rec.status !== 'cerrado')  { skipped++; return; }
    if (rec.rizoPozitivas != null) { skipped++; return; }
    var hasTomentoso = rec.observaciones && rec.observaciones.some(function(o) { return o.fenotipo === 'tomentoso'; });
    if (!hasTomentoso) { skipped++; return; }
    rec.rizoPozitivas = 0;
    updated++;
  });
  if (updated > 0) creWrite(arr);
  return { updated: updated, skipped: skipped };
}

function _creUpdateRizoData(creId, rizoPozitivas, totalPlacas, notasRizo) {
  if (rizoPozitivas == null && totalPlacas == null && !notasRizo) return;
  const arr = creRead();
  const idx = arr.findIndex(function(r) { return r.id === creId; });
  if (idx === -1) return;
  if (rizoPozitivas != null) arr[idx].rizoPozitivas = rizoPozitivas;
  if (totalPlacas   != null) arr[idx].totalPlacas   = totalPlacas;
  if (notasRizo)             arr[idx].notasRizo      = notasRizo;
  creWrite(arr);
  rizoLearnInvalidate();
}

function creDeleteEnsayo(creId) {
  var arr = creRead();
  var rec = arr.find(function(r) { return r.id === creId; });
  if (!rec) return false;
  creDeleteFormula(rec.formulaId);
  return true;
}

/** Borra TODO lo de una fórmula en Conocimiento: scores, fases y notas de todas las cepas/experimentos. */
function creDeleteFormula(formulaId) {
  if (!formulaId) return;
  var prefix = formulaId + '__';
  // bl2_crec
  creWrite(creRead().filter(function(r) { return r.formulaId !== formulaId; }));
  // bl2_crec_fases
  var allFases = JSON.parse(localStorage.getItem(K_CREC_FASES_KEY) || '{}') || {};
  Object.keys(allFases).forEach(function(k) { if (k.indexOf(prefix) === 0) delete allFases[k]; });
  localStorage.setItem(K_CREC_FASES_KEY, JSON.stringify(allFases));
  // bl2_crec_notas
  var allNotas = JSON.parse(localStorage.getItem(K_CREC_NOTAS_KEY) || '{}') || {};
  Object.keys(allNotas).forEach(function(k) { if (k.indexOf(prefix) === 0) delete allNotas[k]; });
  localStorage.setItem(K_CREC_NOTAS_KEY, JSON.stringify(allNotas));
  // No setear tombstone aquí: fases y score son ortogonales.
  // Después de borrar score, auto-fill reconstruye fases desde CI correctamente.
  rizoLearnInvalidate();
  notif('Registros de fórmula eliminados', 'ok');
}

function creConfirmDeleteSP(btn, creId, formulaId) {
  btn.textContent = '⚠ ¿Confirmar?';
  btn.style.background = 'var(--er, #e74c3c)';
  btn.style.color = '#fff';
  btn.onclick = function() { creDeleteAndRefreshSP(creId, formulaId); };
}

function creConfirmDeleteInline(btn, creId, formulaId) {
  btn.textContent = '⚠';
  btn.style.background = 'var(--er, #e74c3c)';
  btn.style.color = '#fff';
  btn.onclick = function() { creDeleteAndRefresh(creId, formulaId); };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. CÓMPUTO — score predicho desde snapshot
// ═══════════════════════════════════════════════════════════════════════════



/** Toma snapshot de fórmula desde bl2_forms (CILAB). */
function creGetFormulaSnapshot(formulaId) {
  const f = readForms().find(x => x.id === formulaId);
  if (!f) return null;
  const allIngs = readIngredientes();
  return {
    nombre: f.nombre || formulaId,
    ings: (f.ingredientes || [])
      .filter(fi => (fi.qty || 0) > 0)
      .map(fi => {
        const ing = allIngs.find(i => i.id === fi.id);
        return {
          id:     fi.id,
          nombre: (fi.snapshot?.nombre) || ing?.nombre || fi.id,
          qty:    fi.qty    || 0,
          unidad: fi.unidad || ing?.unidad || 'gr',
        };
      }),
  };
}

function creGetSnapshotWithExtras(formulaId, frasco) {
  const base = creGetFormulaSnapshot(formulaId);
  if (!base || !frasco?.extras?.length) return base;
  const allIngs   = readIngredientes();
  const merged    = [...base.ings];
  const normFactor = (frasco.volFrasco > 0) ? (1000 / frasco.volFrasco) : 1;
  let anyMerged = false;
  frasco.extras.forEach(ex => {
    if (!ex.ingId || !(ex.qty > 0)) return;
    anyMerged = true;
    const normalizedQty = ex.qty * normFactor;
    const existing = merged.find(i => i.id === ex.ingId);
    if (existing) {
      existing.qty += normalizedQty;
    } else {
      const ing = allIngs.find(i => i.id === ex.ingId);
      merged.push({
        id:     ex.ingId,
        nombre: ing?.nombre || ex.ingId,
        qty:    normalizedQty,
        unidad: ing?.unidad || 'gr',
      });
    }
  });
  // MEJ-0007: marca que este snapshot ya incluye los extras mergeados —
  // creCreate() la usa para no dejar que creAddObs() los vuelva a aplicar.
  return anyMerged ? { ...base, ings: merged, _extrasIncluded: true } : { ...base, ings: merged };
}


/**
 * Lee genéticas con el patrón dual-mode (API GE en memoria → localStorage).
 * Mismo contrato que CI.segInicializarGeneticas.
 */
function creReadGenetics() {
  if (window.ge && typeof window.ge.getSelectableGenetics === 'function') {
    return window.ge.getSelectableGenetics();
  }
  try {
    const raw = JSON.parse(localStorage.getItem('biolab.ge.v4'));
    if (!raw?.nodes?.length) return [];
    const nodes = raw.nodes;
    const getChildCount = pid => nodes.filter(n => n.parentId === pid).length;
    const getNode       = id  => nodes.find(n => n.id === id) || null;
    function getAncestors(id) {
      const chain = []; let cur = getNode(id);
      while (cur) { chain.unshift(cur); cur = cur.parentId ? getNode(cur.parentId) : null; }
      return chain;
    }
    return nodes
      .filter(n => n.status !== 'archived'
                && n.type !== 'species'
                && (n.type === 'phenotype' || getChildCount(n.id) === 0))
      .map(n => {
        const chain = getAncestors(n.id);
        const sp = chain.find(x => x.type === 'species');
        const st = chain.find(x => x.type === 'strain' && x.id !== n.id);
        const parts = [];
        if (sp) parts.push(sp.name);
        if (st) parts.push(st.name);
        parts.push(n.name);
        return { id: n.id, label: parts.join(' / '), type: n.type };
      })
      .sort((a, b) => a.label.localeCompare(b.label, 'es'));
  } catch { return []; }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. INTEGRACIÓN CON CI — auto-nota
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Escribe una nota automática en bl2_seg_notas para que aparezca
 * en el Seguimiento CI de la fórmula. Schema idéntico al de CI.
 * No modifica ninguna estructura de CI — solo escribe al storage.
 */
function _creWriteAutoNota(formulaId, texto, estado, tandaId) {
  if (!formulaId) return;
  try {
    const raw   = localStorage.getItem('bl2_seg_notas');
    const notas = raw ? JSON.parse(raw) : {};
    if (!notas[formulaId]) notas[formulaId] = [];
    const d  = new Date();
    const ts = d.toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit',
    }).replace(',', '');
    var nota = { ts, texto, estado: estado || 'none', auto: true, imagenes: [] };
    if (tandaId) nota.tandaId = tandaId;
    notas[formulaId].push(nota);
    localStorage.setItem('bl2_seg_notas', JSON.stringify(notas));
  } catch (e) { console.warn('[CREC] auto-nota CI failed', e); }
}

/** Formatea el texto de la auto-nota para una observación. */
function _creFormatAutoNota(rec, obs) {
  const TIPO_LABELS = { lag: 'Reorganización Celular', temprana: 'Primeros Filamentos', preliminar: 'Rizomorfismo Activo', definitiva: 'Score Definitivo' };
  const TIPO_ICONS  = { lag: '🐌', temprana: '🕸️', preliminar: '🔬', definitiva: '🏆' };
  const tipoLabel = TIPO_LABELS[obs.tipo] || obs.tipo;
  const tipoIcon  = TIPO_ICONS[obs.tipo]  || '📊';
  const diasStr   = obs.dia != null ? `D+${obs.dia}` : '';
  const genStr    = rec.geneticaLabel ? ` · ${rec.geneticaLabel}` : '';

  let extra = '';
  if (obs.scoreObservado != null) {
    const norm = +(obs.scoreObservado * 10).toFixed(0);
    extra += ` · Score ${obs.scoreObservado}/10 (${norm}/100)`;
  }
  if (obs.fenotipo) extra += ` · ${_crePhenoLabel(obs.fenotipo)}`;

  return `${tipoIcon} ${tipoLabel} ${diasStr}${extra} — ${rec.id}${genStr}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. EXPORT / IMPORT
// ═══════════════════════════════════════════════════════════════════════════

// Todas las keys propias del motor Conocimiento (no toca CI, GE, ni otras)
var _CRE_OWN_KEYS = [
  K_CREC,              // 'bl2_crec'
  K_CREC_NOTAS_KEY,    // 'bl2_crec_notas'
  K_CREC_FASES_KEY,    // 'bl2_crec_fases'
  K_RIZO_LEARN,        // 'bl2_lab_rizo_learn'
  K_CREC_PENDING,      // 'bl2_pending_crec_action'
];

function creExportJSON() {
  var bundle = { version: 2, exportedAt: new Date().toISOString() };
  _CRE_OWN_KEYS.forEach(function(k) {
    try {
      var raw = localStorage.getItem(k);
      bundle[k] = raw ? JSON.parse(raw) : null;
    } catch(e) { bundle[k] = null; }
  });
  // Incluir preferencias de usuario también
  try { bundle[K_CREC_EXCLUDED_FORMS] = JSON.parse(localStorage.getItem(K_CREC_EXCLUDED_FORMS) || '[]'); } catch(e) {}
  try { bundle[K_CREC_FORM_SORT] = localStorage.getItem(K_CREC_FORM_SORT) || null; } catch(e) {}

  var data = JSON.stringify(bundle, null, 2);
  var blob = new Blob([data], { type: 'application/json' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href     = url;
  a.download = 'bl2_conocimiento_' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(url);
  var recCount = (bundle[K_CREC] && Array.isArray(bundle[K_CREC])) ? bundle[K_CREC].length : 0;
  notif('Exportado: ' + recCount + ' ensayo(s) + fases + notas ✓', 'ok');
}

function creImportJSON(input) {
  var file = input && input.files && input.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var parsed = JSON.parse(e.target.result);
      // Soporte legacy: archivo antiguo era solo el array bl2_crec
      if (Array.isArray(parsed)) {
        if (!confirm('¿Importar ' + parsed.length + ' ensayo(s)? Los datos actuales de Conocimiento serán reemplazados.')) return;
        creWrite(parsed);
        notif(parsed.length + ' ensayo(s) importados ✓', 'ok');
        _creBackfillAutoLogs();
        renderConocimiento();
        return;
      }
      // Formato bundle v2
      if (typeof parsed !== 'object' || !parsed[K_CREC]) {
        notif('Formato inválido — se esperaba un backup de Conocimiento', 'err');
        return;
      }
      var recCount = Array.isArray(parsed[K_CREC]) ? parsed[K_CREC].length : 0;
      if (!confirm('¿Importar backup de Conocimiento?\n\n' + recCount + ' ensayo(s) · fases · notas\n\nLos datos actuales serán reemplazados.')) return;
      _CRE_OWN_KEYS.forEach(function(k) {
        try {
          if (parsed[k] != null) {
            localStorage.setItem(k, JSON.stringify(parsed[k]));
          } else {
            localStorage.removeItem(k);
          }
        } catch(e) { console.warn('[CRE] import key failed: ' + k, e); }
      });
      if (parsed[K_CREC_EXCLUDED_FORMS] != null) {
        try { localStorage.setItem(K_CREC_EXCLUDED_FORMS, JSON.stringify(parsed[K_CREC_EXCLUDED_FORMS])); } catch(e) {}
      }
      if (parsed[K_CREC_FORM_SORT]) {
        try { localStorage.setItem(K_CREC_FORM_SORT, parsed[K_CREC_FORM_SORT]); } catch(e) {}
      }
      notif(recCount + ' ensayo(s) importados ✓', 'ok');
      _creBackfillAutoLogs();
      renderConocimiento();
    } catch(err) {
      console.error('[CRE] import failed', err);
      notif('Error al parsear archivo — revisá la consola', 'err');
    }
  };
  reader.readAsText(file);
  input.value = '';
}

// Purga TODOS los datos del motor Conocimiento de localStorage.
// SCOPE EXACTO: solo las keys bl2_crec*, bl2_lab_rizo_learn, bl2_pending_crec_action.
// NO toca: bl2_seg, bl2_forms, bl2_ings, bl2_seg_notas, biolab.ge.v4 ni ninguna otra.
// Genera notas auto-log para todos los records que no las tienen.
// Idempotente — no duplica entradas existentes.
function _creBackfillAutoLogs() {
  var records     = creRead();
  var allGenetics = creReadGenetics();
  var count = 0;
  var uid   = 0;

  records.forEach(function(rec) {
    var formulaId  = rec.formulaId;
    var geneticaId = rec.geneticaId;
    if (!formulaId || !geneticaId) return;

    // Sincronizar fases desde CI antes de leer — idempotente
    _creAutoFillInoculacion(formulaId, geneticaId);
    _creAutoFillColonizacion(formulaId, geneticaId);

    var notas   = _creNotasRead(formulaId, geneticaId);
    var changed = false;

    // ── Score backfill ──────────────────────────────────────────────────
    var scoredObs = (rec.observaciones || []).filter(function(o) { return o.calidadScore != null; });
    if (scoredObs.length > 0) {
      var hasLog = notas.some(function(n) { return n.auto && n.logType === 'score'; });
      if (!hasLog) {
        // Buscar también en bucket de fórmula (logs de batch)
        hasLog = _creNotasRead(formulaId, null).some(function(n) {
          return n.auto && n.logType === 'score' && n.cepaIds && n.cepaIds.indexOf(geneticaId) !== -1;
        });
      }
      if (!hasLog) {
        var obs      = scoredObs[scoredObs.length - 1];
        var score    = obs.calidadScore;
        var compScore = obs.scoreCompuesto != null ? obs.scoreCompuesto : null;
        var rizo     = obs.rizoPozitivas;
        var total    = obs.totalPlacas;
        var tipo     = obs.tipoCordon || null;

        var parts    = [];
        var sStr     = 'Score ' + score + '/10';
        if (compScore != null && +compScore.toFixed(1) !== score) sStr += ' → ' + compScore.toFixed(1);
        parts.push(sStr);
        if (score >= 7) {
          if (total > 0 && rizo >= 0) parts.push('Incidencia ' + Math.round(rizo / total * 100) + '% (' + rizo + '/' + total + ')');
          if (tipo) parts.push('Cordón: ' + tipo);
        } else {
          parts.push('Difuso / tormentoso');
        }

        var fases = _creFasesRead(formulaId, geneticaId);
        var fp    = [];
        var colF  = fases.find(function(f) { return f.fase === 'colonizacion_completa'; });
        var fruF  = fases.find(function(f) { return f.fase === 'fructificacion'; });
        var finF  = fases.find(function(f) { return f.fase === 'fin_ciclo'; });
        if (colF) fp.push('Col.Día ' + colF.dia);
        if (fruF) fp.push('Fruct.Día ' + fruF.dia);
        if (finF) fp.push('Fin.Día '  + finF.dia);

        var gObj   = allGenetics.find(function(g) { return g.id === geneticaId; });
        var gLabel = gObj ? gObj.label : (rec.geneticaLabel || geneticaId);
        var ts     = obs.fecha ? obs.fecha + 'T12:00:00.000Z' : new Date().toISOString();

        notas.push({
          id: 'bf' + (Date.now() + uid++) + Math.random().toString(36).slice(2, 5),
          ts: ts,
          texto: parts.join(' · '),
          fasesTexto: fp.length ? fp.join(' · ') : null,
          auto: true, logType: 'score',
          cepaLabels: [gLabel], cepaIds: [geneticaId],
          imagenes: [],
        });
        changed = true;
        count++;
      }
    }

    // ── Fases backfill ──────────────────────────────────────────────────
    var fases = _creFasesRead(formulaId, geneticaId);
    fases.forEach(function(fc) {
      var already = notas.some(function(n) { return n.auto && n.logType === 'fase' && n.faseId === fc.fase; });
      if (already) return;
      var def      = _FASES_DEF.find(function(f) { return f.id === fc.fase; });
      var label    = def ? def.label : fc.fase;
      var fmtFecha = fc.fecha
        ? new Date(fc.fecha + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'numeric' })
        : '';
      var texto    = label + ' · Día ' + fc.dia + (fmtFecha ? ' · ' + fmtFecha : '');
      var ts       = fc.ts || (fc.fecha ? fc.fecha + 'T12:00:00.000Z' : new Date().toISOString());
      notas.push({
        id: 'bf' + (Date.now() + uid++) + Math.random().toString(36).slice(2, 5),
        ts: ts,
        texto: texto,
        auto: true, logType: 'fase',
        faseId: fc.fase, faseColor: def ? def.color : null, dia: fc.dia,
        imagenes: [],
      });
      changed = true;
      count++;
    });

    if (changed) {
      // Ordenar por timestamp para que las fases aparezcan antes del score
      notas.sort(function(a, b) { return a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0; });
      _creNotasWrite(formulaId, geneticaId, notas);
    }
  });

  return count;
}

function creBackfillLogs() {
  var n = _creBackfillAutoLogs();
  notif(n > 0 ? n + ' entradas de log generadas ✓' : 'Logs ya al día — sin cambios', n > 0 ? 'ok' : 'info');
  // Refrescar panel si está abierto
  if (_sp.formulaId) {
    var detalle = document.getElementById('cre-detalle-wrap');
    if (detalle && detalle.style.display !== 'none') {
      detalle.innerHTML = _creScoringPanelHTML(_sp.formulaId, _sp.cepaId);
    }
  }
}

// ── Migración: backfill frascoId en records legacy + regenera logs de score ──────────────────

function _creFrascoBackfill() {
  var exps = [];
  try { exps = JSON.parse(localStorage.getItem('bl2_experimentos')) || []; } catch(e) {}
  var segs = [];
  try { segs = JSON.parse(localStorage.getItem('bl2_seg')) || []; } catch(e) {}

  var arr = creRead();
  var n   = 0;

  arr.forEach(function(r) {
    if (!r.experimentoId || r.frascoId != null) return;
    var exp = exps.find(function(e) { return e.id === r.experimentoId; });
    if (!exp || !exp.frascos || !exp.frascos.length) return;

    if (exp.frascos.length === 1) {
      r.frascoId = exp.frascos[0].label;
      n++;
      return;
    }
    // Múltiples frascos: determinar por bl2_seg a qué frasco pertenecía la cepa
    var labels = {};
    segs.forEach(function(s) {
      if (s.formula_id === r.formulaId && s.experimentoId === r.experimentoId
          && s.genetica === r.geneticaId && s.experimentoFrascoId)
        labels[s.experimentoFrascoId] = true;
    });
    var keys = Object.keys(labels);
    if (keys.length === 1) { r.frascoId = keys[0]; n++; }
    // Si hay ambigüedad (0 o >1 frascos posibles): queda sin frascoId → visible en todos los tabs
  });

  if (n > 0) creWrite(arr);
  return n;
}

function _creExtrasBackfill() {
  var exps = [];
  try { exps = JSON.parse(localStorage.getItem('bl2_experimentos')) || []; } catch(e) {}
  var allIngs = typeof readIngredientes === 'function' ? readIngredientes() : [];
  var arr = creRead();
  var n   = 0;

  arr.forEach(function(r) {
    // Solo records con contexto de frasco, no procesados aún
    if (!r.experimentoId || !r.frascoId || r._extrasBackfilled) return;
    if (!r.formulaSnapshot || !Array.isArray(r.formulaSnapshot.ings)) return;

    var exp = exps.find(function(e) { return e.id === r.experimentoId; });
    if (!exp || !exp.frascos) return;
    var fr = exp.frascos.find(function(f) { return f.label === r.frascoId; });
    if (!fr || !fr.extras || !fr.extras.length) {
      // Frasco sin extras (control) — marcar igualmente para no re-procesar
      r._extrasBackfilled = true;
      n++;
      return;
    }

    var normFactor = (fr.volFrasco > 0) ? (1000 / fr.volFrasco) : 1;
    var merged = false;
    fr.extras.forEach(function(ex) {
      if (!ex.ingId || !(ex.qty > 0)) return;
      var normalizedQty = ex.qty * normFactor;
      var existing = r.formulaSnapshot.ings.find(function(i) { return i.id === ex.ingId; });
      if (!existing) {
        var ing = allIngs.find(function(i) { return i.id === ex.ingId; });
        r.formulaSnapshot.ings.push({
          id:     ex.ingId,
          nombre: (ing && ing.nombre) || ex.ingId,
          qty:    normalizedQty,
          unidad: (ing && ing.unidad) || 'gr',
        });
        merged = true;
      }
      // Si ya existe: respetar dato original (no sobreescribir — aplica a controles)
    });

    r._extrasBackfilled = true;
    n++;  // always — sentinel must be persisted regardless of whether extras were added
  });

  if (n > 0) creWrite(arr);
  return n;
}

/**
 * Migración V2: re-sella extras en records ya procesados por V1 con cantidades incorrectas.
 * V1 no aplicaba normalizacion volumetrica (extra.qty * 1000/volFrasco).
 * MEJ-0008 (2026-07-22): esta función ANTES reconstruía formulaSnapshot.ings
 * desde bl2_forms EN VIVO — si la fórmula base se editaba in-place (posible,
 * ver frmDelIngRow en ci_app.js) después de que el record cerró, esto
 * reescribía silenciosamente los ingredientes base del record viejo con los
 * de la fórmula editada, violando su inmutabilidad. Ahora parte del propio
 * formulaSnapshot ya sellado — nunca lee bl2_forms — y solo toca los
 * ingredientes marcados _extra (el merge previo, posiblemente mal
 * normalizado o duplicado) para reaplicarlos con la normalización correcta.
 * Idempotente: solo procesa records con _extrasBackfilled=true y _extrasBackfilledV2 ausente.
 */
function _creExtrasBackfillV2() {
  var exps = [];
  try { exps = JSON.parse(localStorage.getItem('bl2_experimentos')) || []; } catch(e) {}
  var allIngs = typeof readIngredientes === 'function' ? readIngredientes() : [];
  var arr = creRead();
  var n   = 0;

  arr.forEach(function(r) {
    // Solo records ya sellados por V1 pero no corregidos por V2
    if (!r._extrasBackfilled || r._extrasBackfilledV2) return;
    // MEJ-0015: si el snapshot ya fue mergeado limpio al crear el record
    // (creGetSnapshotWithExtras, marca permanente y sellada en el propio
    // snapshot — formulaSnapshot es inmutable salvo backfill), no hay nada
    // que reconstruir. El merge de creación nunca tagea las entradas con
    // _extra (solo lo hace este V2 al insertar una entrada nueva más abajo),
    // así que si se lo dejaba seguir, el filtro `!i._extra` no reconocía las
    // cantidades ya mergeadas como "extra" y las volvía a sumar encima —
    // duplicando la dosis de un record que nació correcto.
    if (r.formulaSnapshot && r.formulaSnapshot._extrasIncluded) { r._extrasBackfilledV2 = true; return; }
    if (!r.experimentoId || !r.frascoId) { r._extrasBackfilledV2 = true; return; }

    var exp = exps.find(function(e) { return e.id === r.experimentoId; });
    if (!exp) { r._extrasBackfilledV2 = true; return; }
    var fr = (exp.frascos || []).find(function(f) { return f.label === r.frascoId; });
    if (!fr) { r._extrasBackfilledV2 = true; return; }

    var extras = (fr.extras || []).filter(function(e) { return e.ingId && e.qty > 0; });
    if (!extras.length) { r._extrasBackfilledV2 = true; n++; return; }

    var volFrasco = fr.volFrasco || 0;
    if (volFrasco <= 0) { r._extrasBackfilledV2 = true; return; }
    var normFactor = 1000 / volFrasco;

    if (!r.formulaSnapshot || !Array.isArray(r.formulaSnapshot.ings)) { r._extrasBackfilledV2 = true; return; }

    // Partir del snapshot YA sellado (nunca de bl2_forms), descartando solo
    // las entradas _extra de un merge previo — el resto (ingredientes base
    // reales) queda intacto tal cual se cerró el ensayo.
    var baseIngs = r.formulaSnapshot.ings.filter(function(i) { return !i._extra; });

    // Merge extras normalizados sobre base
    extras.forEach(function(ex) {
      var normalizedQty = ex.qty * normFactor;
      var existing = baseIngs.find(function(i) { return i.id === ex.ingId; });
      if (existing) {
        existing.qty += normalizedQty;
      } else {
        var ing = allIngs.find(function(i) { return i.id === ex.ingId; });
        baseIngs.push({
          id:     ex.ingId,
          nombre: (ing && ing.nombre) || ex.ingId,
          qty:    normalizedQty,
          unidad: (ing && ing.unidad) || 'gr',
          _extra: true
        });
      }
    });

    r.formulaSnapshot.ings = baseIngs;
    r._extrasBackfilledV2  = true;
    n++;
  });

  if (n > 0) creWrite(arr);
  return n;
}

function _creRegenScoreLogs() {
  var exps    = [];
  try { exps = JSON.parse(localStorage.getItem('bl2_experimentos')) || []; } catch(e) {}
  var allIngs = typeof readIngredientes === 'function' ? readIngredientes() : [];
  var gens    = creReadGenetics();
  var arr     = creRead();
  var uid     = 0;

  // Leer notas y borrar sólo auto-score — manuales y fases quedan intactas
  var allNotas = {};
  try { allNotas = JSON.parse(localStorage.getItem(K_CREC_NOTAS_KEY)) || {}; } catch(e) {}
  Object.keys(allNotas).forEach(function(k) {
    allNotas[k] = allNotas[k].filter(function(n) { return !(n.auto && n.logType === 'score'); });
  });

  // Reconstruir desde cada record cerrado
  arr.forEach(function(rec) {
    if (!rec.formulaId || !rec.geneticaId || rec.status !== 'cerrado') return;
    var defObs = (rec.observaciones || []).filter(function(o) { return o.tipo === 'definitiva'; });
    if (!defObs.length) return;
    var o = defObs[defObs.length - 1];
    if (o.calidadScore == null) return;

    var frascoStr = null;
    if (rec.frascoId && rec.experimentoId) {
      var exp = exps.find(function(e) { return e.id === rec.experimentoId; });
      if (exp) {
        var fr = (exp.frascos || []).find(function(f) { return f.label === rec.frascoId; });
        if (fr) {
          var ex = fr.extras && fr.extras.length
            ? fr.extras.map(function(x) {
                var ing = allIngs.find(function(i) { return i.id === x.ingId; });
                return ing ? ing.nombre : x.ingId;
              }).join('+')
            : 'Control';
          frascoStr = 'Frasco ' + fr.label + ' · ' + ex;
        }
      }
    }

    var parts = [];
    if (frascoStr) parts.push('🔬 ' + frascoStr);
    var sStr = 'Score ' + o.calidadScore + '/10';
    if (o.scoreCompuesto != null && +o.scoreCompuesto.toFixed(1) !== o.calidadScore)
      sStr += ' → ' + o.scoreCompuesto.toFixed(1);
    parts.push(sStr);
    if (o.calidadScore >= 7) {
      if (o.totalPlacas > 0 && o.rizoPozitivas >= 0)
        parts.push('Incidencia ' + Math.round(o.rizoPozitivas / o.totalPlacas * 100) + '% (' + o.rizoPozitivas + '/' + o.totalPlacas + ')');
      if (o.tipoCordon) parts.push('Cordón: ' + o.tipoCordon);
    } else {
      parts.push('Difuso / tormentoso');
    }

    var fases = _creFasesRead(rec.formulaId, rec.geneticaId);
    var fp    = [];
    [['colonizacion_completa','Col'],['fructificacion','Fruct'],['fin_ciclo','Fin']].forEach(function(p) {
      var f = fases.find(function(f) { return f.fase === p[0]; });
      if (f) fp.push(p[1] + '.Día ' + f.dia);
    });

    var gObj   = gens.find(function(g) { return g.id === rec.geneticaId; });
    var gLabel = gObj ? gObj.label : (rec.geneticaLabel || rec.geneticaId);
    var ts     = o.fecha ? o.fecha + 'T12:00:00.000Z' : (rec.createdAt || new Date().toISOString());
    var key    = rec.formulaId + '__' + rec.geneticaId;

    if (!allNotas[key]) allNotas[key] = [];
    var _migNota = {
      id:           'mig' + (Date.now() + uid++) + Math.random().toString(36).slice(2, 5),
      ts:           ts,
      texto:        parts.join(' · '),
      fasesTexto:   fp.length ? fp.join(' · ') : null,
      auto:         true,
      logType:      'score',
      cepaLabels:   [gLabel],
      cepaIds:      [rec.geneticaId],
      imagenes:     [],
    };
    if (rec.experimentoId) _migNota.experimentoId = rec.experimentoId;
    if (rec.frascoId)      _migNota.frascoId      = rec.frascoId;
    allNotas[key].push(_migNota);
  });

  localStorage.setItem(K_CREC_NOTAS_KEY, JSON.stringify(allNotas));
  return arr.filter(function(r) { return r.status === 'cerrado'; }).length;
}

function _creRegenFaseLogs() {
  // Backfill experimentoId+frascoId en notas de fase sin contexto.
  // Solo aplica cuando el cepa tiene exactamente UN CRE record con frasco (no ambiguo).
  var arr      = creRead();
  var allNotas = {};
  try { allNotas = JSON.parse(localStorage.getItem(K_CREC_NOTAS_KEY)) || {}; } catch(e) {}

  // Mapa formulaId__geneticaId → { expId, frascoId } solo si hay exactamente un CRE con frasco
  var ctx = {};
  arr.forEach(function(rec) {
    if (!rec.formulaId || !rec.geneticaId || !rec.experimentoId || !rec.frascoId) return;
    var k = rec.formulaId + '__' + rec.geneticaId;
    if (!ctx[k]) {
      ctx[k] = { expId: rec.experimentoId, frascoId: rec.frascoId, ambiguous: false };
    } else if (ctx[k].expId !== rec.experimentoId || ctx[k].frascoId !== rec.frascoId) {
      ctx[k].ambiguous = true;  // multiple frascos → no se puede inferir a cuál pertenece la fase
    }
  });

  var repaired = 0;
  Object.keys(allNotas).forEach(function(key) {
    var c = ctx[key];
    if (!c || c.ambiguous) return;
    allNotas[key] = allNotas[key].map(function(n) {
      if (!n.auto || n.logType !== 'fase' || n.experimentoId) return n;
      n.experimentoId = c.expId;
      n.frascoId      = c.frascoId;
      repaired++;
      return n;
    });
  });

  if (repaired > 0) localStorage.setItem(K_CREC_NOTAS_KEY, JSON.stringify(allNotas));
  return repaired;
}

function creRepararDatosDeExperimentos() {
  var backfilled = _creFrascoBackfill();
  var extras     = _creExtrasBackfill();
  var extrasV2   = _creExtrasBackfillV2();
  var regenCount = _creRegenScoreLogs();
  var faseFixed  = _creRegenFaseLogs();
  notif('✓ ' + backfilled + ' frascoId asignados · ' + extras + ' snapshot(s) procesados · ' + extrasV2 + ' re-normalizados (V2) · ' + regenCount + ' score logs · ' + faseFixed + ' fase logs reparados', 'ok');
  if (_sp.formulaId) {
    var dw = document.getElementById('cre-detalle-wrap');
    if (dw && dw.style.display !== 'none') dw.innerHTML = _creScoringPanelHTML(_sp.formulaId, null);
  }
}

function crePurgarConocimiento() {
  var registros = creRead();
  var total = registros.length;

  if (!confirm(
    '⚠ PURGAR MOTOR CONOCIMIENTO\n\n' +
    'Se eliminarán PERMANENTEMENTE:\n' +
    '· ' + total + ' ensayo(s) de crecimiento (bl2_crec)\n' +
    '· Fases metabólicas registradas (bl2_crec_fases)\n' +
    '· Notas de trazabilidad (bl2_crec_notas)\n' +
    '· Índice de aprendizaje rizo (bl2_lab_rizo_learn)\n\n' +
    'Los datos de CI, GE y el pipeline NO se ven afectados.\n\n' +
    '¿Continuar?'
  )) return;

  if (!confirm(
    'CONFIRMACIÓN FINAL\n\n' +
    '¿Purgar todo el motor Conocimiento? Esta acción es IRREVERSIBLE.'
  )) return;

  try {
    _CRE_OWN_KEYS.forEach(function(k) {
      localStorage.removeItem(k);
    });
    // Limpiar también el índice de rizo derivado
    rizoLearnInvalidate();
    console.info('[CRE] Purga completada — ' + total + ' ensayo(s) + fases + notas eliminados');
    notif(total + ' ensayo(s) purgados — motor limpio ✓', 'ok');
    renderConocimiento();
  } catch(e) {
    console.error('[CRE] Error al purgar:', e);
    notif('Error al purgar — revisá la consola', 'err');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. HELPERS UI
// ═══════════════════════════════════════════════════════════════════════════

function _creFmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso + 'T12:00:00').toLocaleDateString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    });
  } catch { return iso; }
}

function _creDiasSince(isoDate) {
  if (!isoDate) return null;
  try {
    return Math.floor((Date.now() - new Date(isoDate + 'T12:00:00').getTime()) / 86400000);
  } catch { return null; }
}

function _crePhenoLabel(p) {
  return ({
    rizo_extremo: 'Rizomórfico extremo',
    rizo:         'Rizomórfico',
    normal:       'Normal',
    tomentoso:    'Tomentoso',
    contam:       'Contaminado',
  })[p] || p || '—';
}

function _crePhenoColor(p) {
  return ({
    rizo_extremo: 'var(--st-activa)',
    rizo:         '#00CC99',
    normal:       'var(--tx2)',
    tomentoso:    '#FFC000',
    contam:       'var(--st-crit)',
  })[p] || 'var(--tx3)';
}

function _creScoreColor(n) { // n: 0–100
  return n >= 75 ? 'var(--st-activa)' : n >= 50 ? '#FFC000' : 'var(--st-crit)';
}

// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// 6b. HELPERS — genMap · score teórico desde snapshot
// ═══════════════════════════════════════════════════════════════════════════

/** Mapa id→label de genéticas disponibles. */
function _creGenMap() {
  var map = {};
  creReadGenetics().forEach(function(g) { map[g.id] = g.label; });
  return map;
}

/**
 * Computa el score rizomórfico teórico (0-100) desde los ingredientes
 * del formulaSnapshot de un CRERecord.
 * NO toca bl2_seg — opera sobre cilab_app.js vía _cilab_* bridges.
 */
function _creGetTheoreticalScore(snapshotIngs) {
  if (!Array.isArray(snapshotIngs) || !snapshotIngs.length) return null;
  if (typeof calcEstadoRutas !== 'function' || typeof calcRizomorfico !== 'function') return null;
  try {
    var allIngs  = typeof readIngredientes === 'function' ? readIngredientes() : [];
    var states   = calcEstadoRutas(snapshotIngs, null);
    var cnResult = typeof calcCN === 'function' ? calcCN(snapshotIngs, allIngs) : { cn: null };
    return Math.round(calcRizomorfico(states, cnResult.cn));
  } catch(e) {
    console.warn('[CRE] _creGetTheoreticalScore error', e);
    return null;
  }
}

/**
 * Genera el modelo de calibración basado en todos los ensayos cerrados.
 * Calcula el bias de la cepa y la sinergia de los ingredientes.
 */
function getCalibrationModel() {
  const records = _creFilterMotorRecords(creRead()).filter(r => r.status === 'cerrado');
  const strainProfiles = {};
  const globalIngs = {};

  records.forEach(r => {
    const snap = r.formulaSnapshot?.ings || [];
    const th = _creGetTheoreticalScore(snap);
    const ob = r.scoreFinalNorm != null ? Math.round(r.scoreFinalNorm) : null;
    if (th == null || ob == null) return;
    
    const delta = ob - th;
    const gId = r.geneticaId || '__unknown__';

    // Strain profiles
    if (!strainProfiles[gId]) {
      strainProfiles[gId] = {
        geneticaId: gId,
        geneticaLabel: r.geneticaLabel || 'Cepa Desconocida',
        totalTrials: 0,
        sumDelta: 0,
        bias: 0,
        ingData: {} // ingId -> { sumDelta, count, avgDelta }
      };
    }

    const p = strainProfiles[gId];
    p.totalTrials++;
    p.sumDelta += delta;

    snap.forEach(ing => {
      if (!ing.id) return;
      if (!p.ingData[ing.id]) p.ingData[ing.id] = { sumDelta: 0, count: 0 };
      p.ingData[ing.id].count++;
      p.ingData[ing.id].sumDelta += delta;
      
      // Global ingredients
      if (!globalIngs[ing.id]) globalIngs[ing.id] = { sumDelta: 0, count: 0 };
      globalIngs[ing.id].count++;
      globalIngs[ing.id].sumDelta += delta;
    });
  });

  // Calculate averages
  Object.keys(strainProfiles).forEach(gId => {
    const p = strainProfiles[gId];
    p.bias = p.totalTrials > 0 ? Math.round(p.sumDelta / p.totalTrials) : 0;
    Object.keys(p.ingData).forEach(ingId => {
      const d = p.ingData[ingId];
      d.avgDelta = d.count > 0 ? Math.round(d.sumDelta / d.count) : 0;
    });
  });

  Object.keys(globalIngs).forEach(ingId => {
    const d = globalIngs[ingId];
    d.avgDelta = d.count > 0 ? Math.round(d.sumDelta / d.count) : 0;
  });

  return {
    strains: strainProfiles,
    globalIngs: globalIngs,
    computedAt: new Date().toISOString()
  };
}

/**
 * Calcula el score calibrado para una cepa y fórmula dada.
 */
function getCalibratedScore(formulaIngs, geneticaId, _model) {
  if (typeof calcEstadoRutas !== 'function' || typeof calcRizomorfico !== 'function') return null;
  var allIngs = typeof readIngredientes === 'function' ? readIngredientes() : [];
  
  // Calculate standard theoretical score for the specific genetics (takes into account strain overrides!)
  var states = calcEstadoRutas(formulaIngs, geneticaId);
  var cnResult = typeof calcCN === 'function' ? calcCN(formulaIngs, allIngs) : { cn: null };
  var thScore = Math.round(calcRizomorfico(states, cnResult.cn));
  
  if (!geneticaId) {
    return {
      theoreticalScore: thScore,
      calibratedScore: thScore,
      bias: 0,
      netCalibration: 0,
      corrections: []
    };
  }

  var model = _model || getCalibrationModel();
  var profile = model.strains[geneticaId];
  // Mínimo 2 ensayos cerrados para aplicar calibración — con N=1 el bias es ruido puro.
  if (!profile || profile.totalTrials < 2) {
    return {
      theoreticalScore: thScore,
      calibratedScore: thScore,
      bias: 0,
      netCalibration: 0,
      corrections: []
    };
  }

  var bias = profile.bias;
  var netCalibration = bias;
  var corrections = [];
  
  // General bias correction
  if (bias !== 0) {
    corrections.push({ name: 'Vigor biológico cepa', delta: bias, type: 'bias' });
  }

  formulaIngs.forEach(function(fi) {
    if ((fi.qty || 0) <= 0) return;
    var ingId = fi.id || fi.ingId;
    if (!ingId) return;

    // Specific ingredient synergy
    var ingCal = profile.ingData[ingId];
    if (ingCal && ingCal.count >= 1) {
      var synergy = ingCal.avgDelta - bias;
      if (synergy !== 0) {
        netCalibration += synergy;
        var ingName = fi.nombre || (allIngs.find(i => i.id === ingId)?.nombre) || ingId;
        corrections.push({ name: 'Sinergia: ' + ingName, delta: synergy, type: 'ingredient', ingId: ingId });
      }
    }
  });

  var calibratedScore = Math.max(0, Math.min(100, thScore + netCalibration));

  return {
    theoreticalScore: thScore,
    calibratedScore: calibratedScore,
    bias: bias,
    netCalibration: netCalibration,
    corrections: corrections
  };
}

// Exponer a la app
window._cilab_getCalibratedScore = getCalibratedScore;
window._cilab_getCalibrationModel = getCalibrationModel;

// ═══════════════════════════════════════════════════════════════════════════
// 7. AGRUPAMIENTO DE RECORDS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Agrupa CRERecords por variante de fórmula: (formulaId, experimentoId, frascoId).
 * Fórmulas simples y variantes de experimento son tiles separados.
 */
function _creGroupByFormula(records) {
  var groups = {};
  var order  = [];
  records.forEach(function(r) {
    var key = (r.formulaId || '') + '::' + (r.experimentoId || '') + '::' + (r.frascoId || '');
    if (!groups[key]) {
      var snap = r.formulaSnapshot || {};
      groups[key] = {
        groupKey:     key,
        formulaId:    r.formulaId     || '',
        experimentoId:r.experimentoId || null,
        frascoId:     r.frascoId      || null,
        snapshotIngs: snap.ings       || [],
        formulaName:  snap.nombre     || r.formulaId || '?',
        records:      [],
      };
      order.push(key);
    }
    groups[key].records.push(r);
  });
  return { groups: groups, order: order };
}

/** Agrupa CRERecords por cepa (geneticaId). */
function _creGroupByCepa(records) {
  var groups = {};
  var order  = [];
  records.forEach(function(r) {
    var key = r.geneticaId || '__unknown__';
    if (!groups[key]) {
      groups[key] = {
        geneticaId:    r.geneticaId    || null,
        geneticaLabel: r.geneticaLabel || r.geneticaId || 'Cepa desconocida',
        records:       [],
      };
      order.push(key);
    }
    groups[key].records.push(r);
  });
  return { groups: groups, order: order };
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. ESTADO DE NAVEGACIÓN
// ═══════════════════════════════════════════════════════════════════════════

var _creActiveTab   = 'formula'; // 'formula' | 'cepa'
var _creDetalleType = null;      // 'formula' | 'cepa'
var _creDetalleKey  = null;      // groupKey o geneticaId

// ═══════════════════════════════════════════════════════════════════════════
// 9. COMPONENTES HTML REUTILIZABLES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Barras comparativas teórico vs observado.
 * thScore, obScore: 0-100 o null.
 */
function _creScoreBarHTML(thScore, obScore) {
  var thPct = thScore != null ? thScore : 0;
  var thCol = thScore != null ? _creScoreColor(thScore) : 'var(--tx3)';
  var obPct = obScore != null ? obScore : 0;
  var obCol = obScore != null ? _creScoreColor(obScore) : 'var(--tx3)';
  var delta = (thScore != null && obScore != null) ? (obScore - thScore) : null;
  var dSign = delta != null ? (delta >= 0 ? '+' : '') : '';
  var dCls  = delta == null ? '' : (delta > 0 ? ' cre-delta--pos' : delta < 0 ? ' cre-delta--neg' : ' cre-delta--zero');

  return '<div class="cre-score-compare">'
    + '<div class="cre-score-bar-row">'
    +   '<span class="cre-score-bar-lbl">Teórico</span>'
    +   '<div class="cre-bar-track"><div class="cre-bar-fill" style="width:' + thPct + '%;background:' + thCol + '"></div></div>'
    +   '<span class="cre-score-bar-val" style="color:' + thCol + '">' + (thScore != null ? thScore : '—') + '</span>'
    + '</div>'
    + '<div class="cre-score-bar-row">'
    +   '<span class="cre-score-bar-lbl">Observado</span>'
    +   '<div class="cre-bar-track"><div class="cre-bar-fill" style="width:' + obPct + '%;background:' + obCol + '"></div></div>'
    +   '<span class="cre-score-bar-val" style="color:' + obCol + '">' + (obScore != null ? obScore : '—') + '</span>'
    + '</div>'
    + (delta != null
      ? '<div class="cre-delta' + dCls + '" style="margin-top:5px;align-self:flex-start">Δ ' + dSign + delta + ' pts</div>'
      : '<div style="font-size:10px;color:var(--tx3);margin-top:5px;font-style:italic">Sin score definitivo aún</div>')
    + '</div>';
}

/** Timeline de observaciones de un CRERecord. */
function _creObsTimeline(record) {
  var obs = record.observaciones || [];
  if (!obs.length) {
    return '<p class="cre-obs-empty">Sin observaciones registradas.</p>';
  }
  var LABEL = { lag: 'Lag Phase', temprana: 'Temprana', preliminar: 'Preliminar', definitiva: 'Definitiva' };
  var COL   = { lag: 'var(--tx3)', temprana: 'var(--wn)', preliminar: 'var(--ac2)', definitiva: 'var(--ac)' };

  return '<div class="cre-obs-timeline">'
    + obs.map(function(o) {
        var col   = COL[o.tipo]   || 'var(--tx3)';
        var label = LABEL[o.tipo] || o.tipo;
        var meta  = (o.dia != null ? ' · D+' + o.dia : '')
                  + (o.scoreObservado != null ? ' · Score: ' + o.scoreObservado + '/10' : '')
                  + (o.fenotipo ? ' · ' + esc(o.fenotipo) : '');
        var nota  = o.notasMorf || o.notas || '';
        var obsIdx     = obs.indexOf(o);
        var enriched   = o.enriched;
        var enrichIcon = enriched && enriched.complete
          ? '<span title="Señales registradas" style="color:var(--ac);font-size:10px;margin-left:6px">🔬✓</span>'
          : enriched
            ? '<span title="Análisis incompleto" style="color:var(--wn);font-size:10px;margin-left:6px">🔬…</span>'
            : '';
        var recIdE = esc(String(record.id));
        var analyzeBtn = '<button onclick="_creWizardOpen(\'' + recIdE + '\',' + obsIdx + ')" '
          + 'class="clab-btn clab-btn-sm" '
          + 'style="font-size:10px;padding:1px 7px;color:var(--ac2);border-color:var(--ac2);margin-top:4px">'
          + (enriched ? '🔬 Re-analizar' : '🔬 Analizar')
          + '</button>';

        return '<div class="cre-obs-item">'
          + '<div class="cre-obs-dot" style="background:' + col + '"></div>'
          + '<div class="cre-obs-body">'
          +   '<div class="cre-obs-meta">'
          +     '<span style="color:' + col + ';font-weight:700">' + esc(label) + '</span>'
          +     '<span>' + esc(meta) + '</span>'
          +     enrichIcon
          +   '</div>'
          +   (nota ? '<div class="cre-obs-nota">' + esc(nota) + '</div>' : '')
          +   analyzeBtn
          + '</div>'
          + '</div>';
      }).join('')
    + '</div>';
}

/** Formulario inline para agregar una observación a un CRERecord abierto. */
function _creAddObsForm(creId) {
  var idE = esc(String(creId));
  return '<div class="cre-add-obs-form" id="cre-obs-form-' + idE + '" style="display:none">'
    + '<div class="cre-add-obs-grid">'
    +   '<div><label class="cre-input-lbl">Fase</label>'
    +     '<select id="cre-obs-tipo-' + idE + '" class="cre-inline-select">'
    +       '<option value="lag">Lag Phase</option>'
    +       '<option value="temprana">Temprana</option>'
    +       '<option value="preliminar">Preliminar</option>'
    +       '<option value="definitiva">Definitiva (cierra ensayo)</option>'
    +     '</select></div>'
    +   '<div><label class="cre-input-lbl">Día desde inoculación</label>'
    +     '<input type="number" id="cre-obs-dia-' + idE + '" min="0" max="365" placeholder="0" class="cre-inline-input"></div>'
    +   '<div><label class="cre-input-lbl">Score observado (0–10)</label>'
    +     '<input type="number" id="cre-obs-score-' + idE + '" min="0" max="10" step="0.5" placeholder="opcional" class="cre-inline-input"></div>'
    +   '<div><label class="cre-input-lbl">Fenotipo</label>'
    +     '<select id="cre-obs-feno-' + idE + '" class="cre-inline-select">'
    +       '<option value="">—</option>'
    +       '<option value="rizo_extremo">Rizo extremo</option>'
    +       '<option value="rizo">Rizo</option>'
    +       '<option value="normal">Normal</option>'
    +       '<option value="tomentoso">Tomentoso</option>'
    +     '</select></div>'
    + '</div>'
    + '<div style="margin:8px 0"><label class="cre-input-lbl">Notas morfológicas</label>'
    +   '<textarea id="cre-obs-notas-' + idE + '" rows="2" placeholder="Descripción del crecimiento observado..." class="cre-inline-textarea"></textarea>'
    + '</div>'
    + '<div style="display:flex;gap:8px;justify-content:flex-end">'
    +   '<button onclick="creToggleAddObs(\'' + idE + '\')" class="clab-btn clab-btn-sm" style="color:var(--tx3);border-color:var(--border)">Cancelar</button>'
    +   '<button onclick="creSubmitObs(\'' + idE + '\')" class="clab-btn clab-btn-sm" style="background:var(--ac);color:var(--bg);border-color:var(--ac)">Guardar observación</button>'
    + '</div>'
    + '<div style="margin-top:6px;font-size:10px;color:var(--tx3)">Después de guardar, usá 🔬 Analizar en el timeline para documentar señales detalladas.</div>'
    + '</div>';
}

/**
 * Card de un CRERecord: score bars + timeline + form si activo.
 * context: 'formula' → muestra nombre cepa como título
 *          'cepa'    → muestra nombre fórmula como título
 */
function _creRecordCard(record, thScore, context) {
  var obScore  = record.scoreFinalNorm != null ? Math.round(record.scoreFinalNorm) : null;
  var isOpen   = record.status !== 'cerrado';
  var idE      = esc(String(record.id));

  var title = context === 'cepa'
    ? esc((record.formulaSnapshot && record.formulaSnapshot.nombre) || record.formulaId || '?')
    : esc(record.geneticaLabel || record.geneticaId || 'Cepa desconocida');

  var badge = isOpen
    ? '<span class="cre-status-badge cre-status-badge--activo">Activo</span>'
    : '<span class="cre-status-badge cre-status-badge--cerrado">Cerrado</span>';

  var addObsBtn = isOpen
    ? '<button onclick="creToggleAddObs(\'' + idE + '\')" class="clab-btn clab-btn-sm" style="margin-top:10px;color:var(--ac2);border-color:var(--ac2)">+ Agregar observación</button>'
    + _creAddObsForm(record.id)
    : '';

  return '<div class="cre-record-card" id="cre-record-' + idE + '">'
    + '<div class="cre-record-hdr">'
    +   '<span class="cre-record-title">' + title + '</span>'
    +   badge
    + '</div>'
    + _creScoreBarHTML(thScore, obScore)
    + '<div class="cre-obs-section">'
    +   '<div class="cre-obs-section-lbl">Observaciones</div>'
    +   _creObsTimeline(record)
    +   addObsBtn
    + '</div>'
    + '<div id="cre-wizard-' + idE + '" style="display:none"></div>'
    + '</div>';
}

// ═══════════════════════════════════════════════════════════════════════════
// 10. INTERACCIÓN — agregar observaciones
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Abre el wizard para enriquecer obs[obsIndex] del record recordId.
 * Si el record o la obs no existen, aborta silenciosamente.
 */
function _creWizardOpen(recordId, obsIndex) {
  const records = creRead();
  const rec     = records.find(r => r.id === recordId);
  if (!rec) return;
  const obs = (rec.observaciones || [])[obsIndex];
  if (!obs) return;

  // Calcular orden contextual de señales según la fórmula del record
  let routeStates = null;
  if (typeof calcEstadoRutas === 'function' && rec.formulaSnapshot && rec.formulaSnapshot.ings) {
    try { routeStates = calcEstadoRutas(rec.formulaSnapshot.ings, rec.geneticaId); }
    catch (e) { routeStates = null; }
  }
  const sorted = sortSignals(SIGNAL_BANK_W, routeStates);

  // Si la obs ya tenía enriched previo, pre-cargar sus valores
  const prevSignals = (obs.enriched && obs.enriched.signals) ? { ...obs.enriched.signals } : {};

  _wiz = {
    recordId,
    obsIndex,
    recordCreatedAt: rec.createdAt,
    formulaIngs:     (rec.formulaSnapshot && rec.formulaSnapshot.ings) || [],
    geneticaId:      rec.geneticaId || null,
    routeStates,
    sorted,
    signals:         prevSignals,
    step:            0,
  };

  _wiz.useModal = false;
  _creWizardRender(recordId);
}

// Versión modal — usada desde el scoring panel donde no hay container de record card
function _creWizardOpenModal(recordId, obsIndex) {
  const records = creRead();
  const rec     = records.find(r => r.id === recordId);
  if (!rec) return;
  const obs = (rec.observaciones || [])[obsIndex];
  if (!obs) return;

  let routeStates = null;
  if (typeof calcEstadoRutas === 'function' && rec.formulaSnapshot && rec.formulaSnapshot.ings) {
    try { routeStates = calcEstadoRutas(rec.formulaSnapshot.ings, rec.geneticaId); }
    catch (e) { routeStates = null; }
  }
  const sorted = sortSignals(SIGNAL_BANK_W, routeStates);
  const prevSignals = (obs.enriched && obs.enriched.signals) ? { ...obs.enriched.signals } : {};

  _wiz = {
    recordId,
    obsIndex,
    recordCreatedAt: rec.createdAt,
    formulaIngs:     (rec.formulaSnapshot && rec.formulaSnapshot.ings) || [],
    geneticaId:      rec.geneticaId || null,
    routeStates,
    sorted,
    signals:         prevSignals,
    step:            0,
    useModal:        true,
  };

  const modal = document.getElementById('cre-wizard-modal');
  if (modal) modal.style.display = '';
  _creWizardRender(recordId);
}

// Versión batch — aplica señales a todas las cepas seleccionadas en _sp.selected
function _creWizardOpenBatch(formulaId) {
  if (!_sp || _sp.selected.size === 0) return;

  const records = creRead();
  const fRecs   = _creFRecsForContext(formulaId, records);
  const _fId    = _sp.frasco ? _sp.frasco.frascoId : null;

  const batchRecords = [];
  _sp.selected.forEach(key => {
    const gId     = key.split('|')[2];
    const closed  = fRecs.filter(r => r.geneticaId === gId && r.status === 'cerrado');
    const exact   = _fId != null ? closed.filter(r => r.frascoId === _fId) : [];
    const rec     = (exact.length ? exact : closed).slice(-1)[0];
    if (rec && rec.observaciones && rec.observaciones.length) {
      batchRecords.push({ rec, obsIndex: rec.observaciones.length - 1 });
    }
  });

  if (!batchRecords.length) {
    notif('Sin registros cerrados con observaciones para las cepas seleccionadas.', 'warn');
    return;
  }

  const firstRec = batchRecords[0].rec;
  let routeStates = null;
  if (typeof calcEstadoRutas === 'function' && firstRec.formulaSnapshot && firstRec.formulaSnapshot.ings) {
    try { routeStates = calcEstadoRutas(firstRec.formulaSnapshot.ings, firstRec.geneticaId); }
    catch (e) {}
  }
  const sorted = sortSignals(SIGNAL_BANK_W, routeStates);

  // Pre-cargar señales del primer record (si tiene) como punto de partida
  const firstObs = firstRec.observaciones[batchRecords[0].obsIndex];
  const prevSignals = (firstObs.enriched && firstObs.enriched.signals)
    ? { ...firstObs.enriched.signals } : {};

  _wiz = {
    recordId:       firstRec.id,
    obsIndex:       batchRecords[0].obsIndex,
    recordCreatedAt:firstRec.createdAt,
    formulaIngs:    (firstRec.formulaSnapshot && firstRec.formulaSnapshot.ings) || [],
    geneticaId:     firstRec.geneticaId || null,
    routeStates,
    sorted,
    signals:        prevSignals,
    step:           0,
    useModal:       true,
    isBatch:        true,
    batchFormulaId: formulaId,
    batchRecords,
  };

  const modal = document.getElementById('cre-wizard-modal');
  if (modal) modal.style.display = '';
  _creWizardRender(firstRec.id);
}

function _creWizardClose(recordId) {
  const wasModal = _wiz && _wiz.useModal;
  _wiz = null;
  if (wasModal) {
    const modal = document.getElementById('cre-wizard-modal');
    if (modal) modal.style.display = 'none';
  } else {
    const el = document.getElementById('cre-wizard-' + String(recordId));
    if (el) el.style.display = 'none';
  }
}

function _creWizardRender(recordId) {
  const useModal = _wiz && _wiz.useModal;
  const el = useModal
    ? document.getElementById('cre-wizard-modal-inner')
    : document.getElementById('cre-wizard-' + String(recordId));
  if (!el || !_wiz) return;
  if (!useModal) el.style.display = '';

  if (_wiz.step >= _wiz.sorted.length) {
    el.innerHTML = _creWizardReviewHTML();
  } else {
    el.innerHTML = _creWizardStepHTML(_wiz.step);
  }
}

function _creWizardStepHTML(stepIdx) {
  const sig     = _wiz.sorted[stepIdx];
  const total   = _wiz.sorted.length;
  const current = stepIdx + 1;
  const idE     = esc(String(_wiz.recordId));

  // Atribución inmediata basada en el estado de rutas
  let atribHtml = '';
  if (_wiz.routeStates && typeof attributeSignal === 'function') {
    const meta = typeof window._cilab_loadMeta === 'function' ? window._cilab_loadMeta() : {};
    const attrs = attributeSignal(sig.id, _wiz.routeStates, _wiz.formulaIngs, meta);
    if (attrs.length) {
      atribHtml = '<div class="cre-wiz-hint">'
        + '<div class="cre-wiz-hint-title">Con tu fórmula, si ves esto → posible causa:</div>'
        + attrs.map(a =>
            '<div class="cre-wiz-hint-item">'
            + '<span class="cre-wiz-ing">' + esc(a.ingNombre) + '</span>'
            + '<span class="cre-wiz-razon">' + esc(a.razon) + '</span>'
            + '</div>'
          ).join('')
        + '</div>';
    }
  }

  const optHtml = sig.opciones.map((op, i) => {
    const opVal  = JSON.stringify(op.value);
    const storedVal = _wiz.signals[sig.id] !== undefined ? _wiz.signals[sig.id].value : undefined;
    const checked = JSON.stringify(storedVal !== undefined ? storedVal : null) === opVal;
    return '<label class="cre-wiz-option' + (checked ? ' cre-wiz-option--sel' : '') + '">'
      + '<input type="radio" name="wiz-opt-' + esc(sig.id) + '" value=\'' + opVal + '\''
      + ' onchange="creWizSelect(\'' + idE + '\',' + stepIdx + ',' + i + ')"'
      + (checked ? ' checked' : '')
      + '>'
      + '<span>' + esc(op.label) + '</span>'
      + '</label>';
  }).join('');

  return '<div class="cre-wizard-panel">'
    + '<div class="cre-wiz-progress">'
    +   '<span class="cre-wiz-step-num">Señal ' + current + ' / ' + total + (_wiz.isBatch ? ' · ' + (_wiz.batchRecords||[]).length + ' cepas' : '') + '</span>'
    +   '<div class="cre-wiz-prog-bar"><div class="cre-wiz-prog-fill" style="width:' + Math.round((current/total)*100) + '%"></div></div>'
    + '</div>'
    + '<div class="cre-wiz-question">' + esc(sig.pregunta) + '</div>'
    + '<div class="cre-wiz-desc">' + esc(sig.descripcion) + '</div>'
    + atribHtml
    + '<div class="cre-wiz-options">' + optHtml + '</div>'
    + '<div class="cre-wiz-nav">'
    +   (stepIdx > 0
        ? '<button onclick="creWizBack(\'' + idE + '\')" class="clab-btn clab-btn-sm" style="color:var(--tx3);border-color:var(--border)">← Anterior</button>'
        : '<button onclick="_creWizardClose(\'' + idE + '\')" class="clab-btn clab-btn-sm" style="color:var(--tx3);border-color:var(--border)">Cancelar</button>')
    +   '<button onclick="creWizNext(\'' + idE + '\')" class="clab-btn clab-btn-sm" style="background:var(--ac2);color:var(--bg);border-color:var(--ac2)">Siguiente →</button>'
    + '</div>'
    + '</div>';
}

function creWizSelect(recordId, stepIdx, opIdx) {
  if (!_wiz || _wiz.recordId !== recordId) return;
  const sig = _wiz.sorted[stepIdx];
  const op  = sig.opciones[opIdx];
  _wiz.signals[sig.id] = { value: op.value };
  _creWizardRender(recordId);
}

function creWizNext(recordId) {
  if (!_wiz || _wiz.recordId !== recordId) return;
  _wiz.step = Math.min(_wiz.step + 1, _wiz.sorted.length);
  _creWizardRender(recordId);
}

function creWizBack(recordId) {
  if (!_wiz || _wiz.recordId !== recordId) return;
  _wiz.step = Math.max(0, _wiz.step - 1);
  _creWizardRender(recordId);
}

function _creWizardReviewHTML() {
  const idE = esc(String(_wiz.recordId));

  const sigRows = _wiz.sorted.map(sig => {
    const sel = _wiz.signals[sig.id];
    const val = (sel && sel.value !== null && sel.value !== undefined) ? sel.value : null;
    const opLabel = val !== null
      ? ((sig.opciones.find(o => JSON.stringify(o.value) === JSON.stringify(val)) || {}).label || String(val))
      : 'No vi nada';
    const isPositive = val !== null && val !== false;
    return '<div class="cre-wiz-review-row' + (isPositive ? ' cre-wiz-review-row--pos' : '') + '">'
      + '<span class="cre-wiz-rev-sig">' + esc(sig.pregunta) + '</span>'
      + '<span class="cre-wiz-rev-val">' + esc(opLabel) + '</span>'
      + '</div>';
  }).join('');

  const positives = _wiz.sorted.filter(sig => {
    const sel = _wiz.signals[sig.id];
    return sel && sel.value !== null && sel.value !== false && sel.value !== undefined;
  });
  const summary = positives.length
    ? 'Detectaste ' + positives.length + ' señal' + (positives.length > 1 ? 'es' : '') + ': ' + positives.map(s => s.id).join(', ') + '.'
    : 'No detectaste señales en esta observación.';

  return '<div class="cre-wizard-panel">'
    + '<div class="cre-wiz-review-title">Resumen — confirmá antes de guardar</div>'
    + '<div class="cre-wiz-summary">' + esc(summary) + '</div>'
    + sigRows
    + '<div class="cre-wiz-nav">'
    +   '<button onclick="creWizBack(\'' + idE + '\')" class="clab-btn clab-btn-sm" style="color:var(--tx3);border-color:var(--border)">← Revisar</button>'
    +   '<button onclick="creWizSave(\'' + idE + '\')" class="clab-btn clab-btn-sm" style="background:var(--ac);color:var(--bg);border-color:var(--ac)">Guardar señales</button>'
    + '</div>'
    + '</div>';
}

function creWizSave(recordId) {
  if (!_wiz || _wiz.recordId !== recordId) return;

  // Construir signals object normalizado
  const signals = {};
  _wiz.sorted.forEach(sig => {
    const sel = _wiz.signals[sig.id];
    const val = (sel && sel.value !== undefined) ? sel.value : null;
    if (sig.id === 'oxidacion_inoculo' || sig.id === 'oxidacion_agar' || sig.id === 'oxidacion') {
      signals[sig.id] = { presente: val !== null && val !== false, intensidad: val };
    } else if (sig.id === 'exudados') {
      signals.exudados = { presente: val !== null && val !== false, color: val };
    } else if (sig.id === 'cristalizacion' || sig.id === 'sectoring' || sig.id === 'autolisis') {
      signals[sig.id] = { presente: val === true };
    } else {
      // velocidadRel, patronInvasion, fenotipoAereo — valor escalar
      signals[sig.id] = val;
    }
  });

  const _isBatch        = !!_wiz.isBatch;
  const _wasModal       = !!_wiz.useModal;
  const _batchFormulaId = _wiz.batchFormulaId || null;
  const _batchRecords   = _wiz.batchRecords   || [];

  // Timestamp compartido
  const _d = new Date();
  const _p = n => String(n).padStart(2, '0');
  const _ts = _p(_d.getDate()) + '/' + _p(_d.getMonth() + 1) + ' ' + _p(_d.getHours()) + ':' + _p(_d.getMinutes());

  // Texto de log: señales positivas
  const _positivas = _wiz.sorted.filter(sig => {
    const s = signals[sig.id];
    if (!s) return false;
    if (typeof s === 'object' && s !== null) return s.presente === true;
    return s !== null && s !== false;
  });
  const _logParts = _positivas.map(sig => {
    const s = signals[sig.id];
    const intens = s && s.intensidad ? ' (' + s.intensidad + ')' : '';
    return sig.id + intens;
  });
  const _logBase = _logParts.length ? '🔬 Señales: ' + _logParts.join(' · ') : '🔬 Sin señales detectadas';

  let _formulaForRefresh = _batchFormulaId;

  if (_isBatch) {
    let _savedN = 0;
    _batchRecords.forEach(br => {
      const r = enrichObs(br.rec.id, br.obsIndex, { complete: true, signals }, br.rec.createdAt);
      if (r.ok) {
        _savedN++;
        const _logTxt = _logBase + ' [global · ' + _batchRecords.length + ' cepas]';
        const _notas = _creNotasRead(br.rec.formulaId, br.rec.geneticaId).filter(n => n.logType !== 'wizard');
        _notas.push({ id: 'wiz-' + Date.now() + _savedN, ts: _ts, texto: _logTxt, auto: true, logType: 'wizard', imagenes: [] });
        _creNotasWrite(br.rec.formulaId, br.rec.geneticaId, _notas);
      }
    });
    notif('Señales guardadas en ' + _savedN + ' cepas.', 'ok');
  } else {
    const result = enrichObs(_wiz.recordId, _wiz.obsIndex, { complete: true, signals }, _wiz.recordCreatedAt);
    if (!result.ok) {
      notif('Error al guardar: ' + result.reason, 'error');
      return;
    }
    const _wizRec = creRead().find(r => r.id === _wiz.recordId);
    if (_wizRec) {
      _formulaForRefresh = _wizRec.formulaId;
      const _notas = _creNotasRead(_wizRec.formulaId, _wizRec.geneticaId).filter(n => n.logType !== 'wizard');
      _notas.push({ id: 'wiz-' + Date.now(), ts: _ts, texto: _logBase, auto: true, logType: 'wizard', imagenes: [] });
      _creNotasWrite(_wizRec.formulaId, _wizRec.geneticaId, _notas);
    }
    notif('Señales guardadas.', 'ok');
  }

  _wiz = null;

  if (_wasModal) {
    const modal = document.getElementById('cre-wizard-modal');
    if (modal) modal.style.display = 'none';
    if (_formulaForRefresh) {
      _creRenderCepasSection(_formulaForRefresh);
      _creRenderLogSection(_formulaForRefresh);
    }
  } else {
    if (typeof renderConocimiento === 'function') renderConocimiento();
  }
}

function creToggleAddObs(creId) {
  var form = document.getElementById('cre-obs-form-' + creId);
  if (!form) return;
  form.style.display = form.style.display === 'none' ? '' : 'none';
}

/**
 * Lee el formulario inline y llama creAddObs().
 * Luego re-renderiza el detalle in-place.
 */
function creSubmitObs(creId) {
  var tipoEl  = document.getElementById('cre-obs-tipo-'  + creId);
  var diaEl   = document.getElementById('cre-obs-dia-'   + creId);
  var scoreEl = document.getElementById('cre-obs-score-' + creId);
  var fenoEl  = document.getElementById('cre-obs-feno-'  + creId);
  var notasEl = document.getElementById('cre-obs-notas-' + creId);

  var tipo  = tipoEl  ? tipoEl.value  : 'lag';
  var diaN  = diaEl   ? parseInt(diaEl.value,   10) : 0;
  var scoreN= scoreEl ? parseFloat(scoreEl.value) : NaN;
  var feno  = fenoEl  ? fenoEl.value.trim()  : '';
  var notas = notasEl ? notasEl.value.trim() : '';

  if (isNaN(diaN) || diaN < 0) diaN = 0;
  if (!isNaN(scoreN) && (scoreN < 0 || scoreN > 10)) {
    notif('Score debe estar entre 0 y 10', 'err'); return;
  }

  var obs = {
    tipo:      tipo,
    dia:       diaN,
    fecha:     new Date().toISOString().slice(0, 10),
    notasMorf: notas,
    fenotipo:  feno || null,
    createdAt: new Date().toISOString(),
  };
  if (!isNaN(scoreN) && scoreEl && scoreEl.value.trim() !== '') obs.scoreObservado = scoreN;

  try {
    var updated = creAddObs(creId, obs);
    if (!updated) { notif('Ensayo no encontrado', 'err'); return; }
    var msg = tipo === 'definitiva' ? 'Observación definitiva guardada — ensayo cerrado' : 'Observación guardada';
    notif(msg, 'ok');
    // Re-render el detalle activo
    if (_creDetalleType === 'formula' && _creDetalleKey) {
      _creRenderFormulaDetail(_creDetalleKey);
    } else if (_creDetalleType === 'cepa' && _creDetalleKey) {
      _creRenderCepaDetail(_creDetalleKey);
    }
  } catch(e) {
    console.warn('[CRE] creSubmitObs error', e);
    notif('Error al guardar observación', 'err');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 11. GRID — tab control + tiles
// ═══════════════════════════════════════════════════════════════════════════

function _creSetTab(tab) {
  _creActiveTab = tab;
  ['formula', 'cepa'].forEach(function(t) {
    var btn = document.getElementById('cre-tab-' + t);
    if (btn) btn.classList.toggle('active', t === tab);
  });
  var grid = document.getElementById('cre-grid-wrap');
  if (!grid) return;
  var inner = grid.querySelector('.cre-grid');
  if (!inner) return;
  var records = creRead();
  inner.innerHTML = tab === 'formula'
    ? _creRenderFormulaGrid(records)
    : _creRenderCepaGrid(records);
}

/**
 * Calcula la completitud de scoring por experimentos para una fórmula.
 * Un experimento está "completo" cuando todas las cepas tienen al menos
 * un record cerrado con ese experimentoId.
 *
 * @param {string} formulaId
 * @param {Array}  cepas         - Array<{id}> de cepas de la fórmula
 * @param {Array}  closedRecords - CRE records con status 'cerrado' para esta fórmula
 * @returns {{ totalExps, doneExps, pct }} | null si no hay experimentos vinculados
 */
function _creExpsCompletionStats(formulaId, cepas, closedRecords) {
  var frascos = _creGetFrascosForFormula(formulaId);
  if (!frascos.length) return null;

  var seenExpId = {};
  var expIds = [];
  frascos.forEach(function(fr) {
    if (!seenExpId[fr.expId]) { seenExpId[fr.expId] = true; expIds.push(fr.expId); }
  });
  if (!expIds.length) return null;

  var doneExps = 0;
  expIds.forEach(function(expId) {
    // Un record base (sin experimentoId) cuenta como evidencia válida para cualquier
    // experimento de la misma fórmula — cubre records huérfanos y puntuaciones base legítimas.
    var expRecs = closedRecords.filter(function(r) {
      return r.experimentoId === expId || !r.experimentoId;
    });
    var allDone = cepas.length > 0 && cepas.every(function(c) {
      return expRecs.some(function(r) { return r.geneticaId === c.id; });
    });
    if (allDone) doneExps++;
  });

  return {
    totalExps: expIds.length,
    doneExps:  doneExps,
    pct:       Math.round(doneExps / expIds.length * 100),
  };
}

function _creFormulaCards(records, model) {
  var forms = _creSortFormsForKnowledge(readForms());
  if (!forms.length) {
    return '<div class="cre-empty-state">'
      + '<div class="cre-empty-title">Sin formulas creadas</div>'
      + '<div class="cre-empty-copy">Crea una formula en Biblioteca para empezar a calibrar el motor.</div>'
      + '</div>';
  }

  return '<div class="cre-fc-grid">'
    + forms.map(function(f) {
        var snapshot = creGetFormulaSnapshot(f.id);
        if (!snapshot || !snapshot.ings.length) return '';

        var allIngs  = typeof readIngredientes === 'function' ? readIngredientes() : [];
        var cnResult = typeof calcCN === 'function' ? calcCN(snapshot.ings, allIngs) : { cn: null };
        var cn = cnResult.cn != null ? (+cnResult.cn).toFixed(1) : '—';
        var isExcluded = _creIsFormulaExcluded(f.id);
        var dateLabel = _creFormulaDateLabel(f);

        var frascos = _creGetFrascosForFormula(f.id);
        var frascoChip = frascos.length
          ? '<span class="cre-fc-chip-exp">🔬 ' + frascos.length + '</span>'
          : '';

        var cepas   = _creGetCepasForFormula(f.id);
        var fRecs     = records.filter(function(r) { return r.formulaId === f.id && r.status === 'cerrado'; });
        var allFRecs  = records.filter(function(r) { return r.formulaId === f.id; });

        var doneCepaIds = fRecs.map(function(r) { return r.geneticaId; });
        var doneCount   = cepas.filter(function(c) { return doneCepaIds.indexOf(c.id) !== -1; }).length;
        var totalCepas  = cepas.length;

        // Progreso por cepa:
        //   score < 7 (tormentoso): max 2 — (1) colonizacion_completa, (2) score
        //   score >= 7 (rizomórfico): max 3 — (1) colonizacion_completa, (2) score, (3) incidencia
        //   score desconocido: max 3 (conservador)
        var _fasesAll = {};
        try { _fasesAll = JSON.parse(localStorage.getItem(K_CREC_FASES)) || {}; } catch(e) {}
        var pctItems = 0;
        var pctMax   = 0;
        cepas.forEach(function(c) {
          var rec = allFRecs.find(function(r) { return r.geneticaId === c.id && r.status === 'cerrado'; })
                 || allFRecs.find(function(r) { return r.geneticaId === c.id; });
          var _lastObs  = rec ? ((rec.observaciones || []).slice(-1)[0] || {}) : {};
          var _recScore = _lastObs.calidadScore != null ? _lastObs.calidadScore : null;
          // Progress: 1 point for score registered; +1 for rizo incidence if score >= 7
          var _hasScore  = rec && rec.observaciones && rec.observaciones.some(function(o) { return o.calidadScore != null; });
          var _needsRizo = _recScore != null && _recScore >= 7;
          var _cepaMax   = _needsRizo ? 2 : 1;
          pctMax += _cepaMax;

          if (_hasScore) pctItems++;
          if (_needsRizo && rec && rec.rizoPozitivas != null && rec.totalPlacas > 0) pctItems++;
        });
        var pct = pctMax > 0 ? Math.round((pctItems / pctMax) * 100) : 0;
        var statusLabel = totalCepas === 0 ? 'Sin CI'
                        : doneCount === totalCepas ? 'Calibrada'
                        : doneCount > 0 ? 'Parcial'
                        : 'Pendiente';

        var cardCls = totalCepas === 0 ? 'cre-fc-card cre-fc-card--empty'
                    : doneCount === 0  ? 'cre-fc-card'
                    : doneCount < totalCepas ? 'cre-fc-card cre-fc-card--pending'
                    : 'cre-fc-card cre-fc-card--done';

        // Override de progreso cuando hay experimentos vinculados
        var expStats = _creExpsCompletionStats(f.id, cepas, fRecs);
        if (expStats !== null) {
          pct = expStats.pct;
          cardCls = totalCepas === 0 ? 'cre-fc-card cre-fc-card--empty'
                  : expStats.doneExps === 0                        ? 'cre-fc-card'
                  : expStats.doneExps < expStats.totalExps         ? 'cre-fc-card cre-fc-card--pending'
                  : 'cre-fc-card cre-fc-card--done';
          statusLabel = totalCepas === 0 ? 'Sin CI'
                      : expStats.doneExps === expStats.totalExps ? 'Calibrada'
                      : expStats.doneExps > 0                    ? 'Parcial'
                      : 'Pendiente';
        }
        if (isExcluded) cardCls += ' cre-fc-card--excluded';

        var cepaRowsHTML = cepas.slice(0, 4).map(function(c) {
          var rec = fRecs.find(function(r) { return r.geneticaId === c.id; });
          var nameCls, badgeHTML;
          if (rec && rec.scoreFinalNorm != null) {
            var sc = Math.round(rec.scoreFinalNorm / 10);
            var tc = rec.observaciones && rec.observaciones.length
              ? (rec.observaciones[rec.observaciones.length-1].tipoCordon || '')
              : '';
            var incid = (rec.rizoPozitivas != null && rec.totalPlacas > 0)
              ? Math.round((rec.rizoPozitivas / rec.totalPlacas) * 100) + '%'
              : '';
            var badge = sc + (tc ? ' · ' + tc.charAt(0).toUpperCase() + tc.slice(1) : '') + (incid ? ' · ' + incid : '');
            nameCls = 'cre-fc-cepa-name cre-fc-cepa-name--done';
            badgeHTML = '<span class="cre-fc-badge cre-fc-badge--done">' + esc(badge) + '</span>';
          } else {
            nameCls = 'cre-fc-cepa-name cre-fc-cepa-name--pend';
            badgeHTML = '<span class="cre-fc-badge cre-fc-badge--pend">pendiente</span>';
          }
          var shortLabel = _creAbrevEspecie(c.label);
          return '<div class="cre-fc-cepa-row">'
            + '<span class="' + nameCls + '">' + (rec && rec.scoreFinalNorm != null ? '✓ ' : '◑ ') + esc(shortLabel) + ' <em class="cre-fc-date">' + esc(dateLabel) + '</em></span>'
            + badgeHTML
            + '</div>';
        }).join('');

        if (totalCepas === 0) {
          cepaRowsHTML = '<div class="cre-fc-muted">Sin cepas detectadas de CI</div>';
        } else if (cepas.length > 4) {
          cepaRowsHTML += '<div class="cre-fc-more">+ ' + (cepas.length - 4) + ' mas</div>';
        }

        var progressLabel = isExcluded ? 'Desacoplada: no calibra el motor'
          : totalCepas === 0 ? '—'
          : expStats !== null
            ? (expStats.doneExps === expStats.totalExps
                ? '✓ ' + expStats.totalExps + '/' + expStats.totalExps + ' experimentos · Score: ' + _creCompoundAvg(fRecs)
                : expStats.doneExps + '/' + expStats.totalExps + ' experimentos completados')
            : doneCount === totalCepas && totalCepas > 0
              ? '✓ Calibrada · Score compuesto: ' + _creCompoundAvg(fRecs)
              : doneCount + ' de ' + totalCepas + ' cepas puntuadas';

        var fIdE = esc(f.id);
        return '<div class="' + cardCls + '" data-cre-formula="' + fIdE + '" onclick="creOpenScoringPanel(\'' + fIdE + '\')">'
          + '<button class="cre-fc-exclude-btn" onclick="event.stopPropagation();creToggleFormulaMotor(\'' + fIdE + '\')" title="' + (isExcluded ? 'Reactivar para calibracion' : 'Desacoplar del motor') + '">'
          + (isExcluded ? '+' : '×')
          + '</button>'
          + '<div class="cre-fc-top">'
          +   '<div class="cre-fc-name" title="' + esc(snapshot.nombre) + '">' + esc(snapshot.nombre) + '</div>'
          +   '<span class="cre-fc-status">' + (isExcluded ? 'Fuera motor' : statusLabel) + '</span>'
          + '</div>'
          + '<div class="cre-fc-chips">'
          +   '<span>C/N ' + cn + '</span>'
          +   '<span>' + snapshot.ings.length + ' ingredientes</span>'
          +   '<span>' + totalCepas + ' cepas</span>'
          +   frascoChip
          +   '<span>' + esc(dateLabel) + '</span>'
          + '</div>'
          + '<div class="cre-fc-cepas">' + cepaRowsHTML + '</div>'
          + '<div class="cre-fc-progress-row">'
          +   '<div class="cre-fc-progress-bar"><div class="cre-fc-progress-fill" style="width:' + pct + '%"></div></div>'
          +   '<span class="cre-fc-progress-num">' + pct + '%</span>'
          + '</div>'
          + '<div class="cre-fc-progress-label">' + esc(progressLabel) + '</div>'
          + '</div>';
      }).join('')
    + '</div>';
}

function _creCompoundAvg(fRecs) {
  var valid = fRecs.filter(function(r) {
    return r.scoreFinalNorm != null && r.totalPlacas > 0 && r.rizoPozitivas != null;
  });
  if (!valid.length) {
    var simple = fRecs.filter(function(r) { return r.scoreFinalNorm != null; });
    if (!simple.length) return '—';
    var avg = simple.reduce(function(a, r) { return a + Math.round(r.scoreFinalNorm / 10); }, 0) / simple.length;
    return avg.toFixed(1);
  }
  var sum = valid.reduce(function(a, r) {
    return a + (Math.round(r.scoreFinalNorm / 10) * (r.rizoPozitivas / r.totalPlacas));
  }, 0);
  return (sum / valid.length).toFixed(1);
}

function _creRenderGrid() {
  var grid = document.getElementById('cre-grid-wrap');
  if (!grid) return;

  var allRecords = creRead();
  var records = _creFilterMotorRecords(allRecords);
  var closedRecords = records.filter(r => r.status === 'cerrado');
  var activeRecords = records.filter(r => r.status !== 'cerrado');
  var model = getCalibrationModel();
  var selectableGenetics = creReadGenetics();

  // Selected genetics for simulation
  if (!window._creSimCepaId && selectableGenetics.length) {
    window._creSimCepaId = selectableGenetics[0].id;
  }

  var html = '';

  html += '<div class="cre-dashboard-container">';

  var totalStrains = Object.keys(model.strains).length;
  var totalIngs = Object.keys(model.globalIngs).length;
  var excludedCount = _creExcludedFormsRead().length;
  var sortMode = _creFormulaSortRead();
  var precisionClass = closedRecords.length >= 10 ? 'cre-kpi-val--high' : closedRecords.length >= 3 ? 'cre-kpi-val--mid' : 'cre-kpi-val--low';
  var precisionText = closedRecords.length >= 10 ? 'Alta' : closedRecords.length >= 3 ? 'Media' : 'Baja';

  html += '<div class="cre-kpi-grid">'
    + '<div class="cre-kpi">'
    +   '<div class="cre-kpi-label">Ensayos cerrados</div>'
    +   '<div class="cre-kpi-val">' + closedRecords.length + '</div>'
    +   '<div class="cre-kpi-sub">Base de calibracion</div>'
    + '</div>'
    + '<div class="cre-kpi">'
    +   '<div class="cre-kpi-label">Ensayos activos</div>'
    +   '<div class="cre-kpi-val cre-kpi-val--accent">' + activeRecords.length + '</div>'
    +   '<div class="cre-kpi-sub">En cultivo / placas</div>'
    + '</div>'
    + '<div class="cre-kpi">'
    +   '<div class="cre-kpi-label">Precision del motor</div>'
    +   '<div class="cre-kpi-val cre-kpi-val--text ' + precisionClass + '">' + precisionText + '</div>'
    +   '<div class="cre-kpi-sub">' + closedRecords.length + '/10 ensayos activos para senal fuerte</div>'
    + '</div>'
    + '</div>';

  html += '<div class="cre-intel-columns">'
    + '<div class="cre-intel-column">'
    +   '<div class="cre-column-header">Vigor biologico de cepas</div>'
    +   '<div class="cre-column-body">'
    +     (totalStrains === 0 
          ? '<p class="cre-empty-text">Sin datos de cepas en ensayos cerrados.</p>'
          : Object.values(model.strains).map(function(s) {
              var deltaClass = s.bias > 0 ? 'cre-delta--pos' : s.bias < 0 ? 'cre-delta--neg' : 'cre-delta--zero';
              var deltaSign = s.bias > 0 ? '+' : '';
              var label = _creAbrevEspecie(s.geneticaLabel);
              return '<div class="cre-intel-item" onclick="creOpenDetalle(\'' + s.geneticaId + '\', \'cepa\')">'
                + '<div>'
                +   '<div class="cre-item-name">' + esc(label) + '</div>'
                +   '<div class="cre-item-sub">' + s.totalTrials + ' ensayo(s) cerrado(s)</div>'
                + '</div>'
                + '<span class="cre-delta ' + deltaClass + '">Delta ' + deltaSign + s.bias + ' pts</span>'
                + '</div>';
            }).join(''))
    +   '</div>'
    + '</div>'

    + '<div class="cre-intel-column">'
    +   '<div class="cre-column-header">Sinergias practicas</div>'
    +   '<div class="cre-column-body">'
    +     (totalIngs === 0 
          ? '<p class="cre-empty-text">Sin datos de ingredientes en ensayos cerrados.</p>'
          : Object.keys(model.globalIngs).map(function(ingId) {
              var d = model.globalIngs[ingId];
              var allIngs = typeof readIngredientes === 'function' ? readIngredientes() : [];
              var name = (allIngs.find(i => i.id === ingId)?.nombre) || ingId;
              var deltaClass = d.avgDelta > 0 ? 'cre-delta--pos' : d.avgDelta < 0 ? 'cre-delta--neg' : 'cre-delta--zero';
              var deltaSign = d.avgDelta > 0 ? '+' : '';
              var typeLabel = d.avgDelta > 5 ? 'Potenciador' : d.avgDelta < -5 ? 'Restrictivo' : 'Neutral';
              return '<div class="cre-intel-item">'
                + '<div>'
                +   '<div class="cre-item-name">' + esc(name) + '</div>'
                +   '<div class="cre-item-sub">' + d.count + ' ensayos - ' + typeLabel + '</div>'
                + '</div>'
                + '<span class="cre-delta ' + deltaClass + '">' + deltaSign + d.avgDelta + ' pts</span>'
                + '</div>';
            }).slice(0, 5).join(''))
    +   '</div>'
    + '</div>'
    + '</div>';

  html += '<section class="cre-formula-section">'
    + '<div class="cre-section-head">'
    +   '<div>'
    +     '<div class="cre-section-title">Formulas</div>'
    +     '<div class="cre-section-sub">Hace click en una formula para puntuar el crecimiento por cepa. ' + excludedCount + ' fuera del motor.</div>'
    +   '</div>'
    +   '<label class="cre-sort-control">'
    +     '<span>Ordenar</span>'
    +     '<select onchange="creSetFormulaSort(this.value)">'
    +       '<option value="fecha_desc"' + (sortMode === 'fecha_desc' ? ' selected' : '') + '>Fecha nueva</option>'
    +       '<option value="fecha_asc"' + (sortMode === 'fecha_asc' ? ' selected' : '') + '>Fecha vieja</option>'
    +       '<option value="nombre_asc"' + (sortMode === 'nombre_asc' ? ' selected' : '') + '>Nombre A-Z</option>'
    +       '<option value="nombre_desc"' + (sortMode === 'nombre_desc' ? ' selected' : '') + '>Nombre Z-A</option>'
    +       '<option value="ings_desc"' + (sortMode === 'ings_desc' ? ' selected' : '') + '>Mas ingredientes</option>'
    +       '<option value="ings_asc"' + (sortMode === 'ings_asc' ? ' selected' : '') + '>Menos ingredientes</option>'
    +     '</select>'
    +   '</label>'
    + '</div>'
    + _creFormulaCards(allRecords, model)
    + '</section>';


  html += '</div>'; // /dashboard container

  grid.innerHTML = html;
}

// Handler de cambio de cepa de simulación
window._creOnSimCepaChange = function(val) {
  window._creSimCepaId = val;
  _creRenderGrid();
};

// Exponer optimización directa
window.creGoOptimizeWithCalib = function(formulaId, geneticaId) {
  if (!formulaId) return;
  // 1. Cambiar fórmula en select del Analizador
  var fSel = document.getElementById('clab-anal-formula');
  if (fSel) {
    fSel.value = formulaId;
    fSel.dispatchEvent(new Event('change'));
  }
  // 2. Cambiar cepa en select del Analizador
  var cSel = document.getElementById('clab-anal-cepa');
  if (cSel) {
    cSel.value = geneticaId;
    cSel.dispatchEvent(new Event('change'));
  }
  // 3. Ir a pestaña Analizador
  if (typeof window.clabSubTab === 'function') {
    window.clabSubTab('analizador');
  }
  // 4. Abrir optimizador
  setTimeout(function() {
    if (typeof window.clabOpenOptimizer === 'function') {
      window.clabOpenOptimizer();
    }
  }, 400);
};

function _creRenderFormulaGrid(records) {
  var allIngs = typeof readIngredientes === 'function' ? readIngredientes() : [];
  var grouped = _creGroupByFormula(records);

  return grouped.order.map(function(key) {
    var grp     = grouped.groups[key];
    var thScore = _creGetTheoreticalScore(grp.snapshotIngs);
    var cnResult= typeof calcCN === 'function' && grp.snapshotIngs.length
                  ? calcCN(grp.snapshotIngs, allIngs) : { cn: null, masa: 0 };
    var cn      = cnResult.cn != null ? (+cnResult.cn).toFixed(1) : '—';
    var thCol   = thScore != null ? _creScoreColor(thScore) : 'var(--tx3)';
    var thW     = thScore != null ? thScore : 0;

    // Mini chips: cepa + delta
    var chipHTML = grp.records.slice(0, 5).map(function(r) {
      var ob    = r.scoreFinalNorm != null ? Math.round(r.scoreFinalNorm) : null;
      var delta = (thScore != null && ob != null) ? (ob - thScore) : null;
      var dStr  = delta != null ? (delta >= 0 ? '+' : '') + delta : '─';
      var dCol  = delta != null ? (delta >= 0 ? 'var(--ac)' : 'var(--er)') : 'var(--tx3)';
      var label = esc(String(r.geneticaLabel || r.geneticaId || '?').slice(0, 6));
      return '<span class="cre-chip" style="border-color:' + dCol + ';color:' + dCol + '">'
        + label + ' <b>' + dStr + '</b></span>';
    }).join('');

    var closedCount = grp.records.filter(function(r) { return r.status === 'cerrado'; }).length;
    var openCount   = grp.records.filter(function(r) { return r.status !== 'cerrado'; }).length;

    return '<div class="cre-tile" data-key="' + esc(key) + '" onclick="creOpenDetalle(this.dataset.key,\'formula\')" data-cre-formula="' + esc(grp.formulaId) + '">'
      + '<div class="cre-tile-top">'
      +   '<span class="cre-tile-name" title="' + esc(grp.formulaName) + '">' + esc(grp.formulaName) + '</span>'
      + '</div>'
      + '<div class="cre-tile-id">C/N ' + cn + (grp.experimentoId ? ' · variante exp.' : '') + '</div>'
      + '<div style="margin:8px 0">'
      +   '<div style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Score Teórico</div>'
      +   '<div style="display:flex;align-items:center;gap:6px">'
      +     '<div class="cre-tile-bar" style="flex:1;height:5px"><div class="cre-tile-bar-fill" style="width:' + thW + '%;background:' + thCol + '"></div></div>'
      +     '<span style="font-size:12px;font-weight:700;color:' + thCol + ';font-family:\'JetBrains Mono\',monospace">' + (thScore != null ? thScore : '—') + '</span>'
      +   '</div>'
      + '</div>'
      + (chipHTML ? '<div class="cre-chips">' + chipHTML + '</div>' : '')
      + '<div class="cre-tile-footer">'
      +   '<span style="color:var(--tx3)">' + grp.records.length + ' cepa' + (grp.records.length !== 1 ? 's' : '') + '</span>'
      +   (openCount   ? '<span style="color:var(--ac);font-size:9px">'    + openCount   + ' activo'  + (openCount   !== 1 ? 's' : '') + '</span>' : '')
      +   (closedCount ? '<span style="color:var(--tx3);font-size:9px">'   + closedCount + ' cerrado' + (closedCount !== 1 ? 's' : '') + '</span>' : '')
      + '</div>'
      + '</div>';
  }).join('');
}

function _creRenderCepaGrid(records) {
  var grouped = _creGroupByCepa(records);

  return grouped.order.map(function(key) {
    var grp    = grouped.groups[key];
    var deltas = [];

    grp.records.forEach(function(r) {
      var snap    = r.formulaSnapshot ? r.formulaSnapshot.ings : [];
      var th      = _creGetTheoreticalScore(snap);
      var ob      = r.scoreFinalNorm != null ? Math.round(r.scoreFinalNorm) : null;
      if (th != null && ob != null) deltas.push(ob - th);
    });

    var avgDelta = deltas.length
      ? Math.round(deltas.reduce(function(a, b) { return a + b; }, 0) / deltas.length)
      : null;
    var dSign = avgDelta != null ? (avgDelta >= 0 ? '+' : '') : '';
    var dCls  = avgDelta == null ? '' : (avgDelta > 0 ? ' cre-delta--pos' : avgDelta < 0 ? ' cre-delta--neg' : ' cre-delta--zero');

    var closed  = grp.records.filter(function(r) { return r.scoreFinalNorm != null; });
    var avgObs  = closed.length
      ? Math.round(closed.reduce(function(a, r) { return a + r.scoreFinalNorm; }, 0) / closed.length)
      : null;

    return '<div class="cre-tile" data-key="' + esc(key) + '" onclick="creOpenDetalle(this.dataset.key,\'cepa\')">'
      + '<div class="cre-tile-top">'
      +   '<span class="cre-tile-name">' + esc(grp.geneticaLabel) + '</span>'
      + '</div>'
      + '<div class="cre-tile-id">' + grp.records.length + ' fórmula' + (grp.records.length !== 1 ? 's' : '') + ' testeadas</div>'
      + (avgDelta != null
        ? '<div class="cre-delta' + dCls + '" style="margin:8px 0;font-size:16px">Δ ' + dSign + avgDelta + '<span style="font-size:10px;font-weight:400"> pts calibración</span></div>'
        : '<div style="font-size:11px;color:var(--tx3);margin:8px 0;font-style:italic">Sin scores definitivos aún</div>')
      + (avgObs != null
        ? '<div style="font-size:10px;color:var(--tx3)">Score observado promedio: <span style="color:' + _creScoreColor(avgObs) + ';font-weight:600">' + avgObs + '/100</span></div>'
        : '')
      + '</div>';
  }).join('');
}

// ═══════════════════════════════════════════════════════════════════════════
// 12. NAVEGACIÓN
// ═══════════════════════════════════════════════════════════════════════════

function creOpenDetalle(key, type) {
  _creDetalleType = type;
  _creDetalleKey  = key;
  var grid    = document.getElementById('cre-grid-wrap');
  var detalle = document.getElementById('cre-detalle-wrap');
  if (grid)    grid.style.display    = 'none';
  if (detalle) detalle.style.display = '';
  if (type === 'formula') {
    _creRenderFormulaDetail(key);
  } else {
    _creRenderCepaDetail(key);
  }
}

function creVolverGrid() {
  _creDetalleType = null;
  _creDetalleKey  = null;
  var grid    = document.getElementById('cre-grid-wrap');
  var detalle = document.getElementById('cre-detalle-wrap');
  if (grid)    grid.style.display    = '';
  if (detalle) { detalle.style.display = 'none'; detalle.innerHTML = ''; }
  _creRenderGrid();
}

// ─── Detalle por fórmula ──────────────────────────────────────────────────

function _creRenderFormulaDetail(groupKey) {
  var dw = document.getElementById('cre-detalle-wrap');
  if (!dw) return;

  var records = creRead();
  var grouped = _creGroupByFormula(records);
  var grp     = grouped.groups[groupKey];

  if (!grp) { dw.innerHTML = '<p style="color:var(--er)">Grupo no encontrado.</p>'; return; }

  var allIngs  = typeof readIngredientes === 'function' ? readIngredientes() : [];
  var thScore  = _creGetTheoreticalScore(grp.snapshotIngs);
  var cnResult = typeof calcCN === 'function' && grp.snapshotIngs.length
                 ? calcCN(grp.snapshotIngs, allIngs) : { cn: null, masa: 0 };
  var cn       = cnResult.cn != null ? (+cnResult.cn).toFixed(1) : '—';
  var masa     = cnResult.masa ? (+cnResult.masa).toFixed(0) : '—';
  var thCol    = thScore != null ? _creScoreColor(thScore) : 'var(--tx3)';
  var thW      = thScore != null ? thScore : 0;

  var header = '<div class="cre-detalle-header">'
    + '<button class="cre-back-btn" onclick="creVolverGrid()">&#x2190; Volver</button>'
    + '<div><div class="cre-detalle-title">' + esc(grp.formulaName) + '</div>'
    +   '<div class="cre-detalle-meta">C/N ' + cn + ' · ' + masa + 'g'
    +     (grp.experimentoId ? ' · <span style="color:var(--ac2)">variante experimento</span>' : '')
    +   '</div>'
    + '</div></div>';

  var thSection = '<div class="cre-th-score-block">'
    + '<div class="cre-th-score-label">Score Teórico del Sistema</div>'
    + '<div class="cre-th-score-inner">'
    + (thScore != null
      ? '<div class="cre-bar-track cre-bar-lg"><div class="cre-bar-fill" style="width:' + thW + '%;background:' + thCol + '"></div></div>'
      +   '<span class="cre-th-score-val" style="color:' + thCol + '">' + thScore + '<small> / 100</small></span>'
      : '<span style="color:var(--tx3);font-size:11px">No se pudo calcular (funciones de motor no disponibles)</span>')
    + '</div></div>';

  var cardsHTML = grp.records.length
    ? grp.records.map(function(r) { return _creRecordCard(r, thScore, 'formula'); }).join('')
    : '<p style="color:var(--tx3);font-size:12px;padding:20px 0;text-align:center">No hay ensayos registrados para esta fórmula.</p>';

  // Formulario rico de registro (notas, calidad, cepa)
  var fIdE       = esc(grp.formulaId);
  var gkE        = esc(groupKey);
  var allCepas   = _creGetCepasForFormula(grp.formulaId);
  var cepaOpts   = allCepas.length
    ? '<option value="">— Seleccioná cepa —</option>'
      + allCepas.map(function(g) {
          return '<option value="' + esc(g.id) + '">' + esc(g.label) + '</option>';
        }).join('')
    : '<option value="">Sin cepas en CI</option>';
  var addFormHTML = '<div class="cre-detail-addform">'
    + '<div class="cre-detail-addform-title">Registrar resultado de ensayo</div>'
    + '<div class="cre-detail-addform-row">'
    +   '<label>Cepa</label>'
    +   '<select id="cre-td-cepa-' + fIdE + '" class="cre-detail-cepa-select">' + cepaOpts + '</select>'
    +   '<div class="cre-qf-estado-btns" id="cre-td-eb-' + fIdE + '">'
    +     '<button class="cre-qf-estado-dot active" data-estado="none"   onclick="creQfSetEstado(this)" title="Sin calificación">⚪</button>'
    +     '<button class="cre-qf-estado-dot"        data-estado="green"  onclick="creQfSetEstado(this)" title="Excelente">🟢</button>'
    +     '<button class="cre-qf-estado-dot"        data-estado="yellow" onclick="creQfSetEstado(this)" title="Regular">🟡</button>'
    +     '<button class="cre-qf-estado-dot"        data-estado="red"    onclick="creQfSetEstado(this)" title="Pobre">🔴</button>'
    +   '</div>'
    +   '<label style="margin-left:4px">Score (0–10)</label>'
    +   '<input type="number" id="cre-td-score-' + fIdE + '" min="0" max="10" step="0.5" class="cre-qf-score-input" placeholder="7.5">'
    + '</div>'
    + '<div class="cre-qf-body-row">'
    +   '<textarea id="cre-td-notas-' + fIdE + '" class="cre-qf-textarea" rows="3" placeholder="Morfología, velocidad de crecimiento, rizomorfismo, fenotipo observado…"></textarea>'
    +   '<button onclick="creSubmitTileRecord(\'' + fIdE + '\',\'' + gkE + '\')" class="cre-qf-add-btn">✓ Guardar</button>'
    + '</div>'
    + '</div>';

  dw.innerHTML = header + thSection + addFormHTML
    + '<div class="cre-section-lbl">Ensayos por cepa <span style="color:var(--tx3);font-weight:400">(' + grp.records.length + ')</span></div>'
    + '<div class="cre-records-list">' + cardsHTML + '</div>';
}

// ─── Detalle por cepa ─────────────────────────────────────────────────────

function _creRenderCepaDetail(geneticaId) {
  var dw = document.getElementById('cre-detalle-wrap');
  if (!dw) return;

  var records = creRead();
  var grouped = _creGroupByCepa(records);
  var grp     = grouped.groups[geneticaId];

  if (!grp) { dw.innerHTML = '<p style="color:var(--er)">Cepa no encontrada.</p>'; return; }

  // Calcular delta promedio
  var deltas = [];
  grp.records.forEach(function(r) {
    var snap = r.formulaSnapshot ? r.formulaSnapshot.ings : [];
    var th   = _creGetTheoreticalScore(snap);
    var ob   = r.scoreFinalNorm != null ? Math.round(r.scoreFinalNorm) : null;
    if (th != null && ob != null) deltas.push(ob - th);
  });
  var avgDelta = deltas.length
    ? Math.round(deltas.reduce(function(a, b) { return a + b; }, 0) / deltas.length)
    : null;
  var dSign = avgDelta != null ? (avgDelta >= 0 ? '+' : '') : '';
  var dCls  = avgDelta == null ? '' : (avgDelta > 0 ? ' cre-delta--pos' : avgDelta < 0 ? ' cre-delta--neg' : ' cre-delta--zero');

  var header = '<div class="cre-detalle-header">'
    + '<button class="cre-back-btn" onclick="creVolverGrid()">&#x2190; Volver</button>'
    + '<div><div class="cre-detalle-title">' + esc(grp.geneticaLabel) + '</div>'
    +   '<div class="cre-detalle-meta">' + grp.records.length + ' fórmula' + (grp.records.length !== 1 ? 's' : '') + ' testeadas'
    +     (avgDelta != null
      ? ' · Calibración promedio: <span class="cre-delta' + dCls + '" style="padding:1px 6px">' + dSign + avgDelta + ' pts</span>'
      : '')
    +   '</div>'
    + '</div></div>';

  var cardsHTML = grp.records.map(function(r) {
    var snap    = r.formulaSnapshot ? r.formulaSnapshot.ings : [];
    var thScore = _creGetTheoreticalScore(snap);
    return _creRecordCard(r, thScore, 'cepa');
  }).join('');

  dw.innerHTML = header
    + '<div class="cre-section-lbl">Fórmulas testeadas</div>'
    + '<div class="cre-records-list">'
    + (cardsHTML || '<p style="color:var(--tx3);font-size:12px;padding:20px 0;text-align:center">Sin ensayos registrados.</p>')
    + '</div>';
}

// ═══════════════════════════════════════════════════════════════════════════
// 13. MIGRACIONES + ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════

function _creMigrateSegNotas() {
  const VK = 'bl2_seg_notas_migrated_v1';
  if (localStorage.getItem(VK)) return;
  const K = 'bl2_seg_notas';
  try {
    const raw = localStorage.getItem(K);
    if (!raw) { localStorage.setItem(VK, '1'); return; }
    const notas = JSON.parse(raw);
    if (typeof notas !== 'object' || notas === null) return;
    let changed = false;
    for (const frmId of Object.keys(notas)) {
      if (!Array.isArray(notas[frmId])) continue;
      notas[frmId] = notas[frmId].map(n => {
        if (typeof n.texto !== 'string') return n;
        let t = n.texto;
        t = t.replace(/🌱/g, '📊');
        t = t.replace(/📊 Obs\. Lag phase /g,          '🐌 Reorganización Celular ');
        t = t.replace(/📊 Obs\. Temprana /g,           '🕸️ Primeros Filamentos ');
        t = t.replace(/📊 Obs\. Preliminar /g,         '🔬 Rizomorfismo Activo ');
        t = t.replace(/📊 Obs\. Definitiva /g,         '🏆 Score Definitivo ');
        t = t.replace(/📊 Obs\. Reorganización Celular /g, '🐌 Reorganización Celular ');
        t = t.replace(/📊 Obs\. Primeros Filamentos /g,    '🕸️ Primeros Filamentos ');
        t = t.replace(/📊 Obs\. Rizomorfismo Activo /g,    '🔬 Rizomorfismo Activo ');
        t = t.replace(/📊 Obs\. Score Definitivo /g,       '🏆 Score Definitivo ');
        t = t.replace(/📊 Ensayo (CRE-\d+) iniciado — Inoculación /g, '🏁 $1 · Inoculado ');
        t = t.replace(/🌱 Ensayo (CRE-\d+) iniciado — Inoculación /g, '🏁 $1 · Inoculado ');
        if (t !== n.texto) { changed = true; return { ...n, texto: t }; }
        return n;
      });
    }
    if (changed) {
      localStorage.setItem(K, JSON.stringify(notas));
      console.info('[CRE] _creMigrateSegNotas: notas migradas ✓');
    }
    localStorage.setItem(VK, '1');
  } catch(e) {
    console.warn('[CRE] _creMigrateSegNotas error:', e);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTO-DETECCIÓN DE CEPAS desde datos CI
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Recopila todas las cepas que se usaron con una fórmula buscando en:
 * bl2_seg (tandas), bl2_cultivos (inóculos), bl2_experimentos (experimentos)
 * y los propios CRE records existentes.
 * Devuelve Array<{ id, label }> sin duplicados.
 */
function _creGetCepasForFormula(formulaId) {
  var seen = {};
  var result = [];

  function addCepa(id, label) {
    if (!id || seen[id]) return;
    seen[id] = true;
    var g = creReadGenetics().find(function(x) { return x.id === id; });
    result.push({ id: id, label: g ? g.label : (label || id) });
  }

  // 1. Desde CRE records existentes (ya tienen label correcto)
  creRead().forEach(function(r) {
    if (r.formulaId === formulaId && r.geneticaId) addCepa(r.geneticaId, r.geneticaLabel);
  });

  // 2. Desde bl2_seg (tandas de seguimiento CI)
  try {
    var segs = JSON.parse(localStorage.getItem('bl2_seg')) || [];
    segs.forEach(function(s) {
      if (s.formula_id === formulaId && s.genetica) addCepa(s.genetica, '');
    });
  } catch(e) {}

  // 3+4. Desde bl2_cultivos (inóculos) y bl2_experimentos — parsear cultivos una sola vez
  var cultivos = [];
  try { cultivos = JSON.parse(localStorage.getItem('bl2_cultivos')) || []; } catch(e) {}
  cultivos.forEach(function(c) {
    if (c && c.medioFormulaId === formulaId && c.geneticaId) {
      addCepa(c.geneticaId, (c.geneticaSnapshot && c.geneticaSnapshot.label) || c.geneticaId);
    }
  });
  try {
    var exps = JSON.parse(localStorage.getItem('bl2_experimentos')) || [];
    exps.filter(function(e) { return e && e.formulaId === formulaId; })
      .forEach(function(exp) {
        (exp.frascos || []).forEach(function(fr) {
          if (!fr.cultivoId) return;
          var c = cultivos.find(function(x) { return x && x.id === fr.cultivoId; });
          if (c && c.geneticaId) {
            var lbl = (c.geneticaSnapshot && c.geneticaSnapshot.label) || c.geneticaId;
            addCepa(c.geneticaId, lbl);
          }
        });
      });
  } catch(e) {}

  return result;
}

// ── Helpers de experimentos para CONOCIMIENTO ─────────────────────────────

/**
 * Devuelve array flat de todos los frascos de todos los experimentos
 * de una fórmula, leyendo bl2_experimentos.
 * @returns Array<{ expId, expNombre, frascoId, frascoLabel, volFrasco, extras }>
 */
function _creGetFrascosForFormula(formulaId) {
  var exps = [];
  try { exps = JSON.parse(localStorage.getItem('bl2_experimentos')) || []; } catch(e) {}
  var result = [];
  exps.filter(function(e) { return e && e.formulaId === formulaId; })
    .forEach(function(exp) {
      (exp.frascos || []).forEach(function(fr) {
        result.push({
          expId:       exp.id,
          expNombre:   exp.nombre || exp.id,
          frascoId:    fr.label,   // frascos no tienen id propio — usamos label como discriminador
          frascoLabel: fr.label,
          volFrasco:   fr.volFrasco,
          extras:      fr.extras || [],
        });
      });
    });
  return result;
}

/**
 * Devuelve cepas únicas usadas en un frasco específico,
 * leyendo las tandas de bl2_seg.
 * @returns Array<{ id, label }>
 */
function _creGetCepasForFrasco(formulaId, expId, frascoLabel) {
  var segs = [];
  try { segs = JSON.parse(localStorage.getItem('bl2_seg')) || []; } catch(e) {}
  var seen = {};
  var result = [];
  segs.filter(function(s) {
    return s.formula_id === formulaId
      && s.experimentoId === expId
      && s.experimentoFrascoId === frascoLabel
      && s.genetica;
  }).forEach(function(s) {
    if (!seen[s.genetica]) {
      seen[s.genetica] = true;
      result.push({ id: s.genetica, label: s.genetica });
    }
  });
  var allGenetics = creReadGenetics();
  result.forEach(function(c) {
    var g = allGenetics.find(function(x) { return x.id === c.id; });
    if (g) c.label = g.label;
  });
  // Fallback: si no hay cepas vinculadas a este frasco en bl2_seg,
  // usar todas las cepas de la fórmula para que siempre sea punturable.
  if (result.length === 0) {
    return _creGetCepasForFormula(formulaId);
  }
  return result;
}

/**
 * Filtra CRE records de una fórmula según el contexto de frasco activo (_sp.frasco).
 * Base (sin frasco): registros sin experimentoId.
 * Frasco activo: registros con experimentoId + frascoId coincidentes.
 */
function _creFRecsForContext(formulaId, records) {
  var all = (records || creRead()).filter(function(r) { return r.formulaId === formulaId; });
  if (!_sp.frasco) {
    return all; // BASE = vista compuesta de toda la calibración (base + frasco records)
  }
  // Aislamiento estricto: solo records con (experimentoId, frascoId) exactos.
  // Records sin frascoId solo se ven en BASE. Usar "Reparar datos" para migrar legacy.
  return all.filter(function(r) {
    return r.experimentoId === _sp.frasco.expId && r.frascoId === _sp.frasco.frascoId;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// DETALLE DIRECTO DE FÓRMULA — vista principal de calibración
// ═══════════════════════════════════════════════════════════════════════════

function creOpenFormulaDirectDetail(formulaId) {
  _creDetalleType = 'formula-direct';
  _creDetalleKey  = formulaId;
  var grid    = document.getElementById('cre-grid-wrap');
  var detalle = document.getElementById('cre-detalle-wrap');
  if (grid)    grid.style.display    = 'none';
  if (detalle) detalle.style.display = '';
  _creRenderFormulaDirectDetail(formulaId);
}

function _creRenderFormulaDirectDetail(formulaId) {
  var dw = document.getElementById('cre-detalle-wrap');
  if (!dw) return;

  var allIngs  = typeof readIngredientes === 'function' ? readIngredientes() : [];
  var snapshot = creGetFormulaSnapshot(formulaId);
  var forms    = typeof readForms === 'function' ? readForms() : [];
  var form     = forms.find(function(f) { return f.id === formulaId; });
  var formulaName = snapshot ? snapshot.nombre : (form ? (form.nombre || formulaId) : formulaId);

  var thScore  = snapshot ? _creGetTheoreticalScore(snapshot.ings) : null;
  var cnResult = (typeof calcCN === 'function' && snapshot && snapshot.ings.length)
                 ? calcCN(snapshot.ings, allIngs) : { cn: null, masa: 0 };
  var cn   = cnResult.cn != null ? (+cnResult.cn).toFixed(1) : '—';
  var masa = cnResult.masa ? (+cnResult.masa).toFixed(0) : '—';
  var thCol = thScore != null ? _creScoreColor(thScore) : 'var(--tx3)';
  var thW   = thScore != null ? thScore : 0;

  // Records de esta fórmula (todos los experimentos / variantes)
  var allRecords = creRead().filter(function(r) { return r.formulaId === formulaId; });
  var closedRecords = allRecords.filter(function(r) { return r.status === 'cerrado' && r.scoreFinalNorm != null; });

  // Cepas usadas con esta fórmula (auto-detectadas de CI)
  var cepasDisp = _creGetCepasForFormula(formulaId);

  // ── Header ────────────────────────────────────────────────────────────────
  var header = '<div class="cre-detalle-header">'
    + '<button class="cre-back-btn" onclick="creVolverGrid()">&#x2190; Volver</button>'
    + '<div><div class="cre-detalle-title">' + esc(formulaName) + '</div>'
    +   '<div class="cre-detalle-meta">C/N ' + cn + ' · ' + masa + ' g de base seca</div>'
    + '</div></div>';

  // ── Guía interactiva ──────────────────────────────────────────────────────
  var guideState, guideMsg, guideColor, guideBorder;
  if (closedRecords.length === 0) {
    guideState = '📋 Sin datos de laboratorio';
    guideMsg   = 'Esta fórmula aún no tiene resultados reales registrados. '
      + 'El Score Teórico es un cálculo bioquímico del motor — necesitás confirmarlo con lo que viste en tus placas. '
      + '<b>Usá el formulario de abajo para agregar tu primer resultado.</b>';
    guideColor = 'var(--tx2)'; guideBorder = 'rgba(255,255,255,0.1)';
  } else if (closedRecords.length < 3) {
    guideState = '🔬 Calibrando — ' + closedRecords.length + ' resultado' + (closedRecords.length > 1 ? 's' : '');
    guideMsg   = 'El motor está aprendiendo. Con ' + closedRecords.length + ' resultado'
      + (closedRecords.length > 1 ? 's' : '') + ' empieza a ajustar los scores, '
      + 'pero necesitás al menos 3 para que la calibración sea confiable. '
      + '<b>Seguí agregando resultados para mejorar la precisión.</b>';
    guideColor = '#FFC000'; guideBorder = 'rgba(255,192,0,0.2)';
  } else {
    var avgDeltaAll = Math.round(closedRecords.reduce(function(acc, r) {
      var th = _creGetTheoreticalScore(r.formulaSnapshot ? r.formulaSnapshot.ings : []);
      return acc + (Math.round(r.scoreFinalNorm) - (th || 0));
    }, 0) / closedRecords.length);
    var dSign = avgDeltaAll >= 0 ? '+' : '';
    guideState = '✅ Calibrada — ' + closedRecords.length + ' resultados';
    guideMsg   = 'El motor ya aprendió cómo se comporta esta fórmula en el lab. '
      + 'La calibración promedio es <b>' + dSign + avgDeltaAll + ' pts</b> vs lo teórico. '
      + (avgDeltaAll > 5
          ? 'La fórmula rinde <b>mejor</b> de lo que predice la teoría — el motor va a sugerir esta como referencia positiva.'
          : avgDeltaAll < -5
            ? 'La fórmula rinde <b>por debajo</b> de lo teórico — útil para recalibrrar el motor a la baja para estas cepas.'
            : 'La fórmula rinde muy cerca de lo teórico — el motor está bien calibrado para este caso.')
      + ' Podés seguir agregando resultados para mayor precisión.';
    guideColor = 'var(--primary)'; guideBorder = 'rgba(0,204,51,0.2)';
  }

  var guideHTML = '<div style="background:rgba(255,255,255,0.02); border:1px solid ' + guideBorder + '; border-radius:8px; padding:14px; margin-bottom:18px;">'
    + '<div style="font-size:11px; font-weight:700; color:' + guideColor + '; margin-bottom:6px;">' + guideState + '</div>'
    + '<div style="font-size:11px; color:var(--tx2); line-height:1.6;">' + guideMsg + '</div>'
    + '</div>';

  // ── Score teórico ─────────────────────────────────────────────────────────
  var thSection = '<div class="cre-th-score-block" style="margin-bottom:18px;">'
    + '<div class="cre-th-score-label">Score Teórico del Motor <span style="font-size:10px;font-weight:400;color:var(--tx3)">(calculado desde bioquímica, sin datos reales)</span></div>'
    + '<div class="cre-th-score-inner">'
    + (thScore != null
      ? '<div class="cre-bar-track cre-bar-lg"><div class="cre-bar-fill" style="width:' + thW + '%;background:' + thCol + '"></div></div>'
      +   '<span class="cre-th-score-val" style="color:' + thCol + '">' + thScore + '<small> / 100</small></span>'
      : '<span style="color:var(--tx3);font-size:11px">No calculable</span>')
    + '</div>'
    + '<div style="font-size:10px; color:var(--tx3); margin-top:6px;">💡 Este número es una predicción. Tu observación en el lab es lo que calibra el motor. Si observaste diferente, registralo abajo.</div>'
    + '</div>';

  // ── Formulario de nuevo registro ──────────────────────────────────────────
  var cepaOptsHTML = '';
  if (cepasDisp.length === 0) {
    cepaOptsHTML = '<option value="">— No se detectaron cepas de CI —</option>';
  } else {
    cepaOptsHTML = cepasDisp.map(function(g) {
      return '<option value="' + esc(g.id) + '">' + esc(g.label) + '</option>';
    }).join('');
  }

  var addFormHTML = '<div class="cre-new-record-form" style="background:rgba(124,111,255,0.04); border:1px solid rgba(124,111,255,0.2); border-radius:8px; padding:16px; margin-bottom:22px;">'
    + '<div style="font-size:12px; font-weight:800; color:var(--tx); margin-bottom:4px;">➕ Agregar resultado de laboratorio</div>'
    + '<div style="font-size:10px; color:var(--tx3); margin-bottom:12px;">Seleccioná la cepa que inoculaste, ingresá el score que observaste (0=sin crecimiento, 10=máximo rizomorfismo), y guardá. El motor aprende automáticamente.</div>'
    + '<div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">'
    +   '<div><label class="cre-input-lbl">Cepa inoculada <span style="color:var(--ac2)">*</span></label>'
    +     '<select id="cre-direct-cepa-sel" class="cre-inline-select">'
    +       (cepasDisp.length > 1 ? '<option value="">— Elegí la cepa —</option>' : '')
    +       cepaOptsHTML
    +     '</select>'
    +     (cepasDisp.length === 0 ? '<div style="font-size:9px;color:var(--er,#e74c3c);margin-top:3px;">No se encontraron cepas en CI para esta fórmula.</div>' : '')
    +   '</div>'
    +   '<div><label class="cre-input-lbl">Score observado (0–10) <span style="color:var(--ac2)">*</span></label>'
    +     '<input type="number" id="cre-direct-score" min="0" max="10" step="0.5" placeholder="ej: 7.5" class="cre-inline-input">'
    +     '<div style="font-size:9px; color:var(--tx3); margin-top:3px;">0 = sin crecimiento · 5 = normal · 8–10 = rizomórfico excelente</div>'
    +   '</div>'
    + '</div>'
    + '<div style="margin-bottom:12px;"><label class="cre-input-lbl">Notas de crecimiento (opcional)</label>'
    +   '<textarea id="cre-direct-notas" rows="2" placeholder="Ej: crecimiento lento pero rizomórfico, placas con buen avance apical..." class="cre-inline-textarea"></textarea>'
    + '</div>'
    + '<div style="display:flex; justify-content:flex-end;">'
    +   '<button onclick="creSubmitDirectRecord(\'' + esc(formulaId) + '\')" class="clab-btn" style="background:var(--ac2);color:var(--bg);border-color:var(--ac2);font-weight:700;">Guardar resultado y calibrar motor</button>'
    + '</div>'
    + '</div>';

  // ── Historial por cepa ────────────────────────────────────────────────────
  var byCepa = {};
  var cepaOrder = [];
  allRecords.forEach(function(r) {
    var key = r.geneticaId || '__unknown__';
    if (!byCepa[key]) {
      byCepa[key] = { label: r.geneticaLabel || 'Cepa desconocida', records: [] };
      cepaOrder.push(key);
    }
    byCepa[key].records.push(r);
  });

  var histHTML = '';
  if (!cepaOrder.length) {
    histHTML = '<p style="color:var(--tx3);font-size:12px;padding:16px 0;text-align:center;font-style:italic;">Sin resultados registrados. Usá el formulario de arriba para agregar el primero.</p>';
  } else {
    histHTML = cepaOrder.map(function(cepaKey) {
      var cepa = byCepa[cepaKey];
      var closed = cepa.records.filter(function(r) { return r.scoreFinalNorm != null; });
      var avgObs = closed.length
        ? Math.round(closed.reduce(function(a, r) { return a + Math.round(r.scoreFinalNorm); }, 0) / closed.length)
        : null;
      var delta = (thScore != null && avgObs != null) ? (avgObs - thScore) : null;
      var dSign = delta != null ? (delta >= 0 ? '+' : '') : '';
      var dCls  = delta == null ? '' : (delta > 0 ? ' cre-delta--pos' : delta < 0 ? ' cre-delta--neg' : ' cre-delta--zero');

      var calibNote = '';
      if (delta != null) {
        if (delta > 5) calibNote = ' — El motor aprende: esta cepa rinde mejor de lo teórico aquí.';
        else if (delta < -5) calibNote = ' — El motor aprende: esta cepa rinde por debajo de lo teórico aquí.';
        else calibNote = ' — El motor confirma: el score teórico es preciso para esta cepa.';
      }

      var recordCards = cepa.records.map(function(r) {
        var obScore  = r.scoreFinalNorm != null ? Math.round(r.scoreFinalNorm) : null;
        var idE      = esc(String(r.id));
        var dateStr  = _creFmtDate(r.inoculationDate || r.createdAt);
        return '<div class="cre-record-card" id="cre-record-' + idE + '" style="margin-bottom:8px;">'
          + '<div class="cre-record-hdr">'
          +   '<span class="cre-record-title" style="font-size:10px;color:var(--tx3);">' + idE + ' · ' + dateStr + '</span>'
          +   '<div style="display:flex;gap:6px;align-items:center;">'
          +     '<span class="cre-status-badge cre-status-badge--cerrado">Cerrado</span>'
          +     '<button onclick="creConfirmDeleteInline(this,\'' + idE + '\',\'' + esc(formulaId) + '\')" class="clab-btn clab-btn-sm" style="padding:1px 6px;font-size:9px;color:var(--er,#e74c3c);border-color:var(--er,#e74c3c);" title="Eliminar este registro">🗑</button>'
          +   '</div>'
          + '</div>'
          + _creScoreBarHTML(thScore, obScore)
          + '</div>';
      }).join('');

      return '<div style="margin-bottom:22px;">'
        + '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; padding-bottom:6px; border-bottom:1px solid var(--border);">'
        +   '<div>'
        +     '<div style="font-size:13px; font-weight:700; color:var(--tx);">' + esc(cepa.label) + '</div>'
        +     '<div style="font-size:10px; color:var(--tx3); margin-top:2px;">' + closed.length + ' resultado' + (closed.length !== 1 ? 's' : '') + (calibNote ? ' · <span style="font-style:italic">' + calibNote + '</span>' : '') + '</div>'
        +   '</div>'
        +   (delta != null
              ? '<span class="cre-delta' + dCls + '" style="padding:2px 8px;font-size:12px;">Δ prom. ' + dSign + delta + ' pts</span>'
              : '<span style="font-size:10px;color:var(--tx3);font-style:italic;">Sin score definitivo</span>')
        + '</div>'
        + recordCards
        + '</div>';
    }).join('');
  }

  dw.innerHTML = header + guideHTML + thSection + addFormHTML
    + '<div class="cre-section-lbl">Historial por cepa <span style="color:var(--tx3);font-weight:400">(' + allRecords.length + ' resultado' + (allRecords.length !== 1 ? 's' : '') + ')</span></div>'
    + '<div class="cre-records-list">' + histHTML + '</div>';

  // Auto-seleccionar cepa si hay solo una
  if (cepasDisp.length === 1) {
    var sel = document.getElementById('cre-direct-cepa-sel');
    if (sel) sel.value = cepasDisp[0].id;
  }
}

/**
 * Registro rápido desde la sandbox card.
 * Usa la cepa seleccionada en #cre-qf-c-{formulaId} (auto-detectada de CI).
 */
function creQfSetEstado(btn) {
  var container = btn.closest('.cre-qf-estado-btns');
  if (!container) return;
  container.querySelectorAll('.cre-qf-estado-dot').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
}

function creSubmitQuickRecord(formulaId) {
  var cepaEl  = document.getElementById('cre-qf-c-' + formulaId);
  var scoreEl = document.getElementById('cre-qf-s-' + formulaId);

  var cepaId = cepaEl  ? cepaEl.value  : '';
  var scoreN = scoreEl ? parseFloat(scoreEl.value) : NaN;

  if (!cepaId) { notif('Seleccioná una cepa', 'err'); return; }
  if (isNaN(scoreN) || scoreN < 0 || scoreN > 10) { notif('Score debe estar entre 0 y 10', 'err'); return; }

  var gObj = creReadGenetics().find(function(g) { return g.id === cepaId; });
  var snapshot = creGetFormulaSnapshot(formulaId);
  if (!snapshot) { notif('Fórmula no encontrada', 'err'); return; }

  var rec = creCreate({
    formulaId:       formulaId,
    formulaSnapshot: snapshot,
    geneticaId:      cepaId,
    geneticaLabel:   gObj ? gObj.label : cepaId,
  });
  creAddObs(rec.id, {
    tipo:           'definitiva',
    dia:            0,
    fecha:          new Date().toISOString().slice(0, 10),
    scoreObservado: scoreN,
  });

  notif('Resultado guardado ✓ — calibración actualizada', 'ok');
  _creRenderGrid();
}

/**
 * Registro desde el detalle de tile (📋 Historial).
 * Incluye cepa, calidad (estado dot), score y notas.
 */
function creSubmitTileRecord(formulaId, groupKey) {
  var cepaEl   = document.getElementById('cre-td-cepa-'  + formulaId);
  var scoreEl  = document.getElementById('cre-td-score-' + formulaId);
  var notasEl  = document.getElementById('cre-td-notas-' + formulaId);
  var estadoEl = document.querySelector('#cre-td-eb-' + formulaId + ' .cre-qf-estado-dot.active');

  var cepaId = cepaEl  ? cepaEl.value  : '';
  var scoreN = scoreEl ? parseFloat(scoreEl.value) : NaN;
  var notas  = notasEl ? notasEl.value.trim() : '';
  var estado = estadoEl ? estadoEl.getAttribute('data-estado') : 'none';
  var calidadMap = { none: null, green: 'excellent', yellow: 'moderate', red: 'poor' };

  if (!cepaId) { notif('Seleccioná una cepa', 'err'); return; }
  if (isNaN(scoreN) || scoreN < 0 || scoreN > 10) { notif('Score debe estar entre 0 y 10', 'err'); return; }

  var gObj = creReadGenetics().find(function(g) { return g.id === cepaId; });
  var snapshot = creGetFormulaSnapshot(formulaId);
  if (!snapshot) { notif('Fórmula no encontrada', 'err'); return; }

  var rec = creCreate({
    formulaId:       formulaId,
    formulaSnapshot: snapshot,
    geneticaId:      cepaId,
    geneticaLabel:   gObj ? gObj.label : cepaId,
  });
  creAddObs(rec.id, {
    tipo:           'definitiva',
    dia:            0,
    fecha:          new Date().toISOString().slice(0, 10),
    scoreObservado: scoreN,
    notasMorf:      notas,
    calidad:        calidadMap[estado] || null,
  });

  notif('Resultado guardado ✓ — calibración actualizada', 'ok');
  _creRenderFormulaDetail(groupKey);
}

function creSubmitDirectRecord(formulaId) {
  var cepaEl  = document.getElementById('cre-direct-cepa-sel');
  var scoreEl = document.getElementById('cre-direct-score');
  var notasEl = document.getElementById('cre-direct-notas');

  var cepaId = cepaEl ? cepaEl.value : '';
  var scoreN = scoreEl ? parseFloat(scoreEl.value) : NaN;
  var notas  = notasEl ? notasEl.value.trim() : '';

  if (!cepaId) { notif('Seleccioná una cepa', 'err'); return; }
  if (isNaN(scoreN) || scoreN < 0 || scoreN > 10) { notif('Score debe estar entre 0 y 10 (ej: 7.5)', 'err'); return; }

  var gObj = creReadGenetics().find(function(g) { return g.id === cepaId; });
  var cepaLabel = gObj ? gObj.label : cepaId;
  var snapshot  = creGetFormulaSnapshot(formulaId);
  if (!snapshot) { notif('Fórmula no encontrada', 'err'); return; }

  var rec = creCreate({
    formulaId:       formulaId,
    formulaSnapshot: snapshot,
    geneticaId:      cepaId,
    geneticaLabel:   cepaLabel,
  });

  creAddObs(rec.id, {
    tipo:           'definitiva',
    dia:            0,
    fecha:          new Date().toISOString().slice(0, 10),
    scoreObservado: scoreN,
    notas:          notas,
    notasMorf:      notas,
  });

  notif('Resultado guardado — motor calibrado ✓', 'ok');
  _creRenderFormulaDirectDetail(formulaId);
}

function creDeleteAndRefresh(creId, formulaId) {
  if (!creDeleteEnsayo(creId)) return;
  creVolverGrid();
}

// ── Helpers de datos CI para el scoring panel ────────────────────────────

/**
 * Suma placas de bl2_seg para formula+cepa.
 * Sin expId: suma todas las tandas (contexto Base).
 * Con expId+frascoLabel: filtra solo ese frasco de experimento.
 */
function _creGetPlacasFromCI(formulaId, geneticaId, expId, frascoLabel) {
  if (!formulaId || !geneticaId) return null;
  try {
    var segs = JSON.parse(localStorage.getItem('bl2_seg')) || [];
    var total = 0;
    segs.forEach(function(s) {
      if (s.formula_id !== formulaId || s.genetica !== geneticaId) return;
      if (expId) {
        if (s.experimentoId !== expId || s.experimentoFrascoId !== frascoLabel) return;
      }
      total += Math.max(0, (s.placas || 0) - (s.contaminados || 0));
    });
    if (total > 0) return total;
    // Fallback bl2_cultivos solo en contexto Base (sin frasco)
    if (!expId) {
      var cultivos = JSON.parse(localStorage.getItem('bl2_cultivos')) || [];
      cultivos.forEach(function(c) {
        if (c && c.medioFormulaId === formulaId && c.geneticaId === geneticaId) {
          total += (c.placas || c.cantPlacas || c.numPlacas || 0);
        }
      });
      return total > 0 ? total : null;
    }
    return null;
  } catch(e) { return null; }
}

/** Obtiene la fecha de inoculación desde bl2_forms.fecha (compartida por todas las cepas de la fórmula). */
function _creGetInoculacionDate(formulaId, geneticaId) {
  if (!formulaId) return null;
  try {
    var forms = JSON.parse(localStorage.getItem('bl2_forms')) || [];
    var f = forms.find(function(x) { return x.id === formulaId; });
    if (f && f.fecha) return new Date(f.fecha).toISOString().slice(0, 10);
    return null;
  } catch(e) { return null; }
}

/** Obtiene la fecha de colonización desde bl2_seg, validando que sea posterior a la inoculación. */
function _creGetColonizacionDate(formulaId, geneticaId, frascoCtx) {
  if (!formulaId || !geneticaId) return null;
  try {
    var inocDate = _creGetInoculacionDate(formulaId, geneticaId);
    var segs = JSON.parse(localStorage.getItem('bl2_seg')) || [];
    var dates = segs
      .filter(function(s) {
        if (s.formula_id !== formulaId || s.genetica !== geneticaId || !s.colonizacion) return false;
        // Only accept colonización that is after the formula's inoculación date
        if (inocDate && s.colonizacion < inocDate) return false;
        if (frascoCtx && frascoCtx.expId) {
          if (s.experimentoId !== frascoCtx.expId || s.experimentoFrascoId !== frascoCtx.frascoLabel) return false;
        }
        return true;
      })
      .map(function(s) { return s.colonizacion; })
      .sort();
    return dates.length ? dates[dates.length - 1] : null;
  } catch(e) { return null; }
}

function _creColonizacionStats(formulaId, geneticaId, frascoCtx) {
  // Usa el campo `dia` pre-calculado al registrar la fase — sin aritmética de fechas,
  // sin bl2_seg. Si no hay colonización registrada en CILAB, sin penalidad.
  var fases = _creFasesRead(formulaId, geneticaId, frascoCtx);
  var fc = fases.find(function(f) { return f.fase === 'colonizacion_completa'; });
  if (!fc || fc.dia == null) return { dias: null, penalty: 0 };
  var dias  = fc.dia;
  var extra = Math.max(0, dias - 15);
  return { dias: dias, penalty: Math.min(3, +(extra * 0.25).toFixed(2)) };
}

function _creSyncColonizacionToCI(formulaId, geneticaId, fechaStr) {
  if (!formulaId || !geneticaId || !fechaStr) return;
  try {
    var segs = JSON.parse(localStorage.getItem('bl2_seg')) || [];
    if (!Array.isArray(segs) || !segs.length) return;
    var changed = false;
    segs.forEach(function(s) {
      if (!s || s.formula_id !== formulaId || s.genetica !== geneticaId) return;
      if (s.colonizacion) return;
      s.colonizacion = fechaStr;
      changed = true;

      var inoculoTs = s.inoculoTs ? new Date(s.inoculoTs) : null;
      var colonDate = new Date(fechaStr + 'T12:00:00');
      var diasDesde = inoculoTs
        ? Math.max(0, Math.round((colonDate.getTime() - inoculoTs.getTime()) / 86400000))
        : null;
      var fmtColon = colonDate.toLocaleDateString('es-AR', { day:'2-digit', month:'numeric', year:'numeric' });
      var fmtIno = inoculoTs
        ? inoculoTs.toLocaleDateString('es-AR', { day:'2-digit', month:'numeric', year:'numeric' })
        : 'sin fecha';
      var tanda = s.tanda || s.rowId || null;
      var diasStr = diasDesde != null ? ' (' + diasDesde + ' dias desde inoculo)' : '';
      _creWriteAutoNota(
        formulaId,
        '🟡 Colonización completa — CILAB — Inoc: ' + fmtIno + ' → Expansión completa: ' + fmtColon + diasStr + (tanda ? ' [' + tanda + ']' : ''),
        'yellow',
        tanda
      );
    });
    if (changed) {
      localStorage.setItem('bl2_seg', JSON.stringify(segs));
      // Bridge: actualiza DOM + memoria de CI si el módulo está cargado
      try {
        var storNotas = JSON.parse(localStorage.getItem('bl2_seg_notas') || '{}');
        if (typeof window._segSyncColonizacionFromCilab === 'function') {
          window._segSyncColonizacionFromCilab(formulaId, fechaStr, storNotas[formulaId] || []);
        }
      } catch(e2) {}
      // Publicar tandas colonizadas a Cultivos CI
      try {
        if (typeof window._ciSyncCultivosFromSeg === 'function') {
          window._ciSyncCultivosFromSeg(formulaId);
        }
      } catch(e3) {}
    }
  } catch(e) {
    console.warn('[CREC] sync colonizacion CI failed', e);
  }
}

// ── Notas de trazabilidad por formula+cepa ───────────────────────────────

var K_CREC_NOTAS = K_CREC_NOTAS_KEY;

function _creNotasKey(formulaId, geneticaId) {
  return formulaId + '__' + (geneticaId || '_');
}

function _creNotasRead(formulaId, geneticaId) {
  try {
    var all = JSON.parse(localStorage.getItem(K_CREC_NOTAS)) || {};
    return all[_creNotasKey(formulaId, geneticaId)] || [];
  } catch(e) { return []; }
}

function _creNotasWrite(formulaId, geneticaId, arr) {
  try {
    var all = JSON.parse(localStorage.getItem(K_CREC_NOTAS)) || {};
    all[_creNotasKey(formulaId, geneticaId)] = arr;
    localStorage.setItem(K_CREC_NOTAS, JSON.stringify(all));
  } catch(e) { console.warn('[CREC_NOTAS] write failed', e); }
}

// Rainbow palette — 8 colors, consistent per cepa via hash of geneticaId
var _CRE_CHIP_COLORS = [
  '#44aaff','#ff6b6b','#ffd93d','#6bcb77',
  '#c77dff','#ff9f43','#00d2d3','#ff79c6',
];
function _creChipColor(geneticaId) {
  var h = 0, s = geneticaId || '';
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0x7fffffff;
  return _CRE_CHIP_COLORS[h % _CRE_CHIP_COLORS.length];
}
// Abbreviate label at display time for backward-compat (stored full names → "PC / APE / F2")
function _creDispLabel(lbl) {
  if (!lbl) return '?';
  var firstSeg = lbl.split(' / ')[0].trim();
  return firstSeg.indexOf(' ') !== -1 ? _creAbrevEspecie(lbl) : lbl;
}
// Returns chip HTML for cepa labels + fase/día meta. Empty string if no structured context.
function _creNotaCtxHTML(n) {
  if (!n.cepaLabels || !n.cepaLabels.length) return '';
  var chips = n.cepaLabels.map(function(lbl, idx) {
    var gId = (n.cepaIds && n.cepaIds[idx]) || lbl;
    var col = _creChipColor(gId);
    return '<span class="cre-nota-cepa-chip" style="border-color:' + col + ';color:' + col + ';background:' + col + '1a">'
      + esc(_creDispLabel(lbl))
      + '</span>';
  }).join('');
  var meta = [];
  if (n.faseLabel) meta.push('Fase: ' + esc(n.faseLabel));
  if (n.dia != null) meta.push('Día ' + n.dia);
  return '<span class="cre-nota-ctx-row">'
    + chips
    + (meta.length ? '<span class="cre-nota-meta">' + meta.join(' / ') + '</span>' : '')
    + '</span>';
}
function _creUpdateSelChips(formulaId) {
  var wrap = document.getElementById('cre-notas-ctx-chips-' + formulaId);
  if (!wrap) return;
  if (_sp.selected.size === 0) {
    wrap.style.display = 'none';
    wrap.innerHTML = '';
    return;
  }
  var allG = creReadGenetics();
  var html = '';
  _sp.selected.forEach(function(key) {
    var gId = key.split('|')[2];
    var g   = allG.find(function(x) { return x.id === gId; });
    var col = _creChipColor(gId);
    html += '<span class="cre-sp-sel-chip" style="border-color:' + col + ';color:' + col + ';background:' + col + '1a">'
      + esc(_creAbrevEspecie(g ? g.label : gId))
      + '</span>';
  });
  wrap.style.display = '';
  wrap.innerHTML = html;
}

function _creLogScore(formulaId, targets, score, compScore, rizoApplies, obsTotal, obsRizo, tipo, frascoCtx) {
  // targets: array of {gId, gLabel}
  // frascoCtx: { label, experimentoId, frascoId } | null
  // Batch (>1 cepa) → formula-level bucket (null gId); single → cepa-level bucket.
  var parts = [];
  if (frascoCtx) parts.push('🔬 ' + frascoCtx.label);
  var scoreStr = 'Score ' + score + '/10';
  if (compScore != null && +compScore.toFixed(1) !== score) scoreStr += ' → ' + compScore.toFixed(1);
  parts.push(scoreStr);
  if (rizoApplies) {
    if (!isNaN(obsTotal) && obsTotal > 0 && !isNaN(obsRizo) && obsRizo >= 0) {
      parts.push('Incidencia ' + Math.round(obsRizo / obsTotal * 100) + '% (' + obsRizo + '/' + obsTotal + ')');
    }
    if (tipo) parts.push('Cordón: ' + tipo);
  } else {
    parts.push('Difuso / tormentoso');
  }
  var writeGId = targets.length > 1 ? null : targets[0].gId;
  // Fases temporal summary per cepa
  var fasesLines = targets.map(function(t) {
    var fases = _creFasesRead(formulaId, t.gId);
    var fp = [];
    var colF  = fases.find(function(f) { return f.fase === 'colonizacion_completa'; });
    var fruF  = fases.find(function(f) { return f.fase === 'fructificacion'; });
    var finF  = fases.find(function(f) { return f.fase === 'fin_ciclo'; });
    if (colF)  fp.push('Col.Día ' + colF.dia);
    if (fruF)  fp.push('Fruct.Día ' + fruF.dia);
    if (finF)  fp.push('Fin.Día ' + finF.dia);
    if (!fp.length) return null;
    return (targets.length > 1 ? _creDispLabel(t.gLabel || t.gId) + ': ' : '') + fp.join(' · ');
  }).filter(Boolean);
  var nota = {
    id: 'lg' + Date.now() + Math.random().toString(36).slice(2, 5),
    ts: new Date().toISOString(),
    texto: parts.join(' · '),
    fasesTexto: fasesLines.length ? fasesLines.join(' | ') : null,
    auto: true, logType: 'score',
    cepaLabels: targets.map(function(t) { return t.gLabel || t.gId; }),
    cepaIds:    targets.map(function(t) { return t.gId; }),
    imagenes: [],
  };
  // Metadata de frasco para filtrado por contexto en el log
  if (frascoCtx) {
    nota.experimentoId = frascoCtx.experimentoId;
    nota.frascoId      = frascoCtx.frascoId;
  }
  var notas = _creNotasRead(formulaId, writeGId);
  notas.push(nota);
  _creNotasWrite(formulaId, writeGId, notas);
}

function _creLogFase(formulaId, gId, faseId, dia, fecha, isEdit, frascoCtx) {
  var def = _FASES_DEF.find(function(f) { return f.id === faseId; });
  var faseLabel = def ? def.label : faseId;
  var fmtFecha  = fecha
    ? new Date(fecha + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'numeric' })
    : '';
  var frascoPrefix = frascoCtx
    ? '🔬 Frasco ' + frascoCtx.frascoLabel
      + (frascoCtx.extras && frascoCtx.extras.length === 0 ? ' (Control)' : '')
      + ' · '
    : '';
  var texto = frascoPrefix + (isEdit ? '✎ Calibrado: ' : '') + faseLabel + ' · Día ' + dia + (fmtFecha ? ' · ' + fmtFecha : '');
  var notas   = _creNotasRead(formulaId, gId);
  // Buscar entrada existente SOLO dentro del mismo frasco (evita pisar log de otro frasco)
  var existIdx = notas.findIndex(function(n) {
    if (!n.auto || n.logType !== 'fase' || n.faseId !== faseId) return false;
    var sameExp = frascoCtx ? n.experimentoId === frascoCtx.expId : !n.experimentoId;
    var sameFr  = frascoCtx ? n.frascoId === frascoCtx.frascoId  : !n.frascoId;
    return sameExp && sameFr;
  });
  var nota = {
    id: existIdx >= 0 ? notas[existIdx].id : ('lg' + Date.now() + Math.random().toString(36).slice(2, 5)),
    ts: new Date().toISOString(),
    texto: texto, auto: true, logType: 'fase',
    faseId: faseId, faseColor: def ? def.color : null, dia: dia,
    imagenes: [],
  };
  if (frascoCtx) {
    nota.experimentoId = frascoCtx.expId;
    nota.frascoId      = frascoCtx.frascoId;
  }
  if (existIdx >= 0) { notas[existIdx] = nota; } else { notas.push(nota); }
  _creNotasWrite(formulaId, gId, notas);
}

function _creNotasPanelHTML(formulaId, geneticaId) {
  var fIdE = esc(formulaId);
  var gIdE = esc(geneticaId || '');
  var notas = _creNotasRead(formulaId, geneticaId);
  // Merge formula-level log entries (batch score logs) so they appear in any cepa panel
  if (geneticaId) {
    var _fmLogs = _creNotasRead(formulaId, null).map(function(n) { return Object.assign({}, n, { _fmLevel: true }); });
    notas = notas.concat(_fmLogs).sort(function(a, b) { return a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0; });
  }

  // Build placeholder showing the would-be context prefix
  var placeholder = 'Escribí una observación...';
  if (geneticaId) {
    var _pfZone  = _creTemporalZoneFase(formulaId, geneticaId, _sp.frasco);

    var _pfCepas = [];
    if (_sp.selected && _sp.selected.size > 1) {
      var _pfGenetics = creReadGenetics();
      _sp.selected.forEach(function(sk) {
        var gId = sk.split('|')[2];
        var g = _pfGenetics.find(function(x) { return x.id === gId; });
        _pfCepas.push(_creAbrevEspecie(g ? g.label : gId));
      });
    } else {
      var _pfG = creReadGenetics().find(function(x) { return x.id === geneticaId; });
      _pfCepas.push(_creAbrevEspecie(_pfG ? _pfG.label : geneticaId));
    }
    placeholder = _pfCepas.join(' · ')
      + ' / Fase: ' + _pfZone.def.label
      + ' / Día ' + _pfZone.dia
      + ' — observación...';
  }

  var listaHTML = notas.length === 0
    ? '<div style="padding:10px 0;font-size:11px;color:var(--tx3);font-style:italic;text-align:center">Sin notas todavía</div>'
    : notas.map(function(n) {
        var d   = new Date(n.ts);
        var ts  = d.getDate() + '/' + (d.getMonth()+1) + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
        var nIdE = esc(n.id);
        var noteGIdE = n._fmLevel ? '' : gIdE;
        var delBtn = '<button class="cre-nota-btn cre-nota-btn--del" onclick="creNotaEliminar(\'' + fIdE + '\',\'' + noteGIdE + '\',\'' + nIdE + '\')" title="Eliminar">✕</button>';

        if (n.auto && n.logType === 'score') {
          var ctxHtml = _creNotaCtxHTML(n);
          var fasHtml = n.fasesTexto ? '<span style="display:block;font-size:10px;opacity:0.65;margin-top:2px">' + esc(n.fasesTexto) + '</span>' : '';
          return '<div class="cre-nota-item cre-nota-item--log" id="cre-nota-' + nIdE + '" style="opacity:0.85;border-left:2px solid var(--ac2)">'
            + '<span class="cre-nota-ts" style="color:var(--ac2)">🖥 ' + ts + '</span>'
            + '<span class="cre-nota-txt">' + ctxHtml
            + '<span class="cre-nota-user-txt">' + esc(n.texto) + fasHtml + '</span></span>'
            + '<div class="cre-nota-actions">' + delBtn + '</div>'
            + '</div>';
        }

        if (n.auto && n.logType === 'fase') {
          var fCol = n.faseColor || 'var(--tx3)';
          return '<div class="cre-nota-item cre-nota-item--log" id="cre-nota-' + nIdE + '" style="opacity:0.85;border-left:2px solid ' + fCol + '">'
            + '<span class="cre-nota-ts" style="color:' + fCol + '">◉ ' + ts + '</span>'
            + '<span class="cre-nota-txt"><span class="cre-nota-user-txt" style="color:' + fCol + '">' + esc(n.texto) + '</span></span>'
            + '<div class="cre-nota-actions">' + delBtn + '</div>'
            + '</div>';
        }

        return '<div class="cre-nota-item" id="cre-nota-' + nIdE + '">'
          + '<span class="cre-nota-ts">' + ts + (n.editedAt ? ' ✎' : '') + '</span>'
          + '<span class="cre-nota-txt" id="cre-nota-txt-' + nIdE + '">'
          + _creNotaCtxHTML(n)
          + '<span class="cre-nota-user-txt">' + esc(n.texto) + '</span>'
          + '</span>'
          + '<div class="cre-nota-actions">'
          + '<button class="cre-nota-btn cre-nota-btn--edit" onclick="creNotaEditarStart(\'' + fIdE + '\',\'' + noteGIdE + '\',\'' + nIdE + '\')" title="Editar">✎</button>'
          + delBtn
          + '</div>'
          + '</div>';
      }).join('');

  // Chip preview of selected cepas — initial render; updated live by _creUpdateSelChips
  var selChipsHTML = '';
  if (_sp.selected.size > 0) {
    var allGN = creReadGenetics();
    _sp.selected.forEach(function(sk) {
      var gId = sk.split('|')[2];
      var g   = allGN.find(function(x) { return x.id === gId; });
      var col = _creChipColor(gId);
      selChipsHTML += '<span class="cre-sp-sel-chip" style="border-color:' + col + ';color:' + col + ';background:' + col + '1a">'
        + esc(_creAbrevEspecie(g ? g.label : gId)) + '</span>';
    });
  }

  return '<div class="cre-notas-panel" id="cre-notas-panel-' + fIdE + '__' + gIdE + '">'
    + '<div class="cre-notas-lista" id="cre-notas-lista-' + fIdE + '__' + gIdE + '">' + listaHTML + '</div>'
    + '<div id="cre-notas-ctx-chips-' + fIdE + '" class="cre-notas-ctx-chips"'
    + (_sp.selected.size === 0 ? ' style="display:none"' : '') + '>'
    + selChipsHTML + '</div>'
    + '<div class="cre-notas-input-row">'
    + '<input type="text" id="cre-notas-input-' + fIdE + '__' + gIdE + '" class="cre-notas-input" placeholder="' + esc(placeholder) + '" onkeydown="if(event.key===\'Enter\')creNotaEnviar(\'' + fIdE + '\',\'' + gIdE + '\')">'
    + '<button class="cre-notas-send-btn" onclick="creNotaEnviar(\'' + fIdE + '\',\'' + gIdE + '\')">Enviar</button>'
    + '</div>'
    + '</div>';
}

// ── Fases metabólicas por formula+cepa ───────────────────────────────────

var K_CREC_FASES = K_CREC_FASES_KEY;

var _FASES_DEF = [
  { id: 'inoculacion',            label: 'Inoculación',            sub: 'Punto de partida',             color: '#00cc33', autoCI: true, typicalDay: 0  },
  { id: 'actividad_metabolica',   label: 'Actividad metabólica',   sub: 'Primeras hifas visibles',      color: '#2ecc71',              typicalDay: 2  },
  { id: 'primeros_filamentos',    label: 'Primeros filamentos',    sub: 'Organización inicial',          color: '#70ad47',              typicalDay: 5  },
  { id: 'crecimiento_activo',     label: 'Crecimiento activo',     sub: 'Expansión activa del micelio', color: '#44aaff',              typicalDay: 10 },
  { id: 'rizomorfismo_evaluable', label: 'Rizomorfismo evaluable', sub: 'Habilita scoring',             color: '#7c6fff',              typicalDay: 18 },
  { id: 'colonizacion_completa',  label: 'Colonización completa',  sub: 'Cierre de ciclo — pasa a GR', color: '#9b59b6',              typicalDay: 28 },
];

// Genera clave para bl2_crec_fases: format legacy (formulaId__geneticaId) o frasco-suffixed (con expId+frascoLabel).
// Ambos expId Y frascoLabel deben estar presentes en frascoCtx para usar el suffix; si falta uno, fallback a base.
function _creFasesKey(formulaId, geneticaId, frascoCtx) {
  var base = formulaId + '__' + (geneticaId || '_');
  return (frascoCtx && frascoCtx.expId && frascoCtx.frascoLabel)
    ? base + '__' + frascoCtx.expId + '__' + frascoCtx.frascoLabel
    : base;
}

function _creFasesRead(formulaId, geneticaId, frascoCtx) {
  try {
    var all = JSON.parse(localStorage.getItem(K_CREC_FASES)) || {};
    return all[_creFasesKey(formulaId, geneticaId, frascoCtx)] || [];
  } catch(e) { return []; }
}

function _creFasesWrite(formulaId, geneticaId, arr, frascoCtx) {
  try {
    var all = JSON.parse(localStorage.getItem(K_CREC_FASES)) || {};
    all[_creFasesKey(formulaId, geneticaId, frascoCtx)] = arr;
    localStorage.setItem(K_CREC_FASES, JSON.stringify(all));
  } catch(e) { console.warn('[CREC_FASES] write failed', e); }
}

function _creInoculacionDate(formulaId, geneticaId, frascoCtx) {
  // 1. Fase inoculación registrada manualmente en CRE — fuente de verdad (por frasco si aplica)
  var fases = _creFasesRead(formulaId, geneticaId, frascoCtx);
  var fi = fases.find(function(f) { return f.fase === 'inoculacion'; });
  if (fi && fi.fecha) return fi.fecha;
  // 2. bl2_forms.fecha (fecha global de la fórmula — no tiene noción de frasco, se deja igual)
  var d = _creGetInoculacionDate(formulaId, geneticaId);
  if (d) return d;
  // 3. bl2_seg.inoculoTs — timestamp por tanda en CI (campo real del módulo CI)
  try {
    var segs = JSON.parse(localStorage.getItem('bl2_seg')) || [];
    var matching = segs.filter(function(s) {
      if (s.formula_id !== formulaId || s.genetica !== geneticaId || !s.inoculoTs) return false;
      if (frascoCtx && frascoCtx.expId) {
        if (s.experimentoId !== frascoCtx.expId || s.experimentoFrascoId !== frascoCtx.frascoLabel) return false;
      }
      return true;
    });
    if (matching.length > 0) {
      var earliest = matching.reduce(function(min, s) {
        return s.inoculoTs < min ? s.inoculoTs : min;
      }, matching[0].inoculoTs);
      return new Date(earliest).toISOString().slice(0, 10);
    }
  } catch(e) {}
  // 4. CRERecord.inoculationDate (legacy — para records existentes pre-borrado)
  var recs = gArr('bl2_crec');
  var rec = recs.find(function(r) {
    if (r.formulaId !== formulaId || r.geneticaId !== geneticaId || !r.inoculationDate) return false;
    if (frascoCtx && frascoCtx.expId) {
      if (r.experimentoId !== frascoCtx.expId || r.frascoId !== frascoCtx.frascoLabel) return false;
    }
    return true;
  });
  return rec ? rec.inoculationDate : null;
}

function _creAutoFillInoculacion(formulaId, geneticaId, frascoCtx) {
  if (_creIsCleared(formulaId)) return;
  var fases = _creFasesRead(formulaId, geneticaId, frascoCtx);
  if (fases.some(function(f) { return f.fase === 'inoculacion'; })) return;
  var inocDate = _creInoculacionDate(formulaId, geneticaId, frascoCtx);
  if (!inocDate) return;
  fases.unshift({ fase: 'inoculacion', dia: 0, fecha: inocDate, ts: now(), auto: true });
  _creFasesWrite(formulaId, geneticaId, fases, frascoCtx);
}

function _creAutoFillColonizacion(formulaId, geneticaId, frascoCtx) {
  if (_creIsCleared(formulaId)) return;
  var fases = _creFasesRead(formulaId, geneticaId, frascoCtx);
  var inocDate = _creInoculacionDate(formulaId, geneticaId, frascoCtx);
  // Remove any auto-filled colonizacion that predates inoculación (bad CI data)
  if (inocDate) {
    var cleaned = fases.filter(function(f) {
      if (f.fase !== 'colonizacion_completa' || f.auto !== true) return true;
      if (!f.fecha) return true;
      return f.fecha >= inocDate;
    });
    if (cleaned.length !== fases.length) {
      _creFasesWrite(formulaId, geneticaId, cleaned, frascoCtx);
      fases = cleaned;
    }
  }
  if (fases.some(function(f) { return f.fase === 'colonizacion_completa'; })) return;
  var colonDate = _creGetColonizacionDate(formulaId, geneticaId, frascoCtx);
  if (!colonDate) return;
  var inocDate = _creInoculacionDate(formulaId, geneticaId, frascoCtx);
  var dia = null;
  if (inocDate) {
    var d0 = new Date(inocDate); d0.setHours(0,0,0,0);
    var d1 = new Date(colonDate); d1.setHours(0,0,0,0);
    var rawDia = Math.floor((d1 - d0) / 86400000);
    if (rawDia < 0) return; // CI date precedes CRE inoculación — skip, data inconsistent
    dia = rawDia;
  }
  fases.push({ fase: 'colonizacion_completa', dia: dia, fecha: colonDate, ts: now(), auto: true });
  _creFasesWrite(formulaId, geneticaId, fases, frascoCtx);
}

// Auto-fills intermediate phases as 'inferred' (Desconocido) when enough
// days have passed since inoculación. Never overwrites manually registered phases.
// Skips inoculación (own auto-fill) and colonizacion_completa (CI source).
function _creAutoFillInferredFases(formulaId, geneticaId, frascoCtx) {
  if (_creIsCleared(formulaId)) return;
  var diasElapsed = _creDiasSinceInoc(formulaId, geneticaId, frascoCtx);
  if (diasElapsed == null) return;
  var fases = _creFasesRead(formulaId, geneticaId, frascoCtx);
  var regMap = {};
  fases.forEach(function(f) { regMap[f.fase] = f; });
  var order = _FASES_DEF.map(function(d) { return d.id; });
  var changed = false;
  _FASES_DEF.forEach(function(def) {
    if (def.id === 'inoculacion' || def.id === 'colonizacion_completa') return;
    if (regMap[def.id]) return;
    if (diasElapsed < def.typicalDay) return;
    fases.push({ fase: def.id, dia: def.typicalDay, fecha: null, ts: now(), auto: 'inferred' });
    changed = true;
  });
  if (changed) {
    fases.sort(function(a, b) { return order.indexOf(a.fase) - order.indexOf(b.fase); });
    _creFasesWrite(formulaId, geneticaId, fases, frascoCtx);
  }
}

function _creDiasSinceInoc(formulaId, geneticaId, frascoCtx) {
  var inocDate = _creInoculacionDate(formulaId, geneticaId, frascoCtx);
  if (!inocDate) return null;
  var d0 = new Date(inocDate); d0.setHours(0,0,0,0);
  var d1 = new Date();         d1.setHours(0,0,0,0);
  return Math.max(0, Math.floor((d1 - d0) / 86400000));
}
// Returns the fase definition that matches the current temporal position.
// If registered phases cover the elapsed days, returns the last registered.
// If elapsed days go past registered phases, infers from typicalDay.
function _creTemporalZoneFase(formulaId, geneticaId, frascoCtx) {
  var fases = _creFasesRead(formulaId, geneticaId, frascoCtx);
  var regMap = {};
  fases.forEach(function(f) { regMap[f.fase] = f; });
  var diasElapsed = _creDiasSinceInoc(formulaId, geneticaId, frascoCtx);

  // If no inoculación date, fall back to first unregistered fase
  if (diasElapsed == null) {
    for (var i = 0; i < _FASES_DEF.length; i++) {
      if (!regMap[_FASES_DEF[i].id]) return { def: _FASES_DEF[i], dia: 0 };
    }
    return { def: _FASES_DEF[_FASES_DEF.length - 1], dia: 0 };
  }

  // Find the phase whose typicalDay is closest from below (temporal zone)
  var zone = _FASES_DEF[0];
  for (var j = _FASES_DEF.length - 1; j >= 0; j--) {
    if (diasElapsed >= _FASES_DEF[j].typicalDay) { zone = _FASES_DEF[j]; break; }
  }

  // Find last registered phase
  var lastRegIdx = -1;
  for (var k = _FASES_DEF.length - 1; k >= 0; k--) {
    if (regMap[_FASES_DEF[k].id]) { lastRegIdx = k; break; }
  }

  var zoneIdx = _FASES_DEF.indexOf(zone);
  // Use temporal zone if it's at or beyond the last registered phase
  if (zoneIdx >= lastRegIdx) return { def: zone, dia: diasElapsed };

  // Last registered is more recent — use it
  return { def: _FASES_DEF[lastRegIdx], dia: regMap[_FASES_DEF[lastRegIdx].id].dia || diasElapsed };
}

// ── Estado del scoring panel ──────────────────────────────────────────────
// Single source of truth: mutate ONLY through _spUpdate().
// No function may write _sp.* directly except _spUpdate and _spReset.
var _sp = {
  formulaId:      null,
  cepaId:         null,
  score:          null,
  tipo:           null,
  tab:            'fases',
  frasco:         null,         // null = Base | { expId, frascoId, frascoLabel, extras, expNombre }
  selected:       new Set(),    // keys: expId|frascoLabel|geneticaId — batch cepas
  expandedCepaId: null,         // cepa individually expanded (not in batch)
  faseEditOpen:   null,         // faseId cuya franja de edición está abierta (grid de fases)
  batchScore:     null,         // score for batch controls section
  batchTipo:      null,         // tipo for batch controls section
  batchStagedFase: null,        // { faseId } — pendiente de confirmar (grid de fases en batch)
};

function _spUpdate(patch) {
  Object.assign(_sp, patch);
}

function _spReset(formulaId) {
  _sp.formulaId      = formulaId || null;
  _sp.cepaId         = null;
  _sp.score          = null;
  _sp.tipo           = null;
  _sp.tab            = 'fases';
  _sp.frasco         = null;
  _sp.selected       = new Set();
  _sp.expandedCepaId = null;
  _sp.faseEditOpen   = null;
  _sp.batchScore      = null;
  _sp.batchTipo       = null;
  _sp.batchFasePos    = {};
  _sp.batchStagedFase = null;
}

function _spRemoveCepa(selKey) {
  var s = new Set(_sp.selected);
  s.delete(selKey);
  _sp.selected = s;
}

function _spToggleCepa(selKey) {
  var s = new Set(_sp.selected);
  if (s.has(selKey)) { s.delete(selKey); } else { s.add(selKey); }
  _sp.selected = s;
}

var _SCORE_META = {
  1:  { color: '#c0392b', lbl: 'Inhibic.'  },
  2:  { color: '#e74c3c', lbl: 'Lento'     },
  3:  { color: '#e67e22', lbl: 'Tom.denso' },
  4:  { color: '#f39c12', lbl: 'Tom.mod.'  },
  5:  { color: '#f1c40f', lbl: 'Difuso'    },
  6:  { color: '#27ae60', lbl: 'Pre-rizo'  },
  7:  { color: '#2ecc71', lbl: 'Rizo débil'},
  8:  { color: '#00cc33', lbl: 'Rizo medio'},
  9:  { color: '#00dd55', lbl: 'Rizo fuerte'},
  10: { color: '#7c6fff', lbl: 'Extremo'   },
};

function _creSPSelKey(expId, frascoLabel, geneticaId) {
  return (expId || '') + '|' + (frascoLabel || '') + '|' + (geneticaId || '');
}

function _creFrascoTabsHTML(formulaId, frascos) {
  // Base (sin experimentoId) no se muestra — no se puntúa. Todos los frascos de experimento sí.
  if (!frascos.length) return '';
  var fIdE    = esc(formulaId);
  var allIngs = typeof readIngredientes === 'function' ? readIngredientes() : [];
  var _activeFrascoLabel = _sp.frasco ? _sp.frasco.frascoLabel : null;
  var _activeExpId       = _sp.frasco ? _sp.frasco.expId       : null;

  var html = '<div class="cre-sp-frasco-tabs" id="cre-sp-ftabs-' + fIdE + '">';
  frascos.forEach(function(fr) {
    var extrasLabel = fr.extras.length
      ? fr.extras.map(function(ex) {
          var ing = allIngs.find(function(i) { return i.id === ex.ingId; });
          return ing ? ing.nombre : ex.ingId;
        }).join('+')
      : 'Control';
    var key = esc(fr.expId + '|' + fr.frascoLabel);
    var isFrascoActive = _activeExpId === fr.expId && _activeFrascoLabel === fr.frascoLabel;
    html += '<div class="cre-sp-ftab' + (isFrascoActive ? ' cre-sp-ftab--active' : '') + '" data-frasco-key="' + key + '"'
      + ' onclick="creSetScoringFrasco(\'' + fIdE + '\', \'' + key + '\')">'
      + '🔬 ' + esc(fr.frascoLabel) + ' · ' + esc(extrasLabel)
      + '</div>';
  });
  html += '</div>';
  return html;
}

function creSetScoringFrasco(formulaId, frascoKey) {
  if (!frascoKey) {
    _sp.frasco = null;
  } else {
    var pipeIdx    = frascoKey.indexOf('|');
    var expId       = frascoKey.slice(0, pipeIdx);
    var frascoLabel = frascoKey.slice(pipeIdx + 1);
    var allFrascos  = _creGetFrascosForFormula(formulaId);
    _sp.frasco = allFrascos.find(function(f) {
      return f.expId === expId && f.frascoLabel === frascoLabel;
    }) || null;
  }

  _sp.score          = null;
  _sp.tipo           = null;
  _sp.batchScore     = null;
  _sp.batchTipo      = null;
  _sp.batchFasePos   = {};
  _sp.expandedCepaId = null;
  _sp.faseEditOpen   = null;
  _sp.selected       = new Set();

  var ftabs = document.getElementById('cre-sp-ftabs-' + formulaId);
  if (ftabs) {
    ftabs.querySelectorAll('.cre-sp-ftab').forEach(function(t) {
      var k = t.getAttribute('data-frasco-key');
      var isActive = frascoKey ? k === frascoKey : k === '__base__';
      t.classList.toggle('cre-sp-ftab--active', isActive);
    });
  }

  _creRenderFormulaPanel(formulaId);
  _creRenderCepasSection(formulaId);
  _creRenderLogSection(formulaId);
}

function _creRenderFormulaPanel(formulaId) {
  var wrap = document.getElementById('cre-formula-panel-' + formulaId);
  if (wrap) wrap.innerHTML = _creFormulaPanelHTML(formulaId);
}

function _creRenderLogSection(formulaId) {
  var logWrap = document.getElementById('cre-formula-log-' + formulaId);
  if (!logWrap) return;
  var filter = _sp.frasco ? { experimentoId: _sp.frasco.expId, frascoId: _sp.frasco.frascoId } : null;
  var _hasFrs = _creGetFrascosForFormula(formulaId).length > 0;
  var title = _sp.frasco
    ? ('◉ Log · Frasco ' + esc(_sp.frasco.frascoLabel))
    : (_hasFrs ? '◉ Log · Base' : '◉ Log');
  logWrap.innerHTML = '<div class="cre-formula-log-header"><span class="cre-formula-log-title">' + title + '</span></div>'
    + '<div class="cre-matrix-body cre-formula-log-body">'
    + _creMatrixLogHTML(formulaId, filter)
    + '</div>';
}

// ── Formula context panel (replaces cre-sp-meta) ─────────────────────────
function _creFormulaPanelHTML(formulaId) {
  var snapshot = creGetSnapshotWithExtras(formulaId, _sp.frasco);
  if (!snapshot) return '';
  var allIngs  = typeof readIngredientes === 'function' ? readIngredientes() : [];
  var cnResult = typeof calcCN === 'function' ? calcCN(snapshot.ings, allIngs) : { cn: null, masa: 0 };
  var cn   = cnResult.cn   != null ? (+cnResult.cn).toFixed(1)   : '—';
  var masa = cnResult.masa != null ? (+cnResult.masa).toFixed(0)  : '—';

  var thScore = _creGetTheoreticalScore(snapshot.ings);
  var thPct   = thScore != null ? thScore : 0;
  var thCol   = thScore != null ? _creScoreColor(thScore) : 'var(--tx3)';

  var records = creRead();
  var fRecs   = _creFRecsForContext(formulaId, records).filter(function(r) {
    return r.status === 'cerrado';
  });
  var obScores = [];
  fRecs.forEach(function(r) {
    if (r.observaciones && r.observaciones.length) {
      var last = r.observaciones[r.observaciones.length - 1];
      if (last.calidadScore != null) obScores.push(last.calidadScore * 10);
    }
  });
  var hasObs = obScores.length > 0;
  var obAvg  = hasObs ? Math.round(obScores.reduce(function(a, b) { return a + b; }, 0) / obScores.length) : null;
  var obCol  = obAvg  != null ? _creScoreColor(obAvg) : 'var(--tx3)';
  var bias   = (thScore != null && obAvg != null) ? Math.round(thScore - obAvg) : null;
  var biasCol = bias != null ? (bias >= 0 ? '#2ecc71' : '#f39c12') : '';

  var html = '<div class="cre-formula-panel">';

  html += '<div class="cre-formula-bars">';
  html += '<div class="cre-fb-row">'
    + '<span class="cre-fb-lbl">Score teórico</span>'
    + '<div class="cre-fb-track"><div class="cre-fb-fill" style="width:' + thPct + '%;background:' + thCol + '"></div></div>'
    + '<span class="cre-fb-val" style="color:' + thCol + '">' + (thScore != null ? thScore : '—') + '</span>'
    + '</div>';
  if (hasObs) {
    html += '<div class="cre-fb-row">'
      + '<span class="cre-fb-lbl">Observado</span>'
      + '<div class="cre-fb-track"><div class="cre-fb-fill" style="width:' + obAvg + '%;background:' + obCol + '"></div></div>'
      + '<span class="cre-fb-val" style="color:' + obCol + '">' + obAvg + '</span>'
      + (bias != null ? '<span class="cre-fb-bias" style="color:' + biasCol + '">' + (bias >= 0 ? '+' : '') + bias + '</span>' : '')
      + '</div>';
  }
  html += '</div>';

  html += '<div class="cre-fb-meta">C/N <b>' + cn + '</b> · <b>' + masa + '</b> g</div>';

  var colKey    = 'cre-fp-ings-' + formulaId;
  var collapsed = sessionStorage.getItem(colKey) === '1';
  var maxQty = 0;
  snapshot.ings.forEach(function(ing) {
    var qty = ing.unidad === 'ml' ? (ing.qty / 10) : ing.qty;
    if (qty > maxQty) maxQty = qty;
  });
  html += '<details class="cre-fp-ings"' + (collapsed ? '' : ' open')
    + ' ontoggle="sessionStorage.setItem(\'' + colKey + '\',this.open?\'0\':\'1\')">';
  html += '<summary class="cre-fp-ings-summary">Ingredientes (' + snapshot.ings.length + ')</summary>';
  html += '<div class="cre-fp-ings-list">';
  var _extraIds = (_sp.frasco && _sp.frasco.extras)
    ? _sp.frasco.extras.reduce(function(acc, e) { acc[e.ingId] = true; return acc; }, {})
    : {};
  snapshot.ings.forEach(function(ing) {
    var qty = ing.unidad === 'ml' ? (ing.qty / 10) : ing.qty;
    var pct = maxQty > 0 ? Math.round(qty / maxQty * 100) : 0;
    var _isExtra = !!_extraIds[ing.id];
    html += '<div class="cre-fp-ing-row' + (_isExtra ? ' cre-fp-ing-row--extra' : '') + '">'
      + '<span class="cre-fp-ing-name">' + esc(ing.nombre) + '</span>'
      + '<div class="cre-fp-ing-bar-wrap"><div class="cre-fp-ing-bar' + (_isExtra ? ' cre-fp-ing-bar--extra' : '') + '" style="width:' + pct + '%"></div></div>'
      + '<span class="cre-fp-ing-qty">' + ing.qty + ' ' + esc(ing.unidad || 'g') + '</span>'
      + '</div>';
  });
  html += '</div></details>';

  html += '</div>';
  return html;
}

// ── Fase timeline dots ──────────────────────────────────────────────────────
function _creFaseTimelineHTML(fases) {
  var regMap = {};
  fases.forEach(function(f) { regMap[f.fase] = f; });
  var lastDone = -1;
  for (var i = _FASES_DEF.length - 1; i >= 0; i--) {
    if (regMap[_FASES_DEF[i].id]) { lastDone = i; break; }
  }
  var html = '<div class="cre-fase-timeline">';
  _FASES_DEF.forEach(function(def, idx) {
    var done    = !!regMap[def.id];
    var current = !done && idx === lastDone + 1;
    var title   = esc(def.label) + (done && regMap[def.id].dia != null ? ' · Día ' + regMap[def.id].dia : '');
    var dot = done    ? '<span class="cre-ft-dot cre-ft-dot--done" style="background:' + def.color + ';border-color:' + def.color + '" title="' + title + '"></span>'
            : current ? '<span class="cre-ft-dot cre-ft-dot--current" title="' + title + '"></span>'
            :           '<span class="cre-ft-dot" title="' + title + '"></span>';
    html += dot;
    if (idx < _FASES_DEF.length - 1) html += '<span class="cre-ft-line' + (done ? ' cre-ft-line--done' : '') + '"></span>';
  });
  html += '</div>';
  return html;
}

function creBatchFaseConfirm(formulaId) {
  var sf = _sp.batchStagedFase;
  if (!sf) return;
  var fechaEl = document.getElementById('cre-batch-fase-fecha-' + formulaId);
  var horaEl  = document.getElementById('cre-batch-fase-hora-' + formulaId);
  var fechaStr = (fechaEl && fechaEl.value) ? fechaEl.value : null;
  var horaStr  = (horaEl && horaEl.value) ? horaEl.value : null;
  _sp.batchStagedFase = null;
  _creBatchFaseRegisterNow(formulaId, sf.faseId, fechaStr, horaStr);
}

function creBatchFaseCancel(formulaId) {
  _sp.batchStagedFase = null;
  _creBatchControlsRerender(formulaId);
}

function creWipeFormulaFases(formulaId) {
  if (!formulaId) return;
  if (!confirm('¿Eliminar TODO el registro de esta fórmula? Se borran scores, incidencia, fases y logs. No se puede deshacer.')) return;
  creDeleteFormula(formulaId);
  _sp.batchFasePos    = {};
  _sp.batchStagedFase = null;
  notif('Registro eliminado — podés volver a puntuar desde cero', 'info');
  var detalle = document.getElementById('cre-detalle-wrap');
  if (detalle) detalle.innerHTML = _creScoringPanelHTML(formulaId, null);
}

// ── Cepa card ───────────────────────────────────────────────────────────────
function _creCepaCardHTML(formulaId, cepa, fRecs, allFases) {
  var fIdE  = esc(formulaId);
  var gIdE  = esc(cepa.id);
  var color = _creChipColor(cepa.id);
  var fases = allFases[cepa.id] || [];

  var expId       = _sp.frasco ? _sp.frasco.expId       : null;
  var frascoLabel = _sp.frasco ? _sp.frasco.frascoLabel : null;
  var selKey      = _creSPSelKey(expId, frascoLabel, cepa.id);

  var isExpanded = _sp.expandedCepaId === cepa.id;
  var isBatch    = _sp.selected.has(selKey);

  // Prioridad: record con frascoId exacto (post-fix) > legacy (sin frascoId).
  // Dentro del grupo ganador: el más reciente (último en array = última puntuación).
  var _fId       = _sp.frasco ? _sp.frasco.frascoId : null;
  var _closed    = fRecs.filter(function(r) { return r.geneticaId === cepa.id && r.status === 'cerrado'; });
  var _exact     = _fId != null ? _closed.filter(function(r) { return r.frascoId === _fId; }) : [];
  var rec        = (_exact.length ? _exact : _closed).slice(-1)[0] || null;
  var lastObs = rec && rec.observaciones && rec.observaciones.length
    ? rec.observaciones[rec.observaciones.length - 1] : null;
  var recScore = lastObs && lastObs.calidadScore != null ? lastObs.calidadScore : null;

  var lastFase = null;
  for (var i = _FASES_DEF.length - 1; i >= 0; i--) {
    var match = fases.find(function(f) { return f.fase === _FASES_DEF[i].id; });
    if (match) { lastFase = { def: _FASES_DEF[i], dia: match.dia }; break; }
  }
  var faseLabel = lastFase
    ? esc(lastFase.def.label.split(' ')[0]) + ' Día ' + (lastFase.dia != null ? lastFase.dia : '?')
    : 'Sin fases';

  var cardCls = 'cre-cepa-card'
    + (isExpanded ? ' cre-cepa-card--expanded' : '')
    + (isBatch    ? ' cre-cepa-card--batch'    : '');
  var borderStyle = isBatch ? 'border-color:' + color + ';' : '';

  var html = '<div class="' + cardCls + '" data-cepa-id="' + gIdE + '" style="' + borderStyle + '">';

  var headerClick = isBatch ? '' : ' onclick="creToggleCepaExpand(\'' + fIdE + '\',\'' + gIdE + '\')"';
  html += '<div class="cre-cepa-card-header"' + headerClick + '>';

  html += '<input type="checkbox" class="cre-cepa-card-chk"'
    + (isBatch ? ' checked' : '')
    + ' onclick="event.stopPropagation();creToggleCepaBatch(\'' + fIdE + '\',\'' + gIdE + '\')" title="Agregar al batch">';

  html += '<span class="cre-cepa-chip" style="background:' + color + '1a;border:1px solid ' + color + ';color:' + color + '">'
    + esc(_creDispLabel(cepa.label)) + '</span>';

  html += _creFaseTimelineHTML(fases);

  html += '<span class="cre-cepa-phase-badge">' + faseLabel + '</span>';

  if (recScore != null) {
    var scMeta = _SCORE_META[Math.round(recScore)];
    var scCol  = scMeta ? scMeta.color : 'var(--tx2)';
    html += '<span class="cre-cepa-score-badge" style="color:' + scCol + ';border-color:' + scCol + '">' + recScore + '/10</span>';
  } else if (!isBatch) {
    html += '<span class="cre-cepa-score-badge cre-cepa-score-badge--pending">Pendiente</span>';
  }

  if (isBatch) {
    html += '<span class="cre-cepa-batch-tag">batch</span>';
  }

  html += '</div>';

  if (isExpanded) {
    html += '<div class="cre-cepa-card-body">';
    html += _creFasesGridHTML(formulaId, cepa.id);
    html += _creScoringFormHTML(formulaId, cepa.id, fRecs);
    html += '</div>';
  }

  html += '</div>';
  return html;
}

function creSelectAllCepas(formulaId) {
  var expId       = _sp.frasco ? _sp.frasco.expId       : null;
  var frascoLabel = _sp.frasco ? _sp.frasco.frascoLabel : null;
  var cepas = _sp.frasco
    ? _creGetCepasForFrasco(formulaId, expId, frascoLabel)
    : _creGetCepasForFormula(formulaId);
  var keys = cepas.map(function(c) { return _creSPSelKey(expId, frascoLabel, c.id); });
  var allSel = keys.length > 0 && keys.every(function(k) { return _sp.selected.has(k); });
  var s = new Set(_sp.selected);
  if (allSel) { keys.forEach(function(k) { s.delete(k); }); }
  else        { keys.forEach(function(k) { s.add(k);    }); }
  _sp.selected       = s;
  _sp.expandedCepaId = null;
  _sp.faseEditOpen   = null;
  _creRenderCepasSection(formulaId);
}

function _creSelectAllRowHTML(formulaId, cepas) {
  if (!cepas.length) return '';
  var expId       = _sp.frasco ? _sp.frasco.expId       : null;
  var frascoLabel = _sp.frasco ? _sp.frasco.frascoLabel : null;
  var keys    = cepas.map(function(c) { return _creSPSelKey(expId, frascoLabel, c.id); });
  var allSel  = keys.every(function(k) { return _sp.selected.has(k); });
  var lbl     = allSel ? '☐ Ninguna' : ('☑ Todas (' + cepas.length + ')');
  return '<div class="cre-cepas-selectall-row">'
    + '<button class="clab-btn clab-btn-sm" onclick="creSelectAllCepas(\'' + esc(formulaId) + '\')">' + lbl + '</button>'
    + '</div>';
}

// ── Save button label ────────────────────────────────────────────────────────
function _creSaveBtnLabel() {
  var hasInd = !!_sp.expandedCepaId;
  var nBat   = _sp.selected.size;
  if (!hasInd && nBat === 0) return '✓ Guardar';
  if (hasInd  && nBat === 0) return '✓ Guardar cepa';
  if (!hasInd && nBat === 1) return '✓ Guardar cepa';
  if (!hasInd && nBat > 1)  return '✓ Guardar ' + nBat + ' cepas';
  return '✓ Guardar ' + (1 + nBat) + ' cepas (1 individual · ' + nBat + ' batch)';
}

// ── Partial re-render of cepa cards + batch controls + save button ───────────
function _creRenderCepasSection(formulaId) {
  var records  = creRead();
  var fRecs    = _creFRecsForContext(formulaId, records);
  var cepas    = _sp.frasco
    ? _creGetCepasForFrasco(formulaId, _sp.frasco.expId, _sp.frasco.frascoLabel)
    : _creGetCepasForFormula(formulaId);
  var allFases = {};
  cepas.forEach(function(c) { allFases[c.id] = _creFasesRead(formulaId, c.id, _sp.frasco); });

  var cardsWrap = document.getElementById('cre-cepa-cards-' + formulaId);
  if (cardsWrap) {
    cardsWrap.innerHTML = _creSelectAllRowHTML(formulaId, cepas)
      + cepas.map(function(c) {
          return _creCepaCardHTML(formulaId, c, fRecs, allFases);
        }).join('');
  }

  var batchWrap = document.getElementById('cre-batch-controls-' + formulaId);
  if (batchWrap) batchWrap.innerHTML = _creBatchControlsHTML(formulaId);

  var saveBtn = document.getElementById('cre-sp-save-btn-' + formulaId);
  if (saveBtn) saveBtn.textContent = _creSaveBtnLabel();
}

// ── Toggle individual expand ─────────────────────────────────────────────────
function creToggleCepaExpand(formulaId, geneticaId) {
  _sp.faseEditOpen = null;
  var expId       = _sp.frasco ? _sp.frasco.expId       : null;
  var frascoLabel = _sp.frasco ? _sp.frasco.frascoLabel : null;
  var selKey      = _creSPSelKey(expId, frascoLabel, geneticaId);
  if (_sp.selected.has(selKey)) return; // in batch — no-op

  if (_sp.expandedCepaId === geneticaId) {
    _sp.expandedCepaId = null;
  } else {
    _sp.expandedCepaId = geneticaId;
    _sp.cepaId = geneticaId;
    var records  = creRead();
    var fRecs    = _creFRecsForContext(formulaId, records);
    var _fId2    = _sp.frasco ? _sp.frasco.frascoId : null;
    var _closed2 = fRecs.filter(function(r) { return r.geneticaId === geneticaId && r.status === 'cerrado'; });
    var _exact2  = _fId2 != null ? _closed2.filter(function(r) { return r.frascoId === _fId2; }) : [];
    var rec      = (_exact2.length ? _exact2 : _closed2).slice(-1)[0] || null;
    var lastObs  = rec && rec.observaciones && rec.observaciones.length
      ? rec.observaciones[rec.observaciones.length - 1] : null;
    _sp.score = lastObs && lastObs.calidadScore != null ? Math.round(lastObs.calidadScore) : null;
    _sp.tipo  = lastObs ? (lastObs.tipoCordon || null) : null;
  }
  _creRenderCepasSection(formulaId);
}

// ── Toggle batch checkbox ────────────────────────────────────────────────────
function creToggleCepaBatch(formulaId, geneticaId) {
  var expId       = _sp.frasco ? _sp.frasco.expId       : null;
  var frascoLabel = _sp.frasco ? _sp.frasco.frascoLabel : null;
  var selKey      = _creSPSelKey(expId, frascoLabel, geneticaId);

  if (_sp.expandedCepaId === geneticaId) {
    _sp.expandedCepaId = null;
    _sp.score = null;
    _sp.tipo  = null;
    _sp.faseEditOpen = null;
  }

  if (_sp.selected.has(selKey)) {
    _sp.selected.delete(selKey);
  } else {
    _sp.selected.add(selKey);
  }
  _creRenderCepasSection(formulaId);
}

// ── Batch score functions ────────────────────────────────────────────────────
function creSelectBatchScore(n) {
  _sp.batchScore = n;
  var formulaId  = _sp.formulaId;
  if (!formulaId) return;
  document.querySelectorAll('.cre-score-btn--bat').forEach(function(btn) {
    btn.classList.remove('active');
    btn.style.background = '';
    var numEl = btn.querySelector('.csb-num');
    if (!numEl) return;
    var num = parseInt(numEl.textContent, 10);
    if (num === n) {
      btn.classList.add('active');
      btn.style.background = _SCORE_META[n].color + '22';
    }
  });
  var tipoWrap = document.getElementById('cre-bat-tipo-wrap-' + formulaId);
  if (tipoWrap) tipoWrap.style.display = n >= 7 ? '' : 'none';
  var rizoEl = document.getElementById('cre-bat-rizo-' + formulaId);
  if (rizoEl) {
    if (n >= 7) {
      rizoEl.disabled = false; rizoEl.style.opacity = '';
      rizoEl.style.color = 'var(--st-activa)'; rizoEl.placeholder = '0';
    } else {
      rizoEl.disabled = true; rizoEl.value = ''; rizoEl.style.opacity = '0.35';
      rizoEl.style.color = ''; rizoEl.placeholder = 'N/A';
    }
  }
  if (n < 7) _sp.batchTipo = null;
  creUpdateBatchCompound(formulaId);
}

function creSelectBatchTipo(tipo) {
  _sp.batchTipo  = tipo;
  var formulaId  = _sp.formulaId;
  if (!formulaId) return;
  var tipoWrap = document.getElementById('cre-bat-tipo-wrap-' + formulaId);
  if (!tipoWrap) return;
  tipoWrap.querySelectorAll('.cre-tipo-btn--bat').forEach(function(btn) {
    btn.classList.remove('active');
    if (btn.classList.contains('cre-tipo-btn--' + tipo)) btn.classList.add('active');
  });
}

function creUpdateBatchCompound(formulaId) {
  var totalEl = document.getElementById('cre-bat-total-' + formulaId);
  var rizoEl  = document.getElementById('cre-bat-rizo-'  + formulaId);
  var pctEl   = document.getElementById('cre-bat-pct-'   + formulaId);
  var cmpEl   = document.getElementById('cre-bat-compound-val-' + formulaId);
  if (!totalEl || !rizoEl) return;

  var total = parseInt(totalEl.value, 10);
  var rizo  = parseInt(rizoEl.value,  10);
  var score = _sp.batchScore;

  if (!isNaN(total) && total > 0) {
    if (!isNaN(rizo) && rizo < 0)     { rizo = 0;     rizoEl.value = 0; }
    if (!isNaN(rizo) && rizo > total) { rizo = total;  rizoEl.value = total; }
  }

  if (pctEl) {
    if (score != null && score < 7) {
      pctEl.innerHTML = '<span style="color:var(--tx3)">N/A · difuso</span>';
    } else if (!isNaN(total) && total > 0 && !isNaN(rizo)) {
      var pct = Math.min(100, Math.round((rizo / total) * 100));
      pctEl.innerHTML = '<b style="color:var(--st-activa)">' + pct + '%</b> <span style="color:var(--tx3)">(' + rizo + '/' + total + ')</span>';
    } else {
      pctEl.innerHTML = '<span style="color:var(--tx3)">— %</span>';
    }
  }

  var rizoApplies = score != null && score >= 7;
  var rizoVal = (rizoApplies && !isNaN(rizo)) ? rizo : null;
  var firstGId = null;
  _sp.selected.forEach(function(key) { if (!firstGId) firstGId = key.split('|')[2]; });
  var comp = _creCalcCompound(score, rizoVal, !isNaN(total) && total > 0 ? total : null, formulaId, firstGId, _sp.frasco);
  var compColor = comp != null ? _creScoreColor(comp * 10) : 'var(--tx3)';
  if (cmpEl) { cmpEl.textContent = comp != null ? comp.toFixed(1) : '—'; cmpEl.style.color = compColor; }
}

// ── Batch controls section ───────────────────────────────────────────────────
function _creBatchControlsHTML(formulaId) {
  if (_sp.selected.size === 0) return '';
  var fIdE    = esc(formulaId);
  var allG    = creReadGenetics();
  var preScore = _sp.batchScore;
  var preTipo  = _sp.batchTipo;

  var records = creRead();
  var fRecs   = _creFRecsForContext(formulaId, records);
  var totalSum = 0, rizoSum = 0;
  _sp.selected.forEach(function(key) {
    var parts = key.split('|');
    var kExp = parts[0] || null; var kFr = parts[1] || null; var gId = parts[2];
    var ci = _creGetPlacasFromCI(formulaId, gId, kExp, kFr);
    if (ci != null) { totalSum += ci; }
    else {
      var r = fRecs.find(function(r) { return r.geneticaId === gId && r.status === 'cerrado'; });
      if (r && r.totalPlacas != null) totalSum += r.totalPlacas;
    }
    var r2 = fRecs.find(function(r) { return r.geneticaId === gId && r.status === 'cerrado'; });
    if (r2 && r2.rizoPozitivas != null) rizoSum += r2.rizoPozitivas;
  });

  var chips = '';
  _sp.selected.forEach(function(key) {
    var gId = key.split('|')[2];
    var g   = allG.find(function(x) { return x.id === gId; });
    var col = _creChipColor(gId);
    chips += '<span class="cre-cepa-chip" style="background:' + col + '1a;border:1px solid ' + col + ';color:' + col + ';font-size:10px;padding:1px 7px">'
      + esc(_creDispLabel(g ? g.label : gId)) + '</span>';
  });

  var html = '<div class="cre-batch-controls" id="cre-batch-ctrl-' + fIdE + '">';
  html += '<div class="cre-batch-hdr"><span class="cre-batch-hdr-lbl">'
    + _sp.selected.size + ' cepa' + (_sp.selected.size > 1 ? 's' : '') + ' en batch</span>' + chips + '</div>';

  html += _creBatchFasesGridHTML(formulaId);

  // Confirmación de fase staged — aparece solo cuando hay un dot arrastrado pendiente
  if (_sp.batchStagedFase) {
    var _sf = _sp.batchStagedFase;
    var _sfDef = _FASES_DEF.find(function(f) { return f.id === _sf.faseId; });
    var _sfCol = _sfDef ? _sfDef.color : '#FFD700';
    var _sfLbl = _sfDef ? _sfDef.label : _sf.faseId;
    // Pedido del usuario (2026-07-23): el batch solo dejaba registrar "ahora", sin
    // poder cargar una fecha/hora distinta para las N cepas a la vez. Default = ahora,
    // editable antes de confirmar.
    var _sfNow = new Date();
    var _sfDefFecha = _creHoyISO();
    var _sfDefHora  = String(_sfNow.getHours()).padStart(2, '0') + ':' + String(_sfNow.getMinutes()).padStart(2, '0');
    html += '<div class="cre-batch-fase-confirm">'
      + '<span style="color:' + _sfCol + ';font-weight:700">' + esc(_sfLbl) + '</span>'
      + '<input type="date" id="cre-batch-fase-fecha-' + fIdE + '" class="cre-incidence-input" style="width:120px;font-size:11px" value="' + _sfDefFecha + '">'
      + '<input type="time" id="cre-batch-fase-hora-' + fIdE + '" class="cre-incidence-input" style="width:80px;font-size:11px" value="' + _sfDefHora + '">'
      + '<span style="color:var(--tx3);margin:0 6px">→ ' + _sp.selected.size + ' cep' + (_sp.selected.size > 1 ? 'as' : 'a') + '</span>'
      + '<button class="clab-btn clab-btn--xs" style="background:' + _sfCol + '22;border-color:' + _sfCol + ';color:' + _sfCol + ';font-weight:700"'
      + ' onclick="creBatchFaseConfirm(\'' + fIdE + '\')">✓ Guardar</button>'
      + '<button class="clab-btn clab-btn--xs" style="opacity:0.6;margin-left:4px"'
      + ' onclick="creBatchFaseCancel(\'' + fIdE + '\')">✕</button>'
      + '</div>';
  }

  html += '<div class="cre-score-grid cre-score-grid--row10" style="margin-bottom:8px">';
  [1,2,3,4,5,6,7,8,9,10].forEach(function(n) {
    var m = _SCORE_META[n];
    var isActive = preScore === n;
    html += '<div class="cre-score-btn cre-score-btn--sm cre-score-btn--bat' + (isActive ? ' active' : '') + '"'
      + ' style="border-color:' + m.color + ';' + (isActive ? 'background:' + m.color + '22' : '') + '"'
      + ' onclick="creSelectBatchScore(' + n + ')" title="' + m.lbl + '">'
      + '<span class="csb-num" style="color:' + m.color + '">' + n + '</span></div>';
  });
  html += '</div>';

  var tipoVis = (preScore != null && preScore >= 7) ? '' : 'display:none;';
  html += '<div id="cre-bat-tipo-wrap-' + fIdE + '" style="' + tipoVis + 'margin-bottom:8px">';
  html += '<div style="font-size:10px;color:var(--tx3);margin-bottom:4px">Tipo de cordón</div>';
  html += '<div class="cre-tipo-selector">';
  ['fino','grueso','mixto'].forEach(function(t) {
    var isA = preTipo === t;
    html += '<div class="cre-tipo-btn cre-tipo-btn--' + t + ' cre-tipo-btn--bat' + (isA ? ' active' : '') + '"'
      + ' onclick="creSelectBatchTipo(\'' + t + '\')">'
      + t.charAt(0).toUpperCase() + t.slice(1) + '</div>';
  });
  html += '</div></div>';

  var fromCI = totalSum > 0;
  html += '<div class="cre-incidence-row">'
    + '<div><div class="cre-incidence-lbl">Total'
    + (fromCI ? '<span style="margin-left:4px;font-size:8px;font-weight:700;background:rgba(0,204,51,0.12);color:var(--st-activa);border:1px solid rgba(0,204,51,0.3);border-radius:3px;padding:1px 4px">CI</span>' : '')
    + '</div>'
    + '<input type="number" id="cre-bat-total-' + fIdE + '" class="cre-incidence-input" min="1" max="9999" value="' + (fromCI ? totalSum : '') + '"'
    + (fromCI ? ' style="border-color:rgba(0,204,51,0.35)"' : '')
    + ' oninput="creUpdateBatchCompound(\'' + fIdE + '\')" placeholder="0"></div>'
    + '<div class="cre-incidence-arrow">→</div>'
    + '<div><div class="cre-incidence-lbl">Placas con rizomorfismo</div>'
    + '<input type="number" id="cre-bat-rizo-' + fIdE + '" class="cre-incidence-input" min="0" max="9999" value="' + (preScore != null && preScore >= 7 && rizoSum > 0 ? rizoSum : '') + '"'
    + (preScore != null && preScore >= 7 ? ' style="color:var(--st-activa);border-color:rgba(0,204,51,0.3)"' : ' style="opacity:0.35" disabled')
    + ' oninput="creUpdateBatchCompound(\'' + fIdE + '\')" placeholder="' + (preScore != null && preScore >= 7 ? '0' : 'N/A') + '"></div>'
    + '</div>';

  html += '<div class="cre-incidence-result" id="cre-bat-pct-' + fIdE + '">'
    + '<span style="color:var(--tx3)">— %</span></div>';

  html += '<div class="cre-compound" id="cre-bat-compound-' + fIdE + '">'
    + '<div><div class="cre-compound-label">Score Batch</div></div>'
    + '<div class="cre-compound-val" style="color:var(--tx3)" id="cre-bat-compound-val-' + fIdE + '">—</div>'
    + '</div>';

  // Botón 🔬 batch — solo si hay al menos un record cerrado con obs entre las cepas seleccionadas
  var _batchHasRecs = false;
  _sp.selected.forEach(function(key) {
    var gId = key.split('|')[2];
    var _fId2 = _sp.frasco ? _sp.frasco.frascoId : null;
    var _closed = fRecs.filter(function(r) { return r.geneticaId === gId && r.status === 'cerrado'; });
    var _exact  = _fId2 != null ? _closed.filter(function(r) { return r.frascoId === _fId2; }) : [];
    var _rec    = (_exact.length ? _exact : _closed).slice(-1)[0];
    if (_rec && _rec.observaciones && _rec.observaciones.length) _batchHasRecs = true;
  });
  if (_batchHasRecs) {
    html += '<button class="clab-btn clab-btn-sm" onclick="_creWizardOpenBatch(\'' + fIdE + '\')" '
      + 'style="color:var(--ac2);border-color:var(--ac2);width:100%;margin-top:6px">'
      + '🔬 Analizar señales — ' + _sp.selected.size + ' cepas</button>';
  }

  html += '</div>';
  return html;
}

function _creScoringPanelHTML(formulaId, geneticaId) {
  var snapshot = creGetFormulaSnapshot(formulaId);
  var forms    = typeof readForms === 'function' ? readForms() : [];
  var form     = forms.find(function(f) { return f.id === formulaId; });
  var name     = snapshot ? snapshot.nombre : (form ? (form.nombre || formulaId) : formulaId);

  var frascos  = _creGetFrascosForFormula(formulaId);
  var cepas    = _sp.frasco
    ? _creGetCepasForFrasco(formulaId, _sp.frasco.expId, _sp.frasco.frascoLabel)
    : _creGetCepasForFormula(formulaId);
  var records  = creRead();
  var fRecs    = _creFRecsForContext(formulaId, records);
  var allFases = {};
  cepas.forEach(function(c) { allFases[c.id] = _creFasesRead(formulaId, c.id, _sp.frasco); });

  var fIdE = esc(formulaId);
  var html = '<div class="cre-sp-wrap">';
  html += '<div class="cre-sp-header">'
    + '<button class="cre-back-btn" onclick="creCloseScoringPanel()" title="Volver">←</button>'
    + '<div class="cre-sp-heading">'
    +   '<div class="cre-sp-eyebrow">Panel de scoring</div>'
    +   '<div class="cre-sp-title">' + esc(name) + '</div>'
    +   '<button class="clab-btn clab-btn--xs" style="margin-top:4px;opacity:0.6;font-size:9px;border-color:rgba(255,80,80,0.4);color:rgba(255,80,80,0.8)"'
    +   ' onclick="creWipeFormulaFases(\'' + fIdE + '\')" title="Eliminar TODO: scores, incidencia, fases y logs de esta fórmula">🗑 Limpiar todo</button>'
    + '</div>'
    + '</div>';

  html += '<div id="cre-formula-panel-' + fIdE + '">' + _creFormulaPanelHTML(formulaId) + '</div>';

  html += '<details class="cre-sp-guide">'
    + '<summary>📋 Ver guía de puntuación (1–10)</summary>'
    + '<div class="cre-sp-guide-body">'
    + [
        { r: '1–2', c: 'rgba(192,57,43,0.25)',   lbl: 'Inhibición / lento'   },
        { r: '3–4', c: 'rgba(230,126,34,0.2)',   lbl: 'Tomentoso'            },
        { r: '5–6', c: 'rgba(241,196,15,0.18)',  lbl: 'Normal difuso'        },
        { r: '7–8', c: 'rgba(46,204,113,0.18)',  lbl: 'Rizo activo'          },
        { r: '9–10',c: 'rgba(124,111,255,0.22)', lbl: 'Rizo extremo'         },
      ].map(function(g) {
        return '<div class="cre-sp-guide-cell" style="background:' + g.c + '">'
          + '<div style="font-weight:700">' + g.r + '</div>'
          + '<div style="color:var(--tx3)">' + g.lbl + '</div>'
          + '</div>';
      }).join('')
    + '</div>'
    + '</details>';

  html += _creFrascoTabsHTML(formulaId, frascos);

  if (cepas.length === 0) {
    html += '<div class="cre-empty-state">'
      + '<div class="cre-empty-title">Sin cepas detectadas de CI</div>'
      + '<div class="cre-empty-copy">Registra primero un cultivo en CI para esta formula.</div>'
      + '</div>';
    html += '</div>';
    return html;
  }

  html += '<div id="cre-cepa-cards-' + fIdE + '">';
  html += _creSelectAllRowHTML(formulaId, cepas);
  html += cepas.map(function(c) {
    return _creCepaCardHTML(formulaId, c, fRecs, allFases);
  }).join('');
  html += '</div>';

  html += '<div id="cre-batch-controls-' + fIdE + '">';
  html += _creBatchControlsHTML(formulaId);
  html += '</div>';

  html += '<div class="cre-sp-save-row">'
    + '<button class="clab-btn" id="cre-sp-save-btn-' + fIdE + '"'
    + ' onclick="creSubmitScoringPanel(\'' + fIdE + '\')"'
    + ' style="background:var(--ac2);color:var(--bg);border-color:var(--ac2);font-weight:700;width:100%">'
    + _creSaveBtnLabel()
    + '</button>'
    + '</div>';

  var _logFrascoFilter = _sp.frasco ? { experimentoId: _sp.frasco.expId, frascoId: _sp.frasco.frascoId } : null;
  var _logTitle = _sp.frasco
    ? ('◉ Log · Frasco ' + esc(_sp.frasco.frascoLabel))
    : (frascos.length > 0 ? '◉ Log · Base' : '◉ Log');
  html += '<div class="cre-formula-log-section" id="cre-formula-log-' + fIdE + '">'
    + '<div class="cre-formula-log-header"><span class="cre-formula-log-title">' + _logTitle + '</span></div>'
    + '<div class="cre-matrix-body cre-formula-log-body">'
    + _creMatrixLogHTML(formulaId, _logFrascoFilter)
    + '</div></div>';

  html += '</div>';
  return html;
}

function _creScoringScoreTabHTML(formulaId, geneticaId, fRecs) {
  var fIdE = esc(formulaId);
  var gIdE = esc(geneticaId || '');

  var existingRec = fRecs ? fRecs.find(function(r) {
    return r.geneticaId === geneticaId && r.status === 'cerrado';
  }) : null;
  var existingObs = existingRec && existingRec.observaciones && existingRec.observaciones.length
    ? existingRec.observaciones[existingRec.observaciones.length - 1]
    : null;

  // Valores sellados del record existente
  var recScore = existingObs && existingObs.calidadScore != null
    ? Math.round(existingObs.calidadScore)
    : (existingObs && existingObs.scoreObservado != null ? Math.round(existingObs.scoreObservado) : null);
  var recTipo  = existingObs ? (existingObs.tipoCordon || null) : null;

  // Setear estado SOLO si el usuario no eligió nada en esta sesión (no pisar selección activa)
  if (_sp.score === null) _sp.score = recScore;
  if (_sp.tipo  === null) _sp.tipo  = recTipo;

  // Display usa el estado de sesión (puede diferir del record si el usuario cambió algo)
  var preScore = _sp.score;
  var preTipo  = _sp.tipo;

  // Incidencia sellada: usar totalPlacas del record cuando existe (nunca re-leer CI en display)
  // Solo usar CI en vivo cuando no hay record aún (primera carga)
  var sealedTotal = existingRec && existingRec.totalPlacas != null ? existingRec.totalPlacas : null;
  var _fCtx = _sp.frasco;
  var ciPlacas    = sealedTotal == null ? _creGetPlacasFromCI(formulaId, geneticaId, _fCtx ? _fCtx.expId : null, _fCtx ? _fCtx.frascoLabel : null) : null;
  var preTotal    = sealedTotal != null ? sealedTotal : (ciPlacas != null ? ciPlacas : '');
  var preRizo     = existingRec && existingRec.rizoPozitivas != null ? existingRec.rizoPozitivas : '';
  var fromCI      = sealedTotal == null && ciPlacas != null;

  var html = '';

  // ── Score 1–10 fila compacta ─────────────────────────────────────────────
  html += '<div class="cre-score-grid cre-score-grid--row10" style="margin-bottom:10px">';
  [1,2,3,4,5,6,7,8,9,10].forEach(function(n) {
    var m = _SCORE_META[n];
    var isActive = preScore === n;
    html += '<div class="cre-score-btn cre-score-btn--sm cre-score-btn--ind' + (isActive ? ' active' : '') + '"'
      + ' style="border-color:' + m.color + ';' + (isActive ? 'background:' + m.color + '22' : '') + '"'
      + ' onclick="creSelectScore(' + n + ')" title="' + m.lbl + '">'
      + '<span class="csb-num" style="color:' + m.color + '">' + n + '</span>'
      + '</div>';
  });
  html += '</div>';

  // ── Tipo cordón (visible si score >= 7) ──────────────────────────────────
  var tipoVis = (preScore != null && preScore >= 7) ? '' : 'display:none;';
  html += '<div id="cre-tipo-wrap-ind-' + fIdE + '" style="' + tipoVis + 'margin-bottom:10px">';
  html += '<div style="font-size:10px;color:var(--tx3);margin-bottom:5px">Tipo de cordón</div>';
  html += '<div class="cre-tipo-selector">';
  ['fino','grueso','mixto'].forEach(function(t) {
    var isA = preTipo === t;
    html += '<div class="cre-tipo-btn cre-tipo-btn--' + t + ' cre-tipo-btn--ind' + (isA ? ' active' : '') + '"'
      + ' onclick="creSelectTipo(\'' + t + '\')">'
      + t.charAt(0).toUpperCase() + t.slice(1)
      + '</div>';
  });
  html += '</div></div>';

  // ── Incidencia ───────────────────────────────────────────────────────────
  html += '<div style="font-size:9px;font-weight:700;text-transform:uppercase;color:var(--st-activa);letter-spacing:1px;margin-bottom:6px">Incidencia</div>';
  html += '<div class="cre-incidence-row">'
    + '<div><div class="cre-incidence-lbl">Total'
    + (fromCI ? '<span style="margin-left:4px;font-size:8px;font-weight:700;background:rgba(0,204,51,0.12);color:var(--st-activa);border:1px solid rgba(0,204,51,0.3);border-radius:3px;padding:1px 4px">CI</span>' : '')
    + '</div>'
    + '<input type="number" id="cre-sp-total-' + fIdE + '" class="cre-incidence-input" min="1" max="500" value="' + preTotal + '"'
    + (fromCI ? ' style="border-color:rgba(0,204,51,0.35)"' : '')
    + ' oninput="creUpdateCompound(\'' + fIdE + '\')" placeholder="0"></div>'
    + '<div class="cre-incidence-arrow">→</div>'
    + '<div><div class="cre-incidence-lbl">Placas con rizomorfismo</div>'
    + '<input type="number" id="cre-sp-rizo-' + fIdE + '" class="cre-incidence-input" min="0" max="500" value="' + (preScore >= 7 ? preRizo : '') + '"'
    + (preScore >= 7 ? ' style="color:var(--st-activa);border-color:rgba(0,204,51,0.3)"' : ' style="opacity:0.35" disabled')
    + ' oninput="creUpdateCompound(\'' + fIdE + '\')" placeholder="' + (preScore >= 7 ? '0' : 'N/A') + '"></div>'
    + '</div>';

  html += '<div class="cre-incidence-result" id="cre-sp-pct-' + fIdE + '">';
  if (preScore < 7) {
    html += '<div class="cre-incidence-pct" style="color:var(--tx3)">N/A</div>'
      + '<div class="cre-incidence-sub">difuso / tormentoso</div>';
  } else if (preTotal !== '' && preRizo !== '' && +preTotal > 0) {
    var pct = Math.round((+preRizo / +preTotal) * 100);
    html += '<div class="cre-incidence-pct">' + pct + '%</div>'
      + '<div class="cre-incidence-sub">' + preRizo + ' de ' + preTotal + '</div>';
  } else {
    html += '<div class="cre-incidence-pct" style="color:var(--tx3)">—%</div>'
      + '<div class="cre-incidence-sub">ingresá los valores</div>';
  }
  html += '</div>';

  // ── Score Compuesto ───────────────────────────────────────────────────────
  html += '<div class="cre-compound" id="cre-sp-compound-' + fIdE + '">';
  var _rizoForComp = (preScore >= 7 && preRizo !== '') ? +preRizo : null;
  var compVal = _creCalcCompound(preScore, _rizoForComp, preTotal !== '' ? +preTotal : null, formulaId, geneticaId, _sp.frasco);
  var compColor = compVal != null ? _creScoreColor(compVal * 10) : 'var(--tx3)';
  var colonStats = _creColonizacionStats(formulaId, geneticaId, _sp.frasco);
  var _rizoRatioDisp = (preRizo !== '' && preTotal !== '' && +preTotal > 0) ? (+preRizo / +preTotal) : null;
  var _effPenaltyDisp = _creEffectivePenalty(colonStats.penalty || 0, _rizoRatioDisp);
  var _formulaDisp = preScore >= 7
    ? (preScore != null ? preScore : '?') + ' × ' + (preTotal !== '' && +preTotal > 0 ? Math.round((+preRizo / +preTotal) * 100) + '%' : '?%')
    : (preScore != null ? preScore : '?') + ' (difuso)';
  html += '<div>'
    + '<div class="cre-compound-label">Score Compuesto</div>'
    + '<div class="cre-compound-formula" id="cre-sp-compound-formula-' + fIdE + '">'
    + _formulaDisp
    + (_effPenaltyDisp > 0 ? ' − ' + _effPenaltyDisp + ' colonizacion' : '')
    + '</div>'
    + '</div>'
    + '<div class="cre-compound-val" style="color:' + compColor + '" id="cre-sp-compound-val-' + fIdE + '">'
    + (compVal != null ? compVal.toFixed(1) : '—')
    + '</div>';
  html += '</div>';

  // ── Acciones ──────────────────────────────────────────────────────────────
  html += '<div style="display:flex;flex-direction:column;gap:6px;margin-top:10px">';
  var nSel = _sp.selected.size;
  var guardarLabel = nSel > 1 ? '✓ Guardar (' + nSel + ')' : '✓ Guardar';
  html += '<button class="clab-btn" id="cre-sp-guardar-' + fIdE + '" onclick="creSubmitScoringPanel(\'' + fIdE + '\',\'' + gIdE + '\')" style="background:var(--ac2);color:var(--bg);border-color:var(--ac2);font-weight:700;width:100%">' + guardarLabel + '</button>';
  if (existingRec && existingRec.observaciones && existingRec.observaciones.length) {
    var _wizObsIdx = existingRec.observaciones.length - 1;
    var _wizEnriched = existingRec.observaciones[_wizObsIdx].enriched;
    html += '<button class="clab-btn clab-btn-sm" onclick="_creWizardOpenModal(\'' + esc(existingRec.id) + '\',' + _wizObsIdx + ')" style="color:var(--ac2);border-color:var(--ac2);width:100%">'
      + (_wizEnriched && _wizEnriched.complete ? '🔬 Re-analizar señales' : '🔬 Analizar señales fenotípicas')
      + '</button>';
  }
  if (existingRec) {
    html += '<button class="clab-btn clab-btn-sm" onclick="creConfirmDeleteSP(this,\'' + esc(existingRec.id) + '\',\'' + fIdE + '\')" style="color:var(--er);border-color:var(--er);width:100%">🗑 Eliminar registro</button>';
  }
  html += '</div>';

  return html;
}

function _creScoringFormHTML(formulaId, geneticaId, fRecs) {
  var html = '';

  // ── Score (Fases se renderiza arriba, en la card — ver _creFasesGridHTML) ──
  html += '<div class="cre-score-fullwidth">';
  html += '<div class="cre-3col-title">Score</div>';
  html += _creScoringScoreTabHTML(formulaId, geneticaId, fRecs);
  html += '</div>';

  // ── Fila inferior: NOTAS (ancho completo) ────────────────────────────────
  html += '<div class="cre-notas-row">';
  html += '<div class="cre-3col-title" style="margin-bottom:8px">Notas</div>';
  html += _creNotasPanelHTML(formulaId, geneticaId);
  html += '</div>';

  return html;
}

// Si la incidencia rizomórfica es alta (≥70%), el exceso de días se perdona proporcionalmente.
// 70% incidencia = sin mitigación; 100% = penalty=0. Lógica: rizo de calidad compensa lentitud.
function _creEffectivePenalty(rawPenalty, rizoRatio) {
  if (!rawPenalty || rawPenalty <= 0) return 0;
  if (rizoRatio != null && rizoRatio >= 0.70) {
    var mitigation = (rizoRatio - 0.70) / 0.30; // 0 en 70%, 1 en 100%
    return +(rawPenalty * (1 - mitigation)).toFixed(2);
  }
  return rawPenalty;
}

function _creCalcCompound(score, rizo, total, formulaId, geneticaId, frascoCtx) {
  if (score == null) return null;
  var rizoRatio = (rizo != null && total != null && total > 0) ? (rizo / total) : null;
  var base = rizoRatio != null ? score * (0.9 + 0.1 * rizoRatio) : score;
  var stats = _creColonizacionStats(formulaId, geneticaId, frascoCtx);
  // Decisión 2026-07-22: la colonización lenta SIEMPRE penaliza, tenga el
  // score que tenga — antes se perdonaba entero con score≥7 ("rizomórfico
  // compensa"), pero un resultado lento sigue costando tiempo real de lab
  // aunque termine rizomórfico. Se atenúa (no se anula) cuando la incidencia
  // rizomórfica es alta: _creEffectivePenalty ya traía esa lógica gradual
  // (perdón progresivo de 70% a 100% de incidencia) pero quedaba
  // inalcanzable en la práctica al estar detrás de este mismo corte binario.
  var penalty = _creEffectivePenalty(stats.penalty || 0, rizoRatio);
  return +Math.max(0, base - penalty).toFixed(1);
}

// ── Handlers globales del scoring panel ─────────────────────────────────────

function creOpenScoringPanel(formulaId) {
  // NO levantar tombstone aquí: fases eliminadas no deben reconstruirse al abrir el panel.
  // El usuario puede registrar fases manualmente. Solo _creReiniciarFases() levanta el tombstone.
  _creFrascoBackfill();    // migración idempotente: asigna frascoId a records legacy si es posible
  _creExtrasBackfill();    // migración idempotente: mergea extras (records sin backfill)
  _creExtrasBackfillV2();  // corrección V2: re-normaliza extras en records sellados con V1 buggy
  _spReset(formulaId);
  // Importar fases de CI → bl2_crec_fases para todas las cepas de esta fórmula.
  // Operación idempotente: solo escribe si el dato no existe ya. CILAB queda autónomo.
  // Si la fórmula tiene experimentos multi-frasco, se importa POR FRASCO (cada uno
  // con su propia key vía frascoCtx) — antes de este fix se importaba una sola vez
  // sin frasco, sembrando la key compartida que contaminaba todos los frascos por igual.
  var _frsForImport = _creGetFrascosForFormula(formulaId);
  if (_frsForImport.length > 0) {
    _frsForImport.forEach(function(fr) {
      var frCtxImport = { expId: fr.expId, frascoLabel: fr.frascoLabel };
      var cepasFr = _creGetCepasForFrasco(formulaId, fr.expId, fr.frascoLabel);
      cepasFr.forEach(function(c) {
        _creAutoFillInoculacion(formulaId, c.id, frCtxImport);
        _creAutoFillColonizacion(formulaId, c.id, frCtxImport);
      });
    });
  } else {
    var _allCepasForImport = _creGetCepasForFormula(formulaId);
    _allCepasForImport.forEach(function(c) {
      _creAutoFillInoculacion(formulaId, c.id);
      _creAutoFillColonizacion(formulaId, c.id);
    });
  }

  // Cuando hay frascos de experimento, arrancar siempre en el primero (preferir el con más actividad).
  // Base no se puntúa — el panel siempre arranca en un frasco de experimento.
  var _frs = _creGetFrascosForFormula(formulaId);
  if (_frs.length > 0) {
    var _openRecs = creRead().filter(function(r) { return r.formulaId === formulaId && r.status === 'cerrado'; });
    var _countByExp = {};
    _openRecs.forEach(function(r) {
      if (!r.experimentoId) return;
      _countByExp[r.experimentoId] = (_countByExp[r.experimentoId] || 0) + 1;
    });
    _sp.frasco = _frs.slice().sort(function(a, b) {
      return (_countByExp[b.expId] || 0) - (_countByExp[a.expId] || 0);
    })[0];
  }

  var grid    = document.getElementById('cre-grid-wrap');
  var detalle = document.getElementById('cre-detalle-wrap');
  if (grid)    grid.style.display    = 'none';
  if (detalle) {
    detalle.style.display = '';
    detalle.innerHTML = _creScoringPanelHTML(formulaId, null);
  }
}

function creCloseScoringPanel() {
  _spReset(null);
  var grid    = document.getElementById('cre-grid-wrap');
  var detalle = document.getElementById('cre-detalle-wrap');
  if (grid)    grid.style.display    = '';
  if (detalle) { detalle.style.display = 'none'; detalle.innerHTML = ''; }
  _creRenderGrid();
}

function creSetScoringCepa(formulaId, geneticaId) {
  var expId       = _sp.frasco ? _sp.frasco.expId       : null;
  var frascoLabel = _sp.frasco ? _sp.frasco.frascoLabel : null;
  var selKey      = _creSPSelKey(expId, frascoLabel, geneticaId);
  var wasEmpty    = _sp.selected.size === 0;
  var wasSelected = _sp.selected.has(selKey);
  var isActive    = geneticaId === _sp.cepaId;
  var needsFormReload = false;

  if (wasSelected) {
    // DESELECT
    _sp.selected.delete(selKey);
    if (isActive) {
      // Active cepa removed — pick next from remaining selection
      var rem = [];
      _sp.selected.forEach(function(k) { rem.push(k.split('|')[2]); });
      if (rem.length > 0) {
        _sp.cepaId    = rem[0];
        needsFormReload = true;
      } else {
        _sp.cepaId = null;
        var fw = document.getElementById('cre-sp-form-' + formulaId);
        if (fw) fw.innerHTML = '';
      }
    }
    // else: deselecting non-active → only tab visuals update below
  } else {
    // SELECT
    _sp.selected.add(selKey);
    if (wasEmpty) {
      // First selection → become active and load form fresh
      _sp.cepaId      = geneticaId;
      _sp.tab       = 'fases';
      needsFormReload = true;
    }
    // else: additional selection → form stays, aggregate plates updated below
  }

  // Update tab visual states
  var tabs = document.getElementById('cre-sptabs-' + formulaId);
  if (tabs) {
    tabs.querySelectorAll('.cre-sp-tab').forEach(function(t) {
      var cId = t.getAttribute('data-cepa-id');
      var sk  = _creSPSelKey(expId, frascoLabel, cId);
      t.classList.toggle('cre-sp-tab--active',   cId === _sp.cepaId);
      t.classList.toggle('cre-sp-tab--selected', _sp.selected.has(sk));
    });
  }

  // Update Guardar button count
  var guardarBtn = document.getElementById('cre-sp-guardar-' + formulaId);
  if (guardarBtn) {
    var n = _sp.selected.size;
    guardarBtn.textContent = n > 1 ? '✓ Guardar (' + n + ')' : '✓ Guardar';
  }

  _creUpdateSelChips(formulaId);

  if (needsFormReload && _sp.cepaId) {
    // Al cambiar cepa activa resetear score/tipo para que el record de la nueva cepa cargue limpio.
    // En multi-select (batch) no resetear: el score elegido aplica a todas las cepas seleccionadas.
    if (!wasEmpty) {
      _sp.score = null;
      _sp.tipo  = null;
    }
    var formWrap = document.getElementById('cre-sp-form-' + formulaId);
    if (formWrap) {
      var records = creRead();
      var fRecs   = _creFRecsForContext(formulaId, records);
      formWrap.innerHTML = _creScoringFormHTML(formulaId, _sp.cepaId, fRecs);
    }
  } else if (!needsFormReload && _sp.selected.size > 0) {
    // Update aggregate plate counts in the existing form without reloading
    var records = creRead();
    var fRecs   = _creFRecsForContext(formulaId, records);
    var totalSum = 0, rizoSum = 0, hasT = false, hasR = false;
    _sp.selected.forEach(function(key) {
      var parts = key.split('|');
      var kExp  = parts[0] || null;
      var kFr   = parts[1] || null;
      var gId   = parts[2];
      var ci = _creGetPlacasFromCI(formulaId, gId, kExp, kFr);
      if (ci != null) { totalSum += ci; hasT = true; }
      else {
        var rec = fRecs.find(function(r) { return r.geneticaId === gId && r.status === 'cerrado'; });
        if (rec && rec.totalPlacas != null) { totalSum += rec.totalPlacas; hasT = true; }
      }
      var rec2 = fRecs.find(function(r) { return r.geneticaId === gId && r.status === 'cerrado'; });
      if (rec2 && rec2.rizoPozitivas != null) { rizoSum += rec2.rizoPozitivas; hasR = true; }
    });
    var totalEl = document.getElementById('cre-sp-total-' + formulaId);
    var rizoEl  = document.getElementById('cre-sp-rizo-'  + formulaId);
    if (totalEl && hasT) { totalEl.value = totalSum; }
    if (rizoEl  && hasR) { rizoEl.value  = rizoSum;  }
    if ((hasT || hasR) && (totalEl || rizoEl)) creUpdateCompound(formulaId);
  }
}

function creSelectScore(n) {
  _sp.score = n;
  var formulaId = _sp.formulaId;
  if (!formulaId) return;
  document.querySelectorAll('.cre-score-btn--ind').forEach(function(btn) {
    btn.classList.remove('active');
    var numEl = btn.querySelector('.csb-num');
    if (!numEl) return;
    var num = parseInt(numEl.textContent, 10);
    if (num === n) {
      btn.classList.add('active');
      btn.style.background = _SCORE_META[n].color + '22';
    } else {
      btn.style.background = '';
    }
  });
  var tipoWrap = document.getElementById('cre-tipo-wrap-ind-' + formulaId);
  if (tipoWrap) tipoWrap.style.display = n >= 7 ? '' : 'none';
  var rizoEl = document.getElementById('cre-sp-rizo-' + formulaId);
  if (rizoEl) {
    if (n >= 7) {
      rizoEl.disabled = false;
      rizoEl.style.opacity = '';
      rizoEl.style.color = 'var(--st-activa)';
      rizoEl.style.borderColor = 'rgba(0,204,51,0.3)';
      rizoEl.placeholder = '0';
    } else {
      rizoEl.disabled = true;
      rizoEl.value = '';
      rizoEl.style.opacity = '0.35';
      rizoEl.style.color = '';
      rizoEl.style.borderColor = '';
      rizoEl.placeholder = 'N/A';
    }
  }
  if (n < 7) { _sp.tipo = null; }
  creUpdateCompound(formulaId);
}

function creSelectTipo(tipo) {
  _sp.tipo = tipo;
  var formulaId = _sp.formulaId;
  if (!formulaId) return;
  var tipoWrap = document.getElementById('cre-tipo-wrap-ind-' + formulaId);
  if (!tipoWrap) return;
  tipoWrap.querySelectorAll('.cre-tipo-btn--ind').forEach(function(btn) {
    btn.classList.remove('active');
    if (btn.classList.contains('cre-tipo-btn--' + tipo)) btn.classList.add('active');
  });
}

function creUpdateCompound(formulaId) {
  var totalEl = document.getElementById('cre-sp-total-' + formulaId);
  var rizoEl  = document.getElementById('cre-sp-rizo-'  + formulaId);
  var pctEl   = document.getElementById('cre-sp-pct-'   + formulaId);
  var cmpEl   = document.getElementById('cre-sp-compound-val-'     + formulaId);
  var cmpFEl  = document.getElementById('cre-sp-compound-formula-' + formulaId);
  if (!totalEl || !rizoEl) return;

  var total = parseInt(totalEl.value, 10);
  var rizo  = parseInt(rizoEl.value,  10);
  var score = _sp.score;

  // ── Invariante estricto: 0 ≤ rizo ≤ total ───────────────────────────
  if (!isNaN(total) && total > 0) {
    if (!isNaN(rizo) && rizo < 0)     { rizo = 0;     rizoEl.value = 0; }
    if (!isNaN(rizo) && rizo > total) { rizo = total;  rizoEl.value = total; }
  }

  if (pctEl) {
    if (score != null && score < 7) {
      pctEl.innerHTML = '<div class="cre-incidence-pct" style="color:var(--tx3)">N/A</div>'
        + '<div class="cre-incidence-sub">difuso / tormentoso</div>';
    } else if (!isNaN(total) && total > 0 && !isNaN(rizo)) {
      var pct = Math.min(100, Math.round((rizo / total) * 100));
      pctEl.innerHTML = '<div class="cre-incidence-pct">' + pct + '%</div>'
        + '<div class="cre-incidence-sub">' + rizo + ' de ' + total + ' placas</div>';
    } else {
      pctEl.innerHTML = '<div class="cre-incidence-pct" style="color:var(--tx3)">—%</div>'
        + '<div class="cre-incidence-sub">ingresá los valores</div>';
    }
  }

  var rizoApplies = score != null && score >= 7;
  var rizoVal = (rizoApplies && !isNaN(rizo)) ? rizo : null;
  var comp = _creCalcCompound(score, rizoVal, !isNaN(total) && total > 0 ? total : null, formulaId, _sp.cepaId, _sp.frasco);
  var compColor = comp != null ? _creScoreColor(comp * 10) : 'var(--tx3)';
  if (cmpEl) {
    cmpEl.textContent = comp != null ? comp.toFixed(1) : '—';
    cmpEl.style.color = compColor;
  }
  if (cmpFEl) {
    var pctStr = (rizoApplies && !isNaN(total) && total > 0 && !isNaN(rizo)) ? Math.round((rizo/total)*100) + '%' : (rizoApplies ? '?%' : 'N/A');
    var stats = _creColonizacionStats(formulaId, _sp.cepaId, _sp.frasco);
    var _rizoRatioLive = (rizoApplies && !isNaN(total) && total > 0 && !isNaN(rizo)) ? (rizo/total) : null;
    var _effPenaltyLive = _creEffectivePenalty(stats.penalty || 0, _rizoRatioLive);
    var _penaltyStr = _effPenaltyLive > 0 ? ' − ' + _effPenaltyLive + ' colonizacion' : '';
    cmpFEl.textContent = rizoApplies
      ? (score || '?') + ' × ' + pctStr + _penaltyStr
      : (score || '?') + ' (difuso)' + _penaltyStr;
  }
}

function creSubmitScoringPanel(formulaId) {
  var fIdE     = esc(formulaId);
  var hasInd   = !!_sp.expandedCepaId;
  var hasBatch = _sp.selected.size > 0;

  if (!hasInd && !hasBatch) { notif('Expandí una cepa para puntuar o seleccioná varias con los checkboxes', 'err'); return; }

  // ── Validate individual ────────────────────────────────────────────────
  var indScore = _sp.score;
  var indTotal = NaN, indRizo = NaN;
  if (hasInd) {
    if (!indScore || indScore < 1 || indScore > 10) { notif('Seleccioná un score (1–10) para la cepa individual', 'err'); return; }
    var indTotalEl = document.getElementById('cre-sp-total-' + fIdE);
    var indRizoEl  = document.getElementById('cre-sp-rizo-'  + fIdE);
    if (indTotalEl) indTotal = parseInt(indTotalEl.value, 10);
    if (indRizoEl)  indRizo  = parseInt(indRizoEl.value,  10);
    if (!isNaN(indTotal) && !isNaN(indRizo) && indRizo > indTotal) { notif('Rizo no puede superar el total (cepa individual)', 'err'); return; }
  }

  // ── Validate batch ─────────────────────────────────────────────────────
  var batScore = _sp.batchScore;
  var batTotal = NaN, batRizo = NaN;
  if (hasBatch) {
    if (!batScore || batScore < 1 || batScore > 10) { notif('Seleccioná un score (1–10) para el batch', 'err'); return; }
    var batTotalEl = document.getElementById('cre-bat-total-' + fIdE);
    var batRizoEl  = document.getElementById('cre-bat-rizo-'  + fIdE);
    if (batTotalEl) batTotal = parseInt(batTotalEl.value, 10);
    if (batRizoEl)  batRizo  = parseInt(batRizoEl.value,  10);
    if (!isNaN(batTotal) && !isNaN(batRizo) && batRizo > batTotal) { notif('Rizo no puede superar el total (batch)', 'err'); return; }
  }

  var allFrascos  = _creGetFrascosForFormula(formulaId);
  var allGenetics = creReadGenetics();
  var saved = 0, errors = 0;
  var allTargetsForLog = [];

  // ── Helper: save one target ────────────────────────────────────────────
  function _saveTarget(tgt) {
    var gId = tgt.geneticaId;
    if (!gId) return;
    var frCtx = null;
    if (tgt.expId) {
      frCtx = allFrascos.find(function(f) { return f.expId === tgt.expId && f.frascoLabel === tgt.frascoLabel; }) || null;
    }
    var snap = frCtx ? creGetSnapshotWithExtras(formulaId, frCtx) : creGetFormulaSnapshot(formulaId);
    if (frCtx && snap) snap = Object.assign({}, snap, { nombre: snap.nombre + ' · Frasco ' + frCtx.frascoLabel });
    if (!snap) { errors++; return; }
    var gObj       = allGenetics.find(function(g) { return g.id === gId; });
    var compScore  = _creCalcCompound(tgt.score, !isNaN(tgt.rizo) ? tgt.rizo : null, !isNaN(tgt.total) && tgt.total > 0 ? tgt.total : null, formulaId, gId, frCtx);
    var colonStats = _creColonizacionStats(formulaId, gId, frCtx);
    var args = { formulaId: formulaId, formulaSnapshot: snap, geneticaId: gId, geneticaLabel: gObj ? gObj.label : gId };
    if (tgt.expId) {
      // Siempre propagar el contexto de frasco aunque frCtx no se haya encontrado en allFrascos.
      // Evita que un record se grabe silenciosamente en contexto base cuando el usuario está en tab frasco.
      args.experimentoId = tgt.expId;
      args.frascoId      = tgt.frascoLabel;   // label como discriminador (frascos no tienen id)
    }
    try {
      var rec = creCreate(args);
      var obs = {
        tipo: 'definitiva', dia: 0, fecha: new Date().toISOString().slice(0, 10),
        scoreObservado: compScore != null ? compScore : tgt.score,
        calidadScore: tgt.score, scoreCompuesto: compScore,
        colonizacionDias: colonStats.dias,
        colonizacionPenalty: _creEffectivePenalty(colonStats.penalty || 0, !isNaN(tgt.rizo) && !isNaN(tgt.total) && tgt.total > 0 ? tgt.rizo / tgt.total : null),
        notasMorf: '', notas: '', tipoCordon: tgt.tipo || null,
      };
      if (!isNaN(tgt.total) && tgt.total > 0) obs.totalPlacas   = tgt.total;
      if (!isNaN(tgt.rizo)  && tgt.rizo  >= 0) obs.rizoPozitivas = tgt.rizo;
      var updated = creAddObs(rec.id, obs);
      if (!updated) { errors++; return; }
      if (!isNaN(tgt.total) && tgt.total > 0) _creUpdateRizoData(rec.id, !isNaN(tgt.rizo) ? tgt.rizo : null, tgt.total, '');
      saved++;
      allTargetsForLog.push({ gId: gId, gLabel: gObj ? gObj.label : gId, score: tgt.score, rizo: tgt.rizo, total: tgt.total, tipo: tgt.tipo, compScore: compScore, isInd: tgt.isInd });
    } catch(e) { errors++; }
  }

  // ── Individual target ──────────────────────────────────────────────────
  if (hasInd) {
    _saveTarget({
      expId:       _sp.frasco ? _sp.frasco.expId       : null,
      frascoLabel: _sp.frasco ? _sp.frasco.frascoLabel : null,
      geneticaId:  _sp.expandedCepaId,
      score: indScore, total: indTotal, rizo: indRizo, tipo: _sp.tipo, isInd: true,
    });
  }

  // ── Batch targets ──────────────────────────────────────────────────────
  if (hasBatch) {
    var aggCITotal = 0;
    _sp.selected.forEach(function(key) {
      var parts = key.split('|');
      var ci = _creGetPlacasFromCI(formulaId, parts[2], parts[0] || null, parts[1] || null);
      if (ci != null) aggCITotal += ci;
    });
    _sp.selected.forEach(function(key) {
      var parts = key.split('|');
      var kExp = parts[0] || null; var kFr = parts[1] || null; var gId = parts[2];
      var cePlacas = _creGetPlacasFromCI(formulaId, gId, kExp, kFr);
      var ceRizo = NaN;
      if (!isNaN(batRizo)) {
        ceRizo = (aggCITotal > 0 && cePlacas != null) ? Math.round(batRizo * cePlacas / aggCITotal) : batRizo;
      }
      var ceTotal = cePlacas != null ? cePlacas : (!isNaN(batTotal) ? Math.round(batTotal / _sp.selected.size) : NaN);
      _saveTarget({ expId: kExp, frascoLabel: kFr, geneticaId: gId, score: batScore, total: ceTotal, rizo: ceRizo, tipo: _sp.batchTipo, isInd: false });
    });
  }

  // ── Log entries ────────────────────────────────────────────────────────
  if (saved > 0) {
    // Construir contexto de frasco para el log: incluye label display + ids para filtrado.
    var _logFrascoCtx = null;
    if (_sp.frasco) {
      var _logIngs = typeof readIngredientes === 'function' ? readIngredientes() : [];
      var _logExtras = _sp.frasco.extras && _sp.frasco.extras.length
        ? _sp.frasco.extras.map(function(ex) {
            var ing = _logIngs.find(function(i) { return i.id === ex.ingId; });
            return ing ? ing.nombre : ex.ingId;
          }).join('+')
        : 'Control';
      _logFrascoCtx = {
        label:         'Frasco ' + _sp.frasco.frascoLabel + ' · ' + _logExtras,
        experimentoId: _sp.frasco.expId,
        frascoId:      _sp.frasco.frascoId,
      };
    }
    var indLog = allTargetsForLog.filter(function(t) { return t.isInd; });
    if (indLog.length) {
      var l = indLog[0];
      _creLogScore(formulaId, [{ gId: l.gId, gLabel: l.gLabel }], l.score, l.compScore, l.score >= 7, l.total, l.rizo, l.tipo || null, _logFrascoCtx);
    }
    var batLog = allTargetsForLog.filter(function(t) { return !t.isInd; });
    if (batLog.length) {
      _creLogScore(formulaId, batLog.map(function(t) { return { gId: t.gId, gLabel: t.gLabel }; }), batScore, null, batScore >= 7, batTotal, batRizo, _sp.batchTipo || null, _logFrascoCtx);
    }
  }

  if (errors && !saved) { notif('Error al guardar', 'err'); return; }

  var msg = saved + ' cepa' + (saved > 1 ? 's' : '') + ' puntuada' + (saved > 1 ? 's' : '') + ' ✓';
  if (errors) msg += ' · ' + errors + ' error(es)';
  notif(msg, errors ? 'warn' : 'ok');

  // Reset state
  _sp.expandedCepaId = null;
  _sp.faseEditOpen   = null;
  _sp.batchScore     = null;
  _sp.batchTipo      = null;
  _sp.selected       = new Set();
  _sp.score          = null;
  _sp.tipo           = null;

  // Stay in panel — re-render cepa cards (formula context stays visible)
  var detalle = document.getElementById('cre-detalle-wrap');
  if (detalle) detalle.innerHTML = _creScoringPanelHTML(formulaId, null);
}


function creDeleteAndRefreshSP(creId, formulaId) {
  if (!creDeleteEnsayo(creId)) return;
  creCloseScoringPanel();
}

// ── Handlers globales de notas de trazabilidad ────────────────────────────

function creNotaEnviar(formulaId, geneticaId) {
  var inputKey = formulaId + '__' + (geneticaId || '_');
  var inp = document.getElementById('cre-notas-input-' + inputKey);
  if (!inp) return;
  var texto = inp.value.trim();
  if (!texto) return;

  // ── Fase context — temporal zone inference ───────────────────────────────
  var faseId = null, faseLabel = null, dia = null;
  if (geneticaId) {
    var ctxZone = _creTemporalZoneFase(formulaId, geneticaId, _sp.frasco);
    faseId    = ctxZone.def.id;
    faseLabel = ctxZone.def.label;
    dia       = ctxZone.dia != null ? ctxZone.dia : 0;
  }

  // ── Selected cepas ────────────────────────────────────────────────────────
  var allGenetics  = creReadGenetics();
  var targetGIds   = [];
  var cepaLabels   = [];
  if (_sp.selected && _sp.selected.size > 1) {
    _sp.selected.forEach(function(selKey) {
      var gId = selKey.split('|')[2];
      if (!gId) return;
      targetGIds.push(gId);
      var g = allGenetics.find(function(x) { return x.id === gId; });
      cepaLabels.push(_creAbrevEspecie(g ? g.label : gId));
    });
  } else {
    targetGIds.push(geneticaId);
    var singleG = allGenetics.find(function(x) { return x.id === geneticaId; });
    cepaLabels.push(_creAbrevEspecie(singleG ? singleG.label : (geneticaId || '')));
  }

  // ── Build structured note ─────────────────────────────────────────────────
  var nota = {
    id:          'n' + Date.now(),
    texto:       texto,
    ts:          new Date().toISOString(),
    fase:        faseId,
    faseLabel:   faseLabel,
    dia:         dia,
    cepaIds:     targetGIds.slice(),
    cepaLabels:  cepaLabels.slice(),
  };

  // ── Save to all target cepas ──────────────────────────────────────────────
  targetGIds.forEach(function(gId) {
    var notas = _creNotasRead(formulaId, gId);
    notas.push(nota);
    _creNotasWrite(formulaId, gId, notas);
  });

  inp.value = '';

  // Refresh panel for active cepa display
  var panel = document.getElementById('cre-notas-panel-' + inputKey);
  if (panel) panel.outerHTML = _creNotasPanelHTML(formulaId, geneticaId);
}

function creSelectSPTab(formulaId, geneticaId, tab) {
  _sp.tab = tab;
  var records = creRead();
  var fRecs   = records.filter(function(r) { return r.formulaId === formulaId; });
  var formWrap = document.getElementById('cre-sp-form-' + formulaId);
  if (formWrap) formWrap.innerHTML = _creScoringFormHTML(formulaId, geneticaId, fRecs);
}

function _creFaseRegisterNow(formulaId, geneticaId, faseId) {
  _creLiftCleared(formulaId);
  var fases    = _creFasesRead(formulaId, geneticaId, _sp.frasco);
  var todayIso = _creHoyISO();
  var tsNow    = now();

  var entry;
  if (faseId === 'inoculacion') {
    entry = { fase: 'inoculacion', dia: 0, fecha: todayIso, ts: tsNow, auto: false };
  } else {
    var inocDate = _creInoculacionDate(formulaId, geneticaId, _sp.frasco);
    var dia = 0;
    if (inocDate) {
      var d0 = new Date(inocDate); d0.setHours(0, 0, 0, 0);
      var d1 = new Date(todayIso); d1.setHours(0, 0, 0, 0);
      dia = Math.max(0, Math.floor((d1 - d0) / 86400000));
    }
    entry = { fase: faseId, dia: dia, fecha: todayIso, ts: tsNow };
    if (faseId !== 'colonizacion_completa') {
      var _fCtxR = _sp.frasco;
      entry.placasObservadas = null;
      entry.totalPlacas = _creGetPlacasFromCI(formulaId, geneticaId, _fCtxR ? _fCtxR.expId : null, _fCtxR ? _fCtxR.frascoLabel : null);
    }
  }

  var order = _FASES_DEF.map(function(f) { return f.id; });
  fases = fases.filter(function(f) { return f.fase !== faseId; });
  fases.push(entry);
  fases.sort(function(a, b) { return order.indexOf(a.fase) - order.indexOf(b.fase); });
  _creFasesWrite(formulaId, geneticaId, fases, _sp.frasco);
  _creLogFase(formulaId, geneticaId, faseId, entry.dia, entry.fecha, false, _sp.frasco);

  if (faseId === 'colonizacion_completa') {
    _creSyncColonizacionToCI(formulaId, geneticaId, entry.fecha);
    setTimeout(function() { creColonizacionCierrePrompt(formulaId, geneticaId, entry.dia); }, 80);
  }

  notif('Fase registrada · Día ' + entry.dia, 'info');
  _creRenderCepasSection(formulaId);
}

function creFaseEditCancel(formulaId, geneticaId) {
  _sp.faseEditOpen = null;
  _creRenderCepasSection(formulaId);
}

function creFaseEditSave(formulaId, geneticaId, faseId) {
  var fechaEl  = document.getElementById('cre-fase-edit-fecha-' + faseId);
  var horaEl   = document.getElementById('cre-fase-edit-hora-' + faseId);
  var placasEl = document.getElementById('cre-fase-edit-placas-' + faseId);
  if (!fechaEl || !fechaEl.value) return;

  var fechaStr = fechaEl.value;
  var horaStr  = (horaEl && horaEl.value) ? horaEl.value : '00:00';
  var tsNew    = new Date(fechaStr + 'T' + horaStr + ':00').toISOString();

  var fases = _creFasesRead(formulaId, geneticaId, _sp.frasco);
  var reg = fases.find(function(f) { return f.fase === faseId; });
  if (!reg) return;

  if (faseId === 'inoculacion') {
    var d0new = new Date(fechaStr); d0new.setHours(0, 0, 0, 0);
    fases.forEach(function(f) {
      if (f.fase === 'inoculacion') {
        f.fecha = fechaStr; f.ts = tsNew; f.dia = 0; delete f.auto;
      } else if (f.fecha) {
        var df = new Date(f.fecha); df.setHours(0, 0, 0, 0);
        f.dia = Math.max(0, Math.floor((df - d0new) / 86400000));
      }
    });
  } else {
    var inocDate = _creInoculacionDate(formulaId, geneticaId, _sp.frasco);
    var dia = 0;
    if (inocDate) {
      var d0 = new Date(inocDate); d0.setHours(0, 0, 0, 0);
      var d1 = new Date(fechaStr); d1.setHours(0, 0, 0, 0);
      dia = Math.max(0, Math.floor((d1 - d0) / 86400000));
    }
    reg.fecha = fechaStr;
    reg.ts    = tsNew;
    reg.dia   = dia;
    delete reg.auto; // una corrección manual reemplaza cualquier origen previo (CI o inferido)
    if (placasEl && placasEl.value !== '') reg.placasObservadas = parseInt(placasEl.value, 10);
  }

  _creFasesWrite(formulaId, geneticaId, fases, _sp.frasco);
  var edited = fases.find(function(f) { return f.fase === faseId; });
  _creLogFase(formulaId, geneticaId, faseId, edited ? edited.dia : 0, edited ? edited.fecha : fechaStr, true, _sp.frasco);

  if (faseId === 'colonizacion_completa') {
    _creSyncColonizacionToCI(formulaId, geneticaId, fechaStr);
  }

  notif('Fecha calibrada · Día ' + (edited ? edited.dia : 0), 'info');
  _sp.faseEditOpen = null;
  _creRenderCepasSection(formulaId);
}

function creFaseDeleteConfirm(formulaId, geneticaId, faseId) {
  if (!confirm('¿Eliminar esta fase? Esta acción no se puede deshacer.')) return;
  var fases = _creFasesRead(formulaId, geneticaId, _sp.frasco).filter(function(f) { return f.fase !== faseId; });
  _creFasesWrite(formulaId, geneticaId, fases, _sp.frasco);
  var notas = _creNotasRead(formulaId, geneticaId).filter(function(n) {
    return !(n.auto && n.logType === 'fase' && n.faseId === faseId);
  });
  _creNotasWrite(formulaId, geneticaId, notas);
  notif('Fase eliminada', 'info');
  _sp.faseEditOpen = null;
  _creRenderCepasSection(formulaId);
  if (_sp.formulaId) _creRenderLogSection(_sp.formulaId);
}

function _creFaseEditStripHTML(formulaId, geneticaId, faseId) {
  var fases = _creFasesRead(formulaId, geneticaId, _sp.frasco);
  var reg = fases.find(function(f) { return f.fase === faseId; });
  if (!reg) return '';
  var def = _FASES_DEF.find(function(f) { return f.id === faseId; });
  var faseIdE = esc(faseId);

  // .slice(0,10): mismo motivo que en _creFasesGridHTML — registros viejos pueden tener
  // "YYYY-MM-DDTHH:MM" en vez de "YYYY-MM-DD"; un <input type="date"> con eso queda vacío.
  var fechaVal = (reg.fecha ? reg.fecha.slice(0, 10) : null) || _creHoyISO();
  var horaVal  = '00:00';
  if (reg.ts) {
    var dt = new Date(reg.ts);
    horaVal = String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0');
  }
  var showPlacas = faseId !== 'inoculacion' && faseId !== 'colonizacion_completa';

  var html = '<div class="cre-fase-edit-strip">';
  html += '<div class="cre-fase-edit-title">✎ ' + esc(def ? def.label : faseId) + '</div>';
  html += '<div class="cre-fase-edit-row"><label>Fecha</label><input type="date" id="cre-fase-edit-fecha-' + faseIdE + '" value="' + fechaVal + '"></div>';
  html += '<div class="cre-fase-edit-row"><label>Hora</label><input type="time" id="cre-fase-edit-hora-' + faseIdE + '" value="' + horaVal + '"></div>';
  if (showPlacas) {
    html += '<div class="cre-fase-edit-row"><label>Placas obs. (opcional)</label>'
      + '<input type="number" min="0" max="999" id="cre-fase-edit-placas-' + faseIdE + '" value="' + (reg.placasObservadas != null ? reg.placasObservadas : '') + '" placeholder="—"></div>';
  }
  html += '<div class="cre-fase-edit-actions">'
    + '<button class="clab-btn clab-btn-sm" style="background:var(--ac2);color:var(--bg);border-color:var(--ac2)" onclick="creFaseEditSave(\'' + esc(formulaId) + '\',\'' + esc(geneticaId) + '\',\'' + faseIdE + '\')">Guardar</button>'
    + '<button class="clab-btn clab-btn-sm" onclick="creFaseEditCancel(\'' + esc(formulaId) + '\',\'' + esc(geneticaId) + '\')">Cancelar</button>';
  if (faseId !== 'inoculacion') {
    html += '<button class="clab-btn clab-btn-sm" style="color:var(--er,#e74c3c);border-color:var(--er,#e74c3c);margin-left:auto" onclick="creFaseDeleteConfirm(\'' + esc(formulaId) + '\',\'' + esc(geneticaId) + '\',\'' + faseIdE + '\')">🗑 Eliminar</button>';
  }
  html += '</div></div>';
  return html;
}

function _creFasesGridHTML(formulaId, geneticaId) {
  if (!geneticaId) return '<div style="padding:16px;color:var(--tx3);font-size:12px">Seleccioná una cepa.</div>';

  _creAutoFillInoculacion(formulaId, geneticaId, _sp.frasco);
  _creAutoFillColonizacion(formulaId, geneticaId, _sp.frasco);
  _creAutoFillInferredFases(formulaId, geneticaId, _sp.frasco);

  var fases  = _creFasesRead(formulaId, geneticaId, _sp.frasco);
  var regMap = {};
  fases.forEach(function(f) { regMap[f.fase] = f; });
  var diasAct = _creDiasSinceInoc(formulaId, geneticaId, _sp.frasco);
  var fIdE = esc(formulaId);
  var gIdE = esc(geneticaId);

  var html = '<div class="cre-fase-grid-wrap">';
  html += '<div class="cre-3col-title">Fases <span class="cre-3col-count">' + fases.length + '/' + _FASES_DEF.length + '</span>'
    + (diasAct != null ? '<span class="cre-fase-hoy">Día ' + diasAct + '</span>' : '') + '</div>';

  html += '<div class="cre-fase-grid">';
  _FASES_DEF.forEach(function(def) {
    var reg = regMap[def.id];
    var isDone     = !!reg && reg.auto !== 'inferred';
    var isInferred = !!reg && reg.auto === 'inferred';
    var faseIdE = esc(def.id);
    var cls = 'cre-fase-chip' + (isDone ? ' cre-fase-chip--done' : isInferred ? ' cre-fase-chip--inferred' : ' cre-fase-chip--pending');
    var style = isDone ? 'background:' + def.color + '22;border-color:' + def.color + ';color:' + def.color + ';' : '';
    var horaStr = '';
    if (isDone && reg.ts) {
      var dt = new Date(reg.ts);
      horaStr = String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0');
    }
    var fechaFmt = '';
    if (isDone && reg.fecha) {
      // .slice(0,10) primero: algunos registros viejos (form datetime-local ya eliminado)
      // quedaron con fecha tipo "2026-07-08T00:59" en vez de "2026-07-08" — sin este corte
      // el split('-') rompe el día ("08T00:59"). Formato pedido: DD/MM/YYYY.
      var dd = reg.fecha.slice(0, 10).split('-');
      fechaFmt = dd[2] + '/' + dd[1] + '/' + dd[0];
    }
    html += '<div class="' + cls + '" style="' + style + '" onclick="creFaseGridClick(\'' + fIdE + '\',\'' + gIdE + '\',\'' + faseIdE + '\')">'
      + '<div class="cre-fase-chip-name">' + esc(def.label) + (isDone && reg.auto === true ? '<span class="cre-fase-chip-auto">CI</span>' : '') + '</div>'
      + (isDone
          ? '<div class="cre-fase-chip-meta">Día ' + reg.dia + ' · ' + fechaFmt + (horaStr ? ' ' + horaStr : '') + '</div>'
          : '<div class="cre-fase-chip-meta cre-fase-chip-meta--pending">' + (isInferred ? '~día ' + reg.dia : 'típ. día ' + def.typicalDay) + '</div>')
      + '</div>';
  });
  html += '</div>';

  if (_sp.faseEditOpen) {
    html += _creFaseEditStripHTML(formulaId, geneticaId, _sp.faseEditOpen);
  }

  html += '</div>';
  return html;
}

function creFaseGridClick(formulaId, geneticaId, faseId) {
  var fases = _creFasesRead(formulaId, geneticaId, _sp.frasco);
  var reg = fases.find(function(f) { return f.fase === faseId; });
  if (!reg || reg.auto === 'inferred') {
    _sp.faseEditOpen = null;
    _creFaseRegisterNow(formulaId, geneticaId, faseId); // re-renderiza internamente
  } else {
    _sp.faseEditOpen = (_sp.faseEditOpen === faseId) ? null : faseId;
    _creRenderCepasSection(formulaId);
  }
}

function _creBatchFaseRegisterNow(formulaId, faseId, fechaOverride, horaOverride) {
  var order    = _FASES_DEF.map(function(f) { return f.id; });
  // fechaOverride/horaOverride: cargados desde los inputs del confirm bar (pedido del
  // usuario, 2026-07-23) — si vienen vacíos, se comporta como antes ("ahora").
  var todayIso = fechaOverride || _creHoyISO();
  var tsNow    = horaOverride ? new Date(todayIso + 'T' + horaOverride + ':00').toISOString() : now();
  var saved    = 0;
  var colonizGIds = []; // cepas que efectivamente registraron colonizacion_completa en esta llamada (no las salteadas)

  _sp.selected.forEach(function(key) {
    // frCtx se resuelve desde la propia key seleccionada (expId|frascoLabel|geneticaId), no
    // desde _sp.frasco: hoy es equivalente porque creSetScoringFrasco limpia _sp.selected en
    // cada cambio de tab, pero si esa invariante cambia a futuro, leer de la key evita atribuir
    // en silencio una fase al frasco equivocado (mismo criterio defensivo que _saveTarget).
    var parts = key.split('|');
    var kExp  = parts[0] || null;
    var kFr   = parts[1] || null;
    var gId   = parts[2];
    if (!gId) return;
    var frCtx = kExp ? { expId: kExp, frascoLabel: kFr } : null;
    var fases    = _creFasesRead(formulaId, gId, frCtx);
    var already  = fases.find(function(f) { return f.fase === faseId; });
    if (already && already.auto !== 'inferred') return; // ya registrada — batch no sobreescribe (protege el ancla de inoculación y evita perder una fecha real ya cargada)
    var inocDate = _creInoculacionDate(formulaId, gId, frCtx);
    var dia = 0;
    if (inocDate) {
      var d0 = new Date(inocDate); d0.setHours(0, 0, 0, 0);
      var d1 = new Date(todayIso); d1.setHours(0, 0, 0, 0);
      dia = Math.max(0, Math.floor((d1 - d0) / 86400000));
    }
    var entry = { fase: faseId, dia: dia, fecha: todayIso, ts: tsNow };
    if (faseId !== 'inoculacion' && faseId !== 'colonizacion_completa') {
      var _fCtxB = frCtx;
      entry.placasObservadas = null;
      entry.totalPlacas = _creGetPlacasFromCI(formulaId, gId, _fCtxB ? _fCtxB.expId : null, _fCtxB ? _fCtxB.frascoLabel : null);
    }
    fases = fases.filter(function(f) { return f.fase !== faseId; });
    fases.push(entry);
    fases.sort(function(a, b) { return order.indexOf(a.fase) - order.indexOf(b.fase); });
    _creFasesWrite(formulaId, gId, fases, frCtx);
    _creLogFase(formulaId, gId, faseId, dia, todayIso, false, frCtx);
    if (faseId === 'colonizacion_completa') {
      _creSyncColonizacionToCI(formulaId, gId, todayIso);
      colonizGIds.push(gId);
    }
    saved++;
  });

  _sp.batchFasePos[faseId] = true;
  notif('Fase registrada en ' + saved + ' cepas', 'info');
  _creRenderCepasSection(formulaId);
  if (_sp.formulaId) _creRenderLogSection(_sp.formulaId);
  // Bug encontrado en revisión final (2026-07-23): el sync a CI ya funcionaba en batch,
  // pero nunca se ofrecía "cerrar ciclo → GR" — solo el flujo individual llamaba al prompt.
  if (colonizGIds.length > 0) {
    setTimeout(function() { creColonizacionCierrePromptBatch(formulaId, colonizGIds); }, 80);
  }
}

function _creBatchControlsRerender(formulaId) {
  var bw = document.getElementById('cre-batch-controls-' + esc(formulaId));
  if (bw) bw.innerHTML = _creBatchControlsHTML(formulaId);
}

function _creBatchFasesGridHTML(formulaId) {
  var fIdE     = esc(formulaId);
  var savedPos = _sp.batchFasePos || {};
  var html = '<div class="cre-fase-grid-wrap" style="margin-top:10px">';
  html += '<div class="cre-3col-title">Registrar fase en batch <span class="cre-3col-count">' + _sp.selected.size + ' cepas</span></div>';
  html += '<div class="cre-fase-grid">';
  _FASES_DEF.forEach(function(def) {
    if (def.id === 'inoculacion') return; // ver nota Task 7: inoculación no se batch-registra, es por-cepa / CI
    var faseIdE  = esc(def.id);
    var isStaged = _sp.batchStagedFase && _sp.batchStagedFase.faseId === def.id;
    var isDone   = !!savedPos[def.id];
    var cls   = 'cre-fase-chip' + (isDone ? ' cre-fase-chip--done' : isStaged ? ' cre-fase-chip--staged' : ' cre-fase-chip--pending');
    var style = isDone ? 'background:' + def.color + '22;border-color:' + def.color + ';color:' + def.color + ';' : '';
    html += '<div class="' + cls + '" style="' + style + '" onclick="creFaseGridBatchClick(\'' + fIdE + '\',\'' + faseIdE + '\')">'
      + '<div class="cre-fase-chip-name">' + esc(def.label) + '</div>'
      + '<div class="cre-fase-chip-meta' + (isDone ? '' : ' cre-fase-chip-meta--pending') + '">'
      + (isDone ? 'registrada ahora' : isStaged ? 'pendiente de confirmar' : 'click = marcar ahora')
      + '</div></div>';
  });
  html += '</div></div>';
  return html;
}

function creFaseGridBatchClick(formulaId, faseId) {
  _sp.batchStagedFase = { faseId: faseId };
  _creBatchControlsRerender(formulaId);
}

// ── Prompt de cierre de ciclo tras colonización ──────────────────────────────

function creColonizacionCierrePrompt(formulaId, geneticaId, diasColonizacion) {
  var fIdE = esc(formulaId);
  var gIdE = esc(geneticaId);
  // Bug preexistente encontrado en la revisión final del plan del grid de fases (2026-07-23):
  // apuntaba a 'cre-sp-form-'+formulaId y a '.cre-3col-layout', ninguno de los dos existe en el
  // markup real de _creScoringPanelHTML (nunca existieron con esos nombres/estructura) — el
  // prompt nunca se mostraba, era un no-op silencioso. 'cre-cepa-cards-'+formulaId sí es un
  // contenedor real y estable (ver _creScoringPanelHTML).
  var cardsWrap = document.getElementById('cre-cepa-cards-' + formulaId);
  if (!cardsWrap) return;
  var old = document.querySelector('.cre-coloniz-prompt');
  if (old) old.remove();
  var div = document.createElement('div');
  div.className = 'cre-coloniz-prompt';
  div.innerHTML = '<div class="cre-coloniz-icon">🌿</div>'
    + '<div>'
    + '<div class="cre-coloniz-title">Colonización completa registrada</div>'
    + '<div class="cre-coloniz-info">Esta cepa tardó <strong style="color:var(--ac2)">' + diasColonizacion + ' días</strong> en colonizar.</div>'
    + '<div class="cre-coloniz-question">¿Cerrar el ciclo de expansión y pasar a GR?</div>'
    + '</div>'
    + '<div class="cre-coloniz-actions">'
    + '<button class="clab-btn" onclick="creColonizacionCerrarCiclo(\'' + fIdE + '\',\'' + gIdE + '\')" style="background:var(--ac2);color:var(--bg);border-color:var(--ac2);font-weight:700">✓ Cerrar ciclo → GR</button>'
    + '<button class="clab-btn clab-btn-sm" onclick="this.closest(\'.cre-coloniz-prompt\').remove()" style="color:var(--tx3)">Mantener abierto</button>'
    + '</div>';
  cardsWrap.before(div);
}

function creColonizacionCerrarCiclo(formulaId, geneticaId) {
  var prompt = document.querySelector('.cre-coloniz-prompt');
  if (prompt) prompt.remove();

  // Trazabilidad
  var notaTxt = '✅ Ciclo cerrado -> Se activa en GR';
  _creWriteAutoNota(formulaId, notaTxt, 'green', null);
  _creNotasWrite(formulaId, geneticaId, _creNotasRead(formulaId, geneticaId).concat([
    { id: 'cciclo-' + Date.now(), ts: (function(){ var d=new Date(); return d.getDate()+'/'+(d.getMonth()+1)+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); })(), texto: notaTxt, auto: true }
  ]));

  // Publicar a Cultivos CI inmediatamente
  if (typeof window._ciSyncCultivosFromSeg === 'function') {
    try { window._ciSyncCultivosFromSeg(formulaId); } catch(e) {}
  }

  notif('✅ Ciclo cerrado — se activa en GR', 'ok');
}

// ── Prompt de cierre de ciclo — batch (2026-07-23) ───────────────────────────
// El flujo individual (arriba) ya sincronizaba a CI pero nunca ofrecía "cerrar
// ciclo" en modo batch (varias cepas a la vez) — encontrado en la revisión
// final del plan del grid de fases. `_creBatchColonizPending` es estado
// transitorio (no forma parte de `_sp`, se limpia apenas se usa) porque el
// botón del prompt no puede llevar un array completo de geneticaIds en el
// atributo onclick.
var _creBatchColonizPending = null; // { formulaId, geneticaIds } | null

function creColonizacionCierrePromptBatch(formulaId, geneticaIds) {
  var cardsWrap = document.getElementById('cre-cepa-cards-' + formulaId);
  if (!cardsWrap || !geneticaIds || !geneticaIds.length) return;
  var old = document.querySelector('.cre-coloniz-prompt');
  if (old) old.remove();
  _creBatchColonizPending = { formulaId: formulaId, geneticaIds: geneticaIds.slice() };
  var n = geneticaIds.length;
  var div = document.createElement('div');
  div.className = 'cre-coloniz-prompt';
  div.innerHTML = '<div class="cre-coloniz-icon">🌿</div>'
    + '<div>'
    + '<div class="cre-coloniz-title">Colonización completa registrada</div>'
    + '<div class="cre-coloniz-info"><strong style="color:var(--ac2)">' + n + ' cepa' + (n > 1 ? 's' : '') + '</strong> completaron colonización.</div>'
    + '<div class="cre-coloniz-question">¿Cerrar el ciclo de expansión y pasar a GR?</div>'
    + '</div>'
    + '<div class="cre-coloniz-actions">'
    + '<button class="clab-btn" onclick="creColonizacionCerrarCicloBatch()" style="background:var(--ac2);color:var(--bg);border-color:var(--ac2);font-weight:700">✓ Cerrar ciclo → GR</button>'
    + '<button class="clab-btn clab-btn-sm" onclick="this.closest(\'.cre-coloniz-prompt\').remove();_creBatchColonizPending=null;" style="color:var(--tx3)">Mantener abierto</button>'
    + '</div>';
  cardsWrap.before(div);
}

function creColonizacionCerrarCicloBatch() {
  var pending = _creBatchColonizPending;
  _creBatchColonizPending = null;
  if (!pending) return;
  var prompt = document.querySelector('.cre-coloniz-prompt');
  if (prompt) prompt.remove();

  var formulaId = pending.formulaId;
  var notaTxt = '✅ Ciclo cerrado -> Se activa en GR';
  _creWriteAutoNota(formulaId, notaTxt, 'green', null);
  pending.geneticaIds.forEach(function(gId) {
    _creNotasWrite(formulaId, gId, _creNotasRead(formulaId, gId).concat([
      { id: 'cciclo-' + Date.now() + '-' + gId, ts: (function(){ var d=new Date(); return d.getDate()+'/'+(d.getMonth()+1)+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); })(), texto: notaTxt, auto: true }
    ]));
  });

  if (typeof window._ciSyncCultivosFromSeg === 'function') {
    try { window._ciSyncCultivosFromSeg(formulaId); } catch(e) {}
  }

  notif('✅ Ciclo cerrado en ' + pending.geneticaIds.length + ' cepas — se activa en GR', 'ok');
}

function creNotaEliminar(formulaId, geneticaId, notaId) {
  var notas = _creNotasRead(formulaId, geneticaId).filter(function(n) { return n.id !== notaId; });
  _creNotasWrite(formulaId, geneticaId, notas);
  var key = formulaId + '__' + (geneticaId || '_');
  var panel = document.getElementById('cre-notas-panel-' + key);
  if (panel) panel.outerHTML = _creNotasPanelHTML(formulaId, geneticaId);
}

function creNotaEditarStart(formulaId, geneticaId, notaId) {
  var txtEl = document.getElementById('cre-nota-txt-' + notaId);
  if (!txtEl) return;
  var original = txtEl.textContent;
  var fIdE = esc(formulaId);
  var gIdE = esc(geneticaId || '');
  var nIdE = esc(notaId);
  txtEl.innerHTML = '<input type="text" id="cre-nota-edit-' + nIdE + '" value="' + esc(original) + '"'
    + ' style="flex:1;background:var(--s3);border:1px solid var(--ac2);border-radius:3px;color:var(--tx);padding:3px 6px;font-size:11px;outline:none;width:100%"'
    + ' onkeydown="if(event.key===\'Enter\')creNotaEditarGuardar(\'' + fIdE + '\',\'' + gIdE + '\',\'' + nIdE + '\');if(event.key===\'Escape\')creNotaEditarCancelar(\'' + nIdE + '\',\'' + esc(original) + '\')">'
    + '<button onclick="creNotaEditarGuardar(\'' + fIdE + '\',\'' + gIdE + '\',\'' + nIdE + '\')" style="margin-left:6px;font-size:10px;padding:2px 8px;background:var(--ac2);color:var(--bg);border:none;border-radius:3px;cursor:pointer">✓</button>'
    + '<button onclick="creNotaEditarCancelar(\'' + nIdE + '\',\'' + esc(original) + '\')" style="margin-left:4px;font-size:10px;padding:2px 8px;background:rgba(255,255,255,0.08);color:var(--tx2);border:none;border-radius:3px;cursor:pointer">✕</button>';
  var editInp = document.getElementById('cre-nota-edit-' + notaId);
  if (editInp) { editInp.focus(); editInp.select(); }
  // Ocultar botones de acción del item mientras edita
  var item = document.getElementById('cre-nota-' + notaId);
  if (item) {
    var actEl = item.querySelector('.cre-nota-actions');
    if (actEl) actEl.style.display = 'none';
  }
}

function creNotaEditarGuardar(formulaId, geneticaId, notaId) {
  var editInp = document.getElementById('cre-nota-edit-' + notaId);
  if (!editInp) return;
  var nuevo = editInp.value.trim();
  if (!nuevo) return;
  var notas = _creNotasRead(formulaId, geneticaId);
  notas.forEach(function(n) {
    if (n.id === notaId) { n.texto = nuevo; n.editedAt = new Date().toISOString(); }
  });
  _creNotasWrite(formulaId, geneticaId, notas);
  var key = formulaId + '__' + (geneticaId || '_');
  var panel = document.getElementById('cre-notas-panel-' + key);
  if (panel) panel.outerHTML = _creNotasPanelHTML(formulaId, geneticaId);
}

function creNotaEditarCancelar(notaId, original) {
  var txtEl = document.getElementById('cre-nota-txt-' + notaId);
  if (txtEl) txtEl.textContent = original;
  var item = document.getElementById('cre-nota-' + notaId);
  if (item) {
    var actEl = item.querySelector('.cre-nota-actions');
    if (actEl) actEl.style.display = '';
  }
}

function _creHowGuideHTML() {
  return '<details class="cre-how-guide">'
    + '<summary>🧠 ¿Cómo funciona este motor? — Guía paso a paso</summary>'
    + '<div class="cre-how-guide-body">'

    + '<div class="cre-how-step">'
    + '<div class="cre-how-step-num">1</div>'
    + '<div class="cre-how-step-body"><strong>Registrá las fases metabólicas.</strong> '
    + 'Cada vez que observás algo en las placas, abrís el panel de la fórmula y clickeás la fase correspondiente. '
    + 'El sistema toma el timestamp automáticamente y calcula los <em>días desde inoculación</em>. '
    + 'Si la observación fue hace días, ajustá la fecha real con el botón ✎ — el día se recalcula solo. '
    + 'Las 6 fases son orientativas y se pueden registrar en cualquier orden.</div>'
    + '</div>'

    + '<div class="cre-how-step">'
    + '<div class="cre-how-step-num">2</div>'
    + '<div class="cre-how-step-body"><strong>Score de calidad: 1 a 10.</strong> '
    + '<strong>1–6 (tormentoso / difuso)</strong>: el crecimiento no organizó rizomorfos. '
    + 'El campo "Placas con rizomorfismo" está deshabilitado — no aplica. '
    + '<strong>7–10 (rizomórfico)</strong>: el crecimiento produjo rizomorfos reales. '
    + 'Ahí sí ingresás cuántas placas del lote los tienen.<br>'
    + '<em>7 = rizo débil, 8 = medio, 9 = fuerte, 10 = excepcional.</em></div>'
    + '</div>'

    + '<div class="cre-how-step">'
    + '<div class="cre-how-step-num">3</div>'
    + '<div class="cre-how-step-body"><strong>Cómo se calcula el Score Compuesto.</strong> '
    + '<strong>Rizomórfico (score ≥7):</strong> '
    + '<code>Score × (0.9 + 0.1 × rizo%)</code>. '
    + 'La incidencia de rizomorfismo ajusta el score en hasta ±10%. Score 9, 100% incidencia → 9.0. Score 9, 50% incidencia → 8.55. '
    + 'La velocidad de colonización <strong>no penaliza</strong> si el resultado es rizomórfico — calidad compensa lentitud.<br>'
    + '<strong>Tormentoso / difuso (score &lt;7):</strong> '
    + '<code>Score − penalidad_colonización</code>. '
    + 'Si el lote tardó más de 15 días en colonizar y el crecimiento fue malo, se resta 0.25 por cada día extra (máximo −3). '
    + 'Lento + mal resultado sí penaliza.</div>'
    + '</div>'

    + '<div class="cre-how-step">'
    + '<div class="cre-how-step-num">4</div>'
    + '<div class="cre-how-step-body"><strong>Tipo de cordón (score ≥7).</strong> '
    + 'Especificá si el rizo es <strong>FINO</strong> (&lt;1mm — exceso de Glutamina sintasa), '
    + '<strong>GRUESO</strong> (&gt;1mm — síntesis de quitina activa, ODC activo — el más valioso) '
    + 'o <strong>MIXTO</strong>. '
    + 'El motor distingue "rizo presente" de "rizo productivo". El tipo de cordón afecta directamente '
    + 'el índice de aprendizaje de ingredientes.</div>'
    + '</div>'

    + '<div class="cre-how-step">'
    + '<div class="cre-how-step-num">5</div>'
    + '<div class="cre-how-step-body"><strong>Colonización completa: cerrá el ciclo.</strong> '
    + 'Cuando el lote colonizó, registrá la fase "Colonización completa". '
    + 'El sistema calcula días totales y te ofrece pasar a GR. '
    + 'Cerrar el ciclo con un score guardado activa la calibración del motor para esa cepa.</div>'
    + '</div>'

    + '<div class="cre-how-step">'
    + '<div class="cre-how-step-num">6</div>'
    + '<div class="cre-how-step-body"><strong>Calibración por cepa (necesita ≥2 ciclos cerrados).</strong> '
    + 'El motor compara el score teórico (calculado por ingredientes) con el score real observado. '
    + 'La diferencia es el <em>Δ bias</em> de la cepa. '
    + 'Con 1 solo ensayo el motor no aplica calibración — puede ser ruido. '
    + 'Con ≥2 ensayos empieza a ajustar. Con ≥5 la señal es confiable.<br>'
    + '<strong>Δ positivo</strong>: la cepa rinde mejor de lo que la fórmula predice. '
    + '<strong>Δ negativo</strong>: rinde peor — revisá protocolo o fórmula.</div>'
    + '</div>'

    + '<div class="cre-how-step">'
    + '<div class="cre-how-step-num">7</div>'
    + '<div class="cre-how-step-body"><strong>Sinergias por ingrediente.</strong> '
    + 'El panel "🧪 Sinergias" muestra qué ingredientes aparecen correlacionados con resultados '
    + 'por encima o por debajo del teórico. '
    + '<strong>+delta</strong>: potenciador real (aparece en fórmulas que superan la predicción). '
    + '<strong>−delta</strong>: limitante o antagonista. '
    + 'Confiable con ≥5 ensayos por ingrediente — con menos, tomalo como hipótesis, no como certeza.</div>'
    + '</div>'

    + '<div class="cre-how-tip">'
    + '<strong>Flujo recomendado:</strong> Observás algo → abrís Conocimiento → clickeás la fase → ajustás fecha si es vieja → guardás. '
    + 'Cuando el lote riza: elegís score 7–10, ingresás placas con rizomorfismo, especificás tipo de cordón. '
    + 'Score &lt;7: solo elegís el número, sin incidencia. '
    + 'Cuando coloniza: registrás la fase y cerrás el ciclo. '
    + 'Con 3–5 ciclos cerrados por combinación fórmula/cepa el motor tiene señal real.'
    + '</div>'

    + '</div>'
    + '</details>';
}

// ── Matrix log ────────────────────────────────────────────────────────────────

function _creRelativeTime(ts) {
  if (!ts) return '—';
  try {
    var d = new Date(ts);
    if (isNaN(d.getTime())) return String(ts).slice(0, 16);
    var diff = Date.now() - d.getTime();
    if (diff < 60000)    return 'ahora';
    if (diff < 3600000)  return 'hace ' + Math.floor(diff / 60000)   + 'm';
    if (diff < 86400000) return 'hace ' + Math.floor(diff / 3600000) + 'h';
    return 'hace ' + Math.floor(diff / 86400000) + 'd';
  } catch (e) { return String(ts).slice(0, 16); }
}

function _creAbsTime(ts) {
  if (!ts) return '—';
  try {
    var d = new Date(ts);
    if (isNaN(d.getTime())) return String(ts).slice(0, 16);
    var dd = String(d.getDate()).padStart(2, '0');
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var yy = String(d.getFullYear()).slice(2);
    var hh = String(d.getHours()).padStart(2, '0');
    var mn = String(d.getMinutes()).padStart(2, '0');
    return dd + '/' + mm + '/' + yy + ' ' + hh + ':' + mn;
  } catch(e) { return '—'; }
}

function _creMatrixLogHTML(filterFormulaId, filterFrascoCtx) {
  // filterFrascoCtx: { experimentoId, frascoId } | null
  // null = BASE: muestra todo; objeto = solo entradas de ese frasco (+ notas manuales/fases)
  var allRaw = {};
  try { allRaw = JSON.parse(localStorage.getItem(K_CREC_NOTAS)) || {}; } catch (e) {}
  var records = creRead();
  var fNameMap = {};
  records.forEach(function(r) {
    if (!fNameMap[r.formulaId] && r.formulaSnapshot) {
      fNameMap[r.formulaId] = r.formulaSnapshot.nombre || r.formulaId;
    }
  });
  var entries = [];
  Object.keys(allRaw).forEach(function(key) {
    var parts      = key.split('__');
    var formulaId  = parts[0];
    var geneticaId = (!parts[1] || parts[1] === '_') ? null : parts[1];
    if (filterFormulaId && formulaId !== filterFormulaId) return;
    var notas = allRaw[key] || [];
    notas.forEach(function(n) {
      entries.push({
        id:           n.id          || null,
        ts:           n.ts          || '',
        formulaId:    formulaId,
        formulaName:  fNameMap[formulaId] || formulaId.slice(0, 14),
        geneticaId:   geneticaId,
        cepaLabels:   n.cepaLabels  || null,
        cepaIds:      n.cepaIds     || null,
        logType:      n.logType     || 'nota',
        auto:         !!n.auto,
        texto:        n.texto       || '',
        experimentoId: n.experimentoId || null,
        frascoId:     n.frascoId    || null,
      });
    });
  });
  // Filtrado por frasco: notas manuales (no auto) siempre visibles.
  // Entradas auto (score, fase) se aíslan por frasco — solo se muestran si coincide
  // con el contexto activo. Sin frasco en la entrada → pertenece a BASE (sin filtro).
  if (filterFrascoCtx) {
    entries = entries.filter(function(e) {
      if (!e.auto) return true;  // nota manual: siempre visible
      if (!e.experimentoId) return false;  // auto sin frasco = BASE, no mostrar en frasco
      return e.experimentoId === filterFrascoCtx.experimentoId
        && e.frascoId === filterFrascoCtx.frascoId;
    });
  }
  entries.sort(function(a, b) {
    if (!a.ts) return 1; if (!b.ts) return -1;
    return a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0;
  });
  if (entries.length === 0) return '<div class="cre-matrix-empty">Sin eventos en el log.</div>';
  var html = '';
  entries.forEach(function(e) {
    var typeCol = e.logType === 'fase' ? '#44aaff' : e.logType === 'score' ? '#2ecc71' : '#ffd93d';
    var typeLbl = e.logType === 'fase' ? 'FASE' : e.logType === 'score' ? 'SCORE' : 'NOTA';
    var chipHtml = '';
    var labels = (e.cepaLabels && e.cepaLabels.length) ? e.cepaLabels : (e.geneticaId ? [e.geneticaId] : []);
    var ids    = (e.cepaIds   && e.cepaIds.length)    ? e.cepaIds    : (e.geneticaId ? [e.geneticaId] : []);
    labels.forEach(function(lbl, i) {
      var gId = ids[i] || e.geneticaId || lbl;
      var col = _creChipColor(gId);
      chipHtml += '<span class="cre-mlog-chip" style="border-color:' + col + ';color:' + col + ';background:' + col + '1a">'
        + esc(_creDispLabel(lbl)) + '</span>';
    });
    var fmtName = (e.formulaName && !filterFormulaId)
      ? esc(e.formulaName.length > 18 ? e.formulaName.slice(0, 16) + '…' : e.formulaName) : '';
    var _gArg = e.geneticaId ? '\'' + esc(e.geneticaId) + '\'' : 'null';
    var _delBtn = e.id
      ? '<button class="cre-mlog-del" onclick="creDeleteLogEntry(\'' + esc(e.id) + '\',\'' + esc(e.formulaId) + '\',' + _gArg + ')" title="Eliminar entrada">×</button>'
      : '';
    html += '<div class="cre-mlog-row' + (e.auto ? ' cre-mlog-row--auto' : '') + '">'
      + '<span class="cre-mlog-ts">' + _creAbsTime(e.ts) + '</span>'
      + (fmtName ? '<span class="cre-mlog-formula" title="' + esc(e.formulaName) + '">' + fmtName + '</span>' : '')
      + (chipHtml ? '<span class="cre-mlog-cepa">' + chipHtml + '</span>' : '')
      + '<span class="cre-mlog-type" style="color:' + typeCol + ';border-color:' + typeCol + '">' + typeLbl + '</span>'
      + '<span class="cre-mlog-txt">' + esc(e.texto) + '</span>'
      + _delBtn
      + '</div>';
  });
  return html;
}

function creDeleteLogEntry(entryId, formulaId, geneticaId) {
  var notas    = _creNotasRead(formulaId, geneticaId);
  var filtered = notas.filter(function(n) { return n.id !== entryId; });
  if (filtered.length === notas.length) return; // id no encontrado
  _creNotasWrite(formulaId, geneticaId, filtered);
  // Re-render log del panel de scoring si está abierto
  if (_sp.formulaId) _creRenderLogSection(_sp.formulaId);
  // Re-render log global si está abierto
  var globalPanel = document.getElementById('cre-matrix-log-panel');
  if (globalPanel && globalPanel.style.display !== 'none') {
    var body = globalPanel.querySelector('.cre-matrix-body');
    if (body) body.innerHTML = _creMatrixLogHTML(null);
  }
}

function creToggleMatrixLog() {
  var panel = document.getElementById('cre-matrix-log-panel');
  if (!panel) return;
  var isHidden = panel.style.display === 'none';
  panel.style.display = isHidden ? '' : 'none';
  if (isHidden) {
    var body = panel.querySelector('.cre-matrix-body');
    if (body) body.innerHTML = _creMatrixLogHTML(null);
  }
}

function renderConocimiento() {
  var panel = document.getElementById('clab-sub-conocimiento');
  if (!panel) return;

  _creMigrateSegNotas();
  _creConsumePendingAction();

  panel.innerHTML = '<div class="clab-card cre-shell">'
    + '<div class="cre-header">'
    +   '<div>'
    +     '<div class="cre-eyebrow">CILAB</div>'
    +     '<div class="clab-ct cre-title">Conocimiento</div>'
    +     '<p class="clab-help cre-subtitle">Calibra el motor con observaciones reales de crecimiento, rizo e incidencia por cepa.</p>'
    +   '</div>'
    +   '<div class="cre-header-actions">'
    +     '<button class="clab-btn clab-btn-sm" onclick="creExportJSON()" title="Exportar bl2_crec">Exportar</button>'
    +     '<input type="file" id="cre-import-file" accept=".json" style="display:none" onchange="creImportJSON(this)">'
    +     '<button class="clab-btn clab-btn-sm" onclick="document.getElementById(\'cre-import-file\').click()">Importar</button>'
    +     '<button class="clab-btn clab-btn-sm" onclick="creRepararDatosDeExperimentos()" title="Asignar frascoId a records legacy y regenerar logs de score con contexto de frasco">Reparar datos</button>'
    +     '<button class="clab-btn clab-btn-sm" onclick="creBackfillLogs()" title="Generar logs automáticos para registros existentes sin consola">Regenerar logs</button>'
    +     '<button class="clab-btn clab-btn-sm" onclick="creToggleMatrixLog()" title="Log global de todos los eventos">◉ Log</button>'
    +     '<button class="clab-btn clab-btn-sm cre-danger-btn" onclick="crePurgarConocimiento()">Purgar</button>'
    +   '</div>'
    + '</div>'
    + _creHowGuideHTML()
    + '<div id="cre-grid-wrap" class="cre-grid-wrap"></div>'
    + '<div id="cre-detalle-wrap" class="cre-detail-wrap" style="display:none"></div>'
    + '<div id="cre-wizard-modal" style="display:none;position:fixed;top:0;left:0;width:100%;height:100%;z-index:9000;background:rgba(0,0,0,0.6);overflow:auto;padding:30px 20px;box-sizing:border-box"><div id="cre-wizard-modal-inner" style="max-width:520px;margin:0 auto"></div></div>'
    + '<div id="cre-matrix-log-panel" class="cre-matrix-panel" style="display:none">'
    + '<div class="cre-matrix-header">'
    + '<span class="cre-matrix-title">◉ Log global</span>'
    + '<span class="cre-matrix-sub">Todos los eventos — newest first</span>'
    + '<button class="clab-btn clab-btn-sm" onclick="creToggleMatrixLog()">✕</button>'
    + '</div>'
    + '<div class="cre-matrix-body"></div>'
    + '</div>'
    + '</div>';

  _creRenderGrid();
}

function _creConsumePendingAction() {
  try {
    const raw = localStorage.getItem(K_CREC_PENDING);
    if (!raw) return;
    localStorage.removeItem(K_CREC_PENDING);
    const p = JSON.parse(raw);
    if (p && p.formulaId) {
      setTimeout(function() {
        const el = document.querySelector('[data-cre-formula="' + p.formulaId + '"]');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 200);
    }
  } catch (e) { console.warn('[CREC] consumePendingAction error:', e); }
}

// ── Exposição global — funciones llamadas desde HTML inline (onclick="...") ──
Object.assign(window, {
  renderConocimiento,
  creEnrichObs: enrichObs,
  creSetFormulaSort,
  creToggleFormulaMotor,
  creConfirmDeleteSP,
  creConfirmDeleteInline,
  creExportJSON,
  creImportJSON,
  creBackfillLogs,
  creRepararDatosDeExperimentos,
  crePurgarConocimiento,
  creOpenDetalle,
  creVolverGrid,
  creOpenFormulaDirectDetail,
  creQfSetEstado,
  creSubmitQuickRecord,
  creSubmitTileRecord,
  creSubmitDirectRecord,
  creDeleteAndRefresh,
  creDeleteAndRefreshSP,
  creSetScoringFrasco,
  creBatchFaseConfirm,
  creBatchFaseCancel,
  creWipeFormulaFases,
  creToggleCepaExpand,
  creToggleCepaBatch,
  creSelectAllCepas,
  creDeleteLogEntry,
  creSelectBatchScore,
  creSelectBatchTipo,
  creUpdateBatchCompound,
  creOpenScoringPanel,
  creCloseScoringPanel,
  creSetScoringCepa,
  creSelectScore,
  creSelectTipo,
  creUpdateCompound,
  creSubmitScoringPanel,
  creNotaEnviar,
  creSelectSPTab,
  creFaseEditSave,
  creFaseEditCancel,
  creFaseDeleteConfirm,
  creFaseGridClick,
  creFaseGridBatchClick,
  creColonizacionCierrePrompt,
  creColonizacionCerrarCiclo,
  creColonizacionCierrePromptBatch,
  creColonizacionCerrarCicloBatch,
  creNotaEliminar,
  creNotaEditarStart,
  creNotaEditarGuardar,
  creNotaEditarCancelar,
  creToggleMatrixLog,
  creWizSelect,
  creWizNext,
  creWizBack,
  creWizSave,
  _creWizardOpen,
  _creWizardOpenModal,
  _creWizardOpenBatch,
  _creWizardClose,
  creToggleAddObs,
  creSubmitObs,
  computeRizoLearnIndex,
  rizoLearnGet,
  creGoOptimizeWithCalib,
  creBackfillAllExtras,
  creBackfillTomentosoRizo,
});

// Migración silenciosa al cargar: sella extras de frascos en formulaSnapshot.
// Solo toca records cerrados sin _extrasBackfilled. Idempotente.
(function() {
  try {
    var arr = JSON.parse(localStorage.getItem('bl2_crec') || '[]');
    var needsMigration = arr.some(function(r) {
      return r.status === 'cerrado' && !r._extrasBackfilled && r.experimentoId && r.frascoId;
    });
    if (needsMigration && typeof creBackfillAllExtras === 'function') {
      var result = creBackfillAllExtras();
      if (result.updated > 0) console.info('[CRE] extras backfilled:', result.updated, 'records');
    }
  } catch(e) { console.warn('[CRE] migration extras failed', e); }
})();

// Migración silenciosa: infiere rizoPozitivas=0 para records cerrados con fenotipo tomentoso sin datos de placas.
(function() {
  try {
    var arr = JSON.parse(localStorage.getItem('bl2_crec') || '[]');
    var needsMigration = arr.some(function(r) {
      return r.status === 'cerrado' && r.rizoPozitivas == null
        && r.observaciones && r.observaciones.some(function(o) { return o.fenotipo === 'tomentoso'; });
    });
    if (needsMigration && typeof creBackfillTomentosoRizo === 'function') {
      var result = creBackfillTomentosoRizo();
      if (result.updated > 0) console.info('[CRE] tomentoso rizo backfilled:', result.updated, 'records');
    }
  } catch(e) { console.warn('[CRE] migration tomentoso rizo failed', e); }
})();

})(); // fin IIFE cilab_conocimiento
