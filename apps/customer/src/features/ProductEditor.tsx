import { useState } from 'react'
import { productMedia } from '@restaurant-platform/shared'
import { MediaCarousel } from '@/features/MediaCarousel'
import { money, price, selectionErrors } from '@/features/menu'
import type { ModifierGroup, ModifierOption, Product } from '@/features/menu'
import { useMenuDesign } from '@/features/menu-design'
import type { CartItem } from '@/stores/cart'

type ProductEditorProps = {
  product: Product
  initial?: CartItem
  onSave: (item: CartItem) => void
  onClose: () => void
}

export function ProductEditor({ product, initial, onSave, onClose }: ProductEditorProps) {
  const { copy } = useMenuDesign()
  const [item, setItem] = useState<CartItem>(initial ?? defaultItem(product))
  const errors = selectionErrors(product, item)

  return (
    <section className="editor" aria-labelledby="product-title">
      <button className="text-button" onClick={onClose}>
        ← Volver
      </button>
      <MediaCarousel media={productMedia(product)} variant="hero" alt={product.name} />
      <p className="eyebrow">{copy.product}</p>
      <h1 id="product-title">{product.name}</h1>
      <p>{product.description}</p>
      <strong>{money(product.base_price)}</strong>
      {product.food_info && <p className="notice">{product.food_info}</p>}
      {product.dietary_tags.length > 0 && <p>{product.dietary_tags.join(' · ')}</p>}

      {product.ingredients.length > 0 && (
        <fieldset>
          <legend>Ingredientes</legend>
          {product.ingredients.map((ingredient) => (
            <IngredientChoice
              key={ingredient.id}
              name={ingredient.name}
              available={ingredient.is_available}
              removable={ingredient.is_removable}
              removed={item.removedIds.includes(ingredient.id)}
              onToggle={(checked) => {
                const removedIds = checked
                  ? [...item.removedIds, ingredient.id]
                  : item.removedIds.filter((id) => id !== ingredient.id)
                setItem({ ...item, removedIds })
              }}
            />
          ))}
        </fieldset>
      )}

      {product.groups.map((group) => (
        <fieldset key={group.id}>
          <legend>{group.name}</legend>
          <p className="muted">
            {group.min_select > 0 ? 'Obligatorio' : 'Opcional'} · Elegí {group.min_select} a{' '}
            {group.max_select}
            {!group.is_available && ' · Agotado'}
          </p>
          {group.options.map((option) => (
            <label className="choice" key={option.id}>
              <span>
                {option.name}
                <small>
                  {option.is_available
                    ? option.price_delta === 0
                      ? 'Sin cargo'
                      : money(option.price_delta)
                    : 'Agotado'}
                </small>
              </span>
              <input
                type="checkbox"
                checked={item.optionIds.includes(option.id)}
                disabled={isOptionDisabled(group, option, item.optionIds)}
                onChange={(event) => {
                  setItem(toggleOption(item, group, option.id, event.target.checked))
                }}
              />
            </label>
          ))}
        </fieldset>
      ))}

      <label className="choice">
        <span>Cantidad</span>
        <input
          aria-label="Cantidad"
          type="number"
          min="1"
          max="99"
          value={item.quantity}
          onChange={(event) => setItem({ ...item, quantity: Number(event.target.value) })}
        />
      </label>
      <label className="choice">
        <span>Para compartir con la mesa</span>
        <input
          type="checkbox"
          checked={item.isShared}
          onChange={(event) => setItem({ ...item, isShared: event.target.checked })}
        />
      </label>

      {errors.length > 0 && (
        <ul className="notice">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}

      <button
        className="primary wide"
        disabled={errors.length > 0}
        onClick={() => onSave(item)}
      >
        {initial ? 'Guardar cambios' : 'Agregar al carrito'} · {money(price(product, item))}
      </button>
    </section>
  )
}

function defaultItem(product: Product): CartItem {
  return {
    id: crypto.randomUUID(),
    productId: product.id,
    quantity: 1,
    optionIds: [],
    removedIds: product.ingredients
      .filter((ingredient) => !ingredient.is_available && ingredient.is_removable)
      .map((ingredient) => ingredient.id),
    isShared: false,
  }
}

function IngredientChoice({
  name,
  available,
  removable,
  removed,
  onToggle,
}: {
  name: string
  available: boolean
  removable: boolean
  removed: boolean
  onToggle: (checked: boolean) => void
}) {
  return (
    <label className="choice">
      <span>
        {name} {!available && '· Agotado'} {!removable && '· Incluido'}
      </span>
      {removable && (
        <span>
          <input
            type="checkbox"
            checked={removed}
            disabled={!available && removed}
            onChange={(event) => onToggle(event.target.checked)}
          />{' '}
          Quitar
        </span>
      )}
    </label>
  )
}

function isOptionDisabled(group: ModifierGroup, option: ModifierOption, optionIds: string[]) {
  const selected = optionIds.includes(option.id)
  const unavailable = !option.is_available || !group.is_available
  const selectedInGroup = group.options.filter((entry) => optionIds.includes(entry.id)).length
  const atMax = group.max_select > 1 && selectedInGroup >= group.max_select

  return (unavailable && !selected) || (!selected && atMax)
}

function toggleOption(item: CartItem, group: ModifierGroup, optionId: string, checked: boolean): CartItem {
  // En un grupo de selección única, elegir una opción reemplaza a la anterior del grupo.
  const others = item.optionIds.filter((id) => {
    if (id === optionId) return false
    if (group.max_select !== 1) return true
    return !group.options.some((option) => option.id === id)
  })

  return { ...item, optionIds: checked ? [...others, optionId] : others }
}
