# Sistema de diseño visual unificado — biolab-app

## Contexto

La app se construyó módulo por módulo a lo largo de meses (GE → CI → CILAB → GR → SU → FR → CFG). Cada módulo definió su propia paleta de colores en su propio `:root` sin ninguna regla compartida. Auditoría real (screenshots del servidor local, 2026-09-07) contra los 7 módulos confirmó:

- **Ya unificado, no se toca:** tipografía (Inter para body, JetBrains Mono para datos/números, ya consistente en los 7 módulos), el shell (`main.css`: header + nav + splash, compartido siempre).
- **El problema real no es solo "el fondo no es igual al de FR".** GE/CI/CILAB/GR/SU/CFG comparten una paleta gris plana vieja (`#1D1D1D/#2D2D2D/#3D3D3D`, bordes `#404040`) mientras FR usa una paleta más fría y con más contraste (`#0F1115/#181B22/#232733`, bordes `#2E3340`). Pero además cada módulo inventó su propio color de acento sin regla de uso: GR y sobre todo SU pintan cada tile de métrica de un color distinto sin lógica visible ("sopa de colores"). El tratamiento de "tab activo" del sub-menú también difiere módulo a módulo (píldora verde sólida en GE/CI/GR, violeta en CILAB, recuadro con borde en FR) sin ninguna decisión de diseño detrás — fue creciendo orgánicamente.
- Ningún módulo tiene sistema de elevación (sombras/degradés) — todo son cajas planas con borde de 1px sobre el mismo fondo, con contraste bajo entre tarjeta y página.
- No hay jerarquía de botones (primario/secundario/peligro) — ej. CI tiene un botón rojo "Backup de CI" para una acción que no es destructiva.

## Principios de diseño (validados con el usuario vía brainstorming visual)

1. **Identidad de color por módulo, disciplinada — no un acento único para toda la app.** El usuario navega los 7 módulos a diario; el color-por-módulo da wayfinding instantáneo. El problema hoy no es "tener colores distintos", es la falta de disciplina en cómo se usan. La solución es UN acento por módulo, usado solo para su tab activo, botones primarios y headers de sección — nunca un color distinto por elemento en la misma pantalla.
2. **Base oscura compartida, inspirada en FR pero refinada** (ver tokens abajo) — reemplaza la paleta gris plana vieja en los 6 módulos restantes y en el shell.
3. **Los colores semánticos de estado (verde=OK, ámbar=alerta/pendiente, rojo=peligro/contaminado) son intocables y universales.** No varían por módulo, no se tocan por esta iniciativa.
4. **Elegancia moderna vía elevación y jerarquía, no vía más color.** Sombras/degradés sutiles en tarjetas, jerarquía real de botones, distinción clara entre "chip de referencia" (dato, gris neutro) y "pill de estado" (accionable, con color semántico).

## Fuera de alcance — explícito, no se toca

- **`main.js`** — Regla 1 de CLAUDE.md, nunca se toca sin autorización puntual del usuario en el momento. Esta iniciativa es 100% CSS (y `main.css`, que es el stylesheet del shell, un archivo distinto de `main.js`). Si en algún punto de la implementación pareciera necesario tocar `main.js`, se para y se pregunta explícitamente — no se asume.
- **`calcEstadoRutas`/`calcRizomorfico` (Analizador CILAB)** — INTOCABLE, es motor de scoring, no estética.
- **Colores semánticos de estado** (pills de "COLONIZANDO", contaminación, BE%, alertas verde/ámbar/rojo) en cualquier módulo.
- **El sistema de "color por protocolo" de GR/SU** (`GR_COLOR_PALETTE`/`SU_COLOR_PALETTE`, 12 hex rotativos vía `gr_color_seq`/`su_color_seq`, resueltos por `_grResolveLoteColor`/`_suResolveLoteColor`) y los chips que lo pintan en vivo (`_grChipFromBolsa`, `_suChipFromBolsa`, `_suGrLoteChipHtml`, `_genChipHtml`/`_suGenChipHtml`/`_grGenChipHtml` para genética). Es un sistema de datos funcional — cada lote/protocolo tiene SU PROPIO color para poder distinguirse de otros lotes del mismo módulo — completamente distinto del color de *identidad de marca* del módulo que define este documento. Los 12 hex de esa paleta (`#EF6C57, #F2A93C, #C6D94D, #52B788, #2FB6A6, #3FA9DB, #5C7CE0, #8B6CE3, #C15FCB, #E0568F, #B0785A, #6E8894`) ya tienen buen contraste sobre fondo oscuro y no necesitan cambiar — simplemente van a verse igual (o mejor, por más contraste de fondo) sobre la base nueva.
- Ningún cambio de schema de datos, ninguna migración, ningún archivo de `localStorage` — es una iniciativa puramente visual (CSS + algunos atributos ya existentes como `data-module`).

## Paleta de identidad por módulo

Un acento por eslabón del pipeline, elegido por resonancia con lo que ese módulo representa (no decorativo al azar):

| Módulo | Color | Hex | Por qué |
|--------|-------|-----|---------|
| GE | Blanco/platino | `#ECEFF4` | Fuente de verdad del árbol genético — de acá heredan todos los demás, blanco = contiene todo el espectro. Único módulo sin color "de pipeline" a propósito. |
| CI | Teal bioluminiscente | `#2DD4BF` | Cultivo in-vitro — vida en placas/medio líquido bajo luz. |
| CILAB | Violeta analítico | `#8B7CF6` | Motor de inteligencia (OLS, FI Engine, rutas metabólicas) — ya era la asociación existente, se afina el tono. |
| GR | Dorado grano | `#E8A83D` | Color literal del grano de spawn. Saturado y brillante. |
| SU | Terracota tierra | `#A8673F` | Sustrato — aserrín/paja/yeso/hidratación. Deliberadamente menos saturado que GR (misma familia cálida, pero "grano brillante" vs "tierra mate" para que no se confundan). |
| FR | Coral fructificación | `#E8637A` | Cuerpo fructífero madurando/cosecha. Reemplaza el ámbar (que ahora es de GR). El verde matrix `#00FF9C` que FR ya usa para datos en vivo/focus se mantiene igual — es un acento de interacción aparte, no identidad de módulo, y ya está documentado como decisión deliberada en CLAUDE.md. |
| CFG | Gris pizarra | `#7C8798` | No es parte de la biología del pipeline — infraestructura del sistema. Neutro a propósito para no competir con los 6 módulos biológicos. |

Convención de nombres de variable por módulo: `--<mod>-accent` (ej. `--ge-accent`, `--ci-accent`, `--gr-accent`, `--su-accent`, `--cfg-accent`). **Excepción FR:** su CSS ya separa correctamente identidad de módulo (`--fr-main`, hoy `#D4A017` ámbar) del acento de datos en vivo (`--fr-accent`, verde matrix `#00FF9C`) — son variables distintas desde su creación, no hay colisión que resolver. Solo se cambia el *valor* de `--fr-main` a `#E8637A` (coral); `--fr-accent` (verde matrix) queda exactamente igual, nombre y valor.

## Tokens compartidos (base para los 7 módulos + shell)

Nuevo archivo `shared/design_tokens.css`, cargado una sola vez desde `index.html` (antes de `main.css`), define:

```css
:root {
  /* Superficies — reemplaza la escala gris plana vieja en todos los módulos */
  --surface-0: #0B0D11;   /* fondo de página */
  --surface-1: #0F1115;   /* fondo base (antes --bg) */
  --surface-2: #171A21;   /* tarjetas (antes --bg-secondary) */
  --surface-3: #1E222C;   /* elementos anidados (antes --bg-tertiary) */
  --surface-deep: #0a0a0a; /* header/shell más profundo */

  /* Texto */
  --text: #F2F4F8;
  --text-muted: #9AA1B2;
  --text-dim: #666E80;

  /* Bordes */
  --line: #262B36;
  --line-soft: #1C2029;
  --line-strong: #343B4A;

  /* Radios */
  --r-sm: 6px; --r-md: 8px; --r-lg: 12px; --r-pill: 20px;

  /* Espaciado (base 4px) */
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 20px; --sp-6: 24px; --sp-8: 32px;

  /* Sombra — dos niveles, no más */
  --shadow-card: 0 8px 20px -12px rgba(0,0,0,.5);
  --shadow-float: 0 30px 60px -20px rgba(0,0,0,.6);

  /* Semántico — universal, nunca varía por módulo */
  --ok: #52B788;
  --warn: #E8A83D;
  --danger: #E85D5D;

  /* Transiciones (ya existen en main.css, se re-exportan acá como SSoT) */
  --t-fast: .15s ease; --t-base: .25s ease; --t-slow: .4s ease;
}
```

Cada módulo mantiene en su propio `:root` **solo** sus tokens específicos: su acento de identidad (`--<mod>-accent`) y cualquier alias de dominio que no tenga equivalente compartido (ej. `--su-fibra`, `--su-agua`, que no son parte del sistema de marca, son colores funcionales de la calculadora de SU y quedan como están). Todo lo que hoy redefine `--bg`, `--tx`, `--border`, `--bg-secondary`, etc. con los valores grises viejos se elimina de cada módulo — al no redefinirse, heredan automáticamente de `design_tokens.css`. Los alias legacy (`--ac`, `--tx`, `--bg-deep`, etc.) que el CSS de cada módulo ya usa por dentro se re-mapean una vez en el `:root` del módulo a los tokens nuevos, para no tener que tocar miles de líneas de `var(--ac)`/`var(--tx)` dispersas en cada archivo.

## Sistema de componentes

Validado con el usuario vía mockup visual del dashboard de FR (aprobado). Reglas:

- **Tarjetas:** degradé sutil `linear-gradient(180deg, --surface-2, ligeramente más oscuro)` + `--shadow-card` + `--r-lg`. Reemplaza la caja plana de 1px de borde.
- **Botones — 3 niveles, nunca más:**
  - *Primario*: relleno con el acento del módulo activo, texto oscuro, `box-shadow` sutil del mismo color. Una sola acción primaria por pantalla.
  - *Secundario*: `--surface-2` + borde `--line`, texto `--text-muted`. Es el default para casi todo.
  - *Peligro*: fondo `rgba(danger,.08)`, borde `rgba(danger,.35)`, texto danger. Reservado EXCLUSIVAMENTE a acciones destructivas reales (borrar, eliminar todo). Corrige el botón rojo "Backup de CI" de hoy, que no es destructivo y debe pasar a secundario.
- **Chip vs. pill — distinción funcional, no solo visual:**
  - *Chip* (gris neutro, `--surface-3` + `--line`): dato de referencia (genética, ID de lote). Nunca lleva color semántico.
  - *Pill* (color semántico, fondo tenue + texto del color + punto indicador): estado accionable (colonizando, contaminada, alerta). Los pills de estado siguen usando exclusivamente `--ok`/`--warn`/`--danger` — nunca el acento de módulo.
- **Tablas:** header en mayúsculas chicas, `--text-dim`, fondo apenas distinto (`--surface-3`) — nunca una fila sólida de color como el header dorado de GR hoy.
- **KPI tiles:** neutros por default (`--surface-2`); el acento de módulo se reserva para EL dato más importante de la fila (no para todos, como hace SU hoy pintando cada tile de un color distinto sin criterio); un dato "vivo"/en tiempo real puede usar un acento de interacción con glow (ej. el verde matrix de FR).
- **Tabs (nav principal y sub-nav de cada módulo):** mismo lenguaje visual en los 7 módulos — grupo segmentado, tab inactivo neutro, tab activo con fondo `--surface-2` + borde + texto en el acento de identidad de ESE módulo + glow sutil (`box-shadow` con el color al 15-20% de opacidad). La nav principal (`main.css`, `.tab.active`) pasa de "siempre verde" a resolver el color por `data-module` (atributo que ya existe en el HTML, `index.html:52-106` — no requiere tocar `main.js`, es un selector CSS nuevo por atributo).
- **Foco de inputs:** anillo de foco con el acento del módulo + glow, generalizando el patrón que FR ya usa (`box-shadow: 0 0 0 2px var(--fr-accent-glow)`) a los 7 módulos.

## Shell (`main.css`)

- Migra sus tokens de color (`--bg`, `--bg-secondary`, etc.) a los compartidos de `design_tokens.css` — deja de redefinirlos con los valores grises viejos.
- `.tab.active` deja de ser siempre verde: nueva regla `.tab.active[data-module="X"]` por cada uno de los 7 módulos, usando su acento de identidad.
- Los mismos `data-module` (ya existen en `index.html`) se pueden reusar para colorear `#splash .splash-module:hover` por módulo — mejora menor, mismo mecanismo.
- El logo/reloj/pulso del header quedan como están (identidad de marca del sistema completo, no de un módulo) — no hay pedido de cambiarlos y no aportan a la confusión detectada.

## FR — mejora adicional más allá del color

El usuario pidió explícitamente que FR (el módulo de referencia) también se vea "más pro" aunque sea el mejor logrado hoy. Además de migrar su acento de amber a coral y sus tokens base a los compartidos:

- Aplica el nuevo sistema de elevación (tarjetas con degradé+sombra) que hoy no tiene — FR también es plano, solo tiene mejor disciplina de color que el resto.
- Aplica la nueva jerarquía de botones (hoy todos sus botones de toolbar son iguales, sin primario/secundario/peligro diferenciado — "Eliminar todo" debería ser el único tratado como peligro real).
- El acento de datos en vivo (`--fr-accent`, verde matrix `#00FF9C`, focus/hover/datos) no se toca — ni nombre ni valor. Solo `--fr-main` (identidad de módulo) cambia de ámbar a coral.

## Normalización adicional identificada (más allá de lo pedido)

- **Botón "Backup de CI" (rojo, no destructivo)** → pasa a secundario. Es un bug de semántica de color, no solo estética.
- **KPI tiles de SU** (cada uno con borde de color distinto sin criterio) → pasan a neutros por default, con el acento de módulo reservado solo para el dato más relevante de esa vista. (Corrección post-auditoría de código: en GR el "borde naranja" que se ve en el screenshot es el estado `:hover` de `.metric-card`, no un color fijo por tile — GR solo tiene 2 estados reales, gris default y verde `.highlight`. El problema real de GR no son las tiles, es el punto siguiente.)
- **GR tiene DOS sistemas de tabs con color "activo" distinto sin razón**: `.gr-subtab.active` (Formulación/Registro/Biblioteca/Conocimiento) usa verde `--highlight` (#70AD47), mientras `.config-tab.active` (Agentes/Aditivos/Granos dentro de Biblioteca) usa dorado `--primary` (#FFD700) — el color de marca real de GR. Se unifican ambos a dorado (el acento de identidad de GR).
- **GR mezcla dos tonos de ámbar sin sistema** (`--accent` #FFA000 para el header de "Métricas en Tiempo Real", `--secondary` #FFC107 para el resto de headers de sección) → se unifican a un solo tono (el acento de identidad de GR).
- **Headers de sección con colores sueltos** (CFG: verde/rojo por sección sin relación con nada; GR: naranja/dorado mezclados con el verde de la tab activa del propio GR) → se resuelven usando SIEMPRE el acento de identidad del módulo para headers de sección, reservando `--danger` solo para secciones realmente peligrosas (ej. "Hard Reset" en CFG sí amerita rojo).
- **Sub-tabs inconsistentes entre módulos** (píldora sólida vs. recuadro con borde vs. violeta) → un único patrón (ver sección de componentes) aplicado a los 7.

## Arquitectura de implementación (resumen — el detalle de secuencia va en el plan)

1. Crear `shared/design_tokens.css`, linkearlo en `index.html` antes de `main.css`.
2. `main.css`: quitar redefiniciones de tokens que ahora vienen del compartido; agregar selectores `.tab.active[data-module="X"]` por módulo.
3. Por cada módulo (GE, CI, CILAB, GR, SU, FR, CFG): podar su `:root` a solo tokens propios (acento de identidad + alias de dominio sin equivalente compartido); aplicar el nuevo lenguaje de componentes (botones/tarjetas/chips-vs-pills/tablas/tabs/foco) reemplazando las reglas actuales equivalentes.
4. Cada módulo se verifica con screenshot real (servidor local, chrome-devtools) antes/después — no se da por terminado un módulo sin confirmación visual, siguiendo la disciplina de "no busco quick fix" del usuario.
5. Ningún cambio toca `localStorage`, schemas de datos, `main.js`, o la lógica de `GR_COLOR_PALETTE`/`SU_COLOR_PALETTE`/chips de protocolo — solo CSS y los `data-module` ya existentes en el HTML.

## Addendum (2026-09-08) — corrección arquitectónica encontrada al planificar

Al pasar de spec a plan se detectó un problema real que esta spec no contemplaba: `main.js` (`cleanPreviousAssets()`/`cleanTrackedAssets()`, `main.js:519-570`) **elimina del DOM el `<link>` de CSS del módulo anterior** cada vez que se cambia de módulo (`removeCss: true` por default). Solo `main.css` (cargado como `<link>` estático en `index.html`, nunca trackeado como "asset inyectado") sobrevive toda la sesión.

Consecuencia: si el acento de identidad de cada módulo (`--gr-accent`, `--su-accent`, etc.) se definiera dentro del `:root` de CADA módulo (como decía la sección "Paleta de identidad" más arriba), esa variable dejaría de existir en el DOM apenas el usuario navega a otro módulo — y el nav principal (`main.css`, siempre visible, muestra los 7 tabs a la vez) no podría colorear un tab de un módulo que no está cargado en ese momento.

**Corrección:** los 7 valores hex de identidad de módulo se definen en `shared/design_tokens.css` (cargado como `<link>` estático en `index.html`, igual que `main.css` — sobrevive toda la sesión, nunca se descarga) bajo nombres propios sin colisión (`--ge-accent`, `--ci-accent`, `--cilab-accent`, `--gr-accent`, `--su-accent`, `--fr-accent-brand`, `--cfg-accent` — nótese `--fr-accent-brand` en vez de `--fr-accent`, porque ese nombre ya está tomado por el verde matrix de datos en vivo de FR, ver sección FR arriba). Cada módulo, en su propio `:root`, solo referencia el valor global con una línea (ej. FR: `--fr-main: var(--fr-accent-brand);`) — mantiene el nombre interno que ya usa en cientos de reglas (`var(--fr-main)`) intacto, sin tener que renombrar nada dentro del archivo de 2000+ líneas. No cambia ningún color ni ninguna decisión ya aprobada — solo dónde vive la fuente de verdad del valor.

## Validado con el usuario

- Identidad de color por módulo (no acento único) — aprobado.
- Paleta completa de 7 colores — aprobada, con dos ajustes pedidos por el usuario ya incorporados (GE blanco, FR con color nuevo porque el dorado pasa a GR).
- Dirección de sistema de componentes (elevación, jerarquía de botones, chips vs. pills, tabs con glow por módulo) — validada con mockup del dashboard de FR, aprobada ("esta bueno me gusta").
- Confirmado explícitamente que el sistema de color por protocolo/lote de GR/SU y los colores semánticos de estado quedan fuera de alcance y no se tocan.
