import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { formatElapsed, type ElapsedPrecision } from '@restaurant-platform/shared'

/** Cada cuánto reescribir un "hace X" para que no quede viejo en pantalla. */
export const CLOCK_TICK_MS = 15_000

const ClockContext = createContext<number | undefined>(undefined)

/**
 * El momento que muestran los textos que envejecen. Sin proveedor no hay tic,
 * pero la hora del render es la real: el texto queda bien escrito, solo no se
 * reescribe solo.
 */
export function useNow(): number {
  return useContext(ClockContext) ?? Date.now()
}

/**
 * Un «hace X» que se reescribe solo con el tic. Es lo único que lee la hora, así
 * que el reloj redibuja este texto y no la tarjeta o la pantalla que lo contiene.
 */
export function Elapsed({ since, precision }: { since: string | number; precision?: ElapsedPrecision }) {
  return formatElapsed(since, useNow(), precision)
}

/**
 * Un solo intervalo por pantalla, en vez de uno por componente que muestre la
 * hora. El estado vive acá y no en quien lo monta: `children` entra como prop y
 * no cambia con el tic, así que React solo vuelve a dibujar a quien lee la
 * hora, no al árbol entero.
 */
export function ClockProvider({
  tickMs = CLOCK_TICK_MS,
  children,
}: {
  tickMs?: number
  children: ReactNode
}) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), tickMs)
    return () => clearInterval(timer)
  }, [tickMs])

  return <ClockContext value={now}>{children}</ClockContext>
}
