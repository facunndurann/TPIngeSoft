import { useId, useState } from 'react'
import { flushSync } from 'react-dom'
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
import { Badge, Button, ErrorText, Field, Input, Modal, QueryView, Select, useToast } from '@restaurant-platform/ui'
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
  const toast = useToast()
  const [editing, setEditing] = useState<Employee | 'new' | null>(null)
  const [resetting, setResetting] = useState<Employee | null>(null)

  const employees = useQuery(employeesQuery(restaurant.id))

  const invalidate = () => queryClient.invalidateQueries({ queryKey: employeesKey(restaurant.id) })

  return (
    <Page
      title="Empleados"
      actions={<Button onClick={() => setEditing('new')}>Agregar empleado</Button>}
    >
      <QueryView query={employees} fallback="No pudimos cargar los empleados.">
        {(employees) => (
          <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white">
            {employees.map((employee) => (
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
            {employees.length === 0 && (
              <li className="p-4 text-muted">Todavía no hay cuentas de empleados.</li>
            )}
          </ul>
        )}
      </QueryView>

      <AuditLog restaurantId={restaurant.id} employees={employees.data ?? []} />

      {editing && (
        <EmployeeForm
          key={editing === 'new' ? 'new' : editing.user_id}
          employee={editing === 'new' ? null : editing}
          restaurantId={restaurant.id}
          owner={role === 'owner'}
          onClose={() => setEditing(null)}
          // El modal se cierra al guardar: sin el aviso, no queda señal de que salió.
          onSaved={(name) => {
            toast(editing === 'new' ? `Agregamos a ${name} al equipo.` : `Guardamos los cambios de ${name}.`)
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
            toast(`Restablecimos la contraseña de ${resetting.full_name}.`)
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
      <QueryView query={audit} fallback="No pudimos cargar la auditoría.">
        {(audit) => (
          <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white text-sm">
            {audit.map((entry) => {
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
        )}
      </QueryView>
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
  /** Guardado: recibe el nombre visible, para el aviso. */
  onSaved: (name: string) => void
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

  const save = useMutation({ mutationFn: () => changeEmployee(request()), onSuccess: () => onSaved(fullName.trim()) })

  // Roles y sucursales no los cubre la validación del navegador (son casillas
  // sueltas): se revisan al guardar y el motivo queda debajo de cada grupo, en vez
  // de un «Guardar» apagado que no dice por qué. Igual que el formulario de producto.
  const rolesId = useId()
  const branchesId = useId()
  const [attempted, setAttempted] = useState(false)
  const missing: { roles?: string; branches?: string } = {
    roles: roles.length === 0 ? 'Elegí al menos un rol.' : undefined,
    branches: branchIds.length === 0 ? 'Elegí al menos una sucursal donde trabaja.' : undefined,
  }
  const shown: typeof missing = attempted ? missing : {}

  function submit() {
    const firstMissing = missing.roles ? rolesId : missing.branches ? branchesId : null
    if (!firstMissing) {
      save.mutate()
      return
    }
    // El error tiene que estar en el DOM antes del foco, así se anuncia con el grupo.
    flushSync(() => setAttempted(true))
    document.getElementById(firstMissing)?.focus()
  }

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
          submit()
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
            <Field
              label="Usuario global"
              hint="De 3 a 32 caracteres: letras, números, puntos, guiones o guiones bajos."
            >
              <Input
                autoComplete="off"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                minLength={3}
                maxLength={32}
                required
              />
            </Field>
            <Field label="Contraseña inicial" hint="Mínimo 10 caracteres.">
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
        <fieldset
          id={rolesId}
          tabIndex={-1}
          aria-describedby={shown.roles ? `${rolesId}-error` : undefined}
          className="rounded-lg"
        >
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
          {shown.roles && (
            <p id={`${rolesId}-error`} className="mt-1 text-xs text-red-700">
              {shown.roles}
            </p>
          )}
        </fieldset>
        <fieldset
          id={branchesId}
          tabIndex={-1}
          aria-describedby={shown.branches ? `${branchesId}-error` : undefined}
          className="rounded-lg"
        >
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
          {shown.branches && (
            <p id={`${branchesId}-error`} className="mt-1 text-xs text-red-700">
              {shown.branches}
            </p>
          )}
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
        <ErrorText error={save.error ?? (loadFailed ? 'No pudimos cargar los datos del formulario.' : null)} />
        <Button disabled={save.isPending}>{save.isPending ? 'Guardando…' : 'Guardar'}</Button>
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
        <Field label="Nueva contraseña" hint="Mínimo 10 caracteres.">
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
        <ErrorText error={reset.error} fallback="No pudimos restablecer la contraseña." />
        <Button disabled={reset.isPending}>Restablecer</Button>
      </form>
    </Modal>
  )
}
