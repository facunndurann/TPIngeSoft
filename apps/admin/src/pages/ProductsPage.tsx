import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { formatPrice, productMedia, type Tables } from '@restaurant-platform/shared'
import { MediaThumb } from '@/features/MediaThumb'
import { supabase, unwrap } from '@/lib/supabase'
import { productsByCategoryQuery } from '@/queries/products'
import { useRestaurant } from '@/restaurant/restaurant-context'
import { Badge, Button, EmptyState, ErrorText, Spinner, Toggle, useSaveErrors } from '@restaurant-platform/ui'

export function ProductsPage() {
  const restaurant = useRestaurant()
  const queryClient = useQueryClient()
  const [categoryFilter, setCategoryFilter] = useState<string | 'all'>('all')
  const errors = useSaveErrors()

  const { data: categories, isLoading } = useQuery(productsByCategoryQuery(restaurant.id))

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: productsByCategoryQuery(restaurant.id).queryKey })

  const availabilityMutation = useMutation(errors.saving('No pudimos cambiar la disponibilidad.', {
    mutationFn: async ({ id, is_available }: { id: string; is_available: boolean }) =>
      unwrap(await supabase.from('products').update({ is_available }).eq('id', id)),
    onSuccess: invalidate,
  }))

  const deleteMutation = useMutation(errors.saving('No pudimos eliminar el producto.', {
    mutationFn: async (id: string) => unwrap(await supabase.from('products').delete().eq('id', id)),
    onSuccess: invalidate,
  }))

  const groups = (categories ?? []).filter(
    (category) =>
      category.products.length > 0 && (categoryFilter === 'all' || category.id === categoryFilter),
  )

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Productos</h1>
          <p className="text-sm text-muted">
            El menú que ven tus clientes: precios, fotos, ingredientes y personalización.
          </p>
        </div>
        <Link to="/productos/nuevo">
          <Button>
            <Plus size={16} /> Nuevo producto
          </Button>
        </Link>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <FilterChip active={categoryFilter === 'all'} onClick={() => setCategoryFilter('all')}>
          Todos
        </FilterChip>
        {categories?.map((category) => (
          <FilterChip
            key={category.id}
            active={categoryFilter === category.id}
            onClick={() => setCategoryFilter(category.id)}
          >
            {category.name}
          </FilterChip>
        ))}
      </div>

      <ErrorText error={errors.message} />

      {isLoading ? (
        <Spinner />
      ) : groups.length === 0 ? (
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
    </div>
  )
}

function ProductRow({
  product,
  onAvailabilityChange,
  onDelete,
}: {
  product: Tables<'products'>
  onAvailabilityChange: (value: boolean) => void
  onDelete: () => void
}) {
  return (
    <li className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3">
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
      />
      <Link
        to={`/productos/${product.id}`}
        className="p-1 text-faint hover:text-neutral-700"
        aria-label="Editar"
      >
        <Pencil size={15} />
      </Link>
      <button
        className="cursor-pointer p-1 text-faint hover:text-red-600"
        onClick={onDelete}
        aria-label="Eliminar"
      >
        <Trash2 size={15} />
      </button>
    </li>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`cursor-pointer rounded-full px-3 py-1 text-sm font-medium transition-colors ${
        active ? 'bg-primary text-white' : 'bg-white text-muted hover:bg-neutral-200'
      }`}
    >
      {children}
    </button>
  )
}
