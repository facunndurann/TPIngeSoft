import { useId, useLayoutEffect, useRef } from 'react'
import type { ButtonHTMLAttributes, ComponentProps, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { X } from 'lucide-react'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'

const buttonStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-white hover:bg-primary-hover disabled:bg-primary/40',
  secondary:
    'border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50 disabled:text-neutral-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
  ghost: 'text-muted hover:bg-neutral-100 disabled:text-neutral-300',
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      className={`inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${buttonStyles[variant]} ${className}`}
      {...props}
    />
  )
}

export function Input({ className = '', ref, ...props }: ComponentProps<'input'>) {
  return (
    <input
      ref={ref}
      className={`w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-faint focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary ${className}`}
      {...props}
    />
  )
}

export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-faint focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary ${className}`}
      {...props}
    />
  )
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary ${className}`}
      {...props}
    />
  )
}

export function Field({ label, children, error }: { label: string; children: ReactNode; error?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-neutral-700">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  hideLabel = false,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  /**
   * Qué prende o apaga. Es obligatorio: sin nombre, un lector de pantalla
   * anuncia «interruptor, activado» y no dice de qué.
   */
  label: string
  /**
   * Oculta el texto a la vista y lo deja para lectores de pantalla. Es para las
   * filas de una lista, donde el contexto se ve pero el switch igual tiene que
   * nombrarlo: «Disponible: Clásica».
   */
  hideLabel?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="inline-flex cursor-pointer items-center gap-2"
    >
      <span
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${checked ? 'bg-primary' : 'bg-neutral-300'}`}
      >
        <span
          className={`h-4 w-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`}
        />
      </span>
      <span className={hideLabel ? 'sr-only' : 'text-sm text-neutral-700'}>{label}</span>
    </button>
  )
}

export function Badge({
  children,
  color = 'neutral',
  className = '',
}: {
  children: ReactNode
  color?: 'neutral' | 'green' | 'red' | 'indigo' | 'amber'
  className?: string
}) {
  const colors = {
    neutral: 'bg-neutral-100 text-neutral-700',
    green: 'bg-green-100 text-green-800',
    red: 'bg-red-100 text-red-700',
    indigo: 'bg-indigo-100 text-indigo-700',
    amber: 'bg-amber-100 text-amber-800',
  }
  return (
    <span className={`inline-flex items-center justify-center text-center rounded-xl px-2 py-1 text-[11px] leading-tight font-medium ${colors[color]} ${className}`}>
      {children}
    </span>
  )
}

/** Primer campo de un formulario: donde conviene arrancar a escribir al abrir. */
const FIRST_FIELD =
  'input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled)'

const DISCARD_CHANGES = 'Hay cambios sin guardar. ¿Querés descartarlos?'

/**
 * Diálogo modal sobre un `<dialog>` nativo abierto con `showModal()`: el
 * navegador pone el rol de diálogo, deja inerte la página de atrás (el Tab no se
 * escapa) y lo dibuja en la capa superior. Está abierto mientras está montado;
 * cerrarlo es decisión de quien lo monta, así que el fondo, Escape y la × no lo
 * cierran por su cuenta: piden `onClose`.
 */
export function Modal({
  title,
  onClose,
  children,
  wide = false,
  hasUnsavedChanges = false,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
  /**
   * Cerrarlo sin pasar por el formulario (fondo, Escape o ×) pide confirmación.
   * El «Cancelar» de cada formulario sigue cerrando directo: ahí la intención ya
   * es descartar.
   */
  hasUnsavedChanges?: boolean
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  function requestClose() {
    if (hasUnsavedChanges && !window.confirm(DISCARD_CHANGES)) return
    onClose()
  }

  // Layout y no un efecto común: se abre antes de pintar, sin un cuadro de
  // diálogo cerrado visible por un instante.
  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    // Quien lo abrió recupera el foco al cerrar. Se guarda a mano porque el
    // diálogo sale del DOM al desmontarse, y ahí el navegador ya no lo devuelve.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.showModal()
    // Sin campos (un QR, una vista previa), queda el foco que eligió el navegador.
    dialog.querySelector<HTMLElement>(FIRST_FIELD)?.focus()
    return () => {
      if (dialog.open) dialog.close()
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className={`mx-auto mt-4 mb-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-xl bg-white p-0 shadow-xl backdrop:bg-black/40 sm:mt-8 sm:max-h-[calc(100dvh-4rem)] ${wide ? 'max-w-2xl' : 'max-w-md'}`}
      // Escape: se cancela el cierre nativo y decide `requestClose`.
      onCancel={(event) => {
        event.preventDefault()
        requestClose()
      }}
      // Chrome cierra sin `cancel` ante un segundo Escape seguido. Si pasa con el
      // diálogo montado, se pregunta igual; si se sigue editando, se reabre.
      // El evento llega en otra tarea, así que también llega el de los `close()`
      // propios: al desmontarse (el ref ya es null) y en el doble montaje de
      // StrictMode (el diálogo ya se reabrió). Solo cuenta si sigue cerrado.
      onClose={() => {
        const dialog = dialogRef.current
        if (!dialog || dialog.open) return
        if (hasUnsavedChanges && !window.confirm(DISCARD_CHANGES)) dialog.showModal()
        else onClose()
      }}
      // El fondo es el propio <dialog>: se mira si el clic cayó fuera de su caja,
      // así arrastrar su barra de scroll o seleccionar texto no lo cierra.
      onMouseDown={(event) => {
        const box = event.currentTarget.getBoundingClientRect()
        const outside =
          event.clientX < box.left || event.clientX > box.right ||
          event.clientY < box.top || event.clientY > box.bottom
        if (event.target === event.currentTarget && outside) requestClose()
      }}
    >
      <div className="p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-lg font-semibold text-neutral-900">{title}</h2>
          <button
            type="button"
            onClick={requestClose}
            className="cursor-pointer rounded-lg p-1 text-faint hover:bg-neutral-100 hover:text-neutral-600"
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  )
}

export function Spinner() {
  return (
    <div className="flex justify-center p-10">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-neutral-300 border-t-primary" />
    </div>
  )
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-10 text-center text-sm text-muted">
      {message}
    </div>
  )
}
