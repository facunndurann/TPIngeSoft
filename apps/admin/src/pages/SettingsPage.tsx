import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { optimistic, patchRow } from '@/lib/optimistic'
import { supabase, unwrap } from '@/lib/supabase'
import { branchesQuery } from '@/queries/branches'
import { myRestaurantKey } from '@/queries/restaurant'
import { useRestaurant } from '@/restaurant/restaurant-context'
import { DesignPicker } from '@/features/DesignPicker'
import { Page } from '@/features/Page'
import { PaymentMethodsField } from '@/features/PaymentMethods'
import { Badge, Button, ErrorText, Field, IconButton, Input, Spinner, Textarea, Toggle, useSaveErrors } from '@restaurant-platform/ui'
import type { Tables } from '@restaurant-platform/shared'

export function SettingsPage() {
  const restaurant = useRestaurant()
  const queryClient = useQueryClient()
  const [name, setName] = useState(restaurant.name)
  const [description, setDescription] = useState(restaurant.description ?? '')
  const [menuDesign, setMenuDesign] = useState(restaurant.menu_design)
  const errors = useSaveErrors()

  // Lo que se guardaría contra lo que está guardado: el estado del botón y del
  // aviso sale de acá, sin un flag «guardado» ni un timer que lo apague.
  const changes = {
    name: name.trim(),
    description: description.trim() || null,
    menu_design: menuDesign,
  }
  const dirty =
    changes.name !== restaurant.name ||
    changes.description !== restaurant.description ||
    changes.menu_design !== restaurant.menu_design

  const saveMutation = useMutation(errors.saving('No pudimos guardar los datos del restaurante.', {
    mutationFn: async () =>
      unwrap(await supabase.from('restaurants').update(changes).eq('id', restaurant.id)),
    // Se espera a releer el restaurante: si no, por un momento lo guardado todavía
    // sería lo viejo y el aviso diría «cambios sin guardar» justo después de guardar.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: myRestaurantKey }),
  }))

  const status = saveMutation.isPending
    ? 'Guardando…'
    : dirty
      ? 'Hay cambios sin guardar.'
      : saveMutation.isSuccess
        ? 'Guardado.'
        : ''

  return (
    <Page title="Restaurante" description="Información general, sucursales y medios de pago.">
      <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5">
        <div>
          <h2 className="font-semibold text-neutral-900">Información general</h2>
          <p className="text-sm text-muted">Se guarda con el botón de abajo.</p>
        </div>
        <Field label="Nombre">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Descripción">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </Field>
        <p className="text-xs text-muted">
          Identificador público: <code className="rounded bg-neutral-100 px-1">{restaurant.slug}</code>
        </p>
        <DesignPicker
          value={menuDesign}
          onChange={setMenuDesign}
          hint="Elegí cómo se ve el menú que abren los comensales desde el QR."
        />
        <ErrorText error={errors.message} />
        <div className="flex items-center gap-3">
          <Button onClick={() => saveMutation.mutate()} disabled={!dirty || saveMutation.isPending}>
            Guardar
          </Button>
          {/* Siempre en el DOM: un lector de pantalla anuncia cuando cambia el texto. */}
          <p role="status" className={`text-sm ${status === 'Guardado.' ? 'text-green-700' : 'text-muted'}`}>
            {status}
          </p>
        </div>
      </section>

      <BranchesSection restaurantId={restaurant.id} />
    </Page>
  )
}

function BranchesSection({ restaurantId }: { restaurantId: string }) {
  const queryClient = useQueryClient()
  const [newName, setNewName] = useState('')
  const [newAddress, setNewAddress] = useState('')
  const errors = useSaveErrors()

  const { data: branches, isLoading } = useQuery(branchesQuery(restaurantId))

  const invalidate = () => queryClient.invalidateQueries({ queryKey: branchesQuery(restaurantId).queryKey })

  const createMutation = useMutation(errors.saving('No pudimos crear la sucursal.', {
    mutationFn: async () =>
      unwrap(
        await supabase.from('branches').insert({
          restaurant_id: restaurantId,
          name: newName.trim(),
          address: newAddress.trim() || null,
        }),
      ),
    onSuccess: () => {
      setNewName('')
      setNewAddress('')
      invalidate()
    },
  }))

  // Un solo guardado para la sucursal: alcanza con mandar lo que cambió.
  const updateMutation = useMutation(errors.saving('No pudimos guardar la sucursal.', {
    mutationFn: async ({
      id,
      ...changes
    }: { id: string } & Partial<Pick<Tables<'branches'>, 'is_active' | 'payment_methods'>>) =>
      unwrap(await supabase.from('branches').update(changes).eq('id', id)),
    // Activar la sucursal o cambiar sus medios de pago se ve al instante.
    ...optimistic(queryClient, branchesQuery(restaurantId).queryKey, patchRow<Tables<'branches'>>),
  }, ({ id }) => id))

  const deleteMutation = useMutation(errors.saving('No pudimos eliminar la sucursal.', {
    mutationFn: async (id: string) =>
      unwrap(await supabase.from('branches').delete().eq('id', id)),
    onSuccess: invalidate,
  }, (id) => id))

  function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (newName.trim()) createMutation.mutate()
  }

  // La sucursal que está guardando: su switch y sus medios de pago esperan a que termine.
  const savingBranch = updateMutation.isPending ? updateMutation.variables?.id : null

  return (
    <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5">
      <div>
        <h2 className="font-semibold text-neutral-900">Sucursales</h2>
        <p className="text-sm text-muted">
          Cada sucursal decide con qué se le puede pagar: el comensal solo ve los medios
          habilitados en la suya. Estos cambios se guardan al tocarlos.
        </p>
      </div>

      {/* Dos campos: con el texto ya escrito, el placeholder no dice cuál es cuál,
          así que llevan rótulo visible. En pantallas chicas se apilan. */}
      <form onSubmit={handleCreate} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="Nombre de la sucursal">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Ej: Sucursal Centro"
          />
        </Field>
        <Field label="Dirección (opcional)">
          <Input
            value={newAddress}
            onChange={(e) => setNewAddress(e.target.value)}
            placeholder="Ej: Av. Corrientes 1234"
          />
        </Field>
        <Button type="submit" disabled={createMutation.isPending}>
          <Plus size={16} /> Agregar
        </Button>
      </form>

      <ErrorText error={errors.message} />

      {isLoading ? (
        <Spinner />
      ) : (
        <ul className="space-y-2">
          {branches?.map((branch) => (
            <li key={branch.id} className="space-y-3 rounded-lg border border-neutral-200 px-4 py-2.5">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <p className="text-sm font-medium text-neutral-900">{branch.name}</p>
                  {branch.address && <p className="text-xs text-muted">{branch.address}</p>}
                </div>
                {!branch.is_active && <Badge color="red">Inactiva</Badge>}
                <Toggle
                  checked={branch.is_active}
                  onChange={(value) => updateMutation.mutate({ id: branch.id, is_active: value })}
                  label={`Activa: ${branch.name}`}
                  hideLabel
                  busy={savingBranch === branch.id}
                />
                <IconButton
                  label={`Eliminar ${branch.name}`}
                  tone="danger"
                  onClick={() => {
                    if (confirm(`¿Eliminar la sucursal "${branch.name}"?`)) deleteMutation.mutate(branch.id)
                  }}
                >
                  <Trash2 size={15} />
                </IconButton>
              </div>
              <PaymentMethodsField
                value={branch.payment_methods}
                busy={savingBranch === branch.id}
                onChange={(payment_methods) =>
                  updateMutation.mutate({ id: branch.id, payment_methods })
                }
              />
              <ErrorText error={errors.messageFor(branch.id)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
