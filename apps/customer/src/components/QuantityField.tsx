import { useState } from 'react'
import { MAX_ITEM_QUANTITY, MIN_ITEM_QUANTITY } from '@restaurant-platform/shared'

type QuantityFieldProps = {
  value: number
  disabled?: boolean
  onChange: (quantity: number) => void
}

/**
 * Único control de cantidad del comensal: los botones siempre dejan un valor
 * válido y el campo acepta tipear, pero nada fuera del rango llega al carrito.
 * Antes el mismo widget se comportaba de dos maneras: en el editor aceptaba
 * cualquier cosa y avisaba después, y en el carrito descartaba la tecla en
 * silencio.
 */
export function QuantityField({ value, disabled = false, onChange }: QuantityFieldProps) {
  // Lo que se está tipeando. `undefined` = el campo muestra el valor confirmado;
  // así se puede borrar para escribir otro número sin que el carrito vea un hueco.
  const [typed, setTyped] = useState<string>()

  const commit = (quantity: number) => {
    setTyped(undefined)
    if (quantity !== value) onChange(quantity)
  }

  const step = (delta: number) => () =>
    commit(Math.min(Math.max(value + delta, MIN_ITEM_QUANTITY), MAX_ITEM_QUANTITY))

  return (
    <span className="quantity">
      <button
        type="button"
        aria-label="Una unidad menos"
        disabled={disabled || value <= MIN_ITEM_QUANTITY}
        onClick={step(-1)}
      >
        −
      </button>
      <input
        aria-label="Cantidad"
        type="number"
        inputMode="numeric"
        min={MIN_ITEM_QUANTITY}
        max={MAX_ITEM_QUANTITY}
        value={typed ?? value}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value
          setTyped(next)
          const quantity = Number(next)
          // Un valor completo y válido se confirma al tipearlo; el resto espera al blur.
          if (next !== '' && Number.isInteger(quantity)) {
            if (quantity >= MIN_ITEM_QUANTITY && quantity <= MAX_ITEM_QUANTITY) commit(quantity)
          }
        }}
        // Salir con el campo vacío o fuera de rango no cambia nada: vuelve al último válido.
        onBlur={() => setTyped(undefined)}
      />
      <button
        type="button"
        aria-label="Una unidad más"
        disabled={disabled || value >= MAX_ITEM_QUANTITY}
        onClick={step(1)}
      >
        +
      </button>
    </span>
  )
}
