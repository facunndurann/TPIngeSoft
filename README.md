# Plataforma de autoservicio para restaurantes

Plataforma web multi-restaurante de autoservicio: menú digital por QR de mesa, personalización de platos, pedidos grupales, menú inteligente asistido por LLM, POS propio integrado y pago total o dividido con Mercado Pago.

## Estructura del monorepo

```
apps/
  customer/    App del comensal (mobile-first, se accede escaneando el QR de la mesa)
  admin/       Panel del restaurante + POS propio (menú, mesas, comandas, pedidos)
packages/
  shared/      Tipos de la DB, schemas Zod y lógica de precios compartida
supabase/
  migrations/  Schema SQL versionado (Postgres)
  functions/   Edge functions (validación de pedidos, menú inteligente, pagos)
```

## Stack

- **Frontend**: React 19 + TypeScript + Vite, Tailwind CSS, React Router, TanStack Query, Zustand, react-hook-form + Zod.
- **Backend**: Supabase (Postgres + RLS, Auth, Realtime, Storage, Edge Functions).
- **Integraciones**: Mercado Pago (sandbox) para pagos; capa de adaptadores POS con POS propio incluido (Fudo y otros a futuro).

## Desarrollo

Requisitos: Node >= 20, pnpm >= 10, Docker (para Supabase local).

```bash
pnpm install

# Supabase local (requiere Docker corriendo)
pnpm supabase start

# Copiar variables de entorno (completar con los valores que imprime supabase start)
cp apps/customer/.env.example apps/customer/.env
cp apps/admin/.env.example apps/admin/.env

# Levantar las apps
pnpm dev:customer   # http://localhost:5173
pnpm dev:admin      # http://localhost:5174
```

Otros comandos útiles:

```bash
pnpm typecheck   # typecheck de todos los paquetes
pnpm lint        # lint de todos los paquetes
pnpm build       # build de todos los paquetes
pnpm db:types    # regenerar packages/shared/src/database.types.ts desde la DB local
```
