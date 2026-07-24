# GR — Deuda técnica confirmada por auditoría Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corregir seis clases de deuda técnica confirmada por auditoría en el módulo GR — pérdida de datos en importación de biblioteca, dos handlers rotos referenciados desde el HTML, una migración reactiva innecesaria que enmascara un bug de escritura, una inconsistencia de fórmula entre KPI y registro, y una lista de código muerto con riesgo real (funciones de demo expuestas en `window`) — sin tocar CSS, sin tocar `grNormSources()`, y sin implementar la feature "Cerrar Protocolo".

**Architecture:** Todos los cambios son ediciones puntuales dentro de `gr/gr_app.js` (IIFE única, sin módulos ES) y `gr/gr_index.html` (HTML con `onclick`/`onchange` inline que llaman funciones expuestas en `window`). No hay build step: los archivos se sirven tal cual. La convención de exposición al scope global del archivo es una mezcla de `GR.x = window.x = function(){}` inline y un bloque final "EXPOSICIÓN AL SCOPE GLOBAL" (~línea 4293) que re-expone algunas funciones de forma auditable.

**Tech Stack:** Vanilla JS (IIFE), localStorage, no test framework — verificación es `node --check` para sintaxis + QA manual en navegador (este repo no tiene suite de tests automatizados).

---

### Task 1: Fix data loss — `importarJSON()` escribe la biblioteca en la key legacy incorrecta

**Files:**
- Modify: `gr/gr_app.js:1682`

**Contexto:** `BIBLIOTECA_KEY` (línea 16) vale `'gr_biblioteca'` y es la key que TODO el resto del módulo lee/escribe. Pero `importarJSON()` (rama "formato nuevo", cuando el JSON importado trae `data.biblioteca`) escribe en `'sustratos_biblioteca'` — la key legacy — dejando la biblioteca importada invisible tras el reload. Existe una migración one-shot `_migrarBibliotecaKey()` (dentro de `grInit()`, líneas 4272-4281) que copiaría `sustratos_biblioteca` → `gr_biblioteca`, pero solo corre si `gr_biblioteca` **no existe todavía** — en cualquier instalación real ya existe. **Decisión:** no se toca `_migrarBibliotecaKey()`. Corrigiendo la key de escritura de `importarJSON()`, las importaciones futuras van directo a `gr_biblioteca`.

- [ ] **Step 1: Corregir la key de escritura en `importarJSON()`**

Buscar:

```js
                    // Importar biblioteca si existe
                    if (data.biblioteca) {
                        GR.biblioteca = data.biblioteca;
                        localStorage.setItem('sustratos_biblioteca', JSON.stringify(GR.biblioteca));
                    }
```

Reemplazar por:

```js
                    // Importar biblioteca si existe
                    if (data.biblioteca) {
                        GR.biblioteca = data.biblioteca;
                        localStorage.setItem(BIBLIOTECA_KEY, JSON.stringify(GR.biblioteca));
                    }
```

- [ ] **Step 2: Chequeo de sintaxis**

Run: `node --check "gr/gr_app.js"`
Expected: sin output.

- [ ] **Step 3: Commit**

```bash
git add gr/gr_app.js
git commit -m "fix(gr): importarJSON escribia la biblioteca en la key legacy sustratos_biblioteca en vez de gr_biblioteca (BIBLIOTECA_KEY), quedando invisible tras reload"
```

---

### Task 2: Fix broken handler — remover botón "Cerrar Protocolo" (`grCerrarProtocolo()` no existe)

**Files:**
- Modify: `gr/gr_index.html:237`

**Contexto:** El botón llama `onclick="grCerrarProtocolo()"`, función inexistente → `ReferenceError` al click. La feature nunca se terminó: `GR.protoCerrado` se inicializa en `false` y se chequea como guard en tres lugares, pero nada lo pone en `true`. **Decisión ya tomada por el usuario: remover el botón, no implementar la feature.** No se toca `GR.protoCerrado` ni sus guards.

- [ ] **Step 1: Remover el botón "Cerrar Protocolo", dejando "Agregar Nota" intacto**

Buscar:

```html
                    <div style="display:flex;gap:10px">
                        <button class="gbtn gr" onclick="grAddProtoNota()" style="padding:10px 16px;border-radius:8px;border:none;background:#FFA000;color:#1D1D1D;font-weight:600;cursor:pointer">Agregar Nota</button>
                        <button id="grBtnCerrar" class="btn btn-s" style="padding:10px 16px;border-radius:8px;border:none;background:#70AD47;color:white;font-weight:600;cursor:pointer" onclick="grCerrarProtocolo()">Cerrar Protocolo</button>
                    </div>
```

Reemplazar por:

```html
                    <div style="display:flex;gap:10px">
                        <button class="gbtn gr" onclick="grAddProtoNota()" style="padding:10px 16px;border-radius:8px;border:none;background:#FFA000;color:#1D1D1D;font-weight:600;cursor:pointer">Agregar Nota</button>
                    </div>
```

- [ ] **Step 2: Revisión visual (no hay `node --check` para HTML)**

Abrir `gr/gr_index.html` y confirmar que el `<div id="grProtoCerrado" ...>` que sigue no fue tocado.

- [ ] **Step 3: Commit**

```bash
git add gr/gr_index.html
git commit -m "fix(gr): remover boton Cerrar Protocolo que llamaba a grCerrarProtocolo(), funcion inexistente (ReferenceError al click)"
```

---

### Task 3: Fix broken handler — exponer `actualizarTotalesCT()` en `window`

**Files:**
- Modify: `gr/gr_app.js:4293-4300`

**Contexto:** `actualizarTotalesCT()` se declara dentro de la IIFE y se invoca vía `onchange="actualizarTotalesCT()"` inline en `gr_index.html:128` y en filas CT dinámicas (`gr_app.js:837`), pero nunca se expone a `window`. El archivo tiene un bloque "EXPOSICIÓN AL SCOPE GLOBAL" al final que reexpone `grInit`/`addCtRow`/`importarJSON` con el patrón `window.x = (typeof x === 'function') ? x : window.x;` — se sigue el mismo patrón.

- [ ] **Step 1: Agregar `actualizarTotalesCT` al bloque de exposición global**

Buscar:

```js
window.grInit       = grInit;
window.addCtRow     = (typeof addCtRow === 'function') ? addCtRow : window.addCtRow;
window.importarJSON = (typeof importarJSON === 'function') ? importarJSON : window.importarJSON;
```

Reemplazar por:

```js
window.grInit       = grInit;
window.addCtRow     = (typeof addCtRow === 'function') ? addCtRow : window.addCtRow;
window.importarJSON = (typeof importarJSON === 'function') ? importarJSON : window.importarJSON;
window.actualizarTotalesCT = (typeof actualizarTotalesCT === 'function') ? actualizarTotalesCT : window.actualizarTotalesCT;
```

- [ ] **Step 2: Chequeo de sintaxis**

Run: `node --check "gr/gr_app.js"`
Expected: sin output.

- [ ] **Step 3: Commit**

```bash
git add gr/gr_app.js
git commit -m "fix(gr): exponer actualizarTotalesCT en window, requerida por onchange inline en HTML y filas CT dinamicas (ReferenceError al cambiar tipo seco/liquido)"
```

---

### Task 4: Fix `_migrarInoculoSourceNull()` — agregar guard one-shot y default `'LEGACY'` en escritura nueva

**Files:**
- Modify: `gr/gr_app.js:3745-3768` (función `_migrarInoculoSourceNull`)
- Modify: `gr/gr_app.js:2001` (`recolectarDatosLote`, declaración de `inoculoSource`)
- Modify: `gr/gr_app.js:2041` (comentario desactualizado en el mismo `dg.push`)

**Contexto:** `_migrarInoculoSourceNull()` corre sin guard en cada `grInit()`. Además `recolectarDatosLote()` puede seguir produciendo `inoculoSource: null` en una fila nueva cuando `_grResolverInoculo` no resuelve nada — la migración no es un cleanup histórico único.

- [ ] **Step 1: Agregar guard one-shot a `_migrarInoculoSourceNull()`**

Buscar:

```js
    function _migrarInoculoSourceNull() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            var lotes = JSON.parse(raw);
            if (!Array.isArray(lotes)) return;
            var cambiados = 0;
            lotes.forEach(function(lote) {
                if (!Array.isArray(lote.dg)) return;
                lote.dg.forEach(function(dg) {
                    if (dg.inoculoSource === null || dg.inoculoSource === undefined) {
                        dg.inoculoSource = 'LEGACY';
                        cambiados++;
                    }
                });
            });
            if (cambiados > 0) {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(lotes));
                console.log('[GR] Migración inoculoSource: ' + cambiados + ' registros actualizados a LEGACY');
            }
        } catch(e) {
            console.error('[GR] Error en migración inoculoSource:', e);
        }
    }
```

Reemplazar por:

```js
    function _migrarInoculoSourceNull() {
        var MIGRACION_INOCULO_KEY = 'biolab_migracion_gr_inoculo_source_v1';
        try {
            if (localStorage.getItem(MIGRACION_INOCULO_KEY) === '1') return;
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) { localStorage.setItem(MIGRACION_INOCULO_KEY, '1'); return; }
            var lotes = JSON.parse(raw);
            if (!Array.isArray(lotes)) { localStorage.setItem(MIGRACION_INOCULO_KEY, '1'); return; }
            var cambiados = 0;
            lotes.forEach(function(lote) {
                if (!Array.isArray(lote.dg)) return;
                lote.dg.forEach(function(dg) {
                    if (dg.inoculoSource === null || dg.inoculoSource === undefined) {
                        dg.inoculoSource = 'LEGACY';
                        cambiados++;
                    }
                });
            });
            if (cambiados > 0) {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(lotes));
                console.log('[GR] Migración inoculoSource: ' + cambiados + ' registros actualizados a LEGACY');
            }
            localStorage.setItem(MIGRACION_INOCULO_KEY, '1');
        } catch(e) {
            console.error('[GR] Error en migración inoculoSource:', e);
        }
    }
```

- [ ] **Step 2: Hacer que `recolectarDatosLote()` escriba `'LEGACY'` en vez de `null` cuando no se resuelve el inóculo**

Buscar:

```js
            const inoc = (typeof _grResolverInoculo === 'function') ? _grResolverInoculo(rawSelValue) : null;
            let inoculoSource = null;
            let cultivoCiId = null;
```

Reemplazar por:

```js
            const inoc = (typeof _grResolverInoculo === 'function') ? _grResolverInoculo(rawSelValue) : null;
            let inoculoSource = 'LEGACY';
            let cultivoCiId = null;
```

- [ ] **Step 3: Actualizar el comentario desactualizado que documenta los valores posibles**

Buscar:

```js
                inoculoSource: inoculoSource,   // [Fase 4] 'CI' | 'GE' | null
```

Reemplazar por:

```js
                inoculoSource: inoculoSource,   // [Fase 4] 'CI' | 'GE' | 'LEGACY'
```

- [ ] **Step 4: Chequeo de sintaxis**

Run: `node --check "gr/gr_app.js"`
Expected: sin output.

- [ ] **Step 5: Commit**

```bash
git add gr/gr_app.js
git commit -m "fix(gr): _migrarInoculoSourceNull ahora corre una sola vez (guard localStorage) y recolectarDatosLote nunca vuelve a escribir inoculoSource null en datos nuevos"
```

---

### Task 5: Fix inconsistencia de fórmula "Disponibles" — KPI bar no restaba `usadosEx`

**Files:**
- Modify: `gr/gr_app.js:1331-1387` (función `_grRenderKpiBar`)

**Contexto:** La lista de registro/cards resta `usadosEx` (consumo desde FR Experimentos, vía `grGetExUsadosGR`) al calcular disponibles. La barra KPI de resumen (`_grRenderKpiBar`, línea 1331) NO resta `usadosEx`. **Nota del agente que escribió este plan:** el hallazgo original de auditoría sugería que la función KPI podía ser `grActualizarTotalesGenetica` — verificado que esa función (línea 2867) ya resta `usadosEx` correctamente y NO es el problema; el target real es `_grRenderKpiBar` (línea 1331).

- [ ] **Step 1: Sumar `usadosEx` al cálculo de disponibles en `_grRenderKpiBar`**

Buscar:

```js
    lotes.forEach(l => {
        const dgArr = Array.isArray(l.dg) ? l.dg : [];
        const usadosLote = usadosMap[l.id] || {};
        const kpi = grCalcularKPIFormulario(l);
        var loteDisp = 0;
        dgArr.forEach(r => {
            const fr = parseFloat(r.frascos) || 0;
            const co = parseInt(r.contaminados) || 0;
            const u  = (r.tanda && usadosLote[r.tanda] != null)
                ? (parseInt(usadosLote[r.tanda]) || 0)
                : (parseInt(r.usadosSnapshot) || 0);
            totalFrascos += fr;
            totalContam  += co;
            loteDisp     += Math.max(0, fr - co - u);
        });
        totalDisp += loteDisp;
        if (loteDisp > 0) totalLotesActivos++;
        sumMasaSeca += (kpi && kpi.masaSeca) || 0;
        sumVolumen  += (kpi && kpi.volumenTotalL) || 0;
    });
```

Reemplazar por:

```js
    lotes.forEach(l => {
        const dgArr = Array.isArray(l.dg) ? l.dg : [];
        const usadosLote = usadosMap[l.id] || {};
        const kpi = grCalcularKPIFormulario(l);
        var loteDisp = 0;
        dgArr.forEach(r => {
            const fr = parseFloat(r.frascos) || 0;
            const co = parseInt(r.contaminados) || 0;
            const u  = (r.tanda && usadosLote[r.tanda] != null)
                ? (parseInt(usadosLote[r.tanda]) || 0)
                : (parseInt(r.usadosSnapshot) || 0);
            const uEx = grGetExUsadosGR(l.id, r.tanda);
            totalFrascos += fr;
            totalContam  += co;
            loteDisp     += Math.max(0, fr - co - u - uEx);
        });
        totalDisp += loteDisp;
        if (loteDisp > 0) totalLotesActivos++;
        sumMasaSeca += (kpi && kpi.masaSeca) || 0;
        sumVolumen  += (kpi && kpi.volumenTotalL) || 0;
    });
```

- [ ] **Step 2: Chequeo de sintaxis**

Run: `node --check "gr/gr_app.js"`
Expected: sin output.

- [ ] **Step 3: Commit**

```bash
git add gr/gr_app.js
git commit -m "fix(gr): la barra KPI de Disponibles no restaba usadosEx (consumo FR Experimentos), quedando desincronizada con el total mostrado en las cards de registro"
```

---

### Task 6: Dead code — remover panel DC legacy (`seleccionarAgenteBiblioteca`, `calcularConcentracionFinal`) y su wiring

**Files:**
- Modify: `gr/gr_app.js:679-688` (registro de listeners)
- Modify: `gr/gr_app.js:856-883` (las dos funciones)

**Contexto:** Referencian IDs de DOM viejos que no existen en `gr_index.html` (confirmado por grep). `seleccionarAgenteBiblioteca()` referencia `bibliotecaAgentes[agente]` pero `bibliotecaAgentes` NO está declarada en ningún lado — ReferenceError congelado en código muerto. Cero callers en todo `biolab-app`.

- [ ] **Step 1: Remover el registro de los cuatro listeners del panel DC legacy**

Buscar:

```js
        // DC - Biblioteca de agentes (legacy — IDs antiguos pueden no existir tras migración a PROTOCOLO)
        const _dcBib = document.getElementById('dcBibliotecaAgentes');
        if (_dcBib) _dcBib.addEventListener('change', seleccionarAgenteBiblioteca);
        const _dcVolSol = document.getElementById('dcVolSol');
        if (_dcVolSol) _dcVolSol.addEventListener('input', calcularConcentracionFinal);
        const _dcConcAg = document.getElementById('dcConcAgente');
        if (_dcConcAg) _dcConcAg.addEventListener('input', calcularConcentracionFinal);
        const _dcVolAg = document.getElementById('dcVolAgente');
        if (_dcVolAg) _dcVolAg.addEventListener('input', calcularConcentracionFinal);
        
        // DG - Tabla de distribución de grano
```

Reemplazar por:

```js
        // DG - Tabla de distribución de grano
```

- [ ] **Step 2: Remover `seleccionarAgenteBiblioteca()` y `calcularConcentracionFinal()`**

Buscar:

```js
    function seleccionarAgenteBiblioteca() {
        const select = document.getElementById('dcBibliotecaAgentes');
        const agente = select.value;
        const agenteInput = document.getElementById('dcAgente');
        const concAgenteInput = document.getElementById('dcConcAgente');
        
        if (agente === 'otro' || agente === '') {
            // No hacer nada, el usuario escribirá manualmente
            return;
        }
        
        if (bibliotecaAgentes[agente]) {
            agenteInput.value = bibliotecaAgentes[agente].nombre;
            concAgenteInput.value = bibliotecaAgentes[agente].conc;
            calcularConcentracionFinal();
        }
    }

    function calcularConcentracionFinal() {
        const volSol = parseFloat(document.getElementById('dcVolSol').value) || 0;
        const volAgente = parseFloat(document.getElementById('dcVolAgente').value) || 0;
        const concAgente = parseFloat(document.getElementById('dcConcAgente').value) || 0;
        
        // Fórmula: (Vol_agente_ml × Conc_agente%) / (Vol_sol_L × 1000) = %
        // O más simple: (volAgente / (volSol * 1000)) * 100 * (concAgente / 100)
        const concentracion = (volSol > 0 && concAgente > 0) ? (volAgente * concAgente) / (volSol * 1000) : 0;
        document.getElementById('dcConc').value = concentracion.toFixed(3);
    }

    // ==========================================
    // UF - UNIDAD FÍSICA Y PRODUCCIÓN
```

Reemplazar por:

```js
    // ==========================================
    // UF - UNIDAD FÍSICA Y PRODUCCIÓN
```

- [ ] **Step 3: Chequeo de sintaxis**

Run: `node --check "gr/gr_app.js"`
Expected: sin output.

- [ ] **Step 4: Commit**

```bash
git add gr/gr_app.js
git commit -m "refactor(gr): eliminar panel DC legacy muerto (seleccionarAgenteBiblioteca, calcularConcentracionFinal) — IDs de DOM inexistentes y ReferenceError congelado en bibliotecaAgentes no declarada"
```

---

### Task 7: Dead code — remover `addAdRow()` duplicado (interna y expuesta)

**Files:**
- Modify: `gr/gr_app.js:1059-1080` (función interna)
- Modify: `gr/gr_app.js:2258-2280` (versión expuesta en `GR`/`window`)

**Contexto:** Dos copias idénticas, cero callers confirmados por grep en todo `biolab-app`.

- [ ] **Step 1: Remover la copia interna**

Buscar:

```js

    function addAdRow() {
        const tbody = document.getElementById('dgTable').querySelector('tbody');
        const row = document.createElement('tr');
        row.className = 'ad-row';
        row.innerHTML = `
            <td><input type="text" class="ad-tanda" placeholder="Ej: 194DA"></td>
            <td><input type="number" class="ad-frascos" value="0" min="0"></td>
            <td><input type="text" class="ad-nombre" placeholder="Ej: CaSO4"></td>
            <td><input type="number" class="ad-cant" value="0" min="0" step="0.1"></td>
            <td><input type="number" class="ad-conc" value="0" min="0" step="0.1"></td>
            <td>
                <select class="ad-estado">
                    <option value="">Seleccionar...</option>
                    <option value="ejecutado">Ejecutado</option>
                    <option value="programado">Programado</option>
                    <option value="pendiente">Pendiente</option>
                </select>
            </td>
            <td><button type="button" class="btn-remove" onclick="removeRow(this)">✕</button></td>
        `;
        tbody.appendChild(row);
    }
```

Reemplazar por: (nada — borrar el bloque completo)

- [ ] **Step 2: Remover la copia expuesta en `GR`/`window`**

Buscar:

```js

    // Función global para agregar fila AD
    GR.addAdRow = window.addAdRow = function() {
        const tbody = document.getElementById('dgTable').querySelector('tbody');
        const row = document.createElement('tr');
        row.className = 'ad-row';
        row.innerHTML = `
            <td><input type="text" class="ad-tanda" placeholder="Ej: 194DA"></td>
            <td><input type="number" class="ad-frascos" value="0" min="0"></td>
            <td><input type="text" class="ad-nombre" placeholder="Ej: CaSO4"></td>
            <td><input type="number" class="ad-cant" value="0" min="0" step="0.1"></td>
            <td><input type="number" class="ad-conc" value="0" min="0" step="0.1"></td>
            <td>
                <select class="ad-estado">
                    <option value="">Seleccionar...</option>
                    <option value="ejecutado">Ejecutado</option>
                    <option value="programado">Programado</option>
                    <option value="pendiente">Pendiente</option>
                </select>
            </td>
            <td><button type="button" class="btn-remove" onclick="removeRow(this)">✕</button></td>
        `;
        tbody.appendChild(row);
    };
```

Reemplazar por: (nada — borrar el bloque completo)

- [ ] **Step 3: Chequeo de sintaxis**

Run: `node --check "gr/gr_app.js"`
Expected: sin output.

- [ ] **Step 4: Commit**

```bash
git add gr/gr_app.js
git commit -m "refactor(gr): eliminar addAdRow() duplicado (copia interna y copia expuesta en window), ambas sin callers"
```

---

### Task 8: Dead code — remover `GR.cambiarEstructura`/`window.cambiarEstructura`

**Files:**
- Modify: `gr/gr_app.js:2546-2554`

**Contexto:** Referencia `dgTipoEstructura`/`dgCapacidad`, IDs inexistentes en `gr_index.html`. Cero callers.

- [ ] **Step 1: Remover `GR.cambiarEstructura`**

Buscar:

```js
    GR.cambiarEstructura = window.cambiarEstructura = function() {
        const tipo = document.getElementById('dgTipoEstructura');
        const capacidad = document.getElementById('dgCapacidad');
        if (tipo && capacidad) {
            capacidad.value = tipo.value === 'frasco' ? 660 : 1000;
            calcularDG();
        }
    };

    GR.calcularDG = window.calcularDG = function() {
```

Reemplazar por:

```js
    GR.calcularDG = window.calcularDG = function() {
```

- [ ] **Step 2: Chequeo de sintaxis**

Run: `node --check "gr/gr_app.js"`
Expected: sin output.

- [ ] **Step 3: Commit**

```bash
git add gr/gr_app.js
git commit -m "refactor(gr): eliminar GR.cambiarEstructura, referencia IDs de DOM inexistentes (dgTipoEstructura, dgCapacidad) y sin callers"
```

---

### Task 9: Dead code — remover `GR.calcularDG`/`window.calcularDG` y su call site en `GR.init()`

**Files:**
- Modify: `gr/gr_app.js:2542-2572` (función; ejecutar DESPUÉS de Task 8)
- Modify: `gr/gr_app.js:486-491` (`GR.init()`, call site)

**Contexto:** Referencia `dgCapacidad`/`dgLlenado`/`dgHeadspace`/`dgOxigeno`, IDs inexistentes. Se llama desde `GR.init()` y no-opea silenciosamente en cada carga.

- [ ] **Step 1: Remover `GR.calcularDG` junto con el header de sección ahora huérfano**

Buscar:

```js
    // ==========================================
    // DG - DISTRIBUCIÓN DE GRANO
    // ==========================================

    GR.calcularDG = window.calcularDG = function() {
        const capacidad = document.getElementById('dgCapacidad');
        const llenado = document.getElementById('dgLlenado');
        const dgHeadspace = document.getElementById('dgHeadspace');
        const dgOxigeno = document.getElementById('dgOxigeno');
        
        if (!capacidad || !llenado || !dgHeadspace || !dgOxigeno) return;
        
        const capacidadVal = parseFloat(capacidad.value) || 0;
        const llenadoVal = parseFloat(llenado.value) || 0;
        const headspace = capacidadVal - llenadoVal;
        // oxígeno % frasco = headspace / capacidadTotal * 100
        const oxigeno = capacidadVal > 0 ? (headspace / capacidadVal) * 100 : 0;
        
        dgHeadspace.textContent = headspace.toFixed(0);
        dgOxigeno.textContent = oxigeno.toFixed(1);
    };

    // ==========================================
    // GENÉTICA - Cargar desde GE via window.ge.getSelectableGenetics()
```

Reemplazar por:

```js
    // ==========================================
    // GENÉTICA - Cargar desde GE via window.ge.getSelectableGenetics()
```

- [ ] **Step 2: Remover el call site `GR.calcularDG();` del arranque de `GR.init()`**

Buscar:

```js
        setTimeout(function() {
            GR.calcularDG();
            actualizarTotalesCT();
            grActualizarTotalesGenetica();
            updateUnidadFisica();
        }, 100);
```

Reemplazar por:

```js
        setTimeout(function() {
            actualizarTotalesCT();
            grActualizarTotalesGenetica();
            updateUnidadFisica();
        }, 100);
```

- [ ] **Step 3: Chequeo de sintaxis**

Run: `node --check "gr/gr_app.js"`
Expected: sin output.

- [ ] **Step 4: Commit**

```bash
git add gr/gr_app.js
git commit -m "refactor(gr): eliminar GR.calcularDG (IDs de DOM inexistentes: dgCapacidad, dgLlenado, dgHeadspace, dgOxigeno) y su call site inutil en GR.init()"
```

---

### Task 10: Dead code — remover `GR.cargarLoteDesdeRegistro`/`GR.eliminarLoteDesdeRegistro`

**Files:**
- Modify: `gr/gr_app.js:1446-1466`

**Contexto:** Patrón viejo pre-"cards". Cero apariciones de `onclick="cargarLoteDesdeRegistro(...)"`/`eliminarLoteDesdeRegistro(...)` en `gr_index.html`. SU tiene su propia copia independiente con el mismo nombre — no relacionado.

- [ ] **Step 1: Remover ambas funciones**

Buscar:

```js
    // Función para cargar lote desde el registro
    GR.cargarLoteDesdeRegistro = window.cargarLoteDesdeRegistro = function(index) {
        if (lotesData[index]) {
            cargarDatosLote(lotesData[index]);
            document.getElementById('loteSelector').value = index;
        }
    };
    
    // Función para eliminar lote desde el registro
    GR.eliminarLoteDesdeRegistro = window.eliminarLoteDesdeRegistro = function(index) {
        const lote = lotesData[index];
        if (!lote) return;
        
        if (!confirm(`¿Eliminar el lote "${lote.id}" del sistema?`)) return;
        
        lotesData.splice(index, 1);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(lotesData));
        grRenderizarRegistroLotes();
        actualizarSelectorLotes();
        alert('Lote eliminado');
    };
    
    function guardarLote() {
```

Reemplazar por:

```js
    function guardarLote() {
```

- [ ] **Step 2: Chequeo de sintaxis**

Run: `node --check "gr/gr_app.js"`
Expected: sin output.

- [ ] **Step 3: Commit**

```bash
git add gr/gr_app.js
git commit -m "refactor(gr): eliminar GR.cargarLoteDesdeRegistro/eliminarLoteDesdeRegistro, patron pre-cards sin callers en gr_index.html"
```

---

### Task 11: Dead code — remover funciones legacy de solo-alerta (`agregarAgente`, `agregarAditivo`, `agregarGrano`, `eliminarIngrediente`)

**Files:**
- Modify: `gr/gr_app.js:3324-3328`

**Contexto:** Comentario explícito "Legacy functions (deprecated but kept for compatibility)". Cada una solo muestra un `alert()`. Cero callers. No confundir con `eliminarIngredienteConfig` (línea 2450), que SÍ está viva — no se toca. Tampoco se toca `renderizarBiblioteca()` (línea 3329, inmediatamente después).

- [ ] **Step 1: Remover las cuatro funciones legacy**

Buscar:

```js
    // Legacy functions (deprecated but kept for compatibility)
    GR.agregarAgente = window.agregarAgente = function() { alert('Use la sección Config para agregar ingredientes'); };
    GR.agregarAditivo = window.agregarAditivo = function() { alert('Use la sección Config para agregar ingredientes'); };
    GR.agregarGrano = window.agregarGrano = function() { alert('Use la sección Config para agregar ingredientes'); };
    GR.eliminarIngrediente = window.eliminarIngrediente = function() { alert('Use la sección Config para eliminar ingredientes'); };
    function renderizarBiblioteca() { renderizarBibliotecaEnConfig(); }
```

Reemplazar por:

```js
    function renderizarBiblioteca() { renderizarBibliotecaEnConfig(); }
```

- [ ] **Step 2: Chequeo de sintaxis**

Run: `node --check "gr/gr_app.js"`
Expected: sin output.

- [ ] **Step 3: Commit**

```bash
git add gr/gr_app.js
git commit -m "refactor(gr): eliminar agregarAgente/agregarAditivo/agregarGrano/eliminarIngrediente, funciones legacy que solo mostraban un alert, sin callers"
```

---

### Task 12: Dead code — remover lotes demo hardcodeados (`cargarLote1903Demo`, `cargarLoteMaiz2024Demo`)

**Files:**
- Modify: `gr/gr_app.js:3331-3417` (bloque lote 1903)
- Modify: `gr/gr_app.js:3419-3486` (bloque lote Maíz 2024)

**Contexto:** Datos demo hardcodeados de 2024. Cero callers desde UI, pero expuestas en `GR`/`window` → invocables desde consola, riesgo de contaminar `gr_lotes` con datos falsos.

- [ ] **Step 1: Remover el bloque completo del lote demo 1903**

Buscar:

```js
    // ==========================================
    // CARGAR LOTE 1903 (EJEMPLO)
    // ==========================================

    function cargarLote1903() {
        const lote1903 = {
            id: '1903-MA-AV',
            nombre: 'MA + AV (50/50 vol.)',
            fecha: '2024-01-15',
            version: 'v2.0',
            componentes: [
                { nombre: 'Avena (AV)', volumen: 2000, masa: 1112, densidad: 0.556, notas: 'Grano fino, alta superficie específica' },
                { nombre: 'Maíz (MA)', volumen: 2000, masa: 1604, densidad: 0.802, notas: 'Grano grueso, mayor resistencia a hidratación' }
            ],
            dc: {
                volSol: 4,
                agente: 'ÁCIDO PERACÉTICO',
                concAgente: 5,
                volAgente: 60,
                conc: 0.075,
                tiempo: 60
            },
            hm: {
                estadoAgua: 'EBULICIÓN - 100°C',
                estadoGrano: 'TEMPERATURA AMBIENTE',
                metodo: 'INMERSIÓN DIRECTA',
                tiempoCoccion: 20,
                regimenCalor: 'FUEGO MÁXIMO CONSTANTE',
                agitacion: 'CADA 5 MINUTOS'
            },
            aditivos: [
                { tanda: '193GA', frascos: 4, nombre: 'CaSO4 (Yeso)', cantidad: 1.6, conc: 0.5, estado: 'ejecutado' },
                { tanda: '193GB', frascos: 4, nombre: 'CaSO4 (Yeso)', cantidad: 3.0, conc: 1.0, estado: 'programado' },
                { tanda: '193GC', frascos: 6, nombre: 'CaSO4 (Yeso)', cantidad: 6.3, conc: 2.0, estado: 'pendiente' }
            ],
            es: {
                tiempo: 150,
                medio: 'VAPOR SATURADO',
                objPrimario: 'ESTERILIDAD DEL SUSTRATO',
                objSecundario: 'HIDRATACIÓN INTERNA DEL MAÍZ',
                riesgos: [
                    { causa: 'CaSO4 insuficiente', nivel: 'medio' },
                    { causa: 'CaSO4 excesivo', nivel: 'medio' },
                    { causa: 'Mala distribución en esterilizador', nivel: 'alto' }
                ]
            },
            dg: [
                { tanda: '193GA', frascos: 4, nombre: 'CaSO4 (Yeso)', cantidad: 1.6, conc: 0.5, estado: 'ejecutado' },
                { tanda: '193GB', frascos: 4, nombre: 'CaSO4 (Yeso)', cantidad: 3.0, conc: 1.0, estado: 'programado' },
                { tanda: '193GC', frascos: 6, nombre: 'CaSO4 (Yeso)', cantidad: 6.3, conc: 2.0, estado: 'pendiente' }
            ],
            re: {
                evaluacion: {
                    hidratacion: 'correcto',
                    distribucion: 'problema',
                    eficiencia: 'optimo'
                }
            }
        };
        
        return lote1903;
    }

    // Función para cargar el lote de ejemplo y registrarlo
    GR.cargarLote1903Demo = window.cargarLote1903Demo = function() {
        const lote = cargarLote1903();
        
        // Verificar si ya existe
        const existe = lotesData.some(l => l.id === lote.id);
        
        if (existe) {
            alert('El lote 1903-MA-AV ya está registrado');
            cargarDatosLote(lote);
            return;
        }
        
        // Agregar al array
        lotesData.push(lote);
        
        // Guardar en localStorage
        guardarEnStorage();
        
        // Mostrar en UI
        cargarDatosLote(lote);
        
        alert('LOTE 1903-MA-AV registrado correctamente');
    };

    // ==========================================
    // CARGAR LOTE MAÍZ 2024 (EJEMPLO)
    // ==========================================
```

Reemplazar por:

```js
    // ==========================================
    // CARGAR LOTE MAÍZ 2024 (EJEMPLO)
    // ==========================================
```

- [ ] **Step 2: Remover el bloque completo del lote demo Maíz 2024**

Buscar:

```js
    // ==========================================
    // CARGAR LOTE MAÍZ 2024 (EJEMPLO)
    // ==========================================

    function cargarLoteMaiz2024() {
        const loteMaiz = {
            id: 'MA-2024',
            nombre: 'Maíz 100%',
            fecha: '2024-01-20',
            version: 'v1.0',
            componentes: [
                { nombre: 'Maíz (MA)', volumen: 3000, masa: 2406, densidad: 0.802, notas: 'Grano seco' }
            ],
            dc: {
                volSol: 3.5,
                agente: 'ÁCIDO PERACÉTICO',
                concAgente: 5,
                volAgente: 60,
                conc: 0.086,
                tiempo: 60
            },
            hm: {
                estadoAgua: 'EBULICIÓN - 100°C',
                estadoGrano: 'TEMPERATURA AMBIENTE',
                metodo: 'INMERSIÓN DIRECTA',
                tiempoCoccion: 70,
                regimenCalor: 'FUEGO MÁXIMO + FUEGO MÍNIMO',
                agitacion: '15 MIN/CICLO × 4 CICLOS'
            },
            dg: [],
            es: {},
            re: {
                evaluacion: {
                    hidratacion: 'correcto',
                    distribucion: 'correcto',
                    eficiencia: 'optimo'
                },
                notas: 'Expansión x2 (100%) - Punto óptimo. Relación agua/maíz 1:1. 12 frascos obtenidos.'
            }
        };
        
        return loteMaiz;
    }

    // Función para cargar el lote de maíz y registrarlo
    GR.cargarLoteMaiz2024Demo = window.cargarLoteMaiz2024Demo = function() {
        const lote = cargarLoteMaiz2024();
        
        // Verificar si ya existe
        const existe = lotesData.some(l => l.id === lote.id);
        
        if (existe) {
            alert('El lote MA-2024 ya está registrado');
            cargarDatosLote(lote);
            return;
        }
        
        // Agregar al array
        lotesData.push(lote);
        
        // Guardar en localStorage
        guardarEnStorage();
        
        // Mostrar en UI
        cargarDatosLote(lote);
        
        alert('LOTE MA-2024 registrado correctamente');
    };

    // Inicialización unificada en GR.init() al inicio del archivo.
```

Reemplazar por:

```js
    // Inicialización unificada en GR.init() al inicio del archivo.
```

- [ ] **Step 3: Chequeo de sintaxis**

Run: `node --check "gr/gr_app.js"`
Expected: sin output.

- [ ] **Step 4: Commit**

```bash
git add gr/gr_app.js
git commit -m "refactor(gr): eliminar lotes demo hardcodeados cargarLote1903Demo y cargarLoteMaiz2024Demo, sin uso en UI pero invocables desde consola con riesgo de contaminar gr_lotes"
```

---

### Task 13: Dead code — remover fallback muerto en `goToConfig()`

**Files:**
- Modify: `gr/gr_app.js:3493-3500`

**Contexto:** La rama fallback navega a `gr_config.html`, archivo que no existe en el repo (`gr/` solo tiene `gr_index.html`/`gr_app.js`/`gr_styles.css`). Se remueve solo esa rama, la primaria (tab switching) queda intacta.

- [ ] **Step 1: Remover la línea de navegación al archivo inexistente**

Buscar:

```js
GR.goToConfig = window.goToConfig = function goToConfig() {
    // Si existe el sub-panel embebido, usar tab switching en lugar de navegar
    if (document.getElementById('gr-sub-cfg')) {
        GR.subTab('cfg');
        return;
    }
    window.location.href = 'gr_config.html';
};
```

Reemplazar por:

```js
GR.goToConfig = window.goToConfig = function goToConfig() {
    // Si existe el sub-panel embebido, usar tab switching en lugar de navegar
    if (document.getElementById('gr-sub-cfg')) {
        GR.subTab('cfg');
        return;
    }
};
```

- [ ] **Step 2: Chequeo de sintaxis**

Run: `node --check "gr/gr_app.js"`
Expected: sin output.

- [ ] **Step 3: Commit**

```bash
git add gr/gr_app.js
git commit -m "refactor(gr): eliminar fallback muerto en goToConfig() que navegaba a gr_config.html, archivo que ya no existe en el repo"
```

---

### Task 14: Dead code — remover `_grMessageListener` (listener de `gr_config.html` que ya no existe)

**Files:**
- Modify: `gr/gr_app.js:25` (declaración de variable)
- Modify: `gr/gr_app.js:703-717` (registro del listener en `inicializarEventos()`)
- Modify: `gr/gr_app.js:4373-4382` (cleanup en `onModuleUnload`)

**Contexto:** Escucha `postMessage` de `gr_config.html`, página que ya no existe — nada puede disparar el mensaje. Se elimina declaración, registro y cleanup.

- [ ] **Step 1: Remover el registro del listener y su callback en `inicializarEventos()`**

Buscar:

```js
        });

        // Escuchar mensajes de gr_config.html
        if (_grMessageListener) {
            window.removeEventListener('message', _grMessageListener);
        }
        _grMessageListener = function(event) {
            if (event.data && event.data.type === 'bibliotecaActualizada') {
                cargarBibliotecaDesdeStorage();
                renderizarBibliotecaEnConfig();
                actualizarSelectoresCT();
            }
        };
        window.addEventListener('message', _grMessageListener);
    }
```

Reemplazar por:

```js
        });
    }
```

- [ ] **Step 2: Remover el cleanup en `onModuleUnload`**

Buscar:

```js
    if (_grCultivosChangedListener) {
        window.removeEventListener('ci-cultivos-changed', _grCultivosChangedListener);
        _grCultivosChangedListener = null;
    }
    if (_grMessageListener) {
        window.removeEventListener('message', _grMessageListener);
        _grMessageListener = null;
    }
};
```

Reemplazar por:

```js
    if (_grCultivosChangedListener) {
        window.removeEventListener('ci-cultivos-changed', _grCultivosChangedListener);
        _grCultivosChangedListener = null;
    }
};
```

- [ ] **Step 3: Remover la declaración de la variable**

Buscar:

```js
let _grFocusListener = null;
let _grUsadosChangedListener = null;
let _grMessageListener = null;
let _grCultivosChangedListener = null;  // [Fase 4] refresca dropdowns de inóculo cuando CI cambia
```

Reemplazar por:

```js
let _grFocusListener = null;
let _grUsadosChangedListener = null;
let _grCultivosChangedListener = null;  // [Fase 4] refresca dropdowns de inóculo cuando CI cambia
```

- [ ] **Step 4: Chequeo de sintaxis**

Run: `node --check "gr/gr_app.js"`
Expected: sin output.

- [ ] **Step 5: Commit**

```bash
git add gr/gr_app.js
git commit -m "refactor(gr): eliminar _grMessageListener, escuchaba postMessage de gr_config.html, pagina que ya no existe en el repo"
```

---

### Task 15: QA manual

**Files:** ninguno

- [ ] **Step 1:** Levantar `python serve.py` desde `biolab-app/`, abrir el módulo GR.

- [ ] **Step 2 (Fix 1 — importación biblioteca):** Exportar JSON del lote actual (incluye `biblioteca`), editar el archivo para modificar el nombre de un grano, reimportarlo, recargar (F5), confirmar en Config → biblioteca de granos que el cambio persiste.

- [ ] **Step 3 (Fix 2 — botón Cerrar Protocolo):** confirmar que ya no aparece, y que "Agregar Nota" sigue funcionando.

- [ ] **Step 4 (Fix 3 — actualizarTotalesCT):** cambiar el selector "Tipo" (Seco/Líquido) de una fila CT, confirmar sin `ReferenceError` en consola y que los totales se recalculan.

- [ ] **Step 5 (Fix 4 — migración inoculoSource):** en consola, `localStorage.getItem('biolab_migracion_gr_inoculo_source_v1')` debe ser `"1"` tras cargar. Crear una tanda DG sin seleccionar inóculo, guardar, y confirmar en `gr_lotes` que la fila nueva tiene `inoculoSource: "LEGACY"` (no `null`).

- [ ] **Step 6 (Fix 5 — Disponibles KPI vs cards):** comparar el número "Disponibles" de la barra KPI contra la suma de las cards para lotes con consumo en FR Experimentos — deben coincidir.

- [ ] **Step 7 (Fix 6 — código muerto):** recorrer toda la UI de GR (Formulación, Registro, Config, DC/CT/HM/ES/DG/UF/RE), sin `ReferenceError`/`TypeError` nuevos. Guardar un lote completo end-to-end y confirmar que funciona igual que antes.

- [ ] **Step 8:** en consola, confirmar `typeof window.cargarLote1903Demo === 'undefined'`, `typeof window.cargarLoteMaiz2024Demo === 'undefined'`, `typeof window.cambiarEstructura === 'undefined'`, `typeof window.calcularDG === 'undefined'`.

---

## Nota de auto-revisión (dejada por el agente que redactó este plan)

Fix 5 tuvo un hallazgo importante: el target original sospechado (`grActualizarTotalesGenetica`) resultó YA estar correcto — el bug real estaba en `_grRenderKpiBar` (línea 1331), función distinta. El resto de los fixes coinciden exactamente con lo esperado; todas las afirmaciones de "cero callers" para el código muerto fueron verificadas por grep en todo el árbol `biolab-app`, no solo en `gr_app.js`.
