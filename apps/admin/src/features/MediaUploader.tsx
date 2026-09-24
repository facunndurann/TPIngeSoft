import { useLayoutEffect, useState } from 'react'
import { Trash2, Upload } from 'lucide-react'
import {
  PRODUCT_MEDIA_LIMIT,
  PRODUCT_MEDIA_MAX_BYTES,
  mediaKindFromMimeType,
} from '@restaurant-platform/shared'
import { MediaThumb } from '@/features/MediaThumb'
import { newMediaDraft, type MediaDraft } from '@/features/product-media'

type MediaUploaderProps = {
  value: MediaDraft[]
  onChange: (next: MediaDraft[]) => void
  /** Mensaje de validación para mostrar junto al formulario (null lo limpia). */
  onError: (message: string | null) => void
}

/** Cómo se nombra cada archivo de la lista: «foto 1», «video 2». */
function mediaName(draft: MediaDraft, index: number) {
  const kind = draft.type === 'saved' ? draft.media.kind : mediaKindFromMimeType(draft.file.type)
  return `${kind === 'video' ? 'video' : 'foto'} ${index + 1}`
}

/** Editor de fotos/videos de un producto: agrega, quita y previsualiza, sin subir nada. */
export function MediaUploader({ value, onChange, onError }: MediaUploaderProps) {
  function addFiles(files: File[]) {
    const filesToAdd = files.slice(0, PRODUCT_MEDIA_LIMIT - value.length)
    if (filesToAdd.some((file) => file.size > PRODUCT_MEDIA_MAX_BYTES)) {
      const maxMb = PRODUCT_MEDIA_MAX_BYTES / 1024 / 1024
      onError(`Un archivo es muy pesado. El límite es ${maxMb} MB para garantizar que la carta cargue rápido.`)
      return
    }
    onError(null)
    onChange([...value, ...filesToAdd.map(newMediaDraft)])
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      {value.map((draft, index) => {
        const name = mediaName(draft, index)
        return (
          <div key={draft.key} className="relative">
            {draft.type === 'saved' ? (
              <MediaThumb media={draft.media} alt={`Vista previa de la ${name}`} className="h-24 w-24" />
            ) : (
              <FilePreview file={draft.file} alt={`Vista previa de la ${name}`} />
            )}
            {/* Siempre visible: con teclado o en una tablet no hay hover que lo
                muestre. El botón mide 32 px para tocarlo; el círculo de adentro,
                24, para no tapar más foto que antes. */}
            <button
              type="button"
              onClick={() => onChange(value.filter((other) => other.key !== draft.key))}
              className="group absolute -top-3 -right-3 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
              aria-label={`Quitar ${name}`}
              title={`Quitar ${name}`}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-white shadow-sm ring-2 ring-white transition-colors group-hover:bg-red-700">
                <Trash2 size={12} aria-hidden="true" />
              </span>
            </button>
          </div>
        )
      })}

      {value.length < PRODUCT_MEDIA_LIMIT && (
        // El input queda enfocable (sr-only, no `hidden`): con `display: none` no
        // había forma de agregar una foto con el teclado. El recuadro muestra su foco.
        <label className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 text-muted hover:bg-neutral-100 has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-primary">
          <Upload size={20} aria-hidden="true" />
          <span className="text-xs font-medium">Subir</span>
          <input
            type="file"
            accept="image/*,video/*"
            multiple
            className="sr-only"
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []))
              // Permite volver a elegir el mismo archivo después de quitarlo.
              e.target.value = ''
            }}
          />
        </label>
      )}
    </div>
  )
}

/**
 * Vista previa de un archivo local. La blob URL vive exactamente lo que vive el
 * componente: se crea al montar (antes de pintar, sin parpadeo) y se libera al quitar
 * el archivo o salir de la página. Funciona con el doble montaje de StrictMode.
 */
function FilePreview({ file, alt }: { file: File; alt: string }) {
  const [url, setUrl] = useState<string>()

  useLayoutEffect(() => {
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])

  return (
    <MediaThumb
      media={url ? { url, kind: mediaKindFromMimeType(file.type) } : undefined}
      alt={alt}
      className="h-24 w-24"
    />
  )
}
