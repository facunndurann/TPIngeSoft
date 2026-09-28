import { useEffect } from 'react'
import { useBlocker } from 'react-router'
import { ConfirmDialog } from '@restaurant-platform/ui'

/**
 * Pregunta antes de salir de un formulario con cambios sin guardar, que en una
 * página (no un modal) se perdían sin aviso con «Cancelar», la flecha o el menú.
 *
 * - Navegar dentro del panel (links, `navigate`, el «atrás» del navegador): lo
 *   frena el router y se pregunta con el diálogo del panel.
 * - Recargar o cerrar la pestaña: eso solo lo puede preguntar el navegador, con
 *   su propio texto.
 *
 * Guardar y volver a la lista no es salir: quien guarda apaga `when` antes de navegar.
 */
export function UnsavedChangesGuard({ when }: { when: boolean }) {
  // Cambiar solo la query o el hash no saca del formulario.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => when && currentLocation.pathname !== nextLocation.pathname,
  )

  useEffect(() => {
    if (!when) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Safari todavía pide `returnValue` para mostrar la pregunta.
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [when])

  if (blocker.state !== 'blocked') return null

  return (
    <ConfirmDialog
      title="¿Descartar los cambios?"
      confirmLabel="Descartar cambios"
      cancelLabel="Seguir editando"
      onConfirm={() => blocker.proceed()}
      onCancel={() => blocker.reset()}
    >
      <p>Hay cambios sin guardar en este formulario. Si salís ahora, se pierden.</p>
    </ConfirmDialog>
  )
}
