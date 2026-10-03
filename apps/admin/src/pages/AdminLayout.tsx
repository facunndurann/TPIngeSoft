import { useId, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import {
  LayoutGrid,
  ListTree,
  LogOut,
  Map,
  Menu,
  QrCode,
  Settings,
  SlidersHorizontal,
  Users,
  UtensilsCrossed,
  X,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useMembership } from '@/restaurant/restaurant-context'

const navigation = [
  { to: '/productos', label: 'Productos', icon: UtensilsCrossed },
  { to: '/categorias', label: 'Categorías', icon: ListTree },
  { to: '/modificadores', label: 'Modificadores', icon: SlidersHorizontal },
  { to: '/salon', label: 'Salón', icon: Map },
  { to: '/mesas', label: 'Mesas y QR', icon: QrCode },
  { to: '/empleados', label: 'Empleados', icon: Users },
  { to: '/restaurante', label: 'Restaurante', icon: Settings },
]

/**
 * Desde `lg`, barra lateral fija. Debajo, una barra superior con el mismo menú
 * plegado: con la lateral de 240 px, un celular de 390 px dejaba 150 px para
 * el contenido.
 */
export function AdminLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r border-neutral-200 bg-white lg:flex">
        <div className="border-b border-neutral-200 px-4 py-4">
          <Brand />
        </div>
        <nav aria-label="Secciones" className="flex-1 space-y-1 p-3">
          <NavItems />
        </nav>
        <div className="border-t border-neutral-200 p-3">
          <SignOutButton />
        </div>
      </aside>

      <MobileHeader />

      {/* Una columna que llena el alto de la pantalla: una página con `fill` (el
          Salón) estira su contenido hasta el margen de abajo, sin medir nada. */}
      <main className="flex min-w-0 flex-1 flex-col p-4 sm:p-6 lg:ml-60 lg:p-8">
        <Outlet />
      </main>
    </div>
  )
}

/**
 * Barra superior de pantallas chicas. El menú se despliega dentro de ella, y
 * como queda pegada arriba al scrollear, abre siempre debajo de la barra. No es
 * un modal: la página sigue siendo usable y no hay foco que atrapar.
 */
function MobileHeader() {
  const { pathname } = useLocation()
  const menuId = useId()
  const toggleRef = useRef<HTMLButtonElement>(null)

  // El menú queda abierto en la ruta donde se abrió: navegar, con un enlace o
  // con el «atrás» del navegador, lo cierra solo, sin un efecto que lo resetee.
  const [openAt, setOpenAt] = useState<string | null>(null)
  const open = openAt === pathname
  const close = () => setOpenAt(null)

  return (
    <header
      className="sticky top-0 z-20 border-b border-neutral-200 bg-white lg:hidden"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          close()
          toggleRef.current?.focus()
        }
      }}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-2">
        <Brand />
        <button
          ref={toggleRef}
          type="button"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpenAt(open ? null : pathname)}
          className="flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
        >
          {open ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          Menú
        </button>
      </div>

      <div
        id={menuId}
        hidden={!open}
        className="max-h-[calc(100dvh-3.75rem)] overflow-y-auto border-t border-neutral-200 px-3 pt-2 pb-3"
      >
        <nav aria-label="Secciones" className="space-y-1">
          {/* Tocar la sección en la que ya se está no cambia la ruta: también cierra. */}
          <NavItems onNavigate={close} />
        </nav>
        <div className="mt-2 border-t border-neutral-200 pt-2">
          <SignOutButton />
        </div>
      </div>
    </header>
  )
}

function Brand() {
  const { restaurant } = useMembership()

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <div className="rounded-lg bg-primary p-2 text-white">
        <LayoutGrid size={16} aria-hidden="true" />
      </div>
      <p className="min-w-0 truncate text-sm font-semibold text-neutral-900">{restaurant.name}</p>
    </div>
  )
}

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return navigation.map(({ to, label, icon: Icon }) => (
    <NavLink
      key={to}
      to={to}
      onClick={onNavigate}
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
          isActive ? 'bg-primary-soft text-primary-ink' : 'text-muted hover:bg-neutral-100'
        }`
      }
    >
      <Icon size={17} aria-hidden="true" />
      {label}
    </NavLink>
  ))
}

function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => supabase.auth.signOut()}
      className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-muted hover:bg-neutral-100"
    >
      <LogOut size={17} aria-hidden="true" />
      Cerrar sesión
    </button>
  )
}
