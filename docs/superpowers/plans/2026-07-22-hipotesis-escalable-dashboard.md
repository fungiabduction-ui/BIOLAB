# Sistema de Hipótesis Escalable + Dashboard Local — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `docs/lab-intelligence/hipotesis.md` into a per-module directory (`docs/lab-intelligence/hipotesis/`) with stable IDs and a lifecycle status per hypothesis, wire it into `biolab-analyst`'s Modo análisis/anotación as a **read-only** cross-reference (single-writer rule: only Modo hipótesis y preguntas ever writes there), add date+time precision to all three logbook systems (`notebook.md`, `anotaciones.md`, hipótesis files), and generate a local static HTML dashboard.

**Architecture:** Pure markdown + one self-contained static HTML file. No build tooling, no new maintained scripts — same "Claude reads/writes files directly" philosophy the rest of `biolab-analyst` already uses (see "Por qué no hay un script de análisis mantenido" in the design spec). `docs/lab-intelligence/hipotesis/` replaces the single `hipotesis.md` file; `.claude/skills/biolab-analyst/SKILL.md` gains new steps inside 3 existing modes plus a new format section; `CLAUDE.md` (repo) gets its existing summary section updated to match.

**Tech Stack:** Markdown (docs), self-contained HTML/CSS for the dashboard (no JS framework — native `<details>`/`<summary>` for collapsible sections, `prefers-color-scheme` for dark mode), Bash for file moves/deletion and grep-based verification.

**Design reference:** `docs/superpowers/specs/2026-07-14-biolab-analyst-skill-design.md`, section "Extensión — Sistema de hipótesis escalable + dashboard local (2026-07-22, nueva sesión)".

---

### Task 1: Create `docs/lab-intelligence/hipotesis/index.md`

**Files:**
- Create: `docs/lab-intelligence/hipotesis/index.md`

- [ ] **Step 1: Write the file**

```markdown
# Índice — Bitácora de Hipótesis (`docs/lab-intelligence/hipotesis/`)

Capa 2 de conocimiento biológico y metodológico: preguntas de investigación, hipótesis metabólicas y diseños conceptuales de experimentos, organizados para que cualquier IA ejecutante (o el propio usuario) mantenga continuidad entre sesiones.

## Archivos

| Archivo | Alcance | Prefijo de ID |
|---|---|---|
| `ge-ci-cilab.md` | Genética, Cultivo In Vitro y Lab Analítico — bundlados a propósito, ver nota abajo | `HIP-CILAB-00NN` |
| `gr.md` | Grano / Spawn | `HIP-GR-00NN` |
| `su.md` | Sustrato | `HIP-SU-00NN` |
| `fr.md` | Fructificación | `HIP-FR-00NN` |
| `cross-modulo.md` | Hipótesis que involucran más de un módulo (ej. GR→FR, SU→FR) | `HIP-X-00NN` |
| `experimentos-en-cola.md` | Diseños conceptuales de experimentos a futuro | `EXP-C-00NN` (sin cambios respecto al esquema anterior) |

**Por qué `ge-ci-cilab.md` bundlea 3 módulos:** GE (identidad genética) y CI (cultivo in vitro) casi nunca generan una pregunta de investigación separable de cómo CILAB la termina evaluando (score teórico, OLS) — en la práctica, toda hipótesis de esta etapa temprana del pipeline es simultáneamente sobre cepa + fórmula + score. Se usa el prefijo `CILAB` (no `GE`/`CI` separados) porque ahí es donde la pregunta se termina resolviendo, y evita colisión conceptual con `CI-XXXX` (id real de fórmula en `bl2_forms`).

## Convención de ID y estado

Cada hipótesis es una sección `### HIP-<MOD>-00NN · estado: <estado>` con 5 campos base: `Registrada` (fecha+hora), `Contexto`, `Preguntas`, `Evidencia`, `Respondida` — no es un techo rígido, una hipótesis puede sumar un campo extra cuando el contenido realmente lo necesita (ej. `gr.md`/`HIP-GR-0001` agrega un bloque `Protocolo` entre `Contexto` y `Preguntas` para un procedimiento de laboratorio real). **Siempre dejar una línea en blanco entre campos** — sin eso, un renderer de Markdown puede colapsar `Evidencia`/`Respondida` dentro del último bullet anterior (lazy continuation de CommonMark). IDs secuenciales por archivo, 4 dígitos de padding (mismo criterio que `ING-`/`CRE-`/`MEJ-`). Granularidad: un id por hilo de investigación completo (una sección numerada, como ya existía antes de este split), no uno por cada pregunta suelta dentro de `Preguntas`.

**Estados:**
- `abierta` — registrada, sin experimento real corriendo todavía para responderla.
- `en_investigación` — un `EXP-C-XXXX`/`EXP-XXXX`/`CRE-XXXX` real está corriendo específicamente para responder esta pregunta (confirmado por el usuario, nunca automático).
- `respondida` — solo por confirmación explícita del usuario, nunca automático ni auto-reabierto.

Formato completo y ejemplo en `.claude/skills/biolab-analyst/SKILL.md`, sección "Hipótesis — formato".

## Quién escribe acá

Solo **Modo hipótesis y preguntas** del skill `biolab-analyst`. Modo análisis y Modo anotación leen estos archivos para cruzar hallazgos contra preguntas abiertas, pero nunca escriben directamente — solo sugieren, y el usuario confirma explícitamente antes de que algo se registre acá.

## Dashboard

`docs/lab-intelligence/dashboard.html` — vista de todas las hipótesis de todos los módulos, generado localmente, nunca publicado. Se regenera automáticamente cada vez que Modo hipótesis y preguntas escribe algo acá.
```

- [ ] **Step 2: Verify**

Run: `wc -l docs/lab-intelligence/hipotesis/index.md`
Expected: file exists, non-empty (~35 lines).

---

### Task 2: Migrate GE/CI/CILAB hypotheses → `ge-ci-cilab.md`

**Files:**
- Create: `docs/lab-intelligence/hipotesis/ge-ci-cilab.md`

- [ ] **Step 1: Write the file**

```markdown
# Hipótesis — GE / CI / CILAB (Genética, Cultivo In Vitro y Lab Analítico)

Ver `index.md` para la convención de ID/estado y por qué estos 3 módulos están bundlados en un solo archivo.

---

### HIP-CILAB-0001 · estado: abierta

**Registrada:** 2026-07-19 (migrada desde el `hipotesis.md` original — no hay hora ni fecha de creación por sección registrada antes de esta migración, solo la fecha de última modificación del archivo)

**Contexto:** El Factor Rizo (Rizomorfismo en cepa SIF con N5 / BOB'S). Se ha determinado que el rizomorfismo en la cepa SIF (organismo joven, en su "prime" con BE +300% en fructificación, sin senescencia ni condensación física en placas) depende fuertemente de la **marca/calidad** y de la **concentración** de la levadura de cerveza utilizada:
- **Levadura "Natural Whey":** Cero inducción de rizomorfismo en cualquier dosis (inviable para este fin).
- **Levadura "Macro Salud":** Umbral de rizomorfismo óptimo en **4.5 g/L** en la fórmula N5.
- **Levadura "Bob's Red Mill" (ING-0032):** Umbral en **6 g/L** (`EXP-0006`), induciendo un patrón diferente al de Macro Salud: cordones más gruesos, definidos y vigorosos.

**Preguntas:**
- **¿Cuál es el agente inductor del rizomorfismo y su dosis-respuesta por marca?**
  - ¿Son las vitaminas del complejo B de la levadura (especialmente B1/B6, muy elevadas en la fórmula fortificada de Bob's Red Mill) las causantes del grosor y vigor del rizomorfismo?
  - Si disminuimos la dosis de Bob's Red Mill a **5 g/L**, ¿se mantendrá este patrón grueso o caerá por debajo del umbral de inducción?
- **¿Existe un factor de adaptación metabólica (entrenamiento)?**
  - ¿Desarrollará SIF patrones más predecibles y un mayor porcentaje de placas rizomórficas a medida que hagamos más repiques sucesivos (pasajes) en el medio enriquecido con Bob's Red Mill?
- **¿Existe un límite de saturación/toxicidad biológica?**
  - Si aumentamos aún más la concentración de levadura en el medio (por encima de 6g/L), ¿aumentará el rizomorfismo o saturaremos/inhibiremos el crecimiento?
- **¿Cómo estabilizar el 30% restante de comportamiento tormentoso?**
  - ¿Se beneficiaría de un carbohidrato de acción más lenta (ej. almidón de maíz) para moderar la tasa de absorción de azúcares?
  - ¿O requiere simplemente mayor concentración de la levadura?
  - ¿Valdría la pena la suplementación controlada con 1/2 cápsula de "NatureBell Methylated B Complex" a pesar de los riesgos de sobredosis/multifactor?

**Evidencia:**
- (sin evidencia registrada aún)

**Respondida:** (vacío hasta que se confirme)

---

### HIP-CILAB-0002 · estado: abierta

**Registrada:** 2026-07-19 (migrada — ver nota en HIP-CILAB-0001)

**Contexto:** Velocidad de Asimilación de Carbono y Nutrientes Traza (Extracto de Malta vs Sacarosa). El usuario reportó que al sustituir Extracto de Malta "Cirse" por Azúcar común (sacarosa refinada) en la misma proporción (10g/L) en la fórmula N5, el micelio pasó a ser absolutamente tormentoso, perdiendo el rizomorfismo previo.

**Preguntas:**
- **¿Es la sacarosa un represor por catabolito carbonado agudo?**
  - La sacarosa se descompone rápidamente en glucosa y fructosa. Los picos de azúcares simples disponibles suelen apagar los genes de crecimiento exploratorio (rizomórfico) y sobre-estimular la biomasa vegetativa desordenada (tormentoso).
- **¿Qué cofactores del Extracto de Malta estamos perdiendo con el azúcar común?**
  - El extracto de malta no es solo maltosa; contiene nitrógeno orgánico (aminoácidos libres), fósforo, potasio y vitaminas del grupo B naturales de la cebada malteada.
  - ¿El rizomorfismo en la N5 original dependía de la interacción sinérgica de estos cofactores naturales de la malta con la levadura de cerveza?

**Evidencia:**
- (sin evidencia registrada aún)

**Respondida:** (vacío hasta que se confirme)
```

- [ ] **Step 2: Verify**

Run: `grep -c "^### HIP-" docs/lab-intelligence/hipotesis/ge-ci-cilab.md`
Expected: `2`

---

### Task 3: Migrate GR hypothesis → `gr.md`

**Files:**
- Create: `docs/lab-intelligence/hipotesis/gr.md`

- [ ] **Step 1: Write the file**

```markdown
# Hipótesis — GR (Grano / Spawn)

Ver `index.md` para la convención de ID/estado.

---

### HIP-GR-0001 · estado: abierta

**Registrada:** 2026-07-19 (migrada desde el `hipotesis.md` original — no hay hora ni fecha de creación por sección registrada antes de esta migración, solo la fecha de última modificación del archivo)

**Contexto:** Colonización Acelerada por Hidratación en Frío y Lavado Químico Secuencial (Lote GR167 "INGLATERRA-GAY"). El lote GR167 de grano de avena mostró una tasa de colonización inusualmente rápida tras la inoculación. El protocolo empleado difiere del tradicional en la hidratación hídrica (en frío y prolongada) y en el uso de agentes de lavado específicos.

**Protocolo de Preparación del Grano (Avena):**
1. **Lavado Físico:** Enjuague superficial con agua limpia del grifo para remover polvo y suciedad gruesa.
2. **Inmersión Alcalina:** Inmersión de 1 hora en agua tibia con una baja dosis de detergente alcalino disuelto en agua hirviendo, aplicando agitación intermitente.
3. **Primer Choque Químico:** Inmersión de 1 hora en una solución residual de ácido peracético (proveniente de la limpieza de placas de CI).
4. **Lavado Intermedio:** Enjuagues sucesivos con agua limpia del grifo.
5. **Hidratación en Frío (72h):** Inmersión en agua limpia del grifo en frío durante aproximadamente 3 días, garantizando saturación hídrica profunda.
6. **Segundo Choque Químico (Pre-escurrido):** Adición de 30 ml de ácido peracético al 5% directamente en el agua de remojo 12 horas antes de procesar (reposo de toda la noche).
7. **Escurrido y Secado:** Lavado final, escurrido y secado superficial.
8. **Esterilización:** Frascos de 660 ml (cargados con 500 ml de volumen / 260g de masa de grano hidratado), esterilizados durante 2 horas.

**Preguntas:**
- **¿Es la remoción de lípidos/ceras superficiales por el detergente alcalino el factor clave?**
  - Los granos de avena poseen una capa lipídica y cutícula cerosa protectora. El detergente alcalino puede haber saponificado/removido estas grasas superficiales, exponiendo el endospermo de almidón y facilitando que las enzimas del micelio degraden el sustrato mucho más rápido.
  - Alternativa: El detergente alcalino removió suciedad química latente o compuestos fúngicos inhibitorios (endófitos) presentes en la cáscara del grano.
- **¿Qué rol juega la hidratación en frío de 72 horas versus cocción?**
  - La hidratación lenta en frío hincha el grano al 100% de su capacidad hídrica máxima de forma homogénea **sin fisurar ni romper la cutícula**. Un grano entero y firme mantiene el aire molecular entre granos y reduce el exceso de almidón libre (que causa aglutinamiento y focos bacterianos), optimizando la aeración interna del frasco para el avance micelial.
- **¿Cómo influirá esta velocidad en la fructificación (FR)?**
  - ¿Un grano colonizado más rápido y con estructura más íntegra producirá fructificaciones más homogéneas (fenotipo hegemónico), frutos más saludables y un incremento adicional en la BE?
  - ¿En cuántos días completará la colonización total en comparación con el histórico de avena?

**Evidencia:**
- (sin evidencia registrada aún)

**Respondida:** (vacío hasta que se confirme)
```

- [ ] **Step 2: Verify**

Run: `grep -c "^### HIP-" docs/lab-intelligence/hipotesis/gr.md`
Expected: `1`

---

### Task 4: Migrate SU hypotheses → `su.md`

**Files:**
- Create: `docs/lab-intelligence/hipotesis/su.md`

- [ ] **Step 1: Write the file**

```markdown
# Hipótesis — SU (Sustrato)

Ver `index.md` para la convención de ID/estado.

---

### HIP-SU-0001 · estado: abierta

**Registrada:** 2026-07-19 (migrada — ver nota en `ge-ci-cilab.md` HIP-CILAB-0001)

**Contexto:** Dinámica de Hidratación en Fibra de Coco. El usuario está explorando aumentos en la hidratación (ratio de agua agregada ÷ fibra seca) de la fibra de coco, probando un ratio de **5.953** (SU127/SU137) y series experimentales con exceso de agua (tanto sin levadura como con levadura).

**Preguntas:**
- **Hipótesis de Fructificación:** Un mayor ratio de agua disponible en la fibra de coco puede traducirse en frutos de mayor peso por aporte hídrico directo.
- **Hipótesis de Colonización (Ralentización):** El exceso de agua libre en el sustrato satura los microporos físicos, desplazando el aire y reduciendo la disponibilidad de O₂ a nivel de hifa. Esto genera una desaceleración en la colonización vegetativa (demora de 2 a 3 días adicionales observada en las nuevas series), ya que el micelio debe avanzar en microambientes parcialmente anaeróbicos.

**Evidencia:**
- (sin evidencia registrada aún)

**Respondida:** (vacío hasta que se confirme)

---

### HIP-SU-0002 · estado: abierta

**Registrada:** 2026-07-19 (migrada — ver nota en `ge-ci-cilab.md` HIP-CILAB-0001)

**Contexto:** Estructura Física y Prevención de Compactación (Granulometría de Avena en SU). La combinación de 100% grano de avena entero (hidratado en frío) con el sustrato de expansión (fibra de coco) parece crear una matriz física muy porosa y aireada.

**Preguntas:**
- La avena hidratada en frío preserva su estructura física rígida, actuando como un espaciador físico que previene el apelmazamiento y la compactación de la fibra de coco bajo altas cargas orgánicas (como 50g de levadura). ¿Al evitar la compactación, se mantiene la capilaridad para el agua libre y los canales microscópicos de aireación en todo el bloque de sustrato, optimizando el transporte de nutrientes y el avance hídrico?

**Evidencia:**
- (sin evidencia registrada aún)

**Respondida:** (vacío hasta que se confirme)
```

- [ ] **Step 2: Verify**

Run: `grep -c "^### HIP-" docs/lab-intelligence/hipotesis/su.md`
Expected: `2`

---

### Task 5: Migrate FR hypotheses → `fr.md`

**Files:**
- Create: `docs/lab-intelligence/hipotesis/fr.md`

- [ ] **Step 1: Write the file**

```markdown
# Hipótesis — FR (Fructificación)

Ver `index.md` para la convención de ID/estado.

---

### HIP-FR-0001 · estado: abierta

**Registrada:** 2026-07-19 (migrada — ver nota en `ge-ci-cilab.md` HIP-CILAB-0001)

**Contexto:** Drivers Ambientales de Anomalías (Frío vs. Aditivos de Sustrato). El ranking automático de anomalías de la app (`anomalyRanking`) señaló a la "Levadura de cerveza (medio)" como factor de riesgo para deformaciones en fructificación. Sin embargo, el análisis histórico reveló que bolsas cosechadas en abril sin levadura ya mostraban deformaciones idénticas.

**Preguntas:**
- Las deformaciones (mutaciones, abortos, formas atípicas) ¿son causadas principalmente por temperaturas subóptimas durante el otoño/invierno (control ineficiente con A/C improvisado en modo calor), actuando la levadura como confusor estadístico por coincidencia temporal de su uso con la época fría del año?

**Evidencia:**
- (nota de migración: `notebook.md` — entrada 2026-07-14, tercera corrida full — y `mejoras_app.md` (`MEJ-0003`) ya documentan este mismo patrón de confounding estación-vs-aditivo, pero no se copian acá automáticamente como evidencia formal. Si el usuario quiere formalizar el link, decirlo en conversación para que Modo hipótesis y preguntas lo registre con fecha+hora real.)

**Respondida:** (vacío hasta que se confirme)

---

### HIP-FR-0002 · estado: abierta

**Registrada:** 2026-07-19 (migrada — ver nota en `ge-ci-cilab.md` HIP-CILAB-0001)

**Contexto:** Demanda Metabólica de Oxígeno (FAE) en Sustratos Súper-Nutridos (Casos FR2106 / FR2106b). La bolsa FR2106 (procedente de un lote de SU con 50g de levadura y 100% avena) está fructificando de forma excepcional con frutos gigantes, densos y en crecimiento continuo. A diferencia de ensayos fallidos anteriores con 50g de levadura (ej. FR285, 0 flushes por asfixia/inhibición), esta bolsa posee el **doble de puerto de intercambio gaseoso (FAE)**. La bolsa hermana FR2106b (misma receta) se encuentra pineando.

**Preguntas:**
- La tasa de respiración metabólica celular del micelio, ¿aumenta de forma proporcional a la carga nutricional del sustrato? Si el sustrato está súper-nutrido (50g levadura) pero el FAE es estándar, ¿el micelio consume el O₂ disponible rápidamente y se asfixia bajo sus propios subproductos de CO₂ acumulados (inhibiendo los primordios o causando deformaciones extremas)? Al duplicar el FAE, ¿se disipa el exceso de CO₂ y se suministra el O₂ necesario para sostener un metabolismo altamente activo, permitiendo canalizar la enorme carga de nutrientes hacia frutos gigantes y densos?

**Evidencia:**
- (sin evidencia registrada aún)

**Respondida:** (vacío hasta que se confirme)

---

### HIP-FR-0003 · estado: abierta

**Registrada:** 2026-07-19 (migrada — ver nota en `ge-ci-cilab.md` HIP-CILAB-0001)

**Contexto:** FAE Dinámico / Diferencial (Iniciación Post-Colonización). Para mitigar la ralentización de la colonización en sustratos con exceso de agua (con y sin levadura), se plantea mantener un FAE estándar durante la colonización y agregar físicamente un puerto de FAE extra inmediatamente después de que el bloque esté 100% colonizado.

**Preguntas:**
- ¿La fase de colonización vegetativa se beneficia de niveles de humedad estables y concentraciones de CO₂ moderadamente elevadas (que estimulan el crecimiento lineal de las hifas), mientras que al iniciar la fructificación el exceso de agua acumulada y los nutrientes requieren un fuerte gradiente de evaporación superficial y un shock de O₂ para inducir el pinado vigoroso? ¿Dividir el proceso en FAE estándar (colonización) → FAE doble (fructificación) maximizará el rendimiento reduciendo los tiempos de incubación?

**Evidencia:**
- (sin evidencia registrada aún)

**Respondida:** (vacío hasta que se confirme)
```

- [ ] **Step 2: Verify**

Run: `grep -c "^### HIP-" docs/lab-intelligence/hipotesis/fr.md`
Expected: `3`

---

### Task 6: Create empty `cross-modulo.md`

**Files:**
- Create: `docs/lab-intelligence/hipotesis/cross-modulo.md`

- [ ] **Step 1: Write the file**

```markdown
# Hipótesis — Cross-módulo

Hipótesis que involucran más de un módulo del pipeline (ej. GR→FR, SU→FR) — no encajan en un solo archivo de módulo. Ver `index.md` para la convención de ID/estado.

Vacío por ahora — sin hipótesis registradas todavía en esta categoría.
```

- [ ] **Step 2: Verify**

Run: `cat docs/lab-intelligence/hipotesis/cross-modulo.md`
Expected: file exists with the header above.

---

### Task 7: Migrate experiment queue → `experimentos-en-cola.md`

**Files:**
- Create: `docs/lab-intelligence/hipotesis/experimentos-en-cola.md`

- [ ] **Step 1: Write the file**

```markdown
# Experimentos en Cola — Diseños Conceptuales

Cola de diseños conceptuales de experimentos a futuro, registrados vía Modo hipótesis y preguntas. IDs `EXP-C-00NN`, sin relación con los `EXP-XXXX` reales de `bl2_experimentos` en la app (esos son experimentos ya corriendo/corridos; estos son diseños propuestos, todavía no ejecutados). Ver `index.md` para el resto de la convención.

---

### EXP-C-0001: Curva de Saturación de Levadura BRM (Bob's Red Mill)
* **Objetivo:** Encontrar el óptimo de concentración de `ING-0032` para inducir rizomorfismo sin inhibición por exceso de nutrientes.
* **Diseño conceptual:**
  * **Frasco Base (CI-0012 base):** 18g Agar.
  * **Brazo A (Control):** 3g/L (Punto bajo de EXP-0006).
  * **Brazo B:** 6g/L (Punto alto exitoso de EXP-0006).
  * **Brazo C:** 9g/L (Saturación moderada).
  * **Brazo D:** 12g/L (Saturación alta / límite de toxicidad).

### EXP-C-0002: Moderación de Absorción de Carbono (Almidón)
* **Objetivo:** Probar si una fuente de carbohidrato compleja (acción lenta) reduce el crecimiento tormentoso (típico de excesos de azúcares simples).
* **Diseño conceptual:**
  * **Base:** CI-0012 + 6g/L de Levadura BRM.
  * **Brazo A:** Sin aditivos de carbono adicionales (Control).
  * **Brazo B:** + 2g/L de Almidón de maíz (Maizena).
  * **Brazo C:** + 5g/L de Almidón de maíz.
```

- [ ] **Step 2: Verify**

Run: `grep -c "^### EXP-C-" docs/lab-intelligence/hipotesis/experimentos-en-cola.md`
Expected: `2`

---

### Task 8: Delete the old single-file `hipotesis.md`

**Files:**
- Delete: `docs/lab-intelligence/hipotesis.md`

- [ ] **Step 1: Confirm all content was migrated**

Run: `grep -c "^### HIP-" docs/lab-intelligence/hipotesis/*.md`
Expected: `ge-ci-cilab.md:2`, `gr.md:1`, `su.md:2`, `fr.md:3` (total 8, matching the 2+1+2+3 sections in the original `hipotesis.md`), `cross-modulo.md:0`.

- [ ] **Step 2: Delete the old file**

```bash
rm "docs/lab-intelligence/hipotesis.md"
```

- [ ] **Step 3: Verify it's gone and nothing in the repo (outside historical spec/plan docs) still points at it**

Run: `grep -rn "lab-intelligence/hipotesis.md" --include="*.md" .claude docs/lab-intelligence 2>/dev/null`
Expected: no matches inside `.claude/skills/` (that gets fixed in Task 10-13) — matches inside `docs/superpowers/specs/` or this plan itself are fine, they're historical record of the old design and shouldn't be edited.

---

### Task 9: Generate the initial `dashboard.html`

**Files:**
- Create: `docs/lab-intelligence/dashboard.html`

- [ ] **Step 1: Write the file**

```html
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>BIOLAB — Dashboard de Hipótesis</title>
<style>
  :root {
    --bg: #f7f7f5;
    --card-bg: #ffffff;
    --text: #1c1c1a;
    --muted: #6b6b64;
    --border: #e3e2dd;
    --badge-abierta-bg: #fff4e0;
    --badge-abierta-text: #8a5a00;
    --badge-inv-bg: #e6f0ff;
    --badge-inv-text: #1a4d99;
    --badge-resp-bg: #e6f7ec;
    --badge-resp-text: #1a7a3f;
    --accent: #3d6b4f;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #17181a;
      --card-bg: #212226;
      --text: #e8e8e5;
      --muted: #9a9a94;
      --border: #34353a;
      --badge-abierta-bg: #4a3410;
      --badge-abierta-text: #ffcf80;
      --badge-inv-bg: #17304d;
      --badge-inv-text: #9fc4ff;
      --badge-resp-bg: #163826;
      --badge-resp-text: #8fe0b0;
      --accent: #7fbf9a;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 2rem 1.25rem 4rem;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    line-height: 1.5;
  }
  .wrap { max-width: 860px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
  .subtitle { color: var(--muted); font-size: 0.9rem; margin-bottom: 1.5rem; }
  .counts { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 2rem; }
  .count-pill { background: var(--card-bg); border: 1px solid var(--border); border-radius: 999px; padding: 0.4rem 0.9rem; font-size: 0.85rem; }
  .count-pill b { color: var(--accent); }
  h2 { font-size: 1.1rem; margin: 2rem 0 0.75rem; padding-bottom: 0.35rem; border-bottom: 2px solid var(--border); }
  .card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 10px; padding: 1rem 1.25rem; margin-bottom: 1rem; }
  .card-head { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; margin-bottom: 0.5rem; }
  .card-head .id { font-weight: 600; font-size: 0.95rem; }
  .badge { font-size: 0.72rem; font-weight: 600; padding: 0.15rem 0.55rem; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.02em; }
  .badge.abierta { background: var(--badge-abierta-bg); color: var(--badge-abierta-text); }
  .badge.en_investigacion { background: var(--badge-inv-bg); color: var(--badge-inv-text); }
  .badge.respondida { background: var(--badge-resp-bg); color: var(--badge-resp-text); }
  .registrada { color: var(--muted); font-size: 0.78rem; }
  .contexto { margin: 0.5rem 0; font-size: 0.92rem; }
  details { margin-top: 0.5rem; font-size: 0.88rem; }
  summary { cursor: pointer; color: var(--muted); }
  .evidencia-list { margin: 0.4rem 0 0; padding-left: 1.1rem; }
  .empty { color: var(--muted); font-style: italic; }
  .exp-card { font-size: 0.9rem; }
</style>
</head>
<body>
<div class="wrap">
  <h1>BIOLAB — Dashboard de Hipótesis</h1>
  <div class="subtitle">Generado localmente por biolab-analyst · no publicado · fuente: docs/lab-intelligence/hipotesis/</div>

  <div class="counts">
    <span class="count-pill">Total: <b>8</b></span>
    <span class="count-pill">Abiertas: <b>8</b></span>
    <span class="count-pill">En investigación: <b>0</b></span>
    <span class="count-pill">Respondidas: <b>0</b></span>
  </div>

  <h2>🧬 GE / CI / CILAB</h2>

  <div class="card">
    <div class="card-head"><span class="id">HIP-CILAB-0001</span><span class="badge abierta">abierta</span></div>
    <div class="registrada">Registrada: 2026-07-19 (migrada, sin hora original)</div>
    <p class="contexto">El Factor Rizo (Rizomorfismo en cepa SIF con N5 / BOB'S) — el rizomorfismo depende de marca y concentración de la levadura de cerveza (Natural Whey: nula; Macro Salud: 4.5 g/L; Bob's Red Mill/ING-0032: 6 g/L, cordones más gruesos).</p>
    <details><summary>Preguntas (4)</summary>
      <ul class="evidencia-list">
        <li>¿Cuál es el agente inductor del rizomorfismo y su dosis-respuesta por marca?</li>
        <li>¿Existe un factor de adaptación metabólica (entrenamiento)?</li>
        <li>¿Existe un límite de saturación/toxicidad biológica?</li>
        <li>¿Cómo estabilizar el 30% restante de comportamiento tormentoso?</li>
      </ul>
    </details>
    <details><summary>Evidencia</summary><p class="empty">sin evidencia registrada aún</p></details>
  </div>

  <div class="card">
    <div class="card-head"><span class="id">HIP-CILAB-0002</span><span class="badge abierta">abierta</span></div>
    <div class="registrada">Registrada: 2026-07-19 (migrada, sin hora original)</div>
    <p class="contexto">Velocidad de Asimilación de Carbono y Nutrientes Traza — sustituir Extracto de Malta "Cirse" por sacarosa común (misma dosis) volvió el micelio tormentoso, perdiendo el rizomorfismo previo.</p>
    <details><summary>Preguntas (2)</summary>
      <ul class="evidencia-list">
        <li>¿Es la sacarosa un represor por catabolito carbonado agudo?</li>
        <li>¿Qué cofactores del Extracto de Malta se pierden con el azúcar común?</li>
      </ul>
    </details>
    <details><summary>Evidencia</summary><p class="empty">sin evidencia registrada aún</p></details>
  </div>

  <h2>🌾 GR</h2>

  <div class="card">
    <div class="card-head"><span class="id">HIP-GR-0001</span><span class="badge abierta">abierta</span></div>
    <div class="registrada">Registrada: 2026-07-19 (migrada, sin hora original)</div>
    <p class="contexto">Colonización Acelerada por Hidratación en Frío y Lavado Químico Secuencial (Lote GR167 "INGLATERRA-GAY") — protocolo con inmersión alcalina + doble choque de ácido peracético + hidratación en frío 72h mostró colonización inusualmente rápida.</p>
    <details><summary>Preguntas (3)</summary>
      <ul class="evidencia-list">
        <li>¿Es la remoción de lípidos/ceras superficiales por el detergente alcalino el factor clave?</li>
        <li>¿Qué rol juega la hidratación en frío de 72h versus cocción?</li>
        <li>¿Cómo influirá esta velocidad en la fructificación (FR)?</li>
      </ul>
    </details>
    <details><summary>Evidencia</summary><p class="empty">sin evidencia registrada aún</p></details>
  </div>

  <h2>🪵 SU</h2>

  <div class="card">
    <div class="card-head"><span class="id">HIP-SU-0001</span><span class="badge abierta">abierta</span></div>
    <div class="registrada">Registrada: 2026-07-19 (migrada, sin hora original)</div>
    <p class="contexto">Dinámica de Hidratación en Fibra de Coco — ratio 5.953 (SU127/SU137) y series con exceso de agua, con y sin levadura.</p>
    <details><summary>Preguntas (2)</summary>
      <ul class="evidencia-list">
        <li>Mayor ratio de agua → ¿frutos de mayor peso por aporte hídrico directo?</li>
        <li>Exceso de agua libre → ¿satura microporos y ralentiza colonización 2-3 días?</li>
      </ul>
    </details>
    <details><summary>Evidencia</summary><p class="empty">sin evidencia registrada aún</p></details>
  </div>

  <div class="card">
    <div class="card-head"><span class="id">HIP-SU-0002</span><span class="badge abierta">abierta</span></div>
    <div class="registrada">Registrada: 2026-07-19 (migrada, sin hora original)</div>
    <p class="contexto">Estructura Física y Prevención de Compactación (Granulometría de Avena en SU) — avena entera hidratada en frío + fibra de coco crea matriz porosa y aireada.</p>
    <details><summary>Preguntas (1)</summary>
      <ul class="evidencia-list">
        <li>¿La avena actúa como espaciador físico que previene compactación bajo altas cargas orgánicas (ej. 50g de levadura)?</li>
      </ul>
    </details>
    <details><summary>Evidencia</summary><p class="empty">sin evidencia registrada aún</p></details>
  </div>

  <h2>🍄 FR</h2>

  <div class="card">
    <div class="card-head"><span class="id">HIP-FR-0001</span><span class="badge abierta">abierta</span></div>
    <div class="registrada">Registrada: 2026-07-19 (migrada, sin hora original)</div>
    <p class="contexto">Drivers Ambientales de Anomalías (Frío vs. Aditivos de Sustrato) — <code>anomalyRanking</code> señaló "Levadura de cerveza" pero bolsas de abril sin levadura ya mostraban deformaciones idénticas.</p>
    <details><summary>Preguntas (1)</summary>
      <ul class="evidencia-list">
        <li>¿Las deformaciones se deben a temperatura subóptima de otoño/invierno, actuando la levadura como confusor estadístico por coincidencia temporal?</li>
      </ul>
    </details>
    <details><summary>Evidencia</summary><p class="empty">sin evidencia formal registrada — ver nota en fr.md: notebook.md (2026-07-14) y MEJ-0003 ya tocan este mismo patrón, sin link formal todavía</p></details>
  </div>

  <div class="card">
    <div class="card-head"><span class="id">HIP-FR-0002</span><span class="badge abierta">abierta</span></div>
    <div class="registrada">Registrada: 2026-07-19 (migrada, sin hora original)</div>
    <p class="contexto">Demanda Metabólica de Oxígeno (FAE) en Sustratos Súper-Nutridos (FR2106/FR2106b) — doble puerto FAE con sustrato de 50g levadura dio frutos gigantes, a diferencia de FR285 (0 flushes, FAE estándar).</p>
    <details><summary>Preguntas (1)</summary>
      <ul class="evidencia-list">
        <li>¿La respiración metabólica aumenta con la carga nutricional, y el FAE estándar se queda corto (asfixia/CO₂) cuando el sustrato está súper-nutrido?</li>
      </ul>
    </details>
    <details><summary>Evidencia</summary><p class="empty">sin evidencia registrada aún</p></details>
  </div>

  <div class="card">
    <div class="card-head"><span class="id">HIP-FR-0003</span><span class="badge abierta">abierta</span></div>
    <div class="registrada">Registrada: 2026-07-19 (migrada, sin hora original)</div>
    <p class="contexto">FAE Dinámico / Diferencial (Iniciación Post-Colonización) — FAE estándar durante colonización, FAE doble agregado al completar colonización.</p>
    <details><summary>Preguntas (1)</summary>
      <ul class="evidencia-list">
        <li>¿La colonización se beneficia de CO₂ moderado y la fructificación necesita un shock de O₂ para pinado vigoroso?</li>
      </ul>
    </details>
    <details><summary>Evidencia</summary><p class="empty">sin evidencia registrada aún</p></details>
  </div>

  <h2>🔀 Cross-módulo</h2>
  <p class="empty">Sin hipótesis registradas todavía en esta categoría.</p>

  <h2>🧪 Experimentos en Cola</h2>

  <div class="card exp-card">
    <div class="card-head"><span class="id">EXP-C-0001</span></div>
    <p class="contexto"><b>Curva de Saturación de Levadura BRM (Bob's Red Mill)</b> — encontrar el óptimo de concentración de ING-0032 para inducir rizomorfismo sin inhibición. Base CI-0012, brazos 3/6/9/12 g/L.</p>
  </div>

  <div class="card exp-card">
    <div class="card-head"><span class="id">EXP-C-0002</span></div>
    <p class="contexto"><b>Moderación de Absorción de Carbono (Almidón)</b> — probar si almidón de maíz reduce crecimiento tormentoso. Base CI-0012 + 6g/L BRM, brazos 0/2/5 g/L de almidón.</p>
  </div>

</div>
</body>
</html>
```

- [ ] **Step 2: Verify structurally**

Run: `grep -c '<div class="card">' docs/lab-intelligence/dashboard.html`
Expected: `8` (one per hypothesis — note this exact-match pattern deliberately excludes the nested `card-head`/`exp-card` divs, which share the `card` substring but not this exact attribute value)

Run: `grep -c '<div class="card exp-card">' docs/lab-intelligence/dashboard.html`
Expected: `2` (one per queued experiment)

- [ ] **Step 3: Manual visual verification (cannot be automated)**

Open `docs/lab-intelligence/dashboard.html` directly in a browser (double-click, or `start docs/lab-intelligence/dashboard.html` on Windows) and confirm: counts pill shows 8/8/0/0, all 6 section headers render, badges are legible in both light and dark OS theme, `<details>` sections expand/collapse on click. This is a UI change — report it as verified only after actually looking at it, not from the HTML alone.

---

### Task 10: `SKILL.md` — rewrite "Modo hipótesis y preguntas"

**Files:**
- Modify: `.claude/skills/biolab-analyst/SKILL.md` (current lines 58-65)

- [ ] **Step 1: Replace the section**

Old text (lines 58-65):
```markdown
## Modo hipótesis y preguntas

1. Confirm in one line what you're about to update or register in `hipotesis.md`.
2. Open `docs/lab-intelligence/hipotesis.md` (create it if missing).
3. If the user is sharing a new hypothesis or research question, append it to the relevant section (or create a new section if appropriate) with clear bullet points.
4. If the user is proposing a conceptual experiment design, register it under the `## 🧪 Diseños Conceptuales de Experimentos (En Cola)` section, assigning it a conceptual sequential ID like `EXP-C-XXXX`.
5. Keep it clean and structured so any subsequent AI can read it as context.
6. Done — do not touch `checkpoint.json` and do not run a full analysis pass.
```

New text:
```markdown
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
```

- [ ] **Step 2: Verify**

Run: `grep -n "hipotesis.md" .claude/skills/biolab-analyst/SKILL.md`
Expected: no matches left referring to the old single file inside this section (later tasks fix the remaining ones).

---

### Task 11: `SKILL.md` — add "Hipótesis — formato" section

**Files:**
- Modify: `.claude/skills/biolab-analyst/SKILL.md` (insert after the existing "Backlog de mejoras — formato" section, before "## Checkpoint schema", i.e. after the line `IDs sequential, ... never silently reopened.` and before `## Checkpoint schema`)

- [ ] **Step 1: Insert the new section**

Anchor text (existing, do not change — insert new content immediately after this paragraph and before `## Checkpoint schema`):
```markdown
IDs sequential, `MEJ-0001`, `MEJ-0002`... (4-digit padding, same convention as `ING-`/`CRE-`/etc.). States: `abierta` (one piece of evidence) → `reforzada` (2+, transitions automatically the moment a second `Evidencia` line is added, no user action needed) → `resuelta` (only via "Confirmar resolución de un item del backlog," never automatic). `Evidencia` entries represent distinct occurrences of the pattern — a later run, or a second independent finding within the same run — never a process note re-confirming the same original finding (e.g. "re-checked, still true"); don't pad a brand-new item's `Evidencia` with one of those just to promote it. A `resuelta` item that seems to recur is flagged as a possible regression (see Modo análisis step 11) but never silently reopened.
```

New content to insert right after it (note: this block uses a 4-backtick fence because its own content contains a nested 3-backtick example — don't drop to 3 for the outer fence or the nesting breaks):
````markdown
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
````

- [ ] **Step 2: Verify**

Run: `grep -n "^## " .claude/skills/biolab-analyst/SKILL.md`
Expected: see `## Hipótesis — formato` and `## Dashboard — formato` listed between `## Backlog de mejoras — formato` and `## Checkpoint schema`.

---

### Task 12: `SKILL.md` — Modo análisis: insert read-only cross-reference step

**Files:**
- Modify: `.claude/skills/biolab-analyst/SKILL.md` (current steps 9-13 of Modo análisis)

- [ ] **Step 1: Replace steps 9-13 with a renumbered block that inserts the new step 10**

Old text:
```markdown
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
```

New text:
```markdown
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
```

- [ ] **Step 2: Fix two now-stale cross-references to the old step numbering**

Renumbering steps 9-13 to 9-14 breaks two existing internal references elsewhere in the file that point at the old "step 11" (= Backlog de mejoras before this change, now step 12).

In step 7 ("Revisar código fuente ante un hallazgo inesperado"), current text ends with:
```markdown
If it reveals a real bug, carry it into step 11 as a `bug`-category backlog candidate.
```
Change `step 11` → `step 12`.

In the "Backlog de mejoras — formato" section, current text ends with:
```markdown
A `resuelta` item that seems to recur is flagged as a possible regression (see Modo análisis step 11) but never silently reopened.
```
Change `step 11` → `step 12`.

- [ ] **Step 3: Verify**

Run: `grep -n "^[0-9]\+\." .claude/skills/biolab-analyst/SKILL.md | head -20`
Expected: Modo análisis steps run 1 through 14 without gaps or duplicate numbers.

Run: `grep -n "step 11\|step 12" .claude/skills/biolab-analyst/SKILL.md`
Expected: both remaining references read "step 12" (pointing at Backlog de mejoras in its new position), no leftover "step 11" pointing at the wrong step.

---

### Task 13: `SKILL.md` — Modo anotación: add lightweight cross-reference + timestamp

**Files:**
- Modify: `.claude/skills/biolab-analyst/SKILL.md` (current Modo anotación steps 1-4)

- [ ] **Step 1: Replace the section**

Old text:
```markdown
## Modo anotación

1. Confirm in one line what you're about to save (a short paraphrase, not necessarily a literal copy) before writing anything.
2. Determine the scope tag: a real id from the newest backup if the user names one and it actually exists there. If the user names an id that doesn't appear in the backup (typo or otherwise), say so explicitly and ask — never guess or save it anyway under an invalid id. If there's no specific id in play, use `general/<short-topic>`. When tagging a point-scoped annotation, also record the target's permanent internal id alongside the visible one (`_frUuid` for a `fr_bolsas` entry, `_uuid` for a `su_lotes` entry) — the visible `id` can be renamed later and would otherwise silently orphan the annotation.
3. Append the entry to `docs/lab-intelligence/anotaciones.md` (create the file with a one-line header if it doesn't exist) with today's date, using the format below.
4. Done — do not touch `checkpoint.json` and do not run a full analysis pass; this is independent of the incremental/full-history cycle in Modo análisis.
```

New text:
```markdown
## Modo anotación

1. Confirm in one line what you're about to save (a short paraphrase, not necessarily a literal copy) before writing anything.
2. Determine the scope tag: a real id from the newest backup if the user names one and it actually exists there. If the user names an id that doesn't appear in the backup (typo or otherwise), say so explicitly and ask — never guess or save it anyway under an invalid id. If there's no specific id in play, use `general/<short-topic>`. When tagging a point-scoped annotation, also record the target's permanent internal id alongside the visible one (`_frUuid` for a `fr_bolsas` entry, `_uuid` for a `su_lotes` entry) — the visible `id` can be renamed later and would otherwise silently orphan the annotation.
3. Append the entry to `docs/lab-intelligence/anotaciones.md` (create the file with a one-line header if it doesn't exist) under today's date header, with the entry's own bullet prefixed by the current time (`HH:MM`) — see the format below.
4. **Cruce con hipótesis abiertas (solo lectura):** if the id/topic named matches an `abierta`/`en_investigación` hypothesis in the corresponding `docs/lab-intelligence/hipotesis/` file, mention it in the same confirmation message (e.g. "esto podría ser evidencia para HIP-FR-0002 — ¿la registro ahí?"). Never write to `hipotesis/` from this mode — only Modo hipótesis y preguntas does, and only on the user's explicit confirmation.
5. Done — do not touch `checkpoint.json` and do not run a full analysis pass; this is independent of the incremental/full-history cycle in Modo análisis.
```

- [ ] **Step 2a: Update the intro paragraph of "Anotaciones — formato"**

Old text (single paragraph, no fence markers involved):
```
Append-only timeline, same spirit as the notebook — never edit or delete an old entry; a correction is a new entry that says so.
```

New text:
```
Append-only timeline, same spirit as the notebook — never edit or delete an old entry; a correction is a new entry that says so. Each bullet carries its own `HH:MM` (local 24h time) so same-day entries can be ordered — added going forward only, existing historical entries without a time are left as-is rather than guessing one.
```

- [ ] **Step 2b: Add the time prefix to the two example bullets inside that same section's fenced block**

These two lines live inside the existing nested ```` ```markdown ... ``` ```` example in "Anotaciones — formato" — only the bullet text changes, the fence markers around them stay untouched.

Old text:
```
- **[FR245b · _frUuid 317881f0-010d-47d0-89bf-5e0e42e9073b]** texto de la anotación puntual...
- **[general/estacional]** texto de la anotación general...
```

New text:
```
- **14:32 · [FR245b · _frUuid 317881f0-010d-47d0-89bf-5e0e42e9073b]** texto de la anotación puntual...
- **09:05 · [general/estacional]** texto de la anotación general...
```

- [ ] **Step 3: Verify**

Run: `grep -n "HH:MM" .claude/skills/biolab-analyst/SKILL.md`
Expected: appears in both the Modo anotación step 3 description and the "Anotaciones — formato" example.

---

### Task 14: `SKILL.md` — "Which mode?" bullets + notebook timestamp + common mistakes

**Files:**
- Modify: `.claude/skills/biolab-analyst/SKILL.md` (the "Which mode?" bullet list, the notebook entry template header, and "Common mistakes")

- [ ] **Step 1: Update the two hypothesis-related "Which mode?" bullets**

Old text:
```markdown
- User shares research hypotheses, raises biological/chemical questions, or proposes conceptual experimental designs to follow up → **Modo hipótesis y preguntas**.
```
New text:
```markdown
- User shares research hypotheses, raises biological/chemical questions, proposes conceptual experimental designs, wants to log evidence for an existing hypothesis, or confirms one is answered → **Modo hipótesis y preguntas**.
```

Old text:
```markdown
- User asks about registered hypotheses or open questions (e.g. "¿qué hipótesis tenemos sobre X?") → read `hipotesis.md` and respond.
```
New text:
```markdown
- User asks about registered hypotheses or open questions (e.g. "¿qué hipótesis tenemos sobre X?") → read the relevant file(s) in `docs/lab-intelligence/hipotesis/` (see `index.md` for which one) and respond.
```

- [ ] **Step 2: Add `HH:MM` to the notebook entry template header**

This is the single header line inside the existing fenced example under "## Notebook entry template" — only this line changes, the surrounding fence markers and the rest of the template are untouched.

Old text:
```
## YYYY-MM-DD — incremental|full
```
New text:
```
## YYYY-MM-DD HH:MM — incremental|full
```

- [ ] **Step 3: Add new "Common mistakes" entries**

Old text (last 3 lines of "Common mistakes"):
```markdown
- Creating a new `MEJ-00XX` item instead of reinforcing an existing one — always read `mejoras_app.md` first.
- Auto-closing or auto-reopening a backlog item without the user's explicit confirmation.
- Running a broad code audit instead of reading just the one function implicated by the surprising finding.
```
New text:
```markdown
- Creating a new `MEJ-00XX` item instead of reinforcing an existing one — always read `mejoras_app.md` first.
- Auto-closing or auto-reopening a backlog item without the user's explicit confirmation.
- Running a broad code audit instead of reading just the one function implicated by the surprising finding.
- Writing to `docs/lab-intelligence/hipotesis/` from Modo análisis or Modo anotación instead of only suggesting — same single-writer discipline as the backlog, just for research questions instead of app bugs.
- Fabricating a `Registrada`/`Evidencia` time for an entry that never recorded one (migrated hypotheses, or any historical `notebook.md`/`anotaciones.md` entry from before the timestamp fix) — leave it date-only instead of guessing.
- Forgetting to regenerate `dashboard.html` after writing to `hipotesis/` — it goes stale silently otherwise.
```

- [ ] **Step 4: Verify**

Run: `grep -c "dashboard.html" .claude/skills/biolab-analyst/SKILL.md`
Expected: at least 3 (Modo hipótesis y preguntas step 8, the Dashboard — formato section, Common mistakes).

---

### Task 15: Update repo `CLAUDE.md` — CAPA DE INTELIGENCIA section

**Files:**
- Modify: `c:\Users\JET\Desktop\MOBY DICK\biolab-app\CLAUDE.md` (line 501)

- [ ] **Step 1: Replace the "Bitácora de Hipótesis" bullet**

Old text:
```markdown
*   **Bitácora de Hipótesis (`docs\lab-intelligence\hipotesis.md`):** SSoT de preguntas de investigación, hipótesis metabólicas y diseños de experimentos conceptuales ordenados por módulos del pipeline (GE/CI/CILAB, GR, SU, FR). Funciona como "capa 2" de inteligencia acumulada.
```

New text:
```markdown
*   **Bitácora de Hipótesis (`docs/lab-intelligence/hipotesis/`):** SSoT de preguntas de investigación, hipótesis metabólicas y diseños de experimentos conceptuales, un archivo por módulo del pipeline (`ge-ci-cilab.md`, `gr.md`, `su.md`, `fr.md`, `cross-modulo.md`, `experimentos-en-cola.md` + `index.md` con la convención). Cada hipótesis tiene un id estable (`HIP-<MOD>-00NN`) y un estado (`abierta`/`en_investigación`/`respondida`) — misma disciplina que el backlog de mejoras. Funciona como "capa 2" de inteligencia acumulada. Dashboard local autocontenido en `docs/lab-intelligence/dashboard.html` (nunca publicado — regenerado por el skill, no requiere servidor).
```

- [ ] **Step 2: Verify**

Run: `grep -n "Bitácora de Hipótesis" "c:/Users/JET/Desktop/MOBY DICK/biolab-app/CLAUDE.md"`
Expected: line now mentions `hipotesis/` (directory) and `dashboard.html`, no longer `hipotesis.md`.

---

### Task 16: Final verification sweep + commit

**Files:** none (verification + git only)

- [ ] **Step 1: Confirm no stale references to the old single-file path remain in active docs**

Run: `grep -rn "lab-intelligence/hipotesis.md" .claude CLAUDE.md docs/lab-intelligence 2>/dev/null`
Expected: no matches (Task 8-15 already fixed every live reference; the design spec and this plan itself, under `docs/superpowers/`, are historical record and intentionally untouched).

- [ ] **Step 2: Confirm the new directory has exactly the 7 expected files**

Run: `ls docs/lab-intelligence/hipotesis/`
Expected: `cross-modulo.md`, `experimentos-en-cola.md`, `fr.md`, `ge-ci-cilab.md`, `gr.md`, `index.md`, `su.md` — 7 files, `hipotesis.md` gone from the parent directory.

- [ ] **Step 3: Confirm SKILL.md frontmatter still parses (no stray unescaped triple-backtick from the nested code block in Task 11)**

Run: `sed -n '1,4p' .claude/skills/biolab-analyst/SKILL.md`
Expected: the `---\nname: biolab-analyst\ndescription: ...\n---` frontmatter block, unchanged and intact.

- [ ] **Step 4: Stage and commit**

```bash
git add .claude/skills/biolab-analyst/SKILL.md
git status --short
```
Expected: only `.claude/skills/biolab-analyst/SKILL.md` shows as staged (the repo `CLAUDE.md` and everything under `docs/lab-intelligence/` are both covered by `.gitignore` and correctly won't appear here — verify with `git check-ignore -v CLAUDE.md docs/lab-intelligence/hipotesis/index.md docs/lab-intelligence/dashboard.html` if unsure).

```bash
git commit -m "$(cat <<'EOF'
feat(biolab-analyst): sistema de hipotesis escalable por modulo + dashboard local

Split de hipotesis.md a docs/lab-intelligence/hipotesis/ (un archivo por
modulo, IDs HIP-<MOD>-00NN + estado abierta/en_investigacion/respondida).
Modo analisis/anotacion ganan cruce de solo-lectura contra hipotesis
abiertas sin romper el principio de un solo escritor. Fecha+hora en los
3 sistemas de bitacora. Dashboard HTML local autocontenido, regenerado
por el skill, nunca publicado.
EOF
)"
```

- [ ] **Step 5: Verify the commit**

Run: `git log --oneline -1 && git show --stat HEAD`
Expected: new commit touching only `SKILL.md`.

---

## Out of scope (reiterated from the design spec)

- No auto-populating `hipotesis/` from statistical patterns found during Modo análisis — deliberate single-writer rule.
- No per-question sub-IDs inside a hypothesis — granularity stays at the whole research-thread level.
- No fabricated timestamps for historical entries in any of the three logbook systems.
- No `mejoras_app.md`/`notebook.md` content in the dashboard this version, no charts, no filters/search.
- No "what should I be watching right now" mode tied to live CI/GR/SU/FR state — the user explicitly deferred this option during brainstorming.
