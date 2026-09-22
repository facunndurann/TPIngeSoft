import { Link } from 'react-router'
import { formatPrice } from '@restaurant-platform/shared'
import { ErrorText } from '@restaurant-platform/ui'
import { cartPrice } from '@/features/menu'
import { useTable } from '@/features/table-context'
import { cartPath } from '@/features/table-paths'
import { useCart } from '@/stores/cart'

/*
 * Piezas que acompañan a las pantallas de la mesa. El layout no sabe qué ruta está
 * mostrando: cada página monta las que le corresponden, en su lugar.
 */

/** Carga o falla de la carta, en las pantallas que la necesitan para dibujarse. */
export function MenuStatus() {
  const { menu } = useTable()
  if (menu.isPending) return <p role="status">Cargando la carta…</p>
  if (menu.isError) {
    return <ErrorText variant="menu" error={menu.error} retry={() => { void menu.refetch() }} />
  }
  return null
}

/** Un envío sin resultado bloquea el carrito: se avisa desde las pantallas que no lo muestran. */
export function PendingSubmissionNotice() {
  const { token, cartKey } = useTable()
  const pending = useCart((state) => state.submissions[cartKey])
  if (!pending) return null

  return (
    <div className="notice">
      <p>Tu último envío todavía necesita confirmación.</p>
      <Link className="btn" to={cartPath(token)}>
        Consultar o reintentar envío
      </Link>
    </div>
  )
}

/** Atajo al carrito desde donde se elige qué pedir o se mira lo pedido. */
export function CartBar() {
  const { token, menu, items } = useTable()
  if (items.length === 0) return null
  const total = menu.data ? cartPrice(menu.data, items) : 0

  return (
    <Link className="primary cart-bar" to={cartPath(token)}>
      Ver mi carrito <strong>{formatPrice(total)}</strong>
    </Link>
  )
}
