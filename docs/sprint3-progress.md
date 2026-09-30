# Sprint 3 — Registro de progreso

Registro de decisiones, resultados y traspasos del plan de [`sprint3.md`](../sprint3.md). Cada fase agrega su sección de resultado al final. La fase siguiente empieza leyendo este archivo y verificando los contratos que hereda; no reinterpreta el sprint desde cero.

---

## Línea de base (fase 1)

Relevada el **27 de septiembre de 2026** sobre la rama `dev` en `8909ab0`, con Supabase local (CLI 2.116.0), Node 22.23.2 y pnpm 10.34.5, en WSL2.

### Estado del entorno antes de verificar

Hubo dos problemas del entorno local. No eran regresiones del código:

1. **Faltaba vincular `@restaurant-platform/ui` en `apps/customer`.** El `node_modules` era anterior a la dependencia `ui` de customer. Por eso `pnpm test` fallaba (6 de 141 pruebas) y `typecheck`/`build` también fallaban en customer con `TS2307`. Se resolvió con `pnpm install --frozen-lockfile`, que es lo mismo que hace la CI.
2. **La base local tenía 4 migraciones sin aplicar:** `20260920130000`, `20260920150000`, `20261001000000` y `20261001010000`. Se aplicaron con `pnpm supabase migration up --local`, que conserva los datos.

Queda además un **desvío en la base local, no en el repositorio**: esa base se armó con una versión anterior de `20260920100000_split_authorship.sql`, por eso su dump difiere del snapshot solamente en el comentario de `table_sessions.split_updated_by`. El archivo versionado coincide con `schema.generated.sql`. Un `pnpm supabase db reset` alinea la base, y la CI no se ve afectada porque parte de cero. Esto muestra por qué la regla 5 de `sprint3.md` pide no editar migraciones ya aplicadas.

### Verificación ejecutada

| Comando | Resultado |
|---|---|
| `pnpm test` | 27 archivos, 160 pruebas: **pasan** |
| `pnpm typecheck` (incluye Edge) | **pasa** |
| `pnpm lint` | **pasa** |
| `pnpm build` | **pasa** |
| `pnpm test:sql` | 16 archivos: **pasan**. `employee-accounts.sql` y `pos-employees.sql` no emiten `NOTICE`, pero terminan con código 0 |
| `pnpm test:orders:integration` | 40 verificaciones: **pasan**, sin dejar fixtures |
| `pnpm test:employees:integration` | **pasa** |
| Snapshot contra la base local | Coincide, salvo el comentario descripto arriba |
| Prueba de humo HTTP del simulador (script temporal, no versionado) | 8 verificaciones: **pasan**, con un restaurante propio que se borró al terminar |

La prueba de humo recorrió: QR, `submit-order`, pedido aceptado, cuenta con saldo, `mobile-payment create` (pendiente por el importe de SQL), reintento con el mismo `requestId` (mismo pago), segundo intento bloqueado (`PAYMENT_ALREADY_PENDING`), rechazo simulado (saldo intacto), nuevo intento aprobado (saldo 0, cuenta saldada) y otro usuario anónimo que intenta resolver ese pago (`FORBIDDEN`).

**No se ejecutó:** recorrido visual en navegador, pruebas en dispositivos reales ni ninguna llamada a Mercado Pago. La CI no corrió: se dispara con push a `main`/`master` y con PR, no con push a `dev`.

`jq`, que usa la CI, no está instalado en este entorno. Para correr las suites integradas se tomaron las variables de `supabase status -o json` con Node.

### Qué funciona hoy

| Capacidad | Evidencia automática |
|---|---|
| Ingreso por QR y sesión compartida | `customer-session.sql`; integración 2–3, 17, 23 |
| Pedido QR: validación, snapshot, idempotencia, aceptación interna en la misma transacción | `orders.sql`; integración 4–21, 26; humo |
| Aislamiento entre restaurantes | integración 1, 5–6, 24–25 |
| POS: tablero, avance, reversión y cancelación | integración 22, 29–35; `pos.sql` |
| POS: abrir, continuar, mover y cerrar mesa | `pos-open-session.sql`, `pos.sql`; integración 36–40 |
| Cuenta (`session_bills`: aceptados menos aprobados) | `orders.sql`, `split.sql`; humo |
| División de la cuenta (`none`, `equal`, `percentages`) | `split.sql`, `percentage-payments.sql`, Vitest |
| Cobro presencial/externo registrado desde POS | `payments.sql` |
| Pago móvil con **simulador**: total, partes iguales, porcentaje, ítems | `payments.sql`, `percentage-payments.sql`, `edge.test.ts` (contrato HTTP), `packages/shared/tests/split.test.ts`; humo (total) |
| Medios habilitados por sucursal | `payment-methods.sql` |
| Invitados sin QR | `guest-participants.sql` |
| Pedir cuenta / cobro presencial | `session-requests.sql` |
| Cuentas de empleados y permisos por sucursal | `employees.integration.mjs`, `employee-accounts.sql` |

El simulador **no es Mercado Pago**: `mobile-payment` resuelve con `confirm` solamente si `PAYMENT_SANDBOX_ENABLED=true`, y no hay webhook ni adaptador del proveedor.

### Diferencias con lo que describe `sprint3.md`

- **`reassign_order_items` ya no existe:** `20261001010000_atomic_guest_participant.sql` la eliminó. Ahora `add_guest_participant(p_session_id, p_display_name, p_item_ids)` reasigna en la misma transacción **cualquier** ítem de cualquier pedido de la sesión, sin importar quién lo pidió ni el origen del pedido. La restricción de MI-69 (el comensal no modifica consumo cargado por el restaurante) debe aplicarse sobre esta función en la fase 8.
- **Orden de migraciones:** ya hay varias migraciones con fecha `20261001…`. Toda migración nueva del sprint debe llevar un timestamp **posterior a la última de `supabase/migrations`** (hoy `20261001040000`), aunque la fecha real sea anterior. Dos ramas que toman el mismo número chocan al mergear: conviene mirar la carpeta de `dev` justo antes de crearla.
- **Dependencia de mesa confirmada.** Leen la sucursal a través de `tables`:
  - funciones y vistas: `can_read_session`, `submit_order`, `create_mobile_payment`, `pos_record_payment`, `pos_transition_order`, `pos_close_table_session`, `pos_resolve_session_request`, `request_session_service` y la vista `pos_open_sessions`;
  - corregido en la fase 2: `abandon_order_request` solo bloquea la mesa para ordenar locks (sin mesa, no bloquea nada), y la política de `payment_order_items` no usa `tables`; las dos figuraban acá por error;
  - frontend: `posOrderSelect` y `posSessionSelect` (`tables!inner`), los filtros `.eq('table_sessions.tables.branch_id', …)` de `apps/pos/src/features/pos/api.ts` y las lecturas no opcionales de `order.table_sessions.tables.label` en `OrderHistory`, `OrderTicket` y `CommandBoard`.

  `join_table_session`/`customer_join_table_session`, `pos_open_table_session` y `pos_move_table_session` trabajan con mesas por definición y pueden conservar ese join.
- **`assigned_user_id` cambia en cada operación:** `pos_open_table_session` y `pos_transition_order` lo pisan con `auth.uid()`. Confirma que no sirve como autor del pedido.
- **Reservas de pago:** `create_mobile_payment` solo reserva saldo pendiente en `equal_split`, e ítems en `custom`. En `full` y `percentage_split`, dos participantes pueden iniciar pagos que cubran el mismo saldo. El único bloqueo es un pendiente por participante. `pos_record_payment` tampoco descuenta pendientes móviles.
- **`resolve_mobile_payment` convierte una aprobación en rechazo** si la sesión cerró o el importe supera el saldo. Esto se confirmó en el snapshot. No debe reutilizarse para Mercado Pago (fase 5, punto 6).
- **`orders.local_date` usa una zona fija** (`America/Argentina/Buenos_Aires`) y `branches` no tiene zona horaria.
- **CI:** la typecheck de Edge ya incluye `mobile-payment/handler.ts` y `gateway.ts`; el job de integración solo sirve `submit-order`.
- Lateral, fuera del sprint: `anon` y `authenticated` conservan `TRUNCATE`/`TRIGGER`/`REFERENCES` sobre las tablas públicas (permisos por defecto de Supabase). PostgREST no expone `TRUNCATE`, así que hoy no hay un camino desde el navegador. Queda anotado como endurecimiento pendiente.

---

## Decisiones

Las marcadas **adoptada** se toman como base de las fases siguientes. Las marcadas **a confirmar** permiten avanzar, pero necesitan validación del equipo o del PO: no son requisitos de Jira.

| Tema | Decisión | Estado | Fases |
|---|---|---|---|
| Integración Mercado Pago | Checkout Pro (preferencia y checkout alojado) con credenciales de prueba del proveedor. Sin marketplace ni OAuth. Una cuenta receptora por restaurante, asociada de forma explícita a sus sucursales. | Adoptada | 3–6 |
| Configuración y cobro | Los medios siguen habilitándose por sucursal (`branches.payment_methods`). La credencial del proveedor es por restaurante y nunca global. Se guarda solo en backend, y el panel ve su estado enmascarado. | Adoptada | 2–6 |
| Cuenta sin mesa | `table_sessions` sigue siendo la identidad de cuenta. Se agregan `branch_id` explícito y `kind` (`table`/`takeout`); `table_id` puede ser nulo solo en `takeout`. No se crea una "mesa mostrador". | Adoptada | 2, 9 |
| Cuenta takeout | Sesión privada por compra, abierta por el usuario anónimo del comprador. El QR de mostrador es la entrada al menú, no la llave de la cuenta. Una compra nueva genera otra sesión. | Adoptada | 2, 9 |
| Origen y autor | El origen (`qr`/`pos`) es el canal de entrada. El autor QR es `submitted_by` (participante). El autor POS es la cuenta staff autenticada, con copia de su nombre. Nunca se toma de `assigned_user_id`. | Adoptada | 2, 8 |
| Destino y entrega | Destino: `salón`/`para llevar`, se deriva del tipo de sesión y se guarda en el pedido. Entrega: `mesa`/`autoservicio`, se copia de la política vigente al confirmar. Son dos campos y ninguno reemplaza al otro. | Adoptada | 9, 12 |
| Sectores | Los sectores de salón (`floor_sections`) configuran el autoservicio. Los sectores de preparación son una tabla nueva, para productos y capacidad. Sin relación implícita entre ellos. | Adoptada | 10–12 |
| Número de retiro | Entero único por sucursal y `local_date`, asignado en servidor al crear el pedido y devuelto igual en los reintentos. Usa la misma zona fija que `orders.local_date`; la zona horaria por sucursal queda fuera del sprint. | Adoptada | 9, 12 |
| Rellamado | Umbral configurable por sucursal, 2 minutos por defecto. Se distingue primera llamada de rellamado. | **A confirmar** con el PO (Jira dice "X minutos") | 12 |
| Preparación parcial | La capacidad se libera por sector. El pedido queda listo cuando terminan todos sus sectores. Solo cancelación global mientras no haya una política de cuenta para cancelar una parte. | Adoptada | 11–12 |
| Destinatarios de avisos | Participantes con cuenta (`user_id` no nulo) de la sesión del pedido. En takeout eso es solo el comprador; en mesa, quienes están en esa cuenta, que ya ven sus pedidos por RLS. Nunca toda la sucursal. Una comanda POS sin comensal conectado se opera solo en POS. | Adoptada | 12–14 |
| Permiso de carga POS | Un permiso nuevo `orders.create`; `orders.read` no habilita crear pedidos. Roles propuestos: `owner`, `manager`, `supervisor`, `staff`, `waiter`. | **A confirmar** en fase 7 | 7–8 |
| Dispositivos objetivo | No hay inventario. El equipo debe listar los dispositivos reales de la demo (modelo, sistema, navegador, si se instala como app). | **Pendiente** del equipo | 13–15 |

---

## Diccionario

| Término | Significado en el código |
|---|---|
| **Cuenta / sesión** | Una fila de `table_sessions`: agrupa pedidos, participantes y pagos de una mesa o de una compra takeout. `sessionId` es su identidad en todos los contratos. |
| **Pedido / comanda** | Una fila de `orders` con sus `order_items` y snapshots. Un mismo motor para QR, POS y takeout. |
| **Origen** | Canal por el que entró el pedido: `qr` o `pos`. Puede crecer con otros canales (MI-70); no incluye adaptadores externos en este sprint. |
| **Autor** | Quien creó el pedido: participante QR (`submitted_by`) o cuenta staff. No cambia después. |
| **Responsable actual** | `table_sessions.assigned_user_id`: el último operador POS que tocó la mesa. No es el autor. |
| **Destino** | `salón` o `para llevar`: adónde va el consumo. |
| **Modalidad de entrega** | `mesa` o `autoservicio`: cómo llega el pedido al comensal. |
| **Sector de salón** | `floor_sections`: zona física del plano; configura el autoservicio. |
| **Sector de preparación** | Cocina, barra, etc.: dónde se prepara un producto; define la capacidad. Todavía no existe. |
| **Intento de pago** | Una fila de `payments` con `method='mobile'`, creada antes de salir al proveedor. Tiene importe, modo e identidad estable. |
| **Referencia local** | `payments.external_reference = 'mobile-request:<requestId>'`, la clave de idempotencia del intento. No se reemplaza. |
| **Referencia enviada al proveedor** | `payments.id`, que va en el campo `external_reference` de la preferencia de Mercado Pago. Mismo nombre de campo, distinto dato: ver C3. |
| **Identificadores del proveedor** | ID de preferencia e ID de pago que devuelve Mercado Pago. `mp_payment_id` es compatibilidad histórica y no se reutiliza. |
| **Evento de llamado** | Registro durable de una llamada, rellamado, entrega o invalidación de un pedido listo para retirar. |
| **Reconocimiento** | "Entendido / Voy a retirar" de un destinatario sobre un evento concreto. No equivale a entrega. |
| **Número / punto de retiro** | Número del pedido para la sucursal y el día, y lugar donde se retira. |

---

## Contratos

Cada contrato indica quién lo produce, quién lo consume y qué queda compatible. Los nombres de columnas son **propuestos**: la fase que los implementa puede ajustarlos, pero tiene que mantener la semántica y anotar el cambio en su sección.

### C1 — Contexto de cuenta (fase 2)

**Esquema** (implementado en `20261001020000_session_branch_and_order_authorship.sql`):

- `table_sessions.branch_id uuid not null`, completado desde `tables.branch_id`, con FK `table_sessions_branch_fkey (restaurant_id, branch_id) → branches(restaurant_id, id)`.
- `table_sessions.kind` con un enum nuevo `session_kind ('table','takeout')`, por defecto `'table'`.
- Un check `(kind = 'table') = (table_id is not null)`.
- Coherencia entre mesa y sucursal: `table_sessions_table_id_fkey` se reemplazó, con el mismo nombre, por `(restaurant_id, branch_id, table_id) → tables(restaurant_id, branch_id, id)`, apoyada en la unicidad nueva `tables_restaurant_branch_id_key`.
  - Se descartó la FK adicional que había propuesto: con dos FKs entre `table_sessions` y `tables`, todo embed `tables(...)` sin hint queda ambiguo para PostgREST.
  - La FK tampoco deja cambiar la sucursal de una mesa que tiene cuentas: esa cuenta pasaría a otra sucursal sin que nadie la moviera.
  - `pos_move_table_session` ya impedía moverse entre sucursales (`TABLE_BRANCH_MISMATCH`).
- Un trigger `table_sessions_fill_branch` completa `branch_id` desde la mesa cuando no viene. Es el único valor válido, así que `join_table_session`, `pos_open_table_session` y los fixtures de las pruebas no cambian. Una cuenta takeout sin sucursal la rechaza el `not null`.
- `table_sessions_one_open_per_table` sigue funcionando: un índice único admite varios `table_id` nulos.

**Forma que leen las apps:**

```ts
type SessionContext = {
  sessionId: string
  restaurantId: string
  branchId: string
  kind: 'table' | 'takeout'
  table: { id: string; label: string } | null // null si y solo si kind = 'takeout'
  status: 'open' | 'closed'
}
```

El tipo vive en `packages/shared/src/orders.ts`, junto con `sessionPlaceLabel(session)`: devuelve la mesa, "Para llevar" o "Mesa" si la consulta no trajo la mesa.

- **Productor:** SQL. Las funciones listadas en "Diferencias" leen `table_sessions.branch_id` en lugar de hacer join con `tables`. La vista `pos_open_sessions` usa `left join tables` y agrega la columna `kind` al final.
- **Consumidores:** tablero, historial y cuentas activas del POS (fase 2); pagos (fases 4–6); takeout (fase 9).
- **Compatibilidad:** las sesiones existentes quedan como `kind='table'` con la misma mesa. El plano sigue mostrando solo mesas físicas. Donde hoy se lee `tables.label`, una sesión takeout muestra "Para llevar" y su número (fase 9).

### C2 — Creación de pedido (fases 2 y 8)

**Esquema** (implementado en la misma migración):

- `orders.origin`, con un enum nuevo `order_origin ('qr','pos')`, por defecto `'qr'`. El default conserva los fixtures y cualquier inserción QR anterior; un camino POS que lo olvide choca con el check.
  - Los pedidos existentes se completan como `qr`. La evidencia: `submit_order` es la única vía de escritura (los navegadores no tienen `INSERT` en `orders`, lo verifica la integración 25) y los pedidos locales tienen participante y `request_id`.
  - Un pedido cuyo participante se borró queda `qr` con autor desconocido (`submitted_by` nulo).
- `orders.staff_author_id uuid references profiles(id) on delete set null`, más `orders.staff_author_name text` como copia del nombre.
- Check `orders_author_matches_origin`:
  - `qr`: `staff_author_id` y `staff_author_name` nulos.
  - `pos`: `submitted_by` nulo y `staff_author_name` de 1 a 100 caracteres, con `is not null` explícito (un check que da null se acepta).
- Trigger `orders_keep_authorship`: `origin`, `staff_author_name` y un `submitted_by`/`staff_author_id` no nulo no cambian (`ORDER_AUTHORSHIP_IMMUTABLE`). Solo pueden quedar nulos por `on delete set null`.
- `orderAuthorName(order, participants)` en `packages/shared/src/orders.ts` es la forma de nombrar al autor en pantalla.

**Identidad e idempotencia:**

- QR: se conserva `orders_participant_request_unique (submitted_by, request_id)`.
- POS: una unicidad parcial `(staff_author_id, request_id) where origin = 'pos'`.
- En ambos casos, la misma clave con el mismo `request_payload` devuelve el pedido existente, y con otro contenido responde `IDEMPOTENCY_CONFLICT`.

**Entradas:**

- `submit_order` (QR) mantiene su firma pública y `submitOrderSchema`.
- La entrada POS (fase 8) usa los mismos ítems más observaciones por ítem. `order_items.notes` ya existe pero `submit_order` no lo completa. La lista de claves permitidas en SQL y `orderItemSchema` se extienden en las fases 7–8.
- Las dos entradas delegan en una función interna común, sin `GRANT` a `anon`/`authenticated`.

**Salida:** `SubmitOrderResult { orderId, status, totalAmount }`, sin cambios. El número de retiro se agrega como campo opcional en la fase 9.

**Permisos y errores:**

- QR: los de hoy (`NOT_PARTICIPANT`, `SESSION_CLOSED`, …).
- POS: la cuenta necesita `profiles`, `orders.create` en la sucursal de la sesión (C1) y la sesión abierta; si no, `FORBIDDEN`/`SESSION_CLOSED`.

**Invariante:** mover, cerrar o cambiar el responsable de una sesión no modifica `origin`, `submitted_by` ni `staff_author_*`.

### C3 — Intento y respuesta de pago (fases 3–6)

**Receptor.** La configuración del proveedor es por restaurante: credencial de prueba o producción y secreto de webhook, en backend y con asociación explícita a sucursales. `create` rechaza con `PAYMENT_METHOD_DISABLED` si falta `mobile` en la sucursal o si el proveedor no está configurado para ella. Deshabilitar no bloquea la resolución de intentos ya iniciados.

**Intento local.** Es la fila de `payments` pendiente, creada con el importe calculado en SQL **antes** de llamar al proveedor.

- **Referencia local:** `external_reference = 'mobile-request:<requestId>'`, sin cambios.
- **Referencia enviada:** `payments.id`, en `external_reference` de la preferencia.
- **Datos del proveedor** (propuesto: una tabla 1:1 con `payments` para no ensanchar el libro):
  - `provider`
  - `provider_preference_id`
  - `provider_payment_id` (único por proveedor si no es nulo)
  - `provider_status` y `provider_status_detail`
  - `checkout_url` y `expires_at`
  - `review_reason`: si no es nulo, el caso queda para revisión administrativa.

**Recuperación ante un timeout.** Una preferencia no es un cobro.

- Si la creación remota quedó incierta, el reintento reutiliza el intento local (misma referencia).
- Si hace falta, crea otra preferencia con la misma `external_reference`.
- Todo pago remoto se asocia a ese único intento. Un segundo pago aprobado para el mismo intento se registra con `review_reason`; no se oculta.

**Respuesta de `mobile-payment`.** Extiende `mobilePaymentResultSchema` sin romperlo:

```ts
type MobilePaymentResult = {
  paymentId: string
  amount: number
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  checkout?: { url: string; expiresAt: string | null } // solo al crear con proveedor
  reviewRequired?: boolean
}
```

**Acciones:**

- Se agrega `sync { paymentId }`, que consulta al proveedor y reconcilia (fase 5).
- `confirm` queda solo como herramienta de desarrollo, con `PAYMENT_SANDBOX_ENABLED=true` y sin proveedor configurado.
- Volver desde `back_urls` nunca aprueba nada.

**Estados.** Correspondencia de Mercado Pago al estado local (fase 5):

| Estado en Mercado Pago | Estado local |
|---|---|
| `approved` | `approved` |
| `rejected` | `rejected` |
| `cancelled` | `cancelled` |
| `pending`, `in_process`, `authorized`, `in_mediation` | `pending` |
| `refunded`, `charged_back` | Conserva el estado local y agrega `review_reason`, sin traducción automática |

Solo `approved` reduce el saldo.

**Reservas (fase 4).** Un intento pendiente reserva su importe para **todos** los modos, y también frente a `pos_record_payment`. Los ítems ya se reservan hoy mediante `payment_order_items`.

**Consumidores:** customer (`MobilePayment.tsx`, `orders-api.ts`), POS (`PaymentPanel`), consulta admin (fase 6) y takeout (fase 9, vía C1).

### C4 — Evento de retiro (fase 12; lo consumen las fases 13–14)

```ts
type PickupEvent = {
  id: string
  orderId: string
  sessionId: string
  branchId: string
  kind: 'called' | 'recalled' | 'delivered' | 'invalidated'
  callSequence: number // 1 = primera llamada; n > 1 = rellamado n-1
  pickupNumber: number
  pickupPoint: string | null
  actorUserId: string | null // cuenta staff
  createdAt: string
}
```

**Productor:** SQL, en la misma transacción que el cambio de estado.

- `called` se registra al completar la última parte pendiente.
- `recalled` se registra con la acción "Rellamar".
- `delivered` se registra al entregar.
- `invalidated` se registra al cancelar o al volver a preparación.

Cada evento se guarda con un estado de notificación (`pending`/`sent`/`failed`/`skipped`) para el emisor push.

**Idempotencia:**

- Unicidad `(order_id, call_sequence)` para las llamadas.
- La acción del POS lleva un `requestId`, así un doble clic no crea dos llamadas.

**Destinatarios y reconocimiento:**

- Los destinatarios son los definidos en "Decisiones".
- El reconocimiento se guarda por `(event_id, user_id)`. Una recarga no reactiva un evento ya reconocido; un rellamado nuevo sí vuelve a avisar.

**Fin del aviso:** el último evento es `delivered`/`invalidated`, o el pedido deja de estar `ready`. El cliente descarta los duplicados por `id`, y Realtime y push comparten ese `id`.

---

## Disponibilidad para integración

Ninguno de los tres recursos externos se puede verificar desde este checkout. Mientras falten, las fases avanzan con contratos y pruebas locales, y **no** se declara completa la integración.

| Recurso | Estado verificado | Qué falta y quién lo aporta |
|---|---|---|
| Cuenta de prueba de Mercado Pago | No hay credenciales en el repo ni en `supabase/functions/.env.example`. `DEPLOY.md` dice que la demo no requiere cuenta de Mercado Pago. | El equipo crea una aplicación en "Tus integraciones", usuarios de prueba (vendedor y comprador) y carga el access token de prueba y el secreto de webhook con `supabase secrets set`, nunca en el repo. Bloquea la verificación de las fases 4–6. |
| URL HTTPS para webhook | No hay proyecto vinculado (`linked_project: null`). `DEPLOY.md` documenta cómo crear uno en la nube. | Un proyecto Supabase desplegado (`https://<ref>.supabase.co/functions/v1/<webhook>`) o un túnel HTTPS hacia el stack local. La función del webhook necesita `verify_jwt = false` en `supabase/config.toml`: no recibe el JWT del comensal. |
| Dispositivos para push | No hay service worker, manifest ni inventario de dispositivos. | La lista de dispositivos reales de la demo. Restricciones conocidas para planificar: Web Push requiere HTTPS y service worker; en iPhone/iPad requiere agregar la app a la pantalla de inicio (iOS 16.4+); Safari de iOS no implementa la API de vibración; el audio necesita un gesto previo del usuario. |

Datos de la documentación vigente de Mercado Pago, consultados el 27/09/2026 y revalidados el 30/09/2026, que afectan a C3:

- **Configuración del aviso:** se hace en el panel o por preferencia con `notification_url`, que tiene prioridad sobre el panel.
- **Contenido del aviso:** trae solo el tipo y `data.id`. El estado se obtiene con `GET /v1/payments/{id}`.
- **Respuesta al aviso:** hay que contestar 200/201 en menos de 22 s; si no, Mercado Pago reintenta.
- **Autenticidad:** se valida con los encabezados `x-signature` (`ts`, `v1`) y `x-request-id`, con HMAC-SHA256 y el secreto del webhook. **Verificar literalmente la plantilla del manifiesto en la fase 5** antes de codificarla.
- **Preferencia:** devuelve `id`, `init_point` y `sandbox_init_point`. La documentación de preferencias no menciona un encabezado de idempotencia; por eso la recuperación ante timeouts se basa en la referencia local (C3).

---

## MI-16 y MI-78: una sola implementación

MI-16 (estado del pedido, beeper, confirmación de lectura y aviso en segundo plano) y MI-78 (alerta de pedido listo) describen el mismo comportamiento. Se implementa **un único subsistema de retiro**:

- los eventos durables de C4 (fase 12);
- un controlador de alertas en customer (fase 13);
- un emisor push (fase 14).

Las dos historias se verifican contra ese subsistema y se cierran juntas en la fase 15, con la misma evidencia. No se construyen dos alertas. Los 74 SP del sprint cuentan esa superposición dos veces: no representan 74 SP de trabajo distinto.

---

### Fase 1 — Resultado

- **Estado:** completa.
- **Historias:** transversal; ningún criterio de Jira queda cerrado en esta fase.
- **Incremento que se puede ejecutar:** línea de base reproducible, con toda la suite local en verde (ver "Verificación ejecutada").
- **Archivos y migraciones:** este archivo. Sin cambios de código ni migraciones.
- **Contratos entregados:** C1 a C4 y el diccionario.
- **Consumidor siguiente:** la fase 2 implementa C1 y la parte de esquema de C2.
- **Compatibilidad:** se conserva todo; los contratos extienden sin renombrar lo público (`submitOrderSchema`, `mobilePaymentResultSchema`, `external_reference`).
- **Pruebas ejecutadas y resultado:** test, typecheck, lint, build, SQL, las dos suites integradas y la prueba de humo del simulador: todo pasa, después de reinstalar dependencias y aplicar migraciones pendientes.
- **Recorrido manual y entorno/dispositivo:** no ejecutado. Sin navegador ni dispositivos en esta sesión.
- **Decisiones nuevas y motivo:**
  - `add_guest_participant` reemplaza a `reassign_order_items` como punto a restringir (MI-69).
  - Las migraciones nuevas van después de `20261001010000`.
  - Los destinatarios de avisos se limitan a participantes de la sesión.
  - La referencia enviada al proveedor es `payments.id`.
- **Bloqueos y evidencia pendiente:**
  - Cuenta de prueba de Mercado Pago.
  - URL HTTPS para el webhook.
  - Inventario de dispositivos.
  - Confirmación del umbral de rellamado y del permiso `orders.create`.
- **Siguiente paso concreto:** en la fase 2, escribir la migración de C1 y C2 y actualizar las funciones que dependen de `tables`, la vista `pos_open_sessions`, la política de `payment_order_items`, `posOrderSelect`/`posSessionSelect` y los tipos de POS. Después regenerar `database.types.ts` y el snapshot, y agregar los fixtures de mesa y takeout que pide su verificación.

### Fase 2 — Resultado

- **Estado:** completa.
- **Historias:** base de MI-67, MI-70, MI-71 y pagos. No cierra ningún criterio de Jira: mostrar origen y responsable en el POS es de la fase 8, y la entrada QR de mostrador, de la fase 9.
- **Incremento que se puede ejecutar:**
  - Una cuenta sin mesa (`kind='takeout'`, creada por ahora con SQL o con la clave de servicio) recibe pedidos por `submit-order` y aparece como "Para llevar" en el tablero y el historial de su sucursal.
  - Admite pedir cobro, cobro presencial, pago móvil y cierre, y queda aislada de otros comensales, sucursales y restaurantes.
  - Las cuentas de mesa se comportan igual que antes.
- **Archivos y migraciones:**
  - `supabase/migrations/20261001020000_session_branch_and_order_authorship.sql`
  - `supabase/tests/session-context.sql` (nuevo)
  - `supabase/tests/orders.integration.mjs`
  - `packages/shared/src/{orders,errors,database.types}.ts` y `packages/shared/tests/orders.test.ts` (nuevo)
  - `apps/pos/src/features/pos/{types,api,OrderTicket,OrderHistory,CommandBoard}.ts(x)`
  - `apps/customer/src/features/session-recovery.ts`
  - `supabase/schema.generated.sql`
- **Contratos entregados:**
  - Cuenta: `table_sessions.kind` y `table_sessions.branch_id`, con el trigger que completa la sucursal y las FKs descriptas en C1. En TS: `SessionKind`, `SessionContext` y `sessionPlaceLabel`.
  - Pedido: `orders.origin`, `staff_author_id` y `staff_author_name`, el índice `orders_staff_request_unique` y el trigger de autoría inmutable descriptos en C2. En TS: `OrderOrigin`, `orderOriginLabels` y `orderAuthorName`.
  - Resuelven la sucursal desde la cuenta: `can_read_session`, `submit_order`, `create_mobile_payment`, `pos_record_payment`, `pos_transition_order`, `pos_close_table_session`, `pos_resolve_session_request`, `request_session_service` y la vista `pos_open_sessions`. Mantienen sus firmas y errores públicos, con tres diferencias:
    - `pos_record_payment` ya no puede dar `TABLE_NOT_FOUND`, que antes era inalcanzable.
    - `pos_move_table_session` responde `SESSION_MOVE_CONFLICT` a una cuenta sin mesa. Antes, `<>` contra un nulo la dejaba pasar.
    - `ORDER_AUTHORSHIP_IMMUTABLE` es interno: ningún camino de las apps lo produce y no está en el catálogo.
  - Consultas del POS:
    - `posOrderSelect` (tablero, historial y pedidos de una mesa) trae la mesa opcional y la sucursal desde la cuenta (`branch:branches!table_sessions_branch_fkey`), y filtra por `table_sessions.branch_id`.
    - `posSessionSelect` (plano, comanda de mesa y traslado) conserva `tables!inner`.
    - "Mesas activas" filtra `kind='table'`.
  - `BRANCH_IN_USE` también traduce `table_sessions_branch_fkey`, y su mensaje ahora dice "mesas o cuentas".
- **Consumidor siguiente:**
  - Fase 3: la disponibilidad del proveedor por sucursal usa `table_sessions.branch_id`.
  - Fase 4: `create_mobile_payment` ya toma los medios de la sucursal de la cuenta.
  - Fase 8: la entrada POS inserta `origin='pos'`, `staff_author_id = auth.uid()` y `staff_author_name` desde `profiles.full_name`, con idempotencia por `orders_staff_request_unique`.
  - Fase 9: abre cuentas `kind='takeout'` con `branch_id` y el comprador como participante, y decide si "Mesas activas" lista también las cuentas para llevar (hoy la vista las trae y el POS las filtra).
- **Compatibilidad:**
  - Las firmas de RPC, `submitOrderSchema` y el contrato de `mobile-payment` no cambian.
  - Los datos existentes quedan como cuentas `table` con la sucursal de su mesa, y pedidos `qr` con su autor.
  - `pos_open_sessions` suma `kind` al final.
  - `RecoverableSession.table_id` admite `null` en customer.
- **Pruebas ejecutadas y resultado:**
  - `pnpm test`: 28 archivos y 162 pruebas; `typecheck`, `lint` y `build` pasan.
  - `pnpm test:sql`: 17 archivos, con `session-context.sql` nuevo. Pasan sobre la base local con datos y también sobre un entorno limpio.
  - `pnpm test:orders:integration`: 41 verificaciones; la 23 es nueva y cubre takeout en el tablero y su aislamiento. Además, ahora la suite usa el `posOrderSelect` real del POS.
  - `pnpm test:employees:integration` pasa, y la prueba de humo del simulador de pagos también (8 verificaciones).
  - Entorno limpio: un segundo stack Supabase temporal aplicó todas las migraciones y el seed sin errores. Su snapshot es **idéntico** a `schema.generated.sql`.
- **Recorrido manual y entorno/dispositivo:** no se ejecutó. "Para llevar" en el tablero y el historial está verificado por consulta integrada y typecheck, no visualmente.
- **Decisiones nuevas y motivo:**
  - Se reemplazó la FK de mesa en lugar de agregar otra, para no romper los embeds de PostgREST.
  - El trigger de sucursal evita tocar los fixtures y las funciones de alta de mesa, porque el valor está determinado por la mesa.
  - `origin` conserva el default `'qr'` por compatibilidad; el check frena los errores del lado POS.
  - `submit_order` reutiliza `TABLE_UNAVAILABLE` cuando la sucursal de una cuenta takeout está inactiva. Su mensaje habla de "mesa": la fase 9 debería decidir un código o texto propio.
- **Bloqueos y evidencia pendiente:**
  - Siguen los bloqueos externos de la fase 1.
  - `add_guest_participant` todavía reasigna cualquier ítem de la cuenta (fase 8).
  - Falta el recorrido visual del POS con una cuenta takeout.
- **Siguiente paso concreto:** en la fase 3, modelar la configuración de Mercado Pago por restaurante con asociación explícita a sucursales. Tiene que exponer al panel solo un estado enmascarado y resolver en backend la disponibilidad efectiva para una cuenta, usando `table_sessions.branch_id`.

### Fase 3 — Resultado

- **Estado:** completa en código y pruebas locales. La validez de una credencial real de Mercado Pago sigue pendiente porque esta fase no llama al proveedor y el checkout empieza en la fase 4.
- **Historias:** MI-40 cubierta: el administrador configura la cuenta receptora, ambiente y sucursales; el medio `mobile` sigue habilitándose por sucursal. No se adelantó MI-74: todavía no se crea una preferencia ni se redirige a Mercado Pago.
- **Incremento que se puede ejecutar:**
  - En **Restaurante → Mercado Pago**, owner o manager carga/reemplaza el Access Token, puede dejar preparado el secreto de webhook, elige pruebas/producción y asocia la cuenta a sucursales.
  - El panel solo vuelve a leer `configurado`, ambiente, últimos 4 caracteres del token, presencia del secreto, sucursales y fecha. Los campos secretos quedan vacíos después de guardar.
  - Customer ofrece pago desde el celular únicamente cuando se cumplen juntas las tres condiciones: `mobile` habilitado, sucursal asociada y credencial configurada. La disponibilidad se relee cada 15 segundos y el servidor vuelve a comprobarla al insertar el intento.
  - Quitar una asociación, apagar `mobile` o desvincular la cuenta bloquea intentos nuevos. No bloquea la actualización/resolución de una fila `payments` ya creada.
- **Archivos y migraciones:**
  - `supabase/migrations/20261001060000_mercado_pago_provider_config.sql`
  - `supabase/tests/payment-provider-config.sql` y ajustes de fixtures de pago/contexto
  - `apps/admin/src/features/MercadoPagoSettings.tsx`, `apps/admin/src/queries/payment-provider.ts` y `SettingsPage.tsx`
  - `apps/customer/src/features/SessionBill.tsx` y `apps/customer/src/features/orders-api.ts`
  - `packages/shared/src/{payments,database.types}.ts` y `packages/shared/tests/payments.test.ts`
  - `supabase/schema.generated.sql` y `supabase/functions/.env.example`
- **Contratos entregados:**
  - Enums separados de medio y reparto: `payment_provider = 'mercado_pago'` y `payment_provider_environment = 'test' | 'production'`. `payment_method` y `payment_mode` no cambian.
  - Configuración privada: `private.payment_provider_credentials` guarda únicamente IDs de secretos de Supabase Vault y la máscara; `private.payment_provider_branches` asocia explícitamente restaurante, proveedor y sucursal. `anon` y `authenticated` no tienen acceso al schema.
  - `get_payment_provider_config(p_restaurant_id)` → una fila enmascarada. Requiere `admin.manage`; nunca devuelve Access Token ni secreto de webhook.
  - `save_payment_provider_config(p_restaurant_id, p_environment, p_branch_ids, p_access_token?, p_webhook_secret?)` → `void`. Requiere `admin.manage`, rechaza sucursales ajenas y guarda los secretos cifrados en Vault. `null` conserva un secreto; al crear o cambiar de ambiente exige token nuevo.
  - `delete_payment_provider_config(p_restaurant_id)` → `void`. Requiere `admin.manage` y limpia asociaciones, metadatos y secretos de Vault.
  - `mobile_payment_available(p_session_id)` → `boolean`. Solo responde a un participante autenticado de esa cuenta y no expone más información del proveedor.
  - `resolve_payment_provider_for_session(p_session_id)` → proveedor, ambiente, credenciales, restaurante y sucursal. Solo `service_role` puede ejecutarla; es la entrada backend de la fase 4.
  - Trigger `payments_require_mobile_provider`: los inserts con la referencia de intento `mobile-request:*` exigen configuración efectiva. Las actualizaciones de intentos existentes quedan fuera del trigger para no cortar webhook/reconciliación después de deshabilitar.
- **Consumidor siguiente:** la fase 4 llama `resolve_payment_provider_for_session` desde `mobile-payment`, crea la preferencia de Checkout Pro en backend y conserva `payments.external_reference` como identidad local.
- **Compatibilidad:** medios presenciales/externos y modos de reparto no cambian. El simulador y `resolve_mobile_payment` conservan su contrato, pero iniciar un pago móvil nuevo ahora necesita configuración efectiva; los fixtures que ejercen ese flujo configuran una cuenta receptora de prueba. Los pagos pendientes anteriores pueden resolverse aunque luego se deshabilite el proveedor.
- **Pruebas ejecutadas y resultado:**
  - `pnpm test`: 62 archivos, 265 pruebas: **pasan**. Incluye customer sin botón cuando falta proveedor y validación compartida de configuración.
  - `pnpm typecheck`, `pnpm lint` y `pnpm build`: **pasan**. Build conserva solamente los avisos previos de chunks mayores a 500 kB.
  - `pnpm test:sql`: 16 archivos: **pasan** sobre la base local existente. La prueba nueva cubre Vault, respuesta enmascarada, owner/manager, rol operativo, restaurante/sucursal ajenos, disponibilidad efectiva, privilegio exclusivo de `service_role` y resolución posterior a deshabilitar.
  - `pnpm test:orders:integration`: 41 verificaciones: **pasan**; `pnpm test:employees:integration`: **pasa**.
  - Stack Supabase temporal desde cero: aplicó todas las migraciones, cargó el seed y volvió a pasar los 16 archivos SQL. Se detuvo y se eliminó al terminar.
- **Recorrido manual y entorno/dispositivo:** no se ejecutó navegador. El formulario quedó cubierto por typecheck/build y los contratos por SQL; no se usó una cuenta real ni de prueba de Mercado Pago.
- **Decisiones nuevas y motivo:**
  - Se usa Supabase Vault en vez de una columna de texto o una variable global: cada restaurante tiene su propia credencial cifrada y la base solo conserva sus IDs.
  - No existe otro switch de proveedor. La asociación define qué sucursales cobran en esa cuenta y el chip `mobile` existente decide si el medio se ofrece; la disponibilidad efectiva exige ambos.
  - Cambiar pruebas/producción exige reemplazar el token para evitar usar accidentalmente una credencial del ambiente anterior.
  - La documentación oficial vigente de Checkout Pro se revalidó el 30/09/2026: la preferencia se crea en backend con `POST /checkout/preferences` y `Authorization: Bearer <Access Token>`; la implementación HTTP queda en fase 4.
- **Bloqueos y evidencia pendiente:**
  - Sigue sin haber Access Token de prueba real, comprador de prueba ni aplicación de Mercado Pago en este checkout. No se validó la credencial contra el proveedor.
  - Sigue faltando URL HTTPS y configuración real del webhook; no bloquea MI-40, pero sí la evidencia externa de fases 4–6.
  - `PAYMENT_SANDBOX_ENABLED` continúa como herramienta explícita de desarrollo. No es evidencia de Mercado Pago.
- **Siguiente paso concreto:** en la fase 4, extender la respuesta de `mobile-payment`, persistir los metadatos 1:1 del proveedor por intento, crear la preferencia con `payments.id` como referencia enviada y devolver su URL. Antes, cerrar las reservas pendientes para `full`/`percentage_split` y contra cobro POS, y cubrir timeout/reintento sin crear otro intento local.
