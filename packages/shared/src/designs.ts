export const MENU_DESIGN_LAYOUTS = ['classic', 'kiosk', 'editorial'] as const
export type MenuDesignLayout = (typeof MENU_DESIGN_LAYOUTS)[number]

export const DEFAULT_MENU_DESIGN = 'oliva'

export type MenuDesignTokens = {
  bg: string
  text: string
  accent: string
  accentHover: string
  accentText: string
  muted: string
  surface: string
  surfaceMuted: string
  border: string
  heading: string
  eyebrow: string
  badgeBg: string
  badgeText: string
  noticeBg: string
  noticeText: string
  successBg: string
  successText: string
  danger: string
  dangerBg: string
  warningBg: string
  warningText: string
  unavailable: string
  focus: string
  billMuted: string
  font: string
  fontDisplay: string
  radius: string
  radiusPill: string
  shadow: string
}

export type MenuDesignCopy = {
  welcome: string
  menu: string
  menuTitle: string
  product: string
  footer: string
}

export type MenuDesign = {
  id: string
  name: string
  description: string
  layout: MenuDesignLayout
  tokens: MenuDesignTokens
  copy: MenuDesignCopy
}

const sans = 'Inter, ui-sans-serif, system-ui, sans-serif'
const displayKiosk = 'Oswald, Inter, ui-sans-serif, system-ui, sans-serif'
const displayEditorial = 'Fraunces, "Times New Roman", serif'

const oliva: MenuDesign = {
  id: 'oliva',
  name: 'Oliva',
  description: 'Carta clara en papel y verde sage. Simple y rápida de leer.',
  layout: 'classic',
  tokens: {
    bg: '#faf9f5',
    text: '#292c26',
    accent: '#35563b',
    accentHover: '#456747',
    accentText: '#ffffff',
    muted: '#656b60',
    surface: '#ffffff',
    surfaceMuted: '#f0f1e9',
    border: '#dcded4',
    heading: '#292c26',
    eyebrow: '#597151',
    badgeBg: '#e9eddf',
    badgeText: '#405539',
    noticeBg: '#fff0dc',
    noticeText: '#8b5b21',
    successBg: '#e9efdf',
    successText: '#35563b',
    danger: '#873e32',
    dangerBg: '#f5e3de',
    warningBg: '#fdf0c2',
    warningText: '#755c12',
    unavailable: '#904828',
    focus: '#b16e30',
    billMuted: '#59634e',
    font: sans,
    fontDisplay: sans,
    radius: '12px',
    radiusPill: '30px',
    shadow: '0 5px 24px #19301930',
  },
  copy: {
    welcome: 'BIENVENIDOS A LA MESA',
    menu: 'HECHO PARA DISFRUTAR',
    menuTitle: '¿Qué te gustaría pedir?',
    product: 'A TU GUSTO',
    footer: 'Disfrutá a tu ritmo · Pedí desde tu mesa',
  },
}

const brasas: MenuDesign = {
  id: 'brasas',
  name: 'Brasas',
  description: 'Kiosco oscuro con ámbar. Fotos grandes y tipografía potente.',
  layout: 'kiosk',
  tokens: {
    bg: '#14110e',
    text: '#f4ece3',
    accent: '#e08a2b',
    accentHover: '#f0a04a',
    accentText: '#1a140e',
    muted: '#b5a99a',
    surface: '#1f1a16',
    surfaceMuted: '#2a231c',
    border: '#3d342c',
    heading: '#f7efe6',
    eyebrow: '#e08a2b',
    badgeBg: '#3d2a14',
    badgeText: '#f0c27a',
    noticeBg: '#3a2a12',
    noticeText: '#f0c27a',
    successBg: '#24301f',
    successText: '#b7d59a',
    danger: '#e07a5f',
    dangerBg: '#3a1f1a',
    warningBg: '#3a2e12',
    warningText: '#e8c56b',
    unavailable: '#e08a6a',
    focus: '#e08a2b',
    billMuted: '#b5a99a',
    font: sans,
    fontDisplay: displayKiosk,
    radius: '8px',
    radiusPill: '8px',
    shadow: '0 8px 28px #00000070',
  },
  copy: {
    welcome: 'MESA LISTA',
    menu: 'DEL FUEGO A LA MESA',
    menuTitle: '¿Qué se pide?',
    product: 'ARMÁ LA TUYA',
    footer: 'Pedí, compartí, repetí',
  },
}

const linterna: MenuDesign = {
  id: 'linterna',
  name: 'Linterna',
  description: 'Carta editorial en crema y burgundy, con más aire y serifas.',
  layout: 'editorial',
  tokens: {
    bg: '#f6f0e6',
    text: '#3a2a24',
    accent: '#7a2e32',
    accentHover: '#5e2226',
    accentText: '#f8f3ea',
    muted: '#7a6a60',
    surface: '#fffaf3',
    surfaceMuted: '#efe6d8',
    border: '#e0d4c4',
    heading: '#3a221c',
    eyebrow: '#7a2e32',
    badgeBg: '#efe0d4',
    badgeText: '#7a2e32',
    noticeBg: '#f3e6d2',
    noticeText: '#6a4a28',
    successBg: '#e8efe0',
    successText: '#3d5a38',
    danger: '#9a3a32',
    dangerBg: '#f5e3de',
    warningBg: '#f6ead0',
    warningText: '#6a5420',
    unavailable: '#9a3a32',
    focus: '#7a2e32',
    billMuted: '#6e5e54',
    font: sans,
    fontDisplay: displayEditorial,
    radius: '4px',
    radiusPill: '999px',
    shadow: '0 4px 20px #3a221c18',
  },
  copy: {
    welcome: 'LA MESA ESTÁ SERVIDA',
    menu: 'LA CARTA DE HOY',
    menuTitle: '¿Qué te apetece?',
    product: 'A MEDIDA',
    footer: 'Con calma, como en casa',
  },
}

export const MENU_DESIGNS: readonly MenuDesign[] = [oliva, brasas, linterna]

const designsById = new Map(MENU_DESIGNS.map((design) => [design.id, design]))

export function resolveMenuDesign(id: string | null | undefined): MenuDesign {
  return (id && designsById.get(id)) || designsById.get(DEFAULT_MENU_DESIGN)!
}

/** Variables CSS de un diseño, listas para la prop `style` de React. */
export type MenuDesignCssVars = Record<`--menu-${string}`, string>

const tokenVarNames: Record<keyof MenuDesignTokens, keyof MenuDesignCssVars> = {
  bg: '--menu-bg',
  text: '--menu-text',
  accent: '--menu-accent',
  accentHover: '--menu-accent-hover',
  accentText: '--menu-accent-text',
  muted: '--menu-muted',
  surface: '--menu-surface',
  surfaceMuted: '--menu-surface-muted',
  border: '--menu-border',
  heading: '--menu-heading',
  eyebrow: '--menu-eyebrow',
  badgeBg: '--menu-badge-bg',
  badgeText: '--menu-badge-text',
  noticeBg: '--menu-notice-bg',
  noticeText: '--menu-notice-text',
  successBg: '--menu-success-bg',
  successText: '--menu-success-text',
  danger: '--menu-danger',
  dangerBg: '--menu-danger-bg',
  warningBg: '--menu-warning-bg',
  warningText: '--menu-warning-text',
  unavailable: '--menu-unavailable',
  focus: '--menu-focus',
  billMuted: '--menu-bill-muted',
  font: '--menu-font',
  fontDisplay: '--menu-font-display',
  radius: '--menu-radius',
  radiusPill: '--menu-radius-pill',
  shadow: '--menu-shadow',
}

export function menuDesignCssVars(tokens: MenuDesignTokens): MenuDesignCssVars {
  const vars: MenuDesignCssVars = {}
  for (const key of Object.keys(tokenVarNames) as (keyof MenuDesignTokens)[]) {
    vars[tokenVarNames[key]] = tokens[key]
  }
  return vars
}
