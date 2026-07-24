# biolab-analyst Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ship a project skill (`.claude/skills/biolab-analyst/SKILL.md`) that reads a `biolab-backup-*.json` export and writes dated, cross-module scientific findings to a persistent `docs/lab-intelligence/notebook.md`, plus close the data-exposure gap in `.gitignore` that this work would otherwise widen.

**Architecture:** three independent pieces, in dependency order: (1) a `.gitignore` fix so backup exports and the notebook never reach the public code repo, (2) the skill file itself — pure documentation/instructions, no code to compile, (3) a real dry run against the actual backup already sitting in the repo (`biolab-backup-2026-07-14.json`) to prove the instructions are followable and produce correct output, since this repo has no test runner for markdown-instruction skills.

**Tech Stack:** none — this is a Claude Code skill (Markdown + YAML frontmatter) and two data files (`notebook.md`, `checkpoint.json`) it produces at runtime. No app code is touched.

**Reference spec:** `docs/superpowers/specs/2026-07-14-biolab-analyst-skill-design.md`

---

### Task 1: Close the data-exposure gap in `.gitignore`

**Files:**
- Modify: `.gitignore`

**Why first:** `biolab-backup-2026-07-14.json` is currently untracked but NOT ignored — a stray `git add -A` would push proprietary formula/lab data to the public `fungiabduction-ui/BIOLAB` repo. This must land before Task 3 creates `docs/lab-intelligence/` (same exposure risk), so at no point in this plan does an unignored proprietary file exist in the working tree.

- [ ] **Step 1: Check current untracked state**

Run: `git status --short`
Expected output includes:
```
?? biolab-backup-2026-07-14.json
```

- [ ] **Step 2: Edit `.gitignore`**

Current content of `.gitignore`:
```gitignore
# Notas internas/personales — nunca deben subirse a GitHub (repo BIOLAB es publico).
# Se conservan solo en la carpeta local de biolab-app.
CLAUDE.md
BIOLAB_SYSTEM.md
CHANGELOG.md

# Worktrees locales de desarrollo (subagent-driven-development)
.worktrees/
```

Append:
```gitignore

# Backups de datos exportados de la app — nunca al repo publico
biolab-backup-*.json
biolab-ci-backup-*.json

# Bitacora de inteligencia de laboratorio — datos propietarios, nunca al repo publico
docs/lab-intelligence/
```

- [ ] **Step 3: Verify the backup drops out of untracked status**

Run: `git status --short`
Expected: `biolab-backup-2026-07-14.json` no longer appears anywhere in the output.

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "$(cat <<'EOF'
chore: ignorar backups exportados y docs/lab-intelligence

biolab-backup-*.json quedaba sin trackear pero no ignorado — un git add -A
lo hubiera subido al repo publico. Mismo criterio se aplica de una a
docs/lab-intelligence/, que va a contener la bitacora del skill biolab-analyst
con datos propietarios de formulas y resultados de laboratorio.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Author the skill file

**Files:**
- Create: `.claude/skills/biolab-analyst/SKILL.md`

- [ ] **Step 1: Create the directory and write the file**

Full content of `.claude/skills/biolab-analyst/SKILL.md`:

```markdown
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
```

- [ ] **Step 2: Sanity-check the frontmatter parses as valid YAML**

Run:
```bash
python3 -c "
import re
text = open('.claude/skills/biolab-analyst/SKILL.md', encoding='utf-8').read()
fm = text.split('---')[1]
import yaml
d = yaml.safe_load(fm)
assert set(d.keys()) >= {'name','description'}, d.keys()
assert re.match(r'^[a-z0-9-]+$', d['name']), d['name']
assert len(fm) < 1024, len(fm)
print('OK', d['name'], len(d['description']), 'chars description')
"
```
Expected: `OK biolab-analyst <N> chars description` with no traceback. If `yaml` isn't installed, run `pip install pyyaml` first (dev-only, not a project dependency).

- [ ] **Step 3: Check word count against the CSO budget**

Run: `python3 -c "print(len(open('.claude/skills/biolab-analyst/SKILL.md', encoding='utf-8').read().split()))"`
Expected: a number. This skill is a technique skill with real algorithmic content (not a getting-started skill loaded into every conversation), so going somewhat over the 500-word soft budget for "other skills" is acceptable — there is no filler to cut. Note the number in the commit message if it's notably high (>700).

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/biolab-analyst/SKILL.md
git commit -m "$(cat <<'EOF'
feat: skill biolab-analyst para bitacora de inteligencia de laboratorio

Lee el backup JSON exportado de la app, cruza CI/CILAB/GR/SU/FR por ids
compartidos, traduce senales del modelo OLS y route attribution a lectura
bioquimica real, y deja constancia fechada en docs/lab-intelligence/notebook.md.
Ver docs/superpowers/specs/2026-07-14-biolab-analyst-skill-design.md.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Dry-run the skill against the real backup

**Files:**
- Create (gitignored, not committed): `docs/lab-intelligence/notebook.md`, `docs/lab-intelligence/checkpoint.json`

**Why a manual dry run instead of invoking the Skill tool:** the harness's list of invocable skills is fixed for the lifetime of a session and was captured before this skill existed. Invoking it by name via the `Skill` tool in the *same* session that created it will fail. The equivalent, valid test here is to open `.claude/skills/biolab-analyst/SKILL.md` and execute its Process section literally, by hand, against `biolab-backup-2026-07-14.json` — this is exactly the "application scenario" test technique skills need (can the instructions be followed as written, do they have gaps), it just can't go through the `Skill` tool dispatch mechanism this session. A fresh session (or the user typing `/biolab-analyst` later) will dispatch through the normal mechanism and hit the identical file.

- [ ] **Step 1: Confirm there's no checkpoint yet (first run = full-history mode)**

Run: `ls docs/lab-intelligence/ 2>&1 || echo "does not exist yet"`
Expected: `does not exist yet` (or empty dir) — confirms Step 2 of the Process must take the full-history branch.

- [ ] **Step 2: Compute ground truth from the backup to check the output against**

Run:
```bash
python3 -c "
import json
d = json.load(open('biolab-backup-2026-07-14.json', encoding='utf-8'))
cerrados = [r['id'] for r in d['bl2_crec'] if r.get('status') == 'cerrado']
frcerrados = [b['id'] for b in d['fr_bolsas'] if b.get('cicloCerrado') is True]
print('creClosedIds count:', len(cerrados))
print('frClosedIds count:', len(frcerrados), frcerrados)
print('experimentoIds:', [e['id'] for e in d['bl2_experimentos']])
print('inteligenciaModelComputedAt:', d['bl2_inteligencia_model']['computedAt'])
print('formulaIntelComputedAt:', d['bl2_formula_intel']['computedAt'])
print('sourceBackupExportedAt:', d['_exported'])
print('anomalousBolsaIds count:', len(d['fr_cal_intel']['anomalousBolsas']))
"
```
Expected (this is the ground truth the dry-run output must match):
```
creClosedIds count: 40
frClosedIds count: 6 ['FR234b', 'FR234d', ... ]
experimentoIds: ['EXP-0001', 'EXP-0002', 'EXP-0003', 'EXP-0004', 'EXP-0005', 'EXP-0006']
inteligenciaModelComputedAt: 2026-06-07T20:50:35.268Z
formulaIntelComputedAt: 2026-06-01T22:13:31.069Z
sourceBackupExportedAt: 2026-07-14T06:25:29.103Z
anomalousBolsaIds count: 11
```
(The exact `frClosedIds` list values matter less than the count matching 6 — record them for Step 4.)

- [ ] **Step 3: Follow the skill's Process steps 4-9 by hand**

Read `.claude/skills/biolab-analyst/SKILL.md`, then read `CLAUDE.md` and `BIOLAB_SYSTEM.md` as it instructs. Analyze `biolab-backup-2026-07-14.json` in full-history mode: trace CI→CILAB→GR→SU→FR chains, cross-reference `bl2_ings[].bio` and `bl2_formula_intel.routeAttribution`, and produce real findings — e.g. the backup already shows `N3_ZINC` at `olsSignal: -30.6` (`confidence: alta`, `n: 31`) and `N3_SAM` at `-54.4`, and `ING-0019` (L-Metionina) flagged in `topUncertainIngredients` with only `n: 13` — a real dry run should surface findings like these, not generic placeholder text.

- [ ] **Step 4: Write `docs/lab-intelligence/notebook.md` and `docs/lab-intelligence/checkpoint.json`**

Create both files per the templates in the skill. `checkpoint.json`'s `creClosedIds`/`frClosedIds`/`experimentoIds`/`anomalousBolsaIds` arrays must have the exact lengths from Step 2 (40 / 6 / 6 / 11), and `inteligenciaModelComputedAt`/`formulaIntelComputedAt`/`sourceBackupExportedAt` must match those exact timestamps verbatim.

- [ ] **Step 5: Verify output correctness**

Run:
```bash
python3 -c "
import json
cp = json.load(open('docs/lab-intelligence/checkpoint.json', encoding='utf-8'))
assert len(cp['creClosedIds']) == 40, cp['creClosedIds']
assert len(cp['frClosedIds']) == 6, cp['frClosedIds']
assert len(cp['experimentoIds']) == 6, cp['experimentoIds']
assert len(cp['anomalousBolsaIds']) == 11, cp['anomalousBolsaIds']
assert cp['inteligenciaModelComputedAt'] == '2026-06-07T20:50:35.268Z'
assert cp['formulaIntelComputedAt'] == '2026-06-01T22:13:31.069Z'
assert cp['sourceBackupExportedAt'] == '2026-07-14T06:25:29.103Z'
assert cp['lastRunMode'] == 'full'
print('checkpoint OK')
"
grep -c "^## " docs/lab-intelligence/notebook.md
```
Expected: `checkpoint OK` and at least `1` from the grep (one dated entry heading).

- [ ] **Step 6: Verify the gitignore actually protects the new files**

Run: `git status --short`
Expected: neither `docs/lab-intelligence/notebook.md` nor `docs/lab-intelligence/checkpoint.json` appear anywhere in the output (they must be silently ignored, not just untracked).

**No commit for this task** — `docs/lab-intelligence/` is gitignored by design (Task 1). This task's job is to prove the skill works, not to produce a git artifact.

---

### Task 4: Hand off to the user

- [ ] **Step 1: Report the dry-run findings to the user directly in the conversation**

Summarize what Task 3 actually found in the real data (not a generic "it works") — the specific cross-module patterns, uncertain ingredients, and any protocol/app suggestions the dry run produced — so the user gets value from this session immediately, not just after their next Claude Code session starts.

- [ ] **Step 2: Tell the user how to invoke it going forward**

In a fresh Claude Code session in this repo, `/biolab-analyst` (or asking in words that match the triggers in its description) will dispatch through the normal `Skill` tool mechanism and read the same file validated in Task 3.
