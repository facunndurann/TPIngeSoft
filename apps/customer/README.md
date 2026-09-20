# App del comensal

React + TypeScript, mobile-first. Entrá por `/m/:qrToken` usando los QR generados por admin.

Ver [setup y recorrido de aceptación](../../docs/SETUP.md#6-probar-pedidos-y-cuenta-fase-4).

```bash
pnpm dev:customer
pnpm dev:functions
pnpm test --project customer
```

`features/menu-api.ts` carga la carta por restaurante; `features/menu.ts` valida configuraciones y calcula precios con la lógica compartida. `features/session.ts` gestiona ingreso anónimo mediante la RPC transaccional y recupera sesiones con envíos pendientes. `stores/cart.ts` persiste borradores e intentos de envío independientes por sesión y usuario. La UI escucha participantes, pedidos, pagos y cierre de sesión por Realtime y consulta cada 15 segundos como respaldo; `components/FreshnessNote` muestra de cuándo es cada lectura y cuándo hay una en curso, y `features/freshness.ts` pone esa antigüedad en palabras. `update_session_split` firma cada cambio de división con su autor, así `BillSplitter` puede decir quién la cambió y avisar cuando la cambió otro comensal.

La Fase 4 agrega revisión y envío con `CartPanel`, acceso a la Edge Function en `orders-api.ts` y pedidos/cuenta compartida en `SessionOrders`. Un precio cambiado exige revisar nuevamente; un fallo de red conserva el mismo intento para evitar pedidos duplicados. El servidor calcula y conserva precios y personalizaciones.
