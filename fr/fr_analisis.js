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
            contaminada: b.contaminada === true,
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
    // y no fructificó (0); no exige datos de grano/hidratación. Dos medias móviles por cantidad
    // de bolsas (pedido del operador 2026-09-28: acierto vs error):
    //  - mmBE: BE promedio. En 'acum' solo cerradas (las abiertas tienen BE parcial), en 'f1' todas.
    //  - mmFallas: % de bolsas que fallaron (contaminada o no fructificó) sobre TODAS — una bolsa
    //    abierta con cosecha ya fructificó, cuenta como acierto.
    function serieTiempo(bolsas, modo, grMap, nombreDe, ventana) {
        ventana = ventana || 10;
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
        function serie(lista, valores) {
            var out = [];
            mediaMovil(valores, ventana).forEach(function (v, i) { if (v != null) out.push({ fecha: lista[i].fecha, v: v }); });
            return out;
        }
        return {
            puntos: puntos, baseMedias: base, ventana: ventana,
            mmBE: serie(base, base.map(function (p) { return p.y; })),
            mmFallas: serie(puntos, puntos.map(function (p) { return p.tipo === 'normal' ? 0 : 100; }))
        };
    }

    // Último valor de una serie de media móvil con fecha <= iso (null si la ventana no se completó).
    function valorEnFecha(serie, iso) {
        var v = null;
        for (var i = 0; i < serie.length && serie[i].fecha <= iso; i++) v = serie[i].v;
        return v;
    }

    // Orden por columna para tablas: nulls siempre al final; strings sin distinguir mayúsculas.
    function ordenarFilas(filas, key, dir) {
        return filas.slice().sort(function (a, b) {
            var va = a[key], vb = b[key];
            if (va == null && vb == null) return 0;
            if (va == null) return 1;
            if (vb == null) return -1;
            if (typeof va === 'string') { va = va.toLowerCase(); vb = String(vb).toLowerCase(); }
            return va < vb ? -dir : va > vb ? dir : 0;
        });
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
            var r = g[k] || (g[k] = { key: k, nombre: m.gen.nombre, f1: [], fin: [], acum: [], noFruct: 0, mezclas: [], bolsas: [] });
            r.f1.push(m.beF1);
            r.acum.push(m.beAcum);
            if (m.cerrada) r.fin.push(m.beAcum);
            if (m.noFructifico) r.noFruct++;
            if (m.gen.mezcla) r.mezclas.push(m.id + ': ' + m.gen.detalle);
            r.bolsas.push({
                id: m.id, fechaInicio: m.fechaInicio, beF1: m.beF1, beAcum: m.beAcum,
                estado: m.noFructifico ? 'no fructificó' : m.contaminada ? 'contaminada'
                      : m.cerrada ? 'ciclo cerrado' : 'en producción',
                mezcla: m.gen.mezcla ? m.gen.detalle : null
            });
        });
        // Detalle: más nueva primero; misma fecha → por ID
        Object.keys(g).forEach(function (k) {
            g[k].bolsas.sort(function (a, b) {
                return a.fechaInicio > b.fechaInicio ? -1 : a.fechaInicio < b.fechaInicio ? 1 : (a.id < b.id ? -1 : 1);
            });
        });
        var filas = Object.keys(g).map(function (k) {
            var r = g[k], n = r.f1.length;
            return {
                key: k, nombre: r.nombre, n: n,
                beF1Prom: promedio(r.f1),
                nCerradas: r.fin.length, beFinalProm: promedio(r.fin),
                mejor: Math.max.apply(null, r.acum),
                pctFructifico: (n - r.noFruct) / n * 100,
                nMezcla: r.mezclas.length, mezclas: r.mezclas, bolsas: r.bolsas,
                rankeable: n >= MIN_RANKING
            };
        });
        return ordenarFilas(filas, 'beF1Prom', -1);
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
        { key: 'hidrGrano', titulo: '🌾💧 Agua en grano vs BE',       eje: 'hidratación del grano (lote GR)', fmt: function (v) { return v.toFixed(0) + '%'; } }
    ];
    var PERIODOS = [{ key: '3', label: 'Últimos 3 meses', meses: 3 }, { key: '6', label: 'Últimos 6 meses', meses: 6 }, { key: 'todo', label: 'Todo', meses: null }];
    var VENTANAS = [5, 10, 20];
    var COLOR_MM_BE = '#5C9CE0', COLOR_MM_FALLAS = '#E05252';
    var RANK_COLS = [
        { key: 'nombre', label: 'Genética' },
        { key: 'n', label: 'Bolsas', num: true },
        { key: 'beF1Prom', label: 'BE 1ª oleada prom.' },
        { key: 'beFinalProm', label: 'BE final prom. (cerradas)', num: true },
        { key: 'mejor', label: 'Mejor BE', num: true },
        { key: 'pctFructifico', label: '% fructificó', num: true }
    ];
    // tips[chartId] = [{x, y, html, bolsaId}] en coordenadas SVG; tipSel[chartId] = punto bajo el mouse
    // rankFilas/rankDetIds: lo último renderizado — los onclick del ranking pasan un ÍNDICE, nunca el
    // nombre de la genética ni el ID (texto libre: un apóstrofo rompería el JS inline, ver CLAUDE.md).
    var ui = { modo: 'acum', periodo: 'todo', ventana: 10, rankSort: { key: 'beF1Prom', dir: -1 }, rankAbierta: null,
               rankFilas: [], rankDetIds: [], container: null, tips: {}, tipSel: {} };

    function btnToggle(key, label, actual, fn) {
        return '<button type="button" class="fr-an-toggle-btn' + (String(key) === String(actual) ? ' fr-an-on' : '') + '"'
            + ' onclick="FRAnalisis.' + fn + '(\'' + key + '\')">' + esc(label) + '</button>';
    }
    function fechaADate(iso) { var p = String(iso).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
    function fechaCorta(iso) { var p = String(iso).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso; }
    function ejeY(max) { return Math.max(100, Math.ceil(max / 100) * 100); }
    function estadoTxt(p) {
        if (p.tipo === 'contaminada') return '☣ contaminada';
        if (p.tipo === 'noFructifico' || p.noFructifico) return '🕳 no fructificó (BE 0)';
        return p.cerrada ? 'ciclo cerrado (BE final)' : 'en producción (BE parcial)';
    }
    function genTxt(gen) { return esc(gen.nombre) + (gen.mezcla ? '<br><span class="fr-an-dim">mezcla: ' + esc(gen.detalle) + '</span>' : ''); }

    // ── Tooltip ── cada gráfico registra sus puntos (ui.tips); al mover el mouse se toma el más
    // cercano (la distancia vertical pesa menos: en el gráfico de tiempo manda la fecha).
    function tipAttrs(id, clickable) {
        return ' onmousemove="FRAnalisis._tip(event, \'' + id + '\')" onmouseleave="FRAnalisis._tipOff(\'' + id + '\')"'
            + (clickable ? ' onclick="FRAnalisis._tipClick(\'' + id + '\')"' : '');
    }
    function tipMarcadores(T, bottom) {
        return '<line class="fr-an-cross" x1="0" x2="0" y1="' + T + '" y2="' + bottom + '" style="display:none"/>'
            + '<circle class="fr-an-ring" r="7" cx="0" cy="0" style="display:none"/>';
    }
    function tipMove(evt, id) {
        var svg = evt.currentTarget, pts = ui.tips[id];
        var tip = ui.container && ui.container.querySelector('.fr-an-tip');
        if (!svg || !pts || !pts.length || !tip) return;
        var rect = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
        var sx = (evt.clientX - rect.left) * vb.width / rect.width, sy = (evt.clientY - rect.top) * vb.height / rect.height;
        var best = null, bd = Infinity;
        pts.forEach(function (p) {
            var d = (p.x - sx) * (p.x - sx) + 0.25 * (p.y - sy) * (p.y - sy);
            if (d < bd) { bd = d; best = p; }
        });
        ui.tipSel[id] = best;
        tip.innerHTML = best.html;
        tip.style.display = 'block';
        var tx = evt.clientX + 16, ty = evt.clientY + 16, w = tip.offsetWidth, h = tip.offsetHeight;
        if (tx + w > window.innerWidth - 8) tx = evt.clientX - w - 16;
        if (ty + h > window.innerHeight - 8) ty = evt.clientY - h - 16;
        tip.style.left = Math.max(8, tx) + 'px';
        tip.style.top = Math.max(8, ty) + 'px';
        var cross = svg.querySelector('.fr-an-cross'), ring = svg.querySelector('.fr-an-ring');
        if (cross) { cross.setAttribute('x1', best.x); cross.setAttribute('x2', best.x); cross.style.display = ''; }
        if (ring) { ring.setAttribute('cx', best.x); ring.setAttribute('cy', best.y); ring.style.display = ''; }
    }
    function tipOff(id) {
        ui.tipSel[id] = null;
        var el = ui.container;
        if (!el) return;
        var tip = el.querySelector('.fr-an-tip');
        if (tip) tip.style.display = 'none';
        el.querySelectorAll('.fr-an-cross, .fr-an-ring').forEach(function (n) { n.style.display = 'none'; });
    }
    function tipClick(id) {
        var p = ui.tipSel[id];
        if (p && p.bolsaId) excluirPunto(id, p.bolsaId);
    }

    function svgTiempo(s) {
        ui.tips.tiempo = [];
        if (!s.puntos.length) return '<div class="fr-an-vacio">Sin bolsas con cosecha todavía.</div>';
        var W = 760, H = 260, L = 44, R = 44, T = 10, B = 30;
        var t0 = fechaADate(s.puntos[0].fecha).getTime(), t1 = fechaADate(s.puntos[s.puntos.length - 1].fecha).getTime();
        if (t1 === t0) { t0 -= 864e5; t1 += 864e5; }
        var yMax = ejeY(Math.max.apply(null, s.puntos.map(function (p) { return p.y; })));
        function X(iso) { return L + (fechaADate(iso).getTime() - t0) / (t1 - t0) * (W - L - R); }
        function Y(v) { return H - B - v / yMax * (H - B - T); }
        function Yf(v) { return H - B - v / 100 * (H - B - T); }   // eje derecho: % fallas
        var h = '<svg class="fr-an-svg fr-an-hover" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="BE en el tiempo"' + tipAttrs('tiempo', false) + '>'
            + '<rect x="' + L + '" y="' + T + '" width="' + (W - L - R) + '" height="' + (H - B - T) + '" fill="transparent"/>';
        for (var v = 0; v <= yMax; v += 100) {
            h += '<line class="fr-an-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/>'
               + '<text class="fr-an-tick" x="' + (L - 4) + '" y="' + (Y(v) + 3) + '" text-anchor="end">' + v + '%</text>';
        }
        [0, 25, 50, 75, 100].forEach(function (f) {
            h += '<text class="fr-an-tick fr-an-tick-fallas" x="' + (W - R + 4) + '" y="' + (Yf(f) + 3) + '">' + f + '%</text>';
        });
        var d = new Date(t0); d.setDate(1); d.setMonth(d.getMonth() + 1);
        var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
        while (d.getTime() <= t1) {
            var xm = L + (d.getTime() - t0) / (t1 - t0) * (W - L - R);
            h += '<line class="fr-an-grid" x1="' + xm + '" x2="' + xm + '" y1="' + T + '" y2="' + (H - B) + '"/>'
               + '<text class="fr-an-tick" x="' + xm + '" y="' + (H - 12) + '" text-anchor="middle">' + MESES[d.getMonth()] + '</text>';
            d.setMonth(d.getMonth() + 1);
        }
        if (s.mmFallas.length > 1) {
            h += '<polyline class="fr-an-mm fr-an-mm-fallas" stroke="' + COLOR_MM_FALLAS + '" points="'
               + s.mmFallas.map(function (p) { return X(p.fecha).toFixed(1) + ',' + Yf(p.v).toFixed(1); }).join(' ') + '"/>';
        }
        if (s.mmBE.length > 1) {
            h += '<polyline class="fr-an-mm" stroke="' + COLOR_MM_BE + '" points="'
               + s.mmBE.map(function (p) { return X(p.fecha).toFixed(1) + ',' + Y(p.v).toFixed(1); }).join(' ') + '"/>';
        }
        s.puntos.forEach(function (p) {
            var cx = +X(p.fecha).toFixed(1), cy = +Y(p.y).toFixed(1);
            if (p.tipo === 'contaminada') {
                h += '<g class="fr-an-mk-cont"><path d="M' + (cx - 4) + ' ' + (cy - 4) + 'L' + (cx + 4) + ' ' + (cy + 4)
                   + 'M' + (cx + 4) + ' ' + (cy - 4) + 'L' + (cx - 4) + ' ' + (cy + 4) + '"/></g>';
            } else if (p.tipo === 'noFructifico') {
                h += '<path class="fr-an-mk-nf" d="M' + (cx - 4.5) + ' ' + (cy - 4) + 'L' + (cx + 4.5) + ' ' + (cy - 4) + 'L' + cx + ' ' + (cy + 4) + 'Z"/>';
            } else {
                h += '<circle class="fr-an-pt' + (p.cerrada ? ' fr-an-pt-cerrada' : '') + '" cx="' + cx + '" cy="' + cy + '" r="3.4"/>';
            }
            var mb = valorEnFecha(s.mmBE, p.fecha), mf = valorEnFecha(s.mmFallas, p.fecha);
            ui.tips.tiempo.push({ x: cx, y: cy, bolsaId: p.id, html:
                '<b>' + esc(p.id) + '</b> · ' + genTxt(p.gen)
                + '<br>Armada ' + fechaCorta(p.fecha)
                + '<br>BE ' + (ui.modo === 'f1' ? '1ª oleada' : 'acumulado') + ': <b>' + p.y.toFixed(0) + '%</b>'
                + '<br>' + estadoTxt(p)
                + '<div class="fr-an-tip-sep"></div>'
                + '<span style="color:' + COLOR_MM_BE + '">MM BE (' + s.ventana + ' bolsas): ' + (mb == null ? '—' : mb.toFixed(0) + '%') + '</span>'
                + '<br><span style="color:' + COLOR_MM_FALLAS + '">MM fallas (' + s.ventana + ' bolsas): ' + (mf == null ? '—' : mf.toFixed(0) + '%') + '</span>' });
        });
        return h + tipMarcadores(T, H - B) + '</svg>';
    }

    function svgDispersion(def, d) {
        ui.tips[def.key] = [];
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
        var h = '<svg class="fr-an-svg fr-an-hover fr-an-clickable" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(def.titulo) + '"' + tipAttrs(def.key, true) + '>'
            + '<defs><clipPath id="' + clip + '"><rect x="' + L + '" y="' + T + '" width="' + (W - L - R) + '" height="' + (H - B - T) + '"/></clipPath></defs>'
            + '<rect x="' + L + '" y="' + T + '" width="' + (W - L - R) + '" height="' + (H - B - T) + '" fill="transparent"/>';
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
            var px = +X(p.x).toFixed(1), py = +Y(p.y).toFixed(1);
            if (p.noFructifico) {
                h += '<path class="fr-an-mk-nf" d="M' + (px - 4.5) + ' ' + (py - 4) + 'L' + (px + 4.5) + ' ' + (py - 4) + 'L' + px + ' ' + (py + 4) + 'Z"/>';
            } else {
                h += '<circle class="fr-an-pt' + (p.cerrada ? ' fr-an-pt-cerrada' : '') + '" cx="' + px + '" cy="' + py + '" r="3.6"/>';
            }
            ui.tips[def.key].push({ x: px, y: py, bolsaId: p.id, html:
                '<b>' + esc(p.id) + '</b> · ' + genTxt(p.gen)
                + '<br>' + esc(def.eje) + ': <b>' + esc(def.fmt(p.x)) + '</b>'
                + '<br>BE ' + (ui.modo === 'f1' ? '1ª oleada' : 'acumulado') + ': <b>' + p.y.toFixed(0) + '%</b>'
                + '<br>' + estadoTxt(p)
                + '<div class="fr-an-tip-sep"></div><span class="fr-an-dim">clic para excluir de este gráfico</span>' });
        });
        return h + tipMarcadores(T, H - B) + '</svg>';
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

    // Fila desplegada bajo una genética del ranking: sus bolsas del período. Clic en una bolsa
    // abre su ficha en el Dashboard (FR.select), igual que desde la Vista General.
    function htmlDetalleGenetica(f) {
        var ESTADO_CLS = { 'no fructificó': 'fr-an-est-nf', 'contaminada': 'fr-an-est-cont', 'ciclo cerrado': 'fr-an-est-cerr', 'en producción': 'fr-an-est-prod' };
        var h = '<tr class="fr-an-rank-detail"><td colspan="' + RANK_COLS.length + '"><table class="fr-an-det-table"><thead><tr>'
            + '<th>Bolsa</th><th>Armada</th><th class="fr-num">BE 1ª oleada</th><th class="fr-num">BE acumulado</th><th>Estado</th><th>Mezcla</th>'
            + '</tr></thead><tbody>';
        f.bolsas.forEach(function (b) {
            var idx = ui.rankDetIds.push(b.id) - 1;
            h += '<tr class="fr-an-det-row" onclick="event.stopPropagation();FRAnalisis.abrirBolsa(' + idx + ')" title="Abrir la ficha de ' + esc(b.id) + '">'
               + '<td><b>' + esc(b.id) + '</b></td>'
               + '<td>' + esc(fechaCorta(b.fechaInicio)) + '</td>'
               + '<td class="fr-num">' + b.beF1.toFixed(0) + '%</td>'
               + '<td class="fr-num">' + b.beAcum.toFixed(0) + '%</td>'
               + '<td><span class="fr-an-est ' + (ESTADO_CLS[b.estado] || '') + '">' + esc(b.estado) + '</span></td>'
               + '<td class="fr-an-dim">' + (b.mezcla ? esc(b.mezcla) : '—') + '</td></tr>';
        });
        return h + '</tbody></table></td></tr>';
    }

    function htmlRanking(validas) {
        var per = PERIODOS.filter(function (p) { return p.key === ui.periodo; })[0] || PERIODOS[0];
        var desde = per.meses ? restarMeses(hoyISO(), per.meses) : null;
        var filas = ordenarFilas(rankingGenetica(validas, desde), ui.rankSort.key, ui.rankSort.dir);
        var h = '<div class="fr-an-rank"><div class="fr-an-rank-head"><h3>🏆 Top genética por BE</h3><div class="fr-an-toggle">'
            + PERIODOS.map(function (p) { return btnToggle(p.key, p.label, ui.periodo, 'setPeriodo'); }).join('') + '</div></div>';
        if (!filas.length) return h + '<div class="fr-an-dim">Sin bolsas en este período.</div></div>';
        var maxBE = Math.max.apply(null, filas.map(function (f) { return f.beF1Prom; }).concat([1]));
        h += '<table class="data-table fr-an-rank-table"><thead><tr>'
           + RANK_COLS.map(function (c) {
                var flecha = ui.rankSort.key === c.key ? (ui.rankSort.dir > 0 ? ' ↑' : ' ↓') : '';
                return '<th class="fr-an-th-sort' + (c.num ? ' fr-num' : '') + '" onclick="FRAnalisis.ordenarRanking(\'' + c.key + '\')" title="Ordenar">' + c.label + flecha + '</th>';
             }).join('')
           + '</tr></thead><tbody>';
        ui.rankFilas = filas;
        ui.rankDetIds = [];
        filas.forEach(function (f, i) {
            var abierta = ui.rankAbierta === f.key;
            var mez = f.nMezcla ? ' <span class="fr-an-mezcla" title="' + esc(f.mezclas.join('\n')) + '">(' + f.nMezcla + ' con mezcla)</span>' : '';
            var bar = '<span class="fr-an-bar" style="width:' + Math.round(f.beF1Prom / maxBE * 90) + 'px"></span>' + f.beF1Prom.toFixed(0) + '%';
            h += '<tr class="fr-an-rank-row' + (f.rankeable ? '' : ' fr-an-dim-row') + (abierta ? ' fr-an-rank-open' : '') + '"'
               + ' onclick="FRAnalisis.toggleGenetica(' + i + ')" title="Ver las bolsas de esta genética">'
               + '<td><span class="fr-an-caret">' + (abierta ? '▾' : '▸') + '</span> <b>' + esc(f.nombre) + '</b>' + mez
               + (f.rankeable ? '' : ' <i class="fr-an-dim">· pocas bolsas</i>') + '</td>'
               + '<td class="fr-num">' + f.n + '</td><td>' + bar + '</td>'
               + '<td class="fr-num">' + (f.beFinalProm != null ? f.beFinalProm.toFixed(0) + '% <span class="fr-an-dim">(' + f.nCerradas + ')</span>' : '— <span class="fr-an-dim">(0)</span>') + '</td>'
               + '<td class="fr-num">' + f.mejor.toFixed(0) + '%</td>'
               + '<td class="fr-num">' + f.pctFructifico.toFixed(0) + '%</td></tr>';
            if (abierta) h += htmlDetalleGenetica(f);
        });
        return h + '</tbody></table><div class="fr-an-dim">Tocá una genética para ver sus bolsas; tocá un encabezado para ordenar. Genéticas con menos de ' + MIN_RANKING
            + ' bolsas en el período van en gris ("pocas bolsas": el promedio es poco confiable). BE final = solo las que ya cerraron ciclo '
            + '(entre paréntesis cuántas). "No fructificó" cuenta como 0. Una bolsa con varias genéticas cuenta para la de más frascos; '
            + 'empate → "Mezcla pareja".</div></div>';
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
        var st = serieTiempo(bolsas, ui.modo, grMap, nombreGenetica, ui.ventana);
        var ventanas = VENTANAS.map(function (w) { return btnToggle(w, w + ' bolsas', ui.ventana, 'setVentana'); }).join('');
        var html = '<div class="fr-an-tip" style="display:none"></div>'
            + '<div class="fr-an-toolbar"><div class="fr-an-toggle">'
            + btnToggle('acum', 'BE acumulado', ui.modo, 'setModo') + btnToggle('f1', 'Comparar 1ª oleada', ui.modo, 'setModo')
            + '</div><span class="fr-an-leyenda">● ciclo cerrado · ○ en producción (BE parcial) · <span class="fr-an-ley-cont">✕ contaminada</span> · <span class="fr-an-ley-nf">▽ no fructificó</span></span></div>'
            + '<div class="fr-an-chart fr-an-chart-main"><div class="fr-an-chart-head"><div class="fr-an-chart-title">📈 BE en el tiempo (por fecha de armado)</div>'
            + '<div class="fr-an-toggle"><span class="fr-an-toggle-label">Media móvil:</span>' + ventanas + '</div></div>'
            + svgTiempo(st)
            + '<div class="fr-an-chart-pie"><span class="fr-an-mm-key" style="border-color:' + COLOR_MM_BE + ';color:' + COLOR_MM_BE + '">MM BE (eje izq.)</span> '
            + '<span class="fr-an-mm-key" style="border-color:' + COLOR_MM_FALLAS + ';color:' + COLOR_MM_FALLAS + '">MM % fallas: contaminada + no fructificó (eje der.)</span>'
            + ' — promedio de las últimas ' + ui.ventana + ' bolsas' + (ui.modo === 'acum' ? ' (MM BE: solo ciclo cerrado)' : '')
            + '. BE subiendo y fallas bajando = protocolos mejorando.</div></div>'
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
        setVentana: function (w) { w = parseInt(w, 10); ui.ventana = VENTANAS.indexOf(w) >= 0 ? w : 10; render(); },
        ordenarRanking: function (key) {
            if (ui.rankSort.key === key) ui.rankSort.dir = -ui.rankSort.dir;
            else ui.rankSort = { key: key, dir: key === 'nombre' ? 1 : -1 };
            render();
        },
        toggleGenetica: function (i) {
            var f = ui.rankFilas[i];
            if (!f) return;
            ui.rankAbierta = ui.rankAbierta === f.key ? null : f.key;
            render();
        },
        abrirBolsa: function (i) {
            var id = ui.rankDetIds[i];
            if (id && window.FR && typeof window.FR.select === 'function') window.FR.select(id);
        },
        _tip: tipMove,
        _tipOff: tipOff,
        _tipClick: tipClick,
        excluirPunto: excluirPunto,
        quitarExclusion: quitarExclusion,
        _calc: {
            motivoInvalida: motivoInvalida, hidratacionLoteGR: hidratacionLoteGR, hidrGranoBolsa: hidrGranoBolsa,
            atribuirGenetica: atribuirGenetica, metricasBolsa: metricasBolsa, analizarBolsas: analizarBolsas,
            regresion: regresion, mediaMovil: mediaMovil, datosGrafico: datosGrafico, serieTiempo: serieTiempo,
            valorEnFecha: valorEnFecha, ordenarFilas: ordenarFilas,
            rankingGenetica: rankingGenetica, restarMeses: restarMeses, conExclusion: conExclusion,
            sinExclusion: sinExclusion, MEZCLA_PAREJA: MEZCLA_PAREJA
        }
    });
})();
