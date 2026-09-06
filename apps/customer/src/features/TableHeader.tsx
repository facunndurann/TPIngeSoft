type TableHeaderProps = {
  restaurantName: string
  branchName: string
  tableLabel: string
}

export function TableHeader({ restaurantName, branchName, tableLabel }: TableHeaderProps) {
  return (
    <header>
      <p className="eyebrow">BIENVENIDOS A LA MESA</p>
      <h1>{restaurantName}</h1>
      <p>
        {branchName} <span className="badge">{tableLabel}</span>
      </p>
    </header>
  )
}
