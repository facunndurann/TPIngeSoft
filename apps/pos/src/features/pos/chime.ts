let audio: AudioContext | undefined

/**
 * Un aviso corto de dos notas, generado con Web Audio: no hay archivo que
 * descargar ni que cachear. Si el navegador no tiene audio, o todavía no deja
 * sonar la página porque nadie la tocó desde que se abrió, no suena: el
 * contador de la pestaña avisa igual.
 */
export function playChime() {
  try {
    audio ??= new AudioContext()
    audio.resume().catch(() => {})
    const start = audio.currentTime
    for (const [offset, frequency] of [[0, 880], [0.16, 1320]] as const) {
      const tone = audio.createOscillator()
      const volume = audio.createGain()
      tone.frequency.value = frequency
      // Sube y baja enseguida: un golpe suave, sin el clic de cortar la onda en seco.
      volume.gain.setValueAtTime(0.0001, start + offset)
      volume.gain.exponentialRampToValueAtTime(0.2, start + offset + 0.02)
      volume.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.3)
      tone.connect(volume).connect(audio.destination)
      tone.start(start + offset)
      tone.stop(start + offset + 0.32)
    }
  } catch {
    // Sin Web Audio: el aviso visual alcanza.
  }
}
