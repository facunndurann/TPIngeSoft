import { useMenuDesign } from '@/features/menu-design'

type TableHeaderProps = {
  restaurantName: string
  branchName: string
  tableLabel: string
  /** Fuera de la carta el encabezado es contexto, no bienvenida: va compacto. */
  compact?: boolean
}

export function TableHeader({
  restaurantName,
  branchName,
  tableLabel,
  compact = false,
}: TableHeaderProps) {
  const { copy } = useMenuDesign()

  // El h1 sigue siendo uno por pantalla; lo que cambia es cuánto ocupa.
  if (compact) {
    return (
      <header className="compact">
        <div className="compact-copy">
          <h1>{restaurantName}</h1>
          <p className="muted">{branchName}</p>
        </div>
        <span className="badge">{tableLabel}</span>
      </header>
    )
  }

  return (
    <header>
      <p className="eyebrow">{copy.welcome}</p>
      <h1>{restaurantName}</h1>
      <p>
        {branchName} <span className="badge">{tableLabel}</span>
      </p>
    </header>
  )
}
