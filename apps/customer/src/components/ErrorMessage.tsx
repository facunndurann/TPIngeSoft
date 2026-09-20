import { AppError } from '@restaurant-platform/shared'

const FALLBACK = 'No pudimos conectar. Revisá tu conexión e intentá nuevamente.'

/** Salida para un error que repetir no puede arreglar. */
type Recovery = { label: string; onAction: () => void }

type ErrorMessageProps = {
  error: unknown
  retry: () => void
  /** Siguiente paso ante un rechazo definitivo. Por defecto, recargar la app. */
  recover?: Recovery
}

/**
 * Un error con la salida que le corresponde. Repetir solo se ofrece cuando puede
 * funcionar: el catálogo compartido ya sabe qué rechazos son definitivos
 * (`retryable`), y para esos el botón lleva a otra parte en lugar de invitar a
 * chocar de nuevo contra lo mismo.
 */
export function ErrorMessage({ error, retry, recover }: ErrorMessageProps) {
  const message = error instanceof Error ? error.message : FALLBACK
  // Lo que no viene del catálogo se asume reintentable (red caída, respuesta
  // inesperada), igual que isRetryableError ante un código desconocido.
  const retryable = !(error instanceof AppError) || error.retryable

  if (retryable) {
    return (
      <div className="notice" role="alert">
        <p>{message}</p>
        <button onClick={retry}>Reintentar</button>
      </div>
    )
  }

  // Recargar vuelve a pedir todo desde cero: es lo único que puede cambiar
  // cuando el estado de la app quedó viejo y el servidor ya dijo que no.
  const { label, onAction } = recover ?? {
    label: 'Recargar la página',
    onAction: () => window.location.reload(),
  }

  return (
    <div className="notice" role="alert">
      <p>{message}</p>
      <button onClick={onAction}>{label}</button>
    </div>
  )
}
