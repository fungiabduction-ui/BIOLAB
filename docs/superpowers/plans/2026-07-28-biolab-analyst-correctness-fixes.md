# biolab-analyst correctness fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 6 precision bugs/gaps in the `biolab-analyst` skill (`.claude/skills/biolab-analyst/SKILL.md`) and its helper script (`docs/lab-intelligence/diff_backups.js`) found in the 2026-07-28 audit, per `docs/superpowers/specs/2026-07-28-biolab-analyst-correctness-fixes-design.md`.

**Architecture:** All changes are targeted text edits to one instruction file (`SKILL.md`) and one Node script (`diff_backups.js`). No app code, no data files, no new files. Both target files are gitignored on purpose (`.claude/` and `docs/lab-intelligence/` are excluded from the public repo per `.gitignore` — this repo's internal-methodology and proprietary-lab-data exclusions) — **do not run `git add`/`git commit` for any step in this plan**, verification is done by reading the file back / running the script, not by a commit diff.

**Tech Stack:** Markdown (skill instructions), Node.js (no dependencies, `diff_backups.js` is a standalone script).

---

## Important ground-truth notes for whoever implements this

- Confirmed against the real source (not assumed) that all 4 note-writer functions produce the exact same base object shape plus module-specific extras:
  - `ci/ci_app.js:3098-3110` (`segAddNotaDrawer`) → base shape + `tandaId`
  - `gr/gr_app.js:3315-3328` → base shape + `frascos`, `dias`
  - `su/su_app.js:3174-3185` (`suDbRegistrarSeguimiento`) → base shape only, no extras
  - `fr/fr_app.js:422-433` → base shape + `dias`
  - The 4 id-generator helpers (`_ciNotaId`/`_grNotaId`/`_suNotaId`/`_frNotaId`) all follow the identical pattern `'nt_<mod>_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6)` — only the 2-letter module prefix differs (`ci`/`gr`/`su`/`fr`).
  - Confirmed `importSystem()` at `cfg/cfg_app.js:169` still does the same destructive `localStorage.clear()` (skipping only the GitHub token key) + repopulate that the old `importAll()` did.

---

### Task 1: Modo avanzado — fix dead function reference

**Files:**
- Modify: `.claude/skills/biolab-analyst/SKILL.md` (Modo avanzado, step 1)

- [ ] **Step 1: Replace the stale function reference**

Find this exact paragraph (currently step 1 under `## Modo avanzado — preparar reimport (solo si el usuario lo pide explícitamente)`):

```
1. **Advertir siempre, cada vez:** `CFG → Importar todo` (`cfg_app.js:492`, `importAll()`) hace `localStorage.clear()` y repuebla TODO desde el archivo importado — cualquier cambio hecho en la app viva después del backup usado como base se pierde al importar. Recomendar usarlo solo inmediatamente después de un export fresco, sin tocar la app en el medio. Get explicit confirmation before doing any file work.
```

Replace it with:

```
1. **Advertir siempre, cada vez:** `CFG → Datos → Importar sistema completo` (`cfg_app.js:169`, `importSystem()`) hace `localStorage.clear()` (salvo el token de GitHub) y repuebla TODO desde el archivo importado — cualquier cambio hecho en la app viva después del backup usado como base se pierde al importar. Recomendar usarlo solo inmediatamente después de un export fresco, sin tocar la app en el medio. Get explicit confirmation before doing any file work.
```

- [ ] **Step 2: Verify the old name is gone**

Run: `grep -n "importAll" ".claude/skills/biolab-analyst/SKILL.md"`
Expected: no output (no matches).

---

### Task 2: Modo avanzado — update note schema to the unified shape

**Files:**
- Modify: `.claude/skills/biolab-analyst/SKILL.md` (Modo avanzado, step 3)

- [ ] **Step 1: Replace the 4 stale per-module shapes**

Find this exact block (currently step 3 under `## Modo avanzado`, the 4 bullets plus their intro line):

```
3. Using an ad-hoc, one-off script (python/node via Bash — never hand-edit the raw JSON text, this file is 1MB+ and easy to corrupt manually, and there is no maintained script for this in the repo): parse the base backup, append one new object to the relevant array in the exact native shape the app's own UI already produces —
   - `fr_bolsas[].observaciones`: `{ts, tipo:'manual', estado, dias, texto}` where `ts` is `new Date().toISOString()` at write time, `estado` is one of `none|green|yellow|red` (default `'none'` if the user didn't specify one that matches), and `dias` is days-elapsed between the target bolsa's own `fechaInicio` and today (`null` if that bolsa has no `fechaInicio`) — same derivation `addObsTo()` uses in `fr/fr_app.js`, never a free-choice value.
   - `su_lotes[].dbSeguimiento`: `{ts, texto, estado, auto:false}` — no `tipo`, no `dias` field (different shape from FR's, don't copy FR's fields over). `ts` is a locale string `DD/MM/YY, HH:MM` (e.g. `"24/05/26, 17:07"`), not ISO — matches `suDbTimestamp()` in `su/su_app.js`. `estado` is the same `none|green|yellow|red` set.
   - `bl2_seg_notas[formulaId]` (array, key = the CI formula id, e.g. `"CI-0013"`): `{ts, texto, estado, auto:false, imagenes:[], tandaId}` — `ts` is a locale string from `segTimestamp()` in `ci/ci_app.js` (`d.toLocaleString('es-AR', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})`, e.g. `"25/07/2026, 11:32"`). `tandaId` is the specific tanda/frasco label (e.g. `"A"`, `"CI-0013-A1"`) if the note is scoped to one, or `null` for a formula-general note — ask the user which if it's ambiguous, never guess a `tandaId` that doesn't exist in that formula's `bl2_seg`.
   - `gr_lotes[].seguimientoNotas` (array, on the lote object itself, not keyed by tanda): `{ts, fechaHora, texto, estado, frascos, dias}` — `ts` is a compact locale string from `grTimestamp()` in `gr/gr_app.js` (`"DD/MM HH:MM"`, no year, e.g. `"25/07 11:32"`), `fechaHora` is the ISO equivalent (`new Date().toISOString()`) — set both, they're redundant on purpose in the real writer. `frascos` (integer, `0` if not specified) and `dias` (integer days since the lote's `fechaInoculacion`, `0` if that field is missing — mirror `grAddSeguimientoNota`'s own fallback, don't compute a different way) are both real fields the UI captures, not decorative — fill them from context when known, `0` when not, never omit them.
   — so that once imported, the note shows up in that bolsa/lote/fórmula/lote-GR's own native timeline in the app UI, not in an invisible new field.
```

Replace it with:

```
3. Using an ad-hoc, one-off script (python/node via Bash — never hand-edit the raw JSON text, this file is 1MB+ and easy to corrupt manually, and there is no maintained script for this in the repo): parse the base backup, append one new object to the relevant array in the exact native shape the app's own UI already produces. All 4 note arrays share the same canonical shape since the 2026-07-26 unification (`id`, `ts`, `tsLegacy`, `tsInferred`, `texto`, `estado`, `auto`, `tipo`, `editedAt`, `imagenes`), confirmed against the real write sites, plus module-specific extra fields:
   - `fr_bolsas[].observaciones`: `{id, ts, tsLegacy:null, tsInferred:false, texto, estado, auto:(tipo==='auto'), tipo:null, dias, editedAt:null, imagenes:[]}` — `id` mirrors `_frNotaId()` in `fr/fr_app.js` (`'nt_fr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,6)`), `ts` is `new Date().toISOString()` at write time, `estado` is one of `none|green|yellow|red` (default `'none'` if the user didn't specify one that matches), and `dias` is days-elapsed between the target bolsa's own `fechaInicio` and today (`null` if that bolsa has no `fechaInicio`) — same derivation `addObsTo()` uses in `fr/fr_app.js`, never a free-choice value.
   - `su_lotes[].dbSeguimiento`: `{id, ts, tsLegacy:null, tsInferred:false, tipo, texto, estado, auto:true, editedAt:null, imagenes:[]}` — no extra fields beyond the canonical shape. `id` mirrors `_suNotaId()` in `su/su_app.js`. `ts` is `new Date().toISOString()` (real ISO — the pre-2026-07-26 locale-string format is gone). `estado` is the same `none|green|yellow|red` set.
   - `bl2_seg_notas[formulaId]` (array, key = the CI formula id, e.g. `"CI-0013"`): `{id, ts, tsLegacy:null, tsInferred:false, texto, estado, auto:false, tipo:null, editedAt:null, imagenes:[], tandaId}` — `id` mirrors `_ciNotaId()` in `ci/ci_app.js`. `tandaId` is the specific tanda/frasco label (e.g. `"A"`, `"CI-0013-A1"`) if the note is scoped to one, or `null` for a formula-general note — ask the user which if it's ambiguous, never guess a `tandaId` that doesn't exist in that formula's `bl2_seg`.
   - `gr_lotes[].seguimientoNotas` (array, on the lote object itself, not keyed by tanda): `{id, ts, tsLegacy:null, tsInferred:false, tipo:null, texto, estado, auto:false, editedAt:null, imagenes:[], frascos, dias}` — `id` mirrors `_grNotaId()` in `gr/gr_app.js`. `frascos` (integer, `0` if not specified) and `dias` (integer days since the lote's `fechaInoculacion`, `0` if that field is missing) are real fields the UI captures, not decorative — fill them from context when known, `0` when not, never omit them.
   — so that once imported, the note shows up in that bolsa/lote/fórmula/lote-GR's own native timeline in the app UI, not in an invisible new field.
```

- [ ] **Step 2: Verify the shape fields are consistent**

Run: `grep -n "tsLegacy\|tsInferred" ".claude/skills/biolab-analyst/SKILL.md"`
Expected: 4 matches (one per bullet), each bullet showing `tsLegacy:null, tsInferred:false` — confirms every module's example now includes the two migration-tracking fields that the old text was missing entirely.

---

### Task 3: Restrict confidence vocabulary to exactly 3 levels

**Files:**
- Modify: `.claude/skills/biolab-analyst/SKILL.md` (Overview paragraph, and Common mistakes list)

- [ ] **Step 1: Tighten the Overview's confidence sentence**

Find this exact sentence (last sentence of the `## Overview` paragraph):

```
Never invent a causal claim the data doesn't support; state confidence explicitly (alta/media/baja, correlational vs n-limited).
```

Replace it with:

```
Never invent a causal claim the data doesn't support; state confidence explicitly as exactly one of `alta`/`media`/`baja` — never a compound qualifier like `media-alta` — and note whether the finding is correlational or n-limited in the finding's own text, not folded into the label.
```

- [ ] **Step 2: Add a Common mistakes bullet reinforcing the rule**

Find this exact line (first bullet under `## Common mistakes`):

```
- Treating OLS coefficients as causal — they're observational; say so.
```

Replace it with (adds a new bullet right after, keeps the original line untouched):

```
- Treating OLS coefficients as causal — they're observational; say so.
- Using a compound confidence qualifier (`media-alta`, `alta-pero-n-bajo`, etc.) instead of exactly one of `alta`/`media`/`baja` — any nuance belongs in the finding's own text, not in the label.
```

- [ ] **Step 3: Verify both edits landed**

Run: `grep -n "compound qualifier\|never a compound" ".claude/skills/biolab-analyst/SKILL.md"`
Expected: 2 matches (Overview sentence + Common mistakes bullet).

---

### Task 4: Symmetric dedup rigor — backlog (Modo análisis)

**Files:**
- Modify: `.claude/skills/biolab-analyst/SKILL.md` (Modo análisis, step 12)

- [ ] **Step 1: Add an explicit list-before-deciding sub-step**

Find this exact line (first bullet under step 12, `**Backlog de mejoras:**`):

```
    - Matches an existing `abierta` or `reforzada` item (by your own reading/judgment of the description, not an algorithmic matcher) → append a dated line to that item's `Evidencia`, and if it was `abierta` it becomes `reforzada`. Don't create a duplicate item.
```

Replace it with (adds a new bullet immediately before it):

```
    - Before deciding, list every `abierta`/`reforzada` item currently in `mejoras_app.md` (id + one-line description) and check the new candidate against each one explicitly — don't jump to a match/no-match verdict from memory of a prior run.
    - Matches an existing `abierta` or `reforzada` item (by your own reading/judgment of the description, not an algorithmic matcher) → append a dated line to that item's `Evidencia`, and if it was `abierta` it becomes `reforzada`. Don't create a duplicate item.
```

- [ ] **Step 2: Verify the new sub-step landed**

Run: `grep -n "Before deciding, list every" ".claude/skills/biolab-analyst/SKILL.md"`
Expected: 1 match.

---

### Task 5: Symmetric dedup rigor — hipótesis (Modo hipótesis y preguntas)

**Files:**
- Modify: `.claude/skills/biolab-analyst/SKILL.md` (Modo hipótesis y preguntas, step 3)

- [ ] **Step 1: Add the same list-before-deciding discipline to hypothesis creation**

Find this exact line (step 3 under `## Modo hipótesis y preguntas`):

```
3. **New hypothesis or research question:** append it to the relevant file using the format in "Hipótesis — formato" below, with clear bullet points under `Preguntas`. Assign the next sequential `HIP-<MOD>-00NN` id for that file (`MOD` = `CILAB`/`GR`/`SU`/`FR`/`X`). `Registrada` gets today's date and time (`YYYY-MM-DD HH:MM`). `estado: abierta`.
```

Replace it with:

```
3. **New hypothesis or research question:** first list every `abierta`/`en_investigación` hypothesis already in the target file (id + one-line `Contexto` summary) and check the new one against each explicitly — same discipline as the backlog's match-before-create step (Modo análisis step 12). No overlapping hypothesis found → append it to the relevant file using the format in "Hipótesis — formato" below, with clear bullet points under `Preguntas`. Assign the next sequential `HIP-<MOD>-00NN` id for that file (`MOD` = `CILAB`/`GR`/`SU`/`FR`/`X`). `Registrada` gets today's date and time (`YYYY-MM-DD HH:MM`). `estado: abierta`. Overlaps an existing hypothesis instead → treat it as new evidence for that one (see step 5), don't create a duplicate id.
```

- [ ] **Step 2: Verify the new sub-step landed**

Run: `grep -n "same discipline as the backlog" ".claude/skills/biolab-analyst/SKILL.md"`
Expected: 1 match.

---

### Task 6: Unknown-format guard in `diff_backups.js`

**Files:**
- Modify: `docs/lab-intelligence/diff_backups.js:100-106` (right after `normalizeTopValue`)
- Modify: `docs/lab-intelligence/diff_backups.js:303-307` (the normalization loop inside `main()`)

- [ ] **Step 1: Create fixture files that reproduce the gap**

Run (creates 3 small fixtures under a fixed `/tmp` path — deliberately NOT the per-session scratchpad dir, since this plan may be executed in a different session than the one that wrote it):

```bash
mkdir -p /tmp/biolab-diffguard-fixtures
cat > /tmp/biolab-diffguard-fixtures/old.json <<'EOF'
{"fr_bolsas": "[]", "su_lotes": "[]"}
EOF
cat > /tmp/biolab-diffguard-fixtures/new-good.json <<'EOF'
{"fr_bolsas": "[{\"id\":\"FR1\",\"_frUuid\":\"abc-123\"}]", "su_lotes": "[]"}
EOF
cat > /tmp/biolab-diffguard-fixtures/new-bad.json <<'EOF'
{"fr_bolsas": "not valid json {{{", "su_lotes": "[]"}
EOF
```

- [ ] **Step 2: Run against the bad fixture BEFORE the fix — confirm the gap is real**

Run: `node "c:/Users/JET/Desktop/MOBY DICK/biolab-app/docs/lab-intelligence/diff_backups.js" /tmp/biolab-diffguard-fixtures/old.json /tmp/biolab-diffguard-fixtures/new-bad.json`

Expected: the script runs to completion, reports `fr_bolsas` as `cambió` in the summary table, but prints **no warning at all** about the malformed value — it silently treats the unparseable string as if it were a legitimate scalar. This confirms the gap before implementing the guard.

- [ ] **Step 3: Add the expected-keys constant and warning helper**

In `docs/lab-intelligence/diff_backups.js`, find this exact block (right after `normalizeTopValue`, before `identityKeyFor`):

```javascript
function normalizeTopValue(v) {
  if (typeof v === 'string') {
    const p = tryParse(v);
    return p.ok ? p.value : v; // string no-JSON real (flag simple tipo "1") — se deja tal cual
  }
  return v; // ya es objeto/array/número — nada que parsear
}

function identityKeyFor(obj) {
```

Replace it with:

```javascript
function normalizeTopValue(v) {
  if (typeof v === 'string') {
    const p = tryParse(v);
    return p.ok ? p.value : v; // string no-JSON real (flag simple tipo "1") — se deja tal cual
  }
  return v; // ya es objeto/array/número — nada que parsear
}

// Keys que en cualquier export válido de BIOLAB terminan siendo objeto/array
// después de normalizeTopValue — nunca un string suelto. Si una de estas keys
// sigue siendo string, no es "un flag tipo '1'" (el fallback silencioso de
// normalizeTopValue): es un formato de export no reconocido corrompiendo el
// parseo de una key grande, exactamente el fallo que ya pasó una vez en vivo
// (2026-07-28, formato GitHub Sync) antes de que existiera este guard.
const EXPECTED_OBJECT_KEYS = new Set([
  'fr_bolsas', 'gr_lotes', 'su_lotes', 'bl2_crec', 'bl2_cultivos', 'bl2_seg',
  'bl2_seg_notas', 'bl2_forms', 'bl2_ings', 'bl2_experimentos',
  'bl2_crec_notas', 'bl2_crec_fases', 'bl2_inteligencia_model',
  'bl2_formula_intel', 'fr_cal_intel',
]);

function warnIfUnparsed(label, key, value) {
  if (typeof value === 'string') {
    console.warn(`⚠ ${key} (${label}) no pudo normalizarse a objeto/array — formato de export no reconocido, revisar a mano`);
  }
}

function identityKeyFor(obj) {
```

- [ ] **Step 4: Call the guard from the normalization loop**

Find this exact block inside `main()`:

```javascript
  const oldD = {}, newD = {};
  for (const k of allKeys) {
    if (Object.prototype.hasOwnProperty.call(oldRaw, k)) oldD[k] = normalizeTopValue(oldRaw[k]);
    if (Object.prototype.hasOwnProperty.call(newRaw, k)) newD[k] = normalizeTopValue(newRaw[k]);
  }
```

Replace it with:

```javascript
  const oldD = {}, newD = {};
  for (const k of allKeys) {
    if (Object.prototype.hasOwnProperty.call(oldRaw, k)) oldD[k] = normalizeTopValue(oldRaw[k]);
    if (Object.prototype.hasOwnProperty.call(newRaw, k)) newD[k] = normalizeTopValue(newRaw[k]);
    if (EXPECTED_OBJECT_KEYS.has(k)) {
      if (Object.prototype.hasOwnProperty.call(oldD, k)) warnIfUnparsed('viejo', k, oldD[k]);
      if (Object.prototype.hasOwnProperty.call(newD, k)) warnIfUnparsed('nuevo', k, newD[k]);
    }
  }
```

- [ ] **Step 5: Re-run against the bad fixture — confirm the warning now appears**

Run: `node "c:/Users/JET/Desktop/MOBY DICK/biolab-app/docs/lab-intelligence/diff_backups.js" /tmp/biolab-diffguard-fixtures/old.json /tmp/biolab-diffguard-fixtures/new-bad.json`

Expected: same output as Step 2, PLUS a new line: `⚠ fr_bolsas (nuevo) no pudo normalizarse a objeto/array — formato de export no reconocido, revisar a mano`.

- [ ] **Step 6: Run against the good fixture — confirm no false positive**

Run: `node "c:/Users/JET/Desktop/MOBY DICK/biolab-app/docs/lab-intelligence/diff_backups.js" /tmp/biolab-diffguard-fixtures/old.json /tmp/biolab-diffguard-fixtures/new-good.json`

Expected: reports `fr_bolsas` as `cambió` with the new `FR1`/`abc-123` row under "NUEVOS", and **no `⚠` warning line anywhere in the output** — the guard only fires on the genuinely-unparseable case.

- [ ] **Step 7: Run against 2 real backups from the repo to confirm no regression**

Run: `node "c:/Users/JET/Desktop/MOBY DICK/biolab-app/docs/lab-intelligence/diff_backups.js"` (no args — autodetects the 2 newest real backups in the repo root / `docs/lab-intelligence/backups/`)

Expected: runs to completion exactly as before this change (same summary table, same detail sections), no `⚠` warning lines — confirms the guard doesn't false-positive against real production data.

- [ ] **Step 8: Clean up the fixtures**

Run: `rm -rf /tmp/biolab-diffguard-fixtures`

---

## Final verification (all tasks)

- [ ] Run: `grep -n "importAll\|media-alta\|no pudo normalizarse" ".claude/skills/biolab-analyst/SKILL.md" "docs/lab-intelligence/diff_backups.js"`
  Expected: `importAll` → 0 matches. `media-alta` → 2 matches (Overview sentence + Common mistakes bullet, both *naming* the forbidden pattern as an example, correct). `no pudo normalizarse` → 1 match, in `diff_backups.js`.
- [ ] Re-read the full `SKILL.md` once and confirm no section still references a 4-shapes-per-module note format or `importAll()`.
- [ ] No `git add`/`git commit` for this plan — both target files are intentionally gitignored (internal skill methodology and proprietary lab data, per `.gitignore` lines 16 and 22).
