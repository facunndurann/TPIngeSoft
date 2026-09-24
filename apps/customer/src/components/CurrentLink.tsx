import type { ReactNode } from 'react'
import { Link } from 'react-router'

type CurrentLinkProps = {
  to: string
  /** Si este enlace representa lo que se está viendo. */
  current: boolean
  className?: string
  children: ReactNode
}

/**
 * Enlace que marca "estás acá" con `aria-current="page"`, la convención del
 * estándar, cuando lo que se está viendo no se deduce de la ruta: los filtros de la
 * carta van por query, y `NavLink` solo compara el pathname. Las pestañas usan
 * `NavLink`. Tocar el enlace de la URL abierta no agrega historial: el router ya
 * reemplaza la entrada en vez de apilar otra.
 */
export function CurrentLink({ to, current, className, children }: CurrentLinkProps) {
  return (
    <Link to={to} className={className} aria-current={current ? 'page' : undefined}>
      {children}
    </Link>
  )
}
