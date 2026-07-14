---
name: biolab-analyst
description: Use when the user asks to analyze their biolab-app data, review mushroom cultivation lab results, find cross-module patterns across CI/CILAB/GR/SU/FR, get protocol or experiment suggestions, update the lab intelligence notebook, or wants to record/recall a personal annotation about their lab data. Needs a biolab-backup-*.json export in the repo root.
---

# biolab-analyst

## Overview

Reads a `biolab-backup-*.json` export of the biolab-app and writes dated findings to `docs/lab-intelligence/notebook.md`: cross-module correlations (formula → theoretical score → grain protocol → substrate → fruiting outcome), biochemical interpretation of the OLS model and route-attribution signals, and concrete next-experiment/protocol/app suggestions. It also keeps a separate, permanent timeline of the user's own corrections/observations (`docs/lab-intelligence/anotaciones.md`) and factors them into future findings without ever overriding the data. Read `CLAUDE.md` and `BIOLAB_SYSTEM.md` in the repo root first — they document the current schema and invariants, which change often. If either file is missing from the repo root, say so explicitly and proceed with reduced confidence about current schema/invariants rather than guessing — do not silently skip the check. Never invent a causal claim the data doesn't support; state confidence explicitly (alta/media/baja, correlational vs n-limited).

## Which mode?

- User wants lab data analyzed/reviewed/explained, wants to know what's new since the last run, wants next-experiment or protocol suggestions, or explicitly asks for a "full"/"complete" review (`análisis completo`) → **Modo análisis**.
- User states a correction, explanation, or standing observation about their lab data that they want remembered — in normal conversation, no fixed trigger phrase needed (e.g. "las deformaciones de esta bolsa son por frío, no por el aditivo") → **Modo anotación**.
- User explicitly asks to bring an annotation back into the app itself (e.g. "preparame el archivo para reimportar esto") → **Modo avanzado — preparar reimport**. Never enter this mode on your own initiative.
- A single message can trigger more than one mode (e.g. asking for analysis while also stating a correction) — handle each part with its own mode's steps rather than picking only one.
- User asks what's already been annotated about something (e.g. "¿qué anoté sobre esto?") → just read `anotaciones.md` and/or the relevant native notes and answer directly, no special steps beyond what Modo análisis step 7 already does.

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
7. Check for existing user context before writing each finding: `docs/lab-intelligence/anotaciones.md` (if it exists) AND native manual notes already sitting in the backup — `fr_bolsas[].observaciones` entries with `tipo:'manual'`, `su_lotes[].dbSeguimiento` non-automatic entries. Both are the same category of "user already told the system this," just through different channels. If one is relevant to a finding (same id in scope, or a `general/*` annotation whose pattern plausibly applies — e.g. a seasonal/temperature note and the finding involves a bolsa harvested in that season), mention it alongside the finding ("el modelo atribuye X a Y, pero hay una nota tuya de [fecha] que sugiere Z"). Match by the permanent internal id (`_frUuid`/`_uuid`) when present in the annotation tag, not just the visible id, since the visible id may have changed since the annotation was written. Never adjust the finding's stated confidence because of this — it's added context, not an override.
8. Call out explicitly, when relevant to what's in scope: ingredients with `confidence:'indeterminate'` or `bioConflict:true`, entries from `experimentAdvice.topUncertainIngredients` the new data affects, and new anomalies with a hypothesis marked correlational unless there's a real isolating comparison.
9. Append an entry to `docs/lab-intelligence/notebook.md` (create the file with a one-line header if it doesn't exist) using the template below. Empty sections get an explicit "nada nuevo que reportar" line, never filler.
10. Write/update `docs/lab-intelligence/checkpoint.json` with the current state (schema below).

## Modo anotación

1. Confirm in one line what you're about to save (a short paraphrase, not necessarily a literal copy) before writing anything.
2. Determine the scope tag: a real id from the newest backup if the user names one and it actually exists there. If the user names an id that doesn't appear in the backup (typo or otherwise), say so explicitly and ask — never guess or save it anyway under an invalid id. If there's no specific id in play, use `general/<short-topic>`. When tagging a point-scoped annotation, also record the target's permanent internal id alongside the visible one (`_frUuid` for a `fr_bolsas` entry, `_uuid` for a `su_lotes` entry) — the visible `id` can be renamed later and would otherwise silently orphan the annotation.
3. Append the entry to `docs/lab-intelligence/anotaciones.md` (create the file with a one-line header if it doesn't exist) with today's date, using the format below.
4. Done — do not touch `checkpoint.json` and do not run a full analysis pass; this is independent of the incremental/full-history cycle in Modo análisis.

## Modo avanzado — preparar reimport (solo si el usuario lo pide explícitamente)

1. **Advertir siempre, cada vez:** `CFG → Importar todo` (`cfg_app.js:492`, `importAll()`) hace `localStorage.clear()` y repuebla TODO desde el archivo importado — cualquier cambio hecho en la app viva después del backup usado como base se pierde al importar. Recomendar usarlo solo inmediatamente después de un export fresco, sin tocar la app en el medio. Get explicit confirmation before doing any file work.
2. Only applies to point-scoped annotations tied to a real `fr_bolsas` or `su_lotes` id — those are the only two record types with a native manual-note array. **Never** for `general/*` annotations, and never for annotations tagged to a `CI-`/`GR-`/`ING-` id either (formulas, grain lots, ingredients) — none of those have a native manual-note field in the app's schema to write into yet.
3. Using an ad-hoc, one-off script (python/node via Bash — never hand-edit the raw JSON text, this file is 1MB+ and easy to corrupt manually, and there is no maintained script for this in the repo): parse the base backup, append one new object to the relevant array in the exact native shape the app's own UI already produces —
   - `fr_bolsas[].observaciones`: `{ts, tipo:'manual', estado, dias, texto}` where `ts` is `new Date().toISOString()` at write time, `estado` is one of `none|green|yellow|red` (default `'none'` if the user didn't specify one that matches), and `dias` is days-elapsed between the target bolsa's own `fechaInicio` and today (`null` if that bolsa has no `fechaInicio`) — same derivation `addObsTo()` uses in `fr/fr_app.js`, never a free-choice value.
   - `su_lotes[].dbSeguimiento`: `{ts, texto, estado, auto:false}` — no `tipo`, no `dias` field (different shape from FR's, don't copy FR's fields over). `ts` is a locale string `DD/MM/YY, HH:MM` (e.g. `"24/05/26, 17:07"`), not ISO — matches `suDbTimestamp()` in `su/su_app.js`. `estado` is the same `none|green|yellow|red` set.
   — so that once imported, the note shows up in that bolsa/lote's own native timeline in the app UI, not in an invisible new field.
4. Write the result to a **new** file, clearly distinct from the original (e.g. `<nombre-del-backup-original>-anotado.json`, same directory) — never overwrite the user's original backup.
5. Never run the import yourself. Tell the user the file is ready and that importing it (when/if they choose to) is a manual step they do in their own browser via CFG.

## Notebook entry template

```markdown
## YYYY-MM-DD — incremental|full

**Qué cambió desde la última corrida:** ...

**Hallazgos:**
- [confianza alta|media|baja] ...

**Hipótesis a probar / próximos experimentos:**
- ... (tie to bl2_experimentos-style A/B design when proposing one)

**Sugerencias de protocolo:**
- ...

**Sugerencias para la app:**
- ...
```

## Anotaciones — formato (`docs/lab-intelligence/anotaciones.md`)

Append-only timeline, same spirit as the notebook — never edit or delete an old entry; a correction is a new entry that says so.

```markdown
## YYYY-MM-DD
- **[FR245b · _frUuid 317881f0-010d-47d0-89bf-5e0e42e9073b]** texto de la anotación puntual...
- **[general/estacional]** texto de la anotación general...
```

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
