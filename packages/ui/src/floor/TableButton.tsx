import type { ButtonHTMLAttributes, FocusEvent, MouseEvent } from 'react'
import type { FloorTile } from './floorTile'

/** La caja de una mesa en el plano: dónde va, el contenido al medio y su borde. Los colores los pone cada mesa. */
export const tableBoxClass = 'absolute flex flex-col items-center justify-center overflow-hidden border-2 text-center'

/**
 * Lo que el plano (`FloorPlan`) le da a cada mesa para que se maneje sin un
 * puntero: el clic del teclado o de un lector de pantalla cuenta como un toque
 * (`onClick`), y el foco del teclado la trae a la vista (`onFocus`). Una mesa
 * que se toca lo usa entero (`TableButton`); la del editor, que se agarra, solo
 * el foco.
 */
export type TableEvents = {
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  onFocus: (event: FocusEvent<HTMLButtonElement>) => void
}

type TableButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'type' | 'style' | 'onClick' | 'onFocus' | 'aria-label'
> & {
  /** Dónde se dibuja la mesa: el botón ocupa su caja, con su forma. */
  tile: FloorTile
  events: TableEvents
  /** Lo único que oye un lector de pantalla: la mesa y lo que se sabe de ella. */
  'aria-label': string
}

/**
 * Una mesa que se toca, en un plano de solo lectura: la vista del admin y el POS.
 * Es un botón sobre la caja de la mesa, que llega con el teclado y se trae a la
 * vista; los toques del mouse y del dedo los resuelve el plano (ver `FloorPlan`).
 * Los colores y lo que dice los pone cada app.
 */
export function TableButton({ tile, events, className = '', ...props }: TableButtonProps) {
  return (
    <button
      {...props}
      {...events}
      type="button"
      className={`${tableBoxClass} cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none ${tile.shapeClass} ${className}`}
      style={{ ...tile.box, zIndex: 1 }}
    />
  )
}
