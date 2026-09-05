import { build } from 'vite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
const directory = await mkdtemp(join(tmpdir(), 'customer-tests-'))
try {
  await build({
    configFile: false,
    ssr: { noExternal: true },
    build: { ssr: 'tests/menu.test.ts', outDir: directory, rollupOptions: { output: { entryFileNames: 'tests.mjs' } } },
  })
  const result = spawnSync(process.execPath, [join(directory, 'tests.mjs')], { stdio: 'inherit' })
  process.exitCode = result.status ?? 1
} finally {
  await rm(directory, { recursive: true, force: true })
}
