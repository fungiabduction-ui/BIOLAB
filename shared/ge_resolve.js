/*
   shared/ge_resolve.js
   ─────────────────────
   SSoT del primitivo "resolver un nodo de biolab.ge.v4 por id, leyendo el árbol
   crudo desde localStorage, sin filtrar por status (activo/archivado)".

   Historia (2026-08-26, deuda técnica de MEJ-0048/MEJ-0050): esta misma lógica
   (JSON.parse de 'biolab.ge.v4' + reconstrucción de la cadena parentId hasta la
   raíz) vivía copiada 3 veces — ci_app.js (_ciResolverGeneticaSnapshot), fr_app.js
   (bloque de enriquecimiento de grSources, ~línea 711) y gr_app.js
   (grGetNombreGeneticaPorId, fallback agregado por MEJ-0048). Cada copia hacía
   ADEMÁS su propio post-procesamiento distinto (CI arma {codigoGE,label,especie,
   cepa,fenotipo}; FR arma un string unido con ' / ' que después re-parsea
   partiendo por '/'; GR arma el mismo string unido con ' / ') — eso NO se unificó
   acá a propósito: los 3 call sites siguen construyendo su propio shape desde
   `chain`, solo el walk crudo del árbol se comparte. Unificar también el shape
   de salida es un cambio de superficie más grande (cada consumidor de cada shape
   tendría que auditarse por separado) y no es necesario para eliminar la
   duplicación real.

   Por qué existe como script separado (no un módulo del loader, mismo criterio
   que shared/error_log.js): necesita estar disponible sin importar qué módulo
   esté montado — CI/FR/GR lo cargan cada uno en su propio *_index.html, antes
   de su *_app.js, mismo patrón que shared/gr_su_sources.js.
*/
(function () {
  'use strict';

  /**
   * Lee 'biolab.ge.v4' de localStorage y reconstruye la cadena de ancestros
   * (raíz → nodo) para un id de nodo dado, SIN filtrar por status — a
   * diferencia de window.ge.getSelectableGenetics() (que sí filtra activos),
   * esta función encuentra un nodo archivado igual que uno activo. Es el
   * fallback que cada módulo debe intentar cuando la API en memoria de GE
   * (si está montada) no encuentra el id.
   *
   * @param {string} nodeId
   * @returns {{node: object, chain: object[]} | null} null si no hay
   *   localStorage['biolab.ge.v4'], si no parsea, o si el nodo no existe.
   *   `chain` va de la raíz al nodo (chain[chain.length-1] === node).
   */
  function resolverNodoCrudo(nodeId) {
    if (!nodeId) return null;
    try {
      const raw = localStorage.getItem('biolab.ge.v4');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
      const getNode = (id) => nodes.find((n) => n.id === id) || null;
      const node = getNode(nodeId);
      if (!node) return null;
      const chain = [];
      let cur = node;
      while (cur) { chain.unshift(cur); cur = cur.parentId ? getNode(cur.parentId) : null; }
      return { node, chain };
    } catch (e) {
      return null;
    }
  }

  window.GEResolve = { resolverNodoCrudo };
})();
