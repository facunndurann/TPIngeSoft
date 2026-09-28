// @vitest-environment happy-dom
import { afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createSound, type Sound } from './features/pos/chime'
import { SoundControl } from './features/pos/SoundControl'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

/**
 * Un AudioContext falso: arranca como lo deja el navegador según haya habido un
 * gesto, y `resume()` lo pone a sonar. Cuenta las notas agendadas.
 */
class FakeAudio extends EventTarget {
  state: AudioContextState
  currentTime = 0
  destination = {}
  notes = 0
  constructor(state: AudioContextState) {
    super()
    this.state = state
  }
  resume = vi.fn(async () => {
    this.state = 'running'
    this.dispatchEvent(new Event('statechange'))
  })
  createOscillator() {
    this.notes += 1
    return { frequency: { value: 0 }, connect: (node: unknown) => node, start() {}, stop() {} }
  }
  createGain() {
    return {
      gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect: (node: unknown) => node,
    }
  }
}

/** Un aviso con su audio falso, su storage y el documento donde se escuchan los gestos. */
function tablet(state: AudioContextState, storage = new Map<string, string>()) {
  const audio = new FakeAudio(state)
  const gestures = new EventTarget()
  const sound = createSound({
    createAudio: () => audio as unknown as AudioContext,
    storage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => void storage.set(key, value) },
    gestures,
  })
  return { sound, audio, gestures, storage }
}

/** Deja correr el `resume()` y el aviso de cambio de estado. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)))

test('a tablet nobody touched says the sound is blocked, and the first touch anywhere turns it on', async () => {
  const { sound, audio, gestures } = tablet('suspended')
  sound.subscribe(() => {})
  assert.equal(sound.status(), 'blocked')

  // Bloqueado no agenda notas: sonarían todas juntas y tarde, con el primer toque.
  sound.play()
  assert.equal(audio.notes, 0)

  gestures.dispatchEvent(new Event('pointerup'))
  await settle()
  assert.equal(audio.resume.mock.calls.length, 1)
  assert.equal(sound.status(), 'on')

  sound.play()
  assert.equal(audio.notes, 2)
})

test('muting silences the chime and the tablet remembers it after a reload', () => {
  const { sound, audio, storage } = tablet('running')
  sound.subscribe(() => {})
  sound.setMuted(true)

  assert.equal(sound.status(), 'muted')
  sound.play()
  assert.equal(audio.notes, 0)

  const reloaded = tablet('running', storage).sound
  reloaded.subscribe(() => {})
  assert.equal(reloaded.status(), 'muted')
})

test('without Web Audio there is nothing to control, and nothing breaks', () => {
  const sound = createSound({ createAudio: () => undefined })
  sound.subscribe(() => {})
  assert.equal(sound.status(), 'unavailable')
  sound.play()
})

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

async function renderControl(sound: Sound) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  await act(async () => root.render(<SoundControl sound={sound} />))
  return container
}

const buttonNamed = (container: HTMLElement, name: RegExp) =>
  [...container.querySelectorAll('button')].find((button) =>
    name.test(button.getAttribute('aria-label') ?? button.textContent ?? ''),
  )

test('the blocked prompt turns the sound on and plays it once, so the kitchen knows it works', async () => {
  const { sound, audio } = tablet('suspended')
  const container = await renderControl(sound)

  const prompt = buttonNamed(container, /Sonido desactivado · tocá para activar/)!
  await act(async () => prompt.click())
  await settle()

  assert.equal(audio.notes, 2)
  assert.equal(buttonNamed(container, /tocá para activar/), undefined)
  assert.equal(buttonNamed(container, /Sonido de comandas nuevas/)!.getAttribute('aria-pressed'), 'true')
})

test('the mute toggle keeps its name and says its state with aria-pressed', async () => {
  const { sound } = tablet('running')
  const container = await renderControl(sound)
  const toggle = () => buttonNamed(container, /Sonido de comandas nuevas/)!

  assert.equal(toggle().getAttribute('aria-pressed'), 'true')
  await act(async () => toggle().click())
  assert.equal(toggle().getAttribute('aria-pressed'), 'false')
  assert.equal(sound.status(), 'muted')
})
