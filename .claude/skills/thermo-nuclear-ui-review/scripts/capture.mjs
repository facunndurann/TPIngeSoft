#!/usr/bin/env node
// Captura una URL con un viewport de celular de verdad, manejando Chrome por el protocolo de DevTools y sin dependencias.
// Hace falta porque `--window-size` de Chrome headless en Mac no baja de 500px de ancho: la página se dibuja a 500px y la imagen sale recortada, como si hubiera scroll horizontal.
//
// uso: node capture.mjs <url> <salida.png> [ancho=375] [alto=812] [--full]
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
const fullPage = args.includes('--full')
const [url, out, width = '375', height = '812'] = args.filter((arg) => arg !== '--full')
if (!url || !out) {
  console.error('uso: node capture.mjs <url> <salida.png> [ancho=375] [alto=812] [--full]')
  process.exit(1)
}
const viewport = { width: Number(width), height: Number(height) }
const mobile = viewport.width < 768

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const profile = mkdtempSync(path.join(tmpdir(), 'capture-'))
const chrome = spawn(CHROME, ['--headless', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--hide-scrollbars', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
const exited = new Promise((resolve) => chrome.once('exit', resolve))

try {
  const browserUrl = await new Promise((resolve, reject) => {
    let log = ''
    chrome.stderr.on('data', (chunk) => {
      log += chunk
      const match = log.match(/DevTools listening on (ws:\/\/\S+)/)
      if (match) resolve(match[1])
    })
    chrome.on('exit', () => reject(new Error(`Chrome se cerró antes de abrir DevTools:\n${log}`)))
  })
  const { host } = new URL(browserUrl)
  const targets = await (await fetch(`http://${host}/json/list`)).json()
  const page = targets.find((target) => target.type === 'page')
  const cdp = await connect(page.webSocketDebuggerUrl)

  await cdp.send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 2, mobile })
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: mobile })
  await cdp.send('Page.enable')
  await cdp.send('Page.setLifecycleEventsEnabled', { enabled: true })
  // Realtime deja un websocket abierto y networkIdle puede no llegar nunca; el tope evita colgarse.
  const settled = Promise.race([cdp.once((m) => m.method === 'Page.lifecycleEvent' && m.params.name === 'networkIdle'), delay(10_000)])
  await cdp.send('Page.navigate', { url })
  await settled
  await delay(500)

  const { result } = await cdp.send('Runtime.evaluate', {
    expression: 'JSON.stringify({ scrollWidth: document.documentElement.scrollWidth, innerWidth })',
    returnByValue: true,
  })
  const { scrollWidth, innerWidth } = JSON.parse(result.value)
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: fullPage })
  writeFileSync(out, Buffer.from(data, 'base64'))

  const overflow = scrollWidth > innerWidth ? `  ⚠ scroll horizontal: el contenido mide ${scrollWidth}px` : ''
  console.log(`${out} (${innerWidth}×${viewport.height}${fullPage ? ', página completa' : ''})${overflow}`)
} finally {
  chrome.kill()
  await exited
  rmSync(profile, { recursive: true, force: true, maxRetries: 3 })
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  const pending = new Map()
  const listeners = new Set()
  let nextId = 0
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data)
    const request = pending.get(message.id)
    if (!request) return listeners.forEach((listener) => listener(message))
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result)
  }
  const client = {
    send: (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    }),
    once: (matches) => new Promise((resolve) => {
      const listener = (message) => {
        if (!matches(message)) return
        listeners.delete(listener)
        resolve(message)
      }
      listeners.add(listener)
    }),
  }
  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve(client)
    ws.onerror = () => reject(new Error(`No se pudo conectar a ${wsUrl}`))
  })
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
