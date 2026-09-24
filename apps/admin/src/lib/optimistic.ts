import type { DataTag, QueryClient, QueryKey } from '@tanstack/react-query'

/**
 * Opciones de una mutación que cambia datos de una consulta ya cargada: el cambio
 * se ve al tocar, sin esperar al servidor. Se aplica en la caché antes de escribir,
 * se deshace si la escritura falla y la consulta se relee al terminar.
 *
 * Toda mutación sobre la misma consulta comparte `mutationKey`, así solo la última
 * en terminar relee. Si releyera cada una, la primera traería del servidor valores
 * que todavía no incluyen a las que siguen en vuelo y pisaría su cambio optimista.
 */
export function optimistic<TData, TVariables>(
  queryClient: QueryClient,
  queryKey: DataTag<QueryKey, TData, Error>,
  apply: (data: TData, variables: TVariables) => TData,
) {
  return {
    mutationKey: queryKey,
    onMutate: async (variables: TVariables) => {
      // Una lectura en vuelo que llegara después pisaría el cambio con lo viejo.
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData(queryKey)
      queryClient.setQueryData(queryKey, (current) => (current === undefined ? current : apply(current, variables)))
      return { previous }
    },
    onError: (_error: Error, _variables: TVariables, context?: { previous: TData | undefined }) => {
      if (context?.previous !== undefined) queryClient.setQueryData(queryKey, context.previous)
    },
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey: queryKey }) === 1) {
        void queryClient.invalidateQueries({ queryKey })
      }
    },
  }
}

/** El `apply` de una lista plana: la fila `id` recibe los cambios. */
export function patchRow<TRow extends { id: string }>(
  rows: TRow[],
  { id, ...changes }: { id: string } & Partial<TRow>,
): TRow[] {
  return rows.map((row) => (row.id === id ? { ...row, ...changes } : row))
}
