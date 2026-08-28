# FR — 🥵 Sync deshidratado Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repartir un peso deshidratado total (de varias bolsas secadas juntas en el mismo horno) entre las bolsas de origen, proporcional al peso húmedo de cada una, con confirmación previa — más un chip visual "PENDIENTE" en las tablas de Cosecha/Archivo para que un flush con húmedo cargado y seco sin completar deje de pasar desapercibido.

**Architecture:** Dos funciones puras nuevas en `fr/fr_app.js` (`_frIdxFlushPendienteSecar`, `_frSyncDeshReparto`) reusadas tanto por el chip de tabla como por el modal nuevo. El modal (`FR.abrirModalSyncDeshidratado`/`FR.aplicarSyncDeshidratado`) reusa **sin reimplementar** el mismo camino de cálculo/guardado que ya usa la carga manual bolsa-por-bolsa (`recomputeFlushes`, `computeEstado`, `addObsTo`, `saveBolsas`) — la única diferencia real es que corre ese mismo camino en un loop sobre N bolsas con un solo `saveBolsas()` final.

**Tech Stack:** JavaScript vanilla (IIFE, sin build step, sin framework de test). Verificación vía `node --check` + scripts Node ad-hoc en el directorio scratchpad de la sesión para las 2 funciones puras (no hay test runner en el repo) + verificación funcional en Chrome real al final, contra datos **sintéticos** inyectados en el navegador — nunca contra las bolsas reales del usuario (ver Task 4).

---

## Contexto que el ingeniero necesita

- Spec completo: `docs/superpowers/specs/2026-08-28-fr-sync-deshidratado-design.md` — leerlo antes de empezar, tiene el razonamiento completo (por qué reparto proporcional al húmedo, por qué se excluyen bolsas con ciclo cerrado, por qué no hay edición fila-por-fila del reparto propuesto).
- El archivo principal a modificar es `fr/fr_app.js` — una sola IIFE gigante (no hay módulos ES6, no hay build). Las funciones nuevas son funciones de módulo normales (`function nombre() {...}`) salvo las que se exponen a `window.FR` para ser llamadas desde `onclick`/`onchange` inline en el HTML (Regla del proyecto: toda función usada por un handler inline debe estar en `Object.assign(window, {...})` — en este archivo eso ya se resuelve asignando directo a `FR.nombreFn = function(...)`, que es el mismo patrón que ya usan `FR.editFlush`/`FR.aplicarSync`/`FR.guardarHuerfana`).
- El segundo archivo es `fr/fr_index.html` — HTML estático, sin build. Los modales existentes (`frModalHuerfana`, `frSyncModal`) son el patrón de referencia: `display:none` por defecto, `position:fixed;inset:0` con overlay, toggle vía `element.style.display`.
- No hay test runner instalado (no hay `package.json` en el repo). Las 2 funciones puras de este plan se testean con scripts Node sueltos (usar `assert` nativo, cero dependencias) guardados en el directorio scratchpad de la sesión, NO en el repo — mismo patrón ya usado en `docs/superpowers/plans/2026-08-26-fr-cal-estabilidad-temporal.md` Task 1.
- Funciones/variables ya existentes que este plan reusa tal cual (confirmado leyendo el código real, no asumido):
  - `var bolsas = []` (`fr_app.js:41`) — array de módulo, todas las funciones nuevas lo leen/mutan directo, sin pasarlo como parámetro.
  - `esArchivada(b)` (`fr_app.js:295`) — `true` si `cancelada===true || contaminada===true || cicloCerrado===true`. Es exactamente "no activa" en el vocabulario ya usado por el resto del módulo.
  - `recomputeFlushes(b)` (`fr_app.js:354`) — recalcula `beOleada`/`beAcumulado`/`pctBiomasa`/`tiempoDeshidratacion` de todos los flushes de una bolsa a partir de `pesoHumedo`/`pesoSeco`/`fecha`/`finDeshidratacion`. No reimplementar este cálculo.
  - `computeEstado(b)` (`fr_app.js:272`) — deriva el estado de la bolsa.
  - `addObsTo(b, texto, tipo, estado)` (`fr_app.js:429`) — agrega una nota al array `b.observaciones` con el shape unificado (`id`/`ts`/`texto`/`estado`/`auto`/etc.).
  - `saveBolsas()` (`fr_app.js:241`) — persiste el array `bolsas` COMPLETO en `localStorage[FR_KEY]` de una sola vez (ya incluye manejo de error vía `BioLog`). Por eso no hace falta lógica de transacción aparte: todas las mutaciones en memoria + un solo `saveBolsas()` al final ya es atómico a nivel del blob guardado.
  - `renderAll()` (`fr_app.js:2801`) — re-renderiza Activos/Cosecha/Archivo/Dashboard tras cualquier cambio de `bolsas`.
  - `_frToast(msg, tipo)` (`fr_app.js:414`) — feedback no bloqueante (`tipo: 'ok'|'warn'`). Convención confirmada leyendo `FR.aplicarSync`/`FR.guardarHuerfana`/`FR.saveCalidad`: un modal que se confirma con éxito cierra y re-renderiza SIN `alert()` — `alert()` en este módulo se reserva para bloquear ANTES de aplicar el cambio (ej. campo obligatorio faltante), nunca para confirmar éxito. Este plan sigue esa misma convención.
  - `ahoraISOLocal()` (`fr_app.js:139`) — devuelve `YYYY-MM-DDTHH:mm` en hora local, formato exacto que espera un `<input type="datetime-local">`.
  - `fmt(n, dec)`, `esc(s)`, `fmtFecha(iso)`, `fmtFechaHora(iso)`, `num(v)`, `setInput(id, val)`, `beOleada(pesoHumedo, pesoSustratoSeco)` — helpers de formato/parseo ya existentes, usar tal cual.
  - `.fr-chip-pendiente` (`fr/fr_styles.css:1170`) — clase CSS ya existente (fondo/borde dorado), ya usada para el chip "⏳ pendiente" de la pestaña Pendientes (`fr_app.js:2856`). Reusar tal cual, no crear CSS nueva.
  - `.data-table`/`.table-wrap`/`.form-row`/`.form-group`/`.fr-dash-input`/`.btn.btn-fr`/`.btn.btn-secondary`/`.fr-dash-subtle`/`.fr-empty` — clases CSS ya existentes en `fr_styles.css`, usadas por el resto del módulo. No crear CSS nueva para este modal.
- Antes de cada commit: `node --check fr/fr_app.js` (sintaxis) como mínimo.
- **Nunca usar `b.id` como identidad estable entre funciones de este plan — usar `b._frUuid`.** `id` puede renombrarse (`_frRenombrarId`); `_frUuid` es el identificador permanente, mismo criterio ya documentado en `CLAUDE.md`/usado por el checkpoint de `biolab-analyst`.

---

### Task 1: `_frIdxFlushPendienteSecar` — función pura, TDD en aislamiento + chip visual

**Files:**
- Test (temporal, no se commitea): `<scratchpad>/test_fr_idx_pendiente.js`
- Modify: `fr/fr_app.js` — agregar la función cerca de `tiempoDeshidFlush` (línea ~340), y usarla en `filaTabla` (líneas 1200-1203)

- [ ] **Step 1: Escribir el test que falla**

Crear `<scratchpad>/test_fr_idx_pendiente.js`:

```javascript
const assert = require('assert');

let _frIdxFlushPendienteSecar;
try { ({ _frIdxFlushPendienteSecar } = require('./fr_idx_pendiente_impl.js')); }
catch (e) { console.error('Todavia no existe fr_idx_pendiente_impl.js — se espera que falle.'); process.exit(1); }

// Caso 1: bolsa sin flushes -> -1.
assert.strictEqual(_frIdxFlushPendienteSecar({ flushes: [] }), -1, 'sin flushes');
assert.strictEqual(_frIdxFlushPendienteSecar({}), -1, 'sin campo flushes');
assert.strictEqual(_frIdxFlushPendienteSecar(null), -1, 'bolsa null');

// Caso 2: un flush con humedo y seco ya cargado -> -1 (no pendiente).
assert.strictEqual(_frIdxFlushPendienteSecar({ flushes: [{ pesoHumedo: 500, pesoSeco: 40 }] }), -1, 'ya secado');

// Caso 3: un flush con humedo cargado, seco null -> 0 (pendiente).
assert.strictEqual(_frIdxFlushPendienteSecar({ flushes: [{ pesoHumedo: 909, pesoSeco: null }] }), 0, 'pendiente simple');

// Caso 4: dos flushes, F1 ya secado, F2 pendiente -> 1 (el ultimo pendiente).
assert.strictEqual(
    _frIdxFlushPendienteSecar({ flushes: [{ pesoHumedo: 500, pesoSeco: 40 }, { pesoHumedo: 300, pesoSeco: null }] }),
    1, 'F2 pendiente, F1 ya secado'
);

// Caso 5: flush sin pesoHumedo cargado todavia (recien creado, oninput no llego) -> no pendiente,
// no hay nada que repartir todavia.
assert.strictEqual(_frIdxFlushPendienteSecar({ flushes: [{ pesoHumedo: null, pesoSeco: null }] }), -1, 'flush vacio');

console.log('TODOS LOS CASOS OK');
```

- [ ] **Step 2: Correr el test para confirmar que falla**

Run: `node <scratchpad>/test_fr_idx_pendiente.js`
Expected: falla con el mensaje del catch — todavía no existe la implementación.

- [ ] **Step 3: Escribir la implementación mínima**

Crear `<scratchpad>/fr_idx_pendiente_impl.js`:

```javascript
function _frIdxFlushPendienteSecar(b) {
    if (!b || !Array.isArray(b.flushes)) return -1;
    for (var i = b.flushes.length - 1; i >= 0; i--) {
        var f = b.flushes[i];
        if (f && f.pesoHumedo != null && f.pesoSeco == null) return i;
    }
    return -1;
}

module.exports = { _frIdxFlushPendienteSecar: _frIdxFlushPendienteSecar };
```

- [ ] **Step 4: Correr el test para confirmar que pasa**

Run: `node <scratchpad>/test_fr_idx_pendiente.js`
Expected: `TODOS LOS CASOS OK`, exit code 0.

- [ ] **Step 5: Pegar la función verificada en `fr_app.js`**

Modify `fr/fr_app.js` — insertar inmediatamente después de `tiempoDeshidFlush` (después de la línea 339 `return horasEntre(f.fecha, f.finDeshidratacion); }`):

```javascript
    function tiempoDeshidFlush(f) {
        if (!f || !f.fecha || !f.finDeshidratacion) return null;
        return horasEntre(f.fecha, f.finDeshidratacion);
    }
    // Indice del ultimo flush con humedo cargado y seco todavia sin completar (o -1
    // si no hay ninguno). Usado tanto por el chip "PENDIENTE" de la tabla de Cosecha/Archivo
    // como por el picker de "Sync deshidratado" (ver docs/superpowers/specs/2026-08-28-fr-sync-deshidratado-design.md).
    function _frIdxFlushPendienteSecar(b) {
        if (!b || !Array.isArray(b.flushes)) return -1;
        for (var i = b.flushes.length - 1; i >= 0; i--) {
            var f = b.flushes[i];
            if (f && f.pesoHumedo != null && f.pesoSeco == null) return i;
        }
        return -1;
    }
```

- [ ] **Step 6: Usar la función en `filaTabla` — chip "PENDIENTE" en vez de "-"**

Modify `fr/fr_app.js:1200-1203`, reemplazar:

```javascript
        var rendSeco    = biomasaSecaTotal(b.flushes);
        var pctDeshid   = (rend > 0 && rendSeco > 0) ? (rendSeco / rend) * 100 : null;
        var rendSecoTxt = rendSeco > 0 ? fmt(rendSeco, 1) + ' g' : '-';
        var pctDeshidTxt = pctDeshid != null ? fmt(pctDeshid, 1) + '%' : '-';
```

por:

```javascript
        var rendSeco    = biomasaSecaTotal(b.flushes);
        var pctDeshid   = (rend > 0 && rendSeco > 0) ? (rendSeco / rend) * 100 : null;
        var _pendChip   = '<span class="fr-chip fr-chip-pendiente">PENDIENTE</span>';
        var _esPend     = _frIdxFlushPendienteSecar(b) !== -1;
        var rendSecoTxt = rendSeco > 0 ? fmt(rendSeco, 1) + ' g' : (_esPend ? _pendChip : '-');
        var pctDeshidTxt = pctDeshid != null ? fmt(pctDeshid, 1) + '%' : (_esPend ? _pendChip : '-');
```

Esto afecta las columnas "Rend. Seco"/"% Deshid." en las tablas de Cosecha y Archivo (las únicas dos que usan `rendSecoTxt`/`pctDeshidTxt`, líneas 1254-1259) — se muestra en ambas pestañas sin distinción, aunque el modal del Task 3 solo ofrezca reparto para bolsas activas (una bolsa archivada con seco pendiente igual merece el chip informativo, solo que no aparece en el picker).

- [ ] **Step 7: `node --check`**

Run: `node --check fr/fr_app.js`
Expected: sin output, exit code 0.

- [ ] **Step 8: Commit**

```bash
git add fr/fr_app.js
git commit -m "feat(fr): chip PENDIENTE en Cosecha/Archivo para flushes con humedo sin secar (MEJ-0052 parte 1)"
```

---

> **Nota post-implementación (superada por code review, ver commits `bc81fa4`/`cebd0a9`):** el código de este Task 2 quedó desactualizado — el resto de redondeo se asigna al item de MAYOR `pesoHumedo`, no al último del array (`bc81fa4`, corrige `pesoSeco` negativo posible en tandas de 4+ bolsas). La verdad actual es `fr/fr_app.js` — no copiar el código de acá.

### Task 2: `_frSyncDeshReparto` — función pura de reparto, TDD en aislamiento

**Files:**
- Test (temporal, no se commitea): `<scratchpad>/test_fr_sync_desh_reparto.js`
- Modify: `fr/fr_app.js` — agregar la función inmediatamente después de `_frIdxFlushPendienteSecar` (agregada en Task 1)

- [ ] **Step 1: Escribir el test que falla**

Crear `<scratchpad>/test_fr_sync_desh_reparto.js`:

```javascript
const assert = require('assert');

let _frSyncDeshReparto;
try { ({ _frSyncDeshReparto } = require('./fr_sync_desh_reparto_impl.js')); }
catch (e) { console.error('Todavia no existe fr_sync_desh_reparto_impl.js — se espera que falle.'); process.exit(1); }

function sum(arr) { return Math.round(arr.reduce(function(s, r) { return s + r.pesoSeco; }, 0) * 100) / 100; }

// Caso 1: caso real que origino este feature — FR2207 (945g) + FR1707b (909g), total 109g.
// Verificado a mano: 945/1854*109=55.559..→55.6 ; 909/1854*109=53.441..→53.4 ; suma ya da 109.0 exacto.
(function testCasoReal() {
    var items = [{ id: 'FR2207', pesoHumedo: 945 }, { id: 'FR1707b', pesoHumedo: 909 }];
    var r = _frSyncDeshReparto(items, 109);
    var byId = {}; r.forEach(function(x) { byId[x.id] = x.pesoSeco; });
    assert.strictEqual(byId.FR2207, 55.6, 'FR2207 esperado 55.6, dio ' + byId.FR2207);
    assert.strictEqual(byId.FR1707b, 53.4, 'FR1707b esperado 53.4, dio ' + byId.FR1707b);
    assert.strictEqual(sum(r), 109, 'la suma debe dar exacto el total');
    console.log('OK: caso real FR2207/FR1707b');
})();

// Caso 2: 3 items de igual peso humedo -- el redondeo naive NO suma el total (33.3*3=99.9),
// el ultimo item debe absorber el resto para llegar a 100.0 exacto.
(function testRedondeoConResto() {
    var items = [{ id: 'A', pesoHumedo: 100 }, { id: 'B', pesoHumedo: 100 }, { id: 'C', pesoHumedo: 100 }];
    var r = _frSyncDeshReparto(items, 100);
    assert.strictEqual(r[0].pesoSeco, 33.3);
    assert.strictEqual(r[1].pesoSeco, 33.3);
    assert.strictEqual(r[2].pesoSeco, 33.4, 'el ultimo absorbe el resto de redondeo, dio ' + r[2].pesoSeco);
    assert.strictEqual(sum(r), 100, 'la suma debe dar exacto 100');
    console.log('OK: caso redondeo con resto (3 items iguales)');
})();

// Caso 3: pesos humedos muy distintos -- el reparto debe ser proporcional, no igualitario.
(function testProporcionalNoIgualitario() {
    var items = [{ id: 'Grande', pesoHumedo: 900 }, { id: 'Chica', pesoHumedo: 100 }];
    var r = _frSyncDeshReparto(items, 100);
    var byId = {}; r.forEach(function(x) { byId[x.id] = x.pesoSeco; });
    assert.ok(byId.Grande > 85, 'la bolsa de 900g humedo debe llevarse la gran mayoria del seco, dio ' + byId.Grande);
    assert.ok(byId.Chica < 15, 'la bolsa de 100g humedo debe llevarse poco, dio ' + byId.Chica);
    assert.strictEqual(sum(r), 100);
    console.log('OK: caso proporcional (pesos muy distintos)');
})();

// Caso 4: un solo item -- se lleva el total entero (el modal en la practica exige >=2,
// pero la funcion pura no debe asumir eso).
(function testUnSoloItem() {
    var r = _frSyncDeshReparto([{ id: 'Unica', pesoHumedo: 500 }], 40);
    assert.strictEqual(r[0].pesoSeco, 40);
    console.log('OK: caso un solo item');
})();

console.log('TODOS LOS CASOS OK');
```

- [ ] **Step 2: Correr el test para confirmar que falla**

Run: `node <scratchpad>/test_fr_sync_desh_reparto.js`
Expected: falla con el mensaje del catch.

- [ ] **Step 3: Escribir la implementación mínima**

Crear `<scratchpad>/fr_sync_desh_reparto_impl.js`:

```javascript
function _frSyncDeshReparto(items, total) {
    var totalHumedo = items.reduce(function(s, it) { return s + it.pesoHumedo; }, 0);
    if (totalHumedo <= 0) return items.map(function(it) { return { id: it.id, pesoSeco: 0 }; });

    var out = items.map(function(it) {
        var crudo = total * (it.pesoHumedo / totalHumedo);
        return { id: it.id, pesoSeco: Math.round(crudo * 10) / 10 };
    });

    // Ajuste de redondeo: el ULTIMO item de la lista absorbe la diferencia entre el
    // total pedido y la suma de los redondeados, para que la suma final calce exacto.
    var sumaRedondeada = out.reduce(function(s, o) { return s + o.pesoSeco; }, 0);
    var diff = Math.round((total - sumaRedondeada) * 100) / 100;
    var ultimo = out[out.length - 1];
    ultimo.pesoSeco = Math.round((ultimo.pesoSeco + diff) * 10) / 10;

    return out;
}

module.exports = { _frSyncDeshReparto: _frSyncDeshReparto };
```

- [ ] **Step 4: Correr el test para confirmar que pasa**

Run: `node <scratchpad>/test_fr_sync_desh_reparto.js`
Expected: las 4 líneas `OK: ...` y `TODOS LOS CASOS OK`, exit code 0.

- [ ] **Step 5: Pegar la función verificada en `fr_app.js`**

Modify `fr/fr_app.js` — insertar inmediatamente después del cierre de `_frIdxFlushPendienteSecar` (agregada en el Task 1, Step 5):

```javascript
    // Reparto proporcional al peso humedo entre N bolsas secadas juntas en la misma
    // tanda de horno. El ULTIMO item de `items` absorbe el resto de redondeo para que
    // la suma de pesoSeco calce exacto con `total` (nunca queda offset por decimas).
    // Ver docs/superpowers/specs/2026-08-28-fr-sync-deshidratado-design.md.
    function _frSyncDeshReparto(items, total) {
        var totalHumedo = items.reduce(function(s, it) { return s + it.pesoHumedo; }, 0);
        if (totalHumedo <= 0) return items.map(function(it) { return { id: it.id, pesoSeco: 0 }; });

        var out = items.map(function(it) {
            var crudo = total * (it.pesoHumedo / totalHumedo);
            return { id: it.id, pesoSeco: Math.round(crudo * 10) / 10 };
        });

        var sumaRedondeada = out.reduce(function(s, o) { return s + o.pesoSeco; }, 0);
        var diff = Math.round((total - sumaRedondeada) * 100) / 100;
        var ultimo = out[out.length - 1];
        ultimo.pesoSeco = Math.round((ultimo.pesoSeco + diff) * 10) / 10;

        return out;
    }
```

- [ ] **Step 6: `node --check`**

Run: `node --check fr/fr_app.js`
Expected: sin output, exit code 0.

- [ ] **Step 7: Commit**

```bash
git add fr/fr_app.js
git commit -m "feat(fr): agrega _frSyncDeshReparto, calculo puro de reparto proporcional (MEJ-0052 parte 2)"
```

---

> **Nota post-implementación (superada por code review, ver commits `cebd0a9` y el fix del review holístico final):** el `FR.aplicarSyncDeshidratado` de este Task 3 quedó desactualizado en dos rondas — primero se agregó el chequeo de `esArchivada`, después se colapsó a un único paso de validación (la "re-verificación" de dos pasadas de acá nunca podía detectar nada, porque la primera pasada ya excluía todo lo que la segunda buscaba). La verdad actual es `fr/fr_app.js` — no copiar el código de acá.

### Task 3: UI completa — botón, modal, picker, preview en vivo, confirmar

**Files:**
- Modify: `fr/fr_index.html` — botón nuevo en la toolbar (línea ~32-39) + modal nuevo (después del cierre de `frModalHuerfana`, línea ~649-650)
- Modify: `fr/fr_app.js` — funciones nuevas: `_frBolsasPendientesSecar`, `FR.abrirModalSyncDeshidratado`, `FR.cerrarModalSyncDeshidratado`, `FR._syncDeshOnChange`, `FR.aplicarSyncDeshidratado`

- [ ] **Step 1: Botón nuevo en la toolbar**

Modify `fr/fr_index.html:32-33`, insertar después de la línea del botón "🔄 Sync desde SU":

```html
                    <button type="button" class="btn btn-secondary" onclick="FR.sync()" title="Importar bolsas nuevas desde SU">🔄 Sync desde SU</button>
                    <button type="button" class="btn btn-secondary" onclick="FR.abrirModalSyncDeshidratado()" title="Repartir un peso deshidratado total entre varias bolsas secadas juntas">🥵 Sync deshidratado</button>
                    <button type="button" class="btn btn-secondary" onclick="FR.abrirModalHuerfana()" title="Cargar bolsa sin trazabilidad SU→GR">➕ Bolsa huérfana</button>
```

- [ ] **Step 2: Modal nuevo en el HTML**

Modify `fr/fr_index.html`, insertar inmediatamente después del cierre de `frModalHuerfana` (después de la línea 649 `</div>` que cierra ese modal, antes de la línea 650 en blanco / lo que siga):

```html
    <div id="frModalSyncDesh" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:999;align-items:center;justify-content:center">
        <div style="background:var(--dark-2,#1e1e2e);border-radius:12px;padding:28px 24px;width:560px;max-width:96vw;max-height:92vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.5)">
            <h3 style="margin:0 0 8px;font-size:1.1rem;">🥵 Sync deshidratado</h3>
            <p style="font-size:0.85rem;color:var(--text-muted,#888);margin:0 0 16px;">Repartí un peso deshidratado total entre las bolsas que secaste juntas en la misma tanda de horno. Solo bolsas activas con al menos una oleada cosechada y sin peso seco cargado.</p>

            <div class="table-wrap" style="max-height:220px;overflow-y:auto">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th style="width:28px"></th>
                            <th>ID</th>
                            <th>Húmedo</th>
                            <th>Fecha oleada</th>
                        </tr>
                    </thead>
                    <tbody id="frSyncDeshPickerBody"></tbody>
                </table>
            </div>

            <div class="form-row" style="margin-top:14px">
                <div class="form-group">
                    <label for="frSyncDeshTotal">Peso deshidratado total (g) *</label>
                    <input type="number" id="frSyncDeshTotal" class="fr-dash-input" step="0.1" min="0" oninput="FR._syncDeshOnChange()">
                </div>
                <div class="form-group">
                    <label for="frSyncDeshFin">Fin de deshidratación</label>
                    <input type="datetime-local" id="frSyncDeshFin" class="fr-dash-input">
                </div>
            </div>

            <p id="frSyncDeshMsg" style="color:#FF6B6B;font-size:0.82rem;min-height:1.2em;margin:8px 0 0"></p>

            <div id="frSyncDeshPreview" style="margin-top:10px"></div>

            <div style="display:flex;gap:10px;margin-top:20px">
                <button type="button" id="frSyncDeshBtnConfirm" class="btn btn-fr" disabled onclick="FR.aplicarSyncDeshidratado()">✅ Confirmar reparto</button>
                <button type="button" class="btn btn-secondary" onclick="FR.cerrarModalSyncDeshidratado()">Cancelar</button>
            </div>
        </div>
    </div>
```

- [ ] **Step 3: `_frBolsasPendientesSecar` — recolecta candidatas de todo el sistema**

Modify `fr/fr_app.js` — insertar inmediatamente después del cierre de `_frSyncDeshReparto` (agregada en Task 2):

```javascript
    // Bolsas ACTIVAS (no archivadas — decision del usuario en brainstorming del
    // 2026-08-28) con un flush pendiente de secar, ordenadas por fecha de esa oleada
    // (mas viejas primero, para que no se sigan perdiendo de vista).
    function _frBolsasPendientesSecar() {
        var out = [];
        bolsas.forEach(function(b) {
            if (esArchivada(b)) return;
            var idx = _frIdxFlushPendienteSecar(b);
            if (idx === -1) return;
            var f = b.flushes[idx];
            out.push({ b: b, idx: idx, pesoHumedo: f.pesoHumedo, fecha: f.fecha || b.fechaInicio || '' });
        });
        out.sort(function(a, c) { return (a.fecha || '').localeCompare(c.fecha || ''); });
        return out;
    }
```

- [ ] **Step 4: `FR.abrirModalSyncDeshidratado`/`FR.cerrarModalSyncDeshidratado`**

Modify `fr/fr_app.js` — insertar cerca de `FR.editFlush` (línea ~3464, antes de esa función):

```javascript
    FR.abrirModalSyncDeshidratado = function() {
        var pend = _frBolsasPendientesSecar();
        var body = document.getElementById('frSyncDeshPickerBody');
        if (!body) return;
        if (pend.length === 0) {
            body.innerHTML = '<tr><td colspan="4" class="fr-empty">No hay bolsas activas con húmedo cargado y seco pendiente.</td></tr>';
        } else {
            body.innerHTML = pend.map(function(p) {
                return '<tr>'
                    + '<td style="text-align:center"><input type="checkbox" class="fr-syncdesh-cb" data-fr-uuid="' + esc(p.b._frUuid) + '" onchange="FR._syncDeshOnChange()"></td>'
                    + '<td><strong>' + esc(p.b.id) + '</strong></td>'
                    + '<td class="fr-num">' + fmt(p.pesoHumedo, 1) + ' g</td>'
                    + '<td class="fr-num-days">' + esc(fmtFecha(p.fecha)) + '</td>'
                    + '</tr>';
            }).join('');
        }
        setInput('frSyncDeshTotal', '');
        var finEl = document.getElementById('frSyncDeshFin');
        if (finEl) finEl.value = ahoraISOLocal();
        var msgEl = document.getElementById('frSyncDeshMsg');
        if (msgEl) msgEl.textContent = '';
        var prevEl = document.getElementById('frSyncDeshPreview');
        if (prevEl) prevEl.innerHTML = '';
        var btn = document.getElementById('frSyncDeshBtnConfirm');
        if (btn) btn.disabled = true;
        var modal = document.getElementById('frModalSyncDesh');
        if (modal) modal.style.display = 'flex';
    };

    FR.cerrarModalSyncDeshidratado = function() {
        var modal = document.getElementById('frModalSyncDesh');
        if (modal) modal.style.display = 'none';
    };
```

- [ ] **Step 5: `FR._syncDeshOnChange` — preview en vivo + validación**

Modify `fr/fr_app.js` — insertar inmediatamente después de `FR.cerrarModalSyncDeshidratado` (agregada en el Step 4):

```javascript
    FR._syncDeshOnChange = function() {
        var previewEl = document.getElementById('frSyncDeshPreview');
        var msgEl = document.getElementById('frSyncDeshMsg');
        var btnConfirm = document.getElementById('frSyncDeshBtnConfirm');
        if (!previewEl || !msgEl || !btnConfirm) return;

        var cbs = document.querySelectorAll('.fr-syncdesh-cb:checked');
        var totalInput = num(document.getElementById('frSyncDeshTotal').value);

        var items = [];
        cbs.forEach(function(cb) {
            var b = bolsas.find(function(x) { return x._frUuid === cb.dataset.frUuid; });
            var idx = b ? _frIdxFlushPendienteSecar(b) : -1;
            if (b && idx !== -1) items.push({ id: b.id, uuid: b._frUuid, pesoHumedo: b.flushes[idx].pesoHumedo });
        });

        var totalHumedo = items.reduce(function(s, it) { return s + it.pesoHumedo; }, 0);
        var err = '';
        if (items.length < 2) err = 'Marcá al menos 2 bolsas.';
        else if (!(totalInput > 0)) err = 'Cargá el peso deshidratado total.';
        else if (totalInput >= totalHumedo) err = 'El total deshidratado (' + fmt(totalInput, 1) + 'g) no puede ser mayor o igual al húmedo combinado (' + fmt(totalHumedo, 1) + 'g).';

        if (err) {
            previewEl.innerHTML = '';
            msgEl.textContent = err;
            btnConfirm.disabled = true;
            return;
        }
        msgEl.textContent = '';

        var reparto = _frSyncDeshReparto(items, totalInput);
        var repartoMap = {};
        reparto.forEach(function(r) { repartoMap[r.id] = r.pesoSeco; });

        var filas = items.map(function(it) {
            var seco = repartoMap[it.id];
            var b = bolsas.find(function(x) { return x._frUuid === it.uuid; });
            var be = beOleada(it.pesoHumedo, b.pesoSustratoSeco);
            return '<tr><td>' + esc(it.id) + '</td><td class="fr-num">' + fmt(it.pesoHumedo, 1) + ' g</td>'
                + '<td class="fr-num">' + fmt(seco, 1) + ' g</td><td class="fr-num-pct">' + fmt(be, 1) + '%</td></tr>';
        }).join('');
        var sumaSeco = reparto.reduce(function(s, r) { return s + r.pesoSeco; }, 0);

        previewEl.innerHTML = '<table class="data-table"><thead><tr><th>ID</th><th>Húmedo</th><th>Seco propuesto</th><th>BE</th></tr></thead><tbody>'
            + filas + '</tbody></table>'
            + '<p class="fr-dash-subtle">Total repartido: ' + fmt(sumaSeco, 1) + ' g</p>';

        btnConfirm.disabled = false;
    };
```

- [ ] **Step 6: `FR.aplicarSyncDeshidratado` — escritura, reusando `recomputeFlushes`/`computeEstado`/`addObsTo`**

Modify `fr/fr_app.js` — insertar inmediatamente después de `FR._syncDeshOnChange` (agregada en el Step 5):

```javascript
    FR.aplicarSyncDeshidratado = function() {
        var cbs = document.querySelectorAll('.fr-syncdesh-cb:checked');
        var totalInput = num(document.getElementById('frSyncDeshTotal').value);
        var finVal = document.getElementById('frSyncDeshFin').value || ahoraISOLocal();

        var items = [];
        cbs.forEach(function(cb) {
            var b = bolsas.find(function(x) { return x._frUuid === cb.dataset.frUuid; });
            var idx = b ? _frIdxFlushPendienteSecar(b) : -1;
            if (b && idx !== -1) items.push({ id: b.id, uuid: b._frUuid, pesoHumedo: b.flushes[idx].pesoHumedo });
        });
        // Guard defensivo: el boton ya esta disabled si esto no se cumple
        // (ver FR._syncDeshOnChange), pero no confiar solo en el estado del DOM.
        var totalHumedo = items.reduce(function(s, it) { return s + it.pesoHumedo; }, 0);
        if (items.length < 2 || !(totalInput > 0) || totalInput >= totalHumedo) return;

        var reparto = _frSyncDeshReparto(items, totalInput);
        var repartoMap = {};
        reparto.forEach(function(r) { repartoMap[r.id] = r.pesoSeco; });

        // Re-verificar en el momento de confirmar (no solo al abrir el modal): si otra
        // via cargo el seco de alguna de estas bolsas mientras el modal seguia abierto,
        // esa bolsa se saltea en vez de sobreescribir un dato ya cargado.
        var aplicadas = [];
        var salteadas = [];
        items.forEach(function(it) {
            var b = bolsas.find(function(x) { return x._frUuid === it.uuid; });
            var idxActual = b ? _frIdxFlushPendienteSecar(b) : -1;
            if (!b || idxActual === -1) { salteadas.push(it.id); return; }
            aplicadas.push({ b: b, idx: idxActual, id: it.id });
        });
        if (aplicadas.length < 2) {
            _frToast('⚠ Alguna bolsa cambió de estado mientras el modal estaba abierto — cerrá y volvé a abrir.', 'warn');
            return;
        }

        var idsAplicadas = aplicadas.map(function(a) { return a.id; });
        aplicadas.forEach(function(item) {
            var b = item.b, f = b.flushes[item.idx];
            f.pesoSeco = repartoMap[item.id];
            f.finDeshidratacion = finVal;
            recomputeFlushes(b);
            var prevEstado = b.estado;
            b.estado = computeEstado(b);
            addObsTo(b, 'F' + f.n + ' - Peso seco registrado: ' + fmt(f.pesoSeco, 1) + ' g - BE ' + fmt(f.beOleada, 1) + '%', 'auto', 'green');
            addObsTo(b, 'F' + f.n + ' - Fin de deshidratacion: ' + fmtFechaHora(f.finDeshidratacion), 'auto', 'none');
            addObsTo(b, 'Peso seco repartido vía Sync deshidratado: ' + fmt(totalInput, 1) + 'g totales entre ' + aplicadas.length + ' bolsas (' + idsAplicadas.join(', ') + ')', 'auto', 'none');
            if (b.estado !== prevEstado) addObsTo(b, 'Estado: ' + prevEstado + ' -> ' + b.estado, 'auto', 'none');
        });

        saveBolsas();
        FR.cerrarModalSyncDeshidratado();
        renderAll();
        _frToast('✅ Reparto aplicado a ' + aplicadas.length + ' bolsa(s): ' + idsAplicadas.join(', ') + '.'
            + (salteadas.length ? ' Salteadas (ya no calificaban): ' + salteadas.join(', ') + '.' : ''), 'ok');
    };
```

- [ ] **Step 7: `node --check`**

Run: `node --check fr/fr_app.js`
Expected: sin output, exit code 0.

- [ ] **Step 8: Commit**

```bash
git add fr/fr_app.js fr/fr_index.html
git commit -m "feat(fr): modal Sync deshidratado — reparto proporcional entre bolsas secadas juntas (MEJ-0052 parte 3)"
```

---

### Task 4: Verificación end-to-end en Chrome real (datos sintéticos) + cerrar backlog

**Files:** ninguno (solo verificación) + `docs/lab-intelligence/mejoras_app.md` (actualización final, no trackeado en git)

**IMPORTANTE — nunca usar el backup real del usuario para esta verificación.** A diferencia de la verificación de `MEJ-0003` (que solo LEÍA datos, sin escribir), este flujo termina en un `saveBolsas()` real. Probar el flujo de "Confirmar" contra bolsas reales (`FR1707b`/`FR2207`/etc.) escribiría valores de prueba sobre datos de laboratorio reales del usuario. Esta tarea arranca desde `fr_bolsas` VACÍO o con bolsas 100% sintéticas creadas en el paso siguiente, nunca desde un backup real.

- [ ] **Step 1: Levantar el server local si no está corriendo**

Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:8734`
Expected: `200`. Si no, correr `serve.bat` o `start-server.bat` desde la raíz del repo.

- [ ] **Step 2: Abrir la app e inyectar 2 bolsas sintéticas vía consola**

Usar Chrome DevTools (MCP `mcp__chrome-devtools__*`): abrir `http://localhost:8734/index.html`, navegar al módulo FR, y ejecutar en consola (`mcp__chrome-devtools__evaluate_script`):

```javascript
(function() {
    var sinteticas = [
        {
            id: 'ZZTEST1', _frUuid: 'zztest-uuid-0001', ts: Date.now(),
            fechaEntradaFR: '2026-08-01', fechaInicio: '2026-08-01', origen: 'huerfana',
            suLoteId: null, grLoteId: null, grTandaId: null,
            genetica: 'Test', fenotipo: 'Test', geneticaFull: 'Test / Test',
            pesoSustratoSeco: 500, contaminada: false, cancelada: false, cicloCerrado: false,
            pendienteConfirmacion: false, fechaCosecha: '2026-08-20',
            flushes: [{ n: 1, fecha: '2026-08-20T10:00', finDeshidratacion: null, pesoHumedo: 800, pesoSeco: null, beOleada: 160, beAcumulado: 160 }],
            observaciones: [], estado: 'cosechado'
        },
        {
            id: 'ZZTEST2', _frUuid: 'zztest-uuid-0002', ts: Date.now(),
            fechaEntradaFR: '2026-08-02', fechaInicio: '2026-08-02', origen: 'huerfana',
            suLoteId: null, grLoteId: null, grTandaId: null,
            genetica: 'Test', fenotipo: 'Test', geneticaFull: 'Test / Test',
            pesoSustratoSeco: 500, contaminada: false, cancelada: false, cicloCerrado: false,
            pendienteConfirmacion: false, fechaCosecha: '2026-08-21',
            flushes: [{ n: 1, fecha: '2026-08-21T10:00', finDeshidratacion: null, pesoHumedo: 400, pesoSeco: null, beOleada: 80, beAcumulado: 80 }],
            observaciones: [], estado: 'cosechado'
        }
    ];
    var actuales = JSON.parse(localStorage.getItem('fr_bolsas') || '[]');
    localStorage.setItem('fr_bolsas', JSON.stringify(actuales.concat(sinteticas)));
    location.reload();
})();
```

Expected: la página recarga sin error de consola.

- [ ] **Step 3: Confirmar el chip "PENDIENTE" en la pestaña Cosecha**

Navegar a FR → pestaña 🟡 Cosecha. Buscar las filas `ZZTEST1`/`ZZTEST2`. Tomar snapshot de accesibilidad (`mcp__chrome-devtools__take_snapshot`).
Expected: ambas filas muestran el chip "PENDIENTE" (no "-") en las columnas "Rend. Seco" y "% Deshid.".

- [ ] **Step 4: Abrir el modal, seleccionar ambas, cargar el total, confirmar**

Click en "🥵 Sync deshidratado". Tildar los checkboxes de `ZZTEST1` y `ZZTEST2`. Cargar `frSyncDeshTotal = 60`. Confirmar que el preview muestra 2 filas con la suma exacta 60.0g (proporción esperada: 800/1200*60=40.0 para ZZTEST1, 400/1200*60=20.0 para ZZTEST2). Click "✅ Confirmar reparto".

Expected: el modal se cierra, aparece un toast de éxito mencionando ambos IDs, y en la tabla de Cosecha ambas filas ahora muestran valores numéricos reales (40.0g/20.0g aprox.) en vez del chip.

- [ ] **Step 5: Confirmar el dato escrito en localStorage**

Evaluar en consola:

```javascript
JSON.parse(localStorage.getItem('fr_bolsas')).filter(function(b) { return b.id === 'ZZTEST1' || b.id === 'ZZTEST2'; })
  .map(function(b) { return { id: b.id, pesoSeco: b.flushes[0].pesoSeco, finDeshidratacion: b.flushes[0].finDeshidratacion, notas: b.observaciones.length }; });
```

Expected: `ZZTEST1.pesoSeco === 40`, `ZZTEST2.pesoSeco === 20`, ambos con `finDeshidratacion` seteado, y `notas === 3` en cada bolsa (peso seco / fin de deshidratación / reparto batch — ninguna bolsa cambia de estado en este caso porque ya estaban `cosechado`, así que no hay 4ta nota de cambio de estado).

- [ ] **Step 6: Limpiar los datos sintéticos**

Evaluar en consola:

```javascript
var actuales = JSON.parse(localStorage.getItem('fr_bolsas') || '[]');
localStorage.setItem('fr_bolsas', JSON.stringify(actuales.filter(function(b) { return b.id !== 'ZZTEST1' && b.id !== 'ZZTEST2'; })));
location.reload();
```

Expected: `ZZTEST1`/`ZZTEST2` ya no aparecen en ninguna pestaña de FR.

- [ ] **Step 7: Actualizar `docs/lab-intelligence/mejoras_app.md`**

Localizar la entrada `MEJ-0052` y completar el campo `**Resuelto:**` (hoy dice `(vacío hasta que se confirme)`) con la fecha, el mecanismo (chip + modal de reparto proporcional, reusa `recomputeFlushes`/`computeEstado`/`addObsTo`/`saveBolsas`), y la aclaración de que sigue "abierta" hasta que el usuario lo confirme en vivo con un caso real propio (mismo criterio que el resto del archivo).

Este archivo está en `.gitignore` (`docs/lab-intelligence/`) — no hace falta commit, es edición directa.

---

## Self-review de este plan

- **Cobertura del spec:** Selector/picker → Task 3 Step 3-4. Datos de la tanda (total + fin) → Task 3 Step 2/4. Preview solo-lectura → Task 3 Step 5. Validaciones (mínimo 2, total < húmedo combinado) → Task 3 Step 5/6. Escritura reusando `recomputeFlushes`/`computeEstado`/`addObsTo`/un solo `saveBolsas` → Task 3 Step 6. Re-verificación al confirmar → Task 3 Step 6. Redondeo a 1 decimal con ajuste de resto en el último ítem → Task 2. Chip "PENDIENTE" en Cosecha/Archivo → Task 1. "Fuera de alcance" del spec (edición fila-por-fila del reparto propuesto) no tiene tarea — correcto, exclusión deliberada. Testing → Task 1 y 2 (TDD unitario de las funciones puras) + Task 4 (verificación real con datos sintéticos, nunca contra bolsas reales).
- **Consistencia de tipos:** `_frIdxFlushPendienteSecar(b)` devuelve `number` (índice o `-1`) en las 3 tareas que la usan (Task 1 chip, Task 3 picker, Task 3 escritura) — mismo tipo en las 3. `_frSyncDeshReparto(items, total)` recibe `items: [{id, pesoHumedo}]` y devuelve `[{id, pesoSeco}]` — mismo shape en Task 2 (tests) y Task 3 (`FR._syncDeshOnChange`/`FR.aplicarSyncDeshidratado`). Identidad de bolsa en el picker/escritura es siempre `_frUuid` (nunca `id`), consistente en las 3 funciones del Task 3.
- **Sin placeholders:** cada step tiene el código completo a pegar o el comando exacto a correr, ningún "TODO"/"similar a"/"agregar validación apropiada".
