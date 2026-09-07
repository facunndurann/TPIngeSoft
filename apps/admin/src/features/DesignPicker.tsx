import { useState, type CSSProperties } from 'react'
import { Maximize2 } from 'lucide-react'
import { MENU_DESIGNS, menuDesignCssVars, resolveMenuDesign } from '@restaurant-platform/shared'
import { Modal } from '@/components/ui'

type DesignPickerProps = {
  value: string
  onChange: (id: string) => void
}

type MenuDesign = typeof MENU_DESIGNS[number]

export function DesignPicker({ value, onChange }: DesignPickerProps) {
  const selectedId = resolveMenuDesign(value).id
  const [previewDesign, setPreviewDesign] = useState<MenuDesign | null>(null)

  return (
    <>
      <div className="grid gap-3 md:grid-cols-3" role="listbox" aria-label="Diseño de la carta">
        {MENU_DESIGNS.map((design) => {
          const selected = design.id === selectedId
          return (
            <button
              key={design.id}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => onChange(design.id)}
              className={`cursor-pointer overflow-hidden rounded-xl border text-left transition ${
                selected
                  ? 'border-indigo-600 ring-2 ring-indigo-200'
                  : 'border-neutral-200 hover:border-neutral-300'
              }`}
            >
              <div className="p-2.5 relative" style={menuDesignCssVars(design.tokens) as CSSProperties}>
                <div
                  className="rounded-lg p-3 relative overflow-hidden"
                  style={{
                    background: 'var(--menu-bg)',
                    color: 'var(--menu-text)',
                    fontFamily: 'var(--menu-font)',
                  }}
                >
                  <button
                    type="button"
                    title="Vista previa"
                    className="absolute top-2 right-2 p-1.5 rounded-md cursor-pointer transition-colors opacity-60 hover:opacity-100 hover:bg-black/5"
                    onClick={(e) => {
                      e.stopPropagation()
                      setPreviewDesign(design)
                    }}
                  >
                    <Maximize2 size={14} />
                  </button>
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
            </button>
          )
        })}
      </div>

      {previewDesign && (
        <Modal title={`Vista previa: ${previewDesign.name}`} onClose={() => setPreviewDesign(null)} wide>
          <MenuPreview design={previewDesign} />
        </Modal>
      )}
    </>
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

function MenuPreview({ design }: { design: MenuDesign }) {
  return (
    <div 
      className="rounded-xl overflow-hidden border border-neutral-200 mt-2"
      style={menuDesignCssVars(design.tokens) as CSSProperties}
    >
      <div 
        className="p-5 sm:p-8"
        style={{
          background: 'var(--menu-bg)',
          color: 'var(--menu-text)',
          fontFamily: 'var(--menu-font)',
        }}
      >
        <p
          className="text-xs font-bold tracking-[0.16em] uppercase mb-1"
          style={{ color: 'var(--menu-eyebrow)', fontFamily: 'var(--menu-font-display)' }}
        >
          {design.copy.welcome}
        </p>
        <h2 
          className="text-2xl sm:text-3xl font-bold mb-6"
          style={{ fontFamily: 'var(--menu-font-display)', color: 'var(--menu-heading)' }}
        >
          Menú de Ejemplo
        </h2>
        
        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider mb-3 opacity-60">
              Populares
            </h3>
            <div className="space-y-3">
              {[
                { name: 'Hamburguesa Completa', desc: 'Carne, queso, lechuga, tomate y papas.', price: '$8.500' },
                { name: 'Ensalada César', desc: 'Pollo, crutones, queso parmesano y aderezo.', price: '$6.200' },
              ].map(item => (
                <div 
                  key={item.name}
                  className="p-4 rounded-xl border flex justify-between gap-4"
                  style={{ 
                    background: 'var(--menu-surface-muted)',
                    borderColor: 'var(--menu-border)'
                  }}
                >
                  <div>
                    <h4 className="font-medium" style={{ color: 'var(--menu-heading)' }}>{item.name}</h4>
                    <p className="text-sm opacity-80 mt-1">{item.desc}</p>
                    <p className="font-medium mt-2" style={{ color: 'var(--menu-accent)' }}>{item.price}</p>
                  </div>
                  <div 
                    className="w-20 h-20 rounded-lg flex-shrink-0"
                    style={{ background: 'var(--menu-notice-bg)', opacity: 0.5 }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
