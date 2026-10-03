/**
 * Cómo se escribe una mesa en el plano: qué tamaño de letra y qué entra. Lo usan
 * las mesas del editor del admin y las del POS; va sin componentes, así se prueba
 * sin un DOM.
 */

/** Ningún texto del plano se lee a menos de esto en pantalla: el mínimo del admin y del POS. */
const MIN_TEXT = 12

/**
 * Un tamaño de letra del plano, en píxeles del plano, que en pantalla nunca baja
 * de `MIN_TEXT`: el zoom de la cámara lo achicaría, y acá se lo compensa.
 */
export const readableSize = (size: number, zoom: number) => Math.max(size, MIN_TEXT / zoom)

/** Lo que mide cada texto a zoom 1: el nombre (`text-sm`) y el detalle (`text-xs`). */
const NAME_SIZE = 14
const DETAIL_SIZE = 12

/** El interlineado (`leading-tight`). */
export const LINE = 1.25

/**
 * Ancho promedio de un carácter, en `em`, para estimar si un texto entra. Algo de
 * más a propósito: es mejor esconder un detalle que mostrarlo cortado.
 */
const CHAR_EM = 0.6

/** Aire a los costados del texto dentro de la mesa, y entre el nombre y el detalle, en píxeles del plano. */
const SIDE = 8

/** Dónde va el detalle de una mesa (sus lugares, o «fuera de uso») respecto de su nombre. */
export type DetailPlacement = 'below' | 'beside' | 'compact' | 'none'

export type LabelLayout = { nameSize: number; detailSize: number; nameLines: 1 | 2; detail: DetailPlacement }

/**
 * Cómo se escribe una mesa en el plano, en píxeles del plano. El zoom de la
 * cámara achicaría el texto: acá se lo compensa para que en pantalla nunca baje
 * de 12 px, y lo que deja de entrar se esconde en lugar de cortarse.
 *
 * El detalle va al lado del nombre en una mesa larga y baja (una barra), abajo
 * si hay alto, como ícono y número si solo entra eso, y si no, no va. El nombre
 * usa dos renglones cuando le sobra alto.
 */
export function labelLayout(
  box: { width: number; height: number },
  zoom: number,
  text: { name: string; detail: string; compact: string | null },
): LabelLayout {
  const nameSize = readableSize(NAME_SIZE, zoom)
  const detailSize = readableSize(DETAIL_SIZE, zoom)
  const nameLine = nameSize * LINE
  const detailLine = detailSize * LINE
  const room = box.width - SIDE
  const widthOf = (characters: number, size: number) => characters * size * CHAR_EM

  const twoLines = box.height >= nameLine + detailLine
  const below = twoLines && widthOf(text.detail.length, detailSize) <= room
  const beside =
    box.height >= nameLine &&
    widthOf(text.name.length, nameSize) + SIDE + widthOf(text.detail.length, detailSize) <= room
  // El ícono de los lugares mide lo mismo que la letra del detalle.
  const compact =
    twoLines && text.compact !== null && widthOf(text.compact.length, detailSize) + detailSize <= room
  const wide = box.width >= 2 * box.height

  const detail: DetailPlacement =
    wide && beside ? 'beside' : below ? 'below' : beside ? 'beside' : compact ? 'compact' : 'none'
  const underName = detail === 'below' || detail === 'compact' ? detailLine : 0
  const nameLines = detail !== 'beside' && box.height >= 2 * nameLine + underName ? 2 : 1
  return { nameSize, detailSize, nameLines, detail }
}
