import { useQuery } from '@tanstack/react-query'
import { orderStatusLabels } from '@restaurant-platform/shared'
import type { Tables } from '@restaurant-platform/shared'
import { loadBill, loadOrders } from './orders-api'
import { money } from './menu'

type Props = { sessionId?: string; participants: Tables<'session_participants'>[]; userId?: string; closed: boolean }

export function SessionOrders({ sessionId, participants, userId, closed }: Props) {
  const orders = useQuery({ queryKey: ['orders', sessionId], queryFn: () => loadOrders(sessionId!), enabled: !!sessionId, refetchInterval: 15000 })
  const bill = useQuery({ queryKey: ['bill', sessionId], queryFn: () => loadBill(sessionId!), enabled: !!sessionId, refetchInterval: 15000 })
  const participantName = (id: string | null) => {
    const participant = participants.find(p => p.id === id)
    return `${participant?.display_name ?? 'Comensal'}${participant?.user_id === userId ? ' (vos)' : ''}`
  }
  if (!sessionId) return <section><h2>Pedidos y cuenta</h2><p className="notice">Conectate con tu mesa para consultar sus pedidos y cuenta.</p></section>

  return <section aria-label="Pedidos y cuenta de la mesa">
    <p className="eyebrow">TODOS EN LA MISMA MESA</p><h2>Pedidos y cuenta</h2>
    <p className="muted">Los pedidos de todos los comensales se actualizan automáticamente. {closed && 'Esta sesión está cerrada; podés seguir consultando el detalle.'}</p>
    {bill.isPending && <p role="status">Actualizando la cuenta…</p>}
    {bill.isError && <div className="notice" role="alert"><p>No pudimos actualizar la cuenta.</p><button onClick={() => { void bill.refetch() }}>Reintentar cuenta</button></div>}
    {bill.data && <div className="bill-panel" aria-label="Resumen de cuenta">
      <dl className="bill-grid">
        <div><dt>Enviado, por confirmar</dt><dd>{money(bill.data.submitted_amount ?? 0)}</dd></div>
        <div><dt>En cuenta</dt><dd>{money(bill.data.total_amount ?? 0)}</dd></div>
        <div><dt>Pagado</dt><dd>{money(bill.data.paid_amount ?? 0)}</dd></div>
        <div><dt>Pendiente de pago</dt><dd>{money(bill.data.pending_amount ?? 0)}</dd></div>
      </dl>
      <p className="muted">Los pedidos aceptados por el restaurante forman parte de la cuenta. Los enviados esperan confirmación y los cancelados no se cobran. Pagado incluye únicamente pagos aprobados.</p>
      {bill.data.is_settled && (bill.data.total_amount ?? 0) > 0 && <p className="settled">Cuenta pagada</p>}
    </div>}
    {orders.isPending && <p role="status">Cargando los pedidos…</p>}
    {orders.isError && <div className="notice" role="alert"><p>No pudimos actualizar los pedidos.</p><button onClick={() => { void orders.refetch() }}>Reintentar pedidos</button></div>}
    {orders.data?.length === 0 && <p className="empty">Todavía no hay pedidos enviados en esta mesa.</p>}
    {orders.data?.map(order => <article className="order-card" key={order.id}>
      <div className="order-heading"><h3>Pedido de {participantName(order.submitted_by)}</h3><span className={`badge status-${order.status}`}>{orderStatusLabels[order.status]}</span></div>
      <p className="muted">{new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(order.created_at))} · #{order.id.slice(0, 8)}</p>
      {order.status === 'submitted' && <p className="muted">Esperando confirmación del restaurante. Aún no está en cuenta.</p>}
      {order.status === 'cancelled' && <p className="muted">Este pedido fue cancelado y no se cobra.</p>}
      {order.order_items.map(item => <div className="order-line" key={item.id}>
        <div className="order-heading"><h3>{item.quantity} × {item.product_name}</h3><strong>{money(item.total_price)}</strong></div>
        <p className="muted">{item.is_shared ? 'Para compartir en la mesa' : participantName(item.participant_id)} · Base por unidad: {money(item.base_price)}</p>
        {item.order_item_modifiers.map(modifier => <p key={modifier.id}>+ {modifier.group_name}: {modifier.option_name} ({money(modifier.price_delta)} por unidad)</p>)}
        {item.order_item_removed_ingredients.map(ingredient => <p key={ingredient.id}>Sin {ingredient.ingredient_name}</p>)}
        {item.notes && <p>{item.notes}</p>}
      </div>)}
      {order.notes && <p>{order.notes}</p>}
      <div className="total"><span>Total del pedido</span><strong>{money(order.total_amount)}</strong></div>
    </article>)}
  </section>
}
