import { Route, Routes } from 'react-router'
import { DesignPreviewPage } from '@/pages/DesignPreviewPage'
import { LandingPage } from '@/pages/LandingPage'
import {
  TableCatchAll,
  TableCartItemPage,
  TableCartPage,
  TableMenuPage,
  TableOrdersPage,
  TableProductPage,
  TableRoute,
} from '@/pages/TablePage'

export default function App() {
  return (
    <Routes>
      <Route path="/m/:token" element={<TableRoute />}>
        <Route index element={<TableMenuPage />} />
        <Route path="producto/:productId" element={<TableProductPage />} />
        <Route path="carrito" element={<TableCartPage />} />
        <Route path="carrito/revisar" element={<TableCartPage reviewing />} />
        <Route path="carrito/:itemId" element={<TableCartItemPage />} />
        <Route path="pedidos" element={<TableOrdersPage />} />
        <Route path="*" element={<TableCatchAll />} />
      </Route>
      <Route path="/vista-previa/:designId" element={<DesignPreviewPage />} />
      <Route path="*" element={<LandingPage />} />
    </Routes>
  )
}
