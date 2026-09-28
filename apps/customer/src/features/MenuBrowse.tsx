import { Link, useLocation, useSearchParams } from 'react-router'
import { CurrentLink } from '@/components/CurrentLink'
import { dietaryTagsText, formatPrice, productMedia } from '@restaurant-platform/shared'
import { MediaThumb } from '@/features/MediaCarousel'
import { useMenuDesign } from '@/features/menu-design'
import { matchesSearch } from '@/features/menu'
import type { Menu, Product } from '@/features/menu'
import { menuPath, parseMenuFilters, productPath } from '@/features/table-paths'

type MenuBrowseProps = {
  token: string
  menu: Menu
}

export function MenuBrowse({ token, menu }: MenuBrowseProps) {
  const { copy } = useMenuDesign()
  const { search: locationSearch } = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const { category, search } = parseMenuFilters(searchParams)
  // Secciones a mostrar: la categoría elegida (o todas) con los platos que coinciden
  // con la búsqueda. Una sección sin platos no se muestra.
  const sections = menu.categories
    .filter((entry) => category === 'all' || entry.id === category)
    .map((entry) => ({ ...entry, products: entry.products.filter((product) => matchesSearch(product, search)) }))
    .filter((entry) => entry.products.length > 0)

  return (
    <>
      <div className="menu-heading">
        <div>
          <p className="eyebrow">{copy.menu}</p>
          <h2>{copy.menuTitle}</h2>
        </div>
        <label className="sr-only" htmlFor="search">
          Buscar platos
        </label>
        <input
          id="search"
          type="search"
          placeholder="Buscar…"
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

      {/* Enlaces que llevan a otra vista de la carta: es navegación, y con `nav` el
          nombre «Categorías» se anuncia (en un div sin rol el aria-label se ignora). */}
      <nav className="categories" aria-label="Categorías">
        <CurrentLink to={menuPath(token, 'all', search)} current={category === 'all'}>
          Todo
        </CurrentLink>
        {menu.categories.map((entry) => (
          <CurrentLink
            key={entry.id}
            to={menuPath(token, entry.id, search)}
            current={category === entry.id}
          >
            {entry.name}
          </CurrentLink>
        ))}
      </nav>

      {sections.map((entry) => (
        <section key={entry.id}>
          <h3 className="section-title">{entry.name}</h3>
          <div className="product-grid">
            {entry.products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                to={productPath(token, product.id, locationSearch)}
              />
            ))}
          </div>
        </section>
      ))}

      {sections.length === 0 && (
        <p className="empty">No hay platos para mostrar. Probá otra búsqueda o categoría.</p>
      )}
    </>
  )
}

function ProductCard({ product, to }: { product: Product; to: string }) {
  // La tarjeta es un contenedor, no un enlace: el <Link> del nombre se estira a toda
  // la tarjeta por CSS (.product-card-link::after), foto incluida, y no hay otro control
  // adentro con el que pueda chocar. Todo plato se puede abrir, aunque esté agotado o
  // la mesa no admita pedir: leerlo no cuesta nada, y el detalle dice por qué no se
  // puede agregar.
  return (
    <article className="product-card">
      <div className="product-card-body">
        <h4>
          <Link className="product-card-link" to={to}>{product.name}</Link>
        </h4>
        <p>{product.description}</p>
        {product.dietary_tags.length > 0 && <small>{dietaryTagsText(product.dietary_tags)}</small>}
        <strong>{formatPrice(product.base_price)}</strong>
        {!product.is_available && <span className="unavailable">Agotado</span>}
      </div>
      <MediaThumb media={productMedia(product)} />
    </article>
  )
}
