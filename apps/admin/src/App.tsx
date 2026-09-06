import { Navigate, Route, Routes } from 'react-router'
import { useAuth } from '@/auth/useAuth'
import { Spinner } from '@/components/ui'
import { LoginPage } from '@/pages/LoginPage'
import { RestaurantGate } from '@/restaurant/RestaurantGate'
import { AdminLayout } from '@/pages/AdminLayout'
import { ProductsPage } from '@/pages/ProductsPage'
import { ProductEditPage } from '@/pages/ProductEditPage'
import { CategoriesPage } from '@/pages/CategoriesPage'
import { ModifiersPage } from '@/pages/ModifiersPage'
import { TablesPage } from '@/pages/TablesPage'
import { SettingsPage } from '@/pages/SettingsPage'
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
              <AdminLayout />
            </RestaurantGate>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      >
        <Route index element={<Navigate to="/pos" replace />} />
        <Route path="pos" element={<PosPage />}>
          <Route index element={<CommandBoard />} />
          <Route path="mesas" element={<ActiveTables />} />
          <Route path="historial" element={<OrderHistory />} />
        </Route>
        <Route path="productos" element={<ProductsPage />} />
        <Route path="productos/nuevo" element={<ProductEditPage />} />
        <Route path="productos/:productId" element={<ProductEditPage />} />
        <Route path="categorias" element={<CategoriesPage />} />
        <Route path="modificadores" element={<ModifiersPage />} />
        <Route path="mesas" element={<TablesPage />} />
        <Route path="restaurante" element={<SettingsPage />} />
      </Route>
    </Routes>
  )
}

export default App
