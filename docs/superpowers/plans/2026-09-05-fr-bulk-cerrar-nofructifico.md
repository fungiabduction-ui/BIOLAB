# FR — Cierre en lote (Cerrar ciclo / No fructificó) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar botones de acción en lote a las tablas 🟡 Cosecha ("⏹ Cerrar ciclo") y 🟢 Activo ("🕳 No fructificaron") del módulo FR, reusando el mecanismo de selección por checkbox que ya existe para "🗑 Eliminar seleccionados".

**Architecture:** `_renderControlesTabla` gana un 4° parámetro opcional (`bulkExtra`) para inyectar un botón bulk adicional; `FR._actualizarContadorSel` se generaliza para actualizar cualquier botón con la clase `fr-btn-bulk-count` (no solo el de eliminar); dos funciones nuevas (`FR.cerrarCicloSeleccionados` / `FR.noFructificoSeleccionados`) reusan exactamente el cuerpo de cierre de `FR.cerrarCiclo()` / `FR.marcarNoFructifico()`, aplicado en loop con un solo `saveBolsas()`+`renderAll()` al final.

**Tech Stack:** Vanilla JS (IIFE, sin build step), localStorage, sin framework de tests — verificación vía Playwright + Chrome del sistema contra un backup real (ver Task 5).

**Spec:** `docs/superpowers/specs/2026-09-05-fr-bulk-cerrar-nofructifico-design.md`

---

### Task 1: CSS de los botones bulk nuevos

**Files:**
- Modify: `fr/fr_styles.css:142-146` (justo después de `.fr-btn-del-sel:hover`, antes de `.fr-btn-limpiar` en la línea 147)

- [ ] **Step 1: Insertar las dos clases nuevas**

Buscar este bloque exacto (líneas 142-146):

```css
.fr-btn-del-sel:hover {
    background: rgba(255,107,107,0.18);
    transform: translateY(-1px);
}
```

Reemplazarlo por (agrega las dos clases nuevas después, sin tocar la existente):

```css
.fr-btn-del-sel:hover {
    background: rgba(255,107,107,0.18);
    transform: translateY(-1px);
}

.fr-btn-cerrar-sel {
    display: none;
    padding: 6px 14px;
    border-radius: 6px;
    border: 1px solid var(--fr-accent);
    background: rgba(0,255,156,0.08);
    color: var(--fr-accent);
    font-family: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: background .12s, transform .08s;
    white-space: nowrap;
}
.fr-btn-cerrar-sel:hover {
    background: rgba(0,255,156,0.18);
    transform: translateY(-1px);
}

.fr-btn-nofructifico-sel {
    display: none;
    padding: 6px 14px;
    border-radius: 6px;
    border: 1px solid #B79CFF;
    background: rgba(183,156,255,0.08);
    color: #B79CFF;
    font-family: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: background .12s, transform .08s;
    white-space: nowrap;
}
.fr-btn-nofructifico-sel:hover {
    background: rgba(183,156,255,0.18);
    transform: translateY(-1px);
}
```

- [ ] **Step 2: Verificar que no rompió el CSS**

No hay linter de CSS en el repo. Abrir `fr/fr_styles.css` y confirmar visualmente que las llaves cierran bien alrededor de la inserción (no debe haber ningún otro cambio en el archivo).

- [ ] **Step 3: Commit**

```bash
git add fr/fr_styles.css
git commit -m "$(cat <<'EOF'
feat: agrega estilos de botones bulk (cerrar ciclo / no fructifico) en FR

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Generalizar `_renderControlesTabla` y `FR._actualizarContadorSel`

Este task no cambia ningún comportamiento visible todavía (los 3 call sites existentes de `_renderControlesTabla` siguen sin pasar el 4° parámetro) — solo prepara el mecanismo genérico que los Tasks 3 y 4 van a usar.

**Files:**
- Modify: `fr/fr_app.js:1519-1572` (`_renderControlesTabla`)
- Modify: `fr/fr_app.js:1574-1591` (`FR._actualizarContadorSel`)

- [ ] **Step 1: Extender `_renderControlesTabla` con el parámetro `bulkExtra`**

Buscar el bloque exacto (líneas 1519-1572):

```js
    function _renderControlesTabla(controlId, tbodyId, listaTodas) {
        var tbody = document.getElementById(tbodyId);
        if (!tbody) return;
        // Subir: tbody → table → .table-wrap → .section-content
        var tableWrap = tbody.closest('.table-wrap');
        if (!tableWrap) return;
        var sectionContent = tableWrap.parentNode;
        if (!sectionContent) return;

        var ctrl = document.getElementById(controlId);
        var isFirstRender = !ctrl;
        if (isFirstRender) {
            ctrl = document.createElement('div');
            ctrl.id = controlId;
            ctrl.className = 'fr-tabla-controles';
            sectionContent.insertBefore(ctrl, tableWrap);
        }

        if (isFirstRender) {
            // Primer render: construir el DOM completo.
            ctrl.innerHTML =
                '<input type="search" class="fr-search-input"'
                +   ' placeholder="Buscar: ID, SU, GR, Genetica..."'
                +   ' value="' + esc(_frSearch) + '"'
                +   ' oninput="FR._setSearch(this.value)"'
                +   ' title="Buscar por ID FR, lote SU, lote+tanda GR o genetica">'
                + '<select onchange="FR._setFiltroSU(this.value)">'
                +   _opcionesFiltroSU(listaTodas)
                + '</select>'
                + '<label>'
                +   '<input type="checkbox" onchange="FR._selTodo(\'' + tbodyId + '\',this.checked)"> Sel. todo'
                + '</label>'
                + '<button class="fr-btn-del-sel" id="' + controlId + '_btnDel" '
                +   'onclick="FR.eliminarSeleccionados(\'' + tbodyId + '\')">'
                +   '🗑 Eliminar seleccionados (0)'
                + '</button>'
                + '<button class="fr-btn-limpiar" '
                +   'onclick="FR.limpiezaProfundaFR()" title="Elimina bolsas sin trazabilidad SU+GR válida">'
                +   '🧹 Limpiar sin trazabilidad'
                + '</button>';
        } else {
            // Renders subsiguientes: actualización quirúrgica.
            // CRÍTICO: NO reconstruir innerHTML completo — mataría el focus del input
            // si el usuario está escribiendo en el buscador.
            // Solo actualizamos las opciones del <select> (cambian al sincronizar lotes SU)
            // y el valor del input de búsqueda SOLO si no tiene el focus.
            var selEl = ctrl.querySelector('select');
            if (selEl) selEl.innerHTML = _opcionesFiltroSU(listaTodas);
            var searchEl = ctrl.querySelector('.fr-search-input');
            if (searchEl && document.activeElement !== searchEl) {
                searchEl.value = _frSearch;
            }
        }
    }
```

Reemplazarlo por:

```js
    function _renderControlesTabla(controlId, tbodyId, listaTodas, bulkExtra) {
        var tbody = document.getElementById(tbodyId);
        if (!tbody) return;
        // Subir: tbody → table → .table-wrap → .section-content
        var tableWrap = tbody.closest('.table-wrap');
        if (!tableWrap) return;
        var sectionContent = tableWrap.parentNode;
        if (!sectionContent) return;

        var ctrl = document.getElementById(controlId);
        var isFirstRender = !ctrl;
        if (isFirstRender) {
            ctrl = document.createElement('div');
            ctrl.id = controlId;
            ctrl.className = 'fr-tabla-controles';
            sectionContent.insertBefore(ctrl, tableWrap);
        }

        if (isFirstRender) {
            // Primer render: construir el DOM completo.
            // bulkExtra (opcional): { id, cls, labelBase, fnName } — describe un botón de
            // acción en lote adicional al de "Eliminar seleccionados" (ej. Cerrar ciclo en
            // Cosecha, No fructificó en Activo). Ver FR._actualizarContadorSel para cómo
            // se le actualiza el contador.
            var bulkBtnHtml = bulkExtra
                ? '<button class="fr-btn-bulk-count ' + bulkExtra.cls + '" id="' + bulkExtra.id + '" '
                    +   'data-label-base="' + esc(bulkExtra.labelBase) + '" '
                    +   'onclick="' + bulkExtra.fnName + '(\'' + tbodyId + '\')">'
                    +   esc(bulkExtra.labelBase) + ' (0)'
                    + '</button>'
                : '';
            ctrl.innerHTML =
                '<input type="search" class="fr-search-input"'
                +   ' placeholder="Buscar: ID, SU, GR, Genetica..."'
                +   ' value="' + esc(_frSearch) + '"'
                +   ' oninput="FR._setSearch(this.value)"'
                +   ' title="Buscar por ID FR, lote SU, lote+tanda GR o genetica">'
                + '<select onchange="FR._setFiltroSU(this.value)">'
                +   _opcionesFiltroSU(listaTodas)
                + '</select>'
                + '<label>'
                +   '<input type="checkbox" onchange="FR._selTodo(\'' + tbodyId + '\',this.checked)"> Sel. todo'
                + '</label>'
                + '<button class="fr-btn-del-sel fr-btn-bulk-count" id="' + controlId + '_btnDel" '
                +   'data-label-base="🗑 Eliminar seleccionados" '
                +   'onclick="FR.eliminarSeleccionados(\'' + tbodyId + '\')">'
                +   '🗑 Eliminar seleccionados (0)'
                + '</button>'
                + bulkBtnHtml
                + '<button class="fr-btn-limpiar" '
                +   'onclick="FR.limpiezaProfundaFR()" title="Elimina bolsas sin trazabilidad SU+GR válida">'
                +   '🧹 Limpiar sin trazabilidad'
                + '</button>';
        } else {
            // Renders subsiguientes: actualización quirúrgica.
            // CRÍTICO: NO reconstruir innerHTML completo — mataría el focus del input
            // si el usuario está escribiendo en el buscador.
            // Solo actualizamos las opciones del <select> (cambian al sincronizar lotes SU)
            // y el valor del input de búsqueda SOLO si no tiene el focus.
            var selEl = ctrl.querySelector('select');
            if (selEl) selEl.innerHTML = _opcionesFiltroSU(listaTodas);
            var searchEl = ctrl.querySelector('.fr-search-input');
            if (searchEl && document.activeElement !== searchEl) {
                searchEl.value = _frSearch;
            }
        }
    }
```

- [ ] **Step 2: Generalizar `FR._actualizarContadorSel`**

Buscar el bloque exacto (líneas 1574-1591):

```js
    /** Actualiza texto y visibilidad del botón eliminar según checkboxes marcados. */
    FR._actualizarContadorSel = function(tabla) {
        if (!tabla) return;
        var checked = tabla.querySelectorAll('.fr-sel-cb:checked').length;
        // El div de controles es el hermano anterior al .table-wrap que contiene la tabla
        var tableWrap = tabla.closest('.table-wrap');
        if (!tableWrap) return;
        var ctrl = tableWrap.previousElementSibling;
        if (!ctrl || !ctrl.classList.contains('fr-tabla-controles')) return;
        var btn = ctrl.querySelector('.fr-btn-del-sel');
        if (!btn) return;
        if (checked > 0) {
            btn.style.display = '';
            btn.textContent = '🗑 Eliminar seleccionados (' + checked + ')';
        } else {
            btn.style.display = 'none';
        }
    };
```

Reemplazarlo por:

```js
    /** Actualiza texto y visibilidad de TODOS los botones de acción en lote
     *  (`.fr-btn-bulk-count`) de la barra de controles según checkboxes marcados.
     *  Cada botón lleva su label sin contador en `data-label-base`. */
    FR._actualizarContadorSel = function(tabla) {
        if (!tabla) return;
        var checked = tabla.querySelectorAll('.fr-sel-cb:checked').length;
        // El div de controles es el hermano anterior al .table-wrap que contiene la tabla
        var tableWrap = tabla.closest('.table-wrap');
        if (!tableWrap) return;
        var ctrl = tableWrap.previousElementSibling;
        if (!ctrl || !ctrl.classList.contains('fr-tabla-controles')) return;
        ctrl.querySelectorAll('.fr-btn-bulk-count').forEach(function(btn) {
            var base = btn.dataset.labelBase || '';
            if (checked > 0) {
                btn.style.display = '';
                btn.textContent = base + ' (' + checked + ')';
            } else {
                btn.style.display = 'none';
            }
        });
    };
```

- [ ] **Step 3: Chequeo de sintaxis**

Run: `node --check "fr/fr_app.js"`
Expected: sin salida (exit code 0).

- [ ] **Step 4: Commit**

```bash
git add fr/fr_app.js
git commit -m "$(cat <<'EOF'
feat: generaliza _renderControlesTabla y el contador de seleccion en FR

Prepara el mecanismo para agregar botones de accion en lote ademas de
"Eliminar seleccionados", sin cambiar comportamiento visible todavia.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Bulk "Cerrar ciclo" en 🟡 Cosecha

**Files:**
- Modify: `fr/fr_app.js:1716` (call site dentro de `renderCosecha`)
- Modify: `fr/fr_app.js` (nueva función `FR.cerrarCicloSeleccionados`, insertada después de `FR.cerrarCiclo`, que termina en la línea 3594 antes de este task — puede haber corrido 1-2 líneas por el Task 2, ubicar por el contenido)

- [ ] **Step 1: Wirear `renderCosecha` para pasar la config del botón bulk**

Buscar (dentro de `renderCosecha`):

```js
        _renderControlesTabla('frControlesCosecha', 'frCosechaBody', todasCosecha);
```

Reemplazar por:

```js
        _renderControlesTabla('frControlesCosecha', 'frCosechaBody', todasCosecha, {
            id: 'frBtnCerrarCicloSel', cls: 'fr-btn-cerrar-sel',
            labelBase: '⏹ Cerrar ciclo', fnName: 'FR.cerrarCicloSeleccionados'
        });
```

- [ ] **Step 2: Agregar `FR.cerrarCicloSeleccionados`**

Ubicar el final de `FR.cerrarCiclo` — termina en este bloque:

```js
        addObsTo(b, 'Ciclo cerrado manualmente. Bolsa archivada.', 'manual', 'none');
        b.estado = computeEstado(b);
        if (b.estado !== prevEstado) {
            addObsTo(b, 'Estado: ' + prevEstado + ' -> ' + b.estado, 'auto', 'none');
        }
        saveBolsas();
        renderAll();
    };
```

Insertar inmediatamente después de ese `};` (antes del comentario de `FR.marcarContaminada`):

```js

    // ------------------------------------------------------
    // CERRAR CICLO EN LOTE (bulk, reversible bolsa por bolsa).
    // Mismo cuerpo que la rama de cierre de FR.cerrarCiclo() de arriba —
    // nunca la de reabrir ni el guard de contaminada, porque 🟡 Cosecha
    // excluye por construcción cualquier bolsa ya archivada (esCosecha()
    // la filtra antes de que llegue a esta tabla). Un solo
    // saveBolsas()+renderAll() al final, no uno por bolsa.
    // ------------------------------------------------------
    FR.cerrarCicloSeleccionados = function(tbodyId) {
        var tbody = document.getElementById(tbodyId);
        if (!tbody) return;
        var cbs = tbody.querySelectorAll('.fr-sel-cb:checked');
        if (cbs.length === 0) return;
        var ids = [];
        cbs.forEach(function(cb) { if (cb.dataset.frId) ids.push(cb.dataset.frId); });
        var seleccion = bolsas.filter(function(b) { return ids.indexOf(b.id) !== -1; });
        // Filtro defensivo: no debería haber ninguna archivada en esta selección
        // (esCosecha() ya las excluye de la tabla), pero se revalida justo antes
        // de mutar por si el dato cambió entre el último render y este click.
        var validas = seleccion.filter(function(b) {
            return b.contaminada !== true && b.cicloCerrado !== true &&
                   b.noFructifico !== true && b.cancelada !== true;
        });
        if (validas.length === 0) {
            alert('Ninguna de las bolsas seleccionadas puede cerrarse (ya están archivadas).');
            return;
        }
        var omitidas = seleccion.length - validas.length;
        var preview = validas.slice(0, 15).map(function(b) { return '• ' + b.id; }).join('\n');
        if (validas.length > 15) preview += '\n...y ' + (validas.length - 15) + ' más';
        var msg = 'Cerrar ciclo de ' + validas.length + ' bolsa(s)?\n\n' + preview
            + (omitidas > 0 ? '\n\n(' + omitidas + ' seleccionada(s) se omiten: ya están archivadas)' : '')
            + '\n\nSe archivarán en 🔴 Archivo. Es reversible: se pueden reabrir individualmente desde ahí.';
        if (!confirm(msg)) return;

        validas.forEach(function(b) {
            var prevEstado = computeEstado(b);
            b.cicloCerrado = true;
            var _lastFecha = null;
            (b.flushes || []).forEach(function(f) {
                if (f && f.fecha && (!_lastFecha || f.fecha > _lastFecha)) _lastFecha = f.fecha;
            });
            b.fechaCierreCiclo = _lastFecha ? _lastFecha.substring(0, 10) : hoyISO();
            addObsTo(b, 'Ciclo cerrado en lote (bulk) desde Cosecha.', 'manual', 'none');
            b.estado = computeEstado(b);
            if (b.estado !== prevEstado) {
                addObsTo(b, 'Estado: ' + prevEstado + ' -> ' + b.estado, 'auto', 'none');
            }
        });
        saveBolsas();
        renderAll();
        alert('✅ ' + validas.length + ' bolsa(s) con ciclo cerrado.');
    };
```

- [ ] **Step 3: Chequeo de sintaxis**

Run: `node --check "fr/fr_app.js"`
Expected: sin salida (exit code 0).

- [ ] **Step 4: Commit**

```bash
git add fr/fr_app.js
git commit -m "$(cat <<'EOF'
feat: agrega cierre de ciclo en lote a la tabla de Cosecha en FR

Permite seleccionar varias bolsas con checkbox y cerrar su ciclo de
una sola vez, en vez de una por una desde el Dashboard.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Bulk "No fructificó" en 🟢 Activo

**Files:**
- Modify: `fr/fr_app.js:1665` (call site dentro de `renderActivos`)
- Modify: `fr/fr_app.js` (nueva función `FR.noFructificoSeleccionados`, insertada después de `FR.marcarNoFructifico`)

- [ ] **Step 1: Wirear `renderActivos` para pasar la config del botón bulk**

Buscar (dentro de `renderActivos`):

```js
        _renderControlesTabla('frControlesActivos', 'frActivosBody', todasEnCultivo);
```

Reemplazar por:

```js
        _renderControlesTabla('frControlesActivos', 'frActivosBody', todasEnCultivo, {
            id: 'frBtnNoFructificoSel', cls: 'fr-btn-nofructifico-sel',
            labelBase: '🕳 No fructificaron', fnName: 'FR.noFructificoSeleccionados'
        });
```

- [ ] **Step 2: Agregar `FR.noFructificoSeleccionados`**

Ubicar el final de `FR.marcarNoFructifico` — termina en este bloque:

```js
        addObsTo(b, 'Bolsa marcada como NO FRUCTIFICÓ desde FR. Archivada.', 'manual', 'yellow');
        b.estado = computeEstado(b);
        if (b.estado !== prevEstado) {
            addObsTo(b, 'Estado: ' + prevEstado + ' -> ' + b.estado, 'auto', 'none');
        }
        saveBolsas();
        renderAll();
    };
```

Insertar inmediatamente después de ese `};` (antes del comentario de `FR.recomputeFlushesLive`):

```js

    // ------------------------------------------------------
    // NO FRUCTIFICÓ EN LOTE (bulk, reversible bolsa por bolsa).
    // Mismo cuerpo que la rama de cierre de FR.marcarNoFructifico() de
    // arriba — nunca la de reabrir ni los guards de contaminada/
    // cicloCerrado/flushes>0, porque 🟢 Activo excluye por construcción
    // cualquier bolsa con esas condiciones (esEnCultivo() la filtra antes
    // de que llegue a esta tabla). Un solo saveBolsas()+renderAll() al
    // final, no uno por bolsa.
    // ------------------------------------------------------
    FR.noFructificoSeleccionados = function(tbodyId) {
        var tbody = document.getElementById(tbodyId);
        if (!tbody) return;
        var cbs = tbody.querySelectorAll('.fr-sel-cb:checked');
        if (cbs.length === 0) return;
        var ids = [];
        cbs.forEach(function(cb) { if (cb.dataset.frId) ids.push(cb.dataset.frId); });
        var seleccion = bolsas.filter(function(b) { return ids.indexOf(b.id) !== -1; });
        // Filtro defensivo: no debería haber ninguna archivada ni con cosechas
        // en esta selección (esEnCultivo() ya las excluye de la tabla), pero se
        // revalida justo antes de mutar por si el dato cambió entre el último
        // render y este click.
        var validas = seleccion.filter(function(b) {
            return b.contaminada !== true && b.cicloCerrado !== true &&
                   b.noFructifico !== true && b.cancelada !== true &&
                   (!Array.isArray(b.flushes) || b.flushes.length === 0);
        });
        if (validas.length === 0) {
            alert('Ninguna de las bolsas seleccionadas puede marcarse (ya archivadas o con cosechas).');
            return;
        }
        var omitidas = seleccion.length - validas.length;
        var preview = validas.slice(0, 15).map(function(b) { return '• ' + b.id; }).join('\n');
        if (validas.length > 15) preview += '\n...y ' + (validas.length - 15) + ' más';
        var msg = 'Marcar ' + validas.length + ' bolsa(s) como NO FRUCTIFICÓ?\n\n' + preview
            + (omitidas > 0 ? '\n\n(' + omitidas + ' seleccionada(s) se omiten: ya archivadas o con cosechas)' : '')
            + '\n\nSe archivarán en 🔴 Archivo. Es reversible individualmente desde ahí.';
        if (!confirm(msg)) return;

        validas.forEach(function(b) {
            var prevEstado = computeEstado(b);
            b.noFructifico = true;
            b.fechaNoFructifico = hoyISO();
            addObsTo(b, 'Bolsa marcada como NO FRUCTIFICÓ en lote (bulk) desde Activo.', 'manual', 'yellow');
            b.estado = computeEstado(b);
            if (b.estado !== prevEstado) {
                addObsTo(b, 'Estado: ' + prevEstado + ' -> ' + b.estado, 'auto', 'none');
            }
        });
        saveBolsas();
        renderAll();
        alert('✅ ' + validas.length + ' bolsa(s) marcada(s) como no fructificó.');
    };
```

- [ ] **Step 3: Chequeo de sintaxis**

Run: `node --check "fr/fr_app.js"`
Expected: sin salida (exit code 0).

- [ ] **Step 4: Commit**

```bash
git add fr/fr_app.js
git commit -m "$(cat <<'EOF'
feat: agrega marcado de No fructifico en lote a la tabla Activo en FR

Mismo mecanismo que el cierre de ciclo en lote de Cosecha, pero
usando el estado terminal correcto para bolsas con 0 cosechas.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Verificación en navegador real contra datos reales

Este proyecto no tiene framework de tests (sin `package.json`, sin Jest) y maneja datos reales de
laboratorio de alto valor — la verificación de cualquier feature que toque UI se hace corriendo la
app real en Chrome (vía Playwright) contra un backup real exportado por el usuario, nunca solo
razonando sobre el código o con un script Node aislado.

**Files:**
- Create: `<scratchpad>/verify_fr_bulk.js` (script de verificación, no se commitea al repo)

- [ ] **Step 1: Instalar playwright-core en el scratchpad**

El repo no tiene `package.json` — se instala localmente en el directorio scratchpad de la sesión.

Run (reemplazar `<scratchpad>` por el directorio scratchpad real de la sesión activa):
```bash
cd "<scratchpad>"
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install playwright-core --no-audit --no-fund
```
Expected: instala sin descargar Chromium (se reusa el Chrome del sistema).

- [ ] **Step 2: Levantar el servidor local**

Run (en background, puerto documentado en `CLAUDE.md` — NO usar 8000):
```bash
cd "c:/Users/JET/Desktop/MOBY DICK/biolab-app"
python -m http.server 8734
```
Dejarlo corriendo en background durante todo este task.

- [ ] **Step 3: Escribir el script de verificación**

Crear `<scratchpad>/verify_fr_bulk.js`:

```js
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

(async () => {
  const backupPath = process.argv[2];
  if (!backupPath) { console.error('Uso: node verify_fr_bulk.js <ruta-backup.json>'); process.exit(1); }
  const raw = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  delete raw['bl2_gh']; // nunca cargar el token de GitHub en un perfil descartable

  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true
  });
  const page = await browser.newPage();

  const errores = [];
  page.on('pageerror', e => errores.push('pageerror: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error') errores.push('console.error: ' + msg.text()); });
  page.on('dialog', async dialog => {
    console.log('DIALOG[' + dialog.type() + ']: ' + dialog.message().slice(0, 200));
    await dialog.accept();
  });

  await page.goto('http://localhost:8734/');
  await page.evaluate((data) => {
    Object.keys(data).forEach(k => localStorage.setItem(k, data[k]));
  }, raw);

  await page.goto('http://localhost:8734/#FR');
  await page.waitForTimeout(1500);

  // ── Cosecha: bulk "Cerrar ciclo" ──────────────────────────────
  await page.click('[data-frtab="cosecha"]');
  await page.waitForTimeout(500);

  const idsCosecha = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('#frCosechaBody .fr-sel-cb')).slice(0, 2).map(cb => cb.dataset.frId);
  });
  console.log('IDs elegidos en Cosecha:', idsCosecha);
  if (idsCosecha.length < 2) { console.error('No hay suficientes bolsas en Cosecha en este backup — elegir otro backup.'); }

  for (const id of idsCosecha) {
    await page.click('#frCosechaBody .fr-sel-cb[data-fr-id="' + id + '"]');
  }
  console.log('Label boton bulk cerrar ciclo (antes de click):', await page.textContent('#frBtnCerrarCicloSel'));

  const cicloCerradoAntes = await page.evaluate(() => {
    return JSON.parse(localStorage.getItem('fr_bolsas') || '[]').filter(b => b.cicloCerrado === true).length;
  });

  await page.click('#frBtnCerrarCicloSel');
  await page.waitForTimeout(500);

  const resultCosecha = await page.evaluate((ids) => {
    const bolsas = JSON.parse(localStorage.getItem('fr_bolsas') || '[]');
    const marcadas = bolsas.filter(b => ids.includes(b.id));
    return {
      totalCicloCerradoAhora: bolsas.filter(b => b.cicloCerrado === true).length,
      marcadas: marcadas.map(b => ({
        id: b.id, cicloCerrado: b.cicloCerrado, fechaCierreCiclo: b.fechaCierreCiclo,
        ultimaObs: (b.observaciones || []).slice(-2).map(o => o.texto)
      }))
    };
  }, idsCosecha);
  console.log('cicloCerrado antes:', cicloCerradoAntes, '-> después:', resultCosecha.totalCicloCerradoAhora);
  console.log('Detalle bolsas cerradas:', JSON.stringify(resultCosecha.marcadas, null, 2));

  // Bolsas cerradas deben desaparecer de Cosecha (recarga la vista y confirma)
  const siguenEnCosecha = await page.evaluate((ids) => {
    return Array.from(document.querySelectorAll('#frCosechaBody .fr-sel-cb'))
      .map(cb => cb.dataset.frId).filter(id => ids.includes(id));
  }, idsCosecha);
  console.log('IDs cerrados que siguen apareciendo en Cosecha (debe ser []):', siguenEnCosecha);

  // ── Activo: bulk "No fructificó" ──────────────────────────────
  await page.click('[data-frtab="activos"]');
  await page.waitForTimeout(500);

  const idsActivo = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('#frActivosBody .fr-sel-cb')).slice(0, 2).map(cb => cb.dataset.frId);
  });
  console.log('IDs elegidos en Activo:', idsActivo);
  if (idsActivo.length < 2) { console.error('No hay suficientes bolsas en Activo en este backup — elegir otro backup.'); }

  for (const id of idsActivo) {
    await page.click('#frActivosBody .fr-sel-cb[data-fr-id="' + id + '"]');
  }
  console.log('Label boton bulk no fructifico (antes de click):', await page.textContent('#frBtnNoFructificoSel'));

  await page.click('#frBtnNoFructificoSel');
  await page.waitForTimeout(500);

  const resultActivo = await page.evaluate((ids) => {
    const bolsas = JSON.parse(localStorage.getItem('fr_bolsas') || '[]');
    return bolsas.filter(b => ids.includes(b.id)).map(b => ({
      id: b.id, noFructifico: b.noFructifico, fechaNoFructifico: b.fechaNoFructifico,
      ultimaObs: (b.observaciones || []).slice(-2).map(o => o.texto)
    }));
  }, idsActivo);
  console.log('Detalle bolsas marcadas no fructifico:', JSON.stringify(resultActivo, null, 2));

  // ── Archivo: las 4 bolsas deben aparecer ahora ──────────────────
  await page.click('[data-frtab="archivo"]');
  await page.waitForTimeout(500);
  const enArchivo = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('#frArchivoBody .fr-sel-cb')).map(cb => cb.dataset.frId);
  });
  const esperadas = idsCosecha.concat(idsActivo);
  const faltantes = esperadas.filter(id => !enArchivo.includes(id));
  console.log('Bolsas esperadas en Archivo que NO aparecen (debe ser []):', faltantes);

  console.log('--- Errores de consola/pagina (debe ser 0) ---');
  console.log(errores.length ? errores : 'ninguno');

  await browser.close();
  process.exit(errores.length ? 1 : 0);
})();
```

- [ ] **Step 4: Correr el script contra un backup real**

Run:
```bash
cd "<scratchpad>"
node verify_fr_bulk.js "c:/Users/JET/Desktop/MOBY DICK/biolab-app/biolab-backup-FECHA_03-09-2026_HORA_12-02-44_CON-RESUMENES.json"
```

Expected (chequear en la salida real, no asumir):
- `IDs elegidos en Cosecha`/`IDs elegidos en Activo`: 2 ids cada uno (este backup tiene 47 bolsas en Cosecha y 18 en Activo, así que debería haber de sobra).
- Label del botón antes de click: `⏹ Cerrar ciclo (2)` y `🕳 No fructificaron (2)` respectivamente.
- `cicloCerrado antes -> después`: el número después debe ser `antes + 2`.
- `Detalle bolsas cerradas`: las 2 bolsas con `cicloCerrado: true`, `fechaCierreCiclo` con una fecha válida, y la última observación conteniendo `"Ciclo cerrado en lote (bulk) desde Cosecha."`.
- `IDs cerrados que siguen apareciendo en Cosecha`: `[]` (deben haber desaparecido de esa tabla).
- `Detalle bolsas marcadas no fructifico`: las 2 bolsas con `noFructifico: true`, `fechaNoFructifico` con la fecha de hoy, y observación conteniendo `"Bolsa marcada como NO FRUCTIFICÓ en lote (bulk) desde Activo."`.
- `Bolsas esperadas en Archivo que NO aparecen`: `[]` (las 4 deben aparecer en Archivo).
- Errores de consola/página: `ninguno`.

- [ ] **Step 5: Si algo falla, diagnosticar antes de tocar código de nuevo**

Si aparece algún error de consola o un resultado inesperado, usar `superpowers:systematic-debugging`
antes de aplicar cualquier fix — no adivinar. Volver a correr el Step 4 completo después de
cualquier cambio (no asumir que un fix puntual alcanza sin re-verificar el flujo entero).

- [ ] **Step 6: Detener el servidor local**

Terminar el proceso `python -m http.server 8734` iniciado en el Step 2.

---

### Task 6: Documentar el invariante en `CLAUDE.md` y `CHANGELOG.md`

`CLAUDE.md`, `BIOLAB_SYSTEM.md` y `CHANGELOG.md` están en `.gitignore` (notas internas, nunca se
suben al repo público) — este task edita archivos locales, **no lleva commit de git**.

**Files:**
- Modify: `CLAUDE.md` (sección "INVARIANTES VIGENTES — de sesiones de fixes recientes")
- Modify: `CHANGELOG.md` (nueva entrada `## 2026-09-05` al principio, después del header de nota interna)

- [ ] **Step 1: Agregar el invariante a `CLAUDE.md`**

Al final de la sección "INVARIANTES VIGENTES — de sesiones de fixes recientes" (después de la
última entrada, la de 2026-09-02 sobre `noFructifico`), agregar:

```markdown
- **FR — Cierre en lote de Cosecha/Activo (2026-09-05).** `FR.cerrarCicloSeleccionados()` /
  `FR.noFructificoSeleccionados()` aplican, respectivamente, `FR.cerrarCiclo()` y
  `FR.marcarNoFructifico()` a varias bolsas a la vez, seleccionadas con los checkboxes `.fr-sel-cb`
  que ya existían para "🗑 Eliminar seleccionados". El botón bulk de Cosecha ("⏹ Cerrar ciclo")
  vive únicamente en `frControlesCosecha`, el de Activo ("🕳 No fructificaron") únicamente en
  `frControlesActivos` — nunca el mismo botón en ambas pestañas, porque `cicloCerrado` sella el
  último flush de una bolsa que sí produjo y `noFructifico` es el estado hermano para 0 cosechas
  (ver entrada 2026-09-02 arriba); como `esCosecha()`/`esEnCultivo()` garantizan por construcción
  que toda fila de esas tablas tiene ≥1 / 0 flushes respectivamente, cada botón solo puede
  dispararse donde su precondición ya es cierta. `_renderControlesTabla` ganó un 4° parámetro
  opcional (`bulkExtra: {id, cls, labelBase, fnName}`) para inyectar este tipo de botón sin
  duplicar el HTML de la barra de controles; `FR._actualizarContadorSel` se generalizó para
  actualizar cualquier botón con la clase `fr-btn-bulk-count` (antes solo tocaba el de eliminar) —
  cualquier acción bulk futura en estas tablas debería sumarse por este mismo mecanismo, no
  reinventando la barra de controles. Ambas funciones nuevas hacen un solo `saveBolsas()`+
  `renderAll()` al final del lote (no uno por bolsa) y filtran defensivamente cualquier bolsa ya
  archivada de la selección antes de mutar, aunque no debería poder ocurrir dado que ninguna de
  las dos tablas muestra bolsas archivadas. Verificado con Playwright + Chrome del sistema contra
  el backup real `biolab-backup-FECHA_03-09-2026_HORA_12-02-44_CON-RESUMENES.json`.
```

- [ ] **Step 2: Agregar la entrada a `CHANGELOG.md`**

Justo después del bloque de nota interna al principio del archivo (después de la línea que dice
"Cuando existe spec formal, el link va a `docs/superpowers/specs/`.") e inmediatamente antes de la
sección `## 2026-08-18` ya existente, insertar:

```markdown
## 2026-09-05

- **FR — cierre en lote de bolsas en Cosecha/Activo, a pedido del usuario ("tengo muchas bolsas
  acumuladas que están en cosecha que el ciclo ya se cerró pero siguen estando").** Antes,
  `FR.cerrarCiclo()`/`FR.marcarNoFructifico()` solo operaban sobre una bolsa a la vez desde el
  Dashboard. Se agregaron dos botones bulk reusando el mecanismo de selección por checkbox que ya
  existía para "🗑 Eliminar seleccionados": "⏹ Cerrar ciclo" en 🟡 Cosecha, "🕳 No fructificaron" en
  🟢 Activo — nunca el mismo botón en las dos pestañas, para no violar el invariante
  `cicloCerrado` (bolsa que sí produjo) vs `noFructifico` (0 cosechas) del 2026-09-02. Detalle
  completo del diseño en `docs/superpowers/specs/2026-09-05-fr-bulk-cerrar-nofructifico-design.md`
  y del invariante resultante en `CLAUDE.md`.
- Verificado con Playwright + Chrome del sistema contra un backup real (47 bolsas en Cosecha, 18
  en Activo): cerrar 2 bolsas de Cosecha en lote las marca `cicloCerrado:true` con
  `fechaCierreCiclo` correcta y las mueve a Archivo; marcar 2 bolsas de Activo como no fructificó
  las marca `noFructifico:true` con `fechaNoFructifico` de hoy y también las mueve a Archivo; 0
  errores de consola/página nuevos.

```

- [ ] **Step 3: Confirmar que estos dos archivos NO quedaron en el staging de git**

Run: `git status --short`
Expected: `CLAUDE.md` y `CHANGELOG.md` no aparecen en la salida (siguen ignorados). Si aparecen,
**no** hacer `git add` sobre ellos — revisar `.gitignore` antes de continuar, algo se rompió.
