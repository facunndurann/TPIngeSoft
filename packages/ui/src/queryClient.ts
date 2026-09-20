import { QueryClient } from '@tanstack/react-query'

/** Cache de las apps con panel: un reintento y sin refetch al volver a la pestaña. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 1, refetchOnWindowFocus: false },
    },
  })
}
