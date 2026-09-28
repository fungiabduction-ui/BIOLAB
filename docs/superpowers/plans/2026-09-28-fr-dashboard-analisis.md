# FR Vista General + Análisis BE — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vista General de FR como tabla única filtrable/ordenable con favoritas ⭐, y pestaña nueva "🔎 Análisis BE" con BE en el tiempo (medias móviles), 3 dispersiones de factores de proceso vs BE y ranking de genética.

**Architecture:** Cálculo puro + UI del análisis en archivo nuevo `fr/fr_analisis.js` (IIFE, `window.FRAnalisis`, testeable en Node sin DOM). `fr_app.js` solo gana una API de lectura (`FR.getBolsasSnapshot`), favoritas y la Vista General reescrita. Única key nueva: `fr_analisis_cfg` (exclusiones). Gráficos en SVG inline.

**Tech Stack:** JS vanilla ES5-style (patrón del repo), Node `assert` para tests (sin dependencias), Chrome real + backup real para UI.

**Spec:** `docs/superpowers/specs/2026-09-28-fr-dashboard-analisis-design.md`

---

## File Structure

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `fr/fr_analisis.js` | Crear | Cálculo puro (validez, métricas, hidratación grano, atribución genética, regresión, medias móviles, ranking, exclusiones) + render de la pestaña |
| `tests/fr_analisis.test.js` | Crear | Tests Node de las funciones puras con fixtures sintéticos |
| `fr/fr_app.js` | Modificar | `FR.getBolsasSnapshot`, `FR.toggleFavorita`, `_frStarHtml`, ⭐ en header de detalle, `renderOverview` reescrita, `FR.subTab` con `analisis`, re-render en `renderAll` |
| `fr/fr_index.html` | Modificar | Botón de pestaña + panel `fr-sub-analisis` + `<script src="fr_analisis.js">` |
| `fr/fr_styles.css` | Modificar | Clases `fr-ov-*`, `fr-star*`, `fr-an-*` |
| `CLAUDE.md` | Modificar | Key `fr_analisis_cfg`, campo `favorita`, invariantes |

---

### Task 1: Núcleo de cálculo `fr/fr_analisis.js` (TDD)

**Files:**
- Create: `tests/fr_analisis.test.js`
- Create: `fr/fr_analisis.js`

- [ ] **Step 1: Write the failing tests**

`tests/fr_analisis.test.js`:

```js
// Tests de cálculo puro de fr/fr_analisis.js. Correr: node tests/fr_analisis.test.js
const assert = require('assert');
global.window = {};
require('../fr/fr_analisis.js');
const C = window.FRAnalisis._calc;

let ok = 0;
function t(name, fn) { fn(); ok++; console.log('✓ ' + name); }
const close = (a, b, eps) => assert.ok(Math.abs(a - b) < (eps || 1e-9), a + ' ≉ ' + b);

const grMap = {
  GRA: { id: 'GRA', uf: { cantidad_unidades: 10, peso_unidad: 200 }, componentes: [{ tipo: 'seco', masa: 1000 }, { tipo: 'liquido', masa: 999 }],
         dg: [{ tanda: 'GRA1', fen_id: 'NODE-X', genetica: 'nombre viejo' }, { tanda: 'GRA2', fen_id: 'NODE-Y', genetica: 'Y' }] }, // 100%
  GRB: { id: 'GRB', uf: { cantidad_unidades: 10, peso_unidad: 150 }, componentes: [{ tipo: 'seco', masa: 1000 }],
         dg: [{ tanda: 'GRB1', fen_id: 'NODE-X' }] }, // 50%
  GRC: { id: 'GRC', uf: { cantidad_unidades: 10, peso_unidad: 100 }, componentes: [{ tipo: 'seco', masa: 1000 }], dg: [] } // null
};
const nombreDe = id => ({ 'NODE-X': '244', 'NODE-Y': '210', 'NODE-J': 'Jack Frost' })[id] || null;
function bolsa(o) {
  return Object.assign({ id: 'FRT', fechaInicio: '2026-08-01', granoPorBolsa: 800, pesoSustratoSeco: 200, pesoHumedoHidratado: 1200,
    flushes: [{ beOleada: 300 }], grSources: [{ grLoteId: 'GRA', grTandaId: 'GRA1', grUsados: 2 }] }, o);
}

t('motivoInvalida', () => {
  assert.strictEqual(C.motivoInvalida(bolsa({})), null);
  assert.match(C.motivoInvalida(bolsa({ origen: 'huerfana' })), /huérfana/);
  assert.match(C.motivoInvalida(bolsa({ pesoHumedoHidratado: -0.2 })), /hidratado/);
  assert.match(C.motivoInvalida(bolsa({ granoPorBolsa: null })), /grano/);
  assert.strictEqual(C.motivoInvalida(bolsa({ flushes: [], noFructifico: true })), null);
  assert.strictEqual(C.motivoInvalida(bolsa({ flushes: [] })), 'sin cosechas todavía');
  assert.strictEqual(C.motivoInvalida(bolsa({ pendienteConfirmacion: true })), 'pendiente');
  assert.strictEqual(C.motivoInvalida(bolsa({ cancelada: true })), 'cancelada');
  assert.strictEqual(C.motivoInvalida(bolsa({ flushes: [], contaminada: true })), 'contaminada sin cosecha');
});

t('hidratacionLoteGR (misma fórmula que grCalcularKPIFormulario)', () => {
  close(C.hidratacionLoteGR(grMap.GRA), 100);
  close(C.hidratacionLoteGR(grMap.GRB), 50);
  assert.strictEqual(C.hidratacionLoteGR(grMap.GRC), null);
  assert.strictEqual(C.hidratacionLoteGR(null), null);
});

t('hidrGranoBolsa pondera por frascos y respeta exclusiones de lote', () => {
  const b = bolsa({ grSources: [{ grLoteId: 'GRA', grTandaId: 'GRA1', grUsados: 1 }, { grLoteId: 'GRB', grTandaId: 'GRB1', grUsados: 3 }] });
  close(C.hidrGranoBolsa(b, grMap, {}), 62.5);
  close(C.hidrGranoBolsa(b, grMap, { GRB: true }), 100);
  assert.strictEqual(C.hidrGranoBolsa(b, grMap, { GRA: true, GRB: true }), null);
});

t('atribuirGenetica: mayoría, empate, mismo fen en 2 lotes, fallback NODE-', () => {
  let g = C.atribuirGenetica(bolsa({ grSources: [{ grLoteId: 'GRA', grTandaId: 'GRA1', grUsados: 2 }, { grLoteId: 'GRA', grTandaId: 'GRA2', grUsados: 1 }] }), grMap, nombreDe);
  assert.deepStrictEqual([g.key, g.nombre, g.mezcla, g.detalle], ['NODE-X', '244', true, '244 ×2 + 210 ×1']);
  g = C.atribuirGenetica(bolsa({ grSources: [{ grLoteId: 'GRA', grTandaId: 'GRA1', grUsados: 1 }, { grLoteId: 'GRA', grTandaId: 'GRA2', grUsados: 1 }] }), grMap, nombreDe);
  assert.strictEqual(g.key, C.MEZCLA_PAREJA);
  g = C.atribuirGenetica(bolsa({ grSources: [{ grLoteId: 'GRA', grTandaId: 'GRA1', grUsados: 1 }, { grLoteId: 'GRB', grTandaId: 'GRB1', grUsados: 1 }] }), grMap, nombreDe);
  assert.deepStrictEqual([g.key, g.mezcla, g.detalle], ['NODE-X', false, '244 ×2']);
  g = C.atribuirGenetica(bolsa({ grSources: [{ grLoteId: 'GRZ', grTandaId: 'Z1', grUsados: 1, geneticaFull: 'NODE-J' }] }), grMap, nombreDe);
  assert.deepStrictEqual([g.key, g.nombre], ['NODE-J', 'Jack Frost']);
});

t('regresion sobre una recta exacta', () => {
  const r = C.regresion([1, 2, 3, 4].map(x => ({ x: x, y: 2 * x + 1 })));
  close(r.m, 2); close(r.b, 1); close(r.r, 1);
  assert.strictEqual(C.regresion([{ x: 1, y: 1 }]), null);
});

t('datosGrafico: acum usa solo cerradas para tendencia, f1 usa todas, exclusión por bolsa', () => {
  const validas = [];
  for (let i = 1; i <= 5; i++) validas.push({ id: 'C' + i, cerrada: true, granoSust: i, beAcum: 100 * i, beF1: 50, gen: { nombre: 'x', mezcla: false }, lotesGR: [] });
  validas.push({ id: 'O1', cerrada: false, granoSust: 3, beAcum: 5000, beF1: 50, gen: { nombre: 'x', mezcla: false }, lotesGR: [] });
  let d = C.datosGrafico(validas, 'granoSust', 'acum', { exclusiones: [] });
  assert.strictEqual(d.puntos.length, 6); assert.strictEqual(d.nTendencia, 5); close(d.tendencia.m, 100);
  d = C.datosGrafico(validas, 'granoSust', 'f1', { exclusiones: [] });
  assert.strictEqual(d.nTendencia, 6);
  d = C.datosGrafico(validas, 'granoSust', 'acum', { exclusiones: [{ grafico: 'granoSust', tipo: 'bolsa', id: 'C1' }] });
  assert.strictEqual(d.puntos.length, 5); assert.strictEqual(d.tendencia, null); // quedan 4 cerradas < 5
});

t('rankingGenetica: acum solo cerradas, noFructifico = 0, n>=3 rankea, período', () => {
  const bs = [
    bolsa({ id: 'A1', cicloCerrado: true, flushes: [{ beOleada: 300 }] }),
    bolsa({ id: 'A2', cicloCerrado: true, flushes: [{ beOleada: 200 }, { beOleada: 100 }] }),
    bolsa({ id: 'A3', noFructifico: true, flushes: [] }),
    bolsa({ id: 'A4', flushes: [{ beOleada: 400 }] }), // abierta
    bolsa({ id: 'B1', cicloCerrado: true, flushes: [{ beOleada: 900 }], grSources: [{ grLoteId: 'GRA', grTandaId: 'GRA2', grUsados: 1 }] }),
    bolsa({ id: 'OLD', fechaInicio: '2025-01-01', cicloCerrado: true, flushes: [{ beOleada: 1 }] })
  ];
  const an = C.analizarBolsas(bs, grMap, { exclusiones: [] }, nombreDe);
  let f = C.rankingGenetica(an.validas, 'acum', '2026-01-01');
  assert.strictEqual(f[0].nombre, '244'); assert.strictEqual(f[0].n, 3); close(f[0].bePromedio, 200);
  close(f[0].pctFructifico, 200 / 3); assert.strictEqual(f[0].enCurso, 1); assert.strictEqual(f[0].rankeable, true);
  assert.strictEqual(f[1].nombre, '210'); assert.strictEqual(f[1].rankeable, false); // 900% pero n=1 → abajo
  f = C.rankingGenetica(an.validas, 'f1', '2026-01-01');
  assert.strictEqual(f[0].n, 4); close(f[0].bePromedio, (300 + 200 + 0 + 400) / 4);
  f = C.rankingGenetica(an.validas, 'acum', null);
  assert.strictEqual(f[0].n, 4); // incluye OLD
});

t('restarMeses sin UTC y con fin de mes', () => {
  assert.strictEqual(C.restarMeses('2026-09-28', 3), '2026-06-28');
  assert.strictEqual(C.restarMeses('2026-05-31', 3), '2026-02-28');
  assert.strictEqual(C.restarMeses('2026-02-15', 6), '2025-08-15');
});

t('conExclusion deduplica, sinExclusion quita por índice', () => {
  const e = { grafico: 'hidrGrano', tipo: 'grLote', id: 'GR76', motivo: '', ts: 'x' };
  let cfg = C.conExclusion({ exclusiones: [] }, e);
  cfg = C.conExclusion(cfg, Object.assign({}, e, { motivo: 'otro' }));
  assert.strictEqual(cfg.exclusiones.length, 1);
  assert.strictEqual(C.sinExclusion(cfg, 0).exclusiones.length, 0);
});

t('mediaMovil y serieTiempo', () => {
  assert.deepStrictEqual(C.mediaMovil([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
  const bs = [
    bolsa({ id: 'B', fechaInicio: '2026-08-02', cicloCerrado: true, flushes: [{ beOleada: 200 }] }),
    bolsa({ id: 'A', fechaInicio: '2026-08-01', cicloCerrado: true, flushes: [{ beOleada: 100 }] }),
    bolsa({ id: 'X', fechaInicio: '2026-08-03', contaminada: true, flushes: [], granoPorBolsa: null }),
    bolsa({ id: 'N', fechaInicio: '2026-08-04', noFructifico: true, flushes: [] }),
    bolsa({ id: 'O', fechaInicio: '2026-08-05', flushes: [{ beOleada: 50 }] }),
    bolsa({ id: 'H', origen: 'huerfana' })
  ];
  const s = C.serieTiempo(bs, 'acum', grMap, nombreDe);
  assert.deepStrictEqual(s.puntos.map(p => p.id), ['A', 'B', 'X', 'N', 'O']);
  assert.deepStrictEqual(s.puntos.map(p => p.tipo), ['normal', 'normal', 'contaminada', 'noFructifico', 'normal']);
  assert.strictEqual(s.puntos[2].y, 0);
  // MM5 en acum: solo 4 cerradas → sin valores; MM de ventana 2 no existe, se verifica la base usada:
  assert.strictEqual(s.baseMedias.length, 4);
  assert.strictEqual(s.medias[5].length, 0);
  const s1 = C.serieTiempo(bs, 'f1', grMap, nombreDe);
  assert.strictEqual(s1.baseMedias.length, 5);
  close(s1.medias[5][0].v, (100 + 200 + 0 + 0 + 50) / 5);
});

console.log('\n' + ok + ' tests OK');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tests/fr_analisis.test.js`
Expected: FAIL — `Cannot find module '../fr/fr_analisis.js'`

- [ ] **Step 3: Implement the calc core**

`fr/fr_analisis.js` (el render de la UI se agrega en Task 4 dentro del mismo IIFE, antes del `window.FRAnalisis = ...`):

```js
/* ============================================================
 * FR — Análisis de BE (pestaña "🔎 Análisis BE")
 * Spec: docs/superpowers/specs/2026-09-28-fr-dashboard-analisis-design.md
 *
 * Lectura: bolsas vía FR.getBolsasSnapshot() (copia), gr_lotes y biolab.ge.v4
 * crudos. Única escritura: fr_analisis_cfg (exclusiones del análisis).
 * Nunca escribe fr_bolsas / gr_lotes / su_lotes / GE.
 * Las funciones de cálculo son puras (sin DOM) — tests: tests/fr_analisis.test.js
 * ============================================================ */
(function () {
    'use strict';

    var CFG_KEY = 'fr_analisis_cfg';
    var MIN_TENDENCIA = 5;   // puntos mínimos del conjunto que define la tendencia
    var MIN_RANKING = 3;     // bolsas mínimas para rankear una genética
    var VENTANAS_MM = [5, 10, 20];
    var MEZCLA_PAREJA = '__mezcla_pareja__';
    // Motivos de "no entra" que no son problemas de datos → no se listan como exclusión.
    var MOTIVOS_SILENCIOSOS = { 'pendiente': 1, 'cancelada': 1, 'sin cosechas todavía': 1, 'contaminada sin cosecha': 1 };

    function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
    function int(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function ultimoEslabon(s) { return String(s || '').split('/').pop().trim(); }
    function unicos(arr) { return arr.filter(function (x, i, a) { return x && a.indexOf(x) === i; }); }
    function fmtISO(d) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    function hoyISO() { return fmtISO(new Date()); }

    // Resta meses a 'YYYY-MM-DD' sin pasar por UTC; si el día no existe en el mes
    // destino (31/05 − 3 meses) se ajusta al último día de ese mes.
    function restarMeses(iso, meses) {
        var p = String(iso).split('-').map(Number);
        var y = p[0], m = p[1] - 1 - meses;
        while (m < 0) { m += 12; y--; }
        var ultimo = new Date(y, m + 1, 0).getDate();
        return fmtISO(new Date(y, m, Math.min(p[2], ultimo)));
    }

    // ── Validez (dispersiones + ranking) ──
    function motivoInvalida(b) {
        if (!b) return 'sin datos';
        if (b.pendienteConfirmacion) return 'pendiente';
        if (b.cancelada) return 'cancelada';
        var tieneFlush = Array.isArray(b.flushes) && b.flushes.length > 0;
        if (!tieneFlush && b.noFructifico !== true) return b.contaminada ? 'contaminada sin cosecha' : 'sin cosechas todavía';
        if (b.origen === 'huerfana') return 'huérfana (sin trazabilidad SU→GR)';
        if (!(num(b.granoPorBolsa) > 0)) return 'falta grano por bolsa';
        if (!(num(b.pesoSustratoSeco) > 0)) return 'falta sustrato seco';
        if (!(num(b.pesoHumedoHidratado) > num(b.pesoSustratoSeco))) return 'peso hidratado faltante o menor al seco';
        return null;
    }

    // ── Hidratación del grano ──
    // MISMA fórmula que grCalcularKPIFormulario (gr/gr_app.js), duplicada a propósito:
    // GR no está montado mientras se ve FR. Si cambia allá, cambiar acá.
    function hidratacionLoteGR(lote) {
        if (!lote) return null;
        var prod = lote.uf || lote.produccion || {};
        var masaTotal = num(prod.cantidad_unidades) * num(prod.peso_unidad);
        var masaSeca = 0;
        (lote.componentes || []).forEach(function (c) { if (c && c.tipo === 'seco') masaSeca += num(c.masa); });
        if (masaSeca <= 0 || masaTotal <= masaSeca) return null;
        return (masaTotal - masaSeca) / masaSeca * 100;
    }

    function fuentesDe(b) {
        if (Array.isArray(b.grSources) && b.grSources.length) return b.grSources;
        if (b.grLoteId) return [{ grLoteId: b.grLoteId, grTandaId: b.grTandaId, grUsados: 0, geneticaFull: b.geneticaFull }];
        return [];
    }

    // Promedio ponderado por frascos (grUsados; 0 → peso 1) de la hidratación de los
    // lotes GR de origen, salteando lotes excluidos o sin dato. null si no queda ninguno.
    function hidrGranoBolsa(b, grMap, lotesExcluidos) {
        var suma = 0, peso = 0;
        fuentesDe(b).forEach(function (s) {
            if (!s || !s.grLoteId || (lotesExcluidos && lotesExcluidos[s.grLoteId])) return;
            var h = hidratacionLoteGR(grMap[s.grLoteId]);
            if (h == null) return;
            var w = int(s.grUsados) || 1;
            suma += h * w; peso += w;
        });
        return peso > 0 ? suma / peso : null;
    }

    // ── Genética ──
    function tandaDe(grMap, s) {
        var l = s && grMap[s.grLoteId];
        if (!l || !Array.isArray(l.dg)) return null;
        for (var i = 0; i < l.dg.length; i++) if (l.dg[i].tanda === s.grTandaId) return l.dg[i];
        return null;
    }

    // Atribuye la bolsa a la genética con más frascos. Identidad = fen_id de la tanda GR
    // (el texto guardado puede estar desactualizado: "F2B 103" = nodo GE "F2B"). Empate → mezcla pareja.
    function atribuirGenetica(b, grMap, nombreDe) {
        var grupos = {}, orden = [];
        function sumar(fenId, texto, frascos) {
            if (!fenId && /^NODE-/.test(texto)) fenId = texto;   // tanda que guardó el id crudo como nombre
            var key = fenId || ('txt:' + texto);
            if (!grupos[key]) { grupos[key] = { key: key, fenId: fenId, texto: texto, frascos: 0 }; orden.push(key); }
            grupos[key].frascos += frascos;
        }
        fuentesDe(b).forEach(function (s) {
            var t = tandaDe(grMap, s);
            sumar((t && t.fen_id) || null, ultimoEslabon(s.geneticaFull || (t && t.genetica) || ''), int(s.grUsados) || 1);
        });
        if (!orden.length) sumar(b.fenId || null, ultimoEslabon(b.geneticaFull || ''), 1);
        var lista = orden.map(function (k) { return grupos[k]; }).sort(function (a, c) { return c.frascos - a.frascos; });
        function nombre(g) { return (g.fenId && nombreDe(g.fenId)) || g.texto || '—'; }
        var mezcla = lista.length > 1;
        var empate = mezcla && lista[0].frascos === lista[1].frascos;
        return {
            key: empate ? MEZCLA_PAREJA : lista[0].key,
            nombre: empate ? '🧬 Mezcla pareja' : nombre(lista[0]),
            mezcla: mezcla,
            detalle: lista.map(function (g) { return nombre(g) + ' ×' + g.frascos; }).join(' + ')
        };
    }

    // ── Métricas ──
    function beDe(b, modo) {
        var fl = Array.isArray(b.flushes) ? b.flushes : [];
        if (modo === 'f1') return fl.length ? num(fl[0].beOleada) : 0;
        return fl.reduce(function (a, f) { return a + num(f.beOleada); }, 0);
    }

    function metricasBolsa(b, grMap, lotesExcluidosGrano, nombreDe) {
        var seco = num(b.pesoSustratoSeco), hid = num(b.pesoHumedoHidratado);
        var fl = Array.isArray(b.flushes) ? b.flushes : [];
        return {
            id: b.id,
            fechaInicio: b.fechaInicio || '',
            cerrada: !!(b.cicloCerrado || b.noFructifico || b.contaminada),
            noFructifico: b.noFructifico === true && fl.length === 0,
            beAcum: beDe(b, 'acum'),
            beF1: beDe(b, 'f1'),
            granoSust: num(b.granoPorBolsa) / seco,
            hidrSust: (hid - seco) / seco * 100,
            hidrGrano: hidrGranoBolsa(b, grMap, lotesExcluidosGrano),
            lotesGR: unicos(fuentesDe(b).map(function (s) { return s.grLoteId; })),
            gen: atribuirGenetica(b, grMap, nombreDe)
        };
    }

    // Separa bolsas en válidas (con métricas) y excluidas con motivo visible.
    function analizarBolsas(bolsas, grMap, cfg, nombreDe) {
        var lotesExcl = {};
        (cfg.exclusiones || []).forEach(function (e) { if (e.grafico === 'hidrGrano' && e.tipo === 'grLote') lotesExcl[e.id] = true; });
        var validas = [], excluidas = [];
        bolsas.forEach(function (b) {
            var mot = motivoInvalida(b);
            if (mot == null) validas.push(metricasBolsa(b, grMap, lotesExcl, nombreDe));
            else if (!MOTIVOS_SILENCIOSOS[mot]) excluidas.push({ id: b.id, motivo: mot });
        });
        return { validas: validas, excluidas: excluidas };
    }

    // ── Estadística ──
    function regresion(pts) {
        var n = pts.length;
        if (n < 2) return null;
        var mx = 0, my = 0;
        pts.forEach(function (p) { mx += p.x; my += p.y; });
        mx /= n; my /= n;
        var sxx = 0, syy = 0, sxy = 0;
        pts.forEach(function (p) {
            sxx += (p.x - mx) * (p.x - mx); syy += (p.y - my) * (p.y - my); sxy += (p.x - mx) * (p.y - my);
        });
        if (sxx === 0) return null;
        var m = sxy / sxx;
        return { n: n, m: m, b: my - m * mx, r: syy > 0 ? sxy / Math.sqrt(sxx * syy) : null };
    }

    function mediaMovil(valores, ventana) {
        var out = [], suma = 0;
        for (var i = 0; i < valores.length; i++) {
            suma += valores[i];
            if (i >= ventana) suma -= valores[i - ventana];
            out.push(i >= ventana - 1 ? suma / ventana : null);
        }
        return out;
    }

    // Puntos de una dispersión + tendencia. 'acum': tendencia solo con cerradas; 'f1': todas.
    function datosGrafico(validas, graficoKey, modo, cfg) {
        var bolsasExcl = {};
        (cfg.exclusiones || []).forEach(function (e) { if (e.grafico === graficoKey && e.tipo === 'bolsa') bolsasExcl[e.id] = true; });
        var puntos = [];
        validas.forEach(function (m) {
            var x = m[graficoKey];
            if (x == null || !isFinite(x) || bolsasExcl[m.id]) return;
            puntos.push({ id: m.id, x: x, y: modo === 'f1' ? m.beF1 : m.beAcum, cerrada: m.cerrada, gen: m.gen, lotesGR: m.lotesGR });
        });
        var base = modo === 'f1' ? puntos : puntos.filter(function (p) { return p.cerrada; });
        return { puntos: puntos, nTendencia: base.length, tendencia: base.length >= MIN_TENDENCIA ? regresion(base) : null };
    }

    // Serie temporal de BE por fecha de armado. Incluye contaminadas (BE producido, 0 si nada)
    // y no fructificó (0); no exige datos de grano/hidratación. Medias móviles por cantidad de
    // bolsas: en 'acum' solo cerradas (las abiertas tienen BE parcial), en 'f1' todas.
    function serieTiempo(bolsas, modo, grMap, nombreDe) {
        var puntos = [];
        bolsas.forEach(function (b) {
            if (!b || b.pendienteConfirmacion || b.cancelada || b.origen === 'huerfana' || !b.fechaInicio) return;
            var fl = Array.isArray(b.flushes) ? b.flushes : [];
            if (!fl.length && !b.noFructifico && !b.contaminada) return;
            puntos.push({
                id: b.id, fecha: b.fechaInicio, y: beDe(b, modo),
                cerrada: !!(b.cicloCerrado || b.noFructifico || b.contaminada),
                tipo: b.contaminada ? 'contaminada' : (b.noFructifico ? 'noFructifico' : 'normal'),
                gen: atribuirGenetica(b, grMap, nombreDe)
            });
        });
        puntos.sort(function (a, c) { return a.fecha < c.fecha ? -1 : a.fecha > c.fecha ? 1 : (a.id < c.id ? -1 : 1); });
        var base = modo === 'f1' ? puntos : puntos.filter(function (p) { return p.cerrada; });
        var medias = {};
        VENTANAS_MM.forEach(function (w) {
            var mm = mediaMovil(base.map(function (p) { return p.y; }), w);
            medias[w] = [];
            mm.forEach(function (v, i) { if (v != null) medias[w].push({ fecha: base[i].fecha, v: v }); });
        });
        return { puntos: puntos, baseMedias: base, medias: medias };
    }

    // ── Ranking de genética ──
    function rankingGenetica(validas, modo, desde) {
        var g = {};
        validas.forEach(function (m) {
            if (desde && m.fechaInicio < desde) return;
            var k = m.gen.key;
            var r = g[k] || (g[k] = { key: k, nombre: m.gen.nombre, valores: [], noFruct: 0, enCurso: 0, mezclas: [] });
            if (modo === 'acum' && !m.cerrada) { r.enCurso++; return; }
            r.valores.push(modo === 'f1' ? m.beF1 : m.beAcum);
            if (m.noFructifico) r.noFruct++;
            if (m.gen.mezcla) r.mezclas.push(m.id + ': ' + m.gen.detalle);
        });
        var filas = Object.keys(g).map(function (k) {
            var r = g[k], n = r.valores.length;
            return {
                key: k, nombre: r.nombre, n: n,
                bePromedio: n ? r.valores.reduce(function (a, v) { return a + v; }, 0) / n : null,
                mejor: n ? Math.max.apply(null, r.valores) : null,
                pctFructifico: n ? (n - r.noFruct) / n * 100 : null,
                enCurso: r.enCurso, nMezcla: r.mezclas.length, mezclas: r.mezclas,
                rankeable: n >= MIN_RANKING
            };
        });
        filas.sort(function (a, b) {
            if (a.rankeable !== b.rankeable) return a.rankeable ? -1 : 1;
            return (b.bePromedio == null ? -1 : b.bePromedio) - (a.bePromedio == null ? -1 : a.bePromedio);
        });
        return filas;
    }

    // ── Config de exclusiones (puras) ──
    function conExclusion(cfg, ex) {
        var lista = cfg.exclusiones || [];
        var ya = lista.some(function (e) { return e.grafico === ex.grafico && e.tipo === ex.tipo && e.id === ex.id; });
        return ya ? cfg : Object.assign({}, cfg, { exclusiones: lista.concat([ex]) });
    }
    function sinExclusion(cfg, idx) {
        return Object.assign({}, cfg, { exclusiones: (cfg.exclusiones || []).filter(function (_, i) { return i !== idx; }) });
    }

    /* __FR_ANALISIS_UI__ (Task 4) */

    window.FRAnalisis = Object.assign(window.FRAnalisis || {}, {
        _calc: {
            motivoInvalida: motivoInvalida, hidratacionLoteGR: hidratacionLoteGR, hidrGranoBolsa: hidrGranoBolsa,
            atribuirGenetica: atribuirGenetica, metricasBolsa: metricasBolsa, analizarBolsas: analizarBolsas,
            regresion: regresion, mediaMovil: mediaMovil, datosGrafico: datosGrafico, serieTiempo: serieTiempo,
            rankingGenetica: rankingGenetica, restarMeses: restarMeses, conExclusion: conExclusion,
            sinExclusion: sinExclusion, MEZCLA_PAREJA: MEZCLA_PAREJA
        }
    });
})();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/fr_analisis.test.js`
Expected: `10 tests OK`

- [ ] **Step 5: Commit**

```bash
git add fr/fr_analisis.js tests/fr_analisis.test.js
git commit -m "feat(fr): núcleo de cálculo del análisis de BE (puro, con tests)"
```

---

### Task 2: API de lectura + favoritas ⭐ en `fr_app.js`

**Files:**
- Modify: `fr/fr_app.js` (junto a `FR._all`, ~línea 6600; header de detalle en `renderDashboard`, ~línea 2058)

- [ ] **Step 1: Snapshot + favoritas** — agregar después de `FR._all = function() { return bolsas; };`:

```js
    // Copia profunda para lectores externos (fr_analisis.js) — nunca la referencia interna.
    FR.getBolsasSnapshot = function() { return JSON.parse(JSON.stringify(bolsas)); };

    // ⭐ Favorita: anotación del operador, no trazabilidad — permitida en bolsas selladas y
    // archivadas (no toca grSources/pesos/fechas, Regla 9 intacta). Motivo opcional.
    FR.toggleFavorita = function(id) {
        var b = bolsas.find(function(x) { return x.id === id; });
        if (!b || esPendiente(b) || b.cancelada) return;
        if (b.favorita) {
            if (!confirm('¿Quitar ' + b.id + ' de favoritas?' + (b.favorita.motivo ? '\nMotivo guardado: ' + b.favorita.motivo : ''))) return;
            b.favorita = null;
            addObsTo(b, '☆ Quitada de favoritas.', 'auto', 'none');
        } else {
            var motivo = prompt('⭐ Marcar ' + b.id + ' como favorita.\nMotivo (opcional):', '');
            if (motivo === null) return;
            motivo = String(motivo).trim();
            b.favorita = { ts: new Date().toISOString(), motivo: motivo };
            addObsTo(b, '⭐ Marcada como favorita' + (motivo ? ': ' + motivo : '.'), 'auto', 'green');
        }
        saveBolsas();
        renderAll();
    };
```

- [ ] **Step 2: Helper de estrella** — agregar antes de `function renderOverview(container)`:

```js
    function _frStarHtml(b) {
        if (!b || !b.id || esPendiente(b) || b.cancelada) return '';
        var on = !!b.favorita;
        var tip = on ? ('Favorita' + (b.favorita.motivo ? ': ' + b.favorita.motivo : '') + ' — clic para quitar') : 'Marcar como favorita';
        return '<button type="button" class="fr-star' + (on ? ' fr-star-on' : '') + '" title="' + esc(tip) + '"'
            + ' onclick="event.stopPropagation();FR.toggleFavorita(\'' + esc(b.id) + '\')">' + (on ? '★' : '☆') + '</button>';
    }
```

- [ ] **Step 3: Estrella + motivo en el header de detalle** — en `renderDashboard`, cambiar `+ huerfanaBadge` (dentro de `titleEl.innerHTML = ...`) por:

```js
                + huerfanaBadge
                + ' ' + _frStarHtml(b)
                + (b.favorita && b.favorita.motivo ? '<span class="fr-star-motivo">' + esc(b.favorita.motivo) + '</span>' : '')
```

- [ ] **Step 4: Verificar sintaxis**

Run: `node --check fr/fr_app.js`
Expected: sin salida (exit 0)

- [ ] **Step 5: Commit**

```bash
git add fr/fr_app.js
git commit -m "feat(fr): bolsas favoritas con motivo y snapshot de lectura para análisis"
```

---

### Task 3: Vista General — tabla única con filtros y orden

**Files:**
- Modify: `fr/fr_app.js` — `renderOverview` (~2910-3040), borrar `_ovFilas`/`_ovSecHeader` (quedan sin uso)
- Modify: `fr/fr_styles.css`

- [ ] **Step 1: Estado + definición de columnas/filtros** — agregar antes de `function renderOverview`:

```js
    // Vista General (spec 2026-09-28): tabla única, filtro por chip y orden por columna.
    // Estado solo en memoria (no se persiste).
    var _ovFiltro = 'todas';
    var _ovSort = { key: 'armado', dir: -1 };
    var _OV_FILTROS = [
        { key: 'todas',   label: 'Todas',          fn: function(b) { return true; } },
        { key: 'pend',    label: '⏳ Pendientes',  fn: esPendiente, soloSiHay: true },
        { key: 'cultivo', label: '🟢 En cultivo',  fn: esEnCultivo },
        { key: 'cosecha', label: '🌊 Cosecha',     fn: esCosecha },
        { key: 'archivo', label: '🔴 Archivo',     fn: esArchivada },
        { key: 'fav',     label: '⭐ Favoritas',   fn: function(b) { return !!b.favorita; } }
    ];
    var _OV_COLS = [
        { key: 'fav', label: '⭐' }, { key: 'id', label: 'ID' }, { key: 'gen', label: 'Genética' },
        { key: 'su', label: 'SU' }, { key: 'gr', label: 'GR' }, { key: 'estado', label: 'Estado' },
        { key: 'armado', label: 'Armado' }, { key: 'dias', label: 'Días', num: true }, { key: 'fn', label: 'F#', num: true },
        { key: 'ult', label: 'Últ. oleada' }, { key: 'fresco', label: 'Fresco', num: true }, { key: 'be', label: 'BE', num: true },
        { key: 'seco', label: 'Seco', num: true }, { key: 'desh', label: '% desh.', num: true }
    ];

    function _frDiasBolsa(b) {
        return b.cicloCerrado && b.fechaCierreCiclo ? diasEntre(b.fechaInicio, b.fechaCierreCiclo)
            : b.noFructifico && b.fechaNoFructifico ? diasEntre(b.fechaInicio, b.fechaNoFructifico)
            : diasEntre(b.fechaInicio, hoyISO());
    }
    function _frUltOleada(b) {
        return (b.flushes || []).reduce(function(m, f) { return (f.fecha || '') > m ? (f.fecha || '') : m; }, '');
    }
    function _ovSortVal(b, key) {
        switch (key) {
            case 'fav':    return b.favorita ? 1 : 0;
            case 'id':     return (b.id || '').toLowerCase();
            case 'gen':    return _geTxtFromBolsa(b).toLowerCase();
            case 'su':     return ((b.suLoteId || '') + ' ' + (b.suSubTanda || '')).toLowerCase();
            case 'gr':     return _grTxtFromBolsa(b).toLowerCase();
            case 'estado': return computeEstado(b);
            case 'armado': return b.fechaInicio || '';
            case 'dias':   var d = _frDiasBolsa(b); return d == null ? -1 : d;
            case 'fn':     return (b.flushes || []).length;
            case 'ult':    return _frUltOleada(b);
            case 'fresco': return rendimientoFresco(b.flushes);
            case 'be':     return beAcumulado(b.flushes);
            case 'seco':   return biomasaSecaTotal(b.flushes);
            case 'desh':   var p = pctDeshidBolsa(b.flushes); return p == null ? -1 : p;
        }
        return '';
    }

    FR._ovFiltrar = function(key) { _ovFiltro = key; renderDashboard(); };
    FR._ovOrdenar = function(key) {
        if (_ovSort.key === key) _ovSort.dir = -_ovSort.dir;
        else _ovSort = { key: key, dir: (key === 'id' || key === 'gen' || key === 'su' || key === 'gr' || key === 'estado') ? 1 : -1 };
        renderDashboard();
    };

    function _ovFila(b) {
        var pend = esPendiente(b);
        var estado = computeEstado(b);
        var cl = pend ? '' : ' onclick="FR.select(\'' + esc(b.id) + '\')"';
        var fs = b.flushes || [];
        var fresco = rendimientoFresco(fs), be = beAcumulado(fs), seco = biomasaSecaTotal(fs), desh = pctDeshidBolsa(fs);
        var pendFs = _frFlushesPendientesSecar(b);
        var chipPend = pendFs.length ? ' <span class="fr-chip fr-chip-pendiente" title="Oleadas sin peso deshidratado: ' + pendFs.join(', ') + '">PENDIENTE ' + pendFs.join('·') + '</span>' : '';
        var dias = _frDiasBolsa(b), ult = _frUltOleada(b);
        var huerfana = b.origen === 'huerfana' ? ' <span class="fr-chip fr-chip-huerfana" title="Bolsa huérfana">H</span>' : '';
        return '<tr class="fr-row"' + (pend ? '' : ' style="cursor:pointer"') + cl + '>'
            + '<td>' + _frStarHtml(b) + '</td>'
            + '<td><strong>' + esc(b.id || '—') + '</strong>' + huerfana + '</td>'
            + '<td>' + _geChipFromBolsa(b) + '</td>'
            + '<td>' + _suSubChip(b) + '</td>'
            + '<td>' + _grChipFromBolsa(b) + '</td>'
            + '<td><span class="fr-chip ' + _ovChipClass(estado) + '">' + esc(_OV_LABELS[estado] || estado) + '</span></td>'
            + '<td class="fr-num-days">' + esc(fmtFecha(b.fechaInicio)) + '</td>'
            + '<td class="fr-num-days">' + (dias != null ? dias + 'd' : '—') + '</td>'
            + '<td class="fr-num">' + (fs.length || '—') + '</td>'
            + '<td class="fr-num-days">' + (ult ? esc(fmtFecha(ult)) : '—') + '</td>'
            + '<td class="fr-num">' + (fresco > 0 ? fmt(fresco, 1) + ' g' : '—') + '</td>'
            + '<td class="fr-num-pct">' + (be > 0 ? fmt(be, 1) + '%' : '—') + '</td>'
            + '<td class="fr-num">' + (seco > 0 ? fmt(seco, 1) + ' g' : (chipPend ? '' : '—')) + chipPend + '</td>'
            + '<td class="fr-num-pct">' + (desh != null ? fmt(desh, 1) + '%' : '—') + '</td>'
            + '</tr>';
    }
```

- [ ] **Step 2: Reemplazar la parte de tabla de `renderOverview`** — conservar el bloque de KPIs (desde `// ── KPIs sistémicos del Dashboard ──` hasta el cierre de `kpiHtml`). Reemplazar desde el inicio de la función hasta antes de `// ── KPIs` por:

```js
    function renderOverview(container) {
        if (!container) return;
```

y reemplazar desde `// ── Tabla ──` hasta el final de la función por:

```js
        // ── Tabla única ──
        var base = bolsas.filter(function(b) { return !b.cancelada; });
        var filtroDef = _OV_FILTROS.filter(function(f) { return f.key === _ovFiltro; })[0] || _OV_FILTROS[0];
        var filas = base.filter(filtroDef.fn).slice().sort(function(a, b) {
            var va = _ovSortVal(a, _ovSort.key), vb = _ovSortVal(b, _ovSort.key);
            if (va < vb) return -_ovSort.dir;
            if (va > vb) return _ovSort.dir;
            return (b.fechaInicio || '') < (a.fechaInicio || '') ? -1 : 1;
        });
        var chips = _OV_FILTROS.map(function(f) {
            var n = base.filter(f.fn).length;
            if (f.soloSiHay && !n) return '';
            return '<button type="button" class="fr-ov-filtro' + (f.key === _ovFiltro ? ' fr-ov-filtro-on' : '') + '"'
                + ' onclick="FR._ovFiltrar(\'' + f.key + '\')">' + f.label + ' ' + n + '</button>';
        }).join('');
        var thead = _OV_COLS.map(function(c) {
            var flecha = _ovSort.key === c.key ? (_ovSort.dir > 0 ? ' ↑' : ' ↓') : '';
            return '<th class="fr-ov-th-sort' + (c.num ? ' fr-num' : '') + '" onclick="FR._ovOrdenar(\'' + c.key + '\')" title="Ordenar">' + c.label + flecha + '</th>';
        }).join('');
        var tbody = filas.length
            ? filas.map(_ovFila).join('')
            : '<tr><td colspan="' + _OV_COLS.length + '" class="fr-empty">'
              + (base.length ? 'Ninguna bolsa en este filtro.' : 'Sin registros FR. Usá <strong>🔄 Sync desde SU</strong> para importar bolsas.')
              + '</td></tr>';

        container.innerHTML =
            '<div class="section-header">'
            + '<h2>📋 Vista General</h2>'
            + '<span class="fr-dash-subtle">Seleccioná una bolsa para abrir su dashboard.</span>'
            + '</div>'
            + '<div class="section-content">'
            + '<div class="metrics-panel" style="margin:0 0 16px 0;padding:16px">' + kpiHtml + '</div>'
            + '<div class="fr-ov-filtros">' + chips + '</div>'
            + '<div class="table-wrap">'
            +   '<table class="data-table fr-ov-table">'
            +     '<thead><tr>' + thead + '</tr></thead>'
            +     '<tbody>' + tbody + '</tbody>'
            +   '</table>'
            + '</div>'
            + '</div>';
    }
```

- [ ] **Step 3: Borrar `_ovFilas` y `_ovSecHeader`** (quedan sin llamadas). Verificar:

Run: `grep -n "_ovFilas\|_ovSecHeader" fr/fr_app.js`
Expected: sin resultados

- [ ] **Step 4: CSS** — agregar al final de `fr/fr_styles.css`:

```css
/* ── Vista General: tabla única + favoritas (2026-09-28) ── */
.fr-ov-filtros { display: flex; gap: 6px; flex-wrap: wrap; margin: 4px 0 10px; }
.fr-ov-filtro {
    padding: 3px 10px; border-radius: 12px; border: 1px solid var(--border);
    background: transparent; color: var(--text-muted); font-size: 12px; cursor: pointer;
}
.fr-ov-filtro-on { background: rgba(232,99,122,0.2); border-color: var(--fr-main); color: var(--text-light); }
.fr-ov-th-sort { cursor: pointer; user-select: none; white-space: nowrap; }
.fr-ov-th-sort:hover { color: var(--fr-main-soft); }
.fr-star {
    background: none; border: none; cursor: pointer; font-size: 15px; line-height: 1;
    color: var(--text-muted); padding: 0 2px;
}
.fr-star-on { color: #F5C518; }
.fr-star-motivo { font-size: 12px; color: var(--text-muted); font-style: italic; margin-left: 6px; }
```

- [ ] **Step 5: Verificar sintaxis y commit**

Run: `node --check fr/fr_app.js`
Expected: exit 0

```bash
git add fr/fr_app.js fr/fr_styles.css
git commit -m "feat(fr): Vista General como tabla única con filtros, orden y favoritas"
```

---

### Task 4: Pestaña 🔎 Análisis BE (UI)

**Files:**
- Modify: `fr/fr_analisis.js` (reemplazar el marcador `/* __FR_ANALISIS_UI__ (Task 4) */`)
- Modify: `fr/fr_index.html` (tab ~línea 27, panel ~línea 580, script ~línea 842)
- Modify: `fr/fr_app.js` (`FR.subTab` ~3604, `renderAll` ~3041)
- Modify: `fr/fr_styles.css`

- [ ] **Step 1: UI en `fr_analisis.js`** — reemplazar `/* __FR_ANALISIS_UI__ (Task 4) */` por:

```js
    // ── Config (lectura/escritura en storage) ──
    function leerCfg() {
        try {
            var c = JSON.parse(localStorage.getItem(CFG_KEY) || 'null');
            if (c && Array.isArray(c.exclusiones)) return c;
        } catch (e) {}
        return { exclusiones: [] };
    }
    function guardarCfg(cfg) {
        try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); return true; }
        catch (e) {
            if (window.BioLog) window.BioLog.logError('FR', 'guardar ' + CFG_KEY, e);
            alert('⚠ No se pudo guardar la exclusión (¿localStorage lleno?).');
            return false;
        }
    }
    function leerGrMap() {
        var m = {};
        try { (JSON.parse(localStorage.getItem('gr_lotes') || '[]') || []).forEach(function (l) { if (l && l.id) m[l.id] = l; }); } catch (e) {}
        return m;
    }
    function nombreGenetica(fenId) {
        try {
            if (window.ge && typeof window.ge.getNode === 'function') {
                var n = window.ge.getNode(fenId);
                if (n && n.name) return n.name;
            }
            if (window.GEResolve && typeof window.GEResolve.resolverNodoCrudo === 'function') {
                var r = window.GEResolve.resolverNodoCrudo(fenId);
                if (r && r.chain && r.chain.length) return r.chain[r.chain.length - 1].name;
            }
        } catch (e) {}
        return null;
    }

    // ── UI ──
    var GRAFICOS = [
        { key: 'granoSust', titulo: '🌾 Grano / sustrato seco vs BE', eje: 'grano ÷ sustrato seco', fmt: function (v) { return v.toFixed(1); } },
        { key: 'hidrSust',  titulo: '💧 Agua en sustrato vs BE',      eje: 'hidratación del sustrato', fmt: function (v) { return v.toFixed(0) + '%'; } },
        { key: 'hidrGrano', titulo: '🫙 Agua en grano vs BE',          eje: 'hidratación del grano (lote GR)', fmt: function (v) { return v.toFixed(0) + '%'; } }
    ];
    var PERIODOS = [{ key: '3', label: 'Últimos 3 meses', meses: 3 }, { key: '6', label: 'Últimos 6 meses', meses: 6 }, { key: 'todo', label: 'Todo', meses: null }];
    var MM_COLORES = { 5: '#5C9CE0', 10: '#C15FCB', 20: '#E8A83D' };
    var MM_NOMBRES = { 5: 'MM5 rápida', 10: 'MM10 media', 20: 'MM20 lenta' };
    var ui = { modo: 'acum', periodo: '3', container: null };

    function btnToggle(key, label, actual, fn) {
        return '<button type="button" class="fr-an-toggle-btn' + (key === actual ? ' fr-an-on' : '') + '"'
            + ' onclick="FRAnalisis.' + fn + '(\'' + key + '\')">' + esc(label) + '</button>';
    }
    function fechaADate(iso) { var p = String(iso).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
    function ejeY(max) { return Math.max(100, Math.ceil(max / 100) * 100); }

    function svgTiempo(s) {
        if (!s.puntos.length) return '<div class="fr-an-vacio">Sin bolsas con cosecha todavía.</div>';
        var W = 760, H = 260, L = 44, R = 12, T = 10, B = 30;
        var t0 = fechaADate(s.puntos[0].fecha).getTime(), t1 = fechaADate(s.puntos[s.puntos.length - 1].fecha).getTime();
        if (t1 === t0) { t0 -= 864e5; t1 += 864e5; }
        var yMax = ejeY(Math.max.apply(null, s.puntos.map(function (p) { return p.y; })));
        function X(iso) { return L + (fechaADate(iso).getTime() - t0) / (t1 - t0) * (W - L - R); }
        function Y(v) { return H - B - v / yMax * (H - B - T); }
        var h = '<svg class="fr-an-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="BE en el tiempo">';
        for (var v = 0; v <= yMax; v += 100) {
            h += '<line class="fr-an-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/>'
               + '<text class="fr-an-tick" x="' + (L - 4) + '" y="' + (Y(v) + 3) + '" text-anchor="end">' + v + '%</text>';
        }
        var d = new Date(t0); d.setDate(1); d.setMonth(d.getMonth() + 1);
        var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
        while (d.getTime() <= t1) {
            var xm = L + (d.getTime() - t0) / (t1 - t0) * (W - L - R);
            h += '<line class="fr-an-grid" x1="' + xm + '" x2="' + xm + '" y1="' + T + '" y2="' + (H - B) + '"/>'
               + '<text class="fr-an-tick" x="' + xm + '" y="' + (H - 12) + '" text-anchor="middle">' + MESES[d.getMonth()] + '</text>';
            d.setMonth(d.getMonth() + 1);
        }
        VENTANAS_MM.forEach(function (w) {
            var serie = s.medias[w];
            if (serie.length < 2) return;
            h += '<polyline class="fr-an-mm" stroke="' + MM_COLORES[w] + '" points="'
               + serie.map(function (p) { return X(p.fecha).toFixed(1) + ',' + Y(p.v).toFixed(1); }).join(' ') + '"/>';
        });
        s.puntos.forEach(function (p) {
            var cx = X(p.fecha).toFixed(1), cy = Y(p.y).toFixed(1);
            var tip = p.id + ' · ' + p.gen.nombre + (p.gen.mezcla ? ' (mezcla: ' + p.gen.detalle + ')' : '')
                + '\nArmada ' + p.fecha + ' · BE ' + p.y.toFixed(0) + '%'
                + (p.tipo === 'contaminada' ? '\n☣ contaminada' : p.tipo === 'noFructifico' ? '\n🕳 no fructificó' : (p.cerrada ? '\nciclo cerrado' : '\nen producción (BE parcial)'));
            if (p.tipo === 'contaminada') {
                h += '<g class="fr-an-mk-cont"><path d="M' + (cx - 4) + ' ' + (cy - 4) + 'L' + (+cx + 4) + ' ' + (+cy + 4) + 'M' + (+cx + 4) + ' ' + (cy - 4) + 'L' + (cx - 4) + ' ' + (+cy + 4) + '"/><title>' + esc(tip) + '</title></g>';
            } else if (p.tipo === 'noFructifico') {
                h += '<path class="fr-an-mk-nf" d="M' + (cx - 4.5) + ' ' + (cy - 4) + 'L' + (+cx + 4.5) + ' ' + (cy - 4) + 'L' + cx + ' ' + (+cy + 4) + 'Z"><title>' + esc(tip) + '</title></path>';
            } else {
                h += '<circle class="fr-an-pt' + (p.cerrada ? ' fr-an-pt-cerrada' : '') + '" cx="' + cx + '" cy="' + cy + '" r="3.4"><title>' + esc(tip) + '</title></circle>';
            }
        });
        return h + '</svg>';
    }

    function svgDispersion(def, d) {
        if (!d.puntos.length) return '<div class="fr-an-vacio">Sin bolsas con este dato.</div>';
        var W = 320, H = 200, L = 40, R = 10, T = 10, B = 30;
        var xs = d.puntos.map(function (p) { return p.x; });
        var xMin = Math.min.apply(null, xs), xMax = Math.max.apply(null, xs);
        var x0 = xMin, x1 = xMax;
        if (x0 === x1) { x0 -= 1; x1 += 1; }
        var pad = (x1 - x0) * 0.05; x0 -= pad; x1 += pad;
        var yMax = ejeY(Math.max.apply(null, d.puntos.map(function (p) { return p.y; })));
        function X(v) { return L + (v - x0) / (x1 - x0) * (W - L - R); }
        function Y(v) { return H - B - v / yMax * (H - B - T); }
        var clip = 'frAnClip-' + def.key;
        var h = '<svg class="fr-an-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(def.titulo) + '">'
            + '<defs><clipPath id="' + clip + '"><rect x="' + L + '" y="' + T + '" width="' + (W - L - R) + '" height="' + (H - B - T) + '"/></clipPath></defs>';
        for (var v = 0; v <= yMax; v += 100) {
            h += '<line class="fr-an-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/>'
               + '<text class="fr-an-tick" x="' + (L - 4) + '" y="' + (Y(v) + 3) + '" text-anchor="end">' + v + '%</text>';
        }
        h += '<text class="fr-an-tick" x="' + L + '" y="' + (H - 12) + '">' + esc(def.fmt(xMin)) + '</text>'
           + '<text class="fr-an-tick" x="' + (W - R) + '" y="' + (H - 12) + '" text-anchor="end">' + esc(def.fmt(xMax)) + '</text>'
           + '<text class="fr-an-tick" x="' + ((L + W - R) / 2) + '" y="' + (H - 2) + '" text-anchor="middle">' + esc(def.eje) + '</text>';
        if (d.tendencia) {
            h += '<line class="fr-an-trend" clip-path="url(#' + clip + ')" x1="' + X(x0) + '" y1="' + Y(d.tendencia.m * x0 + d.tendencia.b)
               + '" x2="' + X(x1) + '" y2="' + Y(d.tendencia.m * x1 + d.tendencia.b) + '"/>';
        }
        d.puntos.forEach(function (p) {
            var tip = p.id + ' · ' + p.gen.nombre + (p.gen.mezcla ? ' (mezcla: ' + p.gen.detalle + ')' : '')
                + '\nBE ' + p.y.toFixed(0) + '% · ' + def.eje + ': ' + def.fmt(p.x)
                + (p.cerrada ? '\nciclo cerrado' : '\nen producción (BE parcial)') + '\nclic para excluir de este gráfico';
            h += '<circle class="fr-an-pt fr-an-pt-click' + (p.cerrada ? ' fr-an-pt-cerrada' : '') + '" cx="' + X(p.x).toFixed(1) + '" cy="' + Y(p.y).toFixed(1) + '" r="3.6"'
               + ' onclick="FRAnalisis.excluirPunto(\'' + def.key + '\', \'' + esc(p.id) + '\')"><title>' + esc(tip) + '</title></circle>';
        });
        return h + '</svg>';
    }

    function pieDispersion(d, modo) {
        var base = modo === 'f1' ? 'bolsas' : 'bolsas de ciclo cerrado';
        if (!d.tendencia) return 'Pocas ' + base + ' para tendencia (n=' + d.nTendencia + ', mínimo ' + MIN_TENDENCIA + ') · ' + d.puntos.length + ' puntos';
        return 'r = <b>' + (d.tendencia.r == null ? '—' : d.tendencia.r.toFixed(2)) + '</b> con ' + d.nTendencia + ' ' + base + ' · ' + d.puntos.length + ' puntos';
    }

    function htmlExclusiones(cfg, excluidasAuto) {
        var tit = {};
        GRAFICOS.forEach(function (g) { tit[g.key] = g.titulo; });
        var ex = cfg.exclusiones || [];
        var h = '<div class="fr-an-excl"><div class="fr-an-excl-title">🚫 Excluidos de los gráficos</div>';
        if (!ex.length) h += '<div class="fr-an-dim">Ninguna exclusión manual. Tocá un punto de un gráfico de factores para excluirlo.</div>';
        ex.forEach(function (e, i) {
            h += '<div class="fr-an-excl-row">' + (e.tipo === 'grLote' ? 'Lote ' : 'Bolsa ') + '<b>' + esc(e.id) + '</b> de "' + esc(tit[e.grafico] || e.grafico) + '"'
               + (e.motivo ? ' — <i>' + esc(e.motivo) + '</i>' : '')
               + ' <button type="button" class="fr-an-undo" onclick="FRAnalisis.quitarExclusion(' + i + ')">↺ deshacer</button></div>';
        });
        if (excluidasAuto.length) {
            h += '<div class="fr-an-dim">Automático (datos incompletos): '
               + excluidasAuto.map(function (x) { return esc(x.id) + ' (' + esc(x.motivo) + ')'; }).join(' · ') + '</div>';
        }
        return h + '</div>';
    }

    function htmlRanking(validas) {
        var per = PERIODOS.filter(function (p) { return p.key === ui.periodo; })[0] || PERIODOS[0];
        var desde = per.meses ? restarMeses(hoyISO(), per.meses) : null;
        var filas = rankingGenetica(validas, ui.modo, desde);
        var acum = ui.modo === 'acum';
        var h = '<div class="fr-an-rank"><div class="fr-an-rank-head"><h3>🏆 Top genética por BE</h3><div class="fr-an-toggle">'
            + PERIODOS.map(function (p) { return btnToggle(p.key, p.label, ui.periodo, 'setPeriodo'); }).join('') + '</div></div>';
        if (!filas.length) return h + '<div class="fr-an-dim">Sin bolsas en este período.</div></div>';
        var maxBE = Math.max.apply(null, filas.map(function (f) { return f.bePromedio || 0; }).concat([1]));
        h += '<table class="data-table fr-an-rank-table"><thead><tr><th>Genética</th><th class="fr-num">Bolsas</th><th>'
           + (acum ? 'BE final prom.' : 'BE 1ª oleada prom.') + '</th><th class="fr-num">Mejor</th><th class="fr-num">% fructificó</th>'
           + (acum ? '<th class="fr-num">En curso</th>' : '') + '</tr></thead><tbody>';
        filas.forEach(function (f) {
            var mez = f.nMezcla ? ' <span class="fr-an-mezcla" title="' + esc(f.mezclas.join('\n')) + '">(' + f.nMezcla + ' con mezcla)</span>' : '';
            var bar = f.bePromedio != null
                ? '<span class="fr-an-bar" style="width:' + Math.round(f.bePromedio / maxBE * 90) + 'px"></span>' + f.bePromedio.toFixed(0) + '%'
                : '—';
            h += '<tr class="' + (f.rankeable ? '' : 'fr-an-dim-row') + '">'
               + '<td><b>' + esc(f.nombre) + '</b>' + mez + (f.rankeable ? '' : ' <i class="fr-an-dim">· pocas bolsas</i>') + '</td>'
               + '<td class="fr-num">' + f.n + '</td><td>' + bar + '</td>'
               + '<td class="fr-num">' + (f.mejor != null ? f.mejor.toFixed(0) + '%' : '—') + '</td>'
               + '<td class="fr-num">' + (f.pctFructifico != null ? f.pctFructifico.toFixed(0) + '%' : '—') + '</td>'
               + (acum ? '<td class="fr-num">' + f.enCurso + '</td>' : '') + '</tr>';
        });
        return h + '</tbody></table><div class="fr-an-dim">Rankea genéticas con ≥' + MIN_RANKING + ' bolsas'
            + (acum ? ' de ciclo cerrado' : '') + ' armadas en el período. "No fructificó" cuenta como 0. '
            + 'Una bolsa con varias genéticas cuenta para la de más frascos; empate → "Mezcla pareja".</div></div>';
    }

    function render(container) {
        if (container) ui.container = container;
        var el = ui.container;
        if (!el) return;
        if (!window.FR || typeof window.FR.getBolsasSnapshot !== 'function') {
            el.innerHTML = '<p class="fr-empty">FR no está cargado.</p>';
            return;
        }
        var cfg = leerCfg(), grMap = leerGrMap();
        var bolsas = window.FR.getBolsasSnapshot();
        var an = analizarBolsas(bolsas, grMap, cfg, nombreGenetica);
        var st = serieTiempo(bolsas, ui.modo, grMap, nombreGenetica);
        var mmLeyenda = VENTANAS_MM.map(function (w) {
            return '<span class="fr-an-mm-key" style="border-color:' + MM_COLORES[w] + ';color:' + MM_COLORES[w] + '">' + MM_NOMBRES[w] + '</span>';
        }).join(' ');
        var html = '<div class="fr-an-toolbar"><div class="fr-an-toggle">'
            + btnToggle('acum', 'BE acumulado', ui.modo, 'setModo') + btnToggle('f1', 'Comparar 1ª oleada', ui.modo, 'setModo')
            + '</div><span class="fr-an-leyenda">● ciclo cerrado · ○ en producción (BE parcial) · <span class="fr-an-ley-cont">✕ contaminada</span> · <span class="fr-an-ley-nf">▽ no fructificó</span></span></div>'
            + '<div class="fr-an-chart fr-an-chart-main"><div class="fr-an-chart-title">📈 BE en el tiempo (por fecha de armado)</div>'
            + svgTiempo(st)
            + '<div class="fr-an-chart-pie">' + mmLeyenda + ' — medias por cantidad de bolsas' + (ui.modo === 'acum' ? ', solo ciclo cerrado' : '')
            + '. Rápida por encima de la lenta = protocolos recientes rindiendo mejor.</div></div>'
            + '<div class="fr-an-charts">';
        GRAFICOS.forEach(function (def) {
            var d = datosGrafico(an.validas, def.key, ui.modo, cfg);
            html += '<div class="fr-an-chart"><div class="fr-an-chart-title">' + esc(def.titulo) + '</div>'
                + svgDispersion(def, d) + '<div class="fr-an-chart-pie">' + pieDispersion(d, ui.modo) + '</div></div>';
        });
        html += '</div><p class="fr-an-aviso">Correlación no es causa: grano, hidratación, genética y fecha cambian juntos entre protocolos. Tus resultados de campo mandan.</p>'
            + htmlExclusiones(cfg, an.excluidas) + htmlRanking(an.validas);
        el.innerHTML = html;
    }

    function excluirPunto(graficoKey, bolsaId) {
        var def = GRAFICOS.filter(function (g) { return g.key === graficoKey; })[0];
        if (!def || !window.FR || typeof window.FR.getBolsasSnapshot !== 'function') return;
        var ex;
        if (graficoKey === 'hidrGrano') {
            var b = window.FR.getBolsasSnapshot().filter(function (x) { return x.id === bolsaId; })[0];
            var lotes = b ? unicos(fuentesDe(b).map(function (s) { return s.grLoteId; })) : [];
            if (!lotes.length) return;
            var lote = lotes.length === 1 ? lotes[0]
                : prompt('¿Qué lote GR excluir del gráfico "' + def.titulo + '"? (' + lotes.join(', ') + ')', lotes[0]);
            if (lote == null) return;
            lote = String(lote).trim();
            if (lotes.indexOf(lote) === -1) { alert('El lote "' + lote + '" no es fuente de ' + bolsaId + '.'); return; }
            var m1 = prompt('Excluir el lote ' + lote + ' (todas sus bolsas) del gráfico "' + def.titulo + '".\nMotivo (opcional):', '');
            if (m1 == null) return;
            ex = { grafico: graficoKey, tipo: 'grLote', id: lote, motivo: String(m1).trim(), ts: new Date().toISOString() };
        } else {
            var m2 = prompt('Excluir ' + bolsaId + ' del gráfico "' + def.titulo + '".\nMotivo (opcional):', '');
            if (m2 == null) return;
            ex = { grafico: graficoKey, tipo: 'bolsa', id: bolsaId, motivo: String(m2).trim(), ts: new Date().toISOString() };
        }
        if (guardarCfg(conExclusion(leerCfg(), ex))) render();
    }

    function quitarExclusion(idx) {
        var cfg = leerCfg(), e = cfg.exclusiones[idx];
        if (!e) return;
        if (!confirm('¿Volver a incluir ' + e.id + ' en el gráfico?')) return;
        if (guardarCfg(sinExclusion(cfg, idx))) render();
    }

    window.FRAnalisis = Object.assign(window.FRAnalisis || {}, {
        render: render,
        setModo: function (m) { ui.modo = m === 'f1' ? 'f1' : 'acum'; render(); },
        setPeriodo: function (p) { ui.periodo = p; render(); },
        excluirPunto: excluirPunto,
        quitarExclusion: quitarExclusion
    });
```

- [ ] **Step 2: Tab, panel y script en `fr_index.html`**

Después de `<button type="button" class="fr-subtab" data-frtab="intel" ...>📊 Inteligencia</button>` agregar:

```html
            <button type="button" class="fr-subtab" data-frtab="analisis" onclick="FR.subTab('analisis')">🔎 Análisis BE</button>
```

Después del bloque `<div id="fr-sub-intel" ...>...</div>` agregar:

```html
        <div id="fr-sub-analisis" class="fr-subpanel">
            <div id="frAnalisisContent" style="padding:16px;"></div>
        </div>
```

Después de `<script src="fr_app.js"></script>` agregar:

```html
    <script src="fr_analisis.js"></script>
```

- [ ] **Step 3: Wiring en `fr_app.js`** — `FR.subTab`:

```js
    FR.subTab = function(which) {
        ['dash', 'activos', 'cosecha', 'archivo', 'experimentos', 'intel', 'analisis'].forEach(function(k) {
            var panel = document.getElementById('fr-sub-' + k);
            var btn = document.querySelector('.fr-subtab[data-frtab="' + k + '"]');
            if (panel) panel.classList.toggle('active', k === which);
            if (btn) btn.classList.toggle('active', k === which);
        });
        if (which === 'intel') _frCalRenderIntelPanel();
        if (which === 'analisis') _frRenderAnalisis();
    };

    function _frRenderAnalisis() {
        if (window.FRAnalisis && typeof window.FRAnalisis.render === 'function') {
            window.FRAnalisis.render(document.getElementById('frAnalisisContent'));
        }
    }
```

y en `renderAll()` agregar al final:

```js
        var _anPanel = document.getElementById('fr-sub-analisis');
        if (_anPanel && _anPanel.classList.contains('active')) _frRenderAnalisis();
```

- [ ] **Step 4: CSS del análisis** — agregar al final de `fr/fr_styles.css`:

```css
/* ── Análisis BE (2026-09-28) ── */
.fr-an-toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
.fr-an-toggle { display: inline-flex; border: 1px solid var(--border); border-radius: 14px; overflow: hidden; }
.fr-an-toggle-btn { background: transparent; border: none; color: var(--text-muted); padding: 4px 12px; font-size: 12px; cursor: pointer; }
.fr-an-on { background: rgba(232,99,122,0.22); color: var(--text-light); }
.fr-an-leyenda { font-size: 12px; color: var(--text-muted); }
.fr-an-ley-cont { color: #E05252; }
.fr-an-ley-nf { color: #F2A93C; }
.fr-an-charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
.fr-an-chart { background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 10px; }
.fr-an-chart-main { margin-bottom: 12px; }
.fr-an-chart-title { font-weight: 700; font-size: 13px; margin-bottom: 6px; }
.fr-an-chart-pie { font-size: 11px; color: var(--text-muted); margin-top: 4px; }
.fr-an-svg { width: 100%; height: auto; display: block; }
.fr-an-grid { stroke: rgba(255,255,255,0.07); }
.fr-an-tick { fill: var(--text-muted); font-size: 9px; }
.fr-an-trend { stroke: var(--fr-main); stroke-width: 1.5; stroke-dasharray: 4 3; }
.fr-an-mm { fill: none; stroke-width: 2; }
.fr-an-mm-key { display: inline-block; border: 1px solid; border-radius: 10px; padding: 0 7px; font-size: 11px; }
.fr-an-pt { fill: none; stroke: var(--fr-main); stroke-width: 1.3; }
.fr-an-pt-cerrada { fill: var(--fr-main); }
.fr-an-pt-click { cursor: pointer; }
.fr-an-pt-click:hover { stroke-width: 3; }
.fr-an-mk-cont path { stroke: #E05252; stroke-width: 2; }
.fr-an-mk-nf { fill: #F2A93C; }
.fr-an-vacio { padding: 30px; text-align: center; color: var(--text-muted); font-size: 12px; }
.fr-an-aviso { font-size: 11px; color: var(--text-muted); margin: 8px 0; }
.fr-an-excl { margin: 10px 0 16px; font-size: 12px; border: 1px dashed var(--border); border-radius: 8px; padding: 8px 10px; }
.fr-an-excl-title { font-weight: 700; margin-bottom: 4px; }
.fr-an-excl-row { margin: 2px 0; }
.fr-an-undo { background: none; border: none; color: var(--fr-main-soft); cursor: pointer; font-size: 12px; }
.fr-an-dim { color: var(--text-muted); font-size: 11px; }
.fr-an-rank-head { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
.fr-an-rank-head h3 { margin: 0; }
.fr-an-rank-table { margin-top: 8px; }
.fr-an-bar { display: inline-block; height: 8px; background: var(--fr-main); border-radius: 4px; vertical-align: middle; margin-right: 6px; }
.fr-an-dim-row td { color: var(--text-muted); }
.fr-an-dim-row .fr-an-bar { background: var(--text-muted); }
.fr-an-mezcla { font-size: 11px; color: var(--text-muted); cursor: help; }
```

- [ ] **Step 5: Verificar sintaxis + tests siguen pasando y commit**

Run: `node --check fr/fr_analisis.js && node --check fr/fr_app.js && node tests/fr_analisis.test.js`
Expected: `10 tests OK`

```bash
git add fr/fr_analisis.js fr/fr_app.js fr/fr_index.html fr/fr_styles.css
git commit -m "feat(fr): pestaña Análisis BE — BE en el tiempo con medias móviles, dispersiones y ranking de genética"
```

---

### Task 5: Verificación contra datos reales

**Files:** ninguno versionado (script en el scratchpad de la sesión).

- [ ] **Step 1: Node contra el backup real** — script que carga `fr/fr_analisis.js` con `window` stub y el último `biolab-autobackup-*.json`, y compara contra `docs/lab-intelligence/fr-analisis-valores-referencia.md`: 57 válidas; excluidas automáticas FR93/FR133/FR234c/FR234d; r (1ª oleada) grano/sust ≈ 0.63, hidr. sustrato ≈ 0.62, hidr. grano ≈ 0.28 con GR76 excluido; ranking 1ª oleada desde 2026-07-01 con 244 primero (n=8). Diferencias aceptables solo si se explican (ej. bolsas nuevas desde el backup).
- [ ] **Step 2: Chrome real** — contexto aislado con el backup real, `#FR`:
  - Vista General: chips con conteos (82/10/24/48), ordenar por BE ↓ (FR2207 450% arriba), filtro ⭐ vacío → marcar FR1808 con motivo → aparece en ⭐, header de detalle muestra ★ + motivo, observación auto registrada; desmarcar.
  - ⭐ en bolsa archivada (FR2807d) funciona.
  - Pestaña 🔎 Análisis BE: gráfico de tiempo con 3 medias, ✕ y ▽ visibles; toggle 1ª oleada cambia valores; excluir GR76 desde un punto de "Agua en grano" → aparece en exclusiones, persiste tras recarga, "deshacer" lo revierte; ranking cambia con período.
  - Consola sin errores nuevos.

---

### Task 6: Documentación y push

- [ ] **Step 1: `CLAUDE.md`** — tabla de keys: agregar `fr_analisis_cfg | FR Análisis | Exclusiones manuales de los gráficos de BE ({exclusiones:[{grafico,tipo,id,motivo,ts}]})`. En `fr_bolsas` anotar campo `favorita`. Agregar entrada en "INVARIANTES VIGENTES": `fr_analisis.js` es solo lectura de FR/GR/GE; `hidratacionLoteGR` duplica `grCalcularKPIFormulario` (cambiar juntas); genética del análisis se identifica por `fen_id` de la tanda GR.
- [ ] **Step 2: Commit + push**

```bash
git add fr docs/superpowers
git commit -m "docs(fr): plan de implementación del análisis de BE"
git push
```
