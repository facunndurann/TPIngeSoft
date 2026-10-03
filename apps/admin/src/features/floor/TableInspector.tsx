import { useId, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Minus,
  Plus,
  Scaling,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react'
import { tablePlacement, tableShapeLabels, tableShapes, type Placed } from '@restaurant-platform/shared'
import { Button, Field, IconButton, Input, Toggle, floorCardClass, iconButtonClass } from '@restaurant-platform/ui'
import type { FloorTable, TablePatch } from '@/queries/floor'
import { changesTo, nudged, type NudgeKind, type Step } from './placement'
import { TableGlyph } from './TableGlyph'

/**
 * Los datos de la mesa que se cambian desde el panel. La ubicación y el tamaño
 * van aparte (`onPlace`): pasan por la misma validación que arrastrarla.
 */
export type TableEdit = Pick<TablePatch, 'label' | 'seats' | 'shape' | 'is_active' | 'is_visible'>

type TableInspectorProps = {
  table: FloorTable
  /** El sector donde está la mesa, o «Sin sector»: se lee debajo de su nombre. */
  sectionName: string
  onEdit: (edit: TableEdit) => void
  /** Lleva la mesa a otro lugar o tamaño con las flechas del panel: quien edita valida y escribe. */
  onPlace: (placed: Placed) => void
  /** Pide borrarla: la confirmación es del editor, que también la abre con Suprimir. */
  onDelete: () => void
  /** Suelta la mesa: el panel vuelve a la lista del sector. */
  onClose: () => void
  busy: boolean
}

const SEATS = { min: 1, max: 40 } as const

/**
 * Las flechas del panel hacen lo mismo que las del teclado, para quien no tiene
 * teclado ni puede arrastrar (WCAG 2.5.7). Un quinto botón cambia lo que hacen,
 * como Mayús: mover la mesa, o estirarla desde su borde de la derecha o el de abajo.
 */
const NUDGES: readonly { step: Step; icon: LucideIcon; label: Record<NudgeKind, string> }[] = [
  { step: { dx: -1, dy: 0 }, icon: ArrowLeft, label: { move: 'Mover a la izquierda', stretch: 'Achicar el ancho' } },
  { step: { dx: 0, dy: -1 }, icon: ArrowUp, label: { move: 'Mover hacia arriba', stretch: 'Achicar el alto' } },
  { step: { dx: 0, dy: 1 }, icon: ArrowDown, label: { move: 'Mover hacia abajo', stretch: 'Agrandar el alto' } },
  { step: { dx: 1, dy: 0 }, icon: ArrowRight, label: { move: 'Mover a la derecha', stretch: 'Agrandar el ancho' } },
]

function NudgePad({ table, onPlace }: { table: FloorTable; onPlace: (placed: Placed) => void }) {
  const [kind, setKind] = useState<NudgeKind>('move')
  const labelId = useId()
  const placed = tablePlacement(table)

  return (
    <div role="group" aria-labelledby={labelId}>
      <span id={labelId} className="mb-1 block text-sm font-medium text-neutral-700">
        {kind === 'move' ? 'Mover' : 'Estirar'}
      </span>
      <div className="flex items-center gap-2">
        {NUDGES.map(({ step, icon: Icon, label }) => {
          const next = nudged(placed, step, kind)
          return (
            <IconButton
              key={label.move}
              label={label[kind]}
              size="touch"
              shape="pill"
              variant="secondary"
              // Contra el borde del plano, o en el tamaño mínimo o máximo, la flecha no haría nada.
              disabled={changesTo(table, next) === null}
              onClick={() => onPlace(next)}
            >
              <Icon size={18} aria-hidden="true" />
            </IconButton>
          )
        })}
        <button
          type="button"
          aria-pressed={kind === 'stretch'}
          aria-label="Estirar en lugar de mover"
          title="Estirar en lugar de mover"
          onClick={() => setKind(kind === 'move' ? 'stretch' : 'move')}
          className={`ml-auto ${iconButtonClass({ size: 'touch', shape: 'pill', variant: 'secondary' })} aria-pressed:border-primary aria-pressed:bg-primary-soft aria-pressed:text-primary-ink`}
        >
          <Scaling size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

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
        <IconButton
          label={`${label}: restar uno`}
          size="touch"
          shape="pill"
          variant="secondary"
          disabled={value <= min}
          onClick={() => onCommit(value - 1)}
        >
          <Minus size={18} aria-hidden="true" />
        </IconButton>
        <Input
          id={id}
          size="touch"
          inputMode="numeric"
          className="w-18 min-w-0 text-center text-base font-bold tabular-nums"
          {...field}
        />
        <IconButton
          label={`${label}: sumar uno`}
          size="touch"
          shape="pill"
          variant="secondary"
          disabled={value >= max}
          onClick={() => onCommit(value + 1)}
        >
          <Plus size={18} aria-hidden="true" />
        </IconButton>
      </div>
    </div>
  )
}

/**
 * Propiedades de la mesa seleccionada en el plano. El editor lo monta con
 * `key={table.id}`, así que un borrador nunca pasa de una mesa a otra.
 */
export function TableInspector({ table, sectionName, onEdit, onPlace, onDelete, onClose, busy }: TableInspectorProps) {
  const label = useDraftField(
    table.label,
    (text) => text.trim() || null,
    (next) => onEdit({ label: next }),
  )

  return (
    <aside
      aria-label="Mesa seleccionada"
      className={`flex min-h-0 flex-col gap-5 overflow-y-auto p-6 ${floorCardClass}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg leading-tight font-bold break-words text-neutral-900">{table.label}</h2>
          <p className="text-sm text-muted">{sectionName}</p>
        </div>
        <IconButton label="Cerrar" size="touch" shape="pill" variant="secondary" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </IconButton>
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

      <NudgePad table={table} onPlace={onPlace} />

      <div className="space-y-2">
        <Toggle checked={table.is_active} onChange={(is_active) => onEdit({ is_active })} label="En uso" />
        <Toggle
          checked={table.is_visible}
          onChange={(is_visible) => onEdit({ is_visible })}
          label="Visible en el plano del POS"
        />
      </div>

      <div className="border-t border-neutral-200 pt-4">
        <Button
          type="button"
          variant="danger-ghost"
          size="touch"
          shape="pill"
          // Destructiva pero no la principal: rojo sin relleno, con borde para que
          // se lea como botón al pie del panel. El rojo lleno es el de confirmarla.
          className="border border-red-200"
          disabled={busy}
          onClick={onDelete}
        >
          <Trash2 size={16} aria-hidden="true" />
          Eliminar mesa
        </Button>
      </div>
    </aside>
  )
}
