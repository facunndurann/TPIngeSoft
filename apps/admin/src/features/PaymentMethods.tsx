import {
  enabledPaymentMethods,
  type PaymentMethod,
  paymentMethodDescriptions,
  paymentMethodLabels,
  paymentMethods,
} from '@restaurant-platform/shared'
import { ChoiceChip } from '@restaurant-platform/ui'

/**
 * Medios de pago habilitados en una sucursal (MI-48). Cada chip explica qué
 * habilita: prender uno hace aparecer una opción en la app del comensal, y
 * apagarlo se la saca aunque la mesa ya esté sentada.
 */
export function PaymentMethodsField({
  value,
  busy = false,
  onChange,
}: {
  value: PaymentMethod[] | null
  /**
   * Guardando el cambio anterior: los chips ya muestran lo nuevo y no aceptan otro
   * toque hasta que termine, como el switch de la sucursal. No se deshabilitan,
   * para no sacarle el foco a quien usa el teclado.
   */
  busy?: boolean
  onChange: (methods: PaymentMethod[]) => void
}) {
  const enabled = enabledPaymentMethods({ payment_methods: value })

  const toggle = (method: PaymentMethod) => {
    if (busy) return
    onChange(
      enabled.includes(method)
        ? enabled.filter((current) => current !== method)
        : [...enabled, method],
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Medios de pago habilitados">
        {paymentMethods.map((method) => (
          <ChoiceChip
            key={method}
            tone="outline"
            pressed={enabled.includes(method)}
            aria-disabled={busy || undefined}
            title={paymentMethodDescriptions[method]}
            onClick={() => toggle(method)}
          >
            {paymentMethodLabels[method]}
          </ChoiceChip>
        ))}
      </div>
      <p className="text-xs text-muted">
        {enabled.length === 0
          ? 'Sin medios habilitados el comensal solo puede pedir la cuenta.'
          : enabled.map((method) => paymentMethodDescriptions[method]).join(' ')}
      </p>
    </div>
  )
}
