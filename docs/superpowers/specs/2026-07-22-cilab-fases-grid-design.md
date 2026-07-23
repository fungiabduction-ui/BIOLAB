# CILAB Conocimiento — rediseño del registro de fases (grid de un click)

**Fecha:** 2026-07-22
**Módulo:** `cilab/cilab_conocimiento.js` (panel de scoring, sección Fases)
**Origen:** sesión de brainstorming (superpowers) — usuario reportó el sistema actual de fases como "incómodo", pidió simplificarlo a interacciones de un click, con visor de mockups en el navegador.

## Problema

Hoy, al expandir una cepa en el panel de scoring de Conocimiento, conviven **dos mecanismos redundantes** para registrar la misma cosa (en qué fase del ciclo está esa cepa y cuándo):

1. **`_creFasesScrubberHTML`** — línea de tiempo horizontal con puntos que se arrastran (`creScrubStart`/`_creOnScrubMove`/`_creOnScrubEnd`) para fijar un "día" en un eje 0-35. No muestra fecha real mientras se arrastra, solo "Día N". Impreciso con mouse/trackpad.
2. **`_creMetabolicFasesHTML`** (dentro de `_creScoringFormHTML`) — lista vertical tipo stepper, cada fase pendiente tiene un botón "+ Registrar" que abre un mini-formulario inline (fecha, a veces + placas observadas) que hay que confirmar con ✓.

Ninguno de los dos es "un click y listo". El usuario valida la información que se recolecta (en qué día está, fechas) pero rechaza explícitamente la interacción de arrastrar/posicionar un punto en un eje.

## Diseño aprobado

Reemplazar ambos por **un solo grid de chips grandes**, un chip por fase (mismo lenguaje visual que la grilla de botones de Score 1-10 que ya existe en el mismo panel — consistencia visual con un patrón que el usuario ya usa y entiende).

### Estados del chip

- **Pendiente:** borde punteado, nombre de la fase + "típ. día N" (de `_FASES_DEF[].typicalDay`).
- **Hecho:** relleno con el color de `_FASES_DEF[].color`, nombre + "Día N · DD/MM HH:MM".
- **Hecho + auto (CI):** igual que "Hecho", más un tag pequeño "CI" — aplica a `inoculacion`/`colonizacion_completa` cuando vinieron de `_creAutoFillInoculacion`/`_creAutoFillColonizacion` (sin cambios en esa lógica, ver más abajo).

### Interacción — modo individual (una cepa expandida, no batch)

- **Click en chip pendiente:** guarda inmediatamente, sin formulario ni confirmación. `fecha = hoy (YYYY-MM-DD)`, `ts = now()` (ISO completo, hora real del click), `dia` calculado igual que hoy (diff contra fecha de inoculación de esa cepa). El chip pasa a "Hecho" al toque.
- **Click en chip hecho:** abre una franja de edición **debajo del grid** (no popover flotante posicionado sobre el chip — más simple, más robusto para touch). Es una única franja compartida, no una por chip: clickear otro chip hecho reemplaza el contenido de la franja por el de ese chip; clickear el mismo chip que ya está abierto la cierra (toggle). Contiene:
  - Input `fecha` (date) y `hora` (time), precargados desde el registro existente (`fecha` + la porción de hora de `ts`).
  - Para las 3 fases intermedias (`primeros_filamentos`, `crecimiento_activo`, `rizomorfismo_evaluable`) además un input opcional "Placas observadas" — opcional de verdad, no bloquea el guardado si se deja vacío (hoy sí lo era en el form viejo para incidencia, pero no se usa en ningún cálculo fuera de Conocimiento — confirmado por grep, `cilab_inteligencia.js`/`cilab_formula_intelligence.js` no lo tocan).
  - Botones Guardar/Cancelar. Guardar recalcula `dia` desde la fecha nueva, actualiza `fecha` y reconstruye `ts` combinando la fecha+hora editadas (para que nunca queden desincronizados entre sí).
- Fases auto (inoculación/colonización) siguen auto-completándose igual que hoy al renderizar (`_creAutoFillInoculacion`/`_creAutoFillColonizacion`/`_creAutoFillInferredFases`, sin tocar). Si CI ya las trajo, el chip nace en estado "Hecho + CI"; igual queda clickeable para corregir con el mismo flujo de edición de cualquier otro chip.

### Interacción — modo batch (múltiples cepas seleccionadas)

Se mantiene el paso de confirmación que ya existe hoy para batch (aplicar a N cepas de un click accidental es más riesgoso que aplicar a una sola) — equivalente a lo que hace `_sp.batchStagedFase` hoy: click en un chip pendiente **stagea** la fase (no escribe todavía), aparece una barra "Registrar en N cepas · Día X — ✓ Confirmar / ✕ Cancelar". Confirmar aplica a todas las cepas seleccionadas reusando la lógica de escalado proporcional de `placasObservadas` que ya existe en `creRegisterFaseConfirm`/`_creBatchFaseScrubSave` (por cepa, según su propia fecha de inoculación).

### Qué NO cambia (efectos colaterales a preservar tal cual)

- `_creLogFase(formulaId, geneticaId, faseId, dia, fecha, isEdit, _sp.frasco)` — se sigue llamando en cada registro/edición, mismo log de notas automáticas en CI.
- `_creSyncColonizacionToCI(formulaId, geneticaId, fechaStr)` — se sigue llamando cuando se registra/edita `colonizacion_completa`, sigue escribiendo de vuelta en `bl2_seg`.
- `creColonizacionCierrePrompt(formulaId, geneticaId, dia)` — se sigue disparando (mismo `setTimeout(..., 80)`) después de registrar colonización.
- `_creColonizacionStats()` (la penalización por colonización lenta que se agregó en esta misma sesión) — sigue leyendo `bl2_crec_fases` sin cambios, porque el schema no cambia.
- Auto-fill de fases inferidas (`_creAutoFillInferredFases`) — sin cambios.

### Schema de datos — sin cambios

`bl2_crec_fases[key] = [{ fase, dia, fecha, ts, auto?, placasObservadas?, totalPlacas? }]` — **se mantiene idéntico**. Punto importante encontrado al diseñar: `ts` (timestamp ISO completo) **ya se guarda hoy** en cada fase (`ts: now()`), solo que nunca se muestra en ninguna UI. No hace falta agregar ningún campo nuevo para tener hora — alcanza con empezar a leer/mostrar `ts`.

`fecha` se sigue guardando como `YYYY-MM-DD` puro (no datetime completo) — varias partes del código ya existente parsean `fecha.split('-')` asumiendo exactamente ese formato para armar "DD/MM" (`_creMetabolicFasesHTML` display, ya se elimina, pero el mismo patrón podría reaparecer en otro lado; se mantiene la convención por las dudas). La hora vive aparte, derivada de `ts`.

## Qué se elimina

Funciones completas (el mecanismo de arrastre deja de existir):
- `_creFasesScrubberHTML`, `creScrubStart`, `_creOnScrubMove`, `_creOnScrubEnd`, `creFaseScrubSave`, `creDeleteFaseFromScrubber`
- `creBatchScrubStart`, `_creBatchFaseScrubSave`, `_creBatchFasesScrubberHTML`
- `window._creScrubCleanup` y su invocación en `cilabUnload()` (`cilab_app.js`) — existía específicamente para limpiar los listeners `pointermove`/`pointerup` del drag al descargar el módulo (bug de la auditoría 2026-07-10, documentado en `BIOLAB_SYSTEM.md` §CILAB). Sin drag, no hace falta el hook — se saca de los dos archivos, no se deja como no-op.

Funciones reemplazadas (la lógica de cómputo de `dia`/escalado por cepa se reutiliza, pero la UI que las dispara — botón + form inline — ya no existe):
- `_creMetabolicFasesHTML`
- `creRegisterFase`, `creRegisterFaseConfirm`, `creRegisterFaseCancel`
- `creEditFase`, `creEditFaseConfirm`, `creEditFaseCancel`

Se reemplazan por funciones nuevas del grid (nombres a definir en el plan de implementación) que conservan el mismo cálculo de `dia` (diff de fechas contra `_creInoculacionDate`), el mismo escalado proporcional de `placasObservadas` en batch, y disparan los mismos efectos colaterales listados arriba.

## Call sites a actualizar

- `cre-cepa-card-body` (donde hoy se llama `_creFasesScrubberHTML(formulaId, cepa.id)` seguido de `_creScoringFormHTML(...)`): la llamada al scrubber se reemplaza por la llamada al nuevo grid, en la misma posición (arriba de la card).
- `_creScoringFormHTML`: se saca la columna derecha ("Fases" vía `_creMetabolicFasesHTML`) del layout `cre-2col-layout` — el grid ya vive arriba, en la card. La sección Score pasa a ocupar el ancho completo donde antes compartía columna con Fases.

## Testing / verificación

- Script Node standalone (mismo patrón que se usó en esta sesión para MEJ-0015) con la lógica de escritura de fase copiada verbatim: verificar cálculo de `dia`, formato de `fecha`/`ts`, y el caso de edición (fecha+hora nuevas → `fecha` y `ts` quedan consistentes entre sí). Casos: individual pendiente→click, individual hecho→editar, batch pendiente→stage→confirm con 2+ cepas con distinta fecha de inoculación (verificar escalado de `placasObservadas` y `dia` per-cepa).
- No-regresión: confirmar que `_creColonizacionStats()` sigue leyendo bien un registro de `colonizacion_completa` creado por el nuevo flujo (mismo shape de dato).
- Verificación visual en la app real corriendo (esto es un cambio de UI/interacción — un test de Node no confirma que se sienta bien al usarlo). Cargar el módulo, expandir una cepa, click en un par de chips, confirmar que el chip cambia de estado, que la franja de edición abre/cierra bien, y que el batch pide confirmación antes de aplicar.

## Fuera de alcance

- No se toca `_creAutoFillInoculacion`/`_creAutoFillColonizacion`/`_creAutoFillInferredFases`, `_creColonizacionStats`, `_creLogFase`, `_creSyncColonizacionToCI`, `creColonizacionCierrePrompt` — se reutilizan tal cual.
- No se cambia el schema de `bl2_crec_fases` ni de `bl2_crec` — solo la superficie de UI que escribe/lee esos datos.
- No se migra data histórica — los registros de fases ya guardados (con o sin `ts`) siguen siendo válidos; si un registro viejo no tiene `ts` (no debería pasar, pero por robustez), el chip muestra la fecha sin hora en vez de romper.
