import { test } from 'vitest'
import assert from 'node:assert/strict'
import { dinerIn, type Participant } from '../src/features/diner'
import type { TableContextValue } from '../src/features/table-context'
import type { RenameField } from '../src/hooks/useTableSession'

const idleRename: RenameField = {
  name: '',
  setName: () => {},
  editing: false,
  setEditing: () => {},
  submit: () => {},
  isPending: false,
  canSubmit: false,
}

function participant(id: string, display_name: string, overrides: Partial<Participant> = {}): Participant {
  return {
    id,
    display_name,
    user_id: `user-${id}`,
    named_at: '2026-09-22T12:00:00Z',
    session_id: 'mesa',
    joined_at: '2026-09-22T12:00:00Z',
    ...overrides,
  } as Participant
}

/**
 * El panel lee la mesa del contexto, así que se lo monta dentro de uno: la sesión
 * leída y lo que `dinerIn` diría de este comensal. Lo demás del contexto no lo toca.
 */
async function renderPanel(participants: Participant[], rename: RenameField, userId = 'user-ana') {
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { SessionPanel } = await import('../src/features/SessionPanel')
  const { TableContext } = await import('../src/features/table-context')

  const session = { status: 'open' as const, participants }
  const table = {
    session: { data: session, isError: false },
    ...dinerIn(session, userId),
    cartKey: 'mesa:ana',
    items: [],
  } as unknown as TableContextValue

  return renderToStaticMarkup(
    createElement(
      TableContext,
      { value: table },
      createElement(SessionPanel, { connecting: false, rename, onOpenNewSession: () => {} }),
    ),
  )
}

test('the table decides once who this diner is and how everyone is named', () => {
  const ana = participant('ana', 'Ana')
  const guest = participant('carla', 'Carla', { user_id: null, named_at: null })
  const open = { status: 'open' as const, participants: [ana, guest] }

  const diner = dinerIn(open, 'user-ana')
  assert.equal(diner.me, ana)
  assert.equal(diner.named, true)
  assert.equal(diner.closed, false)
  // «(vos)» es solo para este comensal; quien ya no está en la mesa es «Comensal».
  assert.equal(diner.nameOf('ana'), 'Ana (vos)')
  assert.equal(diner.nameOf('carla'), 'Carla')
  assert.equal(diner.nameOf('se-fue'), 'Comensal')
  assert.equal(diner.nameOf(null), 'Comensal')

  // Con el nombre que puso el sistema, el comensal todavía no eligió el suyo.
  const unnamed = { status: 'open' as const, participants: [{ ...ana, named_at: null }] }
  assert.equal(dinerIn(unnamed, 'user-ana').named, false)
  const closed = { status: 'closed' as const, participants: [{ ...ana, named_at: null }] }
  assert.equal(dinerIn(closed, 'user-ana').closed, true)

  // Sin ingreso todavía nadie es «vos», ni siquiera un invitado sin user_id.
  const anonymous = dinerIn(open, undefined)
  assert.equal(anonymous.me, undefined)
  assert.equal(anonymous.nameOf('carla'), 'Carla')
  assert.equal(dinerIn(undefined, 'user-ana').named, false)
})

test('an unnamed diner lands on the menu: no dialog and no name chip until one is needed', async () => {
  const html = await renderPanel(
    [participant('ana', 'Comensal', { named_at: null })],
    { ...idleRename, name: '' },
  )

  // El nombre lo pide la primera acción que lo necesita (ver name.test.tsx), no la llegada.
  assert.equal(html, '')
})

test('a named diner sees a compact chip and edits the name in place', async () => {
  const named = await renderPanel([participant('ana', 'Ana'), participant('luis', 'Luis')], idleRename)

  assert.doesNotMatch(named, /role="dialog"/)
  assert.match(named, /<strong>Ana<\/strong>/)
  assert.match(named, /2 en la mesa/)
  assert.match(named, /aria-label="Editar nombre"/)
  assert.doesNotMatch(named, />Cambiar</)
  assert.doesNotMatch(named, /Poné tu nombre así/)

  const editing = await renderPanel([participant('ana', 'Ana')], {
    ...idleRename,
    name: 'Ana',
    editing: true,
  })

  assert.doesNotMatch(editing, /role="dialog"/)
  assert.match(editing, /class="name-inline"/)
  assert.match(editing, /aria-label="Guardar nombre"/)
  assert.match(editing, /aria-label="Cancelar"/)
})

test('the table nav separates what was ordered from how it is paid', async () => {
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

  const tabs = [...html.matchAll(/<a [^>]*>([^<]*)<\/a>/g)].map(([, label]) => label)
  assert.deepEqual(tabs, ['La carta', 'Mi carrito (1)', 'Pedidos', 'Cuenta'])
  assert.match(html, /href="\/m\/t\/cuenta"/)
})
