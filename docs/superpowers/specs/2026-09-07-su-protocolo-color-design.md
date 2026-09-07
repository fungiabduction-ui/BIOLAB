# SU — Color por protocolo (lote) + propagación al chip SU en FR

## Relación con GR

Réplica exacta del mecanismo ya implementado en GR (`docs/superpowers/specs/2026-09-06-gr-protocolo-color-design.md`
y `docs/superpowers/plans/2026-09-06-gr-protocolo-color.md`) — mismo patrón, aplicado a `su_lotes`
en vez de `gr_lotes`. Este doc solo registra las decisiones específicas de SU (dónde difiere el
código real, qué se decidió distinto) — para el razonamiento de fondo (por qué cola rotativa y no
mapa mes→color, por qué el color se resuelve solo en el commit real, por qué custom properties CSS
en vez de clases, por qué `_hexToRgba` valida antes de interpolar) ver la spec de GR.

## Modelo de datos

Campo nuevo `color` (string hex `#rrggbb` o `null`) en cada objeto de `su_lotes` (`SU_STORAGE_KEY
= 'su_lotes'`, `su/su_app.js:14`). Aditivo — lotes existentes sin el campo se tratan como "sin
color" hasta que se guarden de nuevo o se coloreen desde el swatch.

Key nueva `su_color_seq` — contador propio, **independiente** de `gr_color_seq`. Nunca comparten
cola: un lote GR y un lote SU pueden coincidir en color por coincidencia, aceptable porque nunca
aparecen en el mismo chip (ver "Propagación — FR" abajo, son columnas distintas).

## Paleta

**Decisión (confirmada con el usuario, 2026-09-07):** `SU_COLOR_PALETTE` reutiliza exactamente
los mismos 12 hex que `GR_COLOR_PALETTE` (ya validados visualmente en el brainstorming de GR) —
constante propia, mismos valores, cola de asignación independiente. Se descartó definir una
paleta visualmente distinta: cero bikeshedding, y la coincidencia ocasional de color entre un lote
GR y un lote SU es inocua (nunca comparten chip/celda).

## Cuándo se asigna — `guardarLote()`, NO `recolectarDatosLote()`

Mismo trap que GR, confirmado por auditoría del código real antes de implementar:
`recolectarDatosLote()` (`su_app.js:902`) también la llaman `exportarJSON()` (`su_app.js:1825`) y
`exportarExcel()` (`su_app.js:1853`) — ninguno de los dos persiste nada. Resolver color ahí
quemaría la cola rotativa en cada export. La resolución vive exclusivamente en `guardarLote()`
(`su_app.js:803`).

**Diferencia estructural real con GR (no es una decisión de diseño, es cómo ya está escrita la
función):** en `gr_app.js`, todos los gates que pueden abortar el guardado (alerts +
`return`) ocurren ANTES del `if (indiceExistente >= 0) {...} else {...}` que hace el
push/assign final, así que GR resuelve el color una sola vez, antes de ese bloque. En
`su_app.js`, dos gates (`conflictoId` en la rama existente, ID duplicado en la rama nueva) están
DENTRO de cada rama, cerca del principio. Para que un guardado rechazado siga sin consumir la
cola (mismo invariante que GR), la resolución debe ir DESPUÉS de esos gates — es decir, como
último paso de cada rama, inmediatamente antes de `lotesData[indiceExistente] = lote;` /
`lotesData.push(lote);`. Se logra con dos llamadas a la misma función pura `_suResolveLoteColor(opts)`
(no lógica duplicada, dos call sites) en vez de reestructurar el control de flujo existente de
`guardarLote()` — cambio mínimo sobre una función delicada, ver plan para el código exacto.

## UI — Formulación (`su_index.html`, sección "Datos del Lote", líneas 84-99)

Nuevo `form-group` "Color" en el mismo `form-row` que ID Registro/Fecha/Estructura (el grid es
`repeat(auto-fit, minmax(200px,1fr))`, admite un 4° campo sin cambios de CSS). Mismo patrón que
GR: dimmed (`opacity:0.7`) hasta que se toca, `dataset.manualEdit` como flag de intención. Default
`#1F4E79` — el `--primary` propio de SU (equivalente al "dorado propio de GR").

## UI — Registro (`renderizarRegistroLotes`, `su_app.js:1384`)

**Card teñida:** borde izquierdo + fondo sutil vía custom properties (`--su-protocolo-color`/
`--su-protocolo-bg`/`--su-protocolo-bg-hover`, prefijo `su-` por Regla 7) en `.su-reg-card`
(`su_styles.css:1989`). El `:hover` existente de `.su-card-head` (púrpura fijo,
`rgba(139,92,246,0.07)`) se resuelve leyendo `var(--su-protocolo-bg-hover, <púrpura actual>)` —
aplicado desde el inicio (no como fix posterior) para no repetir el bug real que GR encontró en
code review (hover que apagaba el color justo en el momento de la interacción que precede al
click).

**Swatch clickeable** en `.su-card-head` (variante no-edición), antes de `.su-card-id`. A
diferencia de `grSetLoteColor` (que identifica el lote solo por `id`, porque `gr_lotes` no tiene
concepto de `_uuid`), `suSetLoteColor` identifica primero por `lote._uuid` — SU sí tiene identidad
estable por uuid (`guardarLote()` ya usa ese criterio: "Buscar por `_uuid` primero, luego por `id`
como fallback histórico", `su_app.js:832`) — y cae a `id` solo para lotes históricos sin uuid.
Relee `su_lotes` fresco de localStorage antes de mutar, mismo criterio que `_suEscribirBolsaFR`
(2026-09-02) y que `grSetLoteColor` (2026-09-06).

**Fuera de alcance, igual que GR:** `nuevoLote()` no resetea el picker de color — mismo gap que
GR (no lo toca tampoco). El modo edición del header de card (`su-card-head-edit`) no lleva swatch
— solo el header de vista normal, igual que `su-card-id` solo vive ahí hoy.

## Migración retroactiva

**Decisión (confirmada con el usuario, 2026-09-07):** SÍ migrar, igual que se terminó haciendo en
GR tras detectar 17 lotes reales sin color. `_suMigrarColorBackfillV1()` (mismo patrón one-shot,
flag `biolab_migracion_su_color_backfill_v1`) colorea todo lote de `su_lotes` sin `.color`,
ordenado por `fecha` ascendente, consumiendo `_suNextAutoColor()`. Se decide DESDE el inicio
(a diferencia de GR, que lo revirtió sobre la marcha) — se agrega como task propia del plan, no
como parche posterior.

## Propagación — FR (`fr_app.js`)

Columna SU de la tabla (`filaTabla:1268/1327`, `filaPendiente:3110/3122`), hoy texto plano
`"SU46 · 46a"` dentro de `<span class="fr-traza">`. Pasa a mostrar **solo el `suLoteId`**
(nunca `suSubTanda`), coloreado — mismo criterio ya aplicado para el chip GR en esta misma tabla
(`_grChipFromBolsa`, 2026-09-06): la sub-tanda es detalle de trazabilidad para el panel de
detalle de la bolsa, no para la vista rápida de tabla.

A diferencia del chip GR (que puede tener múltiples fuentes por bolsa vía `grSources[]`), una
bolsa FR tiene **un solo** `suLoteId` — no hay caso multi-fuente que dedupear. `getSULotesMap()`
(nueva, análoga a `getGRLotesMap()`, `fr_app.js:260`) resuelve el color en vivo contra `su_lotes`
en cada render, mismo mecanismo que el chip GR (`_grChipHtml`, ya genérico label+hex→span, se
reutiliza tal cual — vive en el mismo archivo, duplicarlo no aporta nada).

Los paneles de detalle de una sola bolsa (líneas 2393, 2618 — ASCII dashboard y SVG de traza)
siguen mostrando `suLoteId · suSubTanda` completo sin acortar — mismo alcance que la spec de GR
y la de genética (2026-08-31): estas vistas de detalle quedan explícitamente fuera. `_frBuscar`/
`_sortValue` (búsqueda y orden por columna, `fr_app.js:1400/1413`) usan `b.suLoteId` directo, no
la variable de display — no se tocan.

## Manejo de errores / casos borde

Idéntico a GR (ver esa spec): lote SU referenciado por FR que ya no existe → chip neutro, nunca
excepción ni celda vacía. `su_color_seq` corrupto → `parseInt(...) || 0`, reinicia la cola sin
romper nada. `lote.color` con hex inválido → `_suHexToRgba`/`_hexToRgba` devuelven `null`, jamás
se interpola `lote.color` crudo en un atributo `style`.

## Fuera de alcance

- `importarJSON`/`importarExcel` de SU no backfillean `color` — igual que GR con su propio
  `importarJSON`, un lote importado desde un JSON viejo se ve neutro hasta re-guardarse.
- Ningún otro consumidor de `su_lotes` (Conocimiento, KPIs, etc.) cambia — solo Registro (card) y
  la columna SU de FR.
- Sin corrección de contraste dinámico texto/fondo — mismo criterio que GR y que el chip de
  genética.

## Antes de implementar

Regla 8: pedir al usuario un export fresco antes de tocar `su_app.js`/`fr_app.js` en producción
(cambio aditivo, pero de todas formas).
