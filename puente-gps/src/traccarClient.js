// Cliente minimo de solo lectura para la API REST de Traccar.
function authHeader(usuario, clave) {
  return 'Basic ' + Buffer.from(usuario + ':' + clave).toString('base64');
}

function crearClienteTraccar(config, fetchFn) {
  fetchFn = fetchFn || fetch;
  var headers = { Authorization: authHeader(config.usuario, config.clave) };

  function obtenerDispositivos() {
    return fetchFn(config.baseUrl + '/api/devices', { headers: headers }).then(function (res) {
      if (!res.ok) throw new Error('Traccar /api/devices respondio ' + res.status);
      return res.json();
    });
  }

  function obtenerPosiciones() {
    return fetchFn(config.baseUrl + '/api/positions', { headers: headers }).then(function (res) {
      if (!res.ok) throw new Error('Traccar /api/positions respondio ' + res.status);
      return res.json();
    });
  }

  return { obtenerDispositivos: obtenerDispositivos, obtenerPosiciones: obtenerPosiciones };
}

module.exports = { crearClienteTraccar: crearClienteTraccar, authHeader: authHeader };
