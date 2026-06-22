# Rastreo GPS confiable — Fase 1 (Capa A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer que el sistema diga la verdad sobre el GPS del chofer (avisar cuando la señal está vieja) y aguantar mejor con la pantalla encendida, sin tocar el modelo de datos.

**Architecture:** Mejoras solo en los HTML existentes. El dashboard detecta señal desactualizada con un temporizador propio (porque `onSnapshot` no se dispara si dejan de llegar datos). La app del chofer mantiene la pantalla activa (Wake Lock) y usa `watchPosition` en vez de `getCurrentPosition`+`setInterval`. Una lógica pura de clasificación de frescura se extrae a un archivo aparte para poder probarla con Node.

**Tech Stack:** HTML + JavaScript vanilla (ES5, sin build), Firebase Firestore (JS SDK), Google Maps JS API, Web APIs `geolocation` y `wakeLock`. Test puntual con Node (módulo `assert` integrado, sin framework).

## Global Constraints

- Estilo del código: JavaScript ES5 (`var`, `function`), igual que el resto de los archivos. No usar `let`/`const`/arrow en el código que vive dentro de los HTML.
- No cambiar el modelo de datos de Firestore: se sigue usando `gps/{jornadaId}` con `lat`, `lng`, `precision`, `timestamp`, `chofer`, `rastro`.
- Umbrales de frescura: **activo** < 60s; **atrasado** 60s–180s; **sin señal** ≥ 180s. Valores exactos copiados de la spec.
- Colores: activo `#2d5f4f`, atrasado `#e6a800`, sin señal `#d94545`.
- Degradación elegante: si el navegador no soporta `wakeLock`, continuar sin error.
- Solo Android en producción; no se prueba iOS.

---

### Task 1: Lógica pura de clasificación de frescura + test

Extrae a un archivo propio las dos funciones puras que el dashboard usará para decidir el estado de la señal. Es la única parte verdaderamente unit-testeable de esta fase; las demás tareas se verifican manualmente en navegador/celular.

**Files:**
- Create: `gps-estado.js`
- Test: `tests/gps-estado.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `GpsEstado.clasificarEstadoGps(ageMs: number) => { nivel: 'activo'|'atrasado'|'sin-senal', color: string }`
  - `GpsEstado.formatearAntiguedad(ageMs: number) => string` (ej. `"hace 45s"`, `"hace 2 min"`)
  - En Node, las mismas funciones vía `require('../gps-estado.js')`.

- [ ] **Step 1: Write the failing test**

Create `tests/gps-estado.test.js`:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/gps-estado.test.js`
Expected: FAIL con `Cannot find module '../gps-estado.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `gps-estado.js`:

```javascript
// Lógica pura de frescura del GPS. Usable en navegador (window.GpsEstado)
// y en Node (require). Sin dependencias.
(function (root) {
  var ACTIVO_MAX = 60000;    // < 60s
  var ATRASADO_MAX = 180000; // < 180s

  function clasificarEstadoGps(ageMs) {
    if (ageMs < ACTIVO_MAX)  return { nivel: 'activo',    color: '#2d5f4f' };
    if (ageMs < ATRASADO_MAX) return { nivel: 'atrasado',  color: '#e6a800' };
    return { nivel: 'sin-senal', color: '#d94545' };
  }

  function formatearAntiguedad(ageMs) {
    var s = Math.round(ageMs / 1000);
    if (s < 60) return 'hace ' + s + 's';
    return 'hace ' + Math.round(s / 60) + ' min';
  }

  var api = {
    clasificarEstadoGps: clasificarEstadoGps,
    formatearAntiguedad: formatearAntiguedad
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  else { root.GpsEstado = api; }
})(typeof self !== 'undefined' ? self : this);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/gps-estado.test.js`
Expected: PASS — imprime `OK: todos los asserts pasaron` y sale con código 0.

- [ ] **Step 5: Commit**

```bash
git add gps-estado.js tests/gps-estado.test.js
git commit -m "feat: logica pura de frescura GPS con test"
```

---

### Task 2: Detección de "GPS desactualizado" en el dashboard

Conecta la lógica de la Task 1 al dashboard: un temporizador revisa la antigüedad del último punto y recolorea el marcador del chofer + el texto de última actualización.

**Files:**
- Modify: `dashboard.html` (incluir script, vars de estado, recolor de marcador, timer de frescura)

**Interfaces:**
- Consumes: `GpsEstado.clasificarEstadoGps`, `GpsEstado.formatearAntiguedad` (Task 1).
- Produces: `revisarFrescuraGps()`, `colorMarcadorChofer(color)`, `svgChofer(fill)`, var global `ultimoGpsTs`.

- [ ] **Step 1: Incluir `gps-estado.js` en el dashboard**

En `dashboard.html`, justo antes de la etiqueta `<script>` que abre el script principal (la que contiene `var clientes = []`, alrededor de la línea 295), agregar:

```html
<script src="gps-estado.js"></script>
```

- [ ] **Step 2: Declarar variables de estado de frescura**

En `dashboard.html:298-299`, junto a `var marcadorChofer = null, mapa = null;`, añadir dos variables:

```javascript
var marcadorChofer = null, mapa = null;
var jornadaListener = null, gpsListener = null;
var ultimoGpsTs = null, frescuraTimer = null;
```

- [ ] **Step 3: Extraer el SVG del marcador y permitir recolorearlo**

En `dashboard.html`, reemplazar la función `actualizarMarcador` (líneas 621-647) por esta versión, que usa un helper `svgChofer(fill)` reutilizable y añade `colorMarcadorChofer`:

```javascript
function svgChofer(fill) {
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="42" height="42">' +
    '<circle cx="21" cy="21" r="19" fill="' + fill + '" stroke="white" stroke-width="3"/>' +
    '<text x="21" y="27" font-size="18" text-anchor="middle" fill="white">&#128666;</text>' +
    '</svg>'
  );
}

function actualizarMarcador(lat, lng) {
  if (!mapa) return;
  var pos = {lat: lat, lng: lng};

  if (!marcadorChofer) {
    marcadorChofer = new google.maps.Marker({
      position: pos,
      map: mapa,
      title: 'Chofer',
      zIndex: 999,
      icon: {
        url: svgChofer('#2d5f4f'),
        scaledSize: new google.maps.Size(42, 42),
        anchor: new google.maps.Point(21, 21)
      }
    });
  } else {
    marcadorChofer.setPosition(pos);
  }
  mapa.panTo(pos);
}

function colorMarcadorChofer(color) {
  if (!marcadorChofer) return;
  marcadorChofer.setIcon({
    url: svgChofer(color),
    scaledSize: new google.maps.Size(42, 42),
    anchor: new google.maps.Point(21, 21)
  });
}
```

- [ ] **Step 4: Añadir el chequeo de frescura y arrancar su temporizador**

En `dashboard.html`, reemplazar la función `escucharGPS` (líneas 813-837) por esta versión, que guarda `ultimoGpsTs`, llama a `revisarFrescuraGps()` en cada snapshot y arranca un temporizador cada 15s. Se añade `revisarFrescuraGps` justo después:

```javascript
function escucharGPS() {
  if (gpsListener) { gpsListener(); gpsListener = null; }
  gpsListener = db.collection('gps').doc(jornadaId).onSnapshot(function(doc) {
    if (!doc.exists) return;
    var data = doc.data();
    var ts   = data.timestamp ? new Date(data.timestamp).toLocaleTimeString('es-CL') : '-';

    ultimoGpsTs = data.timestamp || null;

    document.getElementById('ultima-gps').textContent = 'Ultima actualizacion GPS: ' + ts;
    document.getElementById('gps-coords').textContent = 'Lat: ' + data.lat.toFixed(5) + '  Lng: ' + data.lng.toFixed(5);
    document.getElementById('chofer-banner').style.display = 'block';
    document.getElementById('chofer-sub').textContent = 'GPS actualizado: ' + ts;
    if (data.chofer) document.getElementById('chofer-nombre').textContent = data.chofer;

    var puntosFirestore = data.rastro || [];
    if (puntosFirestore.length > 0) {
      rastro = puntosFirestore.map(function(p) { return {lat: p.lat, lng: p.lng}; });
      dibujarRastro();
    }

    actualizarMarcador(data.lat, data.lng);
    revisarFrescuraGps();
  });

  if (!frescuraTimer) frescuraTimer = setInterval(revisarFrescuraGps, 15000);
}

function revisarFrescuraGps() {
  if (!ultimoGpsTs) return;
  var age  = Date.now() - new Date(ultimoGpsTs).getTime();
  var info = GpsEstado.clasificarEstadoGps(age);
  colorMarcadorChofer(info.color);

  var el = document.getElementById('ultima-gps');
  var base = 'Ultima actualizacion GPS: ' + new Date(ultimoGpsTs).toLocaleTimeString('es-CL');
  if (info.nivel === 'activo') {
    el.textContent = base;
    el.style.color = '';
  } else {
    var prefijo = (info.nivel === 'sin-senal') ? '⚠ SIN SEÑAL — ' : '';
    el.textContent = base + ' — ' + prefijo + GpsEstado.formatearAntiguedad(age);
    el.style.color = info.color;
  }
}
```

- [ ] **Step 5: Verificación manual en navegador**

1. Abrir `dashboard.html` en el navegador y entrar a una jornada con datos de GPS.
2. En la consola del navegador, simular señal vieja para forzar cada estado:

```javascript
ultimoGpsTs = new Date(Date.now() - 30000).toISOString();  revisarFrescuraGps(); // verde, sin sufijo
ultimoGpsTs = new Date(Date.now() - 90000).toISOString();  revisarFrescuraGps(); // amarillo "hace 2 min"
ultimoGpsTs = new Date(Date.now() - 240000).toISOString(); revisarFrescuraGps(); // rojo "⚠ SIN SEÑAL — hace 4 min"
```

Expected: el marcador del chofer cambia de color (verde → amarillo → rojo) y el texto "Ultima actualizacion GPS" muestra el sufijo de antigüedad con el color correspondiente en los dos últimos casos.

- [ ] **Step 6: Commit**

```bash
git add dashboard.html
git commit -m "feat: dashboard avisa cuando el GPS del chofer esta desactualizado"
```

---

### Task 3: Wake Lock en la app del chofer

Mantiene la pantalla encendida mientras la jornada está activa, para que el temporizador/`watchPosition` no se congele cuando el teléfono va montado.

**Files:**
- Modify: `distribucion-app.html` (vars, funciones de wake lock, llamadas en start/stop, listener visibilitychange)

**Interfaces:**
- Consumes: nada.
- Produces: `pedirWakeLock()`, `liberarWakeLock()`, var global `wakeLock`.

- [ ] **Step 1: Declarar la variable y las funciones de Wake Lock**

En `distribucion-app.html`, junto a las variables de GPS (líneas 557-559, donde está `var gpsInterval = null;`), añadir la variable y, debajo de `setGpsStatus` (después de la línea 570), las funciones:

```javascript
var wakeLock = null;

function pedirWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      navigator.wakeLock.request('screen').then(function(wl) {
        wakeLock = wl;
        wakeLock.addEventListener('release', function() { wakeLock = null; });
      }).catch(function() {});
    }
  } catch (e) {}
}

function liberarWakeLock() {
  try {
    if (wakeLock) { wakeLock.release(); wakeLock = null; }
  } catch (e) {}
}
```

- [ ] **Step 2: Re-pedir el Wake Lock al volver a primer plano**

El Wake Lock se libera solo cuando la pantalla se oculta. Añadir un listener al final del bloque de inicio, después de `setConexion(navigator.onLine);` (línea 1550):

```javascript
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible' && gpsWatchId !== null) {
    pedirWakeLock();
  }
});
```

> Nota: `gpsWatchId` se introduce en la Task 4. Esta condición asume que el GPS está activo. Si ejecutas esta tarea antes que la Task 4, usa temporalmente `gpsInterval` en lugar de `gpsWatchId` y corrígelo en la Task 4.

- [ ] **Step 3: Pedir y liberar el Wake Lock junto con el GPS**

En `startGPS` (línea 620), añadir `pedirWakeLock();` justo después del guard `if (gpsInterval) return;`. En `stopGPS` (línea 634), añadir `liberarWakeLock();` antes de `setGpsStatus(...)`:

```javascript
function startGPS() {
  if (!navigator.geolocation) {
    setGpsStatus('gps-error', 'Este dispositivo no tiene GPS', '');
    showToast('Este dispositivo no soporta GPS', 'error');
    return;
  }
  if (gpsInterval) return;
  pedirWakeLock();
  setGpsStatus('gps-inactivo', 'Solicitando permiso GPS...', '');
  enviarGPS();
  gpsInterval = setInterval(enviarGPS, 15000);
}

function stopGPS() {
  if (gpsInterval) { clearInterval(gpsInterval); gpsInterval = null; }
  liberarWakeLock();
  setGpsStatus('gps-inactivo', 'GPS detenido', '');
  document.getElementById('gps-status-bar').style.display = 'none';
}
```

> Esta versión de `startGPS`/`stopGPS` todavía usa `gpsInterval`; la Task 4 la reemplaza por `watchPosition`. Se modifica aquí solo para insertar las llamadas de Wake Lock.

- [ ] **Step 4: Verificación manual en celular**

1. Servir el sitio y abrir `distribucion-app.html` en un celular Android (Chrome).
2. Iniciar una ruta (botón "Comenzar ruta").
3. Esperar y observar: la pantalla no se apaga sola mientras la jornada está activa.
4. Detener (Nueva jornada) y confirmar que la pantalla vuelve a apagarse normalmente.

Expected: pantalla permanece encendida durante la jornada; si el dispositivo no soporta Wake Lock, la app sigue funcionando sin errores en consola.

- [ ] **Step 5: Commit**

```bash
git add distribucion-app.html
git commit -m "feat: mantener pantalla activa (Wake Lock) durante la jornada"
```

---

### Task 4: `watchPosition` con throttle en la app del chofer

Reemplaza `getCurrentPosition`+`setInterval` por `watchPosition`, que es más robusto frente al congelamiento del temporizador. Limita la escritura a Firestore a una vez cada ~15s para no inflar `rastro`.

**Files:**
- Modify: `distribucion-app.html` (reemplazar `enviarGPS`/`startGPS`/`stopGPS`, ajustar referencias en líneas 626 y 1549)

**Interfaces:**
- Consumes: `pedirWakeLock`, `liberarWakeLock` (Task 3).
- Produces: `gpsWatchId` (reemplaza a `gpsInterval`), `gpsLastWrite`, `onGpsPos(pos)`, `onGpsErr(err)`, `escribirGps(pos)`.

- [ ] **Step 1: Reemplazar las variables de control del GPS**

En `distribucion-app.html:558`, cambiar `var gpsInterval = null;` por:

```javascript
var gpsWatchId = null;
var gpsLastWrite = 0;
var gpsErrores   = 0;
```

(La línea `var gpsErrores = 0;` ya existe justo debajo; consolidarla aquí y no duplicarla.)

- [ ] **Step 2: Reescribir el bloque de envío de GPS con `watchPosition`**

Reemplazar completamente las funciones `enviarGPS`, `startGPS` y `stopGPS` (líneas 572-638) por:

```javascript
function escribirGps(pos) {
  if (!db) return;
  try {
    var punto = { lat: pos.coords.latitude, lng: pos.coords.longitude, ts: new Date().toISOString() };
    db.collection('gps').doc(jornadaId).set({
      lat: punto.lat, lng: punto.lng,
      precision: pos.coords.accuracy,
      timestamp: punto.ts,
      chofer: nombreChofer || 'Chofer',
      rastro: firebase.firestore.FieldValue.arrayUnion(punto)
    }, { merge: true });
  } catch (e) {}
}

function onGpsPos(pos) {
  gpsErrores = 0;
  var precM = Math.round(pos.coords.accuracy);
  setGpsStatus('gps-activo', 'GPS activo — enviando al jefe', 'Precision: ' + precM + 'm');

  // Throttle: escribir como máximo cada 15s para no inflar el rastro
  var ahora = Date.now();
  if (ahora - gpsLastWrite < 15000) return;
  gpsLastWrite = ahora;
  escribirGps(pos);
}

function onGpsErr(err) {
  gpsErrores++;
  if (err.code === 1) {
    setGpsStatus('gps-error', 'Permiso GPS denegado — ve a Configuracion > Permisos', 'Activa ubicacion para esta app');
    showToast('GPS bloqueado: activa los permisos de ubicacion', 'error');
    stopGPS(); // No reintentar si fue denegado
  } else if (err.code === 2) {
    setGpsStatus('gps-error', 'Señal GPS debil (' + gpsErrores + ' intentos)', 'Buscando señal...');
  } else if (err.code === 3) {
    setGpsStatus('gps-error', 'GPS lento — reintentando...', 'Timeout');
  }
  if (gpsErrores >= 3) {
    showToast('GPS con problemas (' + gpsErrores + ' errores seguidos)', 'error');
  }
}

function startGPS() {
  if (!navigator.geolocation) {
    setGpsStatus('gps-error', 'Este dispositivo no tiene GPS', '');
    showToast('Este dispositivo no soporta GPS', 'error');
    return;
  }
  if (gpsWatchId !== null) return;
  pedirWakeLock();
  setGpsStatus('gps-inactivo', 'Solicitando permiso GPS...', '');
  gpsLastWrite = 0;
  gpsWatchId = navigator.geolocation.watchPosition(
    onGpsPos, onGpsErr,
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

function stopGPS() {
  if (gpsWatchId !== null) { navigator.geolocation.clearWatch(gpsWatchId); gpsWatchId = null; }
  liberarWakeLock();
  setGpsStatus('gps-inactivo', 'GPS detenido', '');
  document.getElementById('gps-status-bar').style.display = 'none';
}
```

- [ ] **Step 3: Actualizar la referencia de reanudación al iniciar la app**

En `distribucion-app.html:1549`, cambiar la condición que reanuda el GPS al recargar (usaba `gpsInterval`):

```javascript
if(startTime&&!timerInterval) startTimer();
if(startTime&&gpsWatchId===null) startGPS();
```

- [ ] **Step 4: Confirmar que no quedan referencias a `gpsInterval`**

Run: `grep -n "gpsInterval" distribucion-app.html`
Expected: sin resultados (cero coincidencias). Si aparece alguna, reemplazarla por `gpsWatchId` con la semántica correcta.

- [ ] **Step 5: Verificación manual en celular**

1. Abrir `distribucion-app.html` en un Android real e iniciar ruta.
2. Confirmar que la barra de estado muestra "GPS activo — enviando al jefe".
3. En el dashboard, confirmar que el marcador se mueve y "Ultima actualizacion GPS" se refresca (verde) mientras la app está en primer plano.
4. Moverse físicamente y confirmar que el rastro se va dibujando sin saltos de duplicados excesivos (throttle de 15s).

Expected: la ubicación se envía de forma continua con la app en primer plano; al denegar el permiso, se detiene sin reintentar.

- [ ] **Step 6: Commit**

```bash
git add distribucion-app.html
git commit -m "feat: usar watchPosition con throttle para enviar ubicacion del chofer"
```

---

## Fase 2 (Capa B) — fuera de este plan

La Capa B (contenedor Capacitor + plugin `@capacitor-community/background-geolocation`) es un subsistema independiente: introduce `npm`, carpeta `android/` y un pipeline de compilación, y sus pasos dependen del entorno Android y de la API exacta del plugin. Se planificará en su propio documento **cuando se inicie**, comenzando por el prerequisito de instalar Android Studio + JDK (paso B1 de la spec). La Capa A entregada aquí se reutiliza intacta dentro del contenedor nativo.

## Self-Review

- **Cobertura de la spec (Capa A):** A1 detección de desactualizado → Tasks 1-2; A2 Wake Lock → Task 3; A3 `watchPosition` con throttle → Task 4. Modelo de datos sin cambios → respetado (Task 4 conserva el formato de `escribirGps`). Capa B → explícitamente diferida a su propio plan.
- **Placeholders:** ninguno; todo el código está completo.
- **Consistencia de tipos/nombres:** `gpsWatchId` reemplaza a `gpsInterval` de forma consistente (Tasks 3-4; la Task 3 deja una nota explícita sobre el orden); `GpsEstado.clasificarEstadoGps`/`formatearAntiguedad` se definen en Task 1 y se consumen igual en Task 2; `svgChofer`/`colorMarcadorChofer` definidas y usadas en Task 2.
- **Nota de orden:** la Task 3 referencia `gpsWatchId` (definido en Task 4) en el listener de `visibilitychange`; la nota indica el fallback si se ejecuta antes. Ejecutar en orden 1→2→3→4 evita el problema.
