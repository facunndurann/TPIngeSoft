export type TableView = 'menu' | 'cart' | 'orders'

type TableNavProps = {
  view: TableView
  cartCount: number
  onChange: (view: TableView) => void
}

export function TableNav({ view, cartCount, onChange }: TableNavProps) {
  return (
    <nav className="tabs" aria-label="Navegación">
      <button aria-pressed={view === 'menu'} onClick={() => onChange('menu')}>
        La carta
      </button>
      <button aria-pressed={view === 'cart'} onClick={() => onChange('cart')}>
        Mi carrito ({cartCount})
      </button>
      <button aria-pressed={view === 'orders'} onClick={() => onChange('orders')}>
        Pedidos y cuenta
      </button>
    </nav>
  )
}
