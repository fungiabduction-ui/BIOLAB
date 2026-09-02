# FR/SU — Estado "No fructificó" + fix del aviso de abandono en SU

## Problema

El Registro de SU muestra, por sub-fila con bolsa FR vinculada sin cosechas, un aviso
`"Sin registro FR desde hace N días — ¿bolsa abandonada?"` cuando pasan ≥60 días desde
`fechaInicio` sin ningún flush cargado (`su/su_app.js:1406-1434`). Dos problemas reales,
confirmados por el usuario:

1. **Bug de datos obsoletos.** El aviso no chequea si la bolsa YA fue resuelta en FR. Si el
   usuario marca la bolsa como `contaminada` (o cualquier otro archivo) desde FR, SU sigue
   mostrando el aviso de "¿abandonada?" indefinidamente — nunca vuelve a leer el estado real de
   la bolsa una vez armado ese `if`.
2. **No hay ninguna acción disponible.** Para el resto de las bolsas que sí disparan el aviso, no
   hay forma de resolverlo — ni de confirmar el diagnóstico ni de descartarlo. Queda como texto
   estático para siempre.

**Corrección de concepto durante el brainstorming:** la primera versión de este diseño proponía
un estado "abandonada" (bolsa a la que se le dejó de hacer seguimiento). El usuario aclaró que
ese escenario no existe en su operación real: nunca abandona una bolsa a propósito — el flujo de
trabajo es que solo revisa activamente las bolsas que SÍ muestran hongos; una bolsa que no
fructificó simplemente no se nota hasta que pasan ~2 meses. No hay dos causas distintas
("se dejó de mirar" vs "se miró pero no dio") — hay una sola: **no fructificó**, y el aviso de
SU es el mecanismo de descubrimiento tardío de ese hecho, no de una negligencia distinta.

## Objetivo

1. El aviso de SU deja de mostrarse cuando la bolsa ya está archivada en FR por cualquier vía —
   en su lugar se muestra el estado real (chip equivalente al de FR, solo lectura).
2. Para las bolsas sin resolver, el aviso pasa a preguntar **"¿no fructificó?"** con dos acciones:
   **Sí, no fructificó** (archiva la bolsa en FR de inmediato) / **No, sigue en seguimiento**
   (silencia el aviso 7 días).
3. Nuevo estado terminal en FR, propio y reversible, paralelo a `contaminada`/`cicloCerrado`:
   `noFructifico`. Alcanzable desde el flujo de SU de arriba, y también con un botón manual
   dentro de FR (para cuando el operador está parado en la bolsa y ya sabe que no va a dar nada,
   sin tener que pasar por SU).

Fuera de alcance: no se toca `⏹ Cerrar ciclo` (mecanismo distinto — sella el último flush de
una bolsa que sí produjo, tiene su propia lógica biológica) ni `🔴 Contaminación`.

## Modelo de datos — `fr_bolsas[]`

Dos campos nuevos, aditivos, sin migración (mismo patrón que cuando se agregó `cicloCerrado`):

```js
b.noFructifico      // boolean — estado terminal nuevo, reversible
b.fechaNoFructifico  // string|null, ISO 'YYYY-MM-DD' fecha LOCAL (mismo hoyISO() que usan
                     // fechaContaminacion/fechaCierreCiclo — nunca toISOString().slice(0,10),
                     // que es UTC y puede correr el día)
```

Un campo adicional, solo para el snooze del aviso en SU (no es parte del "estado" de la bolsa,
es metadata de UI):

```js
b.noFructificoRevisadoEn  // string|null, ISO local — última vez que el operador dijo "no, sigue
                           // en seguimiento" desde SU. Aviso silenciado 7 días desde esa fecha.
```

**Guard de exclusión:** marcar `noFructifico` se rechaza si la bolsa ya tiene
`flushes.length > 0` (ahí corresponde `cerrarCiclo`, no esto) o si ya está `contaminada` /
`cicloCerrado`. Es decir: `noFructifico` solo aplica a bolsas con cero cosechas — exactamente el
universo que hoy dispara el aviso de SU.

## Módulo FR (`fr/fr_app.js`)

### Estado y helpers de clasificación

- `computeEstado(b)`: nueva rama `if (b.noFructifico === true) return 'no fructifico';` —
  evaluada en el mismo bloque de estados terminales, después de `contaminada`/antes de
  `cicloCerrado` (el orden entre estados terminales no importa en la práctica porque son
  mutuamente excluyentes por guard, pero mantiene la lectura del bloque consistente con el
  comentario existente de "estados pre-activo").
- `esArchivada(b)`: agrega `|| b.noFructifico === true`.
- `_frIdentEstado`/`_frIdentEstadoClass`: rama `'no fructifico'` → mapea a la clase `'arc'`
  (mismo bucket visual que `'ciclo cerrado'` — es un archivo, no un error).
- Los 4 sitios donde hoy se calcula chip-class + label a partir de `estado` (duplicados,
  no se centralizan — mismo estilo ya existente en el archivo):
  - `filaTabla` (~línea 1300, tabla de listados)
  - `_ovChipClass`/`_OV_LABELS` (~línea 2696, Vista General)
  - render del header del dashboard con bolsa seleccionada (~línea 1954)
  - `updateField` — refresco parcial del chip de estado (~línea 3491)

  En cada uno: `estado === 'no fructifico'` → `chipClass = 'fr-chip-no-fructifico'`, label
  `'NO FRUCTIFICÓ'`.
- `_aggregadosPorSU` (agregados de lote SU: % contaminación, ratio de éxito): el filtro de
  "colonizada" (`!!x.fechaColonizacion && x.contaminada !== true`) se corrige a también excluir
  `x.noFructifico !== true` — una bolsa que llegó a colonizar pero nunca fructificó no debería
  seguir contando como éxito en el ratio del lote. Fix consecuente directo del nuevo estado, no
  un cambio de alcance ajeno.
- `_frExPoblarBase` (selector de bolsa base para experimentos, ~línea 4394): el filtro de
  "archivadas" agrega `|| b.noFructifico === true` para consistencia — aunque en la práctica una
  bolsa que nunca fructificó rara vez sirve de base para un experimento nuevo.
- Fecha de archivo mostrada en la fila (~línea 1293): `archStr = b.fechaCierreCiclo ||
  b.fechaCancelacion || b.fechaNoFructifico`.

### Acción manual — botón nuevo en el panel de FR

En `fr/fr_index.html`, dentro de `.fr-actions-row` (junto a `frBtnContam`/`frBtnCerrar`):

```html
<button type="button" id="frBtnNoFructifico" class="fr-btn-no-fructifico"
    onclick="FR.marcarNoFructifico()"
    title="Marca la bolsa como que nunca dio cosecha y la archiva (acción reversible)">
    🕳 No fructificó
</button>
```

`FR.marcarNoFructifico()` — mismo patrón que `cerrarCiclo()` (toggle reversible con confirm en
ambos sentidos), sin modal (no hay elección de motivo que hacer, un solo concepto):

```js
FR.marcarNoFructifico = function() {
    var b = getSelected();
    if (!b) { alert('Selecciona una bolsa primero.'); return; }
    if (b.noFructifico === true) {
        if (!confirm('La bolsa ' + b.id + ' está marcada como NO FRUCTIFICÓ.\n\n¿Querés reabrirla?')) return;
        b.noFructifico = false;
        b.fechaNoFructifico = null;
        addObsTo(b, 'Reabierta desde Archivo (estaba marcada como no fructificó).', 'manual', 'yellow');
        b.estado = computeEstado(b);
        saveBolsas();
        renderAll();
        return;
    }
    if (b.contaminada === true) {
        alert('La bolsa ' + b.id + ' está marcada como CONTAMINADA. No aplica "no fructificó".');
        return;
    }
    if (b.cicloCerrado === true) {
        alert('La bolsa ' + b.id + ' ya tiene el ciclo cerrado (tuvo cosecha). No aplica "no fructificó".');
        return;
    }
    if (Array.isArray(b.flushes) && b.flushes.length > 0) {
        alert('La bolsa ' + b.id + ' ya tiene cosechas registradas. Usá "Cerrar ciclo" en vez de esto.');
        return;
    }
    if (!confirm('Marcar la bolsa ' + b.id + ' como NO FRUCTIFICÓ?\n\nLa bolsa se archivará. Es reversible desde Archivo.')) return;
    var prevEstado = computeEstado(b);
    b.noFructifico = true;
    b.fechaNoFructifico = hoyISO();
    addObsTo(b, 'Bolsa marcada como NO FRUCTIFICÓ desde FR. Archivada.', 'manual', 'yellow');
    b.estado = computeEstado(b);
    if (b.estado !== prevEstado) addObsTo(b, 'Estado: ' + prevEstado + ' -> ' + b.estado, 'auto', 'none');
    saveBolsas();
    renderAll();
};
```

**Estado de los 3 botones terminales** (bloque que hoy gestiona `frBtnContam`/`frBtnCerrar`/
`frContamInfo`, ~línea 2101-2150) pasa de manejar 2 estados a 4 ramas mutuamente excluyentes:

| Estado de la bolsa | Contaminación | Cerrar ciclo | No fructificó |
|---|---|---|---|
| activa, 0 flushes | habilitado | **deshabilitado** (nada que cerrar) | habilitado |
| activa, ≥1 flush | habilitado | habilitado | **deshabilitado** (no aplica, ya produjo) |
| `contaminada` | "☠ Contaminada" (disabled) | disabled | disabled |
| `cicloCerrado` | disabled | "↩ Reabrir ciclo" | disabled |
| `noFructifico` | disabled | disabled | "↩ Reabrir (no fructificó)" |

`frContamInfo` gana una tercera clase `.is-no-fructifico` con su propio texto ("No fructificó el
`<fecha>` · Archivada").

### CSS (`fr/fr_styles.css`)

Nueva clase de chip. Descartado el tono ámbar inicial por chocar visualmente con
`fr-chip-pendiente` (`rgba(212,160,23,...)`) — aunque no comparten tabla, es la misma familia de
color. Violeta queda libre en la paleta actual (ok=verde, warn/pendiente=ámbar, bad=rojo,
cancelada=gris, fin-ciclo=rojo oscuro):

```css
.fr-chip-no-fructifico {
    background: rgba(130, 90, 190, 0.20);
    color: #B79CFF;
    border-color: rgba(150, 110, 210, 0.5);
}
```

Botón `.fr-btn-no-fructifico` — mismo tratamiento visual que `.fr-btn-cerrar` (secundario, no
tan agresivo como `.fr-btn-contam`).

## Módulo SU (`su/su_app.js`)

Reemplaza el bloque `su_app.js:1406-1434` (rama `else if (frB.fechaInicio)`, la única que se
toca — la rama `flushesFr.length > 0` con las estadísticas de BE queda intacta):

```js
var beRowHtml = '';
if (frB) {
    var flushesFr = Array.isArray(frB.flushes) ? frB.flushes : [];
    if (flushesFr.length > 0) {
        // ... bloque BE existente, sin cambios ...
    } else if (frB.contaminada === true || frB.cicloCerrado === true ||
               frB.noFructifico === true || frB.cancelada === true) {
        // FIX: la bolsa ya se resolvió en FR — mostrar su estado real en vez del
        // aviso de "¿no fructificó?" que quedaba huérfano para siempre.
        var arc = _suFRArchivoInfo(frB);
        beRowHtml = '<div class="su-be-row">' +
            '<span class="su-be-dot ' + arc.dotClass + '"></span>' +
            '<span class="su-be-label">🍄 ' + esc(arc.label) + '</span></div>';
    } else if (frB.fechaInicio) {
        var diasSinFR = (Date.now() - new Date(frB.fechaInicio).getTime()) / 86400000;
        var snoozed = frB.noFructificoRevisadoEn &&
            (Date.now() - new Date(frB.noFructificoRevisadoEn).getTime()) < 7 * 86400000;
        if (diasSinFR >= 60 && !snoozed) {
            beRowHtml = `
        <div class="su-be-row su-be-danger">
            <span class="su-be-danger-dots"><span></span><span></span><span></span></span>
            <span class="su-be-label">Sin registro FR desde hace ${Math.floor(diasSinFR)} días — ¿no fructificó?</span>
            <span class="su-be-nf-actions">
                <button type="button" class="su-be-btn-si"
                    onclick="event.stopPropagation();suMarcarBolsaNoFructifico('${esc(frB._frUuid||'')}','${esc(frB.id||'')}')">Sí, no fructificó</button>
                <button type="button" class="su-be-btn-no"
                    onclick="event.stopPropagation();suRevisarBolsaSigueEnSeguimiento('${esc(frB._frUuid||'')}')">No, sigue en seguimiento</button>
            </span>
        </div>`;
        }
    }
}
```

Helper de traducción de estado archivado de FR a texto/color para SU (nuevo, solo lectura):

```js
function _suFRArchivoInfo(frB) {
    if (frB.contaminada === true) {
        return { label: 'Contaminada' + (frB.fechaContaminacion ? ' (' + suFormatFecha(frB.fechaContaminacion) + ')' : ''), dotClass: 'su-be-dot--bad' };
    }
    if (frB.noFructifico === true) {
        return { label: 'No fructificó' + (frB.fechaNoFructifico ? ' (' + suFormatFecha(frB.fechaNoFructifico) + ')' : ''), dotClass: 'su-be-dot--warn' };
    }
    if (frB.cicloCerrado === true) {
        return { label: 'Fin del ciclo' + (frB.fechaCierreCiclo ? ' (' + suFormatFecha(frB.fechaCierreCiclo) + ')' : ''), dotClass: 'su-be-dot--good' };
    }
    if (frB.cancelada === true) {
        return { label: 'Cancelada', dotClass: 'su-be-dot--dim' };
    }
    return { label: 'Archivada', dotClass: 'su-be-dot--dim' };
}
```

Escritura directa a `fr_bolsas` — mismo patrón ya establecido por `_suPropagarRenameFR`
(`su_app.js:3806-3836`): opera sobre `localStorage` sin depender de que FR esté montado, protegido
con try/catch + `BioLog` + alert si falla, notifica con el mismo evento `'su-lote-guardado'` que
ya escucha FR:

```js
function _suEscribirBolsaFR(frUuid, mutator) {
    try {
        var raw = localStorage.getItem('fr_bolsas');
        if (!raw) return false;
        var bolsas = JSON.parse(raw);
        if (!Array.isArray(bolsas)) return false;
        var b = bolsas.find(function(x) { return x._frUuid === frUuid; });
        if (!b) return false;
        mutator(b);
        localStorage.setItem('fr_bolsas', JSON.stringify(bolsas));
        try { window.dispatchEvent(new Event('su-lote-guardado')); } catch (e) {}
        return true;
    } catch (e) {
        if (window.BioLog) window.BioLog.logError('SU', '_suEscribirBolsaFR', e, { frUuid });
        alert('⚠ No se pudo actualizar la bolsa en FR (¿localStorage lleno?). Revisá manualmente en el módulo FR.');
        return false;
    }
}

// Fecha local, mismo criterio que hoyISO() de FR (nunca toISOString() a secas — UTC).
function _suHoyISOLocal() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function suMarcarBolsaNoFructifico(frUuid, frId) {
    if (!frUuid) return;
    if (!confirm('Marcar la bolsa ' + (frId || '') + ' como NO FRUCTIFICÓ?\n\nSe archivará en FR. Es reversible desde FR → Archivo.')) return;
    var ok = _suEscribirBolsaFR(frUuid, function(b) {
        b.noFructifico = true;
        b.fechaNoFructifico = _suHoyISOLocal();
        b.noFructificoRevisadoEn = null;
        if (!Array.isArray(b.observaciones)) b.observaciones = [];
        b.observaciones.push({
            id: 'nt_fr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
            ts: new Date().toISOString(), tsLegacy: null, tsInferred: false,
            texto: 'Bolsa marcada como NO FRUCTIFICÓ desde SU. Archivada.',
            estado: 'yellow', auto: false, tipo: null, editedAt: null, imagenes: []
        });
    });
    if (ok) renderizarRegistroLotes();
}

function suRevisarBolsaSigueEnSeguimiento(frUuid) {
    if (!frUuid) return;
    var ok = _suEscribirBolsaFR(frUuid, function(b) {
        b.noFructificoRevisadoEn = _suHoyISOLocal();
    });
    if (ok) renderizarRegistroLotes();
}
```

Ambas funciones se agregan al `Object.assign(window, {...})` existente (`su_app.js:3859`) — son
llamadas por handlers inline (Regla 4).

### CSS (`su/su_styles.css`)

- `.su-be-dot--dim` nuevo (gris, para `cancelada`/fallback) — mismo patrón que
  `--good`/`--warn`/`--bad` (`su_styles.css:2138-2140`).
- `.su-be-nf-actions`, `.su-be-btn-si`, `.su-be-btn-no` — botones chicos inline, mismo tratamiento
  visual que el resto de `.su-kchip`/botones de acción secundarios ya presentes en el archivo.

## Edge cases

- **Bolsa sin `_frUuid`.** No debería ocurrir en datos reales — FR hace backfill de `_frUuid` en
  cada carga del módulo para cualquier bolsa que no lo tenga (`fr_app.js:210`). Si igual faltara,
  `_suEscribirBolsaFR` no encuentra match (`find` devuelve `undefined`) y `ok` es `false` — no
  rompe, simplemente no aplica el cambio y no re-renderiza (el usuario no ve nada raro además de
  que el aviso sigue ahí; no hace falta un alert para un caso que no debería existir).
- **FR montado en la misma pestaña al momento del click en SU.** El evento
  `'su-lote-guardado'` ya lo escucha FR (`fr_app.js:6104`) para su propio flujo de
  reconciliación — se reusa tal cual, sin inventar un evento nuevo. Si el listener de FR no
  refresca el chip visualmente al toque, es un problema preexistente de ese mecanismo, no algo
  que este cambio introduce.
- **Snooze de 7 días vencido mientras la bolsa sigue sin resolver.** El aviso vuelve a aparecer
  solo — es el comportamiento buscado (recordatorio periódico, no supresión permanente).
- **Bolsa marcada `noFructifico` y luego alguien carga un flush a mano** (raro, pero posible si
  se reabre desde FR y después sí da cosecha). No hay guard adicional: al reabrir
  (`b.noFructifico = false`), la bolsa vuelve a `computeEstado` normal y puede recibir flushes
  como cualquier bolsa activa — mismo comportamiento que reabrir un `cicloCerrado`.

## Testing

- Manual en navegador real (Chrome, servidor local puerto 8734), contra un backup con al menos
  una bolsa FR sin flushes y `fechaInicio` ≥60 días atrás:
  1. Confirmar que el aviso viejo ("¿bolsa abandonada?") ya no aparece — texto nuevo
     "¿no fructificó?" con los 2 botones.
  2. Click "Sí, no fructificó" → confirmar → verificar en FR que la bolsa aparece en Archivo con
     chip `NO FRUCTIFICÓ`, y que volver a SU muestra el chip de estado en vez del aviso.
  3. Con otra bolsa en la misma condición, click "No, sigue en seguimiento" → verificar que el
     aviso desaparece y no vuelve a aparecer hasta pasar los 7 días (se puede forzar editando
     `noFructificoRevisadoEn` a mano en localStorage para el test).
  4. Marcar una bolsa como `contaminada` directamente desde FR (bolsa sin flushes, ≥60 días) →
     volver a SU → confirmar que muestra el chip "Contaminada" y no el aviso (este es el bug
     original reportado).
  5. Desde FR, con una bolsa de 0 flushes seleccionada: confirmar que "Cerrar ciclo" está
     deshabilitado y "No fructificó" habilitado; con una bolsa de ≥1 flush, al revés.
  6. Marcar `noFructifico` desde el botón de FR, reabrir, confirmar que vuelve a estado activo y
     los otros 2 botones se re-habilitan según corresponda.
