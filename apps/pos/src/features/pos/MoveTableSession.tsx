import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, ErrorText, Modal, Select, Spinner } from '@restaurant-platform/ui'
import { useRestaurant } from '@/context/pos-context'
import { refreshPos } from '@/lib/query-client'
import { movePosTableSession, posOpenSessionsQuery, posTablesQuery, type PosDiningTable } from './queries'

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
  const tables = useQuery(posTablesQuery(restaurant.id, restaurant.branchId))
  const sessions = useQuery(posOpenSessionsQuery(restaurant.id, restaurant.branchId))
  const move = useMutation({
    mutationFn: () => movePosTableSession(sessionId, source.id, destinationId),
    // El cliente del POS ya releyó todo: se cierra con el plano actualizado.
    onSuccess: onClose,
    // También al fallar: lo más probable es que otro ocupó la mesa destino, y la
    // lista tiene que dejar de ofrecerla.
    onError: () => { void refreshPos(queryClient) },
  })
  const destinations = (tables.data ?? []).filter((table) =>
    table.id !== source.id &&
    !sessions.data?.some((session) => session.table_id === table.id),
  )
  const available = destinations.some((table) => table.id === destinationId)
  const failed = tables.isError || sessions.isError
  return (
    <Modal title={`Mover comanda de ${source.label}`} onClose={() => { if (!move.isPending) onClose() }}>
      <div className="space-y-4 text-sm text-neutral-700">
        <p>Elegí una mesa libre de esta sucursal. Se conservan los pedidos, los comensales y la cuenta.</p>
        {tables.isLoading || sessions.isLoading ? <Spinner /> : failed ? (
          <ErrorText error={tables.error ?? sessions.error} fallback="No pudimos cargar las mesas disponibles. Cerrá y volvé a intentar." />
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
        <ErrorText error={move.error} fallback="No pudimos mover la comanda." />
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
