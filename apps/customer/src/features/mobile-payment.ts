import {
  asAmount,
  isBilledStatus,
  type MobilePaymentRequest,
  type OrderStatus,
  type PaymentStatus,
  type SessionSplit,
  splitEqualAmounts,
  splitPercentageAmounts,
  type SplitParticipant,
  type Tables,
} from '@restaurant-platform/shared'

/**
 * Qué puede pagar un comensal desde el celular y cuánto. Es el único lugar que lo
 * decide: la pantalla solo dibuja el plan, así cada caso se prueba sin montarla. El
 * servidor vuelve a calcular y validar todo; esto es lo que se muestra antes.
 */

export type Payment = Pick<
  Tables<'payments'>,
  'id' | 'participant_id' | 'amount' | 'method' | 'mode' | 'status'
> & {
  payment_order_items: readonly { order_item_id: string }[]
}

export type PayableItem = {
  id: string
  product_name: string
  quantity: number
  total_price: number
  participant_id: string | null
  is_shared: boolean
}

export type PayableOrder = { status: OrderStatus; order_items: readonly PayableItem[] }

/** Estados en los que un pago ya compromete sus ítems y, si es de partes iguales, su parte. */
type LiveStatus = Extract<PaymentStatus, 'pending' | 'approved'>

export type PaymentItemRow = {
  item: PayableItem
  /** Ya está en un pago aprobado o esperando confirmación: no se puede volver a elegir. */
  coverage?: LiveStatus
  selected: boolean
}

/** Lo que `runMobilePayment` necesita para crear el pago, además de la sesión y el requestId. */
export type PaymentRequest = Omit<
  Extract<MobilePaymentRequest, { action: 'create' }>,
  'action' | 'sessionId' | 'requestId'
>

/**
 * La parte que le toca pagar ahora a este comensal. Elegir ítems manda sobre la
 * división de la mesa; sin ítems elegidos, decide la división. Cada modo trae lo
 * que su texto necesita.
 */
export type PaymentShare =
  | { mode: 'custom'; itemIds: string[]; amount: number }
  | { mode: 'equal_split'; remainingParts: number; amount: number }
  | {
      mode: 'percentage_split'
      percentage: number
      accountTotal: number
      /** El porcentaje sobre el total, antes de descontar lo que ya pagó. */
      shareOfTotal: number
      amount: number
    }
  | { mode: 'full'; amount: number }

/** Lo que la pantalla ofrece: confirmar un pago, iniciar uno o explicar por qué no hay. */
export type PaymentStep =
  /** Ya hay un pago de este comensal esperando la respuesta del proveedor. */
  | { kind: 'pending'; payment: Payment }
  /** Los ítems elegidos suman más que el saldo de la mesa. */
  | { kind: 'exceeds'; balance: number }
  /** Se puede pagar `share.amount`; `request` es exactamente lo que se envía. */
  | { kind: 'payable'; request: PaymentRequest }
  /** Partes iguales sin partes libres: las que quedan ya tienen un pago esperando. */
  | { kind: 'partsReserved' }
  /** Porcentajes: este comensal ya pagó todo lo suyo. */
  | { kind: 'sharePaid'; percentage: number }
  | { kind: 'nothing' }

export type PaymentPlan = {
  /** Ítems de pedidos en cuenta, los únicos que se pueden pagar sueltos. */
  items: PaymentItemRow[]
  share: PaymentShare
  step: PaymentStep
}

export type PaymentPlanInput = {
  participantId: string
  participants: readonly SplitParticipant[]
  split: SessionSplit
  /** Saldo pendiente de la mesa. */
  pending: number
  /** Total en cuenta: es la base del porcentaje, no el pendiente (MI-43). */
  accountTotal: number
  closed: boolean
  orders: readonly PayableOrder[]
  payments: readonly Payment[]
  /** Ítems que marcó el comensal; los que ya cubre otro pago no cuentan. */
  selected: ReadonlySet<string>
}

// Los importes se suman y se comparan en centavos, como el resto de la plata de la
// app: en float 0.1 + 0.2 supera a 0.3 y el plan diría que los ítems exceden el saldo.
const cents = (value: number | string | null | undefined) => Math.round(asAmount(value) * 100)
const sumCents = (values: readonly number[]) =>
  values.reduce((total, value) => total + cents(value), 0)

function isLive(status: PaymentStatus): status is LiveStatus {
  return status === 'pending' || status === 'approved'
}

export function paymentPlan(input: PaymentPlanInput): PaymentPlan {
  const covered = new Map<string, LiveStatus>()
  for (const payment of input.payments) {
    if (!isLive(payment.status)) continue
    for (const { order_item_id } of payment.payment_order_items) {
      covered.set(order_item_id, payment.status)
    }
  }

  const items = input.orders
    .filter((order) => isBilledStatus(order.status))
    .flatMap((order) => order.order_items)
    .map((item): PaymentItemRow => {
      const coverage = covered.get(item.id)
      return { item, coverage, selected: !coverage && input.selected.has(item.id) }
    })

  const chosen = items.filter((row) => row.selected).map((row) => row.item)
  const share = shareFor(input, chosen)
  return { items, share, step: nextStep(input, share) }
}

function shareFor(input: PaymentPlanInput, chosen: PayableItem[]): PaymentShare {
  const { participantId, payments, split } = input
  const pendingCents = cents(input.pending)

  if (chosen.length > 0) {
    return {
      mode: 'custom',
      itemIds: chosen.map((item) => item.id),
      amount: sumCents(chosen.map((item) => item.total_price)) / 100,
    }
  }

  if (split.type === 'equal') {
    // Cada pago vivo de partes iguales toma una parte, y los que esperan
    // confirmación además retienen su importe: no se puede volver a ofrecer.
    const taken = payments.filter(
      (payment) => payment.mode === 'equal_split' && isLive(payment.status),
    )
    const reservedCents = sumCents(
      taken.filter((payment) => payment.status === 'pending').map((payment) => payment.amount),
    )
    const remainingParts = split.equalParts ? Math.max(1, split.equalParts - taken.length) : 1
    const available = Math.max(0, pendingCents - reservedCents) / 100
    // Con una sola parte libre no hay nada que dividir (splitEqualAmounts pide dos o
    // más): esa parte es todo lo disponible.
    const amount = splitEqualAmounts({ pending_amount: available }, remainingParts)[0] ?? available
    return { mode: 'equal_split', remainingParts, amount }
  }

  if (split.type === 'percentages') {
    // MI-43: el porcentaje se aplica al total de la cuenta, y de ahí se descuenta
    // lo que este comensal ya pagó. Misma regla que session_percentage_share, que
    // es la que manda: acá solo se muestra el importe antes de iniciarlo.
    const shareCents =
      splitPercentageAmounts(input.accountTotal, input.participants, split.allocations).find(
        (share) => share.participantId === participantId,
      )?.amountCents ?? 0
    const settledCents = sumCents(
      payments
        .filter((payment) => payment.participant_id === participantId && payment.status === 'approved')
        .map((payment) => payment.amount),
    )
    return {
      mode: 'percentage_split',
      percentage: split.allocations[participantId] ?? 0,
      accountTotal: input.accountTotal,
      shareOfTotal: shareCents / 100,
      amount: Math.min(Math.max(shareCents - settledCents, 0), pendingCents) / 100,
    }
  }

  return { mode: 'full', amount: pendingCents / 100 }
}

function nextStep(input: PaymentPlanInput, share: PaymentShare): PaymentStep {
  // Un pago esperando al proveedor bloquea todo lo demás: primero hay que resolverlo.
  const own = input.payments.find(
    (payment) =>
      payment.participant_id === input.participantId &&
      payment.method === 'mobile' &&
      payment.status === 'pending',
  )
  if (own) return { kind: 'pending', payment: own }

  const amountCents = cents(share.amount)
  const pendingCents = cents(input.pending)
  if (share.mode === 'custom' && amountCents > pendingCents) {
    return { kind: 'exceeds', balance: input.pending }
  }

  // Sin saldo o con la mesa cerrada no hay pago que ofrecer ni parte que explicar.
  if (pendingCents <= 0 || input.closed) return { kind: 'nothing' }
  if (amountCents > 0) {
    const request: PaymentRequest =
      share.mode === 'custom' ? { mode: 'custom', itemIds: share.itemIds } : { mode: share.mode }
    return { kind: 'payable', request }
  }
  // Una parte en cero todavía dice algo: o las partes están tomadas, o ya pagó lo suyo.
  if (share.mode === 'equal_split') return { kind: 'partsReserved' }
  if (share.mode === 'percentage_split') return { kind: 'sharePaid', percentage: share.percentage }
  return { kind: 'nothing' }
}
