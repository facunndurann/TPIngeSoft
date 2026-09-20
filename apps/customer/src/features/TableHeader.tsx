import { useMenuDesign } from '@/features/menu-design'

type TableHeaderProps = {
  restaurantName: string
  branchName: string
  tableLabel: string
  /** Fuera de la carta el encabezado es contexto, no bienvenida: va en una línea. */
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
        <h1>
          {restaurantName} <span className="muted">· {branchName}</span>
          <span className="badge">{tableLabel}</span>
        </h1>
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
