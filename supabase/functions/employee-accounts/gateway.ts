import { AppError } from '../../../packages/shared/src/errors.ts'
import { unwrap } from '../../../packages/shared/src/supabase-client.ts'
import { adminClient, callerClient, verifiedUser } from '../_shared/clients.ts'
import type { EmployeeGateway } from './handler.ts'

/**
 * El `unwrap` de Auth Admin. Las RPCs levantan códigos del catálogo y `unwrap` los
 * traduce con `fromPostgres`; Auth Admin no, así que su falla es SERVER_ERROR y su
 * texto queda en `detail`, que nunca llega a la respuesta.
 */
function unwrapAuth({ error }: { error: { message: string } | null }) {
  if (error) throw new AppError('SERVER_ERROR', undefined, error.message)
}

export async function authenticateEmployees(
  url: string,
  anonKey: string,
  serviceKey: string,
  jwt: string,
): Promise<EmployeeGateway> {
  const user = await verifiedUser(callerClient(url, anonKey, jwt), jwt)
  // Las cuentas las administra el panel, no un comensal con sesión anónima.
  if (user.is_anonymous) throw new AppError('AUTH_REQUIRED')
  const actor = user.id
  const admin = adminClient(url, serviceKey)

  return {
    async authorize(input) {
      unwrap(await admin.rpc('authorize_employee_change', {
        p_actor: actor,
        p_restaurant: input.restaurantId,
        p_user: input.action === 'create' ? undefined : input.userId,
        p_roles: input.action === 'reset-password' ? [] : input.roles,
        p_global: input.action === 'reset-password',
      }))
    },
    async createAuth(email, password) {
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
      if (error) {
        // El usuario ya tomado llega como «already registered» solo cuando GoTrue
        // gana su chequeo previo; bajo concurrencia es un 500 opaco. Lo que
        // distingue los dos casos es si el email ya existe, y eso lo dice la base.
        const { data: taken } = await admin.rpc('employee_email_exists', { p_email: email })
        throw taken ? new AppError('USERNAME_TAKEN') : new AppError('SERVER_ERROR', undefined, error.message)
      }
      return data.user.id
    },
    async deleteAuth(id) {
      unwrapAuth(await admin.auth.admin.deleteUser(id))
    },
    async save(input, userId) {
      unwrap(await admin.rpc('save_employee_account', {
        p_actor: actor,
        p_restaurant: input.restaurantId,
        p_user: userId,
        p_full_name: input.fullName,
        p_roles: input.roles,
        p_branches: input.branchIds,
        p_active: input.active,
        p_username: input.action === 'create' ? input.username : undefined,
        p_legacy: input.legacyId,
      }))
    },
    async resetPassword(id, password) {
      unwrapAuth(await admin.auth.admin.updateUserById(id, { password }))
    },
    async auditReset(input, completed) {
      unwrap(await admin.rpc('audit_employee_password_reset', {
        p_actor: actor,
        p_restaurant: input.restaurantId,
        p_user: input.userId,
        p_completed: completed,
      }))
    },
  }
}
