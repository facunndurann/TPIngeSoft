# Plataforma de autoservicio para restaurantes

Plataforma web multi-restaurante de autoservicio: menú digital por QR de mesa, personalización de platos, pedidos grupales, menú inteligente asistido por LLM, POS propio integrado, beeper digital, y pago total o dividido con Mercado Pago.

> Setup detallado de Supabase y variables de entorno: **[docs/SETUP.md](SETUP.md)**

## Estado del proyecto

| Fase | Descripción | User Stories | Estado |
|------|-------------|--------------|--------|
| 0 | Monorepo, apps Vite, Supabase local, CI | — | Completa |
| 1 | Schema de DB completo, RLS, seed demo, tipos TS | — | Completa |
| 2 | Panel admin: auth, mesas + QR, categorías, productos, ingredientes, modificadores, etiquetas dietarias/alérgenos | MI-9, MI-10, MI-11, MI-25 | Completa |
| 3 | App comensal: menú con filtros dietarios, personalización, carrito, sesión compartida, agregar ítems a comanda existente | MI-1, MI-2, MI-8, MI-13, MI-24 | Pendiente |
| 4 | Pedidos: envío y validación server-side, estados (pendiente → en preparación → listo → entregado → cancelado), cancelación por comensal, realtime, cuenta | MI-3, MI-7, MI-12 | Pendiente |
| 5 | Beeper digital y auto-servicio: alertas sonoras/visuales/vibración, llamador desde cocina, re-llamada, confirmación de entrega, modo auto-servicio configurable | MI-16, MI-17, MI-18, MI-19, MI-20 | Pendiente |
| 6 | POS propio: tablero de comandas realtime (KDS) | MI-7 | Pendiente |
| 7 | Menú inteligente (LLM): chatbot conversacional, tarjetas interactivas, agregar al carrito desde chat, configuración de tono/especialidades/prioridades por el admin | MI-22, MI-26, MI-27, MI-28 | Pendiente |
| 8 | Pagos: Mercado Pago sandbox, pago total, división equitativa y por consumo individual | MI-23 | Pendiente |
| 9 | Pulido y demo | — | Pendiente |

## Detalle de fases pendientes

### Fase 3 — App del comensal

- **Acceso por QR** — Escanear QR de mesa → acceso al menú del restaurante/sucursal (MI-1)
- **Catálogo navegable** — Categorías con fotos, precios y descripción (MI-2)
- **Filtros dietarios** — Seleccionar restricciones (Sin TACC, Vegano, Vegetariano, Sin Lactosa, etc.) → el menú oculta platos no aptos y marca "Apto con modificaciones" los que pueden adaptarse. Disclaimer de contaminación cruzada configurable (MI-24)
- **Personalización de platos** — Agregar/quitar ingredientes según reglas del admin (MI-8)
- **Carrito** — Individual y sesión compartida de mesa
- **Agregar ítems a comanda existente** — Re-escanear el QR retoma la sesión activa y permite sumar platos adicionales o postres durante la visita (MI-13)

### Fase 4 — Pedidos

- **Envío del pedido** — Confirmar y enviar pedido con validación server-side (MI-3)
- **Máquina de estados** — Completa: `pendiente → en preparación → listo → entregado` + `cancelado` (MI-7)
- **Cancelación por el comensal** — Solicitar cancelación si el pedido aún no fue preparado (MI-12)
- **Panel del personal** — Visualizar y gestionar pedidos por estado (pendientes, en proceso, cancelados) (MI-7)
- **Realtime** — Actualización vía Supabase Realtime
- **Resumen de cuenta** — Pre-pago

### Fase 5 — Beeper Digital y Auto-Servicio

> Fase nueva, derivada del Epic MI-15 en Jira. No existía en el plan original.

- **Estado en vivo** — El comensal ve el estado en vivo del pedido en su celular (MI-16)
- **Alerta "Listo para retirar"** — Al cambiar de estado, el celular dispara alerta visual + sonido continuo/intermitente + vibración (MI-16)
- **Botón "Entendido / Voy a retirar"** — Silencia la alerta y muestra número de comanda + punto de retiro (MI-16)
- **Web push** — Notificación si la pantalla está bloqueada o el navegador en segundo plano (MI-16)
- **Llamador desde cocina** — Cocina/barra marca "Listo" → dispara alerta al comensal + contador de espera en el panel (MI-17)
- **Re-llamada** — Botón "Re-llamar" para pedidos demorados en "Esperando Retiro"; se registra cantidad de re-llamados para auditoría (MI-18)
- **Confirmación de entrega** — Mostrador verifica número de orden → "Entregado" → archiva en KDS → pantalla de "¡Buen provecho!" al comensal (MI-19)
- **Toggle auto-servicio** — Modo "Beeper / Auto-servicio" configurable por local o sector. Desactivado = servicio a la mesa tradicional (MI-20)

### Fase 6 — POS (KDS)

- **Tablero de comandas realtime** — Para cocina/barra
- **Integración con estados** — Conexión directa con los estados de pedido de Fase 4

### Fase 7 — Menú Inteligente (LLM)

- **Chat conversacional** — Chatbot en lenguaje natural dentro del menú; el comensal pide sugerencias según gustos, antojos y presupuesto (MI-26)
- **Tarjetas interactivas** — Respuestas con foto, precio y descripción de los platos sugeridos (MI-26)
- **Restricciones dietarias** — El chatbot respeta las restricciones activas del comensal (MI-26)
- **Agregar al carrito desde el chat** — Botón "Agregar a la comanda" / "Personalizar" directo en las tarjetas del chat (MI-27)
- **Configuración del chatbot** — Panel admin para definir: tono del chatbot, especialidades del chef, platos prioritarios, sugerencias destacadas, promociones vigentes, maridaje (MI-22, MI-28)
- **Solo platos disponibles** — El chatbot solo sugiere platos en estado "Disponible" con stock (MI-22, MI-28)

### Fase 8 — Pagos

- **Mercado Pago** — Integración sandbox → producción
- **Pago total** — Pagar la cuenta completa
- **División de cuenta** — Por partes iguales o por consumo individual de cada comensal, sin depender del personal del restaurante (MI-23)

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
