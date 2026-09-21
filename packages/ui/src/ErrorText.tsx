import { AppError } from '@restaurant-platform/shared'
import { Button } from './components'
import { errorMessage } from './useSaveErrors'

/** Qué decir cuando lo que se rompió no trae mensaje propio. */
const FALLBACK = 'No pudimos conectar. Revisá tu conexión e intentá nuevamente.'

/** Salida para un error que repetir no puede arreglar. */
export type Recovery = { label: string; onAction: () => void }

/** De qué app es el aviso: los paneles de admin y POS, o la carta del comensal. */
type ErrorVariant = 'panel' | 'menu'

type ErrorTextProps = {
  /**
   * Lo que se rompió, sin resolver: el componente saca el mensaje y consulta el
   * catálogo. Un string ya es su propio mensaje (así llega lo que resolvió
   * `useSaveErrors`), y vacío o `null` no dibujan nada.
   */
  error: unknown
  /** Mensaje para un throw que no trae el suyo. */
  fallback?: string
  /** Repetir la misma operación. Solo se ofrece cuando puede funcionar. */
  retry?: () => void
  /** Adónde ir cuando repetir no arregla nada. Por defecto, recargar la página. */
  recover?: Recovery
  variant?: ErrorVariant
}

/**
 * Qué botón ofrecer. Repetir aparece solo cuando puede funcionar: ante un rechazo
 * definitivo el catálogo ya dijo que no, así que la salida lleva a otra parte en
 * lugar de invitar a chocar de nuevo contra lo mismo. Quien no pasa `retry` no
 * tiene nada que ofrecer y su aviso queda en texto, como casi todos los paneles.
 */
function actionFor(retryable: boolean, retry?: () => void, recover?: Recovery): Recovery | null {
  if (retry && retryable) return { label: 'Reintentar', onAction: retry }
  if (recover) return recover
  // Recargar vuelve a pedir todo desde cero: es lo único que puede cambiar cuando
  // el estado de la app quedó viejo y el servidor ya dijo que no.
  if (retry) return { label: 'Recargar la página', onAction: () => window.location.reload() }
  return null
}

const panelText = 'rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700'

/**
 * Un error con la salida que le corresponde, para las tres apps. Recibe el error
 * crudo y no un string resuelto a mano porque el catálogo compartido ya sabe dos
 * cosas que el string pierde: qué mensaje le toca (`errorMessage`) y si repetir
 * arregla algo (`retryable`).
 */
export function ErrorText({
  error,
  fallback = FALLBACK,
  retry,
  recover,
  variant = 'panel',
}: ErrorTextProps) {
  if (!error) return null

  const message = errorMessage(error, fallback)
  // Lo que no viene del catálogo se asume reintentable (red caída, respuesta
  // inesperada), igual que isRetryableError ante un código desconocido.
  const action = actionFor(!(error instanceof AppError) || error.retryable, retry, recover)

  // La carta del comensal la tematiza cada restaurante desde CSS: ahí el aviso es
  // `.notice` con un botón pelado, que la hoja de estilos ya viste.
  if (variant === 'menu') {
    return (
      <div className="notice" role="alert">
        <p>{message}</p>
        {action && <button onClick={action.onAction}>{action.label}</button>}
      </div>
    )
  }

  if (!action) return <p role="alert" className={panelText}>{message}</p>

  return (
    <div role="alert" className="space-y-2">
      <p className={panelText}>{message}</p>
      <Button variant="secondary" onClick={action.onAction}>
        {action.label}
      </Button>
    </div>
  )
}
