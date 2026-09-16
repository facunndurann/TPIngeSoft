const TOAST_VISIBLE_MS = 3000
const TOAST_FADE_MS = 300

/** Tiempo total en pantalla (visible + salida). El dueño del mensaje lo limpia pasado este plazo. */
export const TOAST_DURATION_MS = TOAST_VISIBLE_MS + TOAST_FADE_MS

/**
 * Aviso flotante sin estado ni timers: entrada y salida son dos animaciones CSS,
 * la segunda con retraso. Quien muestra el mensaje decide cuándo quitarlo.
 */
export function Toast({ message }: { message: string }) {
  return (
    // La región `status` queda montada siempre: los lectores de pantalla solo
    // anuncian cambios dentro de una región viva que ya existía.
    <div className="toast-container" role="status">
      {message && (
        <div
          // Cambiar de mensaje remonta el aviso y reinicia sus animaciones.
          key={message}
          className="toast"
          style={{
            animationDuration: `${TOAST_FADE_MS}ms`,
            animationDelay: `0ms, ${TOAST_VISIBLE_MS}ms`,
          }}
        >
          {message}
        </div>
      )}
    </div>
  )
}
