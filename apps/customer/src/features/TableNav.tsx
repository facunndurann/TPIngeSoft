import { NavLink, useLocation } from 'react-router'
import { cartPath, ordersPath, tableRoot } from '@/features/table-paths'

type TableNavProps = {
  token: string
  cartCount: number
}

/**
 * Las pestañas de la mesa. `NavLink` marca `aria-current="page"` según la ruta: la
 * carta con `end`, porque dentro de un plato ya no se está mirando la carta; el
 * carrito cuenta también al editar una línea.
 */
export function TableNav({ token, cartCount }: TableNavProps) {
  const { search } = useLocation()
  // La query solo la usan la carta y sus platos (categoría y búsqueda): llevarla es
  // volver a la carta con los filtros con que se la estaba recorriendo.
  const menuHref = `${tableRoot(token)}${search}`

  return (
    <nav className="tabs" aria-label="Navegación">
      <NavLink to={menuHref} end>
        La carta
      </NavLink>
      <NavLink to={cartPath(token)}>Mi carrito ({cartCount})</NavLink>
      <NavLink to={ordersPath(token)}>Pedidos</NavLink>
    </nav>
  )
}
