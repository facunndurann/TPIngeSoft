import { useState } from 'react'
import { money, price, productGroups, selectionErrors } from '@/features/menu'
import type { Menu, Product } from '@/features/menu'
import { useMenuDesign } from '@/features/menu-design'
import type { CartItem } from '@/stores/cart'

type ProductEditorProps = {
  menu: Menu
  product: Product
  initial?: CartItem
  onSave: (item: CartItem) => void
  onClose: () => void
}

export function ProductEditor({ menu, product, initial, onSave, onClose }: ProductEditorProps) {
  const { copy } = useMenuDesign()
  const [item, setItem] = useState<CartItem>(initial ?? defaultItem(menu, product))
  const errors = selectionErrors(menu, product, item)
  const ingredients = menu.ingredients.filter((ingredient) => ingredient.product_id === product.id)

  return (
    <section className="editor" aria-labelledby="product-title">
      <button className="text-button" onClick={onClose}>
        ← Volver
      </button>
      {product.photo_url && (
        product.photo_url.match(/\.(mp4|webm|ogg|mov)$/i) ? (
          <video
            className="hero-photo bg-black object-cover"
            src={product.photo_url}
            controls
            preload="metadata"
            playsInline
          />
        ) : (
          <img className="hero-photo" src={product.photo_url} alt={product.name} />
        )
      )}
      <p className="eyebrow">{copy.product}</p>
      <h1 id="product-title">{product.name}</h1>
      <p>{product.description}</p>
      <strong>{money(product.base_price)}</strong>
      {product.food_info && <p className="notice">{product.food_info}</p>}
      {product.dietary_tags.length > 0 && <p>{product.dietary_tags.join(' · ')}</p>}

      {ingredients.length > 0 && (
        <fieldset>
          <legend>Ingredientes</legend>
          {ingredients.map((ingredient) => (
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

      {productGroups(menu, product.id).map((group) => (
        <fieldset key={group.id}>
          <legend>{group.name}</legend>
          <p className="muted">
            {group.min_select > 0 ? 'Obligatorio' : 'Opcional'} · Elegí {group.min_select} a{' '}
            {group.max_select}
            {!group.is_available && ' · Agotado'}
          </p>
          {menu.options
            .filter((option) => option.group_id === group.id)
            .map((option) => (
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
                  disabled={isOptionDisabled(menu, group, option, item.optionIds)}
                  onChange={(event) => {
                    setItem(toggleOption(item, menu, group, option.id, event.target.checked))
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
        {initial ? 'Guardar cambios' : 'Agregar al carrito'} · {money(price(menu, product, item))}
      </button>
    </section>
  )
}

function defaultItem(menu: Menu, product: Product): CartItem {
  return {
    id: crypto.randomUUID(),
    productId: product.id,
    quantity: 1,
    optionIds: [],
    removedIds: menu.ingredients
      .filter((ingredient) => ingredient.product_id === product.id && !ingredient.is_available && ingredient.is_removable)
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

function selectedInGroup(menu: Menu, groupId: string, optionIds: string[]) {
  return menu.options.filter((option) => option.group_id === groupId && optionIds.includes(option.id))
}

function isOptionDisabled(
  menu: Menu,
  group: { id: string; is_available: boolean; max_select: number },
  option: { id: string; is_available: boolean },
  optionIds: string[],
) {
  const selected = optionIds.includes(option.id)
  const unavailable = !option.is_available || !group.is_available
  const atMax =
    group.max_select > 1 && selectedInGroup(menu, group.id, optionIds).length >= group.max_select

  return (unavailable && !selected) || (!selected && atMax)
}

function toggleOption(
  item: CartItem,
  menu: Menu,
  group: { id: string; max_select: number },
  optionId: string,
  checked: boolean,
): CartItem {
  const others = item.optionIds.filter((id) => {
    if (id === optionId) return false
    if (group.max_select !== 1) return true
    return !menu.options.some((option) => option.id === id && option.group_id === group.id)
  })

  return { ...item, optionIds: checked ? [...others, optionId] : others }
}
