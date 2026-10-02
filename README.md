# Plataforma de autoservicio para restaurantes

Plataforma web multi-restaurante de autoservicio: menú digital por QR de mesa, personalización de platos, pedidos grupales, menú inteligente asistido por LLM, POS independiente y pago total o dividido con Mercado Pago.

> Setup local de Supabase y variables de entorno: **[docs/SETUP.md](docs/SETUP.md)**  
> Deploy a la nube (Supabase + Vercel), desde cero: **[docs/DEPLOY.md](docs/DEPLOY.md)**
> Checkout Pro, credenciales, Webhooks y validación de cobros: **[docs/MERCADO_PAGO.md](docs/MERCADO_PAGO.md)**

## Estado del proyecto

| Fase | Descripción | Estado |
|------|-------------|--------|
| 0 | Monorepo, apps Vite, Supabase local, CI | Completa |
| 1 | Schema de DB completo, RLS, seed demo, tipos TS | Completa |
| 2 | Panel admin: auth, mesas + QR, categorías, productos, ingredientes, modificadores | Completa |
| 3 | App comensal: menú, personalización, carrito, sesión compartida | Implementada; ingreso concurrente y RLS verificados en Supabase local |
| 4 | Pedidos: validación server-side, estados, realtime, cuenta | Completa; pruebas integradas en Supabase local |
| 5 | POS propio: tablero de comandas realtime, mesas activas, cierre de sesión | Completa |
| 5.1 | POS independiente: cuentas globales, permisos por sucursal y auditoría | Completa |
| 5.2 | Salón: sectores y layout de mesas configurables (MI-66) | Completa |
| 5.3 | Mapa operativo: estados, tiempos, totales y responsable por mesa (MI-62/MI-63) | Completa |
| 5.4 | Abrir y continuar comandas desde el mapa (MI-64) | Completa |
| 5.5 | Mover comandas entre mesas libres de la misma sucursal (MI-65) | Completa |
| 6 | Menú inteligente (LLM) | Pendiente |
| 7 | Pagos (Mercado Pago Checkout Pro, división) | Implementados; validación con cuentas de prueba y HTTPS pendiente |
| 8 | Pulido y demo | Pendiente |

## Qué se puede probar hoy

Con el stack local corriendo (ver más abajo), en el **panel admin** (`http://localhost:5174`):

1. **Login** con un usuario demo: `admin@esquina.demo` / `demo1234` (hamburguesería) o `admin@nonna.demo` / `demo1234` (trattoria). También podés registrar una cuenta nueva y crear tu propio restaurante desde cero.
2. **POS independiente** (`http://localhost:5175`): login con usuario y contraseña propios, sin sesión administrativa. Demo: `pos.esquina` / `demo-pos1234`. Tablero de comandas en tiempo real y mapa de salón por sector: el mapa distingue mesas libres, ocupadas, con pedidos, cuenta solicitada o cobro pendiente, y muestra tiempo, total y responsable sin abrir la comanda. Desde una mesa se abre, continúa o traslada su comanda, y al volver el plano conserva el sector. Cada acción queda auditada con la cuenta que la ejecutó, y los botones disponibles dependen del rol.
3. **Productos**: crear/editar productos con foto, precio, categoría, etiquetas dietarias, disponibilidad, ingredientes (marcando cuáles se pueden quitar) y grupos de modificadores asignados.
4. **Categorías**: crear, renombrar, reordenar, activar/desactivar.
5. **Modificadores**: grupos con reglas mín/máx (ej: "Extras" 0-4 con precio, "Guarnición" exactamente 1) y sus opciones.
6. **Mesas y QR**: crear mesas por sucursal, ver/copiar/imprimir el QR único de cada una.
7. **Salón**: modo visualizar (plano de solo lectura con resumen del sector) y modo editar (sectores, mesas arrastrables y redimensionables con ancho y alto libres, capacidad, forma y visibilidad). Es el layout que después usa el POS.
8. **Empleados**: cuentas globales con username único, roles, sucursales, desactivación y restablecimiento de contraseña; auditoría nueva e histórica.
9. **Restaurante**: editar información general y sucursales.

La **app del comensal** incluye las Fases 3 y 4. Aplicá las migraciones con `pnpm supabase migration up --local`, iniciá la función con `pnpm dev:functions` y abrí `http://localhost:5173/m/demo-burger-mesa-1` o `http://localhost:5173/m/demo-nonna-mesa-1`.

- Entrada automática por QR y autenticación anónima, sin formulario de login.
- Sesión de mesa compartida, nombre editable y participantes actualizados por Realtime con respaldo por polling.
- Carta por categorías, búsqueda, fotos, información alimentaria y disponibilidad.
- Personalización según ingredientes removibles y reglas mín/máx de modificadores, con precio en vivo.
- Carrito personal persistido por sesión y usuario, con edición, cantidades, eliminación y productos para compartir.

- Envío del carrito en un toque, con el total en el botón; validación transaccional de disponibilidad, personalización y precios reales. Si cambian los precios, el servidor rechaza el total anterior y hay que actualizar la carta y volver a enviar.
- Envíos persistidos con identificador de reintento: una respuesta perdida o dos solicitudes simultáneas no duplican el pedido.
- Recepción del POS interno en la misma transacción de `submit_order`, con estados y registro de transiciones. El personal avanza las comandas desde el **POS independiente** (`http://localhost:5175`): tablero kanban, mesas activas y historial del día. El cierre de mesa es manual. El cobro digital redirige a Mercado Pago Checkout Pro y se verifica desde el backend.
- Pedidos de toda la mesa con nombres, modificaciones y precios conservados, junto con una cuenta que distingue enviado por confirmar, en cuenta, pendiente y pagado. Realtime con respaldo por polling cada 15 segundos.

El menú se actualiza cada minuto y al volver a la ventana. La cuenta incluye pedidos aceptados y descuenta pagos aprobados, netos de reintegros. Checkout Pro conserva los repartos por ítems, partes iguales y porcentajes; firma y verifica notificaciones, recupera preferencias inciertas y reserva saldos para cobros pendientes. El panel de Restaurante muestra pagos y casos que requieren conciliación. Configuración y pruebas: [docs/MERCADO_PAGO.md](docs/MERCADO_PAGO.md). Ver pedidos y POS en [docs/SETUP.md](docs/SETUP.md).

## Estructura del monorepo

```
apps/
  customer/    App del comensal (mobile-first, se accede escaneando el QR de la mesa)
  admin/       Panel administrativo (carta, empleados, sucursales, salón, QR)
  pos/         Operación independiente (login de empleados, comandas, mesas, historial)
packages/
  shared/      Tipos de la DB (generados), schemas Zod y lógica de precios compartida
supabase/
  migrations/  Schema SQL versionado (Postgres)
  seed.sql     Datos demo: 2 restaurantes con menús distintos + usuarios admin
  functions/   submit-order, employee-accounts, mobile-payment y mercado-pago-webhook
  tests/       Pruebas de función, SQL e integración local
```

## Stack

- **Frontend**: React 19 + TypeScript + Vite 7, Tailwind CSS 4, React Router, TanStack Query y Zustand (carrito del comensal). Zod valida los contratos de `packages/shared`.
- **Backend**: Supabase (Postgres + RLS, Auth, Realtime, Storage, Edge Functions).
- **Integraciones**: Mercado Pago Checkout Pro mediante su SDK oficial; POS propio incluido; los POS externos (Fudo y otros) se integrarán a futuro.

## Cómo correr el proyecto

Requisitos: **Node >= 22** y **Docker** corriendo.

```bash
# 0. pnpm (viene con Node 22 vía corepack; omitilo si ya lo tenés)
corepack enable

# 1. Instalar dependencias
pnpm install

# 2. Crear los .env locales (no se versionan; los valores del stack local
#    son iguales en todas las máquinas, así que alcanza con copiarlos)
cp apps/admin/.env.example apps/admin/.env
cp apps/customer/.env.example apps/customer/.env
cp apps/pos/.env.example apps/pos/.env

# 3. Levantar Supabase local (la primera vez descarga imágenes, tarda varios minutos)
pnpm supabase start

# 4. Aplicar schema + datos demo
pnpm supabase db reset

# 4. Configurar .env de cada app (ver docs/SETUP.md; en local ya vienen creados)

# 5. Levantar las apps, cada una en su terminal
pnpm dev:pos        # POS de empleados      -> http://localhost:5175
pnpm dev:admin      # Panel del restaurante -> http://localhost:5174
pnpm dev:customer   # App del comensal      -> http://localhost:5173
pnpm dev:functions  # submit-order + employee-accounts
```

Entrá al panel en `http://localhost:5174` con `admin@esquina.demo` / `demo1234`, y al POS en `http://localhost:5175` con `pos.esquina` / `demo-pos1234`. Son sesiones independientes.
Detalle completo y resolución de problemas en **[docs/SETUP.md](docs/SETUP.md)**.

## Comandos útiles

```bash
pnpm typecheck        # typecheck de todos los paquetes
pnpm lint             # lint de todos los paquetes
pnpm test             # Vitest: carrito, tablero POS y contrato de submit-order
pnpm --filter pos test # login y vistas del POS según permisos
pnpm test:sql         # aserciones SQL contra el stack local (cada archivo en BEGIN … ROLLBACK)
pnpm test:employees:integration # Auth + Edge + RLS; requiere credenciales locales
pnpm test:orders:integration # pruebas contra el stack local + Edge Functions (pedidos y cierre de sesión)
pnpm test:payments:integration # Auth, Vault, RPCs y carga local; Mercado Pago simulado
pnpm build            # build de producción de todas las apps
pnpm ci:local         # lo mismo que el job "check" del CI: install, test, typecheck, lint y build
pnpm format           # Prettier con la convención del repo (sin punto y coma, comillas simples, 120 columnas)
pnpm format:check     # qué archivos no la siguen, sin tocarlos
pnpm db:types         # regenerar packages/shared/src/database.types.ts desde la DB local
pnpm db:schema        # regenerar supabase/schema.generated.sql (el schema de hoy, de una sola lectura)
pnpm supabase stop    # apagar el stack local
pnpm supabase status  # ver URLs y credenciales del stack local
```

- **Supabase Studio** (explorar la DB visualmente): http://127.0.0.1:54323
- **`supabase/schema.generated.sql`** es el schema tal como quedó: las migraciones son append-only y redefinen varias veces la misma función (`transition_order` seis veces), así que este archivo es el único lugar donde se lee de corrido qué hace hoy. Se genera con `pnpm db:schema` y el CI falla si quedó desactualizado; no se edita a mano.
- El CI (GitHub Actions) corre dos jobs en cada push/PR: pruebas de lógica (un solo runner: `vitest`), typecheck (incluida la lógica Edge), lint y build; y otro que levanta Supabase local para verificar el snapshot del schema, las aserciones SQL y la suite integrada.

Modelo, matriz de permisos y transición de empleados legacy: [docs/pos-accounts.md](docs/pos-accounts.md).
