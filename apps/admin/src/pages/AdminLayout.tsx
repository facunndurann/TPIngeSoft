import { NavLink, Outlet } from 'react-router'
import { ClipboardList, LayoutGrid, ListTree, LogOut, QrCode, Settings, SlidersHorizontal, UtensilsCrossed } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useRestaurant } from '@/restaurant/restaurant-context'

const navigation = [
  { to: '/pos', label: 'POS', icon: ClipboardList },
  { to: '/productos', label: 'Productos', icon: UtensilsCrossed },
  { to: '/categorias', label: 'Categorías', icon: ListTree },
  { to: '/modificadores', label: 'Modificadores', icon: SlidersHorizontal },
  { to: '/mesas', label: 'Mesas y QR', icon: QrCode },
  { to: '/restaurante', label: 'Restaurante', icon: Settings },
]

export function AdminLayout() {
  const restaurant = useRestaurant()

  return (
    <div className="flex min-h-dvh bg-neutral-100">
      <aside className="fixed inset-y-0 left-0 flex w-60 flex-col border-r border-neutral-200 bg-white">
        <div className="flex items-center gap-2.5 border-b border-neutral-200 px-4 py-4">
          <div className="rounded-lg bg-indigo-600 p-2 text-white">
            <LayoutGrid size={16} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-neutral-900">{restaurant.name}</p>
            <p className="text-xs text-neutral-500">Panel de administración</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {navigation.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-neutral-600 hover:bg-neutral-100'
                }`
              }
            >
              <Icon size={17} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-neutral-200 p-3">
          <button
            onClick={() => supabase.auth.signOut()}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
          >
            <LogOut size={17} />
            Cerrar sesión
          </button>
        </div>
      </aside>
      <main className="ml-60 flex-1 p-6 lg:p-8">
        <Outlet />
      </main>
    </div>
  )
}
