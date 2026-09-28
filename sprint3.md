# Sprint 3 — Plan de implementación en 15 fases conectadas

## Fuente y alcance

Relevado el **24 de septiembre de 2026** sobre el tablero **MI board**, proyecto **Menu Interactivo**, y el código de `TPIngeSoft-main.zip`. El archivo `sprint2.md` se usó como referencia de formato, no como descripción vigente del sistema.

**Jira no tiene un sprint activo:** `MI Sprint 2` está cerrado y **`MI Sprint 3` — ID 38 — figura como futuro**, sin fechas informadas. Este plan corresponde a las 16 historias cargadas en ese Sprint 3: **74 SP**, todas en “Tareas por hacer” al consultar. No se modificó Jira ni se implementó código al preparar este documento.

El recorrido que organiza las fases es: **una cuenta consistente → un pago real → distintos canales que alimentan esa cuenta → capacidad de cocina → retiro y avisos**. Cada fase debe dejar contratos y evidencia que la siguiente pueda consumir; no son quince implementaciones independientes.

### Historias y cobertura

Los títulos siguientes son resúmenes; cada enlace lleva a la historia original. Los SP son los de Jira, no una nueva estimación.

| Historia | Alcance vigente | SP | Fases responsables |
|---|---|---:|---|
| [MI-40](https://juanfranciscobrusa.atlassian.net/browse/MI-40) | Configurar medios electrónicos habilitados | 5 | 3 |
| [MI-74](https://juanfranciscobrusa.atlassian.net/browse/MI-74) | Iniciar pago con Mercado Pago desde la cuenta | 8 | 4–6 |
| [MI-75](https://juanfranciscobrusa.atlassian.net/browse/MI-75) | Administrador consulta operaciones y estados de Mercado Pago | 5 | 5–6 |
| [MI-76](https://juanfranciscobrusa.atlassian.net/browse/MI-76) | Informar rechazo, cancelación o pendiente y permitir recuperación | 5 | 5–6 |
| [MI-67](https://juanfranciscobrusa.atlassian.net/browse/MI-67) | Crear comanda manual sobre mesa libre u ocupada | 8 | 2, 7–8 |
| [MI-68](https://juanfranciscobrusa.atlassian.net/browse/MI-68) | Productos, cantidades, modificadores y observaciones desde POS | 8 | 7–8 |
| [MI-69](https://juanfranciscobrusa.atlassian.net/browse/MI-69) | Enviar comanda manual al circuito común de cocina y cuenta | 5 | 8 |
| [MI-70](https://juanfranciscobrusa.atlassian.net/browse/MI-70) | Conservar y mostrar origen y responsable de comandas | 3 | 2, 8–9 |
| [MI-71](https://juanfranciscobrusa.atlassian.net/browse/MI-71) | QR de mostrador, pedidos para llevar y cuentas independientes | 3 | 2, 9 |
| [MI-72](https://juanfranciscobrusa.atlassian.net/browse/MI-72) | Límite simultáneo por sector de preparación, en todos los canales | 3 | 10–11 |
| [MI-20](https://juanfranciscobrusa.atlassian.net/browse/MI-20) | Habilitar autoservicio por local o sector | 3 | 12 |
| [MI-17](https://juanfranciscobrusa.atlassian.net/browse/MI-17) | Marcar listo, llamar al comensal y mostrar tiempo de espera | 3 | 11–13 |
| [MI-18](https://juanfranciscobrusa.atlassian.net/browse/MI-18) | Rellamar y auditar cantidad de llamados | 2 | 12–14 |
| [MI-19](https://juanfranciscobrusa.atlassian.net/browse/MI-19) | Verificar número, entregar y detener alertas | 2 | 12–14 |
| [MI-16](https://juanfranciscobrusa.atlassian.net/browse/MI-16) | Estado del pedido, beeper, confirmación de lectura y aviso en segundo plano | 3 | 12–14 |
| [MI-78](https://juanfranciscobrusa.atlassian.net/browse/MI-78) | Alerta de pedido listo | 8 | 13–14 |
| **Total** | **16 historias** | **74** | **Verificación conjunta en fase 15** |

### Observaciones que afectan el plan

- **MI-40 cambió de significado respecto de `sprint2.md`.** Ahora corresponde a configuración administrativa; el inicio del pago está en MI-74.
- **MI-16 y MI-78 se superponen.** Implementar un único subsistema de alertas y verificar ambas historias contra él. Los 74 SP conservan esa superposición; no equivalen a 74 SP de trabajo necesariamente distinto.
- **MI-72 está estimada en 3 SP, pero requiere una base que falta:** sectores de preparación, asignación de productos, estado por sector y admisión concurrente. Esa estimación merece revisión; un contador en la interfaz no cumple la historia.
- **MI-71 tampoco es solo otro QR.** El esquema actual obliga a tener mesa y varias consultas excluyen sesiones sin ella. La fase 2 resuelve esa dependencia antes de construir takeout.
- MI-40, MI-74, MI-75, MI-76 y MI-78 no devolvieron descripción con criterios detallados. Los criterios de este documento para ellas son propuestas técnicas derivadas de sus títulos, no requisitos adicionales atribuidos a Jira.
- Personalización visual profunda, chatbot y adaptadores POS externos **no están en este sprint**. No agregar esas implementaciones. MI-70 solo pide que el origen pueda extenderse eventualmente a otros canales.

## Base real del proyecto

Revisión estática del ZIP: la presencia de código y pruebas no demuestra que esté desplegado o que hoy pase toda la suite.

| Área | Evidencia y consecuencia |
|---|---|
| Monorepo | `apps/admin`, `apps/customer`, `apps/pos`, `packages/shared`, `packages/ui`; React/TypeScript, Supabase y pnpm. Mantener esta división. |
| POS independiente | `apps/pos/src/features/pos/`; autenticación por cuentas y permisos, mapa, apertura/traslado/cierre y cobros. No volver a crear el POS dentro de admin ni reinstalar el PIN del plan anterior. |
| Envío digital | `supabase/functions/submit-order/` llama a `submit_order`. El SQL valida el menú, guarda snapshots e integra aceptación interna en una transacción. La nueva entrada POS debe reutilizar esas reglas. |
| Cuenta y división | `session_bills`, `payments`, `payment_order_items`, `BillSplitter.tsx`, `MobilePayment.tsx`; hay pagos por total, partes iguales, ítems y porcentajes. Extender, no reemplazar. |
| Pago electrónico | `mobile-payment/gateway.ts` crea pagos y resuelve aprobación/rechazo solo con `PAYMENT_SANDBOX_ENABLED`. No hay integración real con Mercado Pago ni webhook. El simulador interno no equivale al entorno de pruebas de Mercado Pago. |
| Referencias de pago | `external_reference` participa del flujo existente; `mp_payment_id` aparece como compatibilidad histórica. No sobrescribir referencias usadas en idempotencia con un ID de proveedor. |
| Dependencia de mesa | `table_sessions.table_id` es obligatorio. `can_read_session`, pagos y transiciones obtienen sucursal mediante la mesa. `posOrderSelect` usa `tables!inner`; un takeout desaparecería del tablero sin cambios. |
| Autoría | `orders.submitted_by` representa un participante. `assigned_user_id` de la sesión puede cambiar durante la operación; no identifica de forma estable a quien creó el pedido. |
| Modificación de consumo | `reassign_order_items` permite reasignaciones dentro de la sesión. Debe revisarse para impedir modificar desde customer los consumos cargados por el restaurante, como exige MI-69. |
| Sectores | Existe `floor_sections` para el salón. No se encontró un modelo de sectores de preparación ni capacidad por cocina/barra. Son conceptos diferentes. |
| Alertas | Hay Realtime con reconexión en `session-realtime.ts` y avisos breves en `announcements.ts`. No se encontró service worker, suscripciones push ni beeper persistente. |
| Migraciones | `schema.generated.sql` muestra las funciones efectivas, redefinidas varias veces en migraciones. Existe `20261001000000_guest_participants.sql`: respetar el orden real, aunque su fecha sea posterior a la del relevamiento. |
| Verificación | `package.json`, `vitest.config.ts`, `supabase/tests/run-sql.sh` y `.github/workflows/ci.yml` definen los comandos actuales. `pnpm test:orders` del plan anterior no existe como script raíz. |

## Reglas para ejecutar las fases

1. Leer este documento completo una vez y, antes de cada fase, su dependencia y el registro de cierre anterior. Revalidar las rutas si el código cambió desde el ZIP.
2. Ejecutar en orden del 1 al 15. Una fase puede preparar otra sin cerrar todavía todas las historias que comparte con ella.
3. Mantener **un modelo de pedidos, una cuenta y un registro de pagos** para QR, POS y takeout. Separar autorización de entrada; compartir las reglas de negocio.
4. Resolver identidad, permisos, precios, modalidad y saldo en servidor. Nunca aceptar un responsable, importe final o aprobación enviados por el navegador como autoridad.
5. Añadir migraciones compatibles con datos existentes, después de las actuales. No editar migraciones ya aplicadas ni eliminar el historial. Regenerar tipos y snapshot cuando cambie SQL.
6. Las rutas indicadas como **nuevas propuestas** son ubicaciones sugeridas, no archivos que ya existan. No crear todas de antemano ni reestructurar aplicaciones enteras por conveniencia.
7. Cada fase deja un incremento ejecutable, pruebas de su riesgo principal y un traspaso escrito: contrato entregado, consumidor siguiente y limitaciones. Si falta una credencial o dispositivo, distinguir lo validado localmente de lo pendiente de integración.

### Decisiones de producto y criterios de partida

Resolver en fase 1; estas propuestas permiten avanzar sin inventar que Jira ya las definió.

| Decisión | Propuesta de partida | Afecta |
|---|---|---|
| Integración Mercado Pago | Checkout alojado, con credenciales de prueba reales del proveedor; confirmar producto/API vigente antes de codificar. Cuenta receptora asociada explícitamente al restaurante. No sumar marketplace ni onboarding OAuth salvo que el equipo lo requiera. | 3–6 |
| Sucursal y cobro | Conservar habilitación por sucursal existente; configuración del proveedor por restaurante, con asociación explícita a sus sucursales. No usar una credencial global para cobrar indistintamente para todos. | 2–6 |
| Cuenta takeout | Sesión privada por compra, sin mesa, vinculada al usuario anónimo y sucursal. El mismo QR es entrada pública al menú, no llave de una cuenta común. Una compra nueva genera otra cuenta. | 2, 9 |
| Servicio y modalidad | `salón/para llevar` describe destino; `mesa/autoservicio` describe entrega. El QR takeout implica retiro, y el beeper se habilita según política configurada. Guardar una copia de esa política en el pedido. | 9, 12 |
| Sectores | Sectores de salón para configuración de autoservicio; sectores de preparación para productos y capacidad. Sin asociación implícita entre ambos. | 10–12 |
| Número de retiro | Único por sucursal y fecha local, asignado en servidor, estable tras reintentos; mostrar contexto de fecha si fuera necesario evitar ambigüedad. | 9, 12 |
| Rellamado | Jira deja “X minutos” sin valor. Propuesta configurable por sucursal, inicialmente 2 minutos; diferenciar primera llamada de última llamada. Confirmar el valor, no tratarlo como criterio original. | 12 |
| Preparación parcial | Capacidad se libera por sector; el pedido está listo para retirar cuando todos sus sectores terminaron. Una cancelación parcial exige una política de cuenta antes de habilitarla; mantener cancelación global mientras no exista esa política. | 11–12 |
| Dispositivos objetivo | Registrar dispositivos/navegadores reales de la demo y probar audio, vibración y push. Una limitación de plataforma no se resuelve prometiendo que siempre sonará. | 1, 13–15 |

## Fase 1 — Fijar contratos y una línea de base verificable

**Objetivo:** que las fases compartan decisiones de dominio y un punto de comparación.

**Depende de:** ninguna. **Jira:** transversal.

**Leer:** `package.json`, `README.md`, `docs/SETUP.md`, `docs/DEPLOY.md`, `supabase/schema.generated.sql`, `packages/shared/src/{orders,payments,employees}.ts`, `apps/pos/src/features/pos/{api,types}.ts` y el flujo de customer.

**Trabajo:**

1. Registrar qué funciona en el checkout de implementación: pedido QR, POS, cuenta, división y simulador. Ejecutar la verificación base disponible y separar fallos previos de regresiones.
2. Resolver las decisiones de la tabla anterior y dejar un pequeño diccionario: cuenta/sesión, pedido, origen, autor, modalidad, sector de salón, sector de preparación, intento de pago, evento de llamado.
3. Definir contratos mínimos de creación de pedido, contexto de sucursal, respuesta de pago y evento de retiro. Identificar a su productor y consumidor; conservar nombres públicos existentes donde sea posible.
4. Comprobar temprano disponibilidad de cuenta de prueba de Mercado Pago, URL HTTPS para webhook y dispositivos para push. Si falta algo, registrar el bloqueo de verificación y avanzar con contratos y pruebas locales; no declarar la integración completa.
5. Crear **nuevo propuesto** `docs/sprint3-progress.md` para decisiones, resultados y traspasos. Registrar allí la superposición MI-16/MI-78.

**Salida verificable:** línea de base registrada y decisiones suficientes para modificar sesiones y pagos. No cerrar esta fase con una lista genérica de archivos leídos.

**Entrega a fase 2:** esquema elegido para cuenta sin mesa, autoría y resolución de sucursal; mantiene compatibilidad con los datos del Sprint 2.

## Fase 2 — Desacoplar la cuenta de la mesa y conservar la autoría

**Objetivo:** permitir que los próximos pagos y pedidos operen sobre una cuenta común, tenga o no mesa.

**Depende de:** 1. **Jira:** base de MI-67, MI-70, MI-71 y pagos.

**Tocar:** migración nueva; `packages/shared/src/{database.types,orders,employees}.ts`; `apps/pos/src/features/pos/{types,api}.ts`; helpers SQL de permisos, consultas de cuenta, pagos y transiciones.

**Trabajo:**

1. Propuesta: conservar `table_sessions` como identidad de cuenta, añadir sucursal explícita y tipo de sesión, permitir `table_id` nulo solo para takeout. Backfill desde mesas; restricciones para asegurar coherencia entre restaurante, sucursal, modalidad y mesa. No crear una “mesa mostrador” compartida.
2. Actualizar autorización, filtros y joins que hoy infieren sucursal por `tables`. El tablero/historial admite cuentas sin mesa; el mapa sigue mostrando mesas físicas.
3. Separar origen de pedido de autor: participante QR o cuenta staff autenticada. Mantener `submitted_by` compatible; no guardar un ID de staff en una FK de participantes ni tomar `assigned_user_id` como creador.
4. Definir idempotencia por actor y solicitud, incluyendo el nuevo canal POS. Backfill histórico como QR solo donde haya evidencia; conservar responsable desconocido cuando corresponda.
5. Adaptar creación/lectura de pagos y acceso a cuenta al contexto de sucursal explícito, incluyendo las consultas que después usarán las fases 4 y 9.
6. Asegurar que mover una mesa, cerrar una sesión o cambiar responsable no reescriba la autoría histórica. Regenerar tipos/snapshot.

**Verificación:** fixture de mesa conserva cuenta, permisos y división; fixture takeout no necesita mesa, aparece en tablero autorizado y queda aislado de otro cliente/restaurante. Un cambio de responsable no altera al creador del pedido.

**Entrega a fases 3–9:** cuenta direccionable por `sessionId` y contexto validado, referencias de mesa opcionales y contrato estable de origen/autor.

## Fase 3 — Configurar Mercado Pago sobre los medios existentes

**Objetivo:** que el administrador habilite una integración utilizable para sus sucursales.

**Depende de:** 2. **Jira:** MI-40.

**Tocar:** `apps/admin/src/pages/SettingsPage.tsx`, `apps/admin/src/features/PaymentMethods.tsx`, `packages/shared/src/payments.ts`, migración/configuración privada y `supabase/functions/.env.example`. **Nuevo propuesto:** módulo administrativo de configuración del proveedor.

**Trabajo:**

1. Mantener separados medio (`mobile`, `in_person`, `external`), proveedor (Mercado Pago) y modo de reparto. No renombrar `payment_mode` para representar un proveedor.
2. Agregar habilitación administrativa, estado de configuración y asociación con restaurante/sucursal. Reutilizar el control existente de medios en vez de agregar otro interruptor contradictorio.
3. Configurar las credenciales del proveedor exclusivamente en backend. El panel consulta estado enmascarado; customer solo recibe disponibilidad pública. El usuario operativo no puede editar configuración administrativa.
4. No ofrecer nuevos pagos de Mercado Pago si falta configuración o el medio está deshabilitado. Validar también en servidor, incluso si una pantalla quedó abierta antes del cambio.
5. Deshabilitar nuevos intentos no debe impedir recibir la resolución de pagos que ya comenzaron.

**Verificación:** habilitación/inhabilitación por sucursal, restaurante ajeno bloqueado y ausencia de secretos en respuestas del frontend.

**Entrega a fase 4:** resolución backend de proveedor/cuenta receptora y disponibilidad efectiva para una sesión.

## Fase 4 — Iniciar checkout de Mercado Pago desde la cuenta

**Objetivo:** convertir el botón existente en un inicio de pago real con el proveedor.

**Depende de:** 3. **Jira:** MI-74; conserva división del Sprint 2.

**Tocar:** `supabase/functions/mobile-payment/{handler,gateway,index}.ts`, `packages/shared/src/payments.ts`, `apps/customer/src/features/MobilePayment.tsx`, `apps/customer/src/features/orders-api.ts` y migraciones de pagos. **Nuevo propuesto:** adaptador del proveedor bajo `mobile-payment/` o `_shared/`.

**Trabajo:**

1. Reutilizar el cálculo servidor de cuenta completa, partes iguales, ítems y porcentajes. Guardar el importe en el intento local antes de salir a Mercado Pago.
2. Separar solicitud idempotente local, referencia local enviada al proveedor e identificadores devueltos por él. Preservar el significado de `external_reference` en el código anterior; no destruir la clave con la que se recupera un reintento.
3. Crear el checkout desde backend y devolver su URL/identificador junto al `paymentId`. No aprobar nada por abrir o regresar de esa URL.
4. Resolver timeout entre creación remota y persistencia local: recuperar el intento existente usando las capacidades de idempotencia/consulta de la API elegida. No iniciar otro cobro ciegamente.
5. Revisar reservas pendientes para **todos** los modos y cobro presencial. Dos participantes no deben reservar el mismo saldo o ítem mientras hay un pago incierto; el bloqueo actual de un pendiente por participante no alcanza por sí solo.
6. Persistir contexto suficiente para regresar a la cuenta tras redirección o recarga. Retirar los botones de simulación del flujo del proveedor; conservar simulación solo como herramienta explícita de desarrollo.

**Verificación:** doble clic devuelve un intento; timeout y reintento no duplican checkout; importes de cada modo coinciden con SQL; medio inhabilitado, sesión ajena o saldo reservado bloquean inicio.

**Entrega a fase 5:** intento pendiente con identidad estable, importe, receptor y referencias para reconciliar. Esta fase **no cierra MI-74** sin confirmación externa.

## Fase 5 — Confirmar pagos con webhook y reconciliación idempotente

**Objetivo:** que el estado del proveedor actualice la cuenta exactamente una vez.

**Depende de:** 4. **Jira:** MI-74, MI-75, MI-76.

**Tocar:** migración/RPC de resolución, `packages/shared/src/payments.ts`, configuración de funciones y pruebas Edge/SQL. **Nueva propuesta:** `supabase/functions/mercadopago-webhook/`.

**Trabajo:**

1. Implementar recepción de notificaciones según la documentación vigente de la integración elegida: validar su autenticidad y consultar el recurso remoto antes de afectar la cuenta. El webhook no depende del JWT anónimo del comensal.
2. Verificar correspondencia entre pago remoto e intento local, importe, moneda y cuenta receptora. Un payload o parámetro de retorno no decide si está aprobado.
3. Registrar eventos/referencias procesados y aplicar cambios bajo transacción. Duplicados, notificaciones fuera de orden y reintentos del webhook no deben descontar otra vez ni degradar un aprobado por un aviso antiguo.
4. Conservar la regla contable: solo aprobados reducen saldo. Pendientes reservan según política; rechazados/cancelados liberan la reserva cuando su estado sea confirmado.
5. No convertir cerrar la pestaña, fallar la red o expirar un temporizador local en “rechazado”. Agregar consulta de reconciliación para intentos inciertos y recuperación si el webhook tarda.
6. Separar el estado real del proveedor de conflictos locales. La RPC actual `resolve_mobile_payment` del simulador convierte una aprobación en rechazo si la sesión cerró o el monto supera el saldo: **no reutilizar esa conducta para dinero cobrado por Mercado Pago**. Si el proveedor cobró y el saldo local cambió, conservar la aprobación externa y registrar la incidencia para revisión; no afirmar que el pago fue rechazado ni ocultarlo. Prevenir el caso con reservas y restricciones de cambios a órdenes/ítems comprometidos.
7. Estados remotos fuera del alcance —por ejemplo, un ajuste posterior— deben quedar registrados para revisión explícita, sin traducirlos arbitrariamente a aprobación o rechazo.

**Verificación:** aprobado/rechazado/cancelado/pendiente; aviso duplicado; aviso antiguo; identidad o monto que no coincide; webhook inválido; caída temporal y recuperación. Incluir un pago confirmado por el proveedor de pruebas, no solo mocks.

**Entrega a fase 6:** estado consultable y confiable, actualización de saldo y referencias de diagnóstico sin secretos.

## Fase 6 — Cerrar experiencia de pago y consulta administrativa

**Objetivo:** que comensal y administrador entiendan qué pasó y qué acción sigue.

**Depende de:** 5. **Jira:** cierre conjunto MI-74, MI-75 y MI-76.

**Tocar:** `apps/customer/src/features/{MobilePayment.tsx,SessionOrders.tsx,orders-api.ts,session-realtime.ts}`, `apps/pos/src/features/pos/PaymentPanel.tsx`, `apps/admin/src/{App.tsx,pages/AdminLayout.tsx}`. **Nueva propuesta:** `apps/admin/src/pages/PaymentsPage.tsx` y su módulo de consultas.

**Trabajo:**

1. Mostrar aprobado, rechazado, cancelado y pendiente al regresar al sitio y al recibir cambios. Si no se puede verificar, informar incertidumbre, no éxito.
2. Permitir reintento después de un resultado terminal fallido, con nuevo intento y conservación del anterior. Para pendiente, ofrecer continuar/verificar; no permitir otro cobro de la misma obligación hasta resolver el anterior.
3. Ofrecer medios alternativos habilitados por el local respetando las reservas, y refrescar saldo/división en todas las pantallas consumidoras.
4. Crear consulta **en admin**, dado que MI-75 tiene actor administrador: lista/detalle con estado, importe, fecha, sucursal, cuenta/mesa o takeout y referencia. Filtros mínimos por fecha/estado/sucursal. Reutilizar en POS lo pertinente según permisos; no exigir una cuenta POS al administrador para cumplir la historia.
5. Mantener las explicaciones de UI en términos del usuario. No mostrar detalles de RPC, claves o implementación como instrucciones para pagar.

**Verificación:** compra de mesa con pago total y dividido; recarga durante pendiente; rechazo y reintento; cancelación real; dos clientes observan el mismo saldo; administrador ve el resultado y otro restaurante no puede leerlo.

**Entrega a fases 8–9:** circuito de cobro completo que recibe consumo de cualquier origen y admite una cuenta sin mesa desde el contrato de fase 2.

## Fase 7 — Armar comandas manuales desde el POS

**Objetivo:** que el mozo prepare un pedido completo sobre una mesa concreta.

**Depende de:** 2 y línea integrada hasta 6. **Jira:** MI-67, MI-68.

**Tocar:** `apps/pos/src/features/pos/TableCommand.tsx`, `apps/pos/src/App.tsx`, `packages/shared/src/orders.ts`; revisar `apps/customer/src/features/{menu.ts,cart.ts,ProductEditor.tsx}`. **Nuevos propuestos:** `apps/pos/src/features/pos/manual-order/` y utilidades compartidas estrictamente necesarias.

**Trabajo:**

1. Agregar acción “Cargar pedido” desde mesa libre u ocupada. Usar apertura/continuación existente, conservar mesa y sector al navegar y nunca abrir una cuenta paralela.
2. Mostrar catálogo con búsqueda por nombre y categorías, cantidades, modificadores obligatorios, límites, extras e ingredientes removibles. Respetar disponibilidad.
3. Añadir observaciones por ítem y por comanda; el contrato actual tiene notas generales, pero no notas por ítem. Extender payload, validación y snapshot para que no se pierdan al enviar.
4. Compartir cálculo y reglas puras del catálogo; no importar páginas de customer desde POS ni copiar una segunda versión divergente del precio. Conservar una UI adecuada para carga rápida.
5. Mantener borrador por usuario/sucursal/sesión y no vaciarlo ante errores. Mostrar subtotal preliminar; servidor lo validará al confirmar.
6. Definir el permiso específico de carga y actualizar catálogo TS/SQL. No asumir que `orders.read` habilita crear pedidos.

**Verificación:** producto obligatorio incompleto, extra agotado, cambio de cantidades, notas distintas en dos ítems iguales, cambio de mesa y recuperación del borrador. No presentar un borrador como enviado.

**Entrega a fase 8:** borrador completo y payload de confirmación asociado a una cuenta y solicitud estable.

## Fase 8 — Enviar la comanda manual al circuito común y auditarla

**Objetivo:** transformar el borrador en consumo real, visible en cocina y en la cuenta compartida.

**Depende de:** 7. **Jira:** cierre MI-67, MI-68, MI-69 y cobertura MI-70.

**Tocar:** funciones de envío, migración/RPC, `apps/pos/src/features/pos/queries.ts`, `apps/pos/src/features/pos/{OrderTicket,OrderHistory,TableCommand}.tsx`, `apps/customer/src/features/SessionOrders.tsx`, `packages/shared/src/{orders,errors,employees}.ts`.

**Trabajo:**

1. Añadir entrada de envío autorizada para staff. Factorizar validación/snapshot/aceptación que ya usa `submit_order`, con wrappers que separen identidad QR y POS. Una función interna privilegiada no debe quedar invocable para eludir esos wrappers.
2. Revalidar precios, categoría activa, disponibilidad, modificadores e ingredientes en servidor. Guardar pedido, ítems, autoría y aceptación de cocina en una sola transacción.
3. Resolver reintentos con la solicitud de fase 7; mismo cuerpo devuelve el pedido, cuerpo distinto con misma clave da conflicto. Comprobar permisos también por sucursal.
4. Mostrar origen QR/POS y responsable estable en detalle/historial y la información administrativa de cocina/cuenta/mesas activas. No alterar importes por origen.
5. Propagar ítems, cantidades, variantes y observaciones al tablero y customer. Customer ve el consumo manual pero no puede modificarlo por UI **ni por RPC**, incluida `reassign_order_items`. Mantener la posibilidad de pagarlo según el modo de cuenta.
6. Invalidar o actualizar las consultas existentes tras el envío; no construir otro KDS para pedidos manuales.

**Verificación:** mesa libre y ocupada; mismo pedido llega una sola vez a cocina; consumo mixto QR+POS en la misma cuenta; precio cambiado conserva borrador; intento de otro staff/sucursal bloqueado; customer no reasigna ítems POS; historial conserva creador tras avanzar estados.

**Entrega a fase 9:** motor común de pedidos con entradas seguras para distintos actores. Las fases 10–11 añadirán capacidad en ese motor, una sola vez.

## Fase 9 — Completar takeout desde un QR de mostrador

**Objetivo:** que distintos compradores usen el mismo QR sin compartir pedido ni cuenta.

**Depende de:** 2, 6 y 8. **Jira:** MI-71 y extensión de MI-70.

**Tocar:** `apps/admin/src/pages/TablesPage.tsx` como referencia de generación QR; `apps/customer/src/{App.tsx,hooks/useTableSession.ts,features/menu-api.ts,features/table-context.ts,stores/cart.ts}`; queries/tickets POS. **Nuevas propuestas:** entrada QR de takeout y componente administrativo para copiar/imprimir su código.

**Trabajo:**

1. Obtener QR por sucursal, diferenciado del de mesa, con copiar e imprimir. Validar sucursal activa al abrirlo.
2. Crear/recuperar una cuenta privada sin mesa para la compra, usando identidad anónima. Persistir el intento de apertura para que una recarga no cree cuentas huérfanas; al comenzar otra compra usar una identidad de compra nueva.
3. Reutilizar menú, personalización y carrito con clave aislada por contexto/compra. No usar el token compartido del QR como única clave de cuenta.
4. Mostrar “Para llevar” antes de confirmar y guardar modalidad de forma inmutable en el pedido. Asignar número propio, único y estable por orden.
5. Enviar por el motor común. Identificar takeout en listado, detalle e historial, conservando modalidad hasta entrega. No incorporarlo al plano como mesa ocupada.
6. Integrar cuenta y pago de fases 4–6 sin depender de joins de mesa. Esta integración no agrega una obligación de prepago que Jira no pidió.
7. Bloquear lectura/escritura de otras compras que entraron por el mismo QR. Los pedidos de mesa conservan su agrupación actual.

**Verificación:** dos dispositivos escanean el mismo QR, reciben cuentas/números diferentes y no ven el pedido ajeno; reintento no duplica orden; cocina distingue takeout; modalidad sobrevive a preparación y entrega; pago se asocia a la compra correcta.

**Entrega a fases 10–14:** salón QR, salón POS y takeout funcionando sobre el mismo circuito; número y modalidad listos para el beeper.

## Fase 10 — Modelar sectores de preparación y configurar su capacidad

**Objetivo:** dar significado real a “capacidad de cocina/barra” antes de bloquear pedidos.

**Depende de:** 9. **Jira:** primera parte de MI-72.

**Tocar:** migraciones, `packages/shared/src/{orders,employees}.ts`, catálogo administrativo y contexto POS. **Nuevos propuestos:** configuración de sectores de preparación y capacidad en POS, con asignación de productos desde admin.

**Trabajo:**

1. Crear sectores de preparación por sucursal y asociación de productos a los sectores que trabajan en ellos. Mantenerlos separados de `floor_sections`.
2. Definir una configuración inicial compatible para los productos existentes: sector general sin límite, hasta asignarlos explícitamente. Ningún producto nuevo debe eludir control por carecer de destino.
3. Guardar en cada pedido confirmado sus sectores e ítems asignados como snapshot; cambiar después el catálogo no mueve trabajo ya aceptado.
4. Modelar estado de preparación por pedido-sector. Un pedido de diez productos consume un lugar en cada sector involucrado, no diez lugares ni un único lugar global.
5. Permitir al personal autorizado configurar su sector, con límites enteros positivos o sin límite. Extender permisos/alcance por sector de forma explícita; validar en servidor, no solo ocultando controles.
6. Mostrar órdenes activas y límite. Si el límite baja de la carga existente, conservar pedidos aceptados y bloquear nuevas admisiones cuando se conecte la fase 11.

**Verificación:** restaurante/sucursal/sector aislados, cero/negativo/decimal rechazados, sin límite admitido, asignación de productos resuelta y cambios de catálogo no alteran snapshots históricos.

**Entrega a fase 11:** sectores, reglas de asignación y ocupación por pedido-sector. No cerrar MI-72 todavía: guardar un límite sin hacerlo cumplir no satisface la historia.

## Fase 11 — Aplicar capacidad atómica en todos los canales

**Objetivo:** impedir sobrecarga sin pedidos parciales, cargos fantasma ni pérdida de carrito.

**Depende de:** 10. **Jira:** cierre MI-72; preparación para MI-17.

**Tocar:** motor SQL de envío/aceptación y transiciones; `packages/shared/src/errors.ts`; carritos QR/POS, tablero y pruebas de concurrencia.

**Trabajo:**

1. Consultar capacidad en servidor dentro de la transacción que acepta el pedido. Bloquear los sectores implicados en un orden determinista, coordinado con locks de sesión/pedido para evitar ciclos de bloqueo.
2. Aceptar solo si todos tienen lugar; registrar pedido y ocupación juntos. Si uno está lleno, rollback completo y error de capacidad específico.
3. Contar aceptados pendientes y en preparación. Cada sector libera su lugar cuando termina su parte o se cancela. `ready`, `delivered` y `cancelled` no consumen preparación.
4. Incorporar acciones por sector al tablero. El pedido global solo queda listo cuando todas las partes están listas. No reutilizar una transición global que libere cocina y barra cuando solo una terminó.
5. Revisar transiciones inversas existentes: volver de listo a preparación vuelve a consumir capacidad y debe validarla. Rellamar no debe retroceder estado ni reservar otro lugar.
6. Recuperar solicitudes ya aceptadas antes de aplicar capacidad a un reintento; no cobrarles un segundo lugar. Mantener una respuesta determinista para la misma solicitud.
7. Aplicar el mismo control a QR de mesa, takeout y POS. Ante rechazo, conservar borrador y explicar espera/reintento; no generar pedido confirmado, ocupación ni pago. No agregar envío automático ni cola de turnos.

**Verificación decisiva:** con un solo lugar libre, dos confirmaciones concurrentes de **sesiones diferentes** aceptan como máximo una. Además: pedido cocina+barra con barra llena revierte todo; cocina termina y libera solo su lugar; reducción de límite conserva activos; volver a preparación no supera límite; reintento idéntico no consume otro lugar.

**Entrega a fase 12:** preparación por sector y disponibilidad real, con transición global de pedido listo confiable.

## Fase 12 — Configurar autoservicio y cerrar el circuito de retiro en POS

**Objetivo:** producir eventos de llamado, rellamado y entrega sobre pedidos realmente listos.

**Depende de:** 11. **Jira:** MI-20, MI-17, MI-18 y parte de MI-19.

**Tocar:** configuración de sucursal/sector de salón, `apps/pos/src/features/pos/{CommandBoard,OrderTicket}.tsx`, `packages/shared/src/{orders,pos}.ts`, SQL de transiciones/auditoría. **Nuevo propuesto:** contrato compartido de eventos de retiro.

**Trabajo:**

1. Habilitar/deshabilitar autoservicio por sucursal y sector de salón, con precedencia explícita de la configuración sectorial. Configurar punto de retiro y umbral de rellamado. Guardar política efectiva en el pedido para no cambiar el ciclo de uno ya enviado.
2. En servicio a mesa, mantener estados normales sin llamador. En autoservicio, mostrar número de retiro y etiquetas “Listo para retirar/Esperando retiro”, sin crear estados contables incompatibles solo para cambiar textos.
3. Al marcar lista la última parte pendiente, registrar la primera llamada y evento persistente en la misma transacción del cambio de estado. En un pedido de un sector, esto se resuelve con un clic.
4. Mostrar contador desde la primera llamada y dato de última llamada. Habilitar “Rellamar” según el umbral configurado; guardar evento con ID/secuencia, actor y fecha, y cantidad de rellamados. Doble clic o reintento de la misma acción no debe crear varios llamados.
5. Confirmar entrega mediante verificación visible del número de orden. Quitar el ticket del tablero activo y conservarlo en historial. Emitir estado/evento de cierre para detener avisos del cliente.
6. Invalidar llamadas pendientes ante cancelación o reversión a preparación. Una respuesta “Voy a retirar” del cliente no equivale a entrega ni a cancelación del pedido.
7. Usar un registro durable de eventos que luego sirva a Realtime y push. Guardar pendiente de notificación en la misma transacción evita perder el aviso si el proceso falla después del commit.

**Verificación:** modo apagado no llama; override de sector; número estable; contador correcto; rellamado registra una sola acción; pedido multisector no llama antes de tiempo; entrega archiva sin borrar; reversión/cancelación invalida el aviso.

**Entrega a fases 13–14:** eventos con identidad, destinatario y versión, número/punto de retiro y condiciones claras para dejar de avisar.

## Fase 13 — Beeper en la aplicación abierta y confirmación de lectura

**Objetivo:** que el comensal reciba y pueda silenciar una alerta persistente de retiro.

**Depende de:** 12. **Jira:** MI-16, MI-78 y cierre de interacción de MI-17/18/19.

**Tocar:** `apps/customer/src/features/{SessionOrders.tsx,session-realtime.ts}`, flujo takeout y contexto de sesión. **Nuevos propuestos:** `features/pickup/` para controlador de alertas y vista de retiro.

**Trabajo:**

1. Consumir el evento persistente y consultar estado vigente; no disparar sonido por cualquier refetch de un pedido `ready`.
2. Mostrar alerta visual llamativa, número de comanda y punto de retiro. Permitir activar sonido desde una interacción explícita; manejar rechazo del navegador sin perder la alerta visual. Usar vibración cuando el dispositivo la admita.
3. Ofrecer “Entendido / Voy a retirar”: detener sonido/vibración y conservar número/punto de retiro. Persistir reconocimiento por destinatario y evento; una recarga no debe reactivar la misma llamada reconocida.
4. Un rellamado nuevo puede volver a avisar; un duplicado de Realtime no. Coordinar varias pestañas para no hacer sonar varias instancias simultáneamente.
5. En entrega, cancelación o reversión, detener temporizadores, audio y vibración. Tras entrega mostrar el cierre de agradecimiento y conservar acceso al comprobante/estado del pedido.
6. Delimitar destinatarios por pedido: takeout solo su comprador; mesa según autoría/participantes definidos en fase 1. No notificar a todos los usuarios de la sucursal. Una comanda manual sin comensal conectado sigue operable en POS.

**Verificación:** listo → alerta → reconocimiento → rellamado → entrega; refetch, recarga, reconexión y duplicado; dos pedidos distintos; pedido ajeno aislado; sonido bloqueado mantiene aviso visual.

**Entrega a fase 14:** controlador y reconocimiento únicos que también aceptan avisos push. **MI-16 sigue abierta** hasta probar su criterio de segundo plano en plataformas objetivo.

## Fase 14 — Notificar con la aplicación en segundo plano

**Objetivo:** cubrir el criterio que Realtime dentro de una pestaña no alcanza a garantizar.

**Depende de:** 12–13. **Jira:** MI-16 y MI-78; integración con MI-18/19.

**Tocar:** app customer, configuración de hosting/funciones, persistencia de suscripciones y eventos. **Nuevos propuestos:** service worker, manifest si la plataforma elegida lo requiere, backend de suscripción y proceso emisor push.

**Trabajo:**

1. Solicitar permiso con contexto y registrar suscripción mediante identidad autenticada. Asociarla solo a pedidos/cuentas autorizados; endpoints y claves de suscripción no deben exponerse entre clientes.
2. Consumir los eventos durables de fase 12 desde un emisor backend. Definir cómo se invoca, reintenta y recupera eventos pendientes tras fallos; escribir un archivo de función sin mecanismo de ejecución no entrega notificaciones.
3. Mostrar notificación desde service worker y, al pulsarla, abrir el pedido correcto usando la sesión válida. Compartir IDs/versiones con fase 13 para evitar duplicados entre push y Realtime.
4. Antes de emitir, comprobar que el aviso sigue vigente. Limpiar suscripciones inválidas y evitar notificar compras antiguas por reutilizar el QR. Al volver al sitio, recuperar estado para descartar mensajes retrasados.
5. Contemplar permiso denegado, navegador sin soporte o dispositivo offline: conservar consulta de estado y aviso al volver. El fallback es comportamiento degradado explícito, no evidencia de que pasó el criterio de push.
6. Al entregar, cerrar avisos que la plataforma permita cerrar y asegurar que al abrir uno retrasado el cliente vea “Entregado”, sin reiniciar beeper. No prometer revocar de forma universal una notificación ya entregada a un dispositivo sin conexión.

**Verificación:** en dispositivos objetivo, aplicación abierta, pestaña en segundo plano y pantalla bloqueada; permiso aceptado/denegado; red interrumpida; rellamado; entrega antes de abrir notificación. Registrar navegador, sistema, instalación requerida y resultado.

**Entrega a fase 15:** un solo sistema de retiro con canales en primer y segundo plano, y matriz de compatibilidad real. Audio y push tienen permisos/restricciones de plataforma; el plan no garantiza sonido continuo con pantalla bloqueada.

## Fase 15 — Integrar, verificar y preparar la demo del sprint

**Objetivo:** demostrar que todos los incrementos funcionan juntos y dejar evidencia por historia.

**Depende de:** 1–14. **Jira:** las 16 historias.

**Tocar:** pruebas necesarias, `docs/SETUP.md`, `docs/DEPLOY.md`, `README.md`, CI y `docs/sprint3-progress.md` propuesto. Corregir regresiones del sprint, sin iniciar funcionalidades ajenas.

### Recorridos integrados obligatorios

| Recorrido | Evidencia esperada |
|---|---|
| Mesa mixta | Mozo abre/carga pedido, comensal entra por QR y agrega otro; cocina procesa ambos; cuenta única y origen/responsable conservados; customer no modifica consumo POS. |
| Cobro completo | Configuración por sucursal → checkout real de pruebas → webhook → saldo actualizado → consulta administrativa con referencia. |
| Cobro dividido | Partes iguales, ítems y porcentajes sobre cuenta mixta; dos clientes simultáneos; sin reserva/cobro doble. |
| Error de pago | Rechazado, cancelado, pendiente prolongado, retorno sin red y notificación duplicada; historial intacto y recuperación sin otro cobro incierto. |
| Takeout independiente | Dos clientes, un QR, cuentas/números separados; modalidad visible en confirmación/KDS/historial y pago asociado a la compra correcta. |
| Capacidad por sector | QR/POS/takeout compiten por el último lugar; un solo aceptado. Pedido multisector revierte completo si falta capacidad y conserva carrito. |
| Preparación parcial | Un sector finaliza y libera lugar; el otro continúa; retiro se llama solo al terminar ambos. |
| Retiro | Autoservicio configurado → listo → aviso → reconocimiento → rellamado → número verificado → entrega → alertas detenidas. Repetir con segundo plano. |
| Servicio tradicional | Autoservicio apagado mantiene pedido y entrega a mesa sin beeper. |
| Aislamiento y regresión | Otro restaurante/sucursal/cliente no accede ni opera datos ajenos; mapa, traslado, cobro presencial y reapertura de mesa siguen funcionando. |

### Comandos reales del repositorio

Desde la raíz, con dependencias instaladas:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Con Supabase local iniciado, migraciones aplicadas y entorno de integración configurado según `docs/SETUP.md`:

```bash
pnpm test:sql
pnpm test:orders:integration
```

Si cambia SQL:

```bash
pnpm db:types
pnpm db:schema
```

El `typecheck` de Edge enumera módulos en `supabase/functions/tsconfig.json`: incluir nuevos handlers/adaptadores. Agregar pruebas nuevas al runner real, y extender CI para ejecutar los endpoints nuevos que se prueben por HTTP; la CI actual sirve `submit-order`, no todas las funciones. `pnpm test:employees:integration` se usa si cambian los permisos/cuentas implicados.

No inventar scripts ni copiar `pnpm test:orders` del Sprint 2. Las pruebas SQL secuenciales no sustituyen una prueba de concurrencia con varias conexiones.

### Cierre

1. Verificar migración sobre base existente y sobre entorno limpio; tipos y snapshot sincronizados. Evitar que el orden posterior a `20261001000000_guest_participants.sql` quede incorrecto.
2. Actualizar documentación de configuración: proveedor, webhook, emisor push, variables públicas/privadas y mecanismo de recuperación. No incluir credenciales.
3. Preparar orden de rollout: migraciones compatibles → secretos/configuración backend → funciones y emisor → aplicaciones → recorridos de humo. Distinguir preparación de un despliegue efectivamente ejecutado.
4. No considerar el simulador interno como evidencia de Mercado Pago ni un toast de pestaña abierta como evidencia de push.
5. Completar matriz historia → criterio → prueba/recorrido → resultado. Una historia compartida por varias fases se cierra cuando cumple todos sus criterios; MI-16/MI-78 comparten implementación, no dos alertas duplicadas.
6. Registrar limitaciones reales, decisiones pendientes y pruebas no ejecutadas. Si una integración está bloqueada, indicar exactamente qué evidencia falta para terminarla.

## Registro de traspaso entre fases

Actualizar `docs/sprint3-progress.md` al cerrar cada fase. La siguiente implementación empieza leyendo este registro y verificando sus contratos, no reinterpretando todo el sprint.

```md
### Fase N — Resultado
- Estado: pendiente / en curso / completa / bloqueada
- Historias: criterios cubiertos y criterios que siguen abiertos
- Incremento que se puede ejecutar:
- Archivos y migraciones:
- Contratos entregados: función/RPC/evento, entrada, salida, permisos y errores
- Consumidor siguiente: fase, pantalla o backend que usa esos contratos
- Compatibilidad: comportamiento previo preservado o cambio acordado
- Pruebas ejecutadas y resultado:
- Recorrido manual y entorno/dispositivo:
- Decisiones nuevas y motivo:
- Bloqueos y evidencia pendiente:
- Siguiente paso concreto:
```

Prompt de uso sugerido:

> Leé `sprint3.md` y el registro de progreso. Ejecutá la fase N sobre el código actual, comprobando sus dependencias. Reutilizá lo entregado por las fases anteriores, completá el incremento y verificá sus criterios. Actualizá el registro con contratos concretos para la fase siguiente y distinguí las pruebas ejecutadas de las pendientes.

## Referencias técnicas consultadas

Jira y el código adjunto determinan el alcance. Las siguientes fuentes oficiales sustentan las precauciones de integración; al implementar, verificar el contrato de la API/producto que efectivamente se elija:

- [Mercado Pago — Webhooks](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/additional-content/notifications/webhooks): configuración de notificaciones, prueba y autenticación de origen.
- [MDN — Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API): suscripciones, service worker y recepción en segundo plano.
- [MDN — Autoplay](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay): bloqueo de audio automático y manejo de interacción/permisos.
