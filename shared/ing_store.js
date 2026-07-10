/* ============================================================
   BIOLAB ENGINE v3 — IngStore
   shared/ing_store.js

   Store reactivo para bl2_ings.
   - Cache en memoria: evita JSON.parse en cada lectura.
   - API de suscripción: cualquier componente recibe la lista
     actualizada sin polling ni re-renders manuales.
   - Compatible con la arquitectura IIFE existente: se expone en
     window.IngStore. Sin dependencias externas.
   - CILAB no necesita modificarse: escribe en localStorage y
     dispara 'cilab-ings-changed'; el store escucha ambas vías.
   ============================================================ */

'use strict';

(function () {

  const KEY = 'bl2_ings';
  let _cache = null;           // null = no inicializado (lazy)
  const _subs = new Set();     // Set<Function>

  /* ── Lectura ───────────────────────────────────────────── */

  function get() {
    if (_cache === null) _cache = _load();
    return _cache;
  }

  function _load() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY));
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }

  /* ── Escritura ─────────────────────────────────────────── */
  // IngStore es puramente un lector reactivo — CILAB (cilab_app.js) es el
  // único escritor real de bl2_ings. No existe función set()/write() acá
  // a propósito: escribir desde este store bypassearía el merge/validación
  // de CILAB y crearía un segundo escritor descoordinado de la SSoT.

  /** Descarta cache y recarga desde localStorage, luego notifica. */
  function invalidate() {
    _cache = _load();
    _notify();
  }

  /* ── Suscripción ───────────────────────────────────────── */

  /**
   * Registra una función que recibe el array de ingredientes
   * cada vez que cambia.
   * @returns {Function} unsub — llamar para cancelar la suscripción.
   */
  function subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    _subs.add(fn);
    return function unsub() { _subs.delete(fn); };
  }

  function _notify() {
    const snapshot = _cache;
    _subs.forEach(fn => { try { fn(snapshot); } catch (e) { console.warn('[IngStore] suscriptor lanzó error:', e); } });
  }

  /* ── Listeners cross-módulo ────────────────────────────── */

  // CILAB dispara 'cilab-ings-changed' tras cada escritura en bl2_ings.
  window.addEventListener('cilab-ings-changed', function () {
    invalidate();
  });

  // Cambios desde otra pestaña del navegador. e.key === null es el caso
  // localStorage.clear() (ej. CFG → importAll() restaurando un backup
  // completo) — sin este chequeo, un clear() en otra pestaña dejaba el
  // cache de esta pestaña sirviendo ingredientes ya borrados.
  window.addEventListener('storage', function (e) {
    if (e.key === KEY || e.key === null) invalidate();
  });

  /* ── Exposición global ─────────────────────────────────── */

  window.IngStore = { get, subscribe, invalidate };

})();
