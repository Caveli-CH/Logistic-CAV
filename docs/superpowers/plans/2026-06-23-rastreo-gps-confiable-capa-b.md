# Rastreo GPS confiable — Fase 2 (Capa B, contenedor nativo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir la app del chofer (`distribucion-app.html`) en una app Android nativa con Capacitor que comparta la ubicación de forma confiable incluso con la pantalla apagada y la app en segundo plano, usando un plugin de geolocalización en segundo plano (foreground service).

**Architecture:** Capacitor envuelve los mismos HTML que ya se usan como PWA (fuente única de verdad en la raíz del repo, copiados a `www/` por un script). El código del chofer detecta el entorno: en nativo usa `@capacitor-community/background-geolocation` (servicio en primer plano con notificación persistente); en navegador/PWA usa el `watchPosition` que ya existe de la Capa A. La escritura a Firestore (`gps/{jornadaId}`) y el throttle de 15s se comparten entre ambos caminos.

**Tech Stack:** Capacitor 7 (`@capacitor/core`, `@capacitor/cli`, `@capacitor/android` ^7), `@capacitor-community/background-geolocation` ^1.2.26, Node.js (ya instalado, v22), Android SDK + JDK 21 (incluido en Android Studio, ya instalado). HTML/JS ES5 sin bundler.

## Global Constraints

- **Capacitor 7 exactamente** (no 8): el plugin gratuito `@capacitor-community/background-geolocation` ^1.2.26 soporta Capacitor v5/v6/v7, todavía no v8.
- **Plugin gratuito:** `@capacitor-community/background-geolocation` (no el de Transistor de pago).
- **`android.useLegacyBridge: true`** en `capacitor.config.json` — sin esto, la ubicación en segundo plano se detiene a los ~5 minutos.
- **No bundler:** la app es HTML plano con JS inline. El plugin nativo se accede vía `window.Capacitor.Plugins.BackgroundGeolocation`, no por `import`.
- **JavaScript ES5** (`var`, `function`), igual que el resto del archivo.
- **No cambiar el modelo de datos** de Firestore: se sigue escribiendo `gps/{jornadaId}` con `lat`, `lng`, `precision`, `timestamp`, `chofer`, `rastro` (arrayUnion).
- **`appId`:** `com.caveli.chofer`. **`appName`:** `Caveli Chofer`. **`webDir`:** `www`.
- **Solo Android**, solo la app del chofer. El dashboard del jefe sigue siendo web aparte (no se empaqueta).
- **Entorno ya verificado (paso B1, hecho):** Android Studio en `D:\Nueva carpeta`, JDK 21 en `D:\Nueva carpeta\jbr` (`JAVA_HOME` configurado), Android SDK en `C:\Users\Usuario\AppData\Local\Android\Sdk` (`ANDROID_HOME` configurado), licencia del SDK aceptada.

## Estructura de archivos

- `package.json` (crear) — dependencias y scripts npm.
- `scripts/copy-web.js` (crear) — copia los archivos del front del chofer a `www/`.
- `www/` (generado, en `.gitignore`) — assets que Capacitor empaqueta.
- `capacitor.config.json` (crear vía `cap init`, luego editar) — config de Capacitor.
- `android/` (generado por `cap add android`, **sí se commitea**) — proyecto Android nativo; aquí se editan manifest y strings.
- `distribucion-app.html` (modificar) — rama nativa/web del GPS.
- `.gitignore` (crear/editar) — ignora `node_modules/`, `www/`, keystore.

## Enfoque de pruebas

Esta fase es trabajo de integración y build: no hay un framework de tests unitarios para código nativo. La verificación es (1) builds de Gradle exitosos con salida concreta, y (2) comportamiento observado en un teléfono Android real. El único test automatizado del repo (`node tests/gps-estado.test.js`) no se toca y sirve de guard de regresión. La rama web del GPS se verifica abriendo la app en un navegador.

---

### Task 1: Andamiaje del proyecto Capacitor

Crea el proyecto Capacitor sobre los HTML existentes, con un script que ensambla `www/` desde la raíz (mantiene la fuente única de verdad).

**Files:**
- Create: `package.json`
- Create: `scripts/copy-web.js`
- Create: `.gitignore` (o modificar si existe)
- Create: `capacitor.config.json` (lo genera `cap init`)
- Generated: `www/` (no se commitea)

**Interfaces:**
- Consumes: nada.
- Produces: comando `npm run sync` (= copia web + `cap sync`); `capacitor.config.json` con `appId=com.caveli.chofer`, `webDir=www`.

- [ ] **Step 1: Crear `package.json`**

Crear `package.json` en la raíz:

```json
{
  "name": "caveli-chofer",
  "version": "1.0.0",
  "private": true,
  "description": "App nativa del chofer - Distribuidora Caveli",
  "scripts": {
    "test": "node tests/gps-estado.test.js",
    "copy-web": "node scripts/copy-web.js",
    "sync": "npm run copy-web && npx cap sync"
  }
}
```

- [ ] **Step 2: Instalar Capacitor 7 y el plugin**

Run:
```bash
npm install @capacitor/core@^7 @capacitor/cli@^7 @capacitor/android@^7 @capacitor-community/background-geolocation@^1.2.26
```
Expected: instala sin errores de peer-dependency; aparece `node_modules/` y `package-lock.json`. Verifica versión mayor 7:
```bash
npx cap --version
```
Expected: imprime una versión `7.x.x`.

- [ ] **Step 3: Crear el script de copia `scripts/copy-web.js`**

Crear `scripts/copy-web.js`:

```javascript
// Ensambla www/ con los archivos que necesita la app del chofer.
// La fuente de verdad sigue siendo la raiz del repo (tambien usada por el PWA).
var fs = require('fs');
var path = require('path');

var root = path.join(__dirname, '..');
var out = path.join(root, 'www');

var archivos = [
  'index.html',
  'distribucion-app.html',
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
```

- [ ] **Step 4: Ejecutar la copia y verificar `www/`**

Run: `npm run copy-web`
Expected: imprime `www/ ensamblado con 6 archivos`. Verifica:
```bash
ls www
```
Expected: `distribucion-app.html  icon-192.svg  icon-512.svg  index.html  manifest.json  sw.js`

- [ ] **Step 5: Inicializar Capacitor**

Run:
```bash
npx cap init "Caveli Chofer" com.caveli.chofer --web-dir www
```
Expected: crea `capacitor.config.json` con esos valores. Verifica:
```bash
cat capacitor.config.json
```
Expected: contiene `"appId": "com.caveli.chofer"`, `"appName": "Caveli Chofer"`, `"webDir": "www"`.

- [ ] **Step 6: Crear/editar `.gitignore`**

Asegurar que `.gitignore` en la raíz contiene estas líneas (añadir las que falten, sin borrar las existentes):

```
node_modules/
www/
*.keystore
keystore.properties
```

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json scripts/copy-web.js capacitor.config.json .gitignore
git commit -m "feat(cap): andamiaje de proyecto Capacitor 7 para la app del chofer"
```

---

### Task 2: Plataforma Android + plugin de GPS en segundo plano + configuración

Agrega la plataforma Android, configura el plugin y los permisos, y verifica que el proyecto compila (sin tocar aún la lógica de GPS).

**Files:**
- Modify: `capacitor.config.json`
- Generated/committed: `android/`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Modify: `android/app/src/main/res/values/strings.xml`

**Interfaces:**
- Consumes: `capacitor.config.json`, `www/` (Task 1).
- Produces: APK debug compilable; plugin `BackgroundGeolocation` disponible en runtime nativo.

- [ ] **Step 1: Activar `useLegacyBridge` en `capacitor.config.json`**

Editar `capacitor.config.json` para que el objeto raíz incluya la sección `android` (junto a `appId`/`appName`/`webDir` ya existentes):

```json
{
  "appId": "com.caveli.chofer",
  "appName": "Caveli Chofer",
  "webDir": "www",
  "android": {
    "useLegacyBridge": true
  }
}
```

- [ ] **Step 2: Añadir la plataforma Android**

Run:
```bash
npm run copy-web && npx cap add android
```
Expected: crea la carpeta `android/`; al final dice `[success] android platform added!` o equivalente, y sincroniza el plugin `BackgroundGeolocation`.

- [ ] **Step 3: Añadir permisos al AndroidManifest**

En `android/app/src/main/AndroidManifest.xml`, dentro del elemento `<manifest>` y antes de `<application>`, añadir estas tres líneas (si alguna ya existe por el plugin, no duplicar):

```xml
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

- [ ] **Step 4: Personalizar el nombre del canal de notificación**

En `android/app/src/main/res/values/strings.xml`, añadir dentro de `<resources>`:

```xml
    <string name="capacitor_background_geolocation_notification_channel_name">Ubicacion de la ruta</string>
```

- [ ] **Step 5: Asegurar la plataforma SDK que pide Capacitor**

Comprobar qué `compileSdkVersion` usa el proyecto:
```bash
cat android/variables.gradle
```
Anota el valor de `compileSdkVersion` (Capacitor 7 usa típicamente `35`). Si la plataforma correspondiente NO está instalada (ver `ls "$ANDROID_HOME/platforms"`, que hoy solo muestra `android-36.1`), instálala desde Android Studio → **SDK Manager → SDK Platforms**: marca **Android API <ese número>** (ej. Android 15 / API 35) y aplica. Marca también, en **SDK Tools**, **Android SDK Command-line Tools (latest)** si aún no está.

Verifica:
```bash
ls "$ANDROID_HOME/platforms"
```
Expected: aparece `android-<compileSdkVersion>` (ej. `android-35`).

- [ ] **Step 6: Compilar el APK debug**

Run (desde la raíz del repo, sin `cd`):
```bash
./android/gradlew -p android assembleDebug
```
Expected: termina con `BUILD SUCCESSFUL`. El APK queda en `android/app/build/outputs/apk/debug/app-debug.apk`. Verifica:
```bash
ls android/app/build/outputs/apk/debug/app-debug.apk
```
Expected: el archivo existe.

> Si falla por plataforma SDK faltante, completa el Step 5 e intenta de nuevo. Si falla por licencias, instala las Command-line Tools (Step 5) y ejecuta `"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager.bat" --licenses` aceptando todo.

- [ ] **Step 7: Commit**

```bash
git add capacitor.config.json android .gitignore
git commit -m "feat(cap): plataforma Android + background-geolocation (permisos, useLegacyBridge, notificacion)"
```

---

### Task 3: Rama nativa/web del GPS en la app del chofer

Hace que `startGPS`/`stopGPS` usen el plugin nativo cuando corre dentro de la app Android, y conserven `watchPosition` en navegador. La escritura a Firestore y el throttle se comparten.

**Files:**
- Modify: `distribucion-app.html` (bloque GPS, líneas ~556-654)

**Interfaces:**
- Consumes: `window.Capacitor.Plugins.BackgroundGeolocation` (nativo), funciones existentes `setGpsStatus`, `showToast`, `db`, `jornadaId`, `nombreChofer`.
- Produces: `esNativo()`, `bgGeo()`, `escribirGpsCoords(lat,lng,accuracy)`, `onNativePos(location)`, `startGPSNativo()`, `stopGPSNativo()`, `startGPSWeb()`, `stopGPSWeb()`; `startGPS()`/`stopGPS()` pasan a ser despachadores. Nueva var `gpsNativeId`.

- [ ] **Step 1: Reemplazar el bloque GPS**

En `distribucion-app.html`, reemplazar **todo** el bloque desde la línea `var gpsWatchId   = null;` (≈línea 558) hasta el final de la función `stopGPS()` (la llave de cierre en ≈línea 654) por el siguiente bloque. (Las funciones `pedirWakeLock`/`liberarWakeLock`/`setGpsStatus` se conservan idénticas; aquí van incluidas para que el reemplazo sea contiguo.)

```javascript
var gpsWatchId   = null;   // id de watchPosition (web)
var gpsNativeId  = null;   // id del watcher nativo (background-geolocation)
var gpsLastWrite = 0;
var gpsErrores   = 0;
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

function setGpsStatus(estado, texto, precision) {
  var bar = document.getElementById('gps-status-bar');
  var txt = document.getElementById('gps-status-txt');
  var pre = document.getElementById('gps-precision-txt');
  if (!bar) return;
  bar.style.display = 'flex';
  bar.className = 'gps-status-bar ' + estado;
  txt.textContent = texto;
  pre.textContent = precision || '';
}

// ¿Corremos dentro de la app nativa (Capacitor) o en el navegador/PWA?
function esNativo() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

function bgGeo() {
  return (window.Capacitor && window.Capacitor.Plugins) ? window.Capacitor.Plugins.BackgroundGeolocation : null;
}

// Escritura a Firestore comun a web y nativo (no cambia el modelo de datos).
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
    }, { merge: true });
  } catch (e) {}
}

function escribirGps(pos) {
  escribirGpsCoords(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
}

// ---- Camino WEB (navegador / PWA): watchPosition ----
function onGpsPos(pos) {
  gpsErrores = 0;
  var precM = Math.round(pos.coords.accuracy);
  setGpsStatus('gps-activo', 'GPS activo — enviando al jefe', 'Precision: ' + precM + 'm');
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

function startGPSWeb() {
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

function stopGPSWeb() {
  if (gpsWatchId !== null) { navigator.geolocation.clearWatch(gpsWatchId); gpsWatchId = null; }
  liberarWakeLock();
  setGpsStatus('gps-inactivo', 'GPS detenido', '');
  var bar = document.getElementById('gps-status-bar'); if (bar) bar.style.display = 'none';
}

// ---- Camino NATIVO (app Android): background-geolocation ----
function onNativePos(location) {
  gpsErrores = 0;
  var precM = Math.round(location.accuracy);
  setGpsStatus('gps-activo', 'GPS activo (segundo plano) — enviando al jefe', 'Precision: ' + precM + 'm');
  var ahora = Date.now();
  if (ahora - gpsLastWrite < 15000) return;
  gpsLastWrite = ahora;
  escribirGpsCoords(location.latitude, location.longitude, location.accuracy);
}

function startGPSNativo() {
  var BG = bgGeo();
  if (!BG) { startGPSWeb(); return; } // fallback defensivo
  if (gpsNativeId !== null) return;
  setGpsStatus('gps-inactivo', 'Activando GPS en segundo plano...', '');
  gpsLastWrite = 0;
  BG.addWatcher({
    backgroundMessage: 'Compartiendo tu ubicacion con la base',
    backgroundTitle: 'Caveli — ruta activa',
    requestPermissions: true,
    stale: false,
    distanceFilter: 20
  }, function (location, error) {
    if (error) {
      if (error.code === 'NOT_AUTHORIZED') {
        setGpsStatus('gps-error', 'Permiso de ubicacion denegado', 'Permite "Permitir siempre" en ajustes');
        if (window.confirm('La app necesita tu ubicacion para compartirla con la base. ¿Abrir ajustes ahora?')) {
          BG.openSettings();
        }
      } else {
        setGpsStatus('gps-error', 'Error de GPS', (error.message || error.code || ''));
      }
      return;
    }
    onNativePos(location);
  }).then(function (id) { gpsNativeId = id; });
}

function stopGPSNativo() {
  var BG = bgGeo();
  if (BG && gpsNativeId !== null) { BG.removeWatcher({ id: gpsNativeId }); gpsNativeId = null; }
  setGpsStatus('gps-inactivo', 'GPS detenido', '');
  var bar = document.getElementById('gps-status-bar'); if (bar) bar.style.display = 'none';
}

// ---- Despachadores: deciden nativo vs web ----
function startGPS() { if (esNativo()) startGPSNativo(); else startGPSWeb(); }
function stopGPS()  { if (esNativo()) stopGPSNativo(); else stopGPSWeb(); }
```

- [ ] **Step 2: Ajustar el guard de reanudación al iniciar**

En `distribucion-app.html` (≈línea 1549) la línea de reanudación usa `gpsWatchId`. Cambiarla para que también contemple el caso nativo:

```javascript
if(startTime && gpsWatchId===null && gpsNativeId===null) startGPS();
```

- [ ] **Step 3: Verificar regresión web en navegador**

Run: `npm run copy-web` (para reflejar el cambio en `www/`), luego abrir `distribucion-app.html` en un navegador de escritorio.
Verificación estática + manual: en la consola del navegador, `esNativo()` debe devolver `false` (no hay `window.Capacitor`). Iniciar una ruta de prueba y confirmar que la barra de GPS pide permiso y, al concederlo, muestra "GPS activo — enviando al jefe" (camino web intacto).
Confirmar también que el test de regresión sigue verde:
```bash
node tests/gps-estado.test.js
```
Expected: `OK: todos los asserts pasaron`.

- [ ] **Step 4: Sincronizar a Android**

Run: `npm run sync`
Expected: copia `www/` y `npx cap sync` termina sin errores (`[success]`).

- [ ] **Step 5: Commit**

```bash
git add distribucion-app.html
git commit -m "feat(cap): rama nativa de GPS en segundo plano con fallback web"
```

---

### Task 4: Compilar, instalar en teléfono y verificar rastreo en segundo plano

Entrega el APK funcionando en un Android real y confirma el objetivo central: la ubicación se sigue enviando con la pantalla apagada.

**Files:**
- (Sin cambios de código salvo correcciones que surjan de la prueba.)

**Interfaces:**
- Consumes: APK de Task 2/3.
- Produces: APK debug verificado en dispositivo.

- [ ] **Step 1: Recompilar el APK debug con el código nuevo**

Run:
```bash
npm run sync && ./android/gradlew -p android assembleDebug
```
Expected: `BUILD SUCCESSFUL`; APK en `android/app/build/outputs/apk/debug/app-debug.apk`.

- [ ] **Step 2: Conectar el teléfono y verificar adb**

Con el teléfono conectado por USB y **Depuración USB** activada:
```bash
"$ANDROID_HOME/platform-tools/adb.exe" devices
```
Expected: lista el dispositivo con estado `device` (si dice `unauthorized`, acepta el diálogo en el teléfono).

- [ ] **Step 3: Instalar el APK**

Run:
```bash
"$ANDROID_HOME/platform-tools/adb.exe" install -r android/app/build/outputs/apk/debug/app-debug.apk
```
Expected: `Success`.

- [ ] **Step 4: Probar en el dispositivo**

1. Abrir la app "Caveli Chofer", seleccionar una ruta e iniciar.
2. Cuando pida permisos: conceder **Ubicación → Permitir siempre** y **Notificaciones → Permitir**.
3. Confirmar que aparece la **notificación persistente** "Caveli — ruta activa".
4. En el dashboard del jefe, confirmar que el marcador del chofer aparece y se actualiza (verde).
5. **Bloquear la pantalla del teléfono y/o cambiar a otra app durante 5-10 minutos.**
6. Confirmar en el dashboard que el marcador **sigue actualizándose** (no se queda pegado ni pasa a rojo) durante ese tiempo.

Expected: la ubicación se sigue enviando con la pantalla apagada y la app en segundo plano. Si se detiene, revisar (en orden): permiso "Permitir siempre" concedido; `android.useLegacyBridge: true` presente; optimización de batería del fabricante desactivada para la app.

- [ ] **Step 5: Commit (si hubo correcciones)**

Si el paso 4 requirió ajustes de código o config, commitearlos:
```bash
git add -A
git commit -m "fix(cap): ajustes tras prueba de rastreo en segundo plano en dispositivo"
```
Si no hubo cambios, no hay nada que commitear.

---

### Task 5: APK de release firmado (distribución)

Produce un APK firmado de release, apto para instalar en los teléfonos de los choferes de forma permanente.

**Files:**
- Create: `android/keystore.properties` (gitignored)
- Create: `caveli-release.keystore` (gitignored)
- Modify: `android/app/build.gradle`

**Interfaces:**
- Consumes: proyecto Android de Tasks 2-4.
- Produces: `android/app/build/outputs/apk/release/app-release.apk` firmado.

- [ ] **Step 1: Generar el keystore de firma**

Run (desde la raíz; `keytool` viene con el JDK):
```bash
"$JAVA_HOME/bin/keytool" -genkeypair -v -keystore caveli-release.keystore -alias caveli -keyalg RSA -keysize 2048 -validity 10000
```
Sigue el prompt (define una contraseña y datos básicos). Expected: crea `caveli-release.keystore` en la raíz. **Guarda la contraseña en un lugar seguro: sin ella no se pueden publicar actualizaciones.**

- [ ] **Step 2: Crear `android/keystore.properties`**

Crear `android/keystore.properties` (este archivo está en `.gitignore`; reemplaza las contraseñas por las reales):

```properties
storeFile=../../caveli-release.keystore
storePassword=TU_CONTRASEÑA
keyAlias=caveli
keyPassword=TU_CONTRASEÑA
```

- [ ] **Step 3: Configurar la firma en `android/app/build.gradle`**

En `android/app/build.gradle`, **arriba del bloque `android {`**, añadir la carga de propiedades:

```gradle
def keystorePropertiesFile = rootProject.file("keystore.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}
```

Dentro del bloque `android { ... }`, añadir `signingConfigs` y referenciarlo en `buildTypes.release`:

```gradle
    signingConfigs {
        release {
            if (keystorePropertiesFile.exists()) {
                storeFile file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
            }
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled false
        }
    }
```

> Nota: si `buildTypes { release { ... } }` ya existe en el archivo generado, añade solo la línea `signingConfig signingConfigs.release` dentro de ese bloque en vez de duplicarlo.

- [ ] **Step 4: Compilar el APK de release**

Run:
```bash
npm run sync && ./android/gradlew -p android assembleRelease
```
Expected: `BUILD SUCCESSFUL`; APK firmado en `android/app/build/outputs/apk/release/app-release.apk`. Verifica:
```bash
ls android/app/build/outputs/apk/release/app-release.apk
```
Expected: el archivo existe.

- [ ] **Step 5: Instalar el release en un teléfono (sanity)**

Run:
```bash
"$ANDROID_HOME/platform-tools/adb.exe" install -r android/app/build/outputs/apk/release/app-release.apk
```
Expected: `Success`. Abrir la app y confirmar que inicia ruta y comparte ubicación como en Task 4.

- [ ] **Step 6: Commit**

```bash
git add android/app/build.gradle .gitignore
git commit -m "feat(cap): firma de release para distribuir el APK del chofer"
```
> No se commitean `caveli-release.keystore` ni `android/keystore.properties` (están en `.gitignore`).

---

## Self-Review

- **Cobertura de la spec (Capa B):** B1 prerequisito de entorno → ya hecho, documentado en Global Constraints. B2 envoltorio Capacitor → Task 1. B3 plugin de GPS en segundo plano (foreground service, notificación, permisos) → Task 2 + Task 3 (uso del plugin). B4 detección de entorno (`isNativePlatform`, plugin vs `watchPosition`) → Task 3. B5 distribución por APK → Task 4 (debug/prueba) + Task 5 (release firmado). Modelo de datos sin cambios → `escribirGpsCoords` conserva los 6 campos. Capacitor 7 / plugin gratuito / `useLegacyBridge` → Global Constraints + Tasks 1-2.
- **Placeholders:** ninguno; todo el código y los comandos están completos. Las contraseñas del keystore son datos del usuario (no código), señalados explícitamente.
- **Consistencia de nombres:** `gpsNativeId` se declara en Task 3 y se usa en el guard del Step 2 de Task 3; `escribirGpsCoords(lat,lng,accuracy)` se define y se consume (por `escribirGps` y `onNativePos`) dentro de Task 3; `esNativo`/`bgGeo`/`startGPSNativo`/`stopGPSNativo` definidos y usados por los despachadores `startGPS`/`stopGPS`. `appId=com.caveli.chofer`, `webDir=www` consistentes entre Tasks 1-2. `useLegacyBridge` en Task 2 coincide con la constraint global. La lista de 6 archivos de `copy-web.js` (Task 1) coincide con los assets reales verificados del repo.
- **Riesgo conocido documentado:** el `compileSdkVersion` exacto de Capacitor 7 se lee del proyecto generado (Task 2 Step 5) en vez de asumirlo, con remediación concreta (instalar la plataforma SDK correspondiente).
