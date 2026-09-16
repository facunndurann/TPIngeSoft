import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2 } from 'lucide-react'
import type { Tables } from '@restaurant-platform/shared'
import { rpcError } from '@/lib/rpc-error'
import { supabase } from '@/lib/supabase'
import { useRestaurant } from '@/restaurant/restaurant-context'
import { Badge, Button, EmptyState, ErrorText, Input, Spinner, Toggle } from '@/components/ui'

type Category = Tables<'menu_categories'>

export function CategoriesPage() {
  const restaurant = useRestaurant()
  const queryClient = useQueryClient()
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: categories, isLoading } = useQuery({
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

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['categories', restaurant.id] })

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const { error: mErr } = await supabase.from('menu_categories').insert({
        restaurant_id: restaurant.id,
        name,
        sort_order: categories?.length ?? 0,
      })
      if (mErr) throw mErr
    },
    onSuccess: () => {
      setNewName('')
      invalidate()
    },
    onError: (e) => setError(e.message),
  })

  const updateMutation = useMutation({
    mutationFn: async (patch: Partial<Category> & { id: string }) => {
      const { id, ...rest } = patch
      const { error: mErr } = await supabase.from('menu_categories').update(rest).eq('id', id)
      if (mErr) throw mErr
    },
    onSuccess: () => {
      setEditingId(null)
      invalidate()
    },
    onError: (e) => setError(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error: mErr } = await supabase.from('menu_categories').delete().eq('id', id)
      if (mErr) throw mErr
    },
    onSuccess: invalidate,
    onError: (e) =>
      setError(
        e.message.includes('violates foreign key')
          ? 'No se puede eliminar: la categoría tiene productos. Movelos o eliminalos primero.'
          : e.message,
      ),
  })

  // Se envía la lista completa en el orden nuevo: la base la aplica de una vez y
  // rechaza la operación si la lista quedó desactualizada.
  const reorderMutation = useMutation({
    mutationFn: async (categoryIds: string[]) => {
      const { error: mErr } = await supabase.rpc('reorder_categories', {
        p_restaurant_id: restaurant.id,
        p_category_ids: categoryIds,
      })
      if (mErr) throw rpcError(mErr)
    },
    onError: (e) => setError(e.message),
    onSettled: invalidate,
  })

  function move(index: number, direction: -1 | 1) {
    if (!categories) return
    const ids = categories.map((category) => category.id)
    const [moved] = ids.splice(index, 1)
    ids.splice(index + direction, 0, moved)
    reorderMutation.mutate(ids)
  }

  function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (newName.trim()) createMutation.mutate(newName.trim())
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">Categorías del menú</h1>
        <p className="text-sm text-neutral-500">
          Creá, renombrá y ordená las categorías que ve el cliente.
        </p>
      </div>

      <form onSubmit={handleCreate} className="flex gap-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Nueva categoría (ej: Postres)"
        />
        <Button type="submit" disabled={createMutation.isPending}>
          <Plus size={16} /> Agregar
        </Button>
      </form>

      <ErrorText message={error} />

      {isLoading ? (
        <Spinner />
      ) : !categories?.length ? (
        <EmptyState message="Todavía no hay categorías. Creá la primera arriba." />
      ) : (
        <ul className="space-y-2">
          {categories.map((category, index) => (
            <li
              key={category.id}
              className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-3"
            >
              <div className="flex flex-col">
                <button
                  className="cursor-pointer text-neutral-400 hover:text-neutral-700 disabled:opacity-30"
                  disabled={index === 0 || reorderMutation.isPending}
                  onClick={() => move(index, -1)}
                  aria-label="Subir"
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  className="cursor-pointer text-neutral-400 hover:text-neutral-700 disabled:opacity-30"
                  disabled={index === categories.length - 1 || reorderMutation.isPending}
                  onClick={() => move(index, 1)}
                  aria-label="Bajar"
                >
                  <ArrowDown size={15} />
                </button>
              </div>

              {editingId === category.id ? (
                <form
                  className="flex flex-1 items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    updateMutation.mutate({ id: category.id, name: editingName })
                  }}
                >
                  <Input value={editingName} onChange={(e) => setEditingName(e.target.value)} autoFocus />
                  <Button type="submit" variant="secondary">
                    <Check size={15} />
                  </Button>
                </form>
              ) : (
                <>
                  <span className="flex-1 text-sm font-medium text-neutral-900">{category.name}</span>
                  {!category.is_active && <Badge color="red">Inactiva</Badge>}
                </>
              )}

              <Toggle
                checked={category.is_active}
                onChange={(value) => updateMutation.mutate({ id: category.id, is_active: value })}
              />
              <button
                className="cursor-pointer p-1 text-neutral-400 hover:text-neutral-700"
                onClick={() => {
                  setEditingId(category.id)
                  setEditingName(category.name)
                }}
                aria-label="Renombrar"
              >
                <Pencil size={15} />
              </button>
              <button
                className="cursor-pointer p-1 text-neutral-400 hover:text-red-600"
                onClick={() => {
                  if (confirm(`¿Eliminar la categoría "${category.name}"?`)) {
                    deleteMutation.mutate(category.id)
                  }
                }}
                aria-label="Eliminar"
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
