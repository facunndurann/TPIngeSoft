import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { Copy, Plus, Printer, QrCode, Trash2 } from 'lucide-react'
import { Link } from 'react-router'
import type { Tables } from '@restaurant-platform/shared'
import { customerAppUrl } from '@/lib/customer-app'
import { supabase } from '@/lib/supabase'
import { branchesQuery } from '@/queries/branches'
import { branchTablesQuery } from '@/queries/tables'
import { useRestaurant } from '@/restaurant/restaurant-context'
import { Badge, Button, EmptyState, ErrorText, Input, Modal, Select, Spinner, Toggle, useSaveErrors } from '@restaurant-platform/ui'

type DiningTable = Tables<'tables'> & {
  floor_sections: Pick<Tables<'floor_sections'>, 'id' | 'name'> | null
}

function tableUrl(table: DiningTable) {
  return customerAppUrl(`/m/${table.qr_token}`)
}

export function TablesPage() {
  const restaurant = useRestaurant()
  const queryClient = useQueryClient()
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null)
  const [newLabel, setNewLabel] = useState('')
  const [qrTable, setQrTable] = useState<DiningTable | null>(null)
  const errors = useSaveErrors()

  const { data: branches } = useQuery(branchesQuery(restaurant.id))

  const branchId = selectedBranchId ?? branches?.[0]?.id ?? null

  const tablesQuery = branchTablesQuery(branchId ?? '')
  const { data: tables, isLoading } = useQuery({ ...tablesQuery, enabled: !!branchId })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: tablesQuery.queryKey })

  const createMutation = useMutation(errors.saving('No pudimos crear la mesa.', {
    mutationFn: async (label: string) => {
      const { error: mErr } = await supabase.from('tables').insert({
        restaurant_id: restaurant.id,
        branch_id: branchId!,
        label,
      })
      if (mErr) throw mErr
    },
    onSuccess: () => {
      setNewLabel('')
      invalidate()
    },
  }))

  const updateMutation = useMutation(errors.saving('No pudimos guardar la mesa.', {
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error: mErr } = await supabase.from('tables').update({ is_active }).eq('id', id)
      if (mErr) throw mErr
    },
    onSuccess: invalidate,
  }))

  const deleteMutation = useMutation(errors.saving('No pudimos eliminar la mesa.', {
    mutationFn: async (id: string) => {
      const { error: mErr } = await supabase.from('tables').delete().eq('id', id)
      if (mErr) throw mErr
    },
    onSuccess: invalidate,
  }))

  function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (newLabel.trim() && branchId) createMutation.mutate(newLabel.trim())
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">Mesas y códigos QR</h1>
        <p className="text-sm text-neutral-500">
          Cada mesa tiene un QR único que identifica al restaurante, la sucursal y la mesa. El sector
          y la ubicación se editan en{' '}
          <Link to="/salon" className="text-indigo-600 hover:underline">
            Salón
          </Link>
          .
        </p>
      </div>

      {branches && branches.length > 1 && (
        <Select value={branchId ?? ''} onChange={(e) => setSelectedBranchId(e.target.value)}>
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
        />
        <Button type="submit" disabled={createMutation.isPending || !branchId}>
          <Plus size={16} /> Agregar
        </Button>
      </form>

      <ErrorText message={errors.message} />

      {isLoading ? (
        <Spinner />
      ) : !tables?.length ? (
        <EmptyState message="No hay mesas en esta sucursal. Agregá la primera arriba." />
      ) : (
        <ul className="space-y-2">
          {tables.map((table) => (
            <li
              key={table.id}
              className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3"
            >
              <span className="flex-1 text-sm font-medium text-neutral-900">{table.label}</span>
              <Badge color={table.floor_sections ? 'neutral' : 'amber'}>
                {table.floor_sections?.name ?? 'Sin sector'}
              </Badge>
              {!table.is_visible && table.is_active && <Badge color="amber">Oculta</Badge>}
              {!table.is_active && <Badge color="red">Inactiva</Badge>}
              <Button variant="secondary" onClick={() => setQrTable(table)}>
                <QrCode size={15} /> Ver QR
              </Button>
              <Toggle
                checked={table.is_active}
                onChange={(value) => updateMutation.mutate({ id: table.id, is_active: value })}
              />
              <button
                className="cursor-pointer p-1 text-neutral-400 hover:text-red-600"
                onClick={() => {
                  if (confirm(`¿Eliminar "${table.label}"? Se pierde su QR.`)) {
                    deleteMutation.mutate(table.id)
                  }
                }}
                aria-label="Eliminar"
              >
                <Trash2 size={15} />
              </button>
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
  table: DiningTable
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
        <p className="hidden text-sm text-neutral-500 print:block">Escaneá para ver el menú y pedir</p>
        <code className="break-all rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-600 print:hidden">
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
