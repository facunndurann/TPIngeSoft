import { QueryClient, type MutationCache } from '@tanstack/react-query'

/**
 * Cache de las apps con panel: un reintento y sin refetch al volver a la pestaña.
 * `mutationCache` es para la app que tiene una regla común a todas sus
 * escrituras, como el POS, que relee todo después de guardar.
 */
export function createQueryClient({ mutationCache }: { mutationCache?: MutationCache } = {}): QueryClient {
  return new QueryClient({
    mutationCache,
    defaultOptions: {
      queries: { retry: 1, refetchOnWindowFocus: false },
    },
  })
}
