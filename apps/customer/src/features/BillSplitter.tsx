import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { allocationTotal, formatPrice, remainingPercentage, type SessionSplit, sessionSplitSchema, SPLIT_PERCENTAGE_TOTAL, splitBill, type SplitBill, type SplitOrder, type SplitParticipant, splitTypeDescriptions, splitTypeLabels, splitTypes } from '@restaurant-platform/shared'

import { PercentField } from '@/components/PercentField'
import { useNow } from '@/features/clock'
import { relativeAge } from '@/features/freshness'
import { updateSessionSplit } from '@/features/orders-api'
import { useTable } from '@/features/table-context'

type BillSplitterProps = {
  sessionId: string
  /** Lo guardado en la sesión, ya validado por parseSessionSplit. */
  split: SessionSplit
  bill: SplitBill
  orders: readonly SplitOrder[]
  participants: readonly (SplitParticipant & { display_name: string; user_id: string })[]
  userId?: string
  /** Autor (usuario) y momento del último cambio, como los firma update_session_split. */
  updatedBy?: string | null
  updatedAt?: string | null
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
  // El aviso es de la mesa: el panel que lo monta no tiene que hacerle de túnel.
  const { announce } = useTable()
  const queryClient = useQueryClient()
  const now = useNow()
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

  // El autor se guarda como usuario: el nombre sale de su participación actual,
  // así un cambio de nombre no deja la autoría con el nombre viejo.
  const author = participants.find((participant) => participant.user_id === updatedBy)
  const changedByMe = !!updatedBy && updatedBy === userId
  const changedAt = updatedAt ? Date.parse(updatedAt) : NaN
  const lastChange =
    author && Number.isFinite(changedAt)
      ? `${changedByMe ? 'La cambiaste vos' : `La cambió ${author.display_name}`} ${relativeAge(changedAt, now)}.`
      : undefined

  // La división es de la mesa: el cambio de otro comensal llega por Realtime sin
  // que este haya tocado nada. Cuándo cambió lo dice `split_updated_at`, que
  // `update_session_split` —único escritor de la división— reescribe en sus dos
  // ramas: la división no puede moverse sin que ese momento cambie. El ref arranca
  // con lo que ya estaba al abrir la pantalla, que no es un cambio.
  const seen = useRef(updatedAt)

  useEffect(() => {
    const previous = seen.current
    seen.current = updatedAt
    if (previous === updatedAt) return
    if (!author || changedByMe) return
    announce(`${author.display_name} cambió la división de la cuenta.`)
  }, [updatedAt, author, changedByMe, announce])

  const validation = draft ? sessionSplitSchema.safeParse(draft) : null
  const assigned = draft ? allocationTotal(draft.allocations) : 0

  const setAllocation = (participantId: string, value: number | null) =>
    setDraft((current) => {
      if (!current) return current
      const allocations = { ...current.allocations }
      // El campo vacío llega como `null` y no es 0 guardado: la clave se saca
      // para no dejar asignaciones muertas de quien no participa del reparto.
      if (value === null) delete allocations[participantId]
      else allocations[participantId] = value
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
                <PercentField
                  value={draft.allocations[participant.id] ?? null}
                  max={remainingPercentage(draft.allocations, participant.id)}
                  label={`Porcentaje de ${participant.display_name}`}
                  onChange={(value) => setAllocation(participant.id, value)}
                />
              ) : amount === 0 ? (
                <small>No debe nada</small>
              ) : (
                <strong>{formatPrice(amount)}</strong>
              )}
            </li>
          )
        })}
      </ul>

      {draft?.type === 'percentages' && (
        <p className="muted" role="status">
          {assigned === SPLIT_PERCENTAGE_TOTAL
            ? `Repartido el ${SPLIT_PERCENTAGE_TOTAL}%.`
            : `Asignado ${assigned}% de ${SPLIT_PERCENTAGE_TOTAL}%: falta repartir ${SPLIT_PERCENTAGE_TOTAL - assigned}%.`}
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
