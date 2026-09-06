import { matchesSearch, money } from '@/features/menu'
import type { Menu, Product } from '@/features/menu'

type MenuBrowseProps = {
  menu: Menu
  category: string
  search: string
  canEdit: boolean
  onCategoryChange: (id: string) => void
  onSearchChange: (value: string) => void
  onSelectProduct: (productId: string) => void
}

export function MenuBrowse({
  menu,
  category,
  search,
  canEdit,
  onCategoryChange,
  onSearchChange,
  onSelectProduct,
}: MenuBrowseProps) {
  const visibleCategories = menu.categories.filter(
    (entry) => category === 'all' || entry.id === category,
  )
  const hasResults = menu.products.some(
    (product) =>
      menu.categories.some((entry) => entry.id === product.category_id) &&
      (category === 'all' || product.category_id === category) &&
      matchesSearch(product, search),
  )

  return (
    <>
      <div className="menu-heading">
        <div>
          <p className="eyebrow">HECHO PARA DISFRUTAR</p>
          <h2>¿Qué te gustaría pedir?</h2>
        </div>
        <label className="sr-only" htmlFor="search">
          Buscar platos
        </label>
        <input
          id="search"
          type="search"
          placeholder="Buscar en la carta…"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </div>

      <div className="categories" aria-label="Categorías">
        <button aria-pressed={category === 'all'} onClick={() => onCategoryChange('all')}>
          Todo
        </button>
        {menu.categories.map((entry) => (
          <button
            key={entry.id}
            aria-pressed={category === entry.id}
            onClick={() => onCategoryChange(entry.id)}
          >
            {entry.name}
          </button>
        ))}
      </div>

      {visibleCategories.map((entry) => {
        const products = menu.products.filter(
          (product) => product.category_id === entry.id && matchesSearch(product, search),
        )
        if (products.length === 0) return null

        return (
          <section key={entry.id}>
            <h2>{entry.name}</h2>
            <div className="product-grid">
              {products.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  disabled={!product.is_available || !canEdit}
                  onSelect={() => onSelectProduct(product.id)}
                />
              ))}
            </div>
          </section>
        )
      })}

      {!hasResults && (
        <p className="empty">No hay platos para mostrar. Probá otra búsqueda o categoría.</p>
      )}
    </>
  )
}

function ProductCard({
  product,
  disabled,
  onSelect,
}: {
  product: Product
  disabled: boolean
  onSelect: () => void
}) {
  return (
    <button className="product-card" disabled={disabled} onClick={onSelect}>
      <div>
        <h3>{product.name}</h3>
        <p>{product.description}</p>
        {product.dietary_tags.length > 0 && <small>{product.dietary_tags.join(' · ')}</small>}
        <strong>{money(product.base_price)}</strong>
        {!product.is_available && <span className="unavailable">Agotado</span>}
      </div>
      {product.photo_url && <img src={product.photo_url} alt="" loading="lazy" />}
    </button>
  )
}
