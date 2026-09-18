# POS independiente: cuentas y permisos

Tres despliegues comparten Supabase y `packages/shared`: customer (5173), admin
(5174) y pos (5175). Cada aplicación usa una clave de almacenamiento Auth distinta.

## Matriz de autorización

Los permisos se resuelven en SQL desde `auth.uid()`. Los roles son conjuntos,
no niveles. `staff` conserva todos sus permisos operativos anteriores durante la
transición; owner conserva administración total. Owner/manager no ingresan al
POS sin un perfil de empleado y una asignación explícita de sucursal.

| Permiso | owner | manager | supervisor | waiter | cashier | kitchen | staff legacy |
| --- | --- | --- | --- | --- | --- | --- | --- |
| admin.manage | sí | sí | | | | | |
| employees.manage | sí | sí | | | | | |
| audit.read | sí | sí | | | | | |
| orders.read | sí | sí | sí | sí | sí | sí | sí |
| orders.accept / orders.deliver | sí | sí | sí | sí | | | sí |
| orders.prepare | sí | sí | sí | | | sí | sí |
| orders.cancel / orders.revert | sí | sí | sí | | | | sí |
| floor.read | sí | sí | sí | sí | sí | | sí |
| history.read | sí | sí | sí | sí | sí | | sí |
| payments.read / sessions.close | sí | sí | sí | | sí | | sí |

Kitchen sólo avanza accepted → in_preparation → ready. Los demás cambios
conservan la máquina de estados vigente. Las operaciones administrativas son de
alcance restaurante; los permisos operativos requieren sucursal asignada y activa.
Un manager gestiona sólo roles operativos; owner puede asignar manager. Nadie
puede conceder owner mediante la API de empleados.

## Identidad y política de ciclo de vida

Username: trim + minúsculas, 3–32 caracteres ASCII (`a-z`, `0-9`, `.`, `_`, `-`),
primero y último alfanuméricos. Índice único global y CHECK en Postgres. Nombres
visibles repetidos están permitidos. Las contraseñas viven sólo en Supabase Auth.

La API crea usuarios confirmados con `createUser(email_confirm: true)` y cambia
contraseñas con `updateUserById`; no usa invitaciones ni recuperación por email.
El dominio interno se configura igual en backend (`EMPLOYEE_EMAIL_DOMAIN`) y POS
(`VITE_EMPLOYEE_EMAIL_DOMAIN`). Usar un subdominio controlado sin buzones reales.
La configuración local tiene `auth.email.enable_confirmations = false`. Antes de
producción verificar SMTP, notificaciones de cambio de contraseña y recuperación:
no deben entregarse correos a ese subdominio. El POS no ofrece recuperación por
correo: un administrador restablece la contraseña.

Desactivar elimina acceso de la membresía inmediatamente por RLS, conservando la
cuenta y auditoría. No se eliminan cuentas globales desde un restaurante: podrían
pertenecer a otros. Nombre y contraseña globales sólo se modifican si el solicitante
puede gestionar todas las membresías de la cuenta. La API compensa eliminando el
usuario Auth recién creado si falla la transacción de perfil/membresías.

## Transición y despliegue

Aplicar las nuevas migraciones en orden; no modifican migraciones anteriores.
Crear cuentas con roles/sucursales explícitos en Empleados. Al vincular un empleado
legacy, la misma transacción desactiva su PIN y conserva su id y auditoría.
Las RPC de PIN quedan retiradas del acceso de clientes. No se pueden convertir
hashes de PIN a contraseñas. La auditoría histórica se conserva sin atribuirla a
una cuenta inferida. Los nuevos eventos registran actor_user_id y branch_id.

Configurar y desplegar `employee-accounts` con la clave service_role únicamente
en el entorno Edge. Configurar los tres frontends con URL y clave pública Supabase.
Para POS: `pnpm dev:pos`; build: `pnpm --filter pos build`. En Vercel usar raíz
`apps/pos` y su reescritura SPA. El mismo backend sirve los tres dominios.

Rollback: volver a desplegar frontends anteriores requiere una migración revisada
que restaure sus RPC; no reactivar PIN automáticamente ni borrar perfiles o eventos.
Los cambios de esquema son aditivos salvo el retiro de firmas RPC legacy.
