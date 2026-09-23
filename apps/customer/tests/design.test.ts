import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  DEFAULT_MENU_DESIGN,
  MENU_DESIGN_IDS,
  MENU_DESIGNS,
  menuDesignCssVarName,
  menuDesignCssVars,
  resolveMenuDesign,
} from '@restaurant-platform/shared'
import { buildMenu } from '../src/features/menu'
import type { MenuRows } from '../src/features/menu'
import customerCss from '../src/index.css?raw'

test('resolveMenuDesign returns catalog entries and falls back to oliva', () => {
  assert.equal(resolveMenuDesign('oliva').id, DEFAULT_MENU_DESIGN)
  assert.equal(resolveMenuDesign('oliva').layout, 'classic')
  assert.equal(resolveMenuDesign('brasas').layout, 'kiosk')
  assert.equal(resolveMenuDesign('linterna').layout, 'editorial')
  assert.equal(resolveMenuDesign('unknown').id, DEFAULT_MENU_DESIGN)
  assert.equal(resolveMenuDesign(null).id, DEFAULT_MENU_DESIGN)
  assert.equal(resolveMenuDesign(undefined).id, DEFAULT_MENU_DESIGN)
  assert.deepEqual(MENU_DESIGN_IDS, ['oliva', 'brasas', 'linterna'])
  for (const id of MENU_DESIGN_IDS) assert.equal(MENU_DESIGNS[id].id, id)
  assert.equal(menuDesignCssVars(resolveMenuDesign('brasas').tokens)['--menu-accent'], resolveMenuDesign('brasas').tokens.accent)
})

test('design tokens define exactly the CSS variables the customer stylesheet uses', () => {
  assert.equal(menuDesignCssVarName('bg'), '--menu-bg')
  assert.equal(menuDesignCssVarName('surfaceMuted'), '--menu-surface-muted')
  assert.equal(menuDesignCssVarName('radiusPill'), '--menu-radius-pill')

  // index.css ya no declara valores por defecto: una variable sin token dejaría un estilo roto.
  const used = [...new Set(customerCss.match(/--menu-[a-z-]+/g))].sort()
  for (const id of MENU_DESIGN_IDS) {
    assert.deepEqual(Object.keys(menuDesignCssVars(MENU_DESIGNS[id].tokens)).sort(), used, `Tokens of ${id}`)
  }
})

test('MenuShell paints catalog tokens, layout and copy for each design', async () => {
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { MenuShell } = await import('../src/features/MenuShell')
  const { MenuDesignContext } = await import('../src/features/menu-design')
  const { TableHeader } = await import('../src/features/TableHeader')

  for (const id of ['oliva', 'brasas', 'linterna'] as const) {
    const design = resolveMenuDesign(id)
    // TableHeader no recibe el texto por props: tiene que leerlo del contexto.
    const html = renderToStaticMarkup(
      createElement(
        MenuDesignContext,
        { value: design },
        createElement(
          MenuShell,
          null,
          createElement(TableHeader, {
            restaurantName: 'Demo',
            branchName: 'Casa',
            tableLabel: 'Mesa 1',
          }),
        ),
      ),
    )
    assert.match(html, new RegExp(`data-design="${id}"`))
    assert.match(html, new RegExp(`data-layout="${design.layout}"`))
    assert.match(html, new RegExp(design.tokens.bg.replace('#', '[#]')))
    assert.match(html, new RegExp(design.copy.welcome))
  }
})

test('the table header welcomes on the menu and is only context elsewhere', async () => {
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { TableHeader } = await import('../src/features/TableHeader')
  const props = { restaurantName: 'La Parrilla', branchName: 'Centro', tableLabel: 'Mesa 4' }

  const welcome = renderToStaticMarkup(createElement(TableHeader, props))
  assert.match(welcome, /class="eyebrow"/)
  assert.match(welcome, /<h1>La Parrilla<\/h1>/)

  // Compacto: restaurante + sucursal en bloque, mesa a la derecha, un solo h1.
  const compact = renderToStaticMarkup(createElement(TableHeader, { ...props, compact: true }))
  assert.doesNotMatch(compact, /class="eyebrow"/)
  assert.match(compact, /<header class="compact">/)
  assert.match(compact, /class="compact-copy"/)
  assert.match(compact, /<h1>La Parrilla<\/h1>/)
  assert.match(compact, /Centro/)
  assert.match(compact, /Mesa 4/)
  assert.equal((compact.match(/<h1/g) ?? []).length, 1)
})

test('product cards keep the link and the carousel controls as siblings', async () => {
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { MemoryRouter } = await import('react-router')
  const { MenuBrowse } = await import('../src/features/MenuBrowse')

  const card = (overrides: object) => ({
    id: 'x', category_id: 'c', name: 'Plato', description: null, base_price: 10,
    dietary_tags: [], is_available: true, media_urls: ['https://cdn/a.jpg', 'https://cdn/b.jpg'],
    product_ingredients: [], product_modifier_groups: [], ...overrides,
  })
  const render = (products: object[]) => renderToStaticMarkup(createElement(
    MemoryRouter, null,
    createElement(MenuBrowse, {
      token: 't',
      menu: buildMenu({ categories: [{ id: 'c', name: 'Platos' }], products, groups: [] } as unknown as MenuRows),
    }),
  ))

  const html = render([card({ id: 'many' }), card({ id: 'sold-out', is_available: false })])
  const cards = html.match(/<article class="product-card">[\s\S]*?<\/article>/g) ?? []
  assert.equal(cards.length, 2)

  const [available, soldOut] = cards
  assert.match(available, /<a class="product-card-link" href="\/m\/t\/producto\/many"[^>]*>Plato<\/a>/)
  // Las flechas nombran lo que van a mostrar y los puntos llevan a cada medio.
  assert.match(available, /aria-label="Ver foto siguiente"/)
  assert.match(available, /aria-label="Ver foto anterior"/)
  assert.match(available, /<button type="button" class="dot active"[^>]*aria-pressed="true"/)
  assert.match(available, /aria-label="Ver foto 2 de 2"[^>]*aria-pressed="false"/)
  // Agotado se lee y se abre igual: el detalle dice por qué no se puede agregar.
  assert.match(soldOut, /<a class="product-card-link" href="\/m\/t\/producto\/sold-out"/)
  assert.match(soldOut, />Agotado</)
  assert.doesNotMatch(html, /is-disabled/)
  // Ningún control interactivo anidado dentro de otro.
  assert.doesNotMatch(html, /<a [^>]*>(?:(?!<\/a>)[\s\S])*<button/)
  assert.doesNotMatch(html, /<button[^>]*>(?:(?!<\/button>)[\s\S])*<(?:button|a) /)

  // Cada categoría es una sección de la carta y cada plato una de su categoría: los
  // niveles bajan de a uno y el h1 de la pantalla es del restaurante, no de la carta.
  assert.doesNotMatch(html, /<h1/)
  assert.match(html, /<h2>[^<]*<\/h2>[\s\S]*<h3 class="section-title">Platos<\/h3>/)
  assert.match(html, /<h4><a class="product-card-link"/)
  // Un solo valor de aria-current en toda la app, el del estándar.
  assert.match(html, /aria-current="page"[^>]*>Todo</)
  assert.doesNotMatch(html, /aria-current="true"/)
})

test('design preview renders the real menu with each layout, offline and non-interactive', async () => {
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { MemoryRouter, Route, Routes } = await import('react-router')
  const { DesignPreviewPage } = await import('../src/pages/DesignPreviewPage')

  const render = (path: string) => renderToStaticMarkup(createElement(
    MemoryRouter, { initialEntries: [path] },
    createElement(Routes, null, createElement(Route, { path: '/vista-previa/:designId', element: createElement(DesignPreviewPage) })),
  ))

  for (const design of Object.values(MENU_DESIGNS)) {
    const html = render(`/vista-previa/${design.id}`)
    assert.match(html, new RegExp(`data-layout="${design.layout}"`))
    assert.match(html, new RegExp(design.copy.menuTitle.replace('?', '\\?')))
    assert.equal((html.match(/<article class="product-card"/g) ?? []).length, 4)
  }
  const fallback = render('/vista-previa/no-existe')
  assert.match(fallback, new RegExp(`data-design="${DEFAULT_MENU_DESIGN}"`))
  assert.match(fallback, /^<div inert="">/, 'The preview is for looking only')
  assert.doesNotMatch(fallback, /src="https?:/, 'Sample photos are embedded, not fetched')
})
