# GR — Color por protocolo (lote) + propagación a chips en FR/SU

## Problema

En GR — Registro (`gr_index.html:21`, tab `reg`), cada lote registrado (lo que el propio
módulo llama "protocolo" — `GR.protoCerrado`, "El protocolo está cerrado", `gr_app.js:3341`)
se renderiza como una card (`gr-reg-card`, `grRenderizarRegistroLotes`, `gr_app.js:1094-1255`)
visualmente idéntica a las demás salvo por ID/fecha/estadísticas. Con varios protocolos activos
en paralelo no hay forma rápida de diferenciarlos a simple vista, ni en Registro ni en los
chips que otros módulos (FR, SU) muestran cuando referencian ese lote.

## Objetivo

Asignar un color por protocolo (lote GR), automático por default pero editable a mano, y
usarlo para teñir levemente: (1) la card del protocolo en GR — Registro, (2) el chip de
referencia GR en FR (`<span class="fr-traza">GR304 · GRT274B</span>`), (3) el chip de tanda GR
en la columna GRANO de SU — Registro. Ningún otro módulo cambia de comportamiento.

## Modelo de datos

Campo nuevo `color` (string hex `#rrggbb` o `null`) en cada objeto de `gr_lotes`
(`STORAGE_KEY = 'gr_lotes'`, `gr_app.js:15`). Aditivo — lotes existentes sin el campo siguen
siendo válidos, se tratan como "sin color" (card/chip neutros) hasta que se guarden de nuevo o
se les asigne color desde la card.

**Actualización (2026-09-06, mismo día):** la decisión original de esta sección era "sin
migración retroactiva" — revertida a pedido explícito del usuario apenas se detectó que ya
tenía 17 lotes reales guardados sin color. `_grMigrarColorBackfillV1()` (`gr_app.js`, mismo
patrón one-shot que las demás migraciones de este archivo) colorea todo lote sin `.color`,
ordenado por `fecha` ascendente, vía `_grNextAutoColor()`. Detalle completo: ver "Cuándo se
asigna" más abajo y la entrada de CLAUDE.md del mismo día.

Key nueva `gr_color_seq` — contador entero (string numérica), independiente de `gr_lotes`. Ver
regla de asignación abajo.

## Paleta y regla de asignación automática

Paleta fija de 12 colores (validada visualmente con el usuario, ver mockup de brainstorming),
usada como **cola rotativa** — no como mapa mes→color (se descartó esa idea: ataría todos los
protocolos de un mismo mes al mismo color, matando la diferenciación entre ellos):

```js
var GR_COLOR_PALETTE = [
    '#EF6C57', '#F2A93C', '#C6D94D', '#52B788', '#2FB6A6', '#3FA9DB',
    '#5C7CE0', '#8B6CE3', '#C15FCB', '#E0568F', '#B0785A', '#6E8894'
];
```

`_grNextAutoColor()` (nuevo, `gr_app.js`, cerca de `STORAGE_KEY`):
1. Lee `gr_color_seq` de localStorage, `parseInt(...) || 0`.
2. Devuelve `GR_COLOR_PALETTE[idx % 12]`.
3. Escribe `idx + 1` en `gr_color_seq`.

Se invoca **solo** cuando un protocolo se guarda por primera vez sin color (ver "Cuándo se
asigna" abajo) — nunca en render, nunca especulativamente. Un color elegido a mano por el
usuario **no** consume la cola (el contador solo avanza en el camino automático) — es la
resolución explícita a la preocupación de colisión planteada en brainstorming: como el picker
manual admite cualquier hex (no solo los 12 de la paleta), no hay forma de garantizar cero
colisión contra manual de todas formas; la cola solo se ocupa de que los autoasignados nunca se
repitan entre sí en protocolos cercanos en el tiempo.

## Cuándo se asigna — `guardarLote()`, NO `recolectarDatosLote()`

**Nota (2026-09-06, corregido durante implementación de Task 2):** el diseño original de esta
sección proponía resolver el color dentro de `recolectarDatosLote()`. Se descartó en code
review: esa función también la llama `updateUnidadFisica()` — un preview que corre en cada
keystroke de los campos UF, en `GR.init()`, y dos veces dentro de `cargarDatosLote()` — y
ninguno de esos caminos persiste nada. Resolver color ahí adentro hacía que `_grNextAutoColor()`
quemara la cola rotativa en cada uno de esos casos, tirando el color generado a la basura. La
resolución real vive en `guardarLote()` — el único boundary de persistencia real para
`gr_lotes` — inmediatamente antes de la mutación final, después del gate de consumo CI (para
que un guardado rechazado tampoco consuma cola):

```js
var _colorInput = document.getElementById('loteColor');
var _colorManual = _colorInput && _colorInput.dataset.manualEdit === 'true';
lote.color = (function() {
    if (indiceExistente >= 0 && lotesData[indiceExistente].color && !_colorManual) {
        return lotesData[indiceExistente].color;   // ya asignado, no se toca
    }
    if (_colorManual && _colorInput) {
        return _colorInput.value;                   // elegido a mano en este form
    }
    return _grNextAutoColor();                       // nuevo o sin color previo → siguiente de la cola
})();

if (indiceExistente >= 0) {
    lotesData[indiceExistente] = lote;
} else {
    lotesData.push(lote);
}
```

Esto cubre los 3 casos: protocolo ya coloreado que se re-guarda sin tocar el picker (se
preserva, cero consumo de cola); protocolo nuevo o histórico-sin-color guardado tal cual (se
autoasigna, consume cola); color cambiado a mano en el form, sea protocolo nuevo o existente
(se usa el valor del input, sin tocar la cola). `recolectarDatosLote()` queda sin tocar — no
calcula ni devuelve `color`, es puro lectura-de-form como antes de este feature.

## UI — Formulación (`gr_index.html`, sección "Datos del Lote", `gr_index.html:66-98`)

Nuevo `form-group` junto a Versión (después de `gr_index.html:91-95`):

```html
<div class="form-group">
    <label for="loteColor">Color</label>
    <input type="color" id="loteColor" value="#FFD700"
        style="opacity:0.7" class="gr-color-input"
        oninput="this.dataset.manualEdit='true';this.style.opacity='1';"
        title="Se asigna automáticamente al guardar. Elegí uno para fijarlo a mano.">
</div>
```

Mismo patrón exacto que ya usa `loteId` (`gr_index.html:83-87`) — dimmed hasta que se toca,
`dataset.manualEdit` como flag de intención. Default estático `#FFD700` (el dorado propio de
GR) dimmed — nunca se guarda ese valor a menos que el usuario lo confirme tocando el input,
porque sin `manualEdit=true` la rama de `recolectarDatosLote()` de arriba ignora el valor del
input y autoasigna.

`cargarDatosLote()` (`gr_app.js:1902...`, junto a las líneas 1934-1936 que ya pueblan
nombre/fecha/versión) agrega:

```js
var colorInput = document.getElementById('loteColor');
if (colorInput) {
    colorInput.dataset.manualEdit = 'false';
    colorInput.value = lote.color || '#FFD700';
    colorInput.style.opacity = lote.color ? '1' : '0.7';
}
```

Reset a `manualEdit:false` en cada carga — el flag vive por sesión de edición del form, no por
protocolo; la preservación del color ya guardado la resuelve `recolectarDatosLote()` mirando
`lotesData`, no el flag.

## UI — Registro (`grRenderizarRegistroLotes`, `gr_app.js`)

**Actualizado 2026-09-06 (mismo día) para reflejar el código final, post 2 rondas de fixes de
code review — la versión anterior de esta sección quedó desactualizada en cuanto al `:hover` y
a la validación de hex, ver abajo.**

**Card teñida (estilo aprobado: borde izquierdo + fondo sutil).** Se agrega, antes del
`return` del template de card:

```js
const _colorValido = (lote.color && _grHexToRgba(lote.color, 1)) ? lote.color : null;
const colorVars = _colorValido
    ? ` style="--gr-protocolo-color:${_colorValido};--gr-protocolo-bg:${_grHexToRgba(_colorValido, 0.07)};--gr-protocolo-bg-hover:${_grHexToRgba(_colorValido, 0.12)}"`
    : '';
```

`_colorValido` reusa `_grHexToRgba` como validador (devuelve `null` ante cualquier hex
inválido/corrupto) — nunca se interpola `lote.color` crudo en el `style`. Sin esta guarda, un
`.color` corrupto en storage (posible vía `importarJSON`, que no valida al importar) produciría
`--gr-protocolo-bg:null` en el atributo — un valor CSS inválido-pero-seteado que NO dispara el
fallback de `var(..., fallback)` (el fallback solo aplica cuando la property está *sin setear*,
no cuando está seteada a basura). `_colorValido` cierra ese hueco de raíz.

Se inserta `colorVars` en el `<div class="gr-reg-card"${colorVars} onclick=...>`. CSS en
`gr_styles.css`, `.gr-reg-card`:

```css
.gr-reg-card {
    background: var(--gr-protocolo-bg, rgba(255, 215, 0, 0.04));
    border: 1px solid rgba(255, 215, 0, 0.18);
    border-left-width: 4px;
    border-left-color: var(--gr-protocolo-color, rgba(255, 215, 0, 0.18));
    border-radius: 10px;
    overflow: hidden;
    cursor: pointer;
    transition: border-color 160ms ease, background 160ms ease, box-shadow 160ms ease;
}
.gr-reg-card:hover {
    background: var(--gr-protocolo-bg-hover, rgba(255, 215, 0, 0.08));
    border-color: var(--gr-protocolo-color, var(--highlight, #FFD700));
    box-shadow: inset 3px 0 0 var(--gr-protocolo-color, var(--highlight, #FFD700));
}
```

Mismo mecanismo de custom property que ya usa `ge_app.js:696,766` con `--node-color` — no se
introduce un patrón nuevo, y las 3 properties llevan el prefijo `--gr-` (Regla 7, "protocolo"
es vocabulario compartido con CI/SU). **El `:hover` SÍ se tocó, a diferencia de lo que decía la
versión anterior de esta sección** — la primera implementación lo dejó intacto (gold fijo), y
code review encontró que eso apagaba el color del protocolo justo en el momento en que el
usuario tiene el mouse encima, la única interacción que siempre precede a un click. El fix
agrega `--gr-protocolo-bg-hover` (alpha 0.12, un poco más intenso que el 0.07 de reposo) y hace
que `border-color`/`box-shadow` en hover lean del mismo `--gr-protocolo-color` que la card en
reposo, con el dorado como fallback de siempre. **Si se vuelve a tocar este bloque, no
"restaurar" el hover a gold fijo pensando que es una limpieza — sería reintroducir este bug.**

**Swatch clickeable junto al ID**, dentro de `gr-card-identity`, antes del span de nombre:

```js
const colorSwatch = `<input type="color" class="gr-card-color-swatch" value="${_colorValido || '#FFD700'}"
    onclick="event.stopPropagation()"
    onchange="event.stopPropagation(); grSetLoteColor('${loteIdSafe}', this.value)"
    title="Cambiar color del protocolo">`;
```

`grSetLoteColor` (nuevo, expuesto en `window` por Regla 4). **Relee `gr_lotes` fresco de
localStorage antes de mutar** (no confía en el `lotesData` en memoria, que puede estar stale si
otra pestaña guardó algo desde que esta montó — mismo criterio que el fix de `_suEscribirBolsaFR`,
2026-09-02, documentado en CLAUDE.md):

```js
window.grSetLoteColor = function grSetLoteColor(loteId, colorValue) {
    var raw = localStorage.getItem(STORAGE_KEY);
    var lotesFrescos = raw ? JSON.parse(raw) : [];
    var idx = lotesFrescos.findIndex(function (l) { return l.id === loteId; });
    if (idx < 0) return;
    lotesFrescos[idx].color = colorValue;
    lotesData = lotesFrescos;
    guardarEnStorage();
    grRenderizarRegistroLotes();
};
```

No pasa por `recolectarDatosLote()` ni consume `gr_color_seq` — es edición directa por id,
igual de válida que la del form (ambas terminan escribiendo el mismo campo). CSS
`.gr-card-color-swatch`: círculo de 16px (`border-radius:50%; width/height:16px; padding:0;
border:1px solid rgba(255,255,255,.25)`), mismo truco ya usado para `<input type="color">`
compacto que en GE (`ge_app.js:1034`, aunque ahí no está recortado a círculo — variante nueva
pero misma base nativa, sin JS de overlay).

`_grHexToRgba(hex, alpha)` — helper nuevo en `gr_app.js`, copia exacta de `_hexToRgba` de
`fr_app.js:3005-3012` (mismo patrón de duplicación por IIFE ya establecido en el proyecto,
ver `_abbrevGen`/`_genChipHtml` entre FR y SU).

## Propagación — FR (`fr_app.js`)

**Actualización (2026-09-06, tras probar en real):** lo que sigue describe la primera versión
implementada (loteId + tandaId, ej. "GR304 · GRT274B"). El usuario probó la app y pidió sacar
la tanda de esta vista rápida — "necesito ver el ID del GR y listo", la trazabilidad por tanda
la revisa en el panel de detalle de FR, no en la tabla. **Versión final:** `_grChipFromBolsa`
muestra solo `grLoteId` (nunca `grTandaId`), y en el caso multi-fuente dedupea por `grLoteId`
— si dos fuentes de la misma bolsa vienen del mismo lote (distintas tandas), el chip aparece
una sola vez. `_grColorForSource(s)` se sigue llamando con la primera fuente de cada lote visto
(no importa cuál, el color es propiedad del lote, no de la tanda). Código final:
```js
function _grChipFromBolsa(b) {
    if (Array.isArray(b.grSources) && b.grSources.length > 1) {
        var vistos = {};
        var chips = [];
        b.grSources.forEach(function(s) {
            var loteId = s.grLoteId || '—';
            if (vistos[loteId]) return;
            vistos[loteId] = true;
            chips.push(_grChipHtml(loteId, _grColorForSource(s)));
        });
        return chips.join(' + ');
    }
    return _grChipHtml(b.grLoteId || '—', _grColorForSource({ grLoteId: b.grLoteId }));
}
```
`_grTxtFromBolsa` (texto plano, usado por `_frBuscar`/`_sortValue`) no se tocó — sigue
incluyendo la tanda, es una función de búsqueda/orden, no de display.

La columna GR de la tabla (`filaTabla`, celda `grTxt`, hoy texto plano dentro de
`.fr-traza`: `fr_app.js:1328`; y `filaPendiente`, `fr_app.js:3085`) pasa de
`_grTxtFromBolsa(b)` a un nuevo `_grChipFromBolsa(b)`, mismo criterio que ya se usó para
acortar/colorear la columna de genética (`_geChipFromBolsa`, `fr_app.js:3060-3068`, spec previa
`2026-08-31-fr-su-genetica-chip-acortado-design.md`):

```js
function _grColorForSource(s) {
    if (!s || !s.grLoteId) return null;
    try {
        var l = getGRLotesMap()[s.grLoteId];   // fr_app.js:260-267, ya usado por _fenIdForGrSource
        return (l && l.color) || null;
    } catch (e) { return null; }
}

function _grChipHtml(label, hex) {
    if (!label) return '—';
    var bg = hex ? _hexToRgba(hex, 0.15) : null;
    var border = hex ? _hexToRgba(hex, 0.40) : null;
    var style = bg ? ' style="background:' + bg + ';border-color:' + border + ';color:' + esc(hex) + '"' : '';
    return '<span class="fr-traza"' + style + ' title="' + esc(label) + '">' + esc(label) + '</span>';
}

function _grChipFromBolsa(b) {
    if (Array.isArray(b.grSources) && b.grSources.length > 1) {
        return b.grSources.map(function(s) {
            var label = (s.grLoteId || '—') + (s.grTandaId ? ' · ' + s.grTandaId : '');
            return _grChipHtml(label, _grColorForSource(s));
        }).join(' + ');
    }
    var label = (b.grLoteId || '—') + (b.grTandaId ? ' · ' + b.grTandaId : '');
    return _grChipHtml(label, _grColorForSource({ grLoteId: b.grLoteId }));
}
```

Se mantiene la clase `.fr-traza` como base (mismo tipografía monoespaciada/padding que hoy,
`fr_styles.css:488-497`) — solo se le agrega tinte inline cuando hay color, igual que
`_genChipHtml` hace con `.fr-chip`. Multi-fuente: un chip `.fr-traza` por fuente, unidos por
`' + '` como texto plano entre chips (mismo criterio que genética). Reemplaza el `<span
class="fr-traza">` que hoy envuelve `esc(grTxt)` en `fr_app.js:1328` y `:3085` — el `<td>` pasa
a insertar `_grChipFromBolsa(b)` directo, igual que ya hace la celda de genética con `ge`.

Es 100% capa de render — no escribe en `fr_bolsas`, no migra nada, se resuelve en vivo contra
`gr_lotes` en cada render (mismo criterio ya documentado para el chip de genética: "funciona
igual para bolsas nuevas y ya selladas").

## Propagación — SU (`su_app.js`)

**Actualización (2026-09-06, mismo motivo que FR arriba):** versión final muestra solo el
lote GR (`_suGrLoteChipHtml(grLoteId, grMap)`, reemplaza a `_suGrTandaChipHtml`), deduplicado
por sub-fila. Como una sub-fila puede tener varias fuentes del mismo lote con genéticas
distintas por tanda (`_gen`/`_fenId` se siguen calculando por fuente, nunca deduplicados — solo
el chip de ID se suprime en repeticiones), las fuentes se agrupan por `grLoteId` ANTES de
recorrerlas, para que dos fuentes del mismo lote no contiguas en el array no queden separadas
por el chip de otro lote en el medio (bug real encontrado en la revisión holística final,
corregido antes del commit). Código final del loop dentro de `db.map(function(r, i) {...})`:
```js
var normSrcs = suDbNormSources(r, lote.grProtocolo || '');
var us = 0, pesoGranoSub = 0, grTxtParts = [];
var _vistosLoteGr = {};
var _normSrcsAgrupados = (function() {
    var buckets = {}, orden = [];
    normSrcs.forEach(function(s) {
        var k = s.grLoteId || '';
        if (!buckets[k]) { buckets[k] = []; orden.push(k); }
        buckets[k].push(s);
    });
    var out = [];
    orden.forEach(function(k) { out = out.concat(buckets[k]); });
    return out;
})();
_normSrcsAgrupados.forEach(function(s) {
    // ...cálculo de us/pesoGranoSub/gen/fenId sin cambios...
    var _loteGrId = s.grLoteId || '';
    var _yaVistoLote = _loteGrId && _vistosLoteGr[_loteGrId];
    if (_loteGrId) _vistosLoteGr[_loteGrId] = true;
    var _chipLote = _yaVistoLote ? '' : _suGrLoteChipHtml(_loteGrId, grMap);
    var _chipGen = _gen ? _suGenChipHtml(_gen, _fenId) : '';
    var _pieza = _chipLote && _chipGen ? (_chipLote + ' — ' + _chipGen) : (_chipLote || _chipGen);
    if (_pieza) grTxtParts.push(_pieza);
});
```
`us`/`pesoGranoSub` son sumas — agrupar el orden de recorrido no cambia su resultado, solo el
orden de display de `grTxtParts`.

Columna GRANO de las sub-filas en cards de Registro. Sección original (primera versión, ya
superada por lo de arriba) — hoy (`su_app.js:1476`):

```js
grTxtParts.push(s.grTandaId + (_gen ? ' — ' + _suGenChipHtml(_gen, _fenId) : ''));
```

Pasa a:

```js
grTxtParts.push(_suGrTandaChipHtml(s.grLoteId, s.grTandaId, grMap) + (_gen ? ' — ' + _suGenChipHtml(_gen, _fenId) : ''));
```

`_suGrTandaChipHtml` (nuevo, junto a `_suGenChipHtml`, `su_app.js:1234-1244`):

```js
function _suGrTandaChipHtml(grLoteId, grTandaId, grMap) {
    if (!grTandaId) return '';
    var l = grMap[grLoteId || ''];
    var hex = (l && l.color) || null;
    var bg = hex ? _suHexToRgba(hex, 0.13) : null;
    var border = hex ? _suHexToRgba(hex, 0.40) : null;
    var cls = 'su-kchip' + (bg ? '' : ' su-kchip-dim');
    var style = bg ? ' style="background:' + bg + ';border-color:' + border + ';color:' + suDbEscapeHtml(hex) + '"' : '';
    return '<span class="' + cls + '"' + style + ' title="Lote GR: ' + suDbEscapeHtml(grLoteId || '') + '">' + suDbEscapeHtml(grTandaId) + '</span>';
}
```

Reutiliza `_suHexToRgba` (ya existe, `su_app.js:1208-1215`) y la clase `.su-kchip` (ya existe,
`su_styles.css:2197-2206`) — mismo mecanismo que `_suGenChipHtml`, cero CSS nuevo necesario. El
`grMap` que recibe ya está armado en el closure de esa función de render
(`su_app.js:1401-1406`), sin lecturas extra a localStorage. Cero cambios en `su_lotes`.

## Manejo de errores / casos borde

- Lote GR referenciado por FR/SU que no existe más (borrado) → `grMap[...]` da `undefined`,
  `hex` queda `null`, chip se renderiza igual pero neutro (clase base sin tinte) — nunca
  excepción, nunca celda vacía. Mismo criterio que el chip de genética.
- `gr_color_seq` ausente o corrupto (no numérico) → `parseInt(...) || 0`, arranca en el primer
  color de la paleta. No es un dato crítico — perder el contador en el peor caso reinicia la
  cola, no corrompe nada (los colores ya asignados a protocolos existentes no dependen de este
  contador para persistir).
- `lote.color` con formato inesperado (no debería ocurrir — siempre sale de `<input
  type="color">`, que normaliza a `#rrggbb`) → `_grHexToRgba`/`_hexToRgba`/`_suHexToRgba` ya
  devuelven `null` ante un hex inválido (mismo regex de 6 dígitos que usa el chip de genética),
  fallback neutro automático.
- Escritura de `gr_color_seq` fallida (quota llena) → no rompe el guardado del lote en sí
  (`guardarEnStorage()` ya tiene su propio try/catch con `BioLog`/alert,
  `gr_app.js:1012-1026`); si falla específicamente el `setItem` de la key del contador, el
  protocolo se guarda igual con el color ya calculado en memoria — solo el próximo
  autoasignado podría repetir el mismo índice. Cosmético, no bloqueante.

## Fuera de alcance

- No se toca `_grFirmaProtocolo` ni la agrupación por receta en Conocimiento
  (`grComputarKnowledge`, `gr_app.js:3876`, tabla "Protocolos de Grano") — el color es por lote
  individual, no por firma/receta compartida (confirmado en brainstorming).
- ~~No hay migración retroactiva de color para protocolos históricos~~ — revertido el mismo
  día, ver "Modelo de datos" arriba. `_grMigrarColorBackfillV1()` sí backfillea.
- `importarJSON` (`gr_app.js:1566`) no backfillea `color` — igual que cualquier otro campo
  nuevo agregado en sesiones anteriores, un lote importado desde un JSON viejo simplemente no lo
  trae, y el protocolo se ve neutro hasta que se guarde de nuevo o se le asigne color desde la
  card.
- Solo FR (columna GR) y SU (columna GRANO) reciben el tinte. Ningún otro consumidor de
  `gr_lotes` (Conocimiento de GR, TRACE si existiera, etc.) cambia.
- No se agrega corrección de contraste dinámico texto/fondo — mismo criterio que la spec de
  genética: se usa el hex tal cual, sin lógica de contraste nueva.

## Antes de implementar

Regla 8 del proyecto: backup antes de cambios en estructura de datos de localStorage. Este
cambio es aditivo (campo nuevo, key nueva, nada se renombra ni se borra) pero de todas formas
conviene pedirle al usuario un export fresco antes de tocar `gr_app.js` en producción.
