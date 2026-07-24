# Prompt — Agregar ingrediente a BIOLAB (CILAB / CI)

> Copiá desde la sección **PROMPT** hacia abajo y pegalo en Claude/Grok/etc.  
> Adjuntá: (1) ficha del producto, (2) export fresco `biolab_ingredientes_export_*.json` de CILAB → Biblioteca.

---

## PROMPT

```
Actuá como un ingeniero senior del sistema BIOLAB (SPA, localStorage, pipeline GE → CI → CILAB → GR → SU → FR).

NO quiero parches visuales ni fixes superficiales.
Prioridad: integridad de datos, no corrupción silenciosa, compatibilidad legacy, sin inventar nutrientes ni rutas.

Tu tarea: generar UN archivo JSON listo para importar en
  CILAB → 🧪 Biblioteca biológica → ⬆ Importar JSON
que deje el ingrediente usable en:
  - Analizador metabólico (rutas ACTIVA cuando qty en rango)
  - Perfil bioquímico (composition × masa)
  - CI fórmulas y experimentos (mismo id, nombre resuelto en vivo)
  - Optimizador / Conocimiento / Inteligencia (solo leen el id; no hace falta código)

════════════════════════════════════════════════════════
ARQUITECTURA (NO VIOLAR)
════════════════════════════════════════════════════════

1. SSoT de ingredientes = localStorage key `bl2_ings` (escribe SOLO CILAB).
2. CI NO escribe ingredientes. Fórmulas = `{id, qty, snapshot}`; experimentos extras = `{ingId, qty}` (sin nombre embebido).
3. Import = merge por `id`: id existente = UPDATE silencioso; id nuevo = CREATE.
4. Para un ingrediente NUEVO normal: SOLO JSON. NO tocar main.js, cilab_app.js, ni ROUTES salvo que el usuario pida explícitamente una ruta nueva o activators.
5. `bio.composition` alimenta el Perfil bioquímico (vitaminas/minerales/aminoácidos).
   El GRAFO de rutas NO lee composition: usa `bio.rutas` + `bio.contribuciones` + `rangoOptimo` (o regex de nombre si no hay override).
6. `bio.rutas` es override TODO-O-NADA: si es array (incluso []), apaga auto-detect por nombre.
7. Path contribuciones: intensidad ≥ 75 → ACTIVA. Sin `rangoOptimo`/`rangoSeguro` → scale 0.5 (casi nunca ACTIVA).
8. `pc`/`pn` son PORCENTAJES (47 = 47%, no 0.47).
9. `rangoBase` top-level NO se importa por el importer actual — no confiar en él; usar `bio.rangoOptimo`/`rangoSeguro`.
10. No inventar aminoácidos, minerales traza ni rutas sin fuente. Si no hay dato: 0 / no activar ruta. Marcar `composition.source` y `confianza`.

════════════════════════════════════════════════════════
ENTRADAS QUE DEBE DAR EL USUARIO
════════════════════════════════════════════════════════

A) Export fresco de Biblioteca (array de ingredientes actuales) — OBLIGATORIO para elegir id libre.
B) Ficha del producto: nombre, marca, forma, dosis de lab (unidad + rango típico), etiqueta nutricional, formas químicas si hay, lo NO publicado.

Si falta el export: PEDIRLO. No asumas el próximo ING-XXXX.

════════════════════════════════════════════════════════
PASOS OBLIGATORIOS (EN ORDEN)
════════════════════════════════════════════════════════

### 1) Resolver ID
- Del export: listar ids existentes; calcular huecos y máximo.
- Si CREATE: usar el menor hueco razonable O el máximo+1 — pero DOCUMENTAR la elección.
  Preferencia: si el usuario ya tiene un id en un experimento (ej. extra ING-00xx), USAR ESE id exacto.
- Si UPDATE: el id debe existir en el export; reescribir `bio` completo en el JSON (el importer hace Object.assign superficial: keys omitidas pueden dejar basura vieja tipo contribuciones antiguas — por eso el bio del JSON debe traer TODO lo que debe quedar).

### 2) Campos top-level
{
  "id": "ING-00XX",
  "nombre": "...",
  "unidad": "gr|mg|ml|ud",   // la unidad con la que DOSIFICA en lab
  "aspecto": "Solvente|Soporte|Carbono|Nitrógeno|Mineral|Cofactores",
  "pc": number|0,
  "pn": number|0,
  "notas": "texto humano + dosis + fuentes + advertencias de unidad"
}

Regla de unidad: si unidad=mg y la dosis es 6 g/L, qty en app = 6000. Decirlo en notas y alertas.

### 3) Motor de rutas (Analizador)
Traducir SOLO nutrientes/roles VERIFICADOS → routeIds:

| Evidencia | Ruta candidata |
|-----------|----------------|
| B1 / tiamina / glucosa-C base | N1_GLYC |
| B2, B3 (cofactores); Cu/Fe/Mn si medidos | N1_ETC |
| B6 (PLP); Zn si medido | N2_ODC / N3_ZINC |
| L-Arginina | N2_ODC + N2_NO_PKG |
| Vit C/E, GSH, NAC | N2_REDOX |
| Inositol, lecitina | N3_MEMBRANE |
| Metionina; soporte débil folato+B12 solo si se documenta | N3_SAM |
| Levadura NO autolizada / almidón / gradiente | N0_GRADIENT |
| Mg | N3_CHITIN (+ ETC si aplica) |
| Ca libre (CaCl2 mejor que CaCO3) | N3_SPITZ |
| Carbono simple / malta | N1_GLYC, N2_CAMP, a veces N0_GRADIENT |

NO copiar el mapa de un ingrediente “parecido” sin verificar nutrientes.

bio.rutas = array de las rutas que DEBE activar.
bio.contribuciones = mismos ids, números.
  - Si el ingrediente debe poder dejar rutas ACTIVA solo o como extra principal: usar ~70–85 por ruta reclamada (el umbral del path aditivo es 75).
  - Si es cofactor menor en stack: valores más bajos OK, documentar.
bio.contribucionesEstimadas = true si no hay ensayo de atribución.
bio.rangoOptimo = { min, max } en la MISMA unidad del top-level (dosis de cultivo real).
bio.rangoSeguro = { min, max } más amplio.
bio.estado = "sin_datos" | "en_ensayo" | "validado" | "peligro"
bio.mecanismo = 2–6 oraciones bioquímicas ligadas a rutas.
bio.alertas = array de { tipo, msg } (stacking B, termolabilidad, unidad, sin minerales, etc.)
bio.seeded = false para ingredientes de usuario.

### 4) composition (Perfil bioquímico)
Normalizar a base "1g" o "1_comprimido"/"1_capsula" según producto.
- vitaminas: B1_mg, B2_mg, B3_mg, B5_mg, B6_mg, B7_ug, B9_ug, B12_ug, C_mg, ...
- minerales: Ca_mg, Mg_mg, K_mg, Na_mg, Fe_mg, Zn_mg, Cu_mg, Mn_mg, ...
- aminoacidos: arg_g, met_g, ... (en g por la base `per`)
- macros: proteina_g, carbohidratos_g, lipidos_g, fibra_g
- formas: strings de forma química si constan
- source + confianza: "alta" | "media" | "baja"
Valores no publicados = 0. NUNCA rellenar proxy de otra cepa/marca sin que el usuario lo autorice explícitamente y se marque confianza baja + source.

### 5) Salida
- Un único archivo JSON: array de un objeto `[{ ... }]`.
- Nombre sugerido: `ING-00XX_<slug>_import.json`
- NO editar código de la app salvo pedido explícito.
- Checklist de validación para el usuario (abajo).
- Si el id del JSON no coincide con un extra ya cargado en un experimento, advertir (síntoma: "+ING-00xx 200" sin nombre en Modo comparación).

### 6) Checklist de validación (incluir al final de tu respuesta)
1. Backup / export antes de importar.
2. Importar JSON en Biblioteca.
3. Hard refresh (Ctrl+F5) — cache IngStore puede quedar viejo.
4. Abrir detalle: chips de rutas ON; rangos visibles.
5. Analizador: qty en rango óptimo → rutas reclamadas en ACTIVA (o LIMITADA documentada si contrib baja a propósito).
6. Perfil bioquímico: subir qty → vitaminas/minerales con valor>0 deben escalar; ceros permanecen en 0.
7. CI: el select muestra el nombre; experimentos extras usan el MISMO id.
8. Si reimportás: el JSON trae bio completo (no omitir keys que deban borrar/reemplazar comportamiento viejo).

════════════════════════════════════════════════════════
ANTI-PATRONES (PROHIBIDO)
════════════════════════════════════════════════════════

- Inventar aminoácidos/minerales “típicos de S. cerevisiae” sin autorización.
- Dejar rangoOptimo null y contribuciones bajas y decir “está listo para el motor”.
- Usar id de un export viejo sin mirar el export fresco.
- Poner unidad gr y dosificar mentalmente en mg (o al revés) sin documentar.
- Activar N3_ZINC / N3_SAM / N2_NO_PKG sin Zn / Met / Arg verificados.
- Tocar main.js o el Analizador INTOCABLE por un ingrediente de catálogo.
- Asumir que composition mueve el score del grafo.

════════════════════════════════════════════════════════
DATOS DEL USUARIO (pegar debajo)
════════════════════════════════════════════════════════

[EXPORT: biolab_ingredientes_export_YYYY-MM-DD.json]
[FICHA DEL PRODUCTO / etiquetas / mediciones de lab / dosis prevista]
[¿CREATE o UPDATE? si UPDATE, id exacto]
[¿Hay experimento/extra que ya use un id? indicar ingId]
```

---

## Notas operativas (para vos, no van en el prompt)

| Caso | Acción |
|------|--------|
| Ingrediente nuevo normal | Solo JSON + import |
| Interacción crítica entre ings | `cilab_interactions.js` (código) |
| Ruta metabólica nueva | `ROUTES` en Analizador (raro, plan aparte) |
| Experimento muestra `+ING-00xx` | Id huérfano: alinear extra al id real en `bl2_ings` |
| Huecos 0033–0038 con NatureBell en 0039 | Cosmético; no renumerar sin migrar fórmulas |

## Archivos de ejemplo recientes

- `ING-0032_bobs_red_mill_update.json` — update motor + composition etiqueta
- `ING-0039_naturebell_methylated_b_complex.json` / id real en app: **ING-0039**
