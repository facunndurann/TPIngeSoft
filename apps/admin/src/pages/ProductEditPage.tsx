import { useId, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { DIETARY_TAGS, PRODUCT_MEDIA_LIMIT, type Tables } from '@restaurant-platform/shared'
import {
  Button,
  ChoiceChip,
  ErrorText,
  IconButton,
  iconButtonClass,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
  Toggle,
  useSaveErrors,
} from '@restaurant-platform/ui'
import { categoriesQuery } from '@/queries/categories'
import { modifierGroupsQuery, type ModifierGroupWithOptions } from '@/queries/modifier-groups'
import { productQuery, productsByCategoryQuery, saveProduct } from '@/queries/products'
import { useRestaurant } from '@/restaurant/restaurant-context'
import { MediaUploader } from '@/features/MediaUploader'
import {
  draftErrors,
  draftFrom,
  emptyDraft,
  type IngredientDraft,
  type ProductDraft,
} from '@/features/product-draft'

/**
 * Resuelve los datos y recién ahí monta el formulario, ya cargado. El `key` es
 * el patrón que el resto del proyecto usa para esto (TableApp, CartPanel,
 * ProductEditor): reemplaza al efecto de hidratación, a su flag `loadedProduct`
 * y al estado a medio llenar que había entre medio.
 */
export function ProductEditPage() {
  const { productId } = useParams()
  const restaurant = useRestaurant()

  const categories = useQuery(categoriesQuery(restaurant.id))
  const groups = useQuery(modifierGroupsQuery(restaurant.id))
  const product = useQuery({ ...productQuery(productId ?? ''), enabled: !!productId })

  // El formulario se monta con todo lo que muestra, no solo con el producto: si
  // no, mientras cargan, la categoría no tendría opciones y la personalización
  // diría «Todavía no hay grupos».
  if (categories.isLoading || groups.isLoading || (productId && product.isLoading)) {
    return <Spinner />
  }
  if (!categories.data || !groups.data || (productId && !product.data)) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <BackLink />
        <ErrorText error="No pudimos cargar los datos del producto. Volvé a la lista e intentá de nuevo." />
      </div>
    )
  }

  return (
    <ProductForm
      key={productId ?? 'new'}
      productId={productId}
      title={product.data ? `Editar "${product.data.name}"` : 'Nuevo producto'}
      initial={product.data ? draftFrom(product.data) : emptyDraft()}
      categories={categories.data}
      groups={groups.data}
    />
  )
}

function BackLink() {
  return (
    <Link
      to="/productos"
      className={iconButtonClass()}
      aria-label="Volver a productos"
      title="Volver a productos"
    >
      <ArrowLeft size={20} />
    </Link>
  )
}

type ProductFormProps = {
  /** Ausente al crear: `saveProduct` pide el id nuevo a la RPC. */
  productId?: string
  title: string
  initial: ProductDraft
  categories: Tables<'menu_categories'>[]
  groups: ModifierGroupWithOptions[]
}

function ProductForm({ productId, title, initial, categories, groups }: ProductFormProps) {
  const restaurant = useRestaurant()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const errors = useSaveErrors()
  const dietaryLabelId = useId()

  // Un solo estado, inicializado con lo que ya llegó: no hay paso intermedio.
  const [draft, setDraft] = useState(initial)
  const patch = (changes: Partial<ProductDraft>) =>
    setDraft((current) => ({ ...current, ...changes }))

  const save = useMutation(errors.saving('No pudimos guardar el producto.', {
    mutationFn: async () => {
      const invalid = draftErrors(draft)
      if (invalid) throw new Error(invalid)
      return saveProduct({ restaurantId: restaurant.id, productId, draft })
    },
    onSuccess: async (savedId) => {
      // Las dos cachés son independientes: no hay razón para encadenarlas.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: productsByCategoryQuery(restaurant.id).queryKey }),
        queryClient.invalidateQueries({ queryKey: productQuery(savedId).queryKey }),
      ])
      navigate('/productos')
    },
  }))

  const toggle = <T,>(list: T[], value: T) =>
    list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]

  const updateIngredient = (index: number, changes: Partial<IngredientDraft>) =>
    patch({
      ingredients: draft.ingredients.map((ingredient, i) =>
        i === index ? { ...ingredient, ...changes } : ingredient,
      ),
    })

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center gap-3">
        <BackLink />
        <h1 className="text-xl font-bold text-neutral-900">{title}</h1>
      </div>

      <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5">
        <h2 className="font-semibold text-neutral-900">Información básica</h2>
        <Field label="Nombre">
          <Input
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="Ej: Hamburguesa clásica"
          />
        </Field>
        <Field label="Descripción">
          <Textarea
            value={draft.description}
            onChange={(e) => patch({ description: e.target.value })}
            rows={2}
            placeholder="Lo que ve el cliente debajo del nombre"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Categoría">
            <Select value={draft.categoryId} onChange={(e) => patch({ categoryId: e.target.value })}>
              <option value="">Elegir…</option>
              {categories.map((category) => (
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
              value={draft.basePrice}
              onChange={(e) => patch({ basePrice: e.target.value })}
              placeholder="8900"
            />
          </Field>
        </div>
        <Field label="Información alimentaria (opcional)">
          <Input
            value={draft.foodInfo}
            onChange={(e) => patch({ foodInfo: e.target.value })}
            placeholder="Ej: contiene gluten y lactosa"
          />
        </Field>
        <div>
          <p id={dietaryLabelId} className="mb-1.5 text-sm font-medium text-neutral-700">
            Etiquetas dietarias
          </p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby={dietaryLabelId}>
            {DIETARY_TAGS.map((tag) => (
              <ChoiceChip
                key={tag.value}
                pressed={draft.dietaryTags.includes(tag.value)}
                onClick={() => patch({ dietaryTags: toggle(draft.dietaryTags, tag.value) })}
              >
                {tag.label}
              </ChoiceChip>
            ))}
          </div>
        </div>
        <Toggle
          checked={draft.isAvailable}
          onChange={(isAvailable) => patch({ isAvailable })}
          label="Disponible para pedir"
        />
      </section>

      <section className="space-y-3 rounded-xl border border-neutral-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-neutral-900">
            Fotografía o video (máx {PRODUCT_MEDIA_LIMIT})
          </h2>
        </div>
        <MediaUploader
          value={draft.media}
          onChange={(media) => patch({ media })}
          onError={(message) => (message ? errors.report(message) : errors.clear())}
        />
      </section>

      <section className="space-y-3 rounded-xl border border-neutral-200 bg-white p-5">
        <div>
          <h2 className="font-semibold text-neutral-900">Ingredientes</h2>
          <p className="text-sm text-muted">
            Declarar la composición permite que el cliente quite lo que no quiere (solo lo marcado como
            removible).
          </p>
        </div>
        <div className="space-y-2">
          {draft.ingredients.map((ingredient, index) => (
            <div key={ingredient.id ?? `new-${index}`} className="flex items-center gap-2">
              <Input
                value={ingredient.name}
                onChange={(e) => updateIngredient(index, { name: e.target.value })}
                placeholder="Ej: Cebolla"
                aria-label={`Ingrediente ${index + 1}`}
                className="flex-1"
              />
              <Toggle
                checked={ingredient.is_removable}
                onChange={(is_removable) => updateIngredient(index, { is_removable })}
                label="Removible"
              />
              <IconButton
                label={`Quitar ${ingredient.name.trim() || `ingrediente ${index + 1}`}`}
                tone="danger"
                onClick={() => patch({ ingredients: draft.ingredients.filter((_, i) => i !== index) })}
              >
                <Trash2 size={15} />
              </IconButton>
            </div>
          ))}
        </div>
        <Button
          variant="secondary"
          onClick={() =>
            patch({
              ingredients: [...draft.ingredients, { name: '', is_removable: true, is_available: true }],
            })
          }
        >
          <Plus size={15} /> Agregar ingrediente
        </Button>
      </section>

      <section className="space-y-3 rounded-xl border border-neutral-200 bg-white p-5">
        <div>
          <h2 className="font-semibold text-neutral-900">Personalización</h2>
          <p className="text-sm text-muted">
            Grupos de modificadores que aplican a este producto (se crean en la sección Modificadores).
          </p>
        </div>
        {groups.length === 0 ? (
          <p className="text-sm text-muted">
            Todavía no hay grupos.{' '}
            <Link to="/modificadores" className="text-primary hover:underline">
              Crear el primero
            </Link>
          </p>
        ) : (
          <div className="space-y-1.5">
            {groups.map((group) => (
              <label key={group.id} className="flex cursor-pointer items-center gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={draft.groupIds.includes(group.id)}
                  onChange={() => patch({ groupIds: toggle(draft.groupIds, group.id) })}
                  className="h-4 w-4 accent-primary"
                />
                <span className="font-medium text-neutral-800">{group.name}</span>
                <span className="text-xs text-muted">
                  ({group.min_select > 0 ? 'obligatorio' : 'opcional'}, máx {group.max_select})
                </span>
              </label>
            ))}
          </div>
        )}
      </section>

      <ErrorText error={errors.message} />

      <div className="flex justify-end gap-2 pb-8">
        <Link to="/productos">
          <Button variant="secondary">Cancelar</Button>
        </Link>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? 'Guardando…' : productId ? 'Guardar cambios' : 'Crear producto'}
        </Button>
      </div>
    </div>
  )
}
