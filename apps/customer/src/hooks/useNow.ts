import { useEffect, useState } from 'react'

/** Reloj que avanza solo, para que los textos "hace X" envejezcan en pantalla. */
export function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])

  return now
}
