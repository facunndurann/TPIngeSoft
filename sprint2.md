# Sprint 2 - Plan secuencial para ejecutar historias de Jira

Fuente: Jira `MI Sprint 2`, proyecto `MI` ("Menu Interactivo"). Ultima revision usada: Sprint activo con 15 historias.

Este archivo esta pensado para que un developer pueda decirle a una IA: "ejecuta la fase X leyendo `sprint2.md`" y la IA tenga claro que hacer, en que orden, que historias cubre y que no debe pisar.

## Estado actual importante

Ya hay una historia avanzada en el repo:

- `MI-43` - Division por porcentaje/ratio arbitrario.

Evidencia local:

- `supabase/migrations/20260918000000_bill_splitting.sql`
- `apps/customer/src/features/SessionOrders.tsx`, componente `BillSplitter`
- `apps/customer/src/features/orders-api.ts`, RPC `updateSessionSplit`

No rehacer `MI-43` desde cero. Si una fase toca division de cuenta, primero revisar esa implementacion y trabajar encima de ella.

## Historias actuales del Sprint 2

### POS, salon y mapa de mesas

- `MI-61` - Desacoplar POS del panel administrativo con validacion para empleados.
- `MI-62` - Ver mapa visual de mesas por sector.
- `MI-63` - Ver estado y datos clave de cada mesa en el mapa.
- `MI-64` - Abrir o continuar una comanda desde una mesa del mapa.
- `MI-65` - Mover una comanda de una mesa a otra.
- `MI-66` - Configurar layout de sectores y mesas.

### Cuenta y pagos

- `MI-38` - Pedir la cuenta desde la aplicacion.
- `MI-40` - Pagar desde el celular con medio electronico.
- `MI-41` - Dividir cuenta por cantidad de personas.
- `MI-42` - Dividir cuenta por items seleccionados.
- `MI-43` - Dividir cuenta por porcentaje o ratio arbitrario. Ya avanzado, no duplicar.
- `MI-46` - Pedir que venga un mozo a cobrar presencialmente.
- `MI-47` - Ver mesas que solicitaron cobro presencial.
- `MI-48` - Definir medios de pago habilitados por local.
- `MI-49` - Registrar estado de pagos y relacion con la cuenta.

## Fase 0 - Relevar base actual y no pisar MI-43

Objetivo: entender el estado real del repo antes de implementar otra fase.

Jira: preparacion transversal, especialmente `MI-43`.

Leer:

- `README.md`
- `docs/SETUP.md`
- `docs/DEPLOY.md`
- `apps/admin/src/features/pos/*`
- `apps/customer/src/features/SessionOrders.tsx`
- `apps/customer/src/features/orders-api.ts`
- `supabase/migrations/20260918000000_bill_splitting.sql`
- `packages/shared/src/database.types.ts`

Hacer:

1. Confirmar si `MI-43` esta completo o solo parcialmente implementado.
2. Anotar que existe `split_type = none | equal | percentages`.
3. Anotar que existe `split_allocations`.
4. Verificar si la UI de porcentajes valida 100%.
5. Verificar si la division ya impacta pagos reales o solo muestra montos.
6. No tocar esta logica salvo para integrarla con pagos o corregir un bug necesario.

Criterio de salida:

- La IA sabe que `MI-43` no debe rehacerse.
- Queda claro si `MI-41` y `MI-42` siguen pendientes aunque haya UI parcial de division.

## Fase 1 - Desacoplar POS del admin y validar empleados

Objetivo: separar el uso operativo del POS de la administracion sensible del restaurante.

Jira: `MI-61`.

Archivos probables:

- `apps/admin/src/App.tsx`
- `apps/admin/src/pages/AdminLayout.tsx`
- `apps/admin/src/features/pos/*`
- `apps/admin/src/auth/*`
- `apps/admin/src/restaurant/*`
- nueva migracion si hace falta modelar empleados/PIN/auditoria
- `packages/shared/src/database.types.ts`

Hacer:

1. Revisar rutas actuales del admin y POS.
2. Definir roles minimos:
   - administrador: puede editar carta, precios, mesas, configuracion.
   - empleado POS: solo puede operar salon, comandas, pedidos y cobros.
3. Agregar modelo o configuracion para empleados/PIN si no existe.
4. Crear pantalla o modal de validacion PIN para operar POS.
5. Bloquear rutas administrativas para usuario operativo.
6. Asegurar que un empleado no vea ni edite productos, precios ni configuracion.
7. Agregar bloqueo por inactividad o al finalizar una transaccion si el alcance da.
8. Registrar auditoria basica cuando un empleado opera una comanda.

Criterios de aceptacion:

- Un empleado puede operar POS sin entrar al backoffice.
- Un empleado no puede acceder a rutas de administracion sensible.
- Acciones operativas quedan asociadas al empleado validado o al menos al operador actual.
- Si no hay validacion, el POS pide PIN antes de operar.

## Fase 2 - Configurar layout de sectores y mesas

Objetivo: permitir al administrador representar el salon real del restaurante.

Jira: `MI-66`.

Archivos probables:

- `apps/admin/src/pages/TablesPage.tsx`
- `apps/admin/src/pages/SettingsPage.tsx`
- nuevos componentes en `apps/admin/src/features/floor/*` o similar
- nueva migracion para sectores/layout si el schema actual de `branches`/`tables` no alcanza
- `supabase/seed.sql`
- `packages/shared/src/database.types.ts`

Hacer:

1. Revisar el modelo actual de `branches` y `tables`.
2. Agregar sectores/salones si no existen.
3. Agregar a cada mesa datos de layout:
   - sector
   - posicion X/Y
   - capacidad
   - forma/tamano basico
   - visible/oculta para operacion
4. Crear UI admin para crear/editar sectores.
5. Crear UI admin para posicionar mesas dentro de un sector.
6. Validar identificadores duplicados dentro del local/sector.
7. Actualizar seed demo para tener al menos un sector con varias mesas.

Criterios de aceptacion:

- El admin puede crear/editar sectores.
- El admin puede ubicar mesas visualmente.
- Una mesa oculta o inactiva no aparece disponible para operar.
- El layout guardado se refleja luego en el mapa operativo.

## Fase 3 - Mapa visual de mesas por sector

Objetivo: mostrar al mozo/cajero un plano operativo del salon.

Jira: `MI-62`, base para `MI-63` y `MI-64`.

Archivos probables:

- `apps/admin/src/features/pos/PosPage.tsx`
- nuevos componentes `apps/admin/src/features/pos/FloorMap.tsx`
- `apps/admin/src/features/pos/api.ts`
- `apps/admin/src/features/pos/realtime.ts`
- `apps/admin/src/features/pos/types.ts`

Hacer:

1. Agregar tab o ruta del POS para "Salon" / "Mapa".
2. Cargar sectores del restaurante.
3. Permitir cambiar de sector.
4. Renderizar mesas segun X/Y, forma y tamano.
5. Mostrar identificador o numero de mesa.
6. Ocultar mesas inactivas/no operativas.
7. Permitir scroll/pan si el mapa no entra en pantalla.

Criterios de aceptacion:

- El POS muestra un mapa visual por sector.
- Cambiar de sector actualiza las mesas visibles.
- Las mesas inactivas no aparecen como operables.
- La vista es usable en notebook/tablet.

## Fase 4 - Estados y datos clave de mesas en el mapa

Objetivo: que el mapa sirva para priorizar atencion durante el servicio.

Jira: `MI-63`.

Depende de: Fase 3.

Archivos probables:

- `apps/admin/src/features/pos/ActiveTables.tsx`
- `apps/admin/src/features/pos/FloorMap.tsx`
- `apps/admin/src/features/pos/api.ts`
- `packages/shared/src/pos.ts`
- vistas/RPC SQL si faltan datos agregados por mesa

Hacer:

1. Para cada mesa, calcular estado:
   - libre
   - ocupada
   - con pedidos pendientes/preparacion
   - cuenta solicitada
   - cobro pendiente
2. Mostrar colores o indicadores claros por estado.
3. Mostrar datos minimos:
   - mesa
   - tiempo desde apertura
   - total acumulado
   - mozo/empleado asignado si existe
4. Refrescar con realtime o invalidacion existente del POS.
5. Asegurar que los cambios de pedido/cuenta actualicen el mapa.

Criterios de aceptacion:

- Una mesa libre se distingue de una ocupada.
- Una mesa con pedidos pendientes se distingue de una mesa solo ocupada.
- Una mesa con cuenta/cobro solicitado se ve claramente.
- Total acumulado y tiempo de apertura aparecen sin abrir la comanda.

## Fase 5 - Abrir o continuar comanda desde el mapa

Objetivo: que la operacion diaria del POS pueda empezar desde una mesa del mapa.

Jira: `MI-64`.

Depende de: Fases 1, 3 y 4.

Archivos probables:

- `apps/admin/src/features/pos/FloorMap.tsx`
- `apps/admin/src/features/pos/ActiveTables.tsx`
- `apps/admin/src/features/pos/CommandBoard.tsx`
- `apps/admin/src/features/pos/api.ts`
- migracion/RPC para abrir sesion/comanda desde POS si no existe

Hacer:

1. Al seleccionar una mesa libre, permitir abrir nueva sesion/comanda.
2. Al seleccionar una mesa ocupada, abrir o continuar comanda existente.
3. Asociar la comanda a la mesa correcta.
4. Conservar el sector al volver desde la comanda al mapa.
5. Respetar validacion de empleado/PIN de Fase 1.
6. Manejar errores de permisos o conflictos de sesion.

Criterios de aceptacion:

- Mesa libre permite iniciar comanda.
- Mesa ocupada abre comanda existente.
- Volver al mapa conserva contexto.
- Un usuario sin permiso no puede operar la mesa.

## Fase 6 - Mover comanda de una mesa a otra

Objetivo: reflejar cambios reales del salon sin perder pedidos ni cuenta.

Jira: `MI-65`.

Depende de: Fases 3, 4 y 5.

Archivos probables:

- `apps/admin/src/features/pos/FloorMap.tsx`
- `apps/admin/src/features/pos/api.ts`
- nueva migracion/RPC `move_table_session` o similar
- tests SQL en `supabase/tests/pos.sql`

Hacer:

1. Agregar accion "Mover comanda" desde mesa ocupada.
2. Permitir seleccionar mesa destino disponible.
3. Bloquear destino con comanda abierta, salvo que se implemente combinacion explicita.
4. Mover la sesion/comanda a la mesa destino en transaccion.
5. Actualizar mapa: origen queda libre, destino queda ocupado.
6. Registrar auditoria con origen, destino, usuario y timestamp.
7. Mostrar error claro si hay conflicto o falta permiso.

Criterios de aceptacion:

- La comanda queda asociada a la mesa destino.
- La mesa origen deja de figurar activa.
- No se pierden pedidos, estados ni importes.
- La operacion queda auditada.

## Fase 7 - Pedir cuenta y cobro presencial

Objetivo: que el comensal pueda avisar que quiere pagar y que el mozo lo vea.

Jira: `MI-38`, `MI-46`, `MI-47`.

Archivos probables:

- `apps/customer/src/features/SessionOrders.tsx`
- `apps/customer/src/features/SessionPanel.tsx`
- `apps/customer/src/features/orders-api.ts`
- `apps/admin/src/features/pos/ActiveTables.tsx`
- `apps/admin/src/features/pos/FloorMap.tsx`
- nueva migracion para solicitudes de cuenta/cobro si no alcanza `table_sessions`

Hacer:

1. En customer, agregar accion "Pedir cuenta".
2. Registrar la solicitud asociada a sesion/mesa/restaurante.
3. Mostrar estado al comensal: cuenta solicitada.
4. En customer, agregar opcion "Que venga un mozo a cobrarme".
5. Registrar solicitud de cobro presencial.
6. En POS/admin, mostrar mesas que pidieron cuenta o cobro presencial.
7. Integrar indicador con mapa de Fase 4.
8. Permitir marcar solicitud como atendida.
9. Evitar duplicados innecesarios si ya hay solicitud activa.

Criterios de aceptacion:

- El comensal puede pedir cuenta.
- El comensal puede pedir cobro presencial.
- El mozo ve esas mesas desde POS.
- El mapa marca esas mesas como prioridad de atencion.

## Fase 8 - Medios de pago habilitados por local

Objetivo: que el admin controle que metodos de pago ofrece el local.

Jira: `MI-48`.

Archivos probables:

- `apps/admin/src/pages/SettingsPage.tsx`
- `apps/customer/src/features/SessionOrders.tsx`
- `apps/customer/src/features/orders-api.ts`
- nueva migracion para configuracion de pagos por branch/restaurante

Hacer:

1. Modelar configuracion de medios de pago por local/sucursal.
2. Incluir opciones minimas:
   - pago electronico desde celular
   - cobro presencial/mozo
   - efectivo o pago externo si aplica
3. Exponer configuracion en admin.
4. Customer debe mostrar solo metodos habilitados.
5. POS debe respetar la configuracion al registrar cobros.

Criterios de aceptacion:

- Un local puede habilitar/deshabilitar medios de pago.
- Customer no muestra opciones deshabilitadas.
- POS/admin refleja la configuracion vigente.

## Fase 9 - Registro de pagos y relacion con la cuenta

Objetivo: dejar una base consistente para pagos parciales, electronicos y presenciales.

Jira: `MI-49`.

Depende de: Fases 7 y 8.

Archivos probables:

- `supabase/migrations/*`
- `supabase/tests/orders.sql`
- `packages/shared/src/database.types.ts`
- `apps/customer/src/features/orders-api.ts`
- `apps/admin/src/features/pos/api.ts`
- `apps/customer/src/features/SessionOrders.tsx`
- `apps/admin/src/features/pos/ActiveTables.tsx`

Hacer:

1. Revisar tabla `payments` y vista `session_bills`.
2. Asegurar campos necesarios:
   - sesion
   - restaurante
   - participante opcional
   - monto
   - estado
   - metodo
   - modo de division
   - referencia externa si hay proveedor
3. Crear RPCs si hace falta para registrar pagos sin permitir escrituras directas inseguras.
4. Hacer que `session_bills` compute:
   - total en cuenta
   - pagado aprobado
   - pendiente
   - saldado
5. Mostrar pagos y saldo en customer.
6. Mostrar pagos y saldo en POS/admin.
7. Probar que pagos pendientes/rechazados no descuentan saldo.

Criterios de aceptacion:

- El admin ve que esta saldado y que queda pendiente.
- Customer ve pagado y pendiente.
- Solo pagos aprobados reducen la cuenta.

## Fase 10 - Pago electronico desde celular

Objetivo: permitir iniciar y confirmar un pago electronico desde customer.

Jira: `MI-40`.

Depende de: Fases 8 y 9.

Archivos probables:

- nuevas Supabase Functions si se usa proveedor externo
- `apps/customer/src/features/SessionOrders.tsx`
- `apps/customer/src/features/orders-api.ts`
- `supabase/migrations/*`
- `docs/SETUP.md`
- `docs/DEPLOY.md`

Hacer:

1. Agregar accion "Pagar desde el celular".
2. Calcular monto del lado servidor segun el modo de pago elegido.
3. Crear pago `pending`.
4. Integrar proveedor sandbox o simulador controlado, segun alcance definido por el equipo.
5. Actualizar pago a `approved` o `rejected`.
6. Refrescar cuenta al volver del pago.
7. Evitar pagar sesiones cerradas o montos mayores al pendiente.

Criterios de aceptacion:

- El comensal puede iniciar pago electronico.
- Pago aprobado reduce pendiente.
- Pago rechazado no reduce pendiente.
- La cuenta se actualiza sin recargar manualmente o con reintento claro.

## Fase 11 - Division por cantidad de personas

Objetivo: repartir el total pendiente en partes iguales.

Jira: `MI-41`.

Depende de: Fase 9. Revisar `BillSplitter` antes de tocar.

Archivos probables:

- `apps/customer/src/features/SessionOrders.tsx`
- `apps/customer/src/features/orders-api.ts`
- `supabase/migrations/20260918000000_bill_splitting.sql`

Hacer:

1. Revisar el modo `equal` ya presente en `BillSplitter`.
2. Completar lo que falte para que sea una historia cerrada, no solo visual.
3. Permitir elegir cantidad de personas si no coincide con participantes activos.
4. Calcular monto por persona.
5. Integrar con creacion de pago parcial cuando exista Fase 10.
6. Mostrar pendiente restante tras cada pago.

Criterios de aceptacion:

- El total se divide en partes iguales.
- El usuario entiende cuanto paga cada persona.
- Varios pagos parciales reducen el saldo.

## Fase 12 - Division por items seleccionados

Objetivo: permitir que cada persona pague items especificos.

Jira: `MI-42`.

Depende de: Fase 9.

Archivos probables:

- `apps/customer/src/features/SessionOrders.tsx`
- `apps/customer/src/features/orders-api.ts`
- `supabase/migrations/*`

Hacer:

1. Mostrar items cobrables de pedidos en cuenta.
2. Permitir seleccionar items propios, compartidos o de toda la mesa segun el alcance.
3. Calcular subtotal de items seleccionados.
4. Crear pago por ese subtotal.
5. Representar que items ya fueron cubiertos total o parcialmente, si se modela esa trazabilidad.
6. Si no se modela trazabilidad por item en DB, documentar la limitacion y descontar solo por monto aprobado.

Criterios de aceptacion:

- El comensal elige items a pagar.
- El monto coincide con seleccion.
- La cuenta muestra pendiente luego del pago.

## Fase 13 - Integrar y cerrar MI-43 sin rehacerlo

Objetivo: terminar la historia de porcentaje/ratio sobre la base ya hecha.

Jira: `MI-43`, ya avanzada.

Archivos existentes:

- `supabase/migrations/20260918000000_bill_splitting.sql`
- `apps/customer/src/features/SessionOrders.tsx`
- `apps/customer/src/features/orders-api.ts`

Hacer:

1. Revisar si el modo `percentages` cumple la historia.
2. Validar que no se puedan guardar porcentajes distintos de 100%.
3. Integrar el porcentaje con pagos reales de Fase 10.
4. Mostrar resumen claro: porcentaje, monto a pagar y pendiente restante.
5. Agregar prueba o recorrido manual especifico.

Criterios de aceptacion:

- El comensal puede definir porcentaje/ratio.
- La app muestra cuanto paga cada uno.
- El pago usa el monto calculado por servidor o RPC, no solo por UI.
- No se duplica la implementacion existente.

## Verificacion final del Sprint 2

Comandos sugeridos:

```bash
pnpm --filter customer test
pnpm test:orders
pnpm test:orders:integration
pnpm typecheck
pnpm lint
pnpm build
```

Si se tocaron SQL/RLS/RPC/POS:

```bash
docker exec -i supabase_db_TP psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/orders.sql
docker exec -i supabase_db_TP psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/pos.sql
```

Recorrido manual minimo:

1. Admin configura sectores y layout de mesas.
2. Empleado/POS entra con validacion operativa.
3. POS ve mapa por sector.
4. Mesa libre aparece libre.
5. Abrir comanda desde mesa libre.
6. Mesa pasa a ocupada con total y tiempo.
7. Continuar comanda desde esa mesa.
8. Mover comanda a otra mesa disponible.
9. Customer pide cuenta.
10. POS/mapa muestra cuenta solicitada.
11. Customer pide cobro presencial.
12. POS/mapa muestra cobro presencial pendiente.
13. Admin configura medios de pago.
14. Customer solo ve medios habilitados.
15. Registrar pago aprobado y rechazado.
16. Verificar saldo pendiente.
17. Probar division partes iguales.
18. Probar division por items.
19. Probar porcentaje/ratio usando la implementacion ya existente.

## Formato de cierre para agentes IA

Cuando una IA ejecute una fase, debe cerrar con:

```md
### Resultado fase X
- Jira cubierto:
- Archivos modificados:
- Migraciones/RPCs:
- Pruebas ejecutadas:
- Recorrido manual:
- Pendientes/riesgos:
```


