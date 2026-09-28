import { useId, useState } from 'react'
import { flushSync } from 'react-dom'
import { Link, useNavigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { DIETARY_TAGS, PRODUCT_MEDIA_LIMIT, type Tables } from '@restaurant-platform/shared'
import {
  Button,
  buttonClass,
  ChoiceChip,
  ErrorText,
  IconButton,
  Field,
  Input,
  QueryView,
  Select,
  Textarea,
  Toggle,
  useSaveErrors,
  useToast,
} from '@restaurant-platform/ui'
import { categoriesQuery } from '@/queries/categories'
import { modifierGroupsQuery, type ModifierGroupWithOptions } from '@/queries/modifier-groups'
import { productQuery, productsByCategoryQuery, saveProduct } from '@/queries/products'
import { useRestaurant } from '@/restaurant/restaurant-context'
import { MediaUploader } from '@/features/MediaUploader'
import { Page } from '@/features/Page'
import { UnsavedChangesGuard } from '@/features/UnsavedChangesGuard'
import {
  draftFrom,
  emptyDraft,
  parseProductDraft,
  type DraftField,
  type IngredientDraft,
  type ProductDraft,
  type ProductPayload,
} from '@/features/product-draft'

/**
 * Resuelve los datos y recién ahí monta el formulario, ya cargado. El `key` es
 * el patrón que el resto del proyecto usa para esto (TableApp, CartPanel,
 * ProductEditor): reemplaza al efecto de hidratación, a su flag `loadedProduct`
 * y al estado a medio llenar que había entre medio.
 *
 * El formulario se monta con todo lo que muestra, no solo con el producto: si
 * no, mientras cargan, la categoría no tendría opciones y la personalización
 * diría «Todavía no hay grupos». El producto se lee solo al editar.
 */
export function ProductEditPage() {
  const { productId } = useParams()
  const restaurant = useRestaurant()

  const categories = useQuery(categoriesQuery(restaurant.id))
  const groups = useQuery(modifierGroupsQuery(restaurant.id))
  const product = useQuery({ ...productQuery(productId ?? ''), enabled: !!productId })

  const title = !productId ? 'Nuevo producto' : product.data ? `Editar "${product.data.name}"` : 'Producto'

  return (
    <Page title={title} back={{ to: '/productos', label: 'Volver a productos' }}>
      <QueryView query={[categories, groups]}>
        {([categories, groups]) =>
          productId ? (
            <QueryView query={product}>
              {(product) => (
                <ProductForm
                  key={productId}
                  productId={productId}
                  initial={draftFrom(product)}
                  categories={categories}
                  groups={groups}
                />
              )}
            </QueryView>
          ) : (
            <ProductForm key="new" initial={emptyDraft()} categories={categories} groups={groups} />
          )
        }
      </QueryView>
    </Page>
  )
}

type ProductFormProps = {
  /** Ausente al crear: `saveProduct` pide el id nuevo a la RPC. */
  productId?: string
  initial: ProductDraft
  categories: Tables<'menu_categories'>[]
  groups: ModifierGroupWithOptions[]
}

function ProductForm({ productId, initial, categories, groups }: ProductFormProps) {
  const restaurant = useRestaurant()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const errors = useSaveErrors()
  const toast = useToast()
  const dietaryLabelId = useId()

  // Un solo estado, inicializado con lo que ya llegó: no hay paso intermedio.
  // Cada cambio arma un borrador nuevo, así que distinto del inicial es «editado».
  const [draft, setDraft] = useState(initial)
  const patch = (changes: Partial<ProductDraft>) =>
    setDraft((current) => ({ ...current, ...changes }))
  // Ya guardado, volver a la lista no pierde nada: el guard se apaga antes de navegar.
  const [saved, setSaved] = useState(false)

  // Los errores de cada campo aparecen recién al intentar guardar; desde ahí se
  // recalculan con cada cambio, así el campo corregido deja de marcarse solo.
  const formId = useId()
  const fieldId = (field: DraftField) => `${formId}-${field}`
  const [attempted, setAttempted] = useState(false)
  const parsed = parseProductDraft(draft)
  const fieldErrors = attempted && !parsed.ok ? parsed.errors : []
  const errorFor = (field: DraftField) =>
    fieldErrors.find((error) => error.field === field)?.message

  const save = useMutation(errors.saving('No pudimos guardar el producto.', {
    mutationFn: (payload: ProductPayload) => saveProduct({ restaurantId: restaurant.id, productId, payload }),
    onSuccess: async (savedId, payload) => {
      // Las dos cachés son independientes: no hay razón para encadenarlas.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: productsByCategoryQuery(restaurant.id).queryKey }),
        queryClient.invalidateQueries({ queryKey: productQuery(savedId).queryKey }),
      ])
      // La lista no dice por sí sola que el guardado salió: lo dice el aviso.
      toast(productId ? `Guardamos los cambios de «${payload.name.trim()}».` : `Creamos «${payload.name.trim()}».`)
      // Síncrono: el router tiene que ver el guard ya apagado cuando llega el navigate.
      flushSync(() => setSaved(true))
      navigate('/productos')
    },
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

  const toggle = <T,>(list: T[], value: T) =>
    list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]

  const updateIngredient = (index: number, changes: Partial<IngredientDraft>) =>
    patch({
      ingredients: draft.ingredients.map((ingredient, i) =>
        i === index ? { ...ingredient, ...changes } : ingredient,
      ),
    })

  return (
    <>
      <UnsavedChangesGuard when={draft !== initial && !saved} />
      <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5">
        <h2 className="font-semibold text-neutral-900">Información básica</h2>
        <Field label="Nombre" error={errorFor('name')}>
          <Input
            id={fieldId('name')}
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
          <Field label="Categoría" error={errorFor('categoryId')}>
            <Select
              id={fieldId('categoryId')}
              value={draft.categoryId}
              onChange={(e) => patch({ categoryId: e.target.value })}
            >
              <option value="">Elegir…</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Precio base ($)" error={errorFor('basePrice')}>
            <Input
              id={fieldId('basePrice')}
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
          {draft.ingredients.map((ingredient, index) => {
            // Las filas no van en un Field (no tienen rótulo visible), así que el
            // error y su enlace con el campo se arman acá.
            const field = `ingredient-${index}` as const
            const error = errorFor(field)
            const errorId = `${fieldId(field)}-error`
            return (
              <div key={ingredient.id ?? `new-${index}`}>
                <div className="flex items-center gap-2">
                  <Input
                    id={fieldId(field)}
                    value={ingredient.name}
                    onChange={(e) => updateIngredient(index, { name: e.target.value })}
                    placeholder="Ej: Cebolla"
                    aria-label={`Ingrediente ${index + 1}`}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? errorId : undefined}
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
                {error && (
                  <p id={errorId} className="mt-1 text-xs text-red-700">
                    {error}
                  </p>
                )}
              </div>
            )
          })}
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
        <Link to="/productos" className={buttonClass('secondary')}>
          Cancelar
        </Link>
        <Button onClick={submit} disabled={save.isPending}>
          {save.isPending ? 'Guardando…' : productId ? 'Guardar cambios' : 'Crear producto'}
        </Button>
      </div>
    </>
  )
}
