import { ImageOff } from 'lucide-react'
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
      <div className={`${base} flex items-center justify-center bg-neutral-100 text-neutral-400`}>
        <ImageOff size={18} />
      </div>
    )
  }

  if (media.kind === 'video') {
    return <video src={mediaElementSrc(media)} className={`${base} bg-black`} autoPlay muted loop playsInline />
  }

  return <img src={mediaElementSrc(media)} alt={alt} className={base} />
}
