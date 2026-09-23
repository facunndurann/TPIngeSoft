import { type ReactNode, useCallback, useEffect, useState } from 'react'
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
import { Toast } from '@/components/Toast'
import type { Announce, Announcement } from '@/features/announcements'
import { type CartItem, cartKeyFor, cartLock } from '@/features/cart'
import { CartPanel } from '@/features/CartPanel'
import { MenuBrowse } from '@/features/MenuBrowse'
import { cartPrice, type Product } from '@/features/menu'
import { ProductEditor } from '@/features/ProductEditor'
import { SessionBill } from '@/features/SessionBill'
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
import { useNameGate } from '@/features/name-gate'
import { NameModal } from '@/features/NameModal'
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
  const {
    table,
    menu,
    joined,
    session,
    sessionId,
    refreshTable,
    sessionOpen,
    me,
    nameOf,
    named,
    closed,
    rename,
  } = useTableSession(token)
  const location = useLocation()
  const navigate = useNavigate()
  const [announcement, setAnnouncement] = useState<Announcement>()
  const cart = useCart()
  const cartKey = cartKeyFor(sessionId, joined.data?.userId)
  const items = cart.carts[cartKey] ?? []
  const pending = !!cart.submissions[cartKey]
  const editLock = cartLock({ sessionOpen, closed, pending })
  const nameGate = useNameGate(named)
  const cartCount = items.reduce((total, item) => total + item.quantity, 0)
  const cartTotal = menu.data ? cartPrice(menu.data, items) : 0
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
            me,
            nameOf,
            named,
            requireName: nameGate.requireName,
            sessionOpen,
            closed,
            cartKey,
            items,
            cartTotal,
            paymentMethods: enabledPaymentMethods(branch),
            editLock,
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

            {/* Lo que el panel sabe de la mesa lo lee del contexto; acá solo recibe el
                ingreso, que es de esta pantalla, y lo que puede hacer. */}
            <SessionPanel
              connecting={joined.isPending}
              connection={failureOf(joined)}
              rename={rename}
              onOpenNewSession={() => {
                setAnnouncement(undefined)
                cart.clear(cartKey)
                void joined.refetch()
              }}
            />

            {nameGate.asking && (
              <NameModal
                rename={rename}
                // Mientras hay un envío sin resolver el nombre queda como está, igual que en el chip.
                canSave={rename.canSubmit && !pending}
                onSaved={nameGate.resolve}
                onCancel={nameGate.cancel}
              />
            )}

            <div {...(nameGate.asking ? { inert: true } : {})}>
              <TableNav token={token} cartCount={cartCount} />

              {/* El aviso se va solo cuando termina su salida: cada aviso nuevo remonta el
                  suyo, así uno anterior nunca puede cerrar al siguiente. */}
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
  const { token, menu } = useTable()
  return (
    <>
      <MenuStatus />
      <PendingSubmissionNotice />
      {/* Sin «Actualizado hace…»: la carta se relee sola y a quien la recorre no le
          cambia nada saber cuándo; eso queda para Pedidos y Cuenta, que sí se mueven. */}
      {menu.data && <MenuBrowse token={token} menu={menu.data} />}
      <CartBar />
    </>
  )
}

export function TableCartPage() {
  const { token, menu, refreshTable, cartKey, announce } = useTable()
  const navigate = useNavigate()

  // Sin aviso de envío pendiente: el carrito ya lo muestra con sus acciones.
  return (
    <>
      <MenuStatus />
      <CartPanel
        // Quien empieza de nuevo en la mesa estrena carrito: el panel arranca sin los
        // errores ni el refresco de carta que había dejado el envío anterior.
        key={cartKey}
        refreshMenu={() => menu.refetch({ throwOnError: true })}
        onSubmitted={() => {
          announce(
            'Tu pedido fue enviado. Podés seguir su estado y consultar la cuenta de la mesa.',
          )
          // Reemplaza al carrito recién vaciado: volver atrás desde Pedidos lleva a la carta.
          navigate(ordersPath(token), { replace: true })
          void refreshTable()
        }}
      />
    </>
  )
}

export function TableProductPage() {
  // Sin aviso de envío pendiente arriba: si lo hay, lo dice el botón del plato, que
  // es donde frena. Dos veces el mismo mensaje en una pantalla es ruido.
  return (
    <>
      <MenuStatus />
      <ProductScreen />
    </>
  )
}

function ProductScreen() {
  const { token, menu } = useTable()
  const { productId = '' } = useParams()
  const location = useLocation()
  const back = useTableBack(`${menuPath(token)}${location.search}`)
  const product = menu.data?.productsById.get(productId)

  if (!menu.data) return null
  if (!product) {
    return (
      <BackWithNotice onBack={back}>
        <p className="empty">No encontramos este plato.</p>
      </BackWithNotice>
    )
  }

  return <CartItemEditor product={product} back={back} />
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
  const { token, menu, items } = useTable()
  const { itemId = '' } = useParams()
  const back = useTableBack(cartPath(token))
  const item = items.find((entry) => entry.id === itemId)
  const product = item && menu.data?.productsById.get(item.productId)

  if (!item) return <Navigate to={cartPath(token)} replace />
  if (!menu.data) return null
  if (!product) {
    return (
      <BackWithNotice onBack={back}>
        <p className="notice">Este plato ya no está en la carta.</p>
      </BackWithNotice>
    )
  }

  return <CartItemEditor product={product} initial={item} back={back} />
}

/**
 * Armar un plato para el carrito, nuevo o ya guardado. El plato se muestra siempre:
 * si la mesa no admite cambios, se apaga solo el botón y dice por qué. Al guardar
 * se avisa y se vuelve a donde se estaba.
 */
function CartItemEditor({
  product,
  initial,
  back,
}: {
  product: Product
  /** La línea que se edita; sin ella, el plato entra como línea nueva. */
  initial?: CartItem
  back: () => void
}) {
  const { editLock, cartKey, announce, requireName } = useTable()
  const save = useCart((state) => state.save)

  return (
    <ProductEditor
      key={initial?.id ?? product.id}
      product={product}
      initial={initial}
      locked={editLock}
      onClose={back}
      // El primer plato es el que pide el nombre: guardado, el plato entra solo.
      onSave={(item) => requireName(() => {
        save(cartKey, item)
        announce(`${product.name} guardado en tu carrito`)
        back()
      })}
    />
  )
}

/** La pantalla que no puede mostrar lo pedido: la vuelta y el porqué. */
function BackWithNotice({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  return (
    <section>
      <button className="text-button" onClick={onBack}>
        ← Volver
      </button>
      {children}
    </section>
  )
}

export function TableOrdersPage() {
  const { menu, editLock, cartKey, announce, requireName } = useTable()
  const reorder = useReorder({ cartKey, menu: menu.data, canEdit: !editLock, announce })
  // Los pedidos no necesitan la carta para mostrarse, así que no esperan su carga.
  return (
    <>
      <PendingSubmissionNotice />
      <SessionOrders onReorder={reorder && ((order) => requireName(() => reorder(order)))} />
      <CartBar />
    </>
  )
}

export function TableBillPage() {
  // Un envío sin resolver todavía puede sumar a la cuenta: se avisa antes de pagar.
  // Sin barra del carrito: acá se paga lo pedido, no se sigue pidiendo.
  return (
    <>
      <PendingSubmissionNotice />
      <SessionBill />
    </>
  )
}

export function TableCatchAll() {
  const { token = '' } = useParams()
  return <Navigate to={tableRoot(token)} replace />
}
