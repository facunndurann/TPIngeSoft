# App del comensal

React + TypeScript, mobile-first. Entrá por `/m/:qrToken` usando los QR generados por admin.

Ver [setup y recorrido de aceptación](../../docs/SETUP.md#5-probar-la-app-comensal-fase-3).

```bash
pnpm dev:customer
pnpm --filter customer test
```

`features/menu-api.ts` carga la carta por restaurante; `features/menu.ts` valida configuraciones y calcula precios con la lógica compartida. `features/session.ts` gestiona ingreso anónimo mediante la RPC transaccional. `stores/cart.ts` persiste borradores independientes por sesión y usuario. La UI escucha participantes y cierre de sesión por Realtime y consulta cada 15 segundos como respaldo.

La Fase 3 incluye carta, personalización y carrito. El envío de pedidos y la cuenta se incorporan en Fase 4.
