import type { ReactNode } from 'react'
import { EmptyState, Spinner } from './components'
import { ErrorText } from './ErrorText'

/** Lo que QueryView lee de un resultado de `useQuery`: sus datos, su error y cómo reintentar. */
export type QueryState<T> = {
  data: T | undefined
  error: unknown
  refetch: () => unknown
}

type QuerySource = QueryState<unknown> | readonly QueryState<unknown>[]

/** Los datos de una consulta ya cargada: `useQuery` nunca los resuelve en `undefined`. */
type DataOf<S> = S extends { data: infer D } ? Exclude<D, undefined> : never

/** Con una consulta, sus datos; con varias, una tupla con los de cada una, en el mismo orden. */
export type QueryData<Q extends QuerySource> = Q extends readonly QueryState<unknown>[]
  ? { [K in keyof Q]: DataOf<Q[K]> }
  : DataOf<Q>

type QueryViewProps<Q extends QuerySource> = {
  /** Una consulta, o varias que la pantalla necesita juntas. */
  query: Q
  /** Lo que se dibuja con los datos ya cargados. Nunca corre antes de tenerlos. */
  children: (data: QueryData<Q>) => ReactNode
  /** Qué decir cuando no hay nada que mostrar. Sin esto, `children` dibuja también el vacío. */
  empty?: string
  /**
   * Cuándo no hay nada que mostrar. Por defecto, una lista vacía. Con varias
   * consultas los datos son una tupla, que nunca está vacía: hay que decir cuál manda.
   */
  isEmpty?: (data: QueryData<Q>) => boolean
  /** Mensaje para un error que no trae el suyo (ver ErrorText). */
  fallback?: string
}

const isEmptyList = (data: unknown) => Array.isArray(data) && data.length === 0

/**
 * El único lugar de los paneles que dibuja la carga, el error y el vacío de una
 * lectura. `children` recibe los datos solo cuando existen, así que una pantalla
 * no puede mostrar «todavía no hay nada» cuando en realidad la lectura falló.
 *
 * - Sin datos y con error: el error, con reintento si repetir puede funcionar.
 * - Sin datos y sin error: cargando.
 * - Con datos: el contenido, o el vacío. Si un refetch falló (el POS relee cada
 *   15 segundos), el error aparece arriba y los datos que ya se veían se conservan.
 */
export function QueryView<const Q extends QuerySource>({
  query,
  children,
  empty,
  isEmpty = isEmptyList,
  fallback,
}: QueryViewProps<Q>) {
  const several = Array.isArray(query)
  // TypeScript no estrecha un genérico con Array.isArray: la lista se arma una vez acá.
  const queries = (several ? query : [query]) as readonly QueryState<unknown>[]

  const error = queries.find((entry) => entry.error)?.error
  const retry = () => {
    for (const entry of queries) if (entry.error) void entry.refetch()
  }
  const failure = error ? <ErrorText error={error} fallback={fallback} retry={retry} /> : null

  if (!queries.every((entry) => entry.data !== undefined)) return failure ?? <Spinner />

  const data = (several ? queries.map((entry) => entry.data) : queries[0].data) as QueryData<Q>

  // El aviso ocupa siempre el mismo lugar del árbol: que aparezca o se vaya no
  // remonta el contenido de abajo ni le borra su estado.
  return (
    <>
      {failure}
      {empty !== undefined && isEmpty(data) ? <EmptyState message={empty} /> : children(data)}
    </>
  )
}
