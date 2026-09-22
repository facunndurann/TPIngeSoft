import { z } from 'zod';

/**
 * Schemas Zod compartidos (validación de formularios en frontend y de
 * payloads en edge functions). Se amplían a medida que avanza el proyecto.
 */

/** Largo máximo de un nombre en la mesa: el mismo que revalidan las RPC del comensal. */
export const PARTICIPANT_NAME_MAX_LENGTH = 40;

export const participantNameSchema = z
  .string()
  .trim()
  .min(1, 'El nombre no puede estar vacío')
  .max(PARTICIPANT_NAME_MAX_LENGTH, 'El nombre es demasiado largo');
