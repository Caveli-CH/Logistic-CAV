var admin = require('firebase-admin');
var { crearClienteTraccar } = require('./traccarClient');
var { obtenerAsignacionesHoy } = require('./asignaciones');
var { mapearPosicion } = require('./mapPosition');
var { escribirEstadoVehiculo, escribirGpsJornada } = require('./firestoreWriter');

var INTERVALO_MS = 15000; // igual al throttle de distribucion-app.html y dashboard.html

admin.initializeApp({ credential: admin.credential.cert(require(process.env.CAVELI_SERVICE_ACCOUNT)) });
var db = admin.firestore();

var traccar = crearClienteTraccar({
  baseUrl: process.env.TRACCAR_URL,
  usuario: process.env.TRACCAR_USUARIO,
  clave: process.env.TRACCAR_CLAVE
});

function log(msg) { console.log('[' + new Date().toISOString() + '] ' + msg); }

function ciclo() {
  Promise.all([traccar.obtenerDispositivos(), traccar.obtenerPosiciones(), obtenerAsignacionesHoy(db)])
    .then(function (resultados) {
      var dispositivos = resultados[0], posiciones = resultados[1], asignaciones = resultados[2];
      var idAImei = {};
      dispositivos.forEach(function (d) { idAImei[d.id] = d.uniqueId; });

      var tareas = posiciones.map(function (posicion) {
        var imei = idAImei[posicion.deviceId];
        if (!imei) return Promise.resolve();
        var datos = mapearPosicion(posicion);

        var tareaVehiculo = escribirEstadoVehiculo(db, imei, datos)
          .catch(function (e) { log('ERROR escribiendo vehiculos/' + imei + ': ' + e.message); });

        var asignacion = asignaciones[imei];
        var tareaJornada = asignacion
          ? escribirGpsJornada(db, asignacion.jornadaId, asignacion.chofer, imei, datos)
              .catch(function (e) { log('ERROR escribiendo gps/' + asignacion.jornadaId + ': ' + e.message); })
          : Promise.resolve();

        return Promise.all([tareaVehiculo, tareaJornada]);
      });

      return Promise.all(tareas);
    })
    .then(function () { log('Ciclo OK'); })
    .catch(function (e) { log('ERROR en ciclo: ' + e.message); })
    .finally(function () { setTimeout(ciclo, INTERVALO_MS); });
}

log('Puente GPS iniciado. Traccar: ' + process.env.TRACCAR_URL);
ciclo();
