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
    // Las variables del diseño van en un contenedor a lo ancho de la pantalla: así el
    // fondo alrededor de la columna central también es del diseño activo.
    <div className="menu-page" style={menuDesignCssVars(design.tokens)}>
      <main
        className={className ? `shell ${className}` : 'shell'}
        data-design={design.id}
        data-layout={design.layout}
        role={role}
      >
        {children}
      </main>
    </div>
  )
}
