import { FunctionsHttpError } from '@supabase/supabase-js'
import { AppError, appErrorBodySchema, isAppErrorCode } from './errors.ts'
import type { AppSupabaseClient } from './supabase-client.ts'

/** Lo único que hace falta de un schema de zod para validar una respuesta. */
export type ResponseSchema<T> = {
  safeParse: (data: unknown) => { success: true; data: T } | { success: false }
}

type InvokeOptions = {
  /** Llegó una respuesta exitosa que no se puede leer. */
  unreadable?: AppError
  /** La respuesta no llegó, o llegó un error ilegible. */
  unreachable?: AppError
}

/**
 * Llama a una Edge Function y devuelve su respuesta validada. Hay tres salidas de
 * error, y solo la primera es un rechazo:
 * - el servidor respondió con un error: vuelve su código y su mensaje, que el
 *   servidor ya eligió del catálogo o escribió para ese caso;
 * - la respuesta no llegó, o llegó un error ilegible: `unreachable`;
 * - llegó una respuesta exitosa que no se puede leer: `unreadable`.
 * Las dos últimas las elige cada llamada, porque de eso depende qué conviene
 * hacer después (reintentar lo mismo, revisar si se aplicó, etc.).
 */
export async function invokeFunction<T>(
  client: AppSupabaseClient,
  name: string,
  body: object,
  schema: ResponseSchema<T>,
  {
    unreadable = new AppError('SERVER_ERROR'),
    unreachable = new AppError('CONNECTION_ERROR'),
  }: InvokeOptions = {},
): Promise<T> {
  const { data, error } = await client.functions.invoke<unknown>(name, { body })

  if (error) {
    if (error instanceof FunctionsHttpError) {
      const rejection = appErrorBodySchema.safeParse(await error.context.json().catch(() => null))
      if (rejection.success) {
        const { code, message } = rejection.data.error
        throw new AppError(isAppErrorCode(code) ? code : 'SERVER_ERROR', message)
      }
    }
    throw unreachable
  }

  const result = schema.safeParse(data)
  if (!result.success) throw unreadable
  return result.data
}
