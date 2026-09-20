import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { allocationTotal, formatPrice, MAX_EQUAL_PARTS, MIN_EQUAL_PARTS, type SessionSplit, sessionSplitSchema, SPLIT_PERCENTAGE_TOTAL, splitBill, splitEqualAmounts, splitPercentageAmounts, type SplitBill, type SplitOrder, type SplitParticipant, splitTypeDescriptions, splitTypeLabels, splitTypes } from '@restaurant-platform/shared'

import { TOAST_DURATION_MS } from '@/components/Toast'
import { updateSessionSplit } from '@/features/orders-api'

type BillSplitterProps = {
  sessionId: string
  /** Lo guardado en la sesión, ya validado por parseSessionSplit. */
  split: SessionSplit
  bill: SplitBill
  orders: readonly SplitOrder[]
  participants: readonly (SplitParticipant & { display_name: string; user_id: string })[]
  userId?: string
  /** Quién guardó la división vigente y cuándo; con eso se avisa el cambio ajeno. */
  updatedBy: string | null
  updatedAt: string | null
}

/**
 * Cómo se reparte lo que falta pagar. El componente solo dibuja: los importes
 * salen de `splitBill` y la validez del borrador la decide `sessionSplitSchema`,
 * el mismo schema que revalida la RPC. Acá no se repite ninguna regla.
 */
export function BillSplitter({
  sessionId,
  split,
  bill,
  orders,
  participants,
  userId,
  updatedBy,
  updatedAt,
}: BillSplitterProps) {
  const queryClient = useQueryClient()
  // `null` es la vista de lectura; un borrador abre el editor.
  const [draft, setDraft] = useState<SessionSplit | null>(null)
  const [changedBy, setChangedBy] = useState<string | null>(null)
  const lastSaved = useRef<string | null>(updatedAt)
  const currentParticipantId = participants.find((entry) => entry.user_id === userId)?.id

  // La división es de la mesa: cuando otro comensal guarda, gana lo guardado.
  // El borrador propio se descarta —seguir editando algo viejo termina en que
  // uno le pisa la división al otro sin enterarse— y la pantalla vuelve a la
  // vista de lectura con un aviso de quién lo cambió.
  useEffect(() => {
    // Al montar no hay nada que avisar: lo guardado ya está en pantalla.
    if (updatedAt === lastSaved.current) return
    lastSaved.current = updatedAt
    // Sin saber quién soy no se puede distinguir mi guardado del ajeno.
    if (!updatedAt || !currentParticipantId || updatedBy === currentParticipantId) return
    const author = participants.find((entry) => entry.id === updatedBy)
    setDraft(null)
    setChangedBy(author?.display_name ?? 'Otro comensal')
  }, [updatedAt, updatedBy, participants, currentParticipantId])

  // El aviso dura lo mismo que un toast; cada cambio nuevo reinicia el plazo.
  useEffect(() => {
    if (!changedBy) return
    const timer = setTimeout(() => setChangedBy(null), TOAST_DURATION_MS)
    return () => clearTimeout(timer)
  }, [changedBy])

  const save = useMutation({
    mutationFn: (next: SessionSplit) => updateSessionSplit(sessionId, next),
    onSuccess: async () => {
      setDraft(null)
      setChangedBy(null)
      await queryClient.invalidateQueries({ queryKey: ['session', sessionId] })
    },
  })

  const active = draft ?? split
  const shares = splitBill(bill, orders, participants, active)
  const equalAmounts = active.type === 'equal' && active.equalParts
    ? splitEqualAmounts(bill, active.equalParts)
    : []
  // MI-43: el porcentaje se lee sobre el total de la cuenta, no sobre el
  // pendiente, que encoge cuando otro paga. Es el mismo importe que después
  // cobra la RPC.
  const percentageShares = active.type === 'percentages'
    ? splitPercentageAmounts(bill.total_amount, participants, active.allocations)
    : []
  const amountOf = (participantId: string) =>
    (active.type === 'percentages' ? percentageShares : shares)
      .find((share) => share.participantId === participantId)?.amount ?? 0

  const validation = draft ? sessionSplitSchema.safeParse(draft) : null
  const assigned = draft ? allocationTotal(draft.allocations) : 0

  const setAllocation = (participantId: string, value: string) =>
    setDraft((current) => {
      if (!current) return current
      const allocations = { ...current.allocations }
      // Vacío no es 0 guardado: la clave se saca para no dejar asignaciones
      // muertas de comensales que no participan del reparto.
      if (value === '') delete allocations[participantId]
      else allocations[participantId] = Number(value)
      return { ...current, allocations }
    })

  // Cambiar de modo descarta las asignaciones: el schema solo las admite en
  // `percentages`, y guardarlas de más es lo que dejaba porcentajes zombis.
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

      {active.type !== 'equal' && <ul className="split-list">
        {participants.map((participant) => {
          const isYou = participant.user_id === userId
          const amount = amountOf(participant.id)
          return (
            <li key={participant.id} className="choice">
              <span>
                {participant.display_name}
                {isYou && <span className="badge">vos</span>}
              </span>
              {draft?.type === 'percentages' ? (
                <span className="split-percent">
                  <input
                    type="number"
                    min={0}
                    max={SPLIT_PERCENTAGE_TOTAL}
                    step="0.01"
                    aria-label={`Porcentaje de ${participant.display_name}`}
                    value={draft.allocations[participant.id] ?? ''}
                    onChange={(event) => setAllocation(participant.id, event.target.value)}
                  />
                  <small>%</small>
                </span>
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
      </ul>}

      {draft?.type === 'percentages' && (
        <p className="muted">
          Asignado: {assigned}% de {SPLIT_PERCENTAGE_TOTAL}%.
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

      {save.isError && (
        <p className="notice" role="alert">
          {save.error.message}
        </p>
      )}

      <div className="cart-actions">
        {draft ? (
          <>
            <button disabled={save.isPending} onClick={() => setDraft(null)}>
              Cancelar
            </button>
            <button
              className="primary"
              disabled={!validation?.success || save.isPending}
              onClick={() => validation?.success && save.mutate(validation.data)}
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
