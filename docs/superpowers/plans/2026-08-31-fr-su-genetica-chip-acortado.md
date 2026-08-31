# FR/SU — Genética acortada a chip coloreado Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** En las vistas de lista de FR (tabla Activo/Cosecha/Archivo, Pendientes, Vista General) y en las cards de Registro de SU, mostrar solo el último eslabón de la cadena genética (ej. `F2B` en vez de `PC / APE / APE 338 / SIF / F2 / F2B`) como chip coloreado con el color ya asignado al nodo en GE, con la cadena completa disponible como tooltip.

**Architecture:** Un helper puro `_genChipHtml(fullChainStr, fenId)` por módulo (FR y SU mantienen helpers de display duplicados por convención existente, ver `_abbrevGen`) que separa el último segmento, resuelve el color del nodo GE por `fenId` con fallback en dos pasos (`window.ge.getNode` → `window.GEResolve.resolverNodoCrudo`), y arma un `<span>` chip reusando las clases CSS `.fr-chip`/`.su-kchip` ya existentes. Cero cambios de datos persistidos — es 100% capa de render.

**Tech Stack:** JS vanilla (sin build step, sin framework), localStorage como persistencia, sin test runner en el repo — la verificación de la lógica pura se hace con un script Node desechable y la verificación de integración con Chrome real (chrome-devtools MCP) sobre un backup real del laboratorio.

**Spec:** `docs/superpowers/specs/2026-08-31-fr-su-genetica-chip-acortado-design.md`

---

### Task 1: Verificar la lógica pura (hex→rgba, último segmento) con un script Node desechable

Antes de tocar `fr_app.js`/`su_app.js`, confirmar que la conversión hex→rgba y el parseo
"último segmento de una cadena `' / '`" se comportan bien en los casos borde reales (cadena con
un solo segmento, hex inválido, mayúsculas/minúsculas en el hex) usando un script Node aislado
— no hay test runner en este repo, y esta parte es lógica pura sin DOM, así que no hace falta
Chrome para validarla.

**Files:**
- Create (temporal, se borra al final del task): `C:\Users\JET\AppData\Local\Temp\claude\c--Users-JET-Desktop-MOBY-DICK-biolab-app\42787294-1ef2-446d-a84a-2a85d55aeab5\scratchpad\gen-chip-logic-check.js`

- [x] **Step 1: Escribir el script de verificación**

```js
// gen-chip-logic-check.js — smoke test desechable, NO se commitea
function hexToRgba(hex, alpha) {
    if (typeof hex !== 'string') return null;
    var m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
    if (!m) return null;
    var n = parseInt(m[1], 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

function lastSegment(fullChainStr) {
    var parts = String(fullChainStr).split('/').map(function(s) { return s.trim(); }).filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : fullChainStr;
}

var cases = [
    { fn: 'hexToRgba', args: ['#56E87A', 0.15], expect: 'rgba(86,232,122,0.15)' },
    { fn: 'hexToRgba', args: ['#000000', 0.4],  expect: 'rgba(0,0,0,0.4)' },
    { fn: 'hexToRgba', args: ['56E87A', 0.15],  expect: null },       // sin '#' → inválido
    { fn: 'hexToRgba', args: ['#FFF', 0.15],    expect: null },       // 3 dígitos → inválido
    { fn: 'hexToRgba', args: [null, 0.15],      expect: null },
    { fn: 'lastSegment', args: ['PC / APE / APE 338 / SIF / F2 / F2B'], expect: 'F2B' },
    { fn: 'lastSegment', args: ['PC / APE / APE 338 / SIF / F2 / 210'], expect: '210' },
    { fn: 'lastSegment', args: ['F2B'],          expect: 'F2B' },     // sin '/' → tal cual
    { fn: 'lastSegment', args: ['PC /  / F2B'],  expect: 'F2B' },     // segmento vacío en medio, filtrado
];

var fns = { hexToRgba: hexToRgba, lastSegment: lastSegment };
var fails = 0;
cases.forEach(function(c) {
    var got = fns[c.fn].apply(null, c.args);
    var ok = got === c.expect;
    if (!ok) fails++;
    console.log((ok ? 'OK  ' : 'FAIL') + ' ' + c.fn + '(' + JSON.stringify(c.args) + ') = ' + JSON.stringify(got) + (ok ? '' : ' (esperado ' + JSON.stringify(c.expect) + ')'));
});
console.log(fails === 0 ? '\nTodos los casos pasaron.' : '\n' + fails + ' caso(s) fallaron.');
process.exit(fails === 0 ? 0 : 1);
```

- [x] **Step 2: Correrlo** — 9/9 OK, exit 0. Lógica confirmada sin cambios.

Run: `node "C:\Users\JET\AppData\Local\Temp\claude\c--Users-JET-Desktop-MOBY-DICK-biolab-app\42787294-1ef2-446d-a84a-2a85d55aeab5\scratchpad\gen-chip-logic-check.js"`

Expected: 9 líneas `OK`, termina con "Todos los casos pasaron." y exit code 0. Si algo falla,
ajustar la función correspondiente en el script y volver a correr antes de continuar — la
versión que quede validada acá es la que se copia literal a `fr_app.js`/`su_app.js` en los
Tasks 2 y 5.

No hace falta borrar el script del scratchpad — es un directorio de sesión, no se commitea.

---

### Task 2: FR — helpers de chip + nueva `_geChipFromBolsa` (sin tocar `_geTxtFromBolsa`)

**`_geTxtFromBolsa(b)` NO se modifica.** Además de alimentar el render, la usan
`_frBuscar` (búsqueda libre, `fr_app.js:1402-1403`) y `_sortValue` (ordenar por columna
"Genética", `fr_app.js:1418`) — ambas esperan texto plano. Si `_geTxtFromBolsa` empezara a
devolver el HTML del chip, la búsqueda pasaría a matchear contra `<span class="fr-chip"...`
en vez del nombre real, y el sort ordenaría por el string HTML crudo (todas las filas con
color agrupadas por clase/estilo, no alfabéticamente por genética) — una regresión real, no
hipotética. Por eso se agrega una función nueva, `_geChipFromBolsa`, con la misma forma que
`_geTxtFromBolsa` pero devolviendo chips — usada SOLO en los 3 render call sites del Task 3.

**Files:**
- Modify: `fr\fr_app.js:2903-2925`

- [x] **Step 1: Agregar los helpers de chip y `_geChipFromBolsa` después de `_geTxtFromBolsa`**

Texto actual (`fr_app.js:2903-2925`):

```js
    // Abreviaciones de especie para display — no modifica storage
    function _abbrevGen(s) {
        return s ? s.replace(/Psilocybe cubensis/gi, 'PC') : s;
    }

    function _grTxtFromBolsa(b) {
        if (Array.isArray(b.grSources) && b.grSources.length > 1) {
            return b.grSources.map(function(s) {
                return (s.grLoteId || '—') + (s.grTandaId ? ' · ' + s.grTandaId : '');
            }).join(' + ');
        }
        return (b.grLoteId || '—') + (b.grTandaId ? ' · ' + b.grTandaId : '');
    }

    function _geTxtFromBolsa(b) {
        if (Array.isArray(b.grSources) && b.grSources.length > 1) {
            var labels = b.grSources
                .map(function(s) { return _abbrevGen(s.geneticaFull || ''); })
                .filter(Boolean);
            if (labels.length > 1) return labels.join(' + ');
        }
        return _abbrevGen(b.geneticaFull || [b.genetica, b.fenotipo].filter(Boolean).join(' / ') || '—');
    }
```

Reemplazar por (agrega debajo, no toca ninguna línea de las 3 funciones existentes):

```js
    // Abreviaciones de especie para display — no modifica storage
    function _abbrevGen(s) {
        return s ? s.replace(/Psilocybe cubensis/gi, 'PC') : s;
    }

    function _grTxtFromBolsa(b) {
        if (Array.isArray(b.grSources) && b.grSources.length > 1) {
            return b.grSources.map(function(s) {
                return (s.grLoteId || '—') + (s.grTandaId ? ' · ' + s.grTandaId : '');
            }).join(' + ');
        }
        return (b.grLoteId || '—') + (b.grTandaId ? ' · ' + b.grTandaId : '');
    }

    function _geTxtFromBolsa(b) {
        if (Array.isArray(b.grSources) && b.grSources.length > 1) {
            var labels = b.grSources
                .map(function(s) { return _abbrevGen(s.geneticaFull || ''); })
                .filter(Boolean);
            if (labels.length > 1) return labels.join(' + ');
        }
        return _abbrevGen(b.geneticaFull || [b.genetica, b.fenotipo].filter(Boolean).join(' / ') || '—');
    }

    // Chip de genética acortado al último eslabón, coloreado con el color del nodo GE.
    // Solo para RENDER (ver _geChipFromBolsa más abajo) — _geTxtFromBolsa arriba sigue
    // devolviendo texto plano porque también la usan _frBuscar y _sortValue (búsqueda y
    // orden por columna), que necesitan comparar contra el nombre real, no contra HTML.
    // No modifica storage — 100% capa de render. Ver docs/superpowers/specs/
    // 2026-08-31-fr-su-genetica-chip-acortado-design.md.
    function _hexToRgba(hex, alpha) {
        if (typeof hex !== 'string') return null;
        var m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
        if (!m) return null;
        var n = parseInt(m[1], 16);
        var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
        return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
    }

    function _resolveGeColor(fenId) {
        if (!fenId) return null;
        try {
            if (window.ge && typeof window.ge.getNode === 'function') {
                var n = window.ge.getNode(fenId);
                if (n && n.color) return n.color;
            }
        } catch (e) {}
        try {
            if (window.GEResolve && typeof window.GEResolve.resolverNodoCrudo === 'function') {
                var r = window.GEResolve.resolverNodoCrudo(fenId);
                if (r && r.node && r.node.color) return r.node.color;
            }
        } catch (e) {}
        return null;
    }

    function _genChipHtml(fullChainStr, fenId) {
        if (!fullChainStr) return '—';
        var parts = String(fullChainStr).split('/').map(function(s) { return s.trim(); }).filter(Boolean);
        var label = parts.length > 0 ? parts[parts.length - 1] : fullChainStr;
        var hex = _resolveGeColor(fenId);
        var bg = hex ? _hexToRgba(hex, 0.15) : null;
        var border = hex ? _hexToRgba(hex, 0.40) : null;
        var cls = 'fr-chip' + (bg ? '' : ' fr-chip-neutral');
        var style = bg ? ' style="background:' + bg + ';border-color:' + border + ';color:' + esc(hex) + '"' : '';
        return '<span class="' + cls + '"' + style + ' title="' + esc(fullChainStr) + '">' + esc(label) + '</span>';
    }

    // grSources[] no guarda fenId por fuente (solo geneticaFull/inoculoSource/inoculoCiId,
    // ver fr_app.js:631-634) — se resuelve en vivo contra gr_lotes, lectura ya permitida para
    // FR (ver cabecera del módulo). Funciona igual para bolsas nuevas y ya selladas.
    function _fenIdForGrSource(s) {
        if (!s || !s.grLoteId || !s.grTandaId) return null;
        try {
            var grMap = getGRLotesMap();
            var l = grMap[s.grLoteId];
            if (!l || !Array.isArray(l.dg)) return null;
            var t = l.dg.filter(function(row) { return row.tanda === s.grTandaId; })[0];
            return (t && t.fen_id) || null;
        } catch (e) { return null; }
    }

    // Mismo shape que _geTxtFromBolsa (arriba) pero devuelve chips en vez de texto plano.
    // Usar SOLO para render (filaTabla/filaPendiente/_ovFilas, Task 3) — nunca para
    // búsqueda/orden, para eso sigue existiendo _geTxtFromBolsa sin tocar.
    function _geChipFromBolsa(b) {
        if (Array.isArray(b.grSources) && b.grSources.length > 1) {
            var chips = b.grSources
                .map(function(s) { return _genChipHtml(s.geneticaFull || '', _fenIdForGrSource(s)); })
                .filter(function(h) { return h && h !== '—'; });
            if (chips.length > 1) return chips.join(' + ');
        }
        return _genChipHtml(b.geneticaFull || [b.genetica, b.fenotipo].filter(Boolean).join(' / ') || '', b.fenId);
    }
```

- [x] **Step 2: Verificar que no rompió sintaxis** — `node --check` limpio.

- [x] **Step 3: Commit** — `d50c061`. Spec review ✅, code quality review: Ready to merge (2 nits menores, no bloqueantes: `_hexToRgba` llamada 2x por chip, `getGRLotesMap()` sin cachear en multi-source — quedan como posible follow-up, no bloquean).

---

### Task 3: FR — usar el chip en los 3 render call sites (tabla principal, Vista General, Pendientes)

**Files:**
- Modify: `fr\fr_app.js:1264` y `:1322` (`filaTabla`)
- Modify: `fr\fr_app.js:2721-2725,2735` (`_ovFilas`)
- Modify: `fr\fr_app.js:2928` y `:2940` (`filaPendiente`)

- [x] **Step 1: `filaTabla` — usar `_geChipFromBolsa` como fuente y dejar de escapar `ge` (ya viene como HTML seguro)**

Texto actual (`fr_app.js:1264`):
```js
        var ge = _geTxtFromBolsa(b);
```

Reemplazar por:
```js
        var ge = _geChipFromBolsa(b);
```

Texto actual (`fr_app.js:1322`):
```js
            + '<td ' + cl + '>' + esc(ge) + '</td>'
```

Reemplazar por:
```js
            + '<td ' + cl + '>' + ge + '</td>'
```

- [x] **Step 2: `_ovFilas` — usar `_genChipHtml` en vez de `_abbrevGen` y sacar el `title` redundante del `<td>`**

Texto actual (`fr_app.js:2721-2725`):
```js
            var ge   = _abbrevGen(
                b.geneticaFull ||
                [b.genetica, b.fenotipo].filter(Boolean).join(' / ') ||
                '—'
            );
```

Reemplazar por:
```js
            var ge   = _genChipHtml(
                b.geneticaFull || [b.genetica, b.fenotipo].filter(Boolean).join(' / ') || '',
                b.fenId
            );
```

Texto actual (`fr_app.js:2735`):
```js
                + '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(ge) + '">' + esc(ge) + '</td>'
```

Reemplazar por (el `title` ahora vive en el `<span>` del chip, no hace falta duplicarlo en el
`<td>` — y duplicarlo con `esc(ge)` mostraría el HTML crudo del chip como texto del tooltip,
que sería incorrecto):
```js
                + '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + ge + '</td>'
```

- [x] **Step 3: `filaPendiente` — mismo cambio que Step 1 (fuente + render)**

Texto actual (`fr_app.js:2928`):
```js
        var ge    = _geTxtFromBolsa(b);
```

Reemplazar por:
```js
        var ge    = _geChipFromBolsa(b);
```

Texto actual (`fr_app.js:2940`):
```js
            + '<td>' + esc(ge) + '</td>'
```

Reemplazar por:
```js
            + '<td>' + ge + '</td>'
```

- [x] **Step 4: Verificar sintaxis** — limpio.

- [x] **Step 5: Commit** — `ecec023`. Spec review ✅. Code quality: Ready to merge (2 nits menores: `_ovFilas` pierde el hover en la franja vacía del `<td>` truncado, y la asimetría multi-source `_ovFilas` vs `filaTabla`/`filaPendiente` es heredada del código viejo, no introducida acá — ninguna bloqueante).

---

### Task 4: SU — cargar `shared/ge_resolve.js`

`su_index.html` es el único de los 4 módulos que consumen genética (CI/GR/FR ya lo hacen) que
no carga este script compartido — se necesita para resolver `node.color` por `fenId` cuando GE
no está montado en memoria.

**Files:**
- Modify: `su\su_index.html:499-504`

- [x] **Step 1: Agregar el script antes de `su_app.js`**

Texto actual (`su_index.html:499-504`):
```html
    <!-- Librería XLSX (para exportar/importar Excel) -->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
    <!-- Lib compartida: normalización de fuentes GR (grNormSources/suDbNormSources) -->
    <script src="../shared/gr_su_sources.js"></script>
    <!-- Lógica del módulo SU -->
    <script src="su_app.js"></script>
```

Reemplazar por:
```html
    <!-- Librería XLSX (para exportar/importar Excel) -->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
    <!-- Lib compartida: normalización de fuentes GR (grNormSources/suDbNormSources) -->
    <script src="../shared/gr_su_sources.js"></script>
    <!-- Lib compartida: resolver nodo GE por id (walk crudo de biolab.ge.v4) -->
    <script src="../shared/ge_resolve.js"></script>
    <!-- Lógica del módulo SU -->
    <script src="su_app.js"></script>
```

- [x] **Step 2: Commit** — `3baace2`. Verificado directo (diff de 2 lineas, sin colateral).

---

### Task 5: SU — helpers de chip + wiring en las sub-filas de Registro

**Files:**
- Modify: `su\su_app.js:1205-1208` (después de `_abbrevGen`)
- Modify: `su\su_app.js:1331-1351` (loop de `subs`)
- Modify: `su\su_styles.css:2083-2091` (`.su-sub-gen`)

- [x] **Step 1: Agregar los helpers después de `_abbrevGen`**

Texto actual (`su_app.js:1205-1208`):
```js
// Abreviaciones de especie para display — no modifica storage
function _abbrevGen(s) {
    return s ? s.replace(/Psilocybe cubensis/gi, 'PC') : s;
}
```

Reemplazar por:
```js
// Abreviaciones de especie para display — no modifica storage
function _abbrevGen(s) {
    return s ? s.replace(/Psilocybe cubensis/gi, 'PC') : s;
}

// Chip de genética acortado al último eslabón, coloreado con el color del nodo GE.
// No modifica storage — 100% capa de render. Ver docs/superpowers/specs/
// 2026-08-31-fr-su-genetica-chip-acortado-design.md.
function _suHexToRgba(hex, alpha) {
    if (typeof hex !== 'string') return null;
    var m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
    if (!m) return null;
    var n = parseInt(m[1], 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

function _suResolveGeColor(fenId) {
    if (!fenId) return null;
    try {
        if (window.ge && typeof window.ge.getNode === 'function') {
            var n = window.ge.getNode(fenId);
            if (n && n.color) return n.color;
        }
    } catch (e) {}
    try {
        if (window.GEResolve && typeof window.GEResolve.resolverNodoCrudo === 'function') {
            var r = window.GEResolve.resolverNodoCrudo(fenId);
            if (r && r.node && r.node.color) return r.node.color;
        }
    } catch (e) {}
    return null;
}

function _suGenChipHtml(fullChainStr, fenId) {
    if (!fullChainStr) return '—';
    var parts = String(fullChainStr).split('/').map(function(s) { return s.trim(); }).filter(Boolean);
    var label = parts.length > 0 ? parts[parts.length - 1] : fullChainStr;
    var hex = _suResolveGeColor(fenId);
    var bg = hex ? _suHexToRgba(hex, 0.13) : null;
    var border = hex ? _suHexToRgba(hex, 0.40) : null;
    var cls = 'su-kchip' + (bg ? '' : ' su-kchip-dim');
    var style = bg ? ' style="background:' + bg + ';border-color:' + border + ';color:' + suDbEscapeHtml(hex) + '"' : '';
    return '<span class="' + cls + '"' + style + ' title="' + suDbEscapeHtml(fullChainStr) + '">' + suDbEscapeHtml(label) + '</span>';
}
```

`suDbEscapeHtml` ya existe en `su_app.js:2542-2549` (definida más abajo en el archivo, pero
JS con `function` declarations se hoistea — es seguro llamarla desde acá arriba, mismo patrón
que ya usa el resto del archivo).

- [x] **Step 2: Capturar `fen_id` en el loop y usar el chip**

Texto actual (`su_app.js:1331-1351`):
```js
        const subs = db.map(function(r, i) {
            var normSrcs = suDbNormSources(r, lote.grProtocolo || '');
            var us = 0, pesoGranoSub = 0, grTxtParts = [];
            normSrcs.forEach(function(s) {
                var _us = parseInt(s.grUsados) || 0;
                us += _us;
                var _grL = grMap[s.grLoteId || ''];
                var _pf = 0, _gen = '';
                if (_grL) {
                    _pf = parseFloat(_grL.uf && _grL.uf.peso_unidad) || parseFloat(_grL.fr && _grL.fr.pesoFrasco) || 0;
                    if (Array.isArray(_grL.dg)) {
                        for (var k = 0; k < _grL.dg.length; k++) {
                            if (_grL.dg[k].tanda === s.grTandaId) { _gen = _grL.dg[k].genetica || ''; break; }
                        }
                    }
                }
                pesoGranoSub += _us * _pf;
                grTxtParts.push(s.grTandaId + (_gen ? ' — ' + _abbrevGen(_gen) : ''));
            });
```

Reemplazar por:
```js
        const subs = db.map(function(r, i) {
            var normSrcs = suDbNormSources(r, lote.grProtocolo || '');
            var us = 0, pesoGranoSub = 0, grTxtParts = [];
            normSrcs.forEach(function(s) {
                var _us = parseInt(s.grUsados) || 0;
                us += _us;
                var _grL = grMap[s.grLoteId || ''];
                var _pf = 0, _gen = '', _fenId = null;
                if (_grL) {
                    _pf = parseFloat(_grL.uf && _grL.uf.peso_unidad) || parseFloat(_grL.fr && _grL.fr.pesoFrasco) || 0;
                    if (Array.isArray(_grL.dg)) {
                        for (var k = 0; k < _grL.dg.length; k++) {
                            if (_grL.dg[k].tanda === s.grTandaId) { _gen = _grL.dg[k].genetica || ''; _fenId = _grL.dg[k].fen_id || null; break; }
                        }
                    }
                }
                pesoGranoSub += _us * _pf;
                grTxtParts.push(s.grTandaId + (_gen ? ' — ' + _suGenChipHtml(_gen, _fenId) : ''));
            });
```

Nota: `s.grTandaId` sigue sin escapar — así estaba antes de este cambio (gap preexistente, no
introducido acá), fuera de alcance tocarlo. Lo nuevo (`_gen` en el `title`/label del chip) sí
queda escapado por `_suGenChipHtml`.

- [x] **Step 3: Ajustar CSS — el chip no debe heredar `font-style: italic`**

Texto actual (`su_styles.css:2083-2091`):
```css
.su-sub-gen {
    font-size: 10.5px;
    font-style: italic;
    color: var(--text-muted, #888);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding-right: 8px;
}
```

Reemplazar por:
```css
.su-sub-gen {
    font-size: 10.5px;
    font-style: italic;
    color: var(--text-muted, #888);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding-right: 8px;
}
.su-sub-gen .su-kchip {
    font-style: normal;
}
```

- [x] **Step 4: Verificar sintaxis JS** — limpio.

- [x] **Step 5: Commit** — `7b4cbf8` + follow-up `2a735e0` (elimina `_abbrevGen`, confirmado sin call sites tras el wiring — hallazgo del spec reviewer, cleanup seguro por IIFE-scope, verificado). Spec review ✅. Code quality: Ready to merge, sin issues.

---

### Task 6: Verificación en Chrome real con un backup real del laboratorio

Esta parte es UI-facing (render, colores, tooltips) — se verifica con el navegador real vía
las herramientas `mcp__chrome-devtools__*`, no con un script Node. Se usa el backup real más
reciente que ya está en el repo (gitignored, solo local):
`docs/lab-intelligence/backups/biolab_full_backup - 10_08_2026_151232.json`.

**Files:** ninguno (solo lectura/verificación)

- [x] **Step 1: Levantar el servidor local**

Run (en background): `cd "c:\Users\JET\Desktop\MOBY DICK\biolab-app" && serve.bat`
Expected: sirviendo en `http://localhost:8734` (puerto documentado en `CLAUDE.md`).

- [x] **Step 2: Abrir la app y sembrar localStorage con el backup real** — 52 keys sembradas OK.

Usar `mcp__chrome-devtools__navigate_page` a `http://localhost:8734/`, luego
`mcp__chrome-devtools__evaluate_script` para leer el archivo de backup (vía `fetch` a una URL
servida por el mismo server, ej. copiar el JSON a `docs/lab-intelligence/backups/` ya está
servido porque está dentro del repo) y sembrar cada key:

```js
() => fetch('/docs/lab-intelligence/backups/biolab_full_backup - 10_08_2026_151232.json')
    .then(r => r.json())
    .then(data => {
        Object.keys(data).forEach(k => {
            var v = data[k];
            localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
        });
        return 'seeded ' + Object.keys(data).length + ' keys';
    });
```

Expected: retorna `"seeded N keys"` con N > 0. Si el fetch falla por espacios en la URL,
usar `encodeURI` sobre el path.

- [x] **Step 3: Recargar y abrir FR** — chips cortos coloreados confirmados (ej. `210`, `F2B 103`), multi-source `F2B 103 + 210` confirmado, `title` con cadena completa confirmado vía DOM (`Psilocybe cubensis / APE / APE 338 / SIF / F2 / 210`).

`mcp__chrome-devtools__navigate_page` reload, luego `mcp__chrome-devtools__evaluate_script`
con `() => loadModule('FR')`. Tomar `mcp__chrome-devtools__take_screenshot` de la tabla
principal (tab Activo, y Cosecha/Archivo si tienen filas).

Verificar visualmente:
- La columna de genética muestra un chip corto (último eslabón), no la cadena completa.
- El chip tiene color de fondo (no gris neutro) para al menos una fila — confirma que
  `_resolveGeColor` está resolviendo contra datos reales.
- Si existe alguna bolsa con `grSources.length > 1` en este backup, aparecen 2+ chips
  separados por `' + '` en esa fila.
- Hover sobre un chip (`mcp__chrome-devtools__hover` + leer el DOM, o
  `take_snapshot`/`evaluate_script` para leer el atributo `title`) muestra la cadena completa
  original.

- [x] **Step 4: Abrir Pendientes y Vista General de FR** — Vista General confirmada con chips cortos coloreados (66 bolsas reales). Este backup no tenía bolsas en estado Pendiente para verificar visualmente esa tabla puntual — mismo call site/misma función `_geChipFromBolsa` que la tabla principal, ya revisada por code+spec review en Task 3.

Si hay bolsas pendientes en este backup, revisar la tabla de Pendientes con el mismo criterio
que el Step 3. Volver al Dashboard sin bolsa seleccionada (Vista General) y confirmar que la
columna de genética ahí también muestra el chip corto.

- [x] **Step 5: Confirmar que el panel de detalle de UNA bolsa sigue con la cadena completa** — confirmado (FR2807b): "PC / APE / APE 338 / SIF / F2 / F2B 103" completa, sin acortar, en Identidad y en cada fuente GR.

Click en una fila de la tabla para abrir el detalle (Dashboard con bolsa seleccionada).
Confirmar que la fila "Genética:" sigue mostrando la cadena completa sin acortar (esto NO
debía tocarse, ver spec "Alcance").

- [x] **Step 6: Abrir SU → Registro** — confirmado `TANDA — [chip]` y multi-source `GR126B — F2B 103 + GR126C — 210`. `computedFontStyle` del chip verificado `normal` (no hereda itálica de `.su-sub-gen`).

`() => loadModule('SU')`, luego `SU.subTab('reg')` (o el click equivalente). Tomar screenshot
de las cards. Verificar:
- La columna GENÉTICA de cada sub-fila muestra `TANDA — [chip corto]`, no la cadena completa.
- Multi-fuente (si existe en el backup): `T1 — [chip] + T2 — [chip]`.
- El chip no aparece en itálica (la sub-fila entera está en itálica por `.su-sub-gen`, el chip
  debe verse en texto normal — confirma que el CSS del Task 5 Step 3 se aplicó).

- [x] **Verificación extra (no estaba en el plan original, agregada por importancia):** búsqueda libre (`_frBuscar`) y sort por columna GE (`_sortValue`) probados con datos reales — buscar "SIF" filtró 27→23 filas correctamente (contra la cadena completa, no el HTML del chip); sort por GE mantuvo orden basado en el texto plano completo, no en el markup. Confirma que la separación `_geTxtFromBolsa` (intacta) vs `_geChipFromBolsa` (nueva) funciona en la app real, no solo en el diff.

- [x] **Step 7: Caso de fallback (fenId que no resuelve) — vía consola**

Con FR o SU ya abiertos, usar `evaluate_script` para simular un nodo GE ausente sin tocar el
backup real: `() => { var ge = JSON.parse(localStorage.getItem('biolab.ge.v4')); var before =
JSON.stringify(ge); ge.nodes = ge.nodes.filter(n => false); localStorage.setItem('biolab.ge.v4',
JSON.stringify(ge)); return 'cleared'; }`, recargar el módulo activo, confirmar que los chips
pasan a la variante neutra (gris, sin color) pero SIGUEN mostrando el label corto y el tooltip
— nunca una celda vacía ni un error en consola (revisar
`mcp__chrome-devtools__list_console_messages`). Terminado el chequeo, recargar la página entera
(sin volver a sembrar) para descartar este estado modificado — no se persiste nada, es
localStorage de una pestaña de prueba en `localhost`, no del laboratorio real.

- [x] **Step 8: Revisar consola por errores en todo el recorrido** — sin errores atribuibles a `fr_app.js`/`su_app.js`/`ge_resolve.js`. Único error de consola en todo el recorrido: `cilab_auditor.js` 404 — preexistente, cargado por `main.js`, no relacionado a este cambio (confirmado que no es un archivo tocado ni referenciado por esta feature).

**Resultado Task 6: todos los checks pasaron.** Vía SU (con el mismo backup real), se limpió `biolab.ge.v4.nodes` a `[]` y se confirmó el fallback exacto: los chips pasan a `su-kchip su-kchip-dim` (sin `style` inline) pero conservan el label corto y el `title` con la cadena completa — cero celdas vacías, cero excepciones. FR comparte la misma lógica de fallback (`_resolveGeColor`/`fr-chip-neutral`) ya verificada por code review en Task 2, no se repitió la prueba en vivo por separado ahí.

---

### Task 7: Actualizar `CLAUDE.md` del proyecto con el invariante nuevo

Por regla del proyecto (`CLAUDE.md` raíz, regla #11): toda decisión arquitectónica sobre un
motor o convención cross-módulo se documenta antes de cerrar la sesión. Este chip es un patrón
de display nuevo que dos módulos comparten (con helpers duplicados a propósito, mismo criterio
que `_abbrevGen`) — vale una entrada corta.

**Files:**
- Modify: `CLAUDE.md` (raíz del repo `biolab-app/`, no el de `MOBY DICK/` padre — este es el
  canónico desde 2026-07-10)

- [x] **Step 1: Agregar una entrada breve en "INVARIANTES VIGENTES"** — insertada.

Insertar como nuevo bullet dentro de la sección `## INVARIANTES VIGENTES — de sesiones de fixes
recientes` (después del último bullet existente de esa lista):

```markdown
- **FR/SU — la genética en vistas de lista se muestra acortada al último eslabón, como chip
  coloreado con el color del nodo GE (`_genChipHtml`/`_suGenChipHtml`, helpers duplicados por
  módulo, mismo criterio que `_abbrevGen`).** Resuelve el color por `fenId` vía
  `window.ge.getNode()` (GE montado) con fallback a `window.GEResolve.resolverNodoCrudo()` (lee
  `biolab.ge.v4` crudo) — si ninguno resuelve, cae a chip neutro con el mismo label + tooltip,
  nunca celda vacía. `grSources[]` de FR no persiste `fenId` por fuente (solo `geneticaFull`),
  así que el multi-fuente (`210 + F2B`) se resuelve en vivo contra `gr_lotes` en cada render —
  no se migró nada, funciona igual para bolsas nuevas y ya selladas. Paneles de detalle de una
  sola bolsa (FR Dashboard con bolsa seleccionada, ficha de Bolsa Huérfana) siguen mostrando la
  cadena completa sin acortar — decisión explícita, no alcanza a esas vistas. Spec:
  `docs/superpowers/specs/2026-08-31-fr-su-genetica-chip-acortado-design.md`.
```

- [x] **Step 2: Commit** — no aplica: `CLAUDE.md` está en `.gitignore` de este repo a propósito (nota al tope del propio archivo — nunca se sube al repo público). Cambio guardado localmente, sin commit, tal como corresponde.
