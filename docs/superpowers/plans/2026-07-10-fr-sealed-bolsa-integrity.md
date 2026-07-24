# FR — Proteger bolsas selladas en sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar el hueco confirmado por auditoría forense (2026-07-10): `sincronizarTodo()` sobreescribe 4 campos de una bolsa FR ya sellada (`pendienteConfirmacion:false`) sin ningún gate, y `_migrarFrInoculoSourceNull()` re-muta bolsas selladas en cada carga del módulo sin marcador one-shot.

**Architecture:** Dos cambios quirúrgicos en `fr/fr_app.js`, ambos siguiendo un patrón que YA existe en el mismo archivo (el gate `esPendiente(ex)` que protege `grSources`/`grLoteId`/`grTandaId` unas líneas más abajo del primer bug, y el marcador `localStorage` one-shot que ya usa la función hermana `migrarLegacySUtoFRv2`).

**Tech Stack:** Vanilla JS (IIFE), localStorage. Sin test suite — verificación por `node --check` + comparación manual contra el hallazgo forense ya confirmado (bolsas `FR15b`/`FR15d`).

**Spec:** hallazgo de auditoría en `BIOLAB_SYSTEM.md` §11 ("FR — sincronizarTodo() sobreescribe... sin gate") y reporte forense de esta sesión (2 bolsas mutadas confirmadas: `FR15b`, `FR15d`, campo `granoPorBolsa`, 2026-05-01).

---

### Task 1: Gatear los 4 campos de `sincronizarTodo()` detrás de `esPendiente(ex)`

**Files:**
- Modify: `fr/fr_app.js:591-606`

**Contexto:** dentro de `sincronizarTodo()`, cuando existe una bolsa (`exBolsa`/`ex`) que ya matchea con la fila de SU que se está sincronizando, el código sincroniza 4 campos derivados de SU/GR (`granoPorBolsa`, `pesoHumedoHidratado`, `pesoSustratoSeco`, `fechaRegistroGR`) SIN chequear si la bolsa está sellada. Unas líneas más abajo (línea 610), el bloque que sincroniza `grSources`/`grLoteId`/`grTandaId` SÍ está protegido con `if (esPendiente(ex)) { ... }` — con el comentario explícito "una bolsa confirmada tiene su trazabilidad sellada por el operador en el momento del armado". Los 4 campos de arriba deberían tener la misma protección y no la tienen — confirmado por auditoría forense que esto mutó datos reales de 2 bolsas (`FR15b`, `FR15d`, campo `granoPorBolsa`, 700→1050, el 2026-05-01) sin dejar rastro de auditoría.

**No tocar** las "Migración Fase 4a" (línea 624-629) ni "Fase 4b" (línea 630-657) que siguen después — esas SOLO rellenan campos ausentes/null (`!ex.grSources`, `s.inoculoSource == null`, etc.), nunca reemplazan un valor ya presente, así que no son el bug confirmado y darles el mismo gate cambiaría comportamiento de backward-compat que no está roto.

- [ ] **Step 1: Envolver el bloque de 4 campos en el mismo gate**

Buscar:

```js
                    if (exBolsa) {
                        var ex = exBolsa;
                        // Sincronizar métricas derivadas de SU
                        if (granoPorBolsaTanda != null && ex.granoPorBolsa !== granoPorBolsaTanda) {
                            ex.granoPorBolsa = granoPorBolsaTanda;
                            res.colonizacionSync++;
                        }
                        if (hidratadoPorBolsaTanda != null && ex.pesoHumedoHidratado !== hidratadoPorBolsaTanda) {
                            ex.pesoHumedoHidratado = hidratadoPorBolsaTanda;
                            res.colonizacionSync++;
                        }
                        if (sustratoPorBolsa > 0 && ex.pesoSustratoSeco !== sustratoPorBolsa) {
                            ex.pesoSustratoSeco = sustratoPorBolsa;
                            res.colonizacionSync++;
                        }
                        if (fechaRegGR && !ex.fechaRegistroGR) {
                            ex.fechaRegistroGR = fechaRegGR;
                            res.colonizacionSync++;
                        }
                        // Sincronizar fuentes GR: si SU cambió la trazabilidad, propagar a FR.
```

Reemplazar por:

```js
                    if (exBolsa) {
                        var ex = exBolsa;
                        // Sincronizar métricas derivadas de SU — SOLO en bolsas pendientes.
                        // Una bolsa sellada (pendienteConfirmacion:false) tiene estos valores
                        // congelados por el operador; auditoría forense 2026-07-10 confirmó
                        // que sin este gate, sincronizarTodo() reescribía granoPorBolsa en
                        // bolsas ya selladas sin dejar rastro (bolsas FR15b/FR15d, 2026-05-01).
                        if (esPendiente(ex)) {
                            if (granoPorBolsaTanda != null && ex.granoPorBolsa !== granoPorBolsaTanda) {
                                ex.granoPorBolsa = granoPorBolsaTanda;
                                res.colonizacionSync++;
                            }
                            if (hidratadoPorBolsaTanda != null && ex.pesoHumedoHidratado !== hidratadoPorBolsaTanda) {
                                ex.pesoHumedoHidratado = hidratadoPorBolsaTanda;
                                res.colonizacionSync++;
                            }
                            if (sustratoPorBolsa > 0 && ex.pesoSustratoSeco !== sustratoPorBolsa) {
                                ex.pesoSustratoSeco = sustratoPorBolsa;
                                res.colonizacionSync++;
                            }
                            if (fechaRegGR && !ex.fechaRegistroGR) {
                                ex.fechaRegistroGR = fechaRegGR;
                                res.colonizacionSync++;
                            }
                        }
                        // Sincronizar fuentes GR: si SU cambió la trazabilidad, propagar a FR.
```

- [ ] **Step 2: Chequeo de sintaxis**

Run: `node --check "fr/fr_app.js"`
Expected: sin output.

- [ ] **Step 3: Commit**

```bash
git add fr/fr_app.js
git commit -m "fix(fr): sincronizarTodo() ya no sobreescribe grano/peso en bolsas selladas"
```

---

### Task 2: Marcador one-shot en `_migrarFrInoculoSourceNull()`

**Files:**
- Modify: `fr/fr_app.js:4507-4530`

**Contexto:** a diferencia de su hermana `migrarLegacySUtoFRv2()` (líneas 4476-4505, que sí chequea `localStorage.getItem('biolab_migracion_su_fr_v2') === '1'` antes de correr y aborta si ya se ejecutó), `_migrarFrInoculoSourceNull()` no tiene ningún marcador — parsea y potencialmente reescribe `fr_bolsas` completo en CADA `FR.init()`, tocando `grSources[]` de bolsas selladas cada vez. Le agregamos el mismo patrón de marcador que ya usa su hermana, con una key distinta.

- [ ] **Step 1: Agregar el marcador one-shot**

Buscar:

```js
    function _migrarFrInoculoSourceNull() {
        try {
            var raw = localStorage.getItem(FR_KEY);
            if (!raw) return;
            var bolsas = JSON.parse(raw);
            if (!Array.isArray(bolsas)) return;
            var cambiados = 0;
            bolsas.forEach(function(b) {
                if (!Array.isArray(b.grSources)) return;
                b.grSources.forEach(function(s) {
                    if (s.inoculoSource === null || s.inoculoSource === undefined) {
                        s.inoculoSource = 'LEGACY';
                        cambiados++;
                    }
                });
            });
            if (cambiados > 0) {
                localStorage.setItem(FR_KEY, JSON.stringify(bolsas));
                console.log('[FR] Migración inoculoSource: ' + cambiados + ' registros actualizados a LEGACY');
            }
        } catch(e) {
            console.error('[FR] Error en migración inoculoSource:', e);
        }
    }
```

Reemplazar por:

```js
    function _migrarFrInoculoSourceNull() {
        var KEY_MIG = 'biolab_migracion_fr_inoculo_source_v1';
        try {
            if (localStorage.getItem(KEY_MIG) === '1') return;
        } catch (e) { return; }
        try {
            var raw = localStorage.getItem(FR_KEY);
            if (!raw) { try { localStorage.setItem(KEY_MIG, '1'); } catch(e) {} return; }
            var bolsas = JSON.parse(raw);
            if (!Array.isArray(bolsas)) { try { localStorage.setItem(KEY_MIG, '1'); } catch(e) {} return; }
            var cambiados = 0;
            bolsas.forEach(function(b) {
                if (!Array.isArray(b.grSources)) return;
                b.grSources.forEach(function(s) {
                    if (s.inoculoSource === null || s.inoculoSource === undefined) {
                        s.inoculoSource = 'LEGACY';
                        cambiados++;
                    }
                });
            });
            if (cambiados > 0) {
                localStorage.setItem(FR_KEY, JSON.stringify(bolsas));
                console.log('[FR] Migración inoculoSource: ' + cambiados + ' registros actualizados a LEGACY');
            }
            try { localStorage.setItem(KEY_MIG, '1'); } catch (e) {}
        } catch(e) {
            console.error('[FR] Error en migración inoculoSource:', e);
        }
    }
```

**Nota importante para quien implemente:** esto vuelve la migración estrictamente one-shot — a partir de este cambio, cualquier bolsa NUEVA guardada con `inoculoSource: null` dentro de `grSources[]` (lo cual `recolectarDatosLote()` en GR todavía puede producir hoy, ver plan de GR tarea de `_migrarInoculoSourceNull`) YA NO se corregirá automáticamente a `'LEGACY'` en el próximo load de FR, porque la migración ya habrá corrido una vez. Esto es intencional y correcto — el problema real (que se sigan generando `null` en origen) hay que resolverlo en GR, no parcheándolo acá para siempre. Si al testear aparecen `inoculoSource: null` nuevos que ya no se autocorrigen, es la señal de que hace falta el fix de GR, no de que este cambio esté mal.

- [ ] **Step 2: Chequeo de sintaxis**

Run: `node --check "fr/fr_app.js"`
Expected: sin output.

- [ ] **Step 3: Commit**

```bash
git add fr/fr_app.js
git commit -m "fix(fr): marcador one-shot en migracion de inoculoSource (dejaba de tocar bolsas selladas cada carga)"
```

---

### Task 3: QA manual

**Files:** ninguno (verificación manual, no hay suite de tests en este repo)

- [ ] **Step 1:** levantar `python serve.py` desde `biolab-app/`, abrir FR, forzar una sincronización (`sincronizarTodo` se dispara al entrar al módulo o vía el botón de sync si existe uno visible).
- [ ] **Step 2:** en la consola del navegador, tomar una bolsa sellada (`pendienteConfirmacion:false`) cualquiera, anotar `granoPorBolsa`/`pesoHumedoHidratado`/`pesoSustratoSeco`/`fechaRegistroGR`, correr el sync de nuevo, confirmar que esos 4 valores NO cambiaron aunque la fila SU/GR correspondiente tenga datos distintos.
- [ ] **Step 3:** confirmar en consola que `localStorage.getItem('biolab_migracion_fr_inoculo_source_v1')` existe (`'1'`) después de cargar FR una vez.
- [ ] **Step 4:** confirmar que una bolsa PENDIENTE (`pendienteConfirmacion:true`) SÍ sigue actualizando esos 4 campos al sincronizar — el fix no debe romper el caso normal, solo el caso sellado.
