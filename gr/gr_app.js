/**
 * Calculadora de Sustratos - Aplicación Principal
 * Sistema de preparación de grano para cultivo de hongos
 */

'use strict';

// ==========================================
// IIFE — aísla el scope del módulo GR del monolito global
// ==========================================
(function () {
'use strict';

// Variables globales
const STORAGE_KEY = 'gr_lotes';
const BIBLIOTECA_KEY = 'gr_biblioteca';
const GR_USADOS_KEY = 'gr_usados';       // { [grLoteId]: { [grTandaId]: count } }
const GR_USADOS_REF_KEY = 'gr_usados_ref'; // { [grLoteId]: { [grTandaId]: [suLoteId, ...] } }
const SU_STORAGE_KEY_REF = 'su_lotes';
let lotesData = [];
let _grStorageListener = null;
let _grVisibilityListener = null;
let _grFocusListener = null;
let _grUsadosChangedListener = null;
let _grMessageListener = null;
let _grCultivosChangedListener = null;  // [Fase 4] refresca dropdowns de inóculo cuando CI cambia
let _grSortMode = 'fecha_desc'; // 'fecha_desc' | 'fecha_asc' | 'id_asc' | 'disp_desc' | 'nombre'
const GR_COLONIZACION_ALERTA_DIAS = 30;

// ── Render-level caches (re-built once per render pass, amortize localStorage parses) ──
let _grCachedFormsMap      = null; // bl2_forms: id → nombre
let _grCachedCultivosMap   = null; // bl2_cultivos: id → object (ALL states)
let _grCachedExperimentos  = null; // fr_experimentos: array (cache de render pass)
let _grCachedFrBolsas      = null; // fr_bolsas: array (cache de render pass)

function _grInvalidateCaches() {
    _grCachedFormsMap     = null;
    _grCachedCultivosMap  = null;
    _grCachedExperimentos = null;
    _grCachedFrBolsas     = null;
}

function _grGetFrBolsas() {
    if (_grCachedFrBolsas) return _grCachedFrBolsas;
    try {
        const arr = JSON.parse(localStorage.getItem('fr_bolsas') || '[]');
        _grCachedFrBolsas = Array.isArray(arr) ? arr : [];
    } catch(e) { _grCachedFrBolsas = []; }
    return _grCachedFrBolsas;
}

function _grCountFrBolsasPorTanda(grLoteId, tandaId) {
    if (!grLoteId || !tandaId) return 0;
    try {
        const refMap = JSON.parse(localStorage.getItem(GR_USADOS_REF_KEY) || '{}');
        const suIds = (refMap[grLoteId] && refMap[grLoteId][tandaId]) ? refMap[grLoteId][tandaId] : [];
        if (suIds.length === 0) return 0;
        const suSet = new Set(suIds);
        return _grGetFrBolsas().filter(function(b) {
            return b && b.suLoteId && suSet.has(b.suLoteId);
        }).length;
    } catch(e) { return 0; }
}

// ==========================================
// GR_USADOS - Frascos consumidos desde SU
// ==========================================
// gr_usados:     { [grLoteId]: { [grTandaId]: count } }   — frascos consumidos (entero)
// gr_usados_ref: { [grLoteId]: { [grTandaId]: string[] } } — IDs de lote SU que los consumen
// Ambos se reconstruyen en vivo desde su_lotes + form SU activo.
// Abreviaciones de especie para display — no modifica storage
function _abbrevGen(s) {
    return s ? s.replace(/Psilocybe cubensis/gi, 'PC') : s;
}

// ── Etiqueta dinámica de unidad física (Frasco / Bolsa / …) ─────────────────
// Se actualiza al cargar un lote o al cambiar ufEstructura.
var _grUfEstructura = 'Frasco';

/** Singular en minúsculas: "frasco" | "bolsa" */
function _grUd() {
    return (_grUfEstructura || 'Frasco').toLowerCase();
}
/** Plural en minúsculas: "frascos" | "bolsas" */
function _grUds() {
    return _grUd() + 's';
}
/** Singular con mayúscula inicial: "Frasco" | "Bolsa" */
function _grUdCap() {
    var u = _grUd();
    return u.charAt(0).toUpperCase() + u.slice(1);
}

// ── CI helpers — leen localStorage directo (no dependen de window.CI) ──────
// Esto permite que GR funcione aunque el módulo CI no haya sido cargado aún.

/** Mapa id→nombre de todas las fórmulas de bl2_forms (cacheado hasta _grInvalidateCaches). */
function _grFormsMap() {
    if (_grCachedFormsMap) return _grCachedFormsMap;
    try {
        const arr = JSON.parse(localStorage.getItem('bl2_forms') || '[]');
        const map = {};
        if (Array.isArray(arr)) arr.forEach(function(f) { if (f && f.id) map[f.id] = f.nombre || ''; });
        _grCachedFormsMap = map;
        return map;
    } catch(e) { return {}; }
}

/** Mapa id→object de TODOS los cultivos CI (cacheado hasta _grInvalidateCaches). */
function _grCultivosMap() {
    if (_grCachedCultivosMap) return _grCachedCultivosMap;
    try {
        const arr = JSON.parse(localStorage.getItem('bl2_cultivos') || '[]');
        const map = {};
        if (Array.isArray(arr)) arr.forEach(function(c) { if (c && c.id) map[c.id] = c; });
        _grCachedCultivosMap = map;
        return map;
    } catch(e) { return {}; }
}

/** Lista cultivos CI disponibles (estado=DISPONIBLE, cantidadDisponible > 0). */
function _grListCultivosCI() {
    return Object.values(_grCultivosMap()).filter(function(c) {
        return c && c.estado === 'DISPONIBLE'
            && typeof c.cantidadDisponible === 'number'
            && c.cantidadDisponible > 0;
    });
}

/** Obtiene un cultivo CI por id (O(1) via cache en vez de O(n) JSON.parse+find). */
function _grGetCultivoCI(id) {
    if (!id) return null;
    return _grCultivosMap()[id] || null;
}

/** Formatea fecha YYYY-MM-DD → DD-MM-YYYY para display. */
function _grFormatFecha(f) {
    if (!f) return '—';
    const m = f.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : f;
}

/**
 * Abrevia el label de genética en su componente especie (primer segmento).
 * "Psilocybe cubensis / APE / 244" → "PC / APE / 244"
 * Toma la inicial mayúscula de cada palabra del nombre de especie.
 */
function _grAbreviarEspecie(label) {
    if (!label) return '?';
    const partes  = label.split(' / ');
    const especie = partes[0].trim();
    const resto   = partes.slice(1);
    const abrev   = especie.split(/\s+/).map(function(w) { return (w[0] || '').toUpperCase(); }).join('');
    return resto.length ? [abrev].concat(resto).join(' / ') : abrev;
}

/**
 * Construye la etiqueta legible de un cultivo CI para los selects de GR.
 * Formato: "PDA Light - CI-042 - PC / GT · PLACA · 8 disp."
 */
function _grEtiquetaCI(c, formsMap) {
    const formulaNombre = (c.medioFormulaId && formsMap && formsMap[c.medioFormulaId]) || '';
    const codigo        = c.codigo || c.id || '?';
    const lbl           = (c.geneticaSnapshot && c.geneticaSnapshot.label) || c.geneticaId || '?';
    const geneticaAbrev = _grAbreviarEspecie(lbl);
    const tipo          = c.tipo  || '';
    const disp          = typeof c.cantidadDisponible === 'number' ? c.cantidadDisponible : '?';
    const prefijo       = formulaNombre ? formulaNombre + ' - ' + codigo : codigo;
    return prefijo + ' · ' + geneticaAbrev + ' · ' + tipo + ' · ' + disp + ' disp.';
}

function grGetUsadosMap() {
    try {
        const raw = localStorage.getItem(GR_USADOS_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
}
function grGetUsadosTanda(loteId, tandaId) {
    if (!loteId || !tandaId) return 0;
    const m = grGetUsadosMap();
    return (m[loteId] && m[loteId][tandaId]) ? parseInt(m[loteId][tandaId]) || 0 : 0;
}
function _grGetExperimentos() {
    if (_grCachedExperimentos) return _grCachedExperimentos;
    try {
        const raw = localStorage.getItem('fr_experimentos');
        const exs = raw ? JSON.parse(raw) : [];
        _grCachedExperimentos = Array.isArray(exs) ? exs : [];
    } catch(e) {
        _grCachedExperimentos = [];
    }
    return _grCachedExperimentos;
}

// Frascos GR consumidos por experimentos para una tanda
function grGetExUsadosGR(loteId, tandaId) {
    return _grGetExperimentos().reduce(function(sum, ex) {
        if (!Array.isArray(ex.insumos)) return sum;
        return sum + ex.insumos.reduce(function(s, ins) {
            return (ins.tipo === 'gr' && ins.grLoteId === loteId && ins.grTandaId === tandaId)
                ? s + (parseFloat(ins.cantidad) || 0) : s;
        }, 0);
    }, 0);
}

// IDs de experimentos que consumen de una tanda GR (para chip)
function grGetExIdsGR(loteId, tandaId) {
    return _grGetExperimentos()
        .filter(function(ex) {
            return Array.isArray(ex.insumos) && ex.insumos.some(function(ins) {
                return ins.tipo === 'gr' && ins.grLoteId === loteId && ins.grTandaId === tandaId;
            });
        })
        .map(function(ex) { return ex.id; });
}

function grSaveUsadosMap(map) {
    try { localStorage.setItem(GR_USADOS_KEY, JSON.stringify(map || {})); } catch (e) {}
}
function grGetUsadosRefMap() {
    try {
        const raw = localStorage.getItem(GR_USADOS_REF_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
}
function grSaveUsadosRefMap(ref) {
    try { localStorage.setItem(GR_USADOS_REF_KEY, JSON.stringify(ref || {})); } catch (e) {}
}
/**
 * Recalcula gr_usados y gr_usados_ref desde su_lotes + form SU activo.
 *
 * IMPORTANTE: acumula r.grUsados (frascos de spawn consumidos), NO r.bolsas
 * (bolsas de sustrato). Son unidades distintas — mezclarlas produce disponibles incorrectos.
 */

/**
 * grNormSources(r, grLoteDefault)
 *   Normaliza las fuentes GR de una fila db[]:
 *   - Nuevo formato: itera r.grSources[] (array de { grLoteId, grTandaId, grUsados }).
 *   - Histórico: usa campos flat r.grLoteId/grTandaId/grUsados con fallback a grLoteDefault.
 *   Devuelve siempre un array (puede ser vacío).
 */
function grNormSources(r, grLoteDefault) {
    // Delegado a shared/gr_su_sources.js (unificado 2026-07-10, ver ese archivo
    // para la implementación real — antes esta función tenía su propia copia
    // divergente de la de SU).
    if (window.GrSuSources && typeof window.GrSuSources.normalize === 'function') {
        return window.GrSuSources.normalize(r, grLoteDefault);
    }
    // Fallback defensivo si la lib compartida no cargó por algún motivo.
    console.warn('[GR] GrSuSources no disponible, usando fallback local');
    if (!r || typeof r !== 'object') return [];
    var loteId  = (String(r.grLoteId || grLoteDefault || '').trim()) || null;
    var tandaId = (String(r.grTandaId || r.grano || '').trim()) || null;
    if (loteId && tandaId) return [{ grLoteId: loteId, grTandaId: tandaId, grUsados: parseInt(r.grUsados, 10) || 0 }];
    return [];
}

function grRecomputeUsadosFromSU() {
    const map = {};  // { [grLoteId]: { [grTandaId]: count } }
    const ref = {};  // { [grLoteId]: { [grTandaId]: [suLoteId, ...] } }

    function acumular(grLoteId, grTandaId, grUsados, suLoteId) {
        if (!grLoteId || !grTandaId || !(parseInt(grUsados) > 0)) return;
        const u = parseInt(grUsados);
        if (!map[grLoteId]) map[grLoteId] = {};
        map[grLoteId][grTandaId] = (map[grLoteId][grTandaId] || 0) + u;
        if (suLoteId) {
            if (!ref[grLoteId]) ref[grLoteId] = {};
            if (!ref[grLoteId][grTandaId]) ref[grLoteId][grTandaId] = [];
            if (!ref[grLoteId][grTandaId].includes(suLoteId)) {
                ref[grLoteId][grTandaId].push(suLoteId);
            }
        }
    }

    // 1) Lotes SU persistidos — soporta grSources[] (nuevo) y campos flat (histórico)
    try {
        const raw = localStorage.getItem(SU_STORAGE_KEY_REF);
        const arr = raw ? JSON.parse(raw) : [];
        (arr || []).forEach(lote => {
            const grLoteDefault = lote.grProtocolo || '';
            (lote.db || []).forEach(r => {
                grNormSources(r, grLoteDefault).forEach(s => {
                    acumular(s.grLoteId, s.grTandaId, s.grUsados, lote.id);
                });
            });
        });
    } catch (e) {}

    // 2) Form SU activo — sustituye la contribución del lote en edición para evitar doble conteo
    try {
        if (typeof window.suDbCollectForUsados === 'function') {
            const suLoteIdActivo = (typeof document !== 'undefined' && document.getElementById('loteId'))
                ? (document.getElementById('loteId').value || '').trim()
                : '';
            // Restar lo que ya sumamos del lote activo en el paso 1
            if (suLoteIdActivo) {
                try {
                    const raw2 = localStorage.getItem(SU_STORAGE_KEY_REF);
                    const arr2 = raw2 ? JSON.parse(raw2) : [];
                    const mine = arr2.find(l => l.id === suLoteIdActivo);
                    if (mine) {
                        const grLoteDefault2 = mine.grProtocolo || '';
                        (mine.db || []).forEach(r => {
                            grNormSources(r, grLoteDefault2).forEach(s => {
                                const u = parseInt(s.grUsados) || 0;
                                if (s.grLoteId && s.grTandaId && u > 0) {
                                    if (map[s.grLoteId] && map[s.grLoteId][s.grTandaId] != null) {
                                        map[s.grLoteId][s.grTandaId] -= u;
                                        if (map[s.grLoteId][s.grTandaId] <= 0) delete map[s.grLoteId][s.grTandaId];
                                    }
                                    if (ref[s.grLoteId] && ref[s.grLoteId][s.grTandaId]) {
                                        const idx = ref[s.grLoteId][s.grTandaId].indexOf(suLoteIdActivo);
                                        if (idx !== -1) ref[s.grLoteId][s.grTandaId].splice(idx, 1);
                                        if (ref[s.grLoteId][s.grTandaId].length === 0) delete ref[s.grLoteId][s.grTandaId];
                                    }
                                }
                            });
                        });
                    }
                } catch (e) {}
            }
            // Sumar estado live del form
            const live = window.suDbCollectForUsados();
            (live || []).forEach(r => acumular(r.grLoteId, r.grTandaId, r.grUsados, suLoteIdActivo || null));
        }
    } catch (e) {}

    grSaveUsadosMap(map);
    grSaveUsadosRefMap(ref);
    if (typeof window.grActualizarTotalesGenetica === 'function') {
        window.grActualizarTotalesGenetica();
    }
    if (typeof window.grRenderizarRegistroLotes === 'function') {
        window.grRenderizarRegistroLotes();
    }
    return map;
}
window.grGetUsadosMap = grGetUsadosMap;
window.grGetUsadosTanda = grGetUsadosTanda;
window.grGetUsadosRefMap = grGetUsadosRefMap;
window.grRecomputeUsadosFromSU = grRecomputeUsadosFromSU;

// Escuchar cambios cross-tab/storage de SU para refrescar disponibles automáticamente
_grStorageListener = function(ev) {
    if (ev.key === SU_STORAGE_KEY_REF || ev.key === GR_USADOS_KEY) {
        try { grRecomputeUsadosFromSU(); } catch (e) {}
    }
};
window.addEventListener('storage', _grStorageListener);

// Al volver a la pestaña GR: recalcular por si SU escribió mientras estábamos fuera
_grVisibilityListener = function() {
    if (!document.hidden) {
        try { grRecomputeUsadosFromSU(); } catch (e) {}
    }
};
document.addEventListener('visibilitychange', _grVisibilityListener);
_grFocusListener = function() {
    try { grRecomputeUsadosFromSU(); } catch (e) {}
};
window.addEventListener('focus', _grFocusListener);

// Evento custom para sync en la misma pestaña (por si se monta todo junto)
_grUsadosChangedListener = function() {
    try { grRecomputeUsadosFromSU(); } catch (e) {}
};
window.addEventListener('gr-usados-changed', _grUsadosChangedListener);

// [Fase 4] CI dispara este evento al crear/consumir/devolver/descartar cultivos.
// GR refresca los dropdowns de inóculo en DG para reflejar disponibilidad en vivo.
_grCultivosChangedListener = function() {
    try {
        if (typeof window.actualizarSelectoresGenetica === 'function') {
            window.actualizarSelectoresGenetica();
        }
    } catch (e) { console.warn('[GR] refresh CI dropdowns:', e); }
};
window.addEventListener('ci-cultivos-changed', _grCultivosChangedListener);

// ==========================================
// NAMESPACE GR (preparación integración monolítica)
// ==========================================
const GR = {};
window.GR = GR;

// ==========================================
// ESTADO COMPARTIDO GLOBAL (GR ↔ SU ↔ FR)
// ==========================================
// DB es el espejo en memoria del estado persistido en localStorage.
// Cada módulo actualiza su slot al cargar / guardar. FR leerá de aquí.
// Biblioteca de ingredientes por defecto
const bibliotecaDefault = {
    agentes: [
        { id: 'AG-01', nombre: 'ÁCIDO PERACÉTICO', concDefault: 5, notas: 'Descontaminante oxidativo' },
        { id: 'AG-02', nombre: 'HIPOCLORITO DE SODIO', concDefault: 1, notas: 'Blanqueador disinfectante' },
        { id: 'AG-03', nombre: 'PERÓXIDO DE HIDRÓGENO', concDefault: 3, notas: 'Oxidante fuerte' }
    ],
    aditivos: [
        { id: 'AD-01', nombre: 'CaSO4 (Yeso)', tipo: 'Estructurante', notas: 'Mejora aireación' },
        { id: 'AD-02', nombre: 'Carbonato de Calcio', tipo: 'Corrector pH', notas: 'Alcalinizante' },
        { id: 'AD-03', nombre: 'Gesso', tipo: 'Estructurante', notas: 'Similar al yeso' },
        { id: 'AD-04', nombre: 'Tiza', tipo: 'Estructurante', notas: 'Fuente de calcio' }
    ],
    granos: [
        { id: 'GR-01', nombre: 'Avena (AV)', densidadTipica: 0.556, notas: 'Grano fino, alta superficie' },
        { id: 'GR-02', nombre: 'Maíz (MA)', densidadTipica: 0.802, notas: 'Grano grueso' },
        { id: 'GR-03', nombre: 'Trigo (TR)', densidadTipica: 0.75, notas: 'Grano medio' },
        { id: 'GR-04', nombre: 'Centeno (CE)', densidadTipica: 0.7, notas: 'Grano medio' },
        { id: 'GR-05', nombre: 'Sorgo (SO)', densidadTipica: 0.75, notas: 'Grano medio' }
    ]
};

// ==========================================
// NORMALIZACIÓN / FALLBACK DE BIBLIOTECA
// ==========================================
// Asegura que la biblioteca tenga SIEMPRE las 3 claves (agentes, aditivos,
// granos) y que cada una sea un Array. Si falta una clave o no es array,
// se rellena con el default.
function normalizarBiblioteca(raw) {
    const base = JSON.parse(JSON.stringify(bibliotecaDefault));
    if (!raw || typeof raw !== 'object') return base;
    const out = { ...base, ...raw };
    if (!Array.isArray(out.agentes))  out.agentes  = base.agentes;
    if (!Array.isArray(out.aditivos)) out.aditivos = base.aditivos;
    if (!Array.isArray(out.granos))   out.granos   = base.granos;
    return out;
}

// getBiblioteca(): acceso seguro a la biblioteca.
// - Si window.biblioteca ya está bien formada, la devuelve.
// - Si no, intenta hidratar desde localStorage.
// - Si falla o está vacío, cae al default.
// - SIEMPRE deja window.biblioteca / GR.biblioteca sincronizadas.
function getBiblioteca() {
    // 1) Ya hay algo en memoria — validar shape
    if (GR.biblioteca && typeof GR.biblioteca === 'object'
        && Array.isArray(GR.biblioteca.agentes)
        && Array.isArray(GR.biblioteca.aditivos)
        && Array.isArray(GR.biblioteca.granos)) {
        return GR.biblioteca;
    }

    // 2) Intentar hidratar desde localStorage
    let parsed = null;
    try {
        const raw = localStorage.getItem(BIBLIOTECA_KEY);
        if (raw) parsed = JSON.parse(raw);
    } catch (e) {
        console.warn('[GR] Biblioteca corrupta en localStorage, usando default.', e);
    }

    const normal = normalizarBiblioteca(parsed);
    GR.biblioteca = normal;

    // Si hubo que reparar (por parsed incompleto), persistir el shape válido.
    try {
        localStorage.setItem(BIBLIOTECA_KEY, JSON.stringify(normal));
    } catch (e) { /* no crítico */ }

    return normal;
}
window.getBiblioteca = getBiblioteca;

// ==========================================
// INICIALIZACIÓN
// ==========================================

GR.init = function initGR() {
        cargarBibliotecaDesdeStorage();
        // Recalcular gr_usados y gr_usados_ref desde su_lotes antes del primer render.
        // Sin esto el registro muestra datos stale del storage anterior al fix.
        try { grRecomputeUsadosFromSU(); } catch (e) { console.error('GR grRecomputeUsadosFromSU:', e); }
        cargarLotesDesdeStorage();
        inicializarEventos();
        establecerFechaActual();
        renderizarBibliotecaEnConfig();
        actualizarSelectoresCT();
        actualizarSelectoresGenetica();

        setTimeout(function() {
            GR.calcularDG();
            actualizarTotalesCT();
            grActualizarTotalesGenetica();
            updateUnidadFisica();
        }, 100);
    };

// NOTA: el auto-arranque de GR.init fue removido.
// main.js llama a window.grInit() al montar el módulo.

// Función para actualizar los selectores de granos en CT
function actualizarSelectoresCT() {
    const selects = document.querySelectorAll('.ct-comp');
    if (selects.length === 0) return;
    
    const bib = getBiblioteca();
    const opcionesGranos = bib.granos.map(gr => {
        const dens = (Number(gr.densidadTipica) || 0);
        return `<option value="${gr.nombre}" data-densidad="${dens}">${gr.nombre} - ${dens.toFixed(3).replace('.', ',')} g/ml</option>`;
    }).join('');
    
    selects.forEach(select => {
        const prev = select.value;
        select.innerHTML = '<option value="">-- Seleccionar grano --</option>' + opcionesGranos;
        if (prev) select.value = prev;
    });
}

    function establecerFechaActual() {
        const hoy = new Date().toISOString().split('T')[0];
        document.getElementById('loteFecha').value = hoy;
    }

    // Genera un ID único para tanda DG basado en el ID del lote actual
    // Patrón: {prefijo}T{dia}{mes}  →  GRT244, GRT244b, GRT244c ...
    /**
     * Genera un ID de lote GR usando la fecha del sistema actual.
     * Formato: GR{dia}{mes}  → GR35 (día 3, mes 5)
     * Conflictos: GR35b, GR35c, GR35d, ...
     * Siempre usa el prefijo fijo "GR" (módulo de grano).
     * NUNCA usa la fecha de creación del protocolo — usa el día de hoy.
     */
    function _grGenerarLoteId() {
        const hoy = new Date();
        const dia = hoy.getDate();
        const mes = hoy.getMonth() + 1;
        const base = 'GR' + dia + mes;
        const data = lotesData || [];

        // Sin conflicto → base directa
        if (!data.some(function(l) { return l.id === base; })) return base;

        // Con conflicto → sufijo b, c, d, ...
        let code = 98; // 'b'
        while (data.some(function(l) { return l.id === base + String.fromCharCode(code); })) {
            code++;
        }
        return base + String.fromCharCode(code);
    }

    /**
     * Asigna el ID de lote al campo loteId si aún no tiene uno.
     * Llamado desde addDgRow() al crear la primera tanda.
     * Respeta edición manual: si el usuario ya escribió un ID, no lo pisa.
     */
    function _grAsignarLoteIdSiVacio() {
        const idInput = document.getElementById('loteId');
        if (!idInput) return;
        if (idInput.dataset.manualEdit === 'true' && idInput.value.trim()) return;
        if (idInput.value.trim()) return;  // ya tiene ID (cargado de storage)

        const id = _grGenerarLoteId();
        idInput.value = id;
        idInput.style.opacity = '1';

        // Actualizar hint
        const hint = document.getElementById('loteIdHint');
        if (hint) hint.textContent = '✅ ID asignado al crear la primera tanda';
    }

    /** Extrae "GR{dia}{mes}" de un ISO date string. "2026-05-28" → "GR285". Null si inválido. */
    function _grBaseIdDesdeFecha(isoStr) {
        if (!isoStr) return null;
        const parts = isoStr.split('-');
        if (parts.length < 3) return null;
        const dia = parseInt(parts[2], 10);
        const mes = parseInt(parts[1], 10);
        if (isNaN(dia) || isNaN(mes)) return null;
        return 'GR' + dia + mes;
    }

    /**
     * Genera el ID de tanda DG a partir del ID del lote activo.
     * Patrón: usa el mismo lote ID como base.
     *   Lote GR35 → primera tanda GR35, segunda GR35B, tercera GR35C, ...
     * Si se pasa fechaOverride, usa GR{dia}{mes} de esa fecha como base.
     */
    function _grGenerarTandaId(fechaOverride) {
        const baseFromFecha = _grBaseIdDesdeFecha(fechaOverride);
        const loteId = (document.getElementById('loteId')?.value || '').trim();
        const base = baseFromFecha || loteId;
        if (!base) return '';

        // Recopilar tandas ya usadas en las filas DG actuales
        const usadas = new Set();
        document.querySelectorAll('#dgTable tbody .dg-tanda').forEach(function(inp) {
            const v = inp.value.trim();
            if (v) usadas.add(v);
        });

        if (!usadas.has(base)) return base;

        let letter = 66; // B
        while (usadas.has(base + String.fromCharCode(letter))) letter++;
        return base + String.fromCharCode(letter);
    }

    GR.dgOnChangeFechaInoculo = window.grDgOnChangeFechaInoculo = function(input) {
        const row = input.closest('.dg-row');
        if (!row) return;
        const fecha = input.value;
        row.dataset.fechaInoculacion = fecha;

        // Regenerar tanda ID desde la fecha (solo si no fue editado manualmente)
        const tandaInput = row.querySelector('.dg-tanda');
        if (tandaInput && tandaInput.dataset.manualEdit !== 'true') {
            tandaInput.value = ''; // limpiar para que collision check ignore esta fila
            const newId = _grGenerarTandaId(fecha);
            if (newId) tandaInput.value = newId;
        }

        // Actualizar lote ID desde la primera fila (solo si no fue editado manualmente)
        const loteIdInput = document.getElementById('loteId');
        const firstRow = document.querySelector('#dgTable tbody .dg-row');
        if (row === firstRow && loteIdInput && loteIdInput.dataset.manualEdit !== 'true') {
            const baseId = _grBaseIdDesdeFecha(fecha);
            if (baseId) {
                const data = lotesData || [];
                let id = baseId;
                if (data.some(function(l) { return l.id === id; })) {
                    let code = 98; // 'b'
                    while (data.some(function(l) { return l.id === id + String.fromCharCode(code); })) code++;
                    id += String.fromCharCode(code);
                }
                loteIdInput.value = id;
                loteIdInput.style.opacity = '1';
                const hint = document.getElementById('loteIdHint');
                if (hint) hint.textContent = '✅ ID asignado desde fecha de inoculación';
            }
        }

        if (typeof grActualizarTotalesGenetica === 'function') grActualizarTotalesGenetica();
    };

    // Mantenida por compatibilidad (puede ser llamada desde oninput legacy).
    // Ya no genera ID automáticamente — el ID se asigna al crear la primera tanda.
    window.generarIdAutomatico = function() { /* no-op */ };

    // ==========================================
    // EVENTOS
    // ==========================================

    function inicializarEventos() {
        // Acordeones
        document.querySelectorAll('.section-header').forEach(header => {
            header.addEventListener('click', () => {
                header.parentElement.classList.toggle('collapsed');
            });
        });

        // Guardar lote
        document.getElementById('btnGuardar').addEventListener('click', guardarLote);
        
        // Nuevo lote
        document.getElementById('btnNuevoLote').addEventListener('click', nuevoLote);
        
        // Cargar lote
        document.getElementById('loteSelector').addEventListener('change', cargarLoteSeleccionado);
        
        // Exportar
        document.getElementById('btnExportJson').addEventListener('click', exportarJSON);
        document.getElementById('btnExportExcel').addEventListener('click', exportarExcel);
        
        // Importar
        const btnImportJson = document.getElementById('btnImportJson');
        if (btnImportJson) btnImportJson.addEventListener('change', importarJSON);
        const btnImportExcel = document.getElementById('btnImportExcel');
        if (btnImportExcel) btnImportExcel.addEventListener('change', importarExcel);

        // CT - Event listeners para cálculos
        inicializarEventosCT();
        
        // DC - Biblioteca de agentes (legacy — IDs antiguos pueden no existir tras migración a PROTOCOLO)
        const _dcBib = document.getElementById('dcBibliotecaAgentes');
        if (_dcBib) _dcBib.addEventListener('change', seleccionarAgenteBiblioteca);
        const _dcVolSol = document.getElementById('dcVolSol');
        if (_dcVolSol) _dcVolSol.addEventListener('input', calcularConcentracionFinal);
        const _dcConcAg = document.getElementById('dcConcAgente');
        if (_dcConcAg) _dcConcAg.addEventListener('input', calcularConcentracionFinal);
        const _dcVolAg = document.getElementById('dcVolAgente');
        if (_dcVolAg) _dcVolAg.addEventListener('input', calcularConcentracionFinal);
        
        // DG - Tabla de distribución de grano
        const dgTable = document.getElementById('dgTable');
        if (dgTable) {
            dgTable.addEventListener('input', function(e) {
                if (e.target.classList.contains('dg-frascos') || e.target.classList.contains('dg-tanda')) {
                    grActualizarTotalesGenetica();
                }
            });
        }

        // UF - Unidad Física
        ['ufEstructura','ufCapacidadTotal','ufCargaUtil','ufCantidadUnidades','ufPesoUnidad'].forEach(function(id) {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', updateUnidadFisica);
        });

        // Escuchar mensajes de gr_config.html
        if (_grMessageListener) {
            window.removeEventListener('message', _grMessageListener);
        }
        _grMessageListener = function(event) {
            if (event.data && event.data.type === 'bibliotecaActualizada') {
                cargarBibliotecaDesdeStorage();
                renderizarBibliotecaEnConfig();
                actualizarSelectoresCT();
            }
        };
        window.addEventListener('message', _grMessageListener);
    }

    // ==========================================
    // CT - Caracterización
    // ==========================================

    // Función para seleccionar grano desde el selector
    GR.seleccionarGranoCT = window.seleccionarGranoCT = function(select) {
        const row = select.closest('tr');
        const selectedOption = select.options[select.selectedIndex];
        const densidad = selectedOption ? parseFloat(selectedOption.getAttribute('data-densidad')) || 0 : 0;
        
        // Auto-completar la densidad
        row.querySelector('.ct-dens').value = densidad.toFixed(4);
        
        // Calcular automáticamente después de seleccionar
        calcularDensidadFila(row, 'dens');
    };

    function inicializarEventosCT() {
        // Obsoleto — ahora usamos oninput directo en los elementos para máxima fiabilidad
    }

    GR.actualizarFilaCT = window.actualizarFilaCT = function(el, origin) {
        const row = el.closest('.ct-row');
        if (row) calcularDensidadFila(row, origin);
    };

    function calcularDensidadFila(row, origin) {
        if (!row) return;
        
        const volInput = row.querySelector('.ct-vol');
        const masaInput = row.querySelector('.ct-masa');
        const densInput = row.querySelector('.ct-dens');
        
        if (!volInput || !masaInput || !densInput) return;

        const vol = parseFloat(volInput.value) || 0;
        const masa = parseFloat(masaInput.value) || 0;
        const densidad = parseFloat(densInput.value) || 0;
        

        // Lógica reactiva según el origen del cambio
        if (densidad > 0) {
            if (origin === 'vol' || origin === 'dens') {
                // Si cambia volumen o densidad -> calcular masa
                const nuevaMasa = vol * densidad;
                masaInput.value = nuevaMasa > 0 ? nuevaMasa.toFixed(2) : '0';
            } else if (origin === 'masa') {
                // Si cambia masa -> calcular volumen
                const nuevoVol = masa / densidad;
                volInput.value = nuevoVol > 0 ? nuevoVol.toFixed(0) : '0';
            }
        } else if (vol > 0 && masa > 0) {
            // Si no hay densidad pero sí vol y masa -> calcular densidad
            densInput.value = (masa / vol).toFixed(4);
        }
        
        actualizarTotalesCT();
    }

    function actualizarTotalesCT() {
        const rows = document.querySelectorAll('#ctTable tbody .ct-row');
        let totalVol = 0;
        let totalMasa = 0;
        let totalVolSeco = 0;
        let totalMasaSeca = 0;

        rows.forEach(row => {
            const vol = parseFloat(row.querySelector('.ct-vol').value) || 0;
            const masa = parseFloat(row.querySelector('.ct-masa').value) || 0;
            const tipo = row.querySelector('.ct-tipo')?.value || 'seco';
            
            totalVol += vol;
            totalMasa += masa;
            
            if (tipo === 'seco') {
                totalVolSeco += vol;
                totalMasaSeca += masa;
            }
        });

        document.getElementById('ctTotalVol').textContent = totalVol.toFixed(0);
        document.getElementById('ctTotalMasa').textContent = totalMasa.toFixed(2);
        
        // Exportar a KPI
        GR._masaSecaForm = totalMasaSeca;
        GR._volumenSecoForm = totalVolSeco;
        
        if (typeof updateUnidadFisica === 'function') updateUnidadFisica();
    }

    // Función para calcular todas las filas de CT manualmente
    GR.calcularTodasLasFilasCT = window.calcularTodasLasFilasCT = function() {
        const rows = document.querySelectorAll('#ctTable tbody .ct-row');
        rows.forEach(row => {
            calcularDensidadFila(row);
        });
    }

    function addCtRow() {
        const tbody = document.getElementById('ctTable').querySelector('tbody');
        const row = document.createElement('tr');
        row.className = 'ct-row';
        
        // Opciones de la biblioteca de granos
        const bib = getBiblioteca();
        const opcionesGranos = bib.granos.map(gr => {
            const dens = (Number(gr.densidadTipica) || 0);
            return `<option value="${gr.nombre}" data-densidad="${dens}">${gr.nombre} - ${dens.toFixed(3).replace('.', ',')} g/ml</option>`;
        }).join('');
        
        row.innerHTML = `
            <td>
                <select class="ct-comp" onchange="seleccionarGranoCT(this)">
                    <option value="">-- Seleccionar grano --</option>
                    ${opcionesGranos}
                </select>
            </td>
            <td>
                <select class="ct-tipo" onchange="actualizarTotalesCT()">
                    <option value="seco">Seco</option>
                    <option value="liquido">Líquido</option>
                </select>
            </td>
            <td><input type="number" class="ct-vol" value="0" min="0" step="1" oninput="actualizarFilaCT(this, 'vol')"></td>
            <td><input type="number" class="ct-masa" value="0" min="0" step="0.1" oninput="actualizarFilaCT(this, 'masa')"></td>
            <td><input type="number" class="ct-dens" value="0" readonly></td>
            <td><input type="text" class="ct-notas" placeholder="Notas..."></td>
            <td><button type="button" class="btn-remove" onclick="removeRow(this)">✕</button></td>
        `;
        const totalRow = tbody.querySelector('.dg-total-row');
        if (totalRow) {
            tbody.insertBefore(row, totalRow);
        } else {
            tbody.appendChild(row);
        }
    };

    function seleccionarAgenteBiblioteca() {
        const select = document.getElementById('dcBibliotecaAgentes');
        const agente = select.value;
        const agenteInput = document.getElementById('dcAgente');
        const concAgenteInput = document.getElementById('dcConcAgente');
        
        if (agente === 'otro' || agente === '') {
            // No hacer nada, el usuario escribirá manualmente
            return;
        }
        
        if (bibliotecaAgentes[agente]) {
            agenteInput.value = bibliotecaAgentes[agente].nombre;
            concAgenteInput.value = bibliotecaAgentes[agente].conc;
            calcularConcentracionFinal();
        }
    }

    function calcularConcentracionFinal() {
        const volSol = parseFloat(document.getElementById('dcVolSol').value) || 0;
        const volAgente = parseFloat(document.getElementById('dcVolAgente').value) || 0;
        const concAgente = parseFloat(document.getElementById('dcConcAgente').value) || 0;
        
        // Fórmula: (Vol_agente_ml × Conc_agente%) / (Vol_sol_L × 1000) = %
        // O más simple: (volAgente / (volSol * 1000)) * 100 * (concAgente / 100)
        const concentracion = (volSol > 0 && concAgente > 0) ? (volAgente * concAgente) / (volSol * 1000) : 0;
        document.getElementById('dcConc').value = concentracion.toFixed(3);
    }

    // ==========================================
    // UF - UNIDAD FÍSICA Y PRODUCCIÓN
    // Fuente de verdad de cantidad real, volumen y masa de producción.
    // DG consume ufCantidadUnidades — no define la cantidad.
    // ==========================================

    // ==========================================
    // KPI - LÓGICA CENTRALIZADA
    // ==========================================

    /**
     * Calcula KPIs para un lote individual (estado actual del form o registro)
     */
    function grCalcularKPIFormulario(lote) {
        if (!lote) return null;
        
        // Unificar fuente de producción
        const prod = lote.uf || lote.produccion || {};
        
        // Extraer valores base
        const unidades = parseFloat(prod.cantidad_unidades) || 0;
        const cargaUtil = parseFloat(prod.carga_util) || 0;
        const pesoUnidad = parseFloat(prod.peso_unidad) || 0;
        
        // Derivar totales (Normalización)
        const volumenTotalL = (unidades * cargaUtil) / 1000;
        const masaTotal = unidades * pesoUnidad;
        const densidad = cargaUtil > 0 ? (pesoUnidad / cargaUtil) * 1000 : 0;
        
        // Masa seca y Volumen seco (solo tipos "seco")
        let masaSeca = 0;
        let volumenSecoEstimado = 0;
        
        if (Array.isArray(lote.componentes)) {
            lote.componentes.forEach(c => {
                if (c.tipo === 'seco') {
                    masaSeca += parseFloat(c.masa) || 0;
                    volumenSecoEstimado += (parseFloat(c.volumen) || 0) / 1000; // a Litros
                }
            });
        }

        // Métricas de rendimiento y proceso (Dashboard UF)
        const aguaAbs = masaTotal - masaSeca;
        const hidratacion = masaSeca > 0 ? (aguaAbs / masaSeca) * 100 : 0;
        
        // El Volumen Seco debe ser el volumen real medido de los componentes (suma de ml -> L)
        const volSeco = volumenSecoEstimado; 
        const expansion = volSeco > 0 ? ((volumenTotalL / volSeco) - 1) * 100 : 0;

        return {
            unidades,
            cargaUtil,
            pesoUnidad,
            volumenTotalL,
            masaTotal,
            densidad,
            masaSeca,
            aguaAbs,
            hidratacion,
            volSeco,
            expansion
        };
    }
    window.grCalcularKPIFormulario = grCalcularKPIFormulario;

    /**
     * Calcula KPIs agregados para un array de lotes (Historial)
     */
    function grCalcularKPIHistorial(lotes) {
        const out = {
            masaTotal: 0,
            volumenTotal: 0,
            unidades: 0,
            masaSeca: 0,
            count: 0
        };

        (lotes || []).forEach(l => {
            const kpi = grCalcularKPIFormulario(l);
            if (!kpi || kpi.unidades <= 0 || kpi.pesoUnidad <= 0) return; // Filtrar fantasmas

            out.masaTotal += kpi.masaTotal;
            out.volumenTotal += kpi.volumenTotalL;
            out.unidades += kpi.unidades;
            out.masaSeca += kpi.masaSeca;
            out.count++;
        });

        out.densidadGlobal = out.volumenTotal > 0 ? out.masaTotal / out.volumenTotal : 0;
        return out;
    }
    window.grCalcularKPIHistorial = grCalcularKPIHistorial;

    function updateUnidadFisica() {
        // ── Recolectar estado actual ─────────────────────────────────────────────
        const estado = recolectarDatosLote();
        const kpi = grCalcularKPIFormulario(estado);
        
        if (!kpi) return;

        // (Validaciones de densidad y volumen eliminadas — generaban ruido innecesario)

        // ── Actualizar outputs UI (Sincronización Total) ─────────────────────────
        const _out = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        
        // Superior e Inferior unificados (Básicos)
        ['metricUfUnidades', 'reUfUnidades'].forEach(id => _out(id, kpi.unidades));
        ['metricUfVolumen', 'reUfVolumen', 'ufVolTotalL'].forEach(id => _out(id, kpi.volumenTotalL.toFixed(3)));
        ['metricUfMasa', 'reUfMasa', 'ufMasaTotal'].forEach(id => _out(id, kpi.masaTotal.toFixed(0)));
        ['metricUfDensidad', 'reUfDensidad', 'ufDensidad'].forEach(id => _out(id, kpi.densidad.toFixed(1)));
        ['metricUfPesoUnidad'].forEach(id => _out(id, kpi.pesoUnidad.toFixed(0)));
        ['metricMasaSeca', 'reMasaSeca', 'ufMasaSeca'].forEach(id => _out(id, kpi.masaSeca.toFixed(1)));

        // Dashboard UF (Métricas de Proceso)
        _out('ufHidratacion', kpi.hidratacion.toFixed(1));
        _out('ufExpansion', kpi.expansion.toFixed(1));
        _out('ufVolSeco', kpi.volSeco.toFixed(2));
        _out('ufAguaAbs', kpi.aguaAbs.toFixed(0));

        // Densidad seca: masa seca / volumen seco
        const densidadSeca = kpi.volSeco > 0 ? kpi.masaSeca / kpi.volSeco : 0;
        _out('ufDensidadSeca', densidadSeca.toFixed(1));

        // UF Helpers: headspace y oxígeno
        // headspace = capacidad total del frasco - carga útil de grano (ml libres = aire)
        // oxígeno % frasco = headspace / capacidadTotal * 100 (qué fracción del frasco es aire)
        // oxígeno ml absoluto = headspace * 0.21 (O2 puro disponible por frasco)
        const capTotal = parseFloat(document.getElementById('ufCapacidadTotal')?.value) || 0;
        const headspace = capTotal - kpi.cargaUtil;
        const oxigenoPct = capTotal > 0 ? (headspace / capTotal) * 100 : 0;
        const oxigenoMl  = headspace > 0 ? headspace * 0.21 : 0;
        _out('ufHeadspace', headspace.toFixed(0));
        _out('ufOxigeno',   oxigenoPct.toFixed(1));
        _out('ufOxigenoMl', oxigenoMl.toFixed(1));

        // Sincronizar etiqueta de unidad física y actualizar spans dependientes
        const ufEstrEl = document.getElementById('ufEstructura');
        if (ufEstrEl) _grUfEstructura = ufEstrEl.value || 'Frasco';
        const udMin = _grUd();
        const oxUnit    = document.getElementById('ufOxigenoUnit');
        const oxMlUnit  = document.getElementById('ufOxigenoMlUnit');
        if (oxUnit)   oxUnit.textContent   = '% ' + udMin;
        if (oxMlUnit) oxMlUnit.textContent = 'ml / ' + udMin;

        // Propagar cantidad al límite de DG
        grActualizarLimiteDG(kpi.unidades);
    }

    // Propaga el límite de unidades a DG para validación visual
    function grActualizarLimiteDG(limite) {
        const el = document.getElementById('dgLimiteUnidades');
        if (el) el.textContent = limite > 0 ? limite : '—';
        // Actualizar totales para que refleje el exceso si aplica
        if (typeof grActualizarTotalesGenetica === 'function') {
            grActualizarTotalesGenetica();
        }
    }

    // Exponer
    GR.updateUnidadFisica = window.updateUnidadFisica = updateUnidadFisica;

    // ==========================================
    // AD - Aditivos
    // ==========================================

    // Biblioteca de aditivos
    const bibliotecaAditivos = {
        'yeso': { nombre: 'CaSO4 (Yeso)' },
        'carbonato_ca': { nombre: 'Carbonato de Calcio' },
        'gesso': { nombre: 'Gesso' },
        'tiza': { nombre: 'Tiza' }
    };

    function addAdRow() {
        const tbody = document.getElementById('dgTable').querySelector('tbody');
        const row = document.createElement('tr');
        row.className = 'ad-row';
        row.innerHTML = `
            <td><input type="text" class="ad-tanda" placeholder="Ej: 194DA"></td>
            <td><input type="number" class="ad-frascos" value="0" min="0"></td>
            <td><input type="text" class="ad-nombre" placeholder="Ej: CaSO4"></td>
            <td><input type="number" class="ad-cant" value="0" min="0" step="0.1"></td>
            <td><input type="number" class="ad-conc" value="0" min="0" step="0.1"></td>
            <td>
                <select class="ad-estado">
                    <option value="">Seleccionar...</option>
                    <option value="ejecutado">Ejecutado</option>
                    <option value="programado">Programado</option>
                    <option value="pendiente">Pendiente</option>
                </select>
            </td>
            <td><button type="button" class="btn-remove" onclick="removeRow(this)">✕</button></td>
        `;
        tbody.appendChild(row);
    }

    // ==========================================
    // LOCALSTORAGE - GESTIÓN DE LOTES
    // ==========================================

    function cargarLotesDesdeStorage() {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            lotesData = JSON.parse(stored);
        }
        // Sistema vacío por defecto - no cargar lote automáticamente
        actualizarSelectorLotes();
    }

    function guardarEnStorage() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(lotesData));
        actualizarSelectorLotes();
    }

    function actualizarSelectorLotes() {
        const selector = document.getElementById('loteSelector');
        selector.innerHTML = '<option value="">-- Cargar lote guardado --</option>';
        
        lotesData.forEach((lote, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = `${lote.id} - ${lote.nombre} (${lote.fecha})`;
            selector.appendChild(option);
        });
        
        // También actualizar el registro visible
        grRenderizarRegistroLotes();
    }
    
    // Función para resumir inoculación por genética
    function resumirInoculacion(dg) {
        if (!dg || dg.length === 0) return '—';
        
        const resumen = {};
        
        dg.forEach(row => {
            if (!row.genetica) return;
            const nombre = row.genetica.split('/')[0].trim();
            const frascos = parseInt(row.frascos) || 0;
            resumen[nombre] = (resumen[nombre] || 0) + frascos;
        });
        
        const entries = Object.entries(resumen);
        if (entries.length === 0) return '—';
        
        const visibles = entries.slice(0, 2).map(([k,v]) => `${k} (${v})`);
        if (entries.length > 2) {
            return visibles.join(' / ') + ` +${entries.length - 2}`;
        }
        
        return visibles.join(' / ');
    }
    
    // ==========================================
// REGISTRO DE LOTES - EQUIVALENTE A SU
// ==========================================

GR.modoEdicionRegistro = false;

function grToggleEdicionRegistros() {
    GR.modoEdicionRegistro = !GR.modoEdicionRegistro;
    const btnEdit = document.getElementById('btnEditRegistros');
    if (btnEdit) {
        if (GR.modoEdicionRegistro) {
            btnEdit.textContent = '💾 Save';
            btnEdit.classList.remove('btn-secondary');
            btnEdit.classList.add('btn-primary');
        } else {
            btnEdit.textContent = '✏️ Edit';
            btnEdit.classList.remove('btn-primary');
            btnEdit.classList.add('btn-secondary');
        }
    }
    grRenderizarRegistroLotes();
}

function grSetSort(mode) {
    _grSortMode = mode || 'fecha_desc';
    grRenderizarRegistroLotes();
}
window.grSetSort = grSetSort;

function grRenderizarRegistroLotes() {
    _grInvalidateCaches(); // invalidar antes de cada render pass

    const container = document.getElementById('registroLotesBody');
    const noLotesMsg = document.getElementById('noLotesMsg');
    if (!container || !noLotesMsg) return;

    // Pre-build maps una sola vez para todo el render (O(n) en vez de O(n×m))
    const _fMap = _grFormsMap();
    const _cMap = _grCultivosMap();

    // Filtrar lotes fantasmas
    const lotesValidos = lotesData.filter(l => {
        const p = l.uf || l.produccion;
        return p && p.cantidad_unidades > 0 && p.peso_unidad > 0;
    });

    if (lotesValidos.length === 0) {
        container.innerHTML = '';
        noLotesMsg.style.display = 'block';
        _grRenderKpiBar([]);
        return;
    }

    noLotesMsg.style.display = 'none';
    _grRenderKpiBar(lotesValidos);

    const usadosMap    = grGetUsadosMap();
    const usadosRefMap = grGetUsadosRefMap();
    const _usadosForSort = grGetUsadosMap();
    const lotesOrdenados = [...lotesValidos].sort((a, b) => {
        if (_grSortMode === 'fecha_asc')  return new Date(a.fecha) - new Date(b.fecha);
        if (_grSortMode === 'id_asc')     return (a.id || '').localeCompare(b.id || '');
        if (_grSortMode === 'nombre')     return (a.nombre || '').localeCompare(b.nombre || '');
        if (_grSortMode === 'disp_desc') {
            const dispA = (Array.isArray(a.dg) ? a.dg : []).reduce((s, r) => {
                const u = (_usadosForSort[a.id] && _usadosForSort[a.id][r.tanda] != null)
                    ? parseInt(_usadosForSort[a.id][r.tanda]) || 0
                    : parseInt(r.usadosSnapshot) || 0;
                return s + Math.max(0, (parseFloat(r.frascos)||0) - (parseInt(r.contaminados)||0) - u);
            }, 0);
            const dispB = (Array.isArray(b.dg) ? b.dg : []).reduce((s, r) => {
                const u = (_usadosForSort[b.id] && _usadosForSort[b.id][r.tanda] != null)
                    ? parseInt(_usadosForSort[b.id][r.tanda]) || 0
                    : parseInt(r.usadosSnapshot) || 0;
                return s + Math.max(0, (parseFloat(r.frascos)||0) - (parseInt(r.contaminados)||0) - u);
            }, 0);
            return dispB - dispA;
        }
        return new Date(b.fecha) - new Date(a.fecha); // fecha_desc (default)
    });

    container.innerHTML = lotesOrdenados.map(lote => {
        const realIndex  = lotesData.indexOf(lote);
        const kpi        = grCalcularKPIFormulario(lote);
        const dgArr      = Array.isArray(lote.dg) ? lote.dg : [];
        const usadosLote = usadosMap[lote.id] || {};
        const usadosRefLote = usadosRefMap[lote.id] || {};

        const sumFrascos = dgArr.reduce((s, r) => s + (parseFloat(r.frascos) || 0), 0);
        const sumContam  = dgArr.reduce((s, r) => s + (parseInt(r.contaminados) || 0), 0);
        const sumDisp    = dgArr.reduce((s, r) => {
            const u = (r.tanda && usadosLote[r.tanda] != null)
                ? (parseInt(usadosLote[r.tanda]) || 0)
                : (parseInt(r.usadosSnapshot) || 0);
            const uEx = grGetExUsadosGR(lote.id, r.tanda);
            return s + Math.max(0, (parseFloat(r.frascos) || 0) - (parseInt(r.contaminados) || 0) - u - uEx);
        }, 0);

        const dispClass = sumDisp === 0 ? 'gr-disp-agotado'
            : sumDisp <= Math.max(1, Math.floor(sumFrascos * 0.2)) ? 'gr-disp-bajo' : 'gr-disp-ok';

        // Acciones (solo en modo edición)
        const acciones = GR.modoEdicionRegistro
            ? `<div class="gr-card-actions">
                 <button class="btn-small" style="background:var(--highlight);color:white" onclick="event.stopPropagation(); grCargarRegistro(${realIndex})" title="Cargar">📂</button>
                 <button class="btn-small" style="background:var(--danger);color:white" onclick="event.stopPropagation(); grEliminarRegistro(${realIndex})" title="Eliminar">✕</button>
               </div>`
            : '';

        // Filas de tandas
        const tandasHtml = dgArr.map(r => {
            const t   = r.tanda || '-';
            const uds = parseFloat(r.frascos) || 0;
            const co  = parseInt(r.contaminados) || 0;
            const usadosLive = (r.tanda && usadosLote[r.tanda] != null)
                ? (parseInt(usadosLote[r.tanda]) || 0) : null;
            const usados = usadosLive != null ? usadosLive : (parseInt(r.usadosSnapshot) || 0);
            const usadosEx = grGetExUsadosGR(lote.id, r.tanda);
            const disp   = usadosLive != null
                ? Math.max(0, uds - co - usados - usadosEx)
                : (r.disponiblesSnapshot != null
                    ? Math.max(0, parseInt(r.disponiblesSnapshot) - usadosEx)
                    : Math.max(0, uds - co - usados - usadosEx));
            let gen = r.genetica || '—';
            if (r.inoculoSource === 'CI') {
                const fNombre = r.formulaNombre
                    || (r.cultivoCiId && _cMap[r.cultivoCiId]
                        ? (_fMap[_cMap[r.cultivoCiId].medioFormulaId] || '')
                        : '');
                if (fNombre) gen += ` — ${fNombre}`;
            }
            const colon  = r.colonizacion
                ? `<span class="gr-tanda-chip gr-chip-dim" title="Fin colonización">✅ ${_grFormatFecha(r.colonizacion)}</span>` : '';
            const suRefs = (r.tanda && usadosRefLote[r.tanda] && usadosRefLote[r.tanda].length > 0)
                ? usadosRefLote[r.tanda].join(' / ') : null;
            const suTag  = usados > 0
                ? `<span class="gr-tanda-chip gr-chip-su" title="${suRefs ? suRefs : 'Usado en SU'}">🧱 ${usados} ud SU</span>`
                : '';
            const exIds  = grGetExIdsGR(lote.id, r.tanda);
            const exTag  = exIds.length > 0
                ? `<span class="gr-tanda-chip gr-chip-ex" title="Usado en experimento">🔬 ${exIds.join(' · ')}</span>`
                : '';
            const tdispClass = disp === 0 ? 'gr-disp-agotado'
                : disp <= Math.max(1, Math.floor(uds * 0.2)) ? 'gr-disp-bajo' : 'gr-disp-ok';
            const metaTanda = [colon, suTag, exTag].filter(Boolean).join('');

            return `<div class="gr-tanda-row">
                <div class="gr-tanda-left">
                    <span class="gr-tanda-id">${t}</span>
                    <span class="gr-tanda-gen">${gen}</span>
                </div>
                <div class="gr-tanda-right">
                    <span class="gr-tanda-uds">${uds} ud</span>
                    ${co > 0 ? `<span class="gr-tanda-chip gr-chip-contam">✕ ${co}</span>` : ''}
                    <span class="gr-tanda-disp ${tdispClass}">▸ ${disp}</span>
                    ${metaTanda ? `<div class="gr-tanda-meta">${metaTanda}</div>` : ''}
                </div>
            </div>`;
        }).join('');


        const contamChip = sumContam > 0
            ? `<span class="gr-stat-chip gr-chip-contam">✕ ${sumContam} contaminación</span>`
            : `<span class="gr-stat-chip gr-chip-dim">— contaminación</span>`;

        const loteIdSafe = (lote.id || '').replace(/'/g, "\\'");
        const grainFirma = _grFirmaProtocolo(lote);
        return `<div class="gr-reg-card" onclick="grCargarRegistroYVolver(${realIndex})" title="Cargar registro">
            <div class="gr-card-head">
                <div class="gr-card-identity">
                    <span class="gr-card-id">${lote.id || '-'}</span>
                    ${lote.nombre ? `<span class="gr-card-nombre">${lote.nombre}</span>` : ''}
                </div>
                <div class="gr-card-grain" title="${grainFirma}">${grainFirma}</div>
                <div class="gr-card-right">
                    <span class="gr-card-fecha">${_grFormatFecha(lote.fecha)}</span>
                    <button class="gr-traza-toggle" onclick="event.stopPropagation(); grToggleTrazabilidad('${loteIdSafe}', this)" title="Ver trazabilidad">▶ Trazabilidad</button>
                </div>
            </div>
            <div class="gr-card-stats-bar">
                <span class="gr-stat-chip">${dgArr.length} tanda${dgArr.length !== 1 ? 's' : ''}</span>
                <span class="gr-stat-chip">${sumFrascos} ud</span>
                ${contamChip}
                <span class="gr-stat-chip ${dispClass}">▸ ${sumDisp} disponibles</span>
                ${acciones}
            </div>
            ${dgArr.length > 0 ? `<div class="gr-card-tandas">${tandasHtml}</div>` : ''}
            <div class="gr-traza-panel" id="grTraza_${lote.id}" style="display:none"></div>
        </div>`;
    }).join('');
}

function _grRenderKpiBar(lotes) {
    const bar = document.getElementById('grRegKpiBar');
    if (!bar) return;
    if (!lotes.length) { bar.style.display = 'none'; return; }

    const usadosMap = grGetUsadosMap();
    var totalFrascos = 0, totalContam = 0, totalDisp = 0, totalLotesActivos = 0;
    var sumMasaSeca = 0, sumVolumen = 0;

    lotes.forEach(l => {
        const dgArr = Array.isArray(l.dg) ? l.dg : [];
        const usadosLote = usadosMap[l.id] || {};
        const kpi = grCalcularKPIFormulario(l);
        var loteDisp = 0;
        dgArr.forEach(r => {
            const fr = parseFloat(r.frascos) || 0;
            const co = parseInt(r.contaminados) || 0;
            const u  = (r.tanda && usadosLote[r.tanda] != null)
                ? (parseInt(usadosLote[r.tanda]) || 0)
                : (parseInt(r.usadosSnapshot) || 0);
            totalFrascos += fr;
            totalContam  += co;
            loteDisp     += Math.max(0, fr - co - u);
        });
        totalDisp += loteDisp;
        if (loteDisp > 0) totalLotesActivos++;
        sumMasaSeca += (kpi && kpi.masaSeca) || 0;
        sumVolumen  += (kpi && kpi.volumenTotalL) || 0;
    });

    const contamPct = totalFrascos > 0 ? ((totalContam / totalFrascos) * 100).toFixed(1) : '0';
    const contamColor = parseFloat(contamPct) > 20 ? 'var(--danger,#C00000)'
        : parseFloat(contamPct) > 5 ? 'var(--warning,#FFC000)' : 'var(--highlight,#70AD47)';

    bar.style.display = 'grid';
    bar.innerHTML = `
        <div class="gr-kpi">
            <span class="gr-kpi-label">Total unidades</span>
            <span class="gr-kpi-val">${totalFrascos}</span>
            <span class="gr-kpi-sub">en ${lotes.length} lote${lotes.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="gr-kpi">
            <span class="gr-kpi-label">Disponibles</span>
            <span class="gr-kpi-val" style="color:var(--highlight,#70AD47)">${totalDisp}</span>
            <span class="gr-kpi-sub">${totalLotesActivos} lote${totalLotesActivos !== 1 ? 's' : ''} activo${totalLotesActivos !== 1 ? 's' : ''}</span>
        </div>
        <div class="gr-kpi">
            <span class="gr-kpi-label">Contaminación</span>
            <span class="gr-kpi-val" style="color:${contamColor}">${contamPct}%</span>
            <span class="gr-kpi-sub">${totalContam} unidades</span>
        </div>
        <div class="gr-kpi">
            <span class="gr-kpi-label">Masa seca total</span>
            <span class="gr-kpi-val">${sumMasaSeca.toFixed(0)}g</span>
            <span class="gr-kpi-sub">${sumVolumen.toFixed(2)}L volumen</span>
        </div>`;
}

function grCargarRegistro(index) {
    if (!lotesData[index]) return;
    cargarDatosLote(lotesData[index]);
    alert('Registro cargado: ' + lotesData[index].id);
}

function grEliminarRegistro(index) {
    if (!lotesData[index]) return;
    const loteId = lotesData[index].id;
    if (!confirm('¿Eliminar el registro "' + loteId + '"?')) return;
    lotesData.splice(index, 1);
    guardarEnStorage();
    grRenderizarRegistroLotes();
    // Anular links CI asociados al lote eliminado
    if (window.CiGrLinks && loteId) {
        try {
            const links = window.CiGrLinks.load();
            const ahora = new Date().toISOString();
            let modificado = false;
            for (const l of links) {
                if (l.estado === 'ACTIVO' && l.grLoteId === loteId) {
                    l.estado = 'ANULADO';
                    l.fechaAnulacion = ahora;
                    l.motivoAnulacion = 'lote GR eliminado';
                    modificado = true;
                }
            }
            if (modificado) {
                localStorage.setItem(window.CiGrLinks.STORAGE_KEY, JSON.stringify(links));
                window.dispatchEvent(new CustomEvent('ci-cultivos-changed', { detail: { tipo: 'links-anulados', grLoteId: loteId } }));
            }
        } catch (e) { console.warn('[GR] Error anulando links CI post-eliminación:', e); }
    }
    alert('Registro eliminado');
}

window.grCargarPorId = function(id) {
    var idx = lotesData.findIndex(function(l) { return l.id === id; });
    if (idx !== -1) window.grCargarRegistroYVolver(idx);
};

window.grCargarRegistroYVolver = function(index) {
    try {
        if (!lotesData[index]) return;
        cargarDatosLote(lotesData[index]);
        window.grSubTab('main');
    } catch (e) {
        console.error('grCargarRegistroYVolver error:', e);
    }
};

// Exponer funciones al window
window.grToggleEdicionRegistros = grToggleEdicionRegistros;
window.grRenderizarRegistroLotes = grRenderizarRegistroLotes;
window.grCargarRegistro = grCargarRegistro;
window.grEliminarRegistro = grEliminarRegistro;
    
    // Función para cargar lote desde el registro
    GR.cargarLoteDesdeRegistro = window.cargarLoteDesdeRegistro = function(index) {
        if (lotesData[index]) {
            cargarDatosLote(lotesData[index]);
            document.getElementById('loteSelector').value = index;
        }
    };
    
    // Función para eliminar lote desde el registro
    GR.eliminarLoteDesdeRegistro = window.eliminarLoteDesdeRegistro = function(index) {
        const lote = lotesData[index];
        if (!lote) return;
        
        if (!confirm(`¿Eliminar el lote "${lote.id}" del sistema?`)) return;
        
        lotesData.splice(index, 1);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(lotesData));
        grRenderizarRegistroLotes();
        actualizarSelectorLotes();
        alert('Lote eliminado');
    };

    function guardarLote() {
        
        const lote = recolectarDatosLote();
        
        // Validar — si no hay ID intentamos asignarlo ahora (puede ocurrir si el usuario
        // no agregó tandas pero guardó igual, o si addDgRow no fue llamado aún)
        if (!lote.id) {
            const dgTandas = document.querySelectorAll('#dgTable tbody .dg-tanda');
            if (dgTandas.length > 0) {
                // Hay tandas — asignar ID automáticamente
                _grAsignarLoteIdSiVacio();
                lote.id = (document.getElementById('loteId')?.value || '').trim();
            }
            if (!lote.id) {
                alert('Agrega al menos una tanda antes de guardar, o ingresa un ID manualmente.');
                return;
            }
        }

        if (!lote.uf || lote.uf.cantidad_unidades <= 0) {
            alert('Completa UF: la cantidad de unidades debe ser mayor a 0.');
            return;
        }
        if (!lote.uf || lote.uf.peso_unidad <= 0) {
            alert('Completa UF: el peso por unidad debe ser mayor a 0.');
            return;
        }

        
        // Buscar si existe
        const indiceExistente = lotesData.findIndex(l => l.id === lote.id);

        if (indiceExistente >= 0) {
            if (!confirm('Ya existe un lote con este ID. ¿Deseas sobrescribirlo?')) {
                return;
            }
        }

        // [Fase 4] Aplicar consumo de Cultivos CI: pre-valida stock, devuelve los
        // consumos previos del lote, y consume 1 unidad por fila DG con source CI.
        // Si CI no está cargado, este paso es no-op (graceful degradation).
        const _oldDg = (indiceExistente >= 0) ? (lotesData[indiceExistente].dg || []) : [];
        const _consRes = _grAplicarConsumosCi(lote.id, _oldDg, lote.dg || []);
        if (!_consRes.ok) {
            alert('No se pudo guardar — consumo CI bloqueado:\n\n' + _consRes.motivo);
            return;
        }

        if (indiceExistente >= 0) {
            lotesData[indiceExistente] = lote;
        } else {
            lotesData.push(lote);
        }

        guardarEnStorage();

        alert('Lote guardado correctamente');

        // Actualizar registro visible
        grRenderizarRegistroLotes();
    }

    // ==========================================
    // EXPORTAR JSON - Incluye lote actual + todos los lotes registrados
    // ==========================================
    function exportarJSON() {
        const lote = recolectarDatosLote();
        
        if (!lote.id) {
            alert('Guarda el lote primero antes de exportar');
            return;
        }
        
        // Obtener todos los lotes registrados
        const todosLosLotes = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        
        // Crear objeto de exportación completo
        const exportData = {
            version: '1.0',
            fechaExportacion: new Date().toISOString().split('T')[0],
            loteActual: lote,
            lotesRegistrados: todosLosLotes,
            biblioteca: GR.biblioteca
        };
        
        const json = JSON.stringify(exportData, null, 2);
        
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        const fecha = lote.fecha || new Date().toISOString().split('T')[0];
        a.download = `sustratos_${lote.id}_${fecha}_completo.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ==========================================
    // EXPORTAR EXCEL
    // ==========================================
    function exportarExcel() {
        const lote = recolectarDatosLote();
        
        if (!lote.id) {
            alert('Guarda el lote primero antes de exportar');
            return;
        }
        
        if (typeof XLSX === 'undefined') {
            alert('Biblioteca Excel no cargada. Intenta de nuevo.');
            return;
        }
        
        const wb = XLSX.utils.book_new();
        const fecha = lote.fecha || new Date().toISOString().split('T')[0];
        
        // Hoja RESUMEN
        const resumenData = [
            ['PROTOCOLO DE SUSTRATOS'],
            ['Lote:', lote.id],
            ['Nombre:', lote.nombre],
            ['Fecha:', fecha],
            ['Versión:', lote.version],
            [],
            ['MÉTRICAS PRINCIPALES'],
            ['Masa seca total', (lote.componentes || []).reduce((s, c) => s + (c.masa || 0), 0), 'g'],
            ['Estructura', lote.uf?.estructura || '—'],
            ['Cantidad unidades', lote.uf?.cantidad_unidades || 0, 'ud'],
            ['Peso por unidad', lote.uf?.peso_unidad || 0, 'g'],
            ['Volumen total', lote.uf?.volumen_total_l || 0, 'L'],
            ['Masa total', lote.uf?.masa_total || 0, 'g'],
            ['Densidad hidratada', lote.uf?.densidad || 0, 'g/L']
        ];
        const wsResumen = XLSX.utils.aoa_to_sheet(resumenData);
        XLSX.utils.book_append_sheet(wb, wsResumen, 'RESUMEN');

        // Hoja CT
        const ctData = [
            ['CT - CARACTERIZACIÓN'],
            [],
            ['Componente', 'Volumen (ml)', 'Masa (g)', 'Densidad (g/ml)', 'Notas']
        ];
        (lote.componentes || []).forEach(c => {
            ctData.push([c.nombre, c.volumen, c.masa, c.densidad, c.notas]);
        });
        const wsCT = XLSX.utils.aoa_to_sheet(ctData);
        XLSX.utils.book_append_sheet(wb, wsCT, 'CT_CARACTERIZACION');

        // Hoja UF
        const uf = lote.uf || {};
        const ufData = [
            ['UF - UNIDAD FÍSICA Y PRODUCCIÓN'],
            [],
            ['Parámetro', 'Valor', 'Unidad'],
            ['Estructura',        uf.estructura        || '—', ''],
            ['Capacidad total',   uf.capacidad_total   || 0, 'ml'],
            ['Carga útil',        uf.carga_util        || 0, 'ml'],
            ['Cantidad unidades', uf.cantidad_unidades || 0, 'ud'],
            ['Peso por unidad',   uf.peso_unidad       || 0, 'g'],
            ['Volumen total',     uf.volumen_total_ml  || 0, 'ml'],
            ['Volumen total',     uf.volumen_total_l   || 0, 'L'],
            ['Masa total',        uf.masa_total        || 0, 'g'],
            ['Densidad hidratada',uf.densidad          || 0, 'g/L']
        ];
        const wsUF = XLSX.utils.aoa_to_sheet(ufData);
        XLSX.utils.book_append_sheet(wb, wsUF, 'UF_PRODUCCION');

        // Hoja RE
        const reData = [
            ['RE - RESULTADOS'],
            [],
            ['Métrica', 'Valor'],
            ['Masa Seca', document.getElementById('reMasaSeca')?.textContent || 0],
            [],
            ['EVALUACIÓN'],
            ['Hidratación', lote.re?.evaluacion?.hidratacion || '-'],
            ['Distribución', lote.re?.evaluacion?.distribucion || '-'],
            ['Eficiencia', lote.re?.evaluacion?.eficiencia || '-'],
            [],
            ['Notas', lote.re?.notas || '-']
        ];
        const wsRE = XLSX.utils.aoa_to_sheet(reData);
        XLSX.utils.book_append_sheet(wb, wsRE, 'RE_RESULTADOS');

        XLSX.writeFile(wb, `sustrato_${lote.id}_${fecha}.xlsx`);
    }

    // ==========================================
    // IMPORTAR JSON - Soporta formato nuevo (con loteActual + lotesRegistrados) y formato legacy
    // ==========================================
    function importarJSON(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const data = JSON.parse(e.target.result);
                
                let agregados = 0;
                let duplicados = 0;
                
                // Determinar el formato del archivo
                let lotesAImportar = [];
                
                if (data.loteActual) {
                    // Nuevo formato: { version, fechaExportacion, loteActual, lotesRegistrados, biblioteca }
                    
                    // Importar biblioteca si existe
                    if (data.biblioteca) {
                        GR.biblioteca = data.biblioteca;
                        localStorage.setItem('sustratos_biblioteca', JSON.stringify(GR.biblioteca));
                    }
                    
                    // Importar lotesRegistrados
                    if (Array.isArray(data.lotesRegistrados)) {
                        data.lotesRegistrados.forEach(lote => {
                            if (!lote.id) return;
                            const existe = lotesData.some(l => l.id === lote.id);
                            if (!existe) {
                                lotesData.push(lote);
                                agregados++;
                            } else {
                                duplicados++;
                            }
                        });
                    }
                    
                    // Importar loteActual
                    if (data.loteActual && data.loteActual.id) {
                        const existe = lotesData.some(l => l.id === data.loteActual.id);
                        if (!existe) {
                            lotesData.push(data.loteActual);
                            agregados++;
                        } else {
                            duplicados++;
                        }
                    }
                } else if (Array.isArray(data)) {
                    // Formato legacy: array de lotes
                    lotesAImportar = data;
                } else if (data.id) {
                    // Formato legacy: un solo lote
                    lotesAImportar = [data];
                } else {
                    throw new Error('Formato JSON no reconocido');
                }
                
                // Procesar formato legacy si aplica
                if (lotesAImportar.length > 0) {
                    lotesAImportar.forEach(lote => {
                        if (!lote.id) return;
                        const existe = lotesData.some(l => l.id === lote.id);
                        if (!existe) {
                            lotesData.push(lote);
                            agregados++;
                        } else {
                            duplicados++;
                        }
                    });
                }
                
                localStorage.setItem(STORAGE_KEY, JSON.stringify(lotesData));
                actualizarSelectorLotes();
                renderizarBibliotecaEnConfig();
                
                // Auto-seleccionar el último lote importado (loteActual si existe)
                if (agregados > 0) {
                    const selector = document.getElementById('loteSelector');
                    selector.value = String(lotesData.length - 1);
                    cargarLoteSeleccionado();
                }
                
                alert(`Importación completada:\n- ${agregados} lotes agregados\n- ${duplicados} lotes omitidos (ya existían)`);
                
                // Limpiar input
                event.target.value = '';
            } catch (err) {
                alert('Error al parsear el archivo JSON. Verifica el formato.');
                console.error(err);
            }
        };
        reader.readAsText(file);
    }

    // ==========================================
    // IMPORTAR EXCEL
    // ==========================================
    function importarExcel(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        if (typeof XLSX === 'undefined') {
            alert('Biblioteca Excel no cargada. Intenta de nuevo.');
            return;
        }
        
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                
                // Leer primera hoja - debe tener datos del lote
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
                
                // Buscar el ID del lote en la primera columna (fila 2 típicamente)
                // y reconstruir el objeto lote desde las filas
                // Por ahora, intentar parsear como objeto simple
                
                // Intentar obtener datos directamente de la primera hoja
                let loteData = {};
                jsonData.forEach((row, idx) => {
                    if (idx >= 1 && row[0]) { // Skip header, start from row 1
                        const key = row[0];
                        const value = row[1];
                        if (key && value !== undefined) {
                            loteData[key] = value;
                        }
                    }
                });
                
                // Si es un formato de objeto simple
                if (loteData.Lote || loteData.id) {
                    const existe = lotesData.some(l => l.id === (loteData.Lote || loteData.id));
                    
                    if (!existe) {
                        // Reconstruir objeto lote completo
                        const lote = {
                            id: loteData.Lote || loteData.id || 'IMPORT-' + Date.now(),
                            nombre: loteData.Nombre || loteData.nombre || loteData.Mezcla || loteData.mezcla || '',
                            fecha: loteData.Fecha || loteData.fecha || new Date().toISOString().split('T')[0],
                            version: loteData.Versión || loteData.version || 'v1',
                            componentes: [],
                            dc: {},
                            hm: {},
                            dg: [],
                            es: {},
                            re: {}
                        };
                        
                        lotesData.push(lote);
                        
                        localStorage.setItem(STORAGE_KEY, JSON.stringify(lotesData));
                        actualizarSelectorLotes();
                        
                        alert('Lote importado correctamente');
                    } else {
                        alert('El lote ya existe en el sistema');
                    }
                } else {
                    alert('No se pudo extraer información del Excel. Verifica el formato.');
                }
                
                // Limpiar input
                event.target.value = '';
            } catch (err) {
                alert('Error al leer el archivo Excel. Verifica el formato.');
                console.error(err);
            }
        };
        reader.readAsArrayBuffer(file);
    }

    function cargarLoteSeleccionado() {
        const selector = document.getElementById('loteSelector');
        const index = selector.value;
        
        if (index === '') {
            const btnEliminar = document.getElementById('btnEliminarLote');
            if (btnEliminar) btnEliminar.disabled = true;
            return;
        }

        const lote = lotesData[index];
        cargarDatosLote(lote);
        
        // Verificar que btnEliminarLote existe
        const btnEliminar = document.getElementById('btnEliminarLote');
        if (btnEliminar) btnEliminar.disabled = false;
    }

    function eliminarLote() {
        const selector = document.getElementById('loteSelector');
        const index = selector.value;
        
        if (index === '') return;
        
        const lote = lotesData[index];
        
        if (confirm(`¿Estás seguro de eliminar el lote "${lote.id}"?`)) {
            lotesData.splice(index, 1);
            guardarEnStorage();
            nuevoLote();
            alert('Lote eliminado');
        }
    }

    GR.nuevoLote = window.nuevoLote = function() {
        const idInput = document.getElementById('loteId');
        if (idInput) idInput.dataset.manualEdit = 'false';
        
        document.getElementById('loteId').value = '';
        document.getElementById('loteNombre').value = '';
        document.getElementById('loteVersion').value = 'v1';
        establecerFechaActual();
        generarIdAutomatico();
        
        // Limpiar CT
        const ctTbody = document.getElementById('ctTable').querySelector('tbody');
        ctTbody.innerHTML = '';
        addCtRow();
        addCtRow();
        
        // Limpiar DC (IDs legacy + nuevos IDs del protocolo — guardados)
        const _clr = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
        _clr('dcVolSol', 0); _clr('dcAgente', ''); _clr('dcConcAgente', 0); _clr('dcVolAgente', 0);
        _clr('dcConc', 0); _clr('dcTiempo', 0);
        _clr('grDcVolSol', ''); _clr('grDcAgente', ''); _clr('grDcConcAgente', ''); _clr('grDcVolAgente', '');
        _clr('grDcTiempo', '');

        // Limpiar UF
        _clr('ufEstructura',       'Frasco');
        _clr('ufCapacidadTotal',   660);
        _clr('ufCargaUtil',        500);
        _clr('ufCantidadUnidades', 0);
        _clr('ufPesoUnidad',       0);
        GR._ufPesoUnidad = 0;
        updateUnidadFisica();
        
        // Limpiar DG — tabla vacía hasta que el usuario agregue la primera tanda
        const dgTbody = document.getElementById('dgTable').querySelector('tbody');
        dgTbody.innerHTML = '';

        // Limpiar RE - campos eliminados del sistema
        // document.getElementById('evalHidratacion').value = '';
        // document.getElementById('evalDistribucion').value = '';
        // document.getElementById('evalEficiencia').value = '';
        
        // Resetear selector
        document.getElementById('loteSelector').value = '';

        // Verificar que btnEliminarLote existe antes de acceder
        const btnEliminar = document.getElementById('btnEliminarLote');
        if (btnEliminar) btnEliminar.disabled = true;

        // Limpiar notas — cada protocolo tiene su propio historial
        GR.protoNotas = [];
        GR.seguimientoNotas = [];
        GR.protoCerrado = false;
        GR.dcRegistrado = false;
        if (typeof grRenderNotas === 'function') grRenderNotas();
        if (typeof window.grRenderSeguimientoNotas === 'function') window.grRenderSeguimientoNotas();

        // Recalcular CT
        actualizarTotalesCT();
    }

    // ==========================================
    // RECOLECTAR DATOS PARA GUARDAR
    // ==========================================

    function recolectarDatosLote() {
        
        // CT
        const componentes = [];
        document.querySelectorAll('#ctTable tbody .ct-row').forEach(row => {
            componentes.push({
                nombre: row.querySelector('.ct-comp').value,
                tipo: row.querySelector('.ct-tipo')?.value || 'seco',
                volumen: parseFloat(row.querySelector('.ct-vol').value) || 0,
                densidad: parseFloat(row.querySelector('.ct-dens').value) || 0,
                masa: parseFloat(row.querySelector('.ct-masa').value) || 0,
                notas: row.querySelector('.ct-notas').value
            });
        });

        // DC — leer tanto del panel nuevo (grDc*) como de los IDs legacy
        const _val = (id, def = '') => document.getElementById(id)?.value ?? def;
        const _num = (id, def = 0) => parseFloat(document.getElementById(id)?.value) || def;
        const dc = {
            volSol: _num('grDcVolSol') || _num('dcVolSol'),
            agente: _val('grDcAgente') || _val('dcAgente'),
            concAgente: _num('grDcConcAgente') || _num('dcConcAgente'),
            volAgente: _num('grDcVolAgente') || _num('dcVolAgente'),
            conc: parseFloat(document.getElementById('grDcConcFinal')?.textContent) || _num('dcConc'),
            tiempo: _num('grDcTiempo') || _num('dcTiempo')
        };

        // UF - Unidad Física (fuente de verdad de producción)
        const _ufNum = (id) => parseFloat(document.getElementById(id)?.value) || 0;
        const _ufTxt = (id) => document.getElementById(id)?.value || '';
        const ufCargaUtil    = _ufNum('ufCargaUtil');
        const ufCantUnidades = _ufNum('ufCantidadUnidades');
        const ufPesoUnidad   = _ufNum('ufPesoUnidad');
        const uf = {
            estructura:        _ufTxt('ufEstructura'),
            capacidad_total:   _ufNum('ufCapacidadTotal'),
            carga_util:        ufCargaUtil,
            cantidad_unidades: ufCantUnidades,
            peso_unidad:       ufPesoUnidad,
            volumen_total_ml:  ufCantUnidades * ufCargaUtil,
            volumen_total_l:   (ufCantUnidades * ufCargaUtil) / 1000,
            masa_total:        ufCantUnidades * ufPesoUnidad,
            densidad:          ufCargaUtil > 0 && ufPesoUnidad > 0 ? (ufPesoUnidad / ufCargaUtil) * 1000 : 0
        };

        // DG - Distribución de Grano
        const dg = [];

        const dgRows = document.querySelectorAll('#dgTable tbody .dg-row');
        
        // loteId y usados actuales para snapshot de Disponibles
        const _loteIdActual = (document.getElementById('loteId')?.value || '').trim();
        const _usadosMap = grGetUsadosMap();
        const _usadosLote = _loteIdActual && _usadosMap[_loteIdActual] ? _usadosMap[_loteIdActual] : {};

        dgRows.forEach((row, index) => {
            const tandaInput = row.querySelector('.dg-tanda');
            const frascosInput = row.querySelector('.dg-frascos');
            const geneticaSelect = row.querySelector('.dg-genetica');

            const tanda = tandaInput ? tandaInput.value : '';
            const frascos = frascosInput ? (parseFloat(frascosInput.value) || 0) : 0;
            const rawSelValue = geneticaSelect ? (geneticaSelect.value || '') : '';
            const contaminados = parseInt(row.querySelector('.dg-contaminados')?.value) || 0;

            // [Fase 4] Resolver source CI vs GE desde el value del select
            const inoc = (typeof _grResolverInoculo === 'function') ? _grResolverInoculo(rawSelValue) : null;
            let inoculoSource = null;
            let cultivoCiId = null;
            let fenId = null;
            let geneticaNombre = null;
            let formulaNombreCi = null;

            if (inoc) {
                if (inoc.source === 'CI') {
                    inoculoSource = 'CI';
                    cultivoCiId = inoc.id;
                    const _ciCultivo = _grGetCultivoCI(cultivoCiId)
                        || (window.CI && typeof window.CI.getCultivoById === 'function' ? window.CI.getCultivoById(cultivoCiId) : null);
                    if (_ciCultivo) {
                        fenId = _ciCultivo.geneticaId || null;
                        geneticaNombre = (_ciCultivo.geneticaSnapshot && _ciCultivo.geneticaSnapshot.label) || null;
                        const _fMap = _grFormsMap();
                        formulaNombreCi = (_ciCultivo.medioFormulaId && _fMap[_ciCultivo.medioFormulaId]) || null;
                    }
                } else {
                    inoculoSource = 'GE';
                    fenId = inoc.id;
                    geneticaNombre = grGetNombreGeneticaPorId(inoc.id);
                }
            }

            // Snapshot de Disponibles al momento de guardar (nunca es un valor fijo en vivo,
            // pero sí se congela en el Registro histórico)
            const usadosTanda = (tanda && _usadosLote[tanda]) ? parseInt(_usadosLote[tanda]) || 0 : 0;
            const disponiblesSnapshot = Math.max(0, frascos - contaminados - usadosTanda);

            // [Fase 4 patch²] Placas usadas: campo universal para CI y GE.
            // Para CI se descuenta del inventario; para GE es solo metadata/audit.
            const placasRaw = parseInt(row.querySelector('.dg-placas-usadas')?.value, 10);
            const placasUsadas = (Number.isInteger(placasRaw) && placasRaw >= 0) ? placasRaw : 1;

            dg.push({
                tanda: tanda,
                frascos: frascos,
                fen_id: fenId,
                genetica: geneticaNombre,
                inoculoSource: inoculoSource,   // [Fase 4] 'CI' | 'GE' | null
                cultivoCiId: cultivoCiId,        // [Fase 4] presente solo si inoculoSource === 'CI'
                formulaNombre: formulaNombreCi,  // nombre de fórmula CI (trazabilidad display)
                placasUsadas: placasUsadas,      // [Fase 4 patch²] universal (CI + GE)
                fechaInoculo: row.querySelector('.dg-fecha-inoculo')?.value || row.dataset.fechaInoculacion || null,
                fechaInoculacion: row.querySelector('.dg-fecha-inoculo')?.value || row.dataset.fechaInoculacion || null,
                contaminados: contaminados,
                usadosSnapshot: usadosTanda,
                disponiblesSnapshot: disponiblesSnapshot,
                colonizacion: row.querySelector('.dg-colonizacion')?.value || null
            });
        });
        

        // PO
        const po = [];
        for (let i = 1; i <= 6; i++) {
            const checkbox = document.getElementById('po' + i);
            po.push({
                paso: i,
                completado: checkbox ? checkbox.checked : false
            });
        }

        // RE
        const re = {};

        return {
            id: document.getElementById('loteId').value,
            nombre: document.getElementById('loteNombre').value,
            fecha: document.getElementById('loteFecha').value,
            version: document.getElementById('loteVersion').value,
            componentes,
            dc,
            hm: {},
            uf,
            dg,
            po,
            re,
            protoNotas: GR.protoNotas || [],
            seguimientoNotas: GR.seguimientoNotas || []
        };
    }

    // ==========================================
    // CARGAR DATOS DE UN LOTE
    // ==========================================

    function cargarDatosLote(lote) {
        // Datos básicos
        const idInput = document.getElementById('loteId');
        const tieneTandas = Array.isArray(lote.dg) && lote.dg.length > 0;

        if (idInput) {
            if (tieneTandas) {
                // Ya fue inoculado → respetar el ID guardado
                idInput.dataset.manualEdit = 'true';
                idInput.value = lote.id || '';
                idInput.style.opacity = '1';
            } else {
                // Sin tandas = nunca inoculado → limpiar el ID para que se
                // regenere con la fecha real del sistema cuando se agregue la primera tanda
                idInput.dataset.manualEdit = 'false';
                idInput.value = '';
                idInput.style.opacity = '0.7';
                const hint = document.getElementById('loteIdHint');
                if (hint) hint.textContent = 'Se asigna automáticamente al agregar la primera tanda';
            }
        }
        document.getElementById('loteNombre').value = lote.nombre || '';
        document.getElementById('loteFecha').value = lote.fecha || '';
        document.getElementById('loteVersion').value = lote.version || 'v1';

        // CT - Componentes
        const ctTbody = document.getElementById('ctTable').querySelector('tbody');
        ctTbody.innerHTML = '';
        (lote.componentes || []).forEach(comp => {
            addCtRow();
            const row = ctTbody.lastElementChild;
            row.querySelector('.ct-comp').value = comp.nombre || '';
            row.querySelector('.ct-vol').value = comp.volumen || 0;
            row.querySelector('.ct-dens').value = comp.densidad || 0;
            row.querySelector('.ct-masa').value = comp.masa || 0;
            row.querySelector('.ct-notas').value = comp.notas || '';
        });
        actualizarTotalesCT();

        // DC — escribe a panel nuevo (grDc*) si existe, fallback a IDs legacy
        if (lote.dc) {
            const _set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
            _set('grDcVolSol', lote.dc.volSol || '');
            _set('grDcAgente', lote.dc.agente || '');
            _set('grDcConcAgente', lote.dc.concAgente || '');
            _set('grDcVolAgente', lote.dc.volAgente || '');
            _set('grDcTiempo', lote.dc.tiempo || '');
            _set('dcVolSol', lote.dc.volSol || 0);
            _set('dcAgente', lote.dc.agente || '');
            _set('dcConcAgente', lote.dc.concAgente || 0);
            _set('dcVolAgente', lote.dc.volAgente || 0);
            _set('dcConc', lote.dc.conc || 0);
            _set('dcTiempo', lote.dc.tiempo || 0);
            if (typeof grCalcDC === 'function') grCalcDC();
        }

        // UF - Unidad Física
        if (lote.uf) {
            const _setUF = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
            _setUF('ufEstructura',       lote.uf.estructura       || 'Frasco');
            _setUF('ufCapacidadTotal',   lote.uf.capacidad_total  || 660);
            _setUF('ufCargaUtil',        lote.uf.carga_util       || 500);
            _setUF('ufCantidadUnidades', lote.uf.cantidad_unidades || 0);
            _setUF('ufPesoUnidad',       lote.uf.peso_unidad      || 0);
            updateUnidadFisica();
        } else if (lote.fr || lote.dm) {
            // Migración legacy: rellenar UF desde fr/dm si existen
            const _setUF = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
            _setUF('ufCapacidadTotal',   lote.fr?.capacidad  || 660);
            _setUF('ufCargaUtil',        lote.fr?.cargaUtil  || 500);
            _setUF('ufCantidadUnidades', lote.fr?.cantFrascos || 0);
            _setUF('ufPesoUnidad',       lote.fr?.pesoFrasco || 0);
            updateUnidadFisica();
        }

        // DG - Distribución de Grano
        const dgTbody = document.getElementById('dgTable').querySelector('tbody');
        dgTbody.innerHTML = '';
        const dgData = lote.dg || [];
        
        dgData.forEach(dg => {
            addDgRow(true);  // silent: restaura datos guardados, sin reasignar ID
            const row = dgTbody.lastElementChild;
            row.querySelector('.dg-tanda').value = dg.tanda || '';
            row.querySelector('.dg-frascos').value = dg.frascos || 0;

            // [Fase 5] Set inóculo: determina tipo (CI/GE) → dispara grDgOnChangeTipo
            // para repoblar el selector correcto → luego selecciona el valor guardado.
            const tipoSel = row.querySelector('.dg-tipo');
            const sel     = row.querySelector('.dg-genetica');
            if (tipoSel && sel) {
                let target = '';
                let tipoVal = '';
                if (dg.inoculoSource === 'CI' && dg.cultivoCiId) {
                    tipoVal = 'ci';
                    target  = 'ci:' + dg.cultivoCiId;
                } else if (dg.fen_id) {
                    tipoVal = 'ge';
                    target  = 'ge:' + dg.fen_id;
                } else if (dg.inoculoSource === 'GE') {
                    tipoVal = 'ge';
                }

                if (tipoVal) {
                    tipoSel.value = tipoVal;
                    // Repobla dg-genetica y habilita/deshabilita placas
                    if (typeof grDgOnChangeTipo === 'function') grDgOnChangeTipo(tipoSel);
                }

                if (target) {
                    sel.value = target;
                    if (sel.value !== target) {
                        // Cultivo agotado/renombrado: inyectar vintage option
                        _grInyectarVintageOption(sel, target, dg);
                        sel.value = target;
                    }
                }
                // Actualizar label de genética CI al cargar
                if (typeof grDgOnChangeGenetica === 'function') grDgOnChangeGenetica(sel);
            }

            // Restaurar placas usadas (campo universal único).
            // grDgOnChangeTipo ya seteó enabled/disabled; aquí solo restauramos el valor.
            const placasInput = row.querySelector('.dg-placas-usadas');
            if (placasInput && dg.inoculoSource === 'CI') {
                const v = (Number.isInteger(dg.placasUsadas) && dg.placasUsadas >= 0)
                          ? dg.placasUsadas
                          : 1;
                placasInput.value = String(v);
            }

            // Set contaminados
            if (dg.contaminados !== undefined) {
                row.querySelector('.dg-contaminados').value = dg.contaminados;
            }
            
            // Set colonización
            if (dg.colonizacion) {
                row.querySelector('.dg-colonizacion').value = dg.colonizacion;
            }
            // Set datos del dataset
            const _fi = dg.fechaInoculo || dg.fechaInoculacion || '';
            if (_fi) {
                row.dataset.fechaInoculacion = _fi;
                const fiInput = row.querySelector('.dg-fecha-inoculo');
                if (fiInput) fiInput.value = _fi;
            }
        });
        
        grActualizarTotalesGenetica();

        // PO - Verificar que los elementos existen
        const po = [];
        for (let i = 1; i <= 6; i++) {
            const checkbox = document.getElementById('po' + i);
            po.push({
                paso: i,
                completado: checkbox ? checkbox.checked : false
            });
        }

        // Cargar Notas
        GR.protoNotas = lote.protoNotas || [];
        GR.seguimientoNotas = lote.seguimientoNotas || [];
        
        if (typeof grRenderNotas === 'function') grRenderNotas();
        if (typeof window.grRenderSeguimientoNotas === 'function') window.grRenderSeguimientoNotas();
    }

    // Función global para agregar fila AD
    GR.addAdRow = window.addAdRow = function() {
        const tbody = document.getElementById('dgTable').querySelector('tbody');
        const row = document.createElement('tr');
        row.className = 'ad-row';
        row.innerHTML = `
            <td><input type="text" class="ad-tanda" placeholder="Ej: 194DA"></td>
            <td><input type="number" class="ad-frascos" value="0" min="0"></td>
            <td><input type="text" class="ad-nombre" placeholder="Ej: CaSO4"></td>
            <td><input type="number" class="ad-cant" value="0" min="0" step="0.1"></td>
            <td><input type="number" class="ad-conc" value="0" min="0" step="0.1"></td>
            <td>
                <select class="ad-estado">
                    <option value="">Seleccionar...</option>
                    <option value="ejecutado">Ejecutado</option>
                    <option value="programado">Programado</option>
                    <option value="pendiente">Pendiente</option>
                </select>
            </td>
            <td><button type="button" class="btn-remove" onclick="removeRow(this)">✕</button></td>
        `;
        tbody.appendChild(row);
    };

    // Función global para eliminar filas
    GR.removeRow = window.removeRow = function(btn) {
        const row = btn.closest('tr');
        row.remove();
        actualizarTotalesCT();
    };

    // ==========================================
    // BIBLIOTECA DE INGREDIENTES - CONFIG AVANZADA
    // ==========================================

    function cargarBibliotecaDesdeStorage() {
        // getBiblioteca() es tolerante a:
        //  - localStorage vacío       → usa default y lo persiste
        //  - JSON corrupto            → usa default y lo persiste
        //  - objeto con claves faltantes → mergea con default
        // Siempre deja GR.biblioteca con shape válido.
        const bib = getBiblioteca();
        GR.biblioteca = bib;
    }

    function guardarBibliotecaEnStorage() {
        // Blindaje: getBiblioteca() garantiza shape antes de mutar.
        const bib = getBiblioteca();

        // Recolectar valores editados
        document.querySelectorAll('#configAgentesTable tr').forEach((tr, i) => {
            if (bib.agentes[i]) {
                const nombreInput = tr.querySelector('.edit-nombre');
                const concInput = tr.querySelector('.edit-conc');
                if (nombreInput) bib.agentes[i].nombre = nombreInput.value;
                if (concInput) bib.agentes[i].concDefault = parseFloat(concInput.value) || 0;
            }
        });

        document.querySelectorAll('#configAditivosTable tr').forEach((tr, i) => {
            if (bib.aditivos[i]) {
                const nombreInput = tr.querySelector('.edit-nombre');
                const tipoInput = tr.querySelector('.edit-tipo');
                if (nombreInput) bib.aditivos[i].nombre = nombreInput.value;
                if (tipoInput) bib.aditivos[i].tipo = tipoInput.value;
            }
        });

        document.querySelectorAll('#configGranosTable tr').forEach((tr, i) => {
            if (bib.granos[i]) {
                const nombreInput = tr.querySelector('.edit-nombre');
                const granuloInput = tr.querySelector('.edit-granulo');
                if (nombreInput) bib.granos[i].nombre = nombreInput.value;
                if (granuloInput) bib.granos[i].granulometria = granuloInput.value;
            }
        });

        localStorage.setItem(BIBLIOTECA_KEY, JSON.stringify(bib));
        renderizarBibliotecaEnConfig();
    }

    // Cambiar panel visible en CONFIG (Agentes / Aditivos / Granos)
    GR.mostrarPanelConfig = window.mostrarPanelConfig = function(tab) {
        document.querySelectorAll('.config-tab').forEach(function(t) { t.classList.remove('active'); });
        var activeTab = document.querySelector('.config-tab[data-tab="' + tab + '"]');
        if (activeTab) activeTab.classList.add('active');

        document.querySelectorAll('.config-panel').forEach(function(p) { p.classList.remove('active'); });
        var activePanel = document.getElementById('panel-' + tab);
        if (activePanel) activePanel.classList.add('active');
    };

    // Densidad auto-calc para CONFIG de granos
    GR.calcDensidadGrano = window.calcDensidadGrano = function() {
        var vol = parseFloat((document.getElementById('configGranoVolumen') || {}).value) || 0;
        var peso = parseFloat((document.getElementById('configGranoPeso') || {}).value) || 0;
        var out = document.getElementById('configGranoDensidad');
        if (out) out.value = vol > 0 ? (peso / vol).toFixed(3) : 0;
    };

    // Guardar agente desde CONFIG
    GR.guardarAgenteConfig = window.guardarAgenteConfig = function() {
        const nombre = document.getElementById('configAgenteNombre').value;
        const conc = parseFloat(document.getElementById('configAgenteConc').value) || 0;
        const vol = parseFloat(document.getElementById('configAgenteVol').value) || 0;
        const notas = document.getElementById('configAgenteNotas').value;

        if (!nombre) { alert('Ingrese nombre del agente'); return; }

        const bib = getBiblioteca();
        bib.agentes.push({
            id: 'AG-' + String(bib.agentes.length + 1).padStart(2, '0'),
            nombre: nombre.toUpperCase(), concDefault: conc, volumenTipico: vol, notas: notas
        });

        document.getElementById('configAgenteNombre').value = '';
        document.getElementById('configAgenteConc').value = 0;
        document.getElementById('configAgenteVol').value = 0;
        document.getElementById('configAgenteNotas').value = '';

        guardarBibliotecaEnStorage();
    };

    // Guardar aditivo desde CONFIG
    GR.guardarAditivoConfig = window.guardarAditivoConfig = function() {
        const nombre = document.getElementById('configAditivoNombre').value;
        const tipo = document.getElementById('configAditivoTipo').value;
        const notas = document.getElementById('configAditivoNotas').value;

        if (!nombre) { alert('Ingrese nombre del aditivo'); return; }

        const bib = getBiblioteca();
        bib.aditivos.push({
            id: 'AD-' + String(bib.aditivos.length + 1).padStart(2, '0'),
            nombre: nombre, tipo: tipo, notas: notas
        });

        document.getElementById('configAditivoNombre').value = '';
        document.getElementById('configAditivoTipo').value = 'Estructurante';
        document.getElementById('configAditivoNotas').value = '';

        guardarBibliotecaEnStorage();
    };

    // Guardar grano desde CONFIG
    GR.guardarGranoConfig = window.guardarGranoConfig = function() {
        const nombre = document.getElementById('configGranoNombre').value;
        const vol = parseFloat(document.getElementById('configGranoVolumen').value) || 0;
        const peso = parseFloat(document.getElementById('configGranoPeso').value) || 0;
        const granulometria = document.getElementById('configGranoGranulo').value;
        const notas = document.getElementById('configGranoNotas').value;

        if (!nombre) { alert('Ingrese nombre del grano'); return; }

        const densidad = vol > 0 ? peso / vol : 0;

        const bib = getBiblioteca();
        bib.granos.push({
            id: 'GR-' + String(bib.granos.length + 1).padStart(2, '0'),
            nombre: nombre, densidadTipica: parseFloat(densidad.toFixed(3)), granulometria: granulometria, notas: notas
        });

        document.getElementById('configGranoNombre').value = '';
        document.getElementById('configGranoVolumen').value = 0;
        document.getElementById('configGranoPeso').value = 0;
        document.getElementById('configGranoDensidad').value = 0;
        document.getElementById('configGranoGranulo').value = '';
        document.getElementById('configGranoNotas').value = '';

        guardarBibliotecaEnStorage();
    };

    // Calcular densidad grano automáticamente
    const volInput = document.getElementById('configGranoVolumen');
    const pesoInput = document.getElementById('configGranoPeso');
    if (volInput) {
        volInput.addEventListener('input', function() {
            const vol = parseFloat(this.value) || 0;
            const peso = parseFloat(pesoInput?.value) || 0;
            const densInput = document.getElementById('configGranoDensidad');
            if (densInput) densInput.value = vol > 0 ? (peso / vol).toFixed(3) : 0;
        });
    }
    if (pesoInput) {
        pesoInput.addEventListener('input', function() {
            const vol = parseFloat(volInput?.value) || 0;
            const peso = parseFloat(this.value) || 0;
            const densInput = document.getElementById('configGranoDensidad');
            if (densInput) densInput.value = vol > 0 ? (peso / vol).toFixed(3) : 0;
        });
    }

    GR.eliminarIngredienteConfig = window.eliminarIngredienteConfig = function(tipo, index) {
        if (!confirm('¿Eliminar este ingrediente?')) return;
        const bib = getBiblioteca();
        if (!Array.isArray(bib[tipo])) { console.warn('[GR] tipo no soportado:', tipo); return; }
        bib[tipo].splice(index, 1);
        guardarBibliotecaEnStorage();
    };

    // Renderizar biblioteca en CONFIG
    let editMode = false;

    GR.toggleEdicionBiblioteca = window.toggleEdicionBiblioteca = function() {
        editMode = !editMode;
        const btn = document.getElementById('btnEditBiblioteca');
        const configContent = document.getElementById('config');
        
        if (editMode) {
            btn.textContent = 'Save';
            btn.classList.add('modo-edicion');
            configContent.classList.add('modo-edicion');
        } else {
            btn.textContent = 'Edit';
            btn.classList.remove('modo-edicion');
            configContent.classList.remove('modo-edicion');
            guardarBibliotecaEnStorage();
        }
    };

    function renderizarBibliotecaEnConfig() {
        // Blindaje: asegurar que la biblioteca esté hidratada y con shape válido
        // antes de leer .agentes / .aditivos / .granos.
        const bib = getBiblioteca();

        const agentesTable = document.getElementById('configAgentesTable');
        if (agentesTable) {
            agentesTable.innerHTML = bib.agentes.map((ag, i) =>
                `<tr><td>${ag.id}</td><td><input type="text" class="edit-nombre" data-tipo="agentes" data-idx="${i}" value="${ag.nombre}"></td><td><input type="number" class="edit-conc" data-tipo="agentes" data-idx="${i}" value="${ag.concDefault}"></td><td>${ag.volumenTipico || '-'}</td><td>${ag.notas || '-'}</td><td class="col-editar"><button type="button" class="btn-delete" onclick="eliminarIngredienteConfig('agentes', ${i})">✕</button></td></tr>`
            ).join('');
        }

        const aditivosTable = document.getElementById('configAditivosTable');
        if (aditivosTable) {
            aditivosTable.innerHTML = bib.aditivos.map((ad, i) =>
                `<tr><td>${ad.id}</td><td><input type="text" class="edit-nombre" data-tipo="aditivos" data-idx="${i}" value="${ad.nombre}"></td><td><select class="edit-tipo" data-tipo="aditivos" data-idx="${i}"><option value="Estructurante" ${ad.tipo==='Estructurante'?'selected':''}>Estructurante</option><option value="Corrector pH" ${ad.tipo==='Corrector pH'?'selected':''}>Corrector pH</option><option value="Nutriente" ${ad.tipo==='Nutriente'?'selected':''}>Nutriente</option></select></td><td>${ad.notas || '-'}</td><td class="col-editar"><button type="button" class="btn-delete" onclick="eliminarIngredienteConfig('aditivos', ${i})">✕</button></td></tr>`
            ).join('');
        }

        const granosTable = document.getElementById('configGranosTable');
        if (granosTable) {
            granosTable.innerHTML = bib.granos.map((gr, i) =>
                `<tr><td>${gr.id}</td><td><input type="text" class="edit-nombre" data-tipo="granos" data-idx="${i}" value="${gr.nombre}"></td><td>${(Number(gr.densidadTipica)||0).toFixed(3).replace('.', ',')} g/ml</td><td><input type="text" class="edit-granulo" data-tipo="granos" data-idx="${i}" value="${gr.granulometria || ''}"></td><td>${gr.notas || '-'}</td><td class="col-editar"><button type="button" class="btn-delete" onclick="eliminarIngredienteConfig('granos', ${i})">✕</button></td></tr>`
            ).join('');
        }

        // Actualizar selector de granos en CT (select con características)
        document.querySelectorAll('.ct-comp').forEach(select => {
            select.innerHTML = '<option value="">-- Seleccionar grano --</option>' +
                bib.granos.map(gr =>
                    `<option value="${gr.nombre}" data-densidad="${gr.densidadTipica}">${gr.nombre} - ${(Number(gr.densidadTipica)||0).toFixed(3).replace('.', ',')} g/ml</option>`
                ).join('');
        });

        // Actualizar selector de aditivos en DG (para filas nuevas y existentes)
        const opcionesAditivos = bib.aditivos.map(a =>
            `<option value="${a.nombre}">${a.nombre}</option>`
        ).join('');

        // Guardar para filas nuevas
        GR.opcionesAditivosDG = window.opcionesAditivosDG = opcionesAditivos;

        // Actualizar todos los selectores .dg-biblioteca existentes en la tabla
        document.querySelectorAll('#dgTable .dg-biblioteca').forEach(select => {
            select.innerHTML = '<option value="">-- Seleccionar --</option>' + opcionesAditivos;
        });

        // Actualizar selectors de HM también

    }

    // Exponer función a window para uso externo
    window.renderizarBibliotecaEnConfig = renderizarBibliotecaEnConfig;

    // Tabs de CONFIG - exclude Edit button from tabs
    document.querySelectorAll('.config-tab[data-tab]').forEach(tab => {
        tab.addEventListener('click', function() {
            document.querySelectorAll('.config-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.config-panel').forEach(p => p.classList.remove('active'));
            this.classList.add('active');
            document.getElementById('panel-' + this.dataset.tab).classList.add('active');
        });
    });

    // ==========================================
    // DG - DISTRIBUCIÓN DE GRANO
    // ==========================================

    GR.cambiarEstructura = window.cambiarEstructura = function() {
        const tipo = document.getElementById('dgTipoEstructura');
        const capacidad = document.getElementById('dgCapacidad');
        if (tipo && capacidad) {
            capacidad.value = tipo.value === 'frasco' ? 660 : 1000;
            calcularDG();
        }
    };

    GR.calcularDG = window.calcularDG = function() {
        const capacidad = document.getElementById('dgCapacidad');
        const llenado = document.getElementById('dgLlenado');
        const dgHeadspace = document.getElementById('dgHeadspace');
        const dgOxigeno = document.getElementById('dgOxigeno');
        
        if (!capacidad || !llenado || !dgHeadspace || !dgOxigeno) return;
        
        const capacidadVal = parseFloat(capacidad.value) || 0;
        const llenadoVal = parseFloat(llenado.value) || 0;
        const headspace = capacidadVal - llenadoVal;
        // oxígeno % frasco = headspace / capacidadTotal * 100
        const oxigeno = capacidadVal > 0 ? (headspace / capacidadVal) * 100 : 0;
        
        dgHeadspace.textContent = headspace.toFixed(0);
        dgOxigeno.textContent = oxigeno.toFixed(1);
    };

    // ==========================================
    // GENÉTICA - Cargar desde GE via window.ge.getSelectableGenetics()
    // ==========================================
    // Las keys bl2_species / bl2_strains / bl2_phenos son del esquema viejo.
    // El módulo GE actual persiste en 'biolab.ge.v4' y expone su API pública.
    // Usamos window.ge.getSelectableGenetics() como única fuente de verdad.

    // Helper: obtiene la lista de genéticas seleccionables desde GE.
    // Devuelve [] si GE no está montado (guard obligatorio según contrato).
    function grGetGeSelectable() {
        if (window.ge && typeof window.ge.getSelectableGenetics === 'function') {
            return window.ge.getSelectableGenetics();
        }
        // Fallback: leer directo de localStorage si GE no está montado
        try {
            const raw = localStorage.getItem('biolab.ge.v4');
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
            const getNode = id => nodes.find(n => n.id === id) || null;
            return nodes
                .filter(n => n.type === 'phenotype')
                .map(n => {
                    const parts = [];
                    let cur = n;
                    const chain = [];
                    while (cur) { chain.unshift(cur); cur = cur.parentId ? getNode(cur.parentId) : null; }
                    chain.forEach(c => parts.push(c.name));
                    return { id: n.id, label: parts.join(' / ') };
                })
                .sort((a, b) => a.label.localeCompare(b.label, 'es'));
        } catch (e) { return []; }
    }

    // Helper: resuelve el label de una genética por su id (para logs/resúmenes)
    function grGetNombreGeneticaPorId(fenId) {
        if (!fenId) return '?';
        const found = grGetGeSelectable().find(g => g.id === fenId);
        return found ? found.label : fenId;
    }
    const esc = s => s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '';

    // [Fase 4] Helper: parsea el value del select dg-genetica (`ci:<id>` / `ge:<id>` / legacy).
    function _grResolverInoculo(value) {
        if (typeof value !== 'string' || !value) return null;
        if (value.startsWith('ci:')) return { source: 'CI', id: value.slice(3) };
        if (value.startsWith('ge:')) return { source: 'GE', id: value.slice(3) };
        return { source: 'GE', id: value }; // legacy: bare id se trata como GE
    }
    window._grResolverInoculo = _grResolverInoculo;

    // [Fase 4] Helper: label legible del inóculo (CI o GE).
    function _grNombreInoculo(value) {
        const r = _grResolverInoculo(value);
        if (!r) return '?';
        if (r.source === 'CI') {
            const c = _grGetCultivoCI(r.id)
                    || (window.CI && typeof window.CI.getCultivoById === 'function' ? window.CI.getCultivoById(r.id) : null);
            if (c) {
                const lbl = _grAbreviarEspecie((c.geneticaSnapshot && c.geneticaSnapshot.label) || c.geneticaId || r.id);
                return c.codigo + ' · ' + lbl;
            }
            return r.id;
        }
        return _grAbreviarEspecie(grGetNombreGeneticaPorId(r.id));
    }
    window._grNombreInoculo = _grNombreInoculo;

    GR.cargarGeneticas = window.grCargarGeneticas = function() {
        // Legacy: usado por _grInyectarVintageOption y cualquier selector viejo.
        // Los selectores nuevos (dg-tipo + dg-genetica) usan grDgOnChangeTipo en su lugar.
        let opts = '<option value="">-- Seleccionar inóculo --</option>';

        // Optgroup 1: Cultivos CI — leídos desde localStorage, sin depender de window.CI
        const cultivosCI = _grListCultivosCI();
        const formsMap   = _grFormsMap();
        if (cultivosCI.length) {
            opts += '<optgroup label="🧫 Cultivos CI disponibles">';
            opts += cultivosCI.map(function(c) {
                return '<option value="ci:' + esc(c.id) + '">' + esc(_grEtiquetaCI(c, formsMap)) + '</option>';
            }).join('');
            opts += '</optgroup>';
        }

        // Optgroup 2: Genética directa GE — especie abreviada
        const genetics = grGetGeSelectable();
        if (genetics.length) {
            opts += '<optgroup label="🧬 Genética directa (GE)">';
            opts += genetics.map(function(g) {
                return '<option value="ge:' + esc(g.id) + '">' + esc(_grAbreviarEspecie(g.label)) + '</option>';
            }).join('');
            opts += '</optgroup>';
        } else if (!cultivosCI.length) {
            opts += '<option value="" disabled>— Sin cultivos CI ni genéticas en GE —</option>';
        }
        return opts;
    };

    // [Fase 4] Inyecta una "vintage option" preservando trazabilidad cuando un id ya
    // no aparece en el dropdown vivo (cultivo agotado/descartado, GE renombrada, etc.).
    function _grInyectarVintageOption(select, value, dgRow) {
        if (!select || !value) return;
        const r = _grResolverInoculo(value);
        let label = '?';
        if (r) {
            if (r.source === 'CI') {
                const c = _grGetCultivoCI(r.id)
                        || (window.CI && typeof window.CI.getCultivoById === 'function' ? window.CI.getCultivoById(r.id) : null);
                if (c) {
                    const formsMap = _grFormsMap();
                    label = _grEtiquetaCI(c, formsMap);
                } else if (dgRow && dgRow.genetica) {
                    label = dgRow.genetica;
                } else {
                    label = r.id;
                }
            } else {
                label = _grAbreviarEspecie(grGetNombreGeneticaPorId(r.id));
                if (label === r.id && dgRow && dgRow.genetica) label = _grAbreviarEspecie(dgRow.genetica);
            }
        }
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = '⚠ ' + label + ' (no disponible)';
        opt.dataset.vintage = '1';
        select.appendChild(opt);
    }

    GR.actualizarSelectoresGenetica = window.actualizarSelectoresGenetica = function() {
        // [Fase 5] Cada fila tiene su propio tipo (CI/GE); refrescamos disparando
        // grDgOnChangeTipo para que cada selector se repueble con las opciones correctas.
        document.querySelectorAll('.dg-row').forEach(row => {
            const tipoSel = row.querySelector('.dg-tipo');
            const genSel  = row.querySelector('.dg-genetica');
            if (!tipoSel || !genSel) return;
            const prev = genSel.value;
            if (typeof grDgOnChangeTipo === 'function') grDgOnChangeTipo(tipoSel);
            // Restaurar selección previa
            if (prev) {
                genSel.value = prev;
                if (genSel.value !== prev) {
                    _grInyectarVintageOption(genSel, prev, null);
                    genSel.value = prev;
                }
            }
        });
    };

    // [Fase 4] Aplicar consumos CI según el dg nuevo del lote.
    // Estrategia: pre-validar stock, devolver consumos previos del lote, reaplicar.
    function _grCountCiConsumption(dgArr) {
        // Suma placasUsadas reales por cultivoCiId.
        // Solo filas con inoculoSource='CI' consumen inventario; GE no.
        const counts = {};
        if (!Array.isArray(dgArr)) return counts;
        dgArr.forEach(d => {
            if (d && d.inoculoSource === 'CI' && d.cultivoCiId) {
                const qty = (Number.isInteger(d.placasUsadas) && d.placasUsadas > 0)
                            ? d.placasUsadas
                            : 0;
                if (qty > 0) counts[d.cultivoCiId] = (counts[d.cultivoCiId] || 0) + qty;
            }
        });
        return counts;
    }

    function _grAplicarConsumosCi(loteId, oldDg, newDg) {
        // Delegar completamente a CiGrLinks — sin dependencia de window.CI en runtime.
        // CiGrLinks lee bl2_cultivos y bl2_ci_gr_links directamente desde localStorage.
        if (!window.CiGrLinks || typeof window.CiGrLinks.aplicarConsumos !== 'function') {
            // Fallback: lógica legacy si CiGrLinks no está cargado
            console.warn('[GR] CiGrLinks no disponible — consumo CI omitido.');
            return { ok: true, sinCambios: true };
        }
        return window.CiGrLinks.aplicarConsumos(loteId, oldDg || [], newDg || []);
    }
    window._grAplicarConsumosCi = _grAplicarConsumosCi;

    // ── Trazabilidad GR → CI ──

    // Origen CI de una tanda específica de un lote
    GR.getOrigenCultivo = window.grGetOrigenCultivo = function(grLoteId, grTanda) {
        if (!window.CiGrLinks || !grLoteId) return null;
        const links = grTanda
            ? window.CiGrLinks.getActivosByLoteYTanda(grLoteId, grTanda)
            : window.CiGrLinks.getActivosByLote(grLoteId);
        if (!links.length) return null;
        const l = links[0];
        return { cultivoCiId: l.cultivoCiId, ciLinkId: l.id, cantidad: l.cantidad, fechaConsumo: l.fechaConsumo, snapshot: l.snapshotCultivo };
    };

    // Todos los links activos de un lote GR
    GR.getLinksDeLote = window.grGetLinksDeLote = function(grLoteId) {
        if (!window.CiGrLinks || !grLoteId) return [];
        return window.CiGrLinks.getActivosByLote(grLoteId);
    };

    // Alert de trazabilidad GR → CI
    GR.verTrazabilidadLote = window.grVerTrazabilidadLote = function(grLoteId) {
        if (!grLoteId) { alert('loteId requerido'); return; }
        const links = window.CiGrLinks ? window.CiGrLinks.getActivosByLote(grLoteId) : [];
        const lineas = [`Lote GR: ${grLoteId}`, `Links CI activos: ${links.length}`, ''];
        if (!links.length) {
            lineas.push('  (sin origen CI registrado)');
        } else {
            links.forEach(l => {
                const snap = l.snapshotCultivo || {};
                const tanda = l.grTanda ? ` · Tanda: ${l.grTanda}` : '';
                lineas.push(`  · ${snap.codigo || l.cultivoCiId}${tanda}`);
                lineas.push(`    Genética: ${snap.geneticaLabel || '—'}`);
                lineas.push(`    Cantidad: ${l.cantidad} ud · ${l.fechaConsumo ? new Date(l.fechaConsumo).toLocaleString('es-AR') : '—'}`);
                lineas.push(`    Link ID: ${l.id}`);
            });
        }
        alert(lineas.join('\n'));
    };

    // Diagnóstico general CI ↔ GR
    GR.diagnosticoCiLinks = window.grDiagnosticoCiLinks = function() {
        if (!window.CiGrLinks) { alert('CiGrLinks no cargado'); return; }
        const links = window.CiGrLinks.load();
        const activos  = links.filter(l => l.estado === 'ACTIVO').length;
        const anulados = links.filter(l => l.estado === 'ANULADO').length;
        const lotes    = new Set(links.map(l => l.grLoteId)).size;
        const cultivos = new Set(links.map(l => l.cultivoCiId)).size;
        alert([
            'CiGrLinks — Diagnóstico',
            `Total: ${links.length} (${activos} activos, ${anulados} anulados)`,
            `Lotes GR: ${lotes} · Cultivos CI: ${cultivos}`,
        ].join('\n'));
    };

    function _grActualizarDgRowBadges() {
        const grLoteIdActual = (document.getElementById('loteId')?.value || '').trim();
        const usadosMap = grGetUsadosMap();
        const usadosLote = grLoteIdActual && usadosMap[grLoteIdActual] ? usadosMap[grLoteIdActual] : {};
        const hoy = Date.now();

        document.querySelectorAll('#dgTable .dg-row').forEach(function(row) {
            const fechaInoculo = row.querySelector('.dg-fecha-inoculo')?.value || row.dataset.fechaInoculacion || '';
            const frascos = parseFloat(row.querySelector('.dg-frascos')?.value) || 0;
            const contaminados = parseFloat(row.querySelector('.dg-contaminados')?.value) || 0;
            const colonizacion = row.querySelector('.dg-colonizacion')?.value || '';
            const tanda = row.querySelector('.dg-tanda')?.value || '';
            const usados = (tanda && usadosLote[tanda]) ? parseInt(usadosLote[tanda]) || 0 : 0;
            const usadosEx = (typeof grGetExUsadosGR === 'function') ? grGetExUsadosGR(grLoteIdActual, tanda) : 0;
            const disponibles = Math.max(0, frascos - contaminados - usados - usadosEx);

            // Estado badge
            let estado = '⚪';
            if (frascos > 0 && contaminados >= frascos) estado = '💀';
            else if (frascos > 0 && disponibles === 0) estado = '⬛';
            else if (colonizacion) estado = '🟢';
            else if (fechaInoculo) estado = '🟡';

            const estadoBadge = row.querySelector('.dg-estado-badge');
            if (estadoBadge) estadoBadge.textContent = estado;

            // Días desde inoculación (compute once, use in both blocks)
            let dias = null;
            if (fechaInoculo) {
                const ms = hoy - new Date(fechaInoculo).getTime();
                dias = Math.max(0, Math.floor(ms / 86400000));
            }

            const diasEl = row.querySelector('.dg-dias-inoculo');
            if (diasEl) {
                diasEl.textContent = dias !== null ? dias + 'd' : '';
            }

            // Alerta tardía: borde amarillo si > 30 días sin colonización registrada
            if (fechaInoculo && !colonizacion) {
                if (dias > GR_COLONIZACION_ALERTA_DIAS) {
                    row.classList.add('dg-row--late');
                } else {
                    row.classList.remove('dg-row--late');
                }
            } else {
                row.classList.remove('dg-row--late');
            }

            // FR chip
            const frChip = row.querySelector('.dg-fr-chip');
            if (frChip) {
                if (grLoteIdActual && tanda) {
                    const count = _grCountFrBolsasPorTanda(grLoteIdActual, tanda);
                    frChip.textContent = count > 0 ? '📦 ' + count : '';
                } else {
                    frChip.textContent = '';
                }
            }
        });
    }

    GR.actualizarTotalesGenetica = window.grActualizarTotalesGenetica = function() {

        let totalFrascos = 0;
        let totalContaminados = 0;
        let totalDisponibles = 0;

        const tandaData = [];

        // Lote GR actualmente en edición (si existe)
        const grLoteIdActual = (document.getElementById('loteId')?.value || '').trim();
        const usadosMap = grGetUsadosMap();
        const usadosLote = grLoteIdActual && usadosMap[grLoteIdActual] ? usadosMap[grLoteIdActual] : {};

        document.querySelectorAll('#dgTable .dg-row').forEach(row => {
            const tanda = row.querySelector('.dg-tanda').value;
            const frascos = parseFloat(row.querySelector('.dg-frascos').value) || 0;
            const fenId = row.querySelector('.dg-genetica').value;
            const contaminados = parseFloat(row.querySelector('.dg-contaminados')?.value) || 0;
            const colonizacion = row.querySelector('.dg-colonizacion')?.value;

            // Usados desde SU para esta tanda del lote GR actual
            const usados = (tanda && usadosLote[tanda]) ? parseInt(usadosLote[tanda]) || 0 : 0;
            const usadosEx = grGetExUsadosGR(grLoteIdActual, tanda);
            let disponibles = frascos - contaminados - usados - usadosEx;
            if (disponibles < 0) disponibles = 0;

            // Pintar celda Disponibles
            const dispSpan = row.querySelector('.dg-disponibles');
            if (dispSpan) {
                if (frascos <= 0) {
                    dispSpan.textContent = '—';
                    dispSpan.style.color = '';
                    dispSpan.removeAttribute('data-low');
                } else {
                    dispSpan.textContent = String(disponibles);
                    if (disponibles === 0) {
                        dispSpan.style.color = '#FF6B6B';
                        dispSpan.setAttribute('data-low', '1');
                    } else if (disponibles <= Math.max(1, Math.floor(frascos * 0.2))) {
                        dispSpan.style.color = '#FFC000';
                        dispSpan.removeAttribute('data-low');
                    } else {
                        dispSpan.style.color = '#70AD47';
                        dispSpan.removeAttribute('data-low');
                    }
                }
                dispSpan.title = _grUdCap() + 's ' + frascos + ' - Contaminados ' + contaminados + ' - Usados en SU ' + usados + ' = ' + disponibles;
            }

            totalFrascos += frascos;
            totalContaminados += contaminados;
            totalDisponibles += disponibles;
            
            const ratioSpan = row.querySelector('.dg-ratio');
            if (ratioSpan) {
                if (frascos === 0) {
                    ratioSpan.textContent = '—';
                    ratioSpan.style.color = '';
                } else {
                    const frascosSanos = frascos - contaminados;
                    const ratio = (frascosSanos / frascos) * 100;
                    if (ratio > 90) {
                        ratioSpan.textContent = '🟢 ' + ratio.toFixed(0) + '%';
                        ratioSpan.style.color = '#70AD47';
                    } else if (ratio >= 70) {
                        ratioSpan.textContent = '🟡 ' + ratio.toFixed(0) + '%';
                        ratioSpan.style.color = '#FFC000';
                    } else {
                        ratioSpan.textContent = '🔴 ' + ratio.toFixed(0) + '%';
                        ratioSpan.style.color = '#FF0000';
                    }
                }
            }
            
            if (tanda && frascos > 0 && fenId) {
                const nombreGenetica = _grNombreInoculo(fenId); // parsea prefijos ci:/ge:
                
                tandaData.push({
                    tanda: tanda,
                    genetica: nombreGenetica,
                    frascos: frascos,
                    fenId: fenId,
                    contaminados: contaminados,
                    frascosSanos: frascos - contaminados,
                    colonizacion: colonizacion
                });
            }
        });
        
        const totalFrascosEl = document.getElementById('dgTotalFrascos');
        if (totalFrascosEl) totalFrascosEl.textContent = totalFrascos;

        const totalContaminadosEl = document.getElementById('dgTotalContaminados');
        if (totalContaminadosEl) totalContaminadosEl.textContent = totalContaminados;
        const contamPctEl = document.getElementById('dgContamPct');
        if (contamPctEl) {
            if (totalFrascos > 0) {
                const pct = Math.round(totalContaminados / totalFrascos * 100);
                contamPctEl.textContent = pct + '% contam';
                contamPctEl.style.color = pct > 20 ? '#FF6B6B' : pct > 10 ? '#FFC000' : '#70AD47';
            } else {
                contamPctEl.textContent = '';
            }
        }

        const totalDisponiblesEl = document.getElementById('dgTotalDisponibles');
        if (totalDisponiblesEl) {
            totalDisponiblesEl.textContent = totalDisponibles;
            if (totalFrascos === 0) {
                totalDisponiblesEl.style.color = '';
            } else if (totalDisponibles === 0) {
                totalDisponiblesEl.style.color = '#FF6B6B';
            } else {
                totalDisponiblesEl.style.color = '#70AD47';
            }
        }

        // Calcular ratio total
        const ratioTotalEl = document.getElementById('dgRatioTotal');
        if (ratioTotalEl) {
            if (totalFrascos === 0) {
                ratioTotalEl.textContent = '—';
                ratioTotalEl.style.color = '';
            } else {
                const ratioTotal = ((totalFrascos - totalContaminados) / totalFrascos) * 100;
                if (ratioTotal > 90) {
                    ratioTotalEl.textContent = '🟢 ' + ratioTotal.toFixed(0) + '%';
                    ratioTotalEl.style.color = '#70AD47';
                } else if (ratioTotal >= 70) {
                    ratioTotalEl.textContent = '🟡 ' + ratioTotal.toFixed(0) + '%';
                    ratioTotalEl.style.color = '#FFC000';
                } else {
                    ratioTotalEl.textContent = '🔴 ' + ratioTotal.toFixed(0) + '%';
                    ratioTotalEl.style.color = '#FF0000';
                }
            }
        }
        
        const resumenDiv = document.getElementById('dgResumenGenetica');
        if (resumenDiv && tandaData.length > 0) {
            const items = tandaData
                .sort((a,b) => b.frascos - a.frascos)
                .map(t => {
                    const texto = `${t.tanda} - ${t.genetica}: ${t.frascos} ${_grUds()}`;
                    return `<span onclick="window.grCopiarAlSeguimiento('${esc(texto)}')" style="display:inline-block;margin:4px 8px;padding:6px 10px;background:var(--bg-tertiary);border-radius:4px;border-left:3px solid var(--highlight);cursor:pointer;" title="Click para agregar al seguimiento">${texto}</span>`;
                })
                .join('');
            resumenDiv.innerHTML = `<div style="color:var(--tx2);margin-bottom:6px">Resumen por tanda (click para agregar al seguimiento):</div>${items}`;
        } else if (resumenDiv) {
            resumenDiv.innerHTML = '';
        }
        _grActualizarDgRowBadges();
    };

    // ==========================================
    // EVENTOS DG - Inoculación, Contaminación, Colonización
    // ==========================================
    
    function grRegistrarSeguimiento(tipo, mensaje, emoji) {
        const loteActual = {
            id: document.getElementById('loteId')?.value || 'N/A',
            seguimiento: []
        };
        
        let estado = 'none';
        if (emoji === '🟡') estado = 'yellow';
        else if (emoji === '🔴') estado = 'red';
        else if (emoji === '🟢') estado = 'green';
        
        const existing = GR.seguimientoNotas || [];
        
        existing.push({
            ts: grTimestamp(),
            tipo: tipo,
            texto: mensaje,
            estado: estado
        });
        
        GR.seguimientoNotas = existing;
        window.grRenderSeguimientoNotas();
    }
    
    function grGetNombreGenetica(fenId) {
        return grGetNombreGeneticaPorId(fenId);
    }

    // [Fase 5] Handler para el selector de tipo de inóculo (CI / GE)
    // Repuebla dg-genetica según el tipo elegido y habilita/deshabilita placas-usadas.
    window.grDgOnChangeTipo = function(tipoEl) {
        const row = tipoEl.closest('.dg-row');
        if (!row) return;
        const tipo = tipoEl.value;           // 'ci' | 'ge' | ''
        const genSel    = row.querySelector('.dg-genetica');
        const placasInp = row.querySelector('.dg-placas-usadas');
        const labelEl   = row.querySelector('.dg-genetica-label');

        // Resetear selector de ítem
        if (genSel) {
            genSel.disabled = !tipo;
            genSel.innerHTML = '<option value="">— seleccionar —</option>';
            if (tipo === 'ci') {
                // Opciones CI — leídas desde localStorage, sin depender de window.CI
                const cultivosCI = _grListCultivosCI();
                const formsMap   = _grFormsMap();
                if (cultivosCI.length) {
                    cultivosCI.forEach(function(c) {
                        const opt = document.createElement('option');
                        opt.value = 'ci:' + c.id;
                        opt.textContent = _grEtiquetaCI(c, formsMap);
                        genSel.appendChild(opt);
                    });
                } else {
                    const opt = document.createElement('option');
                    opt.value = ''; opt.disabled = true;
                    opt.textContent = '— Sin cultivos CI disponibles —';
                    genSel.appendChild(opt);
                }
            } else if (tipo === 'ge') {
                // Opciones GE — especie abreviada
                const genetics = grGetGeSelectable();
                if (genetics.length) {
                    genetics.forEach(function(g) {
                        const opt = document.createElement('option');
                        opt.value = 'ge:' + g.id;
                        opt.textContent = _grAbreviarEspecie(g.label);
                        genSel.appendChild(opt);
                    });
                } else {
                    const opt = document.createElement('option');
                    opt.value = ''; opt.disabled = true;
                    opt.textContent = '— Sin genéticas en GE —';
                    genSel.appendChild(opt);
                }
            }
        }

        // Placas usadas: solo CI descuenta inventario
        if (placasInp) {
            if (tipo === 'ci') {
                placasInp.disabled = false;
                placasInp.style.opacity = '';
                if (!placasInp.value || placasInp.value === '0') placasInp.value = '1';
            } else {
                placasInp.disabled = true;
                placasInp.style.opacity = '0.4';
                placasInp.value = '0';
            }
        }

        // Limpiar label genética
        if (labelEl) { labelEl.textContent = ''; }
    };

    window.grDgOnChangeGenetica = function(selectEl) {
        const row = selectEl.closest('.dg-row');
        if (!row) return;

        const tanda = row.querySelector('.dg-tanda').value;
        const genetica = selectEl.value;
        const frascos = parseInt(row.querySelector('.dg-frascos').value) || 0;

        // Siempre registrar fecha de inoculación al seleccionar genética,
        // incluso si aún no hay frascos/tanda (fix: no bloquear colonización luego).
        if (genetica && !row.querySelector('.dg-fecha-inoculo')?.value) {
            row.dataset.fechaInoculacion = new Date().toISOString().split('T')[0];
        }

        // Mostrar label de genética bajo el select.
        // CI: siempre tiene geneticaSnapshot.label (enforced por CI module) — nunca ⚠️.
        // GE: puede no tener label si el nodo GE no se resuelve (raro, pero posible).
        const labelEl = row.querySelector('.dg-genetica-label');
        if (labelEl) {
            const r = (typeof _grResolverInoculo === 'function') ? _grResolverInoculo(genetica) : null;
            if (r && r.source === 'CI') {
                // Leer desde localStorage directo — no depende de window.CI cargado
                const c    = _grGetCultivoCI(r.id)
                           || (window.CI && typeof window.CI.getCultivoById === 'function' ? window.CI.getCultivoById(r.id) : null);
                let gen    = null;
                let code   = r.id;
                if (c) {
                    // geneticaSnapshot.label es guaranteed por _ciValidarInputCreacion
                    gen  = _grAbreviarEspecie((c.geneticaSnapshot && c.geneticaSnapshot.label) || c.geneticaId || '');
                    code = c.codigo || r.id;
                }
                // CI siempre tiene genética — nunca mostramos warning
                labelEl.textContent = gen ? '🧬 ' + gen : '🧫 ' + code;
                labelEl.style.color = 'var(--tx2)';
            } else if (r && r.source === 'GE') {
                // GE directa: mostrar nombre del nodo si está disponible
                const nombre = grGetNombreGeneticaPorId(r.id);
                if (nombre && nombre !== r.id) {
                    labelEl.textContent = '🧬 ' + nombre;
                    labelEl.style.color = 'var(--tx2)';
                } else {
                    labelEl.textContent = '';
                }
            } else {
                labelEl.textContent = '';
            }
        }

        if (!tanda || !genetica || frascos === 0) return;

        grRegistrarSeguimiento(
            'inoculacion',
            `${tanda} - ${_grNombreInoculo(genetica)}: ${frascos} ${_grUds()} inoculados`,
            '🟡'
        );

        grActualizarTotalesGenetica();
    };
    
    window.grDgOnChangeContaminados = function(inputEl) {
        const row = inputEl.closest('.dg-row');
        const frascos = parseInt(row.querySelector('.dg-frascos').value) || 0;
        let contaminados = parseInt(inputEl.value) || 0;
        
        if (contaminados > frascos) {
            contaminados = frascos;
            inputEl.value = contaminados;
        }
        
        const frascosSanos = frascos - contaminados;
        row.dataset.frascosSanos = frascosSanos;
        
        const tanda = row.querySelector('.dg-tanda').value;
        const genetica = row.querySelector('.dg-genetica')?.value;
        
        if (contaminados > 0 && tanda && genetica) {
            grRegistrarSeguimiento(
                'contaminacion',
                `${tanda} - ${_grNombreInoculo(genetica)}: ${contaminados} ${_grUds()} contaminado${contaminados !== 1 ? 's' : ''}`,
                '🔴'
            );
        }
        
        grActualizarTotalesGenetica();
    };
    
    window.grDgOnChangeColonizacion = function(inputEl) {
        const row = inputEl.closest('.dg-row');
        const fechaColonizacion = inputEl.value;

        if (!fechaColonizacion) return;

        const geneticaSeleccionada = row.querySelector('.dg-genetica')?.value;

        // Validar que haya genética seleccionada (no fecha de inoculación en dataset,
        // que puede faltar en lotes guardados antes de que existiera ese campo).
        if (!geneticaSeleccionada) {
            alert('Debe seleccionar una genética (inoculación) primero');
            inputEl.value = '';
            return;
        }

        const fechaInoculacion = row.dataset.fechaInoculacion;
        let dias = null;
        if (fechaInoculacion) {
            const d1 = new Date(fechaInoculacion);
            const d2 = new Date(fechaColonizacion);
            dias = Math.floor((d2 - d1) / 86400000);
        }

        if (dias !== null) row.dataset.diasColonizacion = dias;

        const tanda = row.querySelector('.dg-tanda').value;
        const genetica = geneticaSeleccionada;

        if (tanda && genetica) {
            const msgDias = dias !== null ? `: colonización en ${dias} días` : ': fecha de colonización registrada';
            grRegistrarSeguimiento(
                'colonizacion',
                `${tanda} - ${_grNombreInoculo(genetica)}${msgDias}`,
                '🟢'
            );
        }

        grActualizarTotalesGenetica();
    };
    
    GR.copiarAlSeguimiento = window.grCopiarAlSeguimiento = function(texto) {
        const textarea = document.getElementById('grSeguimientoNotaInput');
        if (textarea) {
            textarea.value = texto;
        }
    };

    GR.addDgRow = window.addDgRow = function(silent) {
        const tbody = document.getElementById('dgTable').querySelector('tbody');
        const totalRow = tbody.querySelector('.dg-total-row');
        const row = document.createElement('tr');
        row.className = 'dg-row';

        const opcionesGenetica = GR.cargarGeneticas();

        // Asignar ID de lote al crear la primera tanda (solo cuando el usuario
        // agrega una tanda manualmente — no durante init ni carga de datos)
        if (!silent) _grAsignarLoteIdSiVacio();

        const tandaId = _grGenerarTandaId();

        row.innerHTML = `
            <td><input type="date" class="dg-fecha-inoculo" onchange="grDgOnChangeFechaInoculo(this)"></td>
            <td>
              <input type="text" class="dg-tanda" placeholder="Auto" value="${tandaId}" oninput="this.dataset.manualEdit='true'; grActualizarTotalesGenetica()">
              <div class="dg-tanda-meta">
                <span class="dg-estado-badge"></span>
                <span class="dg-dias-inoculo"></span>
                <span class="dg-fr-chip"></span>
              </div>
            </td>
            <td><input type="number" class="dg-frascos" value="0" min="0" oninput="grActualizarTotalesGenetica()"></td>
            <td>
                <select class="dg-tipo" onchange="grDgOnChangeTipo(this)" style="display:block;width:100%;margin-bottom:4px;">
                    <option value="">— fuente de inóculo —</option>
                    <option value="ci">🧫 CI (Cultivo In-vitro)</option>
                    <option value="ge">🧬 GE (Genética directa)</option>
                </select>
                <select class="dg-genetica" onchange="grDgOnChangeGenetica(this)" disabled>
                    <option value="">— seleccionar —</option>
                </select>
                <small class="dg-genetica-label" style="display:block;margin-top:3px;color:var(--tx2);font-size:0.78rem;"></small>
            </td>
            <td><input type="number" class="dg-placas-usadas" value="1" min="0" disabled oninput="grDgOnChangePlacasUsadas(this)" title="Solo habilitado para fuente CI — se descuenta del inventario de cultivos."></td>
            <td><input type="number" class="dg-contaminados" value="0" min="0" oninput="grDgOnChangeContaminados(this)"></td>
            <td class="dg-disponibles-cell"><span class="dg-disponibles" title="${_grUdCap()}s - Contaminados - Usados en SU">—</span></td>
            <td>
              <input type="date" class="dg-colonizacion" onchange="grDgOnChangeColonizacion(this)">
            </td>
            <td><span class="dg-ratio">—</span></td>
            <td><button type="button" class="btn-remove" onclick="removeRowDG(this)">✕</button></td>
        `;
        tbody.insertBefore(row, totalRow);
    };

    // [Fase 4 patch²] Handler para cambio de placas usadas en una fila DG
    window.grDgOnChangePlacasUsadas = function(inputEl) {
        const row = inputEl.closest('.dg-row');
        if (!row) return;
        // Solo recálculo de totales; no dispara consumo (eso ocurre al guardar lote)
        if (typeof grActualizarTotalesGenetica === 'function') grActualizarTotalesGenetica();
    };

    GR.removeRowDG = window.removeRowDG = function(btn) {
        btn.closest('tr').remove();
    };

    GR.calcularConcentracionFila = window.calcularConcentracionFila = function(input) {
        const row = input.closest('tr');
        const frascos = parseFloat(row.querySelector('.dg-frascos').value) || 0;
        const cantidad = parseFloat(row.querySelector('.dg-cant').value) || 0;
        // pesoPorFrasco viene de UF (ufPesoUnidad), actualizado por updateUnidadFisica
        const pesoPorFrasco = GR._ufPesoUnidad || 0;
        const conc = pesoPorFrasco > 0 ? (cantidad / pesoPorFrasco) * 100 : 0;
        row.querySelector('.dg-conc').value = conc.toFixed(3);
    };

    // Legacy functions (deprecated but kept for compatibility)
    GR.agregarAgente = window.agregarAgente = function() { alert('Use la sección Config para agregar ingredientes'); };
    GR.agregarAditivo = window.agregarAditivo = function() { alert('Use la sección Config para agregar ingredientes'); };
    GR.agregarGrano = window.agregarGrano = function() { alert('Use la sección Config para agregar ingredientes'); };
    GR.eliminarIngrediente = window.eliminarIngrediente = function() { alert('Use la sección Config para eliminar ingredientes'); };
    function renderizarBiblioteca() { renderizarBibliotecaEnConfig(); }

    // ==========================================
    // CARGAR LOTE 1903 (EJEMPLO)
    // ==========================================

    function cargarLote1903() {
        const lote1903 = {
            id: '1903-MA-AV',
            nombre: 'MA + AV (50/50 vol.)',
            fecha: '2024-01-15',
            version: 'v2.0',
            componentes: [
                { nombre: 'Avena (AV)', volumen: 2000, masa: 1112, densidad: 0.556, notas: 'Grano fino, alta superficie específica' },
                { nombre: 'Maíz (MA)', volumen: 2000, masa: 1604, densidad: 0.802, notas: 'Grano grueso, mayor resistencia a hidratación' }
            ],
            dc: {
                volSol: 4,
                agente: 'ÁCIDO PERACÉTICO',
                concAgente: 5,
                volAgente: 60,
                conc: 0.075,
                tiempo: 60
            },
            hm: {
                estadoAgua: 'EBULICIÓN - 100°C',
                estadoGrano: 'TEMPERATURA AMBIENTE',
                metodo: 'INMERSIÓN DIRECTA',
                tiempoCoccion: 20,
                regimenCalor: 'FUEGO MÁXIMO CONSTANTE',
                agitacion: 'CADA 5 MINUTOS'
            },
            aditivos: [
                { tanda: '193GA', frascos: 4, nombre: 'CaSO4 (Yeso)', cantidad: 1.6, conc: 0.5, estado: 'ejecutado' },
                { tanda: '193GB', frascos: 4, nombre: 'CaSO4 (Yeso)', cantidad: 3.0, conc: 1.0, estado: 'programado' },
                { tanda: '193GC', frascos: 6, nombre: 'CaSO4 (Yeso)', cantidad: 6.3, conc: 2.0, estado: 'pendiente' }
            ],
            es: {
                tiempo: 150,
                medio: 'VAPOR SATURADO',
                objPrimario: 'ESTERILIDAD DEL SUSTRATO',
                objSecundario: 'HIDRATACIÓN INTERNA DEL MAÍZ',
                riesgos: [
                    { causa: 'CaSO4 insuficiente', nivel: 'medio' },
                    { causa: 'CaSO4 excesivo', nivel: 'medio' },
                    { causa: 'Mala distribución en esterilizador', nivel: 'alto' }
                ]
            },
            dg: [
                { tanda: '193GA', frascos: 4, nombre: 'CaSO4 (Yeso)', cantidad: 1.6, conc: 0.5, estado: 'ejecutado' },
                { tanda: '193GB', frascos: 4, nombre: 'CaSO4 (Yeso)', cantidad: 3.0, conc: 1.0, estado: 'programado' },
                { tanda: '193GC', frascos: 6, nombre: 'CaSO4 (Yeso)', cantidad: 6.3, conc: 2.0, estado: 'pendiente' }
            ],
            re: {
                evaluacion: {
                    hidratacion: 'correcto',
                    distribucion: 'problema',
                    eficiencia: 'optimo'
                }
            }
        };
        
        return lote1903;
    }

    // Función para cargar el lote de ejemplo y registrarlo
    GR.cargarLote1903Demo = window.cargarLote1903Demo = function() {
        const lote = cargarLote1903();
        
        // Verificar si ya existe
        const existe = lotesData.some(l => l.id === lote.id);
        
        if (existe) {
            alert('El lote 1903-MA-AV ya está registrado');
            cargarDatosLote(lote);
            return;
        }
        
        // Agregar al array
        lotesData.push(lote);
        
        // Guardar en localStorage
        guardarEnStorage();
        
        // Mostrar en UI
        cargarDatosLote(lote);
        
        alert('LOTE 1903-MA-AV registrado correctamente');
    };

    // ==========================================
    // CARGAR LOTE MAÍZ 2024 (EJEMPLO)
    // ==========================================

    function cargarLoteMaiz2024() {
        const loteMaiz = {
            id: 'MA-2024',
            nombre: 'Maíz 100%',
            fecha: '2024-01-20',
            version: 'v1.0',
            componentes: [
                { nombre: 'Maíz (MA)', volumen: 3000, masa: 2406, densidad: 0.802, notas: 'Grano seco' }
            ],
            dc: {
                volSol: 3.5,
                agente: 'ÁCIDO PERACÉTICO',
                concAgente: 5,
                volAgente: 60,
                conc: 0.086,
                tiempo: 60
            },
            hm: {
                estadoAgua: 'EBULICIÓN - 100°C',
                estadoGrano: 'TEMPERATURA AMBIENTE',
                metodo: 'INMERSIÓN DIRECTA',
                tiempoCoccion: 70,
                regimenCalor: 'FUEGO MÁXIMO + FUEGO MÍNIMO',
                agitacion: '15 MIN/CICLO × 4 CICLOS'
            },
            dg: [],
            es: {},
            re: {
                evaluacion: {
                    hidratacion: 'correcto',
                    distribucion: 'correcto',
                    eficiencia: 'optimo'
                },
                notas: 'Expansión x2 (100%) - Punto óptimo. Relación agua/maíz 1:1. 12 frascos obtenidos.'
            }
        };
        
        return loteMaiz;
    }

    // Función para cargar el lote de maíz y registrarlo
    GR.cargarLoteMaiz2024Demo = window.cargarLoteMaiz2024Demo = function() {
        const lote = cargarLoteMaiz2024();
        
        // Verificar si ya existe
        const existe = lotesData.some(l => l.id === lote.id);
        
        if (existe) {
            alert('El lote MA-2024 ya está registrado');
            cargarDatosLote(lote);
            return;
        }
        
        // Agregar al array
        lotesData.push(lote);
        
        // Guardar en localStorage
        guardarEnStorage();
        
        // Mostrar en UI
        cargarDatosLote(lote);
        
        alert('LOTE MA-2024 registrado correctamente');
    };

    // Inicialización unificada en GR.init() al inicio del archivo.

// ==========================================
// NAVEGACIÓN (encapsulada para integración futura)
// ==========================================
GR.goToConfig = window.goToConfig = function goToConfig() {
    // Si existe el sub-panel embebido, usar tab switching en lugar de navegar
    if (document.getElementById('gr-sub-cfg')) {
        GR.subTab('cfg');
        return;
    }
    window.location.href = 'gr_config.html';
};
GR.goToIndex = window.goToIndex = function goToIndex() {
    // Si existe el sub-panel embebido, volver al panel principal
    if (document.getElementById('gr-sub-main')) {
        GR.subTab('main');
        return;
    }
    window.location.href = 'gr_index.html';
};

// Sub-tab switcher (Formulación <-> Registro <-> Config)
GR.subTab = window.grSubTab = function grSubTab(t) {
    var tabs = document.querySelectorAll('.gr-subtab');
    tabs.forEach(function(tb) { tb.classList.remove('active'); });
    var active = document.querySelector('.gr-subtab[data-grtab="' + t + '"]');
    if (active) active.classList.add('active');

    var pMain = document.getElementById('gr-sub-main');
    var pReg  = document.getElementById('gr-sub-reg');
    var pCfg  = document.getElementById('gr-sub-cfg');
    var pKnow = document.getElementById('gr-sub-know');

    if (pMain) {
        pMain.style.display = (t === 'main') ? 'flex' : 'none';
        if (t === 'main') pMain.classList.add('active'); else pMain.classList.remove('active');
    }
    if (pReg) {
        pReg.style.display = (t === 'reg') ? 'flex' : 'none';
        if (t === 'reg') pReg.classList.add('active'); else pReg.classList.remove('active');
    }
    if (t === 'reg') grRenderizarRegistroLotes();
    if (pCfg) {
        pCfg.style.display = (t === 'cfg') ? 'flex' : 'none';
        if (t === 'cfg') pCfg.classList.add('active'); else pCfg.classList.remove('active');
    }
    if (t === 'cfg' && typeof renderizarBibliotecaEnConfig === 'function') renderizarBibliotecaEnConfig();
    if (pKnow) {
        pKnow.style.display = (t === 'know') ? 'flex' : 'none';
        if (t === 'know') pKnow.classList.add('active'); else pKnow.classList.remove('active');
    }
    if (t === 'know' && typeof window.grRenderKnowledge === 'function') window.grRenderKnowledge();
};

// ==========================================
// PROTOCOLO DE PREPARACIÓN (FASE 1)
// ==========================================
GR.protoNotas = [];
GR.protoCerrado = false;
GR.dcRegistrado = false;

GR.toggleDC = window.grToggleDC = function grToggleDC() {
    const panel = document.getElementById('grDcPanel');
    if (!panel) return;
    const abierto = panel.style.display !== 'none';
    panel.style.display = abierto ? 'none' : 'block';
    if (!abierto) grPoblarBibliotecaAgentes();
};

function grPoblarBibliotecaAgentes() {
    const sel = document.getElementById('grDcBibliotecaAgentes');
    if (!sel) return;
    const bib = getBiblioteca();
    const agentes = bib.agentes || [];
    sel.innerHTML = '<option value="">-- Seleccionar de biblioteca --</option>' +
        agentes.map(a => `<option value="${a.nombre}" data-conc="${a.concDefault || 0}">${a.nombre}</option>`).join('');
}

GR.seleccionarAgente = window.grSeleccionarAgente = function grSeleccionarAgente() {
    const sel = document.getElementById('grDcBibliotecaAgentes');
    if (!sel) return;
    const opt = sel.options[sel.selectedIndex];
    if (!opt || !opt.value) return;
    const agente = document.getElementById('grDcAgente');
    const conc = document.getElementById('grDcConcAgente');
    if (agente) agente.value = opt.value;
    if (conc) conc.value = opt.getAttribute('data-conc') || 0;
    grCalcDC();
};

GR.calcDC = window.grCalcDC = function grCalcDC() {
    const volSol = parseFloat(document.getElementById('grDcVolSol')?.value) || 0;
    const concAg = parseFloat(document.getElementById('grDcConcAgente')?.value) || 0;
    const volAg  = parseFloat(document.getElementById('grDcVolAgente')?.value) || 0;

    // volSol en L (dilución con agua), volAg en ml
    // Volumen total de la solución = volSol*1000 ml + volAg ml
    const volSolMl   = volSol * 1000;
    const volTotalMl = volSolMl + volAg;
    // C_final(%) = (volAg_ml × concAg%) / volTotal_ml
    const concFinal = volTotalMl > 0 ? (volAg * concAg) / volTotalMl : 0;
    const aguaNec   = volSolMl / 1000; // agua pura necesaria = lo que el usuario ingresó
    const proporcion = volAg > 0 ? `1:${(volSolMl / volAg).toFixed(1)}` : '—';

    const cf = document.getElementById('grDcConcFinal');
    const an = document.getElementById('grDcAguaNec');
    const pr = document.getElementById('grDcProporcion');
    if (cf) cf.textContent = concFinal.toFixed(3);
    if (an) an.textContent = aguaNec.toFixed(2);
    if (pr) pr.textContent = proporcion;

    grCheckDCCompleto();
};

function grCheckDCCompleto() { /* auto-registro desactivado: se usa botón Guardar manual */ }

GR.guardarDC = window.grGuardarDC = function grGuardarDC() {
    if (GR.protoCerrado) { alert('El protocolo está cerrado. Reábralo para editar.'); return; }
    const volSol = document.getElementById('grDcVolSol')?.value;
    const agente = document.getElementById('grDcAgente')?.value?.trim();
    const concAg = document.getElementById('grDcConcAgente')?.value;
    const volAg = document.getElementById('grDcVolAgente')?.value;
    const tiempo = document.getElementById('grDcTiempo')?.value;
    if (!volSol || !agente || !concAg || !volAg || !tiempo) {
        alert('Completa todos los campos de DC antes de guardar.');
        return;
    }
    const concFinal = document.getElementById('grDcConcFinal')?.textContent || '0';
    GR.protoNotas.push({
        ts: grTimestamp(),
        texto: `🧪 Descontaminación Química — ${agente} ${concAg}% | Vol sol: ${volSol}L | Vol agente: ${volAg}ml | Conc final: ${concFinal}% | Tiempo: ${tiempo}min`
    });
    GR.dcRegistrado = true;
    grRenderNotas();
    const btn = document.getElementById('grBtnGuardarDC');
    if (btn) {
        btn.textContent = '✓ Guardado';
        setTimeout(() => { btn.textContent = '💾 Guardar'; }, 1500);
    }
};

function grTimestamp() {
    const d = new Date();
    const fecha = d.getDate().toString().padStart(2,'0') + '/' + (d.getMonth() + 1).toString().padStart(2,'0');
    const hora = d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
    return fecha + ' ' + hora;
}

function grRenderNotas() {
    const cont = document.getElementById('grProtoNotas');
    if (!cont) return;
    if (GR.protoNotas.length === 0) {
        cont.innerHTML = '';
        return;
    }
    cont.innerHTML = GR.protoNotas.map((n, i) =>
        `<div class="gr-nota-entry" style="padding:10px 12px;margin-bottom:8px;background:var(--bg,#1D1D1D);border-left:3px solid #FFA000;border-radius:6px;color:var(--tx,#F5F5F5);position:relative;">
            <div class="nota-time" style="font-size:0.78rem;color:#FFA000;font-weight:600;margin-bottom:4px">${n.ts}</div>
            <div class="nota-text" style="font-size:0.92rem;color:var(--tx,#F5F5F5)">${n.texto}</div>
            <button onclick="grEliminarProtocoloNota(${i})" style="position:absolute;top:8px;right:8px;background:transparent;border:none;color:var(--tx2);cursor:pointer;font-size:0.9rem;padding:2px 6px;" title="Eliminar nota">✕</button>
        </div>`
    ).join('');
}

window.grEliminarProtocoloNota = function(index) {
    if (GR.protoCerrado) { alert('El protocolo está cerrado. Reábralo para editar.'); return; }
    if (index >= 0 && index < GR.protoNotas.length) {
        GR.protoNotas.splice(index, 1);
        grRenderNotas();
    }
};

GR.addProtoNota = window.grAddProtoNota = function grAddProtoNota() {
    if (GR.protoCerrado) { alert('El protocolo está cerrado. Reábralo para editar.'); return; }
    const input = document.getElementById('grProtoNotaInput');
    if (!input) return;
    const texto = (input.value || '').trim();
    if (!texto) { alert('Escribí una nota antes de agregar.'); return; }
    GR.protoNotas.push({ ts: grTimestamp(), texto });
    input.value = '';
    grRenderNotas();
};

// ==========================================
// SEGUIMIENTO (notas timestampedas con estado de color)
// ==========================================
window.grRenderSeguimientoNotas = function() {
    const cont = document.getElementById('grSeguimientoNotas');
    if (!cont) return;
    const notas = Array.isArray(GR.seguimientoNotas) ? GR.seguimientoNotas : [];
    if (!notas.length) { cont.innerHTML = ''; return; }
    const colorEstado = e => e === 'green'  ? '#70AD47'
                            : e === 'yellow' ? '#FFC107'
                            : e === 'red'    ? '#C00000'
                            : '#888';
    cont.innerHTML = notas.map((n, i) => {
        const col = colorEstado(n.estado);
        const meta = [];
        if (typeof n.frascos === 'number' && n.frascos > 0) meta.push(`${n.frascos} ${_grUds()}`);
        if (typeof n.dias === 'number' && n.dias > 0)       meta.push(`${n.dias} días`);
        if (n.tipo) meta.push(n.tipo);
        const metaStr = meta.length ? ` · <span style="color:var(--tx2)">${meta.join(' · ')}</span>` : '';
        const displayTs = n.fechaHora ? _grFmtFechaHora(n.fechaHora) : (n.ts || '');
        return `<div class="gr-seg-entry" style="padding:10px 12px;margin-bottom:8px;background:var(--bg,#1D1D1D);border-left:3px solid ${col};border-radius:6px;color:var(--tx,#F5F5F5);position:relative;">
            <div class="nota-time" style="font-size:0.78rem;color:${col};font-weight:600;margin-bottom:4px">${displayTs}${metaStr}</div>
            <div class="nota-text" style="font-size:0.92rem;color:var(--tx,#F5F5F5)">${n.texto || ''}</div>
            <button onclick="grEliminarSeguimientoNota(${i})" style="position:absolute;top:8px;right:8px;background:transparent;border:none;color:var(--tx2);cursor:pointer;font-size:0.9rem;padding:2px 6px;" title="Eliminar nota">✕</button>
        </div>`;
    }).join('');
};

window.grAddSeguimientoNota = function() {
    const input = document.getElementById('grSeguimientoNotaInput');
    const estadoSel = document.getElementById('grSeguimientoEstado');
    const frascosInput = document.getElementById('grSeguimientoFrascos'); // opcional, puede no existir
    if (!input) return;
    const texto = (input.value || '').trim();
    if (!texto) { alert('Escribí una nota antes de agregar.'); return; }
    const estado = estadoSel ? (estadoSel.value || 'none') : 'none';
    const frascos = frascosInput ? (parseInt(frascosInput.value, 10) || 0) : 0;
    // Días desde inoculación: si el lote tiene fecha de referencia, calculamos; si no, 0.
    let dias = 0;
    try {
        const fechaInoc = (GR && GR.fechaInoculacion) || null;
        if (fechaInoc) {
            const ms = Date.now() - new Date(fechaInoc).getTime();
            if (ms > 0) dias = Math.floor(ms / 86400000);
        }
    } catch (e) {}
    if (!Array.isArray(GR.seguimientoNotas)) GR.seguimientoNotas = [];
    var _isoNow = new Date().toISOString();
    GR.seguimientoNotas.push({
        ts: grTimestamp(),
        fechaHora: _isoNow,
        texto,
        estado,
        frascos,
        dias
    });
    input.value = '';
    if (estadoSel) estadoSel.value = 'none';
    if (frascosInput) frascosInput.value = '0';
    window.grRenderSeguimientoNotas();
};

window.grEliminarSeguimientoNota = function(index) {
    if (!Array.isArray(GR.seguimientoNotas)) return;
    if (index >= 0 && index < GR.seguimientoNotas.length) {
        GR.seguimientoNotas.splice(index, 1);
        window.grRenderSeguimientoNotas();
    }
};

// ==========================================
// MIGRACIÓN inoculoSource null → 'LEGACY'
// ==========================================
    function _migrarInoculoSourceNull() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            var lotes = JSON.parse(raw);
            if (!Array.isArray(lotes)) return;
            var cambiados = 0;
            lotes.forEach(function(lote) {
                if (!Array.isArray(lote.dg)) return;
                lote.dg.forEach(function(dg) {
                    if (dg.inoculoSource === null || dg.inoculoSource === undefined) {
                        dg.inoculoSource = 'LEGACY';
                        cambiados++;
                    }
                });
            });
            if (cambiados > 0) {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(lotes));
                console.log('[GR] Migración inoculoSource: ' + cambiados + ' registros actualizados a LEGACY');
            }
        } catch(e) {
            console.error('[GR] Error en migración inoculoSource:', e);
        }
    }

// ==========================================
// MOTOR ANALÍTICO — Calibración y Conocimiento de Granos
// Toda la lógica es read-only sobre localStorage. Nunca escribe datos derivados.
// ==========================================

/** Formatea ISO 8601 como "DD/MM/YYYY HH:MM" */
function _grFmtFechaHora(iso) {
    if (!iso) return '';
    try {
        var p = iso.substring(0, 10).split('-');
        var h = iso.length > 10 ? iso.substring(11, 16) : '';
        return p[2] + '/' + p[1] + '/' + p[0] + (h ? ' ' + h : '');
    } catch(e) { return iso; }
}

/**
 * Genera la firma de protocolo de un lote GR.
 * Usa solo componentes tipo 'seco'. Redondea a múltiplos de 5%.
 * Ejemplo: "Maíz (MA) 80% + Avena (AV) 20%"
 */
function _grFirmaProtocolo(lote) {
    if (!lote || !Array.isArray(lote.componentes)) return lote && lote.nombre ? lote.nombre : '—';
    var secos = lote.componentes.filter(function(c) { return (c.tipo === 'seco' || !c.tipo) && c.nombre; });
    var masaTotal = secos.reduce(function(acc, c) { return acc + (parseFloat(c.masa) || 0); }, 0);
    if (masaTotal === 0) return lote.nombre || '—';
    var partes = secos
        .filter(function(c) { return (parseFloat(c.masa) || 0) > 0; })
        .map(function(c) { return { nombre: c.nombre, pct: Math.round((parseFloat(c.masa) / masaTotal) * 100 / 5) * 5 }; })
        .sort(function(a, b) { return b.pct - a.pct; });
    return partes.map(function(p) { return p.nombre + ' ' + p.pct + '%'; }).join(' + ');
}

/**
 * Lee fr_bolsas de localStorage (cache en llamada).
 * Retorna [] si no existe o es inválido.
 */
function _grReadFrBolsas() {
    try {
        var raw = localStorage.getItem('fr_bolsas');
        var arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
    } catch(e) { return []; }
}

/**
 * Lee su_lotes de localStorage.
 */
function _grReadSuLotes() {
    try {
        var raw = localStorage.getItem('su_lotes');
        var arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
    } catch(e) { return []; }
}

/**
 * Calcula BE acumulado de una bolsa FR a partir de sus flushes.
 * Usa beAcumulado del último flush si está disponible, sino suma beOleada.
 */
function _grBeAcumBolsa(flushes) {
    if (!Array.isArray(flushes) || flushes.length === 0) return 0;
    var last = flushes[flushes.length - 1];
    if (typeof last.beAcumulado === 'number' && last.beAcumulado > 0) return last.beAcumulado;
    return flushes.reduce(function(acc, f) { return acc + (parseFloat(f.beOleada) || 0); }, 0);
}

/**
 * grComputarAnalisis(grLoteId)
 * Retorna análisis completo de un lote GR individual.
 * Join: gr_lotes → su_lotes → fr_bolsas
 */
window.grComputarAnalisis = function grComputarAnalisis(grLoteId) {
    if (!grLoteId) return null;
    var grLote = null;
    for (var i = 0; i < lotesData.length; i++) {
        if (lotesData[i].id === grLoteId) { grLote = lotesData[i]; break; }
    }

    var suLotes = _grReadSuLotes();
    var frBolsas = _grReadFrBolsas();

    // SU lotes que usaron este GR lote
    var suUsados = suLotes.filter(function(su) {
        if (!su) return false;
        if (su.grProtocolo === grLoteId) return true;
        if (!Array.isArray(su.db)) return false;
        return su.db.some(function(r) {
            if (r.grLoteId === grLoteId) return true;
            if (Array.isArray(r.grSources)) {
                return r.grSources.some(function(s) { return s.grLoteId === grLoteId; });
            }
            return false;
        });
    });
    var suIds = suUsados.map(function(su) { return su.id; });

    // FR bolsas linkadas a este GR lote.
    // 'Desconocido' y null/undefined: si el SU está linkado, se incluye.
    var frLinkadas = frBolsas.filter(function(b) {
        if (!b || suIds.indexOf(b.suLoteId) === -1) return false;
        if (!b.grLoteId || b.grLoteId === 'Desconocido') return true;
        return b.grLoteId === grLoteId;
    });

    // Stats agregadas — pesoHumedo = biomasa fresca, pesoSeco = biomasa seca deshidratada
    var biomasaFrescaTotal = 0;
    var biomasaSecaTotal = 0;
    var oleadasTotal = 0;
    var beValues = [];
    frLinkadas.forEach(function(b) {
        var flushes = Array.isArray(b.flushes) ? b.flushes : [];
        var sustSeco = parseFloat(b.pesoSustratoSeco) || 0;
        oleadasTotal += flushes.length;
        var acumHumedo = 0;
        flushes.forEach(function(f) {
            biomasaFrescaTotal += parseFloat(f.pesoHumedo) || 0;
            biomasaSecaTotal   += parseFloat(f.pesoSeco)   || 0;
            acumHumedo         += parseFloat(f.pesoHumedo) || 0;
        });
        // BE acumulado: preferir campo almacenado, sino computar desde pesoHumedo
        var be = _grBeAcumBolsa(flushes);
        if (be <= 0 && sustSeco > 0 && acumHumedo > 0) be = (acumHumedo / sustSeco) * 100;
        if (be > 0) beValues.push(be);
    });
    var bePromedio = beValues.length > 0
        ? beValues.reduce(function(a, b) { return a + b; }, 0) / beValues.length : 0;

    // Detalle por tanda
    var tandas = [];
    if (grLote && Array.isArray(grLote.dg)) {
        grLote.dg.forEach(function(dgRow) {
            var tandaId = dgRow.tanda;
            var suTandaIds = suUsados.filter(function(su) {
                if (!Array.isArray(su.db)) return false;
                return su.db.some(function(r) {
                    if (r.grTandaId === tandaId) return true;
                    if (Array.isArray(r.grSources)) {
                        return r.grSources.some(function(s) { return s.grTandaId === tandaId; });
                    }
                    return false;
                });
            }).map(function(su) { return su.id; });

            var frTanda = frBolsas.filter(function(b) {
                if (!b || suTandaIds.indexOf(b.suLoteId) === -1) return false;
                if (!b.grTandaId || b.grTandaId === 'Desconocido') return true;
                return b.grTandaId === tandaId;
            });
            var tBiomasa = 0;
            var tBeVals = [];
            frTanda.forEach(function(b) {
                var flushes = Array.isArray(b.flushes) ? b.flushes : [];
                var sustSeco = parseFloat(b.pesoSustratoSeco) || 0;
                var acumHumedo = 0;
                flushes.forEach(function(f) {
                    var ph = parseFloat(f.pesoHumedo) || 0;
                    tBiomasa    += ph;
                    acumHumedo  += ph;
                });
                var be = _grBeAcumBolsa(flushes);
                if (be <= 0 && sustSeco > 0 && acumHumedo > 0) be = (acumHumedo / sustSeco) * 100;
                if (be > 0) tBeVals.push(be);
            });

            tandas.push({
                tandaId: tandaId,
                genetica: dgRow.genetica || '—',
                frascos: dgRow.frascos || 0,
                suLoteIds: suTandaIds,
                fr: {
                    bolsas: frTanda.length,
                    bePromedio: tBeVals.length > 0
                        ? tBeVals.reduce(function(a, b) { return a + b; }, 0) / tBeVals.length : 0,
                    biomasaFrescaTotal: tBiomasa
                }
            });
        });
    }

    return {
        grLoteId: grLoteId,
        grLote: grLote,
        suLotes: suUsados,
        fr: {
            bolsasTrackeadas: frLinkadas.length,
            bePromedio: bePromedio,
            biomasaFrescaTotal: biomasaFrescaTotal,
            biomasaSecaTotal: biomasaSecaTotal,
            rendFrescoPorBolsa: frLinkadas.length > 0 ? biomasaFrescaTotal / frLinkadas.length : 0,
            oleadasTotal: oleadasTotal
        },
        tandas: tandas
    };
};

/**
 * Genera observaciones de correlación a partir del array de protocolos.
 */
function _grGenerarCorrelaciones(protocolos) {
    var conDatos = protocolos.filter(function(p) { return p.lotes >= 2 && p.bePromedio > 0; });
    if (conDatos.length === 0) {
        return ['Se necesitan al menos 2 lotes con trazabilidad FR completa por protocolo para generar observaciones.'];
    }
    var obs = [];
    // Mejor protocolo
    var top = protocolos[0];
    if (top && top.bePromedio > 0) {
        obs.push('Mejor rendimiento: "' + top.firma + '" · BE promedio ' + top.bePromedio.toFixed(1) + '%');
    }
    // Correlación hidratación
    if (conDatos.length >= 2) {
        var sorted = conDatos.slice().sort(function(a, b) { return b.bePromedio - a.bePromedio; });
        var half = Math.ceil(sorted.length / 2);
        var topH = sorted.slice(0, half);
        var botH = sorted.slice(half);
        var avgHidTop = topH.reduce(function(a, p) { return a + p.hidratacionPromedio; }, 0) / topH.length;
        var avgHidBot = botH.length > 0 ? botH.reduce(function(a, p) { return a + p.hidratacionPromedio; }, 0) / botH.length : 0;
        if (avgHidBot > 0 && (avgHidTop - avgHidBot) > 10) {
            obs.push('Mayor hidratación correlaciona con mejor BE: top protocolos ' + avgHidTop.toFixed(0) + '% vs resto ' + avgHidBot.toFixed(0) + '%');
        }
    }
    // Peores protocolos con suficientes datos
    var globalBe = conDatos.reduce(function(a, p) { return a + p.bePromedio; }, 0) / conDatos.length;
    conDatos.forEach(function(p) {
        if (p.bePromedio < globalBe * 0.85) {
            obs.push('Protocolo "' + p.firma + '" consistentemente bajo (BE ' + p.bePromedio.toFixed(1) + '% vs media ' + globalBe.toFixed(1) + '%) — considerar reformulación.');
        }
    });
    if (obs.length === 0) {
        obs.push('Sin correlaciones significativas aún. Seguí registrando lotes con trazabilidad FR completa.');
    }
    return obs;
}

/**
 * grComputarKnowledge()
 * Agrega todos los lotes GR con FR data. Retorna { protocolos, correlaciones }.
 */
window.grComputarKnowledge = function grComputarKnowledge() {
    var suLotes = _grReadSuLotes();
    var lotesValidos = lotesData.filter(function(l) { return l && l.id; });

    var sigMap = {};
    lotesValidos.forEach(function(l) {
        var analisis = window.grComputarAnalisis(l.id);
        if (!analisis) return;

        var firma = _grFirmaProtocolo(l);
        if (!sigMap[firma]) {
            sigMap[firma] = { firma: firma, lotes: [] };
        }

        // Ratio G:S en peso por lote
        var _pesoFrascoGR = parseFloat((l.uf || {}).peso_unidad) || 0;
        var _totGrano = 0, _totSustrato = 0;
        analisis.suLotes.forEach(function(su) {
            if (!Array.isArray(su.db)) return;
            var _suTotal = parseFloat(su.total) || 0;
            var _suBolsasTot = su.db.reduce(function(s, r) { return s + (parseInt(r.bolsas) || 0); }, 0);
            var _grLoteDef = su.grProtocolo || '';
            su.db.forEach(function(r) {
                var _bolsas = parseInt(r.bolsas) || 0;
                if (!_bolsas) return;
                var _srcs = grNormSources(r, _grLoteDef);
                var _srcsEste = _srcs.filter(function(s) { return s.grLoteId === l.id; });
                var _usaEste = _srcsEste.length > 0 || (_srcs.length === 0 && su.grProtocolo === l.id);
                if (!_usaEste) return;
                var _pgReal = parseFloat(r.pesoGranoReal) || 0;
                var _grUsados = _srcsEste.reduce(function(s, x) { return s + (x.grUsados || 0); }, 0) || (parseInt(r.grUsados) || 0);
                var _pesoGrano = _pgReal > 0 ? _pgReal * _bolsas : _grUsados * _pesoFrascoGR;
                var _psReal = parseFloat(r.pesoReal) || 0;
                var _pesoSust = _psReal > 0 ? _psReal * _bolsas : (_suBolsasTot > 0 ? (_bolsas / _suBolsasTot) * _suTotal : 0);
                _totGrano += _pesoGrano;
                _totSustrato += _pesoSust;
            });
        });

        var _kpi = grCalcularKPIFormulario(l);
        sigMap[firma].lotes.push({
            id:            l.id,
            suCount:       analisis.suLotes.length,
            bolsasFR:      analisis.fr.bolsasTrackeadas,
            bePromedio:    analisis.fr.bePromedio,
            biomasaHumeda: analisis.fr.biomasaFrescaTotal,
            biomasaSeca:   analisis.fr.biomasaSecaTotal,
            hidratacion:   (_kpi && _kpi.hidratacion > 0) ? _kpi.hidratacion : 0,
            ratioGS:       (_totSustrato > 0 && _totGrano > 0) ? _totGrano / _totSustrato : 0
        });
    });

    // Agregar por grupo
    var protocolos = Object.values(sigMap).map(function(g) {
        var lotes = g.lotes;
        var beVals = lotes.map(function(l) { return l.bePromedio; }).filter(function(v) { return v > 0; });
        var hidVals = lotes.map(function(l) { return l.hidratacion; }).filter(function(v) { return v > 0; });
        var ratioVals = lotes.map(function(l) { return l.ratioGS; }).filter(function(v) { return v > 0; });
        var avg = function(arr) { return arr.length ? arr.reduce(function(a, b) { return a + b; }, 0) / arr.length : 0; };
        var bePromedio = avg(beVals);
        return {
            firma:              g.firma,
            grLoteIds:          lotes.map(function(l) { return l.id; }),
            lotes:              lotes.length,
            bolsasFR:           lotes.reduce(function(s, l) { return s + l.bolsasFR; }, 0),
            bePromedio:         bePromedio,
            beDesviacion:       beVals.length > 1 ? Math.sqrt(avg(beVals.map(function(v) { return Math.pow(v - bePromedio, 2); }))) : 0,
            biomasaFrescaTotal: lotes.reduce(function(s, l) { return s + l.biomasaHumeda; }, 0),
            biomasaSecaTotal:   lotes.reduce(function(s, l) { return s + l.biomasaSeca; }, 0),
            hidratacionPromedio: avg(hidVals),
            ratioGrSu:          avg(ratioVals),
            lotesDetalle:       lotes
        };
    }).sort(function(a, b) { return b.bePromedio - a.bePromedio; });

    return { protocolos: protocolos, correlaciones: _grGenerarCorrelaciones(protocolos) };
};

/**
 * Renderiza el HTML del panel de trazabilidad de un lote.
 */
function _grRenderTrazaPanel(analisis, grLoteId) {
    if (!analisis) return '<div class="gr-traza-empty">No se pudo computar el análisis para este lote.</div>';
    var lote = analisis.grLote;

    // Sección CT
    var ctHtml = '';
    if (lote && Array.isArray(lote.componentes) && lote.componentes.length > 0) {
        ctHtml = '<div class="gr-traza-section"><div class="gr-traza-title">COMPOSICIÓN CT</div>' +
            lote.componentes.filter(function(c) { return c.nombre; }).map(function(c) {
                return '<div class="gr-traza-row-ct">' +
                    '<span class="gt-label">' + (c.nombre || '?') + '</span>' +
                    (c.volumen ? '<span>' + c.volumen + ' ml</span>' : '') +
                    (c.masa    ? '<span>' + parseFloat(c.masa).toFixed(0) + ' g</span>' : '') +
                    (c.densidad && parseFloat(c.densidad) > 0 ? '<span>' + parseFloat(c.densidad).toFixed(3) + ' g/ml</span>' : '') +
                    '</div>';
            }).join('') + '</div>';
    }

    // Sección Tandas → SU → FR
    var tandasHtml = '';
    if (analisis.tandas && analisis.tandas.length > 0) {
        tandasHtml = '<div class="gr-traza-section"><div class="gr-traza-title">TANDAS → SU → FR</div>' +
            analisis.tandas.map(function(t) {
                var frInfo = t.fr.bolsas > 0
                    ? t.fr.bolsas + ' bolsas FR · BE ' + t.fr.bePromedio.toFixed(1) + '% · Húmedo ' + (t.fr.biomasaFrescaTotal / 1000).toFixed(2) + ' kg'
                    : '<em>Sin trazabilidad FR aún</em>';
                var suStr = t.suLoteIds.length > 0
                    ? t.suLoteIds.map(function(id) { return '<span class="gr-traza-chip">' + id + '</span>'; }).join(' ')
                    : '<em>Sin SU linkado</em>';
                return '<div class="gr-traza-tanda-row">' +
                    '<div><strong>' + (t.tandaId || '?') + '</strong> · ' + (t.genetica || '—') + ' · ' + (t.frascos || 0) + ' frascos</div>' +
                    '<div class="gr-traza-su">SU: ' + suStr + '</div>' +
                    '<div class="gr-traza-fr">FR: ' + frInfo + '</div>' +
                    '</div>';
            }).join('') + '</div>';
    } else {
        tandasHtml = '<div class="gr-traza-section"><div class="gr-traza-title">TANDAS</div><div class="gr-traza-empty">Sin tandas registradas en este lote.</div></div>';
    }

    // Sección Resumen
    var fr = analisis.fr;
    var suCount = analisis.suLotes.length;
    var ufUnidades = lote && lote.uf ? (parseFloat(lote.uf.cantidad_unidades) || 0) : 0;
    var resumenHtml = '<div class="gr-traza-section"><div class="gr-traza-title">RESUMEN DE LOTE</div>' +
        '<div class="gr-traza-kpis">' +
        '<div class="gr-traza-kpi"><span class="gr-traza-kpi-label">Frascos producidos</span><span class="gr-traza-kpi-val">' + ufUnidades + '</span></div>' +
        '<div class="gr-traza-kpi"><span class="gr-traza-kpi-label">Lotes SU</span><span class="gr-traza-kpi-val">' + suCount + '</span></div>' +
        '<div class="gr-traza-kpi"><span class="gr-traza-kpi-label">Bolsas FR</span><span class="gr-traza-kpi-val">' + fr.bolsasTrackeadas + '</span></div>' +
        '<div class="gr-traza-kpi"><span class="gr-traza-kpi-label">BE promedio</span><span class="gr-traza-kpi-val gr-traza-highlight">' + (fr.bePromedio > 0 ? fr.bePromedio.toFixed(1) + '%' : '—') + '</span></div>' +
        '<div class="gr-traza-kpi"><span class="gr-traza-kpi-label">Biomasa húmeda total</span><span class="gr-traza-kpi-val">' + (fr.biomasaFrescaTotal > 0 ? (fr.biomasaFrescaTotal / 1000).toFixed(3) + ' kg' : '—') + '</span></div>' +
        '<div class="gr-traza-kpi"><span class="gr-traza-kpi-label">Biomasa seca total</span><span class="gr-traza-kpi-val">' + (fr.biomasaSecaTotal > 0 ? (fr.biomasaSecaTotal).toFixed(1) + ' g' : '—') + '</span></div>' +
        (fr.bolsasTrackeadas > 0 && fr.rendFrescoPorBolsa > 0 ? '<div class="gr-traza-kpi"><span class="gr-traza-kpi-label">Rend. fresco/bolsa</span><span class="gr-traza-kpi-val">' + fr.rendFrescoPorBolsa.toFixed(0) + ' g</span></div>' : '') +
        '</div></div>';

    // Sección Notas de seguimiento
    var notasHtml = '';
    if (lote && Array.isArray(lote.seguimientoNotas) && lote.seguimientoNotas.length > 0) {
        var colorEstado = function(e) {
            return e === 'green' ? '#70AD47' : e === 'yellow' ? '#FFC107' : e === 'red' ? '#C00000' : '#888';
        };
        notasHtml = '<div class="gr-traza-section"><div class="gr-traza-title">NOTAS DE SEGUIMIENTO</div>' +
            lote.seguimientoNotas.map(function(n) {
                var col = colorEstado(n.estado);
                var ts = n.fechaHora ? _grFmtFechaHora(n.fechaHora) : (n.ts || '');
                return '<div class="gr-traza-nota" style="border-left-color:' + col + '">' +
                    '<span class="gr-traza-nota-ts" style="color:' + col + '">' + ts + '</span>' +
                    '<span class="gr-traza-nota-txt">' + (n.texto || '') + '</span>' +
                    '</div>';
            }).join('') + '</div>';
    } else {
        notasHtml = '<div class="gr-traza-section"><div class="gr-traza-title">NOTAS DE SEGUIMIENTO</div><div class="gr-traza-empty">Sin notas de seguimiento.</div></div>';
    }

    if (fr.bolsasTrackeadas === 0 && suCount === 0) {
        return '<div class="gr-traza-panel-inner">' + ctHtml +
            '<div class="gr-traza-empty" style="padding:16px">Sin trazabilidad SU/FR disponible aún para este lote.</div>' +
            notasHtml + '</div>';
    }

    return '<div class="gr-traza-panel-inner">' + ctHtml + tandasHtml + resumenHtml + notasHtml + '</div>';
}

/** Toggle del panel de trazabilidad en el Registro */
window.grToggleTrazabilidad = function grToggleTrazabilidad(grLoteId, btn) {
    var panel = document.getElementById('grTraza_' + grLoteId);
    if (!panel) return;
    var isOpen = panel.style.display !== 'none';
    if (isOpen) {
        panel.style.display = 'none';
        if (btn) btn.innerHTML = '▶ Trazabilidad';
        return;
    }
    if (!panel.dataset.loaded) {
        var analisis = window.grComputarAnalisis(grLoteId);
        panel.innerHTML = _grRenderTrazaPanel(analisis, grLoteId);
        panel.dataset.loaded = '1';
    }
    panel.style.display = 'block';
    if (btn) btn.innerHTML = '▼ Trazabilidad';
};

/** Renderiza la sub-pestaña Conocimiento */
window.grRenderKnowledge = function grRenderKnowledge() {
    var container = document.getElementById('grKnowledgeContent');
    if (!container) return;

    var data = window.grComputarKnowledge();
    var protocolos = data.protocolos;
    var correlaciones = data.correlaciones;

    if (protocolos.length === 0) {
        container.innerHTML = '<div class="gr-know-empty">No hay lotes GR registrados aún.</div>';
        return;
    }

    function fmtBE(v, dev) {
        if (!(v > 0)) return '<span class="gr-know-null">—</span>';
        return v.toFixed(1) + '%' + (dev > 0 ? ' <span class="gr-know-dev">±' + dev.toFixed(1) + '</span>' : '');
    }
    function fmtKg(v) { return v > 0 ? (v / 1000).toFixed(2) + ' kg' : '<span class="gr-know-null">—</span>'; }
    function fmtKg3(v) { return v > 0 ? (v / 1000).toFixed(3) + ' kg' : '<span class="gr-know-null">—</span>'; }
    function fmtPct(v) { return v > 0 ? v.toFixed(1) + '%' : '<span class="gr-know-null">—</span>'; }
    function fmtRatio(v) { return v > 0 ? '1:' + v.toFixed(2) : '<span class="gr-know-null">—</span>'; }

    var COLS = '<th>Lotes</th><th>Bolsas FR</th><th>BE medio</th><th>Biomasa húmeda</th><th>Biomasa seca</th><th>Hidratación</th><th title="Peso grano / peso sustrato">Ratio G:S</th>';

    var rows = '';
    protocolos.forEach(function(p) {
        // Fila de grupo
        rows += '<tr class="gr-know-group-row">' +
            '<td class="gr-know-firma">' + p.firma + '</td>' +
            '<td class="gr-know-agg">' + p.lotes + '</td>' +
            '<td class="gr-know-agg">' + (p.bolsasFR > 0 ? p.bolsasFR : '<span class="gr-know-null">—</span>') + '</td>' +
            '<td class="gr-know-agg gr-know-be">' + fmtBE(p.bePromedio, p.beDesviacion) + '</td>' +
            '<td class="gr-know-agg">' + fmtKg(p.biomasaFrescaTotal) + '</td>' +
            '<td class="gr-know-agg">' + fmtKg3(p.biomasaSecaTotal) + '</td>' +
            '<td class="gr-know-agg">' + fmtPct(p.hidratacionPromedio) + '</td>' +
            '<td class="gr-know-agg">' + fmtRatio(p.ratioGrSu) + '</td>' +
            '</tr>';
        // Sub-filas por lote
        p.lotesDetalle.forEach(function(d) {
            var stage = d.bolsasFR > 0 ? 'fr'
                      : d.suCount > 0  ? 'su'
                      : 'gr';
            var stageBadge = stage === 'fr'
                ? '<span class="gr-know-stage gr-know-stage-fr" title="Con datos de fructificación">FR</span>'
                : stage === 'su'
                ? '<span class="gr-know-stage gr-know-stage-su" title="Inoculado en SU — sin fructificación aún">SU</span>'
                : '<span class="gr-know-stage gr-know-stage-gr" title="Solo grano preparado — sin SU aún">GR</span>';
            var idSafe = d.id.replace(/'/g, "\\'");
            rows += '<tr class="gr-know-lote-row" onclick="grCargarPorId(\'' + idSafe + '\')" title="Abrir ' + d.id + '">' +
                '<td class="gr-know-lote-id">└ ' + d.id + ' ' + stageBadge + '</td>' +
                '<td></td>' +
                '<td>' + (d.bolsasFR > 0 ? d.bolsasFR : '<span class="gr-know-null">—</span>') + '</td>' +
                '<td>' + fmtBE(d.bePromedio, 0) + '</td>' +
                '<td>' + fmtKg(d.biomasaHumeda) + '</td>' +
                '<td>' + fmtKg3(d.biomasaSeca) + '</td>' +
                '<td>' + fmtPct(d.hidratacion) + '</td>' +
                '<td>' + fmtRatio(d.ratioGS) + '</td>' +
                '</tr>';
        });
    });

    var tableHtml = '<div class="gr-know-section"><div class="gr-know-title">Protocolos de Grano</div>' +
        '<table class="gr-know-table"><thead><tr><th>Protocolo / Lote</th>' + COLS + '</tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div>';

    // Correlaciones
    var corHtml = '<div class="gr-know-section"><div class="gr-know-title">Correlaciones Detectadas</div>' +
        '<div class="gr-know-correlaciones">' +
        correlaciones.map(function(obs) {
            return '<div class="gr-know-obs">◈ ' + obs + '</div>';
        }).join('') +
        '</div></div>';

    container.innerHTML = tableHtml + corHtml;
};

// ==========================================
// INIT PÚBLICO — main.js llama a window.grInit() al montar el módulo
// ==========================================
function grInit() {
    // Migrar key legacy sustratos_biblioteca → gr_biblioteca (one-shot)
    (function _migrarBibliotecaKey() {
        try {
            var _leg = localStorage.getItem('sustratos_biblioteca');
            if (_leg && !localStorage.getItem('gr_biblioteca')) {
                localStorage.setItem('gr_biblioteca', _leg);
                localStorage.removeItem('sustratos_biblioteca');
                console.log('[GR] migración BIBLIOTECA_KEY: sustratos_biblioteca → gr_biblioteca');
            }
        } catch(e) { console.warn('[GR] migración BIBLIOTECA_KEY:', e); }
    })();
    _migrarInoculoSourceNull();
    // Pre-hidratar biblioteca antes de cualquier handler DOM.
    // Esto garantiza que GR.biblioteca esté disponible aunque
    // cualquier otro código dispare accesos tempranos.
    try { getBiblioteca(); } catch (e) { console.error('GR getBiblioteca:', e); }

    try { GR.init(); } catch (e) { console.error('GR.init:', e); }
    try { grRenderNotas(); } catch (e) { console.error('GR grRenderNotas:', e); }
    try { window.grRenderSeguimientoNotas(); } catch (e) { console.error('GR grRenderSeguimientoNotas:', e); }
}

// ==========================================
// EXPOSICIÓN AL SCOPE GLOBAL
// Muchos de estos ya estaban expuestos por asignaciones inline durante la
// ejecución. Los repetimos acá para dejar la lista auditable en un solo lugar.
// ==========================================
window.grInit       = grInit;
window.addCtRow     = (typeof addCtRow === 'function') ? addCtRow : window.addCtRow;
window.importarJSON = (typeof importarJSON === 'function') ? importarJSON : window.importarJSON;

// ==========================================
// LIMPIEZA PROFUNDA — Elimina lotes inválidos de localStorage
// Un lote es válido si tiene: id, uf.cantidad_unidades > 0, uf.peso_unidad > 0
// ==========================================
// [Fase 4] grLimpiezaProfunda + onModuleUnload + auto-init reconstruidos tras truncamiento del Edit tool
window.grLimpiezaProfunda = function() {
    let raw;
    try { raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch(e) { alert('Error al leer localStorage. Backup antes de continuar.'); return; }

    const validos    = [];
    const eliminados = [];

    raw.forEach(lote => {
        const uf = lote.uf || lote.produccion || {};
        const sinId       = !lote.id || String(lote.id).trim() === '';
        const sinUnidades = !(parseFloat(uf.cantidad_unidades) > 0);
        const sinPeso     = !(parseFloat(uf.peso_unidad) > 0);

        if (sinId || sinUnidades || sinPeso) {
            const razon = sinId       ? 'ID vacio'
                        : sinUnidades ? 'cantidad_unidades = 0'
                        : 'peso_unidad = 0';
            eliminados.push('- ' + (lote.id || '(sin ID)') + ' - ' + razon);
        } else {
            validos.push(lote);
        }
    });

    if (eliminados.length === 0) {
        alert('No se encontraron lotes invalidos. El modulo esta limpio.');
        return;
    }

    const msg = 'Se encontraron ' + eliminados.length + ' lote(s) invalido(s):\n\n' +
                eliminados.join('\n') +
                '\n\nEliminarlos permanentemente?\n(Se recomienda exportar backup primero)';
    if (!confirm(msg)) return;

    lotesData = validos;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(validos));
    } catch(e) {
        alert('Error al guardar. Los datos originales no fueron modificados.');
        return;
    }

    if (typeof grRenderizarRegistroLotes === 'function') grRenderizarRegistroLotes();
    if (typeof actualizarSelectorLotes   === 'function') actualizarSelectorLotes();
    alert('Limpieza completada. ' + eliminados.length + ' lote(s) eliminado(s). ' + validos.length + ' lote(s) conservado(s).');
};

// ==========================================
// HOOK DE DESMONTAJE - main.js lo llama al cambiar de modulo
// ==========================================
window.onModuleUnload = function () {
    if (_grStorageListener) {
        window.removeEventListener('storage', _grStorageListener);
        _grStorageListener = null;
    }
    if (_grVisibilityListener) {
        document.removeEventListener('visibilitychange', _grVisibilityListener);
        _grVisibilityListener = null;
    }
    if (_grFocusListener) {
        window.removeEventListener('focus', _grFocusListener);
        _grFocusListener = null;
    }
    if (_grUsadosChangedListener) {
        window.removeEventListener('gr-usados-changed', _grUsadosChangedListener);
        _grUsadosChangedListener = null;
    }
    if (_grCultivosChangedListener) {
        window.removeEventListener('ci-cultivos-changed', _grCultivosChangedListener);
        _grCultivosChangedListener = null;
    }
    if (_grMessageListener) {
        window.removeEventListener('message', _grMessageListener);
        _grMessageListener = null;
    }
};

// Auto-inicializacion si el modulo se carga solo (fuera del loader main.js)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', grInit);
} else {
    grInit();
}

})(); // <- cierre IIFE
