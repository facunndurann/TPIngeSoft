import { authenticateEmployees } from './gateway.ts'
import { createEmployeeHandler } from './handler.ts'

const url = Deno.env.get('SUPABASE_URL')!
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const domain = Deno.env.get('EMPLOYEE_EMAIL_DOMAIN')
if (!url || !anonKey || !serviceKey || !domain) throw new Error('Missing employee account configuration')
Deno.serve(createEmployeeHandler(jwt => authenticateEmployees(url, anonKey, serviceKey, jwt), domain))
