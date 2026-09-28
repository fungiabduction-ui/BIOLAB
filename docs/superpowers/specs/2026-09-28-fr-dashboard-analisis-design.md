# FR — Vista General completa + pestaña Análisis (BE) — diseño

Fecha: 2026-09-28 · Módulo: FR · Brainstorming con companion visual (mockups en `.superpowers/brainstorm/331-1790563595/`, no versionados).

## Objetivo

Hoy la "📋 Vista General" de FR (`renderOverview()`, se muestra cuando no hay bolsa seleccionada) es una tabla agrupada por estado con 7 columnas. El operador necesita (1) un estado global de FR a detalle, ordenable y filtrable, con bolsas favoritas, y (2) análisis de qué factores de proceso acompañan un BE alto y qué genética rinde más.

Decisión: **C** — dos superficies separadas:
- **Vista General** (tabla operativa, día a día) — reescrita.
- **Pestaña nueva "📊 Análisis"** (gráficos + ranking) al lado de Activo/Cosecha/Archivo.

## 1. Vista General (en `fr_app.js`, reescribe `renderOverview()`)

- **Tabla única** con todas las bolsas no canceladas (pendientes incluidas), sin secciones por estado.
- **Chips de filtro** arriba, con conteo: Todas · 🟢 En cultivo · 🌊 Cosecha · 🔴 Archivo · ⭐ Favoritas (+ ⏳ Pendientes solo si hay). Mismas funciones de clasificación que las pestañas (`esPendiente`/`esEnCultivo`/`esCosecha`/`esArchivada`).
- **Orden por columna**: clic en encabezado ordena asc/desc. Orden inicial: fecha de armado desc. Filtro y orden viven en memoria del módulo (no se persisten).
- **Columnas**: ⭐ · ID · Genética (chip, `_geChipFromBolsa`) · SU (`_suSubChip`) · GR (`_grChipFromBolsa`) · Estado (chip, mismo mapping que `filaTabla`) · Armado (`fechaInicio`) · Días · F# · Última oleada (fecha máx. de `flushes[].fecha`) · Fresco (`rendimientoFresco`) · BE (`beAcumulado`) · Seco (`biomasaSecaTotal` + chip PENDIENTE por oleada sin secar, `_frFlushesPendientesSecar`) · % desh. (`pctDeshidBolsa`).
- Clic en la fila (fuera de la ⭐) → `FR.select(id)` como hoy. Pendientes no seleccionables (sin `id`), igual que hoy.
- KPIs actuales de la Vista General se mantienen.

## 2. Favoritas ⭐

- Campo nuevo en `fr_bolsas[]`: `favorita: { ts: ISO, motivo: string } | null` (ausente = no favorita; no requiere migración).
- `FR.toggleFavorita(id)`: al marcar, pide motivo opcional (prompt de texto; vacío permitido); al desmarcar, confirma. Escribe vía `saveBolsas()` + `renderAll()`, y registra `addObsTo(b, '⭐ Marcada favorita: <motivo>' | '☆ Quitada de favoritas', 'auto', ...)`.
- Permitido en bolsas selladas/archivadas: es una anotación del operador, no trazabilidad (no toca `grSources`, pesos ni fechas — Regla 9 intacta).
- Motivo visible en tooltip de la ⭐ y en el panel de detalle de la bolsa.
- Guardas: no aplicar a bolsas pendientes (sin `id`) ni canceladas.

## 3. Pestaña 📊 Análisis (archivo nuevo `fr/fr_analisis.js`)

IIFE, expone `window.FRAnalisis = { render(container), ... }`. Se carga desde `fr_index.html` después de `fr_app.js`. Lee bolsas vía una API de solo lectura que `fr_app.js` expone (`FR.getBolsasSnapshot()` o similar — copia, nunca la referencia interna), y `gr_lotes` / `biolab.ge.v4` crudos de `localStorage` (lectura ya permitida para FR). Nunca escribe en `fr_bolsas`, `gr_lotes`, `su_lotes` ni GE. Gráficos en SVG inline, sin librerías.

### 3.1 Regla de validez (qué bolsas entran a cálculos)

Entra una bolsa si: no pendiente, no cancelada, `origen !== 'huerfana'`, `granoPorBolsa > 0`, `pesoSustratoSeco > 0`, `pesoHumedoHidratado > pesoSustratoSeco`, y tiene ≥1 flush **o** `noFructifico === true` (cuenta como BE 0). Las excluidas se listan debajo de los gráficos con su motivo ("huérfana", "falta peso hidratado", etc.). En la Vista General todas se muestran igual.

### 3.2 Métricas por bolsa

- `beAcum` = `beAcumulado(flushes)` (suma de `beOleada`; NO se reescribe al cerrar ciclo — el valor final es la suma al cierre).
- `beF1` = `flushes[0].beOleada` (0 si `noFructifico`).
- `cerrada` = `cicloCerrado || noFructifico || contaminada`.
- `granoSust` = `granoPorBolsa / pesoSustratoSeco`.
- `hidrSust` = `(pesoHumedoHidratado − pesoSustratoSeco) / pesoSustratoSeco × 100`.
- `hidrGrano`: por cada fuente de `grSources`, hidratación del lote GR con la **misma fórmula que `grCalcularKPIFormulario`** (`masaTotal = uf.cantidad_unidades × uf.peso_unidad`; `masaSeca = Σ componentes[tipo='seco'].masa`; `(masaTotal − masaSeca)/masaSeca × 100`; null si `masaSeca ≤ 0` o `masaTotal ≤ masaSeca`), promedio ponderado por `grUsados`. Fórmula duplicada a propósito (GR no está montado en FR); documentar en ambos lados que deben cambiar juntas.

### 3.2b Gráfico principal — BE global en el tiempo (pedido 2026-09-28)

Primer gráfico de la pestaña, ancho completo.
- **Eje X = fecha de armado** (`fechaInicio`), un punto por bolsa. **Eje Y = BE** según el selector global (acumulado / 1ª oleada).
- Incluye, además de las bolsas válidas, las **contaminadas** (marcador ✕ rojo, BE = lo que llegó a producir, 0 si nada) y las **no fructificó** (marcador ▽ ámbar, BE 0). Datos de grano/hidratación no son requisito para este gráfico (solo: no pendiente, no cancelada, no huérfana, con `fechaInicio`, y con ≥1 flush o `noFructifico` o `contaminada`).
- ● cerrada / ○ en producción, igual que las dispersiones.
- **2 medias móviles por cantidad de bolsas** (iteración tras probar, pedido del operador: acierto vs error), ventana elegible 5 / 10 (default) / 20 bolsas:
  - **MM BE** (eje izquierdo): en modo acumulado solo cerradas (las abiertas tienen BE parcial); en modo 1ª oleada todas.
  - **MM % fallas** (eje derecho 0–100%): % de bolsas contaminadas o no fructificó sobre TODAS las bolsas de la serie (una abierta con cosecha ya fructificó = acierto).
- **Tooltip al pasar el mouse** (todos los gráficos): línea vertical + cuadro con la bolsa más cercana (ID, genética y detalle de mezcla, fecha, BE, estado) y, en el de tiempo, el valor de ambas medias en esa fecha. En las dispersiones el clic excluye la bolsa bajo el cursor.

### 3.3 Gráficos (3 dispersiones: X vs BE)

Grano/sustrato seco vs BE · Agua en sustrato vs BE · Agua en grano vs BE.
- Selector global: **BE acumulado** (default) / **Comparar 1ª oleada**.
- En modo acumulado: ● relleno = bolsa cerrada (BE final), ○ hueco = en producción (BE parcial). **Tendencia (mínimos cuadrados) y r de Pearson se calculan solo con cerradas.** En modo 1ª oleada: todos los puntos cuentan.
- Tooltip por punto: ID, genética (y "mezcla: 244 ×3 + F2B ×1" si aplica), BE, valor X.
- Pie de cada gráfico: r, n usado, n de puntos; si n < 5 → "pocas bolsas para tendencia" (sin línea).
- Leyenda fija: "correlación no es causa — grano, hidratación, genética y fecha cambian juntos entre protocolos".

### 3.4 Exclusiones manuales

- Key nueva `fr_analisis_cfg`: `{ exclusiones: [{ grafico: 'granoSust'|'hidrSust'|'hidrGrano', tipo: 'bolsa'|'grLote', id, motivo, ts }] }`. Prefijo `fr_` → ya cubierta por `BK_PREFIXES` y `_bkCollectRaw` (backups/GitHub Sync).
- Clic en un punto → "Excluir de este gráfico" + motivo opcional. En `hidrGrano` la exclusión es por lote GR (todas las bolsas de ese lote salen de ese gráfico); en los otros dos, por bolsa. Una bolsa con fuentes mixtas donde un lote está excluido: su `hidrGrano` se calcula sin ese lote; si no queda ninguno, sale del gráfico.
- Lista de exclusiones visible debajo de los gráficos, cada una con "↺ deshacer". Nunca modifican datos de GR/FR.
- Caso inicial conocido: GR76 (hidratación de grano poco confiable, sin dato real recuperable) — lo excluye el operador desde la UI, no se hardcodea.

### 3.5 Top genética por BE

- **Identidad de genética = `fen_id` de la tanda GR** (leída en vivo de `gr_lotes[].dg[]` por `grLoteId`+`grTandaId`), nombre = nombre ACTUAL del nodo en GE (`window.ge.getNode` o `GEResolve.resolverNodoCrudo`). Fallback: último eslabón de `geneticaFull`. Motivo: el texto guardado en tandas viejas quedó desactualizado ("F2B 103" = nodo "F2B"; una tanda guardó el id crudo "NODE-…").
- **Atribución de bolsas con varias genéticas**: a la genética con más frascos (`grUsados` sumado por `fen_id`). Empate → fila aparte "🧬 Mezcla pareja". Cada fila indica cuántas de sus bolsas son mezcla ("8 bolsas (2 con mezcla)"), tooltip con el detalle.
- **Independiente del selector acumulado/1ª oleada** (cambio tras probar con datos reales: con "acumulado" + últimos 3 meses casi ninguna bolsa había cerrado y el ranking quedaba vacío). **Ordena por BE de 1ª oleada** promedio de todas las bolsas válidas del período, y muestra al lado **BE final prom. solo de las cerradas** con su cantidad entre paréntesis.
- **Filtro de período por fecha de armado**: Últimos 3 meses · Últimos 6 meses · Todo (default, pedido del operador tras probarlo).
- **Detalle desplegable**: clic en una genética despliega debajo sus bolsas del período (ID, armada, BE 1ª oleada, BE acumulado, estado, mezcla), más nueva primero; clic en una bolsa abre su ficha (`FR.select`). Los `onclick` pasan un índice de la última tabla renderizada, nunca el nombre/ID (texto libre). "Últimos N meses" = `fechaInicio` ≥ hoy − N meses (fecha local, comparación de strings `YYYY-MM-DD`).
- Columnas: Genética · Bolsas · BE 1ª oleada prom. (barra) · BE final prom. (cerradas) · Mejor BE (acumulado máx.) · % fructificó. **Ordenable por cualquier columna** (clic en encabezado, ↑↓); default BE 1ª oleada ↓. Sin agrupar por n: las de pocas bolsas van en gris dentro del mismo orden (nulls siempre al final).
- `noFructifico` cuenta como 0 en ambos promedios. Filas con n < 3 en gris "pocas bolsas".
- En las dispersiones, las bolsas que no fructificaron se dibujan como ▽ (BE 0), igual que en el gráfico de tiempo.

## 4. Persistencia — resumen

| Key | Cambio |
|-----|--------|
| `fr_bolsas` | campo opcional nuevo `favorita` (sin migración) |
| `fr_analisis_cfg` | **nueva**, solo exclusiones del análisis |

Actualizar tabla de keys de `CLAUDE.md`.

## 5. Verificación

- Funciones puras de cálculo (validez, métricas, `hidrGrano`, Pearson/regresión, atribución, ranking) testeadas con script Node contra el backup real más reciente; valores de referencia en `docs/lab-intelligence/fr-analisis-valores-referencia.md` (privado).
- UI en Chrome con backup real en contexto aislado: filtros/orden/⭐ con motivo (incl. bolsa archivada), selector BE, filtro período, excluir/deshacer (persistencia tras recarga), sin errores de consola.

## Fuera de alcance (posibles iteraciones)

BE por número de oleada, etiquetas múltiples en vez de ⭐, exportar gráficos.
