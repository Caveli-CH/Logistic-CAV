var assert = require('assert');
var { mapearPosicion } = require('../src/mapPosition');

function run() {
  var posicion = {
    latitude: -33.45, longitude: -70.66, accuracy: 4.2,
    fixTime: '2026-08-27T12:00:00.000Z',
    attributes: {
      ignition: true, motion: true, power: 13.8, battery: 4.1, batteryLevel: 92,
      odometer: 152300, alarm: 'harshBraking',
      in1: 0, out1: 0, sat: 11, rssi: 3
    }
  };
  var mapeado = mapearPosicion(posicion);
  assert.strictEqual(mapeado.lat, -33.45);
  assert.strictEqual(mapeado.lng, -70.66);
  assert.strictEqual(mapeado.timestamp, '2026-08-27T12:00:00.000Z');
  assert.strictEqual(mapeado.ignition, true);
  assert.strictEqual(mapeado.alarm, 'harshBraking');
  assert.strictEqual(mapeado.combustible, null);
  assert.deepStrictEqual(mapeado.sensores, { in1: 0, out1: 0, sat: 11, rssi: 3 });

  var sinAtributos = mapearPosicion({ latitude: 0, longitude: 0, fixTime: 'x', attributes: {} });
  assert.strictEqual(sinAtributos.ignition, null);
  assert.deepStrictEqual(sinAtributos.sensores, {});

  console.log('OK: mapPosition');
}

run();
