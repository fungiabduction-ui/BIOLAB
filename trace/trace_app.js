/**
 * ============================================================
 *  BIOLAB ENGINE v3 — Módulo TRACE (Trazabilidad)
 * ------------------------------------------------------------
 *  Módulo 100% de SOLO LECTURA.
 *  Render estilo terminal ASCII (├── / └── / │), igual que GE.
 *
 *  Expone:
 *    window.traceInit()            ← invocado por main.js al montar
 *    window.onModuleUnload         ← hook de desmontaje
 *    window.traceEnhanceFrIdTree() ← hace clickeable el árbol de FR
 *
 *  Funciones globales (usadas por onclick en HTML generado):
 *    window.traceSetTab(name)
 *    window.traceNav(tipo, id)
 *    window.traceSelectAnchor(tipo, id)
 *    window.traceClearAnchor()
 * ============================================================
 */
(function () {
    'use strict';

    /* ══════════════════════════════════════════════════════════
       1. STORAGE — LECTURA DEFENSIVA
       ══════════════════════════════════════════════════════════ */

    function safeGet(key) {
        try {
            var v = JSON.parse(localStorage.getItem(key));
            return (v !== null && v !== undefined) ? v : null;
        } catch (e) { return null; }
    }

    function getGEData()    { var d = safeGet('biolab.ge.v4'); return (d && d.nodes) ? d : { nodes: [] }; }
    function getCIs()       { var v = safeGet('bl2_cultivos');    return Array.isArray(v) ? v : []; }
    function getForms()     { var v = safeGet('bl2_forms');       return Array.isArray(v) ? v : []; }
    function getGRLotes()   { var v = safeGet('gr_lotes'); return Array.isArray(v) ? v : []; }
    function getSULotes()   { var v = safeGet('su_lotes');        return Array.isArray(v) ? v : []; }
    function getFRBolsas()  { var v = safeGet('fr_bolsas');       return Array.isArray(v) ? v : []; }
    function getCiGrLinks() { var v = safeGet('bl2_ci_gr_links'); return Array.isArray(v) ? v : []; }

    /* ══════════════════════════════════════════════════════════
       1.5 VALIDACIÓN DE SCHEMAS
       ══════════════════════════════════════════════════════════ */

    function warnSchema(nombre, items, validarItem) {
        if (!Array.isArray(items)) {
            console.warn('[TRACE] ' + nombre + ': esperaba array, recibió', typeof items);
            return;
        }
        var malos = items.filter(function(item) { return !validarItem(item); });
        if (malos.length > 0) {
            console.warn('[TRACE] ' + nombre + ': ' + malos.length + ' items con schema inesperado', malos.slice(0, 3));
        }
    }

    function validarGRLote(l)  { return l && typeof l.id === 'string' && Array.isArray(l.dg); }
    function validarSULote(l)  { return l && typeof l._uuid === 'string' && Array.isArray(l.db); }
    function validarFRBolsa(b) { return b && typeof b.id === 'string' && typeof b.pendienteConfirmacion === 'boolean'; }
    function frEsPendiente(b) { return b.pendienteConfirmacion === true; }
    function validarCI(c)      { return c && typeof c.id === 'string'; }

    /* ══════════════════════════════════════════════════════════
       2. UTILIDADES GENERALES
       ══════════════════════════════════════════════════════════ */

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }
    // escPfx: igual pero sin comillas (el prefijo ASCII no las necesita)
    function escPfx(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function fmtFecha(iso) {
        if (!iso) return '—';
        try {
            if (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}/.test(iso)) {
                var p = iso.substring(0, 10).split('-');
                return p[2] + '/' + p[1] + '/' + p[0];
            }
            var d = new Date(iso);
            if (isNaN(d.getTime())) return String(iso);
            return String(d.getDate()).padStart(2,'0') + '/' +
                   String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear();
        } catch (e) { return String(iso); }
    }

    function diasEntre(isoA, isoB) {
        if (!isoA || !isoB) return null;
        try {
            var a = new Date(isoA), b = new Date(isoB);
            if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
            var d = Math.round((b - a) / 86400000);
            return d < 0 ? null : d;
        } catch (e) { return null; }
    }

    function hoyISO() { return new Date().toISOString().split('T')[0]; }

    /* ══════════════════════════════════════════════════════════
       3. GE — HELPERS
       ══════════════════════════════════════════════════════════ */

    function geChain(nodeId) {
        if (!nodeId) return [];
        var nodes = getGEData().nodes;
        var map   = {};
        nodes.forEach(function (n) { map[n.id] = n; });
        var chain = [], cur = map[nodeId];
        while (cur) { chain.unshift(cur); cur = cur.parentId ? map[cur.parentId] : null; }
        return chain;
    }

    function geDescendantIds(nodeId) {
        if (!nodeId) return [];
        var nodes  = getGEData().nodes;
        var result = [nodeId], queue = [nodeId];
        while (queue.length > 0) {
            var cur = queue.shift();
            nodes.forEach(function (n) {
                if (n.parentId === cur) { result.push(n.id); queue.push(n.id); }
            });
        }
        return result;
    }

    /* ══════════════════════════════════════════════════════════
       4. CI — HELPERS
       ══════════════════════════════════════════════════════════ */

    function ciById(id) {
        if (!id) return null;
        var cis = getCIs();
        for (var i = 0; i < cis.length; i++) { if (cis[i].id === id) return cis[i]; }
        return null;
    }
    function formName(fid) {
        if (!fid) return null;
        var f = getForms();
        for (var i = 0; i < f.length; i++) { if (f[i].id === fid) return f[i].nombre || fid; }
        return null;
    }
    function cisByGENodeId(geNodeId) {
        if (!geNodeId) return [];
        var ids = geDescendantIds(geNodeId);
        return getCIs().filter(function (c) { return ids.indexOf(c.geneticaId) >= 0; });
    }

    /* ══════════════════════════════════════════════════════════
       5. GR — HELPERS
       ══════════════════════════════════════════════════════════ */

    function grLoteById(id) {
        if (!id) return null;
        var lotes = getGRLotes();
        for (var i = 0; i < lotes.length; i++) { if (lotes[i].id === id) return lotes[i]; }
        return null;
    }
    function grDgEntry(grLote, tanda) {
        if (!grLote || !grLote.dg) return null;
        if (tanda) for (var i = 0; i < grLote.dg.length; i++) { if (grLote.dg[i].tanda === tanda) return grLote.dg[i]; }
        return grLote.dg[0] || null;
    }
    function grPrimerComp(grLote) {
        if (!grLote || !grLote.componentes || !grLote.componentes[0]) return null;
        return grLote.componentes[0].nombre || null;
    }
    /** Devuelve {seco, hidratado, pct} desde componentes del lote GR. */
    function grMasas(grLote) {
        if (!grLote || !grLote.componentes) return null;
        var seco = 0, hid = 0;
        grLote.componentes.forEach(function (c) {
            var m = parseFloat(c.masa) || 0;
            if ((c.nombre || '').toLowerCase().includes('agua')) hid += m;
            else seco += m;
        });
        if (seco === 0 && hid === 0) return null;
        return { seco: seco, hid: hid, pct: seco > 0 && hid > 0 ? Math.round(hid / seco * 100) : 0 };
    }
    function grTandasByCi(ciId) {
        if (!ciId) return [];
        var result = {}, out = [];
        function add(grLote, tanda, dg) {
            var k = grLote.id + '::' + (tanda || '');
            if (!result[k]) { result[k] = true; out.push({ grLoteId: grLote.id, tanda: tanda, dg: dg, grLote: grLote }); }
        }
        getGRLotes().forEach(function (gr) {
            (gr.dg || []).forEach(function (dg) {
                if (dg.cultivoCiId === ciId) add(gr, dg.tanda, dg);
            });
        });
        getCiGrLinks().forEach(function (l) {
            if (l.cultivoCiId === ciId) {
                var gr = grLoteById(l.grLoteId);
                if (gr) add(gr, l.grTanda, grDgEntry(gr, l.grTanda));
            }
        });
        return out;
    }
    function grTandasByGEDirect(geNodeId) {
        if (!geNodeId) return [];
        var ids = geDescendantIds(geNodeId);
        var result = {}, out = [];
        getGRLotes().forEach(function (gr) {
            (gr.dg || []).forEach(function (dg) {
                if (dg.cultivoCiId) return;
                if (ids.indexOf(dg.fen_id) >= 0 || ids.indexOf(dg.genetica) >= 0) {
                    var k = gr.id + '::' + (dg.tanda || '');
                    if (!result[k]) { result[k] = true; out.push({ grLoteId: gr.id, tanda: dg.tanda, dg: dg, grLote: gr }); }
                }
            });
        });
        return out;
    }

    /* ══════════════════════════════════════════════════════════
       6. SU — HELPERS
       ══════════════════════════════════════════════════════════ */

    function suLoteById(id) {
        if (!id) return null;
        var l = getSULotes();
        for (var i = 0; i < l.length; i++) { if (l[i].id === id) return l[i]; }
        return null;
    }
    function susByGrTanda(grLoteId, grTanda) {
        return getSULotes().filter(function (su) {
            var grLoteDefault = su.grProtocolo || '';
            return (su.db || []).some(function (r) {
                // Nuevo formato: verificar grSources[] (multi-fuente)
                if (Array.isArray(r.grSources) && r.grSources.length > 0) {
                    return r.grSources.some(function(s) {
                        return s.grLoteId === grLoteId && s.grTandaId === grTanda;
                    });
                }
                // Formato legacy: campos flat con fallback a grProtocolo del lote
                var lid = (r.grLoteId || grLoteDefault || '').trim();
                return lid === grLoteId && r.grTandaId === grTanda;
            });
        });
    }

    /* ══════════════════════════════════════════════════════════
       7. FR — HELPERS
       ══════════════════════════════════════════════════════════ */

    function frBolsaById(id) {
        if (!id) return null;
        var b = getFRBolsas();
        for (var i = 0; i < b.length; i++) { if (b[i].id === id || b[i]._frUuid === id) return b[i]; }
        return null;
    }
    function frsBySuLote(suId) {
        return getFRBolsas().filter(function (b) { return b.suLoteId === suId; });
    }
    function frRendimiento(b) {
        if (!b || !b.flushes) return 0;
        return b.flushes.reduce(function (s, f) { return s + (parseFloat(f.pesoHumedo) || 0); }, 0);
    }
    function frFlushSummary(b) {
        if (!b || !b.flushes || !b.flushes.length) return null;
        return b.flushes.map(function (f, i) {
            var n = f.n != null ? f.n : (i + 1);
            var p = parseFloat(f.pesoHumedo);
            return 'F' + n + ': ' + (isNaN(p) ? '?' : p.toFixed(0)) + 'g';
        }).join(' · ');
    }
    function frEstado(b) {
        if (!b) return '—';
        if (b.estado) return b.estado;
        if (b.cicloCerrado || b.fechaCosecha) return 'cosechado';
        if (b.fechaPines)        return 'pinning';
        if (b.fechaColonizacion) return 'colonizado';
        return 'colonizando';
    }

    /* ══════════════════════════════════════════════════════════
       8. ANCHOR RESOLUTION
       ══════════════════════════════════════════════════════════ */

    function resolveAnchor(anchor) {
        var r = { geNodeId: null, ciId: null, grLoteId: null, grTanda: null, suLoteId: null, frId: null };
        if (!anchor || !anchor.tipo || !anchor.id) return r;
        try {
            if (anchor.tipo === 'FR') {
                var fr = frBolsaById(anchor.id);
                if (!fr) return r;
                r.frId = fr.id; r.suLoteId = fr.suLoteId; r.grLoteId = fr.grLoteId; r.grTanda = fr.grTandaId;
                if (r.grLoteId) {
                    var dg = grDgEntry(grLoteById(r.grLoteId), r.grTanda);
                    if (dg && dg.cultivoCiId) { r.ciId = dg.cultivoCiId; var ci = ciById(r.ciId); if (ci) r.geNodeId = ci.geneticaId; }
                    if (!r.geNodeId && dg) r.geNodeId = dg.fen_id || dg.genetica || null;
                }
                if (!r.geNodeId) r.geNodeId = fr.fenId || null;
            } else if (anchor.tipo === 'SU') {
                var su = suLoteById(anchor.id);
                if (!su) return r;
                r.suLoteId = su.id;
                var db0 = su.db && su.db[0];
                if (db0) { r.grLoteId = db0.grLoteId; r.grTanda = db0.grTandaId; }
                if (r.grLoteId) {
                    var dg2 = grDgEntry(grLoteById(r.grLoteId), r.grTanda);
                    if (dg2 && dg2.cultivoCiId) { r.ciId = dg2.cultivoCiId; var ci2 = ciById(r.ciId); if (ci2) r.geNodeId = ci2.geneticaId; }
                    if (!r.geNodeId && dg2) r.geNodeId = dg2.fen_id || dg2.genetica || null;
                }
            } else if (anchor.tipo === 'GR') {
                var grL = grLoteById(anchor.id);
                if (!grL) return r;
                r.grLoteId = grL.id;
                var dg3 = grDgEntry(grL, null);
                if (dg3) {
                    r.grTanda = dg3.tanda;
                    if (dg3.cultivoCiId) { r.ciId = dg3.cultivoCiId; var ci3 = ciById(r.ciId); if (ci3) r.geNodeId = ci3.geneticaId; }
                    if (!r.geNodeId) r.geNodeId = dg3.fen_id || dg3.genetica || null;
                }
            } else if (anchor.tipo === 'CI') {
                var ci4 = ciById(anchor.id);
                if (ci4) { r.ciId = ci4.id; r.geNodeId = ci4.geneticaId; }
            } else if (anchor.tipo === 'GE') {
                r.geNodeId = anchor.id;
            }
        } catch (e) { console.warn('[TRACE] resolveAnchor:', e); }
        return r;
    }

    /* ══════════════════════════════════════════════════════════
       9. ASCII TREE — LINE BUILDERS
       ══════════════════════════════════════════════════════════ */

    /**
     * Calcula el prefix que se pasa a los hijos de un nodo.
     * isLast=true  → 6 spaces   (el └── no tiene continuación)
     * isLast=false → │ + 5 sp   (el ├── tiene continuación)
     */
    function childPfx(parentPfx, isLast) {
        return parentPfx + (isLast ? '      ' : '│     ');
    }

    /**
     * mkLine — genera un <span> completo para una línea clickeable del árbol.
     *   pfx     : string del prefijo ASCII (dim, no-selectable)
     *   conn    : conector ('├── ' / '└── ' / '')
     *   labelHtml : HTML del contenido coloreado
     *   cls     : clase(s) extra para el span externo
     *   clickFn : string de la llamada onclick (o null)
     */
    function mkLine(pfx, conn, labelHtml, cls, clickFn) {
        var click = clickFn ? ' onclick="' + clickFn + '"' : '';
        var isCl  = !!clickFn;
        return '<span class="tl' + (cls ? ' ' + cls : '') + (isCl ? ' tl-click' : '') + '"' + click + '>' +
               '<span class="tl-pfx">' + escPfx(pfx) + escPfx(conn) + '</span>' +
               labelHtml +
               '</span>';
    }

    /** mkDetail — línea de detalle (dim, no clickeable). */
    function mkDetail(pfx, text) {
        return '<span class="tl tl-detail">' +
               '<span class="tl-pfx">' + escPfx(pfx) + '</span>' +
               '<span class="tl-detail-txt">' + text + '</span>' +
               '</span>';
    }

    /** mkSep — línea de separación/continuación (solo el │, muy dim). */
    function mkSep(pfxWithPipe) {
        return '<span class="tl tl-sep">' +
               '<span class="tl-pfx">' + escPfx(pfxWithPipe) + '</span>' +
               '</span>';
    }

    function mkBlank() {
        return '<span class="tl tl-blank"> </span>';
    }

    /** Chip de estado para FR */
    function chipEstado(estado) {
        var e = (estado || '').toLowerCase();
        return ' <span class="tl-chip tl-chip-' + e + '">' + esc(estado) + '</span>';
    }

    /** Label GE (cadena "Especie / Cepa / Fenotipo") */
    function geLinaje(geNodeId) {
        var chain = geChain(geNodeId);
        return chain.map(function (n) { return n.name || n.id; }).join(' / ');
    }

    /* ══════════════════════════════════════════════════════════
       11. TRACE GLOBAL — BUILDER DE LÍNEAS
           Árbol completo GE → CI → GR → SU → FR
       ══════════════════════════════════════════════════════════ */

    function buildGlobalLinesArray(resolved) {
        var L = [];

        // ── GE root ─────────────────────────────────────────────
        var geNodeId = resolved.geNodeId;
        var chain    = geChain(geNodeId);
        var lastGE   = chain.length > 0 ? chain[chain.length - 1] : null;
        var geTxt    = chain.length > 0
            ? chain.map(function (n) { return esc(n.name || n.id); }).join(' <span class="tl-slash">/</span> ')
            : esc(geNodeId || '—');

        L.push(mkLine('', '', '<span class="tl-lbl-ge">🧬 ' + geTxt + '</span>' +
            (lastGE ? ' <span class="tl-id">(' + esc(lastGE.id) + ')</span>' : ''),
            'tl-ge', lastGE ? 'traceNav(\'GE\',\'' + esc(lastGE.id) + '\')' : null));

        // ── CIs hijos ───────────────────────────────────────────
        var cis = cisByGENodeId(geNodeId);
        if (resolved.ciId && !cis.some(function (c) { return c.id === resolved.ciId; })) {
            var ci0 = ciById(resolved.ciId);
            if (ci0) cis.unshift(ci0);
        }

        var ciParPfx = ' ';

        // CIs
        var displayCIs = cis.slice(0, 8);
        if (displayCIs.length > 0) {
            L.push(mkBlank());
            if (cis.length > 8) L.push(mkDetail(ciParPfx, '(' + (cis.length - 8) + ' cultivos CI más no mostrados)'));

            displayCIs.forEach(function (ci, ii) {
                var isLastCI = ii === displayCIs.length - 1;
                var ciConn   = isLastCI ? '└── ' : '├── ';
                var ciChPfx  = childPfx(ciParPfx, isLastCI);
                var isCIAnch = ci.id === resolved.ciId;
                var forma    = formName(ci.medioFormulaId);
                var estado   = (ci.estado || '').toLowerCase();

                var ciLabel = '<span class="tl-lbl-ci">🧫 ' + esc(ci.codigo || ci.id) + '</span>' +
                              chipEstado(ci.estado || '—');
                L.push(mkLine(ciParPfx, ciConn, ciLabel,
                    'tl-ci' + (isCIAnch ? ' tl-anchor' : ''),
                    'traceNav(\'CI\',\'' + esc(ci.id) + '\')'));

                if (forma) L.push(mkDetail(ciChPfx, 'medio: ' + esc(forma)));
                if (ci.tipo) {
                    var disp = (ci.cantidadDisponible != null ? ci.cantidadDisponible : '?') + '/' + (ci.cantidadInicial != null ? ci.cantidadInicial : '?');
                    L.push(mkDetail(ciChPfx, 'tipo: ' + esc(ci.tipo) + ' · disponible: ' + disp));
                }

                // GR tandas de este CI
                var grTandas = grTandasByCi(ci.id);
                if (grTandas.length > 0) {
                    L.push(mkSep(ciParPfx + '│'));
                    _appendGRBlock(L, grTandas.slice(0, 6), ciChPfx, resolved);
                    if (grTandas.length > 6) L.push(mkDetail(ciChPfx, '(' + (grTandas.length - 6) + ' tandas GR más)'));
                } else {
                    L.push(mkDetail(ciChPfx, '— sin lotes GR vinculados —'));
                }

                if (!isLastCI) L.push(mkSep(ciParPfx + '│'));
                L.push(mkBlank());
            });
        }

        // Conexiones directas GE → GR (sin CI)
        var directGR = grTandasByGEDirect(geNodeId);
        if (directGR.length > 0) {
            L.push(mkBlank());
            L.push(mkDetail('', '↓ inoculaciones directas desde GE (sin paso CI):'));
            _appendGRBlock(L, directGR.slice(0, 6), ' ', resolved);
        }

        if (displayCIs.length === 0 && directGR.length === 0) {
            L.push(mkBlank());
            L.push(mkDetail('', '— sin cultivos CI ni inoculaciones directas para esta genética —'));
        }

        return L;
    }

    function _traceGrUsadosTanda(grLoteId, tandaId) {
        try {
            var raw = localStorage.getItem('gr_usados');
            var m = raw ? JSON.parse(raw) : {};
            return (m[grLoteId] && m[grLoteId][tandaId]) ? (parseInt(m[grLoteId][tandaId]) || 0) : 0;
        } catch(e) { return 0; }
    }

    function _appendGRBlock(L, grTandas, grParPfx, resolved) {
        grTandas.forEach(function (grEntry, gi) {
            var isLastGR  = gi === grTandas.length - 1;
            var grConn    = isLastGR ? '└── ' : '├── ';
            var grChPfx   = childPfx(grParPfx, isLastGR);
            var isGRAnch  = resolved && grEntry.grLoteId === resolved.grLoteId && grEntry.tanda === resolved.grTanda;
            var masas     = grMasas(grEntry.grLote);
            var comp      = grPrimerComp(grEntry.grLote);
            var dg        = grEntry.dg || {};

            var grLabel = '<span class="tl-lbl-gr">🌾 ' + esc(grEntry.grLoteId) + '</span>';
            if (grEntry.tanda) grLabel += ' <span class="tl-sub">· tanda ' + esc(grEntry.tanda) + '</span>';
            if (!dg.cultivoCiId) grLabel += ' <span class="tl-tag">GE directo</span>';
            L.push(mkLine(grParPfx, grConn, grLabel,
                'tl-gr' + (isGRAnch ? ' tl-anchor' : ''),
                'traceNav(\'GR\',\'' + esc(grEntry.grLoteId) + '\')'));

            if (comp) L.push(mkDetail(grChPfx, 'grano: ' + esc(comp)));
            if (masas && masas.pct > 0) L.push(mkDetail(grChPfx, 'hid: ' + masas.pct + '%'));
            if (dg.fechaInoculacion)    L.push(mkDetail(grChPfx, 'inoculado: ' + fmtFecha(dg.fechaInoculacion)));

            // Frascos: totales · contaminados · disponibles
            var frascosTot = parseInt(dg.frascos) || 0;
            if (frascosTot > 0) {
                var frascosContam = parseInt(dg.contaminados) || 0;
                var frascosUsados = _traceGrUsadosTanda(grEntry.grLoteId, grEntry.tanda);
                var frascosDisp   = Math.max(0, frascosTot - frascosContam - frascosUsados);
                L.push(mkDetail(grChPfx,
                    frascosTot + ' frascos · ' + frascosContam + ' contam · ' + frascosDisp + ' disp.'));
            }

            // Tipo de inóculo
            if (dg.inoculoSource) {
                var inocLbl = dg.inoculoSource === 'CI'
                    ? 'CI / Placa' + (dg.cultivoCiId ? ' (' + esc(dg.cultivoCiId) + ')' : '')
                    : 'GE directo';
                L.push(mkDetail(grChPfx, 'inóculo: ' + inocLbl));
            }

            // SU hijos de este GR tanda
            var sus = susByGrTanda(grEntry.grLoteId, grEntry.tanda);
            if (sus.length > 0) {
                L.push(mkSep(grParPfx + '│'));
                _appendSUBlock(L, sus.slice(0, 5), grChPfx, resolved);
                if (sus.length > 5) L.push(mkDetail(grChPfx, '(' + (sus.length - 5) + ' lotes SU más)'));
            } else {
                L.push(mkDetail(grChPfx, '— sin lotes SU —'));
            }

            if (!isLastGR) L.push(mkSep(grParPfx + '│'));
        });
    }

    function _appendSUBlock(L, sus, suParPfx, resolved) {
        sus.forEach(function (su, si) {
            var isLastSU  = si === sus.length - 1;
            var suConn    = isLastSU ? '└── ' : '├── ';
            var suChPfx   = childPfx(suParPfx, isLastSU);
            var isSUAnch  = resolved && su.id === resolved.suLoteId;

            var suLabel = '<span class="tl-lbl-su">🪵 ' + esc(su.id) + '</span>';
            if (su.tipo)          suLabel += ' <span class="tl-sub">· ' + esc(su.tipo) + '</span>';
            if (su.pesoSustrato)  suLabel += ' <span class="tl-sub">· ' + parseFloat(su.pesoSustrato).toFixed(0) + ' g</span>';
            if (su.fecha)         suLabel += ' <span class="tl-sub">· ' + fmtFecha(su.fecha) + '</span>';
            L.push(mkLine(suParPfx, suConn, suLabel,
                'tl-su' + (isSUAnch ? ' tl-anchor' : ''),
                'traceNav(\'SU\',\'' + esc(su.id) + '\')'));

            // Bolsas totales
            var suBolsas = parseInt(su.bolsas) || 0;
            if (suBolsas > 0) L.push(mkDetail(suChPfx, suBolsas + ' bolsas'));

            // Hidratación %
            var suFibra = parseFloat(su.fibra) || 0;
            var suTotal = parseFloat(su.total) || 0;
            if (suFibra > 0 && suTotal > 0) {
                var hidPct = Math.round((suTotal - suFibra) / suFibra * 100);
                L.push(mkDetail(suChPfx, 'hid: ' + hidPct + '%'));
            }

            // Top 2 aditivos
            var aditivos = Array.isArray(su.aditivos) ? su.aditivos : [];
            aditivos.slice(0, 2).forEach(function(ad) {
                if (ad && ad.nombre) {
                    var adTxt = esc(ad.nombre) + (ad.cantidad ? ' ' + ad.cantidad + (ad.unidad ? ad.unidad : '') : '');
                    L.push(mkDetail(suChPfx, '+ ' + adTxt));
                }
            });

            // FR bolsas
            var frs = frsBySuLote(su.id);
            if (frs.length > 0) {
                L.push(mkSep(suParPfx + '│'));
                var MAX_FR = 15;
                var displayFRs = frs.slice(0, MAX_FR);
                displayFRs.forEach(function (fr, fi) {
                    var isLastFR  = fi === displayFRs.length - 1 && frs.length <= MAX_FR;
                    var frConn    = isLastFR ? '└── ' : '├── ';
                    var frChPfx   = childPfx(suChPfx, isLastFR);
                    var isFRAnch  = resolved && fr.id === resolved.frId;
                    var rend      = frRendimiento(fr);
                    var estado    = frEstado(fr);

                    var frLabel = '<span class="tl-lbl-fr">🍄 ' + esc(fr.id) + '</span>';
                    if (rend > 0) frLabel += ' <span class="tl-sub">' + rend.toFixed(0) + 'g</span>';
                    frLabel += chipEstado(estado);
                    if (fr.contaminada) frLabel += ' <span class="tl-tag tl-tag-conta">conta</span>';
                    L.push(mkLine(suChPfx, frConn, frLabel,
                        'tl-fr' + (isFRAnch ? ' tl-anchor' : ''),
                        'traceNav(\'FR\',\'' + esc(fr.id) + '\')'));

                    // Días desde inicio
                    var diasFR = null;
                    if (fr.fechaInicio) {
                        var fechaFinFR = (fr.cicloCerrado && fr.fechaCierreCiclo) ? fr.fechaCierreCiclo : hoyISO();
                        diasFR = diasEntre(fr.fechaInicio, fechaFinFR);
                    }
                    if (diasFR != null) L.push(mkDetail(frChPfx, 'día ' + diasFR));

                    // Colonización y pines
                    if (fr.fechaColonizacion && fr.fechaInicio) {
                        var dcolFR = diasEntre(fr.fechaInicio, fr.fechaColonizacion);
                        L.push(mkDetail(frChPfx, 'colon: ' + fmtFecha(fr.fechaColonizacion) + (dcolFR != null ? ' (día ' + dcolFR + ')' : '')));
                    }
                    if (fr.fechaPines && fr.fechaInicio) {
                        var dpinesFR = diasEntre(fr.fechaInicio, fr.fechaPines);
                        L.push(mkDetail(frChPfx, 'pines: ' + fmtFecha(fr.fechaPines) + (dpinesFR != null ? ' (día ' + dpinesFR + ')' : '')));
                    }

                    // Rendimiento
                    var rend2 = frRendimiento(fr);
                    if (rend2 > 0) L.push(mkDetail(frChPfx, 'rendimiento: ' + rend2.toFixed(0) + 'g'));

                    // Flushes individuales con BE
                    if (Array.isArray(fr.flushes) && fr.flushes.length > 0) {
                        var beAcumFR = 0;
                        fr.flushes.forEach(function(f, fi) {
                            var ph = parseFloat(f.pesoHumedo) || 0;
                            var bef = (ph > 0 && fr.pesoSustratoSeco > 0)
                                ? (ph / fr.pesoSustratoSeco * 100) : 0;
                            beAcumFR += bef;
                            var flTxt = 'F' + (fi + 1) + ': ' + ph.toFixed(0) + 'g'
                                + (bef > 0 ? ' · BE ' + bef.toFixed(1) + '%' : '');
                            L.push(mkDetail(frChPfx, flTxt));
                        });
                        if (beAcumFR > 0) L.push(mkDetail(frChPfx, 'BE acum: ' + beAcumFR.toFixed(1) + '%'));
                    } else {
                        var flush = frFlushSummary(fr);
                        if (flush) L.push(mkDetail(frChPfx, 'flushes: ' + esc(flush)));
                    }

                    if (!isLastFR) L.push(mkSep(suChPfx + '│'));
                });
                if (frs.length > MAX_FR) L.push(mkDetail(suChPfx, '(' + (frs.length - MAX_FR) + ' bolsas FR más — buscá por SU en FR Trace ★)'));
            } else {
                L.push(mkDetail(suChPfx, '— sin bolsas FR —'));
            }

            if (!isLastSU) L.push(mkSep(suParPfx + '│'));
        });
    }

    /* ══════════════════════════════════════════════════════════
       12. NAVEGACIÓN CROSS-MÓDULO
       ══════════════════════════════════════════════════════════ */

    function traceNav(tipo, id) {
        if (!id || id === '—' || id === '') return;
        try {
            if (tipo === 'GE') { if (typeof window.loadModule === 'function') window.loadModule('GE'); }
            else if (tipo === 'CI') { if (typeof window.loadModule === 'function') window.loadModule('CI'); }
            else if (tipo === 'GR') { window._grPendingSelect = id; if (typeof window.loadModule === 'function') window.loadModule('GR'); }
            else if (tipo === 'SU') { window._suPendingSelect = id; if (typeof window.loadModule === 'function') window.loadModule('SU'); }
            else if (tipo === 'FR') { window._frPendingSelect = id; if (typeof window.loadModule === 'function') window.loadModule('FR'); }
        } catch (e) { console.warn('[TRACE] traceNav:', e); }
    }
    window.traceNav = traceNav;

    /* ══════════════════════════════════════════════════════════
       13. ESTADO DE LA UI Y RENDER
       ══════════════════════════════════════════════════════════ */

    var _currentTab    = 'global';
    var _currentAnchor = null;

    function setTab(name) {
        _currentTab = name;
        document.querySelectorAll('.trace-subtab').forEach(function (btn) {
            btn.classList.toggle('active', btn.dataset.tracetab === name);
        });
        document.querySelectorAll('.trace-panel').forEach(function (p) {
            p.classList.toggle('active', p.id === 'trace-panel-' + name);
        });
        renderCurrentView();
    }
    window.traceSetTab = setTab;

    function renderCurrentView() {
        if (_currentTab === 'frtrace') renderFrTraceView();
        else renderGlobalView();
    }

    /* ── FICHA FR ───────────────────────────────────────────── */

    function _traceRenderFRFicha(bolsa) {
        if (!bolsa) return '';
        function row(lbl, val) {
            if (!val) return '';
            return '<div class="trace-ficha-row"><span class="trace-ficha-lbl">' + lbl + '</span>'
                + '<span class="trace-ficha-val">' + val + '</span></div>';
        }

        var ge = bolsa.geneticaFull
            || [bolsa.genetica, bolsa.fenotipo].filter(Boolean).join(' / ')
            || '—';

        var ciRow = bolsa.inoculoSource === 'CI' && bolsa.inoculoCiId
            ? row('🧫 CI', esc(bolsa.inoculoCiId) + ' · CI/Placa')
            : (bolsa.inoculoSource === 'GE' ? row('🧫 Inóculo', 'GE directo') : '');

        var grRows = '';
        if (Array.isArray(bolsa.grSources) && bolsa.grSources.length > 0) {
            grRows = bolsa.grSources.map(function(s) {
                return row('🌾 GR', esc(s.grLoteId) + ' · ' + esc(s.grTandaId)
                    + (s.grUsados ? ' · ' + s.grUsados + ' frascos' : '')
                    + (s.geneticaFull ? ' · ' + esc(s.geneticaFull) : ''));
            }).join('');
        } else if (bolsa.grLoteId) {
            grRows = row('🌾 GR', esc(bolsa.grLoteId) + (bolsa.grTandaId ? ' · ' + esc(bolsa.grTandaId) : ''));
        }

        var suVal = esc(bolsa.suLoteId || '—') + (bolsa.suSubTanda ? ' · ' + esc(bolsa.suSubTanda) : '');
        if (bolsa.pesoSustratoSeco) suVal += ' · ' + parseFloat(bolsa.pesoSustratoSeco).toFixed(1) + 'g seco';
        if (bolsa.pesoHumedoHidratado) suVal += ' · ' + parseFloat(bolsa.pesoHumedoHidratado).toFixed(0) + 'g hid';

        var diasFRFicha = bolsa.fechaInicio
            ? diasEntre(bolsa.fechaInicio, (bolsa.cicloCerrado && bolsa.fechaCierreCiclo)
                ? bolsa.fechaCierreCiclo : hoyISO())
            : null;
        var frVal = esc(bolsa.id || '—') + ' · inicio: ' + fmtFecha(bolsa.fechaInicio)
            + (diasFRFicha != null ? ' · día ' + diasFRFicha : '');

        var cosechas = '';
        if (Array.isArray(bolsa.flushes) && bolsa.flushes.length > 0) {
            var beAcumFicha = 0;
            var flLines = bolsa.flushes.map(function(f, i) {
                var ph = parseFloat(f.pesoHumedo) || 0;
                var bef = (ph > 0 && bolsa.pesoSustratoSeco > 0) ? (ph / bolsa.pesoSustratoSeco * 100) : 0;
                beAcumFicha += bef;
                return '<div class="trace-ficha-flush">Oleada ' + (i + 1) + ': '
                    + ph.toFixed(0) + 'g húmedo'
                    + (f.pesoSeco ? ' / ' + parseFloat(f.pesoSeco).toFixed(0) + 'g seco' : '')
                    + (bef > 0 ? ' · BE ' + bef.toFixed(1) + '%' : '')
                    + '</div>';
            }).join('');
            cosechas = '<div class="trace-ficha-section">COSECHAS</div>'
                + flLines
                + (beAcumFicha > 0
                    ? '<div class="trace-ficha-flush" style="font-weight:600">BE acumulada: ' + beAcumFicha.toFixed(1) + '%</div>'
                    : '');
        } else {
            cosechas = '<div class="trace-ficha-section">COSECHAS</div>'
                + '<div class="trace-ficha-flush" style="color:var(--tx3)">Sin cosechas registradas</div>';
        }

        var obsHtml = '';
        if (Array.isArray(bolsa.observaciones) && bolsa.observaciones.length > 0) {
            var recientes = bolsa.observaciones.slice(-3).reverse();
            obsHtml = '<div class="trace-ficha-section">OBSERVACIONES</div>'
                + recientes.map(function(o) {
                    return '<div class="trace-ficha-obs">' + fmtFecha(o.ts) + ': ' + esc(o.texto) + '</div>';
                }).join('');
        }

        return '<div class="trace-ficha-panel">'
            + '<div class="trace-ficha-title">══ FICHA ' + esc(bolsa.id || '—') + ' ══</div>'
            + row('🧬 GE', esc(ge))
            + ciRow
            + grRows
            + row('🪵 SU', suVal)
            + row('🍄 FR', frVal)
            + cosechas
            + obsHtml
            + '</div>';
    }

    /* ── GLOBAL VIEW ────────────────────────────────────────── */

    function renderGlobalView() {
        var el = document.getElementById('trace-global-content');
        if (!el) return;

        if (!_currentAnchor) { el.innerHTML = buildNoAnchorHTML('global'); return; }

        var resolved = resolveAnchor(_currentAnchor);
        var lines;

        if (resolved.geNodeId || resolved.ciId || resolved.grLoteId || resolved.suLoteId || resolved.frId) {
            lines = buildGlobalLinesArray(resolved);
        } else {
            lines = ['<span class="tl tl-empty">— No se pudo resolver la cadena para: ' +
                     esc(_currentAnchor.tipo) + ' ' + esc(_currentAnchor.id) + ' —</span>'];
        }

        var fichaHtml = '';
        if (_currentAnchor && _currentAnchor.tipo === 'FR') {
            var _fichaB = frBolsaById(_currentAnchor.id);
            if (_fichaB) fichaHtml = _traceRenderFRFicha(_fichaB);
        }

        el.innerHTML =
            buildAnchorBarHTML(_currentAnchor.tipo, _currentAnchor.id, 'traceClearAnchor()') +
            '<pre class="trace-ascii-tree">' + lines.join('\n') + '</pre>' +
            fichaHtml;
    }

    /* ── HELPER HTML FRAGMENTS ──────────────────────────────── */

    function buildAnchorBarHTML(tipo, id, clearFn) {
        return '<div class="trace-anchor-bar">' +
               '<span class="tab-lbl">trazando desde</span>' +
               '<span class="tab-val">' + esc(tipo) + ' · ' + esc(id) + '</span>' +
               '<button class="trace-btn-sm" onclick="' + clearFn + '">✕ limpiar</button>' +
               '</div>';
    }

    function buildNoAnchorHTML(view) {
        var sus = getSULotes().slice().reverse();
        var intro = '<b>Trace Global</b> — cadena completa GE → CI → GR → SU → FR. Seleccioná un punto de entrada, o abrí este módulo desde cualquier otro:';

        var html = '<div class="trace-no-anchor">' +
                   '<p class="trace-hint-text">' + intro + '</p>';

        if (sus.length === 0) {
            html += '<div class="trace-empty-state">No hay lotes SU registrados aún.</div>';
        } else {
            html += '<div class="trace-su-list">';
            var fn = 'traceSelectAnchorSU';
            sus.slice(0, 20).forEach(function (su) {
                var frCount = getFRBolsas().filter(function (b) { return b.suLoteId === su.id; }).length;
                html += '<div class="trace-su-item" onclick="' + fn + '(\'' + esc(su.id) + '\')">' +
                        '<span class="trace-su-id">🪵 ' + esc(su.id) + '</span>' +
                        (su.nombre && su.nombre !== su.id ? '<span class="trace-su-name">' + esc(su.nombre) + '</span>' : '') +
                        (su.tipo ? '<span class="trace-su-tipo">' + esc(su.tipo) + '</span>' : '') +
                        '<span class="trace-su-date">' + fmtFecha(su.fecha) + '</span>' +
                        (frCount > 0 ? '<span class="trace-su-fr">' + frCount + ' FR</span>' : '') +
                        '</div>';
            });
            if (sus.length > 20) html += '<div class="trace-hint">... y ' + (sus.length - 20) + ' más.</div>';
            html += '</div>';
        }
        html += '</div>';
        return html;
    }

    /* ── ACCIONES PÚBLICAS ──────────────────────────────────── */

    window.traceSelectAnchor = function (tipo, id) {
        _currentAnchor = { tipo: tipo, id: id };
        renderCurrentView();
    };
    window.traceSelectAnchorSU = function (suId) {
        _currentAnchor = { tipo: 'SU', id: suId };
        renderCurrentView();
    };
    window.traceClearAnchor = function () {
        _currentAnchor = null;
        renderCurrentView();
    };

    /* ══════════════════════════════════════════════════════════
       14. INTEGRACIÓN CON FR — árbol #frIdTree clickeable
       ══════════════════════════════════════════════════════════ */

    window.traceEnhanceFrIdTree = function () {
        try {
            var host = document.getElementById('frIdTree');
            if (!host) return;

            host.querySelectorAll('.fr-tree-line').forEach(function (line) {
                if (line.classList.contains('fr-tree-clickable')) return;

                var typeEl = line.querySelector('.fr-tree-type');
                var nameEl = line.querySelector('.fr-tree-name');
                var idEl   = line.querySelector('.fr-tree-id');
                if (!typeEl || !nameEl) return;

                var typeText = typeEl.textContent.trim();
                var nameText = nameEl.textContent.trim();
                var idText   = idEl ? idEl.textContent.replace(/[()]/g,'').trim() : '';

                var anchorTipo = null, anchorId = null;
                if (/^SU lote/i.test(typeText))    { anchorTipo = 'SU'; anchorId = nameText.split(' · ')[0].trim(); }
                else if (/^GR tanda/i.test(typeText)) { anchorTipo = 'GR'; anchorId = nameText.split('/')[0].trim(); }
                else if (/^Bolsa/i.test(typeText))    { anchorTipo = 'FR'; anchorId = nameText || idText; }
                else if (/^(Especie|Cepa|Fenotipo)/i.test(typeText)) { anchorTipo = 'GE'; anchorId = idText; }

                if (!anchorTipo || !anchorId || anchorId === '—') return;

                var cTipo = anchorTipo, cId = anchorId;
                line.classList.add('fr-tree-clickable');
                line.title = 'Ver en TRACE (' + cTipo + ' ' + cId + ')';
                line.addEventListener('click', function (e) {
                    e.stopPropagation();
                    window._tracePendingAnchor = { tipo: cTipo, id: cId };
                    if (typeof window.loadModule === 'function') window.loadModule('TRACE');
                });
            });
        } catch (e) { console.warn('[TRACE] traceEnhanceFrIdTree:', e); }
    };

    /* ══════════════════════════════════════════════════════════
       15. INIT / UNLOAD
       ══════════════════════════════════════════════════════════ */

    /* ══════════════════════════════════════════════════════════
       16. FR TRACE — TRAZEO DE BOLSAS FR ★
       Punto de entrada: bolsa FR → SU → GR/tanda → CI/GE inóculo.
       Vistas: árbol ASCII enriquecido + grafo SVG visual.
       ══════════════════════════════════════════════════════════ */

    var _frt = {
        selectedId:    null,
        viewMode:      'ascii',   // 'ascii' | 'graph'
        search:        '',
        statusFilter:  ''
    };

    /* ── Estado de bolsa ──────────────────────────────────── */
    function frtEstado(b) {
        if (!b) return 'sin datos';
        if (frEsPendiente(b)) return 'pendiente';
        if (b.cancelada)             return 'cancelada';
        if (b.contaminada)           return 'contaminada';
        if (b.cicloCerrado)          return 'ciclo cerrado';
        if (Array.isArray(b.flushes) && b.flushes.length > 0) return 'cosechado';
        if (b.fechaCosecha)          return 'cosechado';
        if (b.fechaPines)            return 'pinning';
        if (b.fechaColonizacion)     return 'colonizado';
        return 'colonizando';
    }
    function frtEstadoClass(estado) {
        var map = {
            'cosechado':    'ok',
            'colonizado':   'col',
            'pinning':      'pin',
            'colonizando':  'act',
            'contaminada':  'err',
            'cancelada':    'err',
            'ciclo cerrado':'arc',
            'pendiente':    'pend'
        };
        return 'frt-badge-' + (map[estado] || 'act');
    }

    /* ── Construcción del árbol de datos para una bolsa ──── */
    function frtBuildData(bolsaId) {
        var bolsas = getFRBolsas();
        var b = null;
        // Resolución de bolsa: primero por id visible; si no encuentra (bolsas pendientes
        // tienen id: null), intenta por _frUuid. El prefijo 'uuid:' distingue el modo.
        var isUuidKey = bolsaId && bolsaId.indexOf('uuid:') === 0;
        var rawKey    = isUuidKey ? bolsaId.slice(5) : bolsaId;
        for (var i = 0; i < bolsas.length; i++) {
            if (isUuidKey) {
                if (bolsas[i]._frUuid === rawKey) { b = bolsas[i]; break; }
            } else {
                if (bolsas[i].id === bolsaId || bolsas[i]._frUuid === bolsaId) { b = bolsas[i]; break; }
            }
        }
        if (!b) return null;

        // SU Lote
        var suLotes = getSULotes();
        var su = null;
        for (var j = 0; j < suLotes.length; j++) {
            if (suLotes[j].id === b.suLoteId) { su = suLotes[j]; break; }
        }
        // suPesoBolsa = peso SECO de sustrato por bolsa (teórico, de SU).
        // NUNCA se usa pesoHumedoHidratado aquí — ese es el peso post-hidratación (real húmedo).
        // Son dos mediciones distintas en momentos distintos del proceso.
        var suPesoBolsa = null;
        // Prioridad (seco):
        // 1. b.pesoSustratoSeco — sincronizado por FR desde su.fibra / su.bolsas
        // 2. su.fibra / su.bolsas — peso seco directo desde SU
        // 3. su.pesoBolsa — campo legacy del modo inverso de SU
        if (b.pesoSustratoSeco && parseFloat(b.pesoSustratoSeco) > 0) {
            suPesoBolsa = parseFloat(b.pesoSustratoSeco);
        } else if (su) {
            var _fibraSu = parseFloat(su.fibra);
            var _bolsasSu = Math.max(parseInt(su.bolsas) || 1, 1);
            if (_fibraSu > 0) {
                suPesoBolsa = _fibraSu / _bolsasSu;
            } else {
                var pBolsa = parseFloat(su.pesoBolsa);
                if (pBolsa > 0) suPesoBolsa = pBolsa;
            }
        }

        // suPesoHidratadoBolsa = peso húmedo REAL por bolsa (post-hidratación, manual).
        // Fuente: b.pesoHumedoHidratado sincronizado por FR desde pesoReal de la tanda SU.
        var suPesoHidratadoBolsa = (b.pesoHumedoHidratado && parseFloat(b.pesoHumedoHidratado) > 0)
            ? parseFloat(b.pesoHumedoHidratado)
            : null;

        // GR Lote + Tanda
        var grLotes = getGRLotes();
        var gr = null;
        for (var k = 0; k < grLotes.length; k++) {
            if (grLotes[k].id === b.grLoteId) { gr = grLotes[k]; break; }
        }
        var gt = null;
        if (gr && Array.isArray(gr.dg)) {
            for (var m = 0; m < gr.dg.length; m++) {
                if (gr.dg[m].tanda === b.grTandaId) { gt = gr.dg[m]; break; }
            }
            if (!gt && gr.dg.length > 0) gt = gr.dg[0];
        }

        // GR masa total del lote (desde producción)
        var grMasaTotal = null;
        if (gr) {
            try {
                var prod = gr.uf || gr.produccion || {};
                var units = parseFloat(prod.cantidad_unidades) || 0;
                var pesoU = parseFloat(prod.peso_unidad)       || 0;
                if (units > 0 && pesoU > 0) grMasaTotal = units * pesoU;
            } catch (e) {}
        }

        // Inóculo (CI o GE)
        var inoc = null;
        if (gt) {
            if (gt.inoculoSource === 'CI' && gt.cultivoCiId) {
                var ci = ciById(gt.cultivoCiId);
                inoc = {
                    source:   'CI',
                    nombre:   ci ? (ci.codigo || gt.cultivoCiId) : gt.cultivoCiId,
                    genetica: gt.genetica
                              || (ci && ci.geneticaSnapshot && ci.geneticaSnapshot.label)
                              || null,
                    data: ci
                };
            } else if (gt.inoculoSource === 'GE' && gt.fen_id) {
                var geNodes = getGEData().nodes;
                var geNode = null;
                for (var n2 = 0; n2 < geNodes.length; n2++) {
                    if (geNodes[n2].id === gt.fen_id) { geNode = geNodes[n2]; break; }
                }
                inoc = {
                    source:   'GE',
                    nombre:   geNode ? (geNode.nombre || geNode.label || gt.fen_id) : gt.fen_id,
                    genetica: gt.genetica || null,
                    data:     geNode
                };
            }
        }

        // Flushes + totales BE
        var flushes = Array.isArray(b.flushes) ? b.flushes : [];
        var totalHumedo = 0;
        for (var fi = 0; fi < flushes.length; fi++) {
            totalHumedo += parseFloat(flushes[fi].pesoHumedo) || 0;
        }
        var beAcum = flushes.length > 0
            ? (flushes[flushes.length - 1].beAcumulado || null)
            : null;

        return {
            bolsa:                b,
            su:                   su,
            suPesoBolsa:          suPesoBolsa,          // peso SECO (fibra/bolsas) — para BE y métricas seco
            suPesoHidratadoBolsa: suPesoHidratadoBolsa, // peso HÚMEDO real (pesoReal tanda) — post-hidratación
            gr:                   gr,
            gt:                   gt,
            grMasaTotal:          grMasaTotal,
            inoc:                 inoc,
            flushes:              flushes,
            totalHumedo:          totalHumedo,
            beAcum:               beAcum
        };
    }

    /* ── Días entre dos ISO ───────────────────────────────── */
    function frtDias(isoA, isoB) {
        if (!isoA || !isoB) return null;
        try {
            var a = new Date(isoA), b = new Date(isoB);
            if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
            var d = Math.round((b - a) / 86400000);
            return d >= 0 ? d : null;
        } catch (e) { return null; }
    }

    /* ── Render principal del panel FR Trace ─────────────── */
    function renderFrTraceView() {
        var el = document.getElementById('trace-frtrace-content');
        if (!el) return;

        var bolsas = getFRBolsas();

        // Filtrado
        var q  = (_frt.search || '').toLowerCase();
        var sf = _frt.statusFilter;
        var filtered = [];
        for (var i = 0; i < bolsas.length; i++) {
            var b  = bolsas[i];
            var bo = b.id || '';
            var matchQ = !q
                || bo.toLowerCase().indexOf(q) >= 0
                || (b.genetica  || '').toLowerCase().indexOf(q) >= 0
                || (b.suLoteId  || '').toLowerCase().indexOf(q) >= 0
                || (b.grLoteId  || '').toLowerCase().indexOf(q) >= 0;
            var estado   = frtEstado(b);
            var matchSt  = !sf || estado === sf;
            if (matchQ && matchSt) filtered.push(b);
        }
        // Orden: más recientes primero
        filtered.sort(function (a, b2) {
            var da = a.fechaInicio || a.fechaColonizacion || '';
            var db = b2.fechaInicio || b2.fechaColonizacion || '';
            return db < da ? -1 : db > da ? 1 : 0;
        });

        // ── Lista lateral ──
        var listaHTML;
        if (filtered.length === 0) {
            listaHTML = '<div class="frt-empty">Sin bolsas que coincidan.</div>';
        } else {
            listaHTML = filtered.map(function (b) {
                var estado  = frtEstado(b);
                var ecls    = frtEstadoClass(estado);
                var _frtSelKey2 = b.id ? b.id : ('uuid:' + (b._frUuid || ''));
                var active  = _frtSelKey2 === _frt.selectedId ? ' frt-item-act' : '';
                var fs      = Array.isArray(b.flushes) ? b.flushes : [];
                var totG    = fs.reduce(function (s, x) { return s + (parseFloat(x.pesoHumedo) || 0); }, 0);
                var beStr   = fs.length > 0 && fs[fs.length - 1].beAcumulado != null
                              ? ' · BE ' + fs[fs.length - 1].beAcumulado.toFixed(1) + '%' : '';
                var metaGR  = b.grLoteId ? ' · GR: ' + esc(b.grLoteId) + (b.grTandaId ? '/' + esc(b.grTandaId) : '') : '';
                // Clave de selección: id visible si existe; 'uuid:<_frUuid>' para pendientes (id: null)
                var _frtSelKey = b.id ? b.id : ('uuid:' + (b._frUuid || ''));
                var _frtDispId = b.id || ('⏳ ' + (b.suSubTanda || b.suLoteId || '—'));
                return '<div class="frt-item' + active + '" onclick="window.frtSelect(\'' + esc(_frtSelKey) + '\')">'
                    + '<div class="frt-item-top">'
                    + '<span class="frt-item-id">' + esc(_frtDispId) + '</span>'
                    + ' <span class="frt-badge ' + ecls + '">' + esc(estado) + '</span>'
                    + '</div>'
                    + (b.genetica ? '<div class="frt-item-gen">' + esc(b.genetica) + '</div>' : '')
                    + '<div class="frt-item-meta">'
                    + (b.suLoteId ? 'SU: ' + esc(b.suLoteId) : '') + metaGR
                    + (fs.length > 0 ? ' · 🍄 ' + fs.length + ' oleadas · ' + totG.toFixed(0) + 'g' + beStr : '')
                    + '</div>'
                    + '</div>';
            }).join('');
        }

        var statusOptions = ['colonizando','colonizado','pinning','cosechado',
                             'contaminada','cancelada','ciclo cerrado','pendiente'];

        el.innerHTML = '<div class="frt-layout">'

            // ── Sidebar ──
            + '<div class="frt-sidebar">'
            + '<div class="frt-toolbar">'
            + '<input class="frt-search" type="text" placeholder="🔍  ID, genética, SU, GR..."'
            + ' value="' + esc(_frt.search) + '" oninput="window.frtSearchChange(this.value)">'
            + '<select class="frt-select" onchange="window.frtFilterStatus(this.value)">'
            + '<option value="">— Todos los estados —</option>'
            + statusOptions.map(function (s) {
                return '<option value="' + s + '"'
                    + (_frt.statusFilter === s ? ' selected' : '') + '>'
                    + s + '</option>';
              }).join('')
            + '</select>'
            + '</div>'
            + '<div class="frt-lista">' + listaHTML + '</div>'
            + '</div>'

            // ── Detail ──
            + '<div class="frt-detail">' + frtRenderDetail() + '</div>'
            + '</div>';
    }

    /* ── Panel de detalle (toggle + contenido) ───────────── */
    function frtRenderDetail() {
        if (!_frt.selectedId) {
            return '<div class="frt-placeholder">← Seleccioná una bolsa FR<br>para ver su trazabilidad completa</div>';
        }
        var data = frtBuildData(_frt.selectedId);
        if (!data) {
            return '<div class="frt-placeholder frt-placeholder-err">Bolsa no encontrada en el sistema.</div>';
        }

        var toggle = '<div class="frt-view-toggle">'
            + '<button class="frt-vbtn' + (_frt.viewMode === 'ascii' ? ' active' : '') + '"'
            + ' onclick="window.frtSetView(\'ascii\')">🌲 Árbol ASCII</button>'
            + '<button class="frt-vbtn' + (_frt.viewMode === 'graph' ? ' active' : '') + '"'
            + ' onclick="window.frtSetView(\'graph\')">🕸 Grafo Visual</button>'
            + '</div>';

        var content = _frt.viewMode === 'graph'
            ? frtRenderGraph(data)
            : frtRenderASCII(data);

        return toggle + content;
    }

    /* ═══════════════════════════════════════════════════════
       17. ÁRBOL ASCII ENRIQUECIDO
       ═══════════════════════════════════════════════════════ */
    function frtRenderASCII(d) {
        var b    = d.bolsa;
        var su   = d.su;
        var gr   = d.gr;
        var gt   = d.gt;
        var inoc = d.inoc;

        var estado = frtEstado(b);
        var ecls   = frtEstadoClass(estado);

        // Helpers de línea
        function R(pfx, lbl, val, note) {
            var v  = (val == null || val === '') ? '<span class="frt-nd">—</span>' : esc(String(val));
            var nt = note ? ' <em class="frt-note">' + esc(String(note)) + '</em>' : '';
            return '<div class="frt-row">'
                + '<span class="frt-pfx">' + escPfx(pfx) + '</span>'
                + '<span class="frt-lbl">' + esc(lbl) + '</span>'
                + '<span class="frt-val">' + v + nt + '</span>'
                + '</div>';
        }
        function S(pfx, innerHtml) {
            return '<div class="frt-sec">'
                + '<span class="frt-pfx">' + escPfx(pfx) + '</span>'
                + '<span class="frt-stitle">' + innerHtml + '</span>'
                + '</div>';
        }
        function BL() {
            return '<div class="frt-blank"><span class="frt-pfx">│</span></div>';
        }

        var H = [];

        /* ── Cabecera ── */
        H.push('<div class="frt-ascii-header">'
            + '<span class="frt-hid">📦 ' + esc(b.id) + '</span>'
            + ' <span class="frt-badge ' + ecls + '">' + esc(estado.toUpperCase()) + '</span>'
            + '</div>');
        H.push(BL());

        /* ── Genética ── */
        var gen   = b.genetica    || (gt && gt.genetica) || null;
        var fenId = b.fen_id      || (gt && gt.fen_id)   || null;
        H.push(R('├── 🧬  ', 'Genética:', gen,
                  (fenId && fenId !== gen) ? fenId : null));
        H.push(BL());

        /* ── SUSTRATO ── */
        var suId = su ? su.id : (b.suLoteId || null);
        H.push(S('├── 🧱  ',
            'SUSTRATO <span class="frt-dim">────────────────</span> '
            + esc(suId || '—')));

        if (su) {
            if (su.nombre) H.push(R('│   ├── ', 'Nombre:', su.nombre));
            H.push(R('│   ├── ', 'Fecha lote:', fmtFecha(su.fecha)));
            H.push(R('│   ├── ', 'Sustrato seco/bolsa:',
                      d.suPesoBolsa != null
                          ? d.suPesoBolsa.toFixed(1) + ' g'
                          : null));
            if (d.suPesoHidratadoBolsa != null)
                H.push(R('│   ├── ', 'Peso hidratado/bolsa:', d.suPesoHidratadoBolsa.toFixed(1) + ' g ✎real'));
            if (su.hyd)    H.push(R('│   ├── ', 'Hidratación:', su.hyd + '%'));
            if (su.bolsas) H.push(R('│   ├── ', 'Bolsas totales:', su.bolsas));
            if (b.suBolsaIndex != null)
                H.push(R('│   ├── ', 'Bolsa N°:', b.suBolsaIndex + 1));

            /* ── GRANO (dentro de SU) ── */
            var grId    = gr ? gr.id : (b.grLoteId || null);
            var grLabel = esc(grId || '—')
                        + (b.grTandaId ? ' <span class="frt-dim">/</span> Tanda: ' + esc(b.grTandaId) : '');
            H.push(S('│   └── 🌾  ',
                'GRANO <span class="frt-dim">───────────────</span> ' + grLabel));

            if (gr && gr.nombre)
                H.push(R('│       ├── ', 'Nombre lote:', gr.nombre));
            if (gt && gt.frascos != null)
                H.push(R('│       ├── ', 'Frascos tanda:', gt.frascos + ' frascos'));
            if (d.grMasaTotal)
                H.push(R('│       ├── ', 'Masa total lote:', d.grMasaTotal.toFixed(0) + ' g'));

            // Tipo de grano (componentes, sin "agua")
            if (gr && Array.isArray(gr.componentes) && gr.componentes.length > 0) {
                var tipos = gr.componentes
                    .filter(function (c) {
                        return c.nombre && (c.nombre || '').toLowerCase().indexOf('agua') < 0;
                    })
                    .map(function (c) { return c.nombre; })
                    .join(', ');
                if (tipos) H.push(R('│       ├── ', 'Tipo grano:', tipos));
            }

            if (gt) {
                if (gt.fechaInoculacion)
                    H.push(R('│       ├── ', 'Fecha inoculación GR:',
                              fmtFecha(gt.fechaInoculacion)));
                if (gt.colonizacion) {
                    var dcol = frtDias(gt.fechaInoculacion, gt.colonizacion);
                    H.push(R('│       ├── ', 'Colonización GR:',
                              fmtFecha(gt.colonizacion),
                              dcol != null ? dcol + ' días en col.' : null));
                }
                if (gt.contaminados)
                    H.push(R('│       ├── ', 'Contaminados GR:', gt.contaminados + ' frascos'));
            }

            /* ── INÓCULO (dentro de GR) ── */
            if (inoc) {
                var inocTag = inoc.source === 'CI' ? '🧫 CI: ' : '🧬 GE: ';
                H.push(S('│       └── 🧫  ',
                    'INÓCULO <span class="frt-dim">──────────────</span> '
                    + esc(inocTag + inoc.nombre)));
                /* sub-filas dinámicas según fuente */
                var _tRows = [];
                if (inoc.genetica)
                    _tRows.push(['Genética:', inoc.genetica]);
                else
                    _tRows.push(['⚠️ Genética:', 'sin registrar']);
                _tRows.push(['Fuente:', inoc.source === 'CI' ? 'Cultivo In-vitro' : 'Banco Genético']);
                if (inoc.source === 'GE')
                    _tRows.push(['⚠️ CI:', 'sin registrar']);
                if (gt && gt.placasUsadas != null)
                    _tRows.push(['Placas usadas:', String(gt.placasUsadas)]);
                _tRows.forEach(function(row, ri) {
                    var isLast = ri === _tRows.length - 1;
                    H.push(R('│           ' + (isLast ? '└── ' : '├── '), row[0], row[1]));
                });
            } else {
                H.push(R('│       └── 🧫  ', 'Inóculo:', null));
            }
        } else {
            H.push(R('│   └── ', 'Lote SU:', b.suLoteId,
                      b.suLoteId ? '(no encontrado en sistema)' : null));
        }

        H.push(BL());

        /* ── TIMELINE ── */
        var hoyTL   = hoyISO();
        var dHoy    = frtDias(b.fechaInicio, hoyTL);
        var dHoyStr = dHoy != null ? 'día ' + dHoy + ' (hoy)' : null;
        H.push(S('├── 📅  ',
            'TIMELINE <span class="frt-dim">─────────────────────────────────────</span>'));
        H.push(R('│   ├── 🗓  ', 'Inicio FR:', fmtFecha(b.fechaInicio),
                  dHoyStr));

        var dc = frtDias(b.fechaInicio, b.fechaColonizacion);
        H.push(R('│   ├── ✅  ', 'Colonización:',
                  fmtFecha(b.fechaColonizacion),
                  dc != null ? 'día ' + dc : null));

        var dp = frtDias(b.fechaInicio, b.fechaPines);
        H.push(R('│   ├── 🍄  ', 'Pines:',
                  fmtFecha(b.fechaPines),
                  dp != null ? 'día ' + dp : null));

        var dco = frtDias(b.fechaInicio, b.fechaCosecha);
        H.push(R('│   └── 🏁  ', 'Último evento:', fmtFecha(b.fechaCosecha),
                  dco != null ? 'día ' + dco : null));
        H.push(BL());

        /* ── COSECHAS ── */
        var suPesoStr = d.suPesoBolsa != null
            ? d.suPesoBolsa.toFixed(1) + ' g seco'
            : 'peso SU no registrado';
        H.push(S('└── ⚖️   ',
            'COSECHAS <span class="frt-dim">──────── Sustrato seco: '
            + esc(suPesoStr) + '</span>'));

        if (d.flushes.length === 0) {
            H.push(R('    └── ', 'Oleadas:', 'Sin cosechas registradas'));
        } else {
            d.flushes.forEach(function (f, i) {
                var isLast  = (i === d.flushes.length - 1);
                var pfx     = isLast ? '    └── ' : '    ├── ';
                var n       = f.n || (i + 1);
                var pesoStr = f.pesoHumedo != null ? f.pesoHumedo + ' g húmedo' : '—';
                if (f.pesoSeco != null) pesoStr += '  /  ' + f.pesoSeco + ' g seco';
                var beStr   = f.beOleada != null
                              ? 'BE oleada: ' + parseFloat(f.beOleada).toFixed(1) + '%'
                              : '';
                if (isLast && f.beAcumulado != null) {
                    beStr += (beStr ? '  ·  ' : '') + 'acum: '
                           + parseFloat(f.beAcumulado).toFixed(1) + '%';
                }
                H.push(R(pfx, 'Oleada ' + n + ':', pesoStr, beStr || null));
            });

            if (d.flushes.length > 0) {
                H.push(R('    ══  ', 'TOTAL:',
                          d.totalHumedo.toFixed(0) + ' g',
                          d.beAcum != null ? 'BE acumulada: ' + d.beAcum.toFixed(1) + '%' : null));
            }
        }

        return '<div class="frt-ascii-tree">' + H.join('') + '</div>';
    }

    /* ═══════════════════════════════════════════════════════
       18. GRAFO SVG VISUAL
       ═══════════════════════════════════════════════════════ */
    function frtRenderGraph(d) {
        var b    = d.bolsa;
        var su   = d.su;
        var gr   = d.gr;
        var gt   = d.gt;
        var inoc = d.inoc;

        var estado = frtEstado(b);

        /* ── Coordenadas y dimensiones ── */
        var VW = 820, VH = 570;
        var NW = 220, NH = 78;

        // Centros X de cada columna
        var xL = 40;             // columna izquierda
        var xC = VW / 2 - NW/2; // columna central
        var xR = VW - 40 - NW;  // columna derecha

        // Posiciones de cada nodo [x, y]
        var pos = {
            fr:   [xC,         10],
            su:   [xL,        150],
            tl:   [xR,        150],
            gr:   [xC,        290],
            be:   [xR,        290],
            inoc: [xC,        430]
        };

        /* ── Helpers SVG ── */
        function cx(id) { return pos[id][0] + NW / 2; }
        function cy(id) { return pos[id][1] + NH / 2; }
        function top(id) { return pos[id][1]; }
        function bot(id) { return pos[id][1] + NH; }

        function edge(fromId, toId) {
            var x1 = cx(fromId), y1 = bot(fromId);
            var x2 = cx(toId),   y2 = top(toId);
            var my = (y1 + y2) / 2;
            return '<path d="M ' + x1 + ' ' + y1
                 + ' C ' + x1 + ' ' + my
                 + '   ' + x2 + ' ' + my
                 + '   ' + x2 + ' ' + y2 + '"'
                 + ' stroke="#505050" stroke-width="1.5" fill="none"'
                 + ' stroke-dasharray="5 3"/>';
        }

        function node(id, fillColor, title, line1, line2) {
            var rx = pos[id][0], ry = pos[id][1];
            var tcx = rx + NW / 2;
            return '<rect x="' + rx + '" y="' + ry + '"'
                 + ' width="' + NW + '" height="' + NH + '"'
                 + ' rx="9" ry="9" fill="' + fillColor + '" opacity="0.92"/>'
                 + '<text x="' + tcx + '" y="' + (ry + 22) + '"'
                 + ' text-anchor="middle" font-size="13" font-weight="700"'
                 + ' fill="#F5F5F5">' + title + '</text>'
                 + (line1
                    ? '<text x="' + tcx + '" y="' + (ry + 42) + '"'
                    + ' text-anchor="middle" font-size="11" fill="#D0D0D0">'
                    + line1 + '</text>'
                    : '')
                 + (line2
                    ? '<text x="' + tcx + '" y="' + (ry + 58) + '"'
                    + ' text-anchor="middle" font-size="10" fill="#A0A0A0">'
                    + line2 + '</text>'
                    : '');
        }

        /* ── Contenido de cada nodo ── */
        var frSub1 = frtEstado(b).toUpperCase();
        var frSub2 = b.genetica ? b.genetica.substring(0, 28) : '';

        var suSub1 = su ? su.id : (b.suLoteId || '—');
        var suSub2 = d.suPesoHidratadoBolsa != null
            ? d.suPesoHidratadoBolsa.toFixed(1) + ' g hid/bolsa'
            : (d.suPesoBolsa != null
                ? d.suPesoBolsa.toFixed(1) + ' g seco/bolsa'
                : (su ? fmtFecha(su.fecha) : ''));

        var tlSub1 = 'Inicio: '      + fmtFecha(b.fechaInicio);
        var tlSub2 = 'Col: '         + fmtFecha(b.fechaColonizacion)
                   + '  Pines: '     + fmtFecha(b.fechaPines);

        var grSub1 = gr ? gr.id : (b.grLoteId || '—');
        var grSub2 = b.grTandaId ? 'Tanda: ' + b.grTandaId : '';
        if (gt && gt.frascos) grSub2 += (grSub2 ? '  ·  ' : '') + gt.frascos + ' frascos';

        var beSub1 = d.flushes.length + ' oleadas · ' + d.totalHumedo.toFixed(0) + ' g';
        var beSub2 = d.beAcum != null ? 'BE acumulada: ' + d.beAcum.toFixed(1) + '%' : 'Sin cosechas';

        var inocSub1 = inoc
            ? (inoc.source === 'CI' ? 'CI: ' : 'GE: ') + inoc.nombre
                + (inoc.source === 'GE' ? ' · ⚠️ CI' : '')
            : '—';
        var inocSub2 = inoc
            ? (inoc.genetica ? inoc.genetica.substring(0, 26) : '⚠️ Genética sin registrar')
            : (gt ? (gt.fechaInoculacion ? 'Inoc: ' + fmtFecha(gt.fechaInoculacion) : '') : '');

        /* ── SVG ── */
        var svg = '<svg viewBox="0 0 ' + VW + ' ' + VH + '"'
            + ' xmlns="http://www.w3.org/2000/svg"'
            + ' style="width:100%;max-height:' + VH + 'px;font-family:\'JetBrains Mono\',monospace;display:block">'

            // Aristas
            + edge('fr', 'su')
            + edge('fr', 'tl')
            + edge('su', 'gr')
            + edge('tl', 'be')
            + edge('gr', 'inoc')

            // Nodos
            + node('fr',   '#1a4080', '📦 ' + esc(b.id), frSub1, frSub2)
            + node('su',   '#7a3200', '🧱 SUSTRATO',       suSub1, suSub2)
            + node('tl',   '#3d1a7a', '📅 TIMELINE',       tlSub1, tlSub2)
            + node('gr',   '#5a4400', '🌾 GRANO',           grSub1, grSub2)
            + node('be',   '#1a5a3a', '⚖️ COSECHAS',        beSub1, beSub2)
            + node('inoc', '#1a5a1a', '🧫 INÓCULO',         inocSub1, inocSub2)

            + '</svg>';

        /* ── Tabla de cosechas debajo del grafo ── */
        var flushRows = d.flushes.map(function (f, i) {
            var n       = f.n || (i + 1);
            var ph      = f.pesoHumedo  != null ? f.pesoHumedo  + ' g'       : '—';
            var ps      = f.pesoSeco    != null ? f.pesoSeco    + ' g'       : '—';
            var beO     = f.beOleada    != null ? parseFloat(f.beOleada).toFixed(1) + '%' : '—';
            var beA     = f.beAcumulado != null ? parseFloat(f.beAcumulado).toFixed(1) + '%' : '—';
            return '<tr><td>F' + n + '</td><td>' + ph + '</td><td>' + ps
                 + '</td><td>' + beO + '</td><td>' + beA + '</td></tr>';
        }).join('');

        var totalRow = d.flushes.length > 0
            ? '<tfoot><tr><td><b>TOTAL</b></td><td><b>' + d.totalHumedo.toFixed(0)
              + ' g</b></td><td>—</td><td>—</td><td><b>'
              + (d.beAcum != null ? d.beAcum.toFixed(1) + '%' : '—')
              + '</b></td></tr></tfoot>'
            : '';

        var tabla = '<div class="frt-graph-table">'
            + '<table class="frt-table">'
            + '<thead><tr><th>Oleada</th><th>Peso húmedo</th><th>Peso seco</th>'
            + '<th>BE oleada</th><th>BE acumulada</th></tr></thead>'
            + '<tbody>'
            + (flushRows || '<tr><td colspan="5" style="color:var(--tx3)">Sin cosechas registradas</td></tr>')
            + '</tbody>' + totalRow + '</table>'
            + '</div>';

        return '<div class="frt-graph-wrap">' + svg + tabla + '</div>';
    }

    /* ═══════════════════════════════════════════════════════
       19. FUNCIONES GLOBALES (onclick handlers)
       ═══════════════════════════════════════════════════════ */


    /* ── Actualiza solo la lista y el detalle (sin tocar el input ni el select) ── */
    function _frtRefreshList() {
        var el = document.getElementById('trace-frtrace-content');
        if (!el) return;

        var lista = el.querySelector('.frt-lista');
        var det   = el.querySelector('.frt-detail');
        if (!lista || !det) {
            // Layout aún no existe — render completo inicial
            renderFrTraceView();
            return;
        }

        var bolsas = getFRBolsas();
        var q  = (_frt.search || '').toLowerCase();
        var sf = _frt.statusFilter;
        var filtered = [];
        for (var i = 0; i < bolsas.length; i++) {
            var b  = bolsas[i];
            var bo = b.id || '';
            var matchQ = !q
                || bo.toLowerCase().indexOf(q) >= 0
                || (b.genetica  || '').toLowerCase().indexOf(q) >= 0
                || (b.suLoteId  || '').toLowerCase().indexOf(q) >= 0
                || (b.grLoteId  || '').toLowerCase().indexOf(q) >= 0;
            var estado  = frtEstado(b);
            var matchSt = !sf || estado === sf;
            if (matchQ && matchSt) filtered.push(b);
        }
        filtered.sort(function (a, b2) {
            var da = a.fechaInicio || a.fechaColonizacion || '';
            var db = b2.fechaInicio || b2.fechaColonizacion || '';
            return db < da ? -1 : db > da ? 1 : 0;
        });

        var listaHTML;
        if (filtered.length === 0) {
            listaHTML = '<div class="frt-empty">Sin bolsas que coincidan.</div>';
        } else {
            listaHTML = filtered.map(function (b) {
                var estado  = frtEstado(b);
                var ecls    = frtEstadoClass(estado);
                var _frtSelKey2 = b.id ? b.id : ('uuid:' + (b._frUuid || ''));
                var active  = _frtSelKey2 === _frt.selectedId ? ' frt-item-act' : '';
                var fs      = Array.isArray(b.flushes) ? b.flushes : [];
                var totG    = fs.reduce(function (s, x) { return s + (parseFloat(x.pesoHumedo) || 0); }, 0);
                var beStr   = fs.length > 0 && fs[fs.length - 1].beAcumulado != null
                              ? ' · BE ' + fs[fs.length - 1].beAcumulado.toFixed(1) + '%' : '';
                var metaGR  = b.grLoteId ? ' · GR: ' + esc(b.grLoteId) + (b.grTandaId ? '/' + esc(b.grTandaId) : '') : '';
                // Clave de selección: id visible si existe; 'uuid:<_frUuid>' para pendientes (id: null)
                var _frtSelKey = b.id ? b.id : ('uuid:' + (b._frUuid || ''));
                var _frtDispId = b.id || ('⏳ ' + (b.suSubTanda || b.suLoteId || '—'));
                return '<div class="frt-item' + active + '" onclick="window.frtSelect(\'' + esc(_frtSelKey) + '\')">'
                    + '<div class="frt-item-top">'
                    + '<span class="frt-item-id">' + esc(_frtDispId) + '</span>'
                    + ' <span class="frt-badge ' + ecls + '">' + esc(estado) + '</span>'
                    + '</div>'
                    + (b.genetica ? '<div class="frt-item-gen">' + esc(b.genetica) + '</div>' : '')
                    + '<div class="frt-item-meta">'
                    + (b.suLoteId ? 'SU: ' + esc(b.suLoteId) : '') + metaGR
                    + (fs.length > 0 ? ' · 🍄 ' + fs.length + ' oleadas · ' + totG.toFixed(0) + 'g' + beStr : '')
                    + '</div>'
                    + '</div>';
            }).join('');
        }

        lista.innerHTML = listaHTML;
        det.innerHTML   = frtRenderDetail();
    }

    window.frtSelect = function (id) {
        _frt.selectedId = id;
        _frtRefreshList();
    };

    window.frtSetView = function (mode) {
        _frt.viewMode = mode;
        var el  = document.getElementById('trace-frtrace-content');
        if (!el) return;
        var det = el.querySelector('.frt-detail');
        if (det) det.innerHTML = frtRenderDetail();
    };

    window.frtSearchChange = function (val) {
        _frt.search = val;
        _frtRefreshList();
    };

    window.frtFilterStatus = function (val) {
        _frt.statusFilter = val;
        _frtRefreshList();
    };

    /* ── fin bloque FR Trace ── */

    window.traceInit = function () {
        // Validación de schemas — solo avisa en consola, no bloquea render
        warnSchema('GR lotes',  getGRLotes(),  validarGRLote);
        warnSchema('SU lotes',  getSULotes(),  validarSULote);
        warnSchema('FR bolsas', getFRBolsas(), validarFRBolsa);
        warnSchema('CI',        getCIs(),      validarCI);

        var pending = window._tracePendingAnchor || null;
        window._tracePendingAnchor = null;

        if (pending) {
            _currentAnchor = pending;
            _currentTab = (pending.tipo === 'FR' || pending.tipo === 'SU') ? 'frtrace' : 'global';
        } else {
            _currentTab = 'global';
        }

        setTab(_currentTab)
        console.log('[TRACE] ✓ Módulo TRACE iniciado.' +
            (pending ? ' Anchor: ' + pending.tipo + ' ' + pending.id : ''));
    };

    window.onModuleUnload = function () {
        console.log('[TRACE] desmontado.');
    };

    // Auto-inicialización si el módulo se carga solo (fuera del loader main.js)
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { window.traceInit(); });
    } else {
        window.traceInit();
    }

})();
