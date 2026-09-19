# POS

Frontend operativo independiente. No importa código de admin ni comparte su sesión.

1. Configurar `.env` usando `.env.example`; el dominio de empleados debe coincidir con Edge.
2. Aplicar migraciones y servir funciones desde la raíz (`pnpm dev:functions`).
3. Ejecutar `pnpm dev:pos` (puerto 5175).

Seed local: `pos.esquina` / `demo-pos1234`, `pos.nonna` / `demo-pos1234`.
En producción, crear cuentas y asignar sucursales desde Empleados en admin.

Build independiente: `pnpm --filter pos build`; salida `apps/pos/dist`.
Pruebas: `pnpm --filter pos test`. La reescritura SPA está en `vercel.json`.

Ver [cuentas, permisos y migración](../../docs/pos-accounts.md).
