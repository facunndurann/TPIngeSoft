# Refactor: POS independiente con cuentas globales de empleados

## Instrucción principal

Implementar una separación real entre el panel administrativo y el POS.

Crear una aplicación frontend nueva, `apps/pos`, para el dominio/subdominio del POS. El empleado debe iniciar sesión allí con su propia cuenta global y contraseña. No debe requerir, reutilizar ni depender de una sesión administrativa.

No crear otro proyecto Supabase ni otra base de datos. Mantener el monorepo actual, el backend Supabase existente y `packages/shared` como fuente común de tipos/utilidades.

El resultado final debe tener tres aplicaciones:

- `apps/customer`: menú y autoservicio de clientes.
- `apps/admin`: panel de administración, sólo para administradores/gestores.
- `apps/pos`: operación POS, sólo para empleados autenticados y habilitados.

## Flujo objetivo

```text
Administrador entra en apps/admin
  -> crea empleado: nombre visible, username global, contraseña, restaurante,
     sucursal(es) y rol(es)

Empleado entra en apps/pos (por ejemplo, pos.<dominio>)
  -> ingresa username global + contraseña
  -> el sistema autentica su cuenta
  -> el sistema resuelve desde backend su restaurante, sucursal(es) y permisos
  -> el empleado accede sólo a las funciones POS que su rol permite
```

El POS no debe pedir un PIN de empleado después de que un administrador inició sesión. El administrador no es intermediario ni dueño de la sesión de trabajo del empleado.

## Identidad global de empleado

Cada empleado debe tener una cuenta global propia, vinculada a `auth.users` de Supabase.

Separar explícitamente estos campos:

- `full_name`: nombre visible de la persona. **No** debe ser único globalmente; dos personas pueden llamarse igual.
- `username`: identificador de inicio de sesión global, único y case-insensitive. Ejemplos: `juan.perez`, `ana123`. Éste es el valor que debe rechazarse si ya existe, sin importar a qué restaurante pertenezca la otra cuenta.
- `password`: gestionada exclusivamente por Supabase Auth. Nunca crear una tabla con contraseñas o hashes propios.

El requisito de unicidad global se aplica al `username`, no al nombre visible. Implementar normalización (trim, minúsculas y reglas de caracteres permitidos) y una restricción única real en base de datos, no sólo una comprobación desde el frontend.

No reutilizar `pos_employees` como identidad de seguridad basada en PIN. Migrar/reemplazar ese concepto por cuentas de empleados autenticables. Los datos históricos y de auditoría existentes se deben preservar.

## Login con username usando Supabase Auth

Supabase Auth autentica por email o teléfono, no por un username arbitrario. Implementar el login con username sin exponer esta limitación a la UI.

Opción recomendada:

1. Mantener el `username` público como identificador de negocio.
2. Normalizarlo y convertirlo determinísticamente a un email interno, por ejemplo `<username>@employees.<dominio-controlado>`.
3. Crear el usuario de Supabase Auth con ese email interno y la contraseña elegida por el administrador.
4. Desde `apps/pos`, convertir el username ingresado al mismo email interno y usar `supabase.auth.signInWithPassword`.
5. No mostrar ni usar ese email interno como dato de contacto; es un detalle técnico de autenticación.

Antes de implementar, confirmar que la configuración de Supabase no envía confirmaciones o recuperación a ese email interno. Para recuperación de contraseña, implementar inicialmente restablecimiento por owner/manager o agregar en el futuro un email real y verificado por empleado.

No exponer `service_role` ni ninguna clave de administración en los frontends. La creación, eliminación o cambio de contraseña de cuentas Auth debe ejecutarse exclusivamente desde una Edge Function/backend seguro mediante la API administrativa de Supabase.

## Modelo de autorización

La cuenta global identifica a la persona. La membresía autoriza su acceso a un restaurante y sus roles determinan sus permisos.

Mantener o adaptar `restaurant_members` para relacionar `auth.users` con restaurantes. Extender el modelo para representar roles operativos, y crear una relación por sucursal si el empleado no debe operar todas las sucursales.

Modelo recomendado:

```text
auth.users
  1 ─ 1 profiles
           - id = auth.users.id
           - username_normalized UNIQUE
           - full_name

auth.users
  N ─ N restaurants mediante restaurant_members
           - user_id
           - restaurant_id
           - role

restaurant_members
  N ─ N branches mediante branch_memberships (si se usa alcance por sucursal)
           - membership_id o user_id + restaurant_id
           - branch_id
```

Aunque el producto inicial pueda asignar cada empleado a un solo restaurante, no codificar el sistema suponiendo que siempre será así. Resolver la membresía activa al iniciar sesión:

- Si tiene una sola membresía POS activa, entrar directamente a ese restaurante.
- Si tiene varias, mostrar un selector de restaurante/sucursal dentro de `apps/pos`.
- Si no tiene membresía POS activa, cerrar/acotar la sesión y mostrar acceso denegado.

El selector sólo debe listar membresías del usuario autenticado.

## Roles y permisos

No implementar roles sólo como una jerarquía numérica. Definir permisos explícitos y hacer que los roles sean conjuntos de permisos; esto permite roles no lineales, como cocina y caja.

Rol inicial sugerido:

- `owner`: propiedad y administración total del restaurante.
- `manager`: operación y gestión diaria; puede gestionar personal operativo según política, pero no transferir ownership.
- `supervisor`: supervisa salón y ejecuta acciones excepcionales autorizadas.
- `waiter`: comandas, mesas y operaciones normales de salón.
- `cashier`: cobros, cierres y operaciones de caja autorizadas.
- `kitchen`: consulta/actualización limitada de comandas de cocina; sin acceso a caja, carta o configuración.

Definir y documentar una matriz de permisos antes de codificar. Cada RPC/API debe verificar un permiso concreto; ocultar botones en UI no es autorización.

Migrar los roles actuales (`owner`, `staff`) sin bajar privilegios accidentalmente. Puede mantenerse `owner` para administración y sustituir/expandir `staff` por roles operativos. Centralizar la función de autorización para que sea testeable.

## Cambios de base de datos y backend

Crear migraciones nuevas, aditivas y reversibles cuando sea posible. No editar migraciones ya aplicadas.

### Perfil de cuenta

Crear `profiles` (o nombre equivalente) con:

- `id uuid primary key references auth.users(id) on delete cascade`;
- `username_normalized text not null`;
- `full_name text not null`;
- timestamps;
- unicidad global case-insensitive sobre el username normalizado;
- validaciones de longitud y caracteres permitidos.

Usar `citext` o índice único sobre una expresión normalizada, según la convención del proyecto. La unicidad debe ser segura ante condiciones de carrera.

### Membresías, roles y sucursales

Migrar el enum/modelo de roles con cuidado. Agregar roles nuevos y políticas/RPCs compatibles. Si se crea `branch_memberships`, asegurar FKs y unicidad apropiadas.

El propietario existente debe conservar `owner`. Para los empleados POS existentes:

- No es posible convertir PIN bcrypt en contraseña sin conocer el PIN original.
- Conservar `pos_employees` temporalmente o migrar sus nombres/auditoría.
- Crear cuentas globales desde admin y desactivar empleados PIN cuando sus cuentas estén habilitadas.
- No perder referencias históricas de `pos_audit_log`; agregar columnas de cuenta y mantener la información legacy mientras sea necesaria.

### Operaciones administrativas de empleados

Crear una Edge Function o endpoint backend seguro para que un `owner` (y un `manager` sólo si su permiso lo permite) pueda:

- crear usuario Auth interno con username y contraseña;
- crear perfil;
- crear membresía de restaurante y rol;
- asignar sucursales;
- cambiar nombre, roles, sucursales y estado;
- restablecer contraseña;
- eliminar o desactivar una cuenta según la política elegida.

El endpoint debe comprobar el permiso del solicitante antes de usar Admin API de Supabase. Debe manejar fallas parciales: si se crea `auth.users` y falla perfil/membresía, compensar la operación o dejar un estado recuperable y auditable.

No permitir que `apps/admin` llame directamente a `supabase.auth.admin`.

### Seguridad de POS y RLS

Actualizar RLS, RPCs y Edge Functions para que el JWT de la cuenta empleada sea la fuente de identidad. La autorización debe resolverse desde `auth.uid()` y sus membresías/roles del lado servidor.

Revisar y adaptar especialmente:

- `verify_pos_pin`: eliminarlo del flujo de login POS; retirarlo cuando la transición esté completa.
- `pos_transition_order`;
- `pos_close_table_session`;
- `record_pos_action`;
- cualquier RPC utilizada por el POS actual;
- políticas actuales basadas sólo en `is_restaurant_member`.

Las RPCs y políticas deben verificar siempre:

- `auth.uid()` autenticado;
- membresía activa en el restaurante del pedido/sesión/mesa;
- pertenencia a sucursal cuando aplique;
- permiso concreto para la acción;
- transición de estados válida;
- imposibilidad de operar IDs de otro restaurante/sucursal.

No confiar en `user_id`, `employee_id`, `restaurant_id`, `branch_id` o `role` enviados por el navegador como prueba de autorización. Derivar identidad de `auth.uid()` y validar el resto contra la base.

No desactivar RLS ni usar una service key desde clientes.

### Auditoría

Actualizar `pos_audit_log` para registrar la cuenta autenticada que efectuó la acción. Cada evento nuevo debe asociarse al menos con:

- `actor_user_id` (o equivalente) referido a `auth.users`;
- restaurante;
- sucursal, si aplica;
- acción, entidad afectada, timestamp y detalles.

No confiar en un `employee_id` enviado por el cliente. Preservar entradas históricas de PIN; pueden permanecer con el empleado legacy y sin nueva cuenta cuando no sea inferible.

## Nueva aplicación `apps/pos`

Crear `apps/pos` usando las convenciones existentes: Vite, React, TypeScript, React Router, React Query, Tailwind y Supabase JS.

Agregar scripts `dev`, `build`, `lint`, `typecheck`, despliegue y variables de entorno equivalentes a `apps/admin`. Actualizar scripts/documentación raíz para incluir `pnpm dev:pos`.

Rutas mínimas:

- `/login`: formulario username + contraseña.
- `/select-context`: sólo si la cuenta tiene más de un restaurante/sucursal habilitado.
- `/`: tablero POS según permisos.
- rutas operativas: comandas, salón, mesas activas, historial y/o caja según rol.

El POS debe tener su propio `AuthProvider`, contexto de membresía/contexto POS y layout. Puede reutilizar código común, pero no importar `RestaurantGate`, `RequireAdmin`, `PosGate`, `PosOperatorProvider` ni el layout de `apps/admin`.

Tras login, obtener el contexto de acceso desde una API/RPC segura. Debe devolver sólo los restaurantes/sucursales/permisos del usuario autenticado.

Reutilizar y adaptar desde `apps/admin/src/features/pos`:

- `PosPage.tsx`;
- `CommandBoard.tsx`;
- `FloorMap.tsx`;
- `ActiveTables.tsx`;
- `OrderHistory.tsx`;
- `OrderTicket.tsx`;
- `api.ts`, `realtime.ts`, `types.ts`, `useNow.ts`.

No trasladar sin revisar sus llamadas: cada lectura y mutación debe adaptarse al nuevo modelo de cuenta, rol y sucursal.

El POS no debe incluir rutas, enlaces, navegación ni APIs administrativas. Tampoco onboarding de restaurante, gestión de empleados, ni fallback que permita operar al owner porque no hay empleados creados.

## Limpieza de `apps/admin`

Dejar `apps/admin` para:

- restaurante, sucursales, carta, precios, productos y modificadores;
- salón, mesas y QR;
- empleados: cuentas globales, roles, sucursales, estado y restablecimiento de contraseña;
- auditoría POS;
- configuración e integraciones.

Eliminar:

- ruta `/pos` y rutas POS hijas;
- enlace POS en `AdminLayout`;
- redirección inicial hacia `/pos`;
- `PosGate`;
- `PosOperatorProvider` y `operator-context`, si no queda uso válido;
- bloqueo de administración por un operador POS;
- lógica de PIN y fallback administrativo para operar salón.

`RequireAdmin` debe limitarse a permisos administrativos de la cuenta autenticada, sin conocer el estado de operación POS.

## Estrategia de ejecución

1. Relevar usos de `pos_employees`, PIN, `PosOperatorProvider`, RPCs, RLS y auditoría.
2. Definir la matriz de permisos y migración de roles/membresías/sucursales.
3. Crear perfiles globales, unicidad de username y backend seguro de provisión de empleados.
4. Implementar pruebas backend para creación de cuenta, colisiones de username, roles y aislamiento multi-tenant.
5. Adaptar RLS/RPCs POS para autenticar y autorizar mediante cuenta global y permisos.
6. Crear `apps/pos`, login username/contraseña, selección de contexto y vistas operativas.
7. Adaptar Empleados en `apps/admin` para gestionar cuentas mediante endpoint seguro.
8. Retirar POS y dependencias de PIN/sesión operativa de `apps/admin`.
9. Ejecutar transición de datos legacy, preservando auditoría.
10. Regenerar `packages/shared/src/database.types.ts`, actualizar documentación y verificar todo el workspace.

No dejar el JWT del administrador como fallback para el POS. El POS final debe funcionar tras login de empleado sin una sesión admin en el navegador.

## Criterios de aceptación y pruebas obligatorias

1. Un empleado abre el dominio POS sin sesión administrativa previa.
2. Inicia sesión con username global y contraseña válidos.
3. Dos usernames iguales, incluso en restaurantes distintos o con distinta capitalización, son rechazados.
4. Dos empleados con el mismo nombre visible pueden existir si los usernames difieren.
5. El login resuelve automáticamente el único restaurante/sucursal habilitado.
6. Si hay varios contextos permitidos, sólo puede elegir entre los propios.
7. Una cuenta sin membresía POS activa no puede acceder.
8. Un `waiter` no puede ejecutar caja, configuración, empleados ni carta aunque invoque RPCs directamente.
9. Un `kitchen` sólo puede realizar las transiciones permitidas de comandas.
10. Un empleado de restaurante A no puede leer, inferir ni mutar datos de restaurante B.
11. Se respeta alcance por sucursal si se implementa `branch_memberships`.
12. El cliente no puede falsificar otro usuario, rol, restaurante, sucursal o empleado.
13. Transiciones de pedido y cierres conservan sus reglas de negocio.
14. Auditoría nueva contiene cuenta autenticada, restaurante, sucursal aplicable y acción; la histórica no se pierde.
15. Admin crea empleados/restablece contraseñas sin exponer claves administrativas.
16. `apps/admin` no contiene rutas, navegación ni providers POS.
17. `apps/pos` no contiene rutas, navegación ni funciones administrativas.
18. Pasan pruebas SQL, integración/API y frontend, además de `pnpm typecheck`, `pnpm lint` y `pnpm build`.

## Entregables

- `apps/pos` funcional, desplegable de forma independiente y con login de empleados.
- Esquema de perfiles globales, username único, roles y membresías/sucursales.
- Edge Function/backend seguro para administrar cuentas de empleados.
- RLS, RPCs y auditoría adaptadas a autorización por cuenta y permiso.
- `apps/admin` sin POS integrado y con gestión completa de empleados.
- Migración segura desde empleados con PIN, sin pérdida de auditoría histórica.
- Tipos Supabase regenerados, pruebas y documentación de setup/despliegue actualizadas.
