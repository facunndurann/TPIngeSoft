import { useMenuDesign } from '@/features/menu-design'

type TableHeaderProps = {
  restaurantName: string
  branchName: string
  tableLabel: string
}

export function TableHeader({ restaurantName, branchName, tableLabel }: TableHeaderProps) {
  const { copy } = useMenuDesign()
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
