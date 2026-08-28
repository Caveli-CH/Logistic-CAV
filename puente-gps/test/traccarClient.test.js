var assert = require('assert');
var { crearClienteTraccar, authHeader } = require('../src/traccarClient');

async function run() {
  assert.strictEqual(authHeader('a', 'b'), 'Basic ' + Buffer.from('a:b').toString('base64'));

  var llamadas = [];
  var fetchFake = function (url, opts) {
    llamadas.push({ url: url, opts: opts });
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve([{ id: 1, uniqueId: '123456789012345' }]); } });
  };
  var cliente = crearClienteTraccar({ baseUrl: 'http://vm:8082', usuario: 'u', clave: 'p' }, fetchFake);
  var dispositivos = await cliente.obtenerDispositivos();
  assert.strictEqual(llamadas.length, 1);
  assert.strictEqual(llamadas[0].url, 'http://vm:8082/api/devices');
  assert.strictEqual(llamadas[0].opts.headers.Authorization, authHeader('u', 'p'));
  assert.strictEqual(dispositivos[0].uniqueId, '123456789012345');

  var fetchFalla = function () { return Promise.resolve({ ok: false, status: 401 }); };
  var clienteFalla = crearClienteTraccar({ baseUrl: 'http://vm:8082', usuario: 'u', clave: 'p' }, fetchFalla);
  await assert.rejects(clienteFalla.obtenerPosiciones(), /401/);

  console.log('OK: traccarClient');
}

run();
