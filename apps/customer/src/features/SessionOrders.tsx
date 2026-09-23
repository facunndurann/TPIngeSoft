import { useQuery } from '@tanstack/react-query'
import { formatPrice, orderStatusLabels } from '@restaurant-platform/shared'
import { ErrorText } from '@restaurant-platform/ui'
import { FreshnessNote } from '@/components/FreshnessNote'
import { plateCount } from '@/features/cart'
import { oldestUpdate } from '@/features/freshness'
import { type loadOrders, ordersQuery } from '@/features/orders-api'
import { useTable } from '@/features/table-context'
import { WithoutSession } from '@/features/TableChrome'

type Order = Awaited<ReturnType<typeof loadOrders>>[number]
type OrderItem = Order['order_items'][number]

// Una instancia por formato, como `formatPrice`: se usa fila por fila en cada render.
const orderTime = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' })

type SessionOrdersProps = {
  /** Repite un pedido en el carrito. Ausente cuando la mesa no admite pedir. */
  onReorder?: (order: Order) => void
}

/** Lo que pidió la mesa, del más nuevo al más viejo. Cómo se paga es de la Cuenta. */
export function SessionOrders({ onReorder }: SessionOrdersProps) {
  const { sessionId } = useTable()
  const orders = useQuery(ordersQuery(sessionId))

  if (!sessionId) return <WithoutSession title="Pedidos" subject="sus pedidos" />

  return (
    <section aria-label="Pedidos de la mesa">
      <h2>Pedidos</h2>
      <FreshnessNote
        label="los pedidos"
        updatedAt={oldestUpdate(orders.dataUpdatedAt)}
        isFetching={orders.isFetching}
      />

      {orders.isPending && <p role="status">Cargando los pedidos…</p>}
      {/* Cada lectura dice qué falló (lo pone su loader) y el catálogo decide si reintentar. */}
      <ErrorText variant="menu" error={orders.error} retry={() => { void orders.refetch() }} />
      {orders.data?.length === 0 && (
        <p className="empty">Todavía no hay pedidos enviados en esta mesa.</p>
      )}
      {orders.data?.map((order, index) => (
        <OrderCard
          key={order.id}
          order={order}
          position={orders.data.length - index}
          onReorder={onReorder}
        />
      ))}
    </section>
  )
}

function OrderCard({
  order,
  position,
  onReorder,
}: {
  order: Order
  /** Número del pedido dentro de la mesa, contando desde el primero. */
  position: number
  onReorder?: (order: Order) => void
}) {
  const { nameOf } = useTable()
  const createdAt = orderTime.format(new Date(order.created_at))

  const plates = order.order_items.reduce((sum, item) => sum + item.quantity, 0)

  return (
    <article className="order-card">
      {/* Cerrada por defecto: el resumen ya contesta de quién es, cuánto y cómo va;
          el detalle plato por plato se abre cuando alguien lo busca. */}
      <details className="order-details">
        <summary className="disclosure">
          <div className="order-summary">
            <div className="order-heading">
              <h3>Pedido {position}</h3>
              <span className={`badge status-${order.status}`}>{orderStatusLabels[order.status]}</span>
            </div>
            <p className="muted">
              {nameOf(order.submitted_by)} · {plateCount(plates)} ·{' '}
              {formatPrice(order.total_amount)} · {createdAt}
            </p>
          </div>
          <span className="chevron" aria-hidden="true">›</span>
        </summary>

        {order.status === 'submitted' && (
          <p className="muted">Esperando confirmación del restaurante. Aún no está en cuenta.</p>
        )}
        {order.status === 'cancelled' && (
          <p className="muted">Este pedido fue cancelado y no se cobra.</p>
        )}
        {order.order_items.map((item) => (
          <OrderLine key={item.id} item={item} />
        ))}
        {order.notes && <p>{order.notes}</p>}
        <div className="total">
          <span>Total</span>
          <strong>{formatPrice(order.total_amount)}</strong>
        </div>
        {onReorder && (
          <button onClick={() => onReorder(order)}>Pedir de nuevo</button>
        )}
      </details>
    </article>
  )
}

function OrderLine({ item }: { item: OrderItem }) {
  const { nameOf } = useTable()
  const owner = item.is_shared ? 'Para compartir en la mesa' : nameOf(item.participant_id)

  return (
    <div className="order-line">
      <div className="order-heading">
        <h4>
          {item.quantity} × {item.product_name}
        </h4>
        <strong>{formatPrice(item.total_price)}</strong>
      </div>
      <p className="muted">
        {owner} · Base por unidad: {formatPrice(item.base_price)}
      </p>
      {item.order_item_modifiers.map((modifier) => (
        <p key={modifier.id}>
          + {modifier.group_name}: {modifier.option_name} ({formatPrice(modifier.price_delta)} por unidad)
        </p>
      ))}
      {item.order_item_removed_ingredients.map((ingredient) => (
        <p key={ingredient.id}>Sin {ingredient.ingredient_name}</p>
      ))}
      {item.notes && <p>{item.notes}</p>}
    </div>
  )
}
