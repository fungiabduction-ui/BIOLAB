/* ============================================================
   shared/gr_su_sources.js
   Normalización canónica de fuentes GR de una fila db[]/dg[]
   (formato nuevo grSources[] + formato legacy grLoteId/grTandaId/grUsados flat).
   Usada por GR (dg[]) y SU (db[]) — antes cada módulo mantenía su propia
   copia divergente (grNormSources en gr_app.js, suDbNormSources en su_app.js).
   Unificado 2026-07-10 tras auditoría que encontró comportamiento distinto
   entre ambas copias para entradas de grSources[] sin grLoteId propio.
   ============================================================ */
(function () {
  'use strict';

  /**
   * normalize(row, grLoteDefault)
   *   - Nuevo formato: itera row.grSources[] (array de { grLoteId, grTandaId, grUsados }),
   *     aplicando fallback a grLoteDefault si una entrada no trae grLoteId propio.
   *   - Legacy: usa campos flat row.grLoteId/row.grTandaId/row.grUsados, mismo fallback.
   *   Devuelve siempre un array (puede ser vacío) de { grLoteId, grTandaId, grUsados }.
   */
  function normalize(row, grLoteDefault) {
    if (!row || typeof row !== 'object') return [];
    var lo = grLoteDefault || '';
    if (Array.isArray(row.grSources) && row.grSources.length > 0) {
      return row.grSources
        .map(function (s) {
          return {
            grLoteId:  String((s && s.grLoteId)  || lo || '').trim() || null,
            grTandaId: String((s && s.grTandaId) || ''      ).trim() || null,
            grUsados:  parseInt(s && s.grUsados, 10) || 0,
          };
        })
        .filter(function (s) { return s.grLoteId && s.grTandaId; });
    }
    var loteId  = String(row.grLoteId  || lo             || '').trim() || null;
    var tandaId = String(row.grTandaId || row.grano || '').trim() || null;
    if (loteId && tandaId) {
      return [{ grLoteId: loteId, grTandaId: tandaId, grUsados: parseInt(row.grUsados, 10) || 0 }];
    }
    return [];
  }

  window.GrSuSources = Object.freeze({ normalize: normalize });
})();
