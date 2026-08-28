// Determina, para hoy, que jornadaId (fecha+slug de chofer) corresponde a cada vehiculo por IMEI.
function fechaHoy() {
  return new Date().toISOString().split('T')[0];
}

function obtenerAsignacionesHoy(db) {
  var fecha = fechaHoy();
  return db.collection('jornadas').doc('registro-' + fecha).get().then(function (doc) {
    var mapa = {};
    if (!doc.exists) return mapa;
    var choferes = doc.data().choferes || [];
    choferes.forEach(function (c) {
      if (c.vehiculoImei) {
        mapa[c.vehiculoImei] = { jornadaId: fecha + '-' + c.slug, chofer: c.nombre };
      }
    });
    return mapa;
  });
}

module.exports = { obtenerAsignacionesHoy: obtenerAsignacionesHoy, fechaHoy: fechaHoy };
