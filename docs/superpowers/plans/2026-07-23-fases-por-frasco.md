# Fases del ciclo de cultivo aisladas por frasco — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `bl2_crec_fases` (fases del ciclo de cultivo) from being shared between frascos of the same `bl2_experimentos` experiment, and retroactively correct the 22 already-closed `bl2_crec` records whose `colonizacionDias`/penalty were computed from the wrong frasco's colonization date.

**Architecture:** Extend the storage key of `bl2_crec_fases` with an optional frasco discriminator (`expId`/`frascoLabel`), thread that context through every function that reads/writes fases (most already have `_sp.frasco` in scope as module state — no HTML/onclick changes needed), fix the two CI-source date lookups (`bl2_seg`) that also leak across frascos, then run a one-shot migration over `bl2_crec` reusing the now-fixed date resolution.

**Tech Stack:** Vanilla JS (IIFE module, `cilab/cilab_conocimiento.js`), `localStorage`. No build step, no test framework in this repo — verification uses standalone Node scripts (copy the exact function bodies + a tiny in-memory `localStorage` shim) per this project's established convention, run manually with `node`.

**Spec:** `docs/superpowers/specs/2026-07-23-fases-por-frasco-design.md`

---

## Before you start

All work happens in `c:\Users\JET\Desktop\MOBY DICK\biolab-app\cilab\cilab_conocimiento.js` (6133 lines, one big IIFE, closure-private helpers are **not** exposed on `window` — only handler functions are, via the `Object.assign(window, {...})` block at line ~6031). Because internal `_cre*` helpers aren't reachable from Node, every verification script in this plan is self-contained: it copies the exact function bodies under test into a scratch `.js` file alongside a minimal `localStorage` shim, then asserts against real numbers already extracted from production data (see spec, "Prueba de Metionina" / `CI-0006` / `EXP-0001`).

Put scratch scripts in `C:\Users\JET\AppData\Local\Temp\claude\c--Users-JET-Desktop-MOBY-DICK-biolab-app\72f23209-b636-4bed-831a-c12b68cb3805\scratchpad\` — never commit them.

Tasks 1-4 are pure-logic-plus-`localStorage` and get real TDD scripts. Tasks 5-9 are mechanical parameter-threading through DOM-coupled UI functions (`document.getElementById`, `_sp` module state) that can't run in Node — those are verified by exact `grep` checks (shown per task) plus the end-to-end script in Task 11. Task 10 (the retroactive migration) gets its own TDD script using the real Metionina numbers. This mixed strategy is intentional, not a shortcut — don't invent fake unit tests for DOM-dependent code.

**Reminder (project rule):** before running the retroactive migration (Task 10) against the real app, take a full backup (`⬇ Exportar todo` in CFG). Do this at the start of Task 12, not before.

---

### Task 1: Compound key for `bl2_crec_fases` — `_creFasesKey`/`_creFasesRead`/`_creFasesWrite`

**Files:**
- Modify: `cilab/cilab_conocimiento.js:3699-3716`
- Test: scratchpad `task1_fases_key.test.js`

- [ ] **Step 1: Write the failing test**

```js
// task1_fases_key.test.js
global.localStorage = (function() {
  var store = {};
  return {
    getItem: function(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function(k, v) { store[k] = String(v); },
  };
})();
var K_CREC_FASES = 'bl2_crec_fases';

function _creFasesKey(formulaId, geneticaId, frascoCtx) {
  return formulaId + '__' + (geneticaId || '_'); // OLD behavior, no frasco — will fail once we assert frasco-aware keys
}
function _creFasesRead(formulaId, geneticaId, frascoCtx) {
  try {
    var all = JSON.parse(localStorage.getItem(K_CREC_FASES)) || {};
    return all[_creFasesKey(formulaId, geneticaId, frascoCtx)] || [];
  } catch(e) { return []; }
}
function _creFasesWrite(formulaId, geneticaId, arr, frascoCtx) {
  try {
    var all = JSON.parse(localStorage.getItem(K_CREC_FASES)) || {};
    all[_creFasesKey(formulaId, geneticaId, frascoCtx)] = arr;
    localStorage.setItem(K_CREC_FASES, JSON.stringify(all));
  } catch(e) {}
}

// Two frascos, same cepa — must NOT collide
var frA = { expId: 'EXP-0001', frascoLabel: 'A' };
var frB = { expId: 'EXP-0001', frascoLabel: 'B' };
_creFasesWrite('CI-0006', 'NODE-X', [{ fase: 'inoculacion', dia: 0 }], frA);
_creFasesWrite('CI-0006', 'NODE-X', [{ fase: 'inoculacion', dia: 0 }, { fase: 'colonizacion_completa', dia: 17 }], frB);

var readA = _creFasesRead('CI-0006', 'NODE-X', frA);
var readB = _creFasesRead('CI-0006', 'NODE-X', frB);
var readBase = _creFasesRead('CI-0006', 'NODE-X', null); // no frasco — must be untouched/empty

console.log('readA.length === 1:', readA.length === 1);
console.log('readB.length === 2:', readB.length === 2);
console.log('readBase.length === 0:', readBase.length === 0);
console.log('key(frA) !== key(frB):', _creFasesKey('CI-0006', 'NODE-X', frA) !== _creFasesKey('CI-0006', 'NODE-X', frB));
console.log('key(null) === old format:', _creFasesKey('CI-0006', 'NODE-X', null) === 'CI-0006__NODE-X');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node task1_fases_key.test.js`
Expected: `readA.length === 1: false` and `readB.length === 2: false` (both currently read/write the same shared key, so `readA`/`readB` both end up with 2 entries — the bug, reproduced standalone) — `key(frA) !== key(frB): false`.

- [ ] **Step 3: Implement the fix**

In `cilab/cilab_conocimiento.js`, replace lines 3699-3716:

```js
function _creFasesKey(formulaId, geneticaId) {
  return formulaId + '__' + (geneticaId || '_');
}

function _creFasesRead(formulaId, geneticaId) {
  try {
    var all = JSON.parse(localStorage.getItem(K_CREC_FASES)) || {};
    return all[_creFasesKey(formulaId, geneticaId)] || [];
  } catch(e) { return []; }
}

function _creFasesWrite(formulaId, geneticaId, arr) {
  try {
    var all = JSON.parse(localStorage.getItem(K_CREC_FASES)) || {};
    all[_creFasesKey(formulaId, geneticaId)] = arr;
    localStorage.setItem(K_CREC_FASES, JSON.stringify(all));
  } catch(e) { console.warn('[CREC_FASES] write failed', e); }
}
```

with:

```js
function _creFasesKey(formulaId, geneticaId, frascoCtx) {
  var base = formulaId + '__' + (geneticaId || '_');
  return (frascoCtx && frascoCtx.expId)
    ? base + '__' + frascoCtx.expId + '__' + frascoCtx.frascoLabel
    : base;
}

function _creFasesRead(formulaId, geneticaId, frascoCtx) {
  try {
    var all = JSON.parse(localStorage.getItem(K_CREC_FASES)) || {};
    return all[_creFasesKey(formulaId, geneticaId, frascoCtx)] || [];
  } catch(e) { return []; }
}

function _creFasesWrite(formulaId, geneticaId, arr, frascoCtx) {
  try {
    var all = JSON.parse(localStorage.getItem(K_CREC_FASES)) || {};
    all[_creFasesKey(formulaId, geneticaId, frascoCtx)] = arr;
    localStorage.setItem(K_CREC_FASES, JSON.stringify(all));
  } catch(e) { console.warn('[CREC_FASES] write failed', e); }
}
```

Update the test script's inline copies of these 3 functions to match (remove the deliberately-wrong stub), and re-run.

- [ ] **Step 4: Run test to verify it passes**

Run: `node task1_fases_key.test.js`
Expected: all 5 lines print `true`.

- [ ] **Step 5: Commit**

```bash
git add cilab/cilab_conocimiento.js
git commit -m "fix(cilab): bl2_crec_fases key incluye frasco para no compartir estado entre frascos"
```

---

### Task 2: Frasco filter on CI-source date lookups — `_creGetColonizacionDate` + `_creInoculacionDate`

**Files:**
- Modify: `cilab/cilab_conocimiento.js:3341-3357` (`_creGetColonizacionDate`)
- Modify: `cilab/cilab_conocimiento.js:3718-3743` (`_creInoculacionDate`)
- Test: scratchpad `task2_ci_dates.test.js`

**Context:** `bl2_seg` rows already carry `experimentoId`/`experimentoFrascoId` per tanda (used today in `_creGetCepasForFrasco`). These two functions read `bl2_seg`/`bl2_crec` without that filter — same bug, different source. Real data (Metionina, cepa `NODE-MO9I0NCNVKPQ`): Frasco A tanda has `inoculoTs: "2026-05-08T05:30:38.745Z"`, `colonizacion: "2026-05-25T21:21"`; Frasco B tanda has `inoculoTs: "2026-05-08T05:30:42.476Z"`, `colonizacion: "2026-05-30T21:22"`.

- [ ] **Step 1: Write the failing test**

```js
// task2_ci_dates.test.js
global.localStorage = (function() {
  var store = {};
  return {
    getItem: function(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function(k, v) { store[k] = String(v); },
  };
})();

var segs = [
  { formula_id: 'CI-0006', genetica: 'NODE-MO9I0NCNVKPQ', experimentoId: 'EXP-0001', experimentoFrascoId: 'A', inoculoTs: '2026-05-08T05:30:38.745Z', colonizacion: '2026-05-25T21:21' },
  { formula_id: 'CI-0006', genetica: 'NODE-MO9I0NCNVKPQ', experimentoId: 'EXP-0001', experimentoFrascoId: 'B', inoculoTs: '2026-05-08T05:30:42.476Z', colonizacion: '2026-05-30T21:22' },
];
localStorage.setItem('bl2_seg', JSON.stringify(segs));
localStorage.setItem('bl2_forms', JSON.stringify([])); // no fecha de fórmula — fuerza tier 3
localStorage.setItem('bl2_crec', JSON.stringify([]));

function gArr(k) { try { return JSON.parse(localStorage.getItem(k)) || []; } catch(e) { return []; } }
function _creGetInoculacionDate(formulaId, geneticaId) { // tier 2 — sin cambios, no depende de frasco
  var forms = gArr('bl2_forms');
  var f = forms.find(function(x) { return x.id === formulaId; });
  if (f && f.fecha) return new Date(f.fecha).toISOString().slice(0, 10);
  return null;
}

// PASTE the real _creGetColonizacionDate and _creInoculacionDate bodies here (post-fix, from Step 3)
// then exercise with frCtxA / frCtxB:

var frA = { expId: 'EXP-0001', frascoLabel: 'A' };
var frB = { expId: 'EXP-0001', frascoLabel: 'B' };

var colA = _creGetColonizacionDate('CI-0006', 'NODE-MO9I0NCNVKPQ', frA);
var colB = _creGetColonizacionDate('CI-0006', 'NODE-MO9I0NCNVKPQ', frB);
console.log('colA starts with 2026-05-25:', /^2026-05-25/.test(colA));
console.log('colB starts with 2026-05-30:', /^2026-05-30/.test(colB));
console.log('colA !== colB:', colA !== colB);

var inocA = _creInoculacionDate('CI-0006', 'NODE-MO9I0NCNVKPQ', frA);
var inocB = _creInoculacionDate('CI-0006', 'NODE-MO9I0NCNVKPQ', frB);
console.log('inocA === 2026-05-08:', inocA === '2026-05-08');
console.log('inocB === 2026-05-08:', inocB === '2026-05-08'); // same day here, but resolved independently per frasco
```

- [ ] **Step 2: Run test to verify it fails**

First paste the CURRENT (unfixed) bodies of `_creGetColonizacionDate`/`_creInoculacionDate` (they ignore the 3rd arg entirely — copy them verbatim from the file right now, before editing). Run: `node task2_ci_dates.test.js`.
Expected: `colA` and `colB` are equal (both resolve to the latest colonization across both tandas — `2026-05-30...`), so `colA starts with 2026-05-25: false` and `colA !== colB: false`.

- [ ] **Step 3: Implement the fix**

In `cilab/cilab_conocimiento.js`, replace lines 3341-3357:

```js
function _creGetColonizacionDate(formulaId, geneticaId) {
  if (!formulaId || !geneticaId) return null;
  try {
    var inocDate = _creGetInoculacionDate(formulaId, geneticaId);
    var segs = JSON.parse(localStorage.getItem('bl2_seg')) || [];
    var dates = segs
      .filter(function(s) {
        if (s.formula_id !== formulaId || s.genetica !== geneticaId || !s.colonizacion) return false;
        // Only accept colonización that is after the formula's inoculación date
        if (inocDate && s.colonizacion < inocDate) return false;
        return true;
      })
      .map(function(s) { return s.colonizacion; })
      .sort();
    return dates.length ? dates[dates.length - 1] : null;
  } catch(e) { return null; }
}
```

with:

```js
function _creGetColonizacionDate(formulaId, geneticaId, frascoCtx) {
  if (!formulaId || !geneticaId) return null;
  try {
    var inocDate = _creGetInoculacionDate(formulaId, geneticaId);
    var segs = JSON.parse(localStorage.getItem('bl2_seg')) || [];
    var dates = segs
      .filter(function(s) {
        if (s.formula_id !== formulaId || s.genetica !== geneticaId || !s.colonizacion) return false;
        // Only accept colonización that is after the formula's inoculación date
        if (inocDate && s.colonizacion < inocDate) return false;
        if (frascoCtx && frascoCtx.expId) {
          if (s.experimentoId !== frascoCtx.expId || s.experimentoFrascoId !== frascoCtx.frascoLabel) return false;
        }
        return true;
      })
      .map(function(s) { return s.colonizacion; })
      .sort();
    return dates.length ? dates[dates.length - 1] : null;
  } catch(e) { return null; }
}
```

Replace lines 3718-3743:

```js
function _creInoculacionDate(formulaId, geneticaId) {
  // 1. Fase inoculación registrada manualmente en CRE — fuente de verdad
  var fases = _creFasesRead(formulaId, geneticaId);
  var fi = fases.find(function(f) { return f.fase === 'inoculacion'; });
  if (fi && fi.fecha) return fi.fecha;
  // 2. bl2_forms.fecha (fecha global de la fórmula)
  var d = _creGetInoculacionDate(formulaId, geneticaId);
  if (d) return d;
  // 3. bl2_seg.inoculoTs — timestamp por tanda en CI (campo real del módulo CI)
  try {
    var segs = JSON.parse(localStorage.getItem('bl2_seg')) || [];
    var matching = segs.filter(function(s) {
      return s.formula_id === formulaId && s.genetica === geneticaId && s.inoculoTs;
    });
    if (matching.length > 0) {
      var earliest = matching.reduce(function(min, s) {
        return s.inoculoTs < min ? s.inoculoTs : min;
      }, matching[0].inoculoTs);
      return new Date(earliest).toISOString().slice(0, 10);
    }
  } catch(e) {}
  // 4. CRERecord.inoculationDate (legacy — para records existentes pre-borrado)
  var recs = gArr('bl2_crec');
  var rec = recs.find(function(r) { return r.formulaId === formulaId && r.geneticaId === geneticaId && r.inoculationDate; });
  return rec ? rec.inoculationDate : null;
}
```

with:

```js
function _creInoculacionDate(formulaId, geneticaId, frascoCtx) {
  // 1. Fase inoculación registrada manualmente en CRE — fuente de verdad (por frasco si aplica)
  var fases = _creFasesRead(formulaId, geneticaId, frascoCtx);
  var fi = fases.find(function(f) { return f.fase === 'inoculacion'; });
  if (fi && fi.fecha) return fi.fecha;
  // 2. bl2_forms.fecha (fecha global de la fórmula — no tiene noción de frasco, se deja igual)
  var d = _creGetInoculacionDate(formulaId, geneticaId);
  if (d) return d;
  // 3. bl2_seg.inoculoTs — timestamp por tanda en CI (campo real del módulo CI)
  try {
    var segs = JSON.parse(localStorage.getItem('bl2_seg')) || [];
    var matching = segs.filter(function(s) {
      if (s.formula_id !== formulaId || s.genetica !== geneticaId || !s.inoculoTs) return false;
      if (frascoCtx && frascoCtx.expId) {
        if (s.experimentoId !== frascoCtx.expId || s.experimentoFrascoId !== frascoCtx.frascoLabel) return false;
      }
      return true;
    });
    if (matching.length > 0) {
      var earliest = matching.reduce(function(min, s) {
        return s.inoculoTs < min ? s.inoculoTs : min;
      }, matching[0].inoculoTs);
      return new Date(earliest).toISOString().slice(0, 10);
    }
  } catch(e) {}
  // 4. CRERecord.inoculationDate (legacy — para records existentes pre-borrado)
  var recs = gArr('bl2_crec');
  var rec = recs.find(function(r) {
    if (r.formulaId !== formulaId || r.geneticaId !== geneticaId || !r.inoculationDate) return false;
    if (frascoCtx && frascoCtx.expId) {
      if (r.experimentoId !== frascoCtx.expId || r.frascoId !== frascoCtx.frascoLabel) return false;
    }
    return true;
  });
  return rec ? rec.inoculationDate : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Paste the fixed bodies into the test script, run `node task2_ci_dates.test.js`.
Expected: all 5 lines print `true`.

- [ ] **Step 5: Commit**

```bash
git add cilab/cilab_conocimiento.js
git commit -m "fix(cilab): _creGetColonizacionDate y _creInoculacionDate filtran por frasco en bl2_seg/bl2_crec"
```

---

### Task 3: `_creColonizacionStats` + `_creCalcCompound` accept `frascoCtx`

**Files:**
- Modify: `cilab/cilab_conocimiento.js:3359-3368` (`_creColonizacionStats`)
- Modify: `cilab/cilab_conocimiento.js:4792-4806` (`_creCalcCompound`)
- Test: scratchpad `task3_compound.test.js`

**Context:** `_creCalcCompound` is what actually produces the number frozen into `scoreCompuesto`/`obs.scoreCompuesto`. It currently calls `_creColonizacionStats(formulaId, geneticaId)` internally with no frasco — this is the exact function that produced the wrong 24-day penalty for both Frasco A and B in "Prueba de Metionina".

- [ ] **Step 1: Write the failing test**

```js
// task3_compound.test.js
global.localStorage = (function() {
  var store = {};
  return {
    getItem: function(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function(k, v) { store[k] = String(v); },
  };
})();
var K_CREC_FASES = 'bl2_crec_fases';
// PASTE fixed _creFasesKey/_creFasesRead/_creFasesWrite from Task 1 here.

// Seed: Frasco A colonized day 17, Frasco B day 22 (already-computed real deltas from Metionina)
var frA = { expId: 'EXP-0001', frascoLabel: 'A' };
var frB = { expId: 'EXP-0001', frascoLabel: 'B' };
_creFasesWrite('CI-0006', 'NODE-X', [{ fase: 'colonizacion_completa', dia: 17 }], frA);
_creFasesWrite('CI-0006', 'NODE-X', [{ fase: 'colonizacion_completa', dia: 22 }], frB);

// PASTE _creColonizacionStats (with frascoCtx param) and _creEffectivePenalty (unchanged) and
// _creCalcCompound (with frascoCtx param) here from Step 3.

var statsA = _creColonizacionStats('CI-0006', 'NODE-X', frA);
var statsB = _creColonizacionStats('CI-0006', 'NODE-X', frB);
console.log('statsA.dias === 17:', statsA.dias === 17);
console.log('statsA.penalty === 0.5:', statsA.penalty === 0.5);
console.log('statsB.dias === 22:', statsB.dias === 22);
console.log('statsB.penalty === 1.75:', statsB.penalty === 1.75);

// score 6.9, sin rizo (base = score tal cual) — igual que CRE-0027 real
var compA = _creCalcCompound(6.9, null, null, 'CI-0006', 'NODE-X', frA);
var compB = _creCalcCompound(3.8, null, null, 'CI-0006', 'NODE-X', frB);
console.log('compA === 6.4:', compA === 6.4);   // 6.9 - 0.5
console.log('compB === 2.0:', compB === 2.0);   // 3.8 - 1.75: en IEEE 754 da 2.0499999999999998, no 2.05 exacto — toFixed(1) redondea a "2.0", no "2.1"
```

- [ ] **Step 2: Run test to verify it fails**

Paste the CURRENT (unfixed, no `frascoCtx` param) bodies first. Run: `node task3_compound.test.js`.
Expected: `statsA.dias === 17: false` (both resolve to whichever key `_creColonizacionStats('CI-0006','NODE-X')` — no frasco — happens to hit; since neither write used the plain key, `statsA`/`statsB` will both be `{dias: null, penalty: 0}`, so multiple lines print `false`).

- [ ] **Step 3: Implement the fix**

Replace lines 3359-3368:

```js
function _creColonizacionStats(formulaId, geneticaId) {
  // Usa el campo `dia` pre-calculado al registrar la fase — sin aritmética de fechas,
  // sin bl2_seg. Si no hay colonización registrada en CILAB, sin penalidad.
  var fases = _creFasesRead(formulaId, geneticaId);
  var fc = fases.find(function(f) { return f.fase === 'colonizacion_completa'; });
  if (!fc || fc.dia == null) return { dias: null, penalty: 0 };
  var dias  = fc.dia;
  var extra = Math.max(0, dias - 15);
  return { dias: dias, penalty: Math.min(3, +(extra * 0.25).toFixed(2)) };
}
```

with:

```js
function _creColonizacionStats(formulaId, geneticaId, frascoCtx) {
  // Usa el campo `dia` pre-calculado al registrar la fase — sin aritmética de fechas,
  // sin bl2_seg. Si no hay colonización registrada en CILAB, sin penalidad.
  var fases = _creFasesRead(formulaId, geneticaId, frascoCtx);
  var fc = fases.find(function(f) { return f.fase === 'colonizacion_completa'; });
  if (!fc || fc.dia == null) return { dias: null, penalty: 0 };
  var dias  = fc.dia;
  var extra = Math.max(0, dias - 15);
  return { dias: dias, penalty: Math.min(3, +(extra * 0.25).toFixed(2)) };
}
```

Replace lines 4792-4806:

```js
function _creCalcCompound(score, rizo, total, formulaId, geneticaId) {
  if (score == null) return null;
  var rizoRatio = (rizo != null && total != null && total > 0) ? (rizo / total) : null;
  var base = rizoRatio != null ? score * (0.9 + 0.1 * rizoRatio) : score;
  var stats = _creColonizacionStats(formulaId, geneticaId);
  // Decisión 2026-07-22: la colonización lenta SIEMPRE penaliza, tenga el
  // score que tenga — antes se perdonaba entero con score≥7 ("rizomórfico
  // compensa"), pero un resultado lento sigue costando tiempo real de lab
  // aunque termine rizomórfico. Se atenúa (no se anula) cuando la incidencia
  // rizomórfica es alta: _creEffectivePenalty ya traía esa lógica gradual
  // (perdón progresivo de 70% a 100% de incidencia) pero quedaba
  // inalcanzable en la práctica al estar detrás de este mismo corte binario.
  var penalty = _creEffectivePenalty(stats.penalty || 0, rizoRatio);
  return +Math.max(0, base - penalty).toFixed(1);
}
```

with:

```js
function _creCalcCompound(score, rizo, total, formulaId, geneticaId, frascoCtx) {
  if (score == null) return null;
  var rizoRatio = (rizo != null && total != null && total > 0) ? (rizo / total) : null;
  var base = rizoRatio != null ? score * (0.9 + 0.1 * rizoRatio) : score;
  var stats = _creColonizacionStats(formulaId, geneticaId, frascoCtx);
  // Decisión 2026-07-22: la colonización lenta SIEMPRE penaliza, tenga el
  // score que tenga — antes se perdonaba entero con score≥7 ("rizomórfico
  // compensa"), pero un resultado lento sigue costando tiempo real de lab
  // aunque termine rizomórfico. Se atenúa (no se anula) cuando la incidencia
  // rizomórfica es alta: _creEffectivePenalty ya traía esa lógica gradual
  // (perdón progresivo de 70% a 100% de incidencia) pero quedaba
  // inalcanzable en la práctica al estar detrás de este mismo corte binario.
  var penalty = _creEffectivePenalty(stats.penalty || 0, rizoRatio);
  return +Math.max(0, base - penalty).toFixed(1);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node task3_compound.test.js`
Expected: all 6 lines print `true`.

- [ ] **Step 5: Commit**

```bash
git add cilab/cilab_conocimiento.js
git commit -m "fix(cilab): _creColonizacionStats y _creCalcCompound aceptan frascoCtx"
```

---

### Task 4: Thread `frascoCtx` through the autofill/date-orchestration chain

**Files:**
- Modify: `cilab/cilab_conocimiento.js:3745-3753` (`_creAutoFillInoculacion`)
- Modify: `cilab/cilab_conocimiento.js:3755-3785` (`_creAutoFillColonizacion`)
- Modify: `cilab/cilab_conocimiento.js:3790-3810` (`_creAutoFillInferredFases`)
- Modify: `cilab/cilab_conocimiento.js:3812-3818` (`_creDiasSinceInoc`)
- Modify: `cilab/cilab_conocimiento.js:3822-3854` (`_creTemporalZoneFase`)

No standalone test for this task alone — these are pure orchestration over Tasks 1-3's now-frasco-aware primitives; Task 11's end-to-end script covers the full chain. Verify each edit by grepping for the old (pre-edit) signature immediately after — 0 matches means done.

- [ ] **Step 1: `_creAutoFillInoculacion`** — replace lines 3745-3753:

```js
function _creAutoFillInoculacion(formulaId, geneticaId) {
  if (_creIsCleared(formulaId)) return;
  var fases = _creFasesRead(formulaId, geneticaId);
  if (fases.some(function(f) { return f.fase === 'inoculacion'; })) return;
  var inocDate = _creInoculacionDate(formulaId, geneticaId);
  if (!inocDate) return;
  fases.unshift({ fase: 'inoculacion', dia: 0, fecha: inocDate, ts: now(), auto: true });
  _creFasesWrite(formulaId, geneticaId, fases);
}
```

with:

```js
function _creAutoFillInoculacion(formulaId, geneticaId, frascoCtx) {
  if (_creIsCleared(formulaId)) return;
  var fases = _creFasesRead(formulaId, geneticaId, frascoCtx);
  if (fases.some(function(f) { return f.fase === 'inoculacion'; })) return;
  var inocDate = _creInoculacionDate(formulaId, geneticaId, frascoCtx);
  if (!inocDate) return;
  fases.unshift({ fase: 'inoculacion', dia: 0, fecha: inocDate, ts: now(), auto: true });
  _creFasesWrite(formulaId, geneticaId, fases, frascoCtx);
}
```

- [ ] **Step 2: `_creAutoFillColonizacion`** — replace lines 3755-3785:

```js
function _creAutoFillColonizacion(formulaId, geneticaId) {
  if (_creIsCleared(formulaId)) return;
  var fases = _creFasesRead(formulaId, geneticaId);
  var inocDate = _creInoculacionDate(formulaId, geneticaId);
  // Remove any auto-filled colonizacion that predates inoculación (bad CI data)
  if (inocDate) {
    var cleaned = fases.filter(function(f) {
      if (f.fase !== 'colonizacion_completa' || f.auto !== true) return true;
      if (!f.fecha) return true;
      return f.fecha >= inocDate;
    });
    if (cleaned.length !== fases.length) {
      _creFasesWrite(formulaId, geneticaId, cleaned);
      fases = cleaned;
    }
  }
  if (fases.some(function(f) { return f.fase === 'colonizacion_completa'; })) return;
  var colonDate = _creGetColonizacionDate(formulaId, geneticaId);
  if (!colonDate) return;
  var inocDate = _creInoculacionDate(formulaId, geneticaId);
  var dia = null;
  if (inocDate) {
    var d0 = new Date(inocDate); d0.setHours(0,0,0,0);
    var d1 = new Date(colonDate); d1.setHours(0,0,0,0);
    var rawDia = Math.floor((d1 - d0) / 86400000);
    if (rawDia < 0) return; // CI date precedes CRE inoculación — skip, data inconsistent
    dia = rawDia;
  }
  fases.push({ fase: 'colonizacion_completa', dia: dia, fecha: colonDate, ts: now(), auto: true });
  _creFasesWrite(formulaId, geneticaId, fases);
}
```

with:

```js
function _creAutoFillColonizacion(formulaId, geneticaId, frascoCtx) {
  if (_creIsCleared(formulaId)) return;
  var fases = _creFasesRead(formulaId, geneticaId, frascoCtx);
  var inocDate = _creInoculacionDate(formulaId, geneticaId, frascoCtx);
  // Remove any auto-filled colonizacion that predates inoculación (bad CI data)
  if (inocDate) {
    var cleaned = fases.filter(function(f) {
      if (f.fase !== 'colonizacion_completa' || f.auto !== true) return true;
      if (!f.fecha) return true;
      return f.fecha >= inocDate;
    });
    if (cleaned.length !== fases.length) {
      _creFasesWrite(formulaId, geneticaId, cleaned, frascoCtx);
      fases = cleaned;
    }
  }
  if (fases.some(function(f) { return f.fase === 'colonizacion_completa'; })) return;
  var colonDate = _creGetColonizacionDate(formulaId, geneticaId, frascoCtx);
  if (!colonDate) return;
  var inocDate = _creInoculacionDate(formulaId, geneticaId, frascoCtx);
  var dia = null;
  if (inocDate) {
    var d0 = new Date(inocDate); d0.setHours(0,0,0,0);
    var d1 = new Date(colonDate); d1.setHours(0,0,0,0);
    var rawDia = Math.floor((d1 - d0) / 86400000);
    if (rawDia < 0) return; // CI date precedes CRE inoculación — skip, data inconsistent
    dia = rawDia;
  }
  fases.push({ fase: 'colonizacion_completa', dia: dia, fecha: colonDate, ts: now(), auto: true });
  _creFasesWrite(formulaId, geneticaId, fases, frascoCtx);
}
```

- [ ] **Step 3: `_creAutoFillInferredFases`** — replace lines 3790-3810:

```js
function _creAutoFillInferredFases(formulaId, geneticaId) {
  if (_creIsCleared(formulaId)) return;
  var diasElapsed = _creDiasSinceInoc(formulaId, geneticaId);
  if (diasElapsed == null) return;
  var fases = _creFasesRead(formulaId, geneticaId);
  var regMap = {};
  fases.forEach(function(f) { regMap[f.fase] = f; });
  var order = _FASES_DEF.map(function(d) { return d.id; });
  var changed = false;
  _FASES_DEF.forEach(function(def) {
    if (def.id === 'inoculacion' || def.id === 'colonizacion_completa') return;
    if (regMap[def.id]) return;
    if (diasElapsed < def.typicalDay) return;
    fases.push({ fase: def.id, dia: def.typicalDay, fecha: null, ts: now(), auto: 'inferred' });
    changed = true;
  });
  if (changed) {
    fases.sort(function(a, b) { return order.indexOf(a.fase) - order.indexOf(b.fase); });
    _creFasesWrite(formulaId, geneticaId, fases);
  }
}
```

with:

```js
function _creAutoFillInferredFases(formulaId, geneticaId, frascoCtx) {
  if (_creIsCleared(formulaId)) return;
  var diasElapsed = _creDiasSinceInoc(formulaId, geneticaId, frascoCtx);
  if (diasElapsed == null) return;
  var fases = _creFasesRead(formulaId, geneticaId, frascoCtx);
  var regMap = {};
  fases.forEach(function(f) { regMap[f.fase] = f; });
  var order = _FASES_DEF.map(function(d) { return d.id; });
  var changed = false;
  _FASES_DEF.forEach(function(def) {
    if (def.id === 'inoculacion' || def.id === 'colonizacion_completa') return;
    if (regMap[def.id]) return;
    if (diasElapsed < def.typicalDay) return;
    fases.push({ fase: def.id, dia: def.typicalDay, fecha: null, ts: now(), auto: 'inferred' });
    changed = true;
  });
  if (changed) {
    fases.sort(function(a, b) { return order.indexOf(a.fase) - order.indexOf(b.fase); });
    _creFasesWrite(formulaId, geneticaId, fases, frascoCtx);
  }
}
```

- [ ] **Step 4: `_creDiasSinceInoc`** — replace lines 3812-3818:

```js
function _creDiasSinceInoc(formulaId, geneticaId) {
  var inocDate = _creInoculacionDate(formulaId, geneticaId);
  if (!inocDate) return null;
  var d0 = new Date(inocDate); d0.setHours(0,0,0,0);
  var d1 = new Date();         d1.setHours(0,0,0,0);
  return Math.max(0, Math.floor((d1 - d0) / 86400000));
}
```

with:

```js
function _creDiasSinceInoc(formulaId, geneticaId, frascoCtx) {
  var inocDate = _creInoculacionDate(formulaId, geneticaId, frascoCtx);
  if (!inocDate) return null;
  var d0 = new Date(inocDate); d0.setHours(0,0,0,0);
  var d1 = new Date();         d1.setHours(0,0,0,0);
  return Math.max(0, Math.floor((d1 - d0) / 86400000));
}
```

- [ ] **Step 5: `_creTemporalZoneFase`** — replace lines 3822-3854 (only the signature and the two internal calls change; the rest of the body is untouched):

```js
function _creTemporalZoneFase(formulaId, geneticaId) {
  var fases = _creFasesRead(formulaId, geneticaId);
  var regMap = {};
  fases.forEach(function(f) { regMap[f.fase] = f; });
  var diasElapsed = _creDiasSinceInoc(formulaId, geneticaId);
```

with:

```js
function _creTemporalZoneFase(formulaId, geneticaId, frascoCtx) {
  var fases = _creFasesRead(formulaId, geneticaId, frascoCtx);
  var regMap = {};
  fases.forEach(function(f) { regMap[f.fase] = f; });
  var diasElapsed = _creDiasSinceInoc(formulaId, geneticaId, frascoCtx);
```

(leave the rest of the function, lines ~3829-3854, exactly as-is — no other reference to frasco needed there).

- [ ] **Step 6: Verify no stale call sites within this cluster**

Run: `grep -n "_creAutoFillInoculacion(formulaId, geneticaId)\|_creAutoFillColonizacion(formulaId, geneticaId)\|_creAutoFillInferredFases(formulaId, geneticaId)\|_creDiasSinceInoc(formulaId, geneticaId)" cilab/cilab_conocimiento.js`
Expected: 0 matches (all internal recursive calls within these 5 functions now pass `frascoCtx` — only external callers, fixed in later tasks, still look like this until then).

- [ ] **Step 7: Commit**

```bash
git add cilab/cilab_conocimiento.js
git commit -m "fix(cilab): autofill de fases y calculo de dias/zona temporal propagan frascoCtx"
```

---

### Task 5: Fix the root seeding loop in `creOpenScoringPanel`

**Files:**
- Modify: `cilab/cilab_conocimiento.js:4817-4823`

**Context:** This is the actual root cause of the 18 contaminated combinations found in production. Every time the scoring panel opens, this loop runs `_creAutoFillInoculacion`/`_creAutoFillColonizacion` for **every cepa of the formula, unconditionally, before `_sp.frasco` is even set** (that happens later, at line 4835) — writing into the shared/base key regardless of which frasco each cepa actually belongs to.

- [ ] **Step 1: Replace lines 4817-4823**

```js
  // Importar fases de CI → bl2_crec_fases para todas las cepas de esta fórmula.
  // Operación idempotente: solo escribe si el dato no existe ya. CILAB queda autónomo.
  var _allCepasForImport = _creGetCepasForFormula(formulaId);
  _allCepasForImport.forEach(function(c) {
    _creAutoFillInoculacion(formulaId, c.id);
    _creAutoFillColonizacion(formulaId, c.id);
  });
```

with:

```js
  // Importar fases de CI → bl2_crec_fases para todas las cepas de esta fórmula.
  // Operación idempotente: solo escribe si el dato no existe ya. CILAB queda autónomo.
  // Si la fórmula tiene experimentos multi-frasco, se importa POR FRASCO (cada uno
  // con su propia key vía frascoCtx) — antes de este fix se importaba una sola vez
  // sin frasco, sembrando la key compartida que contaminaba todos los frascos por igual.
  var _frsForImport = _creGetFrascosForFormula(formulaId);
  if (_frsForImport.length > 0) {
    _frsForImport.forEach(function(fr) {
      var frCtxImport = { expId: fr.expId, frascoLabel: fr.frascoLabel };
      var cepasFr = _creGetCepasForFrasco(formulaId, fr.expId, fr.frascoLabel);
      cepasFr.forEach(function(c) {
        _creAutoFillInoculacion(formulaId, c.id, frCtxImport);
        _creAutoFillColonizacion(formulaId, c.id, frCtxImport);
      });
    });
  } else {
    var _allCepasForImport = _creGetCepasForFormula(formulaId);
    _allCepasForImport.forEach(function(c) {
      _creAutoFillInoculacion(formulaId, c.id);
      _creAutoFillColonizacion(formulaId, c.id);
    });
  }
```

Note: `_creGetFrascosForFormula` is defined at line 2893 (returns `[]` if the formula has no experiments) and `_creGetCepasForFrasco` at line 2918 — both already exist and are unchanged by this plan.

- [ ] **Step 2: Manual verification (no Node script — needs real `bl2_experimentos`/`bl2_seg`)**

Run: `grep -n "_creAutoFillInoculacion(formulaId, c.id)\|_creAutoFillColonizacion(formulaId, c.id)" cilab/cilab_conocimiento.js`
Expected: exactly 2 matches, both inside the `else` branch just added (the no-experiment fallback) — confirms the frasco-aware branch is the one that runs whenever `_frsForImport.length > 0`.

- [ ] **Step 3: Commit**

```bash
git add cilab/cilab_conocimiento.js
git commit -m "fix(cilab): creOpenScoringPanel importa fases de CI por frasco, no en una key compartida"
```

---

### Task 6: Thread `_sp.frasco` through the interactive fases grid

**Files:**
- Modify: `cilab/cilab_conocimiento.js:5292-5589` (`_creFaseRegisterNow`, `creFaseEditSave`, `creFaseDeleteConfirm`, `_creFaseEditStripHTML`, `_creFasesGridHTML`, `creFaseGridClick`, `_creBatchFaseRegisterNow`, `_creBatchFasesGridHTML`)

All of these already execute while `_sp.frasco` holds the active tab's context (module-level state, set in `creOpenScoringPanel`/`creSelectFrascoTab`, read here — no need to add it to any `onclick` string in the generated HTML).

- [ ] **Step 1: `_creFaseRegisterNow`** — in the body (lines 5292-5331), update the 3 internal calls that currently omit frasco:

Replace:
```js
function _creFaseRegisterNow(formulaId, geneticaId, faseId) {
  _creLiftCleared(formulaId);
  var fases    = _creFasesRead(formulaId, geneticaId);
```
with:
```js
function _creFaseRegisterNow(formulaId, geneticaId, faseId) {
  _creLiftCleared(formulaId);
  var fases    = _creFasesRead(formulaId, geneticaId, _sp.frasco);
```

Replace:
```js
    var inocDate = _creInoculacionDate(formulaId, geneticaId);
    var dia = 0;
    if (inocDate) {
      var d0 = new Date(inocDate); d0.setHours(0, 0, 0, 0);
      var d1 = new Date(todayIso); d1.setHours(0, 0, 0, 0);
      dia = Math.max(0, Math.floor((d1 - d0) / 86400000));
    }
    entry = { fase: faseId, dia: dia, fecha: todayIso, ts: tsNow };
```
with:
```js
    var inocDate = _creInoculacionDate(formulaId, geneticaId, _sp.frasco);
    var dia = 0;
    if (inocDate) {
      var d0 = new Date(inocDate); d0.setHours(0, 0, 0, 0);
      var d1 = new Date(todayIso); d1.setHours(0, 0, 0, 0);
      dia = Math.max(0, Math.floor((d1 - d0) / 86400000));
    }
    entry = { fase: faseId, dia: dia, fecha: todayIso, ts: tsNow };
```

Replace:
```js
  fases.sort(function(a, b) { return order.indexOf(a.fase) - order.indexOf(b.fase); });
  _creFasesWrite(formulaId, geneticaId, fases);
  _creLogFase(formulaId, geneticaId, faseId, entry.dia, entry.fecha, false, _sp.frasco);
```
with:
```js
  fases.sort(function(a, b) { return order.indexOf(a.fase) - order.indexOf(b.fase); });
  _creFasesWrite(formulaId, geneticaId, fases, _sp.frasco);
  _creLogFase(formulaId, geneticaId, faseId, entry.dia, entry.fecha, false, _sp.frasco);
```

(the `_creGetPlacasFromCI(formulaId, geneticaId, _fCtxR ? _fCtxR.expId : null, _fCtxR ? _fCtxR.frascoLabel : null)` call a few lines above already receives frasco correctly — no change needed there.)

- [ ] **Step 2: `creFaseEditSave`** — replace the two `_creFasesRead`/`_creInoculacionDate`/`_creFasesWrite` calls:

Replace:
```js
  var fases = _creFasesRead(formulaId, geneticaId);
  var reg = fases.find(function(f) { return f.fase === faseId; });
  if (!reg) return;
```
with:
```js
  var fases = _creFasesRead(formulaId, geneticaId, _sp.frasco);
  var reg = fases.find(function(f) { return f.fase === faseId; });
  if (!reg) return;
```

Replace (inside the `else` branch, non-inoculación case):
```js
    var inocDate = _creInoculacionDate(formulaId, geneticaId);
    var dia = 0;
    if (inocDate) {
      var d0 = new Date(inocDate); d0.setHours(0, 0, 0, 0);
      var d1 = new Date(fechaStr); d1.setHours(0, 0, 0, 0);
      dia = Math.max(0, Math.floor((d1 - d0) / 86400000));
    }
    reg.fecha = fechaStr;
```
with:
```js
    var inocDate = _creInoculacionDate(formulaId, geneticaId, _sp.frasco);
    var dia = 0;
    if (inocDate) {
      var d0 = new Date(inocDate); d0.setHours(0, 0, 0, 0);
      var d1 = new Date(fechaStr); d1.setHours(0, 0, 0, 0);
      dia = Math.max(0, Math.floor((d1 - d0) / 86400000));
    }
    reg.fecha = fechaStr;
```

Replace:
```js
  _creFasesWrite(formulaId, geneticaId, fases);
  var edited = fases.find(function(f) { return f.fase === faseId; });
  _creLogFase(formulaId, geneticaId, faseId, edited ? edited.dia : 0, edited ? edited.fecha : fechaStr, true, _sp.frasco);
```
with:
```js
  _creFasesWrite(formulaId, geneticaId, fases, _sp.frasco);
  var edited = fases.find(function(f) { return f.fase === faseId; });
  _creLogFase(formulaId, geneticaId, faseId, edited ? edited.dia : 0, edited ? edited.fecha : fechaStr, true, _sp.frasco);
```

- [ ] **Step 3: `creFaseDeleteConfirm`** — replace:
```js
  var fases = _creFasesRead(formulaId, geneticaId).filter(function(f) { return f.fase !== faseId; });
  _creFasesWrite(formulaId, geneticaId, fases);
```
with:
```js
  var fases = _creFasesRead(formulaId, geneticaId, _sp.frasco).filter(function(f) { return f.fase !== faseId; });
  _creFasesWrite(formulaId, geneticaId, fases, _sp.frasco);
```

- [ ] **Step 4: `_creFaseEditStripHTML`** — replace:
```js
function _creFaseEditStripHTML(formulaId, geneticaId, faseId) {
  var fases = _creFasesRead(formulaId, geneticaId);
```
with:
```js
function _creFaseEditStripHTML(formulaId, geneticaId, faseId) {
  var fases = _creFasesRead(formulaId, geneticaId, _sp.frasco);
```

- [ ] **Step 5: `_creFasesGridHTML`** — replace:
```js
function _creFasesGridHTML(formulaId, geneticaId) {
  if (!geneticaId) return '<div style="padding:16px;color:var(--tx3);font-size:12px">Seleccioná una cepa.</div>';

  _creAutoFillInoculacion(formulaId, geneticaId);
  _creAutoFillColonizacion(formulaId, geneticaId);
  _creAutoFillInferredFases(formulaId, geneticaId);

  var fases  = _creFasesRead(formulaId, geneticaId);
```
with:
```js
function _creFasesGridHTML(formulaId, geneticaId) {
  if (!geneticaId) return '<div style="padding:16px;color:var(--tx3);font-size:12px">Seleccioná una cepa.</div>';

  _creAutoFillInoculacion(formulaId, geneticaId, _sp.frasco);
  _creAutoFillColonizacion(formulaId, geneticaId, _sp.frasco);
  _creAutoFillInferredFases(formulaId, geneticaId, _sp.frasco);

  var fases  = _creFasesRead(formulaId, geneticaId, _sp.frasco);
```

Also replace:
```js
  var diasAct = _creDiasSinceInoc(formulaId, geneticaId);
```
with:
```js
  var diasAct = _creDiasSinceInoc(formulaId, geneticaId, _sp.frasco);
```

- [ ] **Step 6: `creFaseGridClick`** — replace:
```js
function creFaseGridClick(formulaId, geneticaId, faseId) {
  var fases = _creFasesRead(formulaId, geneticaId);
```
with:
```js
function creFaseGridClick(formulaId, geneticaId, faseId) {
  var fases = _creFasesRead(formulaId, geneticaId, _sp.frasco);
```

- [ ] **Step 7: `_creBatchFaseRegisterNow`** — replace:
```js
  _sp.selected.forEach(function(key) {
    var gId = key.split('|')[2];
    if (!gId) return;
    var fases    = _creFasesRead(formulaId, gId);
    var already  = fases.find(function(f) { return f.fase === faseId; });
    if (already && already.auto !== 'inferred') return; // ya registrada — batch no sobreescribe (protege el ancla de inoculación y evita perder una fecha real ya cargada)
    var inocDate = _creInoculacionDate(formulaId, gId);
```
with:
```js
  _sp.selected.forEach(function(key) {
    var gId = key.split('|')[2];
    if (!gId) return;
    var fases    = _creFasesRead(formulaId, gId, _sp.frasco);
    var already  = fases.find(function(f) { return f.fase === faseId; });
    if (already && already.auto !== 'inferred') return; // ya registrada — batch no sobreescribe (protege el ancla de inoculación y evita perder una fecha real ya cargada)
    var inocDate = _creInoculacionDate(formulaId, gId, _sp.frasco);
```

and:
```js
    fases = fases.filter(function(f) { return f.fase !== faseId; });
    fases.push(entry);
    fases.sort(function(a, b) { return order.indexOf(a.fase) - order.indexOf(b.fase); });
    _creFasesWrite(formulaId, gId, fases);
    _creLogFase(formulaId, gId, faseId, dia, todayIso, false, _sp.frasco);
```
with:
```js
    fases = fases.filter(function(f) { return f.fase !== faseId; });
    fases.push(entry);
    fases.sort(function(a, b) { return order.indexOf(a.fase) - order.indexOf(b.fase); });
    _creFasesWrite(formulaId, gId, fases, _sp.frasco);
    _creLogFase(formulaId, gId, faseId, dia, todayIso, false, _sp.frasco);
```

(the `_creGetPlacasFromCI(formulaId, gId, _fCtxB ? _fCtxB.expId : null, _fCtxB ? _fCtxB.frascoLabel : null)` a few lines above already passes frasco correctly — unchanged.)

- [ ] **Step 8: Verify**

Run: `grep -n "_creFasesRead(formulaId, geneticaId)\b\|_creFasesRead(formulaId, gId)\b\|_creFasesWrite(formulaId, geneticaId, fases)\b\|_creFasesWrite(formulaId, gId, fases)\b" cilab/cilab_conocimiento.js`
Expected: 0 matches in the line range 5292-5589 (matches outside that range belong to later tasks, not yet fixed).

- [ ] **Step 9: Commit**

```bash
git add cilab/cilab_conocimiento.js
git commit -m "fix(cilab): grid de fases (individual y batch) propaga _sp.frasco a las lecturas/escrituras"
```

---

### Task 7: Misc `_sp.frasco`-scoped read sites — cepa cards, notas panel, envío de nota

**Files:**
- Modify: `cilab/cilab_conocimiento.js:4262` (`_creRenderCepasSection`)
- Modify: `cilab/cilab_conocimiento.js:4549` (`_creScoringPanelHTML`)
- Modify: `cilab/cilab_conocimiento.js:3599` (`_creNotasPanelHTML`)
- Modify: `cilab/cilab_conocimiento.js:5234` (`creNotaEnviar`)

- [ ] **Step 1: `_creRenderCepasSection`** — replace:
```js
  var allFases = {};
  cepas.forEach(function(c) { allFases[c.id] = _creFasesRead(formulaId, c.id); });
```
(line 4261-4262) with:
```js
  var allFases = {};
  cepas.forEach(function(c) { allFases[c.id] = _creFasesRead(formulaId, c.id, _sp.frasco); });
```

- [ ] **Step 2: `_creScoringPanelHTML`** — replace the identical pattern at line 4548-4549:
```js
  var allFases = {};
  cepas.forEach(function(c) { allFases[c.id] = _creFasesRead(formulaId, c.id); });
```
with:
```js
  var allFases = {};
  cepas.forEach(function(c) { allFases[c.id] = _creFasesRead(formulaId, c.id, _sp.frasco); });
```

- [ ] **Step 3: `_creNotasPanelHTML`** — replace line 3599:
```js
    var _pfZone  = _creTemporalZoneFase(formulaId, geneticaId);
```
with:
```js
    var _pfZone  = _creTemporalZoneFase(formulaId, geneticaId, _sp.frasco);
```

- [ ] **Step 4: `creNotaEnviar`** — replace line 5234:
```js
    var ctxZone = _creTemporalZoneFase(formulaId, geneticaId);
```
with:
```js
    var ctxZone = _creTemporalZoneFase(formulaId, geneticaId, _sp.frasco);
```

- [ ] **Step 5: Verify**

Run: `grep -n "_creFasesRead(formulaId, c.id)\b\|_creTemporalZoneFase(formulaId, geneticaId)\b" cilab/cilab_conocimiento.js`
Expected: 0 matches.

- [ ] **Step 6: Commit**

```bash
git add cilab/cilab_conocimiento.js
git commit -m "fix(cilab): cards de cepa y panel de notas leen fases con el frasco activo"
```

---

### Task 8: `_saveTarget` (per-target frCtx) + the 3 live-preview call sites

**Files:**
- Modify: `cilab/cilab_conocimiento.js:5107-5108` (`_saveTarget`, inside `creSubmitScoringPanel`)
- Modify: `cilab/cilab_conocimiento.js:4402` (`creUpdateBatchCompound`)
- Modify: `cilab/cilab_conocimiento.js:4723-4727` (`_creScoringFormHTML`)
- Modify: `cilab/cilab_conocimiento.js:5041,5049` (`creUpdateCompound`)

**Context:** `_saveTarget` is the one call site that must **not** use `_sp.frasco` — it already resolves `frCtx` from `tgt.expId`/`tgt.frascoLabel` a few lines above (protects against a stale `_sp.selected` entry from a frasco tab the user has since switched away from). The other 3 are live-preview-only renders where `_sp.frasco` is always correct (same tab, no persistence).

- [ ] **Step 1: `_saveTarget`** — replace:
```js
    var compScore  = _creCalcCompound(tgt.score, !isNaN(tgt.rizo) ? tgt.rizo : null, !isNaN(tgt.total) && tgt.total > 0 ? tgt.total : null, formulaId, gId);
    var colonStats = _creColonizacionStats(formulaId, gId);
```
with:
```js
    var compScore  = _creCalcCompound(tgt.score, !isNaN(tgt.rizo) ? tgt.rizo : null, !isNaN(tgt.total) && tgt.total > 0 ? tgt.total : null, formulaId, gId, frCtx);
    var colonStats = _creColonizacionStats(formulaId, gId, frCtx);
```
(`frCtx` is already declared a few lines above in the same function — `var frCtx = null; if (tgt.expId) { frCtx = allFrascos.find(...) || null; }` — no new variable needed.)

- [ ] **Step 2: `creUpdateBatchCompound`** — replace:
```js
  var comp = _creCalcCompound(score, rizoVal, !isNaN(total) && total > 0 ? total : null, formulaId, firstGId);
```
with:
```js
  var comp = _creCalcCompound(score, rizoVal, !isNaN(total) && total > 0 ? total : null, formulaId, firstGId, _sp.frasco);
```

- [ ] **Step 3: `_creScoringFormHTML`** — replace:
```js
  var compVal = _creCalcCompound(preScore, _rizoForComp, preTotal !== '' ? +preTotal : null, formulaId, geneticaId);
  var compColor = compVal != null ? _creScoreColor(compVal * 10) : 'var(--tx3)';
  var colonStats = _creColonizacionStats(formulaId, geneticaId);
```
with:
```js
  var compVal = _creCalcCompound(preScore, _rizoForComp, preTotal !== '' ? +preTotal : null, formulaId, geneticaId, _sp.frasco);
  var compColor = compVal != null ? _creScoreColor(compVal * 10) : 'var(--tx3)';
  var colonStats = _creColonizacionStats(formulaId, geneticaId, _sp.frasco);
```

- [ ] **Step 4: `creUpdateCompound`** — replace:
```js
  var comp = _creCalcCompound(score, rizoVal, !isNaN(total) && total > 0 ? total : null, formulaId, _sp.cepaId);
```
with:
```js
  var comp = _creCalcCompound(score, rizoVal, !isNaN(total) && total > 0 ? total : null, formulaId, _sp.cepaId, _sp.frasco);
```

and:
```js
    var stats = _creColonizacionStats(formulaId, _sp.cepaId);
```
with:
```js
    var stats = _creColonizacionStats(formulaId, _sp.cepaId, _sp.frasco);
```

- [ ] **Step 5: Verify**

Run: `grep -n "_creCalcCompound(.*formulaId, [a-zA-Z_.]*)\s*;\|_creColonizacionStats(formulaId, [a-zA-Z_.]*)\s*;" cilab/cilab_conocimiento.js`
Expected: 0 matches (every call now has a 6th/3rd frasco argument — a bare trailing `)` right after the geneticaId argument would mean one was missed).

- [ ] **Step 6: Commit**

```bash
git add cilab/cilab_conocimiento.js
git commit -m "fix(cilab): _saveTarget y los 3 previews de score compuesto pasan frascoCtx"
```

---

### Task 9: `_creLogScore` shape fix + record-context backfill functions

**Files:**
- Modify: `cilab/cilab_conocimiento.js:3520` (`_creLogScore`)
- Modify: `cilab/cilab_conocimiento.js:442` (`creAddObs`, data-quality warning)
- Modify: `cilab/cilab_conocimiento.js:869-870,904,932` (`_creBackfillAutoLogs`)
- Modify: `cilab/cilab_conocimiento.js:1197` (`_creRegenScoreLogs`)

**Context:** `_creLogScore` already receives a `frascoCtx` parameter (used for its "🔬 Frasco X" label), but its shape is `{ label, experimentoId, frascoId }` — different field names than `_creFasesKey`'s `{ expId, frascoLabel }`. The other 3 functions iterate over `bl2_crec` records directly (not through the scoring panel), so they must build `frCtx` from each record's own `experimentoId`/`frascoId`, not from `_sp.frasco`.

- [ ] **Step 1: `_creLogScore`** — replace:
```js
  var fasesLines = targets.map(function(t) {
    var fases = _creFasesRead(formulaId, t.gId);
```
with:
```js
  var _fasesFrCtx = (frascoCtx && frascoCtx.experimentoId)
    ? { expId: frascoCtx.experimentoId, frascoLabel: frascoCtx.frascoId }
    : null;
  var fasesLines = targets.map(function(t) {
    var fases = _creFasesRead(formulaId, t.gId, _fasesFrCtx);
```

- [ ] **Step 2: `creAddObs` data-quality check** — replace:
```js
    const fases          = _creFasesRead(rec.formulaId, rec.geneticaId);
```
with:
```js
    const _frCtxObs = (rec.experimentoId && rec.frascoId)
      ? { expId: rec.experimentoId, frascoLabel: rec.frascoId }
      : null;
    const fases          = _creFasesRead(rec.formulaId, rec.geneticaId, _frCtxObs);
```

- [ ] **Step 3: `_creBackfillAutoLogs`** — replace:
```js
  records.forEach(function(rec) {
    var formulaId  = rec.formulaId;
    var geneticaId = rec.geneticaId;
    if (!formulaId || !geneticaId) return;

    // Sincronizar fases desde CI antes de leer — idempotente
    _creAutoFillInoculacion(formulaId, geneticaId);
    _creAutoFillColonizacion(formulaId, geneticaId);
```
with:
```js
  records.forEach(function(rec) {
    var formulaId  = rec.formulaId;
    var geneticaId = rec.geneticaId;
    if (!formulaId || !geneticaId) return;
    var frCtx = (rec.experimentoId && rec.frascoId)
      ? { expId: rec.experimentoId, frascoLabel: rec.frascoId }
      : null;

    // Sincronizar fases desde CI antes de leer — idempotente
    _creAutoFillInoculacion(formulaId, geneticaId, frCtx);
    _creAutoFillColonizacion(formulaId, geneticaId, frCtx);
```

and (score backfill section):
```js
        var fases = _creFasesRead(formulaId, geneticaId);
        var fp    = [];
        var colF  = fases.find(function(f) { return f.fase === 'colonizacion_completa'; });
```
with:
```js
        var fases = _creFasesRead(formulaId, geneticaId, frCtx);
        var fp    = [];
        var colF  = fases.find(function(f) { return f.fase === 'colonizacion_completa'; });
```

and (fases backfill section):
```js
    // ── Fases backfill ──────────────────────────────────────────────────
    var fases = _creFasesRead(formulaId, geneticaId);
```
with:
```js
    // ── Fases backfill ──────────────────────────────────────────────────
    var fases = _creFasesRead(formulaId, geneticaId, frCtx);
```

- [ ] **Step 4: `_creRegenScoreLogs`** — the record-level `frCtx` needs to be built where `frascoStr` already is (same block, `rec.frascoId`/`rec.experimentoId` already resolved there). Replace:
```js
    var frascoStr = null;
    if (rec.frascoId && rec.experimentoId) {
      var exp = exps.find(function(e) { return e.id === rec.experimentoId; });
      if (exp) {
        var fr = (exp.frascos || []).find(function(f) { return f.label === rec.frascoId; });
        if (fr) {
          var ex = fr.extras && fr.extras.length
            ? fr.extras.map(function(x) {
                var ing = allIngs.find(function(i) { return i.id === x.ingId; });
                return ing ? ing.nombre : x.ingId;
              }).join('+')
            : 'Control';
          frascoStr = 'Frasco ' + fr.label + ' · ' + ex;
        }
      }
    }
```
with:
```js
    var frascoStr = null;
    var _frCtxRegen = null;
    if (rec.frascoId && rec.experimentoId) {
      _frCtxRegen = { expId: rec.experimentoId, frascoLabel: rec.frascoId };
      var exp = exps.find(function(e) { return e.id === rec.experimentoId; });
      if (exp) {
        var fr = (exp.frascos || []).find(function(f) { return f.label === rec.frascoId; });
        if (fr) {
          var ex = fr.extras && fr.extras.length
            ? fr.extras.map(function(x) {
                var ing = allIngs.find(function(i) { return i.id === x.ingId; });
                return ing ? ing.nombre : x.ingId;
              }).join('+')
            : 'Control';
          frascoStr = 'Frasco ' + fr.label + ' · ' + ex;
        }
      }
    }
```

and:
```js
    var fases = _creFasesRead(rec.formulaId, rec.geneticaId);
```
with:
```js
    var fases = _creFasesRead(rec.formulaId, rec.geneticaId, _frCtxRegen);
```

- [ ] **Step 5: Verify**

Run: `grep -n "_creFasesRead(formulaId, geneticaId)\b\|_creFasesRead(rec\.formulaId, rec\.geneticaId)\b\|_creFasesRead(formulaId, t\.gId)\b" cilab/cilab_conocimiento.js`
Expected: 0 matches anywhere in the file.

- [ ] **Step 6: Commit**

```bash
git add cilab/cilab_conocimiento.js
git commit -m "fix(cilab): _creLogScore y funciones de backfill de logs resuelven frasco por record"
```

---

### Task 10: Retroactive correction of `bl2_crec` — `_creMigrarColonizacionDiasPorFrascoV1`

**Files:**
- Modify: `cilab/cilab_conocimiento.js` — add new function near `_creExtrasBackfillV2` (after line 1141)
- Modify: `cilab/cilab_conocimiento.js:4813-4816` (`creOpenScoringPanel`, wire the call in)
- Test: scratchpad `task10_migration.test.js`

**Context:** 22 already-closed `bl2_crec` records have `colonizacionDias`/`colonizacionPenalty` frozen using the wrong frasco's colonization date. Reuses `_creInoculacionDate`/`_creGetColonizacionDate` (now frasco-aware from Task 2) — does not reimplement date resolution. Only touches records where a real per-frasco `bl2_seg` tanda exists; never invents.

**Scope decision (2026-07-23, made during execution, not in the original design):** `scoreCompuesto` is deliberately NOT recomputed by this migration. `_creCalcCompound`'s formula changed same-day (commit `c3049b2`, the "penalización siempre aplica" policy) — recomputing `scoreCompuesto` for records frozen before that change would silently re-score them under a policy that didn't exist when they closed, conflating an objective date-bug fix with an undecided retroactive policy change. Confirmed via git history that `colonizacionPenalty` itself was never gated by the old score≥7 policy (only `_creCalcCompound`'s assembly of `scoreCompuesto` was), so it's safe to correct in isolation. See CLAUDE.md's new "PENDIENTE" note under CILAB CONOCIMIENTO for the deferred policy question.

- [ ] **Step 1: Write the failing test**

```js
// task10_migration.test.js
global.localStorage = (function() {
  var store = {};
  return {
    getItem: function(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function(k, v) { store[k] = String(v); },
  };
})();
var K_CREC_FASES = 'bl2_crec_fases';
function gArr(k) { try { return JSON.parse(localStorage.getItem(k)) || []; } catch(e) { return []; } }
function now() { return new Date().toISOString(); }

// PASTE (fixed, post Tasks 1-3) bodies of:
//   _creFasesKey, _creFasesRead, _creFasesWrite,
//   _creGetInoculacionDate (tier 2, unchanged), _creGetColonizacionDate, _creInoculacionDate,
//   _creColonizacionStats, _creEffectivePenalty, _creCalcCompound
// here.

// Seed real Metionina data: Frasco A and B tandas for cepa NODE-MO9I0NCNVKPQ
localStorage.setItem('bl2_seg', JSON.stringify([
  { formula_id: 'CI-0006', genetica: 'NODE-MO9I0NCNVKPQ', experimentoId: 'EXP-0001', experimentoFrascoId: 'A', inoculoTs: '2026-05-08T05:30:38.745Z', colonizacion: '2026-05-25T21:21' },
  { formula_id: 'CI-0006', genetica: 'NODE-MO9I0NCNVKPQ', experimentoId: 'EXP-0001', experimentoFrascoId: 'B', inoculoTs: '2026-05-08T05:30:42.476Z', colonizacion: '2026-05-30T21:22' },
]));
localStorage.setItem('bl2_forms', JSON.stringify([]));

// Seed the two real (wrong) closed CRE records: CRE-0027 (Frasco A, froze 24 dias) and CRE-0032 (Frasco B, froze 24 dias)
var crec = [
  { id: 'CRE-0027', formulaId: 'CI-0006', geneticaId: 'NODE-MO9I0NCNVKPQ', experimentoId: 'EXP-0001', frascoId: 'A', status: 'cerrado',
    observaciones: [{ tipo: 'definitiva', dia: 0, fecha: '2026-05-31', scoreObservado: 6.9, calidadScore: 6.9, scoreCompuesto: 6.4, colonizacionDias: 24, colonizacionPenalty: 2.25 }] },
  { id: 'CRE-0032', formulaId: 'CI-0006', geneticaId: 'NODE-MO9I0NCNVKPQ', experimentoId: 'EXP-0001', frascoId: 'B', status: 'cerrado',
    observaciones: [{ tipo: 'definitiva', dia: 0, fecha: '2026-05-31', scoreObservado: 3.8, calidadScore: 3.8, scoreCompuesto: 1.55, colonizacionDias: 24, colonizacionPenalty: 2.25 }] },
];
localStorage.setItem('bl2_crec', JSON.stringify(crec));

// PASTE _creMigrarColonizacionDiasPorFrascoV1 (from Step 3) here, plus stub creWrite:
function creRead() { return gArr('bl2_crec'); }
function creWrite(arr) { localStorage.setItem('bl2_crec', JSON.stringify(arr)); }

var result = _creMigrarColonizacionDiasPorFrascoV1();

var after = gArr('bl2_crec');
var recA = after.find(function(r) { return r.id === 'CRE-0027'; }).observaciones[0];
var recB = after.find(function(r) { return r.id === 'CRE-0032'; }).observaciones[0];

console.log('result.updated === 2:', result.updated === 2);
console.log('recA.colonizacionDias === 17:', recA.colonizacionDias === 17);
console.log('recA.colonizacionPenalty === 0.5:', recA.colonizacionPenalty === 0.5);
console.log('recA.scoreCompuesto UNCHANGED === 6.4 (seeded, never recomputed):', recA.scoreCompuesto === 6.4);
console.log('recB.colonizacionDias === 22:', recB.colonizacionDias === 22);
console.log('recB.colonizacionPenalty === 1.75:', recB.colonizacionPenalty === 1.75);
console.log('recB.scoreCompuesto UNCHANGED === 1.55 (seeded, never recomputed):', recB.scoreCompuesto === 1.55);
```

- [ ] **Step 2: Run test to verify it fails**

`_creMigrarColonizacionDiasPorFrascoV1` doesn't exist yet. Run: `node task10_migration.test.js`
Expected: `TypeError: _creMigrarColonizacionDiasPorFrascoV1 is not a function`.

- [ ] **Step 3: Implement the migration**

Add after line 1141 (right after `_creExtrasBackfillV2`'s closing brace, before `_creRegenScoreLogs`):

```js
/**
 * Migración one-shot: recalcula colonizacionDias/colonizacionPenalty (SOLO estos dos campos)
 * en records de bl2_crec cerrados cuyo frasco propio tiene una fecha de colonización
 * real en bl2_seg distinta de la que quedó congelada (bug: se calculaba con la fecha
 * compartida entre frascos, ver docs/superpowers/specs/2026-07-23-fases-por-frasco-design.md).
 * Reusa _creInoculacionDate/_creGetColonizacionDate (ya frasco-aware) — no reimplementa
 * resolución de fechas. Si no encuentra tanda de bl2_seg con inoculoTs+colonizacion reales
 * para ESE frasco, no toca el record (no inventa procedencia).
 * Solo sobreescribe si el valor recalculado difiere del congelado.
 * NO recalcula scoreCompuesto a propósito: ese campo depende de qué versión de
 * _creEffectivePenalty/_creCalcCompound estaba vigente cuando el record se cerró
 * (ver commit c3049b2, política "penalización siempre aplica" del 2026-07-22/23) —
 * recomputarlo acá mezclaría la corrección objetiva de fecha con un cambio de
 * política retroactivo no decidido. Detalle completo: este mismo plan, Task 10.
 */
function _creMigrarColonizacionDiasPorFrascoV1() {
  var arr = creRead();
  var updated = 0;

  // Fechas 'YYYY-MM-DD' (sin hora) las parsea el motor JS como medianoche UTC —
  // en un huso horario negativo (ej. Argentina, UTC-3) eso cae en el día calendario
  // anterior. Mismo gotcha ya documentado en FR/genFrId (CLAUDE.md): forzar
  // T00:00:00 local en vez de new Date(str) a secas cuando no trae hora.
  function _localDate(str) {
    return /^\d{4}-\d{2}-\d{2}$/.test(str) ? new Date(str + 'T00:00:00') : new Date(str);
  }

  arr.forEach(function(rec) {
    if (rec.status !== 'cerrado' || !rec.experimentoId || !rec.frascoId || !rec.geneticaId) return;
    var frCtx = { expId: rec.experimentoId, frascoLabel: rec.frascoId };

    var inocDate = _creInoculacionDate(rec.formulaId, rec.geneticaId, frCtx);
    var colonDate = _creGetColonizacionDate(rec.formulaId, rec.geneticaId, frCtx);
    if (!inocDate || !colonDate) return; // sin dato real de ESTE frasco — no tocar

    var d0 = _localDate(inocDate); d0.setHours(0, 0, 0, 0);
    var d1 = _localDate(colonDate); d1.setHours(0, 0, 0, 0);
    var correctDias = Math.floor((d1 - d0) / 86400000);
    if (correctDias < 0) return; // dato inconsistente — no tocar

    (rec.observaciones || []).forEach(function(o) {
      if (o.colonizacionDias == null || o.colonizacionDias === correctDias) return;

      var rizoRatio = (o.rizoPozitivas != null && o.totalPlacas != null && o.totalPlacas > 0)
        ? (o.rizoPozitivas / o.totalPlacas) : null;
      var correctPenalty = _creEffectivePenalty(
        Math.min(3, +(Math.max(0, correctDias - 15) * 0.25).toFixed(2)), rizoRatio
      );

      o.colonizacionDias    = correctDias;
      o.colonizacionPenalty = correctPenalty;
      updated++;
    });
  });

  if (updated > 0) {
    creWrite(arr);
    try { localStorage.removeItem('bl2_inteligencia_model'); } catch(e) {}
    try { localStorage.removeItem('bl2_formula_intel'); } catch(e) {}
  }
  return { updated: updated };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node task10_migration.test.js`
Expected: all 6 lines print `true`.

- [ ] **Step 5: Wire the one-shot flag and call it from `creOpenScoringPanel`**

Replace lines 4813-4815:
```js
  _creFrascoBackfill();    // migración idempotente: asigna frascoId a records legacy si es posible
  _creExtrasBackfill();    // migración idempotente: mergea extras (records sin backfill)
  _creExtrasBackfillV2();  // corrección V2: re-normaliza extras en records sellados con V1 buggy
```
with:
```js
  _creFrascoBackfill();    // migración idempotente: asigna frascoId a records legacy si es posible
  _creExtrasBackfill();    // migración idempotente: mergea extras (records sin backfill)
  _creExtrasBackfillV2();  // corrección V2: re-normaliza extras en records sellados con V1 buggy
  // Corrección one-shot: colonizacionDias/penalty calculados con el frasco equivocado
  // (bug de bl2_crec_fases compartido entre frascos, ver spec 2026-07-23-fases-por-frasco).
  // Flag escrito recién después de confirmar el persist (patrón _creExtrasBackfillV2/CLAUDE.md).
  try {
    if (!localStorage.getItem('biolab_migracion_crec_colonizacion_frasco_v1')) {
      var _colFrascoResult = _creMigrarColonizacionDiasPorFrascoV1();
      if (_colFrascoResult.updated > 0) console.info('[CRE] colonizacionDias corregidos por frasco:', _colFrascoResult.updated, 'obs');
      localStorage.setItem('biolab_migracion_crec_colonizacion_frasco_v1', '1');
    }
  } catch(e) { console.warn('[CRE] migracion colonizacionDias por frasco fallo', e); }
```

- [ ] **Step 6: Commit**

```bash
git add cilab/cilab_conocimiento.js
git commit -m "fix(cilab): migracion one-shot corrige colonizacionDias/penalty en records cerrados con el frasco equivocado"
```

---

### Task 11: End-to-end verification against the real "Prueba de Metionina" dataset

**Files:**
- Test: scratchpad `task11_e2e.test.js`

- [ ] **Step 1: Write the end-to-end script**

Copy the FULL post-fix bodies (from Tasks 1-4 and 10) of: `_creFasesKey`, `_creFasesRead`, `_creFasesWrite`, `_creGetInoculacionDate`, `_creGetColonizacionDate`, `_creInoculacionDate`, `_creAutoFillInoculacion`, `_creAutoFillColonizacion`, `_creAutoFillInferredFases`, `_creDiasSinceInoc`, `_creColonizacionStats`, `_creEffectivePenalty`, `_creCalcCompound`, `_creMigrarColonizacionDiasPorFrascoV1`, plus stubs for `now`/`gArr`/`creRead`/`creWrite`/`_creIsCleared` (return `false`) into `task11_e2e.test.js`. Seed `bl2_seg`, `bl2_forms` (empty), and `bl2_crec` with the **exact 5-cepa "Prueba de Metionina" data** already saved in `C:\Users\JET\Downloads\biolab_fases_frasco_diagnostico.json` (experimento `EXP-0001`, formulaId `CI-0006`) — read that file and transcribe the `segTandas`/`crecRecords` for all 5 cepas, not just one.

Then assert:

```js
// 1. Before autofill: fresh frasco-scoped keys are empty
console.log('empty A before autofill:', _creFasesRead('CI-0006', 'NODE-MO9I0NCNVKPQ', { expId: 'EXP-0001', frascoLabel: 'A' }).length === 0);

// 2. Autofill regenerates correct, DIFFERENT data per frasco
_creAutoFillInoculacion('CI-0006', 'NODE-MO9I0NCNVKPQ', { expId: 'EXP-0001', frascoLabel: 'A' });
_creAutoFillColonizacion('CI-0006', 'NODE-MO9I0NCNVKPQ', { expId: 'EXP-0001', frascoLabel: 'A' });
_creAutoFillInoculacion('CI-0006', 'NODE-MO9I0NCNVKPQ', { expId: 'EXP-0001', frascoLabel: 'B' });
_creAutoFillColonizacion('CI-0006', 'NODE-MO9I0NCNVKPQ', { expId: 'EXP-0001', frascoLabel: 'B' });

var faseColA = _creFasesRead('CI-0006', 'NODE-MO9I0NCNVKPQ', { expId: 'EXP-0001', frascoLabel: 'A' }).find(function(f){return f.fase==='colonizacion_completa';});
var faseColB = _creFasesRead('CI-0006', 'NODE-MO9I0NCNVKPQ', { expId: 'EXP-0001', frascoLabel: 'B' }).find(function(f){return f.fase==='colonizacion_completa';});
console.log('faseColA.dia === 17:', faseColA.dia === 17);
console.log('faseColB.dia === 22:', faseColB.dia === 22);

// 3. Old shared key untouched (still whatever the diagnostic dump showed, dia 24 for both — orphaned, not migrated)
var sharedOld = _creFasesRead('CI-0006', 'NODE-MO9I0NCNVKPQ', null);
console.log('old shared key untouched (0 or pre-existing, never 17/22):', sharedOld.every(function(f){ return f.fase !== 'colonizacion_completa' || f.dia !== 17; }));

// 4. Migration corrects all 5 cepas of Frasco A / Frasco B in this experiment
var result = _creMigrarColonizacionDiasPorFrascoV1();
console.log('migration updated 10 obs (5 cepas x 2 frascos):', result.updated === 10);

var after = creRead();
['CRE-0027','CRE-0028','CRE-0029','CRE-0030','CRE-0031'].forEach(function(id) {
  var o = after.find(function(r){return r.id===id;}).observaciones[0];
  console.log(id + '.colonizacionDias === 17:', o.colonizacionDias === 17);
});
['CRE-0032','CRE-0033','CRE-0034','CRE-0035','CRE-0036'].forEach(function(id) {
  var o = after.find(function(r){return r.id===id;}).observaciones[0];
  console.log(id + '.colonizacionDias === 22:', o.colonizacionDias === 22);
});

// 5. A formula with no bl2_experimentos entries at all is fully unaffected
localStorage.setItem('bl2_seg', JSON.stringify([{ formula_id: 'CI-9999', genetica: 'NODE-Y', inoculoTs: '2026-01-01T00:00:00.000Z', colonizacion: '2026-01-20T00:00:00.000Z' }]));
_creAutoFillInoculacion('CI-9999', 'NODE-Y');
_creAutoFillColonizacion('CI-9999', 'NODE-Y');
var noExpFases = _creFasesRead('CI-9999', 'NODE-Y');
console.log('no-experiment formula still works, key unchanged:', noExpFases.length === 2 && _creFasesKey('CI-9999','NODE-Y') === 'CI-9999__NODE-Y');
```

- [ ] **Step 2: Run and confirm every line prints `true`**

Run: `node task11_e2e.test.js`
Expected: all lines `true`. If any prints `false`, stop and re-check the corresponding task (1, 2, 4, 5, or 10) before continuing — do not proceed to Task 12 with a failing end-to-end script.

- [ ] **Step 3: No commit** (scratch verification script only, per this repo's convention scripts never get committed)

---

### Task 12: Manual smoke test in the real app

**Files:** none (verification only)

- [ ] **Step 1: Backup first** (project rule — mandatory before any localStorage structure change)

In the app: CFG → `⬇ Exportar todo`. Confirm the file downloaded before continuing.

- [ ] **Step 2: Load the app, open CILAB → Conocimiento → "Prueba de Metionina" (CI-0006)**

Open the scoring panel, switch to Frasco A, expand cepa `NODE-MO9I0NCNVKPQ` (or whichever label it shows) — check "Colonización completa" now shows **Día 17** (not 24). Switch to Frasco B, same cepa — check it shows **Día 22** (not 24), independently.

- [ ] **Step 3: Verify the migration ran and caches were invalidated**

In the browser console:
```js
console.log(localStorage.getItem('biolab_migracion_crec_colonizacion_frasco_v1')); // "1"
console.log(localStorage.getItem('bl2_inteligencia_model')); // null
console.log(localStorage.getItem('bl2_formula_intel'));      // null
var crec = JSON.parse(localStorage.getItem('bl2_crec'));
var cre27 = crec.find(function(r){return r.id==='CRE-0027';});
console.log(cre27.observaciones[0].colonizacionDias);    // 17
console.log(cre27.observaciones[0].colonizacionPenalty); // 0.5
```

- [ ] **Step 4: Confirm a non-experiment CI formula is unaffected**

Open any CI formula that has never been used in `bl2_experimentos` — verify its scoring panel and fases grid behave exactly as before (no visual change, no console errors).

- [ ] **Step 5: Re-open CILAB Inteligencia (rebuild the model) and confirm no console errors**

Since `bl2_inteligencia_model` was invalidated, opening Inteligencia should trigger a fresh `buildModel()` run. Confirm it completes without throwing and produces a model (not stuck on "sin datos suficientes" if it wasn't before).

---

## Self-review notes

- **Spec coverage:** all 6 numbered design points from the spec have a task — key compuesta (Task 1), threading (Tasks 4-9), fuentes CI (Task 2), datos históricos / sin migración (confirmed as a no-op by design, verified in Task 11 step 3), corrección retroactiva (Task 10), backup (Task 12 step 1).
- **New finding during planning, not in the original spec:** `creOpenScoringPanel`'s pre-fill loop (Task 5) is the actual root seeding point of the 18 contaminated combinations — the spec's point 2 mentioned threading generically but didn't call this specific call site out. Added as its own task since it's the highest-impact single fix.
- **Type/shape consistency check:** `_sp.frasco` always has `{expId, frascoId, frascoLabel, extras, expNombre}` (frascoId === frascoLabel, both present). `_creLogScore`'s own `frascoCtx` parameter uses `{label, experimentoId, frascoId}` — different field names, handled explicitly in Task 9 Step 1 via `_fasesFrCtx` translation, not silently assumed compatible.
