var assert = require('assert');
var { escribirEstadoVehiculo, escribirGpsJornada } = require('../src/firestoreWriter');

function fakeDb() {
  var llamadas = [];
  return {
    llamadas: llamadas,
    collection: function (nombre) {
      return {
        doc: function (id) {
          return {
            set: function (datos, opts) {
              llamadas.push({ coleccion: nombre, id: id, datos: datos, opts: opts });
              return Promise.resolve();
            }
          };
        }
      };
    }
  };
}

async function run() {
  var db = fakeDb();
  await escribirEstadoVehiculo(db, '111111111111111', { lat: 1, lng: 2, ignition: true });
  assert.strictEqual(db.llamadas[0].coleccion, 'vehiculos');
  assert.strictEqual(db.llamadas[0].id, '111111111111111');
  assert.strictEqual(db.llamadas[0].datos.posicionActual.ignition, true);
  assert.strictEqual(db.llamadas[0].opts.merge, true);

  var db2 = fakeDb();
  await escribirGpsJornada(db2, '2026-08-27-francisco-munoz', 'Francisco Munoz', '111111111111111', {
    lat: 1, lng: 2, precision: 5, ignition: true, motion: true, power: 13.8, battery: 4.1,
    batteryLevel: 92, odometer: 100, alarm: null, combustible: null, sensores: { sat: 9 }
  });
  var llamada = db2.llamadas[0];
  assert.strictEqual(llamada.coleccion, 'gps');
  assert.strictEqual(llamada.id, '2026-08-27-francisco-munoz');
  assert.strictEqual(llamada.datos.fuenteGps, 'fisico');
  assert.strictEqual(llamada.datos.vehiculoImei, '111111111111111');
  assert.strictEqual(llamada.datos.chofer, 'Francisco Munoz');
  assert.strictEqual(llamada.datos.lat, 1);
  assert.strictEqual(llamada.opts.merge, true);

  console.log('OK: firestoreWriter');
}

run();
