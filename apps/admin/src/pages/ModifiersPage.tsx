import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { supabase, unwrap } from '@/lib/supabase'
import { formatPrice } from '@restaurant-platform/shared'
import {
  emptyGroupDraft,
  groupDraftErrors,
  groupDraftFrom,
  newOptionDraft,
  type ModifierGroupDraft,
  type OptionDraft,
} from '@/features/modifier-group-draft'
import {
  modifierGroupsQuery,
  saveModifierGroup,
  type ModifierGroupWithOptions,
} from '@/queries/modifier-groups'
import { useRestaurant } from '@/restaurant/restaurant-context'
import { Badge, Button, EmptyState, ErrorText, Field, IconButton, Input, Modal, Spinner, Toggle, useSaveErrors } from '@restaurant-platform/ui'

export function ModifiersPage() {
  const restaurant = useRestaurant()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<ModifierGroupWithOptions | 'new' | null>(null)
  const errors = useSaveErrors()

  const { data: groups, isLoading } = useQuery(modifierGroupsQuery(restaurant.id))

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: modifierGroupsQuery(restaurant.id).queryKey })

  const deleteMutation = useMutation(errors.saving('No pudimos eliminar el grupo.', {
    mutationFn: async (id: string) =>
      unwrap(await supabase.from('modifier_groups').delete().eq('id', id)),
    onSuccess: invalidate,
  }, (id) => id))

  function deleteGroup(group: ModifierGroupWithOptions) {
    if (confirm(`¿Eliminar el grupo "${group.name}" y todas sus opciones?`)) {
      deleteMutation.mutate(group.id)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Grupos de modificadores</h1>
          <p className="text-sm text-muted">
            Reglas de personalización reutilizables entre productos (ej: Extras, Guarnición, Salsa).
          </p>
        </div>
        <Button onClick={() => setEditing('new')}>
          <Plus size={16} /> Nuevo grupo
        </Button>
      </div>

      <ErrorText error={errors.message} />

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
                  <p className="text-xs text-muted">
                    {group.min_select > 0 ? 'Obligatorio' : 'Opcional'} · elegir{' '}
                    {group.min_select === group.max_select
                      ? group.min_select
                      : `${group.min_select} a ${group.max_select}`}
                  </p>
                </div>
                <div className="flex gap-1">
                  <IconButton label={`Editar ${group.name}`} onClick={() => setEditing(group)}>
                    <Pencil size={15} />
                  </IconButton>
                  <IconButton label={`Eliminar ${group.name}`} tone="danger" onClick={() => deleteGroup(group)}>
                    <Trash2 size={15} />
                  </IconButton>
                </div>
              </div>
              <ul className="space-y-1">
                {group.modifier_options.map((option) => (
                  <li key={option.id} className="flex items-center justify-between text-sm">
                    <span className={option.is_available ? 'text-neutral-700' : 'text-faint line-through'}>
                      {option.name}
                    </span>
                    <span className="text-muted">
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
              {errors.messageFor(group.id) && (
                <div className="mt-2">
                  <ErrorText error={errors.messageFor(group.id)} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editing && (
        <GroupEditor
          key={editing === 'new' ? 'new' : editing.id}
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
  const errors = useSaveErrors()

  // Un solo estado, inicializado con lo que ya llegó: el editor se monta con su grupo.
  // Cada cambio crea un borrador nuevo, así que distinto del inicial es «editado».
  const [initial] = useState(() => (group ? groupDraftFrom(group) : emptyGroupDraft()))
  const [draft, setDraft] = useState(initial)
  const patch = (changes: Partial<ModifierGroupDraft>) =>
    setDraft((current) => ({ ...current, ...changes }))

  const updateOption = (key: string, changes: Partial<OptionDraft>) =>
    patch({
      options: draft.options.map((option) => (option.key === key ? { ...option, ...changes } : option)),
    })

  const save = useMutation(errors.saving('No pudimos guardar el grupo.', {
    mutationFn: async () => {
      const invalid = groupDraftErrors(draft)
      if (invalid) throw new Error(invalid)
      await saveModifierGroup({ restaurantId, groupId: group?.id, draft })
    },
    onSuccess: onSaved,
  }))

  return (
    <Modal
      title={group ? `Editar "${group.name}"` : 'Nuevo grupo de modificadores'}
      onClose={onClose}
      hasUnsavedChanges={draft !== initial}
      wide
    >
      <div className="space-y-4">
        <Field label="Nombre del grupo">
          <Input
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="Ej: Extras"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Mínimo de opciones (0 = opcional)">
            <Input
              type="number"
              min={0}
              value={draft.minSelect}
              onChange={(e) => patch({ minSelect: e.target.value })}
            />
          </Field>
          <Field label="Máximo de opciones (1 = selección única)">
            <Input
              type="number"
              min={1}
              value={draft.maxSelect}
              onChange={(e) => patch({ maxSelect: e.target.value })}
            />
          </Field>
        </div>

        <Toggle
          checked={draft.isAvailable}
          onChange={(isAvailable) => patch({ isAvailable })}
          label="Grupo disponible"
        />

        <div>
          <p className="mb-2 text-sm font-medium text-neutral-700">Opciones</p>
          <div className="space-y-2">
            {draft.options.map((option, index) => {
              // Los controles de la fila se nombran por su opción; una recién
              // agregada todavía no tiene nombre, así que va por su número.
              const optionName = option.name.trim() || `opción ${index + 1}`
              return (
                <div key={option.key} className="flex items-center gap-2">
                  <Input
                    value={option.name}
                    onChange={(e) => updateOption(option.key, { name: e.target.value })}
                    placeholder="Nombre"
                    aria-label={`Nombre de la opción ${index + 1}`}
                    className="flex-1"
                  />
                  <div className="flex w-32 items-center gap-1">
                    <span className="text-sm text-muted">+$</span>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={option.price}
                      onChange={(e) => updateOption(option.key, { price: e.target.value })}
                      aria-label={`Precio de ${optionName}`}
                    />
                  </div>
                  <Toggle
                    checked={option.isAvailable}
                    onChange={(isAvailable) => updateOption(option.key, { isAvailable })}
                    label={`Disponible: ${optionName}`}
                    hideLabel
                  />
                  <IconButton
                    label={`Quitar ${optionName}`}
                    tone="danger"
                    onClick={() =>
                      patch({ options: draft.options.filter((other) => other.key !== option.key) })
                    }
                  >
                    <Trash2 size={15} />
                  </IconButton>
                </div>
              )
            })}
          </div>
          <Button
            variant="secondary"
            className="mt-2"
            onClick={() => patch({ options: [...draft.options, newOptionDraft()] })}
          >
            <Plus size={15} /> Agregar opción
          </Button>
        </div>

        <ErrorText error={errors.message} />

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? 'Guardando…' : 'Guardar grupo'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
