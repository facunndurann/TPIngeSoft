# Sprint 2 - Historias de Jira

Fuente: Jira, proyecto `MI` ("Menu Interactivo"), sprint `MI Sprint 2`.

Este sprint no apunta a menu inteligente. El alcance real esta dividido en dos bloques:

1. Beeper digital y modalidad auto-servicio.
2. Gestion de pagos, pedido de cuenta y division de cuenta.

## Historias incluidas

### Beeper / Auto-servicio

- `MI-16` - Como comensal, quiero ver en mi celular el estado en vivo de mi pedido y recibir alertas del beeper digital, para saber cuando acercarme a retirar mi comida sin esperar de pie. `5 pts`
- `MI-20` - Como administrador del restaurante, quiero habilitar o deshabilitar la modalidad "Beeper / Auto-servicio" por local o sector, para adaptar el sistema al modelo operativo de mi negocio. `3 pts`
- `MI-17` - Como personal de cocina/barra, quiero marcar un pedido como "Listo para retirar" con un clic, para hacer sonar el beeper en el celular del comensal y despejar la barra. `3 pts`
- `MI-18` - Como personal de mostrador/barra, quiero reenviar la alerta sonora del beeper a pedidos demorados, para evitar que la comida se enfrie en el mostrador. `2 pts`
- `MI-19` - Como personal de mostrador, quiero confirmar la entrega del pedido verificando el numero de orden, para cerrar el ciclo de la comanda y apagar la alerta en el cliente. `2 pts`

### Gestion de pagos

- `MI-38` - Como comensal, quiero pedir la cuenta desde la aplicacion, para avisarle al restaurante que ya estoy listo para pagar. `3 pts`
- `MI-40` - Como comensal, quiero pagar desde el celular con un medio electronico, para cerrar la cuenta sin depender de un mozo. `8 pts`
- `MI-41` - Como comensal, quiero que la cuenta se pueda dividir por cantidad de personas, para repartir el total en partes iguales. `5 pts`
- `MI-42` - Como comensal, quiero dividir la cuenta por items seleccionados, para que cada persona pague solo lo que consumio. `8 pts`
- `MI-43` - Como comensal, quiero dividir la cuenta con un porcentaje o ratio arbitrario, para repartir el total de manera flexible segun lo acordado por la mesa. `5 pts`
- `MI-46` - Como comensal, quiero poder pedir que venga un mozo a cobrarme, para pagar en forma presencial si no quiero hacerlo por celular. `3 pts`
- `MI-47` - Como mozo, quiero ver las mesas que solicitaron cobro presencial, para acercarme a cobrar sin perder pedidos. `5 pts`
- `MI-48` - Como administrador, quiero definir que medios de pago estan habilitados por local, para ofrecer solo las opciones compatibles con mi operacion. `3 pts`
- `MI-49` - Como administrador, quiero registrar el estado de los pagos y su relacion con la cuenta de la mesa, para saber que esta saldado y que sigue pendiente. `5 pts`

## Orden sugerido de implementacion

1. Configuracion operativa por local/sector:
   - `MI-20`: activar/desactivar modo Beeper / Auto-servicio.
   - `MI-48`: definir medios de pago habilitados por local.
2. Beeper digital:
   - `MI-17`: accion del personal para marcar "Listo para retirar".
   - `MI-16`: alerta visual/sonora/vibracion en el celular del comensal.
   - `MI-18`: re-llamado para pedidos demorados.
   - `MI-19`: confirmacion de entrega y apagado de alerta.
3. Pedido de cuenta y cobro presencial:
   - `MI-38`: pedir la cuenta desde customer.
   - `MI-46`: pedir que venga un mozo a cobrar.
   - `MI-47`: vista del mozo/admin con mesas que solicitaron cobro presencial.
4. Pagos electronicos:
   - `MI-49`: registrar pagos y relacionarlos con cuenta/sesion.
   - `MI-40`: pagar desde el celular.
5. Division de cuenta:
   - `MI-41`: division por cantidad de personas.
   - `MI-42`: division por items seleccionados.
   - `MI-43`: division por porcentaje o ratio arbitrario.

## 1. Configuracion de Beeper / Auto-servicio (`MI-20`)

Objetivo: permitir que el admin active o desactive el modo auto-servicio por local o sector.

Hacer:

1. Agregar configuracion para modo `Beeper / Auto-servicio`.
2. Exponerla en el panel admin, probablemente en configuracion del restaurante/sucursal.
3. Hacer que customer y POS lean esa configuracion.
4. Si esta activo:
   - mostrar numero de retiro/comanda al comensal.
   - activar ciclo de alertas cuando el pedido este listo.
5. Si esta desactivado:
   - mantener flujo tradicional de servicio a mesa.
   - no disparar beeper ni avisos de retiro.

Criterios de aceptacion de Jira:

- Si el admin activa "Modo Auto-servicio / Beeper", la webapp del comensal asigna un numero de retiro visible y activa avisos sonoros/visuales.
- Si esta desactivado, el sistema opera en modo servicio a mesa tradicional.

## 2. Estado en vivo y alerta de beeper (`MI-16`)

Objetivo: que el comensal vea el estado en vivo del pedido y reciba alerta cuando este listo.

Hacer:

1. Reusar el realtime existente de pedidos.
2. Mostrar estado claro del pedido en customer.
3. Cuando el pedido pase a "Listo para retirar" o equivalente:
   - mostrar alerta visual llamativa.
   - reproducir sonido continuo o intermitente.
   - activar vibracion si el navegador lo permite.
   - mostrar numero de comanda/retiro y punto de retiro.
4. Agregar accion "Entendido / Voy a retirar".
5. Al confirmar:
   - silenciar sonido.
   - dejar visible numero de comanda y punto de retiro.
6. Evaluar notificacion del navegador si la pestaña esta en segundo plano.

Criterios de aceptacion de Jira:

- Al pasar a "Listo para retirar", el celular muestra alerta visual, reproduce tono y vibra.
- Al presionar "Entendido / Voy a retirar", se silencia y muestra numero de comanda y punto de retiro.
- Si la pantalla esta bloqueada o cambia de pestaña, debe recibir push o aviso del navegador.

## 3. Marcar pedido como listo (`MI-17`)

Objetivo: que cocina/barra pueda llamar al comensal con un clic.

Hacer:

1. En POS/admin, agregar accion "Llamar comensal" o "Listo para retirar".
2. Al presionar, cambiar el estado del pedido a "Esperando retiro" o equivalente.
3. Disparar evento realtime que active el beeper en customer.
4. Mostrar contador de minutos desde que se llamo al comensal.

Criterios de aceptacion de Jira:

- Al presionar "Llamar Comensal / Listo", el pedido cambia a "Esperando Retiro".
- El comensal recibe alerta en tiempo real.
- El panel muestra contador con minutos transcurridos desde la llamada.

## 4. Re-llamar pedido demorado (`MI-18`)

Objetivo: permitir reactivar la alerta cuando un pedido listo no fue retirado.

Hacer:

1. Detectar pedidos en "Esperando retiro" hace mas de X minutos.
2. Mostrar accion "Re-llamar" en POS/admin.
3. Al presionar, volver a disparar sonido/vibracion/alerta en customer.
4. Registrar cantidad de re-llamados del pedido.
5. Mostrar ese conteo en el panel para auditoria.

Criterios de aceptacion de Jira:

- Si un pedido lleva mas de X minutos en "Esperando Retiro", el personal puede presionar "Re-llamar".
- El celular del comensal vuelve a sonar y vibrar.
- El sistema registra la cantidad de re-llamados.

## 5. Confirmar entrega (`MI-19`)

Objetivo: cerrar el ciclo de retiro verificando el numero de orden.

Hacer:

1. Mostrar numero de orden/comanda en customer.
2. En POS/admin, permitir confirmar entrega.
3. Idealmente pedir o mostrar verificacion del numero de orden antes de entregar.
4. Al entregar:
   - archivar o mover la comanda al estado final.
   - apagar alerta en customer.
   - mostrar mensaje final tipo "Buen provecho".

Criterios de aceptacion de Jira:

- Al presionar "Entregado", el pedido se archiva en KDS/POS.
- La pantalla del comensal pasa a estado final.
- Se desactiva sonido, vibracion o bloqueo visual de alerta.

## 6. Pedir la cuenta (`MI-38`)

Objetivo: que el comensal avise desde la app que quiere pagar.

Hacer:

1. Agregar accion "Pedir cuenta" en la vista de pedidos/cuenta.
2. Registrar la solicitud asociada a la sesion de mesa.
3. Reflejar esa solicitud en admin/POS o mesas activas.
4. Evitar solicitudes duplicadas innecesarias.
5. Mostrar estado al comensal: cuenta solicitada / esperando confirmacion / listo para pagar.

Criterio de aceptacion:

- El restaurante ve que la mesa pidio la cuenta.
- El comensal ve que su solicitud fue registrada.

## 7. Cobro presencial (`MI-46`, `MI-47`)

Objetivo: permitir que el comensal pida pagar presencialmente y que el mozo vea esas mesas.

Hacer:

1. En customer, agregar opcion "Que venga un mozo a cobrarme".
2. Registrar la solicitud con sesion, mesa, restaurante y timestamp.
3. Mostrar confirmacion al comensal.
4. En admin/POS, agregar vista o indicador de mesas que pidieron cobro presencial.
5. Permitir marcar la solicitud como atendida.

Criterio de aceptacion:

- El comensal puede pedir cobro presencial.
- El mozo/admin ve la mesa en una lista clara.
- La solicitud no se mezcla con pedidos de comida ni con pagos electronicos.

## 8. Medios de pago habilitados (`MI-48`)

Objetivo: que el admin configure que formas de pago ofrece cada local.

Hacer:

1. Agregar configuracion de medios de pago por local/sucursal.
2. Opciones minimas:
   - electronico desde celular.
   - presencial / mozo.
   - efectivo o externo si aplica.
3. Customer debe mostrar solo las opciones habilitadas.
4. Admin debe poder cambiar esta configuracion.

Criterio de aceptacion:

- Cada local ofrece solo los medios de pago configurados.
- Customer no muestra opciones deshabilitadas.

## 9. Registro de pagos y relacion con cuenta (`MI-49`)

Objetivo: saber que parte de la cuenta esta saldada y que sigue pendiente.

Hacer:

1. Revisar tabla/vista actual de `payments` y `session_bills`.
2. Registrar pagos con:
   - sesion de mesa.
   - participante si corresponde.
   - monto.
   - estado.
   - metodo.
   - modo de division.
   - referencia externa si hay proveedor.
3. Hacer que la cuenta compute:
   - total consumido.
   - total pagado aprobado.
   - pendiente.
4. Asegurar que pagos rechazados o pendientes no descuenten saldo.
5. Mostrar estado de pagos en admin y customer.

Criterio de aceptacion:

- Admin puede saber que esta saldado y que sigue pendiente.
- La cuenta se calcula con pagos aprobados.

## 10. Pago electronico desde el celular (`MI-40`)

Objetivo: permitir pagar la cuenta con un medio electronico.

Hacer:

1. Crear flujo de pago desde customer.
2. Calcular monto del lado servidor.
3. Crear pago pendiente.
4. Integrar proveedor sandbox si corresponde al alcance tecnico actual.
5. Actualizar estado del pago cuando se aprueba/rechaza.
6. Refrescar cuenta al volver del pago.

Criterio de aceptacion:

- El comensal puede iniciar un pago electronico.
- El pago aprobado impacta en la cuenta.
- El pago rechazado no salda nada.

## 11. Division por cantidad de personas (`MI-41`)

Objetivo: repartir el total en partes iguales.

Hacer:

1. En customer, ofrecer "Dividir en partes iguales".
2. Permitir ingresar cantidad de personas.
3. Calcular monto por persona.
4. Registrar pagos parciales contra la misma sesion.
5. Mostrar pendiente restante.

Criterio de aceptacion:

- La app calcula la parte correspondiente.
- Varios pagos parciales reducen el saldo de la cuenta.

## 12. Division por items (`MI-42`)

Objetivo: que cada persona pague items concretos de la cuenta.

Hacer:

1. Mostrar pedidos/items de la sesion.
2. Permitir seleccionar items o porciones de items compartidos si el modelo lo permite.
3. Calcular subtotal de lo seleccionado.
4. Crear pago por ese subtotal.
5. Marcar o representar items ya cubiertos para evitar confusion.

Criterio de aceptacion:

- El comensal puede elegir que items paga.
- El monto coincide con los items seleccionados.
- La cuenta muestra que queda pendiente.

## 13. Division por porcentaje o ratio (`MI-43`)

Objetivo: permitir reparto flexible acordado por la mesa.

Hacer:

1. Agregar modo "Porcentaje / ratio".
2. Permitir definir porcentaje o proporcion.
3. Validar que el monto no exceda el saldo pendiente.
4. Crear pago por el monto calculado.
5. Mostrar resumen antes de confirmar.

Criterio de aceptacion:

- El comensal puede pagar una proporcion custom del total.
- La app muestra claramente cuanto paga y cuanto queda pendiente.

## Checklist final

Comandos sugeridos:

```bash
pnpm --filter customer test
pnpm test:orders
pnpm test:orders:integration
pnpm typecheck
pnpm lint
pnpm build
```

Si se tocaron funciones SQL, RLS, pagos, pedidos o POS:

```bash
docker exec -i supabase_db_TP psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/orders.sql
docker exec -i supabase_db_TP psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/pos.sql
```

Recorrido manual minimo:

1. Activar modo Beeper / Auto-servicio desde admin.
2. Entrar a una mesa desde customer.
3. Enviar un pedido.
4. Marcarlo como listo desde POS.
5. Ver alerta en customer.
6. Silenciar con "Entendido / Voy a retirar".
7. Re-llamar desde POS.
8. Confirmar entrega.
9. Pedir la cuenta desde customer.
10. Pedir cobro presencial y verlo en admin.
11. Configurar medios de pago habilitados.
12. Registrar o ejecutar pago electronico.
13. Probar division en partes iguales.
14. Probar division por items.
15. Probar division por porcentaje/ratio.
16. Verificar pendiente y pagado en customer y admin.

## Nota para agentes IA

Cuando un agente tome una historia, que cierre su trabajo con:

```md
### Resultado
- Jira:
- Archivos modificados:
- Que se implemento:
- Pruebas ejecutadas:
- Pendientes o riesgos:
```

Prioridad: implementar las historias de `MI Sprint 2` tal como estan en Jira. No agregar menu inteligente en este sprint salvo que Jira cambie.
