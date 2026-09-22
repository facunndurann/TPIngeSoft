import { test } from 'vitest'
import assert from 'node:assert/strict'
import type { loadSession } from '../src/features/session'
import type { RenameField } from '../src/hooks/useTableSession'

type Session = Awaited<ReturnType<typeof loadSession>>

const idleRename: RenameField = {
  name: '',
  setName: () => {},
  editing: false,
  setEditing: () => {},
  submit: () => {},
  isPending: false,
}

function openSession(names: string[]): Session {
  return {
    status: 'open',
    participants: names.map((display_name) => ({ display_name })),
  } as Session
}

test('an unnamed diner gets a required name dialog and no inline prompt', async () => {
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { SessionPanel } = await import('../src/features/SessionPanel')

  const html = renderToStaticMarkup(
    createElement(SessionPanel, {
      connecting: false,
      session: openSession(['Comensal']),
      displayName: 'Comensal',
      named: false,
      hasPendingSubmission: false,
      cartCount: 0,
      rename: { ...idleRename, name: '' },
      onOpenNewSession: () => {},
    }),
  )

  assert.match(html, /role="dialog"/)
  assert.match(html, /¿Cómo te llamás\?/)
  assert.match(html, /Así sabemos qué pidió cada uno/)
  assert.match(html, />Continuar</)
  assert.doesNotMatch(html, /Poné tu nombre así/)
  assert.doesNotMatch(html, /en la mesa/)
  assert.doesNotMatch(html, /Cambiar/)
  assert.doesNotMatch(html, />Cancelar</)
})

test('a named diner sees a compact chip and edits the name in place', async () => {
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { SessionPanel } = await import('../src/features/SessionPanel')

  const named = renderToStaticMarkup(
    createElement(SessionPanel, {
      connecting: false,
      session: openSession(['Ana', 'Luis']),
      displayName: 'Ana',
      named: true,
      hasPendingSubmission: false,
      cartCount: 0,
      rename: idleRename,
      onOpenNewSession: () => {},
    }),
  )

  assert.doesNotMatch(named, /role="dialog"/)
  assert.match(named, /<strong>Ana<\/strong>/)
  assert.match(named, /2 en la mesa/)
  assert.match(named, /aria-label="Editar nombre"/)
  assert.doesNotMatch(named, />Cambiar</)
  assert.doesNotMatch(named, /Poné tu nombre así/)

  const editing = renderToStaticMarkup(
    createElement(SessionPanel, {
      connecting: false,
      session: openSession(['Ana']),
      displayName: 'Ana',
      named: true,
      hasPendingSubmission: false,
      cartCount: 0,
      rename: { ...idleRename, name: 'Ana', editing: true },
      onOpenNewSession: () => {},
    }),
  )

  assert.doesNotMatch(editing, /role="dialog"/)
  assert.match(editing, /class="name-inline"/)
  assert.match(editing, /aria-label="Guardar nombre"/)
  assert.match(editing, /aria-label="Cancelar"/)
})

test('the table nav labels the orders tab Pedidos', async () => {
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { MemoryRouter } = await import('react-router')
  const { TableNav } = await import('../src/features/TableNav')

  const html = renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: ['/m/t'] },
      createElement(TableNav, { token: 't', cartCount: 1 }),
    ),
  )

  assert.match(html, />Pedidos</)
  assert.doesNotMatch(html, /Pedidos y cuenta/)
  assert.match(html, /Mi carrito \(1\)/)
})
