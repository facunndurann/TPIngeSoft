import { defineConfig } from 'vitest/config'

// Runner único para las pruebas de lógica del monorepo (`pnpm test`).
// Cada proyecto hereda el vite.config.ts de su app: alias `@`, imports `?raw`
// y las variables VITE_* que el código lee de import.meta.env.
export default defineConfig({
  test: {
    projects: [
      {
        extends: 'apps/customer/vite.config.ts',
        test: {
          name: 'customer',
          root: 'apps/customer',
          // El store del carrito persiste apenas se importa: el localStorage de
          // mentira tiene que existir antes que cualquier import de las pruebas.
          setupFiles: ['tests/setup.ts'],
          // Vitest reemplaza los .css por un string vacío; el test de tokens lee index.css?raw.
          css: { include: [/index\.css/] },
        },
      },
      'apps/admin',
      {
        extends: 'apps/pos/vite.config.ts',
        test: {
          name: 'pos',
          root: 'apps/pos',
          // El POS renderiza con react-dom/server y lee estas al construir el cliente.
          env: {
            VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
            VITE_SUPABASE_ANON_KEY: 'test-public-key',
            VITE_EMPLOYEE_EMAIL_DOMAIN: 'employees.example.com',
          },
        },
      },
      {
        // La lógica que comparten las tres apps (plano, tablero del POS, fechas,
        // división de la cuenta) se prueba acá, junto a su código, y no en la app
        // que la usa primero. Sus contratos con la base leen schema.generated.sql,
        // que el CI mantiene al día: nunca una migración puntual.
        test: {
          name: 'shared',
          root: 'packages/shared',
          include: ['tests/**/*.test.ts'],
        },
      },
      {
        // Contrato HTTP de las Edge Functions (submit-order, mobile-payment y
        // employee-accounts) con gateways falsos. Las pruebas *.integration.mjs
        // quedan afuera: necesitan el stack local (`pnpm test:orders:integration`).
        test: {
          name: 'edge-functions',
          root: 'supabase',
          include: ['tests/**/*.test.ts'],
        },
      },
    ],
  },
})
