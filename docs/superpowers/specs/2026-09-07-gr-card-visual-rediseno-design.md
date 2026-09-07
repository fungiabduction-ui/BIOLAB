# GR — Rediseño visual de la card de Registro (cabecera + grid de tandas)

Decidido con superpowers:brainstorming usando el companion visual (mockups en
`.superpowers/brainstorm/1002-1788810805/content/card-layout.html` y `tanda-grid.html`, no se
sube a git — `.superpowers/` está en `.gitignore`). Complementa/reemplaza en un punto la spec de
`docs/superpowers/specs/2026-09-07-gr-be-indicator-design.md` (ver nota agregada ahí).

## Problema

Screenshot real del usuario (2026-09-07): el chip de BE agregado en `.gr-card-stats-bar`
("🏆 BE 295% prom · 🥇 345% mejor") es texto largo metido en una fila de pills cortas ("3
tandas", "12 ud", "0 disponibles") — rompe el ritmo visual. Y las filas de tanda
(`.gr-tanda-row`, flex con chips sueltos a la derecha) no alinean como columnas: la genética
completa ("Psilocybe cubensis / APE / APE 338 / SIF / F2 / 244") empuja todo lo demás y ninguna
columna coincide entre filas — "todo mezclado" (cita textual del usuario).

## Decisión 1 — Cabecera con franja de resultado (Opción B del mockup `card-layout.html`)

BE e hidratación se sacan de `.gr-card-stats-bar` (que vuelve a sus 4 pills originales:
tandas/ud/contaminación/disponibles) y se agregan a `.gr-card-head`, en `.gr-card-right`, como
texto chico (`.gr-card-perf`) antes de la fecha — no compiten visualmente con las pills de
capacidad.

```
💧 62%  ·  🏆 295% ⏳     27-04-2026     ▶ Trazabilidad
```

- `💧` = `grCalcularKPIFormulario(lote).hidratacion` (ya calculado en el loop, cero cómputo
  nuevo). Solo se muestra si `> 0`.
- `🏆` = `bePromedio` de `grComputarAnalisis(lote.id)` (via `_anMap`, pre-construido). Solo se
  muestra si `bolsasTrackeadas > 0`.
- **`⏳` marca BE parcial** — aparece cuando `bolsasCerradas < bolsasTrackeadas` (hay al menos una
  bolsa FR linkeada que todavía no llegó a un estado terminal: `contaminada`/`cicloCerrado`/
  `noFructifico`/`cancelada`, ver `esArchivada()` de FR). Sin `⏳` = las bolsas trackeadas ya
  cerraron su ciclo — el número es definitivo, no va a seguir moviéndose con nuevas cosechas de
  esas mismas bolsas. El detalle exacto ("3/5 bolsas cerradas, resto en curso" / "ciclo
  completo") vive en el `title` (tooltip), no en el texto visible — mantiene la franja compacta.
- `beMejor` no se muestra en la cabecera (queda solo en el tooltip) — mostrar prom+mejor+pending
  ahí atascaría de nuevo el espacio compacto que se ganó sacándolo del stats-bar.

## Decisión 2 — Grid de tandas alineado (Opción B del mockup `tanda-grid.html`)

`.gr-tanda-row` (flex) se reemplaza por `.gr-td-row` (grid), mismo mecanismo que
`.su-sub-header`/`.su-card-sub` de SU (header de columnas en amarillo + grid-template-columns
idéntico en header y filas). Columnas: **TANDA | GENÉTICA | UD | CONTAM | DISP | COL. | USO**.

- **GENÉTICA** — se abrevia al último eslabón de la cadena, coloreado con el color del nodo GE
  (`_grGenChipHtml`/`_grResolveGeColor`, nuevos, mismo mecanismo que `_suGenChipHtml`/FR
  `_genChipHtml` — sin color resuelto cae a `.gr-gen-chip-dim`, nunca un color hardcodeado).
  Tooltip = cadena completa (+ nombre de fórmula CI si aplica, ese sufijo nunca entra en la
  extracción del último eslabón — se pasa aparte como `tooltipText`).
- **COL.** — chip siempre presente, nunca celda vacía: `✅ DD-MM-AAAA` si `r.colonizacion` tiene
  dato, **`⏳ PENDIENTE`** si no (pedido explícito del usuario — antes esta fecha, cuando faltaba,
  simplemente no mostraba nada).
- **USO** — columna flexible que junta el chip de uso en SU (`🧱 N ud SU`) y de experimento
  (`🔬 EX...`), igual que antes (`suTag`+`exTag`), separada de COL. en vez de compartir una sola
  columna "ESTADO" — elegido explícitamente por el usuario sobre la alternativa de columna única
  (mockup opción A).
- Clases viejas (`.gr-tanda-row`, `.gr-tanda-left`, `.gr-tanda-right`, `.gr-tanda-id`,
  `.gr-tanda-gen`, `.gr-tanda-uds`, `.gr-tanda-disp`, `.gr-tanda-meta`, `.gr-tanda-chip`)
  eliminadas de `gr_styles.css` — confirmado por grep que no se usan en ningún otro archivo del
  repo, reemplazo limpio sin dejar CSS muerto. `.gr-chip-contam`/`.gr-chip-dim`/`.gr-chip-su`
  (modificadores de color, no de layout) se conservan tal cual — las siguen usando tanto el
  stats-bar como las nuevas celdas `.gr-td-chip`.
- Media query mobile (`@media max-width:700px`) actualizada de `.gr-tanda-row` (referenciaba una
  clase que ya no existe) a `.gr-td-header`/`.gr-td-row`, colapsando la columna CONTAM a 0 en vez
  de un `grid-template-columns` de 5 columnas que no correspondía a ninguna versión real de la
  fila (bug preexistente, no introducido en esta sesión).

## Decisión 3 — Footer de totales, movido de entre cabecera y grid a debajo del grid (Opción C del mockup `footer-stats.html`)

Segundo reporte del usuario tras probar en real: las 4 pills de `.gr-card-stats-bar` (tandas/ud/
contaminación/disponibles), ubicadas entre la cabecera y el grid de tandas, quedaban
"descolgadas" (palabra textual) — ni pertenecen visualmente a la cabecera ni al grid, flotan en
el medio. Se bajan a un footer nuevo (`.gr-card-footer`) debajo del grid de tandas.

Formato elegido (de 3 mockups — A: mismas pills reubicadas, B: texto quieto sin pills, **C:
barra de totales con separadores verticales, elegida por el usuario**): cada dato en su propio
bloque separado por una línea vertical fina (`border-right`), sin fondo de pill. Solo
contaminación y disponibles llevan color de alerta — tandas/ud son conteo de rutina, quedan en
gris neutro siempre. Disponibles conserva la escala de 3 niveles ya existente en el resto de GR
(`gr-disp-ok`/`bajo`/`agotado` → verde/ámbar/rojo, vía color inline sobre el número — no une
`.tot` con las clases de pill viejas, que traían background/border que no aplican a este
formato). Contaminación es binaria: gris si 0, rojo si `> 0`. Reemplaza `.gr-card-stats-bar`/
`.gr-stat-chip` (eliminadas de `gr_styles.css`, confirmado sin otros usos en el repo) por
`.gr-card-footer`/`.tot`. Los botones de acción (editar/eliminar, solo en modo edición) se
mueven junto con el resto del footer, mismo comportamiento de siempre (`margin-left:auto` vía
`.gr-footer-spacer`).

## Fuera de alcance

- No se toca el panel "▶ Trazabilidad" (`grToggleTrazabilidad`/`grComputarAnalisis` como vista de
  detalle) — sigue mostrando todo sin abreviar.
- No se agrega corrección de contraste dinámico al chip de genética — mismo criterio que las
  specs de color de protocolo (GR/SU) y de chip de genética en FR/SU: se usa el hex tal cual.
- Sigue sin haber una versión "mobile-first" real de la card — el fix del media query es
  defensivo (no dejar una clase inexistente referenciada), no un rediseño responsive nuevo.
