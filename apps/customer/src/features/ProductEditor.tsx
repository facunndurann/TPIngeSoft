import { useState } from 'react'
import { money, price, productGroups, selectionErrors } from './menu'
import type { Menu, Product } from './menu'
import type { CartItem } from '../stores/cart'

export function ProductEditor({ menu, product, initial, onSave, onClose }: {
  menu: Menu; product: Product; initial?: CartItem; onSave: (item: CartItem) => void; onClose: () => void
}) {
  const [item, setItem] = useState<CartItem>(initial ?? {
    id: crypto.randomUUID(), productId: product.id, quantity: 1, optionIds: [],
    removedIds: menu.ingredients.filter(i => i.product_id === product.id && !i.is_available && i.is_removable).map(i => i.id), isShared: false,
  })
  const errors = selectionErrors(menu, product, item)
  return <section className="editor" aria-labelledby="product-title">
    <button className="text-button" onClick={onClose}>← Volver</button>
    {product.photo_url && <img className="hero-photo" src={product.photo_url} alt={product.name} />}
    <p className="eyebrow">A TU GUSTO</p><h1 id="product-title">{product.name}</h1>
    <p>{product.description}</p><strong>{money(product.base_price)}</strong>
    {product.food_info && <p className="notice">{product.food_info}</p>}
    {product.dietary_tags.length > 0 && <p>{product.dietary_tags.join(' · ')}</p>}
    {menu.ingredients.some(i => i.product_id === product.id) && <fieldset><legend>Ingredientes</legend>
      {menu.ingredients.filter(i => i.product_id === product.id).map(i => <label className="choice" key={i.id}>
        <span>{i.name} {!i.is_available && '· Agotado'} {!i.is_removable && '· Incluido'}</span>
        {i.is_removable && <span><input type="checkbox" checked={item.removedIds.includes(i.id)} disabled={!i.is_available && item.removedIds.includes(i.id)}
          onChange={e => setItem({ ...item, removedIds: e.target.checked ? [...item.removedIds, i.id] : item.removedIds.filter(id => id !== i.id) })} /> Quitar</span>}
      </label>)}
    </fieldset>}
    {productGroups(menu, product.id).map(group => <fieldset key={group.id}>
      <legend>{group.name}</legend><p className="muted">{group.min_select > 0 ? 'Obligatorio' : 'Opcional'} · Elegí {group.min_select} a {group.max_select}{!group.is_available && ' · Agotado'}</p>
      {menu.options.filter(o => o.group_id === group.id).map(option => <label className="choice" key={option.id}>
        <span>{option.name}<small>{option.is_available ? (option.price_delta === 0 ? 'Sin cargo' : money(option.price_delta)) : 'Agotado'}</small></span>
        <input type="checkbox" checked={item.optionIds.includes(option.id)} disabled={((!option.is_available || !group.is_available) && !item.optionIds.includes(option.id)) || (!item.optionIds.includes(option.id) && group.max_select > 1 && menu.options.filter(o => o.group_id === group.id && item.optionIds.includes(o.id)).length >= group.max_select)} onChange={e => {
          const others = item.optionIds.filter(id => id !== option.id && (group.max_select !== 1 || !menu.options.some(o => o.id === id && o.group_id === group.id)))
          setItem({ ...item, optionIds: e.target.checked ? [...others, option.id] : others })
        }} />
      </label>)}
    </fieldset>)}
    <label className="choice"><span>Cantidad</span><input aria-label="Cantidad" type="number" min="1" max="99" value={item.quantity} onChange={e => setItem({ ...item, quantity: Number(e.target.value) })} /></label>
    <label className="choice"><span>Para compartir con la mesa</span><input type="checkbox" checked={item.isShared} onChange={e => setItem({ ...item, isShared: e.target.checked })} /></label>
    {errors.length > 0 && <ul className="notice">{errors.map(error => <li key={error}>{error}</li>)}</ul>}
    <button className="primary wide" disabled={errors.length > 0} onClick={() => onSave(item)}>{initial ? 'Guardar cambios' : 'Agregar al carrito'} · {money(price(menu, product, item))}</button>
  </section>
}
