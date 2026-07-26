# Unificación de notas de seguimiento (CI / GR / SU / FR)

**Fecha:** 2026-07-26 (revisado el mismo día: 2° escritor de CI + ts sin año descubierto durante la preparación del plan, algoritmo de reconstrucción corregido y validado; SU.reNotas — código muerto — incorporado al alcance como limpieza)
**Estado:** aprobado, pendiente de plan de implementación

## 1. Problema

CI, GR, SU y FR tienen cada uno su propio sistema de "notas de seguimiento" (timeline de eventos con color/estado sobre un lote/bolsa/fórmula), implementado de forma independiente y con drift real:

| Módulo | Storage | Escritores | Shape real | Direccionamiento edit/del | Fotos |
|---|---|---|---|---|---|
| CI | `bl2_seg_notas[formulaId]` | **3 escritores**: `segAddNotaCard` (manual, `ci_app.js`, `.push()`), `segEmitirNotaAuto` (auto, `ci_app.js`, **`.unshift()`** — inserta al principio del array), `_creWriteAutoNota` (auto, `cilab_conocimiento.js:741` — CILAB escribe directo en storage de CI, documentado en CLAUDE.md como escritor compartido de esta key) | `ts`(locale — **2 formatos distintos, ver nota abajo**), `texto`, `estado`, `auto`, `imagenes[]`, `tandaId`, `_eventType` | índice de array | sí (build completo, 0 uso real) |
| GR | `gr_lotes[].seguimientoNotas` | 2 escritores: `grRegistrarSeguimiento` (auto) + `grAddSeguimientoNota` (manual, botón real en UI) | auto: `ts`(sin año), `tipo`, `texto`, `estado`. Manual: `ts`, `fechaHora`, `texto`, `estado`, `frascos`, `dias` — shapes distintos, sin `auto` en ninguno de los dos | índice de array | no |
| SU | `su_lotes[].dbSeguimiento` | auto + manual | `ts`(locale), `texto`, `estado`, `auto`, `tipo`(solo auto) | índice de array | no |
| FR | `fr_bolsas[].observaciones` | 1 escritor (`addObsTo`), agregar sí — **editar/borrar no existen en la UI** | `ts`(ISO), `tipo`('auto'\|'manual' — **mismo nombre de campo que GR/SU con otro significado**), `estado`, `dias`, `texto` | n/a | no |

CILAB Conocimiento (`bl2_crec_notas`) tiene un quinto sistema, ya mejor diseñado (id estable, no índice) pero con contexto de dominio propio (fase/cepa/experimento) y sin campo de color — **queda fuera de esta unificación** (ver sección 4).

**Restricción no negociable:** cada módulo sigue escribiendo a su propia key de `localStorage`. Se unifica el *shape* (campos/semántica) y las *capacidades de UI* (agregar/editar/borrar parejas en los 4), no el lugar donde vive el dato. Se mantiene el invariante "una key, un módulo escritor" que rige el resto de la app.

## 2. Evidencia empírica (no teoría)

Auditado contra 3 backups reales de producción (`biolab_full_backup - 24_07_2026_164135.json`, `- 25_07_2026_195558.json`, `- 25_07_2026_195558-anotado.json`). Total de notas reales en alcance: **758** (CI 192, GR 135 + 2 en el backup anotado, SU 87, FR 344).

Dry-run de la migración propuesta contra el backup del 25/07 — **cero ambigüedad en los 4 módulos:**
- GR: 135/135 notas clasifican sin ambigüedad como auto (tienen categoría reconocida `{inoculacion,contaminacion,colonizacion}` y ningún campo propio del escritor manual). El escritor manual nunca setea `tipo`, cero solapamiento posible.
- FR: 344/344 con `tipo` ∈ {`'auto'`,`'manual'`} exacto, sin valores inesperados — traducción a `auto:boolean` es 1:1 sin pérdida.
- CI: 189/192 notas ya tienen `_eventType`; las 3 restantes son manuales reales (`auto:false`), correctamente sin categoría. Cero colisión con un campo `tipo` preexistente.
- SU: 84 auto+tipo, 3 manual sin tipo — ya 100% consistente con el patrón esperado.

Se descartó como fuera de alcance un supuesto shape "fósil" de GR (`{tipo:'inoculacion'|'contaminacion'}` sin `ts`/`texto`/`estado`) — no aparece en ningún backup real disponible. Se confirmó en cambio un hallazgo real distinto: GR tiene **dos escritores activos** con shapes divergentes (ver tabla arriba), no uno solo como se asumió al principio.

**Segundo hallazgo real, en CI:** el campo `ts` de `bl2_seg_notas` tiene 2 formatos históricos, no uno:
- **Formato B** (148/192 notas): `DD/MM/YYYY, HH:MM a. m./p. m.` — con año. Producido por `segAddNotaCard` y `segEmitirNotaAuto` (ambos en `ci_app.js`, ambos vía `segTimestamp()`, que sí incluye `year`).
- **Formato A** (44/192 notas): `D/M HH:MM a. m./p. m.` — **sin año**. Producido exclusivamente por `_creWriteAutoNota` (`cilab_conocimiento.js:741`), cuyo `toLocaleString('es-AR', {day,month,hour,minute})` omite `year` a propósito. Todas las notas en formato A son auto-notas de CILAB (🏁/🔬/🐌/🏆 — creación de CRE, fases, score).

**Descubrimiento adicional que invalida un supuesto de diseño:** el array de `bl2_seg_notas[formulaId]` **no está en orden cronológico**, ni siquiera aproximado. `segEmitirNotaAuto` inserta con `arr.unshift(newNota)` (al principio, no al final), mientras que `segAddNotaCard` y `_creWriteAutoNota` usan `.push()` (al final). El resultado real es una mezcla: un bloque de eventos auto de CI en orden de inserción inverso (más nuevo primero) seguido de un bloque de notas manuales/CILAB en orden de inserción normal. Cualquier algoritmo de reconstrucción de `ts` que asuma "posición en el array = orden cronológico" (como interpolar con la nota vecina) es inválido para CI — se probó y dio 39/44 violaciones de orden al validarlo contra datos reales.

**Algoritmo correcto para el `ts` sin año de CI (validado):** igual principio que GR — anclar a una fecha real del contexto padre, **no** al momento de la migración y **no** encadenado entre notas (cada nota se resuelve de forma independiente, sin depender de sus vecinas en el array). El ancla es `bl2_forms[formulaId].fecha` (fecha de creación de la fórmula — siempre presente, siempre anterior a cualquier nota real sobre ella):
```
para cada nota con ts formato "D/M HH:MM a. m./p. m." (sin año) de la fórmula F:
  anchor = bl2_forms[F].fecha  (ISO, fallback a una fecha fija segura si F no resuelve)
  Y = year(anchor)
  candidato = Date(Y, MM, DD, HH, MM)  (con HH ya normalizada a 24h desde el sufijo a.m./p.m.)
  mientras candidato < anchor: Y += 1; recalcular candidato
  ts = candidato.toISOString(); tsLegacy = "<original>"; tsInferred = true
```
Validado contra las 44 notas reales de formato A: **44/44 resuelven sin ambigüedad a 2026**, cero conflicto. Formato B (con año) se parsea directo, con el mismo parser consciente de `a. m./p. m.` (ambos formatos usan 12h con sufijo en español, no 24h).

## 3. Shape unificado

```js
{
  id: string,            // NUEVO en CI/GR/SU/FR — estable, no-índice. Mismo principio que ya usa CILAB Conocimiento.
  ts: string,             // ISO 8601 real cuando se puede determinar con certeza
  tsLegacy: string|null,  // string original tal cual, SOLO presente en notas migradas donde el ts original no era ISO real. Nunca se descarta.
  tsInferred: boolean,    // true si el año de `ts` fue inferido (ver §5, GR). Nunca se esconde la incertidumbre.
  texto: string,
  estado: 'none'|'green'|'yellow'|'red',   // ya consistente en los 4 módulos hoy, sin cambios
  auto: boolean,          // flag explícito auto/manual, universal en los 4
  tipo: string|null,      // categoría de evento, SOLO tiene sentido cuando auto:true. Vocabulario PROPIO de cada módulo — no se fuerza un enum compartido (dominios distintos: GR ≠ CI)
  editedAt: string|null,  // ISO, seteado al editar manualmente — mismo patrón que ya usa CILAB
  imagenes: array,        // se mantiene por compatibilidad con CI (build completo existente). GR/SU/FR quedan siempre [] — no se construye UI de captura nueva en estos 3 (ver §6)
}
```

Campos de scoping propios de cada módulo (ej. `tandaId` en CI) conviven aparte del shape unificado, sin tocarse.

**Generación de `id`:** mismo principio que ya usan `cci_<base36>_<6hex>` (CI, cultivos) y `'lg'+Date.now()+rand` (CILAB, notas) — prefijo corto de 2 letras por módulo + timestamp base36 + 4 chars random, ej. `nt_ci_<ts36>_<r4>` / `nt_gr_...` / `nt_su_...` / `nt_fr_...`. No hace falta que sea globalmente único (cada array vive en su propia key), solo único dentro del array de notas de esa fórmula/lote/bolsa.

**Regla de diseño explícita (pedido del usuario):** se unifica el *rol* del campo `tipo` (= categoría de evento, siempre junto a `auto`), no sus *valores*. Cada módulo mantiene su propio vocabulario de categoría.

## 4. CILAB Conocimiento — por qué queda afuera

Evaluado y descartado del alcance de esta ronda:
- Ya usa `id` estable (no índice) — no tiene el problema estructural que motiva esta unificación en los otros 4.
- Nunca usa `estado`/color — no comparte esa semántica.
- Tiene contexto de dominio propio (fase, cepa, experimento/frasco) sin equivalente en CI/GR/SU/FR.
- Su nota manual libre (`creNotaEnviar`) existe en código pero tiene **0 casos reales** en producción — el 100% de las 166 notas reales de CILAB son logs automáticos de fase/score.

Meterlo forzaría trabajo sobre un archivo de ~6000 líneas (`cilab_conocimiento.js`) sin un problema real que resolver ahí. Candidato a una segunda ronda si en el futuro aparece necesidad concreta.

## 5. Migración por módulo

Patrón: un módulo, una migración one-shot con su propio flag (`biolab_migracion_notas_unificadas_<modulo>_v1`), corrida en el `init()` de cada módulo. **Flag-after-persist siempre** — nunca marcar el flag antes de confirmar el `localStorage.setItem` (lección ya aprendida en el proyecto, ver SU aditivos V1/V2 en `CLAUDE.md`). Sin try/catch propio alrededor de la mutación (para que un fallo real se propague al caller en vez de marcar el flag como si hubiera corrido bien).

### FR
`tipo:'auto'|'manual'` → `auto:true|false`. Se descarta el `tipo` viejo (dato ya trasladado 1:1, no se pierde nada). `ts` ya es ISO real — no toca `tsLegacy`/`tsInferred`. `id` nuevo generado para las 344 notas existentes.

### CI
`_eventType` → rename directo a `tipo` (solo en notas donde existe, i.e. notas auto). `auto` ya existe.

`ts` tiene 2 formatos reales (ver §2): formato B (con año, 148/192) se parsea directo con un parser propio consciente de `a. m./p. m.` (12h con sufijo en español — `Date.parse`/`new Date(string)` NO parsea este formato de forma confiable entre engines, hay que hand-parsear con regex). Formato A (sin año, 44/192, exclusivo de `_creWriteAutoNota` en `cilab_conocimiento.js`) se reconstruye anclando a `bl2_forms[formulaId].fecha`, **de forma independiente por nota, sin encadenar con la nota anterior en el array** — el array de `bl2_seg_notas[formulaId]` no está en orden cronológico (`segEmitirNotaAuto` usa `.unshift()`, los otros 2 escritores usan `.push()`, se mezclan sub-bloques con orden interno distinto). En ambos casos se preserva `tsLegacy` con el string original.

`id` nuevo generado, reemplaza el direccionamiento por índice actual en `segEditarNota`/`segEliminarSeguimientoNota`/`segVerImagenNota`/`segEliminarImagenNota`/`_segRefreshDrawersPorFormula`/`segPersistirNotas` (este último ya hace merge por clave `ts+texto` o `_eventType+tandaId` — pasa a mergear por `id`, más simple y más seguro, y deja de depender de que `ts+texto` sea único).

### SU
Ya tiene `auto`/`tipo` consistentes — solo se agrega `id` nuevo. `ts` (locale con año, `toLocaleString('es-ES', ...)`) se parsea a ISO igual que CI, con el mismo resguardo `tsLegacy`.

### GR — el caso con más trabajo real
Dos escritores a reconciliar en un solo shape:
- `grRegistrarSeguimiento` (auto): agrega `auto:true` (certeza empírica, ver §2). `tipo` ya es la categoría — sin cambios de valor.
- `grAddSeguimientoNota` (manual): agrega `auto:false`. No tiene categoría reconocida → `tipo:null`. Los campos propios `frascos`/`dias` de este escritor **se preservan tal cual** fuera del shape unificado (no se pierden, no entran en `tipo`/`auto`/`estado`/`texto`/`ts`/`id`).

**Reconstrucción de `ts` (el único punto realmente delicado):** el `ts` original de GR es `DD/MM HH:MM` — **sin año**. No se puede convertir a ISO real sin una ancla externa.

Algoritmo (ancla al `lote.fecha` del lote que contiene la nota, **no** a la fecha de corrida de la migración — esto es lo que se corrigió en la revisión de este diseño, porque anclar a "hoy" se rompe en cuanto la app tenga más de ~12 meses de historia):

```
para cada nota con ts formato "DD/MM HH:MM" dentro de lote L:
  anchor = L.fecha  (ISO, siempre presente en gr_lotes — confirmado, 15/15 lotes reales lo tienen)
  Y = year(anchor)
  candidato = Date(Y, MM, DD, HH, MM)
  mientras candidato < anchor:  (a lo sumo 1-2 iteraciones en la práctica)
    Y += 1
    candidato = Date(Y, MM, DD, HH, MM)
  ts = candidato.toISOString()
  tsLegacy = "<DD/MM HH:MM original>"
  tsInferred = true
```

Justificación: una nota de seguimiento siempre se registra en o después de la creación del lote (nunca antes) — por eso "año más chico tal que candidato ≥ lote.fecha" es la reconstrucción correcta, y a diferencia de anclar a la fecha de corrida del script, esta ancla no depende de cuándo se ejecuta la migración ni se degrada con el tiempo.

**Validado contra los 135 notas reales de GR (15 lotes):** 0 violaciones de orden monotónico dentro de cada lote (las notas migradas quedan en el mismo orden relativo que ya tenían en el array), fechas inferidas consistentes con `dg[].fechaInoculacion` de cada lote. Script de validación corrido, resultados verificados manualmente.

`id` nuevo generado para las 135 notas existentes (+ las del escritor manual si el usuario llegó a usarlo).

### Orden de ejecución sugerido
FR y SU primero (migraciones más simples, sin reconstrucción de fecha), después CI (rename + parseo de locale-con-año), GR al final (el único con reconstrucción de año inferido). Cada uno es independiente — no hay dependencia real entre migraciones de módulos distintos, es solo para hacer el rollout más fácil de revisar incrementalmente.

## 6. UI — qué falta para "capacidades parejas"

- **CI**: ya tiene agregar/editar/borrar completos. Solo migra el shape interno y pasa de índice a `id` en `segEditarNota`, `segGuardarEdicionNota`, `segEliminarSeguimientoNota`, `_segRefreshDrawersPorFormula`.
- **GR**: tiene agregar (x2 escritores) y borrar (`grEliminarSeguimientoNota`). **Falta editar** — se agrega inline, mismo patrón visual que ya usa CI (click en texto → `<input>` → guardar/cancelar).
- **SU**: mismo gap que GR — tiene agregar/borrar, falta editar. Mismo patrón.

**Hallazgo adicional en SU, incorporado al alcance:** existe un tercer sistema de notas, `SU.reNotas` (`su_app.js:171`, funciones `suAddReNota`/`suReRenderNotas`/`suReTimestamp`, persistido en `su_lotes[].reNotas`), completamente separado de `dbSeguimiento`. Confirmado código muerto: 0 registros reales en producción, y el HTML no tiene ninguno de los elementos que su JS busca (`#suReNotas`, `#suReNotaInput`, `#suReEstado` no existen en `su_index.html`) — no hay forma de dispararlo desde la UI. Se elimina como parte de este plan (mismo criterio ya aplicado en el proyecto con `ci_comparador.js`: código muerto confirmado, sin callers reales, se borra limpio en vez de dejarlo pudrirse).
- **FR**: solo tiene agregar (`FR.addObs`). **Faltan editar Y borrar** — hoy `renderObs` es de solo lectura. Se agregan ambos botones sobre `fr-log-row`, mismo patrón visual que CI/GR/SU.

No se propone unificar el *layout visual* (CI usa cards agrupadas por tanda, GR/SU/FR son listas planas por lote/bolsa) — eso es scope de UI que nadie pidió tocar. Se unifican los *campos* y las *3 acciones* (agregar/editar/borrar), no la arquitectura de agrupación de cada módulo.

## 7. Lectura defensiva (independiente de que la migración haya corrido)

Cualquier función de render/edit/delete debe tolerar una nota sin `id`/`estado`/`auto` sin romper — mismo gap ya documentado y ya mordido una vez en este proyecto (SU-aditivos: un import de JSON viejo después de que el flag one-shot ya quedó en `'1'` nunca vuelve a pasar por la migración). Fallbacks: `estado` ausente → `'none'`; `id` ausente → generarlo al vuelo en memoria al renderizar (no persistir solo, esperar a la próxima escritura real de esa nota para persistirlo); `texto` ausente → no debería poder pasar (todos los escritores actuales y futuros lo exigen), pero si aparece, renderizar `'(sin texto)'` en vez de reventar.

## 8. Explícitamente fuera de alcance

- CILAB Conocimiento (§4).
- Fotos en GR/SU/FR — el campo `imagenes` queda en el shape por compatibilidad con CI, pero no se construye UI de captura/preview/borrado nueva en los otros 3 (0 uso real de la feature existente en CI: 0/192 notas con foto).
- Enum compartido de categorías para `tipo` — cada módulo mantiene su propio vocabulario.
- Scoping nuevo (ej. notas por fila `dg`/`db` en vez de por lote completo en GR/SU) — no se pidió, no se agrega.

## 9. Riesgos conocidos

- La inferencia de año de GR es, por naturaleza, una inferencia — no una certeza matemática en el 100% de los casos teóricos (ej. un lote con más de 12 meses de vida y una nota registrada más de un año después de `lote.fecha` podría inferir mal). Mitigado con `tsInferred:true` + `tsLegacy` siempre preservado, para que el dato original nunca se pierda y sea auditable/corregible a mano si algún día se detecta un caso mal inferido.
- Migrar de índice-de-array a `id` en CI/GR/SU toca las funciones de edición/borrado existentes — requiere testing manual cuidadoso (no hay test suite automatizado en este proyecto) antes de dar por cerrada cada migración.
