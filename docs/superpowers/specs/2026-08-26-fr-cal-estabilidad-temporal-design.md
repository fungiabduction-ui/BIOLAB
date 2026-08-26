# FR·CAL — estabilidad temporal de correlaciones (MEJ-0003)

## Problema

`_frCalBuildIntel()` (`fr/fr_app.js`, `bySuAditivo` ~4667/línea 5018, `byGrComponente` ~5076,
`anomalyRanking` ~5120) compara la media de "bolsas con aditivo/componente X" contra un baseline
de "todo el resto de flushes con `calidad`", sin ningún control por fecha o cohorte. Confirmado
con 6 recurrencias reales entre 2026-07-14 y 2026-08-25 (detalle completo en
`docs/lab-intelligence/mejoras_app.md`, entrada `MEJ-0003`):

- Confusión estacional: un aditivo adoptado recién a mitad del historial "hereda" la culpa de un
  problema (deformaciones) que ya existía antes de que se empezara a usar.
- Confusión por cohorte-en-lote (26-08-25): el `n` de un componente no cambió en una semana, pero
  su delta reportado saltó igual porque el grupo BASELINE (bolsas sin ese componente) se infló con
  una cosecha en lote de otra línea completamente ajena, no relacionada con el ingrediente
  señalado.

El schema de `fr_bolsas`/`su_lotes` no tiene campo de temperatura ambiente ni condiciones de
cultivo — no hay forma de aislar el confound real (frío, evento de cosecha en lote, etc.)
directamente. Lo que SÍ se puede detectar, sin ningún campo nuevo, es si la correlación reportada
es **estable en el tiempo** o si depende de qué ventana temporal del historial se mire — que es el
síntoma común a las 6 recurrencias documentadas.

## Objetivo

Cuando una correlación (`bySuAditivo`/`byGrComponente`) no es robusta frente a la exclusión de un
mes cualquiera del historial, marcarla como temporalmente inestable y mostrar esa advertencia en
el mismo lugar donde hoy se le atribuye la anomalía al ingrediente — sin ocultar el candidato ni
reordenar el ranking (decisión explícita del usuario: informar, no excluir — mismo criterio que
`bioConflict`/`indeterminate` en CILAB Inteligencia).

## Mecanismo — leave-one-month-out (LOO)

Mismo principio que el bootstrap CI90 que ya usa `cilab_inteligencia.js` para los coeficientes
OLS — reutiliza un patrón de robustez ya validado en este código en vez de inventar uno nuevo.

### 1. Captura de fecha (prerequisito, sin schema nuevo)

`_frCalBuildIntel()` arma `records` (fr_app.js:4950-4980) sin ningún campo de fecha, aunque cada
flush ya tiene `f.fecha` (fecha de cosecha). Se agrega `fecha: f.fecha` a cada record — sin
migración, el dato ya existe.

### 2. `_frCalDeltaConLOO(candidatos, baseline, field, minN)`

Nueva función. Reemplaza el cálculo directo de `delta*` **solo para la dimensión que alimenta
`anomalyRanking`** (`deltaMutaciones`/`deltaDeformaciones`/`deltaBlobs` — no las 5 dimensiones de
cada card, correr LOO sobre las que no alimentan el ranking sería trabajo desperdiciado).

```
deltaGlobal = mean(candidatos[field]) - mean(baseline[field])   // calculo actual, sin cambios

meses = meses calendario distintos (YYYY-MM de r.fecha) presentes en candidatos ∪ baseline

si meses.length < 3:
    return { deltaGlobal, establidadTemporal: 'no-evaluable' }
    // sin dispersion temporal suficiente para juzgar -- ni estable ni inestable

deltasLOO = []
para cada mes en meses:
    cand' = candidatos sin ese mes
    base' = baseline sin ese mes
    si cand'.length < minN o base'.length < minN: skip (no forzar delta con muestra insuficiente)
    deltasLOO.push(mean(cand'[field]) - mean(base'[field]))

si deltasLOO.length < 2:
    return { deltaGlobal, establidadTemporal: 'no-evaluable' }

rango = max(deltasLOO) - min(deltasLOO)
establidadTemporal = rango > abs(deltaGlobal) ? 'inestable' : 'estable'
return { deltaGlobal, establidadTemporal, deltaLooMin: min(deltasLOO), deltaLooMax: max(deltasLOO) }
```

Regla de inestabilidad: si excluir un solo mes puede producir un swing tan grande o más grande que
el efecto reportado, el efecto no es atribuible de forma robusta al ingrediente — es sensible a
qué mes particular está presente en la muestra. Esto cubre tanto el caso estacional (el delta se
derrumba al sacar los meses donde el aditivo se usó) como el caso de cohorte-en-lote (el delta se
derrumba al sacar el mes donde cayó la cosecha en lote ajena).

## Propagación

1. `bySuAditivo[slug]` / `byGrComponente[slug]` ganan `establidadTemporal`, `deltaLooMin`,
   `deltaLooMax` (solo en la dimensión de `_anomDims`). El resto de los campos no cambia.
2. `anomalyRanking[dim]` (fr_app.js:5126-5139): cada candidato agrega `estabilidad:
   d.establidadTemporal`. **No se excluye ni se reordena** — el sort sigue siendo por magnitud de
   delta.
3. `_frCalAnomalyAlert()` (~5216) propaga `estabilidad` al armar `candidatos`.
4. `_frCalBuildObsText()` (5244-5247): un candidato con `estabilidad === 'inestable'` pasa de
   `[SU] Levadura de cerveza (medio) (Δ+22.9%)` a
   `[SU] Levadura de cerveza (medio) (Δ+22.9%, ⚠inestable en el tiempo)`.
5. Panel de detalle FR·CAL (fr_app.js:3066-3118, cards de `bySuAditivo`/`byGrComponente`): la fila
   de Confianza gana una fila hermana `Estabilidad temporal` mostrando `estable` / `⚠ inestable
   (rango Δ X a Y)` / `no evaluable (pocos meses de historia)` cuando aplica (candidato con
   confidence real, no `insuficiente`).

## Fuera de alcance (deliberado)

- No se agrega campo de temperatura/condiciones ambientales al schema — eso queda como iniciativa
  separada si se decide encarar en el futuro (mucho mayor alcance: UI en SU/FR, backward
  compatibility con bolsas viejas sin el dato).
- No se cambia el ranking/orden de candidatos ni se excluyen los inestables — decisión explícita
  del usuario, ver "Objetivo" arriba.
- No se re-evalúan ni se reescriben notas ya persistidas (`bl2_seg_notas`/`fr_bolsas[].observaciones`)
  con el caveat retroactivo — mismo criterio que MEJ-0044, el fix aplica hacia adelante.
- No se toca `bySuAditivo`/`byGrComponente` para las 4 dimensiones que no alimentan
  `anomalyRanking` (deltaScore, deltaAbortos en bySuAditivo) — quedan con el cálculo actual sin
  LOO.

## Testing

- Simulación en Node contra los datos reales de los 2 casos documentados (levadura de cerveza
  estacional, maíz cohorte-en-lote 25/08) usando un backup real — confirmar que ambos casos
  resultan `'inestable'` con la regla propuesta, y que un caso de control (una correlación
  bien distribuida a lo largo de varios meses, sin ningún mes que domine) resulta `'estable'`.
- `node --check fr/fr_app.js`.
- Verificación visual del panel de detalle FR·CAL y del texto de una nota automática nueva con
  candidato inestable, en Chrome real contra el backup cargado en `localStorage` (mismo método
  usado para MEJ-0049 en esta sesión).
