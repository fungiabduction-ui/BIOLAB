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
    mostrar: [punto pulsante] "BE {be}% total (F1 {f1.beOleada}% · F2 {f2.beOleada}% · ...)"
        be >= 150        -> verde
        100 <= be < 150  -> amarillo
        be < 100         -> rojo
    (desglose por oleada agregado 2026-07-10: el total solo no distingue una bolsa
    fuerte de entrada de varias oleadas flojas que suman parecido — F{n} usa
    flush.n, con fallback al índice+1 para datos legacy sin ese campo)

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

## Fuera de alcance (indicador por bolsa)

- No se toca el esquema de indexado `suBolsaIndex` (limitación ya documentada, badge FR solo alinea bien cuando `bolsas:1` por fila).
- No se agrega ninguna acción/botón en la fila — es puramente informativo, de un vistazo.

---

## Extensión — Ordenar Registro de Lotes por Eficiencia Biológica (2026-07-10, misma sesión)

**Goal:** además del indicador por bolsa, poder reordenar la lista completa de cards por eficiencia para detectar rápido qué protocolo de SU rindió mejor. Esto sí requiere un número agregado por lote (a diferencia del indicador por bolsa, que deliberadamente no agregaba nada).

**UI:** `<select id="suRegSort">` nuevo, ubicado junto al botón "✏️ Edit" (`su_index.html`, dentro del mismo `<div style="margin-bottom:12px">`). Opciones:
1. `Fecha (recientes primero)` — default, mismo comportamiento que hoy (`lote.fecha` desc).
2. `BE promedio del lote (mejor primero)`
3. `Mejor bolsa del lote (mejor primero)`

**Cálculo — se extrae la lógica de BE-por-bolsa a un helper compartido**, `_suBolsaBE(frB)`, reusado tanto por el indicador de fila (ya implementado) como por el nuevo cálculo de orden:
```
_suBolsaBE(frB) → { pesoHumedoTotal, pesoSustratoSeco, beTotal } | null
    null si no hay frB, o si frB.pesoSustratoSeco no es > 0
    pesoHumedoTotal = sum(flush.pesoHumedo para cada flush) — 0 si no hay cosechas
    beTotal = sum(flush.beOleada para cada flush) — 0 si no hay cosechas (cuenta como 0%, ya definido)
```

Nueva función `_suLoteBEStats(lote)`, recorre `frMap = _suGetFRMap(lote)`:
```
bolsasConDato = valores de frMap que dan _suBolsaBE(frB) !== null
si bolsasConDato.length === 0: devolver null (lote sin dato, va al final en cualquier modo BE)

beProm  = sum(b.pesoHumedoTotal) / sum(b.pesoSustratoSeco) * 100
beMejor = max(b.beTotal para cada bolsa)
```

**Orden final:** cuando el modo es `beProm` o `beMejor`, los lotes con `_suLoteBEStats(lote) === null` van siempre al final de la lista (sin importar el resto del orden), y los que sí tienen dato se ordenan desc por el campo correspondiente.

**Persistencia:** el modo de orden vive en una variable de módulo (`_suRegSortMode`), no se guarda en localStorage — vuelve a "Fecha" en cada recarga de página. Si más adelante se pide recordarlo, es un cambio chico aparte.

### Fuera de alcance (extensión de orden)
- No se guarda preferencia de orden entre sesiones.
- No hay orden ascendente/peor-primero — si se necesita después, se agrega como opción nueva al `<select>`.
