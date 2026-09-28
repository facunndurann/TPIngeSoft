import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { AuthProvider, createQueryClient, ToastProvider } from '@restaurant-platform/ui'
import './index.css'
import App from './App.tsx'
import { supabase } from './lib/supabase'

const queryClient = createQueryClient()

// Router de datos y no <BrowserRouter>: es el que permite frenar una navegación
// (`useBlocker`) cuando un formulario tiene cambios sin guardar. Las rutas siguen
// declaradas en App con <Routes>; esta única ruta comodín las monta.
const router = createBrowserRouter([
  {
    path: '*',
    element: (
      <AuthProvider client={supabase} queryClient={queryClient}>
        <App />
      </AuthProvider>
    ),
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
)
