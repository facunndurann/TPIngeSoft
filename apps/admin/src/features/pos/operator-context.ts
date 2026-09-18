import { createContext, useContext } from 'react'

export type PosOperator = {
  id: string
  fullName: string
}

export type PosOperatorState = {
  /** Empleado validado por PIN, o null si el POS está bloqueado. */
  operator: PosOperator | null
  unlock: (operator: PosOperator) => void
  lock: () => void
}

export const PosOperatorContext = createContext<PosOperatorState | null>(null)

export function usePosOperator(): PosOperatorState {
  const state = useContext(PosOperatorContext)
  if (!state) {
    throw new Error('usePosOperator debe usarse dentro de PosOperatorProvider')
  }
  return state
}

/**
 * Empleado a registrar en la auditoría. El fallback de administrador no tiene
 * empleado: la acción queda asociada al usuario de la sesión.
 */
export function useOperatorId(): string | null {
  return usePosOperator().operator?.id ?? null
}
