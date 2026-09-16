/** Máximo de fotos/videos por producto. Espejado en el check `products_media_urls_limit`. */
export const PRODUCT_MEDIA_LIMIT = 3

/** Tamaño máximo por archivo subido, para que la carta cargue rápido en el celular. */
export const PRODUCT_MEDIA_MAX_BYTES = 7 * 1024 * 1024

export type ProductMediaKind = 'image' | 'video'

export type ProductMedia = {
  url: string
  kind: ProductMediaKind
}

const VIDEO_EXTENSION = /\.(mp4|webm|ogg|mov)$/i

export function mediaKindFromUrl(url: string): ProductMediaKind {
  // Ignora query string y fragmento para que `video.mp4?v=2` siga siendo un video.
  const path = url.split(/[?#]/, 1)[0]
  return VIDEO_EXTENSION.test(path) ? 'video' : 'image'
}

export function mediaKindFromMimeType(mimeType: string): ProductMediaKind {
  return mimeType.startsWith('video/') ? 'video' : 'image'
}

export function productMedia(product: { media_urls: readonly string[] }): ProductMedia[] {
  return product.media_urls.map((url) => ({ url, kind: mediaKindFromUrl(url) }))
}

/**
 * `src` para el elemento `<img>`/`<video>`. En videos, `#t=0.001` fuerza a los
 * navegadores móviles (Safari en particular) a pintar el primer cuadro como
 * portada en lugar de dejar el reproductor en negro.
 */
export function mediaElementSrc(media: ProductMedia): string {
  return media.kind === 'video' ? `${media.url}#t=0.001` : media.url
}
