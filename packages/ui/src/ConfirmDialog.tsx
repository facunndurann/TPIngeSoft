import { useCallback, useState, type ReactNode } from 'react'
import { Button, Modal } from './components'

type ConfirmDialogProps = {
  /** La pregunta, con el objeto nombrado: «¿Eliminar "Clásica"?». */
  title: string
  /** La consecuencia, y lo que haga falta ver antes de decidir (avisos, el error de un intento). */
  children?: ReactNode
  /** El verbo de la acción, nunca «Aceptar»: «Eliminar», «Cerrar mesa». */
  confirmLabel: string
  /** El texto del botón mientras la acción corre: «Eliminando…». */
  busyLabel?: string
  cancelLabel?: string
  /** Rojo para lo que destruye algo; el primario para lo que solo pide confirmación. */
  tone?: 'danger' | 'primary'
  /** La acción ya corre: su botón se apaga hasta que termine. */
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Confirmación de una acción que no se deshace, sobre el Modal de siempre. El foco
 * arranca en la opción que no destruye nada, así un Enter apurado no borra, y
 * Escape, el fondo o la × equivalen a cancelar.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busyLabel,
  cancelLabel = 'Cancelar',
  tone = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="space-y-4 text-sm text-neutral-700">
        {children}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" data-autofocus onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={tone} className="flex-1" disabled={busy} onClick={onConfirm}>
            {busy && busyLabel ? busyLabel : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** Lo que se le pregunta a `confirm`: el diálogo sin sus callbacks. */
export type ConfirmRequest = Pick<ConfirmDialogProps, 'title' | 'confirmLabel' | 'cancelLabel' | 'tone'> & {
  /** La consecuencia, en una frase: «Se pierde su QR.». */
  message?: ReactNode
}

/**
 * `window.confirm` con el diálogo del panel: `await confirm({ … })` dice si se
 * confirmó, y `dialog` se dibuja una vez en la pantalla. La acción corre después
 * de cerrarlo, así que su error se muestra donde ya se mostraba (en la fila).
 * Para una acción que tiene que mostrar su progreso o su error adentro del
 * diálogo, `ConfirmDialog` directo.
 */
export function useConfirm() {
  const [request, setRequest] = useState<(ConfirmRequest & { resolve: (confirmed: boolean) => void }) | null>(null)

  const confirm = useCallback(
    (options: ConfirmRequest) => new Promise<boolean>((resolve) => setRequest({ ...options, resolve })),
    [],
  )

  const answer = (confirmed: boolean) => {
    request?.resolve(confirmed)
    setRequest(null)
  }

  const dialog = request && (
    <ConfirmDialog
      title={request.title}
      confirmLabel={request.confirmLabel}
      cancelLabel={request.cancelLabel}
      tone={request.tone}
      onConfirm={() => answer(true)}
      onCancel={() => answer(false)}
    >
      {request.message && <p>{request.message}</p>}
    </ConfirmDialog>
  )

  return { confirm, dialog }
}
