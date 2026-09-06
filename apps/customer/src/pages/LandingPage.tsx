import { Link } from 'react-router'
import { MenuShell } from '@/features/MenuShell'

export function LandingPage() {
  return (
    <MenuShell className="landing">
      <p className="eyebrow">BIENVENIDO</p>
      <h1>Tu mesa, a tu gusto.</h1>
      <p>Escaneá el QR de tu mesa para explorar la carta y armar tu pedido.</p>
      <Link to="/">Inicio</Link>
    </MenuShell>
  )
}
