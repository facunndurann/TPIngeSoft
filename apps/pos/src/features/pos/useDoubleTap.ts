import { useRef } from 'react'

/** El tiempo entre dos toques sobre lo mismo para que cuenten como uno doble, como el doble clic. */
const DOUBLE_TAP_MS = 500

/**
 * Un toque doble, como el doble clic, sea con el mouse, el dedo o Enter. Devuelve
 * una función que se llama con lo que se tocó (`null` si fue el piso vacío) y
 * dice si ese toque es el segundo de dos seguidos sobre lo mismo; ahí la cuenta
 * vuelve a empezar, y un toque en otro lado también la corta.
 */
export function useDoubleTap() {
  const last = useRef<{ key: string; at: number } | null>(null)

  return (key: string | null) => {
    const at = performance.now()
    const previous = last.current
    const second = key !== null && previous?.key === key && at - previous.at < DOUBLE_TAP_MS
    last.current = key === null || second ? null : { key, at }
    return second
  }
}
