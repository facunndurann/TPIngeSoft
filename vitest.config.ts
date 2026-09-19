import { defineConfig } from 'vitest/config'

// Un solo runner para las pruebas de lógica del monorepo (`pnpm test`).
// Cada app corre con su propio vite.config.ts (alias `@`, imports `?raw`).
export default defineConfig({
  test: {
    projects: [
      {
        extends: 'apps/customer/vite.config.ts',
        test: {
          name: 'customer',
          root: 'apps/customer',
          // Vitest reemplaza los .css por un string vacío; el test de tokens lee index.css?raw.
          css: { include: [/index\.css/] },
        },
      },
      'apps/admin',
      {
        // Contrato HTTP de submit-order, catálogo de errores y máquina de estados.
        // orders.integration.mjs queda afuera: necesita el stack local (`pnpm test:orders:integration`).
        test: {
          name: 'orders',
          root: 'supabase',
          include: ['tests/**/*.test.ts'],
          // employees.test.ts usa node:test y se corre con `pnpm test:employees`.
          exclude: ['tests/employees.test.ts'],
        },
      },
    ],
  },
})
