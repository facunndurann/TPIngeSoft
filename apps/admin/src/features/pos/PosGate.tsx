import { useState, type ReactNode } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Delete, Lock, ShieldAlert } from 'lucide-react'
import { Button, ErrorText, Spinner } from '@/components/ui'
import { useIsAdmin, useRestaurant } from '@/restaurant/restaurant-context'
import { loadPosEmployees, verifyPosPin } from './employees-api'
import { usePosOperator, type PosOperator } from './operator-context'

const PIN_LENGTH_MAX = 8

/**
 * Exige un empleado validado por PIN antes de operar el POS (MI-61). Si el
 * restaurante todavía no cargó empleados, el administrador puede operar y ve
 * cómo configurarlos; un usuario operativo no puede.
 */
export function PosGate({ children }: { children: ReactNode }) {
  const restaurant = useRestaurant()
  const isAdmin = useIsAdmin()
  const { operator, unlock } = usePosOperator()

  const employees = useQuery({
    queryKey: ['pos', restaurant.id, 'employees'],
    queryFn: () => loadPosEmployees(restaurant.id),
  })

  if (employees.isLoading) return <Spinner />
  if (employees.isError) {
    return <ErrorText message="No pudimos verificar los empleados habilitados para el POS." />
  }

  const hasActiveEmployees = (employees.data ?? []).some((employee) => employee.is_active)

  if (!operator) {
    if (!hasActiveEmployees && isAdmin) return <>{children}</>
    if (!hasActiveEmployees) return <NoEmployeesScreen />
    return <PinScreen restaurantId={restaurant.id} onUnlock={unlock} />
  }

  return <>{children}</>
}

function NoEmployeesScreen() {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
      <div className="mx-auto mb-3 w-fit rounded-xl bg-amber-100 p-3 text-amber-700">
        <ShieldAlert size={22} />
      </div>
      <h1 className="text-lg font-semibold text-neutral-900">POS sin empleados habilitados</h1>
      <p className="mt-2 text-sm text-neutral-600">
        El administrador todavía no cargó empleados con PIN. Pedile que los dé de alta desde
        Empleados para poder operar el salón.
      </p>
    </div>
  )
}

function PinScreen({
  restaurantId,
  onUnlock,
}: {
  restaurantId: string
  onUnlock: (operator: PosOperator) => void
}) {
  const [pin, setPin] = useState('')

  const unlockMutation = useMutation({
    mutationFn: (value: string) => verifyPosPin(restaurantId, value),
    onSuccess: onUnlock,
    onError: () => setPin(''),
  })

  const press = (digit: string) => {
    if (unlockMutation.isPending) return
    unlockMutation.reset()
    setPin((current) => (current + digit).slice(0, PIN_LENGTH_MAX))
  }

  return (
    <div className="mx-auto w-full max-w-xs rounded-xl border border-neutral-200 bg-white p-6">
      <div className="mb-5 flex flex-col items-center gap-2">
        <div className="rounded-xl bg-indigo-600 p-3 text-white">
          <Lock size={20} />
        </div>
        <h1 className="text-lg font-semibold text-neutral-900">POS bloqueado</h1>
        <p className="text-center text-sm text-neutral-500">Ingresá tu PIN para operar el salón.</p>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (pin.length >= 4 && !unlockMutation.isPending) unlockMutation.mutate(pin)
        }}
        className="space-y-4"
      >
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          aria-label="PIN del empleado"
          value={pin}
          onChange={(event) => {
            unlockMutation.reset()
            setPin(event.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH_MAX))
          }}
          className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-3 text-center text-2xl tracking-[0.4em] text-neutral-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          autoFocus
        />

        <div className="grid grid-cols-3 gap-2">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
            <Button key={digit} type="button" variant="secondary" onClick={() => press(digit)}>
              {digit}
            </Button>
          ))}
          <Button
            type="button"
            variant="ghost"
            aria-label="Borrar"
            onClick={() => setPin((current) => current.slice(0, -1))}
          >
            <Delete size={17} />
          </Button>
          <Button type="button" variant="secondary" onClick={() => press('0')}>
            0
          </Button>
          <Button type="submit" disabled={pin.length < 4 || unlockMutation.isPending}>
            {unlockMutation.isPending ? '…' : 'OK'}
          </Button>
        </div>

        {unlockMutation.isError && (
          <ErrorText
            message={
              unlockMutation.error instanceof Error
                ? unlockMutation.error.message
                : 'No pudimos validar el PIN.'
            }
          />
        )}
      </form>

      <p className="mt-4 text-center text-xs text-neutral-400">
        El PIN identifica quién opera cada comanda.
      </p>
    </div>
  )
}
