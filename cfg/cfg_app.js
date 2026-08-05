/* ============================================================
   cfg_app.js — Lógica del módulo CFG (Configuración)
   Refactorizado a IIFE para aislar el scope del monolito.
   ============================================================ */

(function () {
  'use strict';

  const K = {
    species: 'bl2_species', strains: 'bl2_strains', phenos: 'bl2_phenos',
    nodes: 'bl2_nodes', logs: 'bl2_logs', ings: 'bl2_ings',
    forms: 'bl2_forms', ntypes: 'bl2_ntypes', flow: 'bl2_flow',
    gh: 'bl2_gh', seg: 'bl2_seg', su_ings: 'bl2_su_ings',
    su_forms: 'bl2_su_forms', su_params: 'bl2_su_params',
    ci_nodes: 'bl2_ci_nodes', ci_notes: 'bl2_ci_notes'
  };
  const gDB = k => { try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } };
  const sDB = (k, d) => localStorage.setItem(k, JSON.stringify(d));
  const gOb = (k, def) => { try { const v = JSON.parse(localStorage.getItem(k)); return v || def; } catch { return def; } };
  const sOb = (k, d) => localStorage.setItem(k, JSON.stringify(d));

  const DEF_NTYPES = {
    CI: { label: 'Cultivo In Vitro', icon: '🧫' },
    GR: { label: 'Grano', icon: '🌾' },
    IN: { label: 'Inóculo', icon: '💉' },
    SU: { label: 'Sustrato', icon: '🧱' },
    ST: { label: 'Stock Final', icon: '📦' },
    FR: { label: 'Fructificación', icon: '🍄' }
  };

  function now() { return new Date().toISOString(); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function fDate(iso) { if (!iso) return '—'; try { const d = new Date(iso); return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }); } catch { return iso; } }
  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function nxtId(prefix, db) { const nums = db.map(x => x.id).filter(id => id && id.startsWith(prefix + '-')).map(id => parseInt(id.split('-')[1]) || 0); return `${prefix}-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4, '0')}`; }

  /* ── Notificación ── */
  function sN(msg, err = false) { const n = document.getElementById('notif'); if (!n) return; n.textContent = msg; n.className = 'notif' + (err ? ' err' : ''); setTimeout(() => n.classList.add('show'), 10); setTimeout(() => n.classList.remove('show'), 2600); }

  /* ── Modales ── */
  function openM(id) { document.getElementById(id).classList.add('open'); }
  function closeM(id) { document.getElementById(id).classList.remove('open'); }

  /* ============================================================
     BACKUP GLOBAL
     Cubre TODOS los módulos (actuales y futuros).
     ============================================================ */
  const BK_PREFIXES = ['bl2_', 'sustratos_', 'su_', 'ci_', 'gr_', 'in_', 'st_', 'trz_', 'fr_', 'biolab.', 'biolab_'];
  const BK_EXCLUDE = ['bl2_seeded'];

  function bkAllKeys() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (BK_EXCLUDE.includes(k)) continue;
      if (BK_PREFIXES.some(p => k.startsWith(p))) out.push(k);
    }
    return out.sort();
  }

  // Fingerprint de cambios sin guardar (2026-07-24): no criptográfico, solo
  // para detectar si el estado actual difiere del que se subió en el último
  // backup exitoso — dos hashes FNV-1a en paralelo + largo del string, para
  // no depender de un solo hash de 32 bits sobre 1MB+ de texto. Se calcula
  // sobre el mismo objeto que ghBackup() sube (ghData(), ver más abajo), así
  // que el fingerprint representa exactamente "lo que ya está respaldado".
  function _bkFingerprint(dataObj) {
    const str = JSON.stringify(dataObj);
    let h1 = 0x811c9dc5, h2 = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = (h1 ^ c) >>> 0; h1 = (h1 * 0x01000193) >>> 0;
      h2 = (h2 ^ (c + i)) >>> 0; h2 = (h2 * 0x01000193) >>> 0;
    }
    return h1.toString(16) + h2.toString(16) + ':' + str.length;
  }

  function bkCollectAll(opts) {
    opts = opts || {};
    const data = {};
    bkAllKeys().forEach(k => {
      if (opts.skipGh && k === K.gh) return;
      const raw = localStorage.getItem(k);
      if (raw === null) return;
      try { data[k] = JSON.parse(raw); }
      catch (e) { data[k] = raw; }
    });
    return data;
  }

  function bkRestoreAll(data, opts) {
    if (!data || typeof data !== 'object') throw new Error('JSON inválido');
    opts = opts || {};
    // wipe:true = restauración real (vuelve exactamente al estado del backup,
    // no un merge). Antes, restaurar solo hacía setItem por cada key presente
    // en el backup y nunca borraba nada — una key que solo existiera en el
    // estado actual (creada después del backup) sobrevivía mezclada con los
    // datos viejos restaurados, y una key presente en ambos quedaba en el
    // valor del backup sin que el resto del sistema volviera atrás con ella.
    // Nunca se borra bl2_gh (config/token de GitHub) — no forma parte de
    // ningún backup (bkCollectAll siempre lo excluye) y el usuario no debería
    // tener que volver a cargar su token después de restaurar.
    if (opts.wipe) {
      bkAllKeys().forEach(k => {
        if (k === K.gh) return;
        localStorage.removeItem(k);
      });
    }
    let count = 0;
    Object.entries(data).forEach(([k, v]) => {
      if (k.startsWith('_')) return;
      if (BK_EXCLUDE.includes(k)) return;
      if (!BK_PREFIXES.some(p => k.startsWith(p))) return;
      localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
      count++;
    });
    return count;
  }

  const BK_RESTORE_WARNING =
    '⚠ Esto va a BORRAR todos los datos actuales de la app y reemplazarlos por completo con los del backup elegido.\n\n' +
    'No se puede deshacer — cualquier cambio hecho después de ese backup se pierde.\n\n' +
    '¿Continuar?';

  /* ============================================================
     BACKUP / RESTORE UNIFICADO (2026-07-28)
     Reemplaza los 3 botones de exportar + 2 de importar que había antes
     (localExport/exportData/exportAll, localImport/importData/importAll —
     ver mejoras_app.md MEJ-0026 para el diagnóstico completo). Un solo
     flujo: captura TODO localStorage sin depender de la lista de prefijos
     BK_PREFIXES (que puede quedar desactualizada si se agrega un módulo
     nuevo — bkCollectAll/bkAllKeys se dejan intactas para GitHub Sync,
     que es un flujo aparte y no se tocó), nunca incluye bl2_gh, y el
     import soporta tanto el formato propio (valores string crudos) como
     backups viejos en formato parseado (el que producían localExport/
     exportData/ghBackup antes de este cambio) — mismo criterio
     typeof v === 'string' que ya usaba bkRestoreAll, así un backup viejo
     de cualquiera de los 3 botones anteriores se puede seguir restaurando
     sin corromper nada.
     ============================================================ */
  function _bkCollectRaw() {
    // Orden de claves determinístico: localStorage.key(i) no garantiza orden
    // estable entre sesiones — dos backups con el MISMO contenido exacto podían
    // serializarse con distinto orden de claves, dando un SHA distinto en
    // GitHub y una falsa alarma de "cambió algo" (confirmado con un usuario
    // real: dos backups de la misma sesión, 0 diffs de contenido, SHA distinto).
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || k === K.gh) continue;
      keys.push(k);
    }
    keys.sort();
    const data = {};
    keys.forEach(k => { data[k] = localStorage.getItem(k); });
    return data;
  }

  function exportSystem() {
    const data = _bkCollectRaw();
    const keys = Object.keys(data);
    data._exported = new Date().toISOString();
    data._keys = keys;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    const _n = new Date();
    const _pad = v => String(v).padStart(2, '0');
    const _ts = _pad(_n.getDate()) + '_' + _pad(_n.getMonth() + 1) + '_' + _n.getFullYear()
              + '_' + _pad(_n.getHours()) + _pad(_n.getMinutes()) + _pad(_n.getSeconds());
    a.download = `biolab_full_backup - ${_ts}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    sN(`Backup exportado (${keys.length} keys)`);
  }

  function importSystem(input) {
    const file = input.files[0]; if (!file) return;
    const r = new FileReader();
    r.onload = e => {
      let data;
      try { data = JSON.parse(e.target.result); }
      catch (err) { sN('Archivo inválido: no es un JSON válido.', true); input.value = ''; return; }
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        sN('Archivo inválido: se esperaba un backup de BioLab (objeto JSON).', true); input.value = ''; return;
      }
      const realKeys = Object.keys(data).filter(k => !k.startsWith('_'));
      const pareceBackupBiolab = realKeys.some(k => BK_PREFIXES.some(p => k.startsWith(p)));
      if (!pareceBackupBiolab) {
        sN('Archivo inválido: no contiene ninguna key reconocible de BioLab. No se modificó nada.', true);
        input.value = ''; return;
      }
      if (!confirm(BK_RESTORE_WARNING + `\n\n(${realKeys.length} keys en el archivo)`)) { input.value = ''; return; }
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k !== K.gh) localStorage.removeItem(k);
      }
      let count = 0;
      realKeys.forEach(k => {
        if (k === K.gh) return; // nunca pisar el token de GitHub con uno de un backup viejo
        const v = data[k];
        localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
        count++;
      });
      sN(`Sistema restaurado (${count} keys) — recargando...`);
      setTimeout(() => location.reload(), 1200);
    };
    r.readAsText(file); input.value = '';
  }

  /* ============================================================
     LIMPIAR CACHÉ — purga caché del navegador + SW SIN tocar datos.
     Pensado para forzar que el navegador (ej. Safari/iPhone, que no
     tiene un "hard refresh" fácil) baje los archivos nuevos sin
     tener que exportar/reimportar el sistema.
     ============================================================ */
  async function clearCacheOnly() {
    if (!confirm(
      '🧹 Limpiar caché\n\n' +
      'Esto borra la caché del navegador y los Service Workers\n' +
      'para forzar que baje la versión más nueva de la app.\n\n' +
      'Tus datos (bl2_*, etc.) NO se tocan.\n\n' +
      'La página se recargará automáticamente.\n\n' +
      '¿Continuar?'
    )) return;

    sN('🧹 Limpiando caché... no cerrés la ventana');

    // Nuevo token de cache-busting — main.js lo toma al iniciar
    const newToken = Date.now().toString(36);
    try { localStorage.setItem('biolab.cv', newToken); } catch (_) {}

    // Purgar Cache API
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
        console.log(`[BIOLAB] clearCacheOnly: ${keys.length} cache(s) purgados`);
      }
    } catch (err) {
      console.warn('[BIOLAB] clearCacheOnly: no se pudo purgar Cache API:', err);
    }

    // Des-registrar Service Workers
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
        console.log(`[BIOLAB] clearCacheOnly: ${regs.length} SW des-registrado(s)`);
      }
    } catch (err) {
      console.warn('[BIOLAB] clearCacheOnly: no se pudo des-registrar SW:', err);
    }

    console.log(`[BIOLAB] clearCacheOnly completo — token nuevo: ${newToken}`);
    setTimeout(() => location.reload(true), 600);
  }

  /* ============================================================
     HARD RESET — limpia datos + caché del navegador + SW
     Garantiza que el próximo reload cargue archivos frescos.
     ============================================================ */

  /**
   * Reseteo completo de datos Y caché del navegador.
   *
   * Secuencia:
   *   1. Borra todos los datos de localStorage (todas las keys de bkAllKeys()).
   *   2. Genera un nuevo token de cache-busting y lo guarda en LS
   *      (biolab.cv) — main.js lo leerá en el próximo arranque.
   *   3. Purga todas las entradas de Cache API (caches.keys / cache.delete).
   *   4. Des-registra todos los Service Workers activos en el scope.
   *   5. Recarga la página con location.reload() para aplicar todo.
   *
   * Los pasos 3 y 4 son best-effort: si el navegador no soporta alguna
   * API, se registra en consola pero no se bloquea el flujo.
   */
  async function hardReset() {
    if (!confirm(
      '⚠ HARD RESET\n\n' +
      'Esto borrará:\n' +
      '  • Todos los datos del sistema (localStorage)\n' +
      '  • Caché del navegador (Cache API)\n' +
      '  • Service Workers registrados\n\n' +
      'La página se recargará automáticamente.\n\n' +
      '¿Continuar?'
    )) return;

    sN('🧹 Limpiando datos y caché... no cerrés la ventana');

    // 1) Datos de localStorage
    bkAllKeys().forEach(key => localStorage.removeItem(key));
    localStorage.removeItem('bl2_seeded');

    // 2) Nuevo token de cache-busting — main.js lo toma al iniciar
    const newToken = Date.now().toString(36);
    try { localStorage.setItem('biolab.cv', newToken); } catch (_) {}

    // 3) Purgar Cache API
    let cacheCount = 0;
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
        cacheCount = keys.length;
        console.log(`[BIOLAB] hardReset: ${cacheCount} cache(s) purgados`);
      }
    } catch (err) {
      console.warn('[BIOLAB] hardReset: no se pudo purgar Cache API:', err);
    }

    // 4) Des-registrar Service Workers
    let swCount = 0;
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
        swCount = regs.length;
        console.log(`[BIOLAB] hardReset: ${swCount} SW des-registrado(s)`);
      }
    } catch (err) {
      console.warn('[BIOLAB] hardReset: no se pudo des-registrar SW:', err);
    }

    console.log(`[BIOLAB] hardReset completo — token nuevo: ${newToken}`);

    // 5) Reload forzado (true = desde servidor, ignora HTTP cache en Firefox)
    setTimeout(() => location.reload(true), 600);
  }

  /* ============================================================
     GITHUB SYNC
     ============================================================ */
  function encToken(t) {
    if (!t) return '';
    try { return btoa(unescape(encodeURIComponent('biolab:' + t))); }
    catch(e) { return t; }
  }
  function decToken(enc) {
    if (!enc) return '';
    try {
      var decoded = decodeURIComponent(escape(atob(enc)));
      return decoded.startsWith('biolab:') ? decoded.slice(7) : decoded;
    } catch(e) { return enc; }
  }

  function ghSaveCfg() {
    const t = document.getElementById('gh-token').value.trim();
    let r = document.getElementById('gh-repo').value.trim();
    const f = document.getElementById('gh-file').value.trim() || 'biolab-data.json';
    if (!t || !r) return sN('Token y repo requeridos', true);
    r = r.replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
    const gc = gOb(K.gh, {}); gc.token = encToken(t); gc.repo = r; gc.file = f;
    // Baseline fresco al configurar (2026-07-29): recién logueado, antes de
    // tocar nada, NO es "cambios pendientes" — ver hasUnsaved en ghLoadCfg().
    // Sin esto, _ghHasBaseline quedaba false hasta el primer ghBackup/ghLoadLatest
    // y el fallback trataba "recién configurado" como dirty (Guardar verde),
    // que es exactamente el bug que el usuario reportó.
    gc.lastBackupFp = _bkFingerprint(ghData());
    gc.lastBackupSource = 'save';
    sOb(K.gh, gc);
    ghLoadCfg(); sN('Configuración GitHub guardada');
  }

  async function ghApi(method, path, body) {
    const gc = gOb(K.gh, {}); if (!gc.token || !gc.repo) throw new Error('GitHub no configurado');
    const url = `https://api.github.com/repos/${gc.repo}/contents/${path}`;
    const headers = { 'Authorization': 'token ' + decToken(gc.token), 'Content-Type': 'application/json', 'Accept': 'application/vnd.github.v3+json' };
    // cache:'no-store' — sin esto, un GET (ej. listar backups) justo después de
    // un PUT (guardar backup) puede servirse desde la caché HTTP del navegador
    // y mostrar el estado viejo hasta un refresh/limpieza de caché manual.
    let resp;
    try {
      resp = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    } catch {
      const proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url);
      resp = await fetch(proxyUrl, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    }
    if (!resp.ok) {
      const e = await resp.json().catch(() => ({}));
      const err = new Error(e.message || resp.statusText);
      err.status = resp.status;
      throw err;
    }
    return resp.json();
  }

  // La API de Contents (ghApi) omite el content base64 inline para archivos
  // >1MB (encoding:"none", content vacío) — GitHub solo lo devuelve completo
  // vía la Git Blobs API, que soporta hasta 100MB. Usada por ghRestore/ghLoadLatest.
  async function ghApiBlob(sha) {
    const gc = gOb(K.gh, {}); if (!gc.token || !gc.repo) throw new Error('GitHub no configurado');
    const url = `https://api.github.com/repos/${gc.repo}/git/blobs/${sha}`;
    const headers = { 'Authorization': 'token ' + decToken(gc.token), 'Accept': 'application/vnd.github.v3+json' };
    let resp;
    try {
      resp = await fetch(url, { headers, cache: 'no-store' });
    } catch {
      const proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url);
      resp = await fetch(proxyUrl, { headers, cache: 'no-store' });
    }
    if (!resp.ok) {
      const e = await resp.json().catch(() => ({}));
      const err = new Error(e.message || resp.statusText);
      err.status = resp.status;
      throw err;
    }
    return resp.json();
  }

  async function ghTest() {
    const el = document.getElementById('gh-status-box');
    el.style.display = 'block'; el.className = 'rbox'; el.innerHTML = '🔄 Probando...';
    try {
      const gc = gOb(K.gh, {});
      if (!gc.token || !gc.repo) { el.className = 'rbox er'; el.innerHTML = '⚠ Guardá configuración primero'; return; }
      const url = `https://api.github.com/repos/${gc.repo}`;
      let r = await fetch(url, { headers: { 'Authorization': 'token ' + decToken(gc.token) } }).catch(() => null);
      if (!r) r = await fetch('https://api.allorigins.win/raw?url=' + encodeURIComponent(url), { headers: { 'Authorization': 'token ' + decToken(gc.token) } });
      const d = await r.json();
      if (r.ok) { el.className = 'rbox'; el.innerHTML = `✓ Conectado · <b style="color:var(--ac)">${d.full_name}</b> · ${d.private ? 'privado' : 'público'}`; }
      else { el.className = 'rbox er'; el.innerHTML = '✕ ' + d.message; }
    } catch (e) { el.className = 'rbox er'; el.innerHTML = '✕ ' + e.message; }
  }

  // Hasta 2026-07-28 usaba bkCollectAll (valores parseados + filtro BK_PREFIXES) —
  // eso hacía que un backup de GitHub Sync pesara ~33% más que uno local
  // (exportSystem) con el MISMO contenido exacto, solo por indentación de
  // JSON.stringify sobre objetos anidados en vez de strings crudas compactas.
  // Mismo criterio que exportSystem/_bkCollectRaw ahora: sin esto, dos backups
  // con contenido idéntico parecen tener tamaños distintos y generan alarmas
  // de "pérdida de datos" que no son reales — ya pasó 2 veces en la misma sesión.
  function ghData() {
    return _bkCollectRaw();
  }

  async function ghBackup() {
    const el = document.getElementById('gh-status-box');
    el.style.display = 'block'; el.className = 'rbox'; el.innerHTML = '🔄 Guardando backup...';
    try {
      const gc = gOb(K.gh, {});
      if (!gc.token || !gc.repo) { el.className = 'rbox er'; el.innerHTML = '⚠ No configurado'; return; }
      const _n = new Date();
      const _pad = v => String(v).padStart(2, '0');
      const ts = `FECHA_${_pad(_n.getDate())}-${_pad(_n.getMonth() + 1)}-${_n.getFullYear()}`
               + `_HORA_${_pad(_n.getHours())}-${_pad(_n.getMinutes())}-${_pad(_n.getSeconds())}`;
      const path = `backups/biolab-backup-${ts}.json`;
      const dataObj = ghData();
      const content = btoa(unescape(encodeURIComponent(JSON.stringify(dataObj, null, 2))));
      await ghApi('PUT', path, { message: `BIOLAB backup · ${ts}`, content });
      // MEJ-0020 (2026-07-24): ghPush/ghPull (sync de archivo unico mutable)
      // se eliminaron — redundantes con este backup inmutable, que ademas
      // nunca se pisa. gh-last refleja EXCLUSIVAMENTE el último backup
      // GUARDADO — ghLoadLatest()/ghRestore() (cargar/restaurar) no deben
      // tocar lastSync, solo lastBackupFp (ver esas funciones).
      gc.lastSync = now();
      gc.lastBackupFp = _bkFingerprint(dataObj);
      gc.lastBackupSource = 'save';
      sOb(K.gh, gc);
      ghLoadCfg();
      el.className = 'rbox wn'; el.innerHTML = `✓ Backup guardado en <code>${path}</code>`;
      sN('Backup guardado');
    } catch (e) { el.className = 'rbox er'; el.innerHTML = '✕ ' + e.message; sN('Error: ' + e.message, true); }
  }

  // Carga siempre el backup MAS RECIENTE — reemplaza al viejo ghPull (que
  // sincronizaba un archivo mutable aparte). Reusa el mismo orden que ya
  // calcula ghListBackups (_bkParseFileTs, mas nuevo primero) para no
  // duplicar el criterio de "cual es el ultimo".
  async function ghLoadLatest() {
    if (!confirm(BK_RESTORE_WARNING)) return;
    const el = document.getElementById('gh-status-box');
    el.style.display = 'block'; el.className = 'rbox'; el.innerHTML = '🔄 Buscando el último backup...';
    try {
      const gc = gOb(K.gh, {});
      if (!gc.token || !gc.repo) { el.className = 'rbox er'; el.innerHTML = '⚠ No configurado'; return; }
      const files = await ghApi('GET', 'backups').catch(() => []);
      if (!files.length) { el.className = 'rbox er'; el.innerHTML = '⚠ Sin backups todavía — usá "Guardar backup ahora" primero'; return; }
      files.sort((a, b) => _bkParseFileTs(b.name).localeCompare(_bkParseFileTs(a.name)));
      const latest = files[0];
      el.innerHTML = `🔄 Cargando <code>${esc(latest.name)}</code>...`;
      const file = await ghApi('GET', latest.path);
      const blob = await ghApiBlob(file.sha);
      const decoded = decodeURIComponent(escape(atob(blob.content.replace(/\n/g, ''))));
      const data = JSON.parse(decoded);
      const n = bkRestoreAll(data, { wipe: true });
      // Cargar/restaurar NO es guardar un backup nuevo — lastSync (el
      // timestamp que muestra "Último backup: ...") solo lo toca ghBackup().
      // Bug real reportado 2026-07-24: acá se pisaba lastSync con la hora de
      // la carga, mostrando un backup "guardado" que nunca ocurrió. Sí
      // actualiza lastBackupFp — el estado local ahora coincide exactamente
      // con este archivo, que ya existe en GitHub, así que no hay "cambios
      // sin guardar" recién restaurado.
      gc.lastBackupFp = _bkFingerprint(ghData()); gc.lastBackupSource = 'load'; sOb(K.gh, gc);
      el.className = 'rbox'; el.innerHTML = `✓ Cargado <code>${esc(latest.name)}</code> (${n} keys) — recargando...`;
      sN(`Backup más reciente cargado (${n} keys) — recargando...`);
      setTimeout(() => location.reload(), 1200);
    } catch (e) { el.className = 'rbox er'; el.innerHTML = '✕ ' + e.message; sN('Error: ' + e.message, true); }
  }

  // Extrae un key YYYYMMDDHHMMSS ordenable, en HORA LOCAL, de un nombre de
  // backup — soportando el formato nuevo (FECHA_DD-MM-YYYY_HORA_HH-MM-SS,
  // ya en hora local) y el viejo (ISO YYYY-MM-DDTHH-MM-SS, en UTC).
  // Crítico: el formato viejo está en UTC (toISOString()) y el nuevo en hora
  // local (Argentina, UTC-3) — comparar los dígitos crudos sin convertir
  // huso horario hacía que "17:15 UTC" (= 14:15 local) ordenara DESPUÉS de
  // "14:53 local", cuando en la realidad pasó antes. Todo se normaliza acá
  // a hora local antes de construir la key.
  function _bkParseFileTs(name) {
    const p = v => String(v).padStart(2, '0');
    let m = name.match(/FECHA_(\d{2})-(\d{2})-(\d{4})_HORA_(\d{2})-(\d{2})-(\d{2})/);
    if (m) {
      const [, dd, mm, yyyy, hh, mi, ss] = m;
      return yyyy + mm + dd + hh + mi + ss; // ya en hora local
    }
    m = name.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/);
    if (m) {
      const [, yyyy, mm, dd, hh, mi, ss] = m;
      const d = new Date(Date.UTC(+yyyy, +mm - 1, +dd, +hh, +mi, +ss)); // UTC → local
      return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate())
             + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
    }
    return name;
  }

  // Convierte la key ordenable (YYYYMMDDHHMMSS o el nombre crudo si no matcheó
  // ningún formato conocido) a algo legible: DD/MM/YYYY HH:MM:SS.
  function _bkKeyToDisplay(key) {
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(key);
    if (!m) return key;
    const [, yyyy, mm, dd, hh, mi, ss] = m;
    return `${dd}/${mm}/${yyyy} ${hh}:${mi}:${ss}`;
  }

  // Mapa key de localStorage → módulo dueño (ver tabla "PERSISTENCIA" en
  // CLAUDE.md). No exhaustivo llave-por-llave: además del match exacto, cae a
  // un match por prefijo para keys nuevas/legacy no listadas explícitamente.
  const _BK_KEY_MODULO_EXACTO = {
    'biolab.ge.v4': 'GE',
    'bl2_cultivos': 'CI', 'bl2_forms': 'CI', 'bl2_seg': 'CI',
    'bl2_experimentos': 'CI', 'bl2_pending_crec_action': 'CI',
    'bl2_seg_notas': 'CI/CILAB',
    'bl2_ings': 'CILAB', 'bl2_lab_obs': 'CILAB', 'bl2_lab_strain_ranges': 'CILAB',
    'bl2_crec': 'CILAB', 'bl2_crec_notas': 'CILAB', 'bl2_crec_fases': 'CILAB',
    'bl2_crec_excluded_formulas': 'CILAB', 'bl2_crec_cleared': 'CILAB',
    'bl2_inteligencia_model': 'CILAB', 'bl2_formula_intel': 'CILAB',
    'bl2_ci_gr_links': 'CI/GR',
    'gr_lotes': 'GR', 'gr_biblioteca': 'GR', 'gr_usados': 'GR', 'gr_usados_ref': 'GR',
    'su_lotes': 'SU', 'su_biblioteca': 'SU', 'sustratos_lotes': 'SU', 'sustratos_biblioteca': 'SU',
    'fr_bolsas': 'FR', 'fr_cal_intel': 'FR', 'fr_experimentos': 'FR',
  };
  const _BK_PREFIJO_MODULO = [
    ['biolab_migracion_fr', 'FR'], ['biolab_migracion_gr', 'GR'], ['biolab_migracion_su', 'SU'],
    ['bl2_seg_rowimgs_', 'CI'], ['bl2_seg_notas_migrated', 'CI'],
    ['bl2_col_align', 'CILAB'], ['bl2_lab_', 'CILAB'], ['bl2_stock_reconcile', 'CILAB'],
    ['gr_', 'GR'], ['su_', 'SU'], ['sustratos_', 'SU'], ['fr_', 'FR'], ['bl2_', 'CILAB'],
  ];
  function _bkKeyToModulo(key) {
    if (_BK_KEY_MODULO_EXACTO[key]) return _BK_KEY_MODULO_EXACTO[key];
    const hit = _BK_PREFIJO_MODULO.find(([p]) => key.startsWith(p));
    return hit ? hit[1] : 'otros';
  }

  // Descarga (Blobs API) y decodifica el contenido completo de un backup —
  // usada solo bajo demanda (botón "¿Qué cambió?"), nunca al listar.
  async function _bkDecodeBlob(sha) {
    const blob = await ghApiBlob(sha);
    const decoded = decodeURIComponent(escape(atob(blob.content.replace(/\n/g, ''))));
    return JSON.parse(decoded);
  }

  var _bkListaOrdenada = []; // cache en memoria de la última lista renderizada, para el diff on-demand

  async function ghDiffBackupModulos(idx, btnEl) {
    const actual = _bkListaOrdenada[idx];
    const anterior = _bkListaOrdenada[idx + 1]; // el array está ordenado más-nuevo-primero
    if (!anterior) { btnEl.outerHTML = '<span style="font-size:11px;color:var(--tx3)">es el más viejo — sin backup anterior para comparar</span>'; return; }
    btnEl.disabled = true; btnEl.textContent = '🔄...';
    try {
      const [dataActual, dataAnterior] = await Promise.all([
        _bkDecodeBlob(actual.sha), _bkDecodeBlob(anterior.sha)
      ]);
      const keysActual = new Set(Object.keys(dataActual).filter(k => !k.startsWith('_')));
      const keysAnterior = new Set(Object.keys(dataAnterior).filter(k => !k.startsWith('_')));
      const cambiadas = new Set();
      keysActual.forEach(k => {
        if (!keysAnterior.has(k) || JSON.stringify(dataActual[k]) !== JSON.stringify(dataAnterior[k])) cambiadas.add(k);
      });
      keysAnterior.forEach(k => { if (!keysActual.has(k)) cambiadas.add(k); });
      if (!cambiadas.size) {
        btnEl.outerHTML = '<span style="font-size:11px;color:var(--tx3)">sin cambios vs. el anterior</span>';
        return;
      }
      const modulos = [...new Set([...cambiadas].map(_bkKeyToModulo))].sort();
      btnEl.outerHTML = `<span style="font-size:11px;color:var(--tx2)" title="${esc([...cambiadas].sort().join(', '))}">${esc(modulos.join(', '))}</span>`;
    } catch (e) {
      btnEl.disabled = false; btnEl.textContent = '✕ error, reintentar';
    }
  }

  async function ghListBackups() {
    const el = document.getElementById('gh-bk-list');
    el.style.display = 'block'; el.innerHTML = '🔄 Cargando...';
    try {
      const gc = gOb(K.gh, {});
      if (!gc.token || !gc.repo) { el.innerHTML = 'No configurado'; return; }
      const files = await ghApi('GET', 'backups').catch(() => []);
      if (!files.length) { el.innerHTML = '<div class="empty">Sin backups todavía</div>'; return; }
      files.sort((a, b) => _bkParseFileTs(b.name).localeCompare(_bkParseFileTs(a.name))); // más nuevo primero
      _bkListaOrdenada = files;
      // size y sha ya vienen en la respuesta de listado — sin llamadas extra a la API.
      // sha corto = huella exacta del contenido: dos filas con el mismo sha son
      // byte-a-byte idénticas (confirma o descarta "¿son realmente distintos?").
      // "¿Qué cambió?" es aparte y bajo demanda — descarga+diffea contra el backup
      // anterior recién al tocarlo, para no penalizar abrir la lista con N descargas.
      el.innerHTML = `<div class="tw"><table><thead><tr><th>Fecha</th><th>Tamaño</th><th>SHA</th><th>Módulos</th><th>Acción</th></tr></thead><tbody>${
        files.map((f, idx) => {
          const fecha = _bkKeyToDisplay(_bkParseFileTs(f.name));
          const kb = f.size != null ? (f.size / 1024).toFixed(1) + ' KB' : '—';
          const shaCorta = f.sha ? f.sha.slice(0, 7) : '—';
          return `<tr>
            <td style="font-size:12px;color:var(--tx2)" title="${esc(f.name)}">${esc(fecha)}</td>
            <td style="font-size:12px;color:var(--tx2)">${kb}</td>
            <td style="font-size:11px;color:var(--tx3);font-family:monospace">${shaCorta}</td>
            <td><button class="btn btn-s" style="height:26px;font-size:10px" onclick="ghDiffBackupModulos(${idx}, this)">¿Qué cambió?</button></td>
            <td>
              <button class="btn btn-s" style="height:26px;font-size:10px" onclick="ghDownload('${f.path}')">⬇ Descargar</button>
              <button class="btn btn-s" style="height:26px;font-size:10px" onclick="ghRestore('${f.path}')">Restaurar</button>
            </td>
          </tr>`;
        }).join('')
      }</tbody></table></div>`;
    } catch (e) { el.innerHTML = 'Error: ' + e.message; }
  }

  async function ghRestore(path) {
    if (!confirm(BK_RESTORE_WARNING)) return;
    const el = document.getElementById('gh-status-box');
    el.style.display = 'block'; el.className = 'rbox'; el.innerHTML = '🔄 Restaurando...';
    try {
      const file = await ghApi('GET', path);
      const blob = await ghApiBlob(file.sha);
      const decoded = decodeURIComponent(escape(atob(blob.content.replace(/\n/g, ''))));
      const data = JSON.parse(decoded);
      const n = bkRestoreAll(data, { wipe: true });
      // Mismo criterio que ghLoadLatest(): no toca lastSync (no se guardó
      // nada), sí actualiza lastBackupFp — el estado local coincide con este
      // backup puntual, que ya existe en GitHub.
      const gc = gOb(K.gh, {});
      gc.lastBackupFp = _bkFingerprint(ghData()); gc.lastBackupSource = 'load'; sOb(K.gh, gc);
      el.className = 'rbox'; el.innerHTML = `✓ Backup restaurado (${n} keys) — recargando...`;
      sN(`Backup restaurado (${n} keys) — recargando...`);
      setTimeout(() => location.reload(), 1200);
    } catch (e) { el.className = 'rbox er'; el.innerHTML = '✕ ' + e.message; }
  }

  // Descarga un backup puntual de la lista de GitHub tal cual está guardado
  // ahí — texto decodificado directo del blob, SIN re-parsear/re-serializar,
  // para que el archivo bajado sea byte-a-byte el mismo que ya existe en
  // GitHub (mismo tamaño que muestra la columna "Tamaño" de la tabla).
  async function ghDownload(path) {
    try {
      const file = await ghApi('GET', path);
      const blob = await ghApiBlob(file.sha);
      const decoded = decodeURIComponent(escape(atob(blob.content.replace(/\n/g, ''))));
      const blobFile = new Blob([decoded], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blobFile);
      a.download = path.split('/').pop();
      a.click();
      URL.revokeObjectURL(a.href);
      sN(`Descargado: ${a.download}`);
    } catch (e) { sN('Error al descargar: ' + e.message, true); }
  }

  function ghLoadCfg() {
    const gc = gOb(K.gh, {});
    const elT = document.getElementById('gh-token');
    const elR = document.getElementById('gh-repo');
    const elF = document.getElementById('gh-file');
    if (elT && gc.token) elT.value = decToken(gc.token);
    if (elR && gc.repo) elR.value = gc.repo;
    if (elF && gc.file) elF.value = gc.file;
    const ls = document.getElementById('gh-last');
    if (ls) ls.textContent = gc.lastSync ? 'Último backup: ' + fDate(gc.lastSync) : 'Sin backups todavía';
    // Aviso de cambios sin guardar (2026-07-24, a pedido del usuario): compara
    // el fingerprint del estado actual contra el que quedó guardado en el
    // último backup exitoso (ghBackup()/ghLoadLatest()/ghRestore() son los 3
    // únicos que tocan lastBackupFp). Sin token/repo configurado, o sin ningún
    // backup todavía, no hay nada contra qué comparar — no se muestra nada.
    const _ghConfigurado = !!(gc.token && gc.repo);
    const _ghHasBaseline = _ghConfigurado && !!gc.lastBackupFp;
    // 2026-07-29, a pedido del usuario: mismo fingerprint también colorea los
    // botones de Guardar/Cargar, no solo el aviso de texto de abajo. Sin
    // baseline (nunca se hizo backup) pero YA configurado se trata como "hay
    // algo pendiente" — el primer backup siempre cuenta como pendiente.
    const hasUnsaved = _ghHasBaseline ? (_bkFingerprint(ghData()) !== gc.lastBackupFp) : true;
    const unsavedEl = document.getElementById('gh-unsaved');
    if (unsavedEl) unsavedEl.style.display = (_ghHasBaseline && hasUnsaved) ? 'block' : 'none';
    // gc.lastBackupSource distingue CÓMO se llegó al baseline actual ('save':
    // ghSaveCfg()/ghBackup() — Cargar es la acción sana siguiente; 'load':
    // ghLoadLatest()/ghRestore() — ya se cargó, recargar de nuevo sin cambios
    // de por medio es redundante). Default 'save' para configs pre-existentes
    // a este fix, que tienen lastBackupFp sin este campo.
    const _source = gc.lastBackupSource || 'save';
    const btnGuardar = document.getElementById('gh-btn-guardar');
    // Sin token/repo configurado ninguno de los 2 botones puede hacer nada
    // real todavía (ambos tiran "⚠ No configurado" al click) — gris/gris y
    // deshabilitados, no verde/rojo, hasta que haya una config real contra
    // la que evaluar.
    if (btnGuardar) {
      btnGuardar.className = 'btn ' + (!_ghConfigurado ? 'btn-s' : (hasUnsaved ? 'btn-wn' : 'btn-s'));
      btnGuardar.disabled = !_ghConfigurado || !hasUnsaved;
    }
    const btnCargar = document.getElementById('gh-btn-cargar');
    if (btnCargar) {
      // Rojo+deshabilitado SOLO en el caso puntual "ya cargué y nada cambió
      // desde entonces" — evita recargar exactamente lo mismo que ya está en
      // pantalla. Dirty (hasUnsaved) siempre lo deja habilitado: cargar para
      // descartar cambios locales sigue siendo una acción válida (con su
      // propio confirm() de advertencia en ghLoadLatest/ghRestore).
      const _cargarRojo = _ghConfigurado && _source === 'load';
      btnCargar.className = 'btn ' + (!_ghConfigurado ? 'btn-s' : (_cargarRojo ? 'btn-d' : 'btn-wn'));
      btnCargar.disabled = !_ghConfigurado || (!hasUnsaved && _cargarRojo);
    }
    const hdr = document.getElementById('gh-hdr-status');
    if (hdr) hdr.innerHTML = gc.token && gc.repo
      ? `☁ GitHub: <b style="color:var(--ac)">${esc(gc.repo)}</b> · <span style="color:var(--tx3)">${gc.lastSync ? fDate(gc.lastSync) : 'sin sync'}</span>`
      : '☁ GitHub: <b style="color:var(--tx3)">no configurado</b>';
  }

  /* ============================================================
     RENDER PRINCIPAL
     ============================================================ */
  function renderCfg() {
    try { ghLoadCfg(); } catch (e) {}
  }

  /* ── Inicializador del módulo (lo llama main.js en cada montaje) ── */
  function cfgInit() {
    // Listener delegado para cerrar modales al clickear overlay.
    // Se adjunta cada vez porque los overlays se re-inyectan con el HTML.
    document.querySelectorAll('.modal-overlay').forEach(o => {
      if (o.dataset._cfgBound) return;
      o.dataset._cfgBound = '1';
      o.addEventListener('click', e => { if (e.target === o) o.classList.remove('open'); });
    });
    renderCfg();
  }

  /* ============================================================
     EXPOSICIÓN AL SCOPE GLOBAL
     Solo lo que la UI (onclick/oninput) o main.js necesitan.
     ============================================================ */
  window.cfgInit        = cfgInit;
  window.clearCacheOnly = clearCacheOnly;
  window.closeM         = closeM;
  window.exportSystem   = exportSystem;
  window.importSystem   = importSystem;
  window.ghBackup       = ghBackup;
  window.ghDownload     = ghDownload;
  window.ghListBackups  = ghListBackups;
  window.ghDiffBackupModulos = ghDiffBackupModulos;
  window.ghLoadLatest   = ghLoadLatest;
  window.ghRestore      = ghRestore;
  window.ghSaveCfg      = ghSaveCfg;
  window.ghTest         = ghTest;
  window.hardReset      = hardReset;

  window.onModuleUnload = function () {
  };

})();
