import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { Copy, Plus, Printer, QrCode, Trash2 } from 'lucide-react'
import { Link } from 'react-router'
import { customerAppUrl } from '@/lib/customer-app'
import { optimistic, patchRow } from '@/lib/optimistic'
import { branchesQuery } from '@/queries/branches'
import {
  createTable,
  deleteTable,
  sectionsQuery,
  tablesQuery,
  updateTable,
  type FloorTable,
} from '@/queries/floor'
import { useRestaurant } from '@/restaurant/restaurant-context'
import { Badge, Button, EmptyState, ErrorText, IconButton, Input, Modal, Select, Spinner, Toggle, useSaveErrors } from '@restaurant-platform/ui'

function tableUrl(table: FloorTable) {
  return customerAppUrl(`/m/${table.qr_token}`)
}

export function TablesPage() {
  const restaurant = useRestaurant()
  const queryClient = useQueryClient()
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null)
  const [newLabel, setNewLabel] = useState('')
  const [qrTable, setQrTable] = useState<FloorTable | null>(null)
  const errors = useSaveErrors()

  const { data: branches } = useQuery(branchesQuery(restaurant.id))

  const branchId = selectedBranchId ?? branches?.[0]?.id ?? null

  // Las mismas consultas que Salón: lo que se cambia en una pantalla ya está en la otra.
  const branchTables = tablesQuery(branchId ?? '')
  const tables = useQuery({ ...branchTables, enabled: !!branchId })
  const sections = useQuery({ ...sectionsQuery(branchId ?? ''), enabled: !!branchId })
  const sectionNames = new Map<string | null, string>(
    sections.data?.map((section) => [section.id, section.name]),
  )

  // Acá solo cambian mesas, así que alcanza con invalidar las mesas.
  const invalidate = () => queryClient.invalidateQueries({ queryKey: branchTables.queryKey })

  const createMutation = useMutation(errors.saving('No pudimos crear la mesa.', {
    // Sin sector: existe y tiene QR, y se ubica después en Salón.
    mutationFn: (label: string) =>
      createTable({ restaurant_id: restaurant.id, branch_id: branchId!, label }),
    onSuccess: () => {
      setNewLabel('')
      invalidate()
    },
  }))

  const updateMutation = useMutation(errors.saving('No pudimos guardar la mesa.', {
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      updateTable(id, { is_active }),
    // La misma caché que Salón: el cambio también se ve ahí.
    ...optimistic(queryClient, branchTables.queryKey, patchRow<FloorTable>),
  }, ({ id }) => id))

  const deleteMutation = useMutation(errors.saving('No pudimos eliminar la mesa.', {
    mutationFn: (id: string) => deleteTable(id),
    onSuccess: invalidate,
  }, (id) => id))

  function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (newLabel.trim() && branchId) createMutation.mutate(newLabel.trim())
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">Mesas y códigos QR</h1>
        <p className="text-sm text-muted">
          Cada mesa tiene un QR único que identifica al restaurante, la sucursal y la mesa. El sector
          y la ubicación se editan en{' '}
          <Link to="/salon" className="text-primary hover:underline">
            Salón
          </Link>
          .
        </p>
      </div>

      {branches && branches.length > 1 && (
        <Select
          value={branchId ?? ''}
          onChange={(e) => setSelectedBranchId(e.target.value)}
          aria-label="Sucursal"
        >
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </Select>
      )}

      <form onSubmit={handleCreate} className="flex gap-2">
        <Input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Nueva mesa (ej: Mesa 5)"
          aria-label="Identificador de la nueva mesa"
        />
        <Button type="submit" disabled={createMutation.isPending || !branchId}>
          <Plus size={16} /> Agregar
        </Button>
      </form>

      <ErrorText error={errors.message} />

      {tables.isLoading || sections.isLoading ? (
        <Spinner />
      ) : !tables.data?.length ? (
        <EmptyState message="No hay mesas en esta sucursal. Agregá la primera arriba." />
      ) : (
        <ul className="space-y-2">
          {tables.data.map((table) => (
            <li
              key={table.id}
              className="space-y-2 rounded-xl border border-neutral-200 bg-white px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span className="flex-1 text-sm font-medium text-neutral-900">{table.label}</span>
                <Badge color={sectionNames.has(table.section_id) ? 'neutral' : 'amber'}>
                  {sectionNames.get(table.section_id) ?? 'Sin sector'}
                </Badge>
                {!table.is_visible && table.is_active && <Badge color="amber">Oculta</Badge>}
                {!table.is_active && <Badge color="red">Inactiva</Badge>}
                <Button variant="secondary" onClick={() => setQrTable(table)}>
                  <QrCode size={15} /> Ver QR
                </Button>
                <Toggle
                  checked={table.is_active}
                  onChange={(value) => updateMutation.mutate({ id: table.id, is_active: value })}
                  label={`En servicio: ${table.label}`}
                  hideLabel
                  busy={updateMutation.isPending && updateMutation.variables?.id === table.id}
                />
                <IconButton
                  label={`Eliminar ${table.label}`}
                  tone="danger"
                  onClick={() => {
                    if (confirm(`¿Eliminar "${table.label}"? Se pierde su QR.`)) {
                      deleteMutation.mutate(table.id)
                    }
                  }}
                >
                  <Trash2 size={15} />
                </IconButton>
              </div>
              <ErrorText error={errors.messageFor(table.id)} />
            </li>
          ))}
        </ul>
      )}

      {qrTable && <QrModal table={qrTable} restaurantName={restaurant.name} onClose={() => setQrTable(null)} />}
    </div>
  )
}

function QrModal({
  table,
  restaurantName,
  onClose,
}: {
  table: FloorTable
  restaurantName: string
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const url = tableUrl(table)

  return (
    <Modal title={`QR de ${table.label}`} onClose={onClose}>
      <div id="qr-print-area" className="flex flex-col items-center gap-3 py-2">
        <p className="hidden text-lg font-bold print:block">{restaurantName}</p>
        <QRCodeSVG value={url} size={220} marginSize={2} />
        <p className="text-base font-semibold text-neutral-900">{table.label}</p>
        <p className="hidden text-sm text-muted print:block">Escaneá para ver el menú y pedir</p>
        <code className="break-all rounded bg-neutral-100 px-2 py-1 text-xs text-muted print:hidden">
          {url}
        </code>
      </div>
      <div className="mt-4 flex gap-2 print:hidden">
        <Button
          variant="secondary"
          className="flex-1"
          onClick={async () => {
            await navigator.clipboard.writeText(url)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
        >
          <Copy size={15} /> {copied ? 'Copiado' : 'Copiar link'}
        </Button>
        <Button className="flex-1" onClick={() => window.print()}>
          <Printer size={15} /> Imprimir
        </Button>
      </div>
    </Modal>
  )
}
