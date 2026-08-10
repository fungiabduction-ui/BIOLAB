# Skill `cilab-meta-inteligencia` — diseño

**Fecha:** 2026-08-06
**Contexto de origen:** sesión de trabajo sobre `CI-0013`/`CI-0014` (carbonato de calcio vs fosfato monopotásico, B-complex, velocidad de reactivación de biopsias de `Clon 320`). El usuario notó que la conversación ya tenía el patrón que quiere formalizar: investigar literatura real cuando el dato de la app no alcanza, y quedó la pregunta de dónde queda registrado ese conocimiento para no perderlo y, eventualmente, usarlo para mejorar el motor de inteligencia de CILAB.

---

## 1. Qué es

Skill nueva, **separada** de `biolab-analyst`, enfocada exclusivamente en CI (Cultivo In Vitro) y CILAB (Analizador/Conocimiento/Inteligencia/FI Engine). Objetivo declarado del usuario: **lograr hifas rizomórficas con patrones definidos y precisos** — no velocidad de colonización, no score genérico.

Se dispara por descripción, igual que el resto de las skills del repo — conversación sobre fórmulas CI, ingredientes, mecanismos metabólicos, o resultados de placas/frascos dispara la skill sin necesidad de invocación explícita.

**Diferencia clave con `biolab-analyst`:** ese skill arranca de un backup exportado (modo análisis por diff). Este arranca de la CONVERSACIÓN EN VIVO — el usuario cuenta lo que ve en el frasco/placa, como hoy, sin necesitar un export nuevo cada vez. Solo lee un backup para la auditoría inicial y cuando hace falta cruzar contra el estado real del motor (`bl2_ings`/`bl2_inteligencia_model`/`bl2_crec`).

## 2. Filosofía — separar velocidad de estructura, siempre

Regla dura, no negociable: **nunca reportar "creció rápido" como evidencia de rizomorfismo.** Todo hallazgo/proyección debe etiquetar explícitamente en cuál de los dos ejes está:

- **Velocidad/actividad metabólica general** — señal indirecta, interesante pero NO el objetivo (rutas tipo `N1_GLYC`, `N1_ETC` — glicólisis, cadena de transporte de electrones).
- **Estructura/morfogénesis rizomórfica** — el objetivo real (rutas tipo `N3_SPITZ` — organización del Spitzenkörper, y cualquier mecanismo de hidrofobinas/agregación de cordones hifales que aparezca en la investigación).

Parte del trabajo de la auditoría inicial (sección 5) es mapear qué rutas/ingredientes de `bl2_ings` caen en cada balde — hoy esa clasificación no existe explícita en ningún lado, hay que construirla leyendo el campo `mechanism` de cada ruta en `ROUTES` (`cilab_app.js`, ~líneas 50-286).

## 3. Postura experta — disciplina, no decoración

No es "actuá como micólogo" superficial. Es un conjunto de hábitos concretos y obligatorios:

1. **Literatura primero, siempre que haga falta.** Antes de aceptar el techo de lo que ya dice `bl2_ings[ingId].bio.mecanismo`, chequear si hay más profundidad posible. Antes de investigar, revisar `conocimiento_externo.md` (sección 6.2) — no repetir búsquedas ya hechas.
2. **Clasificar todo mecanismo nuevo** en el eje velocidad-metabólica vs estructura-morfogénica (sección 2) antes de opinar sobre si "ayuda".
3. **Separar explícitamente "esto lo prueba el dato" de "esta es mi lectura profesional/razonada"** — mismo principio que ya disciplina a `biolab-analyst`, heredado acá.
4. **Proponer hipótesis propias de forma activa**, no solo reactiva — si aparece un patrón raro en una auditoría o en la conversación, plantear una pregunta de investigación aunque el usuario no la haya pedido.
5. **Nunca fabricar mecanismo sin fuente.** Si no hay literatura real ni dato interno que lo sostenga, decirlo explícitamente en vez de inventar plausibilidad.

## 4. Modo auditoría inicial (bootstrap)

Corre la primera vez que se usa la skill, y de nuevo cuando el usuario lo pida explícitamente ("actualizá la auditoría del motor"). No es un checkpoint incremental complejo tipo `biolab-analyst` — el dataset es chico (decenas de ingredientes, ~60 `CRE` cerrados), así que se relee fresco cada vez que hace falta, sin sistema de diff propio.

Pasos:
1. Encontrar el backup más reciente disponible (repo root, o el más nuevo ya archivado en `docs/lab-intelligence/backups/` si no hay uno nuevo en la raíz — reusa la misma carpeta que `biolab-analyst`, no crea la suya propia).
2. Leer `bl2_ings` completo: para cada ingrediente con `bio.estado != 'sin_datos'`, registrar mecanismo documentado, `contribuciones`/`rutas`, `rangoOptimo`.
3. Leer `bl2_inteligencia_model`: coefs globales y por cepa, `confidence`, `ci90`, `bioConflict`.
4. Leer `bl2_crec`: para cada record cerrado, extraer `rizoPozitivas`/`totalPlacas` cuando exista (la señal empírica real de rizomorfismo).
5. Cruzar los tres: ingredientes cuyo mecanismo documentado sugiere rol estructural (Spitzenkörper, Ca²⁺, etc.) pero cuyo coef es negativo/`indeterminate`/contradictorio con lo documentado → candidatos directos a `conocimiento_externo.md` (gap a investigar) y potencialmente a `propuestas_motor.md`.
6. Escribir los hallazgos iniciales en ambos archivos (sección 6), con fecha, antes de empezar el modo conversación normal.
7. Marcar la auditoría como corrida (fecha simple en cabecera de `conocimiento_externo.md`, no un `checkpoint.json` separado — YAGNI, este dataset no lo necesita).

## 5. Modo conversación (uso normal, día a día)

El usuario cuenta un resultado nuevo (como hoy: "obtuve 21 gramos secos", "las placas con B-complex arrancaron antes"). La skill:
1. Cruza contra lo ya sabido (`conocimiento_externo.md`, `proyecciones.md`, y por lectura — nunca escritura — `hipotesis/ge-ci-cilab.md`/`mejoras_app.md`/`notebook.md` de `biolab-analyst`).
2. Si hace falta, dispara el loop de investigación externa (sección 6.2, condiciones de disparo).
3. Razona explícitamente separando velocidad de estructura (sección 2).
4. Si corresponde, registra o actualiza una entrada en `proyecciones.md` (sección 6.1) y/o `propuestas_motor.md` (sección 6.3).

## 6. Archivos (`docs/lab-intelligence/cilab-meta-inteligencia/`)

### 6.1 `proyecciones.md` — tracking de predicciones

El mecanismo central para poder algún día responder "¿nuestro entendimiento predice mejor que el motor de la app?".

Formato por entrada, id `PROY-00NN`:
```markdown
### PROY-0001 · fórmula: CI-0014 · estado: pendiente

**Registrada:** 2026-08-06 20:12

**Contexto:** qué se cambió en la fórmula y por qué (composición real, ids de ingrediente).

**Proyección:** qué esperamos en rizomorfismo (no velocidad) y con qué confianza — alta/media/baja, igual convención que biolab-analyst. Mecanismo + literatura + coefs OLS que la sostienen.

**Riesgos identificados:** qué podría hacer fallar la proyección (ej. "puede ser solo velocidad metabólica sin mejora estructural real").

**Veredicto:** (vacío hasta que el CRE real cierre)
```

Al cerrar: se compara la proyección contra `rizoPozitivas/totalPlacas` real del `CRE` correspondiente, se escribe el veredicto (`acertó`/`erró`/`parcial`, con el razonamiento) y `estado` pasa a `verificada`. Contador corriendo de aciertos/parciales/errores en la cabecera del archivo — la métrica concreta que el usuario pidió.

### 6.2 `conocimiento_externo.md` — biblioteca de literatura

Organizada por ingrediente/mecanismo, no por fórmula — reusable entre proyecciones distintas. Formato por entrada, id `EXT-00NN`:
```markdown
### EXT-0001 · tema: Carbonato de calcio — biomineralización de oxalato de calcio

**Investigado:** 2026-08-06

**Pregunta:** ¿por qué el carbonato de calcio retrasa el arranque de colonización?

**Hallazgos:** síntesis de lo encontrado, con matices (ej. "no es de *cubensis* directamente, es de 3 especies de Basidiomycota — extrapolación razonable, no prueba directa").

**Fuentes:** links reales.

**Aplicable a `bl2_ings`:** sí/no — si sí, qué campo (siempre `mecanismo`/notas, nunca `contribuciones`/`rutas` sin evidencia fuerte y confirmación explícita del usuario — ver sección 7).
```

Antes de cualquier búsqueda nueva, se revisa este archivo primero por el ingrediente/mecanismo en cuestión.

**Condiciones de disparo de investigación externa (no busca todo el tiempo):**
- Un hallazgo de laboratorio no coincide con lo que el mecanismo/coef ya documentado sugeriría.
- El usuario pregunta un "por qué" que los datos internos no responden solos.
- Se va a registrar una proyección nueva sobre un ingrediente/combinación sin cobertura todavía acá.

### 6.3 `propuestas_motor.md` — backlog de candidatos a cambio real en el motor

Mismo patrón de estados que `mejoras_app.md` de `biolab-analyst`, pero enfocado solo en cambios al motor de inteligencia (`bl2_ings.bio.contribuciones`/`rutas`, o algo más estructural en `cilab_inteligencia.js`/`cilab_formula_intelligence.js` si algún día lo amerita) — no se mezcla con bugs de UI.

Formato por entrada, id `PM-00NN`:
```markdown
### PM-0001 · estado: candidata

**Detectado:** fecha

**Propuesta:** qué cambio concreto se propone y en qué campo exacto.

**Evidencia:** lista de `PROY-00NN` verificadas + `EXT-00NN` que la sostienen. Antes de crear una nueva, chequear explícitamente contra las `candidata`/`lista para aplicar` ya existentes — mismo hábito anti-duplicado que `biolab-analyst`.

**Aplicada:** (vacío hasta que se confirme)
```

Estados: `candidata` (señal insuficiente todavía) → `lista para aplicar` (evidencia consistente — ej. 3+ `PROY` verificadas en la misma dirección, o coef `confidence:'alta'` que contradice el mecanismo documentado) → `aplicada` (el usuario confirmó y cargó el cambio, con fecha). **El salto a `aplicada` nunca es automático** — el skill junta y presenta la evidencia, la decisión final siempre es del usuario.

## 7. Qué puede tocar y qué no

Puede **proponer** texto nuevo para `bio.mecanismo`/notas de un ingrediente en `bl2_ings` (documentación, citando `conocimiento_externo.md`) — igual que se hizo hoy con el carbonato. **Nunca** toca `bio.contribuciones`/`bio.rutas` sin evidencia fuerte y confirmación explícita del usuario, porque eso alimenta directo el score real de la Analizador (INTOCABLE, `calcEstadoRutas`). No tiene acceso de escritura a la app en vivo (solo a backups) — deja el texto listo para pegar a mano, o el JSON para reimportar vía CILAB.

**Explícitamente fuera de alcance de este diseño:** cualquier código nuevo en la app (un motor de scoring paralelo, cambios a `cilab_inteligencia.js`, etc.). Si algún día `propuestas_motor.md` acumula evidencia suficiente para justificar algo así, es un proyecto aparte con su propio ciclo de brainstorming/spec/plan — no algo que esta skill haga por su cuenta.

## 8. Relación con `biolab-analyst`

Lee (nunca escribe) `hipotesis/ge-ci-cilab.md`, `mejoras_app.md`, `notebook.md`. Si algo amerita quedar registrado también ahí (una hipótesis de investigación más amplia, no ligada a una fórmula puntual, o un bug de código real), lo sugiere en conversación para que el usuario lo confirme vía `biolab-analyst` — mismo patrón de "un solo dueño por archivo" que ese skill ya usa internamente entre sus propios modos.

## 9. Convenciones heredadas de `biolab-analyst` (mantener consistencia)

- Confianza: exactamente `alta`/`media`/`baja`, nunca compuesta.
- Nunca tratar un coef OLS como causal — observacional, decirlo.
- IDs secuenciales con padding de 4 dígitos, mismo estilo que `PROY-`/`EXT-`/`PM-` de arriba.
- Timestamps `YYYY-MM-DD HH:MM` locales, sin fabricar hora si no se sabe.
