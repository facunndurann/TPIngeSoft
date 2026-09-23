import { useState } from 'react'

/** Hace `action` a nombre del comensal: en el acto si ya lo eligió, o apenas lo guarde. */
export type RequireName = (action: () => void) => void

/**
 * El nombre se pide cuando hace falta, no al entrar: quien escanea el QR ve la
 * carta sin trámites, y la primera acción que deja algo a su nombre (agregar un
 * plato, repetir un pedido, enviar) espera a que lo ponga y después sigue sola.
 */
export function useNameGate(named: boolean) {
  // La acción que el comensal intentó sin nombre. Va envuelta para que React no la
  // confunda con un actualizador de estado.
  const [waiting, setWaiting] = useState<{ run: () => void }>()

  const requireName: RequireName = (action) => {
    if (named) action()
    else setWaiting({ run: action })
  }

  return {
    requireName,
    /** Hay una acción esperando el nombre: el diálogo está abierto. */
    asking: waiting !== undefined,
    /** El nombre quedó guardado: la acción que esperaba sigue sola, una única vez. */
    resolve: () => {
      setWaiting(undefined)
      waiting?.run()
    },
    /** El comensal prefirió no ponerlo ahora: la acción se descarta. */
    cancel: () => setWaiting(undefined),
  }
}
