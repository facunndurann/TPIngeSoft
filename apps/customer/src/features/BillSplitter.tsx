import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { allocationTotal, formatElapsed, formatPrice, MAX_EQUAL_PARTS, MIN_EQUAL_PARTS, remainingPercentage, type SessionSplit, sessionSplitSchema, SPLIT_PERCENTAGE_TOTAL, splitBill, splitEqualAmounts, splitPercentageAmounts, type SplitBill, splitTypeDescriptions, splitTypeLabels, splitTypes } from '@restaurant-platform/shared'
import { ErrorText, useNow } from '@restaurant-platform/ui'

import { PercentField } from '@/components/PercentField'
import { toastDuration } from '@/features/announcements'
import { updateSessionSplit } from '@/features/orders-api'
import { useTable } from '@/features/table-context'
import type { loadOrders } from '@/features/orders-api'

type Order = Awaited<ReturnType<typeof loadOrders>>[number]

type BillSplitterProps = {
  split: SessionSplit
  bill: SplitBill
  orders: readonly Order[]
}

export function BillSplitter({ split, bill, orders }: BillSplitterProps) {
  const { session: sessionQuery, me, refreshTable } = useTable()
  const session = sessionQuery.data
  const participants = session?.participants ?? []
  const updatedBy = session?.split_updated_by ?? null
  const updatedAt = session?.split_updated_at ?? null

  const now = useNow()
  const [draft, setDraft] = useState<SessionSplit | null>(null)
  const [changedBy, setChangedBy] = useState<string | null>(null)

  const lastSaved = useRef<string | null>(updatedAt)
  const currentParticipantId = me?.id

  useEffect(() => {
    if (updatedAt === lastSaved.current) return
    lastSaved.current = updatedAt
    if (!updatedAt || !currentParticipantId || updatedBy === currentParticipantId) return
    const author = session?.participants.find((entry) => entry.id === updatedBy)
    setDraft(null)
    setChangedBy(author?.display_name ?? 'Otro comensal')
  }, [updatedAt, updatedBy, session, currentParticipantId])

  useEffect(() => {
    if (!changedBy) return
    const timer = setTimeout(() => setChangedBy(null), toastDuration(false))
    return () => clearTimeout(timer)
  }, [changedBy])

  const save = useMutation({
    mutationFn: ({ sessionId, next }: { sessionId: string; next: SessionSplit }) =>
      updateSessionSplit(sessionId, next),
    onSuccess: async () => {
      setDraft(null)
      setChangedBy(null)
      await refreshTable()
    },
  })

  if (!session || participants.length === 0) return null

  const active = draft ?? split
  const shares = splitBill(bill, orders, participants, active)
  const equalAmounts = active.type === 'equal' && active.equalParts
    ? splitEqualAmounts(bill, active.equalParts)
    : []
  
  const percentageShares = active.type === 'percentages'
    ? splitPercentageAmounts(bill.total_amount, participants, active.allocations)
    : []
    
  const amountOf = (participantId: string) =>
    (active.type === 'percentages' ? percentageShares : shares)
      .find((share) => share.participantId === participantId)?.amount ?? 0

  const author = participants.find((participant) => participant.id === updatedBy)
  const changedByMe = !!updatedBy && updatedBy === currentParticipantId
  const changedAt = updatedAt ? Date.parse(updatedAt) : NaN
  const lastChange =
    author && Number.isFinite(changedAt)
      ? `${changedByMe ? 'La cambiaste vos' : `La cambió ${author.display_name}`} ${formatElapsed(changedAt, now)}.`
      : undefined

  const validation = draft ? sessionSplitSchema.safeParse(draft) : null
  const assigned = draft ? allocationTotal(draft.allocations) : 0

  const setAllocation = (participantId: string, value: number | null) =>
    setDraft((current) => {
      if (!current) return current
      const allocations = { ...current.allocations }
      if (value === null) delete allocations[participantId]
      else allocations[participantId] = value
      return { ...current, allocations }
    })

  const chooseType = (type: SessionSplit['type']) => setDraft({
    type,
    allocations: type === 'percentages' ? (draft?.allocations ?? {}) : {},
    ...(type === 'equal' ? {
      equalParts: draft?.equalParts
        ?? Math.min(MAX_EQUAL_PARTS, Math.max(MIN_EQUAL_PARTS, participants.length)),
    } : {}),
  })

  return (
    <section className="bill-panel" aria-label="División de la cuenta">
      <h3>{draft ? '¿Cómo quieren dividir la cuenta?' : 'División de la cuenta'}</h3>
      <p className="muted">{splitTypeDescriptions[active.type]}</p>
      {!draft && lastChange && <p className="muted">{lastChange}</p>}

      {draft && (
        <div className="split-modes" role="group" aria-label="Forma de dividir">
          {splitTypes.map((type) => (
            <button
              key={type}
              className={type === draft.type ? 'primary' : ''}
              aria-pressed={type === draft.type}
              onClick={() => chooseType(type)}
            >
              {splitTypeLabels[type]}
            </button>
          ))}
        </div>
      )}

      {active.type === 'equal' && (
        <div className="equal-split-summary">
          {draft ? (
            <label>
              Cantidad de personas
              <input
                type="number"
                min={MIN_EQUAL_PARTS}
                max={MAX_EQUAL_PARTS}
                step={1}
                value={draft.equalParts ?? ''}
                onChange={(event) => setDraft((current) => current && ({
                  ...current,
                  equalParts: event.target.value === '' ? undefined : Number(event.target.value),
                }))}
              />
            </label>
          ) : (
            <strong>{active.equalParts} personas</strong>
          )}
          {equalAmounts.length > 0 && (
            <p>
              {equalAmounts.every((amount) => amount === equalAmounts[0])
                ? `${active.equalParts} partes de ${formatPrice(equalAmounts[0])}`
                : `Una parte de ${formatPrice(equalAmounts[0])} y ${equalAmounts.length - 1} de ${formatPrice(equalAmounts[equalAmounts.length - 1])}`}
            </p>
          )}
          <p className="muted">Si sobra algún centavo, se suma a la primera parte para que el total cierre exacto.</p>
        </div>
      )}

      {active.type !== 'equal' && (
        <ul className="split-list">
          {participants.map((participant) => {
            const isYou = participant.id === currentParticipantId
            const amount = amountOf(participant.id)
            return (
              <li key={participant.id} className="choice">
                <span>
                  {participant.display_name}
                  {isYou && <span className="badge">vos</span>}
                </span>
                {draft?.type === 'percentages' ? (
                  <PercentField
                    value={draft.allocations[participant.id] ?? null}
                    max={remainingPercentage(draft.allocations, participant.id)}
                    label={`Porcentaje de ${participant.display_name}`}
                    onChange={(value) => setAllocation(participant.id, value)}
                  />
                ) : amount === 0 ? (
                  <small>No debe nada</small>
                ) : active.type === 'percentages' ? (
                  <span>
                    <small>{active.allocations[participant.id] ?? 0}% · </small>
                    <strong>{formatPrice(amount)}</strong>
                  </span>
                ) : (
                  <strong>{formatPrice(amount)}</strong>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {draft?.type === 'percentages' && (
        <p className="muted" role="status">
          {assigned === SPLIT_PERCENTAGE_TOTAL
            ? `Repartido el ${SPLIT_PERCENTAGE_TOTAL}%.`
            : `Asignado ${assigned}% de ${SPLIT_PERCENTAGE_TOTAL}%: falta repartir ${SPLIT_PERCENTAGE_TOTAL - assigned}%.`}
        </p>
      )}

      {!draft && active.type === 'percentages' && (
        <p className="muted">
          Cada parte se calcula sobre el total en cuenta ({formatPrice(bill.total_amount ?? 0)}).
          Pendiente de pago ahora: {formatPrice(bill.pending_amount ?? 0)}.
        </p>
      )}

      {validation && !validation.success && (
        <p className="notice">{validation.error.issues[0].message}</p>
      )}

      {changedBy && (
        <p className="notice" role="status">
          {changedBy} cambió los detalles del pago.
        </p>
      )}

      <ErrorText variant="menu" error={save.error} />

      <div className="cart-actions">
        {draft ? (
          <>
            <button disabled={save.isPending} onClick={() => setDraft(null)}>
              Cancelar
            </button>
            <button
              className="primary"
              disabled={!validation?.success || save.isPending}
              onClick={() => validation?.success && save.mutate({ sessionId: session.id, next: validation.data })}
            >
              {save.isPending ? 'Guardando…' : 'Guardar división'}
            </button>
          </>
        ) : (
          <button
            className="wide"
            onClick={() => {
              save.reset()
              setDraft(split)
            }}
          >
            {split.type === 'none' ? 'Dividir cuenta' : 'Editar división'}
          </button>
        )}
      </div>
    </section>
  )
}
