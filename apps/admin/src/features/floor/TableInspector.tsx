import { useId, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { Minus, Plus, Trash2, X } from 'lucide-react'
import { tableShapeLabels, tableShapes } from '@restaurant-platform/shared'
import { Field, Input, Toggle } from '@restaurant-platform/ui'
import type { FloorSection, FloorTable, TablePatch } from '@/queries/floor'
import { cardClass, pillClass, roundIconClass } from './styles'
import { TableGlyph } from './TableGlyph'

/**
 * Lo que se cambia desde el panel. La ubicación y el tamaño no: se cambian en
 * el plano, arrastrando o con el teclado.
 */
export type TableEdit = Pick<TablePatch, 'label' | 'seats' | 'shape' | 'is_active' | 'is_visible'>

type TableInspectorProps = {
  table: FloorTable
  sections: FloorSection[]
  onEdit: (edit: TableEdit) => void
  /** Pide borrarla: la confirmación es del editor, que también la abre con Suprimir. */
  onDelete: () => void
  /** Suelta la mesa: el panel vuelve a la lista del sector. */
  onClose: () => void
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
  /** Devuelve `false` si rechaza el valor (una posición ocupada): el campo vuelve a lo guardado. */
  onCommit: (next: T) => boolean | void,
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
    // por un instante el valor viejo. Si no se guarda, vuelve a lo guardado.
    if (next !== null && next !== value && onCommit(next) !== false) return
    setDraft(null)
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
  onCommit: (next: number) => boolean | void
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
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={roundIconClass}
          aria-label={`${label}: restar uno`}
          disabled={value <= min}
          onClick={() => onCommit(value - 1)}
        >
          <Minus size={18} aria-hidden="true" />
        </button>
        <Input
          id={id}
          size="touch"
          inputMode="numeric"
          className="w-18 min-w-0 text-center text-base font-bold tabular-nums"
          {...field}
        />
        <button
          type="button"
          className={roundIconClass}
          aria-label={`${label}: sumar uno`}
          disabled={value >= max}
          onClick={() => onCommit(value + 1)}
        >
          <Plus size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

/**
 * Propiedades de la mesa seleccionada en el plano. El editor lo monta con
 * `key={table.id}`, así que un borrador nunca pasa de una mesa a otra.
 */
export function TableInspector({ table, sections, onEdit, onDelete, onClose, busy }: TableInspectorProps) {
  const label = useDraftField(
    table.label,
    (text) => text.trim() || null,
    (next) => onEdit({ label: next }),
  )
  const sectionName = sections.find((section) => section.id === table.section_id)?.name ?? 'Sin sector'

  return (
    <aside aria-label="Mesa seleccionada" className={`flex min-h-0 flex-col gap-5 overflow-y-auto p-6 ${cardClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg leading-tight font-bold break-words text-neutral-900">{table.label}</h2>
          <p className="text-sm text-muted">{sectionName}</p>
        </div>
        <button type="button" className={roundIconClass} aria-label="Cerrar" title="Cerrar" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <Field label="Nombre">
        <Input size="touch" {...label} />
      </Field>

      <NumberField
        label="Lugares"
        value={table.seats}
        min={SEATS.min}
        max={SEATS.max}
        onCommit={(seats) => onEdit({ seats })}
      />

      <fieldset className="min-w-0">
        <legend className="mb-1 text-sm font-medium text-neutral-700">Forma</legend>
        <div className="grid grid-cols-2 gap-2">
          {tableShapes.map((shape) => {
            // Una forma vieja que no es redonda se dibuja rectangular: se marca esa.
            const pressed = (shape === 'round') === (table.shape === 'round')
            return (
              <button
                key={shape}
                type="button"
                aria-pressed={pressed}
                onClick={() => onEdit({ shape })}
                className={`flex min-h-19 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 p-2.5 text-sm transition-colors ${
                  pressed
                    ? 'border-primary bg-primary-soft font-semibold text-primary-ink'
                    : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50'
                }`}
              >
                <TableGlyph round={shape === 'round'} width={shape === 'round' ? 1 : 2} height={1} />
                {tableShapeLabels[shape]}
              </button>
            )
          })}
        </div>
      </fieldset>

      <div className="space-y-2">
        <Toggle
          checked={table.is_active}
          onChange={(is_active) => onEdit({ is_active })}
          label="En uso (el QR abre sesión)"
        />
        <Toggle
          checked={table.is_visible}
          onChange={(is_visible) => onEdit({ is_visible })}
          label="Visible en el plano del POS"
        />
        {(!table.is_visible || !table.is_active) && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            El POS no va a ofrecer esta mesa para operar.
          </p>
        )}
      </div>

      <div className="border-t border-neutral-200 pt-4">
        <button
          type="button"
          className={pillClass('danger')}
          disabled={busy}
          onClick={onDelete}
        >
          <Trash2 size={16} aria-hidden="true" />
          Eliminar mesa
        </button>
      </div>
    </aside>
  )
}
