import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { asAmount, formatPrice } from '@restaurant-platform/shared'
import { Button, ErrorText, Modal, useSaveErrors } from '@restaurant-platform/ui'
import { useCan } from '@/context/pos-context'
import { closePosSession, type PosOpenSession } from './queries'

/**
 * Cierre manual de una mesa: el botón, la confirmación y la mutación. Los avisos
 * salen de la misma fila de `pos_open_sessions` en Mesas activas y en la comanda,
 * así las dos pantallas advierten lo mismo antes de cerrar. Sin `sessions.close`
 * no se muestra nada.
 */
export function CloseSessionButton({ session, className }: { session: PosOpenSession; className?: string }) {
  const can = useCan()
  const errors = useSaveErrors()
  const [confirming, setConfirming] = useState(false)

  const close = useMutation(errors.saving('No pudimos cerrar la sesión.', {
    mutationFn: () => closePosSession(session.id),
    // El cliente del POS ya releyó todo: el «Cerrando…» siguió hasta que la mesa
    // salió de las abiertas, y recién ahí se suelta el modal.
    onSuccess: () => setConfirming(false),
  }))

  if (!can('sessions.close')) return null

  const kitchen = session.kitchen_tickets

  return (
    <>
      <Button
        variant="secondary"
        className={className}
        // El error de un intento anterior no se arrastra a la próxima confirmación.
        onClick={() => { errors.clear(); setConfirming(true) }}
      >
        Cerrar sesión
      </Button>

      {confirming && (
        <Modal title={`Cerrar ${session.table_label}`} onClose={() => setConfirming(false)}>
          <div className="space-y-3 text-sm text-neutral-700">
            <p>
              Los comensales no podrán enviar más pedidos en esta cuenta. Si vuelven a escanear el QR se
              abre una sesión nueva.
            </p>
            {asAmount(session.pending_amount) > 0 && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-950">
                Queda {formatPrice(session.pending_amount)} pendiente. Registrá el cobro desde la
                comanda antes de cerrar si la mesa ya pagó.
              </p>
            )}
            {kitchen > 0 && (
              <p className="rounded-lg bg-indigo-50 px-3 py-2 text-indigo-950">
                Hay {kitchen} comanda{kitchen === 1 ? '' : 's'} todavía en cocina. Van a seguir visibles
                en el tablero.
              </p>
            )}
            {asAmount(session.submitted_amount) > 0 && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-red-800">
                Hay pedidos enviados sin aceptar. Podés cancelarlos desde Comandas.
              </p>
            )}
            <ErrorText error={errors.message} />
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setConfirming(false)}>
                Seguir abierta
              </Button>
              <Button
                variant="danger"
                className="flex-1"
                disabled={close.isPending}
                onClick={() => close.mutate()}
              >
                {close.isPending ? 'Cerrando…' : 'Cerrar sesión'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
