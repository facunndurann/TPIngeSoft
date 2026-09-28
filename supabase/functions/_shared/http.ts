import { AppError, type AppErrorBody, type AppErrorCode } from '../../../packages/shared/src/errors.ts'

/**
 * Lo único que hace falta de un schema de zod para validar el cuerpo. Es
 * estructural para que este módulo no dependa de zod: cada función trae su
 * schema de packages/shared.
 */
export type BodySchema<T> = {
  safeParse: (data: unknown) => { success: true; data: T } | { success: false }
}

/** Respuesta de la lógica de una función: el cuerpo y su status. */
export type Reply = { body: unknown; status: number }

export const reply = (body: unknown, status = 200): Reply => ({ body, status })

type PostHandlerOptions<Input, Gateway> = {
  /** Lo que no valide es INVALID_REQUEST. */
  schema: BodySchema<Input>
  /** Tope del cuerpo en bytes, no en caracteres. */
  maxBytes: number
  /** Verifica el JWT y devuelve el acceso a datos de quien llama, o tira AUTH_REQUIRED. */
  authenticate: (jwt: string) => Promise<Gateway>
  /** La lógica de la función, con el cuerpo validado y la identidad verificada. */
  run: (input: Input, gateway: Gateway) => Promise<Reply>
  /**
   * Textos propios de la función para códigos genéricos del catálogo: el código
   * es el mismo que en el resto de las apps, pero acá se puede decir qué se rechazó.
   */
  messages?: Partial<Record<AppErrorCode, string>>
}

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } })

/** Cuerpo de error de todas las funciones: el que `invokeFunction` vuelve a convertir en AppError. */
export const errorBody = ({ code, message }: AppError, wording = message): AppErrorBody =>
  ({ error: { code, message: wording } })

/**
 * Lee el cuerpo como JSON y corta apenas pasa `maxBytes`: uno enorme se rechaza
 * sin terminar de recibirlo, y el tope cuenta bytes aunque el texto tenga tildes.
 */
async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const reader = request.body?.getReader()
  if (!reader) throw new AppError('INVALID_REQUEST')

  const decoder = new TextDecoder()
  let text = ''
  let bytes = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.length
    if (bytes > maxBytes) {
      await reader.cancel()
      throw new AppError('PAYLOAD_TOO_LARGE')
    }
    // `stream` no parte un carácter de varios bytes que cae entre dos pedazos.
    text += decoder.decode(value, { stream: true })
  }
  text += decoder.decode()

  try {
    return JSON.parse(text)
  } catch {
    throw new AppError('INVALID_REQUEST')
  }
}

/**
 * El sobre HTTP de las Edge Functions: preflight, POST, bearer, `Content-Type`,
 * tope del cuerpo, JSON, schema y respuesta de error del catálogo. Cada función
 * aporta solo su schema, su tope y su lógica, así que las tres responden igual.
 *
 * Lo barato va primero: Auth no se consulta hasta tener un cuerpo válido. Lo que
 * se tira sin ser AppError nunca se expone: responde SERVER_ERROR.
 */
export function postHandler<Input, Gateway>({
  schema,
  maxBytes,
  authenticate,
  run,
  messages = {},
}: PostHandlerOptions<Input, Gateway>) {
  const errorResponse = (error: AppError) => json(errorBody(error, messages[error.code]), error.status)

  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (request.method !== 'POST') return errorResponse(new AppError('METHOD_NOT_ALLOWED'))

    try {
      const jwt = request.headers.get('Authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1]
      if (!jwt) throw new AppError('AUTH_REQUIRED')
      const mediaType = request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()
      if (mediaType !== 'application/json') throw new AppError('INVALID_REQUEST')

      const parsed = schema.safeParse(await readJson(request, maxBytes))
      if (!parsed.success) throw new AppError('INVALID_REQUEST')

      const { body, status } = await run(parsed.data, await authenticate(jwt))
      return json(body, status)
    } catch (error) {
      return errorResponse(error instanceof AppError ? error : new AppError('SERVER_ERROR'))
    }
  }
}
