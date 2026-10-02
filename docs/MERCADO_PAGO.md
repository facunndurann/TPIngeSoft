# Mercado Pago Checkout Pro

Integración mediante preferencias en `restaurant-platform`: React 19 + TypeScript/Vite, Supabase Edge Functions (Deno), Postgres y Vault. Extiende la cuenta y los repartos existentes. Documentación oficial revisada el **2 de octubre de 2026**. La validación con cuentas del comercio y el despliegue productivo son tareas del equipo; las pruebas automatizadas no certifican cobros reales.

## Fuentes y alcance

Las operaciones del proveedor siguen exclusivamente Mercado Pago Developers y su SDK Node oficial `mercadopago@3.6.1`. Los endpoints `/functions/v1/*`, UUID internos, permisos, reservas y repartos son contratos de esta aplicación; no son endpoints ni reglas de Mercado Pago.

| Comportamiento del proveedor | Fuente oficial | Aplicación en este proyecto |
| --- | --- | --- |
| Crear preferencia: `POST /checkout/preferences` | [Crear preferencia](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro-preferences/create-preference/post) | `Preference.create`: importe calculado en Postgres, `currency_id: ARS`, `external_reference`, `back_urls`, `notification_url`. |
| Recuperar preferencias por referencia | [Buscar preferencias](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro-preferences/search-preferences/get) | `Preference.search` y `Preference.get` recuperan una creación de resultado incierto. La búsqueda abarca los últimos 90 días. |
| Consultar pagos desde el servidor | [Obtener pago](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro-preferences/get-payment/get), [referencia de Checkout Pro](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro-preferences/overview) | `Payment.get` y `Payment.search`; verificar referencia, importe, moneda y estado antes de afectar el saldo. |
| Retorno de éxito, pendiente o fallo | [URLs de retorno](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/configure-back-urls) | Volver a la mesa; los parámetros del navegador nunca aprueban el pago. |
| Firma y reintentos de notificaciones | [Webhooks](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/additional-content/notifications/webhooks), [configurar notificaciones](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/payment-notifications) | Validar origen, consultar recurso autenticado y confirmar después de persistir. |
| API pública del SDK, HMAC y reintentos HTTP | [SDK oficial enlazado desde Developers](https://github.com/mercadopago/sdk-nodejs), [validador 3.6.1](https://github.com/mercadopago/sdk-nodejs/blob/3.6.1/src/utils/webhook/index.ts), [opciones 3.6.1](https://github.com/mercadopago/sdk-nodejs/blob/3.6.1/src/types.ts) | `MercadoPagoConfig`, `Preference`, `Payment`, `WebhookSignatureValidator`; timeout acotado y `maxRetries: 0`. |
| Pruebas de Checkout Pro | [Introducción](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/integration-test/introduction), [compras de prueba](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/integration-test/test-purchases), [credenciales e init_point](https://www.mercadopago.com.ar/developers/es/news/2023/11/16/Questions-on-how-to-test-your-integration--) | Vendedor/comprador de prueba distintos; usar `init_point` también durante las pruebas. |

Cada restaurante cobra con su propia cuenta. Dividir una cuenta entre comensales es una operación interna previa al checkout; no implica comisiones de marketplace ni split de fondos entre vendedores. Cuotas, exclusión de medios, metadata adicional y comisiones son extensiones documentadas en [crear preferencia](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro-preferences/create-preference/post); requieren configuración y validación explícitas en el constructor de preferencias del servidor.

## Configuración

1. Aplicar las migraciones siguiendo [SETUP.md](SETUP.md). El Docker administrado por `pnpm supabase start` ya proporciona el backend local; no hace falta otro servidor de pagos.
2. Copiar `supabase/functions/.env.example` a `supabase/functions/.env` y completar:

   ```dotenv
   EMPLOYEE_EMAIL_DOMAIN=employees.example.com
   MERCADO_PAGO_APP_URL=https://mesa.example.com
   MERCADO_PAGO_WEBHOOK_URL=https://PROJECT_REF.supabase.co/functions/v1/mercado-pago-webhook
   ```

   El primer valor de Mercado Pago es solamente el origen del comensal; el segundo es la URL completa del webhook. Reemplazar los placeholders. Usar HTTPS público tanto en pruebas integradas como en producción: un despliegue de pruebas o un túnel HTTPS propio. Los retornos del checkout no deben apuntar a `localhost`. [URLs de retorno oficiales](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/configure-back-urls).
3. Servir las funciones locales con `pnpm supabase functions serve --env-file supabase/functions/.env`. `pnpm dev:functions` conserva el ejemplo sin URLs de pagos para tareas que no necesitan Checkout Pro.
4. En Mercado Pago Developers, **Tus integraciones → aplicación → Webhooks**, configurar eventos de pagos y guardar el secreto de firma. La preferencia establece una `notification_url` por pago, con prioridad sobre la URL general de la aplicación. [Configuración de Webhooks](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/additional-content/notifications/webhooks).
5. En el panel administrativo, **Restaurante → Mercado Pago**, cargar ambiente, Access Token, secreto de webhook y sucursales asociadas. Habilitar **Pago desde el celular** en cada sucursal. Ambos secretos son necesarios para iniciar pagos.

Los secretos se ingresan una vez por un administrador autorizado y el backend los cifra en Vault. El panel posteriormente obtiene sólo estado y máscara; el checkout del comensal no recibe secretos. Las variables `VITE_*` nunca deben contener Access Token, secreto de webhook ni service role. Supabase inyecta sus credenciales de servicio en las funciones; las de Mercado Pago son distintas por restaurante y no se guardan como variables globales.

Elegir “Pruebas” no transforma una credencial productiva en una credencial de prueba. Usar el Access Token de la aplicación del **vendedor de prueba**, otro comprador y datos de prueba según la [guía oficial de Checkout Pro](https://www.mercadopago.com.ar/developers/es/news/2023/11/16/Questions-on-how-to-test-your-integration--). El backend devuelve `init_point`; no selecciona `sandbox_init_point` por el prefijo del token.

## Contrato HTTP de la aplicación

Base: `https://PROJECT_REF.supabase.co/functions/v1`. Crear y consultar requieren `Authorization: Bearer <JWT del comensal>` y `Content-Type: application/json`. Usar el cliente Supabase o enviar también su clave pública `apikey` al gateway. La app conserva la identidad anónima con la que el comensal entró a la mesa.

| Endpoint | Entrada | Resultado |
| --- | --- | --- |
| `POST /mobile-payment` | `{"action":"create","sessionId":"UUID","requestId":"UUID","mode":"full"}` | `201`: identificador interno, importe, estado y URL de Checkout Pro cuando está disponible. |
| `POST /mobile-payment` | `{"action":"status","paymentId":"UUID"}` | `200`: estado reconciliado por el backend. La identidad debe estar autorizada para ese pago. |
| `POST /mercado-pago-webhook?payment_id=UUID` | Notificación oficial con `data.id` en query y firma en `x-signature` / `x-request-id` | `200` al procesar; errores transitorios permiten reintentos del proveedor. Verifica HMAC, no usa JWT Supabase. |

`payment_id` en la URL del webhook es un UUID interno; `data.id` es el ID del proveedor firmado por Mercado Pago. No son intercambiables. El servidor genera la URL de notificación al crear la preferencia: no copiar un UUID ficticio a la configuración del proveedor para validar un cobro.

Los modos son `full`, `equal_split`, `percentage_split` y `custom`. `custom` requiere `itemIds` (entre 1 y 100 UUID); los demás no los admiten. Postgres obtiene el importe del consumo aceptado, reparto y reservas vigentes; el contrato no acepta un importe del cliente. Reutilizar el mismo `requestId` al reintentar el mismo contenido.

Respuesta orientativa, con IDs reemplazados por los del entorno:

```json
{
  "paymentId": "11111111-1111-4111-8111-111111111111",
  "amount": 12500,
  "status": "pending",
  "preferenceId": "ID_DEVUELTO_POR_MERCADO_PAGO",
  "checkoutUrl": "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=ID_DEVUELTO_POR_MERCADO_PAGO"
}
```

`checkoutUrl`, `preferenceId` y `providerStatus` son opcionales. Usar la URL recibida, sin construirla concatenando IDs. Un error usa `{"error":{"code":"...","message":"..."}}`; su catálogo está en `packages/shared/src/errors.ts`. No existe una acción pública `confirm`: el navegador no puede aprobar pagos.

## Consistencia y operación

La creación mantiene una reserva local y exclusión temporal entre solicitudes concurrentes. Si falla la comunicación después de enviar la preferencia, el resultado queda incierto: el backend intenta recuperarla por `external_reference`. La documentación del endpoint no garantiza idempotencia de preferencias; el encabezado automático del SDK no se interpreta como una garantía. No emitir otra preferencia a ciegas si la recuperación sigue sin resolver el resultado. [API de búsqueda](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro-preferences/search-preferences/get).

Cada pago conserva su configuración receptora en Vault para que cambiar la cuenta del restaurante no atribuya notificaciones antiguas a otra cuenta. La reconciliación transaccional compara la fecha de actualización del proveedor para evitar que un evento viejo sobrescriba uno nuevo. Se consulta el recurso autenticado desde el servidor; el cuerpo del webhook y el retorno del navegador no son autoridad para aprobar.

Los snapshots no mantienen válida una credencial revocada por Mercado Pago. Antes de revocar un token o regenerar el secreto de firma de la aplicación, conciliar los pagos pendientes y planificar la transición: una notificación firmada con un secreto nuevo no valida contra el snapshot antiguo. Actualizar un valor en el panel y revocarlo en Mercado Pago son operaciones distintas.

Checkout Pro puede producir varios intentos de pago. Un rechazo libera la reserva local; si luego se cobra una preferencia anterior mientras existe otro intento, el sistema conserva el cobro y registra `APPROVED_EXCEEDS_BALANCE` o `MULTIPLE_PROVIDER_PAYMENTS` para revisión. Revisar esos casos en **Restaurante → Pagos de Mercado Pago** y gestionar cualquier devolución en Mercado Pago. Una preferencia incierta sin resultado de búsqueda mantiene su reserva y exige investigación; no se borra automáticamente.

`WebhookSignatureValidator` comprueba HMAC sobre `data.id`, `x-request-id` y el `ts` original. No se configura `toleranceSeconds`: la [guía muestra timestamps de distinta longitud](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/payment-notifications), mientras que el [SDK asume segundos al activar esa opción](https://github.com/mercadopago/sdk-nodejs/blob/3.6.1/src/utils/webhook/index.ts). Frente a reenvíos, se relee el recurso autenticado y se aplica el cambio de forma idempotente en Postgres.

Mercado Pago espera `200`/`201` en hasta 22 segundos y reintenta entregas fallidas, inicialmente cada 15 minutos y con intervalos mayores después. El receptor confirma después de persistir. Revisar el panel de notificaciones y los logs de Edge para detectar firmas inválidas, timeouts, fallos de persistencia y diferencias de importe. No registrar tokens, firmas completas, cuerpos completos ni datos de tarjetas. [Comportamiento oficial de Webhooks](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/additional-content/notifications/webhooks).

Reembolsos, contracargos y estados pendientes deben revisarse junto con `transaction_amount_refunded` y `status_detail` del [pago consultado](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro-preferences/get-payment/get). Esta integración no ofrece un botón para ordenar reembolsos: se gestionan en Mercado Pago. Validar cómo quedan representados en el saldo y atender diferencias antes de cerrar la mesa.

## Pruebas y despliegue

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm test:sql
pnpm test:payments:integration
```

Vitest usa dobles del proveedor y no mueve dinero. Las pruebas SQL requieren Supabase local y verifican transacciones, permisos y contabilidad. `test:payments:integration` conecta Auth, PostgREST, Vault y las RPC reales con el handler y un proveedor simulado: recupera una respuesta perdida, valida firmas, rechaza accesos ajenos y verifica reintegros. Incluye reintentos concurrentes y una ráfaga de 30 consultas que mide latencia local y verifica el límite de solicitudes. Sólo admite una URL local; requiere `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` del stack local en el proceso de pruebas. El CI ejecuta esta suite además de pruebas, tipos, lint, build, SQL y pedidos. No colocar la clave de servicio en el frontend.

Para desplegar, completar [DEPLOY.md](DEPLOY.md), aplicar migraciones antes de publicar funciones y configurar URLs:

```bash
pnpm supabase db push
pnpm supabase secrets set MERCADO_PAGO_APP_URL=https://mesa.example.com
pnpm supabase secrets set MERCADO_PAGO_WEBHOOK_URL=https://PROJECT_REF.supabase.co/functions/v1/mercado-pago-webhook
pnpm supabase functions deploy mobile-payment
pnpm supabase functions deploy mercado-pago-webhook
```

Reemplazar los dominios de ejemplo antes de ejecutar. Las apps conservan su despliegue Vite/Vercel. El webhook necesita `verify_jwt=false`: Mercado Pago no envía JWT Supabase; su autenticación se realiza con HMAC. En despliegues automatizados ejecutar primero el CI y aplicar este mismo orden en el entorno destino. No incluir Access Tokens de comercios en GitHub Actions.

## Validaciones humanas antes de producción

| Prioridad | Validación | Evidencia esperada |
| --- | --- | --- |
| P0 | Credenciales y receptor por restaurante/sucursal; app y webhook HTTPS. | Cuenta, ambiente y secreto coinciden con Mercado Pago; sin secretos en bundles/repositorio. |
| P0 | Compra aprobada, rechazada y pendiente con cuentas de prueba distintas. | Estado consistente con Mercado Pago, POS y cuenta; sólo el importe confirmado reduce el saldo. |
| P0 | Retorno manipulado, doble clic, webhook repetido/fuera de orden y consulta de pago ajeno. | Sin aprobaciones falsas, duplicados ni acceso cruzado. |
| P0 | Timeout de creación, caída de DB y entrega fallida recuperada por reintento. | Intento reutilizado, recuperación por referencia y actualización única. |
| P0 | Cambio de credenciales con pagos pendientes, reembolso total/parcial y contracargo. | Cuenta original conservada, saldo validado y diferencias atendidas. |
| P1 | Carga en staging con concurrencia y latencia del proveedor. | Reservas consistentes, límite de solicitudes efectivo y latencia de webhook documentada. |
| P1 | Monitoreo y recuperación operativa. | Responsable de alertas, revisión de entregas, respaldo y conciliación de pendientes. |

Seguir las [compras de prueba oficiales](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/integration-test/test-purchases). Usar el mismo navegador/origen del comensal para conservar su sesión al volver. Probar también cerrar la pestaña antes del retorno: el webhook debe actualizar igualmente la cuenta. No realizar pruebas de carga contra Mercado Pago productivo.

## Diagnóstico

| Síntoma | Revisar |
| --- | --- |
| No se puede iniciar checkout | URLs HTTPS, migraciones, ambos secretos, sucursal asociada y medio móvil habilitado. |
| Error de credenciales | Token de la aplicación/vendedor correctos; distinguir usuario real y vendedor de prueba. |
| Retorno con pago todavía pendiente | Consultar estado y revisar webhook; volver al sitio no confirma un cobro. |
| Webhook `401` | JWT desactivado en ese endpoint, secreto original del pago, query `data.id` y headers sin modificaciones del proxy. |
| Error transitorio del webhook | Logs de Edge/DB; restablecer servicio y verificar entrega posterior en Mercado Pago. |
| Preferencia de resultado incierto | Conservar intento original; no borrar reservas ni emitir otro cobro durante la investigación. |
| Retorno pierde identidad | Origen `MERCADO_PAGO_APP_URL`, redirects del host y persistencia de Auth. |

La implementación requiere QA y validación antes de producción; no garantiza ausencia de errores ni reemplaza la conciliación del comercio.
