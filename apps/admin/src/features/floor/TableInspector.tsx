import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { TABLE_SPAN, tableShapeLabels, tableShapes } from '@restaurant-platform/shared'
import { Button, Field, Input, Select, Toggle } from '@restaurant-platform/ui'
import type { FloorSection, FloorTable, TableLayoutPatch } from './floor-api'

type TableInspectorProps = {
  table: FloorTable
  sections: FloorSection[]
  onPatch: (patch: TableLayoutPatch) => void
  onDelete: () => void
  busy: boolean
}

/**
 * Campo que se guarda al salir, no en cada tecla: escribir "12" no puede dejar
 * la mesa en 1 ni disparar dos escrituras.
 */
function useCommittedField(value: string, commit: (draft: string) => void) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return {
    value: draft,
    onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
    onBlur: () => commit(draft),
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') event.currentTarget.blur()
      if (event.key === 'Escape') setDraft(value)
    },
  }
}

function wholeNumberIn(draft: string, min: number, max: number) {
  const parsed = Number(draft)
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null
}

/** Propiedades de la mesa seleccionada en el plano. */
export function TableInspector({ table, sections, onPatch, onDelete, busy }: TableInspectorProps) {
  const label = useCommittedField(table.label, (draft) => {
    const next = draft.trim()
    if (next && next !== table.label) onPatch({ label: next })
  })
  const seats = useCommittedField(String(table.seats), (draft) => {
    const next = wholeNumberIn(draft, 1, 40)
    if (next !== null && next !== table.seats) onPatch({ seats: next })
  })
  const width = useCommittedField(String(table.width), (draft) => {
    const next = wholeNumberIn(draft, TABLE_SPAN.min, TABLE_SPAN.max)
    if (next !== null && next !== table.width) onPatch({ width: next })
  })
  const height = useCommittedField(String(table.height), (draft) => {
    const next = wholeNumberIn(draft, TABLE_SPAN.min, TABLE_SPAN.max)
    if (next !== null && next !== table.height) onPatch({ height: next })
  })

  return (
    <aside className="space-y-4 rounded-xl border border-neutral-200 bg-white p-4">
      <div>
        <h2 className="text-sm font-semibold text-neutral-900">Mesa seleccionada</h2>
        <p className="text-xs text-neutral-500">
          Posición {table.position_x}, {table.position_y} · arrastrala para moverla o tirá de la
          esquina para cambiarle el tamaño.
        </p>
      </div>

      <Field label="Identificador">
        <Input {...label} />
      </Field>

      <Field label="Sector">
        <Select
          value={table.section_id ?? ''}
          onChange={(event) => onPatch({ section_id: event.target.value || null })}
        >
          <option value="">Sin sector</option>
          {sections.map((section) => (
            <option key={section.id} value={section.id}>
              {section.name}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Capacidad">
          <Input type="number" min={1} max={40} {...seats} />
        </Field>
        <Field label="Forma">
          <Select value={table.shape} onChange={(event) => onPatch({ shape: event.target.value })}>
            {tableShapes.map((shape) => (
              <option key={shape} value={shape}>
                {tableShapeLabels[shape]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ancho (celdas)">
            <Input type="number" min={TABLE_SPAN.min} max={TABLE_SPAN.max} {...width} />
          </Field>
          <Field label="Alto (celdas)">
            <Input type="number" min={TABLE_SPAN.min} max={TABLE_SPAN.max} {...height} />
          </Field>
        </div>
        <p className="mt-1 text-xs text-neutral-500">
          Cada celda del plano equivale a un lugar de paso. Ancho distinto de alto da una mesa
          alargada.
        </p>
      </div>

      <div className="space-y-2 border-t border-neutral-200 pt-3">
        <Toggle
          checked={table.is_visible}
          onChange={(is_visible) => onPatch({ is_visible })}
          label="Visible en el plano operativo"
        />
        <Toggle
          checked={table.is_active}
          onChange={(is_active) => onPatch({ is_active })}
          label="En servicio (el QR abre sesión)"
        />
        {(!table.is_visible || !table.is_active) && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            El POS no va a ofrecer esta mesa para operar.
          </p>
        )}
      </div>

      <Button
        variant="danger"
        className="w-full"
        disabled={busy}
        onClick={() => {
          if (confirm(`¿Eliminar "${table.label}"? Se pierde su QR.`)) onDelete()
        }}
      >
        <Trash2 size={15} />
        Eliminar mesa
      </Button>
    </aside>
  )
}
