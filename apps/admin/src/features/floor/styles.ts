/**
 * Clases del Salón. La pantalla usa píldoras y tarjetas más redondeadas que el
 * resto del panel, y `Button` trae su `rounded-lg` de base: dos `rounded-*` en
 * la misma clase no se pisan por orden de escritura sino por el del CSS, así que
 * acá se arman enteras en lugar de pisar las de `ui`.
 */

/** Tarjeta del Salón: el plano, el panel lateral. */
export const cardClass = 'rounded-2xl border border-neutral-200 bg-white'

export type PillVariant = 'primary' | 'secondary' | 'danger' | 'dashed'

const pillVariants: Record<PillVariant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-hover disabled:bg-primary/40',
  secondary: 'border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 disabled:text-neutral-300',
  danger: 'border border-red-200 bg-white text-red-700 hover:bg-red-50 disabled:text-red-300',
  // Lo que crea algo nuevo y no es la acción principal: «Nuevo sector».
  dashed: 'border border-dashed border-neutral-400 text-muted hover:bg-white hover:text-neutral-900',
}

/** Botón de texto con forma de píldora, de 44 px de alto. */
export function pillClass(variant: PillVariant = 'secondary') {
  return `inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${pillVariants[variant]}`
}

const roundIconBase =
  'inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors disabled:cursor-default disabled:text-neutral-300 disabled:hover:bg-transparent'

/** Botón redondo de solo ícono, de 44 × 44 px. Lleva `aria-label`. */
export const roundIconClass = `${roundIconBase} border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50`

/** El mismo botón sin borde, para una barra donde ya hay otros controles: «⋯». */
export const ghostIconClass = `${roundIconBase} text-muted hover:bg-neutral-100 hover:text-neutral-900`
