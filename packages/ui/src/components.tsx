import { createContext, useContext, useId, useLayoutEffect, useRef } from 'react'
import type { ButtonHTMLAttributes, ComponentProps, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { Check, X } from 'lucide-react'

/**
 * Tamaño de los controles. `touch` es para pantallas que se usan con el dedo y
 * en movimiento, como el POS: 44px de alto, el mínimo de las guías táctiles.
 */
export type ControlSize = 'default' | 'touch'

const ControlSizeContext = createContext<ControlSize>('default')

/**
 * Tamaño de todos los controles de `ui` que envuelve: Button, IconButton, los
 * campos (Input, Select, Textarea) y ChoiceChip. Una app táctil lo pone una
 * vez en la raíz en lugar de pasar `size` a cada control; la prop `size` de
 * cada uno sigue ganando para un caso puntual.
 */
export function ControlSizeProvider({ size, children }: { size: ControlSize; children: ReactNode }) {
  return <ControlSizeContext value={size}>{children}</ControlSizeContext>
}

/**
 * El tamaño pedido, o el de la app si el control no dice nada. Se exporta para
 * los controles que no son de `ui`, como un `<Link>` con forma de botón.
 */
export function useControlSize(size?: ControlSize): ControlSize {
  const appSize = useContext(ControlSizeContext)
  return size ?? appSize
}

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'danger-ghost'

const buttonStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-white hover:bg-primary-hover disabled:bg-primary/40',
  secondary:
    'border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50 disabled:text-neutral-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
  ghost: 'text-muted hover:bg-neutral-100 disabled:text-neutral-300',
  // Una acción destructiva que no es la principal: se reconoce por el rojo, pero
  // no compite con el botón de avanzar. El rojo lleno queda para confirmarla.
  'danger-ghost': 'text-red-700 hover:bg-red-50 disabled:text-red-300',
}

// El padding horizontal va acá y no en la base: dos `px-*` en la misma clase
// no se pisan por orden de escritura sino por el orden del CSS.
const buttonSizes: Record<ControlSize, string> = {
  default: 'px-3 py-2',
  touch: 'min-h-11 px-4 py-2',
}

/**
 * La forma de un botón: `rounded` es la de todo el panel; `pill`, la de una
 * pantalla con otra estética, como el Salón. En un botón de solo ícono, `pill`
 * es un círculo. Va acá y no en `className` por lo mismo que el padding: dos
 * `rounded-*` no se pisan por orden de escritura.
 */
export type ButtonShape = 'rounded' | 'pill'

const buttonShapes: Record<ButtonShape, string> = {
  rounded: 'rounded-lg',
  pill: 'rounded-full',
}

/**
 * Clases de `Button`. Se exportan para una navegación que tiene que verse como
 * botón: un `<Link>` con estas clases, no un `<Button>` adentro de un `<Link>`,
 * que es un control dentro de otro y dos paradas de tabulación para lo mismo.
 */
export function buttonClass(
  variant: ButtonVariant = 'primary',
  size: ControlSize = 'default',
  shape: ButtonShape = 'rounded',
) {
  return `inline-flex cursor-pointer items-center justify-center gap-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${buttonShapes[shape]} ${buttonSizes[size]} ${buttonStyles[variant]}`
}

export function Button({
  variant = 'primary',
  size,
  shape,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ControlSize; shape?: ButtonShape }) {
  return <button className={`${buttonClass(variant, useControlSize(size), shape)} ${className}`} {...props} />
}

/**
 * Lo común a los campos de texto y de selección. Con error (`aria-invalid`) el
 * borde pasa a rojo además del mensaje, así el color no es la única señal. El
 * ancho completo sale de `field-control` (theme.css) y no de `w-full`, para que
 * un `className="w-56"` se aplique.
 */
const controlClass =
  'field-control rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-faint focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary aria-invalid:border-red-600 aria-invalid:ring-1 aria-invalid:ring-red-600'

/** Alto de los campos táctiles; el resto del tamaño es el mismo en los dos. */
const fieldSizes: Record<ControlSize, string> = {
  default: '',
  touch: 'min-h-11',
}

/**
 * Lo que un Field le avisa a su control: si tiene un error, y los ids de los
 * textos que lo describen (la pista y el error).
 */
const FieldContext = createContext<{ invalid: boolean; describedBy?: string } | null>(null)

/**
 * `aria-invalid` y `aria-describedby` del Field que envuelve al control. Van
 * antes de las props, así quien lo necesite puede pisarlas.
 */
function useFieldError() {
  const field = useContext(FieldContext)
  if (!field) return {}
  return {
    ...(field.invalid ? { 'aria-invalid': true as const } : {}),
    ...(field.describedBy ? { 'aria-describedby': field.describedBy } : {}),
  }
}

export function Input({ className = '', size, ref, ...props }: Omit<ComponentProps<'input'>, 'size'> & { size?: ControlSize }) {
  const sizeClass = fieldSizes[useControlSize(size)]
  return <input ref={ref} {...useFieldError()} className={`${controlClass} ${sizeClass} ${className}`} {...props} />
}

export function Textarea({ className = '', size, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { size?: ControlSize }) {
  const sizeClass = fieldSizes[useControlSize(size)]
  return <textarea {...useFieldError()} className={`${controlClass} ${sizeClass} ${className}`} {...props} />
}

export function Select({ className = '', size, ...props }: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & { size?: ControlSize }) {
  const sizeClass = fieldSizes[useControlSize(size)]
  return <select {...useFieldError()} className={`${controlClass} ${sizeClass} ${className}`} {...props} />
}

/**
 * Rótulo, control y, si hay, la pista y el error de ese control. Los dos van
 * fuera del `<label>` (adentro se sumarían al nombre del campo en vez de
 * describirlo) y se enlazan por contexto: el Input, Select o Textarea de adentro
 * queda descrito por ellos, y marcado como inválido si hay error, sin que cada
 * formulario lo repita.
 */
export function Field({
  label,
  hint,
  children,
  error,
}: {
  label: string
  /** La regla del campo, visible antes de equivocarse: «Mínimo 10 caracteres». */
  hint?: string
  children: ReactNode
  error?: string
}) {
  const hintId = useId()
  const errorId = useId()
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined

  return (
    <div>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-neutral-700">{label}</span>
        <FieldContext value={{ invalid: !!error, describedBy }}>{children}</FieldContext>
      </label>
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  hideLabel = false,
  busy = false,
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
  /**
   * Guardando el cambio anterior: el switch ya muestra el valor nuevo y no acepta
   * otro toque hasta que termine, así un doble toque no manda dos escrituras que
   * pueden llegar en cualquier orden. Es `aria-disabled` y no `disabled`, que le
   * sacaría el foco a quien lo está usando con el teclado.
   */
  busy?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-disabled={busy || undefined}
      onClick={() => {
        if (!busy) onChange(!checked)
      }}
      className={`inline-flex items-center gap-2 ${busy ? 'cursor-wait' : 'cursor-pointer'}`}
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

type IconTone = 'neutral' | 'danger'

/**
 * `ghost` es el ícono suelto, con fondo solo al pasar el mouse. `secondary` lo
 * enmarca como un botón secundario, para cuando va entre otros controles
 * enmarcados: los − y + de un número, el zoom de un plano.
 */
export type IconVariant = 'ghost' | 'secondary'

const iconVariants: Record<IconVariant, string> = {
  ghost: 'text-faint hover:bg-neutral-100',
  secondary: 'border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50',
}

type IconButtonLook = { tone?: IconTone; size?: ControlSize; shape?: ButtonShape; variant?: IconVariant }

/**
 * Clases de un control de solo ícono: 32×32 px, más que los 24 que pide WCAG 2.2
 * porque el panel también se usa con el dedo, y 44×44 con tamaño táctil. Suelto
 * (`ghost`), el ícono va en `faint` y el fondo que aparece al pasar el mouse
 * muestra el área que se puede tocar. Se exportan para el mismo control hecho
 * con un `<Link>`, o con un `type` que `IconButton` no deja elegir (un submit).
 */
export function iconButtonClass({
  tone = 'neutral',
  size = 'default',
  shape = 'rounded',
  variant = 'ghost',
}: IconButtonLook = {}) {
  return `inline-flex ${size === 'touch' ? 'h-11 w-11' : 'h-8 w-8'} shrink-0 cursor-pointer items-center justify-center ${buttonShapes[shape]} transition-colors disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent ${iconVariants[variant]} ${
    tone === 'danger' ? 'hover:text-red-600' : 'hover:text-neutral-700'
  }`
}

/**
 * Botón de solo ícono. `label` es obligatorio y dice sobre qué actúa («Eliminar
 * Clásica», no «Eliminar»): es lo único que oye un lector de pantalla, y también
 * aparece como tooltip.
 */
export function IconButton({
  label,
  tone,
  size,
  shape,
  variant,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'title' | 'type' | 'className'> & {
  label: string
} & IconButtonLook) {
  const className = iconButtonClass({ tone, size: useControlSize(size), shape, variant })
  return <button {...props} type="button" aria-label={label} title={label} className={className} />
}

type ChipTone = 'pill' | 'outline'

const chipTones: Record<ChipTone, { base: string; on: string; off: string }> = {
  // Filtros y etiquetas.
  pill: {
    base: 'rounded-full px-3 py-1',
    on: 'bg-primary text-white',
    off: 'bg-white text-muted ring-1 ring-inset ring-neutral-200 hover:bg-neutral-100',
  },
  // Opciones con más peso, como medios de pago o sectores.
  outline: {
    base: 'rounded-lg border px-2.5 py-1.5',
    on: 'border-primary bg-primary-soft text-primary-ink',
    off: 'border-neutral-200 bg-white text-muted hover:bg-neutral-50',
  },
}

/**
 * Una opción que se elige dentro de un grupo: un filtro, una etiqueta, un medio
 * de pago, un sector. Lo elegido no se dice solo con color: `aria-pressed` lo
 * anuncia y el ✓ lo muestra. Sirve igual para elegir una sola opción (el grupo
 * garantiza que haya una prendida) que para varias. Quien la usa envuelve las
 * opciones en un `role="group"` con nombre.
 *
 * No acepta `className`: dos clases del mismo tipo (dos tamaños de letra, dos
 * paddings) no se pisan por orden de escritura sino por el orden del CSS, así que
 * el estilo sale solo de `tone`.
 */
export function ChoiceChip({
  pressed,
  onClick,
  children,
  tone = 'pill',
  size,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed' | 'type' | 'className' | 'onClick'> & {
  pressed: boolean
  onClick: () => void
  tone?: ChipTone
  size?: ControlSize
}) {
  const { base, on, off } = chipTones[tone]
  // El chip conserva su padding y su forma; el tamaño táctil solo le da alto.
  const touch = useControlSize(size) === 'touch' ? 'min-h-11' : ''

  return (
    <button
      {...props}
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium transition-colors disabled:cursor-default disabled:opacity-50 ${base} ${touch} ${pressed ? on : off}`}
    >
      {pressed && <Check size={14} aria-hidden="true" />}
      {children}
    </button>
  )
}

const badgeColors = {
  neutral: 'bg-neutral-100 text-neutral-700',
  green: 'bg-green-100 text-green-800',
  red: 'bg-red-100 text-red-700',
  indigo: 'bg-indigo-100 text-indigo-700',
  amber: 'bg-amber-100 text-amber-800',
  // Los que siguen existen por el plano del POS, que distingue ocho estados de
  // mesa: la etiqueta de un estado tiene que ser del mismo color que la mesa.
  blue: 'bg-blue-100 text-blue-800',
  cyan: 'bg-cyan-100 text-cyan-900',
  violet: 'bg-violet-100 text-violet-800',
  rose: 'bg-rose-100 text-rose-800',
}

export type BadgeColor = keyof typeof badgeColors

export function Badge({
  children,
  color = 'neutral',
  className = '',
}: {
  children: ReactNode
  color?: BadgeColor
  className?: string
}) {
  return (
    <span className={`inline-flex items-center justify-center text-center rounded-xl px-2 py-1 text-xs leading-tight font-medium ${badgeColors[color]} ${className}`}>
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
    // Quien arma el contenido puede elegir dónde arranca el foco con `data-autofocus`
    // (en una confirmación, la opción que no destruye nada); si no, el primer campo.
    // Sin ninguno (un QR, una vista previa), queda el foco que eligió el navegador.
    const initial = dialog.querySelector<HTMLElement>('[data-autofocus]') ?? dialog.querySelector<HTMLElement>(FIRST_FIELD)
    initial?.focus()
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
          <IconButton label="Cerrar" onClick={requestClose}>
            <X size={18} />
          </IconButton>
        </div>
        {children}
      </div>
    </dialog>
  )
}

/** Carga en curso. Se anuncia como estado, así quien no ve el giro sabe que espera. */
export function Spinner() {
  return (
    <div role="status" className="flex justify-center p-10">
      <div
        aria-hidden="true"
        className="h-7 w-7 animate-spin rounded-full border-2 border-neutral-300 border-t-primary motion-reduce:animate-none"
      />
      <span className="sr-only">Cargando…</span>
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
