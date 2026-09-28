import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { CheckCircle2 } from 'lucide-react'

/** Cuánto queda a la vista un aviso sin el puntero encima. */
export const TOAST_MS = 5000

type Toast = { id: number; message: string }

const ToastContext = createContext<(message: string) => void>(() => {})

/** Avisa que algo salió bien: `toast('Guardamos el grupo «Extras».')`. */
export function useToast() {
  return useContext(ToastContext)
}

/**
 * La confirmación de lo que salió bien sin dejar otra señal en pantalla: un modal
 * que se cierra, un formulario que vuelve a la lista. Un aviso a la vez, abajo al
 * centro, dentro de una región `status` siempre montada: el lector de pantalla lo
 * anuncia sin mover el foco. Se va solo, salvo mientras el puntero está encima
 * (WCAG 2.2.1); un aviso nuevo reemplaza al anterior y reinicia la cuenta.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null)
  const [hovered, setHovered] = useState(false)

  const show = useCallback((message: string) => {
    setToast((current) => ({ id: (current?.id ?? 0) + 1, message }))
    // El aviso anterior se fue sin `mouseleave`: el nuevo arranca su cuenta.
    setHovered(false)
  }, [])

  useEffect(() => {
    if (!toast || hovered) return
    const timer = setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(timer)
  }, [toast, hovered])

  return (
    <ToastContext value={show}>
      {children}
      <div role="status" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
        {toast && (
          <p
            key={toast.id}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            className="pointer-events-auto flex max-w-md items-center gap-2 rounded-lg bg-neutral-900 px-4 py-3 text-sm text-white shadow-lg"
          >
            <CheckCircle2 size={16} className="shrink-0 text-green-400" aria-hidden="true" />
            {toast.message}
          </p>
        )}
      </div>
    </ToastContext>
  )
}
