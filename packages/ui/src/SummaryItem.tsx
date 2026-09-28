import type { ComponentType, ReactNode } from 'react'

type SummaryItemProps = {
  icon?: ComponentType<{ size?: number; 'aria-hidden'?: boolean | 'true' | 'false' }>
  label: string
  value: ReactNode
  /** En una `<dl>` los pares van con dt/dd; fuera de ella, con párrafos. */
  as?: 'div' | 'dl-pair'
}

/** Un dato suelto de cabecera: rótulo chico arriba, valor debajo. */
export function SummaryItem({ icon: Icon, label, value, as = 'div' }: SummaryItemProps) {
  const Label = as === 'dl-pair' ? 'dt' : 'p'
  const Value = as === 'dl-pair' ? 'dd' : 'p'

  return (
    <div className="min-w-28">
      <Label className="flex items-center gap-1 text-xs font-medium tracking-wide text-muted uppercase">
        {Icon && <Icon size={12} aria-hidden="true" />}
        {label}
      </Label>
      <Value className="mt-0.5 font-medium text-neutral-800">{value}</Value>
    </div>
  )
}
