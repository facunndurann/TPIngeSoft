import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  floorChanges,
  hasChanges,
  patchTable,
  withSection,
  withTable,
  withoutSection,
  withoutTable,
  type FloorDraft,
} from '../src/features/floor/floorDraft'
import type { FloorSection, FloorTable } from '../src/queries/floor'

const section = (id: string, name: string): FloorSection => ({
  id,
  name,
  restaurant_id: 'r',
  branch_id: 'b',
  sort_order: 0,
  is_active: true,
  created_at: '2026-10-04T00:00:00Z',
})

const table = (id: string, label: string, sectionId: string | null): FloorTable => ({
  id,
  label,
  section_id: sectionId,
  restaurant_id: 'r',
  branch_id: 'b',
  qr_token: `qr-${id}`,
  position_x: 0,
  position_y: 0,
  width: 2,
  height: 2,
  seats: 4,
  shape: 'rect',
  is_active: true,
  is_visible: true,
  created_at: '2026-10-04T00:00:00Z',
})

const base: FloorDraft = {
  sections: [section('salon', 'Salón')],
  tables: [table('m1', 'Mesa 1', 'salon'), table('m2', 'Mesa 2', 'salon')],
}

test('without changes there is nothing to save, and a change undone by hand is no change', () => {
  assert.equal(hasChanges(floorChanges(base, base)), false)
  const back = patchTable(patchTable(base, 'm1', { position_x: 5 }), 'm1', { position_x: 0 })
  assert.equal(hasChanges(floorChanges(base, back)), false)
})

test('only what changed is sent: new rows whole, modified rows with just their changed columns, deleted ids', () => {
  let draft = withSection(base, { ...section('terraza', 'Terraza'), sort_order: 1 })
  draft = withTable(draft, { ...table('m3', 'Mesa 3', 'terraza'), position_x: -2 })
  draft = patchTable(draft, 'm1', { position_x: 5, seats: 6 })
  draft = withoutTable(draft, 'm2')

  const changes = floorChanges(base, draft)
  assert.deepEqual(changes.sections, {
    create: [{ id: 'terraza', name: 'Terraza', sort_order: 1, is_active: true }],
    update: [],
    delete: [],
  })
  // Lo nuevo va con sus columnas editables; lo que pone la base (el QR, la fecha) no viaja.
  assert.deepEqual(changes.tables.create, [
    {
      id: 'm3',
      section_id: 'terraza',
      position_x: -2,
      position_y: 0,
      seats: 4,
      shape: 'rect',
      width: 2,
      height: 2,
      is_visible: true,
      is_active: true,
      label: 'Mesa 3',
    },
  ])
  assert.deepEqual(changes.tables.update, [{ id: 'm1', position_x: 5, seats: 6 }])
  assert.deepEqual(changes.tables.delete, ['m2'])
  assert.equal(hasChanges(changes), true)
})

test('deleting a section leaves its tables without one, as the database does, and saving says so', () => {
  const draft = withoutSection(base, 'salon')

  assert.deepEqual(
    draft.tables.map((entry) => entry.section_id),
    [null, null],
  )
  const changes = floorChanges(base, draft)
  assert.deepEqual(changes.sections.delete, ['salon'])
  assert.deepEqual(changes.tables.update, [
    { id: 'm1', section_id: null },
    { id: 'm2', section_id: null },
  ])
})
