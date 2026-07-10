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

  /** Persiste arr en localStorage, actualiza cache y notifica suscriptores. */
  function set(arr) {
    if (!Array.isArray(arr)) return;
    _cache = arr;
    try { localStorage.setItem(KEY, JSON.stringify(arr)); } catch { /* cuota */ }
    _notify();
  }

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

  // Cambios desde otra pestaña del navegador.
  window.addEventListener('storage', function (e) {
    if (e.key === KEY) invalidate();
  });

  /* ── Exposición global ─────────────────────────────────── */

  window.IngStore = { get, set, subscribe, invalidate };

})();
