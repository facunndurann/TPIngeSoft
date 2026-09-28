// @vitest-environment happy-dom
import { afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { Route } from 'react-router'
import type { QueryClient } from '@tanstack/react-query'
import { dinerIn } from '../src/features/diner'
import { billQuery, ordersQuery, paymentsQuery } from '../src/features/orders-api'
import { SessionPanel } from '../src/features/SessionPanel'
import { TableContext, type TableContextValue } from '../src/features/table-context'
import { billPath } from '../src/features/table-paths'
import type { RenameField } from '../src/hooks/useTableSession'
import { TableBillPage } from '../src/pages/TablePage'
import { cleanupTables, openSession, renderTable, sessionId, token } from './table-harness'

// Sin red: la mesa de las pruebas sirve todo desde su caché.
vi.mock('../src/lib/supabase', () => ({ supabase: {} }))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  cleanupTables()
})

const buttonIn = (root: Element, text: string) =>
  [...root.querySelectorAll('button')].find((button) => button.textContent?.trim() === text)!

test('no generic element carries an aria-label that screen readers would ignore', () => {
  // Un `div` o `span` sin rol no tiene nombre accesible: su aria-label no se anuncia.
  // Lo que agrupa y se nombra es `section`, `nav` o lleva `role`.
  const src = path.resolve(__dirname, '../src')
  const offenders = fs
    .readdirSync(src, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.tsx'))
    .flatMap((file) => {
      const text = fs.readFileSync(path.join(src, file), 'utf8')
      // La etiqueta de apertura entera, aunque ocupe varias líneas: `=>` no la cierra.
      return [...text.matchAll(/<(?:div|span)\b((?:=>|[^>])*)>/g)]
        .filter(([, attributes]) => /\baria-label=/.test(attributes) && !/\brole=/.test(attributes))
        .map(([tag]) => `${file}: ${tag.replace(/\s+/g, ' ')}`)
    })
  assert.deepEqual(offenders, [])
})

/** Una cuenta en cero, sin pedidos ni pagos: alcanza para que se ofrezca agregar un invitado. */
function seedEmptyBill(client: QueryClient) {
  client.setQueryData(billQuery(sessionId).queryKey, {
    session_id: sessionId,
    restaurant_id: 'restaurant-1',
    total_amount: 0,
    submitted_amount: 0,
    paid_amount: 0,
    pending_amount: 0,
    is_settled: false,
  })
  client.setQueryData(ordersQuery(sessionId).queryKey, [])
  client.setQueryData(paymentsQuery(sessionId).queryKey, [])
}

test('opening the guest form moves focus to its name, and closing it gives focus back to its button', async () => {
  const container = await renderTable(billPath(token), <Route path="cuenta" element={<TableBillPage />} />, {
    seed: seedEmptyBill,
  })
  // Al llegar a la cuenta nadie toma el foco por su cuenta.
  assert.equal(document.activeElement, document.body)

  await act(async () => buttonIn(container, 'Agregar invitado a la cuenta').click())
  assert.equal(document.activeElement?.getAttribute('aria-label'), 'Nombre del invitado')

  const form = container.querySelector('[aria-label="Agregar invitado"]')!
  await act(async () => buttonIn(form, 'Cancelar').click())
  // Es otro botón (el formulario lo reemplazaba), pero el foco no cae al principio de la página.
  assert.equal(document.activeElement?.textContent, 'Agregar invitado a la cuenta')
})

const rename = (overrides: Partial<RenameField> = {}): RenameField => ({
  name: 'Ana',
  setName: () => {},
  editing: false,
  setEditing: () => {},
  submit: () => {},
  isPending: false,
  canSubmit: true,
  ...overrides,
})

/** El panel de la mesa de Ana, con `session` como su última lectura y `plates` platos sin enviar. */
async function renderPanel(session: typeof openSession, plates = 0) {
  const table = {
    session: { data: session, isError: false },
    ...dinerIn(session, 'user-1'),
    cartKey: 'mesa:ana',
    items: plates
      ? [{ id: 'line-1', productId: 'p', quantity: plates, optionIds: [], removedIds: [], isShared: false }]
      : [],
  } as unknown as TableContextValue
  const panel = (field: RenameField): ReactNode => (
    <TableContext value={table}>
      <SessionPanel connecting={false} rename={field} onOpenNewSession={() => {}} />
    </TableContext>
  )

  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  await act(async () => root.render(panel(rename())))
  return { container, rerender: (field: RenameField) => act(async () => root.render(panel(field))) }
}

test('starting over asks first with focus on the safe option, and keeping the account returns focus', async () => {
  const { container } = await renderPanel({ ...openSession, status: 'closed' }, 2)

  await act(async () => buttonIn(container, 'Empezar de nuevo en esta mesa').click())

  // El foco va a lo que no pierde nada, y el aviso de lo que se descarta lo describe.
  const keep = document.activeElement!
  assert.equal(keep.textContent?.trim(), 'Seguir en esta cuenta')
  const warning = document.getElementById(keep.getAttribute('aria-describedby') ?? '')
  assert.match(warning?.textContent ?? '', /se descartan los 2 platos/)

  await act(async () => (keep as HTMLButtonElement).click())
  assert.equal(document.activeElement?.textContent?.trim(), 'Empezar de nuevo en esta mesa')
})

test('saving or cancelling the name gives focus back to the pencil that opened it', async () => {
  const { container, rerender } = await renderPanel(openSession)
  // Sin haber editado, el lápiz no se lleva el foco al montar.
  assert.equal(document.activeElement, document.body)

  await rerender(rename({ editing: true }))
  assert.equal(document.activeElement, container.querySelector('input'))

  await rerender(rename({ editing: false }))
  assert.equal(document.activeElement?.getAttribute('aria-label'), 'Editar nombre')
})
