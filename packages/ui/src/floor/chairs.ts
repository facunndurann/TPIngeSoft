import type { FloorTile } from './floorTile'

/** Lado de una silla del plano, en píxeles con zoom 1. */
export const CHAIR_SIZE = 12

/** Del borde de la mesa al centro de la silla: queda afuera, con aire entre las dos. */
const CHAIR_REACH = 11

type Side = 'top' | 'bottom' | 'left' | 'right'

const SIDES: readonly Side[] = ['top', 'bottom', 'left', 'right']

/**
 * Cuántas sillas van en cada lado de una mesa rectangular. Cada silla va al lado
 * que más espacio le deja; a igual espacio, en el orden de `SIDES`. Una mesa
 * larga y angosta (una barra, un tablón) no lleva sillas en las puntas.
 */
export function seatsPerSide(width: number, height: number, seats: number): Record<Side, number> {
  const count: Record<Side, number> = { top: 0, bottom: 0, left: 0, right: 0 }
  const length: Record<Side, number> = { top: width, bottom: width, left: height, right: height }
  const usable =
    width >= 2 * height ? SIDES.slice(0, 2) : height >= 2 * width ? SIDES.slice(2) : SIDES

  for (let seat = 0; seat < seats; seat += 1) {
    const side = usable.reduce((best, candidate) =>
      length[candidate] / (count[candidate] + 1) > length[best] / (count[best] + 1) ? candidate : best,
    )
    count[side] += 1
  }
  return count
}

/** Reparte `count` puntos a lo largo de un lado, sin tocar las esquinas. */
const spread = (count: number, length: number) =>
  Array.from({ length: count }, (_, index) => (length * (index + 1)) / (count + 1))

/**
 * Esquina superior izquierda de cada silla alrededor de la mesa, en píxeles del
 * plano: una por lugar. Las redondas las reparten en círculo desde arriba; las
 * rectangulares, por lado.
 */
export function chairsAround(box: FloorTile['box'], round: boolean, seats: number) {
  const centers: { x: number; y: number }[] = []

  if (round) {
    const rx = box.width / 2
    const ry = box.height / 2
    for (let seat = 0; seat < seats; seat += 1) {
      const angle = -Math.PI / 2 + (2 * Math.PI * seat) / seats
      centers.push({
        x: box.left + rx + (rx + CHAIR_REACH) * Math.cos(angle),
        y: box.top + ry + (ry + CHAIR_REACH) * Math.sin(angle),
      })
    }
  } else {
    const sides = seatsPerSide(box.width, box.height, seats)
    for (const x of spread(sides.top, box.width)) centers.push({ x: box.left + x, y: box.top - CHAIR_REACH })
    for (const x of spread(sides.bottom, box.width))
      centers.push({ x: box.left + x, y: box.top + box.height + CHAIR_REACH })
    for (const y of spread(sides.left, box.height)) centers.push({ x: box.left - CHAIR_REACH, y: box.top + y })
    for (const y of spread(sides.right, box.height))
      centers.push({ x: box.left + box.width + CHAIR_REACH, y: box.top + y })
  }

  return centers.map(({ x, y }) => ({ left: x - CHAIR_SIZE / 2, top: y - CHAIR_SIZE / 2 }))
}
