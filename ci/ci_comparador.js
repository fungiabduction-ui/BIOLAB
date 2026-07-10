/* ============================================================
   BIOLAB ENGINE v3 — MÓDULO COMPARADOR DE FÓRMULAS CI
   ci_comparador.js — Selección y comparación visual de fórmulas
   ============================================================
   Reglas:
     · IIFE estricta. Sin globales fuera del closure.
     · No modifica lógica de ci_app.js ni cilab_app.js.
     · Usa window.cilabAnalizarFormula si está disponible.
       Fallback: calcula solo C/N de forma local.
     · Idempotente: activar/desactivar N veces sin residuos.
     · Sin setInterval/setTimeout sin limpiar.
   Orden de carga en HTML: ci_app.js → ci_comparador.js
   ============================================================ */

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════
  // ESTADO PRIVADO
  // ═══════════════════════════════════════════════════════════
  let compareMode      = false;
  let selectedFormulas = new Set(); // Set<string>  (formulaId)
  let keydownHandler   = null;

  // ═══════════════════════════════════════════════════════════
  // UTILIDADES
  // ═══════════════════════════════════════════════════════════
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function leerLocalArray(key) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return Array.isArray(v) ? v : [];
    } catch { return []; }
  }

  // ═══════════════════════════════════════════════════════════
  // OBTENCIÓN DE DATOS (helpers con fallback a localStorage)
  // ═══════════════════════════════════════════════════════════
  function obtenerFormulas() {
    if (typeof window.getForms === 'function') {
      try {
        const v = window.getForms();
        if (Array.isArray(v)) return v;
      } catch { /* fallthrough */ }
    }
    return leerLocalArray('bl2_forms');
  }

  function obtenerIngredientes() {
    if (typeof window.getIngredientes === 'function') {
      try {
        const v = window.getIngredientes();
        if (Array.isArray(v) && v.length) return v;
      } catch { /* fallthrough */ }
    }
    return leerLocalArray('bl2_ings');
  }

  // ═══════════════════════════════════════════════════════════
  // CÁLCULO LOCAL C/N  (espejo de ci_app.js — solo fallback)
  // ═══════════════════════════════════════════════════════════
  function calcularCNLocal(ingRows, allIngs) {
    let c = 0, n = 0, masa = 0;
    ingRows.forEach(ing => {
      const live  = allIngs.find(x => x.id === ing.id);
      const i     = ing.snapshot ? { id: ing.id, ...ing.snapshot } : live;
      if (!i) return;
      const qty   = ing.qty ?? ing.cant ?? 0;
      const proy  = ing.proy || 0;
      const qtyGr = (i.unidad || '').toLowerCase() === 'mg' ? qty / 1000 : qty;
      const qtyPr = qtyGr * (1 + proy / 100);
      let aC = 0, aN = 0;
      if      (i.pc > 0)               aC = qtyPr * (i.pc / 100);
      else if (i.aspecto === 'Carbono') aC = qtyPr;
      if      (i.pn > 0)                 aN = qtyPr * (i.pn / 100);
      else if (i.aspecto === 'Nitrógeno') aN = qtyPr;
      c += aC; n += aN; masa += qtyGr;
    });
    return { c, n, masa, cn: n > 0 ? c / n : null };
  }

  // ═══════════════════════════════════════════════════════════
  // ANÁLISIS DE UNA FÓRMULA
  // ═══════════════════════════════════════════════════════════
  function obtenerAnalisis(formulaId) {
    // Prioridad: CILAB si está disponible
    if (typeof window.cilabAnalizarFormula === 'function') {
      try {
        const r = window.cilabAnalizarFormula(formulaId);
        if (r) return r;
      } catch { /* fallthrough */ }
    }
    // Fallback local: solo C/N
    const forms = obtenerFormulas();
    const f     = forms.find(x => x.id === formulaId);
    if (!f) return null;
    const allIngs    = obtenerIngredientes();
    const ingsSorted = [...(f.ingredientes || [])].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
    const { cn }     = calcularCNLocal(ingsSorted, allIngs);
    return {
      score: null,
      cn:    cn !== null ? Math.round(cn * 10) / 10 : null,
      rutas: null,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // MODO SELECCIÓN — ACTIVAR
  // ═══════════════════════════════════════════════════════════
  function activarModoComparacion() {
    if (compareMode) return;
    compareMode = true;
    selectedFormulas.clear();

    const grid = document.getElementById('ci-dashboard-grid');
    if (!grid) { compareMode = false; return; }

    // Interceptar onclick de cada tile
    grid.querySelectorAll('.ci-dash-tile').forEach(tile => {
      const orig = tile.getAttribute('onclick') || '';
      tile.dataset.cmpOrigOnclick = orig;
      tile.removeAttribute('onclick');
      tile.classList.add('ci-selectable');
      tile.addEventListener('click', _onTileClick);
    });

    // ESC: cerrar modal si está abierto; si no, salir del modo
    keydownHandler = function (e) {
      if (e.key !== 'Escape') return;
      const modal = document.getElementById('ci-compare-modal');
      if (modal) _cerrarModal();
      else       desactivarModoComparacion();
    };
    document.addEventListener('keydown', keydownHandler);

    _mostrarContador();
  }

  // ═══════════════════════════════════════════════════════════
  // MODO SELECCIÓN — DESACTIVAR  (limpia TODO)
  // ═══════════════════════════════════════════════════════════
  function desactivarModoComparacion() {
    if (!compareMode) return;
    compareMode = false;
    selectedFormulas.clear();

    // Restaurar tiles
    const grid = document.getElementById('ci-dashboard-grid');
    if (grid) {
      grid.querySelectorAll('.ci-dash-tile').forEach(tile => {
        tile.classList.remove('ci-selected', 'ci-selectable');
        tile.removeEventListener('click', _onTileClick);
        const orig = tile.dataset.cmpOrigOnclick;
        if (orig) {
          tile.setAttribute('onclick', orig);
          delete tile.dataset.cmpOrigOnclick;
        }
      });
    }

    // Limpiar listener ESC
    if (keydownHandler) {
      document.removeEventListener('keydown', keydownHandler);
      keydownHandler = null;
    }

    // Limpiar UI
    _removerContador();
    const modal = document.getElementById('ci-compare-modal');
    if (modal) modal.remove();
  }

  // ═══════════════════════════════════════════════════════════
  // TILE — click handler (privado, referencia estable para removeEventListener)
  // ═══════════════════════════════════════════════════════════
  function _onTileClick(e) {
    e.preventDefault();
    e.stopPropagation();

    const tile  = e.currentTarget;
    const orig  = tile.dataset.cmpOrigOnclick || '';
    const match = orig.match(/ciDashOpenFormula\('([^']+)'\)/);
    const frmId = match ? match[1] : null;
    if (!frmId) return;

    if (selectedFormulas.has(frmId)) {
      selectedFormulas.delete(frmId);
      tile.classList.remove('ci-selected');
    } else {
      selectedFormulas.add(frmId);
      tile.classList.add('ci-selected');
    }
    _actualizarContador();
  }

  // ═══════════════════════════════════════════════════════════
  // CONTADOR FLOTANTE
  // ═══════════════════════════════════════════════════════════
  function _mostrarContador() {
    _removerContador();
    const el = document.createElement('div');
    el.id        = 'ci-compare-counter';
    el.className = 'ci-compare-counter';
    el.innerHTML = `
      <span class="ci-cmp-cnt-label">Seleccionadas: <strong id="ci-cmp-cnt-num">0</strong></span>
      <button class="ci-cmp-cnt-btn" id="ci-cmp-cnt-do"
              onclick="window.ciComparador.compararSeleccionadas()" disabled>
        📊 Comparar (0)
      </button>
      <button class="ci-cmp-cnt-cancel"
              onclick="window.ciComparador.desactivarModoComparacion()">✕ Cancelar</button>`;
    document.body.appendChild(el);
  }

  function _removerContador() {
    const el = document.getElementById('ci-compare-counter');
    if (el) el.remove();
  }

  function _actualizarContador() {
    const numEl = document.getElementById('ci-cmp-cnt-num');
    const btnEl = document.getElementById('ci-cmp-cnt-do');
    const n = selectedFormulas.size;
    if (numEl) numEl.textContent = n;
    if (btnEl) {
      btnEl.textContent = `📊 Comparar (${n})`;
      btnEl.disabled    = n < 2;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // COMPARACIÓN — ejecutar análisis y mostrar modal
  // ═══════════════════════════════════════════════════════════
  function compararSeleccionadas() {
    if (selectedFormulas.size < 2) return;
    const forms      = obtenerFormulas();
    const resultados = [...selectedFormulas].map(id => {
      const f = forms.find(x => x.id === id);
      return {
        id,
        nombre:   f ? f.nombre : id,
        analisis: obtenerAnalisis(id),
      };
    });
    _renderizarModal(resultados);
  }

  // ═══════════════════════════════════════════════════════════
  // MODAL DE RESULTADOS
  // ═══════════════════════════════════════════════════════════
  function _renderizarModal(resultados) {
    const existing = document.getElementById('ci-compare-modal');
    if (existing) existing.remove();

    const cilabActivo = typeof window.cilabAnalizarFormula === 'function';

    // ── helpers de color ──
    function cnColor(cn) {
      if (cn == null) return 'var(--tx3)';
      if (cn >= 6 && cn <= 18) return '#00CC33';
      if (cn >= 4 && cn <= 22) return '#F5A623';
      return '#FF4444';
    }
    function scoreColor(s) {
      if (s == null) return 'var(--tx3)';
      if (s >= 70)   return '#00CC33';
      if (s >= 40)   return '#F5A623';
      return '#FF4444';
    }
    function rutaIcon(status) {
      if (!status)              return `<span style="color:var(--tx3)">?</span>`;
      if (status === 'ACTIVA')  return `<span style="color:#00CC33" title="Activa">✓</span>`;
      if (status === 'LIMITADA')return `<span style="color:#F5A623" title="Limitada">△</span>`;
      return                           `<span style="color:#FF4444" title="Inactiva">✗</span>`;
    }
    function rutaLabel(status) {
      if (!status)              return `<span style="color:var(--tx3);font-size:10px">—</span>`;
      return `<span style="color:var(--tx3);font-size:10px;margin-left:3px">${esc(status)}</span>`;
    }

    // ── filas de tabla ──
    const filas = resultados.map(r => {
      const a      = r.analisis;
      const cn     = a?.cn  != null ? a.cn.toFixed(1)  : '—';
      const score  = a?.score != null ? a.score         : null;
      const noPkg  = a?.rutas?.N2_NO_PKG || null;
      const sam    = a?.rutas?.N3_SAM    || null;
      const chitin = a?.rutas?.N3_CHITIN  || null;

      const celdaCilab = cilabActivo
        ? `<td class="ci-cmp-td ci-cmp-td-num" style="color:${scoreColor(score)}">
             ${score !== null ? score : '—'}
           </td>
           <td class="ci-cmp-td ci-cmp-td-ruta">
             ${rutaIcon(noPkg)}${rutaLabel(noPkg)}
           </td>
           <td class="ci-cmp-td ci-cmp-td-ruta">
             ${rutaIcon(sam)}${rutaLabel(sam)}
           </td>
           <td class="ci-cmp-td ci-cmp-td-ruta">
             ${rutaIcon(chitin)}${rutaLabel(chitin)}
           </td>`
        : `<td class="ci-cmp-td" colspan="4"
               style="text-align:center;color:var(--tx3);font-size:11px">
             CILAB no disponible
           </td>`;

      return `
        <tr class="ci-cmp-row">
          <td class="ci-cmp-td ci-cmp-td-name">
            <div style="font-weight:600;color:var(--tx)">${esc(r.nombre)}</div>
            <div style="font-size:10px;color:var(--tx3);font-family:'JetBrains Mono',monospace">${esc(r.id)}</div>
          </td>
          <td class="ci-cmp-td ci-cmp-td-num" style="color:${cnColor(a?.cn)}">${cn}</td>
          ${celdaCilab}
        </tr>`;
    }).join('');

    // ── encabezado tabla ──
    const encCilab = cilabActivo
      ? `<th class="ci-cmp-th">Score</th>
         <th class="ci-cmp-th">NO/PKG</th>
         <th class="ci-cmp-th">SAM</th>
         <th class="ci-cmp-th">CHITIN</th>`
      : `<th class="ci-cmp-th" colspan="4" style="color:var(--tx3)">Rutas (CILAB)</th>`;

    // ── nota de fallback ──
    const nota = !cilabActivo
      ? `<div class="ci-compare-note">
           ⚠ CILAB no está cargado — solo se muestra C/N calculado localmente.
         </div>`
      : '';

    // ── construir modal ──
    const modal = document.createElement('div');
    modal.id        = 'ci-compare-modal';
    modal.className = 'ci-compare-modal';
    modal.innerHTML = `
      <div class="ci-compare-backdrop" id="ci-cmp-backdrop"></div>
      <div class="ci-compare-dialog" role="dialog" aria-modal="true"
           aria-label="Comparador de fórmulas">
        <div class="ci-compare-header">
          <span class="ci-compare-title">📊 Comparar fórmulas</span>
          <button class="ci-compare-close" id="ci-cmp-close-x" title="Cerrar (ESC)">✕</button>
        </div>
        <div class="ci-compare-body">
          <div class="ci-compare-table-wrap">
            <table class="ci-compare-table">
              <thead>
                <tr>
                  <th class="ci-cmp-th ci-cmp-th-name">Fórmula</th>
                  <th class="ci-cmp-th">C/N</th>
                  ${encCilab}
                </tr>
              </thead>
              <tbody>${filas}</tbody>
            </table>
          </div>
          ${nota}
        </div>
        <div class="ci-compare-footer">
          <button class="ci-compare-btn-cancel"
                  onclick="window.ciComparador.desactivarModoComparacion()">
            ✕ Salir del modo comparación
          </button>
          <button class="ci-compare-btn-cerrar" id="ci-cmp-close-btn">
            Cerrar
          </button>
        </div>
      </div>`;

    document.body.appendChild(modal);

    // Bind cierre (backdrop + botones)
    document.getElementById('ci-cmp-backdrop').addEventListener('click', _cerrarModal);
    document.getElementById('ci-cmp-close-x').addEventListener('click', _cerrarModal);
    document.getElementById('ci-cmp-close-btn').addEventListener('click', _cerrarModal);
  }

  function _cerrarModal() {
    const modal = document.getElementById('ci-compare-modal');
    if (modal) modal.remove();
    // El modo selección queda activo — el usuario puede cambiar la selección y volver a comparar
  }

  // ═══════════════════════════════════════════════════════════
  // ESTILOS  (inyectados una sola vez, idempotente)
  // ═══════════════════════════════════════════════════════════
  function _inyectarEstilos() {
    if (document.getElementById('ci-comparador-styles')) return;
    const style = document.createElement('style');
    style.id = 'ci-comparador-styles';
    style.textContent = `

      /* ── Botón en barra del dashboard ── */
      .ci-dash-compare-btn {
        display: inline-flex; align-items: center; gap: 5px;
        background: rgba(0,204,51,0.08);
        border: 1px solid rgba(0,204,51,0.35);
        color: #00CC33;
        border-radius: 6px;
        padding: 0 12px;
        height: 24px;
        font-size: 11px;
        font-family: 'JetBrains Mono', monospace;
        font-weight: 700;
        letter-spacing: .3px;
        cursor: pointer;
        transition: background .15s, border-color .15s;
      }
      .ci-dash-compare-btn:hover {
        background: rgba(0,204,51,0.18);
        border-color: rgba(0,204,51,0.6);
      }

      /* ── Tiles en modo selección ── */
      .ci-selectable {
        cursor: pointer !important;
        transition: box-shadow .15s, outline .15s;
      }
      .ci-selectable:hover { opacity: 0.88; }
      .ci-selected {
        outline: 2px solid #00CC33 !important;
        box-shadow: 0 0 0 4px rgba(0,204,51,0.2) !important;
      }

      /* ── Contador flotante ── */
      .ci-compare-counter {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 9998;
        display: flex;
        align-items: center;
        gap: 10px;
        background: var(--bg-secondary, #1a1a2e);
        border: 1px solid rgba(0,204,51,0.4);
        border-radius: 10px;
        padding: 10px 16px;
        box-shadow: 0 4px 24px rgba(0,0,0,0.5);
        font-family: 'JetBrains Mono', monospace;
        font-size: 12px;
        color: var(--tx, #e0e0e0);
      }
      .ci-cmp-cnt-label { color: var(--tx3, #888); white-space: nowrap; }
      .ci-cmp-cnt-btn {
        background: rgba(0,204,51,0.12);
        border: 1px solid rgba(0,204,51,0.4);
        color: #00CC33;
        border-radius: 6px;
        padding: 5px 14px;
        font-size: 12px;
        font-family: 'JetBrains Mono', monospace;
        font-weight: 700;
        cursor: pointer;
        white-space: nowrap;
        transition: background .15s;
      }
      .ci-cmp-cnt-btn:hover:not(:disabled) { background: rgba(0,204,51,0.24); }
      .ci-cmp-cnt-btn:disabled { opacity: 0.38; cursor: default; }
      .ci-cmp-cnt-cancel {
        background: none;
        border: 1px solid var(--border, #333);
        color: var(--tx3, #888);
        border-radius: 6px;
        padding: 5px 10px;
        font-size: 11px;
        font-family: 'JetBrains Mono', monospace;
        cursor: pointer;
        white-space: nowrap;
        transition: border-color .15s, color .15s;
      }
      .ci-cmp-cnt-cancel:hover {
        border-color: var(--er, #ff4444);
        color: var(--er, #ff4444);
      }

      /* ── Modal overlay ── */
      .ci-compare-modal {
        position: fixed;
        inset: 0;
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .ci-compare-backdrop {
        position: absolute;
        inset: 0;
        background: rgba(0,0,0,0.62);
        backdrop-filter: blur(2px);
      }

      /* ── Modal dialog ── */
      .ci-compare-dialog {
        position: relative;
        background: var(--bg-secondary, #1a1a2e);
        border: 1px solid rgba(0,204,51,0.3);
        border-radius: 12px;
        width: min(92vw, 840px);
        max-height: 82vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        box-shadow: 0 8px 48px rgba(0,0,0,0.65);
      }
      .ci-compare-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 20px;
        border-bottom: 1px solid var(--border, #333);
        flex-shrink: 0;
      }
      .ci-compare-title {
        font-family: 'JetBrains Mono', monospace;
        font-size: 13px;
        font-weight: 700;
        color: #00CC33;
        letter-spacing: 1px;
      }
      .ci-compare-close {
        background: none;
        border: none;
        color: var(--tx3, #888);
        font-size: 17px;
        cursor: pointer;
        padding: 2px 7px;
        border-radius: 4px;
        line-height: 1;
        transition: color .15s, background .15s;
      }
      .ci-compare-close:hover {
        color: var(--tx, #e0e0e0);
        background: rgba(255,255,255,0.07);
      }
      .ci-compare-body {
        overflow-y: auto;
        padding: 20px;
        flex: 1;
      }
      .ci-compare-table-wrap { overflow-x: auto; }

      /* ── Tabla de resultados ── */
      .ci-compare-table {
        width: 100%;
        border-collapse: collapse;
        font-family: 'JetBrains Mono', monospace;
        font-size: 12px;
      }
      .ci-cmp-th {
        text-align: center;
        padding: 8px 14px;
        background: var(--bg-tertiary, #1d1d2e);
        color: var(--tx3, #888);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 1.5px;
        text-transform: uppercase;
        border-bottom: 1px solid var(--border, #333);
        white-space: nowrap;
      }
      .ci-cmp-th-name { text-align: left; padding-left: 16px; }
      .ci-cmp-td {
        padding: 10px 14px;
        border-bottom: 1px solid rgba(255,255,255,0.05);
        vertical-align: middle;
      }
      .ci-cmp-td-name { min-width: 200px; padding-left: 16px; }
      .ci-cmp-td-num  {
        text-align: center;
        font-weight: 700;
        font-size: 15px;
      }
      .ci-cmp-td-ruta {
        text-align: center;
        white-space: nowrap;
      }
      .ci-cmp-row:last-child .ci-cmp-td { border-bottom: none; }
      .ci-cmp-row:hover .ci-cmp-td {
        background: rgba(255,255,255,0.025);
      }

      /* ── Nota de fallback ── */
      .ci-compare-note {
        margin-top: 14px;
        padding: 9px 14px;
        background: rgba(245,166,35,0.08);
        border: 1px solid rgba(245,166,35,0.3);
        border-radius: 6px;
        color: #F5A623;
        font-size: 11px;
        font-family: 'JetBrains Mono', monospace;
      }

      /* ── Footer ── */
      .ci-compare-footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 10px;
        padding: 14px 20px;
        border-top: 1px solid var(--border, #333);
        flex-shrink: 0;
      }
      .ci-compare-btn-cerrar {
        background: rgba(0,204,51,0.08);
        border: 1px solid rgba(0,204,51,0.35);
        color: #00CC33;
        border-radius: 6px;
        padding: 7px 20px;
        font-size: 12px;
        font-family: 'JetBrains Mono', monospace;
        font-weight: 700;
        cursor: pointer;
        transition: background .15s;
      }
      .ci-compare-btn-cerrar:hover { background: rgba(0,204,51,0.2); }
      .ci-compare-btn-cancel {
        background: none;
        border: 1px solid var(--border, #333);
        color: var(--tx3, #888);
        border-radius: 6px;
        padding: 7px 14px;
        font-size: 11px;
        font-family: 'JetBrains Mono', monospace;
        cursor: pointer;
        transition: border-color .15s, color .15s;
      }
      .ci-compare-btn-cancel:hover {
        border-color: var(--er, #ff4444);
        color: var(--er, #ff4444);
      }
    `;
    document.head.appendChild(style);
  }

  // ═══════════════════════════════════════════════════════════
  // API PÚBLICA
  // ═══════════════════════════════════════════════════════════
  window.ciComparador = {
    activarModoComparacion,
    desactivarModoComparacion,
    compararSeleccionadas,
  };

  // Inyectar estilos al cargar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _inyectarEstilos);
  } else {
    _inyectarEstilos();
  }

})();
