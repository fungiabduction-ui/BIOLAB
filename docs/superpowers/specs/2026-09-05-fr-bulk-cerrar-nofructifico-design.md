# FR — Cierre en lote: "Cerrar ciclo" (Cosecha) y "No fructificó" (Activo)

## Problema

`FR.cerrarCiclo()` y `FR.marcarNoFructifico()` solo operan sobre `getSelected()` — una bolsa a
la vez, desde el panel de Dashboard. El usuario acumula muchas bolsas en 🟡 Cosecha cuyo ciclo
ya terminó en la realidad (cosechas hechas, nada más que registrar) pero que siguen sin
archivarse en la app porque cerrarlas de a una es demasiado trabajo manual. Necesita poder
seleccionar varias bolsas desde la vista de lista y archivarlas en un solo paso.

## Alcance

- **🟡 Cosecha** (`frControlesCosecha`): nuevo botón bulk **"⏹ Cerrar ciclo (N)"**.
- **🟢 Activo** (`frControlesActivos`): nuevo botón bulk **"🕳 No fructificaron (N)"**.
- **🔴 Archivo**: sin cambios — no se pide, y no aplica (ya está archivado).

### Por qué NO es el mismo botón en ambas pestañas

`cicloCerrado` sella el **último flush** de una bolsa que sí produjo (invariante documentado:
"Bolsas con 0 cosechas nunca deben archivarse como `cicloCerrado`"). `noFructifico` es el estado
terminal hermano, específico para bolsas con 0 cosechas (`docs/superpowers/specs/2026-09-02-fr-su-no-fructifico-design.md`).

Toda fila de 🟢 Activo tiene 0 flushes por construcción (`esEnCultivo()` lo exige); toda fila de
🟡 Cosecha tiene ≥1 flush por construcción (`esCosecha()` lo exige). Cada botón bulk vive
exclusivamente en la pestaña donde su precondición es siempre verdadera — no hay forma de que el
usuario cierre-ciclo una bolsa sin cosechas ni marque-no-fructificó una que sí tuvo. Esto además
significa que ninguna fila visible en esas dos pestañas puede estar ya archivada (`esArchivada()`
las excluye de ambas listas), así que las funciones bulk no necesitan implementar ninguna rama de
"reabrir" — solo la dirección de cierre.

## Mecanismo de selección — reuso, no invención

Las 3 tablas (Activo/Cosecha/Archivo) ya tienen, vía `_renderControlesTabla`, checkboxes
`.fr-sel-cb` por fila + "Sel. todo" + un botón con contador dinámico — hoy usado solo por
`FR.eliminarSeleccionados()`. "Sel. todo" opera sobre `tbody.querySelectorAll('.fr-sel-cb')`, es
decir, solo sobre las filas actualmente renderizadas (ya filtradas por búsqueda/lote SU si el
usuario tiene un filtro activo) — el bulk nuevo hereda ese comportamiento sin cambios.

Este diseño extiende ese mecanismo para soportar N botones de acción bulk por tabla, no solo
eliminar.

## Cambios de código

### 1. `_renderControlesTabla` — parámetro `bulkExtra` opcional

Firma nueva: `_renderControlesTabla(controlId, tbodyId, listaTodas, bulkExtra)`.

`bulkExtra` es `null` (Archivo, sin cambios) o un objeto:
```js
{ id: 'frBtnCerrarCicloSel', cls: 'fr-btn-cerrar-sel',
  labelBase: '⏹ Cerrar ciclo', fnName: 'FR.cerrarCicloSeleccionados' }
```
`renderCosecha()` pasa la config de "Cerrar ciclo"; `renderActivos()` la de "No fructificó".
Si `bulkExtra` está presente, su botón se inyecta en el `innerHTML` inicial (misma rama
`isFirstRender` que ya existe), entre "🗑 Eliminar seleccionados" y "🧹 Limpiar sin trazabilidad".
Ambos botones nuevos comparten la clase `fr-btn-bulk-count` y llevan `data-label-base` con su
texto sin contador — igual que se describe en el punto 2.

### 2. `FR._actualizarContadorSel` — generalizado

Hoy hardcodea `.fr-btn-del-sel`. Pasa a iterar `ctrl.querySelectorAll('.fr-btn-bulk-count')` y,
para cada uno, mostrar/ocultar y actualizar el texto a `data-label-base + ' (' + checked + ')'`.
El botón de eliminar existente gana `data-label-base="🗑 Eliminar seleccionados"` y la clase
`fr-btn-bulk-count` (sin quitarle `fr-btn-del-sel`, que sigue dando su estilo visual). Esto evita
duplicar la lógica de mostrar/ocultar/contar por cada botón bulk nuevo, presente o futuro.

### 3. `FR.cerrarCicloSeleccionados(tbodyId)` (nueva)

1. Lee `.fr-sel-cb:checked` de `tbodyId`, resuelve las bolsas por `dataset.frId` contra `bolsas`.
2. Filtra defensivamente cualquier bolsa que ya esté archivada
   (`contaminada || cicloCerrado || noFructifico || cancelada`) — cautela barata; no debería
   ocurrir nunca porque `esCosecha()` ya las excluye de esta tabla, pero evita reabrir/pisar por
   error si el dato cambió entre el último render y el click.
3. Si no queda ninguna válida, `alert()` y corta.
4. Un solo `confirm()` con la lista de IDs afectados (recortada a los primeros 15 + `"...y N más"`
   si son más — cubre el caso real de "muchas bolsas acumuladas" sin un diálogo ilegible), más el
   aviso de cuántas se omiten si hubo alguna archivada.
5. Si se confirma, aplica a cada bolsa válida el mismo cuerpo que `FR.cerrarCiclo()` ya usa para
   el caso "cerrar" (no el de "reabrir", que no aplica acá): `cicloCerrado = true`,
   `fechaCierreCiclo` = fecha del último flush o `hoyISO()`, `addObsTo(..., 'Ciclo cerrado en
   lote (bulk) desde Cosecha.', 'manual', 'none')`, recompute de `estado` con log de transición
   si cambió.
6. Un solo `saveBolsas()` + `renderAll()` al final (no uno por bolsa).

### 4. `FR.noFructificoSeleccionados(tbodyId)` (nueva)

Mismo patrón que el punto 3, reusando el cuerpo de cierre de `FR.marcarNoFructifico()` (sin la
rama de reabrir ni los guards de contaminada/cicloCerrado/flushes>0, que no pueden dispararse
en filas de Activo pero se conserva el mismo filtro defensivo del paso 2 por las dudas):
`noFructifico = true`, `fechaNoFructifico = hoyISO()`, `addObsTo(..., 'Bolsa marcada como NO
FRUCTIFICÓ en lote (bulk) desde Activo.', 'manual', 'yellow')`, recompute de `estado`.

### 5. CSS

Dos clases nuevas de toolbar, mismo tamaño/forma que `.fr-btn-del-sel` (empiezan `display:none`,
se muestran vía el contador generalizado):
- `.fr-btn-cerrar-sel` — borde/texto verde `var(--fr-accent)`, mismo lenguaje visual que
  `.fr-btn-cerrar` (el botón singular de Dashboard).
- `.fr-btn-nofructifico-sel` — borde/texto violeta `#B79CFF`, mismo lenguaje visual que
  `.fr-btn-no-fructifico`.

## Invariantes respetados

- No se toca `sincronizarTodo()` ni ningún campo derivado de SU/GR (`grSources`, `suLoteId`,
  pesos, etc.) — estas funciones solo tocan campos de estado terminal + observaciones.
- No hay forma de mezclar `cicloCerrado`/`noFructifico` incorrectamente: cada botón vive donde su
  precondición de flushes es siempre verdadera por construcción de `esEnCultivo`/`esCosecha`.
- Reversión sigue siendo bolsa por bolsa desde 🔴 Archivo, mecanismo ya existente — no se agrega
  undo bulk (más riesgo que valor para una operación ya reversible individualmente).
- Un solo `saveBolsas()` por lote, no N escrituras a `localStorage` — más seguro y más rápido que
  invocar la función singular N veces.
- Errores de guardado ya cubiertos por el `try/catch` + `window.BioLog` existente dentro de
  `saveBolsas()` — no hace falta manejo de errores adicional en las funciones nuevas.
- Ninguna de las dos funciones nuevas toca `bl2_*`, `gr_lotes`, `su_lotes` ni ningún otro módulo.

## Fuera de alcance

- Undo bulk (reversión masiva) — no se pidió.
- Cambios en 🔴 Archivo.
- El gap ya documentado de que ningún setter terminal (`marcarContaminada`, `cerrarCiclo`,
  `marcarNoFructifico`) chequea `cancelada` — preexistente, no relacionado con este pedido.
- Guard de `flushes.length === 0` en el `FR.cerrarCiclo()` singular del Dashboard — ese botón
  sigue sin esa validación (gap preexistente, fuera de este pedido); el bulk nuevo no lo hereda
  porque simplemente no puede dispararse en 🟡 Cosecha.
