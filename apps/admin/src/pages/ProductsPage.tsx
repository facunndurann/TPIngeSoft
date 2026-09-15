import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { productMedia } from '@restaurant-platform/shared'
import { MediaThumb } from '@/features/MediaThumb'
import { supabase } from '@/lib/supabase'
import { formatPrice } from '@/lib/format'
import { useRestaurant } from '@/restaurant/restaurant-context'
import { Badge, Button, EmptyState, ErrorText, Spinner, Toggle } from '@/components/ui'

export function ProductsPage() {
  const restaurant = useRestaurant()
  const queryClient = useQueryClient()
  const [categoryFilter, setCategoryFilter] = useState<string | 'all'>('all')
  const [error, setError] = useState<string | null>(null)

  const { data: categories } = useQuery({
    queryKey: ['categories', restaurant.id],
    queryFn: async () => {
      const { data, error: qErr } = await supabase
        .from('menu_categories')
        .select('*')
        .eq('restaurant_id', restaurant.id)
        .order('sort_order')
      if (qErr) throw qErr
      return data
    },
  })

  const { data: products, isLoading } = useQuery({
    queryKey: ['products', restaurant.id],
    queryFn: async () => {
      const { data, error: qErr } = await supabase
        .from('products')
        .select('*')
        .eq('restaurant_id', restaurant.id)
        .order('sort_order')
      if (qErr) throw qErr
      return data
    },
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['products', restaurant.id] })

  const availabilityMutation = useMutation({
    mutationFn: async ({ id, is_available }: { id: string; is_available: boolean }) => {
      const { error: mErr } = await supabase.from('products').update({ is_available }).eq('id', id)
      if (mErr) throw mErr
    },
    onSuccess: invalidate,
    onError: (e) => setError(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error: mErr } = await supabase.from('products').delete().eq('id', id)
      if (mErr) throw mErr
    },
    onSuccess: invalidate,
    onError: (e) => setError(e.message),
  })

  const visible = products?.filter((p) => categoryFilter === 'all' || p.category_id === categoryFilter)

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Productos</h1>
          <p className="text-sm text-neutral-500">
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

      <ErrorText message={error} />

      {isLoading ? (
        <Spinner />
      ) : !visible?.length ? (
        <EmptyState message="No hay productos en esta vista. Creá uno con “Nuevo producto”." />
      ) : (
        <div className="space-y-8">
          {categories?.filter((category) => categoryFilter === 'all' || categoryFilter === category.id).map((category) => {
            const categoryProducts = visible.filter((p) => p.category_id === category.id)
            if (categoryProducts.length === 0) return null

            return (
              <div key={category.id}>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-400">
                  {category.name}
                </h2>
                <ul className="space-y-2">
                  {categoryProducts.map((product) => (
                    <li
                      key={product.id}
                      className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3"
                    >
                      <MediaThumb media={productMedia(product)[0]} alt={product.name} className="h-14 w-14" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium text-neutral-900">{product.name}</p>
                          {!product.is_available && <Badge color="red">Sin stock</Badge>}
                        </div>
                        <p className="text-xs text-neutral-500">
                          {formatPrice(product.base_price)}
                        </p>
                      </div>
                      <Toggle
                        checked={product.is_available}
                        onChange={(value) =>
                          availabilityMutation.mutate({ id: product.id, is_available: value })
                        }
                      />
                      <Link
                        to={`/productos/${product.id}`}
                        className="p-1 text-neutral-400 hover:text-neutral-700"
                        aria-label="Editar"
                      >
                        <Pencil size={15} />
                      </Link>
                      <button
                        className="cursor-pointer p-1 text-neutral-400 hover:text-red-600"
                        onClick={() => {
                          if (confirm(`¿Eliminar "${product.name}"?`)) deleteMutation.mutate(product.id)
                        }}
                        aria-label="Eliminar"
                      >
                        <Trash2 size={15} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </div>
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
        active ? 'bg-indigo-600 text-white' : 'bg-white text-neutral-600 hover:bg-neutral-200'
      }`}
    >
      {children}
    </button>
  )
}
