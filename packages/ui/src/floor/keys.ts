/**
 * Si una tecla es de otro y no del plano: de un campo donde se está escribiendo
 * o de un diálogo abierto encima. Ahí Espacio escribe un espacio y Borrar borra
 * una letra, no una mesa.
 */
export function keyBelongsElsewhere(target: EventTarget | null) {
  return (
    target instanceof Element &&
    !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), dialog')
  )
}
