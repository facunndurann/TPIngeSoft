import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { tablePlacement, type Placed } from '@restaurant-platform/shared'
import type { FloorTable } from '@/queries/floor'
import { HOME, cellAt, framing, panned, pinched, revealed, zoomedAround, type Camera, type Point, type ViewSize } from './camera'
import { keyBelongsElsewhere } from './keys'

/** Píxeles por renglón cuando la rueda no los manda en píxeles (por página, el alto del recuadro). */
const WHEEL_LINE = 16

/**
 * Cuánto cambia el zoom por unidad de rueda con Ctrl o ⌘ (o pellizcando el
 * trackpad, que el navegador manda así). Una rueda de mouse manda saltos de
 * 100: se recortan para que un clic no triplique el zoom.
 */
const WHEEL_ZOOM = { rate: 0.005, maxDelta: 60 } as const

type ClientPoint = { clientX: number; clientY: number }

/** Un punto de la pantalla, en píxeles del recuadro. */
function pointIn(viewport: Element | null, client: ClientPoint): Point {
  const rect = viewport?.getBoundingClientRect()
  return { x: client.clientX - (rect?.left ?? 0), y: client.clientY - (rect?.top ?? 0) }
}

export type FloorCamera = ReturnType<typeof useFloorCamera>

/**
 * La cámara del plano y cómo se la mueve: la rueda o dos dedos en el trackpad,
 * arrastrar el piso vacío (con el mouse o un dedo), o Espacio y arrastrar desde
 * cualquier lado; Ctrl o ⌘ con la rueda, o pellizcar, acerca y aleja.
 *
 * Es de la pantalla que dibuja el plano y no del plano: el editor también
 * necesita saber qué se está mirando, para ubicar ahí lo nuevo (`centerCell`).
 */
export function useFloorCamera(tables: readonly FloorTable[]) {
  const viewport = useRef<HTMLDivElement | null>(null)
  const [camera, setCamera] = useState<Camera>(HOME)
  /**
   * Si el último cambio de cámara se desliza o salta. Se desliza lo que pide un
   * botón o el encuadre, que el usuario ve pasar sin estar haciendo nada: así no
   * pierde dónde estaba. Salta lo que sigue a un gesto, que tiene que acompañar
   * al dedo, y el primer encuadre, que no tiene un antes. La animación la hace el
   * plano con CSS (`FloorCanvas`), y respeta «menos movimiento».
   */
  const [glide, setGlide] = useState(false)
  const [view, setView] = useState<ViewSize | null>(null)

  // Mientras nadie movió la cámara, el salón se encuadra solo cada vez que el
  // recuadro cambia de tamaño (al abrir la página, al agrandar la ventana), con
  // las mesas de ese momento: mover una mesa no corre la vista. Se ajusta en el
  // mismo render, sin un efecto: `framedFor` recuerda para qué tamaño se hizo.
  const [autoFit, setAutoFit] = useState(true)
  const [framedFor, setFramedFor] = useState<ViewSize | null>(null)
  if (autoFit && view && view !== framedFor) frame(view, framedFor !== null)

  const [spaceHeld, setSpaceHeld] = useState(false)
  const [panning, setPanning] = useState(false)
  /** Punteros que arrastran el plano, en píxeles del recuadro: uno lo desplaza, dos lo pellizcan. */
  const pointers = useRef(new Map<number, Point>())
  /** El arrastre en curso: si empezó como un toque en el piso y si después se movió. */
  const press = useRef({ tap: false, moved: false })
  /** El puntero está sobre el plano: recién ahí Espacio es para arrastrarlo. */
  const hovering = useRef(false)

  /** Encuadra las mesas en un recuadro de ese tamaño, deslizándose o de una. */
  function frame(size: ViewSize, glideThere: boolean) {
    setGlide(glideThere)
    setFramedFor(size)
    setCamera(framing(tables.map(tablePlacement), size))
  }

  /** Un gesto mueve la cámara: lo sigue al instante, y el salón deja de encuadrarse solo. */
  function follow(update: (current: Camera) => Camera) {
    setGlide(false)
    setAutoFit(false)
    setCamera(update)
  }

  /** Un botón mueve la cámara: se desliza hasta ahí, y el salón deja de encuadrarse solo. */
  function glideTo(update: (current: Camera) => Camera) {
    setGlide(true)
    setAutoFit(false)
    setCamera(update)
  }

  /**
   * Para el recuadro del plano. Lo mide, porque el encuadre depende de su
   * tamaño, y toma la rueda a mano: React registra `onWheel` pasivo, y ahí no se
   * puede frenar el scroll ni el zoom de la página. Lo que se suscribe acá se
   * suelta cuando el recuadro se va (React 19 llama a la función que devuelve).
   */
  const viewportRef = useCallback((node: HTMLDivElement) => {
    viewport.current = node
    const resizes = new ResizeObserver(() => setView({ width: node.clientWidth, height: node.clientHeight }))
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      setGlide(false)
      setAutoFit(false)
      const unit = event.deltaMode === 1 ? WHEEL_LINE : event.deltaMode === 2 ? node.clientHeight : 1
      if (event.ctrlKey || event.metaKey) {
        const delta = Math.max(-WHEEL_ZOOM.maxDelta, Math.min(WHEEL_ZOOM.maxDelta, event.deltaY * unit))
        const at = pointIn(node, event)
        setCamera((current) => zoomedAround(current, current.zoom * Math.exp(-delta * WHEEL_ZOOM.rate), at))
      } else {
        setCamera((current) => panned(current, -event.deltaX * unit, -event.deltaY * unit))
      }
    }
    const enter = () => {
      hovering.current = true
    }
    const leave = () => {
      hovering.current = false
    }

    resizes.observe(node)
    node.addEventListener('wheel', wheel, { passive: false })
    node.addEventListener('pointerenter', enter)
    node.addEventListener('pointerleave', leave)
    return () => {
      resizes.disconnect()
      node.removeEventListener('wheel', wheel)
      node.removeEventListener('pointerenter', enter)
      node.removeEventListener('pointerleave', leave)
      viewport.current = null
    }
  }, [])

  // Espacio apretado con el puntero sobre el plano: arrastrar mueve la vista
  // aunque se empiece sobre una mesa, como en los editores de diseño. Se frena
  // el scroll de página que haría Espacio, salvo que se esté escribiendo.
  useEffect(() => {
    const holdSpace = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || !hovering.current || keyBelongsElsewhere(event.target)) return
      event.preventDefault()
      setSpaceHeld(true)
    }
    const letGoSpace = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpaceHeld(false)
    }
    // Soltar Espacio en otra ventana no llega acá: al volver ya no está apretado.
    const forget = () => setSpaceHeld(false)
    document.addEventListener('keydown', holdSpace)
    document.addEventListener('keyup', letGoSpace)
    window.addEventListener('blur', forget)
    return () => {
      document.removeEventListener('keydown', holdSpace)
      document.removeEventListener('keyup', letGoSpace)
      window.removeEventListener('blur', forget)
    }
  }, [])

  function startDrag(event: ReactPointerEvent<HTMLElement>, tap: boolean) {
    // El botón del medio también arrastra, como en un mapa; el derecho no.
    if (event.button !== 0 && event.button !== 1) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    // Un segundo dedo vuelve el gesto un pellizco: ya no es un toque.
    if (pointers.current.size === 0) press.current = { tap, moved: false }
    else press.current.tap = false
    pointers.current.set(event.pointerId, pointIn(viewport.current, event))
    setPanning(true)
  }

  /** Un apretón que llegó hasta el piso agarra el plano: las mesas no lo dejan pasar. */
  function grab(event: ReactPointerEvent<HTMLElement>) {
    startDrag(event, true)
  }

  /**
   * Con Espacio apretado, el puntero agarra el plano aunque caiga sobre una mesa:
   * va en la fase de captura, antes de que la mesa lo vea. No es un toque en el
   * piso, así que soltarlo sin moverse no suelta la mesa elegida.
   */
  function grabWithSpace(event: ReactPointerEvent<HTMLElement>) {
    if (!spaceHeld) return
    event.stopPropagation()
    startDrag(event, false)
  }

  function drag(event: ReactPointerEvent<HTMLElement>) {
    const last = pointers.current.get(event.pointerId)
    if (!last) return
    const before = [...pointers.current.values()]
    const now = pointIn(viewport.current, event)
    pointers.current.set(event.pointerId, now)
    if (now.x !== last.x || now.y !== last.y) press.current.moved = true
    const after = [...pointers.current.values()]
    follow((current) =>
      after.length === 1
        ? panned(current, now.x - last.x, now.y - last.y)
        : // Dos dedos: mandan los dos primeros, aunque se apoye un tercero.
          pinched(current, [before[0], before[1]], [after[0], after[1]]),
    )
  }

  /** Suelta el plano. Devuelve si fue un toque en el piso que no lo movió. */
  function release(event: ReactPointerEvent<HTMLElement>) {
    if (!pointers.current.delete(event.pointerId) || pointers.current.size > 0) return false
    setPanning(false)
    return press.current.tap && !press.current.moved
  }

  /** Acerca o aleja un paso, sin que se mueva lo que hay en el medio del recuadro. */
  function zoomBy(step: number) {
    const center = { x: (view?.width ?? 0) / 2, y: (view?.height ?? 0) / 2 }
    glideTo((current) => zoomedAround(current, current.zoom + step, center))
  }

  /**
   * Corre la cámara lo justo para que se vea entera una mesa: la que recibe el
   * foco con el teclado, o la que se acaba de mover con flechas (WCAG 2.4.11).
   * Si ya se ve, no toca nada, ni apaga el encuadre automático.
   */
  function reveal(placed: Placed) {
    if (!view) return
    const next = revealed(camera, placed, view)
    if (next !== camera) glideTo(() => next)
  }

  /** «Ajustar al salón»: vuelve a encuadrar las mesas, y a hacerlo solo cuando cambie el recuadro. */
  function fit() {
    setAutoFit(true)
    if (view) frame(view, true)
  }

  return {
    ...camera,
    glide,
    viewportRef,
    panning,
    spaceHeld,
    grab,
    grabWithSpace,
    drag,
    release,
    zoomBy,
    fit,
    reveal,
    /** La celda que se ve en el medio del recuadro: ahí se ubica lo nuevo. */
    centerCell: () => cellAt(camera, { x: (view?.width ?? 0) / 2, y: (view?.height ?? 0) / 2 }),
    /** La celda bajo el puntero, con decimales: la usan los gestos sobre las mesas. */
    cellFromPointer: (event: ClientPoint) => cellAt(camera, pointIn(viewport.current, event)),
  }
}
