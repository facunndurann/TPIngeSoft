import { Route, Routes } from 'react-router'
import { LandingPage } from '@/pages/LandingPage'
import { TableRoute } from '@/pages/TablePage'

export default function App() {
  return (
    <Routes>
      <Route path="/m/:token" element={<TableRoute />} />
      <Route path="*" element={<LandingPage />} />
    </Routes>
  )
}
