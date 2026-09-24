/**
 * Avisos flotantes de la mesa: qué se dice, si se puede revertir y cuánto vive
 * en pantalla. El plazo lo lleva la propia animación del aviso (ver Toast), así
 * que pausarla también pausa el cierre.
 */

const VISIBLE_MS = 3000
/** Un aviso con deshacer se queda más tiempo: hay que poder alcanzar el botón. */
const UNDO_VISIBLE_MS = 7000
export const FADE_MS = 300

/** Nombre de la animación de salida en index.css: cuando termina, el aviso se va. */
export const TOAST_EXIT_ANIMATION = 'toastOut'

export type Announcement = { id: number; message: string; undo?: () => void }

/** Firma de quien publica avisos; la implementa la mesa y la usan sus paneles. */
export type Announce = (message: string, undo?: () => void) => void

/** Tiempo total en pantalla (visible + salida), sin contar lo que estuvo en pausa. */
export function toastDuration(undoable: boolean) {
  return (undoable ? UNDO_VISIBLE_MS : VISIBLE_MS) + FADE_MS
}
