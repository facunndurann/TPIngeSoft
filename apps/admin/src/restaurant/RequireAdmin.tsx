import type { ReactNode } from 'react'
import { Navigate } from 'react-router'
import { Lock } from 'lucide-react'
import { Button } from '@/components/ui'
import { usePosOperator } from '@/features/pos/operator-context'
import { useIsAdmin } from './restaurant-context'

/**
 * Corta el acceso a la administración sensible (carta, precios, mesas,
 * configuración). Dos motivos distintos:
 *  - el usuario es operativo: nunca administra, y la RLS aplica lo mismo en la base;
 *  - hay un empleado operando con PIN: el dispositivo está en el salón, así que
 *    primero hay que bloquear el POS para volver al backoffice.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const isAdmin = useIsAdmin()
  const { operator, lock } = usePosOperator()

  if (!isAdmin) return <Navigate to="/pos" replace />
  if (operator) return <PosModeActive operatorName={operator.fullName} onExit={lock} />
  return <>{children}</>
}

function PosModeActive({ operatorName, onExit }: { operatorName: string; onExit: () => void }) {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-neutral-200 bg-white p-6 text-center">
      <div className="mx-auto mb-3 w-fit rounded-xl bg-indigo-50 p-3 text-indigo-700">
        <Lock size={22} />
      </div>
      <h1 className="text-lg font-semibold text-neutral-900">El POS está en uso</h1>
      <p className="mt-2 text-sm text-neutral-600">
        {operatorName} está operando el salón en este dispositivo. Para entrar a la administración,
        bloqueá el POS: quien siga atendiendo va a tener que ingresar su PIN de nuevo.
      </p>
      <Button className="mt-4" onClick={onExit}>
        Bloquear el POS y administrar
      </Button>
    </div>
  )
}
