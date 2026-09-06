import { Link, useLocation } from 'react-router'
import { cartPath, isMenuIndex, ordersPath, tableRoot, tableSection } from '@/features/table-paths'

type TableNavProps = {
  token: string
  cartCount: number
}

export function TableNav({ token, cartCount }: TableNavProps) {
  const location = useLocation()
  const section = tableSection(location.pathname)
  const menuHref = `${tableRoot(token)}${section === 'menu' || location.pathname.includes('/producto/') ? location.search : ''}`
  const cartHref = cartPath(token)
  const ordersHref = ordersPath(token)

  return (
    <nav className="tabs" aria-label="Navegación">
      <Link
        to={menuHref}
        aria-current={section === 'menu' ? 'page' : undefined}
        onClick={(event) => {
          if (isMenuIndex(location.pathname) && `${location.pathname}${location.search}` === menuHref) {
            event.preventDefault()
          }
        }}
      >
        La carta
      </Link>
      <Link
        to={cartHref}
        aria-current={section === 'cart' ? 'page' : undefined}
        onClick={(event) => {
          if (location.pathname === cartHref) event.preventDefault()
        }}
      >
        Mi carrito ({cartCount})
      </Link>
      <Link
        to={ordersHref}
        aria-current={section === 'orders' ? 'page' : undefined}
        onClick={(event) => {
          if (location.pathname === ordersHref) event.preventDefault()
        }}
      >
        Pedidos y cuenta
      </Link>
    </nav>
  )
}
