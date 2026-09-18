import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const require = createRequire(new URL('../../apps/customer/package.json', import.meta.url))
const { build } = require('vite')
const root = fileURLToPath(new URL('../../', import.meta.url))
const directory = await mkdtemp(join(tmpdir(), 'orders-tests-'))
try {
  await build({
    root, configFile: false, ssr: { noExternal: true },
    resolve: { alias: { '@': resolve(root, 'apps/pos/src') } },
    esbuild: { jsx: 'automatic' },
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://127.0.0.1:54321'),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('test-public-key'),
      'import.meta.env.VITE_EMPLOYEE_EMAIL_DOMAIN': JSON.stringify('employees.example.com'),
    },
    build: { ssr: resolve(root, process.argv[2] ?? 'supabase/tests/edge.test.ts'), outDir: directory, rollupOptions: { output: { entryFileNames: 'tests.mjs' } } },
  })
  const result = spawnSync(process.execPath, [join(directory, 'tests.mjs')], { stdio: 'inherit' })
  process.exitCode = result.status ?? 1
} finally {
  await rm(directory, { recursive: true, force: true })
}
