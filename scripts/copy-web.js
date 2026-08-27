// Ensambla www/ con los archivos que necesita la app del chofer.
// La fuente de verdad sigue siendo la raiz del repo (tambien usada por el PWA).
var fs = require('fs');
var path = require('path');

var root = path.join(__dirname, '..');
var out = path.join(root, 'www');

var archivos = [
  'index.html',
  'distribucion-app.html',
  'monitoreo-log.js',
  'jornada-id.js',
  'manifest.json',
  'sw.js',
  'icon-192.svg',
  'icon-512.svg'
];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

archivos.forEach(function (f) {
  var src = path.join(root, f);
  if (!fs.existsSync(src)) {
    console.error('FALTA archivo fuente: ' + f);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(out, f));
});

console.log('www/ ensamblado con ' + archivos.length + ' archivos');
