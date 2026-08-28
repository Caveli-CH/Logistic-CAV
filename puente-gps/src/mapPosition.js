// Traduce una Position de la API de Traccar a los campos que escribimos en Firestore.
// Los campos de alta confianza (iguales en casi todos los protocolos de Traccar, no solo
// Teltonika) se promueven con nombre propio. Todo lo demas que Traccar haya decodificado
// (choque, remolque, manejo brusco, jamming, sabotaje, geocercas, etc.) se copia sin filtrar
// a "sensores" para no perder ningun dato de fabrica aunque no sepamos de antemano su nombre exacto.
var CAMPOS_CONOCIDOS = ['ignition', 'motion', 'power', 'battery', 'batteryLevel', 'odometer', 'alarm'];

function mapearPosicion(position) {
  var attrs = position.attributes || {};
  var salida = {
    lat: position.latitude,
    lng: position.longitude,
    precision: position.accuracy || null,
    timestamp: position.fixTime || position.deviceTime || position.serverTime || null,
    combustible: null, // reservado: llega con el adaptador OBDII Bluetooth (fase futura, no instalado)
    sensores: {}
  };
  CAMPOS_CONOCIDOS.forEach(function (campo) {
    salida[campo] = (attrs[campo] !== undefined) ? attrs[campo] : null;
  });
  Object.keys(attrs).forEach(function (k) {
    if (CAMPOS_CONOCIDOS.indexOf(k) === -1) salida.sensores[k] = attrs[k];
  });
  return salida;
}

module.exports = { mapearPosicion: mapearPosicion, CAMPOS_CONOCIDOS: CAMPOS_CONOCIDOS };
