# GR — Indicador de BE por protocolo + orden por BE — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar BE agregado (prom + mejor bolsa) por protocolo en las cards de GR — Registro y
permitir ordenar por esos valores, reutilizando el join GR→SU→FR que ya existe
(`grComputarAnalisis`).

**Architecture:** Un campo nuevo (`beMejor`) en el retorno de `grComputarAnalisis`, un mapa
pre-construido por render pass (mismo patrón que `_fMap`/`_cMap`), 2 branches nuevas en el
comparador de sort que ya existe, 2 opciones nuevas en el `<select>` que ya existe, 1 chip nuevo en
la stats-bar de la card. 100% lectura, cero storage nuevo.

**Tech Stack:** Vanilla JS, sin test runner — verificación con script Node standalone (misma
convención de `docs/superpowers/plans/2026-09-06-gr-protocolo-color.md`).

---

### Task 1: `beMejor` en `grComputarAnalisis`

**Files:** Modify: `gr/gr_app.js:3914-3927` (return de `grComputarAnalisis`)

- [ ] **Step 1: Agregar el campo**

Ubicar:
```js
    return {
        grLoteId: grLoteId,
        grLote: grLote,
        suLotes: suUsados,
        fr: {
            bolsasTrackeadas: frLinkadas.length,
            bePromedio: bePromedio,
            biomasaFrescaTotal: biomasaFrescaTotal,
            biomasaSecaTotal: biomasaSecaTotal,
            rendFrescoPorBolsa: frLinkadas.length > 0 ? biomasaFrescaTotal / frLinkadas.length : 0,
            oleadasTotal: oleadasTotal
        },
        tandas: tandas
    };
```
Reemplazar por (agrega `beMejor`, calculado sobre el mismo array `beValues` que ya arma
`bePromedio` un poco más arriba en la función — no se recalcula nada, solo se expone el máximo):
```js
    return {
        grLoteId: grLoteId,
        grLote: grLote,
        suLotes: suUsados,
        fr: {
            bolsasTrackeadas: frLinkadas.length,
            bePromedio: bePromedio,
            beMejor: beValues.length > 0 ? Math.max.apply(null, beValues) : 0,
            biomasaFrescaTotal: biomasaFrescaTotal,
            biomasaSecaTotal: biomasaSecaTotal,
            rendFrescoPorBolsa: frLinkadas.length > 0 ? biomasaFrescaTotal / frLinkadas.length : 0,
            oleadasTotal: oleadasTotal
        },
        tandas: tandas
    };
```

- [ ] **Step 2: Commit**

```bash
git add gr/gr_app.js
git commit -m "$(cat <<'EOF'
feat: expone BE de la mejor bolsa en grComputarAnalisis

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: mapa de análisis + sort por BE + chip en la card

**Files:** Modify: `gr/gr_app.js` (`grRenderizarRegistroLotes`, líneas ~1144-1301)

- [ ] **Step 1: Pre-construir el mapa de análisis**

Ubicar:
```js
    // Pre-build maps una sola vez para todo el render (O(n) en vez de O(n×m))
    const _fMap = _grFormsMap();
    const _cMap = _grCultivosMap();
```
Reemplazar por:
```js
    // Pre-build maps una sola vez para todo el render (O(n) en vez de O(n×m))
    const _fMap = _grFormsMap();
    const _cMap = _grCultivosMap();
    const _anMap = {};
    lotesData.forEach(function(l) {
        if (l && l.id) _anMap[l.id] = window.grComputarAnalisis(l.id);
    });
```
Nota: se construye sobre `lotesData` completo (no solo `lotesValidos`, que recién se calcula unas
líneas más abajo) — `grComputarAnalisis` ya maneja `grLoteId` inexistente devolviendo `grLote:
null` sin tirar, así que no hace falta esperar al filtro.

- [ ] **Step 2: Agregar las 2 branches de sort**

Ubicar:
```js
    const lotesOrdenados = [...lotesValidos].sort((a, b) => {
        if (_grSortMode === 'fecha_asc')  return new Date(a.fecha) - new Date(b.fecha);
        if (_grSortMode === 'id_asc')     return (a.id || '').localeCompare(b.id || '');
        if (_grSortMode === 'nombre')     return (a.nombre || '').localeCompare(b.nombre || '');
        if (_grSortMode === 'disp_desc') {
```
Insertar 2 branches nuevas antes de `disp_desc` (después de `nombre`):
```js
    const lotesOrdenados = [...lotesValidos].sort((a, b) => {
        if (_grSortMode === 'fecha_asc')  return new Date(a.fecha) - new Date(b.fecha);
        if (_grSortMode === 'id_asc')     return (a.id || '').localeCompare(b.id || '');
        if (_grSortMode === 'nombre')     return (a.nombre || '').localeCompare(b.nombre || '');
        if (_grSortMode === 'beProm') {
            const beA = (_anMap[a.id] && _anMap[a.id].fr.bolsasTrackeadas > 0) ? _anMap[a.id].fr.bePromedio : -1;
            const beB = (_anMap[b.id] && _anMap[b.id].fr.bolsasTrackeadas > 0) ? _anMap[b.id].fr.bePromedio : -1;
            return beB - beA;
        }
        if (_grSortMode === 'beMejor') {
            const bmA = (_anMap[a.id] && _anMap[a.id].fr.bolsasTrackeadas > 0) ? _anMap[a.id].fr.beMejor : -1;
            const bmB = (_anMap[b.id] && _anMap[b.id].fr.bolsasTrackeadas > 0) ? _anMap[b.id].fr.beMejor : -1;
            return bmB - bmA;
        }
        if (_grSortMode === 'disp_desc') {
```
Lotes sin trazabilidad FR utilizable (`bolsasTrackeadas === 0`) usan sentinel `-1` — siempre
quedan al final en orden descendente, nunca hay BE real negativo.

- [ ] **Step 3: Agregar el chip de BE a la stats-bar de la card**

Ubicar, dentro del `.map(lote => {...})`, la línea donde arranca el bloque de variables por card
(justo después de `const usadosRefLote = usadosRefMap[lote.id] || {};`):
```js
        const usadosRefLote = usadosRefMap[lote.id] || {};
```
Insertar debajo:
```js
        const usadosRefLote = usadosRefMap[lote.id] || {};
        const _an = _anMap[lote.id];
        const beChip = (_an && _an.fr.bolsasTrackeadas > 0)
            ? `<span class="gr-stat-chip" title="${_an.fr.bolsasTrackeadas} bolsa${_an.fr.bolsasTrackeadas !== 1 ? 's' : ''} FR trackeada${_an.fr.bolsasTrackeadas !== 1 ? 's' : ''}">🏆 BE ${_an.fr.bePromedio.toFixed(0)}% prom · 🥇 ${_an.fr.beMejor.toFixed(0)}% mejor</span>`
            : '';
```
Y en la stats-bar (ubicar):
```js
            <div class="gr-card-stats-bar">
                <span class="gr-stat-chip">${dgArr.length} tanda${dgArr.length !== 1 ? 's' : ''}</span>
                <span class="gr-stat-chip">${sumFrascos} ud</span>
                ${contamChip}
                <span class="gr-stat-chip ${dispClass}">▸ ${sumDisp} disponibles</span>
                ${acciones}
            </div>
```
Reemplazar por:
```js
            <div class="gr-card-stats-bar">
                <span class="gr-stat-chip">${dgArr.length} tanda${dgArr.length !== 1 ? 's' : ''}</span>
                <span class="gr-stat-chip">${sumFrascos} ud</span>
                ${contamChip}
                <span class="gr-stat-chip ${dispClass}">▸ ${sumDisp} disponibles</span>
                ${beChip}
                ${acciones}
            </div>
```

- [ ] **Step 4: Commit**

```bash
git add gr/gr_app.js
git commit -m "$(cat <<'EOF'
feat: agrega indicador de BE agregado y orden por BE en Registro de GR

Reutiliza grComputarAnalisis (join GR->SU->FR ya existente) para mostrar
BE promedio/mejor bolsa por protocolo, sin escribir nada nuevo en storage.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 2 opciones nuevas en el selector de orden

**Files:** Modify: `gr/gr_index.html:490-496`

- [ ] **Step 1: Agregar las opciones**

Ubicar:
```html
                        <select id="grSortSelect" onchange="grSetSort(this.value)" style="font-size:11px;background:#1a1a1a;color:#ccc;border:1px solid #444;border-radius:6px;padding:4px 8px">
                            <option value="fecha_desc">Fecha ↓ (reciente)</option>
                            <option value="fecha_asc">Fecha ↑ (antiguo)</option>
                            <option value="id_asc">ID ↑ (A→Z)</option>
                            <option value="disp_desc">Disponibles ↓</option>
                            <option value="nombre">Nombre (A→Z)</option>
                        </select>
```
Reemplazar por:
```html
                        <select id="grSortSelect" onchange="grSetSort(this.value)" style="font-size:11px;background:#1a1a1a;color:#ccc;border:1px solid #444;border-radius:6px;padding:4px 8px">
                            <option value="fecha_desc">Fecha ↓ (reciente)</option>
                            <option value="fecha_asc">Fecha ↑ (antiguo)</option>
                            <option value="id_asc">ID ↑ (A→Z)</option>
                            <option value="disp_desc">Disponibles ↓</option>
                            <option value="nombre">Nombre (A→Z)</option>
                            <option value="beProm">BE promedio ↓</option>
                            <option value="beMejor">Mejor bolsa (BE) ↓</option>
                        </select>
```

- [ ] **Step 2: Commit**

```bash
git add gr/gr_index.html
git commit -m "$(cat <<'EOF'
feat: agrega opciones de orden por BE al selector de Registro de GR

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Verificación

- [ ] **Step 1: Syntax check**

Run: `node --check gr/gr_app.js`
Expected: sin output, exit code 0.

- [ ] **Step 2: Script de verificación de la lógica de sort en el scratchpad**

Crear `<scratchpad>/verify-gr-be-sort.js`:
```js
function sortByBE(lotes, anMap, mode) {
    return [...lotes].sort((a, b) => {
        if (mode === 'beProm') {
            const beA = (anMap[a.id] && anMap[a.id].fr.bolsasTrackeadas > 0) ? anMap[a.id].fr.bePromedio : -1;
            const beB = (anMap[b.id] && anMap[b.id].fr.bolsasTrackeadas > 0) ? anMap[b.id].fr.bePromedio : -1;
            return beB - beA;
        }
        if (mode === 'beMejor') {
            const bmA = (anMap[a.id] && anMap[a.id].fr.bolsasTrackeadas > 0) ? anMap[a.id].fr.beMejor : -1;
            const bmB = (anMap[b.id] && anMap[b.id].fr.bolsasTrackeadas > 0) ? anMap[b.id].fr.beMejor : -1;
            return bmB - bmA;
        }
        return 0;
    });
}

function assertEq(actual, expected, label) {
    var a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a !== e) { console.error('FAIL ' + label + ': got ' + a + ', expected ' + e); process.exitCode = 1; }
    else console.log('PASS ' + label);
}

var lotes = [{ id: 'GR-A' }, { id: 'GR-B' }, { id: 'GR-C' }];
var anMap = {
    'GR-A': { fr: { bolsasTrackeadas: 2, bePromedio: 120, beMejor: 150 } },
    'GR-B': { fr: { bolsasTrackeadas: 1, bePromedio: 200, beMejor: 200 } },
    'GR-C': { fr: { bolsasTrackeadas: 0, bePromedio: 0, beMejor: 0 } }
};

assertEq(sortByBE(lotes, anMap, 'beProm').map(l => l.id), ['GR-B', 'GR-A', 'GR-C'], 'orden por BE promedio, sin dato al final');
assertEq(sortByBE(lotes, anMap, 'beMejor').map(l => l.id), ['GR-B', 'GR-A', 'GR-C'], 'orden por mejor bolsa, sin dato al final');

console.log('Listo.');
```

Run: `node <scratchpad>/verify-gr-be-sort.js`
Expected: 2 líneas `PASS`, `Listo.`, exit code 0.

---

## Resumen de archivos tocados

- `gr/gr_app.js` — `beMejor` en `grComputarAnalisis`, mapa `_anMap`, 2 branches de sort, chip de
  BE en la card.
- `gr/gr_index.html` — 2 `<option>` en `#grSortSelect`.

Nada de esto toca `main.js`, `cilab_conocimiento.js`, ni ningún módulo fuera de GR.
