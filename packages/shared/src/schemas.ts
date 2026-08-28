import { z } from 'zod';

/**
 * Schemas Zod compartidos (validación de formularios en frontend y de
 * payloads en edge functions). Se amplían a medida que avanza el proyecto.
 */

export const participantNameSchema = z
  .string()
  .trim()
  .min(1, 'El nombre no puede estar vacío')
  .max(40, 'El nombre es demasiado largo');
