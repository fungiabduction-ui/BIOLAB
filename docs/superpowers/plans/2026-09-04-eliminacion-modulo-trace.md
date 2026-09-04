# Eliminación completa del módulo TRACE — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar el módulo TRACE (`🔗 TR — Trazabilidad`) de la app biolab por completo — código, registro en el loader, la única llamada cross-módulo que lo alimenta, y toda mención en la documentación técnica (`BIOLAB_SYSTEM.md`, `CLAUDE.md`) — sin dejar código muerto ni referencias rotas.

**Architecture:** No hay lógica nueva que escribir — es una eliminación quirúrgica guiada por el spec `docs/superpowers/specs/2026-09-04-eliminacion-modulo-trace-design.md`. TRACE es un módulo 100% solo-lectura (nunca escribió en `localStorage`), así que no hay migración de datos. El único acoplamiento real es una llamada guardada con `typeof` en `fr_app.js`. No existe suite de tests automatizados en este repo (vanilla JS + `localStorage`) — la verificación es: grep de cero-restos + chequeo manual en navegador real vía `serve.bat`.

**Tech Stack:** Vanilla JS (IIFE por módulo), HTML, CSS, `localStorage`. Sin build step, sin test runner.

---

### Task 1: Borrar la carpeta `trace/`

**Files:**
- Delete: `trace/trace_app.js`
- Delete: `trace/trace_styles.css`
- Delete: `trace/trace_index.html`

- [ ] **Step 1: Confirmar que no hay cambios sin commitear en `trace/` antes de borrar**

Run: `git status --short trace/`
Expected: sin salida (carpeta limpia, nada que se pierda). Si hay salida, detenerse y avisar al usuario antes de continuar — podría haber trabajo sin guardar.

- [ ] **Step 2: Borrar la carpeta completa**

Run: `git rm -r trace/`
Expected: lista los 3 archivos como eliminados (`rm 'trace/trace_app.js'`, etc.)

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: elimina el módulo TRACE (código)

Módulo de trazabilidad sin uso real, solo-lectura, sin escrituras en
localStorage que migrar. Ver spec en
docs/superpowers/specs/2026-09-04-eliminacion-modulo-trace-design.md.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Quitar el registro y el botón de TRACE en `index.html`

**Files:**
- Modify: `index.html:100-106` (botón del nav)
- Modify: `index.html:215-222` (registro del módulo)

- [ ] **Step 1: Quitar el botón del nav**

Old (`index.html:100-107`, incluye la línea en blanco antes del siguiente botón):
```html
    <button
      class="tab"
      data-module="TRACE"
      onclick="loadModule('TRACE')"
      title="Módulo de Trazabilidad — cadena completa GE → CI → GR → SU → FR">
      🔗 TR &mdash; Trazabilidad
    </button>

```
New: (bloque eliminado — nada en su lugar, el botón de CFG queda inmediatamente después del de FR)

- [ ] **Step 2: Quitar el bloque de registro del módulo**

Old (`index.html:215-223`, incluye la línea en blanco antes del siguiente `<script>`):
```html
  <!-- Registro del módulo TRACE en el motor SPA -->
  <script>
    (function () {
      if (window.BIOLAB && window.BIOLAB.modules) {
        window.BIOLAB.modules.TRACE = 'trace/trace_index.html';
      }
    })();
  </script>

```
New: (bloque eliminado — el comentario "Registro del módulo CILAB" queda inmediatamente después del bloque de migración `sustratos_lotes → gr_lotes`)

- [ ] **Step 3: Verificar que no queden restos de TRACE en `index.html`**

Run: `grep -in trace index.html`
Expected: sin salida (ningún match)

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
feat: quita el tab y el registro de TRACE de index.html

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Quitar la llamada guardada a `traceEnhanceFrIdTree` en `fr_app.js`

**Files:**
- Modify: `fr/fr_app.js:1973-1978`

- [ ] **Step 1: Quitar el bloque, dejando intacto `renderIdTree(b)`**

Old (`fr/fr_app.js:1973-1978`):
```js
        // 🧬 Identidad — árbol ASCII (línea genética + traza productiva)
        renderIdTree(b);
        if (typeof window.traceEnhanceFrIdTree === 'function') {
            try { window.traceEnhanceFrIdTree(); } catch (e) {}
        }

```
New:
```js
        // 🧬 Identidad — árbol ASCII (línea genética + traza productiva)
        renderIdTree(b);

```

- [ ] **Step 2: Verificar que no queden restos de TRACE en `fr_app.js`**

Run: `grep -in trace fr/fr_app.js`
Expected: sin salida (ningún match)

- [ ] **Step 3: Commit**

```bash
git add fr/fr_app.js
git commit -m "$(cat <<'EOF'
feat: quita la llamada guardada a TRACE en fr_app.js

Única dependencia cross-módulo real hacia TRACE — hacía clickeable el
árbol de identidad de FR para saltar al módulo. El árbol sigue
renderizando igual sin esta mejora.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Actualizar `BIOLAB_SYSTEM.md`

**Files:**
- Modify: `BIOLAB_SYSTEM.md` (9 ocurrencias, ver detalle abajo — 2 se dejan intactas)

- [ ] **Step 1: Sacar la línea de TRACE del diagrama de pipeline**

Old (`BIOLAB_SYSTEM.md:25-31`):
```
│    │    │       └──────────── Grano: spawn inoculado, frascos por tanda
│    │    └────────────────────  Lab analítico: conocimiento metabólico, grafo SVG, ensayos
│    └───────────────────────── Cultivo In Vitro: placas/líquidos con cepa viva
└────────────────────────────── Genética: árbol taxonómico (fuente de verdad)

TRACE observa toda la cadena en solo lectura.
```
```
New (`BIOLAB_SYSTEM.md:25-30`):
```
│    │    │       └──────────── Grano: spawn inoculado, frascos por tanda
│    │    └────────────────────  Lab analítico: conocimiento metabólico, grafo SVG, ensayos
│    └───────────────────────── Cultivo In Vitro: placas/líquidos con cepa viva
└────────────────────────────── Genética: árbol taxonómico (fuente de verdad)
```
```

- [ ] **Step 2: Borrar la sección `### TRACE — Trazabilidad completa` entera**

Old (`BIOLAB_SYSTEM.md:315-328`):
```markdown
---

### TRACE — Trazabilidad completa

**Propósito:** vista solo lectura de la cadena completa GE → CI → GR → SU → FR. Lee directamente de localStorage sin pasar por APIs de módulos.

**No escribe nada — confirmado por grep, cero matches de `localStorage.setItem/removeItem` en `trace_app.js`.** Lee: `biolab.ge.v4`, `bl2_cultivos`, `gr_lotes`, `su_lotes`, `fr_bolsas`, `bl2_ci_gr_links`, más `bl2_forms` y `gr_usados` (no documentados antes).

**Anchor:** `window._tracePendingAnchor = { tipo, id }` antes de `loadModule('TRACE')`. Confirmado: `traceInit()` lo consume y lo limpia (`= null`) inmediatamente, antes de usarlo — no hay riesgo de "anchor viejo" reutilizado en una visita posterior sin anchor. El productor de referencia es `window.traceEnhanceFrIdTree()` (llamado desde FR, guardado con `typeof` guard).

**"FR Trace ★" — subsistema grande no mencionado en el resumen de este doc antes:** ~700 líneas, vistas ASCII + SVG del árbol de una bolsa FR, con sus propios handlers `window.frtSelect/frtSetView/frtSearchChange/frtFilterStatus`.

---

### CFG — Configuración
```
New:
```markdown
---

### CFG — Configuración
```

- [ ] **Step 3: Sacar "y TRACE" de la fila de `gr_usados`**

Old (`BIOLAB_SYSTEM.md`, tabla de keys de localStorage):
```
| `gr_usados` | GR | Consumo agregado, leído también por FR y TRACE (no documentado antes) |
```
New:
```
| `gr_usados` | GR | Consumo agregado, leído también por FR (no documentado antes) |
```

- [ ] **Step 4: Sacar la línea de registro de TRACE del bloque de código del mapa de módulos**

Old (`BIOLAB_SYSTEM.md`, sección "Mapa de módulos"):
```javascript
BIOLAB.modules = { GE, CI, GR, SU, FR, CFG }  // en main.js — GE sigue acá por herencia histórica,
                                                // aunque la convención actual es registrar todo desde index.html
window.BIOLAB.modules.TRACE = 'trace/trace_index.html';   // desde index.html
window.BIOLAB.modules.CILAB = 'cilab/cilab_index.html';   // desde index.html
```
New:
```javascript
BIOLAB.modules = { GE, CI, GR, SU, FR, CFG }  // en main.js — GE sigue acá por herencia histórica,
                                                // aunque la convención actual es registrar todo desde index.html
window.BIOLAB.modules.CILAB = 'cilab/cilab_index.html';   // desde index.html
```

- [ ] **Step 5: Sacar la fila de `_tracePendingAnchor` y actualizar la de `_frPendingSelect`**

Old (`BIOLAB_SYSTEM.md`, tabla "Comunicación entre módulos"):
```
| Bus de eventos (`emitEvent`/`onEvent`) | notificaciones desacopladas |
| Llamada directa con `typeof` guard | acciones puntuales cross-módulo |
| `window._tracePendingAnchor` | navegar a TRACE con contexto |
| `window._frPendingSelect` | handoff SU/TRACE → FR (consumido y limpiado por FR, confirmado sin bug) |
| Storage event (cross-tab) | sync entre pestañas |
```
New:
```
| Bus de eventos (`emitEvent`/`onEvent`) | notificaciones desacopladas |
| Llamada directa con `typeof` guard | acciones puntuales cross-módulo |
| `window._frPendingSelect` | handoff SU → FR (consumido y limpiado por FR, confirmado sin bug) |
| Storage event (cross-tab) | sync entre pestañas |
```

- [ ] **Step 6: Actualizar el encabezado de la tabla de escenarios de genética en FR**

Old (`BIOLAB_SYSTEM.md`, tabla "Escenarios de genética en FR"):
```
| inoculoSource | geneticaFull | Causa | Display en FR/TRACE |
```
New:
```
| inoculoSource | geneticaFull | Causa | Display en FR |
```

- [ ] **Step 7: Sacar la Regla 10 de "REGLAS QUE NUNCA SE VIOLAN"**

Old (`BIOLAB_SYSTEM.md`, sección 8):
```
9. FR: bolsas selladas (`pendienteConfirmacion: false`) no se tocan en sync — salvo la excepción intencional documentada (`sincronizarTrazabilidadBolsa`).
10. TRACE es solo lectura. Nunca escribe en localStorage.

**Ver sección 11 — varias de estas reglas están violadas HOY en código real, no solo en teoría.**
```
New:
```
9. FR: bolsas selladas (`pendienteConfirmacion: false`) no se tocan en sync — salvo la excepción intencional documentada (`sincronizarTrazabilidadBolsa`).

**Ver sección 11 — varias de estas reglas están violadas HOY en código real, no solo en teoría.**
```

- [ ] **Step 8: Verificar qué queda de TRACE en el archivo**

Run: `grep -in trace BIOLAB_SYSTEM.md`
Expected: exactamente 1 match — la línea del footer de auditoría histórica (`*Última actualización: 10 de julio de 2026 — auditoría completa (5 agentes en paralelo sobre GE/GR/SU/FR/TRACE+shared+loader...`). Esa línea es narrativa de sesión pasada, no se toca (ver spec, sección "Fuera de alcance"). Si aparece cualquier otro match, revisar — no debería quedar ninguno más.

- [ ] **Step 9: Commit**

```bash
git add BIOLAB_SYSTEM.md
git commit -m "$(cat <<'EOF'
docs: actualiza BIOLAB_SYSTEM.md tras eliminar TRACE

Borra la sección propia de TRACE y las 6 menciones dispersas
(diagrama de pipeline, mapa de módulos, canales de comunicación,
tabla de escenarios de genética FR, Regla 10). Deja intacta la
mención en el footer de auditoría histórica — es narrativa de una
sesión pasada, no estado actual.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Actualizar `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md` (pipeline diagram, Regla 10, nota histórica sobre `frtEstado`)

**Nota de corrección sobre el spec:** el spec (`docs/superpowers/specs/2026-09-04-eliminacion-modulo-trace-design.md`) decía que el diagrama de pipeline y la Regla 10 aparecían 2 veces en este archivo. Al releer el archivo completo para este plan se confirmó que aparecen **una sola vez cada uno** — la aparente duplicación era en realidad el archivo `CLAUDE.md` de la carpeta padre `MOBY DICK` (que no se toca), no una segunda copia dentro de `biolab-app/CLAUDE.md`. Este plan corrige eso: cada edit de este task se aplica una sola vez.

- [ ] **Step 1: Sacar la línea de TRACE del diagrama de pipeline**

Old (`CLAUDE.md:173-186`):
```
## PIPELINE BIOLÓGICO

```
GE → CI → CILAB → GR → SU → FR
│    │    │       │    │    │
│    │    │       │    │    └── Fructificación: bolsa individual, cosechas, BE
│    │    │       │    └─────── Sustrato: formulación, hidratación, distribución en bolsas
│    │    │       └──────────── Grano: spawn inoculado, frascos por tanda
│    │    └────────────────────  Lab analítico: conocimiento metabólico, motor OLS, FI Engine, wizard
│    └───────────────────────── Cultivo In Vitro: placas/líquidos con cepa viva
└────────────────────────────── Genética: árbol taxonómico (fuente de verdad)

TRACE: solo lectura de toda la cadena.
```
```
New (`CLAUDE.md:173-185`):
```
## PIPELINE BIOLÓGICO

```
GE → CI → CILAB → GR → SU → FR
│    │    │       │    │    │
│    │    │       │    │    └── Fructificación: bolsa individual, cosechas, BE
│    │    │       │    └─────── Sustrato: formulación, hidratación, distribución en bolsas
│    │    │       └──────────── Grano: spawn inoculado, frascos por tanda
│    │    └────────────────────  Lab analítico: conocimiento metabólico, motor OLS, FI Engine, wizard
│    └───────────────────────── Cultivo In Vitro: placas/líquidos con cepa viva
└────────────────────────────── Genética: árbol taxonómico (fuente de verdad)
```
```

- [ ] **Step 2: Sacar la Regla 10 de "REGLAS QUE NUNCA SE VIOLAN"**

Old (`CLAUDE.md:201-204`):
```
8. Siempre hacer backup antes de cambios en estructura de datos de localStorage.
9. FR: bolsas selladas (`pendienteConfirmacion: false`) no se tocan en sync. Sus `grSources` son permanentes.
10. TRACE es solo lectura. Nunca escribe en localStorage.
11. **Toda decisión arquitectónica importante sobre el motor (OLS, FI Engine, Conocimiento) se documenta en este archivo.** Si en una sesión se descubre un bug estructural, se diseña un fix no trivial, o se establece un invariante nuevo — se agrega acá antes de cerrar la sesión. Este archivo es la memoria técnica del proyecto.
```
New:
```
8. Siempre hacer backup antes de cambios en estructura de datos de localStorage.
9. FR: bolsas selladas (`pendienteConfirmacion: false`) no se tocan en sync. Sus `grSources` son permanentes.
10. **Toda decisión arquitectónica importante sobre el motor (OLS, FI Engine, Conocimiento) se documenta en este archivo.** Si en una sesión se descubre un bug estructural, se diseña un fix no trivial, o se establece un invariante nuevo — se agrega acá antes de cerrar la sesión. Este archivo es la memoria técnica del proyecto.
```

**Por qué renumerar acá y no en `BIOLAB_SYSTEM.md`:** en `CLAUDE.md` la regla 11 es una regla activa y citada por número en otras partes del propio archivo (ninguna referencia cruzada real encontrada por grep, pero es la lista canónica de reglas "que nunca se violan" — mantenerla sin huecos es más correcto que dejar un `10.` faltante). En `BIOLAB_SYSTEM.md` la lista no tiene una regla 11 adicional después, así que ahí alcanza con sacar el ítem sin renumerar (ya definido así en el spec).

- [ ] **Step 3: Corregir la nota histórica sobre `frtEstado` — ya no hay 3 copias del clasificador, hay 2**

Old (`CLAUDE.md:154-159`):
```
  1. `trace/trace_app.js` (TRACE, solo lectura de toda la cadena) tiene su PROPIA tercera copia
     independiente del clasificador de estado de FR (`frtEstado`/`frtEstadoClass`, paralela a
     `computeEstado`/`_frIdentEstado` en `fr_app.js`) y no se había actualizado — una bolsa
     archivada como `noFructifico` se mostraba en TRACE como `colonizando`/`colonizado`. Si se
     agrega un estado terminal nuevo en el futuro, recordar que hay 3 copias de este clasificador
     en el repo (`computeEstado`, `_frIdentEstado`, y `frtEstado` en TRACE), no 2.
```
New:
```
  1. `trace/trace_app.js` (módulo TRACE, eliminado el 2026-09-04 — ver
     `docs/superpowers/specs/2026-09-04-eliminacion-modulo-trace-design.md`) tenía su PROPIA
     tercera copia independiente del clasificador de estado de FR (`frtEstado`/`frtEstadoClass`,
     paralela a `computeEstado`/`_frIdentEstado` en `fr_app.js`) y no se había actualizado — una
     bolsa archivada como `noFructifico` se mostraba en TRACE como `colonizando`/`colonizado`.
     Con TRACE eliminado, quedan 2 copias del clasificador en el repo (`computeEstado`,
     `_frIdentEstado`) — si se agrega un estado terminal nuevo en el futuro, actualizar ambas.
```

- [ ] **Step 4: Verificar qué queda de TRACE en el archivo**

Run: `grep -in trace CLAUDE.md`
Expected: 2 matches — la línea 57 (narrativa de la auditoría 2026-07-10, "5 agentes en paralelo sobre GE/GR/SU/FR/TRACE+shared+loader") y la primera línea del bloque corregido en el Step 3 ("módulo TRACE, eliminado el 2026-09-04"). Ambas son históricas/informativas, no referencias activas — correcto dejarlas así. Si aparece cualquier otro match (ej. en la Regla 10 o el diagrama de pipeline), el step correspondiente no se aplicó bien — revisar.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: actualiza CLAUDE.md tras eliminar TRACE

Saca la línea de TRACE del diagrama de pipeline y la Regla 10 de
"REGLAS QUE NUNCA SE VIOLAN" (renumerada, la 11 pasa a ser la 10).
Corrige la nota histórica sobre frtEstado: ya no hay 3 copias del
clasificador de estado de FR, quedan 2.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Verificación final end-to-end

**Files:** ninguno (solo lectura/verificación)

- [ ] **Step 1: Grep global de restos, repo completo**

Run: `grep -rin "trace" --include="*.js" --include="*.html" --include="*.css" . | grep -v "^\./CHANGELOG.md" | grep -v "docs/superpowers/specs/" | grep -v "docs/superpowers/plans/"`

Expected: sin salida. Si aparece algo, es un resto no contemplado en este plan — no continuar, reportar el match antes de dar la tarea por terminada.

- [ ] **Step 2: Levantar el servidor local**

Run: `./serve.bat` (o el comando que use ese `.bat`, revisar contenido si no está en PATH — puerto 8734 documentado en `CLAUDE.md`)
Expected: servidor arriba en `http://localhost:8734`, sin errores en la terminal.

- [ ] **Step 3: Chequeo manual en navegador — nav**

Abrir `http://localhost:8734` en el navegador. Confirmar visualmente que la barra de navegación tiene 7 botones (GE, CI, CILAB, GR, SU, FR, CFG) y NO tiene el tab "🔗 TR — Trazabilidad". Abrir la consola del navegador (F12) y confirmar que no hay errores al cargar la página inicial.

- [ ] **Step 4: Chequeo manual en navegador — navegación entre módulos**

Hacer click en cada uno de los 7 tabs restantes en orden (GE → CI → CILAB → GR → SU → FR → CFG). Confirmar en la consola que no aparece ningún error tipo `traceEnhanceFrIdTree is not defined` ni ningún otro error relacionado a `TRACE`/`BIOLAB.modules.TRACE`.

- [ ] **Step 5: Chequeo manual en navegador — árbol de identidad de FR**

Dentro del módulo FR, abrir el Dashboard y seleccionar cualquier bolsa existente (o una del Archivo si no hay activas). Confirmar que la sección "🧬 Identidad" (árbol ASCII con líneas `├──`/`└──`) sigue renderizando el árbol genético/productivo de la bolsa con normalidad — sin la mejora de "click para ver en TRACE" (que ya no debe estar), pero con el árbol visible y con datos correctos.

- [ ] **Step 6: Reportar resultado**

Si los 5 checks anteriores pasan: la eliminación quedó verificada end-to-end, no hace falta ningún commit adicional (este task es de verificación pura, no toca archivos). Si algo falla, diagnosticar contra la Task correspondiente (1-5) antes de dar el plan por completo.
