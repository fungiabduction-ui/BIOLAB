# CILAB — Módulo Conocimiento

**Archivo:** `cilab/cilab_conocimiento.js` (~5700 líneas, no-IIFE)  
**Estado:** Activo, módulo más complejo de CILAB (mayo 2026)  
**Última actualización:** 2026-05-31

---

## 0. Rol en el pipeline

Conocimiento es el **laboratorio empírico de CILAB**. Recibe fórmulas del Analizador, registra qué pasó cuando se inocularon en el laboratorio físico, y produce los datos que alimentan tanto la calibración del Optimizador como el motor de Inteligencia.

```
CILAB Analizador          Conocimiento                  Inteligencia
(score teórico)  →  registra ensayos reales   →   aprende de esos ensayos
                          ↓
                   calibra el Optimizador
                   (bias de cepa + synergy)
```

**En una oración:** Conocimiento convierte observaciones de placa en conocimiento estructurado que hace más inteligente a todo el sistema.

---

## 1. Storage — fuente de verdad

### Key principal: `bl2_crec` — Array\<CRERecord\>

```
CRERecord {
  id:               'CRE-0001'           — ID autoincremental (re-lee storage para evitar race condition)
  formulaId:        string               — referencia a bl2_forms
  tandaId?:         string               — referencia a bl2_tandas (opcional)
  formulaSnapshot:  { nombre, ings: [{id, nombre, qty, unidad}] }
                                         — SNAPSHOT INMUTABLE al momento del ensayo
  geneticaId?:      string               — referencia a bl2_ge
  geneticaLabel:    string               — label de la cepa (desnormalizado para render sin GE)
  inoculationDate:  'YYYY-MM-DD'         — desde CI cuando hay link
  createdAt:        ISO string
  status:           'activo' | 'cerrado'
  observaciones:    Array<CREObs>
  scoreFinal?:      0-10                 — se asigna al cerrar (scoreObservado de definitiva)
  scoreFinalNorm?:  0-100                — scoreFinal × 10 (escala del motor teórico)

  — Links a CI (opcionales, backward compatible)
  cultivoId?:       string               — bl2_cultivos.id → fuente de totalPlacas + inoculationDate
  experimentoId?:   string               — bl2_experimentos.id
  frascoId?:        string               — frasco.id dentro del experimento

  — Datos de rizomorfismo (nivel record)
  rizoPozitivas?:   number               — placas/colonias con rizo (de obs definitiva)
  totalPlacas?:     number               — total placas del ensayo
  notasRizo?:       string               — notas globales del ciclo
}
```

### CREObs — observación individual

```
CREObs {
  tipo:     'lag' | 'temprana' | 'preliminar' | 'definitiva'
            — fases del ciclo de colonización
  dia:      number               — días desde inoculación
  fecha:    'YYYY-MM-DD'

  — Fenotipo y morfología
  notasMorf?:           string   — notas libres (reemplaza velocidad+color legacy)
  fenotipo?:            'rizo_extremo' | 'rizo' | 'normal' | 'tomentoso'
  cordones?:            bool
  crecimientoDirigido?: bool
  dominanciaApical?:    bool
  zonasRizo?:           bool

  — Score
  scoreObservado?:      0-10
  calidad?:             'excellent' | 'moderate' | 'poor'

  — Incidencia (por fase)
  rizoPozitivas?:       number
  totalPlacas?:         number

  notas:                string
  createdAt:            ISO
}
```

### Keys secundarias

| Key | Contenido |
|-----|-----------|
| `bl2_crec_notas` | Notas de trazabilidad por fórmula+cepa |
| `bl2_crec_fases` | Fases del ciclo registradas (lag, temprana, etc.) — keyed `formulaId__geneticaId` |
| `bl2_lab_rizo_learn` | Índice RizoLearn cacheado |
| `bl2_pending_crec_action` | Handoff desde CI (formulaId a abrir al montar) |
| `bl2_crec_excluded_forms` | Fórmulas desacopladas del motor (no calibran) |
| `bl2_seg_notas` | Notas CI — Conocimiento escribe aquí, nunca modifica schema CI |

**Nota importante sobre `bl2_crec_fases`:** Las fases se almacenan con clave `formulaId__geneticaId` sin contexto de frasco. La separación por frasco se hace a nivel de **log** (notas) con `experimentoId`+`frascoId`, no a nivel de datos de fases.

### Schema de notas (`bl2_crec_notas`)

```
nota {
  id:            string
  ts:            ISO string
  texto:         string           — auto-descriptivo: incluye "🔬 Frasco X · " cuando aplica
  auto:          bool             — true = generada por el sistema; false = manual del usuario
  logType:       'score' | 'fase' | 'nota'
  experimentoId?: string          — frasco context (CRÍTICO para aislamiento de logs)
  frascoId?:     string           — frasco context (CRÍTICO para aislamiento de logs)
  faseId?:       string           — solo en logType === 'fase'
  faseColor?:    string
  dia?:          number
  cepaLabels?:   string[]         — solo en logType === 'score' (batch)
  cepaIds?:      string[]
  imagenes:      []
}
```

**Invariante de aislamiento:** Toda nota auto con `experimentoId`+`frascoId` pertenece EXCLUSIVAMENTE a ese frasco. El filtro de `_creMatrixLogHTML` garantiza que notas sin `experimentoId` solo aparezcan en vista BASE (sin filtro de frasco).

---

## 2. Capas del módulo

### Capa 1 — Storage y CRUD

```
creRead()             → Array<CRERecord> (aplica migración automática)
creWrite(arr)         → persiste + invalida bl2_inteligencia_model
creGet(id)            → CRERecord | null
creCreate({...})      → nuevo CRERecord en bl2_crec
creAddObs(id, obs)    → agrega observación a un record
creDeleteEnsayo(id)   → borra un record individual
creDeleteFormula(id)  → borra TODOS los datos de la fórmula: bl2_crec + bl2_crec_fases + bl2_crec_notas
```

**Invariante crítico:** `creWrite()` siempre invalida `bl2_inteligencia_model` — garantiza que el motor OLS no sirva datos stale cuando cambian los ensayos.

**Schema versioning:** `migrateCreRecord()` es idempotente. Incrementar `CRE_SCHEMA_VERSION` cuando el schema evolucione. Se aplica en cada `creRead()`.

### Capa 2 — Motor de calibración

```
getCalibrationModel()
  Input:  bl2_crec (records cerrados, filtrados por motor)
  Output: {
    strains: {
      geneticaId: {
        totalTrials: number,
        bias:        number,   ← delta promedio (empírico - teórico) por cepa
        ingData: {
          ingId: { count, avgDelta }   ← delta promedio cuando este ing está presente
        }
      }
    },
    globalIngs: { ingId: { count, avgDelta } }
  }

getCalibratedScore(formulaIngs, geneticaId)
  → { theoreticalScore, calibratedScore, bias, netCalibration, corrections[] }
  → calibratedScore = thScore + bias + Σ(synergy_i por ingrediente presente)
  → synergy_i = ingData[i].avgDelta − bias
  → mínimo 2 ensayos para aplicar calibración (con N=1 el bias es ruido puro)
```

### Capa 3 — RizoLearnIndex

```
computeRizoLearnIndex() / rizoLearnGet() / rizoLearnInvalidate()
```

Índice de frecuencia: mide "¿en qué % de fórmulas con rizomorfismo apareció este ingrediente?". Lo usa el Analizador para sugerencias de "aprende de tus mejores fórmulas".

### Capa 4 — Score compuesto

```
_creCompoundAvg(fRecs)
  = promedio de (Math.round(scoreFinalNorm/10) × rizoPozitivas/totalPlacas)
  Fallback (sin datos de placas): promedio simple de scoreFinalNorm/10
```

`rizoPozitivas/totalPlacas` puede superar 1.0 → Score compuesto puede superar 10. No es un bug.

### Capa 5 — Integración con CI

Puente unidireccional: Conocimiento escribe en `bl2_seg_notas` (visible en CI), nunca modifica estructuras de CI.

---

## 3. UI — estructura del tab

```
renderConocimiento()
  ├── Header (título + botones: Exportar, Importar, Reparar datos, Regenerar logs, Log, Purgar)
  ├── _creHowGuideHTML()          — guía colapsable "¿Cómo funciona?"
  ├── #cre-grid-wrap
  │     └── _creRenderGrid()      — grid de tarjetas de fórmulas
  │
  ├── #cre-detalle-wrap           — panel de detalle (oculto por defecto)
  │     └── Scoring panel completo de la fórmula seleccionada
  │
  └── #cre-matrix-log-panel       — log global de eventos (toggle)
```

### Scoring Panel

```
creOpenScoringPanel(formulaId)
  ├── Header: ← volver | nombre fórmula | 🗑 Limpiar todo (borra todo con confirm)
  ├── _creFormulaPanelHTML()      — score teórico, C/N, ingredientes
  ├── _creFrascoTabsHTML()        — tabs de frascos de experimento (sin BASE, sin Control oculto)
  ├── _creScoringPanelHTML()      — cepa cards + batch controls + log
  │     ├── cepa cards (expandibles)
  │     │     ├── _creFasesScrubberHTML()  — scrubber con dot Hoy (amarillo pulsante)
  │     │     ├── _creScoringScoreTabHTML() — score + incidencia
  │     │     └── notas
  │     ├── Batch controls (cuando hay cepas seleccionadas)
  │     │     ├── _creBatchFasesScrubberHTML() — scrubber batch con stage+confirm
  │     │     ├── Confirmación fase staged (amarillo pulsante → [✓ Guardar] [✕])
  │     │     ├── Score grid, Tipo cordón, Incidencia
  │     │     └── Score compuesto batch
  │     └── Log section (◉ Log · Frasco X | ◉ Log · Base | ◉ Log)
  └──
```

### Frascos de experimento — comportamiento crítico

- **Tab BASE eliminado**: `_creFrascoTabsHTML` no renderiza tab "Base" ni tab de frascos sin extras (Control). TODOS los frascos de experimento se muestran, incluyendo los de Control.
- **Auto-selección**: `creOpenScoringPanel` siempre selecciona el frasco con más actividad (o el primero) cuando hay experimentos.
- **Aislamiento defensivo**: Cada frasco tiene sus propios registros de score, incidencia y logs. Los logs de fases también quedan aislados por frasco desde mayo 2026.

### Scrubber de fases — comportamiento

```
Individual (por cepa):
  · Drag de dot → creScrubStart → guarda inmediatamente en pointerup
  · Dblclick en dot registrado (excepto inoculación) → creDeleteFaseFromScrubber
    → borra la fase Y su entrada de log para ese frasco
  · Dot amarillo pulsante "Hoy" = días desde inoculación, no interactivo

Batch (cuando hay cepas seleccionadas):
  · Drag de dot → creBatchScrubStart → STAGEA (no guarda todavía)
  · Dot staged aparece en amarillo pulsante + panel de confirmación
  · creBatchFaseConfirm → guarda en TODAS las cepas seleccionadas + logs con contexto de frasco
  · creBatchFaseCancel → descarta sin guardar
  · Dot amarillo "Hoy" = fecha de la primera cepa seleccionada
```

### Log — aislamiento por frasco

```
_creLogFase(formulaId, gId, faseId, dia, fecha, isEdit, frascoCtx)
  · Cuando frascoCtx = _sp.frasco: tagea la nota con experimentoId + frascoId
  · Prefija el texto con "🔬 Frasco X · " para identificación visual
  · Busca entrada existente SOLO dentro del mismo frasco (no pisa logs de otros frascos)

_creMatrixLogHTML(filterFormulaId, filterFrascoCtx)
  · Notas manuales (auto=false): siempre visibles en cualquier frasco
  · Notas auto SIN experimentoId: solo visibles en BASE (sin filtro de frasco)
  · Notas auto CON experimentoId: solo visibles en el frasco que las generó
  · Título: "◉ Log · Frasco X" | "◉ Log · Base" (fórmulas con exp.) | "◉ Log" (sin exp.)
```

---

## 4. Estado del scoring panel (`_sp`)

```javascript
_sp = {
  formulaId:       string | null,
  cepaId:          string | null,
  score:           number | null,
  tipo:            string | null,
  tab:             'fases' | ...,
  frasco:          null | { expId, frascoId, frascoLabel, extras, expNombre },
  selected:        Set<string>,       // keys: expId|frascoLabel|geneticaId
  expandedCepaId:  string | null,
  batchScore:      number | null,
  batchTipo:       string | null,
  batchFasePos:    { faseId: dia },   // posiciones guardadas en batch scrubber (resetea al cerrar panel)
  batchStagedFase: { faseId, dia } | null,  // fase pendiente de confirmar en batch
}
```

`_spReset(formulaId)` limpia todo el estado al abrir un nuevo panel o cerrar.

---

## 5. Funciones expuestas globalmente (onclick en HTML)

```javascript
// Render principal
renderConocimiento()

// Grid
creSetFormulaSort(mode)
creToggleFormulaMotor(id)

// Scoring panel
creOpenScoringPanel(formulaId)
creCloseScoringPanel()
creSetScoringCepa(formulaId, geneticaId)
creSetScoringFrasco(formulaId, frascoKey)
creSelectScore(n)
creSelectTipo(tipo)
creUpdateCompound(formulaId)
creSubmitScoringPanel(formulaId)
creWipeFormulaFases(formulaId)    — NUEVO: borra todo (score+fases+logs) con confirm → llama creDeleteFormula

// Batch score
creSelectAllCepas(formulaId)
creSelectBatchScore(n)
creSelectBatchTipo(tipo)
creUpdateBatchCompound(formulaId)

// Batch fases — NUEVOS
creBatchFaseConfirm(formulaId)    — confirma fase staged → guarda en todas las cepas seleccionadas
creBatchFaseCancel(formulaId)     — descarta fase staged

// Scrubber
creScrubStart(evt, formulaId, geneticaId, faseId)   — drag individual
creBatchScrubStart(evt, formulaId, faseId)           — drag batch (NUEVO)
creFaseScrubSave(formulaId, geneticaId, faseId, dia)
creDeleteFaseFromScrubber(evt, formulaId, geneticaId, faseId)  — NUEVO: dblclick elimina fase + log

// Fases (registro modal)
creRegisterFase(formulaId, geneticaId, faseId)
creRegisterFaseConfirm(...)
creEditFase(formulaId, geneticaId, faseId)
creColonizacionCierrePrompt(formulaId, geneticaId, dias)

// Notas
creNotaEnviar(formulaId, geneticaId)
creNotaEliminar(formulaId, geneticaId, notaId)
creNotaEditarStart/Guardar/Cancelar(...)

// Log
creDeleteLogEntry(entryId, formulaId, geneticaId)
creToggleMatrixLog()

// Export/Import/Maintenance
creExportJSON()
creImportJSON(input)
crePurgarConocimiento()
creRepararDatosDeExperimentos()  — EXTENDIDO: ahora también repara fase logs via _creRegenFaseLogs()
creBackfillLogs()
```

---

## 6. Invariantes críticos

- **`creWrite()` invalida el modelo OLS** — cualquier cambio en bl2_crec requiere recalcular Inteligencia
- **`formulaSnapshot` es inmutable frente a ediciones posteriores de la fórmula** — se guarda al crear el record, nunca se actualiza aunque el usuario edite `bl2_forms` después. **Excepción única y deliberada (aclarado 2026-07-10):** `_creBackfillExtras`/`_creExtrasBackfill`/`_creExtrasBackfillV2` SÍ mutan `formulaSnapshot.ings` de records ya creados, pero solo para completar retroactivamente "extras" de `bl2_experimentos` que un bug de normalización volumétrica (corregido 2026-06-09, ver `EXTRAS DE EXPERIMENTOS` en `CLAUDE.md`) impidió capturar bien en el snapshot original. Es un repair one-shot **por record** — cada record trackea su propio `rec._extrasBackfilled`/`rec._extrasBackfilledV2`, así que una vez backfilleado nunca se vuelve a tocar. No es una violación del invariante: no reescribe qué fórmula se usó, completa un dato que el snapshot debió capturar desde el principio.
- **No modifica CI** — solo escribe en `bl2_seg_notas`, nunca toca `bl2_cultivos`, `bl2_forms`, ni `bl2_ings`
- **Schema versioning**: `CRE_SCHEMA_VERSION = 1`. `migrateCreRecord()` es idempotente
- **`_creFilterMotorRecords()`** — excluye fórmulas desacopladas del motor
- **Race condition N12**: `_creNextId()` re-lee storage fresco
- **Aislamiento de logs por frasco**: `_creLogFase` SIEMPRE recibe `_sp.frasco` como 7° parámetro. Si se agrega un nuevo caller, debe pasarlo también. Omitirlo genera registros fantasma en otros frascos.
- **Batch fase = stage+confirm**: `_creBatchFaseScrubSave` solo se llama desde `creBatchFaseConfirm`. Nunca llamar directo desde un evento de drag — viola el flujo de confirmación.
- **`creDeleteFormula`** borra las 3 estructuras juntas (`bl2_crec` + `bl2_crec_fases` + `bl2_crec_notas`). `creWipeFormulaFases` es el wrapper con confirm UI que lo llama.

---

## 7. Flujo completo de un ensayo con experimentos

```
1. CI inocula cepas en frascos de un experimento
   → escribe bl2_pending_crec_action = { formulaId }

2. creOpenScoringPanel(formulaId)
   → _creFrascoTabsHTML muestra tabs de frascos (sin BASE, sin tab de solo Control)
   → auto-selecciona el frasco con más actividad

3. Usuario selecciona frasco, expande cepa
   → scrubber muestra fases + dot Hoy (amarillo pulsante)
   → drag de dot → creFaseScrubSave → log taggeado con experimentoId+frascoId

4. Con múltiples cepas en batch:
   → drag en batch scrubber → staged (dot amarillo pulsante)
   → panel de confirmación: "[Fase X · Día N → 4 cepas] [✓ Guardar] [✕]"
   → creBatchFaseConfirm → guarda en todas + logs con contexto de frasco

5. Score + Incidencia se registran por frasco → CRE record con experimentoId+frascoId

6. creSubmitScoringPanel() cierra el record:
   → scoreFinalNorm = score × 10
   → invalida bl2_inteligencia_model
   → log de score auto-descriptivo: "🔬 Frasco B · Score 8/10 · Incidencia 90%"

7. Si hay datos corruptos o legacy sin frasco:
   → "Reparar datos" llama creRepararDatosDeExperimentos()
   → _creRegenFaseLogs() backfilla experimentoId+frascoId en fase logs ambiguos
   → _creRegenScoreLogs() regenera score logs con contexto correcto

8. Si se quiere borrar todo y empezar de cero:
   → "🗑 Limpiar todo" en header → confirm → creWipeFormulaFases() → creDeleteFormula()
```

---

## 8. Para una nueva sesión de IA

Antes de tocar este módulo, leer en orden:

1. Este archivo completo
2. `cilab/CILAB_INTELIGENCIA_CONTEXT.md` — cómo Conocimiento alimenta a Inteligencia
3. `git log --oneline -10 -- cilab/cilab_conocimiento.js`
4. Las funciones específicas de la sección a modificar
5. Si toca logs: leer `_creLogFase`, `_creMatrixLogHTML` y el invariante de aislamiento
6. Si toca batch: leer `_creBatchControlsHTML`, `_sp.batchStagedFase`, `creBatchFaseConfirm`
7. Si toca frascos: leer `_creFrascoTabsHTML`, `creOpenScoringPanel`, `_creFRecsForContext`

**El módulo NO es decorativo.** Cada cambio a cómo se guarda un ensayo afecta la calibración del Optimizador y el entrenamiento del motor OLS. Verificar impacto en ambos antes de modificar la capa de storage o el schema.

**Cambios de mayo 2026 (sesión actual):**
- Aislamiento de logs por frasco (experimentoId+frascoId en `_creLogFase`)
- Batch scrubber con stage+confirm (no guarda en drag, requiere confirmación)
- Dot "Hoy" animado en scrubbers individual y batch
- Dblclick en dot para eliminar fase + log
- `creWipeFormulaFases` / botón "🗑 Limpiar todo"
- `_creRegenFaseLogs` en `creRepararDatosDeExperimentos`
- Tab BASE eliminado del scoring panel
