import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import { Badge } from '../components'

/** Un sector como lo muestran las píldoras: su nombre, cuántas mesas tiene y si está en uso. */
export type SectionPill = { id: string; name: string; tables: number; inUse: boolean }

/**
 * Los sectores como píldoras, en el admin y en el POS. Lo elegido no se dice solo
 * con color: `aria-pressed` lo anuncia y el ✓ lo muestra. Elegir un sector es
 * elegir una opción de un grupo, no cambiar de pestaña: son botones, sin el
 * contrato de teclado de un tablist.
 */
export function SectionPills({
  label,
  sections,
  activeId,
  onChoose,
  children,
}: {
  /** El nombre del grupo, para un lector de pantalla. */
  label: string
  sections: readonly SectionPill[]
  activeId: string | null
  onChoose: (sectionId: string) => void
  /** Lo que sigue a los sectores en la misma fila, como «Nuevo sector». */
  children?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
      {sections.map((entry) => {
        const pressed = entry.id === activeId
        return (
          <button
            key={entry.id}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChoose(entry.id)}
            className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm transition-colors ${
              pressed
                ? 'border-primary bg-primary-soft font-semibold text-primary-ink'
                : 'border-neutral-200 bg-white font-medium text-muted hover:bg-neutral-50'
            }`}
          >
            {pressed && <Check size={15} aria-hidden="true" />}
            {entry.name}
            {/* Se distingue por tamaño y peso, no con opacidad: atenuada no llegaba
                a 4,5:1 sobre el fondo del sector elegido. Se lee «4 mesas». */}
            <span className="text-xs font-normal tabular-nums">
              {entry.tables}
              <span className="sr-only"> {entry.tables === 1 ? 'mesa' : 'mesas'}</span>
            </span>
            {!entry.inUse && <Badge color="red">Sin uso</Badge>}
          </button>
        )
      })}
      {children}
    </div>
  )
}
