import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { employeeRoles, employeeRoleLabels, type EmployeeRole } from '@restaurant-platform/shared'
import { useMembership } from '@/restaurant/restaurant-context'
import { supabase } from '@/lib/supabase'
import { auditActorLabel, changeEmployee, loadEmployees, type Employee } from '@/features/employees/api'
import { Badge, Button, ErrorText, Field, Input, Modal, Select, Spinner } from '@/components/ui'

export function EmployeesPage() {
  const { restaurant, role } = useMembership()
  const qc = useQueryClient()
  const [editing, setEditing] = useState<Employee | 'new' | null>(null)
  const [resetting, setResetting] = useState<Employee | null>(null)
  const [password, setPassword] = useState('')
  const employees = useQuery({ queryKey: ['employees', restaurant.id], queryFn: () => loadEmployees(restaurant.id) })
  const audit = useQuery({
    queryKey: ['employee-audit', restaurant.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('pos_audit_log').select('*, legacy_employee:pos_employees(full_name)').eq('restaurant_id', restaurant.id).order('created_at', { ascending: false }).limit(100)
      if (error) throw error
      return data
    },
    refetchInterval: 30000,
  })
  function invalidate() {
    void qc.invalidateQueries({ queryKey: ['employees'] })
    void qc.invalidateQueries({ queryKey: ['employee-audit'] })
    void qc.invalidateQueries({ queryKey: ['legacy-employees'] })
  }
  const reset = useMutation({
    mutationFn: () => changeEmployee({ action: 'reset-password', restaurantId: restaurant.id, userId: resetting!.user_id, password }),
    onSuccess: () => { setResetting(null); setPassword(''); invalidate() },
  })
  return <div className="space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-xl font-bold">Empleados</h1><p className="text-sm text-neutral-500">Cuentas personales, permisos y sucursales de trabajo.</p></div>
      <Button onClick={() => setEditing('new')}>Agregar empleado</Button>
    </header>
    {employees.isError && <ErrorText message="No pudimos cargar los empleados." />}
    {employees.isPending ? <Spinner /> : <ul className="divide-y rounded-xl bg-white">
      {employees.data?.map(e => <li key={e.user_id} className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div><p className="font-medium">{e.full_name} <span className="text-neutral-500">@{e.username}</span></p><p className="text-sm text-neutral-500">{e.roles.map(r => employeeRoleLabels[r as EmployeeRole] ?? r).join(' · ')}</p></div>
        <div className="flex items-center gap-2"><Badge color={e.is_active ? 'green' : 'neutral'}>{e.is_active ? 'Habilitado' : 'Desactivado'}</Badge>
          <Button variant="secondary" onClick={() => setEditing(e)}>Editar acceso</Button>
          <Button variant="secondary" onClick={() => { setPassword(''); reset.reset(); setResetting(e) }}>Restablecer contraseña</Button>
        </div>
      </li>)}
      {!employees.data?.length && <li className="p-4 text-neutral-500">Todavía no hay cuentas de empleados.</li>}
    </ul>}
    <section className="space-y-3">
      <h2 className="font-semibold">Auditoría POS</h2>
      {audit.isError && <ErrorText message="No pudimos cargar la auditoría." />}
      <ul className="divide-y rounded-xl bg-white text-sm">{audit.data?.map(e => {
        const details = e.details && typeof e.details === 'object' && !Array.isArray(e.details) ? e.details : {}
        const actor = auditActorLabel(e, employees.data ?? [])
        const subject = typeof details.fullName === 'string' ? details.fullName : null
        return <li key={e.id} className="p-3"><p>{actor} · {e.action}{subject ? ` · ${subject}` : ''}</p><p className="text-xs text-neutral-500">{new Date(e.created_at).toLocaleString('es-AR')}{e.branch_id ? ` · Sucursal ${e.branch_id.slice(0, 8)}` : ''}</p></li>
      })}</ul>
    </section>
    {editing && <EmployeeForm key={editing === 'new' ? 'new' : editing.user_id} employee={editing === 'new' ? null : editing} restaurantId={restaurant.id} owner={role === 'owner'} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); invalidate() }} />}
    {resetting && <Modal title={`Restablecer contraseña de ${resetting.full_name}`} onClose={() => { setResetting(null); setPassword('') }}>
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); reset.mutate() }}>
        <Field label="Nueva contraseña"><Input type="password" autoComplete="new-password" minLength={10} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} required /></Field>
        <p className="text-sm text-neutral-500">La contraseña cambia para todos los restaurantes de esta cuenta.</p>
        <ErrorText message={reset.error?.message ?? null} /><Button disabled={reset.isPending}>Restablecer</Button>
      </form>
    </Modal>}
  </div>
}

function EmployeeForm({ employee, restaurantId, owner, onClose, onSaved }: {
  employee: Employee | null; restaurantId: string; owner: boolean; onClose: () => void; onSaved: () => void
}) {
  const [fullName, setFullName] = useState(employee?.full_name ?? '')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [roles, setRoles] = useState<EmployeeRole[]>(employee?.roles.filter((r): r is EmployeeRole => employeeRoles.includes(r as EmployeeRole)) ?? ['waiter'])
  const [branchIds, setBranchIds] = useState<string[]>(employee?.branch_ids ?? [])
  const [active, setActive] = useState(employee?.is_active ?? true)
  const [legacyId, setLegacyId] = useState('')
  const [existingId, setExistingId] = useState('')
  const branches = useQuery({
    queryKey: ['branches', restaurantId],
    queryFn: async () => { const { data, error } = await supabase.from('branches').select('id,name').eq('restaurant_id', restaurantId).eq('is_active', true); if (error) throw error; return data },
  })
  const legacy = useQuery({
    queryKey: ['legacy-employees', restaurantId],
    queryFn: async () => { const { data, error } = await supabase.from('pos_employees').select('id,full_name').eq('restaurant_id', restaurantId).is('migrated_user_id', null); if (error) throw error; return data },
  })
  const accounts = useQuery({
    queryKey: ['managed-accounts'],
    queryFn: async () => { const { data, error } = await supabase.from('profiles').select('id,full_name,username_normalized'); if (error) throw error; return data },
    enabled: !employee,
  })
  const save = useMutation({
    mutationFn: () => changeEmployee({
      action: employee || existingId ? 'update' : 'create', restaurantId,
      ...(employee || existingId ? { userId: employee?.user_id ?? existingId } : { username, password }),
      fullName, roles, branchIds, active, ...(legacyId ? { legacyId } : {}),
    }),
    onSuccess: onSaved,
  })
  return <Modal title={employee ? 'Editar empleado' : 'Agregar empleado'} onClose={onClose}>
    <form className="space-y-4" onSubmit={e => { e.preventDefault(); save.mutate() }}>
      {!employee && <Field label="Cuenta"><Select value={existingId} onChange={e => { setExistingId(e.target.value); const p = accounts.data?.find(p => p.id === e.target.value); if (p) setFullName(p.full_name) }}>
        <option value="">Crear cuenta nueva</option>{accounts.data?.map(p => <option key={p.id} value={p.id}>Vincular: {p.full_name} (@{p.username_normalized})</option>)}
      </Select></Field>}
      <Field label="Nombre visible"><Input value={fullName} onChange={e => setFullName(e.target.value)} required maxLength={100} /></Field>
      {!employee && !existingId && <>
        <Field label="Usuario global"><Input autoComplete="off" value={username} onChange={e => setUsername(e.target.value)} minLength={3} maxLength={32} required /></Field>
        <Field label="Contraseña inicial"><Input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} minLength={10} maxLength={128} required /></Field>
      </>}
      <fieldset><legend className="mb-2 text-sm font-medium">Roles</legend><div className="flex flex-wrap gap-3">
        {employeeRoles.filter(r => owner || r !== 'manager').map(r => <label key={r} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={roles.includes(r)} onChange={e => setRoles(e.target.checked ? r === 'manager' ? ['manager'] : [...roles.filter(x => x !== 'manager'), r] : roles.filter(x => x !== r))} />{employeeRoleLabels[r]}</label>)}
      </div></fieldset>
      <fieldset><legend className="mb-2 text-sm font-medium">Sucursales habilitadas</legend><div className="flex flex-wrap gap-3">
        {branches.data?.map(b => <label key={b.id} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={branchIds.includes(b.id)} onChange={e => setBranchIds(e.target.checked ? [...branchIds, b.id] : branchIds.filter(id => id !== b.id))} />{b.name}</label>)}
      </div></fieldset>
      {legacy.data && legacy.data.length > 0 && <Field label="Vincular registro de empleado anterior (opcional)"><Select value={legacyId} onChange={e => setLegacyId(e.target.value)}><option value="">Sin vincular</option>{legacy.data.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}</Select></Field>}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />Acceso habilitado en este restaurante</label>
      <p className="text-xs text-neutral-500">Desactivar conserva la cuenta y su historial. El nombre es compartido por todos sus restaurantes.</p>
      <ErrorText message={save.error?.message ?? (branches.isError || legacy.isError || accounts.isError ? 'No pudimos cargar los datos del formulario.' : null)} />
      <Button disabled={save.isPending || !roles.length || !branchIds.length}>{save.isPending ? 'Guardando…' : 'Guardar'}</Button>
    </form>
  </Modal>
}
