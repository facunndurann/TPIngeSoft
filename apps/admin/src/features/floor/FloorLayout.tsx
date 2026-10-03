import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/**
 * El plano a la izquierda y el panel a la derecha, uno debajo del otro en
 * pantallas angostas.
 *
 * El plano ocupa lo que queda de pantalla desde donde empieza hasta el margen de
 * abajo de la página, así se ve entero sin scrollear; su tarjeta estira el
 * recuadro para llenarlo. Lado a lado, el panel no pasa del alto del plano: si
 * tiene más (la mesa elegida, con todo abierto), se desplaza adentro de su
 * tarjeta.
 */
export function FloorLayout({ plan, panel }: { plan: ReactNode; panel: ReactNode }) {
  const section = useRef<HTMLElement>(null)
  /** Lo que no es del plano: lo que hay arriba de él y el margen de abajo de la página. */
  const [reserved, setReserved] = useState<number | null>(null)

  // Lo de arriba cambia de alto si los sectores o el encabezado ocupan otro
  // renglón: se vuelve a medir cada vez que cambia el tamaño de la página.
  useLayoutEffect(() => {
    const element = section.current
    if (!element) return
    const measure = () => {
      const main = element.closest('main')
      const padding = main ? parseFloat(getComputedStyle(main).paddingBottom) : 0
      setReserved(Math.ceil(element.getBoundingClientRect().top + window.scrollY + padding))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(document.body)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <section
        ref={section}
        aria-label="Plano del sector"
        className="flex min-w-0 flex-col gap-3"
        style={{ height: reserved === null ? '36rem' : `max(26rem, calc(100dvh - ${reserved}px))` }}
      >
        {plan}
      </section>
      <div className="relative min-w-0">
        <div className="flex flex-col xl:absolute xl:inset-0">{panel}</div>
      </div>
    </div>
  )
}
