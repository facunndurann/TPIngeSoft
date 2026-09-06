import type { CSSProperties } from 'react'
import { MENU_DESIGNS, menuDesignCssVars, resolveMenuDesign } from '@restaurant-platform/shared'

type DesignPickerProps = {
  value: string
  onChange: (id: string) => void
}

export function DesignPicker({ value, onChange }: DesignPickerProps) {
  const selectedId = resolveMenuDesign(value).id

  return (
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
            <div className="p-2.5" style={menuDesignCssVars(design.tokens) as CSSProperties}>
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
              <p className="mt-0.5 text-xs leading-5 text-neutral-500">{design.description}</p>
            </div>
          </button>
        )
      })}
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
