# FR — 🥵 Sync deshidratado (reparto de peso seco entre bolsas secadas juntas)

## Problema

El usuario cosecha biomasa húmeda de varias bolsas por separado, pero las deshidrata **todas
juntas** en el mismo horno/deshidratador y pesa el resultado como un solo total. Hoy la única
forma de cargar `flush.pesoSeco` es bolsa por bolsa (`FR.editFlush`, inline en el dashboard de una
bolsa a la vez) — no hay manera de decir "esto que pesé son 109g repartidos entre estas 2 bolsas".

Consecuencia real, confirmada contra el backup del 2026-08-27: hay flushes con `pesoHumedo`
cargado y `pesoSeco` nunca completado que se acumulan sin que nadie los note — 3 activos hoy
(`FR124h`, `FR164l`, `FR234d`, el más viejo del 2026-06-06) más los 2 que motivaron este pedido
(`FR1707b`, `FR2207`, cosechados 2026-08-27). Sin un lugar que junte "bolsas cosechadas con seco
pendiente", quedan sueltos indefinidamente.

## Objetivo

Un flujo nuevo, autocontenido, que:
1. Liste las bolsas activas con un flush `pesoHumedo` cargado y `pesoSeco` todavía `null`.
2. Deje tildar cuáles se secaron juntas en la misma tanda de horno.
3. Pida el peso deshidratado total de esa tanda + la fecha/hora de fin de secado (compartida).
4. Muestre cómo quedaría repartido antes de guardar nada.
5. Escriba el resultado reusando exactamente el mismo camino de cálculo/guardado que ya usa la
   carga manual bolsa-por-bolsa — esto no reemplaza ese flujo, lo complementa para el caso real de
   "se secó todo junto".

Explícitamente fuera de alcance: edición del reparto propuesto fila por fila dentro del modal. Si
el usuario quiere ajustar el número de una bolsa puntual, ya tiene el editor individual existente
para eso (decisión del usuario en brainstorming — no duplicar esa capacidad acá).

## Por qué el reparto es proporcional al peso húmedo

Los 3 flushes que terminaron de secar el 2026-08-26/27 (`FR1407`, `FR2207b`, `FR2807d`) dieron un
`pctBiomasa` (seco/húmedo) casi idéntico — 5.901%, 5.905%, 5.903%, rango de 0.004 puntos
porcentuales — pese a ser genéticas y lotes GR distintos. El ratio húmedo:seco de este protocolo de
deshidratación (mismo horno, mismo rango de horas) es consistente entre bolsas de la misma tanda.
Repartir el total proporcional al peso húmedo de cada bolsa es, con este dato real de respaldo, la
aproximación correcta — no una estimación arbitraria.

## UI

**Botón nuevo** en la barra de acciones de FR (`fr/fr_index.html`, junto a "🔄 Sync desde SU" /
"➕ Bolsa huérfana", mismo `class="btn btn-secondary"`): **"🥵 Sync deshidratado"**.

**Modal nuevo** (mismo patrón que `frModalHuerfana`/el modal de sync: `display:flex` al abrir,
`display:none` al cerrar, sin guardado parcial — cerrar con X, click afuera o Cancelar descarta
todo sin tocar `fr_bolsas`, igual que los modales existentes hoy):

1. **Selector.** Tabla con checkbox por fila: id de bolsa, peso húmedo del flush pendiente, fecha
   de esa oleada. Fuente: recorrer `bolsas` completo (no solo la pestaña Cosecha) buscando, por
   bolsa activa (`!esArchivada(b)` — por decisión del usuario en brainstorming, cerradas quedan
   fuera de este flujo), el **último** flush con `f.pesoHumedo != null && f.pesoSeco == null`.
   Orden: fecha ascendente (las más viejas primero, para que no se sigan perdiendo de vista).
   Checkbox "seleccionar todo" en el header, mismo patrón visual que `fr-sel-cb`/`FR._selTodo` pero
   con su propio namespace de clase (`fr-sync-desh-cb`) — **sin reusar** el mecanismo de
   `fr-sel-cb`/`eliminarSeleccionados`, para no mezclar semánticas de selección distintas en el
   mismo DOM.
2. **Datos de la tanda.** Dos inputs, una vez para todo el grupo tildado:
   - `frSyncDeshTotal` (number, g) — peso deshidratado total real.
   - `frSyncDeshFin` (datetime-local) — fin de deshidratación, precargado con "ahora"
     (`new Date().toISOString().slice(0,16)`), editable.
3. **Preview** (se recalcula en cada cambio de selección o de total — `oninput`/`onchange`, sin
   botón "calcular" aparte): tabla solo-lectura, una fila por bolsa tildada — id, húmedo, seco
   propuesto, BE resultante (`beOleada(pesoHumedo, b.pesoSustratoSeco)`, mismo cálculo que ya existe).
   Suma de la columna "seco propuesto" mostrada al pie, debe calzar exacto con el total ingresado.
4. **Validación antes de habilitar Confirmar:**
   - Al menos 2 bolsas tildadas (con 1 sola no tiene sentido este flujo — usar el editor
     individual).
   - Total > 0.
   - Total < suma de los húmedos de las bolsas tildadas (imposible físicamente que el seco supere
     al húmedo) — si falla, mensaje inline, no `alert()` (el modal ya está abierto, no hace falta
     interrumpir con un diálogo nativo encima de otro).
5. **Confirmar** (`FR.aplicarSyncDeshidratado`): ver "Escritura" abajo.

## Cálculo del reparto

```
seleccion = bolsas tildadas, cada una con su flush pendiente y su pesoHumedo
totalHumedo = suma(seleccion[i].pesoHumedo)
para cada bolsa i (en el mismo orden que se muestran):
    crudo_i = total * (pesoHumedo_i / totalHumedo)
    redondeado_i = round(crudo_i, 1 decimal)
// Ajuste de redondeo: la bolsa de MAYOR pesoHumedo (no la ultima fila por orden de
// llegada) absorbe la diferencia, para que sum(redondeado) === total exacto. Cambiado
// en code review (Task 2, commit bc81fa4): con orden por fecha, la "ultima fila" puede
// ser una bolsa chica agregada tarde a la tanda -- asignarle el resto ahi podia dar
// pesoSeco negativo en tandas de 4+ bolsas. Un Math.max(0, ...) queda como backstop
// defensivo (no debería dispararse a los ratios seco:humedo reales de este dominio).
redondeado_mayor += (total - sum(redondeado))
```

Precedente de precisión: los `pesoSeco` ya cargados a mano en el dataset real usan 1 decimal
(46.5, 53.5, 50) — mantengo esa misma resolución, no invento más precisión de la que el usuario
mide en la práctica.

## Escritura

**Todo-o-nada, no skip-and-continue (revisado en code review final, ver Task 4 en el plan de
implementación).** El diseño original de esta sección proponía saltear la bolsa individual que
dejó de calificar y aplicar el reparto sobre el resto — se descartó: hacerlo así habría requerido
recalcular `_frSyncDeshReparto` sobre un subconjunto (el reparto original ya no suma el total que
el usuario realmente pesó), o aceptar una suma silenciosamente desalineada. La versión final aborta
el batch COMPLETO si cualquier bolsa tildada dejó de calificar — más simple, y el usuario vuelve a
abrir el modal para reintentar con el estado real actual.

Por cada bolsa tildada, en memoria (sin persistir todavía):
1. Re-verificar, en el momento de confirmar (no solo al abrir el modal), que la bolsa siga
   existiendo, siga teniendo un flush pendiente de secar, y no haya sido archivada mientras el modal
   estaba abierto — las 3 condiciones se chequean en un único paso al construir la lista de items
   (no en dos pasadas separadas: una implementación intermedia tenía una "re-verificación" que
   filtraba sobre una lista ya pre-filtrada, por lo que nunca podía detectar nada — bug real
   encontrado en el review holístico final). Si CUALQUIERA de las bolsas tildadas ya no califica,
   se aborta el batch entero (no se escribe nada) y se avisa cuáles fueron las que ya no
   calificaban.
2. `f.pesoSeco = redondeado_i`; `f.finDeshidratacion = frSyncDeshFin` (mismo valor para todas —
   compartieron la misma tanda de horno).
3. `recomputeFlushes(b)` — **la misma función que ya usa `FR.editFlush`**, sin reimplementar el
   cálculo de `beOleada`/`pctBiomasa`/`tiempoDeshidratacion`.
4. `var prevEstado = b.estado; b.estado = computeEstado(b);` — mismo patrón que `editFlush`.
5. Notas automáticas — mismas dos que ya genera `editFlush` cuando se completa el seco por primera
   vez, más una tercera propia de este flujo para que quede trazable que el número salió de un
   reparto y no de una pesada individual:
   - `'F' + f.n + ' - Peso seco registrado: ' + fmt(pesoSeco,1) + ' g - BE ' + fmt(beOleada,1) + '%'` (auto, green) — igual que hoy.
   - `'F' + f.n + ' - Fin de deshidratacion: ' + fmtFechaHora(fin)` (auto, none) — igual que hoy.
   - `'Peso seco repartido vía Sync deshidratado: ' + total + 'g totales entre ' + N + ' bolsas (' + ids.join(', ') + ')'` (auto, none) — nueva, una por bolsa, mismo `addObsTo`.
   - Si `b.estado !== prevEstado`: nota de cambio de estado, igual que hoy.

Después de procesar todas las bolsas tildadas (que no se saltearon), **un solo** `saveBolsas()` —
ya persiste el array completo de `bolsas` en una sola llamada a `localStorage.setItem`, así que el
conjunto de escrituras ya es atómico por construcción (todo-o-nada a nivel del JSON guardado, sin
necesitar lógica de transacción aparte). Si `saveBolsas()` falla (quota llena, etc.), ya cuenta con
su propio manejo (`BioLog.logError` + toast) — no hace falta duplicar eso acá.

`fr_cal_intel` **no se invalida** por esta escritura — mismo comportamiento que `editFlush` hoy:
el cache de FR·CAL sólo se invalida al guardar/eliminar una evaluación de `calidad`
(`FR.saveCalidad`/`FR.deleteCalidad`, `fr_app.js:5430`/`5505`), nunca por cambios de `pesoSeco` por
sí solos (confirmado leyendo `FR.editFlush`, que no toca `FR_CAL_INTEL_KEY`). No es una omisión de
este diseño, es preservar el comportamiento actual tal cual.

Al terminar: cerrar el modal, re-renderizar Activos/Cosecha/Archivo (el estado de alguna bolsa
puede haber cambiado), y un toast/alert resumen: cuántas bolsas se actualizaron y cuáles (si
alguna) se saltearon por el guard del paso 1.

## Testing

Casos a cubrir en el plan de implementación:
- Reparto proporcional exacto (2 y 3 bolsas), incluida verificación de que la suma redondeada
  calza con el total ingresado.
- Bloqueo de confirmar con total ≥ suma de húmedos.
- Bloqueo de confirmar con < 2 bolsas tildadas.
- Guard de re-verificación: una bolsa que dejó de calificar (otra pestaña/flujo le cargó el seco
  mientras el modal estaba abierto) se saltea sin romper el resto del lote.
- `computeEstado`/notas automáticas coinciden bit a bit con lo que produciría `editFlush` para el
  mismo input, corrido bolsa por bolsa.
