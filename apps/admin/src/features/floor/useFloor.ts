import { useQuery } from '@tanstack/react-query'
import { sectionsQuery, tablesQuery, type FloorSection, type FloorTable } from '@/queries/floor'

/** El salón de una sucursal, tal como lo leen la vista y el editor. */
export type Floor = {
  sections: FloorSection[]
  tables: FloorTable[]
  isLoading: boolean
  /** Mesas de un sector; con `null`, las que no tienen sector. */
  tablesIn: (sectionId: string | null) => FloorTable[]
}

export function useFloor(branchId: string): Floor {
  const sections = useQuery(sectionsQuery(branchId))
  const tables = useQuery(tablesQuery(branchId))
  const allTables = tables.data ?? []

  return {
    sections: sections.data ?? [],
    tables: allTables,
    isLoading: sections.isLoading || tables.isLoading,
    tablesIn: (sectionId) => allTables.filter((table) => table.section_id === sectionId),
  }
}
