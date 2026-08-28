# Plataforma de autoservicio para restaurantes

Plataforma web multi-restaurante de autoservicio: menú digital por QR de mesa, personalización de platos, pedidos grupales, menú inteligente asistido por LLM, POS propio integrado y pago total o dividido con Mercado Pago.

> Setup detallado de Supabase y variables de entorno: **[docs/SETUP.md](docs/SETUP.md)**

## Estado del proyecto

| Fase | Descripción | Estado |
|------|-------------|--------|
| 0 | Monorepo, apps Vite, Supabase local, CI | Completa |
| 1 | Schema de DB completo, RLS, seed demo, tipos TS | Completa |
| 2 | Panel admin: auth, mesas + QR, categorías, productos, ingredientes, modificadores | Completa |
| 3 | App comensal: menú, personalización, carrito, sesión compartida | Pendiente |
| 4 | Pedidos: validación server-side, estados, realtime, cuenta | Pendiente |
| 5 | POS propio: tablero de comandas realtime | Pendiente |
| 6 | Menú inteligente (LLM) | Pendiente |
| 7 | Pagos (Mercado Pago sandbox, división) | Pendiente |
| 8 | Pulido y demo | Pendiente |

## Qué se puede probar hoy

Con el stack local corriendo (ver más abajo), en el **panel admin** (`http://localhost:5174`):

1. **Login** con un usuario demo: `admin@esquina.demo` / `demo1234` (hamburguesería) o `admin@nonna.demo` / `demo1234` (trattoria). También podés registrar una cuenta nueva y crear tu propio restaurante desde cero.
2. **Productos**: crear/editar productos con foto, precio, categoría, etiquetas dietarias, disponibilidad, ingredientes (marcando cuáles se pueden quitar) y grupos de modificadores asignados.
3. **Categorías**: crear, renombrar, reordenar, activar/desactivar.
4. **Modificadores**: grupos con reglas mín/máx (ej: "Extras" 0-4 con precio, "Guarnición" exactamente 1) y sus opciones.
5. **Mesas y QR**: crear mesas por sucursal, ver/copiar/imprimir el QR único de cada una.
6. **Restaurante**: editar información general y sucursales.

La app del comensal (`http://localhost:5173`) es todavía un placeholder (Fase 3).

## Estructura del monorepo

```
apps/
  customer/    App del comensal (mobile-first, se accede escaneando el QR de la mesa)
  admin/       Panel del restaurante + POS propio (menú, mesas, comandas, pedidos)
packages/
  shared/      Tipos de la DB (generados), schemas Zod y lógica de precios compartida
supabase/
  migrations/  Schema SQL versionado (Postgres)
  seed.sql     Datos demo: 2 restaurantes con menús distintos + usuarios admin
  functions/   Edge functions (a partir de la Fase 4)
```

## Stack

- **Frontend**: React 19 + TypeScript + Vite 7, Tailwind CSS 4, React Router, TanStack Query, Zustand, react-hook-form + Zod.
- **Backend**: Supabase (Postgres + RLS, Auth, Realtime, Storage, Edge Functions).
- **Integraciones**: Mercado Pago (sandbox) para pagos; capa de adaptadores POS con POS propio incluido (Fudo y otros a futuro).

## Cómo correr el proyecto

Requisitos: **Node >= 22**, **pnpm >= 10**, **Docker** corriendo.

```bash
# 1. Instalar dependencias
pnpm install

# 2. Levantar Supabase local (primera vez descarga imágenes, tarda unos minutos)
pnpm supabase start

# 3. Aplicar schema + datos demo
pnpm supabase db reset

# 4. Configurar .env de cada app (ver docs/SETUP.md; en local ya vienen creados)

# 5. Levantar las apps
pnpm dev:admin      # Panel del restaurante -> http://localhost:5174
pnpm dev:customer   # App del comensal     -> http://localhost:5173
```

## Comandos útiles

```bash
pnpm typecheck        # typecheck de todos los paquetes
pnpm lint             # lint de todos los paquetes
pnpm build            # build de producción de todas las apps
pnpm db:types         # regenerar packages/shared/src/database.types.ts desde la DB local
pnpm supabase stop    # apagar el stack local
pnpm supabase status  # ver URLs y credenciales del stack local
```

- **Supabase Studio** (explorar la DB visualmente): http://127.0.0.1:54323
- El CI (GitHub Actions) corre typecheck + lint + build en cada push/PR.
