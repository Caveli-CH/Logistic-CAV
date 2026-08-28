var assert = require('assert');
var { obtenerAsignacionesHoy, fechaHoy } = require('../src/asignaciones');

function fakeDb(data) {
  return {
    collection: function () {
      return { doc: function () { return { get: function () { return Promise.resolve(data); } }; } };
    }
  };
}

async function run() {
  var fecha = fechaHoy();

  var mapaVacio = await obtenerAsignacionesHoy(fakeDb({ exists: false }));
  assert.deepStrictEqual(mapaVacio, {});

  var conRegistro = fakeDb({
    exists: true,
    data: function () {
      return {
        choferes: [
          { nombre: 'Francisco Munoz', slug: 'francisco-munoz', idx: 0, vehiculoImei: '111111111111111' },
          { nombre: 'Pedro', slug: 'pedro', idx: 1 }
        ]
      };
    }
  });
  var mapa = await obtenerAsignacionesHoy(conRegistro);
  assert.deepStrictEqual(mapa, {
    '111111111111111': { jornadaId: fecha + '-francisco-munoz', chofer: 'Francisco Munoz' }
  });

  console.log('OK: asignaciones');
}

run();
