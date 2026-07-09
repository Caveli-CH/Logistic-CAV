// Registro local de eventos/fallas de la app del chofer.
// Usable en navegador (window.Monitoreo) y en Node (require). Sin dependencias.
(function (root) {
  var CLAVE = 'caveli_monitoreo';
  var MAX = 200;
  var eventos = [];      // orden interno: más antiguo primero
  var syncOk = { entrega: null, gps: null };
  var pendientes = 0;

  function tieneLS() {
    try { return (typeof localStorage !== 'undefined') && !!localStorage; } catch (e) { return false; }
  }

  function persistir() {
    if (!tieneLS()) return;
    try { localStorage.setItem(CLAVE, JSON.stringify({ eventos: eventos, syncOk: syncOk, pendientes: pendientes })); } catch (e) {}
  }

  function rehidratar() {
    if (!tieneLS()) return;
    try {
      var s = JSON.parse(localStorage.getItem(CLAVE) || 'null');
      if (s) {
        eventos = s.eventos || [];
        syncOk = s.syncOk || { entrega: null, gps: null };
        pendientes = s.pendientes || 0;
      }
    } catch (e) {}
  }

  function registrar(tipo, resultado, detalle) {
    eventos.push({ ts: new Date().toISOString(), tipo: tipo, resultado: resultado, detalle: detalle || '' });
    if (eventos.length > MAX) { eventos = eventos.slice(eventos.length - MAX); }
    persistir();
  }

  function obtenerEventos() {
    return eventos.slice().reverse(); // más reciente primero
  }

  function marcarSyncOk(stream) {
    if (stream !== 'entrega' && stream !== 'gps') return;
    syncOk[stream] = new Date().toISOString();
    persistir();
  }
  function ultimaSyncOk(stream) { return syncOk[stream] || null; }

  function setPendientes(n) { pendientes = n; persistir(); }
  function getPendientes() { return pendientes; }

  function formatearTexto() {
    return obtenerEventos().map(function (e) {
      var hora = new Date(e.ts).toLocaleString('es-CL');
      var ic = e.resultado === 'ok' ? 'OK' : (e.resultado === 'error' ? 'ERROR' : '-');
      return hora + '  ' + ic + ' [' + e.tipo + '] ' + e.detalle;
    }).join('\n');
  }

  function reset() { eventos = []; syncOk = { entrega: null, gps: null }; pendientes = 0; }

  rehidratar();

  var api = {
    registrar: registrar,
    obtenerEventos: obtenerEventos,
    marcarSyncOk: marcarSyncOk,
    ultimaSyncOk: ultimaSyncOk,
    setPendientes: setPendientes,
    getPendientes: getPendientes,
    formatearTexto: formatearTexto,
    reset: reset,
    MAX: MAX
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  else { root.Monitoreo = api; }
})(typeof self !== 'undefined' ? self : this);
