import { productMedia } from '@restaurant-platform/shared'
import type { ProductMedia } from '@restaurant-platform/shared'
import { supabase } from '@/lib/supabase'

const BUCKET = 'product-images'

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

type Upload = { url: string; path?: string }

/**
 * Sube en paralelo los archivos nuevos y devuelve las URLs finales en el orden de la
 * lista. Si alguna subida falla, borra las que sí terminaron antes de propagar el error.
 * `discardUploads` permite deshacer las subidas si después falla el guardado del producto.
 */
export async function uploadMediaDrafts(
  restaurantId: string,
  drafts: MediaDraft[],
): Promise<{ urls: string[]; discardUploads: () => Promise<void> }> {
  const storage = supabase.storage.from(BUCKET)

  const results = await Promise.allSettled(drafts.map(async (draft): Promise<Upload> => {
    if (draft.type === 'saved') return { url: draft.media.url }
    const extension = draft.file.name.split('.').pop() ?? 'jpg'
    const path = `${restaurantId}/${crypto.randomUUID()}.${extension}`
    const { error } = await storage.upload(path, draft.file)
    if (error) throw error
    return { url: storage.getPublicUrl(path).data.publicUrl, path }
  }))

  const uploads = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
  const paths = uploads.flatMap((upload) => (upload.path ? [upload.path] : []))

  // Limpieza de mejor esfuerzo: si falla, no debe tapar el error original.
  const discardUploads = async () => {
    if (paths.length) await storage.remove(paths).catch(() => undefined)
  }

  const failure = results.find((result) => result.status === 'rejected')
  if (failure) {
    await discardUploads()
    throw failure.reason
  }
  return { urls: uploads.map((upload) => upload.url), discardUploads }
}
