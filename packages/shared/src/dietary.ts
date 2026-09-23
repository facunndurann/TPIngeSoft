/**
 * Etiquetas dietarias que el restaurante puede marcarle a un plato. La base guarda el
 * `value` (`products.dietary_tags`, un text[] libre) y las dos apps muestran el `label`:
 * el panel las ofrece como opciones y la carta las muestra con su nombre, no con la clave.
 */
export const DIETARY_TAGS = [
  { value: 'vegetariano', label: 'Vegetariano' },
  { value: 'vegano', label: 'Vegano' },
  { value: 'sin-tacc', label: 'Sin TACC' },
  { value: 'picante', label: 'Picante' },
] as const

export type DietaryTag = (typeof DIETARY_TAGS)[number]['value']

/**
 * El nombre de una etiqueta para quien la lee. La columna acepta cualquier texto: lo que
 * no está en el catálogo (cargado a mano o de una versión anterior) se muestra tal cual,
 * que es mejor que esconderle al comensal una advertencia sobre lo que va a comer.
 */
export function dietaryTagLabel(tag: string): string {
  return DIETARY_TAGS.find((entry) => entry.value === tag)?.label ?? tag
}

/** Las etiquetas de un plato en una línea: «Vegano · Sin TACC». */
export function dietaryTagsText(tags: readonly string[]): string {
  return tags.map(dietaryTagLabel).join(' · ')
}
