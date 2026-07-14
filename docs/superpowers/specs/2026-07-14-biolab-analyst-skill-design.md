# Skill `biolab-analyst` — Bitácora de inteligencia de laboratorio Design

**Goal:** el usuario cultiva hongos y usa esta app para trazar todo el pipeline GE→CI→CILAB→GR→SU→FR. Los módulos ya calculan scores, OLS, route attribution y anomalías, pero nadie cruza esos outputs entre sí ni los traduce a lenguaje biológico accionable. Se crea un skill de proyecto, `biolab-analyst`, que lee un backup JSON exportado de la app, razona sobre el dataset completo como lo haría un biólogo/micólogo/data analyst senior, y deja constancia escrita — hallazgos, hipótesis, próximos experimentos, sugerencias de protocolo y de la app — en una bitácora markdown persistente y versionada en git.

**Alcance:** un skill nuevo (`.claude/skills/biolab-analyst/SKILL.md`) + dos artefactos de datos nuevos en `docs/lab-intelligence/` (`notebook.md`, `checkpoint.json`) + un fix de `.gitignore`. No se toca ningún módulo de la app (`ci/`, `cilab/`, `gr/`, `su/`, `fr/`, etc.) — el skill es puramente de lectura sobre un export, nunca escribe en `localStorage` ni en el código de la app.

---

## Por qué no hay un script de análisis mantenido

Se consideró (y se descartó) escribir un script Node/Python fijo que hiciera los joins cross-módulo y la estadística de forma determinística. Se descarta porque el schema de esta app cambia con frecuencia real, no hipotética — `CLAUDE.md`/`BIOLAB_SYSTEM.md` documentan cambios estructurales casi semanales en `bl2_crec`, `bl2_inteligencia_model`, `bl2_formula_intel` (delta substitution, synthetic records, bioConflict, ubiquity flags, etc.). Un script así se desactualizaría en semanas y produciría lecturas silenciosamente incorrectas — el peor resultado posible para un sistema que se supone da inteligencia confiable.

En cambio: **Claude lee el backup JSON crudo en cada corrida**, usando Python ad-hoc vía Bash solo para agregaciones puntuales (sumas, joins por id, filtros), y usa `CLAUDE.md`/`BIOLAB_SYSTEM.md` como contexto vivo para interpretar cada campo con su semántica real vigente al momento de la corrida. La aritmética es desechable; el razonamiento biológico y el conocimiento de los invariantes del sistema no se pueden enlatar en código sin que se pudra.

---

## Ubicación y artefactos

| Archivo | Rol |
|---|---|
| `.claude/skills/biolab-analyst/SKILL.md` | Definición del skill (frontmatter `name`/`description` + el checklist de proceso de este documento) |
| `docs/lab-intelligence/notebook.md` | Bitácora fechada, una entrada por corrida, orden cronológico (más vieja arriba, se agrega al final) |
| `docs/lab-intelligence/checkpoint.json` | Estado de la última corrida — qué se analizó, para poder calcular el diff incremental |

Los tres se crean/actualizan por el skill mismo. `notebook.md` y `checkpoint.json` se commitean al repo (dan valor solo si persisten y se versionan — es la bitácora del usuario).

### `.gitignore` — fix necesario, no opcional

El repo de código (`fungiabduction-ui/BIOLAB`) es público. `docs/lab-intelligence/` va a contener fórmulas, protocolos y resultados propietarios del usuario — mismo criterio que `CLAUDE.md`/`BIOLAB_SYSTEM.md`/`CHANGELOG.md`, que ya están excluidos por la misma razón. Además, ahora mismo `biolab-backup-*.json` (el input del skill) no está en `.gitignore` y quedaría expuesto ante un `git add -A` descuidado. Se agregan ambas exclusiones:

```gitignore
# Backups de datos exportados de la app — nunca al repo público
biolab-backup-*.json
biolab-ci-backup-*.json

# Bitácora de inteligencia de laboratorio — datos propietarios, nunca al repo público
docs/lab-intelligence/
```

---

## Fuente de datos

El backup JSON más reciente en la raíz del repo (`biolab-backup-*.json`, orden por el campo `_exported` interno del JSON, no por mtime del archivo — más confiable si el archivo se copia/mueve). Si no hay ninguno, o el más reciente tiene `_exported` de hace más de 7 días, el skill se lo dice al usuario y pide un export fresco desde CFG antes de continuar — nunca analiza con datos que sabe viejos sin avisar. El usuario puede optar por seguir igual con el dato viejo si así lo pide explícitamente.

---

## Flujo de una corrida

### Modo incremental (default)

1. Ubicar el backup más reciente (ver arriba).
2. Cargar `checkpoint.json`. Si no existe, esta es la primera corrida → tratar como full-history (sección siguiente) y crear el checkpoint al final.
3. Calcular el diff contra el checkpoint:
   - `bl2_crec`: records con `status:'cerrado'` cuyo `id` no estaba en el checkpoint.
   - `fr_bolsas`: bolsas con `cicloCerrado:true` cuyo `id`/`_frUuid` no estaba en el checkpoint.
   - `bl2_inteligencia_model.computedAt` / `bl2_formula_intel.computedAt`: si cambiaron respecto al checkpoint, el modelo se recalculó — comparar coefs/routeAttribution viejos vs nuevos si el checkpoint guardó snapshot suficiente (ver schema abajo).
   - `bl2_experimentos`: entradas nuevas por `id`.
   - `fr_cal_intel.anomalousBolsas` / `anomalyRanking`: entradas nuevas respecto al checkpoint.
   - Si el diff es vacío (nada nuevo desde la última corrida), informar eso y no crear entrada nueva en el notebook.
4. Para cada elemento nuevo del diff, reconstruir la cadena cross-módulo completa vía los ids compartidos: fórmula CI (`bl2_forms`/`formulaSnapshot`) → score teórico CILAB (Analizador) → protocolo GR (`gr_lotes`, componentes) → sustrato SU (`su_lotes`, aditivos/hidratación) → resultado FR (`fr_bolsas`, BE, `flush.calidad`, anomalías) — uniendo por `grLoteId`/`grTandaId`, `suLoteId`, `formulaId`, `geneticaId` según corresponda a cada registro.
5. Cruzar los hallazgos nuevos contra `bl2_ings[].bio.mecanismo` / `bio.contribuciones` / `bl2_formula_intel.routeAttribution` — traducir coeficientes OLS y señales de ruta a una lectura bioquímica real (qué cofactor/ruta metabólica está en juego), no solo reportar el número.
6. Señalar explícitamente, cuando el diff los toque:
   - Ingredientes con `confidence:'indeterminate'` o `bioConflict:true` en `bl2_inteligencia_model.coefs`.
   - Entradas de `bl2_formula_intel.experimentAdvice.topUncertainIngredients` que el nuevo dato podría resolver (o ya resolvió, si el `n` subió lo suficiente).
   - Anomalías nuevas en `fr_cal_intel` y una hipótesis causal tentativa (marcada explícitamente como correlacional si no hay forma de aislar causa).
7. Redactar la entrada nueva en `notebook.md` (formato abajo).
8. Actualizar `checkpoint.json` con el nuevo estado.

### Modo full-history (bajo pedido explícito)

El usuario lo pide en texto ("análisis completo", "revisá todo el historial") o invocando `/biolab-analyst full`. Repite los pasos 4-7 pero sobre el dataset completo, no solo el diff — pensado para patrones que solo emergen mirando el conjunto entero (ej. una correlación cross-módulo que con 10 registros no se ve pero con 40+ sí). No reemplaza al checkpoint incremental: al terminar, igual actualiza `checkpoint.json` como si fuera una corrida incremental normal, para que la siguiente corrida incremental parta de ahí.

---

## Formato de entrada del notebook

Cada corrida agrega una sección con fecha ISO y modo:

```markdown
## 2026-07-14 — incremental

**Qué cambió desde la última corrida:** 3 CRE nuevos cerrados (CI-0006, CI-0007, CI-0010), modelo OLS recalculado (computedAt 2026-06-07), 1 anomalía nueva en FR.

**Hallazgos:**
- [confianza alta] ...
- [confianza media/correlacional] ...
- [confianza baja / n insuficiente] ...

**Hipótesis a probar / próximos experimentos:**
- Sugerencia concreta, apoyada en `bl2_experimentos` (diseño A/B con frasco control), apuntando a reducir la incertidumbre de un ingrediente puntual de `topUncertainIngredients` o a confirmar una anomalía de `fr_cal_intel`.

**Sugerencias de protocolo:**
- ...

**Sugerencias para la app:**
- ...
```

Las secciones "Hipótesis" y "Sugerencias" pueden venir vacías con una nota explícita ("nada nuevo que sugerir esta corrida") en vez de forzar contenido — no se rellena por rellenar.

---

## Schema de `checkpoint.json`

```json
{
  "lastRunAt": "2026-07-14T12:00:00.000Z",
  "lastRunMode": "incremental",
  "sourceBackupExportedAt": "2026-07-14T05:20:00.000Z",
  "creClosedIds": ["CRE-0001", "..."],
  "frClosedIds": ["FR44", "..."],
  "inteligenciaModelComputedAt": "2026-06-07T20:50:35.268Z",
  "formulaIntelComputedAt": "2026-06-01T22:13:31.069Z",
  "experimentoIds": ["EXP-0001", "..."],
  "anomalousBolsaIds": ["FR164l", "..."]
}
```

Solo guarda ids/timestamps de referencia para el diff — no duplica datos del backup. Si el usuario borra un record que estaba en el checkpoint (dataset se achicó), el skill lo reporta como advertencia en vez de fallar o asumir.

---

## Manejo de errores

- No hay backup en el repo → avisa y no corre.
- Backup no parsea como JSON o le faltan keys esperadas (`bl2_crec`, `fr_bolsas`, etc.) → avisa cuál falta, no improvisa con datos parciales.
- `checkpoint.json` referencia ids que ya no existen en el backup actual → lo reporta explícitamente en la entrada del notebook ("N registros del checkpoint anterior ya no están en el dataset — ¿se borraron a propósito?"), no lo trata como diff negativo silencioso.

---

## Fuera de alcance

- No hay pull automático desde GitHub (`BIOLAB-DATA`) — el usuario decidió backup manual únicamente.
- No hay dashboard visual (Artifact) en esta primera versión — el entregable es texto/markdown. Puede agregarse después como un modo adicional del mismo skill, no como reemplazo.
- El skill no escribe nunca en el código de la app ni en ningún módulo — es de solo lectura sobre el export.
- No hay automatización/cron — se invoca a demanda (`/biolab-analyst`).

---

## Extensión — Anotaciones del usuario + lectura de notas nativas existentes (2026-07-14, misma sesión)

**Goal:** después de leer una entrada del notebook, el usuario quiere poder corregir o contextualizar un hallazgo en la conversación normal (ej. "las deformaciones de esta bolsa son por frío, no por el aditivo — no hay forma de medir temperatura en el lab") y que quede grabado permanentemente, se tenga en cuenta en corridas futuras, y — de encontrarse relevante — se pueda hasta llevar de vuelta a la app misma. Auditando el código antes de diseñar nada nuevo: **la app ya tiene un mecanismo nativo de notas manuales que el skill simplemente no estaba leyendo** — `FR.addObs()` (`fr/fr_app.js:3435`, escribe a `fr_bolsas[].observaciones` con `tipo:'manual'`) y `SU.dbSeguimientoNotas` (`su/su_app.js`, escribe a `su_lotes[].dbSeguimiento`). El caso real que motivó esto (la nota roja sobre un grano sospechoso de GR25B) ya estaba en el backup, en ese campo, sin que el skill la mirara.

### Nuevo archivo: `docs/lab-intelligence/anotaciones.md`

Timeline append-only — igual que `notebook.md`, nunca se edita ni borra una entrada vieja; una corrección es una entrada nueva que lo dice. Formato:

```markdown
## 2026-07-14
- **[FR245b]** Las deformaciones se atribuyen en el modelo a un aditivo del sustrato de expansión, pero el usuario cree que la causa real es frío ambiente (no hay forma de medir/loggear temperatura en el lab actualmente).
- **[general/estacional]** En meses como septiembre las anomalías de crecimiento prácticamente desaparecen. Hipótesis del usuario: temperatura subóptima en meses fríos — el aire acondicionado no reemplaza el calor de una estufa real.
```

Tag de alcance: un id real y existente en el backup más reciente (`FR...`, `CI-...`, `ING-...`, `GR...`, `SU...`) o `general/<tema-corto>` para patrones que no cuelgan de un id puntual (como el estacional — ninguno de los dos mecanismos nativos de la app tiene un lugar para esto, ver "Fuera de alcance" de esta extensión).

### Modo anotación (nuevo, dentro del mismo skill)

Disparado por el usuario comentando una corrección/observación en la conversación normal — **no** un comando fijo. El skill:
1. Confirma en una línea qué va a guardar antes de escribir (paráfrasis corta).
2. Determina el tag: id puntual si el usuario lo nombra y existe en el backup más reciente. Si el usuario nombra un id que no aparece en el backup (typo u otro motivo), lo dice explícitamente y pregunta en vez de adivinar o guardar igual con un id inválido. Si no hay id puntual en juego, usa `general/<tema>`.
3. Agrega la entrada a `docs/lab-intelligence/anotaciones.md` con la fecha de hoy.
4. No toca `checkpoint.json` ni dispara un análisis completo — operación independiente y rápida, no pasa por el flujo incremental/full-history del modo análisis.

### Modo análisis (existente) — extendido

Antes de reportar cada hallazgo nuevo en el modo análisis, el skill ahora también:
- Lee `docs/lab-intelligence/anotaciones.md` si existe.
- Para las bolsas/lotes dentro del alcance de la corrida, escanea `fr_bolsas[].observaciones` (entradas con `tipo:'manual'`) y `su_lotes[].dbSeguimiento` (entradas no automáticas) — mismo estatus que una anotación del archivo markdown, es la misma categoría de "contexto del usuario", solo que ya vivía en la app.
- Si algo de lo anterior es relevante a un hallazgo nuevo (mismo id, o un patrón `general/*` cuya ventana temporal se solapa), lo menciona junto al hallazgo ("el modelo atribuye X a Y, pero hay una nota tuya de [fecha] que sugiere Z"). Nunca ajusta la confianza estadística del hallazgo por esto — sigue siendo contexto adicional, no una anulación (invariante ya establecido en la sección principal de este spec).

### Modo avanzado opcional — preparar reimport a la app (usar con cuidado)

Solo bajo pedido explícito del usuario en la conversación, nunca automático ni parte del flujo normal de análisis/anotación.

1. **Advertencia obligatoria cada vez que se invoca:** `CFG → Importar todo` (`cfg_app.js:492`) hace `localStorage.clear()` y repuebla TODO desde el archivo — cualquier cambio hecho en la app viva después del backup usado como base para preparar el archivo se pierde al importar. Recomendación explícita: usar esto solo inmediatamente después de un export fresco, sin tocar la app en el medio.
2. Si el usuario confirma que quiere seguir, y la anotación tiene alcance puntual (atada a un id real de `fr_bolsas` o `su_lotes`): agrega una entrada nueva en la forma nativa exacta que la propia UI ya produce — `fr_bolsas[].observaciones` (`{ts, tipo:'manual', estado, dias, texto}`, mismo shape que escribe `FR.addObs()`) o `su_lotes[].dbSeguimiento` (mismo shape que `SU.dbSeguimientoNotas`) — para que, una vez importado, la nota aparezca en la timeline nativa de esa bolsa/lote dentro de la propia app, no en un campo nuevo invisible para la UI existente.
3. **No aplica a anotaciones de alcance `general/*`** — no hay un lugar nativo en el schema actual de la app para una nota que no cuelgue de una bolsa/lote puntual (ver Fuera de alcance).
4. El resultado se escribe en un archivo NUEVO, claramente distinto del original (ej. `<nombre-del-backup-original>-anotado.json`, mismo directorio) — nunca se sobreescribe el backup original del usuario.
5. El skill nunca ejecuta el import — solo prepara el archivo. El usuario decide cuándo, o si, abrir CFG y usarlo, en su propio navegador, a su propio criterio.
6. Edición del JSON (~1MB+): se hace con un script ad-hoc de una sola pasada (python/node vía Bash) que parsea, agrega el objeto al array correspondiente, y vuelca de nuevo — nunca edición de texto directa sobre el JSON crudo (riesgo real de corromper un archivo de ese tamaño a mano). Mismo criterio que el resto del skill: sin script mantenido en el repo.

### Fuera de alcance (extensión)

- Sin "bitácora general" nativa dentro de la app para notas no atadas a un id — queda documentado como sugerencia de mejora de producto a futuro (necesitaría su propio diseño), no se construye ahora.
- El modo de reimport no soporta anotaciones de alcance `general/*` (ver arriba).
- Sin mecanismo de deshacer/editar una anotación ya escrita — mismo principio append-only que `notebook.md`: una corrección es una entrada nueva, no una edición de la vieja.
- El skill nunca ejecuta el import él mismo, bajo ninguna circunstancia — es una acción manual del usuario, en su navegador, siempre.

---

## Extensión — Diagnóstico experto + backlog de mejoras a la app (2026-07-14, misma sesión)

**Goal:** el usuario quiere que el skill dé conclusiones al estilo de un micólogo/biotecnólogo real (un veredicto, no solo una correlación con nivel de confianza) y que las sugerencias de mejora a la app dejen de ser hallazgos sueltos que se pierden en el historial del notebook — que se acumulen, se refuercen con evidencia nueva, y se puedan marcar resueltas.

### 1. Diagnóstico experto

Nueva subsección del template de entrada del notebook (Modo análisis), ubicada entre `**Hallazgos:**` y `**Hipótesis a probar / próximos experimentos:**`:

```markdown
**Diagnóstico experto:**
...
```

Solo se incluye cuando hay algo real que sintetizar sobre lo que está en el alcance de esa corrida — mismo criterio que las demás secciones ("nada nuevo que reportar" en vez de forzar contenido). No es una sección más de hallazgos: sintetiza los `Hallazgos` de esa misma entrada + `bl2_ings[].bio.mecanismo`/`bio.contribuciones` + conocimiento general de micología/biotecnología en una conclusión con el tono de un profesional dando su lectura de caso — no una repetición de "coef X, confianza Y".

**Regla de seguridad epistémica (no negociable):** el Diagnóstico experto puede ser asertivo en el tono, pero nunca puede afirmar como hecho algo que el dato marca como incierto (`confidence:'indeterminate'`, `n` bajo, `bioConflict:true`). En esos casos razona *a través* de la incertidumbre, no alrededor de ella — ej. "con n=8 no se puede confirmar estadísticamente, pero el mecanismo conocido de X es consistente con esta lectura, y es lo que yo priorizaría investigar primero". Cada entrada de Diagnóstico experto distingue explícitamente, en el texto, qué parte es "esto lo prueba el dato" vs. "esta es mi lectura profesional" — nunca se mezclan sin aclarar cuál es cuál.

### 2. Backlog de mejoras a la app (`docs/lab-intelligence/mejoras_app.md`)

Archivo nuevo — a diferencia de `notebook.md`/`anotaciones.md` (append-only, puramente cronológicos), este es una **lista viva con estado**, porque su utilidad central es poder ver de un vistazo qué sigue pendiente y qué tan respaldado está.

**Formato por item:**
```markdown
### MEJ-0001 · categoría: bug|dato-faltante|feature|ux · estado: abierta

**Detectado:** 2026-07-14
**Descripción:** ...
**Evidencia:**
- 2026-07-14: hallazgo/contexto que lo originó
**Resuelto:** (vacío hasta que se confirme)
```

IDs secuenciales `MEJ-0001`, `MEJ-0002`... (mismo padding de 4 dígitos que `ING-`/`CRE-`/etc.).

**Estados y transiciones:**
- `abierta` — recién detectado, un solo caso de evidencia. Se crea automáticamente cuando Modo análisis (o el Diagnóstico experto) encuentra algo sugerible para la app que no coincide con ningún item existente del backlog.
- `reforzada` — 2+ casos de evidencia acumulada. Transición automática (sin intervención del usuario) en el momento en que se agrega una segunda entrada a `Evidencia`: el skill relee `mejoras_app.md` antes de escribir una sugerencia nueva y, si el patrón coincide con un item `abierta`/`reforzada` existente (coincidencia por lectura/criterio del skill, no un matcher algorítmico — mismo enfoque que el resto de este skill), agrega una línea a `Evidencia` con la fecha y el hallazgo nuevo, en vez de crear un item duplicado.
- `resuelta` — **solo** por confirmación explícita del usuario en conversación (mismo patrón que Modo anotación: el usuario dice algo como "eso del bioConflict ya lo arreglé" y el skill actualiza el item con `estado: resuelta` + fecha + una línea `Resuelto:` citando la confirmación). El skill puede *sugerir* que un item parece resuelto (ver abajo) pero nunca cambia el estado a `resuelta` por su cuenta.

**Señal de "esto podría estar resuelto" (soft signal, no autocierre):** en Modo análisis, si un item `abierta`/`reforzada` describía un patrón que debería haber vuelto a aparecer en el alcance de la corrida actual y no apareció, el skill lo menciona en `**Sugerencias para la app:**` de esa entrada del notebook ("MEJ-0003 no reapareció en esta corrida — ¿ya se corrigió?"), pero no toca `mejoras_app.md` hasta que el usuario confirme.

**Regresión de un item ya resuelto:** si un item con `estado: resuelta` vuelve a coincidir con un patrón nuevo, el skill NO lo reabre por su cuenta — lo flaguea explícitamente como posible regresión en `**Sugerencias para la app:**` del notebook ("MEJ-0002 estaba marcada resuelta el [fecha], pero este hallazgo nuevo parece el mismo patrón — ¿regresión o caso distinto?") y agrega la observación a la sección `Evidencia` del item sin cambiar su `estado`. El usuario decide si reabrirlo (lo que sí requiere su confirmación explícita, igual que cerrarlo).

**Conexión con `**Sugerencias para la app:**` del notebook:** cada entrada de esa sección, en cada corrida, referencia el id del backlog correspondiente — `(nuevo → MEJ-0004)` o `(refuerza MEJ-0001, ver mejoras_app.md)` — en vez de listar la sugerencia como si fuera aislada de las corridas anteriores.

### 3. Heurística — revisar código fuente ante un hallazgo inesperado

Nuevo paso dentro de Modo análisis: cuando un hallazgo contradice un invariante documentado en `CLAUDE.md`/`BIOLAB_SYSTEM.md`, o algo que debería variar según la lógica esperada pero no varía nunca en todo el dataset en alcance (el caso real que ya se dio: `bioConflict` nunca era `true` para ningún ingrediente, pese a haber candidatos claros) — el skill lee la función real involucrada en el código fuente antes de concluir, en vez de reportar solo la rareza estadística sin explicarla. Si esa lectura confirma un bug real, se convierte automáticamente en un item nuevo (o refuerzo de uno existente) del backlog, categoría `bug`.

Esta heurística no dispara una auditoría completa de ningún módulo — se activa puntualmente sobre la función específica implicada en el hallazgo que no cierra, igual que se hizo con `cilab_inteligencia.js` en la sesión anterior.

### 4. Diagnóstico experto → backlog

Cuando el Diagnóstico experto llega a una conclusión que la app hoy no puede verificar por falta de un campo/dato/UI (ej. una hipótesis biológica que requeriría trackear una variable que no existe en el schema), eso también entra al backlog — mismo flujo de dedup/refuerzo que el punto 2, categoría típica `dato-faltante` o `feature`.

### Fuera de alcance (extensión Diagnóstico + backlog)

- El Diagnóstico experto no reemplaza ni resume los `Hallazgos` data-driven de la misma entrada — es una capa adicional de síntesis, no un sustituto.
- El backlog nunca se auto-cierra ni se auto-reabre — ambas transiciones requieren confirmación explícita del usuario en conversación.
- La coincidencia entre un hallazgo nuevo y un item existente del backlog es un juicio del skill al releer el archivo, no un algoritmo de matching determinístico — consistente con la decisión original de no mantener un script de análisis para este skill.
- La heurística de revisar código fuente no incluye ningún mecanismo para que el skill modifique ese código — solo lo lee y lo documenta como item del backlog. Aplicar el fix sigue siendo una tarea de programación aparte (con su propio plan/revisión), como ya se hizo con el fix de `bioConflict`.
