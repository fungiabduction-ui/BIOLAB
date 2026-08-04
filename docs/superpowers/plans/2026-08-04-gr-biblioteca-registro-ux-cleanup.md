# GR — Rename Biblioteca, edición por-tabla, cleanup de Registro Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Renombrar la sub-pestaña `⚙️ Config` de GR a `📚 Biblioteca` (evita confusión con el módulo CFG del pipeline), reemplazar el botón Edit global de la Biblioteca de Ingredientes (hoy disfrazado de 4ª pestaña, con un bug real de bleed entre tablas) por un toggle Edit/Save independiente por tabla (Agentes/Aditivos/Granos) que además hace editables Densidad/Volumen típico/Notas (hoy texto fijo), y reordenar/achicar los controles de la sub-pestaña Registro (botón Edit y "Limpiar inválidos").

**Architecture:** Todos los cambios son ediciones puntuales dentro de `gr/gr_app.js` (IIFE única), `gr/gr_index.html` (HTML con `onclick` inline que llama funciones expuestas en `window`) y `gr/gr_styles.css`. Sin cambios de schema en `localStorage` — `gr_biblioteca` y `gr_lotes` mantienen exactamente la misma forma; solo se hacen alcanzables desde la UI campos que ya existían en el objeto (`densidadTipica`, `volumenTipico`, `notas`).

**Tech Stack:** Vanilla JS (IIFE), localStorage, sin test framework — verificación es `node --check` para sintaxis + QA manual en navegador real (este repo no tiene suite de tests automatizados).

Spec completa: `docs/superpowers/specs/2026-08-04-gr-biblioteca-registro-ux-cleanup-design.md`

---

### Task 1: Rename sub-pestaña `cfg` → `bib`

**Files:**
- Modify: `gr/gr_index.html:22, 513, 653`
- Modify: `gr/gr_app.js:3081-3128` (funciones `goToConfig` y `GR.subTab`)

**Contexto:** El string interno `'cfg'` de esta sub-pestaña (nav button, id de panel, lógica de `GR.subTab`) no se usa en ningún otro archivo del repo — confirmado por grep de todo el repo antes de escribir este plan. Cambio autocontenido a `gr/`. El H2 dentro del panel ya dice "⚙️ Biblioteca de Ingredientes" — el nombre de pestaña pasa a coincidir.

- [ ] **Step 1: Renombrar el botón de navegación en `gr_index.html`**

Buscar (línea 22):

```html
            <button type="button" class="gr-subtab" data-grtab="cfg" onclick="GR.subTab('cfg')">⚙️ Config</button>
```

Reemplazar por:

```html
            <button type="button" class="gr-subtab" data-grtab="bib" onclick="GR.subTab('bib')">📚 Biblioteca</button>
```

- [ ] **Step 2: Renombrar el id del panel en `gr_index.html`**

Buscar (línea 513):

```html
        <div id="gr-sub-cfg" class="gr-subpanel" style="display:none">
```

Reemplazar por:

```html
        <div id="gr-sub-bib" class="gr-subpanel" style="display:none">
```

- [ ] **Step 3: Actualizar el comentario de cierre en `gr_index.html`**

Buscar (línea 653):

```html
        </div><!-- /#gr-sub-cfg -->
```

Reemplazar por:

```html
        </div><!-- /#gr-sub-bib -->
```

- [ ] **Step 4: Renombrar `goToConfig` y actualizar `GR.subTab` en `gr_app.js`**

Buscar:

```js
GR.goToConfig = window.goToConfig = function goToConfig() {
    // Si existe el sub-panel embebido, usar tab switching en lugar de navegar
    if (document.getElementById('gr-sub-cfg')) {
        GR.subTab('cfg');
        return;
    }
};
GR.goToIndex = window.goToIndex = function goToIndex() {
    // Si existe el sub-panel embebido, volver al panel principal
    if (document.getElementById('gr-sub-main')) {
        GR.subTab('main');
        return;
    }
    window.location.href = 'gr_index.html';
};

// Sub-tab switcher (Formulación <-> Registro <-> Config)
GR.subTab = window.grSubTab = function grSubTab(t) {
    var tabs = document.querySelectorAll('.gr-subtab');
    tabs.forEach(function(tb) { tb.classList.remove('active'); });
    var active = document.querySelector('.gr-subtab[data-grtab="' + t + '"]');
    if (active) active.classList.add('active');

    var pMain = document.getElementById('gr-sub-main');
    var pReg  = document.getElementById('gr-sub-reg');
    var pCfg  = document.getElementById('gr-sub-cfg');
    var pKnow = document.getElementById('gr-sub-know');

    if (pMain) {
        pMain.style.display = (t === 'main') ? 'flex' : 'none';
        if (t === 'main') pMain.classList.add('active'); else pMain.classList.remove('active');
    }
    if (pReg) {
        pReg.style.display = (t === 'reg') ? 'flex' : 'none';
        if (t === 'reg') pReg.classList.add('active'); else pReg.classList.remove('active');
    }
    if (t === 'reg') grRenderizarRegistroLotes();
    if (pCfg) {
        pCfg.style.display = (t === 'cfg') ? 'flex' : 'none';
        if (t === 'cfg') pCfg.classList.add('active'); else pCfg.classList.remove('active');
    }
    if (t === 'cfg' && typeof renderizarBibliotecaEnConfig === 'function') renderizarBibliotecaEnConfig();
    if (pKnow) {
        pKnow.style.display = (t === 'know') ? 'flex' : 'none';
        if (t === 'know') pKnow.classList.add('active'); else pKnow.classList.remove('active');
    }
    if (t === 'know' && typeof window.grRenderKnowledge === 'function') window.grRenderKnowledge();
};
```

Reemplazar por:

```js
GR.goToBiblioteca = window.goToBiblioteca = function goToBiblioteca() {
    // Si existe el sub-panel embebido, usar tab switching en lugar de navegar
    if (document.getElementById('gr-sub-bib')) {
        GR.subTab('bib');
        return;
    }
};
GR.goToIndex = window.goToIndex = function goToIndex() {
    // Si existe el sub-panel embebido, volver al panel principal
    if (document.getElementById('gr-sub-main')) {
        GR.subTab('main');
        return;
    }
    window.location.href = 'gr_index.html';
};

// Sub-tab switcher (Formulación <-> Registro <-> Biblioteca)
GR.subTab = window.grSubTab = function grSubTab(t) {
    var tabs = document.querySelectorAll('.gr-subtab');
    tabs.forEach(function(tb) { tb.classList.remove('active'); });
    var active = document.querySelector('.gr-subtab[data-grtab="' + t + '"]');
    if (active) active.classList.add('active');

    var pMain = document.getElementById('gr-sub-main');
    var pReg  = document.getElementById('gr-sub-reg');
    var pBib  = document.getElementById('gr-sub-bib');
    var pKnow = document.getElementById('gr-sub-know');

    if (pMain) {
        pMain.style.display = (t === 'main') ? 'flex' : 'none';
        if (t === 'main') pMain.classList.add('active'); else pMain.classList.remove('active');
    }
    if (pReg) {
        pReg.style.display = (t === 'reg') ? 'flex' : 'none';
        if (t === 'reg') pReg.classList.add('active'); else pReg.classList.remove('active');
    }
    if (t === 'reg') grRenderizarRegistroLotes();
    if (pBib) {
        pBib.style.display = (t === 'bib') ? 'flex' : 'none';
        if (t === 'bib') pBib.classList.add('active'); else pBib.classList.remove('active');
    }
    if (t === 'bib' && typeof renderizarBibliotecaEnConfig === 'function') renderizarBibliotecaEnConfig();
    if (pKnow) {
        pKnow.style.display = (t === 'know') ? 'flex' : 'none';
        if (t === 'know') pKnow.classList.add('active'); else pKnow.classList.remove('active');
    }
    if (t === 'know' && typeof window.grRenderKnowledge === 'function') window.grRenderKnowledge();
};
```

- [ ] **Step 5: Chequeo de sintaxis**

Run: `node --check "gr/gr_app.js"`
Expected: sin output.

- [ ] **Step 6: Verificación visual**

Abrir `gr/gr_index.html` en el navegador. Confirmar: la pestaña se llama "📚 Biblioteca", hace click y muestra el panel de Agentes/Aditivos/Granos igual que antes. Las pestañas Formulación/Registro/Conocimiento siguen funcionando.

- [ ] **Step 7: Commit**

```bash
git add gr/gr_app.js gr/gr_index.html
git commit -m "refactor(gr): renombrar sub-pestaña Config a Biblioteca para evitar confusion con el modulo CFG del pipeline"
```

---

### Task 2: CSS — botón toggle Edit/Save chico + layout de título de tabla

**Files:**
- Modify: `gr/gr_styles.css:941-947`

**Contexto:** Cambio puramente aditivo — agrega una clase nueva (`.btn-edit-toggle`) que van a usar Task 3 (Biblioteca, 3 botones) y Task 4 (Registro, 1 botón). No modifica ninguna regla existente excepto `.config-list-title`, a la que le agrega `display:flex` para poder alinear el título del texto junto al botón de esa tabla.

- [ ] **Step 1: Editar `.config-list-title` y agregar `.btn-edit-toggle`**

Buscar:

```css
.config-list-title {
    font-size: 0.95rem;
    color: var(--secondary);
    margin: 20px 0 10px;
    padding-top: 15px;
    border-top: 1px solid var(--border);
}
```

Reemplazar por:

```css
.config-list-title {
    font-size: 0.95rem;
    color: var(--secondary);
    margin: 20px 0 10px;
    padding-top: 15px;
    border-top: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
}

/* ========================================
   TOGGLE EDIT/SAVE — botón chico de 2 estados.
   Usado en Biblioteca (uno por tabla) y en Registro.
   ======================================== */
.btn-edit-toggle {
    padding: 6px 14px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--dark-tertiary);
    color: var(--text-light);
    cursor: pointer;
    font-size: 0.8rem;
    font-weight: 600;
    white-space: nowrap;
}

.btn-edit-toggle:hover {
    background: #454545;
}

.btn-edit-toggle.is-editing {
    background: var(--highlight);
    border-color: var(--highlight);
    color: white;
}
```

- [ ] **Step 2: Verificación visual**

Abrir `gr/gr_index.html`, ir a Biblioteca. El título "Agentes registrados:" no debería verse roto (todavía no tiene botón al lado — eso es Task 3). Sin errores de consola.

- [ ] **Step 3: Commit**

```bash
git add gr/gr_styles.css
git commit -m "style(gr): agregar clase .btn-edit-toggle para botones Edit/Save chicos"
```

---

### Task 3: Biblioteca — edición independiente por tabla (Agentes/Aditivos/Granos)

**Files:**
- Modify: `gr/gr_index.html:521-526, 550, 589, 636`
- Modify: `gr/gr_app.js:2073-2310` (bloque completo "BIBLIOTECA DE INGREDIENTES - CONFIG AVANZADA")

**Contexto:** Bug real encontrado en auditoría: `toggleEdicionBiblioteca()` usa un único flag `editMode` que le pone `.modo-edicion` al contenedor `#config`, padre de las 3 tablas a la vez — editar Agentes y cambiar a Granos sin guardar deja Granos también "en edición" bajo el mismo flag. Además, `nombre`/`concDefault`/`tipo`/`granulometria` se renderizaban siempre como `<input>` (editables en apariencia incluso fuera de modo edición, sin persistir nada hasta tocar "Save"), mientras que `densidadTipica`/`volumenTipico`/`notas` eran texto fijo, nunca editables (bug de Densidad reportado).

Este task reemplaza el flag único por `editModeByTipo = {agentes, aditivos, granos}` con estado independiente, hace las 3 tablas 100% editables de forma simétrica, y saca el botón Edit de `.config-tabs` (donde se confundía con una 4ª pestaña) para ponerlo dentro de cada tabla, junto a su título.

- [ ] **Step 1: HTML — sacar el botón Edit global de `.config-tabs`**

Buscar:

```html
                    <div class="config-tabs">
                        <button type="button" class="config-tab active" data-tab="agentes" onclick="mostrarPanelConfig('agentes')">Agentes</button>
                        <button type="button" class="config-tab" data-tab="aditivos" onclick="mostrarPanelConfig('aditivos')">Aditivos</button>
                        <button type="button" class="config-tab" data-tab="granos" onclick="mostrarPanelConfig('granos')">Granos</button>
                        <button type="button" id="btnEditBiblioteca" class="config-tab" onclick="toggleEdicionBiblioteca()">Edit</button>
                    </div>
```

Reemplazar por:

```html
                    <div class="config-tabs">
                        <button type="button" class="config-tab active" data-tab="agentes" onclick="mostrarPanelConfig('agentes')">Agentes</button>
                        <button type="button" class="config-tab" data-tab="aditivos" onclick="mostrarPanelConfig('aditivos')">Aditivos</button>
                        <button type="button" class="config-tab" data-tab="granos" onclick="mostrarPanelConfig('granos')">Granos</button>
                    </div>
```

- [ ] **Step 2: HTML — agregar botón Edit propio al título de Agentes**

Buscar:

```html
                        <h4 class="config-list-title">Agentes registrados:</h4>
```

Reemplazar por:

```html
                        <h4 class="config-list-title">Agentes registrados: <button type="button" id="btnEditAgentes" class="btn-edit-toggle" onclick="toggleEdicionTabla('agentes')">✏️ Edit</button></h4>
```

- [ ] **Step 3: HTML — agregar botón Edit propio al título de Aditivos**

Buscar:

```html
                        <h4 class="config-list-title">Aditivos registrados:</h4>
```

Reemplazar por:

```html
                        <h4 class="config-list-title">Aditivos registrados: <button type="button" id="btnEditAditivos" class="btn-edit-toggle" onclick="toggleEdicionTabla('aditivos')">✏️ Edit</button></h4>
```

- [ ] **Step 4: HTML — agregar botón Edit propio al título de Granos**

Buscar:

```html
                        <h4 class="config-list-title">Granos registrados:</h4>
```

Reemplazar por:

```html
                        <h4 class="config-list-title">Granos registrados: <button type="button" id="btnEditGranos" class="btn-edit-toggle" onclick="toggleEdicionTabla('granos')">✏️ Edit</button></h4>
```

- [ ] **Step 5: JS — reemplazar todo el bloque de edición de la Biblioteca**

Buscar (bloque completo, desde `cargarBibliotecaDesdeStorage` hasta el `window.renderizarBibliotecaEnConfig = ...` — no toca el bloque de listeners de `.config-tab[data-tab]` que viene inmediatamente después, ese queda intacto):

```js
    function cargarBibliotecaDesdeStorage() {
        // getBiblioteca() es tolerante a:
        //  - localStorage vacío       → usa default y lo persiste
        //  - JSON corrupto            → usa default y lo persiste
        //  - objeto con claves faltantes → mergea con default
        // Siempre deja GR.biblioteca con shape válido.
        const bib = getBiblioteca();
        GR.biblioteca = bib;
    }

    function guardarBibliotecaEnStorage() {
        // Blindaje: getBiblioteca() garantiza shape antes de mutar.
        const bib = getBiblioteca();

        // Recolectar valores editados
        document.querySelectorAll('#configAgentesTable tr').forEach((tr, i) => {
            if (bib.agentes[i]) {
                const nombreInput = tr.querySelector('.edit-nombre');
                const concInput = tr.querySelector('.edit-conc');
                if (nombreInput) bib.agentes[i].nombre = nombreInput.value;
                if (concInput) bib.agentes[i].concDefault = parseFloat(concInput.value) || 0;
            }
        });

        document.querySelectorAll('#configAditivosTable tr').forEach((tr, i) => {
            if (bib.aditivos[i]) {
                const nombreInput = tr.querySelector('.edit-nombre');
                const tipoInput = tr.querySelector('.edit-tipo');
                if (nombreInput) bib.aditivos[i].nombre = nombreInput.value;
                if (tipoInput) bib.aditivos[i].tipo = tipoInput.value;
            }
        });

        document.querySelectorAll('#configGranosTable tr').forEach((tr, i) => {
            if (bib.granos[i]) {
                const nombreInput = tr.querySelector('.edit-nombre');
                const granuloInput = tr.querySelector('.edit-granulo');
                if (nombreInput) bib.granos[i].nombre = nombreInput.value;
                if (granuloInput) bib.granos[i].granulometria = granuloInput.value;
            }
        });

        localStorage.setItem(BIBLIOTECA_KEY, JSON.stringify(bib));
        renderizarBibliotecaEnConfig();
    }

    // Cambiar panel visible en CONFIG (Agentes / Aditivos / Granos)
    GR.mostrarPanelConfig = window.mostrarPanelConfig = function(tab) {
        document.querySelectorAll('.config-tab').forEach(function(t) { t.classList.remove('active'); });
        var activeTab = document.querySelector('.config-tab[data-tab="' + tab + '"]');
        if (activeTab) activeTab.classList.add('active');

        document.querySelectorAll('.config-panel').forEach(function(p) { p.classList.remove('active'); });
        var activePanel = document.getElementById('panel-' + tab);
        if (activePanel) activePanel.classList.add('active');
    };

    // Densidad auto-calc para CONFIG de granos
    GR.calcDensidadGrano = window.calcDensidadGrano = function() {
        var vol = parseFloat((document.getElementById('configGranoVolumen') || {}).value) || 0;
        var peso = parseFloat((document.getElementById('configGranoPeso') || {}).value) || 0;
        var out = document.getElementById('configGranoDensidad');
        if (out) out.value = vol > 0 ? (peso / vol).toFixed(3) : 0;
    };

    // Guardar agente desde CONFIG
    GR.guardarAgenteConfig = window.guardarAgenteConfig = function() {
        const nombre = document.getElementById('configAgenteNombre').value;
        const conc = parseFloat(document.getElementById('configAgenteConc').value) || 0;
        const vol = parseFloat(document.getElementById('configAgenteVol').value) || 0;
        const notas = document.getElementById('configAgenteNotas').value;

        if (!nombre) { alert('Ingrese nombre del agente'); return; }

        const bib = getBiblioteca();
        bib.agentes.push({
            id: 'AG-' + String(bib.agentes.length + 1).padStart(2, '0'),
            nombre: nombre.toUpperCase(), concDefault: conc, volumenTipico: vol, notas: notas
        });

        document.getElementById('configAgenteNombre').value = '';
        document.getElementById('configAgenteConc').value = 0;
        document.getElementById('configAgenteVol').value = 0;
        document.getElementById('configAgenteNotas').value = '';

        guardarBibliotecaEnStorage();
    };

    // Guardar aditivo desde CONFIG
    GR.guardarAditivoConfig = window.guardarAditivoConfig = function() {
        const nombre = document.getElementById('configAditivoNombre').value;
        const tipo = document.getElementById('configAditivoTipo').value;
        const notas = document.getElementById('configAditivoNotas').value;

        if (!nombre) { alert('Ingrese nombre del aditivo'); return; }

        const bib = getBiblioteca();
        bib.aditivos.push({
            id: 'AD-' + String(bib.aditivos.length + 1).padStart(2, '0'),
            nombre: nombre, tipo: tipo, notas: notas
        });

        document.getElementById('configAditivoNombre').value = '';
        document.getElementById('configAditivoTipo').value = 'Estructurante';
        document.getElementById('configAditivoNotas').value = '';

        guardarBibliotecaEnStorage();
    };

    // Guardar grano desde CONFIG
    GR.guardarGranoConfig = window.guardarGranoConfig = function() {
        const nombre = document.getElementById('configGranoNombre').value;
        const vol = parseFloat(document.getElementById('configGranoVolumen').value) || 0;
        const peso = parseFloat(document.getElementById('configGranoPeso').value) || 0;
        const granulometria = document.getElementById('configGranoGranulo').value;
        const notas = document.getElementById('configGranoNotas').value;

        if (!nombre) { alert('Ingrese nombre del grano'); return; }

        const densidad = vol > 0 ? peso / vol : 0;

        const bib = getBiblioteca();
        bib.granos.push({
            id: 'GR-' + String(bib.granos.length + 1).padStart(2, '0'),
            nombre: nombre, densidadTipica: parseFloat(densidad.toFixed(3)), granulometria: granulometria, notas: notas
        });

        document.getElementById('configGranoNombre').value = '';
        document.getElementById('configGranoVolumen').value = 0;
        document.getElementById('configGranoPeso').value = 0;
        document.getElementById('configGranoDensidad').value = 0;
        document.getElementById('configGranoGranulo').value = '';
        document.getElementById('configGranoNotas').value = '';

        guardarBibliotecaEnStorage();
    };

    // Calcular densidad grano automáticamente
    const volInput = document.getElementById('configGranoVolumen');
    const pesoInput = document.getElementById('configGranoPeso');
    if (volInput) {
        volInput.addEventListener('input', function() {
            const vol = parseFloat(this.value) || 0;
            const peso = parseFloat(pesoInput?.value) || 0;
            const densInput = document.getElementById('configGranoDensidad');
            if (densInput) densInput.value = vol > 0 ? (peso / vol).toFixed(3) : 0;
        });
    }
    if (pesoInput) {
        pesoInput.addEventListener('input', function() {
            const vol = parseFloat(volInput?.value) || 0;
            const peso = parseFloat(this.value) || 0;
            const densInput = document.getElementById('configGranoDensidad');
            if (densInput) densInput.value = vol > 0 ? (peso / vol).toFixed(3) : 0;
        });
    }

    GR.eliminarIngredienteConfig = window.eliminarIngredienteConfig = function(tipo, index) {
        if (!confirm('¿Eliminar este ingrediente?')) return;
        const bib = getBiblioteca();
        if (!Array.isArray(bib[tipo])) { console.warn('[GR] tipo no soportado:', tipo); return; }
        bib[tipo].splice(index, 1);
        guardarBibliotecaEnStorage();
    };

    // Renderizar biblioteca en CONFIG
    let editMode = false;

    GR.toggleEdicionBiblioteca = window.toggleEdicionBiblioteca = function() {
        editMode = !editMode;
        const btn = document.getElementById('btnEditBiblioteca');
        const configContent = document.getElementById('config');
        
        if (editMode) {
            btn.textContent = 'Save';
            btn.classList.add('modo-edicion');
            configContent.classList.add('modo-edicion');
        } else {
            btn.textContent = 'Edit';
            btn.classList.remove('modo-edicion');
            configContent.classList.remove('modo-edicion');
            guardarBibliotecaEnStorage();
        }
    };

    function renderizarBibliotecaEnConfig() {
        // Blindaje: asegurar que la biblioteca esté hidratada y con shape válido
        // antes de leer .agentes / .aditivos / .granos.
        const bib = getBiblioteca();

        const agentesTable = document.getElementById('configAgentesTable');
        if (agentesTable) {
            agentesTable.innerHTML = bib.agentes.map((ag, i) =>
                `<tr><td>${ag.id}</td><td><input type="text" class="edit-nombre" data-tipo="agentes" data-idx="${i}" value="${ag.nombre}"></td><td><input type="number" class="edit-conc" data-tipo="agentes" data-idx="${i}" value="${ag.concDefault}"></td><td>${ag.volumenTipico || '-'}</td><td>${ag.notas || '-'}</td><td class="col-editar"><button type="button" class="btn-delete" onclick="eliminarIngredienteConfig('agentes', ${i})">✕</button></td></tr>`
            ).join('');
        }

        const aditivosTable = document.getElementById('configAditivosTable');
        if (aditivosTable) {
            aditivosTable.innerHTML = bib.aditivos.map((ad, i) =>
                `<tr><td>${ad.id}</td><td><input type="text" class="edit-nombre" data-tipo="aditivos" data-idx="${i}" value="${ad.nombre}"></td><td><select class="edit-tipo" data-tipo="aditivos" data-idx="${i}"><option value="Estructurante" ${ad.tipo==='Estructurante'?'selected':''}>Estructurante</option><option value="Corrector pH" ${ad.tipo==='Corrector pH'?'selected':''}>Corrector pH</option><option value="Nutriente" ${ad.tipo==='Nutriente'?'selected':''}>Nutriente</option></select></td><td>${ad.notas || '-'}</td><td class="col-editar"><button type="button" class="btn-delete" onclick="eliminarIngredienteConfig('aditivos', ${i})">✕</button></td></tr>`
            ).join('');
        }

        const granosTable = document.getElementById('configGranosTable');
        if (granosTable) {
            granosTable.innerHTML = bib.granos.map((gr, i) =>
                `<tr><td>${gr.id}</td><td><input type="text" class="edit-nombre" data-tipo="granos" data-idx="${i}" value="${gr.nombre}"></td><td>${(Number(gr.densidadTipica)||0).toFixed(3).replace('.', ',')} g/ml</td><td><input type="text" class="edit-granulo" data-tipo="granos" data-idx="${i}" value="${gr.granulometria || ''}"></td><td>${gr.notas || '-'}</td><td class="col-editar"><button type="button" class="btn-delete" onclick="eliminarIngredienteConfig('granos', ${i})">✕</button></td></tr>`
            ).join('');
        }

        // Actualizar selector de granos en CT (select con características)
        document.querySelectorAll('.ct-comp').forEach(select => {
            select.innerHTML = '<option value="">-- Seleccionar grano --</option>' +
                bib.granos.map(gr =>
                    `<option value="${gr.nombre}" data-densidad="${gr.densidadTipica}">${gr.nombre} - ${(Number(gr.densidadTipica)||0).toFixed(3).replace('.', ',')} g/ml</option>`
                ).join('');
        });

        // Actualizar selector de aditivos en DG (para filas nuevas y existentes)
        const opcionesAditivos = bib.aditivos.map(a =>
            `<option value="${a.nombre}">${a.nombre}</option>`
        ).join('');

        // Guardar para filas nuevas
        GR.opcionesAditivosDG = window.opcionesAditivosDG = opcionesAditivos;

        // Actualizar todos los selectores .dg-biblioteca existentes en la tabla
        document.querySelectorAll('#dgTable .dg-biblioteca').forEach(select => {
            select.innerHTML = '<option value="">-- Seleccionar --</option>' + opcionesAditivos;
        });

        // Actualizar selectors de HM también

    }

    // Exponer función a window para uso externo
    window.renderizarBibliotecaEnConfig = renderizarBibliotecaEnConfig;
```

Reemplazar por:

```js
    function cargarBibliotecaDesdeStorage() {
        // getBiblioteca() es tolerante a:
        //  - localStorage vacío       → usa default y lo persiste
        //  - JSON corrupto            → usa default y lo persiste
        //  - objeto con claves faltantes → mergea con default
        // Siempre deja GR.biblioteca con shape válido.
        const bib = getBiblioteca();
        GR.biblioteca = bib;
    }

    // Estado de edición independiente por tabla — evita que editar Agentes
    // deje Granos/Aditivos en modo edición por compartir un flag global
    // (bug real: el editMode único de antes le ponía .modo-edicion a #config,
    // padre de las 3 tablas a la vez, aunque solo una estuviera visible).
    const editModeByTipo = { agentes: false, aditivos: false, granos: false };

    const _GR_BIB_TABLA_ID = { agentes: 'configAgentesTable', aditivos: 'configAditivosTable', granos: 'configGranosTable' };
    const _GR_BIB_BTN_ID   = { agentes: 'btnEditAgentes',    aditivos: 'btnEditAditivos',    granos: 'btnEditGranos' };

    function _grActualizarSelectorGranosCT(bib) {
        document.querySelectorAll('.ct-comp').forEach(select => {
            select.innerHTML = '<option value="">-- Seleccionar grano --</option>' +
                bib.granos.map(gr =>
                    `<option value="${gr.nombre}" data-densidad="${gr.densidadTipica}">${gr.nombre} - ${(Number(gr.densidadTipica)||0).toFixed(3).replace('.', ',')} g/ml</option>`
                ).join('');
        });
    }

    function _grActualizarSelectorAditivosDG(bib) {
        const opcionesAditivos = bib.aditivos.map(a =>
            `<option value="${a.nombre}">${a.nombre}</option>`
        ).join('');
        GR.opcionesAditivosDG = window.opcionesAditivosDG = opcionesAditivos;
        document.querySelectorAll('#dgTable .dg-biblioteca').forEach(select => {
            select.innerHTML = '<option value="">-- Seleccionar --</option>' + opcionesAditivos;
        });
    }

    // Renderiza UNA tabla (agentes/aditivos/granos) en modo lectura o edición
    // según editModeByTipo[tipo]. Nunca toca las otras 2 tablas.
    function renderizarTablaEnConfig(tipo) {
        const bib = getBiblioteca();
        const editando = !!editModeByTipo[tipo];
        const tbody = document.getElementById(_GR_BIB_TABLA_ID[tipo]);
        if (!tbody) return;

        if (tipo === 'agentes') {
            tbody.innerHTML = bib.agentes.map((ag, i) => `<tr>
                <td>${ag.id}</td>
                <td>${editando ? `<input type="text" class="edit-nombre" value="${ag.nombre}">` : ag.nombre}</td>
                <td>${editando ? `<input type="number" step="0.1" class="edit-conc" value="${ag.concDefault}">` : (ag.concDefault || 0)}</td>
                <td>${editando ? `<input type="number" step="1" class="edit-vol" value="${ag.volumenTipico || 0}">` : (ag.volumenTipico || '-')}</td>
                <td>${editando ? `<input type="text" class="edit-notas" value="${ag.notas || ''}">` : (ag.notas || '-')}</td>
                <td class="col-editar"><button type="button" class="btn-delete" onclick="eliminarIngredienteConfig('agentes', ${i})">✕</button></td>
            </tr>`).join('');
        } else if (tipo === 'aditivos') {
            tbody.innerHTML = bib.aditivos.map((ad, i) => `<tr>
                <td>${ad.id}</td>
                <td>${editando ? `<input type="text" class="edit-nombre" value="${ad.nombre}">` : ad.nombre}</td>
                <td>${editando ? `<select class="edit-tipo"><option value="Estructurante" ${ad.tipo==='Estructurante'?'selected':''}>Estructurante</option><option value="Corrector pH" ${ad.tipo==='Corrector pH'?'selected':''}>Corrector pH</option><option value="Nutriente" ${ad.tipo==='Nutriente'?'selected':''}>Nutriente</option></select>` : ad.tipo}</td>
                <td>${editando ? `<input type="text" class="edit-notas" value="${ad.notas || ''}">` : (ad.notas || '-')}</td>
                <td class="col-editar"><button type="button" class="btn-delete" onclick="eliminarIngredienteConfig('aditivos', ${i})">✕</button></td>
            </tr>`).join('');
        } else if (tipo === 'granos') {
            tbody.innerHTML = bib.granos.map((gr, i) => {
                const dens = Number(gr.densidadTipica) || 0;
                return `<tr>
                    <td>${gr.id}</td>
                    <td>${editando ? `<input type="text" class="edit-nombre" value="${gr.nombre}">` : gr.nombre}</td>
                    <td>${editando ? `<input type="number" step="0.001" class="edit-densidad" value="${dens.toFixed(3)}">` : dens.toFixed(3).replace('.', ',') + ' g/ml'}</td>
                    <td>${editando ? `<input type="text" class="edit-granulo" value="${gr.granulometria || ''}">` : (gr.granulometria || '-')}</td>
                    <td>${editando ? `<input type="text" class="edit-notas" value="${gr.notas || ''}">` : (gr.notas || '-')}</td>
                    <td class="col-editar"><button type="button" class="btn-delete" onclick="eliminarIngredienteConfig('granos', ${i})">✕</button></td>
                </tr>`;
            }).join('');
        }
    }

    // Lee los inputs de UNA tabla y persiste solo bib[tipo]. Llamado al
    // apagar el modo edición de esa tabla (click en "Save").
    function guardarTablaEnStorage(tipo) {
        const bib = getBiblioteca();
        const arr = bib[tipo];
        const tbody = document.getElementById(_GR_BIB_TABLA_ID[tipo]);
        if (!tbody || !Array.isArray(arr)) return;

        tbody.querySelectorAll('tr').forEach((tr, i) => {
            const item = arr[i];
            if (!item) return;
            const nombreInput = tr.querySelector('.edit-nombre');
            if (nombreInput) item.nombre = nombreInput.value;
            const notasInput = tr.querySelector('.edit-notas');
            if (notasInput) item.notas = notasInput.value;

            if (tipo === 'agentes') {
                const concInput = tr.querySelector('.edit-conc');
                const volInput = tr.querySelector('.edit-vol');
                if (concInput) item.concDefault = parseFloat(concInput.value) || 0;
                if (volInput) item.volumenTipico = parseFloat(volInput.value) || 0;
            } else if (tipo === 'aditivos') {
                const tipoInput = tr.querySelector('.edit-tipo');
                if (tipoInput) item.tipo = tipoInput.value;
            } else if (tipo === 'granos') {
                const densInput = tr.querySelector('.edit-densidad');
                const granuloInput = tr.querySelector('.edit-granulo');
                if (densInput) item.densidadTipica = parseFloat(densInput.value) || 0;
                if (granuloInput) item.granulometria = granuloInput.value;
            }
        });

        localStorage.setItem(BIBLIOTECA_KEY, JSON.stringify(bib));
        GR.biblioteca = bib;
        renderizarTablaEnConfig(tipo);
        if (tipo === 'granos') _grActualizarSelectorGranosCT(bib);
        if (tipo === 'aditivos') _grActualizarSelectorAditivosDG(bib);
    }

    // Toggle Edit/Save de UNA tabla puntual (Agentes, Aditivos o Granos).
    // Reemplaza el toggleEdicionBiblioteca() global anterior.
    GR.toggleEdicionTabla = window.toggleEdicionTabla = function(tipo) {
        if (!_GR_BIB_TABLA_ID[tipo]) return;
        editModeByTipo[tipo] = !editModeByTipo[tipo];
        const btn = document.getElementById(_GR_BIB_BTN_ID[tipo]);
        const tbody = document.getElementById(_GR_BIB_TABLA_ID[tipo]);

        if (editModeByTipo[tipo]) {
            if (btn) { btn.textContent = '💾 Save'; btn.classList.add('is-editing'); }
            if (tbody) tbody.classList.add('modo-edicion');
            renderizarTablaEnConfig(tipo);
        } else {
            if (btn) { btn.textContent = '✏️ Edit'; btn.classList.remove('is-editing'); }
            if (tbody) tbody.classList.remove('modo-edicion');
            guardarTablaEnStorage(tipo); // ya vuelve a renderizar en modo lectura
        }
    };

    // Cambiar panel visible en CONFIG (Agentes / Aditivos / Granos)
    GR.mostrarPanelConfig = window.mostrarPanelConfig = function(tab) {
        document.querySelectorAll('.config-tab').forEach(function(t) { t.classList.remove('active'); });
        var activeTab = document.querySelector('.config-tab[data-tab="' + tab + '"]');
        if (activeTab) activeTab.classList.add('active');

        document.querySelectorAll('.config-panel').forEach(function(p) { p.classList.remove('active'); });
        var activePanel = document.getElementById('panel-' + tab);
        if (activePanel) activePanel.classList.add('active');
    };

    // Densidad auto-calc para CONFIG de granos
    GR.calcDensidadGrano = window.calcDensidadGrano = function() {
        var vol = parseFloat((document.getElementById('configGranoVolumen') || {}).value) || 0;
        var peso = parseFloat((document.getElementById('configGranoPeso') || {}).value) || 0;
        var out = document.getElementById('configGranoDensidad');
        if (out) out.value = vol > 0 ? (peso / vol).toFixed(3) : 0;
    };

    // Guardar agente desde CONFIG
    GR.guardarAgenteConfig = window.guardarAgenteConfig = function() {
        const nombre = document.getElementById('configAgenteNombre').value;
        const conc = parseFloat(document.getElementById('configAgenteConc').value) || 0;
        const vol = parseFloat(document.getElementById('configAgenteVol').value) || 0;
        const notas = document.getElementById('configAgenteNotas').value;

        if (!nombre) { alert('Ingrese nombre del agente'); return; }

        const bib = getBiblioteca();
        bib.agentes.push({
            id: 'AG-' + String(bib.agentes.length + 1).padStart(2, '0'),
            nombre: nombre.toUpperCase(), concDefault: conc, volumenTipico: vol, notas: notas
        });
        localStorage.setItem(BIBLIOTECA_KEY, JSON.stringify(bib));
        GR.biblioteca = bib;

        document.getElementById('configAgenteNombre').value = '';
        document.getElementById('configAgenteConc').value = 0;
        document.getElementById('configAgenteVol').value = 0;
        document.getElementById('configAgenteNotas').value = '';

        renderizarTablaEnConfig('agentes');
    };

    // Guardar aditivo desde CONFIG
    GR.guardarAditivoConfig = window.guardarAditivoConfig = function() {
        const nombre = document.getElementById('configAditivoNombre').value;
        const tipo = document.getElementById('configAditivoTipo').value;
        const notas = document.getElementById('configAditivoNotas').value;

        if (!nombre) { alert('Ingrese nombre del aditivo'); return; }

        const bib = getBiblioteca();
        bib.aditivos.push({
            id: 'AD-' + String(bib.aditivos.length + 1).padStart(2, '0'),
            nombre: nombre, tipo: tipo, notas: notas
        });
        localStorage.setItem(BIBLIOTECA_KEY, JSON.stringify(bib));
        GR.biblioteca = bib;

        document.getElementById('configAditivoNombre').value = '';
        document.getElementById('configAditivoTipo').value = 'Estructurante';
        document.getElementById('configAditivoNotas').value = '';

        renderizarTablaEnConfig('aditivos');
        _grActualizarSelectorAditivosDG(bib);
    };

    // Guardar grano desde CONFIG
    GR.guardarGranoConfig = window.guardarGranoConfig = function() {
        const nombre = document.getElementById('configGranoNombre').value;
        const vol = parseFloat(document.getElementById('configGranoVolumen').value) || 0;
        const peso = parseFloat(document.getElementById('configGranoPeso').value) || 0;
        const granulometria = document.getElementById('configGranoGranulo').value;
        const notas = document.getElementById('configGranoNotas').value;

        if (!nombre) { alert('Ingrese nombre del grano'); return; }

        const densidad = vol > 0 ? peso / vol : 0;

        const bib = getBiblioteca();
        bib.granos.push({
            id: 'GR-' + String(bib.granos.length + 1).padStart(2, '0'),
            nombre: nombre, densidadTipica: parseFloat(densidad.toFixed(3)), granulometria: granulometria, notas: notas
        });
        localStorage.setItem(BIBLIOTECA_KEY, JSON.stringify(bib));
        GR.biblioteca = bib;

        document.getElementById('configGranoNombre').value = '';
        document.getElementById('configGranoVolumen').value = 0;
        document.getElementById('configGranoPeso').value = 0;
        document.getElementById('configGranoDensidad').value = 0;
        document.getElementById('configGranoGranulo').value = '';
        document.getElementById('configGranoNotas').value = '';

        renderizarTablaEnConfig('granos');
        _grActualizarSelectorGranosCT(bib);
    };

    // Calcular densidad grano automáticamente
    const volInput = document.getElementById('configGranoVolumen');
    const pesoInput = document.getElementById('configGranoPeso');
    if (volInput) {
        volInput.addEventListener('input', function() {
            const vol = parseFloat(this.value) || 0;
            const peso = parseFloat(pesoInput?.value) || 0;
            const densInput = document.getElementById('configGranoDensidad');
            if (densInput) densInput.value = vol > 0 ? (peso / vol).toFixed(3) : 0;
        });
    }
    if (pesoInput) {
        pesoInput.addEventListener('input', function() {
            const vol = parseFloat(volInput?.value) || 0;
            const peso = parseFloat(this.value) || 0;
            const densInput = document.getElementById('configGranoDensidad');
            if (densInput) densInput.value = vol > 0 ? (peso / vol).toFixed(3) : 0;
        });
    }

    GR.eliminarIngredienteConfig = window.eliminarIngredienteConfig = function(tipo, index) {
        if (!confirm('¿Eliminar este ingrediente?')) return;
        const bib = getBiblioteca();
        if (!Array.isArray(bib[tipo])) { console.warn('[GR] tipo no soportado:', tipo); return; }
        bib[tipo].splice(index, 1);
        localStorage.setItem(BIBLIOTECA_KEY, JSON.stringify(bib));
        GR.biblioteca = bib;
        renderizarTablaEnConfig(tipo);
        if (tipo === 'granos') _grActualizarSelectorGranosCT(bib);
        if (tipo === 'aditivos') _grActualizarSelectorAditivosDG(bib);
    };

    // Re-renderiza las 3 tablas de la Biblioteca, salteando las que estén
    // en edición (no pisar inputs sin guardar de una tabla al refrescar
    // otra — ver toggleEdicionTabla / guardarTablaEnStorage).
    function renderizarBibliotecaEnConfig() {
        ['agentes', 'aditivos', 'granos'].forEach(function(tipo) {
            if (!editModeByTipo[tipo]) renderizarTablaEnConfig(tipo);
        });
    }

    // Exponer función a window para uso externo
    window.renderizarBibliotecaEnConfig = renderizarBibliotecaEnConfig;
```

- [ ] **Step 6: Chequeo de sintaxis**

Run: `node --check "gr/gr_app.js"`
Expected: sin output.

- [ ] **Step 7: Verificación manual en navegador**

Abrir `gr/gr_index.html`, ir a Biblioteca:
1. Cada tabla (Agentes/Aditivos/Granos) tiene su propio botón "✏️ Edit" junto al título — ya no hay un 4º botón "Edit" en la fila de pestañas.
2. Click en Edit de Agentes → nombre/conc/volumen/notas se vuelven `<input>`, aparece el botón ✕ de eliminar por fila. Cambiar un valor, click en Save (mismo botón, ahora dice 💾 Save) → persiste. F5 → el cambio sigue ahí.
3. Con Agentes en modo edición (sin guardar), cambiar a la pestaña Granos, editar Densidad, guardar. Volver a Agentes → el texto tipeado sin guardar sigue en el input (no se pisó).
4. Densidad de Granos ahora editable y persistida — el `<select>` de composición en Formulación (pestaña 🌾) refleja el nuevo valor tras guardar.
5. Eliminar (✕) un ingrediente de cualquiera de las 3 tablas sigue pidiendo confirmación y funcionando.
6. Sin errores en la consola del navegador.

- [ ] **Step 8: Commit**

```bash
git add gr/gr_app.js gr/gr_index.html
git commit -m "refactor(gr): edicion de Biblioteca por tabla independiente (Agentes/Aditivos/Granos), corrige bleed de modo edicion entre tablas y hace editables Densidad/Volumen tipico/Notas"
```

---

### Task 4: Registro — reubicar y achicar botones Edit y Limpiar inválidos

**Files:**
- Modify: `gr/gr_index.html:480-507`
- Modify: `gr/gr_app.js:1062-1077` (`grToggleEdicionRegistros`)

**Contexto:** `#btnEditRegistros` usaba tamaño completo (`.btn`, mismo que "Guardar Lote") en una fila propia separada de la lista que controla. `🧹 Limpiar inválidos` competía visualmente con controles de uso diario pese a ser una herramienta de mantenimiento excepcional (purga permanente de lotes fantasma de `localStorage`, con `confirm()` previo). Este task no cambia ninguna lógica de negocio — solo tamaño/ubicación de los dos botones, reutilizando `.btn-edit-toggle` de Task 2.

- [ ] **Step 1: HTML — mover Edit junto al selector de orden, mover Limpiar inválidos al pie**

Buscar:

```html
                <div class="section-content" id="registro">
                    <div style="margin-bottom:10px;display:flex;gap:10px;align-items:center;">
                        <button type="button" id="btnEditRegistros" class="btn btn-secondary" onclick="grToggleEdicionRegistros()">✏️ Edit</button>
                        <button type="button" class="btn btn-secondary" onclick="grLimpiezaProfunda()" title="Elimina lotes sin unidades ni peso registrado" style="color:#FF6B6B;border-color:#FF6B6B;">🧹 Limpiar inválidos</button>
                    </div>
                    <div id="grRegKpiBar" class="gr-kpi-bar" style="display:none"></div>
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
                        <select id="grSortSelect" onchange="grSetSort(this.value)" style="font-size:11px;background:#1a1a1a;color:#ccc;border:1px solid #444;border-radius:6px;padding:4px 8px">
                            <option value="fecha_desc">Fecha ↓ (reciente)</option>
                            <option value="fecha_asc">Fecha ↑ (antiguo)</option>
                            <option value="id_asc">ID ↑ (A→Z)</option>
                            <option value="disp_desc">Disponibles ↓</option>
                            <option value="nombre">Nombre (A→Z)</option>
                        </select>
                    </div>
                    <div id="registroLotesBody" class="gr-cards-list">
                        <!-- Se llena con JS -->
                    </div>
                    <p id="noLotesMsg" class="empty-state" style="display:none">
                        No hay registros guardados aún.
                    </p>

                    <div class="import-buttons" style="margin-top:15px;display:flex;gap:10px;justify-content:center">
                        <label class="btn btn-export" style="cursor:pointer">
                            📥 Importar backup de GR
                            <input type="file" id="btnImportJson" accept=".json" style="display:none" onchange="importarJSON(event)">
                        </label>
                    </div>
```

Reemplazar por:

```html
                <div class="section-content" id="registro">
                    <div id="grRegKpiBar" class="gr-kpi-bar" style="display:none"></div>
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
                        <select id="grSortSelect" onchange="grSetSort(this.value)" style="font-size:11px;background:#1a1a1a;color:#ccc;border:1px solid #444;border-radius:6px;padding:4px 8px">
                            <option value="fecha_desc">Fecha ↓ (reciente)</option>
                            <option value="fecha_asc">Fecha ↑ (antiguo)</option>
                            <option value="id_asc">ID ↑ (A→Z)</option>
                            <option value="disp_desc">Disponibles ↓</option>
                            <option value="nombre">Nombre (A→Z)</option>
                        </select>
                        <button type="button" id="btnEditRegistros" class="btn-edit-toggle" onclick="grToggleEdicionRegistros()">✏️ Edit</button>
                    </div>
                    <div id="registroLotesBody" class="gr-cards-list">
                        <!-- Se llena con JS -->
                    </div>
                    <p id="noLotesMsg" class="empty-state" style="display:none">
                        No hay registros guardados aún.
                    </p>

                    <div class="import-buttons" style="margin-top:15px;display:flex;gap:10px;justify-content:center;align-items:center">
                        <label class="btn btn-export" style="cursor:pointer">
                            📥 Importar backup de GR
                            <input type="file" id="btnImportJson" accept=".json" style="display:none" onchange="importarJSON(event)">
                        </label>
                        <button type="button" class="btn-small" onclick="grLimpiezaProfunda()" title="Elimina lotes sin unidades ni peso registrado" style="background:var(--dark-tertiary);color:#FF6B6B;border:1px solid var(--border);opacity:.75">🧹 Limpiar inválidos</button>
                    </div>
```

- [ ] **Step 2: JS — `grToggleEdicionRegistros` usa el toggle de 2 clases nuevo**

Buscar:

```js
function grToggleEdicionRegistros() {
    GR.modoEdicionRegistro = !GR.modoEdicionRegistro;
    const btnEdit = document.getElementById('btnEditRegistros');
    if (btnEdit) {
        if (GR.modoEdicionRegistro) {
            btnEdit.textContent = '💾 Save';
            btnEdit.classList.remove('btn-secondary');
            btnEdit.classList.add('btn-primary');
        } else {
            btnEdit.textContent = '✏️ Edit';
            btnEdit.classList.remove('btn-primary');
            btnEdit.classList.add('btn-secondary');
        }
    }
    grRenderizarRegistroLotes();
}
```

Reemplazar por:

```js
function grToggleEdicionRegistros() {
    GR.modoEdicionRegistro = !GR.modoEdicionRegistro;
    const btnEdit = document.getElementById('btnEditRegistros');
    if (btnEdit) {
        if (GR.modoEdicionRegistro) {
            btnEdit.textContent = '💾 Save';
            btnEdit.classList.add('is-editing');
        } else {
            btnEdit.textContent = '✏️ Edit';
            btnEdit.classList.remove('is-editing');
        }
    }
    grRenderizarRegistroLotes();
}
```

- [ ] **Step 3: Chequeo de sintaxis**

Run: `node --check "gr/gr_app.js"`
Expected: sin output.

- [ ] **Step 4: Verificación manual en navegador**

Abrir `gr/gr_index.html`, ir a Registro:
1. El botón "✏️ Edit" es chico y está junto al selector "Ordenar por", no en una fila propia arriba de todo.
2. Click en Edit → aparece 📂/✕ en cada card de lote, el botón pasa a "💾 Save" con fondo resaltado. Click de nuevo → vuelve a "✏️ Edit", cards sin esos botones.
3. "🧹 Limpiar inválidos" está al pie, junto a "Importar backup de GR", chico y con opacidad reducida — sigue disparando su `confirm()` y purgando lotes fantasma igual que antes.
4. Sin errores en la consola del navegador.

- [ ] **Step 5: Commit**

```bash
git add gr/gr_app.js gr/gr_index.html
git commit -m "style(gr): achicar y reubicar boton Edit de Registro junto al selector de orden, bajar jerarquia visual de Limpiar invalidos"
```

---

### Task 5: QA final — recorrido completo del módulo GR

**Files:** ninguno (solo verificación, sin cambios de código)

- [ ] **Step 1: Recorrido completo en navegador real**

Abrir `gr/gr_index.html` desde cero (F5) y recorrer las 4 sub-pestañas en orden:
1. **🌾 Formulación:** cargar o crear un lote, confirmar que el selector de granos en Composición de Tanda (CT) sigue poblado y funcional.
2. **📝 Registro:** confirmar el layout de Task 4 (Edit chico junto al sort, Limpiar inválidos al pie), cargar un registro existente, confirmar que Trazabilidad (▶) sigue abriendo.
3. **📚 Biblioteca:** confirmar el rename de pestaña (Task 1), probar edición completa en las 3 tablas (Task 3) — agregar un agente nuevo, editarlo, eliminarlo; editar densidad de un grano existente y confirmar que se refleja en Formulación.
4. **⚗️ Conocimiento:** abrir la pestaña, confirmar que sigue renderizando (no debería haberse tocado nada de esta sección, pero comparte el mismo `GR.subTab`).

- [ ] **Step 2: Confirmar consola limpia**

Durante todo el recorrido del Step 1, la consola del navegador no debe mostrar ningún error nuevo (`ReferenceError`, `TypeError`, etc.). Advertencias preexistentes no relacionadas con este cambio no son bloqueantes.

- [ ] **Step 3: Marcar el plan como completo**

Si todo lo anterior pasó, no hace falta ningún commit adicional — los 4 tasks anteriores ya quedaron commiteados individualmente. Confirmar con `git log --oneline -5` que los 4 commits de este plan están presentes.
