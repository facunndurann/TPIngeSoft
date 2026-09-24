import { employeeEmail, employeeRequestSchema, type EmployeeRequest } from '../../../packages/shared/src/employees.ts'
import { AppError, type AppErrorBody, type AppErrorCode } from '../../../packages/shared/src/errors.ts'

export type ResetRequest = Extract<EmployeeRequest, { action: 'reset-password' }>
export type AccessRequest = Exclude<EmployeeRequest, ResetRequest>

export interface EmployeeGateway {
  authorize(input: EmployeeRequest): Promise<void>
  createAuth(email: string, password: string): Promise<string>
  deleteAuth(id: string): Promise<void>
  save(input: AccessRequest, userId: string): Promise<void>
  resetPassword(userId: string, password: string): Promise<void>
  auditReset(input: ResetRequest, completed: boolean): Promise<void>
}

/**
 * Textos de esta función para códigos genéricos del catálogo: el código es el
 * mismo que en el resto de las apps, pero acá se puede decir qué se rechazó.
 */
const messages: Partial<Record<AppErrorCode, string>> = {
  FORBIDDEN: 'No tenés permiso para modificar esta cuenta o alguna de sus membresías.',
  INVALID_REQUEST: 'Revisá los datos, roles y sucursales. La contraseña debe tener al menos 10 caracteres.',
  SERVER_ERROR: 'No pudimos guardar la cuenta. Reintentá.',
}
const fail = (code: AppErrorCode) => new AppError(code, messages[code])

/** Lo que tiran Auth, las RPCs o el parseo, traducido a un código del catálogo. */
function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error
  const message = error instanceof Error ? error.message : ''
  if (/AUTH_REQUIRED/.test(message)) return fail('AUTH_REQUIRED')
  if (/FORBIDDEN/.test(message)) return fail('FORBIDDEN')
  if (/already.*registered|already.*exists|duplicate key|USERNAME_TAKEN/i.test(message)) return fail('USERNAME_TAKEN')
  if (/INVALID_/.test(message) || error instanceof SyntaxError) return fail('INVALID_REQUEST')
  return fail('SERVER_ERROR')
}

const errorBody = ({ code, message }: AppError): AppErrorBody => ({ error: { code, message } })

export function createEmployeeHandler(authenticate: (jwt: string) => Promise<EmployeeGateway>, domain: string) {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS' }
  const response = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers })
  const errorResponse = (error: AppError) => response(errorBody(error), error.status)

  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (request.method !== 'POST') return errorResponse(fail('METHOD_NOT_ALLOWED'))
    try {
      const jwt = request.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1]
      if (!jwt) throw fail('AUTH_REQUIRED')
      const gateway = await authenticate(jwt)
      const body = await request.text()
      if (body.length > 16_384) throw fail('PAYLOAD_TOO_LARGE')
      const parsed = employeeRequestSchema.safeParse(JSON.parse(body))
      if (!parsed.success) throw fail('INVALID_REQUEST')
      const input = parsed.data
      await gateway.authorize(input) // Must precede every Auth Admin API call.
      if (input.action === 'reset-password') {
        await gateway.auditReset(input, false)
        await gateway.resetPassword(input.userId, input.password)
        await gateway.auditReset(input, true)
        return response({ userId: input.userId }, 200)
      }
      let createdId: string | undefined
      try {
        const userId = input.action === 'create'
          ? (createdId = await gateway.createAuth(employeeEmail(input.username, domain), input.password))
          : input.userId
        await gateway.save(input, userId)
        return response({ userId }, input.action === 'create' ? 201 : 200)
      } catch (error) {
        if (createdId) {
          try { await gateway.deleteAuth(createdId) }
          catch {
            // ID only: never log request bodies, JWTs, emails or passwords.
            console.error('EMPLOYEE_PROVISIONING_CLEANUP_REQUIRED', createdId)
            const cleanup = fail('PROVISIONING_CLEANUP_REQUIRED')
            return response({ ...errorBody(cleanup), reference: createdId }, cleanup.status)
          }
        }
        throw error
      }
    } catch (error) {
      return errorResponse(toAppError(error))
    }
  }
}
