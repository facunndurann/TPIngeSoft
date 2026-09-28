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

/**
 * Un campo del editor que puede tener un error: los fijos, cada opción por la
 * `key` de su fila, y `options` para la lista vacía (se marca en «Agregar opción»).
 */
export type GroupField =
  'name' | 'minSelect' | 'maxSelect' | 'options' | `option-name-${string}` | `option-price-${string}`

export type GroupError = { field: GroupField; message: string }

/** El borrador listo para guardar, o todo lo que lo impide. */
export type ParsedGroup = { ok: true; payload: ModifierGroupPayload } | { ok: false; errors: GroupError[] }

/**
 * Valida y convierte el borrador en una sola pasada: lo que se revisa es lo mismo
 * que se guarda, así que no hay un segundo chequeo que pueda discrepar con el
 * primero. Junta todos los problemas, en el orden del formulario y con su campo,
 * como `parseProductDraft`: cada error se muestra debajo de lo que hay que
 * corregir y el foco va al primero. Las `key` de las filas no llegan al payload:
 * solo sirven para dibujar la lista. La base revalida igual.
 */
export function parseGroupDraft(draft: ModifierGroupDraft): ParsedGroup {
  const errors: GroupError[] = []
  if (!draft.name.trim()) errors.push({ field: 'name', message: 'El grupo necesita un nombre.' })

  // Como la base lo acepta: mínimo desde 0, máximo desde 1, y nunca al revés.
  const min = wholeNumber(draft.minSelect)
  const max = wholeNumber(draft.maxSelect)
  if (min === null || min < 0) errors.push({ field: 'minSelect', message: 'Tiene que ser un número entero desde 0.' })
  if (max === null || max < 1) errors.push({ field: 'maxSelect', message: 'Tiene que ser un número entero desde 1.' })
  if (min !== null && max !== null && min >= 0 && max >= 1 && min > max) {
    errors.push({ field: 'minSelect', message: 'El mínimo no puede superar al máximo.' })
  }

  const options: ModifierGroupPayload['options'] = []
  for (const option of draft.options) {
    if (!option.name.trim()) {
      errors.push({ field: `option-name-${option.key}`, message: 'Escribí el nombre de la opción o quitala.' })
    }
    const price = parseAmount(option.price)
    if (price === null) {
      errors.push({
        field: `option-price-${option.key}`,
        message: 'Ingresá un precio de 0 o más, con hasta dos decimales.',
      })
    } else {
      options.push({ id: option.id, name: option.name, price_delta: price, is_available: option.isAvailable })
    }
  }
  if (draft.options.length === 0) errors.push({ field: 'options', message: 'Agregá al menos una opción.' })

  // `min` y `max` ya dejaron su error si faltaban; se miran de nuevo para que el payload los tenga como número.
  if (min === null || max === null || errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    payload: { name: draft.name, minSelect: min, maxSelect: max, isAvailable: draft.isAvailable, options },
  }
}
