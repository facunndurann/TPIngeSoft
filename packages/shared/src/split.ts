/**
 * División de la cuenta de una mesa: modelo único que comparten el comensal, la
 * RPC `update_session_split` y sus pruebas.
 *
 * Dos decisiones que valen para los tres modos:
 *
 * 1. **Una sola base.** Todos los modos reparten `bill.pending_amount` (lo que
 *    falta pagar). Antes `none` sumaba importes de ítems y los otros dos
 *    dividían el pendiente, así que cambiar de modo cambiaba el total sin
 *    avisar. Ahora el modo decide *proporciones*, nunca la base.
 * 2. **Centavos enteros.** El reparto se hace en centavos y los que sobran por
 *    redondeo se asignan por resto mayor, así la suma de las partes es siempre
 *    exactamente el pendiente: nunca falta ni sobra un centavo.
 */

import { z } from 'zod';
import { isBilledStatus, type OrderStatus } from './orders.ts';
import { asAmount } from './pos.ts';

export const splitTypes = ['none', 'equal', 'percentages'] as const;
export type SplitType = (typeof splitTypes)[number];

export const splitTypeLabels: Record<SplitType, string> = {
  none: 'Cada uno lo suyo',
  equal: 'Partes iguales',
  percentages: 'Porcentajes',
};

export const splitTypeDescriptions: Record<SplitType, string> = {
  none: 'Cada uno paga lo que pidió; lo compartido se divide entre todos.',
  equal: 'El pendiente se divide en partes iguales.',
  percentages: 'Cada comensal paga el porcentaje que le asignaron.',
};

export const SPLIT_PERCENTAGE_TOTAL = 100;
export const MIN_EQUAL_PARTS = 2;
export const MAX_EQUAL_PARTS = 50;

/** Los porcentajes se comparan en centésimas de punto para no depender del float. */
const HUNDREDTHS = 100;

const percentageSchema = z
  .number()
  .finite()
  .min(0)
  .max(SPLIT_PERCENTAGE_TOTAL)
  .refine(
    (value) => Math.abs(value * HUNDREDTHS - Math.round(value * HUNDREDTHS)) < 1e-6,
    'El porcentaje admite como máximo dos decimales',
  );

export const splitTypeSchema = z.enum(splitTypes);
export const splitAllocationsSchema = z.record(z.string().uuid(), percentageSchema);
export type SplitAllocations = z.infer<typeof splitAllocationsSchema>;

/**
 * Contrato completo de la división. Las mismas tres reglas las revalida la RPC:
 * modo conocido, asignaciones solo en `percentages`, y suma exacta de 100.
 */
export const sessionSplitSchema = z
  .object({
    type: splitTypeSchema,
    allocations: splitAllocationsSchema.default({}),
    equalParts: z.number().int().min(MIN_EQUAL_PARTS).max(MAX_EQUAL_PARTS).optional(),
  })
  .superRefine((split, ctx) => {
    if (split.type === 'equal') {
      if (split.equalParts === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['equalParts'],
          message: 'Elegí cuántas personas van a dividir la cuenta.',
        });
      }
    } else if (split.equalParts !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['equalParts'],
        message: 'La cantidad de personas solo corresponde a partes iguales.',
      });
    }
    if (split.type !== 'percentages') {
      // Guardar asignaciones fuera de `percentages` deja basura que reaparece
      // al volver a ese modo con comensales que ya no están en la mesa.
      if (Object.keys(split.allocations).length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['allocations'],
          message: 'Solo la división por porcentajes lleva asignaciones.',
        });
      }
      return;
    }
    const total = Object.values(split.allocations).reduce(
      (sum, value) => sum + Math.round(value * HUNDREDTHS),
      0,
    );
    if (total !== SPLIT_PERCENTAGE_TOTAL * HUNDREDTHS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['allocations'],
        message: `Los porcentajes tienen que sumar ${SPLIT_PERCENTAGE_TOTAL}%.`,
      });
    }
  });

export type SessionSplit = z.infer<typeof sessionSplitSchema>;

export const defaultSessionSplit: SessionSplit = { type: 'none', allocations: {} };

/** Suma de los porcentajes asignados; el editor la muestra para saber cuánto falta. */
export function allocationTotal(allocations: SplitAllocations): number {
  return Object.values(allocations).reduce((total, value) => total + value, 0);
}

/**
 * Lee la división guardada en `table_sessions` sin castear el `Json` de la
 * columna: lo que no valide vuelve a `none`, que es el estado seguro.
 */
export function parseSessionSplit(
  type: unknown,
  allocations: unknown,
  equalParts?: unknown,
): SessionSplit {
  const parsed = sessionSplitSchema.safeParse({
    type,
    allocations: allocations ?? {},
    ...(equalParts == null ? {} : { equalParts }),
  });
  return parsed.success ? parsed.data : defaultSessionSplit;
}

/** Solo lo que el reparto necesita: así se puede probar sin filas de la base. */
export type SplitBill = {
  pending_amount: number | string | null;
  /**
   * Total en cuenta. Los porcentajes se calculan sobre esto y no sobre el
   * pendiente: el pendiente encoge cuando otro paga, y el porcentaje de cada
   * uno está atado a la cuenta entera. Es opcional porque los otros modos
   * reparten el pendiente y se los puede probar sin el total.
   */
  total_amount?: number | string | null;
};
export type SplitOrderItem = {
  is_shared: boolean;
  participant_id: string | null;
  total_price: number | string;
};
export type SplitOrder = { status: OrderStatus; order_items: readonly SplitOrderItem[] };
export type SplitParticipant = { id: string };

export type SplitShare = {
  participantId: string;
  /** Importe exacto en centavos; la suma de todos es el pendiente. */
  amountCents: number;
  amount: number;
};

const toCents = (value: number | string | null | undefined) =>
  Math.round(asAmount(value) * 100);

/**
 * Peso de cada comensal en el reparto. Son enteros (centavos o centésimas de
 * punto) para que el prorrateo posterior sea aritmética exacta.
 */
function weightsFor(
  orders: readonly SplitOrder[],
  participants: readonly SplitParticipant[],
  split: SessionSplit,
): number[] {
  if (split.type === 'equal') return participants.map(() => 1);

  if (split.type === 'percentages') {
    // Un comensal que se sumó después de fijar la división no tiene asignación:
    // su parte es 0 y el resto cubre el total, igual que lo guardado.
    return participants.map((participant) =>
      Math.round((split.allocations[participant.id] ?? 0) * HUNDREDTHS),
    );
  }

  // `none`: lo propio de cada uno, más la parte que le toca de lo compartido.
  const ownCents = new Map(participants.map((participant) => [participant.id, 0]));
  let sharedCents = 0;

  for (const order of orders) {
    if (!isBilledStatus(order.status)) continue;
    for (const item of order.order_items) {
      const cents = toCents(item.total_price);
      if (item.is_shared) {
        sharedCents += cents;
        continue;
      }
      const owner = item.participant_id;
      // Un ítem de alguien que ya no figura en la mesa se reparte entre todos.
      if (owner !== null && ownCents.has(owner)) ownCents.set(owner, ownCents.get(owner)! + cents);
      else sharedCents += cents;
    }
  }

  const sharedPerPerson = Math.round(sharedCents / participants.length);
  return participants.map(
    (participant) => (ownCents.get(participant.id) ?? 0) + sharedPerPerson,
  );
}

/**
 * Reparte `totalCents` según los pesos. Los centavos que deja el redondeo van a
 * las fracciones más altas (método del resto mayor), así el total cierra exacto.
 */
function distribute(
  totalCents: number,
  participants: readonly SplitParticipant[],
  weights: readonly number[],
): SplitShare[] {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  // Sin peso utilizable (nadie pidió todavía, o las asignaciones apuntan a
  // comensales que se fueron) el reparto parejo es la única respuesta honesta.
  const usable = totalWeight > 0 ? weights : participants.map(() => 1);
  const usableTotal = totalWeight > 0 ? totalWeight : participants.length;

  const exact = usable.map((weight) => (totalCents * weight) / usableTotal);
  const cents = exact.map(Math.floor);
  let leftover = totalCents - cents.reduce((sum, value) => sum + value, 0);

  const byRemainder = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (const { index } of byRemainder) {
    if (leftover <= 0) break;
    cents[index] += 1;
    leftover -= 1;
  }

  return participants.map((participant, index) => ({
    participantId: participant.id,
    amountCents: cents[index],
    amount: cents[index] / 100,
  }));
}

/**
 * Cuánto le toca a cada comensal por su porcentaje (MI-43), sobre el total de
 * la cuenta. No es lo mismo que `splitBill` con modo `percentages`, que reparte
 * el pendiente: el pendiente encoge cuando otro paga, y entonces el 40% dejaría
 * de ser el 40% de lo que esa persona debe.
 *
 * Es el espejo exacto de `session_percentage_share` en Postgres, que es quien
 * decide el importe real del pago: mismo resto mayor y mismo desempate por id
 * del comensal, para que el celular muestre el centavo que se va a cobrar.
 */
export function splitPercentageAmounts(
  accountTotal: number | string | null | undefined,
  participants: readonly SplitParticipant[],
  allocations: SplitAllocations,
): SplitShare[] {
  const none = participants.map((participant) => ({
    participantId: participant.id,
    amountCents: 0,
    amount: 0,
  }));
  // Orden por id, no por llegada a la mesa: es el `order by remainder desc,
  // participant_id` de la RPC, y con él los empates caen del mismo lado.
  const ordered = [...participants].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const weights = ordered.map((participant) =>
    Math.round((allocations[participant.id] ?? 0) * HUNDREDTHS),
  );
  // Sin asignaciones no hay porcentaje que repartir; el reparto parejo de
  // `distribute` mentiría sobre lo que cada uno debe.
  if (weights.every((weight) => weight === 0)) return none;

  const shares = distribute(Math.max(0, toCents(accountTotal)), ordered, weights);
  const byParticipant = new Map(shares.map((share) => [share.participantId, share]));
  return participants.map(
    (participant, index) => byParticipant.get(participant.id) ?? none[index],
  );
}

/** Importes de cada parte igual, en el orden en que se pagan. */
export function splitEqualAmounts(bill: SplitBill, parts: number): number[] {
  const parsedParts = z.number().int().min(MIN_EQUAL_PARTS).max(MAX_EQUAL_PARTS).safeParse(parts);
  if (!parsedParts.success) return [];
  const totalCents = Math.max(0, toCents(bill.pending_amount));
  const base = Math.floor(totalCents / parts);
  const remainder = totalCents % parts;
  return Array.from({ length: parts }, (_, index) => (base + (index < remainder ? 1 : 0)) / 100);
}

/**
 * Cuánto le toca pagar a cada comensal. El orden del resultado es el de
 * `participants`, y la suma de los importes es siempre `bill.pending_amount`.
 */
export function splitBill(
  bill: SplitBill,
  orders: readonly SplitOrder[],
  participants: readonly SplitParticipant[],
  split: SessionSplit,
): SplitShare[] {
  const pendingCents = toCents(bill.pending_amount);
  if (participants.length === 0) return [];
  if (pendingCents <= 0) {
    return participants.map((participant) => ({
      participantId: participant.id,
      amountCents: 0,
      amount: 0,
    }));
  }
  return distribute(pendingCents, participants, weightsFor(orders, participants, split));
}
