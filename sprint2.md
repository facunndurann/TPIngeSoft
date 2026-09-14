# Sprint 2 - Guia secuencial para integrantes y agentes IA

Este documento es el punto de entrada operativo para continuar el repo sin perder contexto. Esta pensado para que cualquier integrante del equipo, o su agente IA, pueda leerlo y ejecutar pasos en orden.

## 0. Contexto rapido

Producto: plataforma web multi-restaurante de autoservicio por QR para consultar menu, personalizar platos, hacer pedidos grupales, operar comandas en POS propio y pagar total o dividido.

Documentos fuente que hay que leer antes de tocar codigo:

1. `README.md`
2. `docs/plataforma_autoservicio_restaurantes.plan.md`
3. `docs/SETUP.md`
4. `docs/DEPLOY.md`
5. `Plataforma_Restaurantes.pdf`

Estado actual del repo:

- Fase 0 completa: monorepo, apps Vite, Supabase local y CI.
- Fase 1 completa: schema, RLS, seed y tipos.
- Fase 2 completa: panel admin con auth, mesas, QR, categorias, productos, ingredientes y modificadores.
- Fase 3 completa: app comensal, menu, personalizacion, carrito y sesion compartida.
- Fase 4 completa: pedidos, validacion server-side, estados, realtime y cuenta.
- Fase 5 completa: POS propio en admin, tablero realtime, mesas activas, cierre manual e historial.
- Fase 6 pendiente: menu inteligente con LLM.
- Fase 7 pendiente: pagos con Mercado Pago sandbox y division de cuenta.
- Fase 8 pendiente: pulido, disponibilidad en cascada, UX mobile, documentacion y demo.

Sprint 2 debe completar las fases pendientes sin romper lo ya validado.

## 1. Reglas de trabajo

1. Trabajar siempre desde la raiz del repo.
2. Crear una rama por bloque, por ejemplo `sprint2/smart-menu`, `sprint2/payments` o `sprint2/polish`.
3. Antes de editar, revisar los archivos involucrados y respetar patrones existentes.
4. No cambiar migraciones ya aplicadas salvo que sea imprescindible. Para cambios de DB, crear una nueva migracion en `supabase/migrations/`.
5. No hardcodear datos de un restaurante demo. Todo debe funcionar para cualquier restaurante.
6. Mantener separadas estas responsabilidades:
   - customer: experiencia del comensal.
   - admin: panel, POS y configuracion.
   - shared: contratos, tipos, schemas y calculos reutilizables.
   - supabase/functions: logica sensible de servidor.
   - supabase/migrations: schema, RLS, RPCs y vistas.
7. Todo flujo sensible debe validar en servidor. El navegador nunca decide precios finales, permisos, disponibilidad ni pagos aprobados.
8. Cada bloque termina con pruebas y una nota breve en README o docs si cambia el flujo.

Comandos base:

```bash
pnpm install
pnpm supabase start
pnpm supabase db reset
pnpm dev:functions
pnpm dev:customer
pnpm dev:admin
```

Verificacion minima antes de abrir PR:

```bash
pnpm --filter customer test
pnpm test:orders
pnpm typecheck
pnpm lint
pnpm build
```

Si el bloque toca DB/POS/pedidos, agregar:

```bash
pnpm test:orders:integration
docker exec -i supabase_db_TP psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/orders.sql
docker exec -i supabase_db_TP psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/pos.sql
```

## 2. Orden obligatorio del Sprint 2

Ejecutar los bloques en este orden. No empezar un bloque que dependa de otro hasta que el anterior compile y tenga pruebas basicas pasando.

1. Preparacion y auditoria.
2. Menu inteligente: contratos y datos.
3. Menu inteligente: edge function `recommend`.
4. Menu inteligente: UI en customer.
5. Pagos: schema, estados y contratos.
6. Pagos: funciones Supabase y Mercado Pago sandbox.
7. Pagos: UI de pago total/dividido.
8. Pulido: disponibilidad en cascada, errores, responsive y demo.
9. Documentacion final y recorrido de aceptacion.

## 3. Bloque 1 - Preparacion y auditoria

Objetivo: confirmar que el entorno local esta sano antes de sumar funcionalidad.

Pasos:

1. Leer los documentos fuente listados en la seccion 0.
2. Correr `pnpm install`.
3. Levantar Supabase con `pnpm supabase start`.
4. Resetear datos locales con `pnpm supabase db reset`.
5. Correr:

```bash
pnpm --filter customer test
pnpm test:orders
pnpm typecheck
pnpm lint
pnpm build
```

6. Registrar en la PR cualquier falla previa al cambio. No mezclar arreglos ajenos al bloque salvo que impidan avanzar.

Criterio de listo:

- El proyecto compila antes de implementar Sprint 2.
- El agente conoce las rutas principales:
  - `apps/customer/src/features`
  - `apps/admin/src/features`
  - `packages/shared/src`
  - `supabase/functions`
  - `supabase/migrations`
  - `supabase/tests`

## 4. Bloque 2 - Menu inteligente: contratos y datos

Objetivo: definir un contrato compartido para pedir recomendaciones sin que el LLM pueda inventar productos, precios ni modificadores.

Archivos probables:

- `packages/shared/src/schemas.ts`
- `packages/shared/src/pricing.ts`
- `packages/shared/src/index.ts`
- `packages/shared/src/database.types.ts`
- Nueva migracion si hace falta persistir preferencias, logs o resultados.

Pasos:

1. Definir el input del recomendador:
   - `sessionId`
   - cantidad de personas
   - presupuesto total o por persona
   - preferencias de comida
   - restricciones alimentarias
   - alergias o ingredientes a evitar
   - intencion de compartir
   - notas libres acotadas
2. Definir el output esperado:
   - 3 propuestas: economica, variada y para compartir.
   - items con `productId`, cantidad, modificadores permitidos, ingredientes removidos permitidos y motivo breve.
   - total estimado y total por persona.
3. Crear schemas Zod compartidos para input/output.
4. Asegurar que el output no acepte nombres libres como fuente de verdad. Debe referenciar IDs existentes.
5. Si se persisten logs, crear tabla con RLS segura. No guardar datos sensibles innecesarios.
6. Exportar los schemas desde `packages/shared/src/index.ts`.

Criterio de listo:

- Hay schemas compartidos.
- Los tipos impiden outputs ambiguos.
- No se agrego logica especifica para restaurantes demo.

## 5. Bloque 3 - Menu inteligente: edge function `recommend`

Objetivo: crear una Edge Function que use el menu real disponible, consulte un LLM y valide estrictamente la respuesta contra la DB.

Archivos probables:

- `supabase/functions/recommend/index.ts`
- `supabase/functions/recommend/handler.ts`
- `supabase/functions/_shared/errors.ts`
- `supabase/functions/_shared`
- `supabase/functions/deno.json`
- `package.json`

Pasos:

1. Crear la funcion `recommend` siguiendo el estilo de `submit-order`.
2. Autenticar al comensal con JWT.
3. Validar que el usuario pertenece a la sesion de mesa.
4. Leer solo menu disponible del restaurante/sucursal de la sesion:
   - productos activos
   - categorias activas
   - ingredientes disponibles
   - modificadores y opciones disponibles
   - precios reales
5. Construir un JSON compacto para el LLM.
6. Pedir exactamente 3 propuestas con salida JSON estructurada.
7. Validar respuesta contra Zod y contra DB:
   - IDs existentes
   - producto disponible
   - reglas min/max de modificadores
   - ingredientes removibles
   - presupuesto
   - precios calculados por servidor
8. Si una propuesta no valida, descartarla o reintentar una vez.
9. Devolver propuestas normalizadas, nunca texto crudo del LLM como fuente de verdad.
10. Agregar tests unitarios del handler cuando sea posible.

Variables esperadas:

```bash
OPENAI_API_KEY=<solo en entorno de funcion>
```

Notas:

- No colocar claves en `.env` de frontend.
- En local, usar secretos de Supabase o variables del proceso de `functions serve`.
- Si no hay clave LLM, la funcion debe devolver error claro y la UI debe permitir seguir usando menu tradicional.

Criterio de listo:

- La funcion compila con `pnpm typecheck`.
- Rechaza productos inventados.
- Rechaza modificaciones no permitidas.
- Nunca reemplaza el menu tradicional.

## 6. Bloque 4 - Menu inteligente: UI en customer

Objetivo: sumar una experiencia asistida en la app del comensal que termine en carrito editable.

Archivos probables:

- `apps/customer/src/features/MenuShell.tsx`
- `apps/customer/src/features/MenuBrowse.tsx`
- `apps/customer/src/features/CartPanel.tsx`
- Nuevos archivos bajo `apps/customer/src/features/smart-menu`
- `apps/customer/src/features/orders-api.ts` o archivo API nuevo.
- `apps/customer/src/stores/cart.ts`

Pasos:

1. Agregar entrada visible desde la experiencia de mesa, sin bloquear el menu tradicional.
2. Crear wizard mobile-first:
   - cantidad de personas
   - presupuesto
   - preferencias
   - restricciones
   - compartir si/no
3. Llamar a `recommend`.
4. Mostrar 3 propuestas comparables:
   - economica
   - variada
   - para compartir
5. Permitir revisar cada propuesta antes de agregar.
6. Convertir items recomendados a items de carrito usando las mismas reglas existentes.
7. Permitir editar, quitar o personalizar productos despues de aceptar propuesta.
8. Manejar errores:
   - sin clave LLM
   - sin productos disponibles
   - presupuesto imposible
   - respuesta invalida
   - sesion cerrada
9. Agregar pruebas de transformacion recomendacion -> carrito si existe patron de tests.

Criterio de listo:

- Un comensal puede pedir recomendaciones y agregarlas al carrito.
- El carrito sigue editable.
- La UI no impide navegar el menu tradicional.
- Funciona en viewport movil.

## 7. Bloque 5 - Pagos: schema, estados y contratos

Objetivo: completar el modelo de pagos para total y division sin mezclar pedido, cuenta y pago.

Archivos probables:

- Nueva migracion en `supabase/migrations/`
- `packages/shared/src/schemas.ts`
- `packages/shared/src/orders.ts`
- `packages/shared/src/pricing.ts`
- `supabase/tests/orders.sql`
- `supabase/tests/pos.sql`

Pasos:

1. Auditar tabla `payments` existente y vista `session_bills`.
2. Definir modos de pago:
   - total de la cuenta
   - mi consumo
   - partes iguales
   - monto custom
3. Crear contratos compartidos para iniciar pago.
4. Crear o ajustar RPCs/vistas para calcular monto en servidor.
5. Asegurar RLS:
   - participantes ven pagos de su sesion.
   - admins ven pagos de su restaurante.
   - nadie aprueba pagos desde navegador.
6. Definir estados:
   - `pending`
   - `approved`
   - `rejected`
   - `cancelled`
   - `expired`
7. Asegurar que la cuenta se salda solo con pagos `approved`.
8. Definir cierre automatico de sesion cuando:
   - hay consumo positivo
   - saldo pendiente es cero
   - no hay pedidos por confirmar
   - no hay pedidos activos que deban bloquear cierre, si asi queda definido por el equipo

Criterio de listo:

- El monto se calcula en DB/servidor.
- El cliente no puede modificar el saldo.
- Las pruebas SQL cubren saldos, pagos aprobados/rechazados y aislamiento.

## 8. Bloque 6 - Pagos: funciones Supabase y Mercado Pago sandbox

Objetivo: integrar Mercado Pago sin acoplar la logica del dominio al proveedor.

Archivos probables:

- `supabase/functions/create-payment/index.ts`
- `supabase/functions/create-payment/handler.ts`
- `supabase/functions/mp-webhook/index.ts`
- `supabase/functions/mp-webhook/handler.ts`
- `supabase/functions/_shared`
- `docs/SETUP.md`
- `docs/DEPLOY.md`

Pasos:

1. Crear `create-payment`.
2. Autenticar al participante.
3. Recibir modo de pago y parametros minimos.
4. Calcular monto server-side.
5. Crear preferencia en Mercado Pago sandbox.
6. Persistir pago `pending` con referencia externa.
7. Devolver URL/ID de checkout.
8. Crear `mp-webhook`.
9. Verificar firma o mecanismo recomendado por Mercado Pago.
10. Consultar el pago al proveedor si el webhook trae solo notificacion.
11. Actualizar pago segun estado real.
12. Si queda saldo cero, cerrar sesion automaticamente mediante RPC segura.
13. Agregar logs suficientes para depurar sin exponer secretos.

Variables esperadas:

```bash
MP_ACCESS_TOKEN=<sandbox access token>
MP_WEBHOOK_SECRET=<si aplica al mecanismo elegido>
PUBLIC_CUSTOMER_URL=<url app customer>
```

Criterio de listo:

- Se puede crear una preferencia sandbox.
- El webhook actualiza estado.
- Un pago rechazado no descuenta saldo.
- Un pago aprobado descuenta saldo.
- La sesion puede cerrarse automaticamente cuando corresponde.

## 9. Bloque 7 - Pagos: UI de pago total/dividido

Objetivo: permitir que la mesa pague desde la app del comensal viendo claramente consumo, pendiente y division.

Archivos probables:

- `apps/customer/src/features/SessionOrders.tsx`
- `apps/customer/src/features/SessionPanel.tsx`
- Nuevos archivos bajo `apps/customer/src/features/payments`
- `apps/customer/src/features/orders-api.ts` o API nueva.

Pasos:

1. Agregar accion de pagar desde "Pedidos y cuenta".
2. Mostrar:
   - total consumido
   - pagado
   - pendiente
   - pedidos por participante
   - productos compartidos
3. Ofrecer modos:
   - pagar todo
   - pagar mi consumo
   - dividir partes iguales
   - monto custom
4. Antes de crear checkout, mostrar resumen confirmable.
5. Llamar a `create-payment`.
6. Redirigir a Mercado Pago sandbox o abrir checkout segun integracion elegida.
7. Al volver, refrescar cuenta.
8. Mostrar estados pendientes/aprobados/rechazados.
9. Si la sesion se cierra por pago completo, bloquear nuevos pedidos y ofrecer iniciar nueva sesion al reescanear.

Criterio de listo:

- El comensal entiende que esta pagando.
- Los montos coinciden con `session_bills`.
- No se puede pagar una sesion cerrada.
- No se puede pagar mas que el saldo pendiente salvo decision explicita del equipo.

## 10. Bloque 8 - Pulido funcional y UX

Objetivo: cerrar deuda visible y reforzar demo.

Prioridades:

1. Disponibilidad en cascada:
   - producto no disponible no aparece para pedir.
   - modificador no disponible no se puede elegir.
   - ingrediente agotado invalida o avisa segun corresponda.
   - recomendador no usa nada no disponible.
2. Estados de error claros:
   - sesion cerrada
   - producto cambio de precio
   - modificador ya no disponible
   - fallo de Edge Function
   - fallo de pago
3. Mobile:
   - revisar QR -> menu -> producto -> carrito -> pedido -> cuenta -> pago.
   - evitar textos cortados y overflow horizontal.
4. Admin:
   - POS sigue actualizando realtime.
   - mesas activas reflejan pagos.
   - historial no se contamina entre restaurantes.
5. Accesibilidad basica:
   - botones con labels claros.
   - foco visible.
   - formularios con errores legibles.

Criterio de listo:

- Demo completa sin errores de consola importantes.
- No hay overflow horizontal en mobile.
- La experiencia tradicional sigue funcionando aunque fallen LLM o pagos.

## 11. Bloque 9 - Documentacion final

Objetivo: dejar instrucciones para que otro equipo pueda correr, probar y presentar Sprint 2.

Actualizar:

1. `README.md`
   - estado de fases 6, 7 y 8.
   - que se puede probar hoy.
   - comandos nuevos.
2. `docs/SETUP.md`
   - como configurar `OPENAI_API_KEY`.
   - como configurar Mercado Pago sandbox.
   - recorrido de aceptacion de menu inteligente.
   - recorrido de aceptacion de pagos.
3. `docs/DEPLOY.md`
   - secrets de Supabase Functions.
   - deploy de funciones nuevas.
   - variables de Vercel si aparecen.
4. Este `sprint2.md`
   - marcar bloques completados o anotar decisiones importantes.

Criterio de listo:

- Un integrante nuevo puede levantar el proyecto y ejecutar la demo siguiendo docs.
- Las variables sensibles estan documentadas pero no commiteadas.
- Quedan claros los pendientes reales.

## 12. Checklist final del Sprint 2

Antes de mergear el sprint completo:

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

Recorrido manual minimo:

1. Admin entra con `admin@esquina.demo` / `demo1234`.
2. Comensal abre `http://localhost:5173/m/demo-burger-mesa-1`.
3. Entra otro comensal en ventana privada.
4. Ambos ven la misma sesion.
5. Uno usa menu inteligente y agrega propuesta al carrito.
6. Edita un item recomendado.
7. Confirma pedido.
8. Admin ve comanda en POS.
9. Admin avanza estados hasta entregado.
10. Comensal ve cuenta.
11. Comensal inicia pago sandbox.
12. Webhook aprueba pago o se simula aprobacion controlada.
13. Cuenta queda saldada.
14. Sesion se cierra o queda lista para cierre segun regla final.
15. Otro restaurante demo no ve ni modifica la sesion.

## 13. Guia para agentes IA

Cuando un agente IA tome una tarea:

1. Leer este archivo completo.
2. Leer los documentos fuente de la seccion 0.
3. Identificar el bloque asignado.
4. Revisar codigo existente antes de proponer cambios.
5. Hacer cambios pequenos y coherentes con patrones actuales.
6. Agregar o ajustar tests en el mismo bloque.
7. Ejecutar la verificacion correspondiente.
8. Reportar:
   - archivos tocados
   - comportamiento agregado
   - pruebas ejecutadas
   - riesgos o pendientes

Formato recomendado de cierre para cada agente:

```md
### Resultado bloque X
- Archivos modificados:
- Flujo implementado:
- Pruebas ejecutadas:
- Pendientes:
- Notas para el siguiente bloque:
```

## 14. Riesgos principales

1. LLM inventando productos: se mitiga validando IDs y reglas contra DB.
2. Pagos duplicados: se mitiga con idempotencia y referencias externas unicas.
3. Cliente manipulando montos: se mitiga calculando todo en servidor.
4. RLS incompleta: se mitiga con tests SQL por restaurante/sesion.
5. Mezclar cierre de sesion con pago: se mitiga manteniendo separados pedidos, cuenta, pagos y sesion.
6. Romper POS existente: se mitiga corriendo tests de pedidos/POS y recorrido manual.
7. Dependencia dura de Mercado Pago u OpenAI: se mitiga aislando proveedores en functions/adaptadores.

## 15. Definicion de terminado

Sprint 2 se considera terminado cuando:

- El menu inteligente genera 3 propuestas validas usando solo menu real disponible.
- Las propuestas pueden agregarse al carrito y editarse.
- La mesa puede pagar total o dividido con Mercado Pago sandbox.
- Los pagos aprobados impactan la cuenta; rechazados no.
- La sesion puede cerrarse al saldar o desde POS segun regla documentada.
- El menu tradicional, carrito, pedidos y POS siguen funcionando.
- README, SETUP y DEPLOY explican como correr y demostrar todo.
- La checklist automatica y el recorrido manual pasan.
