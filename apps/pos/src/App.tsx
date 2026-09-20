import { useState, type ReactNode } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import type { PosPermission } from '@restaurant-platform/shared'
import { Button, ErrorText, Spinner, useAuth } from '@restaurant-platform/ui'
import { supabase } from '@/lib/supabase'
import { AccessContext, useCan, type PosContext } from '@/context/pos-context'
import { LoginPage } from '@/pages/LoginPage'
import { PosPage } from '@/features/pos/PosPage'
import { CommandBoard } from '@/features/pos/CommandBoard'
import { FloorMap } from '@/features/pos/FloorMap'
import { TableCommand } from '@/features/pos/TableCommand'
import { ActiveTables } from '@/features/pos/ActiveTables'
import { OrderHistory } from '@/features/pos/OrderHistory'

export default function App() {
  const { session, loading } = useAuth()

  if (loading) return <Spinner />

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  return <AuthenticatedPos key={session.user.id} userId={session.user.id} />
}

const storageKey = (userId: string) => `pos-context:${userId}`

/** Identifica un contexto: una cuenta puede trabajar en varias sucursales. */
const contextKey = (context: PosContext) => `${context.restaurant_id}:${context.branch_id}`

// La elección sobrevive al F5 de la tablet, pero nunca autoriza por sí sola: sólo
// vale si get_pos_contexts sigue devolviendo ese contexto para esta cuenta.
function readStoredContext(userId: string) {
  try {
    return sessionStorage.getItem(storageKey(userId))
  } catch {
    return null
  }
}

function storeContext(userId: string, value: string) {
  try {
    sessionStorage.setItem(storageKey(userId), value)
  } catch {
    /* modo privado o storage bloqueado */
  }
}

function AuthenticatedPos({ userId }: { userId: string }) {
  const navigate = useNavigate()
  const [selected, setSelected] = useState<string | null>(() => readStoredContext(userId))

  const contexts = useQuery({
    queryKey: ['pos-contexts', userId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_pos_contexts')
      if (error) throw error
      return data
    },
    refetchInterval: 15_000,
    refetchOnWindowFocus: 'always',
  })

  if (contexts.isPending) return <Spinner />

  if (contexts.isError || !contexts.data?.length) {
    return (
      <main className="mx-auto max-w-md space-y-4 p-8">
        <h1 className="text-xl font-semibold">Acceso no habilitado</h1>
        <ErrorText
          message={
            contexts.isError
              ? 'No pudimos verificar tu acceso. Reintentá.'
              : 'Tu cuenta no tiene una sucursal POS habilitada. Contactá a tu administrador.'
          }
        />
        <Button onClick={() => contexts.refetch()}>Reintentar</Button>
        <Button variant="secondary" onClick={() => supabase.auth.signOut()}>
          Cerrar sesión
        </Button>
      </main>
    )
  }

  const multipleContexts = contexts.data.length > 1
  const active = multipleContexts
    ? contexts.data.find((context) => contextKey(context) === selected)
    : contexts.data[0]

  const selector = (
    <main className="mx-auto max-w-xl space-y-4 p-8">
      <h1 className="text-xl font-semibold">Elegí dónde vas a trabajar</h1>
      {contexts.data.map((context) => (
        <Button
          key={contextKey(context)}
          className="w-full"
          onClick={() => {
            setSelected(contextKey(context))
            storeContext(userId, contextKey(context))
            navigate('/', { replace: true })
          }}
        >
          {context.restaurant_name} · {context.branch_name}
        </Button>
      ))}
      <Button variant="secondary" onClick={() => supabase.auth.signOut()}>
        Cerrar sesión
      </Button>
    </main>
  )

  if (!active) {
    return (
      <Routes>
        <Route path="/select-context" element={selector} />
        <Route path="*" element={<Navigate to="/select-context" replace />} />
      </Routes>
    )
  }

  return (
    // Los permisos entran en la key: un cambio de rol remonta el árbol en vez de
    // dejar visible una pantalla que la cuenta ya no puede abrir.
    <AccessContext value={active} key={`${contextKey(active)}:${active.permissions.join(',')}`}>
      <Routes>
        <Route
          path="/select-context"
          element={multipleContexts ? selector : <Navigate to="/" replace />}
        />
        <Route path="/" element={<PosPage multipleContexts={multipleContexts} />}>
          <Route index element={<CommandBoard />} />
          <Route
            path="salon"
            element={
              <Permission name="floor.read">
                <FloorMap />
              </Permission>
            }
          />
          <Route
            path="salon/:tableId"
            element={
              <Permission name="floor.read">
                <TableCommand />
              </Permission>
            }
          />
          <Route
            path="mesas"
            element={
              <Permission name="floor.read">
                <ActiveTables />
              </Permission>
            }
          />
          <Route
            path="historial"
            element={
              <Permission name="history.read">
                <OrderHistory />
              </Permission>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AccessContext>
  )
}

function Permission({ name, children }: { name: PosPermission; children: ReactNode }) {
  return useCan()(name) ? children : <Navigate to="/" replace />
}
