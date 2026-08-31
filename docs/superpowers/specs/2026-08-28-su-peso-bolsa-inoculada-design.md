# SU — "Bolsa inoculada": grano calculado por resta automática

## Problema

En la fila de distribución de SU (`su/su_app.js`, `suDbAddRow`), el operador carga hoy dos pesos
reales por tanda:

- 🧱 Sustrato (`db-peso-real`, `g/bolsa`) — peso real de la bolsa con sustrato solo, antes de
  inocular. `0` = usar el peso teórico del lote (`pesoSustrato / bolsasUsadas`).
- 🌾 Grano (`db-peso-grano-real`, `g/bolsa`) — peso real de grano inoculado por bolsa. `0` =
  calcular automático desde GR (frascos usados × peso por frasco).

El operador pesa la bolsa DOS veces en la práctica: una vez con sustrato solo (→ Sustrato), otra
vez después de agregar el grano (bolsa inoculada). Hoy resta esos dos números a mano y tipea el
resultado en Grano — trabajo manual repetido en cada tanda, sin necesidad.

## Objetivo

Un campo nuevo donde el operador carga directamente el peso de la bolsa YA inoculada (la segunda
pesada, sin hacer la resta a mano) y el sistema calcula `Grano = Bolsa inoculada − Sustrato` y lo
escribe en el campo Grano existente — sin agregar una fuente de verdad nueva: `db-peso-grano-real`
sigue siendo el único campo que lee `suCalcularMetricasLote()` y todo lo que hay río abajo
(propagación a FR incluida). Decisión explícita del usuario en brainstorming: no reemplazar el
cálculo de peso de bolsa que ya existe, solo automatizar la resta que hoy hace a mano.

## Ubicación y UI

Tercera columna en `.db-row-pesos-body`, entre Sustrato y Grano (refleja el orden cronológico real
del pesaje):

```
🧱 Sustrato   |   ⚖️ Bolsa inoculada   |   🌾 Grano (auto)
```

Nuevo input `class="db-peso-bolsa-inoculada"` (mismo tipo/estilo que los otros dos: `type="number"
min="0" step="0.1" placeholder="—"`), con un modificador CSS `.db-peso-col--inoc` propio (acento
verde, mismo patrón que `--sust` azul / `--gran` ámbar en `su_styles.css:1481-1531`) para
distinguirlo visualmente como "la medición que dispara el cálculo".

Debajo del input, un `<span class="db-peso-bolsa-inoculada-msg">` oculto por defecto — se usa para
el aviso de bloqueo (ver "Validación" abajo).

## Cálculo — cuándo dispara y cuándo no

Handler nuevo `suDbOnChangeBolsaInoculada(inputEl)`, enlazado con `onchange` (ninguno de los 3
inputs de esta fila usa `oninput` hoy — no se rompe esa convención):

1. Lee `pesoReal` (Sustrato) de la MISMA fila. Si es `0` o vacío → no calcula nada, muestra el
   mensaje `"Cargá el peso real de Sustrato primero"` en el span de aviso, dejando Grano
   intacto. Decisión del usuario: bloquear con aviso, no usar el teórico como fallback — restar
   contra un promedio del lote podría no corresponder a la bolsa puntual que se pesó.
2. Si `pesoReal > 0` → `grano = pesoBolsaInoculada − pesoReal`. Se escribe directo en el `.value`
   del input `.db-peso-grano-real` de la misma fila (confirmación visual inmediata, sin UI extra).
3. **El único disparador es el propio input "Bolsa inoculada".** Si después el operador edita
   Sustrato, Grano NO se recalcula solo — evita pisar en silencio un valor de Grano que el
   operador ya haya tocado a mano. Para que el cálculo refleje un Sustrato nuevo, hay que volver a
   tocar "Bolsa inoculada" (aunque sea al mismo valor, dispara el `onchange` de nuevo).
4. **Grano sigue siendo editable a mano en todo momento** (decisión explícita del usuario) — si el
   operador lo edita directamente después de un cálculo automático, ese valor manual queda tal
   cual, sin ningún guard que lo revierta.

Sin negativos que clampear: a diferencia del reparto de FR (`_frSyncDeshReparto`), acá no hay
redondeo ni redistribución — es una resta simple de 2 números que el operador tipeó. Si el
resultado da negativo (bolsa inoculada pesada por error antes que la de sustrato, etc.), se
escribe igual en Grano tal cual — el operador lo ve como un número negativo evidente en su propio
input y lo corrige, no hace falta que el sistema lo adivine.

## Persistencia

Nuevo campo `pesoBolsaInoculada` por fila, mismo nivel que `pesoReal`/`pesoGranoReal`:

- `suDbCollect()` (`su_app.js:3430-3483`): agregar lectura de `.db-peso-bolsa-inoculada` junto a
  `_prRaw`/`_pgRaw`, mismo patrón (`> 0 ? valor : null`), agregado al objeto `out.push({...})`.
- `suDbLoadFromLote()` (`su_app.js:3485+`): restaurar el `.value` del nuevo input junto a
  `prInp`/`pgInp`, mismo patrón (`(parseFloat(d.pesoBolsaInoculada) > 0) ? ... : 0`).

**No se toca `suCalcularMetricasLote()` ni ningún otro consumidor de `pesoGranoReal`** — el nuevo
campo es puramente una entrada de conveniencia que escribe en el campo que ya existía.

## Auto-log en `dbSeguimiento`

Hoy ninguno de los 3 pesos de esta fila genera nota automática — pero SÍ existe un patrón ya
establecido para otros eventos de esta misma fila (`suDbOnChangeBolsas` → nota de inoculación;
consumo de frascos GR → `suDbRegistrarSeguimiento`, `su_app.js:3195-3214`).

**Decisión revisada en brainstorming (rechazado el patrón de "nota de corrección" separada que usa
`frascos-gr`):** una sola nota por tanda que siempre refleja el valor vigente, nunca un historial
de correcciones. Nueva función `_suDbLogGranoAuto(tanda, texto)`:

```javascript
function _suDbLogGranoAuto(tanda, texto) {
    var nota = null;
    for (var i = 0; i < SU.dbSeguimientoNotas.length; i++) {
        var n = SU.dbSeguimientoNotas[i];
        if (n.auto === true && n.tipo === 'peso-grano-auto' && n.tanda === tanda) { nota = n; break; }
    }
    if (nota) {
        nota.texto = texto;
        nota.editedAt = new Date().toISOString();
    } else {
        SU.dbSeguimientoNotas.push({
            id: _suNotaId(), ts: new Date().toISOString(), tsLegacy: null, tsInferred: false,
            tipo: 'peso-grano-auto', texto: texto, estado: 'green', auto: true, editedAt: null,
            imagenes: [], tanda: tanda
        });
    }
    window.suDbRenderSeguimientoNotas();
}
```

- Busca por `tipo === 'peso-grano-auto' && tanda === <esta tanda>` en `SU.dbSeguimientoNotas`
  (array ya persistido) — no depende de estado en el DOM (`dataset`), por eso sigue encontrando la
  nota correcta después de cerrar y reabrir el lote, sin necesitar un campo de persistencia nuevo
  en la fila `db`.
- Campo `tanda` agregado directo al objeto de la nota — mismo precedente que ya usan CI
  (`tandaId`), GR (`frascos`/`dias`), FR (`dias`): cada módulo agrega sus propios campos extra
  sobre el shape unificado de notas (`id`/`ts`/`texto`/`estado`/`auto`/`tipo`/`editedAt`/`imagenes`)
  sin romper nada compartido.
- `editedAt` ya es un campo real del shape, ya renderizado hoy (`su_app.js:3337`, marca "✦" al
  lado del texto) — reusar el mecanismo existente en vez de inventar uno nuevo.
- Sin distinción de color "corrección" (🟡) vs "primera vez" (🟢) — siempre `estado:'green'`, ya
  no aplica esa distinción porque no hay una segunda entrada que diferenciar.
- Texto de la nota: `tanda + ': Grano calculado automático: ' + grano.toFixed(1) + 'g (bolsa inoculada ' + pesoBolsaInoculada + 'g − sustrato real ' + pesoReal + 'g)'`.
- Se llama desde `suDbOnChangeBolsaInoculada` únicamente en el caso 2 del cálculo (Sustrato > 0,
  cálculo exitoso) — el caso bloqueado (Sustrato en 0) no genera nota, solo el aviso visual.

## Fuera de alcance

- No se toca `db-peso-real`/`db-peso-grano-real` como inputs en sí — siguen sin `onchange`/`oninput`
  propio salvo el nuevo comportamiento de que Grano recibe un `.value` seteado programáticamente
  desde el handler nuevo.
- No hay recálculo retroactivo si se edita Sustrato después del cálculo (ver punto 3 de
  "Cálculo" arriba) — decisión explícita, no un olvido.
- No se agrega indicador visual de "este Grano vino de un cálculo automático vs. tipeado a mano"
  más allá de la nota en `dbSeguimiento` — el usuario no lo pidió, y agregarlo sería una superficie
  de UI nueva no solicitada.
