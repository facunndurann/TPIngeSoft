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
        // Contrato HTTP de submit-order, catálogo de errores, máquina de estados
        // y cuentas de empleados. orders.integration.mjs queda afuera: necesita
        // el stack local (`pnpm test:orders:integration`).
        test: {
          name: 'orders',
          root: 'supabase',
          include: ['tests/**/*.test.ts'],
        },
      },
    ],
  },
})
