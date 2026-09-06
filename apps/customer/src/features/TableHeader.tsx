type TableHeaderProps = {
  restaurantName: string
  branchName: string
  tableLabel: string
  welcome: string
}

export function TableHeader({ restaurantName, branchName, tableLabel, welcome }: TableHeaderProps) {
  return (
    <header>
      <p className="eyebrow">{welcome}</p>
      <h1>{restaurantName}</h1>
      <p>
        {branchName} <span className="badge">{tableLabel}</span>
      </p>
    </header>
  )
}
