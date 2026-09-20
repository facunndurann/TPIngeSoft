import { useCallback, useState } from 'react'
import type { UseMutationOptions } from '@tanstack/react-query'

/** Mensaje mostrable de cualquier throw. `AppError` ya trae el del catálogo. */
export function errorMessage(error: unknown, fallback: string): string {
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
  /** Último error sin resolver de la pantalla, o `null`. */
  message: string | null
  clear: () => void
  /** Publica un mensaje sin pasar por una mutación (ej: un gesto rechazado). */
  report: (message: string) => void
  saving: <TData, TVariables, TContext>(
    fallback: string,
    options: SavingOptions<TData, TVariables, TContext>,
  ) => SavingOptions<TData, TVariables, TContext>
}

/**
 * Un solo lugar de error por pantalla, compartido por todas sus mutaciones: es
 * el cuarteto `useState` + limpiar al empezar + `onError` + ternario
 * `instanceof Error` que estaba copiado en una docena de páginas.
 *
 * El mensaje se limpia desde `mutationFn` y no desde `onMutate` para no
 * pisarle a quien llama su propio `onMutate` ni su contexto de rollback.
 */
export function useSaveErrors(): SaveErrors {
  const [message, setMessage] = useState<string | null>(null)
  const clear = useCallback(() => setMessage(null), [])

  const saving = useCallback(
    <TData, TVariables, TContext>(
      fallback: string,
      options: SavingOptions<TData, TVariables, TContext>,
    ): SavingOptions<TData, TVariables, TContext> => ({
      ...options,
      mutationFn: (...args) => {
        setMessage(null)
        return options.mutationFn(...args)
      },
      onError: (...args) => {
        setMessage(errorMessage(args[0], fallback))
        return options.onError?.(...args)
      },
    }),
    [],
  )

  return { message, clear, report: setMessage, saving }
}
