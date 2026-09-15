import { Link, useLocation, useSearchParams } from 'react-router'
import { productMedia } from '@restaurant-platform/shared'
import { MediaCarousel } from '@/features/MediaCarousel'
import { matchesSearch, money } from '@/features/menu'
import type { Menu, Product } from '@/features/menu'
import { menuPath, parseMenuFilters, productPath } from '@/features/table-paths'

type MenuBrowseProps = {
  token: string
  menu: Menu
  canEdit: boolean
  heading: string
  title: string
}

export function MenuBrowse({ token, menu, canEdit, heading, title }: MenuBrowseProps) {
  const { search: locationSearch } = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const { category, search } = parseMenuFilters(searchParams)
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
          <p className="eyebrow">{heading}</p>
          <h2>{title}</h2>
        </div>
        <label className="sr-only" htmlFor="search">
          Buscar platos
        </label>
        <input
          id="search"
          type="search"
          placeholder="Buscar en la carta…"
          value={search}
          onChange={(event) => {
            const query = event.target.value
            const next = new URLSearchParams(searchParams)
            if (query) next.set('q', query)
            else next.delete('q')
            setSearchParams(next, { replace: true })
          }}
        />
      </div>

      <div className="categories" aria-label="Categorías">
        <FilterLink to={menuPath(token, 'all', search)} active={category === 'all'}>
          Todo
        </FilterLink>
        {menu.categories.map((entry) => (
          <FilterLink
            key={entry.id}
            to={menuPath(token, entry.id, search)}
            active={category === entry.id}
          >
            {entry.name}
          </FilterLink>
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
                  to={productPath(token, product.id, locationSearch)}
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

function FilterLink({ to, active, children }: { to: string; active: boolean; children: string }) {
  const location = useLocation()
  const current = `${location.pathname}${location.search}`

  return (
    <Link
      to={to}
      aria-current={active ? 'true' : undefined}
      onClick={(event) => {
        if (current === to) event.preventDefault()
      }}
    >
      {children}
    </Link>
  )
}

function ProductCard({
  product,
  disabled,
  to,
}: {
  product: Product
  disabled: boolean
  to: string
}) {
  const content = (
    <>
      <div>
        <h3>{product.name}</h3>
        <p>{product.description}</p>
        {product.dietary_tags.length > 0 && <small>{product.dietary_tags.join(' · ')}</small>}
        <strong>{money(product.base_price)}</strong>
        {!product.is_available && <span className="unavailable">Agotado</span>}
      </div>
      <MediaCarousel media={productMedia(product)} variant="card" alt={product.name} />
    </>
  )

  if (disabled) {
    return (
      <button className="product-card" disabled>
        {content}
      </button>
    )
  }

  return (
    <Link className="product-card" to={to}>
      {content}
    </Link>
  )
}
