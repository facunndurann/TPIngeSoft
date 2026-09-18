import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Plus, Users } from 'lucide-react'
import { useRestaurant } from '@/restaurant/restaurant-context'
import {
  loadPosAudit,
  loadPosEmployees,
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
}

export function EmployeesPage() {
  const restaurant = useRestaurant()
  const queryClient = useQueryClient()
  const [newName, setNewName] = useState('')
  const [newPin, setNewPin] = useState('')
  const [editing, setEditing] = useState<PosEmployee | null>(null)
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

  function handleCreate(event: FormEvent) {
    event.preventDefault()
    setError(null)
    createMutation.mutate()
  }

  const employeeName = (id: string | null) =>
    employees.data?.find((employee) => employee.id === id)?.full_name ?? 'Administrador'

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
    </div>
  )
}

function AuditRow({
  entry,
  employeeName,
}: {
  entry: PosAuditEntry
  employeeName: (id: string | null) => string
}) {
  const when = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(entry.created_at),
  )
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 p-3">
      <span className="text-neutral-900">
        {employeeName(entry.employee_id)} · {auditLabels[entry.action] ?? entry.action}
      </span>
      <span className="text-xs text-neutral-500">{when}</span>
    </li>
  )
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
