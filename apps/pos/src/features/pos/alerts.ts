import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { countLabel, posColumnFor, sessionRequestsOf } from '@restaurant-platform/shared'
import type { BadgeColor } from '@restaurant-platform/ui'
import { useCan, usePosScope } from '@/context/pos-context'
import { playChime } from './chime'
import { posBoardQuery, posOpenSessionsQuery, type PosOpenSession, type PosOrder } from './queries'

/** Lo que el POS avisa aunque se esté en otra sección. */
export type PosAlert = 'new-orders' | 'calling-tables'

type AlertCopy = {
  /** En la pestaña, al lado del nombre de la sección: «3 nuevas». */
  short: (count: number) => string
  /** La frase entera que lee el lector de pantalla: «3 comandas nuevas». */
  full: (count: number) => string
  tone: BadgeColor
}

export const posAlertCopy: Record<PosAlert, AlertCopy> = {
  'new-orders': {
    short: (count) => countLabel(count, 'nueva'),
    full: (count) => countLabel(count, 'comanda nueva', 'comandas nuevas'),
    tone: 'amber',
  },
  'calling-tables': {
    short: (count) => countLabel(count, 'llama', 'llaman'),
    full: (count) => countLabel(count, 'mesa llama', 'mesas llaman'),
    tone: 'red',
  },
}

// Fuera del hook para que sean estables: TanStack no los vuelve a correr en
// cada render, y el arreglo de ids vuelve igual si no cambió nada.
const newOrderIds = (orders: PosOrder[]) =>
  orders.filter((order) => posColumnFor(order.status) === 'new').map((order) => order.id)
const callingTableCount = (sessions: PosOpenSession[]) =>
  sessions.filter((session) => sessionRequestsOf(session).length > 0).length

/**
 * Cuántas comandas nuevas y cuántas mesas llamando hay. Lee las mismas queries
 * que el tablero y Mesas activas (misma key, misma caché, mismo realtime): el
 * número de la pestaña no puede diferir del de la pantalla.
 */
export function usePosAlerts(): Record<PosAlert, number> {
  const scope = usePosScope()
  const can = useCan()

  const fresh = useQuery({ ...posBoardQuery(scope), select: newOrderIds }).data
  const calling = useQuery({
    ...posOpenSessionsQuery(scope),
    select: callingTableCount,
    enabled: can('floor.read'),
  }).data

  // Suena para quien las toma: la cocina, que es quien las pasa a preparación.
  useChimeOnArrival(fresh, can('orders.prepare'))

  return { 'new-orders': fresh?.length ?? 0, 'calling-tables': calling ?? 0 }
}

/** El aviso entero para la región de estado: «2 comandas nuevas. 1 mesa llama.», o nada. */
export function alertSummary(counts: Record<PosAlert, number>): string {
  return (Object.keys(posAlertCopy) as PosAlert[])
    .filter((alert) => counts[alert] > 0)
    .map((alert) => `${posAlertCopy[alert].full(counts[alert])}.`)
    .join(' ')
}

/**
 * Suena cuando aparece en «Nuevo» un pedido que no estaba. Se sigue por id y no
 * por cantidad: si uno pasa a preparación en la misma lectura en que llega otro,
 * el número no cambia pero hay un pedido que nadie vio. La primera lectura no
 * suena: son los que ya estaban al entrar, no los que acaban de llegar.
 */
function useChimeOnArrival(ids: string[] | undefined, enabled: boolean) {
  const seen = useRef<Set<string> | undefined>(undefined)

  useEffect(() => {
    if (!ids) return
    const arrived = seen.current !== undefined && ids.some((id) => !seen.current!.has(id))
    if (enabled && arrived) playChime()
    seen.current = new Set(ids)
  }, [ids, enabled])
}
