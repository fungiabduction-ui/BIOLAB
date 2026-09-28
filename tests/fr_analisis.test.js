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
  assert.strictEqual(f[0].nombre, '244'); assert.strictEqual(f[0].n, 4);
  close(f[0].beF1Prom, (300 + 200 + 0 + 400) / 4);          // A1, A2, A3 (NF=0), A4 abierta
  assert.strictEqual(f[0].nCerradas, 3); close(f[0].beFinalProm, (300 + 300 + 0) / 3);
  assert.strictEqual(f[0].mejor, 400); close(f[0].pctFructifico, 75); assert.strictEqual(f[0].rankeable, true);
  assert.strictEqual(f[1].nombre, '210'); assert.strictEqual(f[1].rankeable, false); // 900% pero n=1 → abajo
  f = C.rankingGenetica(an.validas, null);
  assert.strictEqual(f[0].n, 5); // incluye OLD
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
  assert.strictEqual(s.baseMedias.length, 4);   // acum: solo cerradas
  assert.strictEqual(s.medias[5].length, 0);
  const s1 = C.serieTiempo(bs, 'f1', grMap, nombreDe);
  assert.strictEqual(s1.baseMedias.length, 5);
  close(s1.medias[5][0].v, (100 + 200 + 0 + 0 + 50) / 5);
});

console.log('\n' + ok + ' tests OK');
