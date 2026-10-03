import { useId, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { tablePlacement } from '@restaurant-platform/shared'
import { Badge } from '@restaurant-platform/ui'
import type { FloorTable } from '@/queries/floor'
import { cardClass } from './styles'
import { TableGlyph } from './TableGlyph'

type SectionTablesProps = {
  tables: FloorTable[]
  /** Tocar una fila: editando, elige su mesa en el plano; en la vista, abre su QR. */
  onChoose: (table: FloorTable) => void
  /** Al final de cada fila, adónde lleva tocarla: el panel de la mesa, o su QR. */
  chooseIcon: LucideIcon
  /** Lo que se lee si el sector no tiene mesas. */
  empty: string
  /** Lo que se lee debajo del título: un resumen del sector. */
  summary?: string
  /** Lo que va al pie del panel, como las mesas sin sector. */
  children?: ReactNode
}

/**
 * Panel lateral sin mesa elegida: las mesas del sector, en el orden del POS. Es
 * también la forma de llegar a una mesa sin tocar el plano: con el teclado, o
 * con un lector de pantalla.
 */
export function SectionTables({
  tables,
  onChoose,
  chooseIcon: ChooseIcon,
  empty,
  summary,
  children,
}: SectionTablesProps) {
  const headingId = useId()

  return (
    <aside aria-labelledby={headingId} className={`flex min-h-0 flex-col gap-3 overflow-y-auto px-4 pt-6 pb-4 ${cardClass}`}>
      <div className="px-2">
        <h2 id={headingId} className="text-lg leading-tight font-bold text-neutral-900">
          Mesas del sector
        </h2>
        {summary && <p className="mt-0.5 text-sm text-muted">{summary}</p>}
      </div>

      {tables.length === 0 ? (
        <p className="px-2 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {tables.map((table) => (
            <li key={table.id}>
              <button
                type="button"
                onClick={() => onChoose(table)}
                className="flex min-h-15 w-full cursor-pointer items-center gap-3 rounded-xl px-2 text-left transition-colors hover:bg-neutral-50"
              >
                <TableRow table={table} />
                <ChooseIcon size={20} aria-hidden="true" className="shrink-0 text-faint" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {children}
    </aside>
  )
}

function TableRow({ table }: { table: FloorTable }) {
  const { footprint } = tablePlacement(table)
  const muted = !table.is_active || !table.is_visible

  return (
    <>
      <span className="flex w-9 shrink-0 justify-center">
        <TableGlyph round={table.shape === 'round'} width={footprint.w} height={footprint.h} muted={muted} />
      </span>
      {/* El estado va abajo, con los lugares: al lado del nombre, en un panel de
          300 px, «Barra de apoyo» quedaba en «Barra…». */}
      <span className="flex min-w-0 flex-1 flex-col leading-snug">
        <span className="truncate font-semibold text-neutral-900">{table.label}</span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
          {table.seats === 1 ? '1 lugar' : `${table.seats} lugares`}
          {muted && <Badge>Fuera de uso</Badge>}
        </span>
      </span>
    </>
  )
}
