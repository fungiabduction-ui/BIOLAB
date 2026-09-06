# GR — Color por protocolo + propagación a chips FR/SU — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada protocolo (lote) de GR recibe un color — automático por default (cola rotativa de
12 colores, no repite entre protocolos consecutivos), editable a mano — que tiñe levemente su
card en GR → Registro y se propaga como tinte a los chips que referencian ese lote en FR
(columna GR) y SU (columna GRANO).

**Architecture:** Campo nuevo `color` en `gr_lotes[].color`, key nueva `gr_color_seq` (contador
de la cola). Toda la lógica de asignación vive en `gr_app.js`. FR y SU resuelven el color **en
vivo** contra `gr_lotes` en cada render (mismo mecanismo ya usado para el chip de genética
acortado) — no escriben nada, no migran nada.

**Tech Stack:** Vanilla JS (sin build step, sin framework), localStorage, SPA cargada por
módulos (`loadModule()`). Sin test framework en el repo (no hay `package.json`) — la
verificación de lógica pura usa scripts Node standalone en el scratchpad, y la verificación
UI-facing usa Chrome real (MCP `chrome-devtools`) contra el servidor local con datos de un
backup real exportado por el usuario, siguiendo el mismo método ya usado en sesiones anteriores
de este proyecto (ver `docs/superpowers/specs/2026-09-06-gr-protocolo-color-design.md`).

**Spec:** `docs/superpowers/specs/2026-09-06-gr-protocolo-color-design.md`

---

## Antes de empezar

Regla 8 del proyecto: backup antes de cambios en estructura de datos de localStorage. Este
cambio es aditivo (campo nuevo, key nueva), pero de todas formas, **antes de la Task 5 y la
Task 8** (las que cargan datos reales en un Chrome real), verificar que el Chrome que controla
`chrome-devtools` MCP es una instancia/perfil separado del navegador diario del usuario —
Task 5 incluye un chequeo explícito de esto antes de escribir nada en `localStorage`.

Backup real disponible para las pruebas de navegador:
`biolab-backup-FECHA_03-09-2026_HORA_12-02-44_CON-RESUMENES.json` (raíz del repo). Contiene 17
lotes GR reales, incluyendo `GR113`, referenciado tanto por la bolsa FR `FR44`
(`grLoteId:'GR113', grTandaId:'GR113d'`) como por el lote SU `SU44` — se usa como caso de
prueba concreto para las Tasks 5 y 8.

---

### Task 1: Paleta, cola rotativa y helpers de color (lógica pura)

**Files:**
- Modify: `gr/gr_app.js:19` (constantes, después de `SU_STORAGE_KEY_REF`)
- Modify: `gr/gr_app.js:1071` (nueva sección antes de `GR.modoEdicionRegistro = false;`)
- Test: script standalone en el scratchpad (sin test framework en el repo — ver Tech Stack)

- [ ] **Step 1: Agregar las constantes de paleta/contador**

En `gr/gr_app.js`, inmediatamente después de la línea:
```js
const SU_STORAGE_KEY_REF = 'su_lotes';
```
agregar:
```js
const GR_COLOR_SEQ_KEY = 'gr_color_seq';
const GR_COLOR_PALETTE = [
    '#EF6C57', '#F2A93C', '#C6D94D', '#52B788', '#2FB6A6', '#3FA9DB',
    '#5C7CE0', '#8B6CE3', '#C15FCB', '#E0568F', '#B0785A', '#6E8894'
];
```

- [ ] **Step 2: Agregar la nueva sección "COLOR DE PROTOCOLO" con los 3 helpers**

En `gr/gr_app.js`, buscar el comentario de sección:
```js
// ==========================================
// REGISTRO DE LOTES - EQUIVALENTE A SU
// ==========================================

GR.modoEdicionRegistro = false;
```
Insertar la nueva sección **antes** de ese bloque (queda: nueva sección → sección REGISTRO DE
LOTES existente, sin tocar el resto):
```js
// ==========================================
// COLOR DE PROTOCOLO — paleta rotativa + tinte de card/chips
// ==========================================

function _grNextAutoColor() {
    var idx = 0;
    try { idx = parseInt(localStorage.getItem(GR_COLOR_SEQ_KEY), 10) || 0; } catch (e) {}
    var color = GR_COLOR_PALETTE[idx % GR_COLOR_PALETTE.length];
    try { localStorage.setItem(GR_COLOR_SEQ_KEY, String(idx + 1)); } catch (e) {}
    return color;
}

function _grResolveLoteColor(opts) {
    if (opts.existingColor && !opts.manualEdit) return opts.existingColor;
    if (opts.manualEdit) return opts.inputValue;
    return _grNextAutoColor();
}

function _grHexToRgba(hex, alpha) {
    if (typeof hex !== 'string') return null;
    var m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
    if (!m) return null;
    var n = parseInt(m[1], 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}
```

- [ ] **Step 3: Escribir el script de verificación en el scratchpad**

Crear `<scratchpad>/verify-gr-color-logic.js` (usar la ruta de scratchpad de esta sesión) con
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

// --- pegado verbatim desde gr_app.js (Task 1) ---
const GR_COLOR_SEQ_KEY = 'gr_color_seq';
const GR_COLOR_PALETTE = [
    '#EF6C57', '#F2A93C', '#C6D94D', '#52B788', '#2FB6A6', '#3FA9DB',
    '#5C7CE0', '#8B6CE3', '#C15FCB', '#E0568F', '#B0785A', '#6E8894'
];

function _grNextAutoColor() {
    var idx = 0;
    try { idx = parseInt(localStorage.getItem(GR_COLOR_SEQ_KEY), 10) || 0; } catch (e) {}
    var color = GR_COLOR_PALETTE[idx % GR_COLOR_PALETTE.length];
    try { localStorage.setItem(GR_COLOR_SEQ_KEY, String(idx + 1)); } catch (e) {}
    return color;
}

function _grResolveLoteColor(opts) {
    if (opts.existingColor && !opts.manualEdit) return opts.existingColor;
    if (opts.manualEdit) return opts.inputValue;
    return _grNextAutoColor();
}

function _grHexToRgba(hex, alpha) {
    if (typeof hex !== 'string') return null;
    var m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
    if (!m) return null;
    var n = parseInt(m[1], 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}
// --- fin pegado ---

function assertEq(actual, expected, label) {
    var a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a !== e) { console.error('FAIL ' + label + ': got ' + a + ', expected ' + e); process.exitCode = 1; }
    else console.log('PASS ' + label);
}

// 1. Rotación: 12 asignaciones consecutivas cubren la paleta completa en orden.
var seq = [];
for (var i = 0; i < 12; i++) seq.push(_grNextAutoColor());
assertEq(seq, GR_COLOR_PALETTE, 'rotacion cubre paleta completa en orden');

// 2. Wrap-around: la 13ra asignación vuelve al primer color.
assertEq(_grNextAutoColor(), GR_COLOR_PALETTE[0], 'wrap-around a color 0 tras 12');

// 3. Resolución: color existente sin edición manual → se preserva.
assertEq(_grResolveLoteColor({ existingColor: '#111111', manualEdit: false, inputValue: '#FFD700' }), '#111111', 'preserva color existente');

// 4. Resolución: edición manual gana aunque exista color previo.
assertEq(_grResolveLoteColor({ existingColor: '#111111', manualEdit: true, inputValue: '#ABCDEF' }), '#ABCDEF', 'manual pisa color existente');

// 5. Resolución: sin color existente y sin edición manual → autoasigna y consume la cola.
var before = parseInt(localStorage.getItem(GR_COLOR_SEQ_KEY), 10);
var auto = _grResolveLoteColor({ existingColor: null, manualEdit: false, inputValue: '#FFD700' });
var after = parseInt(localStorage.getItem(GR_COLOR_SEQ_KEY), 10);
assertEq(auto, GR_COLOR_PALETTE[before % 12], 'autoasigna siguiente de la cola');
assertEq(after, before + 1, 'autoasignar consume la cola');

// 6. Resolución: edición manual NO consume la cola.
var beforeManual = parseInt(localStorage.getItem(GR_COLOR_SEQ_KEY), 10);
_grResolveLoteColor({ existingColor: null, manualEdit: true, inputValue: '#123456' });
var afterManual = parseInt(localStorage.getItem(GR_COLOR_SEQ_KEY), 10);
assertEq(afterManual, beforeManual, 'manual no consume la cola');

// 7. _grHexToRgba: conversión correcta.
assertEq(_grHexToRgba('#EF6C57', 0.07), 'rgba(239,108,87,0.07)', 'hexToRgba convierte bien');

// 8. _grHexToRgba: input inválido → null (dispara el fallback neutro en el render).
assertEq(_grHexToRgba('not-a-color', 0.07), null, 'hexToRgba null en input invalido');
assertEq(_grHexToRgba(null, 0.07), null, 'hexToRgba null en null');

console.log('Listo.');
```

- [ ] **Step 4: Correr el script y confirmar que todo pasa**

Run: `node <scratchpad>/verify-gr-color-logic.js`
Expected: 9 líneas `PASS ...` (una por cada `assertEq`), última línea `Listo.`, exit code 0. Si
aparece cualquier `FAIL`, no seguir a la Task 2 — revisar la lógica antes de continuar.

- [ ] **Step 5: Commit**

```bash
git add gr/gr_app.js
git commit -m "$(cat <<'EOF'
feat: agrega paleta y cola rotativa de color para protocolos GR

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Wiring en guardarLote() y cargarDatosLote() [COMPLETADA — ver nota]

> **Nota post-implementación (2026-09-06):** el Step 1 original de esta task (abajo, tachado en
> espíritu aunque no en texto) resolvía el color dentro de `recolectarDatosLote()`. Code review
> encontró que esa función tiene callers de preview no-persistentes (`updateUnidadFisica()`,
> disparado en cada keystroke de UF y dos veces desde `cargarDatosLote()`) que quemaban la cola
> rotativa sin persistir nada. Lo que se implementó y quedó commiteado (`5458b93` + fix
> `9bcd1e4`) mueve la resolución a `guardarLote()` — el único boundary de persistencia real —
> justo antes de `lotesData[indiceExistente] = lote` / `lotesData.push(lote)`, después del gate
> de consumo CI. `recolectarDatosLote()` no toca `color` en absoluto. Detalle completo y código
> final: `docs/superpowers/specs/2026-09-06-gr-protocolo-color-design.md`, sección "Cuándo se
> asigna". El Step 1 de abajo queda como registro de lo que se planeó originalmente, no de lo
> que se implementó — no usarlo como referencia si se vuelve a tocar este código.

**Files:**
- Modify: `gr/gr_app.js` (`guardarLote`, `cargarDatosLote`)

- [ ] **Step 1: Insertar la resolución de color en `recolectarDatosLote()`**

Buscar, dentro de `recolectarDatosLote()`, el bloque final:
```js
        return {
            id: document.getElementById('loteId').value,
            nombre: document.getElementById('loteNombre').value,
            fecha: document.getElementById('loteFecha').value,
            version: document.getElementById('loteVersion').value,
            componentes,
            dc,
            hm: {},
            uf,
            dg,
            po,
            re,
            protoNotas: GR.protoNotas || [],
            seguimientoNotas: GR.seguimientoNotas || []
        };
    }
```
Reemplazar por:
```js
        // Color del protocolo — ver _grResolveLoteColor (sección "COLOR DE PROTOCOLO" arriba)
        const _loteExistente = lotesData.find(l => l.id === _loteIdActual);
        const _colorInput = document.getElementById('loteColor');
        const _colorManual = _colorInput ? _colorInput.dataset.manualEdit === 'true' : false;
        const _colorFinal = _grResolveLoteColor({
            existingColor: _loteExistente ? _loteExistente.color : null,
            manualEdit: _colorManual,
            inputValue: _colorInput ? _colorInput.value : null
        });

        return {
            id: document.getElementById('loteId').value,
            nombre: document.getElementById('loteNombre').value,
            fecha: document.getElementById('loteFecha').value,
            version: document.getElementById('loteVersion').value,
            color: _colorFinal,
            componentes,
            dc,
            hm: {},
            uf,
            dg,
            po,
            re,
            protoNotas: GR.protoNotas || [],
            seguimientoNotas: GR.seguimientoNotas || []
        };
    }
```

`_loteIdActual` ya existe más arriba en la misma función (`const _loteIdActual = (document.getElementById('loteId')?.value || '').trim();`, usada para el snapshot de Disponibles) — no se declara de nuevo.

- [ ] **Step 2: Poblar el input de color al cargar un lote existente**

Buscar, dentro de `cargarDatosLote(lote)`:
```js
        document.getElementById('loteNombre').value = lote.nombre || '';
        document.getElementById('loteFecha').value = lote.fecha || '';
        document.getElementById('loteVersion').value = lote.version || 'v1';
```
Reemplazar por:
```js
        document.getElementById('loteNombre').value = lote.nombre || '';
        document.getElementById('loteFecha').value = lote.fecha || '';
        document.getElementById('loteVersion').value = lote.version || 'v1';

        const colorInput = document.getElementById('loteColor');
        if (colorInput) {
            colorInput.dataset.manualEdit = 'false';
            colorInput.value = lote.color || '#FFD700';
            colorInput.style.opacity = lote.color ? '1' : '0.7';
        }
```

- [ ] **Step 3: Commit**

```bash
git add gr/gr_app.js
git commit -m "$(cat <<'EOF'
feat: resuelve y persiste el color del protocolo al guardar/cargar un lote GR

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

(La verificación end-to-end de este wiring —depende del DOM real— queda en la Task 5, junto
con el resto de la UI de GR.)

---

### Task 3: Input de color en el formulario de Formulación

**Files:**
- Modify: `gr/gr_index.html:92-95`

- [ ] **Step 1: Agregar el campo Color junto a Versión**

Buscar en `gr/gr_index.html`:
```html
                    <div class="form-group">
                        <label for="loteVersion">Versión</label>
                        <input type="text" id="loteVersion" value="v1">
                    </div>
                </div>
            </div>
        </section>
```
Reemplazar por:
```html
                    <div class="form-group">
                        <label for="loteVersion">Versión</label>
                        <input type="text" id="loteVersion" value="v1">
                    </div>
                    <div class="form-group">
                        <label for="loteColor">Color</label>
                        <input type="color" id="loteColor" value="#FFD700"
                            style="opacity:0.7;width:48px;height:34px;padding:2px;cursor:pointer"
                            oninput="this.dataset.manualEdit='true';this.style.opacity='1';"
                            title="Se asigna automáticamente al guardar. Elegí uno para fijarlo a mano.">
                    </div>
                </div>
            </div>
        </section>
```

- [ ] **Step 2: Commit**

```bash
git add gr/gr_index.html
git commit -m "$(cat <<'EOF'
feat: agrega selector de color al formulario de Datos del Lote en GR

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Tinte de card + swatch clickeable en Registro

**Files:**
- Modify: `gr/gr_app.js` (`grRenderizarRegistroLotes`, sección "COLOR DE PROTOCOLO")
- Modify: `gr/gr_styles.css:1429-1441` y `gr/gr_styles.css:1451-1456`

- [ ] **Step 1: Agregar `grSetLoteColor` a la sección "COLOR DE PROTOCOLO"**

En `gr/gr_app.js`, al final de la sección agregada en la Task 1 (después de `_grHexToRgba`),
agregar:
```js

window.grSetLoteColor = function grSetLoteColor(loteId, colorValue) {
    var idx = lotesData.findIndex(function (l) { return l.id === loteId; });
    if (idx < 0) return;
    lotesData[idx].color = colorValue;
    guardarEnStorage();
    grRenderizarRegistroLotes();
};
```

- [ ] **Step 2: Teñir la card y agregar el swatch en `grRenderizarRegistroLotes()`**

Buscar:
```js
        const loteIdSafe = (lote.id || '').replace(/'/g, "\\'");
        const grainFirma = _grFirmaProtocolo(lote);
        return `<div class="gr-reg-card" onclick="grCargarRegistroYVolver(${realIndex})" title="Cargar registro">
            <div class="gr-card-head">
                <div class="gr-card-identity">
                    <span class="gr-card-id">${lote.id || '-'}</span>
                    ${lote.nombre ? `<span class="gr-card-nombre">${lote.nombre}</span>` : ''}
                </div>
```
Reemplazar por:
```js
        const loteIdSafe = (lote.id || '').replace(/'/g, "\\'");
        const grainFirma = _grFirmaProtocolo(lote);
        const colorVars = lote.color
            ? ` style="--protocolo-color:${lote.color};--protocolo-bg:${_grHexToRgba(lote.color, 0.07)}"`
            : '';
        const colorSwatch = `<input type="color" class="gr-card-color-swatch" value="${lote.color || '#FFD700'}"
            onclick="event.stopPropagation()"
            onchange="event.stopPropagation(); grSetLoteColor('${loteIdSafe}', this.value)"
            title="Cambiar color del protocolo">`;
        return `<div class="gr-reg-card"${colorVars} onclick="grCargarRegistroYVolver(${realIndex})" title="Cargar registro">
            <div class="gr-card-head">
                <div class="gr-card-identity">
                    ${colorSwatch}
                    <span class="gr-card-id">${lote.id || '-'}</span>
                    ${lote.nombre ? `<span class="gr-card-nombre">${lote.nombre}</span>` : ''}
                </div>
```

- [ ] **Step 3: CSS — borde/fondo de la card vía custom properties**

En `gr/gr_styles.css`, buscar:
```css
.gr-reg-card {
    background: rgba(255, 215, 0, 0.04);
    border: 1px solid rgba(255, 215, 0, 0.18);
    border-radius: 10px;
    overflow: hidden;
    cursor: pointer;
    transition: border-color 160ms ease, background 160ms ease, box-shadow 160ms ease;
}
```
Reemplazar por:
```css
.gr-reg-card {
    background: var(--protocolo-bg, rgba(255, 215, 0, 0.04));
    border: 1px solid rgba(255, 215, 0, 0.18);
    border-left-width: 4px;
    border-left-color: var(--protocolo-color, rgba(255, 215, 0, 0.18));
    border-radius: 10px;
    overflow: hidden;
    cursor: pointer;
    transition: border-color 160ms ease, background 160ms ease, box-shadow 160ms ease;
}
```

- [ ] **Step 4: CSS — swatch circular**

En `gr/gr_styles.css`, buscar:
```css
.gr-card-identity {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-shrink: 0;
}
```
Reemplazar por:
```css
.gr-card-identity {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-shrink: 0;
}
.gr-card-color-swatch {
    width: 16px;
    height: 16px;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 50%;
    background: none;
    cursor: pointer;
    flex-shrink: 0;
    align-self: center;
}
.gr-card-color-swatch::-webkit-color-swatch-wrapper { padding: 0; border-radius: 50%; }
.gr-card-color-swatch::-webkit-color-swatch { border: none; border-radius: 50%; }
```

- [ ] **Step 5: Commit**

```bash
git add gr/gr_app.js gr/gr_styles.css
git commit -m "$(cat <<'EOF'
feat: tine las cards de Registro GR con el color del protocolo y agrega swatch editable

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Verificación end-to-end de GR en Chrome real [SALTEADA — ver nota]

> **Nota (2026-09-06):** se intentó ejecutar esta task con un subagente + `chrome-devtools` MCP.
> El Step 3 (chequeo de aislamiento) detectó que esa instancia de Chrome **no es un perfil de
> automatización descartable** — ya tenía datos reales de producción cargados (16 lotes GR
> reales incluyendo `GR113`, 66 bolsas FR, flags de migración). El subagente frenó ahí, no
> escribió nada en `localStorage`, cerró la page. El supuesto original de esta task (mismo
> mecanismo que las sesiones previas con Playwright + Chrome headless descartable) no aplica en
> este entorno. Consultado el usuario, decidió probar la feature a mano en su propio navegador
> una vez commiteado todo el plan — esta task y la Task 8 (verificación FR/SU) quedan
> reemplazadas por esa verificación manual. La cobertura de code review (spec compliance +
> calidad, 2 rondas por task, con 2 bugs reales encontrados y corregidos en Tasks 2 y 4) sigue
> vigente sin cambios.

**Files:** ninguno (solo verificación)

- [ ] **Step 1: Cargar las herramientas de Chrome DevTools**

Run: `ToolSearch` con query `select:mcp__chrome-devtools__new_page,mcp__chrome-devtools__navigate_page,mcp__chrome-devtools__evaluate_script,mcp__chrome-devtools__take_screenshot,mcp__chrome-devtools__list_console_messages,mcp__chrome-devtools__click,mcp__chrome-devtools__close_page`

- [ ] **Step 2: Levantar el servidor local**

Run (en background, desde la raíz del repo): `python -m http.server 8734`
Expected: proceso queda corriendo, sin error de puerto ocupado. Si el puerto ya está en uso,
es porque el usuario ya tiene el server corriendo — no matarlo, simplemente usar
`http://localhost:8734` directo.

- [ ] **Step 3: Abrir una page nueva y confirmar que es un perfil aislado**

Con `mcp__chrome-devtools__new_page`, abrir `http://localhost:8734/`. Con
`mcp__chrome-devtools__evaluate_script`, correr:
```js
() => ({ keys: Object.keys(localStorage), count: Object.keys(localStorage).length })
```
Expected: `count` es `0` o un número muy chico de keys que NO incluye `gr_lotes`/`fr_bolsas`
(perfil limpio de automatización). **Si aparece `gr_lotes` con datos reales del usuario, parar
acá y avisar** — significaría que esta instancia de Chrome comparte perfil con el navegador
real del usuario, y seedear el backup de prueba lo sobreescribiría.

- [ ] **Step 4: Seedear el backup real de prueba**

El backup `biolab-backup-FECHA_03-09-2026_HORA_12-02-44_CON-RESUMENES.json` tiene 47 keys de
primer nivel y **no** incluye `bl2_gh` (confirmado — el propio export de CFG ya lo excluye,
ver CLAUDE.md sección "GITHUB — Publicación y Backups"), así que no hace falta filtrarlo.

Leer el archivo con el tool Read, y con `mcp__chrome-devtools__evaluate_script` correr un
script que arme el objeto backup como literal JS embebido directamente en el código del
script (no depender de un mecanismo de paso de `args` sin confirmar) — construir el string del
script tomando el JSON leído y armando:
```js
() => {
    var backup = /* JSON.stringify(<contenido del archivo, ya parseado>) pegado acá literal */;
    Object.keys(backup).forEach(k => localStorage.setItem(k, backup[k]));
    return 'seeded ' + Object.keys(backup).length + ' keys';
}
```
Expected: `'seeded 47 keys'`.

- [ ] **Step 5: Recargar y navegar a GR → Registro**

`mcp__chrome-devtools__navigate_page` a `http://localhost:8734/` (recarga para que `main.js`
lea el localStorage recién seedeado). Luego `mcp__chrome-devtools__evaluate_script`:
```js
() => { loadModule('GR'); return 'ok'; }
```
Esperar un instante y correr:
```js
() => { GR.subTab('reg'); return document.querySelectorAll('.gr-reg-card').length; }
```
Expected: `17` (los 17 lotes reales del backup, todos sin color todavía — cards con el borde
dorado default, sin `--protocolo-color`).

- [ ] **Step 6: Asignar color manual a GR113 desde el swatch de la card y verificar el tinte**

```js
() => {
    var card = [...document.querySelectorAll('.gr-reg-card')].find(c => c.querySelector('.gr-card-id')?.textContent.trim() === 'GR113');
    var swatch = card.querySelector('.gr-card-color-swatch');
    swatch.value = '#3FA9DB';
    swatch.dispatchEvent(new Event('change', { bubbles: true }));
    var updated = [...document.querySelectorAll('.gr-reg-card')].find(c => c.querySelector('.gr-card-id')?.textContent.trim() === 'GR113');
    var cs = getComputedStyle(updated);
    return {
        borderLeftColor: cs.borderLeftColor,
        backgroundColor: cs.backgroundColor,
        storedColor: JSON.parse(localStorage.getItem('gr_lotes')).find(l => l.id === 'GR113').color
    };
}
```
Expected: `storedColor === '#3FA9DB'`, `borderLeftColor` computa a `rgb(63, 169, 219)` (equivalente
rgb de `#3FA9DB`), `backgroundColor` computa a algo con alpha ~0.07 sobre ese mismo rgb (no el
`rgba(255,215,0,0.04)` default).

- [ ] **Step 7: Verificar que autoasignación consume la cola al crear un lote nuevo sin tocar el picker**

```js
() => {
    var before = parseInt(localStorage.getItem('gr_color_seq'), 10) || 0;
    document.getElementById('loteId').value = 'GR_TEST_PLAN';
    document.getElementById('loteNombre').value = 'TEST';
    document.getElementById('loteFecha').value = '2026-09-06';
    document.getElementById('ufCantidadUnidades').value = '10';
    document.getElementById('ufPesoUnidad').value = '500';
    guardarLote();
    var lote = JSON.parse(localStorage.getItem('gr_lotes')).find(l => l.id === 'GR_TEST_PLAN');
    var after = parseInt(localStorage.getItem('gr_color_seq'), 10) || 0;
    return { colorAsignado: lote.color, before, after };
}
```
Expected: `colorAsignado` es un hex de `GR_COLOR_PALETTE`, y `after === before + 1` (la cola
avanzó exactamente una posición). Nota: `guardarLote()` dispara un `alert()` nativo
("Lote guardado correctamente") — si el `evaluate_script` queda bloqueado por el diálogo, usar
`mcp__chrome-devtools__handle_dialog` para aceptarlo antes de leer el resultado, o envolver la
llamada en un override temporal de `window.alert = () => {}` dentro del mismo script antes de
llamar a `guardarLote()`.

- [ ] **Step 8: Limpiar el lote de prueba**

```js
() => {
    var lotes = JSON.parse(localStorage.getItem('gr_lotes')).filter(l => l.id !== 'GR_TEST_PLAN');
    localStorage.setItem('gr_lotes', JSON.stringify(lotes));
    return 'limpio';
}
```

- [ ] **Step 9: Chequear consola sin errores nuevos**

`mcp__chrome-devtools__list_console_messages` → expected: sin entradas `type:'error'`
originadas en `gr_app.js` (pueden existir warnings preexistentes de otros módulos no
relacionados; si aparece alguno nuevo apuntando a `gr_app.js`/`gr_index.html`/`gr_styles.css`,
es un bug a corregir antes de seguir).

- [ ] **Step 10: Screenshot de referencia**

`mcp__chrome-devtools__take_screenshot` de la pantalla de Registro con GR113 coloreado — sirve
como evidencia visual de que el estilo A (borde + fondo sutil) se ve como en el mockup
aprobado.

No hay commit en esta task — es solo verificación. Si algún paso falla, volver a la task
correspondiente (2, 3 o 4), corregir, y repetir esta Task 5 desde el Step 5.

---

### Task 6: Propagación a FR — chip de color en la columna GR

**Files:**
- Modify: `fr/fr_app.js` (nuevas funciones cerca de `_grTxtFromBolsa`, y 2 call sites)

- [ ] **Step 1: Agregar los helpers de chip, inmediatamente después de `_grTxtFromBolsa`**

Buscar en `fr/fr_app.js`:
```js
    function _grTxtFromBolsa(b) {
        if (Array.isArray(b.grSources) && b.grSources.length > 1) {
            return b.grSources.map(function(s) {
                return (s.grLoteId || '—') + (s.grTandaId ? ' · ' + s.grTandaId : '');
            }).join(' + ');
        }
        return (b.grLoteId || '—') + (b.grTandaId ? ' · ' + b.grTandaId : '');
    }
```
Reemplazar por (agrega las 3 funciones nuevas después, sin tocar `_grTxtFromBolsa` — sigue
usándose tal cual para búsqueda/orden):
```js
    function _grTxtFromBolsa(b) {
        if (Array.isArray(b.grSources) && b.grSources.length > 1) {
            return b.grSources.map(function(s) {
                return (s.grLoteId || '—') + (s.grTandaId ? ' · ' + s.grTandaId : '');
            }).join(' + ');
        }
        return (b.grLoteId || '—') + (b.grTandaId ? ' · ' + b.grTandaId : '');
    }

    // Chip de color por protocolo GR — resuelto en vivo contra gr_lotes, nunca persiste nada.
    // _grTxtFromBolsa (arriba) sigue devolviendo texto plano para búsqueda/orden (_frBuscar,
    // _sortValue) — este helper nuevo es solo para render. Mismo criterio que _geChipFromBolsa
    // vs _geTxtFromBolsa (ver spec 2026-08-31-fr-su-genetica-chip-acortado-design.md).
    function _grColorForSource(s) {
        if (!s || !s.grLoteId) return null;
        try {
            var l = getGRLotesMap()[s.grLoteId];
            return (l && l.color) || null;
        } catch (e) { return null; }
    }

    function _grChipHtml(label, hex) {
        if (!label) return '—';
        var bg = hex ? _hexToRgba(hex, 0.15) : null;
        var border = hex ? _hexToRgba(hex, 0.40) : null;
        var style = bg ? ' style="background:' + bg + ';border-color:' + border + ';color:' + esc(hex) + '"' : '';
        return '<span class="fr-traza"' + style + ' title="' + esc(label) + '">' + esc(label) + '</span>';
    }

    function _grChipFromBolsa(b) {
        if (Array.isArray(b.grSources) && b.grSources.length > 1) {
            return b.grSources.map(function(s) {
                var label = (s.grLoteId || '—') + (s.grTandaId ? ' · ' + s.grTandaId : '');
                return _grChipHtml(label, _grColorForSource(s));
            }).join(' + ');
        }
        var label = (b.grLoteId || '—') + (b.grTandaId ? ' · ' + b.grTandaId : '');
        return _grChipHtml(label, _grColorForSource({ grLoteId: b.grLoteId }));
    }
```

- [ ] **Step 2: Usar el chip en `filaTabla()`**

Buscar:
```js
        var ge = _geChipFromBolsa(b);
        var suTxt = (b.suLoteId || '—') + (b.suSubTanda ? ' · ' + b.suSubTanda : '');
        var grTxt = _grTxtFromBolsa(b);
```
Reemplazar por:
```js
        var ge = _geChipFromBolsa(b);
        var suTxt = (b.suLoteId || '—') + (b.suSubTanda ? ' · ' + b.suSubTanda : '');
        var grChip = _grChipFromBolsa(b);
```
Y buscar, más abajo en la misma función:
```js
            + '<td ' + cl + '><span class="fr-traza">' + esc(suTxt) + '</span></td>'
            + '<td ' + cl + '><span class="fr-traza">' + esc(grTxt) + '</span></td>'
```
Reemplazar por:
```js
            + '<td ' + cl + '><span class="fr-traza">' + esc(suTxt) + '</span></td>'
            + '<td ' + cl + '>' + grChip + '</td>'
```

- [ ] **Step 3: Usar el chip en `filaPendiente()`**

Buscar:
```js
        var ge    = _geChipFromBolsa(b);
        var suTxt = (b.suLoteId || '—') + (b.suSubTanda ? ' · ' + b.suSubTanda : '');
        var grTxt = _grTxtFromBolsa(b);
```
Reemplazar por:
```js
        var ge    = _geChipFromBolsa(b);
        var suTxt = (b.suLoteId || '—') + (b.suSubTanda ? ' · ' + b.suSubTanda : '');
        var grChip = _grChipFromBolsa(b);
```
Y buscar, más abajo en la misma función:
```js
            + '<td><span class="fr-traza">' + esc(suTxt) + '</span></td>'
            + '<td><span class="fr-traza">' + esc(grTxt) + '</span></td>'
```
Reemplazar por:
```js
            + '<td><span class="fr-traza">' + esc(suTxt) + '</span></td>'
            + '<td>' + grChip + '</td>'
```

- [ ] **Step 4: Commit**

```bash
git add fr/fr_app.js
git commit -m "$(cat <<'EOF'
feat: tine el chip de referencia GR en FR con el color del protocolo

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Propagación a SU — chip de color en la columna GRANO

**Files:**
- Modify: `su/su_app.js` (nueva función cerca de `_suGenChipHtml`, 1 call site)

- [ ] **Step 1: Agregar `_suGrTandaChipHtml` después de `_suGenChipHtml`**

Buscar en `su/su_app.js`:
```js
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
Agregar inmediatamente después:
```js

// Chip de color por protocolo GR para el id de tanda (columna GRANO de Registro). Resuelto en
// vivo contra el grMap que cada función de render ya arma — cero lecturas nuevas, cero cambios
// en su_lotes. Mismo mecanismo/paleta que la card de GR (gr_app.js:_grHexToRgba).
function _suGrTandaChipHtml(grLoteId, grTandaId, grMap) {
    if (!grTandaId) return '';
    var l = grMap[grLoteId || ''];
    var hex = (l && l.color) || null;
    var bg = hex ? _suHexToRgba(hex, 0.13) : null;
    var border = hex ? _suHexToRgba(hex, 0.40) : null;
    var cls = 'su-kchip' + (bg ? '' : ' su-kchip-dim');
    var style = bg ? ' style="background:' + bg + ';border-color:' + border + ';color:' + suDbEscapeHtml(hex) + '"' : '';
    return '<span class="' + cls + '"' + style + ' title="Lote GR: ' + suDbEscapeHtml(grLoteId || '') + '">' + suDbEscapeHtml(grTandaId) + '</span>';
}
```

- [ ] **Step 2: Usar el chip en el armado de `grTxtParts`**

Buscar en `su/su_app.js`:
```js
                grTxtParts.push(s.grTandaId + (_gen ? ' — ' + _suGenChipHtml(_gen, _fenId) : ''));
```
Reemplazar por:
```js
                grTxtParts.push(_suGrTandaChipHtml(s.grLoteId, s.grTandaId, grMap) + (_gen ? ' — ' + _suGenChipHtml(_gen, _fenId) : ''));
```

- [ ] **Step 3: Commit**

```bash
git add su/su_app.js
git commit -m "$(cat <<'EOF'
feat: tine el chip de tanda GR en la columna GRANO de SU con el color del protocolo

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Verificación end-to-end de FR/SU en Chrome real

**Files:** ninguno (solo verificación)

Continúa sobre la misma page/perfil de la Task 5 (con el backup ya seedeado y `GR113` ya
coloreado `#3FA9DB` en `gr_lotes`, si la Task 5 no lo limpió — si se limpió el color de prueba
en el Step 8 de esa task, volver a asignarlo primero con el mismo script del Step 6 de la Task
5 antes de continuar acá).

- [ ] **Step 1: Confirmar que GR113 tiene color en storage**

```js
() => JSON.parse(localStorage.getItem('gr_lotes')).find(l => l.id === 'GR113').color
```
Expected: `'#3FA9DB'`. Si da `null`/`undefined`, repetir el Step 6 de la Task 5 antes de
continuar.

- [ ] **Step 2: Navegar a FR y verificar el chip de la bolsa FR44**

```js
() => { loadModule('FR'); return 'ok'; }
```
Esperar un instante, luego:
```js
() => {
    var row = [...document.querySelectorAll('.fr-row')].find(r => r.textContent.includes('FR44'));
    var chip = row ? row.querySelectorAll('.fr-traza')[1] : null; // [0]=SU, [1]=GR
    if (!chip) return { found: false };
    var cs = getComputedStyle(chip);
    return { found: true, text: chip.textContent.trim(), backgroundColor: cs.backgroundColor, color: cs.color };
}
```
Expected: `found:true`, `text` incluye `GR113`, `backgroundColor`/`color` reflejan
`#3FA9DB` (no el dorado default `rgba(212,160,23,...)` de `.fr-traza`).

- [ ] **Step 3: Navegar a SU y verificar el chip de la sub-fila de SU44**

```js
() => { loadModule('SU'); return 'ok'; }
```
Esperar un instante, luego:
```js
() => {
    var card = [...document.querySelectorAll('.su-reg-card')].find(c => c.textContent.includes('SU44'));
    var chip = card ? card.querySelector('.su-kchip:not(.su-kchip-fr):not(.su-kchip-pending):not(.su-kchip-dim)') : null;
    if (!chip) return { found: false };
    var cs = getComputedStyle(chip);
    return { found: true, text: chip.textContent.trim(), backgroundColor: cs.backgroundColor };
}
```
Expected: `found:true`, `text` es `GR113d` (el `grTandaId`), `backgroundColor` refleja
`#3FA9DB`. Si el selector no matchea por haber más de un `su-kchip` sin esas clases negativas
en la misma card (ej. el chip de genética `_suGenChipHtml` también cae en `su-kchip` sin clase
dim cuando resuelve color GE), ajustar el selector para tomar específicamente el primer
`su-kchip` dentro de `.su-sub-gen` — inspeccionar con
`mcp__chrome-devtools__take_screenshot`/`take_snapshot` si hace falta.

- [ ] **Step 4: Chequear consola sin errores nuevos**

`mcp__chrome-devtools__list_console_messages` → expected: sin `type:'error'` nuevos originados
en `fr_app.js`/`su_app.js`.

- [ ] **Step 5: Limpiar — quitar el color de prueba de GR113 y cerrar la page**

```js
() => {
    var lotes = JSON.parse(localStorage.getItem('gr_lotes'));
    var l = lotes.find(x => x.id === 'GR113');
    delete l.color;
    localStorage.setItem('gr_lotes', JSON.stringify(lotes));
    return 'limpio';
}
```
Luego `mcp__chrome-devtools__close_page`. No hay commit en esta task.

---

### Task 9: Documentación — CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (raíz del repo `biolab-app/`) — tabla de persistencia + nueva entrada de
  invariante

- [ ] **Step 1: Agregar la key nueva a la tabla de persistencia**

Buscar la fila de la tabla:
```
| `gr_lotes` | GR | Lotes de grano inoculado |
```
Reemplazar por:
```
| `gr_lotes` | GR | Lotes de grano inoculado (incluye `color` por protocolo desde 2026-09-06) |
| `gr_color_seq` | GR | Contador de la cola rotativa de color de protocolo |
```

- [ ] **Step 2: Agregar la entrada de invariante en la sección "INVARIANTES VIGENTES"**

Al final de la sección `## INVARIANTES VIGENTES — de sesiones de fixes recientes` (antes del
siguiente `---`), agregar:

```markdown
- **GR — Color por protocolo (2026-09-06).** Cada lote (`gr_lotes[].color`, hex) recibe un
  color automático de una paleta fija de 12 (`GR_COLOR_PALETTE`, `gr_app.js`), asignado como
  **cola rotativa** vía el contador `gr_color_seq` — nunca como mapeo por mes (se descartó esa
  idea en brainstorming: agrupaba todos los protocolos de un mismo mes bajo el mismo color,
  matando la diferenciación). Un color elegido a mano no consume la cola.
  `_grResolveLoteColor()` es la única función que decide: preserva el color existente si no se
  tocó el picker, usa el valor del picker si `dataset.manualEdit==='true'`, autoasigna en
  cualquier otro caso. Sin migración retroactiva — lotes históricos quedan sin color hasta que
  se re-guarden o se les asigne desde el swatch de la card en Registro (`grSetLoteColor`).
  FR (columna GR, `_grChipFromBolsa`) y SU (columna GRANO, `_suGrTandaChipHtml`) resuelven el
  color **en vivo** contra `gr_lotes` en cada render — mismo mecanismo (custom
  properties/inline style, fallback neutro si el lote no existe o no tiene color) que ya usa el
  chip de genética acortado (ver entrada 2026-08-31 más abajo). Ninguno de los dos escribe en
  su propio storage por esto. Spec: `docs/superpowers/specs/2026-09-06-gr-protocolo-color-design.md`.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: documenta el invariante de color por protocolo GR en CLAUDE.md

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Resumen de archivos tocados

- `gr/gr_app.js` — paleta/cola/helpers, wiring en recolectar/cargar, tinte de card + swatch.
- `gr/gr_index.html` — input de color en Formulación.
- `gr/gr_styles.css` — custom properties en `.gr-reg-card`, estilo del swatch.
- `fr/fr_app.js` — chip de color en columna GR (`filaTabla`, `filaPendiente`).
- `su/su_app.js` — chip de color en columna GRANO.
- `CLAUDE.md` — tabla de persistencia + invariante nuevo.

Nada de esto toca `main.js`, `cilab_conocimiento.js` (ese archivo aparece modificado en
`git status` desde antes de esta sesión — no relacionado, no tocar/commitear como parte de este
plan), ni ningún módulo fuera de GR/FR/SU.
