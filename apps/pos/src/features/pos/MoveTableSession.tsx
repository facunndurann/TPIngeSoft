import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, ErrorText, Modal, Select, Spinner } from '@restaurant-platform/ui'
import { useRestaurant } from '@/context/pos-context'
import { loadOpenSessions, loadRestaurantTables, movePosTableSession } from './api'
import type { PosDiningTable } from './types'

export function MoveTableSession({
  source,
  sessionId,
  onClose,
}: {
  source: PosDiningTable
  sessionId: string
  onClose: () => void
}) {
  const restaurant = useRestaurant()
  const queryClient = useQueryClient()
  const [destinationId, setDestinationId] = useState('')
  const tables = useQuery({
    queryKey: ['pos', restaurant.id, restaurant.branchId, 'tables'],
    queryFn: () => loadRestaurantTables(restaurant.id, restaurant.branchId),
  })
  const sessions = useQuery({
    queryKey: ['pos', restaurant.id, restaurant.branchId, 'sessions'],
    queryFn: () => loadOpenSessions(restaurant.id, restaurant.branchId),
    refetchInterval: 15000,
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['pos', restaurant.id] })
  const move = useMutation({
    mutationFn: () => movePosTableSession(sessionId, source.id, destinationId),
    onSuccess: async () => {
      await refresh()
      onClose()
    },
    onError: () => { void refresh() },
  })
  const destinations = (tables.data ?? []).filter((table) =>
    table.id !== source.id && table.branch_id === source.branch_id &&
    !sessions.data?.some((session) => session.table_id === table.id),
  )
  const available = destinations.some((table) => table.id === destinationId)
  const failed = tables.isError || sessions.isError
  return (
    <Modal title={`Mover comanda de ${source.label}`} onClose={() => { if (!move.isPending) onClose() }}>
      <div className="space-y-4 text-sm text-neutral-700">
        <p>Elegí una mesa libre de esta sucursal. Se conservan los pedidos, los comensales y la cuenta.</p>
        {tables.isLoading || sessions.isLoading ? <Spinner /> : failed ? (
          <ErrorText message="No pudimos cargar las mesas disponibles. Cerrá y volvé a intentar." />
        ) : destinations.length === 0 ? (
          <p>No hay mesas libres disponibles en esta sucursal.</p>
        ) : (
          <label className="block space-y-1">
            <span>Mesa destino</span>
            <Select value={available ? destinationId : ''} disabled={move.isPending}
              onChange={(event) => { setDestinationId(event.target.value); move.reset() }}>
              <option value="">Seleccioná una mesa</option>
              {destinations.map((table) => (
                <option key={table.id} value={table.id}>
                  {table.label} · {table.floor_sections?.name ?? 'Sin sector'} · {table.seats} lugares
                </option>
              ))}
            </Select>
          </label>
        )}
        <ErrorText message={move.error?.message ?? null} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={move.isPending} onClick={onClose}>Cancelar</Button>
          <Button disabled={!available || failed || move.isPending || sessions.isLoading}
            onClick={() => move.mutate()}>
            {move.isPending ? 'Moviendo…' : 'Mover comanda'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
