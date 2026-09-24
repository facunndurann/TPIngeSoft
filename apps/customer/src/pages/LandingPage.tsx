import { Link, useLocation } from 'react-router'
import { lastTable } from '@/features/last-table'
import { MenuShell } from '@/features/MenuShell'
import { tableRoot } from '@/features/table-paths'

/**
 * Portada y, con `notFound`, la pantalla de una URL que no existe. Antes eran la
 * misma cosa sin decirlo, y el único enlace apuntaba acá mismo: reconoce el
 * enlace fallido y ofrece la única vuelta posible, la mesa donde estabas.
 */
export function LandingPage({ notFound = false }: { notFound?: boolean }) {
  const { pathname } = useLocation()
  const table = lastTable()

  return (
    <MenuShell className="landing">
      {notFound ? (
        <>
          <p className="eyebrow">ESA PÁGINA NO EXISTE</p>
          <h1>Ese enlace no lleva a ninguna mesa.</h1>
          <p>
            Abriste <span className="path">{pathname}</span>, que no corresponde a ninguna mesa.
            Escaneá el QR de la tuya para ver la carta y pedir.
          </p>
        </>
      ) : (
        <>
          <p className="eyebrow">BIENVENIDO</p>
          <h1>Tu mesa, a tu gusto.</h1>
          <p>Escaneá el QR de tu mesa para explorar la carta y armar tu pedido.</p>
        </>
      )}

      {table && (
        <Link className="primary" to={tableRoot(table.token)}>
          Volver a {table.tableLabel} · {table.restaurantName}
        </Link>
      )}
    </MenuShell>
  )
}
