# Panel "Monitoreo" en la app del chofer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar visibilidad total de las fallas en la app del chofer mediante un tab "Monitoreo" que registra localmente, con hora, todo lo que pasa y lo que falla (entregas, GPS, Firebase, conexión), sin cambiar la experiencia del chofer.

**Architecture:** Un módulo puro nuevo (`monitoreo-log.js`) mantiene un registro circular de eventos en `localStorage` (usable también en Node para test). La app del chofer (`distribucion-app.html`) gana un tab "Monitoreo" que lo muestra, y los puntos donde hoy se tragan los errores se instrumentan para registrar su resultado real. No se cambia la lógica de guardado ni el modelo de datos.

**Tech Stack:** HTML + JavaScript vanilla (ES5, sin bundler), `localStorage`. Test puntual con Node (`assert` integrado), igual patrón que `gps-estado.js` / `tests/gps-estado.test.js`.

## Global Constraints

- **JavaScript ES5** (`var`, `function`), sin `let`/`const`/arrow ni object-shorthand, igual que el resto de `distribucion-app.html`.
- **Solo observabilidad**: NO cambiar la lógica de guardado (`.update`/`.set`), ni reintentos, ni el modelo de datos de Firestore. Solo registrar resultados reales.
- **El registro es 100% local** (`localStorage`, clave `caveli_monitoreo`); no se sube a Firebase (debe funcionar aunque Firebase esté caído).
- **Tope circular: 200 eventos.**
- **Tipos de evento:** `'entrega' | 'gps' | 'firebase' | 'conexion' | 'sesion'`. **Resultados:** `'ok' | 'error' | 'info'`.
- La app del chofer no debe mostrar errores fuera del tab Monitoreo (nada que lo confunda en el flujo normal).

## Estructura de archivos

- `monitoreo-log.js` (crear) — módulo puro del registro; expone `window.Monitoreo` en navegador y `module.exports` en Node.
- `tests/monitoreo-log.test.js` (crear) — test Node de la lógica pura.
- `distribucion-app.html` (modificar) — incluir el script, agregar el tab "Monitoreo" + su render, e instrumentar los puntos que hoy se silencian.
- `scripts/copy-web.js` (modificar) — agregar `monitoreo-log.js` a los archivos que se empaquetan para la app nativa.

## Enfoque de pruebas

`monitoreo-log.js` es la única parte con lógica pura y se prueba con Node (tope circular, orden, formato, última sync). El tab y la instrumentación se verifican manualmente en el navegador (provocar guardados/errores y ver los eventos; confirmar que el registro sobrevive al recargar). El test de `gps-estado.js` no se toca y sirve de guard de regresión.

---

### Task 1: Módulo de registro `monitoreo-log.js` + test

**Files:**
- Create: `monitoreo-log.js`
- Test: `tests/monitoreo-log.test.js`

**Interfaces:**
- Consumes: nada.
- Produces (en navegador `window.Monitoreo`, en Node `require('../monitoreo-log.js')`):
  - `registrar(tipo: string, resultado: string, detalle?: string): void`
  - `obtenerEventos(): Array<{ts,tipo,resultado,detalle}>` — más reciente primero
  - `marcarSyncOk(): void` / `ultimaSyncOk(): string|null`
  - `setPendientes(n: number): void` / `getPendientes(): number`
  - `formatearTexto(): string`
  - `reset(): void` (para tests)
  - `MAX: number` (200)

- [ ] **Step 1: Write the failing test**

Create `tests/monitoreo-log.test.js`:

```javascript
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

// Última sync OK
M.reset();
assert.strictEqual(M.ultimaSyncOk(), null);
M.marcarSyncOk();
assert.ok(typeof M.ultimaSyncOk() === 'string' && M.ultimaSyncOk().length > 0);

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/monitoreo-log.test.js`
Expected: FAIL con `Cannot find module '../monitoreo-log.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `monitoreo-log.js`:

```javascript
// Registro local de eventos/fallas de la app del chofer.
// Usable en navegador (window.Monitoreo) y en Node (require). Sin dependencias.
(function (root) {
  var CLAVE = 'caveli_monitoreo';
  var MAX = 200;
  var eventos = [];      // orden interno: más antiguo primero
  var syncOkTs = null;
  var pendientes = 0;

  function tieneLS() {
    try { return (typeof localStorage !== 'undefined') && !!localStorage; } catch (e) { return false; }
  }

  function persistir() {
    if (!tieneLS()) return;
    try { localStorage.setItem(CLAVE, JSON.stringify({ eventos: eventos, syncOkTs: syncOkTs })); } catch (e) {}
  }

  function rehidratar() {
    if (!tieneLS()) return;
    try {
      var s = JSON.parse(localStorage.getItem(CLAVE) || 'null');
      if (s) { eventos = s.eventos || []; syncOkTs = s.syncOkTs || null; }
    } catch (e) {}
  }

  function registrar(tipo, resultado, detalle) {
    eventos.push({ ts: new Date().toISOString(), tipo: tipo, resultado: resultado, detalle: detalle || '' });
    if (eventos.length > MAX) { eventos = eventos.slice(eventos.length - MAX); }
    persistir();
  }

  function obtenerEventos() {
    return eventos.slice().reverse(); // más reciente primero
  }

  function marcarSyncOk() { syncOkTs = new Date().toISOString(); persistir(); }
  function ultimaSyncOk() { return syncOkTs; }

  function setPendientes(n) { pendientes = n; }
  function getPendientes() { return pendientes; }

  function formatearTexto() {
    return obtenerEventos().map(function (e) {
      var hora = new Date(e.ts).toLocaleString('es-CL');
      var ic = e.resultado === 'ok' ? 'OK' : (e.resultado === 'error' ? 'ERROR' : '-');
      return hora + '  ' + ic + ' [' + e.tipo + '] ' + e.detalle;
    }).join('\n');
  }

  function reset() { eventos = []; syncOkTs = null; pendientes = 0; }

  rehidratar();

  var api = {
    registrar: registrar,
    obtenerEventos: obtenerEventos,
    marcarSyncOk: marcarSyncOk,
    ultimaSyncOk: ultimaSyncOk,
    setPendientes: setPendientes,
    getPendientes: getPendientes,
    formatearTexto: formatearTexto,
    reset: reset,
    MAX: MAX
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  else { root.Monitoreo = api; }
})(typeof self !== 'undefined' ? self : this);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/monitoreo-log.test.js`
Expected: PASS — imprime `OK: todos los asserts pasaron`, sale con código 0.

- [ ] **Step 5: Commit**

```bash
git add monitoreo-log.js tests/monitoreo-log.test.js
git commit -m "feat: modulo de registro Monitoreo (log local) con test"
```

---

### Task 2: Tab "Monitoreo" en la app del chofer

**Files:**
- Modify: `distribucion-app.html` (incluir script, botón de tab, tab-content, `renderMonitoreo`, `compartirMonitoreo`, caso en `switchTab`)
- Modify: `scripts/copy-web.js` (agregar `monitoreo-log.js` a la lista)

**Interfaces:**
- Consumes: `window.Monitoreo` (Task 1), funciones existentes `switchTab`, `showToast`.
- Produces: `renderMonitoreo()`, `compartirMonitoreo()`, tab `monitoreo`.

- [ ] **Step 1: Incluir `monitoreo-log.js` antes del script principal**

En `distribucion-app.html`, justo **antes** de la línea `<script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js"></script>` (≈línea 384), agregar:

```html
<script src="monitoreo-log.js"></script>
```

- [ ] **Step 2: Agregar el botón de tab**

En el bloque de tabs (`distribucion-app.html:171-176`), añadir el botón de Monitoreo después del de Reporte:

```html
  <button class="tab" id="tab-btn-reporte" onclick="switchTab('reporte',this)">&#128202; Reporte</button>
  <button class="tab" id="tab-btn-monitoreo" onclick="switchTab('monitoreo',this)">&#128225; Monitoreo</button>
```

- [ ] **Step 3: Agregar el contenido del tab**

En `distribucion-app.html`, inmediatamente después del cierre del `tab-content` de Reporte (el `</div>` que cierra `<div id="tab-reporte" class="tab-content">`), agregar este bloque:

```html
<div id="tab-monitoreo" class="tab-content">
  <div class="card">
    <h2>&#128225; Monitoreo</h2>
    <p class="ultima-act" id="mon-ultima-sync">Ultima sincronizacion OK: -</p>
    <p class="ultima-act" id="mon-pendientes">Cambios pendientes de subir: 0</p>
    <button onclick="compartirMonitoreo()" style="margin:8px 0;padding:10px 14px;background:#2d5f4f;color:white;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer">&#128203; Copiar / Compartir registro</button>
    <div id="monitoreo-lista" style="margin-top:10px;display:flex;flex-direction:column;gap:4px;font-size:12px"></div>
  </div>
</div>
```

- [ ] **Step 4: Agregar `renderMonitoreo` y `compartirMonitoreo`, y el caso en `switchTab`**

En `distribucion-app.html`, en `switchTab` (≈líneas 888-890), añadir el caso de monitoreo:

```javascript
  if (name === 'entregas') renderClients();
  else if (name === 'reporte') renderReport();
  else if (name === 'ruta') renderRuta();
  else if (name === 'monitoreo') renderMonitoreo();
```

Y agregar estas dos funciones justo después de `switchTab` (después de su llave de cierre, ≈línea 891):

```javascript
function escaparHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderMonitoreo() {
  var ts = Monitoreo.ultimaSyncOk();
  document.getElementById('mon-ultima-sync').textContent =
    'Ultima sincronizacion OK: ' + (ts ? new Date(ts).toLocaleString('es-CL') : 'nunca');
  document.getElementById('mon-pendientes').textContent =
    'Cambios pendientes de subir: ' + Monitoreo.getPendientes();

  var cont = document.getElementById('monitoreo-lista');
  var eventos = Monitoreo.obtenerEventos();
  if (eventos.length === 0) {
    cont.innerHTML = '<div style="color:#999;text-align:center;padding:12px">Sin eventos aun</div>';
    return;
  }
  cont.innerHTML = eventos.map(function (e) {
    var hora  = new Date(e.ts).toLocaleTimeString('es-CL');
    var ic    = e.resultado === 'ok' ? '&#10003;' : (e.resultado === 'error' ? '&#10007;' : '&#8226;');
    var color = e.resultado === 'ok' ? '#27ae60' : (e.resultado === 'error' ? '#d94545' : '#888');
    return '<div style="border-bottom:1px solid #eee;padding:4px 0">' +
      '<span style="color:#999">' + hora + '</span> ' +
      '<span style="color:' + color + ';font-weight:700">' + ic + '</span> ' +
      '<span style="color:#666">[' + escaparHtml(e.tipo) + ']</span> ' +
      escaparHtml(e.detalle) +
      '</div>';
  }).join('');
}

function compartirMonitoreo() {
  var texto = Monitoreo.formatearTexto();
  if (navigator.share) {
    navigator.share({ title: 'Monitoreo Caveli', text: texto }).catch(function () {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(texto)
      .then(function () { showToast('Registro copiado', 'success'); })
      .catch(function () { showToast('No se pudo copiar', 'error'); });
  } else {
    showToast('Compartir no disponible en este dispositivo', 'error');
  }
}
```

- [ ] **Step 5: Empaquetar `monitoreo-log.js` en la app nativa**

En `scripts/copy-web.js`, agregar `'monitoreo-log.js'` al arreglo `archivos` (junto a los otros archivos copiados):

```javascript
var archivos = [
  'index.html',
  'distribucion-app.html',
  'monitoreo-log.js',
  'manifest.json',
  'sw.js',
  'icon-192.svg',
  'icon-512.svg'
];
```

- [ ] **Step 6: Verificación manual + regresión**

1. Abrir `distribucion-app.html` en el navegador. Confirmar que aparece el tab **"Monitoreo"** y que al abrirlo se ve el encabezado y "Sin eventos aun".
2. En la consola: `Monitoreo.registrar('entrega','ok','Prueba'); renderMonitoreo();` → debe aparecer la línea verde con ✓.
3. `Monitoreo.registrar('firebase','error','permission-denied'); renderMonitoreo();` → línea roja con ✗.
4. Recargar la página, abrir Monitoreo → los eventos siguen ahí (persistió en localStorage).
5. Regresión: `node tests/gps-estado.test.js` → `OK: todos los asserts pasaron`.

- [ ] **Step 7: Commit**

```bash
git add distribucion-app.html scripts/copy-web.js
git commit -m "feat: tab Monitoreo en la app del chofer (registro visible)"
```

---

### Task 3: Instrumentar los puntos que hoy se silencian

Reemplazar los `catch` vacíos/engañosos por registros reales, sin cambiar la lógica de guardado.

**Files:**
- Modify: `distribucion-app.html` (`initFirebase`, `syncFirebase`, `escribirGpsCoords`, listeners de conexión, `seleccionarSesion`)

**Interfaces:**
- Consumes: `window.Monitoreo` (Task 1).
- Produces: eventos de tipo `firebase`, `entrega`, `gps`, `conexion`, `sesion` en el registro.

- [ ] **Step 1: Instrumentar `initFirebase`**

En `distribucion-app.html`, en `initFirebase`, tras `db = firebase.firestore();` (≈línea 404) añadir el registro de éxito, y en el `catch(e)` (≈línea 426) el de error:

```javascript
    fbApp = firebase.initializeApp(firebaseConfig);
    db    = firebase.firestore();
    Monitoreo.registrar('firebase', 'ok', 'Firebase inicializado');
```

y en el catch:

```javascript
  } catch(e) {
    Monitoreo.registrar('firebase', 'error', 'Init fallo: ' + (e.message || e));
    console.warn('Firebase no disponible:', e.message);
    document.getElementById('fb-estado').textContent = 'Sin conexion Firebase';
    document.getElementById('fb-estado').style.color = '#d94545';
  }
```

- [ ] **Step 2: Instrumentar `syncFirebase` (el falso "offline")**

Reemplazar el `db.collection('jornadas')...update(...).catch(...)` al final de `syncFirebase` (`distribucion-app.html:549-554`) por una versión con `.then`/`.catch` que registra el resultado real:

```javascript
  db.collection('jornadas').doc(jornadaId).update({
    entregas: deliveries,
    startTime: startTime ? startTime.toISOString() : null,
    ultimaActualizacion: new Date().toISOString(),
    chofer: nombreChofer || 'Chofer'
  }).then(function() {
    Monitoreo.registrar('entrega', 'ok', 'Entregas subidas (' + deliveries.length + ')');
    Monitoreo.marcarSyncOk();
    Monitoreo.setPendientes(0);
  }).catch(function(e) {
    Monitoreo.registrar('firebase', 'error', 'No subio entregas: ' + (e.code || '') + ' ' + (e.message || ''));
    Monitoreo.setPendientes(Monitoreo.getPendientes() + 1);
  });
```

- [ ] **Step 3: Instrumentar `escribirGpsCoords` (escritura de GPS)**

En `distribucion-app.html`, en `escribirGpsCoords` (≈líneas 591-603), añadir `.then`/`.catch` a la escritura de GPS para registrar el resultado real:

```javascript
function escribirGpsCoords(lat, lng, accuracy) {
  if (!db) return;
  try {
    var punto = { lat: lat, lng: lng, ts: new Date().toISOString() };
    db.collection('gps').doc(jornadaId).set({
      lat: punto.lat, lng: punto.lng,
      precision: accuracy,
      timestamp: punto.ts,
      chofer: nombreChofer || 'Chofer',
      rastro: firebase.firestore.FieldValue.arrayUnion(punto)
    }, { merge: true }).then(function() {
      Monitoreo.registrar('gps', 'ok', 'GPS enviado (' + Math.round(accuracy) + 'm)');
      Monitoreo.marcarSyncOk();
    }).catch(function(e) {
      Monitoreo.registrar('gps', 'error', 'GPS no envio: ' + (e.code || '') + ' ' + (e.message || ''));
    });
  } catch (e) {
    Monitoreo.registrar('gps', 'error', 'GPS excepcion: ' + (e.message || e));
  }
}
```

- [ ] **Step 4: Instrumentar los cambios de conexión**

En los listeners `online`/`offline` (`distribucion-app.html:458-465`), añadir el registro:

```javascript
window.addEventListener('online',  function() {
  Monitoreo.registrar('conexion', 'info', 'Internet restaurado');
  setConexion(true);
  if (pendingSyncs > 0) showToast('Conexion restaurada - sincronizando...', 'success');
});
window.addEventListener('offline', function() {
  Monitoreo.registrar('conexion', 'info', 'Sin internet');
  setConexion(false);
  showToast('Sin internet - entregas guardadas en el celular', 'error');
});
```

- [ ] **Step 5: Instrumentar el inicio de sesión**

En `seleccionarSesion` (donde se fija `jornadaId`, ≈línea 693 `jornadaId = jid;`), añadir el registro de sesión:

```javascript
function seleccionarSesion(jid, nombre) {
  jornadaId = jid;
  Monitoreo.registrar('sesion', 'info', 'Sesion iniciada: ' + jid);
  localStorage.setItem('caveli_session', jid);
```

Y en `initFirebase`, cuando se restaura una sesión guardada (≈línea 417, junto a `console.log('Firebase OK, sesion:', jornadaId)`):

```javascript
      jornadaId = sessionGuardada;
      Monitoreo.registrar('sesion', 'info', 'Sesion restaurada: ' + jornadaId);
      console.log('Firebase OK, sesion:', jornadaId);
      escucharClientes();
```

- [ ] **Step 6: Verificación manual + regresión**

1. Abrir `distribucion-app.html` en el navegador con internet. En Monitoreo debe aparecer "Firebase inicializado" (✓) y, al entrar a una sesión, "Sesion ... iniciada/restaurada".
2. Con una sesión y clientes cargados, marcar una entrega → en Monitoreo aparece "Entregas subidas (N)" ✓ y "Ultima sincronizacion OK" se actualiza.
3. Cortar el internet (DevTools → Network → Offline), marcar otra entrega → aparece un evento de error/fallo y "Cambios pendientes" sube; al volver online aparece "Internet restaurado".
4. Regresión: `node tests/gps-estado.test.js` y `node tests/monitoreo-log.test.js` → ambos `OK`.

- [ ] **Step 7: Commit**

```bash
git add distribucion-app.html
git commit -m "feat: registrar en Monitoreo las fallas que antes se silenciaban"
```

---

## Self-Review

- **Cobertura de la spec:** módulo de registro (circular 200, localStorage, API) → Task 1. Tab "Monitoreo" con encabezado de estado, lista de eventos y botón compartir → Task 2. Empaquetado en la app nativa → Task 2 Step 5. Instrumentación de los puntos silenciados (syncFirebase, escribirGpsCoords, initFirebase, conexión, sesión) → Task 3. Registro 100% local, sin cambios en Firestore → respetado (ninguna tarea sube el log ni cambia el modelo). Solo observabilidad, sin tocar la lógica de guardado → respetado.
- **Placeholders:** ninguno; todo el código y los comandos están completos.
- **Consistencia de nombres:** la API de `Monitoreo` definida en Task 1 (`registrar`, `obtenerEventos`, `marcarSyncOk`, `ultimaSyncOk`, `setPendientes`, `getPendientes`, `formatearTexto`, `reset`, `MAX`) se consume igual en Tasks 2-3. `renderMonitoreo`/`compartirMonitoreo`/`escaparHtml` definidas y usadas en Task 2. Tipos de evento y resultados usados en Task 3 coinciden con los de la spec.
- **Fuera de alcance (confirmado):** no se arregla la sincronización (`.update`→`.set(merge)`, reintentos), ni el candado de un-dispositivo-por-chofer, ni el segundo plano, ni el aviso del dashboard — son piezas siguientes.
