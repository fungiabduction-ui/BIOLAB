# Eliminación completa del módulo TRACE

**Fecha:** 2026-09-04
**Estado:** Aprobado

## Contexto

El módulo TRACE (`🔗 TR — Trazabilidad`) fue uno de los primeros módulos de la app —
vista de solo lectura de la cadena GE → CI → GR → SU → FR. El usuario nunca lo usa y
pidió eliminarlo por completo, sin dejar rastros ni deuda técnica (código muerto,
registros huérfanos, documentación desactualizada).

## Auditoría de acoplamiento (previa a este spec)

Grep global de `TRACE`/`trace` en todo el repo confirmó que el módulo está casi
totalmente autocontenido:

- **Escribe:** nada. `trace_app.js` es 100% solo-lectura de `biolab.ge.v4`,
  `bl2_cultivos`, `bl2_forms`, `gr_lotes`, `gr_usados`, `su_lotes`, `fr_bolsas`,
  `bl2_ci_gr_links` — cero `localStorage.setItem/removeItem`. No hay ninguna key de
  storage que migrar o limpiar.
- **Único acoplamiento cross-módulo real:** `fr/fr_app.js:1975-1977` llama a
  `window.traceEnhanceFrIdTree()` detrás de un `typeof` guard (Regla 5). Es la única
  función que TRACE expone hacia otro módulo — hace clickeable el árbol de identidad
  de FR (`#frIdTree`) para saltar a TRACE con un anchor.
- **`window._frPendingSelect`** es un canal de handoff compartido entre TRACE→FR y
  SU→FR (confirmado en `su_app.js:3952-3963` y `fr_app.js:6221-6223`) — SU lo usa
  independientemente de TRACE, así que no se toca.
- **`main.js`** tiene cero menciones a TRACE — el loader es genérico vía
  `data-module`/`BIOLAB.modules`, consistente con la Regla 6 (registrar módulos desde
  `index.html`, nunca desde `main.js`).
- **`main.css`** no tiene selectores `nth-child` ni layout dependiente de la cantidad
  de tabs en `#main-nav`.
- **`CHANGELOG.md`** tiene 2 menciones a TRACE, ambas narrativa histórica de sesiones
  de auditoría pasadas (no describen estado actual) — no se tocan, el changelog es
  append-only.

Con esto, borrado completo es más seguro y simple que ocultar el botón: ocultar
dejaría los 3 archivos, el registro en `BIOLAB.modules`, y la llamada guardada en FR
— exactamente la deuda que se quiere evitar.

## Cambios

### 1. Borrar `trace/` completa
`trace/trace_app.js`, `trace/trace_styles.css`, `trace/trace_index.html` — carpeta
entera, sin dejar ningún archivo.

### 2. `index.html`
- Quitar el `<button data-module="TRACE" onclick="loadModule('TRACE')" ...>` del nav
  (bloque ~líneas 100-106).
- Quitar el bloque `<script>` que registra
  `window.BIOLAB.modules.TRACE = 'trace/trace_index.html'` (~líneas 215-222,
  incluyendo el comentario `<!-- Registro del módulo TRACE en el motor SPA -->`).

### 3. `fr/fr_app.js`
Quitar las líneas 1975-1977:
```js
if (typeof window.traceEnhanceFrIdTree === 'function') {
    try { window.traceEnhanceFrIdTree(); } catch (e) {}
}
```
`renderIdTree(b)` (línea 1974, justo arriba) no se toca — el árbol de identidad de FR
sigue renderizando igual, solo deja de tener la mejora de "click para ver en TRACE".

### 4. `BIOLAB_SYSTEM.md`
9 ocurrencias de TRACE, tratamiento diferenciado:
- **Borrar por completo:** sección `### TRACE — Trazabilidad completa` (línea
  317-326, incluye el separador `---` que la cierra).
- **Editar (sacar solo la parte de TRACE, dejar el resto de la línea/fila intacta):**
  - Línea 30: sacar `TRACE observa toda la cadena en solo lectura.` del diagrama de
    pipeline en bloque de código.
  - Línea 442: fila de `gr_usados` — sacar "y TRACE" de "leído también por FR y
    TRACE".
  - Línea 461: sacar la línea `window.BIOLAB.modules.TRACE = 'trace/trace_index.html';   // desde index.html`
    del bloque de código del mapa de módulos.
  - Línea 498: sacar la fila `| \`window._tracePendingAnchor\` | navegar a TRACE con
    contexto |` de la tabla de canales de comunicación entre módulos.
  - Línea 499: en la fila de `window._frPendingSelect`, cambiar "handoff SU/TRACE →
    FR" por "handoff SU → FR" (el canal sigue existiendo, ya no lo usa TRACE).
  - Línea 531: columna de tabla "Display en FR/TRACE" → "Display en FR".
  - Línea 553: sacar el ítem `10. TRACE es solo lectura. Nunca escribe en
    localStorage.` de la lista "REGLAS QUE NUNCA SE VIOLAN" (queda con 9 ítems, sin
    renumerar los anteriores).
- **No tocar:** línea 643 (footer de auditoría histórica del 2026-07-10) y las 2
  menciones en `CHANGELOG.md` — son registro histórico de sesiones pasadas, no
  estado actual del sistema.

### 5. `biolab-app/CLAUDE.md`
El archivo tiene el diagrama de pipeline y la lista "REGLAS QUE NUNCA SE VIOLAN"
duplicados dos veces (sección corta al inicio del archivo + sección larga más abajo
con el mismo contenido). En ambas apariciones:
- Sacar `TRACE: solo lectura de toda la cadena.` del diagrama de pipeline en bloque
  de código.
- Sacar el ítem `10. TRACE es solo lectura. Nunca escribe en localStorage.` de la
  lista "REGLAS QUE NUNCA SE VIOLAN" (queda con 9 ítems, sin renumerar).

No se toca `C:\Users\JET\Desktop\MOBY DICK\CLAUDE.md` (carpeta padre) — documentado
en el propio `biolab-app/CLAUDE.md` como archivo viejo/no sincronizado desde
2026-07-10.

## Fuera de alcance

- `main.js`, `main.css`: confirmado sin cambios necesarios.
- Cualquier key de `localStorage`: TRACE nunca escribió nada, no hay migración.
- `window._frPendingSelect`: canal compartido con SU, se preserva intacto.
- `CHANGELOG.md`: registro histórico, no se edita.
- Staleness preexistente de `BIOLAB_SYSTEM.md` no relacionada a TRACE (ej. la
  sección CFG menciona funciones de export ya eliminadas según `CLAUDE.md`) — no es
  parte de este trabajo.

## Verificación

1. Levantar el servidor local (`serve.bat`, puerto 8734).
2. Confirmar visualmente que el nav ya no muestra el tab "🔗 TR — Trazabilidad".
3. Navegar por los 7 módulos restantes (GE, CI, CILAB, GR, SU, FR, CFG) sin errores
   de consola.
4. Abrir una bolsa en FR y confirmar que el árbol de identidad (`frIdTree`) sigue
   renderizando correctamente (sin la mejora de clickeo, que es la que se elimina).
5. Grep final de `TRACE`/`trace` en todo el repo (excluyendo `CHANGELOG.md` y specs
   viejos) para confirmar cero restos.
