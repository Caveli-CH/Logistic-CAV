# Diseño: Panel "Monitoreo" en la app del chofer (visibilidad de fallas)

**Fecha:** 2026-06-27
**Estado:** Aprobado para planificación

## Problema

Hoy un chofer ("Francisco") trabajó una ruta completa: marcó 15 entregas y su app mostraba "● Conectado". Pero **nada de eso llegó a la base de datos**: ni las entregas ni el GPS. Al revisar desde otro dispositivo, aparecía "todo en 0". Los datos vivían solo en el `localStorage` de su teléfono y se perdieron.

La causa por la que **no pudimos diagnosticarlo** es que la app **traga los errores en silencio**:
- `syncFirebase()` ([distribucion-app.html:554](../../../distribucion-app.html)) hace `.catch(function(e){ console.warn('Sync queued (offline)'); })` — reporta "offline" aunque el problema no sea falta de internet.
- `escribirGpsCoords()` y `escribirGps()` envuelven la escritura en `try/catch {}` vacío.
- `initFirebase()` atrapa el fallo y solo cambia un texto pequeño.
- El indicador "Conectado" se basa en `navigator.onLine` (solo si hay internet), **no** en si Firebase de verdad guardó.

Resultado: el sistema aparenta funcionar mientras pierde datos en silencio, y no queda rastro para revisar qué falló.

## Objetivo

Dar **visibilidad total de las fallas** sin confundir al chofer: un panel **"Monitoreo"** dentro de la app del chofer que registra, con hora, todo lo que pasa y lo que falla en ese teléfono. El chofer no lo usa; sirve para que el jefe (o el chofer guiado) lo abra en el dispositivo —o mande una captura— y vea exactamente qué ocurrió, **incluso si Firebase está totalmente caído**, porque el registro es local.

Esta pieza es **solo observabilidad**: hace visibles las fallas. NO arregla todavía la sincronización (eso es una pieza posterior).

## Alcance

**Incluye:**
- Un nuevo tab "Monitoreo" en la app del chofer.
- Un módulo de registro (log) de eventos, guardado localmente.
- Instrumentar los puntos donde hoy se tragan errores para que registren su resultado real (éxito/fallo con motivo).
- Un resumen de estado arriba del panel (última sincronización exitosa, cambios pendientes).
- Botón para copiar/compartir el registro.

**No incluye (piezas posteriores, ya acordadas):**
- Arreglar la sincronización: `.update()` → `.set(merge)`, reintentos, no perder datos entre dispositivos (pieza "Sync a prueba de fallos").
- Candado de un-dispositivo-por-chofer.
- Confiabilidad de la ubicación en segundo plano.
- Aviso en el dashboard del jefe "sin datos hace X min" (anotado para después).

## Componentes

### 1. Módulo de registro (`monitoreo-log.js`, archivo nuevo)

Módulo puro sin dependencias, usable en navegador (global `Monitoreo`) y en Node (para test), con estas funciones:

- `Monitoreo.registrar(tipo, resultado, detalle)` — agrega un evento `{ ts, tipo, resultado, detalle }` donde:
  - `ts`: ISO string del momento.
  - `tipo`: `'entrega' | 'gps' | 'firebase' | 'conexion' | 'sesion'`.
  - `resultado`: `'ok' | 'error' | 'info'`.
  - `detalle`: texto libre (ej. nombre del cliente, código de error, precisión).
- Mantiene una **lista circular** de los últimos **200** eventos en memoria y la persiste en `localStorage` bajo la clave `caveli_monitoreo`.
- `Monitoreo.obtenerEventos()` — devuelve el arreglo de eventos (más reciente primero).
- `Monitoreo.marcarSyncOk()` / `Monitoreo.ultimaSyncOk()` — guarda/lee el timestamp de la última escritura exitosa a Firebase.
- `Monitoreo.pendientes(n)` / lectura del contador de cambios pendientes de subir (lo alimenta la app).
- `Monitoreo.formatearTexto()` — devuelve todo el registro como texto plano para copiar/compartir.
- Al cargar, rehidrata desde `localStorage` (sobrevive cerrar/reabrir).

Este módulo es la única parte con lógica pura testeable (test en Node), igual que se hizo con `gps-estado.js`.

### 2. Tab "Monitoreo" en la app del chofer (`distribucion-app.html`)

- Nuevo botón de tab "Monitoreo" y su `tab-content`, siguiendo el patrón de los tabs existentes (Cargar/Ruta/Entregas/Reporte).
- **Encabezado de estado:**
  - Última sincronización exitosa: "hace X" (o "nunca" si no ha habido).
  - Cambios pendientes de subir: número.
  - Estado honesto de conexión (basado en si la última escritura funcionó, no solo en `navigator.onLine`).
- **Lista de eventos:** los últimos 200, más reciente arriba, cada uno con hora, ícono (✓ ok / ✗ error / • info) y texto. Color por resultado (verde/rojo/gris).
- **Botón "Copiar / Compartir registro"**: usa `navigator.share` si existe, si no copia al portapapeles, con `Monitoreo.formatearTexto()`.
- Ejemplos de líneas:
  - `14:22:05  ✓ Entrega guardada y subida: RICHARD REVECO`
  - `14:22:06  ✗ GPS no envió: FirebaseError permission-denied`
  - `14:20:00  • Sin internet — cambios guardados localmente`
  - `14:19:30  ✓ Sesión iniciada: 2026-06-27-francisco`

### 3. Instrumentación de los puntos que hoy se silencian (`distribucion-app.html`)

Reemplazar los `catch` vacíos / engañosos por llamadas a `Monitoreo.registrar(...)`, sin cambiar todavía la lógica de guardado:

- `syncFirebase()`: en el `.then` de éxito → `Monitoreo.registrar('entrega','ok',...)` + `Monitoreo.marcarSyncOk()`; en el `.catch` → `Monitoreo.registrar('firebase','error', e.code + ' ' + e.message)` (en vez del falso "Sync queued (offline)").
- `escribirGpsCoords()`: registrar éxito/fallo real de la escritura de GPS.
- `escribirGps()` / camino nativo `onNativePos`: registrar el envío de GPS con precisión, o el error.
- `initFirebase()`: registrar `'firebase','ok'` al inicializar o `'firebase','error'` en el `catch`.
- Eventos `online`/`offline` y `setConexion()`: registrar cambios de conexión.
- `seleccionarSesion()` / arranque: registrar la sesión iniciada (`jornadaId`).

## Modelo de datos

**Sin cambios en Firestore.** El registro de Monitoreo es **100% local** (`localStorage`, clave `caveli_monitoreo`). No se sube a la base en esta pieza (por diseño: debe funcionar aunque Firebase esté caído).

## Pruebas

- **`monitoreo-log.js`**: test en Node (`node tests/monitoreo-log.test.js`) para la lógica pura — agregar eventos, tope circular de 200, formato de texto, última sync. Igual patrón que `tests/gps-estado.test.js`.
- **Tab e instrumentación**: verificación manual en navegador — provocar un guardado y ver el evento en el panel; simular error de Firebase (p. ej. cortar internet) y ver el evento de error; confirmar que el registro sobrevive al recargar; probar el botón compartir/copiar.

## Fuera de alcance / siguientes piezas

1. **Sync a prueba de fallos**: `.set(merge)`, reintentos automáticos, no perder datos entre dispositivos.
2. **Un dispositivo por chofer**.
3. **Ubicación en segundo plano confiable**.
4. **Aviso en el dashboard del jefe** ("sin datos hace X min", umbral 5 min).
