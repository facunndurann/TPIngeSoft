/**
 * El formulario del nombre vive en el panel de la mesa, arriba de cualquier
 * pantalla. Desde el carrito se lleva el foco hasta ahí en lugar de repetir el
 * campo, así hay un solo lugar donde el comensal se nombra.
 */
export const NAME_FIELD_ID = 'name'

export function focusNameField() {
  const field = document.getElementById(NAME_FIELD_ID)
  if (!field) return
  field.scrollIntoView({ behavior: 'smooth', block: 'center' })
  field.focus({ preventScroll: true })
}
