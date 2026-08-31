# FR/SU — Genética acortada a chip coloreado (último eslabón)

## Problema

FR y SU muestran la genética de una bolsa/tanda como la cadena completa GE, de raíz a hoja,
unida con `' / '` (ej. `PC / APE / APE 338 / SIF / F2 / F2B`). En las vistas de lista (varias
filas visibles a la vez) esto ocupa demasiado espacio horizontal y obliga a leer la cadena
entera para encontrar el dato que realmente distingue la fila: el último eslabón (`F2B`).

En el caso multi-fuente (una bolsa armada con grano de más de una tanda GR), el problema se
duplica: `PC / APE / APE 338 / SIF / F2 / 210 + PC / APE / APE 338 / SIF / F2 / F2B` repite el
prefijo común dos veces.

## Objetivo

Mostrar solo el último eslabón de la cadena (`F2B`, o `210 + F2B` para multi-fuente) en las
vistas de lista, como chip coloreado con el mismo color que el nodo tiene asignado en GE, con
la cadena completa disponible en `title` (tooltip al hover). Cero pérdida de trazabilidad: el
dato completo sigue en el DOM (tooltip) y en storage (sin cambios).

## Alcance

**Se acorta:**
- FR — tabla principal Activo/Cosecha/Archivo (`filaTabla`, `fr_app.js:1259`, celda `ge` en
  `fr_app.js:1322`).
- FR — tabla de Pendientes de confirmación (`filaPendiente`, `fr_app.js:2927`).
- FR — Vista General / landing del Dashboard sin bolsa seleccionada (`_ovFilas`,
  `fr_app.js:2710`).
- SU — columna GENÉTICA de las sub-filas en cards de Registro (`grTxtParts`/`grTxt`,
  `su_app.js:1331-1351`, renderizado en `su_app.js:1463`).

**NO se toca (decisión explícita del usuario en brainstorming):**
- FR — panel de detalle de una bolsa seleccionada en el Dashboard (filas "Genética:" en
  `fr_app.js:2357/2360/2410/2413`). Es un solo ítem con espacio de sobra; ahí la cadena
  completa aporta más de lo que estorba.
- FR — ficha de Bolsa Huérfana. Mismo criterio: vista de detalle de un solo ítem.
- Cualquier dato persistido: `geneticaFull`, `genetica`, `fenotipo`, `fenId`, `grSources[]`,
  `dg[].genetica`/`dg[].fen_id`. Este cambio es 100% capa de render — no escribe en
  `fr_bolsas`, `gr_lotes`, `su_lotes` ni `biolab.ge.v4`, no requiere migración.

## Diseño visual — chip, no solo texto corto

Reutiliza el color que cada nodo GE ya tiene asignado (`node.color`, hex, seteado a mano en el
panel de detalle de GE) en vez de introducir una paleta nueva. Formato idéntico al de los chips
que ya existen en cada módulo (`.fr-chip` en `fr_styles.css:415-424`, `.su-kchip` en
`su_styles.css:2166-2174`): fondo al color con ~15% opacidad, borde al ~40%, texto sólido del
color. Label = último segmento de la cadena (`F2B`). `title` = cadena completa sin acortar.

Multi-fuente: un chip por fuente, unidos por `' + '` como texto plano entre chips (no dentro de
un único chip) — cada fuente puede tener un color GE distinto y merece su propio tooltip con su
propia cadena completa.

Si el color no resuelve (ver fallback abajo), el chip se renderiza igual pero con la clase
neutra existente (`fr-chip-neutral` / `su-kchip-dim`) — nunca celda vacía, nunca excepción.

## Resolución de `fenId` → color

Todo pasa por un único helper nuevo por módulo (mismo nombre en los dos, cada uno vive en su
propia IIFE — convención ya establecida en este archivo para helpers de display como
`_abbrevGen`, que existe duplicado en `fr_app.js:2904` y `su_app.js:1206`):

```js
function _genChipHtml(fullChainStr, fenId) {
    // 1. label = último segmento no vacío de fullChainStr.split('/').map(trim)
    // 2. color = _resolveGeColor(fenId)  — null si no resuelve
    // 3. si color: <span class="fr-chip" style="background:rgba(...,.15);
    //      border-color:rgba(...,.4);color:<hex>" title="<fullChainStr esc>"><label></span>
    // 4. si no: <span class="fr-chip fr-chip-neutral" title="<fullChainStr esc>"><label></span>
    // 5. si !fullChainStr: retorna '—' tal cual hoy, sin chip
}
```

`_resolveGeColor(fenId)` intenta, en orden, y devuelve `null` si ninguno resuelve (nodo
archivado/borrado, árbol vacío, `fenId` ausente):
1. `window.ge.getNode(fenId)?.color` si `typeof window.ge?.getNode === 'function'` (GE montado
   en memoria — más rápido, no toca localStorage).
2. `window.GEResolve.resolverNodoCrudo(fenId)?.node?.color` si
   `typeof window.GEResolve?.resolverNodoCrudo === 'function'` (fallback, lee
   `biolab.ge.v4` crudo — mismo primitivo que ya usa el bloque de enriquecimiento de
   `grSources` en `fr_app.js:796-807` y `grGetNombreGeneticaPorId` en `gr_app.js:2456-2470`).

No se toca `window.ge.getSelectableGenetics()` — su contrato de retorno está documentado como
congelado en `ge_app.js:471-476` ("Contrato con CI y otros módulos. No cambiar firma ni formato
de retorno") y de todas formas no expone `color`.

### De dónde sale `fenId` en cada call site

- **FR, fila single-source** (la mayoría de los casos): `b.fenId`, ya persistido en la bolsa
  desde su creación (`fr_app.js:836`, `:1015`, `:4613`, `:4804`). Lookup directo, sin lecturas
  extra.
- **FR, fila multi-source** (el caso `210 + F2B`): `grSources[]` nunca guardó `fenId` por
  fuente — solo `geneticaFull`, `inoculoSource`, `inoculoCiId` (`fr_app.js:631-634`). Agregar
  el campo ahora en el enriquecimiento de sync solo ayudaría a bolsas sincronizadas después de
  este cambio; las ya selladas (`pendienteConfirmacion:false`) tienen `grSources` permanentes
  por Regla 9 y jamás se tocan en sync, así que la mayoría de los datos reales seguiría sin el
  campo. En vez de eso, se resuelve en vivo: por cada fuente, `grMap[s.grLoteId].dg[]` filtrado
  por `s.grTandaId` → `.fen_id` (mismo lookup que ya hace `fr_app.js:782-790` en otro
  contexto). `gr_lotes` es lectura permitida para FR (`fr_app.js` cabecera: "Solo lee:
  su_lotes, gr_lotes, biolab.ge.v4"), así que esto no es una expansión de arquitectura — es una
  lectura nueva en un momento nuevo (render en vez de sync) de una key que FR ya tiene permiso
  de leer. Si el lote/tanda GR ya no existe (borrado), fallback a chip neutro.
- **SU**: el lookup a `grMap[s.grLoteId].dg[k]` ya existe tal cual en `su_app.js:1337-1346`
  para sacar `.genetica` — el mismo objeto `_grL.dg[k]` ya trae `.fen_id` (mismo shape que GR
  usa internamente, confirmado contra `gr_app.js`). Cero lecturas nuevas, solo capturar un
  campo que ya está en memoria en ese loop.

  **Qué parte de la celda se reemplaza en SU:** hoy `grTxtParts.push(s.grTandaId + (_gen ? '
  — ' + _abbrevGen(_gen) : ''))` (`su_app.js:1348`) arma, por fuente, `"TANDA — cadena
  completa"`, y luego `grTxt = grTxtParts.join(' + ')` (`su_app.js:1351`) une las fuentes.
  Solo se reemplaza `_abbrevGen(_gen)` por `_genChipHtml(_gen, _fenId)` — el prefijo
  `s.grTandaId + ' — '` y el separador `' + '` entre fuentes quedan textuales, igual que hoy.
  Resultado para 2 fuentes: `T1 — [210] + T2 — [F2B]` (chips solo en la parte de genética).

### Por qué SU necesita cargar `shared/ge_resolve.js`

`su_index.html` no carga hoy `shared/ge_resolve.js` (sí lo hacen `fr_index.html`, `gr_index.html`,
`ci_index.html`). Se agrega el mismo `<script src="../shared/ge_resolve.js"></script>` antes de
`su_app.js`, mismo lugar relativo que en `fr_index.html:832-833` (justo antes del script del
módulo). Es el punto entero de que ese archivo exista como script compartido en vez de vivir
dentro de un módulo — su propio comentario de cabecera documenta que ya se dedupliró esta
misma lógica 3 veces (CI/FR/GR) para evitar que cada consumidor la reimplemente; SU sería un
cuarto consumidor y debe usar el mismo primitivo, no una quinta copia.

## Manejo de errores / casos borde

- `fullChainStr` vacío o `undefined` → se preserva el comportamiento actual (`'—'`), sin chip.
- `fenId` ausente, o apunta a un nodo archivado/borrado, o `biolab.ge.v4` vacío/corrupto →
  chip neutro con label + tooltip igual (nunca celda en blanco, nunca excepción sin capturar).
- `color` con formato inesperado (no hex de 6 dígitos, por edición manual futura de GE que no
  valide el input) → el parseo hex→rgb falla silenciosamente a `null` → mismo fallback neutro.
- Todo texto (`label`, `title`) pasa por el escapador de HTML de cada módulo antes de
  interpolarse — `esc()` en `fr_app.js` (ya usado en todo el archivo, ej. `fr_app.js:1260`),
  `suDbEscapeHtml()` en `su_app.js` (`su_app.js:2542-2549`, la única función de escape de
  propósito general que tiene ese archivo — `cfgEscapeHtml` es la otra, específica del panel
  de config). Nombres de genética son texto libre cargado por el usuario en GE; el `title`
  nuevo es la primera vez que ese texto entra a un atributo HTML en esta celda de Registro, así
  que sin escape un `"` en el nombre rompería el atributo.
- Sin contraste dinámico texto/fondo: se usa el hex del nodo tal cual, igual que ya hace GE en
  su propio panel (`ge_app.js:592`, color de texto = `node.color` sin corrección). No se
  introduce lógica de contraste nueva — sería inconsistente con cómo GE ya lo muestra y está
  fuera de alcance de este cambio.

## Fuera de alcance

- No se cambia el color de un nodo GE ni se agrega UI para asignarlo — se **lee** el que ya
  existe.
- No se persiste `fenId` en `grSources[]` ni se migra nada — la resolución multi-source es
  siempre en vivo, en cada render.
- No se toca `_abbrevGen` (la función que reemplaza "Psilocybe cubensis" → "PC") — sigue
  existiendo igual en ambos módulos; el chip nuevo la vuelve mayormente redundante para el
  label corto (la especie casi nunca es el último segmento) pero no hay razón para tocarla:
  otros call sites que no se acortan siguen dependiendo de ella.
- No se agrega corrección de contraste de color (ver arriba).
- Vista General de FR (`_ovFilas`) usa hoy una construcción de `ge` inline distinta a
  `_geTxtFromBolsa` (`fr_app.js:2721-2725`, no soporta multi-source). Se la migra a llamar al
  mismo helper nuevo `_genChipHtml` para no triplicar la lógica de acortado+color, pero no se
  le agrega soporte multi-source si no lo tenía — eso sería una expansión de funcionalidad no
  pedida.
