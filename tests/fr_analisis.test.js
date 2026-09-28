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

t('rankingGenetica: ordena por 1ª oleada, BE final solo cerradas, noFructifico = 0, n>=3 rankea, período', () => {
  const bs = [
    bolsa({ id: 'A1', cicloCerrado: true, flushes: [{ beOleada: 300 }] }),
    bolsa({ id: 'A2', cicloCerrado: true, flushes: [{ beOleada: 200 }, { beOleada: 100 }] }),
    bolsa({ id: 'A3', noFructifico: true, flushes: [] }),
    bolsa({ id: 'A4', flushes: [{ beOleada: 400 }] }), // abierta
    bolsa({ id: 'B1', cicloCerrado: true, flushes: [{ beOleada: 900 }], grSources: [{ grLoteId: 'GRA', grTandaId: 'GRA2', grUsados: 1 }] }),
    bolsa({ id: 'OLD', fechaInicio: '2025-01-01', cicloCerrado: true, flushes: [{ beOleada: 1 }] })
  ];
  const an = C.analizarBolsas(bs, grMap, { exclusiones: [] }, nombreDe);
  let f = C.rankingGenetica(an.validas, '2026-01-01');
  assert.deepStrictEqual(f.map(x => x.nombre), ['210', '244']); // orden por BE 1ª oleada desc, sin agrupar por n
  f = [f[1]];
  assert.strictEqual(f[0].nombre, '244'); assert.strictEqual(f[0].n, 4);
  close(f[0].beF1Prom, (300 + 200 + 0 + 400) / 4);          // A1, A2, A3 (NF=0), A4 abierta
  assert.strictEqual(f[0].nCerradas, 3); close(f[0].beFinalProm, (300 + 300 + 0) / 3);
  assert.strictEqual(f[0].mejor, 400); close(f[0].pctFructifico, 75); assert.strictEqual(f[0].rankeable, true);
  // detalle de la genética: sus bolsas del período, más nueva primero (mismo orden de fecha → por ID)
  assert.deepStrictEqual(f[0].bolsas.map(x => x.id), ['A1', 'A2', 'A3', 'A4']);
  const a3 = f[0].bolsas.find(x => x.id === 'A3');
  assert.deepStrictEqual([a3.estado, a3.beF1, a3.beAcum], ['no fructificó', 0, 0]);
  assert.strictEqual(f[0].bolsas.find(x => x.id === 'A4').estado, 'en producción');
  assert.strictEqual(f[0].bolsas.find(x => x.id === 'A2').estado, 'ciclo cerrado');
  assert.strictEqual(C.rankingGenetica(an.validas, '2026-01-01')[0].rankeable, false); // 210 n=1 → gris "pocas bolsas"
  // orden por columna (nulls siempre al final, en ambas direcciones)
  const filas = [{ nombre: 'a', beFinalProm: 10 }, { nombre: 'b', beFinalProm: null }, { nombre: 'c', beFinalProm: 30 }];
  assert.deepStrictEqual(C.ordenarFilas(filas, 'beFinalProm', -1).map(x => x.nombre), ['c', 'a', 'b']);
  assert.deepStrictEqual(C.ordenarFilas(filas, 'beFinalProm', 1).map(x => x.nombre), ['a', 'c', 'b']);
  assert.deepStrictEqual(C.ordenarFilas(filas, 'nombre', 1).map(x => x.nombre), ['a', 'b', 'c']);
  f = C.rankingGenetica(an.validas, null);
  assert.strictEqual(f.find(x => x.nombre === '244').n, 5); // incluye OLD
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
  const s = C.serieTiempo(bs, 'acum', grMap, nombreDe, 5);
  assert.deepStrictEqual(s.puntos.map(p => p.id), ['A', 'B', 'X', 'N', 'O']);
  assert.deepStrictEqual(s.puntos.map(p => p.tipo), ['normal', 'normal', 'contaminada', 'noFructifico', 'normal']);
  assert.strictEqual(s.puntos[2].y, 0);
  assert.strictEqual(s.baseMedias.length, 4);   // acum: MM de BE solo con cerradas → 4 < 5, sin valores
  assert.strictEqual(s.mmBE.length, 0);
  // MM de % fallas usa TODAS las bolsas (una abierta con cosecha ya fructificó = acierto)
  assert.strictEqual(s.mmFallas.length, 1); close(s.mmFallas[0].v, 40); // 2 fallas de 5
  const s1 = C.serieTiempo(bs, 'f1', grMap, nombreDe, 5);
  assert.strictEqual(s1.baseMedias.length, 5);
  close(s1.mmBE[0].v, (100 + 200 + 0 + 0 + 50) / 5);
  assert.strictEqual(C.valorEnFecha(s1.mmBE, '2026-08-04'), null);   // antes de completar la ventana
  close(C.valorEnFecha(s1.mmBE, '2026-08-30'), 70);
});

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
  // el delta compara solo dentro de los meses compartidos: el resto de abril (sin grupo) no cuenta
  const rConAbril = r.concat([m('2026-04-01', 1000), m('2026-04-02', 1000)]);
  close(C.estabilidadTemporal(g, rConAbril, 'beF1').delta, 100);
  // un solo mes en común: la comparación existe pero no se puede probar que se sostenga
  const gJun = [m('2026-06-01', 400), m('2026-06-02', 400), m('2026-06-03', 400)];
  const rJun = [m('2026-06-04', 100), m('2026-06-05', 100), m('2026-06-06', 100), m('2026-04-01', 50)];
  const u = C.estabilidadTemporal(gJun, rJun, 'beF1');
  assert.strictEqual(u.estado, 'unMes'); close(u.delta, 300);
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

console.log('\n' + ok + ' tests OK');
