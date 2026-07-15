/**
 * MÓDULO SU - SUSTRATOS
 * Calculadora de registros de sustratos
 * Lógica extraída de biolab_v6.html adaptada al estilo Calculadora_Sustratos
 * (Integración GR: gr_usados, selector de protocolo GR, Disponibles en vivo)
 */

(function() {

// ==========================================
// CONSTANTES Y CLAVES DE STORAGE
// ==========================================

const SU_STORAGE_KEY = 'su_lotes';
const SU_BIBLIOTECA_KEY = 'su_biblioteca';

// Biblioteca de materiales por defecto
const bibliotecaDefault = {
    materiales: [
        { id: 'MAT-01', nombre: 'Fibra de coco seca', tipo: 'estructura', estado: 'solido', notas: 'Base del sustrato' },
        { id: 'MAT-02', nombre: 'Vermiculita', tipo: 'estructura', estado: 'solido', notas: 'Retención de agua' },
        { id: 'MAT-03', nombre: 'Yeso (CaSO4)', tipo: 'aditivo', estado: 'solido', notas: 'Estabiliza pH' },
        { id: 'MAT-04', nombre: 'Cal agrícola', tipo: 'aditivo', estado: 'solido', notas: 'Regula pH' },
        { id: 'MAT-05', nombre: 'Café molido', tipo: 'nutricion', estado: 'solido', notas: 'Suplemento' },
        { id: 'MAT-06', nombre: 'Salvado de trigo', tipo: 'nutricion', estado: 'solido', notas: 'Alto en nitrógeno' },
        { id: 'MAT-07', nombre: 'Agua', tipo: 'hidratacion', estado: 'liquido', notas: 'Base hídrica' }
    ]
};

// ==========================================
// VARIABLES GLOBALES
// ==========================================

let lotesData = [];
let biblioteca = { materiales: [] };

// ==========================================
// UUID INTERNO — identidad estable de lote
// ==========================================
// Genera un UUID v4 simple. Solo se usa internamente (_uuid).
// No es visible ni editable por el usuario.
function _suGenUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0;
        var v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Migración silenciosa: asigna _uuid a lotes históricos que no tengan uno.
// Se llama una sola vez al cargar desde storage.
function _suMigrarUUIDs(arr) {
    var changed = false;
    (arr || []).forEach(function(l) {
        if (!l._uuid) { l._uuid = _suGenUUID(); changed = true; }
    });
    return changed;
}

// Variables para control de listeners y timers (necesarias para onModuleUnload)
let _suStorageListener = null;
let _suDomListener = null;
let _suCalcTimer = null;
let _suSyncTimer = null;
let _suFrRenombradaListener = null;

// Flag: true cuando hay un lote existente cargado en el formulario.
// Previene que el selector GR re-dispare el auto-completado de filas DB.
let _suLoteCargado = false;

// (sort dinámico eliminado — cards ordenan por fecha desc)

// Estadísticas de Eficiencia Biológica (BE) de una bolsa FR — solo lectura, no
// calcula nada que FR no haya calculado y persistido ya (flush.beOleada/pesoHumedo).
// Devuelve null si no hay bolsa o no tiene pesoSustratoSeco válido para dividir.
// Una bolsa sin cosechas devuelve beTotal:0 (cuenta como 0% en agregados de lote).
function _suBolsaBE(frB) {
    if (!frB) return null;
    var pss = parseFloat(frB.pesoSustratoSeco) || 0;
    if (pss <= 0) return null;
    var flushes = Array.isArray(frB.flushes) ? frB.flushes : [];
    var pesoHumedoTotal = flushes.reduce(function(a, f) { return a + (parseFloat(f.pesoHumedo) || 0); }, 0);
    var beTotal = flushes.reduce(function(a, f) { return a + (parseFloat(f.beOleada) || 0); }, 0);
    return { pesoHumedoTotal: pesoHumedoTotal, pesoSustratoSeco: pss, beTotal: beTotal, cosechas: flushes.length };
}

// BE agregado de un lote SU completo, para ordenar el Registro. Recorre todas las
// bolsas FR vinculadas (_suGetFRMap) y combina sus estadísticas (_suBolsaBE).
// Devuelve null si ninguna bolsa del lote tiene dato utilizable — esos lotes van
// al final de la lista cuando se ordena por BE, en cualquiera de los dos modos.
function _suLoteBEStats(lote) {
    var frMap = _suGetFRMap(lote);
    var sumHumedo = 0, sumSeco = 0, mejorBE = null, tieneDato = false;
    Object.keys(frMap).forEach(function(k) {
        var stats = _suBolsaBE(frMap[k]);
        if (!stats) return;
        tieneDato = true;
        sumHumedo += stats.pesoHumedoTotal;
        sumSeco += stats.pesoSustratoSeco;
        if (mejorBE === null || stats.beTotal > mejorBE) mejorBE = stats.beTotal;
    });
    if (!tieneDato || sumSeco <= 0) return null;
    return { beProm: (sumHumedo / sumSeco) * 100, beMejor: mejorBE };
}

// Modo de orden del Registro de Lotes — 'fecha' (default) | 'beProm' | 'beMejor'.
// No persiste entre recargas a propósito (ver spec).
let _suRegSortMode = 'fecha';
function suSetRegSortMode(mode) {
    _suRegSortMode = mode;
    renderizarRegistroLotes();
}

// Lee fr_bolsas y devuelve { suBolsaIndex → bolsa FR } para este lote SU.
// Match canónico: suLoteId === lote.id + suBolsaIndex === índice de sub-fila en lote.db
function _suGetFRMap(lote) {
    var byIndex = {};
    try {
        var raw = localStorage.getItem('fr_bolsas');
        if (!raw) return byIndex;
        var bolsas = JSON.parse(raw);
        if (!Array.isArray(bolsas)) return byIndex;
        bolsas.forEach(function(b) {
            if (b.suLoteId === lote.id && b.suBolsaIndex != null) byIndex[b.suBolsaIndex] = b;
        });
    } catch(e) {}
    return byIndex;
}

// ==========================================
// NAMESPACE SU + ESTADO COMPARTIDO
// ==========================================
// Namespace SU expuesto desde el primer load: init() y subTab() se asignan
// más abajo. Mantener aquí evita ReferenceError cuando otros módulos chequean
// window.SU en carga temprana.
window.SU = {};
window.SU.reNotas = window.SU.reNotas || [];

// Estado compartido entre GR ↔ SU ↔ FR (espejo en memoria de localStorage)
// ==========================================
// INICIALIZACIÓN
// ==========================================

// SU.init(): entry point idempotente del módulo SU.
// Puede ser invocado por DOMContentLoaded o manualmente desde el host (index).
window.SU.init = function suInit() {
    if (window.SU._initialized) return;
    window.SU._initialized = true;

    window.SU.reNotas = window.SU.reNotas || [];

    try { cargarBibliotecaDesdeStorage(); } catch (e) { console.warn('SU.init cargarBiblioteca:', e); }
    try { cargarLotesDesdeStorage(); }     catch (e) { console.warn('SU.init cargarLotes:', e); }
    try { inicializarEventos(); }          catch (e) { console.warn('SU.init eventos:', e); }
    try { establecerFechaActual(); }       catch (e) { console.warn('SU.init fecha:', e); }
    try {
        var _loteIdInitEl = document.getElementById('loteId');
        var _loteFechaInitEl = document.getElementById('loteFecha');
        if (_loteIdInitEl && _loteFechaInitEl && !_loteIdInitEl.dataset.suUuid) {
            _loteIdInitEl.value = suGenerarId(_loteFechaInitEl.value);
        }
    } catch (e) { console.warn('SU.init generarId:', e); }
    try { renderizarRegistroLotes(); }     catch (e) { console.warn('SU.init renderReg:', e); }
    try { suReRenderNotas(); }             catch (e) { console.warn('SU.init notas:', e); }
    try { cargarLoteDesdeBiblioteca(); }   catch (e) { console.warn('SU.init biblioteca:', e); }
};

// ==========================================
// SEGUIMIENTO DE NOTAS (move arriba)
// ==========================================
SU.reNotas = SU.reNotas || [];

function suReTimestamp() {
    var now = new Date();
    return now.toLocaleString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

window.suReRenderNotas = function() {
    var cont = document.getElementById('suReNotas');
    if (!cont) return;
    if (SU.reNotas.length === 0) {
        cont.innerHTML = '<p style="color:var(--text-muted);font-size:0.9rem;">Sin notas de seguimiento</p>';
        return;
    }

    cont.innerHTML = SU.reNotas.map(function(n) {
        var borderColor = 'var(--border)';
        var estadoStr = '⚪ Normal';
        var estadoColor = 'var(--text-muted)';

        if (n.estado === 'green') {
            borderColor = '#70AD47';
            estadoStr = '🟢 Positivo';
            estadoColor = '#70AD47';
        } else if (n.estado === 'yellow') {
            borderColor = '#FFC000';
            estadoStr = '🟡 Atención';
            estadoColor = '#FFC000';
        } else if (n.estado === 'red') {
            borderColor = '#C00000';
            estadoStr = '🔴 Peligro';
            estadoColor = '#C00000';
        }

        var numBolsas = n.bolsas || 0;
        var extraInfo = '';
        if (numBolsas > 0) {
            extraInfo = '<div style="font-size:0.85rem;color:' + estadoColor + ';margin-top:4px;font-weight:600;">' + estadoStr + ': ' + numBolsas + ' bolsa(s)</div>';
        }

        return '<div style="padding:10px 12px;margin-bottom:8px;background:var(--dark);border-left:3px solid ' + borderColor + ';border-radius:6px;">' +
            '<div style="font-size:0.78rem;color:var(--text-muted);font-weight:600;margin-bottom:4px">' + n.ts + '</div>' +
            '<div style="font-size:0.92rem;color:var(--text-light)">' + n.texto + '</div>' +
            extraInfo +
        '</div>';
    }).join('');
};

window.suAddReNota = function() {
    var input = document.getElementById('suReNotaInput');
    var estadoSel = document.getElementById('suReEstado');
    var bolsasInput = document.getElementById('suReBolsas');

    if (!input) return;

    var texto = (input.value || '').trim();
    if (!texto) {
        alert('Ingrese una nota');
        return;
    }

    SU.reNotas.push({
        ts: suReTimestamp(),
        texto: texto,
        estado: estadoSel.value,
        bolsas: parseInt(bolsasInput.value) || 0
    });

    input.value = '';
    estadoSel.value = 'none';
    bolsasInput.value = '0';

    window.suReRenderNotas();
};

// Canal de carga cross-vista: usa sessionStorage (no persiste entre sesiones)
async function cargarLoteDesdeBiblioteca() {
    const loteIndex = sessionStorage.getItem('su_lote_a_cargar'); // BUG-6 fix: sessionStorage
    if (loteIndex !== null) {
        const index = parseInt(loteIndex);
        sessionStorage.removeItem('su_lote_a_cargar');
        if (lotesData[index]) {
            cargarDatosLote(lotesData[index]);
        }
    }
}

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

    // Calculadora SU - Inputs principales
    document.getElementById('suFibra').addEventListener('input', calcularSU);
    document.getElementById('suRatio').addEventListener('input', calcularSU);
    document.getElementById('suAguaInput').addEventListener('input', calcularSU);
    
    // Producción
    document.getElementById('suModo').addEventListener('change', cambiarModoProduccion);
    document.getElementById('suBolsas').addEventListener('input', calcularProduccion);
    document.getElementById('suPesoBolsa').addEventListener('input', calcularProduccion);
    
    // Guardar lote
    document.getElementById('btnGuardar').addEventListener('click', guardarLote);
    
    // Nuevo lote
    document.getElementById('btnNuevoLote').addEventListener('click', nuevoLote);
    
    // Cargar lote
    document.getElementById('loteSelector').addEventListener('change', cargarLoteSeleccionado);
    
    // Exportar
    document.getElementById('btnExportJson').addEventListener('click', exportarJSON);
    document.getElementById('btnExportExcel').addEventListener('click', exportarExcel);
    
    // Importar (solo si existe el input)
    const btnImportJson = document.getElementById('btnImportJson');
    if (btnImportJson) {
        btnImportJson.addEventListener('change', importarJSON);
    }

    // Exportar / Importar — copias del panel Config (mismos handlers que arriba)
    const btnExportJsonCfg = document.getElementById('btnExportJsonCfg');
    if (btnExportJsonCfg) {
        btnExportJsonCfg.addEventListener('click', exportarJSON);
    }
    const btnExportExcelCfg = document.getElementById('btnExportExcelCfg');
    if (btnExportExcelCfg) {
        btnExportExcelCfg.addEventListener('click', exportarExcel);
    }
    const btnImportJsonCfg = document.getElementById('btnImportJsonCfg');
    if (btnImportJsonCfg) {
        btnImportJsonCfg.addEventListener('change', importarJSON);
    }

    // Auto-generar ID al cambiar la fecha (solo si es lote nuevo, sin _uuid)
    const loteIdEl = document.getElementById('loteId');
    const loteFechaEl = document.getElementById('loteFecha');
    if (loteFechaEl && loteIdEl) {
        loteFechaEl.addEventListener('change', function() {
            var uuid = loteIdEl.dataset.suUuid || '';
            if (!uuid) {
                loteIdEl.value = suGenerarId(this.value);
            }
        });
    }
    if (loteIdEl) {
        loteIdEl.setAttribute('readonly', 'readonly');
        loteIdEl.title = 'El ID se genera automáticamente al seleccionar la fecha';
    }
}

// ==========================================
// CÁLCULOS PRINCIPALES
// ==========================================

function calcularSU() {
    const fibra = parseFloat(document.getElementById('suFibra').value) || 0;
    const ratio = parseFloat(document.getElementById('suRatio').value) || 0;
    const aguaInput = parseFloat(document.getElementById('suAguaInput').value) || 0;
    
    // Determinar modo de cálculo
    const modo = document.getElementById('suModo').value;
    
    let agua = 0;
    let pesoAgua = 0;
    let total = 0;
    let hyd = 0;
    
    if (fibra > 0 && ratio > 0) {
        // Modo Normal: FIBRA × RATIO = AGUA
        agua = fibra * ratio;
    } else if (fibra > 0 && aguaInput > 0) {
        // Modo inverso: usar valor de agua manual
        agua = aguaInput;
    }
    
    // Peso del agua (95% de densidad)
    pesoAgua = agua * 0.95;
    
    // Obtener aditivos
    const aditivos = obtenerTotalAditivos();
    
    // Total
    total = fibra + pesoAgua + aditivos;
    
    // Hyd %
    hyd = fibra > 0 ? (agua / fibra) * 100 : 0;
    
    // Actualizar campos
    if (fibra > 0 && ratio > 0) {
        document.getElementById('suAguaInput').value = agua.toFixed(1);
    }
    
    document.getElementById('suPesoAgua').value = pesoAgua.toFixed(1);
    document.getElementById('suTotal').value = total.toFixed(1);
    document.getElementById('suHyd').textContent = hyd.toFixed(1);
    
    // Actualizar métricas
    actualizarMetricas();
    
    // Actualizar barra de composición
    actualizarBarraComposicion(fibra, pesoAgua, aditivos);
    
    // Calcular producción
    calcularProduccion();
}

function calcularProduccion() {
    const modo = document.getElementById('suModo').value;
    const total = parseFloat(document.getElementById('suTotal').value) || 0;
    const bolsas = parseInt(document.getElementById('suBolsas').value) || 0;
    const pesoBolsa = parseFloat(document.getElementById('suPesoBolsa').value) || 0;
    const fibra = parseFloat(document.getElementById('suFibra').value) || 0;
    
    const resultadoDiv = document.getElementById('suProdResultado');
    
    if (total === 0) {
        resultadoDiv.innerHTML = '<span style="color:var(--text-muted)">Ingrese sustrato seco y ratio para calcular</span>';
        return;
    }
    
    let html = '';
    
    if (modo === 'normal') {
        // Modo normal: defino cantidad de bolsas
        const pesoPorBolsa = bolsas > 0 ? (total / bolsas).toFixed(1) : 0;
        html = `
            <div>Total preparado: <strong>${total.toFixed(1)}g</strong></div>
            <div>Bolsas: <strong>${bolsas}</strong></div>
            <div>Peso por bolsa: <strong class="destacado">${pesoPorBolsa}g</strong></div>
        `;
    } else {
        // Modo inverso: defino peso por bolsa
        const bolsasNecesarias = pesoBolsa > 0 ? Math.ceil(total / pesoBolsa) : 0;
        const sobrante = pesoBolsa > 0 ? (total % pesoBolsa).toFixed(1) : 0;
        html = `
            <div>Total preparado: <strong>${total.toFixed(1)}g</strong></div>
            <div>Peso solicitado: <strong>${pesoBolsa}g</strong> por bolsa</div>
            <div>Bolsas necesarias: <strong class="destacado">${bolsasNecesarias}</strong></div>
            ${sobrante > 0 ? `<div>Resto: <strong>${sobrante}g</strong></div>` : ''}
        `;
    }
    
    resultadoDiv.innerHTML = html;
}

function cambiarModoProduccion() {
    const modo = document.getElementById('suModo').value;
    const divBolsas = document.getElementById('divBolsas');
    const divPesoBolsa = document.getElementById('divPesoBolsa');
    
    if (modo === 'normal') {
        divBolsas.style.display = 'block';
        divPesoBolsa.style.display = 'none';
    } else {
        divBolsas.style.display = 'none';
        divPesoBolsa.style.display = 'block';
    }
    
    calcularProduccion();
}

function obtenerTotalAditivos() {
    let total = 0;
    document.querySelectorAll('.aditivo-row').forEach(row => {
        const cantidad = parseFloat(row.querySelector('.aditivo-cant').value) || 0;
        total += cantidad;
    });
    return total;
}

function actualizarBarraComposicion(fibra, pesoAgua, aditivos) {
    const total = fibra + pesoAgua + aditivos;
    const barra = document.getElementById('compositionBar');
    
    if (total === 0) {
        barra.innerHTML = '<div class="composition-segment empty">Sin datos</div>';
        return;
    }
    
    const pctFibra = (fibra / total) * 100;
    const pctAgua = (pesoAgua / total) * 100;
    const pctAditivos = (aditivos / total) * 100;
    
    let html = '';
    
    if (pctFibra > 5) {
        html += `<div class="composition-segment fibra" style="width:${pctFibra}%" title="Fibra: ${fibra.toFixed(1)}g (${pctFibra.toFixed(1)}%)">${pctFibra.toFixed(0)}%</div>`;
    }
    if (pctAgua > 5) {
        html += `<div class="composition-segment agua" style="width:${pctAgua}%" title="Agua: ${pesoAgua.toFixed(1)}g (${pctAgua.toFixed(1)}%)">${pctAgua.toFixed(0)}%</div>`;
    }
    if (pctAditivos > 1) {
        html += `<div class="composition-segment aditivos" style="width:${pctAditivos}%" title="Aditivos: ${aditivos.toFixed(1)}g (${pctAditivos.toFixed(1)}%)">${pctAditivos.toFixed(0)}%</div>`;
    }
    
    barra.innerHTML = html;
}

function actualizarMetricas() {
    const fibra = parseFloat(document.getElementById('suFibra').value) || 0;
    const agua = parseFloat(document.getElementById('suAguaInput').value) || 0;
    const pesoAgua = parseFloat(document.getElementById('suPesoAgua').value) || 0;
    const total = parseFloat(document.getElementById('suTotal').value) || 0;
    const hyd = parseFloat(document.getElementById('suHyd').textContent) || 0;
    const aditivos = obtenerTotalAditivos();
    
    const modo = document.getElementById('suModo').value;
    const bolsas = parseInt(document.getElementById('suBolsas').value) || 0;
    const pesoBolsa = parseFloat(document.getElementById('suPesoBolsa').value) || 0;
    
    let cantBolsas = 0;
    let pesoXBolsa = 0;
    
    if (total > 0) {
        if (modo === 'normal' && bolsas > 0) {
            pesoXBolsa = total / bolsas;
        } else if (modo === 'inverso' && pesoBolsa > 0) {
            cantBolsas = Math.ceil(total / pesoBolsa);
            pesoXBolsa = pesoBolsa;
        }
    }
    
    // Actualizar panel de métricas
    document.getElementById('metricFibra').textContent = fibra.toFixed(1);
    document.getElementById('metricAgua').textContent = agua.toFixed(1);
    document.getElementById('metricPesoAgua').textContent = pesoAgua.toFixed(1);
    document.getElementById('metricAditivos').textContent = aditivos.toFixed(1);
    document.getElementById('metricTotal').textContent = total.toFixed(1);
    document.getElementById('metricHyd').textContent = hyd.toFixed(1);
    document.getElementById('metricBolsas').textContent = modo === 'normal' ? bolsas : (modo === 'inverso' ? cantBolsas : 0);
    document.getElementById('metricPesoBolsa').textContent = pesoXBolsa.toFixed(1);

    // Actualizar panel de RESULTADOS (#suRe)
    var elReFibra = document.getElementById('suReFibra');
    if (elReFibra) elReFibra.textContent = fibra.toFixed(1);
    var elReAgua = document.getElementById('suReAgua');
    if (elReAgua) elReAgua.textContent = agua.toFixed(1);
    var elReTotal = document.getElementById('suReTotal');
    if (elReTotal) elReTotal.textContent = total.toFixed(1);
    var elReHyd = document.getElementById('suReHyd');
    if (elReHyd) elReHyd.textContent = hyd.toFixed(1);
    var elReBolsas = document.getElementById('suReBolsas');
    if (elReBolsas) elReBolsas.textContent = modo === 'normal' ? bolsas : cantBolsas;
    var elRePesoBolsa = document.getElementById('suRePesoBolsa');
    if (elRePesoBolsa) elRePesoBolsa.textContent = pesoXBolsa.toFixed(1);
    var elReAditivos = document.getElementById('suReAditivos');
    if (elReAditivos) elReAditivos.textContent = aditivos.toFixed(1);
}

// ==========================================
// BIBLIOTECA DE MATERIALES
// ==========================================

// Migración one-shot: dedup de su_biblioteca.materiales (dos generaciones de catálogo
// superpuestas por nombre: legacy MAT-01..07 vs actual ING-SU-001..018) + agrega
// rangoOptimo/rangoSeguro (null default) a cada material. Prerequisito MEJ-0006.
// Solo corre si el catálogo ya tiene al menos un ING-SU-* (si no, no hay nada que
// deduplicar todavía — evita vaciar el catálogo en una instalación sin ese set).
var SU_MIG_BIBLIOTECA_DEDUP_KEY = 'biolab_migracion_su_biblioteca_dedup_v1';

function _suMigrarBibliotecaDedup(bib) {
    try {
        if (localStorage.getItem(SU_MIG_BIBLIOTECA_DEDUP_KEY) === '1') return false;
    } catch (e) { return false; }

    var materiales = bib.materiales || [];
    var tieneING = materiales.some(function(m) { return m.id && m.id.indexOf('ING-SU-') === 0; });
    var cambiado = false;

    if (tieneING) {
        var nombresING = {};
        materiales.forEach(function(m) {
            if (m.id && m.id.indexOf('ING-SU-') === 0 && m.nombre) nombresING[m.nombre] = true;
        });
        var antes = materiales.length;
        materiales = materiales.filter(function(m) {
            var esLegacyDuplicado = m.id && m.id.indexOf('MAT-') === 0 && m.nombre && nombresING[m.nombre];
            return !esLegacyDuplicado;
        });
        if (materiales.length !== antes) {
            cambiado = true;
            console.log('[SU] Migración dedup biblioteca: ' + (antes - materiales.length) + ' materiales legacy duplicados eliminados');
        }
    }

    var camposAgregados = false;
    materiales.forEach(function(m) {
        if (!('rangoOptimo' in m)) { m.rangoOptimo = null; camposAgregados = true; }
        if (!('rangoSeguro' in m)) { m.rangoSeguro = null; camposAgregados = true; }
    });
    if (camposAgregados) {
        cambiado = true;
        console.log('[SU] Migración dedup biblioteca: campos rangoOptimo/rangoSeguro agregados');
    }

    bib.materiales = materiales;
    return cambiado;
    // NOTE: sin try/catch propio alrededor de la mutación — si algo tira (ej. entrada
    // null/undefined en materiales), el caller decide qué significa "falló" para el flag.
}

function cargarBibliotecaDesdeStorage() {
    const stored = localStorage.getItem(SU_BIBLIOTECA_KEY);
    if (stored) {
        biblioteca = JSON.parse(stored);
    } else {
        biblioteca = { ...bibliotecaDefault };
        guardarBiblioteca();
    }
    var seEjecuto = false;
    try {
        seEjecuto = localStorage.getItem(SU_MIG_BIBLIOTECA_DEDUP_KEY) !== '1';
    } catch (e) { seEjecuto = false; }
    if (seEjecuto) {
        try {
            _suMigrarBibliotecaDedup(biblioteca);
            guardarBiblioteca();
            localStorage.setItem(SU_MIG_BIBLIOTECA_DEDUP_KEY, '1');
        } catch (e) {
            console.error('[SU] Error en migración dedup biblioteca, se reintentará en la próxima carga:', e);
        }
    }
}

function guardarBiblioteca() {
    localStorage.setItem(SU_BIBLIOTECA_KEY, JSON.stringify(biblioteca));
}

// ==========================================
// GESTIÓN DE LOTES
// ==========================================

function cargarLotesDesdeStorage() {
    const stored = localStorage.getItem(SU_STORAGE_KEY);
    if (stored) {
        lotesData = JSON.parse(stored);
    }
    // Migración silenciosa: asignar _uuid a registros históricos sin él
    if (_suMigrarUUIDs(lotesData)) {
        localStorage.setItem(SU_STORAGE_KEY, JSON.stringify(lotesData));
    }
    actualizarSelectorLotes();
}

function guardarEnStorage() {
    localStorage.setItem(SU_STORAGE_KEY, JSON.stringify(lotesData));
    try { if (typeof window.suRecomputeGrUsadosPush === 'function') window.suRecomputeGrUsadosPush(); } catch (e) {}
    actualizarSelectorLotes();
}

function actualizarSelectorLotes() {
    const selector = document.getElementById('loteSelector');
    selector.innerHTML = '<option value="">-- Nuevo registro --</option>';
    
    lotesData.forEach((lote, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = `${lote.id} - ${lote.fecha} - ${lote.estructura}`;
        selector.appendChild(option);
    });
}

function guardarLote() {
    const lote = recolectarDatosLote();

    if (!lote.id) {
        alert('Ingrese un ID para el registro');
        return;
    }

    // Validar integridad de filas de inoculación:
    // cada fuente GR con protocolo asignado DEBE tener tanda GR.
    // Sin tanda no hay inoculación concreta y FR no puede crear bolsas.
    const filasInvalidas = (lote.db || []).filter(function(r) {
        // Nuevo formato: validar cada source dentro de grSources[]
        // También detecta sources con protocolo pero sin tanda (campo _grSourcesInvalidas de suDbCollect)
        if (Array.isArray(r._grSourcesInvalidas) && r._grSourcesInvalidas.length > 0) return true;
        if (Array.isArray(r.grSources) && r.grSources.length > 0) {
            return r.grSources.some(function(s) { return s.grLoteId && !s.grTandaId; });
        }
        // Formato legacy: campo flat
        return r.grLoteId && !r.grTandaId;
    });
    if (filasInvalidas.length > 0) {
        var detalle = filasInvalidas.map(function(r, i) {
            return '  · Fila ' + (i + 1) + ': protocolo GR asignado sin tanda seleccionada';
        }).join('\n');
        alert('No se puede guardar: las siguientes filas tienen protocolo GR pero no tienen tanda seleccionada:\n\n' + detalle + '\n\nSeleccioná una tanda GR en cada fila antes de guardar.');
        return;
    }

    // Buscar por _uuid primero (identidad estable), luego por id (fallback histórico)
    let indiceExistente = -1;
    if (lote._uuid) {
        indiceExistente = lotesData.findIndex(l => l._uuid === lote._uuid);
    }
    if (indiceExistente < 0) {
        indiceExistente = lotesData.findIndex(l => l.id === lote.id);
    }

    if (indiceExistente >= 0) {
        const idAnterior = lotesData[indiceExistente].id;
        const uuidAnterior = lotesData[indiceExistente]._uuid;

        // Detectar conflicto de ID: el nuevo ID ya existe en OTRO registro
        const conflictoId = lote.id !== idAnterior &&
            lotesData.some((l, i) => i !== indiceExistente && l.id === lote.id);
        if (conflictoId) {
            alert('El ID "' + lote.id + '" ya existe en otro registro. Elegí uno distinto.');
            return;
        }

        // Preservar _uuid original (nunca cambia)
        lote._uuid = uuidAnterior || lote._uuid || _suGenUUID();

        // Si el ID cambió, propagar el rename a fr_bolsas en localStorage
        if (idAnterior && lote.id && idAnterior !== lote.id) {
            _suPropagarRenameFR(uuidAnterior || lote._uuid, idAnterior, lote.id);
        }

        lotesData[indiceExistente] = lote;
    } else {
        // Lote nuevo: asignar _uuid definitivo
        lote._uuid = lote._uuid || _suGenUUID();

        // ID duplicado en lote nuevo = error siempre. El sistema genera IDs únicos por diseño.
        if (lotesData.some(l => l.id === lote.id)) {
            alert('El ID "' + lote.id + '" ya existe. Cambiá la fecha para obtener un nuevo ID.');
            return;
        }

        lotesData.push(lote);
    }

    // Actualizar dataset del formulario con el _uuid definitivo
    const loteIdEl = document.getElementById('loteId');
    if (loteIdEl) loteIdEl.dataset.suUuid = lote._uuid;

    // Eliminar campo temporal de validación antes de persistir en storage.
    // _grSourcesInvalidas es un artefacto en memoria de suDbCollect(), nunca debe grabarse.
    (lote.db || []).forEach(function(r) { delete r._grSourcesInvalidas; });
    guardarEnStorage();
    renderizarRegistroLotes();

    // ==========================================
    // HOOK FR (fructificación por bolsa)
    // ==========================================
    // Si el módulo FR está cargado y expone createFromSU, emitir el evento.
    // FR se encargará de explotar el registro SU en N registros (uno por bolsa).
    // NO se implementa lógica FR aquí: solo el hook.
    try {
        if (window.FR && typeof window.FR.createFromSU === 'function') {
            window.FR.createFromSU(lote);
        }
        // Evento genérico para quien escuche (FR futuro, dashboards, etc.)
        window.dispatchEvent(new CustomEvent('su-lote-guardado', { detail: lote }));
    } catch (e) { console.warn('Hook FR falló (no crítico):', e); }

    alert('Registro guardado correctamente');
}

function recolectarDatosLote() {
    const fibra = parseFloat(document.getElementById('suFibra').value) || 0;
    const ratio = parseFloat(document.getElementById('suRatio').value) || 0;
    const agua = parseFloat(document.getElementById('suAguaInput').value) || 0;
    const pesoAgua = parseFloat(document.getElementById('suPesoAgua').value) || 0;
    const total = parseFloat(document.getElementById('suTotal').value) || 0;
    const hyd = parseFloat(document.getElementById('suHyd').textContent) || 0;
    const modo = document.getElementById('suModo').value;
    const bolsas = parseInt(document.getElementById('suBolsas').value) || 0;
    const pesoBolsa = parseFloat(document.getElementById('suPesoBolsa').value) || 0;
    
    // Recolectar aditivos — value del select es el id de catálogo; el nombre se lee
    // del data-nombre de la opción seleccionada (se preserva incluso si el id quedó
    // huérfano por un material borrado del catálogo, ver agregarFilaAditivo).
    const aditivos = [];
    document.querySelectorAll('.aditivo-row').forEach(row => {
        const select = row.querySelector('.aditivo-select');
        const id = select.value;
        const opt = select.options[select.selectedIndex];
        const nombre = opt ? (opt.dataset.nombre || '') : '';
        const cantidad = parseFloat(row.querySelector('.aditivo-cant').value) || 0;
        if (nombre && cantidad > 0) {
            aditivos.push(id ? { id, nombre, cantidad } : { nombre, cantidad });
        }
    });
    
    // Recuperar _uuid del lote actualmente cargado (guardado en dataset del formulario)
    const _uuidActual = (document.getElementById('loteId').dataset.suUuid) || null;

    return {
        _uuid: _uuidActual,  // null en lotes nuevos; se asigna definitivamente en guardarLote()
        id: document.getElementById('loteId').value,
        fecha: document.getElementById('loteFecha').value,
        estructura: document.getElementById('loteEstructura').value,
        fibra,
        ratio,
        agua,
        pesoAgua,
        total,
        hyd,
        modo,
        bolsas,
        pesoBolsa,
        aditivos,
        pesoXBolsa: bolsas > 0 ? parseFloat((total / bolsas).toFixed(1)) : pesoBolsa,
        reNotas: SU.reNotas,
        grProtocolo: (function() {
            // Compatibilidad histórica: guardar el primer lote GR usado en las filas.
            // La fuente de verdad real es grLoteId por fila en el array db.
            var first = document.querySelector('#dbTableBody .db-row .db-lote-select');
            return first ? (first.value || '') : '';
        }()),
        db: (typeof window.suDbCollect === 'function' ? window.suDbCollect() : []),
        dbSeguimiento: ((window.SU && Array.isArray(SU.dbSeguimientoNotas)) ? SU.dbSeguimientoNotas.slice() : [])
    };
}

function nuevoLote() {
    _suLoteCargado = false;
    const loteIdEl = document.getElementById('loteId');
    loteIdEl.dataset.suUuid = '';
    loteIdEl.setAttribute('readonly', 'readonly');
    loteIdEl.title = 'El ID se genera automáticamente al seleccionar la fecha';
    document.getElementById('loteEstructura').value = '';

    SU.reNotas = [];
    window.suReRenderNotas();

    document.getElementById('suFibra').value = 0;
    document.getElementById('suRatio').value = 0;
    document.getElementById('suAguaInput').value = '';
    document.getElementById('suPesoAgua').value = '';
    document.getElementById('suTotal').value = '';
    document.getElementById('suBolsas').value = 0;
    document.getElementById('suPesoBolsa').value = 0;
    document.getElementById('suModo').value = 'normal';

    const aditivosContainer = document.getElementById('aditivosContainer');
    aditivosContainer.innerHTML = '';
    agregarFilaAditivo();

    // Establecer fecha actual y auto-generar ID desde ella
    const hoy = new Date().toISOString().split('T')[0];
    const loteFechaEl = document.getElementById('loteFecha');
    if (loteFechaEl) loteFechaEl.value = hoy;
    loteIdEl.value = suGenerarId(hoy);

    document.getElementById('loteSelector').value = '';

    if (typeof window.suDbReset === 'function') window.suDbReset();

    calcularSU();
}

function cargarLoteSeleccionado() {
    const selector = document.getElementById('loteSelector');
    const index = selector.value;
    
    if (index === '') return;
    
    const lote = lotesData[index];
    if (!lote) return;
    
    cargarDatosLote(lote);
}

function cargarDatosLote(lote) {
    _suLoteCargado = true;
    const loteIdEl = document.getElementById('loteId');
    loteIdEl.value = lote.id || '';
    loteIdEl.dataset.suUuid = lote._uuid || '';
    // Registro existente: _uuid protege la identidad, el ID se puede editar (renombrar)
    loteIdEl.removeAttribute('readonly');
    loteIdEl.title = 'Podés editar el ID — la identidad del registro está protegida por su UUID interno';
    document.getElementById('loteFecha').value = lote.fecha || '';
    document.getElementById('loteEstructura').value = lote.estructura || '';
    // loteSteril / loteNotas eliminados del UI (valores se preservan en el modelo si existían)
    
    document.getElementById('suFibra').value = lote.fibra || 0;
    document.getElementById('suRatio').value = lote.ratio || 0;
    document.getElementById('suModo').value = lote.modo || 'normal';
    document.getElementById('suBolsas').value = lote.bolsas || 0;
    document.getElementById('suPesoBolsa').value = lote.pesoBolsa || 0;
    
    // Cargar aditivos
    const aditivosContainer = document.getElementById('aditivosContainer');
    aditivosContainer.innerHTML = '';

    if (lote.aditivos && lote.aditivos.length > 0) {
        lote.aditivos.forEach(aditivo => {
            agregarFilaAditivo(aditivo.id, aditivo.cantidad, aditivo.nombre);
        });
    } else {
        agregarFilaAditivo();
    }

    // Cargar notas de seguimiento
    SU.reNotas = lote.reNotas || [];
    window.suReRenderNotas();

    // Cambiar modo
    cambiarModoProduccion();

    // Cargar DB - Distribución de Bolsas
    if (typeof window.suDbLoadFromLote === 'function') {
        window.suDbLoadFromLote(lote);
    }

    // Recalcular
    if (_suCalcTimer) clearTimeout(_suCalcTimer);
    _suCalcTimer = setTimeout(calcularSU, 100);

}

/**
 * Calcula métricas de cultivo para un lote SU.
 * Retorna: {
 *   bolsas, frascosUsados, pesoSustrato, pesoGrano,
 *   sustPorBolsa, granoPorBolsa,
 *   ratioSG (string "N:1"),
 *   inoculacionPct,   // peso_grano / peso_sustrato × 100
 *   hidratacionPct,
 *   bolsasPorFrasco, frascosPorBolsa,
 *   genetica: { 'nombre': {bolsas, frascos} },
 *   spawnRate         // frascos / (kg sustrato)
 * }
 */
function suCalcularMetricasLote(lote) {
    var bolsas = parseInt(lote.bolsas) || 0;
    var pesoSustrato = parseFloat(lote.total) || 0;
    var hidratacion = parseFloat(lote.hyd) || 0;
    var db = Array.isArray(lote.db) ? lote.db : [];

    // Traer lotes GR para calcular peso por frasco (masaSeca / frascos)
    var grMap = {};
    try {
        var raw = localStorage.getItem(SU_GR_STORAGE); // BUG-1 fix: usar constante, no string literal
        var arr = raw ? (JSON.parse(raw) || []) : [];
        arr.forEach(function(l) { grMap[l.id] = l; });
    } catch (e) {}

    var frascosUsados = 0;
    var bolsasDB = 0;
    var pesoGrano = 0;
    var genetica = {};

    db.forEach(function(r) {
        var bo = parseInt(r.bolsas) || 0;
        bolsasDB += bo;

        // ── Peso de grano por bolsa: pesoGranoReal (manual) > teórico GR ──────
        // Si la tanda tiene pesoGranoReal > 0, esa es la fuente de verdad y se
        // aplica directamente sin consultar GR. De lo contrario se calcula desde
        // los frascos usados × peso por frasco del lote GR (comportamiento original).
        var _pgrOverride = parseFloat(r.pesoGranoReal) || 0;
        if (_pgrOverride > 0) {
            // Override manual: peso total de grano para esta tanda = pesoGranoReal × bolsas
            pesoGrano += _pgrOverride * bo;
            // Fuentes siguen aportando frascosUsados para el conteo, pero no pesoGrano
            var sources0 = suDbNormSources(r, lote.grProtocolo || '');
            sources0.forEach(function(s) {
                frascosUsados += parseInt(s.grUsados) || 0;
                // Genética: buscar en GR aunque no usemos el peso
                var grL0 = grMap[s.grLoteId || ''];
                if (grL0 && Array.isArray(grL0.dg)) {
                    for (var k0 = 0; k0 < grL0.dg.length; k0++) {
                        if (grL0.dg[k0].tanda === s.grTandaId && grL0.dg[k0].genetica) {
                            var ng0 = grL0.dg[k0].genetica;
                            if (!genetica[ng0]) genetica[ng0] = { bolsas: 0, frascos: 0 };
                            genetica[ng0].bolsas += bo;
                            genetica[ng0].frascos += parseInt(s.grUsados) || 0;
                            break;
                        }
                    }
                }
            });
            return; // pasar a la siguiente tanda
        }

        // Normalizar fuentes: soporta grSources[] (nuevo) y campos flat (histórico)
        var sources = suDbNormSources(r, lote.grProtocolo || '');

        sources.forEach(function(s) {
            var us = parseInt(s.grUsados) || 0;
            frascosUsados += us;

            // Peso por frasco: priorizar GR.lote.fr.pesoFrasco, fallback masaSeca/frascos
            var grL = grMap[s.grLoteId || lote.grProtocolo || ''];
            var nombreGen = '';
            var pesoFrasco = 0;
            if (grL) {
                var gPf = parseFloat(grL.fr && grL.fr.pesoFrasco) || 0;
                if (gPf > 0) pesoFrasco = gPf;
                if (Array.isArray(grL.dg)) {
                    for (var i = 0; i < grL.dg.length; i++) {
                        var t = grL.dg[i];
                        if (t.tanda === s.grTandaId) {
                            nombreGen = t.genetica || '';
                            if (pesoFrasco <= 0) {
                                var ms = parseFloat(t.masaSeca) || 0;
                                var fr = parseInt(t.frascos) || 0;
                                if (fr > 0 && ms > 0) pesoFrasco = ms / fr;
                            }
                            break;
                        }
                    }
                }
            }
            pesoGrano += us * pesoFrasco;

            // Acumular por genética (asignando bolsas de la fila a cada fuente)
            if (nombreGen) {
                if (!genetica[nombreGen]) genetica[nombreGen] = { bolsas: 0, frascos: 0 };
                genetica[nombreGen].bolsas += bo;
                genetica[nombreGen].frascos += us;
            }
        });
    });

    var bolsasUsadas = bolsas > 0 ? bolsas : bolsasDB;

    // ── Peso efectivo por bolsa ──────────────────────────────────────────────
    // Si al menos una tanda tiene pesoReal > 0, se usa promedio ponderado
    // de pesos reales (fuente de verdad manual).
    // Las tandas sin pesoReal usan el peso teórico (pesoSustrato / bolsasUsadas).
    // Si ninguna tanda tiene pesoReal → peso teórico puro.
    var pesoTeoricoPorBolsa = bolsasUsadas > 0 ? (pesoSustrato / bolsasUsadas) : 0;
    var _sumPesoReal = 0, _sumBolsasConPeso = 0;
    db.forEach(function(r) {
        var _bo = parseInt(r.bolsas) || 0;
        var _pr = parseFloat(r.pesoReal) || 0;
        var _pw = _pr > 0 ? _pr : pesoTeoricoPorBolsa;
        _sumPesoReal     += _pw * _bo;
        _sumBolsasConPeso += _bo;
    });
    var sustPorBolsa = (_sumBolsasConPeso > 0)
        ? (_sumPesoReal / _sumBolsasConPeso)
        : pesoTeoricoPorBolsa;

    var granoPorBolsa = bolsasUsadas > 0 ? (pesoGrano / bolsasUsadas) : 0;
    // Calcular desde pesos GR si están disponibles; si no, usar ratio guardado en el lote.
    var ratioSGCalc = (pesoGrano > 0 && pesoSustrato > 0) ? (pesoSustrato / pesoGrano) : 0;
    var ratioSG = ratioSGCalc > 0 ? ratioSGCalc : (parseFloat(lote.ratio) || 0);
    var inocPctCalc = (pesoSustrato > 0 && pesoGrano > 0) ? (pesoGrano / pesoSustrato * 100) : 0;
    var inocPct = inocPctCalc > 0 ? inocPctCalc : (ratioSG > 0 ? parseFloat((100 / ratioSG).toFixed(2)) : 0);
    var bolsasPorFrasco = frascosUsados > 0 ? (bolsasDB / frascosUsados) : 0;
    var frascosPorBolsa = bolsasDB > 0 ? (frascosUsados / bolsasDB) : 0;
    var spawnRate = pesoSustrato > 0 ? (frascosUsados / (pesoSustrato / 1000)) : 0;

    return {
        bolsas: bolsasUsadas,
        frascosUsados: frascosUsados,
        pesoSustrato: pesoSustrato,
        pesoGrano: pesoGrano,
        sustPorBolsa: sustPorBolsa,          // efectivo: promedio ponderado real/teórico
        sustPorBolsaTeorico: pesoTeoricoPorBolsa, // siempre teórico (total / bolsas)
        tieneWeightOverride: db.some(function(r) { return parseFloat(r.pesoReal) > 0; }),
        tieneGranoOverride:  db.some(function(r) { return parseFloat(r.pesoGranoReal) > 0; }),
        granoPorBolsa: granoPorBolsa,
        ratioSG: ratioSG,
        inoculacionPct: inocPct,
        hidratacionPct: hidratacion,
        bolsasPorFrasco: bolsasPorFrasco,
        frascosPorBolsa: frascosPorBolsa,
        genetica: genetica,
        spawnRate: spawnRate
    };
}
// Exponer por si otro módulo quiere consumirlo
window.suCalcularMetricasLote = suCalcularMetricasLote;

// Abreviaciones de especie para display — no modifica storage
function _abbrevGen(s) {
    return s ? s.replace(/Psilocybe cubensis/gi, 'PC') : s;
}

function suFmt(n, dec) {
    if (n == null || isNaN(n)) return '—';
    var d = (dec == null) ? 1 : dec;
    return Number(n).toFixed(d);
}
function suRatioStr(r) {
    if (!r || isNaN(r) || r <= 0) return '—';
    return suFmt(r, 1) + ':1';
}
// Formato de fecha DD/MM/YYYY. Acepta ISO (YYYY-MM-DD) o Date.
function suFormatFecha(iso) {
    if (!iso) return '-';
    try {
        // Si ya viene 'YYYY-MM-DD' hacemos split directo (evita problemas de timezone)
        if (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}/.test(iso)) {
            var p = iso.substring(0, 10).split('-');
            return p[2] + '/' + p[1] + '/' + p[0];
        }
        var d = new Date(iso);
        if (isNaN(d.getTime())) return String(iso);
        var dd = String(d.getDate()).padStart(2, '0');
        var mm = String(d.getMonth() + 1).padStart(2, '0');
        var yy = d.getFullYear();
        return dd + '/' + mm + '/' + yy;
    } catch (e) { return String(iso); }
}
window.suFormatFecha = suFormatFecha;
// Letra alfabética: 0→a, 1→b, ... 25→z, 26→aa, ...

function renderizarRegistroLotes() {
    const container = document.getElementById('registroLotesBody');
    const noLotesMsg = document.getElementById('noLotesMsg');
    if (!container || !noLotesMsg) return;

    if (lotesData.length === 0) {
        container.innerHTML = '';
        noLotesMsg.style.display = 'block';
        _suRenderKpiBar([]);
        return;
    }

    noLotesMsg.style.display = 'none';

    // Orden por fecha desc (default) o por BE agregado del lote (mejor primero).
    // Lotes sin dato de BE utilizable van siempre al final en los modos beProm/beMejor.
    var lotesOrdenados;
    if (_suRegSortMode === 'beProm' || _suRegSortMode === 'beMejor') {
        var beField = _suRegSortMode === 'beProm' ? 'beProm' : 'beMejor';
        lotesOrdenados = [...lotesData].sort(function(a, b) {
            var sa = _suLoteBEStats(a), sb = _suLoteBEStats(b);
            if (!sa && !sb) return 0;
            if (!sa) return 1;
            if (!sb) return -1;
            return sb[beField] - sa[beField];
        });
    } else {
        lotesOrdenados = [...lotesData].sort(function(a, b) {
            var va = a.fecha || '', vb = b.fecha || '';
            return vb < va ? -1 : vb > va ? 1 : 0;
        });
    }

    // Mapa GR para genética en sub-filas
    var grMap = {};
    try {
        var raw = localStorage.getItem(SU_GR_STORAGE);
        var arr = raw ? (JSON.parse(raw) || []) : [];
        arr.forEach(function(l) { grMap[l.id] = l; });
    } catch (e) {}

    _suRenderKpiBar(lotesData);

    const subHeaderHtml = `
        <div class="su-sub-header">
            <span>FR ID</span>
            <span>TANDA</span>
            <span>GENÉTICA</span>
            <span>SU SECO</span>
            <span>HIDRATA&shy;CIÓN</span>
            <span>BOLSAS</span>
            <span>FRASCOS</span>
            <span>SU HIDRA&shy;TADO</span>
            <span>GRANO</span>
            <span>RATIO</span>
        </div>`;

    container.innerHTML = subHeaderHtml + lotesOrdenados.map(function(lote) {
        const realIndex = lotesData.indexOf(lote);
        const m = suCalcularMetricasLote(lote);
        const db = Array.isArray(lote.db) ? lote.db : [];
        const fechaFmt = suFormatFecha(lote.fecha);
        const loteId = lote.id || '-';
        const frMap = _suGetFRMap(lote);
        const tandaCount = db.length;

        // Cabecera de card
        const cardHead = modoEdicionRegistros ? `
            <div class="su-card-head su-card-head-edit">
                <input type="date" class="su-edit-cell" data-field="fecha" data-idx="${realIndex}" value="${lote.fecha || ''}" style="width:130px;font-size:12px">
                <input type="text" class="su-edit-cell" data-field="id" data-idx="${realIndex}" value="${loteId}" style="width:110px;font-weight:700;font-size:12px">
                <span class="su-card-spacer"></span>
                <button class="btn-small" style="background:var(--primary);color:white" onclick="event.stopPropagation(); cargarRegistro(${realIndex})">📂</button>
                <button class="btn-small" style="background:var(--danger);color:white" onclick="event.stopPropagation(); eliminarRegistro(${realIndex})">✕</button>
            </div>` : `
            <div class="su-card-head" onclick="suCargarRegistroYVolver(${realIndex})" title="Click para cargar en Formulación" style="cursor:pointer">
                <span class="su-card-id">${loteId}</span>
                <span class="su-card-date">${fechaFmt}</span>
                <span class="su-card-spacer"></span>
                <span class="su-card-count">${m.bolsas} bolsas · ${tandaCount} tanda${tandaCount !== 1 ? 's' : ''}${m.tieneWeightOverride ? ' · <span style="color:var(--primary,#4da6ff);font-size:0.82em" title="Pesos reales registrados">✎ peso real</span>' : ''}</span>
            </div>`;

        // Vars de lote para barra de métricas por tanda
        var _fibraLote  = parseFloat(lote.fibra)  || 0;
        var _totalLote  = parseFloat(lote.total)  || 0;
        var _bolsasLote = m.bolsas || 1;
        var _sustSecoPerBolsa    = (_fibraLote > 0 && _bolsasLote > 0) ? _fibraLote / _bolsasLote : 0;
        var _hydCoef             = (_fibraLote > 0 && _totalLote > _fibraLote) ? _totalLote / _fibraLote : 0;
        var _hidTeoricoPerBolsa  = (_totalLote > 0 && _bolsasLote > 0) ? _totalLote / _bolsasLote : 0;

        // Sub-filas
        const subs = db.map(function(r, i) {
            var normSrcs = suDbNormSources(r, lote.grProtocolo || '');
            var us = 0, pesoGranoSub = 0, grTxtParts = [];
            normSrcs.forEach(function(s) {
                var _us = parseInt(s.grUsados) || 0;
                us += _us;
                var _grL = grMap[s.grLoteId || ''];
                var _pf = 0, _gen = '';
                if (_grL) {
                    _pf = parseFloat(_grL.uf && _grL.uf.peso_unidad) || parseFloat(_grL.fr && _grL.fr.pesoFrasco) || 0;
                    if (Array.isArray(_grL.dg)) {
                        for (var k = 0; k < _grL.dg.length; k++) {
                            if (_grL.dg[k].tanda === s.grTandaId) { _gen = _grL.dg[k].genetica || ''; break; }
                        }
                    }
                }
                pesoGranoSub += _us * _pf;
                grTxtParts.push(s.grTandaId + (_gen ? ' — ' + _abbrevGen(_gen) : ''));
            });
            if (normSrcs.length === 0) us = parseInt(r.grUsados) || 0;
            var grTxt = grTxtParts.length > 0 ? grTxtParts.join(' + ') : '';
            var bo = parseInt(r.bolsas) || 0;
            var subId = r.tanda || (loteId + '-' + (i + 1));
            var di = 'data-idx="' + realIndex + '" data-dbidx="' + i + '"';
            var pesoSustSub = bo * m.sustPorBolsa;
            var inocSub = pesoSustSub > 0 ? (pesoGranoSub / pesoSustSub * 100) : 0;
            var inocSubCls = inocSub > 0 ? (inocSub >= 2 && inocSub <= 10 ? 'su-kchip-ok' : 'su-kchip-warn') : 'su-kchip-dim';
            var inocSubLbl = inocSub > 0 ? suFmt(inocSub, 1) + '%' : '—';

            var frB = frMap[i];
            var frBadge = frB
                ? (frB.id
                    ? `<span class="su-kchip su-kchip-fr" onclick="suNavToFR('${frB.id}')" style="cursor:pointer" title="Ver en módulo FR">🍄${frB.id}</span>`
                    : `<span class="su-kchip su-kchip-pending">⏳ PENDIENTE</span>`)
                : `<span class="su-kchip su-kchip-dim">—</span>`;

            // Estado de Eficiencia Biológica (BE) de la bolsa vinculada — solo lectura de
            // fr_bolsas, no se calcula ni persiste nada nuevo acá. _suBolsaBE reusa
            // beOleada/pesoHumedo ya calculados y guardados por FR por cada cosecha.
            var beRowHtml = '';
            if (frB) {
                var flushesFr = Array.isArray(frB.flushes) ? frB.flushes : [];
                if (flushesFr.length > 0) {
                    var beStats = _suBolsaBE(frB);
                    if (beStats) {
                        var beCls = beStats.beTotal >= 150 ? 'su-be-dot--good' : (beStats.beTotal >= 100 ? 'su-be-dot--warn' : 'su-be-dot--bad');
                        // Desglose por oleada — el total acumulado solo no dice si fue una
                        // bolsa fuerte de entrada o varias oleadas flojas que sumaron parecido.
                        var oleadasTxt = flushesFr.map(function(f, fi) {
                            return 'F' + (f.n || (fi + 1)) + ' ' + (parseFloat(f.beOleada) || 0).toFixed(0) + '%';
                        }).join(' · ');
                        beRowHtml = `
                <div class="su-be-row">
                    <span class="su-be-dot ${beCls}"></span>
                    <span class="su-be-label">BE ${beStats.beTotal.toFixed(0)}% total (${oleadasTxt})</span>
                </div>`;
                    }
                } else if (frB.fechaInicio) {
                    var diasSinFR = (Date.now() - new Date(frB.fechaInicio).getTime()) / 86400000;
                    if (diasSinFR >= 60) {
                        beRowHtml = `
                <div class="su-be-row su-be-danger">
                    <span class="su-be-danger-dots"><span></span><span></span><span></span></span>
                    <span class="su-be-label">Sin registro FR desde hace ${Math.floor(diasSinFR)} días — ¿bolsa abandonada?</span>
                </div>`;
                    }
                }
            }

            if (modoEdicionRegistros) {
                return `
                    <div class="su-card-sub su-card-sub-edit">
                        <span class="su-sub-arrow">↳</span>
                        <input type="text" class="su-edit-db" ${di} data-dbfield="tanda"
                            value="${r.tanda || ''}" placeholder="ID tanda" style="width:90px;font-size:11px" title="ID tanda">
                        <input type="number" class="su-edit-db" ${di} data-dbfield="bolsas"
                            value="${bo}" min="0" style="width:50px;font-size:11px" title="Bolsas">
                        <input type="text" class="su-edit-db" ${di} data-dbfield="grTandaId"
                            value="${r.grTandaId || ''}" placeholder="Tanda GR" style="width:75px;font-size:11px" title="Tanda GR">
                        <input type="text" class="su-edit-db" ${di} data-dbfield="grLoteId"
                            value="${r.grLoteId || lote.grProtocolo || ''}" placeholder="Lote GR" style="width:75px;font-size:11px" title="Lote GR">
                        <input type="number" class="su-edit-db" ${di} data-dbfield="grUsados"
                            value="${us}" min="0" style="width:45px;font-size:11px" title="Frascos">
                        <button class="btn-small" style="background:var(--danger);color:white;margin-left:auto"
                            onclick="event.stopPropagation(); suEliminarSubfila(${realIndex}, ${i})">✕</button>
                    </div>`;
            }

            // Métricas por tanda
            var pesoRealSub      = parseFloat(r.pesoReal)      || 0;
            var pesoGranoRealSub = parseFloat(r.pesoGranoReal) || 0;

            // Hidratado/bolsa: real > teórico
            var hidBolsaReal  = pesoRealSub > 0;
            var hidBolsaVal   = hidBolsaReal ? pesoRealSub
                                : (_hidTeoricoPerBolsa > 0 ? _hidTeoricoPerBolsa : 0);
            var hidBolsaTxt   = hidBolsaVal > 0 ? '🧱 ' + hidBolsaVal.toFixed(0) + ' g' : '—';

            // Grano/bolsa: real > teórico (pesoGranoSub ya incluye frascos×peso)
            var granoRealFlag = pesoGranoRealSub > 0;
            var granoTeoBolsa = bo > 0 && pesoGranoSub > 0 ? pesoGranoSub / bo : 0;
            var granoVal      = granoRealFlag ? pesoGranoRealSub
                                : (granoTeoBolsa > 0 ? granoTeoBolsa : 0);
            var granoTxt      = granoVal > 0 ? '🌾 ' + granoVal.toFixed(0) + ' g' : '—';

            // Sustrato seco por tanda (lote fibra proporcional a bolsas de esta tanda)
            var sustTandaVal  = bo > 0 && _sustSecoPerBolsa > 0 ? _sustSecoPerBolsa : 0;
            var sustTxt       = sustTandaVal > 0 ? sustTandaVal.toFixed(0) + ' g' : '—';

            // Coeficiente de hidratación (lote-level)
            var hydTxt = _hydCoef > 0 ? _hydCoef.toFixed(2) + '×' : '—';

            // Ratio sustrato hidratado : grano hidratado → formato 1:X
            var ratioVal = hidBolsaVal > 0 && granoVal > 0 ? granoVal / hidBolsaVal : 0;
            var ratioTxt = ratioVal > 0 ? '1:' + ratioVal.toFixed(2) : '—';

            return `
                <div class="su-card-sub">
                    <span>${frBadge}</span>
                    <span class="su-sub-tid">${subId}</span>
                    <span class="su-sub-gen">${grTxt}</span>
                    <span class="su-sub-col">${sustTxt}</span>
                    <span class="su-sub-col">${hydTxt}</span>
                    <span class="su-sub-col">${bo}</span>
                    <span class="su-sub-col">${us}</span>
                    <span class="su-sub-col${hidBolsaReal ? ' su-sub-real' : ''}">${hidBolsaTxt}${hidBolsaReal ? '<sup class="su-sub-edit">✎</sup>' : ''}</span>
                    <span class="su-sub-col${granoRealFlag ? ' su-sub-real' : ''}">${granoTxt}${granoRealFlag ? '<sup class="su-sub-edit">✎</sup>' : ''}</span>
                    <span class="su-sub-col">${ratioTxt}</span>
                </div>${beRowHtml}`;
        }).join('');

        const addSubBtn = modoEdicionRegistros ? `
            <div style="padding:6px 14px 8px 28px">
                <button class="btn-small" style="background:var(--dark);border:1px dashed var(--border);color:var(--text-muted)"
                    onclick="suAgregarSubfila(${realIndex})">+ sub-fila</button>
            </div>` : '';

        return `<div class="su-reg-card">${cardHead}${subs}${addSubBtn}</div>`;
    }).join('');
}

function _suRenderKpiBar(lotes) {
    const bar = document.getElementById('suRegKpiBar');
    if (!bar) return;
    if (!lotes.length) { bar.style.display = 'none'; return; }
    bar.style.display = 'grid';

    var totalBolsas = 0, totalFrascos = 0, totalFibraSeca = 0, totalTandas = 0;
    var sumHid = 0, cntHid = 0;
    var sumExpansion = 0, cntExpansion = 0;
    lotes.forEach(function(l) {
        var m = suCalcularMetricasLote(l);
        totalBolsas  += m.bolsas;
        totalFrascos += m.frascosUsados;
        totalTandas  += Array.isArray(l.db) ? l.db.length : 0;
        var _fibra = parseFloat(l.fibra) || 0;
        var _total = parseFloat(l.total) || 0;
        if (_fibra > 0) {
            totalFibraSeca += _fibra;
            if (_total > _fibra) { sumExpansion += _total / _fibra; cntExpansion++; }
        }
        if (m.hidratacionPct > 0) { sumHid += m.hidratacionPct; cntHid++; }
    });
    var avgHid       = cntHid       > 0 ? sumHid       / cntHid       : 0;
    var avgExpansion = cntExpansion > 0 ? sumExpansion / cntExpansion : 0;
    var fibraKg = totalFibraSeca >= 1000
        ? suFmt(totalFibraSeca / 1000, 2) + ' kg'
        : (totalFibraSeca > 0 ? suFmt(totalFibraSeca, 0) + ' g' : '—');

    bar.innerHTML = `
        <div class="su-kpi">
            <span class="su-kpi-label">Total bolsas</span>
            <span class="su-kpi-val">${totalBolsas}</span>
            <span class="su-kpi-sub">en ${lotes.length} lote${lotes.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="su-kpi">
            <span class="su-kpi-label">Sustrato seco</span>
            <span class="su-kpi-val">${fibraKg}</span>
            <span class="su-kpi-sub">sustrato seco total</span>
        </div>
        <div class="su-kpi">
            <span class="su-kpi-label">Expansión prom.</span>
            <span class="su-kpi-val">${avgExpansion > 0 ? suFmt(avgExpansion, 2) + '×' : '—'}</span>
            <span class="su-kpi-sub">húmedo / seco</span>
        </div>
        <div class="su-kpi">
            <span class="su-kpi-label">Retenc. hídrica</span>
            <span class="su-kpi-val">${avgHid > 0 ? suFmt(avgHid, 0) + '%' : '—'}</span>
            <span class="su-kpi-sub">agua / sustrato seco</span>
        </div>
        <div class="su-kpi">
            <span class="su-kpi-label">Frascos GR</span>
            <span class="su-kpi-val">${totalFrascos}</span>
            <span class="su-kpi-sub">en ${totalTandas} tanda${totalTandas !== 1 ? 's' : ''}</span>
        </div>
        <div class="su-kpi">
            <span class="su-kpi-label">Tandas</span>
            <span class="su-kpi-val">${totalTandas}</span>
            <span class="su-kpi-sub">en ${lotes.length} lote${lotes.length !== 1 ? 's' : ''}</span>
        </div>`;
}


function cargarLoteDesdeRegistro(index) {
    if (lotesData[index]) {
        cargarDatosLote(lotesData[index]);
        document.getElementById('loteSelector').value = index;
    }
}

function eliminarLoteDesdeRegistro(index) {
    const lote = lotesData[index];
    if (!lote) return;
    
    if (!confirm(`¿Eliminar el registro "${lote.id}"?`)) return;
    
    lotesData.splice(index, 1);
    // Limpiar campo temporal antes de persistir
    guardarEnStorage();
    renderizarRegistroLotes();
    nuevoLote();
    alert('Registro eliminado');
}

// ==========================================
// ADITIVOS
// ==========================================

function agregarFilaAditivo(id = '', cantidad = 0, nombreLegacy = '') {
    const container = document.getElementById('aditivosContainer');
    const row = document.createElement('div');
    row.className = 'aditivo-row';

    const matchExiste = biblioteca.materiales.some(m => m.id === id);

    const opciones = biblioteca.materiales
        .filter(m => m.tipo === 'aditivo' || m.tipo === 'nutricion')
        .map(m => `<option value="${m.id}" data-nombre="${cfgEscapeHtml(m.nombre)}" ${m.id === id ? 'selected' : ''}>${cfgEscapeHtml(m.nombre)}</option>`)
        .join('');

    // Referencia rota: el id no matchea nada del catálogo actual pero hay un nombre legacy
    // (dato histórico pre-migración, o material borrado del catálogo después de guardarse).
    // Se muestra como opción huérfana para no perder el dato al re-guardar el lote.
    const opcionHuerfana = (!matchExiste && nombreLegacy)
        ? `<option value="" data-nombre="${cfgEscapeHtml(nombreLegacy)}" selected>${cfgEscapeHtml(nombreLegacy)} (no en catálogo)</option>`
        : '';

    row.innerHTML = `
        <select class="aditivo-select" onchange="calcularSU()">
            <option value="">-- Seleccionar --</option>
            ${opcionHuerfana}
            ${opciones}
        </select>
        <input type="number" class="aditivo-cant" value="${cantidad}" min="0" step="0.1" placeholder="g" oninput="calcularSU()">
        <button type="button" class="btn-remove" onclick="this.parentElement.remove(); calcularSU()">✕</button>
    `;

    container.appendChild(row);
}

// ==========================================
// EXPORTAR / IMPORTAR
// ==========================================

function exportarJSON() {
    const lote = recolectarDatosLote();

    if (!lote.id) {
        alert('Guarde el registro primero antes de exportar');
        return;
    }

    // Exportar TODOS los registros + biblioteca (no solo el lote activo).
    // El importarJSON ya acepta este formato { materiales, registros }.
    const todosLosLotes = JSON.parse(localStorage.getItem(SU_STORAGE_KEY) || '[]');
    const exportData = {
        version: '1.0',
        fechaExportacion: new Date().toISOString().slice(0, 10),
        materiales: biblioteca.materiales || [],
        registros: todosLosLotes
    };

    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `su-backup-completo-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function exportarExcel() {
    const lote = recolectarDatosLote();
    
    if (!lote.id) {
        alert('Guarde el registro primero antes de exportar');
        return;
    }
    
    if (typeof XLSX === 'undefined') {
        alert('Biblioteca Excel no cargada');
        return;
    }
    
    const wb = XLSX.utils.book_new();
    const fecha = lote.fecha || new Date().toISOString().split('T')[0];
    
    // Hoja RESUMEN
    const resumenData = [
        ['REGISTRO DE SUSTRATO'],
        ['ID:', lote.id],
        ['Fecha:', fecha],
        ['Estructura:', lote.estructura],
        ['Sterilización:', lote.steril + ' min'],
        [],
        ['CÁLCULOS'],
        ['Fibra (g)', lote.fibra],
        ['Ratio', lote.ratio],
        ['Agua (ml)', lote.agua],
        ['Peso Agua (g)', lote.pesoAgua],
        ['Aditivos (g)', lote.aditivos.reduce((s, a) => s + a.cantidad, 0)],
        ['Total (g)', lote.total],
        ['Hyd %', lote.hyd],
        ['Bolsas', lote.bolsas],
        ['Peso/Bolsa (g)', lote.pesoXBolsa],
        [],
        ['Notas:', lote.notas]
    ];
    
    const wsResumen = XLSX.utils.aoa_to_sheet(resumenData);
    XLSX.utils.book_append_sheet(wb, wsResumen, 'RESUMEN');
    
    // Hoja ADITIVOS
    if (lote.aditivos.length > 0) {
        const aditivosData = [['ADITIVOS'], ['Nombre', 'Cantidad (g)']];
        lote.aditivos.forEach(a => {
            aditivosData.push([a.nombre, a.cantidad]);
        });
        const wsAditivos = XLSX.utils.aoa_to_sheet(aditivosData);
        XLSX.utils.book_append_sheet(wb, wsAditivos, 'ADITIVOS');
    }
    
    XLSX.writeFile(wb, `sustrato_${lote.id}_${fecha}.xlsx`);
}

function importarJSON(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            
            // Verificar si es formato completo (materiales + registros) o un solo registro
            if (data.materiales && data.registros) {
                // Formato completo - importar materiales
                let nuevosMat = 0;
                if (Array.isArray(data.materiales)) {
                    data.materiales.forEach(mat => {
                        const existe = biblioteca.materiales.some(m => m.id === mat.id);
                        if (!existe) {
                            biblioteca.materiales.push(mat);
                            nuevosMat++;
                        }
                    });
                    guardarBiblioteca();
                }

                // Importar registros
                let nuevosReg = 0;
                if (Array.isArray(data.registros)) {
                    data.registros.forEach(registro => {
                        const existe = lotesData.some(l => l.id === registro.id);
                        if (!existe) {
                            lotesData.push(registro);
                            nuevosReg++;
                        }
                    });
                    // Limpiar campo temporal antes de persistir
    guardarEnStorage();
                    renderizarRegistroLotes();
                }
                
                alert('Importación completada:\n- Materiales: ' + nuevosMat + '\n- Registros: ' + nuevosReg);
            } else if (data.id) {
                // Formato de un solo registro
                const existe = lotesData.some(l => l.id === data.id);
                
                if (!existe) {
                    lotesData.push(data);
                    // Limpiar campo temporal antes de persistir
    guardarEnStorage();
                    renderizarRegistroLotes();
                    cargarDatosLote(data);
                    alert('Registro importado correctamente');
                } else {
                    alert('El registro ya existe');
                }
            } else {
                alert('Archivo JSON inválido');
            }
            
            event.target.value = '';
        } catch (err) {
            alert('Error al parsear el archivo');
            console.error(err);
        }
    };
    reader.readAsText(file);
}

function importarExcel(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (typeof XLSX === 'undefined') {
        alert('Biblioteca Excel no cargada');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
            
            // Buscar ID del lote
            let loteData = { id: '', fecha: '', estructura: '', steril: 90, fibra: 0, ratio: 0, agua: 0, pesoAgua: 0, total: 0, hyd: 0, aditivos: [], notas: '' };
            
            jsonData.forEach(row => {
                if (row[0] === 'ID:') loteData.id = row[1];
                if (row[0] === 'Fecha:') loteData.fecha = row[1];
                if (row[0] === 'Estructura:') loteData.estructura = row[1];
                if (row[0] === 'Sterilización:') loteData.steril = parseInt(row[1]) || 90;
                if (row[0] === 'Fibra (g)') loteData.fibra = parseFloat(row[1]) || 0;
                if (row[0] === 'Ratio') loteData.ratio = parseFloat(row[1]) || 0;
                if (row[0] === 'Notas:') loteData.notas = row[1] || '';
            });
            
            if (loteData.id) {
                const existe = lotesData.some(l => l.id === loteData.id);
                
                if (!existe) {
                    // Recalcular valores derivados
                    loteData.agua = loteData.fibra * loteData.ratio;
                    loteData.pesoAgua = loteData.agua * 0.95;
                    loteData.total = loteData.fibra + loteData.pesoAgua;
                    loteData.hyd = loteData.fibra > 0 ? (loteData.agua / loteData.fibra) * 100 : 0;
                    loteData.bolsas = 0;
                    loteData.pesoBolsa = 0;
                    loteData.modo = 'normal';
                    
                    lotesData.push(loteData);
                    // Limpiar campo temporal antes de persistir
    guardarEnStorage();
                    renderizarRegistroLotes();
                    cargarDatosLote(loteData);
                    alert('Registro importado correctamente');
                } else {
                    alert('El registro ya existe');
                }
            } else {
                alert('No se pudo extraer información del Excel');
            }
            
            event.target.value = '';
        } catch (err) {
            alert('Error al leer el archivo Excel');
            console.error(err);
        }
    };
    reader.readAsArrayBuffer(file);
}

// ==========================================
// UTILIDADES
// ==========================================

function establecerFechaActual() {
    const hoy = new Date().toISOString().split('T')[0];
    document.getElementById('loteFecha').value = hoy;
}

// ==========================================
// GENERAR ID — formato SU{dia}{mes}[b/c/...]
// ==========================================
// Ejemplos: SU164 (día 16, mes 4) → si ya existe → SU164b → SU164c
// El primer registro del día no lleva sufijo. Los siguientes llevan b, c, d...

function suGenerarId(fecha) {
    var d;
    if (fecha instanceof Date) {
        d = fecha;
    } else if (typeof fecha === 'string' && fecha) {
        var parts = fecha.split('-');
        d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    } else {
        return '';
    }

    var dia = d.getDate();
    var mes = d.getMonth() + 1;
    var base = 'SU' + dia + mes;

    // lotesData ya está normalizado (sin guiones) por la migración en cargarLotesDesdeStorage.
    // Buscar el primer candidato que no colisione.
    if (!lotesData.some(function(l) { return l.id === base; })) return base;

    // Sufijos: b, c, d, ... z, aa, ab, ... (a implícito para el primero sin sufijo)
    var ids = lotesData.map(function(l) { return l.id || ''; });
    var intento = 1; // 1 → 'b', 2 → 'c', ...
    var candidato;
    do {
        var letra = '';
        var n = intento - 1;
        do {
            letra = String.fromCharCode(98 + (n % 26)) + letra;
            n = Math.floor(n / 26) - 1;
        } while (n >= 0);
        candidato = base + letra;
        intento++;
    } while (ids.indexOf(candidato) >= 0);

    return candidato;
}

// ==========================================
// IMPORTACIÓN DESDE ARCHIVOS JSON LOCALES
// ==========================================

function importarMaterialesDesdeJSON() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = function(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = function(evt) {
            try {
                const data = JSON.parse(evt.target.result);
                if (Array.isArray(data) && data.length > 0) {
                    // Agregar materiales (evitar duplicados por ID)
                    data.forEach(mat => {
                        const existe = biblioteca.materiales.some(m => m.id === mat.id);
                        if (!existe) {
                            biblioteca.materiales.push(mat);
                        }
                    });
                    guardarBiblioteca();
                    alert('Materiales importados: ' + data.length);
                }
            } catch(err) {
                alert('Error al parsear archivo');
                console.error(err);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

function importarRegistrosDesdeJSON() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = function(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = function(evt) {
            try {
                const data = JSON.parse(evt.target.result);
                if (Array.isArray(data) && data.length > 0) {
                    // Agregar registros (evitar duplicados por _uuid o id)
                    let nuevos = 0;
                    data.forEach(registro => {
                        // Asignar _uuid si no tiene (datos históricos)
                        if (!registro._uuid) registro._uuid = _suGenUUID();
                        const existe = lotesData.some(function(l) {
                            return (l._uuid && l._uuid === registro._uuid) || l.id === registro.id;
                        });
                        if (!existe) {
                            lotesData.push(registro);
                            nuevos++;
                        }
                    });
                    // Limpiar campo temporal antes de persistir
    guardarEnStorage();
                    renderizarRegistroLotes();
                    alert('Registros importados: ' + nuevos);
                }
            } catch(err) {
                alert('Error al parsear archivo');
                console.error(err);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

// ==========================================
// EDICIÓN DE REGISTROS EN INDEX.HTML
// ==========================================

let modoEdicionRegistros = false;

function toggleEdicionRegistros() {
    // Si estábamos en modo edición, persistir los cambios antes de salir
    if (modoEdicionRegistros) {
        var conflicto = false;
        var idsSeen = {};

        // Recolectar inputs editados y aplicarlos a lotesData
        document.querySelectorAll('#registroLotesBody .su-edit-cell').forEach(function(input) {
            var idx = parseInt(input.dataset.idx);
            var field = input.dataset.field;
            if (isNaN(idx) || !field || !lotesData[idx]) return;

            var val = input.value.trim();

            // Validar cambio de ID: no puede quedar vacío ni duplicado
            if (field === 'id') {
                if (!val) {
                    input.style.outline = '2px solid var(--danger)';
                    conflicto = true;
                    return;
                }
                var original = lotesData[idx].id;
                if (val !== original) {
                    // Detectar duplicado contra otros lotes (no contra sí mismo)
                    var duplicado = lotesData.some(function(l, i) { return i !== idx && l.id === val; });
                    if (duplicado) {
                        alert('El ID "' + val + '" ya existe en otro registro. Elegí uno distinto.');
                        input.style.outline = '2px solid var(--danger)';
                        conflicto = true;
                        return;
                    }
                    // Propagar rename a FR antes de cambiar el ID en memoria
                    var uuid = lotesData[idx]._uuid;
                    if (uuid) _suPropagarRenameFR(uuid, original, val);
                }
            }

            lotesData[idx][field] = val;
        });

        // Recolectar ediciones de sub-filas (lote.db[])
        document.querySelectorAll('#registroLotesBody .su-edit-db').forEach(function(input) {
            var idx = parseInt(input.dataset.idx);
            var dbidx = parseInt(input.dataset.dbidx);
            var dbfield = input.dataset.dbfield;
            if (isNaN(idx) || isNaN(dbidx) || !dbfield) return;
            if (!lotesData[idx] || !Array.isArray(lotesData[idx].db)) return;
            if (!lotesData[idx].db[dbidx]) return;

            var val = input.value.trim();

            // Campo "bolsas": el badge FR de las cards (frMap[i] en renderizarRegistroLotes,
            // vía _suGetFRMap) solo coincide con FR cuando TODAS las filas tienen bolsas:1.
            // Si el lote ya tiene bolsas FR vinculadas y se cambia "bolsas" a algo distinto
            // de 1 en una fila existente, avisar antes de aplicar el cambio.
            if (dbfield === 'bolsas') {
                var nuevoValorBolsas = parseInt(val) || 0;
                var valorActualBolsas = lotesData[idx].db[dbidx].bolsas;
                if (nuevoValorBolsas !== valorActualBolsas && nuevoValorBolsas !== 1) {
                    var frMapCheck = _suGetFRMap(lotesData[idx]);
                    if (Object.keys(frMapCheck).length > 0) {
                        var msgBolsas = 'Este lote ya tiene bolsas FR vinculadas (fue enviado a Fructificación).\n\n' +
                            'Cambiar "bolsas" a un valor distinto de 1 en una fila existente puede desalinear ' +
                            'la insignia FR mostrada en esta fila y en todas las filas siguientes del mismo lote.\n\n' +
                            '¿Confirmás el cambio de todos modos?';
                        if (!confirm(msgBolsas)) {
                            return; // cancelado: no se aplica el cambio de bolsas en esta fila
                        }
                    }
                }
                lotesData[idx].db[dbidx][dbfield] = nuevoValorBolsas;
            } else if (dbfield === 'grUsados') {
                lotesData[idx].db[dbidx][dbfield] = parseInt(val) || 0;
            } else {
                lotesData[idx].db[dbidx][dbfield] = val;
            }
        });

        if (conflicto) return; // no salir del modo edición si hay errores

        // Limpiar campo temporal antes de persistir
    guardarEnStorage();
        actualizarSelectorLotes();
    }

    modoEdicionRegistros = !modoEdicionRegistros;
    const btnEdit = document.getElementById('btnEditRegistros');
    if (btnEdit) {
        if (modoEdicionRegistros) {
            btnEdit.textContent = '💾 Save';
            btnEdit.classList.remove('btn-secondary');
            btnEdit.classList.add('btn-su');
        } else {
            btnEdit.textContent = '✏️ Edit';
            btnEdit.classList.remove('btn-su');
            btnEdit.classList.add('btn-secondary');
        }
    }

    renderizarRegistroLotes();
}

function cargarRegistro(index) {
    if (!lotesData[index]) return;
    
    if (!confirm('Cargar el registro "' + lotesData[index].id + '"?')) return;
    
    cargarDatosLote(lotesData[index]);
    alert('Registro cargado: ' + lotesData[index].id);
}

function eliminarRegistro(index) {
    if (!lotesData[index]) return;

    if (!confirm('¿Eliminar el registro "' + lotesData[index].id + '"?')) return;

    lotesData.splice(index, 1);
    // Limpiar campo temporal antes de persistir
    guardarEnStorage();
    renderizarRegistroLotes();
    alert('Registro eliminado');
}

// Elimina una sub-fila (db[dbidx]) de un lote en modo edición inline.
// Opera directamente sobre lotesData y persiste inmediatamente.
function suEliminarSubfila(loteIdx, dbidx) {
    var lote = lotesData[loteIdx];
    if (!lote || !Array.isArray(lote.db)) return;
    if (!confirm('¿Eliminar esta sub-fila?')) return;
    lote.db.splice(dbidx, 1);
    // Limpiar campo temporal antes de persistir
    guardarEnStorage();
    renderizarRegistroLotes();
}

// Agrega una sub-fila vacía a lote.db[] en modo edición inline.
function suAgregarSubfila(loteIdx) {
    var lote = lotesData[loteIdx];
    if (!lote) return;
    if (!Array.isArray(lote.db)) lote.db = [];
    lote.db.push({
        tanda: '',
        bolsas: 1,
        grano: '',
        grLoteId: lote.grProtocolo || '',
        grTandaId: '',
        grUsados: 0
    });
    // Limpiar campo temporal antes de persistir
    guardarEnStorage();
    renderizarRegistroLotes();
}

// ==========================================
// SUB-TAB SWITCHER (Main <-> Config)
// ==========================================

window.SU = window.SU || {};
window.SU.subTab = window.suSubTab = function suSubTab(t) {
    var tabs = document.querySelectorAll('.su-subtab');
    tabs.forEach(function(tb) { tb.classList.remove('active'); });

    var active = document.querySelector('.su-subtab[data-subtab="' + t + '"]');
    if (active) active.classList.add('active');

    var pMain = document.getElementById('su-sub-main');
    var pReg  = document.getElementById('su-sub-reg');
    var pCfg  = document.getElementById('su-sub-cfg');

    if (pMain) {
        pMain.style.display = (t === 'main') ? 'flex' : 'none';
        if (t === 'main') pMain.classList.add('active'); else pMain.classList.remove('active');
    }

    if (pReg) {
        pReg.style.display = (t === 'reg') ? 'flex' : 'none';
        if (t === 'reg') pReg.classList.add('active'); else pReg.classList.remove('active');
    }

    if (pCfg) {
        pCfg.style.display = (t === 'cfg') ? 'flex' : 'none';
        if (t === 'cfg') pCfg.classList.add('active'); else pCfg.classList.remove('active');
    }

    if (t === 'reg') {
        try { renderizarRegistroLotes(); } catch (e) {}
    }

    if (t === 'cfg') {
        cfgRenderizarBiblioteca();
        cfgActualizarEstadisticas();
    }
};

// ==========================================
// CARGAR REGISTRO Y VOLVER A FORMULACIÓN
// ==========================================
// Al hacer click en una fila de Registros Guardados, carga los datos
// del lote y cambia automáticamente a la subpágina de Formulación.
window.suCargarRegistroYVolver = function suCargarRegistroYVolver(index) {
    try {
        if (typeof lotesData === 'undefined' || !Array.isArray(lotesData)) return;
        var lote = lotesData[index];
        if (!lote) return;
        if (typeof cargarDatosLote === 'function') {
            cargarDatosLote(lote);
        }
        if (typeof window.suSubTab === 'function') {
            window.suSubTab('main');
        }
        if (typeof mostrarNotificacion === 'function') {
            mostrarNotificacion('📂 Registro cargado: ' + (lote.id || lote.fecha || 'sin ID'), 'success');
        }
    } catch (e) {
        console.error('suCargarRegistroYVolver error:', e);
    }
};

// ==========================================
// CONFIG - EDICIÓN DE MATERIALES
// ==========================================

var cfgModoEdicionMateriales = false;

function cfgToggleEdicionMateriales() {
    cfgModoEdicionMateriales = !cfgModoEdicionMateriales;
    var btnEdit = document.getElementById('cfgBtnEditMat');
    var tablaMateriales = document.getElementById('cfgTablaMateriales');
    var colsAcciones = tablaMateriales ? tablaMateriales.querySelectorAll('.col-acciones') : [];

    if (btnEdit) {
        if (cfgModoEdicionMateriales) {
            btnEdit.textContent = '💾 Save';
            btnEdit.classList.remove('btn-secondary');
            btnEdit.classList.add('btn-su');
        } else {
            cfgGuardarCambiosMateriales();
            btnEdit.textContent = '✏️ Edit';
            btnEdit.classList.remove('btn-su');
            btnEdit.classList.add('btn-secondary');
        }

        colsAcciones.forEach(function(el) {
            if (cfgModoEdicionMateriales) {
                el.classList.add('visible');
            } else {
                el.classList.remove('visible');
            }
        });
    }

    cfgRenderizarBiblioteca();
}

function cfgGuardarCambiosMateriales() {
    var inputsAll = document.querySelectorAll('#cfgBibliotecaTable input, #cfgBibliotecaTable select');
    if (inputsAll.length === 0) return;

    var numCols = 9;
    var nuevosMateriales = [];
    for (var i = 0; i < inputsAll.length; i += numCols) {
        var idx = Math.floor(i / numCols);
        nuevosMateriales.push({
            id: biblioteca.materiales[idx] ? biblioteca.materiales[idx].id : 'ING-SU-' + String(idx + 1).padStart(3, '0'),
            nombre: inputsAll[i + 1].value,
            estado: inputsAll[i + 2].value,
            tipo: inputsAll[i + 3].value,
            unidad: inputsAll[i + 4].value,
            peso: parseFloat(inputsAll[i + 5].value) || 0,
            volumen: parseFloat(inputsAll[i + 6].value) || 0,
            densidad: parseFloat(inputsAll[i + 7].value) || 0,
            notas: inputsAll[i + 8].value,
            rangoOptimo: (biblioteca.materiales[idx] && biblioteca.materiales[idx].rangoOptimo != null) ? biblioteca.materiales[idx].rangoOptimo : null,
            rangoSeguro: (biblioteca.materiales[idx] && biblioteca.materiales[idx].rangoSeguro != null) ? biblioteca.materiales[idx].rangoSeguro : null
        });
    }

    biblioteca.materiales = nuevosMateriales;
    guardarBiblioteca();
    cfgActualizarEstadisticas();
    alert('Cambios guardados');
}

function cfgEliminarMaterial(index) {
    if (!confirm('¿Eliminar este material?')) return;
    biblioteca.materiales.splice(index, 1);
    guardarBiblioteca();
    cfgRenderizarBiblioteca();
    cfgActualizarEstadisticas();
}

function cfgEscapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cfgRenderizarBiblioteca() {
    var tbody = document.getElementById('cfgBibliotecaTable');
    var tablaMateriales = document.getElementById('cfgTablaMateriales');
    var colsAcciones = tablaMateriales ? tablaMateriales.querySelectorAll('.col-acciones') : [];

    if (!biblioteca.materiales.length) {
        colsAcciones.forEach(function(el) { el.classList.remove('visible'); });
        tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Sin materiales registrados</td></tr>';
        return;
    }

    colsAcciones.forEach(function(el) {
        if (cfgModoEdicionMateriales) {
            el.classList.add('visible');
        } else {
            el.classList.remove('visible');
        }
    });

    tbody.innerHTML = biblioteca.materiales.map(function(m, index) {
        if (cfgModoEdicionMateriales) {
            return '<tr>' +
                '<td><input type="text" class="edit-input" value="' + m.id + '" readonly style="background:var(--dark);width:80px"></td>' +
                '<td><input type="text" class="edit-input" value="' + cfgEscapeHtml(m.nombre) + '"></td>' +
                '<td><select class="edit-select"><option value="solido" ' + (m.estado === 'solido' ? 'selected' : '') + '>sólido</option><option value="liquido" ' + (m.estado === 'liquido' ? 'selected' : '') + '>líquido</option></select></td>' +
                '<td><select class="edit-select"><option value="estructura" ' + (m.tipo === 'estructura' ? 'selected' : '') + '>estructura</option><option value="base" ' + (m.tipo === 'base' ? 'selected' : '') + '>base</option><option value="nutricion" ' + (m.tipo === 'nutricion' ? 'selected' : '') + '>nutrición</option><option value="aditivo" ' + (m.tipo === 'aditivo' ? 'selected' : '') + '>aditivo</option></select></td>' +
                '<td><select class="edit-select"><option value="g" ' + (m.unidad === 'g' ? 'selected' : '') + '>g</option><option value="ml" ' + (m.unidad === 'ml' ? 'selected' : '') + '>ml</option></select></td>' +
                '<td><input type="number" class="edit-input" step="0.001" value="' + (m.peso || 0) + '"></td>' +
                '<td><input type="number" class="edit-input" step="0.001" value="' + (m.volumen || 0) + '"></td>' +
                '<td><input type="number" class="edit-input" step="0.001" value="' + (m.densidad || 0) + '"></td>' +
                '<td><input type="text" class="edit-input" value="' + cfgEscapeHtml(m.notas || '') + '"></td>' +
                '<td class="col-acciones"><button class="btn-delete-row" onclick="cfgEliminarMaterial(' + index + ')">✕</button></td>' +
            '</tr>';
        } else {
            return '<tr>' +
                '<td>' + m.id + '</td>' +
                '<td>' + cfgEscapeHtml(m.nombre) + '</td>' +
                '<td>' + m.estado + '</td>' +
                '<td>' + m.tipo + '</td>' +
                '<td>' + (m.unidad || '-') + '</td>' +
                '<td>' + (m.peso || '-') + '</td>' +
                '<td>' + (m.volumen || '-') + '</td>' +
                '<td>' + (m.densidad || '-') + '</td>' +
                '<td>' + (m.notas || '-') + '</td>' +
                '<td class="col-acciones" style="display:none"></td>' +
            '</tr>';
        }
    }).join('');
}

function cfgAgregarMaterial() {
    var nombre = document.getElementById('cfgMatNombre').value.trim();
    if (!nombre) {
        alert('Ingrese el nombre del material');
        return;
    }

    var nuevo = {
        id: 'ING-SU-' + String(biblioteca.materiales.length + 1).padStart(3, '0'),
        nombre: nombre,
        tipo: document.getElementById('cfgMatTipo').value,
        estado: document.getElementById('cfgMatEstado').value,
        unidad: document.getElementById('cfgMatUnidad').value,
        peso: parseFloat(document.getElementById('cfgMatPeso').value) || 0,
        volumen: parseFloat(document.getElementById('cfgMatVolumen').value) || 0,
        densidad: parseFloat(document.getElementById('cfgMatDensidad').value) || 0,
        notas: document.getElementById('cfgMatNotas').value.trim()
    };

    biblioteca.materiales.push(nuevo);
    guardarBiblioteca();
    cfgRenderizarBiblioteca();
    cfgActualizarEstadisticas();

    document.getElementById('cfgMatNombre').value = '';
    document.getElementById('cfgMatNotas').value = '';
    document.getElementById('cfgMatPeso').value = '';
    document.getElementById('cfgMatVolumen').value = '';
    document.getElementById('cfgMatDensidad').value = '';

    alert('Material agregado: ' + nuevo.id);
}

function cfgActualizarEstadisticas() {
    var total = biblioteca.materiales.length;
    var estructura = biblioteca.materiales.filter(function(m) { return m.tipo === 'estructura'; }).length;
    var nutricion = biblioteca.materiales.filter(function(m) { return m.tipo === 'nutricion'; }).length;

    var el = document.getElementById('cfgMetricTotalMateriales');
    if (el) el.textContent = total;

    el = document.getElementById('cfgMetricEstructura');
    if (el) el.textContent = estructura;

    el = document.getElementById('cfgMetricNutricion');
    if (el) el.textContent = nutricion;

    el = document.getElementById('cfgMetricRegistros');
    if (el) el.textContent = lotesData.length;
}

function cfgImportarDatos() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = function(e) {
        var file = e.target.files[0];
        if (!file) return;

        var reader = new FileReader();
        reader.onload = function(event) {
            try {
                var datos = JSON.parse(event.target.result);

                if (!datos.materiales && !Array.isArray(datos)) {
                    throw new Error('Formato JSON inválido. Use un archivo con formato: {"materiales": [...], "registros": [...]}');
                }

                var nuevosMat = 0;
                if (datos.materiales && Array.isArray(datos.materiales)) {
                    datos.materiales.forEach(function(mat) {
                        var existe = biblioteca.materiales.some(function(m) { return m.id === mat.id; });
                        if (!existe) {
                            biblioteca.materiales.push(mat);
                            nuevosMat++;
                        }
                    });
                }
                guardarBiblioteca();
                cfgRenderizarBiblioteca();

                var nuevosReg = 0;
                var registros = datos.registros || datos.records || (Array.isArray(datos) ? datos : []);
                if (Array.isArray(registros)) {
                    registros.forEach(function(registro) {
                        var existe = lotesData.some(function(l) { return l.id === registro.id; });
                        if (!existe) {
                            lotesData.push(registro);
                            nuevosReg++;
                        }
                    });
                }
                // Limpiar campo temporal antes de persistir
    guardarEnStorage();
                cfgActualizarEstadisticas();

                alert('Importación completada:\n- Materiales: ' + nuevosMat + '\n- Registros: ' + nuevosReg);

            } catch (error) {
                console.error('Error:', error);
                alert('Error al importar: ' + error.message);
            }
        };

        reader.readAsText(file);
    };

    input.click();
}

// ==========================================
// ==========================================================
// DB - DISTRIBUCIÓN DE BOLSAS
// ----------------------------------------------------------
// Replica funcional del módulo DG (GR) adaptado a bolsas SU.
// Namespace aislado: suDb* / SU.dbSeguimientoNotas
// No modifica calcularSU() ni calcularProduccion()
// ==========================================================

window.SU = window.SU || {};
SU.dbSeguimientoNotas = SU.dbSeguimientoNotas || [];

function suDbTimestamp() {
    var now = new Date();
    return now.toLocaleString('es-ES', {
        day: '2-digit', month: '2-digit', year: '2-digit',
        hour: '2-digit', minute: '2-digit'
    });
}

function suDbEscapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------
// suDbNormSources(row, grLoteDefault?)
//   Fuente canónica de lectura de fuentes GR de una fila db[].
//   Soporta tanto el nuevo formato grSources[] como los campos
//   legacy grLoteId/grTandaId/grUsados de registros históricos.
//   Retorna siempre un array — nunca null ni undefined.
// ---------------------------------------------------------------
function suDbNormSources(row, grLoteDefault) {
    // Delegado a shared/gr_su_sources.js (unificado 2026-07-10, ver ese archivo
    // para la implementación real — antes esta función tenía su propia copia
    // divergente de la de GR).
    if (window.GrSuSources && typeof window.GrSuSources.normalize === 'function') {
        return window.GrSuSources.normalize(row, grLoteDefault);
    }
    // Fallback defensivo si la lib compartida no cargó por algún motivo.
    console.warn('[SU] GrSuSources no disponible, usando fallback local');
    var lo = grLoteDefault || '';
    if (!row || typeof row !== 'object') return [];
    var loteId  = String(row.grLoteId || lo || '').trim() || null;
    var tandaId = String(row.grTandaId || row.grano || '').trim() || null;
    if (loteId && tandaId) return [{ grLoteId: loteId, grTandaId: tandaId, grUsados: parseInt(row.grUsados, 10) || 0 }];
    return [];
}
window.suDbNormSources = suDbNormSources;

// ---------------------------------------------------------------
// suDbGetSourcesFromRow(mainRow)
//   Lee las fuentes GR desde los .db-source-row divs dentro de
//   la celda .db-fuentes-cell del mainRow.
// ---------------------------------------------------------------
function suDbGetSourcesFromRow(mainRow) {
    if (!mainRow) return [];
    var sources = [];
    mainRow.querySelectorAll('.db-fuentes-cell .db-source-row').forEach(function(sr) {
        // Fallback al valor del select si el dataset aún no fue seteado por onchange
        var grLoteId  = (sr.dataset.grLote  || (sr.querySelector('.db-lote-select')  || {}).value || '').trim() || null;
        var grTandaId = (sr.dataset.grTanda || (sr.querySelector('.db-grano-select') || {}).value || '').trim() || null;
        var grUsados  = parseInt((sr.querySelector('.db-source-usados') || {}).value) || 0;
        sources.push({ grLoteId: grLoteId, grTandaId: grTandaId, grUsados: grUsados });
    });
    return sources;
}

// ---------------------------------------------------------------
// _suDbCreateSourceRow()
//   Crea y retorna un <tr class="db-source-row"> con el markup
//   estándar de una fuente GR (select lote, select tanda,
//   input frascos, chip disponibles, botón eliminar).
// ---------------------------------------------------------------
function _suDbCreateSourceRow() {
    var sr = document.createElement('div');
    sr.className = 'db-source-row';
    sr.innerHTML =
        '<div class="db-src-col db-src-col-protocolo">'
        +   '<span class="db-cell-label">Protocolo GR</span>'
        +   '<select class="db-lote-select" onchange="suDbOnChangeLoteSource(this)">'
        +       '<option value="">-- Protocolo --</option>'
        +   '</select>'
        + '</div>'
        + '<div class="db-src-col db-src-col-tanda">'
        +   '<span class="db-cell-label">Tanda GR</span>'
        +   '<select class="db-grano-select" onchange="suDbOnChangeGranoSource(this)">'
        +       '<option value="">-- Tanda --</option>'
        +   '</select>'
        + '</div>'
        + '<div class="db-src-col db-src-col-frascos">'
        +   '<span class="db-cell-label">Cant. Fr.</span>'
        +   '<input type="number" class="db-source-usados" value="0" min="0"'
        +       ' oninput="suDbOnChangeUsadosSource(this)"'
        +       ' title="Frascos usados">'
        + '</div>'
        + '<div class="db-src-col db-src-col-disp">'
        +   '<span class="db-cell-label">Dispon.</span>'
        +   '<span class="db-grano-disp" title="Disponibles en GR"></span>'
        + '</div>'
        + '<button type="button" class="db-source-remove" onclick="suDbRemoveSource(this)" title="Quitar fuente">✕</button>';
    return sr;
}

function suDbGetSuBolsas() {
    var el = document.getElementById('suBolsas');
    return el ? (parseFloat(el.value) || 0) : 0;
}

// ---------- GENERADOR DE IDs DE BOLSA ----------
//
// Esquema: {loteBase}{letra}
//   Lote SU234  → bolsas: 234a, 234b, 234c ... 234z, 234aa, 234ab ...
//   Lote SU234b → bolsas: 234ba, 234bb, 234bc ...
//
// loteBase = loteId sin prefijo "SU".
// Las letras son secuencia base-26 sin huecos: a, b ... z, aa, ab ... (estilo Excel).
//
// Unicidad global: busca colisiones en su_lotes (localStorage) + filas vivas del form actual.
// Retorna array de `cantidad` IDs consecutivos listos para usar.
//
function suDbGenerarTandaIds(cantidad) {
    if (cantidad <= 0) return [];

    // Base del lote: quitar prefijo "SU"
    // SU234 → "234" | SU234b → "234b"
    var loteId = (document.getElementById('loteId') || {}).value || '';
    var loteBase = loteId.replace(/^SU/, '') || 'XX';

    // Sufijo alfabético base-26 sin huecos: 0→a, 1→b ... 25→z, 26→aa, 27→ab ...
    function sufijo(n) {
        var s = '';
        var idx = n;
        do {
            s = String.fromCharCode(97 + (idx % 26)) + s;
            idx = Math.floor(idx / 26) - 1;
        } while (idx >= 0);
        return s;
    }

    // Recolectar IDs ya usados con esta base (persistidos + vivos)
    var usados = {};
    try {
        var arr = JSON.parse(localStorage.getItem(SU_STORAGE_KEY) || '[]') || [];
        arr.forEach(function(suLote) {
            (suLote.db || []).forEach(function(r) {
                if (r.tanda) usados[r.tanda] = true;
            });
        });
    } catch (e) {}
    document.querySelectorAll('#dbTableBody .db-row .db-tanda').forEach(function(inp) {
        if (inp.value) usados[inp.value] = true;
    });

    var resultado = [];
    var cursor = 0;
    while (resultado.length < cantidad) {
        var candidato = loteBase + sufijo(cursor);
        if (!usados[candidato]) {
            usados[candidato] = true;
            resultado.push(candidato);
        }
        cursor++;
        if (cursor > 100000) break; // safety contra datos corruptos
    }
    return resultado;
}

// ---------- ALTA / BAJA DE FILAS ----------

window.suDbAddRow = function() {
    var tbody = document.getElementById('dbTableBody');
    if (!tbody) return;
    var totalRow = tbody.querySelector('.db-total-row');

    var mainRow = document.createElement('div');
    mainRow.className = 'db-row';
    // Columna Bolsas eliminada visualmente; se mantiene oculta con value=1 para no romper la lógica
    mainRow.innerHTML =
        '<input type="number" class="db-bolsas" value="1" min="0" style="display:none" oninput="suDbOnChangeBolsas(this)">'
        + '<div class="db-row-tanda">'
        +   '<span class="db-cell-label">Tanda</span>'
        +   '<input type="text" class="db-tanda">'
        + '</div>'
        + '<div class="db-row-pesos">'
        +   '<div class="db-row-pesos-header">Pesos reales <span class="db-pesos-unit">g/bolsa</span></div>'
        +   '<div class="db-row-pesos-body">'
        +     '<div class="db-peso-col db-peso-col--sust" title="Peso real del sustrato por bolsa. 0 = peso teórico del lote">'
        +       '<span class="db-cell-label">🧱 Sustrato</span>'
        +       '<input type="number" class="db-peso-real" value="0" min="0" step="1" placeholder="—">'
        +     '</div>'
        +     '<div class="db-peso-col db-peso-col--gran" title="Peso real del grano por bolsa. 0 = calcular automáticamente desde GR">'
        +       '<span class="db-cell-label">🌾 Grano</span>'
        +       '<input type="number" class="db-peso-grano-real" value="0" min="0" step="0.1" placeholder="—">'
        +     '</div>'
        +   '</div>'
        + '</div>'
        + '<div class="db-fuentes-cell"></div>'
        + '<button type="button" class="db-btn-add-fuente db-row-add-source" title="Agregar fuente GR">+</button>'
        + '<button type="button" class="btn-remove db-row-remove" onclick="suDbRemoveRow(this)" title="Eliminar tanda">✕</button>';

    if (totalRow) tbody.insertBefore(mainRow, totalRow);
    else tbody.appendChild(mainRow);

    // Enlazar botón "+" al mainRow
    var addBtn = mainRow.querySelector('.db-row-add-source');
    if (addBtn) addBtn.onclick = function() { window.suDbAddSource(mainRow); };

    // Auto-asignar Tanda ID
    var tandaInput = mainRow.querySelector('.db-tanda');
    if (tandaInput) {
        var ids = suDbGenerarTandaIds(1);
        if (ids.length > 0) tandaInput.value = ids[0];
        tandaInput.addEventListener('input', window.suDbActualizarResumen);
    }

    // Fuente vacía inicial
    var cell = mainRow.querySelector('.db-fuentes-cell');
    var emptySR = _suDbCreateSourceRow();
    cell.appendChild(emptySR);
    window.suDbPoblarLoteSelectSource(emptySR, '');

    window.suDbUpdateSummaryChips(mainRow);
    window.suDbActualizarResumen();
    if (typeof window.suDbActualizarTotalUsados === 'function') window.suDbActualizarTotalUsados();
    if (typeof window.suRecomputeGrUsadosPush === 'function') window.suRecomputeGrUsadosPush();
};

window.suDbRemoveRow = function(btn) {
    var mainRow = btn.closest('.db-row');
    if (!mainRow) return;
    mainRow.remove();
    window.suDbActualizarResumen();
    if (typeof window.suDbActualizarTotalUsados === 'function') window.suDbActualizarTotalUsados();
    if (typeof window.suRecomputeGrUsadosPush === 'function') window.suRecomputeGrUsadosPush();
};

// ==============================================================
// INTEROP GR ↔ SU: Selector de protocolo GR y disponibles vivos
// ==============================================================
var SU_GR_STORAGE = 'gr_lotes';   // lotes del módulo GR
var SU_GR_USADOS  = 'gr_usados';         // mapa { [loteGR]: { [tandaGR]: usados } }

function suGrGetLotesGR() {
    try {
        var raw = localStorage.getItem(SU_GR_STORAGE);
        return raw ? (JSON.parse(raw) || []) : [];
    } catch (e) { return []; }
}
function suGrGetUsadosMap() {
    try {
        var raw = localStorage.getItem(SU_GR_USADOS);
        return raw ? (JSON.parse(raw) || {}) : {};
    } catch (e) { return {}; }
}
function suGrSaveUsadosMap(m) {
    try { localStorage.setItem(SU_GR_USADOS, JSON.stringify(m || {})); } catch (e) {}
}
function suGrGetLoteById(id) {
    if (!id) return null;
    var arr = suGrGetLotesGR();
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
}

/**
 * Calcula los Disponibles "vivos" de una tanda GR tomando en cuenta:
 *  - Frascos y Contaminados del registro GR.
 *  - Todos los usados acumulados en todos los lotes SU guardados distintos al actual.
 *  - Las source rows vivas del form SU actual, EXCLUYENDO la source row que consulta
 *    (excludeRow) para que el chip/margen se calcule correctamente sin auto-descontarse.
 *
 * NOTA: excludeRow es ahora un .db-source-row (no un .db-row).
 */
window.suGrDisponiblesDeTanda = function(grLoteId, grTandaId, excludeSuLoteId, excludeRow) {
    if (!grLoteId || !grTandaId) return { disponibles: 0, frascos: 0, contaminados: 0, usados: 0, tanda: null };
    var lote = suGrGetLoteById(grLoteId);
    if (!lote || !Array.isArray(lote.dg)) return { disponibles: 0, frascos: 0, contaminados: 0, usados: 0, tanda: null };
    var t = null;
    for (var i = 0; i < lote.dg.length; i++) if (lote.dg[i].tanda === grTandaId) { t = lote.dg[i]; break; }
    if (!t) return { disponibles: 0, frascos: 0, contaminados: 0, usados: 0, tanda: null };

    var frascos = parseInt(t.frascos) || 0;
    var contam  = parseInt(t.contaminados) || 0;

    // Usados persistidos (lotes SU guardados distintos al que está en edición)
    var usados = 0;
    try {
        var raw = localStorage.getItem(SU_STORAGE_KEY);
        var arr = raw ? (JSON.parse(raw) || []) : [];
        arr.forEach(function(suLote) {
            if (excludeSuLoteId && suLote.id === excludeSuLoteId) return;
            var lo = suLote.grProtocolo || '';
            (suLote.db || []).forEach(function(r) {
                suDbNormSources(r, lo).forEach(function(s) {
                    if (s.grLoteId === grLoteId && s.grTandaId === grTandaId) {
                        usados += parseInt(s.grUsados) || 0;
                    }
                });
            });
        });
    } catch (e) {}

    // Usados vivos del form actual — iteramos .db-source-row, excluyendo la que consulta
    try {
        document.querySelectorAll('#dbTable .db-source-row').forEach(function(sr) {
            if (excludeRow && sr === excludeRow) return;
            var gl = sr.dataset.grLote  || '';
            var gt = sr.dataset.grTanda || (sr.querySelector('.db-grano-select') || {}).value || '';
            if (gl === grLoteId && gt === grTandaId) {
                var u = parseInt((sr.querySelector('.db-source-usados') || {}).value) || 0;
                usados += u;
            }
        });
    } catch (e) {}

    var disp = frascos - contam - usados;
    if (disp < 0) disp = 0;
    return { disponibles: disp, frascos: frascos, contaminados: contam, usados: usados, tanda: t };
};

/** Recolección mínima para cálculo de usados (no persiste).
 *  Retorna un item por cada (grLoteId, grTandaId) activo en el form. */
window.suDbCollectForUsados = function() {
    var out = [];
    document.querySelectorAll('#dbTableBody .db-row').forEach(function(mainRow) {
        var bolsas = parseInt((mainRow.querySelector('.db-bolsas') || {}).value) || 0;
        suDbGetSourcesFromRow(mainRow).forEach(function(s) {
            if (s.grLoteId && s.grTandaId && s.grUsados > 0) {
                out.push({ grLoteId: s.grLoteId, grTandaId: s.grTandaId, grUsados: s.grUsados, bolsas: bolsas });
            }
        });
    });
    return out;
};

/**
 * Publica el mapa `gr_usados` agregando lotes SU persistidos + sources vivas del form actual.
 * Dispara un `storage`-like refresh para el módulo GR.
 */
window.suRecomputeGrUsadosPush = function() {
    var map = {};
    function add(grLoteId, grTandaId, usados) {
        if (!grLoteId || !grTandaId || !usados) return;
        if (!map[grLoteId]) map[grLoteId] = {};
        map[grLoteId][grTandaId] = (map[grLoteId][grTandaId] || 0) + (parseInt(usados) || 0);
    }
    // 1) Persistidos — usar suDbNormSources para leer grSources o campos legacy
    try {
        var raw = localStorage.getItem(SU_STORAGE_KEY);
        var arr = raw ? (JSON.parse(raw) || []) : [];
        arr.forEach(function(suLote) {
            var lo = suLote.grProtocolo || '';
            (suLote.db || []).forEach(function(r) {
                suDbNormSources(r, lo).forEach(function(s) {
                    add(s.grLoteId, s.grTandaId, s.grUsados);
                });
            });
        });
    } catch (e) {}
    // 2) Form vivo — restar contribución del lote actualmente en edición para no doble-contar
    var suLoteId = (document.getElementById('loteId') || {}).value || '';
    if (suLoteId) {
        try {
            var raw2 = localStorage.getItem(SU_STORAGE_KEY);
            var arr2 = raw2 ? (JSON.parse(raw2) || []) : [];
            var mine = arr2.find(function(l) { return l.id === suLoteId; });
            if (mine) {
                var lo2 = mine.grProtocolo || '';
                (mine.db || []).forEach(function(r) {
                    suDbNormSources(r, lo2).forEach(function(s) {
                        if (s.grLoteId && s.grTandaId && map[s.grLoteId] && map[s.grLoteId][s.grTandaId] != null) {
                            map[s.grLoteId][s.grTandaId] -= (parseInt(s.grUsados) || 0);
                            if (map[s.grLoteId][s.grTandaId] <= 0) delete map[s.grLoteId][s.grTandaId];
                        }
                    });
                });
            }
        } catch (e) {}
    }
    (window.suDbCollectForUsados() || []).forEach(function(r) { add(r.grLoteId, r.grTandaId, r.grUsados); });

    suGrSaveUsadosMap(map);
    window.suDbRefrescarDisponiblesVivos();
    window.suDbActualizarTotalUsados();
    try { window.dispatchEvent(new Event('gr-usados-changed')); } catch (e) {}
    return map;
};

// ==============================================================
// INTEROP GR ↔ SU: Selectores y disponibles a nivel SOURCE ROW
// Cada .db-source-row dentro del panel de fuentes tiene su propio
// select de lote GR, select de tanda GR, input de frascos y chip
// de disponibles. Estos helpers operan sobre una source row.
// ==============================================================

/** Puebla el select de lote GR en una source row. */
window.suDbPoblarLoteSelectSource = function(sourceRow, selectedValue) {
    if (!sourceRow) return;
    var sel = sourceRow.querySelector('.db-lote-select');
    if (!sel) return;
    var lotes = suGrGetLotesGR();
    var suLoteActual = (document.getElementById('loteId') || {}).value || '';
    var lotesValidos = lotes.filter(function(l) {
        if (!l.id || String(l.id).trim() === '') return false;
        var uf = l.uf || l.produccion || {};
        if (!(parseFloat(uf.cantidad_unidades) > 0 && parseFloat(uf.peso_unidad) > 0)) return false;
        // Solo mostrar si tiene al menos una tanda con frascos disponibles
        if (!Array.isArray(l.dg) || l.dg.length === 0) return false;
        return l.dg.some(function(t) {
            if (!t.tanda) return false;
            var info = window.suGrDisponiblesDeTanda(l.id, t.tanda, suLoteActual, null);
            return info.disponibles > 0;
        });
    });
    var prev = selectedValue !== undefined ? selectedValue : sel.value;
    sel.innerHTML = '<option value="">-- Protocolo GR --</option>';
    lotesValidos
        .slice()
        .sort(function(a, b) { return new Date(b.fecha || 0) - new Date(a.fecha || 0); })
        .forEach(function(l) {
            var opt = document.createElement('option');
            opt.value = l.id || '';
            var nTandas = Array.isArray(l.dg) ? l.dg.length : 0;
            opt.textContent = (l.id || '?') + ' — ' + (l.nombre || '') + '  (' + (l.fecha || '') + ', ' + nTandas + ' tandas)';
            sel.appendChild(opt);
        });
    if (prev) sel.value = prev;
};

/** Puebla el select de tanda GR en una source row para el lote dado. */
window.suDbPoblarGranoSelectSource = function(sourceRow, grLoteId) {
    if (!sourceRow) return;
    var sel = sourceRow.querySelector('.db-grano-select');
    if (!sel) return;
    var prevVal = sel.value;
    sel.innerHTML = '<option value="">-- Tanda GR --</option>';
    if (!grLoteId) {
        sourceRow.dataset.grLote  = '';
        sourceRow.dataset.grTanda = '';
        window.suDbActualizarDisponiblesSource(sourceRow);
        return;
    }
    var lote = suGrGetLoteById(grLoteId);
    if (!lote || !Array.isArray(lote.dg)) { sourceRow.dataset.grLote = grLoteId; return; }
    var suLoteActual = (document.getElementById('loteId') || {}).value || '';
    var tandaSeleccionada = prevVal || sourceRow.dataset.grTanda || '';
    lote.dg.forEach(function(t) {
        if (!t.tanda) return;
        var info = window.suGrDisponiblesDeTanda(grLoteId, t.tanda, suLoteActual, sourceRow);
        // Mostrar solo si tiene disponibles, o si ya estaba seleccionada (datos históricos)
        if (info.disponibles <= 0 && t.tanda !== tandaSeleccionada) return;
        var label = t.tanda + (t.genetica ? ' — ' + t.genetica : '') + '  (disp: ' + info.disponibles + '/' + info.frascos + ')';
        var opt = document.createElement('option');
        opt.value = t.tanda;
        opt.textContent = label;
        opt.setAttribute('data-disponibles', String(info.disponibles));
        sel.appendChild(opt);
    });
    sourceRow.dataset.grLote = grLoteId;
    if (prevVal) { sel.value = prevVal; sourceRow.dataset.grTanda = prevVal; }
    window.suDbActualizarDisponiblesSource(sourceRow);
};

/** Actualiza el chip de disponibles en una source row. */
window.suDbActualizarDisponiblesSource = function(sourceRow) {
    if (!sourceRow) return;
    var chip = sourceRow.querySelector('.db-grano-disp');
    if (!chip) return;
    var grLote  = sourceRow.dataset.grLote  || (sourceRow.querySelector('.db-lote-select')  || {}).value || '';
    var grTanda = sourceRow.dataset.grTanda || (sourceRow.querySelector('.db-grano-select') || {}).value || '';
    if (!grLote || !grTanda) { chip.textContent = ''; chip.removeAttribute('data-state'); return; }
    var suLoteActual = (document.getElementById('loteId') || {}).value || '';
    var info = window.suGrDisponiblesDeTanda(grLote, grTanda, suLoteActual, sourceRow);
    chip.textContent = 'disp: ' + info.disponibles;
    if      (info.disponibles === 0) chip.setAttribute('data-state', 'empty');
    else if (info.disponibles < 5)   chip.setAttribute('data-state', 'low');
    else                              chip.setAttribute('data-state', 'ok');
};

/** Refresca chips de disponibles en todas las source rows del form. */
window.suDbRefrescarDisponiblesVivos = function() {
    document.querySelectorAll('#dbTable .db-source-row').forEach(function(sr) {
        window.suDbActualizarDisponiblesSource(sr);
    });
};

/** Refresca selects de lote GR en todas las source rows (p.ej. tras guardar un lote GR). */
window.suDbRefrescarLoteSelects = function() {
    document.querySelectorAll('#dbTable .db-source-row').forEach(function(sr) {
        window.suDbPoblarLoteSelectSource(sr, sr.dataset.grLote || '');
    });
};

// ── Handlers de source rows ─────────────────────────────────────

/** onchange del select de lote GR en una source row. */
window.suDbOnChangeLoteSource = function(selectEl) {
    var sourceRow = selectEl.closest('.db-source-row');
    if (!sourceRow) return;
    var mainRow = sourceRow.closest('.db-row');

    sourceRow.dataset.grLote  = selectEl.value || '';
    sourceRow.dataset.grTanda = '';
    var usEl = sourceRow.querySelector('.db-source-usados');
    if (usEl) { usEl.value = 0; usEl.dataset.prevUsados = '0'; }
    window.suDbPoblarGranoSelectSource(sourceRow, selectEl.value || '');
    if (mainRow) window.suDbUpdateSummaryChips(mainRow);
    window.suRecomputeGrUsadosPush();
    window.suDbActualizarResumen();
};

/** onchange del select de tanda GR en una source row. */
window.suDbOnChangeGranoSource = function(selectEl) {
    var sourceRow = selectEl.closest('.db-source-row');
    if (!sourceRow) return;
    var mainRow = sourceRow.closest('.db-row');

    sourceRow.dataset.grTanda = selectEl.value || '';
    if (!selectEl.value) {
        var usEl = sourceRow.querySelector('.db-source-usados');
        if (usEl) usEl.value = 0;
    }
    window.suDbActualizarDisponiblesSource(sourceRow);
    if (mainRow) window.suDbUpdateSummaryChips(mainRow);
    window.suRecomputeGrUsadosPush();
    window.suDbActualizarResumen();
};

/**
 * oninput del input de frascos en una source row.
 * Valida contra el margen disponible excluyendo la contribución de
 * esta misma source row (mismo patrón que antes, ahora granular).
 */
window.suDbOnChangeUsadosSource = function(inputEl) {
    var sourceRow = inputEl.closest('.db-source-row');
    if (!sourceRow) return;
    var mainRow = sourceRow.closest('.db-row');

    var grLote  = sourceRow.dataset.grLote  || (sourceRow.querySelector('.db-lote-select')  || {}).value || '';
    var grTanda = sourceRow.dataset.grTanda || (sourceRow.querySelector('.db-grano-select') || {}).value || '';
    var val = parseInt(inputEl.value) || 0;
    if (val < 0) { val = 0; inputEl.value = 0; }

    if (grLote && grTanda) {
        var loteGR = suGrGetLoteById(grLote);
        var tanda = null;
        if (loteGR && Array.isArray(loteGR.dg)) {
            for (var i = 0; i < loteGR.dg.length; i++) {
                if (loteGR.dg[i].tanda === grTanda) { tanda = loteGR.dg[i]; break; }
            }
        }
        if (!tanda) {
            val = 0; inputEl.value = 0;
        } else {
            var frascos = parseInt(tanda.frascos) || 0;
            var contam  = parseInt(tanda.contaminados) || 0;
            var suLoteActual = (document.getElementById('loteId') || {}).value || '';

            // Usados persistidos en OTROS lotes SU
            var usadosOtros = 0;
            try {
                var raw = localStorage.getItem(SU_STORAGE_KEY);
                var arr = raw ? (JSON.parse(raw) || []) : [];
                arr.forEach(function(suLote) {
                    if (suLoteActual && suLote.id === suLoteActual) return;
                    var lo = suLote.grProtocolo || '';
                    (suLote.db || []).forEach(function(r) {
                        suDbNormSources(r, lo).forEach(function(s) {
                            if (s.grLoteId === grLote && s.grTandaId === grTanda) {
                                usadosOtros += parseInt(s.grUsados) || 0;
                            }
                        });
                    });
                });
            } catch (e) {}

            // Usados vivos de OTRAS source rows del form actual
            var usadosOtrasFilas = 0;
            document.querySelectorAll('#dbTable .db-source-row').forEach(function(r) {
                if (r === sourceRow) return;
                var gl = r.dataset.grLote  || '';
                var gt = r.dataset.grTanda || (r.querySelector('.db-grano-select') || {}).value || '';
                if (gl === grLote && gt === grTanda) {
                    var inp2 = r.querySelector('.db-source-usados');
                    usadosOtrasFilas += parseInt(inp2 ? inp2.value : 0) || 0;
                }
            });

            var margen = frascos - contam - usadosOtros - usadosOtrasFilas;
            if (margen < 0) margen = 0;
            if (val > margen) { val = margen; inputEl.value = margen; }
        }
    } else if (val > 0) {
        val = 0; inputEl.value = 0;
    }

    // Trazabilidad automática
    var prevLogged = parseInt(sourceRow.dataset.grUsadosLogged || '0') || 0;
    var mainTanda = mainRow ? ((mainRow.querySelector('.db-tanda') || {}).value || '') : '';
    if (grLote && grTanda && val > prevLogged) {
        var delta = val - prevLogged;
        suDbRegistrarSeguimiento('frascos-gr',
            (mainTanda ? mainTanda + ' · ' : '')
            + 'Se usaron ' + delta + ' frasco' + (delta > 1 ? 's' : '')
            + ' de GR ' + grLote + ' / tanda ' + grTanda
            + ' (acumulado en fuente: ' + val + ')', '🟢');
        sourceRow.dataset.grUsadosLogged = String(val);
    } else if (val < prevLogged) {
        var diff = prevLogged - val;
        suDbRegistrarSeguimiento('frascos-gr',
            (mainTanda ? mainTanda + ' · ' : '')
            + 'Corrección: se liberaron ' + diff + ' frasco' + (diff > 1 ? 's' : '')
            + ' de GR ' + grLote + ' / tanda ' + grTanda
            + ' (nuevo total fuente: ' + val + ')', '🟡');
        sourceRow.dataset.grUsadosLogged = String(val);
    }

    inputEl.dataset.prevUsados = String(val);
    window.suDbActualizarDisponiblesSource(sourceRow);
    if (mainRow) window.suDbUpdateSummaryChips(mainRow);
    window.suRecomputeGrUsadosPush();
    window.suDbActualizarTotalUsados();
    window.suDbActualizarResumen();
};

// ── Agregar / Eliminar fuentes ──────────────────────────────────

/** Agrega una nueva source row al panel de fuentes del mainRow dado. */
window.suDbAddSource = function(mainRow) {
    if (!mainRow) return;
    var cell = mainRow.querySelector('.db-fuentes-cell');
    if (!cell) return;
    var newSR = _suDbCreateSourceRow();
    cell.appendChild(newSR);
    window.suDbPoblarLoteSelectSource(newSR, '');
    window.suDbUpdateSummaryChips(mainRow);
    window.suDbActualizarResumen();
};

/** Elimina una source row y oculta el panel si queda vacío. */
window.suDbRemoveSource = function(btn) {
    var sourceRow = btn.closest('.db-source-row');
    if (!sourceRow) return;
    var mainRow = sourceRow.closest('.db-row');
    sourceRow.remove();
    if (mainRow) window.suDbUpdateSummaryChips(mainRow);
    window.suDbActualizarResumen();
    if (typeof window.suDbActualizarTotalUsados === 'function') window.suDbActualizarTotalUsados();
    if (typeof window.suRecomputeGrUsadosPush === 'function') window.suRecomputeGrUsadosPush();
};

/** Actualiza el contador .db-total-usados con la suma de frascos de todas las fuentes. */
window.suDbUpdateSummaryChips = function(mainRow) {
    if (!mainRow) return;
    var totEl = mainRow.querySelector('.db-total-usados');
    var sources = suDbGetSourcesFromRow(mainRow);
    var total = sources.reduce(function(a, s) { return a + (parseInt(s.grUsados) || 0); }, 0);
    if (totEl) totEl.textContent = total;
};

/** Suma los .db-source-usados de todas las source-rows y actualiza #dbTotalUsados. */
window.suDbActualizarTotalUsados = function() {
    var tot = 0;
    document.querySelectorAll('#dbTable .db-source-row .db-source-usados').forEach(function(inp) {
        tot += parseInt(inp.value) || 0;
    });
    var el = document.getElementById('dbTotalUsados');
    if (el) el.textContent = tot;
};

// ---------- REGISTRO AUTOMÁTICO DE EVENTOS ----------
function suDbRegistrarSeguimiento(tipo, mensaje, emoji) {
    var estado = 'none';
    if (emoji === '🟡') estado = 'yellow';
    else if (emoji === '🔴') estado = 'red';
    else if (emoji === '🟢') estado = 'green';

    SU.dbSeguimientoNotas.push({
        ts: suDbTimestamp(),
        tipo: tipo,
        texto: mensaje,
        estado: estado,
        auto: true
    });
    window.suDbRenderSeguimientoNotas();
}

// ---------- HANDLERS INLINE ----------
window.suDbOnChangeBolsas = function(inputEl) {
    var row = inputEl.closest('.db-row');
    if (!row) return;
    var tanda  = (row.querySelector('.db-tanda') || {}).value || '';
    var bolsas = parseInt(inputEl.value) || 0;

    // Registrar evento de inoculación una sola vez por fila
    if (bolsas > 0 && tanda && !row.dataset.inoculacionLogged) {
        row.dataset.fechaInoculacion = new Date().toISOString().split('T')[0];
        row.dataset.inoculacionLogged = '1';
        // Construir descriptor de fuentes para el log
        var fuentes = suDbGetSourcesFromRow(row);
        var fuenteDesc = fuentes.length > 0
            ? fuentes.map(function(s) { return s.grTandaId || s.grLoteId || '?'; }).join(', ')
            : '';
        suDbRegistrarSeguimiento(
            'inoculacion',
            tanda + (fuenteDesc ? ' [' + fuenteDesc + ']' : '') + ': ' + bolsas + ' bolsas inoculadas',
            '🟡'
        );
    }
    window.suDbActualizarResumen();
    if (typeof window.suRecomputeGrUsadosPush === 'function') window.suRecomputeGrUsadosPush();
};

// ---------- CÁLCULO DE RESUMEN + VALIDACIÓN ----------
window.suDbActualizarResumen = function() {
    var rows = document.querySelectorAll('#dbTableBody .db-row');
    var totalBolsas = 0;
    var tandas = [];

    rows.forEach(function(row) {
        var tanda  = (row.querySelector('.db-tanda') || {}).value || '';
        var bolsas = parseInt((row.querySelector('.db-bolsas') || {}).value) || 0;
        totalBolsas += bolsas;

        if (tanda && bolsas > 0) {
            // Descriptor de fuentes GR — lee del sub-panel de sources
            var fuentes = suDbGetSourcesFromRow(row);
            var grano = fuentes.length > 0
                ? fuentes.map(function(s) { return s.grTandaId || s.grLoteId || '?'; }).join(', ')
                : '(sin fuente GR)';
            tandas.push({ tanda: tanda, grano: grano, bolsas: bolsas });
        }
    });

    // Totales globales
    var elTot = document.getElementById('dbTotalBolsas');
    if (elTot) elTot.textContent = totalBolsas;

    // Validación de consistencia SUM(DB.bolsas) ≤ suBolsas
    var suBolsas = suDbGetSuBolsas();
    var aviso = document.getElementById('dbAviso');
    var totalRowEl = document.querySelector('#dbTable .db-total-row');
    if (suBolsas > 0 && totalBolsas > suBolsas) {
        if (aviso) {
            aviso.style.display = 'block';
            aviso.textContent = '⚠ Inconsistencia: distribuidas ' + totalBolsas + ' bolsas pero SU calcula ' + suBolsas + '.';
        }
        if (elTot) elTot.style.color = '#FF0000';
        if (totalRowEl) totalRowEl.style.background = 'rgba(192,0,0,0.12)';
    } else {
        if (aviso) aviso.style.display = 'none';
        if (elTot) elTot.style.color = '';
        if (totalRowEl) totalRowEl.style.background = '';
    }

    // Resumen dinámico agrupado por Grano
    var resumenDiv = document.getElementById('dbResumenGenetica');
    if (resumenDiv) {
        if (tandas.length === 0) {
            resumenDiv.innerHTML = '';
            resumenDiv.style.display = 'none';
        } else {
            var grupos = {};
            tandas.forEach(function(t) {
                var key = t.grano || '(sin fuente GR)';
                if (!grupos[key]) grupos[key] = { bolsas: 0, tandas: [] };
                grupos[key].bolsas += t.bolsas;
                grupos[key].tandas.push(t.tanda);
            });
            var chips = Object.keys(grupos).map(function(g) {
                var d = grupos[g];
                var texto = d.tandas.join(', ') + ' · ' + d.bolsas + ' bolsas · ' + g;
                return '<div class="db-gen-chip" onclick="window.suDbCopiarAlSeguimiento(this.dataset.txt)" data-txt="' + suDbEscapeHtml(texto) + '" title="Click para copiar al seguimiento">'
                    + '<span class="db-gen-name">' + suDbEscapeHtml(g) + '</span>'
                    + '<span class="db-gen-meta">' + d.tandas.length + ' tanda' + (d.tandas.length !== 1 ? 's' : '') + ' · ' + d.bolsas + ' bolsas</span>'
                    + '</div>';
            }).join('');
            resumenDiv.style.display = 'flex';
            resumenDiv.innerHTML = '<span class="db-gen-header">Resumen por genética</span>' + chips;
        }
    }
};

window.suDbCopiarAlSeguimiento = function(texto) {
    var ta = document.getElementById('suDbSeguimientoNotaInput');
    if (ta) { ta.value = texto; ta.focus(); }
};

// ---------- SEGUIMIENTO (render / add / delete) ----------
window.suDbRenderSeguimientoNotas = function() {
    var cont = document.getElementById('suDbSeguimientoNotas');
    if (!cont) return;
    if (!SU.dbSeguimientoNotas || SU.dbSeguimientoNotas.length === 0) {
        cont.innerHTML = '<p style="color:var(--text-muted);font-size:0.9rem;">Sin notas de seguimiento DB</p>';
        return;
    }
    cont.innerHTML = SU.dbSeguimientoNotas.map(function(n, i) {
        var borderColor = 'var(--border)';
        var estadoStr = '⚪ Normal';
        if (n.estado === 'green') { borderColor = '#70AD47'; estadoStr = '🟢 Positivo'; }
        else if (n.estado === 'yellow') { borderColor = '#FFC000'; estadoStr = '🟡 Atención'; }
        else if (n.estado === 'red') { borderColor = '#C00000'; estadoStr = '🔴 Peligro'; }

        var autoTag = n.auto ? ' · auto' : '';
        return '<div style="padding:10px 12px;margin-bottom:8px;background:var(--dark);border-left:3px solid ' + borderColor + ';border-radius:6px;position:relative;">'
            + '<div style="font-size:0.78rem;color:var(--text-muted);font-weight:600;margin-bottom:4px">' + suDbEscapeHtml(n.ts) + ' · ' + estadoStr + autoTag + '</div>'
            + '<div style="font-size:0.92rem;color:var(--text-light)">' + suDbEscapeHtml(n.texto) + '</div>'
            + '<button onclick="window.suDbEliminarSeguimientoNota(' + i + ')" style="position:absolute;top:8px;right:8px;background:transparent;border:none;color:var(--text-muted);cursor:pointer;font-size:0.9rem;" title="Eliminar nota">✕</button>'
            + '</div>';
    }).join('');
};

window.suDbAddSeguimientoNota = function() {
    var input = document.getElementById('suDbSeguimientoNotaInput');
    var estadoSel = document.getElementById('suDbSeguimientoEstado');
    if (!input) return;
    var texto = (input.value || '').trim();
    if (!texto) { alert('Ingrese una nota'); return; }

    SU.dbSeguimientoNotas.push({
        ts: suDbTimestamp(),
        texto: texto,
        estado: estadoSel ? estadoSel.value : 'none',
        auto: false
    });

    input.value = '';
    if (estadoSel) estadoSel.value = 'none';
    window.suDbRenderSeguimientoNotas();
};

window.suDbEliminarSeguimientoNota = function(index) {
    if (index >= 0 && index < SU.dbSeguimientoNotas.length) {
        SU.dbSeguimientoNotas.splice(index, 1);
        window.suDbRenderSeguimientoNotas();
    }
};

// ---------- PERSISTENCIA: COLLECT / LOAD / RESET ----------
window.suDbCollect = function() {
    // str(): normaliza un valor a string limpio; null si vacío.
    var str = function(v) { var s = String(v == null ? '' : v).trim(); return s || null; };

    var out = [];
    document.querySelectorAll('#dbTableBody .db-row').forEach(function(row) {
        var tanda  = str((row.querySelector('.db-tanda') || {}).value);
        var bolsas = parseInt((row.querySelector('.db-bolsas') || {}).value) || 0;

        // Peso real de sustrato por bolsa (g). null = sin override, usar peso teórico del lote.
        var _prRaw = parseFloat((row.querySelector('.db-peso-real') || {}).value) || 0;
        var pesoReal = _prRaw > 0 ? _prRaw : null;

        // Peso real de grano por bolsa (g). null = sin override, calcular desde GR automáticamente.
        var _pgRaw = parseFloat((row.querySelector('.db-peso-grano-real') || {}).value) || 0;
        var pesoGranoReal = _pgRaw > 0 ? _pgRaw : null;

        // Leer fuentes desde el sub-panel de sources
        var allSources = suDbGetSourcesFromRow(row);
        var rawSources = allSources.filter(function(s) { return s.grLoteId && s.grTandaId; });
        // Sources con protocolo asignado pero sin tanda — se preservan para que
        // la validación de guardarLote() las detecte y bloquee el guardado con aviso.
        var sourcesInvalidas = allSources.filter(function(s) { return s.grLoteId && !s.grTandaId; });

        // Fila completamente vacía → ignorar
        if (!tanda && bolsas === 0 && allSources.every(function(s) { return !s.grLoteId && !s.grTandaId; })) return;

        var grSources = rawSources.map(function(s) {
            return {
                grLoteId:  str(s.grLoteId),
                grTandaId: str(s.grTandaId),
                grUsados:  parseInt(s.grUsados) || 0
            };
        });

        // Legacy backward-compat fields (primera fuente) — leídos por FR/TR vía suDbNormSources
        var first = grSources[0] || {};
        out.push({
            // Sources incompletas (protocolo sin tanda) — solo para validación, no se persisten
            _grSourcesInvalidas: sourcesInvalidas.map(function(s) { return { grLoteId: str(s.grLoteId) }; }),
            tanda:     tanda,
            bolsas:    bolsas,
            pesoReal:      pesoReal,      // null → teórico sustrato; >0 → override manual (g/bolsa)
            pesoGranoReal: pesoGranoReal, // null → calcular desde GR; >0 → override manual (g/bolsa)
            grSources: grSources,
            // Campos legacy (primera fuente): no eliminar — necesarios para compatibilidad histórica
            grano:     first.grTandaId || null,
            grLoteId:  first.grLoteId  || null,
            grTandaId: first.grTandaId || null,
            grUsados:  first.grUsados  || 0
        });
    });
    return out;
};

window.suDbLoadFromLote = function(lote) {
    var tbody = document.getElementById('dbTableBody');
    if (!tbody) return;
    tbody.querySelectorAll('.db-row').forEach(function(r) { r.remove(); });

    var data = (lote && lote.db) || [];
    var grLoteDefault = (lote && lote.grProtocolo) || '';

    if (data.length === 0) {
        window.suDbAddRow();
    } else {
        data.forEach(function(d) {
            window.suDbAddRow();
            var allRows = tbody.querySelectorAll('.db-row');
            var mainRow = allRows[allRows.length - 1];
            if (!mainRow) return;

            mainRow.querySelector('.db-tanda').value = d.tanda || '';
            mainRow.querySelector('.db-bolsas').value = d.bolsas || 0;
            if ((d.bolsas || 0) > 0) mainRow.dataset.inoculacionLogged = '1';
            // Restaurar pesos reales (0 = sin override / usar valor teórico/automático)
            var prInp = mainRow.querySelector('.db-peso-real');
            if (prInp) prInp.value = (parseFloat(d.pesoReal) > 0) ? parseFloat(d.pesoReal) : 0;
            var pgInp = mainRow.querySelector('.db-peso-grano-real');
            if (pgInp) pgInp.value = (parseFloat(d.pesoGranoReal) > 0) ? parseFloat(d.pesoGranoReal) : 0;

            // Normalizar fuentes: soporta grSources[] (nuevo) y campos flat (histórico)
            var sources = suDbNormSources(d, grLoteDefault);

            // Limpiar source-rows placeholder creadas por suDbAddRow
            var cell = mainRow.querySelector('.db-fuentes-cell');
            if (!cell) return;
            cell.querySelectorAll('.db-source-row').forEach(function(sr) { sr.remove(); });

            if (sources.length === 0) {
                var emptySR = _suDbCreateSourceRow();
                cell.appendChild(emptySR);
                window.suDbPoblarLoteSelectSource(emptySR, '');
            } else {
                sources.forEach(function(s) {
                    var sr = _suDbCreateSourceRow();
                    cell.appendChild(sr);
                    sr.dataset.grLote  = s.grLoteId  || '';
                    sr.dataset.grTanda = s.grTandaId || '';

                    window.suDbPoblarLoteSelectSource(sr, s.grLoteId || '');
                    window.suDbPoblarGranoSelectSource(sr, s.grLoteId || '');

                    // Añadir opción histórica si la tanda ya no existe en GR
                    var sel = sr.querySelector('.db-grano-select');
                    if (sel && s.grTandaId) {
                        if (!sel.querySelector('option[value="' + s.grTandaId + '"]')) {
                            var opt = document.createElement('option');
                            opt.value = s.grTandaId;
                            opt.textContent = s.grTandaId + ' (histórico)';
                            sel.appendChild(opt);
                        }
                        sel.value = s.grTandaId;
                        sr.dataset.grTanda = s.grTandaId;
                    }

                    var usInp = sr.querySelector('.db-source-usados');
                    if (usInp) {
                        usInp.value = s.grUsados || 0;
                        usInp.dataset.prevUsados = String(s.grUsados || 0);
                    }
                    window.suDbActualizarDisponiblesSource(sr);
                });
            }

            window.suDbUpdateSummaryChips(mainRow);
        });
    }

    SU.dbSeguimientoNotas = (lote && Array.isArray(lote.dbSeguimiento))
        ? lote.dbSeguimiento.slice()
        : [];
    window.suDbRenderSeguimientoNotas();
    window.suDbActualizarResumen();
    window.suDbActualizarTotalUsados();
    if (typeof window.suRecomputeGrUsadosPush === 'function') window.suRecomputeGrUsadosPush();
};

window.suDbReset = function() {
    var tbody = document.getElementById('dbTableBody');
    if (!tbody) return;
    tbody.querySelectorAll('.db-row').forEach(function(r) { r.remove(); });
    SU.dbSeguimientoNotas = [];
    window.suDbAddRow();
    window.suDbRenderSeguimientoNotas();
    window.suDbActualizarResumen();
};

// ---------- AUTO-SYNC DE FILAS DESDE suBolsas ----------
// Regla: si Producción de Bolsas indica N bolsas, la tabla DB debe tener al menos N filas.
// Política: solo se AGREGAN filas (nunca se remueven) para no destruir datos del usuario.
window.suDbSyncRowsToBolsas = function() {
    var target = suDbGetSuBolsas();
    if (target <= 0) { window.suDbActualizarResumen(); return; }

    var tbody = document.getElementById('dbTableBody');
    if (!tbody) return;

    // Si la única fila presente está completamente vacía (placeholder), la removemos
    // para que el auto-completado arranque limpio desde cero.
    var rows = tbody.querySelectorAll('.db-row');
    if (rows.length === 1) {
        var only = rows[0];
        var b = parseInt((only.querySelector('.db-bolsas') || {}).value) || 0;
        var t = (only.querySelector('.db-tanda') || {}).value || '';
        var hasSources = suDbGetSourcesFromRow(only).some(function(s) { return s.grLoteId || s.grTandaId; });
        if (b === 0 && !t && !hasSources) {
            only.remove();
        }
    }

    // Completar hasta alcanzar target (1 bolsa por fila auto-agregada)
    var current = tbody.querySelectorAll('.db-row').length;
    var missing = target - current;
    if (missing > 0) {
        for (var i = 0; i < missing; i++) {
            window.suDbAddRow();
            var all = tbody.querySelectorAll('.db-row');
            var last = all[all.length - 1];
            if (last) {
                var bInput = last.querySelector('.db-bolsas');
                if (bInput) bInput.value = 1;
            }
        }
    }
    window.suDbActualizarResumen();
};

// ---------- LISTENERS: revalidar + sync al cambiar inputs de la calculadora ----------
_suDomListener = function() {
    // Trigger sync tras un tick para que calcularProduccion actualice suBolsas primero
    // (necesario en modo "inverso" donde suBolsas se calcula desde pesoBolsa)
    var triggerSync = function() {
        if (_suSyncTimer) clearTimeout(_suSyncTimer);
        _suSyncTimer = setTimeout(window.suDbSyncRowsToBolsas, 10);
    };

    var elBolsas = document.getElementById('suBolsas');
    if (elBolsas) {
        elBolsas.addEventListener('input', window.suDbActualizarResumen);
        elBolsas.addEventListener('input', triggerSync);
    }

    ['suPesoBolsa', 'suFibra', 'suRatio'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('input', triggerSync);
    });
    var modo = document.getElementById('suModo');
    if (modo) modo.addEventListener('change', triggerSync);

    // Render inicial
    window.suDbRenderSeguimientoNotas();
    window.suDbActualizarResumen();

    // Inicializar selects de lote/tanda por source-row y refrescar gr_usados
    try { window.suDbRefrescarLoteSelects(); } catch (e) {}
    try { window.suRecomputeGrUsadosPush(); } catch (e) {}

    // Listener cross-tab: si GR guarda un lote repoblar selects y disponibles
    _suStorageListener = function(ev) {
        if (ev.key === 'gr_lotes') {
            try { window.suDbRefrescarLoteSelects(); } catch (e) {}
            try { window.suDbRefrescarDisponiblesVivos(); } catch (e) {}
        }
    };
    window.addEventListener('storage', _suStorageListener);

    // Listener local: cuando FR renombra una bolsa, refrescar el registro
    // de lotes SU para que los badges muestren el nuevo ID al instante.
    _suFrRenombradaListener = function() {
        try { renderizarRegistroLotes(); } catch (e) {}
    };
    window.addEventListener('fr-bolsa-renombrada', _suFrRenombradaListener);
};

// Registro de inicialización
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _suDomListener);
} else {
    _suDomListener();
}

// ==========================================
// EXPOSICIÓN DE FUNCIONES AL CONTRATO
// ==========================================
// Toda función referenciada por un handler inline del HTML debe estar aquí.
// Las funciones ya asignadas a window.* directamente están ok.
// Este bloque cubre las funciones definidas como `function foo()` dentro de la IIFE.

// ==========================================
// PROPAGACIÓN DE RENAME A FR
// ==========================================
// Cuando el ID de un lote SU cambia, actualiza suLoteId en todas
// las bolsas FR que referencian ese lote (identificadas por _suUuid).
// Opera directamente sobre localStorage para no depender de que FR esté montado.
function _suPropagarRenameFR(suUuid, idAnterior, idNuevo) {
    if (!suUuid || !idAnterior || !idNuevo || idAnterior === idNuevo) return;
    try {
        var raw = localStorage.getItem('fr_bolsas');
        if (!raw) return;
        var bolsas = JSON.parse(raw);
        if (!Array.isArray(bolsas)) return;
        var changed = false;
        bolsas.forEach(function(b) {
            // Matchear por _suUuid (nuevo) o por suLoteId exacto (fallback histórico)
            var matchUuid = b._suUuid && b._suUuid === suUuid;
            var matchId   = !b._suUuid && b.suLoteId === idAnterior;
            if (matchUuid || matchId) {
                b.suLoteId = idNuevo;       // actualizar ID visible
                b._suUuid  = suUuid;        // grabar uuid para futuros renames
                changed = true;
            }
        });
        if (changed) {
            localStorage.setItem('fr_bolsas', JSON.stringify(bolsas));
            // Notificar a FR si está montado en la misma pestaña
            try { window.dispatchEvent(new Event('su-lote-guardado')); } catch (e) {}
        }
    } catch (e) { console.warn('[SU] _suPropagarRenameFR error:', e); }
}

// ==========================================
// NAVEGACIÓN CROSS-MÓDULO: SU → FR
// ==========================================
// Cuando el usuario hace clic en el badge FR de una sub-fila, navega al
// módulo FR y selecciona automáticamente la bolsa correspondiente.
// Usa window._frPendingSelect como canal de comunicación (FR lo lee en init).
// Guard: si FR ya está montado y expone FR.select, lo invoca directamente
// evitando una recarga completa del módulo.
function suNavToFR(frId) {
    if (!frId) return;
    if (window.FR && typeof window.FR.select === 'function' && window.FR._initialized) {
        // FR ya está en el DOM: navegar directo sin recargar el módulo
        window.FR.select(frId);
        if (typeof loadModule === 'function') loadModule('FR');
    } else {
        // FR no está montado: dejar el ID pendiente para que lo tome en su init
        window._frPendingSelect = frId;
        if (typeof loadModule === 'function') loadModule('FR');
    }
}

Object.assign(window, {
    // Formulación
    calcularSU,
    calcularProduccion,
    cambiarModoProduccion,
    agregarFilaAditivo,
    guardarLote,
    nuevoLote,
    exportarJSON,
    exportarExcel,
    importarJSON,
    importarExcel,
    importarMaterialesDesdeJSON,
    importarRegistrosDesdeJSON,
    // Registros de lotes
    cargarRegistro,
    eliminarRegistro,
    cargarLoteDesdeRegistro,
    eliminarLoteDesdeRegistro,
    toggleEdicionRegistros,
    suEliminarSubfila,
    suAgregarSubfila,
    suSetRegSortMode,
    // Config materiales
    cfgToggleEdicionMateriales,
    cfgAgregarMaterial,
    cfgEliminarMaterial,
    cfgImportarDatos,
    // Utilidades expuestas
    suGenerarId,
    suNavToFR,
    // suNavToFR ya expuesto arriba en el bloque
});

// Hook de desmontaje — main.js lo llama al cambiar de módulo.
window.onModuleUnload = function () {
    if (_suStorageListener) {
        window.removeEventListener('storage', _suStorageListener);
        _suStorageListener = null;
    }
    if (_suFrRenombradaListener) {
        window.removeEventListener('fr-bolsa-renombrada', _suFrRenombradaListener);
        _suFrRenombradaListener = null;
    }
    if (_suDomListener) {
        document.removeEventListener('DOMContentLoaded', _suDomListener);
        _suDomListener = null;
    }
    if (_suSyncTimer) {
        clearTimeout(_suSyncTimer);
        _suSyncTimer = null;
    }
    if (_suCalcTimer) {
        clearTimeout(_suCalcTimer);
        _suCalcTimer = null;
    }
    window.SU._initialized = false;
};

})(); // fin IIFE