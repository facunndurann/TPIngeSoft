import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { AccessContext, type PosContext } from './context/pos-context'
import { FloorMap } from './features/pos/FloorMap'
import { posFloorSectionsQuery, posOpenSessionsQuery, posTablesQuery } from './features/pos/queries'
import { createPosQueryClient } from './lib/query-client'

/** Los .tsx de una carpeta, recorrida entera. */
function sourcesUnder(dir: string): { file: string; text: string }[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.tsx') && !file.includes('.test.'))
    .map((file) => ({ file: join(dir, file), text: readFileSync(join(dir, file), 'utf8') }))
}

test('nothing the POS draws is smaller than 12px or faded with opacity', () => {
  const sources = [...sourcesUnder(join(__dirname)), ...sourcesUnder(join(__dirname, '../../../packages/ui/src'))]

  const tiny = sources.flatMap(({ file, text }) =>
    [...text.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)]
      .filter(([, px]) => Number(px) < 12)
      .map(([match]) => `${file}: ${match}`),
  )
  assert.deepEqual(tiny, [])

  // La opacidad solo vale para un control deshabilitado, no para atenuar texto.
  const faded = sources
    .filter(({ file }) => file.includes('/apps/pos/'))
    .flatMap(({ file, text }) => [...text.matchAll(/(?<![:\w-])opacity-\d+/g)].map(([match]) => `${file}: ${match}`))
  assert.deepEqual(faded, [])
})

const cashier: PosContext = {
  restaurant_id: 'restaurant-a',
  restaurant_name: 'Restaurant A',
  branch_id: 'branch-a',
  branch_name: 'Branch A',
  full_name: 'Ana',
  permissions: ['orders.read', 'floor.read', 'payments.read'],
}

const tableAt = (id: string, label: string, size: number) => ({
  id, label, section_id: 'section-1', seats: 2, shape: 'square',
  position_x: id === 'big' ? 0 : 6, position_y: 0, width: size, height: size, is_active: true, is_visible: true,
  floor_sections: { id: 'section-1', name: 'Salón', sort_order: 0, is_active: true },
})

/** El texto visible de la mesa `label` en el plano: lo que hay dentro del botón, sin etiquetas. */
function tileText(html: string, label: string) {
  const inner = new RegExp(`<button[^>]*aria-label="${label},[^"]*"[^>]*>(.*?)</button>`).exec(html)![1]
  return { text: inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), hasIcon: inner.includes('<svg') }
}

test('a table shows only name, state and time; one cell high leaves just name and state', () => {
  const client = createPosQueryClient()
  const [r, b] = [cashier.restaurant_id, cashier.branch_id]
  client.setQueryData(posFloorSectionsQuery(r, b).queryKey, [{ id: 'section-1', name: 'Salón', sort_order: 0, is_active: true }])
  client.setQueryData(posTablesQuery(r, b).queryKey, [tableAt('big', 'Mesa 1', 3), tableAt('small', 'Mesa 2', 1)] as never)
  client.setQueryData(posOpenSessionsQuery(r, b).queryKey, [{
    id: 'session-1', table_id: 'big', table_label: 'Mesa 1', participant_names: [],
    opened_at: new Date(Date.now() - 5 * 60_000).toISOString(), kitchen_tickets: 0, kitchen_statuses: [],
    has_pending_payment: false, submitted_amount: 0, total_amount: 1500, paid_amount: 0, pending_amount: 1500,
    assigned_employee_name: 'Ana', bill_requested_at: null, bill_attended_at: null,
    in_person_payment_requested_at: null, in_person_payment_attended_at: null,
  }] as never)

  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <AccessContext value={cashier}>
        <MemoryRouter><FloorMap /></MemoryRouter>
      </AccessContext>
    </QueryClientProvider>,
  )

  // El responsable y el total quedan en el resumen, no en la mesa.
  assert.equal(tileText(html, 'Mesa 1').text, 'Mesa 1 Ocupada hace 5 min')
  // Una celda de alto: los lugares no entran en 12px.
  assert.deepEqual(tileText(html, 'Mesa 2'), { text: 'Mesa 2 Libre', hasIcon: false })
})
