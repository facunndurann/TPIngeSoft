import { useCallback, useEffect, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { TABLE_SPAN, tableShapeLabels, tableShapes } from '@restaurant-platform/shared'
import { Button, Field, Input, Select, Toggle } from '@restaurant-platform/ui'
import type { FloorSection, FloorTable, TablePatch } from '@/queries/floor'

/**
 * Lo que el inspector le pide al plano. Son tres operaciones con semántica
 * propia — redimensionar recalcula la posición, mudar de sector busca un hueco
 * libre, editar es un update plano — así que viajan discriminadas en vez de
 * como un `Partial<>` suelto cuyas claves haya que olfatear del otro lado.
 */
export type TableIntent =
  | { kind: 'edit'; patch: Omit<TablePatch, 'section_id' | 'width' | 'height'> }
  | { kind: 'resize'; width: number; height: number }
  | { kind: 'move-to-section'; sectionId: string | null }

type TableInspectorProps = {
  table: FloorTable
  sections: FloorSection[]
  onIntent: (intent: TableIntent) => void
  onDelete: () => void
  busy: boolean
}

/**
 * React `onChange` es el evento `input`. Las flechas nativas (botones o teclado)
 * suelen mandar `increment`/`decrement`, reemplazar el número entero, o no
 * declarar `inputType`. Escribir "12" llega como insert/delete y espera al blur.
 */
export function isStepperChange(nativeEvent: Event, previous: string, next: string) {
  const inputType = 'inputType' in nativeEvent ? String(nativeEvent.inputType) : ''
  if (inputType.startsWith('insert') && inputType !== 'insertReplacementText') return false
  if (inputType.startsWith('delete') || inputType.startsWith('history')) return false
  if (
    !inputType ||
    inputType === 'increment' ||
    inputType === 'decrement' ||
    inputType === 'insertReplacementText'
  ) {
    return true
  }
  const from = Number(previous)
  const to = Number(next)
  return Number.isInteger(from) && Number.isInteger(to) && Math.abs(to - from) === 1
}

/**
 * Campo que se guarda al salir, no en cada tecla: escribir "12" no puede dejar
 * la mesa en 1 ni disparar dos escrituras. El stepper sí guarda al toque.
 */
function useCommittedField(value: string, commit: (draft: string) => void) {
  const [draft, setDraft] = useState(value)
  const draftRef = useRef(value)
  const commitRef = useRef(commit)
  const nodeCleanup = useRef<(() => void) | null>(null)
  commitRef.current = commit

  useEffect(() => {
    setDraft(value)
    draftRef.current = value
  }, [value])

  function take(next: string) {
    setDraft(next)
    draftRef.current = next
  }

  function flush(next = draftRef.current) {
    take(next)
    commitRef.current(next)
  }

  const bindNode = useCallback((node: HTMLInputElement | null) => {
    nodeCleanup.current?.()
    nodeCleanup.current = null
    if (!node || node.type !== 'number') return
    const onNativeChange = () => {
      const next = node.value
      setDraft(next)
      draftRef.current = next
      commitRef.current(next)
    }
    node.addEventListener('change', onNativeChange)
    nodeCleanup.current = () => node.removeEventListener('change', onNativeChange)
  }, [])

  return {
    value: draft,
    // El `change` nativo (no el onChange de React) es el que disparan las flechas
    // del input number en Safari/Chrome sin soltar el foco.
    ref: bindNode,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      const previous = draftRef.current
      const next = event.target.value
      take(next)
      if (event.currentTarget.type === 'number' && isStepperChange(event.nativeEvent, previous, next)) {
        commitRef.current(next)
      }
    },
    onBlur: () => commitRef.current(draftRef.current),
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') event.currentTarget.blur()
      if (event.key === 'Escape') take(value)
      if (event.currentTarget.type === 'number' && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        const node = event.currentTarget
        requestAnimationFrame(() => flush(node.value))
      }
    },
  }
}

function wholeNumberIn(draft: string, min: number, max: number) {
  const parsed = Number(draft)
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null
}

/** Propiedades de la mesa seleccionada en el plano. */
export function TableInspector({ table, sections, onIntent, onDelete, busy }: TableInspectorProps) {
  const label = useCommittedField(table.label, (draft) => {
    const next = draft.trim()
    if (next && next !== table.label) onIntent({ kind: 'edit', patch: { label: next } })
  })
  const seats = useCommittedField(String(table.seats), (draft) => {
    const next = wholeNumberIn(draft, 1, 40)
    if (next !== null && next !== table.seats) onIntent({ kind: 'edit', patch: { seats: next } })
  })
  // Un lado nuevo siempre viaja con el otro: el plano necesita la huella entera
  // para reubicar la mesa si el cambio la saca de la grilla.
  const width = useCommittedField(String(table.width), (draft) => {
    const next = wholeNumberIn(draft, TABLE_SPAN.min, TABLE_SPAN.max)
    if (next !== null && next !== table.width) {
      onIntent({ kind: 'resize', width: next, height: table.height })
    }
  })
  const height = useCommittedField(String(table.height), (draft) => {
    const next = wholeNumberIn(draft, TABLE_SPAN.min, TABLE_SPAN.max)
    if (next !== null && next !== table.height) {
      onIntent({ kind: 'resize', width: table.width, height: next })
    }
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
          onChange={(event) => onIntent({ kind: 'move-to-section', sectionId: event.target.value || null })}
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
          <Select value={table.shape} onChange={(event) => onIntent({ kind: 'edit', patch: { shape: event.target.value } })}>
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
          onChange={(is_visible) => onIntent({ kind: 'edit', patch: { is_visible } })}
          label="Visible en el plano operativo"
        />
        <Toggle
          checked={table.is_active}
          onChange={(is_active) => onIntent({ kind: 'edit', patch: { is_active } })}
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
