import { employeeEmail, employeeRoles, normalizeUsername, type EmployeeRole } from '../../../packages/shared/src/employees.ts'

export type EmployeeRequest = {
  action: 'create' | 'update' | 'reset-password'
  restaurantId: string
  userId?: string
  username?: string
  password?: string
  fullName?: string
  roles?: EmployeeRole[]
  branchIds?: string[]
  active?: boolean
  legacyId?: string
}
export interface EmployeeGateway {
  authorize(input: EmployeeRequest): Promise<void>
  createAuth(email: string, password: string): Promise<string>
  deleteAuth(id: string): Promise<void>
  save(input: EmployeeRequest, userId: string): Promise<void>
  resetPassword(userId: string, password: string): Promise<void>
  auditReset(input: EmployeeRequest, completed: boolean): Promise<void>
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function parseEmployeeRequest(value: unknown): EmployeeRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_REQUEST')
  const x = value as Record<string, unknown>
  const keys = ['action','restaurantId','userId','username','password','fullName','roles','branchIds','active','legacyId']
  if (Object.keys(x).some(k => !keys.includes(k)) || !['create','update','reset-password'].includes(String(x.action))
    || typeof x.restaurantId !== 'string' || !uuid.test(x.restaurantId)) throw new Error('INVALID_REQUEST')
  if (x.action !== 'create' && (typeof x.userId !== 'string' || !uuid.test(x.userId))) throw new Error('INVALID_REQUEST')
  if (x.action === 'create' && (x.userId !== undefined || typeof x.username !== 'string')) throw new Error('INVALID_REQUEST')
  if (x.action === 'create' || x.action === 'reset-password') {
    if (typeof x.password !== 'string' || x.password.length < 10 || x.password.length > 128) throw new Error('INVALID_PASSWORD')
  } else if (x.password !== undefined || x.username !== undefined) throw new Error('INVALID_REQUEST')
  if (x.action !== 'reset-password') {
    if (typeof x.fullName !== 'string' || !x.fullName.trim() || x.fullName.trim().length > 100
      || typeof x.active !== 'boolean'
      || !Array.isArray(x.roles) || !x.roles.length || x.roles.some(r => !employeeRoles.includes(r))
      || (x.roles.includes('manager') && x.roles.length > 1)
      || !Array.isArray(x.branchIds) || !x.branchIds.length || x.branchIds.some(b => typeof b !== 'string' || !uuid.test(b))
      || (x.legacyId !== undefined && (typeof x.legacyId !== 'string' || !uuid.test(x.legacyId)))) throw new Error('INVALID_REQUEST')
  }
  return { ...x, ...(x.username ? { username: normalizeUsername(x.username as string) } : {}) } as EmployeeRequest
}

export function createEmployeeHandler(authenticate: (jwt: string) => Promise<EmployeeGateway>, domain: string) {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS' }
  const response = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers })
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (request.method !== 'POST') return response({ error: 'METHOD_NOT_ALLOWED' }, 405)
    try {
      const jwt = request.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1]
      if (!jwt) return response({ error: 'AUTH_REQUIRED' }, 401)
      const gateway = await authenticate(jwt)
      const body = await request.text()
      if (body.length > 16_384) return response({ error: 'INVALID_REQUEST' }, 413)
      const input = parseEmployeeRequest(JSON.parse(body))
      await gateway.authorize(input) // Must precede every Auth Admin API call.
      if (input.action === 'reset-password') {
        await gateway.auditReset(input, false)
        await gateway.resetPassword(input.userId!, input.password!)
        await gateway.auditReset(input, true)
        return response({ userId: input.userId }, 200)
      }
      let createdId: string | undefined
      try {
        const userId = input.action === 'create'
          ? (createdId = await gateway.createAuth(employeeEmail(input.username!, domain), input.password!))
          : input.userId!
        await gateway.save(input, userId)
        return response({ userId }, input.action === 'create' ? 201 : 200)
      } catch (error) {
        if (createdId) {
          try { await gateway.deleteAuth(createdId) }
          catch {
            // ID only: never log request bodies, JWTs, emails or passwords.
            console.error('EMPLOYEE_PROVISIONING_CLEANUP_REQUIRED', createdId)
            return response({ error: 'PROVISIONING_CLEANUP_REQUIRED', reference: createdId }, 500)
          }
        }
        throw error
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (/AUTH_REQUIRED/.test(message)) return response({ error: 'AUTH_REQUIRED' }, 401)
      if (/FORBIDDEN/.test(message)) return response({ error: 'FORBIDDEN' }, 403)
      if (/already.*registered|already.*exists|duplicate key|USERNAME_TAKEN/i.test(message)) return response({ error: 'USERNAME_TAKEN' }, 409)
      if (/INVALID_|usuario debe|JSON/.test(message) || error instanceof SyntaxError) return response({ error: 'INVALID_REQUEST' }, 400)
      return response({ error: 'EMPLOYEE_OPERATION_FAILED' }, 500)
    }
  }
}
