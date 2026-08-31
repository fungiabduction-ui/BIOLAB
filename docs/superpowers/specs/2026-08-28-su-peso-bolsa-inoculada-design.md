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
3. **Revisado en code review (2026-08-29) — el disparador normal es "Bolsa inoculada"; hay un
   caso especial de recuperación en Sustrato.** Si el operador edita Sustrato después de un
   cálculo YA exitoso (mensaje de aviso oculto), Grano NO se recalcula solo — evita pisar en
   silencio un valor de Grano que el operador ya haya tocado a mano. Pero si la fila está en
   estado BLOQUEADO (mensaje de aviso visible — Sustrato seguía en 0 cuando se tipeó "Bolsa
   inoculada"), corregir Sustrato SÍ reintenta el cálculo automáticamente
   (`suDbOnChangeSustratoReal`, agregado en `su_app.js`). Se agregó porque la redacción original de
   este punto ("volver a tocar Bolsa inoculada, aunque sea al mismo valor, dispara el onchange de
   nuevo") resultó ser **falsa en navegadores reales** — confirmado en Chrome real durante code
   review: un input no dispara `change` si se retipea el mismo valor que ya tenía, así que sin este
   camino de recuperación el operador quedaba bloqueado sin ninguna forma real de destrabar la fila.
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

## Auto-log en `dbSeguimiento` — implementado y luego eliminado (2026-08-31)

Se implementó una función `_suDbLogGranoAuto(tanda, texto)` (busca-y-actualiza por `tipo+tanda`,
nunca duplica) y se la conectó desde `suDbOnChangeBolsaInoculada`. El review holístico final
encontró que la búsqueda por nombre de tanda podía cruzar notas entre 2 filas si llegaban a
compartir el mismo nombre. Al plantear esa disyuntiva (documentar la limitación vs. blindar con un
id estable por fila), el usuario cortó por lo sano: **la nota automática no aporta nada — los
valores explícitos (Sustrato/Bolsa inoculada/Grano) ya están en sus propios campos, y agregar una
nota que los repite en texto libre es complejidad sin beneficio real.** Se eliminó la función
entera y su único call site. `suDbOnChangeBolsaInoculada` ya no lee `.db-tanda` para nada (esa
lectura también se eliminó, quedaba sin uso).

## Fuera de alcance

- No se toca `db-peso-grano-real` como input en sí más allá de que recibe un `.value` (y el
  atributo `value`, ver "Cálculo" arriba) seteado programáticamente desde el handler nuevo.
- `db-peso-real` SÍ terminó necesitando su propio `onchange` (`suDbOnChangeSustratoReal`) — no
  estaba en el alcance original, se agregó durante code review para resolver la recuperación desde
  el estado bloqueado (ver "Cálculo", punto 3 revisado).
- No hay recálculo retroactivo AUTOMÁTICO E INCONDICIONAL si se edita Sustrato después de un
  cálculo ya exitoso (ver punto 3 de "Cálculo" arriba) — decisión explícita, no un olvido. Sí
  reintenta específicamente cuando la fila está en el estado bloqueado (`suDbOnChangeSustratoReal`).
- Ninguna nota automática ni indicador visual de "este Grano vino de un cálculo automático vs.
  tipeado a mano" — eliminado explícitamente por pedido del usuario (ver sección de arriba).
