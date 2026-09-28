import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * El schema vigente, tal como lo deja `pnpm db:schema`. El CI falla si quedó viejo
 * (paso «Schema snapshot is current»), así que los tests que comparan el código con
 * la base leen este único archivo: una migración nueva no obliga a apuntarlos a otra.
 * El texto es el de pg_dump, que normaliza el SQL: `in (…)` es `= ANY (ARRAY[…])` y
 * `between` es `>= … AND <= …`.
 */
const schema = readFileSync(new URL('../../../supabase/schema.generated.sql', import.meta.url), 'utf8')

const headers = {
  TABLE: (name: string) => `CREATE TABLE IF NOT EXISTS "public"."${name}" (`,
  VIEW: (name: string) => `CREATE OR REPLACE VIEW "public"."${name}"`,
}

/** La definición de una tabla o vista, de su CREATE al `;` que la cierra: así un patrón no cruza a otra. */
export function definitionOf(kind: keyof typeof headers, name: string): string {
  const start = schema.indexOf(headers[kind](name))
  assert.ok(start >= 0, `${kind} ${name} no está en schema.generated.sql`)
  return schema.slice(start, schema.indexOf(';\n', start))
}

/** Los literales de un `ARRAY['a'::tipo, 'b'::tipo]` de pg_dump, en su orden. */
export function arrayValues(sql: string): string[] {
  return [...sql.matchAll(/'([^']*)'::/g)].map((match) => match[1])
}
