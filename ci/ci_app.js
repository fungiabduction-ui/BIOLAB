/* ============================================================
   BIOLAB ENGINE v3 — MÓDULO CI (Cultivo In Vitro)
   ci_app.js — Motor de cálculo, formulación, SEG, DnD, localStorage
   ============================================================ */

'use strict';

// ════════════════════════════════════════════
// IIFE — aísla el scope del módulo CI del monolito global
// ════════════════════════════════════════════
(function () {
'use strict';

// ════════════════════════════════════════════
// CONSTANTES Y STORAGE KEYS
// ════════════════════════════════════════════
const K = {
  ings:     'bl2_ings',         // biblioteca ingredientes CI
  forms:    'bl2_forms',        // fórmulas magistrales
  seg:      'bl2_seg',          // campo de trabajo CI (tandas)
  cultivos: 'bl2_cultivos',     // [Fase 1] inóculos validados (Cultivo CI)
  exp:      'bl2_experimentos', // Modo Experimento — comparativas por frasco
  labMeta:  'bl2_lab_meta',     // LEGACY CILAB: fallback read-only export/import
};

// Paleta de colores por aspecto
const ASP_COLORS = {
  'Solvente':    '#44AAFF',
  'Soporte':     '#A0A0A0',
  'Carbono':     '#70AD47',
  'Nitrógeno':   '#7C6FFF',
  'Mineral':     '#ED7D31',
  'Cofactores':  '#FF6B35',
};

// Catálogo mínimo de rutas para edición en CI Config.
// CILAB mantiene el grafo fisiológico completo; este puente sólo evita que CI
// dependa de que CILAB esté montado para editar ing.bio.rutas.
const CI_ROUTE_DEFS = [
  { id: 'N0_GRADIENT', short: 'Gradiente', color: '#A0A0A0' },
  { id: 'N1_GLYC', short: 'ATP base', color: '#FFC000' },
  { id: 'N1_ETC', short: 'ETC', color: '#FF6B35' },
  { id: 'N2_ODC', short: 'ODC', color: '#7C6FFF' },
  { id: 'N2_NO_PKG', short: 'NO / PKG', color: '#FF6B35' },
  { id: 'N3_SAM', short: 'SAM', color: '#44AAFF' },
  { id: 'N3_CHITIN', short: 'Quitina', color: '#70AD47' },
  { id: 'N3_SPITZ', short: 'Spitzenkörper', color: '#00CC33' },
];

// ── Chips de unidad — colores por tipo ──────────────────────────────────────
const UNIT_COLORS = {
  gr:  { bg: 'rgba(112,173,71,0.15)',  border: 'rgba(112,173,71,0.5)',  color: '#70AD47' },
  ml:  { bg: 'rgba(68,170,255,0.15)', border: 'rgba(68,170,255,0.5)', color: '#44AAFF' },
  mg:  { bg: 'rgba(237,125,49,0.15)', border: 'rgba(237,125,49,0.5)', color: '#ED7D31' },
  ud:  { bg: 'rgba(160,160,160,0.12)',border: 'rgba(160,160,160,0.45)',color: '#A0A0A0' },
};
const _UNIT_DEF = { bg: 'rgba(160,160,160,0.10)', border: 'rgba(160,160,160,0.35)', color: '#888' };

/** Devuelve el HTML del chip de unidad. Vacío si unit es falsy. */
function unitChipHtml(unit) {
  if (!unit) return '';
  const c = UNIT_COLORS[unit] || _UNIT_DEF;
  return `<span style="display:inline-flex;align-items:center;font-size:9px;font-weight:700;` +
    `font-family:'JetBrains Mono',monospace;padding:1px 5px;border-radius:3px;` +
    `background:${c.bg};border:1px solid ${c.border};color:${c.color};white-space:nowrap">` +
    `${esc(unit)}</span>`;
}

// ── Ingredientes por defecto (movidos a CILAB / semilla controlada por allá) ──

// ════════════════════════════════════════════
// HELPERS DE STORAGE
// ════════════════════════════════════════════
function gDB(k) {
  try {
    const parsed = JSON.parse(localStorage.getItem(k));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
function sDB(k, d) {
  try {
    localStorage.setItem(k, JSON.stringify(d));
    return true;
  } catch (e) {
    console.error('[CI] sDB: fallo al guardar "' + k + '":', e);
    return false;
  }
}
function gOb(k, def) {
  try {
    const v = JSON.parse(localStorage.getItem(k));
    return (v !== null && v !== undefined) ? v : def;
  } catch { return def; }
}
function sOb(k, d) {
  try {
    localStorage.setItem(k, JSON.stringify(d));
    return true;
  } catch (e) {
    console.error('[CI] sOb: fallo al guardar "' + k + '":', e);
    return false;
  }
}

function ciDispatchIngsChanged(tipo, ingId, extra) {
  try {
    window.dispatchEvent(new CustomEvent('cilab-ings-changed', {
      detail: Object.assign({ source: 'CI', tipo, ingId: ingId || null }, extra || {}),
    }));
  } catch (e) { /* no crítico */ }
}

// ── Funciones bio eliminadas: CI ya no edita ingredientes.
// El editor vive en CILAB (Single Source of Truth).

// ════════════════════════════════════════════
// PUENTES CI → CILAB (navegación de módulo)
// ════════════════════════════════════════════
/** Pide a main.js que cambie al módulo CILAB. */
function ciIrACilab() {
  if (typeof window.loadModule === 'function') {
    window.loadModule('CILAB');
  } else {
    sN('Abrí el módulo CILAB desde el menú principal', false);
  }
}

/** Va a CILAB y activa la pestaña Biblioteca para crear un ingrediente. */
function ciIrACilabCrear() {
  ciIrACilab();
  // Pequeño delay para que CILAB cargue antes de invocar su subtab
  setTimeout(() => {
    if (typeof window.clabSubTab === 'function') window.clabSubTab('biblioteca');
    if (typeof window.cilabCrearIngrediente === 'function') window.cilabCrearIngrediente();
  }, 400);
}

function ciParseRange(minId, maxId) {
  const minRaw = document.getElementById(minId)?.value ?? '';
  const maxRaw = document.getElementById(maxId)?.value ?? '';
  if (minRaw === '' && maxRaw === '') return null;
  const min = parseFloat(minRaw);
  const max = parseFloat(maxRaw);
  if (!isFinite(min) || !isFinite(max) || max < min) return false;
  return { min, max };
}

// ── Las funciones ciReadBioFromForm / ciLoadBioIntoForm / ciRenderBioRouteControls
// y sus helpers (ciParseAlertas, ciGetSelectedBioRoutes, ciToggleBioRouteChip,
// ciOnBioRouteModeChange, ciUpdateContribSum) han sido eliminadas.
// CILAB es ahora el único editor de ingredientes y metadata bio.

// ════════════════════════════════════════════
// FUENTE DE INGREDIENTES — delegación a CILAB
// CILAB es el Single Source of Truth de bl2_ings.
// CI solo lee. Si CILAB expone getIngredientes en
// window, lo usa directamente. Fallback: lectura
// directa del localStorage con DEFAULT_INGS.
// ════════════════════════════════════════════
function getIngredientes() {
  // Delegar al store reactivo si está disponible (cargado en index.html).
  // Fallback directo a localStorage para compatibilidad con entornos de test.
  if (window.IngStore) return window.IngStore.get();
  try {
    const arr = JSON.parse(localStorage.getItem(K.ings));
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.warn('[CI] bl2_ings corrupto, no se pudo parsear.', e);
    return [];
  }
}

function getForms() {
  let arr;
  try { arr = JSON.parse(localStorage.getItem(K.forms)); }
  catch { arr = null; }
  return Array.isArray(arr) ? arr : [];
}

window.getIngredientes = getIngredientes;
window.getForms        = getForms;

// ════════════════════════════════════════════
// HELPERS GLOBALES
// ════════════════════════════════════════════
function now()  { return new Date().toISOString(); }
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function nxtId(prefix, db) {
  const nums = db.map(x => x.id).filter(id => id && id.startsWith(prefix+'-'))
    .map(id => parseInt(id.split('-')[1]) || 0);
  return `${prefix}-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4,'0')}`;
}

function ciFormatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'})
       + ' ' + d.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'});
}

// Convierte 'YYYY-MM-DD' (legacy) o 'YYYY-MM-DDTHH:MM' (datetime-local) a Date.
function _segParseDate(val) {
  if (!val) return null;
  return new Date(val.length === 10 ? val + 'T12:00:00' : val);
}

// ── Notificación toast ──
let _notifTimer = null;
function sN(msg, isErr) {
  const el = document.getElementById('ci-notif');
  if (!el) return;
  el.textContent = msg;
  el.className = 'notif show' + (isErr ? ' err' : '');
  clearTimeout(_notifTimer);
  _notifTimer = setTimeout(() => el.className = 'notif', 3000);
}

// ════════════════════════════════════════════
// PESTAÑA CI — subtabs
// ════════════════════════════════════════════
function ciSubTab(name) {
  document.querySelectorAll('.ci-subtab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.citab === name);
  });
  document.querySelectorAll('.ci-subpanel').forEach(panel => {
    panel.style.display = panel.id === 'ci-sub-' + name ? '' : 'none';
  });
  if (name === 'cfg')       renderCfg();
  if (name === 'cultivos')  renderCultivosTab();
  if (name === 'dashboard') ciRenderDashboard();
}

// ════════════════════════════════════════════
// MOTOR DE CÁLCULO C/N
// ════════════════════════════════════════════

/**
 * Captura un snapshot inmutable de un ingrediente de la biblioteca.
 * Se almacena en Formula.ingredientes[].snapshot para preservar
 * el estado histórico del ingrediente al momento de formular.
 * @param {string} ingId
 * @param {Array}  allIngs — biblioteca de ingredientes
 * @returns {object|null}
 */
function _ingSnapshot(ingId, allIngs) {
  const i = allIngs.find(x => x.id === ingId);
  if (!i) return null;
  return {
    nombre:  i.nombre  || '',
    unidad:  i.unidad  || '',
    aspecto: i.aspecto || '',
    pc:      i.pc      || 0,
    pn:      i.pn      || 0,
    notas:   i.notas   || '',
  };
}

/**
 * Calcula C, N, masa total y devuelve filas enriquecidas.
 * Prefiere el snapshot capturado al momento de formular sobre el
 * ingrediente vivo — garantiza integridad histórica: editar la
 * biblioteca no altera fórmulas ya guardadas.
 * @param {Array} ingRows  — [{id, qty, proy?, snapshot?, ...}]
 * @param {Array} allIngs  — biblioteca de ingredientes (fallback)
 */
function calcCN(ingRows, allIngs) {
  let c = 0, n = 0, masa = 0;
  const rows = [];
  ingRows.forEach(ing => {
    // Snapshot tiene prioridad; fallback al ingrediente vivo (compatibilidad histórica)
    const live = allIngs.find(x => x.id === ing.id);
    const i    = ing.snapshot ? { id: ing.id, ...ing.snapshot } : live;
    if (!i) return; // fila huérfana: ingrediente eliminado sin snapshot
    const proy   = ing.proy || 0;
    const qty    = ing.qty ?? ing.cant ?? 0;
    // Normalizar a gramos para C/N: ingredientes en mg se dividen por 1000
    const qtyGr  = (i.unidad || '').toLowerCase() === 'mg' ? qty / 1000 : qty;
    const qtyProy = qtyGr * (1 + proy / 100);
    let aC = 0, aN = 0;
    if (i.pc > 0) aC = qtyProy * (i.pc / 100);
    else if (i.aspecto === 'Carbono')   aC = qtyProy;
    if (i.pn > 0) aN = qtyProy * (i.pn / 100);
    else if (i.aspecto === 'Nitrógeno') aN = qtyProy;
    // ⚠ Bug fix: masa usa qtyGr (gramos normalizados) — antes usaba qty cruda,
    // lo que causaba que un ingrediente de 744 mg apareciera como 744 g en la Masa KPI.
    c += aC; n += aN; masa += qtyGr;
    rows.push({ i, r: ing, aC, aN, qty, qtyGr, qtyProy, proy });
  });
  return { c, n, masa, rows };
}

// ════════════════════════════════════════════
// NUEVA FÓRMULA CI — Constructor
// ════════════════════════════════════════════
let ciNewPieChart = null;

function ciNewSessionInit() {
  const cont = document.getElementById('ci-new-rows');
  if (!cont) return;
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const dtStr = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const fechaEl = document.getElementById('ci-new-fecha');
  if (fechaEl) fechaEl.value = dtStr;
  const forms = gDB(K.forms);
  const idEl = document.getElementById('ci-new-id');
  if (idEl) idEl.value = nxtId('CI', forms);
  const nomEl = document.getElementById('ci-new-nombre');
  if (nomEl) nomEl.value = '';
  // Cancelar suscripciones al IngStore de cada fila antes de vaciar el DOM.
  cont.querySelectorAll('.drag-item[data-unsub]').forEach(row => {
    if (typeof row._ingUnsub === 'function') row._ingUnsub();
  });
  cont.innerHTML = ''; cont._dndInit = false;

  // Reset análisis y KPIs al estado vacío
  const analDiv = document.getElementById('ci-new-analisis');
  if (analDiv) analDiv.style.display = 'none';
  const cnBox = document.getElementById('ci-new-cn-box');
  if (cnBox) cnBox.style.display = 'none';
  ['ci-kpi-c','ci-kpi-n','ci-kpi-cn','ci-kpi-masa'].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = '—';
  });
  const emptyEl = document.getElementById('ci-new-pie-empty');
  if (emptyEl) emptyEl.style.display = 'flex';
  if (ciNewPieChart) { ciNewPieChart.destroy(); ciNewPieChart = null; }

  ciNewFrmAddRow();
}

function ciCargarComoBase(frmId) {
  var forms = gDB(K.forms);
  var f = forms.find(function(x) { return x.id === frmId; });
  if (!f || !f.ingredientes || !f.ingredientes.length) return;

  ciNewSessionInit();

  var cont = document.getElementById('ci-new-rows');
  if (!cont) return;
  cont.querySelectorAll('.drag-item').forEach(function(row) {
    if (typeof row._ingUnsub === 'function') row._ingUnsub();
  });
  cont.innerHTML = '';
  cont._dndInit = false;

  var nomEl = document.getElementById('ci-new-nombre');
  if (nomEl) nomEl.value = f.nombre + ' (copia)';

  var ingsSorted = f.ingredientes.slice().sort(function(a, b) { return (a.orden || 0) - (b.orden || 0); });
  ingsSorted.forEach(function(r) { ciNewFrmAddRow(r.id, r.qty); });

  ciSubTab('form');
}

function ciNewFrmAddRow(ingId, qty) {
  const cont = document.getElementById('ci-new-rows');
  if (!cont._dndInit) { cont._dndInit = true; initNewFrmDnd(cont); }

  const rid = 'cinew' + Date.now() + Math.floor(Math.random() * 9999);
  const div = document.createElement('div');
  div.id = rid; div.className = 'drag-item'; div.draggable = true;

  // Función pura: reconstruye las opciones del select preservando selección.
  function _fillSelect(sel, ings, defaultId) {
    const prev = sel.value || defaultId || '';
    sel.innerHTML = `<option value="">— Seleccionar ingrediente —</option>` +
      ings.map(i => `<option value="${i.id}"${i.id === prev ? ' selected' : ''}>${esc(i.nombre)} (${i.unidad})</option>`).join('');
    if (prev) sel.value = prev;
  }

  // Función pura: actualiza el chip de unidad según selección actual.
  function _fillUnit(sel, ings) {
    const unitSpan = div.querySelector('span.unit-chip');
    if (!unitSpan) return;
    const ing = ings.find(x => x.id === sel.value);
    unitSpan.innerHTML = unitChipHtml(ing?.unidad || '');
  }

  const initialIngs = getIngredientes();
  div.innerHTML = `
    <span class="drag-handle" title="Arrastrar">⠿</span>
    <select onchange="ciNewFrmCalc()" style="min-width:0;width:100%;overflow:hidden;text-overflow:ellipsis">
      <option value="">— Seleccionar ingrediente —</option>
    </select>
    <input type="number" placeholder="cant." min="0" step="0.01" value="${qty || ''}" oninput="ciNewFrmCalc()" style="width:100%">
    <span class="unit-chip" style="display:flex;align-items:center;justify-content:center;min-width:36px"></span>
    <button type="button" style="background:none;border:1px solid rgba(255,68,85,.3);color:var(--er);cursor:pointer;border-radius:2px;width:24px;height:24px;font-size:12px;display:flex;align-items:center;justify-content:center">✕</button>`;

  const sel = div.querySelector('select');

  // Poblar con datos actuales.
  _fillSelect(sel, initialIngs, ingId);
  _fillUnit(sel, initialIngs);

  // Suscribir al store: se actualiza automáticamente cuando bl2_ings cambia.
  const unsub = window.IngStore
    ? window.IngStore.subscribe(function (ings) {
        _fillSelect(sel, ings);
        _fillUnit(sel, ings);
        ciNewFrmCalc();
      })
    : () => {};

  // Guardar referencia para poder cancelar en ciNewSessionInit (remount).
  div._ingUnsub = unsub;

  // Al cambiar selección manualmente: actualizar unidad.
  sel.addEventListener('change', function () {
    _fillUnit(sel, getIngredientes());
    ciNewFrmCalc();
  });

  // Botón ✕: cancelar suscripción antes de remover del DOM.
  div.querySelector('button').addEventListener('click', function () {
    unsub();
    div.remove();
    ciNewFrmCalc();
  });

  cont.appendChild(div);
  ciNewFrmCalc();
}

function ciNewFrmCalc() {
  const ings = gDB(K.ings);
  const ingRows = [];
  document.querySelectorAll('#ci-new-rows .drag-item').forEach(row => {
    const sel = row.querySelector('select');
    const inp = row.querySelector('input[type="number"]');
    if (!sel || !inp || !sel.value) return;
    ingRows.push({ id: sel.value, qty: parseFloat(inp.value) || 0 });
  });

  const emptyEl = document.getElementById('ci-new-pie-empty');

  // Sin datos: limpiar KPIs y mostrar empty state del chart
  if (!ingRows.length) {
    const analDiv = document.getElementById('ci-new-analisis');
    if (analDiv) analDiv.style.display = 'none';
    const cnBox = document.getElementById('ci-new-cn-box');
    if (cnBox) cnBox.style.display = 'none';
    ['ci-kpi-c','ci-kpi-n','ci-kpi-cn','ci-kpi-masa'].forEach(id => {
      const el = document.getElementById(id); if (el) el.textContent = '—';
    });
    if (emptyEl) emptyEl.style.display = 'flex';
    if (ciNewPieChart) { ciNewPieChart.destroy(); ciNewPieChart = null; }
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';

  const analDiv = document.getElementById('ci-new-analisis');
  if (analDiv) analDiv.style.display = 'block';

  const { c, n, masa, rows } = calcCN(ingRows, ings);

  // Tabla de análisis compacta
  const tbl = document.getElementById('ci-new-ing-table');
  if (tbl) tbl.innerHTML = rows.map(({ i, r, aC, aN }) => `<tr>
    <td style="padding:6px 10px">${esc(i.nombre)}</td>
    <td style="padding:6px 8px"><span style="color:${ASP_COLORS[i.aspecto]||'#888'};font-size:11px">${i.aspecto}</span></td>
    <td style="padding:6px 8px;text-align:right;color:var(--ac);font-family:'JetBrains Mono',monospace;font-size:11px">${r.qty} ${i.unidad}</td>
    <td style="padding:6px 8px;text-align:right;color:var(--tx2);font-family:'JetBrains Mono',monospace;font-size:11px">${aC.toFixed(2)}</td>
    <td style="padding:6px 8px;text-align:right;color:var(--ac2);font-family:'JetBrains Mono',monospace;font-size:11px">${aN.toFixed(2)}</td>
  </tr>`).join('');

  // KPIs individuales (nuevos IDs del panel compacto)
  const elC    = document.getElementById('ci-kpi-c');
  const elN    = document.getElementById('ci-kpi-n');
  const elCN   = document.getElementById('ci-kpi-cn');
  const elMasa = document.getElementById('ci-kpi-masa');
  if (elC)    elC.textContent    = c.toFixed(2);
  if (elN)    elN.textContent    = n.toFixed(2);
  if (elCN)   elCN.textContent   = n > 0 ? (c/n).toFixed(2) : '—';
  if (elMasa) elMasa.textContent = masa.toFixed(1) + 'g';

  // Box C/N detalle
  const cnBox = document.getElementById('ci-new-cn-box');
  if (cnBox) {
    if (masa > 0) {
      const cn = n > 0 ? (c/n).toFixed(2) : '—';
      cnBox.style.display = 'block';
      cnBox.innerHTML = `<span style="color:var(--ac)">C/N =</span> <strong style="color:var(--wn)">${cn}</strong> &nbsp;·&nbsp; C: ${c.toFixed(2)}g &nbsp;N: ${n.toFixed(2)}g &nbsp;Masa: ${masa.toFixed(1)}g`;
    } else cnBox.style.display = 'none';
  }

  // Pie chart (usando qtyGr normalizado por aspecto)
  const byAsp = {};
  rows.forEach(({ i, qtyGr }) => {
    byAsp[i.aspecto] = (byAsp[i.aspecto] || 0) + qtyGr;
  });
  const lbl = Object.keys(byAsp), dat = Object.values(byAsp);
  const col = lbl.map(a => ASP_COLORS[a] || '#666');
  const tot = dat.reduce((s, v) => s + v, 0);
  const canvas = document.getElementById('ci-new-pie');
  if (!canvas) return;
  if (ciNewPieChart) ciNewPieChart.destroy();
  ciNewPieChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: lbl,
      datasets: [{
        data: dat,
        backgroundColor: col.map(c => c + 'cc'),
        borderColor: '#1D1D1D',
        borderWidth: 3,
        hoverOffset: 8,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      animation: { duration: 500, easing: 'easeOutQuart' },
      plugins: {
        legend: {
          display: true, position: 'bottom',
          labels: { color: '#8888a0', font: { family: 'JetBrains Mono', size: 8 }, padding: 5, boxWidth: 8 }
        },
        tooltip: {
          backgroundColor: 'rgba(20,20,25,0.95)',
          borderColor: 'rgba(255,255,255,0.08)', borderWidth: 1,
          titleColor: '#00CC33', bodyColor: '#aaa',
          callbacks: {
            label: ctx => {
              const pct = tot > 0 ? ((ctx.raw / tot) * 100).toFixed(1) : 0;
              return ` ${ctx.raw.toFixed(2)}g · ${pct}%`;
            }
          }
        }
      }
    }
  });
}

function ciSaveNewFrm() {
  const nombre = document.getElementById('ci-new-nombre').value.trim();
  if (!nombre) return sN('Ingresá nombre para la fórmula', true);
  const ingRows = [];
  const _ingsLib = gDB(K.ings);
  document.querySelectorAll('#ci-new-rows .drag-item').forEach(row => {
    const sel = row.querySelector('select');
    const inp = row.querySelector('input[type="number"]');
    if (!sel || !inp || !sel.value) return;
    ingRows.push({
      id:       sel.value,
      qty:      parseFloat(inp.value) || 0,
      proy:     0,
      orden:    ingRows.length,
      snapshot: _ingSnapshot(sel.value, _ingsLib),
    });
  });
  if (!ingRows.length) return sN('Agregá al menos un ingrediente', true);
  const fechaVal = document.getElementById('ci-new-fecha').value;
  const forms = gDB(K.forms);
  let newId = document.getElementById('ci-new-id').value || nxtId('CI', forms);
  if (forms.find(x => x.id === newId)) newId = nxtId('CI', forms);
  const f = { id: newId, nombre, version: 'v1', fecha: fechaVal ? new Date(fechaVal).toISOString() : now(), ingredientes: ingRows };
  forms.push(f);
  sDB(K.forms, forms);
  ciNewSessionInit();
  ciRenderFormulasList();
  renderCfg();
  sN('Fórmula guardada: ' + f.id);
}

// ════════════════════════════════════════════
// FÓRMULAS COLAPSABLES
// ════════════════════════════════════════════
const frmCollapsed = {};
window.aspFilters = {};

// ════════════════════════════════════════════
// FÓRMULAS — Archivado
// ════════════════════════════════════════════

let _ciMostrarArchivadas = false;

function ciArchivarFormula(frmId) {
  const forms = gDB(K.forms);
  const f = forms.find(x => x.id === frmId);
  if (!f) return;
  if (f.archivada) return;
  const segsCount = gDB(K.seg).filter(s => s.formula_id === frmId).length;
  const cultivosCount = (() => {
    try {
      const arr = JSON.parse(localStorage.getItem('bl2_cultivos') || '[]');
      return Array.isArray(arr) ? arr.filter(c => c && c.medioFormulaId === frmId && c.estado !== 'DESCARTADO').length : 0;
    } catch (e) { return 0; }
  })();
  const warn = (segsCount > 0 || cultivosCount > 0)
    ? `\n\n${segsCount} tanda(s) · ${cultivosCount} cultivo(s) activo(s).\nLos cultivos seguirán disponibles.` : '';
  if (!confirm(`Archivar fórmula "${f.nombre}" (${frmId})?\nDejará de aparecer en el listado activo.${warn}`)) return;
  f.archivada = true;
  f.fechaArchivado = new Date().toISOString();
  sDB(K.forms, forms);
  ciRenderFormulasList();
  segRefrescarSelectoresInoculo();
  sN('📦 Fórmula archivada: ' + frmId);
}

function ciRestaurarFormula(frmId) {
  const forms = gDB(K.forms);
  const f = forms.find(x => x.id === frmId);
  if (!f) return;
  f.archivada = false;
  delete f.fechaArchivado;
  sDB(K.forms, forms);
  ciRenderFormulasList();
  segRefrescarSelectoresInoculo();
  sN('✅ Fórmula restaurada: ' + frmId);
}

function ciToggleMostrarArchivadas() {
  _ciMostrarArchivadas = !_ciMostrarArchivadas;
  const btn = document.getElementById('ci-toggle-archivadas');
  if (btn) {
    btn.textContent = _ciMostrarArchivadas ? '📦 Ocultar archivadas' : '📦 Ver archivadas';
    btn.classList.toggle('activo', _ciMostrarArchivadas);
  }
  ciRenderFormulasList();
}

function ciRenderFormulasList() {
  const forms = gDB(K.forms);
  const ings  = gDB(K.ings);
  const segs  = gDB(K.seg);
  const el = document.getElementById('ci-formulas-list');
  if (!el) return;

  if (!forms.length) {
    el.innerHTML = '<div class="empty">Sin fórmulas registradas. Creá una arriba con "+ Nueva Fórmula CI".</div>';
    _actualizarToggleArchivadas(forms);
    return;
  }

  // Filtrar según toggle
  const visibles = _ciMostrarArchivadas ? forms : forms.filter(f => !f.archivada);

  // Ordenar por fecha desc
  const sorted = [...visibles].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

  // Renderizar como tile grid — click abre en Dashboard detalle
  el.innerHTML = '<div class="ci-dash-grid">' + sorted.map(f => {
    const ingsSorted = [...f.ingredientes].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
    const { c, n, masa } = calcCN(ingsSorted, ings);
    const cn = n > 0 ? (c / n).toFixed(1) : '—';

    const segsF  = segs.filter(s => s.formula_id === f.id);
    const totalP = segsF.reduce((s, r) => s + (r.placas || 0), 0);
    const totalC = segsF.reduce((s, r) => s + (r.contaminados || 0), 0);
    const sanas  = totalP - totalC;
    const ratio  = totalP > 0 ? Math.round(sanas / totalP * 100) : null;
    const ratioCol = ratio === null ? 'var(--tx3)'
      : ratio >= 80 ? 'var(--ac)' : ratio >= 50 ? 'var(--wn)' : 'var(--er)';

    const tileIdDate = (() => {
      const seg = segsF.filter(s => s.colonizacion)
        .sort((a, b) => new Date(b.colonizacion) - new Date(a.colonizacion))[0];
      if (!seg) return ciFormatDate(f.fecha).split(' ')[0];
      const colDate = _segParseDate(seg.colonizacion);
      if (!colDate || isNaN(colDate)) return ciFormatDate(f.fecha).split(' ')[0];
      const colonFmt = ciFormatDate(colDate.toISOString()).split(' ')[0];
      if (seg.inoculoFecha || seg.inoculoTs) {
        const inoDate = seg.inoculoFecha ? _segParseDate(seg.inoculoFecha) : new Date(seg.inoculoTs);
        const dias    = Math.round((colDate - inoDate) / 86400000);
        if (isFinite(dias) && dias >= 0) {
          return `${ciFormatDate(inoDate.toISOString()).split(' ')[0]} - ${colonFmt} - D ${dias}`;
        }
      }
      return `Col: ${colonFmt}`;
    })();

    const expCount = expByFormula(f.id).length;
    const notas    = (SEG.seguimientoNotas[f.id] || []);
    const lastNota = notas.length ? notas[notas.length - 1] : null;
    const estadoColor = { green: 'var(--ac)', yellow: 'var(--wn)', red: 'var(--er)', none: 'var(--tx3)' };
    const notaCol  = lastNota ? (estadoColor[lastNota.estado] || 'var(--tx3)') : 'var(--tx3)';

    const ratioBar = ratio !== null ? `
      <div style="margin:6px 0 4px;height:3px;border-radius:2px;background:var(--bg-tertiary);overflow:hidden">
        <div style="height:100%;width:${ratio}%;background:${ratioCol};border-radius:2px;transition:width .4s"></div>
      </div>` : '';

    return `
      <div class="ci-dash-tile${f.archivada ? ' ci-tile-archivada' : ''}" onclick="ciDashOpenFormula('${f.id}')">
        <div class="ci-dash-tile-top">
          <span class="ci-dash-tile-name">${esc(f.nombre)}</span>
          <span class="ci-dash-tile-ver">${esc(f.version || 'v1')}</span>
          ${f.archivada ? '<span style="font-family:\'JetBrains Mono\',monospace;font-size:9px;color:#FFC000;letter-spacing:1px">ARCH</span>' : ''}
        </div>
        <div class="ci-dash-tile-id">${f.id} · ${tileIdDate}</div>
        <div class="ci-dash-metrics">
          <div class="ci-dash-metric">
            <div class="ci-dash-mval" style="color:var(--wn)">${cn}</div>
            <div class="ci-dash-mlbl">C/N</div>
          </div>
          <div class="ci-dash-metric">
            <div class="ci-dash-mval" style="color:var(--ac3)">${masa.toFixed(0)}g</div>
            <div class="ci-dash-mlbl">Masa</div>
          </div>
          <div class="ci-dash-metric">
            <div class="ci-dash-mval" style="color:var(--ac2)">${f.ingredientes.length}</div>
            <div class="ci-dash-mlbl">Ings</div>
          </div>
          ${totalP ? `<div class="ci-dash-metric">
            <div class="ci-dash-mval" style="color:${ratioCol}">${sanas}/${totalP}</div>
            <div class="ci-dash-mlbl">🧫 ${ratio}%</div>
          </div>` : ''}
          ${expCount ? `<div class="ci-dash-metric">
            <div class="ci-dash-mval" style="color:var(--ac4)">${expCount}</div>
            <div class="ci-dash-mlbl">🔬 Exp</div>
          </div>` : ''}
          ${notas.length ? `<div class="ci-dash-metric">
            <div class="ci-dash-mval" style="color:${notaCol}">${notas.length}</div>
            <div class="ci-dash-mlbl">📝 Notas</div>
          </div>` : ''}
        </div>
        ${ratioBar}
        ${lastNota ? `<div class="ci-dash-last-nota" style="border-left-color:${notaCol}">
          ${esc(lastNota.texto.slice(0, 72))}${lastNota.texto.length > 72 ? '…' : ''}
        </div>` : ''}
        <button type="button" onclick="event.stopPropagation();ciCargarComoBase('${f.id}')"
          style="margin-top:8px;width:100%;padding:4px;font-size:11px;background:none;border:1px solid rgba(0,204,51,.25);color:var(--ac);border-radius:3px;cursor:pointer;letter-spacing:.3px"
          title="Cargar como base para nueva fórmula">📋 Usar como base</button>
      </div>`;
  }).join('') + '</div>';

  _actualizarToggleArchivadas(forms);
}

function _actualizarToggleArchivadas(forms) {
  const hayArchivadas = Array.isArray(forms) && forms.some(f => f.archivada);
  const wrap = document.getElementById('ci-formulas-list-wrap');
  if (!wrap) return;
  let btn = document.getElementById('ci-toggle-archivadas');
  if (!hayArchivadas) {
    if (btn) btn.remove();
    return;
  }
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'ci-toggle-archivadas';
    btn.type = 'button';
    btn.onclick = ciToggleMostrarArchivadas;
    btn.className = 'btn-toggle-archivadas';
    wrap.parentNode.insertBefore(btn, wrap);
  }
  btn.textContent = _ciMostrarArchivadas ? '📦 Ocultar archivadas' : '📦 Ver archivadas';
  btn.classList.toggle('activo', _ciMostrarArchivadas);
}

function buildFrmBodyHTML(f) {
  const c_n_info = (() => {
    const ings = gDB(K.ings);
    const ingsSorted = [...f.ingredientes].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
    const { c, n, masa } = calcCN(ingsSorted, ings);
    return { c, n, masa };
  })();

  const aspChips = Object.entries(ASP_COLORS).map(([asp, col]) =>
    `<span class="asp-chip active" data-asp="${asp}" data-color="${col}" onclick="toggleAspFilter('${f.id}','${asp}',this)" style="background:${col}22;color:${col};border-color:${col}">${asp}</span>`
  ).join('');



  return `
    <!-- Edit box (oculto por defecto) -->
    <div class="ci-edit-box" style="display:none;margin-bottom:12px">
      <div style="background:var(--bg-secondary);border:1px solid var(--ac);border-radius:6px;padding:14px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--border)">
          <span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--ac);letter-spacing:1px;font-weight:700">⚙️ EDITAR FÓRMULA</span>
          <button onclick="frmToggleEdit('${f.id}')" style="background:none;border:none;color:var(--tx3);cursor:pointer;font-size:14px">✕</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:10px">
            <div style="font-size:9px;color:var(--tx3);letter-spacing:1px;margin-bottom:4px;text-transform:uppercase">Nombre</div>
            <input type="text" value="${esc(f.nombre)}" style="width:100%;background:transparent;border:none;color:var(--tx);font-size:13px;outline:none" onclick="event.stopPropagation()" onchange="frmEditField('${f.id}','nombre',this.value)">
          </div>
          <div style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:10px">
            <div style="font-size:9px;color:var(--tx3);letter-spacing:1px;margin-bottom:4px;text-transform:uppercase">Versión</div>
            <input type="text" value="${f.version || 'v1'}" style="width:100%;background:transparent;border:none;color:var(--tx);font-size:13px;outline:none" onclick="event.stopPropagation()" onchange="frmEditField('${f.id}','version',this.value)">
          </div>
          <div style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:10px;grid-column:span 2">
            <div style="font-size:9px;color:var(--tx3);letter-spacing:1px;margin-bottom:4px;text-transform:uppercase">Fecha</div>
            <input type="datetime-local" value="${f.fecha ? new Date(f.fecha).toISOString().slice(0,16) : ''}" style="width:100%;background:transparent;border:none;color:var(--tx);font-size:12px;outline:none" onclick="event.stopPropagation()" onchange="frmEditField('${f.id}','fecha',new Date(this.value).toISOString())">
          </div>
          <div style="background:var(--bg);border:1px solid var(--ac);border-radius:4px;padding:10px;display:flex;flex-direction:column;justify-content:center;align-items:center">
            <div style="font-size:9px;color:var(--ac);letter-spacing:1px;margin-bottom:2px">ID</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:14px;color:var(--ac);font-weight:700">${f.id}</div>
          </div>

          <!-- Archivado -->
          <div style="grid-column:span 2;display:flex;align-items:center;justify-content:flex-end;gap:10px;padding-top:10px;border-top:1px solid var(--border);margin-top:4px">
            ${f.archivada
              ? `<span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--wn);letter-spacing:1px">
                   📦 ARCHIVADA · ${f.fechaArchivado ? new Date(f.fechaArchivado).toLocaleDateString('es-AR') : ''}
                 </span>
                 <button onclick="ciRestaurarFormula('${f.id}')"
                   style="font-size:11px;padding:5px 12px;border-radius:5px;background:rgba(0,204,51,0.1);border:1px solid var(--ac);color:var(--ac);cursor:pointer;font-family:inherit">
                   ✅ Restaurar
                 </button>`
              : `<button onclick="ciArchivarFormula('${f.id}')"
                   style="font-size:11px;padding:5px 12px;border-radius:5px;background:transparent;border:1px solid var(--border);color:var(--tx3);cursor:pointer;font-family:inherit;transition:all .15s"
                   onmouseover="this.style.borderColor='var(--wn)';this.style.color='var(--wn)'"
                   onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--tx3)'">
                   📦 Archivar fórmula
                 </button>`
            }
          </div>
        </div>
      </div>
    </div>

    <!-- GRID: tabla + chart -->
    <div class="frm-content-grid" style="display:grid;grid-template-columns:1fr 180px;gap:20px;align-items:flex-start;padding:12px 0;border-bottom:1px solid var(--border)">
      <div class="tw" style="min-width:0;overflow-x:auto;padding-bottom:8px">
        <table id="frm-table-${f.id}" class="ci-excel-table">
          <thead>
            <tr>
              <th style="width:36px;text-align:center">#</th>
              <th style="width:32px;text-align:center">⠿</th>
              <th class="col-h-ing col-h-sortable" style="min-width:140px" onclick="toggleColAlign('${f.id}','ing',this)">
                Ingrediente <span class="align-icon-modern" data-col="ing">▼</span>
              </th>
              <th class="col-h-asp col-h-sortable" style="min-width:85px;text-align:center" onclick="toggleColAlign('${f.id}','asp',this)">
                Aspecto <span class="align-icon-modern" data-col="asp">▼</span>
              </th>
              <th class="col-h-cant col-h-sortable" style="min-width:90px;text-align:right" onclick="toggleColAlign('${f.id}','cant',this)">
                Cantidad <span class="align-icon-modern" data-col="cant">▼</span>
              </th>
              <th class="col-proy col-h-sortable" style="display:none;min-width:75px;text-align:center" onclick="toggleColAlign('${f.id}','proy',this)">
                Proy % <span class="align-icon-modern" data-col="proy">▼</span>
              </th>
              <th class="col-proy-qty col-h-sortable" style="display:none;min-width:90px;text-align:right" onclick="toggleColAlign('${f.id}','proy-qty',this)">
                Cant.Proy <span class="align-icon-modern" data-col="proy-qty">▼</span>
              </th>
              <th class="col-h-c col-h-sortable" style="min-width:55px;text-align:right" onclick="toggleColAlign('${f.id}','c',this)">
                C <span class="align-icon-modern" data-col="c">▼</span>
              </th>
              <th class="col-h-n col-h-sortable" style="min-width:55px;text-align:right" onclick="toggleColAlign('${f.id}','n',this)">
                N <span class="align-icon-modern" data-col="n">▼</span>
              </th>
              <th class="ci-edit-hide" style="width:45px;text-align:center">Acc</th>
            </tr>
          </thead>
          <tbody id="ftbody-${f.id}"></tbody>
        </table>
        <div style="display:flex;gap:10px;margin-top:12px">
          <button class="btn btn-s frm-dup-btn" style="display:none;font-size:10px;height:28px" onclick="dupFrmWithProjection('${f.id}')">📋 DUPLICAR CON PROYECCIÓN</button>
          <button class="frm-add-ing-btn ci-edit-hide" style="flex:1;background:rgba(0,204,51,0.03);border:1.5px dashed var(--border);color:var(--tx3);padding:10px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;transition:all 0.2s" onmouseover="this.style.borderColor='var(--ac)';this.style.color='var(--ac)';this.style.background='rgba(0,204,51,0.06)'" onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--tx3)';this.style.background='rgba(0,204,51,0.03)'" onclick="frmAddIngRow('${f.id}')">
            + AGREGAR INGREDIENTE
          </button>
        </div>
      </div>
      <!-- Chart + KPIs sidebar -->
      <div class="frm-chart-wrap" style="padding:16px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:10px;box-shadow:inset 0 0 10px rgba(0,0,0,0.2)">
        <div class="asp-filters" id="aspf-${f.id}" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px;justify-content:center">
          ${aspChips}
        </div>
        <div class="ci-pie-container" style="height:160px;margin-bottom:16px">
          <canvas id="fpie-${f.id}"></canvas>
        </div>
        <!-- Metrics (KPIs) -->
        <div id="fkpi-${f.id}" class="frm-metrics" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;padding-top:12px;border-top:1px solid var(--border)">
          <div class="frm-metric">
            <span class="frm-metric-label">Carbono</span>
            <span class="frm-metric-val pur">${c_n_info.c.toFixed(2)}</span>
          </div>
          <div class="frm-metric">
            <span class="frm-metric-label">Nitrógeno</span>
            <span class="frm-metric-val">${c_n_info.n.toFixed(2)}</span>
          </div>
          <div class="frm-metric">
            <span class="frm-metric-label">Relación C/N</span>
            <span class="frm-metric-val wn">${c_n_info.n > 0 ? (c_n_info.c / c_n_info.n).toFixed(2) : '—'}</span>
          </div>
          <div class="frm-metric">
            <span class="frm-metric-label">Masa Total</span>
            <span class="frm-metric-val or">${c_n_info.masa.toFixed(0)}g</span>
          </div>
        </div>
      </div>
    </div>

    <!-- MODO EXPERIMENTO (va antes del campo de trabajo) -->
    ${buildExpHTML(f.id)}

    <!-- SEG — Campo de Trabajo CI -->
    ${buildSegHTML(f.id)}
  `;
}

// ── Toggle colapso ──
function frmToggle(frmId) {
  const header = document.querySelector(`#fcard-${frmId} .frm-card-header`);
  const body   = document.getElementById(`fbody-${frmId}`);
  if (!header || !body) return;
  const isOpen = body.classList.contains('open');
  header.classList.toggle('open', !isOpen);
  body.classList.toggle('open', !isOpen);
  frmCollapsed[frmId] = isOpen;
  if (!isOpen) {
    const forms = gDB(K.forms); const ings = gDB(K.ings);
    const f = forms.find(x => x.id === frmId); if (!f) return;
    const ingsSorted = [...f.ingredientes].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
    const { rows } = calcCN(ingsSorted, ings);
    renderFrmIngTable(frmId, rows);
    drawFrmPie(`fpie-${frmId}`, rows, frmId);
    applyColAlign(frmId);
    segInicializarGeneticas(frmId);
  }
}

// ── Modo edición de fórmula ──
function frmToggleEdit(frmId) {
  const card = document.getElementById('fcard-' + frmId);
  if (!card) return;
  const isEdit = card.classList.contains('ci-edit-mode');
  const editBtn = card.querySelector('.ci-edit-indicator');
  const delBtn  = card.querySelector('.btn-d');
  const body    = document.getElementById('fbody-' + frmId);
  const table   = document.getElementById('frm-table-' + frmId);
  const forms = gDB(K.forms); const ings = gDB(K.ings);
  const f = forms.find(x => x.id === frmId);

  if (isEdit) {
    // SAVE mode → exit edit
    card.classList.remove('ci-edit-mode');
    card.querySelectorAll('.ci-edit-box').forEach(el => el.style.display = 'none');
    if (editBtn) { editBtn.textContent = 'EDIT'; editBtn.classList.remove('save-mode'); }
    if (delBtn)  delBtn.style.display = 'none';
    if (table) {
      table.querySelectorAll('.col-proy, .col-proy-qty').forEach(th => th.style.display = 'none');
      table.querySelectorAll('td.col-proy, td.col-proy-qty').forEach(td => td.style.display = 'none');
    }
  } else {
    card.classList.add('ci-edit-mode');
    card.querySelectorAll('.ci-edit-box').forEach(el => el.style.display = 'block');
    if (editBtn) { editBtn.textContent = 'SAVE'; editBtn.classList.add('save-mode'); }
    if (delBtn)  delBtn.style.display = 'inline-flex';
    if (table) {
      table.querySelectorAll('.col-proy, .col-proy-qty').forEach(th => th.style.display = '');
      table.querySelectorAll('td.col-proy, td.col-proy-qty').forEach(td => td.style.display = '');
    }
    if (body && !body.classList.contains('open')) {
      body.classList.add('open');
      document.querySelector(`#fcard-${frmId} .frm-card-header`)?.classList.add('open');
    }
  }
  if (f) {
    const ingsSorted = [...f.ingredientes].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
    const { rows } = calcCN(ingsSorted, ings);
    renderFrmIngTable(frmId, rows);
    drawFrmPie(`fpie-${frmId}`, rows, frmId);
    applyColAlign(frmId);
  }
}

// ── Editar campo de fórmula ──
function frmEditField(frmId, campo, valor) {
  const forms = gDB(K.forms);
  const f = forms.find(x => x.id === frmId);
  if (!f) return;
  f[campo] = valor;
  sDB(K.forms, forms);
  sN(frmId + ' actualizado');
}

// ── Eliminar fórmula ──
function delFrmFromCI(frmId) {
  if (!confirm(`¿Eliminar fórmula ${frmId}?\nEsto también eliminará los registros de Campo de Trabajo CI asociados.`)) return;
  let forms = gDB(K.forms);
  forms = forms.filter(f => f.id !== frmId);
  sDB(K.forms, forms);
  let segs = gDB(K.seg);
  segs = segs.filter(s => s.formula_id !== frmId);
  sDB(K.seg, segs);
  // Limpiar experimentos huérfanos de esta fórmula
  expSave(expLoad().filter(e => e.formulaId !== frmId));
  ciRenderFormulasList();
  renderCfg();
  // Si estamos en la vista detalle del Dashboard, volver al grid
  const dw = document.getElementById('ci-dash-detalle-wrap');
  if (dw && dw.style.display !== 'none') ciDashVolverGrid();
  sN(`Fórmula ${frmId} eliminada`);
}

// ════════════════════════════════════════════
// RENDERIZADO DE TABLA DE INGREDIENTES
// ════════════════════════════════════════════

// ════════════════════════════════════════════
// BADGE VISUAL DE UNIDAD DE MEDIDA
// ml=naranja, gr=verde, mg=azul, ud=violeta
// ════════════════════════════════════════════
function _unitBadge(unidad) {
  if (!unidad) return '';
  const u = unidad.toLowerCase().trim();
  const map = {
    'ml': { bg: 'rgba(255,140,0,0.15)',  border: 'rgba(255,140,0,0.5)',  color: '#FF8C00' },
    'gr': { bg: 'rgba(112,173,71,0.15)', border: 'rgba(112,173,71,0.5)', color: '#70AD47' },
    'mg': { bg: 'rgba(68,170,255,0.15)', border: 'rgba(68,170,255,0.5)', color: '#44AAFF' },
    'ud': { bg: 'rgba(124,111,255,0.15)',border: 'rgba(124,111,255,0.5)',color: '#7C6FFF' },
  };
  const s = map[u] || { bg: 'rgba(160,160,160,0.15)', border: 'rgba(160,160,160,0.4)', color: '#A0A0A0' };
  return '<span style="display:inline-flex;align-items:center;font-size:9px;font-weight:700;font-family:JetBrains Mono,monospace;padding:1px 5px;border-radius:3px;background:' + s.bg + ';border:1px solid ' + s.border + ';color:' + s.color + ';vertical-align:middle;margin-left:4px">' + (map[u] ? u : unidad) + '</span>';
}

function renderFrmIngTable(frmId, rows) {
  const tbody = document.getElementById(`ftbody-${frmId}`);
  if (!tbody) return;
  const allIngs = gDB(K.ings);
  const card = document.getElementById('fcard-' + frmId);
  const isEditMode = card && card.classList.contains('ci-edit-mode');
  const forms = gDB(K.forms);
  const f = forms.find(x => x.id === frmId);



  tbody.innerHTML = rows.map(({ i, r, aC, aN, qty, qtyProy, proy }, idx) => {
    return `<tr draggable="true" data-frm="${frmId}" data-idx="${idx}" class="ci-excel-row"
        ondragstart="dndStart(event)" ondragover="dndOver(event)" ondrop="dndDrop(event)" ondragend="dndEnd(event)">
      <td class="ci-excel-cell" style="text-align:center;color:var(--tx3);font-size:10px">${idx+1}</td>
      <td class="ci-excel-cell" style="text-align:center">
        <div class="ci-excel-drag-handle" title="Arrastrar">⠿</div>
      </td>
      <td class="ci-excel-cell frm-ing-cell">
        <div class="frm-ing-view" onclick="frmIngShowSelect('${frmId}',${idx},this)">${esc(i.nombre)}</div>
      </td>
      <td class="ci-excel-cell" style="text-align:center">
        <span class="ci-excel-asp" style="background:${(ASP_COLORS[i.aspecto]||'#888')}22;color:${ASP_COLORS[i.aspecto]||'#888'}">${i.aspecto}</span>
      </td>
      <td class="ci-excel-cell ci-excel-num">
        <div class="view-mode ci-excel-data">${qty} ${_unitBadge(i.unidad)}</div>
        <input type="number" value="${qty}" min="0" step="0.01" class="ci-excel-input edit-mode ci-excel-data" style="text-align:right;color:var(--wn)" onclick="event.stopPropagation()" onchange="frmIngQtyChange('${frmId}',${idx},this.value)">
      </td>
      <td class="ci-excel-cell col-proy" style="display:none;text-align:center">
        <input type="number" value="${proy}" step="1" class="ci-excel-input ci-excel-data" style="text-align:center" onclick="event.stopPropagation()" onchange="frmIngProyChange('${frmId}',${idx},this.value)">
      </td>
      <td class="ci-excel-cell ci-excel-num col-proy-qty" style="display:none;color:var(--ac);font-weight:700">
        <span class="ci-excel-data">${qtyProy.toFixed(1)}</span> <span style="color:var(--tx3);font-size:10px">${i.unidad}</span>
      </td>
      <td class="ci-excel-cell ci-excel-num">
        <span class="ci-excel-data" style="color:${aC>0?'var(--wn)':'var(--tx3)'}">${aC.toFixed(2)}</span>
      </td>
      <td class="ci-excel-cell ci-excel-num">
        <span class="ci-excel-data" style="color:${aN>0?'var(--ac2)':'var(--tx3)'}">${aN.toFixed(2)}</span>
      </td>
      <td class="ci-excel-cell ci-edit-hide" style="text-align:center">
        <button class="ci-excel-action-btn del" onclick="frmDelIngRow('${frmId}','${r.id}')" title="Eliminar">✕</button>
      </td>
    </tr>`;
  }).join('');

  _appendGhostIngRows(tbody, frmId, f);

  // Re-renderizar tablas de experimentos abiertas para que reflejen cambios en la fórmula base
  expByFormula(frmId).forEach(exp => {
    const wrap = document.getElementById('ci-exp-tabla-' + exp.id);
    if (wrap && wrap.style.display !== 'none') expRenderTabla(exp.id);
  });

  setTimeout(() => drawFrmPie(`fpie-${frmId}`, rows, frmId), 50);
}

/** Calcula y agrega al tbody las filas fantasma de extras de experimentos.
 *  Una fila por (ingId × expId × frascoLabel).
 *  - Extra delta (ing ya en base): muestra base + delta = total y g/L total en frasco.
 *  - Extra nuevo (ing no en base): muestra qty simple y g/L del extra en frasco.
 *  No se persisten — se recalculan en cada render. */
function _appendGhostIngRows(tbody, frmId, f) {
  const allIngs = gDB(K.ings);
  const exps    = gDB(K.exp).filter(e => e.formulaId === frmId);
  if (!exps.length) return;

  // Mapa de cantidad base por ingId (para detectar y calcular deltas)
  const baseIngMap = {};
  (f.ingredientes || []).forEach(r => { if (r.id) baseIngMap[r.id] = r.qty; });

  // Una entrada por (ingId × expId × frascoLabel) — evita colisiones entre frascos/experimentos
  const ghostMap = {};
  exps.forEach(e => {
    (e.frascos || []).forEach(fr => {
      (fr.extras || []).forEach(ex => {
        if (!ex.ingId || !(ex.qty > 0)) return;
        const key = `${ex.ingId}__${e.id}__${fr.label}`;
        ghostMap[key] = {
          ingId:       ex.ingId,
          expId:       e.id,
          frascoLabel: fr.label,
          qty:         ex.qty,
          volFrasco:   fr.volFrasco || 0,
          volBase:     e.volBase    || 0,
        };
      });
    });
  });

  const entries = Object.values(ghostMap);
  if (!entries.length) return;

  const rowsHTML = entries.map(entry => {
    const { ingId, expId, frascoLabel, qty, volFrasco, volBase } = entry;
    const i = allIngs.find(x => x.id === ingId);
    if (!i) return '';

    const baseQty = Object.prototype.hasOwnProperty.call(baseIngMap, ingId) ? baseIngMap[ingId] : null;
    const isDelta = baseQty !== null;

    // ── Celda de cantidad ──
    // Ghost row muestra solo lo que agrega el experimento (+delta o qty nueva).
    // La suma base+extra corresponde a la tabla comparativa, no al excel de fórmula.
    const qtyDisplay = isDelta
      ? `<span style="color:var(--wn)">+${qty.toFixed(2)} ${esc(i.unidad||'gr')}</span>`
      : `<span style="color:var(--ac4)">${qty.toFixed(2)} ${esc(i.unidad||'gr')}</span>`;

    // ── Celda g/L ──
    // Delta: concentración total en el frasco (base escalada + extra).
    // Nuevo: concentración del extra solo.
    let gLDisplay = '—';
    if (volFrasco > 0) {
      let totalInFrasco = qty;
      if (isDelta && volBase > 0) {
        totalInFrasco = baseQty * (volFrasco / volBase) + qty;
      }
      gLDisplay = `${(totalInFrasco / volFrasco * 1000).toFixed(2)} ${esc(i.unidad||'gr')}/L`;
    }

    // ── Badge y title ──
    const badgeClass = isDelta
      ? 'ci-excel-ghost-badge ci-ghost-badge-delta'
      : 'ci-excel-ghost-badge';
    const badgeLabel  = `EXP ${frascoLabel}${isDelta ? ' +Δ' : ''}`;
    const titleDetail = isDelta
      ? `Extra: ${expId} Frasco ${frascoLabel} — base: ${baseQty.toFixed(2)} + extra: +${qty.toFixed(2)} ${i.unidad||'gr'} @ ${volFrasco}ml`
      : `Extra: ${expId} Frasco ${frascoLabel} — ${qty.toFixed(2)} ${i.unidad||'gr'} @ ${volFrasco}ml`;

    return `
      <tr class="ci-excel-row ci-ghost-ing-row" title="${esc(titleDetail)}">
        <td class="ci-excel-cell" style="text-align:center;color:rgba(68,170,255,0.3);font-size:10px">👻</td>
        <td class="ci-excel-cell" style="text-align:center;color:var(--tx3)">·</td>
        <td class="ci-excel-cell" style="text-align:left">
          <div style="display:flex;align-items:center;gap:6px">
            <span class="${badgeClass}">${esc(badgeLabel)}</span>
            <span style="color:var(--ac4);font-style:italic">${esc(i.nombre)}</span>
          </div>
        </td>
        <td class="ci-excel-cell" style="text-align:center">
          <span class="ci-excel-asp" style="background:${(ASP_COLORS[i.aspecto]||'#888')}15;color:${ASP_COLORS[i.aspecto]||'#888'};opacity:0.7">${esc(i.aspecto||'')}</span>
        </td>
        <td class="ci-excel-cell ci-excel-num" style="text-align:right">${qtyDisplay}</td>
        <td class="ci-excel-cell col-proy" style="display:none;text-align:center;color:var(--tx3)">—</td>
        <td class="ci-excel-cell col-proy-qty" style="display:none;text-align:right;color:var(--tx3)">—</td>
        <td class="ci-excel-cell ci-excel-num" style="text-align:right;color:var(--tx3)">${gLDisplay}</td>
        <td class="ci-excel-cell ci-excel-num" style="text-align:right;color:var(--tx3)">—</td>
        <td class="ci-excel-cell ci-edit-hide" style="text-align:center">
          <span class="ci-ghost-star" title="Solo lectura (extra de experimento)">✨</span>
        </td>
      </tr>`;
  }).join('');

  tbody.insertAdjacentHTML('beforeend', rowsHTML);
}

// ════════════════════════════════════════════
// PIE CHART POR FÓRMULA
// ════════════════════════════════════════════
function drawFrmPie(canId, rows, frmId) {
  const canvas = document.getElementById(canId);
  if (!canvas) return;
  const filters = window.aspFilters[frmId] || {};
  const activeAsps = Object.entries(filters).filter(([, v]) => v).map(([k]) => k);
  const byAsp = {};
  rows.forEach(({ i, qty, qtyGr }) => {
    if (activeAsps.length && !activeAsps.includes(i.aspecto)) return;
    // Usar qtyGr para el gráfico (gramos normalizados — los mg no inflan el donut)
    byAsp[i.aspecto] = (byAsp[i.aspecto] || 0) + (qtyGr ?? qty);
  });
  const lbl = Object.keys(byAsp), dat = Object.values(byAsp), col = lbl.map(a => ASP_COLORS[a] || '#666');
  const total = dat.reduce((s, v) => s + v, 0);
  if (canvas._chart) canvas._chart.destroy();
  if (!lbl.length) return;
  canvas._chart = new Chart(canvas, {
    type: 'doughnut',
    data: { 
      labels: lbl, 
      datasets: [{ 
        data: dat, 
        backgroundColor: col.map(c => c + 'cc'), 
        borderColor: '#1d1d1d', 
        borderWidth: 2,
        hoverOffset: 12,
        borderRadius: 4
      }] 
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '72%',
      animation: { duration: 800, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: { 
          backgroundColor: 'rgba(20, 20, 25, 0.95)', 
          borderColor: 'rgba(255, 255, 255, 0.1)', 
          borderWidth: 1, 
          titleColor: '#00cc33', 
          bodyColor: '#fff', 
          cornerRadius: 6, 
          padding: 10,
          titleFont: { size: 11, weight: 'bold' }, 
          bodyFont: { size: 10, family: "'JetBrains Mono', monospace" },
          callbacks: { 
            label: ctx => { 
              const pct = total > 0 ? ((ctx.raw/total)*100).toFixed(1) : 0; 
              return ` ${ctx.raw.toFixed(1)}g (${pct}%)`; 
            } 
          } 
        }
      }
    }
  });
}

function toggleAspFilter(frmId, asp, chip) {
  if (!window.aspFilters[frmId]) {
    window.aspFilters[frmId] = {};
    Object.keys(ASP_COLORS).forEach(a => window.aspFilters[frmId][a] = true);
  }
  window.aspFilters[frmId][asp] = !window.aspFilters[frmId][asp];
  chip.classList.toggle('active');
  const forms = gDB(K.forms); const ings = gDB(K.ings);
  const f = forms.find(x => x.id === frmId); if (!f) return;
  const ingsSorted = [...f.ingredientes].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  const { rows } = calcCN(ingsSorted, ings);
  drawFrmPie(`fpie-${frmId}`, rows, frmId);
}

// ════════════════════════════════════════════
// FLOATING INGREDIENT DROPDOWN
// ════════════════════════════════════════════
let fddCtx = { frmId: null, idx: null, items: [], onSelect: null };

function openFloatingDropdown(opts) {
  const { title, items, onSelect, x, y } = opts;
  fddCtx.items = items; fddCtx.onSelect = onSelect;
  const dd = document.getElementById('floatingDropdown');
  dd.querySelector('.floating-dropdown-title').textContent = title || 'Seleccionar';
  const searchEl = document.getElementById('fddSearch');
  searchEl.value = '';
  renderFddList(items);
  const left = Math.min(x || 0, window.innerWidth - 360);
  const top  = Math.min(y || 0, window.innerHeight - 350);
  dd.style.left = left + 'px'; dd.style.top = top + 'px'; dd.style.bottom = 'auto';
  dd.classList.add('open');
  setTimeout(() => searchEl.focus(), 50);
}

function closeFloatingDropdown() {
  document.getElementById('floatingDropdown')?.classList.remove('open');
  fddCtx = { frmId: null, idx: null, items: [], onSelect: null };
}

function renderFddList(items) {
  const listEl = document.getElementById('fddList');
  if (!items.length) { listEl.innerHTML = '<div class="floating-dropdown-empty">Sin resultados</div>'; return; }
  listEl.innerHTML = items.map(item => `
    <div class="floating-dropdown-item" onclick="fddSelectItem('${item.id}')">
      <span class="floating-dropdown-item-name">${esc(item.nombre)}</span>
      <span class="floating-dropdown-item-meta">
        <span>${item.unidad || 'ud'}</span>
        <span style="color:var(--ac2)">%C:${item.pc || 0}</span>
        <span style="color:var(--ac)">%N:${item.pn || 0}</span>
        <span style="color:${ASP_COLORS[item.aspecto]||'#888'}">${item.aspecto || ''}</span>
      </span>
    </div>`).join('');
}

function fddFilter(query) {
  const q = query.toLowerCase().trim();
  const filtered = fddCtx.items.filter(i => i.nombre.toLowerCase().includes(q) || (i.aspecto || '').toLowerCase().includes(q));
  renderFddList(filtered);
}

function fddSelectItem(itemId) {
  if (fddCtx.onSelect) fddCtx.onSelect(itemId);
  closeFloatingDropdown();
}

// ── Open dropdown when clicking ingredient name ──
function frmIngShowSelect(frmId, idx, span) {
  const card = document.getElementById('fcard-' + frmId);
  if (!card || !card.classList.contains('ci-edit-mode')) return;
  const allIngs = gDB(K.ings);
  const rect = span.getBoundingClientRect();
  openFloatingDropdown({
    title: 'Seleccionar Ingrediente',
    items: allIngs,
    x: rect.left, y: rect.bottom + 4,
    onSelect: ingId => {
      const forms = gDB(K.forms);
      const f = forms.find(x => x.id === frmId); if (!f) return;
      f.ingredientes[idx].id       = ingId;
      f.ingredientes[idx].snapshot = _ingSnapshot(ingId, gDB(K.ings));
      sDB(K.forms, forms);
      const ings = gDB(K.ings);
      const ingsSorted = [...f.ingredientes].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
      const { rows } = calcCN(ingsSorted, ings);
      renderFrmIngTable(frmId, rows);
      drawFrmPie(`fpie-${frmId}`, rows, frmId);
      updateFrmKpis(frmId, rows);
      sN('Ingrediente actualizado');
    }
  });
}

function frmIngQtyChange(frmId, idx, qty) {
  const forms = gDB(K.forms);
  const f = forms.find(x => x.id === frmId); if (!f) return;
  f.ingredientes[idx].qty = parseFloat(qty) || 0;
  sDB(K.forms, forms);
  const ings = gDB(K.ings);
  const ingsSorted = [...f.ingredientes].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  const { rows } = calcCN(ingsSorted, ings);
  renderFrmIngTable(frmId, rows);
  drawFrmPie(`fpie-${frmId}`, rows, frmId);
  updateFrmKpis(frmId, rows);
}

function frmIngProyChange(frmId, idx, proy) {
  const forms = gDB(K.forms);
  const f = forms.find(x => x.id === frmId); if (!f) return;
  f.ingredientes[idx].proy = parseFloat(proy) || 0;
  sDB(K.forms, forms);
  const ings = gDB(K.ings);
  const ingsSorted = [...f.ingredientes].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  const { rows } = calcCN(ingsSorted, ings);
  renderFrmIngTable(frmId, rows);
  updateFrmKpis(frmId, rows);
}

function updateFrmKpis(frmId, rows) {
  const kpis = document.getElementById(`fkpi-${frmId}`);
  if (!kpis) return;
  let totalC = 0, totalN = 0, totalMasa = 0;
  rows.forEach(r => { totalC += r.aC; totalN += r.aN; totalMasa += (r.qtyGr ?? r.qty); });

  // Sincronizar header badge (C/N y masa) — se renderiza estático al abrir, puede quedar desincronizado
  const hdrCN   = document.getElementById('fhdr-cn-'   + frmId);
  const hdrMasa = document.getElementById('fhdr-masa-' + frmId);
  const cnVal   = totalN > 0 ? (totalC / totalN).toFixed(2) : '—';
  if (hdrCN)   hdrCN.textContent   = 'C/N ' + cnVal;
  if (hdrMasa) hdrMasa.textContent = totalMasa.toFixed(0) + 'g';
  kpis.innerHTML = `
    <div class="frm-metric">
      <span class="frm-metric-label">Carbono</span>
      <span class="frm-metric-val pur">${totalC.toFixed(2)}</span>
    </div>
    <div class="frm-metric">
      <span class="frm-metric-label">Nitrógeno</span>
      <span class="frm-metric-val">${totalN.toFixed(2)}</span>
    </div>
    <div class="frm-metric">
      <span class="frm-metric-label">Relación C/N</span>
      <span class="frm-metric-val wn">${totalN > 0 ? (totalC/totalN).toFixed(2) : '—'}</span>
    </div>
    <div class="frm-metric">
      <span class="frm-metric-label">Masa Total</span>
      <span class="frm-metric-val or">${totalMasa.toFixed(0)}g</span>
    </div>`;
}

function frmAddIngRow(frmId) {
  const forms = gDB(K.forms);
  const f = forms.find(x => x.id === frmId); if (!f) return;
  const allIngs = gDB(K.ings);
  if (!allIngs.length) { sN('Primero configurá en la Biblioteca de Ingredientes', true); return; }
  f.ingredientes.push({
    id:       allIngs[0].id,
    qty:      10,
    proy:     0,
    orden:    f.ingredientes.length,
    snapshot: _ingSnapshot(allIngs[0].id, allIngs),
  });
  sDB(K.forms, forms);
  const ingsSorted = [...f.ingredientes].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  const { rows } = calcCN(ingsSorted, allIngs);
  renderFrmIngTable(frmId, rows);
  sN('Ingrediente agregado');
}

function frmDelIngRow(frmId, ingId) {
  if (!confirm('¿Eliminar este ingrediente de la fórmula?')) return;
  const forms = gDB(K.forms);
  const f = forms.find(x => x.id === frmId); if (!f) return;
  f.ingredientes = f.ingredientes.filter(i => i.id !== ingId);
  sDB(K.forms, forms);
  const allIngs = gDB(K.ings);
  const ingsSorted = [...f.ingredientes].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  const { rows } = calcCN(ingsSorted, allIngs);
  renderFrmIngTable(frmId, rows);
  drawFrmPie(`fpie-${frmId}`, rows, frmId);
  updateFrmKpis(frmId, rows);
  sN('Ingrediente eliminado');
}

function dupFrmWithProjection(frmId) {
  const forms = gDB(K.forms);
  const f = forms.find(x => x.id === frmId); if (!f) return;
  const vn = parseInt((f.version || 'v1').replace('v', '')) || 1;
  const newIng = f.ingredientes.map(r => ({ ...r, qty: r.qty * (1 + (r.proy || 0) / 100), proy: 0 }));
  forms.push({ ...JSON.parse(JSON.stringify(f)), id: nxtId('CI', forms), version: 'v' + (vn+1), fecha: now(), ingredientes: newIng });
  sDB(K.forms, forms);
  ciRenderFormulasList();
  sN('Fórmula duplicada con proyecciones aplicadas');
}



// ════════════════════════════════════════════
// ALINEACIÓN DE COLUMNAS
// ════════════════════════════════════════════
const COL_ALIGN_KEY = 'bl2_col_align';

function getColAlign(frmId) {
  const all = gOb(COL_ALIGN_KEY, {});
  return all[frmId] || { ing: 'left', asp: 'center', cant: 'right', proy: 'center', 'proy-qty': 'right', c: 'right', n: 'right' };
}

function toggleColAlign(frmId, col, thEl) {
  const align = ['left','center','right'];
  const current = getColAlign(frmId)[col] || 'left';
  const next = align[(align.indexOf(current) + 1) % 3];
  const all = gOb(COL_ALIGN_KEY, {});
  if (!all[frmId]) all[frmId] = {};
  all[frmId][col] = next;
  sOb(COL_ALIGN_KEY, all);
  applyColAlignToCol(frmId, col, next);
  const icon = thEl?.querySelector('.align-icon');
  if (icon) icon.textContent = next === 'left' ? '◀' : next === 'center' ? '◆' : '▶';
}

function applyColAlignToCol(frmId, col, align) {
  const tbl = document.getElementById('frm-table-' + frmId); if (!tbl) return;
  const colMap = { ing:2, asp:3, cant:4, proy:5, 'proy-qty':6, c:7, n:8 };
  let idx = colMap[col];
  tbl.querySelectorAll('tbody tr').forEach(row => {
    const cells = row.querySelectorAll('td');
    if (cells[idx]) cells[idx].style.textAlign = align;
  });
}

function applyColAlign(frmId) {
  const align = getColAlign(frmId);
  Object.keys(align).forEach(col => applyColAlignToCol(frmId, col, align[col]));
}

// ════════════════════════════════════════════
// DRAG & DROP — tabla de ingredientes guardada
// ════════════════════════════════════════════
let dndSrcIdx = null, dndSrcFrm = null;

function dndStart(e) {
  dndSrcIdx = parseInt(e.currentTarget.dataset.idx);
  dndSrcFrm = e.currentTarget.dataset.frm;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}
function dndOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('[data-frm].drag-over').forEach(el => el.classList.remove('drag-over'));
  e.currentTarget.classList.add('drag-over');
}
function dndDrop(e) {
  e.preventDefault();
  const targetIdx = parseInt(e.currentTarget.dataset.idx);
  const targetFrm = e.currentTarget.dataset.frm;
  if (targetFrm !== dndSrcFrm || targetIdx === dndSrcIdx) return;
  const forms = gDB(K.forms);
  const f = forms.find(x => x.id === dndSrcFrm); if (!f) return;
  const arr = [...f.ingredientes].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  const [moved] = arr.splice(dndSrcIdx, 1);
  arr.splice(targetIdx, 0, moved);
  arr.forEach((ing, i) => ing.orden = i);
  f.ingredientes = arr;
  sDB(K.forms, forms);
  const ings = gDB(K.ings);
  const { rows } = calcCN(arr, ings);
  renderFrmIngTable(dndSrcFrm, rows);
  drawFrmPie(`fpie-${dndSrcFrm}`, rows, dndSrcFrm);
}
function dndEnd(e) {
  e.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
}

// ════════════════════════════════════════════
// DRAG & DROP — nuevo constructor de fórmula
// ════════════════════════════════════════════
let newFrmDragSrc = null;

function initNewFrmDnd(container) {
  container.addEventListener('dragstart', e => {
    newFrmDragSrc = e.target.closest('.drag-item');
    if (!newFrmDragSrc) return;
    newFrmDragSrc.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  container.addEventListener('dragover', e => {
    e.preventDefault();
    const target = e.target.closest('.drag-item');
    if (!target || target === newFrmDragSrc) return;
    container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    target.classList.add('drag-over');
  });
  container.addEventListener('drop', e => {
    e.preventDefault();
    const target = e.target.closest('.drag-item');
    if (!target || target === newFrmDragSrc) return;
    const items = [...container.querySelectorAll('.drag-item')];
    const from = items.indexOf(newFrmDragSrc);
    const to   = items.indexOf(target);
    if (from < to) container.insertBefore(newFrmDragSrc, target.nextSibling);
    else           container.insertBefore(newFrmDragSrc, target);
    container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    ciNewFrmCalc();
  });
  container.addEventListener('dragend', () => {
    if (newFrmDragSrc) newFrmDragSrc.classList.remove('dragging');
    container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  });
}

// ════════════════════════════════════════════
// SEG — Campo de Trabajo CI
// ════════════════════════════════════════════
const SEG = {
  modoEdicion: {},
  seguimientoNotas: {},
  imagenesTemp: {},  // imágenes pendientes antes de guardar la nota (base64[], clave frmId o frmId::tandaId)
  cardState: {},     // { [frmId]: { [tandaId]: bool } } — true=expandida, false=colapsada
};

// ── SEG: helpers multi-sección ──────────────────────────────────────────────

/**
 * Extrae el frmId de un id de tbody.
 * "segTbody-CI-0001"                     → "CI-0001"
 * "segTbody-CI-0001--EXP-0001--A"        → "CI-0001"
 */
function _segFrmIdFromTbodyId(tbodyId) {
  if (!tbodyId || !tbodyId.startsWith('segTbody-')) return '';
  const rest = tbodyId.slice('segTbody-'.length);
  const sep  = rest.indexOf('--');
  return sep !== -1 ? rest.slice(0, sep) : rest;
}

/**
 * Devuelve todos los <tbody> del campo de trabajo de frmId
 * (base + secciones de frasco, si existen).
 */
function _segGetSectionTbodys(frmId) {
  const base   = 'segTbody-' + frmId;
  const prefix = 'segTbody-' + frmId + '--';
  return Array.from(document.querySelectorAll(`[id^="segTbody-${frmId}"]`))
    .filter(el => el.id === base || el.id.startsWith(prefix));
}

/**
 * Devuelve todas las filas tr.seg-row a lo largo de todas las secciones de frmId.
 */
function _segGetAllRows(frmId) {
  return _segGetSectionTbodys(frmId)
    .flatMap(tb => Array.from(tb.querySelectorAll('tr.seg-row')));
}

// ── SEG: HTML del campo de trabajo ──────────────────────────────────────────

function buildSegHTML(frmId) {
  const exps    = (typeof expByFormula === 'function') ? expByFormula(frmId) : [];
  const hasExps = exps.length > 0;

  // ── thead compartido (cada tabla tiene el suyo propio) ───────────────────
  const theadHTML = `
          <thead>
            <tr>
              <th style="min-width:100px">Nodo/Tanda</th>
              <th style="min-width:120px">🧬 Genética</th>
              <th class="seg-th-inoculo">🔗 Inoculo trace</th>
              <th style="width:90px;text-align:center;font-size:10px;white-space:nowrap">Inoculación</th>
              <th style="width:58px;text-align:center">Placas</th>
              <th style="width:52px;text-align:center">Cont.</th>
              <th style="width:90px;text-align:center;font-size:10px;white-space:nowrap">Colonización</th>
              <th style="width:46px;text-align:center;font-size:11px;color:var(--tx3)" title="D+ desde inoculación (D0 = día inoculado)">D+</th>
              <th style="width:58px;text-align:center">Ratio</th>
              <th style="min-width:200px;text-align:center;font-size:11px;color:var(--tx3)" title="Promover tanda · Reporte · Notas inline">Acc</th>
              <th class="col-acciones" style="display:none">Del</th>
            </tr>
          </thead>`;

  // ── Construir cards por sección ──────────────────────────────────────────
  let cardsHTML = '';

  if (hasExps) {
    // Card base: tandas sin experimento
    cardsHTML += `
      <div class="seg-section-card">
        <div class="seg-section-hdr">
          <span class="seg-section-hdr-title">📋 Sin experimento</span>
          <button type="button" class="btn btn-add ci-seg-section-add-btn"
            data-frm="${esc(frmId)}"
            onclick="segAddRow(this.dataset.frm)">+ Agregar</button>
        </div>
        <div class="seg-section-table-wrap">
          <table class="data-table seg-section-table">${theadHTML}
            <tbody id="segTbody-${frmId}"></tbody>
          </table>
        </div>
      </div>`;

    // Una card por frasco de cada experimento
    exps.forEach(exp => {
      (exp.frascos || []).forEach(fr => {
        const extrasLabel = (fr.extras || []).length
          ? ` + ${(fr.extras || []).map(ex => {
              const ing = gDB(K.ings).find(i => i.id === ex.ingId);
              return ing ? esc(ing.nombre) : esc(ex.ingId);
            }).join(', ')}`
          : '';
        cardsHTML += `
      <div class="seg-section-card seg-section-exp">
        <div class="seg-section-hdr">
          <span class="seg-section-hdr-title">🔬 ${esc(exp.nombre)} · Frasco ${esc(fr.label)} — ${fr.volFrasco}ml${extrasLabel}</span>
          <button type="button" class="btn btn-add ci-seg-section-add-btn"
            data-frm="${esc(frmId)}" data-exp="${esc(exp.id)}" data-frasco="${esc(fr.label)}"
            onclick="segAddRowFrasco(this.dataset.frm,this.dataset.exp,this.dataset.frasco)">+ Agregar</button>
        </div>
        <div class="seg-section-table-wrap">
          <table class="data-table seg-section-table">${theadHTML}
            <tbody id="segTbody-${frmId}--${esc(exp.id)}--${esc(fr.label)}"
                   data-exp-id="${esc(exp.id)}"
                   data-frasco-label="${esc(fr.label)}"></tbody>
          </table>
        </div>
      </div>`;
      });
    });

  } else {
    // Sin experimentos: una sola card limpia
    cardsHTML = `
      <div class="seg-section-card">
        <div class="seg-section-hdr">
          <span class="seg-section-hdr-title">📋 Tandas de inoculación</span>
          <button type="button" class="btn btn-add"
            onclick="segAddRow('${frmId}')">+ Agregar Tanda</button>
        </div>
        <div class="seg-section-table-wrap">
          <table class="data-table seg-section-table">${theadHTML}
            <tbody id="segTbody-${frmId}"></tbody>
          </table>
        </div>
      </div>`;
  }

  return `
    <div class="seg-inner">
      <div class="seg-inner-title">
        <span>Campo de Trabajo CI</span>
        <button type="button" class="seg-edit-toggle" onclick="segToggleEditMode('${frmId}')" data-frm="${frmId}">✏️ Edit</button>
      </div>
      <div id="segAviso-${frmId}" style="display:none;margin-bottom:10px;padding:8px 10px;border-radius:6px;background:rgba(192,0,0,0.15);border-left:3px solid #C00000;color:#FF6B6B;font-size:0.85rem;font-weight:600"></div>
      <!-- Campo de trabajo: cards independientes por sección/experimento -->
      <div id="segCampoTrabajo-${frmId}" class="seg-campo-trabajo">
        ${cardsHTML}
      </div>
      <div id="segResumenGenetica-${frmId}" style="margin-top:10px;padding:10px;background:var(--bg-secondary);border-radius:6px;font-size:0.85rem;"></div>
      <!-- Totales globales -->
      <div id="segTotalesGlobal-${frmId}" style="margin-top:8px;display:flex;gap:12px;flex-wrap:wrap;padding:8px 10px;background:var(--bg-secondary);border-radius:6px;border:1px solid var(--border);font-family:'JetBrains Mono',monospace;font-size:11px"></div>
      <!-- Seguimiento CI — historial acumulado de notas por tanda -->
      <div style="margin-top:16px;border-top:1px solid var(--border);padding-top:12px;">
        <div onclick="segToggleSeguimiento('${frmId}')" style="cursor:pointer;display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:6px;font-size:11px;font-weight:700;color:var(--tx2);user-select:none;margin-bottom:8px;">
          <span id="seg-seg-chev-${frmId}">▼</span>
          <span>📋 Seguimiento CI</span>
          <span id="seg-seg-badge-${frmId}" style="display:none;font-size:10px;font-weight:700;background:var(--ac2);color:#fff;border-radius:10px;padding:1px 7px;margin-left:4px;"></span>
        </div>
        <div id="seg-seguimiento-body-${frmId}">
          <div id="segSeguimientoNotas-${frmId}"></div>
        </div>
      </div>
    </div>`;
}

// ── Agregar fila de tanda ──
function segAddRow(frmId) {
  const tbody = document.getElementById('segTbody-' + frmId);
  if (!tbody) return;
  const idx = String(Date.now());

  // Auto-generar ID de tanda usando el total de filas entre todas las secciones
  const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const filaActual = _segGetAllRows(frmId).length;
  const letra = filaActual < letras.length ? letras[filaActual] : String(filaActual + 1);
  const tandaAuto = frmId + '-' + letra;

  const tr = document.createElement('tr');
  tr.className = 'seg-row';
  tr.dataset.rowId = idx;
  tr.dataset.expId = '';
  tr.dataset.expFrascoLabel = '';
  tr.innerHTML = _segNewRowInnerHTML(frmId, tandaAuto, idx);
  tbody.appendChild(tr);

  // Drawer de notas inline (colapsado por defecto)
  const drawerTr = document.createElement('tr');
  drawerTr.className = 'seg-note-drawer';
  drawerTr.dataset.rowId = idx;
  drawerTr.style.display = 'none';
  drawerTr.innerHTML = `<td colspan="11" class="seg-drawer-td"><div class="seg-drawer-inner" id="seg-drawer-${frmId}-${idx}"></div></td>`;
  tbody.appendChild(drawerTr);

  segInicializarGeneticas(frmId);
  segVerificarModoEdicion(frmId);
  segActualizarResumen(frmId);
}

// ── Agregar fila en una sección de frasco de experimento ──
function segAddRowFrasco(frmId, expId, frascoLabel) {
  const tbodyId = 'segTbody-' + frmId + '--' + expId + '--' + frascoLabel;
  const tbody   = document.getElementById(tbodyId);
  if (!tbody) return;
  const idx = String(Date.now());

  // Auto-generar ID: CI-0001-A1, CI-0001-A2, CI-0001-B1, ...
  // El sufijo incluye el label del frasco para distinguir secciones
  const sectionRows = tbody.querySelectorAll('tr.seg-row').length;
  const tandaAuto = frmId + '-' + frascoLabel + (sectionRows + 1);

  const tr = document.createElement('tr');
  tr.className = 'seg-row';
  tr.dataset.rowId = idx;
  tr.dataset.expId = expId;
  tr.dataset.expFrascoLabel = frascoLabel;
  tr.innerHTML = _segNewRowInnerHTML(frmId, tandaAuto, idx);
  tbody.appendChild(tr);

  // Drawer de notas inline (colapsado por defecto)
  const drawerTr = document.createElement('tr');
  drawerTr.className = 'seg-note-drawer';
  drawerTr.dataset.rowId = idx;
  drawerTr.style.display = 'none';
  drawerTr.innerHTML = `<td colspan="11" class="seg-drawer-td"><div class="seg-drawer-inner" id="seg-drawer-${frmId}-${idx}"></div></td>`;
  tbody.appendChild(drawerTr);

  segInicializarGeneticas(frmId);
  segVerificarModoEdicion(frmId);
  segActualizarResumen(frmId);
}

// ── HTML interno compartido para filas nuevas ──
function _segNewRowInnerHTML(frmId, tandaAuto, rowId) {
  const rid = rowId || '';
  return `
    <td><input type="text" class="seg-tanda" value="${tandaAuto}" oninput="segActualizarResumen('${frmId}')"></td>
    <td><select class="seg-genetica" onchange="segOnChangeGenetica(this)"><option value="">Seleccionar genética</option></select></td>
    <td class="seg-inoculo-cell">
      <select class="seg-inoculo-ci" onchange="segOnChangeInoculoCi(this)"
        style="width:100%;font-size:11px;padding:4px 6px;border-radius:5px;background:var(--bg-tertiary);border:1px solid var(--border);color:var(--tx)">
        ${segBuildOptsInoculo('')}
      </select>
    </td>
    <td><input type="datetime-local" class="seg-inoculo-fecha" onchange="segOnChangeInoculoFecha(this)" style="width:170px;padding:4px 6px;border-radius:4px;font-size:11px;background:var(--bg-tertiary);border:1px solid var(--border);color:var(--tx)"></td>
    <td><input type="number" class="seg-placas" value="0" min="0" onchange="segOnChangePlacas(this)"></td>
    <td><input type="number" class="seg-contaminados" value="0" min="0" onchange="segOnChangeContaminados(this)"></td>
    <td><input type="datetime-local" class="seg-colonizacion" onchange="segOnChangeColonizacion(this)" style="width:170px;padding:4px 6px;border-radius:4px;font-size:11px;background:var(--bg-tertiary);border:1px solid var(--border);color:var(--tx)"></td>
    <td class="seg-td-dias" style="text-align:center;font-size:11px;color:var(--tx3)">—</td>
    <td><span class="seg-ratio">—</span></td>
    <td class="seg-acc-cell" style="text-align:center;padding:4px 6px;">
      <div class="seg-acc-inner">
        <button type="button" class="seg-crec-btn" onclick="segAbrirReporteTanda(this)" title="Reporte de trazabilidad de esta tanda">📊</button>
        <button type="button" class="seg-note-toggle-btn" onclick="segToggleNoteDrawer(this,'${frmId}','${rid}')" title="Notas de seguimiento de esta tanda">📝</button>
      </div>
    </td>
    <td class="col-acciones" style="display:none"><button type="button" class="btn-remove" onclick="segRemoveRow(this)">✕</button></td>`;
}

function segRemoveRow(btn) {
  const row = btn.closest('tr'); if (!row) return;
  const tbody = row.closest('tbody');
  // Eliminar también el drawer de notas inline que sigue a esta fila
  const drawerTr = row.nextElementSibling;
  if (drawerTr && drawerTr.classList.contains('seg-note-drawer')) drawerTr.remove();
  row.remove();
  const frmId = _segFrmIdFromTbodyId(tbody?.id || '');
  if (frmId) {
    segActualizarTotales(frmId);
    segActualizarResumen(frmId);
    segGuardarTandas(frmId);   // auto-persistir al eliminar fila
  }
}

// ════════════════════════════════════════════
// SEG — Botón 📊 CONOCIMIENTO: handoff a CILAB
// ════════════════════════════════════════════

/**
 * Lee el snapshot de una fórmula directamente de localStorage.
 * No depende de que CILAB esté montado.
 * Devuelve { nombre, ings:[{id,nombre,qty,unidad}] } o null.
 */
function _segGetFormulaSnapshotCI(frmId) {
  try {
    const formsRaw = localStorage.getItem('bl2_forms');
    const ingsRaw  = localStorage.getItem('bl2_ings');
    if (!formsRaw || !ingsRaw) return null;
    const forms = JSON.parse(formsRaw);
    const ings  = JSON.parse(ingsRaw);
    const form  = Array.isArray(forms) ? forms.find(f => f.id === frmId) : null;
    if (!form) return null;
    const ingRows = (form.ingredientes || []).map(row => {
      const ing = ings.find(i => i.id === row.id);
      return { id: row.id, nombre: ing?.nombre || row.id, qty: row.qty || 0, unidad: row.unidad || 'gr' };
    });
    return { nombre: form.nombre || frmId, ings: ingRows };
  } catch (e) {
    console.warn('[CI] _segGetFormulaSnapshotCI error:', e);
    return null;
  }
}

/**
 * Botón 📊 por fila de tanda en el seguimiento.
 * Busca o crea el CRERecord en bl2_crec, escribe la acción pendiente,
 * y navega a CILAB → pestaña Conocimiento.
 */

/**
 * Abre modal de trazabilidad completa para la tanda de la fila.
 * Reemplaza el antiguo 📋 que navegaba a CILAB Conocimiento.
 * Muestra: fórmula, tanda, métricas biológicas, ensayos CRE vinculados, notas CI.
 */
function segAbrirReporteTanda(btn) {
  const tr    = btn.closest('tr');
  const tbody = btn.closest('tbody');
  if (!tr || !tbody) return;
  const frmId = _segFrmIdFromTbodyId(tbody.id || '');
  if (!frmId) return;

  // ── Datos de la fila ───────────────────────────────────────────────────
  const tandaId      = tr.querySelector('.seg-tanda')?.value?.trim()    || '';
  const rowId        = tr.dataset.rowId || '';
  const geneticaSel  = tr.querySelector('.seg-genetica');
  const geneticaLbl  = _segAbreviarEspecie(
    geneticaSel?.options[geneticaSel.selectedIndex]?.text || ''
  );
  const placas       = parseInt(tr.querySelector('.seg-placas')?.value)       || 0;
  const contaminados = parseInt(tr.querySelector('.seg-contaminados')?.value) || 0;
  const colonizacion = tr.querySelector('.seg-colonizacion')?.value           || '';
  const inoculoTs    = tr.dataset.inoculoTs                                   || '';

  const diasActual = inoculoTs
    ? Math.floor((Date.now() - new Date(inoculoTs).getTime()) / 86400000)
    : null;

  // Días hasta colonización completa (desde inoculoTs hasta la fecha ingresada)
  const colonDays = (inoculoTs && colonizacion)
    ? Math.round(
        (_segParseDate(colonizacion).getTime() - new Date(inoculoTs).getTime())
        / 86400000
      )
    : null;

  const ratio = placas > 0 ? ((placas - contaminados) / placas * 100).toFixed(1) + '%' : '—';

  // ── Nombre de fórmula ──────────────────────────────────────────────────
  let formulaNombre = frmId;
  try {
    const f = gDB(K.forms).find(x => x.id === frmId);
    if (f?.nombre) formulaNombre = f.nombre;
  } catch(e) { /* usar frmId como fallback */ }

  // ── CRERecords vinculados a esta tanda ─────────────────────────────────
  let crecs = [];
  try {
    const raw = JSON.parse(localStorage.getItem('bl2_crec') || '[]');
    if (Array.isArray(raw)) {
      crecs = raw.filter(r =>
        r.formulaId === frmId &&
        (!tandaId || r.tandaId === tandaId || r.tandaId === rowId)
      );
    }
  } catch(e) { /* sin crecs */ }

  // ── Notas CI (últimas 8) ───────────────────────────────────────────────
  let notas = [];
  try {
    const raw = JSON.parse(localStorage.getItem('bl2_seg_notas') || '{}');
    if (raw && Array.isArray(raw[frmId])) notas = raw[frmId].slice(0, 8);
  } catch(e) { /* sin notas */ }

  // ── Formateo de fechas ─────────────────────────────────────────────────
  const fmtDate = iso => iso
    ? new Date(iso).toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' })
    : '—';
  const inoFmt   = inoculoTs    ? fmtDate(inoculoTs)               : '—';
  const colonFmt = colonizacion ? fmtDate(_segParseDate(colonizacion).toISOString()) : '—';

  // ── Render HTML de ensayos CRE ─────────────────────────────────────────
  const CRE_FASES  = ['lag', 'temprana', 'preliminar', 'definitiva'];
  const CRE_SHORTS = { lag: 'Lag', temprana: 'Temp.', preliminar: 'Prel.', definitiva: 'Def.' };

  const creHTML = crecs.length
    ? crecs.map(rec => {
        const obs    = rec.observaciones || [];
        const def    = obs.find(o => o.tipo === 'definitiva');
        const stClr  = rec.status === 'activo' ? '#00CC99' : '#777';
        const stLbl  = rec.status === 'activo'
          ? 'Activo · D+' + (diasActual ?? '?')
          : 'Cerrado';
        const fases  = CRE_FASES.map(f => {
          const o = obs.find(x => x.tipo === f);
          if (!o) return `<span style="color:#555;font-size:10px">${CRE_SHORTS[f]}:○</span>`;
          const sc = o.scoreObservado != null ? `${+(o.scoreObservado * 10).toFixed(0)}/100` : '✓';
          return `<span style="color:#00CC99;font-size:10px">${CRE_SHORTS[f]}:●${sc}</span>`;
        }).join(' · ');
        return `
          <div style="padding:8px 10px;border:1px solid var(--border);border-radius:6px;
               margin-bottom:6px;font-size:12px">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px">
              <b style="color:var(--tx)">${rec.id}</b>
              <span style="color:${stClr};font-size:11px">${stLbl}</span>
            </div>
            <div style="color:var(--tx3);font-size:11px">
              Inoculación: ${fmtDate(rec.inoculationDate)}
            </div>
            ${def?.scoreObservado != null
              ? `<div style="color:#00CC99;font-size:11px;margin-top:2px">
                   Score definitivo: ${+(def.scoreObservado * 10).toFixed(0)}/100
                   ${def.fenotipo ? ' · ' + def.fenotipo : ''}
                 </div>`
              : ''}
            <div style="margin-top:5px;display:flex;gap:6px;flex-wrap:wrap">${fases}</div>
          </div>`;
      }).join('')
    : `<div style="color:var(--tx3);font-size:12px;font-style:italic;padding:8px 0">
         Sin ensayos CILAB vinculados. Abrí CILAB → Conocimiento para crear uno.
       </div>`;

  // ── Render HTML de notas CI ────────────────────────────────────────────
  const notasHTML = notas.length
    ? notas.map(n => {
        const c = n.estado === 'green' ? '#00CC99'
          : n.estado === 'red'    ? 'var(--st-crit)'
          : n.estado === 'yellow' ? '#FFC000'
          : 'var(--tx3)';
        return `<div style="font-size:11px;color:${c};padding:3px 0;
             border-bottom:1px solid rgba(255,255,255,0.04);
             white-space:nowrap;overflow:hidden;text-overflow:ellipsis"
             title="${esc(n.texto)}">${esc(n.texto)}</div>`;
      }).join('')
    : `<div style="color:var(--tx3);font-size:11px;font-style:italic">Sin notas registradas</div>`;

  // ── Ratio color ────────────────────────────────────────────────────────
  const ratioNum    = parseFloat(ratio);
  const ratioColor  = isNaN(ratioNum) ? 'var(--tx3)'
    : ratioNum >= 80 ? 'var(--st-activa)'
    : ratioNum >= 50 ? '#FFC000'
    : 'var(--st-crit)';

  const colonColor  = colonDays == null ? 'var(--tx3)'
    : colonDays <= 7  ? 'var(--st-activa)'
    : colonDays <= 12 ? '#FFC000'
    : 'var(--st-crit)';

  // ── Inyectar / reciclar overlay ────────────────────────────────────────
  let overlay = document.getElementById('seg-report-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'seg-report-overlay';
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'background:rgba(0,0,0,.65)',
      'z-index:9999', 'display:flex', 'align-items:flex-start',
      'justify-content:center', 'padding:32px 16px', 'overflow-y:auto',
    ].join(';');
    overlay.addEventListener('click', e => { if (e.target === overlay) segCerrarReporte(); });
    document.body.appendChild(overlay);
  }

  overlay.innerHTML = `
    <div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:12px;
         width:100%;max-width:560px;padding:22px 24px;position:relative;
         box-shadow:0 12px 40px rgba(0,0,0,.5)">

      <!-- ✕ cerrar -->
      <button onclick="segCerrarReporte()"
        style="position:absolute;top:12px;right:12px;background:transparent;
               border:1px solid var(--border);border-radius:6px;padding:3px 8px;
               cursor:pointer;color:var(--tx3);font-size:12px;line-height:1">✕</button>

      <!-- Título -->
      <div style="margin-bottom:16px;padding-right:32px">
        <div style="font-size:15px;font-weight:700;color:var(--tx)">${esc(formulaNombre)}</div>
        <div style="font-size:11px;color:var(--tx3);margin-top:3px">
          ${esc(frmId)}
          ${tandaId ? ` · <b style="color:var(--tx)">${esc(tandaId)}</b>` : ''}
          ${geneticaLbl ? ` · 🧬 ${esc(geneticaLbl)}` : ''}
        </div>
      </div>

      <!-- Métricas clave -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px">
        <div style="background:var(--bg-tertiary);border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:22px;font-weight:700;color:var(--st-activa)">
            ${diasActual != null ? 'D+' + diasActual : '—'}
          </div>
          <div style="font-size:9px;color:var(--tx3);margin-top:2px;text-transform:uppercase;
               letter-spacing:.04em">Días desde inóculo</div>
        </div>
        <div style="background:var(--bg-tertiary);border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:22px;font-weight:700;color:${colonColor}">
            ${colonDays != null ? colonDays + 'd' : '—'}
          </div>
          <div style="font-size:9px;color:var(--tx3);margin-top:2px;text-transform:uppercase;
               letter-spacing:.04em">Días a colonización</div>
        </div>
        <div style="background:var(--bg-tertiary);border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:22px;font-weight:700;color:${ratioColor}">
            ${ratio}
          </div>
          <div style="font-size:9px;color:var(--tx3);margin-top:2px;text-transform:uppercase;
               letter-spacing:.04em">Ratio viable</div>
        </div>
      </div>

      <!-- Fechas + placas -->
      <div style="background:var(--bg-tertiary);border-radius:8px;padding:10px 14px;
           margin-bottom:14px;font-size:12px;display:flex;gap:16px;flex-wrap:wrap;
           line-height:1.8">
        <div><span style="color:var(--tx3)">Inoculación:</span> <b>${inoFmt}</b></div>
        <div>
          <span style="color:var(--tx3)">Colonización completa:</span>
          <b>${colonFmt}</b>
          ${colonDays != null
            ? `<span style="color:var(--tx3);margin-left:4px">(${colonDays}d)</span>`
            : ''}
        </div>
        <div>
          <span style="color:var(--tx3)">Placas:</span> <b>${placas}</b>
          &nbsp;·&nbsp;
          <span style="color:var(--tx3)">Contam.:</span>
          <b style="color:${contaminados > 0 ? 'var(--st-crit)' : 'var(--tx)'}">${contaminados}</b>
        </div>
      </div>

      <!-- Ensayos CILAB -->
      <div style="margin-bottom:14px">
        <div style="font-size:10px;font-weight:700;color:var(--tx3);text-transform:uppercase;
             letter-spacing:.06em;margin-bottom:8px">Ensayos CILAB vinculados (${crecs.length})</div>
        ${creHTML}
      </div>

      <!-- Notas CI -->
      <div>
        <div style="font-size:10px;font-weight:700;color:var(--tx3);text-transform:uppercase;
             letter-spacing:.06em;margin-bottom:6px">Últimas notas CI</div>
        ${notasHTML}
      </div>
    </div>
  `;

  overlay.style.display = 'flex';
}

function segCerrarReporte() {
  const o = document.getElementById('seg-report-overlay');
  if (o) o.style.display = 'none';
}

function segAbrirObsCrecimiento(btn) {
  const tr     = btn.closest('tr');
  const tbody  = btn.closest('tbody');
  if (!tr || !tbody) return;

  // Leer frmId desde el tbody id (segTbody-<frmId> o segTbody-<frmId>--...)
  const frmId  = _segFrmIdFromTbodyId(tbody.id || '');
  if (!frmId) { console.warn('[CI] 📊 no se pudo extraer frmId'); return; }

  // Leer geneticaId y tandaId desde la fila
  const geneticaSel = tr.querySelector('.seg-genetica');
  const geneticaId  = geneticaSel?.value || '';
  const geneticaLabel = geneticaSel?.options[geneticaSel.selectedIndex]?.text || '';
  const tandaInput  = tr.querySelector('.seg-tanda');
  const tandaId     = tandaInput?.value?.trim() || '';

  // Fecha de inoculación = colonización o hoy
  const colonizEl   = tr.querySelector('.seg-colonizacion');
  const inoculationDate = colonizEl?.value || new Date().toISOString().slice(0, 10);

  // Conocimiento lee el formulaId y hace scroll al card correspondiente
  localStorage.setItem('bl2_pending_crec_action', JSON.stringify({ formulaId: frmId }));

  // Navegar a CILAB → pestaña conocimiento
  if (typeof window.loadModule === 'function') {
    window.loadModule('CILAB');
    // Esperar a que CILAB monte y activar la subtab. Máximo 15 reintentos (~1.2s).
    let _waitRetries = 0;
    const _waitAndNav = () => {
      const tabBtn = document.querySelector('[data-clabtab="conocimiento"]');
      if (tabBtn && typeof clabSubTab === 'function') {
        clabSubTab('conocimiento');
      } else if (++_waitRetries < 15) {
        setTimeout(_waitAndNav, 80);
      } else {
        console.warn('[CI] 📊 CILAB no montó a tiempo — pending action guardada en storage');
      }
    };
    setTimeout(_waitAndNav, 120);
  } else {
    // Fallback: si CILAB ya está montado (mismo frame)
    if (typeof clabSubTab === 'function') clabSubTab('conocimiento');
  }
}

// ════════════════════════════════════════════
// SEG — Inóculo CI: helpers y handler
// ════════════════════════════════════════════

// Frascos CI consumidos por experimentos para un cultivo
function _exConsumidoByCultivo(ciId) {
  try {
    const raw = localStorage.getItem('fr_experimentos');
    if (!raw) return 0;
    const exs = JSON.parse(raw);
    if (!Array.isArray(exs)) return 0;
    return exs.reduce((sum, ex) => {
      if (!Array.isArray(ex.insumos)) return sum;
      return sum + ex.insumos.reduce((s, ins) =>
        (ins.tipo === 'ci' && ins.ciId === ciId) ? s + (parseInt(ins.cantidad) || 0) : s, 0);
    }, 0);
  } catch(e) { return 0; }
}

// Stock real de un cultivo — desde CiGrLinks si está disponible, sino desde bl2_cultivos
function segStockRealCultivo(cultivoCiId) {
  if (!cultivoCiId) return 0;
  const exConsumido = _exConsumidoByCultivo(cultivoCiId);
  if (window.CiGrLinks && typeof window.CiGrLinks.stockEfectivoByCultivo === 'function') {
    try {
      const raw = localStorage.getItem('bl2_cultivos');
      const arr = raw ? JSON.parse(raw) : [];
      const c = Array.isArray(arr) ? arr.find(x => x && x.id === cultivoCiId) : null;
      if (c) return Math.max(0, window.CiGrLinks.stockEfectivoByCultivo(cultivoCiId, c.cantidadInicial) - exConsumido);
    } catch (e) { /* fallback */ }
  }
  try {
    const raw = localStorage.getItem('bl2_cultivos');
    const arr = raw ? JSON.parse(raw) : [];
    const c = Array.isArray(arr) ? arr.find(x => x && x.id === cultivoCiId) : null;
    return c ? Math.max(0, (c.cantidadDisponible || 0) - exConsumido) : 0;
  } catch (e) { return 0; }
}

// ── Helpers de formateo para etiquetas de Inoculo trace ──────────────────────

/**
 * Abrevia el código CI eliminando el segmento de año de 4 dígitos.
 * "CI-2026-0003" → "CI-0003"
 */
function _segAbreviarCodigoCi(codigo) {
  if (!codigo) return '';
  return codigo.replace(/-\d{4}-/, '-');
}

/**
 * Abrevia el label de genética abreviando solo la especie (primer segmento).
 * "Psilocybe cubensis / APE / 244" → "PC / APE / 244"
 * Toma la inicial mayúscula de cada palabra del nombre de especie.
 */
function _segAbreviarEspecie(label) {
  if (!label) return '?';
  const partes  = label.split(' / ');
  const especie = partes[0].trim();
  const resto   = partes.slice(1);
  const abrev   = especie.split(/\s+/).map(w => (w[0] || '').toUpperCase()).join('');
  return resto.length ? [abrev, ...resto].join(' / ') : abrev;
}

/**
 * Construye la etiqueta legible de un cultivo CI para los selects de Inoculo trace.
 * Formato: "Tiamina complex - CI-0003 - PC / APE / 244 · PLACA · 12 disp."
 * @param {object} c        - objeto cultivo (con _stockReal ya calculado)
 * @param {Object} formsMap - mapa id→nombre de bl2_forms
 */
function _segEtiquetaInoculo(c, formsMap) {
  const formulaNombre = (c.medioFormulaId && formsMap && formsMap[c.medioFormulaId]) || '';
  const codigoCorto   = _segAbreviarCodigoCi(c.codigo || '');
  const lbl           = (c.geneticaSnapshot && c.geneticaSnapshot.label) || c.geneticaId || '?';
  const geneticaAbrev = _segAbreviarEspecie(lbl);
  const tipo          = c.tipo || '';
  const stock         = c._stockReal != null ? c._stockReal : (c.cantidadDisponible || 0);
  const prefijo       = formulaNombre ? `${formulaNombre} - ${codigoCorto}` : codigoCorto;
  return `${prefijo} - ${geneticaAbrev} · ${tipo} · ${stock} disp.`;
}

// Construye las opciones para el selector de Inoculo trace
// Excluye cultivos de fórmulas archivadas; mantiene vintage option si ya estaba seleccionado
function segBuildOptsInoculo(selectedId) {
  // Cargar cultivos y construir mapa de fórmulas
  let cultivos = [];
  let formsMap = {};
  try {
    const formsRaw = localStorage.getItem('bl2_forms');
    const forms = formsRaw ? JSON.parse(formsRaw) : [];
    if (Array.isArray(forms)) {
      const archivadas = new Set(forms.filter(f => f.archivada).map(f => f.id));
      forms.forEach(f => { if (f && f.id) formsMap[f.id] = f.nombre || ''; });

      const raw = localStorage.getItem('bl2_cultivos');
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) {
        cultivos = arr.filter(c => {
          if (!c || c.estado === 'DESCARTADO') return false;
          const consumido = window.CiGrLinks
            ? window.CiGrLinks.stockConsumidoByCultivo(c.id)
            : 0;
          const stock = Math.max(0, (c.cantidadInicial || 0) - consumido);
          if (stock <= 0) return false;
          if (c.medioFormulaId && archivadas.has(c.medioFormulaId)) return false;
          return true;
        }).map(c => ({
          ...c,
          _stockReal: Math.max(0, (c.cantidadInicial || 0) - (window.CiGrLinks ? window.CiGrLinks.stockConsumidoByCultivo(c.id) : 0))
        }));
      }
    }
  } catch (e) { /* sin cultivos */ }

  let opts = '<option value="">— Sin Inoculo trace —</option>';

  // Si hay un cultivo seleccionado que ya no aparece en la lista (agotado, archivado),
  // inyectar una "vintage option" para preservar trazabilidad histórica
  if (selectedId && !cultivos.some(c => c.id === selectedId)) {
    let label = selectedId;
    let estado = 'no disp.';
    try {
      const raw = localStorage.getItem('bl2_cultivos');
      const arr = raw ? JSON.parse(raw) : [];
      const c = Array.isArray(arr) ? arr.find(x => x && x.id === selectedId) : null;
      if (c) {
        label  = _segEtiquetaInoculo({ ...c, _stockReal: 0 }, formsMap);
        estado = c.estado;
      }
    } catch (e) {}
    opts += `<option value="${esc(selectedId)}" data-vintage="1">⚠ ${esc(label)} (${esc(estado)})</option>`;
  }

  if (cultivos.length) {
    opts += '<optgroup label="🔗 Inoculo trace disponibles">';
    opts += cultivos.map(c =>
      `<option value="${esc(c.id)}">${esc(_segEtiquetaInoculo(c, formsMap))}</option>`
    ).join('');
    opts += '</optgroup>';
  } else if (!selectedId) {
    opts += '<option value="" disabled>— Sin cultivos disponibles —</option>';
  }

  return opts;
}

// Handler: cambio de selector Inoculo trace → nota automática de trazabilidad

/**
 * Formatea días desde un inoculoTs ISO string.
 * Devuelve "D+N" si hay timestamp válido, "—" si no.
 */
// colonizacion = valor opcional; si presente, D queda sellado (fijo). Sin él: contador vivo.
function _segFmtDias(inoculoTs, colonizacion) {
  if (!inoculoTs) return '—';
  const inoDate = new Date(inoculoTs);
  if (isNaN(inoDate)) return '—';
  if (colonizacion) {
    const colDate = _segParseDate(colonizacion);
    if (!colDate || isNaN(colDate)) return '—';
    const d = Math.round((colDate - inoDate) / 86400000);
    return isFinite(d) && d >= 0 ? 'D ' + d : '—';
  }
  const ms = Date.now() - inoDate.getTime();
  if (ms < 0) return '—';
  return 'D+' + Math.floor(ms / 86400000);
}

/**
 * Actualiza la celda seg-td-dias del row con D+ actual.
 * Llamar cada vez que inoculoTs cambia.
 */
function segActualizarDias(row) {
  const cell = row.querySelector('.seg-td-dias');
  if (!cell) return;
  const inoFechaVal = row.querySelector('.seg-inoculo-fecha')?.value;
  const colonVal    = row.querySelector('.seg-colonizacion')?.value;
  const _inoParsed  = inoFechaVal ? _segParseDate(inoFechaVal) : null;
  const inoSrc      = (_inoParsed && !isNaN(_inoParsed)) ? _inoParsed.toISOString() : (row.dataset.inoculoTs || '');
  cell.textContent  = _segFmtDias(inoSrc, colonVal || null);
}

function segOnChangeInoculoCi(selectEl) {
  const row = selectEl.closest('tr.seg-row');
  if (!row) return;
  const cultivoCiId = selectEl.value;

  // Nota automática ⚪ Normal al seleccionar Inoculo trace
  const tbody = row.closest('tbody');
  const frmId = _segFrmIdFromTbodyId(tbody?.id || '');
  if (frmId && cultivoCiId) {
    const tanda    = row.querySelector('.seg-tanda')?.value || '—';
    const optLabel = selectEl.options[selectEl.selectedIndex]?.textContent?.trim() || cultivoCiId;
    const ts       = segTimestamp();
    segEmitirNotaAuto(frmId, 'none',
      `🔗 Inoculo trace seleccionado — ${ts} — ${optLabel} [${tanda}]`,
      tanda !== '—' ? tanda : null);
  }
  // Auto-save: el cambio de inóculo también dispara el guardado
  if (frmId) segActualizarResumen(frmId);
}

// Refrescar todos los selectores de Inoculo trace cuando cambia el inventario
function segRefrescarSelectoresInoculo() {
  document.querySelectorAll('.seg-inoculo-ci').forEach(sel => {
    const prev = sel.value;
    sel.innerHTML = segBuildOptsInoculo(prev);
    if (prev) sel.value = prev;
  });
}

function segInicializarGeneticas(frmId) {
  // Intentar vía API en memoria primero (GE montado)
  // Si GE no está montado, leer directamente de localStorage 'biolab.ge.v4'
  let genetics = [];
  if (window.ge && typeof window.ge.getSelectableGenetics === 'function') {
    genetics = window.ge.getSelectableGenetics();
  } else {
    try {
      const raw = JSON.parse(localStorage.getItem('biolab.ge.v4'));
      if (raw && Array.isArray(raw.nodes) && raw.nodes.length) {
        const nodes = raw.nodes;
        const getChildren = pid => nodes.filter(n => n.parentId === pid);
        const getNode     = id  => nodes.find(n => n.id === id) || null;
        function getAncestors(id) {
          const chain = []; let cur = getNode(id);
          while (cur) { chain.unshift(cur); cur = cur.parentId ? getNode(cur.parentId) : null; }
          return chain;
        }
        genetics = nodes
          .filter(n => {
            if (n.type === 'species') return false;
            if (n.type === 'phenotype') return true;
            if (n.type === 'strain') return getChildren(n.id).length === 0;
            return false;
          })
          .map(n => {
            const chain = getAncestors(n.id);
            const sp = chain.find(x => x.type === 'species');
            const st = chain.find(x => x.type === 'strain');
            const parts = [];
            if (sp) parts.push(sp.name);
            if (st && st.id !== n.id) parts.push(st.name);
            parts.push(n.name);
            return { id: n.id, label: parts.join(' / ') };
          })
          .sort((a, b) => a.label.localeCompare(b.label, 'es'));
      }
    } catch(e) { console.warn('[CI] No se pudo leer genéticas de GE localStorage', e); }
  }

  let optsHtml = '<option value="">Seleccionar genética</option>';
  if (genetics.length) {
    optsHtml += genetics.map(g => `<option value="${g.id}">${esc(_segAbreviarEspecie(g.label))}</option>`).join('');
  } else {
    optsHtml += '<option value="" disabled>— Sin genéticas registradas en GE —</option>';
  }

  const selects = _segGetSectionTbodys(frmId)
    .flatMap(tb => Array.from(tb.querySelectorAll('.seg-genetica')));
  selects.forEach(sel => {
    // Prioridad: dataset.geneticaId (fuente de verdad blindada) > sel.value actual
    // dataset.geneticaId se establece en segCargarTandas ANTES de que este timer corra,
    // por lo que siempre tiene el valor correcto aunque el select aún esté vacío.
    const row  = sel.closest('tr');
    const prev = (row && row.dataset.geneticaId) || sel.value || '';
    sel.innerHTML = optsHtml;
    if (prev) sel.value = prev;
  });
}

/**
 * Inoculación Confirmada = genética seleccionada + placas > 0.
 * Registra inoculoTs (una sola vez) y emite la nota de inoculación.
 * Llamar desde segOnChangePlacas y segOnChangeGenetica.
 */
function _segConfirmarInoculacion(row, frmId) {
  const geneticaId  = row.dataset.geneticaId || row.querySelector('.seg-genetica')?.value || '';
  const placas      = parseInt(row.querySelector('.seg-placas')?.value) || 0;
  if (!geneticaId || placas <= 0 || !frmId) return;

  // Auto-completar la fecha de inóculo si el usuario no la ingresó aún
  const fechaInp = row.querySelector('.seg-inoculo-fecha');
  if (fechaInp && !fechaInp.value) {
    fechaInp.value = new Date().toISOString().slice(0, 16);
  }
  // inoculoTs como timestamp de auditoría (derivado de inoculoFecha, sellado una sola vez)
  if (!row.dataset.inoculoTs) {
    const fv = fechaInp?.value;
    row.dataset.inoculoTs = fv ? _segParseDate(fv).toISOString() : new Date().toISOString();
  }
  segActualizarDias(row);

  const tanda       = row.querySelector('.seg-tanda')?.value || '—';
  const geneticaSel = row.querySelector('.seg-genetica');
  const geneticaLbl = geneticaSel?.options[geneticaSel.selectedIndex]?.textContent?.trim() || geneticaId;
  const ts          = segTimestamp();
  segEmitirNotaAuto(frmId, 'green',
    `🟢 Inoculación — ${ts} — ${placas} placa${placas !== 1 ? 's' : ''} · ${geneticaLbl} [${tanda}]`,
    tanda !== '—' ? tanda : null);
}

function segOnChangeGenetica(sel) {
  const row = sel.closest('tr'); if (!row) return;
  row.dataset.geneticaId = sel.value;
  const tbody = row.closest('tbody');
  const frmId = _segFrmIdFromTbodyId(tbody?.id || '');
  segActualizarResumen(frmId);
  // Si ya hay placas, la selección de genética completa la inoculación
  _segConfirmarInoculacion(row, frmId);
}

function segOnChangePlacas(inp) {
  const row = inp.closest('tr'); if (!row) return;
  const contInp = row.querySelector('.seg-contaminados');
  const placas  = parseInt(inp.value) || 0;
  const conta   = parseInt(contInp?.value) || 0;
  const ratioEl = row.querySelector('.seg-ratio');
  if (ratioEl) ratioEl.textContent = placas > 0 ? ((placas - conta) / placas * 100).toFixed(1) + '%' : '—';
  const tbody = inp.closest('tbody');
  const frmId = _segFrmIdFromTbodyId(tbody?.id || '');
  segActualizarTotales(frmId);
  segActualizarResumen(frmId);
  // Si ya hay genética, el ingreso de placas completa la inoculación
  _segConfirmarInoculacion(row, frmId);
}

function segOnChangeContaminados(inp) {
  const row = inp.closest('tr'); if (!row) return;
  const placasInp = row.querySelector('.seg-placas');
  // Actualizar ratio
  segOnChangePlacasRatio(row);

  const conta  = parseInt(inp.value) || 0;
  const tbody  = inp.closest('tbody');
  const frmId  = _segFrmIdFromTbodyId(tbody?.id || '');
  segActualizarTotales(frmId);
  segActualizarResumen(frmId);

  // Nota automática 🔴 Peligro solo si contaminados > 0
  if (conta > 0 && frmId) {
    const tanda = row.querySelector('.seg-tanda')?.value || '—';
    const ts = segTimestamp();
    // Calcular días desde inóculo
    let diasStr = '';
    const inoculoTs = row.dataset.inoculoTs;
    if (inoculoTs) {
      const dias = Math.round((Date.now() - new Date(inoculoTs).getTime()) / 86400000);
      diasStr = ` (${dias} día${dias !== 1 ? 's' : ''} desde inóculo)`;
    }
    segEmitirNotaAuto(frmId, 'red',
      `🔴 Contaminación — ${ts} — ${conta} placa${conta !== 1 ? 's' : ''} contaminada${conta !== 1 ? 's' : ''}${diasStr} [${tanda}]`,
      tanda !== '—' ? tanda : null);
  }
}

// Helper interno: solo actualiza ratio sin emitir nota
function segOnChangePlacasRatio(row) {
  const placas = parseInt(row.querySelector('.seg-placas')?.value) || 0;
  const conta  = parseInt(row.querySelector('.seg-contaminados')?.value) || 0;
  const ratioEl = row.querySelector('.seg-ratio');
  if (ratioEl) ratioEl.textContent = placas > 0 ? ((placas - conta) / placas * 100).toFixed(1) + '%' : '—';
}

function segOnChangeInoculoFecha(inp) {
  const row = inp.closest('tr'); if (!row) return;
  if (inp.value) row.dataset.inoculoTs = _segParseDate(inp.value).toISOString();
  segActualizarDias(row);
  const tbody = inp.closest('tbody');
  const frmId = _segFrmIdFromTbodyId(tbody?.id || '');
  if (!frmId) return;
  _segConfirmarInoculacion(row, frmId);
  segActualizarResumen(frmId);
  segGuardarTandas(frmId, true);
}

function segOnChangeColonizacion(inp) {
  const tbody = inp.closest('tbody');
  const frmId = _segFrmIdFromTbodyId(tbody?.id || '');
  segActualizarResumen(frmId);

  const fechaColon = inp.value;
  if (!fechaColon || !frmId) return;

  const row = inp.closest('tr'); if (!row) return;
  const tanda = row.querySelector('.seg-tanda')?.value || '—';

  // Fuente de verdad: inoculoFecha (user-controlled) > inoculoTs (audit) > hoy
  const inoFechaVal = row.querySelector('.seg-inoculo-fecha')?.value;
  const inoculoTs   = inoFechaVal
    ? _segParseDate(inoFechaVal)
    : row.dataset.inoculoTs ? new Date(row.dataset.inoculoTs) : new Date();
  const colonDate = _segParseDate(fechaColon);
  const diasDesde = Math.max(0, Math.round((colonDate.getTime() - inoculoTs.getTime()) / 86400000));

  segActualizarDias(row);

  const fmtColon = colonDate.toLocaleDateString('es-AR', { day:'2-digit', month:'numeric', year:'numeric' });
  const fmtIno   = inoculoTs.toLocaleDateString('es-AR', { day:'2-digit', month:'numeric', year:'numeric' });
  const ts = segTimestamp();

  segEmitirNotaAuto(frmId, 'yellow',
    `🟡 Colonización completa — ${ts} — Inoc: ${fmtIno} → Expansión completa: ${fmtColon} (${diasDesde} día${diasDesde !== 1 ? 's' : ''} desde inóculo) [${tanda}]`,
    tanda !== '—' ? tanda : null);
}

// ── SEG: helpers de tandaId ─────────────────────────────────────────────────

/**
 * Extrae el tandaId del texto de una nota legacy (que no tiene campo tandaId).
 * Las notas auto emitidas previamente incluyen "[tandaId]" al final del texto.
 */
function _segExtractTandaFromTexto(texto) {
  const m = String(texto || '').match(/\[([^\]]+)\]$/);
  return m ? m[1].trim() : null;
}

/**
 * Resuelve el tandaId de una nota:
 * 1. Campo directo nota.tandaId (notas nuevas)
 * 2. Regex sobre nota.texto (notas legacy)
 * 3. '__general__' si no hay ninguno
 */
function _segResolveTandaId(nota) {
  if (nota.tandaId) return nota.tandaId;
  const extraido = _segExtractTandaFromTexto(nota.texto);
  return extraido || '__general__';
}

/**
 * Convierte un tandaId a un string seguro para usar como parte de un id HTML.
 */
function _segSafeTandaId(tandaId) {
  return String(tandaId || '__general__').replace(/[^a-zA-Z0-9_\-]/g, '_');
}

/**
 * Inserta una nota automática en SEG.seguimientoNotas sin limpiar el textarea del usuario.
 * Se marca con auto:true para distinguirla de las manuales.
 * @param {string} frmId
 * @param {string} estado  'none'|'green'|'yellow'|'red'
 * @param {string} texto
 * @param {string|null} tandaId  ID de tanda asociada (null = General)
 */
function segEmitirNotaAuto(frmId, estado, texto, tandaId = null) {
  if (!SEG.seguimientoNotas) SEG.seguimientoNotas = {};
  if (!SEG.seguimientoNotas[frmId]) SEG.seguimientoNotas[frmId] = [];
  const eventType = texto.split(' — ')[0];
  const tId = tandaId || null;
  const arr = SEG.seguimientoNotas[frmId];
  // Reemplazar nota existente del mismo tipo+tanda en lugar de acumular
  const existingIdx = arr.findIndex(n => n.auto && n._eventType === eventType && n.tandaId === tId);
  const newNota = {
    ts: segTimestamp(), texto, estado, auto: true,
    imagenes: existingIdx >= 0 ? (arr[existingIdx].imagenes || []) : [],
    tandaId: tId,
    _eventType: eventType,
  };
  if (existingIdx >= 0) arr.splice(existingIdx, 1);
  arr.unshift(newNota);
  segRenderSeguimientoNotas(frmId);
  segPersistirNotas();
}

function segActualizarTotales(frmId) {
  const rows = _segGetAllRows(frmId);
  let totalPlacas = 0, totalConta = 0;
  rows.forEach(row => {
    totalPlacas += parseInt(row.querySelector('.seg-placas')?.value)       || 0;
    totalConta  += parseInt(row.querySelector('.seg-contaminados')?.value) || 0;
  });
  const totalEl = document.getElementById('segTotalPlacas-' + frmId);
  if (totalEl) totalEl.textContent = totalPlacas;

  const globalEl = document.getElementById('segTotalesGlobal-' + frmId);
  if (globalEl) {
    const limpias = totalPlacas - totalConta;
    const ratio   = totalPlacas > 0 ? (limpias / totalPlacas * 100).toFixed(1) + '%' : '—';
    const colorRatio = totalPlacas === 0 ? 'var(--tx3)'
      : parseFloat(ratio) >= 80 ? 'var(--ac)' : parseFloat(ratio) >= 50 ? 'var(--wn)' : 'var(--er)';
    globalEl.innerHTML = totalPlacas === 0 ? '' :
      `<span style="color:var(--tx3)">TOTAL:</span>
       <span style="color:var(--tx)"><span style="color:var(--tx3)">Placas:</span> <strong style="color:var(--ac)">${totalPlacas}</strong></span>
       <span style="color:var(--tx)"><span style="color:var(--tx3)">Contam.:</span> <strong style="color:var(--er)">${totalConta}</strong></span>
       <span style="color:var(--tx)"><span style="color:var(--tx3)">Limpias:</span> <strong style="color:var(--ac2)">${limpias}</strong></span>
       <span style="color:var(--tx)"><span style="color:var(--tx3)">Ratio:</span> <strong style="color:${colorRatio}">${ratio}</strong></span>`;
  }
}

// Auto-save: timers por frmId para debounce (evita escribir en cada keystroke)
const _segAutoSaveTimers = {};

function segActualizarResumen(frmId) {
  const resEl = document.getElementById('segResumenGenetica-' + frmId);
  if (!resEl) return;
  const rows = _segGetAllRows(frmId);

  const byGen = {};
  rows.forEach(row => {
    const sel    = row.querySelector('.seg-genetica');
    // Usar el texto de la opción seleccionada (nombre legible de cepa/fenotipo),
    // no el value (que es el ID de nodo interno).
    const genVal = sel?.value || '';
    const genLbl = genVal
      ? (sel.options[sel.selectedIndex]?.textContent?.trim() || genVal)
      : '—';
    const placas = parseInt(row.querySelector('.seg-placas')?.value) || 0;
    const conta  = parseInt(row.querySelector('.seg-contaminados')?.value) || 0;
    if (!byGen[genLbl]) byGen[genLbl] = { placas: 0, conta: 0 };
    byGen[genLbl].placas += placas;
    byGen[genLbl].conta  += conta;
  });

  if (!Object.keys(byGen).length) { resEl.innerHTML = ''; }
  else {
    resEl.innerHTML = '<div style="font-size:11px;font-weight:700;color:var(--tx3);letter-spacing:1px;text-transform:uppercase;margin-bottom:8px">RESUMEN POR GENÉTICA</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px">' +
      Object.entries(byGen).map(([gen, d]) => {
        const ratio = d.placas > 0 ? ((d.placas - d.conta) / d.placas * 100).toFixed(1) + '%' : '—';
        return `<span style="background:var(--bg-tertiary);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:12px;display:inline-flex;flex-direction:column;min-width:100px">
          <span style="color:var(--wn);font-weight:700">${esc(gen)}</span>
          <span style="color:var(--tx3);font-size:10px">${d.placas} placas · ${d.conta} conta · <span style="color:var(--ac)">${ratio}</span></span>
        </span>`;
      }).join('') + '</div>';
  }

  segActualizarTotales(frmId);

  // Auto-save con debounce de 800ms: persiste las filas al localStorage
  // automáticamente tras cada cambio, sin requerir ninguna acción manual.
  clearTimeout(_segAutoSaveTimers[frmId]);
  _segAutoSaveTimers[frmId] = setTimeout(() => {
    try {
      segGuardarTandas(frmId, true /* silencioso */);
      // Indicador visual "✓ guardado" que desaparece tras 2s
      const ind = document.getElementById('seg-autosave-indicator-' + frmId);
      if (ind) { ind.style.opacity = '1'; setTimeout(() => { ind.style.opacity = '0'; }, 2000); }
    } catch (e) {}
  }, 800);
}

// ════════════════════════════════════════════
// SEG — Persistencia de filas de tanda
// ════════════════════════════════════════════

/**
 * Lee el DOM del segTbody de frmId y guarda las filas en K.seg (bl2_seg).
 * Cada tanda queda como: { formula_id, rowId, tanda, genetica, placas, contaminados, colonizacion }
 * Las filas del frmId se reemplazan; las de otros frmId se preservan intactas.
 *
 * GUARDIA ANTI-CORRUPCIÓN: si el DOM está vacío pero storage tiene datos,
 * el save se aborta — el DOM puede estar vacío por una race condition entre
 * el autosave timer y la carga asíncrona de filas (segCargarTandas usa setTimeout 100ms).
 */
function segGuardarTandas(frmId, silencioso = false) {
  const tbodys = _segGetSectionTbodys(frmId);
  if (!tbodys.length) return;

  // Leer filas de todas las secciones
  const filas = [];
  tbodys.forEach(tbody => {
    // Contexto de experimento: desde dataset del tbody (secciones frasco)
    // o desde row.dataset (retrocompat con filas cargadas sin sección)
    const tbodyExpId    = tbody.dataset.expId      || null;
    const tbodyFrascoLb = tbody.dataset.frascoLabel || null;

    tbody.querySelectorAll('tr.seg-row').forEach(row => {
      const selInoculo    = row.querySelector('.seg-inoculo-ci');
      const inoculoCiId   = selInoculo ? (selInoculo.value || '') : '';
      let inoculoCiCodigo = '';
      if (inoculoCiId && selInoculo) {
        const opt = selInoculo.querySelector(`option[value="${inoculoCiId}"]`);
        if (opt) inoculoCiCodigo = (opt.textContent || '').split('·')[0].trim();
      }
      // Prioridad: dataset del tbody → dataset del row → null
      const experimentoId       = tbodyExpId    || row.dataset.expId         || null;
      const experimentoFrascoId = tbodyFrascoLb || row.dataset.expFrascoLabel || null;
      filas.push({
        formula_id:          frmId,
        rowId:               row.dataset.rowId || String(Date.now() + Math.random()),
        tanda:               row.querySelector('.seg-tanda')?.value        || '',
        genetica:            row.dataset.geneticaId || row.querySelector('.seg-genetica')?.value || '',
        placas:              parseInt(row.querySelector('.seg-placas')?.value)       || 0,
        contaminados:        parseInt(row.querySelector('.seg-contaminados')?.value) || 0,
        colonizacion:        row.querySelector('.seg-colonizacion')?.value  || '',
        inoculoFecha:        row.querySelector('.seg-inoculo-fecha')?.value || '',
        inoculoTs:           row.dataset.inoculoTs || '',
        inoculoCiId,
        inoculoCiCodigo,
        inoculoCiStock:      inoculoCiId ? segStockRealCultivo(inoculoCiId) : 0,
        experimentoId:       experimentoId   || null,
        experimentoFrascoId: experimentoFrascoId || null,
      });
    });
  });

  // ── GUARDIA ANTI-CORRUPCIÓN ──────────────────────────────────────────────
  // Si el DOM reporta 0 filas pero storage tiene datos para este frmId,
  // el save se aborta. Esto previene la race condition donde el autosave timer
  // dispara sobre tbodys vacíos (render sin segCargarTandas completado).
  if (filas.length === 0) {
    const filasEnStorage = gDB(K.seg).filter(s => s.formula_id === frmId);
    if (filasEnStorage.length > 0) {
      console.warn('[CI] segGuardarTandas: DOM vacío pero storage tiene', filasEnStorage.length,
        'filas para', frmId, '— save abortado para prevenir corrupción.');
      return;
    }
  }
  // ────────────────────────────────────────────────────────────────────────

  // Preservar tandas de otros frmId, reemplazar las de este
  const todas = gDB(K.seg).filter(s => s.formula_id !== frmId);
  sDB(K.seg, [...todas, ...filas]);
  _ciSyncCultivosFromSeg(frmId);
  updateHeader();
  if (!silencioso) {
    sN('💾 Tandas guardadas (' + filas.length + ' fila' + (filas.length !== 1 ? 's' : '') + ')');
  }
}

/**
 * Reconstruye las filas del segTbody desde localStorage para el frmId dado.
 * Llamar tras render del DOM (desde ciRenderFormulasList → setTimeout).
 */
function segCargarTandas(frmId) {
  const baseTbody = document.getElementById('segTbody-' + frmId);
  if (!baseTbody) return;
  // Guard: evitar doble carga si múltiples renders disparan setTimeouts solapados
  if (baseTbody.dataset.tandasCargadas) return;
  baseTbody.dataset.tandasCargadas = 'true';

  const filas = gDB(K.seg).filter(s => s.formula_id === frmId);
  if (!filas.length) return;

  // Cargar imágenes de filas persistidas para este frmId
  segCargarRowImgs(frmId);

  filas.forEach(s => {
    const rowId = s.rowId || String(Date.now() + Math.random());

    // Determinar tbody destino según experimentoId/experimentoFrascoId guardados
    let targetTbody = baseTbody;
    if (s.experimentoId && s.experimentoFrascoId) {
      const tid      = `segTbody-${frmId}--${s.experimentoId}--${s.experimentoFrascoId}`;
      const expTbody = document.getElementById(tid);
      if (expTbody) targetTbody = expTbody;
      // Si el tbody de destino no existe (experimento eliminado), cae al base — trazabilidad intacta
    }

    const tr = document.createElement('tr');
    tr.className = 'seg-row';
    tr.dataset.rowId          = rowId;
    tr.dataset.expId          = s.experimentoId       || '';
    tr.dataset.expFrascoLabel = s.experimentoFrascoId || '';
    // Blindar la genética en dataset ANTES de que el select tenga opciones.
    // segGuardarTandas lo lee aquí para evitar escribir '' si el select aún no fue
    // inicializado (race condition entre segCargarTandas y segInicializarGeneticas).
    tr.dataset.geneticaId     = s.genetica            || '';
    tr.innerHTML = `
      <td><input type="text" class="seg-tanda" placeholder="Ej: CI001" value="${esc(s.tanda || '')}" oninput="segActualizarResumen('${frmId}')"></td>
      <td><select class="seg-genetica" onchange="segOnChangeGenetica(this)"><option value="">Seleccionar genética</option></select></td>
      <td class="seg-inoculo-cell">
        <select class="seg-inoculo-ci" onchange="segOnChangeInoculoCi(this)"
          style="width:100%;font-size:11px;padding:4px 6px;border-radius:5px;background:var(--bg-tertiary);border:1px solid var(--border);color:var(--tx)">
          ${segBuildOptsInoculo(s.inoculoCiId || '')}
        </select>
      </td>
      <td><input type="datetime-local" class="seg-inoculo-fecha" value="${esc(s.inoculoFecha ? (s.inoculoFecha.length===10 ? s.inoculoFecha+'T12:00' : s.inoculoFecha.slice(0,16)) : '')}" onchange="segOnChangeInoculoFecha(this)" style="width:170px;padding:4px 6px;border-radius:5px;font-size:11px;background:var(--bg-tertiary);border:1px solid var(--border);color:var(--tx)"></td>
      <td><input type="number" class="seg-placas" value="${s.placas || 0}" min="0" onchange="segOnChangePlacas(this)"></td>
      <td><input type="number" class="seg-contaminados" value="${s.contaminados || 0}" min="0" onchange="segOnChangeContaminados(this)"></td>
      <td><input type="datetime-local" class="seg-colonizacion" value="${esc(s.colonizacion ? (s.colonizacion.length===10 ? s.colonizacion+'T12:00' : s.colonizacion.slice(0,16)) : '')}" onchange="segOnChangeColonizacion(this)" style="width:170px;padding:4px 6px;border-radius:5px;font-size:11px;background:var(--bg-tertiary);border:1px solid var(--border);color:var(--tx)"></td>
      <td class="seg-td-dias" style="text-align:center;font-size:11px;color:var(--tx3)">${_segFmtDias(s.inoculoTs, s.colonizacion)}</td>
      <td><span class="seg-ratio">—</span></td>
      <td class="seg-acc-cell" style="text-align:center;padding:4px 6px;">
        <div class="seg-acc-inner">
          <button type="button" class="seg-crec-btn" onclick="segAbrirReporteTanda(this)" title="Reporte de trazabilidad de esta tanda">📊</button>
          <button type="button" class="seg-note-toggle-btn" onclick="segToggleNoteDrawer(this,'${frmId}','${rowId}')" title="Notas de seguimiento de esta tanda">📝</button>
        </div>
      </td>
      <td class="col-acciones" style="display:none"><button type="button" class="btn-remove" onclick="segRemoveRow(this)">✕</button></td>`;
    targetTbody.appendChild(tr);

    // Drawer de notas inline (colapsado por defecto)
    const drawerTr = document.createElement('tr');
    drawerTr.className = 'seg-note-drawer';
    drawerTr.dataset.rowId = rowId;
    drawerTr.style.display = 'none';
    drawerTr.innerHTML = `<td colspan="11" class="seg-drawer-td"><div class="seg-drawer-inner" id="seg-drawer-${frmId}-${rowId}"></div></td>`;
    targetTbody.appendChild(drawerTr);

    // Restaurar inoculoTs desde storage
    if (s.inoculoTs) tr.dataset.inoculoTs = s.inoculoTs;

    // Actualizar celda D+ usando inoculoFecha como fallback cuando inoculoTs no fue persistido
    segActualizarDias(tr);

    // Restaurar ratio visual
    const placas = s.placas || 0;
    const conta  = s.contaminados || 0;
    const ratioEl = tr.querySelector('.seg-ratio');
    if (ratioEl) ratioEl.textContent = placas > 0 ? ((placas - conta) / placas * 100).toFixed(1) + '%' : '—';

    // Restaurar contador de fotos si hay imágenes persistidas
    const imgs = segGetRowImgs(rowId);
    if (imgs.length) segActualizarContadorFotos(rowId);
  });

  // Restaurar genéticas seleccionadas — esperar a que segInicializarGeneticas externo pueble los selects
  setTimeout(() => {
    filas.forEach(s => {
      const rowId = s.rowId || '';
      // Buscar la fila en cualquier sección
      let tr = null;
      for (const tb of _segGetSectionTbodys(frmId)) {
        const found = tb.querySelector(`tr[data-row-id="${rowId}"]`);
        if (found) { tr = found; break; }
      }
      if (!tr) return;
      if (s.genetica) {
        const sel = tr.querySelector('.seg-genetica');
        if (sel) sel.value = s.genetica;
      }
      if (s.inoculoCiId) {
        const selInoculo = tr.querySelector('.seg-inoculo-ci');
        if (selInoculo) selInoculo.value = s.inoculoCiId;
      }
    });
    segActualizarResumen(frmId);
    segVerificarModoEdicion(frmId);
  }, 220);
}

// ── Toggle modo edición SEG ──
function segToggleEditMode(frmId) {
  SEG.modoEdicion[frmId] = !SEG.modoEdicion[frmId];
  const btn = document.querySelector(`.seg-edit-toggle[data-frm="${frmId}"]`);
  if (btn) btn.classList.toggle('active', SEG.modoEdicion[frmId]);
  segVerificarModoEdicion(frmId);
}

function segVerificarModoEdicion(frmId) {
  const tbodys = _segGetSectionTbodys(frmId);
  if (!tbodys.length) return;
  const isEdit = SEG.modoEdicion[frmId] || false;
  tbodys.forEach(tbody => {
    tbody.querySelectorAll('.col-acciones').forEach(el => {
      el.style.display = isEdit ? 'table-cell' : 'none';
    });
  });
  // Actualizar cabeceras — puede haber múltiples tablas en el nuevo layout de cards
  const campoTrabajo = document.getElementById('segCampoTrabajo-' + frmId);
  if (campoTrabajo) campoTrabajo.querySelectorAll('th.col-acciones').forEach(th => {
    th.style.display = isEdit ? 'table-cell' : 'none';
  });
}

// ── Toggle drawer de notas inline por tanda ────────────────────────────────

/**
 * Abre / cierra el drawer de notas de seguimiento de una fila de tanda.
 * Si se abre por primera vez, renderiza el contenido (lazy init).
 * @param {HTMLElement} btn   - botón 📝 que disparó el toggle
 * @param {string}      frmId - ID de fórmula (contexto)
 * @param {string}      rowId - dataset.rowId de la tr.seg-row
 */
function segToggleNoteDrawer(btn, frmId, rowId) {
  const dataTr = btn.closest('tr.seg-row');
  if (!dataTr) return;

  // El drawer es el <tr> siguiente en el mismo tbody
  const drawerTr = dataTr.nextElementSibling;
  if (!drawerTr || !drawerTr.classList.contains('seg-note-drawer')) return;

  // rowId llega como string desde onclick — el container ID usa el mismo valor sin sanitizar
  const drawerId  = 'seg-drawer-' + frmId + '-' + rowId;
  const container = document.getElementById(drawerId);
  if (!container) return;

  const isOpen = container.classList.contains('open');

  if (isOpen) {
    // Cerrar: animar (max-height→0), luego ocultar el <tr> al terminar la transición
    container.classList.remove('open');
    btn.classList.remove('active');
    setTimeout(() => {
      if (!container.classList.contains('open')) drawerTr.style.display = 'none';
    }, 300); // igual que transition-duration en CSS
  } else {
    // Abrir: mostrar <tr> → doble rAF → disparar animación CSS
    if (!container.dataset.rendered) {
      const tandaId = dataTr.querySelector('.seg-tanda')?.value?.trim() || '';
      _segRenderDrawerContent(container, frmId, rowId, tandaId);
      container.dataset.rendered = 'true';
    }
    drawerTr.style.display = '';
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        container.classList.add('open')
      )
    );
    btn.classList.add('active');
  }
}

/**
 * Toggle de dot-button de estado en el drawer rápido.
 * Activa el dot clicado y desactiva todos los demás del mismo grupo.
 */
function segDwSetEstado(btn) {
  const group = btn.closest('.seg-dw-estado-btns');
  if (!group) return;
  group.querySelectorAll('.seg-dw-estado-dot').forEach(d => d.classList.remove('active'));
  btn.classList.add('active');
}

/**
 * Renderiza el contenido del drawer de una tanda dentro del contenedor dado.
 * Muestra: timeline de notas filtradas por tanda + formulario de nota rápida (texto+estado).
 * NO reutiliza _segRenderTandaCardForm para evitar colisión de IDs DOM con cards de Seguimiento CI.
 * Los IDs del form se basan en rowId (único por fila), nunca en tandaId (podría colisionar).
 */
function _segRenderDrawerContent(container, frmId, rowId, tandaId) {
  const allNotas = SEG.seguimientoNotas[frmId] || [];

  // Filtrar notas de esta tanda (backward compat: _segResolveTandaId maneja legacy)
  const resolvedTarget = tandaId || '__general__';
  const notasDeTanda = allNotas
    .map((n, i) => ({ ...n, globalIdx: i }))
    .filter(n => _segResolveTandaId(n) === resolvedTarget);

  // Determinar si es sección de experimento por el tbody padre
  const tbody = container.closest('tbody');
  const expId = tbody?.dataset.expId || '';
  const isExp = !!expId;

  const safeRowId = String(rowId).replace(/[^a-zA-Z0-9_\-]/g, '_');
  const tandaLabel = (tandaId && tandaId !== '__general__') ? tandaId : 'General';

  // ── Timeline de notas compacta ────────────────────────────────────────
  const timelineHtml = notasDeTanda.length
    ? notasDeTanda.map(n => _segRenderNotaTimeline(n, n.globalIdx, frmId, false)).join('')
    : '<div class="seg-drawer-empty">Sin notas para esta tanda todavía.</div>';

  // ── Foto count para el botón del drawer ─────────────────────────────
  const fotosExistentes = segGetRowImgs(rowId);
  const fotoCount = fotosExistentes.length;
  const fotoLabel = fotoCount > 0
    ? `📷 ${fotoCount} ${fotoCount === 1 ? 'imagen' : 'imágenes'}`
    : '📷 Adjuntar';

  // ── Form de nota rápida ───────────────────────────────────────────────
  // Toolbar: dot-buttons de estado | spacer | botón 📷
  // Fila:    textarea              | botón + Agregar
  const formHtml = `
    <div class="seg-drawer-quickform">
      <div class="seg-drawer-qf-toolbar">
        <div class="seg-dw-estado-btns" id="seg-dw-estadobtns-${safeRowId}">
          <button type="button" class="seg-dw-estado-dot active" data-estado="none"
                  onclick="segDwSetEstado(this)" title="Normal">⚪</button>
          <button type="button" class="seg-dw-estado-dot" data-estado="green"
                  onclick="segDwSetEstado(this)" title="Positivo">🟢</button>
          <button type="button" class="seg-dw-estado-dot" data-estado="yellow"
                  onclick="segDwSetEstado(this)" title="Atención">🟡</button>
          <button type="button" class="seg-dw-estado-dot" data-estado="red"
                  onclick="segDwSetEstado(this)" title="Peligro">🔴</button>
        </div>
        <button type="button" class="seg-foto-btn seg-dw-foto-btn"
                onclick="segToggleFotoPanel(this,'${esc(frmId)}')"
                title="Adjuntar evidencia fotográfica de esta tanda">
          <span class="seg-foto-label">${fotoLabel}</span>
          <span class="seg-foto-count" style="display:none"></span>
        </button>
      </div>
      <div class="seg-drawer-qf-row">
        <textarea id="seg-dw-nota-${safeRowId}"
                  class="seg-dw-textarea"
                  rows="2"
                  placeholder="Nota rápida — ${segEscapeHtml(tandaLabel)}"></textarea>
        <button type="button" class="seg-dw-add-btn"
                onclick="segAddNotaDrawer('${esc(frmId)}','${esc(tandaId || '__general__')}','${safeRowId}')">+ Agregar</button>
      </div>
    </div>`;

  container.innerHTML = `
    <div class="seg-drawer-wrap${isExp ? ' seg-drawer-exp' : ''}">
      <div class="seg-drawer-header">
        <span class="seg-drawer-tanda-label">${segEscapeHtml(tandaLabel)}</span>
        <span class="seg-drawer-nota-count">${notasDeTanda.length} nota${notasDeTanda.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="seg-drawer-timeline" id="seg-dw-timeline-${safeRowId}">
        ${timelineHtml}
      </div>
      ${formHtml}
    </div>`;
}

/**
 * Agrega una nota rápida desde el drawer inline de una tanda.
 * IDs basados en safeRowId para evitar colisión con cards de Seguimiento CI.
 * @param {string} frmId     - ID de fórmula
 * @param {string} tandaId   - ID de tanda (o '__general__')
 * @param {string} safeRowId - rowId sanitizado, base de los IDs del form
 */
function segAddNotaDrawer(frmId, tandaId, safeRowId) {
  const input      = document.getElementById('seg-dw-nota-' + safeRowId);
  const estadoBtns = document.getElementById('seg-dw-estadobtns-' + safeRowId);
  if (!input) return;

  const texto = (input.value || '').trim();
  if (!texto) { input.focus(); return; }

  // Leer estado desde el dot-button activo
  const activeDot = estadoBtns?.querySelector('.seg-dw-estado-dot.active');
  const estado = activeDot?.dataset.estado || 'none';

  if (!SEG.seguimientoNotas)        SEG.seguimientoNotas = {};
  if (!SEG.seguimientoNotas[frmId]) SEG.seguimientoNotas[frmId] = [];

  SEG.seguimientoNotas[frmId].push({
    ts:      segTimestamp(),
    texto,
    estado,
    auto:    false,
    imagenes: [],
    tandaId: tandaId === '__general__' ? null : tandaId,
  });

  // Limpiar form — resetear dot al estado "none"
  input.value = '';
  if (estadoBtns) {
    estadoBtns.querySelectorAll('.seg-dw-estado-dot').forEach(d => d.classList.remove('active'));
    const noneBtn = estadoBtns.querySelector('[data-estado="none"]');
    if (noneBtn) noneBtn.classList.add('active');
  }

  // Persistir
  segPersistirNotas();

  // Re-renderizar timeline del drawer (sin cambiar `rendered` flag — reaplicar inline)
  const drawerId = 'seg-drawer-' + frmId + '-' + safeRowId;
  const container = document.getElementById(drawerId);
  if (container) {
    // Reconstruir el contenido con datos actualizados
    // Recuperar tandaId real desde el input safeRowId no es necesario — lo tenemos
    const allNotas = SEG.seguimientoNotas[frmId] || [];
    const resolvedTarget = tandaId || '__general__';
    const notasDeTanda = allNotas
      .map((n, i) => ({ ...n, globalIdx: i }))
      .filter(n => _segResolveTandaId(n) === resolvedTarget);

    const timelineEl = document.getElementById('seg-dw-timeline-' + safeRowId);
    if (timelineEl) {
      timelineEl.innerHTML = notasDeTanda.length
        ? notasDeTanda.map(n => _segRenderNotaTimeline(n, n.globalIdx, frmId, false)).join('')
        : '<div class="seg-drawer-empty">Sin notas para esta tanda todavía</div>';
    }
    // Actualizar contador en header del drawer
    const countEl = container.querySelector('.seg-drawer-nota-count');
    if (countEl) countEl.textContent = `${notasDeTanda.length} nota${notasDeTanda.length !== 1 ? 's' : ''}`;
  }

  // También re-render Seguimiento CI si está abierto
  segRenderSeguimientoNotas(frmId);
}

// ── Seguimiento notas ──
function segTimestamp() {
  return new Date().toLocaleString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function segEscapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── imágenes por fila (rowId → []) ──
function segGetRowImgs(rowId) {
  if (!SEG.rowImagenes) SEG.rowImagenes = {};
  if (!SEG.rowImagenes[rowId]) SEG.rowImagenes[rowId] = [];
  return SEG.rowImagenes[rowId];
}

function segToggleFotoPanel(btn, frmId) {
  const tr = btn.closest('tr');
  if (!tr) return;
  const rowId = tr.dataset.rowId;

  // Cerrar panel existente de ESTA fila (toggle)
  const existingPanel = document.getElementById('seg-foto-panel-' + rowId);
  // Cerrar todos los paneles abiertos de este frmId
  document.querySelectorAll('.seg-foto-panel-row[data-frm="' + frmId + '"]').forEach(el => el.remove());
  // Si ya estaba abierto este → solo cerrarlo (toggle off)
  if (existingPanel) return;

  // Crear panel como div FUERA de la tabla (evita romper layout de columnas)
  const panel = document.createElement('div');
  panel.className = 'seg-foto-panel-row';
  panel.id = 'seg-foto-panel-' + rowId;
  panel.dataset.forRow = rowId;
  panel.dataset.frm = frmId;
  panel.style.cssText = 'margin:6px 0 10px 0;padding:14px 16px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;border-top:2px solid var(--ac)';
  panel.innerHTML = segBuildFotoPanel(rowId, frmId);

  // Insertar justo después de la tabla que contiene esta fila
  // (en el nuevo layout card-per-section cada sección tiene su propia tabla)
  const tableEl = btn.closest('table');
  if (tableEl) tableEl.after(panel);
}

function segBuildFotoPanel(rowId, frmId) {
  const imgs = segGetRowImgs(rowId);
  const gridHtml = imgs.length
    ? imgs.map((img, i) => `
        <div style="position:relative;display:inline-block;margin:4px">
          <img src="${img.data}" alt="${img.name||'img'}"
            style="width:110px;height:80px;object-fit:cover;border-radius:6px;cursor:pointer;border:1px solid var(--border)"
            onclick="segLightbox('${rowId}',${i})">
          <button onclick="segEliminarFotoFila('${rowId}','${frmId}',${i})"
            style="position:absolute;top:3px;right:3px;background:rgba(0,0,0,0.7);color:#fff;border:none;border-radius:50%;width:18px;height:18px;cursor:pointer;font-size:11px;line-height:18px;text-align:center">✕</button>
          <div style="font-size:9px;color:var(--tx3);text-align:center;margin-top:2px;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${img.name||''}</div>
        </div>`).join('')
    : '<span style="color:var(--tx3);font-size:0.85rem">Sin fotos aún</span>';
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <span style="font-size:10px;font-weight:700;color:var(--tx3);letter-spacing:1.5px;text-transform:uppercase">Evidencia fotográfica</span>
      <label style="display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:6px;border:1px solid var(--ac);cursor:pointer;color:var(--ac);font-size:11px;font-weight:600;background:transparent;transition:all .15s">
        + Agregar imágenes
        <input type="file" accept="image/*" multiple style="display:none"
          onchange="segAgregarFotosFila('${rowId}','${frmId}',this)">
      </label>
    </div>
    <div id="seg-foto-grid-${rowId}" style="display:flex;flex-wrap:wrap;gap:10px">${gridHtml}</div>`;
}

function segAgregarFotosFila(rowId, frmId, input) {
  const files = Array.from(input.files || []);
  if (!files.length) return;
  const imgs = segGetRowImgs(rowId);
  let loaded = 0;
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      imgs.push({ data: e.target.result, name: file.name });
      loaded++;
      if (loaded === files.length) {
        segPersistirRowImgs(frmId);
        segRefreshFotoPanel(rowId, frmId);
        segActualizarContadorFotos(rowId);
      }
    };
    reader.readAsDataURL(file);
  });
  input.value = '';
}

function segEliminarFotoFila(rowId, frmId, idx) {
  const imgs = segGetRowImgs(rowId);
  if (idx >= 0 && idx < imgs.length) {
    imgs.splice(idx, 1);
    segPersistirRowImgs(frmId);
    segRefreshFotoPanel(rowId, frmId);
    segActualizarContadorFotos(rowId);
  }
}

function segRefreshFotoPanel(rowId, frmId) {
  const panel = document.getElementById("seg-foto-panel-" + rowId);
  if (!panel) return;
  panel.innerHTML = segBuildFotoPanel(rowId, frmId);
}

function segActualizarContadorFotos(rowId) {
  const imgs  = segGetRowImgs(rowId);
  const count = imgs.length;
  // El botón puede estar en tr.seg-row (legacy) o en tr.seg-note-drawer (nuevo)
  let btn = null, label = null, span = null;
  document.querySelectorAll('tr[data-row-id="' + rowId + '"]').forEach(function(tr) {
    if (!btn)   btn   = tr.querySelector('.seg-foto-btn');
    if (!label) label = tr.querySelector('.seg-foto-label');
    if (!span)  span  = tr.querySelector('.seg-foto-count');
  });
  if (!btn) return;
  if (count > 0) {
    if (label) label.style.display = 'none';
    if (span)  { span.style.display = 'inline'; span.textContent = count + (count === 1 ? ' imagen' : ' imágenes'); }
    btn.style.color       = 'var(--ac)';
    btn.style.borderColor = 'var(--ac)';
    btn.style.fontWeight  = '600';
  } else {
    if (label) label.style.display = 'inline';
    if (span)  span.style.display = 'none';
    btn.style.color       = 'var(--tx3)';
    btn.style.borderColor = 'var(--border)';
    btn.style.fontWeight  = 'normal';
  }
}

function segPersistirRowImgs(frmId) {
  // Guardar todas las imágenes de filas del frmId en localStorage
  // Clave: bl2_seg_rowimgs_<frmId>
  try {
    localStorage.setItem('bl2_seg_rowimgs_' + frmId, JSON.stringify(SEG.rowImagenes || {}));
  } catch(e) { console.warn('[CI] localStorage lleno al guardar fotos'); }
}

function segCargarRowImgs(frmId) {
  try {
    const raw = localStorage.getItem('bl2_seg_rowimgs_' + frmId);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!SEG.rowImagenes) SEG.rowImagenes = {};
      Object.assign(SEG.rowImagenes, parsed);
    }
  } catch(e) {}
}

function segLightbox(rowId, idx) {
  const imgs = segGetRowImgs(rowId);
  if (!imgs[idx]) return;
  let current = idx;
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:9999;display:flex;align-items:center;justify-content:center';
  function renderLb() {
    const img = imgs[current];
    overlay.innerHTML = `
      <button onclick="this.closest('div').remove()" style="position:absolute;top:16px;right:20px;background:none;border:none;color:#fff;font-size:24px;cursor:pointer">✕</button>
      ${imgs.length > 1 ? `<button onclick="event.stopPropagation();window._segLbNav(-1)" style="position:absolute;left:16px;background:rgba(255,255,255,0.1);border:none;color:#fff;font-size:28px;cursor:pointer;padding:8px 14px;border-radius:6px">‹</button>` : ''}
      <img src="${img.data}" style="max-width:90vw;max-height:85vh;border-radius:8px;box-shadow:0 4px 40px rgba(0,0,0,0.9)">
      ${imgs.length > 1 ? `<button onclick="event.stopPropagation();window._segLbNav(1)" style="position:absolute;right:16px;background:rgba(255,255,255,0.1);border:none;color:#fff;font-size:28px;cursor:pointer;padding:8px 14px;border-radius:6px">›</button>` : ''}
      <div style="position:absolute;bottom:16px;color:rgba(255,255,255,0.5);font-size:12px">${img.name||''} · ${current+1}/${imgs.length}</div>`;
  }
  window._segLbNav = dir => { current = (current + dir + imgs.length) % imgs.length; renderLb(); };
  overlay.onclick = e => { if (e.target === overlay) { overlay.remove(); delete window._segLbNav; } };
  renderLb();
  document.body.appendChild(overlay);
}

/**
 * Legacy proxy — el form global fue reemplazado por cards por tanda.
 * Redirige al card de la tanda General para backward compatibility con
 * cualquier llamada externa que haya quedado.
 */
function segAddSeguimientoNota(frmId) {
  segAddNotaCard(frmId, '__general__');
}

// ════════════════════════════════════════════
// SEG — Seguimiento CI: sistema de cards por Nodo/Tanda
// ════════════════════════════════════════════

/**
 * Renderiza el panel de seguimiento CI con una card interactiva por cada Nodo/Tanda.
 * Agrupa notas por tandaId (campo directo en notas nuevas, o regex en notas legacy).
 * Preserva el índice global en el array plano para que segEditarNota /
 * segEliminarSeguimientoNota / segVerImagenNota sigan funcionando sin cambios.
 */
function segRenderSeguimientoNotas(frmId) {
  const cont = document.getElementById('segSeguimientoNotas-' + frmId);
  if (!cont) return;
  const notas  = SEG.seguimientoNotas?.[frmId] || [];
  _segActualizarBadgeSeguimiento(frmId);

  // ── Obtener tandas activas desde bl2_seg ────────────────────────────────
  const tandasStorage = gDB(K.seg).filter(s => s.formula_id === frmId);

  // ── Construir mapa: tandaId → { notas: [{nota, globalIdx}], storageRow } ─
  const grupos = new Map();

  // Registrar todas las tandas del storage (incluso sin notas = queremos card para ellas)
  tandasStorage.forEach(s => {
    const tid = (s.tanda || '').trim() || '__general__';
    if (!grupos.has(tid)) grupos.set(tid, { notas: [], storageRow: s });
    else if (!grupos.get(tid).storageRow) grupos.get(tid).storageRow = s;
  });

  // Distribuir notas en sus grupos
  notas.forEach((nota, globalIdx) => {
    const tid = _segResolveTandaId(nota);
    if (!grupos.has(tid)) grupos.set(tid, { notas: [], storageRow: null });
    grupos.get(tid).notas.push({ nota, globalIdx });
  });

  if (grupos.size === 0) {
    cont.innerHTML = '<p class="seg-tc-empty">Las notas de seguimiento se generan automáticamente al registrar inoculaciones, contaminaciones y colonizaciones por tanda.</p>';
    return;
  }

  const isEdit = SEG.modoEdicion[frmId] || false;

  // ── Ordenar: tandas del storage por inoculoTs desc, luego las huérfanas, General al final
  const ordered = [];
  tandasStorage
    .slice()
    .sort((a, b) => new Date(b.inoculoTs || 0) - new Date(a.inoculoTs || 0))
    .forEach(s => {
      const tid = (s.tanda || '').trim() || '__general__';
      if (!ordered.includes(tid)) ordered.push(tid);
    });
  [...grupos.keys()].forEach(k => {
    if (!ordered.includes(k)) ordered.push(k);
  });
  // General siempre al final
  const generalIdx = ordered.indexOf('__general__');
  if (generalIdx > -1 && ordered.length > 1) {
    ordered.splice(generalIdx, 1);
    ordered.push('__general__');
  }

  cont.innerHTML = ordered.map(tandaId => {
    const g = grupos.get(tandaId);
    if (!g) return '';
    return _segRenderTandaCard(frmId, tandaId, g.notas, g.storageRow, isEdit);
  }).join('');
}

/**
 * Genera el HTML de una card de tanda con header colapsable, timeline de notas y form.
 */
function _segRenderTandaCard(frmId, tandaId, notasGrupo, storageRow, isEdit) {
  const safeTid  = _segSafeTandaId(tandaId);
  const bodyId   = 'seg-tcb-' + frmId + '-' + safeTid;
  const chevId   = 'seg-tcchev-' + frmId + '-' + safeTid;
  const isGeneral = tandaId === '__general__';

  // Estado de expansión: default abierto
  if (!SEG.cardState[frmId]) SEG.cardState[frmId] = {};
  const isOpen = SEG.cardState[frmId][tandaId] !== false;

  // ── Stats desde storageRow ────────────────────────────────────────────
  const placas     = storageRow?.placas       || 0;
  const conta      = storageRow?.contaminados || 0;
  const limpias    = placas - conta;
  const colonFecha = storageRow?.colonizacion || '';
  const inoculoTs  = storageRow?.inoculoTs   || '';
  const diasDesde  = inoculoTs
    ? Math.floor((Date.now() - new Date(inoculoTs).getTime()) / 86400000)
    : null;
  const ratio      = placas > 0 ? Math.round(limpias / placas * 100) : null;

  // ── Contexto de experimento ───────────────────────────────────────────
  const isExp    = !!(storageRow?.experimentoId);
  const geneticaId = storageRow?.genetica || '';

  // Resolver etiquetas legibles para el header
  const formulaNombre = (() => {
    const forms = gDB(K.forms);
    return forms.find(f => f.id === frmId)?.nombre || frmId;
  })();
  const frascoLabel = storageRow?.experimentoFrascoId || (isExp ? storageRow.experimentoId : '');
  const geneticaLabel = (() => {
    if (!geneticaId) return '';
    const snap = _ciResolverGeneticaSnapshot(geneticaId);
    return snap ? snap.label : geneticaId;
  })();

  // ── Color de borde según peor estado y contexto ───────────────────────
  const worstEstado = notasGrupo.reduce((acc, { nota }) => {
    if (nota.estado === 'red')                              return 'red';
    if (nota.estado === 'yellow' && acc !== 'red')          return 'yellow';
    if (nota.estado === 'green'  && acc === 'none')         return 'green';
    return acc;
  }, 'none');
  const borderColor = isExp      ? 'var(--ac4)'
    : worstEstado === 'red'      ? 'var(--er)'
    : worstEstado === 'yellow'   ? 'var(--wn)'
    : worstEstado === 'green'    ? 'var(--ac)'
    : isGeneral                  ? 'var(--tx3)'
    : 'var(--border-light)';

  // ── Chips de métricas ─────────────────────────────────────────────────
  const ratioColor = ratio === null ? 'var(--tx3)'
    : ratio >= 80 ? 'var(--ac)' : ratio >= 50 ? 'var(--wn)' : 'var(--er)';

  const chipsHtml = isGeneral ? '' : [
    placas     ? `<span class="seg-tc-chip" style="color:var(--ac2)">${placas} 🧫</span>` : '',
    conta      ? `<span class="seg-tc-chip" style="color:var(--er)">${conta} ☠</span>` : '',
    ratio !== null ? `<span class="seg-tc-chip" style="color:${ratioColor}">${ratio}%</span>` : '',
    diasDesde !== null ? `<span class="seg-tc-chip" style="color:var(--ac4)">D+${diasDesde}</span>` : '',
    colonFecha ? `<span class="seg-tc-chip" style="color:var(--wn)">✓ Col</span>` : '',
  ].filter(Boolean).join('');

  // ── Etiquetas header ─────────────────────────────────────────────────
  const labelHtml = isGeneral
    ? '<span class="seg-tc-label-general">📋 General</span>'
    : `<span class="seg-tc-label-tanda">🧪 ${esc(formulaNombre)}</span>`;
  const tagsHtml = [
    isExp      ? `<span class="seg-tc-tag seg-tc-tag-exp">🔬 ${esc(frascoLabel)}</span>` : '',
    geneticaLabel ? `<span class="seg-tc-tag seg-tc-tag-gen">🧬 ${esc(geneticaLabel)}</span>` : '',
  ].filter(Boolean).join('');

  // ── Timeline de notas ─────────────────────────────────────────────────
  const timelineHtml = notasGrupo.length
    ? notasGrupo.map(({ nota, globalIdx }) =>
        _segRenderNotaTimeline(nota, globalIdx, frmId, isEdit)
      ).join('')
    : '<div class="seg-tc-no-notas">Sin notas registradas — usá el formulario para agregar una.</div>';

  // ── Form de nota manual scoped a esta card ────────────────────────────
  const formHtml = _segRenderTandaCardForm(frmId, tandaId, safeTid);

  return `
<div class="seg-tanda-card${isExp ? ' seg-tc-exp' : ''}${isGeneral ? ' seg-tc-general' : ''}"
     id="seg-tc-${frmId}-${safeTid}"
     style="border-left-color:${borderColor}">

  <div class="seg-tc-header" onclick="segToggleTandaCard('${esc(frmId)}','${esc(tandaId)}')">
    <div class="seg-tc-header-left">
      ${labelHtml}
      ${tagsHtml}
    </div>
    <div class="seg-tc-chips">${chipsHtml}</div>
    <div class="seg-tc-header-right">
      <span class="seg-tc-count">${notasGrupo.length} nota${notasGrupo.length !== 1 ? 's' : ''}</span>
      <span class="seg-tc-chev${isOpen ? ' open' : ''}" id="${chevId}">▼</span>
    </div>
  </div>

  <div class="seg-tc-body${isOpen ? ' open' : ''}" id="${bodyId}">
    <div class="seg-tc-timeline">
      ${timelineHtml}
    </div>
    ${formHtml}
  </div>
</div>`;
}

/**
 * Genera una entrada de timeline para una nota individual.
 * Preserva el globalIdx del array plano para edición/eliminación.
 */
function _segRenderNotaTimeline(nota, globalIdx, frmId, isEdit) {
  const estadoMap = {
    green:  { dot: '#70AD47', emoji: '🟢', cls: 'estado-green'  },
    yellow: { dot: '#FFC000', emoji: '🟡', cls: 'estado-yellow' },
    red:    { dot: '#C00000', emoji: '🔴', cls: 'estado-red'    },
    none:   { dot: 'var(--tx3)', emoji: '⚪', cls: 'estado-none' },
  };
  const est = estadoMap[nota.estado] || estadoMap.none;
  const autoTag = nota.auto
    ? '<span class="seg-nota-auto-tag">AUTO</span>'
    : '<span class="seg-nota-manual-tag">MANUAL</span>';

  const imgs_clean = (nota.imagenes || []).filter(Boolean);
  const imagenesHtml = imgs_clean.length
    ? `<div class="seg-nota-imgs">${imgs_clean.map((img, ii) =>
        `<div class="seg-nota-img-wrap">
          <img src="${img.data}" alt="" onclick="segVerImagenNota('${esc(frmId)}',${globalIdx},${ii})">
          ${isEdit ? `<button class="seg-nota-img-del" onclick="segEliminarImagenNota('${esc(frmId)}',${globalIdx},${ii})">✕</button>` : ''}
        </div>`).join('')}</div>`
    : '';

  const accionesHtml = isEdit
    ? `<div class="seg-nota-acciones">
        <button class="seg-nota-btn-edit" onclick="segEditarNota(${globalIdx},'${esc(frmId)}')" title="Editar">✏️</button>
        <button class="seg-nota-btn-del"  onclick="segEliminarSeguimientoNota(${globalIdx},'${esc(frmId)}')" title="Eliminar">✕</button>
       </div>`
    : `<button class="seg-nota-btn-del solo" onclick="segEliminarSeguimientoNota(${globalIdx},'${esc(frmId)}')" title="Eliminar">✕</button>`;

  return `
<div class="seg-nota-item ${est.cls}">
  <div class="seg-nota-dot" style="background:${est.dot}"></div>
  <div class="seg-nota-content">
    <div class="seg-nota-meta">${segEscapeHtml(nota.ts)} · ${est.emoji} ${autoTag}</div>
    <div class="seg-nota-txt" id="seg-nota-texto-${globalIdx}">${segEscapeHtml(nota.texto)}</div>
    ${imagenesHtml}
  </div>
  ${accionesHtml}
</div>`;
}

/**
 * Genera el formulario de nota manual interno de una card de tanda.
 */
function _segRenderTandaCardForm(frmId, tandaId, safeTid) {
  const ph = tandaId === '__general__'
    ? 'Nota general de seguimiento CI…'
    : `Nota para ${tandaId}…`;
  return `
<div class="seg-tc-form">
  <div class="seg-tc-form-top">
    <select id="segTC-estado-${frmId}-${safeTid}" class="seg-tc-estado-sel">
      <option value="none">⚪ Normal</option>
      <option value="green">🟢 Positivo</option>
      <option value="yellow">🟡 Atención</option>
      <option value="red">🔴 Peligro</option>
    </select>
    <label class="seg-tc-img-btn" title="Adjuntar imagen">
      📷
      <input type="file" accept="image/*" multiple style="display:none"
             id="segTC-img-${frmId}-${safeTid}"
             onchange="segTC_onImgSelect('${esc(frmId)}','${esc(tandaId)}',this)">
    </label>
  </div>
  <div id="segTC-imgprev-${frmId}-${safeTid}" class="seg-tc-img-preview"></div>
  <div class="seg-tc-form-row">
    <textarea id="segTC-nota-${frmId}-${safeTid}"
              class="seg-tc-textarea"
              rows="2"
              placeholder="${esc(ph)}"></textarea>
    <button type="button" class="seg-tc-add-btn"
            onclick="segAddNotaCard('${esc(frmId)}','${esc(tandaId)}')">+ Agregar</button>
  </div>
</div>`;
}

/**
 * Toggle expand/colapsar una card de tanda.
 */
function segToggleTandaCard(frmId, tandaId) {
  if (!SEG.cardState)        SEG.cardState = {};
  if (!SEG.cardState[frmId]) SEG.cardState[frmId] = {};
  const safeTid = _segSafeTandaId(tandaId);
  const bodyEl  = document.getElementById('seg-tcb-'    + frmId + '-' + safeTid);
  const chevEl  = document.getElementById('seg-tcchev-' + frmId + '-' + safeTid);
  if (!bodyEl) return;
  const willOpen = !bodyEl.classList.contains('open');
  bodyEl.classList.toggle('open', willOpen);
  SEG.cardState[frmId][tandaId] = willOpen;
  if (chevEl) chevEl.classList.toggle('open', willOpen);
}

/**
 * Agrega una nota manual a una card de tanda específica.
 * Keyed por frmId + '::' + tandaId en SEG.imagenesTemp para no colisionar con
 * el imagenesTemp legacy de frmId (que era del form global ya eliminado).
 */
function segAddNotaCard(frmId, tandaId) {
  const safeTid   = _segSafeTandaId(tandaId);
  const input     = document.getElementById('segTC-nota-'   + frmId + '-' + safeTid);
  const estadoSel = document.getElementById('segTC-estado-' + frmId + '-' + safeTid);
  const preview   = document.getElementById('segTC-imgprev-'+ frmId + '-' + safeTid);
  const fileInput = document.getElementById('segTC-img-'    + frmId + '-' + safeTid);
  if (!input) return;
  const texto = (input.value || '').trim();
  if (!texto) { input.focus(); return; }

  if (!SEG.seguimientoNotas)         SEG.seguimientoNotas = {};
  if (!SEG.seguimientoNotas[frmId])  SEG.seguimientoNotas[frmId] = [];
  if (!SEG.imagenesTemp)             SEG.imagenesTemp = {};

  const tcKey  = frmId + '::' + tandaId;
  const imagenes = (SEG.imagenesTemp[tcKey] || []).filter(Boolean);

  SEG.seguimientoNotas[frmId].push({
    ts:      segTimestamp(),
    texto,
    estado:  estadoSel ? estadoSel.value : 'none',
    auto:    false,
    imagenes,
    tandaId: tandaId === '__general__' ? null : tandaId,
  });

  // Limpiar form
  input.value = '';
  if (estadoSel)  estadoSel.value = 'none';
  if (preview)    preview.innerHTML = '';
  if (fileInput)  fileInput.value   = '';
  SEG.imagenesTemp[tcKey] = [];

  segRenderSeguimientoNotas(frmId);
  segPersistirNotas();
}

/**
 * Maneja selección de imágenes en el form de una card de tanda.
 * Usa clave frmId::tandaId para no colisionar con imagenesTemp legacy.
 */
function segTC_onImgSelect(frmId, tandaId, input) {
  const tcKey   = frmId + '::' + tandaId;
  const safeTid = _segSafeTandaId(tandaId);
  const preview = document.getElementById('segTC-imgprev-' + frmId + '-' + safeTid);
  const files = Array.from(input.files || []);
  if (!files.length) return;
  if (!SEG.imagenesTemp)         SEG.imagenesTemp = {};
  if (!SEG.imagenesTemp[tcKey])  SEG.imagenesTemp[tcKey] = [];
  files.forEach(function (file) {
    const reader = new FileReader();
    reader.onload = function (e) {
      const dataUrl = e.target.result;
      const idx = SEG.imagenesTemp[tcKey].length;
      SEG.imagenesTemp[tcKey].push({ data: dataUrl, name: file.name });
      if (preview) {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'position:relative;display:inline-block';
        const imgEl = document.createElement('img');
        imgEl.src = dataUrl;
        imgEl.style.cssText = 'max-width:80px;max-height:60px;border-radius:4px;border:1px solid var(--border)';
        const btn = document.createElement('button');
        btn.textContent = '✕';
        btn.style.cssText = 'position:absolute;top:2px;right:2px;background:rgba(0,0,0,0.7);color:#fff;border:none;border-radius:50%;width:16px;height:16px;cursor:pointer;font-size:10px;line-height:16px;text-align:center';
        btn.onclick = (function (f, t, i, w) { return function () { segTC_quitarImg(f, t, i, w); }; })(frmId, tandaId, idx, wrapper);
        wrapper.appendChild(imgEl);
        wrapper.appendChild(btn);
        preview.appendChild(wrapper);
      }
    };
    reader.readAsDataURL(file);
  });
  input.value = '';
}

function segTC_quitarImg(frmId, tandaId, idx, el) {
  const tcKey = frmId + '::' + tandaId;
  if (SEG.imagenesTemp && SEG.imagenesTemp[tcKey]) {
    SEG.imagenesTemp[tcKey][idx] = null;
  }
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

function segEditarNota(index, frmId) {
  const notaEl = document.getElementById('seg-nota-texto-' + index); if (!notaEl) return;
  const currentText = notaEl.textContent || '';
  const input = document.createElement('input');
  input.type = 'text'; input.value = currentText;
  input.style.cssText = 'width:100%;background:var(--bg-tertiary);border:1px solid #00CC33;color:var(--tx);padding:6px 10px;border-radius:6px;font-size:.92rem;box-sizing:border-box';
  input.onblur = () => segGuardarEdicionNota(index, frmId, input.value);
  input.onkeypress = e => { if (e.key === 'Enter') segGuardarEdicionNota(index, frmId, input.value); };
  notaEl.innerHTML = ''; notaEl.appendChild(input); input.focus();
}

function segGuardarEdicionNota(index, frmId, newText) {
  if (!SEG.seguimientoNotas?.[frmId]?.[index]) return;
  SEG.seguimientoNotas[frmId][index].texto = newText.trim();
  SEG.seguimientoNotas[frmId][index].ts += ' (editado)';
  segRenderSeguimientoNotas(frmId);
  segPersistirNotas();
}

/**
 * Refresca el timeline de TODOS los drawers ya renderizados de un frmId dado.
 * Necesario cuando una nota se elimina fuera del flujo de segAddNotaDrawer.
 * Reutiliza los mismos IDs y lógica de filtrado que _segRenderDrawerContent.
 */
function _segRefreshDrawersPorFormula(frmId) {
  const allNotas = SEG.seguimientoNotas[frmId] || [];
  document.querySelectorAll('tr.seg-note-drawer').forEach(function(drawerTr) {
    const container = drawerTr.querySelector('.seg-drawer-inner');
    if (!container || !container.dataset.rendered) return;
    if (!container.id.startsWith('seg-drawer-' + frmId + '-')) return;

    const rowId       = drawerTr.dataset.rowId || '';
    const safeRowId   = String(rowId).replace(/[^a-zA-Z0-9_\-]/g, '_');
    const dataTr      = drawerTr.previousElementSibling;
    const tandaId     = dataTr?.querySelector('.seg-tanda')?.value?.trim() || '';
    const target      = tandaId || '__general__';

    const notasDeTanda = allNotas
      .map(function(n, i) { return Object.assign({}, n, { globalIdx: i }); })
      .filter(function(n) { return _segResolveTandaId(n) === target; });

    const timelineEl = document.getElementById('seg-dw-timeline-' + safeRowId);
    if (timelineEl) {
      timelineEl.innerHTML = notasDeTanda.length
        ? notasDeTanda.map(function(n) { return _segRenderNotaTimeline(n, n.globalIdx, frmId, false); }).join('')
        : '<div class="seg-drawer-empty">Sin notas para esta tanda todavía.</div>';
    }
    const countEl = container.querySelector('.seg-drawer-nota-count');
    if (countEl) countEl.textContent = notasDeTanda.length + ' nota' + (notasDeTanda.length !== 1 ? 's' : '');
  });
}

function segEliminarSeguimientoNota(index, frmId) {
  if (SEG.seguimientoNotas?.[frmId]?.length > index) {
    SEG.seguimientoNotas[frmId].splice(index, 1);
    _segRefreshDrawersPorFormula(frmId);   // refresca drawers abiertos
    segRenderSeguimientoNotas(frmId);      // refresca panel de cards
    segPersistirNotas();
  }
}

/**
 * Persiste SEG.seguimientoNotas a localStorage usando MERGE con lo que ya está
 * en storage, no un replace total. Esto previene que notas de fórmulas no cargadas
 * en memoria sean borradas silenciosamente al guardar.
 */
function segPersistirNotas() {
  try {
    const enStorage = JSON.parse(localStorage.getItem('bl2_seg_notas') || '{}') || {};
    // Merge preservando notas escritas desde CILAB u otros módulos que no están en memoria.
    // Object.assign reemplazaría arrays enteros; acá se hace union por clave ts||texto.
    const merged = Object.assign({}, enStorage);
    Object.keys(SEG.seguimientoNotas).forEach(function(fId) {
      const storArr = enStorage[fId] || [];
      const memArr  = SEG.seguimientoNotas[fId] || [];
      const memManualKeys = new Set();
      const memAutoKeys  = new Set();
      memArr.forEach(function(n) {
        if (n.auto && n._eventType) memAutoKeys.add(n._eventType + ':' + (n.tandaId || '__general__'));
        else memManualKeys.add(n.ts + '||' + n.texto);
      });
      const soloEnStorage = storArr.filter(function(n) {
        if (n.auto && n._eventType) return !memAutoKeys.has(n._eventType + ':' + (n.tandaId || '__general__'));
        return !memManualKeys.has(n.ts + '||' + n.texto);
      });
      merged[fId] = soloEnStorage.concat(memArr);
    });
    localStorage.setItem('bl2_seg_notas', JSON.stringify(merged));
    SEG.seguimientoNotas = merged;
  } catch (e) {
    console.warn('[CI] segPersistirNotas: error al persistir notas:', e);
  }
}

function segOnImgSelect(frmId, input) {
  const files = Array.from(input.files || []);
  if (!files.length) return;
  if (!SEG.imagenesTemp) SEG.imagenesTemp = {};
  if (!SEG.imagenesTemp[frmId]) SEG.imagenesTemp[frmId] = [];
  const preview = document.getElementById('segImgPreview-' + frmId);
  files.forEach(function(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
      const dataUrl = e.target.result;
      const idx = SEG.imagenesTemp[frmId].length;
      SEG.imagenesTemp[frmId].push({ data: dataUrl, name: file.name });
      if (preview) {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'position:relative;display:inline-block';
        const btn = document.createElement('button');
        btn.textContent = '✕';
        btn.style.cssText = 'position:absolute;top:2px;right:2px;background:rgba(0,0,0,0.7);color:#fff;border:none;border-radius:50%;width:16px;height:16px;cursor:pointer;font-size:10px;line-height:16px;text-align:center';
        btn.onclick = (function(f, i) { return function() { segQuitarImgTemp(f, i, wrapper); }; })(frmId, idx);
        const imgEl = document.createElement('img');
        imgEl.src = dataUrl;
        imgEl.style.cssText = 'max-width:80px;max-height:60px;border-radius:4px;border:1px solid var(--border)';
        wrapper.appendChild(imgEl);
        wrapper.appendChild(btn);
        preview.appendChild(wrapper);
      }
    };
    reader.readAsDataURL(file);
  });
  input.value = '';
}

function segQuitarImgTemp(frmId, idx, el) {
  if (SEG.imagenesTemp && SEG.imagenesTemp[frmId]) {
    SEG.imagenesTemp[frmId][idx] = null; // marcar como eliminada sin reindexar
  }
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

function segEliminarImagenNota(frmId, notaIdx, imgIdx) {
  if (!SEG.seguimientoNotas?.[frmId]?.[notaIdx]) return;
  const nota = SEG.seguimientoNotas[frmId][notaIdx];
  if (nota.imagenes && nota.imagenes.length > imgIdx) {
    nota.imagenes.splice(imgIdx, 1);
    segRenderSeguimientoNotas(frmId);
    segPersistirNotas();
  }
}

function segVerImagenNota(frmId, notaIdx, imgIdx) {
  const nota = SEG.seguimientoNotas?.[frmId]?.[notaIdx];
  if (!nota || !nota.imagenes?.[imgIdx]) return;
  const img = nota.imagenes[imgIdx];
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out';
  overlay.innerHTML = '<img src="' + img.data + '" style="max-width:90vw;max-height:90vh;border-radius:8px;box-shadow:0 4px 32px rgba(0,0,0,0.8)">';
  overlay.onclick = function() { document.body.removeChild(overlay); };
  document.body.appendChild(overlay);
}

function segCargarNotas() {
  try {
    const n = JSON.parse(localStorage.getItem('bl2_seg_notas'));
    if (!n) return;
    // Migración: añadir _eventType a auto-notas existentes y purgar duplicados por tipo+tanda
    Object.keys(n).forEach(fId => {
      const arr = n[fId];
      if (!Array.isArray(arr)) return;
      // Paso 1: añadir _eventType a las que no lo tienen
      arr.forEach(nota => {
        if (nota.auto && !nota._eventType) {
          nota._eventType = nota.texto.split(' — ')[0];
        }
      });
      // Paso 2: dedup — conservar solo la primera ocurrencia (más reciente, están en orden unshift)
      const seen = new Set();
      for (let i = 0; i < arr.length; i++) {
        const nota = arr[i];
        if (!nota.auto || !nota._eventType) continue;
        const key = nota._eventType + ':' + (nota.tandaId || '__general__');
        if (seen.has(key)) { arr.splice(i, 1); i--; }
        else seen.add(key);
      }
    });
    SEG.seguimientoNotas = n;
    // Escribir estado migrado/limpio a localStorage inmediatamente
    try { localStorage.setItem('bl2_seg_notas', JSON.stringify(n)); } catch {}
  } catch {}
}

// ════════════════════════════════════════════
// INGREDIENTES — Vista read-only (CI consume, CILAB edita)
// CILAB es el dueño: crear/editar/borrar sólo desde allá.
// ════════════════════════════════════════════
function renderCfg() {
  const ings   = getIngredientes();
  const q      = (document.getElementById('ci-ings-search')?.value || '').trim().toLowerCase();
  const fAsp   = document.getElementById('ci-ings-filter-asp')?.value || '';
  const fBio   = document.getElementById('ci-ings-filter-bio')?.value || '';

  const filtered = ings.filter(i => {
    if (fAsp && i.aspecto !== fAsp) return false;
    if (fBio && (i.bio?.estado || 'sin_datos') !== fBio) return false;
    if (q && !i.nombre.toLowerCase().includes(q) && !(i.id || '').toLowerCase().includes(q)) return false;
    return true;
  });

  const cntEl = document.getElementById('ci-ings-count');
  if (cntEl) cntEl.textContent = `${filtered.length} de ${ings.length} ingrediente${ings.length !== 1 ? 's' : ''}`;

  const grid = document.getElementById('ci-ings-grid');
  if (!grid) return;

  if (!filtered.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:32px;color:var(--tx3);font-size:13px">
      ${ings.length ? 'Sin resultados para los filtros actuales.' : 'No hay ingredientes. Creá el primero en CILAB.'}
    </div>`;
    return;
  }

  const BIO_COLOR = { validado:'var(--ac)', en_ensayo:'var(--wn)', peligro:'var(--er)', sin_datos:'var(--tx3)' };
  const BIO_LABEL = { validado:'Validado', en_ensayo:'En ensayo', peligro:'Peligro', sin_datos:'Sin datos' };

  grid.innerHTML = filtered.map(i => {
    const bio    = i.bio || {};
    const estado = bio.estado || 'sin_datos';
    const col    = BIO_COLOR[estado] || 'var(--tx3)';
    const aspCol = ASP_COLORS[i.aspecto] || '#888';
    const optTxt = bio.rangoOptimo ? `${bio.rangoOptimo.min}–${bio.rangoOptimo.max} ${i.unidad || ''}` : null;
    const segTxt = bio.rangoSeguro ? `seg: ${bio.rangoSeguro.min}–${bio.rangoSeguro.max}` : null;
    const critTxt = bio.alertaCritica ? `⚠ crítico >${bio.alertaCritica.min}` : null;
    const rutasTxt = Array.isArray(bio.rutas) && bio.rutas.length
      ? bio.rutas.map(r => `<span style="background:rgba(255,255,255,.06);border:1px solid var(--border);border-radius:3px;padding:1px 5px;font-size:10px;color:var(--tx2);font-family:'JetBrains Mono',monospace">${esc(r)}</span>`).join(' ')
      : '';
    const mechTxt = bio.mecanismo ? bio.mecanismo.slice(0, 90) + (bio.mecanismo.length > 90 ? '…' : '') : '';
    const alertasCnt = (bio.alertas || []).length;

    return `
    <div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;padding:14px;display:flex;flex-direction:column;gap:8px;transition:border-color .15s"
         onmouseover="this.style.borderColor='${aspCol}'" onmouseout="this.style.borderColor='var(--border)'">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--tx);line-height:1.3">${esc(i.nombre)}</div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--tx3);margin-top:2px">${esc(i.id)}</div>
        </div>
        <span style="flex-shrink:0;font-size:10px;font-family:'JetBrains Mono',monospace;color:${col};border:1px solid ${col}44;border-radius:4px;padding:2px 7px;background:${col}11">
          ${esc(BIO_LABEL[estado] || estado)}
        </span>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <span style="color:${aspCol};font-size:11px;border:1px solid ${aspCol}44;border-radius:4px;padding:1px 7px;background:${aspCol}11">${esc(i.aspecto || '—')}</span>
        <span style="color:var(--tx3);font-size:11px">${esc(i.unidad || '—')}</span>
        ${i.pc > 0 ? `<span style="color:var(--wn);font-size:11px">%C: ${i.pc}</span>` : ''}
        ${i.pn > 0 ? `<span style="color:var(--ac2);font-size:11px">%N: ${i.pn}</span>` : ''}
      </div>
      ${optTxt ? `<div style="font-size:11px;color:var(--ac);font-family:'JetBrains Mono',monospace">🎯 ${esc(optTxt)}${segTxt ? ` · <span style="color:var(--tx3)">${esc(segTxt)}</span>` : ''}</div>` : ''}
      ${critTxt ? `<div style="font-size:11px;color:var(--er);font-family:'JetBrains Mono',monospace">${esc(critTxt)}</div>` : ''}
      ${rutasTxt ? `<div style="display:flex;flex-wrap:wrap;gap:4px">${rutasTxt}</div>` : ''}
      ${mechTxt ? `<div style="font-size:11px;color:var(--tx2);font-style:italic;line-height:1.4">${esc(mechTxt)}</div>` : ''}
      ${alertasCnt ? `<div style="font-size:11px;color:var(--wn)">⚠ ${alertasCnt} alerta${alertasCnt !== 1 ? 's' : ''}</div>` : ''}
      <div style="display:flex;gap:6px;margin-top:4px;padding-top:8px;border-top:1px solid var(--border)">
        <button onclick="ciIrACilabEditar('${esc(i.id)}')" title="Editar en CILAB"
          style="flex:1;background:transparent;border:1px solid var(--border);color:var(--tx2);border-radius:5px;padding:5px 8px;cursor:pointer;font-size:11px;transition:all .15s"
          onmouseover="this.style.borderColor='var(--ac)';this.style.color='var(--ac)'"
          onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--tx2)'">
          ✎ Editar en CILAB
        </button>
      </div>
    </div>`;
  }).join('');
}

/** Navega a CILAB y abre el detalle del ingrediente en Biblioteca. */
function ciIrACilabEditar(ingId) {
  ciIrACilab();
  setTimeout(() => {
    if (typeof window.clabSubTab === 'function') window.clabSubTab('biblioteca');
    if (typeof window.clabOpenIngDetail === 'function') window.clabOpenIngDetail(ingId);
  }, 400);
}



// ════════════════════════════════════════════
// MIGRACIÓN — Snapshots de ingredientes
// ════════════════════════════════════════════

/**
 * Recorre todas las fórmulas y agrega el campo `snapshot` a cada
 * ingrediente que aún no lo tenga, tomando el estado actual de la
 * biblioteca.
 *
 * Es idempotente: puede correrse N veces sin duplicar datos.
 * Devuelve { formulasAfectadas, ingredientesActualizados }.
 *
 * Flujo recomendado:
 *   1. Exportar JSON backup (estado previo).
 *   2. Correr esta función (botón en Config o consola).
 *   3. Exportar JSON backup (estado migrado).
 *   4. Guardar ese backup como copia canónica.
 */
function ciMigrarSnapshotsIngredientes() {
  const forms   = gDB(K.forms);
  const allIngs = gDB(K.ings);
  let totalRows = 0;
  const frmsTocadas = new Set();

  forms.forEach(f => {
    if (!Array.isArray(f.ingredientes)) return;
    f.ingredientes.forEach(r => {
      if (r.snapshot) return; // ya migrado
      const snap = _ingSnapshot(r.id, allIngs);
      if (snap) {
        r.snapshot = snap;
        totalRows++;
        frmsTocadas.add(f.id);
      }
    });
  });

  if (totalRows > 0) {
    sDB(K.forms, forms);
    sN(`✅ Migración completa — ${totalRows} fila(s) en ${frmsTocadas.size} fórmula(s) actualizadas`);
  } else {
    sN('✅ Nada que migrar — todas las filas ya tienen snapshot');
  }

  return { formulasAfectadas: frmsTocadas.size, ingredientesActualizados: totalRows };
}

function ciMigrarBioIngredientes() {
  const legacy = gOb(K.labMeta, {});
  const legacyIds = Object.keys(legacy || {});
  if (!legacyIds.length) {
    sN('No hay metadata legacy bl2_lab_meta para migrar');
    return { migrados: 0, legacyIds: 0 };
  }
  const ings = getIngredientes();
  let migrados = 0;
  ings.forEach(ing => {
    const oldBio = legacy[ing.id];
    if (!oldBio || typeof oldBio !== 'object' || Array.isArray(oldBio)) return;
    const current = ing.bio && typeof ing.bio === 'object' && !Array.isArray(ing.bio) ? ing.bio : {};
    ing.bio = Object.assign({}, oldBio, current, {
      migratedFromLegacyAt: current.migratedFromLegacyAt || now(),
    });
    migrados++;
  });
  sDB(K.ings, ings);
  ciDispatchIngsChanged('bio-migrado', null, { count: migrados });
  renderCfg();
  sN(`Metadata bio migrada: ${migrados} ingrediente(s)`);
  return { migrados, legacyIds: legacyIds.length };
}

// ════════════════════════════════════════════
// EXPORT / IMPORT
// ════════════════════════════════════════════
function ciExportExcel() {
  const forms = gDB(K.forms);
  const ings  = gDB(K.ings);
  let text = 'BIOLAB CI — Exportar para Excel\n\n';
  forms.forEach(f => {
    text += `FÓRMULA: ${f.nombre} (${f.id}) — ${f.version || 'v1'} — ${ciFormatDate(f.fecha)}\n`;
    text += 'Ingrediente\tAspecto\tUnidad\tCantidad\t%C\t%N\tC\tN\n';
    const ingsSorted = [...f.ingredientes].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
    ingsSorted.forEach(r => {
      const live = ings.find(x => x.id === r.id);
      const i = r.snapshot ? { id: r.id, ...r.snapshot } : live;
      if (!i) return;
      const qty = r.qty ?? r.cant ?? 0;
      let aC = 0, aN = 0;
      if (i.pc > 0) aC = qty * i.pc / 100; else if (i.aspecto === 'Carbono') aC = qty;
      if (i.pn > 0) aN = qty * i.pn / 100; else if (i.aspecto === 'Nitrógeno') aN = qty;
      text += `${i.nombre}\t${i.aspecto}\t${i.unidad}\t${qty}\t${i.pc || 0}\t${i.pn || 0}\t${aC.toFixed(2)}\t${aN.toFixed(2)}\n`;
    });
    text += '\n';
  });
  // Copy to clipboard
  navigator.clipboard.writeText(text).then(() => sN('Copiado al portapapeles (pegá en Excel)')).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
    sN('Copiado');
  });
}

function exportData() {
  // 1) Merge seguro: combinar lo que hay en storage con lo que está en memoria.
  //    Nunca reemplazar storage con SEG si SEG está incompleto (race condition al montar módulo).
  //    Garantiza que el backup siempre tenga el conjunto MÁXIMO de notas disponibles.
  let notasParaBackup = {};
  try {
    const enStorage = JSON.parse(localStorage.getItem('bl2_seg_notas') || '{}') || {};
    notasParaBackup = Object.assign({}, enStorage, SEG.seguimientoNotas || {});
    // Actualizar storage y memoria con el merge completo
    localStorage.setItem('bl2_seg_notas', JSON.stringify(notasParaBackup));
    SEG.seguimientoNotas = notasParaBackup;
  } catch (e) {
    console.warn('[CI] exportData: error al mergear notas, usando storage raw:', e);
    try { notasParaBackup = JSON.parse(localStorage.getItem('bl2_seg_notas') || '{}') || {}; } catch {}
  }

  // 2) Recopilar todas las keys bl2_seg_rowimgs_* (imágenes por fórmula)
  const rowImgs = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('bl2_seg_rowimgs_')) {
        try { rowImgs[k] = JSON.parse(localStorage.getItem(k)); } catch (e) {}
      }
    }
  } catch (e) {}

  // 3) Construir backup completo con TODAS las keys del módulo CI
  const data = {
    forms:     gDB(K.forms),
    ings:      gDB(K.ings),
    seg:       gDB(K.seg),
    cultivos:  gDB(K.cultivos),
    exp:       gDB(K.exp),               // Experimentos (comparativas por frasco)
    lab_meta:  gOb(K.labMeta, {}),        // Compatibilidad legacy CILAB (deprecated)
    seg_notas: notasParaBackup,
    row_imgs:  rowImgs,
    crec:      JSON.parse(localStorage.getItem('bl2_crec') || '[]'), // Ensayos de Conocimiento CILAB
    ts: now()
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `biolab-ci-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  sN('Backup exportado');
}

/** Exporta una sola fórmula con TODA su información relacionada (Análisis, SEG, Experimentos, Cultivos). */
function exportFormulaJSON(frmId) {
  const forms = gDB(K.forms);
  const f = forms.find(x => x.id === frmId);
  if (!f) return sN('Fórmula no encontrada', 'err');

  const allIngs = gDB(K.ings);
  const ingsSorted = [...f.ingredientes].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  const { c, n, masa, rows } = calcCN(ingsSorted, allIngs);

  // Distribución por aspecto
  const aspectDistribution = {};
  rows.forEach(({ i, qty }) => {
    aspectDistribution[i.aspecto] = (aspectDistribution[i.aspecto] || 0) + qty;
  });

  // Recopilar datos relacionados
  const seguimientoNotas = SEG.seguimientoNotas?.[frmId] || [];
  const campoDeTrabajo   = gDB(K.seg).filter(s => s.formula_id === frmId);
  const experimentos     = gDB(K.exp).filter(e => e.formulaId === frmId);
  const cultivos         = (typeof _ciCultivosLoad === 'function' ? _ciCultivosLoad() : []).filter(c => c.medioFormulaId === frmId);

  const data = {
    type: "biolab-formula-full-export",
    version: "1.2",
    exportedAt: now(),
    formula: f,
    analysis: {
      cnRatio: n > 0 ? parseFloat((c / n).toFixed(2)) : null,
      totalMass: parseFloat(masa.toFixed(2)),
      totalCarbon: parseFloat(c.toFixed(2)),
      totalNitrogen: parseFloat(n.toFixed(2)),
      aspectDistribution
    },
    seguimiento: seguimientoNotas,
    campoDeTrabajo: campoDeTrabajo,
    experimentos: experimentos,
    cultivosPromovidos: cultivos,
    metadata: {
      createdBy: "Biolab Engine v3",
      parentFormulaId: f.parentFormulaId || null,
      archivada: !!f.archivada,
      version: f.version || "v1"
    }
  };

  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const safeName = f.nombre.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const filename = `biolab-formula-CI-${f.id}-${safeName}-full.json`;

  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();

  sN('Export FULL generado: ' + f.id);
  console.log(`[BIOLAB] Export completo de ${f.id} generado exitosamente.`, data);
}

function importData(event) {
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);

      // ── AUDITORÍA DE PÉRDIDA DE DATOS ANTES DE IMPORTAR ─────────────────
      // Detectar fórmulas que tienen datos de seguimiento actuales pero
      // que el backup NO contiene — estas se perderían silenciosamente.
      const segActual    = gDB(K.seg);
      const notasActual  = (() => { try { return JSON.parse(localStorage.getItem('bl2_seg_notas') || '{}'); } catch { return {}; } })();
      const filasEnBackup   = Array.isArray(data.seg)       ? data.seg       : [];
      const notasEnBackup   = (data.seg_notas && typeof data.seg_notas === 'object') ? data.seg_notas : {};

      const formulasConFilasActuales  = [...new Set(segActual.map(s => s.formula_id))];
      const formulasConNotasActuales  = Object.keys(notasActual).filter(k => (notasActual[k] || []).length > 0);
      const formulasConDatosActuales  = [...new Set([...formulasConFilasActuales, ...formulasConNotasActuales])];

      const perdidas = formulasConDatosActuales.filter(frmId => {
        const perdeFilas  = segActual.filter(s => s.formula_id === frmId).length > 0 &&
                            !filasEnBackup.some(s => s.formula_id === frmId);
        const perdeNotas  = (notasActual[frmId] || []).length > 0 &&
                            !(notasEnBackup[frmId] || []).length;
        return perdeFilas || perdeNotas;
      });

      if (perdidas.length > 0) {
        const detalle = perdidas.map(frmId => {
          const nFilas  = segActual.filter(s => s.formula_id === frmId).length;
          const nNotas  = (notasActual[frmId] || []).length;
          return `  • ${frmId}: ${nFilas} fila(s) de campo de trabajo · ${nNotas} nota(s) de seguimiento`;
        }).join('\n');
        const ok = confirm(
          `⚠️  ADVERTENCIA DE PÉRDIDA DE DATOS\n\n` +
          `Este backup NO contiene datos de seguimiento actuales para:\n\n${detalle}\n\n` +
          `Importar BORRARÁ permanentemente esos datos.\n\n` +
          `¿Confirmar importación de todas formas?`
        );
        if (!ok) {
          event.target.value = ''; // resetear input file
          return;
        }
      }
      // ────────────────────────────────────────────────────────────────────

      // Restaurar todas las keys del módulo CI
      if (data.forms)    sDB(K.forms, data.forms);
      if (data.ings)     sDB(K.ings, data.ings);
      if (data.seg)      sDB(K.seg, data.seg);
      if (data.cultivos) sDB(K.cultivos, data.cultivos);
      if (data.exp)      sDB(K.exp, data.exp);            // Experimentos
      if (data.lab_meta && typeof data.lab_meta === 'object') sOb(K.labMeta, data.lab_meta);
      if (data.ings)     ciDispatchIngsChanged('importado', null, { count: data.ings.length || 0 });

      // Notas de seguimiento: merge con notas actuales para preservar datos no incluidos en el backup
      const notasBackup   = (data.seg_notas && typeof data.seg_notas === 'object') ? data.seg_notas : {};
      const notasMerged   = Object.assign({}, notasActual, notasBackup); // backup gana en conflicto
      try { localStorage.setItem('bl2_seg_notas', JSON.stringify(notasMerged)); } catch (err) {}
      SEG.seguimientoNotas = notasMerged;

      // Imágenes por fórmula: restaurar cada key bl2_seg_rowimgs_<id>
      if (data.row_imgs && typeof data.row_imgs === 'object') {
        Object.entries(data.row_imgs).forEach(([k, v]) => {
          if (k.startsWith('bl2_seg_rowimgs_')) {
            try { localStorage.setItem(k, JSON.stringify(v)); } catch (err) {}
          }
        });
      }

      // Ensayos de Conocimiento CILAB (bl2_crec) — restaurar con confirmación si hay conflicto
      if (Array.isArray(data.crec) && data.crec.length > 0) {
        const _crecActual = (() => { try { return JSON.parse(localStorage.getItem('bl2_crec') || '[]') || []; } catch { return []; } })();
        const _doRestore = _crecActual.length === 0 || confirm(
          `⚠️ Este backup contiene ${data.crec.length} ensayo(s) de Conocimiento.\n` +
          `Hay ${_crecActual.length} ensayo(s) actuales que serán reemplazados.\n\n` +
          `¿Restaurar ensayos de Conocimiento desde el backup?`
        );
        if (_doRestore) localStorage.setItem('bl2_crec', JSON.stringify(data.crec));
      }
      sN('Datos importados — recargando...');
      // Recargar para que todos los módulos lean el estado fresco desde localStorage
      setTimeout(() => location.reload(), 1000);
    } catch { sN('Error al importar JSON', true); }
  };
  reader.readAsText(file);
}

function resetSystem() {
  if (!confirm('⚠️ ¿Borrar TODOS los datos del módulo CI?\n\nEsta acción no se puede deshacer.')) return;
  if (!confirm('CONFIRMACIÓN FINAL: ¿Estás seguro?')) return;
  localStorage.removeItem(K.forms);
  localStorage.removeItem(K.ings);
  localStorage.removeItem(K.seg);
  localStorage.removeItem(K.exp);
  localStorage.removeItem(K.cultivos);
  localStorage.removeItem('bl2_seg_notas');
  localStorage.removeItem(COL_ALIGN_KEY);
  Object.keys(localStorage).filter(k => k.startsWith('bl2_seg_rowimgs_')).forEach(k => localStorage.removeItem(k));
  // Ensayos de Conocimiento — preguntar por separado para no perder datos históricos
  const _crecReset = (() => { try { return JSON.parse(localStorage.getItem('bl2_crec') || '[]') || []; } catch { return []; } })();
  if (_crecReset.length > 0) {
    if (confirm(`¿También eliminar los ${_crecReset.length} ensayo(s) de Conocimiento (bl2_crec)?\n\nSi los conservás, quedarán huérfanos si creás fórmulas con los mismos IDs.`)) {
      localStorage.removeItem('bl2_crec');
    }
  }
  SEG.seguimientoNotas = {};
  SEG.modoEdicion      = {};
  SEG.imagenesTemp     = {};
  SEG.rowImagenes      = {};
  SEG.cardState        = {};
  ciDispatchIngsChanged('reset', null);
  ciRenderFormulasList();
  renderCfg();
  sN('Sistema reseteado');
}

// ════════════════════════════════════════════
// HEADER STATS
// ════════════════════════════════════════════
function updateHeader() {
  const forms = gDB(K.forms);
  const segs  = gDB(K.seg);
  const el = document.getElementById('ci-hdr-formulas');
  if (el) el.textContent = forms.length;
  const el2 = document.getElementById('ci-hdr-tandas');
  if (el2) el2.textContent = segs.length;
}

// ════════════════════════════════════════════
// INICIALIZACIÓN
// ════════════════════════════════════════════
let _ciDocClickHandler        = null;
let _ciDocKeyHandler          = null;
let _ciCultivosChangedListener = null;  // [Fase 3b] refresca UI ante creación/descarte/edición
let _ciIngsChangedListener    = null;
let _ciFormulasChangedListener = null;
let _ciStorageListener        = null;

function ciInit() {
  // Reconciliación de stock CI — corre una sola vez para corregir discrepancias históricas
  (function() {
    var FLAG = 'bl2_stock_reconcile_v1';
    try {
      if (!localStorage.getItem(FLAG) && window.CiGrLinks) {
        var result = window.CiGrLinks.reconcileAllStock();
        if (result.ok) {
          localStorage.setItem(FLAG, '1');
          if (result.reconciliados > 0) {
            console.log('[CI] Stock reconciliado:', result.reconciliados, 'cultivos.');
          }
        }
      }
    } catch(e) { console.warn('[CI] reconcile stock falló:', e); }
  })();

  // Cargar/validar/siembrar ingredientes (idempotente).
  // getIngredientes() garantiza shape válido: si está vacío, corrupto o
  // ausente, escribe DEFAULT_INGS en localStorage y devuelve ese array.
  getIngredientes();

  // Cargar notas persistidas
  segCargarNotas();

  // [Fase 1] Inicializar capa de Cultivos CI (idempotente, no rompe datos viejos)
  _ciCultivosInit();
  _ciCultivosAutoArchivar();

  // Render inicial
  ciNewSessionInit();
  ciRenderFormulasList();
  renderCfg();
  updateHeader();

  // Subtab activo por defecto
  ciSubTab('dashboard');

  // Limpiar listeners previos si el módulo se remonta
  if (_ciDocClickHandler)         document.removeEventListener('click',   _ciDocClickHandler);
  if (_ciDocKeyHandler)           document.removeEventListener('keydown', _ciDocKeyHandler);
  if (_ciCultivosChangedListener) window.removeEventListener('ci-cultivos-changed', _ciCultivosChangedListener);
  if (_ciIngsChangedListener)     window.removeEventListener('cilab-ings-changed', _ciIngsChangedListener);
  if (_ciFormulasChangedListener) window.removeEventListener('cilab-formulas-changed', _ciFormulasChangedListener);
  if (_ciStorageListener)         window.removeEventListener('storage', _ciStorageListener);

  // Click fuera del dropdown → cerrar
  _ciDocClickHandler = function (e) {
    const dd = document.getElementById('floatingDropdown');
    if (dd?.classList.contains('open') && !dd.contains(e.target) && !e.target.closest('.frm-ing-cell')) {
      closeFloatingDropdown();
    }
  };
  _ciDocKeyHandler = function (e) {
    if (e.key === 'Escape') closeFloatingDropdown();
  };
  // [Fase 3b] Refrescar UI al cambiar el inventario de cultivos (creación, descarte, edición, cross-tab)
  _ciCultivosChangedListener = function () {
    // Si el subtab Cultivos está visible, repintarlo
    const panel = document.getElementById('ci-sub-cultivos');
    if (panel && panel.style.display !== 'none') renderCultivosTab();
    // Refrescar badges en SEG de todas las tandas visibles
    // (badges de cultivo en filas SEG eliminados — sync es automático al guardar)
  };
  _ciIngsChangedListener = function (e) {
    // IngStore ya propagó el cambio a cada select suscrito.
    // Aquí solo refrescamos vistas que no usan el store.
    renderCfg();
    ciRenderFormulasList();
  };
  _ciFormulasChangedListener = function () {
    ciRenderFormulasList();
    updateHeader();
  };
  _ciStorageListener = function (e) {
    if (e.key === K.ings) { renderCfg(); ciRenderFormulasList(); }
    if (e.key === K.forms) { ciRenderFormulasList(); updateHeader(); }
  };
  document.addEventListener('click', _ciDocClickHandler);
  document.addEventListener('keydown', _ciDocKeyHandler);
  window.addEventListener('ci-cultivos-changed', _ciCultivosChangedListener);
  window.addEventListener('cilab-ings-changed', _ciIngsChangedListener);
  window.addEventListener('cilab-formulas-changed', _ciFormulasChangedListener);
  window.addEventListener('storage', _ciStorageListener);

  _expHoistModal(); // Mover modal de experimento a document.body

  console.log('[CI] Módulo inicializado — BIOLAB ENGINE v3');
}


// ════════════════════════════════════════════
// CULTIVOS CI — capa de inóculos validados
//   Fase 1: capa de datos pura (load/save/init)
//   Fase 2: API pública de lectura (window.CI)
//   Fase 3a: capa de escritura interna (factory + atómicas)
// Las funciones privadas (_ciXxx) no se exponen a window.
// El namespace window.CI sí se expone — ver al final de la sección.
// ════════════════════════════════════════════

const CULTIVO_SCHEMA_VERSION = 1;

// ─── Constantes de validación (Fase 3a) ───
const _CI_TIPOS_VALIDOS    = ['PLACA', 'FRASCO'];
const _CI_ESTADOS_VALIDOS  = ['DISPONIBLE', 'RESERVADO', 'AGOTADO', 'DESCARTADO'];
const _CI_CAMPOS_BLANDOS   = ['notas', 'fechaCaducidad', 'fotoIds', 'metadatos'];

// ─── Persistencia (Fase 1) ───

function _ciCultivosLoad() {
  // Lectura defensiva: nunca lanza. Si está corrupto, devuelve [] sin tocar storage.
  try {
    const parsed = gDB(K.cultivos);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('[CI] bl2_cultivos corrupto en load; devuelve []:', err);
    return [];
  }
}

function _ciCultivosSave(cultivosArray) {
  if (!Array.isArray(cultivosArray)) {
    console.error('[CI] _ciCultivosSave: se requiere array');
    return false;
  }
  try {
    sDB(K.cultivos, cultivosArray);
    return true;
  } catch (err) {
    console.error('[CI] _ciCultivosSave falló (posible cuota localStorage):', err);
    return false;
  }
}

function _ciCultivosInit() {
  // Tres ramas explícitas:
  //   1) key inexistente              → crea []
  //   2) key con array (vacío o no)   → no toca (retrocompat total)
  //   3) key existe pero corrupta     → repara a []
  // Necesita acceso raw a localStorage SOLO aquí para distinguir (1) de (3),
  // porque gDB no diferencia "no existe" de "existe pero parsea mal".
  const raw = localStorage.getItem(K.cultivos);
  if (raw === null) {
    _ciCultivosSave([]);
    return;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.warn('[CI] bl2_cultivos no era array en init; reinicializando a []');
      _ciCultivosSave([]);
    }
    // Array válido: no se modifica nada.
  } catch (err) {
    console.warn('[CI] bl2_cultivos corrupto en init; reinicializando a []:', err);
    _ciCultivosSave([]);
  }
}

// ─── Auto-archivo de cultivos vencidos (>60 días desde creación) ───
function _ciCultivosAutoArchivar() {
  var LIMITE_MS = 60 * 24 * 60 * 60 * 1000;
  var ahora = Date.now();
  var cultivos = _ciCultivosLoad();
  var changed = false;

  cultivos.forEach(function(c) {
    if (!c || c.estado !== 'DISPONIBLE') return;
    var created = c.fechaCreacion ? new Date(c.fechaCreacion).getTime() : 0;
    if (created && (ahora - created) > LIMITE_MS) {
      c.estado = 'CADUCADO';
      c.fechaCaducidad = new Date().toISOString();
      changed = true;
    }
  });

  if (changed) {
    _ciCultivosSave(cultivos);
    _ciDispatchCultivosChanged('caducados', null);
  }
}

// ─── Helper interno (Fase 2) ───

function _ciCloneJSON(value) {
  // Clone defensivo. Asume payload JSON-safe (garantizado por el schema).
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

// ─── API pública de lectura (Fase 2) ───

function ciListCultivosDisponibles(filtros = {}) {
  const f = (filtros && typeof filtros === 'object') ? filtros : {};
  const cultivos = _ciCultivosLoad();
  const matched = cultivos.filter(c => {
    if (!c || c.estado !== 'DISPONIBLE') return false;
    if (typeof c.cantidadDisponible !== 'number' || c.cantidadDisponible <= 0) return false;
    if (f.geneticaId && c.geneticaId !== f.geneticaId) return false;
    if (f.tipo && c.tipo !== f.tipo) return false;
    return true;
  });
  return _ciCloneJSON(matched);
}

function ciGetCultivoById(id) {
  if (typeof id !== 'string' || !id) return null;
  const cultivos = _ciCultivosLoad();
  const found = cultivos.find(c => c && c.id === id);
  return found ? _ciCloneJSON(found) : null;
}

function ciGetCultivosByGenetica(geneticaId) {
  // Devuelve TODOS los estados (DISPONIBLE/RESERVADO/AGOTADO/DESCARTADO).
  // Pensado para vistas de trazabilidad histórica, no para dropdowns de consumo.
  if (typeof geneticaId !== 'string' || !geneticaId) return [];
  const cultivos = _ciCultivosLoad();
  const matched = cultivos.filter(c => c && c.geneticaId === geneticaId);
  return _ciCloneJSON(matched);
}

function ciGetConsumosByCultivo(cultivoId) {
  // Fuente de verdad: bl2_ci_gr_links (CiGrLinks). El campo cultivo.consumos[] es legacy y no se usa.
  if (typeof cultivoId !== 'string' || !cultivoId) return [];
  if (window.CiGrLinks && typeof window.CiGrLinks.getActivosByCultivo === 'function') {
    return window.CiGrLinks.getActivosByCultivo(cultivoId).map(function(l) {
      return {
        refType: 'GR',
        refId: l.grLoteId || '',
        grTanda: l.grTanda || null,
        cantidad: l.cantidad || 0,
        fecha: l.fechaConsumo || '',
        notas: l.grTanda ? ('Tanda: ' + l.grTanda) : '',
      };
    });
  }
  // Fallback a legacy si CiGrLinks no está cargado
  try {
    const raw = localStorage.getItem('bl2_ci_gr_links');
    const links = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(links)) return [];
    return links
      .filter(function(l) { return l && l.estado === 'ACTIVO' && l.cultivoCiId === cultivoId; })
      .map(function(l) {
        return {
          refType: 'GR',
          refId: l.grLoteId || '',
          grTanda: l.grTanda || null,
          cantidad: l.cantidad || 0,
          fecha: l.fechaConsumo || '',
          notas: l.grTanda ? ('Tanda: ' + l.grTanda) : '',
        };
      });
  } catch(e) { return []; }
}

function ciGetSchemaVersion() {
  return CULTIVO_SCHEMA_VERSION;
}

// ─── Generadores de identificadores (Fase 3a) ───

function _ciCultivoIdGenerate() {
  // Formato: cci_<timestamp base36>_<6 hex aleatorios>.
  // Único en la práctica para volúmenes esperados (miles).
  const ts  = Date.now().toString(36);
  const rnd = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
  return `cci_${ts}_${rnd}`;
}

function _ciCultivoCodigoGenerate(cultivosExistentes = []) {
  // Formato humano: CI-YYYY-NNNN. Continúa la numeración del año actual.
  // Los códigos NO se reutilizan tras descarte: la numeración solo crece.
  // Caveat: race cross-tab puede generar dos códigos iguales en escrituras
  // simultáneas. La validación post-factory lo detecta dentro de la misma
  // pestaña; cross-tab queda como limitación documentada de v1.
  const year   = new Date().getFullYear();
  const prefix = `CI-${year}-`;
  let maxN = 0;
  for (const c of cultivosExistentes) {
    if (c && typeof c.codigo === 'string' && c.codigo.startsWith(prefix)) {
      const n = parseInt(c.codigo.slice(prefix.length), 10);
      if (Number.isFinite(n) && n > maxN) maxN = n;
    }
  }
  return prefix + String(maxN + 1).padStart(4, '0');
}

// ─── Validación de input de creación (Fase 3a) ───

function _ciValidarInputCreacion(input) {
  if (!input || typeof input !== 'object')
    return { ok: false, motivo: 'input requerido' };
  if (typeof input.seguimientoId !== 'string' || !input.seguimientoId)
    return { ok: false, motivo: 'seguimientoId requerido' };
  if (typeof input.geneticaId !== 'string' || !input.geneticaId)
    return { ok: false, motivo: 'geneticaId requerido' };
  if (!input.geneticaSnapshot || typeof input.geneticaSnapshot !== 'object')
    return { ok: false, motivo: 'geneticaSnapshot requerido' };
  if (!_CI_TIPOS_VALIDOS.includes(input.tipo))
    return { ok: false, motivo: 'tipo debe ser PLACA o FRASCO' };
  if (!Number.isInteger(input.cantidadInicial) || input.cantidadInicial <= 0)
    return { ok: false, motivo: 'cantidadInicial debe ser entero positivo' };
  return { ok: true };
}

// ─── Factory puro (Fase 3a, no persiste) ───

function _ciCultivoFactory(input, cultivosExistentes) {
  const ahora    = new Date().toISOString();
  const cantidad = input.cantidadInicial;

  const base = {
    _schemaVersion:     CULTIVO_SCHEMA_VERSION,
    id:                 _ciCultivoIdGenerate(),
    codigo:             (typeof input.codigo === 'string' && input.codigo.trim())
                          ? input.codigo.trim()
                          : _ciCultivoCodigoGenerate(cultivosExistentes),
    seguimientoId:      input.seguimientoId,
    geneticaId:         input.geneticaId,
    geneticaSnapshot:   _ciCloneJSON(input.geneticaSnapshot),
    tipo:               input.tipo,
    cantidadInicial:    cantidad,
    cantidadDisponible: cantidad,
    estado:             'DISPONIBLE',
    fechaCreacion:      ahora,
    fechaValidacion:    (typeof input.fechaValidacion === 'string' && input.fechaValidacion)
                          ? input.fechaValidacion
                          : ahora,
    consumos:           [],
  };

  // Campos recomendados — solo si vienen en el input.
  if (typeof input.medioFormulaId === 'string' && input.medioFormulaId)
    base.medioFormulaId = input.medioFormulaId;
  if (Number.isInteger(input.generacion))
    base.generacion = input.generacion;
  if (typeof input.parentCultivoId === 'string' && input.parentCultivoId)
    base.parentCultivoId = input.parentCultivoId;
  if (typeof input.fechaCaducidad === 'string' && input.fechaCaducidad)
    base.fechaCaducidad = input.fechaCaducidad;

  if (typeof input.notas === 'string')
    base.notas = input.notas;
  if (Array.isArray(input.fotoIds))
    base.fotoIds = input.fotoIds.slice();
  if (input.metadatos && typeof input.metadatos === 'object')
    base.metadatos = _ciCloneJSON(input.metadatos);

  // Trazabilidad experimento → frasco (Cambio 1)
  base.experimentoId       = (typeof input.experimentoId === 'string' && input.experimentoId) ? input.experimentoId : null;
  base.experimentoFrascoId = (typeof input.experimentoFrascoId === 'string' && input.experimentoFrascoId) ? input.experimentoFrascoId : null;

  return base;
}

// ─── Operaciones atómicas (Fase 3a — re-leen storage antes de mutar) ───

function _ciCultivoCreate(input) {
  const v = _ciValidarInputCreacion(input);
  if (!v.ok) return v;

  const cultivos = _ciCultivosLoad();
  const nuevo    = _ciCultivoFactory(input, cultivos);

  // Paranoia: detectar colisión de id/código (debería ser imposible dentro de la misma pestaña).
  if (cultivos.some(c => c && (c.id === nuevo.id || c.codigo === nuevo.codigo))) {
    return { ok: false, motivo: 'colisión de id/código' };
  }

  cultivos.push(nuevo);
  if (!_ciCultivosSave(cultivos)) {
    return { ok: false, motivo: 'fallo persistencia (cuota localStorage?)' };
  }

  _ciDispatchCultivosChanged('creado', nuevo.id);
  return { ok: true, cultivo: _ciCloneJSON(nuevo) };
}

// ─── Sync automático de Cultivos desde filas SEG al guardar ───
function _ciSyncCultivosFromSeg(frmId) {
  const segs = gDB(K.seg).filter(function(s) { return s && s.formula_id === frmId; });
  if (!segs.length) return;

  const cultivos = _ciCultivosLoad();
  let changed = false;

  segs.forEach(function(row) {
    const sanas = Math.max(0, (row.placas || 0) - (row.contaminados || 0));
    const geneticaId = row.genetica || '';
    if (!geneticaId) return;
    if (!row.colonizacion) return; // Solo inóculos con colonización completa califican para GR

    const seguimientoId = frmId + '::' + row.rowId;
    const idx = cultivos.findIndex(function(c) { return c && c.seguimientoId === seguimientoId; });

    if (sanas <= 0) {
      if (idx !== -1 && cultivos[idx].estado === 'DISPONIBLE') {
        cultivos[idx].estado = 'AGOTADO';
        changed = true;
      }
      return;
    }

    if (idx === -1) {
      const snapshot = _ciResolverGeneticaSnapshot(geneticaId);
      if (!snapshot) return;
      const nuevo = _ciCultivoFactory({
        seguimientoId: seguimientoId,
        geneticaId: geneticaId,
        geneticaSnapshot: snapshot,
        tipo: 'PLACA',
        cantidadInicial: sanas,
        medioFormulaId: frmId,
        fechaValidacion: row.inoculoTs ? new Date(row.inoculoTs).toISOString() : new Date().toISOString(),
      }, cultivos);
      cultivos.push(nuevo);
      changed = true;
    } else {
      const c = cultivos[idx];
      const sumConsumos = Array.isArray(c.consumos)
        ? c.consumos.reduce(function(a, co) { return a + (co.cantidad || 0); }, 0)
        : 0;
      const newDisp = Math.max(0, sanas - sumConsumos);
      if (c.cantidadInicial !== sanas || c.cantidadDisponible !== newDisp) {
        c.cantidadInicial = sanas;
        c.cantidadDisponible = newDisp;
        if (c.estado !== 'DESCARTADO' && c.estado !== 'CADUCADO') {
          c.estado = newDisp > 0 ? 'DISPONIBLE' : 'AGOTADO';
        }
        changed = true;
      }
    }
  });

  if (changed) {
    _ciCultivosSave(cultivos);
    _ciDispatchCultivosChanged('sync', frmId);
  }
}

function _ciCultivoMarcarDescartado(id, motivo) {
  if (typeof id !== 'string' || !id)
    return { ok: false, motivo: 'id requerido' };

  const cultivos = _ciCultivosLoad();
  const idx = cultivos.findIndex(c => c && c.id === id);
  if (idx === -1) return { ok: false, motivo: 'cultivo no encontrado' };

  const c = cultivos[idx];
  if (c.estado === 'DESCARTADO')
    return { ok: false, motivo: 'ya estaba descartado' };

  c.estado = 'DESCARTADO';
  c.fechaDescarte = new Date().toISOString();
  if (typeof motivo === 'string' && motivo.trim()) {
    c.motivoDescarte = motivo.trim();
  }

  if (!_ciCultivosSave(cultivos)) {
    return { ok: false, motivo: 'fallo persistencia' };
  }

  _ciDispatchCultivosChanged('descartado', id);
  return { ok: true };
}

function _ciCultivoEditarBlandos(id, partial) {
  // Solo permite modificar campos no-críticos (notas, fechaCaducidad, etc.).
  // Cualquier campo crítico en el partial se ignora con warning.
  if (typeof id !== 'string' || !id)
    return { ok: false, motivo: 'id requerido' };
  if (!partial || typeof partial !== 'object')
    return { ok: false, motivo: 'partial requerido' };

  const cultivos = _ciCultivosLoad();
  const idx = cultivos.findIndex(c => c && c.id === id);
  if (idx === -1) return { ok: false, motivo: 'cultivo no encontrado' };

  const c = cultivos[idx];
  let cambios = 0;
  for (const k of Object.keys(partial)) {
    if (_CI_CAMPOS_BLANDOS.includes(k)) {
      c[k] = (k === 'metadatos' || k === 'fotoIds')
              ? _ciCloneJSON(partial[k])
              : partial[k];
      cambios++;
    } else {
      console.warn(`[CI] _ciCultivoEditarBlandos: campo "${k}" no editable, ignorado`);
    }
  }
  if (cambios === 0) return { ok: false, motivo: 'sin cambios aplicables' };

  if (!_ciCultivosSave(cultivos)) {
    return { ok: false, motivo: 'fallo persistencia' };
  }

  _ciDispatchCultivosChanged('editado', id);
  return { ok: true };
}

// ─── Operaciones de consumo (Fase 4 — invocadas por GR) ───

function _ciCultivoConsumir(cultivoId, cantidad, ref) {
  // ref = { refType: 'GR', refId: <string>, fecha?: <iso>, notas?: <string> }
  // Atómica: re-lee storage, valida estado y stock, descuenta, registra consumo,
  // auto-transición a AGOTADO si cantidadDisponible llega a 0, persiste y dispatcha.
  if (typeof cultivoId !== 'string' || !cultivoId)
    return { ok: false, motivo: 'cultivoId requerido' };
  if (!Number.isInteger(cantidad) || cantidad <= 0)
    return { ok: false, motivo: 'cantidad debe ser entero positivo' };
  if (!ref || typeof ref !== 'object' || typeof ref.refId !== 'string' || !ref.refId)
    return { ok: false, motivo: 'ref con refId requerido' };

  const cultivos = _ciCultivosLoad();
  const idx = cultivos.findIndex(c => c && c.id === cultivoId);
  if (idx === -1) return { ok: false, motivo: 'cultivo no encontrado' };

  const c = cultivos[idx];
  if (c.estado === 'DESCARTADO') return { ok: false, motivo: 'cultivo descartado' };
  if (c.estado === 'AGOTADO')    return { ok: false, motivo: 'cultivo agotado' };
  if (c.estado !== 'DISPONIBLE') return { ok: false, motivo: 'cultivo en estado no consumible: ' + c.estado };
  if (typeof c.cantidadDisponible !== 'number' || c.cantidadDisponible < cantidad)
    return { ok: false, motivo: 'sin stock suficiente' };

  c.cantidadDisponible -= cantidad;
  if (!Array.isArray(c.consumos)) c.consumos = [];
  c.consumos.push({
    refType:  ref.refType || 'GR',
    refId:    ref.refId,
    cantidad,
    fecha:    (typeof ref.fecha === 'string' && ref.fecha) ? ref.fecha : new Date().toISOString(),
    notas:    (typeof ref.notas === 'string' && ref.notas) ? ref.notas : undefined,
  });
  if (c.cantidadDisponible === 0) c.estado = 'AGOTADO';

  if (!_ciCultivosSave(cultivos)) return { ok: false, motivo: 'fallo persistencia' };
  _ciDispatchCultivosChanged('consumido', cultivoId);
  return { ok: true, cantidadRestante: c.cantidadDisponible, estado: c.estado };
}

function _ciCultivoDevolverConsumoPorRef(refIdOrPrefix, opciones) {
  // Devuelve TODOS los consumos cuyo refId === refIdOrPrefix (modo exacto, default)
  // o cuyo refId comienza con refIdOrPrefix (modo prefijo, useful para "wipe lote").
  // opciones = { prefijo?: boolean, cultivoId?: string }
  // - Si cultivoId se especifica, solo opera sobre ese cultivo; si no, recorre todos.
  // - Si AGOTADO se desbloquea por la devolución, vuelve a DISPONIBLE.
  if (typeof refIdOrPrefix !== 'string' || !refIdOrPrefix)
    return { ok: false, motivo: 'refId requerido' };

  const opts        = (opciones && typeof opciones === 'object') ? opciones : {};
  const usarPrefijo = !!opts.prefijo;
  const targetCid   = (typeof opts.cultivoId === 'string' && opts.cultivoId) ? opts.cultivoId : null;

  const cultivos = _ciCultivosLoad();
  let hubo = false;
  let totalDevuelto = 0;
  const cultivosTocados = [];

  for (let i = 0; i < cultivos.length; i++) {
    const c = cultivos[i];
    if (!c || !Array.isArray(c.consumos)) continue;
    if (targetCid && c.id !== targetCid) continue;

    let devueltoEsta = 0;
    c.consumos = c.consumos.filter(co => {
      if (!co || typeof co.refId !== 'string') return true;
      const match = usarPrefijo ? co.refId.startsWith(refIdOrPrefix) : co.refId === refIdOrPrefix;
      if (match) { devueltoEsta += (co.cantidad || 0); return false; }
      return true;
    });

    if (devueltoEsta > 0) {
      c.cantidadDisponible = (typeof c.cantidadDisponible === 'number' ? c.cantidadDisponible : 0) + devueltoEsta;
      // Si estaba AGOTADO y vuelve a tener stock, volvemos a DISPONIBLE.
      // DESCARTADO es terminal: NO se reactiva (auditoría científica).
      if (c.estado === 'AGOTADO' && c.cantidadDisponible > 0) c.estado = 'DISPONIBLE';
      hubo = true;
      totalDevuelto += devueltoEsta;
      cultivosTocados.push(c.id);
    }
  }

  if (!hubo) return { ok: true, devuelto: 0, cultivosTocados: [] };
  if (!_ciCultivosSave(cultivos)) return { ok: false, motivo: 'fallo persistencia' };
  cultivosTocados.forEach(id => _ciDispatchCultivosChanged('devuelto', id));
  return { ok: true, devuelto: totalDevuelto, cultivosTocados };
}

// ─── Notificación de cambios ───

function _ciDispatchCultivosChanged(tipo, cultivoId) {
  // Custom event consumido por GR (Fase 4) y por la UI propia de CI (Fase 3b)
  // para refrescar listas. Detail mínimo: los listeners reconsultan vía
  // window.CI.* en lugar de confiar en el payload del evento.
  try {
    window.dispatchEvent(new CustomEvent('ci-cultivos-changed', {
      detail: { tipo, cultivoId }
    }));
  } catch (err) {
    console.warn('[CI] dispatch ci-cultivos-changed falló:', err);
  }
}

// ─── API pública estable (consumida por GR principalmente) ───
// Asignación INCONDICIONAL: cada recarga del módulo CI debe pisar window.CI
// con cierres frescos del IIFE actual. NO usar guard `if (!window.CI)` —
// dejaría apuntando a closures muertas del IIFE anterior tras cualquier recarga.
// NO se elimina en onModuleUnload — debe seguir disponible para GR aunque
// CI no sea el módulo activo.
Object.assign(window, {
  CI: {
    listCultivosDisponibles: ciListCultivosDisponibles,
    getCultivoById:          ciGetCultivoById,
    getCultivosByGenetica:   ciGetCultivosByGenetica,
    getConsumosByCultivo:    ciGetConsumosByCultivo,
    getSchemaVersion:        ciGetSchemaVersion,
    // Fase 4 — escritura: consumo y devolución
    consumirCantidad:        _ciCultivoConsumir,
    devolverConsumoPorRef:   _ciCultivoDevolverConsumoPorRef,
  }
});

// ════════════════════════════════════════════
// CULTIVOS CI — UI / handlers (Fase 3b)
//   Promoción inline desde SEG, listado en subtab Cultivos,
//   acciones de descarte/edición/trazabilidad.
// ════════════════════════════════════════════

// ─── Resolver snapshot genético desde un id GE ───
function _ciResolverGeneticaSnapshot(geneticaId) {
  if (!geneticaId) return null;
  // Intento 1: API en memoria de GE
  if (window.ge && typeof window.ge.getSelectableGenetics === 'function') {
    const list = window.ge.getSelectableGenetics();
    const item = list && list.find(g => g.id === geneticaId);
    if (item) return { codigoGE: item.id, label: item.label };
  }
  // Intento 2: leer biolab.ge.v4 directo y reconstruir cadena
  try {
    const raw = JSON.parse(localStorage.getItem('biolab.ge.v4'));
    if (raw && Array.isArray(raw.nodes) && raw.nodes.length) {
      const nodes = raw.nodes;
      const getNode = id => nodes.find(n => n.id === id) || null;
      const node = getNode(geneticaId);
      if (!node) return { codigoGE: geneticaId, label: geneticaId };
      const chain = [];
      let cur = node;
      while (cur) { chain.unshift(cur); cur = cur.parentId ? getNode(cur.parentId) : null; }
      const sp = chain.find(x => x.type === 'species');
      const st = chain.find(x => x.type === 'strain');
      const parts = [];
      if (sp) parts.push(sp.name);
      if (st && st.id !== node.id) parts.push(st.name);
      parts.push(node.name);
      return {
        codigoGE: node.id,
        label:    parts.join(' / '),
        especie:  sp ? sp.name : '',
        cepa:     st ? st.name : '',
        fenotipo: node.type === 'phenotype' ? node.name : '',
      };
    }
  } catch (e) {
    console.warn('[CI] No se pudo resolver snapshot genético:', e);
  }
  // Sin GE disponible: snapshot mínimo (no rompe trazabilidad, sigue siendo único)
  return { codigoGE: geneticaId, label: geneticaId };
}


// ─── Listado de cultivos en el subtab ───
let _ciCultivosFiltroEstadoDefault = 'DISPONIBLE';

function renderCultivosTab() {
  _ciCultivosAutoArchivar();
  const tbody = document.getElementById('ci-cultivos-tbody');
  const empty = document.getElementById('ci-cultivos-empty');
  const stats = document.getElementById('ci-cultivos-stats');
  if (!tbody) return;

  const cultivos = _ciCultivosLoad();
  const fEstado = document.getElementById('ci-cultivos-filter-estado')?.value ?? _ciCultivosFiltroEstadoDefault;
  const fTipo   = document.getElementById('ci-cultivos-filter-tipo')?.value   ?? '';
  const fQ      = (document.getElementById('ci-cultivos-filter-q')?.value || '').trim().toLowerCase();

  const formsMap = (() => {
    const m = {};
    try { (JSON.parse(localStorage.getItem(K.forms)) || []).forEach(f => { if (f && f.id) m[f.id] = f.nombre || f.id; }); } catch(e) {}
    return m;
  })();

  const filtrados = cultivos.filter(c => {
    if (!c) return false;
    if (fEstado && c.estado !== fEstado) return false;
    if (fTipo && c.tipo !== fTipo) return false;
    if (fQ) {
      const hay = (c.codigo + ' ' + (c.geneticaSnapshot?.label || '') + ' ' + (c.id || '')).toLowerCase();
      if (!hay.includes(fQ)) return false;
    }
    return true;
  }).sort((a, b) => {
    const nameA = formsMap[a.medioFormulaId] || a.medioFormulaId || '';
    const nameB = formsMap[b.medioFormulaId] || b.medioFormulaId || '';
    return nameA.localeCompare(nameB);
  });

  if (stats) {
    const total = cultivos.length;
    const disp  = cultivos.filter(c => c.estado === 'DISPONIBLE').length;
    const ago   = cultivos.filter(c => c.estado === 'AGOTADO').length;
    const desc  = cultivos.filter(c => c.estado === 'DESCARTADO').length;
    stats.textContent = `Total: ${total} · Disponibles: ${disp} · Agotados: ${ago} · Descartados: ${desc} · Mostrando: ${filtrados.length}`;
  }

  if (!filtrados.length) {
    tbody.innerHTML = '';
    if (empty) empty.style.display = '';
    return;
  }
  if (empty) empty.style.display = 'none';

  // Limpiar filas expandidas de consumos antes de re-render
  tbody.querySelectorAll('tr[id^="ci-consumos-row-"]').forEach(function(r) { r.remove(); });
  // Cargar links de CiGrLinks una sola vez para toda la tabla
  const allLinks = (() => {
    try { return JSON.parse(localStorage.getItem('bl2_ci_gr_links')) || []; } catch(e) { return []; }
  })();

  tbody.innerHTML = filtrados.map(c => {
    const estCol = c.estado === 'DISPONIBLE' ? 'var(--ac)'
                 : c.estado === 'AGOTADO'    ? 'var(--wn)'
                 : c.estado === 'CADUCADO'   ? 'var(--er)'
                 : c.estado === 'DESCARTADO' ? 'var(--tx3)'
                 : 'var(--tx2)';
    const fmtFecha = c.fechaValidacion ? ciFormatDate(c.fechaValidacion) : '—';
    const formulaNombre = c.medioFormulaId ? esc(formsMap[c.medioFormulaId] || c.medioFormulaId) : '—';

    // Columna GR: leer desde bl2_ci_gr_links (fuente de verdad), no desde c.consumos[]
    const links = Array.isArray(allLinks)
      ? allLinks.filter(l => l && l.estado === 'ACTIVO' && l.cultivoCiId === c.id) : [];
    const totalConsumido = links.reduce((a, l) => a + (l.cantidad || 0), 0);
    const grRefs = [...new Set(links.filter(l => l.grLoteId).map(l => l.grLoteId))];
    const grCol = links.length === 0
      ? '<span style="color:var(--tx3);font-size:11px">—</span>'
      : `<span style="font-size:11px;color:var(--wn)">${totalConsumido} ud</span>`
        + (grRefs.length ? `<br><span style="font-size:10px;color:var(--tx3)">${grRefs.map(r => esc(r)).join(', ')}</span>` : '');

    const accDescarte = c.estado !== 'DESCARTADO'
      ? `<button type="button" class="btn btn-s" onclick="ciDescartarCultivo('${c.id}')" title="Descartar" style="font-size:10px;padding:3px 8px">✕</button>`
      : '';
    return `
      <tr data-cultivo-id="${c.id}">
        <td><code style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--ac)">${esc(c.codigo)}</code></td>
        <td>${esc(c.geneticaSnapshot?.label || c.geneticaId || '—')}</td>
        <td><span style="font-size:11px;color:var(--tx2)">${esc(c.tipo)}</span></td>
        <td><span style="font-weight:600;color:${estCol};font-size:11px">${esc(c.estado)}</span></td>
        <td><span style="font-family:'JetBrains Mono',monospace;font-size:11px">${Math.max(0, c.cantidadDisponible - totalConsumido)}/${c.cantidadInicial}</span></td>
        <td><span style="font-size:11px;color:var(--tx2)">${esc(fmtFecha)}</span></td>
        <td><span style="font-size:11px;color:var(--tx2)">${formulaNombre}</span></td>
        <td>${grCol}</td>
        <td style="display:flex;gap:4px;flex-wrap:wrap;align-items:center">
          <button type="button" class="btn btn-s" onclick="ciToggleConsumos('${c.id}')" title="Detalle consumos GR" style="font-size:10px;padding:3px 8px">🔍</button>
          <button type="button" class="btn btn-s" onclick="ciEditarCultivoNotas('${c.id}')" title="Editar notas" style="font-size:10px;padding:3px 8px">✎</button>
          ${accDescarte}
        </td>
      </tr>`;
  }).join('');
}

function ciFiltrarCultivos() { renderCultivosTab(); }

function ciDescartarCultivo(id) {
  if (!id) return;
  const c = ciGetCultivoById(id);
  if (!c) { sN('Cultivo no encontrado', true); return; }
  const motivo = prompt(`Descartar cultivo ${c.codigo}\n\nMotivo (opcional):`, '');
  if (motivo === null) return; // canceló
  const res = _ciCultivoMarcarDescartado(id, motivo || '');
  if (!res.ok) { sN('No se pudo descartar: ' + (res.motivo || 'error'), true); return; }
  sN('🗑️ Cultivo descartado: ' + c.codigo);
}

function ciEditarCultivoNotas(id) {
  if (!id) return;
  const c = ciGetCultivoById(id);
  if (!c) { sN('Cultivo no encontrado', true); return; }
  const nuevas = prompt(`Notas de ${c.codigo}:`, c.notas || '');
  if (nuevas === null) return;
  const res = _ciCultivoEditarBlandos(id, { notas: nuevas });
  if (!res.ok) { sN('No se pudo editar: ' + (res.motivo || 'error'), true); return; }
  sN('✎ Notas actualizadas: ' + c.codigo);
}

function ciToggleConsumos(id) {
  if (!id) return;
  var tbody = document.getElementById('ci-cultivos-tbody');
  if (!tbody) return;

  var existingRow = document.getElementById('ci-consumos-row-' + id);
  if (existingRow) {
    existingRow.remove();
    return;
  }

  var c = ciGetCultivoById(id);
  if (!c) return;
  var consumos = ciGetConsumosByCultivo(id);

  var srcRow = tbody.querySelector('tr[data-cultivo-id="' + id + '"]');
  if (!srcRow) return;

  var consumosHtml = consumos.length
    ? consumos.map(function(co) {
        var ref = co.refType === 'GR' ? 'GR/' + co.refId : (co.refType || '?') + '/' + (co.refId || '?');
        var fecha = co.fecha ? ciFormatDate(co.fecha) : '—';
        return '<div style="display:flex;gap:12px;align-items:center;padding:4px 0;border-bottom:1px solid var(--border-light)">'
          + '<span style="color:var(--tx3);font-size:11px;min-width:80px">' + esc(fecha) + '</span>'
          + '<span style="color:var(--ac2);font-family:\'JetBrains Mono\',monospace;font-size:11px;min-width:30px">' + esc(String(co.cantidad || 0)) + ' ud</span>'
          + '<span style="color:var(--ac4);font-size:11px">' + esc(ref) + '</span>'
          + (co.notas ? '<span style="color:var(--tx2);font-size:11px">' + esc(co.notas) + '</span>' : '')
          + '</div>';
      }).join('')
    : '<span style="color:var(--tx3);font-size:11px">Sin consumos registrados</span>';

  var tr = document.createElement('tr');
  tr.id = 'ci-consumos-row-' + id;
  tr.innerHTML = '<td colspan="9" style="padding:8px 14px 8px 24px;background:var(--bg2)">'
    + '<div style="font-size:11px;color:var(--tx3);margin-bottom:4px">Consumos de GR</div>'
    + consumosHtml
    + '</td>';
  srcRow.insertAdjacentElement('afterend', tr);
}

// ════════════════════════════════════════════
// SEG — Seguimiento CI colapsable
// ════════════════════════════════════════════

function segToggleSeguimiento(frmId) {
  const body = document.getElementById('seg-seguimiento-body-' + frmId);
  const chev = document.getElementById('seg-seg-chev-' + frmId);
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : '';
  if (chev) chev.textContent = isOpen ? '▶' : '▼';
}

// Actualiza el badge de conteo de notas de seguimiento
function _segActualizarBadgeSeguimiento(frmId) {
  const badge = document.getElementById('seg-seg-badge-' + frmId);
  if (!badge) return;
  const notas = (SEG.seguimientoNotas[frmId] || []);
  badge.textContent = notas.length ? notas.length : '';
  badge.style.display = notas.length ? 'inline-flex' : 'none';
}

// ════════════════════════════════════════════
// DASHBOARD — Vista compacta de fórmulas
// ════════════════════════════════════════════

function ciRenderDashboard() {
  // Siempre arrancar en vista grid al llamar ciRenderDashboard directamente
  const gw = document.getElementById('ci-dash-grid-wrap');
  const dw = document.getElementById('ci-dash-detalle-wrap');

  // ── SAFE-SAVE ANTES DE DESTRUIR EL DOM ─────────────────────────────────
  // ciDashVolverGrid() guarda antes de limpiar, pero ciRenderDashboard()
  // puede ser llamado directamente (ej: click en tab Dashboard mientras
  // el detalle está abierto). Sin este bloque, los cambios se pierden.
  if (dw && dw.style.display !== 'none') {
    Object.keys(_segAutoSaveTimers).forEach(id => {
      clearTimeout(_segAutoSaveTimers[id]);
      delete _segAutoSaveTimers[id];
    });
    const _tbActivos = Array.from(dw.querySelectorAll('[id^="segTbody-"]'));
    const _frmActivos = [...new Set(_tbActivos.map(tb => _segFrmIdFromTbodyId(tb.id)).filter(Boolean))];
    _frmActivos.forEach(id => { try { segGuardarTandas(id, true); } catch (e) {} });
  }
  // ────────────────────────────────────────────────────────────────────────

  if (gw) gw.style.display = '';
  if (dw) { dw.style.display = 'none'; dw.innerHTML = ''; }

  const grid = document.getElementById('ci-dashboard-grid');
  if (!grid) return;

  const forms   = gDB(K.forms);
  const allIngs = gDB(K.ings);
  const segs    = gDB(K.seg);

  const visibles = forms.filter(f => !f.archivada)
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

  if (!visibles.length) {
    grid.innerHTML = '<div class="empty" style="grid-column:1/-1">Sin fórmulas. Creá una en la pestaña Formulación.</div>';
    return;
  }

  grid.innerHTML = visibles.map(f => {
    const ingsSorted = [...f.ingredientes].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
    const { c, n, masa } = calcCN(ingsSorted, allIngs);
    const cn = n > 0 ? (c / n).toFixed(1) : '—';

    const segsF   = segs.filter(s => s.formula_id === f.id);
    const totalP  = segsF.reduce((s, r) => s + (r.placas || 0), 0);
    const totalC  = segsF.reduce((s, r) => s + (r.contaminados || 0), 0);
    const sanas   = totalP - totalC;
    const ratio   = totalP > 0 ? Math.round(sanas / totalP * 100) : null;
    const ratioCol = ratio === null ? 'var(--tx3)'
      : ratio >= 80 ? 'var(--ac)' : ratio >= 50 ? 'var(--wn)' : 'var(--er)';

    const tileIdDate2 = (() => {
      const seg = segsF.filter(s => s.colonizacion)
        .sort((a, b) => new Date(b.colonizacion) - new Date(a.colonizacion))[0];
      if (!seg) return ciFormatDate(f.fecha).split(' ')[0];
      const colDate = _segParseDate(seg.colonizacion);
      if (!colDate || isNaN(colDate)) return ciFormatDate(f.fecha).split(' ')[0];
      const colonFmt = ciFormatDate(colDate.toISOString()).split(' ')[0];
      if (seg.inoculoFecha || seg.inoculoTs) {
        const inoDate = seg.inoculoFecha ? _segParseDate(seg.inoculoFecha) : new Date(seg.inoculoTs);
        const dias    = Math.round((colDate - inoDate) / 86400000);
        if (isFinite(dias) && dias >= 0) {
          return `${ciFormatDate(inoDate.toISOString()).split(' ')[0]} - ${colonFmt} - D ${dias}`;
        }
      }
      return `Col: ${colonFmt}`;
    })();

    const expCount = expByFormula(f.id).length;
    const notas = (SEG.seguimientoNotas[f.id] || []);
    const lastNota = notas.length ? notas[notas.length - 1] : null;
    const estadoColor = { green: 'var(--ac)', yellow: 'var(--wn)', red: 'var(--er)', none: 'var(--tx3)' };
    const notaCol = lastNota ? (estadoColor[lastNota.estado] || 'var(--tx3)') : 'var(--tx3)';

    const ratioBar = ratio !== null ? `
      <div style="margin:6px 0 4px;height:3px;border-radius:2px;background:var(--bg-tertiary);overflow:hidden">
        <div style="height:100%;width:${ratio}%;background:${ratioCol};border-radius:2px;transition:width .4s"></div>
      </div>` : '';

    return `
      <div class="ci-dash-tile" onclick="ciDashOpenFormula('${f.id}')">
        <div class="ci-dash-tile-top">
          <span class="ci-dash-tile-name">${esc(f.nombre)}</span>
          <span class="ci-dash-tile-ver">${esc(f.version || 'v1')}</span>
        </div>
        <div class="ci-dash-tile-id">${f.id} · ${tileIdDate2}</div>
        <div class="ci-dash-metrics">
          <div class="ci-dash-metric">
            <div class="ci-dash-mval" style="color:var(--wn)">${cn}</div>
            <div class="ci-dash-mlbl">C/N</div>
          </div>
          <div class="ci-dash-metric">
            <div class="ci-dash-mval" style="color:var(--ac3)">${masa.toFixed(0)}g</div>
            <div class="ci-dash-mlbl">Masa</div>
          </div>
          <div class="ci-dash-metric">
            <div class="ci-dash-mval" style="color:var(--ac2)">${f.ingredientes.length}</div>
            <div class="ci-dash-mlbl">Ings</div>
          </div>
          ${totalP ? `<div class="ci-dash-metric">
            <div class="ci-dash-mval" style="color:${ratioCol}">${sanas}/${totalP}</div>
            <div class="ci-dash-mlbl">🧫 ${ratio}%</div>
          </div>` : ''}
          ${expCount ? `<div class="ci-dash-metric">
            <div class="ci-dash-mval" style="color:var(--ac4)">${expCount}</div>
            <div class="ci-dash-mlbl">🔬 Exp</div>
          </div>` : ''}
          ${notas.length ? `<div class="ci-dash-metric">
            <div class="ci-dash-mval" style="color:${notaCol}">${notas.length}</div>
            <div class="ci-dash-mlbl">📝 Notas</div>
          </div>` : ''}
        </div>
        ${ratioBar}
        ${lastNota ? `<div class="ci-dash-last-nota" style="border-left-color:${notaCol}">
          ${esc(lastNota.texto.slice(0, 72))}${lastNota.texto.length > 72 ? '…' : ''}
        </div>` : ''}
      </div>`;
  }).join('');
}

// Abre la vista detalle de una fórmula dentro del Dashboard
function ciDashOpenFormula(frmId) {
  // Asegurar que estamos en el tab Dashboard
  ciSubTab('dashboard');
  // ciSubTab → ciRenderDashboard muestra grid-wrap; ahora lo ocultamos y mostramos detalle
  const gw = document.getElementById('ci-dash-grid-wrap');
  const dw = document.getElementById('ci-dash-detalle-wrap');
  if (gw) gw.style.display = 'none';
  if (dw) dw.style.display = '';
  ciDashRenderDetalle(frmId);
}

// Renderiza la vista detalle completa de una fórmula dentro de #ci-dash-detalle-wrap
function ciDashRenderDetalle(frmId) {
  const forms = gDB(K.forms);
  const f = forms.find(x => x.id === frmId);
  if (!f) return;

  const dw = document.getElementById('ci-dash-detalle-wrap');
  if (!dw) return;

  // ── CANCELAR AUTOSAVE PENDIENTE ───────────────────────────────────────────
  // Antes de re-renderizar (y vaciar los tbodys), cancelar cualquier timer
  // autosave pendiente para CUALQUIER fórmula. Esto previene la race condition
  // donde un timer anterior dispara sobre los nuevos tbodys vacíos.
  Object.keys(_segAutoSaveTimers).forEach(id => {
    clearTimeout(_segAutoSaveTimers[id]);
    delete _segAutoSaveTimers[id];
  });
  // ─────────────────────────────────────────────────────────────────────────

  const ings = gDB(K.ings);
  const ingsSorted = [...f.ingredientes].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  const { c, n, masa } = calcCN(ingsSorted, ings);
  const cn = n > 0 ? (c / n).toFixed(2) : '—';

  const diasCreacion = f.fecha ? Math.round((Date.now() - new Date(f.fecha)) / 86400000) : null;

  if (!window.aspFilters[f.id]) {
    window.aspFilters[f.id] = {};
    Object.keys(ASP_COLORS).forEach(a => window.aspFilters[f.id][a] = true);
  }

  dw.innerHTML = `
    <div class="frm-card ci-dd-card" id="fcard-${f.id}">

      <!-- Barra de navegación del detalle -->
      <div class="ci-dd-nav">
        <button class="ci-dd-back" onclick="ciDashVolverGrid()">← Volver</button>
        <div class="ci-dd-info">
          <span class="ci-dd-nombre">${esc(f.nombre)}</span>
          <span class="ci-dd-ver">${esc(f.version || 'v1')}</span>
          <span class="ci-dd-id">${f.id}</span>
          ${diasCreacion !== null ? `<span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--tx3)">${ciFormatDate(f.fecha).split(' ')[0]} · D${diasCreacion}</span>` : ''}
          ${f.archivada ? '<span class="ci-dd-arch">ARCHIVADA</span>' : ''}
        </div>
        <div class="ci-dd-metrics">
          <span id="fhdr-cn-${f.id}" style="color:var(--wn);font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700">C/N ${cn}</span>
          <span id="fhdr-masa-${f.id}" style="color:var(--ac3);font-family:'JetBrains Mono',monospace;font-size:12px">${masa.toFixed(0)}g</span>
        </div>
        <button class="btn btn-s" style="height:24px;font-size:10px;padding:0 8px;border-color:var(--ac2);color:var(--ac2)" onclick="exportFormulaJSON('${f.id}')" title="Exportar JSON">⬇ JSON</button>
        <span class="ci-edit-indicator" onclick="frmToggleEdit('${f.id}')">EDIT</span>
        <button class="btn btn-d" style="display:none;height:24px;font-size:10px;padding:0 8px" onclick="delFrmFromCI('${f.id}')" title="Eliminar">✕</button>
      </div>

      <!-- Cuerpo completo de la fórmula — siempre visible en detalle -->
      <div class="frm-card-body open" id="fbody-${f.id}">
        ${buildFrmBodyHTML(f)}
      </div>

    </div>`;

  // Marcar como abierto para que frmToggleEdit y frmToggle funcionen correctamente
  frmCollapsed[f.id] = false;

  // Two-pass init: idéntico al patrón de ciRenderFormulasList
  // Pasada 1 (100ms): cargar filas desde storage + renders tabla/pie/badge
  setTimeout(() => {
    try { segCargarTandas(f.id); } catch (e) { console.warn('[CI] segCargarTandas error en detalle', e); }
    const { rows } = calcCN(ingsSorted, gDB(K.ings));
    renderFrmIngTable(f.id, rows);
    drawFrmPie(`fpie-${f.id}`, rows, f.id);
    try { expActualizarBadge(f.id); } catch (e) {}
    // Auto-abrir panel de experimentos si hay experimentos para esta fórmula
    try {
      if (expByFormula(f.id).length > 0) {
        const expBody = document.getElementById('ci-exp-body-' + f.id);
        const expChev = document.getElementById('ci-exp-chev-' + f.id);
        if (expBody && expBody.style.display === 'none') {
          expBody.style.display = '';
          if (expChev) expChev.classList.add('open');
          expRenderLista(f.id);
        }
      }
    } catch (e) {}
    // Pasada 2 (200ms): genéticas + notas de seguimiento
    setTimeout(() => {
      try { segInicializarGeneticas(f.id); } catch (e) {}
      try { segRenderSeguimientoNotas(f.id); } catch (e) {}
    }, 100);
  }, 100);

  // Scroll al inicio del detalle
  dw.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Vuelve al grid desde la vista detalle
function ciDashVolverGrid() {
  const gw = document.getElementById('ci-dash-grid-wrap');
  const dw = document.getElementById('ci-dash-detalle-wrap');

  // ── SAFE-SAVE ANTES DE DESTRUIR EL DOM ───────────────────────────────────
  // Cancelar timers pendientes y persistir el estado actual de TODAS las
  // fórmulas visibles antes de vaciar dw.innerHTML. Sin esto, un timer de
  // autosave podría disparar sobre tbodys vacíos tras el re-render.
  Object.keys(_segAutoSaveTimers).forEach(id => {
    clearTimeout(_segAutoSaveTimers[id]);
    delete _segAutoSaveTimers[id];
  });
  // Guardar todas las fórmulas con tbodys activos en el DOM
  if (dw) {
    const tbodysActivos = Array.from(dw.querySelectorAll('[id^="segTbody-"]'));
    const frmIdsActivos = [...new Set(tbodysActivos.map(tb => _segFrmIdFromTbodyId(tb.id)).filter(Boolean))];
    frmIdsActivos.forEach(id => {
      try { segGuardarTandas(id, true); } catch (e) {}
    });
  }
  // ─────────────────────────────────────────────────────────────────────────

  if (dw) { dw.style.display = 'none'; dw.innerHTML = ''; }
  if (gw) gw.style.display = '';
  ciRenderDashboard();
}

// ════════════════════════════════════════════
// MODO EXPERIMENTO
// Storage key: bl2_experimentos
// Estructura: { id, formulaId, nombre, fechaCreacion, volBase, frascos:[{id,label,volFrasco,extras:[{ingId,qty}]}] }
// ════════════════════════════════════════════

// ── Storage helpers ──
function expLoad()           { return gDB(K.exp); }
function expSave(arr)        { sDB(K.exp, arr); }
function expNxtId()          { return nxtId('EXP', expLoad()); }
function expByFormula(frmId) { return expLoad().filter(x => x.formulaId === frmId); }

// ── Hoist del modal a body (idéntico al patrón _ciHoistModal) ──
function _expHoistModal() {
  // Limpiar cualquier copia que quedó dentro del módulo (fuera de body)
  document.querySelectorAll('#ci-exp-modal').forEach(el => {
    if (el.parentNode !== document.body) el.remove();
  });
  // Si ya existe en body, no hacer nada
  if (document.getElementById('ci-exp-modal')) return;
  _expEnsureModal();
}

// Crea el modal en document.body si no existe — fuente de verdad única.
// No depende del HTML del módulo ni de timing de carga.
function _expEnsureModal() {
  if (document.getElementById('ci-exp-modal')) return;
  const el = document.createElement('div');
  el.id = 'ci-exp-modal';
  el.className = 'ci-modal';
  el.style.display = 'none';
  el.innerHTML = `
    <div class="ci-modal-backdrop" onclick="expCerrarModal()"></div>
    <div class="ci-modal-dialog" role="dialog" aria-modal="true"
         aria-labelledby="ci-exp-modal-title"
         style="min-width:540px;max-width:96vw;max-height:94vh">
      <div class="ci-modal-header">
        <span id="ci-exp-modal-title" style="color:var(--ac4);font-weight:600">🔬 Nuevo Experimento</span>
        <button type="button" class="ci-modal-close" onclick="expCerrarModal()" title="Cerrar">✕</button>
      </div>
      <div class="ci-modal-body">
        <div class="ci-modal-meta" id="ci-exp-modal-meta"></div>
        <div style="display:grid;grid-template-columns:1fr 130px 110px;gap:10px;margin-bottom:14px">
          <div>
            <label>Nombre del experimento</label>
            <input type="text" id="ci-exp-nombre" placeholder="ej: Ensayo tiamina concentración">
          </div>
          <div>
            <label>Volumen base (ml)
              <span id="ci-exp-volbase-hint"
                    style="font-size:10px;color:var(--ac);font-weight:600;margin-left:4px"></span>
            </label>
            <input type="number" id="ci-exp-volbase" min="1" step="0.1" placeholder="ml">
          </div>
          <div>
            <label>N° frascos</label>
            <select id="ci-exp-nfrascos"
                    onchange="expOnNFrascosChange(parseInt(this.value))">
              <option value="2">2 frascos</option>
              <option value="3" selected>3 frascos</option>
              <option value="4">4 frascos</option>
            </select>
          </div>
        </div>
        <div id="ci-exp-frascos-modal" class="ci-exp-frascos-grid"></div>
      </div>
      <div class="ci-modal-footer">
        <button type="button" class="ci-modal-cancel" onclick="expCerrarModal()">Cancelar</button>
        <button type="button" class="ci-exp-confirm" onclick="expGuardar()">💾 Guardar experimento</button>
      </div>
    </div>`;
  document.body.appendChild(el);
}

// ── HTML del panel colapsable dentro de cada fórmula ──
function buildExpHTML(frmId) {
  return `
    <div class="ci-exp-panel" id="ci-exp-panel-${frmId}">
      <div class="ci-exp-header" onclick="expTogglePanel('${frmId}')">
        <span style="font-size:14px;line-height:1">🔬</span>
        <span class="ci-exp-title">Experimentos</span>
        <span class="ci-exp-badge" id="ci-exp-badge-${frmId}"></span>
        <span class="ci-exp-chevron" id="ci-exp-chev-${frmId}">▼</span>
      </div>
      <div class="ci-exp-body" id="ci-exp-body-${frmId}" style="display:none">
        <button type="button" class="ci-exp-btn-nuevo" onclick="expAbrirCrear('${frmId}')">+ Nuevo experimento</button>
        <div id="ci-exp-lista-${frmId}"></div>
      </div>
    </div>`;
}

// ── Toggle del panel ──
function expTogglePanel(frmId) {
  const body = document.getElementById('ci-exp-body-' + frmId);
  const chev = document.getElementById('ci-exp-chev-' + frmId);
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : '';
  if (chev) chev.classList.toggle('open', !isOpen);
  if (!isOpen) expRenderLista(frmId);
}

// ── Actualiza el badge de conteo ──
function expActualizarBadge(frmId) {
  const badge = document.getElementById('ci-exp-badge-' + frmId);
  if (!badge) return;
  const n = expByFormula(frmId).length;
  badge.textContent = n;
  badge.classList.toggle('visible', n > 0);
}

// ── Renderiza la lista de experimentos de una fórmula ──
function expRenderLista(frmId) {
  const cont = document.getElementById('ci-exp-lista-' + frmId);
  if (!cont) return;
  const exps = expByFormula(frmId).sort((a, b) => b.fechaCreacion.localeCompare(a.fechaCreacion));
  if (!exps.length) {
    cont.innerHTML = '<div class="ci-exp-empty">Sin experimentos. Creá uno con el botón de arriba.</div>';
    return;
  }
  cont.innerHTML = exps.map(exp => `
    <div class="ci-exp-item" id="ci-exp-item-${exp.id}">
      <div class="ci-exp-item-header">
        <span class="ci-exp-item-name">${esc(exp.nombre)}</span>
        <span class="ci-exp-item-id">${exp.id}</span>
        <span class="ci-exp-item-meta">
          ${exp.frascos.length} frascos · ${exp.volBase}ml base · ${ciFormatDate(exp.fechaCreacion)}
        </span>
        <div class="ci-exp-item-actions">
          <button class="btn btn-s" id="ci-exp-btn-tabla-${exp.id}" style="font-size:10px;padding:3px 8px"
            onclick="expToggleTabla('${exp.id}')">📊 Ocultar tabla</button>
          <button class="btn btn-s" style="font-size:10px;padding:3px 8px"
            onclick="expEditar('${exp.id}','${frmId}')">✏️ Editar</button>
          <button class="btn btn-d" style="font-size:10px;padding:3px 8px;height:24px"
            onclick="expEliminar('${exp.id}','${frmId}')">✕</button>
        </div>
      </div>
      <div class="ci-exp-tabla-wrap" id="ci-exp-tabla-${exp.id}"></div>
    </div>`).join('');
  exps.forEach(exp => expRenderTabla(exp.id));
}

// ── Toggle de la tabla comparativa de un experimento ──
function expToggleTabla(expId) {
  const wrap = document.getElementById('ci-exp-tabla-' + expId);
  if (!wrap) return;
  const isOpen = wrap.style.display !== 'none';
  wrap.style.display = isOpen ? 'none' : '';
  const btn = document.getElementById('ci-exp-btn-tabla-' + expId);
  if (btn) btn.textContent = isOpen ? '📊 Ver tabla' : '📊 Ocultar tabla';
  if (!isOpen) expRenderTabla(expId);
}

// ── Construye y renderiza la tabla comparativa ──
function expRenderTabla(expId) {
  const wrap = document.getElementById('ci-exp-tabla-' + expId);
  if (!wrap) return;

  const exp = expLoad().find(x => x.id === expId);
  if (!exp) { wrap.innerHTML = '<div class="ci-exp-empty">Experimento no encontrado.</div>'; return; }

  const f = gDB(K.forms).find(x => x.id === exp.formulaId);
  if (!f)  { wrap.innerHTML = '<div class="ci-exp-empty">Fórmula no disponible.</div>'; return; }

  const allIngs   = gDB(K.ings);
  const ingsSorted = [...f.ingredientes].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  const volBase   = exp.volBase;

  // Colectar IDs de extras únicos a través de todos los frascos
  const extraIngIds = [];
  exp.frascos.forEach(fr => {
    (fr.extras || []).forEach(e => {
      if (e.ingId && !extraIngIds.includes(e.ingId)) extraIngIds.push(e.ingId);
    });
  });

  // ─ Headers de frascos ─
  const frascoHeaders = exp.frascos.map(fr =>
    `<th class="ci-exp-th-frasco">
       ${esc(fr.label)}
       <span style="font-size:9px;color:var(--tx3);display:block;font-weight:400">${fr.volFrasco}ml · ×${(fr.volFrasco/volBase).toFixed(3)}</span>
     </th>`
  ).join('');

  // ─ Filas de ingredientes base (escalados) ─
  const baseRows = ingsSorted.map(ing => {
    const live   = allIngs.find(x => x.id === ing.id);
    const snap   = ing.snapshot || {};
    const nombre = snap.nombre  || live?.nombre  || ing.id;
    const unidad = snap.unidad  || live?.unidad  || '';
    const aspecto = snap.aspecto || live?.aspecto || '';
    const aspColor = ASP_COLORS[aspecto] || '#888';

    const celdas = exp.frascos.map(fr => {
      const baseQty = ing.qty * (fr.volFrasco / volBase);
      const extra   = (fr.extras || []).find(e => e.ingId === ing.id && e.qty > 0);
      if (extra) {
        const total = baseQty + extra.qty;
        return `<td>
          <span style="color:var(--ac4);font-weight:600">${total.toFixed(2)} ${_unitBadge(unidad)}</span>
          <span style="display:block;font-size:9px;color:var(--wn)">+${extra.qty.toFixed(2)} exp</span>
        </td>`;
      }
      return `<td>${baseQty.toFixed(2)} ${_unitBadge(unidad)}</td>`;
    }).join('');

    return `<tr>
      <td class="ci-exp-td-ing">${esc(nombre)}</td>
      <td class="ci-exp-td-asp"><span style="color:${aspColor};font-size:10px">${esc(aspecto)}</span></td>
      ${celdas}
    </tr>`;
  }).join('');

  // ─ Filas de extras (por ingrediente único) ─
  const sepRow = extraIngIds.length
    ? `<tr class="ci-exp-tr-sep"><td colspan="${2 + exp.frascos.length}">★ Extras por frasco</td></tr>`
    : '';

  const extraRows = extraIngIds.map(ingId => {
    const live   = allIngs.find(x => x.id === ingId);
    const nombre = live?.nombre  || ingId;
    const unidad = live?.unidad  || '';
    const aspecto = live?.aspecto || '';
    const aspColor = ASP_COLORS[aspecto] || '#888';

    const celdas = exp.frascos.map(fr => {
      const extra = (fr.extras || []).find(e => e.ingId === ingId);
      if (!extra) return `<td style="color:var(--tx3)">—</td>`;
      const conc = fr.volFrasco > 0 ? (extra.qty / fr.volFrasco * 1000).toFixed(2) : '?';
      return `<td>
        <span style="color:var(--ac4)">${extra.qty} ${_unitBadge(unidad)}</span>
        <span class="ci-exp-conc">${conc} ${esc(unidad)}/L</span>
      </td>`;
    }).join('');

    return `<tr class="ci-exp-tr-extra">
      <td class="ci-exp-td-ing">★ ${esc(nombre)}</td>
      <td class="ci-exp-td-asp"><span style="color:${aspColor};font-size:10px">${esc(aspecto)}</span></td>
      ${celdas}
    </tr>`;
  }).join('');

  // ─ Fila C/N por frasco ─
  const cnCeldas = exp.frascos.map(fr => {
    const factor = fr.volFrasco / volBase;
    const baseScaled = ingsSorted.map(ing => ({
      id: ing.id, qty: ing.qty * factor, snapshot: ing.snapshot,
    }));
    const extras = (fr.extras || [])
      .filter(e => e.ingId)
      .map(e => ({ id: e.ingId, qty: e.qty }));
    const { c, n } = calcCN([...baseScaled, ...extras], allIngs);
    const cn = n > 0 ? (c / n).toFixed(2) : '—';
    return `<td>
      <span style="color:var(--wn);font-size:13px;font-weight:700">C/N ${cn}</span>
      <span style="display:block;font-size:10px;color:var(--tx3)">C:${c.toFixed(2)} N:${n.toFixed(2)}</span>
    </td>`;
  }).join('');

  wrap.innerHTML = `
    <table class="ci-exp-tabla">
      <thead>
        <tr>
          <th class="ci-exp-th-ing">Ingrediente</th>
          <th>Aspecto</th>
          ${frascoHeaders}
        </tr>
      </thead>
      <tbody>
        ${baseRows}
        ${sepRow}
        ${extraRows}
        <tr class="ci-exp-tr-cn">
          <td colspan="2" style="text-align:left;color:var(--tx3);font-size:10px">Análisis C/N</td>
          ${cnCeldas}
        </tr>
      </tbody>
    </table>`;
}

// ── Eliminar experimento ──
function expEliminar(expId, frmId) {
  const exp = expLoad().find(x => x.id === expId);
  if (!exp) return;
  if (!confirm(`¿Eliminar experimento "${exp.nombre}" (${expId})?`)) return;
  expSave(expLoad().filter(x => x.id !== expId));
  // Limpiar filas de Campo de Trabajo vinculadas a este experimento
  const segsLimpias = gDB(K.seg).filter(s => !(s.formula_id === frmId && s.experimentoId === expId));
  sDB(K.seg, segsLimpias);
  expRenderLista(frmId);
  expActualizarBadge(frmId);
  sN('Experimento eliminado: ' + expId);
}

// ── Abre el modal en modo edición con los datos del experimento existente ──
function expEditar(expId, frmId) {
  const exp = expLoad().find(x => x.id === expId);
  if (!exp) return sN('Experimento no encontrado', true);
  const f = gDB(K.forms).find(x => x.id === frmId);
  if (!f) return sN('Fórmula no encontrada', true);

  _expEnsureModal();
  const modal = document.getElementById('ci-exp-modal');
  if (!modal) return sN('Error interno: no se pudo crear el modal', true);

  _expState = {
    frmId,
    editExpId: expId,
    frascos: exp.frascos.map(fr => ({
      label:     fr.label,
      volFrasco: fr.volFrasco,
      extras:    (fr.extras || []).map(e => ({ ingId: e.ingId, qty: e.qty, unidad: e.unidad })),
    })),
  };

  const titleEl = document.getElementById('ci-exp-modal-title');
  if (titleEl) titleEl.textContent = `✏️ Editar · ${expId}`;
  const metaEl = document.getElementById('ci-exp-modal-meta');
  if (metaEl) metaEl.innerHTML = `Fórmula: <code>${esc(f.id)}</code> — ${esc(f.nombre)}`;

  const vbEl = document.getElementById('ci-exp-volbase');
  if (vbEl) vbEl.value = exp.volBase;
  const hintEl = document.getElementById('ci-exp-volbase-hint');
  if (hintEl) hintEl.textContent = '';

  const nEl = document.getElementById('ci-exp-nfrascos');
  if (nEl) nEl.value = String(exp.frascos.length);

  const nombreEl = document.getElementById('ci-exp-nombre');
  if (nombreEl) nombreEl.value = exp.nombre;

  expRenderFrascosModal();
  modal.style.display = 'flex';
  setTimeout(() => { document.getElementById('ci-exp-nombre')?.focus(); }, 60);
}

// ════════════════════════════════════════════
// MODO EXPERIMENTO — Modal de creación
// ════════════════════════════════════════════

// Estado privado del modal (válido solo mientras el modal está abierto)
let _expState = { frmId: null, frascos: [], editExpId: null };

// Infiere el volumen base sumando ingredientes con unidad 'ml' en la fórmula
function _expInferVolBase(f) {
  const allIngs = gDB(K.ings);
  let total = 0;
  (f.ingredientes || []).forEach(ing => {
    const snap = ing.snapshot;
    const live = allIngs.find(x => x.id === ing.id);
    const unidad = (snap?.unidad || live?.unidad || '').toLowerCase();
    if (unidad === 'ml') total += (ing.qty || 0);
  });
  return total;
}

// Abre el modal para crear un experimento en la fórmula dada
function expAbrirCrear(frmId) {
  const f = gDB(K.forms).find(x => x.id === frmId);
  if (!f) return sN('Fórmula no encontrada', true);

  _expEnsureModal();
  const modal = document.getElementById('ci-exp-modal');
  if (!modal) return sN('Error interno: no se pudo crear el modal', true);

  const volInferido = _expInferVolBase(f);

  _expState = {
    frmId,
    frascos: [
      { label: 'A', volFrasco: 0, extras: [] },
      { label: 'B', volFrasco: 0, extras: [] },
      { label: 'C', volFrasco: 0, extras: [] },
    ],
  };

  // Título y meta
  const titleEl = document.getElementById('ci-exp-modal-title');
  if (titleEl) titleEl.textContent = `🔬 Nuevo Experimento · ${f.id}`;
  const metaEl = document.getElementById('ci-exp-modal-meta');
  if (metaEl) metaEl.innerHTML =
    `Fórmula: <code>${esc(f.id)}</code> — ${esc(f.nombre)}`;

  // Volumen base
  const vbEl = document.getElementById('ci-exp-volbase');
  if (vbEl) vbEl.value = volInferido > 0 ? volInferido : '';
  const hintEl = document.getElementById('ci-exp-volbase-hint');
  if (hintEl) hintEl.textContent = volInferido > 0
    ? `(inferido: ${volInferido}ml)` : '(ingresá manualmente)';

  // N frascos → 3 por defecto
  const nEl = document.getElementById('ci-exp-nfrascos');
  if (nEl) nEl.value = '3';

  // Nombre vacío
  const nombreEl = document.getElementById('ci-exp-nombre');
  if (nombreEl) nombreEl.value = '';

  expRenderFrascosModal();

  modal.style.display = 'flex';
  setTimeout(() => { document.getElementById('ci-exp-nombre')?.focus(); }, 60);
}

// Cierra el modal y limpia el estado
function expCerrarModal() {
  const modal = document.getElementById('ci-exp-modal');
  if (modal) modal.style.display = 'none';
  _expState = { frmId: null, frascos: [], editExpId: null };
}

// Cambia la cantidad de frascos preservando datos existentes
function expOnNFrascosChange(n) {
  _expSyncFrascosDesdeDOM(); // persistir lo que el usuario ya escribió
  const labels = ['A', 'B', 'C', 'D'];
  const curr = _expState.frascos.length;
  if (n > curr) {
    for (let i = curr; i < n; i++) {
      _expState.frascos.push({ label: labels[i] || String(i + 1), volFrasco: 0, extras: [] });
    }
  } else {
    _expState.frascos = _expState.frascos.slice(0, n);
  }
  expRenderFrascosModal();
}

// Lee el estado actual de los paneles de frasco desde el DOM → _expState
function _expSyncFrascosDesdeDOM() {
  document.querySelectorAll('#ci-exp-frascos-modal .ci-exp-frasco-panel').forEach((panel, idx) => {
    if (!_expState.frascos[idx]) return;
    _expState.frascos[idx].label    = panel.querySelector('.ci-exp-frasco-name')?.value  || _expState.frascos[idx].label;
    _expState.frascos[idx].volFrasco = parseFloat(panel.querySelector('.ci-exp-frasco-vol')?.value) || 0;
    const extras = [];
    panel.querySelectorAll('.ci-exp-extra-row').forEach(row => {
      const ingId = row.querySelector('.ci-exp-extra-ing')?.value || '';
      const qty   = parseFloat(row.querySelector('.ci-exp-extra-qty')?.value) || 0;
      if (ingId && qty > 0) extras.push({ ingId, qty });
    });
    _expState.frascos[idx].extras = extras;
  });
}

// Renderiza los paneles de frasco dentro del modal
function expRenderFrascosModal() {
  const cont = document.getElementById('ci-exp-frascos-modal');
  if (!cont) return;
  const allIngs = gDB(K.ings);
  const ingOpts = `<option value="">— Ingrediente —</option>` +
    allIngs.map(i =>
      `<option value="${i.id}">${esc(i.nombre)} (${i.unidad})</option>`
    ).join('');

  cont.innerHTML = _expState.frascos.map((fr, idx) => `
    <div class="ci-exp-frasco-panel">
      <div class="ci-exp-frasco-hdr">
        <span class="ci-exp-frasco-lbl">Frasco ${idx + 1}</span>
        <input type="text" class="ci-exp-frasco-name" value="${esc(fr.label)}"
          placeholder="Label"
          style="flex:1;min-width:0;font-size:12px;padding:4px 6px;border-radius:4px;
                 background:var(--bg-tertiary);border:1px solid var(--border);color:var(--tx)">
        <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
          <span style="font-size:10px;color:var(--tx3)">ml:</span>
          <input type="number" class="ci-exp-frasco-vol" value="${fr.volFrasco || ''}"
            min="1" step="0.1" placeholder="vol"
            style="width:58px;font-size:12px;padding:4px 5px;border-radius:4px;
                   background:var(--bg-tertiary);border:1px solid var(--border);
                   color:var(--tx);text-align:right">
        </div>
      </div>
      <div id="ci-exp-extras-${idx}">
        ${fr.extras.map((e, ei) => `
          <div class="ci-exp-extra-row">
            <select class="ci-exp-extra-ing">${
              allIngs.map(i =>
                `<option value="${i.id}"${i.id === e.ingId ? ' selected' : ''}>${esc(i.nombre)} (${i.unidad})</option>`
              ).join('')
            }</select>
            <input type="number" class="ci-exp-extra-qty"
              value="${e.qty || ''}" min="0" step="0.001" placeholder="qty">
            <button type="button" class="ci-exp-extra-del"
              onclick="expQuitarExtra(${idx},${ei})">✕</button>
          </div>`).join('')}
      </div>
      <button type="button" class="ci-exp-btn-extra"
        onclick="expAgregarExtra(${idx})">+ Extra</button>
    </div>`).join('');
}
// Agrega una fila extra vacía al frasco indicado
function expAgregarExtra(idx) {
  _expSyncFrascosDesdeDOM();
  if (!_expState.frascos[idx]) return;
  _expState.frascos[idx].extras.push({ ingId: '', qty: 0 });
  expRenderFrascosModal();
}

// Elimina el extra en posición ei del frasco idx
function expQuitarExtra(idx, ei) {
  _expSyncFrascosDesdeDOM();
  if (!_expState.frascos[idx]) return;
  _expState.frascos[idx].extras.splice(ei, 1);
  expRenderFrascosModal();
}

// Valida, construye el objeto EXP y lo persiste
function expGuardar() {
  const nombre  = (document.getElementById('ci-exp-nombre')?.value || '').trim();
  const volBase = parseFloat(document.getElementById('ci-exp-volbase')?.value) || 0;

  if (!nombre)      return sN('Ingresá un nombre para el experimento', true);
  if (volBase <= 0) return sN('El volumen base debe ser mayor a 0', true);

  _expSyncFrascosDesdeDOM();

  for (let i = 0; i < _expState.frascos.length; i++) {
    const fr = _expState.frascos[i];
    if (!fr.label.trim())                   return sN(`Frasco ${i + 1}: ingresá un label`, true);
    if (!fr.volFrasco || fr.volFrasco <= 0) return sN(`Frasco ${i + 1}: ingresá el volumen (ml)`, true);
    for (const e of fr.extras) {
      if (!e.ingId) return sN(`Frasco ${i + 1}: seleccioná el ingrediente del extra`, true);
    }
  }

  const frmId     = _expState.frmId;
  const editExpId = _expState.editExpId;

  const frascos = _expState.frascos.map((fr, i) => ({
    id:        i,
    label:     fr.label.trim(),
    volFrasco: fr.volFrasco,
    extras:    fr.extras.filter(e => e.ingId && e.qty > 0),
  }));

  const todos = expLoad();

  if (editExpId) {
    // Modo edición: reemplazar preservando id y fechaCreacion
    const idx = todos.findIndex(x => x.id === editExpId);
    if (idx === -1) return sN('Experimento no encontrado para editar', true);
    todos[idx] = { ...todos[idx], nombre, volBase, frascos };
    expSave(todos);
    expCerrarModal();
    expRenderLista(frmId);
    expActualizarBadge(frmId);
    sN('✏️ Experimento actualizado: ' + editExpId);
  } else {
    // Modo creación
    todos.push({ id: expNxtId(), formulaId: frmId, nombre, fechaCreacion: now(), volBase, frascos });
    expSave(todos);
    expCerrarModal();
    expRenderLista(frmId);
    expActualizarBadge(frmId);
    sN('🔬 Experimento guardado');
  }
}

// Bridge: CILAB llama esta función al sincronizar colonización.
// Actualiza inputs vacíos en el DOM y merge notas al in-memory state.
function _segSyncColonizacionFromCilab(frmId, fecha, notasDesdeCilab) {
  _segGetSectionTbodys(frmId).forEach(function(tbody) {
    Array.prototype.forEach.call(tbody.querySelectorAll('tr.seg-row'), function(row) {
      const colonEl = row.querySelector('.seg-colonizacion');
      if (!colonEl || colonEl.value) return;
      colonEl.value = fecha.length === 10 ? fecha + 'T12:00' : fecha.slice(0, 16);
    });
  });
  if (Array.isArray(notasDesdeCilab) && notasDesdeCilab.length) {
    const existing = SEG.seguimientoNotas[frmId] || [];
    const seenKeys = new Set(existing.map(function(n) { return n.ts + '||' + n.texto; }));
    const nuevas = notasDesdeCilab.filter(function(n) { return !seenKeys.has(n.ts + '||' + n.texto); });
    if (nuevas.length) {
      SEG.seguimientoNotas[frmId] = existing.concat(nuevas);
      segRenderSeguimientoNotas(frmId);
    }
  }
}

// ════════════════════════════════════════════
// EXPOSICIÓN AL SCOPE GLOBAL
// Solo lo que la UI (onclick/oninput/onchange) o main.js necesitan.
// ════════════════════════════════════════════
Object.assign(window, {
  // Init y acciones de primer nivel (index + main.js)
  ciInit,
  ciSubTab,
  ciExportExcel,
  ciNewFrmAddRow,
  ciNewFrmCalc,
  ciSaveNewFrm,
  renderCfg,
  closeFloatingDropdown,
  exportData,
  exportFormulaJSON,
  fddFilter,
  fddSelectItem,
  importData,
  resetSystem,
  // Puentes CI → CILAB (ingredientes son propiedad de CILAB)
  ciIrACilab,
  ciIrACilabCrear,
  ciIrACilabEditar,

  // Formulas CI (handlers inline generados dinamicamente)
  frmToggle,
  frmToggleEdit,
  frmEditField,
  delFrmFromCI,
  toggleColAlign,
  toggleAspFilter,
  dupFrmWithProjection,
  frmAddIngRow,
  frmDelIngRow,
  frmIngShowSelect,
  frmIngQtyChange,
  frmIngProyChange,

  // Drag & Drop
  dndStart,
  dndOver,
  dndDrop,
  dndEnd,

  // Seguimiento / SEG (handlers inline generados dinamicamente)
  segAddRow,
  segAddRowFrasco,
  segRemoveRow,
  segGuardarTandas,
  segToggleEditMode,
  segOnChangeGenetica,
  segOnChangePlacas,
  segOnChangeContaminados,
  segOnChangeColonizacion,
  segActualizarResumen,
  segAddSeguimientoNota,
  segOnImgSelect,
  segQuitarImgTemp,
  segEliminarImagenNota,
  segVerImagenNota,
  segToggleFotoPanel,
  segAgregarFotosFila,
  segEliminarFotoFila,
  segLightbox,
  segEditarNota,
  segEliminarSeguimientoNota,

  // Trazabilidad de tanda (reporte 📊 + cierre)
  segAbrirReporteTanda,
  segCerrarReporte,

  // Drawers inline de seguimiento (Sesión 2)
  segToggleNoteDrawer,
  segDwSetEstado,
  segAddNotaDrawer,

  // Seguimiento CI — sección colapsable
  segToggleSeguimiento,

  // Tanda cards — notas y fotos (Sesión 1)
  segToggleTandaCard,
  segAddNotaCard,
  segTC_onImgSelect,
  segTC_quitarImg,

  // Conocimiento — handoff a CILAB (botón 🌱 por tanda)
  segAbrirObsCrecimiento,

  // Bridge CILAB→CI: sync colonización + cultivos en vivo
  _segSyncColonizacionFromCilab,
  _ciSyncCultivosFromSeg,

  // Cultivos CI — UI / handlers (Fase 3b + Fase 4)
  renderCultivosTab,
  ciFiltrarCultivos,
  ciDescartarCultivo,
  ciEditarCultivoNotas,
  ciToggleConsumos,

  // Inóculo CI en SEG
  segOnChangeInoculoCi,
  segRefrescarSelectoresInoculo,

  // Archivo de fórmulas
  ciArchivarFormula,
  ciRestaurarFormula,
  ciToggleMostrarArchivadas,

  // Trazabilidad fórmulas
  getFormulaById: (id) => { const f = gDB(K.forms).find(x => x.id === id); return f ? JSON.parse(JSON.stringify(f)) : null; },

  // Migración de datos
  ciMigrarSnapshotsIngredientes,
  ciMigrarBioIngredientes,

  // Seguimiento CI colapsable
  segToggleSeguimiento,

  // Dashboard / Formulación
  ciRenderDashboard,
  ciDashOpenFormula,
  ciCargarComoBase,
  ciDashRenderDetalle,
  ciDashVolverGrid,

  // Modo Experimento — panel, lista, tabla
  expTogglePanel,
  expToggleTabla,
  expEliminar,
  expEditar,

  // Modo Experimento — modal de creación
  expAbrirCrear,
  expCerrarModal,
  expOnNFrascosChange,
  expAgregarExtra,
  expQuitarExtra,
  expGuardar,
});

  // Limpieza de módulo
  window.onModuleUnload = function () {
    // Persistir genéticas y tandas antes de que el DOM sea destruido.
    // Con dataset.geneticaId como fuente de verdad, es safe aunque el select
    // todavía no tenga opciones (race condition timing).
    Object.keys(_segAutoSaveTimers).forEach(id => {
      clearTimeout(_segAutoSaveTimers[id]);
      delete _segAutoSaveTimers[id];
    });
    Array.from(document.querySelectorAll('[id^="segTbody-"]')).forEach(tb => {
      const id = _segFrmIdFromTbodyId(tb.id);
      if (id) { try { segGuardarTandas(id, true); } catch (e) {} }
    });

    if (_ciDocClickHandler)         document.removeEventListener('click',   _ciDocClickHandler);
    if (_ciDocKeyHandler)           document.removeEventListener('keydown', _ciDocKeyHandler);
    if (_ciCultivosChangedListener) window.removeEventListener('ci-cultivos-changed', _ciCultivosChangedListener);
    if (_ciIngsChangedListener)     window.removeEventListener('cilab-ings-changed', _ciIngsChangedListener);
    if (_ciFormulasChangedListener) window.removeEventListener('cilab-formulas-changed', _ciFormulasChangedListener);
    if (_ciStorageListener)         window.removeEventListener('storage', _ciStorageListener);

    document.querySelectorAll('#ci-exp-modal').forEach(el => {
      if (el.parentNode === document.body) document.body.removeChild(el);
    });

    if (ciNewPieChart) ciNewPieChart.destroy();
  };

  // Auto-inicialización si el módulo se carga solo (fuera del loader main.js)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ciInit);
  } else {
    ciInit();
  }

}()); // ← cierre IIFE principal ci_app.js
