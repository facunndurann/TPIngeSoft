import { useState } from 'react'
import { mediaElementSrc, type ProductMedia } from '@restaurant-platform/shared'

type MediaCarouselProps = {
  media: ProductMedia[]
  /** `card`: miniatura dentro de la tarjeta del menú. `hero`: portada del detalle del producto. */
  variant: 'card' | 'hero'
  alt: string
}

/** El control nombra lo que va a mostrar: no todo lo que hay es una foto. */
function mediaNoun(item: ProductMedia) {
  return item.kind === 'video' ? 'video' : 'foto'
}

export function MediaCarousel({ media, variant, alt }: MediaCarouselProps) {
  const [index, setIndex] = useState(0)
  if (media.length === 0) return null

  const current = media[index]
  const hasMany = media.length > 1

  const at = (delta: number) => (index + delta + media.length) % media.length
  const step = (delta: number) => () => setIndex(at(delta))

  return (
    <div className={`media-carousel ${variant}`}>
      {current.kind === 'image' ? (
        <img
          src={mediaElementSrc(current)}
          alt={variant === 'hero' ? alt : ''}
          loading={variant === 'card' ? 'lazy' : undefined}
        />
      ) : variant === 'hero' ? (
        <video src={mediaElementSrc(current)} controls preload="metadata" playsInline />
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
          <button
            type="button"
            className="carousel-btn prev"
            aria-label={`Ver ${mediaNoun(media[at(-1)])} anterior`}
            onClick={step(-1)}
          >
            ‹
          </button>
          <button
            type="button"
            className="carousel-btn next"
            aria-label={`Ver ${mediaNoun(media[at(1)])} siguiente`}
            onClick={step(1)}
          >
            ›
          </button>
          {/* Los puntos cuentan cuántos hay, así que también llevan a cada uno. */}
          <div className="carousel-dots">
            {media.map((item, i) => (
              <button
                key={item.url}
                type="button"
                className={`dot ${i === index ? 'active' : ''}`}
                aria-label={`Ver ${mediaNoun(item)} ${i + 1} de ${media.length}`}
                aria-pressed={i === index}
                onClick={() => setIndex(i)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
