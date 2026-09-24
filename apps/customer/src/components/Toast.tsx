import { type Announcement, FADE_MS, TOAST_EXIT_ANIMATION, toastDuration } from '@/features/announcements'

/**
 * Aviso flotante sin estado ni timers: entrada y salida son dos animaciones CSS, la
 * segunda con retraso, y el aviso se cierra cuando esa salida termina. La animación
 * es el reloj: mientras el aviso está bajo el puntero o tiene el foco, index.css la
 * pausa, y con ella el cierre (WCAG 2.2.1). Así «Deshacer» no se escapa mientras se
 * lo busca.
 */
export function Toast({
  announcement,
  onDismiss,
}: {
  announcement?: Announcement
  onDismiss: () => void
}) {
  return (
    // La región `status` queda montada siempre: los lectores de pantalla solo
    // anuncian cambios dentro de una región viva que ya existía.
    <div className="toast-container" role="status">
      {announcement && (
        <div
          // Cada aviso remonta el suyo y reinicia sus animaciones, incluso si
          // repite el texto del anterior.
          key={announcement.id}
          className="toast"
          style={{
            animationDuration: `${FADE_MS}ms`,
            animationDelay: `0ms, ${toastDuration(!!announcement.undo) - FADE_MS}ms`,
          }}
          // También termina la entrada, y la de un botón de adentro: solo la salida cierra.
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget && event.animationName === TOAST_EXIT_ANIMATION) onDismiss()
          }}
        >
          <span>{announcement.message}</span>
          {announcement.undo && (
            <button
              type="button"
              className="toast-undo"
              onClick={() => {
                announcement.undo?.()
                onDismiss()
              }}
            >
              Deshacer
            </button>
          )}
        </div>
      )}
    </div>
  )
}
