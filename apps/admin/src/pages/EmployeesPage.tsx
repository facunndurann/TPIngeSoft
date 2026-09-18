import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Plus, Trash2, Users } from 'lucide-react'
import { useRestaurant } from '@/restaurant/restaurant-context'
import {
  loadPosAudit,
  loadPosEmployees,
  deletePosEmployee,
  savePosEmployee,
  type PosAuditEntry,
  type PosEmployee,
} from '@/features/pos/employees-api'
import { Badge, Button, EmptyState, ErrorText, Field, Input, Modal, Spinner, Toggle } from '@/components/ui'

const auditLabels: Record<string, string> = {
  'pos.unlocked': 'Ingresó al POS',
  'order.transition': 'Cambió el estado de una comanda',
  'session.closed': 'Cerró una sesión de mesa',
  'employee.created': 'Alta de empleado',
  'employee.updated': 'Edición de empleado',
  'employee.deleted': 'Baja de empleado',
}

export function EmployeesPage() {
  const restaurant = useRestaurant()
  const queryClient = useQueryClient()
  const [newName, setNewName] = useState('')
  const [newPin, setNewPin] = useState('')
  const [editing, setEditing] = useState<PosEmployee | null>(null)
  const [deleting, setDeleting] = useState<PosEmployee | null>(null)
  const [error, setError] = useState<string | null>(null)

  const employees = useQuery({
    queryKey: ['pos', restaurant.id, 'employees'],
    queryFn: () => loadPosEmployees(restaurant.id),
  })

  const audit = useQuery({
    queryKey: ['pos', restaurant.id, 'audit'],
    queryFn: () => loadPosAudit(restaurant.id),
    refetchInterval: 30000,
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['pos', restaurant.id, 'employees'] })
    void queryClient.invalidateQueries({ queryKey: ['pos', restaurant.id, 'audit'] })
  }

  const createMutation = useMutation({
    mutationFn: () =>
      savePosEmployee({ restaurantId: restaurant.id, fullName: newName, pin: newPin }),
    onSuccess: () => {
      setNewName('')
      setNewPin('')
      setError(null)
      invalidate()
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'No pudimos crear el empleado.'),
  })

  const toggleMutation = useMutation({
    mutationFn: (employee: PosEmployee) =>
      savePosEmployee({
        restaurantId: restaurant.id,
        employeeId: employee.id,
        fullName: employee.full_name,
        pin: null,
        isActive: !employee.is_active,
      }),
    onSuccess: () => {
      setError(null)
      invalidate()
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'No pudimos actualizar el empleado.'),
  })

  const deleteMutation = useMutation({
    mutationFn: (employee: PosEmployee) => deletePosEmployee(restaurant.id, employee.id),
    onSuccess: () => {
      setDeleting(null)
      setError(null)
      invalidate()
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'No pudimos eliminar el empleado.'),
  })

  function handleCreate(event: FormEvent) {
    event.preventDefault()
    setError(null)
    createMutation.mutate()
  }

  const employeeName = (entry: PosAuditEntry) => {
    const current = employees.data?.find((employee) => employee.id === entry.employee_id)?.full_name
    if (current) return current
    const snapshot = auditEmployeeName(entry.details)
    return snapshot ?? (entry.employee_id ? 'Empleado eliminado' : 'Administrador')
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">Empleados del POS</h1>
        <p className="text-sm text-neutral-500">
          Cada empleado desbloquea el POS con su PIN y sus acciones quedan registradas. Mientras no
          haya ninguno activo, el POS lo opera el administrador.
        </p>
      </div>

      <ErrorText message={error} />

      <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3 rounded-xl border border-neutral-200 bg-white p-4">
        <div className="min-w-48 flex-1">
          <Field label="Nombre">
            <Input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Ana Pérez"
              required
            />
          </Field>
        </div>
        <div className="w-40">
          <Field label="PIN (4 a 8 dígitos)">
            <Input
              value={newPin}
              onChange={(event) => setNewPin(event.target.value.replace(/\D/g, '').slice(0, 8))}
              inputMode="numeric"
              placeholder="1234"
              minLength={4}
              required
            />
          </Field>
        </div>
        <Button type="submit" disabled={createMutation.isPending || newPin.length < 4}>
          <Plus size={16} />
          {createMutation.isPending ? 'Agregando…' : 'Agregar'}
        </Button>
      </form>

      {employees.isLoading ? (
        <Spinner />
      ) : (employees.data?.length ?? 0) === 0 ? (
        <EmptyState message="Todavía no hay empleados con PIN. El POS lo opera el administrador." />
      ) : (
        <ul className="divide-y divide-neutral-200 overflow-hidden rounded-xl border border-neutral-200 bg-white">
          {employees.data?.map((employee) => (
            <li key={employee.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-2.5">
                <div className="rounded-lg bg-neutral-100 p-2 text-neutral-500">
                  <Users size={16} />
                </div>
                <div>
                  <p className="text-sm font-medium text-neutral-900">{employee.full_name}</p>
                  <p className="text-xs text-neutral-500">
                    {employee.is_active ? 'Puede operar el POS' : 'No puede operar el POS'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge color={employee.is_active ? 'green' : 'neutral'}>
                  {employee.is_active ? 'Activo' : 'Inactivo'}
                </Badge>
                <Toggle
                  checked={employee.is_active}
                  onChange={() => toggleMutation.mutate(employee)}
                  label="Habilitado"
                />
                <Button variant="secondary" onClick={() => { setError(null); setEditing(employee) }}>
                  <KeyRound size={15} />
                  Cambiar PIN
                </Button>
                <Button
                  variant="ghost"
                  className="text-red-600 hover:bg-red-50"
                  onClick={() => {
                    setError(null)
                    setDeleting(employee)
                  }}
                >
                  <Trash2 size={15} />
                  Eliminar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-neutral-700">Actividad reciente del POS</h2>
        {audit.isLoading ? (
          <Spinner />
        ) : (audit.data?.length ?? 0) === 0 ? (
          <EmptyState message="Todavía no hay actividad registrada." />
        ) : (
          <ul className="divide-y divide-neutral-200 overflow-hidden rounded-xl border border-neutral-200 bg-white text-sm">
            {audit.data?.map((entry) => (
              <AuditRow key={entry.id} entry={entry} employeeName={employeeName} />
            ))}
          </ul>
        )}
      </section>

      {editing && (
        <ChangePinModal
          employee={editing}
          restaurantId={restaurant.id}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            invalidate()
          }}
        />
      )}

      {deleting && (
        <Modal title={`Eliminar a ${deleting.full_name}`} onClose={() => setDeleting(null)}>
          <div className="space-y-4 text-sm text-neutral-700">
            <p>
              Esta persona dejará de poder ingresar al POS con su PIN. Su actividad anterior seguirá
              visible en la auditoría.
            </p>
            <p className="rounded-lg bg-red-50 px-3 py-2 text-red-800">
              Esta acción no se puede deshacer. Si solo querés bloquear temporalmente el acceso,
              desactivá “Habilitado”.
            </p>
            <ErrorText message={error} />
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => setDeleting(null)}
                disabled={deleteMutation.isPending}
              >
                Cancelar
              </Button>
              <Button
                variant="danger"
                className="flex-1"
                onClick={() => deleteMutation.mutate(deleting)}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? 'Eliminando…' : 'Eliminar empleado'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function AuditRow({
  entry,
  employeeName,
}: {
  entry: PosAuditEntry
  employeeName: (entry: PosAuditEntry) => string
}) {
  const when = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(entry.created_at),
  )
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 p-3">
      <span className="text-neutral-900">
        {employeeName(entry)} · {auditLabels[entry.action] ?? entry.action}
      </span>
      <span className="text-xs text-neutral-500">{when}</span>
    </li>
  )
}

function auditEmployeeName(details: unknown): string | null {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null
  const value = (details as Record<string, unknown>).employeeName
  return typeof value === 'string' && value.trim() ? value : null
}

function ChangePinModal({
  employee,
  restaurantId,
  onClose,
  onSaved,
}: {
  employee: PosEmployee
  restaurantId: string
  onClose: () => void
  onSaved: () => void
}) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      savePosEmployee({
        restaurantId,
        employeeId: employee.id,
        fullName: employee.full_name,
        pin,
        isActive: employee.is_active,
      }),
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof Error ? err.message : 'No pudimos cambiar el PIN.'),
  })

  return (
    <Modal title={`PIN de ${employee.full_name}`} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          setError(null)
          mutation.mutate()
        }}
      >
        <Field label="Nuevo PIN (4 a 8 dígitos)">
          <Input
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 8))}
            inputMode="numeric"
            autoFocus
            required
          />
        </Field>
        <ErrorText message={error} />
        <div className="flex gap-2">
          <Button variant="secondary" type="button" className="flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" className="flex-1" disabled={pin.length < 4 || mutation.isPending}>
            {mutation.isPending ? 'Guardando…' : 'Guardar PIN'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
