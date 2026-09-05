# _shared

Código compartido de la Fase 4:

- `pos/`: capa de adaptadores POS (`InternalPosAdapter` hoy; `FudoAdapter` y otros a futuro).
- `order-gateway.ts`: acceso a Postgres con el JWT validado del comensal; no usa service role.
- `errors.ts`: códigos de error de negocio y mensajes HTTP, sin exponer errores internos.
- `packages/shared/src/orders.ts`: contrato Zod compartido entre frontend y función.

La validación autoritativa y persistencia se ejecutan juntas en `submit_order` (migración `20260905200000_orders.sql`). El núcleo invoca `PosAdapter.sendOrder` con el snapshot completo; la fábrica elige el adaptador por configuración. `InternalPosAdapter` registra recepción mediante una RPC idempotente. El menú inteligente, otros adaptadores y pagos se incorporan en sus fases respectivas.

`pnpm typecheck` verifica gateway, handler y adaptadores. El pequeño bootstrap `submit-order/index.ts` usa las APIs Deno del runtime y se verifica al servir la función en las pruebas integradas. `deno.json` fija las mismas versiones de Supabase JS y Zod que usa el monorepo.
