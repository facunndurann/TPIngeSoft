import { useId, useState } from 'react'
import { flushSync } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Page } from '@/features/Page'
import { formatPrice } from '@restaurant-platform/shared'
import {
  emptyGroupDraft,
  groupDraftFrom,
  newOptionDraft,
  parseGroupDraft,
  type GroupField,
  type ModifierGroupDraft,
  type ModifierGroupPayload,
  type OptionDraft,
} from '@/features/modifier-group-draft'
import {
  deleteModifierGroup,
  modifierGroupsQuery,
  saveModifierGroup,
  type ModifierGroupWithOptions,
} from '@/queries/modifier-groups'
import { useRestaurant } from '@/restaurant/restaurant-context'
import {
  Badge,
  Button,
  ErrorText,
  Field,
  IconButton,
  Input,
  Modal,
  QueryView,
  Toggle,
  useConfirm,
  useSaveErrors,
  useToast,
} from '@restaurant-platform/ui'

export function ModifiersPage() {
  const restaurant = useRestaurant()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<ModifierGroupWithOptions | 'new' | null>(null)
  const errors = useSaveErrors()
  const toast = useToast()
  const { confirm, dialog } = useConfirm()

  const groups = useQuery(modifierGroupsQuery(restaurant.id))

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: modifierGroupsQuery(restaurant.id).queryKey })

  const deleteMutation = useMutation(errors.saving('No pudimos eliminar el grupo.', {
    mutationFn: deleteModifierGroup,
    onSuccess: invalidate,
  }, (id) => id))

  async function deleteGroup(group: ModifierGroupWithOptions) {
    const confirmed = await confirm({
      title: `¿Eliminar el grupo "${group.name}"?`,
      message: 'Se borran también sus opciones, y los productos que lo usaban dejan de ofrecerlo.',
      confirmLabel: 'Eliminar grupo',
    })
    if (confirmed) deleteMutation.mutate(group.id)
  }

  return (
    <Page
      title="Grupos de modificadores"
      description="Reglas de personalización reutilizables entre productos (ej: Extras, Guarnición, Salsa)."
      actions={
        <Button onClick={() => setEditing('new')}>
          <Plus size={16} /> Nuevo grupo
        </Button>
      }
    >
      <ErrorText error={errors.message} />

      <QueryView query={groups} empty="Todavía no hay grupos de modificadores.">
        {(groups) => (
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
                    <IconButton label={`Eliminar ${group.name}`} tone="danger" onClick={() => void deleteGroup(group)}>
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
      </QueryView>

      {editing && (
        <GroupEditor
          key={editing === 'new' ? 'new' : editing.id}
          group={editing === 'new' ? null : editing}
          restaurantId={restaurant.id}
          onClose={() => setEditing(null)}
          // El modal se cierra al guardar: sin el aviso, no queda señal de que salió.
          onSaved={(name) => {
            toast(editing === 'new' ? `Creamos el grupo «${name}».` : `Guardamos el grupo «${name}».`)
            setEditing(null)
            invalidate()
          }}
        />
      )}

      {dialog}
    </Page>
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
  /** Guardado: recibe el nombre del grupo, para el aviso. */
  onSaved: (name: string) => void
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

  // Como en el formulario de producto: los errores aparecen recién al intentar
  // guardar, cada uno debajo de su campo, y desde ahí se recalculan con cada
  // cambio, así lo que ya se corrigió deja de marcarse solo.
  const formId = useId()
  const fieldId = (field: GroupField) => `${formId}-${field}`
  const errorId = (field: GroupField) => `${fieldId(field)}-error`
  const [attempted, setAttempted] = useState(false)
  const parsed = parseGroupDraft(draft)
  const fieldErrors = attempted && !parsed.ok ? parsed.errors : []
  const errorFor = (field: GroupField) => fieldErrors.find((error) => error.field === field)?.message

  /** Lo que marca un control sin Field (las filas de opciones): inválido y descrito por su error. */
  const invalidProps = (field: GroupField) =>
    errorFor(field) ? { 'aria-invalid': true as const, 'aria-describedby': errorId(field) } : {}

  const save = useMutation(errors.saving('No pudimos guardar el grupo.', {
    mutationFn: (payload: ModifierGroupPayload) => saveModifierGroup({ restaurantId, groupId: group?.id, payload }),
    onSuccess: (_saved, payload) => onSaved(payload.name.trim()),
  }))

  // Lo que se guarda es lo que se validó: el payload sale del mismo parseo.
  function submit() {
    if (parsed.ok) {
      save.mutate(parsed.payload)
      return
    }
    // El error tiene que estar en el DOM antes de mover el foco: así el lector
    // de pantalla anuncia el campo junto con su error, y no solo el campo.
    flushSync(() => setAttempted(true))
    document.getElementById(fieldId(parsed.errors[0].field))?.focus()
  }

  return (
    <Modal
      title={group ? `Editar "${group.name}"` : 'Nuevo grupo de modificadores'}
      onClose={onClose}
      hasUnsavedChanges={draft !== initial}
      wide
    >
      <div className="space-y-4">
        <Field label="Nombre del grupo" error={errorFor('name')}>
          <Input
            id={fieldId('name')}
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="Ej: Extras"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Mínimo de opciones (0 = opcional)" error={errorFor('minSelect')}>
            <Input
              id={fieldId('minSelect')}
              type="number"
              min={0}
              value={draft.minSelect}
              onChange={(e) => patch({ minSelect: e.target.value })}
            />
          </Field>
          <Field label="Máximo de opciones (1 = selección única)" error={errorFor('maxSelect')}>
            <Input
              id={fieldId('maxSelect')}
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
              const nameField = `option-name-${option.key}` as const
              const priceField = `option-price-${option.key}` as const
              return (
                <div key={option.key}>
                  <div className="flex items-center gap-2">
                    <Input
                      id={fieldId(nameField)}
                      value={option.name}
                      onChange={(e) => updateOption(option.key, { name: e.target.value })}
                      placeholder="Nombre"
                      aria-label={`Nombre de la opción ${index + 1}`}
                      className="flex-1"
                      {...invalidProps(nameField)}
                    />
                    <div className="flex w-32 items-center gap-1">
                      <span className="text-sm text-muted">+$</span>
                      <Input
                        id={fieldId(priceField)}
                        type="number"
                        min={0}
                        step="0.01"
                        value={option.price}
                        onChange={(e) => updateOption(option.key, { price: e.target.value })}
                        aria-label={`Precio de ${optionName}`}
                        {...invalidProps(priceField)}
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
                  {/* La fila no tiene rótulo visible (no va en un Field): sus errores van debajo. */}
                  {[nameField, priceField].map(
                    (field) =>
                      errorFor(field) && (
                        <p key={field} id={errorId(field)} className="mt-1 text-xs text-red-700">
                          {errorFor(field)}
                        </p>
                      ),
                  )}
                </div>
              )
            })}
          </div>
          {/* Sin opciones no hay campo que marcar: el error queda en el botón que las agrega. */}
          {errorFor('options') && (
            <p id={errorId('options')} className="mt-1 text-xs text-red-700">
              {errorFor('options')}
            </p>
          )}
          <Button
            id={fieldId('options')}
            variant="secondary"
            className="mt-2"
            aria-describedby={errorFor('options') ? errorId('options') : undefined}
            onClick={() => patch({ options: [...draft.options, newOptionDraft()] })}
          >
            <Plus size={15} /> Agregar opción
          </Button>
        </div>

        {/* Lo que rechaza la base al guardar; lo del borrador ya está en cada campo. */}
        <ErrorText error={errors.message} />

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending ? 'Guardando…' : 'Guardar grupo'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
