import { useSyncExternalStore } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { IconButton } from '@restaurant-platform/ui'
import { sound as tabletSound, type Sound, type SoundStatus } from './chime'

/**
 * El aviso sonoro de comandas nuevas, en la cabecera. Si el navegador lo bloqueó
 * lo dice, y un toque lo activa; aparte, un botón lo silencia o lo vuelve a
 * prender, y la tablet lo recuerda. Sin Web Audio no dibuja nada.
 */
export function SoundControl({ sound = tabletSound }: { sound?: Sound }) {
  const status = useSyncExternalStore(sound.subscribe, sound.status, (): SoundStatus => 'unavailable')
  if (status === 'unavailable') return null

  return (
    <div className="flex items-center gap-2">
      {status === 'blocked' && (
        <button
          type="button"
          onClick={() => sound.enable()}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 text-sm font-medium text-amber-950 hover:bg-amber-100"
        >
          <VolumeX size={16} aria-hidden="true" />
          Sonido desactivado · tocá para activar
        </button>
      )}
      {/* Rótulo fijo y aria-pressed, como «Mostrar contraseña» en el ingreso: se
          anuncia «Sonido de comandas nuevas, activado», no un nombre que cambia. */}
      <IconButton
        label="Sonido de comandas nuevas"
        aria-pressed={status !== 'muted'}
        onClick={() => sound.setMuted(status !== 'muted')}
      >
        {status === 'muted' ? <VolumeX size={20} aria-hidden="true" /> : <Volume2 size={20} aria-hidden="true" />}
      </IconButton>
    </div>
  )
}
