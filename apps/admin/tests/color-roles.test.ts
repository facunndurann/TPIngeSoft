import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * El contraste de los paneles se decide en packages/ui/src/theme.css. Este test
 * evita que un archivo vuelva a elegir un gris o un índigo a mano para el estado
 * en reposo: el texto secundario usa `text-muted`, lo de menor énfasis
 * `text-faint` y la marca `primary`. Los estados (`hover:`, `disabled:`…) quedan
 * libres, y la paleta de Badge ofrece «indigo» como color a elegir.
 */
// Relativo a este archivo: vitest corre desde la raíz del monorepo.
const roots = ['../src', '../../../packages/ui/src'].map((dir) =>
  fileURLToPath(new URL(dir, import.meta.url)),
)
const forbidden = [
  // Gris de texto secundario o tenue sin prefijo de estado.
  /(?<![\w:/[-])text-neutral-(400|500|600)(?![\w-])/,
  /placeholder:text-neutral-\d+/,
  // Índigo de marca en cualquier forma: fondo, texto, borde, anillo.
  /(?<![\w-])(?:[\w-]+:)*(?:bg|text|border(?:-[trbl])?|ring|accent|outline)-indigo-\d+/,
]

function sources(dir: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.tsx?$/.test(file))
    .map((file) => path.join(dir, file))
}

test('los paneles eligen colores por rol, no grises ni índigos sueltos', () => {
  const offenders = roots.flatMap(sources).flatMap((file) =>
    fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, index) =>
        forbidden.some((rule) => rule.test(line)) && !line.includes("indigo: '")
          ? [`${file}:${index + 1}: ${line.trim()}`]
          : [],
      ),
  )
  assert.deepEqual(offenders, [])
})
