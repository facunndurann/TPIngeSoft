import { useQuery } from '@tanstack/react-query'
import { orderStatusLabels } from '@restaurant-platform/shared'
import type { Tables } from '@restaurant-platform/shared'
import { loadBill, loadOrders } from '@/features/orders-api'
import { money } from '@/features/menu'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { updateSessionSplit } from '@/features/orders-api'
import type { loadSession } from '@/features/session'

type SessionData = Awaited<ReturnType<typeof loadSession>>
type Participant = Tables<'session_participants'>
type Order = Awaited<ReturnType<typeof loadOrders>>[number]
type OrderItem = Order['order_items'][number]
type Bill = Awaited<ReturnType<typeof loadBill>>

type SessionOrdersProps = {
  sessionId?: string
  session?: SessionData
  participants: Participant[]
  userId?: string
  closed: boolean
}

export function SessionOrders({ sessionId, session, participants, userId, closed }: SessionOrdersProps) {
  const orders = useQuery({
    queryKey: ['orders', sessionId],
    queryFn: () => loadOrders(sessionId!),
    enabled: !!sessionId,
    refetchInterval: 15000,
  })
  const bill = useQuery({
    queryKey: ['bill', sessionId],
    queryFn: () => loadBill(sessionId!),
    enabled: !!sessionId,
    refetchInterval: 15000,
  })

  const participantName = (id: string | null) => {
    const participant = participants.find((entry) => entry.id === id)
    const suffix = participant?.user_id === userId ? ' (vos)' : ''
    return `${participant?.display_name ?? 'Comensal'}${suffix}`
  }

  if (!sessionId) {
    return (
      <section>
        <h2>Pedidos y cuenta</h2>
        <p className="notice">Conectate con tu mesa para consultar sus pedidos y cuenta.</p>
      </section>
    )
  }

  return (
    <section aria-label="Pedidos y cuenta de la mesa">
      <p className="eyebrow">TODOS EN LA MISMA MESA</p>
      <h2>Pedidos y cuenta</h2>
      <p className="muted">
        Los pedidos de todos los comensales se actualizan automáticamente.{' '}
        {closed && 'Esta sesión está cerrada; podés seguir consultando el detalle.'}
      </p>

      {bill.isPending && <p role="status">Actualizando la cuenta…</p>}
      {bill.isError && (
        <div className="notice" role="alert">
          <p>No pudimos actualizar la cuenta.</p>
          <button onClick={() => { void bill.refetch() }}>Reintentar cuenta</button>
        </div>
      )}
      {bill.data && <BillSummary bill={bill.data} />}

      {orders.isPending && <p role="status">Cargando los pedidos…</p>}
      {orders.isError && (
        <div className="notice" role="alert">
          <p>No pudimos actualizar los pedidos.</p>
          <button onClick={() => { void orders.refetch() }}>Reintentar pedidos</button>
        </div>
      )}
      {orders.data?.length === 0 && (
        <p className="empty">Todavía no hay pedidos enviados en esta mesa.</p>
      )}
      {orders.data?.map((order) => (
        <OrderCard key={order.id} order={order} participantName={participantName} />
      ))}
      {bill.data && session && (
        <BillSplitter 
          session={session} 
          bill={bill.data} 
          orders={orders.data}
          participants={participants} 
          userId={userId} 
        />
      )}
    </section>
  )
}

function BillSummary({ bill }: { bill: Bill }) {
  return (
    <div className="bill-panel" aria-label="Resumen de cuenta">
      <dl className="bill-grid">
        <div>
          <dt>Enviado, por confirmar</dt>
          <dd>{money(bill.submitted_amount ?? 0)}</dd>
        </div>
        <div>
          <dt>En cuenta</dt>
          <dd>{money(bill.total_amount ?? 0)}</dd>
        </div>
        <div>
          <dt>Pagado</dt>
          <dd>{money(bill.paid_amount ?? 0)}</dd>
        </div>
        <div>
          <dt>Pendiente de pago</dt>
          <dd>{money(bill.pending_amount ?? 0)}</dd>
        </div>
      </dl>
      <p className="muted">
        Los pedidos aceptados por el restaurante forman parte de la cuenta. Los enviados esperan
        confirmación y los cancelados no se cobran. Pagado incluye únicamente pagos aprobados.
      </p>
      {bill.is_settled && (bill.total_amount ?? 0) > 0 && <p className="settled">Cuenta pagada</p>}
    </div>
  )
}

function OrderCard({
  order,
  participantName,
}: {
  order: Order
  participantName: (id: string | null) => string
}) {
  const createdAt = new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(order.created_at))

  return (
    <article className="order-card">
      <div className="order-heading">
        <h3>Pedido de {participantName(order.submitted_by)}</h3>
        <span className={`badge status-${order.status}`}>{orderStatusLabels[order.status]}</span>
      </div>
      <p className="muted">
        {createdAt} · #{order.id.slice(0, 8)}
      </p>
      {order.status === 'submitted' && (
        <p className="muted">Esperando confirmación del restaurante. Aún no está en cuenta.</p>
      )}
      {order.status === 'cancelled' && (
        <p className="muted">Este pedido fue cancelado y no se cobra.</p>
      )}
      {order.order_items.map((item) => (
        <OrderLine key={item.id} item={item} participantName={participantName} />
      ))}
      {order.notes && <p>{order.notes}</p>}
      <div className="total">
        <span>Total del pedido</span>
        <strong>{money(order.total_amount)}</strong>
      </div>
    </article>
  )
}

function OrderLine({
  item,
  participantName,
}: {
  item: OrderItem
  participantName: (id: string | null) => string
}) {
  const owner = item.is_shared ? 'Para compartir en la mesa' : participantName(item.participant_id)

  return (
    <div className="order-line">
      <div className="order-heading">
        <h3>
          {item.quantity} × {item.product_name}
        </h3>
        <strong>{money(item.total_price)}</strong>
      </div>
      <p className="muted">
        {owner} · Base por unidad: {money(item.base_price)}
      </p>
      {item.order_item_modifiers.map((modifier) => (
        <p key={modifier.id}>
          + {modifier.group_name}: {modifier.option_name} ({money(modifier.price_delta)} por unidad)
        </p>
      ))}
      {item.order_item_removed_ingredients.map((ingredient) => (
        <p key={ingredient.id}>Sin {ingredient.ingredient_name}</p>
      ))}
      {item.notes && <p>{item.notes}</p>}
    </div>
  )
}

function BillSplitter({
  session,
  bill,
  orders,
  participants,
  userId,
}: {
  session: SessionData
  bill: Bill
  orders?: Order[]
  participants: Participant[]
  userId?: string
}) {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  
  const currentType = session?.split_type || 'none';
  const currentAllocations = (session?.split_allocations as Record<string, number>) || {};

  const [mode, setMode] = useState<'none' | 'equal' | 'percentages'>(currentType as 'none' | 'equal' | 'percentages');
  const [allocations, setAllocations] = useState<Record<string, number>>(currentAllocations);

  const total = bill.pending_amount ?? 0;

  const mutation = useMutation({
    mutationFn: () => updateSessionSplit(session.id, mode, allocations),
    onSuccess: () => {
      setIsEditing(false);
      queryClient.invalidateQueries({ queryKey: ['session', session.id] });
    }
  });

  if (total === 0) return null;

  const individualTotals: Record<string, number> = {};
  let sharedTotal = 0;
  
  participants.forEach((p: Participant) => individualTotals[p.id] = 0);

  orders?.forEach((order: Order) => {
    if (['accepted', 'in_preparation', 'ready', 'delivered'].includes(order.status)) {
      order.order_items.forEach((item: OrderItem) => {
        if (item.is_shared) {
          sharedTotal += Number(item.total_price);
        } else if (item.participant_id) {
          individualTotals[item.participant_id] = (individualTotals[item.participant_id] || 0) + Number(item.total_price);
        }
      });
    }
  });

  const sharedPerPerson = participants.length > 0 ? sharedTotal / participants.length : 0;

  // 1. Vista de Lectura
  if (!isEditing) {
    return (
      <div className="bill-panel" style={{ marginTop: '24px' }}>
        <h3>División de la cuenta</h3>
        
        <p className="muted">
          {currentType === 'none' && 'Cada uno paga lo que pidió (y lo compartido se divide).'}
          {currentType === 'equal' && 'Dividido en partes iguales.'}
          {currentType === 'percentages' && 'Dividido por porcentajes.'}
        </p>

        <ul style={{ listStyle: 'none', padding: 0, margin: '16px 0' }}>
          {participants.map((p: Participant) => {
            const isMe = p.user_id === userId;
            let amount = 0;
            
            if (currentType === 'none') {
              amount = (individualTotals[p.id] || 0) + sharedPerPerson;
            } else if (currentType === 'equal') {
              amount = total / participants.length;
            } else if (currentType === 'percentages') {
              const pct = currentAllocations[p.id] || 0;
              amount = (total * pct) / 100;
            }

            return (
              <li key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--menu-border)' }}>
                <span style={{ fontWeight: isMe ? 'bold' : 'normal', color: 'var(--menu-text)' }}>
                  {p.display_name} {isMe && '(vos)'}
                </span>
                {amount === 0 ? (
                  <span className="muted" style={{ fontSize: '0.9em' }}>No debe nada</span>
                ) : (
                  <strong style={{ color: 'var(--menu-heading)' }}>{money(amount)}</strong>
                )}
              </li>
            );
          })}
        </ul>

        <div className="cart-actions" style={{ marginTop: '16px' }}>
          <button onClick={() => {
            setMode(currentType as 'none' | 'equal' | 'percentages');
            setAllocations(currentAllocations);
            setIsEditing(true);
          }}>
            {currentType === 'none' ? 'Dividir cuenta' : 'Editar división'}
          </button>
        </div>
      </div>
    );
  }

  // 2. Vista de Edición
  const sum = Object.values(allocations).reduce((a, b) => a + (Number(b) || 0), 0);
  const isValid = mode !== 'percentages' || sum === 100;

  return (
    <div className="bill-panel" style={{ marginTop: '24px' }}>
      <h3>¿Cómo quieren dividir la cuenta?</h3>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <button className={mode === 'none' ? 'primary' : ''} onClick={() => setMode('none')}>Cada uno lo suyo</button>
        <button className={mode === 'equal' ? 'primary' : ''} onClick={() => setMode('equal')}>Partes iguales</button>
        <button className={mode === 'percentages' ? 'primary' : ''} onClick={() => setMode('percentages')}>Porcentajes</button>
      </div>

      {mode === 'percentages' && (
        <div style={{ marginBottom: '16px' }}>
          {participants.map((p: Participant) => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ color: 'var(--menu-text)' }}>{p.display_name}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <input
                  type="number"
                  min="0"
                  max="100"
                  style={{ width: '70px', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--menu-border)', background: 'var(--menu-bg)', color: 'var(--menu-text)' }}
                  value={allocations[p.id] ?? ''} 
                  onChange={(e) => {
                    const val = e.target.value;
                    setAllocations(prev => ({ ...prev, [p.id]: val === '' ? 0 : Number(val) }))
                  }}
                />
                <span style={{ color: 'var(--menu-muted)' }}>%</span>
              </div>
            </div>
          ))}
          {!isValid && <p className="notice" style={{ marginTop: '8px' }}>Los porcentajes deben sumar 100% (actual: {sum}%)</p>}
        </div>
      )}

      <div className="cart-actions">
        <button onClick={() => setIsEditing(false)}>Cancelar</button>
        <button 
          className="primary" 
          disabled={!isValid || mutation.isPending} 
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? 'Guardando...' : 'Guardar división'}
        </button>
      </div>
    </div>
  );
}