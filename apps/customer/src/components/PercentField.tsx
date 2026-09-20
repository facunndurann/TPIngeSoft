import { percentageFits, SPLIT_PERCENTAGE_TOTAL } from '@restaurant-platform/shared'
import { useNumericDraft } from '@/hooks/useNumericDraft'

type PercentFieldProps = {
  /** Porcentaje asignado, o `null` si este comensal no participa del reparto. */
  value: number | null
  /** Techo real: los 100 menos lo que ya tienen los demás. */
  max: number
  label: string
  onChange: (value: number | null) => void
}

/**
 * Porcentaje de un comensal. El techo es lo que queda sin asignar, así que no se
 * puede pasar del total: un valor por encima no se confirma y al salir del campo
 * vuelve al último válido, igual que el control de cantidad, porque es la misma
 * máquina. Vacío sí se confirma, porque "no participa del reparto" es un estado
 * legítimo: se confirma como `null`.
 */
export function PercentField({ value, max, label, onChange }: PercentFieldProps) {
  // El techo depende de lo que tengan los demás, así que el parse se arma acá.
  const field = useNumericDraft(
    value,
    (text) => {
      if (text === '') return null
      const percentage = Number(text)
      const fits = Number.isFinite(percentage) && percentage >= 0 && percentageFits(percentage, max)
      return fits ? percentage : undefined
    },
    onChange,
  )

  return (
    <span className="split-percent">
      <input
        type="number"
        inputMode="decimal"
        min={0}
        // El navegador también frena su propia flechita en el techo de este comensal.
        max={max}
        step="0.01"
        aria-label={label}
        value={field.text}
        onChange={(event) => field.onChange(event.target.value)}
        onBlur={field.onBlur}
      />
      <small>% de {SPLIT_PERCENTAGE_TOTAL}</small>
    </span>
  )
}
