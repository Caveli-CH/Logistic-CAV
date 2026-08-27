// Parseo del identificador de jornada ("YYYY-MM-DD-slugChofer") en fecha + slug.
(function (root) {
  function parsearJornadaId(jornadaId) {
    var partes = (jornadaId || '').split('-');
    var fecha = partes.slice(0, 3).join('-');
    var slug = jornadaId.substring(fecha.length + 1);
    return { fecha: fecha, slug: slug };
  }

  var api = { parsearJornadaId: parsearJornadaId };

  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  else { root.JornadaId = api; }
})(typeof self !== 'undefined' ? self : this);
