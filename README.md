# Plataforma de autoservicio para restaurantes

Plataforma web multi-restaurante de autoservicio: menú digital por QR de mesa, personalización de platos, pedidos grupales, menú inteligente asistido por LLM, POS propio integrado y pago total o dividido con Mercado Pago.

> Setup local de Supabase y variables de entorno: **[docs/SETUP.md](docs/SETUP.md)**  
> Deploy a la nube (Supabase + Vercel), desde cero: **[docs/DEPLOY.md](docs/DEPLOY.md)**

## Estado del proyecto

| Fase | Descripción | Estado |
|------|-------------|--------|
| 0 | Monorepo, apps Vite, Supabase local, CI | Completa |
| 1 | Schema de DB completo, RLS, seed demo, tipos TS | Completa |
| 2 | Panel admin: auth, mesas + QR, categorías, productos, ingredientes, modificadores | Completa |
| 3 | App comensal: menú, personalización, carrito, sesión compartida | Implementada; ingreso concurrente y RLS verificados en Supabase local |
| 4 | Pedidos: validación server-side, estados, realtime, cuenta | Completa; pruebas integradas en Supabase local |
| 5 | POS propio: tablero de comandas realtime, mesas activas, cierre de sesión | Completa |
| 5.1 | POS desacoplado del backoffice: roles, empleados con PIN y auditoría (MI-61) | Completa |
| 6 | Menú inteligente (LLM) | Pendiente |
| 7 | Pagos (Mercado Pago sandbox, división) | Pendiente |
| 8 | Pulido y demo | Pendiente |

## Qué se puede probar hoy

Con el stack local corriendo (ver más abajo), en el **panel admin** (`http://localhost:5174`):

1. **Login** con un usuario demo: `admin@esquina.demo` / `demo1234` (hamburguesería) o `admin@nonna.demo` / `demo1234` (trattoria). También podés registrar una cuenta nueva y crear tu propio restaurante desde cero.
2. **POS**: tablero de comandas en tiempo real, mesas activas con consumo y pendiente de pago, cierre manual de sesión e historial del día. El POS pide el PIN de un empleado antes de operar (demo: `1234`), se bloquea por inactividad y registra quién hizo cada acción.
3. **Productos**: crear/editar productos con foto, precio, categoría, etiquetas dietarias, disponibilidad, ingredientes (marcando cuáles se pueden quitar) y grupos de modificadores asignados.
4. **Categorías**: crear, renombrar, reordenar, activar/desactivar.
5. **Modificadores**: grupos con reglas mín/máx (ej: "Extras" 0-4 con precio, "Guarnición" exactamente 1) y sus opciones.
6. **Mesas y QR**: crear mesas por sucursal, ver/copiar/imprimir el QR único de cada una.
7. **Empleados**: alta de empleados del POS con PIN, baja lógica y actividad reciente del salón. Solo para el administrador.
8. **Restaurante**: editar información general y sucursales.

La **app del comensal** incluye las Fases 3 y 4. Aplicá las migraciones con `pnpm supabase migration up --local`, iniciá la función con `pnpm dev:functions` y abrí `http://localhost:5173/m/demo-burger-mesa-1` o `http://localhost:5173/m/demo-nonna-mesa-1`.

- Entrada automática por QR y autenticación anónima, sin formulario de login.
- Sesión de mesa compartida, nombre editable y participantes actualizados por Realtime con respaldo por polling.
- Carta por categorías, búsqueda, fotos, información alimentaria y disponibilidad.
- Personalización según ingredientes removibles y reglas mín/máx de modificadores, con precio en vivo.
- Carrito personal persistido por sesión y usuario, con edición, cantidades, eliminación y productos para compartir.

- Revisión y confirmación del carrito; validación transaccional de disponibilidad, personalización y precios reales. Si cambian los precios, se exige revisar y confirmar nuevamente.
- Envíos persistidos con identificador de reintento: una respuesta perdida o dos solicitudes simultáneas no duplican el pedido.
- Recepción mediante `InternalPosAdapter`, con estados y registro de transiciones. El personal avanza las comandas desde el **POS** del admin (`/pos`): tablero kanban, mesas activas y historial del día. El cierre de sesión es manual; el cobro digital corresponde a la Fase 7.
- Pedidos de toda la mesa con nombres, modificaciones y precios conservados, junto con una cuenta que distingue enviado por confirmar, en cuenta, pendiente y pagado. Realtime con respaldo por polling cada 15 segundos.

El menú se actualiza cada minuto y al volver a la ventana. La cuenta incluye pedidos aceptados y descuenta únicamente pagos aprobados; la integración de pagos corresponde a la Fase 7. Ver el recorrido de prueba y las verificaciones ejecutadas en [docs/SETUP.md](docs/SETUP.md#6-probar-pedidos-y-cuenta-fase-4) y el POS en [docs/SETUP.md](docs/SETUP.md#7-probar-el-pos-propio-fase-5).

## Estructura del monorepo

```
apps/
  customer/    App del comensal (mobile-first, se accede escaneando el QR de la mesa)
  admin/       Panel del restaurante + POS propio (comandas, mesas activas, menú, QR)
packages/
  shared/      Tipos de la DB (generados), schemas Zod y lógica de precios compartida
supabase/
  migrations/  Schema SQL versionado (Postgres)
  seed.sql     Datos demo: 2 restaurantes con menús distintos + usuarios admin
  functions/   submit-order, validación de entrada y adaptadores POS
  tests/       Pruebas de función, SQL e integración local
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
pnpm dev:functions  # submit-order         -> http://127.0.0.1:54321/functions/v1/submit-order
```

## Comandos útiles

```bash
pnpm typecheck        # typecheck de todos los paquetes
pnpm lint             # lint de todos los paquetes
pnpm --filter customer test # reglas de personalización, precios y persistencia del carrito
pnpm test:orders      # contrato HTTP, validación de entrada, adaptador POS y tablero
pnpm test:orders:integration # pruebas contra el stack local + Edge Functions (pedidos y cierre de sesión)
pnpm build            # build de producción de todas las apps
pnpm db:types         # regenerar packages/shared/src/database.types.ts desde la DB local
pnpm supabase stop    # apagar el stack local
pnpm supabase status  # ver URLs y credenciales del stack local
```

- **Supabase Studio** (explorar la DB visualmente): http://127.0.0.1:54323
- El CI (GitHub Actions) corre pruebas de lógica del comensal y pedidos, typecheck (incluida la lógica Edge), lint y build en cada push/PR. La suite integrada se ejecuta contra Supabase local.
