# Diseño: Rastreo GPS confiable (definitivo)

**Fecha:** 2026-06-21
**Estado:** Aprobado para planificación

## Problema

La ubicación del chofer "se queda pegada" en el dashboard. El chofer dice que no apagó el GPS, y es cierto: el problema no es el GPS del teléfono.

**Causa raíz:** la app del chofer ([distribucion-app.html](../../../distribucion-app.html)) envía la ubicación con un `setInterval` cada 15s que llama a `getCurrentPosition`. Los navegadores móviles **pausan o congelan los `setInterval`** cuando la pantalla se bloquea o el chofer cambia a otra app. El GPS sigue activo, pero el temporizador de JavaScript deja de dispararse y dejan de llegar puntos.

Lo agrava que el dashboard ([dashboard.html](../../../dashboard.html)) **no avisa cuando los datos están viejos**: sigue mostrando la última posición recibida como si fuera real, así que parece que el chofer está congelado en un punto.

**Restricción clave:** el uso del teléfono es mixto (a veces montado con pantalla encendida, a veces en el bolsillo con pantalla apagada). En una app web/PWA pura, el rastreo en segundo plano con pantalla apagada es prácticamente imposible de forma confiable. La única solución 100% confiable es un contenedor nativo con GPS en segundo plano.

## Estado actual del sistema

- **App del chofer** ([distribucion-app.html](../../../distribucion-app.html)): PWA instalable (`manifest.json` + `sw.js`). El service worker solo cachea archivos para offline; no hace nada de GPS. El envío de ubicación depende del `setInterval` en `startGPS()` / `enviarGPS()` / `stopGPS()`.
- **Dashboard** ([dashboard.html](../../../dashboard.html)): escucha `gps/{jornadaId}` con `onSnapshot` (`escucharGPS()`) y mueve el marcador del chofer en Google Maps.
- **Firestore:** documento `gps/{jornadaId}` con `lat`, `lng`, `precision`, `timestamp`, `chofer`, `rastro` (arreglo de puntos vía `arrayUnion`).

## Arquitectura de la solución

Dos capas que conviven en la misma base de código:

- **Capa A (web):** mejoras en el HTML actual que sirven tanto en el PWA como dentro del contenedor nativo.
- **Capa B (nativa):** envoltorio Capacitor del mismo HTML + plugin de GPS en segundo plano.

El código del chofer detecta su entorno con `Capacitor.isNativePlatform()`: en el contenedor nativo usa el plugin; en navegador/PWA usa `watchPosition`. **Una sola base de código.**

## Capa A — Endurecimiento web

### A1. Dashboard: detección de "GPS desactualizado"

Archivo: [dashboard.html](../../../dashboard.html)

- Un temporizador revisa cada ~15s la antigüedad del último punto recibido. Es necesario un temporizador aparte porque `onSnapshot` solo se dispara cuando llegan datos nuevos; si dejan de llegar, nada lo notificaría.
- Tres estados visuales (marcador + banner + texto "Última actualización GPS"):
  - 🟢 **Activo:** última señal < 60s.
  - 🟡 **Atrasado:** entre 60s y 3min → texto "última señal hace X".
  - 🔴 **Sin señal:** > 3min → marcador en rojo + aviso claro "Sin señal hace X min".
- La antigüedad se calcula con el campo `timestamp` que ya existe en el documento `gps/{jornadaId}`.

### A2. Driver: Wake Lock

Archivo: [distribucion-app.html](../../../distribucion-app.html)

- Mientras la jornada está activa, pedir `navigator.wakeLock.request('screen')` para que la pantalla no se apague.
- El Wake Lock se libera automáticamente cuando la página se oculta; re-solicitarlo en el evento `visibilitychange` al volver a primer plano.
- Liberar el Wake Lock al detener la jornada (en `stopGPS()` o equivalente).
- Degradación elegante: si el navegador no soporta Wake Lock, continuar sin error.

### A3. Driver: `watchPosition`

Archivo: [distribucion-app.html](../../../distribucion-app.html)

- Reemplazar el patrón `getCurrentPosition` + `setInterval` por `navigator.geolocation.watchPosition`.
- Aplicar *throttle* a la escritura en Firestore: escribir como máximo cada ~15s (o por movimiento significativo) para no inflar el arreglo `rastro`. Mantener un `lastWrite` para controlar la frecuencia.
- Liberar con `clearWatch` al detener (`stopGPS()`).
- Conservar el manejo de errores actual (permiso denegado, señal débil, timeout) y los estados visuales de la barra de GPS.

## Capa B — Contenedor nativo (Capacitor)

### B1. Prerequisito de entorno (primer paso de la Fase 2)

- Instalar **Android Studio + JDK** en la PC de desarrollo (Windows).
- Verificar que se puede compilar un proyecto Android de prueba antes de continuar.

### B2. Envoltorio Capacitor

- Crear un proyecto Capacitor cuyo contenido web (`webDir`) apunte al HTML actual, que sigue siendo la fuente de verdad.
- Agrega al repositorio: `package.json`/`npm`, carpeta `android/`, `capacitor.config`.
- El service worker y el manifest actuales se conservan para el modo PWA.

### B3. Plugin de GPS en segundo plano

- Usar `@capacitor-community/background-geolocation` (gratuito, open source).
- Mantiene un *foreground service* en Android con una notificación persistente ("Caveli está compartiendo tu ubicación"), requisito de Android para rastrear en segundo plano.
- El plugin entrega posiciones a JS aunque la app esté en segundo plano o con la pantalla apagada → se escriben a Firestore con el mismo formato que hoy (`gps/{jornadaId}`).
- Configurar permisos de ubicación en segundo plano en el manifiesto de Android.

### B4. Detección de entorno

- En el código del chofer, decidir la fuente de ubicación con `Capacitor.isNativePlatform()`:
  - **Nativo:** usar el plugin de background geolocation.
  - **Web/PWA:** usar `watchPosition` (Capa A3).
- La escritura a Firestore es común a ambos caminos.

### B5. Distribución

- Compilar un APK firmado e instalarlo directamente en los teléfonos de los choferes (sideload).
- Publicación en Play Store queda como opción futura, fuera del alcance de esta especificación.

## Modelo de datos

**Sin cambios.** Se sigue usando el documento `gps/{jornadaId}` con los campos actuales (`lat`, `lng`, `precision`, `timestamp`, `chofer`, `rastro`). La detección de desactualización (A1) usa el `timestamp` existente.

## Pruebas

- **Capa A1:** simular datos con `timestamp` viejo para verificar los tres estados (verde/amarillo/rojo) en el dashboard.
- **Capa A2/A3:** probar Wake Lock y `watchPosition` en un celular real (pantalla encendida).
- **Capa B:** instalar el APK en un Android real y confirmar que sigue mandando ubicación con la app en segundo plano y la pantalla apagada.

## Entrega por fases

1. **Fase 1 — Capa A:** se entrega y despliega de inmediato sobre el PWA actual. Aporta valor incluso antes de la app nativa (el dashboard deja de engañar y mejora el caso de pantalla encendida).
2. **Fase 2 — Capa B:** empieza con el prerequisito de entorno (B1) y se construye sobre la Capa A ya lista. Las mejoras de la Capa A (detección de desactualización, `watchPosition`) se reutilizan dentro del contenedor nativo.

## Fuera de alcance

- Publicación en Google Play Store.
- Soporte para iOS (los choferes usan Android).
- Plugin de pago (Transistor); se evaluaría solo si el plugin gratuito resulta insuficiente.
- Cambios al modelo de datos o al historial de recorrido (`rastro`).
