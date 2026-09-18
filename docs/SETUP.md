# Guía de setup: Supabase y variables de entorno

Esta guía cubre cómo dejar funcionando el backend (Supabase) y los archivos `.env` de las apps, tanto en **local** (recomendado para desarrollo) como en la **nube** (para deployar o compartir).

---

## 1. Supabase local (desarrollo)

El proyecto usa la CLI de Supabase (ya incluida como dependencia del monorepo: se invoca con `pnpm supabase ...`) para levantar un stack completo en Docker: Postgres, Auth, Realtime, Storage y Studio.

### Requisitos

- Docker Desktop (u otro runtime de Docker) **corriendo**.
- Node >= 22. `pnpm` viene con Node vía corepack: si `pnpm -v` falla, corré `corepack enable`.

### Pasos

```bash
# 1. Instalar dependencias del monorepo
pnpm install

# 2. Crear los .env locales (ver sección 2: no se versionan)
cp apps/admin/.env.example apps/admin/.env
cp apps/customer/.env.example apps/customer/.env

# 3. Levantar el stack (la primera vez descarga las imágenes, ~5 min)
pnpm supabase start

# 4. Aplicar el schema y los datos demo (migraciones + seed)
pnpm supabase db reset
```

Después, cada app en su terminal:

```bash
pnpm dev:admin      # http://localhost:5174
pnpm dev:customer   # http://localhost:5173
pnpm dev:functions  # necesario para que el comensal pueda enviar pedidos
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
- **Sectores del salón**: La Esquina Burger tiene `Salón principal` (Mesas 1-3 y una `Barra de apoyo` oculta de 8 × 1 celdas) y `Terraza` (Mesa 4); Trattoria Nonna tiene `Salón` con sus 3 mesas, incluida una de 7 × 3 para 8 personas.
- **Empleados del POS con PIN** (desbloquean el salón, no tienen cuenta propia):
  - La Esquina Burger: `Ana (mozo)` → `1234`, `Bruno (cajero)` → `5678`
  - Trattoria Nonna: `Carla (mozo)` → `1234`

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
- Los `.env` **no se versionan** (`.gitignore`), así que un clon nuevo no los tiene: hay que copiarlos desde los `.env.example`, que ya vienen con los valores del stack local. La anon key local es la misma en todas las máquinas porque el stack local firma siempre con el mismo JWT secret de demo.
- Si alguna vez no coincide, `pnpm supabase status -o env` imprime los valores reales de tu stack.

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
pnpm --filter customer test
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
pnpm --filter customer test
pnpm test:orders
pnpm test:orders:integration
docker exec -i supabase_db_TP psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/orders.sql
docker exec -i supabase_db_TP psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/pos.sql
pnpm typecheck
pnpm lint
pnpm build
```

La suite integrada necesita el seed demo y la función activa. Usa 32 verificaciones HTTP/Realtime con fixtures propios que elimina al terminar, sin modificar los menús existentes. Crea tres usuarios Auth anónimos locales; si se proporciona `SUPABASE_SERVICE_ROLE_KEY` solo al proceso de pruebas, también los elimina. No colocar esa clave en un `.env` del frontend. Las pruebas SQL crean fixtures dentro de `BEGIN … ROLLBACK` e incluyen pagos aprobados/rechazados, sin invocar proveedores de pago.

**Resultado de implementación:** migración aplicada; 28 verificaciones integradas, aserciones SQL y 16 pruebas de lógica correctas; typecheck, lint y build verificados. También se comprobó en Chrome a 390 × 844 px el flujo QR → carrito → confirmación → cuenta, sin errores de consola ni desbordamiento horizontal. Se simuló una respuesta perdida y el cierre de sesión: recargar y reintentar recuperó el pedido existente sin duplicarlo. La aceptación manual completa de todos los escenarios queda como recorrido adicional.

### Cómo se confirma un pedido

El contrato compartido limita cada envío a 50 ítems, cantidades de 1 a 99, opciones e ingredientes únicos y observaciones de hasta 500 caracteres. No acepta precios unitarios ni identidad del participante enviados por el cliente. El servidor obtiene la identidad de Auth y valida pertenencia, sesión abierta, mesa/sucursal activa, producto/categoría, modificadores mínimos/máximos e ingredientes removibles/disponibles.

`submit_order` toma una captura consistente del menú y guarda pedido y detalles en una transacción. El `requestId` identifica el intento: el mismo contenido recupera el pedido existente, incluso después de cambiar la carta o cerrar la sesión; otro contenido con esa misma clave se rechaza. Si el importe real difiere del total revisado, se revierte todo.

El adaptador interno confirma recepción mediante `dispatch_internal_order`, con estado, timestamp y log en otra transacción idempotente. Si ese paso falla, el pedido queda **enviado, por confirmar** y un reintento completa el despacho. Una integración inactiva o `fudo` devuelve un error explícito; los adaptadores externos se implementarán a futuro. Los navegadores, incluido el admin, no pueden escribir directamente precios, snapshots o estados de pedidos.

La vista `session_bills` usa `security_invoker` para respetar las [políticas RLS de sus tablas](https://supabase.com/docs/guides/database/postgres/row-level-security). Agrega pedidos y pagos por separado para evitar multiplicar importes. No implementa cobros ni repartos; corresponden a la Fase 7.

## 7. Probar el POS propio (Fase 5)

Con el stack local iniciado, aplicar la migración del POS sin borrar datos:

```bash
pnpm supabase migration up --local
```

En terminales separadas: `pnpm dev:functions`, `pnpm dev:customer` y `pnpm dev:admin`. El panel abre en el POS (`http://localhost:5174/pos`).

Recorrido de aceptación:

1. Desde el comensal, enviar un pedido personalizado (con modificadores, ingrediente quitado y nota). En **Comandas** debe aparecer en **Nuevo** con mesa, comensal, detalle de opciones y total, sin recargar.
2. **Aceptar** solo si quedó *enviado, por confirmar*. Si el adaptador interno ya lo recibió, usar **Preparar** → **Marcar listo** → **Entregar**. El comensal debe ver cada estado. **Cancelar** un pedido no entregado lo saca de la cuenta.
3. En **Mesas activas**, la mesa ocupada muestra comensales, por confirmar / en cuenta / pagado / pendiente y las comandas en cocina. Las mesas sin sesión aparecen como libres.
4. Cerrar la sesión con saldo pendiente: el diálogo advierte que el efectivo no se registra todavía. Tras cerrar, el comensal no puede enviar más pedidos en esa cuenta y puede abrir una sesión nueva. Las comandas en cocina siguen en el tablero, marcadas como sesión cerrada.
5. Un segundo perfil en el mismo QR entra a la sesión nueva, con cuenta vacía. El historial del día conserva ambos pedidos.
6. En **Historial**, filtrar por fecha y estado, buscar por mesa o producto y abrir el detalle con modificaciones. Un admin de otro restaurante demo no debe ver estas comandas.
7. Verificar aislamiento: `admin@nonna.demo` no avanza ni cierra pedidos de La Esquina.

Pruebas reproducibles (además de las de la sección 6):

```bash
pnpm test:orders
pnpm test:orders:integration
docker exec -i supabase_db_TP psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/pos.sql
pnpm typecheck
pnpm lint
pnpm build
```

`close_table_session` es exclusiva de miembros del restaurante, idempotente y usa el mismo orden de bloqueo mesa → sesión que el ingreso por QR. Los navegadores no pueden cambiar el estado de una sesión con un `update` directo.

**Resultado de implementación:** migración aplicada; 32 verificaciones integradas (incluye consulta anidada del tablero, cierre por RPC, aislamiento y Realtime de cierre); aserciones SQL de POS y pedidos; 18 pruebas de lógica (9 de pedidos/POS + 9 del comensal); typecheck, lint y build verificados. El cobro con Mercado Pago y el cierre automático al saldar siguen en la Fase 7.

---

## 8. Probar el POS desacoplado del admin (MI-61)

El POS ya no comparte permisos con el backoffice. Hay dos capas:

- **Rol de la cuenta** (`restaurant_members.role`): `owner` administra carta, precios, mesas y configuración; `staff` solo opera el salón. La RLS aplica esta regla en la base, no solo en la UI.
- **Empleado del POS** (`pos_employees`): la persona que atiende, identificada por PIN sobre el dispositivo compartido. Sus acciones quedan en `pos_audit_log`.

Aplicar la migración sin borrar datos:

```bash
pnpm supabase migration up --local
```

Recorrido de aceptación:

1. Ingresar como `admin@esquina.demo` y abrir `http://localhost:5174/pos`: el POS pide PIN antes de mostrar comandas.
2. Ingresar `1234`: el encabezado muestra `Ana (mozo)` y se habilitan comandas, mesas e historial.
3. Avanzar una comanda y cerrar una sesión de mesa. En **Empleados → Actividad reciente del POS** aparecen ambas acciones con el nombre del empleado.
4. Tocar **Bloquear**: el POS vuelve a pedir PIN. Tras 10 minutos sin actividad se bloquea solo.
5. Un PIN incorrecto no desbloquea. Desactivar a `Ana` desde **Empleados** y comprobar que su PIN deja de servir.
6. Con un usuario de rol `staff` (se crea insertando una fila en `restaurant_members` con `role = 'staff'`), la barra lateral solo muestra **POS** y entrar a mano a `/productos` redirige a `/pos`. Un `update` directo sobre productos o precios lo rechaza la RLS.
7. Si el restaurante no tiene empleados activos, el administrador puede operar el POS con un aviso, y las acciones quedan asociadas a su usuario.

Pruebas reproducibles:

```bash
docker exec -i supabase_db_TP psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/pos-employees.sql
pnpm typecheck
pnpm lint
pnpm build
```

El PIN se guarda con bcrypt y el hash queda fuera del `grant` de columnas, así que no sale por PostgREST. `pos_audit_log` es de solo lectura para la app: las entradas las escriben `verify_pos_pin`, `pos_transition_order` y `pos_close_table_session`, que son los envoltorios auditados de las RPC del POS.

---

## 9. Configurar el salón: sectores y layout (MI-66)

El local se representa en dos niveles: **sectores** (`floor_sections`) dentro de una sucursal, y **mesas** ubicadas en una grilla de 24 × 16 celdas dentro de un sector. La geometría vive en `packages/shared/src/floor.ts`, así que el plano que guarda el administrador es el mismo que después dibuja el POS.

Cada mesa declara su **ancho y alto en celdas** (`width`, `height`, de 1 a 12): no hay tamaños predefinidos. `shape` es solo estilo visual, `rect` o `round`. Una mesa alargada es simplemente una con ancho distinto del alto.

La pantalla tiene dos modos:

- **Visualizar** (el que abre por defecto): el plano de solo lectura, con el resumen de mesas operables y lugares del sector. Es lo que conviene mirar durante el servicio.
- **Editar**: agrega el alta de sectores y mesas, el arrastre, el redimensionado y el panel de propiedades.

Cada mesa tiene dos banderas que responden preguntas distintas:

- `is_active`: la mesa está fuera de servicio. Su QR tampoco abre sesión.
- `is_visible`: la mesa existe y funciona, pero no se dibuja en el plano operativo (barra de apoyo, mobiliario que no se atiende).

Ninguna de las dos se ofrece para operar desde el POS.

Aplicar la migración sin borrar datos:

```bash
pnpm supabase migration up --local
```

Recorrido de aceptación (como `admin@esquina.demo`, en **Salón**):

1. El sector `Salón principal` muestra su plano con Mesa 1, Mesa 2, Mesa 3 y la `Barra de apoyo` en gris punteado (oculta).
2. Crear un sector nuevo. Repetir un nombre existente en la misma sucursal da un error claro; el mismo nombre en otra sucursal se acepta.
3. En **Editar**, arrastrar una mesa: al soltar se guarda la celda. Si se superpone con otra queda en rojo y no se guarda. Las flechas del teclado la mueven de a una celda.
4. Con la mesa seleccionada, tirar del cuadradito de la esquina inferior derecha para cambiarle el tamaño. También se puede escribir ancho y alto en el panel derecho (1 a 12 celdas cada lado).
5. Cambiar identificador, capacidad, forma y sector desde el panel. Un identificador repetido en la sucursal se rechaza; al cambiar de sector la mesa entra en un hueco libre del destino.
6. Apagar **Visible en el plano operativo**: en **POS → Mesas activas** esa mesa deja de figurar como libre.
7. Apagar **Sector en uso**: todas las mesas de ese sector salen de la operación, y en **Visualizar** el resumen lo advierte.
8. Agregar una mesa al sector: aparece en el primer hueco libre, sin pisar a las existentes.
9. Eliminar un sector con mesas: las mesas no se borran, quedan en **Mesas sin sector** y se pueden reubicar con un clic.
10. Con un usuario de rol `staff`, `/salon` redirige a `/pos` y la RLS rechaza cualquier escritura sobre sectores o layout.

Pruebas reproducibles:

```bash
docker exec -i supabase_db_TP psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/floor.sql
pnpm test:orders
pnpm typecheck
pnpm lint
pnpm build
```

Una mesa solo puede pertenecer a un sector de su propia sucursal: lo garantiza una clave foránea compuesta `(section_id, branch_id)`, no una validación de la UI. Borrar un sector anula `section_id` y conserva la mesa y su QR.

---

## 10. Mapa operativo y estados de mesa (MI-62/MI-63)

En **POS → Salón**, el plano configurado por el administrador se combina con la sesión abierta de cada mesa. Los estados tienen prioridad operativa: cobro pendiente, cuenta solicitada, listo para servir, pedido pendiente, en preparación, ocupada y libre. Cada color incluye su rótulo para no depender únicamente de la percepción cromática.

Una mesa ocupada muestra directamente tiempo desde la apertura, total incorporado a la cuenta y empleado responsable. Al tocarla aparece el resumen ampliado, sin abrir la comanda. El responsable es el último empleado que operó uno de sus pedidos; si nadie lo hizo todavía se muestra **Sin asignar**.

Recorrido de aceptación:

1. Abrir **POS → Salón**, cambiar de sector y comprobar que las mesas conservan posición, forma y tamaño.
2. Abrir el QR de una mesa sin sesión: figura **Libre**. Al ingresar desde el comensal pasa a **Ocupada**.
3. Enviar un pedido y recorrer sus estados desde **Comandas**. El mapa cambia entre **Pedido pendiente**, **En preparación** y **Listo para servir** sin recargar.
4. Confirmar que, al operar con PIN, el nombre del empleado aparece como responsable de la mesa.
5. Verificar que tiempo y total se actualizan en el bloque de la mesa y en el resumen táctil.
6. Crear un pago `pending` de prueba: la mesa pasa a **Cobro pendiente**; un pago rechazado o cancelado no conserva ese estado.
7. Hasta incorporar las acciones del comensal de MI-38/MI-46, marcar desde Studio `bill_requested_at = now()` o `in_person_payment_requested_at = now()` en una sesión abierta y comprobar los estados **Cuenta solicitada** y **Cobro pendiente**.
8. Desactivar u ocultar una mesa, un sector o una sucursal: deja de aparecer en el mapa operativo.

Realtime invalida el mapa ante cambios en sesiones, pedidos, pagos, empleados y layout. Además hay un respaldo de consulta cada 15 segundos para sesiones y cuenta.

Pruebas reproducibles:

```bash
pnpm test:orders
docker exec -i supabase_db_TP psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/pos-employees.sql
docker exec -i supabase_db_TP psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/pos.sql
pnpm typecheck
pnpm lint
pnpm build
```

---

## 11. Abrir y continuar comandas desde el plano (MI-64)

Tocar una mesa del plano abre su **comanda**: `/pos/salon/<tableId>`. Es la misma pantalla para una mesa libre y una ocupada, porque la RPC `pos_open_table_session` es idempotente — si la mesa ya tiene sesión abierta la devuelve en lugar de fallar, así dos mozos que tocan la misma mesa a la vez terminan en la misma comanda.

A diferencia de `join_table_session` (el ingreso por QR), abrir desde el POS **no suma al mozo como comensal** de la mesa.

La sucursal y el sector viajan en la query (`/pos/salon?sucursal=…&sector=…`), así que **Volver al plano** deja el mapa en el mismo sector desde el que se entró. También sobrevive a recargar la página o compartir el link.

Recorrido de aceptación (como `admin@esquina.demo`, PIN `1234`):

1. En **POS → Salón**, tocar una mesa verde: el resumen ofrece **Abrir comanda**.
2. Abrir: la mesa pasa a ocupada en el plano, con tiempo, total y responsable.
3. **Volver al plano**: vuelve al mismo sector, no al primero.
4. Tocar la misma mesa: el botón dice **Continuar comanda** y entra a la sesión que ya existía, sin crear otra.
5. Que un comensal escanee el QR de esa mesa: entra a la comanda que abrió el mozo, no a una nueva.
6. Desde la comanda, avanzar el estado de un pedido y cerrar la sesión.
7. En **Empleados → Actividad reciente**, figuran `session.opened` y `session.resumed` con el empleado del PIN.
8. Una mesa fuera de servicio, oculta, o de un sector/sucursal dado de baja no se puede abrir: la RPC responde `TABLE_UNAVAILABLE` aunque se la llame a mano.

También se llega a la comanda desde **Mesas activas**: las mesas ocupadas tienen **Continuar comanda** y las libres son un link para abrirla.

Pruebas reproducibles:

```bash
docker exec -i supabase_db_TP psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/pos-open-session.sql
pnpm typecheck
pnpm lint
pnpm build
```

La apertura usa el mismo orden de bloqueo mesa → sesión que `join_table_session` y `close_table_session`, así que dos aperturas simultáneas se serializan y el índice único de una sesión abierta por mesa nunca se viola.
