# Fases del ciclo de cultivo aisladas por frasco — Design

## Problema

`bl2_crec_fases` (fases del ciclo: Inoculación, Actividad metabólica, ..., Colonización completa) se indexa hoy por `formulaId__geneticaId`, sin componente de frasco/experimento. Cuando la misma cepa se prueba en más de un frasco del mismo experimento (`bl2_experimentos`), sus fases quedan compartidas: registrar o auto-derivar una fase en Frasco A la muestra también como registrada en Frasco B, aunque biológicamente puedan haber colonizado en días distintos.

Esto no es solo un problema de UI. `_creColonizacionStats(formulaId, geneticaId)` lee esa misma key compartida para calcular la penalización por colonización lenta que se resta del `scoreCompuesto` guardado en `bl2_crec` — el target real que entrena el modelo OLS de Inteligencia. Un frasco puede heredar el día de colonización del otro.

## Confirmado con datos reales (2026-07-23)

Diagnóstico corrido contra el `localStorage` real de producción:

- **18 combinaciones cepa×experimento en 9 experimentos** (CI-0006, CI-0007, CI-0009 a CI-0013) tienen fases compartidas entre frascos.
- **Ninguna de las 18 tiene notas manuales tageadas** (`bl2_seg_notas` con `logType:'fase'` y `experimentoId`/`frascoId`) — el 100% del dato compartido es auto-generado (`_creAutoFillInoculacion`/`_creAutoFillColonizacion`/`_creAutoFillInferredFases`), nunca una observación manual perdida. Esto simplifica la migración: no hay nada que reconstruir a mano, todo se re-deriva de `bl2_seg` (que sí tiene el frasco taggeado por tanda vía `experimentoId`/`experimentoFrascoId`).
- **44 registros cerrados en `bl2_crec`** (de estas 18 combinaciones) tienen `colonizacionDias` congelado. **22 de esos 44 están calculados con el día de colonización del frasco equivocado.** Caso más grave: "Prueba de Metionina" (CI-0006/EXP-0001) — los 5 registros de Frasco A tienen 24 días congelados (penalty 2.25) cuando el real es 17 días (penalty 0.5): 1.75 puntos de penalty de más, aplicados de forma sistemática (no aleatoria) a los 5 registros de ese frasco.
- El sesgo es sistemático, no ruido — exactamente el tipo de distorsión que más afecta a una regresión OLS, en particular al mecanismo de Delta Substitution (compara control vs variante) documentado en `CLAUDE.md`.

## Alcance (decisiones ya tomadas con el usuario)

1. Afecta **solo** cepas dentro de `bl2_experimentos` (frascos A/B/C/D). Fórmulas de CI fuera de un experimento no tienen ambigüedad — no se tocan.
2. La fase **Inoculación** también se aísla por frasco (no queda como ancla compartida) — confirmado que en la operación real los frascos de un mismo experimento pueden inocularse en momentos distintos.
3. Datos históricos de `bl2_crec_fases` ya mezclados: **no se migran ni se copian**. La key vieja (sin frasco) queda intacta como estaba. Aceptable porque el punto anterior confirma que nada de eso es dato manual irrecuperable — se auto-regenera correcto en el próximo render una vez que el fix esté (ver sección Corrección de fuentes CI).
4. Los 22 registros cerrados de `bl2_crec` con `colonizacionDias`/penalty mal calculado **sí se corrigen** retroactivamente (afectan al modelo ahora mismo).

## Diseño

### 1. Key compuesta en `bl2_crec_fases`

```js
function _creFasesKey(formulaId, geneticaId, frascoCtx) {
  var base = formulaId + '__' + (geneticaId || '_');
  return (frascoCtx && frascoCtx.expId)
    ? base + '__' + frascoCtx.expId + '__' + frascoCtx.frascoLabel
    : base;
}
```

`_creFasesRead(formulaId, geneticaId, frascoCtx)` / `_creFasesWrite(formulaId, geneticaId, arr, frascoCtx)` ganan el tercer parámetro. Sin `frascoCtx` (fórmulas fuera de experimento), key idéntica a la actual — cero impacto ahí.

### 2. Threading del contexto de frasco

Todas las funciones que ya se ejecutan dentro del flujo del scoring panel leen `_sp.frasco` directamente (estado de módulo, vigente durante toda la vida de la pestaña activa) — no hace falta agregar parámetros a los `onclick` del HTML generado:

- `_creFaseRegisterNow`, `creFaseEditSave`, `creFaseDeleteConfirm`, `_creBatchFaseRegisterNow`
- `_creFasesGridHTML`, `_creFaseEditStripHTML`, `_creBatchFasesGridHTML`, `creFaseGridClick`, `creFaseGridBatchClick`
- `_creAutoFillInoculacion`, `_creAutoFillColonizacion`, `_creAutoFillInferredFases`
- `_creDiasSinceInoc`, `_creTemporalZoneFase`, `_creInoculacionDate`
- `_creRenderCepasSection`

**Única excepción:** `_saveTarget` (dentro de `creSubmitScoringPanel`) usa el `frCtx` ya resuelto a partir de `tgt.expId`/`tgt.frascoLabel` — no `_sp.frasco` — porque una selección batch puede quedar asociada a un frasco distinto al de la pestaña activa si el usuario cambió de tab sin limpiar `_sp.selected`. Esto corrige puntualmente la llamada a `_creColonizacionStats(formulaId, gId)` en la línea que arma cada `obs` del CRERecord, que hoy no recibe frasco.

### 3. Fuentes del lado CI también necesitan el filtro

`bl2_seg` ya trae `experimentoId`/`experimentoFrascoId` por tanda (usado hoy en `_creGetCepasForFrasco`). Pero dos lectores no filtran por eso todavía:

- `_creGetColonizacionDate(formulaId, geneticaId, frascoCtx)` — agrega `s.experimentoId === frascoCtx.expId && s.experimentoFrascoId === frascoCtx.frascoLabel` al filtro existente.
- `_creInoculacionDate`, tier 3 (`bl2_seg.inoculoTs`) — mismo filtro. Tier 4 (legacy `bl2_crec.inoculationDate`) — filtra por `r.experimentoId`/`r.frascoId` cuando hay `frascoCtx`.

Con esto, el auto-fill (`_creAutoFillInoculacion`/`_creAutoFillColonizacion`) re-deriva correctamente por frasco apenas se abre el grid — es lo que hace que los 18 casos ya detectados se autocorrijan sin carga manual.

### 4. Corrección retroactiva de `bl2_crec` (22 registros)

Migración one-shot `_creMigrarColonizacionDiasPorFrascoV1()`, flag `biolab_migracion_crec_colonizacion_frasco_v1` — **escrito solo después de confirmar el persist**, mismo patrón que `_creExtrasBackfillV2` (lección ya documentada: flag antes de persistir = corrupción silenciosa si el write falla).

Para cada record de `bl2_crec` con `experimentoId` + `frascoId` seteados:
1. Arma `frCtx = { expId: rec.experimentoId, frascoLabel: rec.frascoId }`.
2. Resuelve inoculación/colonización reales de ESE frasco reusando `_creInoculacionDate(..., frCtx)` / `_creGetColonizacionDate(..., frCtx)` ya corregidas en el punto 3 — no reimplementa la resolución de fechas.
3. Si no encuentra tanda de `bl2_seg` con `inoculoTs` y `colonizacion` reales para ese frasco → **no toca el record** (no inventa procedencia).
4. Si encuentra, recalcula `dias` → pasa por `_creCalcCompound` / `_creEffectivePenalty` (funciones existentes, no reimplementar aritmética de penalty) para obtener el `scoreCompuesto` corregido.
5. Sobreescribe `colonizacionDias` / `colonizacionPenalty` / `scoreObservado` / `scoreCompuesto` en el `obs` correspondiente **solo si el valor recalculado difiere del congelado** (minimiza el diff, no toca records ya correctos).
6. Al terminar, invalida `bl2_inteligencia_model` y `bl2_formula_intel` explícitamente (regla del proyecto: cualquier cambio en `bl2_crec` invalida ambos caches) — sin esto el modelo no se entera de la corrección hasta el próximo trigger casual.

Se corre en el mismo punto donde ya corren las migraciones de extras (`creOpenScoringPanel`), o en init del módulo.

### 5. Backup obligatorio antes de aplicar

Regla del proyecto: backup completo antes de cualquier cambio de estructura en localStorage. Aplica especialmente al punto 4 (sobreescribe scores ya cerrados).

## Testing

Script Node standalone (no tocar la app real todavía) usando los datos ya extraídos de "Prueba de Metionina" (CI-0006/EXP-0001):
- `_creFasesKey` con y sin `frascoCtx` produce las keys esperadas; la key vieja no se toca.
- `_creGetColonizacionDate`/`_creInoculacionDate` con `frascoCtx` devuelven las fechas reales por frasco (Frasco A: inoculación 2026-05-08, colonización 2026-05-25 → 17 días; Frasco B: colonización 2026-05-30 → 22 días).
- La migración de `bl2_crec` recalcula CRE-0027/0028/0029/0030/0031 (Frasco A) a 17 días / penalty 0.5, y CRE-0032 a 0036 (Frasco B) a 22 días / penalty 1.75.
- Una fórmula CI fuera de experimento (`frascoCtx` null) no cambia ningún resultado antes/después.
- Tras la migración, `bl2_inteligencia_model` y `bl2_formula_intel` quedan invalidados (ausentes o marcados dirty).

## Fuera de alcance de esta spec

- Reconstrucción manual de datos — no aplica, confirmado que no hay observaciones manuales perdidas en los 18 casos detectados.
- Otros sesgos ya documentados en `CLAUDE.md` (ubiquity, bioConflict, filtro n≥2) — no se tocan, son mecanismos independientes de este bug.
- Cualquier fase que en el futuro SÍ se registre manualmente vía el grid, una vez este fix esté andando, ya nace aislada por frasco — no requiere ninguna migración adicional.
