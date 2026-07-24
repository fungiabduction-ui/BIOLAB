# Unificar grNormSources/suDbNormSources en una lib compartida Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar la duplicación de lógica de negocio entre `grNormSources()` (GR) y `suDbNormSources()` (SU) — dos copias independientes de la misma normalización de `grSources[]` que ya divergieron en comportamiento (auditoría 2026-07-10).

**Architecture:** Nueva lib compartida `shared/gr_su_sources.js` (mismo patrón que `shared/ci_gr_links.js`: cargada por `<script src="../shared/...">` en ambos módulos, expone `window.GrSuSources.normalize(row, grLoteDefault)`). GR y SU pasan a delegar a esa única implementación en vez de mantener la suya.

**Tech Stack:** Vanilla JS, sin build step. Sin test framework — verificación por `node --check` + comparación manual de comportamiento antes/después.

**Spec:** hallazgo de auditoría en `BIOLAB_SYSTEM.md` §11 ("Lógica duplicada con drift real — grNormSources vs suDbNormSources").

**Divergencia real encontrada (confirmada leyendo ambos archivos):**
```js
// su_app.js:2154-2163 — suDbNormSources, rama grSources[] (formato nuevo)
grLoteId: String(s.grLoteId || lo /* fallback a grLoteDefault */ || '').trim() || null,

// gr_app.js:243-253 — grNormSources, rama grSources[] (formato nuevo)
grLoteId: (String(s.grLoteId || '').trim()) || null,   // SIN fallback a grLoteDefault acá
```
Ambas ramas legacy (campos flat) SÍ aplican el fallback igual en los dos archivos — solo la rama de array difiere. Se estandariza en el comportamiento de SU (aplicar el fallback también en la rama de array) porque el propio comentario de `suDbNormSources` la describe como "fuente canónica de lectura de fuentes GR", y aplicar el fallback de forma consistente en ambas ramas es más predecible.

---

### Task 1: Crear la lib compartida

**Files:**
- Create: `shared/gr_su_sources.js`

- [ ] **Step 1: Escribir el archivo**

```js
/* ============================================================
   shared/gr_su_sources.js
   Normalización canónica de fuentes GR de una fila db[]/dg[]
   (formato nuevo grSources[] + formato legacy grLoteId/grTandaId/grUsados flat).
   Usada por GR (dg[]) y SU (db[]) — antes cada módulo mantenía su propia
   copia divergente (grNormSources en gr_app.js, suDbNormSources en su_app.js).
   Unificado 2026-07-10 tras auditoría que encontró comportamiento distinto
   entre ambas copias para entradas de grSources[] sin grLoteId propio.
   ============================================================ */
(function () {
  'use strict';

  /**
   * normalize(row, grLoteDefault)
   *   - Nuevo formato: itera row.grSources[] (array de { grLoteId, grTandaId, grUsados }),
   *     aplicando fallback a grLoteDefault si una entrada no trae grLoteId propio.
   *   - Legacy: usa campos flat row.grLoteId/row.grTandaId/row.grUsados, mismo fallback.
   *   Devuelve siempre un array (puede ser vacío) de { grLoteId, grTandaId, grUsados }.
   */
  function normalize(row, grLoteDefault) {
    if (!row || typeof row !== 'object') return [];
    var lo = grLoteDefault || '';
    if (Array.isArray(row.grSources) && row.grSources.length > 0) {
      return row.grSources
        .map(function (s) {
          return {
            grLoteId:  String((s && s.grLoteId)  || lo || '').trim() || null,
            grTandaId: String((s && s.grTandaId) || ''      ).trim() || null,
            grUsados:  parseInt(s && s.grUsados, 10) || 0,
          };
        })
        .filter(function (s) { return s.grLoteId && s.grTandaId; });
    }
    var loteId  = String(row.grLoteId  || lo             || '').trim() || null;
    var tandaId = String(row.grTandaId || row.grano || '').trim() || null;
    if (loteId && tandaId) {
      return [{ grLoteId: loteId, grTandaId: tandaId, grUsados: parseInt(row.grUsados, 10) || 0 }];
    }
    return [];
  }

  window.GrSuSources = Object.freeze({ normalize: normalize });
})();
```

- [ ] **Step 2: Chequeo de sintaxis**

Run: `node --check "shared/gr_su_sources.js"`
Expected: sin output.

- [ ] **Step 3: Commit**

```bash
git add shared/gr_su_sources.js
git commit -m "feat(shared): lib compartida gr_su_sources.js, unifica grNormSources/suDbNormSources"
```

---

### Task 2: Registrar el script en GR y SU, delegar ambas funciones

**Files:**
- Modify: `gr/gr_index.html`
- Modify: `su/su_index.html`
- Modify: `gr/gr_app.js:243-261`
- Modify: `su/su_app.js:2154-2172`

- [ ] **Step 1: Cargar el script en `gr_index.html`**

Buscar (el `<script>` de `ci_gr_links.js` ya presente — confirmar el texto exacto leyendo el archivo primero, agregar la línea nueva justo después):

```html
<script src="../shared/ci_gr_links.js"></script>
```

Reemplazar por:

```html
<script src="../shared/ci_gr_links.js"></script>
<script src="../shared/gr_su_sources.js"></script>
```

Si el `<script src="../shared/ci_gr_links.js">` no aparece en `gr_index.html` con ese texto exacto (puede tener atributos extra o estar en otra línea), leer el archivo y agregar `<script src="../shared/gr_su_sources.js"></script>` inmediatamente después de donde sea que se cargue `ci_gr_links.js`, manteniendo el mismo estilo de la línea existente.

- [ ] **Step 2: Cargar el script en `su_index.html`**

SU no carga `ci_gr_links.js` hoy (no lo necesita para eso). Buscar el `<script src="../su/su_app.js">` (o como se llame el script principal de SU) y agregar la carga de la lib compartida ANTES de ese script, mismo patrón que usa `shared/ing_store.js` en `index.html` raíz (cargar antes de que el módulo la necesite). Leer `su_index.html` para confirmar el texto exacto del script tag de `su_app.js` antes de editar.

- [ ] **Step 3: Reemplazar `grNormSources` en `gr_app.js` por un delegado**

Buscar:

```js
function grNormSources(r, grLoteDefault) {
    if (Array.isArray(r.grSources) && r.grSources.length > 0) {
        return r.grSources
            .map(function(s) {
                return {
                    grLoteId:  (String(s.grLoteId  || '').trim()) || null,
                    grTandaId: (String(s.grTandaId || '').trim()) || null,
                    grUsados:  parseInt(s.grUsados) || 0
                };
            })
            .filter(function(s) { return s.grLoteId && s.grTandaId; });
    }
    var loteId  = (String(r.grLoteId  || grLoteDefault || '').trim()) || null;
    var tandaId = (String(r.grTandaId || r.grano       || '').trim()) || null;
    if (loteId && tandaId) {
        return [{ grLoteId: loteId, grTandaId: tandaId, grUsados: parseInt(r.grUsados) || 0 }];
    }
    return [];
}
```

Reemplazar por:

```js
function grNormSources(r, grLoteDefault) {
    // Delegado a shared/gr_su_sources.js (unificado 2026-07-10, ver ese archivo
    // para la implementación real — antes esta función tenía su propia copia
    // divergente de la de SU).
    if (window.GrSuSources && typeof window.GrSuSources.normalize === 'function') {
        return window.GrSuSources.normalize(r, grLoteDefault);
    }
    // Fallback defensivo si la lib compartida no cargó por algún motivo.
    console.warn('[GR] GrSuSources no disponible, usando fallback local');
    if (!r || typeof r !== 'object') return [];
    var loteId  = (String(r.grLoteId || grLoteDefault || '').trim()) || null;
    var tandaId = (String(r.grTandaId || r.grano || '').trim()) || null;
    if (loteId && tandaId) return [{ grLoteId: loteId, grTandaId: tandaId, grUsados: parseInt(r.grUsados, 10) || 0 }];
    return [];
}
```

- [ ] **Step 4: Reemplazar `suDbNormSources` en `su_app.js` por un delegado**

Buscar:

```js
function suDbNormSources(row, grLoteDefault) {
    var lo = grLoteDefault || '';
    if (Array.isArray(row.grSources) && row.grSources.length > 0) {
        return row.grSources.map(function(s) {
            return {
                grLoteId:  String(s.grLoteId  || lo  || '').trim() || null,
                grTandaId: String(s.grTandaId || '').trim() || null,
                grUsados:  parseInt(s.grUsados) || 0
            };
        }).filter(function(s) { return s.grLoteId && s.grTandaId; });
    }
    // Fallback legacy: campos flat en la fila
    var loteId  = String(row.grLoteId  || lo  || '').trim() || null;
    var tandaId = String(row.grTandaId || row.grano || '').trim() || null;
    if (loteId && tandaId) {
        return [{ grLoteId: loteId, grTandaId: tandaId, grUsados: parseInt(row.grUsados) || 0 }];
    }
    return [];
}
window.suDbNormSources = suDbNormSources;
```

Reemplazar por:

```js
function suDbNormSources(row, grLoteDefault) {
    // Delegado a shared/gr_su_sources.js (unificado 2026-07-10, ver ese archivo
    // para la implementación real — antes esta función tenía su propia copia
    // divergente de la de GR).
    if (window.GrSuSources && typeof window.GrSuSources.normalize === 'function') {
        return window.GrSuSources.normalize(row, grLoteDefault);
    }
    // Fallback defensivo si la lib compartida no cargó por algún motivo.
    console.warn('[SU] GrSuSources no disponible, usando fallback local');
    var lo = grLoteDefault || '';
    if (!row || typeof row !== 'object') return [];
    var loteId  = String(row.grLoteId || lo || '').trim() || null;
    var tandaId = String(row.grTandaId || row.grano || '').trim() || null;
    if (loteId && tandaId) return [{ grLoteId: loteId, grTandaId: tandaId, grUsados: parseInt(row.grUsados, 10) || 0 }];
    return [];
}
window.suDbNormSources = suDbNormSources;
```

- [ ] **Step 5: Chequeo de sintaxis**

Run: `node --check "gr/gr_app.js"`
Run: `node --check "su/su_app.js"`
Expected: sin output en ninguno de los dos.

- [ ] **Step 6: Commit**

```bash
git add gr/gr_index.html su/su_index.html gr/gr_app.js su/su_app.js
git commit -m "refactor(gr,su): delegar grNormSources/suDbNormSources a shared/gr_su_sources.js"
```

---

### Task 3: QA manual

**Files:** ninguno

- [ ] **Step 1:** levantar `python serve.py` desde `biolab-app/`, abrir GR, confirmar en la consola del navegador que no aparece el warning `"[GR] GrSuSources no disponible"` (confirma que el script compartido cargó bien).
- [ ] **Step 2:** repetir en SU, confirmar que no aparece `"[SU] GrSuSources no disponible"`.
- [ ] **Step 3:** en GR, abrir un lote existente con tandas que tengan `grSources[]` (formato nuevo) y otro con campos legacy flat — confirmar que las fuentes se siguen mostrando igual que antes del cambio.
- [ ] **Step 4:** repetir en SU con un lote existente que tenga sub-tandas con `grSources[]`.
