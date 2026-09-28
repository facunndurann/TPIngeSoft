import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2 } from 'lucide-react'
import type { Tables } from '@restaurant-platform/shared'
import { Page } from '@/features/Page'
import { optimistic, patchRow } from '@/lib/optimistic'
import { unwrap } from '@restaurant-platform/shared'
import { supabase } from '@/lib/supabase'
import { categoriesQuery } from '@/queries/categories'
import { useRestaurant } from '@/restaurant/restaurant-context'
import { Badge, Button, ErrorText, IconButton, Input, QueryView, Toggle, useSaveErrors } from '@restaurant-platform/ui'

type Category = Tables<'menu_categories'>

export function CategoriesPage() {
  const restaurant = useRestaurant()
  const queryClient = useQueryClient()
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const errors = useSaveErrors()

  const categories = useQuery(categoriesQuery(restaurant.id))

  const invalidate = () => queryClient.invalidateQueries({ queryKey: categoriesQuery(restaurant.id).queryKey })

  const createMutation = useMutation(errors.saving('No pudimos crear la categoría.', {
    mutationFn: async (name: string) =>
      unwrap(
        await supabase.from('menu_categories').insert({
          restaurant_id: restaurant.id,
          name,
          sort_order: categories.data?.length ?? 0,
        }),
      ),
    onSuccess: () => {
      setNewName('')
      invalidate()
    },
  }))

  const updateMutation = useMutation(errors.saving('No pudimos guardar la categoría.', {
    mutationFn: async ({ id, ...rest }: Partial<Category> & { id: string }) =>
      unwrap(await supabase.from('menu_categories').update(rest).eq('id', id)),
    // Activar o renombrar se ve al instante; si falla, vuelve lo anterior.
    ...optimistic(queryClient, categoriesQuery(restaurant.id).queryKey, patchRow<Category>),
    onSuccess: () => setEditingId(null),
  }, ({ id }) => id))

  const deleteMutation = useMutation(errors.saving('No pudimos eliminar la categoría.', {
    mutationFn: async (id: string) =>
      unwrap(await supabase.from('menu_categories').delete().eq('id', id)),
    onSuccess: invalidate,
  }, (id) => id))

  // Se envía la lista completa en el orden nuevo: la base la aplica de una vez y
  // rechaza la operación si la lista quedó desactualizada.
  const reorderMutation = useMutation(errors.saving('No pudimos reordenar las categorías.', {
    mutationFn: async (categoryIds: string[]) =>
      unwrap(
        await supabase.rpc('reorder_categories', {
          p_restaurant_id: restaurant.id,
          p_category_ids: categoryIds,
        }),
      ),
    onSettled: invalidate,
  }))

  function move(index: number, direction: -1 | 1) {
    if (!categories.data) return
    const ids = categories.data.map((category) => category.id)
    const [moved] = ids.splice(index, 1)
    ids.splice(index + direction, 0, moved)
    reorderMutation.mutate(ids)
  }

  function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (newName.trim()) createMutation.mutate(newName.trim())
  }

  return (
    <Page
      title="Categorías del menú"
      description="Creá, renombrá y ordená las categorías que ve el cliente."
    >
      <form onSubmit={handleCreate} className="flex gap-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Nueva categoría (ej: Postres)"
          aria-label="Nombre de la nueva categoría"
        />
        <Button type="submit" disabled={createMutation.isPending}>
          <Plus size={16} /> Agregar
        </Button>
      </form>

      <ErrorText error={errors.message} />

      <QueryView query={categories} empty="Todavía no hay categorías. Creá la primera arriba.">
        {(categories) => (
          <ul className="space-y-2">
            {categories.map((category, index) => (
              <li
                key={category.id}
                className="space-y-2 rounded-xl border border-neutral-200 bg-white py-2 pr-3 pl-2"
              >
                <div className="flex items-center gap-2">
                  {/* Una al lado de la otra y de 32 px: apiladas medían 15 px, pegadas. */}
                  <div className="flex">
                    <IconButton
                      label={`Subir ${category.name}`}
                      disabled={index === 0 || reorderMutation.isPending}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp size={16} />
                    </IconButton>
                    <IconButton
                      label={`Bajar ${category.name}`}
                      disabled={index === categories.length - 1 || reorderMutation.isPending}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown size={16} />
                    </IconButton>
                  </div>

                  {editingId === category.id ? (
                    <form
                      className="flex flex-1 items-center gap-2"
                      onSubmit={(e) => {
                        e.preventDefault()
                        updateMutation.mutate({ id: category.id, name: editingName })
                      }}
                    >
                      <Input
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        aria-label={`Nuevo nombre de ${category.name}`}
                        autoFocus
                      />
                      <Button type="submit" variant="secondary" aria-label="Guardar nombre">
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
                    label={`Activa: ${category.name}`}
                    hideLabel
                    busy={updateMutation.isPending && updateMutation.variables?.id === category.id}
                  />
                  <IconButton
                    label={`Renombrar ${category.name}`}
                    onClick={() => {
                      setEditingId(category.id)
                      setEditingName(category.name)
                    }}
                  >
                    <Pencil size={15} />
                  </IconButton>
                  <IconButton
                    label={`Eliminar ${category.name}`}
                    tone="danger"
                    onClick={() => {
                      if (confirm(`¿Eliminar la categoría "${category.name}"?`)) {
                        deleteMutation.mutate(category.id)
                      }
                    }}
                  >
                    <Trash2 size={15} />
                  </IconButton>
                </div>
                <ErrorText error={errors.messageFor(category.id)} />
              </li>
            ))}
          </ul>
        )}
      </QueryView>
    </Page>
  )
}
