/** Caja en la que entra el dibujo, en píxeles. */
const BOX = { width: 34, height: 22 } as const

/** Lado mínimo del dibujo: una barra de 5 × 1 tiene que seguir viéndose. */
const MIN_SIDE = 10

/**
 * Dibujo chico de una mesa, con su forma y sus proporciones: identifica la mesa
 * del plano en una lista o en las opciones de forma. Es decorativo; el nombre va
 * siempre al lado.
 */
export function TableGlyph({
  round,
  width,
  height,
  muted = false,
}: {
  round: boolean
  /** En celdas, o cualquier unidad: solo importa la proporción. */
  width: number
  height: number
  muted?: boolean
}) {
  const scale = Math.min(BOX.width / width, BOX.height / height)

  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 border-2 ${round ? 'rounded-full' : 'rounded-[5px]'} ${
        muted ? 'border-dashed border-neutral-300 bg-neutral-50' : 'border-neutral-400 bg-white'
      }`}
      style={{ width: Math.max(MIN_SIDE, width * scale), height: Math.max(MIN_SIDE, height * scale) }}
    />
  )
}
