import { createContext, useContext } from 'react'
import { DEFAULT_MENU_DESIGN, resolveMenuDesign, type MenuDesign } from '@restaurant-platform/shared'

/**
 * Diseño de la carta activo. Fuera de una mesa (landing, carga, errores) vale
 * el diseño por defecto; TableApp lo reemplaza por el del restaurante.
 */
export const MenuDesignContext = createContext<MenuDesign>(resolveMenuDesign(DEFAULT_MENU_DESIGN))

export function useMenuDesign(): MenuDesign {
  return useContext(MenuDesignContext)
}
