import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { AlertCircle, CheckCircle2, X } from 'lucide-react'

/** Cuánto queda a la vista un aviso sin el puntero encima. */
export const TOAST_MS = 5000

/** Un error se queda más: hay que leerlo, y a veces hacer algo distinto. */
export const ERROR_TOAST_MS = 8000

export type ToastTone = 'success' | 'error'

type Toast = { id: number; message: string; tone: ToastTone }

type ShowToast = (message: string, options?: { tone?: ToastTone }) => void

const ToastContext = createContext<ShowToast>(() => {})

/**
 * Avisa algo sin mover la pantalla: `toast('Guardamos el grupo «Extras».')`, o
 * `toast('No pudimos guardar el cambio.', { tone: 'error' })`.
 */
export function useToast() {
  return useContext(ToastContext)
}

/**
 * Avisos flotantes, como las notificaciones del celular: aparecen arriba al
 * centro, encima de la página, sin correr nada de lugar. Sirven para confirmar
 * lo que salió bien sin dejar otra señal en pantalla (un modal que se cierra, un
 * formulario que vuelve a la lista) y para errores que no son de un campo, como
 * un cambio del plano que no se pudo guardar.
 *
 * Un aviso a la vez; uno nuevo reemplaza al anterior y reinicia la cuenta. Va
 * dentro de una región siempre montada, así el lector de pantalla lo anuncia sin
 * mover el foco: `status` para lo que salió bien, `alert` para los errores. Se
 * va solo, salvo mientras el puntero está encima (WCAG 2.2.1); un error también
 * se cierra con su ×.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null)
  const [hovered, setHovered] = useState(false)

  const show = useCallback<ShowToast>((message, options) => {
    setToast((current) => ({ id: (current?.id ?? 0) + 1, message, tone: options?.tone ?? 'success' }))
    // El aviso anterior se fue sin `mouseleave`: el nuevo arranca su cuenta.
    setHovered(false)
  }, [])

  useEffect(() => {
    if (!toast || hovered) return
    const timer = setTimeout(() => setToast(null), toast.tone === 'error' ? ERROR_TOAST_MS : TOAST_MS)
    return () => clearTimeout(timer)
  }, [toast, hovered])

  const card = (tone: ToastTone) =>
    toast?.tone === tone && (
      <p
        key={toast.id}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="pointer-events-auto flex max-w-md items-center gap-2.5 rounded-2xl bg-neutral-900 py-3 pr-3 pl-4 text-sm text-white shadow-lg motion-safe:animate-toast-in"
      >
        {tone === 'error' ? (
          <AlertCircle size={18} className="shrink-0 text-red-400" aria-hidden="true" />
        ) : (
          <CheckCircle2 size={18} className="shrink-0 text-green-400" aria-hidden="true" />
        )}
        <span className="min-w-0 flex-1">{toast.message}</span>
        {tone === 'error' && (
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Cerrar aviso"
            title="Cerrar aviso"
            className="-my-1 inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </p>
    )

  return (
    <ToastContext value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center px-4">
        <div role="status">{card('success')}</div>
        <div role="alert">{card('error')}</div>
      </div>
    </ToastContext>
  )
}
