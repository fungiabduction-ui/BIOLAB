# biolab-analyst Expert Diagnosis + App-Improvement Backlog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** extend `.claude/skills/biolab-analyst/SKILL.md` with a "Diagnóstico experto" synthesis section (mycologist/biotech-style verdict, epistemically honest about what's data-proven vs. professional judgment) and a living, status-tracked app-improvement backlog (`docs/lab-intelligence/mejoras_app.md`) that accumulates evidence across runs and only ever closes via explicit user confirmation.

**Architecture:** two pieces, in dependency order: (1) rewrite `.claude/skills/biolab-analyst/SKILL.md` — renumbers Modo análisis (10→13 steps, inserting the "revisar código fuente" heuristic, the Diagnóstico experto synthesis, and the backlog-reconciliation step), adds a new "Confirmar resolución de un item del backlog" mini-mode, and adds the backlog's file format section; (2) a real dry run that exercises all three new mechanics against genuinely real data and events from this project's own history — no synthetic/fabricated examples — because there's real material available: the `bioConflict` bug this same skill found and that got fixed for real (commit `135245f`), and the FI Engine cache staleness this skill already noticed and that's still genuinely unresolved in the current backup.

**Tech Stack:** none — same as prior biolab-analyst plans, this is a Markdown+YAML skill file plus one new plain-text data file, no application code touched.

**Reference spec:** `docs/superpowers/specs/2026-07-14-biolab-analyst-skill-design.md`, section "Extensión — Diagnóstico experto + backlog de mejoras a la app (2026-07-14, misma sesión)".

**Ground truth needed for Task 2 (verified fresh, don't trust old claims blindly):**
- The `bioConflict` bug: found in the original full-history notebook entry dated 2026-07-14, root-caused to `cilab/cilab_inteligencia.js` (`_bioIngMap` reading `ing.contribuciones` instead of `ing.bio.contribuciones`), and genuinely fixed in commit `135245f6141f24bb3de1072afd15868ed39642ff` (authored `2026-07-14 14:10:36 -0300`) after the user explicitly asked for it ("lo de cilab si podes solucionalo") earlier in this same session.
- FI Engine staleness: `biolab-backup-2026-07-14.json`'s `bl2_inteligencia_model.computedAt` = `2026-06-07T20:50:35.268Z`, `bl2_formula_intel.computedAt` = `2026-06-01T22:13:31.069Z` — the model cache is 6 days newer than the FI Engine cache that's supposed to consume it. This is a real, currently-unresolved condition in the same static backup file used throughout this whole project (nothing has changed it) — Task 2 must re-verify this itself rather than assume it's still true, but it will be, since the backup file hasn't changed.

---

### Task 1: Rewrite the skill file with Diagnóstico experto + backlog

**Files:**
- Modify: `.claude/skills/biolab-analyst/SKILL.md` (full rewrite — the new version renumbers Modo análisis' steps throughout and adds new sections, a partial diff would be less reliable than replacing the whole file)

- [ ] **Step 1: Replace the entire file content**

Full new content of `.claude/skills/biolab-analyst/SKILL.md`:

```markdown
---
name: biolab-analyst
description: Use when the user asks to analyze their biolab-app data, review mushroom cultivation lab results, find cross-module patterns across CI/CILAB/GR/SU/FR, get protocol/experiment suggestions or an expert diagnostic read, update the lab intelligence notebook or app-improvement backlog, or wants to record/recall a personal annotation about their lab data. Needs a biolab-backup-*.json export in the repo root.
---

# biolab-analyst

## Overview

Reads a `biolab-backup-*.json` export of the biolab-app and writes dated findings to `docs/lab-intelligence/notebook.md`: cross-module correlations (formula → theoretical score → grain protocol → substrate → fruiting outcome), biochemical interpretation of the OLS model and route-attribution signals, and concrete next-experiment/protocol/app suggestions. It also keeps a separate, permanent timeline of the user's own corrections/observations (`docs/lab-intelligence/anotaciones.md`) and factors them into future findings without ever overriding the data, and maintains a living backlog of app-improvement suggestions (`docs/lab-intelligence/mejoras_app.md`) that accumulates evidence across runs instead of restating the same suggestion from scratch. Read `CLAUDE.md` and `BIOLAB_SYSTEM.md` in the repo root first — they document the current schema and invariants, which change often. If either file is missing from the repo root, say so explicitly and proceed with reduced confidence about current schema/invariants rather than guessing — do not silently skip the check. Never invent a causal claim the data doesn't support; state confidence explicitly (alta/media/baja, correlational vs n-limited).

## Which mode?

- User wants lab data analyzed/reviewed/explained, wants to know what's new since the last run, wants next-experiment or protocol suggestions, or explicitly asks for a "full"/"complete" review (`análisis completo`) → **Modo análisis**.
- User states a correction, explanation, or standing observation about their lab data that they want remembered — in normal conversation, no fixed trigger phrase needed (e.g. "las deformaciones de esta bolsa son por frío, no por el aditivo") → **Modo anotación**.
- User explicitly asks to bring an annotation back into the app itself (e.g. "preparame el archivo para reimportar esto") → **Modo avanzado — preparar reimport**. Never enter this mode on your own initiative.
- User confirms an app-improvement backlog item is fixed (e.g. "ya arreglé lo del bioConflict") → **Confirmar resolución de un item del backlog**.
- A single message can trigger more than one mode (e.g. asking for analysis while also stating a correction) — handle each part with its own mode's steps rather than picking only one.
- User asks what's already been annotated about something (e.g. "¿qué anoté sobre esto?") → just read `anotaciones.md` and/or the relevant native notes and answer directly, no special steps beyond what Modo análisis step 8 already does.

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
7. **Revisar código fuente ante un hallazgo inesperado:** when a finding contradicts a documented invariant in `CLAUDE.md`/`BIOLAB_SYSTEM.md`, or a value that should vary but never does across the whole scope of this run, read the actual function involved in the app's source before concluding — don't just report the statistical oddity unexplained (this is exactly how the `bioConflict` bug in `cilab_inteligencia.js` was found). This is targeted at the one function implicated by the surprising finding, not a general code audit. If it reveals a real bug, carry it into step 11 as a `bug`-category backlog candidate.
8. Check for existing user context before writing each finding: `docs/lab-intelligence/anotaciones.md` (if it exists) AND native manual notes already sitting in the backup — `fr_bolsas[].observaciones` entries with `tipo:'manual'`, `su_lotes[].dbSeguimiento` non-automatic entries. Both are the same category of "user already told the system this," just through different channels. If one is relevant to a finding (same id in scope, or a `general/*` annotation whose pattern plausibly applies — e.g. a seasonal/temperature note and the finding involves a bolsa harvested in that season), mention it alongside the finding ("el modelo atribuye X a Y, pero hay una nota tuya de [fecha] que sugiere Z"). Match by the permanent internal id (`_frUuid`/`_uuid`) when present in the annotation tag, not just the visible id, since the visible id may have changed since the annotation was written. Never adjust the finding's stated confidence because of this — it's added context, not an override.
9. Call out explicitly, when relevant to what's in scope: ingredients with `confidence:'indeterminate'` or `bioConflict:true`, entries from `experimentAdvice.topUncertainIngredients` the new data affects, and new anomalies with a hypothesis marked correlational unless there's a real isolating comparison.
10. **Diagnóstico experto:** when there's something real to synthesize about what's in scope (not every run needs one), write a verdict in the tone of a mycologist/biotech professional giving their read of the case — not a restatement of the `Hallazgos`. Combine the findings from steps 5-9 with general mycology/biotech domain knowledge. Non-negotiable rule: never state as fact something the data marks uncertain (`confidence:'indeterminate'`, low `n`, `bioConflict:true`) — reason *through* the uncertainty instead ("con n=8 no se puede confirmar estadísticamente, pero el mecanismo conocido de X es consistente con esta lectura, y es lo que priorizaría investigar primero"). Always distinguish in the text which part is "esto lo prueba el dato" vs. "esta es mi lectura profesional."
11. **Backlog de mejoras:** before finalizing `Sugerencias para la app` for this entry, read `docs/lab-intelligence/mejoras_app.md` (create it with a one-line header if it doesn't exist) for every app-improvement candidate gathered in steps 7/10/general observation:
    - Matches an existing `abierta` or `reforzada` item (by your own reading/judgment of the description, not an algorithmic matcher) → append a dated line to that item's `Evidencia`, and if it was `abierta` it becomes `reforzada`. Don't create a duplicate item.
    - Matches an item already `resuelta` → do NOT reopen it yourself. Add the observation to its `Evidencia` and flag it in this entry's `Sugerencias para la app` as a possible regression ("MEJ-00XX estaba marcada resuelta el [fecha], pero esto parece el mismo patrón — ¿regresión o caso distinto?").
    - No match → create a new item, next sequential `MEJ-00XX` id, `estado: abierta`.
    - If an existing `abierta`/`reforzada` item's pattern was expected to reappear in this run's scope and didn't → mention it in `Sugerencias para la app` as a soft "¿ya se resolvió esto?" signal, but don't change its `estado` — only an explicit user confirmation does that (see "Confirmar resolución de un item del backlog").
    - Reference the resulting id in the notebook entry's `Sugerencias para la app` line: `(nuevo → MEJ-0004)` or `(refuerza MEJ-0001, ver mejoras_app.md)`.
12. Append an entry to `docs/lab-intelligence/notebook.md` (create the file with a one-line header if it doesn't exist) using the template below. Empty sections get an explicit "nada nuevo que reportar" line, never filler.
13. Write/update `docs/lab-intelligence/checkpoint.json` with the current state (schema below).

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

## Confirmar resolución de un item del backlog

1. Find the item in `docs/lab-intelligence/mejoras_app.md` — by its `MEJ-00XX` id if the user gives one, otherwise by matching their description against the open items. Not found, or more than one plausible match → ask which one, don't guess.
2. Update that item: set `estado: resuelta`, and fill `**Resuelto:**` with today's date and a short note of what the user said (e.g. `2026-07-14 — confirmado por el usuario: "ya lo arreglé"`).
3. Confirm back to the user which item you marked resolved, in one line.
4. This never touches `checkpoint.json` or `notebook.md` — it's independent of Modo análisis, same as Modo anotación.

## Notebook entry template

```markdown
## YYYY-MM-DD — incremental|full

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

Append-only timeline, same spirit as the notebook — never edit or delete an old entry; a correction is a new entry that says so.

```markdown
## YYYY-MM-DD
- **[FR245b · _frUuid 317881f0-010d-47d0-89bf-5e0e42e9073b]** texto de la anotación puntual...
- **[general/estacional]** texto de la anotación general...
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

IDs sequential, `MEJ-0001`, `MEJ-0002`... (4-digit padding, same convention as `ING-`/`CRE-`/etc.). States: `abierta` (one piece of evidence) → `reforzada` (2+, transitions automatically the moment a second `Evidencia` line is added, no user action needed) → `resuelta` (only via "Confirmar resolución de un item del backlog," never automatic). A `resuelta` item that seems to recur is flagged as a possible regression (see Modo análisis step 11) but never silently reopened.

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
```

- [ ] **Step 2: Sanity-check the frontmatter parses as valid YAML**

Run:
```bash
python3 -c "
import re, yaml
text = open('.claude/skills/biolab-analyst/SKILL.md', encoding='utf-8').read()
fm = text.split('---')[1]
d = yaml.safe_load(fm)
assert set(d.keys()) >= {'name','description'}, d.keys()
assert re.match(r'^[a-z0-9-]+$', d['name']), d['name']
assert len(fm) < 1024, len(fm)
print('OK', d['name'], len(d['description']), 'chars description')
"
```
Expected: `OK biolab-analyst <N> chars description` with no traceback.

- [ ] **Step 3: Check word count**

Run: `python3 -c "print(len(open('.claude/skills/biolab-analyst/SKILL.md', encoding='utf-8').read().split()))"`
Expected: a number, likely 2200-2600 given the added content. Same reasoning as prior revisions of this file: real algorithmic/procedural content across five distinct workflows now (análisis/anotación/avanzado/confirmar-resolución plus the two new análisis sub-behaviors), going over the 500-word "other skills" soft guideline is expected.

- [ ] **Step 4: Verify nothing else changed**

Run: `git diff --stat .claude/skills/biolab-analyst/SKILL.md`
Expected: only this one file listed.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/biolab-analyst/SKILL.md
git commit -m "$(cat <<'EOF'
feat: diagnostico experto + backlog de mejoras vivo para biolab-analyst

Modo analisis gana 3 pasos nuevos: revisar codigo fuente cuando un hallazgo
contradice un invariante documentado (asi se encontro el bug de bioConflict),
Diagnostico experto (veredicto tipo micologo/biotecnologo, nunca afirma
certeza donde el dato es incierto), y reconciliacion contra un backlog vivo
de mejoras a la app (docs/lab-intelligence/mejoras_app.md) que acumula
evidencia en vez de repetir la misma sugerencia. Nuevo modo liviano
"Confirmar resolucion de un item del backlog" - cierre siempre explicito
del usuario, nunca automatico.

Ver docs/superpowers/specs/2026-07-14-biolab-analyst-skill-design.md,
seccion "Extension - Diagnostico experto + backlog de mejoras".

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Real dry run — backlog lifecycle (create + resolve) and Diagnóstico experto, using genuine project history

**Files:**
- Create (gitignored, not committed): `docs/lab-intelligence/mejoras_app.md`
- Modify (gitignored, not committed): `docs/lab-intelligence/notebook.md` (append one new entry), `docs/lab-intelligence/checkpoint.json` (refresh `lastRunAt`)

**Why this is a real full-history run, not a synthetic test:** unlike Task 3 of the original biolab-analyst plan (which had to use a disposable throwaway test for Modo avanzado, because no real point-scoped annotation existed yet), this task has real, genuine material: the `bioConflict` bug this same skill found earlier today and that the user explicitly asked to have fixed (and it was — commit `135245f`), and the FI Engine cache staleness this skill already noticed and that's still genuinely unresolved. Follow the skill's own instructions by hand, in full-history mode (the user is implicitly asking for this by extending the skill's capabilities and wanting to see them exercised — treat it as an explicit "análisis completo" request), against `biolab-backup-2026-07-14.json` (still the same file, unchanged, already in the repo root).

- [ ] **Step 1: Re-verify the two ground-truth facts fresh (don't trust the plan's header blindly)**

Run:
```bash
git show -s --format="%H %ci" 135245f
python3 -c "
import json
d = json.load(open('biolab-backup-2026-07-14.json', encoding='utf-8'))
print('inteligencia computedAt:', d['bl2_inteligencia_model']['computedAt'])
print('formula_intel computedAt:', d['bl2_formula_intel']['computedAt'])
"
git log --oneline --all | grep -i bioconflict
```
Expected: confirms commit `135245f` exists with the bioConflict fix, and the two `computedAt` values are still `2026-06-07T20:50:35.268Z` (model) and `2026-06-01T22:13:31.069Z` (FI Engine) — 6 days apart, model newer. Also confirm via `git show 135245f` that the fix is exactly what's described (reading `ing.bio.contribuciones` instead of `ing.contribuciones`).

- [ ] **Step 2: Follow Modo análisis full-history mode by hand, focusing on steps 7, 10, and 11 (the new ones)**

Read the current `docs/lab-intelligence/notebook.md`'s existing 2026-07-14 full-history entry for context (it already contains the original `bioConflict` finding and the FI Engine staleness finding — don't recompute cross-module chains that entry already covers, just apply the three NEW steps to what's already known plus anything Step 1 added):

- **Step 7 (revisar código fuente):** the `bioConflict` bug from the original entry is a textbook example of this heuristic already having been applied (that's literally how it was found) — no new instance to demonstrate here since it's already fixed; note in the new entry that this step found nothing new to flag this run.
- **Step 10 (Diagnóstico experto):** write one real, substantive diagnostic-expert paragraph synthesizing the EXP-0001 Metionina finding (Frasco A control 69-70 across 5 strains → Frasco B +300mg/L L-Metionina drops to 38 in all 5, coef -22.65 alta n=18, `routeAttribution.N3_SAM: -54.4`) in the tone of a biotech professional giving their read — explicitly distinguishing what's data-proven (the isolating A/B result, alta confidence) from professional interpretation (e.g. hypothesizing the specific SAM-cycle mechanism at play, if you have a plausible one, clearly marked as your reading, not as something n=18 alone proves).
- **Step 11 (backlog de mejoras):** create `docs/lab-intelligence/mejoras_app.md` for the first time with a one-line header, then:
  - `MEJ-0001` (categoría `bug`): the `bioConflict` bug. Create it `abierta`, `Detectado: 2026-07-14`, `Evidencia` citing the original notebook finding. Then immediately process it through "Confirmar resolución de un item del backlog" (Step 3 below) — this really did get fixed, by the user's real request, in commit `135245f`, all within this same session.
  - `MEJ-0002` (categoría `dato-faltante` or `feature` — pick whichever fits better and say why): the FI Engine staleness (`bl2_formula_intel` not auto-recomputing when `bl2_inteligencia_model` changes). Create it `abierta`, citing the same evidence from the original notebook entry.

- [ ] **Step 3: Apply "Confirmar resolución de un item del backlog" to MEJ-0001**

Following the skill's dedicated mini-process: update `MEJ-0001`'s `estado` to `resuelta`, and its `**Resuelto:**` line citing the real commit SHA `135245f` and the real fact that the user explicitly requested this fix earlier in this session (paraphrase, don't fabricate a quote that wasn't said).

- [ ] **Step 4: Append the new notebook entry**

Using the template (now including `**Diagnóstico experto:**`), append a new dated entry to `docs/lab-intelligence/notebook.md` (below the existing 2026-07-14 full entry — multiple entries on the same calendar date are fine, they're distinguished by being separate corridas). `**Qué cambió desde la última corrida:**` should say plainly that the underlying data hasn't changed since the prior entry — this run exercises the skill's new capabilities (Diagnóstico experto, backlog reconciliation) against the same dataset, not new data. `**Sugerencias para la app:**` references both `MEJ-0001` (resolved, cite it as such) and `MEJ-0002` (`nuevo → MEJ-0002`).

- [ ] **Step 5: Verify the backlog file structure**

Run:
```bash
grep -c "^### MEJ-" docs/lab-intelligence/mejoras_app.md
grep -A1 "^### MEJ-0001" docs/lab-intelligence/mejoras_app.md | grep -o "estado: [a-z]*"
grep -A1 "^### MEJ-0002" docs/lab-intelligence/mejoras_app.md | grep -o "estado: [a-z]*"
grep -c "^\*\*Resuelto:\*\* .*135245f" docs/lab-intelligence/mejoras_app.md
```
Expected: `2` (two items), `estado: resuelta` for MEJ-0001, `estado: abierta` for MEJ-0002, and `1` (MEJ-0001's resolution line cites the real commit SHA).

- [ ] **Step 6: Verify the notebook entry and checkpoint**

Run:
```bash
grep -c "^## " docs/lab-intelligence/notebook.md
grep -c "Diagnóstico experto" docs/lab-intelligence/notebook.md
python3 -c "
import json
cp = json.load(open('docs/lab-intelligence/checkpoint.json', encoding='utf-8'))
print(cp['lastRunAt'], cp['lastRunMode'])
"
```
Expected: `grep -c "^## "` returns `2` (now two dated entries in `notebook.md`), `Diagnóstico experto` appears at least once, and `checkpoint.json`'s `lastRunAt` reflects a fresh timestamp with `lastRunMode: full` — its id-lists (`creClosedIds` etc.) should be unchanged from before since the underlying backup data didn't change, only re-verify this rather than assume it.

- [ ] **Step 7: Verify gitignore still covers everything**

Run: `git status --short`
Expected: none of `docs/lab-intelligence/mejoras_app.md`, `notebook.md`, or `checkpoint.json` appear (all gitignored).

- [ ] **Step 8: Report back**

No commit needed (everything in `docs/lab-intelligence/` is gitignored by design). Report:
- The exact `MEJ-0001`/`MEJ-0002` entries written
- The exact Diagnóstico experto paragraph written, and confirm it distinguishes data-proven vs. professional-judgment content explicitly
- Verification command outputs (Steps 5-7)
- Any ambiguity found while actually following the new Modo análisis steps (7/10/11) and "Confirmar resolución" by hand

## Context

This task is the real acceptance test for Task 1's rewrite — same philosophy as the original biolab-analyst plan's Task 3 and the annotations plan's Task 2/3: prove the instructions are followable by actually following them, using real material wherever it exists rather than inventing examples. The `bioConflict` lifecycle (found → fixed → confirmed resolved) is a rare, valuable case where the ENTIRE lifecycle this feature is designed to track already happened for real within this same session — use it faithfully, don't embellish it.

## Before You Begin

If anything about how to phrase the Diagnóstico experto paragraph, or how to categorize `MEJ-0002`, is unclear, ask now.

## Your Job

1. Follow the steps exactly as specified above.
2. Verify each step's expected output actually matches.
3. Report back — no commit needed for this task.

## Before Reporting Back: Self-Review

- Does `MEJ-0001`'s resolution cite the real commit SHA and the real fact of the user's request, without fabricating a direct quote?
- Does the Diagnóstico experto paragraph clearly separate "el dato prueba esto" from "mi lectura profesional es esto," per the skill's non-negotiable rule?
- Is `MEJ-0002` a genuinely still-open, currently-true condition (re-verified in Step 1, not assumed)?
- Are all three `docs/lab-intelligence/` files correctly invisible to `git status --short`?

## Report Format

Report:
- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- The exact `mejoras_app.md` content (both items)
- The exact Diagnóstico experto paragraph
- Verification outputs (Steps 5-7)
- Any issues, concerns, or ambiguity found while following the new instructions by hand

---

### Task 3: Hand off to the user

- [ ] **Step 1: Report what the dry run actually produced**

Show the user the real `MEJ-0001`/`MEJ-0002` backlog entries and the Diagnóstico experto paragraph from Task 2 — concrete new value from this session, not just "the feature works."

- [ ] **Step 2: Explain how to use the two new capabilities going forward**

In a fresh Claude Code session: ask for analysis as before and Diagnóstico experto will appear automatically when there's something to synthesize; app-improvement suggestions now reference `MEJ-00XX` ids and accumulate instead of repeating; say something like "ya arreglé MEJ-000X" (or describe the fix) whenever a backlog item actually gets resolved.
