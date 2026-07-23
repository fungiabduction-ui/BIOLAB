# Grid de fases en CILAB Conocimiento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el scrubber de arrastre + la lista vertical con formularios (registro de fases en CILAB Conocimiento) por un único grid de chips clickeables — un click marca "ahora", un segundo click en un chip ya marcado abre una franja de edición inline.

**Architecture:** Todo vive en `cilab/cilab_conocimiento.js` (+ un cambio de 3 líneas en `cilab/cilab_app.js` para sacar un hook de cleanup que deja de hacer falta). No hay cambios de schema — `bl2_crec_fases` mantiene exactamente la misma forma. Se agregan funciones nuevas de render+escritura para modo individual y modo batch, se actualizan 3 call sites existentes, y se elimina todo el código del mecanismo de arrastre y de los formularios inline viejos.

**Tech Stack:** JS vanilla (sin build step), localStorage, sin framework de testing — verificación vía scripts Node standalone que extraen las funciones reales del archivo (mismo patrón ya usado en esta sesión para MEJ-0015).

**Spec de referencia:** `docs/superpowers/specs/2026-07-22-cilab-fases-grid-design.md`

---

### Task 1: CSS del grid de chips

**Files:**
- Modify: `cilab/cilab_styles.css`

- [ ] **Step 1: Agregar las clases nuevas al final del archivo**

Abrir `cilab/cilab_styles.css`, ir al final del archivo, y agregar:

```css

/* ── Fases: grid de un click (reemplaza scrubber + lista vertical, 2026-07-23) ── */
.cre-fase-grid-wrap { margin-bottom: 14px; }
.cre-fase-hoy { float: right; font-size: 9px; color: #FFD700; font-weight: 700; }
.cre-fase-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 6px;
}
.cre-fase-chip {
  border-radius: 6px; padding: 8px 9px; cursor: pointer;
  border: 1.5px solid transparent; transition: all 0.12s; user-select: none;
}
.cre-fase-chip:hover { filter: brightness(1.15); transform: translateY(-1px); }
.cre-fase-chip--pending { border: 1.5px dashed rgba(255,255,255,0.18); }
.cre-fase-chip--inferred { border: 1.5px dashed rgba(255,255,255,0.1); opacity: 0.6; }
.cre-fase-chip--staged { border: 1.5px dashed var(--ac2); background: rgba(124,111,255,0.08); color: var(--ac2); }
.cre-fase-chip-name { font-size: 11px; font-weight: 700; display: flex; align-items: center; gap: 5px; }
.cre-fase-chip-auto {
  font-size: 7px; background: rgba(0,204,51,0.12); color: #00CC33;
  border: 1px solid rgba(0,204,51,0.3); border-radius: 3px; padding: 1px 4px;
}
.cre-fase-chip-meta { font-size: 9px; color: inherit; opacity: 0.85; margin-top: 3px; font-family: 'JetBrains Mono', monospace; }
.cre-fase-chip-meta--pending { color: var(--tx3); }

.cre-fase-edit-strip {
  margin-top: 8px; padding: 10px; background: var(--bg-secondary);
  border: 1px solid var(--ac2); border-radius: 6px;
}
.cre-fase-edit-title { font-size: 10px; font-weight: 700; color: var(--ac2); margin-bottom: 8px; }
.cre-fase-edit-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; font-size: 10px; }
.cre-fase-edit-row label { color: var(--tx3); width: 90px; flex-shrink: 0; }
.cre-fase-edit-row input {
  background: var(--bg); border: 1px solid var(--border); color: var(--tx);
  border-radius: 3px; padding: 4px 6px; font-size: 10px; font-family: 'JetBrains Mono', monospace; flex: 1;
}
.cre-fase-edit-actions { display: flex; gap: 6px; margin-top: 4px; }
```

- [ ] **Step 2: Verificar que el CSS es válido**

Run: `node -e "require('fs').readFileSync('cilab/cilab_styles.css','utf8')" && echo OK`
Expected: `OK` (esto solo confirma que el archivo se puede leer; no hay linter de CSS en el proyecto — la verificación visual real es en el navegador, Task 10).

- [ ] **Step 3: Commit**

```bash
git add cilab/cilab_styles.css
git commit -m "feat(cilab): CSS del grid de chips para fases (reemplazo del scrubber)"
```

---

### Task 2: Escritura individual — marcar fase "ahora" (con test)

**Files:**
- Modify: `cilab/cilab_conocimiento.js`
- Test: script Node standalone en el scratchpad de sesión (no forma parte del repo)

- [ ] **Step 1: Escribir el test que reproduce el comportamiento esperado**

Crear `test_fase_register_now.js` (en el scratchpad de sesión) con las dependencias mínimas stubbeadas y la función real extraída del archivo por regex — igual patrón que `repro_mej0015.js` usado antes en esta sesión:

```js
const fs = require('fs');
const CONOC_PATH = 'cilab/cilab_conocimiento.js';
const src = fs.readFileSync(CONOC_PATH, 'utf8');

function extractFn(name) {
  const re = new RegExp('function ' + name + '\\([\\s\\S]*?\\n\\}\\n');
  const m = src.match(re);
  if (!m) throw new Error('no encontrada: ' + name);
  return m[0];
}

// ── Stubs mínimos ──
let store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = v; },
};
global.now = () => new Date().toISOString();
global._creLiftCleared = () => {};
global._creLogFase = (...args) => { global.__logCalls.push(args); };
global._creSyncColonizacionToCI = (...args) => { global.__syncCalls.push(args); };
global.creColonizacionCierrePrompt = (...args) => { global.__cierreCalls.push(args); };
global.notif = () => {};
global._creGetPlacasFromCI = () => null;
global._sp = { frasco: null };
global._FASES_DEF = [
  { id: 'inoculacion', typicalDay: 0 },
  { id: 'actividad_metabolica', typicalDay: 2 },
  { id: 'primeros_filamentos', typicalDay: 5 },
  { id: 'crecimiento_activo', typicalDay: 10 },
  { id: 'rizomorfismo_evaluable', typicalDay: 18 },
  { id: 'colonizacion_completa', typicalDay: 28 },
];

// Funciones reales de fases, extraídas del archivo (ya existen, no cambian en esta task)
eval(extractFn('_creFasesKey'));
eval(extractFn('_creFasesRead'));
eval(extractFn('_creFasesWrite'));
eval(extractFn('_creInoculacionDate'));
eval(extractFn('_creGetInoculacionDate'));

// Función NUEVA bajo test (todavía no existe — este require debe fallar en el paso 2)
eval(extractFn('_creFaseRegisterNow'));

function resetStubs() {
  store = {};
  global.__logCalls = [];
  global.__syncCalls = [];
  global.__cierreCalls = [];
}

// ── Caso 1: fase intermedia, con inoculación registrada hace 5 días ──
resetStubs();
const hace5dias = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
_creFasesWrite('CI-TEST', 'GEN-1', [{ fase: 'inoculacion', dia: 0, fecha: hace5dias, ts: hace5dias + 'T10:00:00.000Z' }]);
_creFaseRegisterNow('CI-TEST', 'GEN-1', 'primeros_filamentos');
const fases1 = _creFasesRead('CI-TEST', 'GEN-1');
const entry1 = fases1.find(f => f.fase === 'primeros_filamentos');
console.log('Caso 1 — fase intermedia:');
console.log('  dia esperado ~5, real:', entry1.dia);
console.log('  fecha (hoy):', entry1.fecha, '| ts presente:', !!entry1.ts);
console.log('  orden preservado:', fases1.map(f => f.fase).join(',') === 'inoculacion,primeros_filamentos' ? 'OK' : 'FALLO');
console.log('  _creLogFase llamado:', global.__logCalls.length === 1 ? 'OK' : 'FALLO (' + global.__logCalls.length + ')');
console.log('  _creSyncColonizacionToCI NO llamado (no es colonización):', global.__syncCalls.length === 0 ? 'OK' : 'FALLO');

// ── Caso 2: colonización completa — debe disparar sync a CI y el prompt de cierre ──
resetStubs();
_creFasesWrite('CI-TEST', 'GEN-2', [{ fase: 'inoculacion', dia: 0, fecha: hace5dias, ts: hace5dias + 'T10:00:00.000Z' }]);
_creFaseRegisterNow('CI-TEST', 'GEN-2', 'colonizacion_completa');
console.log('\nCaso 2 — colonización completa:');
console.log('  _creSyncColonizacionToCI llamado:', global.__syncCalls.length === 1 ? 'OK' : 'FALLO');

// ── Caso 3: re-click sobre una fase ya registrada no debe duplicar la entrada ──
resetStubs();
_creFasesWrite('CI-TEST', 'GEN-3', [{ fase: 'inoculacion', dia: 0, fecha: hace5dias, ts: hace5dias + 'T10:00:00.000Z' }]);
_creFaseRegisterNow('CI-TEST', 'GEN-3', 'primeros_filamentos');
_creFaseRegisterNow('CI-TEST', 'GEN-3', 'primeros_filamentos');
const fases3 = _creFasesRead('CI-TEST', 'GEN-3').filter(f => f.fase === 'primeros_filamentos');
console.log('\nCaso 3 — sin duplicados en re-click:', fases3.length === 1 ? 'OK' : 'FALLO (' + fases3.length + ' entradas)');
```

- [ ] **Step 2: Correr el test y confirmar que falla** (la función todavía no existe)

Run: `node test_fase_register_now.js`
Expected: `Error: no encontrada: _creFaseRegisterNow`

- [ ] **Step 3: Implementar `_creFaseRegisterNow`**

En `cilab/cilab_conocimiento.js`, agregar la función nueva inmediatamente **después** de `creEditFaseCancel` (la última función del bloque viejo de fases — se borra en Task 8, por ahora conviven):

```js
function _creFaseRegisterNow(formulaId, geneticaId, faseId) {
  _creLiftCleared(formulaId);
  var fases    = _creFasesRead(formulaId, geneticaId);
  var todayIso = new Date().toISOString().slice(0, 10);
  var tsNow    = now();

  var entry;
  if (faseId === 'inoculacion') {
    entry = { fase: 'inoculacion', dia: 0, fecha: todayIso, ts: tsNow, auto: false };
  } else {
    var inocDate = _creInoculacionDate(formulaId, geneticaId);
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
  _creFasesWrite(formulaId, geneticaId, fases);
  _creLogFase(formulaId, geneticaId, faseId, entry.dia, entry.fecha, false, _sp.frasco);

  if (faseId === 'colonizacion_completa') {
    _creSyncColonizacionToCI(formulaId, geneticaId, entry.fecha);
    setTimeout(function() { creColonizacionCierrePrompt(formulaId, geneticaId, entry.dia); }, 80);
  }

  notif('Fase registrada · Día ' + entry.dia, 'info');
  _creRenderCepasSection(formulaId);
}
```

- [ ] **Step 4: Correr el test y confirmar que pasa**

Run: `node test_fase_register_now.js`
Expected: los 3 casos imprimen `OK` en cada chequeo (dia esperado ~5, fecha de hoy, ts presente, orden preservado, log/sync llamados correctamente, sin duplicados).

Nota: `_creRenderCepasSection` no está stubbeada — el test la va a llamar contra el `window`/`document` reales que no existen en Node. Si tira error de referencia, agregar `global._creRenderCepasSection = () => {};` a los stubs del Step 1 antes de correr — no es parte de la lógica bajo test.

- [ ] **Step 5: `node --check` sobre el archivo completo**

Run: `node --check cilab/cilab_conocimiento.js`
Expected: sin salida (sintaxis OK)

- [ ] **Step 6: Commit**

```bash
git add cilab/cilab_conocimiento.js
git commit -m "feat(cilab): _creFaseRegisterNow — escritura de fase con un click, verificada"
```

---

### Task 3: Edición individual — franja inline (con test)

**Files:**
- Modify: `cilab/cilab_conocimiento.js`

- [ ] **Step 1: Escribir el test**

Crear `test_fase_edit_save.js`, mismo patrón de stubs que Task 2 (copiar el bloque de stubs + extractFn), agregando:

```js
eval(extractFn('creFaseEditSave'));

// Simula los <input> del DOM que la función lee por id
global.document = {
  getElementById: function(id) {
    return global.__inputs[id] || null;
  },
};

resetStubs();
const hace10dias = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
_creFasesWrite('CI-TEST', 'GEN-1', [
  { fase: 'inoculacion', dia: 0, fecha: hace10dias, ts: hace10dias + 'T10:00:00.000Z' },
  { fase: 'primeros_filamentos', dia: 5, fecha: hace10dias, ts: hace10dias + 'T10:00:00.000Z', totalPlacas: 8 },
]);

// Corrige la fecha 2 días para adelante y la hora, agrega placas observadas
const fechaCorregida = new Date(Date.now() - 8 * 86400000).toISOString().slice(0, 10);
global.__inputs = {
  'cre-fase-edit-fecha-primeros_filamentos': { value: fechaCorregida },
  'cre-fase-edit-hora-primeros_filamentos':  { value: '14:30' },
  'cre-fase-edit-placas-primeros_filamentos': { value: '6' },
};

creFaseEditSave('CI-TEST', 'GEN-1', 'primeros_filamentos');

const fases = _creFasesRead('CI-TEST', 'GEN-1');
const edited = fases.find(f => f.fase === 'primeros_filamentos');
console.log('dia recalculado a 2:', edited.dia === 2 ? 'OK' : 'FALLO (' + edited.dia + ')');
console.log('fecha actualizada:', edited.fecha === fechaCorregida ? 'OK' : 'FALLO');
console.log('hora en ts (14:30):', new Date(edited.ts).getHours() === 14 && new Date(edited.ts).getMinutes() === 30 ? 'OK' : 'FALLO');
console.log('placasObservadas actualizado a 6:', edited.placasObservadas === 6 ? 'OK' : 'FALLO (' + edited.placasObservadas + ')');
console.log('_creLogFase llamado con isEdit=true:', global.__logCalls.length === 1 && global.__logCalls[0][5] === true ? 'OK' : 'FALLO');

// Caso de guarda: sin fecha en el input, no debe tocar nada
resetStubs();
_creFasesWrite('CI-TEST', 'GEN-4', [{ fase: 'primeros_filamentos', dia: 3, fecha: hace10dias, ts: hace10dias + 'T09:00:00.000Z' }]);
global.__inputs = { 'cre-fase-edit-fecha-primeros_filamentos': { value: '' } };
creFaseEditSave('CI-TEST', 'GEN-4', 'primeros_filamentos');
const fasesUnchanged = _creFasesRead('CI-TEST', 'GEN-4');
console.log('\nGuard sin fecha — no modifica nada:', fasesUnchanged[0].dia === 3 ? 'OK' : 'FALLO');
```

- [ ] **Step 2: Correr y confirmar que falla**

Run: `node test_fase_edit_save.js`
Expected: `Error: no encontrada: creFaseEditSave`

- [ ] **Step 3: Implementar `creFaseEditCancel` y `creFaseEditSave`**

Agregar después de `_creFaseRegisterNow`:

```js
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

  var fases = _creFasesRead(formulaId, geneticaId);
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
    var inocDate = _creInoculacionDate(formulaId, geneticaId);
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

  _creFasesWrite(formulaId, geneticaId, fases);
  var edited = fases.find(function(f) { return f.fase === faseId; });
  _creLogFase(formulaId, geneticaId, faseId, edited ? edited.dia : 0, edited ? edited.fecha : fechaStr, true, _sp.frasco);

  if (faseId === 'colonizacion_completa') {
    _creSyncColonizacionToCI(formulaId, geneticaId, fechaStr);
  }

  notif('Fecha calibrada · Día ' + (edited ? edited.dia : 0), 'info');
  _sp.faseEditOpen = null;
  _creRenderCepasSection(formulaId);
}
```

- [ ] **Step 4: Correr y confirmar que pasa**

Run: `node test_fase_edit_save.js`
Expected: todos los chequeos imprimen `OK` (recuerda agregar el stub de `_creRenderCepasSection` si tira error de referencia, igual que en Task 2).

- [ ] **Step 5: `node --check`**

Run: `node --check cilab/cilab_conocimiento.js`
Expected: sin salida

- [ ] **Step 6: Commit**

```bash
git add cilab/cilab_conocimiento.js
git commit -m "feat(cilab): creFaseEditSave/Cancel — edición inline de fecha+hora, verificada"
```

---

### Task 4: Render del grid + dispatcher de click (individual)

**Files:**
- Modify: `cilab/cilab_conocimiento.js`

No hay test Node para esta task — son funciones que arman strings de HTML, sin lógica de negocio propia (ya verificada en Task 2/3). Se confirman con `node --check` acá y con la app real corriendo en Task 10.

- [ ] **Step 1: Agregar `_creFaseEditStripHTML`**

Agregar después de `creFaseEditSave`:

```js
function _creFaseEditStripHTML(formulaId, geneticaId, faseId) {
  var fases = _creFasesRead(formulaId, geneticaId);
  var reg = fases.find(function(f) { return f.fase === faseId; });
  if (!reg) return '';
  var def = _FASES_DEF.find(function(f) { return f.id === faseId; });
  var faseIdE = esc(faseId);

  var fechaVal = reg.fecha || new Date().toISOString().slice(0, 10);
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
    + '<button class="clab-btn clab-btn-sm" onclick="creFaseEditCancel(\'' + esc(formulaId) + '\',\'' + esc(geneticaId) + '\')">Cancelar</button>'
    + '</div></div>';
  return html;
}
```

- [ ] **Step 2: Agregar `_creFasesGridHTML`**

Agregar después de `_creFaseEditStripHTML`:

```js
function _creFasesGridHTML(formulaId, geneticaId) {
  if (!geneticaId) return '<div style="padding:16px;color:var(--tx3);font-size:12px">Seleccioná una cepa.</div>';

  _creAutoFillInoculacion(formulaId, geneticaId);
  _creAutoFillColonizacion(formulaId, geneticaId);
  _creAutoFillInferredFases(formulaId, geneticaId);

  var fases  = _creFasesRead(formulaId, geneticaId);
  var regMap = {};
  fases.forEach(function(f) { regMap[f.fase] = f; });
  var diasAct = _creDiasSinceInoc(formulaId, geneticaId);
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
      var dd = reg.fecha.split('-');
      fechaFmt = dd[2] + '/' + dd[1];
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
```

- [ ] **Step 3: Agregar el dispatcher `creFaseGridClick`**

```js
function creFaseGridClick(formulaId, geneticaId, faseId) {
  var fases = _creFasesRead(formulaId, geneticaId);
  var reg = fases.find(function(f) { return f.fase === faseId; });
  if (!reg || reg.auto === 'inferred') {
    _sp.faseEditOpen = null;
    _creFaseRegisterNow(formulaId, geneticaId, faseId); // re-renderiza internamente
  } else {
    _sp.faseEditOpen = (_sp.faseEditOpen === faseId) ? null : faseId;
    _creRenderCepasSection(formulaId);
  }
}
```

- [ ] **Step 4: `node --check`**

Run: `node --check cilab/cilab_conocimiento.js`
Expected: sin salida

- [ ] **Step 5: Commit**

```bash
git add cilab/cilab_conocimiento.js
git commit -m "feat(cilab): grid de fases individual — render + dispatcher de click"
```

---

### Task 5: Cablear el grid individual + estado `_sp.faseEditOpen`

**Files:**
- Modify: `cilab/cilab_conocimiento.js`

- [ ] **Step 1: Agregar `faseEditOpen` a la declaración inicial de `_sp`**

Buscar el bloque `var _sp = {` (cerca de la línea 4017) y agregar el campo nuevo junto a los demás:

```js
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
```

(dejar el resto del objeto tal cual está — solo se agrega la línea `faseEditOpen`, buscando el texto `expandedCepaId: null,         // cepa individually expanded (not in batch)` como ancla exacta para no depender del número de línea.)

- [ ] **Step 2: Resetear `faseEditOpen` en `_spReset`**

Buscar `function _spReset(formulaId) {` y agregar la línea `_sp.faseEditOpen = null;` junto a `_sp.expandedCepaId = null;`:

```js
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
```

- [ ] **Step 3: Resetear `faseEditOpen` en `creToggleCepaExpand` y `creSetScoringFrasco`**

En `creToggleCepaExpand`, agregar `_sp.faseEditOpen = null;` como primera línea del cuerpo de la función (antes del `if (_sp.expandedCepaId === geneticaId)`).

En `creSetScoringFrasco`, agregar `_sp.faseEditOpen = null;` junto a las otras líneas de reset (`_sp.score = null; _sp.tipo = null; ...`).

- [ ] **Step 4: Reemplazar la llamada al scrubber por la llamada al grid**

Buscar (dentro de la función que arma la card de cepa, el bloque `if (isExpanded) { ... }`):

```js
  if (isExpanded) {
    html += '<div class="cre-cepa-card-body">';
    html += _creFasesScrubberHTML(formulaId, cepa.id);
    html += _creScoringFormHTML(formulaId, cepa.id, fRecs);
    html += '</div>';
  }
```

Reemplazar por:

```js
  if (isExpanded) {
    html += '<div class="cre-cepa-card-body">';
    html += _creFasesGridHTML(formulaId, cepa.id);
    html += _creScoringFormHTML(formulaId, cepa.id, fRecs);
    html += '</div>';
  }
```

- [ ] **Step 5: Sacar la columna "Fases" de `_creScoringFormHTML`**

Buscar dentro de `_creScoringFormHTML`:

```js
  // ── SCORE izquierda | FASES derecha ─────────────────────────────────────
  html += '<div class="cre-2col-layout">';

  html += '<div class="cre-2col-section">';
  html += '<div class="cre-3col-title">Score</div>';
  html += _creScoringScoreTabHTML(formulaId, geneticaId, fRecs);
  html += '</div>';

  html += '<div class="cre-2col-section">';
  html += '<div class="cre-3col-title">Fases <span class="cre-3col-count">' + doneCnt + '/' + _FASES_DEF.length + '</span></div>';
  html += _creMetabolicFasesHTML(formulaId, geneticaId);
  html += '</div>';

  html += '</div>';
```

Reemplazar por (el grid de fases ya se renderiza arriba, en la card — esta sección pasa a ser solo Score, ancho completo):

```js
  // ── Score (Fases se renderiza arriba, en la card — ver _creFasesGridHTML) ──
  html += '<div class="cre-2col-section" style="width:100%">';
  html += '<div class="cre-3col-title">Score</div>';
  html += _creScoringScoreTabHTML(formulaId, geneticaId, fRecs);
  html += '</div>';
```

Nota: la variable `doneCnt` (calculada más arriba en la misma función a partir de `fases.length`) queda sin uso después de este cambio — si el linter/editor la marca como no usada, borrar también las 3 líneas que la calculan (`var fases = ...`, `var doneCnt = fases.length;`, y el `if (geneticaId) { _creAutoFillInoculacion... }` que las precede) **solo si** no se usan en ningún otro lado de la función — confirmar con `grep -n "doneCnt\|_creAutoFillInoculacion" cilab/cilab_conocimiento.js` antes de tocar nada más, porque `_creAutoFillInoculacion`/`_creAutoFillColonizacion`/`_creAutoFillInferredFases` siguen haciendo falta (ahora las llama `_creFasesGridHTML`, no hace falta duplicarlas acá).

- [ ] **Step 6: `node --check`**

Run: `node --check cilab/cilab_conocimiento.js`
Expected: sin salida

- [ ] **Step 7: Commit**

```bash
git add cilab/cilab_conocimiento.js
git commit -m "feat(cilab): cablea el grid de fases individual en la card de cepa"
```

---

### Task 6: Escritura batch — marcar fase "ahora" en N cepas (con test)

**Files:**
- Modify: `cilab/cilab_conocimiento.js`

- [ ] **Step 1: Escribir el test**

Crear `test_fase_batch_register.js`, mismo patrón de stubs. Además de los stubs de Task 2, agregar:

```js
global._creRenderLogSection = () => {};
global._sp = { frasco: null, selected: new Set(['|" + "|GEN-1', '|" + "|GEN-2']), batchFasePos: {} };
```

Ojo: las keys de `_sp.selected` tienen el formato `expId|frascoLabel|geneticaId` — para modo Base (sin frasco) `expId`/`frascoLabel` van vacíos, quedando `||GEN-1`. Usar ese formato exacto:

```js
global._sp = { frasco: null, selected: new Set(['||GEN-1', '||GEN-2']), batchFasePos: {} };

eval(extractFn('_creBatchFaseRegisterNow'));

resetStubs();
const hace5dias = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
const hace8dias = new Date(Date.now() - 8 * 86400000).toISOString().slice(0, 10);
// dos cepas con fecha de inoculación DISTINTA — el dia resultante debe ser distinto para cada una
_creFasesWrite('CI-TEST', 'GEN-1', [{ fase: 'inoculacion', dia: 0, fecha: hace5dias, ts: hace5dias + 'T10:00:00.000Z' }]);
_creFasesWrite('CI-TEST', 'GEN-2', [{ fase: 'inoculacion', dia: 0, fecha: hace8dias, ts: hace8dias + 'T10:00:00.000Z' }]);

_creBatchFaseRegisterNow('CI-TEST', 'primeros_filamentos');

const e1 = _creFasesRead('CI-TEST', 'GEN-1').find(f => f.fase === 'primeros_filamentos');
const e2 = _creFasesRead('CI-TEST', 'GEN-2').find(f => f.fase === 'primeros_filamentos');
console.log('GEN-1 dia ~5:', e1.dia === 5 ? 'OK' : 'FALLO (' + e1.dia + ')');
console.log('GEN-2 dia ~8:', e2.dia === 8 ? 'OK' : 'FALLO (' + e2.dia + ')');
console.log('misma fecha (hoy) para ambas:', e1.fecha === e2.fecha ? 'OK' : 'FALLO');
console.log('_creLogFase llamado 2 veces (una por cepa):', global.__logCalls.length === 2 ? 'OK' : 'FALLO (' + global.__logCalls.length + ')');
console.log('batchFasePos marcado:', _sp.batchFasePos.primeros_filamentos === true ? 'OK' : 'FALLO');
```

- [ ] **Step 2: Correr y confirmar que falla**

Run: `node test_fase_batch_register.js`
Expected: `Error: no encontrada: _creBatchFaseRegisterNow`

- [ ] **Step 3: Implementar `_creBatchFaseRegisterNow`**

Agregar después de `creFaseGridClick` (Task 4):

```js
function _creBatchFaseRegisterNow(formulaId, faseId) {
  var order    = _FASES_DEF.map(function(f) { return f.id; });
  var todayIso = new Date().toISOString().slice(0, 10);
  var tsNow    = now();
  var saved    = 0;

  _sp.selected.forEach(function(key) {
    var gId = key.split('|')[2];
    if (!gId) return;
    var fases    = _creFasesRead(formulaId, gId);
    var inocDate = _creInoculacionDate(formulaId, gId);
    var dia = 0;
    if (inocDate) {
      var d0 = new Date(inocDate); d0.setHours(0, 0, 0, 0);
      var d1 = new Date(todayIso); d1.setHours(0, 0, 0, 0);
      dia = Math.max(0, Math.floor((d1 - d0) / 86400000));
    }
    var entry = { fase: faseId, dia: dia, fecha: todayIso, ts: tsNow };
    if (faseId !== 'inoculacion' && faseId !== 'colonizacion_completa') {
      var _fCtxB = _sp.frasco;
      entry.placasObservadas = null;
      entry.totalPlacas = _creGetPlacasFromCI(formulaId, gId, _fCtxB ? _fCtxB.expId : null, _fCtxB ? _fCtxB.frascoLabel : null);
    }
    fases = fases.filter(function(f) { return f.fase !== faseId; });
    fases.push(entry);
    fases.sort(function(a, b) { return order.indexOf(a.fase) - order.indexOf(b.fase); });
    _creFasesWrite(formulaId, gId, fases);
    _creLogFase(formulaId, gId, faseId, dia, todayIso, false, _sp.frasco);
    if (faseId === 'colonizacion_completa') {
      _creSyncColonizacionToCI(formulaId, gId, todayIso);
    }
    saved++;
  });

  _sp.batchFasePos[faseId] = true;
  notif('Fase registrada en ' + saved + ' cepas', 'info');
  _creRenderCepasSection(formulaId);
  if (_sp.formulaId) _creRenderLogSection(_sp.formulaId);
}
```

- [ ] **Step 4: Correr y confirmar que pasa**

Run: `node test_fase_batch_register.js`
Expected: todos los chequeos `OK` (agregar stubs de `_creRenderCepasSection`/`_creRenderLogSection` si hace falta).

- [ ] **Step 5: `node --check`**

Run: `node --check cilab/cilab_conocimiento.js`

- [ ] **Step 6: Commit**

```bash
git add cilab/cilab_conocimiento.js
git commit -m "feat(cilab): _creBatchFaseRegisterNow — marcar fase ahora en N cepas, verificada"
```

---

### Task 7: Render + cableado del grid batch

**Files:**
- Modify: `cilab/cilab_conocimiento.js`

- [ ] **Step 1: Agregar `_creBatchControlsRerender`, `_creBatchFasesGridHTML` y `creFaseGridBatchClick`**

Agregar después de `_creBatchFaseRegisterNow`:

```js
function _creBatchControlsRerender(formulaId) {
  var bw = document.getElementById('cre-batch-ctrl-' + esc(formulaId));
  if (bw) bw.innerHTML = _creBatchControlsHTML(formulaId);
}

function _creBatchFasesGridHTML(formulaId) {
  var fIdE     = esc(formulaId);
  var savedPos = _sp.batchFasePos || {};
  var html = '<div class="cre-fase-grid-wrap" style="margin-top:10px">';
  html += '<div class="cre-3col-title">Registrar fase en batch <span class="cre-3col-count">' + _sp.selected.size + ' cepas</span></div>';
  html += '<div class="cre-fase-grid">';
  _FASES_DEF.forEach(function(def) {
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
```

- [ ] **Step 2: Reemplazar el body de `creBatchFaseConfirm`**

Buscar:

```js
function creBatchFaseConfirm(formulaId) {
  var sf = _sp.batchStagedFase;
  if (!sf) return;
  _sp.batchStagedFase = null;
  _creBatchFaseScrubSave(formulaId, sf.faseId, sf.dia);
}
```

Reemplazar por:

```js
function creBatchFaseConfirm(formulaId) {
  var sf = _sp.batchStagedFase;
  if (!sf) return;
  _sp.batchStagedFase = null;
  _creBatchFaseRegisterNow(formulaId, sf.faseId);
}
```

- [ ] **Step 3: Arreglar `creBatchFaseCancel`** (bug preexistente de id encontrado al tocar esta zona: usaba `'cre-batch-controls-'`, un id que nunca existió — el contenedor real es `'cre-batch-ctrl-'`. Efecto real del bug: cancelar una fase stageada en batch no hacía desaparecer la barra de confirmación hasta que algún otro evento forzara un re-render completo.)

Buscar:

```js
function creBatchFaseCancel(formulaId) {
  _sp.batchStagedFase = null;
  var bw = document.getElementById('cre-batch-controls-' + esc(formulaId));
  if (bw) bw.innerHTML = _creBatchControlsHTML(formulaId);
}
```

Reemplazar por:

```js
function creBatchFaseCancel(formulaId) {
  _sp.batchStagedFase = null;
  _creBatchControlsRerender(formulaId);
}
```

- [ ] **Step 4: Actualizar el label de la barra de confirmación en `_creBatchControlsHTML`**

Buscar (dentro de `_creBatchControlsHTML`):

```js
  if (_sp.batchStagedFase) {
    var _sf = _sp.batchStagedFase;
    var _sfDef = _FASES_DEF.find(function(f) { return f.id === _sf.faseId; });
    var _sfCol = _sfDef ? _sfDef.color : '#FFD700';
    var _sfLbl = _sfDef ? _sfDef.label : _sf.faseId;
    html += '<div class="cre-batch-fase-confirm">'
      + '<span style="color:' + _sfCol + ';font-weight:700">' + esc(_sfLbl) + ' · D' + _sf.dia + '</span>'
```

Reemplazar la línea del `<span>` (el resto del bloque —los dos botones de confirmar/cancelar— queda igual, no hace falta tocarlo):

```js
    html += '<div class="cre-batch-fase-confirm">'
      + '<span style="color:' + _sfCol + ';font-weight:700">' + esc(_sfLbl) + ' · ahora</span>'
```

- [ ] **Step 5: Reemplazar la llamada al scrubber batch**

Buscar dentro de `_creBatchControlsHTML`:

```js
  html += _creBatchFasesScrubberHTML(formulaId);
```

Reemplazar por:

```js
  html += _creBatchFasesGridHTML(formulaId);
```

- [ ] **Step 6: `node --check`**

Run: `node --check cilab/cilab_conocimiento.js`

- [ ] **Step 7: Commit**

```bash
git add cilab/cilab_conocimiento.js
git commit -m "feat(cilab): grid de fases batch + fix de id en creBatchFaseCancel"
```

---

### Task 8: Eliminar el código viejo (scrubber + lista vertical + forms)

**Files:**
- Modify: `cilab/cilab_conocimiento.js`

- [ ] **Step 1: Confirmar que nada más llama a las funciones que se van a borrar**

Run:
```bash
grep -n "_creFasesScrubberHTML\|creScrubStart\|_creOnScrubMove\|_creOnScrubEnd\|creFaseScrubSave\|creDeleteFaseFromScrubber\|creBatchScrubStart\|_creBatchFaseScrubSave\|_creBatchFasesScrubberHTML\|_creMetabolicFasesHTML\|creRegisterFase\b\|creRegisterFaseConfirm\|creRegisterFaseCancel\|creEditFase\b\|creEditFaseConfirm\|creEditFaseCancel" cilab/cilab_conocimiento.js
```
Expected: cada nombre aparece **solo** en su propia definición (`function NOMBRE(...)`) y en el bloque `Object.assign(window, {...})` — ningún otro call site. Si aparece en otro lado, parar y revisar antes de borrar (puede ser un caller que no se migró en las tasks anteriores).

- [ ] **Step 2: Borrar las funciones del mecanismo de arrastre**

Borrar, completas (desde `function NOMBRE(` hasta su `}` de cierre), en este orden — cada una es una función independiente, no hay anidamiento entre ellas:

- `_creFasesScrubberHTML` (empieza `function _creFasesScrubberHTML(formulaId, geneticaId) {`, termina justo antes de `function creScrubStart`)
- `creScrubStart`
- el comentario + `window._creScrubCleanup = function () { ... };` (bloque completo, empieza en el comentario `// Limpieza de emergencia...`)
- `_creOnScrubMove`
- `_creOnScrubEnd`
- `creFaseScrubSave`
- `creDeleteFaseFromScrubber`
- `creBatchScrubStart`
- `creWipeFormulaFases` **NO se borra** — sigue existiendo, no toca el drag. Verificar que quedó intacto después de borrar sus vecinas.
- `_creBatchFaseScrubSave`
- `_creBatchFasesScrubberHTML`

- [ ] **Step 3: Borrar la lista vertical con formularios**

Borrar completas:

- `_creMetabolicFasesHTML`
- `creRegisterFase`
- `creRegisterFaseConfirm`
- `creRegisterFaseCancel`
- `creEditFase`
- `creEditFaseConfirm`
- `creEditFaseCancel`

(`creColonizacionCierrePrompt`, justo después de `creEditFaseCancel` en el archivo original, **NO se borra** — se sigue usando desde `_creFaseRegisterNow`. Confirmar que queda intacta.)

- [ ] **Step 4: Actualizar `Object.assign(window, {...})`**

Buscar el bloque `Object.assign(window, {` cerca del final del archivo y:

Sacar estas líneas:
```
  creScrubStart,
  creBatchScrubStart,
  creFaseScrubSave,
  creDeleteFaseFromScrubber,
```
```
  creRegisterFase,
  creRegisterFaseConfirm,
  creRegisterFaseCancel,
  creEditFase,
  creEditFaseConfirm,
  creEditFaseCancel,
```

Agregar (en el mismo lugar donde estaban las de arriba, o donde quede prolijo):
```
  creFaseGridClick,
  creFaseEditSave,
  creFaseEditCancel,
  creFaseGridBatchClick,
```

Dejar tal cual (sin tocar): `creBatchFaseConfirm`, `creBatchFaseCancel`, `creWipeFormulaFases`, `creColonizacionCierrePrompt` — siguen expuestas, solo cambió su implementación interna (o no cambió, en el caso de las últimas dos).

- [ ] **Step 5: Confirmar que no quedó nada huérfano**

Run:
```bash
grep -n "function _creFasesScrubberHTML\|function creScrubStart\|function _creOnScrubMove\|function _creOnScrubEnd\|function creFaseScrubSave\|function creDeleteFaseFromScrubber\|function creBatchScrubStart\|function _creBatchFaseScrubSave\|function _creBatchFasesScrubberHTML\|function _creMetabolicFasesHTML\|function creRegisterFase\|function creEditFase\|_creScrubCleanup" cilab/cilab_conocimiento.js
```
Expected: sin resultados (0 matches).

- [ ] **Step 6: `node --check`**

Run: `node --check cilab/cilab_conocimiento.js`
Expected: sin salida

- [ ] **Step 7: Commit**

```bash
git add cilab/cilab_conocimiento.js
git commit -m "refactor(cilab): elimina scrubber de arrastre y lista vertical de fases (reemplazados por el grid)"
```

---

### Task 9: Sacar el hook de cleanup en `cilab_app.js`

**Files:**
- Modify: `cilab/cilab_app.js`

- [ ] **Step 1: Borrar la llamada al hook**

Buscar en `cilab/cilab_app.js`:

```js
  // Cancela un drag de fase-scrubber en curso (cilab_conocimiento.js) — si no se
  // limpia acá, sus listeners pointermove/pointerup quedan colgados en document
  // para siempre. Ver window._creScrubCleanup para el detalle del bug.
  if (typeof window._creScrubCleanup === 'function') {
    window._creScrubCleanup();
  }
```

Borrar el bloque entero (comentario incluido — ya no aplica, no queda ningún drag que limpiar).

- [ ] **Step 2: Confirmar que no queda ninguna referencia**

Run: `grep -rn "_creScrubCleanup" cilab/`
Expected: sin resultados

- [ ] **Step 3: `node --check`**

Run: `node --check cilab/cilab_app.js`
Expected: sin salida

- [ ] **Step 4: Commit**

```bash
git add cilab/cilab_app.js
git commit -m "chore(cilab): saca el hook de cleanup del drag de fases, ya no existe"
```

---

### Task 10: Verificación final end-to-end + manual

**Files:** ninguno (solo verificación)

- [ ] **Step 1: `node --check` sobre los dos archivos tocados**

Run: `node --check cilab/cilab_conocimiento.js && node --check cilab/cilab_app.js && echo AMBOS_OK`
Expected: `AMBOS_OK`

- [ ] **Step 2: Re-correr los 3 scripts de test de las Tasks 2/3/6 contra el archivo YA con el código viejo borrado**

Run:
```bash
node test_fase_register_now.js
node test_fase_edit_save.js
node test_fase_batch_register.js
```
Expected: los mismos `OK` que antes — confirma que borrar el código viejo (Task 8) no rompió ninguna de las funciones nuevas por un mal corte de límites de función.

- [ ] **Step 3: Grep final de sanity — ningún caller apunta a algo que ya no existe**

Run:
```bash
grep -n "onclick=\"cre" cilab/cilab_conocimiento.js | grep -oP 'onclick="\K[a-zA-Z_]+' | sort -u > /tmp/onclick_calls.txt
grep -oP '^function \K[a-zA-Z_]+' cilab/cilab_conocimiento.js | sort -u > /tmp/defined_fns.txt
comm -23 /tmp/onclick_calls.txt /tmp/defined_fns.txt
```
Expected: sin salida, o solo nombres que se exponen vía `Object.assign(window,{...})` con otro nombre a la izquierda (ej. `creEnrichObs: enrichObs` — revisar a mano cualquier resultado, no asumir que es un error).

- [ ] **Step 4: Verificación manual en la app real**

Esto es un cambio de interacción de UI — los tests de Node confirman la lógica de escritura, no cómo se siente usarlo. Iniciar el servidor local (`start-server.bat` o `python -m http.server` en la raíz del repo), abrir CILAB → Conocimiento, y confirmar a mano:

1. Expandir una cepa con fases pendientes → aparece el grid de 6 chips (no el scrubber viejo, no la lista vertical).
2. Click en un chip pendiente → pasa a "hecho" al toque, sin formulario.
3. Click en ese mismo chip ya hecho → abre la franja de edición debajo del grid con fecha/hora precargadas.
4. Cambiar la hora y Guardar → el chip refleja la hora nueva.
5. Cancelar en la franja de edición → no cambia nada, se cierra.
6. Seleccionar 2+ cepas (checkbox de batch) → aparece el grid batch dentro del panel de controles de batch. Click en un chip pendiente → aparece la barra "· ahora" con Confirmar/Cancelar. Confirmar → las cepas seleccionadas quedan con esa fase registrada.
7. Registrar "Colonización completa" en modo individual → confirmar que sigue apareciendo el prompt de cierre de ciclo (`creColonizacionCierrePrompt`) después de guardar.
8. Con una fórmula que tenga colonización lenta registrada (>15 días) y un score <7 en el panel de Score de la misma cepa → confirmar que el "Score Compuesto" sigue mostrando la penalización (verifica que `_creRenderCepasSection` está refrescando también el preview de Score, no solo el grid).

- [ ] **Step 5: Limpiar los scripts de test del working directory** (no forman parte del repo)

Run: `rm -f test_fase_register_now.js test_fase_edit_save.js test_fase_batch_register.js`

- [ ] **Step 6: Actualizar CLAUDE.md con el invariante nuevo**

Agregar a `CLAUDE.md` (sección CILAB CONOCIMIENTO), después del párrafo de "Score compuesto":

```markdown
**Fases — grid de un click (2026-07-23):** reemplaza el scrubber de arrastre y la lista vertical con formularios que existían antes. `_creFasesGridHTML()` es la única función de render (llamada una vez por card de cepa expandida) — un click en un chip pendiente escribe inmediatamente (`_creFaseRegisterNow`, fecha=hoy, hora real del click vía `ts`), un click en un chip ya hecho abre una franja de edición inline (`_creFaseEditStripHTML`/`creFaseEditSave`). Sin cambios de schema: `ts` (timestamp ISO completo) ya existía en cada entrada de `bl2_crec_fases` desde siempre, solo que nunca se mostraba — la hora del chip sale de ahí, `fecha` se sigue guardando como `YYYY-MM-DD` puro. Modo batch (`_creBatchFasesGridHTML`) mantiene un paso de stage+confirm (`_sp.batchStagedFase`) antes de aplicar a N cepas — a diferencia del individual, que escribe directo.
```

- [ ] **Step 7: Commit final**

```bash
git add CLAUDE.md
git commit -m "docs: documenta el invariante del grid de fases en CLAUDE.md"
```

---

## Self-review

**Cobertura del spec:** los 6 estados de chip (pendiente/hecho/hecho+auto/inferido, individual y batch), la franja de edición inline, el "placas observadas" opcional, la preservación de `_creLogFase`/`_creSyncColonizacionToCI`/`creColonizacionCierrePrompt`/`_creColonizacionStats`, y el cleanup del hook de drag — todos tienen una task. La eliminación completa del código viejo está en Task 8, verificada por grep antes y después.

**Bug encontrado en el camino (Task 7, Step 3):** `creBatchFaseCancel` apuntaba a un id de DOM que nunca existió (`cre-batch-controls-` vs el real `cre-batch-ctrl-`) — se corrige de paso, documentado explícitamente en el step para que no se pierda en el commit.

**Consistencia de nombres:** `_creFaseRegisterNow`/`creFaseEditSave`/`creFaseEditCancel`/`creFaseGridClick` (individual) vs `_creBatchFaseRegisterNow`/`creFaseGridBatchClick` (batch) — mismos nombres usados de punta a punta entre la task que los crea y la task que los cablea/exporta.
