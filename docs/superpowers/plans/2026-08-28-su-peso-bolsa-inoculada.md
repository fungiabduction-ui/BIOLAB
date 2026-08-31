# SU — "Bolsa inoculada" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un campo nuevo en la fila de distribución de SU donde el operador carga el peso de la bolsa ya inoculada, y el sistema calcula `Grano = Bolsa inoculada − Sustrato real` automáticamente, escribiéndolo en el campo Grano que ya existe — sin agregar una fuente de verdad nueva ni tocar nada río abajo de `pesoGranoReal`.

**Architecture:** Tercera columna en `.db-row-pesos-body` (`su/su_app.js`, `suDbAddRow`), con su propio modificador CSS. Un handler nuevo (`suDbOnChangeBolsaInoculada`) valida que Sustrato tenga un peso real cargado, calcula la resta, escribe el resultado en `.db-peso-grano-real`, y registra (o actualiza in-place, nunca duplica) una nota automática en `SU.dbSeguimientoNotas` vía una función nueva (`_suDbLogGranoAuto`) que busca por `tipo+tanda` en vez de siempre agregar una entrada nueva.

**Tech Stack:** JavaScript vanilla (sin build step, sin framework de test — mismo patrón que el resto de `su_app.js`/`fr_app.js`). Verificación vía `node --check` + Chrome real (DevTools MCP) contra estado 100% en memoria — esta feature nunca escribe a `localStorage['su_lotes']` directamente (eso lo hace una función de guardado separada, no tocada en este plan), así que no hace falta ningún resguardo especial de datos reales más allá de la disciplina habitual de usar un contexto de navegador aislado.

---

## Contexto que el ingeniero necesita

- Spec completo: `docs/superpowers/specs/2026-08-28-su-peso-bolsa-inoculada-design.md` — leerlo antes de empezar, tiene el razonamiento completo de cada decisión (por qué bloquear en vez de usar el teórico, por qué Grano sigue editable, por qué la nota se sobrescribe en vez de duplicarse).
- El archivo a modificar es `su/su_app.js` — sin IIFE visible como wrapper único, pero todas las funciones relevantes (`suDbRegistrarSeguimiento`, `_suNotaId`, `suDbCollect`, etc.) conviven en el mismo scope y se llaman entre sí directamente. Funciones usadas por handlers inline (`onchange="..."` en HTML generado) se exponen como `window.suDbXxx = function(...)`; funciones internas (llamadas solo desde otro JS, nunca desde HTML) son declaraciones planas `function xxxYyy() {...}` — **seguir esa misma convención exacta** para las funciones nuevas de este plan.
- No hay test runner (`no package.json`). Verificación vía `node --check` + Chrome real, mismo patrón que los planes anteriores de esta sesión (`docs/superpowers/plans/2026-08-28-fr-sync-deshidratado.md`).
- La sección "DB - Distribución de Bolsas" vive en `su/su_index.html`, dentro del subtab `su-sub-main` (activo por default al cargar el módulo SU — no hace falta navegación extra, `http://localhost:8734/index.html#SU` la muestra directo).
- Funciones/campos ya existentes que este plan reusa tal cual (confirmado leyendo el código real):
  - `suDbAddRow()` (`su_app.js:2682`) — crea una fila `.db-row` nueva con los inputs de pesos.
  - `.db-peso-real` / `.db-peso-grano-real` — inputs ya existentes en esa fila. `0` = sin override (teórico / calculado desde GR). Ninguno de los dos tiene `onchange`/`oninput` hoy.
  - `suDbCollect()` (`su_app.js:3430`) / `suDbLoadFromLote(lote)` (`su_app.js:3485`) — serializan/restauran el array `db` de un lote, un objeto por fila.
  - `suDbRegistrarSeguimiento(tipo, mensaje, emoji)` (`su_app.js:3195`) — patrón existente de auto-log, siempre agrega una entrada nueva a `SU.dbSeguimientoNotas`. Este plan **no lo modifica** — agrega una función hermana nueva con semántica distinta (buscar-y-actualizar), no reutiliza esta.
  - `_suNotaId()` (`su_app.js:2473`) — genera el `id` de una nota nueva.
  - `SU.dbSeguimientoNotas` — array de módulo, ya inicializado (`su_app.js:2463`).
  - `window.suDbRenderSeguimientoNotas()` (`su_app.js:3318`) — re-renderiza el panel de notas; ya defensivo (`if (!cont) return`) si el contenedor no está en el DOM.
  - `su_styles.css:1481-1531` — bloques `.db-peso-col--sust`/`.db-peso-col--gran`, patrón de acento por color a copiar para el nuevo `--inoc` (verde `#70AD47`, ya usado en la paleta de SU — `su_styles.css:11` `--highlight`, `su_styles.css:25` `--su-aditivo`).
- Antes de cada commit: `node --check su/su_app.js` (sintaxis) como mínimo.
- **Nunca usar `db-peso-real`/`db-peso-grano-real` como fuente de identidad de fila** — la identidad de fila en este plan es siempre el elemento DOM `.db-row` en sí (`inputEl.closest('.db-row')`), consistente con cómo ya opera `suDbOnChangeBolsas`.

---

### Task 1: UI — input "Bolsa inoculada" (sin wiring todavía)

**Files:**
- Modify: `su/su_app.js` — `suDbAddRow()`, línea ~2699-2706
- Modify: `su/su_styles.css` — después del bloque `.db-peso-col--gran`, línea ~1527

Este task solo agrega el shell visual — el input no hace nada todavía (sin `onchange`), para que el commit quede en un estado consistente sin depender de una función que recién se define en el Task 4.

- [ ] **Step 1: Agregar la columna nueva al HTML de la fila**

Modify `su/su_app.js` — dentro de `suDbAddRow()`, reemplazar:

```javascript
        +     '<div class="db-peso-col db-peso-col--sust" title="Peso real del sustrato por bolsa. 0 = peso teórico del lote">'
        +       '<span class="db-cell-label">🧱 Sustrato</span>'
        +       '<input type="number" class="db-peso-real" value="0" min="0" step="1" placeholder="—">'
        +     '</div>'
        +     '<div class="db-peso-col db-peso-col--gran" title="Peso real del grano por bolsa. 0 = calcular automáticamente desde GR">'
        +       '<span class="db-cell-label">🌾 Grano</span>'
        +       '<input type="number" class="db-peso-grano-real" value="0" min="0" step="0.1" placeholder="—">'
        +     '</div>'
```

por:

```javascript
        +     '<div class="db-peso-col db-peso-col--sust" title="Peso real del sustrato por bolsa. 0 = peso teórico del lote">'
        +       '<span class="db-cell-label">🧱 Sustrato</span>'
        +       '<input type="number" class="db-peso-real" value="0" min="0" step="1" placeholder="—">'
        +     '</div>'
        +     '<div class="db-peso-col db-peso-col--inoc" title="Peso real de la bolsa ya inoculada (sustrato + grano). Calcula el Grano automáticamente restando el peso real de Sustrato.">'
        +       '<span class="db-cell-label">⚖️ Bolsa inoc.</span>'
        +       '<input type="number" class="db-peso-bolsa-inoculada" value="0" min="0" step="0.1" placeholder="—">'
        +       '<span class="db-peso-bolsa-inoculada-msg"></span>'
        +     '</div>'
        +     '<div class="db-peso-col db-peso-col--gran" title="Peso real del grano por bolsa. 0 = calcular automáticamente desde GR">'
        +       '<span class="db-cell-label">🌾 Grano</span>'
        +       '<input type="number" class="db-peso-grano-real" value="0" min="0" step="0.1" placeholder="—">'
        +     '</div>'
```

- [ ] **Step 2: CSS del nuevo acento (verde) + mensaje de aviso**

Modify `su/su_styles.css` — localizar el bloque que termina así:

```css
.db-peso-col--gran input:not([value="0"]):not([value=""]) {
    border-color: #FFC000;
    color: #ffd966;
    background: rgba(255,192,0,0.05);
}

/* Mantener compatibilidad con selectores de clase directa */
.db-row .db-peso-real        { /* heredado de .db-peso-col--sust input */ }
.db-row .db-peso-grano-real  { /* heredado de .db-peso-col--gran input */ }
```

Reemplazar por:

```css
.db-peso-col--gran input:not([value="0"]):not([value=""]) {
    border-color: #FFC000;
    color: #ffd966;
    background: rgba(255,192,0,0.05);
}

/* Input bolsa inoculada — acento verde */
.db-peso-col--inoc input {
    width: 58px;
    padding: 4px 5px;
    font-size: 0.82rem;
    font-weight: 600;
    border-radius: 5px;
    border: 1px solid rgba(112,173,71,0.25);
    background: var(--dark, #1D1D1D);
    color: var(--text-light, #ddd);
    text-align: center;
    transition: border-color 150ms, color 150ms, box-shadow 150ms;
}
.db-peso-col--inoc input:focus {
    outline: none;
    border-color: #70AD47;
    box-shadow: 0 0 0 2px rgba(112,173,71,0.14);
}
.db-peso-col--inoc input:not([value="0"]):not([value=""]) {
    border-color: #70AD47;
    color: #a8d18d;
    background: rgba(112,173,71,0.06);
}
.db-peso-bolsa-inoculada-msg {
    display: none;
    font-size: 0.68rem;
    color: #FF9F45;
    text-align: center;
    margin-top: 2px;
    max-width: 90px;
    line-height: 1.15;
}

/* Mantener compatibilidad con selectores de clase directa */
.db-row .db-peso-real        { /* heredado de .db-peso-col--sust input */ }
.db-row .db-peso-grano-real  { /* heredado de .db-peso-col--gran input */ }
```

- [ ] **Step 3: `node --check`**

Run: `node --check su/su_app.js`
Expected: sin output, exit code 0. (`su_styles.css` no tiene chequeo de sintaxis vía Node — revisar visualmente que las llaves cierren bien.)

- [ ] **Step 4: Commit**

```bash
git add su/su_app.js su/su_styles.css
git commit -m "feat(su): input Bolsa inoculada — shell visual sin wiring (MEJ Bolsa inoculada parte 1)"
```

---

### Task 2: Persistencia — `pesoBolsaInoculada` en collect/load

**Files:**
- Modify: `su/su_app.js` — `suDbCollect()` línea ~3439-3445 y ~3467-3480; `suDbLoadFromLote()` línea ~3505-3509

- [ ] **Step 1: Leer el input nuevo en `suDbCollect()`**

Modify `su/su_app.js`, reemplazar:

```javascript
        // Peso real de sustrato por bolsa (g). null = sin override, usar peso teórico del lote.
        var _prRaw = parseFloat((row.querySelector('.db-peso-real') || {}).value) || 0;
        var pesoReal = _prRaw > 0 ? _prRaw : null;

        // Peso real de grano por bolsa (g). null = sin override, calcular desde GR automáticamente.
        var _pgRaw = parseFloat((row.querySelector('.db-peso-grano-real') || {}).value) || 0;
        var pesoGranoReal = _pgRaw > 0 ? _pgRaw : null;
```

por:

```javascript
        // Peso real de sustrato por bolsa (g). null = sin override, usar peso teórico del lote.
        var _prRaw = parseFloat((row.querySelector('.db-peso-real') || {}).value) || 0;
        var pesoReal = _prRaw > 0 ? _prRaw : null;

        // Peso real de grano por bolsa (g). null = sin override, calcular desde GR automáticamente.
        var _pgRaw = parseFloat((row.querySelector('.db-peso-grano-real') || {}).value) || 0;
        var pesoGranoReal = _pgRaw > 0 ? _pgRaw : null;

        // Peso real de la bolsa ya inoculada (g). Solo alimenta el calculo de pesoGranoReal via
        // suDbOnChangeBolsaInoculada -- suCalcularMetricasLote y todo lo demas rio abajo sigue
        // leyendo unicamente pesoGranoReal, sin cambios.
        var _piRaw = parseFloat((row.querySelector('.db-peso-bolsa-inoculada') || {}).value) || 0;
        var pesoBolsaInoculada = _piRaw > 0 ? _piRaw : null;
```

- [ ] **Step 2: Agregar el campo al objeto persistido**

Modify `su/su_app.js`, reemplazar:

```javascript
            tanda:     tanda,
            bolsas:    bolsas,
            pesoReal:      pesoReal,      // null → teórico sustrato; >0 → override manual (g/bolsa)
            pesoGranoReal: pesoGranoReal, // null → calcular desde GR; >0 → override manual (g/bolsa)
            grSources: grSources,
```

por:

```javascript
            tanda:     tanda,
            bolsas:    bolsas,
            pesoReal:      pesoReal,      // null → teórico sustrato; >0 → override manual (g/bolsa)
            pesoGranoReal: pesoGranoReal, // null → calcular desde GR; >0 → override manual (g/bolsa)
            pesoBolsaInoculada: pesoBolsaInoculada, // null o >0; solo insumo del calculo, nada rio abajo lo lee
            grSources: grSources,
```

- [ ] **Step 3: Restaurar el input nuevo en `suDbLoadFromLote()`**

Modify `su/su_app.js`, reemplazar:

```javascript
            // Restaurar pesos reales (0 = sin override / usar valor teórico/automático)
            var prInp = mainRow.querySelector('.db-peso-real');
            if (prInp) prInp.value = (parseFloat(d.pesoReal) > 0) ? parseFloat(d.pesoReal) : 0;
            var pgInp = mainRow.querySelector('.db-peso-grano-real');
            if (pgInp) pgInp.value = (parseFloat(d.pesoGranoReal) > 0) ? parseFloat(d.pesoGranoReal) : 0;
```

por:

```javascript
            // Restaurar pesos reales (0 = sin override / usar valor teórico/automático)
            var prInp = mainRow.querySelector('.db-peso-real');
            if (prInp) prInp.value = (parseFloat(d.pesoReal) > 0) ? parseFloat(d.pesoReal) : 0;
            var pgInp = mainRow.querySelector('.db-peso-grano-real');
            if (pgInp) pgInp.value = (parseFloat(d.pesoGranoReal) > 0) ? parseFloat(d.pesoGranoReal) : 0;
            var piInp = mainRow.querySelector('.db-peso-bolsa-inoculada');
            if (piInp) piInp.value = (parseFloat(d.pesoBolsaInoculada) > 0) ? parseFloat(d.pesoBolsaInoculada) : 0;
```

- [ ] **Step 4: `node --check`**

Run: `node --check su/su_app.js`
Expected: sin output, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add su/su_app.js
git commit -m "feat(su): persiste pesoBolsaInoculada en collect/load (MEJ Bolsa inoculada parte 2)"
```

---

### Task 3: Auto-log — `_suDbLogGranoAuto` (busca-y-actualiza, nunca duplica)

**Files:**
- Modify: `su/su_app.js` — insertar después del cierre de `suDbRegistrarSeguimiento`, línea ~3214

- [ ] **Step 1: Agregar la función**

Modify `su/su_app.js`, localizar:

```javascript
    SU.dbSeguimientoNotas.push({
        id: _suNotaId(),
        ts: new Date().toISOString(),
        tsLegacy: null,
        tsInferred: false,
        tipo: tipo,
        texto: mensaje,
        estado: estado,
        auto: true,
        editedAt: null,
        imagenes: []
    });
    window.suDbRenderSeguimientoNotas();
}

// ---------- HANDLERS INLINE ----------
```

(ese es el cierre de `suDbRegistrarSeguimiento` seguido del comentario de sección) y reemplazar por:

```javascript
    SU.dbSeguimientoNotas.push({
        id: _suNotaId(),
        ts: new Date().toISOString(),
        tsLegacy: null,
        tsInferred: false,
        tipo: tipo,
        texto: mensaje,
        estado: estado,
        auto: true,
        editedAt: null,
        imagenes: []
    });
    window.suDbRenderSeguimientoNotas();
}

// Registra (o actualiza in-place) la nota automatica de grano calculado por resta -- a
// diferencia de suDbRegistrarSeguimiento (que siempre agrega una entrada nueva, usado por
// inoculacion/frascos-gr), esta busca la nota existente de esta tanda por tipo+tanda y
// sobreescribe su texto + editedAt en vez de duplicar. Decision del usuario en brainstorming
// (2026-08-28): una sola nota vigente por tanda, no un historial de "correcciones". Buscar por
// tanda en vez de por un id guardado en el DOM porque asi sigue encontrando la nota correcta
// despues de cerrar y reabrir el lote, sin necesitar un campo de persistencia nuevo en la fila.
function _suDbLogGranoAuto(tanda, texto) {
    var nota = null;
    for (var i = 0; i < SU.dbSeguimientoNotas.length; i++) {
        var n = SU.dbSeguimientoNotas[i];
        if (n.auto === true && n.tipo === 'peso-grano-auto' && n.tanda === tanda) { nota = n; break; }
    }
    if (nota) {
        nota.texto = texto;
        nota.editedAt = new Date().toISOString();
    } else {
        SU.dbSeguimientoNotas.push({
            id: _suNotaId(),
            ts: new Date().toISOString(),
            tsLegacy: null,
            tsInferred: false,
            tipo: 'peso-grano-auto',
            texto: texto,
            estado: 'green',
            auto: true,
            editedAt: null,
            imagenes: [],
            tanda: tanda
        });
    }
    window.suDbRenderSeguimientoNotas();
}

// ---------- HANDLERS INLINE ----------
```

- [ ] **Step 2: `node --check`**

Run: `node --check su/su_app.js`
Expected: sin output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add su/su_app.js
git commit -m "feat(su): _suDbLogGranoAuto — nota auto que se actualiza in-place, nunca duplica (MEJ Bolsa inoculada parte 3)"
```

---

### Task 4: Handler de cálculo — wiring completo

**Files:**
- Modify: `su/su_app.js` — el input de Task 1 (agregar `onchange`); insertar el handler nuevo después de `suDbOnChangeBolsas`, línea ~3240

- [ ] **Step 1: Wirear el `onchange` en el input**

Modify `su/su_app.js`, reemplazar:

```javascript
        +       '<input type="number" class="db-peso-bolsa-inoculada" value="0" min="0" step="0.1" placeholder="—">'
```

por:

```javascript
        +       '<input type="number" class="db-peso-bolsa-inoculada" value="0" min="0" step="0.1" placeholder="—" onchange="suDbOnChangeBolsaInoculada(this)">'
```

- [ ] **Step 2: Agregar el handler**

Modify `su/su_app.js`, localizar el final de `suDbOnChangeBolsas`:

```javascript
    window.suDbActualizarResumen();
    if (typeof window.suRecomputeGrUsadosPush === 'function') window.suRecomputeGrUsadosPush();
};

// ---------- CÁLCULO DE RESUMEN + VALIDACIÓN ----------
```

Reemplazar por:

```javascript
    window.suDbActualizarResumen();
    if (typeof window.suRecomputeGrUsadosPush === 'function') window.suRecomputeGrUsadosPush();
};

// Calcula Grano = Bolsa inoculada - Sustrato real y lo escribe en .db-peso-grano-real de la
// misma fila. Unico disparador: el propio input "Bolsa inoculada" (ver spec, 2026-08-28) --
// editar Sustrato despues NO recalcula solo, para no pisar en silencio un Grano ya editado a
// mano por el operador. Bloquea con aviso si Sustrato sigue en 0/teorico -- restar contra el
// promedio del lote podria no corresponder a la bolsa puntual que se peso.
window.suDbOnChangeBolsaInoculada = function(inputEl) {
    var row = inputEl.closest('.db-row');
    if (!row) return;
    var tanda = (row.querySelector('.db-tanda') || {}).value || '';
    var msgEl = row.querySelector('.db-peso-bolsa-inoculada-msg');
    var prInp = row.querySelector('.db-peso-real');
    var pgInp = row.querySelector('.db-peso-grano-real');

    var pesoBolsaInoculada = parseFloat(inputEl.value) || 0;
    if (msgEl) { msgEl.style.display = 'none'; msgEl.textContent = ''; }
    if (pesoBolsaInoculada <= 0) return;

    var pesoReal = parseFloat(prInp && prInp.value) || 0;
    if (pesoReal <= 0) {
        if (msgEl) { msgEl.textContent = 'Cargá el peso real de Sustrato primero.'; msgEl.style.display = 'block'; }
        return;
    }

    var grano = pesoBolsaInoculada - pesoReal;
    if (pgInp) pgInp.value = grano.toFixed(1);

    if (tanda) {
        _suDbLogGranoAuto(tanda,
            tanda + ': Grano calculado automático: ' + grano.toFixed(1)
            + 'g (bolsa inoculada ' + pesoBolsaInoculada.toFixed(1) + 'g − sustrato real ' + pesoReal.toFixed(1) + 'g)');
    }
};

// ---------- CÁLCULO DE RESUMEN + VALIDACIÓN ----------
```

- [ ] **Step 3: `node --check`**

Run: `node --check su/su_app.js`
Expected: sin output, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add su/su_app.js
git commit -m "feat(su): handler suDbOnChangeBolsaInoculada — calculo + validacion + auto-log (MEJ Bolsa inoculada parte 4)"
```

---

### Task 5: Verificación end-to-end en Chrome real + cierre

**Files:** ninguno (solo verificación)

**Nota de seguridad:** ninguna función tocada en este plan (`suDbAddRow`, `suDbCollect`, `suDbLoadFromLote`, el handler nuevo) escribe a `localStorage['su_lotes']` — todo ocurre en memoria (`SU.dbSeguimientoNotas`, el DOM de la fila) hasta que una función de guardado de lote separada (no tocada acá) decide persistir. Aun así, usar un contexto de navegador aislado (Chrome DevTools MCP, `isolatedContext`) por disciplina — mismo criterio que el resto de esta sesión.

- [ ] **Step 1: Confirmar el server**

Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:8734`
Expected: `200`.

- [ ] **Step 2: Abrir la app y agregar una tanda nueva**

Vía Chrome DevTools MCP: abrir `http://localhost:8734/index.html#SU` en un contexto aislado. Evaluar:

```javascript
document.querySelector('.su-btn-add-tanda').click();
var row = document.querySelector('#dbTableBody .db-row');
row.querySelector('.db-tanda').value = 'SU-TEST-A';
JSON.stringify({ tandaId: row.querySelector('.db-tanda').value });
```

Expected: confirma que existe al menos una `.db-row` con tanda `SU-TEST-A`.

- [ ] **Step 3: Caso normal — Sustrato cargado, calcula Grano**

Evaluar:

```javascript
var row = document.querySelector('#dbTableBody .db-row');
row.querySelector('.db-peso-real').value = '480';
var bi = row.querySelector('.db-peso-bolsa-inoculada');
bi.value = '515';
bi.dispatchEvent(new Event('change', { bubbles: true }));
row.querySelector('.db-peso-grano-real').value;
```

Expected: `"35.0"` (515 − 480).

- [ ] **Step 4: Confirmar la nota auto-log (una sola, `editedAt: null`)**

Evaluar:

```javascript
SU.dbSeguimientoNotas.filter(function(n) { return n.tipo === 'peso-grano-auto'; })
  .map(function(n) { return { tanda: n.tanda, texto: n.texto, editedAt: n.editedAt, estado: n.estado }; });
```

Expected: array con exactamente 1 elemento — `tanda: "SU-TEST-A"`, `texto` conteniendo `"35.0g (bolsa inoculada 515.0g − sustrato real 480.0g)"`, `editedAt: null`, `estado: "green"`.

- [ ] **Step 5: Recalcular — confirma que ACTUALIZA la misma nota, no crea una segunda**

Evaluar:

```javascript
var row = document.querySelector('#dbTableBody .db-row');
var bi = row.querySelector('.db-peso-bolsa-inoculada');
bi.value = '520';
bi.dispatchEvent(new Event('change', { bubbles: true }));
var notas = SU.dbSeguimientoNotas.filter(function(n) { return n.tipo === 'peso-grano-auto'; });
JSON.stringify({
  cantidad: notas.length,
  granoInput: row.querySelector('.db-peso-grano-real').value,
  editedAtNoNull: notas[0].editedAt !== null,
  texto: notas[0].texto
});
```

Expected: `cantidad: 1` (sigue siendo UNA sola nota, no dos), `granoInput: "40.0"` (520−480), `editedAtNoNull: true`, `texto` con `"40.0g"`.

- [ ] **Step 6: Editar Sustrato después NO recalcula solo**

Evaluar:

```javascript
var row = document.querySelector('#dbTableBody .db-row');
row.querySelector('.db-peso-real').value = '490'; // cambio sin disparar el input de bolsa inoculada
row.querySelector('.db-peso-grano-real').value;
```

Expected: sigue en `"40.0"` (sin cambios) — confirma que editar Sustrato solo no recalcula Grano.

- [ ] **Step 7: Caso bloqueado — sin Sustrato real cargado**

Evaluar:

```javascript
document.querySelector('.su-btn-add-tanda').click();
var rows = document.querySelectorAll('#dbTableBody .db-row');
var row2 = rows[rows.length - 1];
row2.querySelector('.db-tanda').value = 'SU-TEST-B';
var bi2 = row2.querySelector('.db-peso-bolsa-inoculada');
bi2.value = '300';
bi2.dispatchEvent(new Event('change', { bubbles: true }));
var msgEl = row2.querySelector('.db-peso-bolsa-inoculada-msg');
JSON.stringify({
  granoInput: row2.querySelector('.db-peso-grano-real').value,
  msgVisible: msgEl.style.display === 'block',
  msgTexto: msgEl.textContent,
  notasPesoGranoAuto: SU.dbSeguimientoNotas.filter(function(n) { return n.tipo === 'peso-grano-auto'; }).length
});
```

Expected: `granoInput: "0"` (sin tocar), `msgVisible: true`, `msgTexto: "Cargá el peso real de Sustrato primero."`, `notasPesoGranoAuto: 1` (sigue siendo solo la de `SU-TEST-A` — el caso bloqueado NO genera nota).

- [ ] **Step 8: Persistencia — round-trip collect → load**

Evaluar:

```javascript
var collected = suDbCollect();
var rowA = collected.find(function(r) { return r.tanda === 'SU-TEST-A'; });
var antes = { pesoReal: rowA.pesoReal, pesoGranoReal: rowA.pesoGranoReal, pesoBolsaInoculada: rowA.pesoBolsaInoculada };

suDbLoadFromLote({ db: collected });

var rowsDespues = document.querySelectorAll('#dbTableBody .db-row');
var rowADespues = Array.prototype.find.call(rowsDespues, function(r) { return r.querySelector('.db-tanda').value === 'SU-TEST-A'; });
JSON.stringify({
  antes: antes,
  despuesBolsaInoculada: rowADespues.querySelector('.db-peso-bolsa-inoculada').value,
  despuesGrano: rowADespues.querySelector('.db-peso-grano-real').value,
  despuesSustrato: rowADespues.querySelector('.db-peso-real').value
});
```

Expected: `antes.pesoBolsaInoculada === 520`, y después del round-trip `despuesBolsaInoculada: "520"`, `despuesGrano: "40"`, `despuesSustrato: "490"` — los 3 valores sobreviven un ciclo completo de guardar/cargar.

- [ ] **Step 9: Confirmar que `su_lotes` real nunca se tocó**

Evaluar:

```javascript
localStorage.getItem('su_lotes');
```

Expected: `null` (o el mismo valor que tenía antes de empezar, si este navegador aislado ya tenía datos previos de otra verificación — el punto es que esta secuencia de pasos no le escribió nada nuevo).

- [ ] **Step 10: Confirmar sin errores de consola**

Revisar los mensajes de consola de la página (`mcp__chrome-devtools__list_console_messages`) — Expected: sin entradas `error` nuevas atribuibles a este flujo.

- [ ] **Step 11: Cerrar la página aislada**

No hace falta limpieza de `localStorage` (nunca se escribió nada ahí en esta verificación) — simplemente cerrar la pestaña/contexto aislado.

- [ ] **Step 12: Si algo no coincide con lo esperado**

Si algún paso no da el resultado esperado, puede ser un bug real en las Tasks 1-4 (posible, la verificación end-to-end atrapa cosas que la revisión estática no). Investigar la causa, aplicar un fix mínimo y localizado en `su/su_app.js`, volver a correr el paso que falló para confirmar, `node --check su/su_app.js`, commitear el fix por separado con un mensaje que describa el bug real encontrado — mismo criterio que Task 4 del plan de FR (`docs/superpowers/plans/2026-08-28-fr-sync-deshidratado.md`).

---

## Self-review de este plan

- **Cobertura del spec:** Ubicación/UI → Task 1. Cálculo (bloqueo, disparador único, escritura en Grano) → Task 4. Persistencia → Task 2. Auto-log busca-y-actualiza → Task 3. "Fuera de alcance" del spec (sin recálculo retroactivo al editar Sustrato, sin indicador visual de origen del dato, `db-peso-real`/`db-peso-grano-real` sin `onchange` propio nuevo) no tiene tarea — correcto, exclusiones deliberadas. Testing → Task 5 cubre los 3 escenarios del spec: caso normal, caso bloqueado, no-recálculo-retroactivo, más persistencia y no-duplicación de nota.
- **Consistencia de tipos:** `pesoBolsaInoculada` es `number > 0` o `null` en el objeto persistido (`suDbCollect`/`suDbLoadFromLote`, Task 2), y `parseFloat(...) || 0` al leerlo de vuelta del DOM (Task 4) — mismo patrón que `pesoReal`/`pesoGranoReal` ya usan, sin inconsistencia. `_suDbLogGranoAuto(tanda, texto)` recibe `tanda` como string (mismo tipo que `row.querySelector('.db-tanda').value`) en el único call site (Task 4) — coincide con el campo `tanda` que la propia función guarda en la nota (Task 3).
- **Sin placeholders:** cada step tiene el código completo a pegar o el comando/script exacto a correr, ningún "TODO"/"agregar validación apropiada".
