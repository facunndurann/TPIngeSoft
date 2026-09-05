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
    build: { ssr: resolve(root, 'supabase/tests/edge.test.ts'), outDir: directory, rollupOptions: { output: { entryFileNames: 'tests.mjs' } } },
  })
  const result = spawnSync(process.execPath, [join(directory, 'tests.mjs')], { stdio: 'inherit' })
  process.exitCode = result.status ?? 1
} finally {
  await rm(directory, { recursive: true, force: true })
}
