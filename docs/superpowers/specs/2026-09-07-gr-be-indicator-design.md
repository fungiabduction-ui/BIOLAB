# GR — Indicador de BE por protocolo + orden por BE en Registro

## Objetivo

Mostrar, por cada card de protocolo en GR — Registro, la Eficiencia Biológica (BE) agregada de
todas las bolsas FR que terminaron usando grano de ese lote — mismo tipo de indicador que ya
existe en SU (`_suBolsaBE`/`_suLoteBEStats`, "BE 355% total..."), pero a nivel de protocolo
completo (granularidad de GR es "tanda", no "bolsa individual" — no se replica el desglose
por-bolsa de SU). Además, agregar orden por BE al selector que ya existe en Registro.

100% lectura de `fr_bolsas`/`su_lotes` vía la traza GR→SU→FR. No escribe nada nuevo, no agrega
storage.

## Hallazgo clave — no hace falta escribir el join de nuevo

`gr_app.js` ya tiene `window.grComputarAnalisis(grLoteId)` (línea ~3806), usada hoy por el botón
"▶ Trazabilidad" de la card y por `grComputarKnowledge()` (tabla "Protocolos de Grano" de
Conocimiento). Ya hace el join correcto `gr_lotes → su_lotes → fr_bolsas` — incluyendo el caso
borde de bolsas con `grLoteId` `'Desconocido'`/ausente que igual están linkadas vía `su_lotes`
(bolsas legacy). Devuelve `{ fr: { bolsasTrackeadas, bePromedio, biomasaFrescaTotal,
biomasaSecaTotal, rendFrescoPorBolsa, oleadasTotal }, tandas: [...] }`.

**Decisión:** reutilizar `grComputarAnalisis` en vez de escribir un `_grBolsaBE`/`_grLoteBEStats`
nuevo que reimplemente el join de forma más simple (naive: filtrar `fr_bolsas` por
`b.grLoteId`/`grSources` directo) — esa versión más simple existe pero es estrictamente peor: no
cubre el caso `'Desconocido'` que la función real sí cubre, y duplicaría lógica de trazabilidad ya
correcta y en uso. Ya se llama en loop sobre todo `lotesData` desde `grComputarKnowledge()` — el
mismo patrón (loop por lote, un `grComputarAnalisis` por lote) ya es aceptado en este archivo para
listas de ~15-20 protocolos reales.

**Único campo que falta:** `beMejor` (BE de la bolsa individual con mejor resultado del lote) —
`grComputarAnalisis` ya calcula `beValues` internamente para promediar pero no expone el máximo.
Se agrega como campo nuevo en el objeto `fr` que ya retorna (`Math.max` sobre el mismo array que
ya usa para `bePromedio` — no se recalcula nada).

## Cambios

### 1. `grComputarAnalisis` — agregar `fr.beMejor`

Un campo más en el objeto que ya arma `{ bolsasTrackeadas, bePromedio, ... }` (línea ~3918):
`beMejor: beValues.length > 0 ? Math.max.apply(null, beValues) : 0`.

### 2. `grRenderizarRegistroLotes()` — mapa de análisis pre-construido

Mismo patrón que `_fMap`/`_cMap` (pre-build una vez por render pass, ya al principio de la
función): `_anMap[lote.id] = window.grComputarAnalisis(lote.id)` para cada lote válido. Se
construye antes del sort (el sort por BE lo necesita) y se reutiliza para el chip de la card (cero
recomputo).

### 3. Sort — 2 branches nuevas en el comparador que ya existe

`_grSortMode` ya soporta `fecha_desc|fecha_asc|id_asc|disp_desc|nombre` vía `grSetSort()`. Se
agregan `beProm`/`beMejor`, mismo criterio que el resto: leen del `_anMap`, lotes sin dato
utilizable (`bolsasTrackeadas === 0`) van al final (sentinel `-1`, nunca hay BE negativo real).

### 4. UI — 2 `<option>` nuevas en `#grSortSelect` (`gr_index.html`, ya existe, no se crea un
selector nuevo)

```html
<option value="beProm">BE promedio ↓</option>
<option value="beMejor">Mejor bolsa (BE) ↓</option>
```

### 5. Card — chip de BE en `.gr-card-stats-bar`

Junto a los chips de tandas/frascos/contaminación/disponibles que ya existen. Solo se muestra si
`bolsasTrackeadas > 0` (protocolo sin trazabilidad FR completa no muestra chip, no "BE 0%"
engañoso — mismo criterio que SU, que devuelve `null` en vez de 0 cuando no hay dato utilizable):

```
🏆 BE 187% prom · 🥇 245% mejor (3 bolsas)
```

## Fuera de alcance

- No se toca `_grFirmaProtocolo` ni `grComputarKnowledge`/tabla "Protocolos de Grano" — siguen
  usando `grComputarAnalisis` exactamente como antes, solo con un campo extra (`beMejor`) que no
  leen ni les afecta.
- No se replica el desglose por-bolsa (`beRowHtml` de SU, con estados contaminada/no-fructificó)
  — la granularidad de la card GR es protocolo/tanda, no bolsa individual. Ese detalle ya vive en
  FR/SU.
- No hay migración ni campo nuevo de storage — todo se deriva en vivo en cada render.
