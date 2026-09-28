import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { formatPrice, productMedia, type Tables, unwrap } from '@restaurant-platform/shared'
import { Page } from '@/features/Page'
import { MediaThumb } from '@/features/MediaThumb'
import { optimistic } from '@/lib/optimistic'
import { supabase } from '@/lib/supabase'
import { productsByCategoryQuery } from '@/queries/products'
import { useRestaurant } from '@/restaurant/restaurant-context'
import {
  Badge,
  Button,
  ChoiceChip,
  EmptyState,
  ErrorText,
  IconButton,
  QueryView,
  Toggle,
  iconButtonClass,
  useSaveErrors,
} from '@restaurant-platform/ui'

export function ProductsPage() {
  const restaurant = useRestaurant()
  const queryClient = useQueryClient()
  const [categoryFilter, setCategoryFilter] = useState<string | 'all'>('all')
  const errors = useSaveErrors()

  const categories = useQuery(productsByCategoryQuery(restaurant.id))

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: productsByCategoryQuery(restaurant.id).queryKey })

  // Se ve al tocar: el producto cambia en la carta cargada y se relee al terminar.
  const availabilityMutation = useMutation(errors.saving('No pudimos cambiar la disponibilidad.', {
    mutationFn: async ({ id, is_available }: { id: string; is_available: boolean }) =>
      unwrap(await supabase.from('products').update({ is_available }).eq('id', id)),
    ...optimistic(
      queryClient,
      productsByCategoryQuery(restaurant.id).queryKey,
      (categories, { id, is_available }: { id: string; is_available: boolean }) =>
        categories.map((category) => ({
          ...category,
          products: category.products.map((product) =>
            product.id === id ? { ...product, is_available } : product,
          ),
        })),
    ),
  }, ({ id }) => id))

  const deleteMutation = useMutation(errors.saving('No pudimos eliminar el producto.', {
    mutationFn: async (id: string) => unwrap(await supabase.from('products').delete().eq('id', id)),
    onSuccess: invalidate,
  }, (id) => id))

  return (
    <Page
      title="Productos"
      description="El menú que ven tus clientes: precios, fotos, ingredientes y personalización."
      actions={
        <Link to="/productos/nuevo">
          <Button>
            <Plus size={16} /> Nuevo producto
          </Button>
        </Link>
      }
    >
      <QueryView query={categories}>
        {(categories) => {
          // Las categorías con productos que deja ver el filtro: una sin productos no tiene qué listar.
          const groups = categories.filter(
            (category) =>
              category.products.length > 0 && (categoryFilter === 'all' || category.id === categoryFilter),
          )
          return (
            <>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por categoría">
                <ChoiceChip pressed={categoryFilter === 'all'} onClick={() => setCategoryFilter('all')}>
                  Todos
                </ChoiceChip>
                {categories.map((category) => (
                  <ChoiceChip
                    key={category.id}
                    pressed={categoryFilter === category.id}
                    onClick={() => setCategoryFilter(category.id)}
                  >
                    {category.name}
                  </ChoiceChip>
                ))}
              </div>

              <ErrorText error={errors.message} />

              {/* El vacío es de la vista filtrada, así que va debajo de los filtros y no los reemplaza. */}
              {groups.length === 0 ? (
                <EmptyState message="No hay productos en esta vista. Creá uno con “Nuevo producto”." />
              ) : (
                <div className="space-y-8">
                  {groups.map((group) => (
                    <div key={group.id}>
                      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">
                        {group.name}
                      </h2>
                      <ul className="space-y-2">
                        {group.products.map((product) => (
                          <ProductRow
                            key={product.id}
                            product={product}
                            error={errors.messageFor(product.id)}
                            saving={
                              availabilityMutation.isPending && availabilityMutation.variables?.id === product.id
                            }
                            onAvailabilityChange={(value) =>
                              availabilityMutation.mutate({ id: product.id, is_available: value })
                            }
                            onDelete={() => {
                              if (confirm(`¿Eliminar "${product.name}"?`)) deleteMutation.mutate(product.id)
                            }}
                          />
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </>
          )
        }}
      </QueryView>
    </Page>
  )
}

function ProductRow({
  product,
  error,
  saving,
  onAvailabilityChange,
  onDelete,
}: {
  product: Tables<'products'>
  /** Error de la última escritura sobre este producto: se muestra acá y no arriba de la lista. */
  error: string | null
  /** Guardando su disponibilidad: el switch no acepta otro toque hasta que termine. */
  saving: boolean
  onAvailabilityChange: (value: boolean) => void
  onDelete: () => void
}) {
  return (
    <li className="space-y-2 rounded-xl border border-neutral-200 bg-white p-3">
      <div className="flex items-center gap-3">
        <MediaThumb media={productMedia(product)[0]} alt={product.name} className="h-14 w-14" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-neutral-900">{product.name}</p>
            {!product.is_available && <Badge color="red">Sin stock</Badge>}
          </div>
          <p className="text-xs text-muted">{formatPrice(product.base_price)}</p>
        </div>
        <Toggle
          checked={product.is_available}
          onChange={onAvailabilityChange}
          label={`Disponible: ${product.name}`}
          hideLabel
          busy={saving}
        />
        <Link
          to={`/productos/${product.id}`}
          className={iconButtonClass()}
          aria-label={`Editar ${product.name}`}
          title={`Editar ${product.name}`}
        >
          <Pencil size={15} />
        </Link>
        <IconButton label={`Eliminar ${product.name}`} tone="danger" onClick={onDelete}>
          <Trash2 size={15} />
        </IconButton>
      </div>
      <ErrorText error={error} />
    </li>
  )
}
