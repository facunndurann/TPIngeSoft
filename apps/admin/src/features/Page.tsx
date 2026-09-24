import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { iconButtonClass } from '@restaurant-platform/ui'
import { useRestaurant } from '@/restaurant/restaurant-context'

type PageProps = {
  /** El h1 y el título de la pestaña: cada ruta se reconoce entre las pestañas abiertas. */
  title: string
  description?: ReactNode
  /** Lo que va a la derecha del título: la acción principal o los selectores de la página. */
  actions?: ReactNode
  /** Adónde vuelve la flecha, para las páginas que se abren desde una lista. */
  back?: { to: string; label: string }
  /** Salón necesita todo el ancho para el plano; el resto se lee mejor con un ancho fijo. */
  wide?: boolean
  children: ReactNode
}

/**
 * El marco de cada página del panel: título de la pestaña, encabezado y ancho.
 * Antes cada página armaba el suyo y el ancho variaba entre max-w-2xl, 3xl y
 * ninguno; ahora hay dos, el de lectura y el de Salón.
 */
export function Page({ title, description, actions, back, wide = false, children }: PageProps) {
  const restaurant = useRestaurant()

  return (
    <div className={`space-y-5 ${wide ? '' : 'mx-auto max-w-3xl'}`}>
      {/* React 19 lo lleva al <head>. */}
      <title>{`${title} · ${restaurant.name}`}</title>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {back && (
            <Link to={back.to} className={iconButtonClass()} aria-label={back.label} title={back.label}>
              <ArrowLeft size={20} aria-hidden="true" />
            </Link>
          )}
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-neutral-900">{title}</h1>
            {description && <p className="text-sm text-muted">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children}
    </div>
  )
}
