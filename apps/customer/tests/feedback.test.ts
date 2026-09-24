import { test } from 'vitest'
import assert from 'node:assert/strict'
import { AppError } from '@restaurant-platform/shared'

// ErrorText vive en packages/ui y lo usan las tres apps; se prueba desde el
// comensal, que es de donde salió y el único que monta la variante `menu`.
test('an error only offers to retry when repeating can work', async () => {
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { ErrorText } = await import('@restaurant-platform/ui')
  const noop = () => {}
  const render = (error: unknown, recover?: { label: string; onAction: () => void }) =>
    renderToStaticMarkup(createElement(ErrorText, { variant: 'menu', error, retry: noop, recover }))

  // Red caída y errores sin código se asumen reintentables.
  assert.match(render(new AppError('CONNECTION_ERROR')), /Reintentar<\/button>/)
  assert.match(render(new Error('Algo raro pasó')), /Algo raro pasó[\s\S]*Reintentar/)
  // Un mensaje ya resuelto es su propio error; un throw mudo cae al fallback.
  assert.match(render('ni un Error'), /ni un Error[\s\S]*Reintentar/)
  assert.match(render(new Error('')), /No pudimos conectar/)
  assert.equal(render(null), '')

  // Un rechazo definitivo no invita a chocar de nuevo: ofrece otra salida.
  const dead = new AppError('TABLE_UNAVAILABLE')
  assert.doesNotMatch(render(dead), /Reintentar/)
  assert.match(render(dead), /Recargar la página<\/button>/)
  assert.match(render(dead, { label: 'Ir al inicio', onAction: noop }), /Ir al inicio<\/button>/)
  // La salida propia es solo para lo definitivo: lo reintentable se sigue reintentando.
  assert.match(render(new AppError('CONNECTION_ERROR'), { label: 'Ir al inicio', onAction: noop }), /Reintentar<\/button>/)

  assert.match(render(dead), /role="alert"/)
})

test('a panel that cannot retry stays a message, and never grows a dead button', async () => {
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { ErrorText } = await import('@restaurant-platform/ui')
  const fallback = 'No pudimos cargar las comandas.'

  // Admin y POS casi siempre solo informan: sin `retry` el aviso no crece botones.
  const plain = renderToStaticMarkup(
    createElement(ErrorText, { error: new Error('Falló la consulta'), fallback }),
  )
  assert.match(plain, /role="alert"/)
  assert.match(plain, /Falló la consulta/)
  assert.doesNotMatch(plain, /<button/)

  // El fallback solo aparece cuando el error no trae mensaje del catálogo.
  const mute = renderToStaticMarkup(createElement(ErrorText, { error: { nada: true }, fallback }))
  assert.match(mute, /No pudimos cargar las comandas\./)

  // Y cuando el panel sí ofrece repetir, el catálogo decide igual que en la carta.
  const retry = (error: unknown) =>
    renderToStaticMarkup(createElement(ErrorText, { error, retry: () => {}, fallback }))
  assert.match(retry(new AppError('POS_UNAVAILABLE')), /Reintentar<\/button>/)
  assert.doesNotMatch(retry(new AppError('INVALID_TRANSITION')), /Reintentar/)
})

test('Toast keeps its live region mounted and schedules the fade within its own duration', async () => {
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { Toast } = await import('../src/components/Toast')
  const { toastDuration } = await import('../src/features/announcements')
  const noop = () => {}
  const timingOf = (html: string) =>
    [/animation-duration:(\d+)ms/, /animation-delay:0ms, (\d+)ms/].map((pattern) => Number(html.match(pattern)?.[1]))

  assert.equal(renderToStaticMarkup(createElement(Toast, { onDismiss: noop })), '<div class="toast-container" role="status"></div>')

  const plain = renderToStaticMarkup(createElement(Toast, { announcement: { id: 1, message: 'Pedido enviado' }, onDismiss: noop }))
  assert.match(plain, /role="status"><div class="toast"/)
  assert.doesNotMatch(plain, /Deshacer/)
  const [duration, delay] = timingOf(plain)
  // El dueño limpia el mensaje justo cuando termina la salida animada.
  assert.equal(delay + duration, toastDuration(false))

  // Un aviso con deshacer dura más: el botón tiene que ser alcanzable.
  const undoable = renderToStaticMarkup(createElement(Toast, { announcement: { id: 2, message: 'Se quitó', undo: noop }, onDismiss: noop }))
  assert.match(undoable, /class="toast-undo"[^>]*>Deshacer</)
  const [undoDuration, undoDelay] = timingOf(undoable)
  assert.equal(undoDelay + undoDuration, toastDuration(true))
  assert.ok(toastDuration(true) > toastDuration(false))
})
