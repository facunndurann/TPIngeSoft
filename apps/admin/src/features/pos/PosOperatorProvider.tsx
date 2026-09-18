import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRestaurant } from '@/restaurant/restaurant-context'
import { PosOperatorContext, type PosOperator, type PosOperatorState } from './operator-context'

/** El POS de un salón queda desatendido entre mesa y mesa. */
const IDLE_LIMIT_MS = 10 * 60 * 1000
const IDLE_CHECK_MS = 15 * 1000

type StoredOperator = PosOperator & { lastActiveAt: number }

function storageKey(restaurantId: string) {
  return `pos-operator:${restaurantId}`
}

function readStored(restaurantId: string): PosOperator | null {
  try {
    const raw = sessionStorage.getItem(storageKey(restaurantId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredOperator
    if (!parsed?.id || !parsed?.fullName) return null
    if (Date.now() - parsed.lastActiveAt > IDLE_LIMIT_MS) return null
    return { id: parsed.id, fullName: parsed.fullName }
  } catch {
    return null
  }
}

function writeStored(restaurantId: string, value: StoredOperator | null) {
  try {
    if (value) sessionStorage.setItem(storageKey(restaurantId), JSON.stringify(value))
    else sessionStorage.removeItem(storageKey(restaurantId))
  } catch {
    /* El POS sigue usable aunque el navegador bloquee el storage. */
  }
}

/**
 * Empleado que está operando el POS en este dispositivo. Vive por encima del
 * layout porque también decide si el backoffice está disponible: mientras
 * alguien opera con PIN, la administración sensible queda fuera de alcance.
 */
export function PosOperatorProvider({ children }: { children: ReactNode }) {
  const restaurant = useRestaurant()
  const [operator, setOperator] = useState<PosOperator | null>(() => readStored(restaurant.id))
  const lastActiveAt = useRef(Date.now())

  const lock = useCallback(() => {
    writeStored(restaurant.id, null)
    setOperator(null)
  }, [restaurant.id])

  const unlock = useCallback(
    (next: PosOperator) => {
      lastActiveAt.current = Date.now()
      writeStored(restaurant.id, { ...next, lastActiveAt: lastActiveAt.current })
      setOperator(next)
    },
    [restaurant.id],
  )

  // Bloqueo por inactividad: cualquier interacción renueva la ventana.
  useEffect(() => {
    if (!operator) return
    const events = ['pointerdown', 'keydown', 'visibilitychange'] as const
    const renew = () => {
      lastActiveAt.current = Date.now()
      writeStored(restaurant.id, { ...operator, lastActiveAt: lastActiveAt.current })
    }
    events.forEach((event) => window.addEventListener(event, renew))
    const timer = window.setInterval(() => {
      if (Date.now() - lastActiveAt.current > IDLE_LIMIT_MS) lock()
    }, IDLE_CHECK_MS)
    return () => {
      events.forEach((event) => window.removeEventListener(event, renew))
      window.clearInterval(timer)
    }
  }, [operator, restaurant.id, lock])

  const state = useMemo<PosOperatorState>(
    () => ({ operator, unlock, lock }),
    [operator, unlock, lock],
  )

  return <PosOperatorContext value={state}>{children}</PosOperatorContext>
}
