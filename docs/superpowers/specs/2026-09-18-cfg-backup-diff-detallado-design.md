# CFG — Diff detallado de backups de GitHub Sync

**Fecha:** 2026-09-18
**Estado:** aprobado por el usuario (aprobación en bloque, sin lectura detallada — ver nota abajo)

## Contexto

`ghDiffBackupModulos` (`cfg/cfg_app.js:705-730`) ya existe: al tocar "¿Qué cambió?" en el listado de backups de GitHub Sync (`cfg/cfg_app.js`, sección GITHUB SYNC), descarga los dos backups completos (actual + el inmediato anterior en la lista, vía Blobs API) y compara las keys de `localStorage` con `JSON.stringify`. El resultado hoy es un `<span>` con los nombres de módulo afectados (ej. "SU, CI") y un `title` (tooltip nativo) con las keys crudas que cambiaron.

**Problema real que motivó esto (mismo día):** el usuario vio "SU" en el listado sin haber tocado SU a propósito, y no tenía forma de confirmar rápido si era una edición real (riesgo de datos) o un efecto secundario esperado (en este caso, la migración automática de color-por-protocolo corriendo por primera vez). Tuvo que pedir una comparación manual de los backups reales para confirmarlo. El objetivo de este cambio es que esa confirmación esté disponible en la propia UI, sin depender de pedirle a una IA que baje los JSON a mano cada vez.

## Objetivo

Mostrar, para cualquier backup con un anterior disponible, el detalle real de qué cambió: qué registros se agregaron/eliminaron/modificaron dentro de cada key, y dentro de un registro modificado, qué campos cambiaron (valor viejo → nuevo) — suficiente para que el usuario decida con confianza si restaurar/sobreescribir es seguro, sin tener que abrir la app y comparar a mano.

## Decisiones (de la sesión de brainstorming)

1. **UI: panel expandible inline**, no tooltip ni modal. El botón "¿Qué cambió?" pasa a ser un toggle (▶/▼) que inserta una fila (`<tr><td colspan="5">`) debajo de la fila del backup, con el detalle estructurado. Vuelve a colapsarse al tocar de nuevo. Elegido por sobre tooltip (no persiste, sin espacio, inútil en touch) y por sobre modal (más pasos para un vistazo rápido, más código nuevo de overlay/cierre).
2. **Detalle a nivel de campo**, no solo "qué registro cambió". Para cada registro modificado se muestra cada campo que cambió con su valor viejo y nuevo.
3. **Cambios idénticos se agrupan.** Si N registros de una misma key tuvieron el mismo tipo de cambio (mismo campo agregado/quitado/modificado, sin importar si el valor nuevo es distinto en cada uno — ej. colores distintos por lote), se muestra una sola línea resumen ("36 registros: +campo `color`") con el detalle por-registro disponible al expandir esa línea, no forzado a la vista por defecto.
4. **Solo se compara contra el backup inmediato anterior**, igual que hoy — no se agrega selección libre de dos backups arbitrarios. Si hace falta a futuro, es una extensión aparte.

## Arquitectura

### Motor de diff genérico y recursivo (nuevo)

Una función pura `_bkDiffValue(keyPath, oldVal, newVal, depth)` que no sabe nada de módulos ni de biolab — solo sabe comparar dos valores JS arbitrarios y devolver una lista de cambios estructurados. Vive junto a `ghDiffBackupModulos` en `cfg_app.js` (no es una lib compartida nueva — es una función interna de esta feature, dentro de la misma IIFE de CFG).

**Por qué genérico en vez de una tabla de config por key:** de las 11 keys array-de-registros que existen hoy (`su_lotes`, `gr_lotes`, `fr_bolsas`, `bl2_forms`, `bl2_cultivos`, `bl2_crec`, `bl2_ings`, `bl2_experimentos`, etc.), 10 usan `id` como identificador estable — verificado contra un backup real, no supuesto. Solo `bl2_seg` no tiene `id` (usa `rowId`). Con detección automática, cualquier key nueva que se agregue a futuro (un módulo nuevo, un array nuevo dentro de un módulo existente) queda cubierta sin tocar este código de nuevo — a diferencia de una tabla de config explícita por key, que da más control fino pero deja cualquier key no listada con el comportamiento pobre de hoy hasta que alguien se acuerde de agregarla.

**Detección del campo identificador de un array:**
```
function _bkIdField(arr) {
  if (!arr.length) return null;
  if (arr.every(x => x && typeof x === 'object' && x.id != null)) return 'id';
  if (arr.every(x => x && typeof x === 'object' && x.rowId != null)) return 'rowId'; // bl2_seg
  return null; // no hay id reconocible → no se puede diffear por registro, cae a comparación de bloque
}
```

**Reglas de `_bkDiffValue`:**
- Si `oldVal === newVal` (por `JSON.stringify`) → sin cambios, no genera nada.
- Si ambos son arrays y `_bkIdField` devuelve un campo → diff por ID: agregados (id en `newVal`, no en `oldVal`), eliminados (viceversa), y para los que están en ambos, comparar registro por registro (recursión, `depth+1`).
- Si ambos son objetos planos (no array) → comparar por clave: cada clave que cambió es un "campo modificado"; si el valor de esa clave es a su vez un array-con-id, RECURSIÓN (mismo caso anterior) en vez de tratarlo como un blob opaco — esto es lo que permite bajar de `CI-0022` (registro) a `ingredientes` (array con id) a `ING-0032` (item) a `qty` (campo primitivo), 3 niveles, reproduciendo el caso real de hoy.
- Tope de profundidad: **`depth <= 4`**. Más allá de eso (records con anidamiento inusualmente profundo, ej. `formulaSnapshot` dentro de un `bl2_crec` si en el futuro tuviera arrays-con-id anidados varios niveles adentro) se corta y se muestra "cambió (estructura anidada — revisar el registro completo en la app)" en vez de seguir bajando indefinidamente. No hay ningún caso real hoy que llegue a este límite (el más profundo conocido es el de `CI-0022`, 3 niveles) — el tope es una salvaguarda, no algo calibrado contra un caso real.
- Si no son ni arrays-con-id ni objetos comparables (primitivos, o arrays sin id reconocible, ej. un array de strings) → comparación de bloque: "cambió: `JSON.stringify(oldVal)` → `JSON.stringify(newVal)`", truncado a ~200 caracteres con "…" si es más largo (evita volcar un `formulaSnapshot` entero en la pantalla).

**Agrupación de cambios idénticos (post-proceso, no parte de `_bkDiffValue`):** después de tener la lista de registros modificados de una key con su propio detalle de campos, se agrupan por firma = lista ordenada de `campo:tipoDeCambio` (SIN el valor — "color:agregado" agrupa aunque cada lote tenga un color distinto). Grupos de tamaño 1 se muestran con su detalle completo inline. Grupos de tamaño >1 se muestran como "N registros: <firma legible>" con el detalle por-registro (id → valor viejo → valor nuevo) en un sub-toggle colapsado. Si TODOS los registros del grupo comparten el mismo valor nuevo para ese campo (ej. un flag booleano seteado igual en los N), se muestra ese valor directo en la línea resumen en vez de requerir expandir.

### Render del panel inline

`ghDiffBackupModulos` deja de reemplazar el botón por un `<span>` y en cambio:
1. Cambia el botón a `▼ Cargando...` (estado disabled, igual que hoy).
2. Al resolver, calcula el diff completo con `_bkDiffValue` para cada key cambiada (reusa la lista de keys cambiadas que ya calcula hoy).
3. Inserta una nueva fila `<tr class="gh-bk-diff-row">` inmediatamente después de la fila del backup, con `<td colspan="5">` conteniendo el árbol Módulo → Key → grupos de cambios (usando `_bkKeyToModulo` ya existente para el agrupado por módulo, igual que hoy).
4. El botón pasa a `▼ Ocultar cambios` — tocarlo de nuevo remueve la fila insertada (sin volver a descargar: el resultado queda cacheado en una variable de módulo mientras la lista de backups no se vuelva a cargar).
5. Mismo manejo de error que hoy: si la descarga/decode falla, el botón queda en estado "✕ error, reintentar" (sin insertar fila).

**Caso "sin cambios" y "es el más viejo":** mismo comportamiento que hoy (mensaje en vez de panel), no cambia.

## Testing

Antes de dar por terminada la implementación:
1. Test de `_bkDiffValue` en aislamiento (Node, sin navegador) contra los dos backups reales de hoy ya descargados en la sesión — assertions concretas: debe reportar `su_lotes` como "36 registros: +campo `color`" (grupo, no 36 líneas sueltas), `su_color_seq` y `biolab_migracion_su_color_backfill_v1` como "creado", y `bl2_forms` como 1 registro modificado (`CI-0022`) con el campo `ingredientes` bajando un nivel más y mostrando `ING-0032.qty: 5 → 5000`.
2. Verificación visual en navegador real (servidor local, puerto configurado en `serve.bat`) con el módulo CFG — confirmar que el panel se abre/cierra, que el toggle no vuelve a descargar en el segundo click, y que no rompe el resto del listado (backups sin anterior, backups sin cambios).

## Fuera de alcance

- Selección de dos backups arbitrarios (no adyacentes) para comparar — explícitamente descartado en la sesión de brainstorming.
- Exportar el diff a un archivo aparte.
- Tocar `ghRestore`/`ghLoadLatest` — esta feature es de solo lectura/visualización, no cambia el flujo de restauración.

## Nota sobre el proceso de aprobación

El usuario aprobó este diseño en bloque, sin revisión sección por sección ni lectura del spec escrito, por falta de tiempo ("no tengo tiempo para leer hoy... confío en vos"). Las decisiones de las preguntas 1-4 de arriba sí se confirmaron una por una durante el brainstorming (incluida la elección visual del layout B vía el companion). Lo que se saltea es específicamente la instancia de "revisar el spec ya escrito" — el usuario puede pedir cambios después si algo no le cierra al verlo funcionar.
