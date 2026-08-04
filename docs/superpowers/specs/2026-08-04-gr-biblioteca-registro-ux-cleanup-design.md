# GR — Rename de sub-pestaña Config, edición por-tabla en Biblioteca, cleanup de Registro

**Fecha:** 2026-08-04
**Módulo:** GR (`gr/gr_app.js`, `gr/gr_index.html`, `gr/gr_styles.css`)
**Alcance:** Solo GR. No se toca SU/FR/CI aunque comparten el mismo patrón de nombres/edición (fuera de alcance de esta sesión, ver "Notas fuera de alcance" al final).

## Contexto

El usuario reportó tres problemas de UX en GR, todos en el árbol de navegación `main.js`(no se toca) → `gr_app.js`/`gr_index.html`:

1. La sub-pestaña `⚙️ Config` (`data-grtab="cfg"`) puede confundirse con el módulo CFG del pipeline (`GE → CI → CILAB → GR → SU → FR → CFG`), aunque son cosas completamente distintas — esta pestaña es la biblioteca interna de ingredientes de GR (Agentes/Aditivos/Granos), no tiene nada que ver con GitHub Sync ni con el módulo CFG real.
2. El botón `Edit` de esa biblioteca vive disfrazado de 4ª pestaña dentro de `.config-tabs`, junto a Agentes/Aditivos/Granos — y la Densidad de Granos no se puede editar una vez guardada (bug puntual reportado).
3. En la sub-pestaña `📝 Registro`, el botón `✏️ Edit` es de tamaño completo (mismo que "Guardar Lote") y está ubicado en una fila propia separada de la lista que controla; `🧹 Limpiar inválidos` compite visualmente con controles de uso diario pese a ser una herramienta de mantenimiento excepcional.

Auditoría del código existente (`gr_app.js:2073-2320`) encontró un bug estructural relacionado con (2): `toggleEdicionBiblioteca()` usa un único flag `editMode` que le agrega la clase `.modo-edicion` al contenedor `#config`, padre de las 3 tablas (Agentes/Aditivos/Granos) a la vez. Aunque solo una tabla está visible por vez (`.config-panel.active`), el flag es compartido — si el usuario activa edición en Agentes y cambia a Granos sin guardar, Granos también queda "en edición" bajo el mismo flag. SU tiene un patrón idéntico (`cfgToggleEdicionMateriales`) pero nunca se manifestó ahí porque SU no tiene sub-tabs dentro de su Config (una sola tabla de materiales).

También se encontró que `nombre`/`concDefault`/`tipo`/`granulometria` se renderizan **siempre** como `<input>` (línea 2266, 2273, 2280), estén o no en modo edición — solo el botón de eliminar (`.col-editar`) está gateado por `.modo-edicion`. Esto significa que el usuario puede tipear cambios en esos campos en cualquier momento, pero nada se persiste hasta hacer click en "Save" (toggle OFF de `editMode`) — sin ningún aviso si navega a otra pestaña o módulo antes de guardar. `Densidad` (Granos), `Volumen típico` (Agentes) y `Notas` (las 3 tablas) son directamente texto fijo, nunca editable — de ahí el bug de Densidad reportado.

Comparación con SU (`su_app.js:2192-2263`, `cfgToggleEdicionMateriales`/`cfgTablaMateriales`) confirma que su Biblioteca de Materiales YA tiene todos sus campos editables (incluida densidad, columna 7 de 13) bajo el mismo mecanismo de toggle Edit/Save — GR quedó atrás en paridad de campos, no es una decisión de diseño intencional.

## Decisiones ya validadas con el usuario

- Nombre nuevo de la pestaña: **📚 Biblioteca** (coincide con el H2 interno ya existente "⚙️ Biblioteca de Ingredientes").
- Alcance de edición: las 3 tablas quedan 100% editables (Densidad + Volumen típico + Notas, no solo Densidad) — consistencia con el patrón ya validado en SU.
- `🧹 Limpiar inválidos`: se mantiene la función (es el único mecanismo de purga de lotes fantasma de `localStorage`), se reduce su jerarquía visual y se reubica — no se borra.

## Diseño

### 1. Rename de sub-pestaña `cfg` → `bib`

**`gr_index.html`:**
- Línea 22: `data-grtab="cfg"` → `data-grtab="bib"`, texto `⚙️ Config` → `📚 Biblioteca`, `onclick="GR.subTab('cfg')"` → `onclick="GR.subTab('bib')"`.
- Línea 513: `id="gr-sub-cfg"` → `id="gr-sub-bib"`.
- Línea 653: actualizar comentario `<!-- /#gr-sub-cfg -->` → `<!-- /#gr-sub-bib -->`.

**`gr_app.js`:**
- `GR.subTab` (línea ~3098-3128): variable `pCfg` → `pBib`, `getElementById('gr-sub-cfg')` → `getElementById('gr-sub-bib')`, condición `t === 'cfg'` → `t === 'bib'` (dos apariciones: la de mostrar/ocultar panel y la que dispara `renderizarBibliotecaEnConfig()`).
- `GR.goToConfig`/`window.goToConfig` (línea ~3081-3087): renombrar a `GR.goToBiblioteca`/`window.goToBiblioteca`, actualizar el `getElementById('gr-sub-cfg')` interno y el `GR.subTab('cfg')` interno. Función sin callers activos (grep confirmado) — se renombra igual por consistencia, no se elimina (fuera de alcance borrar código muerto no pedido).
- Línea ~3083 (dentro de `grInit`, auto-apertura de pestaña inicial si existe `gr-sub-cfg`): actualizar el id chequeado y el argumento de `GR.subTab`.

Verificado por grep: el string `'cfg'` de esta sub-pestaña no se usa en ningún otro archivo del repo (no hay persistencia de "última pestaña" en localStorage, no hay deep-linking por hash). Cambio autocontenido a `gr/`.

Los ids internos del panel (`id="config"`, `id="panel-agentes"`, `id="panel-aditivos"`, `id="panel-granos"`, `configAgentesTable`, etc.) **no cambian** — no son parte de la confusión reportada, y renombrarlos sin necesidad viola la regla de "no refactorizar por estética".

### 2. Biblioteca — edición aislada por tabla + paridad de campos

**Estado JS — reemplaza el único `let editMode = false`:**
```js
const editModeByTipo = { agentes: false, aditivos: false, granos: false };
```

**HTML — `.config-tabs` pierde el botón Edit global:**
```html
<div class="config-tabs">
    <button type="button" class="config-tab active" data-tab="agentes" onclick="mostrarPanelConfig('agentes')">Agentes</button>
    <button type="button" class="config-tab" data-tab="aditivos" onclick="mostrarPanelConfig('aditivos')">Aditivos</button>
    <button type="button" class="config-tab" data-tab="granos" onclick="mostrarPanelConfig('granos')">Granos</button>
</div>
```
(se elimina `<button id="btnEditBiblioteca" class="config-tab" onclick="toggleEdicionBiblioteca()">Edit</button>`)

**Cada panel gana su propio botón Edit, pegado al título de su tabla**, ej. para Agentes:
```html
<h4 class="config-list-title">
    Agentes registrados:
    <button type="button" id="btnEditAgentes" class="btn btn-secondary btn-small" onclick="toggleEdicionTabla('agentes')">✏️ Edit</button>
</h4>
<table class="data-table" id="tablaAgentes">
```
Mismo patrón para `btnEditAditivos`/`tablaAditivos` y `btnEditGranos`/`tablaGranos`. Los `<table>` ganan `id` propio (hoy son anónimos) para poder scopear la clase `.modo-edicion` a la tabla específica en vez de al contenedor `#config` completo.

**`GR.toggleEdicionTabla(tipo)`** (reemplaza `toggleEdicionBiblioteca`):
```js
GR.toggleEdicionTabla = window.toggleEdicionTabla = function(tipo) {
    editModeByTipo[tipo] = !editModeByTipo[tipo];
    const btn = document.getElementById('btnEdit' + _capTipo(tipo)); // Agentes/Aditivos/Granos
    const tabla = document.getElementById('tabla' + _capTipo(tipo));
    if (editModeByTipo[tipo]) {
        btn.textContent = '💾 Save';
        btn.classList.add('modo-edicion');
        tabla.classList.add('modo-edicion');
    } else {
        btn.textContent = '✏️ Edit';
        btn.classList.remove('modo-edicion');
        tabla.classList.remove('modo-edicion');
        guardarTablaEnStorage(tipo); // solo esta tabla, no toca bib[otroTipo]
    }
    renderizarTablaEnConfig(tipo); // re-render SOLO esta tabla — no pisa ediciones en curso de las otras 2
};
```

**Render por-fila condicional al modo edición de esa tabla** (`renderizarTablaEnConfig(tipo)`, reemplaza el bloque monolítico de `renderizarBibliotecaEnConfig` para la tabla de `tipo`): cada celda editable (`nombre`, `concDefault`/`densidadTipica`, `volumenTipico`, `tipo`, `granulometria`, `notas`) se renderiza como `<input>`/`<select>` si `editModeByTipo[tipo]` es `true`, o como texto plano si es `false`. El botón eliminar (`.col-editar`) sigue gateado por `.modo-edicion` vía CSS, sin cambios ahí.

Ejemplo fila Granos (las 3 quedan simétricas):
```js
function _filaGrano(gr, i, editando) {
    const dens = (Number(gr.densidadTipica) || 0).toFixed(3);
    return `<tr>
        <td>${gr.id}</td>
        <td>${editando ? `<input type="text" class="edit-nombre" data-idx="${i}" value="${gr.nombre}">` : gr.nombre}</td>
        <td>${editando ? `<input type="number" step="0.001" class="edit-densidad" data-idx="${i}" value="${dens}">` : dens.replace('.', ',') + ' g/ml'}</td>
        <td>${editando ? `<input type="text" class="edit-granulo" data-idx="${i}" value="${gr.granulometria || ''}">` : (gr.granulometria || '-')}</td>
        <td>${editando ? `<input type="text" class="edit-notas" data-idx="${i}" value="${gr.notas || ''}">` : (gr.notas || '-')}</td>
        <td class="col-editar"><button type="button" class="btn-delete" onclick="eliminarIngredienteConfig('granos', ${i})">✕</button></td>
    </tr>`;
}
```

**`guardarTablaEnStorage(tipo)`** (reemplaza `guardarBibliotecaEnStorage` para el caso de edición inline; agregar/eliminar siguen usando su propio flujo ya existente): lee `getBiblioteca()` fresco, recorre solo `#tabla<Tipo> tr` leyendo los `.edit-*` de esa tabla, muta solo `bib[tipo]`, persiste el objeto `bib` completo (unchanged para los otros 2 arrays — no hay carrera porque cada guardado lee el storage recién antes de escribir), y dispara el refresh de selectores dependientes (`ct-comp` si `tipo==='granos'`, `dg-biblioteca` si `tipo==='aditivos'`) — la lógica ya existente de refrescar esos `<select>` (líneas 2284-2303) se extrae a un helper llamado condicionalmente, no en cada guardado de las 3 tablas.

**Por qué el re-render queda scopeado a una sola tabla:** si el guardado de Granos disparara `renderizarBibliotecaEnConfig()` completo (como hoy), y el usuario tiene Agentes a medio editar (inputs con texto tipeado sin guardar) en un panel oculto pero vivo en el DOM, ese re-render global pisaría silenciosamente esas ediciones no guardadas al volver a pintar Agentes desde `localStorage`. Escopar el render a `renderizarTablaEnConfig(tipo)` — solo la tabla que se acaba de guardar — elimina ese riesgo por construcción.

**CSS (`gr_styles.css`):** sin cambios en las reglas existentes (`.col-editar`, `.modo-edicion .col-editar`) — siguen funcionando igual porque `.modo-edicion` ahora se aplica al `<table>` puntual en vez de a `#config`, y la regla es un selector descendiente genérico. Se agrega una regla mínima para el botón `.btn-small` en `.config-list-title` si hace falta ajuste de alineación (flex, gap) — a resolver en implementación, no es un cambio de arquitectura.

### 3. Registro — reubicar y achicar controles

**`gr_index.html` (líneas 480-507):**

Se elimina la fila actual:
```html
<div style="margin-bottom:10px;display:flex;gap:10px;align-items:center;">
    <button type="button" id="btnEditRegistros" class="btn btn-secondary" onclick="grToggleEdicionRegistros()">✏️ Edit</button>
    <button type="button" class="btn btn-secondary" onclick="grLimpiezaProfunda()" ...>🧹 Limpiar inválidos</button>
</div>
```

`btnEditRegistros` se mueve a la fila del selector de orden (hoy líneas 486-494), como botón pequeño junto al `<select>`:
```html
<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
    <select id="grSortSelect" onchange="grSetSort(this.value)" ...>...</select>
    <button type="button" id="btnEditRegistros" class="btn-small" onclick="grToggleEdicionRegistros()">✏️ Edit</button>
</div>
```

`🧹 Limpiar inválidos` se reubica al pie del panel, junto al import, reducido de tamaño y sin el borde rojo grueso actual (se conserva el color de texto como única señal de "acción sensible"):
```html
<div class="import-buttons" style="margin-top:15px;display:flex;gap:10px;justify-content:center;align-items:center">
    <label class="btn btn-export" style="cursor:pointer">
        📥 Importar backup de GR
        <input type="file" id="btnImportJson" accept=".json" style="display:none" onchange="importarJSON(event)">
    </label>
    <button type="button" class="btn-small" onclick="grLimpiezaProfunda()" title="Elimina lotes sin unidades ni peso registrado" style="color:#FF6B6B;opacity:.7">🧹 Limpiar inválidos</button>
</div>
```

**`gr_app.js`:** `grToggleEdicionRegistros()` y `grLimpiezaProfunda()` no cambian de lógica — solo cambia el HTML/CSS que los invoca. Sin riesgo funcional.

## Impacto en datos / invariantes

- **Sin cambios de schema.** `gr_lotes` (formato de lote) y la biblioteca (`GR_BIBLIOTECA_KEY`, forma `{agentes:[], aditivos:[], granos:[]}`) no cambian de forma — `volumenTipico`, `notas`, `densidadTipica`, `granulometria` ya existían como campos del objeto, solo estaban inalcanzables desde la UI.
- **Sin migración necesaria** — no hay dato legacy que reinterpretar.
- **Ningún otro módulo lee/escribe `data-grtab`, `gr-sub-cfg`, `editMode`, `btnEditBiblioteca`** — confirmado por grep de todo el repo antes de este diseño.
- Regla 9 (bolsas FR selladas) y Regla 10 (TRACE solo lectura) no aplican — este cambio no toca FR ni TRACE.

## Validación

Sin test runner en este módulo (HTML/JS plano, sin build). Verificación en navegador real antes de dar por terminado:
1. Pestaña se llama "📚 Biblioteca", navega correctamente, no rompe el auto-open inicial de `grInit`.
2. Editar Agentes (toggle Edit, cambiar nombre/conc/volumen/notas, Save) → persiste tras F5. Cambiar a Granos mientras Agentes está a medio editar (sin guardar) → volver a Agentes conserva el texto tipeado (no se pisa).
3. Densidad de Granos editable y persistida; selector `.ct-comp` en Formulación refleja el nuevo valor tras guardar.
4. Eliminar (✕) funciona igual que antes, solo visible en modo edición, dentro de la tabla correspondiente.
5. Registro: botón Edit chico junto al selector de orden, togglea Cargar/Eliminar por card igual que antes. Limpiar inválidos dispara su `confirm()` y purga igual que antes, desde la nueva ubicación.
6. Consola sin errores nuevos al cargar el módulo GR completo.

## Notas fuera de alcance (no se tocan en esta sesión)

- SU y FR tienen el mismo patrón `⚙️ Config` / `data-subtab="cfg"` en su sub-navegación — la misma ambigüedad de nombre con el módulo CFG existe ahí, pero el usuario acotó el pedido a GR. Si se retoma, es un cambio independiente por módulo (mismo riesgo bajo, mismo tipo de verificación por grep).
- SU y FR también repiten el patrón de botón `✏️ Edit` tamaño completo en su Registro — no se toca, mismo motivo.
- No se elimina código muerto adicional (ej. el doble binding de `.config-tab[data-tab]` en gr_app.js:2313-2320, que ya duplica lo que hace `mostrarPanelConfig` inline) — no fue reportado como problema y tocarlo sería refactor por estética no pedido.
