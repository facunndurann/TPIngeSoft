import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  SPLIT_PERCENTAGE_TOTAL,
  allocationTotal,
  sessionSplitSchema,
  splitBill,
  splitTypeDescriptions,
  splitTypeLabels,
  splitTypes,
  type SessionSplit,
  type SplitBill,
  type SplitOrder,
  type SplitParticipant,
} from '@restaurant-platform/shared'
import { money } from '@/features/menu'
import { updateSessionSplit } from '@/features/orders-api'

type BillSplitterProps = {
  sessionId: string
  /** Lo guardado en la sesión, ya validado por parseSessionSplit. */
  split: SessionSplit
  bill: SplitBill
  orders: readonly SplitOrder[]
  participants: readonly (SplitParticipant & { display_name: string; user_id: string })[]
  userId?: string
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
}: BillSplitterProps) {
  const queryClient = useQueryClient()
  // `null` es la vista de lectura; un borrador abre el editor.
  const [draft, setDraft] = useState<SessionSplit | null>(null)

  const save = useMutation({
    mutationFn: (next: SessionSplit) => updateSessionSplit(sessionId, next),
    onSuccess: async () => {
      setDraft(null)
      await queryClient.invalidateQueries({ queryKey: ['session', sessionId] })
    },
  })

  const active = draft ?? split
  const shares = splitBill(bill, orders, participants, active)
  const amountOf = (participantId: string) =>
    shares.find((share) => share.participantId === participantId)?.amount ?? 0

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
  const chooseType = (type: SessionSplit['type']) =>
    setDraft({ type, allocations: type === 'percentages' ? (draft?.allocations ?? {}) : {} })

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

      <ul className="split-list">
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
              ) : (
                <strong>{money(amount)}</strong>
              )}
            </li>
          )
        })}
      </ul>

      {draft?.type === 'percentages' && (
        <p className="muted">
          Asignado: {assigned}% de {SPLIT_PERCENTAGE_TOTAL}%.
        </p>
      )}

      {validation && !validation.success && (
        <p className="notice">{validation.error.issues[0].message}</p>
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
