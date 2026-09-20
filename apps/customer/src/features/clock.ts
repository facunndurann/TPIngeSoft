import { createContext, useContext } from 'react'

/**
 * El reloj de la mesa: un solo tic para todos los "hace X" en pantalla. Antes
 * cada componente que envejecía un texto traía su propio intervalo, así que
 * cuatro timers hacían el mismo trabajo, cada uno a destiempo del resto.
 */
export const ClockContext = createContext<number | undefined>(undefined)

/**
 * El momento que muestran los textos que envejecen. Sin proveedor no hay tic,
 * pero la hora del render es la real: el texto queda bien escrito, solo no se
 * reescribe solo.
 */
export function useNow(): number {
  return useContext(ClockContext) ?? Date.now()
}
