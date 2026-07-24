# SU · Aditivos con ID de catálogo — Prerequisito MEJ-0006 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deduplicar `su_biblioteca.materiales`, agregar campos `rangoOptimo`/`rangoSeguro` al schema de material, y hacer que `su_lotes[].aditivos[]` referencie un `id` de catálogo estable (con migración one-shot para históricos) — sin tocar CI, CILAB, ni `bl2_ings`. Es el prerequisito de MEJ-0006 (`docs/lab-intelligence/mejoras_app.md`, pasos 1-4 del plan documentado ahí).

**Architecture:** Todo el trabajo vive en `su/su_app.js` (IIFE existente). Dos migraciones one-shot nuevas siguiendo el patrón ya establecido en `fr_app.js`/`gr_app.js` (`_migrarFrInoculoSourceNull`, flag en `localStorage` con sufijo `_v1`, no-op si ya corrió). Orden de carga: `cargarBibliotecaDesdeStorage()` corre antes que `cargarLotesDesdeStorage()` (confirmado en `SU.init`, `su_app.js:152-153`) — la dedup de catálogo debe completarse antes del backfill de `aditivo.id`, porque el backfill matchea contra el catálogo ya deduplicado.

**Tech Stack:** JS vanilla, sin build step, sin test runner (verificación manual vía `node -e` contra el JSON de export real y prueba en navegador).

**Contexto verificado (no asumido) contra `biolab-backup-2026-07-14.json`:**
- `su_biblioteca.materiales` real tiene 7 legacy (`MAT-01`..`MAT-07`) + 9 actuales (`ING-SU-001..007`, `ING-SU-015..018`; no hay 008-014, gap real, no tocar).
- Duplicados por nombre EXACTO: Fibra de coco seca (MAT-01/ING-SU-001), Vermiculita (MAT-02/ING-SU-003), Cal agrícola (MAT-04/ING-SU-007), Café molido (MAT-05/ING-SU-005), **y también Salvado de trigo (MAT-06/ING-SU-006)** — este último no lo mencionó el usuario pero es un duplicado exacto real, se incluye.
- `MAT-03` "Yeso (CaSO4)" y `MAT-07` "Agua" NO tienen duplicado exacto por nombre (ING-SU-004 es "Yeso", ING-SU-002 es "Agua hirviendo" — strings distintos). Se preservan tal cual: la dedup filtra por coincidencia exacta de `nombre`, no por prefijo de `id` a ciegas — evita borrar materiales que no son técnicamente duplicados aunque el usuario los agrupó conceptualmente.
- 13 de 25 `su_lotes` tienen `aditivos[]` no vacío. Ningún objeto aditivo real tiene hoy `id` (confirmado, 0/N). Los 4 `nombre` únicos usados en datos reales (`Café molido`, `Yerba mate usada humeda`, `Jugo de grano de Maiz`, `Levadura de cerveza`) tienen match exacto en el set `ING-SU-*` (`ING-SU-005`, `ING-SU-015`, `ING-SU-016`, `ING-SU-017`) — el backfill matcheará el 100% de los datos reales existentes.
- Guard adicional: la dedup de `MAT-*` sólo corre si el catálogo YA tiene al menos un `ING-SU-*` (evita vaciar el catálogo en una instalación nueva que sólo tuviera el seed legacy de `bibliotecaDefault`, escenario que no aplica a los datos reales de este usuario pero es una salvaguarda barata).

---

### Task 1: Migración one-shot de biblioteca — dedup + campos rangoOptimo/rangoSeguro

**Files:**
- Modify: `su/su_app.js:539-547` (`cargarBibliotecaDesdeStorage`)

- [ ] **Step 1: Escribir la función de migración, justo antes de `cargarBibliotecaDesdeStorage`**

Insertar antes de la línea `function cargarBibliotecaDesdeStorage() {` (línea 539):

```javascript
// Migración one-shot: dedup de su_biblioteca.materiales (dos generaciones de catálogo
// superpuestas por nombre: legacy MAT-01..07 vs actual ING-SU-001..018) + agrega
// rangoOptimo/rangoSeguro (null default) a cada material. Prerequisito MEJ-0006.
// Solo corre si el catálogo ya tiene al menos un ING-SU-* (si no, no hay nada que
// deduplicar todavía — evita vaciar el catálogo en una instalación sin ese set).
function _suMigrarBibliotecaDedup(bib) {
    var KEY_MIG = 'biolab_migracion_su_biblioteca_dedup_v1';
    try {
        if (localStorage.getItem(KEY_MIG) === '1') return false;
    } catch (e) { return false; }

    var cambiado = false;
    try {
        var materiales = bib.materiales || [];
        var tieneING = materiales.some(function(m) { return m.id && m.id.indexOf('ING-SU-') === 0; });

        if (tieneING) {
            var nombresING = {};
            materiales.forEach(function(m) {
                if (m.id && m.id.indexOf('ING-SU-') === 0) nombresING[m.nombre] = true;
            });
            var antes = materiales.length;
            materiales = materiales.filter(function(m) {
                var esLegacyDuplicado = m.id && m.id.indexOf('MAT-') === 0 && nombresING[m.nombre];
                return !esLegacyDuplicado;
            });
            if (materiales.length !== antes) {
                cambiado = true;
                console.log('[SU] Migración dedup biblioteca: ' + (antes - materiales.length) + ' materiales legacy duplicados eliminados');
            }
        }

        materiales.forEach(function(m) {
            if (!('rangoOptimo' in m)) { m.rangoOptimo = null; cambiado = true; }
            if (!('rangoSeguro' in m)) { m.rangoSeguro = null; cambiado = true; }
        });

        bib.materiales = materiales;
        try { localStorage.setItem(KEY_MIG, '1'); } catch (e) {}
    } catch (e) {
        console.error('[SU] Error en migración dedup biblioteca:', e);
        return false;
    }
    return cambiado;
}
```

- [ ] **Step 2: Enganchar la migración en `cargarBibliotecaDesdeStorage`**

Reemplazar (líneas 539-547):

```javascript
function cargarBibliotecaDesdeStorage() {
    const stored = localStorage.getItem(SU_BIBLIOTECA_KEY);
    if (stored) {
        biblioteca = JSON.parse(stored);
    } else {
        biblioteca = { ...bibliotecaDefault };
        guardarBiblioteca();
    }
}
```

Por:

```javascript
function cargarBibliotecaDesdeStorage() {
    const stored = localStorage.getItem(SU_BIBLIOTECA_KEY);
    if (stored) {
        biblioteca = JSON.parse(stored);
    } else {
        biblioteca = { ...bibliotecaDefault };
        guardarBiblioteca();
    }
    if (_suMigrarBibliotecaDedup(biblioteca)) {
        guardarBiblioteca();
    }
}
```

- [ ] **Step 3: Verificar contra el export real (no en el navegador todavía)**

Correr en la carpeta del repo:

```bash
node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('biolab-backup-2026-07-14.json', 'utf8'));
let bib = data['su_biblioteca'];
if (typeof bib === 'string') bib = JSON.parse(bib);

function migrar(bib) {
    var materiales = bib.materiales || [];
    var tieneING = materiales.some(m => m.id && m.id.indexOf('ING-SU-') === 0);
    if (tieneING) {
        var nombresING = {};
        materiales.forEach(m => { if (m.id && m.id.indexOf('ING-SU-') === 0) nombresING[m.nombre] = true; });
        materiales = materiales.filter(m => !(m.id && m.id.indexOf('MAT-') === 0 && nombresING[m.nombre]));
    }
    materiales.forEach(m => { if (!('rangoOptimo' in m)) m.rangoOptimo = null; if (!('rangoSeguro' in m)) m.rangoSeguro = null; });
    bib.materiales = materiales;
    return bib;
}

const resultado = migrar(bib);
console.log('total materiales tras dedup:', resultado.materiales.length);
console.log('ids restantes:', resultado.materiales.map(m => m.id).join(', '));
console.log('MAT- restantes (deberian ser MAT-03 y MAT-07 solamente):', resultado.materiales.filter(m => m.id.indexOf('MAT-') === 0).map(m => m.id + ' ' + m.nombre));
console.log('todos tienen rangoOptimo/rangoSeguro:', resultado.materiales.every(m => 'rangoOptimo' in m && 'rangoSeguro' in m));
"
```

Expected:
```
total materiales tras dedup: 11
ids restantes: MAT-03, MAT-07, ING-SU-001, ING-SU-002, ING-SU-003, ING-SU-004, ING-SU-005, ING-SU-006, ING-SU-007, ING-SU-015, ING-SU-016, ING-SU-017, ING-SU-018
```
(11 no cierra con el conteo de ids listados — recontar a mano: 2 MAT- + 9 ING-SU- = 11. Confirmar que la lista de ids impresa tiene exactamente esos 11 y que `MAT- restantes` imprime solo `MAT-03 Yeso (CaSO4)` y `MAT-07 Agua`.)

Si el resultado no coincide, no seguir al Task 2 — revisar la función antes de tocar código del navegador.

- [ ] **Step 4: Commit**

```bash
git add su/su_app.js
git commit -m "feat(su): migracion one-shot dedup de su_biblioteca.materiales + campos rangoOptimo/rangoSeguro"
```

---

### Task 2: Aditivos referencian `id` de catálogo (UI + recolección)

**Files:**
- Modify: `su/su_app.js:1345-1365` (`agregarFilaAditivo`)
- Modify: `su/su_app.js:686-736` (`recolectarDatosLote`)
- Modify: `su/su_app.js:811` (call site en `cargarDatosLote`)

- [ ] **Step 1: Reescribir `agregarFilaAditivo` para usar `id` como value, preservando `nombre` como fallback si el `id` no matchea ningún material del catálogo (referencia rota — material borrado o dato huérfano)**

Reemplazar (líneas 1345-1365):

```javascript
function agregarFilaAditivo(nombre = '', cantidad = 0) {
    const container = document.getElementById('aditivosContainer');
    const row = document.createElement('div');
    row.className = 'aditivo-row';
    
    const opciones = biblioteca.materiales
        .filter(m => m.tipo === 'aditivo' || m.tipo === 'nutricion')
        .map(m => `<option value="${m.nombre}" ${m.nombre === nombre ? 'selected' : ''}>${m.nombre}</option>`)
        .join('');
    
    row.innerHTML = `
        <select class="aditivo-select" onchange="calcularSU()">
            <option value="">-- Seleccionar --</option>
            ${opciones}
        </select>
        <input type="number" class="aditivo-cant" value="${cantidad}" min="0" step="0.1" placeholder="g" oninput="calcularSU()">
        <button type="button" class="btn-remove" onclick="this.parentElement.remove(); calcularSU()">✕</button>
    `;
    
    container.appendChild(row);
}
```

Por:

```javascript
function agregarFilaAditivo(id = '', cantidad = 0, nombreLegacy = '') {
    const container = document.getElementById('aditivosContainer');
    const row = document.createElement('div');
    row.className = 'aditivo-row';

    const matchExiste = biblioteca.materiales.some(m => m.id === id);

    const opciones = biblioteca.materiales
        .filter(m => m.tipo === 'aditivo' || m.tipo === 'nutricion')
        .map(m => `<option value="${m.id}" data-nombre="${cfgEscapeHtml(m.nombre)}" ${m.id === id ? 'selected' : ''}>${cfgEscapeHtml(m.nombre)}</option>`)
        .join('');

    // Referencia rota: el id no matchea nada del catálogo actual pero hay un nombre legacy
    // (dato histórico pre-migración, o material borrado del catálogo después de guardarse).
    // Se muestra como opción huérfana para no perder el dato al re-guardar el lote.
    const opcionHuerfana = (!matchExiste && nombreLegacy)
        ? `<option value="" data-nombre="${cfgEscapeHtml(nombreLegacy)}" selected>${cfgEscapeHtml(nombreLegacy)} (no en catálogo)</option>`
        : '';

    row.innerHTML = `
        <select class="aditivo-select" onchange="calcularSU()">
            <option value="">-- Seleccionar --</option>
            ${opcionHuerfana}
            ${opciones}
        </select>
        <input type="number" class="aditivo-cant" value="${cantidad}" min="0" step="0.1" placeholder="g" oninput="calcularSU()">
        <button type="button" class="btn-remove" onclick="this.parentElement.remove(); calcularSU()">✕</button>
    `;

    container.appendChild(row);
}
```

Nota: `cfgEscapeHtml` ya existe en este archivo (`su_app.js:2010`, usado por la tabla de biblioteca en CFG) — se reutiliza, no se duplica.

- [ ] **Step 2: Actualizar `recolectarDatosLote` para leer `id` + `nombre` del select (vía `data-nombre` de la opción seleccionada, no del `value`)**

Reemplazar (líneas 697-705):

```javascript
    // Recolectar aditivos
    const aditivos = [];
    document.querySelectorAll('.aditivo-row').forEach(row => {
        const nombre = row.querySelector('.aditivo-select').value;
        const cantidad = parseFloat(row.querySelector('.aditivo-cant').value) || 0;
        if (nombre && cantidad > 0) {
            aditivos.push({ nombre, cantidad });
        }
    });
```

Por:

```javascript
    // Recolectar aditivos — value del select es el id de catálogo; el nombre se lee
    // del data-nombre de la opción seleccionada (se preserva incluso si el id quedó
    // huérfano por un material borrado del catálogo, ver agregarFilaAditivo).
    const aditivos = [];
    document.querySelectorAll('.aditivo-row').forEach(row => {
        const select = row.querySelector('.aditivo-select');
        const id = select.value;
        const opt = select.options[select.selectedIndex];
        const nombre = opt ? (opt.dataset.nombre || '') : '';
        const cantidad = parseFloat(row.querySelector('.aditivo-cant').value) || 0;
        if (nombre && cantidad > 0) {
            aditivos.push(id ? { id, nombre, cantidad } : { nombre, cantidad });
        }
    });
```

- [ ] **Step 3: Actualizar el call site de carga de lote (`cargarDatosLote`) para pasar `id` + `nombre` legacy**

Reemplazar (línea 811):

```javascript
            agregarFilaAditivo(aditivo.nombre, aditivo.cantidad);
```

Por:

```javascript
            agregarFilaAditivo(aditivo.id, aditivo.cantidad, aditivo.nombre);
```

- [ ] **Step 4: Probar manualmente en navegador**

1. Abrir la app, ir a SU.
2. Crear un lote nuevo, agregar un aditivo del dropdown (ej. "Café molido"), cantidad 50, guardar.
3. Exportar el lote (botón exportar JSON, o inspeccionar `localStorage.getItem('su_lotes')` desde devtools) y confirmar que el aditivo guardado tiene `{ id: "ING-SU-005", nombre: "Café molido", cantidad: 50 }`.
4. Recargar el lote (selector de lotes) y confirmar que el dropdown de aditivo vuelve a mostrar "Café molido" seleccionado (no "-- Seleccionar --").
5. Re-guardar sin tocar el aditivo y confirmar que `id`/`nombre`/`cantidad` no cambiaron.

Expected: los 3 campos persisten correctos en las 3 vueltas (crear → exportar/inspeccionar → recargar → re-guardar).

- [ ] **Step 5: Commit**

```bash
git add su/su_app.js
git commit -m "feat(su): aditivos referencian id de catalogo en vez de solo nombre"
```

---

### Task 3: Migración one-shot — backfill de `id` en `su_lotes[].aditivos[]` históricos

**Files:**
- Modify: `su/su_app.js:557-567` (`cargarLotesDesdeStorage`)

- [ ] **Step 1: Escribir la función de migración, antes de `cargarLotesDesdeStorage`**

Insertar antes de la línea `function cargarLotesDesdeStorage() {` (línea 557):

```javascript
// Migración one-shot: backfillea aditivo.id en su_lotes históricos matcheando por
// nombre exacto contra el catálogo ya deduplicado (ver _suMigrarBibliotecaDedup).
// Debe correr DESPUÉS de que la biblioteca esté deduplicada — cargarBibliotecaDesdeStorage()
// corre antes que esta función en SU.init, así que biblioteca.materiales ya está lista.
// Si un nombre no matchea ningún material (referencia rota / material borrado), el
// aditivo se deja tal cual (sin id) — no se inventa ni se descarta el dato.
function _suMigrarAditivosId(arr) {
    var KEY_MIG = 'biolab_migracion_su_aditivos_id_v1';
    try {
        if (localStorage.getItem(KEY_MIG) === '1') return false;
    } catch (e) { return false; }

    var cambiado = false;
    try {
        var porNombre = {};
        (biblioteca.materiales || []).forEach(function(m) {
            if (!(m.nombre in porNombre)) porNombre[m.nombre] = m.id;
        });

        var backfillCount = 0;
        var sinMatch = 0;
        (arr || []).forEach(function(lote) {
            if (!Array.isArray(lote.aditivos)) return;
            lote.aditivos.forEach(function(a) {
                if (a.id) return;
                var idMatch = porNombre[a.nombre];
                if (idMatch) {
                    a.id = idMatch;
                    backfillCount++;
                    cambiado = true;
                } else {
                    sinMatch++;
                }
            });
        });

        console.log('[SU] Migración backfill aditivo.id: ' + backfillCount + ' aditivos actualizados, ' + sinMatch + ' sin match (quedan sin id, nombre/cantidad preservados)');
        try { localStorage.setItem(KEY_MIG, '1'); } catch (e) {}
    } catch (e) {
        console.error('[SU] Error en migración backfill aditivo.id:', e);
        return false;
    }
    return cambiado;
}
```

- [ ] **Step 2: Enganchar la migración en `cargarLotesDesdeStorage`, después de la migración de UUIDs existente**

Reemplazar (líneas 557-567):

```javascript
function cargarLotesDesdeStorage() {
    const stored = localStorage.getItem(SU_STORAGE_KEY);
    if (stored) {
        lotesData = JSON.parse(stored);
    }
    // Migración silenciosa: asignar _uuid a registros históricos sin él
    if (_suMigrarUUIDs(lotesData)) {
        localStorage.setItem(SU_STORAGE_KEY, JSON.stringify(lotesData));
    }
    actualizarSelectorLotes();
}
```

Por:

```javascript
function cargarLotesDesdeStorage() {
    const stored = localStorage.getItem(SU_STORAGE_KEY);
    if (stored) {
        lotesData = JSON.parse(stored);
    }
    // Migración silenciosa: asignar _uuid a registros históricos sin él
    var uuidsCambiaron = _suMigrarUUIDs(lotesData);
    var aditivosCambiaron = _suMigrarAditivosId(lotesData);
    if (uuidsCambiaron || aditivosCambiaron) {
        localStorage.setItem(SU_STORAGE_KEY, JSON.stringify(lotesData));
    }
    actualizarSelectorLotes();
}
```

- [ ] **Step 3: Verificar contra el export real (no en el navegador todavía)**

Correr en la carpeta del repo:

```bash
node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('biolab-backup-2026-07-14.json', 'utf8'));
let bib = data['su_biblioteca'];
if (typeof bib === 'string') bib = JSON.parse(bib);
let lotes = data['su_lotes'];
if (typeof lotes === 'string') lotes = JSON.parse(lotes);

// Simular dedup de Task 1 primero
var materiales = bib.materiales || [];
var tieneING = materiales.some(m => m.id && m.id.indexOf('ING-SU-') === 0);
if (tieneING) {
    var nombresING = {};
    materiales.forEach(m => { if (m.id && m.id.indexOf('ING-SU-') === 0) nombresING[m.nombre] = true; });
    materiales = materiales.filter(m => !(m.id && m.id.indexOf('MAT-') === 0 && nombresING[m.nombre]));
}

// Backfill
var porNombre = {};
materiales.forEach(m => { if (!(m.nombre in porNombre)) porNombre[m.nombre] = m.id; });

var backfillCount = 0, sinMatch = 0;
var antesSnapshot = JSON.stringify(lotes.filter(l => Array.isArray(l.aditivos) && l.aditivos.length).map(l => ({id: l.id, aditivos: l.aditivos.map(a => ({nombre: a.nombre, cantidad: a.cantidad}))})));

lotes.forEach(lote => {
    if (!Array.isArray(lote.aditivos)) return;
    lote.aditivos.forEach(a => {
        if (a.id) return;
        var idMatch = porNombre[a.nombre];
        if (idMatch) { a.id = idMatch; backfillCount++; } else { sinMatch++; }
    });
});

console.log('backfilled:', backfillCount, 'sin match:', sinMatch);

// Confirmar preservación de nombre+cantidad
var despuesSnapshot = JSON.stringify(lotes.filter(l => Array.isArray(l.aditivos) && l.aditivos.length).map(l => ({id: l.id, aditivos: l.aditivos.map(a => ({nombre: a.nombre, cantidad: a.cantidad}))})));
console.log('nombre+cantidad preservados exactamente:', antesSnapshot === despuesSnapshot);

// Mostrar un lote de ejemplo con id ganado
var ejemplo = lotes.find(l => l.id === 'SU214');
console.log('SU214 aditivos tras backfill:', JSON.stringify(ejemplo.aditivos));
"
```

Expected:
```
backfilled: <N igual a la cantidad total de aditivos en los 13 lotes con aditivos>
sin match: 0
nombre+cantidad preservados exactamente: true
SU214 aditivos tras backfill: [{"nombre":"Café molido","cantidad":200,"id":"ING-SU-005"}]
```

Si `sin match` no es 0, o si `nombre+cantidad preservados exactamente` no es `true`, no seguir — revisar la función.

- [ ] **Step 4: Probar manualmente en navegador contra un lote real viejo**

1. Con la migración ya en el código (Tasks 1-3 aplicadas), recargar la app SU en el navegador (con los datos reales del usuario, no un dataset de prueba — el usuario ya tiene backup).
2. Abrir devtools console, confirmar el log `[SU] Migración backfill aditivo.id: N aditivos actualizados, 0 sin match`.
3. Confirmar `localStorage.getItem('biolab_migracion_su_aditivos_id_v1')` === `'1'`.
4. Recargar la página de nuevo (F5) y confirmar que el log de migración NO vuelve a aparecer (one-shot real, no solo por sesión).
5. Cargar el lote SU214 (o el que tenga aditivos reales) desde el selector, confirmar que el dropdown de aditivo muestra "Café molido" seleccionado correctamente (prueba end-to-end de que el `id` backfillado matchea el catálogo deduplicado de Task 1).
6. Inspeccionar `localStorage.getItem('su_lotes')`, confirmar que el aditivo de ese lote tiene ahora `id`, `nombre`, y `cantidad` — los tres, cantidad y nombre intactos vs. el valor pre-migración.

Expected: aditivo conserva `nombre`+`cantidad` originales y gana `id` correcto; migración corre exactamente una vez.

- [ ] **Step 5: Commit**

```bash
git add su/su_app.js
git commit -m "feat(su): migracion one-shot backfill de id en aditivos historicos"
```

---

## Self-Review (spec coverage)

- Paso 1 (dedup catálogo, verificar antes de borrar): Task 1, con verificación explícita en Step 3 contra el export real antes de tocar cualquier otra cosa — cumple "Confirmar antes de borrar que ningún su_lotes[].aditivos[] existente referencia esos IDs" (ya verificado en el contexto del plan: 0/N aditivos tienen `id` hoy).
- Paso 2 (rangoOptimo/rangoSeguro): cubierto en Task 1, mismo migración, no una función separada — son cambios al mismo objeto en la misma pasada, evita dos migraciones que reescriban `su_biblioteca` dos veces.
- Paso 3 (`value="${m.id}"` + `recolectarDatosLote` guarda `{id, nombre, cantidad}`): Task 2. `nombre` se preserva siempre (rule del usuario: "mantené nombre por compatibilidad con lecturas existentes") — confirmado en Step 2 de Task 2, `nombre` nunca se omite del objeto guardado.
- Paso 4 (migración one-shot backfill): Task 3, mismo patrón de flag que `_migrarFrInoculoSourceNull`/`_migrarInoculoSourceNull` citados como referencia de estilo.
- No se toca CI, CILAB, ni `bl2_ings` en ningún task — todos los cambios están en `su/su_app.js` únicamente.
- No se declara terminado sin evidencia: cada task tiene un paso de verificación contra datos reales (`node -e` contra el backup) antes del paso de prueba en navegador, y Task 3 explícitamente prueba el escenario pedido por el usuario ("cargar un lote viejo con aditivos pre-migración y confirmar que después de la migración conserva nombre+cantidad+gana id").
