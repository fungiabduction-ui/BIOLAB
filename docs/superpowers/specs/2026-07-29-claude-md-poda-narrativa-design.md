# CLAUDE.md — poda de narrativa post-2026-07-16 (spec A)

## Contexto

`CLAUDE.md` (raíz del repo) declara su propia regla desde hace tiempo: "el historial completo va en `CHANGELOG.md`, acá solo invariantes vigentes." `CHANGELOG.md` existe, tiene el formato correcto (`## YYYY-MM-DD`, bullets por módulo), y cubre fielmente hasta el **2026-07-16**. Después de esa fecha la disciplina se rompió: 3 secciones de `CLAUDE.md` acumularon narrativa completa de incidentes (sagas de varias rondas, debugging paso a paso, verificaciones) que nunca migró a `CHANGELOG.md`. Como `biolab-analyst` (y cualquier sesión de código en este repo) lee `CLAUDE.md` completo cada vez, esa narrativa se paga en tokens en cada corrida sin aportar nada que un invariante de 1-2 líneas no diga igual de bien.

**Mecanismo:** el texto narrativo completo se muda, esencialmente palabra por palabra, a una entrada nueva en `CHANGELOG.md` bajo la fecha real del evento. En `CLAUDE.md` queda solo el estado vigente (qué es cierto HOY) con un puntero `Detalle completo: CHANGELOG.md YYYY-MM-DD` al final de la sección. No se resume con pérdida — se relocaliza.

**Alcance — 3 secciones** (las únicas con narrativa real fechada 2026-07-22 en adelante sin migrar; confirmado grepeando todos los headers `##`/fechas del archivo):
1. CILAB CONOCIMIENTO — saga `scoreCompuesto` (líneas 295-333 actuales)
2. NOTAS DE SEGUIMIENTO — unificación de shape (líneas 522-559 actuales, el bloque de shape canónico NO se toca)
3. GITHUB — unificación export/import local (líneas 578-588 actuales, la sección base de arquitectura 561-576 NO se toca, ya está bien podada)

**Fuera de alcance, decidido explícitamente:** la sección "CILAB INTELIGENCIA — evidencia empírica del Optimizador" (línea 366) tiene fechas pero es justificación de una regla vigente, no arqueología de bug — no se toca. Las secciones fechadas 07-15/07-16 (SU migración V2, FR fechaInicio) ya están duplicadas en `CHANGELOG.md` pero quedan fuera del rango acordado (2026-07-22+) — candidatas a una pasada futura, no esta.

## Componentes

### 1. CILAB CONOCIMIENTO — saga `scoreCompuesto`

**CLAUDE.md** — el bloque narrativo (desde `**Score compuesto — fórmula real (corregida 2026-07-22...)**` hasta el final de `**RESUELTO 2026-07-23 (ronda 3...)**`, antes de la línea de MEJ-0015 que ya es compacta y no se toca) se reemplaza por:

```markdown
**Score = siempre el valor cargado a mano — `scoreCompuesto` no existe (eliminado 2026-07-23).** `scoreObservado`/`rec.scoreFinal`/`scoreFinalNorm` son SIEMPRE `tgt.score` (el score crudo 1-10) — ningún cálculo derivado los alimenta. La incidencia rizomórfica (`rizoPozitivas`/`totalPlacas`) es dato complementario opcional, nunca ajusta el score. `colonizacionDias`/`colonizacionPenalty` se siguen guardando en la obs (informativo) pero no afectan ningún score ni el training data.

**Guard de integridad:** `_saveTarget` clampea `tgt.rizo = tgt.total` si lo supera (cubre tanto scoring individual como batch) — protege contra el caso real `CRE-0084` (rizo>total, imposible).

**Consumidores de `scoreFinal`/`scoreFinalNorm`:** `getCalibrationModel()`/`getCalibratedScore()` (bias de cepa, usa TODOS los records cerrados), `computeRizoLearnIndex()`/`rizoLearnGet()` (advisor de `calcRecomendaciones()` en `cilab_app.js`, clasifica "rizo positivo" con `scoreFinal>=7`/`>=8`, se auto-invalida en cada `creAddObs('definitiva')`). `cilab_inteligencia.js` tiene su propio mecanismo: para records con `rizoPozitivas`/`totalPlacas` válidos el target OLS es `Math.min(1, rizo/total)×10` DIRECTO (bypasea `scoreFinalNorm`); records sin incidencia caen a `scoreFinalNorm/10`.

**`_creCompoundAvg()`** (número resumen de las cards del grid, no toca `bl2_crec`) promedia `calidadScore` puro leído de la última obs `'definitiva'`.

Detalle completo (3 rondas de fixes, causa raíz de CRE-0084, verificación en Chrome real): CHANGELOG.md 2026-07-22 y 2026-07-23.
```

**CHANGELOG.md** — 2 entradas nuevas (`## 2026-07-22` y `## 2026-07-23`), insertadas antes de `## 2026-07-16`, preservando la narrativa completa actual de `CLAUDE.md` reformateada como bullets `- **CILAB Conocimiento:** ...` (fórmula real del compuesto + decisión de política sobre penalización por colonización lenta, el día 22; eliminación total de `scoreCompuesto`, auditoría de consumidores, migración `_creMigrarPenalizacionEliminadaV1`, bug de `rizoRatio>1` con su causa raíz en el split de batch, ronda 3 con el bug de `_creCompoundAvg()` y el principio de fondo que definió el usuario, y MEJ-0015, el día 23).

### 2. NOTAS DE SEGUIMIENTO — unificación de shape

**CLAUDE.md** — se mantiene intacto: el párrafo de apertura, el bloque de shape canónico (```js{...}```) y la nota sobre CILAB Conocimiento quedando afuera. Se reemplaza todo lo posterior (desde "Migraciones one-shot, una por módulo" hasta el final de la sección) por:

```markdown
**Invariantes vigentes:**
- Direccionamiento por `id`, nunca por índice de array (CI: `segEditarNota`/`segGuardarEdicionNota`/`segEliminarSeguimientoNota`/`segVerImagenNota`/`segEliminarImagenNota`/`_segRenderNotaTimeline`).
- Patrón de edición seguro: `document.createElement('input')` + `.onkeydown` como closure real — nunca string interpolado en atributo HTML inline (un apóstrofo en el texto rompe el JS generado). Convención en los 4 módulos.
- Persistencia diferida (GR/SU: recién a `localStorage` al guardar el lote completo) vs inmediata (FR/CI: cada acción persiste al toque) — sin cambios de arquitectura por esta unificación.
- Migraciones one-shot por módulo, mismo flag pattern (`biolab_migracion_<modulo>_notas_unificadas_v1`): `_frMigrarNotasUnificadasV1`/`_suMigrarNotasUnificadasV1`/`_segMigrarNotasUnificadasV1`/`_grMigrarNotasUnificadasV1`.

**Gotcha vigente, no corregido:** `ci_app.js`/`gr_app.js` tienen un fallback de auto-init muerto (dispara siempre porque el script se inyecta después de `DOMContentLoaded`) — `ciInit()`/`grInit()` corren dos veces en cada montaje. Inofensivo (migraciones idempotentes) pero puede dar falsos positivos en tests con timeout fijo.

Detalle completo (migraciones verificadas contra backup real, bug de race condition en `segPersistirNotas`, root cause del código muerto `SU.reNotas`): CHANGELOG.md 2026-07-26.
```

**CHANGELOG.md** — 1 entrada nueva (`## 2026-07-26`), preservando: el anuncio de la unificación con sus 2 links a spec/plan, los conteos de verificación de las 4 migraciones (FR 344/344, SU 87/87, CI 192/192 con 44 `tsInferred`, GR 135/135), la regla de reconstrucción de `ts` sin año (y por qué se descartó interpolar posicionalmente — 39/44 violaciones), el bug real de `segPersistirNotas` duplicando notas sin `id` con su causa raíz completa, el patrón de edición segura y por qué se adoptó, la eliminación de `SU.reNotas`, y el hallazgo del doble-init no corregido.

### 3. GITHUB — unificación export/import local

**CLAUDE.md** — la sección base (líneas 561-576, arquitectura de 2 repos + GitHub Sync) no se toca. El bloque narrativo que arranca en `**Unificación de backup/restore local (2026-07-28)...**` se reemplaza por:

```markdown
**Export/import local — solo 2 funciones, ambas en formato compacto.** `exportSystem()`/`importSystem()` (`cfg_app.js`) reemplazan las 6 funciones viejas (`localExport`/`exportData`/`exportAll`/`localImport`/`importData`/`importAll` — no confiar en menciones de esos 6 nombres en specs/plans viejos). Capturan TODO `localStorage` sin depender de `BK_PREFIXES`, nunca tocan `bl2_gh`, import usa `typeof v === 'string' ? v : JSON.stringify(v)` para restaurar cualquier formato viejo sin corromper. `ghData()` (usado por `ghBackup`) usa la misma `_bkCollectRaw()` — un backup de GitHub Sync pesa lo mismo que uno local con contenido idéntico. `bkCollectAll`/`bkAllKeys`/`bkRestoreAll`/`BK_PREFIXES`/`BK_EXCLUDE` sin cambios, siguen siendo la base de `ghLoadLatest`/`ghRestore`/`hardReset`. `ghDownload(path)` (en "Ver backups") baja el blob decodificado tal cual, sin re-serializar.

**Gotcha vigente, no corregido — colisión de nombres `exportData`/`importData` entre CI y CFG:** `ci/ci_app.js` define sus propias `exportData()`/`importData()` top-level (backup parcial, solo CI) que pisan las de CFG en `window` mientras CI esté cargado (`loadModule()` reinyecta el script del último módulo). El botón "💾 Backup Completo" de CI es un nombre engañoso — solo hace backup de CI, no del sistema. Pendiente de decisión del usuario.

Detalle completo (bug de corrupción de `importAll()` con formatos viejos, verificación independiente por una segunda corrida de `biolab-analyst`, la saga completa de por qué 3 botones colapsaron a 1): CHANGELOG.md 2026-07-28.
```

**CHANGELOG.md** — 1 entrada nueva (`## 2026-07-28`), preservando: el reporte original del usuario y el diagnóstico de que la diferencia de tamaño NO era pérdida de datos, el bug serio de `importAll()` corrompiendo a `"[object Object],..."`, el fix con `exportSystem()`/`importSystem()`, la verificación independiente por una segunda corrida de `biolab-analyst`, la corrección posterior de `ghData()` el mismo día con las cifras reales (1677KB→1263KB), el agregado de `ghDownload()`, y el hallazgo pendiente de la colisión de nombres CI/CFG.

## Errores y edge cases

- **Orden de inserción en CHANGELOG.md:** las 4 entradas nuevas (07-22, 07-23, 07-26, 07-28) van todas ANTES de la entrada existente `## 2026-07-16` (línea 9 actual), en orden descendente (07-28 primero, 07-22 último) — mismo orden reverse-chronological que ya tiene el archivo.
- **No se toca `bkCollectAll`/`bkAllKeys`/`bkRestoreAll`/`BK_PREFIXES`/`BK_EXCLUDE`** en ningún lado — la poda es de texto en `CLAUDE.md`, no hay cambio de código de la app en este spec.
- **Ambos archivos (`CLAUDE.md`, `CHANGELOG.md`) están gitignored** (`.gitignore` líneas 2-4) — no hay `git add`/`git commit` para estos cambios, igual que en spec B.

## Testing / verificación

No hay tests automatizados (son archivos de documentación). Verificación:
- Grep de las 3 secciones en `CLAUDE.md` — confirmar que las fechas 2026-07-22/23/26/28 ya no aparecen mezcladas con narrativa dentro de esas secciones (solo en el puntero final `Detalle completo: CHANGELOG.md YYYY-MM-DD`).
- Grep de las 4 fechas nuevas en `CHANGELOG.md` — confirmar que las 4 entradas existen con el contenido esperado.
- Diff de longitud: `CLAUDE.md` debería bajar de ~599 a ~530-540 líneas aproximadamente; `CHANGELOG.md` debería subir de 176 a ~280-300 líneas aproximadamente.
- Lectura completa de las 3 secciones podadas en `CLAUDE.md` — confirmar que ningún invariante/regla vigente se perdió en la compresión (comparar contra el detalle de "Componentes" arriba).
