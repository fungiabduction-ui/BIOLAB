/**
 * MÓDULO FR — FRUCTIFICACIÓN (Dashboard + Activos + Histórico)
 *
 * Arquitectura:
 *   - 1 registro FR = 1 bolsa individual de SU
 *   - Condición de existencia: la bolsa SU DEBE estar inoculada con un lote GR
 *     (sin grLoteId+grTandaId -> NO se crea FR)
 *   - Trazabilidad obligatoria: ID FR, GE (genética), SU (ID+tanda), GR (ID+tanda)
 *   - Herencia automática desde SU->GR: genética, fenotipo, fen_id, protocolo, tanda
 *   - El peso de sustrato seco viene SIEMPRE de SU (no editable en FR):
 *       sustrato_seco_por_bolsa = lote_SU.total / lote_SU.bolsas
 *   - Dashboard central + tablas Activos/Histórico
 *   - Modo visual vs edición
 *   - Cálculos automáticos: días desde inicio, estado, BE oleada/acumulado
 *
 * Storage: localStorage["fr_bolsas"] = [ {...bolsa}, ... ]
 * Namespace: window.FR con init, subTab, createFromSU, select, ...
 */
(function() {
    'use strict';

    var FR_KEY = 'fr_bolsas';
    var FR_EX_KEY = 'fr_experimentos';
    var experimentos = [];
    var _frExSortCol = 'ts';   // columna de sort activa
    var _frExSortDir = 'desc'; // 'asc' | 'desc'
    var SU_KEY = 'su_lotes';
    var GR_KEY = 'gr_lotes';

    window.FR = window.FR || {};
    var FR = window.FR;

    // Resetear el guard de inicialización en cada mount fresco.
    // window.FR persiste entre navegaciones (está en window) pero la
    // IIFE re-ejecuta y crea un nuevo closure con bolsas=[].
    // Sin este reset, FR.init() devuelve inmediatamente por el guard
    // _initialized=true y bolsas queda vacío → render en blanco.
    FR._initialized = false;

    // ----- estado interno -----
    var bolsas = [];
    var selectedId = null;
    var frOnSuLoteGuardado = null;
    var frOnStorage = null;
    var _frFiltroSU = '';   // ID de lote SU activo en el filtro ('': todos)
    var _frSearch   = '';   // Termino de busqueda libre (compartido entre tabs)
    var _frSort = {         // Estado de ordenamiento { key, dir } por tab
        activos: { key: 'entrada',     dir: 'desc' },
        cosecha: { key: 'ult_cosecha', dir: 'desc' },
        archivo: { key: 'arch_fecha',  dir: 'desc' }
    };

    // Helpers semánticos para el campo pendienteConfirmacion.
    // pendienteConfirmacion:true = bolsa aún no sellada (sync puede modificarla)
    // pendienteConfirmacion:false = bolsa sellada permanentemente (sync nunca la toca)
    function esSellada(b)  { return b.pendienteConfirmacion === false; }
    function esPendiente(b){ return b.pendienteConfirmacion === true;  }

    // ======================================================
    // UTILS
    // ======================================================
    function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
    function int(v) { var n = parseInt(v); return isNaN(n) ? 0 : n; }
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function fmt(n, dec) {
        if (n == null || isNaN(n)) return '—';
        return Number(n).toFixed(dec == null ? 1 : dec);
    }
    function fmtFecha(iso) {
        if (!iso) return '-';
        try {
            if (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}/.test(iso)) {
                var p = iso.substring(0, 10).split('-');
                return p[2] + '/' + p[1] + '/' + p[0];
            }
            var d = new Date(iso);
            if (isNaN(d.getTime())) return String(iso);
            var dd = String(d.getDate()).padStart(2, '0');
            var mm = String(d.getMonth() + 1).padStart(2, '0');
            return dd + '/' + mm + '/' + d.getFullYear();
        } catch (e) { return String(iso); }
    }
    function fmtFechaHora(iso) {
        if (!iso) return '-';
        try {
            if (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso)) {
                var f = iso.substring(0, 10).split('-');
                var h = iso.substring(11, 16);
                return f[2] + '/' + f[1] + '/' + f[0] + ' ' + h;
            }
            if (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
                return fmtFecha(iso);
            }
            var d = new Date(iso);
            if (isNaN(d.getTime())) return String(iso);
            var dd = String(d.getDate()).padStart(2, '0');
            var mm = String(d.getMonth() + 1).padStart(2, '0');
            var hh = String(d.getHours()).padStart(2, '0');
            var mi = String(d.getMinutes()).padStart(2, '0');
            return dd + '/' + mm + '/' + d.getFullYear() + ' ' + hh + ':' + mi;
        } catch (e) { return String(iso); }
    }
    function diasEntre(isoA, isoB) {
        if (!isoA || !isoB) return null;
        var a = new Date(isoA), b = new Date(isoB);
        if (isNaN(a) || isNaN(b)) return null;
        var d = Math.round((b - a) / 86400000);
        return d < 0 ? null : d;
    }
    function horasEntre(isoA, isoB) {
        if (!isoA || !isoB) return null;
        var a = new Date(isoA), b = new Date(isoB);
        if (isNaN(a) || isNaN(b)) return null;
        var h = (b - a) / 3600000;
        return h < 0 ? null : h;
    }
    function hoyISO() {
        var d = new Date();
        return d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
    }
    function ahoraISOLocal() {
        var d = new Date();
        return d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0') + 'T' +
            String(d.getHours()).padStart(2, '0') + ':' +
            String(d.getMinutes()).padStart(2, '0');
    }
    function genFrId(fechaISO) {
        var d = fechaISO ? new Date(fechaISO + 'T00:00:00') : new Date();
        var dia = String(d.getDate()).padStart(2, '0');
        var mes = String(d.getMonth() + 1).padStart(2, '0');
        var base = 'FR' + dia + mes;  // ej: FR234

        // Recopilar IDs existentes
        var usados = {};
        bolsas.forEach(function(b) { if (b.id) usados[b.id] = true; });

        // Sin sufijo disponible
        if (!usados[base]) return base;

        // Sufijos: b, c, d, ... z
        for (var code = 98; code <= 122; code++) {
            var candidate = base + String.fromCharCode(code);
            if (!usados[candidate]) return candidate;
        }

        // Fallback extremo (>25 bolsas mismo dia)
        return base + '_' + Date.now();
    }

    // Deriva la fecha de entrada en FR desde el ID (e.g. "FR2306" → "2026-06-23").
    // Heuristica de año: si el DDMM del ID está en el futuro respecto a hoy, usa año anterior.
    // Devuelve ISO date string o null si el ID no tiene el formato esperado.
    function _parseFechaFromId(id) {
        if (!id || typeof id !== 'string') return null;
        var m = id.match(/^FR(\d{2})(\d{2})/);
        if (!m) return null;
        var dd = m[1], mm = m[2];
        var now = new Date();
        var yr = now.getFullYear();
        var candidate = yr + '-' + mm + '-' + dd;
        if (new Date(candidate) > now) candidate = (yr - 1) + '-' + mm + '-' + dd;
        return candidate;
    }

    // ======================================================
    // UUID INTERNO — identidad estable de bolsa FR
    // ======================================================
    // Genera un UUID v4 simple. Solo se usa internamente (_frUuid).
    // No es visible ni editable por el usuario.
    // Permite que el id visible (FR234, etc.) sea renombrable sin perder
    // referencias cruzadas futuras, siguiendo el mismo patron que SU._uuid.
    function _frGenUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0;
            var v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * Migración one-shot: asigna _frUuid a bolsas históricas que no tengan uno.
     * Corre una sola vez. Idempotente: si ya corrió (marcador en localStorage), no hace nada.
     * Marcador: localStorage 'biolab_migracion_fr_uuid_v1' = '1'
     */
    function _frMigrarUUIDs() {
        var KEY_MIG = 'biolab_migracion_fr_uuid_v1';
        try { if (localStorage.getItem(KEY_MIG) === '1') return; } catch (e) { return; }
        var changed = false;
        bolsas.forEach(function(b) {
            if (!b._frUuid) { b._frUuid = _frGenUUID(); changed = true; }
        });
        if (changed) {
            try { saveBolsas(); } catch (e) { console.warn('[FR] migracion uuid save:', e); }
        }
        try { localStorage.setItem(KEY_MIG, '1'); } catch (e) {}
        if (changed) {
            console.log('[FR] Migracion UUID v1 ejecutada. Bolsas actualizadas: ' + bolsas.length + '.');
        }
    }

    // ======================================================
    // STORAGE
    // ======================================================
    function loadBolsas() {
        try {
            var raw = localStorage.getItem(FR_KEY);
            var arr = raw ? JSON.parse(raw) : [];
            bolsas = Array.isArray(arr) ? arr : [];
            // Normalizar bolsas sin pendienteConfirmacion (huérfanas pre-fix)
            bolsas = bolsas.map(function(b) {
                if (typeof b.pendienteConfirmacion !== 'boolean') {
                    b.pendienteConfirmacion = false;
                }
                return b;
            });
        } catch (e) {
            console.warn('[FR] load error:', e);
            bolsas = [];
        }
    }
    function saveBolsas() {
        try {
            localStorage.setItem(FR_KEY, JSON.stringify(bolsas));
        } catch (e) {
            console.error('[FR] save error:', e);
        }
    }
    function getSULotes() {
        try { return JSON.parse(localStorage.getItem(SU_KEY) || '[]') || []; }
        catch (e) { return []; }
    }
    function getGRLotesMap() {
        var m = {};
        try {
            var arr = JSON.parse(localStorage.getItem(GR_KEY) || '[]') || [];
            arr.forEach(function(l) { m[l.id] = l; });
        } catch (e) {}
        return m;
    }

    // ======================================================
    // CÁLCULOS
    // ======================================================
    function computeEstado(b) {
        if (!b) return 'colonizando';
        // Estados de ciclo de vida pre-activo
        if (esPendiente(b)) return 'pendiente';
        if (b.cancelada === true) return 'cancelada';
        if (b.contaminada === true) return 'contaminada';
        // cicloCerrado se evalúa ANTES de flushes: una bolsa cerrada con flushes
        // debe mostrar 'ciclo cerrado', no 'cosechado'.
        if (b.cicloCerrado === true) return 'ciclo cerrado';
        if (Array.isArray(b.flushes) && b.flushes.length > 0) return 'cosechado';
        if (b.fechaCosecha) return 'cosechado';
        if (b.fechaPines) return 'pinning';
        if (b.fechaColonizacion) return 'colonizado';
        return 'colonizando';
    }
    /**
     * Clasificación de bolsa para tabs:
     *   esPendiente(b)   → armado no confirmado aún (sin ID definitivo)
     *   esArchivada(b)   → contaminada, ciclo cerrado, o cancelada
     *   esCosecha(b)     → tiene >=1 flush y NO está archivada ni pendiente
     *   esEnCultivo(b)   → no archivada, no pendiente, sin flushes
     * Las cuatro son mutuamente excluyentes y cubren el universo de bolsas.
     */
    function esArchivada(b) {
        if (!b) return false;
        // pendientes NO van al archivo — tienen su propia sección
        if (esPendiente(b)) return false;
        return b.cancelada === true || b.contaminada === true || b.cicloCerrado === true;
    }
    function esCosecha(b) {
        if (!b) return false;
        if (esPendiente(b) || esArchivada(b)) return false;
        return Array.isArray(b.flushes) && b.flushes.length > 0;
    }
    function esEnCultivo(b) {
        if (!b) return false;
        if (esPendiente(b) || esArchivada(b)) return false;
        return !Array.isArray(b.flushes) || b.flushes.length === 0;
    }
    // Alias retro-compatible (algún código viejo puede llamarlo)
    function esHistorica(b) { return esArchivada(b); }
    function beOleada(pesoHumedo, pesoSustratoSeco) {
        var h = num(pesoHumedo), s = num(pesoSustratoSeco);
        if (s <= 0) return 0;
        return (h / s) * 100;
    }
    function beAcumulado(flushes) {
        if (!Array.isArray(flushes)) return 0;
        return flushes.reduce(function(a, f) { return a + num(f.beOleada); }, 0);
    }
    function biomasaHumedaTotal(flushes) {
        if (!Array.isArray(flushes)) return 0;
        return flushes.reduce(function(a, f) { return a + num(f.pesoHumedo); }, 0);
    }
    function biomasaSecaTotal(flushes) {
        if (!Array.isArray(flushes)) return 0;
        return flushes.reduce(function(a, f) { return a + (f.pesoSeco != null ? num(f.pesoSeco) : 0); }, 0);
    }
    function rendimientoFresco(flushes) { return biomasaHumedaTotal(flushes); }
    function pctBiomasaFlush(f) {
        var h = num(f && f.pesoHumedo);
        var s = (f && f.pesoSeco != null) ? num(f.pesoSeco) : null;
        if (h <= 0 || s == null || s <= 0) return null;
        return (s / h) * 100;
    }
    function tiempoDeshidFlush(f) {
        if (!f || !f.fecha || !f.finDeshidratacion) return null;
        return horasEntre(f.fecha, f.finDeshidratacion);
    }
    function tiempoTrabajoTotal(b) {
        if (!b || !b.fechaInicio) return null;
        var last = null;
        if (Array.isArray(b.flushes) && b.flushes.length > 0) {
            b.flushes.forEach(function(f) {
                if (!f || !f.fecha) return;
                var t = new Date(f.fecha).getTime();
                if (!isNaN(t) && (last == null || t > last)) last = t;
            });
        }
        if (last == null) return null;
        return horasEntre(b.fechaInicio, new Date(last).toISOString());
    }
    function recomputeFlushes(b) {
        if (!b || !Array.isArray(b.flushes)) return;
        var acc = 0;
        b.flushes.forEach(function(f, i) {
            f.n = i + 1;
            f.beOleada = beOleada(f.pesoHumedo, b.pesoSustratoSeco);
            acc += f.beOleada;
            f.beAcumulado = acc;
            f.pctBiomasa = pctBiomasaFlush(f);
            f.tiempoDeshidratacion = tiempoDeshidFlush(f);
        });
    }

    // ══ FR·CAL — Motor de Calidad ══════════════════════════════════════════
    var FR_CAL_INTEL_KEY = 'fr_cal_intel';

    var FR_CAL_WEIGHTS = {
        dominante:     0.30,
        hegemonico:    0.15,
        deformaciones: -0.10,
        abortos:       -0.25,
        blobs:         -0.20,
        mutaciones:    -0.30
    };

    var FR_ANOMALY_THRESHOLDS = { mutaciones: 15, deformaciones: 20, blobs: 15 };
    var FR_ANOMALY_MIN_N      = 3;

    function _frCalNormales(c) {
        var suma = (c.pctDominante || 0) + (c.pctHegemonico || 0)
                 + (c.pctDeformaciones || 0) + (c.pctAbortos || 0)
                 + (c.pctBlobs || 0) + (c.pctMutaciones || 0);
        return Math.max(0, 100 - suma);
    }

    function _frCalScore(flush, c) {
        var beBase = Math.min(num(flush.beOleada) || 0, 100);
        var fenAdj = (c.pctDominante     || 0) * FR_CAL_WEIGHTS.dominante
                   + (c.pctHegemonico    || 0) * FR_CAL_WEIGHTS.hegemonico
                   + (c.pctDeformaciones || 0) * FR_CAL_WEIGHTS.deformaciones
                   + (c.pctAbortos       || 0) * FR_CAL_WEIGHTS.abortos
                   + (c.pctBlobs         || 0) * FR_CAL_WEIGHTS.blobs
                   + (c.pctMutaciones    || 0) * FR_CAL_WEIGHTS.mutaciones;
        var notablesConPeso = (c.frutosNotables || []).filter(function(fn) {
            return fn.peso != null;
        }).length;
        var bonus = Math.min(notablesConPeso * 2, 10);
        return Math.max(0, Math.min(100, Math.round(beBase + fenAdj + bonus)));
    }

    function _frCalScoreClass(score) {
        if (score == null) return 'none';
        if (score >= 70) return 'high';
        if (score >= 40) return 'mid';
        return 'low';
    }

    var _frCalState = { flushIdx: null, frutosWork: [], lastAlert: null, lastAlertId: null };
    // ═══════════════════════════════════════════════════════════════════════

    function _frToast(msg, tipo) {
        var prev = document.querySelector('.fr-toast');
        if (prev && prev.parentNode) prev.parentNode.removeChild(prev);
        var el = document.createElement('div');
        el.className = 'fr-toast fr-toast-' + (tipo || 'ok');
        el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(function() { el.classList.add('fr-toast-fade'); }, 2000);
        setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 2500);
    }

    // ======================================================
    // OBSERVACIONES
    // ======================================================
    var ESTADOS_OBS = { none: true, green: true, yellow: true, red: true };
    function addObsTo(b, texto, tipo, estado) {
        if (!b) return;
        if (!Array.isArray(b.observaciones)) b.observaciones = [];
        var t = String(texto == null ? '' : texto).trim();
        if (!t) return;
        var est = ESTADOS_OBS[estado] ? estado : 'none';
        var dias = null;
        if (b.fechaInicio) {
            dias = diasEntre(b.fechaInicio, hoyISO());
        }
        b.observaciones.push({
            ts: new Date().toISOString(),
            tipo: tipo === 'auto' ? 'auto' : 'manual',
            estado: est,
            dias: dias,
            texto: t
        });
    }

    // ======================================================
    // SINCRONIZACIÓN
    // ======================================================
    function sincronizarTodo() {
        var res = { creadas: 0, salteadasSinGR: 0, filasIncompletas: 0, existentes: 0, colonizacionSync: 0 };
        var sus = getSULotes();
        var grMap = getGRLotesMap();

        // normStr: contrato de campo string en storage.
        // Convierte null/undefined/whitespace a null; de lo contrario trim.
        // Centralizado aquí para absorber datos históricos guardados con '' antes
        // de que suDbCollect() incorporara la misma normalización.
        function normStr(v) {
            var s = String(v == null ? '' : v).trim();
            return s || null;
        }

        // ── Identidad de bolsa FR ──────────────────────────────────────────────
        // Clave primaria (estable):   _suUuid + '#' + suBolsaIndex
        //   → no cambia cuando SU renombra el lote padre.
        // Clave secundaria (fallback): suLoteId + '#' + suBolsaIndex
        //   → para bolsas históricas creadas antes de que existiera _suUuid.
        var existMapUuid = {};   // _suUuid#idx  → bolsa FR
        var existMapLote = {};   // suLoteId#idx → bolsa FR (fallback)

        bolsas.forEach(function(b) {
            var idx = b.suBolsaIndex != null ? b.suBolsaIndex : '';
            if (b._suUuid) {
                existMapUuid[b._suUuid + '#' + idx] = b;
            }
            existMapLote[(b.suLoteId || '') + '#' + idx] = b;
        });

        sus.forEach(function(lote) {
            var db = Array.isArray(lote.db) ? lote.db : [];
            var bolsasDeclaradas = int(lote.bolsas);
            // Fallback al sum del DB (igual que suCalcularMetricasLote en SU):
            // cuando lote.bolsas = 0 pero las tandas tienen bolsas declaradas.
            if (bolsasDeclaradas === 0 && db.length > 0) {
                bolsasDeclaradas = db.reduce(function(s, r) { return s + (int(r.bolsas) || 0); }, 0);
            }
            var fibraSeca = num(lote.fibra);
            // sustratoPorBolsa = peso SECO de sustrato por bolsa (fibra / total bolsas).
            // lote.total es el peso HIDRATADO (fibra + agua + aditivos) — NO se usa como fallback
            // para seco porque semánticamente es incorrecto. Si fibra = 0 → seco desconocido.
            var sustratoPorBolsa = (fibraSeca > 0 && bolsasDeclaradas > 0) ? fibraSeca / bolsasDeclaradas : 0;
            var sustratoTotal = num(lote.total);
            var hidratadoTotal = sustratoTotal > 0 ? sustratoTotal : 0;
            var hidratadoPorBolsa = bolsasDeclaradas > 0 && hidratadoTotal > 0 ? hidratadoTotal / bolsasDeclaradas : null;

            var bolsaIdx = 0;
            db.forEach(function(r) {
                var cantidad = int(r.bolsas);
                // Peso efectivo por bolsa para esta tanda:
                // Si la tanda tiene pesoReal registrado manualmente → fuente de verdad.
                // Si no → peso teórico calculado a nivel lote (hidratadoPorBolsa).
                var hidratadoPorBolsaTanda = (parseFloat(r.pesoReal) > 0)
                    ? parseFloat(r.pesoReal)
                    : hidratadoPorBolsa;

                // ── Normalizar fuentes GR ────────────────────────────────────────────
                // Soporta grSources[] (nuevo, multi-fuente) y campos flat (histórico).
                var grLoteDefault = normStr(lote.grProtocolo) || '';
                var fuentes;  // [{ grLoteId, grTandaId, grUsados }]
                if (Array.isArray(r.grSources) && r.grSources.length > 0) {
                    fuentes = r.grSources
                        .map(function(s) {
                            return {
                                grLoteId:  normStr(s.grLoteId)  || grLoteDefault || null,
                                grTandaId: normStr(s.grTandaId) || null,
                                grUsados:  int(s.grUsados) || 0
                            };
                        })
                        .filter(function(s) { return s.grLoteId && s.grTandaId; });
                } else {
                    var _lid = normStr(r.grLoteId) || grLoteDefault || null;
                    var _tid = normStr(r.grTandaId) || null;
                    fuentes = (_lid && _tid) ? [{ grLoteId: _lid, grTandaId: _tid, grUsados: int(r.grUsados) || int(r.frascos) || 0 }] : [];
                }
                // Enriquecer cada fuente con geneticaFull + datos de inóculo sellados
                fuentes.forEach(function(fuente) {
                    if (!fuente.grLoteId || !fuente.grTandaId) return;
                    var _fl = grMap[fuente.grLoteId];
                    var _ft = _fl && Array.isArray(_fl.dg)
                        ? (_fl.dg.filter(function(t){ return t.tanda === fuente.grTandaId; })[0] || null)
                        : null;
                    var _fFenId = (_ft && _ft.fen_id) || null;
                    var _gFull = '';
                    if (_fFenId) {
                        try {
                            if (window.ge && typeof window.ge.getSelectableGenetics === 'function') {
                                var _h = window.ge.getSelectableGenetics().filter(function(g){ return g.id === _fFenId; })[0];
                                if (_h) _gFull = _h.label;
                            }
                        } catch(e) {}
                    }
                    if (!_gFull && _ft) _gFull = _ft.genetica || '';
                    fuente.geneticaFull    = _gFull || null;
                    // Sellar tipo de inóculo: CI (placa) o GE (genética directa)
                    fuente.inoculoSource   = _ft ? (_ft.inoculoSource || null) : null;
                    fuente.inoculoCiId     = (_ft && _ft.inoculoSource === 'CI') ? (_ft.cultivoCiId || null) : null;
                });

                // Fuente primaria: primera con tanda completa (hereda genética/fenotipo)
                var primary = fuentes[0] || {};
                var grLoteId  = primary.grLoteId  || null;
                var grTandaId = primary.grTandaId || null;

                // granoPorBolsa: suma de (usados × pesoFrasco) para todas las fuentes / cantidad
                var totalPesoGrano = 0;
                fuentes.forEach(function(s) {
                    var lRef = s.grLoteId ? grMap[s.grLoteId] : null;
                    var pf   = lRef && lRef.uf ? num(lRef.uf.peso_unidad) : 0;
                    if (pf > 0 && s.grUsados > 0) totalPesoGrano += s.grUsados * pf;
                });
                var frascosSub = fuentes.reduce(function(acc, s) { return acc + (s.grUsados || 0); }, 0);
                if (!frascosSub) frascosSub = int(r.frascos);  // fallback pre-multi
                var grLRef = grLoteId ? grMap[grLoteId] : null;
                var granoPorBolsaCalc = (cantidad > 0 && totalPesoGrano > 0)
                    ? totalPesoGrano / cantidad
                    : null;
                // Peso efectivo de grano por bolsa para esta tanda:
                // Si SU registró pesoGranoReal → fuente de verdad (override manual).
                // Si no → granoPorBolsaCalc (cálculo automático desde frascos × peso GR).
                var granoPorBolsaTanda = (parseFloat(r.pesoGranoReal) > 0)
                    ? parseFloat(r.pesoGranoReal)
                    : granoPorBolsaCalc;
                var fechaRegGR = null;
                if (grLRef) {
                    if (grLRef.fecha) fechaRegGR = grLRef.fecha;
                    else if (grLRef.ts) {
                        try { fechaRegGR = new Date(grLRef.ts).toISOString(); } catch (e) {}
                    }
                }

                for (var i = 0; i < cantidad; i++) {
                    if (!grLoteId || !grTandaId) {
                        // Fila con bolsas declaradas pero sin trazabilidad GR completa.
                        // Puede ser dato histórico pre-validación o fila sin GR intencional.
                        // Se contabiliza separado para que el caller pueda advertir al usuario.
                        if (grLoteId && !grTandaId) {
                            res.filasIncompletas++;
                        } else {
                            res.salteadasSinGR++;
                        }
                        bolsaIdx++;
                        continue;
                    }

                    var suUuid = lote._uuid || null;
                    var uuidKey = suUuid ? (suUuid + '#' + bolsaIdx) : null;
                    var loteKey = (lote.id || '') + '#' + bolsaIdx;
                    var exBolsa = (uuidKey && existMapUuid[uuidKey]) || existMapLote[loteKey] || null;

                    if (exBolsa && suUuid && exBolsa.suLoteId !== lote.id) {
                        // SOLO en bolsas pendientes — mismo gate que los 4 campos de abajo.
                        // Code review de la sesión 2026-07-10 encontró este bloque sin el gate
                        // que sí se agregó ahí (commit 3b1509a): mismo riesgo de reescribir
                        // trazabilidad de una bolsa ya sellada si SU reasigna/dedupe su id/_uuid.
                        if (esPendiente(exBolsa)) {
                            exBolsa.suLoteId = lote.id;
                            exBolsa._suUuid  = suUuid;
                            res.colonizacionSync++;
                        }
                    }

                    if (exBolsa) {
                        var ex = exBolsa;
                        // Sincronizar métricas derivadas de SU — SOLO en bolsas pendientes.
                        // Una bolsa sellada (pendienteConfirmacion:false) tiene estos valores
                        // congelados por el operador; auditoría forense 2026-07-10 confirmó
                        // que sin este gate, sincronizarTodo() reescribía granoPorBolsa en
                        // bolsas ya selladas sin dejar rastro (bolsas FR15b/FR15d, 2026-05-01).
                        if (esPendiente(ex)) {
                            if (granoPorBolsaTanda != null && ex.granoPorBolsa !== granoPorBolsaTanda) {
                                ex.granoPorBolsa = granoPorBolsaTanda;
                                res.colonizacionSync++;
                            }
                            if (hidratadoPorBolsaTanda != null && ex.pesoHumedoHidratado !== hidratadoPorBolsaTanda) {
                                ex.pesoHumedoHidratado = hidratadoPorBolsaTanda;
                                res.colonizacionSync++;
                            }
                            if (sustratoPorBolsa > 0 && ex.pesoSustratoSeco !== sustratoPorBolsa) {
                                ex.pesoSustratoSeco = sustratoPorBolsa;
                                res.colonizacionSync++;
                            }
                            if (fechaRegGR && !ex.fechaRegistroGR) {
                                ex.fechaRegistroGR = fechaRegGR;
                                res.colonizacionSync++;
                            }
                        }
                        // Sincronizar fuentes GR: si SU cambió la trazabilidad, propagar a FR.
                        // Solo se actualiza en bolsas pendientes — una bolsa confirmada tiene
                        // su trazabilidad sellada por el operador en el momento del armado.
                        if (esPendiente(ex)) {
                            if (grLoteId && ex.grLoteId !== grLoteId) {
                                ex.grLoteId  = grLoteId;
                                res.colonizacionSync++;
                            }
                            if (grTandaId && ex.grTandaId !== grTandaId) {
                                ex.grTandaId = grTandaId;
                                res.colonizacionSync++;
                            }
                            if (fuentes.length > 0) {
                                ex.grSources = fuentes;
                                res.colonizacionSync++;
                            }
                        }
                        // Migración Fase 4a: bolsas confirmadas sin grSources[] (formato pre-Fase4)
                        // Solo rellena si grSources es null — nunca sobreescribe datos sellados.
                        if (!ex.grSources && fuentes.length > 0) {
                            ex.grSources = fuentes;
                            res.colonizacionSync++;
                        }
                        // Migración Fase 4b: grSources[] existe pero le faltan inoculoSource/geneticaFull
                        // Enriquece cada entrada que tenga el campo ausente, sin tocar las que ya tienen.
                        if (Array.isArray(ex.grSources) && fuentes.length > 0) {
                            var _fuenteMap = {};
                            fuentes.forEach(function(f) {
                                if (f.grLoteId && f.grTandaId) _fuenteMap[f.grLoteId + '|' + f.grTandaId] = f;
                            });
                            var _changed = false;
                            ex.grSources.forEach(function(s) {
                                var _k = (s.grLoteId || '') + '|' + (s.grTandaId || '');
                                var _ref = _fuenteMap[_k];
                                if (_ref) {
                                    if (s.inoculoSource == null && _ref.inoculoSource != null) {
                                        s.inoculoSource = _ref.inoculoSource;
                                        _changed = true;
                                    }
                                    if (s.inoculoCiId == null && _ref.inoculoCiId != null) {
                                        s.inoculoCiId = _ref.inoculoCiId;
                                        _changed = true;
                                    }
                                    if (!s.geneticaFull && _ref.geneticaFull) {
                                        s.geneticaFull = _ref.geneticaFull;
                                        _changed = true;
                                    }
                                }
                            });
                            if (_changed) res.colonizacionSync++;
                        }
                        ex.estado = computeEstado(ex);
                        res.existentes++;
                        bolsaIdx++;
                        continue;
                    }

                    var grL = grMap[grLoteId];
                    var grTanda = null;
                    if (grL && Array.isArray(grL.dg)) {
                        for (var k = 0; k < grL.dg.length; k++) {
                            if (grL.dg[k].tanda === grTandaId) { grTanda = grL.dg[k]; break; }
                        }
                    }

                    var fenId = (grTanda && grTanda.fen_id) || null;
                    var geneticaFull = '';
                    var cepaNombre = '';
                    var fenNombre = '';
                    if (fenId) {
                        try {
                            if (window.ge && typeof window.ge.getSelectableGenetics === 'function') {
                                var _sel = window.ge.getSelectableGenetics();
                                var _hit = _sel.find(function(g){ return g.id === fenId; });
                                if (_hit) geneticaFull = _hit.label;
                            }
                            if (!geneticaFull) {
                                var _raw = localStorage.getItem('biolab.ge.v4');
                                if (_raw) {
                                    var _parsed = JSON.parse(_raw);
                                    var _geNodes = Array.isArray(_parsed.nodes) ? _parsed.nodes : [];
                                    var _getN = function(id){ return _geNodes.find(function(n){ return n.id===id; })||null; };
                                    var _fNode = _geNodes.find(function(n){ return n.id===fenId; });
                                    if (_fNode) {
                                        var _chain = [], _cur = _fNode;
                                        while (_cur) { _chain.unshift(_cur); _cur = _cur.parentId ? _getN(_cur.parentId) : null; }
                                        geneticaFull = _chain.map(function(n){ return n.name; }).join(' / ');
                                    }
                                }
                            }
                        } catch(e) {}
                        if (geneticaFull) {
                            var parts = geneticaFull.split('/').map(function(s){ return s.trim(); });
                            fenNombre  = parts[parts.length - 1] || '';
                            cepaNombre = parts.slice(0, -1).join(' / ') || '';
                        }
                    }
                    if (!geneticaFull) {
                        geneticaFull = (grTanda && grTanda.genetica) || '';
                        var _parts = geneticaFull.split('/').map(function(s){ return s.trim(); });
                        fenNombre  = _parts[_parts.length - 1] || '';
                        cepaNombre = _parts.slice(0, -1).join(' / ') || _parts[0] || '';
                    }

                    var nueva = {
                        id: null,
                        _frUuid: _frGenUUID(),
                        ts: Date.now(),
                        origen: 'su',
                        pendienteConfirmacion: true,
                        _suUuid: suUuid || null,
                        suLoteId: lote.id || '',
                        suBolsaIndex: bolsaIdx,
                        suSubTanda: r.tanda || ('sub-' + bolsaIdx),
                        grLoteId: grLoteId,     // fuente primaria (trazabilidad hacia atrás)
                        grTandaId: grTandaId,   // fuente primaria
                        grSources: fuentes.length > 0 ? fuentes : null,  // todas las fuentes
                        fechaRegistroGR: fechaRegGR,
                        fenId: fenId,
                        genetica: cepaNombre,
                        fenotipo: fenNombre,
                        geneticaFull: geneticaFull,
                        fechaInicio: lote.fecha || null,
                        fechaColonizacion: null,
                        fechaPines: null,
                        fechaCosecha: null,
                        temperatura: null,
                        pesoSustratoSeco: sustratoPorBolsa > 0 ? sustratoPorBolsa : null,
                        pesoHumedoHidratado: hidratadoPorBolsaTanda,
                        granoPorBolsa: granoPorBolsaTanda,
                        contaminada: false,
                        cancelada: false,
                        fechaCancelacion: null,
                        fechaContaminacion: null,
                        flushes: [],
                        observaciones: [],
                        estado: 'pendiente'
                    };
                    addObsTo(nueva,
                        'Bolsa registrada desde SU ' + nueva.suLoteId +
                        ' (GR ' + grLoteId + ' / ' + grTandaId + '). ' +
                        'Pendiente de confirmación de armado. ' +
                        'Sustrato seco: ' + fmt(sustratoPorBolsa, 1) + ' g' +
                        ' · Hidratado: ' + (hidratadoPorBolsaTanda != null ? fmt(hidratadoPorBolsaTanda, 1) + ' g' + (parseFloat(r.pesoReal) > 0 ? ' ✎real' : '') : '—') +
                        ' · Grano/bolsa: ' + (granoPorBolsaTanda != null ? fmt(granoPorBolsaTanda, 1) + ' g' + (parseFloat(r.pesoGranoReal) > 0 ? ' ✎real' : '') : '—') + '.',
                        'auto', 'yellow');
                    bolsas.push(nueva);
                    if (uuidKey) existMapUuid[uuidKey] = nueva;
                    existMapLote[loteKey] = nueva;
                    res.creadas++;
                    bolsaIdx++;
                }
            });
        });

        if (res.creadas > 0 || res.colonizacionSync > 0) saveBolsas();
        return res;
    }

    // ======================================================
    // SINCRONIZACIÓN MANUAL DE TRAZABILIDAD
    // Permite corregir la cadena GE→CI→GR→SU de una bolsa confirmada.
    // ======================================================

    /**
     * Función pura: calcula los nuevos valores de trazabilidad para una bolsa
     * leyendo desde SU/GR/GE actuales. No muta nada.
     * Retorna null si no se puede resolver el lote SU.
     */
    function _frComputarNuevaTrazabilidad(bolsa) {
        // 1) Leer SU lote
        var suLotes = getSULotes();
        var lote = null;
        for (var i = 0; i < suLotes.length; i++) {
            if (suLotes[i].id === bolsa.suLoteId) { lote = suLotes[i]; break; }
        }
        if (!lote) return null;

        // 2) Encontrar la fila db por índice
        var db = Array.isArray(lote.db) ? lote.db : [];
        var r = null;
        // Buscar fila db por rango de índice (sin doble-conteo)
        var bolsaIdx = 0;
        for (var di = 0; di < db.length; di++) {
            var rowBolsas = parseInt(db[di].bolsas) || 0;
            if (bolsa.suBolsaIndex >= bolsaIdx && bolsa.suBolsaIndex < bolsaIdx + rowBolsas) {
                r = db[di]; break;
            }
            bolsaIdx += rowBolsas;
        }
        // Fallback: match por suSubTanda si el índice falló
        if (!r && bolsa.suSubTanda) {
            for (var dj = 0; dj < db.length; dj++) {
                if (db[dj].tanda === bolsa.suSubTanda) { r = db[dj]; break; }
            }
        }
        if (!r && db.length === 1) r = db[0];
        if (!r) return null;

        // 3) Normalizar grSources (igual que sincronizarTodo)
        var grLoteDefault = (lote.grProtocolo || '').trim() || '';
        var fuentes = [];
        if (Array.isArray(r.grSources) && r.grSources.length > 0) {
            fuentes = r.grSources.map(function(s) {
                return {
                    grLoteId:  (String(s.grLoteId  || '').trim()) || grLoteDefault || null,
                    grTandaId: (String(s.grTandaId || '').trim()) || null,
                    grUsados:  parseInt(s.grUsados) || 0
                };
            }).filter(function(s) { return s.grLoteId && s.grTandaId; });
        } else {
            var _lid = (String(r.grLoteId || grLoteDefault || '').trim()) || null;
            var _tid = (String(r.grTandaId || r.grano || '').trim()) || null;
            if (_lid && _tid) {
                fuentes = [{ grLoteId: _lid, grTandaId: _tid, grUsados: parseInt(r.grUsados) || 0 }];
            }
        }
        if (fuentes.length === 0) return null;

        // 4) Enriquecer cada fuente con GR→GE chain
        var grMap = getGRLotesMap();
        var geRaw = null;
        try { geRaw = JSON.parse(localStorage.getItem('biolab.ge.v4') || '{}'); } catch(e) {}
        var geNodes = (geRaw && Array.isArray(geRaw.nodes)) ? geRaw.nodes : [];
        function _getGeNode(id) {
            for (var gi = 0; gi < geNodes.length; gi++) {
                if (geNodes[gi].id === id) return geNodes[gi];
            }
            return null;
        }
        function _buildChainLabel(nodeId) {
            var chain = [], cur = _getGeNode(nodeId);
            while (cur) { chain.unshift(cur); cur = cur.parentId ? _getGeNode(cur.parentId) : null; }
            return chain.map(function(n) { return n.name || n.id; }).join(' / ');
        }

        fuentes.forEach(function(fuente) {
            var _fl = fuente.grLoteId ? grMap[fuente.grLoteId] : null;
            var _ft = _fl && Array.isArray(_fl.dg)
                ? _fl.dg.filter(function(t) { return t.tanda === fuente.grTandaId; })[0] || null
                : null;
            var _fenId = (_ft && _ft.fen_id) || null;
            var _gFull = '';
            if (_fenId) _gFull = _buildChainLabel(_fenId);
            if (!_gFull && _ft) _gFull = _ft.genetica || '';
            fuente.geneticaFull  = _gFull || null;
            fuente.inoculoSource = _ft ? (_ft.inoculoSource || null) : null;
            fuente.inoculoCiId   = (_ft && _ft.inoculoSource === 'CI') ? (_ft.cultivoCiId || null) : null;
        });

        // 5) Derivar campos principales desde fuente primaria
        var primary = fuentes[0];
        var fenId        = null;
        var geneticaFull = primary.geneticaFull || '';
        var grPrimLote   = primary.grLoteId ? grMap[primary.grLoteId] : null;
        var grPrimDg     = grPrimLote && Array.isArray(grPrimLote.dg)
            ? grPrimLote.dg.filter(function(t) { return t.tanda === primary.grTandaId; })[0] || null
            : null;
        if (grPrimDg && grPrimDg.fen_id) fenId = grPrimDg.fen_id;

        var parts = geneticaFull ? geneticaFull.split('/').map(function(s) { return s.trim(); }) : [];
        var fenotipo = parts.length > 0 ? parts[parts.length - 1] : '';
        var genetica  = parts.length > 1 ? parts.slice(0, -1).join(' / ') : (parts[0] || '');

        // 6) Calcular métricas de sustrato/grano
        var bolsasDeclaradas = parseInt(lote.bolsas) || 0;
        if (bolsasDeclaradas === 0 && db.length > 0) {
            bolsasDeclaradas = db.reduce(function(s, row) { return s + (parseInt(row.bolsas) || 0); }, 0);
        }
        var fibraSeca = parseFloat(lote.fibra) || 0;
        var sustratoPorBolsa = (fibraSeca > 0 && bolsasDeclaradas > 0) ? fibraSeca / bolsasDeclaradas : null;
        var sustratoTotal = parseFloat(lote.total) || 0;
        var hidratadoPorBolsa = (bolsasDeclaradas > 0 && sustratoTotal > 0) ? sustratoTotal / bolsasDeclaradas : null;

        // pesoReal override
        var hidratadoPorBolsaTanda = (parseFloat(r.pesoReal) > 0) ? parseFloat(r.pesoReal) : hidratadoPorBolsa;

        // Grano por bolsa: suma (usados × pesoFrasco) / cantidad fila
        var cantFila = parseInt(r.bolsas) || 1;
        var totalPesoGrano = 0;
        fuentes.forEach(function(s) {
            var lRef = s.grLoteId ? grMap[s.grLoteId] : null;
            var pf = lRef && lRef.uf ? (parseFloat(lRef.uf.peso_unidad) || 0) : 0;
            if (pf > 0 && s.grUsados > 0) totalPesoGrano += s.grUsados * pf;
        });
        var granoPorBolsaCalc = (cantFila > 0 && totalPesoGrano > 0) ? totalPesoGrano / cantFila : null;
        var granoPorBolsaTanda = (parseFloat(r.pesoGranoReal) > 0) ? parseFloat(r.pesoGranoReal) : granoPorBolsaCalc;

        return {
            grSources:           fuentes,
            grLoteId:            primary.grLoteId,
            grTandaId:           primary.grTandaId,
            inoculoSource:       primary.inoculoSource,
            inoculoCiId:         primary.inoculoCiId,
            geneticaFull:        geneticaFull,
            fenId:               fenId,
            genetica:            genetica,
            fenotipo:            fenotipo,
            pesoSustratoSeco:    sustratoPorBolsa,
            pesoHumedoHidratado: hidratadoPorBolsaTanda,
            granoPorBolsa:       granoPorBolsaTanda,
        };
    }

    /**
     * Compara los campos de trazabilidad actuales de la bolsa con los nuevos calculados.
     * Retorna array de {campo, label, antes, despues} — solo los que cambian.
     */
    function _frDiffTrazabilidad(bolsa, nueva) {
        var diffs = [];
        function chk(campo, label, antes, despues) {
            var a = antes == null ? '—' : String(antes);
            var d = despues == null ? '—' : String(despues);
            if (a !== d) diffs.push({ campo: campo, label: label, antes: a, despues: d });
        }
        chk('geneticaFull', 'Genética',  bolsa.geneticaFull,  nueva.geneticaFull);
        chk('fenId',        'Fen ID',    bolsa.fenId,         nueva.fenId);
        chk('fenotipo',     'Fenotipo',  bolsa.fenotipo,      nueva.fenotipo);
        chk('genetica',     'Cepa',      bolsa.genetica,      nueva.genetica);
        chk('grLoteId',     'GR Lote',   bolsa.grLoteId,      nueva.grLoteId);
        chk('grTandaId',    'GR Tanda',  bolsa.grTandaId,     nueva.grTandaId);
        chk('inoculoSource','Inóculo',   bolsa.inoculoSource, nueva.inoculoSource);
        chk('inoculoCiId',  'CI Placa',  bolsa.inoculoCiId,   nueva.inoculoCiId);

        // grSources: comparar como JSON string
        var srcAntes   = JSON.stringify((bolsa.grSources || []).map(function(s) {
            return { l: s.grLoteId, t: s.grTandaId, u: s.grUsados };
        }));
        var srcDespues = JSON.stringify((nueva.grSources || []).map(function(s) {
            return { l: s.grLoteId, t: s.grTandaId, u: s.grUsados };
        }));
        if (srcAntes !== srcDespues) {
            var antesLabel   = (bolsa.grSources || []).map(function(s) { return s.grLoteId + '·' + s.grTandaId; }).join(' + ') || (bolsa.grLoteId || '') + '·' + (bolsa.grTandaId || '');
            var despuesLabel = (nueva.grSources  || []).map(function(s) { return s.grLoteId + '·' + s.grTandaId; }).join(' + ');
            diffs.push({ campo: 'grSources', label: 'Fuentes GR', antes: antesLabel, despues: despuesLabel });
        }

        function fmtNum(v) { return v != null ? parseFloat(v).toFixed(1) + ' g' : '—'; }
        chk('pesoSustratoSeco',    'Seco/bolsa',  fmtNum(bolsa.pesoSustratoSeco),    fmtNum(nueva.pesoSustratoSeco));
        chk('pesoHumedoHidratado', 'Hidratado',   fmtNum(bolsa.pesoHumedoHidratado), fmtNum(nueva.pesoHumedoHidratado));
        chk('granoPorBolsa',       'Grano/bolsa', fmtNum(bolsa.granoPorBolsa),       fmtNum(nueva.granoPorBolsa));
        return diffs;
    }

    // Estado temporal del sync pendiente de confirmación
    var _frSyncPendiente = null; // { frUuid, nuevaTrazabilidad, diffs }

    FR.sincronizarTrazabilidadBolsa = function() {
        var b = getSelected();
        if (!b || esPendiente(b)) return;

        var nueva = _frComputarNuevaTrazabilidad(b);
        if (!nueva) {
            alert('No se pudo leer el lote SU vinculado (' + (b.suLoteId || '—') + ').\nVerificá que el lote SU existe.');
            return;
        }

        var diffs = _frDiffTrazabilidad(b, nueva);
        var content  = document.getElementById('frSyncDiffContent');
        var modal    = document.getElementById('frSyncModal');
        var applyBtn = document.getElementById('frSyncApplyBtn');
        if (!content || !modal) return;

        if (diffs.length === 0) {
            content.innerHTML = '<div class="fr-sync-no-changes">✓ La trazabilidad ya está actualizada. No hay cambios.</div>';
            if (applyBtn) applyBtn.style.display = 'none';
        } else {
            var rows = diffs.map(function(d) {
                return '<div class="fr-sync-diff-row">'
                    + '<span class="fr-sync-diff-field">' + esc(d.label) + '</span>'
                    + '<span class="fr-sync-diff-antes">'   + esc(d.antes)   + '</span>'
                    + '<span class="fr-sync-diff-despues">' + esc(d.despues) + '</span>'
                    + '</div>';
            }).join('');
            content.innerHTML =
                '<div class="fr-sync-diff-row" style="font-weight:600;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:6px">'
                + '<span class="fr-sync-diff-field">Campo</span>'
                + '<span style="color:var(--er)">Actual</span>'
                + '<span style="color:var(--ac)">Nuevo (desde SU)</span>'
                + '</div>' + rows;
            if (applyBtn) applyBtn.style.display = '';
        }

        _frSyncPendiente = { frUuid: b._frUuid, nuevaTrazabilidad: nueva, diffs: diffs };
        modal.style.display = 'flex';
    };

    FR.cerrarSyncModal = function() {
        var modal = document.getElementById('frSyncModal');
        if (modal) modal.style.display = 'none';
        _frSyncPendiente = null;
    };

    FR.aplicarSync = function() {
        if (!_frSyncPendiente) return;
        var b = bolsas.find(function(x) { return x._frUuid === _frSyncPendiente.frUuid; });
        if (!b) { FR.cerrarSyncModal(); return; }

        var nueva = _frSyncPendiente.nuevaTrazabilidad;
        var diffs = _frSyncPendiente.diffs;

        // Aplicar solo los campos de trazabilidad — NUNCA tocar protegidos
        b.grSources           = nueva.grSources;
        b.grLoteId            = nueva.grLoteId;
        b.grTandaId           = nueva.grTandaId;
        b.inoculoSource       = nueva.inoculoSource;
        b.inoculoCiId         = nueva.inoculoCiId;
        b.geneticaFull        = nueva.geneticaFull;
        b.fenId               = nueva.fenId;
        b.genetica            = nueva.genetica;
        b.fenotipo            = nueva.fenotipo;
        b.pesoSustratoSeco    = nueva.pesoSustratoSeco;
        b.pesoHumedoHidratado = nueva.pesoHumedoHidratado;
        b.granoPorBolsa       = nueva.granoPorBolsa;
        b.estado              = computeEstado(b);

        // Agregar observación de auditoría
        var resumen = diffs.slice(0, 3).map(function(d) {
            return d.label + ': ' + d.antes + ' → ' + d.despues;
        }).join('; ');
        if (diffs.length > 3) resumen += '; (+' + (diffs.length - 3) + ' más)';
        addObsTo(b, '🔄 Trazabilidad sincronizada. ' + resumen + '.', 'auto', 'none');

        saveBolsas();
        FR.cerrarSyncModal();
        renderAll();
    };

    FR.createFromSU = function(suLote) {
        var r = sincronizarTodo();
        renderAll();
        return r;
    };

    // ======================================================
    // CONFIRMACIÓN / CANCELACIÓN DE BOLSAS PENDIENTES
    // ======================================================

    /**
     * Confirma el armado físico de una bolsa pendiente.
     * Genera el ID definitivo con genFrId() usando la fecha real de armado
     * (fechaOverride, elegida por el usuario en la fila) — no la fecha del click.
     * Pasa la bolsa de estado 'pendiente' a 'colonizando' y la incorpora al flujo normal.
     */
    FR.confirmarBolsa = function(frUuid, fechaOverride) {
        if (!frUuid) return;
        var b = bolsas.find(function(x) { return x._frUuid === frUuid; });
        if (!b) { console.warn('[FR] confirmarBolsa: uuid no encontrado', frUuid); return; }
        if (!esPendiente(b)) { console.warn('[FR] confirmarBolsa: bolsa no está pendiente', frUuid); return; }

        var fechaArmado = fechaOverride || b.fechaInicio || hoyISO();
        b.fechaInicio = fechaArmado;
        var idNuevo = genFrId(fechaArmado);
        b.id = idNuevo;
        b.fechaEntradaFR = hoyISO();
        b.pendienteConfirmacion = false;
        b.estado = computeEstado(b);
        addObsTo(b, 'Armado de bolsa confirmado. ID asignado: ' + idNuevo + '.', 'auto', 'green');
        saveBolsas();
        // Notificar a SU para que refresque el badge (pasa de PENDIENTE a ID real)
        try { window.dispatchEvent(new Event('fr-bolsa-renombrada')); } catch (e) {}
        selectedId = idNuevo;
        renderAll();
    };

    /**
     * Cancela/descarta una bolsa pendiente.
     * La bolsa NO se elimina: queda en Archivo marcada como cancelada para trazabilidad.
     * El ID queda como null (nunca se generó) pero el _frUuid la identifica.
     * Se le asigna un id de display para el archivo: 'CANC-' + fecha.
     */
    FR.cancelarBolsa = function(frUuid) {
        if (!frUuid) return;
        var b = bolsas.find(function(x) { return x._frUuid === frUuid; });
        if (!b) { console.warn('[FR] cancelarBolsa: uuid no encontrado', frUuid); return; }
        if (!esPendiente(b)) { console.warn('[FR] cancelarBolsa: bolsa no está pendiente', frUuid); return; }

        var hoy = hoyISO();
        // Asignar ID de display para que el archivo pueda renderizarla con un identificador
        // Formato: CANC-DDMM-sufijo para evitar colisiones
        var baseCanc = 'CANC-' + hoy.substring(8, 10) + hoy.substring(5, 7);
        var usados = {};
        bolsas.forEach(function(x) { if (x.id) usados[x.id] = true; });
        var idCanc = baseCanc;
        if (usados[idCanc]) {
            for (var code = 98; code <= 122; code++) {
                var cand = baseCanc + String.fromCharCode(code);
                if (!usados[cand]) { idCanc = cand; break; }
            }
        }
        b.id = idCanc;
        b.pendienteConfirmacion = false;
        b.cancelada = true;
        b.fechaCancelacion = hoy;
        b.estado = computeEstado(b);
        addObsTo(b, 'Bolsa descartada antes de confirmar el armado. Archivada para trazabilidad.', 'auto', 'red');
        saveBolsas();
        try { window.dispatchEvent(new Event('fr-bolsa-renombrada')); } catch (e) {}
        renderAll();
    };

    // ======================================================
    // RENDER: TABLAS
    // ======================================================
    /**
     * Agregados por lote SU (incluye todas las bolsas, activas e historicas):
     *   - contPct: % bolsas contaminadas en el lote SU
     *   - diasColAvg: dias promedio de colonizacion (solo bolsas con fechaColonizacion)
     *   - ratio: tasa de exito = colonizadas / (colonizadas + contaminadas) * 100
     * Se cachean por suLoteId durante la pasada de render para no recomputar
     * en cada fila.
     */
    var _aggSUCache = null;
    function _aggregadosPorSU(suLoteId) {
        if (!suLoteId) return null;
        if (_aggSUCache && _aggSUCache[suLoteId]) return _aggSUCache[suLoteId];
        if (!_aggSUCache) _aggSUCache = {};

        var deLote = bolsas.filter(function(x) { return x.suLoteId === suLoteId; });
        var total = deLote.length;
        if (total === 0) {
            _aggSUCache[suLoteId] = { contPct: null, diasColAvg: null, ratio: null };
            return _aggSUCache[suLoteId];
        }
        var contam = deLote.filter(function(x) { return x.contaminada === true; }).length;
        var colon = deLote.filter(function(x) { return !!x.fechaColonizacion && x.contaminada !== true; }).length;
        var diasArr = deLote
            .filter(function(x) { return !!x.fechaColonizacion && !!x.fechaInicio; })
            .map(function(x) { return diasEntre(x.fechaInicio, x.fechaColonizacion); })
            .filter(function(d) { return d != null && d >= 0; });
        var diasColAvg = diasArr.length > 0
            ? diasArr.reduce(function(a, d) { return a + d; }, 0) / diasArr.length
            : null;
        var contPct = (contam / total) * 100;
        var ratio = (colon + contam) > 0 ? (colon / (colon + contam)) * 100 : null;
        _aggSUCache[suLoteId] = { contPct: contPct, diasColAvg: diasColAvg, ratio: ratio };
        return _aggSUCache[suLoteId];
    }

    function filaTabla(b, tabNombre) {
        var cl = 'onclick="FR.select(\'' + esc(b.id) + '\')"';
        var dias = b.cicloCerrado && b.fechaCierreCiclo
            ? diasEntre(b.fechaInicio, b.fechaCierreCiclo)
            : diasEntre(b.fechaInicio, hoyISO());
        var ge = _geTxtFromBolsa(b);
        var suTxt = (b.suLoteId || '—') + (b.suSubTanda ? ' · ' + b.suSubTanda : '');
        var grTxt = _grTxtFromBolsa(b);
        var be = beAcumulado(b.flushes);
        var rend = rendimientoFresco(b.flushes);
        var fN = (b.flushes || []).length;
        var estado = computeEstado(b);
        var agg = _aggregadosPorSU(b.suLoteId);
        var contPctTxt = (agg && agg.contPct != null) ? fmt(agg.contPct, 1) + '%' : '—';
        var diasColTxt = (agg && agg.diasColAvg != null) ? fmt(agg.diasColAvg, 1) + 'd' : '—';
        var ratioTxt   = (agg && agg.ratio != null)     ? fmt(agg.ratio, 1) + '%' : '—';
        // Columnas propias de Cosecha (2026-07-24): reemplazan Cont.%/Dias Col./Ratio
        // (estadisticas agregadas del LOTE SU, ya irrelevantes una vez que la bolsa esta
        // cosechando) por rendimiento deshidratado real de ESTA bolsa. Decision del usuario:
        // no agregar una columna de "Calidad" — un solo flush de alto BE (300-400%) no es
        // comparable contra 3 flushes de 80% cada uno, promediar scoreAuto seria enganoso.
        var rendSeco    = biomasaSecaTotal(b.flushes);
        var pctDeshid   = (rend > 0 && rendSeco > 0) ? (rendSeco / rend) * 100 : null;
        var rendSecoTxt = rendSeco > 0 ? fmt(rendSeco, 1) + ' g' : '-';
        var pctDeshidTxt = pctDeshid != null ? fmt(pctDeshid, 1) + '%' : '-';
        var fEntrada   = fmtFecha(b.fechaInicio || b.fechaEntradaFR || _parseFechaFromId(b.id));
        var fUltCos    = '—';
        var fArchFecha = '—';
        if (fN > 0) {
            var maxFlushFecha = (b.flushes || []).reduce(function(m, f) { return (f.fecha || '') > m ? (f.fecha || '') : m; }, '');
            if (maxFlushFecha) fUltCos = fmtFecha(maxFlushFecha);
        }
        var archStr = b.fechaCierreCiclo || b.fechaCancelacion;
        if (archStr) fArchFecha = fmtFecha(archStr);
        // Mapping de estados internos → etiquetas de display en chip.
        // Estado interno 'ciclo cerrado' → label visible 'FIN DEL CICLO'.
        var _ESTADO_LABELS = { 'ciclo cerrado': 'FIN DEL CICLO' };
        var estadoLabel = _ESTADO_LABELS[estado] || estado;

        var chipClass = 'fr-chip-neutral';
        if (estado === 'colonizando') chipClass = 'fr-chip-warn';
        else if (estado === 'colonizado') chipClass = 'fr-chip-ok';
        else if (estado === 'pinning') chipClass = 'fr-chip-warn';
        else if (estado === 'cosechado') chipClass = 'fr-chip-ok';
        else if (estado === 'contaminada') chipClass = 'fr-chip-bad';
        else if (estado === 'cancelada') chipClass = 'fr-chip-cancelada';
        else if (estado === 'ciclo cerrado') chipClass = 'fr-chip-fin-ciclo';

        var selectedAttr = (selectedId === b.id) ? ' fr-row-selected' : '';

        var huerfanaBadge = b.origen === 'huerfana'
            ? ' <span class="fr-chip fr-chip-huerfana" title="Cargada manualmente sin trazabilidad SU\u2192GR">H</span>'
            : '';

        var suId = esc(b.suLoteId || '');
        var row = '<tr class="fr-row' + selectedAttr + '" style="cursor:pointer">'
            + '<td onclick="event.stopPropagation()" style="width:28px;text-align:center">'
            +   '<input type="checkbox" class="fr-sel-cb" data-fr-id="' + esc(b.id) + '" onclick="event.stopPropagation();FR._actualizarContadorSel(this.closest(\'table\'))">'
            + '</td>'
            + '<td class="fr-num-days" ' + cl + ' title="Fecha de armado de la bolsa">' + esc(fEntrada) + '</td>'
            + '<td ' + cl + '><strong>' + esc(b.id) + '</strong>' + huerfanaBadge + '</td>'
            + '<td ' + cl + '>' + esc(ge) + '</td>'
            + '<td ' + cl + '><span class="fr-traza">' + esc(suTxt) + '</span></td>'
            + '<td ' + cl + '><span class="fr-traza">' + esc(grTxt) + '</span></td>'
            + '<td class="fr-num-days" ' + cl + '>' + (dias != null ? dias + 'd' : '-') + '</td>'
            + '<td ' + cl + '>'
            +   '<span class="fr-chip ' + chipClass + '">' + esc(estadoLabel) + '</span>'
            +   (estado === 'cancelada'
                  ? ' <button onclick="event.stopPropagation();FR.eliminar(\'' + esc(b.id) + '\')" '
                  +   'class="fr-btn-eliminar-canc" title="Eliminar definitivamente este registro cancelado">&#x1F5D1;</button>'
                  : '')
            + '</td>'
            + '<td class="fr-num" ' + cl + '>' + fN + '</td>'
            + '<td class="fr-num" ' + cl + '>' + (rend > 0 ? fmt(rend, 1) + ' g' : '-') + '</td>'
            + '<td class="fr-num-pct" ' + cl + '>' + (be > 0 ? fmt(be, 1) + '%' : '-') + '</td>'
            + ((tabNombre === 'cosecha' || tabNombre === 'archivo')
                ? '<td class="fr-num" ' + cl + ' title="Rendimiento deshidratado total, todas las oleadas de esta bolsa">' + rendSecoTxt + '</td>'
                + '<td class="fr-num-pct" ' + cl + ' title="Peso deshidratado / peso fresco total de esta bolsa">' + pctDeshidTxt + '</td>'
                : '<td class="fr-num-pct" ' + cl + ' title="Agregado lote SU ' + suId + '">' + contPctTxt + '</td>'
                + '<td class="fr-num-days" ' + cl + ' title="Agregado lote SU ' + suId + '">' + diasColTxt + '</td>'
                + '<td class="fr-num-pct" ' + cl + ' title="Agregado lote SU ' + suId + '">' + ratioTxt + '</td>');
        if (tabNombre === 'cosecha' || tabNombre === 'archivo') {
            row += '<td class="fr-num-days" ' + cl + ' title="Fecha de ultima oleada">' + esc(fUltCos) + '</td>';
        }
        if (tabNombre === 'archivo') {
            row += '<td class="fr-num-days" ' + cl + ' title="Fecha de archivado">' + esc(fArchFecha) + '</td>';
        }
        return row + '</tr>';
    }


    // ======================================================
    // BUSQUEDA + ORDENAMIENTO
    // ======================================================

    /**
     * Columnas por tab — cada tab tiene su propio conjunto de columnas.
     * El orden define el orden de izquierda a derecha en el thead.
     * filaTabla(b, tabNombre) emite exactamente las mismas columnas en el mismo orden.
     */
    var _COL_BASE = [
        { key: 'entrada',  label: 'FECHA',      title: 'Ordenar cronologicamente por fecha de armado de la bolsa' },
        { key: 'id',       label: 'ID',         title: 'Ordenar por ID' },
        { key: 'ge',       label: 'GE',         title: 'Ordenar por Genetica' },
        { key: 'su',       label: 'SU',         title: 'Ordenar por lote SU' },
        { key: 'gr',       label: 'GR',         title: 'Ordenar por lote+tanda GR' },
        { key: 'dias',     label: 'Dias',       title: 'Ordenar por dias desde inicio' },
        { key: 'estado',   label: 'Estado',     title: 'Ordenar por estado' },
        { key: 'fn',       label: 'F#',         title: 'Ordenar por cantidad de flushes' },
        { key: 'rend',     label: 'Rend.',      title: 'Ordenar por rendimiento fresco' },
        { key: 'be',       label: 'BE',         title: 'Ordenar por Eficiencia Biologica' },
        { key: 'contpct',  label: 'Cont.%',     title: 'Ordenar por % contaminacion del lote SU' },
        { key: 'diascol',  label: 'Dias Col.',  title: 'Ordenar por dias promedio colonizacion del lote SU' },
        { key: 'ratio',    label: 'Ratio',      title: 'Ordenar por ratio de exito del lote SU' }
    ];
    var _COL_ULT_COSECHA = { key: 'ult_cosecha', label: 'Ult. oleada', title: 'Ordenar por fecha de ultima oleada registrada' };
    var _COL_ARCH_FECHA  = { key: 'arch_fecha',  label: 'Archivado',   title: 'Ordenar por fecha de archivado' };

    // Cosecha + Archivo (2026-07-24, extendido a Archivo el mismo dia): reemplaza
    // las 3 columnas de agregado del lote SU (Cont.%/Dias Col./Ratio — contexto de
    // colonizacion, ya pasado una vez que la bolsa cosecha o se cierra) por
    // rendimiento deshidratado real de la bolsa. Activos sigue mostrando el
    // contexto de SU sin cambios — ahi si importa (bolsa todavia colonizando).
    var _COL_BASE_RESULTADO = _COL_BASE.slice(0, -3).concat([
        { key: 'rendseco',  label: 'Rend. Seco', title: 'Ordenar por rendimiento deshidratado total de la bolsa' },
        { key: 'pctdeshid', label: '% Deshid.',  title: 'Ordenar por % deshidratado sobre el peso fresco' }
    ]);

    var _SORT_COLS = {
        activos: _COL_BASE,
        cosecha: _COL_BASE_RESULTADO.concat([_COL_ULT_COSECHA]),
        archivo: _COL_BASE_RESULTADO.concat([_COL_ULT_COSECHA, _COL_ARCH_FECHA])
    };

    /** Filtra una bolsa segun el termino de busqueda libre. */
    function _frBuscar(b) {
        if (!_frSearch) return true;
        var q = _frSearch.toLowerCase();
        var haystack = [
            b.id        || '',
            b.suLoteId  || '',
            _grTxtFromBolsa(b),
            _geTxtFromBolsa(b)
        ].join(' ').toLowerCase();
        return haystack.indexOf(q) !== -1;
    }

    /** Extrae el valor de ordenamiento de una bolsa para la columna dada. */
    function _sortValue(b, key) {
        var ag;
        if (key === 'entrada')     return b.fechaInicio || b.fechaEntradaFR || _parseFechaFromId(b.id) || '';
        if (key === 'ult_cosecha') {
            var fs = b.flushes || [];
            return fs.reduce(function(max, f) { return (f.fecha || '') > max ? (f.fecha || '') : max; }, b.fechaCosecha || '');
        }
        if (key === 'arch_fecha')  return b.fechaCierreCiclo || b.fechaCancelacion || '';
        if (key === 'id')      return (b.id || '').toLowerCase();
        if (key === 'ge')      return _geTxtFromBolsa(b).toLowerCase();
        if (key === 'su')      return (b.suLoteId || '').toLowerCase();
        if (key === 'gr')      return _grTxtFromBolsa(b).toLowerCase();
        if (key === 'dias')    return (b.cicloCerrado && b.fechaCierreCiclo ? diasEntre(b.fechaInicio, b.fechaCierreCiclo) : diasEntre(b.fechaInicio, hoyISO())) || 0;
        if (key === 'estado')  return computeEstado(b);
        if (key === 'fn')      return (b.flushes || []).length;
        if (key === 'rend')    return rendimientoFresco(b.flushes);
        if (key === 'be')      return beAcumulado(b.flushes);
        if (key === 'contpct') { ag = _aggregadosPorSU(b.suLoteId); return (ag && ag.contPct   != null) ? ag.contPct   : -1; }
        if (key === 'diascol') { ag = _aggregadosPorSU(b.suLoteId); return (ag && ag.diasColAvg != null) ? ag.diasColAvg : -1; }
        if (key === 'ratio')   { ag = _aggregadosPorSU(b.suLoteId); return (ag && ag.ratio      != null) ? ag.ratio      : -1; }
        if (key === 'rendseco') return biomasaSecaTotal(b.flushes);
        if (key === 'pctdeshid') {
            var hum = biomasaHumedaTotal(b.flushes), sec = biomasaSecaTotal(b.flushes);
            return (hum > 0 && sec > 0) ? (sec / hum) * 100 : -1;
        }
        return '';
    }

    /** Ordena una lista de bolsas segun el estado de sort del tab dado. */
    function _frOrdenar(lista, tabNombre) {
        var s = _frSort[tabNombre];
        if (!s || !s.key) return lista;
        return lista.slice().sort(function(a, b) {
            var va = _sortValue(a, s.key);
            var vb = _sortValue(b, s.key);
            var cmp = (typeof va === 'string') ? va.localeCompare(vb) : (va - vb);
            return s.dir === 'asc' ? cmp : -cmp;
        });
    }

    /** Regenera el thead de una tabla con columnas clickeables y flecha de sort activa. */
    function _renderThead(tableId, tabNombre) {
        var table = document.getElementById(tableId);
        if (!table) return;
        var theadTr = table.querySelector('thead tr');
        if (!theadTr) return;
        var s = _frSort[tabNombre] || {};
        var cols = _SORT_COLS[tabNombre] || _COL_BASE;
        var html = '<th style="width:32px;text-align:center" title="Seleccionar"></th>';
        html += cols.map(function(col) {
            var active = (s.key === col.key);
            var arrow  = active ? (s.dir === 'asc' ? ' ↑' : ' ↓') : '';
            var cls    = 'fr-th-sortable' + (active ? ' fr-th-sorted' : '');
            return '<th class="' + cls + '" '
                + 'onclick="FR._setSort(\'' + tabNombre + '\',\'' + col.key + '\')" '
                + 'title="' + esc(col.title) + '">'
                + esc(col.label) + arrow
                + '</th>';
        }).join('');
        theadTr.innerHTML = html;
    }

    /** Cambia el termino de busqueda y re-renderiza los 3 tabs. */
    FR._setSearch = function(val) {
        _frSearch = (val || '').trim();
        renderActivos();
        renderCosecha();
        renderArchivo();
    };

    /** Cambia (o invierte) la columna de sort de un tab y re-renderiza solo ese tab. */
    FR._setSort = function(tabNombre, key) {
        var s = _frSort[tabNombre];
        if (!s) return;
        if (s.key === key) {
            s.dir = (s.dir === 'asc') ? 'desc' : 'asc';
        } else {
            s.key = key;
            s.dir = 'asc';
        }
        if (tabNombre === 'activos') renderActivos();
        if (tabNombre === 'cosecha') renderCosecha();
        if (tabNombre === 'archivo') renderArchivo();
    };

    // ======================================================
    // CONTROLES DE TABLA: filtro SU + selección múltiple
    // ======================================================

    /** Construye las opciones del select de filtro con los lotes SU únicos presentes en bolsas. */
    function _opcionesFiltroSU(lista) {
        var ids = {};
        lista.forEach(function(b) { if (b.suLoteId) ids[b.suLoteId] = true; });
        var opts = '<option value="">— Todos los lotes SU —</option>';
        Object.keys(ids).sort().forEach(function(id) {
            var sel = id === _frFiltroSU ? ' selected' : '';
            opts += '<option value="' + esc(id) + '"' + sel + '>' + esc(id) + '</option>';
        });
        return opts;
    }

    /**
     * Inyecta (o actualiza) la barra de controles encima de la tabla.
     * Busca el .section-content que contiene el tbody dado y mete los controles
     * antes del .table-wrap, usando clases CSS propias (no inline styles).
     */
    function _renderControlesTabla(controlId, tbodyId, listaTodas) {
        var tbody = document.getElementById(tbodyId);
        if (!tbody) return;
        // Subir: tbody → table → .table-wrap → .section-content
        var tableWrap = tbody.closest('.table-wrap');
        if (!tableWrap) return;
        var sectionContent = tableWrap.parentNode;
        if (!sectionContent) return;

        var ctrl = document.getElementById(controlId);
        var isFirstRender = !ctrl;
        if (isFirstRender) {
            ctrl = document.createElement('div');
            ctrl.id = controlId;
            ctrl.className = 'fr-tabla-controles';
            sectionContent.insertBefore(ctrl, tableWrap);
        }

        if (isFirstRender) {
            // Primer render: construir el DOM completo.
            ctrl.innerHTML =
                '<input type="search" class="fr-search-input"'
                +   ' placeholder="Buscar: ID, SU, GR, Genetica..."'
                +   ' value="' + esc(_frSearch) + '"'
                +   ' oninput="FR._setSearch(this.value)"'
                +   ' title="Buscar por ID FR, lote SU, lote+tanda GR o genetica">'
                + '<select onchange="FR._setFiltroSU(this.value)">'
                +   _opcionesFiltroSU(listaTodas)
                + '</select>'
                + '<label>'
                +   '<input type="checkbox" onchange="FR._selTodo(\'' + tbodyId + '\',this.checked)"> Sel. todo'
                + '</label>'
                + '<button class="fr-btn-del-sel" id="' + controlId + '_btnDel" '
                +   'onclick="FR.eliminarSeleccionados(\'' + tbodyId + '\')">'
                +   '🗑 Eliminar seleccionados (0)'
                + '</button>'
                + '<button class="fr-btn-limpiar" '
                +   'onclick="FR.limpiezaProfundaFR()" title="Elimina bolsas sin trazabilidad SU+GR válida">'
                +   '🧹 Limpiar sin trazabilidad'
                + '</button>';
        } else {
            // Renders subsiguientes: actualización quirúrgica.
            // CRÍTICO: NO reconstruir innerHTML completo — mataría el focus del input
            // si el usuario está escribiendo en el buscador.
            // Solo actualizamos las opciones del <select> (cambian al sincronizar lotes SU)
            // y el valor del input de búsqueda SOLO si no tiene el focus.
            var selEl = ctrl.querySelector('select');
            if (selEl) selEl.innerHTML = _opcionesFiltroSU(listaTodas);
            var searchEl = ctrl.querySelector('.fr-search-input');
            if (searchEl && document.activeElement !== searchEl) {
                searchEl.value = _frSearch;
            }
        }
    }

    /** Actualiza texto y visibilidad del botón eliminar según checkboxes marcados. */
    FR._actualizarContadorSel = function(tabla) {
        if (!tabla) return;
        var checked = tabla.querySelectorAll('.fr-sel-cb:checked').length;
        // El div de controles es el hermano anterior al .table-wrap que contiene la tabla
        var tableWrap = tabla.closest('.table-wrap');
        if (!tableWrap) return;
        var ctrl = tableWrap.previousElementSibling;
        if (!ctrl || !ctrl.classList.contains('fr-tabla-controles')) return;
        var btn = ctrl.querySelector('.fr-btn-del-sel');
        if (!btn) return;
        if (checked > 0) {
            btn.style.display = '';
            btn.textContent = '🗑 Eliminar seleccionados (' + checked + ')';
        } else {
            btn.style.display = 'none';
        }
    };

    /** Selecciona / deselecciona todos los checkboxes de una tabla. */
    FR._selTodo = function(tbodyId, checked) {
        var tbody = document.getElementById(tbodyId);
        if (!tbody) return;
        tbody.querySelectorAll('.fr-sel-cb').forEach(function(cb) { cb.checked = checked; });
        FR._actualizarContadorSel(tbody.closest('table'));
    };

    /** Cambia el filtro de lote SU y vuelve a renderizar. */
    FR._setFiltroSU = function(val) {
        _frFiltroSU = val || '';
        renderActivos();
        renderCosecha();
        renderArchivo();
    };

    /** Elimina en lote las bolsas seleccionadas con checkbox en una tabla. */
    FR.eliminarSeleccionados = function(tbodyId) {
        var tbody = document.getElementById(tbodyId);
        if (!tbody) return;
        var cbs = tbody.querySelectorAll('.fr-sel-cb:checked');
        if (cbs.length === 0) return;
        var ids = [];
        cbs.forEach(function(cb) { if (cb.dataset.frId) ids.push(cb.dataset.frId); });
        if (!confirm('¿Eliminar ' + ids.length + ' registro(s) FR?\n\n' + ids.join('\n') + '\n\nEsta acción no se puede deshacer.')) return;
        var elimSet = {};
        ids.forEach(function(id) { elimSet[id] = true; });
        bolsas = bolsas.filter(function(b) { return !elimSet[b.id]; });
        if (selectedId && elimSet[selectedId]) { selectedId = null; }
        saveBolsas();
        renderAll();
    };

    /**
     * Elimina bolsas sin trazabilidad completa:
     * sin suLoteId, o sin grLoteId, o sin grTandaId.
     * Equivalente al 🧹 de GR y SU.
     */
    FR.limpiezaProfundaFR = function() {
        var invalidas = bolsas.filter(function(b) {
            return !b.suLoteId || !b.grLoteId || !b.grTandaId;
        });
        if (invalidas.length === 0) {
            alert('✅ No hay bolsas sin trazabilidad. FR está limpio.');
            return;
        }
        var lista = invalidas.map(function(b) {
            var razon = !b.suLoteId ? 'sin suLoteId' : !b.grLoteId ? 'sin grLoteId' : 'sin grTandaId';
            return '• ' + b.id + ' — ' + razon;
        }).join('\n');
        if (!confirm('⚠️ ' + invalidas.length + ' bolsa(s) sin trazabilidad completa:\n\n' + lista + '\n\n¿Eliminarlas?')) return;
        var set = {};
        invalidas.forEach(function(b) { set[b.id] = true; });
        bolsas = bolsas.filter(function(b) { return !set[b.id]; });
        if (selectedId && set[selectedId]) { selectedId = null; }
        saveBolsas();
        renderAll();
        alert('✅ ' + invalidas.length + ' bolsa(s) eliminada(s).');
    };

    function renderActivos() {
        var tbody = document.getElementById('frActivosBody');
        if (!tbody) return;
        // Invalidar cache de agregados por SU al iniciar el render
        // (los datos de bolsas pueden haber cambiado).
        _aggSUCache = null;
        var todasEnCultivo = bolsas.filter(esEnCultivo);
        var enCultivo = _frFiltroSU
            ? todasEnCultivo.filter(function(b) { return b.suLoteId === _frFiltroSU; })
            : todasEnCultivo;
        enCultivo = enCultivo.filter(_frBuscar);
        enCultivo = _frOrdenar(enCultivo, 'activos');
        _renderControlesTabla('frControlesActivos', 'frActivosBody', todasEnCultivo);
        _renderThead('frActivosTable', 'activos');
        if (enCultivo.length === 0) {
            tbody.innerHTML = '<tr><td colspan="14" class="fr-empty">'
                + (_frSearch
                    ? 'Sin resultados para "' + esc(_frSearch) + '" en bolsas activas.'
                    : _frFiltroSU
                        ? 'Sin bolsas en cultivo para el lote SU "' + esc(_frFiltroSU) + '".'
                        : 'Sin bolsas en cultivo. Usa Sync desde SU para traerlas.')
                + '</td></tr>';
        } else {
            tbody.innerHTML = enCultivo.map(function(b) { return filaTabla(b, 'activos'); }).join('');
        }

        // ── KPIs de Activos ──────────────────────────────────────────────────
        // Genéticas únicas: usa b.genetica (no fenotipo) para contar genéticas base
        var _genSet = {};
        todasEnCultivo.forEach(function(b) {
            // Prioridad: b.genetica → primer segmento de geneticaFull → descartado si vacío
            var gKey = (b.genetica || '').trim();
            if (!gKey && b.geneticaFull) {
                gKey = b.geneticaFull.split('/')[0].replace(/psilocybe cubensis/gi, 'PC').trim();
            }
            if (gKey) _genSet[gKey] = true;
        });
        set('frKpiActGeneticas', Object.keys(_genSet).length || '—');
        set('frKpiActActivas', todasEnCultivo.length);

        // Peso teórico promedio (bolsas activas con datos suficientes)
        var _pesosTeo = todasEnCultivo.map(function(b) {
            return computePrecosechaMetrics(b).teorico;
        }).filter(function(v) { return v != null && v > 0; });
        var _pesoTeoAvg = _pesosTeo.length > 0
            ? _pesosTeo.reduce(function(a, v) { return a + v; }, 0) / _pesosTeo.length
            : null;
        set('frKpiActPesoTeorico', _pesoTeoAvg != null ? fmt(_pesoTeoAvg, 0) + ' g' : '—');

        // Pinning (del total de activas, no del filtro)
        var _pinActN = todasEnCultivo.filter(function(b) { return computeEstado(b) === 'pinning'; }).length;
        set('frKpiActPinning', _pinActN || '—');
    }

    function renderCosecha() {
        var tbody = document.getElementById('frCosechaBody');
        if (!tbody) return;
        var todasCosecha = bolsas.filter(esCosecha);
        var lista = _frFiltroSU
            ? todasCosecha.filter(function(b) { return b.suLoteId === _frFiltroSU; })
            : todasCosecha;
        lista = lista.filter(_frBuscar);
        lista = _frOrdenar(lista, 'cosecha');
        _renderControlesTabla('frControlesCosecha', 'frCosechaBody', todasCosecha);
        _renderThead('frCosechaTable', 'cosecha');
        if (lista.length === 0) {
            tbody.innerHTML = '<tr><td colspan="15" class="fr-empty">'
                + (_frSearch
                    ? 'Sin resultados para "' + esc(_frSearch) + '" en bolsas en cosecha.'
                    : _frFiltroSU
                        ? 'Sin bolsas en cosecha para el lote SU "' + esc(_frFiltroSU) + '".'
                        : 'Sin bolsas en cosecha. Cuando una bolsa registre su primera oleada, aparecerá acá.')
                + '</td></tr>';
        } else {
            tbody.innerHTML = lista.map(function(b) { return filaTabla(b, 'cosecha'); }).join('');
        }

        // ── KPIs de cosecha ──────────────────────────────────────────────────
        // Tiempo promedio: días desde fechaInicio hasta fechaCosecha
        var _tiempos = todasCosecha
            .filter(function(b) { return b.fechaInicio && b.fechaCosecha; })
            .map(function(b) { return diasEntre(b.fechaInicio, b.fechaCosecha); })
            .filter(function(d) { return d != null && d > 0; });
        var tiempoAvg = _tiempos.length > 0
            ? _tiempos.reduce(function(a, v) { return a + v; }, 0) / _tiempos.length
            : null;
        set('frKpiCosechaTime', tiempoAvg != null ? Math.round(tiempoAvg) + ' d' : '—');

        // BE promedio de bolsas en cosecha
        var _besCosecha = todasCosecha
            .map(function(b) { return beAcumulado(b.flushes); })
            .filter(function(v) { return v > 0; });
        var beAvgCosecha = _besCosecha.length > 0
            ? _besCosecha.reduce(function(a, v) { return a + v; }, 0) / _besCosecha.length
            : 0;
        set('frKpiCosechaBE', beAvgCosecha > 0 ? fmt(beAvgCosecha, 1) + '%' : '—');

        // Biomasa seca total del sistema (todas las bolsas, no solo cosecha)
        var _bioSecaTotal = bolsas.reduce(function(acc, b) {
            return acc + biomasaSecaTotal(b.flushes);
        }, 0);
        set('frKpiBioSeca', _bioSecaTotal > 0 ? fmt(_bioSecaTotal, 1) + ' g' : '—');

        // Húmeda promedio (bolsas en cosecha con al menos un húmedo)
        var _humedas = todasCosecha
            .map(function(b) { return biomasaHumedaTotal(b.flushes); })
            .filter(function(v) { return v > 0; });
        var humedaAvg = _humedas.length > 0
            ? _humedas.reduce(function(a, v) { return a + v; }, 0) / _humedas.length
            : null;
        set('frKpiCosechaHumeda', humedaAvg != null ? fmt(humedaAvg, 1) + ' g' : '—');

        // Seca promedio (bolsas en cosecha con al menos un seco)
        var _secas = todasCosecha
            .map(function(b) { return biomasaSecaTotal(b.flushes); })
            .filter(function(v) { return v > 0; });
        var secaAvg = _secas.length > 0
            ? _secas.reduce(function(a, v) { return a + v; }, 0) / _secas.length
            : null;
        set('frKpiCosechaSeca', secaAvg != null ? fmt(secaAvg, 1) + ' g' : '—');

        // Tiempo productivo: días desde fechaInicio hasta último flush con seco (todas las bolsas con seco)
        var _diasProd = bolsas
            .filter(function(b) { return biomasaSecaTotal(b.flushes) > 0 && b.fechaInicio; })
            .map(function(b) {
                var flushesConSeco = (b.flushes || []).filter(function(f) { return f.pesoSeco != null; });
                if (flushesConSeco.length === 0) return null;
                var ultimo = flushesConSeco[flushesConSeco.length - 1];
                var fechaFin = ultimo.finDeshidratacion || ultimo.fecha;
                if (!fechaFin) return null;
                return diasEntre(b.fechaInicio, fechaFin);
            })
            .filter(function(d) { return d != null && d > 0; });
        var diasProdAvg = _diasProd.length > 0
            ? _diasProd.reduce(function(a, v) { return a + v; }, 0) / _diasProd.length
            : null;
        set('frKpiDiasProduccion', diasProdAvg != null ? Math.round(diasProdAvg) + ' d' : '—');
    }

    function renderArchivo() {
        var tbody = document.getElementById('frArchivoBody');
        if (!tbody) return;
        var todasArch = bolsas.filter(esArchivada);
        var archivadas = _frFiltroSU
            ? todasArch.filter(function(b) { return b.suLoteId === _frFiltroSU; })
            : todasArch;
        archivadas = archivadas.filter(_frBuscar);
        archivadas = _frOrdenar(archivadas, 'archivo');
        _renderControlesTabla('frControlesArchivo', 'frArchivoBody', todasArch);
        _renderThead('frArchivoTable', 'archivo');
        if (archivadas.length === 0) {
            tbody.innerHTML = '<tr><td colspan="16" class="fr-empty">'
                + (_frSearch
                    ? 'Sin resultados para "' + esc(_frSearch) + '" en el archivo.'
                    : _frFiltroSU
                        ? 'Sin archivo para el lote SU "' + esc(_frFiltroSU) + '".'
                        : 'Archivo vacío. Bolsas contaminadas o con ciclo cerrado aparecen acá.')
                + '</td></tr>';
        } else {
            tbody.innerHTML = archivadas.map(function(b) { return filaTabla(b, 'archivo'); }).join('');
        }
    }

    // ======================================================
    // MÉTRICAS DE PRECOSECHA
    // ======================================================

    /**
     * Calcula las métricas derivadas de pesoPrecosecha:
     *   teorico   = pesoHumedoHidratado + granoPorBolsa   (null si ambos son null/0)
     *   perdidaML = teorico - pesoPrecosecha              (null si falta alguno)
     *   perdidaPct= perdidaML / teorico * 100             (null si teorico = 0)
     *
     * NOTA BIOLÓGICA: perdidaML ≈ mL perdidos porque ρ(agua) ≈ 1 g/mL.
     * Mide el agua evaporada + CO₂ respirado entre inoculación y precosecha.
     * Un valor negativo indicaría absorción de humedad ambiental (condensación).
     */
    function computePrecosechaMetrics(b) {
        if (!b) return { teorico: null, perdidaML: null, perdidaPct: null };
        var hidratado  = (b.pesoHumedoHidratado != null) ? num(b.pesoHumedoHidratado) : 0;
        var grano      = (b.granoPorBolsa        != null) ? num(b.granoPorBolsa)        : 0;
        var tieneDatos = (b.pesoHumedoHidratado != null || b.granoPorBolsa != null);
        var teorico    = tieneDatos ? hidratado + grano : null;
        var precosecha = (b.pesoPrecosecha != null) ? num(b.pesoPrecosecha) : null;
        // Requiere precosecha > 0 y teorico conocido para calcular pérdida.
        // No imponemos límite inferior: dejamos valores negativos (condensación).
        var perdidaML  = (teorico != null && precosecha != null) ? teorico - precosecha : null;
        var perdidaPct = (perdidaML != null && teorico != null && teorico > 0)
            ? (perdidaML / teorico) * 100 : null;
        return { teorico: teorico, perdidaML: perdidaML, perdidaPct: perdidaPct };
    }

    /**
     * Actualización selectiva del bloque de precosecha en el DOM.
     * Llamado desde renderDashboard y desde updateField cuando cambian
     * pesoHumedoHidratado, granoPorBolsa o pesoPrecosecha.
     * NO reconstruye el dashboard completo para preservar el foco del usuario.
     */
    function _renderPrecosechaMetrics(b) {
        if (!b) return;
        var m = computePrecosechaMetrics(b);

        // Peso total teórico — campo bloqueado, siempre sobreescribible
        var elTeorico = document.getElementById('frPesoTotalTeorico');
        if (elTeorico) {
            elTeorico.value = (m.teorico != null && m.teorico > 0)
                ? fmt(m.teorico, 1) : '';
        }

        // Peso pre-cosecha — solo sincronizar si el campo no tiene foco
        // (evitar pisar lo que el usuario está escribiendo)
        var elPrec = document.getElementById('frPesoPrecosecha');
        if (elPrec && document.activeElement !== elPrec) {
            elPrec.value = (b.pesoPrecosecha != null) ? b.pesoPrecosecha : '';
        }

        // Métricas calculadas
        set('frMPerdidaML',
            m.perdidaML != null ? fmt(Math.abs(m.perdidaML), 1) + ' g' +
                (m.perdidaML < 0 ? ' ▲' : '') : '—');
        set('frMPerdidaPct',
            m.perdidaPct != null ? fmt(Math.abs(m.perdidaPct), 1) + '%' +
                (m.perdidaPct < 0 ? ' ▲' : '') : '—');

        // Colorear la card de % según magnitud de pérdida (visual semáforo)
        var cardPct = document.querySelector('.fr-metric-perdida-pct');
        if (cardPct) {
            cardPct.classList.remove('fr-color-ok', 'fr-color-warn', 'fr-color-bad');
            if (m.perdidaPct != null) {
                var pct = m.perdidaPct;
                if (pct < 0) {
                    // Ganó humedad (condensación) — neutro, sin clase de color
                } else if (pct < 10) {
                    cardPct.classList.add('fr-color-ok');
                } else if (pct < 20) {
                    cardPct.classList.add('fr-color-warn');
                } else {
                    cardPct.classList.add('fr-color-bad');
                }
            }
        }
    }

    // ======================================================
    // RENDER: DASHBOARD
    // ======================================================
    function getSelected() {
        if (!selectedId) return null;
        for (var i = 0; i < bolsas.length; i++) if (bolsas[i].id === selectedId) return bolsas[i];
        return null;
    }

    function set(id, val) {
        var el = document.getElementById(id);
        if (el) el.textContent = (val == null || val === '') ? '—' : String(val);
    }
    function setInput(id, val) {
        var el = document.getElementById(id);
        if (el) el.value = (val == null) ? '' : val;
    }

    function renderDashboard() {
        var empty = document.getElementById('frDashEmpty');
        var dash = document.getElementById('frDash');
        var b = getSelected();

        if (!b) {
            if (empty) {
                empty.style.display = '';
                // Reemplazar el hint estático con la vista general viva.
                // Se re-renderiza en cada renderDashboard() para reflejar
                // cambios de estado (sync, flushes, cierre de ciclo, etc.)
                renderOverview(empty);
            }
            if (dash) dash.style.display = 'none';
            var _syncBtnHide = document.getElementById('frSyncBtn');
            if (_syncBtnHide) _syncBtnHide.style.display = 'none';
            return;
        }
        if (empty) empty.style.display = 'none';
        if (dash) dash.style.display = '';

        // ── ID editable ───────────────────────────────────────────────────────
        // El contenedor #frDashTitle aloja el widget en lugar de texto plano.
        // Se reconstruye en cada render del dashboard para reflejar el valor
        // actual de b.id y volver al modo solo-lectura si venía de un rename.
        var titleEl = document.getElementById('frDashTitle');
        if (titleEl) {
            var huerfanaBadge = b.origen === 'huerfana'
                ? ' <span class="fr-chip fr-chip-huerfana" title="Cargada manualmente">H</span>'
                : '';
            titleEl.innerHTML =
                '<span id="frIdDisplay" class="fr-id-display">' + esc(b.id) + '</span>'
                + huerfanaBadge
                + ' <button id="frIdEditBtn" class="btn-small fr-id-edit-btn"'
                +   ' onclick="FR.activarEdicionId()" title="Renombrar ID de bolsa">&#9998;</button>'
                + '<input id="frIdInput" class="fr-id-input" type="text"'
                +   ' value="' + esc(b.id) + '" maxlength="40" style="display:none;width:130px"'
                +   ' onkeydown="if(event.key===\'Enter\'){event.preventDefault();FR.confirmarRenombreId();}'
                +              'if(event.key===\'Escape\'){event.preventDefault();FR.cancelarRenombreId();}">'
                + '<button id="frIdConfirmBtn" class="btn-small fr-id-confirm-btn"'
                +   ' style="display:none" onclick="FR.confirmarRenombreId()" title="Guardar nuevo ID">&#10003;</button>'
                + '<button id="frIdCancelBtn" class="btn-small fr-id-cancel-btn"'
                +   ' style="display:none" onclick="FR.cancelarRenombreId()" title="Cancelar">&#10007;</button>';
        }
        var estado = computeEstado(b);
        var _DASH_ESTADO_LABELS = { 'ciclo cerrado': 'FIN DEL CICLO' };
        var stEl = document.getElementById('frDashState');
        if (stEl) {
            stEl.textContent = _DASH_ESTADO_LABELS[estado] || estado;
            stEl.className = 'fr-chip ' +
                (estado === 'colonizando'  ? 'fr-chip-warn' :
                 estado === 'colonizado'   ? 'fr-chip-ok' :
                 estado === 'pinning'      ? 'fr-chip-warn' :
                 estado === 'cosechado'    ? 'fr-chip-ok' :
                 estado === 'ciclo cerrado'? 'fr-chip-fin-ciclo' :
                 estado === 'contaminada'  ? 'fr-chip-bad' :
                 'fr-chip-neutral');
        }
        // 🧬 Identidad — árbol ASCII (línea genética + traza productiva)
        renderIdTree(b);
        if (typeof window.traceEnhanceFrIdTree === 'function') {
            try { window.traceEnhanceFrIdTree(); } catch (e) {}
        }

        // Mostrar/ocultar botón sync — solo para bolsas confirmadas (no pendientes)
        var _syncBtn = document.getElementById('frSyncBtn');
        if (_syncBtn) _syncBtn.style.display = esPendiente(b) ? 'none' : '';

        setInput('frFechaInicio', b.fechaInicio || '');
        setInput('frFechaColon', b.fechaColonizacion || '');
        setInput('frFechaPines', b.fechaPines || '');
        setInput('frFechaCosecha', b.fechaCosecha || '');

        var hoy = hoyISO();
        var fechaRef = b.cicloCerrado && b.fechaCierreCiclo ? b.fechaCierreCiclo : hoy;
        var d0 = diasEntre(b.fechaInicio, fechaRef);
        set('frDayNow', d0 != null ? d0 : 0);
        set('frDaysInicio', b.fechaInicio ? (d0 > 0 ? ('hace ' + d0 + ' d') : 'hoy') : '—');
        set('frDaysColon', b.fechaColonizacion ? ('dia ' + (diasEntre(b.fechaInicio, b.fechaColonizacion) || 0)) : 'pendiente');
        set('frDaysPines',  b.fechaPines       ? ('dia ' + (diasEntre(b.fechaInicio, b.fechaPines) || 0))       : 'pendiente');
        set('frDaysCosecha',b.fechaCosecha     ? ('dia ' + (diasEntre(b.fechaInicio, b.fechaCosecha) || 0))     : 'pendiente');

        setInput('frPesoSustratoSeco', b.pesoSustratoSeco != null ? fmt(b.pesoSustratoSeco, 1) : '');
        setInput('frPesoHidratado', b.pesoHumedoHidratado != null ? fmt(b.pesoHumedoHidratado, 1) : '');
        setInput('frGranoBolsa', b.granoPorBolsa != null ? fmt(b.granoPorBolsa, 1) : '');

        // Métricas de precosecha (teórico, pre-cosecha, pérdida de humedad)
        _renderPrecosechaMetrics(b);

        // Bolsa huérfana: habilitar edición de sustrato seco y grano (no vienen de SU/GR)
        var elSeco = document.getElementById('frPesoSustratoSeco');
        var elGrano = document.getElementById('frGranoBolsa');
        var bannerEl = document.getElementById('frHuerfanaBanner');
        if (b.origen === 'huerfana') {
            if (elSeco) {
                elSeco.disabled = false;
                elSeco.title = 'Bolsa huérfana: editá el valor directamente';
                elSeco.className = elSeco.className.replace('fr-dash-locked', '').trim();
                elSeco.onchange = function() { FR.updateField('pesoSustratoSeco', this.value); };
            }
            if (elGrano) {
                elGrano.disabled = false;
                elGrano.title = 'Bolsa huérfana: editá el valor directamente';
                elGrano.className = elGrano.className.replace('fr-dash-locked', '').trim();
                elGrano.onchange = function() {
                    FR.updateField('granoPorBolsa', this.value);
                };
            }
            if (bannerEl) bannerEl.style.display = '';
        } else {
            if (elSeco) {
                elSeco.disabled = true;
                elSeco.title = 'No editable — viene de SU (lote.fibra / bolsas)';
                if (!elSeco.className.includes('fr-dash-locked')) elSeco.className += ' fr-dash-locked';
                elSeco.onchange = null;
            }
            if (elGrano) {
                elGrano.disabled = true;
                elGrano.title = 'No editable — viene de GR';
                if (!elGrano.className.includes('fr-dash-locked')) elGrano.className += ' fr-dash-locked';
                elGrano.onchange = null;
            }
            if (bannerEl) bannerEl.style.display = 'none';
        }

        var be = beAcumulado(b.flushes);
        var bioHum = biomasaHumedaTotal(b.flushes);
        var bioSec = biomasaSecaTotal(b.flushes);
        var ttrab = tiempoTrabajoTotal(b);
        set('frMBioHum', bioHum > 0 ? fmt(bioHum, 1) + ' g' : '—');
        set('frMBioSec', bioSec > 0 ? fmt(bioSec, 1) + ' g' : '—');
        set('frMBE', be > 0 ? fmt(be, 1) + '%' : '—');
        if (ttrab != null) {
            var dias = Math.floor(ttrab / 24);
            var horas = Math.round(ttrab - dias * 24);
            set('frMTiempoTrabajo', dias + 'd ' + horas + 'h');
        } else {
            set('frMTiempoTrabajo', '—');
        }

        var nextFlush = (b.flushes || []).length + 1;
        set('frFlushCurrent', nextFlush);
        var fbody = document.getElementById('frFlushBody');
        if (fbody) {
            if (!b.flushes || b.flushes.length === 0) {
                fbody.innerHTML = '<tr><td colspan="11" class="fr-empty">Sin oleadas aun.</td></tr>';
            } else {
                fbody.innerHTML = b.flushes.map(function(f, idx) {
                    var pctBio = pctBiomasaFlush(f);
                    var pctBioTxt = (pctBio != null) ? fmt(pctBio, 1) + '%' : '—';
                    var hV = (f.pesoHumedo != null) ? f.pesoHumedo : '';
                    var sV = (f.pesoSeco != null) ? f.pesoSeco : '';
                    var dV = f.fecha || '';
                    var finV = f.finDeshidratacion || '';
                    // Always-on inline editing: every row is editable with inputs.
                    // Changes commit via FR.editFlush(idx). Per-row delete.
                    var calidad = f.calidad || null;
                    var calAutoHtml = calidad
                        ? '<span class="fr-cal-badge fr-cal-badge-' + _frCalScoreClass(calidad.scoreAuto) + '">' + calidad.scoreAuto + '</span>'
                        : '<span class="fr-cal-badge fr-cal-badge-none">—</span>';
                    var calPersonalTxt = (calidad && calidad.scorePersonal != null) ? calidad.scorePersonal + '/10' : '—';
                    var calBtnTxt = calidad ? '✓ Cal.' : 'Evaluar';
                    var calBtnClass = calidad ? 'fr-cal-btn fr-cal-btn-done' : 'fr-cal-btn';
                    return '<tr class="fr-flush-row">'
                        + '<td><strong>F' + f.n + '</strong></td>'
                        + '<td><input type="datetime-local" class="fr-dash-input fr-flush-inline" id="frFlushF_' + idx + '" value="' + esc(dV) + '" onchange="FR.editFlush(' + idx + ')"></td>'
                        + '<td><input type="number" step="0.1" class="fr-dash-input fr-flush-inline" id="frFlushH_' + idx + '" value="' + esc(hV) + '" placeholder="g" onchange="FR.editFlush(' + idx + ')"></td>'
                        + '<td><input type="datetime-local" class="fr-dash-input fr-flush-inline" id="frFlushFin_' + idx + '" value="' + esc(finV) + '" onchange="FR.editFlush(' + idx + ')"></td>'
                        + '<td><input type="number" step="0.1" class="fr-dash-input fr-flush-inline" id="frFlushS_' + idx + '" value="' + esc(sV) + '" placeholder="g" onchange="FR.editFlush(' + idx + ')"></td>'
                        + '<td id="frFlushPct_' + idx + '">' + pctBioTxt + '</td>'
                        + '<td id="frFlushBEo_' + idx + '">' + fmt(f.beOleada, 1) + '%</td>'
                        + '<td id="frFlushBEa_' + idx + '">' + fmt(f.beAcumulado, 1) + '%</td>'
                        + '<td>' + calAutoHtml + '</td>'
                        + '<td style="color:#ffb83f;font-size:0.82rem;">' + calPersonalTxt + '</td>'
                        + '<td class="fr-flush-acciones">'
                        +   '<button type="button" class="' + calBtnClass + '" onclick="FR.openCalidad(' + idx + ')">' + calBtnTxt + '</button>'
                        +   '<button type="button" class="fr-btn-icon fr-btn-del" title="Eliminar oleada F' + f.n + '" onclick="FR.deleteFlush(' + idx + ')">&#128465;</button>'
                        + '</td>'
                        + '</tr>';
                }).join('');
            }
        }

        var alertDiv = document.getElementById('frAnomalyAlert');
        if (alertDiv) {
            alertDiv.innerHTML = (_frCalState.lastAlert && _frCalState.lastAlertId === b.id)
                ? _frCalRenderAnomalyCard(_frCalState.lastAlert)
                : '';
        }

        // Estado de los botones de acción terminal (Contaminación + Cerrar ciclo)
        var btnContam = document.getElementById('frBtnContam');
        var btnCerrar = document.getElementById('frBtnCerrar');
        var infoContam = document.getElementById('frContamInfo');

        if (b.contaminada === true) {
            if (btnContam) {
                btnContam.disabled = true;
                btnContam.textContent = '\u2620 Contaminada';
            }
            if (btnCerrar) {
                btnCerrar.disabled = true;
                btnCerrar.textContent = '\u23F9 Cerrar ciclo';
            }
            if (infoContam) {
                infoContam.classList.add('is-contam');
                infoContam.classList.remove('is-cerrado');
                var fc = b.fechaContaminacion ? fmtFecha(b.fechaContaminacion) : '';
                infoContam.textContent = 'Bolsa contaminada' + (fc ? ' el ' + fc : '') + ' \u00b7 Archivada';
            }
        } else if (b.cicloCerrado === true) {
            if (btnContam) {
                btnContam.disabled = true;
                btnContam.textContent = '\uD83D\uDD34 Contaminaci\u00f3n';
            }
            if (btnCerrar) {
                btnCerrar.disabled = false;
                btnCerrar.textContent = '\u21A9 Reabrir ciclo';
            }
            if (infoContam) {
                infoContam.classList.remove('is-contam');
                infoContam.classList.add('is-cerrado');
                var fcc = b.fechaCierreCiclo ? fmtFecha(b.fechaCierreCiclo) : '';
                infoContam.textContent = 'Ciclo cerrado' + (fcc ? ' el ' + fcc : '') + ' \u00b7 Archivada';
            }
        } else {
            if (btnContam) {
                btnContam.disabled = false;
                btnContam.textContent = '\uD83D\uDD34 Contaminaci\u00f3n';
            }
            if (btnCerrar) {
                btnCerrar.disabled = false;
                btnCerrar.textContent = '\u23F9 Cerrar ciclo';
            }
            if (infoContam) {
                infoContam.classList.remove('is-contam');
                infoContam.classList.remove('is-cerrado');
                infoContam.textContent = '';
            }
        }

        renderObs(b);
    }

    // ======================================================
// ======================================================
    // RENDER · IDENTIDAD — Árbol ASCII + Grafo Visual
    // ======================================================

    // _resolverGEChain eliminado: la identidad de FR usa solo datos sellados en la bolsa.

    /** Estado legible de una bolsa FR. */
    function _frIdentEstado(b) {
        if (!b) return 'sin datos';
        if (esPendiente(b)) return 'pendiente';
        if (b.cancelada)             return 'cancelada';
        if (b.contaminada)           return 'contaminada';
        if (b.cicloCerrado)          return 'ciclo cerrado';
        if (Array.isArray(b.flushes) && b.flushes.length > 0) return 'cosechado';
        if (b.fechaCosecha)          return 'cosechado';
        if (b.fechaPines)            return 'pinning';
        if (b.fechaColonizacion)     return 'colonizado';
        return 'colonizando';
    }
    function _frIdentEstadoClass(estado) {
        var map = {
            'cosechado':    'ok',  'colonizado':  'col',
            'pinning':      'pin', 'colonizando': 'act',
            'contaminada':  'err', 'cancelada':   'err',
            'ciclo cerrado':'arc', 'pendiente':   'pend'
        };
        return 'frt-badge-' + (map[estado] || 'act');
    }

    /**
     * Construye el snapshot de datos para IDENTIDAD.
     * Fuente exclusiva: campos sellados en la bolsa (b).
     * No lee SU, GR, GE ni CI en tiempo real.
     */
    function _frIdentBuildData(b) {
        // Genética: usar cadena ya guardada, sin navegar el grafo GE
        var genLabel = null;
        var full = (b.geneticaFull || '').trim();
        if (full) {
            genLabel = _abbrevGen(full);
        } else if (b.genetica || b.fenotipo) {
            genLabel = _abbrevGen([b.genetica, b.fenotipo].filter(Boolean).join(' / '));
        }

        // Flushes
        var flushes = Array.isArray(b.flushes) ? b.flushes : [];
        var totalHumedo = 0;
        for (var fi = 0; fi < flushes.length; fi++) {
            totalHumedo += parseFloat(flushes[fi].pesoHumedo) || 0;
        }
        var beAcum = flushes.length > 0
            ? (flushes[flushes.length - 1].beAcumulado || null) : null;

        // Lookup GR lotes → componentes (cereal) — one localStorage read, handles multi-source
        var grLoteComponentesMap = {};
        try {
            var _grLoteIds = [];
            if (b.grLoteId) _grLoteIds.push(b.grLoteId);
            if (Array.isArray(b.grSources)) {
                b.grSources.forEach(function(s) {
                    if (s.grLoteId && _grLoteIds.indexOf(s.grLoteId) < 0)
                        _grLoteIds.push(s.grLoteId);
                });
            }
            if (_grLoteIds.length > 0) {
                var _grAll = JSON.parse(localStorage.getItem(GR_KEY) || '[]');
                _grAll.forEach(function(l) {
                    if (_grLoteIds.indexOf(l.id) >= 0
                            && Array.isArray(l.componentes) && l.componentes.length > 0) {
                        grLoteComponentesMap[l.id] = l.componentes;
                    }
                });
            }
        } catch (_e) {}

        // Lookup SU lote → aditivos[], normalizados por bolsa.
        // aditivos[].cantidad en su_lotes es el total del LOTE (puede repartirse
        // en varias bolsas, ej. SU26 → 380g fibra / 2 bolsas). pesoSustratoSeco
        // en la bolsa YA está dividido por bolsa (ver sustratoPorBolsa más arriba
        // en este archivo) — se usa esa misma proporción (bolsa/lote) para
        // escalar cada aditivo, en vez de mostrar el total del lote como si
        // fuera de una sola bolsa (bug real encontrado 2026-07-22: mostraba
        // 150g de café molido en una bolsa cuyo sustrato real era 190g de 380g
        // totales del lote — la dosis real por bolsa era 75g).
        var suLoteAditivos = null;
        try {
            if (b.suLoteId) {
                var _suAll = JSON.parse(localStorage.getItem(SU_KEY) || '[]');
                for (var _si = 0; _si < _suAll.length; _si++) {
                    if (_suAll[_si].id === b.suLoteId) {
                        var _loteSU = _suAll[_si];
                        var _sa = _loteSU.aditivos;
                        if (Array.isArray(_sa) && _sa.length > 0) {
                            var _fibraLote = parseFloat(_loteSU.fibra) || 0;
                            var _factorBolsa = (_fibraLote > 0 && b.pesoSustratoSeco > 0)
                                ? (b.pesoSustratoSeco / _fibraLote) : null;
                            suLoteAditivos = _sa.map(function(ad) {
                                var cantLote = parseFloat(ad.cantidad) || 0;
                                return Object.assign({}, ad, {
                                    cantidad: (_factorBolsa != null && cantLote > 0) ? cantLote * _factorBolsa : null
                                });
                            });
                        }
                        break;
                    }
                }
            }
        } catch (_e) {}

        // Precosecha metrics (peso teórico, pérdida humedad)
        var pcMetrics = (typeof computePrecosechaMetrics === 'function')
            ? computePrecosechaMetrics(b)
            : { teorico: null, perdidaML: null, perdidaPct: null };

        return {
            bolsa:      b,
            genLabel:   genLabel,
            isHuerfana: b.origen === 'huerfana',
            flushes:    flushes,
            totalHumedo: totalHumedo,
            beAcum:     beAcum,
            grLoteComponentesMap: grLoteComponentesMap,
            suLoteAditivos:       suLoteAditivos,
            pcMetrics:            pcMetrics
        };
    }

    /** Árbol ASCII — igual estética que FR Trace ★. */
    /** Árbol ASCII de identidad — usa exclusivamente datos sellados en la bolsa. */
    function _frRenderIdentASCII(d) {
        var b    = d.bolsa;
        var estado = _frIdentEstado(b);
        var ecls   = _frIdentEstadoClass(estado);

        function R(pfx, lbl, val, note) {
            var v  = (val == null || val === '') ? '<span class="frt-nd">—</span>' : esc(String(val));
            var nt = note ? ' <em class="frt-note">' + esc(String(note)) + '</em>' : '';
            return '<div class="frt-row">'
                + '<span class="frt-pfx">' + pfx + '</span>'
                + '<span class="frt-lbl">' + esc(lbl) + '</span>'
                + '<span class="frt-val">' + v + nt + '</span>'
                + '</div>';
        }
        function S(pfx, inner) {
            return '<div class="frt-sec">'
                + '<span class="frt-pfx">' + pfx + '</span>'
                + '<span class="frt-stitle">' + inner + '</span>'
                + '</div>';
        }
        function BL() {
            return '<div class="frt-blank"><span class="frt-pfx">│</span></div>';
        }

        var H = [];

        /* ── Cabecera ── */
        H.push('<div class="frt-ascii-header">'
            + '<span class="frt-hid">📦 ' + esc(b.id || '—') + '</span>'
            + ' <span class="frt-badge ' + ecls + '">' + esc(estado.toUpperCase()) + '</span>'
            + (d.genLabel ? ' <span class="frt-hge">🧬 ' + esc(d.genLabel) + '</span>' : '')
            + '</div>');
        H.push(BL());

        /* ── SUSTRATO ── */
        var suLabel = (b.suLoteId || '—') + (b.suSubTanda ? ' · ' + b.suSubTanda : '');
        H.push(S('├── 🧱  ',
            'SUSTRATO <span class="frt-dim">────────</span> ' + esc(suLabel)));
        // Sustrato seco: siempre presente para trazabilidad y cálculo de BE.
        // Si es null/0 muestra '—' (fibra no registrada en SU), pero la línea no desaparece.
        H.push(R('│   ├── ', 'Sustrato seco/bolsa:',
            b.pesoSustratoSeco > 0 ? fmt(b.pesoSustratoSeco, 1) + ' g' : '—'));
        if (b.pesoHumedoHidratado > 0)
            H.push(R('│   ├── ', 'Peso hidratado/bolsa:', fmt(b.pesoHumedoHidratado, 1) + ' g'));

        /* Aditivos del lote SU — leídos en vivo desde su_lotes */
        if (d.suLoteAditivos && d.suLoteAditivos.length > 0) {
            d.suLoteAditivos.forEach(function(ad) {
                var cantStr = (ad.cantidad > 0) ? fmt(ad.cantidad, 1) + ' g' : null;
                H.push(R('│   ├── ', '🧪 ' + ad.nombre + ':', cantStr));
            });
        }

        /* ── GRANO (con INÓCULO anidado) ── */
        var multiSrc = Array.isArray(b.grSources) && b.grSources.length > 1;
        var grLabel = multiSrc
            ? '<span class="frt-dim">' + b.grSources.length + ' fuentes</span>'
            : esc(b.grLoteId || '—') + (b.grTandaId ? ' <span class="frt-dim">/ Tanda: ' + esc(b.grTandaId) + '</span>' : '');
        H.push(S('│   └── 🌾  ',
            'GRANO <span class="frt-dim">────────</span> ' + grLabel));
        if (multiSrc) {
            b.grSources.forEach(function(s, idx) {
                var isLastSrc = idx === b.grSources.length - 1;
                var pfxSec = isLastSrc ? '│       └── ' : '│       ├── ';
                var pfxRow = isLastSrc ? '│           ' : '│       │   ';
                /* tipo de inóculo — tres estados exactos */
                var inocLabel = s.inoculoSource === 'CI' ? 'CI / Placa'
                              : s.inoculoSource === 'GE' ? 'Genética directa'
                              : 'Desconocido';
                var inocRows = [['🧫 Inóculo:', inocLabel]];
                if (s.inoculoSource === 'CI') {
                    if (s.inoculoCiId)  inocRows.push(['Placa:', s.inoculoCiId]);
                    if (s.geneticaFull) inocRows.push(['Genética:', _abbrevGen(s.geneticaFull)]);
                    else                inocRows.push(['⚠️ Genética:', 'sin registrar']);
                } else if (s.inoculoSource === 'GE') {
                    if (s.geneticaFull) inocRows.push(['Genética:', _abbrevGen(s.geneticaFull)]);
                    else                inocRows.push(['⚠️ Genética:', 'sin registrar']);
                    inocRows.push(['⚠️ CI:', 'sin registrar']);
                }
                /* null → sin filas adicionales (datos legacy, Desconocido) */
                /* render fuente */
                H.push(S(pfxSec + '🌾 ', esc((s.grLoteId || '?') + ' · ' + (s.grTandaId || '?'))));
                /* Tipo de grano del lote GR */
                var _mComps = s.grLoteId && d.grLoteComponentesMap ? d.grLoteComponentesMap[s.grLoteId] : null;
                if (_mComps && _mComps.length > 0) {
                    var _mTipos = _mComps.map(function(c) { return c.nombre; }).filter(Boolean).join(' + ');
                    if (_mTipos) H.push(R(pfxRow + '├── ', 'Tipo grano:', _mTipos));
                }
                H.push(R(pfxRow + '├── ', 'Frascos:', s.grUsados + ' frasco' + (s.grUsados !== 1 ? 's' : '')));
                inocRows.forEach(function(row, ri) {
                    var isLastRow = ri === inocRows.length - 1;
                    H.push(R(pfxRow + (isLastRow ? '└── ' : '├── '), row[0], row[1]));
                });
            });
            if (b.granoPorBolsa != null)
                H.push(R('│       ══  ', 'Grano/bolsa:', fmt(b.granoPorBolsa, 1) + ' g'));
        } else {
            /* fuente única o huérfana (grSources ausente/vacío) */
            var _inocSrc0 = Array.isArray(b.grSources) && b.grSources.length > 0 ? b.grSources[0] : null;
            /* Tipo de grano del lote primario */
            var _singleGrId = b.grLoteId
                || (_inocSrc0 && _inocSrc0.grLoteId ? _inocSrc0.grLoteId : null);
            var _singleComps = _singleGrId && d.grLoteComponentesMap
                ? d.grLoteComponentesMap[_singleGrId] : null;
            var _sTipos = '';
            if (_singleComps && _singleComps.length > 0)
                _sTipos = _singleComps.map(function(c) { return c.nombre; }).filter(Boolean).join(' + ');
            /* Determinar si "Tipo grano" es la última fila de GRANO o habrá más */
            var _hasMoreGranoRows = (b.granoPorBolsa != null) || (_inocSrc0 != null);
            if (_sTipos)
                H.push(R(_hasMoreGranoRows ? '│       ├── ' : '│       └── ', 'Tipo grano:', _sTipos));
            /* granoPorBolsa: ├── si hay inóculo que sigue, └── si es huérfana */
            if (b.granoPorBolsa != null)
                H.push(R(_inocSrc0 ? '│       ├── ' : '│       └── ', 'Grano/bolsa:', fmt(b.granoPorBolsa, 1) + ' g'));
            if (_inocSrc0) {
                var _iSrc     = _inocSrc0.inoculoSource || null;
                var _iCiId    = _inocSrc0.inoculoCiId   || null;
                var _iGenFull = _inocSrc0.geneticaFull  || null;
                var _iLabel   = _iSrc === 'CI' ? 'CI / Placa'
                              : _iSrc === 'GE' ? 'Genética directa'
                              : 'Desconocido';
                /* construir sub-filas según tipo de inóculo */
                var _iRows = [];
                if (_iSrc === 'CI') {
                    if (_iCiId)    _iRows.push(['Placa:', _iCiId]);
                    if (_iGenFull) _iRows.push(['Genética:', _abbrevGen(_iGenFull)]);
                    else           _iRows.push(['⚠️ Genética:', 'sin registrar']);
                } else if (_iSrc === 'GE') {
                    if (_iGenFull) _iRows.push(['Genética:', _abbrevGen(_iGenFull)]);
                    else           _iRows.push(['⚠️ Genética:', 'sin registrar']);
                    _iRows.push(['⚠️ CI:', 'sin registrar']);
                }
                /* null → Desconocido, sin sub-filas */
                /* header INÓCULO */
                H.push(S('│       └── 🧫  ',
                    'INÓCULO <span class="frt-dim">──────── ' + esc(_iLabel) + '</span>'));
                _iRows.forEach(function(row, ri) {
                    var isLastRow = ri === _iRows.length - 1;
                    H.push(R('│           ' + (isLastRow ? '└── ' : '├── '), row[0], row[1]));
                });
                /* _iSrc === null → "Desconocido", _iRows vacío → sin sub-filas, correcto */
            }
            /* _inocSrc0 === null → huérfana: sin sección INÓCULO, correcto */
        }

        H.push(BL());

        /* ── 🍄 FR — FRUCTIFICACIÓN (reemplaza TIMELINE) ── */
        H.push(S('├── 🍄  ',
            'FR — FRUCTIFICACIÓN <span class="frt-dim">────────</span> ' + esc(b.id || '—')));

        var _frSec = [];   // [icon_sfx, lbl, val, note]

        var dc = diasEntre(b.fechaInicio, b.fechaColonizacion);
        var dp = diasEntre(b.fechaInicio, b.fechaPines);
        var dco = diasEntre(b.fechaInicio, b.fechaCosecha);

        _frSec.push(['🗓  ', 'Inicio:',          fmtFecha(b.fechaInicio), null]);
        _frSec.push(['✅  ', 'Colonización:',     fmtFecha(b.fechaColonizacion), dc != null ? 'día ' + dc : null]);
        _frSec.push(['🌱  ', 'Pines:',            fmtFecha(b.fechaPines),        dp != null ? 'día ' + dp : null]);
        _frSec.push(['🏁  ', 'Última cosecha:',   fmtFecha(b.fechaCosecha),      dco != null ? 'día ' + dco : null]);

        if (d.flushes.length > 0) {
            var _flSumStr = d.flushes.length + ' oleada' + (d.flushes.length !== 1 ? 's' : '')
                          + '  ·  ' + fmt(d.totalHumedo, 0) + ' g';
            var _beNote   = d.beAcum != null ? 'BE: ' + parseFloat(d.beAcum).toFixed(1) + '%' : null;
            _frSec.push(['🌊  ', 'Cosechas:', _flSumStr, _beNote]);
        }

        var _pc = d.pcMetrics;
        if (_pc.teorico != null)
            _frSec.push(['📐  ', 'Peso teórico:', fmt(_pc.teorico, 1) + ' g', null]);
        if (b.pesoPrecosecha != null)
            _frSec.push(['🌡  ', 'Pre-cosecha:',  fmt(num(b.pesoPrecosecha), 1) + ' g', null]);
        if (_pc.perdidaML != null)
            _frSec.push(['💧  ', 'Pérdida humedad:',
                fmt(_pc.perdidaML, 1) + ' g',
                _pc.perdidaPct != null ? _pc.perdidaPct.toFixed(1) + '%' : null]);

        _frSec.forEach(function(r, ri) {
            var isLast  = ri === _frSec.length - 1;
            var conn    = isLast ? '└── ' : '├── ';
            H.push(R('│   ' + conn + r[0], r[1], r[2], r[3]));
        });

        H.push(BL());

        /* ── COSECHAS ── */
        var suPesoStr = b.pesoSustratoSeco > 0
            ? fmt(b.pesoSustratoSeco, 1) + ' g seco'
            : 'sustrato no registrado';
        H.push(S('└── ⚖️   ',
            'COSECHAS <span class="frt-dim">──────── Sustrato seco: ' + esc(suPesoStr) + '</span>'));

        if (d.flushes.length === 0) {
            H.push(R('    └── ', 'Oleadas:', 'Sin cosechas registradas'));
        } else {
            d.flushes.forEach(function(f, i) {
                var isLast  = (i === d.flushes.length - 1);
                var pfx     = isLast ? '    └── ' : '    ├── ';
                var n       = f.n || (i + 1);
                var pesoStr = f.pesoHumedo != null ? f.pesoHumedo + ' g húmedo' : '—';
                if (f.pesoSeco != null) pesoStr += '  /  ' + f.pesoSeco + ' g seco';
                var beStr = f.beOleada != null
                    ? 'BE oleada: ' + parseFloat(f.beOleada).toFixed(1) + '%' : '';
                if (isLast && f.beAcumulado != null)
                    beStr += (beStr ? '  ·  ' : '') + 'acum: ' + parseFloat(f.beAcumulado).toFixed(1) + '%';
                H.push(R(pfx, 'Oleada ' + n + ':', pesoStr, beStr || null));
            });
            H.push(R('    ══  ', 'TOTAL:',
                      fmt(d.totalHumedo, 0) + ' g',
                      d.beAcum != null ? 'BE acumulada: ' + parseFloat(d.beAcum).toFixed(1) + '%' : null));
        }

        return '<div class="frt-ascii-tree">' + H.join('') + '</div>';
    }

    /** Grafo Visual SVG — igual estética que FR Trace ★. */
    /** Grafo visual — usa exclusivamente datos sellados en la bolsa. 5 nodos. */
    function _frRenderIdentGraph(d) {
        var b      = d.bolsa;
        var estado = _frIdentEstado(b);

        var VW = 820, VH = 570;
        var NW = 220, NH = 78;
        var xL = 40, xC = VW / 2 - NW / 2, xR = VW - 40 - NW;

        // Layout: cadena biológica izquierda/centro (FR→SU→GR→INÓCULO),
        //         datos propios de FR a la derecha (FR→COSECHAS).
        var pos = {
            fr:   [xC,  10],
            su:   [xL, 160],
            be:   [xR, 160],   // COSECHAS: hijo directo de FR164j
            gr:   [xC, 310],
            inoc: [xC, 450]
        };

        function cx(id) { return pos[id][0] + NW / 2; }
        function top(id){ return pos[id][1]; }
        function bot(id){ return pos[id][1] + NH; }

        function edge(a, b2) {
            var x1 = cx(a), y1 = bot(a), x2 = cx(b2), y2 = top(b2);
            var my = (y1 + y2) / 2;
            return '<path d="M ' + x1 + ' ' + y1
                + ' C ' + x1 + ' ' + my + '   ' + x2 + ' ' + my + '   ' + x2 + ' ' + y2 + '"'
                + ' stroke="#505050" stroke-width="1.5" fill="none" stroke-dasharray="5 3"/>';
        }
        function node(id, fill, title, l1, l2) {
            var rx = pos[id][0], ry = pos[id][1], tcx = rx + NW / 2;
            return '<rect x="' + rx + '" y="' + ry + '" width="' + NW + '" height="' + NH
                + '" rx="9" ry="9" fill="' + fill + '" opacity="0.92"/>'
                + '<text x="' + tcx + '" y="' + (ry + 22) + '" text-anchor="middle" font-size="13" font-weight="700" fill="#F5F5F5">' + title + '</text>'
                + (l1 ? '<text x="' + tcx + '" y="' + (ry + 42) + '" text-anchor="middle" font-size="11" fill="#D0D0D0">' + l1 + '</text>' : '')
                + (l2 ? '<text x="' + tcx + '" y="' + (ry + 58) + '" text-anchor="middle" font-size="10" fill="#A0A0A0">' + l2 + '</text>' : '');
        }

        // FR164j — estado + fecha inicio (datos del módulo FR)
        var frSub1 = estado.toUpperCase() + (b.fechaInicio ? '  ·  ' + fmtFecha(b.fechaInicio) : '');
        var frSub2 = (d.genLabel || '').substring(0, 28);

        var suSub1 = (b.suLoteId || '—') + (b.suSubTanda ? ' · ' + b.suSubTanda : '');
        var suSub2 = b.pesoSustratoSeco > 0 ? fmt(b.pesoSustratoSeco, 1) + ' g seco/bolsa' : '';
        if (d.suLoteAditivos && d.suLoteAditivos.length > 0)
            suSub2 += (suSub2 ? '  ·  ' : '') + d.suLoteAditivos.length
                    + ' aditivo' + (d.suLoteAditivos.length !== 1 ? 's' : '');

        /* GRANO — sub1: tipo cereal (Avena/Trigo/etc.) o loteId; sub2: tanda + peso */
        var _gPrimId = b.grLoteId
            || (Array.isArray(b.grSources) && b.grSources.length > 0 ? b.grSources[0].grLoteId : null);
        var _gPrimComps = _gPrimId && d.grLoteComponentesMap ? d.grLoteComponentesMap[_gPrimId] : null;
        var _gTiposStr  = '';
        if (_gPrimComps && _gPrimComps.length > 0) {
            _gTiposStr = _gPrimComps.map(function(c) { return c.nombre; }).filter(Boolean).join(' + ');
        }
        var grSub1 = _gTiposStr ? _gTiposStr.substring(0, 26) : (b.grLoteId || '—');
        var grSub2;
        if (_gTiposStr) {
            // Cereal en sub1 → sub2 muestra loteId + peso grano
            grSub2 = (b.grLoteId || '—')
                   + (b.granoPorBolsa != null ? '  ·  ' + fmt(b.granoPorBolsa, 1) + ' g' : '');
        } else {
            // Sin cereal → sub1 es loteId, sub2 muestra tanda + peso
            grSub2 = b.grTandaId ? 'Tanda: ' + b.grTandaId : '';
            if (b.granoPorBolsa != null)
                grSub2 += (grSub2 ? '  ·  ' : '') + fmt(b.granoPorBolsa, 1) + ' g';
        }

        var beSub1 = d.flushes.length + ' oleadas · ' + fmt(d.totalHumedo, 0) + ' g';
        var beSub2 = d.beAcum != null
            ? 'BE acumulada: ' + parseFloat(d.beAcum).toFixed(1) + '%'
            : 'Sin cosechas';

        // Inóculo — solo datos sellados en b.grSources
        var _gSrcs      = Array.isArray(b.grSources) && b.grSources.length > 0 ? b.grSources : null;
        var _gSrc0      = _gSrcs ? _gSrcs[0] : null;
        var _iSrcType   = _gSrc0 ? (_gSrc0.inoculoSource || null) : null;
        var _iCiId      = _gSrc0 ? (_gSrc0.inoculoCiId   || null) : null;
        var _iGenFull   = _gSrc0 ? (_gSrc0.geneticaFull  || null) : null;
        var inocSub1 = _iSrcType === 'CI' ? ('CI / Placa' + (_iCiId ? ' · ' + _iCiId : ''))
                     : _iSrcType === 'GE' ? 'Genética directa · ⚠️ CI'
                     : 'Desconocido';
        /* inocSub2: genética (truncada) o ⚠️ si tipo conocido pero sin genética */
        var inocSub2 = _iSrcType === null ? ''
                     : _iGenFull          ? _iGenFull.substring(0, 26)
                     :                      '⚠️ Genética sin registrar';

        var svg = '<svg viewBox="0 0 ' + VW + ' ' + VH + '" xmlns="http://www.w3.org/2000/svg"'
            + ' style="width:100%;max-height:' + VH + 'px;font-family:\'JetBrains Mono\',monospace;display:block">'
            + edge('fr','su') + edge('fr','be') + edge('su','gr') + edge('gr','inoc')
            + node('fr',   '#1a4080', '📦 ' + esc(b.id || '—'), frSub1,   frSub2)
            + node('su',   '#7a3200', '🧱 SUSTRATO',              suSub1,   suSub2)
            + node('be',   '#1a5a3a', '⚖️ COSECHAS',               beSub1,   beSub2)
            + node('gr',   '#5a4400', '🌾 GRANO',                  grSub1,   grSub2)
            + node('inoc', '#1a5a1a', '🧫 INÓCULO',                inocSub1, inocSub2)
            + '</svg>';

        var flushRows = d.flushes.map(function(f, i) {
            var n   = f.n || (i + 1);
            var ph  = f.pesoHumedo  != null ? f.pesoHumedo  + ' g' : '—';
            var ps  = f.pesoSeco    != null ? f.pesoSeco    + ' g' : '—';
            var beO = f.beOleada    != null ? parseFloat(f.beOleada).toFixed(1) + '%' : '—';
            var beA = f.beAcumulado != null ? parseFloat(f.beAcumulado).toFixed(1) + '%' : '—';
            return '<tr><td>F' + n + '</td><td>' + ph + '</td><td>' + ps
                + '</td><td>' + beO + '</td><td>' + beA + '</td></tr>';
        }).join('');

        var totalRow = d.flushes.length > 0
            ? '<tfoot><tr><td><b>TOTAL</b></td><td><b>' + fmt(d.totalHumedo, 0)
              + ' g</b></td><td>—</td><td>—</td><td><b>'
              + (d.beAcum != null ? parseFloat(d.beAcum).toFixed(1) + '%' : '—')
              + '</b></td></tr></tfoot>'
            : '';

        var tabla = '<div class="frt-graph-table"><table class="frt-table">'
            + '<thead><tr><th>Oleada</th><th>Peso húmedo</th><th>Peso seco</th>'
            + '<th>BE oleada</th><th>BE acumulada</th></tr></thead>'
            + '<tbody>'
            + (flushRows || '<tr><td colspan="5" style="color:var(--tx3)">Sin cosechas registradas</td></tr>')
            + '</tbody>' + totalRow + '</table></div>';

        return '<div class="frt-graph-wrap">' + svg + tabla + '</div>';
    }

    /** Estado de vista (ascii | graph). */
    var _frIdentViewMode = 'ascii';

    /** Cambia el modo de vista y re-renderiza. */
    FR.setIdentView = function(mode) {
        _frIdentViewMode = mode;
        var btnA = document.getElementById('frIdentBtnAscii');
        var btnG = document.getElementById('frIdentBtnGraph');
        if (btnA) btnA.classList.toggle('active', mode === 'ascii');
        if (btnG) btnG.classList.toggle('active', mode === 'graph');
        var b = getSelected();
        if (b) renderIdTree(b);
    };

    /**
     * renderIdTree — punto de entrada. Construye datos y delega al modo activo.
     */
    function renderIdTree(b) {
        var host = document.getElementById('frIdTree');
        if (!host) return;
        if (!b) { host.innerHTML = ''; return; }

        var d = _frIdentBuildData(b);
        host.innerHTML = _frIdentViewMode === 'graph'
            ? _frRenderIdentGraph(d)
            : _frRenderIdentASCII(d);
    }


    function renderObs(b) {
        var log = document.getElementById('frObsLog');
        if (!log) return;
        var obs = b && Array.isArray(b.observaciones) ? b.observaciones : [];
        if (obs.length === 0) {
            log.innerHTML = '<div class="fr-log-empty">Sin observaciones.</div>';
            return;
        }
        var ICONO_EST = { green: 'G', yellow: 'Y', red: 'R', none: '' };
        var html = obs.slice().reverse().map(function(o) {
            var tipoCls = o.tipo === 'auto' ? 'fr-log-auto' : 'fr-log-manual';
            var estado = ESTADOS_OBS[o.estado] ? o.estado : 'none';
            var estCls = 'fr-log-estado-' + estado;
            var ico = ICONO_EST[estado] || '';
            var diasTxt = (o.dias != null) ? ('dia ' + o.dias) : '';
            return '<div class="fr-log-row ' + tipoCls + ' ' + estCls + '">'
                + '<span class="fr-log-ts">' + fmtFecha(o.ts) + (diasTxt ? ' · ' + diasTxt : '') + '</span>'
                + '<span class="fr-log-tag">' + (ico ? ico + ' ' : '') + (o.tipo === 'auto' ? 'auto' : 'nota') + '</span>'
                + '<span class="fr-log-text">' + esc(o.texto) + '</span>'
                + '</div>';
        }).join('');
        log.innerHTML = html;
    }

    // ======================================================
    // RENDER: VISTA GENERAL (landing del Dashboard sin bolsa seleccionada)
    // Muestra todas las bolsas agrupadas por estado. Se renderiza en el
    // contenedor #frDashEmpty cuando no hay bolsa seleccionada.
    // No crea nueva pestaña ni modifica la estructura de navegación.
    // ======================================================
    var _OV_LABELS = { 'ciclo cerrado': 'FIN DEL CICLO' };

    function _ovChipClass(estado) {
        if (estado === 'colonizando')   return 'fr-chip-warn';
        if (estado === 'colonizado')    return 'fr-chip-ok';
        if (estado === 'pinning')       return 'fr-chip-warn';
        if (estado === 'cosechado')     return 'fr-chip-ok';
        if (estado === 'contaminada')   return 'fr-chip-bad';
        if (estado === 'cancelada')     return 'fr-chip-cancelada';
        if (estado === 'ciclo cerrado') return 'fr-chip-fin-ciclo';
        if (estado === 'pendiente')     return 'fr-chip-pendiente';
        return 'fr-chip-neutral';
    }

    function _ovFilas(lista) {
        return lista.map(function(b) {
            var estado    = computeEstado(b);
            var label     = _OV_LABELS[estado] || estado;
            var chipClass = _ovChipClass(estado);
            var dias      = b.cicloCerrado && b.fechaCierreCiclo
                ? diasEntre(b.fechaInicio, b.fechaCierreCiclo)
                : diasEntre(b.fechaInicio, hoyISO());
            var be   = beAcumulado(b.flushes);
            var rend = rendimientoFresco(b.flushes);
            var fN   = (b.flushes || []).length;
            var ge   = _abbrevGen(
                b.geneticaFull ||
                [b.genetica, b.fenotipo].filter(Boolean).join(' / ') ||
                '—'
            );
            // Pendientes no son seleccionables aún (sin ID definitivo)
            var clickAttr = esPendiente(b)
                ? '' : ' onclick="FR.select(\'' + esc(b.id) + '\')"';
            var cursor    = esPendiente(b) ? '' : 'cursor:pointer';
            var huerfana  = b.origen === 'huerfana'
                ? ' <span class="fr-chip fr-chip-huerfana" style="font-size:0.6rem;padding:1px 4px" title="Bolsa huérfana">H</span>'
                : '';
            return '<tr class="fr-row" style="' + cursor + '"' + clickAttr + '>'
                + '<td><strong>' + esc(b.id || '—') + '</strong>' + huerfana + '</td>'
                + '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(ge) + '">' + esc(ge) + '</td>'
                + '<td><span class="fr-chip ' + chipClass + '">' + esc(label) + '</span></td>'
                + '<td class="fr-num-days">' + (dias != null ? dias + 'd' : '—') + '</td>'
                + '<td class="fr-num">' + (fN > 0 ? fN : '—') + '</td>'
                + '<td class="fr-num">' + (rend > 0 ? fmt(rend, 1) + ' g' : '—') + '</td>'
                + '<td class="fr-num-pct">' + (be > 0 ? fmt(be, 1) + '%' : '—') + '</td>'
                + '</tr>';
        }).join('');
    }

    function _ovSecHeader(emoji, titulo, n, badgeCls) {
        return '<tr class="fr-ov-sec-hdr">'
            + '<th colspan="7">'
            + emoji + ' ' + esc(titulo)
            + ' <span class="fr-ov-badge ' + badgeCls + '">' + n + '</span>'
            + '</th></tr>';
    }

    function renderOverview(container) {
        if (!container) return;

        var pendientes = bolsas.filter(esPendiente);
        var activos    = bolsas.filter(esEnCultivo).slice().sort(function(a, b) { return (b.fechaInicio || '') < (a.fechaInicio || '') ? -1 : 1; });
        var cosecha    = bolsas.filter(esCosecha).slice().sort(function(a, b) {
            var fa = (a.flushes || []).reduce(function(m, f) { return (f.fecha || '') > m ? f.fecha : m; }, a.fechaCosecha || '');
            var fb = (b.flushes || []).reduce(function(m, f) { return (f.fecha || '') > m ? f.fecha : m; }, b.fechaCosecha || '');
            return fb < fa ? -1 : 1;
        });
        var archivadas = bolsas.filter(esArchivada).slice().sort(function(a, b) {
            var fa = a.fechaCierreCiclo || a.fechaCancelacion || '';
            var fb = b.fechaCierreCiclo || b.fechaCancelacion || '';
            return fb < fa ? -1 : 1;
        });
        var total      = pendientes.length + activos.length + cosecha.length + archivadas.length;

        // ── KPIs sistémicos del Dashboard ──
        var _total      = bolsas.filter(function(b) { return !esPendiente(b); }).length;
        var _cosechadasN= bolsas.filter(esCosecha).length;
        var _archivN    = bolsas.filter(esArchivada).length;

        // Biomasa húmeda total del sistema (todos los flushes, todas las bolsas)
        var _bioHumTotal = bolsas.reduce(function(acc, b) {
            return acc + biomasaHumedaTotal(b.flushes);
        }, 0);

        // BE promedio (solo bolsas con ≥1 flush)
        var _conFlush = bolsas.filter(function(b) { return (b.flushes || []).length > 0; });
        var _beAvg    = 0;
        if (_conFlush.length > 0) {
            var _beSum = _conFlush.reduce(function(a, b) { return a + beAcumulado(b.flushes); }, 0);
            _beAvg = _beSum / _conFlush.length;
        }

        // Biomasa seca total del sistema
        var _bioSecaTotal = bolsas.reduce(function(acc, b) {
            return acc + biomasaSecaTotal(b.flushes);
        }, 0);

        // % Biomasa: seca vs húmeda total (seca / húmeda * 100)
        var _pctBio = (_bioHumTotal > 0 && _bioSecaTotal > 0)
            ? (_bioSecaTotal / _bioHumTotal) * 100
            : null;

        var kpiHtml =
            '<div class="metrics-grid" style="margin-bottom:0">'
            + '<div class="metric-card">'
            +   '<span class="metric-label">Total bolsas</span>'
            +   '<span class="metric-value">' + _total + '</span>'
            +   '<span class="metric-unit">registradas</span>'
            + '</div>'
            + '<div class="metric-card fr-color-ok">'
            +   '<span class="metric-label">Cosechadas</span>'
            +   '<span class="metric-value">' + (_cosechadasN || '—') + '</span>'
            +   '<span class="metric-unit">en cosecha activa</span>'
            + '</div>'
            + '<div class="metric-card">'
            +   '<span class="metric-label">Archivadas</span>'
            +   '<span class="metric-value">' + (_archivN || '—') + '</span>'
            +   '<span class="metric-unit">ciclo cerrado</span>'
            + '</div>'
            + '<div class="metric-card highlight">'
            +   '<span class="metric-label">Biomasa húmeda</span>'
            +   '<span class="metric-value">' + (_bioHumTotal > 0 ? fmt(_bioHumTotal, 0) : '—') + '</span>'
            +   '<span class="metric-unit">g totales generados</span>'
            + '</div>'
            + '<div class="metric-card highlight">'
            +   '<span class="metric-label">BE promedio</span>'
            +   '<span class="metric-value">' + (_beAvg > 0 ? fmt(_beAvg, 1) + '%' : '—') + '</span>'
            +   '<span class="metric-unit">bolsas con cosecha</span>'
            + '</div>'
            + '<div class="metric-card">'
            +   '<span class="metric-label">Biomasa seca</span>'
            +   '<span class="metric-value">' + (_bioSecaTotal > 0 ? fmt(_bioSecaTotal, 0) : '—') + '</span>'
            +   '<span class="metric-unit">g totales deshidratados</span>'
            + '</div>'
            + '<div class="metric-card fr-color-warn">'
            +   '<span class="metric-label">% Biomasa</span>'
            +   '<span class="metric-value">' + (_pctBio != null ? fmt(_pctBio, 1) + '%' : '—') + '</span>'
            +   '<span class="metric-unit">seca / húmeda total</span>'
            + '</div>'
            + '</div>';

        // ── Tabla ──
        var tableBody = '';
        if (total === 0) {
            tableBody = '<tr><td colspan="7" class="fr-empty">'
                + 'Sin registros FR. Usá <strong>🔄 Sync desde SU</strong> para importar bolsas.'
                + '</td></tr>';
        } else {
            if (pendientes.length > 0) {
                tableBody += _ovSecHeader('⏳', 'Pendientes de confirmación', pendientes.length, 'fr-ov-badge-pend');
                tableBody += _ovFilas(pendientes);
            }
            if (activos.length > 0) {
                tableBody += _ovSecHeader('🟢', 'En cultivo', activos.length, 'fr-ov-badge-ok');
                tableBody += _ovFilas(activos);
            }
            if (cosecha.length > 0) {
                tableBody += _ovSecHeader('🌊', 'En cosecha', cosecha.length, 'fr-ov-badge-wave');
                tableBody += _ovFilas(cosecha);
            }
            if (archivadas.length > 0) {
                tableBody += _ovSecHeader('🔴', 'Archivadas', archivadas.length, 'fr-ov-badge-bad');
                tableBody += _ovFilas(archivadas);
            }
        }

        container.innerHTML =
            '<div class="section-header">'
            + '<h2>📋 Vista General</h2>'
            + '<span class="fr-dash-subtle">Seleccioná una bolsa para abrir su dashboard.</span>'
            + '</div>'
            + '<div class="section-content">'
            + '<div class="metrics-panel" style="margin:0 0 16px 0;padding:16px">' + kpiHtml + '</div>'
            + '<div class="table-wrap" style="margin-top:14px">'
            +   '<table class="data-table fr-ov-table">'
            +     '<thead><tr>'
            +       '<th>ID</th><th>Genética</th><th>Estado</th>'
            +       '<th title="Días desde inicio">Días</th>'
            +       '<th title="Flushes">F#</th>'
            +       '<th title="Rendimiento fresco acumulado">Rend.</th>'
            +       '<th title="Eficiencia Biológica acumulada">BE</th>'
            +     '</tr></thead>'
            +     '<tbody>' + tableBody + '</tbody>'
            +   '</table>'
            + '</div>'
            + '</div>';
    }

    function renderAll() {
        renderPendientes();
        renderActivos();
        renderCosecha();
        renderArchivo();
        renderDashboard();
    }

    // ======================================================
    // RENDER: PENDIENTES
    // ======================================================
    // RENDER: PENDIENTES
    // ======================================================
    /**
     * Tabla de bolsas en estado PENDIENTE (pendienteConfirmacion === true).
     * Se inyecta como section-card antes del primer fr-subpanel en .app-container,
     * usando exactamente las mismas clases que el resto del módulo FR.
     * Visible solo cuando hay pendientes.
     */
    // Abreviaciones de especie para display — no modifica storage
    function _abbrevGen(s) {
        return s ? s.replace(/Psilocybe cubensis/gi, 'PC') : s;
    }

    function _grTxtFromBolsa(b) {
        if (Array.isArray(b.grSources) && b.grSources.length > 1) {
            return b.grSources.map(function(s) {
                return (s.grLoteId || '—') + (s.grTandaId ? ' · ' + s.grTandaId : '');
            }).join(' + ');
        }
        return (b.grLoteId || '—') + (b.grTandaId ? ' · ' + b.grTandaId : '');
    }

    function _geTxtFromBolsa(b) {
        if (Array.isArray(b.grSources) && b.grSources.length > 1) {
            var labels = b.grSources
                .map(function(s) { return _abbrevGen(s.geneticaFull || ''); })
                .filter(Boolean);
            if (labels.length > 1) return labels.join(' + ');
        }
        return _abbrevGen(b.geneticaFull || [b.genetica, b.fenotipo].filter(Boolean).join(' / ') || '—');
    }

    function filaPendiente(b) {
        var ge    = _geTxtFromBolsa(b);
        var suTxt = (b.suLoteId || '—') + (b.suSubTanda ? ' · ' + b.suSubTanda : '');
        var grTxt = _grTxtFromBolsa(b);
        var seco  = b.pesoSustratoSeco > 0 ? fmt(b.pesoSustratoSeco, 1) + ' g' : '—';
        var uuid  = esc(b._frUuid || '');
        var fechaVal = b.fechaInicio ? esc(b.fechaInicio) : '';
        return '<tr class="fr-row fr-row-pendiente">'
            + '<td><span class="fr-chip fr-chip-pendiente">⏳ pendiente</span></td>'
            + '<td>' + esc(ge) + '</td>'
            + '<td><span class="fr-traza">' + esc(suTxt) + '</span></td>'
            + '<td><span class="fr-traza">' + esc(grTxt) + '</span></td>'
            + '<td class="fr-num-days"><input type="date" class="fr-fecha-armado-input" value="' + fechaVal + '" title="Fecha real de armado — corregí si confirmás en un día distinto al que se armó la bolsa"></td>'
            + '<td class="fr-num">' + seco + '</td>'
            + '<td class="fr-acciones" style="white-space:nowrap">'
            +   '<button class="fr-btn-confirmar" onclick="FR.confirmarBolsa(\'' + uuid + '\', this.closest(\'tr\').querySelector(\'.fr-fecha-armado-input\').value)" title="Confirmar armado — genera el ID definitivo">✅ Confirmar</button>'
            +   ' <button class="fr-btn-cancelar-pend" onclick="FR.cancelarBolsa(\'' + uuid + '\')" title="Descartar — queda en Archivo para trazabilidad">✕ Cancelar</button>'
            + '</td>'
            + '</tr>';
    }

    function renderPendientes() {
        var pendientes = bolsas.filter(esPendiente);

        var seccion = document.getElementById('frSeccionPendientes');

        // Creación única de la sección (lazy, solo cuando hay pendientes por primera vez)
        if (!seccion) {
            // Anclar antes del primer fr-subpanel dentro de .app-container.
            // Esto la pone sobre los tabs Activo/Cosecha/Archivo, siempre visible
            // independientemente del sub-tab activo.
            var container = document.querySelector('.app-container');
            var firstSubpanel = container ? container.querySelector('.fr-subpanel') : null;
            if (!firstSubpanel) return; // DOM aún no listo

            seccion = document.createElement('div');
            seccion.id = 'frSeccionPendientes';
            // Usa section-card igual que el resto del módulo
            seccion.className = 'section-card';
            seccion.style.display = 'none';
            seccion.innerHTML =
                '<div class="section-header">'
                + '<h2>⏳ Pendientes de confirmación</h2>'
                + '<span class="fr-pendientes-badge" id="frPendientesBadge"></span>'
                + '</div>'
                + '<div class="section-content" style="padding:0">'
                +   '<div class="table-wrap">'
                +     '<table class="data-table">'
                +       '<thead><tr>'
                +         '<th>Estado</th>'
                +         '<th>Genética</th>'
                +         '<th>Lote SU</th>'
                +         '<th>Tanda GR</th>'
                +         '<th>Fecha inicio</th>'
                +         '<th>Sust. seco</th>'
                +         '<th>Acciones</th>'
                +       '</tr></thead>'
                +       '<tbody id="frPendientesBody"></tbody>'
                +     '</table>'
                +   '</div>'
                + '</div>';
            firstSubpanel.parentNode.insertBefore(seccion, firstSubpanel);
        }

        var tbody = document.getElementById('frPendientesBody');
        if (!tbody) return;

        seccion.style.display = pendientes.length > 0 ? '' : 'none';

        var badge = document.getElementById('frPendientesBadge');
        if (badge) badge.textContent = pendientes.length > 0 ? pendientes.length : '';

        tbody.innerHTML = pendientes.length > 0
            ? pendientes.map(filaPendiente).join('')
            : '<tr><td colspan="7" class="fr-empty">Sin bolsas pendientes de confirmación.</td></tr>';
    }

    // ======================================================
    // API
    // ======================================================
    function _frCalRenderAnomalyCard(alert) {
        if (!alert) return '';
        var dimLabels = { mutaciones: 'Mutaciones', deformaciones: 'Deformaciones', blobs: 'Blobs' };
        var anomText = alert.anomalias.map(function(d) { return dimLabels[d] || d; }).join(', ');
        var html = '<div class="fr-anomaly-alert">'
            + '<div class="fr-anomaly-header">⚠ Anomalías detectadas: ' + esc(anomText) + '</div>';
        if (!alert.candidatos.length) {
            html += '<p class="fr-anomaly-note">Sin candidatos con datos suficientes (mínimo n=' + FR_ANOMALY_MIN_N + ' por variable). Registrá más evaluaciones para activar el análisis.</p>';
        } else {
            html += '<div class="fr-anomaly-subtitle">Candidatos de causa — correlaciones observacionales:</div>'
                + '<div class="fr-anomaly-list">';
            alert.candidatos.forEach(function(c) {
                var confColor = c.confidence === 'alta' ? '#5dbe7a' : c.confidence === 'media' ? '#ffb83f' : '#888';
                html += '<div class="fr-anomaly-row">'
                    + '<span class="fr-anomaly-fuente fr-anomaly-fuente-' + c.fuente.toLowerCase() + '">' + esc(c.fuente) + '</span>'
                    + '<span class="fr-anomaly-label">' + esc(c.label) + '</span>'
                    + '<span class="fr-anomaly-delta" style="color:#ff8c8c;">Δ+' + c.delta + '%</span>'
                    + '<span class="fr-anomaly-conf" style="color:' + confColor + ';">' + esc(c.confidence) + '</span>'
                    + '</div>';
            });
            html += '</div>'
                + '<p class="fr-anomaly-note">Revisá estos inputs en los lotes SU/GR vinculados. Correlaciones observacionales — no implican causalidad.</p>';
        }
        html += '</div>';
        return html;
    }

    function _frCalRenderIntelPanel() {
        var cont = document.getElementById('frCalIntelContent');
        if (!cont) return;
        var intel = FR.getIntel();
        if (intel && !intel.anomalousBolsas) {
            try { localStorage.removeItem(FR_CAL_INTEL_KEY); } catch(e) {}
            intel = _frCalBuildIntel();
        }

        if (!intel || intel.totalFlushesEvaluados === 0) {
            cont.innerHTML = '<div style="padding:20px;">'
                + '<p style="color:var(--text-muted,#888);margin:0 0 12px;font-size:0.95rem;">Sin flushes evaluados aún.</p>'
                + '<p style="font-size:0.82rem;color:#888;margin:0 0 18px;line-height:1.6;">'
                + 'Para evaluar: andá al Dashboard → seleccioná una bolsa → hacé clic en <strong style="color:#7eb8f7;">Evaluar</strong> en la tabla de flushes.</p>'
                + '<button type="button" class="btn btn-fr" onclick="FR.goOverview()">← Ir al Dashboard</button>'
                + '</div>';
            return;
        }

        function fmtDelta(val, invertido) {
            if (val == null) return '<span style="color:#555;">—</span>';
            var pos = invertido ? val < 0 : val > 0;
            var color = pos ? '#5dbe7a' : (val === 0 ? '#888' : '#ff6b6b');
            return '<span style="color:' + color + ';font-weight:600;">' + (val > 0 ? '+' : '') + val + '</span>';
        }

        var html = '<h3 style="color:var(--accent,#7eb8f7);margin:0 0 4px;">📊 Motor de Trazabilidad FR·CAL</h3>'
            + '<p style="font-size:0.78rem;color:var(--text-muted,#888);margin:0 0 18px;">'
            + intel.totalFlushesEvaluados + ' flushes evaluados · Las correlaciones son observacionales, no causales.</p>';

        var anomBolsas = intel.anomalousBolsas || [];
        if (anomBolsas.length) {
            html += '<h4 style="color:#ff8c8c;font-size:0.78rem;text-transform:uppercase;letter-spacing:.06em;margin:0 0 10px;">⚠ Bolsas con anomalías</h4>';
            html += '<table class="fr-anomaly-table" style="margin-bottom:18px;"><thead><tr>'
                + '<th>Bolsa</th><th>Cepa · SU · GR</th><th>Flush</th><th>Anomalías</th><th>Score</th>'
                + '</tr></thead><tbody>';
            anomBolsas.forEach(function(ab) {
                html += '<tr onclick="FR.select(\'' + esc(ab.bolsaId) + '\');FR.subTab(\'dash\');" '
                    + 'style="cursor:pointer;" onmouseover="this.style.background=\'#2a1a1a\'" onmouseout="this.style.background=\'\'">'
                    + '<td style="color:#7eb8f7;font-size:0.75rem;font-family:monospace;">' + esc(ab.bolsaId.substring(0, 10)) + '…</td>'
                    + '<td style="font-size:0.78rem;">' + esc(ab.fenLabel) + '<br><span style="color:#666;font-size:0.72rem;">SU: ' + esc(ab.suLabel) + ' · GR: ' + esc(ab.grLabel) + '</span></td>'
                    + '<td style="color:#aaa;">F' + ab.flushNum + '</td>'
                    + '<td style="color:#ff8c8c;font-size:0.78rem;">' + esc(ab.anomalias.join(' · ')) + '</td>'
                    + '<td style="color:' + (ab.scoreAuto >= 70 ? '#5dbe7a' : ab.scoreAuto >= 50 ? '#ffb83f' : '#ff6b6b') + ';font-weight:600;">' + ab.scoreAuto + '</td>'
                    + '</tr>';
            });
            html += '</tbody></table>';
        }

        var cepaKeys = Object.keys(intel.byCepa);
        if (cepaKeys.length) {
            html += '<h4 style="color:var(--text-secondary,#aaa);font-size:0.78rem;text-transform:uppercase;letter-spacing:.06em;margin:0 0 10px;">Perfil por cepa</h4>';
            html += '<div class="fr-cal-intel-grid">';
            cepaKeys.forEach(function(fenId) {
                var d = intel.byCepa[fenId];
                var bolsaRows = '';
                if (Array.isArray(d.bolsas) && d.bolsas.length) {
                    bolsaRows = '<div style="margin-top:8px;border-top:1px solid #ffffff10;padding-top:6px;">'
                        + '<div style="font-size:0.72rem;color:#666;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;">Bolsas incluidas</div>';
                    d.bolsas.forEach(function(bv) {
                        bolsaRows += '<div onclick="FR.select(\'' + esc(bv.bolsaId) + '\');FR.subTab(\'dash\');" '
                            + 'style="display:grid;grid-template-columns:auto 1fr auto;gap:6px;align-items:center;'
                            + 'padding:3px 4px;border-radius:3px;cursor:pointer;font-size:0.78rem;'
                            + 'color:#aaa;transition:background .15s;" '
                            + 'onmouseover="this.style.background=\'#ffffff10\'" onmouseout="this.style.background=\'\'">'
                            + '<span style="color:#7eb8f7;font-weight:600;">F' + bv.flushNum + '</span>'
                            + '<span style="color:#888;">SU: ' + esc(bv.suLabel) + ' · GR: ' + esc(bv.grLabel) + '</span>'
                            + '<span style="color:' + (bv.scoreAuto >= 70 ? '#5dbe7a' : bv.scoreAuto >= 50 ? '#ffb83f' : '#ff6b6b') + ';font-weight:600;">'
                            + bv.scoreAuto + '</span>'
                            + '</div>';
                    });
                    bolsaRows += '</div>';
                }
                html += '<div class="fr-cal-intel-card">'
                    + '<div class="fr-cal-intel-card-title">' + esc(d.label || fenId) + ' <span style="color:#666;">(n=' + d.n + ')</span></div>'
                    + '<div class="fr-cal-intel-row"><span>Score auto medio</span><strong>' + (d.scoreAutoMean != null ? Math.round(d.scoreAutoMean) + '/100' : '—') + '</strong></div>'
                    + '<div class="fr-cal-intel-row"><span>Score personal medio</span><strong>' + (d.scorePersonalMean != null ? (Math.round(d.scorePersonalMean * 10) / 10) + '/10' : '—') + '</strong></div>'
                    + '<div class="fr-cal-intel-row"><span>BE medio</span><strong>' + (d.beMean != null ? fmt(d.beMean, 1) + '%' : '—') + '</strong></div>'
                    + '<div class="fr-cal-intel-row"><span>% Dominante medio</span><strong>' + (d.pctDominanteMean != null ? fmt(d.pctDominanteMean, 1) + '%' : '—') + '</strong></div>'
                    + '<div class="fr-cal-intel-row"><span>% Abortos medio</span><strong>' + (d.pctAbortosMean != null ? fmt(d.pctAbortosMean, 1) + '%' : '—') + '</strong></div>'
                    + bolsaRows
                    + '</div>';
            });
            html += '</div>';
        }

        var adKeys = Object.keys(intel.bySuAditivo);
        if (adKeys.length) {
            html += '<h4 style="color:var(--text-secondary,#aaa);font-size:0.78rem;text-transform:uppercase;letter-spacing:.06em;margin:18px 0 10px;">Aditivos SU — correlaciones</h4>';
            html += '<div class="fr-cal-intel-grid">';
            adKeys.forEach(function(slug) {
                var d = intel.bySuAditivo[slug];
                html += '<div class="fr-cal-intel-card">'
                    + '<div class="fr-cal-intel-card-title">' + esc(d.label) + ' <span style="color:#666;">(n=' + d.n + ' / baseline=' + d.nBaseline + ')</span></div>'
                    + '<div class="fr-cal-intel-row"><span>Δ Score auto</span>' + fmtDelta(d.deltaScore, false) + '</div>'
                    + '<div class="fr-cal-intel-row"><span>Δ % Abortos</span>' + fmtDelta(d.deltaAbortos, true) + '</div>'
                    + '<div class="fr-cal-intel-row"><span>Δ % Blobs</span>' + fmtDelta(d.deltaBlobs, true) + '</div>'
                    + '<div class="fr-cal-intel-row"><span>Δ % Mutaciones</span>' + fmtDelta(d.deltaMutaciones, true) + '</div>'
                    + '<div class="fr-cal-intel-row"><span>Δ % Deformaciones</span>' + fmtDelta(d.deltaDeformaciones, true) + '</div>'
                    + (d.confidence ? '<div class="fr-cal-intel-row"><span>Confianza</span><strong>' + esc(d.confidence) + '</strong></div>' : '')
                    + '</div>';
            });
            html += '</div>';
        } else {
            html += '<p style="color:var(--text-muted,#888);font-size:0.82rem;">Se necesitan n ≥ 5 flushes por variable de aditivo para mostrar correlaciones.</p>';
        }

        var grKeys = Object.keys(intel.byGrProtocolo);
        if (grKeys.length) {
            html += '<h4 style="color:var(--text-secondary,#aaa);font-size:0.78rem;text-transform:uppercase;letter-spacing:.06em;margin:18px 0 10px;">Lotes GR — correlaciones</h4>';
            html += '<div class="fr-cal-intel-grid">';
            grKeys.forEach(function(grId) {
                var d = intel.byGrProtocolo[grId];
                html += '<div class="fr-cal-intel-card">'
                    + '<div class="fr-cal-intel-card-title">GR ' + esc(d.label) + ' <span style="color:#666;">(n=' + d.n + ')</span></div>'
                    + '<div class="fr-cal-intel-row"><span>Score auto medio</span><strong>' + (d.scoreAutoMean != null ? Math.round(d.scoreAutoMean) + '/100' : '—') + '</strong></div>'
                    + '<div class="fr-cal-intel-row"><span>% Positivo medio</span><strong>' + (d.pctPositivoMean != null ? fmt(d.pctPositivoMean, 1) + '%' : '—') + '</strong></div>'
                    + '</div>';
            });
            html += '</div>';
        }

        var grCompKeys = Object.keys(intel.byGrComponente || {});
        if (grCompKeys.length) {
            html += '<h4 style="color:var(--text-secondary,#aaa);font-size:0.78rem;text-transform:uppercase;letter-spacing:.06em;margin:18px 0 10px;">Componentes GR — correlaciones</h4>';
            html += '<div class="fr-cal-intel-grid">';
            grCompKeys.forEach(function(slug) {
                var d = intel.byGrComponente[slug];
                html += '<div class="fr-cal-intel-card">'
                    + '<div class="fr-cal-intel-card-title">' + esc(d.label) + ' <span style="color:#666;">(n=' + d.n + ' / baseline=' + d.nBaseline + ')</span></div>'
                    + '<div class="fr-cal-intel-row"><span>Δ Score auto</span>' + fmtDelta(d.deltaScore, false) + '</div>'
                    + '<div class="fr-cal-intel-row"><span>Δ % Mutaciones</span>' + fmtDelta(d.deltaMutaciones, true) + '</div>'
                    + '<div class="fr-cal-intel-row"><span>Δ % Deformaciones</span>' + fmtDelta(d.deltaDeformaciones, true) + '</div>'
                    + '<div class="fr-cal-intel-row"><span>Δ % Blobs</span>' + fmtDelta(d.deltaBlobs, true) + '</div>'
                    + (d.confidence ? '<div class="fr-cal-intel-row"><span>Confianza</span><strong>' + esc(d.confidence) + '</strong></div>' : '')
                    + '</div>';
            });
            html += '</div>';
        }

        var ranking = intel.anomalyRanking || {};
        var rankDims = ['mutaciones', 'deformaciones', 'blobs'];
        var rankRows = [];
        rankDims.forEach(function(dim) {
            (ranking[dim] || []).forEach(function(c) {
                if (c.confidence !== 'insuficiente') rankRows.push({ dim: dim, c: c });
            });
        });
        if (rankRows.length) {
            var dimLabels = { mutaciones: 'Mutaciones', deformaciones: 'Deformaciones', blobs: 'Blobs' };
            html += '<h4 style="color:var(--text-secondary,#aaa);font-size:0.78rem;text-transform:uppercase;letter-spacing:.06em;margin:18px 0 10px;">🔬 Candidatos de riesgo</h4>';
            html += '<table class="fr-anomaly-table"><thead><tr><th>Anomalía</th><th>Candidato</th><th>Δ · Confianza</th></tr></thead><tbody>';
            rankRows.forEach(function(r) {
                html += '<tr>'
                    + '<td>' + (dimLabels[r.dim] || r.dim) + '</td>'
                    + '<td><span class="fr-anomaly-fuente fr-anomaly-fuente-' + esc(r.c.fuente.toLowerCase()) + '">' + esc(r.c.fuente) + '</span> ' + esc(r.c.label) + '</td>'
                    + '<td style="color:#ff8c8c;">+' + esc(String(r.c.delta)) + '% <span style="color:#888;font-size:0.78rem;">· ' + esc(r.c.confidence) + '</span></td>'
                    + '</tr>';
            });
            html += '</tbody></table>'
                + '<p style="font-size:0.76rem;color:#666;margin:6px 0 0;">Correlaciones observacionales. Verificá en SU/GR antes de concluir causalidad.</p>';
        }

        cont.innerHTML = html;
    }

    FR.subTab = function(which) {
        ['dash', 'activos', 'cosecha', 'archivo', 'experimentos', 'intel'].forEach(function(k) {
            var panel = document.getElementById('fr-sub-' + k);
            var btn = document.querySelector('.fr-subtab[data-frtab="' + k + '"]');
            if (panel) panel.classList.toggle('active', k === which);
            if (btn) btn.classList.toggle('active', k === which);
        });
        if (which === 'intel') _frCalRenderIntelPanel();
    };

    /** Click en tab 📈 Dashboard — siempre vuelve a vista general (limpia selección). */
    FR.goOverview = function() {
        selectedId = null;
        FR.subTab('dash');
        renderDashboard();
    };

    FR.goExperimentos = function() {
        FR.subTab('experimentos');
        renderExperimentos();
    };

    FR.select = function(id) {
        selectedId = id;
        FR.subTab('dash');
        renderAll();
    };

    FR.sync = function() {
        var r = sincronizarTodo();
        renderAll();
        try {
            alert('Sync completado.\nCreadas: ' + r.creadas +
                '\nYa existentes: ' + r.existentes +
                '\nSalteadas (sin GR): ' + r.salteadasSinGR);
        } catch (e) {}
        return r;
    };

    // ------------------------------------------------------
    // EDICION INLINE EN VIVO (sin modo edit global).
    // Cada campo editable del dashboard llama FR.updateField(field, valueRaw)
    // en su onchange. La funcion sanitiza, persiste y recalcula estado.
    // Campos read-only (sustrato seco, grano) NO llaman aqui.
    // fechaInicio SI llama aqui (corrección manual post-confirmación, ver caso
    // especial mas abajo) pero NO es la fuente de verdad del id — esa se fija
    // una sola vez en FR.confirmarBolsa() con la fecha elegida en Pendientes.
    // ------------------------------------------------------
    var _CAMPOS_FECHA = { fechaColonizacion: 1, fechaPines: 1, fechaCosecha: 1, fechaInicio: 1 };
    // pesoSustratoSeco y granoPorBolsa solo editables en bolsas huerfanas (se habilitan dinámicamente)
    // pesoSustratoSeco y granoPorBolsa solo editables en bolsas huérfanas.
    // pesoPrecosecha: entrada manual del operador antes de cada cosecha.
    var _CAMPOS_NUM = { temperatura: 1, pesoHumedoHidratado: 1, pesoSustratoSeco: 1, granoPorBolsa: 1, pesoPrecosecha: 1 };

    FR.updateField = function(field, valueRaw) {
        var b = getSelected();
        if (!b) return;
        var prevEstado = computeEstado(b);
        var raw = (valueRaw == null) ? '' : String(valueRaw).trim();

        if (_CAMPOS_FECHA[field]) {
            var nuevoValorFecha = raw === '' ? null : raw;
            if (field === 'fechaInicio' && nuevoValorFecha !== b.fechaInicio) {
                addObsTo(b, 'Fecha de armado corregida manualmente: ' +
                    (b.fechaInicio ? fmtFecha(b.fechaInicio) : '—') + ' → ' +
                    (nuevoValorFecha ? fmtFecha(nuevoValorFecha) : '—') +
                    '. El ID (' + b.id + ') no se modifica.', 'auto', 'none');
            }
            b[field] = nuevoValorFecha;
        } else if (_CAMPOS_NUM[field]) {
            b[field] = raw === '' ? null : num(raw);
        } else {
            // Campo desconocido — no hacer nada (defensivo).
            console.warn('[FR.updateField] campo no soportado:', field);
            return;
        }

        b.estado = computeEstado(b);
        if (b.estado !== prevEstado) {
            addObsTo(b, 'Estado: ' + prevEstado + ' -> ' + b.estado, 'auto', 'none');
        }
        // Si cambió sustrato seco recalcular BE de todas las oleadas
        if (field === 'pesoSustratoSeco') {
            recomputeFlushes(b);
            saveBolsas();
            // Refrescar tabla de flushes y métricas
            var fbodyEl = document.getElementById('frFlushBody');
            if (fbodyEl && b.flushes && b.flushes.length > 0) {
                fbodyEl.innerHTML = b.flushes.map(function(f, fidx) {
                    var pctBio = pctBiomasaFlush(f);
                    var pctBioTxt = (pctBio != null) ? fmt(pctBio, 1) + '%' : '—';
                    var calidad2 = f.calidad || null;
                    var calAutoHtml2 = calidad2
                        ? '<span class="fr-cal-badge fr-cal-badge-' + _frCalScoreClass(calidad2.scoreAuto) + '">' + calidad2.scoreAuto + '</span>'
                        : '<span class="fr-cal-badge fr-cal-badge-none">—</span>';
                    var calPersonalTxt2 = (calidad2 && calidad2.scorePersonal != null) ? calidad2.scorePersonal + '/10' : '—';
                    var calBtnTxt2 = calidad2 ? '✓ Cal.' : 'Evaluar';
                    var calBtnClass2 = calidad2 ? 'fr-cal-btn fr-cal-btn-done' : 'fr-cal-btn';
                    return '<tr class="fr-flush-row">'
                        + '<td><strong>F' + f.n + '</strong></td>'
                        + '<td><input type="datetime-local" class="fr-dash-input fr-flush-inline" id="frFlushF_' + fidx + '" value="' + esc(f.fecha || '') + '" onchange="FR.editFlush(' + fidx + ')"></td>'
                        + '<td><input type="number" step="0.1" class="fr-dash-input fr-flush-inline" id="frFlushH_' + fidx + '" value="' + esc(f.pesoHumedo != null ? f.pesoHumedo : '') + '" placeholder="g" onchange="FR.editFlush(' + fidx + ')"></td>'
                        + '<td><input type="datetime-local" class="fr-dash-input fr-flush-inline" id="frFlushFin_' + fidx + '" value="' + esc(f.finDeshidratacion || '') + '" onchange="FR.editFlush(' + fidx + ')"></td>'
                        + '<td><input type="number" step="0.1" class="fr-dash-input fr-flush-inline" id="frFlushS_' + fidx + '" value="' + esc(f.pesoSeco != null ? f.pesoSeco : '') + '" placeholder="g" onchange="FR.editFlush(' + fidx + ')"></td>'
                        + '<td id="frFlushPct_' + fidx + '">' + pctBioTxt + '</td>'
                        + '<td id="frFlushBEo_' + fidx + '">' + fmt(f.beOleada, 1) + '%</td>'
                        + '<td id="frFlushBEa_' + fidx + '">' + fmt(f.beAcumulado, 1) + '%</td>'
                        + '<td>' + calAutoHtml2 + '</td>'
                        + '<td style="color:#ffb83f;font-size:0.82rem;">' + calPersonalTxt2 + '</td>'
                        + '<td class="fr-flush-acciones">'
                        +   '<button type="button" class="' + calBtnClass2 + '" onclick="FR.openCalidad(' + fidx + ')">' + calBtnTxt2 + '</button>'
                        +   '<button type="button" class="fr-btn-icon fr-btn-del" title="Eliminar oleada F' + f.n + '" onclick="FR.deleteFlush(' + fidx + ')">&#128465;</button>'
                        + '</td>'
                        + '</tr>';
                }).join('');
            }
            var _be2 = beAcumulado(b.flushes);
            var _bh2 = biomasaHumedaTotal(b.flushes);
            var _bs2 = biomasaSecaTotal(b.flushes);
            set('frMBioHum', _bh2 > 0 ? fmt(_bh2, 1) + ' g' : '—');
            set('frMBioSec', _bs2 > 0 ? fmt(_bs2, 1) + ' g' : '—');
            set('frMBE', _be2 > 0 ? fmt(_be2, 1) + '%' : '—');
            renderIdTree(b);
        } else {
            saveBolsas();
        }

        // Si cambió grano actualizar árbol de identidad
        if (field === 'granoPorBolsa') renderIdTree(b);

        // Actualizar métricas de precosecha para todos los campos que las afectan:
        //   pesoHumedoHidratado → cambia el teórico
        //   granoPorBolsa       → cambia el teórico (solo huérfanas)
        //   pesoPrecosecha      → cambia la pérdida directamente
        // Llamada quirúrgica — NO re-renderiza el dashboard completo.
        var _PRECOSECHA_DEPS = { pesoHumedoHidratado: 1, granoPorBolsa: 1, pesoPrecosecha: 1 };
        if (_PRECOSECHA_DEPS[field]) {
            _renderPrecosechaMetrics(b);
        }

        // Refresco selectivo (no re-render completo del dashboard para no
        // perder foco si el usuario sigue tabulando).
        var hoy = hoyISO();
        var fechaRef = b.cicloCerrado && b.fechaCierreCiclo ? b.fechaCierreCiclo : hoy;
        var _diasDesdeInicio = diasEntre(b.fechaInicio, fechaRef);
        set('frDayNow', _diasDesdeInicio || 0);
        set('frDaysInicio', b.fechaInicio ? (_diasDesdeInicio > 0 ? ('hace ' + _diasDesdeInicio + ' d') : 'hoy') : '—');
        set('frDaysColon',   b.fechaColonizacion ? ('dia ' + (diasEntre(b.fechaInicio, b.fechaColonizacion) || 0)) : 'pendiente');
        set('frDaysPines',   b.fechaPines        ? ('dia ' + (diasEntre(b.fechaInicio, b.fechaPines) || 0))        : 'pendiente');
        set('frDaysCosecha', b.fechaCosecha      ? ('dia ' + (diasEntre(b.fechaInicio, b.fechaCosecha) || 0))      : 'pendiente');

        // Actualizar chip de estado por si cambió
        var _UF_ESTADO_LABELS = { 'ciclo cerrado': 'FIN DEL CICLO' };
        var stEl = document.getElementById('frDashState');
        if (stEl) {
            stEl.textContent = _UF_ESTADO_LABELS[b.estado] || b.estado;
            stEl.className = 'fr-chip ' +
                (b.estado === 'colonizando'   ? 'fr-chip-warn' :
                 b.estado === 'colonizado'    ? 'fr-chip-ok' :
                 b.estado === 'pinning'       ? 'fr-chip-warn' :
                 b.estado === 'cosechado'     ? 'fr-chip-ok' :
                 b.estado === 'ciclo cerrado' ? 'fr-chip-fin-ciclo' :
                 b.estado === 'contaminada'   ? 'fr-chip-bad' :
                 'fr-chip-neutral');
        }

        // Refrescar tablas (la bolsa puede haber cambiado de tab).
        renderActivos();
        renderCosecha();
        renderArchivo();
        renderObs(b);
    };

    // ------------------------------------------------------
    // CERRAR CICLO (reversible).
    // Marca cicloCerrado=true + fechaCierreCiclo, agrega obs y archiva.
    // No es destructivo: con FR.reabrirCiclo() se puede volver atras.
    // ------------------------------------------------------
    FR.cerrarCiclo = function() {
        var b = getSelected();
        if (!b) { alert('Selecciona una bolsa primero.'); return; }
        if (b.cicloCerrado === true) {
            if (!confirm('La bolsa ' + b.id + ' ya tiene el ciclo cerrado.\n\n¿Querés reabrirla?')) return;
            b.cicloCerrado = false;
            b.fechaCierreCiclo = null;
            addObsTo(b, 'Ciclo reabierto desde Archivo. Vuelve a Cosecha/Activo.', 'manual', 'yellow');
            b.estado = computeEstado(b);
            saveBolsas();
            renderAll();
            return;
        }
        if (b.contaminada === true) {
            alert('La bolsa ' + b.id + ' está marcada como CONTAMINADA. Cerrar ciclo no aplica.');
            return;
        }
        if (!confirm('Cerrar ciclo de la bolsa ' + b.id + '?\n\nLa bolsa se archivará en 🔴 Archivo.\nEs reversible: se puede reabrir desde Archivo.')) return;

        var prevEstado = computeEstado(b);
        b.cicloCerrado = true;
        var _lastFecha = null;
        (b.flushes || []).forEach(function(f) {
            if (f && f.fecha && (!_lastFecha || f.fecha > _lastFecha)) _lastFecha = f.fecha;
        });
        b.fechaCierreCiclo = _lastFecha ? _lastFecha.substring(0, 10) : hoyISO();
        addObsTo(b, 'Ciclo cerrado manualmente. Bolsa archivada.', 'manual', 'none');
        b.estado = computeEstado(b);
        if (b.estado !== prevEstado) {
            addObsTo(b, 'Estado: ' + prevEstado + ' -> ' + b.estado, 'auto', 'none');
        }
        saveBolsas();
        renderAll();
    };

    // ------------------------------------------------------
    // Marcar bolsa como CONTAMINADA.
    // Accion irreversible: setea contaminada=true + fechaContaminacion,
    // agrega observacion manual roja y dispara renderAll. La bolsa pasa
    // automaticamente a Historico porque computeEstado() trata
    // contaminada===true como estado terminal.
    // ------------------------------------------------------
    FR.marcarContaminada = function() {
        var b = getSelected();
        if (!b) { alert('Selecciona una bolsa primero.'); return; }
        if (b.contaminada === true) {
            alert('La bolsa ' + b.id + ' ya esta marcada como contaminada.');
            return;
        }
        var msg = 'Marcar la bolsa ' + b.id + ' como CONTAMINADA?\n\n' +
                  'La bolsa se archivara en Historico de inmediato.\n' +
                  'Esta accion es irreversible.';
        if (!confirm(msg)) return;

        var prevEstado = computeEstado(b);
        b.contaminada = true;
        b.fechaContaminacion = hoyISO();
        addObsTo(b, 'Bolsa marcada como CONTAMINADA desde FR. Archivada en Historico.', 'manual', 'red');
        b.estado = computeEstado(b);
        if (b.estado !== prevEstado) {
            addObsTo(b, 'Estado: ' + prevEstado + ' -> ' + b.estado, 'auto', 'none');
        }

        saveBolsas();
        renderAll();
    };

    FR.recomputeFlushesLive = function() {
        var b = getSelected();
        if (!b || !Array.isArray(b.flushes)) return;
        var acc = 0;
        var totHum = 0;
        var totSec = 0;
        b.flushes.forEach(function(f, idx) {
            var inpH = document.getElementById('frFlushH_' + idx);
            var inpS = document.getElementById('frFlushS_' + idx);
            var hum = inpH && inpH.value !== '' ? num(inpH.value) : 0;
            var sec = inpS && inpS.value !== '' ? num(inpS.value) : null;
            var bo = beOleada(hum, b.pesoSustratoSeco);
            acc += bo;
            totHum += hum;
            if (sec != null) totSec += sec;
            var pct = (hum > 0 && sec != null && sec > 0) ? (sec / hum) * 100 : null;
            var beOEl = document.getElementById('frFlushBEo_' + idx);
            var beAEl = document.getElementById('frFlushBEa_' + idx);
            var pctEl = document.getElementById('frFlushPct_' + idx);
            if (beOEl) beOEl.textContent = fmt(bo, 1) + '%';
            if (beAEl) beAEl.textContent = fmt(acc, 1) + '%';
            if (pctEl) pctEl.textContent = pct != null ? fmt(pct, 1) + '%' : '—';
        });
        set('frMBE', acc > 0 ? fmt(acc, 1) + '%' : '—');
        set('frMBioHum', totHum > 0 ? fmt(totHum, 1) + ' g' : '—');
        set('frMBioSec', totSec > 0 ? fmt(totSec, 1) + ' g' : '—');
    };

    // ------------------------------------------------------
    // Edicion INLINE por oleada (sin modo edicion global).
    // El usuario carga la oleada al principio con peso humedo,
    // y dias despues completa fin de deshidratacion + peso seco.
    // Cada cambio se persiste al instante.
    // ------------------------------------------------------
    FR.editFlush = function(idx) {
        var b = getSelected();
        if (!b || !Array.isArray(b.flushes) || !b.flushes[idx]) return;
        var f = b.flushes[idx];

        var inpF = document.getElementById('frFlushF_' + idx);
        var inpH = document.getElementById('frFlushH_' + idx);
        var inpFin = document.getElementById('frFlushFin_' + idx);
        var inpS = document.getElementById('frFlushS_' + idx);

        var prevSeco = f.pesoSeco;
        var prevFin = f.finDeshidratacion;

        if (inpF) f.fecha = inpF.value || f.fecha;
        if (inpH) f.pesoHumedo = (inpH.value !== '') ? num(inpH.value) : f.pesoHumedo;
        if (inpFin) f.finDeshidratacion = (inpFin.value !== '') ? inpFin.value : null;
        if (inpS) f.pesoSeco = (inpS.value !== '') ? num(inpS.value) : null;

        recomputeFlushes(b);
        var prevEstado = b.estado;
        b.estado = computeEstado(b);

        // Observaciones automaticas: cuando el usuario completa el seco por primera vez,
        // o cuando marca fin de deshidratacion.
        if (prevSeco == null && f.pesoSeco != null && f.pesoSeco > 0) {
            addObsTo(b, 'F' + f.n + ' - Peso seco registrado: ' + fmt(f.pesoSeco, 1) + ' g - BE ' + fmt(f.beOleada, 1) + '%', 'auto', 'green');
        }
        if (!prevFin && f.finDeshidratacion) {
            addObsTo(b, 'F' + f.n + ' - Fin de deshidratacion: ' + fmtFechaHora(f.finDeshidratacion), 'auto', 'none');
        }
        if (b.estado !== prevEstado) {
            addObsTo(b, 'Estado: ' + prevEstado + ' -> ' + b.estado, 'auto', 'none');
        }

        saveBolsas();

        // Actualizar metricas visibles sin re-renderizar toda la tabla
        // (re-render cambiaria el foco del input mientras el usuario escribe).
        var pct = pctBiomasaFlush(f);
        var pctEl = document.getElementById('frFlushPct_' + idx);
        var beOEl = document.getElementById('frFlushBEo_' + idx);
        var beAEl = document.getElementById('frFlushBEa_' + idx);
        if (pctEl) pctEl.textContent = pct != null ? fmt(pct, 1) + '%' : '—';
        if (beOEl) beOEl.textContent = fmt(f.beOleada, 1) + '%';
        // Recompute & update all beAcumulado cells (they cascade)
        var acc = 0, totH = 0, totS = 0;
        b.flushes.forEach(function(fi, i) {
            acc += (fi.beOleada || 0);
            totH += (fi.pesoHumedo || 0);
            if (fi.pesoSeco != null) totS += fi.pesoSeco;
            var beA = document.getElementById('frFlushBEa_' + i);
            if (beA) beA.textContent = fmt(fi.beAcumulado, 1) + '%';
        });
        set('frMBE', acc > 0 ? fmt(acc, 1) + '%' : '—');
        set('frMBioHum', totH > 0 ? fmt(totH, 1) + ' g' : '—');
        set('frMBioSec', totS > 0 ? fmt(totS, 1) + ' g' : '—');

        // Refresh observaciones (nuevas notas auto)
        renderObs(b);
        // Refresh tabs (estado may have changed → bolsa puede haber cambiado de tab)
        renderActivos();
        renderCosecha();
        renderArchivo();
    };

    FR.deleteFlush = function(idx) {
        var b = getSelected();
        if (!b || !Array.isArray(b.flushes) || !b.flushes[idx]) return;
        var f = b.flushes[idx];
        if (!confirm('Eliminar oleada F' + f.n + ' ? Esta accion no se puede deshacer.')) return;

        b.flushes.splice(idx, 1);
        // Renumerar oleadas restantes
        b.flushes.forEach(function(fi, i) { fi.n = i + 1; });
        recomputeFlushes(b);

        var prevFlushEstado = b.estado;
        b.estado = computeEstado(b);
        addObsTo(b, 'Oleada F' + f.n + ' eliminada (' + fmt(f.pesoHumedo, 1) + ' g humedo).', 'auto', 'yellow');
        if (b.estado !== prevFlushEstado) {
            addObsTo(b, 'Estado: ' + prevFlushEstado + ' -> ' + b.estado, 'auto', 'none');
        }

        saveBolsas();
        renderAll();
    };

    FR.cerrarOleada = function() {
        var b = getSelected();
        if (!b) { alert('Selecciona una bolsa primero.'); return; }

        var fecha = (document.getElementById('frFlushFecha') || {}).value || ahoraISOLocal();
        var hum = num((document.getElementById('frFlushHumedo') || {}).value);

        if (hum <= 0) { alert('Ingresa peso humedo de la oleada.'); return; }

        if (!Array.isArray(b.flushes)) b.flushes = [];
        var n = b.flushes.length + 1;
        var bo = beOleada(hum, b.pesoSustratoSeco);
        b.flushes.push({
            n: n,
            fecha: fecha,
            finDeshidratacion: null,
            pesoHumedo: hum,
            pesoSeco: null,
            beOleada: bo,
            beAcumulado: 0,
            pctBiomasa: null,
            tiempoDeshidratacion: null
        });
        recomputeFlushes(b);

        if (!b.fechaCosecha) {
            b.fechaCosecha = typeof fecha === 'string' ? fecha.substring(0, 10) : fecha;
        }

        addObsTo(b, 'Cosecha F' + n + ': ' + fmt(hum, 1) + ' g humedo, BE ' + fmt(bo, 1) + '%', 'auto', 'none');

        b.estado = computeEstado(b);
        saveBolsas();

        ['frFlushFecha', 'frFlushHumedo'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.value = '';
        });

        renderAll();
    };

    FR.addObs = function() {
        var b = getSelected();
        if (!b) return;
        var input = document.getElementById('frObsInput');
        var selEst = document.getElementById('frObsEstado');
        if (!input) return;
        var texto = String(input.value || '').trim();
        if (!texto) return;
        var estado = (selEst && ESTADOS_OBS[selEst.value]) ? selEst.value : 'none';
        addObsTo(b, texto, 'manual', estado);
        saveBolsas();
        input.value = '';
        if (selEst) selEst.value = 'none';
        renderObs(b);
    };

    // ======================================================
    // RENOMBRE DE ID DE BOLSA FR
    // ======================================================
    /**
     * Renombra el id visible de una bolsa identificada por su _frUuid interno.
     * El _frUuid nunca cambia; el id visible pasa de idAnterior a idNuevo.
     * Actualiza selectedId si la bolsa estaba seleccionada.
     * Deja una observación automática en el log de la bolsa.
     * NO dispara renderAll: lo hace el caller para evitar renders dobles.
     * Retorna true si el rename fue exitoso, false si falló (con alert al usuario).
     */
    function _frRenombrarId(frUuid, idAnterior, idNuevo) {
        idNuevo = idNuevo.trim();
        if (!frUuid || !idAnterior || !idNuevo) return false;
        if (idAnterior === idNuevo) return false;
        // Validar unicidad: ninguna otra bolsa puede tener el id nuevo
        if (bolsas.some(function(b) { return b.id === idNuevo && b._frUuid !== frUuid; })) {
            alert('Ya existe una bolsa con el ID "' + idNuevo + '". Elegí uno distinto.');
            return false;
        }
        var encontrada = false;
        bolsas.forEach(function(b) {
            if (b._frUuid === frUuid) {
                b.id = idNuevo;
                addObsTo(b, 'ID de bolsa renombrado: ' + idAnterior + ' → ' + idNuevo + '.', 'auto', 'none');
                encontrada = true;
            }
        });
        if (!encontrada) return false;
        // Mantener selectedId sincronizado
        if (selectedId === idAnterior) selectedId = idNuevo;
        saveBolsas();
        // Notificar a SU si está montado (para que refresque los badges)
        try { window.dispatchEvent(new Event('fr-bolsa-renombrada')); } catch (e) {}
        return true;
    }

    /**
     * Activa el modo edición del ID en el panel de detalle.
     * Oculta el display de texto y muestra el input + botones confirmar/cancelar.
     */
    FR.activarEdicionId = function() {
        var display = document.getElementById('frIdDisplay');
        var input   = document.getElementById('frIdInput');
        var btnEdit = document.getElementById('frIdEditBtn');
        var btnOk   = document.getElementById('frIdConfirmBtn');
        var btnX    = document.getElementById('frIdCancelBtn');
        if (!display || !input) return;
        display.style.display = 'none';
        if (btnEdit) btnEdit.style.display = 'none';
        input.style.display = '';
        if (btnOk) btnOk.style.display = '';
        if (btnX)  btnX.style.display  = '';
        input.focus();
        input.select();
    };

    /**
     * Cancela la edición del ID: vuelve al valor actual sin guardar nada.
     */
    FR.cancelarRenombreId = function() {
        var b = getSelected();
        var input = document.getElementById('frIdInput');
        if (b && input) input.value = b.id;
        _frRestaurarDisplayId();
    };

    /**
     * Confirma el rename: llama a _frRenombrarId y vuelve a renderizar.
     */
    FR.confirmarRenombreId = function() {
        var b = getSelected();
        if (!b) return;
        var input = document.getElementById('frIdInput');
        if (!input) return;
        var nuevo = input.value.trim();
        if (!nuevo) { alert('El ID no puede estar vacío.'); return; }
        var ok = _frRenombrarId(b._frUuid, b.id, nuevo);
        if (ok) {
            renderAll();
        } else {
            // Rename falló (alerta ya mostrada por _frRenombrarId o id igual).
            // Restaurar display con valor actual sin cambios.
            _frRestaurarDisplayId();
        }
    };

    /** Restaura la UI al modo solo-lectura (display visible, input oculto). */
    function _frRestaurarDisplayId() {
        var display = document.getElementById('frIdDisplay');
        var input   = document.getElementById('frIdInput');
        var btnEdit = document.getElementById('frIdEditBtn');
        var btnOk   = document.getElementById('frIdConfirmBtn');
        var btnX    = document.getElementById('frIdCancelBtn');
        if (display) display.style.display = '';
        if (btnEdit) btnEdit.style.display = '';
        if (input)   input.style.display   = 'none';
        if (btnOk)   btnOk.style.display   = 'none';
        if (btnX)    btnX.style.display     = 'none';
    }

    FR.eliminar = function(id) {
        if (!confirm('Eliminar registro FR ' + id + '? Esta accion no se puede deshacer.')) return;
        bolsas = bolsas.filter(function(b) { return b.id !== id; });
        if (selectedId === id) selectedId = null;
        saveBolsas();
        renderAll();
    };

    FR.eliminarTodo = function() {
        if (bolsas.length === 0) { alert('FR ya está vacío.'); return; }
        if (!confirm('⚠️ ELIMINAR TODOS LOS REGISTROS FR (' + bolsas.length + ' bolsas)?\n\nEsta acción borra absolutamente todo el historial de fructificación.\nNo se puede deshacer.')) return;
        if (!confirm('Segunda confirmación: ¿Estás seguro? Se eliminarán ' + bolsas.length + ' registros de forma permanente.')) return;
        bolsas = [];
        selectedId = null;
        saveBolsas();
        renderAll();
        alert('✅ Todos los registros FR eliminados.');
    };

    // ======================================================
    // EXPERIMENTOS (🔬 EX)
    // ======================================================

    function loadExperimentos() {
        try {
            var raw = localStorage.getItem(FR_EX_KEY);
            experimentos = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(experimentos)) experimentos = [];
        } catch(e) {
            experimentos = [];
        }
    }

    function saveExperimentos() {
        try {
            localStorage.setItem(FR_EX_KEY, JSON.stringify(experimentos));
        } catch(e) { console.warn('[FR-EX] saveExperimentos:', e); }
    }

    // ID: EX + dia2d + mes. Colisión → sufijo b, c, d...
    function genExId(fecha) {
        var d = fecha ? new Date(fecha + 'T00:00:00') : new Date();
        var dia = String(d.getDate()).padStart(2, '0');
        var mes = String(d.getMonth() + 1);
        var base = 'EX' + dia + mes;
        var existIds = {};
        experimentos.forEach(function(e) { existIds[e.id] = true; });
        if (!existIds[base]) return base;
        var sufijos = 'bcdefghijklmnopqrstuvwxyz'.split('');
        for (var i = 0; i < sufijos.length; i++) {
            var cand = base + sufijos[i];
            if (!existIds[cand]) return cand;
        }
        return base + Date.now();
    }

    function _frExGenUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    function getExperimentoByUuid(uuid) {
        return experimentos.find(function(e) { return e._exUuid === uuid; }) || null;
    }

    // Suma CI consumida por todos los experimentos (excluye excludeUuid si se pasa)
    function _frExConsumedCI(ciId, excludeUuid) {
        return experimentos.reduce(function(sum, ex) {
            if (excludeUuid && ex._exUuid === excludeUuid) return sum;
            if (!Array.isArray(ex.insumos)) return sum;
            return sum + ex.insumos.reduce(function(s, ins) {
                return (ins.tipo === 'ci' && ins.ciId === ciId)
                    ? s + (parseInt(ins.cantidad) || 0) : s;
            }, 0);
        }, 0);
    }

    // Suma GR consumida por todos los experimentos (excluye excludeUuid si se pasa)
    function _frExConsumedGR(loteId, tandaId, excludeUuid) {
        return experimentos.reduce(function(sum, ex) {
            if (excludeUuid && ex._exUuid === excludeUuid) return sum;
            if (!Array.isArray(ex.insumos)) return sum;
            return sum + ex.insumos.reduce(function(s, ins) {
                return (ins.tipo === 'gr' && ins.grLoteId === loteId && ins.grTandaId === tandaId)
                    ? s + (parseFloat(ins.cantidad) || 0) : s;
            }, 0);
        }, 0);
    }

    // Stock CI disponible desde perspectiva FR (descuenta experimentos)
    function _frExStockCI(ciId, excludeUuid) {
        try {
            var arr = JSON.parse(localStorage.getItem('bl2_cultivos') || '[]');
            var c = Array.isArray(arr) ? arr.find(function(x) { return x && x.id === ciId; }) : null;
            if (!c) return 0;
            var base = 0;
            if (window.CiGrLinks && typeof window.CiGrLinks.stockEfectivoByCultivo === 'function') {
                try { base = window.CiGrLinks.stockEfectivoByCultivo(ciId, c.cantidadInicial); }
                catch(e) { base = c.cantidadDisponible || 0; }
            } else {
                base = c.cantidadDisponible || 0;
            }
            return Math.max(0, base - _frExConsumedCI(ciId, excludeUuid));
        } catch(e) { return 0; }
    }

    // Stock GR disponible desde perspectiva FR (descuenta SU + experimentos)
    function _frExStockGR(loteId, tandaId, excludeUuid) {
        try {
            var lotes = JSON.parse(localStorage.getItem('gr_lotes') || '[]');
            var lote = Array.isArray(lotes) ? lotes.find(function(l) { return l.id === loteId; }) : null;
            if (!lote || !Array.isArray(lote.dg)) return 0;
            var tanda = lote.dg.find(function(r) { return r.tanda === tandaId; });
            if (!tanda) return 0;
            var frascos = parseFloat(tanda.frascos) || 0;
            var contam = parseInt(tanda.contaminados) || 0;
            var usadosMap = {};
            try { usadosMap = JSON.parse(localStorage.getItem('gr_usados') || '{}'); } catch(e) {}
            var usadosSU = (usadosMap[loteId] && usadosMap[loteId][tandaId])
                ? parseInt(usadosMap[loteId][tandaId]) || 0 : 0;
            var usadosEX = _frExConsumedGR(loteId, tandaId, excludeUuid);
            return Math.max(0, frascos - contam - usadosSU - usadosEX);
        } catch(e) { return 0; }
    }

    FR.cerrarModalExperimento = function() {
        var m = document.getElementById('frModalExperimento');
        if (m) m.style.display = 'none';
    };

    // uuid = null → nuevo; uuid = '_exUuid' → editar existente
    FR.abrirModalExperimento = function(uuid) {
        var m = document.getElementById('frModalExperimento');
        if (!m) { console.warn('[FR-EX] Modal no encontrado'); return; }

        var ex = uuid ? getExperimentoByUuid(uuid) : null;
        if (uuid && !ex) { console.warn('[FR-EX] Experimento no encontrado:', uuid); return; }
        var esEdicion = !!ex;

        // Título
        var titulo = document.getElementById('frExModalTitle');
        if (titulo) titulo.textContent = esEdicion ? '✏️ Editar experimento' : '🔬 Nuevo experimento';

        // UUID oculto
        var uuidEl = document.getElementById('frExUuid');
        if (uuidEl) uuidEl.value = esEdicion ? ex._exUuid : '';

        // ID
        var idEl = document.getElementById('frExId');
        if (idEl) idEl.value = esEdicion ? ex.id : genExId(null);

        // Fecha inicio (datetime-local)
        var fechaEl = document.getElementById('frExFecha');
        if (fechaEl) fechaEl.value = esEdicion ? (ex.fecha || ahoraISOLocal()) : ahoraISOLocal();
        var fechaFinEl = document.getElementById('frExFechaFin');
        if (fechaFinEl) fechaFinEl.value = esEdicion ? (ex.fechaFin || '') : '';

        // Hipótesis y Resultado
        var hipEl = document.getElementById('frExHipotesis');
        if (hipEl) hipEl.value = esEdicion ? (ex.hipotesis || '') : '';
        var resEl = document.getElementById('frExResultado');
        if (resEl) resEl.value = esEdicion ? (ex.resultados || '') : '';

        // Poblar selectores
        _frExPoblarGenetica(ex);
        _frExPoblarBase(ex);
        _frExPoblarBaseC(ex);
        _frExPoblarCI(ex);
        _frExPoblarGR(ex);
        _frExPoblarSU(ex);

        m.style.display = 'flex';
    };

    function _frExPoblarGenetica(ex) {
        var sel = document.getElementById('frExGeneticaSelect');
        var inp = document.getElementById('frExGeneticaFull');
        if (!sel) return;
        var opciones = '<option value="">— Seleccionar genética —</option>';
        try {
            if (window.ge && typeof window.ge.getSelectableGenetics === 'function') {
                window.ge.getSelectableGenetics().forEach(function(g) {
                    opciones += '<option value="' + esc(g.id) + '" data-label="' + esc(g.label) + '">' + esc(g.label) + '</option>';
                });
            } else {
                var raw = localStorage.getItem('biolab.ge.v4');
                if (raw) {
                    var parsed = JSON.parse(raw);
                    var nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
                    var getNode = function(id) { return nodes.find(function(n) { return n.id === id; }) || null; };
                    var parents = {};
                    nodes.forEach(function(n) { if (n.parentId) parents[n.parentId] = true; });
                    nodes.filter(function(n) { return !parents[n.id]; }).forEach(function(fNode) {
                        var chain = [], cur = fNode;
                        while (cur) { chain.unshift(cur); cur = cur.parentId ? getNode(cur.parentId) : null; }
                        var label = chain.map(function(n) { return n.name; }).join(' / ');
                        opciones += '<option value="' + esc(fNode.id) + '" data-label="' + esc(label) + '">' + esc(label) + '</option>';
                    });
                }
            }
        } catch(e) {}
        sel.innerHTML = opciones;
        if (ex && ex.fenId) sel.value = ex.fenId;
        if (inp) inp.value = ex ? (ex.geneticaFull || '') : '';
        if (inp) inp.dataset.autofill = 'auto';
    }

    FR.exOnGeneticaSelect = function() {
        var sel = document.getElementById('frExGeneticaSelect');
        var inp = document.getElementById('frExGeneticaFull');
        if (!sel || !inp) return;
        var opt = sel.options[sel.selectedIndex];
        if (opt && opt.dataset.label) inp.value = opt.dataset.label;
        if (inp) inp.dataset.autofill = '';
    };

    function _frExPoblarBase(ex) {
        var sel = document.getElementById('frExBase');
        if (!sel) return;
        var archivadas = bolsas.filter(function(b) {
            return b.cancelada === true || b.contaminada === true || b.cicloCerrado === true;
        }).sort(function(a, b) { return (b.ts || 0) - (a.ts || 0); });
        var opts = '<option value="">— Sin base (desde insumos directos) —</option>';
        archivadas.forEach(function(b) {
            var label = (b.id || '—') + ' · ' + (b.geneticaFull || b.genetica || '—');
            opts += '<option value="' + esc(b._frUuid) + '" data-id="' + esc(b.id) + '" data-desc="' + esc(label) + '">' + esc(label) + '</option>';
        });
        sel.innerHTML = opts;
        if (ex && ex.baseFrUuid) sel.value = ex.baseFrUuid;
    }

    function _frExPoblarBaseC(ex) {
        var sel = document.getElementById('frExBaseC');
        if (!sel) return;
        var cosechadas = bolsas.filter(esCosecha).sort(function(a, b) { return (b.ts || 0) - (a.ts || 0); });
        var opts = '<option value="">— Sin base cosechada —</option>';
        cosechadas.forEach(function(b) {
            var label = (b.id || '—') + ' · ' + (b.geneticaFull || b.genetica || '—') + ' · ' + (b.flushes ? b.flushes.length : 0) + ' flush(es)';
            opts += '<option value="' + esc(b._frUuid) + '" data-id="' + esc(b.id) + '" data-desc="' + esc(label) + '">' + esc(label) + '</option>';
        });
        sel.innerHTML = opts;
        if (ex && ex.baseFrUuidC) sel.value = ex.baseFrUuidC;
    }

    function _frExPoblarCI(ex) {
        var sel = document.getElementById('frExCiSelect');
        var cantEl = document.getElementById('frExCiCantidad');
        if (!sel) return;
        var excludeUuid = ex ? ex._exUuid : null;
        var opts = '<option value="">— Ninguno —</option>';
        try {
            var arr = JSON.parse(localStorage.getItem('bl2_cultivos') || '[]');
            if (Array.isArray(arr)) {
                arr.filter(function(c) { return c && c.id && c.estado !== 'DESCARTADO'; }).forEach(function(c) {
                    var stock = _frExStockCI(c.id, excludeUuid);
                    var label = (c.codigo || c.id) + ' · ' + (c.geneticaSnapshot && c.geneticaSnapshot.label ? c.geneticaSnapshot.label : (c.geneticaId || '')) + ' · ' + stock + ' disp.';
                    var isAgotado = stock <= 0;
                    var disabledAttr = (isAgotado && !ex) ? ' disabled' : '';
                    var agotadoTag = isAgotado ? ' [AGOTADO]' : '';
                    opts += '<option value="' + esc(c.id) + '" data-label="' + esc(label) + '" data-stock="' + stock + '"' + disabledAttr + '>' + esc(label + agotadoTag) + '</option>';
                });
            }
        } catch(e) {}
        sel.innerHTML = opts;
        if (ex && ex.insumos) {
            var ciIns = ex.insumos.find(function(i) { return i.tipo === 'ci'; });
            if (ciIns) {
                sel.value = ciIns.ciId;
                if (cantEl) cantEl.value = ciIns.cantidad || '';
            }
        }
        FR.exActualizarDispCI();
    }

    FR.exOnCiSelect = function() {
        FR.exActualizarDispCI();
        // Auto-fill genetics from CI placa
        var sel = document.getElementById('frExCiSelect');
        var _gInp = document.getElementById('frExGeneticaFull');
        if (!sel || !sel.value || !_gInp || _gInp.dataset.autofill === '') return;
        var _cultivos = [];
        try { _cultivos = JSON.parse(localStorage.getItem('bl2_cultivos') || '[]'); } catch(e) {}
        var _ci = _cultivos.find(function(c) { return c && c.id === sel.value; });
        var _ciGen = (_ci && _ci.geneticaSnapshot && _ci.geneticaSnapshot.label)
            ? _ci.geneticaSnapshot.label
            : (_ci && _ci.geneticaId ? _ci.geneticaId : '');
        if (_ciGen) { _gInp.value = _ciGen; _gInp.dataset.autofill = 'auto'; }
    };

    FR.exActualizarDispCI = function() {
        var sel = document.getElementById('frExCiSelect');
        var disp = document.getElementById('frExCiDisp');
        var cantEl = document.getElementById('frExCiCantidad');
        if (!sel || !disp) return;
        if (!sel.value) { disp.textContent = '— disp.'; disp.style.color = '#888'; return; }
        var excludeUuid = (document.getElementById('frExUuid') || {}).value || null;
        var stock = _frExStockCI(sel.value, excludeUuid);
        var cant = parseInt((cantEl || {}).value) || 0;
        var restante = stock - cant;
        disp.textContent = stock + ' disp.' + (cant > 0 ? ' → ' + restante + ' tras consumo' : '');
        disp.style.color = restante < 0 ? '#e06c75' : restante === 0 ? '#FFC000' : '#98c379';
    };

    function _frExPoblarGR(ex) {
        var loteSel = document.getElementById('frExGrLoteSelect');
        if (!loteSel) return;
        var opts = '<option value="">— Ninguno —</option>';
        try {
            var lotes = JSON.parse(localStorage.getItem('gr_lotes') || '[]');
            var excludeUuidForFilter = (document.getElementById('frExUuid') || {}).value || null;
            var grInsLoteId = (ex && ex.insumos) ? (ex.insumos.find(function(i) { return i.tipo === 'gr'; }) || {}).grLoteId : null;
            if (Array.isArray(lotes)) {
                lotes.forEach(function(l) {
                    // Always include the currently assigned lote in edit mode
                    if (l.id === grInsLoteId) {
                        opts += '<option value="' + esc(l.id) + '">' + esc(l.id + (l.nombre ? ' · ' + l.nombre : '')) + '</option>';
                        return;
                    }
                    // Only include if at least 1 tanda has stock > 0
                    var hasStock = Array.isArray(l.dg) && l.dg.some(function(t) {
                        return _frExStockGR(l.id, t.tanda, excludeUuidForFilter) > 0;
                    });
                    if (hasStock) {
                        opts += '<option value="' + esc(l.id) + '">' + esc(l.id + (l.nombre ? ' · ' + l.nombre : '')) + '</option>';
                    }
                });
            }
        } catch(e) {}
        loteSel.innerHTML = opts;
        if (ex && ex.insumos) {
            var grIns = ex.insumos.find(function(i) { return i.tipo === 'gr'; });
            if (grIns) {
                loteSel.value = grIns.grLoteId;
                FR.exOnGrLoteSelect();
                var tandaSel = document.getElementById('frExGrTandaSelect');
                if (tandaSel) tandaSel.value = grIns.grTandaId;
                var cantEl = document.getElementById('frExGrCantidad');
                if (cantEl) cantEl.value = grIns.cantidad || '';
            }
        }
        FR.exActualizarDispGR();
    }

    FR.exOnGrLoteSelect = function() {
        var loteSel = document.getElementById('frExGrLoteSelect');
        var tandaSel = document.getElementById('frExGrTandaSelect');
        if (!loteSel || !tandaSel) return;
        var loteId = loteSel.value;
        var opts = '<option value="">— —</option>';
        if (loteId) {
            try {
                var lotes = JSON.parse(localStorage.getItem('gr_lotes') || '[]');
                var lote = Array.isArray(lotes) ? lotes.find(function(l) { return l.id === loteId; }) : null;
                if (lote && Array.isArray(lote.dg)) {
                    var excludeUuid = (document.getElementById('frExUuid') || {}).value || null;
                    // In edit mode, always include the currently selected tanda
                    var currentTandaVal = tandaSel.value || '';
                    lote.dg.forEach(function(r) {
                        var disp = _frExStockGR(loteId, r.tanda, excludeUuid);
                        var gen = r.genetica ? (' · ' + r.genetica) : '';
                        if (disp > 0 || r.tanda === currentTandaVal) {
                            opts += '<option value="' + esc(r.tanda) + '">' + esc(r.tanda) + esc(gen) + ' · ' + disp + ' disp.</option>';
                        }
                    });
                }
            } catch(e) {}
        }
        tandaSel.innerHTML = opts;
        FR.exActualizarDispGR();
    };

    FR.exActualizarDispGR = function() {
        var loteSel = document.getElementById('frExGrLoteSelect');
        var tandaSel = document.getElementById('frExGrTandaSelect');
        var cantEl = document.getElementById('frExGrCantidad');
        var disp = document.getElementById('frExGrDisp');
        if (!disp) return;
        var loteId = (loteSel || {}).value;
        var tandaId = (tandaSel || {}).value;
        if (!loteId || !tandaId) { disp.textContent = '— disp.'; disp.style.color = '#888'; return; }
        var excludeUuid = (document.getElementById('frExUuid') || {}).value || null;
        var stock = _frExStockGR(loteId, tandaId, excludeUuid);
        // Auto-fill genetics from tanda if field allows autofill
        var _gInp = document.getElementById('frExGeneticaFull');
        if (_gInp && _gInp.dataset.autofill !== '' && loteId && tandaId) {
            var _gLotes = [];
            try { _gLotes = JSON.parse(localStorage.getItem('gr_lotes') || '[]'); } catch(e) {}
            var _gLote = _gLotes.find(function(l) { return l.id === loteId; });
            var _gDg = (_gLote && Array.isArray(_gLote.dg)) ? _gLote.dg.find(function(t) { return t.tanda === tandaId; }) : null;
            var _gGen = (_gDg && _gDg.genetica) ? _gDg.genetica : '';
            if (_gGen) { _gInp.value = _gGen; _gInp.dataset.autofill = 'auto'; }
        }
        var cant = parseFloat((cantEl || {}).value) || 0;
        var restante = stock - cant;
        var _fmtF = function(n) { return (n === Math.floor(n)) ? String(n) : parseFloat(n).toFixed(1); };
        disp.textContent = _fmtF(stock) + ' disp.' + (cant > 0 ? ' → ' + _fmtF(restante) + ' tras consumo' : '');
        disp.style.color = restante < 0 ? '#e06c75' : restante === 0 ? '#FFC000' : '#98c379';
    };

    function _frExPoblarSU(ex) {
        var sel = document.getElementById('frExSuSelect');
        if (!sel) return;
        var opts = '<option value="">— Ninguno —</option>';
        try {
            var lotes = JSON.parse(localStorage.getItem('su_lotes') || '[]');
            if (Array.isArray(lotes)) {
                lotes.slice().reverse().forEach(function(l) {
                    opts += '<option value="' + esc(l.id) + '">' + esc(l.id || '—') + '</option>';
                });
            }
        } catch(e) {}
        sel.innerHTML = opts;
        if (ex && ex.insumos) {
            var suIns = ex.insumos.find(function(i) { return i.tipo === 'su'; });
            if (suIns) sel.value = suIns.suLoteId || '';
        }
    }

    FR.guardarExperimento = function() {
        var get = function(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };

        var id = get('frExId');
        if (!id) { alert('El ID del experimento es obligatorio.'); return; }

        var uuidEdicion = get('frExUuid');
        var esEdicion = !!uuidEdicion;

        // Validar unicidad de ID (excluyendo el propio en edición)
        var idConflicto = experimentos.find(function(e) {
            return e.id === id && e._exUuid !== uuidEdicion;
        });
        if (idConflicto) { alert('Ya existe un experimento con ID "' + id + '". Elegí uno distinto.'); return; }

        var fecha = get('frExFecha') || ahoraISOLocal();
        var fechaFin = get('frExFechaFin') || null;

        // Genética
        var selGen = document.getElementById('frExGeneticaSelect');
        var fenId = selGen ? selGen.value : '';
        var geneticaFull = get('frExGeneticaFull');
        var parts = geneticaFull ? geneticaFull.split('/').map(function(s) { return s.trim(); }) : [];
        var fenotipo = parts.length > 0 ? parts[parts.length - 1] : '';
        var genetica = parts.length > 1 ? parts.slice(0, -1).join(' / ') : '';

        // Base material — Archivo
        var baseSel = document.getElementById('frExBase');
        var baseFrUuid = baseSel ? baseSel.value : '';
        var baseFrId = '';
        var baseFrDesc = '';
        if (baseSel && baseFrUuid) {
            var baseOpt = baseSel.options[baseSel.selectedIndex];
            if (baseOpt) { baseFrId = baseOpt.dataset.id || ''; baseFrDesc = baseOpt.dataset.desc || ''; }
        }
        // Base material — Cosechadas
        var baseSelC = document.getElementById('frExBaseC');
        var baseFrUuidC = baseSelC ? baseSelC.value : '';
        var baseFrIdC = '';
        var baseFrDescC = '';
        if (baseSelC && baseFrUuidC) {
            var baseOptC = baseSelC.options[baseSelC.selectedIndex];
            if (baseOptC) { baseFrIdC = baseOptC.dataset.id || ''; baseFrDescC = baseOptC.dataset.desc || ''; }
        }

        // Insumos
        var insumos = [];
        var ciSel = document.getElementById('frExCiSelect');
        if (ciSel && ciSel.value) {
            var ciOpt = ciSel.options[ciSel.selectedIndex];
            var ciCant = parseInt(get('frExCiCantidad')) || 0;
            if (ciCant > 0) {
                var excludeForCI = esEdicion ? uuidEdicion : null;
                var ciDisp = _frExStockCI(ciSel.value, excludeForCI);
                if (ciCant > ciDisp) {
                    if (!confirm('⚠️ Stock CI insuficiente: pedís ' + ciCant + ' pero hay ' + ciDisp + ' disponibles. ¿Guardar igual?')) return;
                }
                insumos.push({ tipo: 'ci', ciId: ciSel.value, ciLabel: ciOpt ? ciOpt.dataset.label || ciOpt.text : ciSel.value, cantidad: ciCant });
            }
        }
        var grLoteSel = document.getElementById('frExGrLoteSelect');
        var grTandaSel = document.getElementById('frExGrTandaSelect');
        if (grLoteSel && grLoteSel.value && grTandaSel && grTandaSel.value) {
            var grCant = parseFloat(get('frExGrCantidad')) || 0;
            if (grCant > 0) {
                var excludeForGR = esEdicion ? uuidEdicion : null;
                var grDisp = _frExStockGR(grLoteSel.value, grTandaSel.value, excludeForGR);
                if (grCant > grDisp) {
                    if (!confirm('⚠️ Stock GR insuficiente: pedís ' + grCant + ' pero hay ' + grDisp + ' disponibles. ¿Guardar igual?')) return;
                }
                var _grLotes = [];
                try { _grLotes = JSON.parse(localStorage.getItem('gr_lotes') || '[]'); } catch(e) {}
                var _grLoteObj = _grLotes.find(function(l) { return l.id === grLoteSel.value; });
                var _grDg = (_grLoteObj && Array.isArray(_grLoteObj.dg))
                    ? _grLoteObj.dg.find(function(t) { return t.tanda === grTandaSel.value; }) : null;
                var _grGenetica = (_grDg && _grDg.genetica) ? _grDg.genetica : '';
                var grLabel = grLoteSel.value + ' · ' + grTandaSel.value + (_grGenetica ? ' · ' + _grGenetica : '');
                insumos.push({ tipo: 'gr', grLoteId: grLoteSel.value, grTandaId: grTandaSel.value, grLabel: grLabel, cantidad: grCant });
            }
        }
        var suSel = document.getElementById('frExSuSelect');
        if (suSel && suSel.value) {
            insumos.push({ tipo: 'su', suLoteId: suSel.value, suLabel: suSel.value });
        }

        if (esEdicion) {
            var idx = experimentos.findIndex(function(e) { return e._exUuid === uuidEdicion; });
            if (idx === -1) { alert('Experimento no encontrado.'); return; }
            Object.assign(experimentos[idx], {
                id: id, fecha: fecha, fechaFin: fechaFin, fenId: fenId || null,
                geneticaFull: geneticaFull, genetica: genetica, fenotipo: fenotipo,
                baseFrUuid: baseFrUuid || null, baseFrId: baseFrId || null, baseFrDesc: baseFrDesc || null,
                baseFrUuidC: baseFrUuidC || null, baseFrIdC: baseFrIdC || null, baseFrDescC: baseFrDescC || null,
                insumos: insumos,
                hipotesis: get('frExHipotesis'),
                resultados: get('frExResultado')
            });
            saveExperimentos();
            _selectedExUuid = uuidEdicion;
        } else {
            var nuevo = {
                id: id, _exUuid: _frExGenUUID(), ts: Date.now(), fecha: fecha, fechaFin: fechaFin,
                fenId: fenId || null, geneticaFull: geneticaFull, genetica: genetica, fenotipo: fenotipo,
                estado: 'en_curso',
                baseFrUuid: baseFrUuid || null, baseFrId: baseFrId || null, baseFrDesc: baseFrDesc || null,
                baseFrUuidC: baseFrUuidC || null, baseFrIdC: baseFrIdC || null, baseFrDescC: baseFrDescC || null,
                insumos: insumos,
                hipotesis: get('frExHipotesis'),
                resultados: get('frExResultado'),
                observaciones: []
            };
            experimentos.push(nuevo);
            saveExperimentos();
            _selectedExUuid = nuevo._exUuid;
        }

        FR.cerrarModalExperimento();
        FR.subTab('experimentos');
        renderExperimentos();
    };

    FR.marcarExitosoExperimento = function(uuid) {
        var ex = getExperimentoByUuid(uuid);
        if (!ex) return;
        ex.estado = 'exitoso';
        saveExperimentos();
        renderExperimentos();
    };

    FR.descartarExperimento = function(uuid) {
        var ex = getExperimentoByUuid(uuid);
        if (!ex) return;
        ex.estado = 'descartado';
        saveExperimentos();
        renderExperimentos();
    };

    FR.eliminarExperimento = function(uuid) {
        var ex = getExperimentoByUuid(uuid);
        if (!ex) return;
        if (!confirm('¿Eliminar experimento ' + ex.id + '? Esta acción libera el stock consumido y no se puede deshacer.')) return;
        experimentos = experimentos.filter(function(e) { return e._exUuid !== uuid; });
        saveExperimentos();
        if (_selectedExUuid === uuid) _selectedExUuid = null;
        renderExperimentos();
    };

    // ======================================================
    // BOLSAS HUÉRFANAS
    // ======================================================
    // Una bolsa huérfana es cualquier bolsa real del lab sin trazabilidad SU→GR.
    // Tiene exactamente el mismo esquema que una bolsa trazada. La diferencia es:
    //   origen: 'huerfana'  (vs 'su' para las creadas por sincronización)
    // Entra al mismo flujo de dashboard, flushes, BE, observaciones, etc.

    // true una vez que el usuario edita frHId a mano — a partir de ahí
    // huerfanaOnFechaInicioChange() deja de pisar el ID con la sugerencia automática.
    var _frHIdDirty = false;

    FR.abrirModalHuerfana = function() {
        var modal = document.getElementById('frModalHuerfana');
        if (!modal) { console.warn('[FR] Modal huerfana no encontrado en el DOM'); return; }
        ['frHId','frHSuLoteId','frHGrLoteId','frHGrTandaId',
         'frHGeneticaFull','frHFechaInicio','frHFechaColon',
         'frHPesoSustratoSeco','frHPesoHidratado','frHGranoPorBolsa'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.value = '';
        });
        _frHIdDirty = false;
        var idEl = document.getElementById('frHId');
        if (idEl) idEl.value = genFrId();
        _frHuerfanaPopularGenetica();
        modal.style.display = 'flex';
    };

    // Marca el ID como editado a mano — se llama por oninput en frHId.
    FR.huerfanaMarcarIdDirty = function() {
        _frHIdDirty = true;
    };

    // Recalcula el ID sugerido a partir de la fecha real de armado elegida.
    // No pisa el campo si el usuario ya lo editó a mano (_frHIdDirty).
    FR.huerfanaOnFechaInicioChange = function() {
        if (_frHIdDirty) return;
        var fechaEl = document.getElementById('frHFechaInicio');
        var idEl = document.getElementById('frHId');
        if (!idEl) return;
        var fecha = fechaEl ? fechaEl.value : '';
        idEl.value = fecha ? genFrId(fecha) : genFrId();
    };

    FR.cerrarModalHuerfana = function() {
        var modal = document.getElementById('frModalHuerfana');
        if (modal) modal.style.display = 'none';
    };

    function _frHuerfanaPopularGenetica() {
        var sel = document.getElementById('frHGeneticaSelect');
        if (!sel) return;
        var opciones = '<option value="">— Seleccionar genética —</option>';
        try {
            if (window.ge && typeof window.ge.getSelectableGenetics === 'function') {
                var list = window.ge.getSelectableGenetics();
                list.forEach(function(g) {
                    opciones += '<option value="' + esc(g.id) + '" data-label="' + esc(g.label) + '">' + esc(g.label) + '</option>';
                });
            } else {
                var raw = localStorage.getItem('biolab.ge.v4');
                if (raw) {
                    var parsed = JSON.parse(raw);
                    var nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
                    var getNode = function(id) { return nodes.find(function(n){ return n.id === id; }) || null; };
                    var parents = {};
                    nodes.forEach(function(n) { if (n.parentId) parents[n.parentId] = true; });
                    var hojas = nodes.filter(function(n){ return !parents[n.id]; });
                    hojas.forEach(function(fNode) {
                        var chain = [], cur = fNode;
                        while (cur) { chain.unshift(cur); cur = cur.parentId ? getNode(cur.parentId) : null; }
                        var label = chain.map(function(n){ return n.name; }).join(' / ');
                        opciones += '<option value="' + esc(fNode.id) + '" data-label="' + esc(label) + '">' + esc(label) + '</option>';
                    });
                }
            }
        } catch(e) {}
        sel.innerHTML = opciones;
    }

    FR.huerfanaOnGeneticaSelect = function() {
        var sel = document.getElementById('frHGeneticaSelect');
        var inp = document.getElementById('frHGeneticaFull');
        if (!sel || !inp) return;
        var opt = sel.options[sel.selectedIndex];
        if (opt && opt.dataset.label) inp.value = opt.dataset.label;
    };

    FR.guardarHuerfana = function() {
        var get = function(id) {
            var el = document.getElementById(id);
            return el ? el.value.trim() : '';
        };
        var num2 = function(id) {
            var v = parseFloat(get(id));
            return isNaN(v) ? null : v;
        };

        var id = get('frHId');
        if (!id) { alert('El ID de la bolsa es obligatorio.'); return; }
        if (bolsas.some(function(b){ return b.id === id; })) {
            alert('Ya existe una bolsa con el ID "' + id + '". Elegí uno distinto.');
            return;
        }

        var geneticaFull = get('frHGeneticaFull');
        var fenId = '';
        var selGen = document.getElementById('frHGeneticaSelect');
        if (selGen && selGen.value) fenId = selGen.value;
        var fenNombre = '', cepaNombre = '';
        if (geneticaFull) {
            var parts = geneticaFull.split('/').map(function(s){ return s.trim(); });
            fenNombre = parts[parts.length - 1] || '';
            cepaNombre = parts.slice(0, -1).join(' / ') || '';
        }

        var pesoSustratoSeco = num2('frHPesoSustratoSeco') || 0;

        var nueva = {
            id: id,
            _frUuid: _frGenUUID(),
            ts: Date.now(),
            fechaEntradaFR: hoyISO(),
            origen: 'huerfana',
            _suUuid: null,
            suLoteId: get('frHSuLoteId') || null,
            suBolsaIndex: null,
            suSubTanda: null,
            grLoteId: get('frHGrLoteId') || null,
            grTandaId: get('frHGrTandaId') || null,
            fechaRegistroGR: null,
            fenId: fenId || null,
            genetica: cepaNombre,
            fenotipo: fenNombre,
            geneticaFull: geneticaFull,
            fechaInicio: get('frHFechaInicio') || null,
            fechaColonizacion: get('frHFechaColon') || null,
            fechaPines: null,
            fechaCosecha: null,
            temperatura: null,
            pesoSustratoSeco: pesoSustratoSeco,
            pesoHumedoHidratado: num2('frHPesoHidratado'),
            granoPorBolsa: num2('frHGranoPorBolsa'),
            contaminada: false,
            fechaContaminacion: null,
            pendienteConfirmacion: false,
            flushes: [],
            observaciones: [],
            estado: 'colonizando'
        };
        nueva.estado = computeEstado(nueva);
        addObsTo(nueva,
            'Bolsa cargada manualmente (huerfana).' +
            (nueva.suLoteId ? ' SU: ' + nueva.suLoteId : '') +
            (nueva.grLoteId ? ' GR: ' + nueva.grLoteId : '') +
            ' Sustrato seco: ' + (pesoSustratoSeco > 0 ? pesoSustratoSeco.toFixed(1) + ' g' : '\u2014') + '.',
            'manual', 'yellow');

        bolsas.push(nueva);
        saveBolsas();
        FR.cerrarModalHuerfana();
        renderAll();
        FR.select(id);
    };

    // ======================================================
    // RENDER: EXPERIMENTOS
    // ======================================================

    var _selectedExUuid = null;

    function _frExFmtDt(s) {
        if (!s) return '—';
        var d = new Date(s);
        if (isNaN(d)) return s.slice(0, 10);
        return String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0') + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
    }

    function _frExDias(inicio, fin) {
        if (!inicio) return null;
        var t1 = new Date(inicio), t2 = fin ? new Date(fin) : new Date();
        if (isNaN(t1) || isNaN(t2) || t2 - t1 < 0) return null;
        return Math.round((t2 - t1) / 86400000);
    }

    FR.setExFechaFin = function(uuid, val) {
        var ex = getExperimentoByUuid(uuid);
        if (!ex) return;
        ex.fechaFin = val || null;
        saveExperimentos();
        renderExperimentos();
    };

    function renderExperimentos() {
        var lista = document.getElementById('frExLista');
        var count = document.getElementById('frExCount');
        if (!lista) return;

        var activos = experimentos.filter(function(e) { return e.estado === 'en_curso'; }).length;
        if (count) count.textContent = experimentos.length + ' experimento' + (experimentos.length !== 1 ? 's' : '') + ' · ' + activos + ' activo' + (activos !== 1 ? 's' : '');

        if (experimentos.length === 0) {
            lista.innerHTML = '<div style="padding:32px;text-align:center;color:#555;font-size:0.9rem">Sin experimentos registrados. Creá el primero con 🔬 Nuevo experimento.</div>';
            renderExperimentoDetalle(null);
            return;
        }

        var sorted = experimentos.slice().sort(function(a, b) {
            var va, vb;
            if (_frExSortCol === 'id') {
                va = (a.id || '').toLowerCase(); vb = (b.id || '').toLowerCase();
                return _frExSortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
            }
            if (_frExSortCol === 'fecha') {
                va = a.fecha || ''; vb = b.fecha || '';
                return _frExSortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
            }
            if (_frExSortCol === 'dias') {
                va = _frExDias(a.fecha, a.fechaFin); va = (va === null || va === undefined) ? -1 : va;
                vb = _frExDias(b.fecha, b.fechaFin); vb = (vb === null || vb === undefined) ? -1 : vb;
                return _frExSortDir === 'asc' ? va - vb : vb - va;
            }
            if (_frExSortCol === 'genetica') {
                va = (a.geneticaFull || a.genetica || '').toLowerCase();
                vb = (b.geneticaFull || b.genetica || '').toLowerCase();
                return _frExSortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
            }
            if (_frExSortCol === 'base') {
                va = (a.baseFrId || a.baseFrIdC || '').toLowerCase();
                vb = (b.baseFrId || b.baseFrIdC || '').toLowerCase();
                return _frExSortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
            }
            if (_frExSortCol === 'estado') {
                var _ord = { 'en_curso': 0, 'exitoso': 1, 'descartado': 2 };
                va = _ord[a.estado] !== undefined ? _ord[a.estado] : 0;
                vb = _ord[b.estado] !== undefined ? _ord[b.estado] : 0;
                return _frExSortDir === 'asc' ? va - vb : vb - va;
            }
            // default: ts
            return _frExSortDir === 'asc' ? (a.ts || 0) - (b.ts || 0) : (b.ts || 0) - (a.ts || 0);
        });

        var _thSort = function(col, label) {
            var isActive = _frExSortCol === col;
            var arrow = isActive ? (_frExSortDir === 'desc' ? ' ▼' : ' ▲') : '';
            var style = isActive ? 'cursor:pointer;color:var(--ac,#44aaff);user-select:none' : 'cursor:pointer;user-select:none';
            return '<th style="' + style + '" onclick="FR.exSortBy(\'' + col + '\')">' + label + arrow + '</th>';
        };
        lista.innerHTML = '<table class="fr-ex-table"><thead><tr>'
            + '<th style="color:#555;font-size:0.75rem;text-align:center;width:28px;user-select:none">#</th>'
            + _thSort('id', 'ID')
            + _thSort('fecha', 'Inicio')
            + _thSort('dias', 'Fin / Días')
            + _thSort('genetica', 'Genética')
            + _thSort('base', 'Base')
            + '<th>Insumos</th>'
            + _thSort('estado', 'Estado')
            + '</tr></thead><tbody>'
            + sorted.map(function(ex, idx) {
                var estadoLabel = ex.estado === 'exitoso' ? '✅ Exitoso'
                    : ex.estado === 'descartado' ? '❌ Descartado' : '🔄 En curso';
                var baseParts = [];
                if (ex.baseFrId) baseParts.push('<span style="font-size:0.78rem;color:#888">📦 ' + esc(ex.baseFrId) + '</span>');
                if (ex.baseFrIdC) baseParts.push('<span style="font-size:0.78rem;color:#888">🍄 ' + esc(ex.baseFrIdC) + '</span>');
                var base = baseParts.length ? baseParts.join(' ') : '<span style="color:#3a3a5a;font-size:0.78rem">—</span>';
                var insumos = (ex.insumos || []).map(function(ins) {
                    var _fmtCant = function(n) { var v = parseFloat(n)||0; return v === Math.floor(v) ? String(v) : v.toFixed(1); };
                    if (ins.tipo === 'ci') return '<span class="fr-chip" style="background:#1a2a1a;border:1px solid #2d4a2d;color:#98c379;font-size:0.75rem;padding:1px 5px">🧫 ' + _fmtCant(ins.cantidad) + ' CI</span>';
                    if (ins.tipo === 'gr') return '<span class="fr-chip" style="background:#2a1a0a;border:1px solid #4a3a1a;color:#e5c07b;font-size:0.75rem;padding:1px 5px">🌾 ' + _fmtCant(ins.cantidad) + ' GR</span>';
                    if (ins.tipo === 'su') return '<span class="fr-chip" style="background:#1a1a2e;border:1px solid #3a3a5a;color:#7f7fd5;font-size:0.75rem;padding:1px 5px">🧱 SU</span>';
                    return '';
                }).filter(Boolean).join(' ');
                var dias = _frExDias(ex.fecha, ex.fechaFin);
                var _dc = '#555';
                if (dias !== null) {
                    if (dias <= 3) _dc = '#ffffff';
                    else if (dias <= 5) _dc = '#44aaff';
                    else if (dias <= 15) _dc = '#98c379';
                    else if (dias <= 25) _dc = '#e5c07b';
                    else _dc = '#e06c75';
                }
                var diasChip = ex.fechaFin && dias !== null
                    ? '<div style="color:#7f7fd5;font-size:0.72rem;margin-top:2px">' + dias + ' días</div>'
                    : (dias !== null ? '<div style="color:' + _dc + ';font-size:0.72rem;margin-top:2px">≈' + dias + 'd en curso</div>' : '');
                var finInput = '<input type="datetime-local" value="' + esc(ex.fechaFin || '') + '"'
                    + ' style="background:#0d0d1a;border:1px solid #2a2a3e;border-radius:4px;color:#888;font-size:0.72rem;padding:2px 4px;width:130px"'
                    + ' onclick="event.stopPropagation()"'
                    + ' onchange="FR.setExFechaFin(\'' + esc(ex._exUuid) + '\',this.value)">';
                var sel = ex._exUuid === _selectedExUuid ? ' style="background:rgba(229,192,123,0.07)"' : '';
                return '<tr' + sel + ' onclick="FR.seleccionarExperimento(\'' + esc(ex._exUuid) + '\')">'
                    + '<td style="color:#555;font-size:0.75rem;text-align:center;padding:0 6px">' + (idx + 1) + '</td>'
                    + '<td class="fr-ex-id">🔬 ' + esc(ex.id) + '</td>'
                    + '<td style="color:#888;white-space:nowrap;font-size:0.8rem">' + esc(_frExFmtDt(ex.fecha)) + '</td>'
                    + '<td>' + finInput + diasChip + '</td>'
                    + '<td style="color:#a9b1d6">' + esc(ex.geneticaFull || '—') + '</td>'
                    + '<td>' + base + '</td>'
                    + '<td>' + (insumos || '<span style="color:#3a3a5a;font-size:0.78rem">—</span>') + '</td>'
                    + '<td><span class="fr-ex-estado-' + esc(ex.estado) + '">' + estadoLabel + '</span></td>'
                    + '</tr>';
            }).join('')
            + '</tbody></table>';

        renderExperimentoDetalle(_selectedExUuid);
    }

    FR.exSortBy = function(col) {
        if (_frExSortCol === col) {
            _frExSortDir = _frExSortDir === 'desc' ? 'asc' : 'desc';
        } else {
            _frExSortCol = col;
            _frExSortDir = 'desc';
        }
        renderExperimentos();
    };

    FR.seleccionarExperimento = function(uuid) {
        _selectedExUuid = uuid;
        renderExperimentos();
    };

    function renderExperimentoDetalle(uuid) {
        var el = document.getElementById('frExDetalle');
        if (!el) return;
        var ex = uuid ? getExperimentoByUuid(uuid) : null;
        if (!ex) { el.innerHTML = ''; el.style.display = 'none'; return; }
        el.style.display = 'block';

        var estadoLabel = ex.estado === 'exitoso' ? '✅ Exitoso'
            : ex.estado === 'descartado' ? '❌ Descartado' : '🔄 En curso';

        var insumosHtml = (ex.insumos || []).map(function(ins) {
            var _fmtI = function(n) { var v = parseFloat(n)||0; return v === Math.floor(v) ? String(v) : v.toFixed(1); };
            if (ins.tipo === 'ci') return '<div style="color:#98c379">🧫 ' + _fmtI(ins.cantidad) + ' × ' + esc(ins.ciLabel || ins.ciId || '—') + '</div>';
            if (ins.tipo === 'gr') return '<div style="color:#e5c07b">🌾 ' + _fmtI(ins.cantidad) + ' × ' + esc(ins.grLabel || ins.grLoteId + ' ' + ins.grTandaId) + '</div>';
            if (ins.tipo === 'su') return '<div style="color:#7f7fd5">🧱 ' + esc(ins.suLabel || ins.suLoteId || '—') + '</div>';
            return '';
        }).join('') || '<span style="color:#555">Sin insumos registrados.</span>';

        el.innerHTML = '<section class="section-card" style="margin-top:8px">'
            + '<div class="section-header"><h3 style="margin:0">🔬 ' + esc(ex.id) + ' — Detalle</h3></div>'
            + '<div class="section-content" style="padding:14px 16px;display:grid;gap:10px">'

            + '<div style="display:flex;gap:8px;flex-wrap:wrap">'
            + '<span class="fr-ex-estado-' + esc(ex.estado) + '">' + estadoLabel + '</span>'
            + (ex.geneticaFull ? '<span class="fr-chip fr-chip-neutral">' + esc(ex.geneticaFull) + '</span>' : '')
            + '</div>'

            + (function() {
                var dias = _frExDias(ex.fecha, ex.fechaFin);
                var duracion = ex.fechaFin && dias !== null ? ' <span style="color:#7f7fd5;font-size:0.8rem">(' + dias + ' días)</span>' : '';
                var fin = ex.fechaFin ? '<div>🏁 Fin: ' + esc(_frExFmtDt(ex.fechaFin)) + duracion + '</div>'
                    : (dias !== null ? '<div style="color:#555">En curso: ≈' + dias + ' días</div>' : '');
                return '<div class="fr-ex-detalle-card"><div class="fr-ex-detalle-label">Fechas</div>'
                    + '<div>🕐 Inicio: ' + esc(_frExFmtDt(ex.fecha)) + '</div>'
                    + fin + '</div>';
            })()

            + ((ex.baseFrId || ex.baseFrIdC) ? '<div class="fr-ex-detalle-card"><div class="fr-ex-detalle-label">Base material</div>'
                + (ex.baseFrId ? '<div>📦 Archivo: ' + esc(ex.baseFrId) + (ex.baseFrDesc ? ' — ' + esc(ex.baseFrDesc) : '') + '</div>' : '')
                + (ex.baseFrIdC ? '<div>🍄 Cosechada: ' + esc(ex.baseFrIdC) + (ex.baseFrDescC ? ' — ' + esc(ex.baseFrDescC) : '') + '</div>' : '')
                + '</div>' : '')

            + '<div class="fr-ex-detalle-card"><div class="fr-ex-detalle-label">Insumos consumidos</div>' + insumosHtml + '</div>'

            + (ex.hipotesis ? '<div class="fr-ex-detalle-card"><div class="fr-ex-detalle-label">Hipótesis / Objetivo</div><div style="color:#aaa">' + esc(ex.hipotesis) + '</div></div>' : '')

            + (ex.resultados ? '<div class="fr-ex-detalle-card"><div class="fr-ex-detalle-label">Resultado</div><div style="color:#aaa">' + esc(ex.resultados) + '</div></div>' : '')

            + '<div style="display:flex;gap:8px;flex-wrap:wrap">'
            + (ex.estado !== 'exitoso' ? '<button class="btn btn-secondary" style="color:#98c379;border-color:#2d4a2d" onclick="FR.marcarExitosoExperimento(\'' + esc(ex._exUuid) + '\')">✅ Marcar exitoso</button>' : '')
            + (ex.estado !== 'descartado' ? '<button class="btn btn-secondary" style="color:#e06c75;border-color:#5a2a2a" onclick="FR.descartarExperimento(\'' + esc(ex._exUuid) + '\')">❌ Descartar</button>' : '')
            + '<button class="btn btn-secondary" onclick="FR.abrirModalExperimento(\'' + esc(ex._exUuid) + '\')">✏️ Editar</button>'
            + '<button class="btn btn-danger" style="margin-left:auto" onclick="FR.eliminarExperimento(\'' + esc(ex._exUuid) + '\')">🗑 Eliminar</button>'
            + '</div>'

            + '</div></section>';
    }

    // ======================================================
    // INIT
    // ======================================================
    /**
     * Migracion one-shot SU -> FR (v2):
     *   - Promueve b.fechaColonSU (legacy, derivado de SU) -> b.fechaColonizacion
     *     SOLO si la bolsa todavia no tiene fechaColonizacion propia.
     *   - Elimina el campo legacy b.fechaColonSU de todas las bolsas.
     *   - Recalcula estado y deja una observacion auto por bolsa migrada.
     * Marcador: localStorage 'biolab_migracion_su_fr_v2' = '1'
     * Diseñada para correr UNA sola vez (idempotente: si ya corrio, no hace nada).
     */
    function migrarLegacySUtoFRv2() {
        var KEY_MIG = 'biolab_migracion_su_fr_v2';
        try {
            if (localStorage.getItem(KEY_MIG) === '1') return;
        } catch (e) { return; }

        var migradas = 0;
        var limpiadas = 0;
        bolsas.forEach(function(b) {
            if (b && Object.prototype.hasOwnProperty.call(b, 'fechaColonSU')) {
                if (b.fechaColonSU && !b.fechaColonizacion) {
                    b.fechaColonizacion = b.fechaColonSU;
                    addObsTo(b, 'Migracion SU->FR v2: fechaColonizacion adoptada desde dato legacy de SU (' + b.fechaColonSU + ').', 'auto', 'none');
                    migradas++;
                }
                delete b.fechaColonSU;
                limpiadas++;
            }
            // Recalcular estado tras posibles cambios.
            try { b.estado = computeEstado(b); } catch (e) {}
        });

        if (limpiadas > 0) {
            try { saveBolsas(); } catch (e) { console.warn('[FR] migracion v2 save:', e); }
        }
        try { localStorage.setItem(KEY_MIG, '1'); } catch (e) {}
        if (limpiadas > 0) {
            console.log('[FR] Migracion legacy SU->FR v2 ejecutada. Bolsas limpiadas: ' + limpiadas + '. Fechas colonizacion adoptadas: ' + migradas + '.');
        }
    }

    // ======================================================
    // MIGRACIÓN CORRECTIVA — fechaInicio de 26 bolsas puntuales (2026-03 a 2026-07)
    // ======================================================
    // Antes del fix de confirmarBolsa (2026-07-15), fechaInicio se poblaba con
    // lote.fecha de SU al crear la bolsa pendiente, y el id se generaba con la
    // fecha del día de CONFIRMACIÓN (bug ya corregido). Para estas 26 bolsas
    // puntuales el operador confirmó contra su backup real (2026-07-16, dos
    // rondas de revisión) que el DDMM del id SÍ refleja el armado real (confirmó
    // el mismo día que armó) y que fechaInicio (de SU) es el dato desalineado —
    // el caso inverso al bug original. Las primeras 10 (jun-jul, formato con
    // padding de 2 dígitos) y las 16 restantes (mar-may, formato viejo SIN
    // padding — mismo esquema día+mes, solo sin ceros) se revisaron por separado;
    // 5 de esas 16 (FR15/b/c/d, FR125) tenían más de una lectura día/mes
    // numéricamente válida y el operador confirmó cuál a mano. Lista cerrada,
    // revisada bolsa por bolsa — NO una regla general "el id siempre tiene razón"
    // (esa regla rompería el caso original que motivó el fix de confirmarBolsa).
    var FR_MIG_FECHAINICIO_IDCONFIRMADO = [
        // Formato con padding (jun-jul 2026)
        { id: 'FR0306',  fechaCorrecta: '2026-06-03' },
        { id: 'FR0306b', fechaCorrecta: '2026-06-03' },
        { id: 'FR1106',  fechaCorrecta: '2026-06-11' },
        { id: 'FR1106b', fechaCorrecta: '2026-06-11' },
        { id: 'FR1106c', fechaCorrecta: '2026-06-11' },
        { id: 'FR1106d', fechaCorrecta: '2026-06-11' },
        { id: 'FR1207',  fechaCorrecta: '2026-07-12' },
        { id: 'FR1207b', fechaCorrecta: '2026-07-12' },
        { id: 'FR1207c', fechaCorrecta: '2026-07-12' },
        { id: 'FR1207d', fechaCorrecta: '2026-07-12' },
        // Formato viejo sin padding (mar-may 2026), lectura única
        { id: 'FR234a',  fechaCorrecta: '2026-04-23' },
        { id: 'FR234b',  fechaCorrecta: '2026-04-23' },
        { id: 'FR254a',  fechaCorrecta: '2026-04-25' },
        { id: 'FR254b',  fechaCorrecta: '2026-04-25' },
        { id: 'FR254c',  fechaCorrecta: '2026-04-25' },
        { id: 'FR254d',  fechaCorrecta: '2026-04-25' },
        { id: 'FR145',   fechaCorrecta: '2026-05-14' },
        { id: 'FR245a',  fechaCorrecta: '2026-05-24' },
        { id: 'FR245b',  fechaCorrecta: '2026-05-24' },
        { id: 'FR285',   fechaCorrecta: '2026-05-28' },
        { id: 'FR285b',  fechaCorrecta: '2026-05-28' },
        // Formato viejo sin padding, lectura ambigua — confirmado a mano por el operador
        { id: 'FR15',    fechaCorrecta: '2026-05-01' },
        { id: 'FR15b',   fechaCorrecta: '2026-05-01' },
        { id: 'FR15c',   fechaCorrecta: '2026-05-01' },
        { id: 'FR15d',   fechaCorrecta: '2026-05-01' },
        { id: 'FR125',   fechaCorrecta: '2026-05-12' }
    ];
    function _frMigrarFechaInicioIdConfirmado() {
        var KEY_MIG = 'biolab_migracion_fr_fechainicio_id_v1';
        try { if (localStorage.getItem(KEY_MIG) === '1') return; } catch (e) { return; }
        var cambiadas = 0;
        FR_MIG_FECHAINICIO_IDCONFIRMADO.forEach(function(item) {
            var b = bolsas.find(function(x) { return x.id === item.id; });
            if (!b) return; // ya no existe con ese id (renombrada a mano, etc.) — no tocar nada
            if (b.fechaInicio === item.fechaCorrecta) return; // ya corregida, no duplicar log
            var anterior = b.fechaInicio;
            b.fechaInicio = item.fechaCorrecta;
            addObsTo(b, 'Migración correctiva (2026-07-16): fechaInicio ajustada a la fecha implícita en el id — ' +
                (anterior ? fmtFecha(anterior) : '—') + ' → ' + fmtFecha(item.fechaCorrecta) +
                '. Confirmado por el operador contra backup real.', 'auto', 'none');
            cambiadas++;
        });
        if (cambiadas > 0) {
            try { saveBolsas(); } catch (e) { console.warn('[FR] migracion fechaInicio idConfirmado save:', e); }
        }
        try { localStorage.setItem(KEY_MIG, '1'); } catch (e) {}
        if (cambiadas > 0) {
            console.log('[FR] Migracion correctiva fechaInicio idConfirmado ejecutada. Bolsas corregidas: ' + cambiadas + '.');
        }
    }

    function _migrarFrInoculoSourceNull() {
        var KEY_MIG = 'biolab_migracion_fr_inoculo_source_v1';
        try {
            if (localStorage.getItem(KEY_MIG) === '1') return;
        } catch (e) { return; }
        try {
            var raw = localStorage.getItem(FR_KEY);
            if (!raw) { try { localStorage.setItem(KEY_MIG, '1'); } catch(e) {} return; }
            var bolsas = JSON.parse(raw);
            if (!Array.isArray(bolsas)) { try { localStorage.setItem(KEY_MIG, '1'); } catch(e) {} return; }
            var cambiados = 0;
            bolsas.forEach(function(b) {
                if (!Array.isArray(b.grSources)) return;
                b.grSources.forEach(function(s) {
                    if (s.inoculoSource === null || s.inoculoSource === undefined) {
                        s.inoculoSource = 'LEGACY';
                        cambiados++;
                    }
                });
            });
            if (cambiados > 0) {
                localStorage.setItem(FR_KEY, JSON.stringify(bolsas));
                console.log('[FR] Migración inoculoSource: ' + cambiados + ' registros actualizados a LEGACY');
            }
            try { localStorage.setItem(KEY_MIG, '1'); } catch (e) {}
        } catch(e) {
            console.error('[FR] Error en migración inoculoSource:', e);
        }
    }

    function _frCalConfidence(n) {
        if (n >= 8) return 'alta';
        if (n >= 5) return 'media';
        if (n >= 3) return 'baja';
        return 'insuficiente';
    }

    // Construye el cache fr_cal_intel leyendo fr_bolsas + su_lotes.
    // Solo lectura de SU — no escribe en ellos.
    function _frCalBuildIntel() {
        var suLotes = getSULotes();
        var suMap = {};
        suLotes.forEach(function(l) { if (l.id) suMap[l.id] = l; });

        var MIN_N = 5;

        function mean(arr) {
            if (!arr.length) return null;
            return arr.reduce(function(s, v) { return s + v; }, 0) / arr.length;
        }
        function meanField(recs, field) {
            var vals = recs.map(function(r) { return r[field]; })
                           .filter(function(v) { return v != null && !isNaN(v); });
            return vals.length ? mean(vals) : null;
        }
        function slugify(s) {
            return String(s).toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        }

        var grLotesAll = [];
        try { grLotesAll = JSON.parse(localStorage.getItem(GR_KEY) || '[]'); } catch(e) {}
        var grLoteCompMap = {};
        grLotesAll.forEach(function(l) { if (l.id) grLoteCompMap[l.id] = l; });

        var records = [];
        bolsas.forEach(function(b) {
            if (!Array.isArray(b.flushes)) return;
            var suLote = b.suLoteId ? suMap[b.suLoteId] : null;

            var aditivos = [];
            if (suLote && Array.isArray(suLote.aditivos) && num(suLote.fibra) > 0) {
                suLote.aditivos.forEach(function(a) {
                    if (!a.nombre || !a.cantidad) return;
                    var pct = (num(a.cantidad) / num(suLote.fibra)) * 100;
                    if (!pct || isNaN(pct)) return;
                    var bucket = pct <= 4 ? 'bajo' : pct <= 8 ? 'medio' : 'alto';
                    aditivos.push({
                        nombre: a.nombre,
                        pct:    pct,
                        bucket: bucket,
                        // Preferir a.id (catálogo su_biblioteca.materiales, ver prerequisito
                        // MEJ-0006 en SU) como clave de agrupamiento — evita que dos productos
                        // distintos tipeados con el mismo texto se mezclen en la correlación.
                        // Fallback a slug por nombre para aditivos legacy sin id (nunca excluye).
                        slug:   (a.id || slugify(a.nombre)) + '_' + bucket
                    });
                });
            }

            var grLote = b.grLoteId ? grLoteCompMap[b.grLoteId] : null;
            b.flushes.forEach(function(f, flushIdx) {
                if (!f.calidad) return;
                var cal = f.calidad;
                records.push({
                    bolsaId:            b.id,
                    suLabel:            suLote ? (suLote.codigo || b.suLoteId || '—') : (b.suLoteId || '—'),
                    grLabel:            grLote ? (grLote.codigo || b.grLoteId || '—') : (b.grLoteId || '—'),
                    flushNum:           flushIdx + 1,
                    fenId:              b.fenId || null,
                    fenLabel:           (b.genetica ? b.genetica + ' / ' : '') + (b.fenotipo || ''),
                    grLoteId:           b.grLoteId || null,
                    aditivos:           aditivos,
                    scoreAuto:          cal.scoreAuto,
                    scorePersonal:      cal.scorePersonal,
                    beOleada:           num(f.beOleada),
                    pctDominante:       cal.pctDominante || 0,
                    pctHegemonico:      cal.pctHegemonico || 0,
                    pctAbortos:         cal.pctAbortos || 0,
                    pctBlobs:            cal.pctBlobs            || 0,
                    pctMutaciones:       cal.pctMutaciones        || 0,
                    pctDeformaciones:    cal.pctDeformaciones     || 0,
                    frutosNotablesN:     (cal.frutosNotables || []).length
                });
            });
        });

        if (!records.length) {
            try { localStorage.removeItem(FR_CAL_INTEL_KEY); } catch(e) {}
            return null;
        }

        // byCepa
        var cepaGroups = {};
        records.forEach(function(r) {
            if (!r.fenId) return;
            if (!cepaGroups[r.fenId]) cepaGroups[r.fenId] = { label: r.fenLabel, recs: [], bolsaList: [] };
            cepaGroups[r.fenId].recs.push(r);
            cepaGroups[r.fenId].bolsaList.push({
                bolsaId:  r.bolsaId,
                suLabel:  r.suLabel,
                grLabel:  r.grLabel,
                flushNum: r.flushNum,
                scoreAuto: r.scoreAuto
            });
        });
        var byCepa = {};
        Object.keys(cepaGroups).forEach(function(fenId) {
            var recs = cepaGroups[fenId].recs;
            byCepa[fenId] = {
                label:                  cepaGroups[fenId].label,
                n:                      recs.length,
                bolsas:                 cepaGroups[fenId].bolsaList,
                scoreAutoMean:          meanField(recs, 'scoreAuto'),
                scorePersonalMean:      meanField(recs, 'scorePersonal'),
                beMean:                 meanField(recs, 'beOleada'),
                pctDominanteMean:       meanField(recs, 'pctDominante'),
                pctAbortosMean:         meanField(recs, 'pctAbortos'),
                pctBlobsMean:           meanField(recs, 'pctBlobs'),
                frutosNotablesPerFlush: meanField(recs, 'frutosNotablesN')
            };
        });

        // bySuAditivo
        var slugGroups = {};
        records.forEach(function(r) {
            r.aditivos.forEach(function(a) {
                if (!slugGroups[a.slug]) slugGroups[a.slug] = { label: a.nombre + ' (' + a.bucket + ')', recs: [] };
                slugGroups[a.slug].recs.push(r);
            });
        });
        var bySuAditivo = {};
        Object.keys(slugGroups).forEach(function(slug) {
            var grp = slugGroups[slug];
            if (grp.recs.length < MIN_N) return;
            var baseline = records.filter(function(r) {
                return !r.aditivos.some(function(a) { return a.slug === slug; });
            });
            if (baseline.length < MIN_N) return;
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
        });

        // byGrProtocolo
        var grGroups = {};
        records.forEach(function(r) {
            if (!r.grLoteId) return;
            if (!grGroups[r.grLoteId]) grGroups[r.grLoteId] = { recs: [] };
            grGroups[r.grLoteId].recs.push(r);
        });
        var byGrProtocolo = {};
        Object.keys(grGroups).forEach(function(grId) {
            var recs = grGroups[grId].recs;
            if (recs.length < MIN_N) return;
            byGrProtocolo[grId] = {
                label:           grId,
                n:               recs.length,
                scoreAutoMean:   meanField(recs, 'scoreAuto'),
                pctPositivoMean: mean(recs.map(function(r) { return r.pctDominante + r.pctHegemonico; }))
            };
        });

        // byGrComponente — correlaciones por tipo de componente de grano
        var compGroups = {};
        records.forEach(function(r) {
            if (!r.grLoteId) return;
            var lote = grLoteCompMap[r.grLoteId];
            if (!lote || !Array.isArray(lote.componentes)) return;
            lote.componentes.forEach(function(c) {
                if (!c.nombre) return;
                var cSlug = slugify(c.nombre);
                if (!compGroups[cSlug]) compGroups[cSlug] = { label: c.nombre, recs: [] };
                if (compGroups[cSlug].recs.indexOf(r) === -1) compGroups[cSlug].recs.push(r);
            });
        });

        var byGrComponente = {};
        Object.keys(compGroups).forEach(function(cSlug) {
            var grp = compGroups[cSlug];
            var baseline = records.filter(function(r) {
                if (!r.grLoteId) return true;
                var lote = grLoteCompMap[r.grLoteId];
                if (!lote || !Array.isArray(lote.componentes)) return true;
                return !lote.componentes.some(function(c) { return slugify(c.nombre) === cSlug; });
            });
            if (grp.recs.length < FR_ANOMALY_MIN_N || baseline.length < FR_ANOMALY_MIN_N) return;
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
        });

        // anomalyRanking — top candidatos por dimensión de anomalía
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

        var anomalousBolsas = records.filter(function(r) {
            return (r.pctMutaciones    || 0) >= FR_ANOMALY_THRESHOLDS.mutaciones    ||
                   (r.pctDeformaciones || 0) >= FR_ANOMALY_THRESHOLDS.deformaciones ||
                   (r.pctBlobs        || 0) >= FR_ANOMALY_THRESHOLDS.blobs;
        }).map(function(r) {
            var dims = [];
            if ((r.pctMutaciones    || 0) >= FR_ANOMALY_THRESHOLDS.mutaciones)    dims.push('Mut ' + (r.pctMutaciones    || 0) + '%');
            if ((r.pctDeformaciones || 0) >= FR_ANOMALY_THRESHOLDS.deformaciones) dims.push('Def ' + (r.pctDeformaciones || 0) + '%');
            if ((r.pctBlobs        || 0) >= FR_ANOMALY_THRESHOLDS.blobs)         dims.push('Blob ' + (r.pctBlobs        || 0) + '%');
            return {
                bolsaId:   r.bolsaId,
                fenLabel:  r.fenLabel,
                suLabel:   r.suLabel,
                grLabel:   r.grLabel,
                flushNum:  r.flushNum,
                anomalias: dims,
                scoreAuto: r.scoreAuto
            };
        });

        var intel = {
            ts:                    new Date().toISOString(),
            totalFlushesEvaluados: records.length,
            byCepa:                byCepa,
            bySuAditivo:           bySuAditivo,
            byGrProtocolo:         byGrProtocolo,
            byGrComponente:        byGrComponente,
            anomalyRanking:        anomalyRanking,
            anomalousBolsas:       anomalousBolsas
        };
        try { localStorage.setItem(FR_CAL_INTEL_KEY, JSON.stringify(intel)); } catch(e) {}
        return intel;
    }

    FR.getIntel = function() {
        try {
            var raw = localStorage.getItem(FR_CAL_INTEL_KEY);
            if (raw) return JSON.parse(raw);
        } catch(e) {}
        return _frCalBuildIntel();
    };

    function _frCalAnomalyAlert(b, calidad, intel) {
        var activas = [];
        if ((calidad.pctMutaciones    || 0) >= FR_ANOMALY_THRESHOLDS.mutaciones)    activas.push('mutaciones');
        if ((calidad.pctDeformaciones || 0) >= FR_ANOMALY_THRESHOLDS.deformaciones) activas.push('deformaciones');
        if ((calidad.pctBlobs         || 0) >= FR_ANOMALY_THRESHOLDS.blobs)         activas.push('blobs');
        if (!activas.length) return null;
        if (!intel || !intel.anomalyRanking) return { anomalias: activas, candidatos: [] };

        var candidatos = [];
        var seen = {};
        activas.forEach(function(dim) {
            (intel.anomalyRanking[dim] || []).forEach(function(c) {
                var key = c.fuente + '|' + c.label;
                if (!seen[key]) {
                    seen[key] = true;
                    candidatos.push({ label: c.label, delta: c.delta, confidence: c.confidence, fuente: c.fuente, dim: dim });
                }
            });
        });
        candidatos.sort(function(a, b) { return b.delta - a.delta; });
        return { anomalias: activas, candidatos: candidatos.slice(0, 5) };
    }

    function _frCalBuildObsText(b, f, flushIdx, alertResult) {
        var cal = f.calidad;
        var parts = ['📊 Evaluación F' + (flushIdx + 1) + ': Score ' + cal.scoreAuto + '/100'];
        if (f.beOleada != null && f.beOleada > 0) parts.push('BE ' + fmt(f.beOleada, 1) + '%');

        var pctParts = [];
        if ((cal.pctNormales      || 0) > 0) pctParts.push('Norm '    + cal.pctNormales + '%');
        if ((cal.pctDominante     || 0) > 0) pctParts.push('Dom '     + cal.pctDominante + '%');
        if ((cal.pctHegemonico    || 0) > 0) pctParts.push('Heg '     + cal.pctHegemonico + '%');
        if ((cal.pctAbortos       || 0) > 0) pctParts.push('Abortos ' + cal.pctAbortos + '%');
        if ((cal.pctBlobs         || 0) > 0) pctParts.push('Blobs '   + cal.pctBlobs + '%');
        if ((cal.pctMutaciones    || 0) > 0) pctParts.push('Mut '     + cal.pctMutaciones + '%');
        if ((cal.pctDeformaciones || 0) > 0) pctParts.push('Def '     + cal.pctDeformaciones + '%');
        if (pctParts.length) parts.push(pctParts.join(' · '));

        if (cal.scorePersonal != null) parts.push('Nota personal: ' + cal.scorePersonal + '/10');

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
        return parts.join(' · ');
    }

    // Guarda la evaluación de calidad del flush indicado leyendo el panel DOM.
    // Congela scoreAuto e invalida fr_cal_intel.
    FR.saveCalidad = function(flushIdx) {
        var b = getSelected();
        if (!b || !Array.isArray(b.flushes) || !b.flushes[flushIdx]) return;
        var f = b.flushes[flushIdx];

        function readPct(id) {
            var el = document.getElementById(id);
            if (!el || el.value === '') return 0;
            return Math.max(0, Math.min(100, num(el.value)));
        }

        var pctDom = readPct('frCalPctDominante');
        var pctHeg = readPct('frCalPctHegemonico');
        var pctDef = readPct('frCalPctDeformaciones');
        var pctAbo = readPct('frCalPctAbortos');
        var pctBlo = readPct('frCalPctBlobs');
        var pctMut = readPct('frCalPctMutaciones');

        var spEl = document.getElementById('frCalScorePersonal');
        var scorePersonal = null;
        if (spEl && spEl.value !== '') {
            var spv = parseInt(spEl.value);
            if (!isNaN(spv)) scorePersonal = Math.max(1, Math.min(10, spv));
        }

        var frutosNotables = _frCalState.frutosWork.map(function(fn) {
            var pesoEl  = document.getElementById('frCalFrutoPeso_'   + fn._idx);
            var motivoEl= document.getElementById('frCalFrutoMotivo_' + fn._idx);
            var accionEl= document.getElementById('frCalFrutoAccion_' + fn._idx);
            var notasEl = document.getElementById('frCalFrutoNotas_'  + fn._idx);
            return {
                peso:   pesoEl  && pesoEl.value  !== '' ? parseFloat(pesoEl.value) : null,
                motivo: motivoEl ? motivoEl.value : 'peso',
                accion: accionEl ? accionEl.value : 'documentar',
                notas:  notasEl  ? notasEl.value.trim() : (fn.notas || '')
            };
        }).filter(function(fn) {
            return fn.peso != null || fn.notas;
        });

        var c = {
            pctDominante: pctDom, pctHegemonico: pctHeg, pctDeformaciones: pctDef,
            pctAbortos: pctAbo, pctBlobs: pctBlo, pctMutaciones: pctMut,
            frutosNotables: frutosNotables
        };

        f.calidad = {
            ts:               new Date().toISOString(),
            pctDominante:     pctDom,
            pctHegemonico:    pctHeg,
            pctDeformaciones: pctDef,
            pctAbortos:       pctAbo,
            pctBlobs:         pctBlo,
            pctMutaciones:    pctMut,
            pctNormales:      _frCalNormales(c),
            scorePersonal:    scorePersonal,
            scoreAuto:        _frCalScore(f, c),
            frutosNotables:   frutosNotables
        };

        saveBolsas();
        try { localStorage.removeItem(FR_CAL_INTEL_KEY); } catch(e) {}
        var _intel = _frCalBuildIntel();
        var _alertResult = _frCalAnomalyAlert(b, f.calidad, _intel);
        var _obsEstado = _alertResult ? 'red' : (f.calidad.scoreAuto < 65 ? 'yellow' : 'green');
        addObsTo(b, _frCalBuildObsText(b, f, flushIdx, _alertResult), 'auto', _obsEstado);
        saveBolsas();
        _frToast('✅ Evaluación F' + (flushIdx + 1) + ' guardada — Score ' + f.calidad.scoreAuto + '/100', _alertResult ? 'warn' : 'ok');
        _frCalState.lastAlert   = _alertResult;
        _frCalState.lastAlertId = b.id;
        _frCalState.flushIdx    = null;
        _frCalState.frutosWork  = [];
        renderAll();
    };

    FR.deleteCalidad = function(flushIdx) {
        var b = getSelected();
        if (!b || !Array.isArray(b.flushes) || !b.flushes[flushIdx]) return;
        if (!confirm('Eliminar evaluación de calidad del flush F' + (flushIdx + 1) + '?')) return;
        delete b.flushes[flushIdx].calidad;
        saveBolsas();
        try { localStorage.removeItem(FR_CAL_INTEL_KEY); } catch(e) {}
        _frCalState.flushIdx = null;
        _frCalState.frutosWork = [];
        renderAll();
    };

    function _frCalFrutoRowHtml(fn, i) {
        var motivoOpts = [
            ['peso',     'Peso excepcional'],
            ['fenotipo', 'Fenotipo nuevo / superior'],
            ['ambos',    'Ambos']
        ].map(function(o) {
            return '<option value="' + o[0] + '"' + (fn.motivo === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('');
        var accionOpts = [
            ['documentar',    'Solo documentar'],
            ['clonar',        'Clonar tejido'],
            ['multiesporales','Multiesporales']
        ].map(function(o) {
            return '<option value="' + o[0] + '"' + (fn.accion === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('');
        return '<div class="fr-cal-fruto-row" data-idx="' + i + '">'
            + '<span class="fr-cal-fruto-num">#' + (i + 1) + '</span>'
            + '<div class="fr-cal-field"><label>Peso (g)</label><input type="number" id="frCalFrutoPeso_' + i + '" class="fr-dash-input fr-cal-fruto-peso" value="' + esc(fn.peso != null ? fn.peso : '') + '" placeholder="g (opcional)" min="0" oninput="FR.updateCalidadPreview()"></div>'
            + '<div class="fr-cal-field"><label>Motivo</label><select id="frCalFrutoMotivo_' + i + '" class="fr-dash-input fr-cal-fruto-motivo">' + motivoOpts + '</select></div>'
            + '<div class="fr-cal-field"><label>Acción futura</label><select id="frCalFrutoAccion_' + i + '" class="fr-dash-input fr-cal-fruto-accion">' + accionOpts + '</select></div>'
            + '<div class="fr-cal-field fr-cal-field-notas"><label>Notas</label><input type="text" id="frCalFrutoNotas_' + i + '" class="fr-dash-input fr-cal-fruto-notas" value="' + esc(fn.notas || '') + '" placeholder="descripción"></div>'
            + '<button type="button" class="fr-cal-btn-del" onclick="FR.removeFrutoNotable(' + i + ')">✕</button>'
            + '</div>';
    }

    function _frCalRenderPanel(flushIdx) {
        var b = getSelected();
        if (!b || !b.flushes || !b.flushes[flushIdx]) return '';
        var f = b.flushes[flushIdx];
        var c = f.calidad || {};

        function pctVal(field) { return c[field] != null ? c[field] : 0; }

        _frCalState.frutosWork = (c.frutosNotables || []).map(function(fn, i) {
            return { _idx: i, peso: fn.peso, motivo: fn.motivo, accion: fn.accion, notas: fn.notas };
        });

        var frutoRows = _frCalState.frutosWork.map(function(fn, i) {
            return _frCalFrutoRowHtml(fn, i);
        }).join('');

        var spVal = c.scorePersonal != null ? c.scorePersonal : '';

        return '<div class="fr-cal-panel">'
            + '<div class="fr-cal-panel-title">Evaluación — F' + f.n + ' · ' + (f.fecha ? fmtFechaHora(f.fecha) : '') + ' · ' + fmt(f.pesoHumedo, 1) + ' g húmedo · BE ' + fmt(f.beOleada, 1) + '%</div>'
            + '<div class="fr-cal-howit">'
            +   '<button type="button" class="fr-cal-howit-toggle" onclick="var b=document.getElementById(\'frCalHowitBody\');b.style.display=b.style.display===\'block\'?\'none\':\'block\'">¿Cómo funciona FR·CAL? ▶</button>'
            +   '<div id="frCalHowitBody" style="display:none" class="fr-cal-howit-body">'
            +     '<p><strong>Score del Sistema (0-100):</strong> base BE de la oleada + ajuste fenotípico ponderado + bonus por frutos notables con peso. Se congela al guardar — no recalcula aunque cambie la fórmula en el futuro. Los campos crudos (pct*) permiten recalcular retroactivamente.</p>'
            +     '<p><strong>Score Personal (1-10):</strong> evaluación estética subjetiva. Independiente del score del sistema. Se promedia por cepa en el historial.</p>'
            +     '<p><strong>Frutos Notables:</strong> registro individual de frutos destacados por peso excepcional o fenotipo nuevo/superior. Cada uno puede marcarse para acción futura (documentar, clonar tejido, multiesporales).</p>'
            +   '</div>'
            + '</div>'
            + '<div class="fr-cal-block fr-cal-block-pos">'
            +   '<div class="fr-cal-block-label">1 · Composición del pan</div>'
            +   '<div class="fr-cal-grid2">'
            +     '<div class="fr-cal-field"><label>% Dominante</label><input type="number" id="frCalPctDominante" class="fr-dash-input" value="' + pctVal('pctDominante') + '" min="0" max="100" oninput="FR.updateCalidadPreview()"><span class="fr-cal-hint pos">Fenotipo clonal ideal</span></div>'
            +     '<div class="fr-cal-field"><label>% Hegemónico</label><input type="number" id="frCalPctHegemonico" class="fr-dash-input" value="' + pctVal('pctHegemonico') + '" min="0" max="100" oninput="FR.updateCalidadPreview()"><span class="fr-cal-hint pos">Fenotipo deseado con variación</span></div>'
            +   '</div>'
            +   '<div class="fr-cal-subblock">'
            +     '<div class="fr-cal-block-label" style="color:var(--danger)">Problemáticos</div>'
            +     '<div class="fr-cal-grid4">'
            +       '<div class="fr-cal-field"><label>% Deformaciones</label><input type="number" id="frCalPctDeformaciones" class="fr-dash-input" value="' + pctVal('pctDeformaciones') + '" min="0" max="100" oninput="FR.updateCalidadPreview()"></div>'
            +       '<div class="fr-cal-field"><label>% Abortos</label><input type="number" id="frCalPctAbortos" class="fr-dash-input" value="' + pctVal('pctAbortos') + '" min="0" max="100" oninput="FR.updateCalidadPreview()"></div>'
            +       '<div class="fr-cal-field"><label>% Blobs</label><input type="number" id="frCalPctBlobs" class="fr-dash-input" value="' + pctVal('pctBlobs') + '" min="0" max="100" oninput="FR.updateCalidadPreview()"></div>'
            +       '<div class="fr-cal-field"><label>% Mutaciones</label><input type="number" id="frCalPctMutaciones" class="fr-dash-input" value="' + pctVal('pctMutaciones') + '" min="0" max="100" oninput="FR.updateCalidadPreview()"></div>'
            +     '</div>'
            +   '</div>'
            +   '<div id="frCalNormalesRow" class="fr-cal-normales"></div>'
            +   '<div id="frCalBarraVisual" class="fr-cal-barra-wrap"></div>'
            + '</div>'
            + '<div class="fr-cal-block" style="border-color:#4a4000;background:#1a1500;">'
            +   '<div class="fr-cal-block-label" style="color:#ffb83f;">2 · Score personal de fenotipo (opcional)</div>'
            +   '<div class="fr-cal-grid-personal">'
            +     '<div class="fr-cal-field"><label>Puntuación (1-10)</label><input type="number" id="frCalScorePersonal" class="fr-dash-input" value="' + esc(spVal) + '" min="1" max="10" placeholder="opcional" oninput="FR.updateCalidadPreview()"></div>'
            +     '<p class="fr-cal-hint">No afecta el score del sistema. Se promedia por cepa en el historial.</p>'
            +   '</div>'
            + '</div>'
            + '<div class="fr-cal-block" style="border-color:#2a4a6a;background:#0f1a2a;">'
            +   '<div class="fr-cal-frutos-header">'
            +     '<div class="fr-cal-block-label" style="color:#7eb8f7;">3 · Frutos notables — candidatos a selección</div>'
            +     '<button type="button" class="fr-cal-btn-add" onclick="FR.addFrutoNotable()">+ Agregar fruto</button>'
            +   '</div>'
            +   '<p class="fr-cal-hint">Registrá frutos destacados por peso excepcional, fenotipo nuevo/superior, o ambos.</p>'
            +   '<div id="frCalFrutosContainer">' + (frutoRows || '<p class="fr-cal-hint" style="font-style:italic;margin:6px 0;">Sin frutos notables registrados.</p>') + '</div>'
            + '</div>'
            + '<div class="fr-cal-score-preview" id="frCalScorePreview"></div>'
            + '<div style="display:flex;gap:10px;align-items:center;margin-top:12px;">'
            +   '<button type="button" class="btn btn-fr" onclick="FR.saveCalidad(' + flushIdx + ')">Guardar evaluación F' + f.n + '</button>'
            +   (c.ts ? '<button type="button" class="btn btn-danger" style="font-size:0.78rem;" onclick="FR.deleteCalidad(' + flushIdx + ')">Eliminar evaluación</button>' : '')
            +   '<button type="button" class="btn btn-secondary" onclick="FR.closeCalidad()">Cancelar</button>'
            + '</div>'
            + '</div>';
    }

    FR.openCalidad = function(flushIdx) {
        var panel = document.getElementById('frCalPanel');
        if (!panel) return;
        _frCalState.lastAlert   = null;
        _frCalState.lastAlertId = null;
        _frCalState.flushIdx = flushIdx;
        panel.innerHTML = _frCalRenderPanel(flushIdx);
        panel.style.display = 'block';
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        FR.updateCalidadPreview();
    };

    FR.closeCalidad = function() {
        var panel = document.getElementById('frCalPanel');
        if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
        _frCalState.flushIdx = null;
        _frCalState.frutosWork = [];
    };

    FR.addFrutoNotable = function() {
        var newIdx = _frCalState.frutosWork.length;
        _frCalState.frutosWork.push({ _idx: newIdx, peso: null, motivo: 'peso', accion: 'documentar', notas: '' });
        var container = document.getElementById('frCalFrutosContainer');
        if (!container) return;
        if (container.querySelector('.fr-cal-fruto-row') === null) container.innerHTML = '';
        var div = document.createElement('div');
        div.innerHTML = _frCalFrutoRowHtml(_frCalState.frutosWork[newIdx], newIdx);
        container.appendChild(div.firstChild);
    };

    FR.removeFrutoNotable = function(idx) {
        _frCalState.frutosWork.splice(idx, 1);
        _frCalState.frutosWork.forEach(function(fn, i) { fn._idx = i; });
        var container = document.getElementById('frCalFrutosContainer');
        if (!container) return;
        if (_frCalState.frutosWork.length === 0) {
            container.innerHTML = '<p class="fr-cal-hint" style="font-style:italic;margin:6px 0;">Sin frutos notables registrados.</p>';
        } else {
            container.innerHTML = _frCalState.frutosWork.map(function(fn, i) {
                return _frCalFrutoRowHtml(fn, i);
            }).join('');
        }
        FR.updateCalidadPreview();
    };

    FR.updateCalidadPreview = function() {
        var flushIdx = _frCalState.flushIdx;
        if (flushIdx == null) return;
        var b = getSelected();
        var f = b && b.flushes && b.flushes[flushIdx];
        if (!f) return;

        function readPct(id) {
            var el = document.getElementById(id);
            return el ? Math.max(0, Math.min(100, num(el.value) || 0)) : 0;
        }

        var pctDom = readPct('frCalPctDominante');
        var pctHeg = readPct('frCalPctHegemonico');
        var pctDef = readPct('frCalPctDeformaciones');
        var pctAbo = readPct('frCalPctAbortos');
        var pctBlo = readPct('frCalPctBlobs');
        var pctMut = readPct('frCalPctMutaciones');

        var notablesConPeso = 0;
        _frCalState.frutosWork.forEach(function(fn, i) {
            var el = document.getElementById('frCalFrutoPeso_' + i);
            if (el && el.value !== '' && parseFloat(el.value) > 0) notablesConPeso++;
        });

        var c = {
            pctDominante: pctDom, pctHegemonico: pctHeg, pctDeformaciones: pctDef,
            pctAbortos: pctAbo, pctBlobs: pctBlo, pctMutaciones: pctMut,
            frutosNotables: _frCalState.frutosWork.map(function(fn, i) {
                var el = document.getElementById('frCalFrutoPeso_' + i);
                return { peso: el && el.value !== '' ? parseFloat(el.value) : null };
            })
        };
        var normales = _frCalNormales(c);
        var scoreAuto = _frCalScore(f, c);
        var spEl = document.getElementById('frCalScorePersonal');
        var spVal = spEl && spEl.value !== '' ? spEl.value : null;

        var normEl = document.getElementById('frCalNormalesRow');
        if (normEl) normEl.innerHTML = '<div class="fr-cal-normales-row"><span>Normales / aceptables (auto)</span><strong>' + normales + '%</strong></div>';

        var barEl = document.getElementById('frCalBarraVisual');
        if (barEl) {
            var segs = [
                { pct: pctDom, color: '#3aaa5a', label: pctDom + '%' },
                { pct: pctHeg, color: '#70c840', label: pctHeg + '%' },
                { pct: normales, color: '#555', label: normales + '%' },
                { pct: pctDef, color: '#b86020', label: pctDef + '%' },
                { pct: pctAbo, color: '#cc4444', label: pctAbo + '%' },
                { pct: pctBlo, color: '#bb5522', label: pctBlo + '%' },
                { pct: pctMut, color: '#9933cc', label: pctMut + '%' }
            ].filter(function(s) { return s.pct > 0; });
            barEl.innerHTML = '<div class="fr-cal-barra">'
                + segs.map(function(s) {
                    return '<div style="width:' + s.pct + '%;background:' + s.color + ';display:flex;align-items:center;justify-content:center;font-size:0.65rem;color:#fff;font-weight:700;">'
                        + (s.pct >= 8 ? s.label : '') + '</div>';
                }).join('')
                + '</div>';
        }

        var previewEl = document.getElementById('frCalScorePreview');
        if (previewEl) {
            var fenAdj = pctDom * 0.30 + pctHeg * 0.15 - pctDef * 0.10 - pctAbo * 0.25 - pctBlo * 0.20 - pctMut * 0.30;
            var bonus = Math.min(notablesConPeso * 2, 10);
            previewEl.innerHTML = '<div class="fr-cal-score-row">'
                + '<div class="fr-cal-score-block"><div class="fr-cal-score-lbl">Sistema</div><div class="fr-cal-score-val auto">' + scoreAuto + '</div><div class="fr-cal-score-unit">/ 100</div></div>'
                + '<div class="fr-cal-score-div"></div>'
                + (spVal ? '<div class="fr-cal-score-block"><div class="fr-cal-score-lbl">Personal</div><div class="fr-cal-score-val personal">' + spVal + '</div><div class="fr-cal-score-unit">/ 10</div></div><div class="fr-cal-score-div"></div>' : '')
                + '<div class="fr-cal-score-breakdown">'
                +   '<span>BE ' + fmt(f.beOleada, 1) + '%:</span> +' + fmt(f.beOleada || 0, 1) + ' base<br>'
                +   '<span>Ajuste fenotípico:</span> ' + (fenAdj >= 0 ? '+' : '') + fmt(fenAdj, 1) + ' pts<br>'
                +   (bonus > 0 ? '<span>Frutos notables con peso:</span> +' + bonus + ' pts bonus<br>' : '')
                + '</div>'
                + '</div>';
        }
    };

    FR.init = function() {
        if (FR._initialized) return;
        FR._initialized = true;

        try { _migrarFrInoculoSourceNull(); } catch (e) { console.warn('[FR] migracion inoculoSource:', e); }
        try { loadBolsas(); } catch (e) { console.warn('[FR] loadBolsas:', e); }
        try { loadExperimentos(); } catch (e) { console.warn('[FR-EX] loadExperimentos:', e); }
        try { migrarLegacySUtoFRv2(); } catch (e) { console.warn('[FR] migracion v2:', e); }
        try { _frMigrarFechaInicioIdConfirmado(); } catch (e) { console.warn('[FR] migracion fechaInicio idConfirmado:', e); }
        try { _frMigrarUUIDs(); } catch (e) { console.warn('[FR] migracion uuid:', e); }
        try { sincronizarTodo(); } catch (e) { console.warn('[FR] sync init:', e); }

        try {
            frOnSuLoteGuardado = function() {
                try { sincronizarTodo(); renderAll(); } catch (e) {}
            };
            window.addEventListener('su-lote-guardado', frOnSuLoteGuardado);
        } catch (e) {}
        try {
            frOnStorage = function(ev) {
                if (ev && (ev.key === SU_KEY || ev.key === FR_KEY || ev.key === GR_KEY)) {
                    try {
                        if (ev.key === FR_KEY) loadBolsas();
                        sincronizarTodo();
                        renderAll();
                    } catch (e) {}
                }
            };
            window.addEventListener('storage', frOnStorage);
        } catch (e) {}

        try {
            var f = document.getElementById('frFlushFecha');
            if (f && !f.value) f.value = ahoraISOLocal();
        } catch (e) {}

        // Navegación cross-módulo: SU puede pedir que se seleccione una bolsa
        // en particular al entrar a FR (badge clickeable en el archivo de SU).
        try {
            if (window._frPendingSelect) {
                var pid = window._frPendingSelect;
                window._frPendingSelect = null;
                selectedId = pid;
            }
        } catch (e) {}

        renderAll();

        // Hook de desmontaje: main.js lo invoca al navegar a otro módulo.
        // Remueve listeners para evitar acumulación y resetea el guard
        // para que el próximo mount ejecute init() completo.
        window.onModuleUnload = function() {
            if (frOnSuLoteGuardado) {
                window.removeEventListener('su-lote-guardado', frOnSuLoteGuardado);
                frOnSuLoteGuardado = null;
            }
            if (frOnStorage) {
                window.removeEventListener('storage', frOnStorage);
                frOnStorage = null;
            }
            FR._initialized = false;
        };
    };

    FR._calc = {
        computeEstado: computeEstado,
        esHistorica: esHistorica,
        esPendiente: esPendiente,
        beOleada: beOleada,
        beAcumulado: beAcumulado,
        rendimientoFresco: rendimientoFresco,
        biomasaHumedaTotal: biomasaHumedaTotal,
        biomasaSecaTotal: biomasaSecaTotal,
        pctBiomasaFlush: pctBiomasaFlush,
        tiempoDeshidFlush: tiempoDeshidFlush,
        tiempoTrabajoTotal: tiempoTrabajoTotal,
        diasEntre: diasEntre,
        horasEntre: horasEntre,
        fmtFecha: fmtFecha,
        fmtFechaHora: fmtFechaHora
    };
    FR._all = function() { return bolsas; };

    // ======================================================
    // BACKUP FR — Export / Import
    // ======================================================

    FR.exportarJSON = function() {
        var data = {
            version: '1.0',
            modulo: 'FR',
            fechaExportacion: new Date().toISOString().slice(0, 10),
            bolsas: bolsas
        };
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var url  = URL.createObjectURL(blob);
        var a    = document.createElement('a');
        a.href   = url;
        a.download = 'fr-backup-' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    FR.importarJSON = function(inputEl) {
        var file = inputEl.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function(e) {
            try {
                var data = JSON.parse(e.target.result);
                if (!Array.isArray(data.bolsas)) throw new Error('Formato inválido');
                bolsas = data.bolsas;
                saveBolsas();
                renderAll();
                alert('✅ Backup importado: ' + bolsas.length + ' bolsas restauradas.');
            } catch(err) {
                alert('❌ Error al importar: ' + err.message);
            }
        };
        reader.readAsText(file);
    };

    // Auto-inicialización si el módulo se carga solo (fuera del loader main.js)
    // El guard _initialized en FR.init() previene doble-init cuando
    // main.js también llama invokeModuleInit('FR').
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { FR.init(); });
    } else {
        FR.init();
    }

})();
