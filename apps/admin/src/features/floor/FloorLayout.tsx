import type { ReactNode } from 'react'

/**
 * La fila de arriba del Salón: los sectores a la izquierda y, a la derecha, lo
 * que se hace con el plano (editar, o guardar y cancelar).
 */
export function FloorHeader({ sections, actions }: { sections?: ReactNode; actions: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {sections}
      <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  )
}

/**
 * El plano a la izquierda y el panel a la derecha, uno debajo del otro en
 * pantallas angostas. Va en una página con `fill`: el plano se estira hasta el
 * margen de abajo, así se ve entero sin scrollear, y nunca baja de 26rem. Lado
 * a lado, el panel no pasa del alto del plano: si tiene más (la mesa elegida,
 * con todo abierto), se desplaza adentro de su tarjeta.
 */
export function FloorLayout({ plan, panel }: { plan: ReactNode; panel: ReactNode }) {
  return (
    // Uno debajo del otro, el plano se queda con el alto que sobra y el panel con
    // el suyo; lado a lado, comparten una sola fila.
    <div className="grid flex-1 grid-rows-[1fr_auto] gap-6 xl:grid-cols-[minmax(0,1fr)_20rem] xl:grid-rows-[1fr]">
      <section aria-label="Plano del sector" className="flex min-h-[26rem] min-w-0 flex-col gap-3">
        {plan}
      </section>
      <div className="relative min-w-0">
        <div className="flex flex-col xl:absolute xl:inset-0">{panel}</div>
      </div>
    </div>
  )
}
