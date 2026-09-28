import { test } from 'vitest'
import assert from 'node:assert/strict'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Button, ControlSizeProvider, IconButton, Select } from '@restaurant-platform/ui'

const touch = /\bmin-h-11\b|\bh-11\b/

test('without a provider the controls keep the panel size, as in the admin', () => {
  const html = renderToStaticMarkup(
    <>
      <Button>Guardar</Button>
      <IconButton label="Cerrar">x</IconButton>
      <Select />
    </>,
  )
  assert.doesNotMatch(html, touch)
  assert.match(html, /\bh-8 w-8\b/)
})

test('the touch provider sizes every control inside, and an explicit size still wins', () => {
  const html = (node: ReactNode) =>
    renderToStaticMarkup(<ControlSizeProvider size="touch">{node}</ControlSizeProvider>)

  assert.match(html(<Button>Guardar</Button>), /\bmin-h-11 px-4\b/)
  assert.match(html(<IconButton label="Cerrar">x</IconButton>), /\bh-11 w-11\b/)
  assert.match(html(<Select />), /\bmin-h-11\b/)
  assert.doesNotMatch(html(<Button size="default">Guardar</Button>), touch)
})
