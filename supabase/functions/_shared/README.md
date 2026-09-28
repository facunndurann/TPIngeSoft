# _shared

Lo que comparten las tres Edge Functions (`submit-order`, `mobile-payment` y `employee-accounts`):

- `http.ts`: `postHandler`, el sobre HTTP de todas. Resuelve preflight y CORS, el 405, el bearer, el `Content-Type`, el tope del cuerpo en bytes, el JSON, la validación con el schema de `packages/shared` y la respuesta de error del catálogo (`packages/shared/src/errors.ts`), sin exponer errores internos. Cada `handler.ts` declara solo su schema, su tope, sus textos propios y su lógica.
- `clients.ts`: `callerClient` (la identidad de quien llama, con su RLS), `adminClient` (service role, solo para lo que la función ya autorizó) y `verifiedUser`, que valida el JWT contra Auth.

Cada función tiene además su `gateway.ts`, con el acceso a Auth y a Postgres. Los errores de las RPCs pasan por `unwrap`, que los traduce con `fromPostgres`, así que llegan al cliente con su código del catálogo.

En `submit-order`, la validación autoritativa, la persistencia y la recepción del POS interno se ejecutan en una sola transacción dentro de `submit_order` (versión vigente en `supabase/schema.generated.sql`). La función solo valida la entrada, llama a la RPC y devuelve `{ orderId, status, totalAmount }`. Si el POS está inactivo o es externo, `submit_order` revierte el pedido y devuelve `POS_UNAVAILABLE` o `POS_UNSUPPORTED`. La capa de adaptadores para POS externos (Fudo y otros) se diseña cuando se integre el primero.

`pnpm typecheck` verifica `_shared`, los handlers y los gateways. Los `index.ts` son bootstraps que usan las APIs de Deno y se verifican al servir las funciones. `deno.json` fija las mismas versiones de Supabase JS y Zod que usa el monorepo.
