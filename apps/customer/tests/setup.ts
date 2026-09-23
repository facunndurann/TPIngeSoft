/**
 * Entorno mínimo de browser para las pruebas del comensal. Corre como
 * `setupFiles`, antes de que cada archivo importe nada: el store del carrito
 * persiste en localStorage apenas se crea, así que tiene que existir de antes.
 * Las pruebas que declaran `@vitest-environment happy-dom` ya traen `window` y
 * `localStorage` de verdad, y pisarlos rompería el DOM que renderizan.
 */
if (typeof document === 'undefined') {
  const memory = new Map<string, string>()

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, value) },
      removeItem: (key: string) => { memory.delete(key) },
    },
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: globalThis.localStorage },
  })
}
