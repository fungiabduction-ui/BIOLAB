# SU — Color por protocolo + propagación al chip SU en FR — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Asignar un color automático (editable a mano) a cada lote de `su_lotes`, teñir la card
en SU — Registro, y mostrar ese color en la columna SU de la tabla de FR — réplica exacta del
mecanismo ya implementado en GR (ver `docs/superpowers/specs/2026-09-06-gr-protocolo-color-design.md`).

**Architecture:** Paleta fija de 12 colores como cola rotativa (`su_color_seq`, independiente de
`gr_color_seq`), resuelta solo en el boundary de persistencia real (`guardarLote()`), nunca en
`recolectarDatosLote()` (que también llaman `exportarJSON()`/`exportarExcel()` sin persistir).
Migración one-shot backfillea lotes históricos. FR resuelve el color en vivo contra `su_lotes` en
cada render, sin escribir nada nuevo en `fr_bolsas`.

**Tech Stack:** Vanilla JS (IIFE por módulo), localStorage, sin framework ni test runner — la
verificación de lógica pura usa un script Node standalone en el scratchpad (mismo criterio que
`docs/superpowers/plans/2026-09-06-gr-protocolo-color.md`, Task 1).

---

## Decisiones ya confirmadas (no volver a preguntar)

1. **Paleta:** `SU_COLOR_PALETTE` = mismos 12 hex que `GR_COLOR_PALETTE`, constante propia, cola
   independiente.
2. **Migración retroactiva:** SÍ, desde el día 1 de esta implementación (a diferencia de GR, que
   la agregó después de detectar datos reales sin color).

---

### Task 1: Paleta, cola rotativa y helpers de color (lógica pura)

**Files:**
- Modify: `su/su_app.js:15` (constantes, después de `SU_BIBLIOTECA_KEY`)
- Modify: `su/su_app.js:1261` (nueva sección, después de `_suGrLoteChipHtml`, antes de `suFmt`)
- Test: script standalone en el scratchpad (sin test framework en el repo)

- [ ] **Step 1: Agregar las constantes de paleta/contador**

En `su/su_app.js`, inmediatamente después de la línea 15 (`const SU_BIBLIOTECA_KEY =
'su_biblioteca';`), agregar:
```js
const SU_COLOR_SEQ_KEY = 'su_color_seq';
const SU_COLOR_PALETTE = [
    '#EF6C57', '#F2A93C', '#C6D94D', '#52B788', '#2FB6A6', '#3FA9DB',
    '#5C7CE0', '#8B6CE3', '#C15FCB', '#E0568F', '#B0785A', '#6E8894'
];
```

- [ ] **Step 2: Agregar la nueva sección "COLOR DE PROTOCOLO" con los 2 helpers**

En `su/su_app.js`, buscar el final de `_suGrLoteChipHtml` (línea 1261, cierra con `}` seguido de
línea en blanco y `function suFmt(n, dec) {`). Insertar la nueva sección entre ambas funciones
(no tocar ninguna de las dos):
```js
// ==========================================
// COLOR DE PROTOCOLO — paleta rotativa + tinte de card/chips
// Mismo mecanismo que GR (gr_app.js), cola independiente (SU_COLOR_SEQ_KEY != GR_COLOR_SEQ_KEY).
// Ver docs/superpowers/specs/2026-09-07-su-protocolo-color-design.md
// ==========================================

function _suNextAutoColor() {
    var idx = 0;
    try { idx = parseInt(localStorage.getItem(SU_COLOR_SEQ_KEY), 10) || 0; } catch (e) {}
    var color = SU_COLOR_PALETTE[idx % SU_COLOR_PALETTE.length];
    try { localStorage.setItem(SU_COLOR_SEQ_KEY, String(idx + 1)); } catch (e) {}
    return color;
}

function _suResolveLoteColor(opts) {
    if (opts.existingColor && !opts.manualEdit) return opts.existingColor;
    if (opts.manualEdit) return opts.inputValue;
    return _suNextAutoColor();
}
```

Nota: `_suHexToRgba` ya existe (`su_app.js:1208`, agregado para el chip de genética) — no se
redefine.

- [ ] **Step 3: Escribir el script de verificación en el scratchpad**

Crear `<scratchpad>/verify-su-color-logic.js` (usar la ruta de scratchpad de esta sesión) con
este contenido exacto:

```js
// Shim mínimo de localStorage — Node no lo tiene nativo.
global.localStorage = (function () {
    var store = {};
    return {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
        setItem: function (k, v) { store[k] = String(v); },
        removeItem: function (k) { delete store[k]; }
    };
})();

// --- pegado verbatim desde su_app.js (Task 1) ---
const SU_COLOR_SEQ_KEY = 'su_color_seq';
const SU_COLOR_PALETTE = [
    '#EF6C57', '#F2A93C', '#C6D94D', '#52B788', '#2FB6A6', '#3FA9DB',
    '#5C7CE0', '#8B6CE3', '#C15FCB', '#E0568F', '#B0785A', '#6E8894'
];

function _suNextAutoColor() {
    var idx = 0;
    try { idx = parseInt(localStorage.getItem(SU_COLOR_SEQ_KEY), 10) || 0; } catch (e) {}
    var color = SU_COLOR_PALETTE[idx % SU_COLOR_PALETTE.length];
    try { localStorage.setItem(SU_COLOR_SEQ_KEY, String(idx + 1)); } catch (e) {}
    return color;
}

function _suResolveLoteColor(opts) {
    if (opts.existingColor && !opts.manualEdit) return opts.existingColor;
    if (opts.manualEdit) return opts.inputValue;
    return _suNextAutoColor();
}
// --- fin pegado ---

function assertEq(actual, expected, label) {
    var a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a !== e) { console.error('FAIL ' + label + ': got ' + a + ', expected ' + e); process.exitCode = 1; }
    else console.log('PASS ' + label);
}

// 1. Rotación: 12 asignaciones consecutivas cubren la paleta completa en orden.
var seq = [];
for (var i = 0; i < 12; i++) seq.push(_suNextAutoColor());
assertEq(seq, SU_COLOR_PALETTE, 'rotacion cubre paleta completa en orden');

// 2. Wrap-around: la 13ra asignación vuelve al primer color.
assertEq(_suNextAutoColor(), SU_COLOR_PALETTE[0], 'wrap-around a color 0 tras 12');

// 3. Resolución: color existente sin edición manual → se preserva.
assertEq(_suResolveLoteColor({ existingColor: '#111111', manualEdit: false, inputValue: '#1F4E79' }), '#111111', 'preserva color existente');

// 4. Resolución: edición manual gana aunque exista color previo.
assertEq(_suResolveLoteColor({ existingColor: '#111111', manualEdit: true, inputValue: '#ABCDEF' }), '#ABCDEF', 'manual pisa color existente');

// 5. Resolución: sin color existente y sin edición manual → autoasigna y consume la cola.
var before = parseInt(localStorage.getItem(SU_COLOR_SEQ_KEY), 10);
var auto = _suResolveLoteColor({ existingColor: null, manualEdit: false, inputValue: '#1F4E79' });
var after = parseInt(localStorage.getItem(SU_COLOR_SEQ_KEY), 10);
assertEq(auto, SU_COLOR_PALETTE[before % 12], 'autoasigna siguiente de la cola');
assertEq(after, before + 1, 'autoasignar consume la cola');

// 6. Resolución: edición manual NO consume la cola.
var beforeManual = parseInt(localStorage.getItem(SU_COLOR_SEQ_KEY), 10);
_suResolveLoteColor({ existingColor: null, manualEdit: true, inputValue: '#123456' });
var afterManual = parseInt(localStorage.getItem(SU_COLOR_SEQ_KEY), 10);
assertEq(afterManual, beforeManual, 'manual no consume la cola');

// 7. Cola independiente de GR: su_color_seq y gr_color_seq nunca se pisan entre si.
localStorage.setItem('gr_color_seq', '5');
var suSeqAntes = localStorage.getItem(SU_COLOR_SEQ_KEY);
_suNextAutoColor();
assertEq(localStorage.getItem('gr_color_seq'), '5', 'avanzar la cola SU no toca gr_color_seq');

console.log('Listo.');
```

- [ ] **Step 4: Correr el script y confirmar que todo pasa**

Run: `node <scratchpad>/verify-su-color-logic.js`
Expected: 10 líneas `PASS ...`, última línea `Listo.`, exit code 0. Si aparece cualquier `FAIL`,
no seguir a la Task 2 — revisar la lógica antes de continuar.

- [ ] **Step 5: Commit**

```bash
git add su/su_app.js
git commit -m "$(cat <<'EOF'
feat: agrega paleta y cola rotativa de color para protocolos SU

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Wiring en guardarLote() y cargarDatosLote()

**Files:**
- Modify: `su/su_app.js:861` y `:872` (dentro de `guardarLote()`)
- Modify: `su/su_app.js:1013` (dentro de `cargarDatosLote()`)

- [ ] **Step 1: Resolver el color en la rama "lote existente" de guardarLote()**

En `su/su_app.js`, ubicar dentro de `guardarLote()` (empieza línea 803) el bloque:
```js
        // Preservar _uuid original (nunca cambia)
        lote._uuid = uuidAnterior || lote._uuid || _suGenUUID();

        // Si el ID cambió, propagar el rename a fr_bolsas en localStorage
        if (idAnterior && lote.id && idAnterior !== lote.id) {
            _suPropagarRenameFR(uuidAnterior || lote._uuid, idAnterior, lote.id);
        }

        lotesData[indiceExistente] = lote;
```
Reemplazar por (agrega la resolución de color justo antes de la asignación final — después de
`_suPropagarRenameFR`, que no toca `lote.color`):
```js
        // Preservar _uuid original (nunca cambia)
        lote._uuid = uuidAnterior || lote._uuid || _suGenUUID();

        // Si el ID cambió, propagar el rename a fr_bolsas en localStorage
        if (idAnterior && lote.id && idAnterior !== lote.id) {
            _suPropagarRenameFR(uuidAnterior || lote._uuid, idAnterior, lote.id);
        }

        // Color del protocolo — se resuelve acá (no en recolectarDatosLote(), que tiene
        // callers de preview no-persistentes vía exportarJSON()/exportarExcel()) para que
        // la cola rotativa (_suNextAutoColor) solo avance en un guardado real.
        const _colorInput = document.getElementById('loteColor');
        const _colorManual = _colorInput ? _colorInput.dataset.manualEdit === 'true' : false;
        lote.color = _suResolveLoteColor({
            existingColor: lotesData[indiceExistente].color,
            manualEdit: _colorManual,
            inputValue: _colorInput ? _colorInput.value : null
        });

        lotesData[indiceExistente] = lote;
```

- [ ] **Step 2: Resolver el color en la rama "lote nuevo" de guardarLote()**

En el mismo `guardarLote()`, ubicar la rama `else`:
```js
    } else {
        // Lote nuevo: asignar _uuid definitivo
        lote._uuid = lote._uuid || _suGenUUID();

        // ID duplicado en lote nuevo = error siempre. El sistema genera IDs únicos por diseño.
        if (lotesData.some(l => l.id === lote.id)) {
            alert('El ID "' + lote.id + '" ya existe. Cambiá la fecha para obtener un nuevo ID.');
            return;
        }

        lotesData.push(lote);
    }
```
Reemplazar por:
```js
    } else {
        // Lote nuevo: asignar _uuid definitivo
        lote._uuid = lote._uuid || _suGenUUID();

        // ID duplicado en lote nuevo = error siempre. El sistema genera IDs únicos por diseño.
        if (lotesData.some(l => l.id === lote.id)) {
            alert('El ID "' + lote.id + '" ya existe. Cambiá la fecha para obtener un nuevo ID.');
            return;
        }

        const _colorInput = document.getElementById('loteColor');
        const _colorManual = _colorInput ? _colorInput.dataset.manualEdit === 'true' : false;
        lote.color = _suResolveLoteColor({
            existingColor: null,
            manualEdit: _colorManual,
            inputValue: _colorInput ? _colorInput.value : null
        });

        lotesData.push(lote);
    }
```
`const _colorInput`/`_colorManual` no colisiona con el Step 1 — cada rama es su propio bloque
`{ }`, scope separado.

- [ ] **Step 3: Poblar el input de color al cargar un lote existente**

En `cargarDatosLote()` (empieza línea 1004), ubicar:
```js
    document.getElementById('loteEstructura').value = lote.estructura || '';
    // loteSteril / loteNotas eliminados del UI (valores se preservan en el modelo si existían)
```
Insertar entre ambas líneas:
```js
    document.getElementById('loteEstructura').value = lote.estructura || '';
    var colorInput = document.getElementById('loteColor');
    if (colorInput) {
        colorInput.dataset.manualEdit = 'false';
        colorInput.value = lote.color || '#1F4E79';
        colorInput.style.opacity = lote.color ? '1' : '0.7';
    }
    // loteSteril / loteNotas eliminados del UI (valores se preservan en el modelo si existían)
```

- [ ] **Step 4: Commit**

```bash
git add su/su_app.js
git commit -m "$(cat <<'EOF'
feat: resuelve y persiste el color de protocolo en guardarLote()/cargarDatosLote() de SU

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Input de color en el formulario de Formulación

**Files:**
- Modify: `su/su_index.html:94-97`

- [ ] **Step 1: Agregar el campo Color junto a Estructura**

En `su/su_index.html`, ubicar:
```html
                        <div class="form-group">
                            <label for="loteEstructura">Estructura (tipo de bolsa)</label>
                            <input type="text" id="loteEstructura" placeholder="ej: Bolsas 35×42 40 micrones">
                        </div>
                    </div>
                </div>
```
Reemplazar por:
```html
                        <div class="form-group">
                            <label for="loteEstructura">Estructura (tipo de bolsa)</label>
                            <input type="text" id="loteEstructura" placeholder="ej: Bolsas 35×42 40 micrones">
                        </div>
                        <div class="form-group">
                            <label for="loteColor">Color</label>
                            <input type="color" id="loteColor" value="#1F4E79"
                                style="opacity:0.7" class="su-color-input"
                                oninput="this.dataset.manualEdit='true';this.style.opacity='1';"
                                title="Se asigna automáticamente al guardar. Elegí uno para fijarlo a mano.">
                        </div>
                    </div>
                </div>
```
`.form-row` ya usa `grid-template-columns: repeat(auto-fit, minmax(200px, 1fr))`
(`su_styles.css:338`) — el 4° campo entra sin cambios de CSS.

- [ ] **Step 2: Commit**

```bash
git add su/su_index.html
git commit -m "$(cat <<'EOF'
feat: agrega picker de color de protocolo al formulario de Formulación de SU

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Tinte de card + swatch clickeable en Registro

**Files:**
- Modify: `su/su_app.js:1444-1466` (dentro de `renderizarRegistroLotes()`)
- Modify: `su/su_app.js:1655` (return de la card)
- Modify: `su/su_styles.css:1989` y `:1997-2007` (`.su-reg-card`, `.su-card-head:hover`)
- Add: `su/su_styles.css` (nueva regla `.su-card-color-swatch`)

- [ ] **Step 1: Agregar `suSetLoteColor` a la sección "COLOR DE PROTOCOLO"**

En `su/su_app.js`, inmediatamente después de `_suResolveLoteColor` (agregada en Task 1, antes de
`function suFmt`), agregar:
```js
// Relee su_lotes fresco de localStorage antes de mutar (no confía en lotesData en memoria,
// que puede estar stale si otra pestaña guardó algo desde que esta montó) — mismo criterio que
// _suEscribirBolsaFR (2026-09-02) y grSetLoteColor (2026-09-06). A diferencia de GR (que
// identifica el lote solo por id, sin concepto de uuid), acá se busca primero por _uuid
// (identidad estable de SU) y se cae a id solo para lotes históricos sin uuid.
window.suSetLoteColor = function suSetLoteColor(uuid, loteId, colorValue) {
    var raw = localStorage.getItem(SU_STORAGE_KEY);
    var lotesFrescos = raw ? JSON.parse(raw) : [];
    var idx = -1;
    if (uuid) idx = lotesFrescos.findIndex(function (l) { return l._uuid === uuid; });
    if (idx < 0 && loteId) idx = lotesFrescos.findIndex(function (l) { return l.id === loteId; });
    if (idx < 0) return;
    lotesFrescos[idx].color = colorValue;
    lotesData = lotesFrescos;
    guardarEnStorage();
    renderizarRegistroLotes();
};
```

- [ ] **Step 2: Calcular colorVars/colorSwatch en el loop de render y usarlos en la card**

En `renderizarRegistroLotes()`, ubicar:
```js
        const realIndex = lotesData.indexOf(lote);
        const m = suCalcularMetricasLote(lote);
        const db = Array.isArray(lote.db) ? lote.db : [];
        const fechaFmt = suFormatFecha(lote.fecha);
        const loteId = lote.id || '-';
        const frMap = _suGetFRMap(lote);
        const tandaCount = db.length;
```
Insertar justo después (antes del comentario `// Cabecera de card`):
```js
        const realIndex = lotesData.indexOf(lote);
        const m = suCalcularMetricasLote(lote);
        const db = Array.isArray(lote.db) ? lote.db : [];
        const fechaFmt = suFormatFecha(lote.fecha);
        const loteId = lote.id || '-';
        const frMap = _suGetFRMap(lote);
        const tandaCount = db.length;

        const _colorValido = (lote.color && _suHexToRgba(lote.color, 1)) ? lote.color : null;
        const colorVars = _colorValido
            ? ` style="--su-protocolo-color:${_colorValido};--su-protocolo-bg:${_suHexToRgba(_colorValido, 0.07)};--su-protocolo-bg-hover:${_suHexToRgba(_colorValido, 0.12)}"`
            : '';
        const loteIdSafe = loteId.replace(/'/g, "\\'");
        const colorSwatch = `<input type="color" class="su-card-color-swatch" value="${_colorValido || '#1F4E79'}"
            onclick="event.stopPropagation()"
            onchange="event.stopPropagation(); suSetLoteColor('${lote._uuid || ''}', '${loteIdSafe}', this.value)"
            title="Cambiar color del protocolo">`;
```

Ahora ubicar la cabecera de card (variante no-edición):
```js
            <div class="su-card-head" onclick="suCargarRegistroYVolver(${realIndex})" title="Click para cargar en Formulación" style="cursor:pointer">
                <span class="su-card-id">${loteId}</span>
```
Reemplazar por:
```js
            <div class="su-card-head" onclick="suCargarRegistroYVolver(${realIndex})" title="Click para cargar en Formulación" style="cursor:pointer">
                ${colorSwatch}
                <span class="su-card-id">${loteId}</span>
```
(Solo la variante de vista normal lleva swatch — la variante `su-card-head-edit` no se toca,
igual que hoy solo la vista normal muestra `su-card-id`.)

Por último, ubicar el `return` final de la card:
```js
        return `<div class="su-reg-card">${cardHead}${subs}${addSubBtn}</div>`;
```
Reemplazar por:
```js
        return `<div class="su-reg-card"${colorVars}>${cardHead}${subs}${addSubBtn}</div>`;
```

- [ ] **Step 3: CSS — borde/fondo de la card + hover coloreado vía custom properties**

En `su/su_styles.css`, reemplazar:
```css
.su-reg-card {
    border: 1px solid var(--border, rgba(255,255,255,0.1));
    border-radius: 10px;
    overflow: hidden;
    background: var(--card-bg, rgba(255,255,255,0.03));
}
```
por:
```css
.su-reg-card {
    border: 1px solid var(--border, rgba(255,255,255,0.1));
    border-left-width: 4px;
    border-left-color: var(--su-protocolo-color, var(--border, rgba(255,255,255,0.1)));
    border-radius: 10px;
    overflow: hidden;
    background: var(--su-protocolo-bg, var(--card-bg, rgba(255,255,255,0.03)));
    transition: border-color 160ms ease, background 160ms ease;
}
```
Y reemplazar:
```css
.su-card-head:hover {
    background: rgba(139, 92, 246, 0.07);
}
```
por (el hover lee la variable de la card padre; sin color, cae al púrpura de siempre — se aplica
esto desde el inicio para no repetir el bug real que GR encontró en code review: un `:hover`
fijo apagaba el tinte justo en la interacción que precede al click):
```css
.su-card-head:hover {
    background: var(--su-protocolo-bg-hover, rgba(139, 92, 246, 0.07));
}
```

- [ ] **Step 4: CSS — swatch circular**

En `su/su_styles.css`, agregar después de la regla `.su-card-count` (justo antes de `/* Header de
columnas de sub-filas... */`):
```css
.su-card-color-swatch {
    width: 16px;
    height: 16px;
    padding: 0;
    border: 1px solid rgba(255,255,255,.25);
    border-radius: 50%;
    cursor: pointer;
    background: none;
}
```

- [ ] **Step 5: Commit**

```bash
git add su/su_app.js su/su_styles.css
git commit -m "$(cat <<'EOF'
feat: tine las cards de Registro SU con el color del protocolo y agrega swatch editable

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Migración one-shot — backfill de color para lotes SU históricos

**Files:**
- Modify: `su/su_app.js:2714` (nueva función, después de `_suMigrarNotasUnificadasV1`)
- Modify: `su/su_app.js:150` (invocación en `SU.init`)

- [ ] **Step 1: Agregar `_suMigrarColorBackfillV1`**

En `su/su_app.js`, ubicar el cierre de `_suMigrarNotasUnificadasV1` (línea 2714, `}` seguido de
línea en blanco y `function suDbEscapeHtml(s) {`). Insertar entre ambas:
```js
// Migración one-shot: colorea todo lote de su_lotes sin .color, ordenado por fecha ascendente,
// consumiendo la cola rotativa (_suNextAutoColor). Mismo patrón que _grMigrarColorBackfillV1
// (gr_app.js, 2026-09-06) — a diferencia de GR, acá se decide migrar desde el día 1 en vez de
// revertir la decisión sobre la marcha. Ver docs/superpowers/specs/2026-09-07-su-protocolo-color-design.md
function _suMigrarColorBackfillV1() {
    var MIGRACION_KEY = 'biolab_migracion_su_color_backfill_v1';
    try {
        if (localStorage.getItem(MIGRACION_KEY) === '1') return;
        var raw = localStorage.getItem(SU_STORAGE_KEY);
        if (!raw) { localStorage.setItem(MIGRACION_KEY, '1'); return; }
        var lotes = JSON.parse(raw);
        if (!Array.isArray(lotes)) { localStorage.setItem(MIGRACION_KEY, '1'); return; }
        var pendientes = lotes.filter(function(l) { return l && !l.color; });
        pendientes.sort(function(a, b) {
            var fa = a.fecha || '', fb = b.fecha || '';
            if (fa !== fb) return fa < fb ? -1 : 1;
            return (a.id || '').localeCompare(b.id || '');
        });
        pendientes.forEach(function(lote) {
            lote.color = _suNextAutoColor();
        });
        if (pendientes.length > 0) {
            localStorage.setItem(SU_STORAGE_KEY, JSON.stringify(lotes));
            console.log('[SU] Migración color backfill: ' + pendientes.length + ' lotes coloreados');
        }
        localStorage.setItem(MIGRACION_KEY, '1');
    } catch (e) {
        console.error('[SU] Error en migración de color backfill:', e);
    }
}
```

- [ ] **Step 2: Invocar la migración en SU.init()**

En `su/su_app.js`, ubicar dentro de `window.SU.init = function suInit() {` (línea 145):
```js
    try { cargarBibliotecaDesdeStorage(); } catch (e) { console.warn('SU.init cargarBiblioteca:', e); }
    try { _suMigrarNotasUnificadasV1(); }  catch (e) { console.warn('SU.init migracion notas:', e); }
    try { cargarLotesDesdeStorage(); }     catch (e) { console.warn('SU.init cargarLotes:', e); }
```
Reemplazar por:
```js
    try { cargarBibliotecaDesdeStorage(); } catch (e) { console.warn('SU.init cargarBiblioteca:', e); }
    try { _suMigrarNotasUnificadasV1(); }  catch (e) { console.warn('SU.init migracion notas:', e); }
    try { _suMigrarColorBackfillV1(); }    catch (e) { console.warn('SU.init migracion color:', e); }
    try { cargarLotesDesdeStorage(); }     catch (e) { console.warn('SU.init cargarLotes:', e); }
```

- [ ] **Step 3: Verificación de la migración con datos sintéticos en el scratchpad**

Agregar al final de `<scratchpad>/verify-su-color-logic.js` (después de la línea `console.log('Listo.');`
del Step 3 de la Task 1 — mover ese `console.log` al final del archivo):

```js
// 8. Migración: lotes sin color se ordenan por fecha asc y consumen la cola; lotes con
//    color existente no se tocan; flag one-shot evita reprocesar.
localStorage.setItem('su_color_seq', '0');
localStorage.setItem('su_lotes', JSON.stringify([
    { id: 'SU-B', fecha: '2026-02-10' },
    { id: 'SU-A', fecha: '2026-01-05' },
    { id: 'SU-C', fecha: '2026-03-01', color: '#000000' }
]));
localStorage.removeItem('biolab_migracion_su_color_backfill_v1');

function _suMigrarColorBackfillV1() {
    var MIGRACION_KEY = 'biolab_migracion_su_color_backfill_v1';
    try {
        if (localStorage.getItem(MIGRACION_KEY) === '1') return;
        var raw = localStorage.getItem('su_lotes');
        if (!raw) { localStorage.setItem(MIGRACION_KEY, '1'); return; }
        var lotes = JSON.parse(raw);
        if (!Array.isArray(lotes)) { localStorage.setItem(MIGRACION_KEY, '1'); return; }
        var pendientes = lotes.filter(function(l) { return l && !l.color; });
        pendientes.sort(function(a, b) {
            var fa = a.fecha || '', fb = b.fecha || '';
            if (fa !== fb) return fa < fb ? -1 : 1;
            return (a.id || '').localeCompare(b.id || '');
        });
        pendientes.forEach(function(lote) { lote.color = _suNextAutoColor(); });
        if (pendientes.length > 0) localStorage.setItem('su_lotes', JSON.stringify(lotes));
        localStorage.setItem(MIGRACION_KEY, '1');
    } catch (e) { console.error('[SU] Error en migración de color backfill:', e); }
}

_suMigrarColorBackfillV1();
var migrados = JSON.parse(localStorage.getItem('su_lotes'));
var porId = {}; migrados.forEach(function(l) { porId[l.id] = l; });
assertEq(porId['SU-A'].color, SU_COLOR_PALETTE[0], 'SU-A (fecha mas vieja) recibe el primer color de la cola');
assertEq(porId['SU-B'].color, SU_COLOR_PALETTE[1], 'SU-B (segunda mas vieja) recibe el segundo color');
assertEq(porId['SU-C'].color, '#000000', 'SU-C con color existente no se toca');

var seqAntes = localStorage.getItem('su_color_seq');
_suMigrarColorBackfillV1();
assertEq(localStorage.getItem('su_color_seq'), seqAntes, 'flag one-shot evita reprocesar en la segunda llamada');

console.log('Listo.');
```

Run: `node <scratchpad>/verify-su-color-logic.js`
Expected: ahora 15 líneas `PASS ...`, `Listo.` una sola vez al final, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add su/su_app.js
git commit -m "$(cat <<'EOF'
feat: agrega migracion one-shot que asigna color automatico a lotes SU historicos sin color

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Propagación a FR — chip de color en la columna SU

**Files:**
- Modify: `fr/fr_app.js:267` (nuevo `getSULotesMap`, después de `getGRLotesMap`)
- Modify: `fr/fr_app.js:3025` (nuevos helpers, después de `_grChipFromBolsa`)
- Modify: `fr/fr_app.js:1268/1327` (`filaTabla`)
- Modify: `fr/fr_app.js:3110/3122` (`filaPendiente`)

- [ ] **Step 1: Agregar `getSULotesMap`**

En `fr/fr_app.js`, inmediatamente después de `getGRLotesMap` (línea 267):
```js
    function getSULotesMap() {
        var m = {};
        try {
            var arr = JSON.parse(localStorage.getItem(SU_KEY) || '[]') || [];
            arr.forEach(function(l) { m[l.id] = l; });
        } catch (e) {}
        return m;
    }
```

- [ ] **Step 2: Agregar los helpers de chip SU, después de `_grChipFromBolsa`**

En `fr/fr_app.js`, ubicar el cierre de `_grChipFromBolsa` (línea 3025, `}` seguido de línea en
blanco y `function _geTxtFromBolsa`). Insertar entre ambas:
```js
    // Chip de color por protocolo SU — mismo mecanismo que el chip GR de arriba, reutiliza
    // _grChipHtml tal cual (genérico label+hex→span, a pesar del nombre). Una bolsa FR tiene
    // un solo suLoteId (a diferencia de grSources[], no hay caso multi-fuente que dedupear).
    function _suColorForBolsa(b) {
        if (!b || !b.suLoteId) return null;
        try {
            var l = getSULotesMap()[b.suLoteId];
            return (l && l.color) || null;
        } catch (e) { return null; }
    }

    function _suChipFromBolsa(b) {
        return _grChipHtml(b.suLoteId || '—', _suColorForBolsa(b));
    }
```

- [ ] **Step 3: Usar el chip en `filaTabla()`**

En `filaTabla()`, quitar la declaración de `suTxt` (ya no se usa en esta función):
```js
        var suTxt = (b.suLoteId || '—') + (b.suSubTanda ? ' · ' + b.suSubTanda : '');
```
Y en el `<td>` de la columna SU, reemplazar:
```js
            + '<td ' + cl + '><span class="fr-traza">' + esc(suTxt) + '</span></td>'
```
por:
```js
            + '<td ' + cl + '>' + _suChipFromBolsa(b) + '</td>'
```

- [ ] **Step 4: Usar el chip en `filaPendiente()`**

En `filaPendiente()`, quitar la declaración de `suTxt`:
```js
        var suTxt = (b.suLoteId || '—') + (b.suSubTanda ? ' · ' + b.suSubTanda : '');
```
Y reemplazar:
```js
            + '<td><span class="fr-traza">' + esc(suTxt) + '</span></td>'
```
por:
```js
            + '<td>' + _suChipFromBolsa(b) + '</td>'
```

- [ ] **Step 5: Commit**

```bash
git add fr/fr_app.js
git commit -m "$(cat <<'EOF'
feat: tine el chip de referencia SU en FR con el color del protocolo

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Verificación — manual por el usuario (no automatizada)

> **Nota:** en la sesión de GR (2026-09-06) se intentó verificar con un subagente + `chrome-devtools`
> MCP y se encontró que esa instancia de Chrome **no es un perfil de automatización descartable** —
> tiene datos reales de producción cargados. El usuario decidió entonces probar a mano en su propio
> navegador una vez commiteado el plan. Mismo criterio acá — no se intenta Chrome DevTools MCP para
> esta feature.

**Files:** ninguno (solo checklist para el usuario)

- [ ] **Step 1: Pedir al usuario que levante el servidor local y pruebe en vivo**

Checklist a seguir en su propio navegador (`http://localhost:8734/`, `serve.bat`):
1. SU → Formulación: el picker "Color" aparece dimmed junto a Estructura.
2. Guardar un lote SIN tocar el picker → recargar SU → Registro: la card tiene un swatch
   coloreado (autoasignado) y un borde/fondo tenue del mismo color.
3. Guardar otro lote → confirmar que recibe el SIGUIENTE color de la paleta (no repite el
   anterior).
4. Desde el swatch de una card ya guardada, cambiar el color a mano → confirmar que persiste al
   recargar.
5. Editar el picker de Formulación de un lote YA guardado (tocar el input) → guardar → confirmar
   que el color elegido a mano gana sobre el autoasignado, y que NO se saltea un color de la cola
   (guardar un lote nuevo después debería seguir dando el color que tocaba, no uno salteado).
6. Abrir FR → Activo/Cosecha/Pendientes: la columna SU muestra solo el ID de lote SU (sin
   sub-tanda), coloreado igual que en el Registro de SU.
7. Consola sin errores nuevos en ninguno de los pasos anteriores.

- [ ] **Step 2: Confirmar con el usuario antes de dar la feature por cerrada**

No marcar esta task como completa hasta que el usuario confirme explícitamente que los 7 puntos
de arriba se ven bien en su navegador real.

---

### Task 8: Documentación — CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (raíz de `biolab-app/`) — tabla de persistencia + sección "INVARIANTES VIGENTES"

- [ ] **Step 1: Agregar las keys nuevas a la tabla de persistencia**

En la tabla de persistencia de `CLAUDE.md`, ubicar la fila de `gr_color_seq` y agregar debajo:
```markdown
| `su_color_seq` | SU | Contador de la cola rotativa de color de protocolo (independiente de `gr_color_seq`) |
```
Y actualizar la fila de `su_lotes` para mencionar el campo `color`:
```markdown
| `su_lotes` | SU | Lotes de sustrato (incluye `color` por protocolo desde 2026-09-07) |
```

- [ ] **Step 2: Agregar la entrada de invariante en la sección "INVARIANTES VIGENTES"**

Al final de la sección `## INVARIANTES VIGENTES — de sesiones de fixes recientes` (antes del
siguiente `---`), agregar (después de la entrada de "GR — Color por protocolo"):

```markdown
- **SU — Color por protocolo (2026-09-07), réplica exacta del mecanismo de GR.** Mismo diseño que
  `gr_lotes[].color` (ver entrada anterior) aplicado a `su_lotes`: paleta propia
  `SU_COLOR_PALETTE` (mismos 12 hex que `GR_COLOR_PALETTE`, cola independiente vía
  `su_color_seq`), resuelto solo en `guardarLote()` nunca en `recolectarDatosLote()` (que
  también llaman `exportarJSON()`/`exportarExcel()` sin persistir — mismo trap que
  `updateUnidadFisica()` en GR). **Diferencia real con GR, no de diseño sino de cómo ya estaba
  escrita la función:** en `guardarLote()` de SU los gates que pueden abortar el guardado
  (`conflictoId`, ID duplicado) viven DENTRO de cada rama del `if (indiceExistente >= 0)
  {...} else {...}`, no antes — la resolución de color se llama dos veces (una por rama, mismo
  `_suResolveLoteColor(opts)` puro) en vez de una sola vez antes del bloque como en GR, para que
  un guardado rechazado tampoco consuma la cola. `suSetLoteColor` (swatch de la card) identifica
  el lote primero por `_uuid` (SU sí tiene identidad estable por uuid, a diferencia de
  `gr_lotes`) y cae a `id` solo para lotes históricos sin uuid — relee `su_lotes` fresco antes de
  mutar, mismo criterio que `grSetLoteColor`. **A diferencia de GR (que decidió migrar
  retroactivamente sobre la marcha, después de detectar 17 lotes reales sin color),
  `_suMigrarColorBackfillV1()` se agregó desde el día 1** — mismo patrón one-shot, flag
  `biolab_migracion_su_color_backfill_v1`, ordena por `fecha` ascendente. FR (columna SU,
  `_suChipFromBolsa`) resuelve el color en vivo contra `su_lotes` en cada render, reutilizando
  `_grChipHtml` tal cual (genérico label+hex→span pese al nombre) — a diferencia del chip GR, una
  bolsa FR tiene un solo `suLoteId`, no hay caso multi-fuente que dedupear. Muestra solo el
  `suLoteId`, nunca `suSubTanda` (mismo criterio que el chip GR: la sub-tanda es detalle de
  trazabilidad para el panel de una sola bolsa, no para la vista rápida de tabla) — los paneles
  de detalle de una sola bolsa siguen mostrando la cadena completa. Spec:
  `docs/superpowers/specs/2026-09-07-su-protocolo-color-design.md`.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: documenta el invariante de color por protocolo SU en CLAUDE.md

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Resumen de archivos tocados

- `su/su_app.js` — paleta/cola/helpers, wiring en guardarLote/cargarDatosLote, tinte de card +
  swatch, migración backfill.
- `su/su_index.html` — input de color en Formulación.
- `su/su_styles.css` — custom properties en `.su-reg-card`/`.su-card-head:hover`, estilo del
  swatch.
- `fr/fr_app.js` — `getSULotesMap`, chip de color en columna SU (`filaTabla`, `filaPendiente`).
- `CLAUDE.md` — tabla de persistencia + invariante nuevo.

Nada de esto toca `main.js`, `cilab_conocimiento.js` (modificado desde antes de esta sesión, no
relacionado — no tocar/commitear como parte de este plan), ni ningún módulo fuera de SU/FR.
