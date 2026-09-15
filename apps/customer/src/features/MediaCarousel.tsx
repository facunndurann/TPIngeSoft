import { useState, type MouseEvent } from 'react'
import { mediaElementSrc, type ProductMedia } from '@restaurant-platform/shared'

type MediaCarouselProps = {
  media: ProductMedia[]
  /** `card`: miniatura dentro de la tarjeta del menú. `hero`: portada del detalle del producto. */
  variant: 'card' | 'hero'
  alt: string
}

export function MediaCarousel({ media, variant, alt }: MediaCarouselProps) {
  const [index, setIndex] = useState(0)
  if (media.length === 0) return null

  const current = media[index]
  const hasMany = media.length > 1

  // La tarjeta vive dentro de un <Link>: las flechas no deben navegar al producto.
  const step = (delta: number) => (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setIndex((i) => (i + delta + media.length) % media.length)
  }

  return (
    <div
      className={`media-carousel ${variant}`}
      onClick={(event) => {
        if (variant === 'card' && hasMany) event.preventDefault()
      }}
    >
      {current.kind === 'image' ? (
        <img
          className={variant === 'hero' ? 'hero-photo' : undefined}
          src={mediaElementSrc(current)}
          alt={variant === 'hero' ? alt : ''}
          loading={variant === 'card' ? 'lazy' : undefined}
        />
      ) : variant === 'hero' ? (
        <video className="hero-photo" src={mediaElementSrc(current)} controls preload="metadata" playsInline />
      ) : (
        <div className="video-wrapper">
          <video src={mediaElementSrc(current)} preload="metadata" muted playsInline />
          <div className="play-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          </div>
        </div>
      )}

      {hasMany && (
        <>
          <button type="button" className="carousel-btn prev" aria-label="Anterior" onClick={step(-1)}>
            ‹
          </button>
          <button type="button" className="carousel-btn next" aria-label="Siguiente" onClick={step(1)}>
            ›
          </button>
          <div className="carousel-dots">
            {media.map((item, i) => (
              <span key={item.url} className={`dot ${i === index ? 'active' : ''}`} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
