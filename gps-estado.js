// Lógica pura de frescura del GPS. Usable en navegador (window.GpsEstado)
// y en Node (require). Sin dependencias.
(function (root) {
  var ACTIVO_MAX = 60000;    // < 60s
  var ATRASADO_MAX = 180000; // < 180s

  function clasificarEstadoGps(ageMs) {
    if (ageMs < ACTIVO_MAX)  return { nivel: 'activo',    color: '#2d5f4f' };
    if (ageMs < ATRASADO_MAX) return { nivel: 'atrasado',  color: '#e6a800' };
    return { nivel: 'sin-senal', color: '#d94545' };
  }

  function formatearAntiguedad(ageMs) {
    var s = Math.round(ageMs / 1000);
    if (s < 60) return 'hace ' + s + 's';
    return 'hace ' + Math.round(s / 60) + ' min';
  }

  var api = {
    clasificarEstadoGps: clasificarEstadoGps,
    formatearAntiguedad: formatearAntiguedad
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  else { root.GpsEstado = api; }
})(typeof self !== 'undefined' ? self : this);
