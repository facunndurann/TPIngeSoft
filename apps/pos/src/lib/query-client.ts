import { MutationCache, type QueryClient } from '@tanstack/react-query'
import { createQueryClient } from '@restaurant-platform/ui'

/** Raíz de toda la caché del POS, salvo los contextos de la cuenta (`pos-contexts`). */
export const posRootKey = ['pos'] as const

/**
 * Relee el POS después de un cambio, propio (una escritura) o ajeno (realtime).
 * Se invalida la raíz entera: solo se vuelve a pedir lo que está en pantalla,
 * que es siempre de la sucursal del contexto, y lo demás queda marcado viejo.
 */
export const refreshPos = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({ queryKey: posRootKey })

/**
 * Cliente de queries del POS: toda escritura exitosa relee el POS, una sola vez
 * acá en vez de en el `onSuccess` de cada mutación. TanStack espera este
 * `onSuccess` antes del de la mutación y antes de darla por terminada, así que
 * el botón sigue ocupado hasta que llega el dato nuevo, y quien cierra un modal
 * en su propio `onSuccess` lo hace con la pantalla ya releída.
 */
export function createPosQueryClient(): QueryClient {
  const queryClient: QueryClient = createQueryClient({
    mutationCache: new MutationCache({ onSuccess: () => refreshPos(queryClient) }),
  })
  return queryClient
}
