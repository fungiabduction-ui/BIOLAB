---
name: biolab-analyst
description: Use when the user asks to analyze their biolab-app data, review mushroom cultivation lab results, find cross-module patterns across CI/CILAB/GR/SU/FR, get protocol or experiment suggestions, or update the lab intelligence notebook. Needs a biolab-backup-*.json export in the repo root.
---

# biolab-analyst

## Overview

Reads a `biolab-backup-*.json` export of the biolab-app and writes dated findings to `docs/lab-intelligence/notebook.md`: cross-module correlations (formula → theoretical score → grain protocol → substrate → fruiting outcome), biochemical interpretation of the OLS model and route-attribution signals, and concrete next-experiment/protocol/app suggestions. Read `CLAUDE.md` and `BIOLAB_SYSTEM.md` in the repo root first — they document the current schema and invariants, which change often. Never invent a causal claim the data doesn't support; state confidence explicitly (alta/media/baja, correlational vs n-limited).

## When to use

- User wants lab data analyzed, reviewed, or explained.
- User wants to know what changed / what's new to learn since the last analysis.
- User wants next-experiment or protocol suggestions.
- User explicitly asks for a "full"/"complete" review (`análisis completo`) — switches to full-history mode.

## Process

1. Find the newest `biolab-backup-*.json` in the repo root by its internal `_exported` field (not file mtime). None found, or `_exported` more than 7 days old → tell the user and ask for a fresh export from CFG before continuing, unless they explicitly say to proceed anyway. File doesn't parse as JSON, or is missing an expected top-level key (`bl2_crec`, `fr_bolsas`, `bl2_inteligencia_model`, `bl2_formula_intel`, `gr_lotes`, `su_lotes`, `bl2_experimentos`, `fr_cal_intel`, `bl2_ings`) → say exactly which key is missing and stop; never analyze with a partial/guessed dataset.
2. Read `docs/lab-intelligence/checkpoint.json`. Missing → first run, treat as **full-history mode** regardless of what was asked.
3. **Incremental mode:** diff the backup against the checkpoint:
   - `bl2_crec` records with `status:'cerrado'` whose `id` isn't in `checkpoint.creClosedIds`
   - `fr_bolsas` with `cicloCerrado:true` whose `id` isn't in `checkpoint.frClosedIds`
   - `bl2_inteligencia_model.computedAt` / `bl2_formula_intel.computedAt` changed vs checkpoint → model was recomputed
   - `bl2_experimentos` entries not in `checkpoint.experimentoIds`
   - `fr_cal_intel.anomalousBolsas` entries not in `checkpoint.anomalousBolsaIds`
   - Nothing new → say so, don't write a notebook entry.
   - Checkpoint references an id no longer in the backup → flag it as a warning in the entry, don't fail silently.
4. **Full-history mode:** same analysis, but over the entire dataset instead of just the diff.
5. For each item in scope, trace the full chain by shared ids: CI formula (`bl2_forms`/`formulaSnapshot`) → CILAB theoretical score → GR protocol (`gr_lotes`, via `grLoteId`/`grTandaId`) → SU substrate (`su_lotes`, via `suLoteId`, additives/hydration) → FR outcome (`fr_bolsas`, BE, `flush.calidad`, anomalies).
6. Cross-reference against `bl2_ings[].bio.mecanismo` / `bio.contribuciones` and `bl2_formula_intel.routeAttribution` — explain findings in terms of the actual metabolic route/cofactor involved, not just "coef went up."
7. Call out explicitly, when relevant to what's in scope: ingredients with `confidence:'indeterminate'` or `bioConflict:true`, entries from `experimentAdvice.topUncertainIngredients` the new data affects, and new anomalies with a hypothesis marked correlational unless there's a real isolating comparison.
8. Append an entry to `docs/lab-intelligence/notebook.md` (create the file with a one-line header if it doesn't exist) using the template below. Empty sections get an explicit "nada nuevo que reportar" line, never filler.
9. Write/update `docs/lab-intelligence/checkpoint.json` with the current state (schema below).

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

## Checkpoint schema

```json
{
  "lastRunAt": "ISO timestamp",
  "lastRunMode": "incremental|full",
  "sourceBackupExportedAt": "backup's _exported value",
  "creClosedIds": ["CRE-..."],
  "frClosedIds": ["FR..."],
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
- Never writes to app code or localStorage-backed files (`bl2_*`, `gr_lotes`, `su_lotes`, `fr_bolsas`) — read-only on the backup.
