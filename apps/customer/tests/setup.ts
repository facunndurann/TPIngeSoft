/**
 * Entorno mínimo de browser para las pruebas del comensal. Corre como
 * `setupFiles`, antes de que cada archivo importe nada: el store del carrito
 * persiste en localStorage apenas se crea, así que tiene que existir de antes.
 */
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
