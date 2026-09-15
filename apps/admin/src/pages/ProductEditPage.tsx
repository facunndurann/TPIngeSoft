import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { PRODUCT_MEDIA_LIMIT } from '@restaurant-platform/shared'
import { supabase } from '@/lib/supabase'
import { useRestaurant } from '@/restaurant/restaurant-context'
import { MediaUploader } from '@/features/MediaUploader'
import { savedMediaDrafts, uploadMediaDrafts, type MediaDraft } from '@/features/product-media'
import { Button, ErrorText, Field, Input, Select, Spinner, Textarea, Toggle } from '@/components/ui'

const DIETARY_TAGS = [
  { value: 'vegetariano', label: 'Vegetariano' },
  { value: 'vegano', label: 'Vegano' },
  { value: 'sin-tacc', label: 'Sin TACC' },
  { value: 'picante', label: 'Picante' },
]

interface IngredientDraft {
  id?: string
  name: string
  is_removable: boolean
  is_available: boolean
}

export function ProductEditPage() {
  const { productId } = useParams()
  const isNew = !productId
  const restaurant = useRestaurant()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Datos base del formulario
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [basePrice, setBasePrice] = useState('')
  const [foodInfo, setFoodInfo] = useState('')
  const [dietaryTags, setDietaryTags] = useState<string[]>([])
  const [isAvailable, setIsAvailable] = useState(true)
  const [media, setMedia] = useState<MediaDraft[]>([])
  const [ingredients, setIngredients] = useState<IngredientDraft[]>([])
  const [removedIngredientIds, setRemovedIngredientIds] = useState<string[]>([])
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([])
  const [loadedProduct, setLoadedProduct] = useState(isNew)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

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

  const { data: allGroups } = useQuery({
    queryKey: ['modifier-groups', restaurant.id],
    queryFn: async () => {
      const { data, error: qErr } = await supabase
        .from('modifier_groups')
        .select('*')
        .eq('restaurant_id', restaurant.id)
        .order('created_at')
      if (qErr) throw qErr
      return data
    },
  })

  const { data: existing, isLoading } = useQuery({
    queryKey: ['product', productId],
    enabled: !isNew,
    queryFn: async () => {
      const { data, error: qErr } = await supabase
        .from('products')
        .select('*, product_ingredients(*), product_modifier_groups(group_id)')
        .eq('id', productId!)
        .single()
      if (qErr) throw qErr
      return data
    },
  })

  useEffect(() => {
    if (!existing || loadedProduct) return
    setName(existing.name)
    setDescription(existing.description ?? '')
    setCategoryId(existing.category_id)
    setBasePrice(String(existing.base_price))
    setFoodInfo(existing.food_info ?? '')
    setDietaryTags(existing.dietary_tags)
    setIsAvailable(existing.is_available)
    setMedia(savedMediaDrafts(existing))
    setIngredients(
      [...existing.product_ingredients]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((i) => ({
          id: i.id,
          name: i.name,
          is_removable: i.is_removable,
          is_available: i.is_available,
        })),
    )
    setSelectedGroupIds(existing.product_modifier_groups.map((g) => g.group_id))
    setLoadedProduct(true)
  }, [existing, loadedProduct])

  function toggleTag(tag: string) {
    setDietaryTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]))
  }

  function toggleGroup(groupId: string) {
    setSelectedGroupIds((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId],
    )
  }

  function updateIngredient(index: number, patch: Partial<IngredientDraft>) {
    setIngredients((prev) => prev.map((ing, i) => (i === index ? { ...ing, ...patch } : ing)))
  }

  function removeIngredient(index: number) {
    const ingredient = ingredients[index]
    if (ingredient.id) setRemovedIngredientIds((prev) => [...prev, ingredient.id!])
    setIngredients((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleSave() {
    setError(null)
    const price = Number(basePrice)
    if (!name.trim()) return setError('El producto necesita un nombre')
    if (!categoryId) return setError('Elegí una categoría')
    if (Number.isNaN(price) || price < 0) return setError('El precio no es válido')
    if (ingredients.some((i) => !i.name.trim())) return setError('Todos los ingredientes necesitan nombre')

    setSaving(true)
    try {
      // 1. Fotos y videos: los archivos nuevos se suben en paralelo, respetando el orden.
      const { urls: mediaUrls, discardUploads } = await uploadMediaDrafts(restaurant.id, media)

      // 2. Producto
      const productData = {
        restaurant_id: restaurant.id,
        category_id: categoryId,
        name: name.trim(),
        description: description.trim() || null,
        base_price: price,
        food_info: foodInfo.trim() || null,
        dietary_tags: dietaryTags,
        is_available: isAvailable,
        media_urls: mediaUrls,
      }

      let savedId = productId
      try {
        if (isNew) {
          const { data, error: iErr } = await supabase
            .from('products')
            .insert(productData)
            .select()
            .single()
          if (iErr) throw iErr
          savedId = data.id
        } else {
          const { error: uErr } = await supabase.from('products').update(productData).eq('id', productId)
          if (uErr) throw uErr
        }
      } catch (productError) {
        // El producto no se guardó, así que nada referencia los archivos recién subidos.
        // (Si falla un paso posterior, los archivos se conservan: el producto ya los usa.)
        await discardUploads()
        throw productError
      }

      // 3. Ingredientes: eliminar los quitados, upsert del resto
      if (removedIngredientIds.length) {
        const { error: dErr } = await supabase
          .from('product_ingredients')
          .delete()
          .in('id', removedIngredientIds)
        if (dErr) throw dErr
      }
      for (const [index, ingredient] of ingredients.entries()) {
        const row = {
          restaurant_id: restaurant.id,
          product_id: savedId!,
          name: ingredient.name.trim(),
          is_removable: ingredient.is_removable,
          is_available: ingredient.is_available,
          sort_order: index,
        }
        if (ingredient.id) {
          const { error: iErr } = await supabase
            .from('product_ingredients')
            .update(row)
            .eq('id', ingredient.id)
          if (iErr) throw iErr
        } else {
          const { error: iErr } = await supabase.from('product_ingredients').insert(row)
          if (iErr) throw iErr
        }
      }

      // 4. Grupos de modificadores: sincronizar asignaciones
      const previousGroupIds = existing?.product_modifier_groups.map((g) => g.group_id) ?? []
      const toRemove = previousGroupIds.filter((id) => !selectedGroupIds.includes(id))
      const toAdd = selectedGroupIds.filter((id) => !previousGroupIds.includes(id))
      if (toRemove.length) {
        const { error: dErr } = await supabase
          .from('product_modifier_groups')
          .delete()
          .eq('product_id', savedId!)
          .in('group_id', toRemove)
        if (dErr) throw dErr
      }
      if (toAdd.length) {
        const { error: aErr } = await supabase.from('product_modifier_groups').insert(
          toAdd.map((groupId, index) => ({
            restaurant_id: restaurant.id,
            product_id: savedId!,
            group_id: groupId,
            sort_order: previousGroupIds.length + index,
          })),
        )
        if (aErr) throw aErr
      }

      await queryClient.invalidateQueries({ queryKey: ['products', restaurant.id] })
      await queryClient.invalidateQueries({ queryKey: ['product', savedId] })
      navigate('/productos')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error guardando el producto')
    } finally {
      setSaving(false)
    }
  }

  if (!isNew && isLoading) return <Spinner />

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center gap-3">
        <Link to="/productos" className="text-neutral-400 hover:text-neutral-700" aria-label="Volver">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-xl font-bold text-neutral-900">
          {isNew ? 'Nuevo producto' : `Editar "${existing?.name ?? ''}"`}
        </h1>
      </div>

      <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5">
        <h2 className="font-semibold text-neutral-900">Información básica</h2>
        <Field label="Nombre">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Hamburguesa clásica" />
        </Field>
        <Field label="Descripción">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Lo que ve el cliente debajo del nombre"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Categoría">
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Elegir…</option>
              {categories?.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Precio base ($)">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={basePrice}
              onChange={(e) => setBasePrice(e.target.value)}
              placeholder="8900"
            />
          </Field>
        </div>
        <Field label="Información alimentaria (opcional)">
          <Input
            value={foodInfo}
            onChange={(e) => setFoodInfo(e.target.value)}
            placeholder="Ej: contiene gluten y lactosa"
          />
        </Field>
        <div>
          <p className="mb-1.5 text-sm font-medium text-neutral-700">Etiquetas dietarias</p>
          <div className="flex flex-wrap gap-1.5">
            {DIETARY_TAGS.map((tag) => (
              <button
                key={tag.value}
                type="button"
                onClick={() => toggleTag(tag.value)}
                className={`cursor-pointer rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                  dietaryTags.includes(tag.value)
                    ? 'bg-indigo-600 text-white'
                    : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                }`}
              >
                {tag.label}
              </button>
            ))}
          </div>
        </div>
        <Toggle checked={isAvailable} onChange={setIsAvailable} label="Disponible para pedir" />
      </section>

      <section className="space-y-3 rounded-xl border border-neutral-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-neutral-900">Fotografía o video (máx {PRODUCT_MEDIA_LIMIT})</h2>
        </div>
        <MediaUploader value={media} onChange={setMedia} onError={setError} />
      </section>

      <section className="space-y-3 rounded-xl border border-neutral-200 bg-white p-5">
        <div>
          <h2 className="font-semibold text-neutral-900">Ingredientes</h2>
          <p className="text-sm text-neutral-500">
            Declarar la composición permite que el cliente quite lo que no quiere (solo lo marcado como
            removible).
          </p>
        </div>
        <div className="space-y-2">
          {ingredients.map((ingredient, index) => (
            <div key={ingredient.id ?? `new-${index}`} className="flex items-center gap-2">
              <Input
                value={ingredient.name}
                onChange={(e) => updateIngredient(index, { name: e.target.value })}
                placeholder="Ej: Cebolla"
                className="flex-1"
              />
              <Toggle
                checked={ingredient.is_removable}
                onChange={(value) => updateIngredient(index, { is_removable: value })}
                label="Removible"
              />
              <button
                className="cursor-pointer p-1 text-neutral-400 hover:text-red-600"
                onClick={() => removeIngredient(index)}
                aria-label="Quitar ingrediente"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
        <Button
          variant="secondary"
          onClick={() =>
            setIngredients((prev) => [...prev, { name: '', is_removable: true, is_available: true }])
          }
        >
          <Plus size={15} /> Agregar ingrediente
        </Button>
      </section>

      <section className="space-y-3 rounded-xl border border-neutral-200 bg-white p-5">
        <div>
          <h2 className="font-semibold text-neutral-900">Personalización</h2>
          <p className="text-sm text-neutral-500">
            Grupos de modificadores que aplican a este producto (se crean en la sección Modificadores).
          </p>
        </div>
        {!allGroups?.length ? (
          <p className="text-sm text-neutral-500">
            Todavía no hay grupos.{' '}
            <Link to="/modificadores" className="text-indigo-600 hover:underline">
              Crear el primero
            </Link>
          </p>
        ) : (
          <div className="space-y-1.5">
            {allGroups.map((group) => (
              <label key={group.id} className="flex cursor-pointer items-center gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={selectedGroupIds.includes(group.id)}
                  onChange={() => toggleGroup(group.id)}
                  className="h-4 w-4 accent-indigo-600"
                />
                <span className="font-medium text-neutral-800">{group.name}</span>
                <span className="text-xs text-neutral-500">
                  ({group.min_select > 0 ? 'obligatorio' : 'opcional'}, máx {group.max_select})
                </span>
              </label>
            ))}
          </div>
        )}
      </section>

      <ErrorText message={error} />

      <div className="flex justify-end gap-2 pb-8">
        <Link to="/productos">
          <Button variant="secondary">Cancelar</Button>
        </Link>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Guardando…' : isNew ? 'Crear producto' : 'Guardar cambios'}
        </Button>
      </div>
    </div>
  )
}
