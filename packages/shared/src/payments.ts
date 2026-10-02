/**
 * Medios de pago habilitados por local (MI-48).
 *
 * `payment_method` es *con qué se paga*. No confundir con `payment_mode`
 * ('full', 'own', 'equal_split', 'custom'), que es *cuánto paga cada uno* y lo
 * decide la mesa al dividir la cuenta.
 *
 * Cada medio existe porque habilita algo concreto en la app del comensal; uno
 * que no cambie nada de lo que ve la mesa no va acá.
 */

import { Constants, type Database } from './database.types.ts'
import { z } from 'zod'
import { uuidSchema as uuid } from './schemas.ts'

/** Los define el enum `payment_method` de la base, que es lo que acepta la columna. */
export type PaymentMethod = Database['public']['Enums']['payment_method']
export type PaymentStatus = Database['public']['Enums']['payment_status']
export type PaymentMode = Database['public']['Enums']['payment_mode']

/** El medio sigue siendo `mobile`; esto identifica quién procesa ese medio. */
export type PaymentProvider = Database['public']['Enums']['payment_provider']
export type PaymentProviderEnvironment = Database['public']['Enums']['payment_provider_environment']
export const paymentProviders = ['mercado_pago'] as const satisfies readonly PaymentProvider[]
export const paymentProviderEnvironments = [
  'test',
  'production',
] as const satisfies readonly PaymentProviderEnvironment[]

export const paymentProviderLabels: Record<PaymentProvider, string> = {
  mercado_pago: 'Mercado Pago',
}

export const paymentProviderEnvironmentLabels: Record<PaymentProviderEnvironment, string> = {
  test: 'Pruebas',
  production: 'Producción',
}

/** Estado administrativo seguro: nunca contiene el access token ni el secreto de webhook. */
export type PaymentProviderConfig = {
  provider: PaymentProvider
  environment: PaymentProviderEnvironment
  configured: boolean
  accessTokenHint: string | null
  webhookConfigured: boolean
  branchIds: string[]
  updatedAt: string | null
}

const backendSecret = z.string().trim().min(16).max(512).regex(/^\S+$/)

/**
 * Guardado del panel. Los secretos vacíos conservan el valor existente; el
 * backend vuelve a validar todo y exige access token en la primera configuración.
 */
export const paymentProviderConfigInputSchema = z
  .object({
    restaurantId: uuid,
    environment: z.enum(paymentProviderEnvironments),
    branchIds: z.array(uuid).max(100),
    accessToken: backendSecret.min(20).optional(),
    webhookSecret: backendSecret.optional(),
  })
  .strict()
export type PaymentProviderConfigInput = z.infer<typeof paymentProviderConfigInputSchema>

/** Orden en que se ofrecen y se muestran, del más automático al más manual. */
export const paymentMethods = ['mobile', 'in_person', 'external'] as const satisfies readonly PaymentMethod[]

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  mobile: 'Pago desde el celular',
  in_person: 'Cobro en la mesa',
  external: 'Efectivo o pago externo',
}

/** Qué habilita cada medio, para que el administrador sepa qué está prendiendo. */
export const paymentMethodDescriptions: Record<PaymentMethod, string> = {
  mobile: 'El comensal continúa el pago en Mercado Pago desde su celular.',
  in_person: 'El comensal puede pedir que un mozo le cobre en la mesa.',
  external: 'Se arregla fuera de la app: caja, efectivo o transferencia.',
}

export const paymentStatusLabels: Record<PaymentStatus, string> = {
  pending: 'Pendiente',
  approved: 'Aprobado',
  rejected: 'Rechazado',
  cancelled: 'Cancelado',
}

export const paymentModeLabels: Record<PaymentMode, string> = {
  full: 'Cuenta completa',
  own: 'Consumo propio',
  equal_split: 'Partes iguales',
  percentage_split: 'Porcentaje asignado',
  custom: 'Ítems o importe parcial',
}

/** Lo que hace falta saber de una sucursal para cobrarle a una mesa. */
export type PaymentMethodSource = { payment_methods?: PaymentMethod[] | null }

/**
 * Medios habilitados de una sucursal, en el orden del catálogo. Se recorre el
 * catálogo y no el array guardado, así un repetido o un orden raro en la
 * columna no se filtra a la pantalla.
 */
export function enabledPaymentMethods(branch: PaymentMethodSource | null | undefined): PaymentMethod[] {
  const enabled = branch?.payment_methods ?? []
  return paymentMethods.filter((method) => enabled.includes(method))
}

export function acceptsPaymentMethod(branch: PaymentMethodSource | null | undefined, method: PaymentMethod): boolean {
  return (branch?.payment_methods ?? []).includes(method)
}

export const mobilePaymentRequestSchema = z
  .discriminatedUnion('action', [
    z
      .object({
        action: z.literal('create'),
        sessionId: uuid,
        requestId: uuid,
        mode: z.enum(['full', 'equal_split', 'percentage_split', 'custom']).default('full'),
        itemIds: z.array(uuid).min(1).max(100).optional(),
      })
      .strict(),
    z
      .object({
        action: z.literal('status'),
        paymentId: uuid,
      })
      .strict(),
  ])
  .superRefine((request, ctx) => {
    if (request.action !== 'create') return
    if (request.mode === 'custom' && !request.itemIds?.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['itemIds'], message: 'Elegí al menos un ítem.' })
    }
    if (request.mode !== 'custom' && request.itemIds !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['itemIds'], message: 'Este pago no admite ítems.' })
    }
  })
export type MobilePaymentRequest = z.infer<typeof mobilePaymentRequestSchema>

/**
 * Solo admitimos HTTPS hacia los dominios de checkout publicados por Mercado Pago.
 * El destino siempre viene del init_point del servidor, nunca de la URL de retorno.
 * https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro-preferences/get-preference/get
 */
export function isMercadoPagoCheckoutUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      ['www.mercadopago.com', 'sandbox.mercadopago.com', 'www.mercadopago.com.ar'].includes(url.hostname) &&
      /^\/(?:mla\/)?checkout\/(?:v1\/redirect|start|pay)\/?$/.test(url.pathname)
    )
  } catch {
    return false
  }
}

export const mobilePaymentResultSchema = z.object({
  paymentId: uuid,
  amount: z.number().finite().positive(),
  status: z.enum(Constants.public.Enums.payment_status),
  checkoutUrl: z.string().url().refine(isMercadoPagoCheckoutUrl).optional(),
  preferenceId: z.string().min(1).max(200).optional(),
  providerStatus: z.string().min(1).max(100).optional(),
})
export type MobilePaymentResult = z.infer<typeof mobilePaymentResultSchema>
