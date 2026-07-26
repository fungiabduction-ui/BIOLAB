# Unificación de notas de seguimiento (CI/GR/SU/FR) — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unificar el shape de las notas de seguimiento de CI/GR/SU/FR (mismos campos: `id`, `ts` ISO, `tsLegacy`, `tsInferred`, `texto`, `estado`, `auto`, `tipo`, `editedAt`, `imagenes`) y nivelar las capacidades de UI (agregar/editar/borrar en los 4), manteniendo cada módulo escribiendo a su propia key de `localStorage`.

**Architecture:** Cada módulo recibe (a) una migración one-shot con flag propio que normaliza sus notas existentes al shape unificado sin perder ningún dato original (`tsLegacy` preserva el string crudo siempre que no se pueda reconstruir un ISO con certeza), (b) sus funciones de escritura actualizadas para producir el shape nuevo desde ahora, (c) direccionamiento de edición/borrado por `id` estable en vez de índice de array (ya validado en el proyecto — CILAB Conocimiento lo usa así desde su creación). No hay cambios de storage cross-módulo ni una key centralizada.

**Tech Stack:** JS vanilla (sin build, sin framework), `localStorage`. Verificación: Node.js (scripts standalone en el scratchpad, sin dependencias del proyecto) + Playwright (`playwright-core` contra Chrome del sistema) para la verificación final en navegador real.

**Spec de referencia:** `docs/superpowers/specs/2026-07-26-unificacion-notas-seguimiento-design.md` (leer antes de empezar — tiene la evidencia empírica completa contra datos reales de producción que justifica cada decisión de este plan).

**Convención de `id` en los 4 módulos:** `'nt_' + <prefijo-2-letras-modulo> + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6)` — ej. `nt_ci_...`, `nt_gr_...`, `nt_su_...`, `nt_fr_...`. Único dentro del array de notas de esa fórmula/lote/bolsa, no hace falta que sea globalmente único.

**IMPORTANTE — antes de tocar cualquier archivo real:** pedile al usuario un backup fresco (`⬇ Exportar todo` en CFG) si el más reciente en la raíz del repo (`biolab_full_backup - *.json`) tiene más de un día, y **nunca ejecutes las migraciones contra el `localStorage` real del navegador del usuario sin haberlas validado primero con un script Node contra una copia de ese backup** (Regla 8 del proyecto: backup antes de cambios de estructura de storage).

---

## Estructura de archivos

- Modificar: `fr/fr_app.js` — `addObsTo`, `renderObs`, nuevas `FR.deleteObs`/`FR.startEditObs`/`FR.saveEditObs`/`FR.cancelEditObs`, nueva `_frNotaId`, nueva `_frMigrarNotasUnificadasV1`, hook en `FR.init`.
- Modificar: `fr/fr_styles.css` — `.fr-log-row` pasa de 3 a 4 columnas de grid, nuevas reglas `.fr-log-actions`/`.fr-log-btn-edit`/`.fr-log-btn-del`.
- Modificar: `su/su_app.js` — elimina `SU.reNotas`/`suReTimestamp`/`suReRenderNotas`/`suAddReNota` (código muerto), `suDbRegistrarSeguimiento`, `suDbAddSeguimientoNota`, `suDbRenderSeguimientoNotas`, `suDbEliminarSeguimientoNota`, nuevas `suDbEditarSeguimientoNota`/`suDbGuardarEdicionSeguimientoNota`/`suDbCancelarEdicionSeguimientoNota`, nueva `_suNotaId`, nueva `suDbFmtTs`, nueva `_suMigrarNotasUnificadasV1`, hook en `SU.init`.
- Modificar: `ci/ci_app.js` — `segAddNotaCard`, `segEmitirNotaAuto`, `segEditarNota`, `segGuardarEdicionNota`, `segEliminarSeguimientoNota`, `segVerImagenNota`, `segEliminarImagenNota`, `_segRenderNotaTimeline`, `segRenderSeguimientoNotas`, `_segRenderTandaCard`, `_segRefreshDrawersPorFormula`, `segPersistirNotas`, `segCargarNotas`, nuevas `_ciNotaId`/`_ciParseTsConAno`/`_ciParseTsSinAno`/`_segFmtTs`/`_segMigrarNotasUnificadasV1`.
- Modificar: `gr/gr_app.js` — `grRegistrarSeguimiento`, `grAddSeguimientoNota`, `grRenderSeguimientoNotas`, `grEliminarSeguimientoNota`, nuevas `grEditarSeguimientoNota`/`grGuardarEdicionSeguimientoNota`/`grCancelarEdicionSeguimientoNota`, nueva `_grNotaId`, nueva `_grMigrarNotasUnificadasV1`, hook en `grInit`.
- Modificar: `CLAUDE.md` (raíz del repo `biolab-app/`) — nueva sección de invariantes de notas de seguimiento (Regla 11: toda decisión arquitectónica se documenta ahí).
- Scratchpad (no se commitea): scripts Node de verificación por módulo + driver Playwright para la verificación cross-módulo final.

---

## Task 1: Infraestructura de verificación

**Files:**
- Create (scratchpad): `verify/package.json`
- Create (scratchpad): `verify/fixtures/` (copias de trabajo del backup real)

- [ ] **Step 1: Preparar el directorio de verificación y una copia de trabajo del backup**

```bash
mkdir -p "<scratchpad>/verify/fixtures"
cp "biolab_full_backup - 25_07_2026_195558.json" "<scratchpad>/verify/fixtures/backup.json"
```

Nunca se edita `biolab_full_backup - 25_07_2026_195558.json` directamente — todos los scripts de este plan trabajan sobre la copia en `verify/fixtures/backup.json`, o hacen su propia copia en memoria (`JSON.parse(JSON.stringify(...))`) antes de mutar.

- [ ] **Step 2: Instalar playwright-core en el scratchpad (para la verificación final, Task 12)**

```bash
cd "<scratchpad>/verify"
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install playwright-core --no-audit --no-fund
```

Expected: instala sin descargar Chromium (reusa Chrome del sistema, ver Task 12).

- [ ] **Step 3: Confirmar que el backup de trabajo tiene los 4 arrays de notas en alcance**

```bash
node -e "
const raw = require('./verify/fixtures/backup.json');
function getKey(k) { let v = raw[k]; if (v==null) return null; if (typeof v==='string'){try{return JSON.parse(v);}catch(e){return v;}} return v; }
console.log('gr_lotes:', (getKey('gr_lotes')||[]).length);
console.log('su_lotes:', (getKey('su_lotes')||[]).length);
console.log('fr_bolsas:', (getKey('fr_bolsas')||[]).length);
console.log('bl2_seg_notas formulas:', Object.keys(getKey('bl2_seg_notas')||{}).length);
console.log('bl2_forms:', (getKey('bl2_forms')||[]).length);
"
```

Expected: `gr_lotes: 15`, `su_lotes` > 0, `fr_bolsas` > 0, `bl2_seg_notas formulas` > 0, `bl2_forms` > 0. Si alguno da 0, el backup de trabajo no es el correcto — parar acá y pedir uno nuevo, no seguir con datos vacíos.

---

## Task 2: FR — migración, verificada contra datos reales

**Files:**
- Create (scratchpad): `verify/fr_migracion.js`
- Modify: `fr/fr_app.js`

- [ ] **Step 1: Escribir el script de verificación con la migración copiada tal cual se va a implementar**

`verify/fr_migracion.js`:
```js
const assert = require('assert');
const fs = require('fs');
const raw = JSON.parse(fs.readFileSync(__dirname + '/fixtures/backup.json', 'utf8'));
function getKey(k) { let v = raw[k]; if (v==null) return null; if (typeof v==='string'){try{return JSON.parse(v);}catch(e){return v;}} return v; }

function _frNotaId() {
    return 'nt_fr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

function migrar(bolsas) {
    bolsas.forEach(function(b) {
        if (!Array.isArray(b.observaciones)) return;
        b.observaciones.forEach(function(o) {
            if (!o.id) o.id = _frNotaId();
            if (typeof o.auto !== 'boolean') o.auto = (o.tipo === 'auto');
            o.tipo = null;
            if (o.tsLegacy === undefined) o.tsLegacy = null;
            if (o.tsInferred === undefined) o.tsInferred = false;
            if (o.editedAt === undefined) o.editedAt = null;
            if (!Array.isArray(o.imagenes)) o.imagenes = [];
        });
    });
}

const bolsas = getKey('fr_bolsas') || [];
let totalAntes = 0;
bolsas.forEach(b => totalAntes += (b.observaciones || []).length);
const autoAntes = bolsas.reduce((n, b) => n + (b.observaciones||[]).filter(o => o.tipo === 'auto').length, 0);
const manualAntes = bolsas.reduce((n, b) => n + (b.observaciones||[]).filter(o => o.tipo === 'manual').length, 0);

migrar(bolsas);

let totalDespues = 0, sinId = 0, autoDespues = 0, manualDespues = 0, tipoNoNull = 0;
bolsas.forEach(b => (b.observaciones||[]).forEach(o => {
    totalDespues++;
    if (!o.id) sinId++;
    if (o.auto === true) autoDespues++;
    if (o.auto === false) manualDespues++;
    if (o.tipo !== null) tipoNoNull++;
}));

assert.strictEqual(totalDespues, totalAntes, 'no debe cambiar la cantidad total de notas');
assert.strictEqual(sinId, 0, 'todas las notas deben tener id tras migrar');
assert.strictEqual(autoDespues, autoAntes, 'auto:true debe coincidir 1:1 con tipo:"auto" original');
assert.strictEqual(manualDespues, manualAntes, 'auto:false debe coincidir 1:1 con tipo:"manual" original');
assert.strictEqual(tipoNoNull, 0, 'tipo debe quedar null en TODAS las notas de FR (no hay categoria en este modulo)');

console.log('FR OK — total antes:', totalAntes, '| total despues:', totalDespues, '| auto:', autoDespues, '| manual:', manualDespues);
```

- [ ] **Step 2: Correr el script y confirmar que pasa**

```bash
cd "<scratchpad>/verify" && node fr_migracion.js
```

Expected: `FR OK — total antes: 344 | total despues: 344 | auto: 315 | manual: 29` (sin `AssertionError`).

- [ ] **Step 3: Implementar `_frNotaId` y `_frMigrarNotasUnificadasV1` en `fr/fr_app.js`**

Insertar después de la función `hoyISO()` (línea ~126, antes de `ahoraISOLocal`):

```js
    function _frNotaId() {
        return 'nt_fr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    }
```

Insertar cerca de `_migrarFrInoculoSourceNull` (línea ~4672, antes de esa función):

```js
    function _frMigrarNotasUnificadasV1() {
        var KEY_MIG = 'biolab_migracion_fr_notas_unificadas_v1';
        try {
            if (localStorage.getItem(KEY_MIG) === '1') return;
            var raw = localStorage.getItem(FR_KEY);
            if (!raw) { localStorage.setItem(KEY_MIG, '1'); return; }
            var arr = JSON.parse(raw);
            if (!Array.isArray(arr)) { localStorage.setItem(KEY_MIG, '1'); return; }
            arr.forEach(function(b) {
                if (!Array.isArray(b.observaciones)) return;
                b.observaciones.forEach(function(o) {
                    if (!o.id) o.id = _frNotaId();
                    if (typeof o.auto !== 'boolean') o.auto = (o.tipo === 'auto');
                    o.tipo = null;
                    if (o.tsLegacy === undefined) o.tsLegacy = null;
                    if (o.tsInferred === undefined) o.tsInferred = false;
                    if (o.editedAt === undefined) o.editedAt = null;
                    if (!Array.isArray(o.imagenes)) o.imagenes = [];
                });
            });
            localStorage.setItem(FR_KEY, JSON.stringify(arr));
            localStorage.setItem(KEY_MIG, '1');
        } catch (e) {
            console.error('[FR] Error en migración de notas unificadas:', e);
        }
    }
```

- [ ] **Step 4: Enganchar la migración en `FR.init`**

En `fr/fr_app.js:5354`, agregar la línea nueva DESPUÉS de `_migrarFrInoculoSourceNull()` y ANTES de `loadBolsas()` (mismo orden que las otras migraciones a nivel storage):

```js
        try { _migrarFrInoculoSourceNull(); } catch (e) { console.warn('[FR] migracion inoculoSource:', e); }
        try { _frMigrarNotasUnificadasV1(); } catch (e) { console.warn('[FR] migracion notas unificadas:', e); }
        try { loadBolsas(); } catch (e) { console.warn('[FR] loadBolsas:', e); }
```

- [ ] **Step 5: Commit**

```bash
git add fr/fr_app.js
git commit -m "feat(fr): migracion one-shot de notas al shape unificado (id, auto, tipo)"
```

---

## Task 3: FR — `addObsTo`/`renderObs` al shape nuevo + botones editar/borrar

**Files:**
- Modify: `fr/fr_app.js:409-426` (`addObsTo`), `fr/fr_app.js:2554-2576` (`renderObs`)
- Modify: `fr/fr_index.html` (sin cambios de markup — los botones se generan en el string de `renderObs`)
- Modify: `fr/fr_styles.css`

- [ ] **Step 1: Reescribir `addObsTo` para producir el shape nuevo**

Reemplazar el cuerpo completo de `addObsTo` (`fr/fr_app.js:409-426`):

```js
    function addObsTo(b, texto, tipo, estado) {
        if (!b) return;
        if (!Array.isArray(b.observaciones)) b.observaciones = [];
        var t = String(texto == null ? '' : texto).trim();
        if (!t) return;
        var est = ESTADOS_OBS[estado] ? estado : 'none';
        var dias = null;
        if (b.fechaInicio) {
            dias = diasEntre(b.fechaInicio, hoyISO());
        }
        b.observaciones.push({
            id: _frNotaId(),
            ts: new Date().toISOString(),
            tsLegacy: null,
            tsInferred: false,
            texto: t,
            estado: est,
            auto: tipo === 'auto',
            tipo: null,
            dias: dias,
            editedAt: null,
            imagenes: []
        });
    }
```

El parámetro `tipo` de la función NO se renombra (evita tocar los ~25 call sites existentes que ya pasan `'auto'`/`'manual'` como string literal) — solo cambia qué campo del objeto final representa.

- [ ] **Step 2: Reescribir `renderObs` con lectura defensiva de `auto` + botones editar/borrar**

Reemplazar el cuerpo completo de `renderObs` (`fr/fr_app.js:2554-2576`):

```js
    function renderObs(b) {
        var log = document.getElementById('frObsLog');
        if (!log) return;
        var obs = b && Array.isArray(b.observaciones) ? b.observaciones : [];
        if (obs.length === 0) {
            log.innerHTML = '<div class="fr-log-empty">Sin observaciones.</div>';
            return;
        }
        var ICONO_EST = { green: 'G', yellow: 'Y', red: 'R', none: '' };
        var html = obs.slice().reverse().map(function(o) {
            var isAuto = (typeof o.auto === 'boolean') ? o.auto : (o.tipo === 'auto');
            var tipoCls = isAuto ? 'fr-log-auto' : 'fr-log-manual';
            var estado = ESTADOS_OBS[o.estado] ? o.estado : 'none';
            var estCls = 'fr-log-estado-' + estado;
            var ico = ICONO_EST[estado] || '';
            var diasTxt = (o.dias != null) ? ('dia ' + o.dias) : '';
            var idAttr = esc(o.id || '');
            var accionesHtml = (!o.id) ? '' :
                '<span class="fr-log-actions">'
                + '<button type="button" class="fr-log-btn-edit" onclick="FR.startEditObs(\'' + idAttr + '\')" title="Editar">\u270f\ufe0f</button>'
                + '<button type="button" class="fr-log-btn-del" onclick="FR.deleteObs(\'' + idAttr + '\')" title="Eliminar">\u2715</button>'
                + '</span>';
            return '<div class="fr-log-row ' + tipoCls + ' ' + estCls + '" id="fr-log-row-' + idAttr + '">'
                + '<span class="fr-log-ts">' + fmtFecha(o.ts) + (diasTxt ? ' \u00b7 ' + diasTxt : '') + (o.editedAt ? ' \u2726' : '') + '</span>'
                + '<span class="fr-log-tag">' + (ico ? ico + ' ' : '') + (isAuto ? 'auto' : 'nota') + '</span>'
                + '<span class="fr-log-text" id="fr-log-text-' + idAttr + '">' + esc(o.texto) + '</span>'
                + accionesHtml
                + '</div>';
        }).join('');
        log.innerHTML = html;
    }
```

- [ ] **Step 3: Ajustar `.fr-log-row` a 4 columnas y agregar estilos de acciones**

En `fr/fr_styles.css:950-959`, cambiar:

```css
.fr-log-row {
    display: grid;
    grid-template-columns: 110px 70px 1fr;
    gap: 10px;
    align-items: baseline;
    padding: 8px 10px;
    background: var(--dark-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
}
```

por:

```css
.fr-log-row {
    display: grid;
    grid-template-columns: 110px 70px 1fr auto;
    gap: 10px;
    align-items: baseline;
    padding: 8px 10px;
    background: var(--dark-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
}
.fr-log-actions {
    display: flex;
    gap: 4px;
}
.fr-log-btn-edit,
.fr-log-btn-del {
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.85rem;
    padding: 2px 4px;
    opacity: 0.6;
}
.fr-log-btn-edit:hover,
.fr-log-btn-del:hover {
    opacity: 1;
}
```

También en `fr/fr_styles.css:1129` (media query), agregar `.fr-log-actions` a la regla de colapso a 1 columna en mobile:

```css
    .fr-log-row { grid-template-columns: 1fr; gap: 2px; }
```
queda igual (ya cubre el caso, `auto` colapsa dentro de `1fr` en el flujo de grid de una sola columna) — no hace falta tocar esa línea.

- [ ] **Step 4: Commit**

```bash
git add fr/fr_app.js fr/fr_styles.css
git commit -m "feat(fr): addObsTo/renderObs producen shape unificado con botones editar/borrar"
```

---

## Task 4: FR — funciones editar/borrar + verificación manual

**Files:**
- Modify: `fr/fr_app.js` (agregar `FR.deleteObs`/`FR.startEditObs`/`FR.saveEditObs`/`FR.cancelEditObs`)

- [ ] **Step 1: Agregar las 4 funciones nuevas cerca de `FR.addObs` (`fr/fr_app.js:3496`)**

```js
    FR.deleteObs = function(notaId) {
        var b = getSelected();
        if (!b || !Array.isArray(b.observaciones)) return;
        b.observaciones = b.observaciones.filter(function(o) { return o.id !== notaId; });
        saveBolsas();
        renderObs(b);
    };

    FR.startEditObs = function(notaId) {
        var txtEl = document.getElementById('fr-log-text-' + notaId);
        if (!txtEl) return;
        var original = txtEl.textContent;
        txtEl.innerHTML = '<input type="text" id="fr-log-edit-' + notaId + '" value="' + esc(original) + '"'
            + ' style="width:100%;background:var(--bg-tertiary);border:1px solid var(--primary);color:var(--tx);padding:3px 6px;border-radius:4px;font-size:inherit;box-sizing:border-box"'
            + ' onkeydown="if(event.key===\'Enter\')FR.saveEditObs(\'' + notaId + '\');if(event.key===\'Escape\')FR.cancelEditObs(\'' + notaId + '\',\'' + esc(original) + '\')">';
        var input = document.getElementById('fr-log-edit-' + notaId);
        if (input) { input.focus(); input.select(); }
    };

    FR.saveEditObs = function(notaId) {
        var input = document.getElementById('fr-log-edit-' + notaId);
        if (!input) return;
        var nuevo = input.value.trim();
        if (!nuevo) return;
        var b = getSelected();
        if (!b || !Array.isArray(b.observaciones)) return;
        var nota = b.observaciones.find(function(o) { return o.id === notaId; });
        if (!nota) return;
        nota.texto = nuevo;
        nota.editedAt = new Date().toISOString();
        saveBolsas();
        renderObs(b);
    };

    FR.cancelEditObs = function(notaId, original) {
        var txtEl = document.getElementById('fr-log-text-' + notaId);
        if (txtEl) txtEl.textContent = original;
    };
```

- [ ] **Step 2: Verificación manual en navegador (no hay test suite — Regla de este proyecto)**

Abrir la app (`serve.bat` o `python -m http.server`), ir a FR, seleccionar una bolsa con observaciones reales:
1. Confirmar que las notas existentes se siguen viendo (texto, fecha, color) sin romper — la migración corrió en `FR.init()`.
2. Click en ✏️ de una nota manual → aparece input inline → escribir texto nuevo → Enter → confirmar que se actualiza y aparece el símbolo ✦ (editado) junto a la fecha.
3. Click en ✕ de una nota manual → confirmar que desaparece del log y no vuelve al recargar la página (F5).
4. Confirmar que las notas automáticas (`auto:true`) TAMBIÉN muestran botones de editar/borrar — es el mismo comportamiento que CI ya tiene hoy (`_segRenderNotaTimeline` no distingue `auto` para mostrar `accionesHtml`, ver Task 9 Step 5): cualquier nota con `id` es editable/borrable, sin importar si es auto o manual. `renderObs` (Task 3 Step 2) sigue ese mismo precedente a propósito, para que las 4 UI queden parejas entre sí.
5. Abrir devtools → Console → confirmar 0 errores nuevos al hacer los pasos 1-4.

- [ ] **Step 3: Commit**

```bash
git add fr/fr_app.js
git commit -m "feat(fr): agrega editar y borrar notas (antes no existian en la UI)"
```

---

## Task 5: SU — eliminar `SU.reNotas` (código muerto confirmado)

**Files:**
- Modify: `su/su_app.js`

- [ ] **Step 1: Confirmar una vez más que no hay 0 usos antes de borrar (defensa final antes de tocar código)**

```bash
node -e "
const raw = require('<ruta al backup de trabajo>/backup.json');
const suLotes = JSON.parse(raw.su_lotes || '[]');
let total = 0;
suLotes.forEach(l => total += (l.reNotas||[]).length);
console.log('Total reNotas reales:', total);
"
```

Expected: `Total reNotas reales: 0`. Si da distinto de 0, PARAR — no borrar, hay datos reales que perder. Volver al usuario con lo encontrado antes de seguir.

- [ ] **Step 2: Eliminar las declaraciones de `SU.reNotas` (líneas 137, 150)**

En `su/su_app.js:137`, eliminar:
```js
window.SU.reNotas = window.SU.reNotas || [];
```

En `su/su_app.js:150` (dentro de `suInit`), eliminar:
```js
    window.SU.reNotas = window.SU.reNotas || [];
```

- [ ] **Step 3: Eliminar el call site de `suReRenderNotas` en `suInit` (línea 164)**

En `su/su_app.js:164`, eliminar:
```js
    try { suReRenderNotas(); }             catch (e) { console.warn('SU.init notas:', e); }
```

- [ ] **Step 4: Eliminar el bloque completo de funciones `reNotas` (líneas 168-245 aprox.)**

Eliminar desde el comentario `// SEGUIMIENTO DE NOTAS (move arriba)` hasta el cierre de `suAddReNota` — el bloque completo:
```js
// ==========================================
// SEGUIMIENTO DE NOTAS (move arriba)
// ==========================================
SU.reNotas = SU.reNotas || [];

function suReTimestamp() {
    var now = new Date();
    return now.toLocaleString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

window.suReRenderNotas = function() {
    ...
};

window.suAddReNota = function() {
    ...
};
```
(el contenido exacto entre `{` y `}` de `suReRenderNotas`/`suAddReNota` ya está confirmado en la lectura previa del archivo — es el bloque completo entre la línea del comentario y el cierre del `};` de `suAddReNota`).

- [ ] **Step 5: Eliminar la referencia en `suDbCollect`/collect del lote (línea ~1018) y en `nuevoLote`/carga (líneas ~1038, ~1110)**

En la función de recolección del lote, eliminar la línea:
```js
        reNotas: SU.reNotas,
```

En `nuevoLote()`, eliminar:
```js
    SU.reNotas = [];
    window.suReRenderNotas();
```

En la función de carga de lote (donde está el comentario `// Cargar notas de seguimiento`), eliminar:
```js
    // Cargar notas de seguimiento
    SU.reNotas = lote.reNotas || [];
    window.suReRenderNotas();
```

**Nota:** no se toca `reNotas` dentro de `lote` en objetos YA guardados en `su_lotes` — el campo puede seguir existiendo en datos históricos (siempre vacío `[]` según Step 1), no hace falta migrarlo ni limpiarlo, solo dejar de leerlo/escribirlo desde el código nuevo en adelante.

- [ ] **Step 6: Grep de confirmación — cero referencias sueltas**

```bash
grep -n "reNotas\|suReRenderNotas\|suAddReNota\|suReTimestamp" su/su_app.js
```

Expected: sin resultados. Si aparece algo, es un call site que se pasó por alto — resolverlo antes de continuar.

- [ ] **Step 7: Grep de confirmación en `su_index.html` (por si había algún `onclick` colgante, aunque el audit ya confirmó que no)**

```bash
grep -n "reNotas\|suAddReNota" su/su_index.html
```

Expected: sin resultados (ya confirmado en el audit de la spec, este step es solo la doble verificación antes de dar por cerrado).

- [ ] **Step 8: Commit**

```bash
git add su/su_app.js
git commit -m "refactor(su): elimina SU.reNotas, codigo muerto sin UI ni datos reales (0 usos confirmados)"
```

---

## Task 6: SU — migración de `dbSeguimiento`, verificada contra datos reales

**Files:**
- Create (scratchpad): `verify/su_migracion.js`
- Modify: `su/su_app.js`

- [ ] **Step 1: Escribir el script de verificación**

`verify/su_migracion.js`:
```js
const assert = require('assert');
const fs = require('fs');
const raw = JSON.parse(fs.readFileSync(__dirname + '/fixtures/backup.json', 'utf8'));
function getKey(k) { let v = raw[k]; if (v==null) return null; if (typeof v==='string'){try{return JSON.parse(v);}catch(e){return v;}} return v; }

function _suNotaId() {
    return 'nt_su_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

function migrar(lotes) {
    lotes.forEach(function(lote) {
        if (!Array.isArray(lote.dbSeguimiento)) return;
        lote.dbSeguimiento.forEach(function(n) {
            if (!n.id) n.id = _suNotaId();
            if (typeof n.auto !== 'boolean') n.auto = false;
            if (n.tipo === undefined) n.tipo = null;
            if (n.editedAt === undefined) n.editedAt = null;
            if (!Array.isArray(n.imagenes)) n.imagenes = [];
            var m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}),\s*(\d{1,2}):(\d{2})$/.exec(n.ts || '');
            if (m) {
                var dd = parseInt(m[1], 10), mo = parseInt(m[2], 10), yy = parseInt(m[3], 10),
                    hh = parseInt(m[4], 10), mi = parseInt(m[5], 10);
                var resolved = new Date(2000 + yy, mo - 1, dd, hh, mi);
                n.tsLegacy = n.ts;
                n.ts = resolved.toISOString();
                n.tsInferred = false;
            } else if (n.tsInferred === undefined) {
                n.tsLegacy = n.tsLegacy || null;
                n.tsInferred = false;
            }
        });
    });
}

const lotes = getKey('su_lotes') || [];
let totalAntes = 0;
lotes.forEach(l => totalAntes += (l.dbSeguimiento || []).length);

migrar(lotes);

let totalDespues = 0, sinId = 0, tsNoParseable = 0, tsInvalido = 0;
lotes.forEach(l => (l.dbSeguimiento||[]).forEach(n => {
    totalDespues++;
    if (!n.id) sinId++;
    if (isNaN(new Date(n.ts).getTime())) tsInvalido++;
    if (!n.tsLegacy && n.tsInferred === false && !/^\d{4}-\d{2}-\d{2}T/.test(n.ts)) tsNoParseable++;
}));

assert.strictEqual(totalDespues, totalAntes, 'no debe cambiar la cantidad total de notas');
assert.strictEqual(sinId, 0, 'todas las notas deben tener id tras migrar');
assert.strictEqual(tsInvalido, 0, 'ningun ts resultante debe ser una fecha invalida');

console.log('SU OK — total antes:', totalAntes, '| total despues:', totalDespues, '| con tsLegacy:', lotes.reduce((n,l)=>n+(l.dbSeguimiento||[]).filter(x=>x.tsLegacy).length,0));
```

- [ ] **Step 2: Correr y confirmar**

```bash
cd "<scratchpad>/verify" && node su_migracion.js
```

Expected: `SU OK — total antes: 87 | total despues: 87 | con tsLegacy: 87` (las 87 notas reales de SU tienen formato locale con año — todas migran con `tsLegacy` seteado, ninguna queda como fecha inválida).

- [ ] **Step 3: Implementar `_suNotaId`, `suDbFmtTs` y `_suMigrarNotasUnificadasV1` en `su/su_app.js`**

Insertar cerca de `suDbTimestamp` (`su/su_app.js:2544`):

```js
function _suNotaId() {
    return 'nt_su_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

function suDbFmtTs(iso) {
    if (!iso) return '';
    try {
        var d = new Date(iso);
        if (isNaN(d.getTime())) return String(iso);
        var dd = String(d.getDate()).padStart(2, '0');
        var mm = String(d.getMonth() + 1).padStart(2, '0');
        var hh = String(d.getHours()).padStart(2, '0');
        var mi = String(d.getMinutes()).padStart(2, '0');
        return dd + '/' + mm + '/' + d.getFullYear() + ' ' + hh + ':' + mi;
    } catch (e) { return String(iso); }
}

function _suMigrarNotasUnificadasV1() {
    var MIGRACION_KEY = 'biolab_migracion_su_notas_unificadas_v1';
    try {
        if (localStorage.getItem(MIGRACION_KEY) === '1') return;
        var raw = localStorage.getItem(SU_STORAGE_KEY);
        if (!raw) { localStorage.setItem(MIGRACION_KEY, '1'); return; }
        var lotes = JSON.parse(raw);
        if (!Array.isArray(lotes)) { localStorage.setItem(MIGRACION_KEY, '1'); return; }
        lotes.forEach(function(lote) {
            if (!Array.isArray(lote.dbSeguimiento)) return;
            lote.dbSeguimiento.forEach(function(n) {
                if (!n.id) n.id = _suNotaId();
                if (typeof n.auto !== 'boolean') n.auto = false;
                if (n.tipo === undefined) n.tipo = null;
                if (n.editedAt === undefined) n.editedAt = null;
                if (!Array.isArray(n.imagenes)) n.imagenes = [];
                var m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}),\s*(\d{1,2}):(\d{2})$/.exec(n.ts || '');
                if (m) {
                    var dd = parseInt(m[1], 10), mo = parseInt(m[2], 10), yy = parseInt(m[3], 10),
                        hh = parseInt(m[4], 10), mi = parseInt(m[5], 10);
                    var resolved = new Date(2000 + yy, mo - 1, dd, hh, mi);
                    n.tsLegacy = n.ts;
                    n.ts = resolved.toISOString();
                    n.tsInferred = false;
                } else if (n.tsInferred === undefined) {
                    n.tsLegacy = n.tsLegacy || null;
                    n.tsInferred = false;
                }
            });
        });
        localStorage.setItem(SU_STORAGE_KEY, JSON.stringify(lotes));
        localStorage.setItem(MIGRACION_KEY, '1');
    } catch (e) {
        console.error('[SU] Error en migración de notas unificadas:', e);
    }
}
```

- [ ] **Step 4: Enganchar en `suInit` (`su/su_app.js:146`)**

```js
window.SU.init = function suInit() {
    if (window.SU._initialized) return;
    window.SU._initialized = true;

    try { cargarBibliotecaDesdeStorage(); } catch (e) { console.warn('SU.init cargarBiblioteca:', e); }
    try { _suMigrarNotasUnificadasV1(); }  catch (e) { console.warn('SU.init migracion notas:', e); }
    try { cargarLotesDesdeStorage(); }     catch (e) { console.warn('SU.init cargarLotes:', e); }
```

(se agrega la línea nueva entre `cargarBibliotecaDesdeStorage` y `cargarLotesDesdeStorage` — antes de que se carguen los lotes en memoria, mismo criterio que las migraciones de aditivos ya existentes en este archivo).

- [ ] **Step 5: Commit**

```bash
git add su/su_app.js
git commit -m "feat(su): migracion one-shot de dbSeguimiento al shape unificado (id, ts ISO)"
```

---

## Task 7: SU — escritores/render/editar al shape nuevo

**Files:**
- Modify: `su/su_app.js:3208-3222` (`suDbRegistrarSeguimiento`), `:3326-3373` (render/add/eliminar)

- [ ] **Step 1: Reescribir `suDbRegistrarSeguimiento`**

```js
function suDbRegistrarSeguimiento(tipo, mensaje, emoji) {
    var estado = 'none';
    if (emoji === '🟡') estado = 'yellow';
    else if (emoji === '🔴') estado = 'red';
    else if (emoji === '🟢') estado = 'green';

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
```

- [ ] **Step 2: Reescribir `suDbAddSeguimientoNota`, `suDbRenderSeguimientoNotas`, `suDbEliminarSeguimientoNota`**

```js
window.suDbAddSeguimientoNota = function() {
    var input = document.getElementById('suDbSeguimientoNotaInput');
    var estadoSel = document.getElementById('suDbSeguimientoEstado');
    if (!input) return;
    var texto = (input.value || '').trim();
    if (!texto) { alert('Ingrese una nota'); return; }

    SU.dbSeguimientoNotas.push({
        id: _suNotaId(),
        ts: new Date().toISOString(),
        tsLegacy: null,
        tsInferred: false,
        tipo: null,
        texto: texto,
        estado: estadoSel ? estadoSel.value : 'none',
        auto: false,
        editedAt: null,
        imagenes: []
    });

    input.value = '';
    if (estadoSel) estadoSel.value = 'none';
    window.suDbRenderSeguimientoNotas();
};

window.suDbRenderSeguimientoNotas = function() {
    var cont = document.getElementById('suDbSeguimientoNotas');
    if (!cont) return;
    if (!SU.dbSeguimientoNotas || SU.dbSeguimientoNotas.length === 0) {
        cont.innerHTML = '<p style="color:var(--text-muted);font-size:0.9rem;">Sin notas de seguimiento DB</p>';
        return;
    }
    cont.innerHTML = SU.dbSeguimientoNotas.map(function(n) {
        var borderColor = 'var(--border)';
        var estadoStr = '⚪ Normal';
        if (n.estado === 'green') { borderColor = '#70AD47'; estadoStr = '🟢 Positivo'; }
        else if (n.estado === 'yellow') { borderColor = '#FFC000'; estadoStr = '🟡 Atención'; }
        else if (n.estado === 'red') { borderColor = '#C00000'; estadoStr = '🔴 Peligro'; }

        var autoTag = n.auto ? ' · auto' : '';
        var tsDisplay = suDbFmtTs(n.ts) + (n.tsInferred ? ' ~' : '');
        var idAttr = suDbEscapeHtml(n.id || '');
        return '<div style="padding:10px 12px;margin-bottom:8px;background:var(--dark);border-left:3px solid ' + borderColor + ';border-radius:6px;position:relative;">'
            + '<div style="font-size:0.78rem;color:var(--text-muted);font-weight:600;margin-bottom:4px">' + tsDisplay + ' · ' + estadoStr + autoTag + '</div>'
            + '<div style="font-size:0.92rem;color:var(--text-light)" id="su-db-seg-text-' + idAttr + '">' + suDbEscapeHtml(n.texto) + (n.editedAt ? ' <span style="opacity:.6">✦</span>' : '') + '</div>'
            + '<div style="position:absolute;top:8px;right:8px;display:flex;gap:4px">'
            + '<button onclick="window.suDbEditarSeguimientoNota(\'' + idAttr + '\')" style="background:transparent;border:none;color:var(--text-muted);cursor:pointer;font-size:0.85rem;opacity:.6" title="Editar">✏️</button>'
            + '<button onclick="window.suDbEliminarSeguimientoNota(\'' + idAttr + '\')" style="background:transparent;border:none;color:var(--text-muted);cursor:pointer;font-size:0.9rem;opacity:.6" title="Eliminar nota">✕</button>'
            + '</div>'
            + '</div>';
    }).join('');
};

window.suDbEliminarSeguimientoNota = function(notaId) {
    if (!SU.dbSeguimientoNotas) return;
    SU.dbSeguimientoNotas = SU.dbSeguimientoNotas.filter(function(n) { return n.id !== notaId; });
    window.suDbRenderSeguimientoNotas();
};
```

- [ ] **Step 3: Agregar `suDbEditarSeguimientoNota`/`suDbGuardarEdicionSeguimientoNota`/`suDbCancelarEdicionSeguimientoNota`**

Justo después de `suDbEliminarSeguimientoNota`:

```js
window.suDbEditarSeguimientoNota = function(notaId) {
    var txtEl = document.getElementById('su-db-seg-text-' + notaId);
    if (!txtEl) return;
    var original = txtEl.textContent.replace(/\s*✦\s*$/, '');
    txtEl.innerHTML = '<input type="text" value="' + suDbEscapeHtml(original) + '" id="su-db-seg-edit-' + notaId + '"'
        + ' style="width:100%;background:var(--dark);border:1px solid var(--primary,#00CC33);color:var(--text-light);padding:4px 8px;border-radius:4px;font-size:inherit;box-sizing:border-box"'
        + ' onkeydown="if(event.key===\'Enter\')window.suDbGuardarEdicionSeguimientoNota(\'' + notaId + '\');if(event.key===\'Escape\')window.suDbCancelarEdicionSeguimientoNota(\'' + notaId + '\',\'' + suDbEscapeHtml(original) + '\')">';
    var input = document.getElementById('su-db-seg-edit-' + notaId);
    if (input) { input.focus(); input.select(); }
};

window.suDbGuardarEdicionSeguimientoNota = function(notaId) {
    var input = document.getElementById('su-db-seg-edit-' + notaId);
    if (!input) return;
    var nuevo = input.value.trim();
    if (!nuevo) return;
    if (!SU.dbSeguimientoNotas) return;
    var nota = SU.dbSeguimientoNotas.find(function(n) { return n.id === notaId; });
    if (!nota) return;
    nota.texto = nuevo;
    nota.editedAt = new Date().toISOString();
    window.suDbRenderSeguimientoNotas();
};

window.suDbCancelarEdicionSeguimientoNota = function(notaId, original) {
    var txtEl = document.getElementById('su-db-seg-text-' + notaId);
    if (txtEl) txtEl.textContent = original;
};
```

- [ ] **Step 4: Verificación manual en navegador**

Ir a SU, abrir un lote con notas DB reales:
1. Confirmar que las notas viejas se ven con fecha formateada correctamente (no "Invalid Date").
2. Agregar una nota manual nueva → confirmar `ts` con hora actual.
3. Editar una nota → confirmar que persiste tras recargar el lote.
4. Borrar una nota → confirmar que no vuelve.
5. Console sin errores nuevos.

- [ ] **Step 5: Commit**

```bash
git add su/su_app.js
git commit -m "feat(su): dbSeguimiento produce shape unificado, agrega editar notas"
```

---

## Task 8: CI — migración con parser de 2 formatos de `ts`, verificada contra datos reales

**Files:**
- Create (scratchpad): `verify/ci_migracion.js`
- Modify: `ci/ci_app.js`

- [ ] **Step 1: Escribir el script de verificación**

`verify/ci_migracion.js`:
```js
const assert = require('assert');
const fs = require('fs');
const raw = JSON.parse(fs.readFileSync(__dirname + '/fixtures/backup.json', 'utf8'));
function getKey(k) { let v = raw[k]; if (v==null) return null; if (typeof v==='string'){try{return JSON.parse(v);}catch(e){return v;}} return v; }

function _ciNotaId() {
    return 'nt_ci_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}
function _ciParseTsConAno(tsStr) {
    var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s*(\d{1,2}):(\d{2})\s*(a\.\s?m\.|p\.\s?m\.)/i.exec(tsStr || '');
    if (!m) return null;
    var dd = parseInt(m[1], 10), mo = parseInt(m[2], 10), yyyy = parseInt(m[3], 10),
        hh = parseInt(m[4], 10), mi = parseInt(m[5], 10);
    var isPM = /p/i.test(m[6]);
    if (isPM && hh < 12) hh += 12;
    if (!isPM && hh === 12) hh = 0;
    return new Date(yyyy, mo - 1, dd, hh, mi);
}
function _ciParseTsSinAno(tsStr) {
    var m = /^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})\s*(a\.\s?m\.|p\.\s?m\.)/i.exec(tsStr || '');
    if (!m) return null;
    var dd = parseInt(m[1], 10), mo = parseInt(m[2], 10),
        hh = parseInt(m[3], 10), mi = parseInt(m[4], 10);
    var isPM = /p/i.test(m[5]);
    if (isPM && hh < 12) hh += 12;
    if (!isPM && hh === 12) hh = 0;
    return { dd: dd, mo: mo, hh: hh, mi: mi };
}

function migrar(notasPorFormula, forms) {
    Object.keys(notasPorFormula).forEach(function(formulaId) {
        var arr = notasPorFormula[formulaId];
        if (!Array.isArray(arr)) return;
        var form = forms.find(function(f) { return f.id === formulaId; });
        var anchor = (form && form.fecha) ? new Date(form.fecha) : new Date('2026-01-01T00:00:00.000Z');
        arr.forEach(function(n) {
            if (!n.id) n.id = _ciNotaId();
            if (n._eventType !== undefined) { n.tipo = n._eventType; delete n._eventType; }
            else if (n.tipo === undefined) n.tipo = null;
            if (n.editedAt === undefined) n.editedAt = null;
            if (!Array.isArray(n.imagenes)) n.imagenes = [];
            var conAno = _ciParseTsConAno(n.ts);
            if (conAno) {
                n.tsLegacy = n.ts;
                n.ts = conAno.toISOString();
                n.tsInferred = false;
            } else {
                var sinAno = _ciParseTsSinAno(n.ts);
                if (sinAno) {
                    var y = anchor.getFullYear();
                    var candidato;
                    for (var tries = 0; tries < 3; tries++) {
                        candidato = new Date(y, sinAno.mo - 1, sinAno.dd, sinAno.hh, sinAno.mi);
                        if (candidato >= anchor) break;
                        y++;
                    }
                    n.tsLegacy = n.ts;
                    n.ts = candidato.toISOString();
                    n.tsInferred = true;
                } else if (n.tsInferred === undefined) {
                    n.tsLegacy = n.tsLegacy || null;
                    n.tsInferred = false;
                }
            }
        });
    });
}

const notas = getKey('bl2_seg_notas') || {};
const forms = getKey('bl2_forms') || [];
let totalAntes = 0;
Object.values(notas).forEach(arr => totalAntes += (arr||[]).length);

migrar(notas, forms);

let totalDespues = 0, sinId = 0, tsInvalido = 0, inferidas = 0, eventTypeResidual = 0;
Object.values(notas).forEach(arr => (arr||[]).forEach(n => {
    totalDespues++;
    if (!n.id) sinId++;
    if (isNaN(new Date(n.ts).getTime())) tsInvalido++;
    if (n.tsInferred) inferidas++;
    if ('_eventType' in n) eventTypeResidual++;
}));

assert.strictEqual(totalDespues, totalAntes, 'no debe cambiar la cantidad total de notas');
assert.strictEqual(sinId, 0, 'todas las notas deben tener id tras migrar');
assert.strictEqual(tsInvalido, 0, 'ningun ts resultante debe ser una fecha invalida');
assert.strictEqual(eventTypeResidual, 0, '_eventType debe quedar renombrado a tipo en el 100% de los casos');
assert.strictEqual(inferidas, 44, 'se esperan exactamente 44 notas con ts reconstruido (formato sin año, dato real conocido)');

console.log('CI OK — total antes:', totalAntes, '| total despues:', totalDespues, '| inferidas (tsInferred):', inferidas);
```

- [ ] **Step 2: Correr y confirmar**

```bash
cd "<scratchpad>/verify" && node ci_migracion.js
```

Expected: `CI OK — total antes: 192 | total despues: 192 | inferidas (tsInferred): 44`.

- [ ] **Step 3: Implementar las funciones nuevas en `ci/ci_app.js`**

Insertar cerca de `segTimestamp`/`segEscapeHtml` (`ci/ci_app.js:3143`):

```js
function _ciNotaId() {
  return 'nt_ci_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

function _ciParseTsConAno(tsStr) {
  var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s*(\d{1,2}):(\d{2})\s*(a\.\s?m\.|p\.\s?m\.)/i.exec(tsStr || '');
  if (!m) return null;
  var dd = parseInt(m[1], 10), mo = parseInt(m[2], 10), yyyy = parseInt(m[3], 10),
      hh = parseInt(m[4], 10), mi = parseInt(m[5], 10);
  var isPM = /p/i.test(m[6]);
  if (isPM && hh < 12) hh += 12;
  if (!isPM && hh === 12) hh = 0;
  return new Date(yyyy, mo - 1, dd, hh, mi);
}

function _ciParseTsSinAno(tsStr) {
  var m = /^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})\s*(a\.\s?m\.|p\.\s?m\.)/i.exec(tsStr || '');
  if (!m) return null;
  var dd = parseInt(m[1], 10), mo = parseInt(m[2], 10),
      hh = parseInt(m[3], 10), mi = parseInt(m[4], 10);
  var isPM = /p/i.test(m[5]);
  if (isPM && hh < 12) hh += 12;
  if (!isPM && hh === 12) hh = 0;
  return { dd: dd, mo: mo, hh: hh, mi: mi };
}

function _segFmtTs(iso) {
  if (!iso) return '';
  try {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
  } catch (e) { return String(iso); }
}

function _segMigrarNotasUnificadasV1() {
  var MIGRACION_KEY = 'biolab_migracion_ci_notas_unificadas_v1';
  try {
    if (localStorage.getItem(MIGRACION_KEY) === '1') return;
    var raw = localStorage.getItem('bl2_seg_notas');
    if (!raw) { localStorage.setItem(MIGRACION_KEY, '1'); return; }
    var notasPorFormula = JSON.parse(raw);
    if (!notasPorFormula || typeof notasPorFormula !== 'object') { localStorage.setItem(MIGRACION_KEY, '1'); return; }
    var forms = gDB(K.forms);
    Object.keys(notasPorFormula).forEach(function(formulaId) {
      var arr = notasPorFormula[formulaId];
      if (!Array.isArray(arr)) return;
      var form = forms.find(function(f) { return f.id === formulaId; });
      var anchor = (form && form.fecha) ? new Date(form.fecha) : new Date('2026-01-01T00:00:00.000Z');
      arr.forEach(function(n) {
        if (!n.id) n.id = _ciNotaId();
        if (n._eventType !== undefined) { n.tipo = n._eventType; delete n._eventType; }
        else if (n.tipo === undefined) n.tipo = null;
        if (n.editedAt === undefined) n.editedAt = null;
        if (!Array.isArray(n.imagenes)) n.imagenes = [];
        var conAno = _ciParseTsConAno(n.ts);
        if (conAno) {
          n.tsLegacy = n.ts;
          n.ts = conAno.toISOString();
          n.tsInferred = false;
        } else {
          var sinAno = _ciParseTsSinAno(n.ts);
          if (sinAno) {
            var y = anchor.getFullYear();
            var candidato;
            for (var tries = 0; tries < 3; tries++) {
              candidato = new Date(y, sinAno.mo - 1, sinAno.dd, sinAno.hh, sinAno.mi);
              if (candidato >= anchor) break;
              y++;
            }
            n.tsLegacy = n.ts;
            n.ts = candidato.toISOString();
            n.tsInferred = true;
          } else if (n.tsInferred === undefined) {
            n.tsLegacy = n.tsLegacy || null;
            n.tsInferred = false;
          }
        }
      });
    });
    localStorage.setItem('bl2_seg_notas', JSON.stringify(notasPorFormula));
    localStorage.setItem(MIGRACION_KEY, '1');
  } catch (e) {
    console.error('[CI] Error en migración de notas unificadas:', e);
  }
}
```

- [ ] **Step 4: Enganchar al final de `segCargarNotas` (`ci/ci_app.js:3843-3879`)**

Agregar la llamada nueva como última línea del cuerpo de `segCargarNotas`, después de que termine su lógica existente de backfill de `_eventType`/dedup (que se deja intacta — protege datos históricos con duplicados ya conocidos):

```js
function segCargarNotas() {
  try {
    const n = JSON.parse(localStorage.getItem('bl2_seg_notas'));
    if (!n) return;
    // ... (todo el cuerpo existente sin cambios: backfill de _eventType, dedup, writeback) ...
    SEG.seguimientoNotas = n;
    try { localStorage.setItem('bl2_seg_notas', JSON.stringify(n)); } catch {}
  } catch {}
  _segMigrarNotasUnificadasV1();
}
```

- [ ] **Step 5: Commit**

```bash
git add ci/ci_app.js
git commit -m "feat(ci): migracion one-shot de bl2_seg_notas con parser de 2 formatos de ts historicos"
```

---

## Task 9: CI — direccionamiento por `id` en escritores/render/editar/borrar

**Files:**
- Modify: `ci/ci_app.js` (múltiples funciones, ver lista en "Estructura de archivos")

- [ ] **Step 1: Actualizar `segAddNotaCard` (`ci/ci_app.js:3619-3626`) para escribir el shape nuevo**

```js
  SEG.seguimientoNotas[frmId].push({
    id: _ciNotaId(),
    ts:      new Date().toISOString(),
    tsLegacy: null,
    tsInferred: false,
    texto,
    estado:  estadoSel ? estadoSel.value : 'none',
    auto:    false,
    tipo: null,
    editedAt: null,
    imagenes,
    tandaId: tandaId === '__general__' ? null : tandaId,
  });
```

- [ ] **Step 2: Actualizar `segEmitirNotaAuto` (`ci/ci_app.js:2621-2639`) — dedup por `tipo` en vez de `_eventType`, shape nuevo**

```js
function segEmitirNotaAuto(frmId, estado, texto, tandaId = null) {
  if (!SEG.seguimientoNotas) SEG.seguimientoNotas = {};
  if (!SEG.seguimientoNotas[frmId]) SEG.seguimientoNotas[frmId] = [];
  const eventType = texto.split(' — ')[0];
  const tId = tandaId || null;
  const arr = SEG.seguimientoNotas[frmId];
  const existingIdx = arr.findIndex(n => n.auto && n.tipo === eventType && n.tandaId === tId);
  const newNota = {
    id: existingIdx >= 0 ? arr[existingIdx].id : _ciNotaId(),
    ts: new Date().toISOString(),
    tsLegacy: null,
    tsInferred: false,
    texto, estado, auto: true,
    tipo: eventType,
    editedAt: null,
    imagenes: existingIdx >= 0 ? (arr[existingIdx].imagenes || []) : [],
    tandaId: tId,
  };
  if (existingIdx >= 0) arr.splice(existingIdx, 1);
  arr.unshift(newNota);
  segRenderSeguimientoNotas(frmId);
  segPersistirNotas();
}
```

- [ ] **Step 3: Actualizar `segRenderSeguimientoNotas` (`ci/ci_app.js:3332-3389`) — quitar tracking de `globalIdx`**

En el bloque que distribuye notas en grupos:
```js
  // Distribuir notas en sus grupos
  notas.forEach((nota) => {
    const tid = _segResolveTandaId(nota);
    if (!grupos.has(tid)) grupos.set(tid, { notas: [], storageRow: null });
    grupos.get(tid).notas.push(nota);
  });
```

- [ ] **Step 4: Actualizar `_segRenderTandaCard` (`ci/ci_app.js:3394-3500`) — `notasGrupo` ahora es array de notas, no de `{nota, globalIdx}`**

```js
  // ── Color de borde según peor estado y contexto ───────────────────────
  const worstEstado = notasGrupo.reduce((acc, nota) => {
    if (nota.estado === 'red')                              return 'red';
    if (nota.estado === 'yellow' && acc !== 'red')          return 'yellow';
    if (nota.estado === 'green'  && acc === 'none')         return 'green';
    return acc;
  }, 'none');
```

```js
  // ── Timeline de notas ─────────────────────────────────────────────────
  const timelineHtml = notasGrupo.length
    ? notasGrupo.map((nota) =>
        _segRenderNotaTimeline(nota, frmId, isEdit)
      ).join('')
    : '<div class="seg-tc-no-notas">Sin notas registradas — usá el formulario para agregar una.</div>';
```

- [ ] **Step 5: Reescribir `_segRenderNotaTimeline` (`ci/ci_app.js:3506-3544`) — quita `globalIdx`, usa `nota.id`**

```js
function _segRenderNotaTimeline(nota, frmId, isEdit) {
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
  const nId = esc(nota.id);

  const imgs_clean = (nota.imagenes || []).filter(Boolean);
  const imagenesHtml = imgs_clean.length
    ? `<div class="seg-nota-imgs">${imgs_clean.map((img, ii) =>
        `<div class="seg-nota-img-wrap">
          <img src="${img.data}" alt="" onclick="segVerImagenNota('${esc(frmId)}','${nId}',${ii})">
          ${isEdit ? `<button class="seg-nota-img-del" onclick="segEliminarImagenNota('${esc(frmId)}','${nId}',${ii})">✕</button>` : ''}
        </div>`).join('')}</div>`
    : '';

  const accionesHtml = isEdit
    ? `<div class="seg-nota-acciones">
        <button class="seg-nota-btn-edit" onclick="segEditarNota('${nId}','${esc(frmId)}')" title="Editar">✏️</button>
        <button class="seg-nota-btn-del"  onclick="segEliminarSeguimientoNota('${nId}','${esc(frmId)}')" title="Eliminar">✕</button>
       </div>`
    : `<button class="seg-nota-btn-del solo" onclick="segEliminarSeguimientoNota('${nId}','${esc(frmId)}')" title="Eliminar">✕</button>`;

  return `
<div class="seg-nota-item ${est.cls}">
  <div class="seg-nota-dot" style="background:${est.dot}"></div>
  <div class="seg-nota-content">
    <div class="seg-nota-meta">${segEscapeHtml(_segFmtTs(nota.ts))}${nota.tsInferred ? ' ~' : ''} · ${est.emoji} ${autoTag}</div>
    <div class="seg-nota-txt" id="seg-nota-texto-${nId}">${segEscapeHtml(nota.texto)}</div>
    ${imagenesHtml}
  </div>
  ${accionesHtml}
</div>`;
}
```

- [ ] **Step 6: Actualizar `_segRefreshDrawersPorFormula` (`ci/ci_app.js:3709-3731`)**

```js
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

    const notasDeTanda = allNotas.filter(function(n) { return _segResolveTandaId(n) === target; });

    const timelineEl = document.getElementById('seg-dw-timeline-' + safeRowId);
    if (timelineEl) {
      timelineEl.innerHTML = notasDeTanda.length
        ? notasDeTanda.map(function(n) { return _segRenderNotaTimeline(n, frmId, false); }).join('')
        : '<div class="seg-drawer-empty">Sin notas para esta tanda todavía.</div>';
    }
```
(el resto del cuerpo de la función, después de este bloque, queda sin cambios).

- [ ] **Step 7: Reescribir `segEditarNota`/`segGuardarEdicionNota`/`segEliminarSeguimientoNota` (`ci/ci_app.js:3685-3702`, `:3737-3744`) — direccionar por `notaId`**

```js
function segEditarNota(notaId, frmId) {
  const notaEl = document.getElementById('seg-nota-texto-' + notaId); if (!notaEl) return;
  const currentText = notaEl.textContent || '';
  const input = document.createElement('input');
  input.type = 'text'; input.value = currentText;
  input.style.cssText = 'width:100%;background:var(--bg-tertiary);border:1px solid #00CC33;color:var(--tx);padding:6px 10px;border-radius:6px;font-size:.92rem;box-sizing:border-box';
  input.onblur = () => segGuardarEdicionNota(notaId, frmId, input.value);
  input.onkeypress = e => { if (e.key === 'Enter') segGuardarEdicionNota(notaId, frmId, input.value); };
  notaEl.innerHTML = ''; notaEl.appendChild(input); input.focus();
}

function segGuardarEdicionNota(notaId, frmId, newText) {
  const notas = SEG.seguimientoNotas?.[frmId];
  if (!notas) return;
  const nota = notas.find(n => n.id === notaId);
  if (!nota) return;
  nota.texto = newText.trim();
  nota.editedAt = new Date().toISOString();
  segRenderSeguimientoNotas(frmId);
  segPersistirNotas();
}

function segEliminarSeguimientoNota(notaId, frmId) {
  const notas = SEG.seguimientoNotas?.[frmId];
  if (!notas) return;
  const idx = notas.findIndex(n => n.id === notaId);
  if (idx === -1) return;
  notas.splice(idx, 1);
  _segRefreshDrawersPorFormula(frmId);
  segRenderSeguimientoNotas(frmId);
  segPersistirNotas();
}
```

- [ ] **Step 8: Reescribir `segEliminarImagenNota`/`segVerImagenNota` (`ci/ci_app.js:3822-3841`) — direccionar por `notaId`**

```js
function segEliminarImagenNota(frmId, notaId, imgIdx) {
  const notas = SEG.seguimientoNotas?.[frmId];
  const nota = notas && notas.find(n => n.id === notaId);
  if (!nota) return;
  if (nota.imagenes && nota.imagenes.length > imgIdx) {
    nota.imagenes.splice(imgIdx, 1);
    segRenderSeguimientoNotas(frmId);
    segPersistirNotas();
  }
}

function segVerImagenNota(frmId, notaId, imgIdx) {
  const notas = SEG.seguimientoNotas?.[frmId];
  const nota = notas && notas.find(n => n.id === notaId);
  if (!nota || !nota.imagenes?.[imgIdx]) return;
  const img = nota.imagenes[imgIdx];
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out';
  overlay.innerHTML = '<img src="' + img.data + '" style="max-width:90vw;max-height:90vh;border-radius:8px;box-shadow:0 4px 32px rgba(0,0,0,0.8)">';
  overlay.onclick = function() { document.body.removeChild(overlay); };
  document.body.appendChild(overlay);
}
```

- [ ] **Step 9: Simplificar `segPersistirNotas` (`ci/ci_app.js:3751-3781`) — merge por `id` en vez de `ts+texto`/`_eventType+tandaId`**

```js
function segPersistirNotas() {
  try {
    const enStorage = JSON.parse(localStorage.getItem('bl2_seg_notas') || '{}') || {};
    const merged = Object.assign({}, enStorage);
    Object.keys(SEG.seguimientoNotas).forEach(function(fId) {
      const storArr = enStorage[fId] || [];
      const memArr  = SEG.seguimientoNotas[fId] || [];
      const memIds = new Set(memArr.map(function(n) { return n.id; }).filter(Boolean));
      const soloEnStorage = storArr.filter(function(n) { return !n.id || !memIds.has(n.id); });
      merged[fId] = soloEnStorage.concat(memArr);
    });
    localStorage.setItem('bl2_seg_notas', JSON.stringify(merged));
    SEG.seguimientoNotas = merged;
  } catch (e) {
    console.warn('[CI] segPersistirNotas: error al persistir notas:', e);
  }
}
```

Esto reemplaza la lógica de matching por `ts+texto`/`_eventType+tandaId` que causó la pérdida de notas documentada en MEJ-0010 — con `id` estable, el merge es una simple unión de sets.

- [ ] **Step 10: Verificación manual en navegador**

Ir a CI, abrir una fórmula con notas reales (ej. `CI-0004`, tiene 17 notas de ambos formatos de `ts`):
1. Confirmar que TODAS las notas viejas se siguen viendo, con fecha legible (ninguna "Invalid Date"), y que las que tenían formato sin año muestran el símbolo `~` (inferido).
2. Editar una nota manual → confirmar que guarda y muestra fecha de edición.
3. Borrar una nota → confirmar que no vuelve al recargar.
4. Ver/borrar una imagen de una nota que tenga fotos (si hay alguna con `imagenes` no vacío en el backup real — puede que no haya ninguna, ver spec: 0/192 notas reales con foto — en ese caso, subir una foto nueva a una nota de prueba y confirmar el flujo completo).
5. Disparar un evento auto real (marcar colonización en una tanda de SEG) → confirmar que la nota auto nueva aparece arriba (unshift) con `ts` de hoy, sin `~`.
6. Console sin errores nuevos.

- [ ] **Step 11: Commit**

```bash
git add ci/ci_app.js
git commit -m "refactor(ci): direccionamiento de notas por id estable, reemplaza indice de array"
```

---

## Task 10: GR — migración reconciliando 2 escritores + `ts` sin año, verificada contra datos reales

**Files:**
- Create (scratchpad): `verify/gr_migracion.js`
- Modify: `gr/gr_app.js`

- [ ] **Step 1: Escribir el script de verificación**

`verify/gr_migracion.js`:
```js
const assert = require('assert');
const fs = require('fs');
const raw = JSON.parse(fs.readFileSync(__dirname + '/fixtures/backup.json', 'utf8'));
function getKey(k) { let v = raw[k]; if (v==null) return null; if (typeof v==='string'){try{return JSON.parse(v);}catch(e){return v;}} return v; }

function _grNotaId() {
    return 'nt_gr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}
const GR_EVENT_TIPOS = { inoculacion: true, contaminacion: true, colonizacion: true, 'frascos-gr': true };

function migrar(lotes) {
    lotes.forEach(function(lote) {
        if (!Array.isArray(lote.seguimientoNotas)) return;
        var anchor = lote.fecha ? new Date(lote.fecha + 'T00:00:00') : null;
        lote.seguimientoNotas.forEach(function(n) {
            if (!n.id) n.id = _grNotaId();
            if (typeof n.auto !== 'boolean') {
                var hasEventTipo = n.tipo && GR_EVENT_TIPOS[n.tipo];
                var hasManualFields = ('fechaHora' in n) || ('frascos' in n) || ('dias' in n);
                n.auto = !!hasEventTipo && !hasManualFields;
            }
            if (n.tipo === undefined) n.tipo = null;
            if (n.editedAt === undefined) n.editedAt = null;
            if (!Array.isArray(n.imagenes)) n.imagenes = [];
            if (n.fechaHora) {
                n.tsLegacy = n.ts;
                n.ts = n.fechaHora;
                n.tsInferred = false;
            } else {
                var m = /^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/.exec(n.ts || '');
                if (m && anchor) {
                    var dd = parseInt(m[1], 10), mo = parseInt(m[2], 10), hh = parseInt(m[3], 10), mi = parseInt(m[4], 10);
                    var y = anchor.getFullYear();
                    var candidato;
                    for (var tries = 0; tries < 3; tries++) {
                        candidato = new Date(y, mo - 1, dd, hh, mi);
                        if (candidato >= anchor) break;
                        y++;
                    }
                    n.tsLegacy = n.ts;
                    n.ts = candidato.toISOString();
                    n.tsInferred = true;
                } else if (n.tsInferred === undefined) {
                    n.tsLegacy = n.tsLegacy || null;
                    n.tsInferred = false;
                }
            }
        });
    });
}

const lotes = getKey('gr_lotes') || [];
let totalAntes = 0;
lotes.forEach(l => totalAntes += (l.seguimientoNotas || []).length);

migrar(lotes);

let totalDespues = 0, sinId = 0, tsInvalido = 0, autoTrue = 0, monotonicViolations = 0;
lotes.forEach(l => {
    var prev = null;
    (l.seguimientoNotas||[]).forEach(n => {
        totalDespues++;
        if (!n.id) sinId++;
        if (isNaN(new Date(n.ts).getTime())) tsInvalido++;
        if (n.auto === true) autoTrue++;
        var d = new Date(n.ts);
        if (prev && d < prev) monotonicViolations++;
        prev = d;
    });
});

assert.strictEqual(totalDespues, totalAntes, 'no debe cambiar la cantidad total de notas');
assert.strictEqual(sinId, 0, 'todas las notas deben tener id tras migrar');
assert.strictEqual(tsInvalido, 0, 'ningun ts resultante debe ser una fecha invalida');
assert.strictEqual(autoTrue, 135, 'se esperan exactamente 135 notas auto (dato real conocido)');
assert.strictEqual(monotonicViolations, 0, 'el orden cronologico dentro de cada lote no debe violarse');

console.log('GR OK — total antes:', totalAntes, '| total despues:', totalDespues, '| auto:', autoTrue, '| violaciones de orden:', monotonicViolations);
```

- [ ] **Step 2: Correr y confirmar**

```bash
cd "<scratchpad>/verify" && node gr_migracion.js
```

Expected: `GR OK — total antes: 135 | total despues: 135 | auto: 135 | violaciones de orden: 0`.

- [ ] **Step 3: Implementar `_grNotaId` y `_grMigrarNotasUnificadasV1` en `gr/gr_app.js`**

Insertar cerca de `grTimestamp` (`gr/gr_app.js:3216`):

```js
function _grNotaId() {
    return 'nt_gr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}
var GR_EVENT_TIPOS = { inoculacion: true, contaminacion: true, colonizacion: true, 'frascos-gr': true };
```

Insertar cerca de `_migrarInoculoSourceNull` (`gr/gr_app.js:3354`, antes de esa función):

```js
    function _grMigrarNotasUnificadasV1() {
        var MIGRACION_KEY = 'biolab_migracion_gr_notas_unificadas_v1';
        try {
            if (localStorage.getItem(MIGRACION_KEY) === '1') return;
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) { localStorage.setItem(MIGRACION_KEY, '1'); return; }
            var lotes = JSON.parse(raw);
            if (!Array.isArray(lotes)) { localStorage.setItem(MIGRACION_KEY, '1'); return; }
            lotes.forEach(function(lote) {
                if (!Array.isArray(lote.seguimientoNotas)) return;
                var anchor = lote.fecha ? new Date(lote.fecha + 'T00:00:00') : null;
                lote.seguimientoNotas.forEach(function(n) {
                    if (!n.id) n.id = _grNotaId();
                    if (typeof n.auto !== 'boolean') {
                        var hasEventTipo = n.tipo && GR_EVENT_TIPOS[n.tipo];
                        var hasManualFields = ('fechaHora' in n) || ('frascos' in n) || ('dias' in n);
                        n.auto = !!hasEventTipo && !hasManualFields;
                    }
                    if (n.tipo === undefined) n.tipo = null;
                    if (n.editedAt === undefined) n.editedAt = null;
                    if (!Array.isArray(n.imagenes)) n.imagenes = [];
                    if (n.fechaHora) {
                        n.tsLegacy = n.ts;
                        n.ts = n.fechaHora;
                        n.tsInferred = false;
                    } else {
                        var m = /^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/.exec(n.ts || '');
                        if (m && anchor) {
                            var dd = parseInt(m[1], 10), mo = parseInt(m[2], 10), hh = parseInt(m[3], 10), mi = parseInt(m[4], 10);
                            var y = anchor.getFullYear();
                            var candidato;
                            for (var tries = 0; tries < 3; tries++) {
                                candidato = new Date(y, mo - 1, dd, hh, mi);
                                if (candidato >= anchor) break;
                                y++;
                            }
                            n.tsLegacy = n.ts;
                            n.ts = candidato.toISOString();
                            n.tsInferred = true;
                        } else if (n.tsInferred === undefined) {
                            n.tsLegacy = n.tsLegacy || null;
                            n.tsInferred = false;
                        }
                    }
                });
            });
            localStorage.setItem(STORAGE_KEY, JSON.stringify(lotes));
            localStorage.setItem(MIGRACION_KEY, '1');
        } catch (e) {
            console.error('[GR] Error en migración de notas unificadas:', e);
        }
    }
```

- [ ] **Step 4: Enganchar en `grInit` (`gr/gr_app.js:3885`)**

```js
    _migrarInoculoSourceNull();
    _grMigrarNotasUnificadasV1();
```

- [ ] **Step 5: Commit**

```bash
git add gr/gr_app.js
git commit -m "feat(gr): migracion one-shot de seguimientoNotas, reconcilia 2 escritores y ts sin año"
```

---

## Task 11: GR — escritores/render/editar al shape nuevo

**Files:**
- Modify: `gr/gr_app.js:2774-2796` (`grRegistrarSeguimiento`), `:3261-3326` (render/add/eliminar)

- [ ] **Step 1: Reescribir `grRegistrarSeguimiento` — `ts` ISO real, ya no usa `grTimestamp()`**

```js
    function grRegistrarSeguimiento(tipo, mensaje, emoji) {
        var estado = 'none';
        if (emoji === '🟡') estado = 'yellow';
        else if (emoji === '🔴') estado = 'red';
        else if (emoji === '🟢') estado = 'green';

        var existing = GR.seguimientoNotas || [];

        existing.push({
            id: _grNotaId(),
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

        GR.seguimientoNotas = existing;
        window.grRenderSeguimientoNotas();
    }
```

- [ ] **Step 2: Reescribir `grAddSeguimientoNota` — deja de usar `fechaHora` (redundante con `ts`, ya documentado como tal antes de esta unificación)**

```js
window.grAddSeguimientoNota = function() {
    var input = document.getElementById('grSeguimientoNotaInput');
    var estadoSel = document.getElementById('grSeguimientoEstado');
    var frascosInput = document.getElementById('grSeguimientoFrascos');
    if (!input) return;
    var texto = (input.value || '').trim();
    if (!texto) { alert('Escribí una nota antes de agregar.'); return; }
    var estado = estadoSel ? (estadoSel.value || 'none') : 'none';
    var frascos = frascosInput ? (parseInt(frascosInput.value, 10) || 0) : 0;
    var dias = 0;
    try {
        var fechaInoc = (GR && GR.fechaInoculacion) || null;
        if (fechaInoc) {
            var ms = Date.now() - new Date(fechaInoc).getTime();
            if (ms > 0) dias = Math.floor(ms / 86400000);
        }
    } catch (e) {}
    if (!Array.isArray(GR.seguimientoNotas)) GR.seguimientoNotas = [];
    GR.seguimientoNotas.push({
        id: _grNotaId(),
        ts: new Date().toISOString(),
        tsLegacy: null,
        tsInferred: false,
        tipo: null,
        texto: texto,
        estado: estado,
        auto: false,
        editedAt: null,
        imagenes: [],
        frascos: frascos,
        dias: dias
    });
    input.value = '';
    if (estadoSel) estadoSel.value = 'none';
    if (frascosInput) frascosInput.value = '0';
    window.grRenderSeguimientoNotas();
};
```

- [ ] **Step 3: Reescribir `grRenderSeguimientoNotas` y `grEliminarSeguimientoNota`**

```js
window.grRenderSeguimientoNotas = function() {
    var cont = document.getElementById('grSeguimientoNotas');
    if (!cont) return;
    var notas = Array.isArray(GR.seguimientoNotas) ? GR.seguimientoNotas : [];
    if (!notas.length) { cont.innerHTML = ''; return; }
    var colorEstado = function(e) {
        return e === 'green'  ? '#70AD47'
             : e === 'yellow' ? '#FFC107'
             : e === 'red'    ? '#C00000'
             : '#888';
    };
    cont.innerHTML = notas.map(function(n) {
        var col = colorEstado(n.estado);
        var meta = [];
        if (typeof n.frascos === 'number' && n.frascos > 0) meta.push(n.frascos + ' ' + _grUds());
        if (typeof n.dias === 'number' && n.dias > 0) meta.push(n.dias + ' días');
        if (n.tipo) meta.push(n.tipo);
        var metaStr = meta.length ? ' · <span style="color:var(--tx2)">' + meta.join(' · ') + '</span>' : '';
        var displayTs = _grFmtFechaHora(n.ts) + (n.tsInferred ? ' ~' : '');
        var idAttr = esc(n.id || '');
        return '<div class="gr-seg-entry" id="gr-seg-entry-' + idAttr + '" style="padding:10px 12px;margin-bottom:8px;background:var(--bg,#1D1D1D);border-left:3px solid ' + col + ';border-radius:6px;color:var(--tx,#F5F5F5);position:relative;">'
            + '<div class="nota-time" style="font-size:0.78rem;color:' + col + ';font-weight:600;margin-bottom:4px">' + displayTs + metaStr + '</div>'
            + '<div class="nota-text" id="gr-seg-text-' + idAttr + '" style="font-size:0.92rem;color:var(--tx,#F5F5F5)">' + esc(n.texto || '') + (n.editedAt ? ' <span style="opacity:.6">✦</span>' : '') + '</div>'
            + '<div style="position:absolute;top:8px;right:8px;display:flex;gap:4px">'
            + '<button onclick="grEditarSeguimientoNota(\'' + idAttr + '\')" style="background:transparent;border:none;color:var(--tx2);cursor:pointer;font-size:0.85rem;padding:2px 4px;" title="Editar">✏️</button>'
            + '<button onclick="grEliminarSeguimientoNota(\'' + idAttr + '\')" style="background:transparent;border:none;color:var(--tx2);cursor:pointer;font-size:0.9rem;padding:2px 6px;" title="Eliminar nota">✕</button>'
            + '</div>'
            + '</div>';
    }).join('');
};

window.grEliminarSeguimientoNota = function(notaId) {
    if (!Array.isArray(GR.seguimientoNotas)) return;
    GR.seguimientoNotas = GR.seguimientoNotas.filter(function(n) { return n.id !== notaId; });
    window.grRenderSeguimientoNotas();
};
```

- [ ] **Step 4: Agregar `grEditarSeguimientoNota`/`grGuardarEdicionSeguimientoNota`/`grCancelarEdicionSeguimientoNota`**

Justo después de `grEliminarSeguimientoNota`:

```js
window.grEditarSeguimientoNota = function(notaId) {
    var txtEl = document.getElementById('gr-seg-text-' + notaId);
    if (!txtEl) return;
    var original = txtEl.textContent.replace(/\s*✦\s*$/, '');
    txtEl.innerHTML = '<input type="text" id="gr-seg-edit-' + notaId + '" value="' + esc(original) + '"'
        + ' style="width:100%;background:var(--bg-tertiary,#3D3D3D);border:1px solid #2196F3;color:var(--tx,#F5F5F5);padding:4px 8px;border-radius:4px;font-size:inherit;box-sizing:border-box"'
        + ' onkeydown="if(event.key===\'Enter\')grGuardarEdicionSeguimientoNota(\'' + notaId + '\');if(event.key===\'Escape\')grCancelarEdicionSeguimientoNota(\'' + notaId + '\',\'' + esc(original) + '\')">';
    var input = document.getElementById('gr-seg-edit-' + notaId);
    if (input) { input.focus(); input.select(); }
};

window.grGuardarEdicionSeguimientoNota = function(notaId) {
    var input = document.getElementById('gr-seg-edit-' + notaId);
    if (!input) return;
    var nuevo = input.value.trim();
    if (!nuevo) return;
    if (!Array.isArray(GR.seguimientoNotas)) return;
    var nota = GR.seguimientoNotas.find(function(n) { return n.id === notaId; });
    if (!nota) return;
    nota.texto = nuevo;
    nota.editedAt = new Date().toISOString();
    window.grRenderSeguimientoNotas();
};

window.grCancelarEdicionSeguimientoNota = function(notaId, original) {
    var txtEl = document.getElementById('gr-seg-text-' + notaId);
    if (txtEl) txtEl.textContent = original;
};
```

- [ ] **Step 5: Verificación manual en navegador**

Ir a GR, abrir un lote real con notas (ej. `GR113`, 11 notas):
1. Confirmar que las 11 notas viejas se ven con fecha correcta (sin "Invalid Date"), año 2026.
2. Editar una nota → confirmar que persiste.
3. Borrar una nota → confirmar que no vuelve.
4. Disparar un evento auto real (marcar contaminados en una fila DG) → confirmar nota nueva con `ts` de hoy.
5. Guardar el lote completo (botón de guardar del formulario) → recargar la página → reabrir el lote → confirmar que todo (incluida la edición/borrado) persistió en `localStorage`.
6. Console sin errores nuevos.

- [ ] **Step 6: Commit**

```bash
git add gr/gr_app.js
git commit -m "feat(gr): grRegistrarSeguimiento/grAddSeguimientoNota producen shape unificado, agrega editar"
```

---

## Task 12: Verificación cross-módulo en navegador real contra el backup completo

**Files:**
- Create (scratchpad): `verify/browser_check.js`

- [ ] **Step 1: Escribir el driver de Playwright**

`verify/browser_check.js`:
```js
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

(async () => {
  const backupPath = path.join(__dirname, 'fixtures', 'backup.json');
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  delete backup.bl2_gh; // nunca cargar el token de GitHub en un perfil descartable

  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true
  });
  const page = await browser.newPage();

  const errors = [];
  page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('[console] ' + msg.text()); });

  await page.goto('http://localhost:8000/');
  await page.evaluate((data) => {
    Object.keys(data).forEach((k) => localStorage.setItem(k, data[k]));
  }, backup);

  const modules = ['CI', 'GR', 'SU', 'FR'];
  for (const mod of modules) {
    await page.goto('http://localhost:8000/#' + mod);
    await page.waitForTimeout(1500);
  }

  await browser.close();

  console.log('Errores encontrados:', errors.length);
  errors.forEach((e) => console.log(' -', e));
  process.exit(errors.length > 0 ? 1 : 0);
})();
```

- [ ] **Step 2: Levantar el servidor local en otra terminal**

```bash
cd "c:\Users\JET\Desktop\MOBY DICK\biolab-app" && python -m http.server 8000
```

- [ ] **Step 3: Correr el driver**

```bash
cd "<scratchpad>/verify" && node browser_check.js
```

Expected: `Errores encontrados: 0`. Si hay errores nuevos (comparar contra los 2 ya conocidos y preexistentes — `cilab_auditor.js` y `biolab_ingredientes v4.json`, ambos 404 sin relación con este trabajo, documentados en CLAUDE.md), investigar antes de continuar — no asumir que un error nuevo es inofensivo.

- [ ] **Step 4: Verificación manual final — recorrido completo de las 4 UI nuevas**

Con el mismo servidor corriendo y el backup ya sembrado (dejar la pestaña de Chrome abierta desde el script, o repetir el seed manual vía devtools console con el snippet del Step 1 de este task):
1. CI: abrir `CI-0004`, confirmar timeline completo, editar+borrar una nota.
2. GR: abrir `GR113`, confirmar timeline completo, editar+borrar una nota.
3. SU: abrir un lote con `dbSeguimiento`, confirmar timeline completo, editar+borrar una nota.
4. FR: abrir una bolsa con observaciones, confirmar timeline completo, editar+borrar una nota.
5. Confirmar que ninguna de las 4 migraciones one-shot vuelve a correr en un segundo `F5` (revisar en devtools → Application → Local Storage que los 4 flags `biolab_migracion_*_notas_unificadas_v1` quedaron en `'1'`).

- [ ] **Step 5: Reportar resultados al usuario antes de dar la tarea por cerrada**

No marcar como "listo" sin este paso — mostrar el output real de los 4 scripts Node (`fr_migracion.js`, `su_migracion.js`, `ci_migracion.js`, `gr_migracion.js`) y del `browser_check.js`, con sus conteos antes/después, como evidencia (Regla de este proyecto: nunca declarar hecho sin evidencia).

---

## Task 13: Documentar el nuevo invariante en `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md` (raíz de `biolab-app/`)

- [ ] **Step 1: Agregar una sección nueva después de "EXTRAS DE EXPERIMENTOS" (o donde el usuario prefiera, siguiendo el patrón de secciones existentes) documentando:**
  - El shape unificado (`id`/`ts`/`tsLegacy`/`tsInferred`/`texto`/`estado`/`auto`/`tipo`/`editedAt`/`imagenes`) y que cada módulo sigue escribiendo a su propia key.
  - Los 3 escritores de `bl2_seg_notas` (CI ×2 + CILAB ×1) y por qué el array no está en orden cronológico.
  - El algoritmo de reconstrucción de `ts` (ancla al padre real: `bl2_forms[formulaId].fecha` en CI, `lote.fecha` en GR) para que una futura sesión no repita la exploración de este plan desde cero.
  - La baja de `SU.reNotas`.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: documenta el shape unificado de notas de seguimiento y sus invariantes"
```

---

## Self-Review (completado durante la escritura de este plan)

**Cobertura del spec:** shape unificado (Task 2-11, todas las migraciones + escritores), capacidades de UI parejas (Task 3-4, 7, 9, 11 agregan editar donde faltaba y borrar en FR), migración con evidencia empírica (Tasks 2/6/8/10, cada una con script Node validado contra el backup real antes de tocar el archivo real), lectura defensiva (los fallbacks `typeof o.auto === 'boolean' ? ... : ...` en render de FR, y el hecho de que ninguna migración asume que las demás ya corrieron), fuera de alcance respetado (CILAB Conocimiento no se toca en ningún task), SU.reNotas incorporado como limpieza (Task 5). Sin gaps encontrados.

**Placeholders:** ninguno — cada step tiene código completo y real, sin "TODO"/"agregar validación acá"/genéricos.

**Consistencia de tipos:** `_frNotaId`/`_suNotaId`/`_ciNotaId`/`_grNotaId` con la misma firma en los 4 módulos. `estado`/`auto`/`tipo`/`editedAt`/`imagenes`/`tsLegacy`/`tsInferred` con el mismo nombre y semántica en las 4 migraciones y los 4 conjuntos de escritores/render. Los nombres de función nuevos (`FR.deleteObs`/`startEditObs`/`saveEditObs`/`cancelEditObs`, `suDbEditarSeguimientoNota`/`suDbGuardarEdicionSeguimientoNota`/`suDbCancelarEdicionSeguimientoNota`, `grEditarSeguimientoNota`/`grGuardarEdicionSeguimientoNota`/`grCancelarEdicionSeguimientoNota`) se usan de forma consistente entre la definición (Steps de implementación) y los `onclick` generados en el render de cada módulo — verificado cruzando cada Task contra la Task de render correspondiente.
