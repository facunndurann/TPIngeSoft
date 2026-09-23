import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  DEFAULT_MENU_DESIGN,
  DIETARY_TAGS,
  dietaryTagLabel,
  dietaryTagsText,
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

test('a product card is one link with one photo: its carousel lives in the dish cover', async () => {
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
  // Con dos fotos la tarjeta muestra la primera, decorativa, y ningún control: tocar la
  // foto abre el plato, como el resto de la tarjeta.
  assert.equal((available.match(/<img /g) ?? []).length, 1)
  assert.match(available, /<img src="https:\/\/cdn\/a.jpg" alt="" loading="lazy"/)
  assert.doesNotMatch(html, /<button/)
  // Agotado se lee y se abre igual: el detalle dice por qué no se puede agregar.
  assert.match(soldOut, /<a class="product-card-link" href="\/m\/t\/producto\/sold-out"/)
  assert.match(soldOut, />Agotado</)
  assert.doesNotMatch(html, /is-disabled/)
  // Ningún control interactivo anidado dentro de otro.
  assert.doesNotMatch(html, /<a [^>]*>(?:(?!<\/a>)[\s\S])*<button/)
  assert.doesNotMatch(html, /<button[^>]*>(?:(?!<\/button>)[\s\S])*<(?:button|a) /)

  // La carta no dice cuándo se releyó: a quien la recorre no le sirve, y leerlo en voz
  // alta cada minuto interrumpiría al lector de pantalla.
  assert.doesNotMatch(html, /Actualiza/)

  // Las etiquetas dietarias se leen con su nombre; una que no está en el catálogo, tal cual.
  const tagged = render([card({ id: 'tagged', dietary_tags: ['vegano', 'sin-tacc', 'sin-lactosa'] })])
  assert.match(tagged, /<small>Vegano · Sin TACC · sin-lactosa<\/small>/)

  // Cada categoría es una sección de la carta y cada plato una de su categoría: los
  // niveles bajan de a uno y el h1 de la pantalla es del restaurante, no de la carta.
  assert.doesNotMatch(html, /<h1/)
  assert.match(html, /<h2>[^<]*<\/h2>[\s\S]*<h3 class="section-title">Platos<\/h3>/)
  assert.match(html, /<h4><a class="product-card-link"/)
  // Un solo valor de aria-current en toda la app, el del estándar.
  assert.match(html, /aria-current="page"[^>]*>Todo</)
  assert.doesNotMatch(html, /aria-current="true"/)
})

test('dietary tags have one catalog: the values the panel offers are the ones the menu names', () => {
  assert.deepEqual(DIETARY_TAGS.map((tag) => tag.value), ['vegetariano', 'vegano', 'sin-tacc', 'picante'])
  for (const tag of DIETARY_TAGS) assert.equal(dietaryTagLabel(tag.value), tag.label)
  assert.equal(dietaryTagsText(['sin-tacc', 'picante']), 'Sin TACC · Picante')
  assert.equal(dietaryTagsText([]), '')
})

test('the dish cover carries the carousel: arrows name what comes and dots lead to each photo', async () => {
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { MediaCarousel } = await import('../src/features/MediaCarousel')

  const media = [{ url: 'https://cdn/a.jpg', kind: 'image' as const }, { url: 'https://cdn/b.jpg', kind: 'image' as const }]
  const html = renderToStaticMarkup(createElement(MediaCarousel, { media, alt: 'Plato' }))
  assert.match(html, /<img src="https:\/\/cdn\/a.jpg" alt="Plato"/)
  assert.match(html, /aria-label="Ver foto siguiente"/)
  assert.match(html, /aria-label="Ver foto anterior"/)
  assert.match(html, /<button type="button" class="dot active"[^>]*aria-pressed="true"/)
  assert.match(html, /aria-label="Ver foto 2 de 2"[^>]*aria-pressed="false"/)
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

/** Las reglas de index.css, sin comentarios, con su lista de selectores y sus declaraciones. */
function cssRules() {
  const css = customerCss.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors, body]) => ({
    selectors: selectors.split(',').map((selector) => selector.trim().replace(/\s+/g, ' ')),
    body,
  }))
}

/** Todo lo que index.css le declara a `selector` en las reglas que lo nombran tal cual. */
const declarationsOf = (selector: string) =>
  cssRules().filter((rule) => rule.selectors.includes(selector)).map((rule) => rule.body).join(';')

test('each status color means one thing: neutral panels, info apart from errors, choices apart from the main action', async () => {
  // Lo que agrupa es neutro: el tono de éxito queda para lo que salió bien.
  for (const panel of ['.bill-panel', '.confirmation', '.order-card']) {
    assert.match(declarationsOf(panel), /background: var\(--menu-surface\)/, panel)
    assert.doesNotMatch(declarationsOf(panel), /success|accent/, panel)
  }

  // Informar y avisar un error no se ven igual, y el error no depende solo del tono.
  assert.doesNotMatch(declarationsOf('.notice'), /danger/)
  assert.match(declarationsOf('.error-notice'), /background: var\(--menu-danger-bg\)/)
  assert.match(declarationsOf('.error-notice'), /border-left: 4px solid var\(--menu-danger\)/)

  // Lo elegido nunca comparte regla con la acción principal, ni su relleno de acento.
  const mixed = cssRules().some((rule) =>
    rule.selectors.includes('button.primary') && rule.selectors.some((selector) => /aria-(pressed|current)/.test(selector)))
  assert.equal(mixed, false)
  assert.doesNotMatch(declarationsOf('button[aria-pressed=true]'), /--menu-accent-text/)
  assert.match(declarationsOf('button[aria-pressed=true]'), /background: var\(--menu-surface\)/)

  // Un fallo de red o del servidor llega como error, no como información.
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { ErrorText } = await import('@restaurant-platform/ui')
  const html = renderToStaticMarkup(createElement(ErrorText, { variant: 'menu', error: new Error('Sin red') }))
  assert.match(html, /^<div class="error-notice" role="alert">/)
})

/** Contraste WCAG entre dos colores #rrggbb. */
function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5]
      .map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

test('every design keeps muted text and control borders readable on every ground it sits on', () => {
  for (const id of MENU_DESIGN_IDS) {
    const { tokens } = MENU_DESIGNS[id]
    for (const ground of ['bg', 'surface', 'surfaceMuted'] as const) {
      // Texto apagado: 4.5:1 (WCAG 1.4.3). Borde de lo que se toca o completa: 3:1 (1.4.11).
      assert.ok(contrast(tokens.muted, tokens[ground]) >= 4.5, `${id}: muted sobre ${ground}`)
      assert.ok(contrast(tokens.controlBorder, tokens[ground]) >= 3, `${id}: controlBorder sobre ${ground}`)
    }
  }
  // Inputs y botones usan el borde de control; el tenue queda para lo decorativo.
  assert.match(declarationsOf('input'), /border: 1px solid var\(--menu-control-border\)/)
  assert.match(declarationsOf('button'), /border: 1px solid var\(--menu-control-border\)/)
  assert.match(declarationsOf('.product-card'), /border-color: var\(--menu-border\)/)
})

test('text sizes come from one scale, fields are 16px, and what a finger taps is big enough', () => {
  // Ningún tamaño suelto: todos salen de la escala, y dos botones iguales miden igual en cualquier panel.
  const sizes = [...customerCss.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/font-size:\s*([^;]+);/g)].map(([, value]) => value.trim())
  assert.ok(sizes.length > 0)
  for (const size of sizes) assert.match(size, /^var\(--text-(xs|sm|md|lg|xl|display)\)$/)
  // Con menos de 16px Safari de iOS hace zoom al enfocar un campo.
  assert.match(customerCss, /--text-md: 16px;/)
  assert.match(declarationsOf('input'), /font-size: var\(--text-md\)/)

  // Objetivos táctiles: 44px para los controles del comensal, 24px como mínimo para los puntos.
  assert.match(declarationsOf('.icon-button'), /min-height: 44px;[\s\S]*min-width: 44px/)
  assert.doesNotMatch(customerCss, /opacity: \.7/)
  assert.match(declarationsOf('.table-people summary'), /min-height: 44px/)
  assert.match(declarationsOf('.toast-undo'), /min-height: 44px/)
  assert.match(declarationsOf('.carousel-btn'), /width: 44px;[\s\S]*height: 44px/)
  assert.match(declarationsOf('.carousel-dots .dot'), /width: 24px;[\s\S]*height: 24px/)
  assert.match(declarationsOf('.carousel-dots'), /gap: 4px/)
})
