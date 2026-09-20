import { type ProductMedia, productMedia } from '@restaurant-platform/shared'

// Sin imports con efectos: product-draft.ts y sus tests no tienen que levantar
// un cliente de Supabase para modelar el formulario. La subida vive en
// queries/products.ts, junto a saveProduct, que es quien la usa.

/**
 * Un elemento de la lista de fotos/videos mientras se edita el producto: uno ya
 * guardado (URL pública) o un archivo elegido que todavía no se subió. El orden
 * de la lista es el orden en que se guardan.
 */
export type MediaDraft =
  | { type: 'saved'; key: string; media: ProductMedia }
  | { type: 'new'; key: string; file: File }

export function savedMediaDrafts(product: { media_urls: readonly string[] }): MediaDraft[] {
  return productMedia(product).map((media) => ({ type: 'saved', key: media.url, media }))
}

export function newMediaDraft(file: File): MediaDraft {
  return { type: 'new', key: crypto.randomUUID(), file }
}
