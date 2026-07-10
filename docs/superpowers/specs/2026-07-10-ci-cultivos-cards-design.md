# CI — Cultivos: cards agrupadas por fórmula con gradiente de urgencia

## Contexto

La pestaña 🧫 Cultivos (`ci_index.html`, `renderCultivosTab` en `ci_app.js`) mostraba los cultivos en una tabla plana de 9 columnas, ordenada por nombre de fórmula pero sin agrupación visual. El usuario pidió reemplazarla por cards agrupadas por fórmula, con un color sutil que indique cercanía al auto-caducado (regla existente: `_ciCultivosAutoArchivar`, 60 días desde `fechaCreacion`).

## Diseño

**Agrupación:** `filtrados` se agrupa por `medioFormulaId` (mismo criterio de sort alfabético por nombre de fórmula que ya existía). Cada grupo es una sección con encabezado fijo (nombre de fórmula + conteo) — sin colapso, siempre visible.

**Orden dentro de cada grupo:** DISPONIBLE (más urgente primero) → AGOTADO → CADUCADO → DESCARTADO.

**Contenido de cada card:** igual info que la fila de tabla — código, genética abreviada, tipo, badge de estado, stock `disp/inicial`, fecha de validación, resumen de consumo GR, botones 🔍 (detalle consumos) / ✎ (notas) / ✕ (descartar).

**Gradiente de urgencia — solo cultivos `estado === 'DISPONIBLE'`:**
```js
progreso = clamp((ahora - fechaCreacion) / (60 * 24 * 60 * 60 * 1000), 0, 1)
hue = 120 - 120 * progreso   // 120 verde → 60 amarillo → 0 rojo
```
Aplicado como borde izquierdo de 4px + tinte de fondo de baja opacidad (`hsl(hue, 55%, 45%, 0.08)` aprox.), no un fill sólido. AGOTADO/CADUCADO/DESCARTADO no llevan este borde — mantienen el color de badge de estado que ya tenían (`var(--ac)`/`var(--wn)`/`var(--er)`/`var(--tx3)`).

**`ciToggleConsumos`:** en vez de insertar un `<tr>` después de la fila (`insertAdjacentElement('afterend', tr)`), toggla la visibilidad de un `<div>` hijo pre-renderizado dentro de la card (`display:none` por defecto), poblado la primera vez que se abre — evita insertar hermanos en un layout grid/flex.

## Fuera de alcance

- No se toca `_ciCultivosAutoArchivar`, ni el umbral de 60 días, ni ningún dato en `bl2_cultivos`. Es un cambio de rendering puro.
- Filtros, stats bar y empty-state no cambian.
- No se agrega colapso/expansión por sección de fórmula (decisión explícita del usuario: secciones fijas).

## Testing

Manual: cargar CI → Cultivos con datos reales, verificar agrupación por fórmula, verificar que cultivos DISPONIBLE recién creados se ven verdes y los que están por cumplir 60 días se ven rojizos, verificar que AGOTADO/CADUCADO/DESCARTADO no cambian de color con el tiempo, verificar que 🔍/✎/✕ siguen funcionando igual que antes.
