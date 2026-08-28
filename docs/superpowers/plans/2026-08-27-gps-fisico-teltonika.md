# GPS Físico Teltonika FMC920 (Traccar + puente a Firestore) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el GPS del teléfono del chofer por el tracker físico Teltonika FMC920 instalado en el vehículo, sin romper `dashboard.html` ni el modelo de datos `gps/{jornadaId}` que ya funciona, y sin generar ningún costo recurrente.

**Architecture:** El FMC920 habla el protocolo propietario Codec8/8E por TCP. Traccar (open source) corre en una VM gratuita de Oracle Cloud y decodifica ese protocolo. Un script Node.js ("puente-gps"), corriendo en esa misma VM como proceso `systemd`, consulta la API REST de Traccar cada 15s y escribe a Firestore usando el Admin SDK — sin pasar por Cloud Functions (evita forzar el plan Blaze de Firebase). El puente escribe en dos lugares: `vehiculos/{imei}` (siempre, incondicional, para monitoreo del camión) y `gps/{jornadaId}` (solo si hay un turno publicado hoy con ese vehículo asignado, mismo formato que ya escribe `escribirGpsCoords()` en `distribucion-app.html`, así `dashboard.html` no necesita cambios para leer el mapa).

**Tech Stack:** Traccar (Java, self-contained installer), Node.js 20.x + `firebase-admin` (sin frameworks de test, siguiendo la convención existente de `assert` + scripts planos), Oracle Cloud Always Free (Ubuntu 22.04).

**Spec:** No existe un documento de spec separado — los requisitos y decisiones fueron capturados directamente en la conversación que originó este plan. Ver sección "Contexto y decisiones ya tomadas" más abajo, que hace las veces de spec.

## Contexto y decisiones ya tomadas (resumen, no reabrir)

- Sin backend propio hoy: 100% frontend + Firestore SDK cliente (modo compat v9.23.0), sin `functions/`, sin `firebase.json`.
- Tracking actual: `distribucion-app.html` usa `navigator.geolocation.watchPosition()` (web) o `@capacitor-community/background-geolocation` (nativo), throttle de escritura cada 15s, escribe en `gps/{jornadaId}` (`lat,lng,precision,timestamp,chofer,rastro[]`) vía `escribirGpsCoords()` (`distribucion-app.html:637-660`).
- `jornadaId` = `{fecha YYYY-MM-DD}-{slugChofer}`, generado en `dashboard.html:311-321` (`slugChofer`, `jornadaDeChofer`) y publicado a diario en `jornadas/registro-{fecha}` vía `publicarRegistro()` (`dashboard.html:328-338`).
- `dashboard.html` lee con `onSnapshot` sobre `gps/{jornadaId}` (`dashboard.html:840-861`), pinta con Google Maps JS API, y clasifica frescura de señal con `gps-estado.js`.
- No existe entidad "vehículo" ni campo IMEI en la base hoy.
- Dispositivo: Teltonika FMC920, aún no instalado. Servidor: Traccar en VM gratuita Oracle Cloud (temporal, luego migra a hardware propio — mismo software, solo cambia dónde vive la VM). Se descartó SaaS de terceros. Restricción dura: cero costo recurrente (nada de Cloud Functions con salida a internet, que exigen plan Blaze).
- Asignación diaria vehículo↔chofer: el chofer casi siempre es Francisco Muñoz — el selector de vehículo en `dashboard.html` debe cubrir las excepciones (~10/año), con "Francisco Muñoz" preseleccionado por defecto.
- El GPS del teléfono y el físico NO deben coexistir: si el chofer tiene `vehiculoImei` asignado hoy, la app deja de enviar GPS del teléfono esa jornada.
- El vehículo debe poder monitorearse siempre (tenga o no turno publicado) → doble escritura: `vehiculos/{imei}` siempre, `gps/{jornadaId}` solo con turno activo.
- Fase 1 captura TODOS los sensores de fábrica del FMC920 disponibles vía Traccar (choque, remolque, manejo brusco, ignición, pánico/entrada digital, salida digital de inmovilización — solo documentar que existe, sabotaje/batería de respaldo, exceso de velocidad, ralentí, geocercas) — solo captura y guardado, **sin dashboard ni análisis** en esta fase.
- Combustible: sin sensor instalado todavía (queda pendiente el adaptador OBDII Bluetooth, recomendado sobre el sensor analógico, como tarea futura separada). El esquema reserva el campo `combustible: null` desde ya para no migrar después.

## Decisiones técnicas que tomé yo en este plan (revísalas)

1. **Nombres exactos de los atributos que expone Traccar** (`ignition`, `motion`, `power`, `battery`, `batteryLevel`, `odometer`, `alarm`, IDs de AVL de Teltonika como 239/240/246/247/etc.) los obtuve leyendo el decoder de Traccar en GitHub y el wiki de Teltonika para el FMC920, pero **dos fuentes no coincidieron exactamente en algunos números de AVL ID** (ej. jamming). Por eso el script **no depende de acertar cada nombre de antemano**: `mapPosition.js` promueve a campos con nombre los que tengo alta confianza (`ignition, motion, power, battery, batteryLevel, odometer, alarm`, usados igual en casi todos los protocolos de Traccar, no solo Teltonika) y **copia el resto del objeto `attributes` tal cual** a un campo `sensores` — así ningún dato de fábrica se pierde aunque un nombre puntual no sea el que esperaba. Task 13 incluye un paso explícito para verificar los nombres reales contra el dispositivo ya conectado.
2. **Botón de pánico vs. ignición (1 sola entrada digital física):** configura el "Ignition Source" del FMC920 en el Configurator como **Power Voltage** (detecta ignición por umbral de voltaje del vehículo, sin usar el DIN físico) en vez de **Digital Input**. Esto libera la única entrada digital disponible para el **botón de pánico/SOS**, que no tiene forma alternativa de detectarse. Confirmé que el FMC920 soporta "Ignition Source = Power Voltage" en su Configurator. Esto es un ajuste que se hace en el dispositivo durante la instalación (Task 5), no en código.
3. **`vehiculos/{imei}/posicionActual`**: lo implementé como un **campo `posicionActual` dentro del documento `vehiculos/{imei}`** (no una subcolección), para evitar una lectura/escritura extra por ciclo. Si preferís una subcolección real, es un cambio de una línea en `firestoreWriter.js` (Task 12).
4. **`rastro` de `gps/{jornadaId}` no lleva los sensores**, solo `{lat,lng,ts}` como hoy. Meter todos los sensores en cada punto del array `rastro` (que crece todo el día con `arrayUnion`) arriesga acercarse al límite de 1MB por documento de Firestore. Los sensores van como campos de nivel superior en `gps/{jornadaId}` (se sobrescriben cada ciclo, no se acumulan) y completos en `vehiculos/{imei}.posicionActual`.
5. **El script consulta `/api/positions` sin rango de tiempo** (última posición conocida por dispositivo), no un rango histórico. Esto significa que si dos eventos de alarma (ej. choque y frenada brusca) ocurren dentro de la misma ventana de 15s, solo se guarda el más reciente. Dado que esta fase es "solo capturar, no analizar", lo dejo así por simplicidad — si más adelante querés garantizar que ningún evento de choque/pánico se pierda nunca, hay que cambiar a consultas con rango `from/to`, es un cambio acotado a `traccarClient.js` e `index.js`.
6. **Node en la VM:** el script usa `fetch` nativo (Node 18+), sin agregar cliente HTTP como dependencia. Único paquete npm nuevo: `firebase-admin`.

## Global Constraints

- No agregar Cloud Functions ni ningún servicio con salida a internet gestionado por Firebase (fuerza plan Blaze). Todo el puente corre en la VM de Traccar.
- No modificar el esquema de `rastro` en `gps/{jornadaId}` (sigue siendo `{lat,lng,ts}`).
- `dashboard.html` no debe requerir cambios para seguir mostrando el mapa — solo se le agrega la UI de asignación de vehículo (nueva funcionalidad, no toca lo existente).
- Mantener el throttle de 15s ya usado en todo el sistema (`distribucion-app.html:672,722`, `dashboard.html:863`) para el ciclo del script puente.
- Sin frameworks de test nuevos: seguir el patrón de `tests/gps-estado.test.js` (`assert` de Node, sin runner externo).
- El JSON de credenciales de la cuenta de servicio de Firebase nunca se commitea al repo (va en `.gitignore`, vive solo en el filesystem de la VM).

---

## File Structure

- Modify: `distribucion-app.html` — agrega `cargarVehiculoAsignado()` y gatea `startGPS()`.
- Modify: `dashboard.html` — catálogo de vehículos + selector por chofer, `publicarRegistro()` incluye `vehiculoImei`.
- Modify: `scripts/copy-web.js` — agrega `jornada-id.js` a la lista de archivos empaquetados.
- Modify: `package.json` (raíz) — agrega el test de `jornada-id.js` al script `test`.
- Create: `jornada-id.js` — parseo puro de `jornadaId` → `{fecha, slug}` (mismo patrón UMD que `gps-estado.js`).
- Create: `tests/jornada-id.test.js`
- Create: `puente-gps/package.json`, `puente-gps/.gitignore`, `puente-gps/.env.example`
- Create: `puente-gps/src/traccarClient.js`, `puente-gps/src/asignaciones.js`, `puente-gps/src/mapPosition.js`, `puente-gps/src/firestoreWriter.js`, `puente-gps/src/index.js`
- Create: `puente-gps/test/traccarClient.test.js`, `puente-gps/test/asignaciones.test.js`, `puente-gps/test/mapPosition.test.js`, `puente-gps/test/firestoreWriter.test.js`

---

# PARTE A — Servidor (Oracle Cloud + Traccar)

### Task 1: Crear la VM gratuita en Oracle Cloud

**Files:** ninguno (trabajo en la consola web de Oracle Cloud).

- [ ] **Paso 1:** Entra a [cloud.oracle.com](https://cloud.oracle.com) y crea una cuenta "Always Free" si no tienes una (pide tarjeta para verificar identidad, pero los recursos "Always Free" no cobran mientras no excedas los límites gratuitos).
- [ ] **Paso 2:** Menú ☰ → Compute → Instances → **Create Instance**.
- [ ] **Paso 3:** Nombre: `caveli-traccar`. En "Image and shape": elige imagen **Canonical Ubuntu 22.04**, y shape **VM.Standard.E2.1.Micro** (marcada "Always Free Eligible" — 1/8 OCPU, 1GB RAM, arquitectura x86_64, alcanza sobradamente para Traccar con pocos dispositivos).
- [ ] **Paso 4:** En "Add SSH keys" deja que Oracle genere el par de claves y **descarga la clave privada** (`.key`) — es tu única forma de entrar por SSH, guárdala bien.
- [ ] **Paso 5:** Deja el resto por defecto y crea la instancia. Anota la **IP pública** que Oracle le asigna (es fija mientras no borres la instancia).
- [ ] **Paso 6 (verificación):** Conéctate por SSH:
```bash
ssh -i ruta/a/tu-clave.key ubuntu@IP_PUBLICA
```
Si entras a una terminal de Ubuntu, la VM está lista.

**Nota de costos:** "Always Free" es gratis indefinidamente mientras uses shapes/tamaños elegibles y no agregues recursos pagos. Un detalle a vigilar: Oracle puede **reclamar (apagar/borrar)** instancias Always Free que detecta "ociosas" por 7 días seguidos (CPU/red/memoria muy bajas). Un servidor Traccar recibiendo conexión TCP constante del GPS normalmente no cae en esa categoría, pero vale la pena revisarlo cada tanto en el panel de Oracle los primeros meses.

---

### Task 2: Abrir los puertos en las reglas de red de Oracle Cloud

**Files:** ninguno (consola web de Oracle Cloud).

Oracle bloquea todo el tráfico entrante por defecto salvo lo que habilites explícitamente — hay que abrir el puerto **5027** (TCP, para que el FMC920 se conecte a Traccar) y el **8082** (TCP, panel web de Traccar).

- [ ] **Paso 1:** Menú ☰ → Networking → Virtual Cloud Networks → entra a la VCN de tu instancia → **Security Lists** → la lista por defecto (`Default Security List for ...`).
- [ ] **Paso 2:** **Add Ingress Rules** → agrega una regla: Source CIDR `0.0.0.0/0`, IP Protocol `TCP`, Destination Port Range `5027`. Descripción: "Teltonika GPS".
- [ ] **Paso 3:** Agrega otra regla igual pero Destination Port Range `8082` (panel Traccar). Si te preocupa exponer el panel a cualquiera, puedes restringir el Source CIDR de esta regla a tu propia IP (buscá "cual es mi ip" en el navegador) en vez de `0.0.0.0/0` — el puerto 5027 sí debe quedar abierto a todo el mundo porque no sabés desde qué IP se conectará el GPS.
- [ ] **Paso 4 (verificación):** Guarda los cambios; no hay forma de probarlo hasta que Traccar esté corriendo (Task 4).

---

### Task 3: Abrir los puertos en el firewall del sistema operativo (ufw)

**Files:** ninguno (por SSH en la VM).

Ubuntu trae `ufw` (firewall del sistema operativo), independiente de las reglas de red de Oracle — hay que abrir el puerto en ambos lados.

- [ ] **Paso 1:** Por SSH en la VM:
```bash
sudo ufw allow 22/tcp comment 'SSH'
sudo ufw allow 5027/tcp comment 'Teltonika GPS'
sudo ufw allow 8082/tcp comment 'Traccar web'
sudo ufw enable
```
(Si te pregunta "Command may disrupt existing ssh connections", responde `y` — ya agregaste la regla de SSH antes de habilitarlo).
- [ ] **Paso 2 (verificación):**
```bash
sudo ufw status
```
Expected: lista con `22/tcp`, `5027/tcp`, `8082/tcp` en estado `ALLOW`.

---

### Task 4: Instalar Traccar

**Files:** ninguno (por SSH en la VM).

Traccar se distribuye como paquete autocontenido (incluye su propio Java, base de datos H2 embebida — no hay que instalar MySQL/Postgres para esta escala).

- [ ] **Paso 1:** Descarga e instala:
```bash
cd /tmp
wget https://github.com/traccar/traccar/releases/latest/download/traccar-linux-64-6.6.zip
sudo apt-get update && sudo apt-get install -y unzip
unzip traccar-linux-64-6.6.zip -d traccar-install
cd traccar-install
sudo ./install.sh
```
(Si el número de versión `6.6` ya no es el último en el momento de instalar, revisa en https://github.com/traccar/traccar/releases y ajusta el nombre del archivo).
- [ ] **Paso 2:** El instalador crea un servicio `systemd` llamado `traccar` y lo arranca solo. Verifica:
```bash
sudo systemctl status traccar
```
Expected: `active (running)`.
- [ ] **Paso 3 (verificación):** Desde tu propia computadora, abre `http://IP_PUBLICA:8082` en el navegador — debe cargar la pantalla de login de Traccar. Usuario/clave por defecto: `admin` / `admin` — **cámbiala de inmediato** desde el panel (ícono de usuario → Settings).
- [ ] **Paso 4 (verificación del puerto Teltonika):** Confirma que el puerto 5027 está escuchando:
```bash
sudo ss -tlnp | grep 5027
```
Expected: una línea mostrando el proceso Java escuchando en `0.0.0.0:5027`. Este puerto ya viene preconfigurado por defecto en Traccar para el protocolo Teltonika — no hace falta tocar `/opt/traccar/conf/traccar.xml` a menos que este paso falle.

---

### Task 5: Dar de alta el FMC920 en Traccar y configurarlo

**Files:** ninguno (panel web de Traccar + Teltonika Configurator, en el momento de instalar físicamente el dispositivo).

- [ ] **Paso 1 (en el panel de Traccar):** Settings → Devices → **Add** → Name: `Camion 1` (o el nombre que prefieras), Identifier (Unique ID): el **IMEI del FMC920** (15 dígitos, viene en la etiqueta del dispositivo y en la caja).
- [ ] **Paso 2 (en el Teltonika Configurator, conectando el FMC920 por USB antes de instalarlo en el vehículo):**
  - En **GPRS** → Server Settings: Domain = la IP pública de tu VM, Port = `5027`, Protocol = `TCP`.
  - En **System** → Ignition Source: selecciona **Power Voltage** (no Digital Input) — ver la decisión técnica #2 más arriba: esto libera la única entrada digital física para el botón de pánico.
  - En **I/O** (Digital Input 1): configúralo como **SOS/Panic Button** si vas a cablear un botón físico; si no vas a usar botón de pánico en esta fase, déjalo sin uso — no afecta nada más.
  - Activa (si no vienen activas por defecto): Crash Detection, Towing Detection, Green Driving (harsh acceleration/braking/cornering), Over Speeding, Excessive Idling, Jamming Detection — todas están documentadas en la sección "Accelerometer Features" / "Features settings" del wiki de Teltonika para el FMC920.
- [ ] **Paso 3 (verificación):** Con el dispositivo encendido y con señal (puede ser antes de instalarlo definitivamente, solo con corriente y antena GPS/GSM), en Traccar: Devices → el dispositivo debe pasar de gris (offline) a verde (online) en un par de minutos, y en el mapa del panel debe aparecer su posición.

---

### Task 6: Crear un usuario de solo lectura en Traccar para el script puente

**Files:** ninguno (panel web de Traccar).

El script puente no debe usar la cuenta de administrador (principio de menor privilegio).

- [ ] **Paso 1:** Settings → Users → **Add**: Name `puente-gps`, Email `puente-gps@caveli.local` (no necesita ser un email real), Password: genera una clave fuerte y guárdala — la vas a necesitar en `puente-gps/.env` (Task 9). **No marques "Administrator".**
- [ ] **Paso 2:** Abre el usuario recién creado → pestaña **Devices** (o desde el dispositivo `Camion 1` → pestaña Users) → vincula el usuario `puente-gps` a ese dispositivo, para que pueda leerlo vía API.
- [ ] **Paso 3 (verificación):** Desde tu computadora (no la VM):
```bash
curl -u puente-gps@caveli.local:LA_CLAVE http://IP_PUBLICA:8082/api/devices
```
Expected: JSON con al menos el dispositivo `Camion 1` (no un `401 Unauthorized`).

---

# PARTE B — Modelo de datos y frontend

### Task 7: Parseo de `jornadaId` (módulo compartido, TDD)

**Files:**
- Create: `jornada-id.js`
- Test: `tests/jornada-id.test.js`
- Modify: `package.json:7` (script `test`)
- Modify: `scripts/copy-web.js:9-17` (agregar el archivo al empaquetado)

**Interfaces:**
- Produces: `JornadaId.parsearJornadaId(jornadaId)` → `{fecha: 'YYYY-MM-DD', slug: string}`, usado por `distribucion-app.html` en Task 8.

- [ ] **Step 1: Escribir el test que falla**

Crea `tests/jornada-id.test.js`:
```js
var assert = require('assert');
var J = require('../jornada-id.js');

assert.deepStrictEqual(J.parsearJornadaId('2026-08-27-francisco-munoz'), { fecha: '2026-08-27', slug: 'francisco-munoz' });
assert.deepStrictEqual(J.parsearJornadaId('2026-08-27-juan'), { fecha: '2026-08-27', slug: 'juan' });
assert.deepStrictEqual(J.parsearJornadaId('2026-08-27'), { fecha: '2026-08-27', slug: '' });

console.log('OK: todos los asserts pasaron');
```

- [ ] **Step 2: Confirmar que falla**

Run: `node tests/jornada-id.test.js`
Expected: `Error: Cannot find module '../jornada-id.js'`

- [ ] **Step 3: Implementación mínima**

Crea `jornada-id.js` (mismo patrón UMD que `gps-estado.js`):
```js
// Parseo del identificador de jornada ("YYYY-MM-DD-slugChofer") en fecha + slug.
(function (root) {
  function parsearJornadaId(jornadaId) {
    var partes = (jornadaId || '').split('-');
    var fecha = partes.slice(0, 3).join('-');
    var slug = jornadaId.substring(fecha.length + 1);
    return { fecha: fecha, slug: slug };
  }

  var api = { parsearJornadaId: parsearJornadaId };

  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  else { root.JornadaId = api; }
})(typeof self !== 'undefined' ? self : this);
```

- [ ] **Step 4: Confirmar que pasa**

Run: `node tests/jornada-id.test.js`
Expected: `OK: todos los asserts pasaron`

- [ ] **Step 5: Enganchar al script `test` raíz y al empaquetado**

En `package.json:7`, cambia:
```json
    "test": "node tests/gps-estado.test.js",
```
por:
```json
    "test": "node tests/gps-estado.test.js && node tests/jornada-id.test.js",
```

En `scripts/copy-web.js`, agrega `'jornada-id.js'` al array `archivos` (junto a `'monitoreo-log.js'`).

Run: `npm test`
Expected: ambos tests imprimen `OK`.

- [ ] **Step 6: Commit**

```bash
git add jornada-id.js tests/jornada-id.test.js package.json scripts/copy-web.js
git commit -m "feat: modulo jornada-id para parsear fecha/slug del jornadaId"
```

---

### Task 8: Catálogo de vehículos + selector en `dashboard.html`

**Files:**
- Modify: `dashboard.html:307-338` (variables multi-chofer + `publicarRegistro`)
- Modify: `dashboard.html:340-351` (`renderTabs`)
- Modify: `dashboard.html:1239-1246` (inicialización)

**Interfaces:**
- Produces: colección Firestore `vehiculos/{imei}` con `{imei, nombre, activo, inmovilizadorDisponible, creado}`; campo `vehiculoImei` opcional en cada entrada de `jornadas/registro-{fecha}.choferes[]`.
- Consumes: nada de tareas anteriores (es independiente del módulo `jornada-id.js`).

No hay test automatizado para este archivo (sigue la convención existente: `dashboard.html` no tiene tests, es UI con `prompt()`/DOM). La verificación es manual, detallada en el Step 5.

- [ ] **Step 1: Vehículo por defecto (Francisco Muñoz) y estado de vehículos**

En `dashboard.html:308`, cambia:
```js
var choferes = JSON.parse(localStorage.getItem(CHOFERES_KEY) || '["","","",""]');
```
por:
```js
var choferes = JSON.parse(localStorage.getItem(CHOFERES_KEY) || '["Francisco Muñoz","","",""]');
```

Justo después (nuevo bloque, antes de `function slugChofer`):
```js
// ===== VEHICULOS (GPS fisico) =====
var VEHICULOS_KEY = 'caveli_vehiculos_v1';
var vehiculosPorChofer = JSON.parse(localStorage.getItem(VEHICULOS_KEY) || '["","","",""]'); // imei por cupo, o "" si no tiene GPS fisico
var catalogoVehiculos = []; // [{imei, nombre}], cargado desde Firestore

function guardarVehiculosPorChofer() {
  localStorage.setItem(VEHICULOS_KEY, JSON.stringify(vehiculosPorChofer));
}

function cargarCatalogoVehiculos() {
  if (!db) return;
  db.collection('vehiculos').get().then(function(snap) {
    catalogoVehiculos = snap.docs.map(function(d) { return { imei: d.id, nombre: (d.data().nombre || d.id) }; });
    renderTabs();
  }).catch(function(err) { console.warn('Error cargando vehiculos:', err); });
}

function agregarVehiculoNuevo(idx) {
  var imei = prompt('IMEI del GPS fisico (15 digitos, viene en la etiqueta del dispositivo):');
  if (!imei) { renderTabs(); return; }
  imei = imei.trim();
  var nombre = prompt('Nombre para identificar este vehiculo (ej. Camion 1):', 'Camion ' + (catalogoVehiculos.length + 1));
  if (!nombre) { renderTabs(); return; }
  db.collection('vehiculos').doc(imei).set({
    imei: imei, nombre: nombre.trim(), activo: true,
    inmovilizadorDisponible: true, creado: new Date().toISOString()
  }, { merge: true }).then(function() {
    catalogoVehiculos.push({ imei: imei, nombre: nombre.trim() });
    vehiculosPorChofer[idx] = imei;
    guardarVehiculosPorChofer();
    publicarRegistro();
    renderTabs();
  }).catch(function(err) { alert('No se pudo guardar el vehiculo: ' + err.message); renderTabs(); });
}

function asignarVehiculo(idx, valor) {
  if (valor === '__nuevo__') { agregarVehiculoNuevo(idx); return; }
  vehiculosPorChofer[idx] = valor;
  guardarVehiculosPorChofer();
  publicarRegistro();
}
```

- [ ] **Step 2: Incluir `vehiculoImei` al publicar el registro del día**

En `dashboard.html:328-338`, cambia `publicarRegistro()`:
```js
function publicarRegistro() {
  var activos = choferes
    .map(function(n, i) {
      if (!n.trim()) return null;
      var entrada = { nombre: n.trim(), slug: slugChofer(n), idx: i };
      if (vehiculosPorChofer[i]) entrada.vehiculoImei = vehiculosPorChofer[i];
      return entrada;
    })
    .filter(Boolean);
  if (activos.length === 0 || !db) return;
  db.collection('jornadas').doc('registro-' + fechaBase).set({
    choferes: activos,
    fecha: fechaBase,
    actualizado: new Date().toISOString()
  }).catch(function(err) { console.warn('Error publicando registro:', err); });
}
```

- [ ] **Step 3: Agregar el selector de vehículo a cada tab**

En `dashboard.html:340-351`, cambia `renderTabs()`:
```js
function renderTabs() {
  var cont = document.getElementById('chofer-tabs');
  if (!cont) return;
  cont.innerHTML = choferes.map(function(nombre, i) {
    var label = nombre.trim() || ('Chofer ' + (i + 1));
    var activa = i === choferActivo;
    var imeiActual = vehiculosPorChofer[i] || '';
    var opciones = '<option value="">Sin GPS fisico</option>' +
      catalogoVehiculos.map(function(v) {
        return '<option value="' + v.imei + '"' + (v.imei === imeiActual ? ' selected' : '') + '>' + v.nombre + '</option>';
      }).join('') +
      '<option value="__nuevo__">+ Agregar vehiculo...</option>';
    return '<div class="chofer-tab' + (activa ? ' active' : '') + '">' +
      '<div onclick="switchChofer(' + i + ')">' +
      '<span class="chofer-tab-nombre">' + label + '</span>' +
      '<button class="chofer-tab-edit" onclick="event.stopPropagation();renombrarChofer(' + i + ')" title="Renombrar">&#9998;</button>' +
      '</div>' +
      '<select onclick="event.stopPropagation()" onchange="event.stopPropagation();asignarVehiculo(' + i + ', this.value)" ' +
      'style="margin-top:4px;width:100%;font-size:11px;padding:2px">' + opciones + '</select>' +
      '</div>';
  }).join('');
}
```

- [ ] **Step 4: Cargar el catálogo al iniciar**

En `dashboard.html:1239-1246`, agrega la llamada junto a las otras de inicialización:
```js
  renderTabs();
  cargarCatalogoVehiculos();
  // Publicar el registro del día con los choferes ya guardados, para que
  // CAV PRO y la app del chofer puedan verlos sin tener que reeditarlos.
  publicarRegistro();
  if (choferes[0] && choferes[0].trim()) {
    jornadaId = jornadaDeChofer(0) || jornadaId;
  }
```
(Solo se agrega la línea `cargarCatalogoVehiculos();`, el resto queda igual.)

- [ ] **Step 5: Verificación manual**

1. Abre `dashboard.html` en el navegador (con `db` conectado a Firestore).
2. Confirma que el primer cupo de chofer ya dice "Francisco Muñoz" sin haber tocado nada (si es la primera vez que se carga en ese navegador).
3. En el selector del primer cupo, elige "+ Agregar vehiculo...", ingresa un IMEI de prueba (ej. `123456789012345`) y un nombre (ej. "Camion 1").
4. Verifica en la consola de Firebase (Firestore) que se creó `vehiculos/123456789012345` con esos datos.
5. Verifica que `jornadas/registro-{fecha de hoy}` tiene `choferes[0].vehiculoImei === '123456789012345'`.
6. Recarga la página: el selector debe seguir mostrando "Camion 1" seleccionado para ese cupo (persistencia en `localStorage` + catálogo recargado desde Firestore).

- [ ] **Step 6: Commit**

```bash
git add dashboard.html
git commit -m "feat: catalogo de vehiculos y asignacion diaria vehiculo-chofer en dashboard"
```

---

### Task 9: Gatear el GPS del teléfono cuando hay vehículo físico asignado

**Files:**
- Modify: `distribucion-app.html:396` (cargar `jornada-id.js`)
- Modify: `distribucion-app.html:592-597` (variables GPS)
- Modify: `distribucion-app.html:763` (`startGPS`)
- Modify: `distribucion-app.html:1589-1599` (`startRoute`)
- Modify: `distribucion-app.html:1723` (arranque al recargar)

**Interfaces:**
- Consumes: `JornadaId.parsearJornadaId(jornadaId)` de Task 7.

No hay test automatizado (mismo motivo que Task 8: es integración con Firestore + DOM). Verificación manual en el Step 6.

- [ ] **Step 1: Cargar el módulo `jornada-id.js`**

En `distribucion-app.html:396`, antes de `<script src="monitoreo-log.js"></script>`, agrega:
```html
<script src="jornada-id.js"></script>
```

- [ ] **Step 2: Nueva variable de estado**

En `distribucion-app.html:592-597`, junto a las otras variables de GPS, agrega:
```js
var vehiculoFisicoAsignado = null; // imei del GPS fisico si el chofer tiene uno asignado hoy, o null
```

- [ ] **Step 3: Función que consulta la asignación de hoy**

Cerca de `escribirGpsCoords` (`distribucion-app.html:637`), agrega:
```js
// Consulta si el vehiculo de hoy tiene GPS fisico asignado (jornadas/registro-{fecha}).
// Si lo tiene, el telefono no debe enviar su propio GPS (evita que ambas fuentes escriban
// al mismo tiempo y el marcador "pelee" entre una posicion y otra).
function cargarVehiculoAsignado() {
  if (!db || !jornadaId) return Promise.resolve(null);
  var partes = JornadaId.parsearJornadaId(jornadaId);
  return db.collection('jornadas').doc('registro-' + partes.fecha).get().then(function(doc) {
    vehiculoFisicoAsignado = null;
    if (doc.exists) {
      var lista = doc.data().choferes || [];
      var propio = lista.filter(function(c) { return c.slug === partes.slug; })[0];
      if (propio && propio.vehiculoImei) vehiculoFisicoAsignado = propio.vehiculoImei;
    }
    return vehiculoFisicoAsignado;
  }).catch(function() { vehiculoFisicoAsignado = null; return null; });
}
```

- [ ] **Step 4: Gatear el dispatcher `startGPS()`**

En `distribucion-app.html:763`, cambia:
```js
function startGPS() { if (esNativo()) startGPSNativo(); else startGPSWeb(); }
```
por:
```js
function startGPS() {
  if (vehiculoFisicoAsignado) {
    setGpsStatus('gps-inactivo', 'GPS fisico activo para este vehiculo', 'El telefono no envia ubicacion');
    Monitoreo.registrar('gps', 'info', 'GPS telefono desactivado: vehiculo ' + vehiculoFisicoAsignado + ' tiene GPS fisico');
    return;
  }
  if (esNativo()) startGPSNativo(); else startGPSWeb();
}
```

- [ ] **Step 5: Esperar la asignación antes de arrancar el GPS**

En `distribucion-app.html:1589-1599` (`startRoute`), cambia:
```js
function startRoute() {
  if (clients.length === 0) { showToast('El jefe aun no carga los clientes', 'error'); return; }
  if (!startTime) {
    startTime = new Date(); startTimer(); save();
    startGPS();
  }
  document.getElementById('btn-start').textContent = '&#9679; Ruta en curso';
  actualizarBoxOptimizar();
  renderCiudades();
  renderRuta();
}
```
por:
```js
function startRoute() {
  if (clients.length === 0) { showToast('El jefe aun no carga los clientes', 'error'); return; }
  if (!startTime) {
    startTime = new Date(); startTimer(); save();
    cargarVehiculoAsignado().then(startGPS);
  }
  document.getElementById('btn-start').textContent = '&#9679; Ruta en curso';
  actualizarBoxOptimizar();
  renderCiudades();
  renderRuta();
}
```

En `distribucion-app.html:1723`, cambia:
```js
if(startTime && gpsWatchId===null && gpsNativeId===null) startGPS();
```
por:
```js
if(startTime && gpsWatchId===null && gpsNativeId===null) cargarVehiculoAsignado().then(startGPS);
```

- [ ] **Step 6: Verificación manual**

1. Con el `vehiculos`/`jornadas` de prueba de Task 8 Step 5 (chofer con `vehiculoImei` asignado), abre `distribucion-app.html`, inicia sesión como ese chofer, presiona "Comenzar ruta".
2. La barra de estado de GPS debe mostrar "GPS fisico activo para este vehiculo" y **no** debe pedir permiso de ubicación al navegador.
3. Revisa el tab de Monitoreo de la app: debe registrar el evento `gps info` "GPS telefono desactivado...".
4. Repite con un chofer **sin** `vehiculoImei` asignado: debe pedir permiso de ubicación y funcionar exactamente como antes (regresión).

- [ ] **Step 7: Commit**

```bash
git add distribucion-app.html
git commit -m "feat: desactivar GPS del telefono cuando el vehiculo tiene GPS fisico asignado"
```

---

# PARTE C — Script puente (Node.js en la VM)

### Task 10: Setup del proyecto `puente-gps/`

**Files:**
- Create: `puente-gps/package.json`
- Create: `puente-gps/.gitignore`
- Create: `puente-gps/.env.example`

- [ ] **Step 1:** Crea `puente-gps/package.json`:
```json
{
  "name": "puente-gps-traccar-firestore",
  "version": "1.0.0",
  "private": true,
  "description": "Puente Traccar -> Firestore para el GPS fisico de los vehiculos de Caveli",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "test": "node test/traccarClient.test.js && node test/asignaciones.test.js && node test/mapPosition.test.js && node test/firestoreWriter.test.js"
  },
  "dependencies": {
    "firebase-admin": "^12.0.0"
  }
}
```

- [ ] **Step 2:** Crea `puente-gps/.gitignore`:
```
node_modules/
.env
service-account.json
```

- [ ] **Step 3:** Crea `puente-gps/.env.example`:
```
TRACCAR_URL=http://localhost:8082
TRACCAR_USUARIO=puente-gps@caveli.local
TRACCAR_CLAVE=cambiar-esta-clave
CAVELI_SERVICE_ACCOUNT=/opt/puente-gps/service-account.json
```

- [ ] **Step 4: Commit**

```bash
git add puente-gps/package.json puente-gps/.gitignore puente-gps/.env.example
git commit -m "chore: setup del proyecto puente-gps"
```

---

### Task 11: Cliente Traccar (`traccarClient.js`, TDD)

**Files:**
- Create: `puente-gps/src/traccarClient.js`
- Test: `puente-gps/test/traccarClient.test.js`

**Interfaces:**
- Produces: `crearClienteTraccar(config, fetchFn?)` → `{ obtenerDispositivos(): Promise<Array>, obtenerPosiciones(): Promise<Array> }`, y `authHeader(usuario, clave): string`. Usado por Task 14 (`index.js`).

- [ ] **Step 1: Escribir el test que falla**

Crea `puente-gps/test/traccarClient.test.js`:
```js
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
```

- [ ] **Step 2: Confirmar que falla**

Run: `node puente-gps/test/traccarClient.test.js`
Expected: `Error: Cannot find module '../src/traccarClient'`

- [ ] **Step 3: Implementación mínima**

Crea `puente-gps/src/traccarClient.js`:
```js
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
```

- [ ] **Step 4: Confirmar que pasa**

Run: `node puente-gps/test/traccarClient.test.js`
Expected: `OK: traccarClient`

- [ ] **Step 5: Commit**

```bash
git add puente-gps/src/traccarClient.js puente-gps/test/traccarClient.test.js
git commit -m "feat(puente-gps): cliente de lectura para la API REST de Traccar"
```

---

### Task 12: Asignaciones del día (`asignaciones.js`, TDD)

**Files:**
- Create: `puente-gps/src/asignaciones.js`
- Test: `puente-gps/test/asignaciones.test.js`

**Interfaces:**
- Consumes: nada (recibe `db`, instancia de Firestore Admin, inyectada).
- Produces: `obtenerAsignacionesHoy(db): Promise<{[imei]: {jornadaId, chofer}}>` y `fechaHoy(): string`. Usado por Task 14 (`index.js`).

- [ ] **Step 1: Escribir el test que falla**

Crea `puente-gps/test/asignaciones.test.js`:
```js
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
```

- [ ] **Step 2: Confirmar que falla**

Run: `node puente-gps/test/asignaciones.test.js`
Expected: `Error: Cannot find module '../src/asignaciones'`

- [ ] **Step 3: Implementación mínima**

Crea `puente-gps/src/asignaciones.js`:
```js
// Determina, para hoy, que jornadaId (fecha+slug de chofer) corresponde a cada vehiculo por IMEI.
function fechaHoy() {
  return new Date().toISOString().split('T')[0];
}

function obtenerAsignacionesHoy(db) {
  var fecha = fechaHoy();
  return db.collection('jornadas').doc('registro-' + fecha).get().then(function (doc) {
    var mapa = {};
    if (!doc.exists) return mapa;
    var choferes = doc.data().choferes || [];
    choferes.forEach(function (c) {
      if (c.vehiculoImei) {
        mapa[c.vehiculoImei] = { jornadaId: fecha + '-' + c.slug, chofer: c.nombre };
      }
    });
    return mapa;
  });
}

module.exports = { obtenerAsignacionesHoy: obtenerAsignacionesHoy, fechaHoy: fechaHoy };
```

- [ ] **Step 4: Confirmar que pasa**

Run: `node puente-gps/test/asignaciones.test.js`
Expected: `OK: asignaciones`

- [ ] **Step 5: Commit**

```bash
git add puente-gps/src/asignaciones.js puente-gps/test/asignaciones.test.js
git commit -m "feat(puente-gps): mapeo diario imei -> jornadaId"
```

---

### Task 13: Mapeo de posición y sensores (`mapPosition.js`, TDD)

**Files:**
- Create: `puente-gps/src/mapPosition.js`
- Test: `puente-gps/test/mapPosition.test.js`

**Interfaces:**
- Produces: `mapearPosicion(position): {lat, lng, precision, timestamp, combustible, ignition, motion, power, battery, batteryLevel, odometer, alarm, sensores}`. Usado por Task 14 (`index.js`).

- [ ] **Step 1: Escribir el test que falla**

Crea `puente-gps/test/mapPosition.test.js`:
```js
var assert = require('assert');
var { mapearPosicion } = require('../src/mapPosition');

function run() {
  var posicion = {
    latitude: -33.45, longitude: -70.66, accuracy: 4.2,
    fixTime: '2026-08-27T12:00:00.000Z',
    attributes: {
      ignition: true, motion: true, power: 13.8, battery: 4.1, batteryLevel: 92,
      odometer: 152300, alarm: 'harshBraking',
      in1: 0, out1: 0, sat: 11, rssi: 3
    }
  };
  var mapeado = mapearPosicion(posicion);
  assert.strictEqual(mapeado.lat, -33.45);
  assert.strictEqual(mapeado.lng, -70.66);
  assert.strictEqual(mapeado.timestamp, '2026-08-27T12:00:00.000Z');
  assert.strictEqual(mapeado.ignition, true);
  assert.strictEqual(mapeado.alarm, 'harshBraking');
  assert.strictEqual(mapeado.combustible, null);
  assert.deepStrictEqual(mapeado.sensores, { in1: 0, out1: 0, sat: 11, rssi: 3 });

  var sinAtributos = mapearPosicion({ latitude: 0, longitude: 0, fixTime: 'x', attributes: {} });
  assert.strictEqual(sinAtributos.ignition, null);
  assert.deepStrictEqual(sinAtributos.sensores, {});

  console.log('OK: mapPosition');
}

run();
```

- [ ] **Step 2: Confirmar que falla**

Run: `node puente-gps/test/mapPosition.test.js`
Expected: `Error: Cannot find module '../src/mapPosition'`

- [ ] **Step 3: Implementación mínima**

Crea `puente-gps/src/mapPosition.js`:
```js
// Traduce una Position de la API de Traccar a los campos que escribimos en Firestore.
// Los campos de alta confianza (iguales en casi todos los protocolos de Traccar, no solo
// Teltonika) se promueven con nombre propio. Todo lo demas que Traccar haya decodificado
// (choque, remolque, manejo brusco, jamming, sabotaje, geocercas, etc.) se copia sin filtrar
// a "sensores" para no perder ningun dato de fabrica aunque no sepamos de antemano su nombre exacto.
var CAMPOS_CONOCIDOS = ['ignition', 'motion', 'power', 'battery', 'batteryLevel', 'odometer', 'alarm'];

function mapearPosicion(position) {
  var attrs = position.attributes || {};
  var salida = {
    lat: position.latitude,
    lng: position.longitude,
    precision: position.accuracy || null,
    timestamp: position.fixTime || position.deviceTime || position.serverTime || null,
    combustible: null, // reservado: llega con el adaptador OBDII Bluetooth (fase futura, no instalado)
    sensores: {}
  };
  CAMPOS_CONOCIDOS.forEach(function (campo) {
    salida[campo] = (attrs[campo] !== undefined) ? attrs[campo] : null;
  });
  Object.keys(attrs).forEach(function (k) {
    if (CAMPOS_CONOCIDOS.indexOf(k) === -1) salida.sensores[k] = attrs[k];
  });
  return salida;
}

module.exports = { mapearPosicion: mapearPosicion, CAMPOS_CONOCIDOS: CAMPOS_CONOCIDOS };
```

- [ ] **Step 4: Confirmar que pasa**

Run: `node puente-gps/test/mapPosition.test.js`
Expected: `OK: mapPosition`

- [ ] **Step 5: Commit**

```bash
git add puente-gps/src/mapPosition.js puente-gps/test/mapPosition.test.js
git commit -m "feat(puente-gps): mapeo de posicion y sensores crudos del FMC920"
```

---

### Task 14: Escritura a Firestore (`firestoreWriter.js`, TDD)

**Files:**
- Create: `puente-gps/src/firestoreWriter.js`
- Test: `puente-gps/test/firestoreWriter.test.js`

**Interfaces:**
- Consumes: salida de `mapearPosicion()` (Task 13).
- Produces: `escribirEstadoVehiculo(db, imei, datos): Promise`, `escribirGpsJornada(db, jornadaId, chofer, imei, datos): Promise`. Usados por Task 15 (`index.js`).

- [ ] **Step 1: Escribir el test que falla**

Crea `puente-gps/test/firestoreWriter.test.js`:
```js
var assert = require('assert');
var { escribirEstadoVehiculo, escribirGpsJornada } = require('../src/firestoreWriter');

function fakeDb() {
  var llamadas = [];
  return {
    llamadas: llamadas,
    collection: function (nombre) {
      return {
        doc: function (id) {
          return {
            set: function (datos, opts) {
              llamadas.push({ coleccion: nombre, id: id, datos: datos, opts: opts });
              return Promise.resolve();
            }
          };
        }
      };
    }
  };
}

async function run() {
  var db = fakeDb();
  await escribirEstadoVehiculo(db, '111111111111111', { lat: 1, lng: 2, ignition: true });
  assert.strictEqual(db.llamadas[0].coleccion, 'vehiculos');
  assert.strictEqual(db.llamadas[0].id, '111111111111111');
  assert.strictEqual(db.llamadas[0].datos.posicionActual.ignition, true);
  assert.strictEqual(db.llamadas[0].opts.merge, true);

  var db2 = fakeDb();
  await escribirGpsJornada(db2, '2026-08-27-francisco-munoz', 'Francisco Munoz', '111111111111111', {
    lat: 1, lng: 2, precision: 5, ignition: true, motion: true, power: 13.8, battery: 4.1,
    batteryLevel: 92, odometer: 100, alarm: null, combustible: null, sensores: { sat: 9 }
  });
  var llamada = db2.llamadas[0];
  assert.strictEqual(llamada.coleccion, 'gps');
  assert.strictEqual(llamada.id, '2026-08-27-francisco-munoz');
  assert.strictEqual(llamada.datos.fuenteGps, 'fisico');
  assert.strictEqual(llamada.datos.vehiculoImei, '111111111111111');
  assert.strictEqual(llamada.datos.chofer, 'Francisco Munoz');
  assert.strictEqual(llamada.datos.lat, 1);
  assert.strictEqual(llamada.opts.merge, true);

  console.log('OK: firestoreWriter');
}

run();
```

- [ ] **Step 2: Confirmar que falla**

Run: `node puente-gps/test/firestoreWriter.test.js`
Expected: `Error: Cannot find module '../src/firestoreWriter'`

- [ ] **Step 3: Implementación mínima**

Crea `puente-gps/src/firestoreWriter.js`:
```js
var admin = require('firebase-admin');

// Siempre escribe el estado del vehiculo, tenga o no turno publicado hoy.
function escribirEstadoVehiculo(db, imei, datos) {
  return db.collection('vehiculos').doc(imei).set({
    posicionActual: datos,
    ultimaActualizacion: new Date().toISOString()
  }, { merge: true });
}

// Mismo formato que escribirGpsCoords() de distribucion-app.html, mas los campos de
// sensores como extras de nivel superior. rastro sigue siendo solo {lat,lng,ts} para
// no arriesgar el limite de 1MB por documento de Firestore.
function escribirGpsJornada(db, jornadaId, chofer, imei, datos) {
  var punto = { lat: datos.lat, lng: datos.lng, ts: new Date().toISOString() };
  var doc = {
    lat: datos.lat, lng: datos.lng,
    precision: datos.precision,
    timestamp: punto.ts,
    chofer: chofer,
    fuenteGps: 'fisico',
    vehiculoImei: imei,
    ignition: datos.ignition, motion: datos.motion, power: datos.power,
    battery: datos.battery, batteryLevel: datos.batteryLevel, odometer: datos.odometer,
    alarm: datos.alarm, combustible: datos.combustible, sensores: datos.sensores,
    rastro: admin.firestore.FieldValue.arrayUnion(punto)
  };
  return db.collection('gps').doc(jornadaId).set(doc, { merge: true });
}

module.exports = { escribirEstadoVehiculo: escribirEstadoVehiculo, escribirGpsJornada: escribirGpsJornada };
```

- [ ] **Step 4: Confirmar que pasa**

Run: `node puente-gps/test/firestoreWriter.test.js`
Expected: `OK: firestoreWriter`

- [ ] **Step 5: Commit**

```bash
git add puente-gps/src/firestoreWriter.js puente-gps/test/firestoreWriter.test.js
git commit -m "feat(puente-gps): escritura a vehiculos/{imei} y gps/{jornadaId}"
```

---

### Task 15: Loop principal, despliegue en la VM y verificación end-to-end

**Files:**
- Create: `puente-gps/src/index.js`

- [ ] **Step 1: Implementar el loop principal**

Crea `puente-gps/src/index.js`:
```js
var admin = require('firebase-admin');
var { crearClienteTraccar } = require('./traccarClient');
var { obtenerAsignacionesHoy } = require('./asignaciones');
var { mapearPosicion } = require('./mapPosition');
var { escribirEstadoVehiculo, escribirGpsJornada } = require('./firestoreWriter');

var INTERVALO_MS = 15000; // igual al throttle de distribucion-app.html y dashboard.html

admin.initializeApp({ credential: admin.credential.cert(require(process.env.CAVELI_SERVICE_ACCOUNT)) });
var db = admin.firestore();

var traccar = crearClienteTraccar({
  baseUrl: process.env.TRACCAR_URL,
  usuario: process.env.TRACCAR_USUARIO,
  clave: process.env.TRACCAR_CLAVE
});

function log(msg) { console.log('[' + new Date().toISOString() + '] ' + msg); }

function ciclo() {
  Promise.all([traccar.obtenerDispositivos(), traccar.obtenerPosiciones(), obtenerAsignacionesHoy(db)])
    .then(function (resultados) {
      var dispositivos = resultados[0], posiciones = resultados[1], asignaciones = resultados[2];
      var idAImei = {};
      dispositivos.forEach(function (d) { idAImei[d.id] = d.uniqueId; });

      var tareas = posiciones.map(function (posicion) {
        var imei = idAImei[posicion.deviceId];
        if (!imei) return Promise.resolve();
        var datos = mapearPosicion(posicion);

        var tareaVehiculo = escribirEstadoVehiculo(db, imei, datos)
          .catch(function (e) { log('ERROR escribiendo vehiculos/' + imei + ': ' + e.message); });

        var asignacion = asignaciones[imei];
        var tareaJornada = asignacion
          ? escribirGpsJornada(db, asignacion.jornadaId, asignacion.chofer, imei, datos)
              .catch(function (e) { log('ERROR escribiendo gps/' + asignacion.jornadaId + ': ' + e.message); })
          : Promise.resolve();

        return Promise.all([tareaVehiculo, tareaJornada]);
      });

      return Promise.all(tareas);
    })
    .then(function () { log('Ciclo OK'); })
    .catch(function (e) { log('ERROR en ciclo: ' + e.message); })
    .finally(function () { setTimeout(ciclo, INTERVALO_MS); });
}

log('Puente GPS iniciado. Traccar: ' + process.env.TRACCAR_URL);
ciclo();
```

- [ ] **Step 2: Commit en el repo**

```bash
git add puente-gps/src/index.js
git commit -m "feat(puente-gps): loop principal de sincronizacion Traccar -> Firestore"
```

- [ ] **Step 3: Generar la credencial de servicio de Firebase**

En Firebase Console → ⚙️ Configuración del proyecto → Cuentas de servicio → **Generar nueva clave privada**. Descarga el JSON — no lo subas al repo.

- [ ] **Step 4: Desplegar en la VM (por SSH)**

```bash
# En la VM:
sudo apt-get install -y nodejs npm git   # o instala Node 20.x via NodeSource si apt trae una version vieja
sudo mkdir -p /opt/puente-gps
sudo chown $USER:$USER /opt/puente-gps
git clone <URL_DE_TU_REPO> /opt/puente-gps-repo
cp -r /opt/puente-gps-repo/puente-gps/* /opt/puente-gps/
cd /opt/puente-gps
npm install
cp .env.example .env
nano .env   # completa TRACCAR_URL=http://localhost:8082, TRACCAR_USUARIO, TRACCAR_CLAVE (Task 6), CAVELI_SERVICE_ACCOUNT
```
Sube el JSON de la cuenta de servicio a la VM (por `scp`) a la ruta que pusiste en `CAVELI_SERVICE_ACCOUNT` (ej. `/opt/puente-gps/service-account.json`).

- [ ] **Step 5: Correr manualmente y verificar antes de convertirlo en servicio**

```bash
cd /opt/puente-gps
node src/index.js
```
Expected: logs `[timestamp] Puente GPS iniciado...` y `[timestamp] Ciclo OK` cada 15s, sin líneas `ERROR`. Verifica en Firebase Console que `vehiculos/{tu imei}` se está actualizando. Si el chofer de prueba tiene turno publicado con ese IMEI, verifica que `gps/{jornadaId}` también se actualiza y que `dashboard.html` sigue mostrando el mapa con normalidad. Detén con Ctrl+C.

- [ ] **Step 6: Crear el servicio systemd para que corra 24/7**

```bash
sudo useradd --system --no-create-home puentegps || true
sudo chown -R puentegps:puentegps /opt/puente-gps
sudo tee /etc/systemd/system/puente-gps.service > /dev/null <<'EOF'
[Unit]
Description=Puente GPS Traccar -> Firestore (Caveli)
After=network.target traccar.service

[Service]
Type=simple
WorkingDirectory=/opt/puente-gps
EnvironmentFile=/opt/puente-gps/.env
ExecStart=/usr/bin/node /opt/puente-gps/src/index.js
Restart=on-failure
RestartSec=10
User=puentegps

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now puente-gps
```

- [ ] **Step 7: Verificación final end-to-end**

```bash
sudo systemctl status puente-gps
sudo journalctl -u puente-gps -f
```
Expected: `active (running)`, logs mostrando ciclos OK cada 15s. Con el FMC920 encendido y con turno publicado para su chofer, `dashboard.html` debe mostrar el marcador moviéndose en tiempo real igual que antes con el GPS del teléfono, y `vehiculos/{imei}.posicionActual` debe reflejar los campos de sensores (`ignition`, `motion`, etc.) — anota los nombres reales que aparecen dentro de `sensores` la primera vez que el dispositivo reporta un evento de choque/remolque/manejo brusco, para confirmar si coinciden con los nombres que documentamos en la sección de decisiones técnicas (#1 más arriba). Si algún campo de alta confianza (`ignition`, `motion`, etc.) aparece vacío estando el vehículo en movimiento, revisa que el AVL ID correspondiente esté habilitado para envío en el Teltonika Configurator (Task 5).

---

## Nota explícita para el futuro: combustible

Esta fase **no** captura combustible real — el campo `combustible` queda `null` en `vehiculos/{imei}.posicionActual` y en `gps/{jornadaId}`, reservado para no tener que migrar el esquema. Cuando decidas instalarlo, la vía recomendada es el **adaptador OBDII Bluetooth** (más preciso que el sensor analógico de estanque) — es una tarea separada que involucra: comprar el adaptador compatible con el FMC920, emparejarlo por Bluetooth en el Configurator, habilitar los AVL IDs de combustible OBD en Traccar, y cambiar una línea en `mapPosition.js` para dejar de forzar `combustible: null`. No se incluye en este plan.

## Self-review (spec coverage)

- Tracking físico reemplaza al del teléfono sin romper `dashboard.html`: Tasks 9, 14, 15. ✔
- Modelo de datos IMEI↔vehículo↔chofer: Tasks 8, 12. ✔
- Doble escritura incondicional + condicionada a turno: Task 14. ✔
- Todos los sensores solicitados capturados (choque, remolque, manejo brusco, ignición, pánico, salida digital/inmovilizador documentado, sabotaje, exceso de velocidad, ralentí, geocercas): cubiertos por el passthrough genérico de `mapPosition.js` (Task 13) + configuración en Task 5. Inmovilizador: documentado como capacidad disponible vía comando `engineStop`/`engineResume` de Traccar (soporta DOUT de Teltonika), no activado. ✔
- Combustible reservado sin implementarse: Tasks 13, 14 + nota final. ✔
- Sin dashboard/análisis nuevo: no se creó ninguna vista, gráfico ni pantalla nueva — solo captura y guardado. ✔
- Guía Oracle Cloud + apertura de puertos: Tasks 1-3. ✔
- Instalación de Traccar paso a paso: Task 4. ✔
- Cero costo recurrente: todo corre en la VM vía Admin SDK, sin Cloud Functions (ver Global Constraints y decisión técnica #6). ✔
