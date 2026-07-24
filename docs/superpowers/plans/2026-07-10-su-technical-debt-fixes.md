# SU — Deuda técnica confirmada por auditoría Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar cuatro puntos de deuda técnica confirmados por auditoría en el módulo SU (Sustratos): botones de Config muertos por IDs duplicados, código muerto de un render legacy de biblioteca que apunta a un `<tbody>` inexistente, doble disparo de `nuevoLote()` por doble wiring, y un invariante `bolsas === 1` sin validar que rompe silenciosamente el badge FR en las cards de Registro.

**Architecture:** Cuatro cambios quirúrgicos y localizados en `su/su_index.html` y `su/su_app.js`. Task 1 reasigna los IDs duplicados del panel Config y reutiliza los mismos handlers ya existentes (`exportarJSON`/`exportarExcel`/`importarJSON`) sin duplicar lógica. Task 2 elimina tres funciones huérfanas (`renderizarBiblioteca`/`agregarMaterial`/`eliminarMaterial`) que apuntan a un `#bibliotecaTable` que no existe en el DOM, sin tocar el path vivo `cfgRenderizarBiblioteca()`/`#cfgBibliotecaTable`. Task 3 elimina un wiring redundante (`onclick` inline) manteniendo el `addEventListener` explícito que ya usa el resto del archivo. Task 4 añade una validación mínima con `confirm()` dentro del mismo bucle de persistencia de edición inline que ya existe en `toggleEdicionRegistros()`, reutilizando el helper `_suGetFRMap()` que ya existe en el archivo en vez de escribir lookup nuevo.

**Tech Stack:** Vanilla JS (IIFE), localStorage, no test framework — verificación es `node --check` para sintaxis + manual browser QA (este repo no tiene suite de tests automatizada).

---

### Task 1: Wirear los botones de importar/exportar del panel Config (IDs duplicados los dejaban muertos)

**Files:**
- Modify: `su/su_index.html:467-471`
- Modify: `su/su_app.js:255-263` (dentro de `inicializarEventos()`)

**Contexto:** `su_index.html` tiene los IDs `btnExportJson`, `btnExportExcel`, `btnImportJson` duplicados. La primera aparición está en la barra de acciones del panel principal (`su_index.html:299-300`, dentro de `#su-sub-main`) y en el panel de Registros (`su_index.html:330`, dentro de `#su-sub-reg`) — ninguna de estas se toca en este plan. `inicializarEventos()` en `su_app.js:255-263` hace `document.getElementById('btnExportJson')`/`'btnExportExcel'`/`'btnImportJson'`, y como `getElementById` siempre devuelve el PRIMER nodo del DOM en orden de documento, encuentra las copias de `#su-sub-main`/`#su-sub-reg` (que aparecen antes en el HTML) y nunca las copias de `#su-sub-cfg` (línea 467-471), que quedan sin ningún listener. Vamos a renombrar solo la copia de `#su-sub-cfg` a IDs únicos y agregar el wiring correspondiente apuntando a las MISMAS funciones (`exportarJSON`, `exportarExcel`, `importarJSON`) que ya usa el panel principal — no se duplica lógica de negocio, solo se agrega el `addEventListener` que falta.

**Nota (fuera de alcance, no tocar):** el botón `btnImportJson` de `#su-sub-reg` (línea 330) ya tiene `onchange="importarJSON(event)"` inline Y además recibe el `addEventListener` de `inicializarEventos()` (por ser el primer match de `getElementById`), así que ese botón específico dispara `importarJSON` dos veces por selección de archivo. Es un bug real pero no es ninguno de los 4 confirmados por la auditoría para este plan — no se toca aquí.

- [ ] **Step 1: Renombrar los 3 IDs de la copia del panel Config en `su_index.html`**

Buscar:

```html
                        <button type="button" id="btnExportJson" class="btn btn-secondary">💾 Exportar JSON</button>
                        <button type="button" id="btnExportExcel" class="btn btn-secondary">📊 Exportar Excel</button>
                        <label class="btn btn-su" style="cursor:pointer">
                            📥 Importar JSON
                            <input type="file" id="btnImportJson" accept=".json" style="display:none">
                        </label>
```

Reemplazar por:

```html
                        <button type="button" id="btnExportJsonCfg" class="btn btn-secondary">💾 Exportar JSON</button>
                        <button type="button" id="btnExportExcelCfg" class="btn btn-secondary">📊 Exportar Excel</button>
                        <label class="btn btn-su" style="cursor:pointer">
                            📥 Importar JSON
                            <input type="file" id="btnImportJsonCfg" accept=".json" style="display:none">
                        </label>
```

- [ ] **Step 2: Agregar el wiring de los nuevos IDs en `inicializarEventos()` (`su_app.js`)**

Buscar:

```js
    const btnImportJson = document.getElementById('btnImportJson');
    if (btnImportJson) {
        btnImportJson.addEventListener('change', importarJSON);
    }
```

Reemplazar por:

```js
    const btnImportJson = document.getElementById('btnImportJson');
    if (btnImportJson) {
        btnImportJson.addEventListener('change', importarJSON);
    }

    // Exportar / Importar — copias del panel Config (mismos handlers que arriba)
    const btnExportJsonCfg = document.getElementById('btnExportJsonCfg');
    if (btnExportJsonCfg) {
        btnExportJsonCfg.addEventListener('click', exportarJSON);
    }
    const btnExportExcelCfg = document.getElementById('btnExportExcelCfg');
    if (btnExportExcelCfg) {
        btnExportExcelCfg.addEventListener('click', exportarExcel);
    }
    const btnImportJsonCfg = document.getElementById('btnImportJsonCfg');
    if (btnImportJsonCfg) {
        btnImportJsonCfg.addEventListener('change', importarJSON);
    }
```

- [ ] **Step 3: Chequeo de sintaxis**

Run: `node --check "su/su_app.js"`
Expected: sin output.

- [ ] **Step 4: Commit**

```bash
git add su/su_index.html su/su_app.js
git commit -m "fix(su): wirear botones export/import del panel Config (IDs duplicados los dejaban muertos)"
```

---

### Task 2: Eliminar el render legacy de biblioteca que apunta a un `<tbody>` inexistente

**Files:**
- Modify: `su/su_app.js:122` (llamada en `SU.init`)
- Modify: `su/su_app.js:499-556` (las 3 funciones: `renderizarBiblioteca`, `agregarMaterial`, `eliminarMaterial`)
- Modify: `su/su_app.js:1432-1435` (call site dentro de `importarJSON`)
- Modify: `su/su_app.js:1620-1623` (call site dentro de `importarMaterialesDesdeJSON`)
- Modify: `su/su_app.js:3281-3284` (entradas en `Object.assign(window, {...})`)

**Contexto:** `renderizarBiblioteca()` (línea 499) hace `document.getElementById('bibliotecaTable')` — confirmado por grep en todo el árbol `biolab-app` que ese ID NO existe en ningún HTML (el único `<tbody>` de biblioteca real en `su_index.html` es `id="cfgBibliotecaTable"`, línea 395, que usa el path vivo `cfgRenderizarBiblioteca()`). El `if (!tbody) return;` hace que sea un no-op silencioso, no un crash. `agregarMaterial()`/`eliminarMaterial()` (líneas 520, 550) también dependen de elementos que no existen en el DOM (`matNombre`, `matTipo`, `matEstado`, `matNotas` — confirmado ausentes de `su_index.html`) y solo se invocan entre sí o desde el HTML generado dinámicamente por la propia `renderizarBiblioteca()` (el `onclick="eliminarMaterial(...)"` que arma en línea 515, que nunca llega a insertarse en el DOM real). Grep en todo el árbol confirma que no hay ningún handler inline en ningún `.html` del repo que llame a `agregarMaterial`/`eliminarMaterial`/`renderizarBiblioteca` — es seguro eliminarlas.

**Hallazgo adicional durante la lectura (no mencionado en el brief de auditoría):** además de la llamada en `SU.init()` (línea 122), hay otras DOS llamadas a `renderizarBiblioteca()` dentro del propio `su_app.js`: una en `importarJSON()` (línea 1434, tras importar un backup con `{materiales, registros}`) y otra en `importarMaterialesDesdeJSON()` (línea 1622). Si se borra la función sin tocar estos dos call sites, ambos flujos (que SÍ son alcanzables desde botones reales) lanzarían `ReferenceError: renderizarBiblioteca is not defined` en cuanto el usuario importe un JSON con materiales — una regresión nueva, peor que el no-op silencioso actual. Este plan borra esas dos llamadas también (pasos 3 y 4), preservando el comportamiento actual (no-op silencioso → ninguna llamada) sin tocar `cfgRenderizarBiblioteca()`/`#cfgBibliotecaTable`, que sigue intacto.

- [ ] **Step 1: Quitar la llamada a `renderizarBiblioteca()` en `SU.init()`**

Buscar:

```js
    try { renderizarBiblioteca(); }        catch (e) { console.warn('SU.init renderBib:', e); }
    try { renderizarRegistroLotes(); }     catch (e) { console.warn('SU.init renderReg:', e); }
```

Reemplazar por:

```js
    try { renderizarRegistroLotes(); }     catch (e) { console.warn('SU.init renderReg:', e); }
```

- [ ] **Step 2: Eliminar las 3 funciones muertas completas**

Buscar el bloque completo desde `function renderizarBiblioteca() {` hasta el `}` de cierre de `eliminarMaterial` (las 3 funciones son consecutivas en el archivo, separadas entre sí por una línea en blanco cada una):

```js
function renderizarBiblioteca() {
    const tbody = document.getElementById('bibliotecaTable');
    if (!tbody) return;
    
    if (!biblioteca.materiales.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Sin materiales registrados</td></tr>';
        return;
    }
    
    tbody.innerHTML = biblioteca.materiales.map(m => `
        <tr>
            <td>${m.id}</td>
            <td>${m.nombre}</td>
            <td>${m.tipo}</td>
            <td>${m.estado}</td>
            <td>${m.notas || '-'}</td>
            <td><button class="btn-remove" onclick="eliminarMaterial('${m.id}')">✕</button></td>
        </tr>
    `).join('');
}

function agregarMaterial() {
    const nombre = document.getElementById('matNombre').value.trim();
    const tipo = document.getElementById('matTipo').value;
    const estado = document.getElementById('matEstado').value;
    const notas = document.getElementById('matNotas').value.trim();
    
    if (!nombre) {
        alert('Ingrese el nombre del material');
        return;
    }
    
    const nuevo = {
        id: 'MAT-' + String(biblioteca.materiales.length + 1).padStart(2, '0'),
        nombre,
        tipo,
        estado,
        notas
    };
    
    biblioteca.materiales.push(nuevo);
    guardarBiblioteca();
    renderizarBiblioteca();
    
    // Limpiar formulario
    document.getElementById('matNombre').value = '';
    document.getElementById('matNotas').value = '';
    
    alert('Material agregado');
}

function eliminarMaterial(id) {
    if (!confirm('¿Eliminar este material?')) return;
    
    biblioteca.materiales = biblioteca.materiales.filter(m => m.id !== id);
    guardarBiblioteca();
    renderizarBiblioteca();
}
```

Reemplazar por: (nada — borrar el bloque completo, dejando la función `guardarBiblioteca()` anterior y el header `// GESTIÓN DE LOTES` posterior tal como están, separados por una única línea en blanco, igual que el resto del archivo)

**Nota para quien implemente:** si al hacer el find-and-replace alguna línea en blanco dentro del bloque no matchea por espacios finales invisibles (son artefactos de copy-paste del archivo original), identificar el bloque por sus límites de firma de función (`function renderizarBiblioteca() {` hasta el `}` de cierre de `eliminarMaterial`) y borrar todo ese rango en vez de depender de un match carácter-por-carácter perfecto en las líneas vacías internas.

- [ ] **Step 3: Quitar el call site dentro de `importarJSON()`**

Buscar:

```js
                    });
                    guardarBiblioteca();
                    renderizarBiblioteca();
                }
```

Reemplazar por:

```js
                    });
                    guardarBiblioteca();
                }
```

- [ ] **Step 4: Quitar el call site dentro de `importarMaterialesDesdeJSON()`**

Buscar:

```js
                    });
                    guardarBiblioteca();
                    renderizarBiblioteca();
                    alert('Materiales importados: ' + data.length);
```

Reemplazar por:

```js
                    });
                    guardarBiblioteca();
                    alert('Materiales importados: ' + data.length);
```

- [ ] **Step 5: Quitar las entradas `agregarMaterial`/`eliminarMaterial` del `Object.assign(window, {...})`**

Buscar:

```js
    importarRegistrosDesdeJSON,
    // Biblioteca de materiales
    agregarMaterial,
    eliminarMaterial,
    // Registros de lotes
```

Reemplazar por:

```js
    importarRegistrosDesdeJSON,
    // Registros de lotes
```

- [ ] **Step 6: Chequeo de sintaxis**

Run: `node --check "su/su_app.js"`
Expected: sin output.

- [ ] **Step 7: Commit**

```bash
git add su/su_app.js
git commit -m "refactor(su): eliminar renderizarBiblioteca/agregarMaterial/eliminarMaterial (apuntaban a bibliotecaTable, inexistente en el DOM)"
```

---

### Task 3: Quitar el doble disparo de `nuevoLote()` en el botón "Nuevo Registro"

**Files:**
- Modify: `su/su_index.html:297`

**Contexto:** `su_index.html:297` tiene `onclick="nuevoLote()"` inline. `inicializarEventos()` en `su_app.js:250` ADEMÁS hace `document.getElementById('btnNuevoLote').addEventListener('click', nuevoLote)`. Cada click dispara `nuevoLote()` dos veces. Se mantiene el `addEventListener` de `su_app.js:250` (no se toca) porque coincide con el patrón de registro explícito de listeners + cleanup vía `onModuleUnload` que usa el resto del archivo, y se quita el `onclick` inline redundante de `su_index.html`.

- [ ] **Step 1: Quitar el `onclick` inline de `btnNuevoLote`**

Buscar:

```html
                <button id="btnNuevoLote" class="btn btn-secondary" onclick="nuevoLote()">➕ Nuevo Registro</button>
```

Reemplazar por:

```html
                <button id="btnNuevoLote" class="btn btn-secondary">➕ Nuevo Registro</button>
```

- [ ] **Step 2: Chequeo de sintaxis**

Run: `node --check "su/su_app.js"`
Expected: sin output.

- [ ] **Step 3: Commit**

```bash
git add su/su_index.html
git commit -m "fix(su): quitar onclick inline redundante en btnNuevoLote (disparaba nuevoLote() dos veces por click)"
```

---

### Task 4: Validar el cambio de `bolsas` en filas existentes cuando ya hay bolsas FR vinculadas

**Files:**
- Modify: `su/su_app.js:1722-1739` (bloque de persistencia de sub-filas dentro de `toggleEdicionRegistros()`)

**Contexto:** FR explota cada fila de `lote.db[]` en `cantidad = r.bolsas` bolsas físicas, asignando `suBolsaIndex` como contador acumulado cruzando TODAS las filas del lote (en `fr/fr_app.js`, no se toca). El badge FR de SU en las cards de Registro (`renderizarRegistroLotes()`, `su_app.js:1081` y `1138`) lee `frMap[i]` donde `i` es el índice de ARRAY de `lote.db[]`, usando el helper `_suGetFRMap(lote)` (`su_app.js:75-87`, ya existente, lee `fr_bolsas` de localStorage y arma `{suBolsaIndex → bolsa}` matcheando por `b.suLoteId === lote.id`). Estos dos esquemas de indexado solo coinciden cuando TODAS las filas tienen `bolsas: 1`. `suDbAddRow()` (`su_app.js:2304`) hardcodea `value="1"` en el campo oculto `.db-bolsas` para filas NUEVAS — pero el campo de edición inline `data-dbfield="bolsas"` (renderizado en `su_app.js:1151` dentro de `renderizarRegistroLotes()`) permite cambiar `bolsas` libremente en una fila EXISTENTE, y su persistencia ocurre en `toggleEdicionRegistros()` (`su_app.js:1734-1735`) sin ninguna validación.

**Fix elegido (mínimo, sin rediseñar el esquema de indexado):** dentro del mismo `forEach` que ya recorre los inputs `.su-edit-db` en `toggleEdicionRegistros()`, cuando `dbfield === 'bolsas'` y el nuevo valor difiere del valor actual y es distinto de `1`, se reutiliza `_suGetFRMap(lotesData[idx])` (mismo helper que ya usa el render de las cards) para chequear si el lote ya tiene bolsas FR vinculadas. Si las tiene, se muestra un `confirm()` explicando el riesgo; si el usuario cancela, el cambio de `bolsas` NO se aplica (el resto de los campos de esa misma fila sí se siguen procesando normalmente en las siguientes iteraciones del `forEach`, porque cada input es una iteración independiente). Si el lote NO tiene bolsas FR vinculadas todavía, el cambio se aplica sin advertencia, igual que hoy.

- [ ] **Step 1: Agregar la validación en el bloque de persistencia de sub-filas**

Buscar:

```js
        // Recolectar ediciones de sub-filas (lote.db[])
        document.querySelectorAll('#registroLotesBody .su-edit-db').forEach(function(input) {
            var idx = parseInt(input.dataset.idx);
            var dbidx = parseInt(input.dataset.dbidx);
            var dbfield = input.dataset.dbfield;
            if (isNaN(idx) || isNaN(dbidx) || !dbfield) return;
            if (!lotesData[idx] || !Array.isArray(lotesData[idx].db)) return;
            if (!lotesData[idx].db[dbidx]) return;

            var val = input.value.trim();

            // Campos numéricos
            if (dbfield === 'bolsas' || dbfield === 'grUsados') {
                lotesData[idx].db[dbidx][dbfield] = parseInt(val) || 0;
            } else {
                lotesData[idx].db[dbidx][dbfield] = val;
            }
        });
```

Reemplazar por:

```js
        // Recolectar ediciones de sub-filas (lote.db[])
        document.querySelectorAll('#registroLotesBody .su-edit-db').forEach(function(input) {
            var idx = parseInt(input.dataset.idx);
            var dbidx = parseInt(input.dataset.dbidx);
            var dbfield = input.dataset.dbfield;
            if (isNaN(idx) || isNaN(dbidx) || !dbfield) return;
            if (!lotesData[idx] || !Array.isArray(lotesData[idx].db)) return;
            if (!lotesData[idx].db[dbidx]) return;

            var val = input.value.trim();

            // Campo "bolsas": el badge FR de las cards (frMap[i] en renderizarRegistroLotes,
            // vía _suGetFRMap) solo coincide con FR cuando TODAS las filas tienen bolsas:1.
            // Si el lote ya tiene bolsas FR vinculadas y se cambia "bolsas" a algo distinto
            // de 1 en una fila existente, avisar antes de aplicar el cambio.
            if (dbfield === 'bolsas') {
                var nuevoValorBolsas = parseInt(val) || 0;
                var valorActualBolsas = lotesData[idx].db[dbidx].bolsas;
                if (nuevoValorBolsas !== valorActualBolsas && nuevoValorBolsas !== 1) {
                    var frMapCheck = _suGetFRMap(lotesData[idx]);
                    if (Object.keys(frMapCheck).length > 0) {
                        var msgBolsas = 'Este lote ya tiene bolsas FR vinculadas (fue enviado a Fructificación).\n\n' +
                            'Cambiar "bolsas" a un valor distinto de 1 en una fila existente puede desalinear ' +
                            'la insignia FR mostrada en esta fila y en todas las filas siguientes del mismo lote.\n\n' +
                            '¿Confirmás el cambio de todos modos?';
                        if (!confirm(msgBolsas)) {
                            return; // cancelado: no se aplica el cambio de bolsas en esta fila
                        }
                    }
                }
                lotesData[idx].db[dbidx][dbfield] = nuevoValorBolsas;
            } else if (dbfield === 'grUsados') {
                lotesData[idx].db[dbidx][dbfield] = parseInt(val) || 0;
            } else {
                lotesData[idx].db[dbidx][dbfield] = val;
            }
        });
```

- [ ] **Step 2: Chequeo de sintaxis**

Run: `node --check "su/su_app.js"`
Expected: sin output.

- [ ] **Step 3: Commit**

```bash
git add su/su_app.js
git commit -m "fix(su): advertir antes de cambiar bolsas!=1 en filas con bolsas FR ya vinculadas (rompía el badge FR)"
```

---

### Task 5: QA manual

**Files:** ninguno (verificación manual, no hay suite de tests en este repo)

- [ ] **Step 1:** levantar `python serve.py` desde `biolab-app/`, abrir el módulo SU en el navegador, abrir la consola de devtools.

- [ ] **Step 2 (Fix 1 — botones Config):** ir al subtab ⚙️ Config → sección "📥 Importar Datos". Click en "💾 Exportar JSON": debe descargar `su-backup-completo-<fecha>.json` (antes de este fix no hacía nada). Click en "📊 Exportar Excel": debe descargar `sustrato_<id>_<fecha>.xlsx` (requiere tener un lote con ID guardado; si no hay ninguno cargado, debe mostrar el alert "Guarde el registro primero antes de exportar", igual que el botón del panel principal). Click en la etiqueta "📥 Importar JSON" del panel Config, seleccionar un JSON exportado en el paso anterior: debe mostrar el alert "Importación completada: ...". Confirmar en consola que no hay errores.

- [ ] **Step 3 (Fix 2 — biblioteca legacy):** recargar el módulo SU y confirmar en consola que no aparece ningún error `ReferenceError` relacionado a `renderizarBiblioteca`/`agregarMaterial`/`eliminarMaterial`. Ir a ⚙️ Config y confirmar que la tabla de materiales (`#cfgBibliotecaTable`) sigue mostrando los materiales normalmente (no se tocó ese path). Repetir el import de JSON del Step 2 pero con un archivo que incluya materiales nuevos en `data.materiales`, y confirmar que no hay ningún error de consola durante el import (antes del fix esto hubiera lanzado `ReferenceError` en cuanto se borrara la función sin ajustar el call site).

- [ ] **Step 4 (Fix 3 — doble disparo de nuevoLote):** en el subtab principal, poner un `console.trace()` temporal al inicio de `nuevoLote()` (o usar un breakpoint de devtools) y hacer click en "➕ Nuevo Registro": debe aparecer UNA sola traza/pausa (antes del fix aparecían dos). Verificación funcional adicional: el formulario debe resetearse correctamente (fecha de hoy, ID autogenerado, campos en 0) igual que antes.

- [ ] **Step 5 (Fix 4 — validación de bolsas con FR vinculado):**
  - Crear un lote SU nuevo con al menos una fila en la tabla DB (Distribución de Bolsas), guardarlo.
  - Navegar al menos una vez al módulo FR (para que `window.FR.createFromSU` quede registrado), volver a SU, cargar el mismo lote y volver a guardarlo (esto dispara el hook `FR.createFromSU(lote)` en `guardarLote()`), o alternativamente verificar directo en consola con `JSON.parse(localStorage.getItem('fr_bolsas')).filter(b => b.suLoteId === '<ID_DEL_LOTE>')` hasta confirmar que existen bolsas FR con ese `suLoteId`.
  - Ir a Registros Guardados → "✏️ Edit", ubicar la fila del lote de prueba, cambiar el campo numérico "Bolsas" de una sub-fila existente a un valor distinto de 1, click en "💾 Save": debe aparecer el `confirm()` de advertencia. Cancelar (Cancel): el valor debe quedar sin cambios (recargar el registro y confirmar `bolsas` sigue igual que antes). Repetir y esta vez Aceptar (OK): el valor debe quedar aplicado.
  - Con un lote SU nuevo que NUNCA fue guardado estando FR montado (sin bolsas FR vinculadas — confirmar con la misma consulta de consola que `fr_bolsas` no tiene ninguna entrada con ese `suLoteId`), repetir el cambio de "Bolsas" a un valor distinto de 1 en modo edición: NO debe aparecer ningún `confirm()`, el cambio debe aplicarse libremente.

---

## Nota de auto-revisión (dejada por el agente que redactó este plan)

Fix 2 tuvo un hallazgo importante no cubierto por el brief original: además de la llamada en `SU.init()`, hay otras 2 llamadas a `renderizarBiblioteca()` (dentro de `importarJSON()` e `importarMaterialesDesdeJSON()`) que habrían quedado como `ReferenceError` si no se hubieran incluido los Steps 3 y 4 de esa tarea. Ya están cubiertas arriba. El resto de los fixes coinciden exactamente con lo esperado.
