import type { ComponentType } from 'react'
import type { PosPermission } from '@restaurant-platform/shared'
import { ActiveTables } from './ActiveTables'
import { CommandBoard } from './CommandBoard'
import { FloorMap } from './FloorMap'
import { OrderHistory } from './OrderHistory'
import { TableCommand } from './TableCommand'

export type PosSection = {
  /** Ruta dentro de `/`; la vacía es la portada. */
  path: string
  label: string
  /** Lo que la cuenta necesita para ver la pestaña y para abrir la ruta. */
  permission: PosPermission
  screen: ComponentType
  /** Pantallas que se abren desde la sección: mismo permiso, sin pestaña propia. */
  subroutes?: { path: string; screen: ComponentType }[]
}

/**
 * Secciones del POS, en el orden de las pestañas. Las pestañas y las rutas salen
 * de acá, así el permiso de cada sección se escribe una sola vez. La portada
 * pide `orders.read`, que toda cuenta con contexto tiene: `get_pos_contexts`
 * no devuelve sucursales donde no lo tenga.
 */
export const posSections: readonly PosSection[] = [
  { path: '', label: 'Comandas', permission: 'orders.read', screen: CommandBoard },
  {
    path: 'salon',
    label: 'Salón',
    permission: 'floor.read',
    screen: FloorMap,
    subroutes: [{ path: 'salon/:tableId', screen: TableCommand }],
  },
  { path: 'mesas', label: 'Mesas activas', permission: 'floor.read', screen: ActiveTables },
  { path: 'historial', label: 'Historial', permission: 'history.read', screen: OrderHistory },
]
