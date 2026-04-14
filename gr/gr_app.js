/**
 * Calculadora de Sustratos - Aplicación Principal
 * Sistema de preparación de grano para cultivo de hongos
 */

// Variables globales
const STORAGE_KEY = 'sustratos_lotes';
const BIBLIOTECA_KEY = 'sustratos_biblioteca';
let lotesData = [];

// ==========================================
// NAMESPACE GR (preparación integración monolítica)
// ==========================================
const GR = {};
window.GR = GR;

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
// INICIALIZACIÓN
// ==========================================

GR.init = function initGR() {
    cargarBibliotecaDesdeStorage();
    cargarLotesDesdeStorage();
    inicializarEventos();
    establecerFechaActual();
    renderizarBibliotecaEnConfig();
    actualizarSelectoresCT();
    actualizarTodosLosCalculos();

    setTimeout(function() {
        GR.calcularDG();
        actualizarTotalesCT();
        calcularMetricasDM();
        calcularMetricasFR();
    }, 100);
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', GR.init);
} else {
    GR.init();
}

// Función para actualizar los selectores de granos en CT
function actualizarSelectoresCT() {
    const selects = document.querySelectorAll('.ct-comp');
    if (selects.length === 0) return;
    
    const opcionesGranos = window.biblioteca ? window.biblioteca.granos.map(gr => 
        `<option value="${gr.nombre}" data-densidad="${gr.densidadTipica}">${gr.nombre} - ${gr.densidadTipica.toFixed(3).replace('.', ',')} g/ml</option>`
    ).join('') : '';
    
    selects.forEach(select => {
        select.innerHTML = '<option value="">-- Seleccionar grano --</option>' + opcionesGranos;
    });
}

    function establecerFechaActual() {
        const hoy = new Date().toISOString().split('T')[0];
        document.getElementById('loteFecha').value = hoy;
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
        document.getElementById('btnImportJson').addEventListener('change', importarJSON);
        document.getElementById('btnImportExcel').addEventListener('change', importarExcel);

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
        
        // DM
        document.getElementById('dmMasaHidr').addEventListener('input', calcularMetricasDM);
        document.getElementById('dmDensidad').addEventListener('input', calcularMetricasDM);
        
        // DG - Tabla de distribución de grano
        document.getElementById('dgTable').addEventListener('input', function(e) {
            if (e.target.classList.contains('dg-frascos')) {
                calcularMetricasFR();
            }
        });
        
        // FR
        document.getElementById('frCapacidad').addEventListener('input', calcularMetricasFR);
        document.getElementById('frCargaUtil').addEventListener('input', calcularMetricasFR);

        // Escuchar mensajes de gr_config.html
        window.addEventListener('message', function(event) {
            if (event.data && event.data.type === 'bibliotecaActualizada') {
                cargarBibliotecaDesdeStorage();
                renderizarBibliotecaEnConfig();
                actualizarSelectoresCT();
            }
        });
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
        calcularDensidadFila(row);
    };

    function inicializarEventosCT() {
        const ctTable = document.getElementById('ctTable').querySelector('tbody');
        
        ctTable.addEventListener('input', function(e) {
            if (e.target.classList.contains('ct-vol') || 
                e.target.classList.contains('ct-masa') ||
                e.target.classList.contains('ct-dens')) {
                const row = e.target.closest('tr');
                calcularDensidadFila(row);
            }
        });
    }

    function calcularDensidadFila(row) {
        const volInput = row.querySelector('.ct-vol');
        const masaInput = row.querySelector('.ct-masa');
        const densInput = row.querySelector('.ct-dens');
        
        const vol = parseFloat(volInput.value) || 0;
        const masa = parseFloat(masaInput.value) || 0;
        const densidad = parseFloat(densInput.value) || 0;
        
        // PRIORIDAD CORREGIDA - Si hay densidad del selector, siempre calcula masa/volumen primero
        
        if (densidad > 0 && vol > 0) {
            // 1º: Densidad + Volumen → Masa (SIEMPRE, sin importar qué haya en masa)
            const nuevaMasa = vol * densidad;
            masaInput.value = nuevaMasa.toFixed(2);
        } else if (densidad > 0 && masa > 0) {
            // 2º: Densidad + Masa → Volumen
            const nuevoVol = masa / densidad;
            volInput.value = nuevoVol.toFixed(0);
        } else if (vol > 0 && masa > 0 && densidad === 0) {
            // 3º: Solo si NO hay densidad del selector → Volumen + Masa → Densidad
            const nuevaDensidad = masa / vol;
            densInput.value = nuevaDensidad.toFixed(4);
        }
        
        actualizarTotalesCT();
    }

    function actualizarTotalesCT() {
        const rows = document.querySelectorAll('#ctTable tbody .ct-row');
        let totalVol = 0;
        let totalMasa = 0;

        rows.forEach(row => {
            totalVol += parseFloat(row.querySelector('.ct-vol').value) || 0;
            totalMasa += parseFloat(row.querySelector('.ct-masa').value) || 0;
        });

        document.getElementById('ctTotalVol').textContent = totalVol.toFixed(0);
        document.getElementById('ctTotalMasa').textContent = totalMasa.toFixed(2);
        
        // Actualizar DM Masa Seca
        document.getElementById('dmMasaSeca').value = totalMasa.toFixed(2);
        
        actualizarTodosLosCalculos();
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
        const opcionesGranos = window.biblioteca ? window.biblioteca.granos.map(gr => 
            `<option value="${gr.nombre}" data-densidad="${gr.densidadTipica}">${gr.nombre} - ${gr.densidadTipica.toFixed(3).replace('.', ',')} g/ml</option>`
        ).join('') : '';
        
        row.innerHTML = `
            <td>
                <select class="ct-comp" onchange="seleccionarGranoCT(this)">
                    <option value="">-- Seleccionar grano --</option>
                    ${opcionesGranos}
                </select>
            </td>
            <td><input type="number" class="ct-vol" value="0" min="0" step="1"></td>
            <td><input type="number" class="ct-masa" value="0" min="0" step="0.1"></td>
            <td><input type="number" class="ct-dens" value="0" readonly></td>
            <td><input type="text" class="ct-notas" placeholder="Notas..."></td>
            <td><button type="button" class="btn-remove" onclick="removeRow(this)">✕</button></td>
        `;
        tbody.appendChild(row);
        
        // Agregar eventos para cálculo instantáneo
        row.querySelector('.ct-vol').addEventListener('input', () => calcularDensidadFila(row));
        row.querySelector('.ct-masa').addEventListener('input', () => calcularDensidadFila(row));
    }

    // ==========================================
    // DC - Descontaminación
    // ==========================================

    // Biblioteca de agentes
    const bibliotecaAgentes = {
        'acido_peracetico': { nombre: 'ÁCIDO PERACÉTICO', conc: 5 },
        'hipoclorito': { nombre: 'HIPOCLORITO DE SODIO', conc: 1 },
        'peroxido': { nombre: 'PERÓXIDO DE HIDRÓGENO', conc: 3 }
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
    // DM - Dinámica de Masa
    // ==========================================

    function calcularMetricasDM() {
        const masaSeca = parseFloat(document.getElementById('dmMasaSeca').value) || 0;
        const masaHidr = parseFloat(document.getElementById('dmMasaHidr').value) || 0;
        const densidad = parseFloat(document.getElementById('dmDensidad').value) || 1;

        // Agua absorbida
        const aguaAbs = masaHidr - masaSeca;
        document.getElementById('dmAguaAbs').textContent = aguaAbs.toFixed(2);
        
        // Retención hídrica
        const retencion = masaSeca > 0 ? (aguaAbs / masaSeca) * 100 : 0;
        document.getElementById('dmRetencion').textContent = retencion.toFixed(1);
        
        // Volumen final (L) = masa hidratada (g) / densidad (g/L) = litros
        const volumen = densidad > 0 ? masaHidr / densidad : 0;
        document.getElementById('dmVolumen').textContent = volumen.toFixed(2);
        
        // Expansión volumétrica = ((Volumen Final ml - Volumen Seco ml) / Volumen Seco ml) * 100
        const volSeco = parseFloat(document.getElementById('ctTotalVol').textContent) || 0;
        const volFinalMl = masaHidr / densidad * 1000; // L a ml
        const expansion = volSeco > 0 ? ((volFinalMl - volSeco) / volSeco) * 100 : 0;
        document.getElementById('dmExpansion').textContent = expansion.toFixed(1);

        actualizarTodosLosCalculos();
    }

    // ==========================================
    // FR - Fraccionamiento
    // ==========================================

    function calcularMetricasFR() {
        const capacidad = parseFloat(document.getElementById('frCapacidad').value) || 0;
        const cargaUtil = parseFloat(document.getElementById('frCargaUtil').value) || 0;
        const masaHidr = parseFloat(document.getElementById('dmMasaHidr').value) || 0;
        const densidad = parseFloat(document.getElementById('dmDensidad').value) || 630;
        
        // Headspace
        const headspace = capacidad - cargaUtil;
        document.getElementById('frHeadspace').textContent = headspace.toFixed(0);
        
        // Oxígeno disponible = (Headspace / Capacidad) * 21%
        const oxigeno = capacidad > 0 ? (headspace / capacidad) * 21 : 0;
        document.getElementById('frOxigeno').textContent = oxigeno.toFixed(1);
        
        // Densidad (referencia)
        document.getElementById('frDensidad').textContent = densidad;
        
        // Peso por frasco (g) - solo calcular si hay valores reales
        const pesoFrasco = (densidad * cargaUtil) / 1000;
        document.getElementById('frPesoFrasco').textContent = pesoFrasco.toFixed(1);
        
        // Cantidad de frascos - CÁLCULO AUTOMÁTICO basado en Volumen Final / Carga Útil
        const volumenL = densidad > 0 ? masaHidr / densidad : 0;
        const volumenMl = volumenL * 1000;
        const cantFrascosCalculado = cargaUtil > 0 ? Math.floor(volumenMl / cargaUtil) : 0;
        
        // También obtener suma de DG como referencia
        let totalFrascosDG = 0;
        document.querySelectorAll('#dgTable tbody .dg-row').forEach(row => {
            totalFrascosDG += parseFloat(row.querySelector('.dg-frascos').value) || 0;
        });
        
        // Usar el cálculo automático (no la suma de DG)
        document.getElementById('frCantFrascos').textContent = cantFrascosCalculado;

        actualizarTodosLosCalculos();
    }

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
    // PANEL DE MÉTRICAS EN TIEMPO REAL
    // ==========================================

    function actualizarTodosLosCalculos() {
        // Obtener valores
        const masaSeca = parseFloat(document.getElementById('dmMasaSeca').value) || 0;
        const masaHidr = parseFloat(document.getElementById('dmMasaHidr').value) || 0;
        const densidad = parseFloat(document.getElementById('dmDensidad').value) || 630;
        const volSeco = parseFloat(document.getElementById('ctTotalVol').textContent) || 0;
        const cargaUtil = parseFloat(document.getElementById('frCargaUtil').value) || 0;

        // Solo calcular métricas si hay valores reales ingresados por el usuario
        const tieneDatosReales = masaHidr > 0 && masaSeca > 0;
        
        // Calcular métricas
        const aguaAbs = masaHidr - masaSeca;
        const retencion = masaSeca > 0 ? (aguaAbs / masaSeca) * 100 : 0;
        const volumen = densidad > 0 ? masaHidr / densidad : 0;
        const volFinalMl = masaHidr / densidad * 1000;
        const expansion = volSeco > 0 ? ((volFinalMl - volSeco) / volSeco) * 100 : 0;
        
        // Peso/Frasco - solo mostrar si hay datos reales
        const pesoFrasco = tieneDatosReales ? (densidad * cargaUtil) / 1000 : 0;
        
        // Cantidad de frascos - CÁLCULO AUTOMÁTICO basado en Volumen Final / Carga Útil
        const volumenMl = volumen * 1000;
        const cantFrascosCalculado = cargaUtil > 0 ? Math.floor(volumenMl / cargaUtil) : 0;
        
        // Actualizar panel
        document.getElementById('metricMasaSeca').textContent = masaSeca.toFixed(1);
        document.getElementById('metricMasaHidr').textContent = masaHidr.toFixed(1);
        document.getElementById('metricAguaAbs').textContent = aguaAbs.toFixed(1);
        document.getElementById('metricRetencion').textContent = retencion.toFixed(1);
        document.getElementById('metricVolumen').textContent = volumen.toFixed(2);
        document.getElementById('metricExpansion').textContent = expansion.toFixed(1);
        document.getElementById('metricPesoFrasco').textContent = tieneDatosReales ? pesoFrasco.toFixed(1) : '0';
        document.getElementById('metricFrascos').textContent = tieneDatosReales ? cantFrascosCalculado : '0';

        // Actualizar sección RE
        document.getElementById('reMasaSeca').textContent = masaSeca.toFixed(1);
        document.getElementById('reMasaHidr').textContent = masaHidr.toFixed(1);
        document.getElementById('reVolumen').textContent = volumen.toFixed(2);
        document.getElementById('reRetencion').textContent = retencion.toFixed(1);
        document.getElementById('reFrascos').textContent = tieneDatosReales ? cantFrascosCalculado : '0';
        document.getElementById('rePesoFrasco').textContent = tieneDatosReales ? pesoFrasco.toFixed(1) : '0';
        
        // Actualizar TOTAL en tabla DG
        actualizarTotalDG();
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
            option.textContent = `${lote.id} - ${lote.mezcla} (${lote.fecha})`;
            selector.appendChild(option);
        });
        
        // También actualizar el registro visible
        renderizarRegistroLotes();
    }
    
    // Función para renderizar el registro visible de lotes
    function renderizarRegistroLotes() {
        const tbody = document.getElementById('registroLotesBody');
        const noLotesMsg = document.getElementById('noLotesMsg');
        
        if (!tbody || !noLotesMsg) return;
        
        if (lotesData.length === 0) {
            tbody.innerHTML = '';
            noLotesMsg.style.display = 'block';
            return;
        }
        
        noLotesMsg.style.display = 'none';
        
        // Ordenar por fecha (más reciente primero)
        const lotesOrdenados = [...lotesData].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
        
        tbody.innerHTML = lotesOrdenados.map((lote, index) => {
            const masaSeca = lote.dm ? lote.dm.masaSeca : (lote.componentes ? lote.componentes.reduce((sum, c) => sum + (c.masa || 0), 0) : 0);
            const volumen = lote.dm ? lote.dm.volumen : 0;
            const frascos = lote.fr ? lote.fr.cantFrascos : 0;
            
            // Encontrar el índice real en lotesData
            const realIndex = lotesData.indexOf(lote);
            
            return `
                <tr>
                    <td>${lote.fecha || '-'}</td>
                    <td>${lote.id || '-'}</td>
                    <td>${lote.mezcla || '-'}</td>
                    <td>${masaSeca.toFixed(2)} g</td>
                    <td>${volumen.toFixed(2)} L</td>
                    <td>${frascos}</td>
                    <td class="action-buttons">
                        <button class="btn-small" onclick="cargarLoteDesdeRegistro(${realIndex})">Cargar</button>
                        <button class="btn-delete-lote" onclick="eliminarLoteDesdeRegistro(${realIndex})" title="Eliminar lote">✕</button>
                    </td>
                </tr>
            `;
        }).join('');
    }
    
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
        localStorage.setItem('sustratos_lotes', JSON.stringify(lotesData));
        renderizarRegistroLotes();
        actualizarSelectorLotes();
        alert('Lote eliminado');
    };

    function guardarLote() {
        const lote = recolectarDatosLote();
        
        // Validar
        if (!lote.id) {
            alert('Por favor, ingresa un ID para el lote');
            return;
        }

        // Buscar si existe
        const indiceExistente = lotesData.findIndex(l => l.id === lote.id);
        
        if (indiceExistente >= 0) {
            if (!confirm('Ya existe un lote con este ID. ¿Deseas sobrescribirlo?')) {
                return;
            }
            lotesData[indiceExistente] = lote;
        } else {
            lotesData.push(lote);
        }

        guardarEnStorage();
        alert('Lote guardado correctamente');
        
        // Actualizar registro visible
        renderizarRegistroLotes();
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
        const todosLosLotes = JSON.parse(localStorage.getItem('sustratos_lotes') || '[]');
        
        // Crear objeto de exportación completo
        const exportData = {
            version: '1.0',
            fechaExportacion: new Date().toISOString().split('T')[0],
            loteActual: lote,
            lotesRegistrados: todosLosLotes,
            biblioteca: window.biblioteca
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
            ['Mezcla:', lote.mezcla],
            ['Fecha:', fecha],
            ['Versión:', lote.version],
            [],
            ['MÉTRICAS PRINCIPALES'],
            ['Masa seca total', lote.dm?.masaSeca || 0, 'g'],
            ['Masa hidratada total', lote.dm?.masaHidr || 0, 'g'],
            ['Retención hídrica', lote.dm?.retencion || 0, '%'],
            ['Volumen final', lote.dm?.volumen || 0, 'L'],
            ['Expansión', lote.dm?.expansion || 0, '%'],
            ['Cantidad frascos', lote.fr?.cantFrascos || 0, 'ud'],
            ['Peso por frasco', lote.fr?.pesoFrasco || 0, 'g']
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

        // Hoja DM
        const dmData = [
            ['DM - DINÁMICA DE MASA'],
            [],
            ['Métrica', 'Valor', 'Unidad'],
            ['Masa seca', lote.dm?.masaSeca || 0, 'g'],
            ['Masa hidratada', lote.dm?.masaHidr || 0, 'g'],
            ['Densidad', lote.dm?.densidad || 0, 'g/L'],
            ['Agua absorbida', lote.dm?.aguaAbs || 0, 'g'],
            ['Retención hídrica', lote.dm?.retencion || 0, '%'],
            ['Volumen final', lote.dm?.volumen || 0, 'L'],
            ['Expansión', lote.dm?.expansion || 0, '%']
        ];
        const wsDM = XLSX.utils.aoa_to_sheet(dmData);
        XLSX.utils.book_append_sheet(wb, wsDM, 'DM_DINAMICA');

        // Hoja FR
        const frData = [
            ['FR - FRACCIONAMIENTO'],
            [],
            ['Parámetro', 'Valor', 'Unidad'],
            ['Capacidad', lote.fr?.capacidad || 0, 'ml'],
            ['Carga útil', lote.fr?.cargaUtil || 0, 'ml'],
            ['Headspace', lote.fr?.headspace || 0, 'ml'],
            ['Peso por frasco', lote.fr?.pesoFrasco || 0, 'g'],
            ['Cantidad frascos', lote.fr?.cantFrascos || 0, 'ud']
        ];
        const wsFR = XLSX.utils.aoa_to_sheet(frData);
        XLSX.utils.book_append_sheet(wb, wsFR, 'FR_FRACCIONAMIENTO');

        // Hoja RE
        const reData = [
            ['RE - RESULTADOS'],
            [],
            ['Métrica', 'Valor'],
            ['Masa Seca', document.getElementById('reMasaSeca')?.textContent || 0],
            ['Masa Hidratada', document.getElementById('reMasaHidr')?.textContent || 0],
            ['Volumen', document.getElementById('reVolumen')?.textContent || 0],
            ['Retención', document.getElementById('reRetencion')?.textContent || 0],
            ['Frascos', document.getElementById('reFrascos')?.textContent || 0],
            ['Peso/Frasco', document.getElementById('rePesoFrasco')?.textContent || 0],
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
                    console.log('Importando formato nuevo...');
                    
                    // Importar biblioteca si existe
                    if (data.biblioteca) {
                        GR.biblioteca = window.biblioteca = data.biblioteca;
                        localStorage.setItem('sustratos_biblioteca', JSON.stringify(window.biblioteca));
                        console.log('Biblioteca importada');
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
                    console.log('Importando formato legacy (array)...');
                    lotesAImportar = data;
                } else if (data.id) {
                    // Formato legacy: un solo lote
                    console.log('Importando formato legacy (lote único)...');
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
                
                localStorage.setItem('sustratos_lotes', JSON.stringify(lotesData));
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
                            mezcla: loteData.Mezcla || loteData.mezcla || '',
                            fecha: loteData.Fecha || loteData.fecha || new Date().toISOString().split('T')[0],
                            version: loteData.Versión || loteData.version || 'v1',
                            componentes: [],
                            dc: {},
                            hm: {},
                            dm: {},
                            fr: {},
                            dg: [],
                            es: {},
                            re: {}
                        };
                        
                        lotesData.push(lote);
                        
                        localStorage.setItem('sustratos_lotes', JSON.stringify(lotesData));
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
        // Limpiar formulario
        document.getElementById('loteId').value = '';
        document.getElementById('loteMezcla').value = '';
        document.getElementById('loteVersion').value = 'v1';
        establecerFechaActual();
        
        // Limpiar CT
        const ctTbody = document.getElementById('ctTable').querySelector('tbody');
        ctTbody.innerHTML = '';
        addCtRow();
        addCtRow();
        
        // Limpiar DC (IDs legacy + nuevos IDs del protocolo — guardados)
        const _clr = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
        _clr('dcVolSol', 0); _clr('dcAgente', ''); _clr('dcConcAgente', 0); _clr('dcVolAgente', 0);
        _clr('dcConc', 0); _clr('dcTiempo', 0); _clr('dcTemp', ''); _clr('dcAgitacion', '');
        _clr('grDcVolSol', ''); _clr('grDcAgente', ''); _clr('grDcConcAgente', ''); _clr('grDcVolAgente', '');
        _clr('grDcTiempo', ''); _clr('grDcTemp', '');

        // Limpiar HM (legacy — sección eliminada, guardados)
        _clr('hmEstadoAgua', ''); _clr('hmEstadoGrano', ''); _clr('hmMetodo', '');
        _clr('hmTiempoCoccion', 0); _clr('hmRegimenCalor', ''); _clr('hmAgitacion', '');
        
        // Limpiar DM
        document.getElementById('dmMasaSeca').value = 0;
        document.getElementById('dmMasaHidr').value = 0;
        document.getElementById('dmDensidad').value = 630;
        
        // Limpiar FR
        document.getElementById('frCapacidad').value = 660;
        document.getElementById('frCargaUtil').value = 500;
        
        // Limpiar DG
        const dgTbody = document.getElementById('dgTable').querySelector('tbody');
        dgTbody.innerHTML = '';
        addDgRow();
        
        // Limpiar ES
        document.getElementById('esTiempo').value = 0;
        document.getElementById('esMedio').value = '';
        document.getElementById('esObjPrimario').value = '';
        document.getElementById('esObjSecundario').value = '';
        document.getElementById('esRiesgo1Causa').value = '';
        document.getElementById('esRiesgo1Nivel').value = '';
        document.getElementById('esRiesgo2Causa').value = '';
        document.getElementById('esRiesgo2Nivel').value = '';
        document.getElementById('esRiesgo3Causa').value = '';
        document.getElementById('esRiesgo3Nivel').value = '';
        
        // Limpiar RE
        document.getElementById('evalHidratacion').value = '';
        document.getElementById('evalDistribucion').value = '';
        document.getElementById('evalEficiencia').value = '';
        
        // Resetear selector
        document.getElementById('loteSelector').value = '';
        
        // Verificar que btnEliminarLote existe antes de acceder
        const btnEliminar = document.getElementById('btnEliminarLote');
        if (btnEliminar) btnEliminar.disabled = true;
        
        // Recalcular
        actualizarTotalesCT();
        calcularMetricasDM();
        calcularMetricasFR();
        
        // Resetear métricas en panel y RE
        actualizarTodosLosCalculos();
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
            tiempo: _num('grDcTiempo') || _num('dcTiempo'),
            temp: _val('grDcTemp') || _val('dcTemp'),
            agitacion: _val('dcAgitacion')
        };

        // HM — sección eliminada, se preservan campos vacíos para compat de registro
        const hm = {
            modo: _val('hmModo'),
            metodo: _val('hmMetodo'),
            agitacion: _val('hmAgitacion'),
            notas: _val('hmNotas'),
            resultado: _val('hmResultado'),
            etapas: [],
            aditivos: []
        };

        // Recolectar etapas (incluyendo aditivos si están habilitados)
        const mostrarAditivos = document.getElementById('hmMostrarAditivos')?.checked;
        document.querySelectorAll('#hmEtapasTable tbody tr').forEach((row, i) => {
            const etapa = {
                step: i + 1,
                tipo: row.querySelector('.hm-etapa-tipo').value,
                tiempo: parseFloat(row.querySelector('.hm-etapa-tiempo').value) || 0,
                unidad: row.querySelector('.hm-etapa-unidad').value,
                notas: row.querySelector('.hm-etapa-notas').value
            };
            
            // Si hay aditivo seleccionado, incluirlo
            if (mostrarAditivos) {
                const aditivoNombre = row.querySelector('.hm-etapa-aditivo')?.value;
                if (aditivoNombre) {
                    const select = row.querySelector('.hm-etapa-aditivo');
                    const selectedOption = select.options[select.selectedIndex];
                    const aditivoId = selectedOption ? selectedOption.getAttribute('data-id') || '' : '';
                    const aditivoObj = window.biblioteca?.aditivos?.find(a => a.nombre === aditivoNombre) || {};
                    
                    etapa.aditivo = {
                        id: aditivoObj?.id || aditivoId,
                        nombre: aditivoNombre,
                        cantidad: parseFloat(row.querySelector('.hm-etapa-cant')?.value) || 0,
                        unidad: row.querySelector('.hm-etapa-aditivo-unidad')?.value || 'g'
                    };
                }
            }
            
            hm.etapas.push(etapa);
        });

        // DM
        const dm = {
            masaSeca: parseFloat(document.getElementById('dmMasaSeca').value) || 0,
            masaHidr: parseFloat(document.getElementById('dmMasaHidr').value) || 0,
            densidad: parseFloat(document.getElementById('dmDensidad').value) || 0,
            aguaAbs: parseFloat(document.getElementById('dmAguaAbs').textContent) || 0,
            retencion: parseFloat(document.getElementById('dmRetencion').textContent) || 0,
            volumen: parseFloat(document.getElementById('dmVolumen').textContent) || 0,
            expansion: parseFloat(document.getElementById('dmExpansion').textContent) || 0
        };

        // FR
        const fr = {
            capacidad: parseFloat(document.getElementById('frCapacidad').value) || 0,
            cargaUtil: parseFloat(document.getElementById('frCargaUtil').value) || 0,
            headspace: parseFloat(document.getElementById('frHeadspace').textContent) || 0,
            densidad: parseFloat(document.getElementById('frDensidad').textContent) || 0,
            pesoFrasco: parseFloat(document.getElementById('frPesoFrasco').textContent) || 0,
            cantFrascos: parseFloat(document.getElementById('frCantFrascos').textContent) || 0
        };

        // AD
        const aditivos = [];
        document.querySelectorAll('#adTable tbody .ad-row').forEach(row => {
            aditivos.push({
                tanda: row.querySelector('.ad-tanda').value,
                frascos: parseFloat(row.querySelector('.ad-frascos').value) || 0,
                nombre: row.querySelector('.ad-nombre').value,
                cantidad: parseFloat(row.querySelector('.ad-cant').value) || 0,
                conc: parseFloat(row.querySelector('.ad-conc').value) || 0,
                estado: row.querySelector('.ad-estado').value
            });
        });

        // ES
        const es = {
            tiempo: parseFloat(document.getElementById('esTiempo').value) || 0,
            medio: document.getElementById('esMedio').value,
            objPrimario: document.getElementById('esObjPrimario').value,
            objSecundario: document.getElementById('esObjSecundario').value,
            riesgos: [
                { causa: document.getElementById('esRiesgo1Causa').value, nivel: document.getElementById('esRiesgo1Nivel').value },
                { causa: document.getElementById('esRiesgo2Causa').value, nivel: document.getElementById('esRiesgo2Nivel').value },
                { causa: document.getElementById('esRiesgo3Causa').value, nivel: document.getElementById('esRiesgo3Nivel').value }
            ]
        };

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
        const re = {
            evaluacion: {
                hidratacion: document.getElementById('evalHidratacion').value,
                distribucion: document.getElementById('evalDistribucion').value,
                eficiencia: document.getElementById('evalEficiencia').value
            },
            notas: document.getElementById('reNotas') ? document.getElementById('reNotas').value : ''
        };

        return {
            id: document.getElementById('loteId').value,
            mezcla: document.getElementById('loteMezcla').value,
            fecha: document.getElementById('loteFecha').value,
            version: document.getElementById('loteVersion').value,
            componentes,
            dc,
            hm,
            dm,
            fr,
            adtivos: aditivos,
            es,
            po,
            re
        };
    }

    // ==========================================
    // CARGAR DATOS DE UN LOTE
    // ==========================================

    function cargarDatosLote(lote) {
        // Datos básicos
        document.getElementById('loteId').value = lote.id || '';
        document.getElementById('loteMezcla').value = lote.mezcla || '';
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
            _set('grDcTemp', lote.dc.temp || '');
            _set('dcVolSol', lote.dc.volSol || 0);
            _set('dcAgente', lote.dc.agente || '');
            _set('dcConcAgente', lote.dc.concAgente || 0);
            _set('dcVolAgente', lote.dc.volAgente || 0);
            _set('dcConc', lote.dc.conc || 0);
            _set('dcTiempo', lote.dc.tiempo || 0);
            _set('dcTemp', lote.dc.temp || '');
            _set('dcAgitacion', lote.dc.agitacion || '');
            if (typeof grCalcDC === 'function') grCalcDC();
        }

        // HM — sección eliminada; se preserva el bloque por compat pero guardado contra null
        if (lote.hm && document.getElementById('hmModo')) {
            document.getElementById('hmModo').value = lote.hm.modo || '';
            document.getElementById('hmMetodo').value = lote.hm.metodo || '';
            document.getElementById('hmAgitacion').value = lote.hm.agitacion || '';
            document.getElementById('hmNotas').value = lote.hm.notas || '';
            document.getElementById('hmResultado').value = lote.hm.resultado || '';

            // Cargar etapas
            const etapasTbody = document.getElementById('hmEtapasTable').querySelector('tbody');
            etapasTbody.innerHTML = '';

            // Verificar si hay aditivos en alguna etapa para mostrar el toggle
            const tieneAditivos = (lote.hm.etapas || []).some(et => et.aditivo);
            if (tieneAditivos) {
                document.getElementById('hmMostrarAditivos').checked = true;
                toggleHmAditivos();
            }
            
            // Asegurar biblioteca cargada
            if (window.biblioteca && window.biblioteca.aditivos) {
                const opcionesAditivos = window.biblioteca.aditivos.map(a => 
                    `<option value="${a.nombre}" data-id="${a.id || ''}">${a.nombre}</option>`
                ).join('');
                
                (lote.hm.etapas || []).forEach((et, i) => {
                    addHmEtapa();
                    const row = etapasTbody.lastElementChild;
                    row.querySelector('.hm-etapa-num').textContent = i + 1;
                    row.querySelector('.hm-etapa-tipo').value = et.tipo;
                    row.querySelector('.hm-etapa-tiempo').value = et.tiempo;
                    row.querySelector('.hm-etapa-unidad').value = et.unidad || 'min';
                    row.querySelector('.hm-etapa-notas').value = et.notas || '';
                    
                    // Cargar aditivo si existe
                    if (et.aditivo) {
                        const adSelect = row.querySelector('.hm-etapa-aditivo');
                        adSelect.innerHTML = '<option value="">-- Seleccionar --</option>' + opcionesAditivos;
                        adSelect.value = et.aditivo.nombre || '';
                        row.querySelector('.hm-etapa-cant').value = et.aditivo.cantidad || 0;
                        row.querySelector('.hm-etapa-aditivo-unidad').value = et.aditivo.unidad || 'g';
                    }
                });
            }
        }

        // DM
        if (lote.dm) {
            const masaHidr = lote.dm.masaHidr !== undefined ? lote.dm.masaHidr : 0;
            const densidad = lote.dm.densidad !== undefined ? lote.dm.densidad : 630;
            console.log('Cargando DM - masaHidr:', masaHidr, 'densidad:', densidad);
            const dmMasaHidrInput = document.getElementById('dmMasaHidr');
            const dmDensidadInput = document.getElementById('dmDensidad');
            if (dmMasaHidrInput) {
                dmMasaHidrInput.value = masaHidr;
                console.log('dmMasaHidr set to:', dmMasaHidrInput.value);
            }
            if (dmDensidadInput) dmDensidadInput.value = densidad;
        }
        
        console.log('Antes de calcularMetricasDM - masaHidr:', document.getElementById('dmMasaHidr')?.value);
        // Recalcular después de cargar DM (para que use masaSeca de CT)
        calcularMetricasDM();
        console.log('Después de calcularMetricasDM - masaHidr:', document.getElementById('dmMasaHidr')?.value);

        // FR
        if (lote.fr) {
            document.getElementById('frCapacidad').value = lote.fr.capacidad || 660;
            document.getElementById('frCargaUtil').value = lote.fr.cargaUtil || 500;
            calcularMetricasFR();
        }

        // DG - Distribución de Grano (antes AD)
        const dgTbody = document.getElementById('dgTable').querySelector('tbody');
        dgTbody.innerHTML = '';
        const dgData = lote.dg || lote.aditivos || [];
        dgData.forEach(ad => {
            addDgRow();
            const row = dgTbody.lastElementChild;
            row.querySelector('.dg-tanda').value = ad.tanda || '';
            row.querySelector('.dg-frascos').value = ad.frascos || 0;
            
            // Set aditivo - check if it exists in library
            const select = row.querySelector('.dg-biblioteca');
            const opciones = Array.from(select.options).map(o => o.value);
            if (opciones.includes(ad.nombre)) {
                select.value = ad.nombre;
            } else {
                // If not in library, add as custom option
                const option = document.createElement('option');
                option.value = ad.nombre;
                option.textContent = ad.nombre;
                select.appendChild(option);
                select.value = ad.nombre;
            }
            
            row.querySelector('.dg-cant').value = ad.cantidad || 0;
            row.querySelector('.dg-conc').value = ad.conc || 0;
            row.querySelector('.dg-estado').value = ad.estado || '';
        });

        // ES
        if (lote.es) {
            document.getElementById('esTiempo').value = lote.es.tiempo || 0;
            document.getElementById('esMedio').value = lote.es.medio || '';
            document.getElementById('esObjPrimario').value = lote.es.objPrimario || '';
            document.getElementById('esObjSecundario').value = lote.es.objSecundario || '';
            if (lote.es.riesgos) {
                document.getElementById('esRiesgo1Causa').value = lote.es.riesgos[0]?.causa || '';
                document.getElementById('esRiesgo1Nivel').value = lote.es.riesgos[0]?.nivel || '';
                document.getElementById('esRiesgo2Causa').value = lote.es.riesgos[1]?.causa || '';
                document.getElementById('esRiesgo2Nivel').value = lote.es.riesgos[1]?.nivel || '';
                document.getElementById('esRiesgo3Causa').value = lote.es.riesgos[2]?.causa || '';
                document.getElementById('esRiesgo3Nivel').value = lote.es.riesgos[2]?.nivel || '';
            }
        }

        // PO - Verificar que los elementos existen
        const po = [];
        for (let i = 1; i <= 6; i++) {
            const checkbox = document.getElementById('po' + i);
            po.push({
                paso: i,
                completado: checkbox ? checkbox.checked : false
            });
        }

        // RE
        const re = {
            evaluacion: {
                hidratacion: document.getElementById('evalHidratacion').value,
                distribucion: document.getElementById('evalDistribucion').value,
                eficiencia: document.getElementById('evalEficiencia').value
            },
            notas: document.getElementById('reNotas') ? document.getElementById('reNotas').value : ''
        };
        
        return re;
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
        const tbody = row.parentElement;
        if (tbody.children.length > 1) {
            row.remove();
            actualizarTotalesCT();
        }
    };

    // ==========================================
    // BIBLIOTECA DE INGREDIENTES - CONFIG AVANZADA
    // ==========================================

    function cargarBibliotecaDesdeStorage() {
        const stored = localStorage.getItem(BIBLIOTECA_KEY);
        if (stored) {
            GR.biblioteca = window.biblioteca = JSON.parse(stored);
        } else {
            GR.biblioteca = window.biblioteca = JSON.parse(JSON.stringify(bibliotecaDefault));
            guardarBibliotecaEnStorage();
        }
    }

    function guardarBibliotecaEnStorage() {
        // Recolectar valores editados
        document.querySelectorAll('#configAgentesTable tr').forEach((tr, i) => {
            if (window.biblioteca.agentes[i]) {
                const nombreInput = tr.querySelector('.edit-nombre');
                const concInput = tr.querySelector('.edit-conc');
                if (nombreInput) window.biblioteca.agentes[i].nombre = nombreInput.value;
                if (concInput) window.biblioteca.agentes[i].concDefault = parseFloat(concInput.value) || 0;
            }
        });
        
        document.querySelectorAll('#configAditivosTable tr').forEach((tr, i) => {
            if (window.biblioteca.aditivos[i]) {
                const nombreInput = tr.querySelector('.edit-nombre');
                const tipoInput = tr.querySelector('.edit-tipo');
                if (nombreInput) window.biblioteca.aditivos[i].nombre = nombreInput.value;
                if (tipoInput) window.biblioteca.aditivos[i].tipo = tipoInput.value;
            }
        });
        
        document.querySelectorAll('#configGranosTable tr').forEach((tr, i) => {
            if (window.biblioteca.granos[i]) {
                const nombreInput = tr.querySelector('.edit-nombre');
                const granuloInput = tr.querySelector('.edit-granulo');
                if (nombreInput) window.biblioteca.granos[i].nombre = nombreInput.value;
                if (granuloInput) window.biblioteca.granos[i].granulometria = granuloInput.value;
            }
        });
        
        localStorage.setItem(BIBLIOTECA_KEY, JSON.stringify(window.biblioteca));
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
        
        window.biblioteca.agentes.push({
            id: 'AG-' + String(window.biblioteca.agentes.length + 1).padStart(2, '0'),
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
        
        window.biblioteca.aditivos.push({
            id: 'AD-' + String(window.biblioteca.aditivos.length + 1).padStart(2, '0'),
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
        
        window.biblioteca.granos.push({
            id: 'GR-' + String(window.biblioteca.granos.length + 1).padStart(2, '0'),
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
        window.biblioteca[tipo].splice(index, 1);
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
        const agentesTable = document.getElementById('configAgentesTable');
        if (agentesTable) {
            agentesTable.innerHTML = window.biblioteca.agentes.map((ag, i) =>
                `<tr><td>${ag.id}</td><td><input type="text" class="edit-nombre" data-tipo="agentes" data-idx="${i}" value="${ag.nombre}"></td><td><input type="number" class="edit-conc" data-tipo="agentes" data-idx="${i}" value="${ag.concDefault}"></td><td>${ag.volumenTipico || '-'}</td><td>${ag.notas || '-'}</td><td class="col-editar"><button type="button" class="btn-delete" onclick="eliminarIngredienteConfig('agentes', ${i})">✕</button></td></tr>`
            ).join('');
        }
        
        const aditivosTable = document.getElementById('configAditivosTable');
        if (aditivosTable) {
            aditivosTable.innerHTML = window.biblioteca.aditivos.map((ad, i) =>
                `<tr><td>${ad.id}</td><td><input type="text" class="edit-nombre" data-tipo="aditivos" data-idx="${i}" value="${ad.nombre}"></td><td><select class="edit-tipo" data-tipo="aditivos" data-idx="${i}"><option value="Estructurante" ${ad.tipo==='Estructurante'?'selected':''}>Estructurante</option><option value="Corrector pH" ${ad.tipo==='Corrector pH'?'selected':''}>Corrector pH</option><option value="Nutriente" ${ad.tipo==='Nutriente'?'selected':''}>Nutriente</option></select></td><td>${ad.notas || '-'}</td><td class="col-editar"><button type="button" class="btn-delete" onclick="eliminarIngredienteConfig('aditivos', ${i})">✕</button></td></tr>`
            ).join('');
        }
        
        const granosTable = document.getElementById('configGranosTable');
        if (granosTable) {
            granosTable.innerHTML = window.biblioteca.granos.map((gr, i) =>
                `<tr><td>${gr.id}</td><td><input type="text" class="edit-nombre" data-tipo="granos" data-idx="${i}" value="${gr.nombre}"></td><td>${gr.densidadTipica.toFixed(3).replace('.', ',')} g/ml</td><td><input type="text" class="edit-granulo" data-tipo="granos" data-idx="${i}" value="${gr.granulometria || ''}"></td><td>${gr.notas || '-'}</td><td class="col-editar"><button type="button" class="btn-delete" onclick="eliminarIngredienteConfig('granos', ${i})">✕</button></td></tr>`
            ).join('');
        }
        
        // Actualizar selector de granos en CT (select con características)
        document.querySelectorAll('.ct-comp').forEach(select => {
            select.innerHTML = '<option value="">-- Seleccionar grano --</option>' +
                window.biblioteca.granos.map(gr => 
                    `<option value="${gr.nombre}" data-densidad="${gr.densidadTipica}">${gr.nombre} - ${gr.densidadTipica.toFixed(3).replace('.', ',')} g/ml</option>`
                ).join('');
        });
        
        // Actualizar selector de aditivos en DG (para filas nuevas y existentes)
        if (window.biblioteca && window.biblioteca.aditivos) {
            const opcionesAditivos = window.biblioteca.aditivos.map(a => 
                `<option value="${a.nombre}">${a.nombre}</option>`
            ).join('');
            
            // Guardar para filas nuevas
            GR.opcionesAditivosDG = window.opcionesAditivosDG = opcionesAditivos;
            
            // Actualizar todos los selectores .dg-biblioteca existentes en la tabla
            document.querySelectorAll('#dgTable .dg-biblioteca').forEach(select => {
                select.innerHTML = '<option value="">-- Seleccionar --</option>' + opcionesAditivos;
            });
            
            // Actualizar selectors de HM también
            if (window.actualizarSelectoresHM) {
                window.actualizarSelectoresHM();
            }
        }
    }

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
        const oxigeno = capacidadVal > 0 ? (headspace / capacidadVal) * 21 : 0;
        
        dgHeadspace.textContent = headspace.toFixed(0);
        dgOxigeno.textContent = oxigeno.toFixed(1);
    };

    // Actualizar fila de totales en tabla DG
    GR.actualizarTotalDG = window.actualizarTotalDG = function() {
        let totalFrascos = 0;
        let totalCantidad = 0;
        
        document.querySelectorAll('#dgTable tbody .dg-row').forEach(row => {
            totalFrascos += parseFloat(row.querySelector('.dg-frascos').value) || 0;
            totalCantidad += parseFloat(row.querySelector('.dg-cant').value) || 0;
        });
        
        const totalFrascosEl = document.getElementById('dgTotalFrascos');
        if (totalFrascosEl) {
            totalFrascosEl.textContent = totalFrascos;
        }
        
        const totalCantidadEl = document.getElementById('dgTotalCantidad');
        if (totalCantidadEl) {
            totalCantidadEl.textContent = totalCantidad.toFixed(1);
        }
    };

    GR.seleccionarAditivoCelda = window.seleccionarAditivoCelda = function(select) {
        const row = select.closest('tr');
        const aditivo = select.value;
        if (aditivo) {
            row.querySelector('.dg-nombre').value = aditivo;
        }
        select.value = '';
    };

    GR.addDgRow = window.addDgRow = function() {
        const tbody = document.getElementById('dgTable').querySelector('tbody');
        const row = document.createElement('tr');
        row.className = 'dg-row';
        
        // Opciones de la biblioteca de aditivos
        const opcionesAditivos = window.biblioteca.aditivos.map(a => 
            `<option value="${a.nombre}">${a.nombre}</option>`
        ).join('');
        
        row.innerHTML = `
            <td><input type="text" class="dg-tanda" placeholder="Ej: 194DA"></td>
            <td><input type="number" class="dg-frascos" value="0" min="0" oninput="calcularConcentracionFila(this)"></td>
            <td>
                <select class="dg-biblioteca" onchange="seleccionarAditivoCelda(this)">
                    <option value="">-- Seleccionar --</option>
                    ${opcionesAditivos}
                </select>
            </td>
            <td><input type="number" class="dg-cant" value="0" min="0" step="0.1" oninput="calcularConcentracionFila(this)"></td>
            <td><input type="number" class="dg-conc" value="0" readonly></td>
            <td>
                <select class="dg-estado">
                    <option value="">Seleccionar...</option>
                    <option value="ejecutado">Ejecutado</option>
                    <option value="programado">Programado</option>
                    <option value="pendiente">Pendiente</option>
                </select>
            </td>
            <td><button type="button" class="btn-remove" onclick="removeRowDG(this)">✕</button></td>
        `;
        tbody.appendChild(row);
    };

    GR.removeRowDG = window.removeRowDG = function(btn) {
        const row = btn.closest('tr');
        const tbody = row.parentElement;
        if (tbody.children.length > 1) row.remove();
    };

    // ==========================================
    // HM - Hidratación y Proceso
    // ==========================================
    
    GR.addHmEtapa = window.addHmEtapa = function() {
        const tbody = document.getElementById('hmEtapasTable').querySelector('tbody');
        const opcionesAditivos = window.biblioteca && window.biblioteca.aditivos ? 
            window.biblioteca.aditivos.map(a => `<option value="${a.nombre}" data-id="${a.id || ''}">${a.nombre}</option>`).join('') : '';
        
        const showAditivos = document.getElementById('hmMostrarAditivos')?.checked;
        const displayStyle = showAditivos ? '' : 'display:none';
        
        const row = document.createElement('tr');
        row.className = 'hm-etapa-row';
        row.innerHTML = `
            <td class="hm-etapa-num">${tbody.children.length + 1}</td>
            <td>
                <select class="hm-etapa-tipo">
                    <option value="remojo">Remojo</option>
                    <option value="lavado">Lavado</option>
                    <option value="espera">Espera</option>
                    <option value="coccion">Cocción</option>
                </select>
            </td>
            <td><input type="number" class="hm-etapa-tiempo" value="0" min="0"></td>
            <td>
                <select class="hm-etapa-unidad">
                    <option value="min">min</option>
                    <option value="h">h</option>
                </select>
            </td>
            <td><input type="text" class="hm-etapa-notas" placeholder="Notas..."></td>
            <td class="hm-col-aditivo" style="${displayStyle}">
                <select class="hm-etapa-aditivo">
                    <option value="">-- Seleccionar --</option>
                    ${opcionesAditivos}
                </select>
            </td>
            <td class="hm-col-cant" style="${displayStyle}"><input type="number" class="hm-etapa-cant" value="0" min="0" step="0.1"></td>
            <td class="hm-col-unidad" style="${displayStyle}">
                <select class="hm-etapa-aditivo-unidad">
                    <option value="g">g</option>
                    <option value="ml">ml</option>
                </select>
            </td>
            <td><button type="button" class="btn-remove" onclick="removeHmEtapa(this)">✕</button></td>
        `;
        tbody.appendChild(row);
    };

    GR.removeHmEtapa = window.removeHmEtapa = function(btn) {
        const row = btn.closest('tr');
        const tbody = row.parentElement;
        if (tbody.children.length > 1) {
            row.remove();
            tbody.querySelectorAll('.hm-etapa-num').forEach((el, i) => {
                el.textContent = i + 1;
            });
        }
    };

    // Toggle para mostrar/ocultar columnas de aditivos en etapas
    GR.toggleHmAditivos = window.toggleHmAditivos = function() {
        const mostrar = document.getElementById('hmMostrarAditivos')?.checked;
        const displayStyle = mostrar ? '' : 'display:none';
        
        // Headers
        document.querySelectorAll('#hmEtapasTable .hm-col-aditivo').forEach(el => el.style.display = displayStyle);
        document.querySelectorAll('#hmEtapasTable .hm-col-cant').forEach(el => el.style.display = displayStyle);
        document.querySelectorAll('#hmEtapasTable .hm-col-unidad').forEach(el => el.style.display = displayStyle);
        
        // Filas
        document.querySelectorAll('#hmEtapasTable tbody tr').forEach(row => {
            row.querySelectorAll('.hm-col-aditivo').forEach(el => el.style.display = displayStyle);
            row.querySelectorAll('.hm-col-cant').forEach(el => el.style.display = displayStyle);
            row.querySelectorAll('.hm-col-unidad').forEach(el => el.style.display = displayStyle);
        });
    };

    GR.addHmAditivo = window.addHmAditivo = function() {
        const tbody = document.getElementById('hmAditivosTable').querySelector('tbody');
        const opcionesAditivos = window.biblioteca && window.biblioteca.aditivos ? 
            window.biblioteca.aditivos.map(a => `<option value="${a.nombre}" data-id="${a.id || ''}">${a.nombre}</option>`).join('') : '';
        
        const row = document.createElement('tr');
        row.className = 'hm-aditivo-row';
        row.innerHTML = `
            <td>
                <select class="hm-aditivo-etapa">
                    <option value="remojo">Remojo</option>
                    <option value="coccion">Cocción</option>
                </select>
            </td>
            <td>
                <select class="hm-aditivo-biblioteca">
                    <option value="">-- Seleccionar --</option>
                    ${opcionesAditivos}
                </select>
            </td>
            <td><input type="number" class="hm-aditivo-cant" value="0" min="0" step="0.1"></td>
            <td>
                <select class="hm-aditivo-unidad">
                    <option value="g">g</option>
                    <option value="ml">ml</option>
                </select>
            </td>
            <td><input type="text" class="hm-aditivo-notas" placeholder="Notas..."></td>
            <td><button type="button" class="btn-remove" onclick="removeHmAditivo(this)">✕</button></td>
        `;
        tbody.appendChild(row);
    };

    // Actualizar selectors de biblioteca en HM cuando cambia la biblioteca
    GR.actualizarSelectoresHM = window.actualizarSelectoresHM = function() {
        const opcionesAditivos = window.biblioteca && window.biblioteca.aditivos ? 
            window.biblioteca.aditivos.map(a => `<option value="${a.nombre}" data-id="${a.id || ''}">${a.nombre}</option>`).join('') : '';
        
        // Actualizar selectors en la tabla de etapas
        document.querySelectorAll('#hmEtapasTable .hm-etapa-aditivo').forEach(select => {
            const currentValue = select.value;
            select.innerHTML = '<option value="">-- Seleccionar --</option>' + opcionesAditivos;
            select.value = currentValue;
        });
    };

    // Legacy - mantener compatibilidad
    GR.addHmAditivo = window.addHmAditivo = function() { 
        alert('Use el toggle "Incluir aditivos en etapas" en la tabla de Etapas'); 
    };
    GR.removeHmAditivo = window.removeHmAditivo = function() {};

    GR.calcularConcentracionFila = window.calcularConcentracionFila = function(input) {
        const row = input.closest('tr');
        const frascos = parseFloat(row.querySelector('.dg-frascos').value) || 0;
        const cantidad = parseFloat(row.querySelector('.dg-cant').value) || 0;
        const masaHidr = parseFloat(document.getElementById('dmMasaHidr').value) || 0;
        const cantFrascosTotal = parseFloat(document.getElementById('frCantFrascos').textContent) || 1;
        const pesoPorFrasco = masaHidr / cantFrascosTotal;
        const conc = pesoPorFrasco > 0 ? (cantidad / pesoPorFrasco) * 100 : 0;
        row.querySelector('.dg-conc').value = conc.toFixed(3);
    };

    // Legacy functions (deprecated but kept for compatibility)
    GR.agregarAgente = window.agregarAgente = function() { alert('Use la sección CONFIG para agregar ingredientes'); };
    GR.agregarAditivo = window.agregarAditivo = function() { alert('Use la sección CONFIG para agregar ingredientes'); };
    GR.agregarGrano = window.agregarGrano = function() { alert('Use la sección CONFIG para agregar ingredientes'); };
    GR.eliminarIngrediente = window.eliminarIngrediente = function() { alert('Use la sección CONFIG para eliminar ingredientes'); };
    function renderizarBiblioteca() { renderizarBibliotecaEnConfig(); }

    // ==========================================
    // CARGAR LOTE 1903 (EJEMPLO)
    // ==========================================

    function cargarLote1903() {
        const lote1903 = {
            id: '1903-MA-AV',
            mezcla: 'MA + AV (50/50 vol.)',
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
                tiempo: 60,
                temp: 'AMBIENTE',
                agitacion: 'PASIVA (DIFUSIÓN)'
            },
            hm: {
                estadoAgua: 'EBULICIÓN - 100°C',
                estadoGrano: 'TEMPERATURA AMBIENTE',
                metodo: 'INMERSIÓN DIRECTA',
                tiempoCoccion: 20,
                regimenCalor: 'FUEGO MÁXIMO CONSTANTE',
                agitacion: 'CADA 5 MINUTOS'
            },
            dm: {
                masaSeca: 2716,
                masaHidr: 4316,
                densidad: 630,
                aguaAbs: 1600,
                retencion: 58.8,
                volumen: 6.85,
                expansion: 71
            },
            fr: {
                capacidad: 660,
                cargaUtil: 500,
                headspace: 160,
                densidad: 630,
                pesoFrasco: 315,
                cantFrascos: 13
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
            mezcla: 'Maíz 100%',
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
                tiempo: 60,
                temp: 'AMBIENTE',
                agitacion: 'INMERSIÓN'
            },
            hm: {
                estadoAgua: 'EBULICIÓN - 100°C',
                estadoGrano: 'TEMPERATURA AMBIENTE',
                metodo: 'INMERSIÓN DIRECTA',
                tiempoCoccion: 70,
                regimenCalor: 'FUEGO MÁXIMO + FUEGO MÍNIMO',
                agitacion: '15 MIN/CICLO × 4 CICLOS'
            },
            dm: {
                masaSeca: 2406,
                masaHidr: 4800,
                densidad: 800,
                aguaAbs: 2394,
                retencion: 99.5,
                volumen: 6.0,
                expansion: 100
            },
            fr: {
                capacidad: 660,
                cargaUtil: 500,
                headspace: 160,
                densidad: 800,
                pesoFrasco: 400,
                cantFrascos: 12
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

// Sub-tab switcher (Formulación <-> Config)
GR.subTab = window.grSubTab = function grSubTab(t) {
    var tabs = document.querySelectorAll('.gr-subtab');
    tabs.forEach(function(tb) { tb.classList.remove('active'); });
    var active = document.querySelector('.gr-subtab[data-grtab="' + t + '"]');
    if (active) active.classList.add('active');

    var pMain = document.getElementById('gr-sub-main');
    var pCfg  = document.getElementById('gr-sub-cfg');
    if (pMain) {
        pMain.style.display = (t === 'main') ? 'flex' : 'none';
        if (t === 'main') pMain.classList.add('active'); else pMain.classList.remove('active');
    }
    if (pCfg) {
        pCfg.style.display = (t === 'cfg') ? 'flex' : 'none';
        if (t === 'cfg') pCfg.classList.add('active'); else pCfg.classList.remove('active');
    }
    // Al entrar a config refrescar tablas
    if (t === 'cfg' && typeof renderizarBibliotecaEnConfig === 'function') {
        try { renderizarBibliotecaEnConfig(); } catch(e) {}
    }
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
    const agentes = (window.biblioteca && window.biblioteca.agentes) || [];
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
    const volAg = parseFloat(document.getElementById('grDcVolAgente')?.value) || 0;

    const volSolMl = volSol * 1000;
    const concFinal = volSolMl > 0 ? ((volAg * concAg) / volSolMl) : 0;
    const aguaNec = Math.max(0, volSolMl - volAg) / 1000;
    const proporcion = volAg > 0 ? `1:${((volSolMl - volAg) / volAg).toFixed(1)}` : '—';

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
    const temp = document.getElementById('grDcTemp')?.value?.trim();

    if (!volSol || !agente || !concAg || !volAg || !tiempo || !temp) {
        alert('Completa todos los campos de DC antes de guardar.');
        return;
    }
    const concFinal = document.getElementById('grDcConcFinal')?.textContent || '0';
    GR.protoNotas.push({
        ts: grTimestamp(),
        texto: `🧪 Descontaminación Química — ${agente} ${concAg}% | Vol sol: ${volSol}L | Vol agente: ${volAg}ml | Conc final: ${concFinal}% | Tiempo: ${tiempo}min | ${temp}`
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
    return new Date().toLocaleString();
}

function grRenderNotas() {
    const cont = document.getElementById('grProtoNotas');
    if (!cont) return;
    if (GR.protoNotas.length === 0) {
        cont.innerHTML = '';
        return;
    }
    cont.innerHTML = GR.protoNotas.map(n =>
        `<div class="gr-nota-entry" style="padding:10px 12px;margin-bottom:8px;background:var(--bg,#1D1D1D);border-left:3px solid #FFA000;border-radius:6px;color:var(--tx,#F5F5F5)">
            <div class="nota-time" style="font-size:0.78rem;color:#FFA000;font-weight:600;margin-bottom:4px">${n.ts}</div>
            <div class="nota-text" style="font-size:0.92rem;color:var(--tx,#F5F5F5)">${n.texto}</div>
        </div>`
    ).join('');
}

GR.addProtoNota = window.grAddProtoNota = function grAddProtoNota() {
    if (GR.protoCerrado) { alert('El protocolo está cerrado. Reábralo para editar.'); return; }
    const input = document.getElementById('grProtoNotaInput');
    if (!input) return;
    const texto = (input.value || '').trim();
    if (!texto) return;
    GR.protoNotas.push({ ts: grTimestamp(), texto });
    input.value = '';
    grRenderNotas();
};

GR.cerrarProtocolo = window.grCerrarProtocolo = function grCerrarProtocolo() {
    const btn = document.getElementById('grBtnCerrar');
    const cerrado = document.getElementById('grProtoCerrado');
    const input = document.getElementById('grProtoNotaInput');

    if (!GR.protoCerrado) {
        GR.protoCerrado = true;
        GR.protoNotas.push({ ts: grTimestamp(), texto: '✅ Protocolo cerrado' });
        grRenderNotas();
        if (btn) {
            btn.textContent = '🔓 Reabrir Protocolo';
            btn.style.background = '#ED7D31';
        }
        if (input) input.disabled = true;
        if (cerrado) {
            cerrado.style.display = 'block';
            cerrado.innerHTML = `<strong style="color:var(--highlight)">✅ Protocolo cerrado</strong> <span style="color:var(--tx2);font-size:0.85rem">— ${new Date().toLocaleString()}</span>`;
        }
    } else {
        GR.protoCerrado = false;
        GR.protoNotas.push({ ts: grTimestamp(), texto: '🔓 Protocolo reabierto para edición' });
        grRenderNotas();
        if (btn) {
            btn.textContent = '✅ Cerrar Protocolo';
            btn.style.background = '#70AD47';
        }
        if (input) input.disabled = false;
        if (cerrado) cerrado.style.display = 'none';
    }
};

document.addEventListener('DOMContentLoaded', function() {
    grRenderNotas();
});