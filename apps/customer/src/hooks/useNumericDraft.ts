import { useState } from 'react'

/** Lo que un campo numérico necesita para dibujarse y para terminar un valor. */
type NumericDraft = {
  /** Lo que va en el input: el borrador mientras se tipea, si no el confirmado. */
  text: string
  /** Tipear: confirma apenas el texto es un valor válido; si no, deja el borrador. */
  onChange: (text: string) => void
  /** Salir del campo descarta el borrador y vuelve al último valor confirmado. */
  onBlur: () => void
  /** Confirma un valor que no se tipeó, como los botones ± de la cantidad. */
  commit: (next: number | null) => void
}

/**
 * El `parse` de un campo de enteros con rango, como la cantidad o las partes de la
 * cuenta: solo un entero dentro de [min, max] se confirma; vacío, decimales o fuera
 * de rango quedan como borrador hasta el blur.
 */
export function integerIn(min: number, max: number) {
  return (text: string) => {
    const value = Number(text)
    // `Number('')` es 0, así que el campo vacío se descarta antes de mirar el rango.
    if (text === '' || !Number.isInteger(value)) return undefined
    return value >= min && value <= max ? value : undefined
  }
}

/**
 * Máquina única de los controles numéricos del comensal. Mientras se tipea hay
 * un borrador local y solo un texto que `parse` acepta llega al estado de la
 * app; salir del campo con algo incompleto o fuera de rango no cambia nada.
 * Así ningún control descarta una tecla en silencio ni deja entrar un valor
 * inválido, y no hay dos campos que puedan divergir en el próximo cambio: cada
 * uno aporta solo su `parse`, sus límites y su markup.
 *
 * `parse` devuelve el valor a confirmar —`null` incluido, que es el campo vacío
 * de quien no participa del reparto— o `undefined` cuando todavía no hay nada
 * que confirmar.
 */
export function useNumericDraft(
  value: number | null,
  parse: (text: string) => number | null | undefined,
  onCommit: (value: number | null) => void,
): NumericDraft {
  // Lo que se está tipeando. `undefined` = el campo muestra el valor confirmado;
  // así se puede borrar para escribir otro número sin que la app vea un hueco.
  const [typed, setTyped] = useState<string>()

  const commit = (next: number | null) => {
    setTyped(undefined)
    if (next !== value) onCommit(next)
  }

  return {
    text: typed ?? (value === null ? '' : String(value)),
    onChange: (text) => {
      setTyped(text)
      const parsed = parse(text)
      if (parsed !== undefined) commit(parsed)
    },
    onBlur: () => setTyped(undefined),
    commit,
  }
}
