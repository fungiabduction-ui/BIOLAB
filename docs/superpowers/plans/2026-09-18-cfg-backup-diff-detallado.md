# CFG — Diff detallado de backups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el resumen de módulos afectados de "¿Qué cambió?" (`cfg/cfg_app.js`) por un panel inline expandible con detalle real campo-por-campo de qué cambió entre un backup y el inmediato anterior.

**Architecture:** Un motor de diff genérico y recursivo (funciones puras, sin DOM) que detecta arrays-de-registros por su campo `id`/`rowId` y baja recursivamente hasta 4 niveles; una capa de render que arma HTML agrupando cambios idénticos con `<details>` nativo; y la modificación mínima de `ghDiffBackupModulos`/`ghListBackups` para insertar/togglear una fila `<tr>` con el resultado.

**Tech Stack:** JS vanilla (sin build, sin módulos ES — todo dentro de la IIFE existente de `cfg/cfg_app.js`), CSS plano en `cfg/cfg_styles.css`. Verificación con Node (funciones puras extraídas por marcador) y Chrome DevTools MCP (render visual).

**Spec:** `docs/superpowers/specs/2026-09-18-cfg-backup-diff-detallado-design.md`

---

### Task 1: Motor de diff genérico (funciones puras)

**Files:**
- Modify: `cfg/cfg_app.js` — insertar antes de la línea 703 (justo antes de `var _bkListaOrdenada`)

- [ ] **Step 1: Insertar el motor de diff**

Insertar este bloque completo en `cfg/cfg_app.js`, inmediatamente antes de la línea `var _bkListaOrdenada = [];` (línea 703 actual):

```js
  // ════════════════════════════════════════════════════════════
  // DIFF ENGINE — genérico, sin dependencias de DOM (testeable en Node
  // extrayendo el bloque entre los marcadores BK_DIFF_ENGINE_START/END).
  // Detecta arrays-de-registros por su campo id/rowId y compara
  // recursivamente — no hay tabla de config por key, cualquier key
  // nueva con esa forma queda cubierta sin tocar este código.
  // Ver docs/superpowers/specs/2026-09-18-cfg-backup-diff-detallado-design.md
  // ════════════════════════════════════════════════════════════
  // === BK_DIFF_ENGINE_START ===
  function _bkIdField(val) {
    if (!Array.isArray(val) || !val.length) return null;
    if (val.every(function (x) { return x && typeof x === 'object' && x.id != null; })) return 'id';
    if (val.every(function (x) { return x && typeof x === 'object' && x.rowId != null; })) return 'rowId';
    return null;
  }

  function _bkTrunc(v) {
    const s = v === undefined ? '(vacío)' : JSON.stringify(v);
    return s.length > 200 ? s.slice(0, 200) + '…' : s;
  }

  // Compara dos valores arbitrarios. depth = profundidad de recursión actual.
  // Devuelve null si son iguales, o uno de:
  //   { kind:'idArray', idField, added:[ids], removed:[ids], modified:[{id, fields:[{name,changeType,sub}]}] }
  //   { kind:'fields', fields:[{name,changeType,sub}] }
  //   { kind:'block', oldText, newText }
  function _bkDiffValue(oldVal, newVal, depth) {
    if (JSON.stringify(oldVal) === JSON.stringify(newVal)) return null;
    if (depth > 4) return { kind: 'block', oldText: _bkTrunc(oldVal), newText: _bkTrunc(newVal) };

    const oldIsArrLike = Array.isArray(oldVal) || oldVal == null;
    const newIsArrLike = Array.isArray(newVal) || newVal == null;
    const idField = _bkIdField(newVal) || _bkIdField(oldVal);
    if (idField && oldIsArrLike && newIsArrLike) {
      const oldArr = oldVal || [], newArr = newVal || [];
      const oldMap = {}; oldArr.forEach(function (x) { oldMap[String(x[idField])] = x; });
      const newMap = {}; newArr.forEach(function (x) { newMap[String(x[idField])] = x; });
      const added = Object.keys(newMap).filter(function (id) { return !(id in oldMap); });
      const removed = Object.keys(oldMap).filter(function (id) { return !(id in newMap); });
      const modified = [];
      Object.keys(newMap).forEach(function (id) {
        if (!(id in oldMap)) return;
        const fields = _bkDiffFields(oldMap[id], newMap[id], depth + 1);
        if (fields.length) modified.push({ id: id, fields: fields });
      });
      return { kind: 'idArray', idField: idField, added: added, removed: removed, modified: modified };
    }

    const oldIsObj = oldVal && typeof oldVal === 'object' && !Array.isArray(oldVal);
    const newIsObj = newVal && typeof newVal === 'object' && !Array.isArray(newVal);
    if (oldIsObj && newIsObj) {
      return { kind: 'fields', fields: _bkDiffFields(oldVal, newVal, depth + 1) };
    }

    return { kind: 'block', oldText: _bkTrunc(oldVal), newText: _bkTrunc(newVal) };
  }

  function _bkDiffFields(oldObj, newObj, depth) {
    oldObj = oldObj || {}; newObj = newObj || {};
    const seen = {};
    const keys = [];
    Object.keys(oldObj).concat(Object.keys(newObj)).forEach(function (k) {
      if (!seen[k]) { seen[k] = true; keys.push(k); }
    });
    const out = [];
    keys.forEach(function (k) {
      const hadOld = Object.prototype.hasOwnProperty.call(oldObj, k);
      const hasNew = Object.prototype.hasOwnProperty.call(newObj, k);
      const sub = _bkDiffValue(oldObj[k], newObj[k], depth);
      if (!sub) return;
      out.push({ name: k, changeType: !hadOld ? 'added' : (!hasNew ? 'removed' : 'changed'), sub: sub });
    });
    return out;
  }

  // Agrupa entradas `modified` de un idArray por firma estructural (campos +
  // tipo de cambio, SIN el valor) — así 36 registros con +campo color
  // (valores distintos entre sí) quedan en un solo grupo, no 36 líneas.
  function _bkGroupModified(modified) {
    const groups = {}; const order = [];
    modified.forEach(function (m) {
      const sig = m.fields.map(function (f) { return f.name + ':' + f.changeType; }).sort().join('|');
      if (!groups[sig]) { groups[sig] = []; order.push(sig); }
      groups[sig].push(m);
    });
    return order.map(function (sig) { return { sig: sig, items: groups[sig] }; });
  }

  // Entry point por key de nivel superior — created/deleted no tienen "antes"
  // real para diffear campo a campo.
  function _bkDiffKey(oldVal, newVal) {
    if (oldVal === undefined) return { kind: 'created' };
    if (newVal === undefined) return { kind: 'deleted' };
    return _bkDiffValue(oldVal, newVal, 0);
  }
  // === BK_DIFF_ENGINE_END ===

```

- [ ] **Step 2: Commit**

```bash
git add cfg/cfg_app.js
git commit -m "feat(cfg): motor de diff generico recursivo para backups (sin usar aun)"
```

---

### Task 2: Verificar el motor de diff contra datos reales (Node, sin navegador)

**Files:**
- Create (scratchpad, NO se commitea): script temporal de verificación

- [ ] **Step 1: Confirmar que los 2 backups reales de hoy están disponibles**

```bash
ls "biolab-autobackup-FECHA_18-09-2026_HORA_11-21-55.json"
ls "C:/Users/JET/AppData/Local/Temp/claude/c--Users-JET-Desktop-MOBY-DICK-biolab-app/db7cb8e5-15df-4884-b8a7-4dcf8ca40693/scratchpad/biolab-backup-13-02-20.json"
```

Expected: ambos archivos existen (ya se descargaron en esta sesión — el segundo es el backup real de GitHub a las 13:02:20, bajado vía Blobs API).

- [ ] **Step 2: Escribir el script de verificación**

Crear `C:/Users/JET/AppData/Local/Temp/claude/c--Users-JET-Desktop-MOBY-DICK-biolab-app/db7cb8e5-15df-4884-b8a7-4dcf8ca40693/scratchpad/verify_diff_engine.js`:

```js
const fs = require('fs');

// Extrae el bloque entre los marcadores del archivo real y lo evalúa —
// así el test corre EXACTAMENTE el código que va a correr en el navegador,
// no una reimplementación aparte que pueda divergir.
const src = fs.readFileSync('cfg/cfg_app.js', 'utf8');
const start = src.indexOf('// === BK_DIFF_ENGINE_START ===');
const end = src.indexOf('// === BK_DIFF_ENGINE_END ===');
if (start === -1 || end === -1) throw new Error('Marcadores no encontrados en cfg_app.js');
const engineSrc = src.slice(start, end) +
  '\nmodule.exports = { _bkDiffKey, _bkGroupModified };';
const Module = require('module');
const m = new Module('diff-engine-under-test');
m._compile(engineSrc, 'diff-engine-under-test.js');
const { _bkDiffKey, _bkGroupModified } = m.exports;

const oldD = JSON.parse(fs.readFileSync('biolab-autobackup-FECHA_18-09-2026_HORA_11-21-55.json', 'utf8'));
const newD = JSON.parse(fs.readFileSync('C:/Users/JET/AppData/Local/Temp/claude/c--Users-JET-Desktop-MOBY-DICK-biolab-app/db7cb8e5-15df-4884-b8a7-4dcf8ca40693/scratchpad/biolab-backup-13-02-20.json', 'utf8'));

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('FALLO:', msg); } else { console.log('OK:', msg); } }

// Aserción 1: su_lotes -> 36 modificados, todos agrupables en UN solo grupo
// con firma "color:added" (campo agregado, no "changed" - los lotes no
// tenian color antes).
{
  const d = _bkDiffKey(JSON.parse(oldD['su_lotes']), JSON.parse(newD['su_lotes']));
  assert(d.kind === 'idArray', 'su_lotes debe ser idArray, fue ' + d.kind);
  assert(d.modified.length === 36, 'su_lotes debe tener 36 modificados, tuvo ' + d.modified.length);
  const groups = _bkGroupModified(d.modified);
  assert(groups.length === 1, 'los 36 cambios de su_lotes deben agruparse en 1 grupo, dieron ' + groups.length);
  assert(groups[0] && groups[0].sig === 'color:added', 'la firma del grupo debe ser "color:added", fue ' + (groups[0] && groups[0].sig));
  assert(groups[0] && groups[0].items.length === 36, 'el grupo debe tener 36 items, tuvo ' + (groups[0] && groups[0].items.length));
}

// Aserción 2: su_color_seq y el flag de migracion -> "created" (no existian antes)
{
  const d1 = _bkDiffKey(oldD['su_color_seq'], newD['su_color_seq']);
  assert(d1.kind === 'created', 'su_color_seq debe ser created, fue ' + d1.kind);
  const d2 = _bkDiffKey(oldD['biolab_migracion_su_color_backfill_v1'], newD['biolab_migracion_su_color_backfill_v1']);
  assert(d2.kind === 'created', 'el flag de migracion debe ser created, fue ' + d2.kind);
}

// Aserción 3: bl2_forms -> 1 modificado (CI-0022), bajando a `ingredientes`
// (array anidado con id) y encontrando ING-0032.qty: 5 -> 5000.
{
  const d = _bkDiffKey(JSON.parse(oldD['bl2_forms']), JSON.parse(newD['bl2_forms']));
  assert(d.kind === 'idArray', 'bl2_forms debe ser idArray, fue ' + d.kind);
  assert(d.modified.length === 1, 'bl2_forms debe tener 1 modificado, tuvo ' + d.modified.length);
  const rec = d.modified[0];
  assert(rec && rec.id === 'CI-0022', 'el registro modificado debe ser CI-0022, fue ' + (rec && rec.id));
  const ingredientesField = rec && rec.fields.find(function (f) { return f.name === 'ingredientes'; });
  assert(!!ingredientesField, 'CI-0022 debe tener el campo ingredientes modificado');
  assert(ingredientesField && ingredientesField.sub.kind === 'idArray', 'ingredientes debe diffear como idArray anidado');
  const ingMod = ingredientesField && ingredientesField.sub.modified[0];
  assert(ingMod && ingMod.id === 'ING-0032', 'el ingrediente modificado debe ser ING-0032, fue ' + (ingMod && ingMod.id));
  const qtyField = ingMod && ingMod.fields.find(function (f) { return f.name === 'qty'; });
  assert(qtyField && qtyField.sub.kind === 'block', 'qty debe diffear como block (primitivo)');
  assert(qtyField && qtyField.sub.oldText === '5' && qtyField.sub.newText === '5000', 'qty debe ir de 5 a 5000, fue ' + (qtyField && qtyField.sub.oldText) + ' -> ' + (qtyField && qtyField.sub.newText));
}

console.log(failures ? ('\n' + failures + ' ASERCION(ES) FALLARON') : '\nTODAS LAS ASERCIONES PASARON');
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Ejecutar y confirmar que pasa**

```bash
cd "c:/Users/JET/Desktop/MOBY DICK/biolab-app" && node "C:/Users/JET/AppData/Local/Temp/claude/c--Users-JET-Desktop-MOBY-DICK-biolab-app/db7cb8e5-15df-4884-b8a7-4dcf8ca40693/scratchpad/verify_diff_engine.js"
```

Expected: las 8 líneas `OK:` y al final `TODAS LAS ASERCIONES PASARON`, exit code 0. Si algo falla, corregir `_bkDiffValue`/`_bkDiffFields`/`_bkGroupModified` en `cfg/cfg_app.js` (Task 1) antes de seguir — no avanzar a Task 3 con el motor sin verificar.

No hay commit en esta tarea — el script vive en el scratchpad de la sesión, no en el repo (es verificación puntual, no un test suite que el proyecto vaya a mantener; no hay test runner en este repo).

---

### Task 3: Render del panel + modificar `ghDiffBackupModulos`/`ghListBackups`

**Files:**
- Modify: `cfg/cfg_app.js:703-777` (bloque `_bkListaOrdenada` / `ghDiffBackupModulos` / `ghListBackups` actuales)

- [ ] **Step 1: Insertar las funciones de render, justo después del `_bkDiffKey` del Task 1 (antes de `var _bkListaOrdenada`)**

```js
  // ── Render del panel de diff (HTML), separado del motor de arriba —
  // el motor no sabe nada de HTML/DOM, esto sí.
  function _bkRenderFieldsList(fields) {
    return '<ul class="cfg-diff-fields">' + fields.map(function (f) {
      return '<li><b>' + esc(f.name) + '</b>: ' + _bkRenderSub(f.sub) + '</li>';
    }).join('') + '</ul>';
  }

  function _bkRenderSub(sub) {
    if (sub.kind === 'block') return esc(sub.oldText) + ' → ' + esc(sub.newText);
    if (sub.kind === 'fields') return _bkRenderFieldsList(sub.fields);
    const bits = [];
    if (sub.added.length) bits.push('+' + sub.added.length + ': ' + esc(sub.added.join(', ')));
    if (sub.removed.length) bits.push('−' + sub.removed.length + ': ' + esc(sub.removed.join(', ')));
    if (sub.modified.length) bits.push(_bkGroupModified(sub.modified).map(_bkRenderGroup).join(''));
    return bits.join(' ');
  }

  function _bkRenderGroup(g) {
    const n = g.items.length;
    const label = g.sig.split('|').map(function (part) {
      const bits = part.split(':'); const name = bits[0], type = bits[1];
      const verbo = type === 'added' ? '+campo' : (type === 'removed' ? '−campo' : 'cambió campo');
      return verbo + ' `' + name + '`';
    }).join(', ');
    if (n === 1) {
      const m = g.items[0];
      return '<div class="cfg-diff-mod-item"><b>' + esc(m.id) + '</b>' + _bkRenderFieldsList(m.fields) + '</div>';
    }
    // Si TODOS los registros del grupo comparten el mismo valor para un campo
    // (ej. un flag booleano seteado igual en los N), se muestra inline en vez
    // de forzar a expandir para verlo.
    const fieldNames = g.items[0].fields.map(function (f) { return f.name; });
    const allSameByField = {};
    fieldNames.forEach(function (name) {
      const first = g.items[0].fields.find(function (f) { return f.name === name; });
      const same = g.items.every(function (m) {
        const f = m.fields.find(function (f) { return f.name === name; });
        return f && JSON.stringify(f.sub) === JSON.stringify(first.sub);
      });
      if (same) allSameByField[name] = first.sub;
    });
    const inlineBits = Object.keys(allSameByField).map(function (name) {
      return esc(name) + ': ' + _bkRenderSub(allSameByField[name]);
    }).join(', ');
    const itemsHtml = g.items.map(function (m) {
      return '<div class="cfg-diff-mod-item"><b>' + esc(m.id) + '</b>' + _bkRenderFieldsList(m.fields) + '</div>';
    }).join('');
    return '<details class="cfg-diff-group"><summary>' + n + ' registros: ' + esc(label) +
      (inlineBits ? ' (' + inlineBits + ')' : '') + '</summary>' + itemsHtml + '</details>';
  }

  function _bkRenderKeyDiff(key, d) {
    if (d.kind === 'created') return '<div class="cfg-diff-key"><code>' + esc(key) + '</code> — <span class="cfg-diff-added">creado</span></div>';
    if (d.kind === 'deleted') return '<div class="cfg-diff-key"><code>' + esc(key) + '</code> — <span class="cfg-diff-removed">eliminado</span></div>';
    if (d.kind === 'block') return '<div class="cfg-diff-key"><code>' + esc(key) + '</code> — cambió: <span class="cfg-diff-old">' + esc(d.oldText) + '</span> → <span class="cfg-diff-new">' + esc(d.newText) + '</span></div>';
    if (d.kind === 'fields') return '<div class="cfg-diff-key"><code>' + esc(key) + '</code>' + _bkRenderFieldsList(d.fields) + '</div>';
    // idArray
    const parts = [];
    if (d.added.length) parts.push('<div class="cfg-diff-added">+' + d.added.length + ' agregado(s): ' + esc(d.added.join(', ')) + '</div>');
    if (d.removed.length) parts.push('<div class="cfg-diff-removed">−' + d.removed.length + ' eliminado(s): ' + esc(d.removed.join(', ')) + '</div>');
    if (d.modified.length) _bkGroupModified(d.modified).forEach(function (g) { parts.push(_bkRenderGroup(g)); });
    return '<div class="cfg-diff-key"><code>' + esc(key) + '</code>' + parts.join('') + '</div>';
  }

  function _bkRenderDiffPanel(cambiadas, dataAnterior, dataActual) {
    const porModulo = {};
    Array.from(cambiadas).sort().forEach(function (k) {
      const mod = _bkKeyToModulo(k);
      (porModulo[mod] = porModulo[mod] || []).push(k);
    });
    return Object.keys(porModulo).sort().map(function (mod) {
      const keysHtml = porModulo[mod].map(function (k) {
        return _bkRenderKeyDiff(k, _bkDiffKey(dataAnterior[k], dataActual[k]));
      }).join('');
      return '<div class="cfg-diff-mod"><div class="cfg-diff-mod-title">' + esc(mod) + '</div>' + keysHtml + '</div>';
    }).join('');
  }

```

- [ ] **Step 2: Reemplazar `_bkListaOrdenada`/`ghDiffBackupModulos` completos (líneas 703-730 actuales) por esta versión**

```js
  var _bkListaOrdenada = []; // cache en memoria de la última lista renderizada, para el diff on-demand
  var _bkDiffCache = {}; // idx -> {cambiadas, dataAnterior, dataActual}, evita re-descargar al togglear

  async function ghDiffBackupModulos(idx, btnEl) {
    const existing = document.getElementById('gh-bk-diffrow-' + idx);
    if (existing) {
      const oculto = existing.style.display === 'none';
      existing.style.display = oculto ? '' : 'none';
      btnEl.textContent = oculto ? '▼ Ocultar cambios' : '▶ Ver cambios';
      return;
    }
    const actual = _bkListaOrdenada[idx];
    const anterior = _bkListaOrdenada[idx + 1]; // el array está ordenado más-nuevo-primero
    if (!anterior) { btnEl.outerHTML = '<span style="font-size:11px;color:var(--tx3)">es el más viejo — sin backup anterior para comparar</span>'; return; }
    btnEl.disabled = true; btnEl.textContent = '🔄...';
    try {
      let cached = _bkDiffCache[idx];
      if (!cached) {
        const [dataActual, dataAnterior] = await Promise.all([
          _bkDecodeBlob(actual.sha), _bkDecodeBlob(anterior.sha)
        ]);
        const keysActual = new Set(Object.keys(dataActual).filter(k => !k.startsWith('_')));
        const keysAnterior = new Set(Object.keys(dataAnterior).filter(k => !k.startsWith('_')));
        const cambiadas = new Set();
        keysActual.forEach(k => {
          if (!keysAnterior.has(k) || JSON.stringify(dataActual[k]) !== JSON.stringify(dataAnterior[k])) cambiadas.add(k);
        });
        keysAnterior.forEach(k => { if (!keysActual.has(k)) cambiadas.add(k); });
        cached = { cambiadas, dataAnterior, dataActual };
        _bkDiffCache[idx] = cached;
      }
      if (!cached.cambiadas.size) {
        btnEl.outerHTML = '<span style="font-size:11px;color:var(--tx3)">sin cambios vs. el anterior</span>';
        return;
      }
      const html = _bkRenderDiffPanel(cached.cambiadas, cached.dataAnterior, cached.dataActual);
      const fila = document.getElementById('gh-bk-row-' + idx);
      const tr = document.createElement('tr');
      tr.id = 'gh-bk-diffrow-' + idx;
      tr.innerHTML = '<td colspan="5" class="cfg-diff-row">' + html + '</td>';
      fila.parentNode.insertBefore(tr, fila.nextSibling);
      btnEl.disabled = false; btnEl.textContent = '▼ Ocultar cambios';
    } catch (e) {
      btnEl.disabled = false; btnEl.textContent = '✕ error, reintentar';
    }
  }

```

- [ ] **Step 3: En `ghListBackups`, resetear el cache de diff junto con `_bkListaOrdenada` y agregar `id` a cada fila**

Buscar esta línea (dentro de `ghListBackups`, justo después de ordenar `files`):
```js
      _bkListaOrdenada = files;
```
Reemplazar por:
```js
      _bkListaOrdenada = files;
      _bkDiffCache = {};
```

Buscar el `return \`<tr>\`` dentro del `.map((f, idx) => { ... })` de `ghListBackups` (línea 764 actual) y agregarle el `id` de fila:
```js
          return `<tr>
```
Reemplazar por:
```js
          return `<tr id="gh-bk-row-${idx}">
```

- [ ] **Step 4: Commit**

```bash
git add cfg/cfg_app.js
git commit -m "feat(cfg): panel inline con diff detallado campo-a-campo en backups de GitHub"
```

---

### Task 4: CSS del panel de diff

**Files:**
- Modify: `cfg/cfg_styles.css`

- [ ] **Step 1: Agregar al final del archivo**

```css
/* ── Panel de diff detallado de backups (¿Qué cambió?) ── */
.cfg-diff-row { background: var(--bg-secondary); padding: 10px 14px; }
.cfg-diff-mod { margin-bottom: 10px; }
.cfg-diff-mod:last-child { margin-bottom: 0; }
.cfg-diff-mod-title { font-weight: 600; font-size: 12px; color: var(--text-light); margin-bottom: 4px; }
.cfg-diff-key { font-size: 11px; color: var(--text-muted); margin: 4px 0 4px 10px; }
.cfg-diff-key code { color: var(--text-light); }
.cfg-diff-fields { margin: 2px 0 2px 16px; padding: 0; list-style: none; font-size: 11px; }
.cfg-diff-fields li { margin: 2px 0; }
.cfg-diff-added { color: var(--wn); }
.cfg-diff-removed { color: var(--er); }
.cfg-diff-old { color: var(--er); text-decoration: line-through; }
.cfg-diff-new { color: var(--wn); }
.cfg-diff-group summary { cursor: pointer; font-size: 11px; color: var(--text-muted); margin: 4px 0; }
.cfg-diff-group summary:hover { color: var(--text-light); }
.cfg-diff-mod-item { margin: 4px 0 4px 14px; font-size: 11px; }
```

- [ ] **Step 2: Commit**

```bash
git add cfg/cfg_styles.css
git commit -m "style(cfg): CSS del panel de diff detallado de backups"
```

---

### Task 5: Verificación visual (Chrome real, sin depender de un token de GitHub)

**Por qué así y no probando el flujo completo en vivo:** el flujo completo (listar backups reales) necesita el token de GitHub del usuario cargado en su navegador — no algo que se deba fabricar ni pegar acá. Lo que cambió en este plan es SOLO el render (`_bkRenderDiffPanel` y el resto de las funciones de Task 3) y el CSS — la descarga (`_bkDecodeBlob`/`ghApiBlob`) y el resto del flujo de `ghListBackups` no se tocaron. Se verifica el render en aislamiento, con los datos reales de hoy, en un Chrome real.

**Files:**
- Create (scratchpad, NO se commitea): harness HTML de verificación

- [ ] **Step 1: Generar el HTML del panel con datos reales usando el motor ya verificado en Task 2**

```bash
cd "c:/Users/JET/Desktop/MOBY DICK/biolab-app" && node -e "
const fs = require('fs');
const src = fs.readFileSync('cfg/cfg_app.js', 'utf8');
const start = src.indexOf('// === BK_DIFF_ENGINE_START ===');
const end = src.indexOf('// === BK_DIFF_ENGINE_END ===');
// Extrae motor + funciones de render (viven justo despues del motor,
// antes de '_bkListaOrdenada') + esc() (linea ~45).
const escSrc = src.match(/function esc\\(s\\)[^\\n]*\\n/)[0];
const renderEnd = src.indexOf('var _bkListaOrdenada');
const engineAndRender = escSrc + src.slice(start, renderEnd);
const full = engineAndRender + '\\nmodule.exports = { _bkDiffKey, _bkRenderDiffPanel, _bkKeyToModulo };';
const Module = require('module');
const m = new Module('render-under-test');
m._compile(full, 'render-under-test.js');
const { _bkRenderDiffPanel } = m.exports;

const oldD = JSON.parse(fs.readFileSync('biolab-autobackup-FECHA_18-09-2026_HORA_11-21-55.json','utf8'));
const newD = JSON.parse(fs.readFileSync('C:/Users/JET/AppData/Local/Temp/claude/c--Users-JET-Desktop-MOBY-DICK-biolab-app/db7cb8e5-15df-4884-b8a7-4dcf8ca40693/scratchpad/biolab-backup-13-02-20.json','utf8'));
const dataAnterior = {}; Object.keys(oldD).forEach(k => { try { dataAnterior[k] = JSON.parse(oldD[k]); } catch(e) { dataAnterior[k] = oldD[k]; } });
const dataActual = {}; Object.keys(newD).forEach(k => { try { dataActual[k] = JSON.parse(newD[k]); } catch(e) { dataActual[k] = newD[k]; } });
const cambiadas = new Set(['su_lotes','su_color_seq','biolab_migracion_su_color_backfill_v1','bl2_forms']);
const panelHtml = _bkRenderDiffPanel(cambiadas, dataAnterior, dataActual);

const cssPath = 'cfg/cfg_styles.css';
const page = '<!DOCTYPE html><html><head><meta charset=\"utf-8\">' +
  '<style>' + fs.readFileSync(cssPath,'utf8') + '</style>' +
  '<style>body{background:var(--bg-secondary,#171A21);padding:24px;font-family:sans-serif}</style>' +
  '</head><body><table><tbody><tr><td colspan=5>' + panelHtml + '</td></tr></tbody></table></body></html>';
fs.writeFileSync('C:/Users/JET/AppData/Local/Temp/claude/c--Users-JET-Desktop-MOBY-DICK-biolab-app/db7cb8e5-15df-4884-b8a7-4dcf8ca40693/scratchpad/diff_panel_preview.html', page);
console.log('escrito, ' + panelHtml.length + ' bytes de HTML de panel');
"
```

Expected: `escrito, N bytes de HTML de panel` sin excepciones.

- [ ] **Step 2: Abrir el harness en Chrome real y revisar visualmente**

Usar el MCP de Chrome DevTools: `new_page` con la URL de archivo local (`file:///C:/Users/JET/AppData/Local/Temp/claude/c--Users-JET-Desktop-MOBY-DICK-biolab-app/db7cb8e5-15df-4884-b8a7-4dcf8ca40693/scratchpad/diff_panel_preview.html`), después `take_screenshot`.

Expected, a ojo sobre la captura:
- Sección **CI** con `bl2_forms` mostrando `CI-0022` y, adentro, el campo `ingredientes` bajando a `ING-0032` con `qty: 5 → 5000`.
- Sección **SU** con `su_lotes` mostrando un `<details>` colapsado tipo "36 registros: +campo `color`" (sin 36 líneas sueltas a la vista), y `su_color_seq`/el flag de migración como "creado".
- Nada de texto cortado, desbordado, o colores ilegibles contra el fondo oscuro.

- [ ] **Step 3: Si algo no se ve bien, corregir el CSS de Task 4 (no el motor ni el render de Task 1/3) y repetir Steps 1-2 de esta tarea hasta que esté bien.**

No hay commit nuevo en esta tarea salvo que Step 3 haya requerido tocar el CSS — en ese caso, commitear igual que en Task 4.

---

### Task 6: Limpieza de archivos temporales de verificación

**Files:**
- Delete (scratchpad, fuera del repo — no requiere `git`): `verify_diff_engine.js`, `diff_panel_preview.html` y cualquier backup intermedio descargado solo para esta verificación.

- [ ] **Step 1: Confirmar que nada del scratchpad quedó referenciado desde el repo**

```bash
grep -rn "AppData/Local/Temp" "c:/Users/JET/Desktop/MOBY DICK/biolab-app/cfg/" 2>&1 || echo "sin referencias, OK"
```

Expected: `sin referencias, OK` — los scripts de verificación son descartables, no dejan rastro en el código real.

No hace falta borrar nada a mano — el scratchpad de la sesión ya es efímero. Este paso es solo para confirmar que no se filtró ninguna ruta absoluta del scratchpad al código del repo.
