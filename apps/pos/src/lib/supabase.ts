import { createSupabaseClient, isEmployeeEmailDomain } from '@restaurant-platform/shared'

export const supabase = createSupabaseClient({
  url: import.meta.env.VITE_SUPABASE_URL,
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  storageKey: 'restaurant-pos-auth',
  detectSessionInUrl: false,
})

const domain: string | undefined = import.meta.env.VITE_EMPLOYEE_EMAIL_DOMAIN

// Se revisa al arrancar, como la URL y la clave de arriba: sin dominio no puede
// ingresar nadie, y es mejor que se vea al abrir el POS que en el primer login.
if (!domain || !isEmployeeEmailDomain(domain)) {
  throw new Error('Falta VITE_EMPLOYEE_EMAIL_DOMAIN o no es un dominio válido (ver docs/SETUP.md)')
}

/** Dominio de las cuentas de empleados: el mismo EMPLOYEE_EMAIL_DOMAIN de employee-accounts. */
export const employeeEmailDomain: string = domain
