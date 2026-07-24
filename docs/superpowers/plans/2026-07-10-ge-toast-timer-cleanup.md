# GE — Limpiar _toastTimer en onModuleUnload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar la violación confirmada de la Regla 3 ("todo timer registrado debe limpiarse en onModuleUnload") en GE — `_toastTimer` (un `setTimeout` de 2.6s) no está trackeado en el cleanup.

**Architecture:** Un solo cambio en `ge_app.js`: agregar `clearTimeout(_toastTimer)` al `onModuleUnload` existente, mismo patrón que ya usa `_keydownHandler` unas líneas arriba.

**Tech Stack:** Vanilla JS (IIFE). Sin test suite — verificación por `node --check`.

**Fuera de alcance (decisión explícita, no confundir con un olvido):** los listeners `keydown`/`blur` dinámicos de `inlineEditStart()` (líneas 1083-1087) NO se tocan en este plan. Están atados a un `<input>` efímero que se reemplaza en cada re-render del árbol (`labelEl.parentNode.replaceChild`) — al quedar el nodo desconectado del DOM sin otras referencias, el listener es candidato a GC junto con el elemento, sin fuga real. Trackearlos explícitamente requeriría restructurar `inlineEditStart` para exponer una referencia al input activo — cambio más grande para un riesgo práctico casi nulo. No hacerlo salvo que se pida explícitamente.

**Spec:** hallazgo de auditoría en `BIOLAB_SYSTEM.md` §11 ("GE — Regla 3 (listeners limpiados en onModuleUnload) — incompleta").

---

### Task 1: Trackear y limpiar `_toastTimer`

**Files:**
- Modify: `ge/ge_app.js:1744-1749`

- [ ] **Step 1: Agregar la limpieza del timer**

Buscar:

```js
  global.onModuleUnload = function () {
    if (_keydownHandler) {
      document.removeEventListener('keydown', _keydownHandler);
      _keydownHandler = null;
    }
  };
```

Reemplazar por:

```js
  global.onModuleUnload = function () {
    if (_keydownHandler) {
      document.removeEventListener('keydown', _keydownHandler);
      _keydownHandler = null;
    }
    if (_toastTimer) {
      clearTimeout(_toastTimer);
      _toastTimer = null;
    }
  };
```

**Nota:** `_toastTimer` ya está declarado con `let _toastTimer = null;` más arriba en el mismo archivo (línea 1094, sección "16. TOAST"), en el mismo scope de la IIFE que `onModuleUnload` — no hace falta declararlo de nuevo, solo referenciarlo.

- [ ] **Step 2: Chequeo de sintaxis**

Run: `node --check "ge/ge_app.js"`
Expected: sin output.

- [ ] **Step 3: Commit**

```bash
git add ge/ge_app.js
git commit -m "fix(ge): limpiar _toastTimer en onModuleUnload"
```

---

### Task 2: QA manual

**Files:** ninguno

- [ ] **Step 1:** levantar `python serve.py` desde `biolab-app/`, abrir GE, disparar cualquier acción que muestre un toast (ej. renombrar un nodo), cambiar de módulo ANTES de que pasen los 2.6s del toast.
- [ ] **Step 2:** confirmar en la consola del navegador que no hay ningún error ni warning relacionado a `toast`/`className` de un elemento inexistente después del cambio de módulo.
