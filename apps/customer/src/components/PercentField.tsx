import { useState } from 'react'
import { percentageFits, SPLIT_PERCENTAGE_TOTAL } from '@restaurant-platform/shared'

type PercentFieldProps = {
  /** Porcentaje asignado, o `undefined` si este comensal no participa del reparto. */
  value?: number
  /** Techo real: los 100 menos lo que ya tienen los demás. */
  max: number
  label: string
  onChange: (value?: number) => void
}

/**
 * Porcentaje de un comensal. El techo es lo que queda sin asignar, así que no se
 * puede pasar del total: un valor por encima no se confirma y al salir del campo
 * vuelve al último válido, igual que el control de cantidad. Vacío sí se
 * confirma, porque "no participa del reparto" es un estado legítimo.
 */
export function PercentField({ value, max, label, onChange }: PercentFieldProps) {
  const [typed, setTyped] = useState<string>()

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
        value={typed ?? value ?? ''}
        onChange={(event) => {
          const next = event.target.value
          setTyped(next)
          if (next === '') {
            onChange(undefined)
            return
          }
          const percentage = Number(next)
          if (Number.isFinite(percentage) && percentage >= 0 && percentageFits(percentage, max)) {
            setTyped(undefined)
            onChange(percentage)
          }
        }}
        onBlur={() => setTyped(undefined)}
      />
      <small>% de {SPLIT_PERCENTAGE_TOTAL}</small>
    </span>
  )
}
