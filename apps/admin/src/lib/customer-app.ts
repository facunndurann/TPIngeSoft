const CUSTOMER_APP_URL: string =
  import.meta.env.VITE_CUSTOMER_APP_URL ?? 'http://localhost:5173'

/** URL absoluta de una ruta de la app del comensal (QR de mesas, vista previa de diseños). */
export function customerAppUrl(path: string): string {
  return `${CUSTOMER_APP_URL}${path}`
}
