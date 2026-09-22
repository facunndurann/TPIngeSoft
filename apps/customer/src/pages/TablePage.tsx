import { useCallback, useEffect, useState } from 'react'
import {
  Navigate,
  Outlet,
  useLocation,
  useMatch,
  useNavigate,
  useParams,
} from 'react-router'
import { enabledPaymentMethods, MENU_DESIGNS } from '@restaurant-platform/shared'
import { ClockProvider, ErrorText } from '@restaurant-platform/ui'
import { FreshnessNote } from '@/components/FreshnessNote'
import { Toast } from '@/components/Toast'
import { type Announce, type Announcement, toastDuration } from '@/features/announcements'
import { cartKeyFor } from '@/features/cart'
import { CartPanel } from '@/features/CartPanel'
import { MenuBrowse } from '@/features/MenuBrowse'
import { ProductEditor } from '@/features/ProductEditor'
import { SessionOrders } from '@/features/SessionOrders'
import { type Failure, SessionPanel } from '@/features/SessionPanel'
import { useAttentionAnnouncements } from '@/features/service-requests'
import { TableContext, useTable } from '@/features/table-context'
import { CartBar, MenuStatus, PendingSubmissionNotice } from '@/features/TableChrome'
import { TableHeader } from '@/features/TableHeader'
import { TableNav } from '@/features/TableNav'
import { cartPath, menuPath, ordersPath, TABLE_ROUTE, tableRoot } from '@/features/table-paths'
import { MenuShell } from '@/features/MenuShell'
import { MenuDesignContext } from '@/features/menu-design'
import { rememberTable } from '@/features/last-table'
import { useReorder } from '@/features/reorder'
import { useTableSession } from '@/hooks/useTableSession'
import { useCart } from '@/stores/cart'

/**
 * Una consulta fallida como la muestra el panel: el error y su reintento, sin la
 * forma de react-query del otro lado.
 */
function failureOf(query: {
  isError: boolean
  error: unknown
  refetch: () => unknown
}): Failure | undefined {
  return query.isError ? { error: query.error, retry: () => { void query.refetch() } } : undefined
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
  const { table, menu, joined, session, sessionId, refreshTable, displayName, named, rename } =
    useTableSession(token)
  const location = useLocation()
  const navigate = useNavigate()
  const [announcement, setAnnouncement] = useState<Announcement>()
  const cart = useCart()
  const cartKey = cartKeyFor(sessionId, joined.data?.userId)
  const items = cart.carts[cartKey] ?? []
  const sessionOpen = session.data?.status === 'open' && !session.isError
  const canEdit = sessionOpen && !cart.submissions[cartKey]
  const cartCount = items.reduce((total, item) => total + item.quantity, 0)
  // La portada de la carta es la ruta de la mesa sin nada más: lo decide el router,
  // no una búsqueda en el texto de la URL.
  const atMenu = useMatch(TABLE_ROUTE) !== null

  const announce: Announce = useCallback((message, undo) => {
    setAnnouncement((current) => ({ id: (current?.id ?? 0) + 1, message, undo }))
  }, [])

  // «Ya te cobramos» tiene que llegar aunque el comensal esté mirando la carta.
  useAttentionAnnouncements(session.data, announce)

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  // Cada aviso nuevo reinicia el plazo; uno anterior nunca puede borrar al siguiente.
  useEffect(() => {
    if (!announcement) return
    const timer = setTimeout(() => setAnnouncement(undefined), toastDuration(!!announcement.undo))
    return () => clearTimeout(timer)
  }, [announcement])

  // Rastro mínimo para poder volver a la mesa desde una URL que no existe.
  useEffect(() => {
    if (!table.data) return
    rememberTable({
      token,
      tableLabel: table.data.table.label,
      restaurantName: table.data.restaurant.name,
    })
  }, [token, table.data])

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
        <ErrorText
          variant="menu"
          error={table.error}
          retry={() => { void table.refetch() }}
          recover={{ label: 'Ir al inicio', onAction: () => navigate('/') }}
        />
      </MenuShell>
    )
  }

  const { restaurant, branch, table: currentTable } = table.data
  const design = MENU_DESIGNS[restaurant.menu_design]

  return (
    <ClockProvider>
      <MenuDesignContext value={design}>
        <TableContext
          value={{
            token,
            menu,
            session,
            sessionId,
            refreshTable,
            userId: joined.data?.userId,
            cartKey,
            items,
            paymentMethods: enabledPaymentMethods(branch),
            sessionOpen,
            named,
            canEdit,
            announce,
          }}
        >
          <MenuShell>
            {/* La bienvenida es para la carta, que es donde cae el QR: en el resto de
                las pantallas el encabezado se reduce a decir dónde estás. */}
            <TableHeader
              restaurantName={restaurant.name}
              branchName={branch.name}
              tableLabel={currentTable.label}
              compact={!atMenu}
            />

            <SessionPanel
              connecting={joined.isPending}
              connection={failureOf(joined)}
              read={failureOf(session)}
              session={session.data}
              displayName={displayName}
              named={named}
              hasPendingSubmission={!!cart.submissions[cartKey]}
              cartCount={cartCount}
              rename={rename}
              onOpenNewSession={() => {
                setAnnouncement(undefined)
                cart.clear(cartKey)
                void joined.refetch()
              }}
            />

            <div {...(session.data?.status === 'open' && !named ? { inert: true } : {})}>
              <TableNav token={token} cartCount={cartCount} />

              <Toast announcement={announcement} onDismiss={() => setAnnouncement(undefined)} />

              {/* Cada pantalla trae sus avisos y atajos (ver TableChrome). */}
              <Outlet />

              <footer>{design.copy.footer}</footer>
            </div>
          </MenuShell>
        </TableContext>
      </MenuDesignContext>
    </ClockProvider>
  )
}

export function TableMenuPage() {
  const { token, menu, canEdit } = useTable()
  return (
    <>
      <MenuStatus />
      <PendingSubmissionNotice />
      {menu.data && (
        <MenuBrowse
          token={token}
          menu={menu.data}
          canEdit={canEdit}
          freshness={
            <FreshnessNote
              label="la carta"
              updatedAt={menu.dataUpdatedAt || undefined}
              isFetching={menu.isFetching}
            />
          }
        />
      )}
      <CartBar />
    </>
  )
}

export function TableCartPage({ reviewing = false }: { reviewing?: boolean }) {
  const { token, menu, refreshTable, cartKey, items, announce } = useTable()
  const pending = useCart((state) => state.submissions[cartKey])
  const navigate = useNavigate()

  if (reviewing && items.length === 0 && !pending) {
    return <Navigate to={cartPath(token)} replace />
  }

  // Sin aviso de envío pendiente: el carrito ya lo muestra con sus acciones.
  return (
    <>
      <MenuStatus />
      <CartPanel
        key={`${cartKey}:${reviewing ? 'review' : 'edit'}`}
        reviewing={reviewing}
        refreshMenu={() => menu.refetch({ throwOnError: true })}
        onSubmitted={() => {
          announce(
            'Tu pedido fue enviado. Podés seguir su estado y consultar la cuenta de la mesa.',
          )
          navigate(ordersPath(token), { replace: true })
          void refreshTable()
        }}
      />
    </>
  )
}

export function TableProductPage() {
  return (
    <>
      <MenuStatus />
      <PendingSubmissionNotice />
      <ProductScreen />
    </>
  )
}

function ProductScreen() {
  const { token, menu, canEdit, cartKey, announce } = useTable()
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
          Para personalizar y agregar al carrito, la mesa tiene que estar abierta y sin envíos
          pendientes.
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
        announce(`${product.name} guardado en tu carrito`)
        back()
      }}
    />
  )
}

export function TableCartItemPage() {
  return (
    <>
      <MenuStatus />
      <CartItemScreen />
    </>
  )
}

function CartItemScreen() {
  const { token, menu, canEdit, cartKey, items, announce } = useTable()
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
            ? 'Para editar este plato, la mesa tiene que estar abierta y sin envíos pendientes.'
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
        announce(`${product.name} guardado en tu carrito`)
        back()
      }}
    />
  )
}

export function TableOrdersPage() {
  const { menu, canEdit, cartKey, announce } = useTable()
  const reorder = useReorder({ cartKey, menu: menu.data, canEdit, announce })
  // Los pedidos no necesitan la carta para mostrarse, así que no esperan su carga.
  return (
    <>
      <PendingSubmissionNotice />
      <SessionOrders onReorder={reorder} />
      <CartBar />
    </>
  )
}

export function TableCatchAll() {
  const { token = '' } = useParams()
  return <Navigate to={tableRoot(token)} replace />
}
