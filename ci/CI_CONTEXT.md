# CI — Módulo Cultivo In Vitro

**Archivo principal:** `ci/ci_app.js` (~6042 líneas, IIFE)  
**HTML:** `ci/ci_index.html` — SPA standalone  
**Comparador:** `ci/ci_comparador.js`  
**Estado:** Activo — módulo operativo central (mayo 2026)  
**Última actualización:** 2026-05-31

---

## 0. Rol en el pipeline

CI es el **laboratorio de inoculación** del sistema. Recibe genéticas de GE, formula medios de cultivo, registra tandas de inoculación, y produce los inóculos validados (cultivos) que consume GR.

```
GE                 CI                         CILAB / GR / FR
(cepas)  →  formula + inocula en placa  →  cultivo disponible → GR
                        ↓
               bl2_pending_crec_action
                        ↓
               CILAB Conocimiento (scoring empírico)
```

**En una oración:** CI convierte una cepa genética + una fórmula de medio en un inóculo trazable con historial completo de contaminación, colonización y consumo.

---

## 1. Storage — fuente de verdad

### Keys que CI **escribe**

| Key | Tipo | Contenido |
|-----|------|-----------|
| `bl2_forms` | Array | Fórmulas de medio CI |
| `bl2_seg` | Array | Tandas de inoculación por fórmula |
| `bl2_cultivos` | Array | Inóculos validados disponibles para GR |
| `bl2_experimentos` | Array | Experimentos comparativos multi-frasco |
| `bl2_seg_notas` | Object | Notas de seguimiento por `formulaId` |
| `bl2_seg_rowimgs_<frmId>` | Object | Evidencia fotográfica por fila de tanda |
| `bl2_col_align` | Object | Preferencias de alineación de columnas |
| `bl2_pending_crec_action` | Object | Handoff a CILAB Conocimiento: `{formulaId}` |
| `bl2_stock_reconcile_v1` | string | Flag de reconciliación de stock (one-shot) |

### Keys que CI **solo lee**

| Key | Propietario | Uso |
|-----|-------------|-----|
| `bl2_ings` | CILAB (SSoT) | Biblioteca de ingredientes |
| `biolab.ge.v4` | GE (SSoT) | Árbol genético para selects |
| `bl2_ci_gr_links` | CiGrLinks | Consumo de cultivos por GR |
| `fr_experimentos` | FR | Consumo de cultivos por experimentos FR |
| `bl2_crec` | CILAB Conocimiento | Ensayos vinculados (en reporte de tanda) |
| `bl2_lab_meta` | CILAB legacy | Fallback export/import |

---

## 2. Schemas de datos

### Formula (`bl2_forms`)

```javascript
{
  id:            'CI-0001',          // autoincremental desde nxtId('CI', forms)
  nombre:        string,
  version:       'v1',
  fecha:         ISO string,
  archivada?:    bool,
  fechaArchivado?: ISO string,
  ingredientes:  [{
    id:       string,               // ref bl2_ings
    qty:      number,
    proy:     number,               // % proyección para escalar qty
    orden:    number,
    snapshot: {                     // INMUTABLE al formular — no se actualiza aunque cambie bl2_ings
      nombre, unidad, aspecto, pc, pn, notas
    }
  }]
}
```

### Tanda/Seguimiento (`bl2_seg`)

```javascript
{
  formula_id:          'CI-0001',
  rowId:               string,      // guid — fuente de verdad de identidad
  tanda:               string,      // label ej: 'CI001'
  genetica:            string,      // id GE (biolab.ge.v4)
  placas:              number,
  contaminados:        number,
  colonizacion:        'YYYY-MM-DDTHH:MM',
  inoculoFecha:        'YYYY-MM-DDTHH:MM', // fecha manual de inoculación
  inoculoTs:           ISO string,  // timestamp automático de inoculación
  inoculoCiId:         string,      // ref bl2_cultivos (Inoculo trace)
  inoculoCiCodigo:     string,
  inoculoCiStock:      number,      // snapshot de stock al guardar
  experimentoId?:      string,      // ref bl2_experimentos
  experimentoFrascoId?: string,     // label del frasco (A, B, C, D)
}
```

### Cultivo (`bl2_cultivos`)

```javascript
{
  _schemaVersion:    1,             // CULTIVO_SCHEMA_VERSION
  id:                'cci_<base36>_<6hex>',
  codigo:            'CI-2026-0001', // formato humano, no se reutiliza
  seguimientoId:     string,        // rowId del SEG que lo generó
  geneticaId:        string,        // ref biolab.ge.v4
  geneticaSnapshot:  { codigoGE, label, especie, cepa, fenotipo },
  tipo:              'PLACA' | 'FRASCO',
  cantidadInicial:   number,
  cantidadDisponible: number,       // campo mantenido, pero stock real = ver §6
  estado:            'DISPONIBLE' | 'RESERVADO' | 'AGOTADO' | 'DESCARTADO',
  fechaCreacion:     ISO string,
  fechaValidacion:   ISO string,
  consumos:          [],            // LEGACY — no usar. SSoT = bl2_ci_gr_links
  medioFormulaId?:   string,        // ref bl2_forms
  generacion?:       number,
  parentCultivoId?:  string,
  fechaCaducidad?:   string,
  notas?:            string,
  experimentoId?:    string,        // trazabilidad hasta frasco
  experimentoFrascoId?: string,
}
```

### Experimento (`bl2_experimentos`)

```javascript
{
  id:        'EXP-0001',
  formulaId: string,
  nombre:    string,
  volBase:   number,               // ml del frasco base de referencia
  frascos:   [{
    label:     string,             // 'A', 'B', 'C', 'D'
    volFrasco: number,             // ml
    extras:    [{ ingId, qty, unidad }]  // ingredientes adicionales vs base
  }],
  createdAt: ISO string,
}
```

---

## 3. Capas del módulo

### Capa 1 — Motor C/N

```
calcCN(ingRows, allIngs)
  → { c, n, masa, rows }
  Prefiere snapshot sobre ingrediente vivo: editar bl2_ings no altera fórmulas ya guardadas.
  Normaliza mg → g para cálculo de masa.

_ingSnapshot(ingId, allIngs)
  → snapshot inmutable del ingrediente al momento de formular
```

### Capa 2 — CRUD de Fórmulas

```
ciSaveNewFrm()           → crea nueva fórmula en bl2_forms con snapshot de ings
frmEditField(id, campo)  → edita campo de fórmula guardada
delFrmFromCI(id)         → elimina fórmula (pregunta por tandas/cultivos activos)
ciArchivarFormula(id)    → archiva sin borrar (cultivos siguen disponibles)
ciRestaurarFormula(id)   → des-archiva
dupFrmWithProjection(id) → duplica aplicando % proy a cada ingrediente
ciCargarComoBase(id)     → carga fórmula como plantilla en el constructor
```

### Capa 3 — SEG (Campo de Trabajo)

```
segGuardarTandas(frmId)       → DOM → bl2_seg (con guardia anti-corrupción)
segCargarTandas(frmId)        → bl2_seg → DOM (setTimeout 100ms)
segActualizarResumen(frmId)   → auto-save debounced 800ms
_ciSyncCultivosFromSeg(frmId) → al colonizar: crea/actualiza bl2_cultivos
segEmitirNotaAuto(frmId, ...)  → nota de sistema en bl2_seg_notas
```

### Capa 4 — Cultivos CI

```
_ciCultivosInit()           → idempotente: crea [] si key ausente o corrupta
_ciCultivosAutoArchivar()   → DISPONIBLE → CADUCADO si > 60 días
_ciCultivoCreate(input)     → factory + validación + persist + dispatch
ciListCultivosDisponibles() → filtra DISPONIBLE con stock > 0
ciGetCultivoById(id)        → por id
ciGetCultivosByGenetica(gId)→ todos los estados (para trazabilidad)
_ciCultivoConsumir(params)  → reduce cantidadDisponible + escribe bl2_ci_gr_links
_ciCultivoDevolverConsumoPorRef() → deshace consumo por ref GR
```

### Capa 5 — Experimentos

```
expLoad() / expSave()  → bl2_experimentos
expAbrirCrear(frmId)   → modal de creación con infere volBase desde ings ml
expEditar(expId, frmId)→ modal en modo edición
expGuardar()           → valida + persiste + renderiza lista
expEliminar(expId)     → borra experimento + limpia filas SEG vinculadas
_expInferVolBase(f)    → suma qty de ings con unidad 'ml'
_expSyncFrascosDesdeDOM() → lee modal DOM → _expState antes de cada operación
```

### Capa 6 — Stock real

```
segStockRealCultivo(ciId)
  = cantidadInicial
    − CiGrLinks.stockConsumidoByCultivo(ciId)  // consumo GR
    − _exConsumidoByCultivo(ciId)               // consumo FR experimentos
```

---

## 4. UI — estructura de subtabs

```
ci_index.html
  ├── Header: "BIOLAB ENGINE v3 — Cultivo In Vitro"
  │     Stats: Fórmulas | Tandas
  │
  ├── SubNav
  │     📊 Dashboard | 🧪 Formulación | 🧫 Cultivos | ⚛️ Ingredientes
  │
  ├── #ci-sub-dashboard
  │     ├── Grid de tiles de fórmulas (ciRenderDashboard)
  │     │     tile: nombre · id · C/N · masa · ings · ratio sanas/total · Exp count · notas
  │     │     → click → ciDashOpenFormula → ciDashRenderDetalle
  │     └── #ci-dash-detalle-wrap (detail view colapsable)
  │           ↳ botón 📊 Comparar fórmulas → window.ciComparador.activarModoComparacion()
  │
  ├── #ci-sub-form
  │     ├── Constructor nueva fórmula
  │     │     ├── Nombre + fecha + ID readonly
  │     │     ├── Lista DnD de ingredientes (select + qty + chip unidad)
  │     │     ├── Tabla análisis C/N
  │     │     └── Panel derecho: donut chart + KPIs (C, N, C/N, Masa)
  │     │
  │     └── Lista de fórmulas (tiles)
  │           ├── "📋 Usar como base" → ciCargarComoBase
  │           ├── Filtro archivadas toggle
  │           └── Cada tile expande: tabla SEG + experimentos + seguimiento
  │                 ├── segTbody-<frmId>         ← sección base
  │                 ├── segTbody-<frmId>--<EXP>--<FRASCO>  ← sección por frasco
  │                 ├── Note drawers por fila (📝)
  │                 ├── Foto panel por fila (📷)
  │                 └── Panel seguimiento por tanda (cards colapsables)
  │
  ├── #ci-sub-cultivos
  │     Tabla de bl2_cultivos: Código · Genética · Tipo · Estado ·
  │     Disp/Inicial · Validación · Fórmula · Consumo GR · Acciones
  │     Filtros: estado | tipo | búsqueda texto
  │
  └── #ci-sub-cfg
        Read-only view de bl2_ings
        Banner: "CILAB — SINGLE SOURCE OF TRUTH"
        Botones redirect: → Crear en CILAB | → Ir a CILAB
```

---

## 5. Funciones expuestas globalmente

```javascript
// Init y ciclo de vida
ciInit()                      // → auto-invocado al cargar; registra listeners
window.onModuleUnload()        // → persiste tandas + limpia listeners

// Navegación
ciSubTab(name)                 // dashboard | form | cultivos | cfg
ciIrACilab()                   // → loadModule('CILAB')
ciIrACilabCrear()              // → CILAB + clabSubTab('biblioteca')
ciIrACilabEditar(ingId)        // → CILAB + clabOpenIngDetail(ingId)

// Constructor nueva fórmula
ciNewFrmAddRow(ingId?, qty?)   // + ingrediente con suscripción IngStore
ciNewFrmCalc()                 // recalcula C/N y gráfico donut
ciSaveNewFrm()                 // guarda nueva fórmula en bl2_forms

// Fórmulas guardadas
frmToggle(id)                  // expande/colapsa card
frmToggleEdit(id)              // activa modo edición inline
frmEditField(id, campo, val)   // edita campo individual
delFrmFromCI(id)               // elimina con confirm
dupFrmWithProjection(id)       // duplica aplicando proy
frmAddIngRow(id)               // agrega ing a fórmula guardada
frmDelIngRow(id, ingId)        // elimina ing de fórmula guardada
frmIngShowSelect(id, idx, el)  // abre floating dropdown
frmIngQtyChange(id, idx, qty)  // edita cantidad
frmIngProyChange(id, idx, proy)// edita proyección
ciArchivarFormula(id)          // archiva
ciRestaurarFormula(id)         // restaura
ciCargarComoBase(id)           // carga como plantilla
ciToggleMostrarArchivadas()    // toggle archivadas en lista
toggleAspFilter(id, asp, el)   // filtro visual por aspecto
toggleColAlign(id, col, th)    // alineación de columna

// Dashboard
ciRenderDashboard()            // renderiza grid de tiles
ciDashOpenFormula(id)          // abre detalle de fórmula
ciDashRenderDetalle(id)        // renderiza panel de detalle
ciDashVolverGrid()             // vuelve al grid

// SEG — Campo de Trabajo
segAddRow(frmId)               // agrega fila de tanda (sección base)
segAddRowFrasco(frmId, expId, frascoLabel) // agrega fila en frasco de exp
segRemoveRow(btn)              // elimina fila con confirm
segGuardarTandas(frmId)        // guarda DOM → bl2_seg
segToggleEditMode(frmId)       // activa/desactiva modo edición de filas
segOnChangeGenetica(sel)       // handler cambio de cepa
segOnChangePlacas(inp)         // handler cambio placas
segOnChangeContaminados(inp)   // handler cambio contaminados
segOnChangeColonizacion(inp)   // handler colonización → sync cultivos
segOnChangeInoculoCi(sel)      // handler cambio Inoculo trace
segActualizarResumen(frmId)    // auto-save debounced 800ms
segRefrescarSelectoresInoculo()// refresca todos los selects de inóculo

// Seguimiento notas
segAddSeguimientoNota(frmId)   // proxy → segAddNotaCard(frmId, '__general__')
segToggleTandaCard(frmId,tid)  // toggle card de tanda
segAddNotaCard(frmId, tid)     // agrega nota a una tanda
segEditarNota(idx, frmId)      // edita nota existente
segEliminarSeguimientoNota(i,frmId) // elimina nota
segAbrirReporteTanda(btn)      // 📊 abre reporte de trazabilidad de una tanda
segCerrarReporte()             // cierra overlay de reporte

// Note drawers (inline)
segToggleNoteDrawer(btn, frmId, rowId) // toggle drawer de notas
segDwSetEstado(btn, frmId, rowId, est) // cambia estado de nota
segAddNotaDrawer(btn, frmId, rowId)    // agrega nota desde drawer

// Fotos
segToggleFotoPanel(btn, frmId)
segAgregarFotosFila(rowId, frmId, input)
segEliminarFotoFila(rowId, frmId, idx)
segLightbox(rowId, idx)

// Handoff a CILAB Conocimiento
segAbrirObsCrecimiento(btn)    // 🌱 → bl2_pending_crec_action + navegar

// Bridge CI ↔ CILAB
_segSyncColonizacionFromCilab(frmId, data) // CILAB → CI: sync colonización + notas
_ciSyncCultivosFromSeg(frmId)              // CI interno: colonización → cultivos

// Cultivos tab
renderCultivosTab()            // lista bl2_cultivos con filtros
ciFiltrarCultivos()            // filtra por estado/tipo/texto
ciDescartarCultivo(id)         // descarta con confirm
ciEditarCultivoNotas(id)       // edita notas del cultivo
ciToggleConsumos(id)           // expande/colapsa historial de consumo GR

// Modo Experimento
expAbrirCrear(frmId)           // abre modal de nuevo experimento
expEditar(expId, frmId)        // abre modal en modo edición
expCerrarModal()               // cierra modal
expOnNFrascosChange(n)         // ajusta cantidad de frascos
expAgregarExtra(idx)           // agrega extra a frasco idx
expQuitarExtra(idx, ei)        // quita extra
expGuardar()                   // valida + persiste + cierra modal
expTogglePanel(frmId)          // toggle panel de experimentos
expToggleTabla(expId, frmId)   // toggle tabla comparativa
expEliminar(expId, frmId)      // elimina experimento + filas SEG vinculadas

// Export/Import/Migración
exportData()                   // backup JSON completo
exportFormulaJSON(id)          // exporta fórmula individual
ciExportExcel()                // copia tabla para Excel
importData(event)              // importa desde JSON
resetSystem()                  // reset módulo CI (con confirm)
ciMigrarSnapshotsIngredientes()// backfill de snapshots en fórmulas legacy
ciMigrarBioIngredientes()      // migra metadata bio de ingredientes

// Floating dropdown (ingredientes)
closeFloatingDropdown()
fddFilter(q)
fddSelectItem(itemId)

// window.CI (API pública para GR y otros módulos)
window.CI.listCultivosDisponibles(filtros)    // Array<Cultivo> DISPONIBLE con stock > 0
window.CI.getCultivoById(id)                   // Cultivo | null
window.CI.getCultivosByGenetica(geneticaId)    // Array<Cultivo> (todos los estados)
window.CI.getConsumosByCultivo(cultivoId)      // Array<Consumo> vía CiGrLinks
window.CI.getSchemaVersion()                   // 1
window.CI.consumirCantidad(params)             // reduce stock + escribe link
window.CI.devolverConsumoPorRef(params)        // deshace consumo por ref

// Globales de datos
window.getIngredientes()    // lee bl2_ings (vía IngStore o directo)
window.getForms()           // lee bl2_forms
```

---

## 6. Invariantes críticos

- **Snapshot inmutable**: `_ingSnapshot()` captura estado del ingrediente al formular. Editar `bl2_ings` después no afecta fórmulas guardadas. `calcCN` prefiere snapshot sobre live.
- **CILAB es SSoT de bl2_ings**: CI no escribe bl2_ings. El editor de ingredientes fue eliminado de CI. Redirect obligatorio a CILAB.
- **`window.CI` asignación incondicional**: Cada carga del IIFE reemplaza `window.CI` sin guard `if (!window.CI)` — evita closures muertas de recargas anteriores.
- **Guardia anti-corrupción de SEG**: `segGuardarTandas` aborta si DOM=0 filas pero storage tiene datos — previene race condition entre autosave (800ms) y `segCargarTandas` (setTimeout 100ms).
- **Stock real tri-fuente**: `cantidadInicial − grConsumido (CiGrLinks) − frConsumido (fr_experimentos)`. `cantidadDisponible` en el objeto cultivo es campo legacy mantenido por compatibilidad.
- **Vintage option**: El select de Inoculo trace preserva el cultivo seleccionado aunque ya no esté disponible (agotado/descartado/archivado), para trazabilidad histórica de tandas pasadas.
- **Auto-caducidad**: `_ciCultivosAutoArchivar()` en cada `ciInit()` marca DISPONIBLE → CADUCADO si `Date.now() - fechaCreacion > 60 días`.
- **`_ciCultivoFactory` colisión**: Detecta colisión de id/código dentro de la misma pestaña. Cross-tab: limitación documentada de v1 (race condition en generación de código).
- **SEG secciones**: Las filas de tanda se distribuyen en tbodys con ID `segTbody-<frmId>` (base) o `segTbody-<frmId>--<expId>--<frascoLabel>` (frasco). Si el tbody de destino no existe (experimento eliminado), la fila cae al base — trazabilidad intacta.
- **onModuleUnload persiste antes de destruir DOM**: Limpia timers y llama `segGuardarTandas` en todos los tbodys visibles antes del unmount.

---

## 7. Race conditions conocidas

| Race | Descripción | Mitigación |
|------|-------------|------------|
| SEG autosave vs carga DOM | 800ms debounce puede disparar antes de que `segCargarTandas` (100ms) reconstruya filas | Guard: abort si DOM=0 y storage tiene datos |
| `ciRenderDashboard` destruye DOM sin guardar | Llamar `ciSubTab('dashboard')` mientras el detalle está abierto borraba `dw.innerHTML` sin persistir primero — **corregido mayo 2026** | `ciRenderDashboard` ahora llama `segGuardarTandas` para todos los tbodys activos antes de limpiar, igual que `ciDashVolverGrid` |
| GE no montado | `segInicializarGeneticas` necesita árbol genético antes de que GE module esté activo | Fallback: lee `biolab.ge.v4` directo desde localStorage |
| Cross-tab código cultivo | Dos tabs simultáneas generan `CI-2026-NNNN` con mismo N | Documentado como limitación de v1 |
| CILAB no montado para navegación | `segAbrirObsCrecimiento` navega a CILAB y espera max 15 reintentos (80ms c/u) antes de renunciar | `bl2_pending_crec_action` queda en storage como fallback |
| IngStore no disponible | CI usa `window.IngStore.subscribe` para actualizar selects reactivamente | Fallback: `localStorage.getItem(K.ings)` directo |

---

## 8. Eventos y comunicación inter-módulo

### CI escucha

| Evento | Fuente | Acción |
|--------|--------|--------|
| `cilab-ings-changed` | CILAB | `renderCfg()` + `ciRenderFormulasList()` |
| `cilab-formulas-changed` | CILAB | `ciRenderFormulasList()` + `updateHeader()` |
| `ci-cultivos-changed` | CI interno / GR | `renderCultivosTab()` si está visible |
| `storage` (cross-tab) | Navegador | sync `bl2_ings` y `bl2_forms` |

### CI dispara

| Evento | Cuándo | Quién escucha |
|--------|--------|---------------|
| `ci-cultivos-changed` | Al crear/modificar cultivo | GR, CI tab cultivos |
| `cilab-ings-changed` | Legacy (si CI modifica ings) | CILAB, CI |

### Puentes directos (llamadas a window)

| Desde → Hacia | Mecanismo |
|--------------|-----------|
| CI → CILAB | `window.loadModule('CILAB')` + `window.clabSubTab()` |
| CI → CILAB Conocimiento | `bl2_pending_crec_action` en localStorage |
| CILAB → CI | `_segSyncColonizacionFromCilab(frmId, data)` |
| GR → CI | `window.CI.*` API |
| CI → GR | `window.CiGrLinks.*` (stockConsumido, reconcile) |
| CI → FR | Lee `fr_experimentos` para descontar stock |

---

## 9. Flujo completo: de fórmula a inóculo disponible en GR

```
1. FORMULACIÓN
   Formulación tab → constructor nueva fórmula
   → ciSaveNewFrm() → snapshot ings capturado → bl2_forms

2. SEG — INOCULACIÓN
   En el tile de la fórmula, usuario agrega fila de tanda:
   - Selecciona cepa (de GE via select)
   - Selecciona Inoculo trace (de bl2_cultivos disponibles)
   - Registra fecha de inoculación → D+ counter en tiempo real
   - Registra placas + contaminados
   → segGuardarTandas → bl2_seg

3. EXPERIMENTO (opcional)
   Botón "🔬 Nuevo Experimento" → modal
   → Nombre + volBase + frascos A/B/C con extras opcionales
   → expGuardar() → bl2_experimentos
   → Filas de tanda se asocian a experimentoId + frascoLabel
   → Tabla comparativa C/N calculada por frasco

4. COLONIZACIÓN
   Usuario llena fecha de colonización en la fila SEG
   → segOnChangeColonizacion → segActualizarResumen (debounce)
   → segGuardarTandas → bl2_seg
   → _ciSyncCultivosFromSeg(frmId) → _ciCultivoCreate()
   → bl2_cultivos ← nuevo cultivo DISPONIBLE
   → evento ci-cultivos-changed

5. HANDOFF A CONOCIMIENTO
   Usuario hace clic 🌱 en la fila de tanda
   → segAbrirObsCrecimiento()
   → bl2_pending_crec_action = {formulaId}
   → loadModule('CILAB') → clabSubTab('conocimiento')
   → Conocimiento abre scoring panel de la fórmula

6. CONSUMO POR GR
   GR accede via window.CI.listCultivosDisponibles()
   → selecciona cultivo
   → window.CI.consumirCantidad({cultivoId, cantidad, grLoteId})
   → actualiza cantidadDisponible en bl2_cultivos
   → escribe link en bl2_ci_gr_links
   → evento ci-cultivos-changed

7. CONSUMO POR FR
   FR registra insumo {tipo:'ci', ciId, cantidad} en fr_experimentos
   → CI deduce stockReal leyendo fr_experimentos al consultar stock

8. TRAZABILIDAD
   segAbrirReporteTanda(btn) → overlay con:
   - Datos de la tanda (genética, placas, ratio)
   - Cultivos generados desde esta tanda
   - Consumos GR vinculados
   - Ensayos CILAB vinculados (bl2_crec)
   - Últimas notas CI
```

---

## 10. Para una nueva sesión de IA

Antes de tocar este módulo, leer en orden:

1. Este archivo completo
2. `ci/ci_index.html` — para entender la estructura HTML de los subtabs
3. `git log --oneline -10 -- ci/`
4. Las funciones específicas de la sección a modificar
5. Si toca SEG/tandas: leer `segGuardarTandas`, `segCargarTandas`, la guardia anti-corrupción (línea ~2666), y el schema de tanda
6. Si toca cultivos: leer `_ciCultivoFactory`, `_ciCultivoCreate`, `_ciSyncCultivosFromSeg`, `window.CI`
7. Si toca stock: entender la cadena tri-fuente (`segStockRealCultivo`, `CiGrLinks`, `_exConsumidoByCultivo`)
8. Si toca experimentos: leer `expLoad/expSave`, `_expState`, `expGuardar`, el schema de `bl2_experimentos`
9. Si toca el handoff a CILAB: leer `segAbrirObsCrecimiento`, `bl2_pending_crec_action`, `_segSyncColonizacionFromCilab`

**El módulo NO es decorativo.** `bl2_cultivos` es la fuente de verdad que consume GR. Un cultivo creado incorrectamente, o stock computado erróneamente, corrompe silenciosamente la trazabilidad de toda la cadena CI → GR → SU → FR.

**Cambios recientes (mayo 2026):**
- `segStockRealCultivo`: stock ahora descuenta también `fr_experimentos` (antes solo GR)
- `reconcileAllStock()` one-shot al init para corregir discrepancias históricas `cantidadDisponible` vs links activos
- `sDB`/`sOb` con try-catch; `gOb` con falsy-check
- `IngStore` double-load guard
- `ciFormatDate` corrige Invalid Date con fallback a `String(iso)`
