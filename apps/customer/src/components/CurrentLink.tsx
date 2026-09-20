import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router'

type CurrentLinkProps = {
  to: string
  /** Si este enlace representa lo que se está viendo. */
  current: boolean
  className?: string
  children: ReactNode
}

/**
 * Enlace de navegación de la mesa: una sola convención para "estás acá"
 * (`aria-current="page"`, la del estándar) y una sola regla para no navegar a la
 * URL que ya está abierta. Antes las pestañas y los filtros de la carta hacían
 * cada uno lo suyo, con dos valores distintos de aria-current.
 */
export function CurrentLink({ to, current, className, children }: CurrentLinkProps) {
  const location = useLocation()
  // Misma URL exacta: el destino no agrega historial ni vuelve a montar la vista.
  const here = `${location.pathname}${location.search}` === to

  return (
    <Link
      to={to}
      className={className}
      aria-current={current ? 'page' : undefined}
      onClick={(event) => {
        if (here) event.preventDefault()
      }}
    >
      {children}
    </Link>
  )
}
