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
            puntos.push({ id: m.id, x: x, y: modo === 'f1' ? m.beF1 : m.beAcum, cerrada: m.cerrada, noFructifico: m.noFructifico, gen: m.gen, lotesGR: m.lotesGR });
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
    // Independiente del selector acumulado/1ª oleada (probado con datos reales 2026-09-28: con
    // "acumulado" + últimos 3 meses casi nada cerró y el ranking quedaba vacío). Ordena por BE de
    // 1ª oleada (todas las bolsas del período) y muestra al lado el BE final de las ya cerradas.
    function promedio(arr) { return arr.length ? arr.reduce(function (a, v) { return a + v; }, 0) / arr.length : null; }
    function rankingGenetica(validas, desde) {
        var g = {};
        validas.forEach(function (m) {
            if (desde && m.fechaInicio < desde) return;
            var k = m.gen.key;
            var r = g[k] || (g[k] = { key: k, nombre: m.gen.nombre, f1: [], fin: [], acum: [], noFruct: 0, mezclas: [] });
            r.f1.push(m.beF1);
            r.acum.push(m.beAcum);
            if (m.cerrada) r.fin.push(m.beAcum);
            if (m.noFructifico) r.noFruct++;
            if (m.gen.mezcla) r.mezclas.push(m.id + ': ' + m.gen.detalle);
        });
        var filas = Object.keys(g).map(function (k) {
            var r = g[k], n = r.f1.length;
            return {
                key: k, nombre: r.nombre, n: n,
                beF1Prom: promedio(r.f1),
                nCerradas: r.fin.length, beFinalProm: promedio(r.fin),
                mejor: Math.max.apply(null, r.acum),
                pctFructifico: (n - r.noFruct) / n * 100,
                nMezcla: r.mezclas.length, mezclas: r.mezclas,
                rankeable: n >= MIN_RANKING
            };
        });
        filas.sort(function (a, b) {
            if (a.rankeable !== b.rankeable) return a.rankeable ? -1 : 1;
            return b.beF1Prom - a.beF1Prom;
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
        { key: 'hidrGrano', titulo: '🌾💧 Agua en grano vs BE',          eje: 'hidratación del grano (lote GR)', fmt: function (v) { return v.toFixed(0) + '%'; } }
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
            var cx = +X(p.fecha).toFixed(1), cy = +Y(p.y).toFixed(1);
            var tip = p.id + ' · ' + p.gen.nombre + (p.gen.mezcla ? ' (mezcla: ' + p.gen.detalle + ')' : '')
                + '\nArmada ' + p.fecha + ' · BE ' + p.y.toFixed(0) + '%'
                + (p.tipo === 'contaminada' ? '\n☣ contaminada' : p.tipo === 'noFructifico' ? '\n🕳 no fructificó' : (p.cerrada ? '\nciclo cerrado' : '\nen producción (BE parcial)'));
            if (p.tipo === 'contaminada') {
                h += '<g class="fr-an-mk-cont"><path d="M' + (cx - 4) + ' ' + (cy - 4) + 'L' + (cx + 4) + ' ' + (cy + 4)
                   + 'M' + (cx + 4) + ' ' + (cy - 4) + 'L' + (cx - 4) + ' ' + (cy + 4) + '"/><title>' + esc(tip) + '</title></g>';
            } else if (p.tipo === 'noFructifico') {
                h += '<path class="fr-an-mk-nf" d="M' + (cx - 4.5) + ' ' + (cy - 4) + 'L' + (cx + 4.5) + ' ' + (cy - 4) + 'L' + cx + ' ' + (cy + 4) + 'Z"><title>' + esc(tip) + '</title></path>';
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
                + (p.noFructifico ? '\n🕳 no fructificó (BE 0)' : p.cerrada ? '\nciclo cerrado' : '\nen producción (BE parcial)') + '\nclic para excluir de este gráfico';
            var px = +X(p.x).toFixed(1), py = +Y(p.y).toFixed(1);
            var onclick = ' onclick="FRAnalisis.excluirPunto(\'' + def.key + '\', \'' + esc(p.id) + '\')"';
            if (p.noFructifico) {
                h += '<path class="fr-an-mk-nf fr-an-pt-click" d="M' + (px - 4.5) + ' ' + (py - 4) + 'L' + (px + 4.5) + ' ' + (py - 4) + 'L' + px + ' ' + (py + 4) + 'Z"'
                   + onclick + '><title>' + esc(tip) + '</title></path>';
            } else {
                h += '<circle class="fr-an-pt fr-an-pt-click' + (p.cerrada ? ' fr-an-pt-cerrada' : '') + '" cx="' + px + '" cy="' + py + '" r="3.6"'
                   + onclick + '><title>' + esc(tip) + '</title></circle>';
            }
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
        var filas = rankingGenetica(validas, desde);
        var h = '<div class="fr-an-rank"><div class="fr-an-rank-head"><h3>🏆 Top genética por BE</h3><div class="fr-an-toggle">'
            + PERIODOS.map(function (p) { return btnToggle(p.key, p.label, ui.periodo, 'setPeriodo'); }).join('') + '</div></div>';
        if (!filas.length) return h + '<div class="fr-an-dim">Sin bolsas en este período.</div></div>';
        var maxBE = Math.max.apply(null, filas.map(function (f) { return f.beF1Prom; }).concat([1]));
        h += '<table class="data-table fr-an-rank-table"><thead><tr><th>Genética</th><th class="fr-num">Bolsas</th>'
           + '<th>BE 1ª oleada prom. ↓</th><th class="fr-num">BE final prom. (cerradas)</th><th class="fr-num">Mejor BE</th>'
           + '<th class="fr-num">% fructificó</th></tr></thead><tbody>';
        filas.forEach(function (f) {
            var mez = f.nMezcla ? ' <span class="fr-an-mezcla" title="' + esc(f.mezclas.join('\n')) + '">(' + f.nMezcla + ' con mezcla)</span>' : '';
            var bar = '<span class="fr-an-bar" style="width:' + Math.round(f.beF1Prom / maxBE * 90) + 'px"></span>' + f.beF1Prom.toFixed(0) + '%';
            h += '<tr class="' + (f.rankeable ? '' : 'fr-an-dim-row') + '">'
               + '<td><b>' + esc(f.nombre) + '</b>' + mez + (f.rankeable ? '' : ' <i class="fr-an-dim">· pocas bolsas</i>') + '</td>'
               + '<td class="fr-num">' + f.n + '</td><td>' + bar + '</td>'
               + '<td class="fr-num">' + (f.beFinalProm != null ? f.beFinalProm.toFixed(0) + '% <span class="fr-an-dim">(' + f.nCerradas + ')</span>' : '— <span class="fr-an-dim">(0)</span>') + '</td>'
               + '<td class="fr-num">' + f.mejor.toFixed(0) + '%</td>'
               + '<td class="fr-num">' + f.pctFructifico.toFixed(0) + '%</td></tr>';
        });
        return h + '</tbody></table><div class="fr-an-dim">Ordenado por BE de 1ª oleada (todas las bolsas armadas en el período); '
            + 'rankea genéticas con ≥' + MIN_RANKING + ' bolsas. BE final = solo las que ya cerraron ciclo (entre paréntesis cuántas). '
            + '"No fructificó" cuenta como 0. Una bolsa con varias genéticas cuenta para la de más frascos; empate → "Mezcla pareja".</div></div>';
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
        quitarExclusion: quitarExclusion,
        _calc: {
            motivoInvalida: motivoInvalida, hidratacionLoteGR: hidratacionLoteGR, hidrGranoBolsa: hidrGranoBolsa,
            atribuirGenetica: atribuirGenetica, metricasBolsa: metricasBolsa, analizarBolsas: analizarBolsas,
            regresion: regresion, mediaMovil: mediaMovil, datosGrafico: datosGrafico, serieTiempo: serieTiempo,
            rankingGenetica: rankingGenetica, restarMeses: restarMeses, conExclusion: conExclusion,
            sinExclusion: sinExclusion, MEZCLA_PAREJA: MEZCLA_PAREJA
        }
    });
})();
