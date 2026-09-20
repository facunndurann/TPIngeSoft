import { useLocation } from 'react-router'
import { CurrentLink } from '@/components/CurrentLink'
import { cartPath, isMenuIndex, ordersPath, tableRoot, tableSection } from '@/features/table-paths'

type TableNavProps = {
  token: string
  cartCount: number
}

export function TableNav({ token, cartCount }: TableNavProps) {
  const location = useLocation()
  const section = tableSection(location.pathname)
  // La carta conserva búsqueda y categoría mientras se la esté recorriendo.
  const keepFilters = section === 'menu' || location.pathname.includes('/producto/')
  const menuHref = `${tableRoot(token)}${keepFilters ? location.search : ''}`

  return (
    <nav className="tabs" aria-label="Navegación">
      <CurrentLink to={menuHref} current={section === 'menu' && isMenuIndex(location.pathname)}>
        La carta
      </CurrentLink>
      <CurrentLink to={cartPath(token)} current={section === 'cart'}>
        Mi carrito ({cartCount})
      </CurrentLink>
      <CurrentLink to={ordersPath(token)} current={section === 'orders'}>
        Pedidos y cuenta
      </CurrentLink>
    </nav>
  )
}
