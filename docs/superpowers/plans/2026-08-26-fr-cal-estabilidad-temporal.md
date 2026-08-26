# FR·CAL — Estabilidad temporal de correlaciones (MEJ-0003) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detectar cuándo una correlación de `bySuAditivo`/`byGrComponente` (FR·CAL, `fr/fr_app.js`) no es robusta frente a qué mes del historial se mire, y mostrar esa advertencia junto al candidato en vez de dejar que el ranking/nota automática le atribuya una anomalía a un ingrediente por confusión estacional o por un evento de cosecha en lote no relacionado.

**Architecture:** Función pura nueva `_frCalDeltaConLOO(candRecs, baseRecs, field, minN)` que recalcula el delta excluyendo, uno por vez, cada mes calendario presente en el dataset (leave-one-month-out) y compara el rango resultante contra el delta global. Se conecta a las 3 dimensiones que ya alimentan `anomalyRanking` (mutaciones/deformaciones/blobs) en `bySuAditivo` y `byGrComponente`, y el resultado (`estable`/`inestable`/`no-evaluable`) se propaga sin filtrar ni reordenar hasta el texto de la nota automática y el panel de detalle.

**Tech Stack:** JavaScript vanilla (IIFE, sin build step, sin framework de test). Verificación vía `node --check` + scripts Node ad-hoc en el directorio scratchpad de la sesión (no hay test runner en el repo) + verificación funcional en Chrome real contra un backup real cargado en `localStorage` (mismo método ya usado en esta sesión para MEJ-0049).

---

## Contexto que el ingeniero necesita

- Spec completo: `docs/superpowers/specs/2026-08-26-fr-cal-estabilidad-temporal-design.md` — leerlo antes de empezar, tiene el razonamiento completo de por qué LOO y por qué la regla de umbral.
- El archivo a modificar es `fr/fr_app.js` — es una sola IIFE gigante (no hay módulos ES6, no hay build). Todas las funciones nuevas son funciones de módulo normales (`function nombre() {...}`), no se exportan a `window` salvo que ya lo estén (ninguna de las tocadas en este plan lo está).
- No hay test runner instalado (`no package.json`). La verificación de funciones puras se hace con scripts Node sueltos (usar `assert` de Node, que viene con el runtime, cero dependencias) guardados en el directorio scratchpad de la sesión, NO en el repo.
- Convención de fechas en `record.fecha`: string ISO (`f.fecha`, ya existe en cada flush, formato `YYYY-MM-DDTHH:mm:ss.sssZ` o similar — el mes se extrae con `String(fecha).slice(0,7)` → `"YYYY-MM"`).
- Antes de cada commit: `node --check fr/fr_app.js` (sintaxis) como mínimo.

---

### Task 1: `_frCalDeltaConLOO` — función pura, TDD en aislamiento

**Files:**
- Test (temporal, no se commitea): `<scratchpad>/test_frcal_loo.js`
- Modify (al final de la task): `fr/fr_app.js` (agregar la función cerca de `_frCalConfidence`, línea ~4887)

- [ ] **Step 1: Escribir el test que falla**

Crear `<scratchpad>/test_frcal_loo.js` con este contenido exacto (usa `assert` nativo de Node, sin dependencias):

```javascript
const assert = require('assert');

// --- pegar acá la implementación de _frCalDeltaConLOO cuando exista (Step 3) ---
let _frCalDeltaConLOO;
try { ({ _frCalDeltaConLOO } = require('./frcal_loo_impl.js')); }
catch (e) { console.error('Todavia no existe frcal_loo_impl.js — se espera que falle.'); process.exit(1); }

function rec(field, value, mes) { var o = { fecha: mes + '-15T00:00:00.000Z' }; o[field] = value; return o; }

// Caso 1: estable -- misma diferencia (~10) todos los meses, 4 meses.
(function testEstable() {
    var cand = [], base = [];
    ['2026-01','2026-02','2026-03','2026-04'].forEach(function(m) {
        cand.push(rec('pctDeformaciones', 30, m), rec('pctDeformaciones', 32, m));
        base.push(rec('pctDeformaciones', 20, m), rec('pctDeformaciones', 22, m));
    });
    var r = _frCalDeltaConLOO(cand, base, 'pctDeformaciones', 3);
    assert.strictEqual(r.establidadTemporal, 'estable', 'esperaba estable, dio ' + r.establidadTemporal);
    assert.strictEqual(r.deltaGlobal, 10, 'deltaGlobal esperado 10, dio ' + r.deltaGlobal);
    console.log('OK: caso estable');
})();

// Caso 2: inestable estilo estacional -- el problema (deformaciones altas) ya existia en el
// baseline ANTES de que el candidato empezara a usarse; sacar esos meses tempranos derrumba el delta.
(function testInestableEstacional() {
    var cand = [], base = [];
    // meses tempranos: baseline ya tiene el problema, candidato todavia no se usaba
    ['2026-01','2026-02'].forEach(function(m) {
        base.push(rec('pctDeformaciones', 90, m), rec('pctDeformaciones', 90, m), rec('pctDeformaciones', 90, m));
    });
    // meses tardios: candidato en uso, ambos grupos con deformaciones altas por igual (el problema real es otro)
    ['2026-03','2026-04','2026-05'].forEach(function(m) {
        cand.push(rec('pctDeformaciones', 88, m), rec('pctDeformaciones', 90, m), rec('pctDeformaciones', 92, m));
        base.push(rec('pctDeformaciones', 5, m), rec('pctDeformaciones', 5, m), rec('pctDeformaciones', 5, m));
    });
    var r = _frCalDeltaConLOO(cand, base, 'pctDeformaciones', 3);
    assert.strictEqual(r.establidadTemporal, 'inestable', 'esperaba inestable, dio ' + r.establidadTemporal);
    console.log('OK: caso inestable estacional');
})();

// Caso 3: inestable estilo cohorte-en-lote -- un solo mes del baseline concentra un cluster
// de valores bajos que domina el promedio; sacar ese mes cambia el delta drasticamente.
(function testInestableCohorte() {
    var cand = [], base = [];
    ['2026-01','2026-02','2026-03'].forEach(function(m) {
        cand.push(rec('pctMutaciones', 25, m), rec('pctMutaciones', 27, m), rec('pctMutaciones', 23, m));
    });
    ['2026-01','2026-02'].forEach(function(m) {
        base.push(rec('pctMutaciones', 15, m), rec('pctMutaciones', 17, m), rec('pctMutaciones', 13, m));
    });
    // cohorte en lote: 7 bolsas excelentes (0% mutaciones) todas cosechadas el mismo mes
    for (var i = 0; i < 7; i++) base.push(rec('pctMutaciones', 0, '2026-03'));
    var r = _frCalDeltaConLOO(cand, base, 'pctMutaciones', 3);
    assert.strictEqual(r.establidadTemporal, 'inestable', 'esperaba inestable, dio ' + r.establidadTemporal);
    console.log('OK: caso inestable cohorte-en-lote');
})();

// Caso 4: no-evaluable -- solo 2 meses distintos en total.
(function testNoEvaluablePocosMeses() {
    var cand = [rec('pctBlobs', 10, '2026-01'), rec('pctBlobs', 12, '2026-01')];
    var base = [rec('pctBlobs', 5, '2026-02'), rec('pctBlobs', 6, '2026-02')];
    var r = _frCalDeltaConLOO(cand, base, 'pctBlobs', 1);
    assert.strictEqual(r.establidadTemporal, 'no-evaluable');
    assert.strictEqual(r.deltaGlobal, 5.5);
    console.log('OK: caso no-evaluable (pocos meses)');
})();

// Caso 5: no-evaluable -- 3 meses, pero excluir cualquiera deja algun grupo bajo minN.
(function testNoEvaluableMinN() {
    var cand = [rec('pctBlobs', 10, '2026-01'), rec('pctBlobs', 10, '2026-02'), rec('pctBlobs', 10, '2026-03')];
    var base = [rec('pctBlobs', 5, '2026-01'), rec('pctBlobs', 5, '2026-02'), rec('pctBlobs', 5, '2026-03')];
    var r = _frCalDeltaConLOO(cand, base, 'pctBlobs', 3); // minN=3: sacar cualquier mes deja cand/base en 2 < 3
    assert.strictEqual(r.establidadTemporal, 'no-evaluable');
    console.log('OK: caso no-evaluable (minN)');
})();

// Caso 6: arrays vacios no crashean.
(function testVacio() {
    var r = _frCalDeltaConLOO([], [rec('pctBlobs', 5, '2026-01')], 'pctBlobs', 1);
    assert.strictEqual(r.deltaGlobal, null);
    assert.strictEqual(r.establidadTemporal, 'no-evaluable');
    console.log('OK: caso arrays vacios');
})();

console.log('TODOS LOS CASOS OK');
```

- [ ] **Step 2: Correr el test para confirmar que falla**

Run: `node <scratchpad>/test_frcal_loo.js`
Expected: falla con `Cannot find module './frcal_loo_impl.js'` (o el mensaje del catch de arriba) — todavía no existe la implementación.

- [ ] **Step 3: Escribir la implementación mínima**

Crear `<scratchpad>/frcal_loo_impl.js` con exactamente esto (es el mismo código que después se pega en `fr_app.js` en el Step 5 — mantenerlo idéntico):

```javascript
function _frCalDeltaConLOO(candRecs, baseRecs, field, minN) {
    function meanOf(recs) {
        var vals = recs.map(function(r) { return r[field]; }).filter(function(v) { return v != null && !isNaN(v); });
        return vals.length ? vals.reduce(function(s, v) { return s + v; }, 0) / vals.length : null;
    }
    function mesDe(r) { return r.fecha ? String(r.fecha).slice(0, 7) : null; }

    var gMean = meanOf(candRecs);
    var bMean = meanOf(baseRecs);
    if (gMean == null || bMean == null) return { deltaGlobal: null, establidadTemporal: 'no-evaluable' };
    var deltaGlobal = Math.round((gMean - bMean) * 10) / 10;

    var mesesSet = {};
    candRecs.concat(baseRecs).forEach(function(r) { var m = mesDe(r); if (m) mesesSet[m] = true; });
    var mesesList = Object.keys(mesesSet);
    if (mesesList.length < 3) return { deltaGlobal: deltaGlobal, establidadTemporal: 'no-evaluable' };

    var deltasLOO = [];
    mesesList.forEach(function(mExcl) {
        var cand2 = candRecs.filter(function(r) { return mesDe(r) !== mExcl; });
        var base2 = baseRecs.filter(function(r) { return mesDe(r) !== mExcl; });
        if (cand2.length < minN || base2.length < minN) return;
        var g2 = meanOf(cand2), b2 = meanOf(base2);
        if (g2 == null || b2 == null) return;
        deltasLOO.push(g2 - b2);
    });

    if (deltasLOO.length < 2) return { deltaGlobal: deltaGlobal, establidadTemporal: 'no-evaluable' };

    var deltaLooMin = Math.round(Math.min.apply(null, deltasLOO) * 10) / 10;
    var deltaLooMax = Math.round(Math.max.apply(null, deltasLOO) * 10) / 10;
    var rango = deltaLooMax - deltaLooMin;
    var establidadTemporal = rango > Math.abs(deltaGlobal) ? 'inestable' : 'estable';
    return { deltaGlobal: deltaGlobal, establidadTemporal: establidadTemporal, deltaLooMin: deltaLooMin, deltaLooMax: deltaLooMax };
}

module.exports = { _frCalDeltaConLOO: _frCalDeltaConLOO };
```

- [ ] **Step 4: Correr el test para confirmar que pasa**

Run: `node <scratchpad>/test_frcal_loo.js`
Expected: las 6 líneas `OK: ...` y al final `TODOS LOS CASOS OK`, exit code 0.

Si el Caso 2 o el Caso 3 no da `inestable`, no seguir al Step 5 — ajustar la implementación (probablemente el umbral `rango > Math.abs(deltaGlobal)`) hasta que los 6 casos pasen. Estos 2 casos son los que representan los bugs reales documentados en `MEJ-0003` — si no los detecta, la función no cumple su propósito.

- [ ] **Step 5: Pegar la función verificada en `fr_app.js`**

Modify `fr/fr_app.js` — insertar inmediatamente después de `_frCalConfidence` (después de la línea que hoy dice `return 'insuficiente'; }` seguida de `}`, alrededor de la línea 4887):

```javascript
    function _frCalConfidence(n) {
        if (n >= 8) return 'alta';
        if (n >= 5) return 'media';
        if (n >= 3) return 'baja';
        return 'insuficiente';
    }

    // Comparacion candidatos-vs-baseline robusta a confusion temporal (MEJ-0003).
    // Ver docs/superpowers/specs/2026-08-26-fr-cal-estabilidad-temporal-design.md.
    // Mismo principio que el bootstrap CI90 de cilab_inteligencia.js: si excluir un solo mes
    // del historial puede producir un swing tan grande como el efecto reportado, el efecto
    // no es atribuible de forma robusta al candidato -- es sensible a que mes esta presente
    // en la muestra (cubre tanto confusion estacional como un evento de cosecha en lote).
    function _frCalDeltaConLOO(candRecs, baseRecs, field, minN) {
        function meanOf(recs) {
            var vals = recs.map(function(r) { return r[field]; }).filter(function(v) { return v != null && !isNaN(v); });
            return vals.length ? vals.reduce(function(s, v) { return s + v; }, 0) / vals.length : null;
        }
        function mesDe(r) { return r.fecha ? String(r.fecha).slice(0, 7) : null; }

        var gMean = meanOf(candRecs);
        var bMean = meanOf(baseRecs);
        if (gMean == null || bMean == null) return { deltaGlobal: null, establidadTemporal: 'no-evaluable' };
        var deltaGlobal = Math.round((gMean - bMean) * 10) / 10;

        var mesesSet = {};
        candRecs.concat(baseRecs).forEach(function(r) { var m = mesDe(r); if (m) mesesSet[m] = true; });
        var mesesList = Object.keys(mesesSet);
        if (mesesList.length < 3) return { deltaGlobal: deltaGlobal, establidadTemporal: 'no-evaluable' };

        var deltasLOO = [];
        mesesList.forEach(function(mExcl) {
            var cand2 = candRecs.filter(function(r) { return mesDe(r) !== mExcl; });
            var base2 = baseRecs.filter(function(r) { return mesDe(r) !== mExcl; });
            if (cand2.length < minN || base2.length < minN) return;
            var g2 = meanOf(cand2), b2 = meanOf(base2);
            if (g2 == null || b2 == null) return;
            deltasLOO.push(g2 - b2);
        });

        if (deltasLOO.length < 2) return { deltaGlobal: deltaGlobal, establidadTemporal: 'no-evaluable' };

        var deltaLooMin = Math.round(Math.min.apply(null, deltasLOO) * 10) / 10;
        var deltaLooMax = Math.round(Math.max.apply(null, deltasLOO) * 10) / 10;
        var rango = deltaLooMax - deltaLooMin;
        var establidadTemporal = rango > Math.abs(deltaGlobal) ? 'inestable' : 'estable';
        return { deltaGlobal: deltaGlobal, establidadTemporal: establidadTemporal, deltaLooMin: deltaLooMin, deltaLooMax: deltaLooMax };
    }
```

- [ ] **Step 6: `node --check`**

Run: `node --check fr/fr_app.js`
Expected: sin output, exit code 0.

- [ ] **Step 7: Commit**

```bash
git add fr/fr_app.js
git commit -m "feat(fr): agrega _frCalDeltaConLOO, chequeo de estabilidad temporal via leave-one-month-out (MEJ-0003 parte 1)"
```

---

### Task 2: Capturar `fecha` en los records + conectar la LOO en `bySuAditivo`/`byGrComponente`

**Files:**
- Modify: `fr/fr_app.js:4956-4980` (records.push dentro de `_frCalBuildIntel`)
- Modify: `fr/fr_app.js:5018-5055` (bloque `bySuAditivo`)
- Modify: `fr/fr_app.js:5076-5118` (bloque `byGrComponente`)

- [ ] **Step 1: Agregar `fecha` a cada record**

En `_frCalBuildIntel()`, dentro del `b.flushes.forEach(function(f, flushIdx) {...})`, el `records.push({...})` actual es:

```javascript
                records.push({
                    bolsaId:            b.id,
                    suLabel:            suLote ? (suLote.codigo || b.suLoteId || '—') : (b.suLoteId || '—'),
                    grLabel:            grLote ? (grLote.codigo || b.grLoteId || '—') : (b.grLoteId || '—'),
                    flushNum:           flushIdx + 1,
```

Cambiar a (agregar la línea `fecha:`):

```javascript
                records.push({
                    bolsaId:            b.id,
                    fecha:              f.fecha || null,
                    suLabel:            suLote ? (suLote.codigo || b.suLoteId || '—') : (b.suLoteId || '—'),
                    grLabel:            grLote ? (grLote.codigo || b.grLoteId || '—') : (b.grLoteId || '—'),
                    flushNum:           flushIdx + 1,
```

- [ ] **Step 2: Conectar la LOO en `bySuAditivo`**

El bloque actual (dentro de `Object.keys(slugGroups).forEach(function(slug) {...})`) es:

```javascript
            var gScore = meanField(grp.recs, 'scoreAuto');
            var bScore = meanField(baseline,  'scoreAuto');
            var gAb    = meanField(grp.recs, 'pctAbortos');
            var bAb    = meanField(baseline,  'pctAbortos');
            var gBl    = meanField(grp.recs, 'pctBlobs');
            var bBl    = meanField(baseline,  'pctBlobs');
            var gMut   = meanField(grp.recs, 'pctMutaciones');
            var bMut   = meanField(baseline,  'pctMutaciones');
            var gDef   = meanField(grp.recs, 'pctDeformaciones');
            var bDef   = meanField(baseline,  'pctDeformaciones');
            bySuAditivo[slug] = {
                label:              grp.label,
                n:                  grp.recs.length,
                nBaseline:          baseline.length,
                confidence:         _frCalConfidence(Math.min(grp.recs.length, baseline.length)),
                deltaScore:         (gScore != null && bScore != null) ? Math.round((gScore - bScore) * 10) / 10 : null,
                deltaAbortos:       (gAb    != null && bAb    != null) ? Math.round((gAb    - bAb)    * 10) / 10 : null,
                deltaBlobs:         (gBl    != null && bBl    != null) ? Math.round((gBl    - bBl)    * 10) / 10 : null,
                deltaMutaciones:    (gMut   != null && bMut   != null) ? Math.round((gMut   - bMut)   * 10) / 10 : null,
                deltaDeformaciones: (gDef   != null && bDef   != null) ? Math.round((gDef   - bDef)   * 10) / 10 : null
            };
```

Reemplazar por (deltaBlobs/deltaMutaciones/deltaDeformaciones ahora vienen de `_frCalDeltaConLOO`; deltaScore/deltaAbortos sin cambios — no alimentan `anomalyRanking`):

```javascript
            var gScore = meanField(grp.recs, 'scoreAuto');
            var bScore = meanField(baseline,  'scoreAuto');
            var gAb    = meanField(grp.recs, 'pctAbortos');
            var bAb    = meanField(baseline,  'pctAbortos');
            var blLoo  = _frCalDeltaConLOO(grp.recs, baseline, 'pctBlobs', MIN_N);
            var mutLoo = _frCalDeltaConLOO(grp.recs, baseline, 'pctMutaciones', MIN_N);
            var defLoo = _frCalDeltaConLOO(grp.recs, baseline, 'pctDeformaciones', MIN_N);
            bySuAditivo[slug] = {
                label:              grp.label,
                n:                  grp.recs.length,
                nBaseline:          baseline.length,
                confidence:         _frCalConfidence(Math.min(grp.recs.length, baseline.length)),
                deltaScore:         (gScore != null && bScore != null) ? Math.round((gScore - bScore) * 10) / 10 : null,
                deltaAbortos:       (gAb    != null && bAb    != null) ? Math.round((gAb    - bAb)    * 10) / 10 : null,
                deltaBlobs:         blLoo.deltaGlobal,
                deltaMutaciones:    mutLoo.deltaGlobal,
                deltaDeformaciones: defLoo.deltaGlobal,
                estabilidad: {
                    blobs:         blLoo.establidadTemporal,
                    mutaciones:    mutLoo.establidadTemporal,
                    deformaciones: defLoo.establidadTemporal
                },
                deltaLoo: {
                    blobs:         { min: blLoo.deltaLooMin,  max: blLoo.deltaLooMax },
                    mutaciones:    { min: mutLoo.deltaLooMin, max: mutLoo.deltaLooMax },
                    deformaciones: { min: defLoo.deltaLooMin, max: defLoo.deltaLooMax }
                }
            };
```

- [ ] **Step 3: Conectar la LOO en `byGrComponente`**

El bloque actual (dentro de `Object.keys(compGroups).forEach(function(cSlug) {...})`) es:

```javascript
            var gScore = meanField(grp.recs, 'scoreAuto');
            var bScore = meanField(baseline,  'scoreAuto');
            var gMut   = meanField(grp.recs, 'pctMutaciones');
            var bMut   = meanField(baseline,  'pctMutaciones');
            var gDef   = meanField(grp.recs, 'pctDeformaciones');
            var bDef   = meanField(baseline,  'pctDeformaciones');
            var gBl    = meanField(grp.recs, 'pctBlobs');
            var bBl    = meanField(baseline,  'pctBlobs');
            byGrComponente[cSlug] = {
                label:              grp.label,
                n:                  grp.recs.length,
                nBaseline:          baseline.length,
                confidence:         _frCalConfidence(Math.min(grp.recs.length, baseline.length)),
                deltaScore:         (gScore != null && bScore != null) ? Math.round((gScore - bScore) * 10) / 10 : null,
                deltaMutaciones:    (gMut   != null && bMut   != null) ? Math.round((gMut   - bMut)   * 10) / 10 : null,
                deltaDeformaciones: (gDef   != null && bDef   != null) ? Math.round((gDef   - bDef)   * 10) / 10 : null,
                deltaBlobs:         (gBl    != null && bBl    != null) ? Math.round((gBl    - bBl)    * 10) / 10 : null
            };
```

Reemplazar por (usa `FR_ANOMALY_MIN_N` como `minN`, no `MIN_N` — es el umbral que ya usa este bloque en el guard de la línea 5099):

```javascript
            var gScore = meanField(grp.recs, 'scoreAuto');
            var bScore = meanField(baseline,  'scoreAuto');
            var blLoo  = _frCalDeltaConLOO(grp.recs, baseline, 'pctBlobs', FR_ANOMALY_MIN_N);
            var mutLoo = _frCalDeltaConLOO(grp.recs, baseline, 'pctMutaciones', FR_ANOMALY_MIN_N);
            var defLoo = _frCalDeltaConLOO(grp.recs, baseline, 'pctDeformaciones', FR_ANOMALY_MIN_N);
            byGrComponente[cSlug] = {
                label:              grp.label,
                n:                  grp.recs.length,
                nBaseline:          baseline.length,
                confidence:         _frCalConfidence(Math.min(grp.recs.length, baseline.length)),
                deltaScore:         (gScore != null && bScore != null) ? Math.round((gScore - bScore) * 10) / 10 : null,
                deltaMutaciones:    mutLoo.deltaGlobal,
                deltaDeformaciones: defLoo.deltaGlobal,
                deltaBlobs:         blLoo.deltaGlobal,
                estabilidad: {
                    blobs:         blLoo.establidadTemporal,
                    mutaciones:    mutLoo.establidadTemporal,
                    deformaciones: defLoo.establidadTemporal
                },
                deltaLoo: {
                    blobs:         { min: blLoo.deltaLooMin,  max: blLoo.deltaLooMax },
                    mutaciones:    { min: mutLoo.deltaLooMin, max: mutLoo.deltaLooMax },
                    deformaciones: { min: defLoo.deltaLooMin, max: defLoo.deltaLooMax }
                }
            };
```

- [ ] **Step 4: `node --check`**

Run: `node --check fr/fr_app.js`
Expected: sin output, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add fr/fr_app.js
git commit -m "feat(fr): captura fecha en records y conecta LOO en bySuAditivo/byGrComponente (MEJ-0003 parte 2)"
```

---

### Task 3: Propagar `estabilidad` a `anomalyRanking` y a `_frCalAnomalyAlert`

**Files:**
- Modify: `fr/fr_app.js:5120-5140` (`anomalyRanking`)
- Modify: `fr/fr_app.js:5207-5221` (`_frCalAnomalyAlert`)

- [ ] **Step 1: `anomalyRanking` — agregar `estabilidad` a cada candidato**

Bloque actual:

```javascript
        var _anomDims = ['mutaciones', 'deformaciones', 'blobs'];
        var anomalyRanking = {};
        _anomDims.forEach(function(dim) {
            var field = 'delta' + dim.charAt(0).toUpperCase() + dim.slice(1);
            var candidates = [];
            Object.keys(bySuAditivo).forEach(function(slug) {
                var d = bySuAditivo[slug];
                if (d.confidence === 'insuficiente') return;
                if (d[field] == null || d[field] <= 0) return;
                candidates.push({ label: d.label, delta: d[field], confidence: d.confidence, fuente: 'SU' });
            });
            Object.keys(byGrComponente).forEach(function(slug) {
                var d = byGrComponente[slug];
                if (d.confidence === 'insuficiente') return;
                if (d[field] == null || d[field] <= 0) return;
                candidates.push({ label: d.label, delta: d[field], confidence: d.confidence, fuente: 'GR' });
            });
            candidates.sort(function(a, b) { return b.delta - a.delta; });
            anomalyRanking[dim] = candidates.slice(0, 3);
        });
```

Reemplazar por (agrega `estabilidad: d.estabilidad[dim]` a cada candidato — no cambia el sort ni el filtro, solo agrega el dato):

```javascript
        var _anomDims = ['mutaciones', 'deformaciones', 'blobs'];
        var anomalyRanking = {};
        _anomDims.forEach(function(dim) {
            var field = 'delta' + dim.charAt(0).toUpperCase() + dim.slice(1);
            var candidates = [];
            Object.keys(bySuAditivo).forEach(function(slug) {
                var d = bySuAditivo[slug];
                if (d.confidence === 'insuficiente') return;
                if (d[field] == null || d[field] <= 0) return;
                candidates.push({ label: d.label, delta: d[field], confidence: d.confidence, fuente: 'SU', estabilidad: d.estabilidad[dim] });
            });
            Object.keys(byGrComponente).forEach(function(slug) {
                var d = byGrComponente[slug];
                if (d.confidence === 'insuficiente') return;
                if (d[field] == null || d[field] <= 0) return;
                candidates.push({ label: d.label, delta: d[field], confidence: d.confidence, fuente: 'GR', estabilidad: d.estabilidad[dim] });
            });
            candidates.sort(function(a, b) { return b.delta - a.delta; });
            anomalyRanking[dim] = candidates.slice(0, 3);
        });
```

- [ ] **Step 2: `_frCalAnomalyAlert` — propagar `estabilidad` a `candidatos`**

Bloque actual:

```javascript
        var candidatos = [];
        var seen = {};
        activas.forEach(function(dim) {
            (intel.anomalyRanking[dim] || []).forEach(function(c) {
                var enEstaBolsa = c.fuente === 'SU' ? !!suLabelsBolsa[c.label] : !!grLabelsBolsa[c.label];
                if (!enEstaBolsa) return;
                var key = c.fuente + '|' + c.label;
                if (!seen[key]) {
                    seen[key] = true;
                    candidatos.push({ label: c.label, delta: c.delta, confidence: c.confidence, fuente: c.fuente, dim: dim });
                }
            });
        });
```

Reemplazar por:

```javascript
        var candidatos = [];
        var seen = {};
        activas.forEach(function(dim) {
            (intel.anomalyRanking[dim] || []).forEach(function(c) {
                var enEstaBolsa = c.fuente === 'SU' ? !!suLabelsBolsa[c.label] : !!grLabelsBolsa[c.label];
                if (!enEstaBolsa) return;
                var key = c.fuente + '|' + c.label;
                if (!seen[key]) {
                    seen[key] = true;
                    candidatos.push({ label: c.label, delta: c.delta, confidence: c.confidence, fuente: c.fuente, dim: dim, estabilidad: c.estabilidad });
                }
            });
        });
```

- [ ] **Step 3: `node --check`**

Run: `node --check fr/fr_app.js`
Expected: sin output, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add fr/fr_app.js
git commit -m "feat(fr): propaga estabilidad temporal a anomalyRanking y _frCalAnomalyAlert (MEJ-0003 parte 3)"
```

---

### Task 4: Caveat en la nota automática (`_frCalBuildObsText`)

**Files:**
- Modify: `fr/fr_app.js:5241-5251`

- [ ] **Step 1: Agregar el caveat al texto**

Bloque actual:

```javascript
        if (alertResult && alertResult.anomalias.length) {
            parts.push('⚠ Anomalía: ' + alertResult.anomalias.join(', '));
            if (alertResult.candidatos.length) {
                var candText = alertResult.candidatos.slice(0, 2).map(function(c) {
                    return '[' + c.fuente + '] ' + c.label + ' (Δ+' + c.delta + '%)';
                }).join(', ');
                parts.push('Candidatos: ' + candText);
            } else {
                parts.push('Sin candidatos con n suficiente aún');
            }
        }
```

Reemplazar por:

```javascript
        if (alertResult && alertResult.anomalias.length) {
            parts.push('⚠ Anomalía: ' + alertResult.anomalias.join(', '));
            if (alertResult.candidatos.length) {
                var candText = alertResult.candidatos.slice(0, 2).map(function(c) {
                    var suffix = c.estabilidad === 'inestable' ? ', ⚠inestable en el tiempo' : '';
                    return '[' + c.fuente + '] ' + c.label + ' (Δ+' + c.delta + '%' + suffix + ')';
                }).join(', ');
                parts.push('Candidatos: ' + candText);
            } else {
                parts.push('Sin candidatos con n suficiente aún');
            }
        }
```

- [ ] **Step 2: `node --check`**

Run: `node --check fr/fr_app.js`
Expected: sin output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add fr/fr_app.js
git commit -m "feat(fr): nota automatica de FR-CAL muestra caveat de inestabilidad temporal (MEJ-0003 parte 4)"
```

---

### Task 5: Panel de detalle FR·CAL — mostrar estabilidad temporal por dimensión

**Files:**
- Modify: `fr/fr_app.js:3066-3118` (cards de `bySuAditivo` y `byGrComponente`)
- Modify: `fr/fr_app.js` (agregar helper cerca de las otras funciones de render del panel, antes de su primer uso en la línea ~3066)

- [ ] **Step 1: Agregar el helper de render**

Insertar antes del bloque `var adKeys = Object.keys(intel.bySuAditivo);` (línea ~3066):

```javascript
        function _frCalEstabilidadRowHTML(estado, loo) {
            if (!estado) return '';
            if (estado === 'no-evaluable') {
                return '<div class="fr-cal-intel-row" style="font-size:0.76rem;color:#888;"><span>Estabilidad temporal</span><span>no evaluable (pocos meses de historia)</span></div>';
            }
            if (estado === 'inestable') {
                var rango = loo ? (' (rango Δ ' + loo.min + ' a ' + loo.max + ')') : '';
                return '<div class="fr-cal-intel-row" style="font-size:0.76rem;color:#e0a030;"><span>Estabilidad temporal</span><span>⚠ inestable' + rango + '</span></div>';
            }
            return '<div class="fr-cal-intel-row" style="font-size:0.76rem;color:#5a5;"><span>Estabilidad temporal</span><span>estable</span></div>';
        }

```

- [ ] **Step 2: Card de `bySuAditivo`**

Bloque actual:

```javascript
                html += '<div class="fr-cal-intel-card">'
                    + '<div class="fr-cal-intel-card-title">' + esc(d.label) + ' <span style="color:#666;">(n=' + d.n + ' / baseline=' + d.nBaseline + ')</span></div>'
                    + '<div class="fr-cal-intel-row"><span>Δ Score auto</span>' + fmtDelta(d.deltaScore, false) + '</div>'
                    + '<div class="fr-cal-intel-row"><span>Δ % Abortos</span>' + fmtDelta(d.deltaAbortos, true) + '</div>'
                    + '<div class="fr-cal-intel-row"><span>Δ % Blobs</span>' + fmtDelta(d.deltaBlobs, true) + '</div>'
                    + '<div class="fr-cal-intel-row"><span>Δ % Mutaciones</span>' + fmtDelta(d.deltaMutaciones, true) + '</div>'
                    + '<div class="fr-cal-intel-row"><span>Δ % Deformaciones</span>' + fmtDelta(d.deltaDeformaciones, true) + '</div>'
                    + (d.confidence ? '<div class="fr-cal-intel-row"><span>Confianza</span><strong>' + esc(d.confidence) + '</strong></div>' : '')
                    + '</div>';
```

Reemplazar por:

```javascript
                html += '<div class="fr-cal-intel-card">'
                    + '<div class="fr-cal-intel-card-title">' + esc(d.label) + ' <span style="color:#666;">(n=' + d.n + ' / baseline=' + d.nBaseline + ')</span></div>'
                    + '<div class="fr-cal-intel-row"><span>Δ Score auto</span>' + fmtDelta(d.deltaScore, false) + '</div>'
                    + '<div class="fr-cal-intel-row"><span>Δ % Abortos</span>' + fmtDelta(d.deltaAbortos, true) + '</div>'
                    + '<div class="fr-cal-intel-row"><span>Δ % Blobs</span>' + fmtDelta(d.deltaBlobs, true) + '</div>'
                    + _frCalEstabilidadRowHTML(d.estabilidad && d.estabilidad.blobs, d.deltaLoo && d.deltaLoo.blobs)
                    + '<div class="fr-cal-intel-row"><span>Δ % Mutaciones</span>' + fmtDelta(d.deltaMutaciones, true) + '</div>'
                    + _frCalEstabilidadRowHTML(d.estabilidad && d.estabilidad.mutaciones, d.deltaLoo && d.deltaLoo.mutaciones)
                    + '<div class="fr-cal-intel-row"><span>Δ % Deformaciones</span>' + fmtDelta(d.deltaDeformaciones, true) + '</div>'
                    + _frCalEstabilidadRowHTML(d.estabilidad && d.estabilidad.deformaciones, d.deltaLoo && d.deltaLoo.deformaciones)
                    + (d.confidence ? '<div class="fr-cal-intel-row"><span>Confianza</span><strong>' + esc(d.confidence) + '</strong></div>' : '')
                    + '</div>';
```

- [ ] **Step 3: Card de `byGrComponente`**

Bloque actual:

```javascript
                html += '<div class="fr-cal-intel-card">'
                    + '<div class="fr-cal-intel-card-title">' + esc(d.label) + ' <span style="color:#666;">(n=' + d.n + ' / baseline=' + d.nBaseline + ')</span></div>'
                    + '<div class="fr-cal-intel-row"><span>Δ Score auto</span>' + fmtDelta(d.deltaScore, false) + '</div>'
                    + '<div class="fr-cal-intel-row"><span>Δ % Mutaciones</span>' + fmtDelta(d.deltaMutaciones, true) + '</div>'
                    + '<div class="fr-cal-intel-row"><span>Δ % Deformaciones</span>' + fmtDelta(d.deltaDeformaciones, true) + '</div>'
                    + '<div class="fr-cal-intel-row"><span>Δ % Blobs</span>' + fmtDelta(d.deltaBlobs, true) + '</div>'
                    + (d.confidence ? '<div class="fr-cal-intel-row"><span>Confianza</span><strong>' + esc(d.confidence) + '</strong></div>' : '')
                    + '</div>';
```

Reemplazar por:

```javascript
                html += '<div class="fr-cal-intel-card">'
                    + '<div class="fr-cal-intel-card-title">' + esc(d.label) + ' <span style="color:#666;">(n=' + d.n + ' / baseline=' + d.nBaseline + ')</span></div>'
                    + '<div class="fr-cal-intel-row"><span>Δ Score auto</span>' + fmtDelta(d.deltaScore, false) + '</div>'
                    + '<div class="fr-cal-intel-row"><span>Δ % Mutaciones</span>' + fmtDelta(d.deltaMutaciones, true) + '</div>'
                    + _frCalEstabilidadRowHTML(d.estabilidad && d.estabilidad.mutaciones, d.deltaLoo && d.deltaLoo.mutaciones)
                    + '<div class="fr-cal-intel-row"><span>Δ % Deformaciones</span>' + fmtDelta(d.deltaDeformaciones, true) + '</div>'
                    + _frCalEstabilidadRowHTML(d.estabilidad && d.estabilidad.deformaciones, d.deltaLoo && d.deltaLoo.deformaciones)
                    + '<div class="fr-cal-intel-row"><span>Δ % Blobs</span>' + fmtDelta(d.deltaBlobs, true) + '</div>'
                    + _frCalEstabilidadRowHTML(d.estabilidad && d.estabilidad.blobs, d.deltaLoo && d.deltaLoo.blobs)
                    + (d.confidence ? '<div class="fr-cal-intel-row"><span>Confianza</span><strong>' + esc(d.confidence) + '</strong></div>' : '')
                    + '</div>';
```

- [ ] **Step 4: `node --check`**

Run: `node --check fr/fr_app.js`
Expected: sin output, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add fr/fr_app.js
git commit -m "feat(fr): panel de detalle FR-CAL muestra estabilidad temporal por dimension (MEJ-0003 parte 5)"
```

---

### Task 6: Verificación end-to-end en Chrome real + invalidar cache vieja

**Files:** ninguno (solo verificación) + `docs/lab-intelligence/mejoras_app.md` (actualización final, no trackeado en git)

- [ ] **Step 1: Levantar el server local si no está corriendo**

Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:8734`
Expected: `200`. Si no, correr `serve.bat` o `start-server.bat` desde la raíz del repo.

- [ ] **Step 2: Cargar un backup real en el navegador y forzar recálculo del cache**

`fr_cal_intel` es un cache — con el fix ya cargado, hay que invalidarlo para que se recalculen `bySuAditivo`/`byGrComponente` con el nuevo shape. Usar Chrome DevTools (MCP `mcp__chrome-devtools__*`) igual que en la verificación de MEJ-0049 de esta sesión: abrir `http://localhost:8734/index.html`, cargar el backup real más reciente vía `fetch()` + `localStorage.setItem` por cada key (excepto `bl2_gh`), después:

```javascript
localStorage.removeItem('fr_cal_intel');
FR.getIntel(); // fuerza rebuild
```

- [ ] **Step 3: Confirmar que al menos un candidato real queda marcado `inestable` o `estable`**

Evaluar en la página:

```javascript
const intel = FR.getIntel();
const conEstabilidad = Object.keys(intel.byGrComponente)
  .map(function(k) { return { k: k, estabilidad: intel.byGrComponente[k].estabilidad }; })
  .concat(Object.keys(intel.bySuAditivo).map(function(k) { return { k: k, estabilidad: intel.bySuAditivo[k].estabilidad }; }));
JSON.stringify(conEstabilidad, null, 2);
```

Expected: al menos una entrada con `estabilidad.mutaciones`/`deformaciones`/`blobs` en `'estable'`, `'inestable'` o `'no-evaluable'` (no `undefined` — confirma que el wiring llegó hasta el cache persistido).

- [ ] **Step 4: Confirmar visualmente el panel**

Navegar al sub-tab de Inteligencia de FR, abrir la sección de correlaciones, tomar una captura o snapshot de accesibilidad (`mcp__chrome-devtools__take_snapshot`) y confirmar que aparece al menos una fila "Estabilidad temporal" con alguno de los 3 textos esperados.

- [ ] **Step 5: Actualizar `docs/lab-intelligence/mejoras_app.md`**

Localizar la entrada `MEJ-0003` y completar el campo `**Resuelto:**` (hoy dice `(vacío hasta que se confirme)`) con el detalle de la implementación: fecha, mecanismo (LOO por mes), archivos tocados, y la aclaración de que sigue "abierta" hasta que el usuario lo confirme en vivo con datos reales de su propio backup (mismo criterio que el resto del archivo — no archivar a `mejoras_app_archivo.md` todavía).

Este archivo está en `.gitignore` (`docs/lab-intelligence/`) — no hace falta commit, es edición directa.

---

## Self-review de este plan

- **Cobertura del spec:** Parte 1 (captura de fecha + LOO) → Task 1 + Task 2. Parte 2 (propagación a ranking, nota, panel) → Task 3, 4, 5. Testing → Task 1 (TDD unitario) + Task 6 (verificación real). Los 4 puntos de "Fuera de alcance" del spec no tienen tarea — correcto, son exclusiones deliberadas.
- **Consistencia de tipos:** `estabilidad`/`deltaLoo` son objetos indexados por `'blobs'|'mutaciones'|'deformaciones'` en `bySuAditivo`/`byGrComponente`/candidatos de ranking; `estabilidad` (singular, string) en los candidatos de `_frCalAnomalyAlert` y en `_frCalBuildObsText` — mismo nombre de campo, tipo distinto a propósito (uno es el mapa completo por dimensión antes de saber cuál dim aplica, el otro ya es el string de la dimensión activa una vez que `dim` está fijado). Verificado que cada Task usa el shape correcto del Task anterior.
- **Sin placeholders:** cada step tiene el código completo a pegar, ningún "TODO"/"similar a".
