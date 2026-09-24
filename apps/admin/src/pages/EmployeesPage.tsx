import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  employeeRoleLabels,
  employeeRoles,
  isEmployeeRole,
  memberRoleLabels,
  toggleRole,
  type EmployeeRequest,
  type EmployeeRole,
} from '@restaurant-platform/shared'
import { Badge, Button, ErrorText, Field, Input, Modal, Select, Spinner } from '@restaurant-platform/ui'
import { Page } from '@/features/Page'
import { auditActionLabel, auditActorLabel } from '@/features/employees/audit'
import { branchesQuery } from '@/queries/branches'
import {
  changeEmployee,
  employeeAuditQuery,
  employeesKey,
  employeesQuery,
  legacyEmployeesQuery,
  linkableAccountsQuery,
  type Employee,
} from '@/queries/employees'
import { useMembership } from '@/restaurant/restaurant-context'

export function EmployeesPage() {
  const { restaurant, role } = useMembership()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<Employee | 'new' | null>(null)
  const [resetting, setResetting] = useState<Employee | null>(null)

  const employees = useQuery(employeesQuery(restaurant.id))

  const invalidate = () => queryClient.invalidateQueries({ queryKey: employeesKey(restaurant.id) })

  return (
    <Page
      title="Empleados"
      description="Cuentas personales, permisos y sucursales de trabajo."
      actions={<Button onClick={() => setEditing('new')}>Agregar empleado</Button>}
    >
      {employees.isError && <ErrorText error="No pudimos cargar los empleados." />}
      {employees.isPending ? (
        <Spinner />
      ) : (
        <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white">
          {employees.data?.map((employee) => (
            <li
              key={employee.user_id}
              className="flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <div>
                <p className="font-medium">
                  {employee.full_name}{' '}
                  <span className="text-muted">@{employee.username}</span>
                </p>
                <p className="text-sm text-muted">
                  {employee.roles.map((memberRole) => memberRoleLabels[memberRole]).join(' · ')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge color={employee.is_active ? 'green' : 'neutral'}>
                  {employee.is_active ? 'Habilitado' : 'Desactivado'}
                </Badge>
                <Button variant="secondary" onClick={() => setEditing(employee)}>
                  Editar acceso
                </Button>
                <Button variant="secondary" onClick={() => setResetting(employee)}>
                  Restablecer contraseña
                </Button>
              </div>
            </li>
          ))}
          {!employees.data?.length && (
            <li className="p-4 text-muted">Todavía no hay cuentas de empleados.</li>
          )}
        </ul>
      )}

      <AuditLog restaurantId={restaurant.id} employees={employees.data ?? []} />

      {editing && (
        <EmployeeForm
          key={editing === 'new' ? 'new' : editing.user_id}
          employee={editing === 'new' ? null : editing}
          restaurantId={restaurant.id}
          owner={role === 'owner'}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void invalidate()
          }}
        />
      )}
      {resetting && (
        <ResetPasswordModal
          employee={resetting}
          restaurantId={restaurant.id}
          onClose={() => setResetting(null)}
          onSaved={() => {
            setResetting(null)
            void invalidate()
          }}
        />
      )}
    </Page>
  )
}

function AuditLog({ restaurantId, employees }: { restaurantId: string; employees: Employee[] }) {
  const audit = useQuery(employeeAuditQuery(restaurantId))
  // La misma consulta de sucursales que el resto del panel: el nombre, no el id.
  const branches = useQuery(branchesQuery(restaurantId))
  const branchNames = new Map(branches.data?.map((branch) => [branch.id, branch.name]))

  return (
    <section className="space-y-3">
      <h2 className="font-semibold">Auditoría POS</h2>
      {audit.isError && <ErrorText error="No pudimos cargar la auditoría." />}
      <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white text-sm">
        {audit.data?.map((entry) => {
          // Una sucursal que ya no está (o que todavía no cargó) no se nombra:
          // mejor nada que un pedazo de id.
          const branch = entry.branch_id ? branchNames.get(entry.branch_id) : undefined
          return (
            <li key={entry.id} className="p-3">
              <p>
                {auditActorLabel(entry, employees)} · {auditActionLabel(entry, employees)}
              </p>
              <p className="text-xs text-muted">
                {new Date(entry.created_at).toLocaleString('es-AR')}
                {branch ? ` · ${branch}` : ''}
              </p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function EmployeeForm({
  employee,
  restaurantId,
  owner,
  onClose,
  onSaved,
}: {
  employee: Employee | null
  restaurantId: string
  owner: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [fullName, setFullName] = useState(employee?.full_name ?? '')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  // Owner y staff no se asignan desde el panel: el formulario edita solo roles de empleado.
  const [roles, setRoles] = useState<EmployeeRole[]>(employee?.roles.filter(isEmployeeRole) ?? ['waiter'])
  const [branchIds, setBranchIds] = useState<string[]>(employee?.branch_ids ?? [])
  const [active, setActive] = useState(employee?.is_active ?? true)
  const [legacyId, setLegacyId] = useState('')
  const [existingId, setExistingId] = useState('')
  // Cualquier campo que el usuario toque dispara `change` y sube hasta el <form>:
  // con eso alcanza para saber si cerrar descartaría algo, sin comparar ocho estados.
  const [edited, setEdited] = useState(false)

  // La misma consulta de sucursales que el resto del panel; acá solo se ofrecen las activas.
  const branches = useQuery({
    ...branchesQuery(restaurantId),
    select: (all) => all.filter((branch) => branch.is_active),
  })
  const legacy = useQuery(legacyEmployeesQuery(restaurantId))
  const accounts = useQuery({ ...linkableAccountsQuery(restaurantId), enabled: !employee })

  /** Una cuenta que ya existe (la que se edita o una vinculada) se actualiza; si no, se crea. */
  function request(): EmployeeRequest {
    const access = { restaurantId, fullName, roles, branchIds, active, legacyId: legacyId || undefined }
    const userId = employee?.user_id ?? existingId
    return userId
      ? { action: 'update', userId, ...access }
      : { action: 'create', username, password, ...access }
  }

  const save = useMutation({ mutationFn: () => changeEmployee(request()), onSuccess: onSaved })

  function linkAccount(id: string) {
    setExistingId(id)
    const account = accounts.data?.find((entry) => entry.id === id)
    if (account) setFullName(account.full_name)
  }

  const loadFailed = branches.isError || legacy.isError || accounts.isError

  return (
    <Modal
      title={employee ? 'Editar empleado' : 'Agregar empleado'}
      onClose={onClose}
      hasUnsavedChanges={edited}
    >
      <form
        className="space-y-4"
        onChange={() => setEdited(true)}
        onSubmit={(event) => {
          event.preventDefault()
          save.mutate()
        }}
      >
        {!employee && (
          <Field label="Cuenta">
            <Select value={existingId} onChange={(event) => linkAccount(event.target.value)}>
              <option value="">Crear cuenta nueva</option>
              {accounts.data?.map((account) => (
                <option key={account.id} value={account.id}>
                  Vincular: {account.full_name} (@{account.username_normalized})
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Nombre visible">
          <Input
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            required
            maxLength={100}
          />
        </Field>
        {!employee && !existingId && (
          <>
            <Field label="Usuario global">
              <Input
                autoComplete="off"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                minLength={3}
                maxLength={32}
                required
              />
            </Field>
            <Field label="Contraseña inicial">
              <Input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={10}
                maxLength={128}
                required
              />
            </Field>
          </>
        )}
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Roles</legend>
          <div className="flex flex-wrap gap-3">
            {/* Solo el dueño puede nombrar gestores. */}
            {employeeRoles
              .filter((employeeRole) => owner || employeeRole !== 'manager')
              .map((employeeRole) => (
                <label key={employeeRole} className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={roles.includes(employeeRole)}
                    onChange={(event) => setRoles(toggleRole(roles, employeeRole, event.target.checked))}
                  />
                  {employeeRoleLabels[employeeRole]}
                </label>
              ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Sucursales habilitadas</legend>
          <div className="flex flex-wrap gap-3">
            {branches.data?.map((branch) => (
              <label key={branch.id} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={branchIds.includes(branch.id)}
                  onChange={(event) =>
                    setBranchIds(
                      event.target.checked
                        ? [...branchIds, branch.id]
                        : branchIds.filter((id) => id !== branch.id),
                    )
                  }
                />
                {branch.name}
              </label>
            ))}
          </div>
        </fieldset>
        {legacy.data && legacy.data.length > 0 && (
          <Field label="Vincular registro de empleado anterior (opcional)">
            <Select value={legacyId} onChange={(event) => setLegacyId(event.target.value)}>
              <option value="">Sin vincular</option>
              {legacy.data.map((legacyEmployee) => (
                <option key={legacyEmployee.id} value={legacyEmployee.id}>
                  {legacyEmployee.full_name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
          Acceso habilitado en este restaurante
        </label>
        <p className="text-xs text-muted">
          Desactivar conserva la cuenta y su historial. El nombre es compartido por todos sus
          restaurantes.
        </p>
        <ErrorText error={save.error ?? (loadFailed ? 'No pudimos cargar los datos del formulario.' : null)} />
        <Button disabled={save.isPending || !roles.length || !branchIds.length}>
          {save.isPending ? 'Guardando…' : 'Guardar'}
        </Button>
      </form>
    </Modal>
  )
}

function ResetPasswordModal({
  employee,
  restaurantId,
  onClose,
  onSaved,
}: {
  employee: Employee
  restaurantId: string
  onClose: () => void
  onSaved: () => void
}) {
  // Vive lo que vive el modal: cerrarlo descarta la contraseña y el error.
  const [password, setPassword] = useState('')
  const reset = useMutation({
    mutationFn: () =>
      changeEmployee({ action: 'reset-password', restaurantId, userId: employee.user_id, password }),
    onSuccess: onSaved,
  })

  return (
    <Modal
      title={`Restablecer contraseña de ${employee.full_name}`}
      onClose={onClose}
      hasUnsavedChanges={password !== ''}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          reset.mutate()
        }}
      >
        <Field label="Nueva contraseña">
          <Input
            type="password"
            autoComplete="new-password"
            minLength={10}
            maxLength={128}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </Field>
        <p className="text-sm text-muted">
          La contraseña cambia para todos los restaurantes de esta cuenta.
        </p>
        <ErrorText error={reset.error} fallback="No pudimos restablecer la contraseña." />
        <Button disabled={reset.isPending}>Restablecer</Button>
      </form>
    </Modal>
  )
}
