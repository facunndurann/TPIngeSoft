import { MAX_ITEM_QUANTITY, MIN_ITEM_QUANTITY } from '@restaurant-platform/shared'
import { useNumericDraft } from '@/hooks/useNumericDraft'

type QuantityFieldProps = {
  value: number
  disabled?: boolean
  onChange: (quantity: number) => void
}

/** Un entero dentro del rango se confirma al tipearlo; el resto espera al blur. */
function parseQuantity(text: string) {
  const quantity = Number(text)
  // `Number('')` es 0, así que el campo vacío se descarta antes de mirar el rango.
  if (text === '' || !Number.isInteger(quantity)) return undefined
  return quantity >= MIN_ITEM_QUANTITY && quantity <= MAX_ITEM_QUANTITY ? quantity : undefined
}

/**
 * Único control de cantidad del comensal: los botones siempre dejan un valor
 * válido y el campo acepta tipear, pero nada fuera del rango llega al carrito.
 * Antes el mismo widget se comportaba de dos maneras: en el editor aceptaba
 * cualquier cosa y avisaba después, y en el carrito descartaba la tecla en
 * silencio. Hoy el borrador lo maneja `useNumericDraft`, el mismo que el
 * porcentaje, así que los dos campos no pueden separarse.
 */
export function QuantityField({ value, disabled = false, onChange }: QuantityFieldProps) {
  const field = useNumericDraft(value, parseQuantity, (quantity) => {
    // Ni el parse ni los botones producen `null`: una cantidad nunca queda vacía.
    if (quantity !== null) onChange(quantity)
  })

  const step = (delta: number) => () =>
    field.commit(Math.min(Math.max(value + delta, MIN_ITEM_QUANTITY), MAX_ITEM_QUANTITY))

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
        value={field.text}
        disabled={disabled}
        onChange={(event) => field.onChange(event.target.value)}
        onBlur={field.onBlur}
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
