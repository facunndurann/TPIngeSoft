/**
 * Avisos flotantes de la mesa: qué se dice, si se puede revertir y cuánto vive
 * en pantalla. Vive fuera del componente porque el plazo lo comparten la
 * animación del aviso y el temporizador de quien lo publica.
 */

const VISIBLE_MS = 3000
/** Un aviso con deshacer se queda más tiempo: hay que poder alcanzar el botón. */
const UNDO_VISIBLE_MS = 7000
export const FADE_MS = 300

export type Announcement = { id: number; message: string; undo?: () => void }

/** Firma de quien publica avisos; la implementa la mesa y la usan sus paneles. */
export type Announce = (message: string, undo?: () => void) => void

/** Tiempo total en pantalla (visible + salida). El dueño del aviso lo limpia pasado este plazo. */
export function toastDuration(undoable: boolean) {
  return (undoable ? UNDO_VISIBLE_MS : VISIBLE_MS) + FADE_MS
}
