import { Route, Routes } from 'react-router'
import { DesignPreviewPage } from '@/pages/DesignPreviewPage'
import { LandingPage } from '@/pages/LandingPage'
import {
  TableBillPage,
  TableCatchAll,
  TableCartItemPage,
  TableCartPage,
  TableMenuPage,
  TableOrdersPage,
  TableProductPage,
  TableRoute,
} from '@/pages/TablePage'
import { TABLE_ROUTE } from '@/features/table-paths'

export default function App() {
  return (
    <Routes>
      <Route path={TABLE_ROUTE} element={<TableRoute />}>
        <Route index element={<TableMenuPage />} />
        <Route path="producto/:productId" element={<TableProductPage />} />
        <Route path="carrito" element={<TableCartPage />} />
        <Route path="carrito/:itemId" element={<TableCartItemPage />} />
        <Route path="pedidos" element={<TableOrdersPage />} />
        <Route path="cuenta" element={<TableBillPage />} />
        <Route path="*" element={<TableCatchAll />} />
      </Route>
      <Route path="/vista-previa/:designId" element={<DesignPreviewPage />} />
      <Route path="/" element={<LandingPage />} />
      {/* Todo lo demás es una URL que no existe, y la pantalla lo dice. */}
      <Route path="*" element={<LandingPage notFound />} />
    </Routes>
  )
}
