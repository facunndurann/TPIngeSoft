import { Navigate, Route, Routes } from 'react-router'
import { Spinner, useAuth } from '@restaurant-platform/ui'
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
              <RequireAdmin>
                <AdminLayout />
              </RequireAdmin>
            </RestaurantGate>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      >
        <Route index element={<Navigate to="/productos" replace />} />
        {/* Administración: owner/manager; la RLS aplica los permisos de la cuenta. */}
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
