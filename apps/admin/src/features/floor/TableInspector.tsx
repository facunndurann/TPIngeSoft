import { useId, useState, type ChangeEvent, type KeyboardEvent } from 'react'
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

const SEATS = { min: 1, max: 40 } as const

/**
 * Borrador de un campo del inspector. Se guarda al salir del campo o con Enter,
 * nunca por tecla: escribir "12" no puede dejar la mesa en 1 ni disparar dos
 * escrituras. Un texto que `parse` rechaza, o que no cambia nada, vuelve a lo
 * guardado.
 */
function useDraftField<T extends string | number>(
  value: T,
  parse: (text: string) => T | null,
  onCommit: (next: T) => void,
) {
  // Lo tipeado y sobre qué valor guardado se tipeó. Sin borrador, el campo
  // muestra el valor guardado: no hay que copiar props al estado.
  const [draft, setDraft] = useState<{ text: string; over: T } | null>(null)

  // Un borrador vale mientras siga el valor sobre el que se escribió. Cuando
  // llega otro (el update optimista de lo que se acaba de guardar, un rollback
  // o un cambio desde el plano), se descarta en este mismo render, sin efecto.
  if (draft && draft.over !== value) setDraft(null)

  const text = draft?.text ?? String(value)

  function finish() {
    const next = parse(text)
    // Si se guarda, el borrador queda a la vista hasta que llega el valor nuevo:
    // el update optimista llega un momento después, y soltarlo ahora mostraría
    // por un instante el valor viejo.
    if (next !== null && next !== value) onCommit(next)
    else setDraft(null)
  }

  return {
    value: text,
    onChange: (event: ChangeEvent<HTMLInputElement>) =>
      setDraft({ text: event.target.value, over: value }),
    onBlur: finish,
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') event.currentTarget.blur()
      if (event.key === 'Escape') setDraft(null)
    },
  }
}

function wholeNumberIn(text: string, min: number, max: number) {
  const parsed = Number(text)
  return text.trim() !== '' && Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : null
}

/**
 * Entero con botones − / +. Hay dos formas de cambiarlo y cada una guarda por un
 * solo camino: los botones guardan al toque, y lo tipeado, al salir o con Enter.
 * Es un campo de texto numérico y no un `type="number"`, así que no existen
 * flechas nativas que guarden por su cuenta.
 */
function NumberField({
  label,
  value,
  min,
  max,
  onCommit,
}: {
  label: string
  value: number
  min: number
  max: number
  onCommit: (next: number) => void
}) {
  const id = useId()
  const field = useDraftField(value, (text) => wholeNumberIn(text, min, max), onCommit)

  // No usa `Field`: ese `<label>` envuelve a sus hijos, y con botones adentro
  // el primero (−) se llevaría el nombre del campo en vez del input.
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-neutral-700">
        {label}
      </label>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="secondary"
          className="px-2.5"
          aria-label={`${label}: restar uno`}
          disabled={value <= min}
          onClick={() => onCommit(value - 1)}
        >
          −
        </Button>
        <Input id={id} inputMode="numeric" className="min-w-0 text-center" {...field} />
        <Button
          type="button"
          variant="secondary"
          className="px-2.5"
          aria-label={`${label}: sumar uno`}
          disabled={value >= max}
          onClick={() => onCommit(value + 1)}
        >
          +
        </Button>
      </div>
    </div>
  )
}

/**
 * Propiedades de la mesa seleccionada en el plano. El editor lo monta con
 * `key={table.id}`, así que un borrador nunca pasa de una mesa a otra.
 */
export function TableInspector({ table, sections, onIntent, onDelete, busy }: TableInspectorProps) {
  const label = useDraftField(
    table.label,
    (text) => text.trim() || null,
    (next) => onIntent({ kind: 'edit', patch: { label: next } }),
  )

  return (
    <aside className="space-y-4 rounded-xl border border-neutral-200 bg-white p-4">
      <div>
        <h2 className="text-sm font-semibold text-neutral-900">Mesa seleccionada</h2>
        <p className="text-xs text-muted">
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
        <NumberField
          label="Capacidad"
          value={table.seats}
          min={SEATS.min}
          max={SEATS.max}
          onCommit={(seats) => onIntent({ kind: 'edit', patch: { seats } })}
        />
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
        {/* Un lado nuevo siempre viaja con el otro: el plano necesita la huella
            entera para reubicar la mesa si el cambio la saca de la grilla. */}
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Ancho (celdas)"
            value={table.width}
            min={TABLE_SPAN.min}
            max={TABLE_SPAN.max}
            onCommit={(width) => onIntent({ kind: 'resize', width, height: table.height })}
          />
          <NumberField
            label="Alto (celdas)"
            value={table.height}
            min={TABLE_SPAN.min}
            max={TABLE_SPAN.max}
            onCommit={(height) => onIntent({ kind: 'resize', width: table.width, height })}
          />
        </div>
        <p className="mt-1 text-xs text-muted">
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
