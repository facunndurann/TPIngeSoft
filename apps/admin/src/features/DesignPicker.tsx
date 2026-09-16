import { useId, useState } from 'react'
import { Maximize2 } from 'lucide-react'
import {
  MENU_DESIGN_IDS,
  MENU_DESIGNS,
  menuDesignCssVars,
  type MenuDesign,
  type MenuDesignId,
} from '@restaurant-platform/shared'
import { Modal } from '@/components/ui'
import { customerAppUrl } from '@/lib/customer-app'

type DesignPickerProps = {
  value: MenuDesignId
  onChange: (id: MenuDesignId) => void
  /** Texto de ayuda bajo el título; cambia según dónde se elige el diseño. */
  hint: string
}

export function DesignPicker({ value, onChange, hint }: DesignPickerProps) {
  const [previewDesign, setPreviewDesign] = useState<MenuDesign | null>(null)
  const id = useId()
  const [groupName, labelId, hintId] = [`${id}-design`, `${id}-label`, `${id}-hint`]

  return (
    <div>
      <p id={labelId} className="mb-2 text-sm font-medium text-neutral-700">Diseño de la carta</p>
      <p id={hintId} className="mb-3 text-xs text-neutral-500">{hint}</p>
      <div
        className="grid gap-3 md:grid-cols-3"
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={hintId}
      >
        {MENU_DESIGN_IDS.map((designId) => {
          const design = MENU_DESIGNS[designId]
          const selected = designId === value
          return (
            // Cada tarjeta contiene dos controles hermanos: el radio (dentro del
            // label, que ocupa toda la tarjeta) y el botón de vista previa encima.
            <div
              key={design.id}
              style={menuDesignCssVars(design.tokens)}
              className={`relative overflow-hidden rounded-xl border transition has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-indigo-400 ${
                selected
                  ? 'border-indigo-600 ring-2 ring-indigo-200'
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
                  <div
                    className="rounded-lg p-3"
                    style={{
                      background: 'var(--menu-bg)',
                      color: 'var(--menu-text)',
                      fontFamily: 'var(--menu-font)',
                    }}
                  >
                    <p
                      className="text-[10px] font-bold tracking-[0.16em]"
                      style={{ color: 'var(--menu-eyebrow)', fontFamily: 'var(--menu-font-display)' }}
                    >
                      {design.copy.welcome}
                    </p>
                    <p
                      className="mt-1 text-sm font-semibold pr-6"
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
                  <p className="mt-0.5 text-xs leading-5 text-neutral-500">{design.description}</p>
                </div>
              </label>
              {/* Misma posición que antes sobre la muestra: p-2.5 del marco + top-2/right-2 = 18px. */}
              <button
                type="button"
                aria-label={`Vista previa de ${design.name}`}
                title="Vista previa"
                className="absolute top-4.5 right-4.5 p-1.5 rounded-md cursor-pointer transition-colors opacity-60 hover:opacity-100 hover:bg-black/5"
                style={{ color: 'var(--menu-text)' }}
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
          <p className="mt-2 text-center text-xs text-neutral-500">
            Así ven la carta los comensales en el celular.
          </p>
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
