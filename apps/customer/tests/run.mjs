import { build } from 'vite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
const directory = await mkdtemp(join(tmpdir(), 'customer-tests-'))
try {
  await build({
    configFile: false,
    resolve: { alias: { '@': src } },
    ssr: { noExternal: true },
    build: { ssr: 'tests/menu.test.ts', outDir: directory, rollupOptions: { output: { entryFileNames: 'tests.mjs' } } },
  })
  const result = spawnSync(process.execPath, [join(directory, 'tests.mjs')], { stdio: 'inherit' })
  process.exitCode = result.status ?? 1
} finally {
  await rm(directory, { recursive: true, force: true })
}
