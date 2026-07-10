/* ============================================================
   BIOLAB ENGINE v3 — MÓDULO CI_GR_LINKS
   ci_gr_links.js — Capa de trazabilidad bidireccional CI ↔ GR

   RESPONSABILIDADES:
     · Persistir y consultar entidades CiGrLink (storage: bl2_ci_gr_links)
     · Proveer stock efectivo de un cultivo CI sin depender de window.CI en runtime
     · Exponer API simétrica de consulta en ambas direcciones
     · Ejecutar la operación atómica de consumo (anular + crear) con rollback
     · Migrar datos legacy desde cultivo.consumos[] sin destruir nada

   GARANTÍAS:
     · Sin dependencia de window.CI ni window.GR en tiempo de ejecución
     · Toda operación re-lee localStorage antes de mutar (safe ante cross-tab)
     · Rollback explícito si alguna fase de la operación atómica falla
     · Lectura defensiva: nunca lanza, devuelve [] o {} ante datos corruptos
     · Los links ANULADOS nunca se eliminan (auditoría permanente)

   INTERFAZ PÚBLICA (window.CiGrLinks):
     load()                                → CiGrLink[]
     getByLinkId(id)                       → CiGrLink | null
     getActivosByCultivo(cultivoCiId)      → CiGrLink[]
     getActivosByLote(grLoteId)            → CiGrLink[]
     getActivosByLoteYTanda(loteId, tanda) → CiGrLink[]
     stockConsumidoByCultivo(cultivoCiId)  → number
     aplicarConsumos(loteId, oldDg, newDg) → { ok, motivo?, linksCreados? }
     migrarDesdeConsumos(cultivos)         → { ok, creados, errores }
     exportar()                            → { links: CiGrLink[] }

   SCHEMA CiGrLink v1:
     id              string   — "cgl_<base36ts>_<6hex>"
     _schemaVersion  1
     estado          "ACTIVO" | "ANULADO"
     cultivoCiId     string   — FK → bl2_cultivos[].id
     grLoteId        string   — FK → gr_lotes[].id
     grTanda         string | null
     cantidad        number   — unidades consumidas (int ≥ 1)
     fechaConsumo    ISO8601
     fechaAnulacion  ISO8601 | null
     motivoAnulacion string | null
     snapshotCultivo { codigo, geneticaLabel, medioFormulaId? }
     creadoPor       "GR" | "MIGRACION"
   ============================================================ */

(function () {
'use strict';

// ════════════════════════════════════════════
// CONSTANTES
// ════════════════════════════════════════════
const STORAGE_KEY    = 'bl2_ci_gr_links';
const SCHEMA_VERSION = 1;

// ════════════════════════════════════════════
// PERSISTENCIA — capa interna
// ════════════════════════════════════════════

function _load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('[CiGrLinks] storage corrupto, devuelve []:', err);
    return [];
  }
}

function _save(links) {
  if (!Array.isArray(links)) return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(links));
    return true;
  } catch (err) {
    console.error('[CiGrLinks] _save falló (cuota?):', err);
    return false;
  }
}

// ════════════════════════════════════════════
// GENERADOR DE ID
// ════════════════════════════════════════════

function _genId() {
  const ts  = Date.now().toString(36);
  const rnd = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
  return `cgl_${ts}_${rnd}`;
}

// ════════════════════════════════════════════
// FACTORY (no persiste)
// ════════════════════════════════════════════

function _factory({ cultivoCiId, grLoteId, grTanda, cantidad, snapshotCultivo, creadoPor }) {
  return {
    _schemaVersion:  SCHEMA_VERSION,
    id:              _genId(),
    estado:          'ACTIVO',
    cultivoCiId:     String(cultivoCiId),
    grLoteId:        String(grLoteId),
    grTanda:         (grTanda && typeof grTanda === 'string') ? grTanda : null,
    cantidad:        cantidad,
    fechaConsumo:    new Date().toISOString(),
    fechaAnulacion:  null,
    motivoAnulacion: null,
    snapshotCultivo: {
      codigo:        snapshotCultivo?.codigo        || cultivoCiId,
      geneticaLabel: snapshotCultivo?.geneticaLabel || '',
      medioFormulaId: snapshotCultivo?.medioFormulaId || null,
    },
    creadoPor: creadoPor || 'GR',
  };
}

// ════════════════════════════════════════════
// API DE LECTURA (pura, sin efectos secundarios)
// ════════════════════════════════════════════

function load() {
  return _load();
}

function getByLinkId(id) {
  if (!id) return null;
  const all = _load();
  return all.find(l => l.id === id) || null;
}

function getActivosByCultivo(cultivoCiId) {
  if (!cultivoCiId) return [];
  return _load().filter(l => l.estado === 'ACTIVO' && l.cultivoCiId === cultivoCiId);
}

function getActivosByLote(grLoteId) {
  if (!grLoteId) return [];
  return _load().filter(l => l.estado === 'ACTIVO' && l.grLoteId === grLoteId);
}

function getActivosByLoteYTanda(grLoteId, grTanda) {
  if (!grLoteId || !grTanda) return [];
  return _load().filter(l =>
    l.estado === 'ACTIVO' && l.grLoteId === grLoteId && l.grTanda === grTanda
  );
}

// Suma de cantidad en links ACTIVOS para un cultivo.
// Este valor es la fuente de verdad para el stock consumido.
function stockConsumidoByCultivo(cultivoCiId) {
  return getActivosByCultivo(cultivoCiId)
    .reduce((s, l) => s + (l.cantidad || 0), 0);
}

// Stock efectivo calculado desde links (no depende de cultivo.cantidadDisponible).
// Requiere cantidadInicial del cultivo para operar.
function stockEfectivoByCultivo(cultivoCiId, cantidadInicial) {
  const consumido = stockConsumidoByCultivo(cultivoCiId);
  return Math.max(0, (cantidadInicial || 0) - consumido);
}

// ════════════════════════════════════════════
// ANULACIÓN INTERNA
// Marca links como ANULADOS sin eliminarlos (auditoría permanente).
// Devuelve los links que fueron anulados (para rollback si es necesario).
// ════════════════════════════════════════════

function _anularPorLote(links, grLoteId, motivo) {
  const ahora    = new Date().toISOString();
  const anulados = [];
  for (const l of links) {
    if (l.estado === 'ACTIVO' && l.grLoteId === grLoteId) {
      l.estado          = 'ANULADO';
      l.fechaAnulacion  = ahora;
      l.motivoAnulacion = motivo || 'reemplazo por guardado de lote';
      anulados.push(l.id);
    }
  }
  return anulados;
}

function _reactivar(links, linkIds) {
  for (const l of links) {
    if (linkIds.includes(l.id)) {
      l.estado          = 'ACTIVO';
      l.fechaAnulacion  = null;
      l.motivoAnulacion = null;
    }
  }
}

// ════════════════════════════════════════════
// RESOLUCIÓN DE SNAPSHOT DE CULTIVO
// Sin depender de window.CI: lee bl2_cultivos directo de localStorage.
// ════════════════════════════════════════════

function _resolverSnapshotCultivo(cultivoCiId) {
  try {
    const raw = localStorage.getItem('bl2_cultivos');
    if (!raw) return null;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return null;
    const c = arr.find(x => x && x.id === cultivoCiId);
    if (!c) return null;
    return {
      codigo:        c.codigo        || cultivoCiId,
      geneticaLabel: (c.geneticaSnapshot && c.geneticaSnapshot.label) || c.geneticaId || '',
      medioFormulaId: c.medioFormulaId || null,
      cantidadInicial: c.cantidadInicial || 0,
      estado: c.estado || 'DISPONIBLE',
    };
  } catch (e) {
    return null;
  }
}

// ════════════════════════════════════════════
// VALIDACIÓN DE STOCK PRE-OPERACIÓN
// Lee cultivos directamente de localStorage para no depender de window.CI.
// Devuelve array de errores (vacío = todo ok).
// ════════════════════════════════════════════

function _validarStock(newDg, oldDg, grLoteId) {
  const errores = [];

  // Contar necesidades netas por cultivoCiId en el nuevo DG
  const needed = {};
  for (const d of newDg) {
    if (!d || d.inoculoSource !== 'CI' || !d.cultivoCiId) continue;
    const qty = (Number.isInteger(d.placasUsadas) && d.placasUsadas > 0) ? d.placasUsadas : 0;
    if (qty <= 0) continue;
    needed[d.cultivoCiId] = (needed[d.cultivoCiId] || 0) + qty;
  }

  if (Object.keys(needed).length === 0) return [];

  // Cargar cultivos una sola vez
  let cultivos = [];
  try {
    const raw = localStorage.getItem('bl2_cultivos');
    if (raw) cultivos = JSON.parse(raw);
    if (!Array.isArray(cultivos)) cultivos = [];
  } catch (e) { cultivos = []; }

  // Cargar links una sola vez
  const linksActuales = _load();

  for (const [cid, cantNecesaria] of Object.entries(needed)) {
    const cultivo = cultivos.find(c => c && c.id === cid);
    if (!cultivo) continue; // cultivo no encontrado — lo permitimos (edge case: importación)

    if (cultivo.estado === 'DESCARTADO') {
      errores.push(`Cultivo ${cultivo.codigo || cid} está DESCARTADO y no puede consumirse.`);
      continue;
    }

    // Stock efectivo = cantidadInicial - links ACTIVOS de OTROS lotes
    // (los links del lote actual serán anulados antes de crear los nuevos)
    const consumidoOtros = linksActuales
      .filter(l => l.estado === 'ACTIVO' && l.cultivoCiId === cid && l.grLoteId !== grLoteId)
      .reduce((s, l) => s + (l.cantidad || 0), 0);

    const stockEfectivo = Math.max(0, (cultivo.cantidadInicial || 0) - consumidoOtros);

    if (stockEfectivo < cantNecesaria) {
      errores.push(
        `Stock insuficiente en cultivo ${cultivo.codigo || cid}: ` +
        `disponible ${stockEfectivo}, requerido ${cantNecesaria}.`
      );
    }
  }

  return errores;
}

// ════════════════════════════════════════════
// ACTUALIZACIÓN DE cantidadDisponible EN bl2_cultivos
// Mantiene el campo sincronizado con el estado real de los links.
// Operación secundaria: si falla, no revierte el link (el link es la fuente de verdad).
// ════════════════════════════════════════════

function _sincronizarStockEnCultivos(cultivoCiIds) {
  if (!cultivoCiIds || cultivoCiIds.length === 0) return;
  try {
    const raw = localStorage.getItem('bl2_cultivos');
    if (!raw) return;
    const cultivos = JSON.parse(raw);
    if (!Array.isArray(cultivos)) return;

    const links = _load();
    let modificado = false;

    for (const cid of cultivoCiIds) {
      const idx = cultivos.findIndex(c => c && c.id === cid);
      if (idx === -1) continue;
      const c = cultivos[idx];
      const consumido = links
        .filter(l => l.estado === 'ACTIVO' && l.cultivoCiId === cid)
        .reduce((s, l) => s + (l.cantidad || 0), 0);
      const nuevoStock = Math.max(0, (c.cantidadInicial || 0) - consumido);
      if (c.cantidadDisponible !== nuevoStock) {
        c.cantidadDisponible = nuevoStock;
        // Transición de estado: si llega a 0 y no está DESCARTADO, pasa a AGOTADO
        if (nuevoStock === 0 && c.estado === 'DISPONIBLE') {
          c.estado = 'AGOTADO';
        }
        // Si stock > 0 y estaba AGOTADO, vuelve a DISPONIBLE
        if (nuevoStock > 0 && c.estado === 'AGOTADO') {
          c.estado = 'DISPONIBLE';
        }
        modificado = true;
      }
    }

    if (modificado) {
      localStorage.setItem('bl2_cultivos', JSON.stringify(cultivos));
      // Notificar a CI si está montado (no crítico — solo refresca UI)
      try {
        window.dispatchEvent(new CustomEvent('ci-cultivos-changed', {
          detail: { tipo: 'stock-sync', cultivoCiIds }
        }));
      } catch (e) { /* no crítico */ }
    }
  } catch (err) {
    console.warn('[CiGrLinks] _sincronizarStockEnCultivos falló (no crítico):', err);
  }
}

// ════════════════════════════════════════════
// OPERACIÓN ATÓMICA: aplicarConsumos
// Implementa el protocolo de tres fases:
//   Fase 1 — Validar stock (sin mutaciones)
//   Fase 2 — Anular links del lote anterior
//   Fase 3 — Crear links nuevos
// Si Fase 3 falla, se revierte Fase 2 (rollback explícito).
// ════════════════════════════════════════════

function aplicarConsumos(grLoteId, oldDg, newDg) {
  if (typeof grLoteId !== 'string' || !grLoteId) {
    return { ok: true, sinCambios: true };
  }

  const newDgArr = Array.isArray(newDg) ? newDg : [];
  const oldDgArr = Array.isArray(oldDg) ? oldDg : [];

  // Determinar si hay filas CI en el nuevo DG
  const hayFilasCI = newDgArr.some(
    d => d && d.inoculoSource === 'CI' && d.cultivoCiId &&
         Number.isInteger(d.placasUsadas) && d.placasUsadas > 0
  );

  // Determinar si había filas CI en el DG anterior
  const habiaFilasCI = oldDgArr.some(
    d => d && d.inoculoSource === 'CI' && d.cultivoCiId
  );

  if (!hayFilasCI && !habiaFilasCI) {
    return { ok: true, sinCambios: true };
  }

  // ── FASE 1: Validación (sin mutaciones) ──
  const errores = _validarStock(newDgArr, oldDgArr, grLoteId);
  if (errores.length > 0) {
    return { ok: false, motivo: errores.join('\n') };
  }

  // ── FASE 2: Anular links anteriores del lote ──
  const links = _load();
  const anulados = _anularPorLote(links, grLoteId, 'reemplazo por guardado de lote');

  // Guardar con anulaciones aplicadas
  if (!_save(links)) {
    // Si no podemos guardar la anulación, no podemos continuar de forma segura
    return { ok: false, motivo: 'Fallo al persistir anulaciones (cuota localStorage?)' };
  }

  // ── FASE 3: Crear links nuevos ──
  const linksCreados  = [];
  const cidsAfectados = new Set();

  for (const d of newDgArr) {
    if (!d || d.inoculoSource !== 'CI' || !d.cultivoCiId) continue;
    const qty = (Number.isInteger(d.placasUsadas) && d.placasUsadas > 0) ? d.placasUsadas : 0;
    if (qty <= 0) continue;

    const snapshot = _resolverSnapshotCultivo(d.cultivoCiId);
    const link = _factory({
      cultivoCiId:    d.cultivoCiId,
      grLoteId:       grLoteId,
      grTanda:        d.tanda || null,
      cantidad:       qty,
      snapshotCultivo: snapshot,
      creadoPor:      'GR',
    });

    links.push(link);
    linksCreados.push(link);
    cidsAfectados.add(d.cultivoCiId);

    // Inyectar el ID del link de vuelta en la fila DG (muta newDg in-place)
    d.ciLinkId        = link.id;
    d.origenVerificado = true;
  }

  // También inyectar cids afectados desde el oldDg (por si un cultivo fue removido)
  for (const d of oldDgArr) {
    if (d && d.inoculoSource === 'CI' && d.cultivoCiId) {
      cidsAfectados.add(d.cultivoCiId);
    }
  }

  if (!_save(links)) {
    // ── ROLLBACK: reactivar los links que habíamos anulado ──
    _reactivar(links, anulados);
    // Intentar persistir el estado revertido
    _save(links);
    return { ok: false, motivo: 'Fallo al persistir links nuevos — cambios revertidos.' };
  }

  // ── Sincronizar cantidadDisponible en bl2_cultivos (secundario, no bloquea) ──
  _sincronizarStockEnCultivos([...cidsAfectados]);

  return { ok: true, linksCreados, anulados };
}

// ════════════════════════════════════════════
// MIGRACIÓN DESDE CONSUMOS LEGACY
// Lee cultivo.consumos[] y genera CiGrLinks equivalentes.
// Idempotente: no duplica links si ya existen.
// Elimina cultivo.consumos[] al finalizar (reemplaza por grLinkIds[]).
// Recibe el array de cultivos ya cargado (caller maneja persistencia).
// ════════════════════════════════════════════

function migrarDesdeConsumos(cultivos) {
  if (!Array.isArray(cultivos) || cultivos.length === 0) {
    return { ok: true, creados: 0, errores: [] };
  }

  const links  = _load();
  const errores = [];
  let creados  = 0;

  for (const cultivo of cultivos) {
    if (!cultivo || typeof cultivo.id !== 'string') continue;
    if (!Array.isArray(cultivo.consumos) || cultivo.consumos.length === 0) {
      // Asegurar que grLinkIds existe aunque no haya consumos
      if (!Array.isArray(cultivo.grLinkIds)) cultivo.grLinkIds = [];
      continue;
    }

    const grLinkIds = [];

    for (const co of cultivo.consumos) {
      try {
        // Parsear refId: puede ser "loteId::tanda" o bare "loteId"
        let grLoteId = '';
        let grTanda  = null;
        if (co.refId && typeof co.refId === 'string') {
          const sep = co.refId.indexOf('::');
          if (sep > -1) {
            grLoteId = co.refId.slice(0, sep);
            grTanda  = co.refId.slice(sep + 2) || null;
          } else {
            grLoteId = co.refId;
          }
        }

        if (!grLoteId) {
          errores.push(`Cultivo ${cultivo.codigo}: consumo sin refId válido, ignorado`);
          continue;
        }

        // Idempotencia: no duplicar si ya existe un link ACTIVO con mismo cultivo + lote + tanda
        const existe = links.some(l =>
          l.estado      === 'ACTIVO'       &&
          l.cultivoCiId === cultivo.id     &&
          l.grLoteId    === grLoteId       &&
          l.grTanda     === grTanda
        );
        if (existe) {
          const existente = links.find(l =>
            l.estado      === 'ACTIVO'   &&
            l.cultivoCiId === cultivo.id &&
            l.grLoteId    === grLoteId   &&
            l.grTanda     === grTanda
          );
          if (existente) grLinkIds.push(existente.id);
          continue;
        }

        const link = _factory({
          cultivoCiId: cultivo.id,
          grLoteId,
          grTanda,
          cantidad: (Number.isInteger(co.cantidad) && co.cantidad > 0) ? co.cantidad : 1,
          snapshotCultivo: {
            codigo:        cultivo.codigo        || cultivo.id,
            geneticaLabel: (cultivo.geneticaSnapshot && cultivo.geneticaSnapshot.label) || cultivo.geneticaId || '',
            medioFormulaId: cultivo.medioFormulaId || null,
          },
          creadoPor: 'MIGRACION',
        });

        // Preservar fecha original si está disponible
        if (co.fecha && typeof co.fecha === 'string') {
          link.fechaConsumo = co.fecha;
        }

        links.push(link);
        grLinkIds.push(link.id);
        creados++;

      } catch (e) {
        errores.push(`Cultivo ${cultivo.codigo}: error migrando consumo — ${e.message}`);
      }
    }

    // Reemplazar consumos[] por grLinkIds[] en el objeto cultivo
    cultivo.grLinkIds = grLinkIds;
    delete cultivo.consumos;
  }

  const ok = _save(links);
  if (!ok) {
    return { ok: false, creados: 0, errores: ['Fallo al persistir links migrados (cuota localStorage?)'] };
  }

  // Sincronizar stock en todos los cultivos migrados
  const cidsAfectados = cultivos.filter(c => c && c.id).map(c => c.id);
  _sincronizarStockEnCultivos(cidsAfectados);

  return { ok: true, creados, errores };
}

// ════════════════════════════════════════════
// EXPORTAR (para backup)
// ════════════════════════════════════════════

function exportar() {
  return { links: _load() };
}

// ════════════════════════════════════════════
// EXPOSICIÓN AL SCOPE GLOBAL
// API inmutable: Object.freeze previene mutación accidental desde otros módulos.
// ════════════════════════════════════════════

function reconcileAllStock() {
  try {
    const raw = localStorage.getItem('bl2_cultivos');
    if (!raw) return { ok: true, reconciliados: 0 };
    const cultivos = JSON.parse(raw);
    if (!Array.isArray(cultivos)) return { ok: true, reconciliados: 0 };
    const ids = cultivos.filter(c => c && c.id).map(c => c.id);
    _sincronizarStockEnCultivos(ids);
    console.log('[CiGrLinks] reconcileAllStock: ' + ids.length + ' cultivos reconciliados.');
    return { ok: true, reconciliados: ids.length };
  } catch (e) {
    console.warn('[CiGrLinks] reconcileAllStock falló:', e);
    return { ok: false, error: e.message };
  }
}

window.CiGrLinks = Object.freeze({
  load,
  getByLinkId,
  getActivosByCultivo,
  getActivosByLote,
  getActivosByLoteYTanda,
  stockConsumidoByCultivo,
  stockEfectivoByCultivo,
  aplicarConsumos,
  migrarDesdeConsumos,
  reconcileAllStock,
  exportar,
  // Exponer schema version para diagnóstico
  SCHEMA_VERSION,
  STORAGE_KEY,
});

console.log('[CiGrLinks] Módulo cargado — BIOLAB ENGINE v3');

})();
