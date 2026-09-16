# _shared

Código compartido de la función `submit-order`:

- `order-gateway.ts`: acceso a Postgres con el JWT validado del comensal; no usa service role.
- `errors.ts`: códigos de error de negocio y mensajes HTTP, sin exponer errores internos.
- `packages/shared/src/orders.ts`: contrato Zod compartido entre frontend y función.

La validación autoritativa, la persistencia y la recepción del POS interno se ejecutan en una sola transacción dentro de `submit_order` (versión vigente en `20260916180000_accept_internal_orders_on_submit.sql`). La función solo valida la entrada, llama a la RPC y devuelve `{ orderId, status, totalAmount }`. Si el POS está inactivo o es externo, `submit_order` revierte el pedido y devuelve `POS_UNAVAILABLE` o `POS_UNSUPPORTED`. La capa de adaptadores para POS externos (Fudo y otros) se diseña cuando se integre el primero.

`pnpm typecheck` verifica gateway y handler. El pequeño bootstrap `submit-order/index.ts` usa las APIs Deno del runtime y se verifica al servir la función en las pruebas integradas. `deno.json` fija las mismas versiones de Supabase JS y Zod que usa el monorepo.
