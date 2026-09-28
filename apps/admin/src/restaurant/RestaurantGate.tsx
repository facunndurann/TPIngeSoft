import { useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Store } from 'lucide-react'
import { DEFAULT_MENU_DESIGN } from '@restaurant-platform/shared'
import { createRestaurant, myRestaurantKey, myRestaurantQuery } from '@/queries/restaurant'
import { supabase } from '@/lib/supabase'
import { Button, ErrorText, Field, Input, Spinner, Textarea } from '@restaurant-platform/ui'
import { DesignPicker } from '@/features/DesignPicker'
import { RestaurantContext } from './restaurant-context'

/**
 * Único control de acceso del panel. La consulta solo trae una membresía
 * owner/manager activa, así que todo lo que se monta adentro ya es
 * administración: ninguna ruta vuelve a preguntar el rol, y la RLS verifica los
 * permisos en cada consulta. Un empleado con profile y sin rol admin se echa; si
 * todavía no tiene restaurante, se muestra el onboarding.
 */
export function RestaurantGate({ userId, children }: { userId: string; children: ReactNode }) {
  const { data, isLoading, isError } = useQuery(myRestaurantQuery(userId))

  if (isLoading) return <Spinner />
  if (isError) {
    return (
      <div className="p-8">
        <ErrorText error="Tu cuenta no tiene acceso administrativo o no pudimos verificarlo." />
        <Button onClick={() => supabase.auth.signOut()}>Cerrar sesión</Button>
      </div>
    )
  }
  if (!data) return <CreateRestaurantScreen />

  return <RestaurantContext value={data}>{children}</RestaurantContext>
}

function CreateRestaurantScreen() {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [menuDesign, setMenuDesign] = useState(DEFAULT_MENU_DESIGN)
  const [branchName, setBranchName] = useState('Casa Central')

  const create = useMutation({
    mutationFn: () => createRestaurant({ name, description, menuDesign, branchName }),
    // Se espera a releer la membresía: el «Creando…» sigue hasta que el gate
    // encuentra el restaurante nuevo y monta el panel.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: myRestaurantKey }),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    create.mutate()
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas p-4">
      <title>Creá tu restaurante · Panel del restaurante</title>
      <div className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="rounded-xl bg-primary p-3 text-white">
            <Store size={22} />
          </div>
          <h1 className="text-xl font-bold text-neutral-900">Creá tu restaurante</h1>
          <p className="text-center text-sm text-muted">
            Tu cuenta todavía no administra ningún restaurante.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Nombre del restaurante">
            <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="La Esquina Burger" />
          </Field>
          <Field label="Descripción (opcional)">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Hamburguesas artesanales y papas"
            />
          </Field>
          <Field label="Nombre de la primera sucursal">
            <Input value={branchName} onChange={(e) => setBranchName(e.target.value)} required />
          </Field>
          <DesignPicker
            value={menuDesign}
            onChange={setMenuDesign}
            hint="Podés cambiarlo después desde Restaurante."
          />
          <ErrorText error={create.error} fallback="No pudimos crear el restaurante." />
          <Button type="submit" disabled={create.isPending} className="w-full">
            {create.isPending ? 'Creando…' : 'Crear restaurante'}
          </Button>
        </form>
        <button
          className="mt-4 w-full cursor-pointer text-center text-sm text-muted hover:underline"
          onClick={() => supabase.auth.signOut()}
        >
          Cerrar sesión
        </button>
      </div>
    </main>
  )
}
