import { createContext, useContext, useEffect, useState } from 'react'
import {
  Link,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router'
import { formatPrice, MENU_DESIGNS } from '@restaurant-platform/shared'
import { ErrorMessage } from '@/components/ErrorMessage'
import { FreshnessNote } from '@/components/FreshnessNote'
import { TOAST_DURATION_MS, Toast } from '@/components/Toast'
import { cartKeyFor } from '@/features/cart'
import { CartPanel } from '@/features/CartPanel'
import { MenuBrowse } from '@/features/MenuBrowse'
import { cartPrice } from '@/features/menu'
import { ProductEditor } from '@/features/ProductEditor'
import { SessionOrders } from '@/features/SessionOrders'
import { SessionPanel } from '@/features/SessionPanel'
import { TableHeader } from '@/features/TableHeader'
import { TableNav } from '@/features/TableNav'
import {
  cartPath,
  isMenuIndex,
  menuPath,
  ordersPath,
  tableRoot,
  tableSection,
} from '@/features/table-paths'
import { MenuShell } from '@/features/MenuShell'
import { MenuDesignContext } from '@/features/menu-design'
import { useTableSession } from '@/hooks/useTableSession'
import { useCart } from '@/stores/cart'
import type { CartItem } from '@/stores/cart'

type TableSession = ReturnType<typeof useTableSession>
type TableContextValue = {
  token: string
  client: TableSession['client']
  menu: TableSession['menu']
  session: TableSession['session']
  sessionId?: string
  userId?: string
  cartKey: string
  items: CartItem[]
  sessionOpen: boolean
  canEdit: boolean
  setAnnouncement: (value: string) => void
}

const TableContext = createContext<TableContextValue | null>(null)

function useTable() {
  const value = useContext(TableContext)
  if (!value) throw new Error('La mesa todavía no está lista.')
  return value
}

function useTableBack(fallback: string) {
  const navigate = useNavigate()
  const location = useLocation()
  return () => {
    if (location.key === 'default') navigate(fallback, { replace: true })
    else navigate(-1)
  }
}

export function TableRoute() {
  const { token = '' } = useParams()
  return <TableApp key={token} token={token} />
}

function TableApp({ token }: { token: string }) {
  const { client, table, menu, joined, session, sessionId, name, setName, rename } =
    useTableSession(token)
  const location = useLocation()
  const [announcement, setAnnouncement] = useState('')
  const cart = useCart()
  const cartKey = cartKeyFor(sessionId, joined.data?.userId)
  const items = cart.carts[cartKey] ?? []
  const sessionOpen = session.data?.status === 'open' && !session.isError
  const canEdit = sessionOpen && !cart.submissions[cartKey]
  const cartCount = items.reduce((total, item) => total + item.quantity, 0)
  const section = tableSection(location.pathname)
  const atMenu = isMenuIndex(location.pathname)
  const total = menu.data ? cartPrice(menu.data, items) : 0

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  // Cada aviso nuevo reinicia el plazo; uno anterior nunca puede borrar al siguiente.
  useEffect(() => {
    if (!announcement) return
    const timer = setTimeout(() => setAnnouncement(''), TOAST_DURATION_MS)
    return () => clearTimeout(timer)
  }, [announcement])

  if (table.isPending) {
    return (
      <MenuShell role="status">
        Buscando tu mesa…
      </MenuShell>
    )
  }

  if (table.isError) {
    return (
      <MenuShell>
        <h1>No pudimos abrir esta mesa</h1>
        <ErrorMessage error={table.error} retry={() => { void table.refetch() }} />
      </MenuShell>
    )
  }

  const { restaurant, branch, table: currentTable } = table.data
  const design = MENU_DESIGNS[restaurant.menu_design]

  return (
    <MenuDesignContext value={design}>
      <TableContext.Provider
        value={{
          token,
          client,
          menu,
          session,
          sessionId,
          userId: joined.data?.userId,
          cartKey,
          items,
          sessionOpen,
          canEdit,
          setAnnouncement,
        }}
      >
        <MenuShell>
          <TableHeader
            restaurantName={restaurant.name}
            branchName={branch.name}
            tableLabel={currentTable.label}
          />

          <SessionPanel
            joined={joined}
            session={session}
            userId={joined.data?.userId}
            hasPendingSubmission={!!cart.submissions[cartKey]}
            name={name}
            onNameChange={setName}
            rename={rename}
            onOpenNewSession={() => {
              setAnnouncement('')
              void joined.refetch()
            }}
          />

          <TableNav token={token} cartCount={cartCount} />

          <Toast message={announcement} />

          {section !== 'orders' && menu.isPending && <p role="status">Cargando la carta…</p>}
          {section !== 'orders' && menu.isError && (
            <ErrorMessage error={menu.error} retry={() => { void menu.refetch() }} />
          )}

          {section !== 'cart' && cart.submissions[cartKey] && (
            <div className="notice">
              <p>Tu último envío todavía necesita confirmación.</p>
              <Link className="btn" to={cartPath(token)}>
                Consultar o reintentar envío
              </Link>
            </div>
          )}

          <Outlet />

          {atMenu && items.length > 0 && (
            <Link className="primary cart-bar" to={cartPath(token)}>
              Ver mi carrito <strong>{formatPrice(total)}</strong>
            </Link>
          )}

          <footer>{design.copy.footer}</footer>
        </MenuShell>
      </TableContext.Provider>
    </MenuDesignContext>
  )
}

export function TableMenuPage() {
  const { token, menu, canEdit } = useTable()
  if (!menu.data) return null
  return (
    <MenuBrowse
      token={token}
      menu={menu.data}
      canEdit={canEdit}
      freshness={
        <FreshnessNote
          label="la carta"
          updatedAt={menu.dataUpdatedAt || undefined}
          isFetching={menu.isFetching}
          onRefresh={() => { void menu.refetch() }}
        />
      }
    />
  )
}

export function TableCartPage({ reviewing = false }: { reviewing?: boolean }) {
  const { token, client, menu, sessionId, sessionOpen, cartKey, items, setAnnouncement } = useTable()
  const pending = useCart((state) => state.submissions[cartKey])
  const navigate = useNavigate()

  if (reviewing && items.length === 0 && !pending) {
    return <Navigate to={cartPath(token)} replace />
  }

  return (
    <CartPanel
      key={`${cartKey}:${reviewing ? 'review' : 'edit'}`}
      cartKey={cartKey}
      sessionId={sessionId}
      menu={menu.data}
      sessionOpen={sessionOpen}
      reviewing={reviewing}
      refreshMenu={() => menu.refetch({ throwOnError: true })}
      onAnnounce={setAnnouncement}
      onSubmitted={() => {
        setAnnouncement(
          'Tu pedido fue enviado. Podés seguir su estado y consultar la cuenta de la mesa.',
        )
        navigate(ordersPath(token), { replace: true })
        void client.invalidateQueries({ queryKey: ['orders', sessionId] })
        void client.invalidateQueries({ queryKey: ['bill', sessionId] })
      }}
    />
  )
}

export function TableProductPage() {
  const { token, menu, canEdit, cartKey, setAnnouncement } = useTable()
  const { productId = '' } = useParams()
  const location = useLocation()
  const back = useTableBack(`${menuPath(token)}${location.search}`)
  const cart = useCart()
  const product = menu.data?.productsById.get(productId)

  if (!menu.data) return null
  if (!product) {
    return (
      <section>
        <button className="text-button" onClick={back}>
          ← Volver
        </button>
        <p className="empty">No encontramos este plato.</p>
      </section>
    )
  }

  if (!canEdit) {
    return (
      <section>
        <button className="text-button" onClick={back}>
          ← Volver
        </button>
        <p className="notice">
          Para personalizar y agregar al carrito necesitás una sesión de mesa abierta.
        </p>
      </section>
    )
  }

  return (
    <ProductEditor
      key={product.id}
      product={product}
      onClose={back}
      onSave={(item) => {
        cart.save(cartKey, item)
        setAnnouncement(`${product.name} guardado en tu carrito`)
        back()
      }}
    />
  )
}

export function TableCartItemPage() {
  const { token, menu, canEdit, cartKey, items, setAnnouncement } = useTable()
  const { itemId = '' } = useParams()
  const back = useTableBack(cartPath(token))
  const cart = useCart()
  const item = items.find((entry) => entry.id === itemId)
  const product = item && menu.data?.productsById.get(item.productId)

  if (!item) return <Navigate to={cartPath(token)} replace />
  if (!menu.data) return null

  if (!product || !canEdit) {
    return (
      <section>
        <button className="text-button" onClick={back}>
          ← Volver
        </button>
        <p className="notice">
          {product
            ? 'Para editar este plato necesitás una sesión de mesa abierta.'
            : 'Este plato ya no está en la carta.'}
        </p>
      </section>
    )
  }

  return (
    <ProductEditor
      key={item.id}
      product={product}
      initial={item}
      onClose={back}
      onSave={(next) => {
        cart.save(cartKey, next)
        setAnnouncement(`${product.name} guardado en tu carrito`)
        back()
      }}
    />
  )
}

export function TableOrdersPage() {
  const { sessionId, session, userId, setAnnouncement } = useTable()
  return (
    <SessionOrders
      sessionId={sessionId}
      session={session.data}
      participants={session.data?.participants ?? []}
      userId={userId}
      closed={session.data?.status === 'closed'}
      onAnnounce={setAnnouncement}
    />
  )
}

export function TableCatchAll() {
  const { token = '' } = useParams()
  return <Navigate to={tableRoot(token)} replace />
}
