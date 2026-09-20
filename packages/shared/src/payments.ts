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

import type { Database } from './database.types.ts';
import { z } from 'zod';

/** Los define el enum `payment_method` de la base, que es lo que acepta la columna. */
export type PaymentMethod = Database['public']['Enums']['payment_method'];
export type PaymentStatus = Database['public']['Enums']['payment_status'];
export type PaymentMode = Database['public']['Enums']['payment_mode'];

/** Orden en que se ofrecen y se muestran, del más automático al más manual. */
export const paymentMethods = ['mobile', 'in_person', 'external'] as const satisfies
  readonly PaymentMethod[];

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  mobile: 'Pago desde el celular',
  in_person: 'Cobro en la mesa',
  external: 'Efectivo o pago externo',
};

/** Qué habilita cada medio, para que el administrador sepa qué está prendiendo. */
export const paymentMethodDescriptions: Record<PaymentMethod, string> = {
  mobile: 'El comensal paga en la app con un medio electrónico.',
  in_person: 'El comensal puede pedir que un mozo le cobre en la mesa.',
  external: 'Se arregla fuera de la app: caja, efectivo o transferencia.',
};

export const paymentStatusLabels: Record<PaymentStatus, string> = {
  pending: 'Pendiente',
  approved: 'Aprobado',
  rejected: 'Rechazado',
  cancelled: 'Cancelado',
};

export const paymentModeLabels: Record<PaymentMode, string> = {
  full: 'Cuenta completa',
  own: 'Consumo propio',
  equal_split: 'Partes iguales',
  custom: 'Ítems o importe parcial',
};

/** Lo que hace falta saber de una sucursal para cobrarle a una mesa. */
export type PaymentMethodSource = { payment_methods?: PaymentMethod[] | null };

/**
 * Medios habilitados de una sucursal, en el orden del catálogo. Se recorre el
 * catálogo y no el array guardado, así un repetido o un orden raro en la
 * columna no se filtra a la pantalla.
 */
export function enabledPaymentMethods(
  branch: PaymentMethodSource | null | undefined,
): PaymentMethod[] {
  const enabled = branch?.payment_methods ?? [];
  return paymentMethods.filter((method) => enabled.includes(method));
}

export function acceptsPaymentMethod(
  branch: PaymentMethodSource | null | undefined,
  method: PaymentMethod,
): boolean {
  return (branch?.payment_methods ?? []).includes(method);
}

const uuid = z.string().uuid();
export const mobilePaymentRequestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    sessionId: uuid,
    requestId: uuid,
    mode: z.enum(['full', 'equal_split', 'custom']).default('full'),
    itemIds: z.array(uuid).min(1).max(100).optional(),
  }).strict(),
  z.object({
    action: z.literal('confirm'),
    paymentId: uuid,
    outcome: z.enum(['approved', 'rejected']),
  }).strict(),
]).superRefine((request, ctx) => {
  if (request.action !== 'create') return;
  if (request.mode === 'custom' && !request.itemIds?.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['itemIds'], message: 'Elegí al menos un ítem.' });
  }
  if (request.mode !== 'custom' && request.itemIds !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['itemIds'], message: 'Este pago no admite ítems.' });
  }
});
export type MobilePaymentRequest = z.infer<typeof mobilePaymentRequestSchema>;

export const mobilePaymentResultSchema = z.object({
  paymentId: uuid,
  amount: z.number().finite().positive(),
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']),
});
export type MobilePaymentResult = z.infer<typeof mobilePaymentResultSchema>;

export const mobilePaymentErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
