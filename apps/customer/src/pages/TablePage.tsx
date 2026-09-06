import { useState } from 'react'
import { useParams } from 'react-router'
import { ErrorMessage } from '@/components/ErrorMessage'
import { CartPanel } from '@/features/CartPanel'
import { MenuBrowse } from '@/features/MenuBrowse'
import { cartPrice, money } from '@/features/menu'
import { ProductEditor } from '@/features/ProductEditor'
import { SessionOrders } from '@/features/SessionOrders'
import { SessionPanel } from '@/features/SessionPanel'
import { TableHeader } from '@/features/TableHeader'
import { TableNav, type TableView } from '@/features/TableNav'
import { useTableSession } from '@/hooks/useTableSession'
import { useCart } from '@/stores/cart'
import type { CartItem } from '@/stores/cart'

export function TableRoute() {
  const { token = '' } = useParams()
  return <TableApp key={token} token={token} />
}

function TableApp({ token }: { token: string }) {
  const { client, table, menu, joined, session, sessionId, name, setName, rename } =
    useTableSession(token)

  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [view, setView] = useState<TableView>('menu')
  const [editing, setEditing] = useState<{ productId: string; item?: CartItem }>()
  const [announcement, setAnnouncement] = useState('')

  const cart = useCart()
  const cartKey = `${sessionId ?? ''}:${joined.data?.userId ?? ''}`
  const items = cart.carts[cartKey] ?? []
  const sessionOpen = session.data?.status === 'open' && !session.isError
  const canEdit = sessionOpen && !cart.submissions[cartKey]
  const cartCount = items.reduce((total, item) => total + item.quantity, 0)

  function show(next: TableView) {
    setView(next)
    setEditing(undefined)
  }

  if (table.isPending) {
    return (
      <main className="shell" role="status">
        Buscando tu mesa…
      </main>
    )
  }

  if (table.isError) {
    return (
      <main className="shell">
        <h1>No pudimos abrir esta mesa</h1>
        <ErrorMessage error={table.error} retry={() => { void table.refetch() }} />
      </main>
    )
  }

  const { restaurant, branch, table: currentTable } = table.data
  const product = menu.data?.products.find((entry) => entry.id === editing?.productId)
  const total = menu.data ? cartPrice(menu.data, items) : 0

  return (
    <main className="shell">
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
          setEditing(undefined)
          setAnnouncement('')
          void joined.refetch()
        }}
      />

      <TableNav view={view} cartCount={cartCount} onChange={show} />

      {announcement && (
        <p className="success-notice" role="status">
          {announcement}
        </p>
      )}

      {view !== 'orders' && menu.isPending && <p role="status">Cargando la carta…</p>}
      {view !== 'orders' && menu.isError && (
        <ErrorMessage error={menu.error} retry={() => { void menu.refetch() }} />
      )}

      {view !== 'cart' && cart.submissions[cartKey] && (
        <div className="notice">
          <p>Tu último envío todavía necesita confirmación.</p>
          <button onClick={() => show('cart')}>Consultar o reintentar envío</button>
        </div>
      )}

      {editing && product && menu.data && canEdit ? (
        <ProductEditor
          key={editing.item?.id ?? product.id}
          menu={menu.data}
          product={product}
          initial={editing.item}
          onClose={() => setEditing(undefined)}
          onSave={(item) => {
            cart.save(cartKey, item)
            setEditing(undefined)
            setAnnouncement(`${product.name} guardado en tu carrito`)
          }}
        />
      ) : view === 'menu' && menu.data ? (
        <MenuBrowse
          menu={menu.data}
          category={category}
          search={search}
          canEdit={canEdit}
          onCategoryChange={setCategory}
          onSearchChange={setSearch}
          onSelectProduct={(productId) => setEditing({ productId })}
        />
      ) : view === 'cart' ? (
        <CartPanel
          key={cartKey}
          cartKey={cartKey}
          sessionId={sessionId}
          menu={menu.data}
          canEdit={sessionOpen}
          onEdit={(item) => setEditing({ productId: item.productId, item })}
          refreshMenu={() => menu.refetch({ throwOnError: true })}
          onSubmitted={() => {
            setAnnouncement(
              'Tu pedido fue enviado. Podés seguir su estado y consultar la cuenta de la mesa.',
            )
            setView('orders')
            void client.invalidateQueries({ queryKey: ['orders', sessionId] })
            void client.invalidateQueries({ queryKey: ['bill', sessionId] })
          }}
        />
      ) : view === 'orders' ? (
        <SessionOrders
          sessionId={sessionId}
          participants={session.data?.participants ?? []}
          userId={joined.data?.userId}
          closed={session.data?.status === 'closed'}
        />
      ) : null}

      {view === 'menu' && !editing && items.length > 0 && (
        <button className="primary cart-bar" onClick={() => setView('cart')}>
          Ver mi carrito <strong>{money(total)}</strong>
        </button>
      )}

      <footer>Disfrutá a tu ritmo · Pedí desde tu mesa</footer>
    </main>
  )
}
