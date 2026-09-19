import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export const branchTablesQuery = (branchId: string) =>
  queryOptions({
    queryKey: ['tables', branchId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tables')
        .select('*, floor_sections (id, name)')
        .eq('branch_id', branchId)
        .order('created_at')
      if (error) throw error
      return data
    },
  })
