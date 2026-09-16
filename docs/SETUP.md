# Guía de setup: Supabase y variables de entorno

Esta guía cubre cómo dejar funcionando el backend (Supabase) y los archivos `.env` de las apps, tanto en **local** (recomendado para desarrollo) como en la **nube** (para deployar o compartir).

---

## 1. Supabase local (desarrollo)

El proyecto usa la CLI de Supabase (ya incluida como dependencia del monorepo: se invoca con `pnpm supabase ...`) para levantar un stack completo en Docker: Postgres, Auth, Realtime, Storage y Studio.

### Requisitos

- Docker Desktop (u otro runtime de Docker) **corriendo**.
- Node >= 22 y pnpm >= 10.

### Pasos

```bash
# 1. Instalar dependencias del monorepo
pnpm install

# 2. Levantar el stack (la primera vez descarga las imágenes, ~5 min)
pnpm supabase start

# 3. Aplicar el schema y los datos demo (migraciones + seed)
pnpm supabase db reset
```

`supabase start` imprime las credenciales del stack local. Las importantes:

| Variable | Valor local |
|----------|-------------|
| `API URL` | `http://127.0.0.1:54321` |
| `anon key` | JWT que empieza con `eyJ...` (fijo para el stack local) |
| `Studio` | `http://127.0.0.1:54323` |

> Si las perdiste de vista: `pnpm supabase status` las vuelve a mostrar.

### Datos demo que crea el seed

- **2 restaurantes**: La Esquina Burger (hamburguesería) y Trattoria Nonna (italiana), cada uno con categorías, productos, ingredientes, modificadores, sucursal y mesas.
- **Usuarios admin** (solo existen en tu máquina):
  - `admin@esquina.demo` / `demo1234`
  - `admin@nonna.demo` / `demo1234`
- **QR tokens de mesas demo**: `demo-burger-mesa-1` a `4` y `demo-nonna-mesa-1` a `3`. La URL de una mesa es `http://localhost:5173/m/<token>`.

Para volver a un estado limpio en cualquier momento: `pnpm supabase db reset` (reaplica migraciones + seed).

---

## 2. Archivos .env

Cada app de Vite lee sus variables desde `apps/<app>/.env` (no se versiona; hay un `.env.example` de referencia en cada app).

### `apps/admin/.env`

```bash
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<anon key que imprime supabase start>
# URL base de la app del comensal: se usa para armar los links de los QR
VITE_CUSTOMER_APP_URL=http://localhost:5173
```

### `apps/customer/.env`

```bash
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<anon key que imprime supabase start>
```

Notas:

- La **anon key es pública por diseño** (viaja al navegador). La seguridad la aplican las políticas RLS de la base; la `service_role key` en cambio **nunca** va en un `.env` de frontend.
- Tras cambiar un `.env` hay que reiniciar el dev server de Vite.
- En este repo los `.env` locales ya vienen creados con los valores del stack local, porque son iguales para todos los entornos locales de Supabase.

---

## 3. Supabase en la nube (deploy / demo compartida)

Guía completa, desde crear la cuenta hasta Vercel y cómo publicar cambios: **[DEPLOY.md](./DEPLOY.md)**.

Resumen corto para usar un proyecto real de Supabase en lugar del local:

1. Crear un proyecto en [supabase.com](https://supabase.com) (plan free alcanza).
2. Loguear la CLI y vincular el proyecto:

   ```bash
   pnpm supabase login
   pnpm supabase link --project-ref <ref-del-proyecto>   # el ref aparece en la URL del dashboard
   ```

3. Aplicar las migraciones al proyecto remoto:

   ```bash
   pnpm supabase db push
   ```

4. **Habilitar sign-ins anónimos** (los usa la app del comensal al escanear el QR): en el dashboard, `Authentication → Sign In / Up → Allow anonymous sign-ins`. En local esto ya está habilitado vía `supabase/config.toml`.

5. Completar los `.env` de las apps con los valores del dashboard (`Settings → API`):
   - `VITE_SUPABASE_URL`: la URL del proyecto (`https://<ref>.supabase.co`)
   - `VITE_SUPABASE_ANON_KEY`: la anon/publishable key

6. Datos iniciales: el `seed.sql` es solo para local (crea usuarios de prueba directo en `auth.users`). En la nube: registrá una cuenta desde el panel admin y usá el onboarding de "Creá tu restaurante", o cargá datos desde Studio.

---

## 4. Problemas frecuentes

| Síntoma | Causa / solución |
|---------|------------------|
| `supabase start` falla con error de Docker | Docker no está corriendo. Abrí Docker Desktop y reintentá. |
| El panel muestra "Faltan las variables VITE_SUPABASE_URL..." | Falta el `.env` de esa app o el dev server no se reinició después de crearlo. |
| Login demo no funciona | El seed no está aplicado: `pnpm supabase db reset`. |
| Cambié el schema y el frontend no tipa | Regenerar tipos: `pnpm db:types`. |
| Puertos 54321-54324 ocupados | Otro proyecto Supabase local corriendo: `pnpm supabase stop --project-id <otro>` o cambiar puertos en `supabase/config.toml`. |


## 5. Probar la app comensal (Fase 3)

Con Supabase iniciado y las variables configuradas, aplicá solo las migraciones pendientes (conserva los datos existentes):

```bash
pnpm supabase migration up --local
pnpm dev:customer
```

La migración `20260905180000_customer_sessions.sql` incorpora `join_table_session`: autentica al participante, valida mesa/sucursal activa y crea o reutiliza la sesión abierta bajo un bloqueo de fila. También limita la lectura de participantes y sesiones a la mesa y al restaurante, y reemplaza las escrituras directas de comensales por esa función. En remoto, aplicar con `pnpm supabase db push`.

Recorrido de aceptación:

1. Abrir `http://localhost:5173/m/demo-burger-mesa-1`. Debe aparecer La Esquina Burger, Casa Central, Mesa 1 y su carta sin pedir login. Guardar un nombre.
2. Abrir el mismo enlace en otro navegador o ventana privada. Ambos deben mostrar la misma sesión y los nombres actualizados. Dos pestañas del mismo navegador comparten identidad; para simular personas usar perfiles separados.
3. Elegir Clásica: verificar que exige carne y guarnición; quitar cebolla y agregar bacon. Con vacuna, papas fritas y dos unidades, el total del seed es $19.600.
4. Agregar al carrito, marcar para compartir, editar opciones/cantidad, recargar y eliminar. El carrito de la otra persona debe permanecer independiente.
5. Abrir `http://localhost:5173/m/demo-nonna-mesa-1`: debe aparecer el menú italiano y un carrito independiente. Personalizar Pasta de la casa con pasta y salsa obligatorias.
6. Probar un QR inexistente, una mesa/sucursal desactivada y una caída de conexión: deben mostrarse errores con reintento. La carta puede consultarse aunque falle el ingreso a la sesión; agregar requiere una sesión válida.
7. Cambiar disponibilidad o precio desde admin y volver a la ventana del comensal (o esperar un minuto). El carrito debe reflejar precios vigentes y avisar selecciones inválidas.
8. Desde Studio, cerrar la sesión (`table_sessions.status = 'closed'`). Los clientes deben bloquear nuevas incorporaciones a ese carrito y ofrecer abrir otra sesión. La nueva sesión empieza con carrito vacío.

Pruebas automáticas de lógica, sin backend:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

La autenticación del comensal usa una clave de almacenamiento independiente de la del admin. Los carritos contienen borradores locales hasta confirmar el envío (Fase 4, abajo). Los nombres son opcionales al entrar (se usa «Comensal») y admiten hasta 40 caracteres.

**Verificación:** el ingreso concurrente por QR, el aislamiento RLS y Realtime se probaron contra Supabase local durante la implementación de la Fase 4. El recorrido visual anterior sigue disponible para aceptación manual.

## 6. Probar pedidos y cuenta (Fase 4)

Con el stack local iniciado, aplicar las migraciones pendientes sin borrar datos:

```bash
pnpm supabase migration up --local
```

En terminales separadas:

```bash
pnpm dev:functions
pnpm dev:customer
pnpm dev:admin
```

`dev:functions` sirve `submit-order` y recarga cambios automáticamente. Usa las variables `SUPABASE_URL` y `SUPABASE_ANON_KEY` del runtime local; no requiere un archivo de secretos ni una clave de servicio. En la nube, además de `pnpm supabase db push`, desplegar con `pnpm supabase functions deploy submit-order`. El JWT del comensal se valida y se conserva al llamar a Postgres, siguiendo la [autenticación de Edge Functions de Supabase](https://supabase.com/docs/guides/functions/auth-legacy-jwt).

Recorrido de aceptación:

1. Abrir el QR de una mesa en dos navegadores/perfiles distintos y guardar nombres diferentes. Personalizar un plato y agregarlo al carrito, incluyendo un producto para compartir.
2. En **Mi carrito**, elegir **Revisar pedido** y **Confirmar y enviar**. El carrito se vacía al confirmar el resultado y **Pedidos y cuenta** muestra el pedido recibido. El otro comensal debe verlo sin recargar.
3. Enviar una segunda ronda desde cualquiera de los participantes. Debe acumularse en la misma cuenta con atribución de cada consumo y detalle de modificaciones.
4. Cambiar un precio desde admin después de revisar el carrito y antes de confirmar. El servidor debe rechazar el total anterior, actualizar la carta y exigir una nueva revisión. No debe quedar un pedido parcial.
5. Simular pérdida de conexión al enviar. El carrito conserva el intento y bloquea ediciones; **Reintentar el mismo envío** recupera el resultado sin duplicar el pedido, incluso tras recargar.
6. Cambiar el nombre, precio u opciones de un producto después de pedirlo. El pedido ya enviado conserva sus snapshots.
7. Avanzar el pedido desde el **POS** del admin (`http://localhost:5174/pos`): **Preparar**, **Marcar listo** y **Entregar**. Deben actualizarse ambos comensales. Solo miembros del restaurante pueden hacerlo. La secuencia es `submitted → accepted → in_preparation → ready → delivered`; `cancelled` se permite antes de entregar y elimina ese importe de la cuenta. Repetir un estado no duplica sus registros.
8. Consultar **Pedidos y cuenta**: **Enviado, por confirmar** corresponde a pedidos todavía sin recepción del POS; **En cuenta** incluye los aceptados y posteriores; **Pagado** suma solo pagos aprobados; **Pendiente de pago** es la diferencia, con mínimo cero. La cuenta saldada requiere consumo positivo, saldo cero y ningún pedido esperando recepción. El cierre de sesión se hace desde el POS (Fase 5, abajo).

Pruebas reproducibles:

```bash
pnpm test
pnpm test:orders:integration
pnpm test:sql
pnpm typecheck
pnpm lint
pnpm build
```

La suite integrada necesita el seed demo y la función activa. Usa 32 verificaciones HTTP/Realtime con fixtures propios que elimina al terminar, sin modificar los menús existentes. Crea tres usuarios Auth anónimos locales; si se proporciona `SUPABASE_SERVICE_ROLE_KEY` solo al proceso de pruebas, también los elimina. No colocar esa clave en un `.env` del frontend. Las pruebas SQL crean fixtures dentro de `BEGIN … ROLLBACK` e incluyen pagos aprobados/rechazados, sin invocar proveedores de pago.

**Resultado de implementación:** migración aplicada; 28 verificaciones integradas, aserciones SQL y 16 pruebas de lógica correctas; typecheck, lint y build verificados. También se comprobó en Chrome a 390 × 844 px el flujo QR → carrito → confirmación → cuenta, sin errores de consola ni desbordamiento horizontal. Se simuló una respuesta perdida y el cierre de sesión: recargar y reintentar recuperó el pedido existente sin duplicarlo. La aceptación manual completa de todos los escenarios queda como recorrido adicional.

### Cómo se confirma un pedido

El contrato compartido limita cada envío a 50 ítems, cantidades de 1 a 99, opciones e ingredientes únicos y observaciones de hasta 500 caracteres. No acepta precios unitarios ni identidad del participante enviados por el cliente. El servidor obtiene la identidad de Auth y valida pertenencia, sesión abierta, mesa/sucursal activa, producto/categoría, modificadores mínimos/máximos e ingredientes removibles/disponibles.

`submit_order` toma una captura consistente del menú y guarda pedido y detalles en una transacción. El `requestId` identifica el intento: el mismo contenido recupera el pedido existente, incluso después de cambiar la carta o cerrar la sesión; otro contenido con esa misma clave se rechaza. Si el importe real difiere del total revisado, se revierte todo.

Con el POS interno, la misma transacción registra la recepción (estado **aceptado**, timestamp y log). Si la integración está inactiva o es `fudo`, se revierte todo con un error explícito y el mismo envío se puede reintentar más tarde; los POS externos se integrarán a futuro. El estado **enviado, por confirmar** queda para pedidos anteriores a este flujo. Los navegadores, incluido el admin, no pueden escribir directamente precios, snapshots o estados de pedidos.

La vista `session_bills` usa `security_invoker` para respetar las [políticas RLS de sus tablas](https://supabase.com/docs/guides/database/postgres/row-level-security). Agrega pedidos y pagos por separado para evitar multiplicar importes. No implementa cobros ni repartos; corresponden a la Fase 7.

## 7. Probar el POS propio (Fase 5)

Con el stack local iniciado, aplicar la migración del POS sin borrar datos:

```bash
pnpm supabase migration up --local
```

En terminales separadas: `pnpm dev:functions`, `pnpm dev:customer` y `pnpm dev:admin`. El panel abre en el POS (`http://localhost:5174/pos`).

Recorrido de aceptación:

1. Desde el comensal, enviar un pedido personalizado (con modificadores, ingrediente quitado y nota). En **Comandas** debe aparecer en **Nuevo** con mesa, comensal, detalle de opciones y total, sin recargar.
2. Con el POS interno el pedido llega **aceptado**: usar **Preparar** → **Marcar listo** → **Entregar**. El comensal debe ver cada estado. **Cancelar** un pedido no entregado lo saca de la cuenta.
3. En **Mesas activas**, la mesa ocupada muestra comensales, por confirmar / en cuenta / pagado / pendiente y las comandas en cocina. Las mesas sin sesión aparecen como libres.
4. Cerrar la sesión con saldo pendiente: el diálogo advierte que el efectivo no se registra todavía. Tras cerrar, el comensal no puede enviar más pedidos en esa cuenta y puede abrir una sesión nueva. Las comandas en cocina siguen en el tablero, marcadas como sesión cerrada.
5. Un segundo perfil en el mismo QR entra a la sesión nueva, con cuenta vacía. El historial del día conserva ambos pedidos.
6. En **Historial**, filtrar por fecha y estado, buscar por mesa o producto y abrir el detalle con modificaciones. Un admin de otro restaurante demo no debe ver estas comandas.
7. Verificar aislamiento: `admin@nonna.demo` no avanza ni cierra pedidos de La Esquina.

Pruebas reproducibles (además de las de la sección 6):

```bash
pnpm test
pnpm test:orders:integration
pnpm test:sql
pnpm typecheck
pnpm lint
pnpm build
```

`close_table_session` es exclusiva de miembros del restaurante, idempotente y usa el mismo orden de bloqueo mesa → sesión que el ingreso por QR. Los navegadores no pueden cambiar el estado de una sesión con un `update` directo.

**Resultado de implementación:** migración aplicada; 32 verificaciones integradas (incluye consulta anidada del tablero, cierre por RPC, aislamiento y Realtime de cierre); aserciones SQL de POS y pedidos; 18 pruebas de lógica (9 de pedidos/POS + 9 del comensal); typecheck, lint y build verificados. El cobro con Mercado Pago y el cierre automático al saldar siguen en la Fase 7.

## 8. Probar los guardados del panel

Los formularios del admin guardan con RPCs transaccionales: `create_restaurant`, `reorder_categories`, `save_modifier_group` y `save_product`. Si un paso falla, no queda nada guardado y reintentar no duplica filas. Con el stack local y las migraciones aplicadas (`pnpm supabase migration up --local`):

```bash
pnpm test:sql
```

Las aserciones cubren permisos (los comensales anónimos no pueden crear restaurantes), fallas a mitad de guardado, datos desactualizados y el orden de las listas. Corren dentro de `BEGIN … ROLLBACK`, junto con las de pedidos y POS.
