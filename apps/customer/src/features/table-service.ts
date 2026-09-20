import { fromPostgres } from '@restaurant-platform/shared'
import { supabase } from '@/lib/supabase'

/**
 * Avisos que el comensal puede mandar al salón. Cada uno enciende la mesa en el
 * plano del POS (getPosTableState), y cancelarlo la apaga: son el único camino
 * de la app hacia una persona, así que se pueden deshacer.
 */
export const TABLE_SERVICE_KINDS = ['attention', 'bill'] as const

export type TableServiceKind = (typeof TABLE_SERVICE_KINDS)[number]

type TableServiceCopy = {
  /** Botón que manda el aviso. */
  request: string
  /** Estado mientras el aviso está pendiente. */
  waiting: string
  /** Aviso flotante al mandarlo y al cancelarlo. */
  sent: string
  cancelled: string
}

export const tableServiceCopy: Record<TableServiceKind, TableServiceCopy> = {
  attention: {
    request: 'Llamar al mozo',
    waiting: 'Avisamos al mozo',
    sent: 'Avisamos al mozo. Ya viene a tu mesa.',
    cancelled: 'Cancelamos el llamado al mozo.',
  },
  bill: {
    request: 'Pedir la cuenta',
    waiting: 'Pedimos la cuenta',
    sent: 'Pedimos la cuenta. El mozo la lleva a tu mesa.',
    cancelled: 'Cancelamos el pedido de la cuenta.',
  },
}

/** Momento del aviso pendiente de cada tipo, tal como lo guarda la sesión. */
export function tableServiceRequestedAt(
  session: { attention_requested_at?: string | null; bill_requested_at?: string | null } | undefined,
  kind: TableServiceKind,
) {
  const value = kind === 'attention' ? session?.attention_requested_at : session?.bill_requested_at
  return value ?? undefined
}

export async function requestTableService(
  sessionId: string,
  kind: TableServiceKind,
  requested: boolean,
) {
  const { error } = await supabase.rpc('request_table_service', {
    p_session_id: sessionId,
    p_kind: kind,
    p_requested: requested,
  })
  if (error) throw fromPostgres(error)
}
