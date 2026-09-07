import { useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
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

function ProductMediaCarousel({ urls }: { urls: string[] }) {
  const [index, setIndex] = useState(0)
  if (!urls.length) return null

  const url = urls[index]
  const isVideo = url.match(/\.(mp4|webm|ogg|mov)$/i)

  return (
    <div className="media-carousel" onClick={(e) => urls.length > 1 && e.preventDefault()}>
      {isVideo ? (
        <div className="video-wrapper">
          <video src={url + '#t=0.001'} preload="metadata" muted playsInline />
          <div className="play-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          </div>
        </div>
      ) : (
        <img src={url} alt="" loading="lazy" />
      )}
      
      {urls.length > 1 && (
        <>
          <button 
            type="button"
            className="carousel-btn prev"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setIndex((i) => (i === 0 ? urls.length - 1 : i - 1))
            }}
          >
            ‹
          </button>
          <button 
            type="button"
            className="carousel-btn next"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setIndex((i) => (i === urls.length - 1 ? 0 : i + 1))
            }}
          >
            ›
          </button>
          <div className="carousel-dots">
            {urls.map((_, i) => (
              <span key={i} className={`dot ${i === index ? 'active' : ''}`} />
            ))}
          </div>
        </>
      )}
    </div>
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
      {product.photo_url && (
        <ProductMediaCarousel urls={product.photo_url.split(',')} />
      )}
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
