import type { FloorSection, FloorTable } from '@/queries/floor'

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
