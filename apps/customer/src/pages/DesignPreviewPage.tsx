import { useParams } from 'react-router'
import { resolveMenuDesign, type Tables } from '@restaurant-platform/shared'
import { MenuBrowse } from '@/features/MenuBrowse'
import { buildMenu, type MenuRows } from '@/features/menu'
import { MenuDesignContext } from '@/features/menu-design'
import { MenuShell } from '@/features/MenuShell'
import { TableHeader } from '@/features/TableHeader'

/**
 * Carta de ejemplo con un diseño, para la vista previa del panel del restaurante
 * (que la muestra en un iframe). Usa los mismos componentes y el mismo CSS que una
 * mesa real, así que la vista previa no puede desfasarse del menú de los comensales.
 */
export function DesignPreviewPage() {
  const { designId } = useParams()
  return (
    <MenuDesignContext value={resolveMenuDesign(designId)}>
      {/* Solo para mirar: los enlaces llevarían a una mesa que no existe. */}
      <div inert>
        <MenuShell>
          <TableHeader restaurantName="Tu restaurante" branchName="Casa central" tableLabel="Mesa 1" />
          <MenuBrowse token="vista-previa" menu={sampleMenu} canEdit />
        </MenuShell>
      </div>
    </MenuDesignContext>
  )
}

/** Foto de ejemplo embebida (sin red): un emoji sobre un fondo de color. */
function samplePhoto(emoji: string, background: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360">`
    + `<rect width="480" height="360" fill="${background}"/>`
    + `<text x="240" y="220" font-size="150" text-anchor="middle">${emoji}</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function category(id: string, name: string, sortOrder: number): Tables<'menu_categories'> {
  return { id, name, sort_order: sortOrder, restaurant_id: 'vista-previa', is_active: true, created_at: '' }
}

function dish(
  id: string,
  categoryId: string,
  name: string,
  description: string,
  basePrice: number,
  photo: string,
  dietaryTags: string[] = [],
): MenuRows['products'][number] {
  return {
    id,
    category_id: categoryId,
    name,
    description,
    base_price: basePrice,
    dietary_tags: dietaryTags,
    media_urls: [photo],
    restaurant_id: 'vista-previa',
    is_available: true,
    food_info: null,
    sort_order: 0,
    created_at: '',
    product_ingredients: [],
    product_modifier_groups: [],
  }
}

const sampleMenu = buildMenu({
  categories: [category('principales', 'Principales', 0), category('postres', 'Postres', 1)],
  products: [
    dish('hamburguesa', 'principales', 'Hamburguesa completa', 'Carne, queso, lechuga, tomate y papas.', 8500, samplePhoto('🍔', '#f4d8b5')),
    dish('ensalada', 'principales', 'Ensalada César', 'Pollo, crutones, parmesano y aderezo.', 6200, samplePhoto('🥗', '#d5e8c8'), ['sin-tacc']),
    dish('pasta', 'principales', 'Sorrentinos', 'Rellenos de jamón y queso con salsa rosa.', 7400, samplePhoto('🍝', '#f2d3c9')),
    dish('flan', 'postres', 'Flan casero', 'Con dulce de leche y crema.', 3900, samplePhoto('🍮', '#f5e6c4'), ['vegetariano']),
  ],
  groups: [],
})
