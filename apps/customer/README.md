# App del comensal

React + TypeScript, mobile-first. Entrá por `/m/:qrToken` usando los QR generados por admin.

Ver [setup y recorrido de aceptación](../../docs/SETUP.md#6-probar-pedidos-y-cuenta-fase-4).

```bash
pnpm dev:customer
pnpm dev:functions
pnpm test --project customer
```

`features/menu-api.ts` carga la carta por restaurante; `features/menu.ts` valida configuraciones y calcula precios con la lógica compartida. `features/session.ts` gestiona ingreso anónimo mediante la RPC transaccional, recupera sesiones con envíos pendientes y traduce todo error crudo con `fromPostgres`: `customer_join_table_session` rechaza con códigos del catálogo compartido, así el comensal nunca lee texto de la base ni inglés. `stores/cart.ts` persiste borradores e intentos de envío independientes por sesión y usuario. La UI escucha participantes, pedidos, pagos y cierre de sesión por Realtime y consulta cada 15 segundos como respaldo; `components/FreshnessNote` muestra de cuándo es cada lectura y cuándo hay una en curso, y `features/freshness.ts` pone esa antigüedad en palabras. `update_session_split` firma cada cambio de división con su autor, así `BillSplitter` puede decir quién la cambió y avisar cuando la cambió otro comensal. `features/TableService` manda los avisos al salón con `request_table_service` (llamar al mozo o pedir la cuenta, cancelables), que enciende la mesa en el plano del POS; quitar un plato se puede deshacer desde el aviso y `features/last-table.ts` guarda la última mesa para que una URL inexistente tenga vuelta.

La Fase 4 agrega revisión y envío con `CartPanel`, acceso a la Edge Function en `orders-api.ts` y pedidos/cuenta compartida en `SessionOrders`. Un precio cambiado exige revisar nuevamente; un fallo de red conserva el mismo intento para evitar pedidos duplicados. El servidor calcula y conserva precios y personalizaciones.
