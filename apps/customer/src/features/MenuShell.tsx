import type { ReactNode } from 'react'
import { resolveMenuDesign } from '@restaurant-platform/shared'
import { MenuDesignContext, menuShellStyle, useMenuDesign } from '@/features/menu-design'

export function MenuDesignProvider({
  designId,
  children,
}: {
  designId?: string | null
  children: ReactNode
}) {
  return <MenuDesignContext value={resolveMenuDesign(designId)}>{children}</MenuDesignContext>
}

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
      style={menuShellStyle(design)}
      role={role}
    >
      {children}
    </main>
  )
}
