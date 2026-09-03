# CI — Buscador + rediseño de cards (Dashboard/Formulación) + chips GE — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar a Dashboard y Formulación de CI un buscador (cepa/ingrediente/nombre-ID) y una card
rediseñada — chips de genética coloreados con el color real de GE (paridad con FR/SU), chips de
frascos de experimento con su label real, un único badge de "días activos" (elimina un cálculo
duplicado y desincronizado que existía), y sin nota/barra de progreso. Las dos funciones de
render casi-duplicadas se consolidan en un helper compartido.

**Architecture:** 100% capa de render + un helper de filtrado en memoria. No se toca ningún dato
persistido (`bl2_forms`, `bl2_seg`, `bl2_experimentos`, `biolab.ge.v4`). Los pedazos de lógica
pura (color GE, chip HTML, matching de búsqueda, texto del badge de días) se extraen a funciones
sin DOM ni `localStorage`, testeadas con scripts Node sueltos (no hay test runner en el repo). La
integración final (armado de la card completa, wiring de los inputs) se verifica con Chrome real
contra datos sintéticos inyectados — nunca contra el backup real del usuario.

**Tech Stack:** JavaScript vanilla (IIFE-less top-level en `ci_app.js`, sin build step, sin
framework de test). `node --check` para sintaxis, `assert` nativo de Node para las funciones
puras, Chrome (MCP `chrome-devtools`) para la verificación funcional final contra
`http://localhost:8734` (`serve.bat`/`start-server.sh`, puerto ya establecido en el proyecto).

**Spec:** `docs/superpowers/specs/2026-09-03-ci-dashboard-formulacion-rediseno-design.md`

**Nota sobre coincidencia exacta:** los bloques `old_string` de este plan fueron transcriptos
contra el archivo real al momento de escribirlo, pero un plan de texto no es una herramienta de
edición — si al aplicar un Edit el `old_string` no matchea exacto (típicamente por espacios de
indentación), releer esa zona del archivo con `Read` y ajustar el bloque antes de reintentar, en
vez de forzar un reemplazo parcial o adivinar.

**Nota sobre `<scratchpad>`:** en todos los pasos de test, `<scratchpad>` significa el directorio
de scratchpad de TU sesión actual (ver "Scratchpad Directory" en tu system prompt). Los archivos
de test son temporales — nunca se commitean al repo (no hay test runner instalado, `assert` de
Node alcanza para verificar la lógica pura antes de integrarla).

---

## Task 1: Chip de genética coloreado por GE

**Files:**
- Test (temporal, no se commitea): `<scratchpad>/test_ci_ge_chip.js`
- Modify: `ci/ci_app.js` — insertar después de la línea 5186 (cierre de
  `_ciResolverGeneticaSnapshot`)

- [ ] **Step 1: Escribir el test que falla**

Crear `<scratchpad>/test_ci_ge_chip.js`:

```js
const assert = require('assert');

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

global.window = {};

function _ciHexToRgba(hex, alpha) {
  if (typeof hex !== 'string') return null;
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

function _ciResolveGeColor(fenId) {
  if (!fenId) return null;
  try {
    if (window.ge && typeof window.ge.getNode === 'function') {
      const n = window.ge.getNode(fenId);
      if (n && n.color) return n.color;
    }
  } catch (e) {}
  try {
    if (window.GEResolve && typeof window.GEResolve.resolverNodoCrudo === 'function') {
      const r = window.GEResolve.resolverNodoCrudo(fenId);
      if (r && r.node && r.node.color) return r.node.color;
    }
  } catch (e) {}
  return null;
}

function _ciGenChipHtml(fullLabel, fenId) {
  if (!fullLabel) return '';
  const parts = String(fullLabel).split('/').map(s => s.trim()).filter(Boolean);
  const label = parts.length ? parts[parts.length - 1] : fullLabel;
  const hex = _ciResolveGeColor(fenId);
  const bg = hex ? _ciHexToRgba(hex, 0.15) : null;
  const border = hex ? _ciHexToRgba(hex, 0.40) : null;
  const cls = 'ci-chip' + (bg ? '' : ' ci-chip-neutral');
  const style = bg ? ` style="background:${bg};border-color:${border};color:${esc(hex)}"` : '';
  return `<span class="${cls}"${style} title="${esc(fullLabel)}">🧬 ${esc(label)}</span>`;
}

// Test 1: sin GE montado -> chip neutro, label = último segmento
{
  window.ge = undefined;
  window.GEResolve = undefined;
  const html = _ciGenChipHtml('Psilocybe cubensis / APE / Thrasher', 'NODE-X');
  assert.ok(html.includes('ci-chip-neutral'), 'debe caer a chip neutro sin GE montado');
  assert.ok(html.includes('>🧬 Thrasher<'), 'debe usar el último segmento como label');
  assert.ok(html.includes('title="Psilocybe cubensis / APE / Thrasher"'), 'title debe llevar la cadena completa');
}

// Test 2: con GE montado y color real -> chip coloreado (dato real: nodo "244" del backup, #008cff)
{
  window.ge = { getNode: (id) => id === 'NODE-MO9I1NQKV0VB' ? { id, name: '244', color: '#008cff' } : null };
  const html = _ciGenChipHtml('Psilocybe cubensis / F2 / 244', 'NODE-MO9I1NQKV0VB');
  assert.ok(html.includes('background:rgba(0,140,255,0.15)'), 'bg debe resolver el hex real a rgba 15%');
  assert.ok(html.includes('border-color:rgba(0,140,255,0.4)'), 'border debe resolver el hex real a rgba 40%');
  assert.ok(html.includes('color:#008cff'), 'color de texto debe ser el hex sólido');
  assert.ok(html.includes('>🧬 244<'));
}

// Test 3: fullLabel vacío -> ''
{
  assert.strictEqual(_ciGenChipHtml('', 'NODE-244'), '');
  assert.strictEqual(_ciGenChipHtml(null, 'NODE-244'), '');
}

// Test 4: fallback a GEResolve cuando window.ge no resuelve (dato real: "Hillbilly Clon 1", #ff7300)
{
  window.ge = { getNode: () => null };
  window.GEResolve = { resolverNodoCrudo: (id) => ({ node: { id, color: '#ff7300' } }) };
  const html = _ciGenChipHtml('Hillbilly Clon 1', 'NODE-MO9I88RRBWAA');
  assert.ok(html.includes('color:#ff7300'));
}

console.log('OK - _ciGenChipHtml');
```

- [ ] **Step 2: Correr el test para confirmar que pasa en aislamiento**

Run: `node <scratchpad>/test_ci_ge_chip.js`
Expected: `OK - _ciGenChipHtml` (las funciones ya están completas en el propio script de test —
este paso confirma que la lógica es correcta ANTES de integrarla al archivo real).

- [ ] **Step 3: Integrar las 3 funciones a `ci/ci_app.js`**

Ubicación: inmediatamente después del cierre de `_ciResolverGeneticaSnapshot` (línea 5186) y
antes del comentario "─── Listado de cultivos en el subtab ───".

Buscar este bloque exacto:

```js
  // Sin GE disponible: snapshot mínimo (no rompe trazabilidad, sigue siendo único)
  return { codigoGE: geneticaId, label: geneticaId };
}


// ─── Listado de cultivos en el subtab ───
```

Reemplazar por:

```js
  // Sin GE disponible: snapshot mínimo (no rompe trazabilidad, sigue siendo único)
  return { codigoGE: geneticaId, label: geneticaId };
}

// Chip de genética coloreado con el color real del nodo GE — mismo patrón que
// _genChipHtml/_resolveGeColor de fr_app.js y su equivalente en su_app.js (ver
// docs/superpowers/specs/2026-08-31-fr-su-genetica-chip-acortado-design.md). CI tiene una
// ventaja que FR no tenía: `geneticaId` (campo seg.genetica) YA ES el fenId directamente, sin
// necesitar resolución multi-fuente. No modifica storage — 100% capa de render.
function _ciHexToRgba(hex, alpha) {
  if (typeof hex !== 'string') return null;
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

function _ciResolveGeColor(fenId) {
  if (!fenId) return null;
  try {
    if (window.ge && typeof window.ge.getNode === 'function') {
      const n = window.ge.getNode(fenId);
      if (n && n.color) return n.color;
    }
  } catch (e) {}
  try {
    if (window.GEResolve && typeof window.GEResolve.resolverNodoCrudo === 'function') {
      const r = window.GEResolve.resolverNodoCrudo(fenId);
      if (r && r.node && r.node.color) return r.node.color;
    }
  } catch (e) {}
  return null;
}

function _ciGenChipHtml(fullLabel, fenId) {
  if (!fullLabel) return '';
  const parts = String(fullLabel).split('/').map(s => s.trim()).filter(Boolean);
  const label = parts.length ? parts[parts.length - 1] : fullLabel;
  const hex = _ciResolveGeColor(fenId);
  const bg = hex ? _ciHexToRgba(hex, 0.15) : null;
  const border = hex ? _ciHexToRgba(hex, 0.40) : null;
  const cls = 'ci-chip' + (bg ? '' : ' ci-chip-neutral');
  const style = bg ? ` style="background:${bg};border-color:${border};color:${esc(hex)}"` : '';
  return `<span class="${cls}"${style} title="${esc(fullLabel)}">🧬 ${esc(label)}</span>`;
}

// ─── Listado de cultivos en el subtab ───
```

- [ ] **Step 4: Verificar sintaxis**

Run: `node --check ci/ci_app.js`
Expected: sin salida (exit code 0).

- [ ] **Step 5: Commit**

```bash
git add ci/ci_app.js
git commit -m "$(cat <<'EOF'
feat(ci): chip de genética coloreado con el color real de GE

Mismo patrón que FR/SU (_genChipHtml/_resolveGeColor) — el campo
seg.genetica ya es el fenId, sin necesitar resolución multi-fuente.
Funciones agregadas, todavía sin consumidor (se integran en un task
posterior de este mismo plan).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Chips de frascos de experimento

**Files:**
- Test (temporal, no se commitea): `<scratchpad>/test_ci_exp_chips.js`
- Modify: `ci/ci_app.js` — insertar después de la línea 5712 (cierre de `expByFormula`)

- [ ] **Step 1: Escribir el test que falla**

Crear `<scratchpad>/test_ci_exp_chips.js`:

```js
const assert = require('assert');
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function _ciExpFrascoChipsFromList(frascos) {
  if (!Array.isArray(frascos) || !frascos.length) return '';
  const MAX = 6;
  const visibles = frascos.slice(0, MAX);
  const resto = frascos.length - visibles.length;
  const chips = visibles.map(fr =>
    `<span class="ci-chip ci-chip-exp" title="${esc(fr.label || '')}">🔬 ${esc(fr.label || '?')}</span>`
  ).join('');
  const overflow = resto > 0 ? `<span class="ci-chip ci-chip-neutral">+${resto} más</span>` : '';
  return chips + overflow;
}

// Test 1: caso real — experimento EXP-0009 de la fórmula AGO1808 (backup 2026-09-03), 4 frascos
{
  const frascos = [
    { label: "A' Ca restaurado" },
    { label: "B' Ca+Fosfato" },
    { label: 'A2 +Arginina' },
    { label: 'A4 Ca mixto jugado' },
  ];
  const html = _ciExpFrascoChipsFromList(frascos);
  assert.strictEqual((html.match(/ci-chip-exp/g) || []).length, 4, 'un chip por frasco, sin overflow para 4');
  assert.ok(html.includes("🔬 A' Ca restaurado"), 'debe incluir el label real del frasco tal cual (esc no toca comillas simples)');
  assert.ok(html.includes('🔬 A4 Ca mixto jugado'));
  assert.ok(!html.includes('más'), 'sin overflow no debe aparecer "+N más"');
}

// Test 2: vacío -> ''
{
  assert.strictEqual(_ciExpFrascoChipsFromList([]), '');
  assert.strictEqual(_ciExpFrascoChipsFromList(undefined), '');
}

// Test 3: overflow con más de 6
{
  const frascos = Array.from({ length: 9 }, (_, i) => ({ label: 'Frasco ' + i }));
  const html = _ciExpFrascoChipsFromList(frascos);
  assert.strictEqual((html.match(/ci-chip-exp/g) || []).length, 6, 'cap de 6 chips visibles');
  assert.ok(html.includes('+3 más'), 'overflow debe mostrar el resto exacto (9-6=3)');
}

console.log('OK - _ciExpFrascoChipsFromList');
```

- [ ] **Step 2: Correr el test para confirmar que pasa**

Run: `node <scratchpad>/test_ci_exp_chips.js`
Expected: `OK - _ciExpFrascoChipsFromList`

- [ ] **Step 3: Integrar a `ci/ci_app.js`**

Buscar este bloque exacto (líneas 5709-5713):

```js
function expLoad()           { return gDB(K.exp); }
function expSave(arr)        { sDB(K.exp, arr); }
function expNxtId()          { return nxtId('EXP', expLoad()); }
function expByFormula(frmId) { return expLoad().filter(x => x.formulaId === frmId); }

// ── Hoist del modal a body (idéntico al patrón _ciHoistModal) ──
```

Reemplazar por:

```js
function expLoad()           { return gDB(K.exp); }
function expSave(arr)        { sDB(K.exp, arr); }
function expNxtId()          { return nxtId('EXP', expLoad()); }
function expByFormula(frmId) { return expLoad().filter(x => x.formulaId === frmId); }

// Chips de frascos de experimento para la card de Dashboard/Formulación — reemplaza al viejo
// pill "🔬 N Exp" (solo conteo) por el label real de cada frasco (ej. "A' Ca restaurado").
// _ciExpFrascoChipsFromList es la parte pura (testeada en aislamiento); _ciExpFrascoChipsHtml
// es el wrapper que lee bl2_experimentos vía expByFormula (ya existente, sin cambios).
function _ciExpFrascoChipsFromList(frascos) {
  if (!Array.isArray(frascos) || !frascos.length) return '';
  const MAX = 6;
  const visibles = frascos.slice(0, MAX);
  const resto = frascos.length - visibles.length;
  const chips = visibles.map(fr =>
    `<span class="ci-chip ci-chip-exp" title="${esc(fr.label || '')}">🔬 ${esc(fr.label || '?')}</span>`
  ).join('');
  const overflow = resto > 0 ? `<span class="ci-chip ci-chip-neutral">+${resto} más</span>` : '';
  return chips + overflow;
}

function _ciExpFrascoChipsHtml(frmId) {
  const frascos = expByFormula(frmId).flatMap(e => e.frascos || []);
  const inner = _ciExpFrascoChipsFromList(frascos);
  return inner ? `<div class="ci-dash-gen-chips">${inner}</div>` : '';
}

// ── Hoist del modal a body (idéntico al patrón _ciHoistModal) ──
```

Nota: `_ciExpFrascoChipsHtml` reusa la clase `.ci-dash-gen-chips` (flex-wrap + gap) para el
contenedor — mismo ritmo visual que la fila de chips de genética, sin crear una clase de
contenedor nueva solo para esto.

- [ ] **Step 4: Verificar sintaxis**

Run: `node --check ci/ci_app.js`
Expected: sin salida (exit code 0).

- [ ] **Step 5: Commit**

```bash
git add ci/ci_app.js
git commit -m "$(cat <<'EOF'
feat(ci): chips de frascos de experimento con label real

Reemplaza al conteo "🔬 N Exp" — ahora se ve qué frascos son
(ej. "A' Ca restaurado"), no solo cuántos hay. Sin consumidor
todavía (se integra en un task posterior).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Buscador — normalización y matching

**Files:**
- Test (temporal, no se commitea): `<scratchpad>/test_ci_search.js`
- Modify: `ci/ci_app.js` — insertar antes de la línea 651 (`function ciRenderFormulasList()`)

- [ ] **Step 1: Escribir el test que falla**

Crear `<scratchpad>/test_ci_search.js`:

```js
const assert = require('assert');

function _ciNormalizeSearchText(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function _ciFormulaMatchesQuery(formula, geneticaLabels, normalizedQuery) {
  if (!normalizedQuery) return true;
  const q = normalizedQuery;
  if (_ciNormalizeSearchText(formula.nombre).includes(q)) return true;
  if (_ciNormalizeSearchText(formula.id).includes(q)) return true;
  const ings = Array.isArray(formula.ingredientes) ? formula.ingredientes : [];
  for (const ing of ings) {
    const nombre = ing && ing.snapshot && ing.snapshot.nombre;
    if (nombre && _ciNormalizeSearchText(nombre).includes(q)) return true;
  }
  for (const label of (geneticaLabels || [])) {
    if (label && _ciNormalizeSearchText(label).includes(q)) return true;
  }
  return false;
}

// Datos reales: fórmula CI-0016 "AGO1808" del backup 2026-09-03
const formula = {
  id: 'CI-0016',
  nombre: 'AGO1808',
  ingredientes: [
    { id: 'ING-0001', snapshot: { nombre: 'Agua filtrada' } },
    { id: 'ING-0032', snapshot: { nombre: "BOB'S RED MILL - Levadura de cerveza" } },
    { id: 'ING-0008', snapshot: { nombre: 'Sulfato de magnesio' } },
  ],
};
const geneticaLabels = ['Psilocybe cubensis / F2 / 244', 'Psilocybe cubensis / F2 / 210'];

// Test 1: match por ingrediente, case-insensitive
assert.ok(_ciFormulaMatchesQuery(formula, geneticaLabels, _ciNormalizeSearchText('LEVADURA')));
assert.ok(_ciFormulaMatchesQuery(formula, geneticaLabels, _ciNormalizeSearchText('levadura')));

// Test 2: match por genética, cualquier segmento de la cadena (no solo el último)
assert.ok(_ciFormulaMatchesQuery(formula, geneticaLabels, _ciNormalizeSearchText('cubensis')));
assert.ok(_ciFormulaMatchesQuery(formula, geneticaLabels, _ciNormalizeSearchText('244')));

// Test 3: match por nombre/id de fórmula
assert.ok(_ciFormulaMatchesQuery(formula, geneticaLabels, _ciNormalizeSearchText('AGO1808')));
assert.ok(_ciFormulaMatchesQuery(formula, geneticaLabels, _ciNormalizeSearchText('CI-0016')));

// Test 4: no matchea algo ausente
assert.strictEqual(_ciFormulaMatchesQuery(formula, geneticaLabels, _ciNormalizeSearchText('arginina')), false);

// Test 5: query vacío matchea todo (sin filtro activo)
assert.strictEqual(_ciFormulaMatchesQuery(formula, geneticaLabels, _ciNormalizeSearchText('')), true);

// Test 6: ingrediente legacy sin snapshot no rompe el matching
const formulaLegacy = { id: 'CI-OLD', nombre: 'Vieja', ingredientes: [{ id: 'ING-1' }] };
assert.strictEqual(_ciFormulaMatchesQuery(formulaLegacy, [], _ciNormalizeSearchText('ING-1')), false);

// Test 7: normalización de acentos
assert.strictEqual(_ciNormalizeSearchText('Águila'), 'aguila');

console.log('OK - buscador CI');
```

- [ ] **Step 2: Correr el test para confirmar que pasa**

Run: `node <scratchpad>/test_ci_search.js`
Expected: `OK - buscador CI`

- [ ] **Step 3: Integrar a `ci/ci_app.js`**

Buscar este bloque exacto (líneas 641-651):

```js
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
```

Reemplazar por:

```js
function ciToggleMostrarArchivadas() {
  _ciMostrarArchivadas = !_ciMostrarArchivadas;
  const btn = document.getElementById('ci-toggle-archivadas');
  if (btn) {
    btn.textContent = _ciMostrarArchivadas ? '📦 Ocultar archivadas' : '📦 Ver archivadas';
    btn.classList.toggle('activo', _ciMostrarArchivadas);
  }
  ciRenderFormulasList();
}

// ── Buscador de Dashboard/Formulación — cepa, ingrediente, nombre/ID de fórmula ──
// _ciNormalizeSearchText: case-insensitive + sin acentos (texto en español). Recibe el query
// YA normalizado (normalizar una vez por render, no una vez por fórmula).
// _ciFormulaMatchesQuery matchea contra f.ingredientes[].snapshot.nombre — el snapshot
// INMUTABLE de cada ingrediente, nunca bl2_ings en vivo (invariante de CI: el snapshot no
// cambia si el ingrediente se edita/renombra después de formular).
function _ciNormalizeSearchText(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function _ciFormulaMatchesQuery(formula, geneticaLabels, normalizedQuery) {
  if (!normalizedQuery) return true;
  const q = normalizedQuery;
  if (_ciNormalizeSearchText(formula.nombre).includes(q)) return true;
  if (_ciNormalizeSearchText(formula.id).includes(q)) return true;
  const ings = Array.isArray(formula.ingredientes) ? formula.ingredientes : [];
  for (const ing of ings) {
    const nombre = ing && ing.snapshot && ing.snapshot.nombre;
    if (nombre && _ciNormalizeSearchText(nombre).includes(q)) return true;
  }
  for (const label of (geneticaLabels || [])) {
    if (label && _ciNormalizeSearchText(label).includes(q)) return true;
  }
  return false;
}

function ciRenderFormulasList() {
```

- [ ] **Step 4: Verificar sintaxis**

Run: `node --check ci/ci_app.js`
Expected: sin salida (exit code 0).

- [ ] **Step 5: Commit**

```bash
git add ci/ci_app.js
git commit -m "$(cat <<'EOF'
feat(ci): matching de búsqueda por cepa/ingrediente/nombre-ID

Matchea contra el snapshot inmutable de cada ingrediente (nunca
bl2_ings en vivo) y contra el label completo de cada genética
usada. Normaliza acentos/mayúsculas. Sin consumidor todavía (se
integra en un task posterior).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Badge de días activos — un solo número, dos estados

**Files:**
- Test (temporal, no se commitea): `<scratchpad>/test_ci_dias.js`
- Modify: `ci/ci_app.js` — insertar después de la línea 2407 (cierre de
  `_ciDashDiasDesdeInoculacion`)

- [ ] **Step 1: Escribir el test que falla**

Crear `<scratchpad>/test_ci_dias.js`:

```js
const assert = require('assert');
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function _ciDiasActivosHtml(diasTxt) {
  if (!diasTxt) return '';
  const activo = diasTxt.indexOf('D+') === 0;
  const color = activo ? '#FFC000' : 'var(--tx)';
  const dot = activo ? '<span class="ci-dash-dias-dot"></span>' : '';
  const sub = activo
    ? 'desde inoculación · aún sin colonizar'
    : 'colonizó en ' + diasTxt.replace(/^D\s*/, '') + ' días';
  return `<div class="ci-dash-dias">${dot}<span class="ci-dash-dias-num" style="color:${color}">${esc(diasTxt)}</span><span class="ci-dash-dias-sub">${esc(sub)}</span></div>`;
}

// Test 1: activo (D+) — dato real: fórmula AGO1808, inoculada 2026-08-19, todavía sin colonizar
{
  const html = _ciDiasActivosHtml('D+15');
  assert.ok(html.includes('ci-dash-dias-dot'), 'debe llevar el punto pulsante cuando sigue activo');
  assert.ok(html.includes('color:#FFC000'));
  assert.ok(html.includes('>D+15<'));
  assert.ok(html.includes('aún sin colonizar'));
}

// Test 2: cerrado (D sin +) — dato real: fórmula R-Hillbilly, inoculada 16/04, colonizó 30/04 (14 días)
{
  const html = _ciDiasActivosHtml('D 14');
  assert.ok(!html.includes('ci-dash-dias-dot'), 'sin pulso cuando ya colonizó');
  assert.ok(html.includes('color:var(--tx)'));
  assert.ok(html.includes('colonizó en 14 días'));
}

// Test 3: null/vacío -> ''
{
  assert.strictEqual(_ciDiasActivosHtml(null), '');
  assert.strictEqual(_ciDiasActivosHtml(''), '');
}

console.log('OK - _ciDiasActivosHtml');
```

- [ ] **Step 2: Correr el test para confirmar que pasa**

Run: `node <scratchpad>/test_ci_dias.js`
Expected: `OK - _ciDiasActivosHtml`

- [ ] **Step 3: Integrar a `ci/ci_app.js`**

Buscar este bloque exacto (líneas 2405-2412):

```js
  const txt = _segFmtDias(d.toISOString(), s.colonizacion);
  return (txt && txt !== '—') ? txt : null;
}

/**
 * Actualiza la celda seg-td-dias del row con D+ actual.
 * Llamar cada vez que inoculoTs cambia.
 */
```

Reemplazar por:

```js
  const txt = _segFmtDias(d.toISOString(), s.colonizacion);
  return (txt && txt !== '—') ? txt : null;
}

// Pinta el resultado de _ciDashDiasDesdeInoculacion en la card de Dashboard/Formulación con
// dos estados: activo (prefijo "D+", sigue contando — ámbar con punto pulsante, para que se
// note) vs cerrado (prefijo "D " sin +, ya colonizó — texto neutro, es historia, no alarma).
// No recalcula nada — el cálculo de días sigue siendo _ciDashDiasDesdeInoculacion/_segFmtDias,
// sin tocar.
function _ciDiasActivosHtml(diasTxt) {
  if (!diasTxt) return '';
  const activo = diasTxt.indexOf('D+') === 0;
  const color = activo ? '#FFC000' : 'var(--tx)';
  const dot = activo ? '<span class="ci-dash-dias-dot"></span>' : '';
  const sub = activo
    ? 'desde inoculación · aún sin colonizar'
    : 'colonizó en ' + diasTxt.replace(/^D\s*/, '') + ' días';
  return `<div class="ci-dash-dias">${dot}<span class="ci-dash-dias-num" style="color:${color}">${esc(diasTxt)}</span><span class="ci-dash-dias-sub">${esc(sub)}</span></div>`;
}

/**
 * Actualiza la celda seg-td-dias del row con D+ actual.
 * Llamar cada vez que inoculoTs cambia.
 */
```

- [ ] **Step 4: Verificar sintaxis**

Run: `node --check ci/ci_app.js`
Expected: sin salida (exit code 0).

- [ ] **Step 5: Commit**

```bash
git add ci/ci_app.js
git commit -m "$(cat <<'EOF'
feat(ci): badge único de días activos con dos estados visuales

Ámbar + punto pulsante mientras sigue sin colonizar (D+N), neutro
cuando ya cerró (D N) — mismo cálculo de siempre
(_ciDashDiasDesdeInoculacion), solo cambia cómo se pinta. Sin
consumidor todavía (se integra en un task posterior).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: CSS — chips GE/experimento, badge de días, limpieza de clases muertas

**Files:**
- Modify: `ci/ci_styles.css:1695-1745`

- [ ] **Step 1: Reemplazar el bloque de CSS**

Buscar este bloque exacto:

```css
.ci-dash-dias-badge {
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  font-weight: 700;
  color: #FFC000;
  margin: -6px 0 10px;
}
.ci-dash-gen-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: -4px 0 10px;
}

.ci-dash-metrics {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}
.ci-dash-metric {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 36px;
}
.ci-dash-mval {
  font-family: 'JetBrains Mono', monospace;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.1;
}
.ci-dash-mlbl {
  font-family: 'JetBrains Mono', monospace;
  font-size: 9px;
  color: var(--tx3);
  margin-top: 2px;
  text-align: center;
}

.ci-dash-last-nota {
  margin-top: 8px;
  padding: 5px 8px;
  border-left: 2px solid var(--border);
  font-size: 11px;
  color: var(--tx3);
  line-height: 1.4;
  border-radius: 0 4px 4px 0;
  background: rgba(255,255,255,0.02);
}
```

Reemplazar por (elimina `.ci-dash-dias-badge`/`.ci-dash-metrics`/`.ci-dash-metric`/
`.ci-dash-mval`/`.ci-dash-mlbl`/`.ci-dash-last-nota` — confirmado por grep que ninguna se usa
fuera de las dos funciones que este plan reescribe en el Task 7 — y agrega las clases nuevas):

```css
.ci-dash-gen-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: -4px 0 10px;
}

/* Badge de días activos — dos estados, ver _ciDiasActivosHtml en ci_app.js */
.ci-dash-dias {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 2px 0 10px;
}
.ci-dash-dias-num {
  font-family: 'JetBrains Mono', monospace;
  font-size: 18px;
  font-weight: 800;
  letter-spacing: .3px;
}
.ci-dash-dias-sub {
  font-size: 10px;
  color: var(--tx3);
}
.ci-dash-dias-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #FFC000;
  box-shadow: 0 0 6px #FFC000;
  animation: ciDiasPulse 1.6s ease-in-out infinite;
  flex-shrink: 0;
}
@keyframes ciDiasPulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: .35; }
}

/* Chip pill coloreado por GE — mismo estilo que .fr-chip (fr_styles.css) / paridad FR-SU-CI */
.ci-chip {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .3px;
  border: 1px solid transparent;
}
.ci-chip-neutral {
  background: rgba(255,255,255,0.06);
  color: var(--tx3);
}
.ci-chip-exp {
  background: rgba(68,170,255,.13);
  border-color: rgba(68,170,255,.35);
  color: #8fc6ff;
}

/* Fila de stats de la card — reemplaza al viejo grid .ci-dash-metrics */
.ci-dash-stats-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 2px;
}
```

- [ ] **Step 2: Verificar que no queda ningún consumidor de las clases eliminadas**

Run: `grep -rn "ci-dash-metrics\|ci-dash-metric\b\|ci-dash-mval\|ci-dash-mlbl\|ci-dash-last-nota\|ci-dash-dias-badge" ci/`
Expected: sin resultados (el Task 7 todavía no reescribió `ci_app.js`, así que en este punto
del plan SÍ va a haber matches en `ci_app.js` — eso es esperado y se resuelve en el Task 7. Este
grep es solo para confirmar que no hay un TERCER consumidor fuera de las dos funciones que ya
identificamos, ej. en `ci_index.html` u otro archivo `.css`/`.js`).

- [ ] **Step 3: Commit**

```bash
git add ci/ci_styles.css
git commit -m "$(cat <<'EOF'
style(ci): CSS para chips GE/experimento y badge de días, limpia clases muertas

.ci-dash-metrics/.ci-dash-metric/.ci-dash-mval/.ci-dash-mlbl/
.ci-dash-last-nota/.ci-dash-dias-badge eliminadas (uso exclusivo de
las dos funciones de tile que este plan reescribe en el próximo
task, confirmado por grep). ci_app.js todavía referencia las
clases viejas hasta el Task 7 — esperado, es un cambio incremental.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: HTML — inputs de búsqueda + contador de resultados

**Files:**
- Modify: `ci/ci_index.html:63-74` (header Dashboard)
- Modify: `ci/ci_index.html:204-220` (header Formulación)

**Antes de cada Edit de este task:** los bloques de abajo fueron transcriptos a mano desde el
archivo — si algún `old_string` no matchea por un espacio de indentación de más/menos, releer la
línea exacta con `Read` (los rangos de línea de arriba) antes de reintentar. Por eso este task
usa anclas chicas (1-4 líneas) en vez de bloques grandes — mucho menos margen de error.

- [ ] **Step 1: Dashboard — permitir wrap en el header (una línea)**

Buscar (línea 65 al momento de escribir este plan):

```html
      <div class="ct" style="display:flex;justify-content:space-between;align-items:center">
        <span style="color:#00CC33">📊 Dashboard CI — Fórmulas activas</span>
```

Reemplazar por:

```html
      <div class="ct" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <span style="color:#00CC33">📊 Dashboard CI — Fórmulas activas</span>
```

- [ ] **Step 2: Dashboard — insertar el input antes del botón de backup**

Buscar (línea 68):

```html
          <button class="btn btn-s" style="height:24px;font-size:11px;padding:0 10px;border-color:var(--er);color:var(--er)" onclick="exportData()" title="Backup solo de datos de CI (fórmulas, cultivos, seguimiento) — no es un backup de todo el sistema, ver CFG para eso">💾 Backup de CI</button>
```

Reemplazar por:

```html
          <input type="text" id="ci-dash-search" placeholder="🔍 Buscar cepa, ingrediente, nombre o ID…" oninput="ciRenderDashboard()"
                 style="padding:6px 10px;border-radius:6px;background:var(--bg-tertiary);color:var(--tx);border:1px solid var(--border);font-size:12px;width:240px">
          <button class="btn btn-s" style="height:24px;font-size:11px;padding:0 10px;border-color:var(--er);color:var(--er)" onclick="exportData()" title="Backup solo de datos de CI (fórmulas, cultivos, seguimiento) — no es un backup de todo el sistema, ver CFG para eso">💾 Backup de CI</button>
```

- [ ] **Step 3: Dashboard — insertar el contador de resultados antes de la grilla**

Buscar (líneas 71-74):

```html
      <p style="color:var(--tx3);font-size:13px;margin:4px 0 16px">
        Vista rápida. Hacé click en una fórmula para abrirla en detalle.
      </p>
      <div id="ci-dashboard-grid" class="ci-dash-grid"></div>
```

Reemplazar por:

```html
      <p style="color:var(--tx3);font-size:13px;margin:4px 0 4px">
        Vista rápida. Hacé click en una fórmula para abrirla en detalle.
      </p>
      <div id="ci-dash-search-count" style="display:none;color:var(--tx3);font-size:11px;font-family:'JetBrains Mono',monospace;margin-bottom:8px"></div>
      <div id="ci-dashboard-grid" class="ci-dash-grid"></div>
```

- [ ] **Step 4: Formulación — permitir wrap en el header (una línea)**

Buscar (línea 206):

```html
    <div class="ct" style="display:flex;justify-content:space-between;align-items:center">
      <span style="color:#00CC33">📋 Fórmulas CI</span>
```

Reemplazar por:

```html
    <div class="ct" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <span style="color:#00CC33">📋 Fórmulas CI</span>
```

- [ ] **Step 5: Formulación — insertar el input como primer control del header**

Buscar (líneas 208-209):

```html
      <div style="display:flex;gap:6px;align-items:center">
        <button class="btn btn-s" style="font-size:11px;padding:4px 10px" onclick="ciExportExcel()">📥 Copiar para Excel</button>
```

Reemplazar por:

```html
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <input type="text" id="ci-formulas-search" placeholder="🔍 Buscar cepa, ingrediente, nombre o ID…" oninput="ciRenderFormulasList()"
               style="padding:6px 10px;border-radius:6px;background:var(--bg-tertiary);color:var(--tx);border:1px solid var(--border);font-size:12px;width:240px">
        <button class="btn btn-s" style="font-size:11px;padding:4px 10px" onclick="ciExportExcel()">📥 Copiar para Excel</button>
```

- [ ] **Step 6: Formulación — insertar el contador de resultados antes de la grilla**

Buscar (líneas 214-218):

```html
    <p style="color:var(--tx3);font-size:12px;margin:2px 0 14px">
      Hacé click en el tile para ver detalle en Dashboard · <span style="color:var(--ac)">📋 Usar como base</span> la carga como plantilla en el formulario.
    </p>
    <div id="ci-formulas-list-wrap" style="position:relative">
```

Reemplazar por:

```html
    <p style="color:var(--tx3);font-size:12px;margin:2px 0 4px">
      Hacé click en el tile para ver detalle en Dashboard · <span style="color:var(--ac)">📋 Usar como base</span> la carga como plantilla en el formulario.
    </p>
    <div id="ci-formulas-search-count" style="display:none;color:var(--tx3);font-size:11px;font-family:'JetBrains Mono',monospace;margin-bottom:10px"></div>
    <div id="ci-formulas-list-wrap" style="position:relative">
```

- [ ] **Step 7: Commit**

```bash
git add ci/ci_index.html
git commit -m "$(cat <<'EOF'
feat(ci): inputs de búsqueda en headers de Dashboard y Formulación

Filtra en vivo (oninput, sin botón). Cada pestaña con su propio
input/estado — no sincronizados entre sí. Contador de resultados
(#ci-dash-search-count / #ci-formulas-search-count) todavía sin
wiring — se conecta en el próximo task.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Consolidación — helper compartido de tiles

**Files:**
- Modify: `ci/ci_app.js` — nuevas funciones antes de `ciRenderFormulasList` (línea ~651, después
  de los helpers del Task 3)

- [ ] **Step 1: Agregar `_ciActualizarContadorBusqueda`, `_ciBuildFormulaTile` y
  `_ciBuildFormulaTilesHtml`**

Buscar este bloque exacto (el mismo punto donde terminó el Task 3 — justo antes de
`ciRenderFormulasList`):

```js
  for (const label of (geneticaLabels || [])) {
    if (label && _ciNormalizeSearchText(label).includes(q)) return true;
  }
  return false;
}

function ciRenderFormulasList() {
```

Reemplazar por:

```js
  for (const label of (geneticaLabels || [])) {
    if (label && _ciNormalizeSearchText(label).includes(q)) return true;
  }
  return false;
}

function _ciActualizarContadorBusqueda(elId, query, total, archivedShown) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!query) { el.textContent = ''; el.style.display = 'none'; return; }
  const arch = archivedShown > 0 ? ` — incluye ${archivedShown} archivada${archivedShown > 1 ? 's' : ''}` : '';
  el.textContent = `${total} fórmula${total === 1 ? '' : 's'} encontrada${total === 1 ? '' : 's'} por "${query}"${arch}`;
  el.style.display = '';
}

// Arma el HTML de una card individual. Reemplaza al bloque casi-duplicado que antes vivía
// dentro de ciRenderDashboard() y de ciRenderFormulasList() por separado (ver spec, sección 6).
// showUsarComoBase: true en Formulación, false en Dashboard — esa es la única diferencia real
// que tenían las dos cards originales (Dashboard nunca mostró ese botón).
function _ciBuildFormulaTile(f, allIngs, segs, showUsarComoBase) {
  const ingsSorted = [...f.ingredientes].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  const { c, n, masa } = calcCN(ingsSorted, allIngs);
  const cn = n > 0 ? (c / n).toFixed(1) : '—';

  const segsF  = segs.filter(s => s.formula_id === f.id);
  const totalP = segsF.reduce((s, r) => s + (r.placas || 0), 0);
  const totalC = segsF.reduce((s, r) => s + (r.contaminados || 0), 0);
  const sanas  = totalP - totalC;
  const ratio  = totalP > 0 ? Math.round(sanas / totalP * 100) : null;
  const ratioCol = ratio === null ? 'var(--tx3)'
    : ratio >= 80 ? 'var(--ac)' : ratio >= 50 ? 'var(--wn)' : 'var(--er)';

  const geneticasUnicas = [...new Set(segsF.map(s => s.genetica).filter(Boolean))];
  const geneticaChipsHtml = geneticasUnicas.length ? `
      <div class="ci-dash-gen-chips">
        ${geneticasUnicas.map(gid => {
          const snap = _ciResolverGeneticaSnapshot(gid);
          return _ciGenChipHtml(snap ? snap.label : gid, gid);
        }).join('')}
      </div>` : '';
  const borderHex = geneticasUnicas.length ? _ciResolveGeColor(geneticasUnicas[0]) : null;

  const tileIdDate = (() => {
    const seg = segsF.filter(s => s.colonizacion)
      .sort((a, b) => new Date(b.colonizacion) - new Date(a.colonizacion))[0];
    if (!seg) return ciFormatDate(f.fecha).split(' ')[0];
    const colDate = _segParseDate(seg.colonizacion);
    if (!colDate || isNaN(colDate)) return ciFormatDate(f.fecha).split(' ')[0];
    const colonFmt = ciFormatDate(colDate.toISOString()).split(' ')[0];
    if (seg.inoculoFecha || seg.inoculoTs) {
      const inoDate = seg.inoculoFecha ? _segParseDate(seg.inoculoFecha) : new Date(seg.inoculoTs);
      if (inoDate && !isNaN(inoDate)) {
        return `${ciFormatDate(inoDate.toISOString()).split(' ')[0]} - ${colonFmt}`;
      }
    }
    return `Col: ${colonFmt}`;
  })();

  const diasHtml = _ciDiasActivosHtml(_ciDashDiasDesdeInoculacion(segsF));
  const expChipsHtml = _ciExpFrascoChipsHtml(f.id);

  const statsRow = `
    <div class="ci-dash-stats-row">
      <span class="seg-tc-chip" style="color:var(--wn)">C/N ${cn}</span>
      <span class="seg-tc-chip" style="color:var(--ac3)">${masa.toFixed(0)}g</span>
      <span class="seg-tc-chip" style="color:var(--ac2)">${f.ingredientes.length} ings</span>
      ${totalP ? `<span class="seg-tc-chip" style="color:${ratioCol}">🧫 ${sanas}/${totalP} sanas</span>` : ''}
    </div>`;

  const borderStyle = borderHex ? ` style="border-left:3px solid ${esc(borderHex)}"` : '';
  const usarComoBaseHtml = showUsarComoBase ? `
        <button type="button" onclick="event.stopPropagation();ciCargarComoBase('${f.id}')"
          style="margin-top:8px;width:100%;padding:4px;font-size:11px;background:none;border:1px solid rgba(0,204,51,.25);color:var(--ac);border-radius:3px;cursor:pointer;letter-spacing:.3px"
          title="Cargar como base para nueva fórmula">📋 Usar como base</button>` : '';

  return `
      <div class="ci-dash-tile${f.archivada ? ' ci-tile-archivada' : ''}"${borderStyle} onclick="ciDashOpenFormula('${f.id}')">
        <div class="ci-dash-tile-top">
          <span class="ci-dash-tile-name">${esc(f.nombre)}</span>
          <span class="ci-dash-tile-ver">${esc(f.version || 'v1')}</span>
          ${f.archivada ? '<span style="font-family:\'JetBrains Mono\',monospace;font-size:9px;color:#FFC000;letter-spacing:1px">ARCH</span>' : ''}
        </div>
        <div class="ci-dash-tile-id">${f.id} · ${tileIdDate}</div>
        ${diasHtml}
        ${geneticaChipsHtml}
        ${expChipsHtml}
        ${statsRow}
        ${usarComoBaseHtml}
      </div>`;
}

// Filtra (búsqueda + archivadas) + ordena + arma el HTML de todos los tiles. Único punto que
// conocen las dos vistas (Dashboard/Formulación) — antes cada una duplicaba esta lógica a mano.
// Con query no vacío, ignora showArchived (la búsqueda siempre incluye archivadas — decisión
// del brainstorming, ver spec sección 5).
function _ciBuildFormulaTilesHtml(forms, segs, allIngs, query, showArchived, showUsarComoBase) {
  const normalizedQuery = _ciNormalizeSearchText(query);
  const base = normalizedQuery ? forms : forms.filter(f => showArchived || !f.archivada);

  const conGeneticaLabels = base.map(f => {
    const segsF = segs.filter(s => s.formula_id === f.id);
    const geneticaLabels = [...new Set(segsF.map(s => s.genetica).filter(Boolean))]
      .map(gid => { const snap = _ciResolverGeneticaSnapshot(gid); return snap ? snap.label : gid; });
    return { f, geneticaLabels };
  });

  const filtrados = normalizedQuery
    ? conGeneticaLabels.filter(({ f, geneticaLabels }) => _ciFormulaMatchesQuery(f, geneticaLabels, normalizedQuery))
    : conGeneticaLabels;

  const ordenados = [...filtrados].sort((a, b) => new Date(b.f.fecha) - new Date(a.f.fecha));
  const archivedShown = ordenados.filter(({ f }) => f.archivada).length;
  const html = ordenados.map(({ f }) => _ciBuildFormulaTile(f, allIngs, segs, showUsarComoBase)).join('');

  return { html, total: ordenados.length, archivedShown };
}

function ciRenderFormulasList() {
```

- [ ] **Step 2: Verificar sintaxis**

Run: `node --check ci/ci_app.js`
Expected: sin salida (exit code 0).

- [ ] **Step 3: Commit**

```bash
git add ci/ci_app.js
git commit -m "$(cat <<'EOF'
feat(ci): helper compartido _ciBuildFormulaTilesHtml para las cards

Consolida la card completa (antes duplicada a mano entre
ciRenderDashboard y ciRenderFormulasList) en un solo builder:
chip GE, chips de experimento, badge de días, stats en fila, sin
nota ni barra de progreso. Todavía sin consumidor real — se
conecta en el próximo task.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Reescribir `ciRenderFormulasList()` para usar el helper

**Files:**
- Modify: `ci/ci_app.js:651-775` aprox. (el rango real puede haberse corrido por los inserts de
  los tasks anteriores — ubicar por el texto, no por número de línea)

- [ ] **Step 1: Reemplazar el cuerpo completo de la función**

Buscar la función completa `ciRenderFormulasList` (empieza en `function ciRenderFormulasList() {`
y termina en el `}` que cierra `function _actualizarToggleArchivadas(forms) {` — es decir, hay
que reemplazar DOS funciones juntas porque la segunda gana una línea nueva de dimming). Texto
exacto a buscar:

```js
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

    // Chips de genéticas usadas — vistazo rápido sin entrar a la fórmula (2026-08-04,
    // pedido tras el incidente R244/244 en CI-0012: un error de carga de genética
    // debería poder detectarse desde afuera, no solo abriendo cada fórmula).
    const geneticasUnicas = [...new Set(segsF.map(s => s.genetica).filter(Boolean))];
    const geneticasChipsHtml = geneticasUnicas.length ? `
        <div class="ci-dash-gen-chips">
          ${geneticasUnicas.map(gid => {
            const snap = _ciResolverGeneticaSnapshot(gid);
            const full  = snap ? _segAbreviarEspecie(snap.label) : gid;
            const corto = snap ? _segSoloUltimoSegmento(snap.label) : gid;
            return `<span class="seg-tc-tag seg-tc-tag-gen" title="${esc(full)}">🧬 ${esc(corto)}</span>`;
          }).join('')}
        </div>` : '';

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

    const diasBadge = _ciDashDiasDesdeInoculacion(segsF);

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
        ${diasBadge ? `<div class="ci-dash-dias-badge">🕐 ${diasBadge}</div>` : ''}
        ${geneticasChipsHtml}
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
```

Reemplazar por:

```js
function ciRenderFormulasList() {
  const forms = gDB(K.forms);
  const ings  = gDB(K.ings);
  const segs  = gDB(K.seg);
  const el = document.getElementById('ci-formulas-list');
  if (!el) return;

  if (!forms.length) {
    el.innerHTML = '<div class="empty">Sin fórmulas registradas. Creá una arriba con "+ Nueva Fórmula CI".</div>';
    _actualizarToggleArchivadas(forms);
    _ciActualizarContadorBusqueda('ci-formulas-search-count', '', 0, 0);
    return;
  }

  const query = (document.getElementById('ci-formulas-search') || {}).value || '';
  const { html, total, archivedShown } = _ciBuildFormulaTilesHtml(
    forms, segs, ings, query, _ciMostrarArchivadas, /* showUsarComoBase */ true
  );

  _ciActualizarContadorBusqueda('ci-formulas-search-count', query.trim(), total, archivedShown);

  el.innerHTML = total
    ? '<div class="ci-dash-grid">' + html + '</div>'
    : (query.trim()
        ? `<div class="empty">Sin fórmulas que coincidan con "${esc(query.trim())}".</div>`
        : `<div class="empty">Todas las fórmulas están archivadas. Activá "Ver archivadas" para verlas.</div>`);

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
  const searchActive = !!((document.getElementById('ci-formulas-search') || {}).value || '').trim();
  btn.style.opacity = searchActive ? '0.5' : '';
  btn.title = searchActive ? 'Anulado mientras hay una búsqueda activa — la búsqueda ya incluye archivadas' : '';
}
```

- [ ] **Step 2: Verificar sintaxis**

Run: `node --check ci/ci_app.js`
Expected: sin salida (exit code 0).

- [ ] **Step 3: Commit**

```bash
git add ci/ci_app.js
git commit -m "$(cat <<'EOF'
refactor(ci): ciRenderFormulasList usa el helper compartido de tiles

Elimina ~90 líneas duplicadas. Agrega wiring del buscador (lee
#ci-formulas-search, actualiza el contador) y atenúa el botón
"Ver archivadas" mientras hay una búsqueda activa (la búsqueda ya
las incluye, el toggle queda sin efecto en ese momento).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Reescribir `ciRenderDashboard()` para usar el helper

**Files:**
- Modify: `ci/ci_app.js` — cuerpo de `ciRenderDashboard()` (ubicar por texto, no por línea — se
  corrió por los inserts previos)

- [ ] **Step 1: Reemplazar el cuerpo completo de la función**

Buscar este bloque exacto (función completa, de punta a punta):

```js
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

    const diasBadge = _ciDashDiasDesdeInoculacion(segsF);

    const expCount = expByFormula(f.id).length;
    const notas = (SEG.seguimientoNotas[f.id] || []);
    const lastNota = notas.length ? notas[notas.length - 1] : null;
    const estadoColor = { green: 'var(--ac)', yellow: 'var(--wn)', red: 'var(--er)', none: 'var(--tx3)' };
    const notaCol = lastNota ? (estadoColor[lastNota.estado] || 'var(--tx3)') : 'var(--tx3)';

    const ratioBar = ratio !== null ? `
      <div style="margin:6px 0 4px;height:3px;border-radius:2px;background:var(--bg-tertiary);overflow:hidden">
        <div style="height:100%;width:${ratio}%;background:${ratioCol};border-radius:2px;transition:width .4s"></div>
      </div>` : '';

    // Chips de genéticas usadas — vistazo rápido sin entrar a la fórmula (2026-08-04,
    // pedido tras el incidente R244/244 en CI-0012). Este es el grid real que ve el
    // usuario por defecto (#ci-dashboard-grid) — ciRenderFormulasList() construye un
    // tile casi idéntico pero para #ci-formulas-list, un contenedor secundario; el
    // mismo bloque se duplicó ahí también para no dejar uno de los dos desactualizado.
    const geneticasUnicas2 = [...new Set(segsF.map(s => s.genetica).filter(Boolean))];
    const geneticasChipsHtml2 = geneticasUnicas2.length ? `
        <div class="ci-dash-gen-chips">
          ${geneticasUnicas2.map(gid => {
            const snap = _ciResolverGeneticaSnapshot(gid);
            const full  = snap ? _segAbreviarEspecie(snap.label) : gid;
            const corto = snap ? _segSoloUltimoSegmento(snap.label) : gid;
            return `<span class="seg-tc-tag seg-tc-tag-gen" title="${esc(full)}">🧬 ${esc(corto)}</span>`;
          }).join('')}
        </div>` : '';

    return `
      <div class="ci-dash-tile" onclick="ciDashOpenFormula('${f.id}')">
        <div class="ci-dash-tile-top">
          <span class="ci-dash-tile-name">${esc(f.nombre)}</span>
          <span class="ci-dash-tile-ver">${esc(f.version || 'v1')}</span>
        </div>
        <div class="ci-dash-tile-id">${f.id} · ${tileIdDate2}</div>
        ${diasBadge ? `<div class="ci-dash-dias-badge">🕐 ${diasBadge}</div>` : ''}
        ${geneticasChipsHtml2}
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
```

Reemplazar por:

```js
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
  const query   = (document.getElementById('ci-dash-search') || {}).value || '';

  const { html, total, archivedShown } = _ciBuildFormulaTilesHtml(
    forms, segs, allIngs, query, /* showArchived */ false, /* showUsarComoBase */ false
  );

  _ciActualizarContadorBusqueda('ci-dash-search-count', query.trim(), total, archivedShown);

  if (!total) {
    grid.innerHTML = query.trim()
      ? `<div class="empty" style="grid-column:1/-1">Sin fórmulas que coincidan con "${esc(query.trim())}".</div>`
      : '<div class="empty" style="grid-column:1/-1">Sin fórmulas. Creá una en la pestaña Formulación.</div>';
    return;
  }

  grid.innerHTML = html;
}

// Abre la vista detalle de una fórmula dentro del Dashboard
```

Nota: `showArchived` es siempre `false` para Dashboard (nunca mostró archivadas fuera de una
búsqueda — comportamiento preservado) — pero como `_ciBuildFormulaTilesHtml` ignora
`showArchived` en cuanto hay query (ver Task 7), una búsqueda en Dashboard SÍ va a poder mostrar
archivadas con su tag `ARCH`, algo que Dashboard no podía hacer antes de este plan (capacidad
nueva, pedida explícitamente en el brainstorming).

- [ ] **Step 2: Verificar sintaxis**

Run: `node --check ci/ci_app.js`
Expected: sin salida (exit code 0).

- [ ] **Step 3: Confirmar que no queda ninguna referencia muerta**

Run: `grep -n "ci-dash-metrics\|ci-dash-mval\|ci-dash-mlbl\|ci-dash-last-nota\|ci-dash-dias-badge\|lastNota\|ratioBar" ci/ci_app.js`
Expected: sin resultados (todas las referencias vivían solo en las dos funciones ya reescritas).

Aparte, correr: `grep -n "seg-tc-tag-gen" ci/ci_app.js`
Expected: **exactamente un** resultado, dentro de `_segRenderTandaCard` (la card de tandas SEG,
línea ~3665 antes de este plan) — esa sí sigue usando `seg-tc-tag-gen` sin color de GE a
propósito (fuera de alcance, ver spec sección "Fuera de alcance"). Si aparece más de un
resultado, algo de la migración de las cards de Dashboard/Formulación quedó a medio hacer.

- [ ] **Step 4: Commit**

```bash
git add ci/ci_app.js
git commit -m "$(cat <<'EOF'
refactor(ci): ciRenderDashboard usa el helper compartido de tiles

Elimina las últimas ~90 líneas duplicadas — las dos vistas
(Dashboard/Formulación) comparten ahora un solo builder de card.
Dashboard gana buscador y, como efecto del override de archivadas
en el helper, puede mostrar una fórmula archivada (con tag ARCH)
cuando matchea una búsqueda — antes nunca las mostraba.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Verificación funcional en Chrome real (datos sintéticos)

**Files:** ninguno (solo verificación, sin cambios de código)

- [ ] **Step 1: Levantar el servidor local**

Run: `cd "c:/Users/JET/Desktop/MOBY DICK/biolab-app" && ./serve.bat` (o `start-server.sh` según
el entorno — el puerto ya está fijado en 8734 en los 3 lugares que lo hardcodean, ver CLAUDE.md
del repo). Dejarlo corriendo en background.

- [ ] **Step 2: Abrir la app y navegar a CI**

Usar las tools `mcp__chrome-devtools__new_page` (navegar a `http://localhost:8734`) y
`mcp__chrome-devtools__navigate_page` según haga falta. Confirmar que carga sin errores de
consola con `mcp__chrome-devtools__list_console_messages`.

- [ ] **Step 3: Inyectar datos sintéticos (NUNCA el backup real del usuario)**

Con `mcp__chrome-devtools__evaluate_script`, ejecutar en la página:

```js
() => {
  const ge = {
    nodes: [{
      id: 'NODE-TEST-SP', name: 'Psilocybe cubensis', type: 'species', color: '#70ad47',
      children: [{
        id: 'NODE-TEST-244', name: '244', type: 'phenotype', color: '#008cff', children: []
      }, {
        id: 'NODE-TEST-210', name: '210', type: 'phenotype', color: '#008cff', children: []
      }]
    }, {
      id: 'NODE-TEST-HB', name: 'Hillbilly Clon 1', type: 'phenotype', color: '#ff7300', children: []
    }]
  };
  localStorage.setItem('biolab.ge.v4', JSON.stringify(ge));

  const forms = [
    { id: 'CI-TEST-1', nombre: 'AGO-TEST (activo)', version: 'v1', fecha: '2026-08-19T05:00:00.000Z',
      ingredientes: [
        { id: 'ING-1', qty: 1000, snapshot: { nombre: 'Agua filtrada', unidad: 'ml' } },
        { id: 'ING-2', qty: 5000, snapshot: { nombre: "BOB'S RED MILL - Levadura de cerveza", unidad: 'mg' } },
      ] },
    { id: 'CI-TEST-2', nombre: 'R-Hillbilly-TEST (colonizada)', version: 'v1', fecha: '2026-04-16T00:00:00.000Z',
      ingredientes: [
        { id: 'ING-1', qty: 1000, snapshot: { nombre: 'Agua filtrada', unidad: 'ml' } },
      ] },
    { id: 'CI-TEST-3', nombre: 'Vieja-Archivada-TEST', version: 'v1', fecha: '2026-01-01T00:00:00.000Z',
      archivada: true,
      ingredientes: [
        { id: 'ING-2', qty: 1, snapshot: { nombre: "BOB'S RED MILL - Levadura de cerveza", unidad: 'mg' } },
      ] },
  ];
  localStorage.setItem('bl2_forms', JSON.stringify(forms));

  const seg = [
    { formula_id: 'CI-TEST-1', genetica: 'NODE-TEST-244', experimentoId: 'EXP-TEST-1', experimentoFrascoId: "A' Ca restaurado",
      inoculoFecha: '2026-08-19T02:04', inoculoTs: '2026-08-19T05:04:00.000Z', colonizacion: '', placas: 5, contaminados: 0 },
    { formula_id: 'CI-TEST-1', genetica: 'NODE-TEST-210', experimentoId: 'EXP-TEST-1', experimentoFrascoId: "B' Ca+Fosfato",
      inoculoFecha: '2026-08-19T02:05', inoculoTs: '2026-08-19T05:05:00.000Z', colonizacion: '', placas: 4, contaminados: 0 },
    { formula_id: 'CI-TEST-2', genetica: 'NODE-TEST-HB',
      inoculoFecha: '2026-04-16T00:00', colonizacion: '2026-04-30T00:00', placas: 5, contaminados: 0 },
  ];
  localStorage.setItem('bl2_seg', JSON.stringify(seg));

  const exps = [
    { id: 'EXP-TEST-1', formulaId: 'CI-TEST-1', nombre: 'Restauración calcio TEST',
      frascos: [
        { id: 0, label: "A' Ca restaurado" }, { id: 1, label: "B' Ca+Fosfato" },
        { id: 2, label: 'A2 +Arginina' }, { id: 3, label: 'A4 Ca mixto jugado' },
      ] },
  ];
  localStorage.setItem('bl2_experimentos', JSON.stringify(exps));

  return 'seeded';
}
```

Expected: devuelve `"seeded"`.

- [ ] **Step 4: Recargar el módulo CI y sacar screenshot del Dashboard**

Navegar de nuevo a `http://localhost:8734` (o llamar `loadModule('CI')` vía
`evaluate_script` si ya está montado), esperar a que cargue con
`mcp__chrome-devtools__wait_for`, y usar `mcp__chrome-devtools__take_screenshot`.

Verificar visualmente:
- Card "AGO-TEST (activo)": chips 🧬 244 / 🧬 210 en azul (`#008cff`), 4 chips 🔬 con los labels
  reales de los frascos, badge de días en ámbar con formato `D+N` y punto pulsante, SIN nota,
  SIN barra de progreso.
- Card "R-Hillbilly-TEST (colonizada)": chip 🧬 en naranja (`#ff7300`), SIN chips de experimento
  (no tiene), badge de días en blanco/neutro `D 14` sin punto.
- Card "Vieja-Archivada-TEST" NO debe aparecer (Dashboard sin búsqueda no muestra archivadas).

- [ ] **Step 5: Probar el buscador del Dashboard**

Con `mcp__chrome-devtools__take_snapshot` para obtener el `uid` del input `#ci-dash-search`, usar
`mcp__chrome-devtools__fill` para tipear `levadura`. Screenshot.

Verificar: aparecen "AGO-TEST (activo)" Y "Vieja-Archivada-TEST" (con tag `ARCH` visible) —
confirma que la búsqueda SÍ trae archivadas en Dashboard, aunque nunca las muestre sin query.
"R-Hillbilly-TEST" desaparece (no tiene levadura entre sus ingredientes). El contador debe decir
algo como "2 fórmulas encontradas por "levadura" — incluye 1 archivada".

Borrar el input (`fill` con string vacío) y confirmar que vuelve a las 2 fórmulas no-archivadas.

- [ ] **Step 6: Probar el buscador de Formulación**

Cambiar a la pestaña "🧪 Formulación" (`mcp__chrome-devtools__click` sobre el tab). Tipear `244`
en `#ci-formulas-search` — debe matchear "AGO-TEST (activo)" por genética. Tipear `hillbilly` —
debe matchear "R-Hillbilly-TEST" por nombre. Screenshot de al menos uno de los dos casos.

- [ ] **Step 7: Revisar consola por errores**

Run: `mcp__chrome-devtools__list_console_messages`
Expected: sin `error` nuevos atribuibles a este cambio (pueden existir warnings preexistentes del
resto de la app — no es objeto de este plan corregirlos).

- [ ] **Step 8: Limpiar los datos sintéticos del navegador**

Con `evaluate_script`:

```js
() => {
  ['biolab.ge.v4', 'bl2_forms', 'bl2_seg', 'bl2_experimentos'].forEach(k => localStorage.removeItem(k));
  return 'cleared';
}
```

Expected: devuelve `"cleared"`. Este paso es importante — sin él, la próxima vez que el usuario
abra la app en ese mismo navegador vería los datos de prueba en vez de los suyos.

- [ ] **Step 9: Cerrar la página de Chrome y detener el servidor**

Usar `mcp__chrome-devtools__close_page`. Detener el proceso de `serve.bat`/`start-server.sh`
levantado en el Step 1.

No hay commit en este task — es solo verificación, ningún archivo cambia.

---

## Task 11: Auditoría final de dead code + cierre

**Files:** ninguno esperado, salvo que la auditoría encuentre algo

- [ ] **Step 1: Confirmar que `_segAbreviarEspecie`/`_segSoloUltimoSegmento` siguen teniendo
  otros consumidores** (no se tocan, pero hay que confirmar que no quedaron huérfanas por error)

Run: `grep -n "_segAbreviarEspecie\|_segSoloUltimoSegmento" ci/ci_app.js`
Expected: matches en la definición de ambas funciones (~línea 2238 y 2254) MÁS al menos un uso
en otro lugar del archivo (fuera de las dos funciones que este plan reescribió). Si alguna
quedó sin ningún otro consumidor, NO borrarla en este plan — marcarlo como hallazgo para una
sesión aparte (no es parte del scope acordado).

- [ ] **Step 2: Confirmar que `expCount`/`SEG.seguimientoNotas` no quedaron huérfanos en otro
  lado del módulo por culpa de este cambio**

Run: `grep -n "SEG.seguimientoNotas\[" ci/ci_app.js`
Expected: matches en otros lugares del archivo (ej. `_segActualizarBadgeSeguimiento`) — confirma
que la estructura sigue viva para otros consumidores, solo dejó de leerse en las cards de
Dashboard/Formulación.

- [ ] **Step 3: Correr los 4 tests Node de este plan juntos, una última vez, contra el código
  YA integrado** (copiar las funciones reales del archivo a un script de verificación final, no
  reescribirlas de memoria)

Run:
```bash
node -e "
const fs = require('fs');
const src = fs.readFileSync('ci/ci_app.js', 'utf8');
['_ciHexToRgba','_ciResolveGeColor','_ciGenChipHtml','_ciExpFrascoChipsFromList','_ciExpFrascoChipsHtml','_ciNormalizeSearchText','_ciFormulaMatchesQuery','_ciDiasActivosHtml','_ciActualizarContadorBusqueda','_ciBuildFormulaTile','_ciBuildFormulaTilesHtml'].forEach(fn => {
  if (!src.includes('function ' + fn + '(')) { console.error('FALTA: ' + fn); process.exitCode = 1; }
});
console.log('Todas las funciones nuevas están presentes en ci_app.js');
"
```
Expected: `Todas las funciones nuevas están presentes en ci_app.js`, exit code 0.

- [ ] **Step 4: `node --check` final sobre los 3 archivos tocados**

Run: `node --check ci/ci_app.js && echo OK-JS`
Expected: `OK-JS`

(no aplica `--check` a `.html`/`.css` — no son JS; su validez ya se ejerció visualmente en el
Task 10)

Este task no genera un commit propio salvo que el Step 1 o 2 encuentren algo que corregir — si
todo está limpio, el plan queda cerrado en el commit del Task 9.
