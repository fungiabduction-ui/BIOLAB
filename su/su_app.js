/**
 * MÓDULO SU - SUSTRATOS
 * Calculadora de registros de sustratos
 * Lógica extraída de biolab_v6.html adaptada al estilo Calculadora_Sustratos
 */

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
// INICIALIZACIÓN
// ==========================================

document.addEventListener('DOMContentLoaded', function() {
    cargarBibliotecaDesdeStorage();
    cargarLotesDesdeStorage();
    inicializarEventos();
    establecerFechaActual();
    renderizarBiblioteca();
    renderizarRegistroLotes();
    
    // NO auto-importar desde archivos - solo desde localStorage
    // El usuario debe usar biblioteca.html para importar datos
    
    // Verificar si hay un lote para cargar desde biblioteca
    cargarLoteDesdeBiblioteca();
});

// Función simplificada para cargar un lote desde biblioteca
async function cargarLoteDesdeBiblioteca() {
    const loteIndex = localStorage.getItem('lote_a_cargar');
    if (loteIndex !== null) {
        const index = parseInt(loteIndex);
        localStorage.removeItem('lote_a_cargar');
        
        if (lotesData[index]) {
            cargarDatosLote(lotesData[index]);
            console.log('Lote cargado desde biblioteca:', lotesData[index].id);
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
        resultadoDiv.innerHTML = '<span style="color:var(--text-muted)">Ingrese fibra y ratio para calcular</span>';
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
        const纤维Restante = pesoBolsa > 0 ? (total % pesoBolsa).toFixed(1) : 0;
        html = `
            <div>Total preparado: <strong>${total.toFixed(1)}g</strong></div>
            <div>Peso solicitado: <strong>${pesoBolsa}g</strong> por bolsa</div>
            <div>Bolsas necesarias: <strong class="destacado">${bolsasNecesarias}</strong></div>
            ${纤维Restante > 0 ? `<div>Resto: <strong>${纤维Restante}g</strong></div>` : ''}
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
}

// ==========================================
// BIBLIOTECA DE MATERIALES
// ==========================================

function cargarBibliotecaDesdeStorage() {
    const stored = localStorage.getItem(SU_BIBLIOTECA_KEY);
    if (stored) {
        biblioteca = JSON.parse(stored);
    } else {
        biblioteca = { ...bibliotecaDefault };
        guardarBiblioteca();
    }
}

function guardarBiblioteca() {
    localStorage.setItem(SU_BIBLIOTECA_KEY, JSON.stringify(biblioteca));
}

function renderizarBiblioteca() {
    const tbody = document.getElementById('bibliotecaTable');
    if (!tbody) return;
    
    if (!biblioteca.materiales.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Sin materiales registrados</td></tr>';
        return;
    }
    
    tbody.innerHTML = biblioteca.materiales.map(m => `
        <tr>
            <td>${m.id}</td>
            <td>${m.nombre}</td>
            <td>${m.tipo}</td>
            <td>${m.estado}</td>
            <td>${m.notas || '-'}</td>
            <td><button class="btn-remove" onclick="eliminarMaterial('${m.id}')">✕</button></td>
        </tr>
    `).join('');
}

function agregarMaterial() {
    const nombre = document.getElementById('matNombre').value.trim();
    const tipo = document.getElementById('matTipo').value;
    const estado = document.getElementById('matEstado').value;
    const notas = document.getElementById('matNotas').value.trim();
    
    if (!nombre) {
        alert('Ingrese el nombre del material');
        return;
    }
    
    const nuevo = {
        id: 'MAT-' + String(biblioteca.materiales.length + 1).padStart(2, '0'),
        nombre,
        tipo,
        estado,
        notas
    };
    
    biblioteca.materiales.push(nuevo);
    guardarBiblioteca();
    renderizarBiblioteca();
    
    // Limpiar formulario
    document.getElementById('matNombre').value = '';
    document.getElementById('matNotas').value = '';
    
    alert('Material agregado');
}

function eliminarMaterial(id) {
    if (!confirm('¿Eliminar este material?')) return;
    
    biblioteca.materiales = biblioteca.materiales.filter(m => m.id !== id);
    guardarBiblioteca();
    renderizarBiblioteca();
}

// ==========================================
// GESTIÓN DE LOTES
// ==========================================

function cargarLotesDesdeStorage() {
    const stored = localStorage.getItem(SU_STORAGE_KEY);
    if (stored) {
        lotesData = JSON.parse(stored);
    }
    actualizarSelectorLotes();
}

function guardarEnStorage() {
    localStorage.setItem(SU_STORAGE_KEY, JSON.stringify(lotesData));
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
    
    // Generar ID si no existe
    if (!lote.id) {
        lote.id = 'SU-' + String(lotesData.length + 1).padStart(4, '0');
    }
    
    // Buscar si existe
    const indiceExistente = lotesData.findIndex(l => l.id === lote.id);
    
    if (indiceExistente >= 0) {
        if (!confirm('Ya existe un registro con este ID. ¿Deseas sobrescribirlo?')) {
            return;
        }
        lotesData[indiceExistente] = lote;
    } else {
        lotesData.push(lote);
    }
    
    guardarEnStorage();
    renderizarRegistroLotes();
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
    
    // Recolectar aditivos
    const aditivos = [];
    document.querySelectorAll('.aditivo-row').forEach(row => {
        const nombre = row.querySelector('.aditivo-select').value;
        const cantidad = parseFloat(row.querySelector('.aditivo-cant').value) || 0;
        if (nombre && cantidad > 0) {
            aditivos.push({ nombre, cantidad });
        }
    });
    
    return {
        id: document.getElementById('loteId').value,
        fecha: document.getElementById('loteFecha').value,
        estructura: document.getElementById('loteEstructura').value,
        steril: parseInt(document.getElementById('loteSteril').value) || 0,
        notas: document.getElementById('loteNotas').value,
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
        pesoXBolsa: bolsas > 0 ? (total / bolsas).toFixed(1) : pesoBolsa
    };
}

function nuevoLote() {
    // Limpiar formulario
    document.getElementById('loteId').value = '';
    document.getElementById('loteEstructura').value = '';
    document.getElementById('loteSteril').value = 0;
    document.getElementById('loteNotas').value = '';
    
    // Resetear calculadora
    document.getElementById('suFibra').value = 0;
    document.getElementById('suRatio').value = 0;
    document.getElementById('suAguaInput').value = '';
    document.getElementById('suPesoAgua').value = '';
    document.getElementById('suTotal').value = '';
    document.getElementById('suBolsas').value = 0;
    document.getElementById('suPesoBolsa').value = 0;
    document.getElementById('suModo').value = 'normal';
    
    // Limpiar aditivos
    const aditivosContainer = document.getElementById('aditivosContainer');
    aditivosContainer.innerHTML = '';
    agregarFilaAditivo();
    
    // Establecer fecha
    establecerFechaActual();
    
    // Resetear selector
    document.getElementById('loteSelector').value = '';
    
    // Recalcular
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
    document.getElementById('loteId').value = lote.id || '';
    document.getElementById('loteFecha').value = lote.fecha || '';
    document.getElementById('loteEstructura').value = lote.estructura || '';
    document.getElementById('loteSteril').value = lote.steril || 90;
    document.getElementById('loteNotas').value = lote.notas || '';
    
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
            agregarFilaAditivo(aditivo.nombre, aditivo.cantidad);
        });
    } else {
        agregarFilaAditivo();
    }
    
    // Cambiar modo
    cambiarModoProduccion();
    
    // Recalcular
    setTimeout(calcularSU, 100);
}

function renderizarRegistroLotes() {
    const tbody = document.getElementById('registroLotesBody');
    const noLotesMsg = document.getElementById('noLotesMsg');
    const tablaRegistros = document.getElementById('tablaRegistros');
    const colsAcciones = tablaRegistros ? tablaRegistros.querySelectorAll('.col-acciones') : [];
    
    if (!tbody || !noLotesMsg) return;
    
    if (lotesData.length === 0) {
        tbody.innerHTML = '';
        noLotesMsg.style.display = 'block';
        colsAcciones.forEach(el => el.classList.remove('visible'));
        return;
    }
    
    noLotesMsg.style.display = 'none';
    
    // Agregar o quitar clase visible según modo
    colsAcciones.forEach(el => {
        if (modoEdicionRegistros) {
            el.classList.add('visible');
        } else {
            el.classList.remove('visible');
        }
    });
    
    // Ordenar por fecha
    const lotesOrdenados = [...lotesData].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    
    tbody.innerHTML = lotesOrdenados.map((lote, index) => {
        const realIndex = lotesData.indexOf(lote);
        const accionesClass = modoEdicionRegistros ? 'col-acciones visible' : 'col-acciones';
        
        return `
            <tr>
                <td>${lote.fecha || '-'}</td>
                <td>${lote.id || '-'}</td>
                <td>${lote.estructura || '-'}</td>
                <td>${lote.fibra || 0}g</td>
                <td>${lote.ratio || 0}</td>
                <td>${lote.agua || 0}ml</td>
                <td>${lote.total || 0}g</td>
                <td>${lote.bolsas || 0}</td>
                <td>${lote.steril || 0}min</td>
                <td>${lote.notas || '-'}</td>
                <td class="${accionesClass}">
                    <button class="btn-small" style="background:var(--primary);color:white" onclick="cargarRegistro(${realIndex})">📂 Cargar</button>
                    <button class="btn-small" style="background:var(--danger);color:white" onclick="eliminarRegistro(${realIndex})">✕</button>
                </td>
            </tr>
        `;
    }).join('');
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
    guardarEnStorage();
    renderizarRegistroLotes();
    nuevoLote();
    alert('Registro eliminado');
}

// ==========================================
// ADITIVOS
// ==========================================

function agregarFilaAditivo(nombre = '', cantidad = 0) {
    const container = document.getElementById('aditivosContainer');
    const row = document.createElement('div');
    row.className = 'aditivo-row';
    
    const opciones = biblioteca.materiales
        .filter(m => m.tipo === 'aditivo' || m.tipo === 'nutricion')
        .map(m => `<option value="${m.nombre}" ${m.nombre === nombre ? 'selected' : ''}>${m.nombre}</option>`)
        .join('');
    
    row.innerHTML = `
        <select class="aditivo-select" onchange="calcularSU()">
            <option value="">-- Seleccionar --</option>
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
    
    const json = JSON.stringify(lote, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sustrato_${lote.id}_${lote.fecha}.json`;
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
                    renderizarBiblioteca();
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
                    guardarEnStorage();
                    renderizarRegistroLotes();
                }
                
                alert('Importación completada:\n- Materiales: ' + nuevosMat + '\n- Registros: ' + nuevosReg);
            } else if (data.id) {
                // Formato de un solo registro
                const existe = lotesData.some(l => l.id === data.id);
                
                if (!existe) {
                    lotesData.push(data);
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
// GENERAR ID
// ==========================================

function generarId() {
    const fecha = new Date();
    const anio = fecha.getFullYear().toString().slice(-2);
    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    const random = Math.floor(Math.random() * 100).toString().padStart(2, '0');
    return `SU-${anio}${mes}-${random}`;
}

// ==========================================
// GENERAR ID AUTOMÁTICO
// ==========================================

document.getElementById('loteId').addEventListener('focus', function() {
    if (!this.value) {
        this.value = generarId();
    }
});

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
                    renderizarBiblioteca();
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
                    // Agregar registros (evitar duplicados por ID)
                    let nuevos = 0;
                    data.forEach(registro => {
                        const existe = lotesData.some(l => l.id === registro.id);
                        if (!existe) {
                            lotesData.push(registro);
                            nuevos++;
                        }
                    });
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
    modoEdicionRegistros = !modoEdicionRegistros;
    const btnEdit = document.getElementById('btnEditRegistros');
    const tablaRegistros = document.getElementById('tablaRegistros');
    
    // Buscar tanto th como td con clase col-acciones
    const colsAcciones = tablaRegistros ? tablaRegistros.querySelectorAll('.col-acciones') : [];
    
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
        
        // Agregar o quitar clase 'visible' a cada elemento
        colsAcciones.forEach(el => {
            if (modoEdicionRegistros) {
                el.classList.add('visible');
            } else {
                el.classList.remove('visible');
            }
        });
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
    guardarEnStorage();
    renderizarRegistroLotes();
    alert('Registro eliminado');
}
