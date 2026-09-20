import { type ReactNode, useCallback, useEffect, useState } from 'react'
import {
  Link,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router'
import { enabledPaymentMethods, formatPrice, MENU_DESIGNS } from '@restaurant-platform/shared'
import { ErrorMessage } from '@/components/ErrorMessage'
import { FreshnessNote } from '@/components/FreshnessNote'
import { Toast } from '@/components/Toast'
import { type Announce, type Announcement, toastDuration } from '@/features/announcements'
import { cartKeyFor } from '@/features/cart'
import { ClockContext } from '@/features/clock'
import { CartPanel } from '@/features/CartPanel'
import { MenuBrowse } from '@/features/MenuBrowse'
import { cartPrice } from '@/features/menu'
import { ProductEditor } from '@/features/ProductEditor'
import { SessionOrders } from '@/features/SessionOrders'
import { type Failure, SessionPanel } from '@/features/SessionPanel'
import { useAttentionAnnouncements } from '@/features/service-requests'
import { TableContext, useTable } from '@/features/table-context'
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
import { AGE_TICK_MS } from '@/features/freshness'
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

/**
 * Un solo intervalo para toda la mesa. El estado vive acá y no en `TableApp`:
 * `children` entra como prop y no cambia con el tic, así que React solo vuelve a
 * dibujar a quien lee la hora, no a la pantalla entera.
 */
function ClockProvider({ children }: { children: ReactNode }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), AGE_TICK_MS)
    return () => clearInterval(timer)
  }, [])

  return <ClockContext value={now}>{children}</ClockContext>
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
  const { client, table, menu, joined, session, sessionId, displayName, named, rename } =
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
  const section = tableSection(location.pathname)
  const atMenu = isMenuIndex(location.pathname)
  const total = menu.data ? cartPrice(menu.data, items) : 0

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
        <ErrorMessage
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
            client,
            menu,
            session,
            sessionId,
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

            <TableNav token={token} cartCount={cartCount} />

            <Toast announcement={announcement} onDismiss={() => setAnnouncement(undefined)} />

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

            {(atMenu || section === 'orders') && items.length > 0 && (
              <Link className="primary cart-bar" to={cartPath(token)}>
                Ver mi carrito <strong>{formatPrice(total)}</strong>
              </Link>
            )}

            <footer>{design.copy.footer}</footer>
          </MenuShell>
        </TableContext>
      </MenuDesignContext>
    </ClockProvider>
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
  const { token, client, menu, sessionId, cartKey, items, announce } = useTable()
  const pending = useCart((state) => state.submissions[cartKey])
  const navigate = useNavigate()

  if (reviewing && items.length === 0 && !pending) {
    return <Navigate to={cartPath(token)} replace />
  }

  return (
    <CartPanel
      key={`${cartKey}:${reviewing ? 'review' : 'edit'}`}
      reviewing={reviewing}
      refreshMenu={() => menu.refetch({ throwOnError: true })}
      onSubmitted={() => {
        announce(
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
  const { menu, canEdit, cartKey, announce, paymentMethods } = useTable()
  const reorder = useReorder({ cartKey, menu: menu.data, canEdit, announce })
  return <SessionOrders paymentMethods={paymentMethods} onReorder={reorder} />
}

export function TableCatchAll() {
  const { token = '' } = useParams()
  return <Navigate to={tableRoot(token)} replace />
}
