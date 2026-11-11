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

// Una posicion sirve solo si Traccar la marca valida y no esta en 0,0.
// Los puntos 0,0 (el equipo sin senal) hacian saltar la camioneta miles de km en el mapa.
function esPosicionUtil(position) {
  if (!position || position.valid === false) return false;
  var lat = position.latitude, lng = position.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return false;
  if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) return false;
  return true;
}

module.exports = { mapearPosicion: mapearPosicion, esPosicionUtil: esPosicionUtil, CAMPOS_CONOCIDOS: CAMPOS_CONOCIDOS };
