export type TableSection = 'menu' | 'cart' | 'orders'

export function tableRoot(token: string) {
  return `/m/${encodeURIComponent(token)}`
}

export function menuSearchParams(category: string, query: string) {
  const params = new URLSearchParams()
  if (category && category !== 'all') params.set('categoria', category)
  if (query) params.set('q', query)
  const value = params.toString()
  return value ? `?${value}` : ''
}

export function menuPath(token: string, category = 'all', query = '') {
  return `${tableRoot(token)}${menuSearchParams(category, query)}`
}

export function productPath(token: string, productId: string, search = '') {
  return `${tableRoot(token)}/producto/${encodeURIComponent(productId)}${search}`
}

export function cartPath(token: string) {
  return `${tableRoot(token)}/carrito`
}

export function cartReviewPath(token: string) {
  return `${tableRoot(token)}/carrito/revisar`
}

export function cartItemPath(token: string, itemId: string) {
  return `${tableRoot(token)}/carrito/${encodeURIComponent(itemId)}`
}

export function ordersPath(token: string) {
  return `${tableRoot(token)}/pedidos`
}

export function parseMenuFilters(searchParams: URLSearchParams) {
  return {
    category: searchParams.get('categoria') || 'all',
    search: searchParams.get('q') ?? '',
  }
}

export function tableSection(pathname: string): TableSection {
  if (pathname.includes('/carrito')) return 'cart'
  if (pathname.includes('/pedidos')) return 'orders'
  return 'menu'
}

export function isMenuIndex(pathname: string) {
  return tableSection(pathname) === 'menu' && !pathname.includes('/producto/')
}
