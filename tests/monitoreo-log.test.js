var assert = require('assert');
var M = require('../monitoreo-log.js');

// Registro y orden (más reciente primero)
M.reset();
M.registrar('sesion', 'info', 'e1');
M.registrar('entrega', 'ok', 'e2');
assert.strictEqual(M.obtenerEventos().length, 2);
assert.strictEqual(M.obtenerEventos()[0].detalle, 'e2');
assert.strictEqual(M.obtenerEventos()[0].tipo, 'entrega');
assert.strictEqual(M.obtenerEventos()[0].resultado, 'ok');

// Tope circular en MAX (200)
M.reset();
for (var i = 0; i < 205; i++) { M.registrar('gps', 'ok', String(i)); }
assert.strictEqual(M.obtenerEventos().length, M.MAX);
assert.strictEqual(M.obtenerEventos()[0].detalle, '204');   // el más reciente
assert.strictEqual(M.obtenerEventos()[M.MAX - 1].detalle, '5'); // se descartaron 0..4

// Última sync OK por flujo (entrega / gps) — independientes
M.reset();
assert.strictEqual(M.ultimaSyncOk('entrega'), null);
assert.strictEqual(M.ultimaSyncOk('gps'), null);
M.marcarSyncOk('entrega');
assert.ok(typeof M.ultimaSyncOk('entrega') === 'string' && M.ultimaSyncOk('entrega').length > 0);
assert.strictEqual(M.ultimaSyncOk('gps'), null); // gps no se afecta por entrega
M.marcarSyncOk('gps');
assert.ok(typeof M.ultimaSyncOk('gps') === 'string');

// Pendientes
M.reset();
assert.strictEqual(M.getPendientes(), 0);
M.setPendientes(3);
assert.strictEqual(M.getPendientes(), 3);

// formatearTexto incluye el detalle y el tipo
M.reset();
M.registrar('firebase', 'error', 'permission-denied');
var txt = M.formatearTexto();
assert.ok(txt.indexOf('permission-denied') >= 0);
assert.ok(txt.indexOf('firebase') >= 0);

console.log('OK: todos los asserts pasaron');
