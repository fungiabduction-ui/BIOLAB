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

  function bkRestoreAll(data) {
    if (!data || typeof data !== 'object') throw new Error('JSON inválido');
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

  /* ── Backup / Restore local ── */
  function localExport() {
    const data = bkCollectAll();
    data._exported = new Date().toISOString();
    data._keys = Object.keys(data).filter(k => !k.startsWith('_'));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `biolab-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    URL.revokeObjectURL(a.href);
    sN(`Backup local exportado (${data._keys.length} keys)`);
  }

  function localImport(input) {
    const file = input.files[0]; if (!file) return;
    const r = new FileReader();
    r.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        const n = bkRestoreAll(data);
        sN(`Datos importados (${n} keys) — recargando...`);
        setTimeout(() => location.reload(), 1200);
      } catch (err) { sN('Error al importar: ' + err.message, true); }
    };
    r.readAsText(file); input.value = '';
  }

  /* ── Exportar / Importar / Reset ── */
  function exportData() {
    if (typeof localExport === 'function') return localExport();
    const data = bkCollectAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `biolab-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url); sN('Datos exportados');
  }

  function importData(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const d = JSON.parse(ev.target.result);
        const n = bkRestoreAll(d);
        sN(`Datos importados (${n} keys)`);
      } catch (err) { sN('Error al importar: ' + err.message, true); }
    };
    reader.readAsText(file);
  }

  function resetSystem() {
    if (!confirm('¿RESET COMPLETO? Se borrarán TODOS los datos de TODOS los módulos.')) return;
    bkAllKeys().forEach(key => localStorage.removeItem(key));
    localStorage.removeItem('bl2_seeded');
    sN('Sistema reseteado');
  }

  /* ============================================================
     HARD RESET — limpia datos + caché del navegador + SW
     Garantiza que el próximo reload cargue archivos frescos.
     ============================================================ */

  /**
   * Reseteo completo de datos Y caché del navegador.
   *
   * Secuencia:
   *   1. Borra todos los datos de localStorage (igual que resetSystem).
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
    const gc = gOb(K.gh, {}); gc.token = encToken(t); gc.repo = r; gc.file = f; sOb(K.gh, gc);
    ghLoadCfg(); sN('Configuración GitHub guardada');
  }

  async function ghApi(method, path, body) {
    const gc = gOb(K.gh, {}); if (!gc.token || !gc.repo) throw new Error('GitHub no configurado');
    const url = `https://api.github.com/repos/${gc.repo}/contents/${path}`;
    const headers = { 'Authorization': 'token ' + decToken(gc.token), 'Content-Type': 'application/json', 'Accept': 'application/vnd.github.v3+json' };
    let resp;
    try {
      resp = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch {
      const proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url);
      resp = await fetch(proxyUrl, { method, headers, body: body ? JSON.stringify(body) : undefined });
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
  // vía la Git Blobs API, que soporta hasta 100MB. Usada por ghPull/ghRestore.
  async function ghApiBlob(sha) {
    const gc = gOb(K.gh, {}); if (!gc.token || !gc.repo) throw new Error('GitHub no configurado');
    const url = `https://api.github.com/repos/${gc.repo}/git/blobs/${sha}`;
    const headers = { 'Authorization': 'token ' + decToken(gc.token), 'Accept': 'application/vnd.github.v3+json' };
    let resp;
    try {
      resp = await fetch(url, { headers });
    } catch {
      const proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url);
      resp = await fetch(proxyUrl, { headers });
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

  function ghData() {
    return bkCollectAll({ skipGh: true });
  }

  async function ghPush(silent = false) {
    const el = document.getElementById('gh-status-box');
    if (!silent) { el.style.display = 'block'; el.className = 'rbox'; el.innerHTML = '🔄 Guardando en GitHub...'; }
    try {
      const gc = gOb(K.gh, {});
      if (!gc.token || !gc.repo) { if (!silent) sN('GitHub no configurado', true); return; }
      const content = btoa(unescape(encodeURIComponent(JSON.stringify(ghData(), null, 2))));
      let sha = null; try { const cur = await ghApi('GET', gc.file); sha = cur.sha; } catch {}
      const body = { message: `BIOLAB sync · ${new Date().toLocaleString('es-AR')}`, content };
      if (sha) body.sha = sha;
      try {
        await ghApi('PUT', gc.file, body);
      } catch (e) {
        if (e.status === 409 || e.status === 422) {
          // SHA stale — reintentar una vez con SHA fresco
          const fresh = await ghApi('GET', gc.file);
          body.sha = fresh.sha;
          await ghApi('PUT', gc.file, body);
        } else {
          throw e;
        }
      }
      gc.lastSync = now(); sOb(K.gh, gc);
      if (!silent) { el.className = 'rbox'; el.innerHTML = '✓ Guardado · ' + fDate(gc.lastSync); }
      const last = document.getElementById('gh-last');
      if (last) last.textContent = 'Último guardado: ' + fDate(gc.lastSync);
      ghLoadCfg();
      if (!silent) sN('Guardado en GitHub');
    } catch (e) {
      if (!silent) { el.style.display = 'block'; el.className = 'rbox er'; el.innerHTML = '✕ ' + e.message; }
      sN('Error: ' + e.message, true);
    }
  }

  async function ghPull() {
    const el = document.getElementById('gh-status-box');
    el.style.display = 'block'; el.className = 'rbox'; el.innerHTML = '🔄 Cargando...';
    try {
      const gc = gOb(K.gh, {});
      if (!gc.token || !gc.repo) { el.className = 'rbox er'; el.innerHTML = '⚠ No configurado'; return; }
      const file = await ghApi('GET', gc.file);
      const blob = await ghApiBlob(file.sha);
      const decoded = decodeURIComponent(escape(atob(blob.content.replace(/\n/g, ''))));
      const data = JSON.parse(decoded);
      const n = bkRestoreAll(data);
      el.className = 'rbox'; el.innerHTML = `✓ Datos cargados desde GitHub (${n} keys) — recargando...`;
      sN(`Datos cargados desde GitHub (${n} keys) — recargando...`);
      setTimeout(() => location.reload(), 1200);
    } catch (e) { el.className = 'rbox er'; el.innerHTML = '✕ ' + e.message; sN('Error: ' + e.message, true); }
  }

  async function ghBackup() {
    const el = document.getElementById('gh-status-box');
    el.style.display = 'block'; el.className = 'rbox'; el.innerHTML = '🔄 Guardando backup...';
    try {
      const gc = gOb(K.gh, {});
      if (!gc.token || !gc.repo) { el.className = 'rbox er'; el.innerHTML = '⚠ No configurado'; return; }
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const path = `backups/biolab-backup-${ts}.json`;
      const content = btoa(unescape(encodeURIComponent(JSON.stringify(ghData(), null, 2))));
      await ghApi('PUT', path, { message: `BIOLAB backup · ${ts}`, content });
      el.className = 'rbox'; el.innerHTML = `✓ Backup guardado en <code>${path}</code>`;
      sN('Backup guardado');
    } catch (e) { el.className = 'rbox er'; el.innerHTML = '✕ ' + e.message; sN('Error: ' + e.message, true); }
  }

  async function ghListBackups() {
    const el = document.getElementById('gh-bk-list');
    el.style.display = 'block'; el.innerHTML = '🔄 Cargando...';
    try {
      const gc = gOb(K.gh, {});
      if (!gc.token || !gc.repo) { el.innerHTML = 'No configurado'; return; }
      const files = await ghApi('GET', 'backups').catch(() => []);
      if (!files.length) { el.innerHTML = '<div class="empty">Sin backups todavía</div>'; return; }
      el.innerHTML = `<div class="tw"><table><thead><tr><th>Archivo</th><th>Acción</th></tr></thead><tbody>${
        files.map(f => `<tr>
          <td style="font-size:12px;color:var(--tx2)">${f.name}</td>
          <td><button class="btn btn-s" style="height:26px;font-size:10px" onclick="ghRestore('${f.path}')">Restaurar</button></td>
        </tr>`).join('')
      }</tbody></table></div>`;
    } catch (e) { el.innerHTML = 'Error: ' + e.message; }
  }

  async function ghRestore(path) {
    if (!confirm('¿Restaurar este backup? Se sobreescribirán los datos actuales.')) return;
    const el = document.getElementById('gh-status-box');
    el.style.display = 'block'; el.className = 'rbox'; el.innerHTML = '🔄 Restaurando...';
    try {
      const file = await ghApi('GET', path);
      const blob = await ghApiBlob(file.sha);
      const decoded = decodeURIComponent(escape(atob(blob.content.replace(/\n/g, ''))));
      const data = JSON.parse(decoded);
      const n = bkRestoreAll(data);
      el.className = 'rbox'; el.innerHTML = `✓ Backup restaurado (${n} keys) — recargando...`;
      sN(`Backup restaurado (${n} keys) — recargando...`);
      setTimeout(() => location.reload(), 1200);
    } catch (e) { el.className = 'rbox er'; el.innerHTML = '✕ ' + e.message; }
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
    if (ls) ls.textContent = gc.lastSync ? 'Último guardado: ' + fDate(gc.lastSync) : 'Sin sincronizaciones aún';
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

  /* ============================================================
     FUNCIONALIDADES AGREGADAS: BACKUP GLOBAL COMPLETO (ALL KEYS)
     ============================================================ */

  function exportAll() {
    const backup = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      backup[key] = localStorage.getItem(key);
    }
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    var _n = new Date();
    var _pad = function(v) { return String(v).padStart(2,'0'); };
    var _ts = _pad(_n.getDate()) + '_' + _pad(_n.getMonth()+1) + '_' + _n.getFullYear()
            + '_' + _pad(_n.getHours()) + _pad(_n.getMinutes()) + _pad(_n.getSeconds());
    a.download = 'biolab_full_backup - ' + _ts + '.json';
    a.click();
    URL.revokeObjectURL(url);
    sN('Backup global exportado con éxito');
  }

  function importAll(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const data = JSON.parse(e.target.result);
        if (confirm('Esto sobreescribirá TODO el sistema. ¿Continuar?')) {
          localStorage.clear();
          for (const key in data) {
            localStorage.setItem(key, data[key]);
          }
          sN('Sistema restaurado. Recargando...', false);
          setTimeout(() => location.reload(), 1500);
        }
      } catch (err) {
        console.error('Error al importar:', err);
        sN('Error crítico al importar el JSON', true);
      }
    };
    reader.readAsText(file);
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
  window.closeM         = closeM;
  window.exportAll      = exportAll;
  window.exportData     = exportData;
  window.ghBackup       = ghBackup;
  window.ghListBackups  = ghListBackups;
  window.ghPull         = ghPull;
  window.ghPush         = ghPush;
  window.ghRestore      = ghRestore;
  window.ghSaveCfg      = ghSaveCfg;
  window.ghTest         = ghTest;
  window.hardReset      = hardReset;
  window.importAll      = importAll;
  window.importData     = importData;
  window.localExport    = localExport;
  window.localImport    = localImport;
  window.resetSystem    = resetSystem;

  window.onModuleUnload = function () {
  };

})();
