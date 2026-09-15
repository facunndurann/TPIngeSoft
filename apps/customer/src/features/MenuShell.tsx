import type { ReactNode } from 'react'
import { menuDesignCssVars } from '@restaurant-platform/shared'
import { useMenuDesign } from '@/features/menu-design'

export function MenuShell({
  children,
  role,
  className,
}: {
  children: ReactNode
  role?: string
  className?: string
}) {
  const design = useMenuDesign()
  return (
    <main
      className={className ? `shell ${className}` : 'shell'}
      data-design={design.id}
      data-layout={design.layout}
      style={menuDesignCssVars(design.tokens)}
      role={role}
    >
      {children}
    </main>
  )
}
