import { useEffect, useState } from 'react'
import { Link, Route, Routes, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { participantNameSchema } from '@restaurant-platform/shared'
import { money, price, selectionErrors } from './features/menu'
import { loadMenu, loadTable } from './features/menu-api'
import { joinSession, loadSession } from './features/session'
import { ProductEditor } from './features/ProductEditor'
import { useCart } from './stores/cart'
import type { CartItem } from './stores/cart'
import { supabase } from './lib/supabase'

function ErrorMessage({ error, retry }: { error: unknown; retry: () => void }) {
  return <div className="notice" role="alert"><p>{error instanceof Error ? error.message : 'No pudimos conectar. Revisá tu conexión e intentá nuevamente.'}</p><button onClick={retry}>Reintentar</button></div>
}
function TableRoute() {
  const { token = '' } = useParams()
  return <TableApp key={token} token={token} />
}
function TableApp({ token }: { token: string }) {
  const client = useQueryClient()
  const table = useQuery({ queryKey: ['table', token], queryFn: () => loadTable(token) })
  const menu = useQuery({ queryKey: ['menu', table.data?.restaurant.id], queryFn: () => loadMenu(table.data!.restaurant.id), enabled: !!table.data, refetchInterval: 60000 })
  const joined = useQuery({ queryKey: ['join', token], queryFn: () => joinSession(token), enabled: !!table.data, staleTime: Infinity, gcTime: 0, retry: false })
  const sessionId = joined.data?.id
  const session = useQuery({ queryKey: ['session', sessionId], queryFn: () => loadSession(sessionId!), enabled: !!sessionId, refetchInterval: 15000 })
  useEffect(() => {
    if (!sessionId) return
    const refresh = () => { void client.invalidateQueries({ queryKey: ['session', sessionId] }) }
    const channel = supabase.channel(`table-${sessionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'session_participants', filter: `session_id=eq.${sessionId}` }, refresh)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'table_sessions', filter: `id=eq.${sessionId}` }, refresh)
      .subscribe(status => { if (status === 'SUBSCRIBED') refresh() })
    return () => { void supabase.removeChannel(channel) }
  }, [sessionId, client])
  const [name, setName] = useState('')
  const rename = useMutation({ mutationFn: async () => {
    const validName = participantNameSchema.parse(name)
    const result = await joinSession(token, validName)
    client.setQueryData(['join', token], result)
    await client.invalidateQueries({ queryKey: ['session', result.id] })
  } })
  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'menu' | 'cart'>('menu')
  const [editing, setEditing] = useState<{ productId: string; item?: CartItem }>()
  const [announcement, setAnnouncement] = useState('')
  const cart = useCart()
  const key = `${sessionId ?? ''}:${joined.data?.userId ?? ''}`
  const items = cart.carts[key] ?? []
  const canEdit = session.data?.status === 'open' && !session.isError
  if (table.isPending) return <main className="shell" role="status">Buscando tu mesa…</main>
  if (table.isError) return <main className="shell"><h1>No pudimos abrir esta mesa</h1><ErrorMessage error={table.error} retry={() => { void table.refetch() }} /></main>
  const { restaurant, branch, table: currentTable } = table.data
  const currentParticipant = session.data?.participants.find(p => p.user_id === joined.data?.userId)
  const product = menu.data?.products.find(p => p.id === editing?.productId)
  const total = menu.data ? items.reduce((sum, item) => {
    const p = menu.data.products.find(p => p.id === item.productId)
    return sum + (p ? price(menu.data, p, item) : 0)
  }, 0) : 0
  return <main className="shell">
    <header><p className="eyebrow">BIENVENIDOS A LA MESA</p><h1>{restaurant.name}</h1><p>{branch.name} <span className="badge">{currentTable.label}</span></p></header>
    <section className="session-panel" aria-label="Tu mesa">
      {joined.isPending && <p role="status">Conectando con tu mesa…</p>}
      {joined.isError && <ErrorMessage error={joined.error} retry={() => { void joined.refetch() }} />}
      {session.isError && <ErrorMessage error={session.error} retry={() => { void session.refetch() }} />}
      {session.data && <><p><strong>{currentParticipant?.display_name ?? 'Comensal'}</strong> · {session.data.participants.length} en la mesa</p><p className="muted">{session.data.participants.map(p => p.display_name).join(' · ')}</p>
        {session.data.status === 'closed' ? <div className="notice"><p>Esta sesión se cerró. Tu carrito anterior no se enviará.</p><button onClick={() => { setEditing(undefined); void joined.refetch() }}>Abrir una nueva sesión</button></div> : <form className="name-form" onSubmit={e => { e.preventDefault(); rename.mutate() }}>
          <label className="sr-only" htmlFor="name">Tu nombre</label><input id="name" placeholder="Tu nombre para la mesa" value={name} maxLength={40} required onChange={e => setName(e.target.value)} /><button disabled={rename.isPending || !name.trim()}>Guardar nombre</button>
          {rename.isError && <p role="alert">No pudimos guardar el nombre. Usá entre 1 y 40 caracteres e intentá nuevamente.</p>}
        </form>}</>}
    </section>
    <nav className="tabs" aria-label="Navegación"><button aria-pressed={view === 'menu'} onClick={() => { setView('menu'); setEditing(undefined) }}>La carta</button><button aria-pressed={view === 'cart'} onClick={() => { setView('cart'); setEditing(undefined) }}>Mi carrito ({items.reduce((n, i) => n + i.quantity, 0)})</button></nav>
    <p className="sr-only" role="status">{announcement}</p>
    {menu.isPending && <p role="status">Cargando la carta…</p>}
    {menu.isError && <ErrorMessage error={menu.error} retry={() => { void menu.refetch() }} />}
    {menu.data && (editing && product && canEdit ? <ProductEditor key={editing.item?.id ?? product.id} menu={menu.data} product={product} initial={editing.item} onClose={() => setEditing(undefined)} onSave={item => { cart.save(key, item); setEditing(undefined); setAnnouncement(`${product.name} guardado en tu carrito`) }} /> : view === 'menu' ? <>
      <div className="menu-heading"><div><p className="eyebrow">HECHO PARA DISFRUTAR</p><h2>¿Qué te gustaría pedir?</h2></div><label className="sr-only" htmlFor="search">Buscar platos</label><input id="search" type="search" placeholder="Buscar en la carta…" value={search} onChange={e => setSearch(e.target.value)} /></div>
      <div className="categories" aria-label="Categorías"><button aria-pressed={category === 'all'} onClick={() => setCategory('all')}>Todo</button>{menu.data.categories.map(c => <button key={c.id} aria-pressed={category === c.id} onClick={() => setCategory(c.id)}>{c.name}</button>)}</div>
      {menu.data.categories.filter(c => category === 'all' || c.id === category).map(c => {
        const products = menu.data.products.filter(p => p.category_id === c.id && `${p.name} ${p.description ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
        return products.length > 0 && <section key={c.id}><h2>{c.name}</h2><div className="product-grid">{products.map(p => <button className="product-card" key={p.id} disabled={!p.is_available || !canEdit} onClick={() => setEditing({ productId: p.id })}>
          <div><h3>{p.name}</h3><p>{p.description}</p>{p.dietary_tags.length > 0 && <small>{p.dietary_tags.join(' · ')}</small>}<strong>{money(p.base_price)}</strong>{!p.is_available && <span className="unavailable">Agotado</span>}</div>{p.photo_url && <img src={p.photo_url} alt="" loading="lazy" />}
        </button>)}</div></section>
      })}
      {!menu.data.products.some(p => menu.data.categories.some(c => c.id === p.category_id) && (category === 'all' || p.category_id === category) && `${p.name} ${p.description ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) && <p className="empty">No hay platos para mostrar. Probá otra búsqueda o categoría.</p>}
    </> : <section><p className="eyebrow">ANTES DE PEDIR</p><h2>Tu carrito</h2><p className="muted">Este carrito es tuyo. Los demás comensales arman el suyo en la misma sesión de mesa.</p>
      {items.length === 0 && <p className="empty">Tu carrito está vacío. Explorá la carta para agregar algo rico.</p>}
      {items.map(item => {
        const p = menu.data.products.find(p => p.id === item.productId)
        const errors = p ? selectionErrors(menu.data, p, item) : ['El producto ya no está en la carta.']
        return <article className="cart-item" key={item.id}><h3>{p?.name ?? 'Producto eliminado'} {item.isShared && <span className="badge">Para compartir</span>}</h3>
          <p>Base: {p ? money(p.base_price) : '—'}</p>
          {item.optionIds.map(id => { const o = menu.data.options.find(o => o.id === id); return <p key={id}>+ {o ? `${o.name} (${money(o.price_delta)})` : 'Opción eliminada'}</p> })}
          {item.removedIds.map(id => <p key={id}>Sin {menu.data.ingredients.find(i => i.id === id)?.name ?? 'ingrediente eliminado'}</p>)}
          <div className="cart-actions"><label>Cantidad <input type="number" min="1" max="99" value={item.quantity} disabled={!canEdit} onChange={e => { const quantity = Number(e.target.value); if (Number.isInteger(quantity) && quantity >= 1 && quantity <= 99) cart.save(key, { ...item, quantity }) }} /></label><strong>{p ? money(price(menu.data, p, item)) : '—'}</strong></div>
          {errors.length > 0 && <p className="notice">{errors.join(' ')}</p>}
          <div className="cart-actions"><button disabled={!p || !canEdit} onClick={() => setEditing({ productId: item.productId, item })}>Editar plato</button><button onClick={() => cart.remove(key, item.id)}>Eliminar</button></div>
        </article>
      })}
      {items.length > 0 && <><div className="total"><span>Total estimado</span><strong>{money(total)}</strong></div><p className="notice">Productos sin enviar. La confirmación y el envío de pedidos estarán disponibles en la próxima etapa.</p></>}
    </section>)}
    {view === 'menu' && !editing && items.length > 0 && <button className="primary cart-bar" onClick={() => setView('cart')}>Ver mi carrito <strong>{money(total)}</strong></button>}
    <footer>Disfrutá a tu ritmo · Pedí desde tu mesa</footer>
  </main>
}
export default function App() {
  return <Routes><Route path="/m/:token" element={<TableRoute />} /><Route path="*" element={<main className="shell landing"><p className="eyebrow">BIENVENIDO</p><h1>Tu mesa, a tu gusto.</h1><p>Escaneá el QR de tu mesa para explorar la carta y armar tu pedido.</p><Link to="/">Inicio</Link></main>} /></Routes>
}
