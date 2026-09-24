import { ImageOff, Play } from 'lucide-react'
import { mediaElementSrc, type ProductMedia } from '@restaurant-platform/shared'

/** Miniatura cuadrada de una foto o video de producto. Sin `media` muestra un placeholder. */
export function MediaThumb({
  media,
  alt,
  className,
}: {
  media: ProductMedia | undefined
  alt: string
  /** Tamaño de la miniatura, p. ej. `h-14 w-14`. */
  className: string
}) {
  const base = `${className} shrink-0 rounded-lg object-cover`

  if (!media) {
    return (
      <div className={`${base} flex items-center justify-center bg-neutral-100 text-faint`}>
        <ImageOff size={18} aria-hidden="true" />
      </div>
    )
  }

  if (media.kind === 'video') {
    // Una miniatura no reproduce: el primer cuadro alcanza para reconocer el
    // producto, igual que en la carta (MediaCarousel). Sin autoplay no hay
    // movimiento que pausar ni que frenar con prefers-reduced-motion, y la lista
    // no descarga cada video entero. El ▶ dice que es un video aunque esté quieto.
    return (
      <div role="img" aria-label={`${alt} (video)`} className={`${base} relative overflow-hidden bg-black`}>
        <video
          src={mediaElementSrc(media)}
          preload="metadata"
          muted
          playsInline
          className="h-full w-full object-cover"
        />
        <span className="absolute right-1 bottom-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-white">
          <Play size={9} fill="currentColor" aria-hidden="true" />
        </span>
      </div>
    )
  }

  return <img src={mediaElementSrc(media)} alt={alt} className={base} />
}
