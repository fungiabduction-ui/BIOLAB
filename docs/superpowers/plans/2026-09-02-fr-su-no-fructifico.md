# FR/SU — Estado "No fructificó" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar un estado terminal nuevo y propio en FR (`noFructifico`) para bolsas que nunca
dieron cosecha, y corregir el aviso de SU ("Sin registro FR...") para que deje de mostrarse
cuando la bolsa ya fue resuelta en FR, ofreciendo en su lugar la acción de archivarla como
"no fructificó" directamente desde SU.

**Architecture:** Dos campos nuevos y aditivos en `fr_bolsas[]` (`noFructifico`,
`fechaNoFructifico`, más `noFructificoRevisadoEn` para el snooze del aviso) tratados como un
tercer estado terminal, hermano de `contaminada`/`cicloCerrado` — mismas funciones de
clasificación (`computeEstado`, `esArchivada`), mismo patrón de botón reversible en el panel de
FR. SU escribe directo a `localStorage['fr_bolsas']` sin depender de que el módulo FR esté
montado, reusando el patrón ya existente de `_suPropagarRenameFR` (leer, mutar por `_frUuid`,
guardar, `dispatchEvent('su-lote-guardado')`, try/catch + `BioLog` + alert si falla).

**Tech Stack:** Vanilla JS (IIFE por módulo), localStorage, sin framework ni build step. Sin
test runner en el repo — verificación de sintaxis vía `node --check` y verificación funcional
manual en navegador real (Chrome, servidor local puerto 8734) vía herramientas chrome-devtools.

Spec de referencia: `docs/superpowers/specs/2026-09-02-fr-su-no-fructifico-design.md`

---

## Task 1: FR — clasificación de estado (`computeEstado`, `esArchivada`, identidad) ✅ DONE (cd3a440)

**Files:**
- Modify: `fr/fr_app.js:272-312` (computeEstado, esArchivada)
- Modify: `fr/fr_app.js:2163-2183` (_frIdentEstado, _frIdentEstadoClass)

- [ ] **Step 1: Agregar la rama `noFructifico` a `computeEstado`**

En `fr/fr_app.js`, dentro de `computeEstado`:

```javascript
    function computeEstado(b) {
        if (!b) return 'colonizando';
        // Estados de ciclo de vida pre-activo
        if (esPendiente(b)) return 'pendiente';
        if (b.cancelada === true) return 'cancelada';
        if (b.contaminada === true) return 'contaminada';
        // cicloCerrado se evalúa ANTES de flushes: una bolsa cerrada con flushes
        // debe mostrar 'ciclo cerrado', no 'cosechado'.
        if (b.cicloCerrado === true) return 'ciclo cerrado';
        // noFructifico: estado terminal propio para bolsas con 0 cosechas — distinto de
        // cicloCerrado (que sella el ÚLTIMO flush de una bolsa que sí produjo).
        if (b.noFructifico === true) return 'no fructifico';
        if (Array.isArray(b.flushes) && b.flushes.length > 0) return 'cosechado';
        if (b.fechaCosecha) return 'cosechado';
        if (b.fechaPines) return 'pinning';
        if (b.fechaColonizacion) return 'colonizado';
        return 'colonizando';
    }
```

- [ ] **Step 2: Agregar `noFructifico` a `esArchivada`**

```javascript
    function esArchivada(b) {
        if (!b) return false;
        // pendientes NO van al archivo — tienen su propia sección
        if (esPendiente(b)) return false;
        return b.cancelada === true || b.contaminada === true || b.cicloCerrado === true || b.noFructifico === true;
    }
```

- [ ] **Step 3: Agregar `noFructifico` a `_frIdentEstado`/`_frIdentEstadoClass`**

```javascript
    /** Estado legible de una bolsa FR. */
    function _frIdentEstado(b) {
        if (!b) return 'sin datos';
        if (esPendiente(b)) return 'pendiente';
        if (b.cancelada)             return 'cancelada';
        if (b.contaminada)           return 'contaminada';
        if (b.cicloCerrado)          return 'ciclo cerrado';
        if (b.noFructifico)          return 'no fructifico';
        if (Array.isArray(b.flushes) && b.flushes.length > 0) return 'cosechado';
        if (b.fechaCosecha)          return 'cosechado';
        if (b.fechaPines)            return 'pinning';
        if (b.fechaColonizacion)     return 'colonizado';
        return 'colonizando';
    }
    function _frIdentEstadoClass(estado) {
        var map = {
            'cosechado':    'ok',  'colonizado':  'col',
            'pinning':      'pin', 'colonizando': 'act',
            'contaminada':  'err', 'cancelada':   'err',
            'ciclo cerrado':'arc', 'no fructifico':'arc', 'pendiente':   'pend'
        };
        return 'frt-badge-' + (map[estado] || 'act');
    }
```

- [ ] **Step 4: Verificar sintaxis**

Run: `node --check fr/fr_app.js`
Expected: sin salida (exit 0)

- [ ] **Step 5: Commit**

```bash
git add fr/fr_app.js
git commit -m "$(cat <<'EOF'
feat(fr): agrega estado terminal noFructifico a la clasificacion de bolsas

Nuevo estado hermano de contaminada/cicloCerrado, para bolsas que nunca
dieron cosecha. computeEstado/esArchivada/_frIdentEstado lo reconocen.
EOF
)"
```

---

## Task 2: FR — chips visuales en los 4 sitios de render + fecha de archivo ✅ DONE (3ef252c)

**Files:**
- Modify: `fr/fr_app.js:1293` (fecha de archivo en la fila)
- Modify: `fr/fr_app.js:1296-1307` (chip de `filaTabla`)
- Modify: `fr/fr_app.js:2696-2708` (chip de Vista General)
- Modify: `fr/fr_app.js:1954-1967` (chip del header del dashboard)
- Modify: `fr/fr_app.js:3491-3503` (chip del refresco parcial en `updateField`)

- [ ] **Step 1: Fecha de archivo mostrada en la fila**

```javascript
        var archStr = b.fechaCierreCiclo || b.fechaCancelacion || b.fechaNoFructifico;
```

(reemplaza `var archStr = b.fechaCierreCiclo || b.fechaCancelacion;`)

- [ ] **Step 2: Chip de `filaTabla`**

```javascript
        // Mapping de estados internos → etiquetas de display en chip.
        // Estado interno 'ciclo cerrado' → label visible 'FIN DEL CICLO'.
        var _ESTADO_LABELS = { 'ciclo cerrado': 'FIN DEL CICLO', 'no fructifico': 'NO FRUCTIFICÓ' };
        var estadoLabel = _ESTADO_LABELS[estado] || estado;

        var chipClass = 'fr-chip-neutral';
        if (estado === 'colonizando') chipClass = 'fr-chip-warn';
        else if (estado === 'colonizado') chipClass = 'fr-chip-ok';
        else if (estado === 'pinning') chipClass = 'fr-chip-warn';
        else if (estado === 'cosechado') chipClass = 'fr-chip-ok';
        else if (estado === 'contaminada') chipClass = 'fr-chip-bad';
        else if (estado === 'cancelada') chipClass = 'fr-chip-cancelada';
        else if (estado === 'ciclo cerrado') chipClass = 'fr-chip-fin-ciclo';
        else if (estado === 'no fructifico') chipClass = 'fr-chip-no-fructifico';
```

- [ ] **Step 3: Chip de Vista General (`_ovChipClass`/`_OV_LABELS`)**

```javascript
    var _OV_LABELS = { 'ciclo cerrado': 'FIN DEL CICLO', 'no fructifico': 'NO FRUCTIFICÓ' };

    function _ovChipClass(estado) {
        if (estado === 'colonizando')   return 'fr-chip-warn';
        if (estado === 'colonizado')    return 'fr-chip-ok';
        if (estado === 'pinning')       return 'fr-chip-warn';
        if (estado === 'cosechado')     return 'fr-chip-ok';
        if (estado === 'contaminada')   return 'fr-chip-bad';
        if (estado === 'cancelada')     return 'fr-chip-cancelada';
        if (estado === 'ciclo cerrado') return 'fr-chip-fin-ciclo';
        if (estado === 'no fructifico') return 'fr-chip-no-fructifico';
        if (estado === 'pendiente')     return 'fr-chip-pendiente';
        return 'fr-chip-neutral';
    }
```

- [ ] **Step 4: Chip del header del dashboard**

```javascript
        var estado = computeEstado(b);
        var _DASH_ESTADO_LABELS = { 'ciclo cerrado': 'FIN DEL CICLO', 'no fructifico': 'NO FRUCTIFICÓ' };
        var stEl = document.getElementById('frDashState');
        if (stEl) {
            stEl.textContent = _DASH_ESTADO_LABELS[estado] || estado;
            stEl.className = 'fr-chip ' +
                (estado === 'colonizando'  ? 'fr-chip-warn' :
                 estado === 'colonizado'   ? 'fr-chip-ok' :
                 estado === 'pinning'      ? 'fr-chip-warn' :
                 estado === 'cosechado'    ? 'fr-chip-ok' :
                 estado === 'ciclo cerrado'? 'fr-chip-fin-ciclo' :
                 estado === 'no fructifico'? 'fr-chip-no-fructifico' :
                 estado === 'contaminada'  ? 'fr-chip-bad' :
                 'fr-chip-neutral');
        }
```

- [ ] **Step 5: Chip del refresco parcial en `updateField`**

```javascript
        // Actualizar chip de estado por si cambió
        var _UF_ESTADO_LABELS = { 'ciclo cerrado': 'FIN DEL CICLO', 'no fructifico': 'NO FRUCTIFICÓ' };
        var stEl = document.getElementById('frDashState');
        if (stEl) {
            stEl.textContent = _UF_ESTADO_LABELS[b.estado] || b.estado;
            stEl.className = 'fr-chip ' +
                (b.estado === 'colonizando'   ? 'fr-chip-warn' :
                 b.estado === 'colonizado'    ? 'fr-chip-ok' :
                 b.estado === 'pinning'       ? 'fr-chip-warn' :
                 b.estado === 'cosechado'     ? 'fr-chip-ok' :
                 b.estado === 'ciclo cerrado' ? 'fr-chip-fin-ciclo' :
                 b.estado === 'no fructifico' ? 'fr-chip-no-fructifico' :
                 b.estado === 'contaminada'   ? 'fr-chip-bad' :
                 'fr-chip-neutral');
        }
```

- [ ] **Step 6: Verificar sintaxis**

Run: `node --check fr/fr_app.js`
Expected: sin salida (exit 0)

- [ ] **Step 7: Commit**

```bash
git add fr/fr_app.js
git commit -m "$(cat <<'EOF'
feat(fr): chip NO FRUCTIFICO en los 4 renders de estado + fecha de archivo

Los 4 sitios duplicados donde FR pinta chip-class + label a partir del
estado (fila de tabla, vista general, header de dashboard, refresco
parcial de updateField) reconocen el estado nuevo. archStr de la fila
suma fechaNoFructifico como tercera fuente de fecha de archivo.
EOF
)"
```

---

## Task 3: FR — CSS del chip nuevo ✅ DONE (b419b2a)

**Files:**
- Modify: `fr/fr_styles.css:1176-1191`

- [ ] **Step 1: Agregar `.fr-chip-no-fructifico`**

Insertar después del bloque `.fr-chip-fin-ciclo` (línea 1191):

```css
/* No fructificó — bolsa con 0 cosechas que nunca prendió. Violeta: no es un
   error (rojo) ni un cierre deliberado de una bolsa que sí produjo (rojo
   oscuro de fin-ciclo) ni ambar (choca con fr-chip-pendiente) — es
   "no pasó nada". */
.fr-chip-no-fructifico {
    background: rgba(130, 90, 190, 0.20);
    color: #B79CFF;
    border-color: rgba(150, 110, 210, 0.5);
}
```

- [ ] **Step 2: Commit**

```bash
git add fr/fr_styles.css
git commit -m "feat(fr): CSS del chip NO FRUCTIFICO (violeta, distinto de bad/fin-ciclo/pendiente)"
```

---

## Task 4: FR — fix de agregados por SU + selector de base de experimentos ✅ DONE (593868a)

**Files:**
- Modify: `fr/fr_app.js:1244-1245` (`_aggregadosPorSU`)
- Modify: `fr/fr_app.js:4394-4396` (`_frExPoblarBase`)

- [ ] **Step 1: Excluir `noFructifico` del conteo de "colonizada" en `_aggregadosPorSU`**

```javascript
        var contam = deLote.filter(function(x) { return x.contaminada === true; }).length;
        var colon = deLote.filter(function(x) { return !!x.fechaColonizacion && x.contaminada !== true && x.noFructifico !== true; }).length;
```

Justificación (ya en la spec): una bolsa que llegó a colonizar pero nunca fructificó no debería
seguir contando como éxito en el ratio del lote SU — fix consecuente directo de agregar el
estado nuevo, no un cambio de alcance ajeno.

- [ ] **Step 2: Incluir `noFructifico` en el filtro de bolsas archivadas de `_frExPoblarBase`**

```javascript
    function _frExPoblarBase(ex) {
        var sel = document.getElementById('frExBase');
        if (!sel) return;
        var archivadas = bolsas.filter(function(b) {
            return b.cancelada === true || b.contaminada === true || b.cicloCerrado === true || b.noFructifico === true;
        }).sort(function(a, b) { return (b.ts || 0) - (a.ts || 0); });
```

- [ ] **Step 3: Verificar sintaxis**

Run: `node --check fr/fr_app.js`
Expected: sin salida (exit 0)

- [ ] **Step 4: Commit**

```bash
git add fr/fr_app.js
git commit -m "$(cat <<'EOF'
fix(fr): excluye bolsas noFructifico del ratio de exito y las suma al selector de base

_aggregadosPorSU contaba como "colonizada" (exito) una bolsa que
coloniz\u00f3 pero nunca fructific\u00f3. _frExPoblarBase no las ofrec\u00eda como
base de experimento pese a estar archivadas.
EOF
)"
```

---

## Task 5: FR — función `FR.marcarNoFructifico()` ✅ DONE (334e9c7) — review flagged pre-existing gap: ninguno de los 3 terminal-state setters (incluye marcarContaminada/cerrarCiclo ya en produccion) guarda contra bolsa `cancelada`; no introducido por esta tarea, sugerido como follow-up aparte

**Files:**
- Modify: `fr/fr_app.js:3582-3584` (insertar función nueva entre `marcarContaminada` y `recomputeFlushesLive`)

- [ ] **Step 1: Agregar la función**

Insertar el bloque completo entre el `};` que cierra `FR.marcarContaminada` (línea 3582) y
`FR.recomputeFlushesLive = function() {` (línea 3584):

```javascript
    // ------------------------------------------------------
    // Marcar bolsa como NO FRUCTIFICÓ (reversible).
    // Estado terminal propio, distinto de cicloCerrado: cicloCerrado sella el
    // ÚLTIMO FLUSH de una bolsa que sí produjo — esto es para bolsas con CERO
    // cosechas que nunca prendieron. Guard: solo aplica con 0 flushes y
    // ningún otro estado terminal activo.
    // ------------------------------------------------------
    FR.marcarNoFructifico = function() {
        var b = getSelected();
        if (!b) { alert('Selecciona una bolsa primero.'); return; }
        if (b.noFructifico === true) {
            if (!confirm('La bolsa ' + b.id + ' está marcada como NO FRUCTIFICÓ.\n\n¿Querés reabrirla?')) return;
            b.noFructifico = false;
            b.fechaNoFructifico = null;
            addObsTo(b, 'Reabierta desde Archivo (estaba marcada como no fructificó).', 'manual', 'yellow');
            b.estado = computeEstado(b);
            saveBolsas();
            renderAll();
            return;
        }
        if (b.contaminada === true) {
            alert('La bolsa ' + b.id + ' está marcada como CONTAMINADA. No aplica "no fructificó".');
            return;
        }
        if (b.cicloCerrado === true) {
            alert('La bolsa ' + b.id + ' ya tiene el ciclo cerrado (tuvo cosecha). No aplica "no fructificó".');
            return;
        }
        if (Array.isArray(b.flushes) && b.flushes.length > 0) {
            alert('La bolsa ' + b.id + ' ya tiene cosechas registradas. Usá "Cerrar ciclo" en vez de esto.');
            return;
        }
        if (!confirm('Marcar la bolsa ' + b.id + ' como NO FRUCTIFICÓ?\n\nLa bolsa se archivará. Es reversible desde Archivo.')) return;
        var prevEstado = computeEstado(b);
        b.noFructifico = true;
        b.fechaNoFructifico = hoyISO();
        addObsTo(b, 'Bolsa marcada como NO FRUCTIFICÓ desde FR. Archivada.', 'manual', 'yellow');
        b.estado = computeEstado(b);
        if (b.estado !== prevEstado) {
            addObsTo(b, 'Estado: ' + prevEstado + ' -> ' + b.estado, 'auto', 'none');
        }
        saveBolsas();
        renderAll();
    };

```

- [ ] **Step 2: Verificar sintaxis**

Run: `node --check fr/fr_app.js`
Expected: sin salida (exit 0)

- [ ] **Step 3: Commit**

```bash
git add fr/fr_app.js
git commit -m "$(cat <<'EOF'
feat(fr): FR.marcarNoFructifico() - marcar/reabrir bolsa sin cosechas

Reversible, mismo patron que cerrarCiclo(). Guards: rechaza si la
bolsa ya esta contaminada, con ciclo cerrado, o si tiene >=1 flush
(ahi corresponde Cerrar ciclo, no esto).
EOF
)"
```

---

## Task 6: FR — bloque de 3 botones terminales (Contaminación / Cerrar ciclo / No fructificó) ✅ DONE (a8cb0b4)

**Files:**
- Modify: `fr/fr_app.js:2101-2151` (bloque que gestiona `frBtnContam`/`frBtnCerrar`/`frContamInfo`)

- [ ] **Step 1: Reemplazar el bloque de 2 botones por el de 3**

Texto actual a reemplazar (líneas 2101-2151):

```javascript
        // Estado de los botones de acción terminal (Contaminación + Cerrar ciclo)
        var btnContam = document.getElementById('frBtnContam');
        var btnCerrar = document.getElementById('frBtnCerrar');
        var infoContam = document.getElementById('frContamInfo');

        if (b.contaminada === true) {
            if (btnContam) {
                btnContam.disabled = true;
                btnContam.textContent = '\u2620 Contaminada';
            }
            if (btnCerrar) {
                btnCerrar.disabled = true;
                btnCerrar.textContent = '\u23F9 Cerrar ciclo';
            }
            if (infoContam) {
                infoContam.classList.add('is-contam');
                infoContam.classList.remove('is-cerrado');
                var fc = b.fechaContaminacion ? fmtFecha(b.fechaContaminacion) : '';
                infoContam.textContent = 'Bolsa contaminada' + (fc ? ' el ' + fc : '') + ' \u00b7 Archivada';
            }
        } else if (b.cicloCerrado === true) {
            if (btnContam) {
                btnContam.disabled = true;
                btnContam.textContent = '\uD83D\uDD34 Contaminaci\u00f3n';
            }
            if (btnCerrar) {
                btnCerrar.disabled = false;
                btnCerrar.textContent = '\u21A9 Reabrir ciclo';
            }
            if (infoContam) {
                infoContam.classList.remove('is-contam');
                infoContam.classList.add('is-cerrado');
                var fcc = b.fechaCierreCiclo ? fmtFecha(b.fechaCierreCiclo) : '';
                infoContam.textContent = 'Ciclo cerrado' + (fcc ? ' el ' + fcc : '') + ' \u00b7 Archivada';
            }
        } else {
            if (btnContam) {
                btnContam.disabled = false;
                btnContam.textContent = '\uD83D\uDD34 Contaminaci\u00f3n';
            }
            if (btnCerrar) {
                btnCerrar.disabled = false;
                btnCerrar.textContent = '\u23F9 Cerrar ciclo';
            }
            if (infoContam) {
                infoContam.classList.remove('is-contam');
                infoContam.classList.remove('is-cerrado');
                infoContam.textContent = '';
            }
        }

        renderObs(b);
    }
```

Texto nuevo:

```javascript
        // Estado de los botones de acción terminal (Contaminación + Cerrar ciclo + No fructificó)
        var btnContam = document.getElementById('frBtnContam');
        var btnCerrar = document.getElementById('frBtnCerrar');
        var btnNoFruct = document.getElementById('frBtnNoFructifico');
        var infoContam = document.getElementById('frContamInfo');
        var tieneFlushes = Array.isArray(b.flushes) && b.flushes.length > 0;

        if (b.contaminada === true) {
            if (btnContam) {
                btnContam.disabled = true;
                btnContam.textContent = '\u2620 Contaminada';
            }
            if (btnCerrar) {
                btnCerrar.disabled = true;
                btnCerrar.textContent = '\u23F9 Cerrar ciclo';
            }
            if (btnNoFruct) {
                btnNoFruct.disabled = true;
                btnNoFruct.textContent = '\uD83D\uDD73 No fructific\u00f3';
            }
            if (infoContam) {
                infoContam.classList.add('is-contam');
                infoContam.classList.remove('is-cerrado');
                infoContam.classList.remove('is-no-fructifico');
                var fc = b.fechaContaminacion ? fmtFecha(b.fechaContaminacion) : '';
                infoContam.textContent = 'Bolsa contaminada' + (fc ? ' el ' + fc : '') + ' \u00b7 Archivada';
            }
        } else if (b.cicloCerrado === true) {
            if (btnContam) {
                btnContam.disabled = true;
                btnContam.textContent = '\uD83D\uDD34 Contaminaci\u00f3n';
            }
            if (btnCerrar) {
                btnCerrar.disabled = false;
                btnCerrar.textContent = '\u21A9 Reabrir ciclo';
            }
            if (btnNoFruct) {
                btnNoFruct.disabled = true;
                btnNoFruct.textContent = '\uD83D\uDD73 No fructific\u00f3';
            }
            if (infoContam) {
                infoContam.classList.remove('is-contam');
                infoContam.classList.add('is-cerrado');
                infoContam.classList.remove('is-no-fructifico');
                var fcc = b.fechaCierreCiclo ? fmtFecha(b.fechaCierreCiclo) : '';
                infoContam.textContent = 'Ciclo cerrado' + (fcc ? ' el ' + fcc : '') + ' \u00b7 Archivada';
            }
        } else if (b.noFructifico === true) {
            if (btnContam) {
                btnContam.disabled = true;
                btnContam.textContent = '\uD83D\uDD34 Contaminaci\u00f3n';
            }
            if (btnCerrar) {
                btnCerrar.disabled = true;
                btnCerrar.textContent = '\u23F9 Cerrar ciclo';
            }
            if (btnNoFruct) {
                btnNoFruct.disabled = false;
                btnNoFruct.textContent = '\u21A9 Reabrir (no fructific\u00f3)';
            }
            if (infoContam) {
                infoContam.classList.remove('is-contam');
                infoContam.classList.remove('is-cerrado');
                infoContam.classList.add('is-no-fructifico');
                var fnf = b.fechaNoFructifico ? fmtFecha(b.fechaNoFructifico) : '';
                infoContam.textContent = 'No fructific\u00f3' + (fnf ? ' el ' + fnf : '') + ' \u00b7 Archivada';
            }
        } else {
            if (btnContam) {
                btnContam.disabled = false;
                btnContam.textContent = '\uD83D\uDD34 Contaminaci\u00f3n';
            }
            if (btnCerrar) {
                btnCerrar.disabled = !tieneFlushes;
                btnCerrar.textContent = '\u23F9 Cerrar ciclo';
            }
            if (btnNoFruct) {
                btnNoFruct.disabled = tieneFlushes;
                btnNoFruct.textContent = '\uD83D\uDD73 No fructific\u00f3';
            }
            if (infoContam) {
                infoContam.classList.remove('is-contam');
                infoContam.classList.remove('is-cerrado');
                infoContam.classList.remove('is-no-fructifico');
                infoContam.textContent = '';
            }
        }

        renderObs(b);
    }
```

Nota: en el estado por defecto (ninguno de los 3 terminales activo), "Cerrar ciclo" ahora se
deshabilita si la bolsa tiene 0 flushes (no hay último flush que sellar) y "No fructificó" se
deshabilita si ya tiene ≥1 flush (ya no aplica, produjo algo) — son mutuamente excluyentes por
disponibilidad, no solo por guard interno de la función.

- [ ] **Step 2: Verificar sintaxis**

Run: `node --check fr/fr_app.js`
Expected: sin salida (exit 0)

- [ ] **Step 3: Commit**

```bash
git add fr/fr_app.js
git commit -m "$(cat <<'EOF'
feat(fr): bloque de 3 botones terminales (Contaminacion/Cerrar ciclo/No fructifico)

Cerrar ciclo se deshabilita con 0 flushes (no hay ultimo flush que
sellar); No fructifico se deshabilita con >=1 flush (ya no aplica).
Mutuamente excluyentes tanto por disponibilidad de boton como por
guard interno en las funciones que ya escriben cada estado.
EOF
)"
```

---

## Task 7: FR — botón HTML + CSS ✅ DONE (a23ca93) — FR-side completo, nada colgando

**Files:**
- Modify: `fr/fr_index.html:116-124`
- Modify: `fr/fr_styles.css` (después del bloque `.fr-btn-cerrar`, ~línea 853)

- [ ] **Step 1: Agregar el botón en el HTML**

```html
                        <div class="fr-actions-row">
                            <button type="button" id="frBtnContam" class="fr-btn-contam" onclick="FR.marcarContaminada()" title="Marca la bolsa como contaminada y la archiva (acción irreversible)">
                                🔴 Contaminación
                            </button>
                            <button type="button" id="frBtnCerrar" class="fr-btn-cerrar" onclick="FR.cerrarCiclo()" title="Cierra el ciclo de la bolsa y la archiva (acción reversible: se puede reabrir)">
                                ⏹ Cerrar ciclo
                            </button>
                            <button type="button" id="frBtnNoFructifico" class="fr-btn-no-fructifico" onclick="FR.marcarNoFructifico()" title="Marca la bolsa como que nunca dio cosecha y la archiva (acción reversible: se puede reabrir)">
                                🕳 No fructificó
                            </button>
                            <span id="frContamInfo" class="fr-contam-info"></span>
                        </div>
```

- [ ] **Step 2: Agregar el CSS del botón**

Insertar después del bloque `.fr-btn-cerrar:disabled { ... }` (línea 853), antes de
`.fr-contam-info`:

```css
/* No fructificó — acción reversible, mismo tratamiento visual que Cerrar ciclo
   pero con el violeta del chip para que se identifique de un vistazo. */
.fr-btn-no-fructifico {
    background: transparent;
    color: #B79CFF;
    border: 1px solid rgba(183,156,255,0.45);
    padding: 10px 18px;
    border-radius: 8px;
    font-family: inherit;
    font-size: 0.92rem;
    font-weight: 700;
    letter-spacing: .3px;
    cursor: pointer;
    transition: background .14s ease, color .14s ease, box-shadow .14s ease, transform .08s ease;
}
.fr-btn-no-fructifico:hover {
    background: rgba(183,156,255,0.10);
    border-color: #B79CFF;
    box-shadow: 0 0 0 2px rgba(183,156,255,0.18);
}
.fr-btn-no-fructifico:active { transform: translateY(1px); }
.fr-btn-no-fructifico:disabled {
    color: var(--text-muted);
    border-color: var(--border);
    cursor: not-allowed;
    box-shadow: none;
    opacity: 0.6;
}
```

Además, agregar la variante de color al `.fr-contam-info` existente:

```css
.fr-contam-info.is-no-fructifico {
    color: #B79CFF;
    font-weight: 600;
    font-style: normal;
}
```

(agregar inmediatamente después de `.fr-contam-info.is-cerrado { ... }`)

- [ ] **Step 3: Commit**

```bash
git add fr/fr_index.html fr/fr_styles.css
git commit -m "feat(fr): boton No fructifico en el panel + su CSS"
```

---

## Task 8: SU — helper de estado, acciones Sí/No, y fix del aviso obsoleto ✅ DONE (a28e992 + fix bad2ce8) — review encontro bug real (bolsa pendienteConfirmacion:true podia recibir noFructifico:true), corregido y re-verificado. Sugerencia no bloqueante pendiente: guard de pendienteConfirmacion tambien dentro del mutator, no solo en el caller.

Una sola tarea atómica (no partida en dos commits) a propósito: si las funciones
`suMarcarBolsaNoFructifico`/`suRevisarBolsaSigueEnSeguimiento` se definieran en un commit
posterior al que ya las referencia desde los botones del aviso, quedaría un commit intermedio
con la app rota (click → `ReferenceError`, la función no está en `window` todavía). Todo el
código nuevo de SU entra junto.

**Files:**
- Modify: `su/su_app.js:1272` (insertar helper + funciones de escritura nuevas)
- Modify: `su/su_app.js:1406-1434` (bloque del aviso)
- Modify: `su/su_app.js:3859-3891` (`Object.assign(window, {...})`)

- [ ] **Step 1: Agregar `_suFRArchivoInfo` + funciones de escritura, después de
      `window.suFormatFecha = suFormatFecha;`**

```javascript
window.suFormatFecha = suFormatFecha;

// Traduce el estado archivado real de una bolsa FR (solo lectura, nunca escribe)
// a texto + color para mostrar en la card de Registro de SU.
function _suFRArchivoInfo(frB) {
    if (frB.contaminada === true) {
        return { label: 'Contaminada' + (frB.fechaContaminacion ? ' (' + suFormatFecha(frB.fechaContaminacion) + ')' : ''), dotClass: 'su-be-dot--bad' };
    }
    if (frB.noFructifico === true) {
        return { label: 'No fructificó' + (frB.fechaNoFructifico ? ' (' + suFormatFecha(frB.fechaNoFructifico) + ')' : ''), dotClass: 'su-be-dot--warn' };
    }
    if (frB.cicloCerrado === true) {
        return { label: 'Fin del ciclo' + (frB.fechaCierreCiclo ? ' (' + suFormatFecha(frB.fechaCierreCiclo) + ')' : ''), dotClass: 'su-be-dot--good' };
    }
    if (frB.cancelada === true) {
        return { label: 'Cancelada', dotClass: 'su-be-dot--dim' };
    }
    return { label: 'Archivada', dotClass: 'su-be-dot--dim' };
}

// Fecha local (no UTC) — mismo criterio que hoyISO() de FR, para que
// fechaNoFructifico/noFructificoRevisadoEn no corran de día según timezone.
function _suHoyISOLocal() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Escritura directa a fr_bolsas sin depender de que el módulo FR esté montado —
// mismo patrón que _suPropagarRenameFR: leer, mutar por _frUuid, guardar,
// notificar con el mismo evento que FR ya escucha para sus propios cambios.
function _suEscribirBolsaFR(frUuid, mutator) {
    try {
        var raw = localStorage.getItem('fr_bolsas');
        if (!raw) return false;
        var bolsas = JSON.parse(raw);
        if (!Array.isArray(bolsas)) return false;
        var b = bolsas.find(function(x) { return x._frUuid === frUuid; });
        if (!b) return false;
        mutator(b);
        localStorage.setItem('fr_bolsas', JSON.stringify(bolsas));
        try { window.dispatchEvent(new Event('su-lote-guardado')); } catch (e) {}
        return true;
    } catch (e) {
        if (window.BioLog) window.BioLog.logError('SU', '_suEscribirBolsaFR', e, { frUuid: frUuid });
        alert('⚠ No se pudo actualizar la bolsa en FR (¿localStorage lleno?). Revisá manualmente en el módulo FR.');
        return false;
    }
}

function suMarcarBolsaNoFructifico(frUuid, frId) {
    if (!frUuid) return;
    if (!confirm('Marcar la bolsa ' + (frId || '') + ' como NO FRUCTIFICÓ?\n\nSe archivará en FR. Es reversible desde FR → Archivo.')) return;
    var ok = _suEscribirBolsaFR(frUuid, function(b) {
        b.noFructifico = true;
        b.fechaNoFructifico = _suHoyISOLocal();
        b.noFructificoRevisadoEn = null;
        if (!Array.isArray(b.observaciones)) b.observaciones = [];
        b.observaciones.push({
            id: 'nt_fr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
            ts: new Date().toISOString(), tsLegacy: null, tsInferred: false,
            texto: 'Bolsa marcada como NO FRUCTIFICÓ desde SU. Archivada.',
            estado: 'yellow', auto: false, tipo: null, editedAt: null, imagenes: []
        });
    });
    if (ok) renderizarRegistroLotes();
}

function suRevisarBolsaSigueEnSeguimiento(frUuid) {
    if (!frUuid) return;
    var ok = _suEscribirBolsaFR(frUuid, function(b) {
        b.noFructificoRevisadoEn = _suHoyISOLocal();
        if (!Array.isArray(b.observaciones)) b.observaciones = [];
        b.observaciones.push({
            id: 'nt_fr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
            ts: new Date().toISOString(), tsLegacy: null, tsInferred: false,
            texto: 'Revisado desde SU: no está abandonada, sigue en seguimiento.',
            estado: 'none', auto: false, tipo: null, editedAt: null, imagenes: []
        });
    });
    if (ok) renderizarRegistroLotes();
}
// Letra alfabética: 0→a, 1→b, ... 25→z, 26→aa, ...
```

(la línea de comentario "Letra alfabética..." ya existía antes de `renderizarRegistroLotes` —
se conserva tal cual, solo se inserta el bloque nuevo antes)

- [ ] **Step 2: Exponer las 2 funciones nuevas en `Object.assign(window, {...})`**

```javascript
    // Utilidades expuestas
    suGenerarId,
    suNavToFR,
    suMarcarBolsaNoFructifico,
    suRevisarBolsaSigueEnSeguimiento,
    // suNavToFR ya expuesto arriba en el bloque
});
```

(reemplaza el bloque `// Utilidades expuestas\n    suGenerarId,\n    suNavToFR,\n    //
suNavToFR ya expuesto arriba en el bloque\n});`)

- [ ] **Step 3: Reemplazar el bloque del aviso**

Texto actual a reemplazar (líneas 1406-1434):

```javascript
            var beRowHtml = '';
            if (frB) {
                var flushesFr = Array.isArray(frB.flushes) ? frB.flushes : [];
                if (flushesFr.length > 0) {
                    var beStats = _suBolsaBE(frB);
                    if (beStats) {
                        var beCls = beStats.beTotal >= 150 ? 'su-be-dot--good' : (beStats.beTotal >= 100 ? 'su-be-dot--warn' : 'su-be-dot--bad');
                        // Desglose por oleada — el total acumulado solo no dice si fue una
                        // bolsa fuerte de entrada o varias oleadas flojas que sumaron parecido.
                        var oleadasTxt = flushesFr.map(function(f, fi) {
                            return 'F' + (f.n || (fi + 1)) + ' ' + (parseFloat(f.beOleada) || 0).toFixed(0) + '%';
                        }).join(' · ');
                        beRowHtml = `
                <div class="su-be-row">
                    <span class="su-be-dot ${beCls}"></span>
                    <span class="su-be-label">BE ${beStats.beTotal.toFixed(0)}% total (${oleadasTxt})</span>
                </div>`;
                    }
                } else if (frB.fechaInicio) {
                    var diasSinFR = (Date.now() - new Date(frB.fechaInicio).getTime()) / 86400000;
                    if (diasSinFR >= 60) {
                        beRowHtml = `
                <div class="su-be-row su-be-danger">
                    <span class="su-be-danger-dots"><span></span><span></span><span></span></span>
                    <span class="su-be-label">Sin registro FR desde hace ${Math.floor(diasSinFR)} días — ¿bolsa abandonada?</span>
                </div>`;
                    }
                }
            }
```

Texto nuevo:

```javascript
            var beRowHtml = '';
            if (frB) {
                var flushesFr = Array.isArray(frB.flushes) ? frB.flushes : [];
                if (flushesFr.length > 0) {
                    var beStats = _suBolsaBE(frB);
                    if (beStats) {
                        var beCls = beStats.beTotal >= 150 ? 'su-be-dot--good' : (beStats.beTotal >= 100 ? 'su-be-dot--warn' : 'su-be-dot--bad');
                        // Desglose por oleada — el total acumulado solo no dice si fue una
                        // bolsa fuerte de entrada o varias oleadas flojas que sumaron parecido.
                        var oleadasTxt = flushesFr.map(function(f, fi) {
                            return 'F' + (f.n || (fi + 1)) + ' ' + (parseFloat(f.beOleada) || 0).toFixed(0) + '%';
                        }).join(' · ');
                        beRowHtml = `
                <div class="su-be-row">
                    <span class="su-be-dot ${beCls}"></span>
                    <span class="su-be-label">BE ${beStats.beTotal.toFixed(0)}% total (${oleadasTxt})</span>
                </div>`;
                    }
                } else if (frB.contaminada === true || frB.cicloCerrado === true || frB.noFructifico === true || frB.cancelada === true) {
                    // FIX: la bolsa ya se resolvió en FR — mostrar su estado real en vez del
                    // aviso de "¿no fructificó?", que antes quedaba huérfano para siempre sin
                    // importar qué pasara con la bolsa en FR (bug reportado por el usuario:
                    // marcó una bolsa contaminada en FR y SU seguía preguntando indefinidamente).
                    var arcInfo = _suFRArchivoInfo(frB);
                    beRowHtml = `
                <div class="su-be-row">
                    <span class="su-be-dot ${arcInfo.dotClass}"></span>
                    <span class="su-be-label">🍄 ${arcInfo.label}</span>
                </div>`;
                } else if (frB.fechaInicio) {
                    var diasSinFR = (Date.now() - new Date(frB.fechaInicio).getTime()) / 86400000;
                    var snoozed = frB.noFructificoRevisadoEn &&
                        (Date.now() - new Date(frB.noFructificoRevisadoEn).getTime()) < 7 * 86400000;
                    if (diasSinFR >= 60 && !snoozed) {
                        beRowHtml = `
                <div class="su-be-row su-be-danger">
                    <span class="su-be-danger-dots"><span></span><span></span><span></span></span>
                    <span class="su-be-label">Sin registro FR desde hace ${Math.floor(diasSinFR)} días — ¿no fructificó?</span>
                    <span class="su-be-nf-actions">
                        <button type="button" class="su-be-btn-si" onclick="event.stopPropagation();suMarcarBolsaNoFructifico('${frB._frUuid||''}','${frB.id||''}')">Sí, no fructificó</button>
                        <button type="button" class="su-be-btn-no" onclick="event.stopPropagation();suRevisarBolsaSigueEnSeguimiento('${frB._frUuid||''}')">No, sigue en seguimiento</button>
                    </span>
                </div>`;
                    }
                }
            }
```

(Nota: `su_app.js` no tiene una función `esc()` propia — el resto del archivo interpola valores
directo en los template strings sin escapar HTML, incluyendo llamadas similares ya existentes
como `onclick="suNavToFR('${frB.id}')"` un poco más arriba en la misma función. `_frUuid` es un
UUID generado por `_frGenUUID()` en FR — sin caracteres que rompan el atributo. Se sigue la
misma convención, sin introducir escaping nuevo que el resto del archivo no tiene.)

- [ ] **Step 4: Verificar sintaxis**

Run: `node --check su/su_app.js`
Expected: sin salida (exit 0)

- [ ] **Step 5: Commit**

```bash
git add su/su_app.js
git commit -m "$(cat <<'EOF'
fix(su): aviso "no fructifico" con acciones Si/No, ya no ignora el estado real

Bug: si la bolsa ya estaba contaminada/cicloCerrado/cancelada en FR, SU
mostraba igual "Sin registro FR... bolsa abandonada?" para siempre. Ahora
muestra el estado real via _suFRArchivoInfo (solo lectura de fr_bolsas).

Feature: el aviso para bolsas sin resolver pasa a preguntar "no
fructifico?" con 2 acciones. Si: escribe noFructifico=true en fr_bolsas
(archiva la bolsa en FR) via _suEscribirBolsaFR, mismo patron que
_suPropagarRenameFR. No: snooze de 7 dias (noFructificoRevisadoEn).
Ambas dejan observacion en fr_bolsas y disparan 'su-lote-guardado'.
EOF
)"
```

---

## Task 9: SU — CSS de los botones y el dot nuevo ✅ DONE (ddf4e59) — todo el codigo del plan completo

**Files:**
- Modify: `su/su_styles.css:2138-2166`

- [ ] **Step 1: Agregar `.su-be-dot--dim`**

```css
.su-be-dot--good { background: #70AD47; box-shadow: 0 0 6px #70AD47; }
.su-be-dot--warn { background: #FFC000; box-shadow: 0 0 6px #FFC000; }
.su-be-dot--bad  { background: #FF6B6B; box-shadow: 0 0 6px #FF6B6B; }
.su-be-dot--dim  { background: #888; box-shadow: none; animation: none; }
```

(reemplaza las 3 líneas existentes por las 4 — la nueva sin `animation` porque "cancelada"/
fallback no necesita el pulso de atención que sí tiene un estado activo)

- [ ] **Step 2: Agregar los botones Sí/No, después del bloque `@keyframes suBeDangerBlink`**

Insertar después de:
```css
@keyframes suBeDangerBlink {
    0%, 100% { opacity: 1;   transform: scale(1);    }
    50%       { opacity: 0.25; transform: scale(0.8); }
}
```

y antes de `/* Chips de registro */`:

```css
.su-be-nf-actions {
    display: inline-flex;
    gap: 6px;
    margin-left: 8px;
}
.su-be-btn-si,
.su-be-btn-no {
    font-size: 10px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 999px;
    cursor: pointer;
    white-space: nowrap;
}
.su-be-btn-si {
    background: rgba(255, 107, 107, 0.15);
    border: 1px solid rgba(255, 107, 107, 0.5);
    color: #FF6B6B;
}
.su-be-btn-si:hover { background: rgba(255, 107, 107, 0.28); }
.su-be-btn-no {
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.15);
    color: var(--text-muted, #999);
}
.su-be-btn-no:hover { background: rgba(255,255,255,0.09); }
```

- [ ] **Step 3: Commit**

```bash
git add su/su_styles.css
git commit -m "feat(su): CSS de los botones Si/No del aviso + dot neutro para archivadas"
```

---

## Task 10: Verificación manual end-to-end en navegador real ✅ DONE — 9/9 pasos OK en navegador real, localStorage restaurado exacto (31 lotes / 66 bolsas)

Sin test runner en el repo — se verifica igual que el resto del proyecto: navegador real contra
datos sintéticos que se agregan y se retiran explícitamente (no se toca el backup real del
usuario). Requiere el servidor local corriendo y las herramientas chrome-devtools disponibles
(`mcp__chrome-devtools__*`).

**Files:** ninguno (solo verificación, sin cambios de código)

- [ ] **Step 1: Levantar el servidor local**

Run: `cd "c:\Users\JET\Desktop\MOBY DICK\biolab-app" && ./serve.bat` (en background)
Expected: sirviendo en `http://localhost:8734`

- [ ] **Step 2: Abrir la app y sembrar datos sintéticos de prueba**

Navegar a `http://localhost:8734/#SU`, luego ejecutar vía `evaluate_script` (o la consola del
navegador) — agrega UN lote SU y UNA bolsa FR sintéticos, claramente marcados como test, sin
tocar ningún registro real existente:

```javascript
(function() {
    var su = JSON.parse(localStorage.getItem('su_lotes') || '[]');
    su.push({
        id: 'SU-TESTNF', fecha: '2026-01-01', total: 1000, fibra: 500,
        db: [{ tanda: 'T1', bolsas: 1, grUsados: 1 }]
    });
    localStorage.setItem('su_lotes', JSON.stringify(su));

    var fr = JSON.parse(localStorage.getItem('fr_bolsas') || '[]');
    fr.push({
        _frUuid: 'test-nf-uuid-001', id: 'FRTESTNF', suLoteId: 'SU-TESTNF', suBolsaIndex: 0,
        fechaInicio: '2026-01-01', fechaEntradaFR: '2026-01-01', pendienteConfirmacion: false,
        flushes: [], observaciones: []
    });
    localStorage.setItem('fr_bolsas', JSON.stringify(fr));
    return 'seeded';
})()
```

Expected: devuelve `'seeded'`.

- [ ] **Step 3: Recargar SU y verificar el aviso nuevo**

Recargar la página (`http://localhost:8734/#SU`), ir a Registro. Verificar con
`take_screenshot`/`take_snapshot`:
- La sub-fila de `SU-TESTNF` muestra el texto **"Sin registro FR desde hace ... días —
  ¿no fructificó?"** (con `fechaInicio: '2026-01-01'`, muy anterior a hoy, dispara el umbral de
  60 días) y los 2 botones **"Sí, no fructificó"** / **"No, sigue en seguimiento"**.
- El texto viejo "¿bolsa abandonada?" NO aparece en ningún lado de la página.

- [ ] **Step 4: Click en "No, sigue en seguimiento" y verificar el snooze**

Click en el botón. Verificar:
- El aviso desaparece de la card inmediatamente (re-render sin recargar).
- `localStorage.getItem('fr_bolsas')` (via `evaluate_script`) muestra la bolsa
  `test-nf-uuid-001` con `noFructificoRevisadoEn` seteado a la fecha de hoy y una observación
  nueva con texto `'Revisado desde SU: no está abandonada, sigue en seguimiento.'`.
- Recargar la página: el aviso sigue sin aparecer (snooze activo).

- [ ] **Step 5: Forzar el vencimiento del snooze y click en "Sí, no fructificó"**

Vía `evaluate_script`, retroceder `noFructificoRevisadoEn` más de 7 días:

```javascript
(function() {
    var fr = JSON.parse(localStorage.getItem('fr_bolsas') || '[]');
    var b = fr.find(function(x) { return x._frUuid === 'test-nf-uuid-001'; });
    if (b) b.noFructificoRevisadoEn = '2026-01-01';
    localStorage.setItem('fr_bolsas', JSON.stringify(fr));
    return b ? 'ok' : 'not-found';
})()
```

Recargar SU → el aviso vuelve a aparecer (snooze vencido). Click en **"Sí, no fructificó"** →
confirmar el `confirm()`. Verificar:
- La card de `SU-TESTNF` pasa a mostrar `"🍄 No fructificó (<fecha de hoy>)"` con el dot ámbar
  (`su-be-dot--warn`), no el aviso con botones.
- `localStorage.getItem('fr_bolsas')`: la bolsa test tiene `noFructifico: true`,
  `fechaNoFructifico` = fecha de hoy, una observación con texto
  `'Bolsa marcada como NO FRUCTIFICÓ desde SU. Archivada.'`.

- [ ] **Step 6: Verificar en FR que la bolsa aparece archivada con el chip correcto**

Navegar a `http://localhost:8734/#FR`, ir a Archivo. Verificar con `take_screenshot`:
- `FRTESTNF` aparece en la lista de Archivo con chip **"NO FRUCTIFICÓ"** en violeta
  (`fr-chip-no-fructifico`).
- Seleccionar la bolsa: el botón **"🕳 No fructificó"** muestra ahora
  **"↩ Reabrir (no fructificó)"**, "Contaminación" y "Cerrar ciclo" están deshabilitados.
- `frContamInfo` muestra `"No fructificó el <fecha> · Archivada"`.

- [ ] **Step 7: Reabrir desde FR y verificar que vuelve a estado activo**

Click en **"↩ Reabrir (no fructificó)"** → confirmar. Verificar:
- La bolsa vuelve a Activos (no a Archivo).
- `"Cerrar ciclo"` vuelve a estar deshabilitado (0 flushes) y `"No fructificó"` habilitado de
  nuevo (bolsa activa con 0 flushes).
- `fr_bolsas`: `noFructifico: false`, `fechaNoFructifico: null`.

- [ ] **Step 8: Probar el guard de "ya tiene cosechas" (botón deshabilitado + función)**

Vía `evaluate_script`, agregar un flush sintético a la misma bolsa de test:

```javascript
(function() {
    var fr = JSON.parse(localStorage.getItem('fr_bolsas') || '[]');
    var b = fr.find(function(x) { return x._frUuid === 'test-nf-uuid-001'; });
    if (b) b.flushes = [{ n: 1, fecha: '2026-02-01', pesoHumedo: 50 }];
    localStorage.setItem('fr_bolsas', JSON.stringify(fr));
    return b ? 'ok' : 'not-found';
})()
```

Recargar FR, seleccionar la bolsa. Verificar: **"No fructificó" está deshabilitado**,
**"Cerrar ciclo" está habilitado**. (No hace falta clickear `FR.marcarNoFructifico()`
directamente — el guard interno ya está cubierto por los guards de Task 5/las alertas leídas en
el código; el botón deshabilitado es la barrera real que ve el usuario.)

- [ ] **Step 9: Limpieza — retirar los datos sintéticos**

Vía `evaluate_script`, quitar exactamente los 2 registros de test (nunca un `localStorage.clear()`
ni filtrar por rango — solo los IDs marcados como test):

```javascript
(function() {
    var su = JSON.parse(localStorage.getItem('su_lotes') || '[]');
    su = su.filter(function(l) { return l.id !== 'SU-TESTNF'; });
    localStorage.setItem('su_lotes', JSON.stringify(su));

    var fr = JSON.parse(localStorage.getItem('fr_bolsas') || '[]');
    fr = fr.filter(function(b) { return b._frUuid !== 'test-nf-uuid-001'; });
    localStorage.setItem('fr_bolsas', JSON.stringify(fr));
    return { suLen: su.length, frLen: fr.length };
})()
```

Recargar ambos módulos (SU y FR) y confirmar visualmente que `SU-TESTNF`/`FRTESTNF` ya no
aparecen en ninguna lista.

- [ ] **Step 10: Reportar resultado**

No hay commit en esta tarea (verificación pura). Si algún paso falla, volver a la tarea de
código correspondiente, corregir, y repetir la verificación desde el paso que falló.

---

## Task 11: Documentar el invariante nuevo en `CLAUDE.md` ✅ DONE — sin commit: CLAUDE.md esta gitignoreado a proposito (notas internas, nunca al repo publico), el plan se equivoco al pedir `git commit` para este archivo. El subagente lo detecto solo y se nego correctamente en vez de forzar el add.

**Files:**
- Modify: `c:\Users\JET\Desktop\MOBY DICK\biolab-app\CLAUDE.md`

(Solo este archivo — el `CLAUDE.md` de la carpeta padre `MOBY DICK` es archivo viejo, no se
sincroniza más, per la sección "ESTADO DEL REPO" del propio archivo.)

- [ ] **Step 1: Agregar una entrada a la lista de invariantes vigentes**

Insertar como nuevo ítem dentro de la sección `## INVARIANTES VIGENTES — de sesiones de fixes
recientes`, después del último ítem existente (el de "FR/SU — la genética en vistas de lista..."):

```markdown
- **FR — estado terminal `noFructifico`, distinto de `cicloCerrado` (2026-09-02).** Bolsas con
  0 cosechas nunca deben archivarse como `cicloCerrado` — ese campo sella el ÚLTIMO FLUSH de una
  bolsa que sí produjo (tiene lógica biológica propia: registra el ciclo productivo máximo
  vital). `noFructifico`/`fechaNoFructifico` son su propio estado terminal reversible, hermano
  de `contaminada`/`cicloCerrado`, guardado en `FR.marcarNoFructifico()` contra 3 casos:
  bolsa ya `contaminada`, ya `cicloCerrado`, o con `flushes.length > 0` (en cualquiera de los 3
  corresponde otro mecanismo, no este). El botón `🕳 No fructificó` del panel de FR y
  `⏹ Cerrar ciclo` son mutuamente excluyentes por disponibilidad además de por guard interno:
  el primero solo se habilita con 0 flushes, el segundo solo con ≥1.
  **SU — el aviso "Sin registro FR desde hace N días"** (`su_app.js`, sub-fila sin flushes,
  ≥60 días desde `fechaInicio`) tenía un bug real: no chequeaba si la bolsa ya estaba resuelta
  en FR por cualquier vía, y seguía mostrando el aviso para siempre incluso después de marcar la
  bolsa `contaminada` desde FR. Corregido: si la bolsa está `contaminada`/`cicloCerrado`/
  `noFructifico`/`cancelada`, SU muestra su estado real (`_suFRArchivoInfo`, solo lectura) en vez
  del aviso. El aviso en sí ahora resuelve "¿no fructificó?" con 2 botones — "Sí" escribe directo
  en `localStorage['fr_bolsas']` sin depender de que FR esté montado (mismo patrón que
  `_suPropagarRenameFR`: mutar por `_frUuid`, guardar, `dispatchEvent('su-lote-guardado')`), "No"
  silencia el aviso 7 días vía `noFructificoRevisadoEn` (snooze, no descarte permanente — si
  sigue sin resolverse después de la semana, vuelve a preguntar). Decisión de diseño explícita
  del usuario durante el brainstorming: no existe un estado "abandonada" separado — su flujo real
  es que solo revisa activamente las bolsas que muestran hongos, así que "no fructificó" y "se
  descubre tarde que no fructificó" son el mismo hecho, no dos causas distintas.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: documenta el invariante noFructifico y el fix del aviso de SU"
```

---

## Cobertura de la spec (autochequeo)

- Bug del aviso obsoleto (no chequea estado archivado) → Task 8.
- Aviso "¿no fructificó?" con Sí/No, snooze de 7 días, y escritura cross-módulo SU→`fr_bolsas`
  siguiendo el patrón existente (`_suPropagarRenameFR`) → Task 8 (una sola tarea atómica a
  propósito, ver nota al inicio del Task 8 sobre por qué no se parte en dos commits).
- Estado terminal `noFructifico` en FR (computeEstado/esArchivada/identidad) → Task 1.
- Chips visuales (4 sitios) + CSS → Task 2 + Task 3.
- Fix consecuente de `_aggregadosPorSU`/`_frExPoblarBase` → Task 4.
- `FR.marcarNoFructifico()` reversible con guards → Task 5.
- Botón nuevo en FR + bloque de 3 botones mutuamente excluyentes → Task 6 + Task 7.
- CSS de SU (dot + botones) → Task 9.
- Verificación funcional real → Task 10.
- Documentación del invariante (Regla 11 de `CLAUDE.md`) → Task 11.

Todo lo cubierto en la spec de diseño tiene una tarea. Nada de "Cerrar ciclo" se modifica, tal
como se acordó explícitamente (fuera de alcance).
