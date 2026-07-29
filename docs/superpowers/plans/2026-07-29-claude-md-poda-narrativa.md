# CLAUDE.md — poda de narrativa post-2026-07-16 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move 3 narrative-heavy sections of `CLAUDE.md` (dated 2026-07-22 through 2026-07-28, never migrated to `CHANGELOG.md` despite the project's own stated convention) into `CHANGELOG.md`, leaving only the currently-true invariant in `CLAUDE.md` plus a pointer to the full history. Per `docs/superpowers/specs/2026-07-29-claude-md-poda-narrativa-design.md`.

**Architecture:** Two files, both intentionally gitignored (`.gitignore` lines 2-4: `CLAUDE.md`, `CHANGELOG.md`). For each of 3 sections: (1) insert a new dated entry in `CHANGELOG.md` preserving the full narrative, (2) replace the corresponding narrative block in `CLAUDE.md` with a compact current-state summary + pointer. No app code changes.

**Tech Stack:** Markdown only.

---

## Important ground-truth notes for whoever implements this

- **Do NOT commit to git.** Both files are in `.gitignore` on purpose (internal project memory, never pushed to the public repo).
- **Task order matters for `CHANGELOG.md` ordering.** Tasks are ordered oldest-content-first (Task 1 = 2026-07-22/23, Task 2 = 2026-07-26, Task 3 = 2026-07-28). Each task inserts its new entry/entries **immediately after the `# Changelog` header**, before whatever the current first dated entry is. Because tasks run in ascending date order and each new entry displaces the previous "first" entry downward, the file ends up correctly reverse-chronological (newest at top) without any task needing to know what a later task will insert. Do not run these tasks out of order, and do not run them in parallel (same file).
- **Every "Read the file, find the block" step below gives exact short anchor text** (not full multi-line blocks) to locate boundaries, because line numbers will shift as earlier tasks in this plan edit the file. Always re-read the current file state before editing — never assume the line numbers from this plan document are still accurate once a prior task has run.
- **The new text inserted in both files is provided verbatim below** — copy it exactly, it does not need to be derived or summarized further.

---

### Task 1: CILAB CONOCIMIENTO — saga `scoreCompuesto` (2026-07-22 / 2026-07-23)

**Files:**
- Modify: `CHANGELOG.md` (insert 2 new dated entries)
- Modify: `CLAUDE.md` (compress one section)

- [ ] **Step 1: Insert the 2 new CHANGELOG.md entries**

Read `CHANGELOG.md`. Find the `# Changelog` line followed by a blank line, followed by the current first dated entry (today that's `## 2026-07-16`, but re-read to confirm — don't assume). Insert the following two entries immediately between the blank line after `# Changelog` and that first existing dated entry, exactly as written (this is new content, not a transcription of anything — copy it verbatim):

```markdown
## 2026-07-23

- **CILAB Conocimiento — penalización por colonización lenta ELIMINADA del score.** El "pendiente" de la entrada anterior (conflicto de versión de política + `_creEffectivePenalty` sin clamp de `rizoRatio>1`, encontrado en un caso real — `CRE-0084`, `rizoPositivas:8` con `totalPlacas:4`, imposible, generó penalty `-3.33`) llevó al usuario a decidir sacar la penalización del todo: **"si mi score fue 7 observado debe ser 7 como fuente de verdad y ya"**. `_saveTarget`: `scoreObservado` pasa a ser SIEMPRE `tgt.score` (crudo 1-10), nunca `compScore`. `_creCalcCompound`: ya no resta ningún penalty, solo `score × (0.9 + 0.1×rizoRatio)` clampeado a ≥0. `colonizacionDias`/`colonizacionPenalty` se siguen guardando (informativo) pero no afectan score ni training data.
- **Auditoría de consumidores del score (misma sesión):** `cilab_formula_intelligence.js` no leía ningún score individual, impacto cero. `cilab_inteligencia.js` tiene un mecanismo propio no documentado hasta entonces: para records con `rizoPozitivas`/`totalPlacas` válidos, el target y del OLS es `(rizo/total)×10` directo, bypasea `scoreFinalNorm` — solo records sin incidencia caen al fallback. Dos consumidores adicionales de `scoreFinal`/`scoreFinalNorm` identificados: `getCalibrationModel()`/`getCalibratedScore()` (bias de cepa, usa TODOS los records cerrados) y `computeRizoLearnIndex()`/`rizoLearnGet()` (advisor de `calcRecomendaciones()`, clasifica "rizo positivo" con `scoreFinal>=7`/`>=8`, se auto-invalida en cada `creAddObs('definitiva')`).
- **Migración `_creMigrarPenalizacionEliminadaV1()`** (flag-after-persist, `biolab_migracion_crec_penalizacion_eliminada_v1`): para cada record cerrado, toma la última obs `'definitiva'` y recalcula `scoreObservado`/`scoreFinal`/`scoreFinalNorm` = `calidadScore` crudo, borra `scoreCompuesto`. Verificado con script Node standalone contra `bl2_crec` real (backup 2026-07-22): 36/61 records cerrados afectados, idempotente, 0 violaciones del clamp post-fix.
- **Bug de `rizoRatio > 1` — dos capas de fix:** (a) clamp `Math.min(1, rizo/total)` en `_creCalcCompound` y en el fallback de `_buildFeatureMatrix` (inteligencia.js); (b) causa raíz en `_saveTarget`: el path de batch scoring partía `rizoPositivas` proporcionalmente por cepa (`ceRizo = round(batRizo × cePlacas / aggCITotal)`) sin validar contra el `totalPlacas` de esa cepa puntual — así se coló `CRE-0084`. Fix: guardia en `_saveTarget` (choke point único, individual y batch) que clampea `tgt.rizo = tgt.total` si lo supera.
- **Ronda 3 (misma sesión) — `scoreCompuesto` ELIMINADO DEL TODO, no solo la penalización.** Verificando el fix de arriba contra datos reales (Chrome real vía Playwright, backup completo sembrado en `localStorage`), aparecieron 2 problemas más: el grid de Conocimiento mostraba `"🔬 B: 0.0"` para un frasco con `calidadScore:7` porque `_creCompoundAvg()` promediaba `score × (rizoPozitivas/totalPlacas)` — con `rizoPozitivas:0` (dato real y válido) el producto daba 0 sin importar el score. Al ver esto el usuario definió el principio de fondo: **el score siempre es el que se carga a mano; la incidencia rizomórfica es dato complementario y opcional, igual que las fases — nunca ajusta el score.** Consecuencia: `_creCalcCompound()` eliminada por completo (ya no existe la función), `_saveTarget` ya no calcula ni guarda `scoreCompuesto`, las 3 anotaciones "Score 7/10 → 6.3" en auto-notas pasan a ser solo "Score 7/10", el box "Score Compuesto"/"Score Batch" del panel de scoring se elimina del HTML, `_creCompoundAvg()` pasa a promediar `calidadScore` puro. `_creMigrarPenalizacionEliminadaV1()` extendida (mismo flag) para también borrar `scoreCompuesto` de cualquier obs que lo tenga. Root cause real de `CRE-0084` confirmado: el split proporcional de batch nunca se validaba contra el total de la cepa individual — mismo fix de guardia en `_saveTarget`. Verificado en Chrome real (Playwright, Chrome del sistema, sin descargar Chromium) contra el backup completo del usuario (61 records cerrados): grid de Conocimiento, scoring individual y batch, `buildModel()` de Inteligencia (R²=0.933, 26 coefs, 0 NaN/Infinity), `cilabFI.scoreFormula()`, dashboard de CI, barrido de los 8 módulos — cero `pageerror`, cero error de consola nuevo.
- **MEJ-0015 (bug de duplicación de dosis en extras post-creación) — corregido el mismo día:** `_creExtrasBackfillV2()` ahora se salta records cuyo `formulaSnapshot._extrasIncluded` ya es `true` — antes los reprocesaba porque el merge de creación nunca tageaba las entradas individuales con `_extra`. Ver `docs/lab-intelligence/mejoras_app.md` (MEJ-0015).

## 2026-07-22

- **CILAB Conocimiento:** corregida la fórmula real de score compuesto (no coincidía con el código previamente documentado): `base = rizoRatio != null ? score × (0.9 + 0.1 × rizoRatio) : score` (boost leve, tope +10% en rizoRatio=1), `penalty = _creEffectivePenalty(...)`, `scoreCompuesto = max(0, base − penalty)` en `_creCalcCompound()`. `rizoRatio` solo se colecta cuando el score crudo es ≥7.
- **CILAB Conocimiento — decisión de comportamiento:** la penalización por colonización lenta (`_creColonizacionStats()`, `min(3, max(0, días−15)×0.25)`) antes se anulaba por completo cuando el score crudo era ≥7 ("rizomórfico compensa la lentitud"). El usuario decidió que la lentitud debe pesar siempre — colonizar lento sigue costando tiempo real de lab aunque el resultado final sea rizomórfico. Pasa a aplicarse siempre vía `_creEffectivePenalty(rawPenalty, rizoRatio)`, que la atenúa gradualmente con alta incidencia rizomórfica (sin cambios <70%, perdón progresivo 70-100%, cero exactamente en 100%) — lógica que ya existía en el código pero era inalcanzable en la práctica antes de este fix (el corte binario la esquivaba en ambos casos). (Superado al día siguiente — ver entrada 2026-07-23: la penalización se elimina del todo.)

```

- [ ] **Step 2: Verify the CHANGELOG.md insertion**

Run: `grep -n "^## 2026-07-2[2-9]\|^## 2026-07-16" CHANGELOG.md`
Expected: `## 2026-07-23` and `## 2026-07-22` both appear, in that order, both above `## 2026-07-16`.

- [ ] **Step 3: Compress the CLAUDE.md section**

Read `CLAUDE.md`, find the section starting with a line beginning `**Score compuesto — fórmula real (corregida 2026-07-22` and ending with a line beginning `**Verificado en Chrome real (Playwright` (that entire line, which ends `...sin relación con este trabajo).`). This block sits between the "Fases — grid de un click" paragraph (which must NOT be touched) and a paragraph starting `**Aclaración que sigue vigente:**` (which must also NOT be touched — it stays immediately after your replacement). Replace the entire found block (from `**Score compuesto...` through the `...sin relación con este trabajo).` line, inclusive) with exactly this text:

```markdown
**Score = siempre el valor cargado a mano — `scoreCompuesto` no existe (eliminado 2026-07-23).** `scoreObservado`/`rec.scoreFinal`/`scoreFinalNorm` son SIEMPRE `tgt.score` (el score crudo 1-10) — ningún cálculo derivado los alimenta. La incidencia rizomórfica (`rizoPozitivas`/`totalPlacas`) es dato complementario opcional, nunca ajusta el score. `colonizacionDias`/`colonizacionPenalty` se siguen guardando en la obs (informativo) pero no afectan ningún score ni el training data.

**Guard de integridad:** `_saveTarget` clampea `tgt.rizo = tgt.total` si lo supera (cubre tanto scoring individual como batch) — protege contra el caso real `CRE-0084` (rizo>total, imposible).

**Consumidores de `scoreFinal`/`scoreFinalNorm`:** `getCalibrationModel()`/`getCalibratedScore()` (bias de cepa, usa TODOS los records cerrados), `computeRizoLearnIndex()`/`rizoLearnGet()` (advisor de `calcRecomendaciones()` en `cilab_app.js`, clasifica "rizo positivo" con `scoreFinal>=7`/`>=8`, se auto-invalida en cada `creAddObs('definitiva')`). `cilab_inteligencia.js` tiene su propio mecanismo: para records con `rizoPozitivas`/`totalPlacas` válidos el target OLS es `Math.min(1, rizo/total)×10` DIRECTO (bypasea `scoreFinalNorm`); records sin incidencia caen a `scoreFinalNorm/10`.

**`_creCompoundAvg()`** (número resumen de las cards del grid, no toca `bl2_crec`) promedia `calidadScore` puro leído de la última obs `'definitiva'`.

Detalle completo (3 rondas de fixes, causa raíz de CRE-0084, verificación en Chrome real): CHANGELOG.md 2026-07-22 y 2026-07-23.
```

- [ ] **Step 4: Verify the CLAUDE.md compression**

Run: `grep -n "scoreCompuesto no existe\|Aclaración que sigue vigente\|MEJ-0015" CLAUDE.md`
Expected: all 3 present — `scoreCompuesto no existe` (your new text), `Aclaración que sigue vigente` (untouched, right after), `MEJ-0015` (untouched, further below). Also run `grep -c "RESUELTO 2026-07-23" CLAUDE.md` — expected `0` (the old narrative markers are gone from `CLAUDE.md`, they now live only in `CHANGELOG.md`).

---

### Task 2: NOTAS DE SEGUIMIENTO — unificación de shape (2026-07-26)

**Files:**
- Modify: `CHANGELOG.md` (insert 1 new dated entry)
- Modify: `CLAUDE.md` (compress one section)

- [ ] **Step 1: Insert the new CHANGELOG.md entry**

Read `CHANGELOG.md`. Find the `# Changelog` line followed by a blank line, followed by the current first dated entry (after Task 1 ran, that should be `## 2026-07-23` — re-read to confirm). Insert the following entry immediately between the blank line after `# Changelog` and that first existing dated entry, exactly as written:

```markdown
## 2026-07-26

- **CI/GR/SU/FR — unificación de shape de notas de seguimiento.** Los 4 sistemas de notas (`bl2_seg_notas`, `gr_lotes[].seguimientoNotas`, `su_lotes[].dbSeguimiento`, `fr_bolsas[].observaciones`) pasan a compartir el mismo shape de objeto (`id`, `ts`, `tsLegacy`, `tsInferred`, `texto`, `estado`, `auto`, `tipo`, `editedAt`, `imagenes`), aunque cada módulo sigue escribiendo a su propia key — no hay array centralizado. CILAB Conocimiento (`bl2_crec_notas`) queda explícitamente fuera (ya usaba `id` estable, sin `estado`/color, sin nota manual libre real). Diseño: `docs/superpowers/specs/2026-07-26-unificacion-notas-seguimiento-design.md`. Plan: `docs/superpowers/plans/2026-07-26-unificacion-notas-seguimiento.md`.
- **Migraciones one-shot, una por módulo** (mismo patrón flag-after-persist, `biolab_migracion_<modulo>_notas_unificadas_v1`): `_frMigrarNotasUnificadasV1`, `_suMigrarNotasUnificadasV1`, `_segMigrarNotasUnificadasV1`, `_grMigrarNotasUnificadasV1`. Verificadas contra backup real de producción: FR 344/344 notas, SU 87/87, CI 192/192 (44 con `tsInferred:true`), GR 135/135 — cero pérdida de datos.
- **Reconstrucción de `ts` sin año (GR y CI):** cada nota se ancla de forma independiente (nunca encadenada con la nota anterior) a una fecha real del contexto padre (`lote.fecha` en GR, `bl2_forms[formulaId].fecha` en CI), buscando el año más chico tal que la fecha reconstruida sea ≥ esa ancla — nunca anclar al momento en que corre la migración. Se descartó interpolar con la nota vecina en el array: `bl2_seg_notas[formulaId]` en CI no está en orden cronológico (un escritor usa `.unshift()`, los otros `.push()`), un enfoque posicional dio 39/44 violaciones al validarlo.
- **CI — direccionamiento por `id`, no por índice:** `segEditarNota`/`segGuardarEdicionNota`/`segEliminarSeguimientoNota`/`segVerImagenNota`/`segEliminarImagenNota`/`_segRenderNotaTimeline` migrados de índice a `id`. `segPersistirNotas` simplificado a merge por `Set` de ids (reemplaza el matching por `ts+texto`/`_eventType+tandaId` que causó la pérdida real de notas documentada en MEJ-0010).
- **Bug real — `segPersistirNotas` duplicaba notas sin `id` de un escritor externo:** `_creWriteAutoNota` (`cilab_conocimiento.js`) nunca seteaba `id`. El primer intento de fix mutaba un objeto descartable parseado fresco de storage, nunca el objeto real en `SEG.seguimientoNotas` — la nota duplicaba en cada persist (1→2→4→8...). Causa raíz real: `segCargarNotas()` seteaba `SEG.seguimientoNotas` ANTES de llamar a la migración (que hace su propio parse/migra/escribe independiente) — la sesión operaba sobre notas sin migrar en memoria aunque `localStorage` ya estuviera migrado. Fix definitivo: invertir el orden (migración primero, parse lee el storage ya migrado en la misma llamada).
- **Patrón de edición seguro adoptado en los 4 módulos:** `document.createElement('input')` + `.onkeydown` como closure real, nunca string interpolado en atributo HTML inline — un intento inicial en FR usaba interpolación y un apóstrofo en el texto rompía el JS generado, matando en silencio guardar/cancelar. Mismo patrón que ya usaba `segEditarNota` en CI (por eso nunca tuvo el bug).
- **Código muerto eliminado — `SU.reNotas`:** sistema de notas paralelo a `dbSeguimiento`, confirmado sin uso real (0 registros en producción, sin elementos DOM que lo dispararan). Mismo criterio que `ci_comparador.js`.
- **Hallazgo, no corregido:** `ci_app.js`/`gr_app.js` tienen un fallback de auto-init muerto que dispara siempre (el script se inyecta después de `DOMContentLoaded`) — `ciInit()`/`grInit()` corren dos veces por montaje. Inofensivo en la práctica (migraciones idempotentes), pero causó un falso-positivo en un test de integración con timeout fijo durante esta sesión.

```

- [ ] **Step 2: Verify the CHANGELOG.md insertion**

Run: `grep -n "^## 2026-07-2[3-9]\|^## 2026-07-16" CHANGELOG.md`
Expected: `## 2026-07-26`, `## 2026-07-23`, `## 2026-07-22` in that order (from Task 1), all above `## 2026-07-16`.

- [ ] **Step 3: Compress the CLAUDE.md section**

Read `CLAUDE.md`, find the section titled `## NOTAS DE SEGUIMIENTO — Shape unificado en CI/GR/SU/FR (2026-07-26)`. Inside it, find the block starting with a line beginning `**Migraciones one-shot, una por módulo**` and ending with a line beginning `**Hallazgo nuevo, no corregido` (that entire paragraph, which ends `...sacar el fallback muerto de la cola de ambos archivos.`). Everything BEFORE this block (the section title, the opening paragraph about the 4 systems sharing a shape, the ` ```js{...}``` ` canonical shape code block, and the CILAB Conocimiento exclusion note) must NOT be touched. Replace the found block (from `**Migraciones one-shot...` through `...cola de ambos archivos.`, inclusive) with exactly this text:

```markdown
**Invariantes vigentes:**
- Direccionamiento por `id`, nunca por índice de array (CI: `segEditarNota`/`segGuardarEdicionNota`/`segEliminarSeguimientoNota`/`segVerImagenNota`/`segEliminarImagenNota`/`_segRenderNotaTimeline`).
- Patrón de edición seguro: `document.createElement('input')` + `.onkeydown` como closure real — nunca string interpolado en atributo HTML inline (un apóstrofo en el texto rompe el JS generado). Convención en los 4 módulos.
- Persistencia diferida (GR/SU: recién a `localStorage` al guardar el lote completo) vs inmediata (FR/CI: cada acción persiste al toque) — sin cambios de arquitectura por esta unificación.
- Migraciones one-shot por módulo, mismo flag pattern (`biolab_migracion_<modulo>_notas_unificadas_v1`): `_frMigrarNotasUnificadasV1`/`_suMigrarNotasUnificadasV1`/`_segMigrarNotasUnificadasV1`/`_grMigrarNotasUnificadasV1`.

**Gotcha vigente, no corregido:** `ci_app.js`/`gr_app.js` tienen un fallback de auto-init muerto (dispara siempre porque el script se inyecta después de `DOMContentLoaded`) — `ciInit()`/`grInit()` corren dos veces en cada montaje. Inofensivo (migraciones idempotentes) pero puede dar falsos positivos en tests con timeout fijo.

Detalle completo (migraciones verificadas contra backup real, bug de race condition en `segPersistirNotas`, root cause del código muerto `SU.reNotas`): CHANGELOG.md 2026-07-26.
```

- [ ] **Step 4: Verify the CLAUDE.md compression**

Run: `grep -n "Invariantes vigentes:\*\*$" CLAUDE.md` (should match at least this new occurrence — there may be others elsewhere in the file, that's fine) and `grep -c "192/192 (44 con" CLAUDE.md` — expected `0` (verification counts now live only in `CHANGELOG.md`). Also confirm the shape code block (` ```js` with `id: string,` etc.) is still present: `grep -n "id: string," CLAUDE.md` should still return a match.

---

### Task 3: GITHUB — unificación export/import local (2026-07-28)

**Files:**
- Modify: `CHANGELOG.md` (insert 1 new dated entry)
- Modify: `CLAUDE.md` (compress one section)

- [ ] **Step 1: Insert the new CHANGELOG.md entry**

Read `CHANGELOG.md`. Find the `# Changelog` line followed by a blank line, followed by the current first dated entry (after Tasks 1-2 ran, that should be `## 2026-07-26` — re-read to confirm). Insert the following entry immediately between the blank line after `# Changelog` and that first existing dated entry, exactly as written:

```markdown
## 2026-07-28

- **CFG — unificación de export/import local, de 3 botones de export + 2 de import a 1 solo par.** El usuario reportó que "↓ Exportar JSON" descargaba un archivo más pesado que "💾 Exportar sistema completo", sospechando pérdida de datos. La diferencia de tamaño NO era pérdida de datos: `exportAll()` guardaba cada valor como string cruda (compacta); `localExport()`/`exportData()` parseaban a objeto y aplicaban `JSON.stringify(data, null, 2)` sobre toda la estructura anidada, agregando indentación en arrays grandes. Verificado con un backup real: mismas 50/50 keys, 0 diferencia de contenido, ~33% más pesado solo por formato.
- **Bug real y serio encontrado en el camino:** `importAll()` hacía `localStorage.setItem(key, data[key])` sin chequear tipo — un archivo del formato viejo (`localExport`/`exportData`, valores ya parseados) corrompía cada key array/objeto a la string literal `"[object Object],[object Object],..."`, combinado con el `localStorage.clear()` previo hubiera sido pérdida total sin aviso (mensaje de éxito engañoso). Confirmado con test directo de coerción de JS.
- **Fix:** `exportSystem()`/`importSystem()` (nuevas, reemplazan las 6 funciones viejas — `localExport`/`exportData`/`exportAll`/`localImport`/`importData`/`importAll`) capturan TODO `localStorage` sin depender de `BK_PREFIXES`, nunca tocan `bl2_gh`, el import usa `typeof v === 'string' ? v : JSON.stringify(v)` para restaurar cualquier formato viejo sin corromper. `bkCollectAll`/`bkAllKeys`/`bkRestoreAll`/`BK_PREFIXES`/`BK_EXCLUDE` no se tocaron, siguen siendo la base de `ghLoadLatest`/`ghRestore`/`hardReset`.
- **Verificado independientemente por una segunda corrida de `biolab-analyst`** (diff directo de contenido entre un backup local nuevo y uno de GitHub Sync de una hora antes: 0 diferencias reales).
- **Corrección posterior, mismo día — `ghData()` alineado al formato compacto:** seguía usando `bkCollectAll` (valores parseados), un backup de GitHub Sync pesaba ~33% más que uno local con el mismo contenido — generó una segunda alarma de "pérdida de datos" en la misma sesión, verificada con un backup real (1677KB → 1263KB con el mismo contenido). Fix: `ghData()` pasa a usar `_bkCollectRaw()` (la misma función de `exportSystem`).
- **Agregado en la misma sesión:** botón "⬇ Descargar" (`ghDownload(path)`) en "Ver backups" — baja el blob decodificado tal cual, sin re-serializar, para que coincida byte a byte con el tamaño mostrado.
- Verificado con Node (round-trip de ambos formatos) y en Chrome real vía Playwright: export/import end-to-end, `bl2_gh` sobrevive intacto, 0 errores de consola nuevos.
- **Hallazgo pendiente, no corregido — colisión de nombres real entre módulos:** `ci/ci_app.js` define sus propias `exportData()`/`importData()` (backup parcial, solo CI) que pisan las de CFG en `window` mientras CI esté cargado. El botón "💾 Backup Completo" de CI es un nombre engañoso — solo hace backup de CI. Pendiente de decisión del usuario.

```

- [ ] **Step 2: Verify the CHANGELOG.md insertion**

Run: `grep -n "^## 2026-07-2[2-9]\|^## 2026-07-16" CHANGELOG.md`
Expected order top to bottom: `## 2026-07-28`, `## 2026-07-26`, `## 2026-07-23`, `## 2026-07-22`, then `## 2026-07-16`.

- [ ] **Step 3: Compress the CLAUDE.md section**

Read `CLAUDE.md`, find the section titled `## GITHUB — Publicación y Backups (2026-07-09/10)`. Do NOT touch anything from the section title down through the line `Spec completo: \`docs/superpowers/specs/2026-07-09-github-publish-backup-design.md\`.` — that's the base architecture description and stays as-is. Immediately after that line (and the blank line following it), find the block starting with a line beginning `**Unificación de backup/restore local (2026-07-28)` and ending with a line beginning `- **Hallazgo pendiente, NO corregido en esta sesión` (that entire paragraph, which ends `...pendiente de decisión del usuario.`). Replace the found block (from `**Unificación de backup/restore local...` through `...pendiente de decisión del usuario.`, inclusive) with exactly this text:

```markdown
**Export/import local — solo 2 funciones, ambas en formato compacto.** `exportSystem()`/`importSystem()` (`cfg_app.js`) reemplazan las 6 funciones viejas (`localExport`/`exportData`/`exportAll`/`localImport`/`importData`/`importAll` — no confiar en menciones de esos 6 nombres en specs/plans viejos). Capturan TODO `localStorage` sin depender de `BK_PREFIXES`, nunca tocan `bl2_gh`, import usa `typeof v === 'string' ? v : JSON.stringify(v)` para restaurar cualquier formato viejo sin corromper. `ghData()` (usado por `ghBackup`) usa la misma `_bkCollectRaw()` — un backup de GitHub Sync pesa lo mismo que uno local con contenido idéntico. `bkCollectAll`/`bkAllKeys`/`bkRestoreAll`/`BK_PREFIXES`/`BK_EXCLUDE` sin cambios, siguen siendo la base de `ghLoadLatest`/`ghRestore`/`hardReset`. `ghDownload(path)` (en "Ver backups") baja el blob decodificado tal cual, sin re-serializar.

**Gotcha vigente, no corregido — colisión de nombres `exportData`/`importData` entre CI y CFG:** `ci/ci_app.js` define sus propias `exportData()`/`importData()` top-level (backup parcial, solo CI) que pisan las de CFG en `window` mientras CI esté cargado (`loadModule()` reinyecta el script del último módulo). El botón "💾 Backup Completo" de CI es un nombre engañoso — solo hace backup de CI, no del sistema. Pendiente de decisión del usuario.

Detalle completo (bug de corrupción de `importAll()` con formatos viejos, verificación independiente por una segunda corrida de `biolab-analyst`, la saga completa de por qué 3 botones colapsaron a 1): CHANGELOG.md 2026-07-28.
```

- [ ] **Step 4: Verify the CLAUDE.md compression**

Run: `grep -c "Debug sistemático\|systematic-debugging" CLAUDE.md` — expected `0`. Run: `grep -n "Export/import local — solo 2 funciones" CLAUDE.md` — expected 1 match. Confirm the base architecture (untouched) is still present: `grep -n "Arquitectura de 2 repos" CLAUDE.md` — expected 1 match, unchanged location.

---

## Final verification (all tasks)

- [ ] Run: `wc -l CLAUDE.md CHANGELOG.md` — `CLAUDE.md` should have dropped from 599 lines to roughly 530-545; `CHANGELOG.md` should have grown from 176 lines to roughly 275-300.
- [ ] Run: `grep -n "^## " CHANGELOG.md | head -6` — expected exactly `## 2026-07-28`, `## 2026-07-26`, `## 2026-07-23`, `## 2026-07-22`, `## 2026-07-16`, `## 2026-07-15` in that order (top to bottom).
- [ ] Read the full `CLAUDE.md` once, start to finish, and confirm: no section reads as an incomplete thought (every section that was touched still flows grammatically into what follows it — e.g. Task 1's replacement flows into the untouched "Aclaración que sigue vigente" paragraph, Task 2's replacement flows into the section's closing `---`, Task 3's replacement flows into the section's closing `---`), and no invariant/rule from the "Componentes" section of the design spec is missing from the compressed text.
- [ ] No `git add`/`git commit` — both files are intentionally gitignored.
