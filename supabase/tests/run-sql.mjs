import { readFile, readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
const container = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_TP'
const directory = new URL('./', import.meta.url)
for (const name of (await readdir(directory)).filter(n => n.endsWith('.sql')).sort()) {
  const result = spawnSync('docker', ['exec','-i',container,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'], {
    input: await readFile(new URL(name,directory)), encoding: 'utf8',
  })
  if (result.status !== 0) {
    console.error(name, result.error?.message ?? result.stderr, result.stdout)
    process.exit(1)
  }
  console.log('PASS',name)
}
