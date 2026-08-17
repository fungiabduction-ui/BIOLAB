/* ============================================================
   shared/error_log.js — registro de fallos de guardado/operación
   ============================================================
   Motivado 2026-08-17 (incidente CFG/GitHub Sync, ver CLAUDE.md
   "GITHUB — Publicación y Backups" y mejoras_app.md MEJ-0045/0046):
   antes, un guardado fallido (localStorage lleno, error de red, lo
   que sea) quedaba como mucho en un console.error que se pierde al
   cerrar la pestaña — no había forma de auditar qué pasó después del
   hecho, ni de que el usuario supiera que algo NO se guardó.

   window.BioLog.logError(modulo, accion, err, extra) registra el
   fallo con TODO el contexto explícito (mensaje, stack, status HTTP
   si aplica, timestamp, extra) en:
     1. console.error — inspección en vivo en DevTools.
     2. localStorage['biolab_error_log'] (cap 200 entradas, FIFO) —
        sobrevive al cierre de la pestaña, y viaja automáticamente
        con CUALQUIER backup/export (exportSystem/ghBackup ya barren
        TODO localStorage sin filtrar por prefijo conocido; el prefijo
        'biolab_' también está en BK_PREFIXES de cfg_app.js, así que
        además sobrevive a un restore selectivo). Una sesión futura de
        Claude Code analizando un backup puede leer esta key directo,
        sin depender de que el usuario copie/pegue DevTools a mano.

   NUNCA loggear el token de GitHub ni ningún dato sensible en `extra`
   — mismo criterio que bl2_gh, que ya está excluido de todo backup.

   No es un módulo del loader (como ci_gr_links.js/gr_su_sources.js).
   Se carga en index.html ANTES de main.js y de cualquier módulo, para
   estar disponible sin importar el orden en que un módulo lo llame.
   ============================================================ */
(function () {
  var KEY = 'biolab_error_log';
  var MAX_ENTRIES = 200;

  function _read() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
    catch (e) { return []; }
  }

  function _write(arr) {
    try { localStorage.setItem(KEY, JSON.stringify(arr)); }
    catch (e) {
      // Si esto falla (ej. localStorage YA está lleno, precisamente el caso
      // que este log existe para auditar) no hay mucho más que hacer del
      // lado de persistencia — al menos ya quedó en consola.
      console.error('[BioLog] no se pudo persistir el log de errores (localStorage lleno?):', e);
    }
  }

  // modulo: 'CFG' | 'FR' | 'GR' | 'SU' | 'CI' | 'CILAB' | 'GE' — string libre.
  // accion: nombre de la función/operación que falló (ej. 'saveBolsas', 'ghBackup').
  // err: el Error/excepción real (o cualquier valor pasado a un catch).
  // extra: objeto plano opcional con contexto adicional NO sensible (ids,
  //        tamaños, keys involucradas) — nunca tokens/credenciales.
  function logError(modulo, accion, err, extra) {
    var entry = {
      ts: new Date().toISOString(),
      modulo: modulo,
      accion: accion,
      mensaje: (err && err.message) || String(err),
      stack: (err && err.stack) || null,
      status: (err && err.status != null) ? err.status : null,
      extra: extra || null
    };
    var log = _read();
    log.push(entry);
    if (log.length > MAX_ENTRIES) log = log.slice(log.length - MAX_ENTRIES);
    _write(log);
    console.error('[BIOLAB:' + modulo + '] ' + accion + ' falló — ver localStorage["' + KEY + '"] para el registro completo.', entry);
    return entry;
  }

  function getLog() { return _read(); }
  function clearLog() { _write([]); }

  window.BioLog = { logError: logError, getLog: getLog, clearLog: clearLog, KEY: KEY };
})();
