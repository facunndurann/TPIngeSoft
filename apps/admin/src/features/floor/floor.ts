import type { FloorSection, FloorTable } from '@/queries/floor'

/** Lo que recibe la pantalla de cada modo del Salón. */
export type FloorScreenProps = {
  branchId: string
  floor: Floor
  /** Sector abierto; `null` si la sucursal todavía no tiene ninguno. */
  section: FloorSection | null
  onChooseSection: (sectionId: string) => void
}

/** El salón de una sucursal ya cargado, tal como lo leen la vista y el editor. */
export type Floor = {
  sections: FloorSection[]
  tables: FloorTable[]
  /** Mesas de un sector; con `null`, las que no tienen sector. */
  tablesIn: (sectionId: string | null) => FloorTable[]
}

export function floorOf(sections: FloorSection[], tables: FloorTable[]): Floor {
  return {
    sections,
    tables,
    tablesIn: (sectionId) => tables.filter((table) => table.section_id === sectionId),
  }
}

/**
 * Nombre de una mesa nueva: «Mesa N», con N uno más que el mayor de la sucursal.
 * Es por sucursal y no por sector porque el nombre no se puede repetir en ella.
 */
export function nextTableLabel(tables: readonly { label: string }[]) {
  const numbers = tables.map((table) => /^Mesa (\d+)$/i.exec(table.label.trim())?.[1]).map(Number)
  return `Mesa ${Math.max(0, ...numbers.filter(Number.isFinite)) + 1}`
}
