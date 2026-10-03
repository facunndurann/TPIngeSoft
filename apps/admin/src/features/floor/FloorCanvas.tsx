import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
} from 'react'
import {
  FLOOR_GRID,
  clampSpan,
  clampToFloor,
  collidesWithAny,
  floorExtent,
  occupiedBy,
  tablePlacement,
} from '@restaurant-platform/shared'
import { Minus, Plus, Users } from 'lucide-react'
import { FloorGrid, type FloorTile } from '@restaurant-platform/ui'
import type { FloorTable } from '@/queries/floor'
import { CHAIR_SIZE, chairsAround } from './chairs'
import { keyBelongsElsewhere } from './keys'
import { OVERLAP_MESSAGE, overlapsAt } from './placement'
import { cardClass, pillClass, roundIconClass } from './styles'

/** Caja de una mesa en celdas: esquina y tamaño. */
export type TableBox = { x: number; y: number; width: number; height: number }

/** Lo que el editor le puede preguntar al plano. */
export type FloorCanvasHandle = {
  /** La celda que se ve en el medio del recuadro: ahí se ubica lo nuevo. */
  centerCell: () => { x: number; y: number }
}

/** Hacia dónde crece la mesa al tirar de una esquina: 1 a la derecha o abajo, -1 al revés. */
type Corner = { dx: 1 | -1; dy: 1 | -1 }

const CORNERS: readonly (Corner & { cursor: string })[] = [
  { dx: -1, dy: -1, cursor: 'cursor-nw-resize' },
  { dx: 1, dy: -1, cursor: 'cursor-ne-resize' },
  { dx: -1, dy: 1, cursor: 'cursor-sw-resize' },
  { dx: 1, dy: 1, cursor: 'cursor-se-resize' },
]

type Gesture =
  | {
      kind: 'move'
      tableId: string
      /** Distancia entre el punto agarrado y la esquina de la mesa, en celdas. */
      offsetX: number
      offsetY: number
      x: number
      y: number
      valid: boolean
    }
  | ({ kind: 'resize'; tableId: string; corner: Corner; valid: boolean } & TableBox)

type FloorCanvasProps = {
  tables: FloorTable[]
  selectedId?: string | null
  /** Con `null`, un toque en el plano vacío suelta la mesa elegida. */
  onSelect?: (tableId: string | null) => void
  /** Ausente en modo vista: el plano queda de solo lectura y las mesas no son botones. */
  onMove?: (tableId: string, x: number, y: number) => void
  /** Estirar desde una esquina puede mover la mesa además de agrandarla. */
  onResize?: (table: FloorTable, box: TableBox) => void
  onReject?: (message: string) => void
  /** Barra de arriba de la tarjeta: las acciones y el estado del sector. */
  toolbar?: ReactNode
  /** Lo que va a la izquierda del zoom, abajo: deshacer y rehacer. */
  footerStart?: ReactNode
  ref?: Ref<FloorCanvasHandle>
}

const ARROW_STEPS: Record<string, { dx: number; dy: number }> = {
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
}

const ZOOM = { min: 0.3, max: 1.5, step: 0.1 } as const

/** Ajustar no acerca más que esto: un sector con una sola mesa no la muestra gigante. */
const FIT_MAX_ZOOM = 1

/** Aire alrededor de las mesas al ajustar: las sillas quedan afuera de su caja. */
const PADDING = 28

/** Píxeles por renglón y por página cuando la rueda no los manda en píxeles. */
const WHEEL_LINE = 16

/**
 * Cuánto cambia el zoom por unidad de rueda con Ctrl o ⌘ (o pellizcando el
 * trackpad, que el navegador manda así). Una rueda de mouse manda saltos de
 * 100: se recortan para que un clic no triplique el zoom.
 */
const WHEEL_ZOOM = { rate: 0.005, maxDelta: 60 } as const

/**
 * Lo que se ve del plano: dónde cae la celda (0, 0) dentro del recuadro, en
 * píxeles, y el zoom. El plano no tiene bordes, así que no hay scroll: moverse
 * es correr la cámara.
 */
type Camera = { x: number; y: number; zoom: number }

type Point = { x: number; y: number }

const clampZoom = (zoom: number) => Math.min(Math.max(zoom, ZOOM.min), ZOOM.max)

/**
 * Damero del fondo, un cuadro por celda. Es del recuadro y no de las mesas, así
 * que no se termina nunca; corre con la cámara para quedar alineado a las celdas.
 */
const checker = ({ x, y, zoom }: Camera) => ({
  backgroundColor: 'var(--color-neutral-50)',
  backgroundImage:
    'conic-gradient(var(--color-neutral-100) 25%, transparent 0 50%, var(--color-neutral-100) 0 75%, transparent 0)',
  backgroundSize: `${FLOOR_GRID.cell * 2 * zoom}px ${FLOOR_GRID.cell * 2 * zoom}px`,
  backgroundPosition: `${x}px ${y}px`,
})

/**
 * Un lado de la mesa que se estira: el borde opuesto queda quieto y el que se
 * agarra sigue al puntero.
 */
function stretch(pointer: number, start: number, size: number, grow: 1 | -1) {
  if (grow > 0) return { start, size: clampSpan(pointer - start) }
  const end = start + size
  const next = clampSpan(end - pointer)
  return { start: end - next, size: next }
}

/** La cámara con otro zoom, sin que se mueva lo que hay en `at` (un punto del recuadro). */
function zoomedAround(camera: Camera, zoom: number, at: Point): Camera {
  const next = clampZoom(zoom)
  return {
    zoom: next,
    x: at.x - ((at.x - camera.x) / camera.zoom) * next,
    y: at.y - ((at.y - camera.y) / camera.zoom) * next,
  }
}

const middle = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * Plano del sector dentro de su tarjeta. El plano no tiene bordes: las mesas se
 * arrastran y se estiran a cualquier lado, sobre una grilla. Se guarda la celda,
 * no el píxel, así el plano se ve igual en cualquier pantalla. La cámara (zoom y
 * desplazamiento) solo cambia cómo se dibuja.
 *
 * Moverse por el plano: la rueda o dos dedos en el trackpad, arrastrar el piso
 * vacío (con el mouse o un dedo), o Espacio y arrastrar desde cualquier lado.
 * Ctrl o ⌘ con la rueda, o pellizcar, acerca y aleja.
 */
export function FloorCanvas({
  tables,
  selectedId = null,
  onSelect,
  onMove,
  onResize,
  onReject,
  toolbar,
  footerStart,
  ref,
}: FloorCanvasProps) {
  const viewport = useRef<HTMLDivElement>(null)
  const [camera, setCamera] = useState<Camera>({ x: PADDING, y: PADDING, zoom: 1 })
  const cameraNow = useRef(camera)
  const tablesNow = useRef(tables)
  useLayoutEffect(() => {
    cameraNow.current = camera
    tablesNow.current = tables
  })
  /**
   * Mientras nadie movió la cámara, el salón se ajusta al recuadro cada vez que
   * el recuadro cambia de tamaño (al abrir la página, al agrandar la ventana).
   * Acercar, alejar o desplazarse a mano lo apaga; «Ajustar al salón» lo vuelve
   * a prender.
   */
  const autoFit = useRef(true)
  const [gesture, setGesture] = useState<Gesture | null>(null)
  const [spaceHeld, setSpaceHeld] = useState(false)
  /** Punteros que están arrastrando el plano: uno lo desplaza, dos lo pellizcan. */
  const panPointers = useRef(new Map<number, Point>())
  const [panning, setPanning] = useState(false)
  /** El puntero está sobre el plano: recién ahí Espacio es para arrastrarlo. */
  const hovering = useRef(false)
  /** El clic que cierra un arrastre del plano no es un toque en el piso: no suelta la mesa. */
  const swallowClick = useRef(false)
  const editable = !!onMove

  /** Un punto de la pantalla, en píxeles del recuadro. */
  const inViewport = useCallback((client: { clientX: number; clientY: number }): Point => {
    const rect = viewport.current?.getBoundingClientRect()
    return { x: client.clientX - (rect?.left ?? 0), y: client.clientY - (rect?.top ?? 0) }
  }, [])

  /** La celda bajo el puntero, con decimales. */
  const cellFromPointer = (event: { clientX: number; clientY: number }) => {
    const point = inViewport(event)
    const cell = FLOOR_GRID.cell * camera.zoom
    return { x: (point.x - camera.x) / cell, y: (point.y - camera.y) / cell }
  }

  useImperativeHandle(
    ref,
    () => ({
      centerCell: () => {
        const view = viewport.current
        const { x, y, zoom } = cameraNow.current
        const cell = FLOOR_GRID.cell * zoom
        return {
          x: ((view?.clientWidth ?? 0) / 2 - x) / cell,
          y: ((view?.clientHeight ?? 0) / 2 - y) / cell,
        }
      },
    }),
    [],
  )

  /** Cámara movida a mano: desde acá, el recuadro ya no la reajusta solo. */
  const moveCamera = useCallback((update: (current: Camera) => Camera) => {
    autoFit.current = false
    setCamera(update)
  }, [])

  /** Acerca o aleja sin que se mueva lo que hay en `at`; sin `at`, el centro del recuadro. */
  const zoomBy = useCallback(
    (update: (zoom: number) => number, at?: { clientX: number; clientY: number }) => {
      const view = viewport.current
      const point = at ? inViewport(at) : { x: (view?.clientWidth ?? 0) / 2, y: (view?.clientHeight ?? 0) / 2 }
      moveCamera((current) => zoomedAround(current, update(current.zoom), point))
    },
    [inViewport, moveCamera],
  )

  /** Encuadra todas las mesas del sector, centradas; sin mesas, el origen del plano. */
  const fit = useCallback(() => {
    const view = viewport.current
    if (!view) return
    const extent = floorExtent(tablesNow.current.map(tablePlacement))
    if (!extent) {
      setCamera({ x: PADDING, y: PADDING, zoom: 1 })
      return
    }
    const width = extent.w * FLOOR_GRID.cell + PADDING * 2
    const height = extent.h * FLOOR_GRID.cell + PADDING * 2
    const zoom = clampZoom(Math.min(view.clientWidth / width, view.clientHeight / height, FIT_MAX_ZOOM))
    setCamera({
      zoom,
      x: view.clientWidth / 2 - (extent.x + extent.w / 2) * FLOOR_GRID.cell * zoom,
      y: view.clientHeight / 2 - (extent.y + extent.h / 2) * FLOOR_GRID.cell * zoom,
    })
  }, [])

  useLayoutEffect(() => {
    const view = viewport.current
    if (!view) return
    const observer = new ResizeObserver(() => {
      if (autoFit.current) fit()
    })
    observer.observe(view)
    return () => observer.disconnect()
  }, [fit])

  // La rueda y los dos dedos del trackpad desplazan el plano; con Ctrl o ⌘ (y el
  // pellizco, que el navegador manda así) acercan alrededor del puntero. Va a
  // mano y no con `onWheel` porque React lo registra pasivo y ahí no se puede
  // frenar el scroll ni el zoom de la página.
  useEffect(() => {
    const view = viewport.current
    if (!view) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const unit = event.deltaMode === 1 ? WHEEL_LINE : event.deltaMode === 2 ? view.clientHeight : 1
      if (event.ctrlKey || event.metaKey) {
        const delta = Math.max(-WHEEL_ZOOM.maxDelta, Math.min(WHEEL_ZOOM.maxDelta, event.deltaY * unit))
        zoomBy((zoom) => zoom * Math.exp(-delta * WHEEL_ZOOM.rate), event)
        return
      }
      moveCamera((current) => ({ ...current, x: current.x - event.deltaX * unit, y: current.y - event.deltaY * unit }))
    }
    view.addEventListener('wheel', onWheel, { passive: false })
    return () => view.removeEventListener('wheel', onWheel)
  }, [zoomBy, moveCamera])

  // Espacio apretado con el puntero sobre el plano: arrastrar mueve la vista
  // aunque se empiece sobre una mesa, como en los editores de diseño. Se frena
  // el scroll de página que haría Espacio, salvo que se esté escribiendo.
  useEffect(() => {
    const press = (event: globalThis.KeyboardEvent) => {
      if (event.code !== 'Space' || !hovering.current || keyBelongsElsewhere(event.target)) return
      event.preventDefault()
      setSpaceHeld(true)
    }
    const release = (event: globalThis.KeyboardEvent) => {
      if (event.code === 'Space') setSpaceHeld(false)
    }
    // Soltar Espacio en otra ventana no llega acá: al volver ya no está apretado.
    const forget = () => setSpaceHeld(false)
    document.addEventListener('keydown', press)
    document.addEventListener('keyup', release)
    window.addEventListener('blur', forget)
    return () => {
      document.removeEventListener('keydown', press)
      document.removeEventListener('keyup', release)
      window.removeEventListener('blur', forget)
    }
  }, [])

  function startPan(event: ReactPointerEvent<HTMLDivElement>) {
    // El botón del medio también arrastra, como en un mapa; el derecho no.
    if (event.button !== 0 && event.button !== 1) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    panPointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    setPanning(true)
  }

  /**
   * Con Espacio apretado, el puntero agarra el plano y no lo que tiene abajo: va
   * en la fase de captura para que ninguna mesa empiece a moverse.
   */
  function grabWithSpace(event: ReactPointerEvent<HTMLDivElement>) {
    swallowClick.current = false
    if (!spaceHeld) return
    event.stopPropagation()
    startPan(event)
  }

  /** Lo que no agarra una mesa ni una manija agarra el piso: arrastrarlo mueve la vista. */
  function grabFloor(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.target instanceof Element && event.target.closest('[data-floor-item]')) return
    startPan(event)
  }

  function panTo(event: ReactPointerEvent<HTMLDivElement>) {
    const points = panPointers.current
    const last = points.get(event.pointerId)
    if (!last) return
    const before = [...points.values()]
    points.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const after = [...points.values()]
    swallowClick.current = true

    if (after.length === 1) {
      moveCamera((current) => ({ ...current, x: current.x + event.clientX - last.x, y: current.y + event.clientY - last.y }))
      return
    }
    // Dos dedos: la distancia entre ellos es el zoom y su punto medio arrastra.
    const rect = viewport.current?.getBoundingClientRect()
    const offset = { x: rect?.left ?? 0, y: rect?.top ?? 0 }
    const from = middle(before[0], before[1])
    const to = middle(after[0], after[1])
    const factor = distance(after[0], after[1]) / (distance(before[0], before[1]) || 1)
    moveCamera((current) => {
      const zoomed = zoomedAround(current, current.zoom * factor, { x: from.x - offset.x, y: from.y - offset.y })
      return { ...zoomed, x: zoomed.x + to.x - from.x, y: zoomed.y + to.y - from.y }
    })
  }

  function endPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (!panPointers.current.delete(event.pointerId)) return
    if (panPointers.current.size === 0) setPanning(false)
  }

  /** Caja del gesto en curso; sin gesto, FloorGrid dibuja la posición guardada. */
  const previewOf = (table: FloorTable) => {
    if (gesture?.tableId !== table.id) return null
    if (gesture.kind === 'move') return { footprint: tablePlacement(table).footprint, x: gesture.x, y: gesture.y }
    return { footprint: { w: gesture.width, h: gesture.height }, x: gesture.x, y: gesture.y }
  }

  function startMove(event: ReactPointerEvent<HTMLElement>, table: FloorTable) {
    onSelect?.(table.id)
    const origin = tablePlacement(table)
    const pointer = cellFromPointer(event)
    event.currentTarget.setPointerCapture(event.pointerId)
    setGesture({
      kind: 'move',
      tableId: table.id,
      offsetX: pointer.x - origin.x,
      offsetY: pointer.y - origin.y,
      x: origin.x,
      y: origin.y,
      valid: true,
    })
  }

  function moveTo(event: ReactPointerEvent<HTMLElement>, table: FloorTable) {
    if (gesture?.kind !== 'move' || gesture.tableId !== table.id) return
    const pointer = cellFromPointer(event)
    const next = clampToFloor(pointer.x - gesture.offsetX, pointer.y - gesture.offsetY)
    setGesture({
      ...gesture,
      ...next,
      valid: !overlapsAt(table, next.x, next.y, tables),
    })
  }

  function startResize(event: ReactPointerEvent<HTMLElement>, table: FloorTable, corner: Corner) {
    event.stopPropagation()
    const { footprint, x, y } = tablePlacement(table)
    event.currentTarget.setPointerCapture(event.pointerId)
    setGesture({ kind: 'resize', tableId: table.id, corner, x, y, width: footprint.w, height: footprint.h, valid: true })
  }

  function resizeTo(event: ReactPointerEvent<HTMLElement>, table: FloorTable) {
    if (gesture?.kind !== 'resize' || gesture.tableId !== table.id) return
    event.stopPropagation()
    const pointer = cellFromPointer(event)
    const origin = tablePlacement(table)
    const across = stretch(pointer.x, origin.x, origin.footprint.w, gesture.corner.dx)
    const down = stretch(pointer.y, origin.y, origin.footprint.h, gesture.corner.dy)
    const box = { x: across.start, y: down.start, width: across.size, height: down.size }
    setGesture({ ...gesture, ...box, valid: fits(table, box) })
  }

  /** Si la mesa entra en esa caja sin pisar a otra del sector. */
  function fits(table: FloorTable, box: TableBox) {
    return !collidesWithAny(
      { x: box.x, y: box.y, footprint: { w: box.width, h: box.height } },
      occupiedBy(tables, table.id),
    )
  }

  function endGesture(table: FloorTable) {
    if (gesture?.tableId !== table.id) return
    const origin = tablePlacement(table)

    if (gesture.kind === 'move') {
      const moved = gesture.x !== origin.x || gesture.y !== origin.y
      if (moved && gesture.valid) onMove?.(table.id, gesture.x, gesture.y)
      if (moved && !gesture.valid) onReject?.(OVERLAP_MESSAGE)
    } else {
      const { x, y, width, height } = gesture
      const resized = x !== origin.x || y !== origin.y || width !== origin.footprint.w || height !== origin.footprint.h
      if (resized && gesture.valid) onResize?.(table, { x, y, width, height })
      if (resized && !gesture.valid) onReject?.(OVERLAP_MESSAGE)
    }
    setGesture(null)
  }

  /**
   * Las flechas mueven la mesa una celda; con Mayús, la agrandan o achican desde
   * el borde de la derecha o el de abajo. Es la vía sin arrastrar (WCAG 2.5.7).
   */
  function handleKeyDown(event: KeyboardEvent<HTMLElement>, table: FloorTable) {
    const step = ARROW_STEPS[event.key]
    if (!step) return
    event.preventDefault()
    const origin = tablePlacement(table)

    if (event.shiftKey) {
      const box = {
        x: origin.x,
        y: origin.y,
        width: clampSpan(origin.footprint.w + step.dx),
        height: clampSpan(origin.footprint.h + step.dy),
      }
      if (box.width === origin.footprint.w && box.height === origin.footprint.h) return
      if (fits(table, box)) onResize?.(table, box)
      else onReject?.(OVERLAP_MESSAGE)
      return
    }

    const next = clampToFloor(origin.x + step.dx, origin.y + step.dy)
    if (next.x === origin.x && next.y === origin.y) return
    if (overlapsAt(table, next.x, next.y, tables)) {
      onReject?.(OVERLAP_MESSAGE)
      return
    }
    onMove?.(table.id, next.x, next.y)
  }

  /** Un toque en el piso vacío (no en una mesa ni en una manija) suelta la mesa elegida. */
  function handleFloorClick(event: ReactMouseEvent<HTMLElement>) {
    if (swallowClick.current) {
      swallowClick.current = false
      return
    }
    if (!editable || !selectedId) return
    if (event.target instanceof Element && event.target.closest('[data-floor-item]')) return
    onSelect?.(null)
  }

  return (
    <div className={`flex min-h-0 flex-1 flex-col overflow-hidden ${cardClass}`}>
      {toolbar && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 px-3 py-2.5">
          {toolbar}
        </div>
      )}

      {/* El recuadro es una ventana a un plano sin bordes: no hay scroll ni barras,
          la cámara corre el contenido y el damero. Los gestos táctiles son todos
          del plano (`touch-none`): un dedo lo arrastra y dos lo pellizcan. */}
      <div
        ref={viewport}
        data-floor-viewport
        className={`min-h-48 flex-1 touch-none overflow-hidden select-none relative ${
          panning ? 'cursor-grabbing **:cursor-grabbing' : spaceHeld ? 'cursor-grab **:cursor-grab' : ''
        }`}
        style={checker(camera)}
        onClick={handleFloorClick}
        onPointerEnter={() => (hovering.current = true)}
        onPointerLeave={() => (hovering.current = false)}
        onPointerDownCapture={grabWithSpace}
        onPointerDown={grabFloor}
        onPointerMove={panTo}
        onPointerUp={endPan}
        onPointerCancel={endPan}
      >
        <div
          className="absolute top-0 left-0"
          style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`, transformOrigin: '0 0' }}
        >
          <FloorGrid
            tables={tables}
            extent="unbounded"
            ariaLabel="Plano del sector"
            preview={previewOf}
          renderTable={(table, tile) => {
            const active = gesture?.tableId === table.id
            const look = tableLook({
              invalid: active && !gesture.valid,
              selected: editable && selectedId === table.id,
              muted: !table.is_active || !table.is_visible,
            })

            return (
              <div key={table.id} className="contents">
                {chairsAround(tile.box, table.shape === 'round', table.seats).map((chair, index) => (
                  <span
                    key={index}
                    aria-hidden="true"
                    className={`absolute rounded-full ${look.chair}`}
                    style={{ ...chair, width: CHAIR_SIZE, height: CHAIR_SIZE, zIndex: active ? 9 : 0 }}
                  />
                ))}

                {editable ? (
                  <button
                    type="button"
                    data-floor-item
                    aria-pressed={look.selected}
                    onPointerDown={(event) => startMove(event, table)}
                    onPointerMove={(event) => moveTo(event, table)}
                    onPointerUp={() => endGesture(table)}
                    onPointerCancel={() => setGesture(null)}
                    onKeyDown={(event) => handleKeyDown(event, table)}
                    // Editando, el toque que empieza sobre una mesa es para arrastrarla
                    // (`touch-none`); el que empieza en la grilla vacía desplaza el plano.
                    className={`${tableBaseClass} cursor-grab touch-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none active:cursor-grabbing ${tile.shapeClass} ${look.table}`}
                    style={{ ...tile.box, zIndex: active ? 10 : 1 }}
                    aria-label={`${table.label}, ${table.seats} lugares${look.muted ? ', fuera de uso' : ''}. Flechas para mover, Mayús y flechas para cambiar el tamaño, Suprimir para eliminar.`}
                  >
                    <TableLabel table={table} tile={tile} muted={look.muted} />
                  </button>
                ) : (
                  <div className={`${tableBaseClass} ${tile.shapeClass} ${look.table}`} style={{ ...tile.box, zIndex: 1 }}>
                    <TableLabel table={table} tile={tile} muted={look.muted} />
                  </div>
                )}

                {/* Manijas de tamaño: solo en la mesa elegida, para no ensuciar el plano.
                    Son un atajo para el mouse y el dedo, sin rol ni foco: el tamaño con
                    teclado se cambia con Mayús y las flechas. */}
                {look.selected &&
                  CORNERS.map((corner) => (
                    <span
                      key={corner.cursor}
                      aria-hidden="true"
                      className={`absolute h-3.5 w-3.5 touch-none rounded-sm border-2 border-primary bg-white ${corner.cursor}`}
                      data-floor-item
                      onPointerDown={(event) => startResize(event, table, corner)}
                      onPointerMove={(event) => resizeTo(event, table)}
                      onPointerUp={() => endGesture(table)}
                      onPointerCancel={() => setGesture(null)}
                      style={{
                        left: tile.box.left + (corner.dx > 0 ? tile.box.width : 0) + corner.dx * HANDLE_REACH - 7,
                        top: tile.box.top + (corner.dy > 0 ? tile.box.height : 0) + corner.dy * HANDLE_REACH - 7,
                        zIndex: active ? 11 : 2,
                      }}
                    />
                  ))}
              </div>
            )
          }}
          />
        </div>
        {tables.length === 0 && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted">
            Este sector todavía no tiene mesas.
          </p>
        )}
      </div>

      <div
        className={`flex flex-wrap items-center gap-3 border-t border-neutral-200 px-3 py-2 ${
          footerStart ? 'justify-between' : 'justify-end'
        }`}
      >
        {footerStart}
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Zoom del plano">
          <button
            type="button"
            className={roundIconClass}
            aria-label="Alejar"
            title="Alejar"
            disabled={camera.zoom <= ZOOM.min}
            onClick={() => zoomBy((zoom) => zoom - ZOOM.step)}
          >
            <Minus size={18} aria-hidden="true" />
          </button>
          <span aria-live="polite" className="min-w-14 text-center text-sm font-semibold text-neutral-900 tabular-nums">
            {Math.round(camera.zoom * 100)} %
          </span>
          <button
            type="button"
            className={roundIconClass}
            aria-label="Acercar"
            title="Acercar"
            disabled={camera.zoom >= ZOOM.max}
            onClick={() => zoomBy((zoom) => zoom + ZOOM.step)}
          >
            <Plus size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`ml-1 ${pillClass('secondary')}`}
            onClick={() => {
              autoFit.current = true
              fit()
            }}
          >
            Ajustar al salón
          </button>
        </div>
      </div>
    </div>
  )
}

/** Del borde de la mesa al centro de su manija: sobre el contorno de la selección. */
const HANDLE_REACH = 7

const tableBaseClass =
  'absolute flex flex-col items-center justify-center overflow-hidden border-2 text-center transition-colors'

/** Colores de una mesa y sus sillas según su estado. El gesto rechazado le gana a todo. */
function tableLook({ invalid, selected, muted }: { invalid: boolean; selected: boolean; muted: boolean }) {
  const selection = selected ? 'outline-3 outline-offset-4 outline-primary' : ''
  if (invalid) return { selected, muted, table: `border-red-500 bg-red-50 text-red-700 ${selection}`, chair: 'bg-red-300' }
  if (muted)
    return {
      selected,
      muted,
      table: `border-dashed border-neutral-300 bg-neutral-50 text-faint ${selection}`,
      chair: selected ? 'bg-primary' : 'bg-neutral-200',
    }
  return {
    selected,
    muted,
    table: `border-neutral-300 bg-white text-neutral-900 hover:border-primary/70 ${selection}`,
    chair: selected ? 'bg-primary' : 'bg-neutral-400',
  }
}

/**
 * Nombre y lugares de la mesa, como entren: en dos renglones si hay lugar, en
 * uno si es baja y larga (una barra), y los lugares con ícono en la de una celda,
 * donde «12 lugares» no entra. Fuera de uso, el estado reemplaza a los lugares.
 */
function TableLabel({ table, tile, muted }: { table: FloorTable; tile: FloorTile; muted: boolean }) {
  const { w, h } = tile.footprint
  const detail = muted ? 'fuera de uso' : `${table.seats} lugares`
  const name = <span className="px-1 text-sm leading-tight font-bold">{table.label}</span>

  if (w >= 2 && h >= 2)
    return (
      <>
        {name}
        <span className="text-xs leading-tight">{detail}</span>
      </>
    )
  if (w >= 3)
    return (
      <span className="flex items-baseline gap-2">
        {name}
        <span className="text-xs leading-tight">{detail}</span>
      </span>
    )
  return (
    <>
      {name}
      {!muted && (
        <span className="inline-flex items-center gap-0.5 text-xs leading-tight">
          <Users size={12} aria-hidden="true" />
          {table.seats}
        </span>
      )}
    </>
  )
}

/** Qué significa cada marca del plano. «Seleccionada» solo existe editando. */
export function FloorLegend({ editing }: { editing: boolean }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
      <li className="flex items-center gap-2">
        <span aria-hidden="true" className="h-3 w-3 rounded-full bg-neutral-400" />
        Cada silla es un lugar
      </li>
      <li className="flex items-center gap-2">
        <span aria-hidden="true" className="h-3 w-5.5 rounded border-2 border-dashed border-neutral-300 bg-neutral-50" />
        Fuera de uso
      </li>
      {editing && (
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="h-3 w-5.5 rounded border-2 border-primary bg-white" />
          Seleccionada
        </li>
      )}
    </ul>
  )
}
