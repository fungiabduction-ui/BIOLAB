# Archivado de mejoras_app.md, hipotesis/ y anotaciones.md (spec C)

## Contexto

`biolab-analyst` escribe 3 archivos que crecen sin límite: `docs/lab-intelligence/mejoras_app.md` (85KB, 19 de 25 items ya `resuelta` con narrativa completa), `docs/lab-intelligence/hipotesis/*.md` (36KB, todavía sin items `respondida` pero mismo ciclo de vida que mejoras), y `docs/lab-intelligence/anotaciones.md` (35KB, timeline puro sin estado). A diferencia de la poda de `CLAUDE.md` (spec A, edición de una sola vez), acá el problema se repite cada vez que se cierra un item — necesita un mecanismo nuevo dentro de la skill, no solo una limpieza puntual.

**Costo real vs. costo aparente:** `anotaciones.md` (paso 8 de Modo análisis) y `mejoras_app.md` (paso 12) se leen enteros en CADA corrida — costo recurrente real. `hipotesis/` no se relee automáticamente en Modo análisis (solo se consulta para cruzar hallazgos, paso 10, lectura selectiva por archivo relevante), pero comparte el mismo problema estructural de fondo y el usuario pidió explícitamente extender el mismo mecanismo ahí antes de que pese.

**Fuera de alcance, decidido explícitamente:**
- `notebook.md` — la skill nunca lo relee (solo `Append` en el paso 13), no tiene el mismo costo recurrente. Sin cambios.
- `dashboard.html` — es el "libro humano" de consulta: debe seguir mostrando TODO sin resumir ni quitar nada, nunca. Spec C no cambia ese comportamiento, solo cambia de dónde saca el texto fuente (ver Componente 2).

## Mecanismo general

**Para `mejoras_app.md` e `hipotesis/` (tienen estado abierta→cerrada):** cuando un item pasa a `resuelta`/`respondida`, su contenido completo se MUEVE a un archivo histórico nuevo, y en el archivo activo queda un stub de 2 líneas (id + categoría/estado + 1 línea de descripción + puntero al archivo). El activo sigue teniendo **un renglón de cada item que existió alguna vez** — el chequeo de duplicados/regresiones (ya reforzado en spec B) sigue siendo completo y barato sin abrir el archivo. Solo si un hallazgo nuevo parece matchear un stub `resuelta`/`respondida`, se abre el archivo con grep puntual por ese id para traer el contexto completo.

**Para `anotaciones.md` (timeline puro, sin estado):** no hay evento de "esto cerró" que dispare el archivado automáticamente. Se agrega un modo nuevo, disparado explícitamente por el usuario, que mueve en bloque las entradas anteriores a una fecha de corte (confirmada con el usuario, no asumida) a un archivo histórico — sin resumir, ya son terse.

**Preguntas libres ("¿qué anoté sobre X?", "¿qué hipótesis tenemos sobre Y?", + una nueva para mejoras):** primero miran el archivo activo; si el tema/id no aparece ahí, greppean el archivo histórico correspondiente antes de responder "no hay nada" — nunca se corta la búsqueda en el activo solamente.

## Componentes

### 1. `mejoras_app.md` / `mejoras_app_archivo.md` (nuevo)

**Backfill ahora:** los 19 items `resuelta` existentes se migran completos a `mejoras_app_archivo.md`, dejando un stub en `mejoras_app.md` para cada uno. Formato del stub (reemplaza la entrada completa de un item resuelta):

```markdown
### MEJ-0007 · categoría: bug · estado: resuelta (YYYY-MM-DD)
**Descripción:** [primera línea de la descripción original]
**Detalle completo:** mejoras_app_archivo.md
```

El archivo `mejoras_app_archivo.md` recibe la entrada completa tal cual estaba (Detectado/Descripción/Evidencia/Resuelto), sin resumir, bajo el mismo formato `### MEJ-00XX · categoría · estado: resuelta` que ya usa el archivo activo hoy.

**Cambios en `SKILL.md`:**
- **"Confirmar resolución de un item del backlog"** (paso 2): en vez de solo cambiar `estado: resuelta` in-place, mueve la entrada completa a `mejoras_app_archivo.md` y deja el stub de 2 líneas en `mejoras_app.md`.
- **Modo análisis, paso 12 (backlog de mejoras):** aclarar que los items `resuelta` en `mejoras_app.md` son ahora stubs, no entradas completas — el paso de "listar abierta/reforzada antes de decidir" (spec B) sigue igual, pero la rama "matches un item ya resuelta → posible regresión" ahora requiere abrir `mejoras_app_archivo.md` con grep por ese `MEJ-00XX` puntual para escribir la nota de regresión con contexto real, no solo el stub.
- **Nueva pregunta libre:** "usuario pregunta sobre un bug/mejora pasada" → revisar `mejoras_app.md` (stub o activo), si hace falta el detalle completo greppear `mejoras_app_archivo.md`.

### 2. `hipotesis/archivo.md` (nuevo, archivo único combinado)

Sin backfill — hoy no hay ningún `HIP-` en estado `respondida`. Un solo archivo combinado (no uno por módulo) porque el id ya codifica el módulo (`HIP-<MOD>-00NN`) y el volumen esperado es bajo por un buen tiempo.

**Cambios en `SKILL.md`:**
- **Modo hipótesis y preguntas, paso 6 ("Marking a hypothesis answered")**: mueve la entrada completa (`Registrada`/`Contexto`/`Preguntas`/`Evidencia`/`Respondida`) al archivo, deja stub en el archivo de módulo original:
  ```markdown
  ### HIP-FR-0002 · estado: respondida (YYYY-MM-DD HH:MM)
  **Contexto:** [resumen corto]
  **Detalle completo:** hipotesis/archivo.md
  ```
- **"Dashboard — formato"**: la regeneración (full rewrite, sin cambios en esa disciplina) debe leer también `hipotesis/archivo.md` además de los 7 archivos de módulo — así las cards de `respondida` siguen apareciendo completas en el dashboard, con Contexto/Preguntas/Evidencia igual que hoy. El dashboard no cambia de comportamiento, solo de dónde lee.
- **"User asks about registered hypotheses"** (bullet de pregunta libre existente): extender a greppear `hipotesis/archivo.md` si el id/tema no aparece en el archivo de módulo activo.

### 3. `anotaciones.md` / `anotaciones_archivo.md` (nuevo)

**Nuevo modo — "Modo archivar anotaciones"** (disparado solo por pedido explícito del usuario, ej. "archivá las anotaciones viejas"):
1. Confirmar con el usuario la fecha de corte (proponer una por defecto — ej. "todo antes de hace 6 meses" — pero nunca asumir sin confirmación).
2. Mover en bloque las secciones `## YYYY-MM-DD` completas anteriores a esa fecha a `anotaciones_archivo.md`, en el mismo formato, sin resumir.
3. Confirmar al usuario cuántas entradas se movieron y el rango de fechas resultante en cada archivo.

**Cambios en `SKILL.md`:**
- **Modo análisis, paso 8 (check for existing user context)**: extender — si un hallazgo involucra un id/tema específico y no aparece en `anotaciones.md` activo, greppear `anotaciones_archivo.md` por ese id/tema antes de concluir que no hay contexto previo del usuario.
- **"User asks what's already been annotated about something"** (bullet de pregunta libre existente): mismo criterio, activo primero, archivo si hace falta.

## Edge cases

- **Un MEJ/HIP archivado que "reaparece"**: sigue el comportamiento actual (nunca se reabre automáticamente el item viejo — se crea uno nuevo si es una regresión real genuina, y la nota lo referencia). El archivado no cambia esta disciplina, solo dónde vive el texto del item viejo referenciado.
- **`mejoras_app_archivo.md`/`hipotesis/archivo.md`/`anotaciones_archivo.md`** quedan cubiertos por la exclusión de git existente (`docs/lab-intelligence/` completo en `.gitignore`) — no hace falta ningún cambio de `.gitignore`.
- **Backfill de los 19 MEJ**: dado el volumen (19 entradas con Evidencia de largo variable) y que el formato es mecánicamente regular (`### MEJ-00XX · categoría: X · estado: Y` como separador), la implementación puede evaluar un script Node de una sola pasada (lee `mejoras_app.md`, separa por estado, escribe ambos archivos) en vez de 19 ediciones manuales — decisión de la fase de plan, no de este spec.

## Testing / verificación

No hay tests automatizados (archivos de documentación/instrucciones). Verificación:
- Backfill: `grep -c "^### MEJ-" mejoras_app_archivo.md` → 19. `grep -c "estado: resuelta" mejoras_app.md` → 19 stubs (sin `**Evidencia:**` en ninguno). Diff manual de 2-3 items al azar entre el contenido archivado y lo que había antes, para confirmar cero pérdida.
- `grep -c "^### MEJ-\|^### HIP-" mejoras_app.md hipotesis/*.md` antes y después del backfill — el conteo total de items (activo + stub) no debe cambiar, solo su forma.
- Lectura completa de las secciones de `SKILL.md` tocadas — confirmar que cada modo que ahora escribe en 2 archivos (activo + histórico) lo hace en el orden correcto (histórico primero, para no perder datos si algo falla a mitad de camino — mismo criterio que ya usan las migraciones one-shot documentadas en `CLAUDE.md`).
