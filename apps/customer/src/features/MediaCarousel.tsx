import { useState } from 'react'
import { mediaElementSrc, type ProductMedia } from '@restaurant-platform/shared'

/** El control nombra lo que va a mostrar: no todo lo que hay es una foto. */
function mediaNoun(item: ProductMedia) {
  return item.kind === 'video' ? 'video' : 'foto'
}

/**
 * La miniatura de la tarjeta de la carta: el primer medio y nada más. La tarjeta
 * entera es el link al plato, así que acá no hay controles que tocar (un dedo que
 * buscara la flecha abriría el plato); las fotos se recorren en la portada.
 * Es decorativa: el nombre del plato ya está en el link.
 */
export function MediaThumb({ media }: { media: ProductMedia[] }) {
  const first = media[0]
  if (!first) return null

  return (
    <div className="media-carousel card">
      {first.kind === 'image' ? (
        <img src={mediaElementSrc(first)} alt="" loading="lazy" />
      ) : (
        <div className="video-wrapper">
          <video src={mediaElementSrc(first)} preload="metadata" muted playsInline />
          <div className="play-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          </div>
        </div>
      )}
    </div>
  )
}

/** La portada del plato: todas sus fotos y videos, con flechas y puntos para recorrerlos. */
export function MediaCarousel({ media, alt }: { media: ProductMedia[]; alt: string }) {
  const [index, setIndex] = useState(0)
  if (media.length === 0) return null

  const current = media[index]
  const hasMany = media.length > 1

  const at = (delta: number) => (index + delta + media.length) % media.length
  const step = (delta: number) => () => setIndex(at(delta))

  return (
    <div className="media-carousel hero">
      {current.kind === 'image' ? (
        <img src={mediaElementSrc(current)} alt={alt} />
      ) : (
        <video src={mediaElementSrc(current)} controls preload="metadata" playsInline />
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
