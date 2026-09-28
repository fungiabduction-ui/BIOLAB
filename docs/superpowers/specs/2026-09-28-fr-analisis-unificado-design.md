# FR — Análisis unificado (Inteligencia FR·CAL + Análisis BE) — diseño

Fecha: 2026-09-28 · Módulo: FR · Continúa `2026-09-28-fr-dashboard-analisis-design.md`.
Brainstorming con companion visual (mockup en `.superpowers/brainstorm/892-1790622198/`, no versionado).

## Problema

FR tenía dos pestañas de análisis que se pisaban: "📊 Inteligencia" (motor de calidad FR·CAL) y
"🔎 Análisis BE". Ambas mostraban genética, grano, hidratación y aditivos con números distintos:
- FR·CAL solo cuenta oleadas con evaluación de calidad (37 de 63 bolsas con cosecha).
- FR·CAL identifica la genética por el texto guardado en la bolsa (desactualizado: "F2B 103" ≠
  "F2B"; mezclas atribuidas a la primera fuente).
- La fórmula de hidratación de grano estaba copiada 3 veces (GR, FR·CAL, Análisis BE).

Además el operador pidió 6 análisis nuevos: tipo de grano, curva de oleadas, días a 1ª cosecha,
aditivos SU, BE por semana de ciclo y calidad vs BE.

## Diseño

**Una sola pestaña "📊 Análisis"** (`data-frtab="analisis"`) reemplaza a las dos. Sub-pestañas:
📈 Rendimiento (default) · 🌾 Factores · 🎯 Calidad · ⚠ Anomalías. La última sección vista se
recuerda en `fr_analisis_cfg.seccion`. Toolbar global: BE acumulado / 1ª oleada, y "Período de
armado" (3 meses · 6 meses · Todo — default Todo) que aplica a las tablas; el gráfico de tiempo y
las dispersiones muestran siempre todo el historial.

### 📈 Rendimiento
- BE en el tiempo (MM BE + MM % fallas) y Top genética con detalle — ya existentes.
- **Curva de oleadas**: por genética, BE promedio de F1, F2, F3… sobre bolsas con `cicloCerrado`
  (ciclo completo), con n por oleada.
- **Armado → 1ª cosecha**: días `fechaInicio` → `flushes[0].fecha` por genética (n, prom, min, max),
  todas las bolsas con ≥1 flush.
- **BE por semana de ciclo**: bolsas cerradas con fecha de cierre (`fechaCierreCiclo` /
  `fechaNoFructifico` / `fechaContaminacion`): BE acumulado ÷ días × 7. Promedio por genética +
  top 5 bolsas.

### 🌾 Factores (todo vs BE, todas las bolsas válidas)
- Las 3 dispersiones + exclusiones — ya existentes.
- **Tipo de grano**: cada bolsa se atribuye a la composición (cereales secos únicos, ej.
  "Avena + Sorgo") del lote GR que más frascos le aportó.
- **Aditivos de SU**: por aditivo (una bolsa puede tener varios), BE con ese aditivo vs las bolsas sin
  él; fila "Sin aditivos" de referencia.
- Ambas tablas: bolsas, BE 1ª oleada prom. (o BE final de cerradas en modo acumulado), % fructificó,
  período (primera → última fecha de armado) y **estabilidad temporal**:
  - `insuficiente`: grupo o resto con < 3 bolsas.
  - `confundido con fecha`: < 50% de las bolsas del grupo caen en meses donde también hay bolsas
    del resto → el efecto no se puede separar del momento.
  - si no: leave-one-month-out sobre los meses compartidos (mismo principio que
    `_frCalDeltaConLOO`): `inestable` si el rango de deltas supera `max(0.5 × |delta|, 10 pp)`,
    si no `estable`.

### 🎯 Calidad
- El contenido de FR·CAL (perfil por cepa, aditivos→calidad, dosis-respuesta, lotes GR,
  componentes GR), renderizado por `fr_app.js` en el contenedor de la sección.
- **Calidad vs BE** (por oleada evaluada): BE de la oleada vs % deformaciones y vs puntaje personal.
  No se usa `scoreAuto` porque incluye `min(beOleada,100)` en su fórmula (correlación circular).
- Correcciones FR·CAL: la genética de `byCepa` usa `FRAnalisis._calc.atribuirGenetica` (fen_id +
  genética con más frascos, nombre actual de GE) si está cargado; "BE medio" pasa a "BE medio
  (oleadas evaluadas)"; cache `fr_cal_intel` gana `version: 2` y se reconstruye si difiere.
- La hidratación de `byGrProtocolo` usa `FRAnalisis._calc.hidratacionLoteGR` (quedan 2 copias:
  GR y fr_analisis).

### ⚠ Anomalías
- Bolsas con anomalías + candidatos de riesgo de FR·CAL, sin cambios de contenido.

## Integración técnica
- `fr_app.js`: `_frCalRenderIntelPanel()` pasa a `FR.renderCalIntel(el, parte)` con `parte`
  `'calidad' | 'anomalias'`; `FR.subTab('intel')` redirige a Análisis → Calidad (compatibilidad).
- `fr_index.html`: se quita el botón/panel `intel`; el botón `analisis` pasa a "📊 Análisis".
- `fr_analisis.js`: funciones puras nuevas con tests (`curvaOleadas`, `diasPrimeraCosecha`,
  `bePorSemana`, `composicionGrano`, `tablaFactor`, `estabilidadTemporal`, `puntosCalidad`).
- Sin cambios en datos guardados salvo `fr_analisis_cfg.seccion` y el cache derivado `fr_cal_intel`.

## Fuera de alcance
Restyling de los colores hardcodeados del bloque FR·CAL (funciona, estilo viejo).
