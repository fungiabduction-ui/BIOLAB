# CI — Buscador + rediseño de cards (Dashboard/Formulación) + chips GE

## Problema

Dashboard (`ci-dashboard-grid`, `ciRenderDashboard`) y Formulación (`ci-formulas-list`,
`ciRenderFormulasList`) muestran fórmulas de CI como una grilla de tiles (`.ci-dash-tile`).
Las dos funciones construyen un tile casi idéntico — duplicado a mano, con un comentario en el
código propio (`ci_app.js:5501-5503`) advirtiendo que es así "para no dejar uno de los dos
desactualizado". Tres problemas puntuales sobre esa card, más la ausencia total de un buscador:

1. **Sin forma de encontrar una fórmula por lo que usó.** Si el usuario quiere saber "¿en qué
   fórmulas usé levadura BOB'S?" o "¿dónde usé la cepa Thrasher?", tiene que abrir fórmula por
   fórmula.
2. **Chips de genética sin color** (`seg-tc-tag-gen`, gris plano) — inconsistente con el patrón ya
   establecido en FR/SU (`_genChipHtml`/`_suGenChipHtml`), que colorea el chip con el color real
   del nodo GE.
3. **Card con ruido/duplicación de datos:**
   - Nota de seguimiento embebida como cita — no aporta en una vista de grilla.
   - Barra verde de progreso que en realidad repite el mismo dato que ya muestra el chip
     "🧫 N/M" (% de placas sanas) — sin etiqueta, así que se leía como si fuera otra cosa
     (colonización).
   - El conteo de días activos aparece **duplicado con dos cálculos distintos**: el badge
     `🕐 ${diasBadge}` (naranja, `.ci-dash-dias-badge`, ya construido con el mismo criterio que
     usa `segActualizarDias()` para la columna D+ de SEG — el cálculo "bueno") y, por separado,
     un "- D ${dias}" perdido en gris adentro de la línea de ID (`tileIdDate`/`tileIdDate2`),
     calculado distinto (día de colonización más reciente en vez de inoculación más reciente).
     Pueden mostrar números distintos para la misma fórmula.
   - Experimentos solo se ven como conteo ("🔬 2 Exp"), no como qué frascos son.

## Alcance

**Se toca:** `ci/ci_app.js` (`ciRenderDashboard`, `ciRenderFormulasList` y todo lo que arman —
se consolidan en un helper compartido nuevo), `ci/ci_index.html` (agrega el input de búsqueda en
los headers de Dashboard y Formulación), `ci/ci_styles.css` (chip GE nuevo + limpieza de clases
que quedan sin uso).

**No se toca:** `ciDashRenderDetalle`/vista de detalle de una fórmula (fuera de esta sesión — el
pedido fue específicamente sobre las dos grillas), `buildFrmBodyHTML`, SEG/tandas
(`seg-tanda-card`, sigue usando `seg-tc-tag`/`seg-tc-tag-gen` sin cambios — esa clase queda viva,
solo las cards de Dashboard/Formulación dejan de consumirla), Cultivos, Ingredientes, ningún dato
persistido (`bl2_forms`, `bl2_seg`, `bl2_experimentos`, `biolab.ge.v4`) — 100% capa de render y
un helper de filtrado en memoria.

## 1. Chip de genética coloreado por GE (paridad con FR/SU)

Mismo patrón exacto que `_genChipHtml`/`_resolveGeColor`/`_hexToRgba` de `fr_app.js` y su
equivalente en `su_app.js` (ver `docs/superpowers/specs/2026-08-31-fr-su-genetica-chip-acortado-design.md`),
adaptado a CI con su propio prefijo (`_ci...`) porque cada módulo es su propia IIFE/scope sin
compartir funciones internas — mismo criterio que ya usan FR y SU (cada uno con su copia).

CI tiene una ventaja que FR/SU no tenían: **`geneticaId` (campo `seg.genetica`) YA ES el
`fenId`** directamente — no hace falta resolución multi-fuente como en FR (`_fenIdForGrSource`).
Confirmado contra el backup real: `seg.genetica` = `"NODE-MO9I1NQKV0VB"`, mismo id que la clave
del nodo en `biolab.ge.v4`.

```js
function _ciHexToRgba(hex, alpha) { /* idéntico a _hexToRgba de fr_app.js */ }

function _ciResolveGeColor(fenId) {
  if (!fenId) return null;
  try {
    if (window.ge && typeof window.ge.getNode === 'function') {
      const n = window.ge.getNode(fenId);
      if (n && n.color) return n.color;
    }
  } catch (e) {}
  try {
    if (window.GEResolve && typeof window.GEResolve.resolverNodoCrudo === 'function') {
      const r = window.GEResolve.resolverNodoCrudo(fenId);
      if (r && r.node && r.node.color) return r.node.color;
    }
  } catch (e) {}
  return null;
}

// label = último segmento del label completo (igual criterio que FR/SU: "Especie / Cepa / Fenotipo" → "Fenotipo")
function _ciGenChipHtml(fullLabel, fenId) {
  if (!fullLabel) return '';
  const parts = String(fullLabel).split('/').map(s => s.trim()).filter(Boolean);
  const label = parts.length ? parts[parts.length - 1] : fullLabel;
  const hex = _ciResolveGeColor(fenId);
  const bg = hex ? _ciHexToRgba(hex, 0.15) : null;
  const border = hex ? _ciHexToRgba(hex, 0.40) : null;
  const cls = 'ci-chip' + (bg ? '' : ' ci-chip-neutral');
  const style = bg ? ` style="background:${bg};border-color:${border};color:${esc(hex)}"` : '';
  return `<span class="${cls}"${style} title="${esc(fullLabel)}">🧬 ${esc(label)}</span>`;
}
```

`.ci-chip`/`.ci-chip-neutral` en `ci_styles.css`: mismo shape que `.fr-chip`/`.fr-chip-neutral`
(padding, border-radius, font-size ~10px) — nueva clase porque `.seg-tc-tag-gen` la siguen usando
las cards de SEG (tandas) sin cambios, y esas no llevan color de GE (serían dos usos con
comportamiento distinto bajo el mismo nombre si se reusara la clase existente).

Fallback si `_ciResolveGeColor` no resuelve: chip neutro (`ci-chip-neutral`, gris — mismo criterio
visual que tenía `seg-tc-tag-gen` hoy), nunca celda vacía, nunca excepción. `label`/`title` pasan
por `esc()` (ya usado en todo `ci_app.js`).

Se usa en las dos cards nuevas para el label de genética que hoy arma
`_segSoloUltimoSegmento(snap.label)` — esa función deja de usarse en este call site (sigue
existiendo para otros usos, no se toca).

## 2. Días activos — un solo número, dos estados visuales

Se elimina el "- D ${dias}" duplicado y desincronizado que hoy vive adentro de `tileIdDate`/
`tileIdDate2` (la parte de esas funciones que arma `` `${inoFmt} - ${colonFmt} - D ${dias}` ``
pasa a devolver solo `` `${inoFmt} - ${colonFmt}` ``, sin el sufijo). El único cálculo de "días"
que sobrevive es el que ya usa `_ciDashDiasDesdeInoculacion` (sin tocar su lógica — ya es correcta,
documentada como "mismo criterio que `segActualizarDias()`").

Nuevo tratamiento visual, según si la tanda más reciente ya coloniz��� o no
(`_segFmtDias` ya distingue esto por el prefijo que devuelve: `'D+'` = sigue contando, `'D '` =
cerrado):

- **Activo (`D+N`):** texto ámbar (`#FFC000`, ya es el color que usaba el badge viejo), ~19px,
  bold, con un punto pulsante al lado (`@keyframes pulse`, CSS puro, sin JS/timer — no hay nada
  que limpiar en `onModuleUnload`) y texto secundario tenue "desde inoculación · aún sin
  colonizar".
- **Cerrado (`D N`):** texto blanco (`var(--tx)`), mismo tamaño/peso, sin pulso, texto secundario
  "colonizó en N días".

Reemplaza al viejo `.ci-dash-dias-badge` (que se elimina — ya no se arma como línea aparte con
emoji 🕐, se integra en esta franja).

## 3. Chips de frascos de experimento

Nuevo, reemplaza al pill "🔬 N Exp" (que solo mostraba un conteo). Fuente: `expByFormula(f.id)`
(ya existe, sin cambios) → `flatMap(e => e.frascos)` → un chip por frasco con su `label` real
(ej. `"A' Ca restaurado"`, `"B (B complex)"`).

```js
function _ciExpFrascoChipsHtml(frmId) {
  const frascos = expByFormula(frmId).flatMap(e => e.frascos || []);
  if (!frascos.length) return '';
  const MAX = 6;
  const visibles = frascos.slice(0, MAX);
  const resto = frascos.length - visibles.length;
  const chips = visibles.map(fr =>
    `<span class="ci-chip ci-chip-exp" title="${esc(fr.label || '')}">🔬 ${esc(fr.label || '?')}</span>`
  ).join('');
  const overflow = resto > 0 ? `<span class="ci-chip ci-chip-neutral">+${resto} más</span>` : '';
  return `<div class="ci-dash-exp-chips">${chips}${overflow}</div>`;
}
```

`.ci-chip-exp`: color fijo azul (`rgba(68,170,255,.13)` bg / `rgba(68,170,255,.35)` border /
`#8fc6ff` texto) — mismo azul que ya usa `.seg-tc-tag-exp` en las cards de SEG, a propósito: acá
el color identifica "esto es un experimento", no una cepa, así que no debe competir visualmente
con los chips de GE (que sí varían de color por cepa). Cap de 6 chips visibles con overflow
"+N más" — defensivo, el dataset real hoy tiene máximo 4 frascos por fórmula, pero no hay límite
estructural en `bl2_experimentos` que lo garantice a futuro.

Sin frascos (fórmula sin experimentos): la fila entera no se renderiza (`''`), igual que hoy con
`expCount ? ... : ''`.

## 4. Layout final de la card

Reemplaza el bloque completo `.ci-dash-tile` de ambas funciones (mismo HTML para las dos, ver
sección 6 — consolidación):

```
┌────────────────────────────────────────┐
│ Nombre de fórmula              v1  ARCH │  ← .ci-dash-tile-top (sin cambios)
│ CI-0016 · 19/08                         │  ← .ci-dash-tile-id (ya no lleva "- D N")
│ ⬤ D+15  desde inoculación · sin colonizar│  ← NUEVO, reemplaza .ci-dash-dias-badge
│ 🧬 244  🧬 210                          │  ← .ci-dash-gen-chips, ahora con _ciGenChipHtml
│ 🔬 A' Ca restaurado  🔬 B' Ca+Fosfato…  │  ← NUEVO .ci-dash-exp-chips, solo si hay experimentos
│ C/N 28.4   98g   7 ings   🧫 37/37 sanas│  ← stats como chips en fila (ver abajo), NO grid 2x2
└────────────────────────────────────────┘
```

**Metrics — de grid de columnas a fila de chips.** Se elimina `.ci-dash-metrics`/
`.ci-dash-metric`/`.ci-dash-mval`/`.ci-dash-mlbl` (uso exclusivo de estas dos funciones,
confirmado por grep — no hay otro consumidor, se pueden borrar del CSS). Se reemplaza por chips
en una sola fila (`.ci-dash-stat-chip`, estilo pill oscuro, mismo tratamiento que ya usan otros
chips informativos del módulo). **Los colores por stat no cambian** — siguen siendo los mismos
que ya tenía cada uno (`--wn` para C/N, `--ac3` para masa, `--ac2` para ings, `ratioCol`
dinámico para sanas) — solo cambia el contenedor, de columna con label abajo a chip inline con
label adentro del mismo texto (ej. `"C/N 28.4"` en vez de número grande + "C/N" chico debajo).

**Se elimina por completo:** la barra de progreso verde (`ratioBar`, la construcción del string y
su render) y el bloque de última nota (`lastNota`, `.ci-dash-last-nota`, y el pill "📝 N Notas").
El cálculo de `ratio`/`ratioCol`/`sanas`/`totalP` se mantiene — sigue haciendo falta para el chip
"🧫 N/M sanas" — pero ya no alimenta ninguna barra.

**Borde izquierdo:** pasa de fijo (`border: 1px solid var(--border)`, sin color propio) a
`border-left: 3px solid <color>`, usando el color GE del primer elemento de
`geneticasUnicas`/`geneticasUnicas2` (si no resuelve color, fallback a `var(--border)`, el gris de
siempre). Con esto el borde deja de depender de notas (que ya no están en la card).

## 5. Buscador

**Un input por pestaña** (Dashboard y Formulación cada una con el suyo, estado independiente —
no sincronizado entre pestañas, para no generar acoplamiento sorpresa entre dos vistas que el
usuario puede usar para cosas distintas en el momento). Mismo placeholder/comportamiento en las
dos: `placeholder="🔍 Buscar cepa, ingrediente, nombre o ID…"`, filtra en vivo (`oninput`, sin
botón), estilo consistente con el input que ya existe en Cultivos (`#ci-cultivos-filter-q`).

**Campos que matchea** (case-insensitive, sin distinguir acentos — `normalize('NFD')` +
strip de diacríticos antes de comparar, por texto en español tipo "cepa" vs "César"):
1. `f.nombre` + `f.id` (substring).
2. Ingredientes: `f.ingredientes[].snapshot.nombre` — **el snapshot, no `bl2_ings` en vivo**
   (invariante de CI: el snapshot es inmutable al formular, buscar contra el catálogo actual
   rompería esa garantía y además podría no matchear el nombre que la fórmula tenía en su
   momento si el ingrediente fue renombrado después).
3. Genética: label completo resuelto (`_ciResolverGeneticaSnapshot(gid).label`, ej.
   `"Psilocybe cubensis / APE / Thrasher"`) de cada `genetica` único en los `segs` de esa
   fórmula — matchea por cualquier segmento de la cadena, no solo el último.

**Fuera de scope (decisión ya tomada en el brainstorming):** no matchea labels de frascos de
experimento ni notas de seguimiento — aunque los frascos ahora se VEN en la card (sección 3), no
se agregan a los campos buscables; mismo criterio para notas, que ni siquiera se muestran ya.

**Archivadas:** con query vacío, cada vista respeta su comportamiento actual (Dashboard nunca
muestra archivadas, Formulación respeta el toggle "Ver archivadas"). **Con query no vacío, la
búsqueda ignora el filtro de archivadas en las dos vistas** — puede aparecer una fórmula
archivada con su tag `ARCH` aunque el toggle esté apagado o aunque sea Dashboard (que hoy nunca
las muestra). Al vaciar el input, vuelve a filtrar como antes. En Formulación, mientras haya
texto en el buscador el botón "Ver archivadas" queda visualmente atenuado (`opacity:.5`,
`title="anulado mientras hay una búsqueda activa"`) — no se deshabilita de forma dura, solo
comunica que no está teniendo efecto en ese momento.

**Dónde va cada input:** Dashboard, en el header `.ct` de la card "📊 Dashboard CI — Fórmulas
activas" (`ci_index.html:65-69`), junto al botón "💾 Backup de CI" ya existente. Formulación, en
el header `.ct` de la card "📋 Fórmulas CI" (`ci_index.html:206-213`), junto a los botones de
Excel/backup/import ya existentes — el botón "Ver archivadas" no vive en ese header (se inserta
dinámicamente antes de `#ci-formulas-list-wrap` vía `_actualizarToggleArchivadas`,
`ci_app.js:777-796`), así que el atenuado mientras hay búsqueda activa se agrega en esa misma
función, no en el header.

**Contador de resultados:** línea chica arriba de la grilla, solo visible con query activo —
`"N fórmulas encontradas por \"texto\""`, con `" — incluye M archivada(s)"` agregado si
corresponde. Sin resultados: el mismo contenedor `.empty` que ya existe hoy para "sin fórmulas",
con el texto adaptado ("Sin fórmulas que coincidan con \"texto\".").

## 6. Consolidación — un solo builder de tiles

Antes de este cambio ya existía duplicación de markup; ahora además hay que duplicar toda la
lógica de búsqueda/filtrado de archivadas de forma idéntica en los dos lados — sostener eso a
mano en dos funciones de ~130 líneas cada una es exactamente el riesgo que el propio comentario
del código ya señalaba. Se extrae un helper nuevo, `_ciBuildFormulaTilesHtml(opts)`:

```js
function _ciBuildFormulaTilesHtml({ forms, segs, allIngs, query, showArchived }) {
  // 1. Filtra por archivada (según showArchived) y por query (según los 3 campos de la sección 5)
  //    — si query no está vacío, ignora showArchived (sección 5).
  // 2. Ordena por fecha desc (igual que hoy).
  // 3. Devuelve { html, total, totalArchivedShown } — el caller arma el contador y el .empty.
}
```

`ciRenderDashboard()` y `ciRenderFormulasList()` quedan como wrappers finos: leen su propio
input de búsqueda y (Formulación) su propio flag `_ciMostrarArchivadas`, llaman al helper, pintan
el resultado en su propio contenedor (`#ci-dashboard-grid` / `#ci-formulas-list`), y actualizan su
propio contador/botón de archivadas. La firma de tile individual (`onclick="ciDashOpenFormula(...)"`,
`onclick="ciCargarComoBase(...)"`) no cambia — mismos handlers, mismos ids de fórmula.

## Manejo de errores / casos borde

- Fórmula sin genética registrada en ningún `seg` → sin fila de chips GE (como hoy, `''`).
- Fórmula sin experimentos → sin fila de chips de frasco (como hoy con el conteo).
- `fenId` que no resuelve color (nodo borrado/archivado en GE, o GE vacío) → chip neutro, nunca
  excepción — mismo try/catch que FR/SU.
- Ingrediente en `f.ingredientes[]` sin `snapshot` (dato legacy muy viejo) → se salta ese
  ingrediente al buscar en vez de romper (`ing.snapshot?.nombre || ''`).
- Búsqueda con 0 resultados → estado `.empty` explícito, nunca grilla en blanco sin explicación.
- Texto con caracteres especiales de regex no aplica — el matching es substring plano
  (`.includes()`), no regex, así que no hace falta escapar el input del usuario.

## Fuera de alcance

- No se resalta el término buscado dentro de los chips/nombre (decisión explícita en el
  brainstorming — mantenerlo simple).
- No se sincroniza el texto de búsqueda entre Dashboard y Formulación.
- No se toca la vista de detalle de una fórmula (`ciDashRenderDetalle`) ni las cards de SEG
  (`seg-tanda-card`) — sus chips de genética (`seg-tc-tag-gen`) siguen sin color, es una vista
  de un solo ítem con espacio de sobra (mismo criterio que FR/SU usaron para no tocar sus
  paneles de detalle de una sola bolsa).
- No se agrega búsqueda por frasco de experimento ni por notas (decidido explícitamente arriba).
- No se corrige ni se toca `_ciDashDiasDesdeInoculacion`/`_segFmtDias` — su lógica ya es correcta,
  solo cambia cómo se pinta el resultado.
