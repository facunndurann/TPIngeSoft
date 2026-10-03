import {
  sectionPatchColumns,
  tablePatchColumns,
  type FloorChanges,
  type FloorSection,
  type FloorTable,
  type SectionPatch,
  type TablePatch,
} from '@/queries/floor'

/**
 * El salón de una sucursal mientras se lo edita. Nada de lo que se hace en el
 * editor se escribe en la base: cambia este borrador, y al final se guarda
 * entero (`floorChanges`) o se descarta. Cada operación devuelve un borrador
 * nuevo, así deshacer es volver al anterior.
 */
export type FloorDraft = { sections: FloorSection[]; tables: FloorTable[] }

const replace = <T extends { id: string }>(rows: T[], id: string, patch: NoInfer<Partial<T>>) =>
  rows.map((row) => (row.id === id ? { ...row, ...patch } : row))

export const withSection = (draft: FloorDraft, section: FloorSection): FloorDraft => ({
  ...draft,
  sections: [...draft.sections, section],
})

export const patchSection = (draft: FloorDraft, id: string, patch: SectionPatch): FloorDraft => ({
  ...draft,
  sections: replace(draft.sections, id, patch),
})

/** Sin el sector; sus mesas no se borran, quedan sin sector (como hace la base). */
export const withoutSection = (draft: FloorDraft, id: string): FloorDraft => ({
  sections: draft.sections.filter((section) => section.id !== id),
  tables: draft.tables.map((table) => (table.section_id === id ? { ...table, section_id: null } : table)),
})

export const withTable = (draft: FloorDraft, table: FloorTable): FloorDraft => ({
  ...draft,
  tables: [...draft.tables, table],
})

export const patchTable = (draft: FloorDraft, id: string, patch: TablePatch): FloorDraft => ({
  ...draft,
  tables: replace(draft.tables, id, patch),
})

export const withoutTable = (draft: FloorDraft, id: string): FloorDraft => ({
  ...draft,
  tables: draft.tables.filter((table) => table.id !== id),
})

/** Las columnas `columns` de una fila. */
function pick<T, K extends keyof T>(row: T, columns: readonly K[]) {
  const picked = {} as Pick<T, K>
  for (const column of columns) picked[column] = row[column]
  return picked
}

/** Las columnas de `columns` en las que `after` difiere de `before`. */
function changedColumns<T, K extends keyof T>(before: T, after: T, columns: readonly K[]): Partial<Pick<T, K>> {
  const changed: Partial<Pick<T, K>> = {}
  for (const column of columns) if (before[column] !== after[column]) changed[column] = after[column]
  return changed
}

/** Lo que pasó con unas filas entre `base` y `draft`: qué se creó, qué columnas cambiaron y qué se borró. */
function diff<T extends { id: string }, K extends keyof T>(base: T[], draft: T[], columns: readonly K[]) {
  const before = new Map(base.map((row) => [row.id, row]))
  const after = new Set(draft.map((row) => row.id))
  const create: (Pick<T, K> & { id: string })[] = []
  const update: (Partial<Pick<T, K>> & { id: string })[] = []
  for (const row of draft) {
    const old = before.get(row.id)
    if (!old) {
      create.push({ id: row.id, ...pick(row, columns) })
      continue
    }
    const changed = changedColumns(old, row, columns)
    if (Object.keys(changed).length > 0) update.push({ id: row.id, ...changed })
  }
  return { create, update, delete: base.filter((row) => !after.has(row.id)).map((row) => row.id) }
}

/**
 * Lo que hay que escribir para que la base quede como el borrador: solo lo que
 * cambió desde que se empezó a editar (`base`). Lo que otra pantalla haya
 * cambiado mientras tanto en otras filas, u otras columnas, no se pisa.
 */
export function floorChanges(base: FloorDraft, draft: FloorDraft): FloorChanges {
  return {
    sections: diff(base.sections, draft.sections, sectionPatchColumns),
    tables: diff(base.tables, draft.tables, tablePatchColumns),
  }
}

/** Si hay algo para guardar. */
export const hasChanges = (changes: FloorChanges) =>
  [changes.sections, changes.tables].some((rows) => rows.create.length + rows.update.length + rows.delete.length > 0)
