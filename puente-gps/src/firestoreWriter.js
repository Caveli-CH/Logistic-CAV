var admin = require('firebase-admin');

// Siempre escribe el estado del vehiculo, tenga o no turno publicado hoy.
function escribirEstadoVehiculo(db, imei, datos) {
  return db.collection('vehiculos').doc(imei).set({
    posicionActual: datos,
    ultimaActualizacion: new Date().toISOString()
  }, { merge: true });
}

// Mismo formato que escribirGpsCoords() de distribucion-app.html, mas los campos de
// sensores como extras de nivel superior. rastro sigue siendo solo {lat,lng,ts} para
// no arriesgar el limite de 1MB por documento de Firestore.
// ts del rastro = hora real del GPS (fixTime), no la hora en que escribe el puente.
// Antes se usaba la hora de escritura y, sin senal, el rastro sumaba puntos repetidos
// con horas falsas.
function escribirGpsJornada(db, jornadaId, chofer, imei, datos) {
  var punto = { lat: datos.lat, lng: datos.lng, ts: datos.timestamp || new Date().toISOString() };
  var doc = {
    lat: datos.lat, lng: datos.lng,
    precision: datos.precision,
    timestamp: datos.timestamp || punto.ts,
    chofer: chofer,
    fuenteGps: 'fisico',
    vehiculoImei: imei,
    ignition: datos.ignition, motion: datos.motion, power: datos.power,
    battery: datos.battery, batteryLevel: datos.batteryLevel, odometer: datos.odometer,
    alarm: datos.alarm, combustible: datos.combustible, sensores: datos.sensores,
    rastro: admin.firestore.FieldValue.arrayUnion(punto)
  };
  return db.collection('gps').doc(jornadaId).set(doc, { merge: true });
}

module.exports = { escribirEstadoVehiculo: escribirEstadoVehiculo, escribirGpsJornada: escribirGpsJornada };
