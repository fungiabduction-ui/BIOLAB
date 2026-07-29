# biolab-analyst — correctness fixes (spec B)

## Contexto

Auditoría del 2026-07-28 sobre `.claude/skills/biolab-analyst/SKILL.md` y `docs/lab-intelligence/diff_backups.js` encontró 6 hallazgos de precisión (no de eficiencia — ver spec A, pendiente, para el problema de peso/contexto). Dos son errores objetivos ya confirmados contra el código real de la app; los otros cuatro son gaps de rigor en las propias instrucciones de la skill. Ninguno requiere tocar la app ni datos existentes — todos los cambios son a la skill y a su script auxiliar.

Fuera de alcance explícito: cualquier cosa relacionada a tamaño de `CLAUDE.md`/`BIOLAB_SYSTEM.md`, poda de `mejoras_app.md`/`notebook.md`/`anotaciones.md`, o límites de crecimiento — eso es spec A.

## Componentes

### 1. Modo avanzado — schema de notas nativas (SKILL.md, paso 3)

Hoy describe 4 shapes distintas por módulo (FR/SU/CI/GR), ninguna con `id` estable, marcadas "Corrected 2026-07-25". CLAUDE.md documenta desde 2026-07-26 un shape unificado real que reemplaza a las 4. Se actualiza el paso 3 para usar ese shape en los 4 casos:

```js
{
  id: "nt_<prefijo-2-letras-modulo>_<ts36>_<r4>",
  ts: "ISO 8601 real",
  tsLegacy: null,
  tsInferred: false,
  texto: "...",
  estado: "none|green|yellow|red",
  auto: false,
  tipo: null,          // solo si auto:true, vocabulario propio del módulo
  editedAt: null,
  imagenes: []          // CI puede tener contenido real; GR/SU/FR siempre []
}
```

Cada módulo sigue escribiendo a su propia key/array (`bl2_seg_notas[formulaId]`, `gr_lotes[].seguimientoNotas`, `su_lotes[].dbSeguimiento`, `fr_bolsas[].observaciones`) — la unificación es solo de forma del objeto, no de dónde vive. Los detalles por-módulo que siguen siendo reales (ej. `tandaId` en CI, `frascos`/`dias` en GR) se preservan como campos adicionales al shape base, igual que ya documenta CLAUDE.md.

### 2. Modo avanzado — referencia a función muerta (SKILL.md, paso 1)

`importAll()`/`cfg_app.js:492` → `importSystem()`/`cfg_app.js:169`. Confirmado en el código real que el comportamiento sigue siendo destructivo (`localStorage.clear()` salvo el token de GitHub, después repuebla) — la advertencia de "usar solo inmediatamente después de un export fresco" se mantiene sin cambios de fondo, solo se corrige el nombre/línea de la función referenciada.

### 3. Vocabulario de confianza (SKILL.md, overview + step 13 template)

Se agrega una restricción explícita donde hoy solo se menciona "alta/media/baja": el campo de confianza de un hallazgo es exactamente uno de esos tres valores, nunca un compuesto (`media-alta`, etc.). Cualquier matiz adicional va en el texto del hallazgo mismo, no en la etiqueta. Aplica solo hacia adelante — coherente con la disciplina append-only del resto de la skill (nunca se reescribe una entrada vieja de `notebook.md`).

### 4. Rigor de dedup simétrico — backlog e hipótesis (SKILL.md, paso 12 de Modo análisis y paso 3 de Modo hipótesis)

Antes de asignar un id nuevo (`MEJ-XXXX` o `HIP-<MOD>-XXXX`), se agrega un paso explícito: listar los items `abierta`/`reforzada` (backlog) o `abierta`/`en_investigación` (hipótesis) ya existentes en el archivo relevante, y justificar en una línea por qué ninguno matchea antes de crear uno nuevo. Hoy solo el backlog tenía disciplina de "matchear antes de crear"; se extiende el mismo criterio a hipótesis, que hoy no la tiene.

### 5. Guard de formato desconocido en `diff_backups.js`

`normalizeTopValue()` (línea ~100) trata cualquier string que falla `JSON.parse` como "un flag simple tipo '1'" sin distinguirlo de un tercer formato de export futuro que corrompa el parseo de una key grande — exactamente el tipo de fallo silencioso que ya pasó una vez (2026-07-28, formato GitHub Sync). Se agrega una constante con las keys que SIEMPRE deben terminar siendo objeto/array después de normalizar (`fr_bolsas`, `gr_lotes`, `su_lotes`, `bl2_crec`, `bl2_cultivos`, `bl2_seg`, `bl2_seg_notas`, `bl2_forms`, `bl2_ings`, `bl2_experimentos`, `bl2_crec_notas`, `bl2_crec_fases`, `bl2_inteligencia_model`, `bl2_formula_intel`, `fr_cal_intel`) — si alguna de esas keys sigue siendo string después de `normalizeTopValue`, se imprime un warning explícito (`⚠ <key> no pudo normalizarse a objeto/array — formato de export no reconocido, revisar a mano`) en vez de tratarla en silencio como si fuera un flag válido.

## Errores y edge cases

- El guard nuevo de `diff_backups.js` no debe disparar falsos positivos contra los dos formatos ya conocidos (local `exportSystem()` y GitHub Sync `ghBackup()`) — se verifica corriendo el script contra un par real de backups del repo antes de dar el cambio por bueno.
- El shape unificado de notas en Modo avanzado no cambia nada sobre backups ya generados por corridas anteriores de Modo avanzado (archivos `-anotado.json` viejos) — solo afecta reimport files generados de acá en adelante.

## Testing / verificación

No hay tests automatizados de la skill en sí (es un archivo de instrucciones, no código ejecutable). Verificación:
- `node docs/lab-intelligence/diff_backups.js` corrido contra los 2 backups reales más nuevos del repo — confirmar que el output no cambia para datos válidos y que el warning nuevo no aparece.
- Revisión manual línea por línea del shape de notas nuevo en Modo avanzado contra la sección "NOTAS DE SEGUIMIENTO — Shape unificado" de `CLAUDE.md` — deben coincidir campo a campo.
- Grep de `importAll` en el `SKILL.md` final — debe dar cero resultados.
