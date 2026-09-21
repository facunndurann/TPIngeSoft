import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatPrice, fromPostgres } from '@restaurant-platform/shared'
import { modifierGroupsQuery, type ModifierGroupWithOptions } from '@/queries/modifier-groups'
import { useRestaurant } from '@/restaurant/restaurant-context'
import { Badge, Button, EmptyState, ErrorText, Field, Input, Modal, Spinner, Toggle } from '@restaurant-platform/ui'

/** Opción tal como se envía a save_modifier_group; sin `id` es una opción nueva. */
type OptionDraft = {
  id?: string
  name: string
  price_delta: number
  is_available: boolean
}

export function ModifiersPage() {
  const restaurant = useRestaurant()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<ModifierGroupWithOptions | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: groups, isLoading } = useQuery(modifierGroupsQuery(restaurant.id))

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: modifierGroupsQuery(restaurant.id).queryKey })

  async function deleteGroup(group: ModifierGroupWithOptions) {
    if (!confirm(`¿Eliminar el grupo "${group.name}" y todas sus opciones?`)) return
    const { error: dErr } = await supabase.from('modifier_groups').delete().eq('id', group.id)
    if (dErr) setError(dErr.message)
    else invalidate()
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Grupos de modificadores</h1>
          <p className="text-sm text-neutral-500">
            Reglas de personalización reutilizables entre productos (ej: Extras, Guarnición, Salsa).
          </p>
        </div>
        <Button onClick={() => setEditing('new')}>
          <Plus size={16} /> Nuevo grupo
        </Button>
      </div>

      <ErrorText error={error} fallback="No pudimos eliminar el grupo." />

      {isLoading ? (
        <Spinner />
      ) : !groups?.length ? (
        <EmptyState message="Todavía no hay grupos de modificadores." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {groups.map((group) => (
            <div key={group.id} className="rounded-xl border border-neutral-200 bg-white p-4">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold text-neutral-900">{group.name}</h2>
                  <p className="text-xs text-neutral-500">
                    {group.min_select > 0 ? 'Obligatorio' : 'Opcional'} · elegir{' '}
                    {group.min_select === group.max_select
                      ? group.min_select
                      : `${group.min_select} a ${group.max_select}`}
                  </p>
                </div>
                <div className="flex gap-1">
                  <button
                    className="cursor-pointer p-1 text-neutral-400 hover:text-neutral-700"
                    onClick={() => setEditing(group)}
                    aria-label="Editar"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    className="cursor-pointer p-1 text-neutral-400 hover:text-red-600"
                    onClick={() => deleteGroup(group)}
                    aria-label="Eliminar"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
              <ul className="space-y-1">
                {group.modifier_options.map((option) => (
                  <li key={option.id} className="flex items-center justify-between text-sm">
                    <span className={option.is_available ? 'text-neutral-700' : 'text-neutral-400 line-through'}>
                      {option.name}
                    </span>
                    <span className="text-neutral-500">
                      {option.price_delta > 0 ? `+${formatPrice(option.price_delta)}` : 'Gratis'}
                    </span>
                  </li>
                ))}
              </ul>
              {!group.is_available && (
                <div className="mt-2">
                  <Badge color="red">No disponible</Badge>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editing && (
        <GroupEditor
          group={editing === 'new' ? null : editing}
          restaurantId={restaurant.id}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            invalidate()
          }}
        />
      )}
    </div>
  )
}

function GroupEditor({
  group,
  restaurantId,
  onClose,
  onSaved,
}: {
  group: ModifierGroupWithOptions | null
  restaurantId: string
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(group?.name ?? '')
  const [minSelect, setMinSelect] = useState(group?.min_select ?? 0)
  const [maxSelect, setMaxSelect] = useState(group?.max_select ?? 1)
  const [isAvailable, setIsAvailable] = useState(group?.is_available ?? true)
  const [options, setOptions] = useState<OptionDraft[]>(
    group?.modifier_options.map((o) => ({
      id: o.id,
      name: o.name,
      price_delta: o.price_delta,
      is_available: o.is_available,
    })) ?? [],
  )
  const [error, setError] = useState<unknown>(null)
  const [saving, setSaving] = useState(false)

  function updateOption(index: number, patch: Partial<OptionDraft>) {
    setOptions((prev) => prev.map((option, i) => (i === index ? { ...option, ...patch } : option)))
  }

  function removeOption(index: number) {
    setOptions((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleSave() {
    setError(null)
    if (!name.trim()) return setError('El grupo necesita un nombre')
    if (options.some((o) => !o.name.trim())) return setError('Todas las opciones necesitan nombre')
    if (minSelect > maxSelect) return setError('El mínimo no puede superar al máximo')
    if (options.length === 0) return setError('Agregá al menos una opción')

    setSaving(true)
    try {
      // El grupo y su lista completa de opciones (en este orden) se guardan en una
      // transacción: las opciones que ya no están en la lista se eliminan.
      const { error: rpcErr } = await supabase.rpc('save_modifier_group', {
        p_restaurant_id: restaurantId,
        p_group_id: group?.id,
        p_name: name,
        p_min_select: minSelect,
        p_max_select: maxSelect,
        p_is_available: isAvailable,
        p_options: options,
      })
      if (rpcErr) throw fromPostgres(rpcErr)

      onSaved()
    } catch (err) {
      setError(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={group ? `Editar "${group.name}"` : 'Nuevo grupo de modificadores'} onClose={onClose} wide>
      <div className="space-y-4">
        <Field label="Nombre del grupo">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Extras" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Mínimo de opciones (0 = opcional)">
            <Input
              type="number"
              min={0}
              value={minSelect}
              onChange={(e) => setMinSelect(Number(e.target.value))}
            />
          </Field>
          <Field label="Máximo de opciones (1 = selección única)">
            <Input
              type="number"
              min={1}
              value={maxSelect}
              onChange={(e) => setMaxSelect(Number(e.target.value))}
            />
          </Field>
        </div>

        <Toggle checked={isAvailable} onChange={setIsAvailable} label="Grupo disponible" />

        <div>
          <p className="mb-2 text-sm font-medium text-neutral-700">Opciones</p>
          <div className="space-y-2">
            {options.map((option, index) => (
              <div key={option.id ?? `new-${index}`} className="flex items-center gap-2">
                <Input
                  value={option.name}
                  onChange={(e) => updateOption(index, { name: e.target.value })}
                  placeholder="Nombre"
                  className="flex-1"
                />
                <div className="flex w-32 items-center gap-1">
                  <span className="text-sm text-neutral-500">+$</span>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={option.price_delta}
                    onChange={(e) => updateOption(index, { price_delta: Number(e.target.value) })}
                  />
                </div>
                <Toggle
                  checked={option.is_available}
                  onChange={(value) => updateOption(index, { is_available: value })}
                />
                <button
                  className="cursor-pointer p-1 text-neutral-400 hover:text-red-600"
                  onClick={() => removeOption(index)}
                  aria-label="Quitar opción"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          <Button
            variant="secondary"
            className="mt-2"
            onClick={() => setOptions((prev) => [...prev, { name: '', price_delta: 0, is_available: true }])}
          >
            <Plus size={15} /> Agregar opción
          </Button>
        </div>

        <ErrorText error={error} fallback="Error guardando el grupo" />

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar grupo'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
