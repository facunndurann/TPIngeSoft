import { useId, useState } from 'react'
import { Maximize2 } from 'lucide-react'
import {
  MENU_DESIGN_IDS,
  MENU_DESIGNS,
  menuDesignCssVars,
  type MenuDesign,
  type MenuDesignId,
} from '@restaurant-platform/shared'
import { Modal } from '@restaurant-platform/ui'
import { customerAppUrl } from '@/lib/customer-app'

type DesignPickerProps = {
  value: MenuDesignId
  onChange: (id: MenuDesignId) => void
}

export function DesignPicker({ value, onChange }: DesignPickerProps) {
  const [previewDesign, setPreviewDesign] = useState<MenuDesign | null>(null)
  const id = useId()
  const [groupName, labelId] = [`${id}-design`, `${id}-label`]

  return (
    <div>
      <p id={labelId} className="mb-2 text-sm font-medium text-neutral-700">Diseño de la carta</p>
      <div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-labelledby={labelId}>
        {MENU_DESIGN_IDS.map((designId) => {
          const design = MENU_DESIGNS[designId]
          const selected = designId === value
          return (
            // Cada tarjeta contiene dos controles hermanos: el radio (dentro del
            // label, que ocupa toda la tarjeta) y el botón de vista previa encima.
            <div
              key={design.id}
              style={menuDesignCssVars(design.tokens)}
              className={`relative overflow-hidden rounded-xl border transition has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-primary/70 ${
                selected
                  ? 'border-primary ring-2 ring-primary/25'
                  : 'border-neutral-200 hover:border-neutral-300'
              }`}
            >
              <label className="block cursor-pointer text-left">
                <input
                  type="radio"
                  name={groupName}
                  value={design.id}
                  checked={selected}
                  onChange={() => onChange(design.id)}
                  className="sr-only"
                />
                <div className="p-2.5">
                  {/* El botón de vista previa va encima de la muestra, a la derecha
                      (de 15 a 47 px del borde de la tarjeta): la muestra le deja ese
                      lugar entero (10 del marco + 40 = 50 px), así ningún texto,
                      del largo que sea, pasa por debajo. */}
                  <div
                    className="rounded-lg p-3 pr-10"
                    style={{
                      background: 'var(--menu-bg)',
                      color: 'var(--menu-text)',
                      fontFamily: 'var(--menu-font)',
                    }}
                  >
                    {/* 12px, lo mismo que mide el eyebrow en la carta real (--text-xs). */}
                    <p
                      className="text-xs font-bold tracking-[0.16em]"
                      style={{ color: 'var(--menu-eyebrow)', fontFamily: 'var(--menu-font-display)' }}
                    >
                      {design.copy.welcome}
                    </p>
                    <p
                      className="mt-1 text-sm font-semibold"
                      style={{ fontFamily: 'var(--menu-font-display)', color: 'var(--menu-heading)' }}
                    >
                      {design.name}
                    </p>
                    <div className="mt-2 flex gap-1.5">
                      <Swatch color="var(--menu-accent)" />
                      <Swatch color="var(--menu-surface-muted)" />
                      <Swatch color="var(--menu-notice-bg)" />
                    </div>
                  </div>
                </div>
                <div className="px-3 pb-3">
                  <p className="text-sm font-medium text-neutral-900">{design.name}</p>
                  <p className="mt-0.5 text-xs leading-5 text-muted">{design.description}</p>
                </div>
              </label>
              {/* 32 px como el resto de los controles de ícono, con el ícono en el mismo
                  lugar que antes (a 31 px de la esquina). No usa IconButton porque
                  toma el color de cada diseño: `faint` no se leería sobre Brasas. En
                  reposo va en el tono apagado del diseño, medido contra su fondo, y no
                  con opacidad, que bajaba el contraste sin control. */}
              <button
                type="button"
                aria-label={`Vista previa de ${design.name}`}
                title="Vista previa"
                className="absolute top-3.75 right-3.75 inline-flex h-8 w-8 items-center justify-center rounded-md cursor-pointer text-(--menu-muted) transition-colors hover:bg-black/5 hover:text-(--menu-text)"
                onClick={() => setPreviewDesign(design)}
              >
                <Maximize2 size={14} />
              </button>
            </div>
          )
        })}
      </div>

      {previewDesign && (
        <Modal title={`Vista previa: ${previewDesign.name}`} onClose={() => setPreviewDesign(null)}>
          {/* La carta real de la app del comensal con este diseño, en tamaño de celular:
              mismo layout y mismo CSS que ven los comensales. */}
          <iframe
            src={customerAppUrl(`/vista-previa/${encodeURIComponent(previewDesign.id)}`)}
            title={`Carta de ejemplo con el diseño ${previewDesign.name}`}
            className="mx-auto block h-[70vh] max-h-[720px] w-[390px] max-w-full rounded-xl border border-neutral-200"
          />
        </Modal>
      )}
    </div>
  )
}

function Swatch({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-5 w-5 rounded-full border"
      style={{ background: color, borderColor: 'var(--menu-border)' }}
    />
  )
}
