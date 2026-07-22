---
name: biolab-analyst
description: Use when the user asks to analyze their biolab-app data, review mushroom cultivation lab results, find cross-module patterns across CI/CILAB/GR/SU/FR, get protocol/experiment suggestions or an expert diagnostic read, update the lab intelligence notebook, register research hypotheses/open questions, or record personal annotations/backlog fixes. Needs a biolab-backup-*.json export in the repo root.
---

# biolab-analyst

## Overview

Reads a `biolab-backup-*.json` export of the biolab-app and writes dated findings to `docs/lab-intelligence/notebook.md`: cross-module correlations (formula → theoretical score → grain protocol → substrate → fruiting outcome), biochemical interpretation of the OLS model and route-attribution signals, and concrete next-experiment/protocol/app suggestions. It also keeps a separate, permanent timeline of the user's own corrections/observations (`docs/lab-intelligence/anotaciones.md`), maintains a backlog of app-improvement suggestions (`docs/lab-intelligence/mejoras_app.md`), and tracks open research questions and experimental designs, one file per pipeline module, in `docs/lab-intelligence/hipotesis/` (see `index.md` there for the convention). Read `CLAUDE.md` and `BIOLAB_SYSTEM.md` in the repo root first — they document the current schema and invariants, which change often. If either file is missing from the repo root, say so explicitly and proceed with reduced confidence about current schema/invariants rather than guessing — do not silently skip the check. Never invent a causal claim the data doesn't support; state confidence explicitly (alta/media/baja, correlational vs n-limited).

## Which mode?

- User wants lab data analyzed/reviewed/explained, wants to know what's new since the last run, wants next-experiment or protocol suggestions, or explicitly asks for a "full"/"complete" review (`análisis completo`) → **Modo análisis**.
- User states a correction, explanation, or standing observation about their lab data that they want remembered — in normal conversation, no fixed trigger phrase needed (e.g. "las deformaciones de esta bolsa son por frío, no por el aditivo") → **Modo anotación**.
- User shares research hypotheses, raises biological/chemical questions, proposes conceptual experimental designs, wants to log evidence for an existing hypothesis, or confirms one is answered → **Modo hipótesis y preguntas**.
- User explicitly asks to bring an annotation back into the app itself (e.g. "preparame el archivo para reimportar esto") → **Modo avanzado — preparar reimport**. Never enter this mode on your own initiative.
- User confirms an app-improvement backlog item is fixed (e.g. "ya arreglé lo del bioConflict") → **Confirmar resolución de un item del backlog**.
- A single message can trigger more than one mode (e.g. asking for analysis while also stating a correction or registering a hypothesis) — handle each part with its own mode's steps rather than picking only one.
- User asks what's already been annotated about something (e.g. "¿qué anoté sobre esto?") → just read `anotaciones.md` and/or the relevant native notes and answer directly, no special steps.
- User asks about registered hypotheses or open questions (e.g. "¿qué hipótesis tenemos sobre X?") → read the relevant file(s) in `docs/lab-intelligence/hipotesis/` (see `index.md` for which one) and respond.

## Modo análisis

1. Find the newest `biolab-backup-*.json` in the repo root by its internal `_exported` field (not file mtime). None found, or `_exported` more than 7 days old → tell the user and ask for a fresh export from CFG before continuing, unless they explicitly say to proceed anyway. File doesn't parse as JSON, or is missing an expected top-level key (`bl2_crec`, `fr_bolsas`, `bl2_inteligencia_model`, `bl2_formula_intel`, `gr_lotes`, `su_lotes`, `bl2_experimentos`, `fr_cal_intel`, `bl2_ings`) → say exactly which key is missing and stop; never analyze with a partial/guessed dataset.
2. Read `docs/lab-intelligence/checkpoint.json`. Missing → first run, treat as **full-history mode** regardless of what was asked. Checkpoint present but the user explicitly asked for a full/complete review (`análisis completo`, `/biolab-analyst full`) → also use **full-history mode** (step 4), skip the diff in step 3.
3. **Incremental mode:** diff the backup against the checkpoint:
   - `bl2_crec` records with `status:'cerrado'` whose `id` isn't in `checkpoint.creClosedIds`
   - `fr_bolsas` with `cicloCerrado:true` whose `_frUuid` isn't in `checkpoint.frClosedIds` — use `_frUuid`, never the visible `id`: `id` can be renamed later (`_frRenombrarId`) or be `null` for a bolsa that never got one, while `_frUuid` is permanent
   - `bl2_inteligencia_model.computedAt` vs `checkpoint.inteligenciaModelComputedAt`, or `bl2_formula_intel.computedAt` vs `checkpoint.formulaIntelComputedAt`, differ → model was recomputed
   - `bl2_experimentos` entries not in `checkpoint.experimentoIds`
   - `fr_cal_intel.anomalousBolsas` entries not in `checkpoint.anomalousBolsaIds`
   - Nothing new → say so, don't write a notebook entry.
   - Checkpoint references an id no longer in the backup → flag it as a warning in the entry, don't fail silently.
4. **Full-history mode:** same analysis, but over the entire dataset instead of just the diff.
5. For each item in scope, trace the full chain by shared ids: CI formula (`bl2_forms`/`formulaSnapshot`) → CILAB theoretical score → GR protocol (`gr_lotes`, via `grLoteId`/`grTandaId`) → SU substrate (`su_lotes`, via `suLoteId`, additives/hydration) → FR outcome (`fr_bolsas`, BE, `flush.calidad`, anomalies).
6. Cross-reference against `bl2_ings[].bio.mecanismo` / `bio.contribuciones` and `bl2_formula_intel.routeAttribution` — explain findings in terms of the actual metabolic route/cofactor involved, not just "coef went up."
7. **Revisar código fuente ante un hallazgo inesperado:** when a finding contradicts a documented invariant in `CLAUDE.md`/`BIOLAB_SYSTEM.md`, or a value that should vary but never does across the whole scope of this run, read the actual function involved in the app's source before concluding — don't just report the statistical oddity unexplained (this is exactly how the `bioConflict` bug in `cilab_inteligencia.js` was found). This is targeted at the one function implicated by the surprising finding, not a general code audit. If it reveals a real bug, carry it into step 12 as a `bug`-category backlog candidate.
8. Check for existing user context before writing each finding: `docs/lab-intelligence/anotaciones.md` (if it exists) AND native manual notes already sitting in the backup — `fr_bolsas[].observaciones` entries with `tipo:'manual'`, `su_lotes[].dbSeguimiento` non-automatic entries. Both are the same category of "user already told the system this," just through different channels. If one is relevant to a finding (same id in scope, or a `general/*` annotation whose pattern plausibly applies — e.g. a seasonal/temperature note and the finding involves a bolsa harvested in that season), mention it alongside the finding ("el modelo atribuye X a Y, pero hay una nota tuya de [fecha] que sugiere Z"). Match by the permanent internal id (`_frUuid`/`_uuid`) when present in the annotation tag, not just the visible id, since the visible id may have changed since the annotation was written. Never adjust the finding's stated confidence because of this — it's added context, not an override.
9. Call out explicitly, when relevant to what's in scope: ingredients with `confidence:'indeterminate'` or `bioConflict:true`, entries from `experimentAdvice.topUncertainIngredients` the new data affects, and new anomalies with a hypothesis marked correlational unless there's a real isolating comparison.
10. **Cruce con hipótesis abiertas (solo lectura):** determine which file(s) in `docs/lab-intelligence/hipotesis/` cover the modules touched by this run's scope (e.g. `fr_bolsas` in scope → read `fr.md` + `cross-modulo.md`). For each `abierta`/`en_investigación` hypothesis whose topic overlaps a finding from steps 5-9 (same ingredient/strain/pattern), mention the connection in that finding's text ("esto es evidencia para/contra HIP-FR-0002"). **Never write to `hipotesis/` here** — if the finding is worth logging as formal evidence, say so as a suggestion ("considerá registrar esto en HIP-FR-0002 vía Modo hipótesis y preguntas") and let the user confirm. A new pattern with no matching hypothesis still only goes into `**Hipótesis a probar / próximos experimentos:**` (step 13) as before — optionally note it's a candidate for a new `hipotesis/` entry if the user wants to register it.
11. **Diagnóstico experto:** when there's something real to synthesize about what's in scope (not every run needs one), write a verdict in the tone of a mycologist/biotech professional giving their read of the case — not a restatement of the `Hallazgos`. Combine the findings from steps 5-9 with general mycology/biotech domain knowledge. Non-negotiable rule: never state as fact something the data marks uncertain (`confidence:'indeterminate'`, low `n`, `bioConflict:true`) — reason *through* the uncertainty instead ("con n=8 no se puede confirmar estadísticamente, pero el mecanismo conocido de X es consistente con esta lectura, y es lo que priorizaría investigar primero"). Always distinguish in the text which part is "esto lo prueba el dato" vs. "esta es mi lectura profesional."
12. **Backlog de mejoras:** before finalizing `Sugerencias para la app` for this entry, read `docs/lab-intelligence/mejoras_app.md` (create it with a one-line header if it doesn't exist) for every app-improvement candidate gathered in steps 7/11/general observation:
    - Matches an existing `abierta` or `reforzada` item (by your own reading/judgment of the description, not an algorithmic matcher) → append a dated line to that item's `Evidencia`, and if it was `abierta` it becomes `reforzada`. Don't create a duplicate item.
    - Matches an item already `resuelta` → do NOT reopen it yourself. Add the observation to its `Evidencia` and flag it in this entry's `Sugerencias para la app` as a possible regression ("MEJ-00XX estaba marcada resuelta el [fecha], pero esto parece el mismo patrón — ¿regresión o caso distinto?").
    - No match → create a new item, next sequential `MEJ-00XX` id, `estado: abierta`.
    - If an existing `abierta`/`reforzada` item's pattern was expected to reappear in this run's scope and didn't → mention it in `Sugerencias para la app` as a soft "¿ya se resolvió esto?" signal, but don't change its `estado` — only an explicit user confirmation does that (see "Confirmar resolución de un item del backlog").
    - Reference the resulting id in the notebook entry's `Sugerencias para la app` line: `(nuevo → MEJ-0004)` or `(refuerza MEJ-0001, ver mejoras_app.md)`.
13. Append an entry to `docs/lab-intelligence/notebook.md` (create the file with a one-line header if it doesn't exist) using the template below, with `HH:MM` in the header timestamp (`## 2026-07-14 14:32 — full`). Empty sections get an explicit "nada nuevo que reportar" line, never filler.
14. Write/update `docs/lab-intelligence/checkpoint.json` with the current state (schema below).

## Modo anotación

1. Confirm in one line what you're about to save (a short paraphrase, not necessarily a literal copy) before writing anything.
2. Determine the scope tag: a real id from the newest backup if the user names one and it actually exists there. If the user names an id that doesn't appear in the backup (typo or otherwise), say so explicitly and ask — never guess or save it anyway under an invalid id. If there's no specific id in play, use `general/<short-topic>`. When tagging a point-scoped annotation, also record the target's permanent internal id alongside the visible one (`_frUuid` for a `fr_bolsas` entry, `_uuid` for a `su_lotes` entry) — the visible `id` can be renamed later and would otherwise silently orphan the annotation.
3. Append the entry to `docs/lab-intelligence/anotaciones.md` (create the file with a one-line header if it doesn't exist) under today's date header, with the entry's own bullet prefixed by the current time (`HH:MM`) — see the format below.
4. **Cruce con hipótesis abiertas (solo lectura):** if the id/topic named matches an `abierta`/`en_investigación` hypothesis in the corresponding `docs/lab-intelligence/hipotesis/` file, mention it in the same confirmation message (e.g. "esto podría ser evidencia para HIP-FR-0002 — ¿la registro ahí?"). Never write to `hipotesis/` from this mode — only Modo hipótesis y preguntas does, and only on the user's explicit confirmation.
5. Done — do not touch `checkpoint.json` and do not run a full analysis pass; this is independent of the incremental/full-history cycle in Modo análisis.

## Modo hipótesis y preguntas

1. Confirm in one line what you're about to register or update: new hypothesis, new conceptual experiment, evidence for an existing hypothesis, or a hypothesis being marked answered.
2. Determine which file in `docs/lab-intelligence/hipotesis/` applies: `ge-ci-cilab.md` (GE/CI/CILAB), `gr.md`, `su.md`, `fr.md`, `cross-modulo.md` (spans more than one module), or `experimentos-en-cola.md` (conceptual experiment design). Read `docs/lab-intelligence/hipotesis/index.md` if unsure — create the whole `hipotesis/` directory (all 6 files, see "Hipótesis — formato" below) if it doesn't exist yet.
3. **New hypothesis or research question:** append it to the relevant file using the format in "Hipótesis — formato" below, with clear bullet points under `Preguntas`. Assign the next sequential `HIP-<MOD>-00NN` id for that file (`MOD` = `CILAB`/`GR`/`SU`/`FR`/`X`). `Registrada` gets today's date and time (`YYYY-MM-DD HH:MM`). `estado: abierta`.
4. **New conceptual experiment design:** register it in `experimentos-en-cola.md` with the next sequential `EXP-C-00NN` id — same convention as before the split.
5. **Evidence for an existing hypothesis** (the user confirms a finding from Modo análisis/anotación bears on a specific `HIP-` id, or brings it up spontaneously): append a dated+timed line (`YYYY-MM-DD HH:MM — ...`) to that hypothesis's `Evidencia`. If the user confirms a real experiment (`EXP-C-XXXX`/`EXP-XXXX`/`CRE-XXXX`) is now running specifically to answer it, also flip `estado: abierta` → `estado: en_investigación`.
6. **Marking a hypothesis answered:** only on the user's explicit confirmation (same discipline as "Confirmar resolución de un item del backlog") — set `estado: respondida`, fill `**Respondida:**` with today's date+time and a short note of what the user said. Never auto-close or auto-reopen.
7. This is the ONLY mode that writes to `docs/lab-intelligence/hipotesis/`. Modo análisis and Modo anotación only read it and suggest — see their own sections.
8. After any write in this mode, regenerate `docs/lab-intelligence/dashboard.html` from the current state of all files in `hipotesis/` (see "Hipótesis — formato" for what the dashboard shows).
9. Done — do not touch `checkpoint.json` and do not run a full analysis pass.

## Modo avanzado — preparar reimport (solo si el usuario lo pide explícitamente)

1. **Advertir siempre, cada vez:** `CFG → Importar todo` (`cfg_app.js:492`, `importAll()`) hace `localStorage.clear()` y repuebla TODO desde el archivo importado — cualquier cambio hecho en la app viva después del backup usado como base se pierde al importar. Recomendar usarlo solo inmediatamente después de un export fresco, sin tocar la app en el medio. Get explicit confirmation before doing any file work.
2. Only applies to point-scoped annotations tied to a real `fr_bolsas` or `su_lotes` id — those are the only two record types with a native manual-note array. **Never** for `general/*` annotations, and never for annotations tagged to a `CI-`/`GR-`/`ING-` id either (formulas, grain lots, ingredients) — none of those have a native manual-note field in the app's schema to write into yet.
3. Using an ad-hoc, one-off script (python/node via Bash — never hand-edit the raw JSON text, this file is 1MB+ and easy to corrupt manually, and there is no maintained script for this in the repo): parse the base backup, append one new object to the relevant array in the exact native shape the app's own UI already produces —
   - `fr_bolsas[].observaciones`: `{ts, tipo:'manual', estado, dias, texto}` where `ts` is `new Date().toISOString()` at write time, `estado` is one of `none|green|yellow|red` (default `'none'` if the user didn't specify one that matches), and `dias` is days-elapsed between the target bolsa's own `fechaInicio` and today (`null` if that bolsa has no `fechaInicio`) — same derivation `addObsTo()` uses in `fr/fr_app.js`, never a free-choice value.
   - `su_lotes[].dbSeguimiento`: `{ts, texto, estado, auto:false}` — no `tipo`, no `dias` field (different shape from FR's, don't copy FR's fields over). `ts` is a locale string `DD/MM/YY, HH:MM` (e.g. `"24/05/26, 17:07"`), not ISO — matches `suDbTimestamp()` in `su/su_app.js`. `estado` is the same `none|green|yellow|red` set.
   — so that once imported, the note shows up in that bolsa/lote's own native timeline in the app UI, not in an invisible new field.
4. Write the result to a **new** file, clearly distinct from the original (e.g. `<nombre-del-backup-original>-anotado.json`, same directory) — never overwrite the user's original backup.
5. Never run the import yourself. Tell the user the file is ready and that importing it (when/if they choose to) is a manual step they do in their own browser via CFG.

## Confirmar resolución de un item del backlog

1. Find the item in `docs/lab-intelligence/mejoras_app.md` — by its `MEJ-00XX` id if the user gives one, otherwise by matching their description against the open items. Not found, or more than one plausible match → ask which one, don't guess.
2. Update that item: set `estado: resuelta`, and fill `**Resuelto:**` with today's date and a short note of what the user said (e.g. `2026-07-14 — confirmado por el usuario: "ya lo arreglé"`).
3. Confirm back to the user which item you marked resolved, in one line.
4. This never touches `checkpoint.json` or `notebook.md` — it's independent of Modo análisis, same as Modo anotación.

## Notebook entry template

```markdown
## YYYY-MM-DD HH:MM — incremental|full

**Qué cambió desde la última corrida:** ...

**Hallazgos:**
- [confianza alta|media|baja] ...

**Diagnóstico experto:**
- ... (omit this section entirely — don't write "nada nuevo" — when there's nothing to synthesize this run)

**Hipótesis a probar / próximos experimentos:**
- ... (tie to bl2_experimentos-style A/B design when proposing one)

**Sugerencias de protocolo:**
- ...

**Sugerencias para la app:**
- ... (nuevo → MEJ-00XX) / (refuerza MEJ-00XX, ver mejoras_app.md)
```

## Anotaciones — formato (`docs/lab-intelligence/anotaciones.md`)

Append-only timeline, same spirit as the notebook — never edit or delete an old entry; a correction is a new entry that says so. Each bullet carries its own `HH:MM` (local 24h time) so same-day entries can be ordered — added going forward only, existing historical entries without a time are left as-is rather than guessing one.

```markdown
## YYYY-MM-DD
- **14:32 · [FR245b · _frUuid 317881f0-010d-47d0-89bf-5e0e42e9073b]** texto de la anotación puntual...
- **09:05 · [general/estacional]** texto de la anotación general...
```

## Backlog de mejoras — formato (`docs/lab-intelligence/mejoras_app.md`)

Unlike `notebook.md`/`anotaciones.md` (append-only chronological logs), this is a **living list with state** — its purpose is seeing at a glance what's still open and how well-evidenced it is.

```markdown
### MEJ-0001 · categoría: bug|dato-faltante|feature|ux · estado: abierta

**Detectado:** YYYY-MM-DD
**Descripción:** ...
**Evidencia:**
- YYYY-MM-DD: hallazgo/contexto que lo originó
**Resuelto:** (vacío hasta que se confirme)
```

IDs sequential, `MEJ-0001`, `MEJ-0002`... (4-digit padding, same convention as `ING-`/`CRE-`/etc.). States: `abierta` (one piece of evidence) → `reforzada` (2+, transitions automatically the moment a second `Evidencia` line is added, no user action needed) → `resuelta` (only via "Confirmar resolución de un item del backlog," never automatic). `Evidencia` entries represent distinct occurrences of the pattern — a later run, or a second independent finding within the same run — never a process note re-confirming the same original finding (e.g. "re-checked, still true"); don't pad a brand-new item's `Evidencia` with one of those just to promote it. A `resuelta` item that seems to recur is flagged as a possible regression (see Modo análisis step 12) but never silently reopened.

## Hipótesis — formato (`docs/lab-intelligence/hipotesis/`)

Unlike `notebook.md`/`anotaciones.md` (append-only chronological logs), this is a **living list with state** per file — same spirit as `mejoras_app.md`, but for research questions instead of app bugs.

**Files:** `ge-ci-cilab.md` (GE/CI/CILAB bundled — see `index.md` for why), `gr.md`, `su.md`, `fr.md`, `cross-modulo.md` (spans more than one module), `experimentos-en-cola.md` (conceptual experiment queue, `EXP-C-00NN` ids, format unchanged from before this split). `index.md` documents the convention itself and holds no hypotheses.

**Format per hypothesis:**
```markdown
### HIP-FR-0001 · estado: abierta

**Registrada:** 2026-07-14 14:32

**Contexto:** ...

**Preguntas:**
- ...

**Evidencia:**
- 2026-07-16 09:10 — CRE-0044 aporta evidencia parcial: ...

**Respondida:** (vacío hasta que se confirme)
```

**Blank line required before every `**Campo:**` label — not optional formatting.** Without it, a bullet list immediately followed by the next label (e.g. `Evidencia`'s list directly followed by `**Respondida:**`) gets absorbed by CommonMark's lazy-continuation rule into the *same list item* as the preceding bullet — `Respondida` then silently disappears as its own line in any rendered view (GitHub, VS Code preview, the dashboard's source, etc.), even though the raw text still reads fine. Always leave one blank line between every field, including between `Registrada` and `Contexto` (both plain paragraphs — no blank line between them merges into one paragraph, a smaller but same-root-cause defect).

IDs sequential per file, `HIP-<MOD>-0001`, `HIP-<MOD>-0002`... (`MOD` = `CILAB`/`GR`/`SU`/`FR`/`X`, 4-digit padding, same convention as `ING-`/`CRE-`/`MEJ-`/`EXP-C-`). One id per numbered research thread (same granularity the pre-split `hipotesis.md` already had) — not one per individual question inside `Preguntas`. If some questions in the list get answered and others don't, reflect that in the text of `Preguntas`, don't fragment the id. The 5 fields are the common baseline, not a hard ceiling — a hypothesis can carry an additional field when the content genuinely needs it (e.g. `gr.md`'s `HIP-GR-0001` adds a **Protocolo** block between `Contexto` and `Preguntas` for a real numbered lab procedure); don't force unrelated content into `Contexto` just to stay at exactly 5 fields.

**States and transitions** (same rigor as `mejoras_app.md`, adapted — the semantics are "investigation progressed," not "more evidence of the same bug"):
- `abierta` — registered, no experiment running yet to answer it.
- `en_investigación` — the user confirms a real `EXP-C-XXXX`/`EXP-XXXX`/`CRE-XXXX` is running specifically to answer this. Manual transition only, via Modo hipótesis y preguntas.
- `respondida` — only via explicit user confirmation, same pattern as "Confirmar resolución de un item del backlog" — never auto-closed or auto-reopened.

**Timestamps:** `Registrada` and every `Evidencia` line carry `YYYY-MM-DD HH:MM`, local 24h time, no timezone — going forward only. Never fabricate a time for a hypothesis migrated from the old single-file `hipotesis.md` (those carry a date-only `Registrada` with an explicit migration note, since the original file had no per-section timestamp).

**Who writes here:** only Modo hipótesis y preguntas. Modo análisis and Modo anotación read these files to cross-reference findings against open hypotheses, but never write to them directly — they can only propose (in `notebook.md`'s existing "Hipótesis a probar" section, or in the anotación confirmation line) that the user register something here explicitly.

## Dashboard — formato (`docs/lab-intelligence/dashboard.html`)

Self-contained static HTML (inline CSS, no JS framework, native `<details>`/`<summary>` for collapsible evidence/preguntas lists) — never a published Artifact, same privacy posture as the rest of `docs/lab-intelligence/`. Regenerated by directly reading all files in `hipotesis/` and re-writing the whole HTML file — no build script, no dependency, consistent with the rest of this skill's "Claude reads/writes files directly" approach.

**Sections, in order:** GE/CI/CILAB, GR, SU, FR, Cross-módulo, Experimentos en Cola — matching the file order in `hipotesis/`. Each hypothesis renders as a card: id, estado badge (color per state), `Registrada` date, `Contexto` summary, collapsible `Preguntas` list, collapsible `Evidencia` list (or "sin evidencia registrada aún"). A counts summary at the top shows total/abiertas/en_investigación/respondidas. Experiments in the queue render as simpler cards (id + objetivo + diseño), no estado badge (they don't have one).

Regenerate this file as the last step of every Modo hipótesis y preguntas write (see that mode's step 8) — never let it go stale relative to the `.md` files it summarizes.

## Checkpoint schema

```json
{
  "lastRunAt": "ISO timestamp",
  "lastRunMode": "incremental|full",
  "sourceBackupExportedAt": "backup's _exported value",
  "creClosedIds": ["CRE-..."],
  "frClosedIds": ["<fr_bolsas._frUuid value, not the visible id>", "..."],
  "inteligenciaModelComputedAt": "...",
  "formulaIntelComputedAt": "...",
  "experimentoIds": ["EXP-..."],
  "anomalousBolsaIds": ["FR..."]
}
```

## Common mistakes

- Treating OLS coefficients as causal — they're observational; say so.
- Skipping the CLAUDE.md/BIOLAB_SYSTEM.md read and misreading a field whose meaning changed recently.
- Writing filler in empty sections instead of "nada nuevo."
- Never writes to app code, live localStorage, or the user's original backup file — Modo análisis/anotación are read-only on the backup; Modo avanzado only ever writes a new, separate file and never runs the import itself.
- Skipping the existing native manual notes (`fr_bolsas[].observaciones`, `su_lotes[].dbSeguimiento`) and only looking at `anotaciones.md` — both are the same category of user context.
- Using Modo avanzado for a `general/*` annotation — there's no native field for that yet, don't force it onto an unrelated bolsa/lote.
- Guessing an id in Modo anotación instead of asking when the user's named id isn't actually in the backup.
- Diagnóstico experto stating something as proven when the underlying data is `indeterminate`/low-`n` — reason through the uncertainty, don't paper over it.
- Creating a new `MEJ-00XX` item instead of reinforcing an existing one — always read `mejoras_app.md` first.
- Auto-closing or auto-reopening a backlog item without the user's explicit confirmation.
- Running a broad code audit instead of reading just the one function implicated by the surprising finding.
- Writing to `docs/lab-intelligence/hipotesis/` from Modo análisis or Modo anotación instead of only suggesting — same single-writer discipline as the backlog, just for research questions instead of app bugs.
- Fabricating a `Registrada`/`Evidencia` time for an entry that never recorded one (migrated hypotheses, or any historical `notebook.md`/`anotaciones.md` entry from before the timestamp fix) — leave it date-only instead of guessing.
- Forgetting to regenerate `dashboard.html` after writing to `hipotesis/` — it goes stale silently otherwise.
