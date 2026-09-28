/**
 * El aviso sonoro de comandas nuevas y su estado, para que la tablet diga si va a
 * sonar. Tras un F5 sin que nadie toque la pantalla, el navegador bloquea el
 * audio (autoplay): antes eso pasaba en silencio, y la cocina no se enteraba.
 *
 * - `on`: suena.
 * - `blocked`: el navegador espera un toque. Cualquier toque en la página lo
 *   destraba; la pantalla lo pide con un aviso.
 * - `muted`: lo silenció quien usa la tablet. Se recuerda en esta tablet.
 * - `unavailable`: el navegador no tiene Web Audio. El contador de la pestaña avisa igual.
 */
export type SoundStatus = 'on' | 'blocked' | 'muted' | 'unavailable'

/** Lo mínimo de un AudioContext que usa el aviso: así las pruebas le pasan uno falso. */
type Audio = Pick<
  AudioContext,
  'state' | 'currentTime' | 'destination' | 'resume' | 'createOscillator' | 'createGain' | 'addEventListener'
>

type SoundOptions = {
  /** El AudioContext, o `undefined` si el navegador no tiene Web Audio. */
  createAudio: () => Audio | undefined
  /** Dónde se guarda el silencio de esta tablet; puede no haber (modo privado). */
  storage?: Pick<Storage, 'getItem' | 'setItem'>
  /** Dónde se escucha el primer gesto que destraba el audio: el documento. */
  gestures?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>
}

const MUTED_KEY = 'pos-sound:muted'

/**
 * Eventos que cuentan como gesto del usuario para el navegador: con cualquiera, el
 * audio se puede reanudar. `pointerup` y `touchend` cubren el dedo; `keydown`, el teclado.
 */
const GESTURES = ['pointerup', 'touchend', 'keydown'] as const

export function createSound({ createAudio, storage, gestures }: SoundOptions) {
  let audio: Audio | undefined
  let unsupported = false
  let muted = readMuted()
  const listeners = new Set<() => void>()

  function readMuted() {
    try {
      return storage?.getItem(MUTED_KEY) === '1'
    } catch {
      return false
    }
  }

  const notify = () => listeners.forEach((listener) => listener())

  // Reanudar desde un gesto: `resume()` fuera de uno lo rechaza el navegador.
  const unlock = () => {
    audio?.resume().catch(() => {})
  }

  function stopListening() {
    for (const type of GESTURES) gestures?.removeEventListener(type, unlock, true)
  }

  /** El AudioContext, creado una sola vez; `undefined` sin Web Audio. */
  function context(): Audio | undefined {
    if (audio || unsupported) return audio
    try {
      audio = createAudio()
    } catch {
      audio = undefined
    }
    if (!audio) {
      unsupported = true
      return undefined
    }
    audio.addEventListener('statechange', () => {
      if (audio?.state === 'running') stopListening()
      notify()
    })
    // Creado sin un gesto previo, arranca suspendido: el primer toque en cualquier
    // lado de la página lo destraba, no solo el botón del aviso.
    if (audio.state !== 'running') {
      for (const type of GESTURES) gestures?.addEventListener(type, unlock, true)
    }
    return audio
  }

  /** Dos notas cortas, generadas con Web Audio: no hay archivo que descargar. */
  function chime(target: Audio) {
    const start = target.currentTime
    for (const [offset, frequency] of [[0, 880], [0.16, 1320]] as const) {
      const tone = target.createOscillator()
      const volume = target.createGain()
      tone.frequency.value = frequency
      // Sube y baja enseguida: un golpe suave, sin el clic de cortar la onda en seco.
      volume.gain.setValueAtTime(0.0001, start + offset)
      volume.gain.exponentialRampToValueAtTime(0.2, start + offset + 0.02)
      volume.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.3)
      tone.connect(volume).connect(target.destination)
      tone.start(start + offset)
      tone.stop(start + offset + 0.32)
    }
  }

  function setMuted(value: boolean) {
    muted = value
    try {
      storage?.setItem(MUTED_KEY, value ? '1' : '0')
    } catch {
      /* modo privado o storage bloqueado: vale hasta recargar */
    }
    notify()
  }

  return {
    /** El estado de ahora, para `useSyncExternalStore`: sin efectos, no crea el audio. */
    status(): SoundStatus {
      if (muted) return 'muted'
      // Sin Web Audio, o antes de la primera suscripción (todavía no se sabe): nada que mostrar.
      if (!audio) return 'unavailable'
      return audio.state === 'running' ? 'on' : 'blocked'
    },

    /** Suscribirse crea el audio, y avisa: desde ahí el estado es el real. */
    subscribe(listener: () => void) {
      listeners.add(listener)
      context()
      notify()
      return () => {
        listeners.delete(listener)
      }
    },

    /**
     * Suena si puede. Con el audio bloqueado no agenda nada: esas notas sonarían
     * juntas, tarde, cuando alguien tocara la pantalla por otra cosa.
     */
    play() {
      if (muted) return
      const target = context()
      if (target?.state === 'running') chime(target)
    },

    /**
     * El toque del aviso «tocá para activar»: quita el silencio, destraba el audio
     * y suena una vez, para que quien tocó sepa que funciona.
     */
    enable() {
      setMuted(false)
      const target = context()
      target
        ?.resume()
        .then(() => chime(target))
        .catch(() => {})
    },

    setMuted,
  }
}

export type Sound = ReturnType<typeof createSound>

function localStorageOrNothing(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

/** El aviso de esta tablet. */
export const sound = createSound({
  createAudio: () => (typeof AudioContext === 'undefined' ? undefined : new AudioContext()),
  storage: localStorageOrNothing(),
  gestures: typeof document === 'undefined' ? undefined : document,
})

/** Suena para una comanda nueva, si la tablet puede y quiere. */
export function playChime() {
  sound.play()
}
