var assert = require('assert');
var J = require('../jornada-id.js');

assert.deepStrictEqual(J.parsearJornadaId('2026-08-27-francisco-munoz'), { fecha: '2026-08-27', slug: 'francisco-munoz' });
assert.deepStrictEqual(J.parsearJornadaId('2026-08-27-juan'), { fecha: '2026-08-27', slug: 'juan' });
assert.deepStrictEqual(J.parsearJornadaId('2026-08-27'), { fecha: '2026-08-27', slug: '' });

console.log('OK: todos los asserts pasaron');
