import { employeeEmail, employeeRequestSchema, type EmployeeRequest } from '../../../packages/shared/src/employees.ts'
import { AppError } from '../../../packages/shared/src/errors.ts'
import { errorBody, postHandler, reply } from '../_shared/http.ts'

export type ResetRequest = Extract<EmployeeRequest, { action: 'reset-password' }>
export type AccessRequest = Exclude<EmployeeRequest, ResetRequest>

/** Auth y las RPCs de cuentas. Lo que falla sale como AppError del catálogo. */
export interface EmployeeGateway {
  authorize(input: EmployeeRequest): Promise<void>
  createAuth(email: string, password: string): Promise<string>
  deleteAuth(id: string): Promise<void>
  save(input: AccessRequest, userId: string): Promise<void>
  resetPassword(userId: string, password: string): Promise<void>
  auditReset(input: ResetRequest, completed: boolean): Promise<void>
}

export function createEmployeeHandler(authenticate: (jwt: string) => Promise<EmployeeGateway>, domain: string) {
  return postHandler({
    schema: employeeRequestSchema,
    maxBytes: 16 * 1024,
    authenticate,
    messages: {
      FORBIDDEN: 'No tenés permiso para modificar esta cuenta o alguna de sus membresías.',
      INVALID_REQUEST: 'Revisá los datos, roles y sucursales. La contraseña debe tener al menos 10 caracteres.',
      SERVER_ERROR: 'No pudimos guardar la cuenta. Reintentá.',
    },
    run: async (input, gateway) => {
      await gateway.authorize(input) // Must precede every Auth Admin API call.

      if (input.action === 'reset-password') {
        // El pedido se audita antes del cambio: si el cambio falla, queda ese registro.
        await gateway.auditReset(input, false)
        await gateway.resetPassword(input.userId, input.password)
        await gateway.auditReset(input, true)
        return reply({ userId: input.userId })
      }

      if (input.action === 'update') {
        // La cuenta ya existía: si guardar falla, no hay nada que deshacer en Auth.
        await gateway.save(input, input.userId)
        return reply({ userId: input.userId })
      }

      // Alta: primero el usuario de Auth y después la membresía. Si la membresía
      // falla, el usuario recién creado se borra para que reintentar no choque con él.
      const userId = await gateway.createAuth(employeeEmail(input.username, domain), input.password)
      try {
        await gateway.save(input, userId)
      } catch (error) {
        try {
          await gateway.deleteAuth(userId)
        } catch {
          // ID only: never log request bodies, JWTs, emails or passwords.
          console.error('EMPLOYEE_PROVISIONING_CLEANUP_REQUIRED', userId)
          const cleanup = new AppError('PROVISIONING_CLEANUP_REQUIRED')
          // La referencia es lo que soporte necesita para terminar la limpieza a mano.
          return reply({ ...errorBody(cleanup), reference: userId }, cleanup.status)
        }
        throw error
      }
      return reply({ userId }, 201)
    },
  })
}
