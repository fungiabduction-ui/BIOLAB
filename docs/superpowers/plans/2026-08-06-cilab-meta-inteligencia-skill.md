# cilab-meta-inteligencia Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crear la skill `cilab-meta-inteligencia` — un sistema de investigación conversacional para CI/CILAB que trackea predicciones de rizomorfismo, acumula literatura externa, y mantiene un backlog de candidatos a mejora del motor de inteligencia — junto con su auditoría inicial ya corrida contra el backup real.

**Architecture:** Un único `SKILL.md` (mismo patrón que `.claude/skills/biolab-analyst/SKILL.md`, se commitea a git) más 3 archivos vivos en `docs/lab-intelligence/cilab-meta-inteligencia/` (gitignoreados, datos propietarios de lab) que la skill lee/escribe en cada conversación: `proyecciones.md`, `conocimiento_externo.md`, `propuestas_motor.md`. Un script reusable `audit_motor.js` (gitignoreado también, vive junto a los otros 3) mecaniza el cruce `bl2_ings` × `bl2_inteligencia_model` que alimenta la auditoría inicial y las corridas futuras.

**Tech Stack:** Markdown (contenido de la skill y los 3 archivos vivos), Node.js sin dependencias (script de auditoría, mismo patrón que `docs/lab-intelligence/diff_backups.js`).

**Spec:** `docs/superpowers/specs/2026-08-06-cilab-formulador-skill-design.md` (contenido ya actualizado al nombre `cilab-meta-inteligencia`, el archivo conservó su nombre original).

---

### Task 1: Script de auditoría del motor (`audit_motor.js`)

**Files:**
- Create: `docs/lab-intelligence/cilab-meta-inteligencia/audit_motor.js`

- [ ] **Step 1: Verificar que la carpeta de destino existe**

Run: `mkdir -p "docs/lab-intelligence/cilab-meta-inteligencia"` (Bash) o `New-Item -ItemType Directory -Force "docs/lab-intelligence/cilab-meta-inteligencia"` (PowerShell)
Expected: la carpeta existe, sin error si ya existía.

- [ ] **Step 2: Escribir el script**

```javascript
#!/usr/bin/env node
/*
 * audit_motor.js — cruza bl2_ings (mecanismo/contribuciones documentados)
 * contra bl2_inteligencia_model (coefs OLS reales) para la skill
 * cilab-meta-inteligencia.
 *
 * Por qué existe (2026-08-06): identificar automáticamente ingredientes
 * cuyo mecanismo documentado (rutas estructurales, ej. N3_SPITZ/N3_MEMBRANE)
 * contradice o no está confirmado por el coef real del modelo — el mismo
 * cruce manual que encontró el caso del carbonato de calcio y la lecitina
 * de soja en la auditoría inicial. No decide nada por su cuenta: solo
 * mecaniza la parte de "juntar los números", la lectura biológica y la
 * decisión de investigar/proponer sigue siendo de la skill (con literatura
 * real, no solo este cruce estadístico).
 *
 * Uso:
 *   node docs/lab-intelligence/cilab-meta-inteligencia/audit_motor.js
 *   node docs/lab-intelligence/cilab-meta-inteligencia/audit_motor.js ruta/al/backup.json
 *
 * Sin argumento: autodetecta el backup más nuevo en el repo root o en
 * docs/lab-intelligence/backups/ (mismo criterio de timestamp que
 * diff_backups.js). "Estructural" = la ruta N3_SPITZ o N3_MEMBRANE
 * aparece en bio.rutas o con contribución > 0 en bio.contribuciones.
 */

const fs = require('fs');
const path = require('path');

function parseFilenameTs(filename) {
  let m = filename.match(/FECHA_(\d{2})-(\d{2})-(\d{4})_HORA_(\d{2})-(\d{2})-(\d{2})/);
  if (m) {
    const [, dd, mo, yyyy, hh, mi, ss] = m;
    return new Date(`${yyyy}-${mo}-${dd}T${hh}:${mi}:${ss}`).getTime();
  }
  m = filename.match(/(\d{2})_(\d{2})_(\d{4})_(\d{2})(\d{2})(\d{2})/);
  if (m) {
    const [, dd, mo, yyyy, hh, mi, ss] = m;
    return new Date(`${yyyy}-${mo}-${dd}T${hh}:${mi}:${ss}`).getTime();
  }
  return null;
}

function findLatestBackup() {
  const repoRoot = process.cwd();
  const archiveDir = path.join(repoRoot, 'docs', 'lab-intelligence', 'backups');
  const dirs = [repoRoot, archiveDir].filter(fs.existsSync);
  const backups = [];
  for (const dir of dirs) {
    for (const f of fs.readdirSync(dir)) {
      if (!/^biolab[_-].*backup.*\.json$/i.test(f) || /-anotado/i.test(f)) continue;
      const ts = parseFilenameTs(f);
      if (ts !== null) backups.push({ file: path.join(dir, f), ts });
    }
  }
  if (backups.length === 0) {
    console.error('No se encontró ningún backup en ' + repoRoot + ' ni en ' + archiveDir + '. Pasá la ruta a mano.');
    process.exit(1);
  }
  backups.sort((a, b) => b.ts - a.ts);
  return backups[0].file;
}

function readKey(raw, key) {
  const v = raw[key];
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch (e) { return v; }
  }
  return v;
}

const backupPath = process.argv[2] || findLatestBackup();
console.log('Backup usado:', backupPath);

const raw = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
const ings = readKey(raw, 'bl2_ings') || [];
const model = readKey(raw, 'bl2_inteligencia_model');

if (!model || !model.coefs) {
  console.error('bl2_inteligencia_model ausente o sin coefs en este backup — no se puede auditar todavía.');
  process.exit(1);
}

const ESTRUCTURALES = ['N3_SPITZ', 'N3_MEMBRANE'];

function esEstructural(bio) {
  const rutas = bio.rutas || [];
  if (rutas.some(r => ESTRUCTURALES.includes(r))) return true;
  const contrib = bio.contribuciones || {};
  return ESTRUCTURALES.some(r => (contrib[r] || 0) > 0);
}

const conDatos = ings.filter(i => i.bio && i.bio.estado !== 'sin_datos');
const filas = conDatos.map(i => {
  const c = model.coefs[i.id];
  return {
    id: i.id,
    nombre: i.nombre,
    estructural: esEstructural(i.bio),
    pctEstructural: ((i.bio.contribuciones || {})['N3_SPITZ'] || 0) + ((i.bio.contribuciones || {})['N3_MEMBRANE'] || 0),
    coef: c ? c.coef : null,
    n: c ? c.n : null,
    confidence: c ? c.confidence : null,
    ci90: c ? c.ci90 : null,
    bioConflict: c ? c.bioConflict : null,
  };
});

console.log('\nIngredientes con datos biológicos:', filas.length);
const estructurales = filas.filter(f => f.estructural);
console.log('Ingredientes con ruta estructural (N3_SPITZ/N3_MEMBRANE):', estructurales.length, '\n');

console.log('=== Candidatos a revisar (estructural + coef negativo, indeterminate, o CI90 cruza cero pese a confidence alta) ===');
for (const f of estructurales) {
  const negativoConfiable = f.confidence === 'alta' && f.coef < 0;
  const indeterminadoConSenal = f.confidence === 'indeterminate' && f.coef !== null;
  if (negativoConfiable || indeterminadoConSenal) {
    console.log(`${f.id} | ${f.nombre} | %estructural=${f.pctEstructural} | coef=${f.coef} n=${f.n} confidence=${f.confidence} ci90=${JSON.stringify(f.ci90)}`);
  }
}

console.log('\n=== Todos los ingredientes estructurales (referencia completa) ===');
for (const f of estructurales) {
  console.log(`${f.id} | ${f.nombre} | %estructural=${f.pctEstructural} | coef=${f.coef} n=${f.n} confidence=${f.confidence}`);
}
```

- [ ] **Step 3: Correr el script y verificar que reproduce la auditoría inicial**

Run: `node docs/lab-intelligence/cilab-meta-inteligencia/audit_motor.js`
Expected: usa el backup `biolab_full_backup - 06_08_2026_180842.json` de `docs/lab-intelligence/backups/`, reporta 31 ingredientes con datos y 8 estructurales, y lista como candidatos (al menos) `ING-0010` (Carbonato de calcio), `ING-0014` (Tiamina complex) y `ING-0028` (Lecitina de soja) — los mismos 3 que fundamentan `PM-0001`/`PM-0002`/`PM-0003` en el Task 4. Si los números no coinciden, revisar el script antes de seguir — los archivos de los Tasks 3-4 asumen estos resultados exactos.

No hace falta commitear este archivo (vive en `docs/lab-intelligence/`, gitignoreado) — es infraestructura de trabajo de la skill, no código de la app.

---

### Task 2: `SKILL.md`

**Files:**
- Create: `.claude/skills/cilab-meta-inteligencia/SKILL.md`

- [ ] **Step 1: Crear la carpeta**

Run: `mkdir -p ".claude/skills/cilab-meta-inteligencia"`

- [ ] **Step 2: Escribir el archivo completo**

```markdown
---
name: cilab-meta-inteligencia
description: Use when the user brings a new CI/CILAB formula result (placa, frasco, colonización, rizomorfismo, biopsia), wants to project what a formula/ingredient change will do to rizomorfismo before the result is known, asks "why" a lab finding doesn't match what bl2_ings or the OLS model documents, or wants to review candidates for improving the intelligence engine. Companion to biolab-analyst — reads its files (hipotesis/ge-ci-cilab.md, mejoras_app.md, notebook.md) but never writes to them. Triggered by live conversation about CI/CILAB, not by a backup export.
---

# cilab-meta-inteligencia

## Overview

Sistema de investigación conversacional enfocado exclusivamente en CI (Cultivo In Vitro) y CILAB (Analizador/Conocimiento/Inteligencia/FI Engine). Objetivo declarado: **lograr hifas rizomórficas con patrones definidos y precisos** — no velocidad de colonización, no score genérico. Lee `CLAUDE.md`/`BIOLAB_SYSTEM.md` en el repo root primero, igual que `biolab-analyst` — mismo motivo: el schema y los invariantes cambian seguido.

A diferencia de `biolab-analyst` (que arranca de un backup exportado, modo análisis por diff), esta skill arranca de la CONVERSACIÓN EN VIVO — el usuario cuenta un resultado que está viendo en el frasco/placa, sin necesitar un export nuevo cada vez. Solo lee un backup para la auditoría inicial (Modo auditoría inicial) o cuando hace falta un número real del motor (coef, `rizoPozitivas/totalPlacas`, mecanismo documentado).

Mantiene 3 archivos en `docs/lab-intelligence/cilab-meta-inteligencia/` (gitignoreados, igual que el resto de `docs/lab-intelligence/`):
- `proyecciones.md` — predicciones de rizomorfismo registradas ANTES del resultado real, verificadas después.
- `conocimiento_externo.md` — biblioteca de literatura investigada, organizada por ingrediente/mecanismo.
- `propuestas_motor.md` — backlog de candidatos a cambio real en el motor de inteligencia.

## Filosofía — separar velocidad de estructura, siempre

Regla dura, no negociable: **nunca reportar "creció rápido" como evidencia de rizomorfismo.** Todo hallazgo/proyección etiqueta explícitamente en cuál de los dos ejes está:

- **Velocidad/actividad metabólica general** — señal indirecta, interesante pero NO el objetivo. Rutas tipo `N1_GLYC`/`N1_ETC` (glicólisis, cadena de transporte de electrones).
- **Estructura/morfogénesis rizomórfica** — el objetivo real. Rutas `N3_SPITZ` (organización del Spitzenkörper) y `N3_MEMBRANE` (fluidez de membrana para fusión vesicular) son las dos rutas de `ROUTES` (`cilab_app.js`) directamente ligadas a esto — cualquier ingrediente con contribución real ahí es candidato prioritario de investigación, cualquier hallazgo de "creció rápido" sin dato de `rizoPozitivas/totalPlacas` o `calcRizomorfico` no cuenta como evidencia de este eje.

## Postura experta — disciplina obligatoria

1. **Literatura primero, siempre que haga falta.** Antes de aceptar el techo de lo que ya dice `bl2_ings[ingId].bio.mecanismo`, buscar más profundidad. Antes de investigar, revisar `conocimiento_externo.md` — no repetir búsquedas ya hechas.
2. **Clasificar todo mecanismo nuevo** en el eje velocidad-metabólica vs estructura-morfogénica (sección anterior) antes de opinar sobre si "ayuda".
3. **Separar explícitamente "esto lo prueba el dato" de "esta es mi lectura profesional/razonada"** — mismo principio que disciplina a `biolab-analyst`.
4. **Proponer hipótesis propias de forma activa**, no solo reactiva — un patrón raro en una auditoría o en la conversación amerita una pregunta de investigación aunque el usuario no la haya pedido.
5. **Nunca fabricar mecanismo sin fuente.** Sin literatura real ni dato interno que lo sostenga, decirlo explícitamente en vez de inventar plausibilidad.
6. **Confianza:** exactamente `alta`/`media`/`baja`, nunca compuesta (`media-alta` no existe). Nunca tratar un coef OLS como causal — observacional, decirlo.

## Modo auditoría inicial (bootstrap)

Corre la primera vez que se usa la skill, y de nuevo cuando el usuario lo pida explícitamente ("actualizá la auditoría del motor"). Dataset chico (decenas de ingredientes, ~60 `CRE` cerrados) — se relee fresco cada vez, sin checkpoint incremental propio.

1. `node docs/lab-intelligence/cilab-meta-inteligencia/audit_motor.js` — cruza mecánicamente `bl2_ings` × `bl2_inteligencia_model`, lista candidatos (estructural + coef negativo confiable, o estructural + indeterminate con coef no nulo).
2. Para cada candidato nuevo (no ya cubierto en `conocimiento_externo.md`), investigar literatura real (WebSearch/WebFetch) — sección "Postura experta".
3. Escribir una entrada `EXT-00NN` por hallazgo real (con fuentes), y si amerita, una `PM-00NN` en `propuestas_motor.md` (estado `candidata`, nunca `lista para aplicar` en la primera pasada — eso requiere evidencia acumulada, no una sola auditoría).
4. `proyecciones.md` NO se siembra desde la auditoría — solo se llena con predicciones reales sobre fórmulas concretas, conversación por conversación (Modo conversación).

## Modo conversación (uso normal, día a día)

El usuario cuenta un resultado nuevo. La skill:
1. Cruza contra lo ya sabido (`conocimiento_externo.md`, `proyecciones.md`, y por lectura — nunca escritura — `hipotesis/ge-ci-cilab.md`/`mejoras_app.md`/`notebook.md` de `biolab-analyst`).
2. Si hace falta, dispara investigación externa (condiciones abajo).
3. Razona separando velocidad de estructura.
4. Si corresponde, registra o actualiza una entrada en `proyecciones.md` y/o `propuestas_motor.md`.

**Condiciones de disparo de investigación externa** (no busca todo el tiempo):
- Un hallazgo de laboratorio no coincide con lo que el mecanismo/coef ya documentado sugeriría.
- El usuario pregunta un "por qué" que los datos internos no responden solos.
- Se va a registrar una proyección nueva sobre un ingrediente/combinación sin cobertura todavía en `conocimiento_externo.md`.

## Archivo `proyecciones.md` — formato

```markdown
### PROY-00NN · fórmula: <id CI> · estado: pendiente

**Registrada:** YYYY-MM-DD HH:MM

**Contexto:** qué se cambió en la fórmula y por qué (composición real, ids de ingrediente).

**Proyección:** qué esperamos en rizomorfismo (no velocidad) y con qué confianza (alta/media/baja) — mecanismo + literatura + coefs OLS que la sostienen.

**Riesgos identificados:** qué podría hacer fallar la proyección.

**Veredicto:** (vacío hasta que el CRE real cierre)
```

Al cerrar: comparar contra `rizoPozitivas/totalPlacas` real del `CRE` correspondiente, escribir veredicto (`acertó`/`erró`/`parcial` con el razonamiento), `estado` pasa a `verificada`. Mantener un contador (aciertos/parciales/errores) en la cabecera del archivo.

## Archivo `conocimiento_externo.md` — formato

```markdown
### EXT-00NN · tema: <ingrediente o mecanismo>

**Investigado:** YYYY-MM-DD

**Pregunta:** qué se investigó.

**Hallazgos:** síntesis con matices (especie exacta de la fuente vs *cubensis*, fuerza de la evidencia).

**Fuentes:** links reales.

**Aplicable a `bl2_ings`:** sí/no — si sí, qué campo. Siempre `mecanismo`/notas — nunca `contribuciones`/`rutas` sin evidencia fuerte y confirmación explícita del usuario.
```

## Archivo `propuestas_motor.md` — formato

```markdown
### PM-00NN · estado: candidata

**Detectado:** fecha

**Propuesta:** qué cambio concreto se propone y en qué campo exacto.

**Evidencia:** lista de `PROY-00NN` verificadas + `EXT-00NN` que la sostienen. Antes de crear una nueva, chequear explícitamente contra las `candidata`/`lista para aplicar` ya existentes.

**Aplicada:** (vacío hasta que se confirme)
```

Estados: `candidata` (señal insuficiente todavía) → `lista para aplicar` (evidencia consistente — ej. 3+ `PROY` verificadas en la misma dirección, o coef `confidence:'alta'` que contradice el mecanismo documentado) → `aplicada` (usuario confirmó y cargó el cambio, con fecha). **El salto a `aplicada` nunca es automático.**

## Qué puede tocar y qué no

Puede **proponer** texto nuevo para `bio.mecanismo`/notas de un ingrediente en `bl2_ings` (documentación, citando `conocimiento_externo.md`). **Nunca** toca `bio.contribuciones`/`bio.rutas` sin evidencia fuerte y confirmación explícita del usuario — eso alimenta directo el score real de la Analizador (`calcEstadoRutas`, INTOCABLE). No tiene acceso de escritura a la app en vivo — deja el texto listo para pegar a mano, o el JSON para reimportar vía CILAB.

**Fuera de alcance:** cualquier código nuevo en la app (motor de scoring paralelo, cambios a `cilab_inteligencia.js`, etc.). Si `propuestas_motor.md` acumula evidencia suficiente para justificar algo así, es un proyecto aparte con su propio ciclo de brainstorming/spec/plan.

## Relación con `biolab-analyst`

Lee (nunca escribe) `hipotesis/ge-ci-cilab.md`, `mejoras_app.md`, `notebook.md`. Si algo amerita quedar registrado también ahí (hipótesis de investigación más amplia, o un bug de código real), lo sugiere en conversación para que el usuario lo confirme vía `biolab-analyst` — mismo patrón de "un solo dueño por archivo" que ese skill ya usa entre sus propios modos.
```

- [ ] **Step 3: Verificar el frontmatter**

Run: `node -e "const fs=require('fs'); const c=fs.readFileSync('.claude/skills/cilab-meta-inteligencia/SKILL.md','utf8'); if (!c.startsWith('---\nname: cilab-meta-inteligencia\n')) { console.error('frontmatter mal formado'); process.exit(1);} console.log('OK, frontmatter válido');"`
Expected: `OK, frontmatter válido`

---

### Task 3: Sembrar `proyecciones.md`

**Files:**
- Create: `docs/lab-intelligence/cilab-meta-inteligencia/proyecciones.md`

- [ ] **Step 1: Escribir el archivo con la primera proyección real (CI-0014)**

```markdown
# Proyecciones — cilab-meta-inteligencia

Tracking de predicciones de rizomorfismo antes de conocer el resultado real. Ver `SKILL.md` (`.claude/skills/cilab-meta-inteligencia/`) para el formato y el ciclo de vida (`pendiente` → `verificada`).

**Contador:** 0 verificadas (0 acertó / 0 parcial / 0 erró) · 1 pendiente

---

### PROY-0001 · fórmula: CI-0014 (AGO38) · estado: pendiente

**Registrada:** 2026-08-06 21:16

**Contexto:** `CI-0014` elimina el carbonato de calcio (`ING-0010`) que tenía `CI-0013`, agrega fosfato monopotásico (`ING-0007`) nuevo, sube extracto de malta de 10 a 12g/L, y normaliza Bob's Red Mill (`ING-0032`) a 5g/L en la base de los 2 frascos de `EXP-0008` (Frasco A Control sin extras; Frasco B con 100mg/L de NatureBell B Complex `ING-0039`). Contexto completo en `hipotesis/ge-ci-cilab.md` `HIP-CILAB-0004` (de `biolab-analyst`).

**Proyección:** confianza media de que el fosfato mejora el score general — coef +9.23, confianza alta, IC90 no cruza cero, consistente en las cepas `244` (+11.08) y `F2B` (+7.34). Confianza baja/sin poder afirmar todavía que mejore específicamente RIZOMORFISMO, que es distinto de velocidad de crecimiento — el arranque metabólico ya se ve más rápido que el histórico con carbonato (~2 días vs ~3 días históricos), pero eso es actividad, no estructura.

**Riesgos identificados:** la aceleración observada puede ser puramente metabólica (glicólisis/ATP vía el fosfato, ver `N1_GLYC` en su `bio.contribuciones`) sin traducirse en mejor definición de cordones rizomórficos. 3 variables cambiaron a la vez en esta fórmula (fosfato nuevo, malta subida, ausencia de carbonato) — no hay forma de aislar cuál pesa más con este único dato.

**Veredicto:** (vacío hasta que cierre el `CRE` real de `EXP-0008` y haya dato de `rizoPozitivas/totalPlacas`)
```

- [ ] **Step 2: Verificar**

Run: `node -e "const fs=require('fs'); const c=fs.readFileSync('docs/lab-intelligence/cilab-meta-inteligencia/proyecciones.md','utf8'); if(!c.includes('PROY-0001')) throw new Error('falta PROY-0001'); console.log('OK');"`
Expected: `OK`

---

### Task 4: Sembrar `conocimiento_externo.md`

**Files:**
- Create: `docs/lab-intelligence/cilab-meta-inteligencia/conocimiento_externo.md`

- [ ] **Step 1: Escribir el archivo con las 3 entradas ya investigadas hoy**

```markdown
# Conocimiento externo — cilab-meta-inteligencia

Biblioteca de literatura investigada, organizada por ingrediente/mecanismo — revisar acá ANTES de salir a buscar de nuevo. Ver `SKILL.md` para el formato.

---

### EXT-0001 · tema: Carbonato de calcio — pH, ácido oxálico y biomineralización de oxalato de calcio

**Investigado:** 2026-08-06

**Pregunta:** ¿por qué el carbonato de calcio (`ING-0010`) parece retrasar el arranque de colonización frente a fórmulas sin él?

**Hallazgos:**
- El ácido oxálico es el ácido orgánico dominante que secretan muchos hongos (incluidos basidiomicetos) para acidificar su microambiente y habilitar la acción de sus propias enzimas extracelulares — el carbonato, al taponar hacia pH alcalino, obliga al hongo a seguir secretando ácido más tiempo antes de lograr su pH de trabajo.
- La formación de cristales de oxalato de calcio (biomineralización) por exceso de Ca²⁺ libre es un fenómeno real y documentado en basidiomicetos — posible desvío de recursos tempranos hacia precipitar el calcio en vez de crecimiento exploratorio puro.
- Estudio directo con datos: "Effects of Environmental and Nutritional Conditions on Mycelium Growth of Three Basidiomycota" (*Ganoderma lucidum*, *Pleurotus ostreatus*, *Trametes versicolor*) — en las 3 especies, la mejor tasa de crecimiento fue SIN carbonato de calcio; en *T. versicolor* 2% de CaCO₃ frenó activamente la formación de micelio.
- **No es *Psilocybe cubensis* directamente** — es extrapolación razonable de literatura de otras Basidiomycota, no prueba específica de la especie de este lab.
- Dato de cultivo de campo (no paper): en *cubensis*, el carbonato/chalk se usa típicamente en la capa de CASING (post-colonización) para amortiguar la acidificación del propio micelio — mismo mecanismo, contexto distinto (fructificación, no colonización en agar).

**Fuentes:**
- [Effects of Environmental and Nutritional Conditions on Mycelium Growth of Three Basidiomycota — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC11057518/)
- [Calcium Oxalate Biomineralization by Piloderma fallax — AEM](https://journals.asm.org/doi/full/10.1128/aem.00325-09)
- [Experimental calcium-oxalate crystal production and dissolution by selected wood-rot fungi](https://www.sciencedirect.com/science/article/abs/pii/S0964830511001235)
- [Oxalate-Metabolising Genes of the White-Rot Fungus Dichomitus squalens](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0087959)
- [Interactions of Fungi with Concrete (Trichoderma reesei, pH 13, tolera y hasta biomineraliza calcita)](https://arxiv.org/pdf/1708.01337)

**Aplicable a `bl2_ings`:** sí — enriquecer `ING-0010.bio.mecanismo` con el mecanismo de biomineralización de oxalato + la cita del estudio de 3 Basidiomycota, dejando explícita la salvedad de especie. NO tocar `contribuciones`/`rutas` — el mecanismo estructural (`N3_SPITZ`, Ca²⁺ para el Spitzenkörper) sigue siendo real, lo que se agrega es el costado negativo (competencia con acidificación propia + desvío a oxalato), no un reemplazo.

---

### EXT-0002 · tema: Fosfatidilcolina/lecitina — rol en hifas aéreas y Spitzenkörper

**Investigado:** 2026-08-06

**Pregunta:** `ING-0028` (Lecitina de soja) está documentada con el 75% de su contribución en rutas estructurales (`N3_MEMBRANE` 50% + `N3_SPITZ` 25%) pero tiene coef -3.05 en el modelo (IC90 no cruza cero: [-4.44, -0.68], aunque el motor lo marca `indeterminate` — posiblemente por baja varianza de dosis en el dataset, no confirmado). ¿Hay soporte de literatura para su rol estructural, o el coef negativo tiene sentido biológico?

**Hallazgos:**
- Hallazgo directo y fuerte: en *Aspergillus oryzae*, reducir la síntesis de fosfatidilcolina (PC) causa **falla en la formación de hifas aéreas** — PC regula directamente la morfogénesis/elongación hifal. Apoya fuertemente el rol estructural ya documentado en `bl2_ings` para este ingrediente.
- El Spitzenkörper depende de fusión vesicular en la punta de la hifa — la fluidez de membrana que aporta PC es mecánicamente coherente con ese rol.
- **Contradicción sin resolver:** el coef local es negativo pese a este respaldo de literatura. No es un caso de "el mecanismo documentado está mal" — es un caso de "algo más en el dataset o en la dosis está pisando un efecto que la literatura dice que debería ser positivo".

**Fuentes:**
- [Phosphatidylcholine levels regulate hyphal elongation and differentiation in Aspergillus oryzae — Scientific Reports](https://www.nature.com/articles/s41598-024-62580-4)
- [A lipid-managing program maintains a stout Spitzenkörper — PubMed](https://pubmed.ncbi.nlm.nih.gov/25921726/)

**Aplicable a `bl2_ings`:** no todavía — falta entender la discrepancia (dosis vs confusor de dataset) antes de proponer cualquier cambio de texto o de datos.

---

### EXT-0003 · tema: Toxicidad de Mn²⁺/Zn²⁺ quelados en hongos — caso Tiamina complex

**Investigado:** 2026-08-06

**Pregunta:** `ING-0014` (Tiamina complex — blend casero de tiamina + manganeso quelado + zinc glicinato) tiene el coef más negativo y más confiable de toda la auditoría inicial (-14.7, confianza alta, IC90 [-18.46, -8.05], no cruza cero). Su contribución a `N3_SPITZ` es menor (10% de 6 rutas) — la mayoría de su perfil son rutas metabólicas generales, no estructurales. ¿Por qué un ingrediente pensado como cóctel de cofactores da un resultado tan negativo?

**Hallazgos:**
- El manganeso inhibe crecimiento micelial (estudiado en *Phytophthora nicotianae*, oomiceto — organismo relacionado, no idéntico a un basidiomiceto) desde concentraciones bajas (~1 mg/L), y el zinc desde ~10 mg/L — ambos son justamente los principios activos de fungicidas comerciales (Mancozeb, Zineb).
- Hay evidencia de interacción negativa entre exceso de zinc y deficiencia/exceso de tiamina a nivel celular.
- **Lectura tentativa, no confirmada:** el problema puede no ser la tiamina en sí (su contribución documentada es razonable) sino una dosis de Mn²⁺/Zn²⁺ quelados más alta de lo que el hongo tolera — coherente con ser una "solución de síntesis propia" (50ml lote) sin controles de concentración tan rigurosos como un producto comercial dosificado.

**Fuentes:**
- [Effects of manganese and zinc on Phytophthora nicotianae growth](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7036275/)
- [Protection of Cholinergic Neurons against Zinc Toxicity in Thiamine-Deficient Media](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8705960/)

**Aplicable a `bl2_ings`:** posible advertencia de dosis en `ING-0014.bio.mecanismo`/`alertaCritica` una vez que se confirme con el usuario la concentración real de Mn/Zn del lote casero — no se puede escribir un número sin ese dato.
```

- [ ] **Step 2: Verificar**

Run: `node -e "const fs=require('fs'); const c=fs.readFileSync('docs/lab-intelligence/cilab-meta-inteligencia/conocimiento_externo.md','utf8'); ['EXT-0001','EXT-0002','EXT-0003'].forEach(id=>{ if(!c.includes(id)) throw new Error('falta '+id); }); console.log('OK');"`
Expected: `OK`

---

### Task 5: Sembrar `propuestas_motor.md`

**Files:**
- Create: `docs/lab-intelligence/cilab-meta-inteligencia/propuestas_motor.md`

- [ ] **Step 1: Escribir el archivo con los 3 candidatos de la auditoría inicial**

```markdown
# Propuestas al motor — cilab-meta-inteligencia

Backlog de candidatos a cambio real en `bl2_ings.bio.contribuciones`/`rutas` u otro ajuste estructural del motor de inteligencia. Ver `SKILL.md` para el formato y los estados (`candidata` → `lista para aplicar` → `aplicada`). El salto a `aplicada` nunca es automático.

---

### PM-0001 · estado: candidata

**Detectado:** 2026-08-06 (auditoría inicial)

**Propuesta:** enriquecer `ING-0010.bio.mecanismo` (Carbonato de calcio) con el mecanismo de biomineralización de oxalato de calcio y la cita del estudio de 3 Basidiomycota (`EXT-0001`) — documentación, no cambio de `contribuciones`/`rutas`.

**Evidencia:**
- `EXT-0001` — literatura de 3 especies de Basidiomycota mostrando peor/igual crecimiento con CaCO₃ vs sin él.
- Coef local: -4.27, `confidence:'indeterminate'` (ubicuidad 87% de las fórmulas — no hay grupo control suficiente para confirmar estadísticamente).
- 2026-08-06 — dato de campo del usuario: fórmulas históricas con carbonato solo (sin fosfato) tardaban ~3 días en mostrar los primeros síntomas de crecimiento; `CI-0014` (sin carbonato) mostró crecimiento avanzado en 2 días — confundido con 2 variables más (fosfato nuevo, malta subida), no aislable todavía (ver `PROY-0001`).

**Aplicada:** (vacío hasta que se confirme)

---

### PM-0002 · estado: candidata

**Detectado:** 2026-08-06 (auditoría inicial)

**Propuesta:** investigar si `ING-0014` (Tiamina complex) tiene una dosis de Mn²⁺/Zn²⁺ quelados por encima de lo tolerable — no hay cambio de dato propuesto todavía, hace falta la concentración real del lote casero antes de tocar `bio.mecanismo`/`alertaCritica`.

**Evidencia:**
- Coef local: -14.7, `confidence:'alta'`, IC90 [-18.46, -8.05] (no cruza cero) — el coef más negativo y más confiable de toda la auditoría inicial.
- `EXT-0003` — literatura de toxicidad de Mn/Zn en hongos a concentraciones bajas, coincide con los mismos metales presentes en este ingrediente.
- Su contribución a `N3_SPITZ` (estructural) es menor (10% de 6 rutas) — el problema probablemente no es específico de rizomorfismo, es del ingrediente en general.

**Aplicada:** (vacío hasta que se confirme)

---

### PM-0003 · estado: candidata

**Detectado:** 2026-08-06 (auditoría inicial)

**Propuesta:** ninguna todavía — este es el caso más importante para el objetivo de rizomorfismo del usuario y necesita más investigación antes de proponer cualquier cambio. `ING-0028` (Lecitina de soja) es el ingrediente con MÁS contribución documentada a estructura (`N3_MEMBRANE` 50% + `N3_SPITZ` 25% = 75% de su perfil) de toda la biblioteca, con buen respaldo de literatura (`EXT-0002`) — pero su coef local es negativo con IC90 que no cruza cero, contradiciendo tanto el mecanismo documentado como la literatura externa.

**Evidencia:**
- Coef local: -3.05, IC90 [-4.44, -0.68] (no cruza cero) pero `confidence:'indeterminate'` — posible baja varianza de dosis en el dataset (no confirmado, requiere revisar el código de `_buildFeatureMatrix` en `cilab_inteligencia.js` si se quiere confirmar la causa exacta del flag).
- `EXT-0002` — literatura directa (*Aspergillus oryzae*) mostrando que reducir fosfatidilcolina falla la formación de hifas aéreas — el mecanismo documentado en `bl2_ings` tiene buen respaldo.

**Aplicada:** (vacío hasta que se confirme)
```

- [ ] **Step 2: Verificar**

Run: `node -e "const fs=require('fs'); const c=fs.readFileSync('docs/lab-intelligence/cilab-meta-inteligencia/propuestas_motor.md','utf8'); ['PM-0001','PM-0002','PM-0003'].forEach(id=>{ if(!c.includes(id)) throw new Error('falta '+id); }); console.log('OK');"`
Expected: `OK`

---

### Task 6: Confirmar que `docs/lab-intelligence/` sigue gitignoreado y commitear solo el `SKILL.md`

**Files:**
- Modify: ninguno (solo verificación + commit)

- [ ] **Step 1: Verificar que los 3 archivos vivos no aparecen como trackeables**

Run: `git status --short docs/lab-intelligence/cilab-meta-inteligencia/`
Expected: sin salida (carpeta ignorada por el patrón `docs/lab-intelligence/` en `.gitignore`) — si aparece algo, DETENERSE, no seguir al siguiente step, revisar `.gitignore` antes de cualquier `git add`.

- [ ] **Step 2: Confirmar que el `SKILL.md` sí aparece como untracked**

Run: `git status --short .claude/skills/cilab-meta-inteligencia/`
Expected: `?? .claude/skills/cilab-meta-inteligencia/SKILL.md`

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/cilab-meta-inteligencia/SKILL.md
git commit -m "$(cat <<'EOF'
feat: agrega skill cilab-meta-inteligencia

Sistema conversacional para CI/CILAB: trackea predicciones de
rizomorfismo antes del resultado real (proyecciones.md), acumula
literatura externa investigada activamente cuando el motor interno no
alcanza (conocimiento_externo.md), y mantiene un backlog de candidatos
a cambio en el motor de inteligencia (propuestas_motor.md) — sin
tocar nunca bio.contribuciones/rutas sin confirmación explícita.
Separada de biolab-analyst; lee sus archivos, nunca escribe en ellos.

Spec: docs/superpowers/specs/2026-08-06-cilab-formulador-skill-design.md
EOF
)"
```

- [ ] **Step 4: Verificar el commit**

Run: `git log --oneline -1 -- .claude/skills/cilab-meta-inteligencia/SKILL.md`
Expected: una línea con el commit recién creado.

---

### Task 7: Smoke test — la skill se dispara y lee lo sembrado

- [ ] **Step 1: En una conversación nueva de Claude Code sobre este repo, mencionar un resultado de CI/CILAB** (ej. "el frasco B de CI-0014 ya tiene rizomorfos visibles")

Expected: la skill `cilab-meta-inteligencia` aparece en el listado de skills disponibles del sistema (se recarga al iniciar sesión) y, al mencionarse el tema, se dispara o se ofrece disparar.

- [ ] **Step 2: Pedir explícitamente "revisá las proyecciones pendientes"**

Expected: la skill lee `docs/lab-intelligence/cilab-meta-inteligencia/proyecciones.md`, encuentra `PROY-0001` (`CI-0014`) en estado `pendiente`, y lo menciona correctamente (fórmula, contexto, riesgo identificado) sin inventar contenido que no esté en el archivo.

No requiere código adicional — este task es una verificación manual de que la skill quedó bien enganchada, no una automatización.
