import {
  enabledPaymentMethods,
  type PaymentMethod,
  paymentMethodDescriptions,
  paymentMethodLabels,
  paymentMethods,
} from '@restaurant-platform/shared'
import { Check } from 'lucide-react'

/**
 * Medios de pago habilitados en una sucursal (MI-48). Cada chip explica qué
 * habilita: prender uno hace aparecer una opción en la app del comensal, y
 * apagarlo se la saca aunque la mesa ya esté sentada.
 */
export function PaymentMethodsField({
  value,
  disabled = false,
  onChange,
}: {
  value: PaymentMethod[] | null
  disabled?: boolean
  onChange: (methods: PaymentMethod[]) => void
}) {
  const enabled = enabledPaymentMethods({ payment_methods: value })

  const toggle = (method: PaymentMethod) =>
    onChange(
      enabled.includes(method)
        ? enabled.filter((current) => current !== method)
        : [...enabled, method],
    )

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Medios de pago habilitados">
        {paymentMethods.map((method) => {
          const on = enabled.includes(method)
          return (
            <button
              key={method}
              type="button"
              disabled={disabled}
              aria-pressed={on}
              title={paymentMethodDescriptions[method]}
              onClick={() => toggle(method)}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-default disabled:opacity-50 ${
                on
                  ? 'border-primary bg-primary-soft text-primary-ink'
                  : 'border-neutral-200 bg-white text-muted hover:bg-neutral-50'
              }`}
            >
              {on && <Check size={13} aria-hidden="true" />}
              {paymentMethodLabels[method]}
            </button>
          )
        })}
      </div>
      <p className="text-xs text-muted">
        {enabled.length === 0
          ? 'Sin medios habilitados el comensal solo puede pedir la cuenta.'
          : enabled.map((method) => paymentMethodDescriptions[method]).join(' ')}
      </p>
    </div>
  )
}
