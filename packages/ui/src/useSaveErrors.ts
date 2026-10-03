import { useCallback, useState } from 'react'
import type { UseMutationOptions } from '@tanstack/react-query'

/**
 * Mensaje mostrable de cualquier throw. `AppError` ya trae el del catálogo, y un
 * string es su propio mensaje: así llega lo que alguien ya resolvió antes.
 */
export function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string') return error || fallback
  return error instanceof Error && error.message ? error.message : fallback
}

/** Opciones de una mutación que guarda algo: el `mutationFn` es obligatorio. */
type SavingOptions<TData, TVariables, TContext> = UseMutationOptions<
  TData,
  Error,
  TVariables,
  TContext
> & {
  mutationFn: NonNullable<UseMutationOptions<TData, Error, TVariables, TContext>['mutationFn']>
}

export type SaveErrors = {
  /** Último error sin resolver de la pantalla que no es de una fila, o `null`. */
  message: string | null
  /** Último error sin resolver si fue de la fila `id`, o `null`. */
  messageFor: (id: string) => string | null
  clear: () => void
  /** Publica un mensaje sin pasar por una mutación (ej: un gesto rechazado). */
  report: (message: string) => void
  /**
   * Envuelve las opciones de una mutación para que su error llegue a este lugar.
   * Con `rowOf`, el error queda asociado a la fila sobre la que se escribió y se
   * muestra ahí (`messageFor`), no arriba de una lista que puede estar fuera de
   * la vista.
   */
  saving: <TData, TVariables, TContext>(
    fallback: string,
    options: SavingOptions<TData, TVariables, TContext>,
    rowOf?: (variables: TVariables) => string,
  ) => SavingOptions<TData, TVariables, TContext>
}

type SaveError = { message: string; row: string | null }

type SaveErrorsOptions = {
  /**
   * Avisar cada error en lugar de guardarlo para dibujarlo en la página: con esto
   * `message` y `messageFor` quedan siempre en `null`, y el error va, por ejemplo,
   * a un aviso flotante que no corre nada de lugar. Conviene que sea estable
   * (`useCallback`): las opciones que arma `saving` dependen de él.
   */
  notify?: (message: string) => void
}

/**
 * Un solo lugar de error por pantalla, compartido por todas sus mutaciones: es
 * el cuarteto `useState` + limpiar al empezar + `onError` + ternario
 * `instanceof Error` que estaba copiado en una docena de páginas. Hay un solo
 * error a la vez, así que el de una fila reemplaza al de la pantalla y viceversa.
 *
 * El mensaje se limpia desde `mutationFn` y no desde `onMutate` para no
 * pisarle a quien llama su propio `onMutate` ni su contexto de rollback.
 */
export function useSaveErrors({ notify }: SaveErrorsOptions = {}): SaveErrors {
  const [error, setError] = useState<SaveError | null>(null)
  const clear = useCallback(() => setError(null), [])
  const publish = useCallback((next: SaveError) => (notify ? notify(next.message) : setError(next)), [notify])
  const report = useCallback((message: string) => publish({ message, row: null }), [publish])

  const saving = useCallback(
    <TData, TVariables, TContext>(
      fallback: string,
      options: SavingOptions<TData, TVariables, TContext>,
      rowOf?: (variables: TVariables) => string,
    ): SavingOptions<TData, TVariables, TContext> => ({
      ...options,
      mutationFn: (...args) => {
        setError(null)
        return options.mutationFn(...args)
      },
      onError: (...args) => {
        const [thrown, variables] = args
        publish({ message: errorMessage(thrown, fallback), row: rowOf ? rowOf(variables) : null })
        return options.onError?.(...args)
      },
    }),
    [publish],
  )

  return {
    message: error && error.row === null ? error.message : null,
    messageFor: (id) => (error && error.row === id ? error.message : null),
    clear,
    report,
    saving,
  }
}
