import { useState, type ReactNode } from 'react'
import { Plus, X } from 'lucide-react'
import { Button, IconButton, Input, SectionPills } from '@restaurant-platform/ui'
import type { Floor } from './floor'

type SectionTabsProps = {
  floor: Floor
  activeId: string | null
  onChoose: (sectionId: string) => void
  /** Lo que sigue a los sectores en la misma fila, como «Nuevo sector». */
  children?: ReactNode
}

/** Los sectores de la sucursal como píldoras (las mismas del POS), cada uno con sus mesas. */
export function SectionTabs({ floor, activeId, onChoose, children }: SectionTabsProps) {
  return (
    <SectionPills
      label="Sectores"
      sections={floor.sections.map((entry) => ({
        id: entry.id,
        name: entry.name,
        tables: floor.tablesIn(entry.id).length,
        inUse: entry.is_active,
      }))}
      activeId={activeId}
      onChoose={onChoose}
    >
      {children}
    </SectionPills>
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
