import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../../packages/shared/src/database.types.ts'
import type { EmployeeGateway } from './handler.ts'

export async function authenticateEmployees(url: string, anonKey: string, serviceKey: string, jwt: string): Promise<EmployeeGateway> {
  const caller = createClient<Database>(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await caller.auth.getUser(jwt)
  if (error || !data.user || data.user.is_anonymous) throw new Error('AUTH_REQUIRED')
  const actor = data.user.id
  const admin = createClient<Database>(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const check = (error: { message: string } | null) => { if (error) throw new Error(error.message) }
  return {
    async authorize(input) {
      const { error } = await admin.rpc('authorize_employee_change', {
        p_actor: actor, p_restaurant: input.restaurantId, p_user: input.userId,
        p_roles: input.roles ?? [], p_global: input.action === 'reset-password',
      })
      check(error)
    },
    async createAuth(email, password) {
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
      if (error) {
        // El username ya tomado sólo llega como "already registered" cuando GoTrue
        // gana su chequeo previo; bajo concurrencia devuelve un 500 opaco. El dato
        // queda igual de protegido por el índice único: falta nombrar bien el error.
        const { data: taken } = await admin.rpc('employee_email_exists', { p_email: email })
        throw new Error(taken ? 'USERNAME_TAKEN' : error.message)
      }
      if (!data.user) throw new Error('AUTH_CREATE_FAILED')
      return data.user.id
    },
    async deleteAuth(id) { const { error } = await admin.auth.admin.deleteUser(id); check(error) },
    async save(input, userId) {
      const { error } = await admin.rpc('save_employee_account', {
        p_actor: actor, p_restaurant: input.restaurantId, p_user: userId,
        p_full_name: input.fullName!, p_roles: input.roles!, p_branches: input.branchIds!,
        p_active: input.active!, p_username: input.username, p_legacy: input.legacyId,
      })
      check(error)
    },
    async resetPassword(id, password) { const { error } = await admin.auth.admin.updateUserById(id, { password }); check(error) },
    async auditReset(input, completed) {
      const { error } = await admin.rpc('audit_employee_password_reset', {
        p_actor: actor, p_restaurant: input.restaurantId, p_user: input.userId!, p_completed: completed,
      })
      check(error)
    },
  }
}
