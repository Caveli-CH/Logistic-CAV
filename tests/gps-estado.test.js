var assert = require('assert');
var G = require('../gps-estado.js');

// clasificarEstadoGps
assert.strictEqual(G.clasificarEstadoGps(0).nivel, 'activo');
assert.strictEqual(G.clasificarEstadoGps(59000).nivel, 'activo');
assert.strictEqual(G.clasificarEstadoGps(60000).nivel, 'atrasado');
assert.strictEqual(G.clasificarEstadoGps(179000).nivel, 'atrasado');
assert.strictEqual(G.clasificarEstadoGps(180000).nivel, 'sin-senal');
assert.strictEqual(G.clasificarEstadoGps(0).color, '#2d5f4f');
assert.strictEqual(G.clasificarEstadoGps(60000).color, '#e6a800');
assert.strictEqual(G.clasificarEstadoGps(180000).color, '#d94545');

// formatearAntiguedad
assert.strictEqual(G.formatearAntiguedad(45000), 'hace 45s');
assert.strictEqual(G.formatearAntiguedad(5000), 'hace 5s');
assert.strictEqual(G.formatearAntiguedad(120000), 'hace 2 min');
assert.strictEqual(G.formatearAntiguedad(90000), 'hace 2 min');

console.log('OK: todos los asserts pasaron');
