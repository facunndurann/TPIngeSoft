import { MAX_EQUAL_PARTS, MIN_EQUAL_PARTS } from '@restaurant-platform/shared'
import { integerIn, useNumericDraft } from '@/hooks/useNumericDraft'

type PartsFieldProps = {
  /** Partes de la división; `null` solo si la división guardada no traía cuántas. */
  value: number | null
  onChange: (parts: number) => void
}

const parseParts = integerIn(MIN_EQUAL_PARTS, MAX_EQUAL_PARTS)

/**
 * En cuántas partes iguales se divide la cuenta. Es la misma máquina que la
 * cantidad y el porcentaje: lo que se tipea fuera del rango no llega a la división
 * y, al salir del campo, vuelve el último valor válido.
 */
export function PartsField({ value, onChange }: PartsFieldProps) {
  const field = useNumericDraft(value, parseParts, (parts) => {
    // El parse nunca confirma `null`: una división en partes siempre dice cuántas.
    if (parts !== null) onChange(parts)
  })

  return (
    <label>
      Cantidad de personas
      <input
        type="number"
        inputMode="numeric"
        min={MIN_EQUAL_PARTS}
        max={MAX_EQUAL_PARTS}
        step={1}
        value={field.text}
        onChange={(event) => field.onChange(event.target.value)}
        onBlur={field.onBlur}
      />
    </label>
  )
}
