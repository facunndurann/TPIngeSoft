import { parseAmount, type Tables } from '@restaurant-platform/shared'

/**
 * Una opción mientras se edita. `key` identifica la fila en la lista (una opción
 * nueva todavía no tiene `id`); `price` es el texto del input, y `parseAmount`
 * decide si es un precio.
 */
export type OptionDraft = {
  key: string
  id?: string
  name: string
  price: string
  isAvailable: boolean
}

/**
 * El grupo mientras se edita: un solo objeto, montado ya con sus valores. Mínimo
 * y máximo son texto por lo mismo que el precio: un campo vacío no es un 0.
 */
export type ModifierGroupDraft = {
  name: string
  minSelect: string
  maxSelect: string
  isAvailable: boolean
  options: OptionDraft[]
}

/** Lo que recibe `save_modifier_group`: el grupo y su lista completa de opciones, en orden. */
export type ModifierGroupPayload = {
  name: string
  minSelect: number
  maxSelect: number
  isAvailable: boolean
  /** Sin `id` es una opción nueva; las que ya no están en la lista se borran. */
  options: { id?: string; name: string; price_delta: number; is_available: boolean }[]
}

type SavedGroup = Tables<'modifier_groups'> & {
  modifier_options: Tables<'modifier_options'>[]
}

export function emptyGroupDraft(): ModifierGroupDraft {
  return { name: '', minSelect: '0', maxSelect: '1', isAvailable: true, options: [] }
}

export function newOptionDraft(): OptionDraft {
  return { key: crypto.randomUUID(), name: '', price: '0', isAvailable: true }
}

export function groupDraftFrom(group: SavedGroup): ModifierGroupDraft {
  return {
    name: group.name,
    minSelect: String(group.min_select),
    maxSelect: String(group.max_select),
    isAvailable: group.is_available,
    options: [...group.modifier_options]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((option) => ({
        key: option.id,
        id: option.id,
        name: option.name,
        price: String(option.price_delta),
        isAvailable: option.is_available,
      })),
  }
}

function wholeNumber(text: string): number | null {
  const value = Number(text)
  return text.trim() !== '' && Number.isInteger(value) ? value : null
}

/** Cuántas opciones se eligen, como la base lo acepta (mínimo 0, máximo 1 o más), o `null`. */
function selectionRange(draft: ModifierGroupDraft): { min: number; max: number } | null {
  const min = wholeNumber(draft.minSelect)
  const max = wholeNumber(draft.maxSelect)
  return min !== null && max !== null && min >= 0 && max >= 1 ? { min, max } : null
}

/** Primer problema que impide guardar, o `null`. La base revalida igual. */
export function groupDraftErrors(draft: ModifierGroupDraft): string | null {
  if (!draft.name.trim()) return 'El grupo necesita un nombre'
  if (draft.options.some((option) => !option.name.trim())) return 'Todas las opciones necesitan nombre'
  const range = selectionRange(draft)
  if (!range) return 'El mínimo tiene que ser un entero desde 0, y el máximo desde 1'
  if (range.min > range.max) return 'El mínimo no puede superar al máximo'
  if (draft.options.length === 0) return 'Agregá al menos una opción'
  if (draft.options.some((option) => parseAmount(option.price) === null)) {
    return 'Cada opción necesita un precio de 0 o más, con hasta dos decimales'
  }
  return null
}

/**
 * El borrador ya convertido a lo que se guarda, o `null` si todavía no es válido.
 * Las `key` de las filas quedan afuera: solo sirven para dibujar la lista.
 */
export function groupPayload(draft: ModifierGroupDraft): ModifierGroupPayload | null {
  const range = selectionRange(draft)
  if (!range || groupDraftErrors(draft)) return null

  const options: ModifierGroupPayload['options'] = []
  for (const option of draft.options) {
    const price = parseAmount(option.price)
    if (price === null) return null
    options.push({ id: option.id, name: option.name, price_delta: price, is_available: option.isAvailable })
  }

  return {
    name: draft.name,
    minSelect: range.min,
    maxSelect: range.max,
    isAvailable: draft.isAvailable,
    options,
  }
}
