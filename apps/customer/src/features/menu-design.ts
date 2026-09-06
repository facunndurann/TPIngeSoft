import { createContext, useContext, type CSSProperties } from 'react'
import {
  DEFAULT_MENU_DESIGN,
  menuDesignCssVars,
  resolveMenuDesign,
  type MenuDesign,
} from '@restaurant-platform/shared'

export const MenuDesignContext = createContext<MenuDesign>(resolveMenuDesign(DEFAULT_MENU_DESIGN))

export function useMenuDesign(): MenuDesign {
  return useContext(MenuDesignContext)
}

export function menuShellStyle(design: MenuDesign): CSSProperties {
  return menuDesignCssVars(design.tokens) as CSSProperties
}
