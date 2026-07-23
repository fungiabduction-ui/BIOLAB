# Briefing para sesión nueva — Migración + auditoría de la penalización eliminada

**Esto NO es una spec terminada.** Es el punto de partida para una sesión nueva que audite desde cero, sin arrastrar la conversación de hoy (2026-07-23, sesión muy larga, con varios rounds de "asumí mal, lo verifiqué y no era así" — el pedido explícito del usuario es que esta sesión nueva escanee todo por sí misma, sin atajos ni resúmenes de segunda mano).

## Contexto: qué se decidió hoy y por qué

En la misma sesión de hoy se armó y ejecutó un plan de 13 tareas para aislar `bl2_crec_fases` por frasco (ver `docs/superpowers/plans/2026-07-23-fases-por-frasco.md`), más tres fixes adicionales fuera de ese plan:
- **P0**: `_creInoculacionDate` pasó a usar `bl2_seg.inoculoFecha` (la fuente real de CI) en vez de `bl2_forms.fecha`/`inoculoTs`, y el algoritmo de días pasó de truncar-a-medianoche+floor a exacto+round, para coincidir con el D+ que muestra CI.
- **P1**: la card del grid de CILAB Conocimiento pasó de promediar el score de todos los frascos de un experimento en un solo número, a mostrar un score por frasco separado (`_creCompoundAvgByFrasco`).
- **Penalización eliminada** (el tema de este briefing): mientras se probaba lo anterior contra datos reales, apareció un caso (fórmula "N5", `CI-0010`, experimento `EXP-0004`) donde un registro (`CRE-0084`) tenía `rizoPositivas: 8` con `totalPlacas: 4` — físicamente imposible — y ese dato generó una `colonizacionPenalty` de **-3.33** (negativa, nunca debería pasar) que en vez de restar, sumó, inflando el score de ese frasco. El usuario decidió, después de ver esto, que la penalización por días de colonización debía eliminarse del todo: "si mi score fue 7 observado debe ser 7 como fuente de verdad y ya! no se discute" / "dejarlo solo en la incidencia del rizomorfismo".

## Qué se cambió en código hoy (ya commiteado en `main`)

Dos commits, en `cilab/cilab_conocimiento.js`:

1. `_saveTarget` (dentro de `creSubmitScoringPanel`): `scoreObservado` pasó de `compScore != null ? compScore : tgt.score` a simplemente `tgt.score` — el score crudo 1-10 que carga el usuario, siempre, sin excepción. `scoreCompuesto` se sigue calculando y guardando en la obs, pero ya no alimenta `scoreObservado`.
2. `_creCalcCompound`: se sacó por completo la resta de `penalty` (`_creColonizacionStats`/`_creEffectivePenalty`). Ahora es únicamente `score × (0.9 + 0.1×rizoRatio)`, clampeado a ≥0. Ya no llama a `_creColonizacionStats` ni a `_creEffectivePenalty`.

Correr `git log --oneline -10` y `git show <sha> -- cilab/cilab_conocimiento.js` para los shas exactos — no asumir, leer el diff real.

## Lo que hace falta y es el trabajo de esta sesión nueva

### 1. Auditoría completa (hacer ESTO primero, sin atajos)

El usuario pidió explícitamente que se escanee todo, no que se confíe en lo que dice este documento. Como mínimo hay que revisar, leyendo el código real (no `CILAB_INTELIGENCIA_CONTEXT.md` ni ningún doc viejo sin contrastarlo):

- `cilab/cilab_inteligencia.js` — el motor OLS (`buildModel()`/`_buildFeatureMatrix()`). ¿Lee `colonizacionPenalty`, `colonizacionDias`, o `scoreCompuesto` de `bl2_crec` para construir su matriz de features o su target? Si es así, ¿sigue siendo correcto ahora que `scoreObservado`/`scoreFinal`/`scoreFinalNorm` ya no incluyen la penalización, o hay que ajustar algo ahí también?
- `cilab/cilab_formula_intelligence.js` — el FI Engine (HybridScore, RouteAttribution, ExperimentAdvisor). Misma pregunta: ¿referencia `colonizacionPenalty`/`colonizacionDias`/`scoreCompuesto` en algún lado?
- Grep de `colonizacionPenalty`, `colonizacionDias`, `scoreCompuesto`, `_creEffectivePenalty`, `_creColonizacionStats` en TODO el repo (no solo `cilab_conocimiento.js`) para no dejar ningún consumidor sin revisar.
- Confirmar si `_creColonizacionStats`/`_creEffectivePenalty` quedaron como código muerto (sin ningún caller) después del fix de hoy, o si todavía los usa alguna otra función que no se tocó — de ser así, decidir con el usuario si también hay que limpiarlos ahí.

### 2. Migración de datos históricos

Los registros ya cerrados en `bl2_crec` (creados ANTES de hoy) tienen `scoreObservado`/`scoreFinal`/`scoreFinalNorm` congelados con el valor viejo (compuesto, con penalización incluida). El fix de hoy solo afecta registros nuevos. Hace falta una migración one-shot (mismo patrón que `_creMigrarColonizacionDiasPorFrascoV1` de hoy, o `_creExtrasBackfillV2`: flag en localStorage escrito recién después de confirmar el persist) que recalcule, para cada obs `'definitiva'` de cada record cerrado:
- `scoreObservado` = `calidadScore` (el campo ya existe en cada obs, es el score crudo que se cargó — no hay que inventar nada, ya está guardado).
- `scoreFinal`/`scoreFinalNorm` del record, derivados de ese `scoreObservado` corregido (mismo cálculo que ya hace `creAddObs` al cerrar: `scoreFinal = obs.scoreObservado`, `scoreFinalNorm = scoreFinal × 10`).
- Confirmar con el usuario si `scoreCompuesto` también se recalcula (sin penalización, solo con incidencia) para que el campo de referencia quede consistente, o si se deja como está (histórico, con la fórmula vieja, ya que ahora es solo informativo y no se usa para nada).

**No se sabe hoy cuántos registros existen en total ni cuántos tienen penalización distinta de cero** — la sesión nueva debería cuantificar esto primero (similar a como se hizo con el diagnóstico de fases-por-frasco: exportar/leer el `bl2_crec` real y contar) antes de decidir el alcance exacto de la migración.

### 3. Bug de validación, todavía sin arreglar (relacionado, no resuelto hoy)

No existe ninguna validación que impida guardar `rizoPositivas > totalPlacas` (físicamente imposible). Este fue el dato que disparó todo el hallazgo de hoy (`CRE-0084`: 8 positivas de 4 totales). Sin la penalización, este dato ya no puede generar un penalty negativo — pero sigue siendo un dato imposible que puede inflar `rizoRatio` por encima de 1.0 y afectar el `base = score × (0.9 + 0.1×rizoRatio)` de forma rara (rizoRatio=2 en vez de máximo 1 le suma más boost de lo que debería). Evaluar si conviene clampear `rizoRatio` a 1.0 como tope, y/o agregar validación en el input de incidencia para que no se pueda guardar `rizo > total`.

### 4. Caso real para verificar contra datos reales

Fórmula "N5" — **ojo, hay DOS fórmulas con el nombre exacto "N5"**: `CI-0008` (creada 2025-10-10, sin experimento, 4 records viejos) y `CI-0010` (creada 2026-05-29, la que tiene el experimento `EXP-0004` "Validación y optimización metabólica", frascos "A (Control)" y "B"). El caso problemático es `CI-0010`. Backup de referencia (de ayer, puede no reflejar cambios de hoy): `biolab_full_backup - 22_07_2026_192945.json` en la raíz del repo — pero **pedir un backup fresco del usuario antes de tocar nada**, dado que hoy se guardaron scores nuevos durante las pruebas.

## Cómo arrancar la sesión nueva

Pegar algo como: *"Leé `docs/superpowers/specs/2026-07-23-eliminar-penalizacion-BRIEFING.md` y arrancá auditando desde cero (sin confiar en resúmenes previos) cómo `scoreCompuesto`/`colonizacionPenalty`/`colonizacionDias` se usan en TODO el repo — especialmente `cilab_inteligencia.js` y `cilab_formula_intelligence.js`, que no se tocaron hoy. Después de la auditoría completa, diseñá conmigo la migración de datos históricos (scoreObservado/scoreFinal/scoreFinalNorm de registros ya cerrados) antes de tocar código."*
