# INFORME DE PROYECTO — LOGISTIC-CAV

> **Para quién es este documento:** para que cualquier persona (o una sesión futura de Claude) entienda en 10 minutos en qué estado real está LOGISTIC-CAV, qué falta, por qué quedó pendiente y cómo seguir sin romper lo que los choferes usan a diario.
>
> **Cómo leer las marcas:**
> - *(verificado)* = lo vi directamente en el código, en git o en archivos de esta máquina.
> - *(inferido)* = lo deduzco de lo anterior, pero no lo pude comprobar al 100%.
>
> **Fecha del informe:** 2026-10-07 · **Commit de referencia:** `b84ceba` (rama `worktree-gps-fisico-teltonika`, 2026-09-08).

---

## RESUMEN EN UNA PÁGINA

**Qué es LOGISTIC-CAV.** Una app de reparto para Distribuidora Caveli. El **jefe** la usa como **página web** (panel/dashboard) y los **choferes** como **APK Android** (app de distribución). Guarda todo en Firebase Firestore. Restricción dura de todo el proyecto: **cero costo recurrente** y **no pagar Google Maps**. *(verificado en memoria y código)*

**El cambio grande de estas sesiones: GPS físico.** Se reemplazó el GPS del teléfono del chofer (que fallaba) por un tracker físico **Teltonika FMC920** (IMEI `860693084789156`) instalado en la "Camioneta Caveli" (chofer habitual: Francisco Muñoz). El recorrido es: **FMC920 → Traccar (en una VM gratis) → puente Node.js → Firestore → mapa de la app**. *(verificado)*

**Lo más importante que CAMBIÓ respecto de lo que sabías al 8-sep:**

1. **La infraestructura NO es solo "prueba local": está montada y funcionando en producción.** *(verificado en memoria)* La VM de Oracle existe desde el 31-ago, Traccar 6.15.3 corre como servicio, el puente corre como servicio, el FMC920 ya fue configurado y **reporta en vivo**, y el puente **ya está escribiendo** en Firestore. El pipeline físico Teltonika→Traccar→puente→Firestore se verificó completo el 8-sep.
2. **El mapa NO se migró a Leaflet.** Sigue en Google Maps y, de hecho, el último commit (8-sep) *agregó* una capa de tráfico de Google Maps. La migración a Leaflet sigue **sin empezar y pendiente de tu confirmación**. *(verificado)*
3. **No se publicó nada nuevo.** `origin/main` y `origin/master` siguen con código de **junio de 2026**. La app en vivo corre código viejo. La rama del GPS nunca se mergeó ni se subió. *(verificado)*
4. **No hubo trabajo material después del 8-sep.** El último commit es del 8-sep; no hay cambios ni notas posteriores. *(verificado)*

**El único bloqueo real para "ver el GPS en la app" es publicar el frontend.** Todo lo técnico está hecho y probado. Falta una decisión tuya sobre **cómo publicar sin romper la app de los choferes**, porque el repositorio está enredado (ver sección 6).

**Las 3 preguntas que más urgen** (detalle en sección 9):
- ¿Qué rama sirve GitHub Pages hoy (`main` o `master`)?
- ¿Confirmás migrar el mapa a Leaflet (gratis) antes de publicar?
- ¿La VM sigue encendida y la IP sigue siendo `148.116.110.159`? (la IP es "ephemeral", puede cambiar)

---

## 1. ESTADO ACTUAL VERIFICADO

- **Fecha:** 2026-10-07. **Commit de referencia:** `b84ceba`, rama `worktree-gps-fisico-teltonika`, fechado 2026-09-08. *(verificado)*
- **El código del GPS físico está completo, commiteado y con tests que pasan** (módulos `jornada-id.js`, `puente-gps/*`, cambios en `dashboard.html` y `distribucion-app.html`). *(verificado: los 15 "tasks" del plan tienen su commit correspondiente)*
- **La infraestructura física está desplegada y funcionando** *(verificado en la memoria local de Claude, sesión `2894b48f`, no re-comprobado por SSH en esta sesión):*
  - VM Oracle Cloud creada el 31-ago (Valparaíso, ARM Ampere, Ubuntu 22.04, IP `148.116.110.159`).
  - Traccar **6.15.3** corriendo como servicio systemd, panel en `http://148.116.110.159:8082`.
  - Puente Node.js corriendo como servicio systemd en `/opt/puente-gps`, ciclo "OK" cada 15s.
  - FMC920 configurado, apuntando a `148.116.110.159:5027`, **reportando en vivo** (device "Camioneta Caveli", online, posición real en zona Valparaíso/Limache, con ignición/movimiento/satélites).
  - El puente **escribe correctamente** en `vehiculos/860693084789156.posicionActual` y en `gps/{jornadaId}` cuando hay turno.
  - El 8-sep, con una **vista previa local** del frontend nuevo, se asignó la camioneta a Francisco Muñoz y la camioneta **apareció en el mapa del dashboard**. O sea: el frontend nuevo funciona de punta a punta; solo falta publicarlo.
- **Reglas de Firestore:** ya permiten `vehiculos/{imei}` y están **totalmente abiertas** (`allow read, write: if true`) para `jornadas`, `gps` y `vehiculos`. *(verificado en memoria; las reglas viven en la consola de Firebase, no en el repo)*
- **Lo que NO está hecho:** publicar el frontend (web), rearmar el APK, migrar el mapa a Leaflet. *(verificado)*

---

## 2. ARQUITECTURA Y DÓNDE VIVE CADA PIEZA

```
  [FMC920 en la camioneta]
        │  protocolo Teltonika Codec8/8E, TCP
        ▼  puerto 5027
  [Traccar 6.15.3]            ← VM Oracle Cloud (148.116.110.159), servicio systemd "traccar"
        │  API REST (localhost:8082), usuario "puente@caveli.local" (solo lectura)
        ▼  cada 15 s
  [puente-gps (Node.js)]      ← MISMA VM, /opt/puente-gps, servicio systemd "puente-gps"
        │  Firebase Admin SDK (se salta las reglas de Firestore)
        ▼
  [Firestore]                 ← proyecto Firebase "logistic-cav"
        │   • vehiculos/{imei}.posicionActual   (SIEMPRE)
        │   • gps/{jornadaId}                    (SOLO si hay turno hoy con ese vehículo)
        ▼
  [App LOGISTIC-CAV]          ← dashboard.html (jefe, web) + distribucion-app.html (chofer, APK)
```

**Piezas y dónde viven** *(verificado)*:

| Pieza | Dónde vive | Notas |
|---|---|---|
| FMC920 (hardware) | En la camioneta | IMEI `860693084789156`. Apunta a `148.116.110.159:5027`. |
| Traccar | VM Oracle, `/opt/traccar`, servicio `traccar` | Panel en `:8082`. Base de datos H2 embebida (sin MySQL). |
| Puente Node.js | VM Oracle, `/opt/puente-gps`, servicio `puente-gps` | Código en `puente-gps/` del repo. Lee Traccar en `localhost:8082`. |
| Credencial Firebase | VM Oracle, `/opt/puente-gps/service-account.json` | **Nunca en el repo.** Da acceso total a Firestore. |
| Frontend web | Repo (GitHub), servido por GitHub Pages | `dashboard.html`, `distribucion-app.html`, etc. |
| APK Android | Capacitor (`android/`, `capacitor.config.json`) | Se arma en la máquina Windows de Fabián. |

**Modelo de datos clave** *(verificado en el código del puente)*:
- `vehiculos/{imei}`: `{imei, nombre, activo, inmovilizadorDisponible, posicionActual, ultimaActualizacion}`. `posicionActual` trae `lat, lng, precision, timestamp, ignition, motion, power, battery, batteryLevel, odometer, alarm, combustible (null), sensores{...}`.
- `gps/{jornadaId}`: mismo formato que el GPS del teléfono + `fuenteGps: 'fisico'`, `vehiculoImei`, y los sensores arriba. `jornadaId` = `{fecha}-{slugChofer}`. El `rastro[]` sigue siendo solo `{lat,lng,ts}` (para no pasar el límite de 1MB por documento).
- **Decisión técnica central:** el `timestamp` de `gps/{jornadaId}` usa el **fixTime de Traccar** (la hora real del GPS), no la hora en que el puente escribe. Así `revisarFrescuraGps()` del dashboard detecta "señal muerta" de verdad. *(verificado en `puente-gps/src/firestoreWriter.js:19` → `timestamp: datos.timestamp || punto.ts`; commit `32279c4`)*

---

## 3. TRABAJO PENDIENTE (de TODAS las sesiones)

### 3.1 Publicar el frontend web — **BLOQUEO PRINCIPAL**
- **Qué es:** subir el código nuevo (selector de vehículos, gating del GPS del teléfono, etc.) a la app que está en vivo.
- **Estado:** *terminado pero sin publicar.* El código funciona end-to-end; nunca se mergeó ni se subió. *(verificado)*
- **Por qué quedó pendiente:** el repositorio está **enredado y es riesgoso** publicar. *(verificado en memoria `gps-fisico-deploy-pendiente`)* Tres razones concretas: (1) `origin/main` y `origin/master` **no comparten ancestro** → no hay merge normal posible; (2) **no se sabe qué rama sirve GitHub Pages** (dato que falta de tu lado); (3) publicar significa empujar **decenas de commits** de golpe a la app que los choferes usan a diario → decisión tuya de **no hacer big-bang sin aprobación**.
- **Qué falta para cerrarlo:** decidir la estrategia de publicación (ver sección 6), probarla en un momento tranquilo, y hacerla **junto con el APK**.

### 3.2 Rearmar y distribuir el APK
- **Qué es:** reconstruir la app Android de los choferes con el código nuevo (`npm run copy-web && npx cap sync` + `gradlew assembleDebug`) y que los choferes la instalen.
- **Estado:** *sin empezar.* *(verificado: no hay rastro de un APK nuevo)*
- **Por qué quedó pendiente:** depende de publicar el frontend y **debe salir junto con la web**. Si solo se actualiza el panel del jefe y el teléfono del chofer sigue con la app vieja, el GPS del teléfono y el físico **escribirían los dos** en `gps/{jornadaId}` y el marcador "pelearía". El gating de `distribucion-app.html` evita esto, pero solo si el APK lo tiene. *(verificado en memoria y en el plan, Task 9)*
- **Qué falta:** armar el APK en la máquina Windows (el toolchain ya está configurado *(inferido en memoria)*) y repartirlo a los choferes.

### 3.3 Migrar el mapa a OpenStreetMap + Leaflet
- **Qué es:** cambiar el motor de mapas de Google Maps a Leaflet (gratis, sin tarjeta, sin marca de agua).
- **Estado:** *sin empezar.* *(verificado: `dashboard.html:280` sigue cargando Google Maps)*
- **Por qué quedó pendiente:** **bloqueado por tu confirmación.** La prueba gratis de Google Cloud venció → el mapa sale degradado con marca de agua "For development purposes only", en el sitio real **y** en local. Decidiste **no poner tarjeta**. La recomendación fue migrar a Leaflet, pero quedó esperando tu "sí". *(verificado en memoria)*
- **Tensión a resolver:** el último commit (`b84ceba`, 8-sep) **agregó una capa de tráfico de Google Maps** (`dashboard.html:680`), que profundiza la dependencia de Google Maps. Si migrás a Leaflet, hay que decidir qué pasa con esa capa de tráfico (Leaflet no la trae gratis igual). *(verificado — ver pregunta en sección 9)*
- **Qué falta:** tu confirmación, y luego reescribir en `dashboard.html` el init del mapa, el marcador del chofer, el polyline del rastro, el `panTo` y los marcadores de entrega a sus equivalentes Leaflet (+ cargar Leaflet por CDN).

### 3.4 Límite de escrituras de Firestore (plan gratis)
- **Qué es:** el plan gratis de Firestore permite ~20.000 escrituras/día. Con 1 vehículo con turno son ~11.500/día (2 escrituras por ciclo × ~5.760 ciclos). *(verificado — cálculo en memoria)*
- **Estado:** *ok con 1 vehículo; a medias como riesgo.* Con **2 o más vehículos se excede.**
- **Por qué está pendiente:** es consecuencia directa de la restricción "cero costo recurrente" (no pasar al plan Blaze de pago). *(verificado)*
- **Qué falta:** vigilarlo; si crece la flota, subir el intervalo del puente (p. ej. de 15s a 30s) o combinar las dos escrituras en una. *(inferido)*

### 3.5 Seguridad
- **Qué es:** tres frentes: (a) reglas de Firestore totalmente abiertas (`if true`, sin autenticación); (b) la clave del panel Traccar quedó débil; (c) la key de Google Maps está pública en el HTML.
- **Estado:** *pendiente, por decisión de dejarlo para después.* *(verificado en memoria)*
  - (a) Reglas abiertas: exposición **preexistente** (ya era así antes del GPS). Se decidió reforzarlo "algún día, como proyecto aparte".
  - (b) Clave del panel Traccar: el 1-sep se reseteó a una clave **débil y provisoria** (vive en la memoria local y en la VM, **no en el repo**); quedó anotado que **deberías cambiarla** y no hay confirmación de que lo hayas hecho.
  - (c) Key de Maps `AIza…KOs` visible en `dashboard.html:280`: es una key de navegador (por diseño queda a la vista), pero conviene **restringirla por dominio** si algún día activás billing. *(verificado)*
- **Qué falta:** cambiar la clave de Traccar; decidir si/ cuándo cerrar las reglas de Firestore con autenticación; restringir o rotar la key de Maps.

### 3.6 Sensores del FMC920: solo captura, sin análisis
- **Qué es:** el puente ya **guarda** todos los sensores de fábrica (choque, remolque, manejo brusco, ignición, pánico, sabotaje, exceso de velocidad, ralentí, geocercas) en el campo `sensores`. *(verificado)*
- **Estado:** *a medias por diseño.* La Fase 1 es **solo capturar y guardar**; no hay ninguna pantalla, gráfico ni alerta que los muestre.
- **Por qué quedó pendiente:** **decisión de alcance** explícita del plan ("sin dashboard ni análisis en esta fase"). *(verificado en el plan)*
- **Qué falta:** una fase futura que lea esos sensores y los muestre/alerte. Además, verificar los nombres reales de los AVL IDs de Teltonika contra el dispositivo ya conectado (el código los copia tal cual, así que no se pierde nada, pero habría que mapear los que importen). *(verificado en el plan, decisión técnica #1)*

### 3.7 Combustible real (OBDII) — fase futura
- **Qué es:** medir combustible con un adaptador OBDII Bluetooth.
- **Estado:** *sin empezar (reservado).* El campo `sensores.combustible` / `combustible` ya existe en `null` para no migrar después. *(verificado)*
- **Por qué quedó pendiente:** el sensor **no está instalado**; se decidió dejarlo para una fase futura separada. *(verificado)*
- **Qué falta:** comprar el adaptador, emparejarlo por Bluetooth en el Configurator, habilitar los AVL IDs de combustible en Traccar, y cambiar una línea en `mapPosition.js` para dejar de forzar `combustible: null`.

### 3.8 Migrar Traccar a hardware propio en el local — fase futura
- **Qué es:** mover Traccar de la VM de Oracle a un equipo propio en el local de Caveli.
- **Estado:** *sin empezar (visión futura).* *(inferido de memoria y plan: "temporal, luego migra a hardware propio — mismo software")*
- **Por qué quedó pendiente:** la VM gratis cubre el presente; es una mejora futura, no un bloqueo.
- **Qué falta:** decidir el hardware y repetir la instalación de Traccar + puente ahí. (El software es el mismo, solo cambia dónde vive.)

---

## 4. HACIA DÓNDE APUNTA EL PROYECTO

- **Objetivo:** que Caveli reparta de forma más controlada y barata. *(inferido)*
  - El **jefe** ve en la **web** (dashboard) dónde está el camión, el estado de las entregas y ahora la posición del GPS físico.
  - Los **choferes** usan el **APK** para su ruta, entregas y devoluciones.
- **Visión que se deduce de los planes** *(inferido de planes y memoria)*:
  - GPS físico confiable que **reemplaza** al del teléfono (ya logrado técnicamente).
  - Capturar **todos** los sensores del camión hoy, para **analizarlos y alertar** más adelante (choque, manejo brusco, pánico, etc.).
  - **Combustible real** por OBDII como siguiente gran dato.
  - **Más vehículos** en el futuro (el modelo `vehiculos/{imei}` y el selector por chofer ya lo contemplan).
  - Mudar Traccar a **hardware propio** en el local cuando convenga.
- **Restricciones fijas** *(verificado)*:
  - **Cero costo recurrente** (por eso: nada de Cloud Functions / plan Blaze, VM "Always Free", Firestore gratis).
  - **No pagar Google Maps** (por eso la propuesta de Leaflet).

---

## 5. QUÉ FALTA PARA DARLO POR TERMINADO

Ordenado por dependencias. "Terminado" = definición concreta por etapa. Esfuerzo relativo: 🟢 chico · 🟡 mediano · 🔴 grande.

### Imprescindible (para que el GPS físico se vea en la app real)

1. **Decidir estrategia de publicación** 🟢 — *depende de vos.*
   - *Terminado cuando:* sabés qué rama sirve Pages y elegiste el camino (ver sección 6).
   - *Riesgo/decisión tuya:* sí. Es el gate de todo lo demás.

2. **Confirmar el mapa (Leaflet sí/no)** 🟡 — *depende de vos + algo de código.*
   - *Terminado cuando:* el mapa carga sin marca de agua ni depender de Google billing.
   - *Decisión tuya:* sí (confirmar Leaflet y qué hacer con la capa de tráfico).

3. **Publicar web + APK juntos** 🔴 — *depende de 1 y 2.*
   - *Terminado cuando:* el dashboard en vivo muestra el GPS físico, el APK nuevo está en los teléfonos de los choferes, y el GPS del teléfono **no** compite con el físico.
   - *Riesgo:* alto si se hace a lo "big-bang" o en plena repartición. Hacerlo en momento tranquilo y con respaldo.

4. **Operación del día a día** 🟢 — *recordatorio, no código.*
   - *Terminado cuando:* el jefe sabe que cada día debe **asignar el vehículo (IMEI) al chofer** en el selector para que aparezca en el mapa.

### Deseable (mejora, no bloquea)

5. **Seguridad** 🟡 — cambiar clave de Traccar, restringir key de Maps, y (algún día) cerrar reglas de Firestore con autenticación.
6. **Vigilar el límite de Firestore** 🟢 — solo si sumás vehículos.
7. **Análisis de sensores** 🔴 — pantallas/alertas de choque, manejo brusco, pánico.
8. **Combustible OBDII** 🟡 — comprar e instalar adaptador + 1 línea de código.
9. **Traccar en hardware propio** 🟡 — cuando convenga dejar la VM de Oracle.

**Riesgos transversales a vigilar** *(inferido)*:
- La **IP de la VM es "ephemeral"**: si la VM se apaga/reinicia, la IP podría cambiar y el FMC920 (que la tiene fija) dejaría de reportar. Conviene pasarla a IP reservada/estática.
- Oracle puede **reclamar** instancias "Always Free" que detecta ociosas; una VM con GPS conectado normalmente no cae ahí, pero vale revisarlo.

---

## 6. MAPA DE RAMAS Y PUBLICACIÓN

**Qué contiene cada rama** *(verificado)*:

| Rama | Último commit | Qué es |
|---|---|---|
| `origin/main` | 2026-06-20 (`7895468`) | Snapshots subidos **a mano por la web** ("Add files via upload", "Version 2.0"). Probablemente lo que sirve GitHub Pages. `origin/HEAD` apunta aquí. |
| `origin/master` | 2026-06-20 (`675122b`) | Historial de desarrollo real con git. |
| `worktree-gps-fisico-teltonika` | 2026-09-08 (`b84ceba`) | **La versión buena y coherente con TODO**: multi-chofer, devoluciones, monitoreo, Capacitor/GPS background, GPS confiable y GPS físico. |
| `feat/rastreo-gps-capa-b` | 2026-07-09 (`0255c90`) | Rama "padre" del GPS físico (Capacitor + monitoreo). Es la que está activa en el worktree principal `D:/LOGISTIC-CAV`. |
| `feat/devoluciones-ruta` | 2026-06-22 (`9b4b1dc`) | Rama intermedia de features (devoluciones + GPS Capa A). |

**Distancias** *(verificado)*:
- `origin/main` y `origin/master` **no comparten ancestro** (son historias no relacionadas). → **no hay merge normal entre ellas.**
- La rama del GPS contiene **todo `origin/master`** (es su ancestro) **+ 33 commits propios**. Respecto de `origin/main`: **67 adelante / 4 atrás** (esos 4 son los snapshots manuales de la web). *(Nota: al 8-sep eran 32/66; el +1 es el commit de la capa de tráfico `b84ceba`.)*

**Qué está en producción** *(verificado)*: la app en vivo es `https://caveli-ch.github.io/Logistic-CAV/` y corre código **de junio** (el `dashboard.html` en vivo es idéntico en `main` y `master` y no tiene ninguno de los cambios nuevos).

**Camino recomendado para publicar sin romper a los choferes** *(inferido)*:
1. **Averiguar qué rama sirve Pages** (GitHub → Settings → Pages → Source/Branch). Es el dato que falta.
2. Como no hay merge normal posible, la vía limpia es **llevar los archivos web actualizados de la rama del GPS a la rama que sirve Pages** mediante un **commit de snapshot** (copiar los archivos, commitear, subir) — tal como se hizo antes para subir versiones. Alternativa: **reconfigurar Pages** para que sirva desde `master` (o desde la rama/carpeta que elijas) y unificar el historial.
3. Hacerlo en un **momento tranquilo** (no en plena repartición), con la posibilidad de volver atrás.
4. **Rearmar el APK en el mismo acto** y repartirlo, para que web y teléfono queden sincronizados.
5. Avisar al jefe que debe **asignar el vehículo al chofer** cada día en el nuevo selector.

> **Importante:** este informe **no** ejecuta ningún merge ni push. Eso requiere tu aprobación explícita (ver sección C del pedido original).

---

## 7. DECISIONES TOMADAS Y SU PORQUÉ

*(todo verificado en plan + memoria)*

| Decisión | Por qué |
|---|---|
| **Cero costo recurrente** | No gastar en infraestructura. Todo en recursos gratis (VM Always Free, Firestore Spark, sin billing). |
| **Sin Cloud Functions** | Las Functions con salida a internet obligan al plan Blaze (de pago). El puente corre en la VM y usa el Admin SDK, evitando eso. |
| **Traccar en VM de Oracle (temporal)** | Decodifica el protocolo Teltonika gratis y es open source. Se descartó SaaS de terceros. Más adelante migra a hardware propio. |
| **Doble escritura** (`vehiculos/{imei}` siempre + `gps/{jornadaId}` solo con turno) | El vehículo debe poder monitorearse siempre; `gps/{jornadaId}` solo cuando hay un turno, para que el dashboard lo lea sin cambios. |
| **GPS teléfono y físico no coexisten** | Si ambos escriben `gps/{jornadaId}`, el marcador "pelea". Si el chofer tiene `vehiculoImei` hoy, el teléfono no envía. |
| **`timestamp` = fixTime de Traccar** | Para que `revisarFrescuraGps()` detecte señal muerta de verdad (si usara la hora de escritura, siempre parecería "fresco"). Es el núcleo del "monitoreo honesto". |
| **Leaflet en lugar de Google Maps** (propuesta, pendiente confirmar) | Google Maps venció la prueba gratis y exige tarjeta; decidiste no pagar. Leaflet + OpenStreetMap es gratis para siempre, sin key ni marca de agua. |
| **Sensores: solo capturar en Fase 1** | Guardar todo ahora para no migrar el esquema después; el análisis/visualización es una fase futura. |

---

## 8. OPERACIÓN Y DIAGNÓSTICO

> Todo esto se corre **por SSH en la VM**. No contiene secretos. *(verificado en memoria; comandos estándar de systemd)*

**Conectarse a la VM** *(la IP puede haber cambiado — ver sección 9)*:
```
ssh -i <ruta-a-tu-llave.key> ubuntu@148.116.110.159
```

**Ver estado de los servicios:**
```
sudo systemctl status traccar        # el servidor que habla con el GPS
sudo systemctl status puente-gps     # el script que escribe en Firestore
```

**Ver los logs en vivo:**
```
sudo journalctl -u puente-gps -f     # debería mostrar "Ciclo OK" cada 15s
sudo journalctl -u traccar -f
```

**Reiniciar si algo se traba:**
```
sudo systemctl restart traccar
sudo systemctl restart puente-gps
```

**Comprobar que los puertos escuchan:**
```
sudo ss -tlnp | grep 5027    # puerto del GPS Teltonika
sudo ss -tlnp | grep 8082    # panel web de Traccar
```

**Notas de operación** *(verificado en memoria)*:
- El firewall de la VM usa **iptables directo, NO ufw** (se desvió del plan a propósito). Las reglas de los puertos 5027 y 8082 están insertadas antes del REJECT y guardadas con `netfilter-persistent`.
- El puente autentica en Traccar con el usuario **`puente@caveli.local`** (NO admin). Como no es admin, **solo ve los dispositivos que estén vinculados a él**. Si agregás un vehículo nuevo, hay que **vincular ese device al usuario `puente@caveli.local`** en Traccar, o el puente no lo verá.
- La credencial de Firebase vive en `/opt/puente-gps/service-account.json` (chmod 600). **Nunca en el repo.**
- Panel de Traccar: `http://148.116.110.159:8082`. El admin es la cuenta registrada con tu email. (La clave y cómo resetearla viven en la memoria local, no acá.)

**Panel del puente desde el repo:** el código del puente se copió a la VM **por `scp`** desde el worktree local (la rama no está pusheada). Para actualizar el puente en el futuro: re-copiar por `scp`, o mergear+push+pull cuando el repo esté ordenado.

---

## 9. PREGUNTAS PARA FABIÁN

> ### ⭐ PARA LA PRÓXIMA SESIÓN DE CLAUDE: estas 3 preguntas bloquean todo
>
> Fabián quiere que le ayudes a **responder estas 3 en detalle** antes de avanzar. Son el gate de la publicación del GPS físico. Para cada una te dejo **dónde/cómo encontrar la respuesta** para que no se la tengas que adivinar:
>
> 1. **¿Qué rama sirve GitHub Pages hoy (`main` o `master`)?**
>    - Cómo averiguarlo: GitHub → repo `caveli-ch/Logistic-CAV` → **Settings → Pages → "Build and deployment" → Source/Branch**. Guialo clic por clic si hace falta. Alternativa: revisar si hay un workflow en `.github/workflows/` (no lo había al 2026-10-07) o un `CNAME`.
>    - Por qué importa: `origin/main` y `origin/master` **no comparten ancestro** (sección 6), así que la rama que sirve Pages define si publicamos con un commit de snapshot o reconfigurando Pages.
>
> 2. **¿Migramos el mapa a Leaflet? ¿Y qué hacemos con la capa de tráfico de Google Maps?**
>    - Contexto para decidir con él: Google Maps está degradado (venció la prueba gratis) y Fabián **no quiere poner tarjeta**. Leaflet + OpenStreetMap es gratis y sin key. Pero el commit `b84ceba` (8-sep) agregó `new google.maps.TrafficLayer()` en `dashboard.html:680`, y Leaflet no trae tráfico gratis equivalente.
>    - Ayudalo a elegir: (a) Leaflet sin tráfico; (b) Leaflet + buscar fuente de tráfico alternativa; (c) quedarse en Google Maps degradado. Explicá el costo/beneficio de cada una en simple.
>
> 3. **¿La VM sigue encendida y la IP sigue siendo `148.116.110.159`?**
>    - Cómo verificarlo (pedí permiso antes de tocar la VM): panel de Oracle Cloud → Compute → Instances → `caveli-traccar` (estado "Running" y la IP pública que figura). O desde su PC: abrir `http://148.116.110.159:8082` (si carga el panel de Traccar, la VM está viva y la IP no cambió). O `ssh ubuntu@148.116.110.159`.
>    - Riesgo a resolver con él: la IP es **"ephemeral"**; conviene pasarla a **IP reservada** (gratis mientras esté asignada) para que el FMC920 no deje de reportar si la VM reinicia.

Lo que **no pude confirmar** desde el código/git/archivos y necesito de tu lado (las 3 de arriba más estas):

1. **GitHub Pages:** ¿qué rama/carpeta sirve la app en vivo? (GitHub → Settings → Pages → Source/Branch). Es el dato que **gatea toda la publicación**.
2. **Mapa:** ¿confirmás migrar a **Leaflet** (gratis)? Y si sí: la capa de **tráfico** de Google Maps que se agregó el 8-sep, ¿la mantenemos (Leaflet no la trae gratis), la quitamos, o buscamos una alternativa? — *motivo por el que quedó pendiente: esperaba tu confirmación.*
3. **VM:** ¿la VM sigue encendida y la IP sigue siendo `148.116.110.159`? La IP es "ephemeral" y podría haber cambiado. ¿Querés que la pase a **IP reservada** (gratis mientras esté asignada) para que el FMC920 no deje de reportar si la VM reinicia? *(requiere tu permiso para tocar la VM)*
4. **FMC920 / Traccar:** ¿seguís viendo la camioneta "online" y moviéndose en el panel de Traccar (`:8082`)? ¿La clave del panel ya la cambiaste por una fuerte? *(quedó una provisoria y débil el 1-sep)*
5. **Flota:** ¿hay o habrá **más vehículos o choferes** pronto? (Afecta el límite de escrituras de Firestore.)
6. **Firestore:** ¿notaste algún día en que el GPS dejara de guardarse? (Sería señal de haber tocado el tope de 20.000 escrituras.)
7. **APK:** ¿quién tiene instalado el APK hoy y en qué versión? ¿Los choferes usan el APK o la web?
8. **Trabajo posterior al 8-sep:** no encontré ningún cambio en git ni en las notas después del 8-sep (la sesión se reabrió el 21-sep con poca actividad y hoy). ¿Hiciste algo fuera de esta máquina que yo no pueda ver?

**Motivos no documentados:** no encontré ninguno sin explicar — todos los pendientes tienen una causa registrada (bloqueo tuyo, costo, riesgo de publicar, o decisión de alcance).

---

*Fin del informe. Este documento es de solo lectura/diagnóstico: no ejecuta merges, pushes ni cambios en la VM, Firestore o billing. Esas acciones requieren tu aprobación explícita.*
