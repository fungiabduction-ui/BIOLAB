# Archivado de mejoras_app.md, hipotesis/ y anotaciones.md — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the archive mechanism from `docs/superpowers/specs/2026-07-29-lab-intelligence-archivado-design.md`: backfill `mejoras_app.md`'s 19 resolved items into a new archive file, and wire `SKILL.md` so future closures of `MEJ-`/`HIP-` items and explicit anotaciones archiving keep the active files small while staying fully searchable via targeted grep.

**Architecture:** One backfill script (Task 1) + `SKILL.md` edits for 3 subsystems (Tasks 2-4). Files touched: `docs/lab-intelligence/mejoras_app.md`, `docs/lab-intelligence/mejoras_app_archivo.md` (new), `docs/lab-intelligence/hipotesis_archivo.md` (new), `docs/lab-intelligence/anotaciones_archivo.md` (not created by this plan — only created the first time "Modo archivar anotaciones" actually runs), `.claude/skills/biolab-analyst/SKILL.md`.

**Tech Stack:** Markdown (skill instructions + data files), one Node.js script for the backfill (no dependencies).

---

## Important ground-truth / design notes for whoever implements this

- **All touched files are intentionally gitignored** (`.claude/` and `docs/lab-intelligence/` — see `.gitignore` lines 16 and 22). Do **NOT** run `git add`/`git commit` for any step in this plan.
- **Naming correction vs. the spec doc:** the spec's prose says "`hipotesis/archivo.md`" in a couple of places. That would put the archive file *inside* the `hipotesis/` folder — which breaks the dashboard: dashboard regeneration reads "all files in `hipotesis/`" and would then render a card for the same `HIP-` id twice (once from the stub left in the module file, once from the full entry in the nested archive). This plan uses `docs/lab-intelligence/hipotesis_archivo.md` instead — a **sibling** of the `hipotesis/` folder, not nested inside it, matching the naming pattern of the other two archives (`mejoras_app_archivo.md`, `anotaciones_archivo.md`) and keeping "all files in `hipotesis/`" naturally excluding it. Task 3 below is written against this corrected path; use it, not the spec's literal wording.
- **Write-archive-first ordering, everywhere:** every mechanism in this plan writes the full entry to the archive file, verifies it landed, and only then replaces/trims the active file. Never the reverse — a failure mid-way must never leave the full text existing in neither place. This mirrors the flag-after-persist discipline already documented in `CLAUDE.md` for one-shot migrations.
- **Do not touch** `notebook.md`, `dashboard.html`'s rendering logic beyond the one addition in Task 3, or anything in `checkpoint.json` — none of those are in scope.

---

### Task 1: Backfill `mejoras_app.md` — archive the 19 `resuelta` items

**Files:**
- Modify: `docs/lab-intelligence/mejoras_app.md`
- Create: `docs/lab-intelligence/mejoras_app_archivo.md`
- Create (temporary, deleted at the end): a one-off Node script, e.g. `docs/lab-intelligence/_backfill_mej.js`

- [ ] **Step 1: Write the backfill script**

Create a Node script with this logic (adapt as needed, but the algorithm and output formats below are load-bearing — don't change the stub/archive format):

```javascript
#!/usr/bin/env node
// One-shot backfill: split mejoras_app.md into active (abierta/reforzada entries
// unchanged, resuelta entries replaced by a 2-line stub) and mejoras_app_archivo.md
// (full resuelta entries, moved verbatim).
const fs = require('fs');
const path = require('path');

const SRC = path.join('docs', 'lab-intelligence', 'mejoras_app.md');
const ARCHIVE = path.join('docs', 'lab-intelligence', 'mejoras_app_archivo.md');

const raw = fs.readFileSync(SRC, 'utf8');
const chunks = raw.split(/(?=^### MEJ-)/m);
const fileHeader = chunks[0];
const entries = chunks.slice(1);

const activeOut = [fileHeader];
const archiveOut = ['# Backlog de mejoras — archivo (items resueltos)\n\nEntradas completas movidas desde `mejoras_app.md` cuando pasan a `estado: resuelta`. `mejoras_app.md` mantiene un stub de 2 líneas con id + puntero acá.\n\n'];

let archivedCount = 0;

for (const entry of entries) {
  const headerLine = entry.split('\n', 1)[0];
  const idMatch = headerLine.match(/### (MEJ-\d{4})/);
  const estadoMatch = headerLine.match(/estado:\s*(\w+)/);
  const catMatch = headerLine.match(/categoría:\s*([^·]+?)\s*·/);
  const id = idMatch ? idMatch[1] : null;
  const estado = estadoMatch ? estadoMatch[1] : null;
  const categoria = catMatch ? catMatch[1].trim() : '?';

  if (!id) { activeOut.push(entry); continue; } // safety: unparseable chunk, leave untouched

  if (estado === 'resuelta') {
    archivedCount++;
    archiveOut.push(entry);
    const fechaMatch = entry.match(/\*\*Resuelto:\*\*\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/);
    const fecha = fechaMatch ? fechaMatch[1] : '?';
    const descMatch = entry.match(/\*\*Descripci[oó]n[^*]*:\*\*\s*([\s\S]*?)(?:\n\n|\n\*\*)/);
    let resumen = descMatch ? descMatch[1].replace(/\s+/g, ' ').trim() : '';
    const periodIdx = resumen.indexOf('. ');
    if (periodIdx > 0 && periodIdx < 160) resumen = resumen.slice(0, periodIdx + 1);
    else if (resumen.length > 160) resumen = resumen.slice(0, 160).trim() + '…';
    activeOut.push(`### ${id} · categoría: ${categoria} · estado: resuelta (${fecha})\n\n**Descripción:** ${resumen}\n**Detalle completo:** mejoras_app_archivo.md\n\n`);
  } else {
    activeOut.push(entry);
  }
}

fs.writeFileSync(SRC, activeOut.join(''));
fs.writeFileSync(ARCHIVE, archiveOut.join(''));
console.log(`Archived ${archivedCount} resuelta entries.`);
```

- [ ] **Step 2: Run it and check the count**

Run: `node docs/lab-intelligence/_backfill_mej.js`
Expected output: `Archived 19 resuelta entries.` If the count isn't 19, STOP — don't proceed to step 3, investigate why (re-run is safe since nothing was deleted yet if you restore from the pre-run state — but note the script overwrites `mejoras_app.md` in place, so if the count is wrong, restore the file from your editor's undo/the fact that you haven't committed, fix the regex, and re-run from a clean copy).

- [ ] **Step 3: Verify no content was lost — mandatory, not optional**

1. Run: `grep -c "^### MEJ-" docs/lab-intelligence/mejoras_app_archivo.md` — expected `19`.
2. Run: `grep -c "estado: resuelta" docs/lab-intelligence/mejoras_app.md` — expected `19` (all stubs).
3. Run: `grep -c "\*\*Evidencia:\*\*" docs/lab-intelligence/mejoras_app.md` — expected `6` (only the 4 `abierta` + 2 `reforzada` items still have a real `Evidencia` section; stubs never do).
4. **Read all 19 stubs in `mejoras_app.md`** (they're short) and confirm each `**Descripción:**` line reads as a sensible, grammatical sentence fragment — not truncated mid-word, not missing its subject, not garbled by the regex. **Fix any that read badly by hand**, using the real archived entry (in `mejoras_app_archivo.md`) as the source to pull a better summary from. This step is not optional — the script's regex is a best-effort first pass, not guaranteed correct for every entry's exact phrasing.
5. **Spot-check 3 archived entries** (pick MEJ-0024, MEJ-0016, and the oldest resuelta one by id number) — compare the full text in `mejoras_app_archivo.md` against what you know was originally in `mejoras_app.md` (or re-derive by checking internal consistency: does the entry still read complete, with `Detectado`/`Descripción`/`Evidencia`/`Resuelto` all present and not cut off mid-sentence at the chunk boundary?).
6. Run: `grep -c "^### MEJ-" docs/lab-intelligence/mejoras_app.md` — this counts BOTH full entries and stubs (same header format) — expected `25` (4 abierta + 2 reforzada + 19 stubs = same total item count as before the backfill, confirming nothing was dropped or duplicated).

- [ ] **Step 4: Clean up the script**

Run: `rm docs/lab-intelligence/_backfill_mej.js` — it was a one-shot tool, not part of the skill's ongoing toolkit (unlike `diff_backups.js`, which is reused every run).

---

### Task 2: `SKILL.md` — wire the ongoing archive mechanism for `mejoras_app.md`

**Files:**
- Modify: `.claude/skills/biolab-analyst/SKILL.md`

- [ ] **Step 1: Rewrite "Confirmar resolución de un item del backlog" to archive instead of editing in place**

Find the section starting `## Confirmar resolución de un item del backlog` (its 4 numbered steps). Replace step 2 — find the line starting `2. Update that item: set` — with:

```markdown
2. **Archivar, no editar in-place:** fill `**Resuelto:**` on the full entry with today's date and a short note of what the user said (e.g. `2026-07-14 — confirmado por el usuario: "ya lo arreglé"`), set `estado: resuelta`, then move the ENTIRE entry (`Detectado`/`Descripción`/`Evidencia`/`Resuelto`, unchanged wording) to `docs/lab-intelligence/mejoras_app_archivo.md` (create it with a one-line header if it doesn't exist — append at the end, order doesn't matter there). In `mejoras_app.md`, replace the full entry with a 2-line stub in its place:
   ```markdown
   ### MEJ-00XX · categoría: <misma categoría> · estado: resuelta (YYYY-MM-DD)
   **Descripción:** <primera oración de la Descripción original>
   **Detalle completo:** mejoras_app_archivo.md
   ```
   Write the archive first, verify it landed, THEN replace the entry in `mejoras_app.md` — never the other way around, so a failure mid-way never leaves the full text existing nowhere.
```

Steps 1, 3, 4 of that section are unchanged.

- [ ] **Step 2: Update Modo análisis step 12's "matches a resuelta item" sub-bullet**

Find this exact line (a sub-bullet under step 12, "Backlog de mejoras"):

```
    - Matches an item already `resuelta` → do NOT reopen it yourself. Add the observation to its `Evidencia` and flag it in this entry's `Sugerencias para la app` as a possible regression ("MEJ-00XX estaba marcada resuelta el [fecha], pero esto parece el mismo patrón — ¿regresión o caso distinto?").
```

Replace it with:

```
    - Matches a `resuelta` stub → do NOT reopen it yourself, and do NOT edit the stub or the archived entry. Grep `docs/lab-intelligence/mejoras_app_archivo.md` for that `MEJ-00XX` id to pull the full original context, then flag it in this entry's `Sugerencias para la app` as a possible regression ("MEJ-00XX estaba marcada resuelta el [fecha], pero esto parece el mismo patrón — ¿regresión o caso distinto?"). If the user later confirms it's a real regression, that becomes a NEW `MEJ-00XX` item (via the "No match" branch below) that references the old one — never a reopen of the archived entry.
```

- [ ] **Step 3: Document the stub format in "Backlog de mejoras — formato"**

Find this exact paragraph (right after the format code block in that section, starts with "IDs sequential"):

```
IDs sequential, `MEJ-0001`, `MEJ-0002`... (4-digit padding, same convention as `ING-`/`CRE-`/etc.). States: `abierta` (one piece of evidence) → `reforzada` (2+, transitions automatically the moment a second `Evidencia` line is added, no user action needed) → `resuelta` (only via "Confirmar resolución de un item del backlog," never automatic). `Evidencia` entries represent distinct occurrences of the pattern — a later run, or a second independent finding within the same run — never a process note re-confirming the same original finding (e.g. "re-checked, still true"); don't pad a brand-new item's `Evidencia` with one of those just to promote it. A `resuelta` item that seems to recur is flagged as a possible regression (see Modo análisis step 12) but never silently reopened.
```

Insert this new paragraph immediately BEFORE it (the paragraph above stays, unchanged, right after your insertion):

```markdown
**Items `resuelta` son stubs, no la entrada completa** (desde que existe `mejoras_app_archivo.md`): en vez del formato de arriba, un item resuelto se ve así en `mejoras_app.md`:

```markdown
### MEJ-0001 · categoría: bug · estado: resuelta (2026-07-14)
**Descripción:** ...
**Detalle completo:** mejoras_app_archivo.md
```

La entrada completa (con `Detectado`/`Evidencia`/`Resuelto`) vive en `mejoras_app_archivo.md`, mismo formato de arriba, nunca se relee entera por defecto — solo se abre con grep puntual por `MEJ-00XX` cuando hace falta el contexto completo (ver "Confirmar resolución de un item del backlog" y Modo análisis paso 12).

```

- [ ] **Step 4: Add an ad-hoc query bullet to "Which mode?"**

Find this exact line:

```
- User asks what's already been annotated about something (e.g. "¿qué anoté sobre esto?") → just read `anotaciones.md` and/or the relevant native notes and answer directly, no special steps.
```

Insert this new bullet immediately AFTER it (the found line stays unchanged, right before your insertion):

```
- User asks about a past app bug/mejora (e.g. "¿qué pasó con lo del bioConflict?") → check `mejoras_app.md` first; if it's a `resuelta` stub or not found active, grep `mejoras_app_archivo.md` for the id/topic before answering.
```

- [ ] **Step 5: Verify**

Run: `grep -n "mejoras_app_archivo.md" ".claude/skills/biolab-analyst/SKILL.md"` — expected at least 5 matches (across the 4 edits above). Run: `grep -c "Update that item: set" ".claude/skills/biolab-analyst/SKILL.md"` — expected `0` (old wording fully replaced).

---

### Task 3: `SKILL.md` — wire the ongoing archive mechanism for `hipotesis/`

**Files:**
- Modify: `.claude/skills/biolab-analyst/SKILL.md`
- Create: `docs/lab-intelligence/hipotesis_archivo.md` (empty shell with header — the mechanism creates/appends to it on first use, but per the write-archive-first discipline it's simplest if the file already exists cleanly)

- [ ] **Step 1: Create the empty archive file**

Create `docs/lab-intelligence/hipotesis_archivo.md` with exactly this content:

```markdown
# Hipótesis — archivo (items respondida)

Entradas completas movidas desde `hipotesis/<archivo-de-módulo>.md` cuando pasan a `estado: respondida`. El archivo de módulo original mantiene un stub de 2 líneas con id + puntero acá. Ver `.claude/skills/biolab-analyst/SKILL.md`, sección "Hipótesis — formato".
```

**Important — this file must be a SIBLING of `hipotesis/`, not inside it**: path is `docs/lab-intelligence/hipotesis_archivo.md`, NOT `docs/lab-intelligence/hipotesis/archivo.md`. If it were nested inside `hipotesis/`, dashboard regeneration (which reads "all files in `hipotesis/`") would pick it up as if it were a module file and could double-render `respondida` cards (once from the stub, once from the archive entry). Being a sibling keeps "all files in `hipotesis/`" naturally excluding it.

- [ ] **Step 2: Rewrite "Marking a hypothesis answered" to archive instead of editing in place**

Find this exact line (step 6 of `## Modo hipótesis y preguntas`):

```
6. **Marking a hypothesis answered:** only on the user's explicit confirmation (same discipline as "Confirmar resolución de un item del backlog") — set `estado: respondida`, fill `**Respondida:**` with today's date+time and a short note of what the user said. Never auto-close or auto-reopen.
```

Replace it with:

```
6. **Marking a hypothesis answered:** only on the user's explicit confirmation (same discipline as "Confirmar resolución de un item del backlog") — fill `**Respondida:**` on the full entry with today's date+time and a short note of what the user said, set `estado: respondida`, then move the ENTIRE entry (`Registrada`/`Contexto`/`Preguntas`/`Evidencia`/`Respondida`, unchanged wording) to `docs/lab-intelligence/hipotesis_archivo.md` (append at the end). In the original module file, replace the full entry with a 2-line stub:
   ```markdown
   ### HIP-FR-0002 · estado: respondida (YYYY-MM-DD HH:MM)
   **Contexto:** <resumen corto de una línea>
   **Detalle completo:** hipotesis_archivo.md
   ```
   Write the archive first, verify it landed, THEN replace the entry in the module file — same failure-safe order as the backlog archiving. Never auto-close or auto-reopen.
```

- [ ] **Step 3: Update "Dashboard — formato" to read the archive too**

Find this exact sentence (in the `## Dashboard — formato` section, first paragraph):

```
Self-contained static HTML (inline CSS, no JS framework, native `<details>`/`<summary>` for collapsible evidence/preguntas lists) — never a published Artifact, same privacy posture as the rest of `docs/lab-intelligence/`. Regenerated by directly reading all files in `hipotesis/` and re-writing the whole HTML file — no build script, no dependency, consistent with the rest of this skill's "Claude reads/writes files directly" approach.
```

Replace it with:

```
Self-contained static HTML (inline CSS, no JS framework, native `<details>`/`<summary>` for collapsible evidence/preguntas lists) — never a published Artifact, same privacy posture as the rest of `docs/lab-intelligence/`. Regenerated by directly reading all files in `hipotesis/` PLUS `docs/lab-intelligence/hipotesis_archivo.md` (sibling file, outside the `hipotesis/` folder — `respondida` hypotheses live there since the archiving mechanism, see "Hipótesis — formato" below) and re-writing the whole HTML file — no build script, no dependency, consistent with the rest of this skill's "Claude reads/writes files directly" approach.
```

Then find this exact sentence (2nd paragraph of the same section, ends the sentence about experiment cards):

```
A counts summary at the top shows total/abiertas/en_investigación/respondidas. Experiments in the queue render as simpler cards (id + objetivo + diseño), no estado badge (they don't have one).
```

Replace it with:

```
A counts summary at the top shows total/abiertas/en_investigación/respondidas. Experiments in the queue render as simpler cards (id + objetivo + diseño), no estado badge (they don't have one). **`respondida` cards render from `hipotesis_archivo.md`'s full entry (real Contexto/Preguntas/Evidencia), never from the 2-line stub left in the module file** — the stub only confirms the id exists and where to look, it's not a card source; skip it when building cards, count each `respondida` id once (from the archive) in the totals.
```

Then find this exact sentence (3rd paragraph of the same section):

```
Regenerate this file — full rewrite from all files in `hipotesis/`, not a targeted patch — as the last step of every Modo hipótesis y preguntas write (see that mode's step 8), even when that mode ran combined with others in the same message. Never let it go stale relative to the `.md` files it summarizes.
```

Replace it with:

```
Regenerate this file — full rewrite from all files in `hipotesis/` AND `hipotesis_archivo.md`, not a targeted patch — as the last step of every Modo hipótesis y preguntas write (see that mode's step 8), even when that mode ran combined with others in the same message. Never let it go stale relative to the `.md` files it summarizes.
```

- [ ] **Step 4: Document the stub format in "Hipótesis — formato"**

Find this exact block (the format code block in that section):

```markdown
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
```

Immediately AFTER that code block (and its closing fence), find this exact paragraph:

```
**Blank line required before every `**Campo:**` label — not optional formatting.**
```

Insert this new paragraph BEFORE that "Blank line required" paragraph (i.e., right after the format code block, right before "Blank line required..."):

```markdown
**`respondida` hipótesis son stubs, no la entrada completa** (desde que existe `hipotesis_archivo.md`): en el archivo de módulo original queda:

```markdown
### HIP-FR-0002 · estado: respondida (2026-07-20 16:40)
**Contexto:** <resumen corto de una línea>
**Detalle completo:** hipotesis_archivo.md
```

La entrada completa (`Registrada`/`Contexto`/`Preguntas`/`Evidencia`/`Respondida`) vive en `docs/lab-intelligence/hipotesis_archivo.md`, mismo formato de arriba — nunca se relee entera por defecto, solo con grep puntual por `HIP-<MOD>-00NN` cuando hace falta el contexto completo (ver Modo hipótesis y preguntas paso 6, y el dashboard).

```

- [ ] **Step 5: Extend the "Which mode?" ad-hoc hypothesis-query bullet**

Find this exact line:

```
- User asks about registered hypotheses or open questions (e.g. "¿qué hipótesis tenemos sobre X?") → read the relevant file(s) in `docs/lab-intelligence/hipotesis/` (see `index.md` for which one) and respond.
```

Replace it with:

```
- User asks about registered hypotheses or open questions (e.g. "¿qué hipótesis tenemos sobre X?") → read the relevant file(s) in `docs/lab-intelligence/hipotesis/` (see `index.md` for which one) and respond; if a matching id is only a `respondida` stub there, grep `hipotesis_archivo.md` for the full entry before answering.
```

- [ ] **Step 6: Verify**

Run: `grep -n "hipotesis_archivo.md" ".claude/skills/biolab-analyst/SKILL.md"` — expected at least 6 matches. Run: `test -f docs/lab-intelligence/hipotesis_archivo.md && echo exists` — expected `exists`. Run: `grep -c "^### HIP-" docs/lab-intelligence/hipotesis_archivo.md` — expected `0` (empty shell, no entries yet — nothing was `respondida` before this plan ran).

---

### Task 4: `SKILL.md` — new "Modo archivar anotaciones" + wire the query-time archive check

**Files:**
- Modify: `.claude/skills/biolab-analyst/SKILL.md`

- [ ] **Step 1: Add the new mode to "Which mode?"**

Find this exact line:

```
- User confirms an app-improvement backlog item is fixed (e.g. "ya arreglé lo del bioConflict") → **Confirmar resolución de un item del backlog**.
```

Insert this new bullet immediately AFTER it (found line stays unchanged, right before your insertion):

```
- User explicitly asks to archive old anotaciones (e.g. "archivá las anotaciones viejas de hace rato") → **Modo archivar anotaciones**. Never enter this mode on your own initiative.
```

- [ ] **Step 2: Add the new "Modo archivar anotaciones" section**

Find the end of the `## Confirmar resolución de un item del backlog` section — its last line is:

```
4. This never touches `checkpoint.json` or `notebook.md` — it's independent of Modo análisis, same as Modo anotación.
```

This line is unique in the file at this point (only "Confirmar resolución de un item del backlog" ends this way — the section you're about to create is what will introduce a second occurrence of this exact closing sentence, so do this edit before assuming which one a later search might match).

Insert this entire new section immediately AFTER that line (and its trailing blank line), BEFORE the `## Notebook entry template` header:

```markdown

## Modo archivar anotaciones (solo si el usuario lo pide explícitamente)

1. Confirmar con el usuario la fecha de corte antes de mover nada — proponer una por defecto razonable (ej. "¿archivo todo antes de hace 6 meses?") pero nunca asumir sin confirmación explícita.
2. Mover en bloque cada sección `## YYYY-MM-DD` completa (con todos sus bullets, sin resumir ni reescribir) anterior a la fecha confirmada desde `docs/lab-intelligence/anotaciones.md` a `docs/lab-intelligence/anotaciones_archivo.md` (crearlo con encabezado de una línea si no existe — el contenido movido se agrega al final, no hace falta mantener orden cronológico estricto entre corridas de archivado). Escribir el archivo histórico primero, verificar que aterrizó, recién después recortar `anotaciones.md` — mismo orden a prueba de fallos que el resto de los mecanismos de archivado.
3. Confirmar al usuario cuántas entradas se movieron y el rango de fechas que quedó en cada archivo.
4. Esto nunca toca `checkpoint.json` ni `notebook.md` — independiente de Modo análisis.
```

- [ ] **Step 3: Extend Modo análisis step 8 to check the archive**

Find this exact sentence — it's the LAST sentence of step 8 (a long step; this is the final clause, right before step 9 begins):

```
Never adjust the finding's stated confidence because of this — it's added context, not an override.
```

Replace it with:

```
Never adjust the finding's stated confidence because of this — it's added context, not an override. If a finding's id/topic isn't found in the active `anotaciones.md` and `docs/lab-intelligence/anotaciones_archivo.md` exists, grep it for the same id/topic before concluding there's no prior user context — the active file only holds recent entries once archiving has run.
```

- [ ] **Step 4: Extend the "Which mode?" ad-hoc anotaciones-query bullet**

Find this exact line:

```
- User asks what's already been annotated about something (e.g. "¿qué anoté sobre esto?") → just read `anotaciones.md` and/or the relevant native notes and answer directly, no special steps.
```

Replace it with (this is the SAME line Task 2 Step 4 inserts content after — if Task 2 already ran, this exact line should still be findable, untouched, with Task 2's new bullet now sitting right after it):

```
- User asks what's already been annotated about something (e.g. "¿qué anoté sobre esto?") → read `anotaciones.md` and/or the relevant native notes; if not found there and `anotaciones_archivo.md` exists, grep it too before answering, no special steps beyond that.
```

- [ ] **Step 5: Document the archive in "Anotaciones — formato"**

Find this exact code block (in the `## Anotaciones — formato` section):

```markdown
```markdown
## YYYY-MM-DD
- **14:32 · [FR245b · _frUuid 317881f0-010d-47d0-89bf-5e0e42e9073b]** texto de la anotación puntual...
- **09:05 · [general/estacional]** texto de la anotación general...
```
```

Immediately AFTER that code block, before the next `## ` section header (`## Backlog de mejoras — formato`), insert this new paragraph:

```markdown

**Archivo histórico (`docs/lab-intelligence/anotaciones_archivo.md`):** existe solo si el usuario corrió "Modo archivar anotaciones" alguna vez. Mismo formato exacto (secciones `## YYYY-MM-DD` completas movidas tal cual, nunca resumidas) — nunca se relee entero por defecto, se greppea por id/tema puntual cuando `anotaciones.md` activo no tiene la respuesta.
```

- [ ] **Step 6: Verify**

Run: `grep -n "^## Modo archivar anotaciones" ".claude/skills/biolab-analyst/SKILL.md"` — expected 1 match. Run: `grep -c "anotaciones_archivo.md" ".claude/skills/biolab-analyst/SKILL.md"` — expected at least 4 matches. Run: `test -f docs/lab-intelligence/anotaciones_archivo.md && echo exists || echo does-not-exist-yet` — expected `does-not-exist-yet` (this plan documents the mechanism but doesn't create the file — it's created the first time a user actually runs "Modo archivar anotaciones", per the spec's on-demand design).

---

## Final verification (all tasks)

- [ ] Run: `wc -l docs/lab-intelligence/mejoras_app.md docs/lab-intelligence/mejoras_app_archivo.md docs/lab-intelligence/hipotesis_archivo.md ".claude/skills/biolab-analyst/SKILL.md"` — sanity-check sizes: `mejoras_app.md` should be much smaller than its pre-backfill size (19 full entries replaced by 19 3-line stubs), `mejoras_app_archivo.md` should be substantial (holds what used to be in the active file), `hipotesis_archivo.md` should be tiny (just the header, nothing archived yet), `SKILL.md` should have grown by roughly 60-80 lines across the 3 tasks' insertions.
- [ ] Re-read `SKILL.md` in full once, start to finish, and confirm: every mode that now writes to an archive file (Confirmar resolución, Marking a hypothesis answered, Modo archivar anotaciones) documents the write-archive-first ordering; every ad-hoc query bullet in "Which mode?" that was extended reads grammatically; the "Hipótesis — formato" and "Backlog de mejoras — formato" sections both have their stub-format sub-section in a sensible place relative to the rest of that section's content.
- [ ] Confirm `docs/lab-intelligence/hipotesis_archivo.md` is a sibling of `hipotesis/`, not nested inside it: `test -f docs/lab-intelligence/hipotesis/archivo.md && echo WRONG-PATH-EXISTS || echo correct-no-nested-file`.
- [ ] No `git add`/`git commit` for this plan — all touched/created files are intentionally gitignored.
