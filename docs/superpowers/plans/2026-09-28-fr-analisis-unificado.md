# FR Análisis unificado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fusionar "📊 Inteligencia" (FR·CAL) y "🔎 Análisis BE" en una pestaña "📊 Análisis" con 4 sub-pestañas, y sumar 6 análisis nuevos (grano, curva de oleadas, días a 1ª cosecha, aditivos SU, BE/semana, calidad vs BE).

**Architecture:** Cálculos nuevos como funciones puras en `fr/fr_analisis.js` (`_calc`, testeadas en Node). FR·CAL sigue viviendo en `fr_app.js` pero renderiza en contenedores que le pasa el análisis (`FR.renderCalIntel(el, parte)`). Sin datos nuevos salvo `fr_analisis_cfg.seccion`.

**Tech Stack:** JS vanilla ES5-style, Node `assert`, Chrome real + backup real.

**Spec:** `docs/superpowers/specs/2026-09-28-fr-analisis-unificado-design.md`

---

### Task 1: Cálculos nuevos (TDD) — `fr/fr_analisis.js`, `tests/fr_analisis.test.js`

Contratos (todas puras, reciben `bolsas` crudas + `grMap` + `nombreDe`):

| Función | Devuelve |
|---|---|
| `curvaOleadas(bolsas, grMap, nombreDe, desde)` | `[{key, nombre, nBolsas, oleadas:[{prom, n}]}]` — solo `cicloCerrado`, no huérfanas; orden nBolsas desc |
| `diasPrimeraCosecha(bolsas, grMap, nombreDe, desde)` | `[{key, nombre, n, prom, min, max}]` — días `fechaInicio`→`flushes[0].fecha` (parte fecha) |
| `bePorSemana(bolsas, grMap, nombreDe, desde)` | `{bolsas:[{id, nombre, be, dias, bps}] (bps desc), porGenetica:[{nombre, n, prom}]}` — cerradas con fecha de cierre |
| `composicionGrano(lote)` | `'Avena + Sorgo'` — cereales `tipo:'seco'` únicos, nombre sin paréntesis, orden alfabético; `'—'` si nada |
| `granoDeBolsa(b, grMap)` | composición del lote GR con más `grUsados` en la bolsa |
| `estabilidadTemporal(grupo, resto, campo)` | `{estado:'insuficiente'|'confundido'|'estable'|'inestable', delta}` — ver spec |
| `tablaFactor(validas, gruposDe, modo)` | `[{key, n, bePromedio, pctFructifico, desde, hasta, estab}]` — `gruposDe(m)` devuelve array de claves; cada grupo contra el resto |
| `puntosCalidad(bolsas, campo)` | `[{id, flushN, x: beOleada, y: calidad[campo]}]` solo oleadas con calidad, BE y campo no nulos |

- [ ] Step 1: tests (abajo) → correr, deben fallar.
- [ ] Step 2: implementar → `node tests/fr_analisis.test.js` pasa.
- [ ] Step 3: commit.

Tests a agregar en `tests/fr_analisis.test.js` antes del `console.log` final:

```js
t('curvaOleadas: solo ciclo cerrado, promedio por número de oleada', () => {
  const bs = [
    bolsa({ id: 'C1', cicloCerrado: true, flushes: [{ beOleada: 300 }, { beOleada: 100 }] }),
    bolsa({ id: 'C2', cicloCerrado: true, flushes: [{ beOleada: 200 }] }),
    bolsa({ id: 'OPEN', flushes: [{ beOleada: 999 }] }),
    bolsa({ id: 'H', cicloCerrado: true, origen: 'huerfana', flushes: [{ beOleada: 999 }] })
  ];
  const c = C.curvaOleadas(bs, grMap, nombreDe, null);
  assert.strictEqual(c.length, 1); assert.strictEqual(c[0].nombre, '244'); assert.strictEqual(c[0].nBolsas, 2);
  close(c[0].oleadas[0].prom, 250); assert.strictEqual(c[0].oleadas[0].n, 2);
  close(c[0].oleadas[1].prom, 100); assert.strictEqual(c[0].oleadas[1].n, 1);
});

t('diasPrimeraCosecha usa la parte fecha de flushes[0].fecha', () => {
  const bs = [
    bolsa({ id: 'D1', fechaInicio: '2026-08-01', flushes: [{ fecha: '2026-09-02T17:04', beOleada: 1 }] }),
    bolsa({ id: 'D2', fechaInicio: '2026-08-01', flushes: [{ fecha: '2026-08-31T08:00', beOleada: 1 }] })
  ];
  const d = C.diasPrimeraCosecha(bs, grMap, nombreDe, null)[0];
  assert.deepStrictEqual([d.n, d.min, d.max], [2, 30, 32]); close(d.prom, 31);
});

t('bePorSemana: BE acumulado / días de ciclo × 7, no fructificó = 0', () => {
  const bs = [
    bolsa({ id: 'W1', fechaInicio: '2026-08-01', cicloCerrado: true, fechaCierreCiclo: '2026-08-29', flushes: [{ beOleada: 200 }, { beOleada: 80 }] }),
    bolsa({ id: 'W2', fechaInicio: '2026-08-01', noFructifico: true, fechaNoFructifico: '2026-09-30', flushes: [] }),
    bolsa({ id: 'W3', fechaInicio: '2026-08-01', flushes: [{ beOleada: 500 }] })   // abierta → fuera
  ];
  const r = C.bePorSemana(bs, grMap, nombreDe, null);
  assert.deepStrictEqual(r.bolsas.map(x => x.id), ['W1', 'W2']);
  close(r.bolsas[0].bps, 280 / 28 * 7); assert.strictEqual(r.bolsas[1].bps, 0);
  assert.strictEqual(r.porGenetica[0].n, 2); close(r.porGenetica[0].prom, 35);
});

t('composicionGrano y granoDeBolsa', () => {
  assert.strictEqual(C.composicionGrano({ componentes: [{ nombre: 'Sorgo (31/7/2026)', tipo: 'seco' }, { nombre: 'Avena (AV)', tipo: 'seco' }, { nombre: 'Agua', tipo: 'liquido' }] }), 'Avena + Sorgo');
  assert.strictEqual(C.composicionGrano(null), '—');
  const gm = { X: { componentes: [{ nombre: 'Maíz (MA)', tipo: 'seco' }] }, Y: { componentes: [{ nombre: 'Avena (AV)', tipo: 'seco' }] } };
  assert.strictEqual(C.granoDeBolsa({ grSources: [{ grLoteId: 'X', grUsados: 1 }, { grLoteId: 'Y', grUsados: 3 }] }, gm), 'Avena');
});

t('estabilidadTemporal: insuficiente, confundido, estable, inestable', () => {
  const m = (fecha, v) => ({ fechaInicio: fecha, beF1: v });
  assert.strictEqual(C.estabilidadTemporal([m('2026-08-01', 1)], [m('2026-08-01', 1), m('2026-08-02', 1), m('2026-08-03', 1)], 'beF1').estado, 'insuficiente');
  const nuevos = [m('2026-08-01', 400), m('2026-08-05', 400), m('2026-09-01', 400)];
  const viejos = [m('2026-04-01', 100), m('2026-04-05', 100), m('2026-05-01', 100)];
  assert.strictEqual(C.estabilidadTemporal(nuevos, viejos, 'beF1').estado, 'confundido');
  const g = [m('2026-06-01', 300), m('2026-07-01', 310), m('2026-08-01', 305)];
  const r = [m('2026-06-02', 200), m('2026-07-02', 205), m('2026-08-02', 210)];
  const e = C.estabilidadTemporal(g, r, 'beF1');
  assert.strictEqual(e.estado, 'estable'); close(e.delta, 100);
  const g2 = [m('2026-06-01', 900), m('2026-07-01', 100), m('2026-08-01', 100)];
  assert.strictEqual(C.estabilidadTemporal(g2, r, 'beF1').estado, 'inestable');
});

t('tablaFactor: cada grupo contra el resto, período y % fructificó', () => {
  const v = [
    { id: 'a', fechaInicio: '2026-06-01', beF1: 300, beAcum: 300, cerrada: true, noFructifico: false, g: ['Avena'] },
    { id: 'b', fechaInicio: '2026-07-01', beF1: 0, beAcum: 0, cerrada: true, noFructifico: true, g: ['Avena'] },
    { id: 'c', fechaInicio: '2026-05-01', beF1: 100, beAcum: 100, cerrada: false, noFructifico: false, g: ['Maíz'] }
  ];
  const t1 = C.tablaFactor(v, m => m.g, 'f1');
  const av = t1.find(x => x.key === 'Avena');
  assert.deepStrictEqual([av.n, av.desde, av.hasta], [2, '2026-06-01', '2026-07-01']);
  close(av.bePromedio, 150); close(av.pctFructifico, 50);
  const ac = C.tablaFactor(v, m => m.g, 'acum').find(x => x.key === 'Maíz');
  assert.strictEqual(ac.bePromedio, null);   // acum: solo cerradas → Maíz no tiene
});

t('puntosCalidad: solo oleadas evaluadas con BE y campo', () => {
  const bs = [bolsa({ id: 'Q', flushes: [
    { beOleada: 300, calidad: { pctDeformaciones: 5, scorePersonal: 8 } },
    { beOleada: 100 },
    { beOleada: null, calidad: { pctDeformaciones: 9 } },
    { beOleada: 50, calidad: { pctDeformaciones: 2, scorePersonal: null } }
  ] })];
  assert.deepStrictEqual(C.puntosCalidad(bs, 'pctDeformaciones').map(p => [p.flushN, p.x, p.y]), [[1, 300, 5], [4, 50, 2]]);
  assert.deepStrictEqual(C.puntosCalidad(bs, 'scorePersonal').map(p => p.flushN), [1]);
});
```

### Task 2: FR·CAL renderizable por partes + correcciones — `fr/fr_app.js`
- `_frCalRenderIntelPanel()` → `FR.renderCalIntel(el, parte)`: arma el HTML de calidad (perfil por cepa, aditivos, dosis-respuesta, lotes GR, componentes GR) y el de anomalías (bolsas anómalas + candidatos de riesgo) por separado; escribe solo `parte` en `el`. Sin evaluaciones → mismo mensaje de hoy.
- `_frCalBuildIntel`: `version: 2`; `byCepa` agrupa por `FRAnalisis._calc.atribuirGenetica` (typeof guard, fallback `b.fenId`); `byGrProtocolo.hidratacion` usa `FRAnalisis._calc.hidratacionLoteGR` (fallback inline). `FR.getIntel` reconstruye si `version !== 2`.
- Label "BE medio" → "BE medio (oleadas evaluadas)".
- `FR.subTab`: sin `'intel'`; `FR.subTab('intel')` → `FRAnalisis.setSeccion('calidad')` + `'analisis'`.
- `node --check`, commit.

### Task 3: UI de 4 sub-pestañas — `fr/fr_analisis.js`, `fr/fr_index.html`, `fr/fr_styles.css`
- `fr_index.html`: quitar botón y panel `intel`; botón `analisis` → "📊 Análisis".
- `render()`: toolbar (sub-nav + modo + período global) y cuerpo según `ui.seccion`; `setSeccion(s)` persiste en `fr_analisis_cfg.seccion` y re-renderiza.
- Rendimiento: tiempo + ranking + curva de oleadas + días a F1 + BE/semana. Factores: dispersiones + exclusiones + tabla grano + tabla aditivos. Calidad: `FR.renderCalIntel(el,'calidad')` + 2 dispersiones calidad vs BE (sin clic de exclusión). Anomalías: `FR.renderCalIntel(el,'anomalias')`.
- `node --check` + tests, commit.

### Task 4: Verificación real + docs + merge/push
- Node contra backup real: grano (Avena 385% / Maíz 136% / Avena+Maíz 121%, todos "confundido"), curva 244 F1 166% / F2 31%, días a F1 210/244 ≈ 33, top BE/sem FR1106c.
- Chrome real: 4 sub-pestañas, sección recordada tras recargar, FR·CAL en Calidad/Anomalías, `FR.subTab('intel')` redirige, sin errores de consola.
- `CLAUDE.md` + commit + merge a main + push.
