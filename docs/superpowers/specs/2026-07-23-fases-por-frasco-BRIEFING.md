# Briefing para brainstorm — Fases NO están encapsuladas por frasco

**Esto NO es un spec terminado — es el problema de entrada para arrancar una sesión de `superpowers:brainstorming` desde cero, con contexto completo, sin arrastrar la conversación gigante de la sesión donde se encontró.**

## El problema, en una frase

`bl2_crec_fases` (dónde vive el registro de fases del ciclo de cultivo — Inoculación, Actividad metabólica, etc.) se indexa por `formulaId + geneticaId` **sin ningún componente de frasco/experimento**. Si la misma cepa genética se está probando en dos frascos distintos del mismo experimento (ej. Frasco A control vs Frasco B con extras), sus fases quedan **compartidas** entre ambos frascos — registrar una fase en A la marca como registrada también al mirarla desde B.

## Cómo se descubrió (caso real, sesión 2026-07-23)

Usuario hizo batch-registro de "Actividad metabólica" en Frasco A (4 cepas, incluyendo "PC / APE / 244" y "PC / APE / 210"), después hizo lo mismo en Frasco B (3 cepas, incluyendo las MISMAS dos cepas + una nueva "PC / Hillbilly / CLON 1"). El log de Frasco B solo mostró 1 entrada nueva (CLON 1) — las otras 2 fueron salteadas silenciosamente por el guard anti-sobreescritura (`_creBatchFaseRegisterNow`, agregado hoy mismo, protege contra pisar una fase ya registrada). El guard funcionó exactamente como se diseñó — el problema es que "ya registrada" está mal definido: debería ser "ya registrada **para este frasco**", no "ya registrada para esta cepa en cualquier frasco".

## Por qué importa más de lo que parece

No es solo un tema de UI/visualización. `_creColonizacionStats(formulaId, geneticaId)` (también sin frasco) calcula la penalización por colonización lenta que se le resta a `scoreCompuesto` → `scoreFinal`/`scoreFinalNorm` — el target real que entrena el modelo OLS (`cilab_inteligencia.js`). Si dos frascos comparten el registro de colonización de una cepa, el score de un frasco puede llevar una penalización calculada con datos de colonización que en realidad son del OTRO frasco. Esto contamina silenciosamente el dataset de entrenamiento del motor — exactamente el tipo de corrupción silenciosa que este proyecto prioriza evitar (ver `CLAUDE.md` raíz del proyecto padre, sección de objetivos).

## Confirmado en código (no es una sospecha, ya se auditó)

```js
function _creFasesKey(formulaId, geneticaId) {
  return formulaId + '__' + (geneticaId || '_');
}
```
(`cilab/cilab_conocimiento.js`, sin cambios en la sesión de hoy — es preexistente, no lo introdujo el trabajo de hoy, pero el trabajo de hoy —el grid de fases con batch más ágil— lo hace mucho más fácil de disparar por accidente que el scrubber viejo.)

**Funciones que leen/escriben vía esta key (necesitan frasco si se encapsula) — lista de auditoría inicial, verificar que esté completa antes de diseñar:**
- `_creFasesRead`, `_creFasesWrite` (los helpers base)
- `_creInoculacionDate`, `_creGetInoculacionDate`, `_creGetColonizacionDate`
- `_creAutoFillInoculacion`, `_creAutoFillColonizacion`, `_creAutoFillInferredFases`
- `_creDiasSinceInoc`, `_creTemporalZoneFase`
- `_creColonizacionStats` (⚠ esta es la que alimenta el score — prioridad alta)
- `_creFaseRegisterNow`, `creFaseEditSave`, `creFaseDeleteConfirm`, `_creBatchFaseRegisterNow` (todas del grid nuevo, sesión de hoy)
- `_creFasesGridHTML`, `_creFaseEditStripHTML`, `_creBatchFasesGridHTML` (render)
- `creColonizacionCierrePrompt`/`Batch`, `creColonizacionCerrarCiclo`/`Batch` (el hand-off a GR)
- `_creLogFase` (el log ya SÍ recibe `frascoCtx` como 7° parámetro y lo usa para aislar notas — mirar cómo lo hace ahí, puede ser el patrón a replicar para las fases mismas)

## La parte difícil — datos históricos ya mezclados

Cualquier registro YA guardado en `bl2_crec_fases` para una cepa que se probó en más de un frasco **no tiene forma de saber retroactivamente a qué frasco pertenece** — el dato de origen nunca se capturó. Antes de tocar el schema hay que decidir, con el usuario, alguna de estas (u otra):
1. Los registros viejos quedan "huérfanos" (sin frasco), se tratan como un fallback/default compartido, y solo los registros NUEVOS se aíslan por frasco.
2. Se migran a un frasco "más probable" con alguna heurística (riesgoso — puede inventar procedencia falsa, va contra "no inventes" del proyecto).
3. Se le pregunta al usuario, cepa por cepa, a qué frasco pertenece cada registro ambiguo (viable si son pocos, no si son muchos).
4. Se abandonan (se dejan como están, se documenta la limitación, se aísla solo hacia adelante).

**No asumir cuál — es una decisión de producto/datos que le corresponde al usuario, no inventarla en el brainstorm.**

## Contexto de la sesión que encontró esto (para no tener que releer todo)

- Plan que acaba de implementarse (ya mergeado a `main`, funcionando): `docs/superpowers/plans/2026-07-23-cilab-fases-grid.md` — reemplazó un scrubber de arrastre por un grid de chips para registrar fases, individual y batch.
- Spec de ese plan: `docs/superpowers/specs/2026-07-22-cilab-fases-grid-design.md`.
- El batch nuevo (`_creBatchFaseRegisterNow`) ya tiene un guard que saltea cepas ya registradas — construido para proteger el ancla de inoculación de sobreescrituras accidentales, pero ese mismo guard es el que expuso este problema (bien silenciosamente, salvo por el log que el usuario supo leer).
- `CLAUDE.md` (raíz del repo, y raíz del proyecto padre `MOBY DICK`) tiene el mapa completo de invariantes del sistema — leer antes de tocar nada, especialmente la sección CILAB CONOCIMIENTO / CILAB INTELIGENCIA.

## Cómo arrancar la sesión nueva

Pegar algo como: *"Leé `docs/superpowers/specs/2026-07-23-fases-por-frasco-BRIEFING.md` y arrancá un brainstorm conmigo sobre cómo encapsular las fases del ciclo de cultivo por frasco/experimento en vez de solo por cepa — es un cambio de arquitectura real en `cilab_conocimiento.js`, necesito que audites el flujo completo antes de proponer nada, especialmente la parte de qué hacer con los datos ya mezclados entre frascos."*
