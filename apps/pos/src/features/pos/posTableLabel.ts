import { LINE, readableSize } from '@restaurant-platform/ui'

/** Todo lo que se lee en una mesa del POS, a zoom 1: 12 px, que se lee de lejos y a contraste pleno. */
const TEXT = 12

/** Lo que el rótulo del estado suma a su letra, en píxeles del plano: relleno y margen (`py-0.5`, `mt-0.5`). */
const STATE_EXTRA = 6

/** El margen arriba del tiempo, o de los lugares (`mt-1`). */
const LAST_GAP = 4

export type PosTableLabel = {
  /** La letra de toda la mesa, en píxeles del plano: en pantalla nunca baja de 12 px. */
  size: number
  nameLines: 1 | 2
  /** El rótulo con el estado, abajo del nombre. */
  state: boolean
  /** Lo que va abajo del estado: cuánto hace que se abrió o, si está libre, sus lugares. */
  last: boolean
}

/**
 * Qué se escribe en una mesa del plano del POS, de lo más a lo menos importante:
 * el nombre, el estado y después el tiempo (o los lugares). El zoom de la cámara
 * se compensa como en el admin (`readableSize`), y lo que deja de entrar se
 * esconde en lugar de cortarse: el estado sigue en el color, y todo, en el nombre
 * accesible de la mesa y en su resumen. El nombre usa dos renglones si sobra alto.
 */
export function posTableLabel(box: { height: number }, zoom: number): PosTableLabel {
  const size = readableSize(TEXT, zoom)
  const name = size * LINE
  const state = size + STATE_EXTRA
  const last = size + LAST_GAP

  const showState = box.height >= name + state
  const showLast = showState && box.height >= name + state + last
  const below = (showState ? state : 0) + (showLast ? last : 0)
  return { size, nameLines: box.height >= 2 * name + below ? 2 : 1, state: showState, last: showLast }
}
