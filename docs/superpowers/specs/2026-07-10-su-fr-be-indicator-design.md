# SU — Indicador de Eficiencia Biológica (BE) por bolsa Design

**Goal:** en el Registro de Lotes de SU, cada sub-fila de tanda/bolsa (`.su-card-sub`) muestra hoy datos de armado (grano, hidratación, ratio) pero nada sobre cómo salió esa bolsa en Fructificación. Se agrega una línea nueva debajo de cada sub-fila con el estado de BE (Eficiencia Biológica) de la bolsa vinculada, o una alerta si la bolsa quedó abandonada sin registrar resultado.

**Alcance:** solo `su/su_app.js` (loop de render de sub-filas en `renderizarRegistroLotes`) y `su/su_styles.css`. Sin cambios en FR ni en el schema de `fr_bolsas` — SU sigue siendo solo lectura de FR.

---

## Lógica por bolsa

Para cada tanda `i` del lote, ya existe `frB = frMap[i]` (bolsa FR vinculada, o `undefined`).

```
si no hay frB:
    no se muestra nada nuevo (comportamiento actual sin cambios)

si frB.flushes tiene al menos 1 elemento:
    be = sum(f.beOleada for f in frB.flushes)   // ya calculado y persistido por FR, no se reinventa la cuenta
    mostrar: [punto pulsante] BE {be}%
        be >= 150        -> verde
        100 <= be < 150  -> amarillo
        be < 100         -> rojo

si frB.flushes está vacío o no existe:
    dias = hoy - frB.fechaInicio   (fechaInicio hereda lote.fecha al crear la bolsa, ver fr_app.js:741)
    si dias >= 60:
        mostrar: [3 puntos rojos parpadeando en secuencia] "Sin registro FR — posible bolsa abandonada"
    si no:
        no se muestra nada (todavía en cultivo, es normal)
```

Ningún estado nuevo se calcula en FR ni se persiste — todo se deriva en el momento del render a partir de datos que SU ya lee (`fr_bolsas` vía `_suGetFRMap`, ya existente).

## Visual

Reusa el keyframe `pulse` ya definido en `main.css` (siempre cargado por el shell, disponible en cualquier módulo). Clases nuevas en `su_styles.css`, prefijadas `su-` (Regla 7):

- `.su-be-row` — contenedor de la línea nueva, ancho completo, indentado para alinear con el contenido de la sub-fila.
- `.su-be-dot` + modificador `--good` / `--warn` / `--bad` — punto de 8px con `box-shadow` del mismo color (mismo patrón que `.logo-pulse`), color tomado de las variables/colores ya usados en SU (`--highlight` #70AD47 verde, `#FFC000` amarillo ya usado en `su-kchip-warn`, `#FF6B6B` rojo ya usado en `db-grano-disp[data-state="empty"]`).
- `.su-be-danger` — línea de alerta: 3 puntos rojos chicos (`.su-be-danger-dot`) con `animation-delay` escalonado (parpadeo en secuencia, distinto del pulso uniforme normal) + texto de aviso.

## Fuera de alcance

- No se agrega ningún cálculo de BE a nivel lote (promedio/ponderado entre bolsas) — cada bolsa muestra su propio estado, sin agregación.
- No se toca el esquema de indexado `suBolsaIndex` (limitación ya documentada, badge FR solo alinea bien cuando `bolsas:1` por fila).
- No se agrega ninguna acción/botón — es puramente informativo, de un vistazo.
