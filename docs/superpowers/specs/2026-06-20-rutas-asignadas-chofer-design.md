# Rutas asignadas por chofer (auto-sugerencia al facturar) — Spec de diseño

**Fecha:** 2026-06-20
**Estado:** Aprobado para planificar
**Sistemas:** CAVELI PRO (Supabase) + LOGISTIC-CAV (Firebase)
**Relacionado:** `2026-06-14-integracion-logistica.md` (CAVELI) — esta feature extiende ese puente.

## Problema

Hoy, al facturar una venta de reparto en CAVELI, el usuario elige **a mano** a qué
chofer mandar el pedido (modal "enviar a ruta"). CAVELI ya tiene cada cliente
asignado a una **ruta** (`clientes.ruta_id` → tabla `rutas`), pero esa información no
se usa para enrutar. Se quiere que el sistema **conozca las rutas** y, en base a la
ruta del cliente, **sugiera automáticamente** el chofer correcto al facturar.

El mapeo automático ruta→chofer estaba marcado como fuera de alcance en la
integración original; esta spec lo incorpora.

## Decisiones (tomadas con el usuario)

1. **Modelo:** *ruta → chofer*. Se mantienen los choferes como unidad de
   organización de logística; cada ruta se asocia a un chofer. NO se reemplazan los
   choferes por rutas.
2. **Quién asigna:** el jefe, **en el dashboard de LOGISTIC-CAV**, al armar el día,
   elige qué rutas cubre cada chofer (puede cambiar día a día).
3. **Dónde se usa:** en **CAVELI al facturar**. La sugerencia es **preselección, no
   forzada**: el usuario confirma o cambia el chofer.
4. **Cómo LOGISTIC-CAV conoce las rutas:** CAVELI **espeja** el catálogo de rutas a
   Firebase. LOGISTIC-CAV permanece **solo-Firebase** (no agrega SDK de Supabase, ni
   anon key, ni cambios de RLS). Coincide con la arquitectura de la integración
   ("puente directo": CAVELI toca ambos backends, logística no se modifica salvo UI).

## Arquitectura y flujo

```
CAVELI (carga app)
  cargarRutas()  ──lee──▶  Supabase tabla `rutas`
        │
        └──escribe──▶  Firebase  config/rutas = { rutas:[{id,numero,descripcion}], actualizado }

LOGISTIC-CAV dashboard (jefe arma el día)
  lee  config/rutas
  jefe asigna rutas a cada chofer
  escribe  jornadas/registro-{fecha}.choferes[].rutas = [ruta_id,...]

CAVELI (facturar venta de reparto)
  abrirModalEnviarRuta(pedido)
  lee  jornadas/registro-{fecha} (choferes + sus rutas)
  busca chofer cuyo rutas[] incluya cliente.ruta_id
  ├─ match  → preselecciona ese chofer, muestra "Sugerido por Ruta X"
  └─ sin match → sin preselección (elección manual, como hoy)
  usuario confirma → Puente 1 existente envía a jornadas/{fecha}-{slugChofer}
```

## Componentes y archivos

### CAVELI — `logistica.js`
- **`lgPublicarRutas(rutas)`** (nueva): escribe `config/rutas` en Firestore con
  `{ rutas:[{id,numero,descripcion}], actualizado:<ISO> }`. Idempotente (`set`).
- **`lgChoferesDelDia(fecha)`** (extender): además de `{nombre,slug,idx}` devuelve
  `rutas:[ruta_id]` por chofer (campo nuevo del registro; ausente ⇒ `[]`).

### CAVELI — `app.js`
- **`cargarRutas()`** (~línea 679): tras cargar `rutas` desde Supabase, llamar
  `lgPublicarRutas(rutas)`. No bloquea la carga si Firebase falla (try/catch, log).
- **`abrirModalEnviarRuta(pedidoId, despacho)`** (~línea 1542): obtener el `ruta_id`
  del cliente del pedido; buscar entre los choferes del día el que cubra esa ruta y
  **preseleccionar** ese valor en `#envio-ruta-chofer`; mostrar aviso
  "Sugerido por Ruta {numero}". Sin match ⇒ comportamiento actual.

### LOGISTIC-CAV — `dashboard.html`
- Al iniciar / al abrir configuración del día: leer `config/rutas` de Firestore.
- **UI de asignación rutas↔chofer** en el panel de configuración de choferes: por cada
  chofer, un selector múltiple de rutas que cubre hoy (etiqueta "Ruta {numero} —
  {descripcion}", valor = `ruta_id`).
- Al guardar choferes (`guardarChoferes()` / publicación del registro): incluir
  `rutas:[ruta_id]` por chofer en `jornadas/registro-{fecha}`.

## Modelo de datos

**`config/rutas`** (Firestore, doc único):
```json
{ "rutas": [ { "id": 1, "numero": 1, "descripcion": "Centro" } ],
  "actualizado": "2026-06-20T12:00:00.000Z" }
```

**`jornadas/registro-{fecha}`** (extensión):
```json
{ "choferes": [ { "nombre": "Juan", "slug": "juan", "idx": 0, "rutas": [1, 3] } ] }
```

- El match se hace por **`ruta_id`** (no por `numero`) para evitar ambigüedad.
- **Una ruta → un solo chofer por día.** La UI del dashboard evita asignar la misma
  ruta a dos choferes (si ocurriera, CAVELI toma el primero y registra un warning).

## Manejo de errores / casos borde

- **`config/rutas` ausente** (CAVELI nunca abrió): el dashboard avisa "Abre CAVELI
  para sincronizar las rutas"; el jefe puede continuar sin asignar (todo manual).
- **Cliente sin `ruta_id`** o `tipo_entrega = fuera_ruta`: sin preselección (manual).
- **Ruta del cliente sin chofer asignado ese día**: sin preselección (manual).
- **Pedido ya enviado** (`enviado_ruta = true`): sin cambios; se respeta el
  anti-doble-envío actual.
- **Firebase no disponible al espejar rutas**: CAVELI loguea y sigue; no rompe el POS.

## Pruebas (manuales — ambas apps son HTML/JS sin suite automatizada)

1. **Espejo de rutas:** abrir CAVELI ⇒ `config/rutas` aparece/actualiza en Firebase.
2. **Asignación:** en el dashboard asignar Ruta 1 → Juan, Ruta 2 → Pedro; recargar ⇒
   persiste en `registro-{fecha}`.
3. **Sugerencia OK:** facturar venta de un cliente de Ruta 1 ⇒ modal preselecciona Juan
   con aviso "Sugerido por Ruta 1".
4. **Cambio manual:** cambiar la sugerencia a otro chofer ⇒ el pedido va al elegido.
5. **Sin ruta:** cliente sin `ruta_id` ⇒ sin preselección, elección manual.
6. **Sin asignación:** Ruta del cliente sin chofer ese día ⇒ sin preselección.

## Fuera de alcance (por ahora)

- Dividir una misma ruta entre varios choferes.
- Sugerencia **forzada** (sin opción a cambiar): por ahora es solo preselección.
- Reorganizar el dashboard para que la unidad sea la ruta en vez del chofer.
- LOGISTIC-CAV leyendo Supabase directamente (se descartó a favor del espejo a Firebase).
