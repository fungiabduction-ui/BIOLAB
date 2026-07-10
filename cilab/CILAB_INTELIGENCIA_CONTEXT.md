# CILAB — Motor de Inteligencia Empírica

**Archivo:** `cilab/cilab_inteligencia.js`  
**Estado:** Implementado y activo (mayo 2026)  
**Integrar en:** `BIOLAB_SYSTEM.md` cuando se actualice

---

## 0. Grafo de trabajo — cómo fluye el conocimiento

```
┌─────────────────────────────────────────────────────────────────────┐
│  CI — Cultivo In Vitro                                              │
│  Escribe fórmulas de medio de cultivo (ingredientes + cantidades)   │
│  Storage: bl2_forms, bl2_ings                                       │
└───────────────────────────┬─────────────────────────────────────────┘
                            │  fórmula seleccionada
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  CILAB — Analizador metabólico                                      │
│  Lee la fórmula activa y evalúa rutas metabólicas teóricas          │
│  calcEstadoRutas() → calcRizomorfico() → score teórico 0-100        │
│  Detecta rutas deficitarias, excesos, conflictos bioquímicos        │
│  El Optimizador ajusta cantidades/ingredientes para subir el score  │
└───────────────────────────┬─────────────────────────────────────────┘
                            │  fórmula ajustada → se inocula en placa
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  LAB FÍSICO — Ensayo real                                           │
│  Se inocula la cepa en el medio formulado                           │
│  Se observa rizomorfismo: score 0-10, tipo cordón, incidencia       │
│  Score empírico REAL vs score teórico predicho = delta              │
└───────────────────────────┬─────────────────────────────────────────┘
                            │  observaciones registradas
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  CILAB — Conocimiento (cilab_conocimiento.js)                       │
│  Registra cada ensayo cerrado en bl2_crec                           │
│  Calcula:                                                           │
│    · bias de cepa = delta promedio (empírico - teórico) por cepa   │
│    · Score compuesto = (score/10) × (rizoPozitivas/totalPlacas)    │
│      → pondera calidad por cobertura real de colonización           │
│    · getCalibratedScore() ajusta el score actual con ese bias       │
│  Este ajuste corrige el optimizador para cada cepa específica       │
└───────────────────────────┬─────────────────────────────────────────┘
                            │  bl2_crec acumula registros cerrados
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  CILAB — Inteligencia (cilab_inteligencia.js)  ← ESTE MÓDULO       │
│  Lee bl2_crec y construye modelo OLS sobre todos los ensayos        │
│  Pregunta: ¿qué ingredientes potencian o inhiben el rizomorfismo?   │
│  Responde con coeficientes deconfundidos por regresión ridge        │
│                                                                     │
│  Outputs:                                                           │
│    · Ranking de ingredientes (coef OLS, n, confianza)              │
│    · Interacciones pairwise (A+B → synergy/antagonismo)            │
│    · Modelo global + modelo por cepa                               │
│    · Sugerencias empíricas: qué subir/bajar/agregar en la fórmula  │
└───────────────────────────┬─────────────────────────────────────────┘
                            │  conocimiento acumulado
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  CILAB — Optimizador (cilab_app.js)                                 │
│  Genera escenarios A/B/C con fórmulas mejoradas                     │
│  Score proyectado = score teórico + bias de cepa                    │
│    (no usa synergy por ingrediente en proyecciones:                 │
│     es correlacional y aplasta a 0 fórmulas nuevas)                │
│  Sección "💡 Sugerencias empíricas" = top ingredientes del modelo  │
│  → el usuario aplica los cambios y vuelve a CI para inocular        │
└───────────────────────────┬─────────────────────────────────────────┘
                            │  nueva fórmula → nuevo ensayo
                            ▼
                    [loop al Lab físico]

```

### El ciclo de aprendizaje en una oración

> CI formula → CILAB analiza teóricamente → se inocula → Conocimiento puntúa el resultado real → Inteligencia aprende qué ingredientes funcionan → el Optimizador sugiere mejores fórmulas → CI vuelve a formular.

Cada ensayo cerrado en Conocimiento hace al sistema más inteligente.

---

## 0.1 Score compuesto — qué es y por qué puede superar 10

El **Score compuesto** es la métrica de Conocimiento que pondera calidad por cobertura:

```
Score compuesto = promedio de (score_rizomórfico/10 × rizoPozitivas/totalPlacas)
                 sobre todos los registros cerrados de esa fórmula
```

- `score_rizomórfico / 10` → convierte el score 0-10 a escala 0-1
- `rizoPozitivas / totalPlacas` → incidencia real de colonización (puede superar 1.0
  si se cuentan colonias individuales en lugar de placas dicotómicas)

**Ejemplo:**
| Fórmula | Score | Incidencia | Compuesto |
|---------|-------|------------|-----------|
| N5 | 8/10 | 400% (ratio 4.0) | 8 × 4.0 = **32.0** |
| Indiana A | ~5/10 | 82% (ratio 0.82) | ~5 × 0.82 = **~4.1** → avg 4.3 |

Un Score compuesto > 10 es posible cuando `rizoPozitivas/totalPlacas > 1` — indica alta densidad de colonización por placa, no un error de cálculo.

**Usado en:** resumen de fórmulas en Conocimiento, no alimenta directamente el modelo OLS de Inteligencia (ese usa `scoreFinalNorm` crudo).

---

## 1. Problema que resuelve

El motor metabólico teórico (`calcRizomorfico`) predice un score 0-100 basado en bioquímica de rutas. Pero los resultados reales en placa divergen del score teórico por dos razones:

1. **Bias de cepa:** cada cepa tiene un comportamiento biológico propio (vigor, velocidad, respuesta al medio) que el modelo teórico no captura.
2. **Atribución de ingredientes confundida:** el sistema anterior (`getCalibrationModel` en `cilab_conocimiento.js`) calculaba `avgDelta` por ingrediente como co-ocurrencia pura — si el ingrediente A siempre aparece junto al B, sus deltas están confundidos y no se puede saber cuál es responsable del resultado.

**La solución:** regresión OLS sobre los ensayos cerrados. Cada ingrediente normalizado es una feature; el target es `scoreFinalNorm`. Los coeficientes resultantes son atribución deconfundida (en la medida en que lo permiten los datos).

---

## 2. Dónde vive

```
cilab/cilab_inteligencia.js   — IIFE completo, expone window.cilabInt
```

No modifica ninguna estructura existente. Solo lee `bl2_crec` y escribe su propio cache `bl2_inteligencia_model`.

---

## 3. Storage keys

| Key | Acceso | Contenido |
|-----|--------|-----------|
| `bl2_crec` | Solo lectura | Ensayos de crecimiento (fuente de datos) |
| `bl2_inteligencia_model` | Lectura/escritura propia | Modelo OLS cacheado |
| `bl2_crec_excluded_forms` | Solo lectura | Formularios excluidos del motor |
| `bl2_experimentos` | Solo lectura | Experimentos adicionales (ingredientes extra) |

---

## 4. Cómo funciona el modelo OLS

### Pipeline de datos

```
bl2_crec (registros cerrados)
  ↓
_buildFeatureMatrix()
  — qty de cada ingrediente normalizada por rangoOptimo.max
  — features: vector de presencia/cantidad por ingrediente
  — target: scoreFinalNorm (score empírico observado)
  ↓
_ridgeRegression(X, y, lambda=0.01)
  — OLS regularizada: (X'X + λI)^-1 X'y
  — Implementada en JS puro con pseudoinversa
  — Lambda 0.01 evita colapso con ingredientes colineales
  ↓
coefs: { ingId → { coef, n, confidence } }
  — coef positivo → ingrediente potencia rizomorfismo
  — coef negativo → ingrediente inhibe rizomorfismo
  — confidence: alta (n≥8), media (n≥4), baja (n≥2), insuficiente (<2)
```

### Modelos generados

- **Global:** todos los registros cerrados (mínimo 5)
- **Por cepa:** subset por `geneticaId` (mínimo 3 registros por cepa)
- **Interacciones pairwise:** `mean(A+B) - mean(A) - mean(B) + mean(ninguno)` para pares con n≥3 en cada condición

### Output del modelo cacheado

```json
{
  "computedAt": "ISO date",
  "nRecords": 39,
  "nIngredients": 18,
  "r2": 0.96,
  "coefs": {
    "ing-uuid": { "coef": -28.9, "n": 13, "confidence": "alta" }
  },
  "pairs": {
    "ingA|ingB": { "interaction": 2.1, "type": "sinergica", "n": 5 }
  },
  "byStrain": {
    "ge-uuid": { "coefs": {...}, "r2": 0.91, "nRecords": 13 }
  }
}
```

---

## 5. Distinción crítica: OLS coef vs avgDelta (calibración)

Hay DOS sistemas que usan `bl2_crec`:

| Sistema | Función | Qué calcula | Cómo se usa |
|---------|---------|-------------|-------------|
| `getCalibrationModel()` en `cilab_conocimiento.js` | Bias de cepa + synergy por ingrediente | `avgDelta` = correlación de co-ocurrencia | Ajuste del score actual de fórmula real |
| `buildModel()` en `cilab_inteligencia.js` | OLS ridge regression | Coeficiente = atribución deconfundida | Ranking de ingredientes + sugerencias |

**El bias de cepa** (`strainProfiles[gId].bias`) es confiable: promedia el delta sobre todos los ensayos de esa cepa.

**La synergy por ingrediente** (`ingData[ingId].avgDelta - bias`) es correlacional: puede estar confundida por co-ocurrencia.

**El coef OLS** es la mejor estimación de atribución causal disponible con los datos que hay. Sigue siendo observacional (no experimental), pero está deconfundido dentro de la variabilidad del dataset.

---

## 6. Integración con el Optimizador

El optimizador (`_optBuildScenario` en `cilab_app.js`) genera 3 escenarios (A, B, C) con fórmulas proyectadas. Para cada escenario calcula un `projectedScore`:

```
projectedScore = projThScore + bias_cepa
```

**Por qué no usa synergy de ingredientes en proyecciones:** cuando el escenario B o C agrega 10-15 ingredientes nuevos, cada uno puede tener un `avgDelta` negativo en el modelo de calibración (porque esos ingredientes aparecieron en ensayos experimentales con resultados mixtos). La suma de synergías negativas aplasta el score proyectado a 0. El bias de cepa en cambio es robusto.

La sección **"💡 Sugerencias empíricas"** al final del modal del optimizador usa los coefs OLS para rankear qué ingredientes subir/bajar en la fórmula actual.

---

## 7. Dónde aparece en la UI

### Tab Inteligencia (CILAB Conocimiento)

Renderizado por `renderInteligencia()` cuando el usuario navega al tab.

- **Ranking de ingredientes:** ordenado por `|coef|`, verde = potenciador, rojo = inhibidor, con barra proporcional
- **Interacciones pairwise:** chips "A + B → +X pts"  
- **Estadísticas:** R², N registros, advertencia si R² es demasiado alto con pocos datos (memorización)
- **¿Qué cambiarías?:** sugerencias concretas basadas en la fórmula activa en el Analizador — requiere formula seleccionada
- **Selector de cepa:** chips para ver análisis global o por cepa específica
- **Diagnóstico empírico:** panel expandible con análisis profundo de gaps entre score teórico y empírico

### Modal del Optimizador

Sección colapsable `<details>` al final del modal (verde, "💡 Sugerencias empíricas"):
- Muestra los top 4 ingredientes a agregar, subir o reducir
- Formato: `↓ Ingrediente X | 3g → retirar · coef -28.9 · n=13 | -28.9 pts`

---

## 8. API pública

```javascript
window.cilabInt = {
  buildModel,          // calcula y cachea el modelo OLS
  getModel,            // lee el modelo cacheado de localStorage
  invalidate,          // borra el cache (fuerza recalculo)
  renderInteligencia,  // renderiza el tab completo
  renderDiagnostico,   // panel de diagnóstico empírico (llamado desde Analizador)
}
```

**Importante:** `getModel()` solo lee localStorage. Para tener el modelo disponible en el Optimizador sin abrir el tab de Inteligencia, el modelo debe haber sido calculado previamente. Si `getModel()` devuelve `null`, la sección empírica del optimizador no aparece.

---

## 9. Dependencias del sistema (via window._cilab_*)

```javascript
window._cilab_loadMeta()            // metadata de ingredientes (rangoOptimo)
window._cilab_getActiveFormulaId()  // formulaId activo en el Analizador
window._cilab_readForms()           // array de fórmulas
window._cilab_readIngredientes()    // array de ingredientes
window._cilab_getCalibratedScore()  // score calibrado (desde cilab_conocimiento.js)
window._cilab_getCalibrationModel() // modelo de calibración (bias de cepa)
```

Todas son accesos de solo lectura. El módulo no muta ningún dato externo.

---

## 10. Invariantes críticos

- **No modifica** `bl2_crec`, `bl2_forms`, `bl2_ings`, ni ninguna estructura del pipeline
- **No modifica** `calcRizomorfico`, `calcEstadoRutas`, `calcCN` — son invariantes del motor teórico
- **No rompe** compatibilidad con `getCalibrationModel()` (sistema paralelo, no reemplazante)
- El modelo OLS es **complementario** al motor metabólico teórico, no un reemplazo
- Con n < 50 y p < 30 features, OLS con ridge es la técnica correcta — no deep learning

---

## 11. Limitaciones conocidas

- Con pocos registros (< 15), R² alto puede indicar memorización, no aprendizaje
- Los coeficientes son observacionales: correlación fuerte no implica causalidad
- Un ingrediente que siempre aparece junto a otro tendrá sus coefs parcialmente confundidos (limitación inherente sin diseño experimental)
- El modelo por cepa requiere mínimo 3 registros — cepas con 1-2 ensayos no tienen modelo individual

---

## 12. Flujo para una nueva sesión de IA

Si una IA va a trabajar en este módulo, debe entender en orden:

1. Leer este archivo
2. Leer `cilab_inteligencia.js` completo (IIFE de ~1150 líneas)
3. Entender `getCalibrationModel()` en `cilab_conocimiento.js` (sistema paralelo)
4. Ver cómo el Optimizador llama a `_getCalibratedScore` en `cilab_app.js` (función `_optBuildScenario`)
5. Revisar git log reciente: `git log --oneline -10 -- cilab/`

**El módulo es un motor crítico, no un panel decorativo.** Cada cambio debe considerar integridad de los datos empíricos y la consistencia entre el score teórico, el bias de cepa, y los coeficientes OLS.

---

## 13. Formula Intelligence Engine (FI Engine) — módulo complementario

**Archivo:** `cilab/cilab_formula_intelligence.js` (IIFE, expone `window.cilabFI`)  
**Implementado:** 2026-06-01  
**Cargado después de:** `cilab_inteligencia.js` (requiere `window.cilabInt`) y `cilab_app.js` (requiere `calcEstadoRutas`, `calcRizomorfico`, `calcCN` como globals)

### Propósito

Extiende Inteligencia con cuatro capacidades que cierran el loop de aprendizaje:

1. **HybridScorer** — score fusionado teoría+empírico con peso α adaptativo por N de ensayos
2. **RouteAttributionBridge** — coefs OLS mapeados a nivel de rutas metabólicas
3. **ExperimentAdvisor** — incertidumbre por ingrediente → próximo ensayo más informativo
4. **FormulaGenerator** — problema inverso greedy: genera fórmulas candidatas de cero

### Storage

| Key | Acceso | Contenido |
|-----|--------|-----------|
| `bl2_crec` | Solo lectura | Ensayos (vía `_readRecords()` que aplica filtro de exclusión) |
| `bl2_inteligencia_model` | Solo lectura (vía `cilabInt.getModel()`) | Modelo OLS cacheado |
| `bl2_crec_excluded_formulas` | Solo lectura | Fórmulas excluidas del motor |
| `bl2_formula_intel` | Lectura/escritura propia | Cache del FI Engine |

### Invariante de escala crítico

`model.coefs[ingId].coef` y `model.intercept` están en escala **0-100** (son escalados ×10 en `_ridgeRegression()`). La proyección OLS es:

```
olsProjection = intercept + Σ(coef_i × normQty_i)   // ya en 0-100, sin multiplicar ×10
```

### Fórmula HybridScore

```
α(N) = max(0.10, 1 − N/50)
hybridScore = α × thScore + (1−α) × olsProjection + strainBias
hybridScore = clamp(hybridScore, 0, 100)
```

Con N=0: α=1 (score teórico puro). Con N≥50: α=0.10 (empírico dominante).

### Invalidación

`creWrite()` en `cilab_conocimiento.js` invalida `bl2_formula_intel` (además de `bl2_inteligencia_model`). El FI Engine recalcula lazy on-demand.

### API pública

```js
window.cilabFI = {
  buildFormulaIntel(),        // computa y cachea bl2_formula_intel (con _fiBuilding guard)
  getFormulaIntel(),          // lee localStorage | null
  invalidate(),               // removeItem('bl2_formula_intel')
  scoreFormula(ings, cepaId), // siempre on-demand (no cachea), degrada si sin OLS
  generateFormula(target, cepaId), // retorna [] si N<5, 3 candidatos si hay datos
  getExperimentAdvice(),      // lee cache | null
  getRouteAttribution(),      // lee cache | null
}
```

### Bugs corregidos en Task 0 (relacionados con Inteligencia)

- `K_EXCL` en `cilab_inteligencia.js` corregido a `'bl2_crec_excluded_formulas'` — el filtro de exclusión ahora funciona correctamente
- `model.intercept` y `byStrain[gId].intercept` ahora se almacenan en el cache del modelo OLS
- `buildModel()` tiene guard `_building` para evitar ejecuciones concurrentes
