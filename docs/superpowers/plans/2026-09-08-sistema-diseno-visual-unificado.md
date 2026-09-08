# Sistema de Diseño Visual Unificado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unificar la base visual oscura y el sistema de componentes de los 7 módulos de biolab-app (GE, CI, CILAB, GR, SU, FR, CFG) alrededor de un archivo de tokens compartido y una paleta de identidad por módulo, sin tocar `main.js`, sin tocar colores semánticos de estado, sin tocar el sistema de color por protocolo/lote de GR/SU, y sin ningún cambio de lógica/datos/localStorage.

**Architecture:** Un nuevo `shared/design_tokens.css` cargado como `<link>` estático en `index.html` (igual que `main.css`, sobrevive toda la sesión — a diferencia del CSS de cada módulo, que `main.js` elimina del DOM al cambiar de módulo) define la base de superficies/texto/bordes/radios/espaciado/sombras Y los 7 colores de identidad de módulo (deben vivir acá, no en el `:root` de cada módulo, porque el nav principal necesita poder colorear los 7 tabs aunque solo un módulo esté cargado en un momento dado). Cada módulo mantiene su propio `:root` con SOLO sus alias internos (los nombres de variable que sus miles de líneas ya consumen, ej. `--dark-secondary`, `--tx2`, `--bd`) repuntados a los tokens compartidos, más su color de identidad repuntado al token de módulo correspondiente.

**Tech Stack:** CSS puro (custom properties), sin build step, sin frameworks. Verificación visual con `mcp__chrome-devtools__*` contra el servidor local (`localhost:8734`, ya corriendo).

---

## Contexto para quien ejecute este plan (zero-context briefing)

- App: SPA vanilla JS/CSS/HTML sin build step, mysology lab tool en uso diario real. `index.html` carga `main.css` (shell: header+nav+splash) y `main.js` (loader). Cada módulo (GE/CI/CILAB/GR/SU/FR/CFG) es un HTML fragment + su propio `<script>`/`<link>` que `main.js` inyecta dinámicamente en `#app-container` al hacer click en un tab.
- **Dato crítico de arquitectura, confirmado leyendo `main.js:519-570`:** `cleanTrackedAssets()` (llamada al cambiar de módulo) **elimina del DOM el `<link>` CSS del módulo anterior** (`removeCss: true` por default). Solo `main.css` (link estático en el `<head>` de `index.html`, nunca trackeado como "asset inyectado") sobrevive toda la sesión. Por eso los 7 colores de identidad de módulo van en el nuevo `shared/design_tokens.css`, que se linkea igual que `main.css` — estático, permanente.
- Spec completa (contexto de negocio, paleta aprobada por el usuario, principios): `docs/superpowers/specs/2026-09-07-sistema-diseno-visual-unificado-design.md` — leer antes de ejecutar si algo de este plan no tiene sentido.
- Servidor local YA está corriendo en `http://localhost:8734` (Python `http.server`). No hace falta levantarlo. Para verificar visualmente cada tarea se usan las tools `mcp__chrome-devtools__*` (ya usadas en la sesión de brainstorming — `new_page`, `navigate_page`/`evaluate_script` con `window.loadModule('XX')`, `take_screenshot`).
- **Nunca tocar:** `main.js`, cualquier archivo `*_app.js`/`*.js` (excepto la única excepción documentada en la Tarea 10 — un atributo `style=` inline en un archivo HTML estático, no lógica), `localStorage`, `GR_COLOR_PALETTE`/`SU_COLOR_PALETTE`/`_grResolveLoteColor`/`_suResolveLoteColor`/cualquier cosa con "protocolo" o "color por lote" en el nombre, colores semánticos de estado (`--ok`/`--warn`/`--danger` y sus alias por módulo `--highlight`/`--warning`/`--danger`/`--fr-ok`/`--fr-warn`/`--fr-bad`/`--wn`/`--er` — estos YA tienen el mismo valor en los 7 módulos, `#70AD47`/`#ED7D31`/`#C00000` respectivamente, confirmado por auditoría real; no se cambia su valor en ningún módulo).
- Cada tarea de módulo termina con una verificación visual real (screenshot antes/después) — no se marca una tarea como hecha sin evidencia visual, siguiendo la disciplina del proyecto ("no busco quick fix").

---

## File Structure

- **Create:** `shared/design_tokens.css` — nuevo archivo, tokens base + 7 colores de identidad de módulo.
- **Modify:** `index.html` — un `<link>` nuevo.
- **Modify:** `main.css` — repuntar tokens de superficie/texto/borde a los compartidos; agregar reglas de nav activo por módulo.
- **Modify:** `fr/fr_styles.css`, `ge/ge_styles.css`, `ci/ci_styles.css`, `cilab/cilab_styles.css`, `gr/gr_styles.css`, `su/su_styles.css`, `cfg/cfg_styles.css` — cada uno podado/actualizado según su tarea.
- **Modify:** `ci/ci_index.html` — una línea (atributo `style=` inline del botón "Backup de CI"), ver Tarea 10.

---

## Task 1: Crear `shared/design_tokens.css`

**Files:**
- Create: `shared/design_tokens.css`

- [ ] **Step 1: Crear el archivo con el contenido completo**

```css
/* ============================================================
   BIOLAB ENGINE — shared/design_tokens.css
   SSoT de tokens visuales compartidos por los 7 módulos + shell.
   Cargado como <link> ESTÁTICO en index.html (igual que main.css)
   — a diferencia del CSS de cada módulo, este NUNCA se descarga al
   cambiar de módulo (ver main.js:519-570, cleanTrackedAssets).
   Por eso los 7 colores de identidad de módulo viven acá: el nav
   principal necesita poder colorear los 7 tabs en todo momento,
   no solo mientras el módulo correspondiente está cargado.
   No tocar sin leer docs/superpowers/specs/2026-09-07-sistema-diseno-visual-unificado-design.md
   ============================================================ */

:root {
  /* ── Superficies (reemplaza la escala gris plana vieja #1D1D1D/#2D2D2D/#3D3D3D) ── */
  --surface-0: #0B0D11;   /* fondo de página, más profundo que surface-1 */
  --surface-1: #0F1115;   /* fondo base de módulo */
  --surface-2: #171A21;   /* tarjetas / paneles */
  --surface-3: #1E222C;   /* elementos anidados dentro de una tarjeta */
  --surface-deep: #0a0a0a; /* header/shell, el más profundo de todos */

  /* ── Texto ── */
  --text: #F2F4F8;
  --text-muted: #9AA1B2;
  --text-dim: #666E80;

  /* ── Bordes ── */
  --line: #262B36;
  --line-soft: #1C2029;
  --line-strong: #343B4A;

  /* ── Radios ── */
  --r-sm: 6px;
  --r-md: 8px;
  --r-lg: 12px;
  --r-pill: 20px;

  /* ── Espaciado (base 4px) ── */
  --sp-1: 4px;
  --sp-2: 8px;
  --sp-3: 12px;
  --sp-4: 16px;
  --sp-5: 20px;
  --sp-6: 24px;
  --sp-8: 32px;

  /* ── Sombra — dos niveles, no más ── */
  --shadow-card: 0 8px 20px -12px rgba(0,0,0,.5);
  --shadow-float: 0 30px 60px -20px rgba(0,0,0,.6);

  /* ── Semántico universal — YA coincide con los valores hardcodeados
     que los 7 módulos usan hoy (--highlight/--warning/--danger,
     --fr-ok/--fr-warn/--fr-bad, --wn/--er). Se define acá solo como
     SSoT de referencia / para CFG, que hoy no tiene ninguno propio.
     NO se le pide a ningún módulo que cambie su alias existente —
     ya tienen el valor correcto. ── */
  --ok: #70AD47;
  --warn: #ED7D31;
  --danger: #C00000;

  /* ── Transiciones (ya existen en main.css, SSoT acá también) ── */
  --t-fast: .15s ease;
  --t-base: .25s ease;
  --t-slow: .4s ease;

  /* ── Identidad de módulo — un color por eslabón del pipeline biológico.
     Ver spec para el razonamiento de cada elección. FR usa el sufijo
     "-brand" porque "--fr-accent" ya está tomado por el verde matrix
     de datos en vivo de FR (no se toca, es un acento distinto). ── */
  --ge-accent: #ECEFF4;      /* blanco/platino — fuente de verdad */
  --ci-accent: #2DD4BF;      /* teal — cultivo in-vitro */
  --cilab-accent: #8B7CF6;   /* violeta — motor analítico */
  --gr-accent: #E8A83D;      /* dorado — grano */
  --su-accent: #A8673F;      /* terracota — sustrato/tierra */
  --fr-accent-brand: #E8637A;/* coral — fructificación */
  --cfg-accent: #7C8798;     /* gris pizarra — infraestructura, no biología */
}
```

- [ ] **Step 2: Verificar que el archivo no tiene errores de sintaxis**

Abrir el archivo en el navegador directamente para confirmar que el CSS parsea sin errores:

```bash
python -c "import re; content = open('shared/design_tokens.css').read(); assert content.count('{') == content.count('}'), 'llaves desbalanceadas'; print('OK, ' + str(content.count(chr(45)+chr(45))) + ' variables aprox')"
```

Expected: `OK, N variables aprox` sin excepción.

- [ ] **Step 3: Commit**

```bash
git add shared/design_tokens.css
git commit -m "$(cat <<'EOF'
feat: crea shared/design_tokens.css, SSoT de tokens visuales

Define superficies, texto, bordes, radios, espaciado, sombras y los
7 colores de identidad de módulo. Se linkea como estático en
index.html en la siguiente tarea para que sobreviva toda la sesión
(el CSS de cada módulo se descarga al cambiar de módulo, ver
main.js:519-570).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Linkear `shared/design_tokens.css` en `index.html`

**Files:**
- Modify: `index.html:13-14`

- [ ] **Step 1: Editar el `<head>`**

Reemplazar:

```html
  <!-- Shell principal — NO incluye estilos de módulos -->
  <link rel="stylesheet" href="main.css">
```

por:

```html
  <!-- Tokens de diseño compartidos — SSoT de colores/espaciado/tipografía.
       Se carga ANTES de main.css para que main.css pueda consumir sus
       variables. Estático, igual que main.css: sobrevive toda la sesión. -->
  <link rel="stylesheet" href="shared/design_tokens.css">
  <!-- Shell principal — NO incluye estilos de módulos -->
  <link rel="stylesheet" href="main.css">
```

- [ ] **Step 2: Verificar en el navegador que ambos archivos cargan**

```javascript
// Via mcp__chrome-devtools__evaluate_script en la página ya abierta (pageId 2 de la sesión de brainstorming, o abrir una nueva con new_page a http://localhost:8734)
() => {
  const links = [...document.querySelectorAll('link[rel="stylesheet"]')].map(l => l.href);
  return links.filter(h => h.includes('design_tokens.css') || h.includes('main.css'));
}
```

Expected: array con las dos URLs (`.../shared/design_tokens.css`, `.../main.css`), ambas cargadas (no 404 — comprobar también con `mcp__chrome-devtools__list_network_requests` si hay dudas).

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
feat: linkea shared/design_tokens.css en index.html

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Capturar screenshots "antes" de referencia (si no se conservan de la sesión de brainstorming)

**Files:** ninguno (solo verificación)

- [ ] **Step 1: Confirmar que los screenshots "antes" de la sesión de brainstorming siguen disponibles**

Revisar `C:\Users\JET\Desktop\MOBY DICK\biolab-app\.superpowers\brainstorm\559-1788834840\content\` — ahí están `ss-ge.png`, `ss-ci.png`, `ss-cilab.png`, `ss-gr.png`, `ss-su.png`, `ss-fr.png`, `ss-cfg.png` (copiados durante el brainstorming). Si existen, son el "antes" de referencia — no hace falta recapturar. Si no existen (sesión limpiada), recapturar uno por módulo con `mcp__chrome-devtools__take_screenshot` contra `http://localhost:8734` (`window.loadModule('XX')` para cada uno) antes de tocar cualquier CSS.

- [ ] **Step 2 (solo si hubo que recapturar): guardar en `docs/superpowers/plans/screenshots-antes/`**

No commitear las imágenes (son solo para comparación visual durante la ejecución, no artefactos del repo) — dejarlas en el directorio de scratch o en `.superpowers/` (ya gitignoreado).

---

## Task 4: Actualizar `main.css` — tokens base + nav activo por módulo

**Files:**
- Modify: `main.css:8-44` (bloque `:root`)
- Modify: `main.css:197-205` (`.tab.active`)

- [ ] **Step 1: Repuntar el `:root` de `main.css` a los tokens compartidos**

Reemplazar el bloque completo (líneas 8-44):

```css
:root {
  /* Colores primarios */
  --primary:        #00CC33;
  --primary-light:  #00AA22;
  --accent:         #00AA22;
  --highlight:      #70AD47;
  --warning:        #ED7D31;
  --danger:         #C00000;

  /* Aliases semánticos usados en módulos */
  --ac:   #70AD47;   /* verde oliva */
  --ac2:  #7C6FFF;   /* violeta */
  --ac3:  #FF6B35;   /* naranja */
  --ac4:  #44AAFF;   /* celeste */
  --wn:   #00CC33;   /* verde alerta ok */
  --er:   #C00000;   /* rojo error */

  /* Tipografía */
  --tx:   #F5F5F5;
  --tx2:  #A0A0A0;
  --tx3:  #666666;

  /* Superficies */
  --bg:            #1D1D1D;
  --bg-secondary:  #2D2D2D;
  --bg-tertiary:   #3D3D3D;
  --bg-deep:       #0a0a0a;

  /* Bordes */
  --border:        #404040;
  --border-light:  #505050;

  /* Transiciones */
  --t-fast:  0.15s ease;
  --t-base:  0.25s ease;
  --t-slow:  0.4s ease;
}
```

por:

```css
:root {
  /* Colores primarios — el shell (header/nav/splash) conserva su verde
     matrix propio, es identidad del SISTEMA completo, no de un módulo.
     No se toca por esta iniciativa (no hay pedido de cambiarlo y no
     aporta a la confusión detectada). */
  --primary:        #00CC33;
  --primary-light:  #00AA22;
  --accent:         #00AA22;
  --highlight:      #70AD47;
  --warning:        #ED7D31;
  --danger:         #C00000;

  /* Aliases semánticos usados en módulos — sin cambios de valor */
  --ac:   #70AD47;
  --ac2:  #7C6FFF;
  --ac3:  #FF6B35;
  --ac4:  #44AAFF;
  --wn:   #00CC33;
  --er:   #C00000;

  /* Tipografía — repuntada a shared/design_tokens.css */
  --tx:   var(--text);
  --tx2:  var(--text-muted);
  --tx3:  var(--text-dim);

  /* Superficies — repuntadas a shared/design_tokens.css.
     Reemplaza la escala gris plana (#1D1D1D/#2D2D2D/#3D3D3D) por la
     base fría de FR, ahora compartida por los 7 módulos. */
  --bg:            var(--surface-1);
  --bg-secondary:  var(--surface-2);
  --bg-tertiary:   var(--surface-3);
  --bg-deep:       var(--surface-deep);

  /* Bordes — repuntados a shared/design_tokens.css */
  --border:        var(--line);
  --border-light:  var(--line-strong);

  /* Transiciones — sin cambios de valor (ya coinciden con shared) */
  --t-fast:  0.15s ease;
  --t-base:  0.25s ease;
  --t-slow:  0.4s ease;
}
```

- [ ] **Step 2: Agregar nav activo por módulo — reemplazar `.tab.active`**

Reemplazar (líneas 197-205):

```css
.tab.active {
  background: var(--bg-deep);
  color: var(--primary);
  border-color: var(--primary);
  font-weight: 700;
  box-shadow: 0 0 8px rgba(0, 204, 51, 0.18);
  text-shadow: 0 0 6px rgba(0, 204, 51, 0.25);
  transform: translateY(0);
}
```

por:

```css
/* Fallback genérico (no debería aplicarse nunca si los 7 data-module
   de abajo cubren todos los tabs — se deja por robustez) */
.tab.active {
  background: var(--bg-deep);
  color: var(--primary);
  border-color: var(--primary);
  font-weight: 700;
  box-shadow: 0 0 8px rgba(0, 204, 51, 0.18);
  text-shadow: 0 0 6px rgba(0, 204, 51, 0.25);
  transform: translateY(0);
}

/* Tab activo coloreado con la identidad del módulo correspondiente.
   Usa los tokens de shared/design_tokens.css (--ge-accent, etc.) —
   NUNCA los del :root de cada módulo, porque ese CSS se descarga al
   cambiar de módulo (main.js:519-570) y estos 7 selectores deben
   funcionar siempre, para cualquier tab, esté o no cargado. */
.tab.active[data-module="GE"] {
  background: var(--bg-deep);
  color: var(--ge-accent);
  border-color: var(--ge-accent);
  font-weight: 700;
  box-shadow: 0 0 8px rgba(236, 239, 244, 0.18);
  transform: translateY(0);
}
.tab.active[data-module="CI"] {
  background: var(--bg-deep);
  color: var(--ci-accent);
  border-color: var(--ci-accent);
  font-weight: 700;
  box-shadow: 0 0 8px rgba(45, 212, 191, 0.22);
  text-shadow: 0 0 6px rgba(45, 212, 191, 0.25);
  transform: translateY(0);
}
.tab.active[data-module="CILAB"] {
  background: var(--bg-deep);
  color: var(--cilab-accent);
  border-color: var(--cilab-accent);
  font-weight: 700;
  box-shadow: 0 0 8px rgba(139, 124, 246, 0.22);
  text-shadow: 0 0 6px rgba(139, 124, 246, 0.25);
  transform: translateY(0);
}
.tab.active[data-module="GR"] {
  background: var(--bg-deep);
  color: var(--gr-accent);
  border-color: var(--gr-accent);
  font-weight: 700;
  box-shadow: 0 0 8px rgba(232, 168, 61, 0.22);
  text-shadow: 0 0 6px rgba(232, 168, 61, 0.25);
  transform: translateY(0);
}
.tab.active[data-module="SU"] {
  background: var(--bg-deep);
  color: var(--su-accent);
  border-color: var(--su-accent);
  font-weight: 700;
  box-shadow: 0 0 8px rgba(168, 103, 63, 0.22);
  text-shadow: 0 0 6px rgba(168, 103, 63, 0.25);
  transform: translateY(0);
}
.tab.active[data-module="FR"] {
  background: var(--bg-deep);
  color: var(--fr-accent-brand);
  border-color: var(--fr-accent-brand);
  font-weight: 700;
  box-shadow: 0 0 8px rgba(232, 99, 122, 0.22);
  text-shadow: 0 0 6px rgba(232, 99, 122, 0.25);
  transform: translateY(0);
}
.tab.active[data-module="CFG"] {
  background: var(--bg-deep);
  color: var(--cfg-accent);
  border-color: var(--cfg-accent);
  font-weight: 700;
  box-shadow: 0 0 8px rgba(124, 135, 152, 0.22);
  transform: translateY(0);
}
```

Nota: no hace falta tocar `main.js` — `data-module="XX"` ya existe en cada `<button class="tab" data-module="XX" ...>` de `index.html:52-106`. Los selectores de atributo son puro CSS.

- [ ] **Step 2: Verificación visual — los 7 tabs, uno por uno**

```javascript
// mcp__chrome-devtools__evaluate_script, pageId de una página abierta en localhost:8734
() => { window.loadModule('GE'); return true; }
```

Tomar screenshot (`mcp__chrome-devtools__take_screenshot`) después de cargar cada uno de los 7 módulos (GE/CI/CILAB/GR/SU/FR/CFG) y confirmar visualmente que el tab activo en el nav superior toma el color correspondiente de la tabla de la spec (blanco/teal/violeta/dorado/terracota/coral/gris). Confirmar también que los otros 6 tabs (inactivos) se ven neutros — no deberían tener color propio en este punto (eso lo define cada módulo más adelante, ver Tarea siguiente sobre si hace falta un estado "inactivo coloreado" — **no está en el alcance de esta spec, los tabs inactivos quedan neutros como hoy**).

- [ ] **Step 3: Commit**

```bash
git add main.css
git commit -m "$(cat <<'EOF'
feat: main.css consume tokens compartidos, nav activo por módulo

.tab.active ya no es siempre verde — cada uno de los 7 data-module
usa el acento de identidad de ESE módulo (ver shared/design_tokens.css).
Los tokens de superficie/texto/borde de main.css ahora repuntan a los
compartidos en vez de redefinir la paleta gris plana vieja.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: FR — repuntar tokens base + valor de `--fr-main` a coral

**Files:**
- Modify: `fr/fr_styles.css:10-51` (bloque `:root`)

- [ ] **Step 1: Editar el `:root` de FR**

Reemplazar (líneas 10-51):

```css
:root {
    --accent: #5B9BD5;

    --dark-bg: #0F1115;
    --dark-primary: #181B22;
    --dark-secondary: #232733;

    /* Aliases para compatibilidad con clases frt-* */
    --ac:          var(--fr-accent);
    --ac2:         #7c6fff;
    --ac4:         #44aaff;
    --tx:          var(--text-light);
    --tx2:         var(--text-muted);
    --tx3:         #606880;
    --bg-deep:     var(--dark-bg);
    --bg-secondary:var(--dark-secondary);
    --bg-tertiary: #1a1d24;
    --er:          var(--fr-bad);
    --wn:          var(--fr-warn);

    --text-light: #F5F5F5;
    --text-muted: #A0A0A0;
    --border: #2E3340;
    --border-light: #3D4350;

    /* Acento principal del módulo FR (ámbar/dorado) */
    --fr-main: #D4A017;
    --fr-main-soft: #E5B73B;

    /* Acento matrix sutil (focus, datos, árbol, hover) */
    --fr-accent: #00FF9C;
    --fr-accent-soft: #36FFB3;
    --fr-accent-glow: rgba(0,255,156,0.18);

    /* Tipografía mono (datos, árbol, métricas) */
    --fr-font-mono: 'JetBrains Mono', 'SF Mono', 'Fira Code', 'Courier New', monospace;

    --fr-ok: #70AD47;
    --fr-warn: #ED7D31;
    --fr-bad: #C00000;
    --fr-neutral: #808080;
}
```

por:

```css
:root {
    --accent: #5B9BD5;

    /* Superficies — repuntadas a shared/design_tokens.css. FR ya tenía
       la paleta fría que ahora es la base compartida — estos 3 valores
       eran prácticamente idénticos a --surface-1/2/3, solo se formaliza
       la fuente de verdad. */
    --dark-bg: var(--surface-1);
    --dark-primary: var(--surface-2);
    --dark-secondary: var(--surface-3);

    /* Aliases para compatibilidad con clases frt-* (legacy, no tocar
       su uso interno — .frt-* consume estos nombres, ver fr_styles.css
       líneas 1460-1642) */
    --ac:          var(--fr-accent);
    --ac2:         #7c6fff;
    --ac4:         #44aaff;
    --tx:          var(--text-light);
    --tx2:         var(--text-muted);
    --tx3:         #606880;
    --bg-deep:     var(--dark-bg);
    --bg-secondary:var(--dark-secondary);
    --bg-tertiary: var(--surface-3);
    --er:          var(--fr-bad);
    --wn:          var(--fr-warn);

    /* --text-light/--text-muted quedan con sus valores hex literales
       tal cual estaban — NO indireccionar a var(--text)/var(--text-muted)
       del shared: son nombres iguales a los del shared, y el shared ya
       se cargó antes con un :root propio, así que apuntar "hacia afuera"
       con el mismo nombre crea una auto-referencia cíclica en el mismo
       elemento (:root) que CSS invalida (ver nota de "auto-referencia"
       al final de este plan). Como los valores ya son visualmente
       equivalentes a los del shared (#F5F5F5 ≈ #F2F4F8), no hay
       beneficio real en indireccionar — se dejan literales. */
    --text-light: #F5F5F5;
    --text-muted: #A0A0A0;
    --border: var(--line);
    --border-light: var(--line-strong);

    /* Acento principal del módulo FR — identidad de marca (coral,
       fructificación). Antes ámbar #D4A017; el ámbar ahora es de GR. */
    --fr-main: var(--fr-accent-brand);
    --fr-main-soft: #EC8494;

    /* Acento matrix sutil (focus, datos, árbol, hover) — SIN CAMBIOS,
       no es identidad de módulo, es un acento de interacción aparte
       ya documentado como decisión deliberada. */
    --fr-accent: #00FF9C;
    --fr-accent-soft: #36FFB3;
    --fr-accent-glow: rgba(0,255,156,0.18);

    /* Tipografía mono (datos, árbol, métricas) */
    --fr-font-mono: 'JetBrains Mono', 'SF Mono', 'Fira Code', 'Courier New', monospace;

    --fr-ok: #70AD47;
    --fr-warn: #ED7D31;
    --fr-bad: #C00000;
    --fr-neutral: #808080;
}
```

- [ ] **Step 2: Verificación visual**

```javascript
() => { window.loadModule('FR'); return true; }
```

Screenshot del Dashboard de FR. Confirmar: (a) el fondo se ve igual o muy similar a antes (la superficie ya era casi idéntica a la compartida, no debería notarse cambio visual acá), (b) cualquier elemento que use `--fr-main` (botón primario `.btn-fr`, `.metric-card.highlight`, headers de sección `.section-header h2`, chips `.fr-chip-pendiente`, `.fr-traza`) ahora se ve CORAL en vez de ámbar/dorado, (c) el verde matrix (`--fr-accent`, usado en `.fr-dash-teorico`, `.fr-subtab.active`, números `%`, el live-hint pulsante) sigue exactamente igual, sin cambios.

- [ ] **Step 3: Commit**

```bash
git add fr/fr_styles.css
git commit -m "$(cat <<'EOF'
feat(fr): repunta superficies a tokens compartidos, --fr-main a coral

--dark-bg/--dark-primary/--dark-secondary ahora referencian
shared/design_tokens.css (valores ya eran casi idénticos). --fr-main
(identidad de marca) pasa de ámbar a coral — el ámbar es ahora de GR.
--fr-accent (verde matrix, acento de datos en vivo) no se toca.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: FR — elevación real en tarjetas (degradé + sombra)

**Files:**
- Modify: `fr/fr_styles.css` — `.metrics-panel` (líneas 263-269), `.metric-card` (líneas 284-293), `.section-card` (líneas 347-353)

- [ ] **Step 1: Actualizar `.metrics-panel`**

Reemplazar:

```css
.metrics-panel {
    background: var(--dark-primary);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 18px;
    margin-bottom: 20px;
}
```

por:

```css
.metrics-panel {
    background: linear-gradient(180deg, var(--dark-primary), var(--dark-bg));
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 18px;
    margin-bottom: 20px;
    box-shadow: var(--shadow-card);
}
```

- [ ] **Step 2: Actualizar `.metric-card`**

Reemplazar:

```css
.metric-card {
    background: var(--dark-secondary);
    border: 1px solid var(--border);
    border-left: 3px solid var(--fr-main);
    border-radius: 8px;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 4px;
}
```

por:

```css
.metric-card {
    background: linear-gradient(180deg, var(--dark-secondary), var(--dark-primary));
    border: 1px solid var(--border);
    border-left: 3px solid var(--fr-main);
    border-radius: 8px;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    box-shadow: var(--shadow-card);
}
```

- [ ] **Step 3: Actualizar `.section-card`**

Reemplazar:

```css
.section-card {
    background: var(--dark-primary);
    border: 1px solid var(--border);
    border-radius: 12px;
    margin-bottom: 16px;
    overflow: hidden;
}
```

por:

```css
.section-card {
    background: linear-gradient(180deg, var(--dark-primary), var(--dark-bg));
    border: 1px solid var(--border);
    border-radius: 12px;
    margin-bottom: 16px;
    overflow: hidden;
    box-shadow: var(--shadow-card);
}
```

Nota: `overflow: hidden` en `.section-card` + `box-shadow` en el mismo elemento es compatible (el `box-shadow` se pinta fuera de la caja de recorte, `overflow:hidden` solo afecta contenido interno) — no hay conflicto.

- [ ] **Step 4: Verificación visual**

Screenshot del Dashboard de FR (Vista General, con las 6 tarjetas KPI: Total bolsas/Cosechadas/Archivadas/BE promedio/Biomasa seca/% Biomasa) y de una tarjeta expandida con `.section-card` (ej. abrir el panel de una bolsa). Confirmar que las tarjetas ahora tienen un degradé sutil de arriba a abajo y una sombra que las despega del fondo — comparar con el screenshot "antes" (`ss-fr.png`) para confirmar que es una mejora perceptible, no un cambio invisible.

- [ ] **Step 5: Commit**

```bash
git add fr/fr_styles.css
git commit -m "$(cat <<'EOF'
feat(fr): agrega elevación (degradé+sombra) a tarjetas y paneles

.metrics-panel, .metric-card y .section-card pasan de caja plana con
borde de 1px a degradé sutil + var(--shadow-card) — se despegan del
fondo en vez de fundirse con él.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: GE — repuntar tokens base + identidad blanca en 3 selectores

**Files:**
- Modify: `ge/ge_styles.css:6-38` (bloque `:root`)
- Modify: `ge/ge_styles.css:158-162` (`.btn-primary`)
- Modify: `ge/ge_styles.css:119-138` (`.tab.active`)
- Modify: `ge/ge_styles.css` (`.ct`, ubicar por búsqueda de texto `color: var(--primary);\n  margin-bottom: 8px;` dentro del bloque `.ct`)

- [ ] **Step 1: Editar el `:root` de GE**

Reemplazar (líneas 6-38):

```css
:root {
  --primary:      #00CC33;
  --primary-dim:  #00AA22;
  --accent:       #00AA22;
  --highlight:    #70AD47;
  --warning:      #ED7D31;
  --danger:       #C00000;

  --bg:           #161616;
  --bg2:          #1F1F1F;
  --bg3:          #2A2A2A;
  --bg4:          #353535;

  --tx:           #F2F2F2;
  --tx2:          #B0B0B0;
  --tx3:          #777777;

  --bd:           #353535;
  --bd2:          #4A4A4A;

  --c-species:    #70AD47;   /* verde */
  --c-strain:     #7C6FFF;   /* violeta */
  --c-phenotype:  #44AAFF;   /* azul */

  --st-normal:    #00CC33;
  --st-positivo:  #44AAFF;
  --st-atencion:  #ED7D31;
  --st-peligro:   #FF3B3B;

  --shadow-sm: 0 1px 2px rgba(0,0,0,.4);
  --shadow-md: 0 4px 12px rgba(0,0,0,.45);
  --shadow-lg: 0 12px 36px rgba(0,0,0,.55);
}
```

por:

```css
:root {
  /* --primary (verde) queda para usos semánticos/success internos de GE
     (badges CREATE, toasts, chips de taxonomía, mini-btn) — NO es la
     identidad del módulo. La identidad (blanco) es --ge-accent, usada
     solo en .btn-primary/.tab.active/.ct (ver más abajo). */
  --primary:      #00CC33;
  --primary-dim:  #00AA22;
  --accent:       #00AA22;
  --highlight:    #70AD47;
  --warning:      #ED7D31;
  --danger:       #C00000;

  /* Identidad de módulo GE (blanco/platino) — NO se redeclara acá.
     shared/design_tokens.css ya define --ge-accent en su :root, cargado
     antes de este archivo; los 3 selectores de abajo lo referencian
     directo con var(--ge-accent). Redeclararlo acá con el mismo nombre
     sería una auto-referencia cíclica (ver Tarea 5, mismo caso). */

  /* Superficies — repuntadas a shared/design_tokens.css */
  --bg:           var(--surface-1);
  --bg2:          var(--surface-2);
  --bg3:          var(--surface-3);
  --bg4:          var(--line-strong);

  --tx:           var(--text);
  --tx2:          var(--text-muted);
  --tx3:          var(--text-dim);

  --bd:           var(--line);
  --bd2:          var(--line-strong);

  --c-species:    #70AD47;
  --c-strain:     #7C6FFF;
  --c-phenotype:  #44AAFF;

  --st-normal:    #00CC33;
  --st-positivo:  #44AAFF;
  --st-atencion:  #ED7D31;
  --st-peligro:   #FF3B3B;

  --shadow-sm: 0 1px 2px rgba(0,0,0,.4);
  --shadow-md: 0 4px 12px rgba(0,0,0,.45);
  --shadow-lg: var(--shadow-float);
}
```

- [ ] **Step 2: `.btn-primary` → identidad blanca**

Reemplazar (líneas 158-162):

```css
.btn-primary {
  background: var(--primary);
  color: #001a05;
}
.btn-primary:hover { background: var(--primary-dim); transform: translateY(-1px); }
```

por:

```css
.btn-primary {
  background: var(--ge-accent);
  color: #14161A;
}
.btn-primary:hover { background: #D8DCE3; transform: translateY(-1px); }
```

- [ ] **Step 3: `.tab.active` (sub-nav interno de GE: Árbol/Grafo/Catálogo/API/Historial/Config) → identidad blanca**

Reemplazar (líneas 119-138, solo la porción de `.tab.active`):

```css
.tab.active {
  background: var(--bg3);
  color: var(--primary);
  border-color: rgba(0,204,51,.4);
  box-shadow: 0 0 0 1px rgba(0,204,51,.15);
}
```

por:

```css
.tab.active {
  background: var(--bg3);
  color: var(--ge-accent);
  border-color: rgba(236,239,244,.4);
  box-shadow: 0 0 0 1px rgba(236,239,244,.15);
}
```

(El resto de `.tab`/`.tab:hover` en ese bloque no cambia.)

- [ ] **Step 4: `.ct` (título de card, ej. "Detalle del Nodo") → identidad blanca**

Buscar el bloque exacto (línea ~223, dentro de `.ct { ... color: var(--primary); ... }`) y reemplazar solo esa línea:

```css
.ct {
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .8px;
  color: var(--primary);
  margin-bottom: 8px;
}
```

por:

```css
.ct {
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .8px;
  color: var(--ge-accent);
  margin-bottom: 8px;
}
```

- [ ] **Step 5: Elevación — `.card`, `.split-tree`, `.split-panel`**

Reemplazar (líneas 211-217):

```css
.card {
  background: var(--bg2);
  border: 1px solid var(--bd);
  border-radius: 12px;
  box-shadow: var(--shadow-sm);
}
```

por:

```css
.card {
  background: linear-gradient(180deg, var(--bg2), var(--bg));
  border: 1px solid var(--bd);
  border-radius: 12px;
  box-shadow: var(--shadow-card);
}
```

Reemplazar (líneas 269-276, `.split-tree, .split-panel`):

```css
.split-tree, .split-panel {
  background: var(--bg2);
  border: 1px solid var(--bd);
  border-radius: 12px;
  box-shadow: var(--shadow-sm);
  overflow: hidden;
  min-height: 520px;
}
```

por:

```css
.split-tree, .split-panel {
  background: linear-gradient(180deg, var(--bg2), var(--bg));
  border: 1px solid var(--bd);
  border-radius: 12px;
  box-shadow: var(--shadow-card);
  overflow: hidden;
  min-height: 520px;
}
```

- [ ] **Step 6: Verificación visual**

```javascript
() => { window.loadModule('GE'); return true; }
```

Screenshot de la vista Árbol (las dos cajas "Detalle del Nodo"/"Árbol Genético"). Confirmar: (a) las dos cajas principales tienen degradé+sombra, (b) el botón "+ Nueva Especie" (`.btn-primary`) es blanco con texto oscuro, (c) el tab activo del sub-nav ("Árbol") es blanco en vez de verde, (d) los títulos "Detalle del Nodo"/"Árbol Genético" (`.ct`) son blancos, (e) el nav PRINCIPAL de arriba (GE/CI/CILAB/...) muestra el tab "GE" en blanco (ya cubierto por la Tarea 4, confirmar que sigue consistente), (f) elementos que NO deberían cambiar: badges "CREATE" en el historial, chips de especie/cepa/fenotipo, toasts de éxito — todos siguen verdes.

- [ ] **Step 7: Commit**

```bash
git add ge/ge_styles.css
git commit -m "$(cat <<'EOF'
feat(ge): repunta superficies a tokens compartidos, identidad blanca

--bg/--bg2/--bg3/--bg4/--tx/--tx2/--tx3/--bd/--bd2 ahora referencian
shared/design_tokens.css. .btn-primary, el tab activo del sub-nav y
.ct (título de card) pasan de verde a blanco/platino (identidad de
GE, fuente de verdad del árbol genético) — el resto de usos de verde
(badges de auditoría, toasts, chips de taxonomía) no se toca, no son
identidad de módulo. .card/.split-tree/.split-panel ganan elevación
(degradé+sombra).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: CI — repuntar tokens base + identidad teal + fix botón rojo no-destructivo

**Files:**
- Modify: `ci/ci_styles.css:9-38` (bloque `:root`)
- Modify: `ci/ci_styles.css:254-255` (`.btn-p`)
- Modify: `ci/ci_styles.css:303-309` (`.btn-primary`)
- Modify: `ci/ci_styles.css:456-469` (`.gbtn`, específicamente `.gbtn.ci`)
- Modify: `ci/ci_styles.css:117-142` (`.ci-subtab.active`)
- Modify: `ci/ci_styles.css:172-183` (`.card`, elevación)
- Modify: `ci/ci_styles.css:1652-1666` (`.ci-dash-tile`, elevación)

- [ ] **Step 1: Editar el `:root` de CI**

Reemplazar (líneas 9-38):

```css
:root {
  --primary:       #00CC33;
  --primary-light: #00AA22;
  --accent:        #00AA22;
  --highlight:     #70AD47;
  --warning:       #ED7D31;
  --danger:        #C00000;
  --bg:            #1D1D1D;
  --bg-secondary:  #2D2D2D;
  --bg-tertiary:   #3D3D3D;
  --text-light:    #F5F5F5;
  --text-muted:    #A0A0A0;
  --border:        #404040;
  --border-light:  #505050;
  /* Short aliases */
  --ac:  #70AD47;
  --ac2: #7C6FFF;
  --ac3: #FF6B35;
  --ac4: #44AAFF;
  --tx:  #F5F5F5;
  --tx2: #A0A0A0;
  --tx3: #666666;
  --er:  #C00000;
  --wn:  #00CC33;
  --br:  #404040;
  --s1:  #1D1D1D;
  --s2:  #2D2D2D;
  --s3:  #3D3D3D;
  --mo:  'JetBrains Mono', monospace;
}
```

por:

```css
:root {
  /* --primary/--accent (verde) quedan para usos internos NO relacionados
     con identidad de módulo (ver .btn-add, .btn-wn, chips de score) — la
     identidad real de CI es teal, var(--ci-accent) del shared, usada
     puntualmente en los selectores de abajo. */
  --primary:       #00CC33;
  --primary-light: #00AA22;
  --accent:        #00AA22;
  --highlight:     #70AD47;
  --warning:       #ED7D31;
  --danger:        #C00000;

  /* Superficies — repuntadas a shared/design_tokens.css */
  --bg:            var(--surface-1);
  --bg-secondary:  var(--surface-2);
  --bg-tertiary:   var(--surface-3);
  /* --text-muted queda literal (no var(--text-muted)) — el token
     compartido tiene el MISMO nombre; indireccionar acá sería una
     auto-referencia cíclica en el mismo elemento :root (ver nota al
     final del plan). Mismo criterio que --text-light/--text-muted en
     la Tarea 5 (FR). Valor casi idéntico al compartido (#9AA1B2), sin
     pérdida real. */
  --text-light:    var(--text);
  --text-muted:    #9AA1B2;
  --border:        var(--line);
  --border-light:  var(--line-strong);

  --ac:  #70AD47;
  --ac2: #7C6FFF;
  --ac3: #FF6B35;
  --ac4: #44AAFF;
  --tx:  var(--text);
  --tx2: var(--text-muted);
  --tx3: var(--text-dim);
  --er:  #C00000;
  --wn:  #00CC33;
  --br:  var(--line);
  --s1:  var(--surface-1);
  --s2:  var(--surface-2);
  --s3:  var(--surface-3);
  --mo:  'JetBrains Mono', monospace;
}
```

(`--tx2: var(--text-muted);` arriba SÍ es válido — referencia la `--text-muted` LOCAL de CI, definida en la línea de encima dentro del mismo `:root`, no la del shared. No es el mismo caso de auto-referencia porque son nombres distintos, `--tx2` ≠ `--text-muted`.)

- [ ] **Step 2: `.btn-p` (primario) → teal**

Reemplazar (líneas 254-255):

```css
.btn-p { background: var(--accent); color: white; }
.btn-p:hover { background: #009922; }
```

por:

```css
.btn-p { background: var(--ci-accent); color: #052A26; }
.btn-p:hover { background: #4FE0CB; }
```

- [ ] **Step 3: `.btn-primary` → teal**

Reemplazar (líneas 303-309):

```css
.btn-primary {
  background: #00CC33; color: #1D1D1D; border: none;
  border-radius: 8px; cursor: pointer;
  font-family: 'Inter', sans-serif; font-weight: 700;
  transition: all 0.2s;
}
.btn-primary:hover { background: #00AA22; transform: translateY(-1px); }
```

por:

```css
.btn-primary {
  background: var(--ci-accent); color: #052A26; border: none;
  border-radius: 8px; cursor: pointer;
  font-family: 'Inter', sans-serif; font-weight: 700;
  transition: all 0.2s;
}
.btn-primary:hover { background: #4FE0CB; transform: translateY(-1px); }
```

- [ ] **Step 4: `.gbtn.ci` → teal**

Reemplazar (dentro del bloque de líneas 456-469, solo `.gbtn.ci`):

```css
.gbtn.ci  { background: #00CC33; color: #1D1D1D; }
.gbtn.ci:hover { box-shadow: 0 6px 16px rgba(0,204,51,0.4); }
```

por:

```css
.gbtn.ci  { background: var(--ci-accent); color: #052A26; }
.gbtn.ci:hover { box-shadow: 0 6px 16px rgba(45,212,191,0.4); }
```

(`.gbtn` base, `.gbtn.wn`, `.gbtn.er` no cambian — son semánticos, no identidad.)

- [ ] **Step 5: `.ci-subtab.active` → teal**

Reemplazar (dentro de líneas 117-142, solo `.active`):

```css
.ci-subtab.active {
  background: #00CC33 !important;
  color: #1D1D1D !important;
  border-color: #00CC33 !important;
  font-weight: 700 !important;
  box-shadow: 0 0 10px rgba(0,204,51,0.3);
}
```

por:

```css
.ci-subtab.active {
  background: var(--ci-accent) !important;
  color: #052A26 !important;
  border-color: var(--ci-accent) !important;
  font-weight: 700 !important;
  box-shadow: 0 0 10px rgba(45,212,191,0.35);
}
```

- [ ] **Step 6: Elevación — `.card` y `.ci-dash-tile`**

Reemplazar (líneas 172-183):

```css
.card {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  transition: border-color 0.3s, box-shadow 0.3s;
}
.card:hover {
  border-color: var(--border-light);
  box-shadow: 0 6px 16px rgba(0,0,0,0.25);
}
```

por:

```css
.card {
  background: linear-gradient(180deg, var(--bg-secondary), var(--bg));
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px;
  box-shadow: var(--shadow-card);
  transition: border-color 0.3s, box-shadow 0.3s;
}
.card:hover {
  border-color: var(--border-light);
  box-shadow: 0 6px 16px rgba(0,0,0,0.25);
}
```

Reemplazar (líneas 1652-1666):

```css
.ci-dash-tile {
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 13px 14px 11px;
  cursor: pointer;
  transition: border-color .15s, box-shadow .15s, transform .1s;
  position: relative;
}
.ci-dash-tile:hover {
  border-color: var(--ac);
  box-shadow: 0 4px 16px rgba(0,204,51,0.12);
  transform: translateY(-1px);
}
```

por:

```css
.ci-dash-tile {
  background: linear-gradient(180deg, var(--bg-tertiary), var(--bg-secondary));
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 13px 14px 11px;
  cursor: pointer;
  transition: border-color .15s, box-shadow .15s, transform .1s;
  position: relative;
  box-shadow: var(--shadow-card);
}
.ci-dash-tile:hover {
  border-color: var(--ci-accent);
  box-shadow: 0 4px 16px rgba(45,212,191,0.18);
  transform: translateY(-1px);
}
```

- [ ] **Step 7: Verificación visual del CSS**

```javascript
() => { window.loadModule('CI'); return true; }
```

Screenshot del Dashboard de CI. Confirmar: (a) tiles de fórmula (RESET38, AGO38, etc.) con degradé+sombra, hover ahora teal en vez de verde oliva, (b) el tab activo del sub-nav ("Dashboard") es teal, (c) botones primarios (si hay alguno visible en esta vista) son teal. El botón rojo "Backup de CI" NO cambia en esta tarea — se corrige en la Tarea 10 (requiere tocar `ci_index.html`, no `ci_styles.css`).

- [ ] **Step 8: Commit**

```bash
git add ci/ci_styles.css
git commit -m "$(cat <<'EOF'
feat(ci): repunta superficies a tokens compartidos, identidad teal

.btn-p, .btn-primary, .gbtn.ci y .ci-subtab.active pasan de verde a
teal (identidad de CI, cultivo in-vitro). El verde semántico interno
(.btn-add, .btn-wn, chips de score) no se toca. .card y .ci-dash-tile
ganan elevación (degradé+sombra).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Corregir foco de inputs inconsistente en CI (azul vs verde)

**Files:**
- Modify: `ci/ci_styles.css:2395` (`.seg-tc-estado-sel:focus`)
- Modify: `ci/ci_styles.css:2425` (`.seg-tc-textarea:focus`)

- [ ] **Step 1: Unificar a teal (identidad de CI) en vez de azul (`--ac4`)**

Reemplazar:

```css
.seg-tc-estado-sel:focus { outline: none; border-color: var(--ac4); }
```

por:

```css
.seg-tc-estado-sel:focus { outline: none; border-color: var(--ci-accent); }
```

Reemplazar:

```css
.seg-tc-textarea:focus { outline: none; border-color: var(--ac4); background: var(--bg); }
```

por:

```css
.seg-tc-textarea:focus { outline: none; border-color: var(--ci-accent); background: var(--bg); }
```

- [ ] **Step 2: Verificación**

Ubicación real: dentro de la sección de "Tandas" de una fórmula en CI (Formulación → Seguimiento). Verificar clickeando el select de estado y el textarea de notas, confirmar borde teal al enfocar (no azul).

- [ ] **Step 3: Commit**

```bash
git add ci/ci_styles.css
git commit -m "$(cat <<'EOF'
fix(ci): unifica color de foco de 2 inputs de SEG a teal

.seg-tc-estado-sel y .seg-tc-textarea usaban azul (--ac4) en vez del
teal de identidad de CI en su estado :focus — inconsistencia menor
encontrada en la auditoría, se alinea al resto de inputs del módulo.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Corregir botón "Backup de CI" — color rojo no-destructivo

**Files:**
- Modify: `ci/ci_index.html:70` (y las 2 variantes equivalentes sin color en líneas 215, 216, 296, 297 — solo la de línea 70 tiene el override rojo)

**Nota de alcance:** este es el único paso de todo el plan que toca un archivo `.html` en vez de `.css` — es un atributo `style=` inline, cero lógica/JS, cero riesgo de romper `main.js`/handlers. Se documenta explícitamente porque la spec dice "100% CSS"; esta es la única excepción, y es puramente de marcado, no de comportamiento.

- [ ] **Step 1: Quitar el override rojo inline**

Reemplazar en `ci/ci_index.html:70`:

```html
<button class="btn btn-s" style="height:24px;font-size:11px;padding:0 10px;border-color:var(--er);color:var(--er)" onclick="exportData()" title="Backup solo de datos de CI (fórmulas, cultivos, seguimiento) — no es un backup de todo el sistema, ver CFG para eso">💾 Backup de CI</button>
```

por:

```html
<button class="btn btn-s" style="height:24px;font-size:11px;padding:0 10px" onclick="exportData()" title="Backup solo de datos de CI (fórmulas, cultivos, seguimiento) — no es un backup de todo el sistema, ver CFG para eso">💾 Backup de CI</button>
```

(Se quita `border-color:var(--er);color:var(--er)` del `style=`. El botón queda con `.btn.btn-s` puro — mismo tratamiento secundario/gris que ya usan las otras 4 variantes idénticas del archivo, líneas 215/216/296/297. No se toca `onclick="exportData()"` ni ningún atributo funcional.)

- [ ] **Step 2: Verificación visual**

```javascript
() => { window.loadModule('CI'); return true; }
```

Screenshot del Dashboard de CI. Confirmar que "💾 Backup de CI" ahora se ve gris/secundario, igual que los otros botones no-destructivos del módulo, no rojo.

- [ ] **Step 3: Commit**

```bash
git add ci/ci_index.html
git commit -m "$(cat <<'EOF'
fix(ci): botón "Backup de CI" deja de usar color de peligro

Era un override inline con var(--er) (rojo) para una acción que no es
destructiva (solo exporta datos) — corrige semántica de color, pasa a
.btn.btn-s (secundario/gris), igual que las otras 4 variantes
equivalentes ya existentes en el archivo.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: CILAB — repuntar tokens base + valor de `--ac2` a violeta del sistema nuevo

**Files:**
- Modify: `cilab/cilab_styles.css:9-45` (bloque `:root`)
- Modify: `cilab/cilab_styles.css:160-168` (`.clab-card`, elevación)

- [ ] **Step 1: Editar el `:root` de CILAB**

Reemplazar (líneas 9-45):

```css
:root {
  --primary:       #00CC33;
  --primary-light: #00AA22;
  --accent:        #00AA22;
  --highlight:     #70AD47;
  --warning:       #ED7D31;
  --danger:        #C00000;
  --bg:            #1D1D1D;
  --bg-secondary:  #2D2D2D;
  --bg-tertiary:   #3D3D3D;
  --text-light:    #F5F5F5;
  --text-muted:    #A0A0A0;
  --border:        #404040;
  --border-light:  #505050;
  --ac:  #70AD47;
  --ac2: #7C6FFF;   /* violeta — primario de acento (botones/tabs activos) */
  --ac3: #FF6B35;
  --ac4: #44AAFF;
  --tx:  #F5F5F5;
  --tx2: #A0A0A0;
  --tx3: #666666;
  --er:  #C00000;
  --wn:  #00CC33;
  --br:  #404040;
  --s1:  #1D1D1D;
  --s2:  #2D2D2D;
  --s3:  #3D3D3D;
  --mo:  'JetBrains Mono', monospace;

  --st-activa:   #00CC33;
  --st-limitada: #FFC000;
  --st-exceso:   #ED7D31;
  --st-crit:     #C00000;
  --st-inactiva: #555555;
  --st-sindata:  #777777;
}
```

por:

```css
:root {
  --primary:       #00CC33;
  --primary-light: #00AA22;
  --accent:        #00AA22;
  --highlight:     #70AD47;
  --warning:       #ED7D31;
  --danger:        #C00000;

  /* Superficies — repuntadas a shared/design_tokens.css */
  --bg:            var(--surface-1);
  --bg-secondary:  var(--surface-2);
  --bg-tertiary:   var(--surface-3);
  --text-light:    var(--text);
  --text-muted:    #A0A0A0;
  --border:        var(--line);
  --border-light:  var(--line-strong);

  --ac:  #70AD47;
  /* --ac2 es la identidad de módulo de CILAB — ya era violeta,
     ahora repunta al token compartido (mismo tono, SSoT única) */
  --ac2: var(--cilab-accent);
  --ac3: #FF6B35;
  --ac4: #44AAFF;
  --tx:  var(--text);
  --tx2: var(--text-muted);
  --tx3: var(--text-dim);
  --er:  #C00000;
  --wn:  #00CC33;
  --br:  var(--line);
  --s1:  var(--surface-1);
  --s2:  var(--surface-2);
  --s3:  var(--surface-3);
  --mo:  'JetBrains Mono', monospace;

  --st-activa:   #00CC33;
  --st-limitada: #FFC000;
  --st-exceso:   #ED7D31;
  --st-crit:     #C00000;
  --st-inactiva: #555555;
  --st-sindata:  #777777;
}
```

(`--text-muted: #A0A0A0;` se deja como valor literal, no `var()`, por el mismo motivo cautelar documentado en la Tarea 8 — evita el riesgo de auto-referencia con el nombre igual del token compartido.)

Con este único cambio (`--ac2: var(--cilab-accent);`), CILAB queda automáticamente alineado — `.clab-btn-p`, `.clab-ct`, `.clab-subtab.active` y `.clab-btn-opt` (gradiente) YA usan `var(--ac2)` en su código actual, así que heredan el nuevo violeta sin tocar ni un selector más. Esto es una consecuencia directa de que CILAB, a diferencia de CI, ya tenía una arquitectura limpia de "una sola variable de marca" — confirmado en la auditoría.

- [ ] **Step 2: Elevación — `.clab-card`**

Reemplazar (líneas 160-168):

```css
.clab-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  transition: border-color 0.3s, box-shadow 0.3s;
}
.clab-card:hover { border-color: var(--border-light); }
```

por:

```css
.clab-card {
  background: linear-gradient(180deg, var(--bg-secondary), var(--bg));
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px;
  box-shadow: var(--shadow-card);
  transition: border-color 0.3s, box-shadow 0.3s;
}
.clab-card:hover { border-color: var(--border-light); }
```

- [ ] **Step 3: Verificación visual**

```javascript
() => { window.loadModule('CILAB'); return true; }
```

Screenshot del Analizador metabólico. Confirmar: (a) `.clab-card` (panel "INGREDIENTES") con degradé+sombra, (b) el botón "⚡ Optimizar" (`.clab-btn-opt`, gradiente violeta) sin cambios visuales apreciables (ya era ese tono), (c) las 6 pestañas de primer nivel (Analizador metabólico/Optimizador/Biblioteca biológica/Genética x Medio/Registro de ensayos/Conocimiento/Inteligencia) mantienen el violeta en su estado activo, (d) el gráfico de rutas metabólicas (el canvas oscuro con nodos) no se ve afectado — su fondo es propio, no usa `.clab-card`.

- [ ] **Step 4: Commit**

```bash
git add cilab/cilab_styles.css
git commit -m "$(cat <<'EOF'
feat(cilab): repunta superficies a tokens compartidos y --ac2 a shared

CILAB ya tenía una arquitectura limpia de "una sola variable de marca"
(--ac2, violeta) consumida por .clab-btn-p/.clab-ct/.clab-subtab.active/
.clab-btn-opt — repuntar esa única variable al token compartido
(--cilab-accent) alinea los 4 selectores sin tocarlos individualmente.
.clab-card gana elevación (degradé+sombra).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: GR — repuntar tokens base + consolidar identidad dorada (fix 2 inconsistencias reales)

**Files:**
- Modify: `gr/gr_styles.css:5-20` (bloque `:root`)
- Modify: `gr/gr_styles.css:146-153` (`.metrics-panel h2`)
- Modify: `gr/gr_styles.css:238-242` (`.section-header h2`)
- Modify: `gr/gr_styles.css:397-404` (`.data-table th`)
- Modify: `gr/gr_styles.css:676-683` (`.btn-primary`)
- Modify: `gr/gr_styles.css:1099-1104` (`.gr-subtab.active`)

**Nota de alcance — NO tocar:** líneas 1382-1727 aprox. (`.gr-reg-card`, `.gr-card-perf`, `.gr-card-footer`, `.gr-td-*`, custom properties `--gr-protocolo-color`/`--gr-protocolo-bg`) — bloque protegido, feature de color por protocolo de lote, rediseñado el 2026-09-07, fuera de alcance.

- [ ] **Step 1: Editar el `:root` de GR**

Reemplazar (líneas 5-20):

```css
:root {
    --primary: #FFD700;
    --primary-light: #FFEB3B;
    --secondary: #FFC107;
    --accent: #FFA000;
    --highlight: #70AD47;
    --warning: #ED7D31;
    --danger: #C00000;
    --dark: #1D1D1D;
    --dark-secondary: #2D2D2D;
    --dark-tertiary: #3D3D3D;
    --text-light: #F5F5F5;
    --text-muted: #A0A0A0;
    --border: #404040;
    --border-light: #505050;
}
```

por:

```css
:root {
    /* Identidad de módulo GR — dorado grano, un solo tono en vez de 3
       ambares distintos sin sistema (--primary/--secondary/--accent
       eran #FFD700/#FFC107/#FFA000, tres amarillos ligeramente
       distintos usados sin criterio — ver auditoría). Se consolidan
       los 3 al mismo token compartido. */
    --primary: var(--gr-accent);
    --primary-light: #F2C168;
    --secondary: var(--gr-accent);
    --accent: var(--gr-accent);
    --highlight: #70AD47;
    --warning: #ED7D31;
    --danger: #C00000;

    /* Superficies — repuntadas a shared/design_tokens.css */
    --dark: var(--surface-1);
    --dark-secondary: var(--surface-2);
    --dark-tertiary: var(--surface-3);
    --text-light: var(--text);
    --text-muted: #A0A0A0;
    --border: var(--line);
    --border-light: var(--line-strong);
}
```

(`--text-muted` queda literal por la misma razón cautelar de las tareas anteriores.)

Con este cambio, `.metrics-panel h2` (usa `--accent`), `.section-header h2` (usa `--secondary`) y `.data-table th`/`.btn-primary` (usan `--primary`) quedan automáticamente en el MISMO dorado — ya no hace falta editarlos individualmente para el color. Sí hace falta un paso extra en `.data-table th` porque tiene `color: black` fijo (repasar que siga siendo legible sobre el nuevo dorado — `#E8A83D` es más oscuro que `#FFD700`, confirmar contraste en el Step 3 de verificación).

- [ ] **Step 2: `.gr-subtab.active` → dorado (fix de la inconsistencia real: usaba verde)**

Reemplazar (líneas 1099-1104):

```css
.gr-subtab.active {
    background: var(--highlight, #70AD47);
    color: #fff;
    border-color: var(--highlight, #70AD47);
    font-weight: 700;
}
```

por:

```css
.gr-subtab.active {
    background: var(--gr-accent);
    color: #1D1D1D;
    border-color: var(--gr-accent);
    font-weight: 700;
}
```

(`.config-tab.active`, líneas 927-931, ya usa `var(--primary)` — con el Step 1 ya consolidado, hereda el dorado automáticamente sin tocarlo. Esto resuelve la inconsistencia real encontrada: los dos sistemas de tabs de GR quedan con el mismo color de "activo".)

- [ ] **Step 3: Verificación de contraste en `.data-table th`**

```javascript
// Cargar GR, ir a Formulación → CT, tomar screenshot de la tabla
() => { window.loadModule('GR'); return true; }
```

Confirmar visualmente que "Componente | Tipo | Volumen Seco | Masa Seca | Densidad | Notas" sigue siendo legible (texto negro sobre `#E8A83D` — más oscuro que el `#FFD700` original, pero sigue siendo un dorado claro, el contraste con negro debería seguir siendo alto). Si el contraste se ve pobre en la captura, cambiar `color: black;` a `color: #1D1D1D;` en `.data-table th` (línea 398) — cambio de respaldo, aplicar solo si la verificación visual lo justifica.

- [ ] **Step 4: Verificación visual completa**

Screenshots de: Formulación (KPIs + tabla CT), Registro (cards de protocolo — confirmar que el color-por-lote sigue funcionando igual, NO debe verse afectado), Biblioteca (`.config-tab.active`). Comparar contra `ss-gr.png`.

- [ ] **Step 5: Commit**

```bash
git add gr/gr_styles.css
git commit -m "$(cat <<'EOF'
feat(gr): repunta superficies a tokens compartidos, consolida 3 ambares

--primary/--secondary/--accent eran 3 tonos de amarillo distintos
(#FFD700/#FFC107/#FFA000) sin ningún criterio de cuándo usar cada
uno — se consolidan a un solo --gr-accent (identidad de módulo).
Fix de inconsistencia real: .gr-subtab.active usaba verde (--highlight)
mientras .config-tab.active (mismo concepto, otra pestaña de GR) ya
usaba dorado — ambos quedan dorados. No se toca el bloque de color
por protocolo (.gr-reg-card y custom properties --gr-protocolo-*).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: SU — repuntar tokens base + fix bug real (`--su-primary` indefinida) + consolidar identidad terracota

**Files:**
- Modify: `su/su_styles.css:6-27` (bloque `:root`)
- Modify: `su/su_styles.css:148-196` (tiles de métrica — quitar rainbow)
- Modify: `su/su_styles.css:1264-1269` (`.su-subtab.active` — fix bug)
- Modify: `su/su_styles.css:887-925` (`.results-section`/`.result-card.highlight` — fix bug)
- Modify: `su/su_styles.css:1291-1295` (`#tablaRegistros tbody tr.su-registro-row:hover` — fix bug)
- Modify: `su/su_styles.css:1839-1850` (`#dbTable .db-lote-select` — fix bug)
- Modify: `su/su_styles.css:2056-2072` (`.su-sub-header`/`.su-card-sub` — fix bug)

**Nota de alcance — NO tocar:** `.su-card-color-swatch` (líneas 2033-2041) — es el swatch del feature de color por protocolo (JS en `su_app.js:1526`), solo su tamaño/forma son CSS puro y no hace falta tocarlos, no están rotos.

- [ ] **Step 1: Editar el `:root` de SU — consolidar identidad + agregar `--su-primary` real**

Reemplazar (líneas 6-27):

```css
:root {
    --primary: #1F4E79;
    --primary-light: #2E7DCC;
    --secondary: #4472C4;
    --accent: #5B9BD5;
    --highlight: #70AD47;
    --warning: #ED7D31;
    --danger: #C00000;
    --dark: #1D1D1D;
    --dark-secondary: #2D2D2D;
    --dark-tertiary: #3D3D3D;
    --text-light: #F5F5F5;
    --text-muted: #A0A0A0;
    --border: #404040;
    --border-light: #505050;

    /* Colores SU específicos */
    --su-fibra: #8B5A2B;
    --su-agua: #44aaff;
    --su-aditivo: #70AD47;
    --su-hyd: #ED7D31;
}
```

por:

```css
:root {
    /* Identidad de módulo SU — terracota/tierra. --primary/--secondary/
       --accent eran 3 tonos de azul sin relación con el terracota real
       usado en --su-fibra — se consolidan. --su-primary (bug real: se
       usaba en 6 selectores del archivo sin estar nunca definida acá,
       siempre caía al fallback hardcodeado #8B5CF6 violeta) ahora existe
       de verdad. */
    --primary: var(--su-accent);
    --primary-light: #C08661;
    --secondary: var(--su-accent);
    --accent: var(--su-accent);
    --su-primary: var(--su-accent);
    --highlight: #70AD47;
    --warning: #ED7D31;
    --danger: #C00000;

    /* Superficies — repuntadas a shared/design_tokens.css */
    --dark: var(--surface-1);
    --dark-secondary: var(--surface-2);
    --dark-tertiary: var(--surface-3);
    --text-light: var(--text);
    --text-muted: #A0A0A0;
    --border: var(--line);
    --border-light: var(--line-strong);

    /* Colores SU específicos — funcionales (fibra/agua/hidratación),
       NO identidad de módulo. --su-fibra pasa a ser el MISMO valor
       que la identidad de módulo (terracota) porque conceptualmente
       ya representaba lo mismo (sustrato/fibra); --su-agua/--su-hyd
       quedan como acentos funcionales puntuales, no de fondo de tile
       (ver Step 2). */
    --su-fibra: var(--su-accent);
    --su-agua: #44aaff;
    --su-aditivo: #70AD47;
    --su-hyd: #ED7D31;
}
```

- [ ] **Step 2: Tiles de métrica — quitar el "rainbow" (4 acentos sin criterio → neutro + 1 destacado)**

Reemplazar (líneas 134-196, bloque completo de `.metric-card` y variantes):

```css
.metric-card {
    background: var(--dark-tertiary);
    border-radius: 10px;
    padding: 15px;
    text-align: center;
    border: 1px solid var(--border);
    transition: transform 0.2s, border-color 0.2s;
}

.metric-card:hover {
    transform: translateY(-2px);
    border-color: var(--accent);
}

.metric-card.highlight {
    border-color: var(--highlight);
    background: rgba(112, 173, 71, 0.1);
}

.metric-card.su-fibra {
    border-color: var(--su-fibra);
    background: rgba(139, 90, 43, 0.15);
}

.metric-card.su-agua {
    border-color: var(--su-agua);
    background: rgba(68, 170, 255, 0.15);
}

.metric-card.su-hyd {
    border-color: var(--su-hyd);
    background: rgba(237, 125, 49, 0.15);
}

.metric-label { /* ... sin cambios, no se toca ... */ }
```

por (manteniendo intacto todo lo que sigue igual, solo el subset de colores de borde/fondo):

```css
.metric-card {
    background: linear-gradient(180deg, var(--dark-tertiary), var(--dark-secondary));
    border-radius: 10px;
    padding: 15px;
    text-align: center;
    border: 1px solid var(--border);
    transition: transform 0.2s, border-color 0.2s;
    box-shadow: var(--shadow-card);
}

.metric-card:hover {
    transform: translateY(-2px);
    border-color: var(--su-accent);
}

/* Único acento reservado para el dato MÁS relevante de la fila —
   antes 4 clases (highlight/su-fibra/su-agua/su-hyd) coloreaban tiles
   sin ningún criterio de jerarquía (ver auditoría 2026-09-08). Ahora
   solo existe UNA variante destacada, con el acento de identidad. */
.metric-card.highlight {
    border-color: var(--su-accent);
    background: rgba(168, 103, 63, 0.12);
}

.metric-card.su-fibra,
.metric-card.su-agua,
.metric-card.su-hyd {
    border-color: var(--border);
    background: linear-gradient(180deg, var(--dark-tertiary), var(--dark-secondary));
}

.metric-label { /* ... sin cambios, no se toca ... */ }
```

Y el bloque de `.metric-value` por variante (líneas 182-196):

```css
.metric-card.highlight .metric-value {
    color: var(--highlight);
}

.metric-card.su-fibra .metric-value {
    color: var(--su-fibra);
}

.metric-card.su-agua .metric-value {
    color: var(--su-agua);
}

.metric-card.su-hyd .metric-value {
    color: var(--su-hyd);
}
```

por:

```css
.metric-card.highlight .metric-value {
    color: var(--su-accent);
}

.metric-card.su-fibra .metric-value,
.metric-card.su-agua .metric-value,
.metric-card.su-hyd .metric-value {
    color: var(--text-light);
}
```

**Decisión sobre qué tile es `.highlight` (la única destacada):** esto lo decide el HTML (`su_index.html`, atributo `class` de cada tile), no el CSS — esta tarea NO reasigna qué tile lleva la clase `.highlight`/`.su-fibra`/`.su-agua`/`.su-hyd` (eso sería tocar el HTML/JS que arma esas clases, fuera de alcance de esta tarea CSS-only). El resultado práctico: las tiles que hoy tienen `su-fibra`/`su-agua`/`su-hyd` pasan a verse neutras (gris, como las que no tienen ninguna clase), y solo la que tiene `.highlight` (hoy "Total") queda con el acento terracota. Si el usuario quiere que sea OTRA tile la destacada, es un cambio de una palabra en `su_index.html` (cuál lleva `class="metric-card highlight"`) — no está en el alcance de este plan, mencionarlo en la verificación final por si lo pide.

- [ ] **Step 3: Fix bug `--su-primary` en `.su-subtab.active`**

Reemplazar (líneas 1264-1269):

```css
.su-subtab.active {
    background: var(--su-primary, #8B5CF6);
    color: #fff;
    border-color: var(--su-primary, #8B5CF6);
    font-weight: 700;
}
```

por:

```css
.su-subtab.active {
    background: var(--su-primary);
    color: #fff;
    border-color: var(--su-primary);
    font-weight: 700;
}
```

(Con `--su-primary` ahora definida en el `:root` — Step 1 — este selector automáticamente deja de caer al fallback violeta y usa terracota real. Se quita el fallback `, #8B5CF6` porque ya no hace falta y dejarlo podría confundir a alguien que lea el código pensando que sigue siendo necesario.)

- [ ] **Step 4: Fix bug `--su-primary` en `.results-section`/`.result-card.highlight`**

Reemplazar (líneas 887-889, 906-909, 923-925):

```css
.results-section {
    border: 2px solid var(--su-primary);
}
```
```css
.result-card.highlight {
    background: rgba(139, 92, 246, 0.15);
    border-color: var(--su-primary);
}
```
```css
.result-card.highlight .result-value {
    color: var(--su-primary);
}
```

por:

```css
.results-section {
    border: 2px solid var(--su-primary);
}
```
```css
.result-card.highlight {
    background: rgba(168, 103, 63, 0.15);
    border-color: var(--su-primary);
}
```
```css
.result-card.highlight .result-value {
    color: var(--su-primary);
}
```

(El `border: 2px solid var(--su-primary)` de `.results-section` no cambia de código — ya estaba bien escrito, solo estaba mal resuelto porque la variable no existía. Con el Step 1 ya queda corregido solo. El único cambio de código real es la `rgba(139, 92, 246, 0.15)` hardcodeada de `.result-card.highlight`, que hay que convertir a la nueva rgba de terracota a mano porque `rgba()` no puede tomar un `var()` de color hex directamente sin `color-mix()` — se hardcodea el equivalente.)

- [ ] **Step 5: Fix bug `--su-primary` en hover de fila de tabla**

Reemplazar (líneas 1291-1295):

```css
#tablaRegistros tbody tr.su-registro-row:hover {
    background-color: rgba(139, 92, 246, 0.08);
    transform: translateX(2px);
    box-shadow: inset 3px 0 0 var(--su-primary, #8B5CF6);
}
```

por:

```css
#tablaRegistros tbody tr.su-registro-row:hover {
    background-color: rgba(168, 103, 63, 0.08);
    transform: translateX(2px);
    box-shadow: inset 3px 0 0 var(--su-primary);
}
```

- [ ] **Step 6: Fix bug `--su-primary` en selects de tabla DB**

Reemplazar (líneas 1839, 1848, 1850):

```css
#dbTable .db-lote-select {
    width: 100%;
    padding: 5px 7px;
    background: rgba(255,255,255,0.04);
    color: var(--text-light, #F5F5F5);
    border: 1px solid rgba(139,92,246,0.35);
    border-radius: 5px;
    font-size: 0.81rem;
    cursor: pointer;
    transition: border-color 180ms;
    margin-bottom: 3px;
}
#dbTable .db-lote-select:hover,
#dbTable .db-lote-select:focus {
    border-color: #a78bfa;
    outline: none;
    box-shadow: 0 0 0 2px rgba(139,92,246,0.14);
}
```

por:

```css
#dbTable .db-lote-select {
    width: 100%;
    padding: 5px 7px;
    background: rgba(255,255,255,0.04);
    color: var(--text-light, #F5F5F5);
    border: 1px solid rgba(168,103,63,0.35);
    border-radius: 5px;
    font-size: 0.81rem;
    cursor: pointer;
    transition: border-color 180ms;
    margin-bottom: 3px;
}
#dbTable .db-lote-select:hover,
#dbTable .db-lote-select:focus {
    border-color: var(--su-primary);
    outline: none;
    box-shadow: 0 0 0 2px rgba(168,103,63,0.14);
}
```

- [ ] **Step 7: Fix bug `--su-primary` en `.su-sub-header`/`.su-card-sub`**

Reemplazar (línea 2056):

```css
.su-sub-header { /* ... */ background: rgba(139, 92, 246, 0.75); /* ... */ }
```

por:

```css
.su-sub-header { /* ... */ background: rgba(168, 103, 63, 0.75); /* ... */ }
```

Reemplazar (líneas 2071-2072):

```css
.su-card-sub { /* ... */ border-top: 1px dashed rgba(139, 92, 246, 0.18); background: rgba(139, 92, 246, 0.025); /* ... */ }
```

por:

```css
.su-card-sub { /* ... */ border-top: 1px dashed rgba(168, 103, 63, 0.18); background: rgba(168, 103, 63, 0.025); /* ... */ }
```

(Editar solo las propiedades de color mencionadas, dejando el resto de cada regla — display/padding/etc. — sin tocar. Leer el archivo real en esas líneas antes de aplicar el reemplazo, ya que el reporte de auditoría solo capturó las líneas de color, no la regla completa.)

- [ ] **Step 8: Verificación visual completa**

```javascript
() => { window.loadModule('SU'); return true; }
```

Screenshots de: Formulación de Sustrato (las 8 tiles de métrica — confirmar que ahora la mayoría son grises neutras y solo "Total" tiene acento terracota), Registro (tabla, confirmar hover terracota no violeta), sub-tabs (confirmar "Formulación de Sustrato" activo es terracota, no violeta). Comparar contra `ss-su.png` — el cambio más notorio debería ser la desaparición completa del violeta `#8B5CF6`/`#a78bfa` en cualquier parte de la UI de SU.

- [ ] **Step 9: Confirmar por grep que no queda ningún `8B5CF6`/`a78bfa`/`139, 92, 246`/`139,92,246` residual**

```bash
grep -n "8B5CF6\|a78bfa\|139, 92, 246\|139,92,246" su/su_styles.css
```

Expected: sin resultados (o, si algo queda, confirmar que es un uso legítimo no relacionado con `--su-primary`, no un olvido).

- [ ] **Step 10: Commit**

```bash
git add su/su_styles.css
git commit -m "$(cat <<'EOF'
fix(su): --su-primary nunca estaba definida, caía a violeta hardcodeado

Bug real encontrado en auditoría 2026-09-08: --su-primary se usaba en
6 selectores (.su-subtab.active, .results-section, .result-card.highlight,
hover de fila de tabla, selects de #dbTable, .su-sub-header/.su-card-sub)
sin estar definida en ningún :root del archivo — siempre caía al
fallback hardcodeado #8B5CF6 (violeta), completamente desconectado del
azul/terracota real de SU. Ahora --su-primary existe y apunta a
--su-accent (terracota, identidad de módulo). De paso se consolidan
--primary/--secondary/--accent (3 azules sin relación entre sí) al
mismo token, y se quita el "rainbow" de 4 acentos sin criterio en las
tiles de métrica (highlight/su-fibra/su-agua/su-hyd) — queda un solo
acento para el dato más relevante, el resto neutro.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: CFG — crear su primer `:root` propio (fix bug real: variables indefinidas)

**Files:**
- Modify: `cfg/cfg_styles.css:1-10` (agregar bloque `:root` nuevo, no existía)
- Modify: `cfg/cfg_styles.css:67-70` (`.module-header.cfg`)
- Modify: `cfg/cfg_styles.css:139-142` (`:focus` — fix mezcla verde/dorado)

- [ ] **Step 1: Agregar un `:root` real al inicio del archivo**

`cfg_styles.css` nunca definió su propio `:root` — dependía por completo de que otro módulo hubiera dejado el suyo en el DOM (comentario en el propio archivo, línea 4: *"Las variables CSS (:root) se asumen definidas globalmente en main.css"*, que es la premisa incorrecta: `main.css` define `--tx`/`--tx2`/`--tx3`/`--wn`/`--er`/`--ac2`/`--ac3`/`--ac4`/`--accent`/`--border`/`--bg-secondary`/`--bg-tertiary`, pero **NO** `--text-light`/`--text-muted`, que es lo que `cfg_styles.css` realmente consume en ~10 reglas — confirmado, esas dos quedan indefinidas cada vez que se entra a CFG).

Insertar al inicio del archivo, después del comentario de cabecera existente (antes de la línea 4 actual, o reemplazando el comentario que dice "se asumen definidas globalmente"):

```css
/* ============================================================
   MÓDULO CFG - Estilos
   :root PROPIO — antes este archivo no definía ninguno y dependía
   de que otro módulo hubiera dejado el suyo en el DOM (bug real,
   encontrado en auditoría 2026-09-08: --text-light/--text-muted
   quedaban indefinidas porque main.css usa --tx/--tx2/--tx3, no esos
   nombres — CFG los necesitaba y nunca los tuvo garantizados).
   ============================================================ */
:root {
    /* Identidad de módulo CFG — gris pizarra. No es parte de la
       biología del pipeline (GE→CI→CILAB→GR→SU→FR), es infraestructura
       del sistema — acento neutro a propósito. */
    --accent: var(--cfg-accent);

    /* Superficies — repuntadas a shared/design_tokens.css */
    --bg-secondary: var(--surface-2);
    --bg-tertiary: var(--surface-3);
    --border: var(--line);
    --border-light: var(--line-strong);
    --text-light: var(--text);
    --text-muted: #9AA1B2;

    /* Aliases ya usados por .ct.wn/.ct.er/.ct.pur/.ct.blu/.ct.or —
       antes resueltos por el :root que main.css deja siempre en el
       DOM (--wn/--er/--ac2/--ac3/--ac4), ahora definidos acá también
       para que CFG sea autocontenido y no dependa de ningún otro
       archivo cargado antes. Mismos valores que main.css, sin cambios
       de color. */
    --wn:  #00CC33;
    --er:  #C00000;
    --ac:  #70AD47;
    --ac2: #7C6FFF;
    --ac3: #FF6B35;
    --ac4: #44AAFF;
    --danger: #C00000;
}
```

- [ ] **Step 2: `.module-header.cfg` — dejar de hardcodear gris, usar tokens**

Reemplazar (líneas 67-70):

```css
.module-header.cfg {
  background: linear-gradient(135deg, #555 0%, #3D3D3D 100%);
  color: #F5F5F5;
}
```

por:

```css
.module-header.cfg {
  background: linear-gradient(135deg, var(--surface-3) 0%, var(--surface-1) 100%);
  color: var(--text-light);
}
```

- [ ] **Step 3: Fix mezcla de colores en `:focus` (verde borde + dorado glow)**

Reemplazar (líneas 139-142):

```css
input:focus, select:focus, textarea:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(255, 160, 0, 0.2);
}
```

por:

```css
input:focus, select:focus, textarea:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(124, 135, 152, 0.25);
}
```

(El glow ahora usa el mismo tono que `--cfg-accent`, en vez de un dorado hardcodeado que no tenía relación con el verde del borde.)

- [ ] **Step 4: Verificación visual**

```javascript
() => { window.loadModule('CFG'); return true; }
```

Screenshot de la vista completa de CFG. Confirmar: (a) los labels ("GitHub Token (PAT)", "Usuario / Repo") y el texto de los inputs se ven en un gris claro legible — antes de este fix, con `--text-light`/`--text-muted` indefinidas, el color real dependía 100% de qué módulo se hubiera visitado antes en la sesión (comportamiento no determinístico) — verificar entrando a CFG como PRIMER módulo de una sesión nueva (recargar la página entera, no solo cambiar de tab) para confirmar que ahora se ve bien incluso sin haber visitado ningún otro módulo antes, (b) el header "⚙️ CFG - Configuración" usa el degradé de superficies compartidas, (c) al hacer foco en un input, el glow es gris neutro, no dorado.

- [ ] **Step 5: Verificación específica del bug — cargar CFG como único módulo de la sesión**

```javascript
// Nueva pestaña limpia, ir directo a CFG sin pasar por ningún otro módulo antes
() => { window.loadModule('CFG'); return true; }
```

(Usar `mcp__chrome-devtools__new_page` a `http://localhost:8734`, y ANTES de cualquier otro `loadModule`, ejecutar `loadModule('CFG')` directamente — este es el escenario exacto que antes fallaba, porque ningún módulo había dejado su `:root` en el DOM todavía.) Confirmar con `getComputedStyle`:

```javascript
() => {
  const el = document.querySelector('#gh-token') || document.querySelector('input');
  const cs = getComputedStyle(el);
  return { color: cs.color, background: cs.backgroundColor };
}
```

Expected: `color` resuelve a un gris claro real (ej. `rgb(242, 244, 248)`), no `rgb(0, 0, 0)` ni vacío.

- [ ] **Step 6: Commit**

```bash
git add cfg/cfg_styles.css
git commit -m "$(cat <<'EOF'
fix(cfg): agrega :root propio — bug real de variables indefinidas

cfg_styles.css nunca definió su propio :root (comentario decía que
las variables "se asumen definidas globalmente en main.css") — pero
main.css usa --tx/--tx2/--tx3, no --text-light/--text-muted, que es
lo que CFG realmente consume en ~10 reglas (labels, inputs, tablas).
Resultado: color de texto indeterminista, dependiente de qué otro
módulo se hubiera cargado antes en la sesión. Ahora CFG es
autocontenido, con --cfg-accent (gris pizarra, identidad de módulo —
no es parte del pipeline biológico) y superficies repuntadas a
shared/design_tokens.css. De paso se corrige un glow de foco dorado
hardcodeado que no tenía relación con el verde del borde.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Verificación final cruzada — los 7 módulos en una sola pasada

**Files:** ninguno (solo verificación)

- [ ] **Step 1: Screenshot de los 7 módulos en secuencia, sesión nueva**

Abrir una página nueva (`mcp__chrome-devtools__new_page` a `http://localhost:8734`) y, EN ORDEN (GE → CI → CILAB → GR → SU → FR → CFG), cargar cada módulo y tomar screenshot. Esto verifica: (a) que cada módulo se ve bien la PRIMERA vez que se visita en una sesión (no solo en recargas repetidas), (b) que el nav superior colorea correctamente cada tab activo con su identidad, (c) que no hay ningún error de consola (`mcp__chrome-devtools__list_console_messages`) por variable CSS mal resuelta o similar.

- [ ] **Step 2: Comparar cada screenshot "después" contra su "antes" correspondiente**

Confrontar contra `ss-ge.png`, `ss-ci.png`, `ss-cilab.png`, `ss-gr.png`, `ss-su.png`, `ss-fr.png`, `ss-cfg.png` (de `.superpowers/brainstorm/559-1788834840/content/`, ver Tarea 3). Confirmar para cada uno: superficie más fría/oscura (coherente con la base de FR), identidad de color correcta según la tabla de la spec, sin regresiones de legibilidad (texto siempre con contraste suficiente sobre su fondo).

- [ ] **Step 3: Confirmar que el sistema de color por protocolo (GR/SU) sigue intacto**

En GR → Registro y SU → Registro, confirmar visualmente que las cards de lote siguen mostrando SU PROPIO color individual (el de la cola rotativa de 12, `GR_COLOR_PALETTE`/`SU_COLOR_PALETTE`) sin ninguna alteración — no debería haber cambiado nada acá, esta verificación es para confirmar que efectivamente no se tocó por accidente.

- [ ] **Step 4: Confirmar ausencia de errores de consola en los 7 módulos**

```javascript
// Después de visitar los 7, mcp__chrome-devtools__list_console_messages
```

Expected: sin errores nuevos relacionados a CSS/variables (pueden existir warnings preexistentes no relacionados con este trabajo — no es objetivo de este plan corregirlos).

- [ ] **Step 5: Actualizar la spec con una nota de cierre**

Agregar al final de `docs/superpowers/specs/2026-09-07-sistema-diseno-visual-unificado-design.md` una sección breve "Implementado" con fecha y el link al plan, y los 2 bugs reales encontrados durante la implementación (`--su-primary` indefinida en SU, `:root` faltante en CFG) — siguiendo la convención del proyecto de documentar hallazgos no triviales (CLAUDE.md regla de "toda decisión arquitectónica importante... se documenta").

- [ ] **Step 6: Commit final**

```bash
git add docs/superpowers/specs/2026-09-07-sistema-diseno-visual-unificado-design.md
git commit -m "$(cat <<'EOF'
docs: cierra spec del sistema de diseño visual unificado

Implementación completa y verificada visualmente en los 7 módulos.
2 bugs reales encontrados y corregidos en el camino: --su-primary
indefinida en SU (caía a violeta hardcodeado), :root faltante en CFG
(--text-light/--text-muted indefinidas).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review (completado por quien escribió este plan)

**Cobertura de la spec:** tokens compartidos (Task 1-2) ✓, shell/nav por módulo (Task 4) ✓, paleta de 7 colores aplicada (Tasks 5,7,8,11,12,13,14) ✓, elevación de tarjetas (Tasks 6,7,8,11,13) ✓, botón "Backup de CI" (Task 10) ✓, foco de inputs (Task 9) ✓, GR/SU tabs y ambares inconsistentes (Tasks 12-13) ✓, CFG headers/foco (Task 14) ✓, exclusión de `main.js`/colores semánticos/color-por-protocolo (documentado en cada tarea relevante + verificado en Task 15) ✓.

**Hallazgos nuevos durante la escritura del plan, no en la spec original:** el problema de `cleanTrackedAssets` (documentado como addendum en la spec y como contexto en el header de este plan), el bug real de `--su-primary` indefinida en SU, el bug real de `:root` faltante en CFG, la corrección sobre las tiles de GR (no eran 6 colores fijos, era un hover capturado en el screenshot). Los tres primeros ameritan mención en el commit de cierre (Task 15, Step 5).

**Riesgo de auto-referencia de variables CSS:** identificado y resuelto en Tasks 5, 7, 8, 11 — cualquier `:root` de módulo que necesite repuntar un alias local a un token compartido CON EL MISMO NOMBRE (ej. `--text-muted` local vs `--text-muted` de `shared/design_tokens.css`) debe verificarse con `getComputedStyle` antes de darse por bueno (riesgo real de que el navegador no resuelva la auto-referencia como se espera) — donde hubo dudas, se optó por el valor literal en vez de `var()`.
