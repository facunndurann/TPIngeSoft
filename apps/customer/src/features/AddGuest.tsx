import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  isBilledStatus,
  PARTICIPANT_NAME_MAX_LENGTH,
  participantNameSchema,
} from '@restaurant-platform/shared'
import { ErrorText } from '@restaurant-platform/ui'
import { addGuestParticipant, type loadOrders } from '@/features/orders-api'
import { useTable } from '@/features/table-context'
import { useReturnFocus } from '@/hooks/useReturnFocus'

type Order = Awaited<ReturnType<typeof loadOrders>>[number]

type AddGuestProps = {
  sessionId: string
  orders: readonly Order[]
}

/**
 * Suma a la cuenta a alguien que no escaneó el QR. Es un panel propio, al lado de
 * la división y no dentro de ella: agregar a alguien cambia quiénes pagan, no
 * cómo se reparte. Cerrado es solo el botón que lo abre.
 */
export function AddGuest(props: AddGuestProps) {
  const [open, setOpen] = useState(false)
  // Al abrir, el foco va al nombre (autoFocus del formulario); al cerrar, con
  // «Cancelar» o ya creado el invitado, vuelve a este botón.
  const opener = useReturnFocus(open)

  if (!open) {
    return (
      <button ref={opener} type="button" className="text-button" onClick={() => setOpen(true)}>
        Agregar invitado a la cuenta
      </button>
    )
  }
  // El formulario se desmonta al cerrarse, así que volver a abrirlo empieza de cero.
  return <GuestForm {...props} onClose={() => setOpen(false)} />
}

function GuestForm({
  sessionId,
  orders,
  onClose,
}: AddGuestProps & { onClose: () => void }) {
  const { refreshTable, nameOf } = useTable()
  const [name, setName] = useState('')
  const [itemIds, setItemIds] = useState<ReadonlySet<string>>(() => new Set())
  // El mismo límite que revalida la RPC: un nombre inválido ni siquiera se envía.
  const validName = participantNameSchema.safeParse(name)
  // Solo lo que ya está en cuenta: lo enviado sin confirmar o cancelado no se cobra.
  const items = orders.filter((order) => isBilledStatus(order.status)).flatMap((order) => order.order_items)

  const add = useMutation({
    mutationFn: ({ guestName, ids }: { guestName: string; ids: string[] }) =>
      addGuestParticipant(sessionId, guestName, ids),
    // Se cierra con la mesa ya releída: el invitado aparece en el mismo momento.
    onSuccess: async () => {
      await refreshTable()
      onClose()
    },
  })

  const toggleItem = (id: string) =>
    setItemIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <section className="bill-panel" aria-label="Agregar invitado">
      <h3>Agregar invitado a la cuenta</h3>

      <input
        className="wide"
        aria-label="Nombre del invitado"
        placeholder="Nombre"
        // El botón que abrió el formulario ya no existe: el foco sigue acá.
        autoFocus
        maxLength={PARTICIPANT_NAME_MAX_LENGTH}
        value={name}
        disabled={add.isPending}
        onChange={(event) => setName(event.target.value)}
      />

      {items.length > 0 && (
        <fieldset className="payment-items" disabled={add.isPending}>
          <legend>¿Qué ítems consumió?</legend>
          {items.map((item) => (
            <label key={item.id} className="payment-item">
              <input
                type="checkbox"
                checked={itemIds.has(item.id)}
                onChange={() => toggleItem(item.id)}
              />
              <span>
                <strong>
                  {item.quantity} × {item.product_name}
                </strong>
                <small>
                  Pedida por: {item.is_shared ? 'Compartido' : nameOf(item.participant_id)}
                </small>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      <ErrorText variant="menu" error={add.error} />

      <div className="cart-actions">
        <button onClick={onClose} disabled={add.isPending}>
          Cancelar
        </button>
        <button
          className="primary"
          disabled={add.isPending || !validName.success}
          onClick={() => {
            if (validName.success) add.mutate({ guestName: validName.data, ids: [...itemIds] })
          }}
        >
          {add.isPending ? 'Guardando…' : 'Crear y reasignar ítems'}
        </button>
      </div>
    </section>
  )
}
