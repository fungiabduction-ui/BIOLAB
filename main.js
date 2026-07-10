/**
 * ============================================================
 *  BIOLAB ENGINE v3 — main.js
 *  Motor central SPA sin frameworks.
 * ------------------------------------------------------------
 *  Responsabilidades:
 *    1. Reloj del sistema (actualización 1 Hz).
 *    2. Carga dinámica de módulos (HTML + CSS + JS).
 *    3. Limpieza de recursos inyectados al cambiar de módulo.
 *    4. Gestión de la pestaña (.tab) activa.
 *    5. Bus de eventos global entre módulos.
 *    6. Hash-routing (#GE, #CI, ...).
 *    7. Hooks de drag & drop para reordenar pestañas (opt-in).
 * ------------------------------------------------------------
 *  Reglas:
 *    • Este archivo NO contiene lógica de negocio de módulos.
 *    • Los módulos pueden ser HTML parcial (fragmento) o
 *      documento HTML completo — el loader tolera ambos.
 *    • Nunca duplica assets que ya están cargados en el shell.
 * ============================================================
 */

'use strict';

/* ────────────────────────────────────────────────────────────
   0. CONFIGURACIÓN
   ──────────────────────────────────────────────────────────── */
const BIOLAB = {
  /** Módulo activo actualmente (clave del mapa MODULES). */
  activeModule: null,

  /**
   * Token de cache-busting para assets de módulos (CSS + JS).
   * Se genera UNA vez por sesión (no por cada navegación entre módulos),
   * por lo que no re-descarga innecesariamente. Pero al recargar la
   * página — o después de un hardReset() que bumpa el token en LS —
   * el navegador obtiene siempre los archivos frescos del servidor.
   *
   * Jerarquía de resolución:
   *   1. window.BIOLAB_BUILD_ID  → definido en deploys (constante por build)
   *   2. localStorage 'biolab.cv' → bumpeado por hardReset() antes de reload
   *   3. Fallback: epoch ms → siempre fresco (modo desarrollo puro)
   */
  _cv: (function () {
    if (window.BIOLAB_BUILD_ID) return window.BIOLAB_BUILD_ID;
    try {
      const stored = localStorage.getItem('biolab.cv');
      if (stored) return stored;
    } catch (_) {}
    return Date.now().toString(36);
  })(),

  /**
   * Mapa de módulos: id (mayúsculas) → ruta relativa del HTML parcial.
   * La carpeta del módulo se DERIVA de esta ruta, nunca del id,
   * para respetar case-sensitivity del servidor.
   */
  modules: {
    GE:  'ge/ge_index.html',
    CI:  'ci/ci_index.html',
    CILAB: 'cilab/cilab_index.html',
    GR:  'gr/gr_index.html',
    SU:  'su/su_index.html',
    FR:  'fr/fr_index.html',
    CFG: 'cfg/cfg_index.html',
  },

  /** IDs de <link>/<script> inyectados por el loader para poder
   *  desmontarlos al cambiar de módulo. */
  _injectedAssets: [],

  /** Registro de listeners del bus de eventos global. */
  _eventListeners: {},

  /** Timers y utilidades internas del shell (no se reinyectan). */
  _clockTimer: null,

  /** Control de concurrencia del loader (evita carreras entre navegaciones). */
  _loadSeq: 0,
  _loadController: null,
  _loadingModule: null,
};

const LOAD_CANCELLED_CODE = 'BIOLAB_LOAD_CANCELLED';

/**
 * Añade ?v=<token> a una URL para invalidar el caché del navegador.
 * Respeta URLs que ya tienen query string (usa & en vez de ?).
 * No modifica URLs externas de otros orígenes ni data:/blob: URIs.
 */
function bustUrl(url) {
  if (!url) return url;
  if (/^(?:https?:)?\/\//i.test(url) && !url.startsWith(location.origin)) return url;
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}v=${BIOLAB._cv}`;
}

function createLoadCancelledError() {
  const err = new Error('Carga de modulo cancelada por una navegacion mas reciente.');
  err.code = LOAD_CANCELLED_CODE;
  return err;
}

function isLoadCancelledError(err) {
  return Boolean(
    err &&
    (err.code === LOAD_CANCELLED_CODE || err.name === 'AbortError')
  );
}

function assertFreshLoad(loadSeq) {
  if (loadSeq !== BIOLAB._loadSeq) throw createLoadCancelledError();
}


/* ────────────────────────────────────────────────────────────
   1. RELOJ DEL SISTEMA (header)
   ──────────────────────────────────────────────────────────── */

/** Pinta fecha y hora en los elementos #sys-date y #sys-time. */
function updateClock() {
  const now  = new Date();
  const date = now.toLocaleDateString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
  const time = now.toLocaleTimeString('es-AR', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });

  const elDate = document.getElementById('sys-date');
  const elTime = document.getElementById('sys-time');
  if (elDate) elDate.textContent = date;
  if (elTime) elTime.textContent = time;
}

/** Inicia el reloj y lo mantiene vivo una sola vez. */
function startClock() {
  if (BIOLAB._clockTimer) return;           // idempotente
  updateClock();
  BIOLAB._clockTimer = setInterval(updateClock, 1000);
}


/* ────────────────────────────────────────────────────────────
   2. MOTOR DE CARGA DE MÓDULOS
   ──────────────────────────────────────────────────────────── */

/**
 * Carga un módulo de forma dinámica:
 *   1) fetch del HTML parcial (o documento completo).
 *   2) Parseo con DOMParser.
 *   3) Extracción de <link rel="stylesheet"> y <script> (head + body).
 *   4) Cleanup de assets del módulo anterior.
 *   5) Inyección del contenido del body en #app-container.
 *   6) Carga secuencial de CSS, luego scripts.
 *   7) Emite evento global "moduleLoaded".
 *
 * @param {string} moduleName - Clave del módulo (ej: 'CI')
 */
async function loadModule(moduleName) {
  const path = BIOLAB.modules[moduleName];
  if (!path) {
    console.error(`[BIOLAB] Módulo desconocido: "${moduleName}"`);
    showModuleError(`Módulo <b>${escapeHtml(moduleName)}</b> no registrado.`);
    return;
  }

  // Evita recargar el mismo módulo si ya está activo.
  if (BIOLAB.activeModule === moduleName) return;
  if (BIOLAB._loadingModule === moduleName) return;

  // Chrome/Edge/Firefox bloquean fetch() sobre file:// por política
  // de origen. Detectamos temprano y damos instrucciones claras.
  if (location.protocol === 'file:') {
    showFileProtocolHelp();
    return;
  }

  const container = document.getElementById('app-container');
  const tabBtn    = document.querySelector(`.tab[data-module="${moduleName}"]`);
  const loadSeq   = ++BIOLAB._loadSeq;

  // Cancelar cualquier carga anterior en vuelo.
  if (BIOLAB._loadController) BIOLAB._loadController.abort();
  const loadController = new AbortController();
  BIOLAB._loadController = loadController;
  BIOLAB._loadingModule  = moduleName;

  // Estado visual: tab activo + indicador de carga.
  setActiveTab(moduleName);
  if (tabBtn) tabBtn.classList.add('loading');
  hideModuleError();

  try {
    // 1) Fetch del HTML del módulo ────────────────────────────
    //    bustUrl() garantiza que ni el navegador ni ningún proxy intermedio
    //    sirva una versión cacheada del HTML del módulo.
    const res = await fetch(bustUrl(path), { cache: 'no-cache', signal: loadController.signal });
    assertFreshLoad(loadSeq);
    if (!res.ok) throw new Error(`HTTP ${res.status} al cargar ${path}`);
    const html = await res.text();
    assertFreshLoad(loadSeq);

    // 2) Parseo. DOMParser envuelve automáticamente fragmentos
    //    en <html><head></head><body>...</body></html>.
    const parser = new DOMParser();
    const doc    = parser.parseFromString(html, 'text/html');

    // Base para resolver hrefs relativos — la CARPETA del módulo,
    // derivada del path registrado, NO del id del módulo.
    const moduleDir = getModuleDir(moduleName);

    // 3) Limpieza de assets del módulo anterior ───────────────
    const previousAssetIds = BIOLAB._injectedAssets.slice();

    // 4) Recopilar CSS del módulo — puede venir de head o body.
    const moduleLinks = [
      ...doc.querySelectorAll('link[rel="stylesheet"]'),
    ];

    // 5) Inyección de CSS (esperar carga para evitar FOUC).
    for (const link of moduleLinks) {
      const href = link.getAttribute('href');
      await injectCSS(href, moduleDir, moduleName);
      assertFreshLoad(loadSeq);
    }

    // 5b) Desmontar JS/listeners del módulo saliente justo antes del swap.
    assertFreshLoad(loadSeq);
    cleanTrackedAssets(previousAssetIds, {
      runUnload: true,
      removeScripts: true,
      removeCss: false,
    });

    // 6) Inyectar el contenido del <body> en el contenedor.
    //    appendChild(node) MUEVE el nodo (auto-adopt cross-doc en
    //    navegadores modernos). Importante: NO usar importNode aquí
    //    porque clona sin remover el original -> loop infinito.
    assertFreshLoad(loadSeq);
    const body = doc.body;
    const fragment = document.createDocumentFragment();
    if (body) {
      while (body.firstChild) {
        fragment.appendChild(body.firstChild);
      }
    }
    container.replaceChildren(fragment);

    // Re-lanzar animación de entrada del contenedor.
    container.style.animation = 'none';
    void container.offsetHeight;             // forzar reflow
    container.style.animation = '';

    // 7) Recopilar scripts: primero los del <head> del módulo,
    //    luego los del <body> (ya inyectados, pero inertes).
    const headScripts = [...doc.querySelectorAll('head script')];
    const bodyScripts = [...container.querySelectorAll('script')];

    // 8) Ejecutar scripts en orden (externos en serie, inline en orden).
    for (const s of [...headScripts, ...bodyScripts]) {
      await injectScript(s, moduleDir, moduleName, loadController.signal);
      assertFreshLoad(loadSeq);
    }

    // 8b) Disparar el init del módulo.
    //     Tras el refactor a IIFE, los scripts registran sus funciones
    //     en window (ej: window.ciInit, window.grInit) pero ya NO se
    //     auto-arrancan con DOMContentLoaded — tenemos que invocarlos
    //     explícitamente cada vez que se monta el módulo, para que
    //     lean localStorage y pinten la vista.
    assertFreshLoad(loadSeq);
    invokeModuleInit(moduleName);

    // 8c) Retirar CSS del módulo anterior al final del montaje nuevo.
    //     Esto evita un gap visual sin estilos durante navegación rápida.
    cleanTrackedAssets(previousAssetIds, {
      runUnload: false,
      removeScripts: false,
      removeCss: true,
    });

    // 9) Marcar módulo activo y emitir evento global.
    BIOLAB.activeModule = moduleName;
    emitEvent('moduleLoaded', { module: moduleName });

    console.log(`[BIOLAB] ✓ Módulo ${moduleName} cargado.`);

  } catch (err) {
    if (isLoadCancelledError(err)) return;

    console.error(`[BIOLAB] Error cargando módulo ${moduleName}:`, err);
    showModuleError(
      `No se pudo cargar el módulo <b>${escapeHtml(moduleName)}</b>.<br>` +
      `<small>${escapeHtml(err && err.message || String(err))}</small>`
    );
    // Revertimos el tab activo al módulo previo (si había).
    setActiveTab(BIOLAB.activeModule);
  } finally {
    if (tabBtn) tabBtn.classList.remove('loading');

    // Solo la carga vigente puede limpiar su estado de control.
    if (loadSeq === BIOLAB._loadSeq) {
      BIOLAB._loadController = null;
      BIOLAB._loadingModule  = null;
    }
  }
}

/**
 * Inyecta un <link rel="stylesheet"> externo del módulo.
 * Evita duplicados:
 *   • Si el href resuelto ya pertenece a una hoja en <head>.
 *   • Si su assetId ya existe en el DOM.
 *
 * @param {string|null} href        href del <link> original (puede ser relativo al HTML del módulo).
 * @param {string}      moduleDir   Carpeta del módulo (ej: "cfg/").
 * @param {string}      moduleName  Clave del módulo para rastreo de assets.
 * @returns {Promise<void>}
 */
function injectCSS(href, moduleDir, moduleName) {
  if (!href) return Promise.resolve();

  const resolvedHref = resolveAssetPath(href, moduleDir);
  const assetId      = `biolab-css-${moduleName}-${slugify(href)}`;

  // Duplicado directo por id.
  if (document.getElementById(assetId)) return Promise.resolve();

  // Duplicado por URL: si la hoja ya existe en el documento
  // (por ejemplo main.css cargado por el shell), no reinyectamos.
  if (stylesheetAlreadyLoaded(resolvedHref)) return Promise.resolve();

  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel            = 'stylesheet';
    link.href           = bustUrl(resolvedHref);   // ← cache bust
    link.id             = assetId;
    link.dataset.assetType = 'css';
    link.dataset.module = moduleName;
    link.onload  = () => resolve();
    link.onerror = () => {
      console.warn(`[BIOLAB] CSS no encontrado: ${resolvedHref}`);
      resolve();                              // no bloqueamos la carga
    };
    document.head.appendChild(link);
    BIOLAB._injectedAssets.push(assetId);
  });
}

/**
 * Inyecta un elemento <script> del módulo.
 *
 * Estrategia: SIEMPRE se obtiene el código (fetch si es externo) y
 * se inyecta como <script> INLINE con un pase previo de normalización
 * que transforma `const`/`let` de nivel superior en `var`. Esto:
 *
 *   • Evita `SyntaxError: Identifier 'X' has already been declared`
 *     cuando dos módulos declaran el mismo identificador top-level
 *     (CI y GR ambos hacen `const K = {...}`).
 *   • Permite re-visitar un módulo sin que su propio script falle
 *     por redeclaración.
 *   • Mantiene las `function foo(){}` top-level como globales de
 *     window (requerido por handlers `onclick="foo()"` en el HTML).
 *
 * @param {HTMLScriptElement} originalScript
 * @param {string}            moduleDir
 * @param {string}            moduleName
 * @param {AbortSignal}       signal
 * @returns {Promise<void>}
 */
async function injectScript(originalScript, moduleDir, moduleName, signal) {
  const src = originalScript.getAttribute('src');

  // Retirar el nodo inerte (el clonado al inyectar el body).
  if (originalScript.parentNode) {
    originalScript.parentNode.removeChild(originalScript);
  }

  let code = '';
  let sourceURL = '';
  let assetId;

  if (src) {
    // ── Script externo: fetch de su contenido ───────────────
    const resolvedSrc = resolveAssetPath(src, moduleDir);
    assetId     = `biolab-js-${moduleName}-${slugify(src)}`;
    sourceURL   = resolvedSrc;

    // Si ya lo inyectamos en esta sesión de carga, saltamos.
    if (document.getElementById(assetId)) return;

    try {
      const res = await fetch(bustUrl(resolvedSrc), { cache: 'no-cache', signal });
      if (!res.ok) {
        console.warn(`[BIOLAB] Script ${resolvedSrc} devolvió HTTP ${res.status}`);
        return;
      }
      code = await res.text();
    } catch (err) {
      if (isLoadCancelledError(err)) throw err;
      console.warn(`[BIOLAB] No se pudo obtener ${resolvedSrc}:`, err);
      return;
    }
  } else {
    // ── Script inline ───────────────────────────────────────
    code      = (originalScript.textContent || '').trim();
    sourceURL = `${moduleName}_inline.js`;
    assetId   = `biolab-js-${moduleName}-inline-${BIOLAB._injectedAssets.length}`;
    if (!code) return;
  }

  // Normalizar declaraciones top-level y añadir sourceURL para DevTools.
  const safeCode =
    normalizeTopLevelDeclarations(code) +
    `\n//# sourceURL=${sourceURL}`;

  const script = document.createElement('script');
  script.id             = assetId;
  script.dataset.assetType = 'js';
  script.dataset.module = moduleName;
  script.textContent    = safeCode;

  // Preservar type="module" si venía así (muy raro en estos módulos).
  const type = originalScript.getAttribute('type');
  if (type && type !== 'text/javascript') script.type = type;

  document.body.appendChild(script);
  BIOLAB._injectedAssets.push(assetId);
}

/**
 * Convierte declaraciones `const` y `let` de nivel superior en `var`.
 *
 * Sólo altera las líneas que comienzan (tras opcional whitespace)
 * por la palabra clave, lo que preserva `const`/`let` dentro de
 * funciones/bloques indentados. Cualquier binding top-level pasa
 * a ser una propiedad de `window` y puede ser reasignado.
 *
 * Respeta comentarios de línea (// ...) y strings triviales porque
 * el anclaje a inicio de línea (^) evita matches internos.
 */
function normalizeTopLevelDeclarations(code) {
  // Split on backtick boundaries: even indices = outside template, odd = inside template.
  // Only transform segments outside template literals.
  // Known limitation: escaped backticks (\`) inside templates are not handled,
  // but none exist in this codebase.
  var segments = code.split('`');
  return segments.map(function(segment, idx) {
    if (idx % 2 === 0) {
      return segment.replace(
        /^([ \t]*)(const|let)(\s+)(?=[A-Za-z_$\[\{])/gm,
        '$1var$3'
      );
    }
    return segment;
  }).join('`');
}

/**
 * Dispara el init del módulo recién montado.
 *
 * Tras el refactor a IIFE, los módulos ya NO se auto-arrancan con
 * DOMContentLoaded. Cada módulo registra en `window` una función de
 * arranque explícita. El loader la invoca aquí, cada vez que se
 * monta el módulo, para que lea localStorage y pinte la vista.
 *
 * Convenciones de nombre soportadas, en orden de preferencia:
 *   1) window.<moduleLower>Init          ej: ciInit, grInit, cfgInit
 *   2) window.<moduleUpper>.init()       ej: GE.init, FR.init (namespace)
 *   3) window.<moduleLower>.init()       ej: ge.init, fr.init
 *   4) window.init<Module>                ej: initGE (fallback legacy)
 *
 * Todos los intentos son defensivos: errores del módulo no deben
 * tumbar al loader.
 *
 * @param {string} moduleName - Clave del módulo (ej: 'CI', 'GR').
 * @returns {boolean} true si encontró e invocó algún init.
 */
function invokeModuleInit(moduleName) {
  if (!moduleName) return false;

  const upper = String(moduleName).toUpperCase();
  const lower = String(moduleName).toLowerCase();

  // Candidatos ordenados: primero los nombres planos (patrón nuevo),
  // luego namespaces con .init() (GE, FR usan objeto contenedor).
  const candidates = [
    { label: `window.${lower}Init`,   fn: window[`${lower}Init`] },
    { label: `window.${upper}.init`,  fn: window[upper] && typeof window[upper].init === 'function' ? window[upper].init.bind(window[upper]) : null },
    { label: `window.${lower}.init`,  fn: window[lower] && typeof window[lower].init === 'function' ? window[lower].init.bind(window[lower]) : null },
    { label: `window.init${upper}`,   fn: window[`init${upper}`] },
  ];

  for (const c of candidates) {
    if (typeof c.fn === 'function') {
      try {
        c.fn();
        console.log(`[BIOLAB] ↳ init ${moduleName} via ${c.label}`);
        return true;
      } catch (err) {
        console.error(`[BIOLAB] ${c.label} lanzó:`, err);
        // Seguimos intentando otros candidatos por robustez.
      }
    }
  }

  console.warn(
    `[BIOLAB] Módulo ${moduleName} montado pero no se encontró ` +
    `función de init (${lower}Init / ${upper}.init / init${upper}). ` +
    `La vista puede quedar vacía hasta la primera interacción.`
  );
  return false;
}


/**
 * Elimina todos los CSS/JS inyectados por el loader en la sesión
 * anterior y llama al hook opcional `window.onModuleUnload` para
 * que el módulo desmonte intervalos, listeners, observers, etc.
 */
function getTrackedAssetType(el, id) {
  if (!el) return '';
  if (el.dataset && el.dataset.assetType) return String(el.dataset.assetType).toLowerCase();
  if (el.tagName === 'LINK') return 'css';
  if (el.tagName === 'SCRIPT') return 'js';
  if (id && id.includes('-css-')) return 'css';
  if (id && id.includes('-js-')) return 'js';
  return '';
}

function cleanTrackedAssets(assetIds, options = {}) {
  const {
    runUnload = true,
    removeCss = true,
    removeScripts = true,
  } = options;

  if (runUnload && typeof window.onModuleUnload === 'function') {
    try { window.onModuleUnload(); }
    catch (err) { console.warn('[BIOLAB] onModuleUnload falló:', err); }
    window.onModuleUnload = null;
  }

  const targetIds = new Set(assetIds || []);
  const keepIds = [];

  for (const id of BIOLAB._injectedAssets) {
    const el = document.getElementById(id);
    if (!el) continue;

    const type = getTrackedAssetType(el, id);
    const isCss = type === 'css';
    const isJs  = type === 'js';
    const shouldConsider = targetIds.has(id);
    const shouldRemove = shouldConsider && (
      (isCss && removeCss) ||
      (isJs && removeScripts)
    );

    if (shouldRemove) {
      if (el.parentNode) el.parentNode.removeChild(el);
      continue;
    }
    keepIds.push(id);
  }

  BIOLAB._injectedAssets = keepIds;
}

function cleanPreviousAssets(options = {}) {
  cleanTrackedAssets(BIOLAB._injectedAssets.slice(), options);
}


/* ────────────────────────────────────────────────────────────
   3. GESTIÓN DE TABS
   ──────────────────────────────────────────────────────────── */

/** Marca .active en el botón cuyo data-module coincida. */
function setActiveTab(moduleName) {
  document.querySelectorAll('#main-nav .tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.module === moduleName);
  });
}


/* ────────────────────────────────────────────────────────────
   4. ESTADOS DE ERROR
   ──────────────────────────────────────────────────────────── */

function showModuleError(html) {
  const container = document.getElementById('app-container');
  if (!container) return;
  container.innerHTML = `
    <div id="module-error" class="visible" role="alert">
      <div class="err-code" aria-hidden="true">⚠</div>
      <h3>Error de módulo</h3>
      <p>${html}</p>
      <small style="color:var(--tx3);margin-top:8px">
        Revisa la consola para más detalles.
      </small>
    </div>`;
}

function hideModuleError() {
  const el = document.getElementById('module-error');
  if (el) el.classList.remove('visible');
}

/**
 * Mensaje específico cuando se abre index.html directamente como
 * archivo (file://). El navegador bloquea fetch() en ese contexto.
 */
function showFileProtocolHelp() {
  const container = document.getElementById('app-container');
  if (!container) return;
  container.innerHTML = `
    <div id="module-error" class="visible" role="alert" style="max-width:720px;margin:40px auto;padding:32px;text-align:left">
      <div class="err-code" aria-hidden="true" style="text-align:center">⚠</div>
      <h3 style="text-align:center;color:var(--er);margin-bottom:8px">
        Necesitás un servidor local
      </h3>
      <p style="color:var(--tx2);font-size:13px;line-height:1.7;margin:12px 0">
        El navegador bloquea <code>fetch()</code> cuando se abre
        <b>index.html</b> directamente desde el disco (protocolo
        <code>file://</code>). Esto es una restricción de seguridad,
        no un error del código.
      </p>
      <p style="color:var(--tx2);font-size:13px;margin:12px 0">
        Soluciones rápidas (elegí una):
      </p>
      <ol style="color:var(--tx2);font-size:12px;line-height:1.9;margin-left:18px">
        <li>
          Doble-click en <code style="color:var(--ac)">serve.bat</code>
          (si está en la carpeta del proyecto). Abre
          <code>http://localhost:8000</code>.
        </li>
        <li>
          Desde PowerShell en la carpeta:
          <code style="color:var(--ac);display:block;margin:6px 0;padding:6px 10px;background:var(--bg-deep);border-radius:4px">
            python -m http.server 8000
          </code>
          Luego abrí <code style="color:var(--ac)">http://localhost:8000</code>.
        </li>
        <li>
          Con Node instalado:
          <code style="color:var(--ac);display:block;margin:6px 0;padding:6px 10px;background:var(--bg-deep);border-radius:4px">
            npx http-server -p 8000
          </code>
        </li>
        <li>
          Extensión VSCode <b>Live Server</b> → botón "Go Live".
        </li>
      </ol>
      <small style="color:var(--tx3);margin-top:12px;display:block">
        Protocolo actual: <b>${escapeHtml(location.protocol)}</b> ·
        Origen: <b>${escapeHtml(location.origin || 'null')}</b>
      </small>
    </div>`;
}


/* ────────────────────────────────────────────────────────────
   5. BUS DE EVENTOS GLOBAL
   ──────────────────────────────────────────────────────────── */

/** Registra un listener. Los módulos lo consumen con window.onEvent. */
function onEvent(event, callback) {
  if (typeof callback !== 'function') return;
  if (!BIOLAB._eventListeners[event]) BIOLAB._eventListeners[event] = [];
  BIOLAB._eventListeners[event].push(callback);
}

/** Retira un listener previamente registrado. */
function offEvent(event, callback) {
  const list = BIOLAB._eventListeners[event];
  if (!list) return;
  BIOLAB._eventListeners[event] = list.filter((fn) => fn !== callback);
}

/** Emite un evento global con payload opcional. */
function emitEvent(event, data) {
  const listeners = BIOLAB._eventListeners[event] || [];
  for (const fn of listeners) {
    try { fn(data); }
    catch (err) { console.warn(`[BIOLAB] Listener "${event}":`, err); }
  }
}


/* ────────────────────────────────────────────────────────────
   6. DRAG & DROP DE TABS (opt-in)
   ──────────────────────────────────────────────────────────── */

function initDragDrop(navSelector = '#main-nav') {
  const nav = document.querySelector(navSelector);
  if (!nav) return;

  let dragged = null;

  nav.querySelectorAll('.tab').forEach((tab) => {
    tab.setAttribute('draggable', 'true');

    tab.addEventListener('dragstart', (e) => {
      dragged = tab;
      tab.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    tab.addEventListener('dragend', () => {
      tab.classList.remove('dragging');
      nav.querySelectorAll('.tab').forEach((t) => t.classList.remove('drag-over'));
      dragged = null;
    });

    tab.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dragged && dragged !== tab) tab.classList.add('drag-over');
    });

    tab.addEventListener('dragleave', () => tab.classList.remove('drag-over'));

    tab.addEventListener('drop', (e) => {
      e.preventDefault();
      tab.classList.remove('drag-over');
      if (dragged && dragged !== tab) {
        const tabs  = [...nav.querySelectorAll('.tab')];
        const fromI = tabs.indexOf(dragged);
        const toI   = tabs.indexOf(tab);
        if (fromI < toI) nav.insertBefore(dragged, tab.nextSibling);
        else             nav.insertBefore(dragged, tab);
        emitEvent('tabsReordered', { from: fromI, to: toI });
      }
    });
  });

  console.log('[BIOLAB] Drag & drop de tabs habilitado.');
}


/* ────────────────────────────────────────────────────────────
   7. UTILIDADES
   ──────────────────────────────────────────────────────────── */

/** Retorna la carpeta del módulo (ej. 'cfg/') desde el mapa MODULES. */
function getModuleDir(moduleName) {
  const path = BIOLAB.modules[moduleName] || '';
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(0, slash + 1) : '';
}

/**
 * Resuelve un href relativo a la carpeta del módulo.
 * - Mantiene intactas las URLs absolutas (http, //, /) o data/blob.
 * - Si el href ya empieza con la carpeta del módulo, no lo duplica.
 * - En cualquier otro caso, antepone la carpeta.
 */
function resolveAssetPath(href, moduleDir) {
  if (!href) return href;
  if (/^(?:[a-z]+:)?\/\//i.test(href)) return href;   // http(s):// o protocol-relative
  if (href.startsWith('/'))            return href;    // absoluto
  if (href.startsWith('data:') || href.startsWith('blob:')) return href;
  if (!moduleDir)                      return href;
  if (href.startsWith(moduleDir))      return href;    // ya prefijado
  return moduleDir + href;
}

/**
 * True si ya existe un <link rel="stylesheet"> en el documento
 * apuntando a la misma URL base (ignorando ?v=... de cache-busting).
 */
function stylesheetAlreadyLoaded(href) {
  if (!href) return false;
  const target = normalizeUrl(stripBust(href));
  const links = document.querySelectorAll('link[rel="stylesheet"]');
  for (const l of links) {
    if (normalizeUrl(stripBust(l.getAttribute('href'))) === target) return true;
  }
  return false;
}

/** Elimina el parámetro ?v=... (o &v=...) de una URL. */
function stripBust(url) {
  if (!url) return url;
  return url.replace(/([?&])v=[^&]*(&|$)/, (_, q, tail) => tail ? q : '');
}

/** Normaliza una URL relativa contra document.baseURI. */
function normalizeUrl(href) {
  if (!href) return '';
  try { return new URL(href, document.baseURI).href; }
  catch { return href; }
}

/** Convierte una cadena en slug apto para id="..." */
function slugify(str) {
  return String(str).replace(/[^a-z0-9]/gi, '-').toLowerCase();
}

/** Escapa HTML para inserción segura en textContent/innerHTML. */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


/* ────────────────────────────────────────────────────────────
   8. EXPOSICIÓN GLOBAL (para los módulos)
   ──────────────────────────────────────────────────────────── */
window.BIOLAB        = BIOLAB;
window.loadModule    = loadModule;
window.onEvent       = onEvent;
window.offEvent      = offEvent;
window.emitEvent     = emitEvent;
window.initDragDrop  = window.initDragDrop || initDragDrop;


/* ────────────────────────────────────────────────────────────
   9. INICIALIZACIÓN
   ──────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  startClock();

  // Hash-routing: #GE, #CI, etc. Cargar módulo si corresponde.
  // Si no hay hash, carga GE por defecto para pre-poblar la genética.
  const hashModule = window.location.hash.slice(1).toUpperCase();
  const startModule = (hashModule && BIOLAB.modules[hashModule]) ? hashModule : 'GE';
  loadModule(startModule);

  // Mantener el hash sincronizado con el módulo activo.
  onEvent('moduleLoaded', ({ module }) => {
    if (`#${module}` !== window.location.hash) {
      history.replaceState(null, '', '#' + module);
    }
  });

  // Soporte para navegar con el botón atrás/adelante.
  window.addEventListener('hashchange', () => {
    const id = window.location.hash.slice(1).toUpperCase();
    if (id && BIOLAB.modules[id] && BIOLAB.activeModule !== id) {
      loadModule(id);
    }
  });

  console.log('[BIOLAB] 🔬 Motor principal iniciado — loader v3.1 listo.');
});

