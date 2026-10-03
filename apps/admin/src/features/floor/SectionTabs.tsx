import { useState, type ReactNode } from 'react'
import { Check, Plus, X } from 'lucide-react'
import { Badge, Button, IconButton, Input } from '@restaurant-platform/ui'
import type { Floor } from './floor'

type SectionTabsProps = {
  floor: Floor
  activeId: string | null
  onChoose: (sectionId: string) => void
  /** Lo que sigue a los sectores en la misma fila, como «Nuevo sector». */
  children?: ReactNode
}

/**
 * Los sectores de la sucursal como píldoras. Lo elegido no se dice solo con
 * color: `aria-pressed` lo anuncia y el ✓ lo muestra.
 */
export function SectionTabs({ floor, activeId, onChoose, children }: SectionTabsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Sectores">
      {floor.sections.map((entry) => {
        const pressed = entry.id === activeId
        const count = floor.tablesIn(entry.id).length
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
              {count}
              <span className="sr-only"> {count === 1 ? 'mesa' : 'mesas'}</span>
            </span>
            {!entry.is_active && <Badge color="red">Sin uso</Badge>}
          </button>
        )
      })}
      {children}
    </div>
  )
}

/**
 * «Nuevo sector»: una píldora punteada que se abre en un campo para el nombre.
 * Se cierra sola si se guardó; si falló, queda abierta con lo escrito.
 */
export function NewSectionButton({
  pending,
  onAdd,
}: {
  pending: boolean
  onAdd: (name: string, onSaved: () => void) => void
}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  if (!adding)
    return (
      <Button
        type="button"
        variant="ghost"
        size="touch"
        shape="pill"
        // Crea algo, pero no es la acción principal de la pantalla: va punteado.
        className="border border-dashed border-neutral-400"
        onClick={() => setAdding(true)}
      >
        <Plus size={16} aria-hidden="true" />
        Nuevo sector
      </Button>
    )

  const close = () => {
    setAdding(false)
    setName('')
  }

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        const trimmed = name.trim()
        if (trimmed) onAdd(trimmed, close)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') close()
      }}
    >
      <Input
        size="touch"
        className="w-48"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Nombre del sector"
        aria-label="Nombre del nuevo sector"
        autoFocus
      />
      <Button type="submit" size="touch" shape="pill" disabled={pending}>
        Crear
      </Button>
      <IconButton label="Cancelar" size="touch" shape="pill" variant="secondary" onClick={close}>
        <X size={18} aria-hidden="true" />
      </IconButton>
    </form>
  )
}
