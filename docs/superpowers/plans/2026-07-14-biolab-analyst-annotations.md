# biolab-analyst Annotations Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** extend the existing `.claude/skills/biolab-analyst/SKILL.md` with two new modes — recording the user's own corrections/observations as a permanent, append-only timeline (`docs/lab-intelligence/anotaciones.md`) that future analysis runs cross-reference without overriding the data, and an explicit-request-only mode that prepares (never applies) a file to bring a point-scoped annotation back into the live app via the app's own `CFG → Importar todo` restore flow.

**Architecture:** two pieces, in dependency order: (1) rewrite `.claude/skills/biolab-analyst/SKILL.md` to add "Modo anotación" and "Modo avanzado — preparar reimport" alongside the existing "Modo análisis" (renamed from the old unqualified "Process"), plus have Modo análisis read the app's own pre-existing native manual-note fields (`fr_bolsas[].observaciones` tipo:'manual', `su_lotes[].dbSeguimiento`) that it wasn't reading before; (2) a real dry run that (a) records the user's two actual annotations from this session into `anotaciones.md`, (b) proves Modo análisis would surface a real pre-existing native note (the GR25B contamination warning already in the user's real backup) alongside a relevant finding, and (c) proves the reimport-prep mechanism works on a throwaway test copy, without ever touching the user's real backup or fabricating a fake annotation on their behalf.

**Tech Stack:** none — same as the original biolab-analyst plan, this is a Markdown+YAML skill file, no application code touched.

**Reference spec:** `docs/superpowers/specs/2026-07-14-biolab-analyst-skill-design.md`, section "Extensión — Anotaciones del usuario + lectura de notas nativas existentes (2026-07-14, misma sesión)".

**Important constraint for whoever implements Task 2:** the user gave two REAL annotations in conversation, both general/seasonal in scope (they never named a specific bolsa id as an example of their own — a specific id was only ever used by the assistant as an illustrative placeholder during design, not asserted by the user about real data). Task 2 must record only what the user actually said, at `general/*` scope. Do NOT invent a plausible-sounding point-scoped annotation and attribute it to the user — that would fabricate the user's own data, which is exactly what this whole project exists to prevent.

---

### Task 1: Rewrite the skill file with the two new modes

**Files:**
- Modify: `.claude/skills/biolab-analyst/SKILL.md` (full rewrite — the new version restructures section boundaries throughout, a partial diff would be less reliable than replacing the whole file)

- [ ] **Step 1: Replace the entire file content**

Full new content of `.claude/skills/biolab-analyst/SKILL.md`:

```markdown
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
7. Check for existing user context before writing each finding: `docs/lab-intelligence/anotaciones.md` (if it exists) AND native manual notes already sitting in the backup — `fr_bolsas[].observaciones` entries with `tipo:'manual'`, `su_lotes[].dbSeguimiento` non-automatic entries. Both are the same category of "user already told the system this," just through different channels. If one is relevant to a finding (same id in scope, or a `general/*` annotation whose pattern plausibly applies — e.g. a seasonal/temperature note and the finding involves a bolsa harvested in that season), mention it alongside the finding ("el modelo atribuye X a Y, pero hay una nota tuya de [fecha] que sugiere Z"). Never adjust the finding's stated confidence because of this — it's added context, not an override.
8. Call out explicitly, when relevant to what's in scope: ingredients with `confidence:'indeterminate'` or `bioConflict:true`, entries from `experimentAdvice.topUncertainIngredients` the new data affects, and new anomalies with a hypothesis marked correlational unless there's a real isolating comparison.
9. Append an entry to `docs/lab-intelligence/notebook.md` (create the file with a one-line header if it doesn't exist) using the template below. Empty sections get an explicit "nada nuevo que reportar" line, never filler.
10. Write/update `docs/lab-intelligence/checkpoint.json` with the current state (schema below).

## Modo anotación

1. Confirm in one line what you're about to save (a short paraphrase, not necessarily a literal copy) before writing anything.
2. Determine the scope tag: a real id from the newest backup if the user names one and it actually exists there. If the user names an id that doesn't appear in the backup (typo or otherwise), say so explicitly and ask — never guess or save it anyway under an invalid id. If there's no specific id in play, use `general/<short-topic>`.
3. Append the entry to `docs/lab-intelligence/anotaciones.md` (create the file with a one-line header if it doesn't exist) with today's date, using the format below.
4. Done — do not touch `checkpoint.json` and do not run a full analysis pass; this is independent of the incremental/full-history cycle in Modo análisis.

## Modo avanzado — preparar reimport (solo si el usuario lo pide explícitamente)

1. **Advertir siempre, cada vez:** `CFG → Importar todo` (`cfg_app.js:492`, `importAll()`) hace `localStorage.clear()` y repuebla TODO desde el archivo importado — cualquier cambio hecho en la app viva después del backup usado como base se pierde al importar. Recomendar usarlo solo inmediatamente después de un export fresco, sin tocar la app en el medio. Get explicit confirmation before doing any file work.
2. Only applies to point-scoped annotations (tied to a real `fr_bolsas` or `su_lotes` id) — **never** for `general/*` annotations, there's no native field in the app's schema for those yet.
3. Using an ad-hoc, one-off script (python/node via Bash — never hand-edit the raw JSON text, this file is 1MB+ and easy to corrupt manually, and there is no maintained script for this in the repo): parse the base backup, append one new object to the relevant array in the exact native shape the app's own UI already produces —
   - `fr_bolsas[].observaciones`: `{ts, tipo:'manual', estado, dias, texto}` (same shape `FR.addObs()` writes)
   - `su_lotes[].dbSeguimiento`: same shape `SU.dbSeguimientoNotas` writes
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
- **[FR245b]** texto de la anotación puntual...
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
Expected: a number, likely 1000-1200 given the added modes. This is a technique skill with three distinct real workflows and real algorithmic content — going over the 500-word "other skills" soft guideline is expected and acceptable here, same reasoning as the original version of this file.

- [ ] **Step 4: Verify nothing else changed**

Run: `git diff --stat .claude/skills/biolab-analyst/SKILL.md`
Expected: only this one file listed.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/biolab-analyst/SKILL.md
git commit -m "$(cat <<'EOF'
feat: modo anotacion + modo avanzado de reimport para biolab-analyst

Agrega Modo anotacion (timeline propia del usuario en anotaciones.md,
disparado por conversacion normal, nunca pisa la confianza de un hallazgo)
y Modo avanzado - preparar reimport (solo bajo pedido explicito, nunca
automatico, prepara un archivo nuevo para CFG->Importar todo sin tocar
el original ni ejecutar el import). Modo analisis ahora tambien lee las
notas manuales nativas que la app ya tenia (fr_bolsas[].observaciones,
su_lotes[].dbSeguimiento) ademas del archivo de anotaciones.

Ver docs/superpowers/specs/2026-07-14-biolab-analyst-skill-design.md,
seccion "Extension - Anotaciones del usuario".

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Record the user's real annotations + validate Modo análisis reads native notes

**Files:**
- Create (gitignored, not committed): entries appended to `docs/lab-intelligence/anotaciones.md`

**Why this matters:** the user explicitly asked, in this conversation, for these two observations to be permanently remembered. This task both delivers that and validates that the new Modo anotación / Modo análisis instructions are actually followable.

- [ ] **Step 1: Follow Modo anotación (from the just-committed SKILL.md) by hand, twice, for the user's two real statements**

The user's exact two statements from this session, both general in scope (they never named a specific real bolsa id themselves):

1. "en unas bolsas se cosecho y se encontraron anomalias que se atribuyen a un ingrediente en el sustrato de expansion pero las deformaciones son causadas por el frio que no se contempla" — a general methodological caution, not about one specific bolsa.
2. "no tengo forma de medirlo o solucionarlo ahora... tengo un aire acondicionado pero no es lo mismo el aire caliente que tira que calor de una estufa real. en fechas como septiembre dejan de haber anomalias en el crecimiento. asumo que es por temperatura suboptima"

Per Modo anotación step 2: since neither statement names a real id, both get `general/<topic>` tags. **Do not invent or attach a specific bolsa/formula/ingredient id to these — the user never named one for these statements.** Use topics like `general/atribucion-ingrediente-vs-frio` and `general/estacional`.

- [ ] **Step 2: Write `docs/lab-intelligence/anotaciones.md`**

Create the file (it doesn't exist yet) with a one-line header (same style as `notebook.md`'s header) and today's date section, containing both entries per the format in the skill file.

- [ ] **Step 3: Verify the file**

Run:
```bash
grep -c "^## " docs/lab-intelligence/anotaciones.md
grep -c "^\- \*\*\[general/" docs/lab-intelligence/anotaciones.md
```
Expected: `1` (one date header) and `2` (both entries tagged `general/...`, neither tagged with a fabricated specific id).

- [ ] **Step 4: Validate that Modo análisis' native-notes step (step 7) is actually followable against real data**

This is a dry run of step 7 only (not a full analysis pass — no need to touch `checkpoint.json` or write a new notebook entry for this validation). Using `biolab-backup-2026-07-14.json` in the repo root:

```bash
python3 -c "
import json
d = json.load(open('biolab-backup-2026-07-14.json', encoding='utf-8'))
su = [l for l in d['su_lotes'] if l['id']=='SU235']
for l in su:
    for n in l.get('dbSeguimiento', []):
        if n.get('estado') == 'red':
            print(n)
"
```
Expected: prints the real manual red note about the suspicious black grain from GR25B (already in the user's actual data, dated 24/05/26) — confirms this native note is reachable and readable exactly as Modo análisis step 7 describes, without needing any code change to the app itself. Report this finding: **this is proof the "read native notes" instruction works against real data**, not a hypothetical.

- [ ] **Step 5: Report back**

No commit needed (the annotations file is gitignored per the original `.gitignore` fix — `docs/lab-intelligence/` is already covered). Report:
- Confirmation both annotations were written with `general/*` tags (not fabricated ids)
- The exact SU235 red note text found in Step 4, proving native-note reading is real and followable
- Any ambiguity found while actually trying to follow Modo anotación's steps by hand

---

### Task 3: Validate Modo avanzado (reimport-prep) mechanically, without touching real data

**Files:**
- Create (scratch/temporary, not part of the repo): a throwaway test copy under the scratchpad directory, deleted at the end of this task

**Why a throwaway test instead of a real annotation:** the user hasn't given a point-scoped (bolsa/lote-specific) annotation yet — both of their real statements are general-scope (Task 2), and Modo avanzado explicitly doesn't apply to `general/*` annotations. Fabricating a fake point-scoped annotation and writing it into the user's real data tree to "demo" this mode would violate the same "don't invent the user's data" principle this whole feature protects. Instead, validate the mechanism itself on a disposable copy.

- [ ] **Step 1: Copy the real backup to a scratch location**

```bash
cp biolab-backup-2026-07-14.json /tmp/claude-scratch-biolab-reimport-test.json
```
(If `/tmp` isn't writable in your environment, use the project's designated scratchpad directory instead — anywhere outside the git repo and outside `docs/lab-intelligence/`.)

- [ ] **Step 2: Follow Modo avanzado steps 2-4 by hand on the scratch copy, with an explicitly-labeled TEST annotation**

Use a clearly synthetic test observation text (e.g. `"[TEST - validacion de biolab-analyst, no es un dato real] nota de prueba"`) appended to one real `fr_bolsas[]` entry's `observaciones` array (pick any bolsa, e.g. `FR44`, purely as a mechanical target) in the exact native shape:
```python
{"ts": "<ISO timestamp string>", "tipo": "manual", "estado": "none", "dias": 0, "texto": "[TEST - validacion de biolab-analyst, no es un dato real] nota de prueba"}
```
Write the result to `/tmp/claude-scratch-biolab-reimport-test-anotado.json` (a NEW file, distinct name) — never overwrite the scratch copy from Step 1, matching the real instruction's Step 4 (never overwrite the original).

- [ ] **Step 3: Verify the mechanism worked correctly**

Run:
```bash
python3 -c "
import json
orig = json.load(open('/tmp/claude-scratch-biolab-reimport-test.json', encoding='utf-8'))
new  = json.load(open('/tmp/claude-scratch-biolab-reimport-test-anotado.json', encoding='utf-8'))
orig_bolsa = next(b for b in orig['fr_bolsas'] if b['id']=='FR44')
new_bolsa  = next(b for b in new['fr_bolsas'] if b['id']=='FR44')
assert len(new_bolsa['observaciones']) == len(orig_bolsa['observaciones']) + 1, 'expected exactly one new observation'
added = new_bolsa['observaciones'][-1]
assert added['tipo'] == 'manual'
assert 'TEST' in added['texto']
assert set(added.keys()) == {'ts','tipo','estado','dias','texto'}, added.keys()

# confirm nothing else in the whole file changed: strip the one added observation
# back out of the new file and it must equal the original, key for key
import copy
reverted = copy.deepcopy(new)
for b in reverted['fr_bolsas']:
    if b['id'] == 'FR44':
        b['observaciones'] = b['observaciones'][:-1]
assert reverted == orig, 'something other than the one expected observation differs from the original'
print('mechanism OK - exactly one correctly-shaped observation added, nothing else touched')
"
diff biolab-backup-2026-07-14.json /tmp/claude-scratch-biolab-reimport-test.json && echo "original repo backup untouched - confirmed"
```
Expected: `mechanism OK - exactly one correctly-shaped observation added, nothing else touched` and `original repo backup untouched - confirmed` (the `diff` producing no output and exit 0 is what makes that echo run).

- [ ] **Step 4: Clean up the scratch files**

```bash
rm -f /tmp/claude-scratch-biolab-reimport-test.json /tmp/claude-scratch-biolab-reimport-test-anotado.json
```
These were disposable test artifacts, not part of the deliverable — don't leave them lying around implying real content.

- [ ] **Step 5: Report back**

No commit for this task (nothing here belongs in git — it was a disposable mechanical proof). Report:
- Confirmation the append-one-object mechanism works exactly as Modo avanzado step 3 describes
- Confirmation the original file is never touched (only a new file is written)
- Any ambiguity found while actually trying to follow Modo avanzado's steps by hand

---

### Task 4: Hand off to the user

- [ ] **Step 1: Report the two real annotations that are now permanently recorded**

Show the user the exact text now sitting in `docs/lab-intelligence/anotaciones.md` (from Task 2) — this is real, delivered value from this session, not just "the feature works."

- [ ] **Step 2: Explain how to use each mode going forward**

In a fresh Claude Code session (or later in this one): just say a correction/observation in conversation for Modo anotación, ask for analysis as before for Modo análisis, or explicitly ask to "preparar un archivo para reimportar" when they have a real point-scoped annotation they want to try bringing back into the app (with the clobber-risk warning repeated at that time, per the skill's own Step 1 of Modo avanzado).
