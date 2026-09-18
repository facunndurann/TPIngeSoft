import { Navigate, Route, Routes } from 'react-router'
import { useAuth } from '@/auth/useAuth'
import { Spinner } from '@/components/ui'
import { LoginPage } from '@/pages/LoginPage'
import { RestaurantGate } from '@/restaurant/RestaurantGate'
import { RequireAdmin } from '@/restaurant/RequireAdmin'
import { AdminLayout } from '@/pages/AdminLayout'
import { ProductsPage } from '@/pages/ProductsPage'
import { ProductEditPage } from '@/pages/ProductEditPage'
import { CategoriesPage } from '@/pages/CategoriesPage'
import { ModifiersPage } from '@/pages/ModifiersPage'
import { TablesPage } from '@/pages/TablesPage'
import { FloorPlanPage } from '@/pages/FloorPlanPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { EmployeesPage } from '@/pages/EmployeesPage'
import { PosGate } from '@/features/pos/PosGate'
import { PosOperatorProvider } from '@/features/pos/PosOperatorProvider'
import { PosPage } from '@/features/pos/PosPage'
import { CommandBoard } from '@/features/pos/CommandBoard'
import { ActiveTables } from '@/features/pos/ActiveTables'
import { OrderHistory } from '@/features/pos/OrderHistory'

function App() {
  const { session, loading } = useAuth()

  if (loading) return <Spinner />

  return (
    <Routes>
      <Route path="/login" element={session ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route
        path="/"
        element={
          session ? (
            <RestaurantGate>
              <PosOperatorProvider>
                <AdminLayout />
              </PosOperatorProvider>
            </RestaurantGate>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      >
        <Route index element={<Navigate to="/pos" replace />} />
        {/* Operación: cualquier miembro, con empleado validado por PIN. */}
        <Route
          path="pos"
          element={
            <PosGate>
              <PosPage />
            </PosGate>
          }
        >
          <Route index element={<CommandBoard />} />
          <Route path="mesas" element={<ActiveTables />} />
          <Route path="historial" element={<OrderHistory />} />
        </Route>
        {/* Administración sensible: solo el owner (la RLS aplica lo mismo). */}
        <Route path="productos" element={<RequireAdmin><ProductsPage /></RequireAdmin>} />
        <Route path="productos/nuevo" element={<RequireAdmin><ProductEditPage /></RequireAdmin>} />
        <Route path="productos/:productId" element={<RequireAdmin><ProductEditPage /></RequireAdmin>} />
        <Route path="categorias" element={<RequireAdmin><CategoriesPage /></RequireAdmin>} />
        <Route path="modificadores" element={<RequireAdmin><ModifiersPage /></RequireAdmin>} />
        <Route path="salon" element={<RequireAdmin><FloorPlanPage /></RequireAdmin>} />
        <Route path="mesas" element={<RequireAdmin><TablesPage /></RequireAdmin>} />
        <Route path="empleados" element={<RequireAdmin><EmployeesPage /></RequireAdmin>} />
        <Route path="restaurante" element={<RequireAdmin><SettingsPage /></RequireAdmin>} />
      </Route>
    </Routes>
  )
}

export default App
