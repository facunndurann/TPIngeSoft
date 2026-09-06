import { useState, type FormEvent, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Store } from 'lucide-react'
import { DEFAULT_MENU_DESIGN } from '@restaurant-platform/shared'
import { supabase } from '@/lib/supabase'
import { Button, ErrorText, Field, Input, Spinner, Textarea } from '@/components/ui'
import { DesignPicker } from '@/features/DesignPicker'
import { RestaurantContext } from './restaurant-context'

/**
 * Carga el restaurante del usuario autenticado. Si todavía no tiene uno,
 * muestra el onboarding para crearlo (restaurante + membresía owner +
 * sucursal inicial + POS interno).
 */
export function RestaurantGate({ children }: { children: ReactNode }) {
  const { data, isLoading } = useQuery({
    queryKey: ['my-restaurant'],
    queryFn: async () => {
      const { data: memberships, error } = await supabase
        .from('restaurant_members')
        .select('restaurant_id, restaurants(*)')
        .limit(1)
      if (error) throw error
      return memberships?.[0]?.restaurants ?? null
    },
  })

  if (isLoading) return <Spinner />
  if (!data) return <CreateRestaurantScreen />

  return <RestaurantContext value={data}>{children}</RestaurantContext>
}

function CreateRestaurantScreen() {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [menuDesign, setMenuDesign] = useState(DEFAULT_MENU_DESIGN)
  const [branchName, setBranchName] = useState('Casa Central')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const slug = name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')

      const { data: user } = await supabase.auth.getUser()
      if (!user.user) throw new Error('Sesión inválida')

      const { data: restaurant, error: rErr } = await supabase
        .from('restaurants')
        .insert({ name, slug, description: description || null, menu_design: menuDesign })
        .select()
        .single()
      if (rErr) throw rErr

      const { error: mErr } = await supabase.from('restaurant_members').insert({
        restaurant_id: restaurant.id,
        user_id: user.user.id,
        role: 'owner',
      })
      if (mErr) throw mErr

      const { error: bErr } = await supabase
        .from('branches')
        .insert({ restaurant_id: restaurant.id, name: branchName })
      if (bErr) throw bErr

      const { error: pErr } = await supabase
        .from('pos_integrations')
        .insert({ restaurant_id: restaurant.id, type: 'internal' })
      if (pErr) throw pErr

      await queryClient.invalidateQueries({ queryKey: ['my-restaurant'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error creando el restaurante')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-100 p-4">
      <div className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="rounded-xl bg-indigo-600 p-3 text-white">
            <Store size={22} />
          </div>
          <h1 className="text-xl font-bold text-neutral-900">Creá tu restaurante</h1>
          <p className="text-center text-sm text-neutral-500">
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
          <div>
            <p className="mb-2 text-sm font-medium text-neutral-700">Diseño de la carta</p>
            <p className="mb-3 text-xs text-neutral-500">
              Podés cambiarlo después desde Restaurante.
            </p>
            <DesignPicker value={menuDesign} onChange={setMenuDesign} />
          </div>
          <ErrorText message={error} />
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? 'Creando…' : 'Crear restaurante'}
          </Button>
        </form>
        <button
          className="mt-4 w-full cursor-pointer text-center text-sm text-neutral-500 hover:underline"
          onClick={() => supabase.auth.signOut()}
        >
          Cerrar sesión
        </button>
      </div>
    </main>
  )
}
