import { type Announcement, FADE_MS, toastDuration } from '@/features/announcements'

/**
 * Aviso flotante sin estado ni timers: entrada y salida son dos animaciones CSS,
 * la segunda con retraso. Quien muestra el mensaje decide cuándo quitarlo.
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
