import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * La misma regla que el POS (apps/pos/src/legibility.test.tsx), para el panel: el
 * editor de salón mostraba los lugares a 10px y con opacidad, 2,6:1 en una mesa no
 * operable. El contraste de un texto se elige por rol (color-roles.test.ts), y
 * atenuarlo con opacidad lo saltea.
 */
const src = fileURLToPath(new URL('../src', import.meta.url))

const sources = fs
  .readdirSync(src, { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.tsx'))
  .map((file) => ({ file, text: fs.readFileSync(path.join(src, file), 'utf8') }))

test('nothing the admin panel draws is smaller than 12px or faded with opacity', () => {
  const tiny = sources.flatMap(({ file, text }) =>
    [...text.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)]
      .filter(([, px]) => Number(px) < 12)
      .map(([match]) => `${file}: ${match}`),
  )
  assert.deepEqual(tiny, [])

  // La opacidad solo vale para un estado (`disabled:`, `hover:`…), no para atenuar en reposo.
  const faded = sources.flatMap(({ file, text }) =>
    [...text.matchAll(/(?<![:\w-])opacity-\d+/g)].map(([match]) => `${file}: ${match}`),
  )
  assert.deepEqual(faded, [])
})
