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

/** El borrador listo para guardar, o el primer problema que lo impide. */
export type ParsedGroup = { ok: true; payload: ModifierGroupPayload } | { ok: false; error: string }

/**
 * Valida y convierte el borrador en una sola pasada: lo que se revisa es lo mismo
 * que se guarda, así que no hay un segundo chequeo que pueda discrepar con el
 * primero. Los problemas se nombran de a uno, en el orden del formulario, y las
 * `key` de las filas quedan afuera: solo sirven para dibujar la lista. La base
 * revalida igual.
 */
export function parseGroupDraft(draft: ModifierGroupDraft): ParsedGroup {
  const fail = (error: string): ParsedGroup => ({ ok: false, error })

  if (!draft.name.trim()) return fail('El grupo necesita un nombre')
  if (draft.options.some((option) => !option.name.trim())) return fail('Todas las opciones necesitan nombre')

  // Como la base lo acepta: mínimo desde 0, máximo desde 1, y nunca al revés.
  const min = wholeNumber(draft.minSelect)
  const max = wholeNumber(draft.maxSelect)
  if (min === null || max === null || min < 0 || max < 1) {
    return fail('El mínimo tiene que ser un entero desde 0, y el máximo desde 1')
  }
  if (min > max) return fail('El mínimo no puede superar al máximo')
  if (draft.options.length === 0) return fail('Agregá al menos una opción')

  const options: ModifierGroupPayload['options'] = []
  for (const option of draft.options) {
    const price = parseAmount(option.price)
    if (price === null) return fail('Cada opción necesita un precio de 0 o más, con hasta dos decimales')
    options.push({ id: option.id, name: option.name, price_delta: price, is_available: option.isAvailable })
  }

  return {
    ok: true,
    payload: { name: draft.name, minSelect: min, maxSelect: max, isAvailable: draft.isAvailable, options },
  }
}
