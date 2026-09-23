import { useState } from 'react'
import { formatPrice, productMedia } from '@restaurant-platform/shared'
import { QuantityField } from '@/components/QuantityField'
import { MediaCarousel } from '@/features/MediaCarousel'
import { groupRule, isSingleChoice, price, selectedInGroup, selectionIssues } from '@/features/menu'
import type { Ingredient, ModifierGroup, ModifierOption, Product } from '@/features/menu'
import { useMenuDesign } from '@/features/menu-design'
import type { CartItem } from '@/features/cart'

type ProductEditorProps = {
  product: Product
  initial?: CartItem
  /** Por qué la mesa no admite sumar ni cambiar platos ahora: el plato se ve, pero no se agrega. */
  locked?: string
  onSave: (item: CartItem) => void
  onClose: () => void
}

// Ids de los bloques que pueden tener un problema: al intentar agregar, el foco va al primero.
const INGREDIENTS_ID = 'product-ingredients'
const UNAVAILABLE_ID = 'product-unavailable'
const groupBlockId = (group: ModifierGroup) => `group-${group.id}`

/**
 * Armar un plato. Todo usa el mismo modelo: lo marcado va en el plato, sean
 * ingredientes u opciones. El botón está siempre a mano y hay dos clases de
 * problema: lo que se arregla eligiendo acá se dice al tocarlo, en el grupo donde
 * hay que elegir; lo que ninguna elección arregla (la mesa o el plato) apaga el
 * botón desde el principio y dice por qué.
 */
export function ProductEditor({ product, initial, locked, onSave, onClose }: ProductEditorProps) {
  const { copy } = useMenuDesign()
  const [item, setItem] = useState<CartItem>(initial ?? defaultItem(product))
  // Antes del primer intento no hay errores de elección: el comensal todavía no tuvo
  // oportunidad de elegir. Después se actualizan solos mientras corrige.
  const [attempted, setAttempted] = useState(false)
  const issues = selectionIssues(product, item)
  // Lo que no depende de elegir: la mesa no admite cambios o el plato no se puede pedir.
  const unavailable = [...(locked ? [locked] : []), ...issues.product]

  // Los bloques con problema en el orden de la pantalla, de arriba hacia el botón.
  const blocked = [
    ...(issues.ingredients.length > 0 ? [INGREDIENTS_ID] : []),
    ...product.groups.filter((group) => issues.groups[group.id]).map(groupBlockId),
  ]

  const save = () => {
    if (blocked.length === 0) {
      onSave(item)
      return
    }
    setAttempted(true)
    // Al centro, para que no lo tapen ni las pestañas de arriba ni el botón fijo de abajo.
    const target = document.getElementById(blocked[0])
    target?.focus({ preventScroll: true })
    target?.scrollIntoView({ block: 'center' })
  }

  return (
    <section className="editor" aria-labelledby="product-title">
      <button className="text-button" onClick={onClose}>
        ← Volver
      </button>
      <MediaCarousel media={productMedia(product)} alt={product.name} />
      <p className="eyebrow">{copy.product}</p>
      <h2 className="hero-title" id="product-title">
        {product.name}
      </h2>
      <p>{product.description}</p>
      <strong>{formatPrice(product.base_price)}</strong>
      {product.food_info && <p className="notice">{product.food_info}</p>}
      {product.dietary_tags.length > 0 && <p>{product.dietary_tags.join(' · ')}</p>}

      {product.ingredients.length > 0 && (
        <IngredientsFieldset
          ingredients={product.ingredients}
          removedIds={item.removedIds}
          error={attempted ? issues.ingredients.join(' ') : undefined}
          onToggle={(ingredientId, included) => {
            const removedIds = item.removedIds.filter((id) => id !== ingredientId)
            setItem({ ...item, removedIds: included ? removedIds : [...removedIds, ingredientId] })
          }}
        />
      )}

      {product.groups.map((group) => (
        <GroupFieldset
          key={group.id}
          group={group}
          optionIds={item.optionIds}
          error={attempted ? issues.groups[group.id] : undefined}
          onChange={(optionIds) => setItem({ ...item, optionIds })}
        />
      ))}

      <div className="choice">
        <span>Cantidad</span>
        <QuantityField
          value={item.quantity}
          onChange={(quantity) => setItem({ ...item, quantity })}
        />
      </div>
      <label className="choice">
        <span>Para compartir con la mesa</span>
        <input
          type="checkbox"
          checked={item.isShared}
          onChange={(event) => setItem({ ...item, isShared: event.target.checked })}
        />
      </label>

      <div className="editor-submit">
        {/* El motivo va pegado al botón apagado, y el botón lo tiene como descripción. */}
        {unavailable.length > 0 && (
          <p className="notice" id={UNAVAILABLE_ID}>
            {unavailable.join(' ')}
          </p>
        )}
        <button
          className="primary wide"
          disabled={unavailable.length > 0}
          aria-describedby={unavailable.length > 0 ? UNAVAILABLE_ID : undefined}
          onClick={save}
        >
          {initial ? 'Guardar cambios' : 'Agregar al carrito'} · {formatPrice(price(product, item))}
        </button>
      </div>
    </section>
  )
}

function defaultItem(product: Product): CartItem {
  return {
    id: crypto.randomUUID(),
    productId: product.id,
    quantity: 1,
    optionIds: [],
    // Lo agotado arranca afuera del plato; si no se puede quitar, el plato no se puede pedir.
    removedIds: product.ingredients
      .filter((ingredient) => !ingredient.is_available && ingredient.is_removable)
      .map((ingredient) => ingredient.id),
    isShared: false,
  }
}

/** La regla y, después de un intento, el error: los dos describen al bloque que se enfoca. */
function describedBy(id: string, rule: boolean, error?: string) {
  return [rule && `${id}-rule`, error && `${id}-error`].filter(Boolean).join(' ') || undefined
}

function IngredientsFieldset({
  ingredients,
  removedIds,
  error,
  onToggle,
}: {
  ingredients: Ingredient[]
  removedIds: string[]
  error?: string
  onToggle: (ingredientId: string, included: boolean) => void
}) {
  const choosable = ingredients.some((ingredient) => ingredient.is_removable && ingredient.is_available)

  return (
    <fieldset
      id={INGREDIENTS_ID}
      tabIndex={-1}
      className={error ? 'is-invalid' : undefined}
      aria-describedby={describedBy(INGREDIENTS_ID, choosable, error)}
    >
      <legend>Ingredientes</legend>
      {choosable && (
        <p className="muted" id={`${INGREDIENTS_ID}-rule`}>
          Destildá lo que no quieras.
        </p>
      )}
      {error && (
        <p className="field-error" id={`${INGREDIENTS_ID}-error`}>
          {error}
        </p>
      )}
      {ingredients.map((ingredient) => {
        const included = !removedIds.includes(ingredient.id)
        const notes = [!ingredient.is_available && 'Agotado', !ingredient.is_removable && 'No se puede quitar']
          .filter(Boolean)
          .join(' · ')
        return (
          <label className="choice" key={ingredient.id}>
            <span>
              {ingredient.name}
              {notes && <small>{notes}</small>}
            </span>
            <input
              type="checkbox"
              checked={included}
              // Solo se apaga el paso hacia lo inválido: sumar algo agotado o sacar
              // algo fijo. El camino de vuelta siempre queda abierto.
              disabled={(included && !ingredient.is_removable) || (!included && !ingredient.is_available)}
              onChange={(event) => onToggle(ingredient.id, event.target.checked)}
            />
          </label>
        )
      })}
    </fieldset>
  )
}

function GroupFieldset({
  group,
  optionIds,
  error,
  onChange,
}: {
  group: ModifierGroup
  optionIds: string[]
  error?: string
  onChange: (optionIds: string[]) => void
}) {
  const id = groupBlockId(group)
  const single = isSingleChoice(group)
  const atMax = !single && selectedInGroup(group, optionIds) >= group.max_select
  // Cada grupo reescribe solo lo suyo: lo elegido en los otros grupos queda como está.
  const others = optionIds.filter((optionId) => !group.options.some((option) => option.id === optionId))

  return (
    <fieldset
      id={id}
      tabIndex={-1}
      className={error ? 'is-invalid' : undefined}
      aria-describedby={describedBy(id, true, error)}
    >
      <legend>{group.name}</legend>
      <p className="muted" id={`${id}-rule`}>
        {groupRule(group)}
      </p>
      {error && (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
      {/* Un radio no se destilda: si el grupo es opcional, «Ninguna» es la vuelta atrás. */}
      {single && group.min_select === 0 && (
        <label className="choice">
          <span>Ninguna</span>
          <input
            type="radio"
            name={id}
            checked={selectedInGroup(group, optionIds) === 0}
            onChange={() => onChange(others)}
          />
        </label>
      )}
      {group.options.map((option) => {
        const selected = optionIds.includes(option.id)
        return (
          <label className="choice" key={option.id}>
            <span>
              {option.name}
              <small>{optionNote(option)}</small>
            </span>
            <input
              type={single ? 'radio' : 'checkbox'}
              name={id}
              checked={selected}
              // Lo agotado o lo que pasaría el techo no se puede sumar; lo ya elegido
              // siempre se puede sacar.
              disabled={!selected && (!option.is_available || !group.is_available || atMax)}
              onChange={(event) => {
                if (single) onChange([...others, option.id])
                else if (event.target.checked) onChange([...optionIds, option.id])
                else onChange(optionIds.filter((optionId) => optionId !== option.id))
              }}
            />
          </label>
        )
      })}
    </fieldset>
  )
}

function optionNote(option: ModifierOption) {
  if (!option.is_available) return 'Agotado'
  return option.price_delta === 0 ? 'Sin cargo' : formatPrice(option.price_delta)
}
