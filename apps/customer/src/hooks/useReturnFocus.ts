import { useEffect, useRef } from 'react'

/**
 * El foco para el botón que abre un panel en su lugar (un formulario, una
 * confirmación): mientras el panel está abierto el botón no existe, y al
 * cerrarse vuelve a montarse sin foco, que cae al inicio de la página. Cuando
 * `open` pasa de `true` a `false`, el foco va al elemento del ref devuelto.
 *
 * Solo en ese cambio: al montar la pantalla, o si nunca se abrió, no mueve nada.
 */
export function useReturnFocus<T extends HTMLElement = HTMLButtonElement>(open: boolean) {
  const target = useRef<T>(null)
  const wasOpen = useRef(open)

  useEffect(() => {
    // Corre después del commit, con el botón ya montado y el ref asignado.
    if (wasOpen.current && !open) target.current?.focus()
    wasOpen.current = open
  }, [open])

  return target
}
