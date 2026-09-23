---
name: thermo-nuclear-ui-review
description: Revisión de UI/UX extremadamente exigente de una app entera (customer, admin o pos), con la postura de la thermo-nuclear code review y las reglas de ui-ux-pro-max. Usar para "revisión thermo-nuclear de UI", "emprolijar la app", auditoría profunda de UX o accesibilidad.
argument-hint: "[app o ruta, p. ej. apps/customer]"
disable-model-invocation: true
---

# Revisión thermo-nuclear de UI/UX

Es la postura de `.claude/skills/thermo-nuclear-code-quality-review` aplicada a lo que el usuario ve y toca, con la base de reglas de `.claude/skills/ui-ux-pro-max`. El objetivo no es juntar detalles para pulir: es encontrar los cambios que hacen que la app se sienta inevitable, con menos pantallas, menos estados, menos variantes y un único modo de resolver cada cosa.

Alcance: `$ARGUMENTS`. Si viene vacío, preguntá qué app revisar. Se revisa la app entera tal como está, no el diff de la rama.

## 1. Antes de opinar

1. Leé `.claude/skills/thermo-nuclear-code-quality-review/SKILL.md` para adoptar su postura, su tono y su umbral de aprobación. Leé `.claude/skills/ui-ux-pro-max/SKILL.md` para la tabla de prioridades 1→10, `references/quick-reference.md` para el texto completo de cada regla y `references/pro-rules.md` para el checklist previo a entregar.
2. Armá el inventario de la app: las rutas (`src/App.tsx`), los componentes compartidos de `packages/ui/src`, los estilos globales (`src/index.css`) y, en customer, los tokens `--menu-*` de los tres diseños de `packages/shared/src/designs.ts` (`oliva`, `brasas`, `linterna`).
3. Mirá la app corriendo antes de escribir un solo hallazgo visual. Leer el código solo no alcanza para una review de UI. Usá la skill `run` para levantarla y recorrer los flujos interactivos, y sacá capturas a 375×812 (mobile) y 1280×800 (desktop) con el script de esta skill. Guardalas en el scratchpad, nunca en el repo:

```bash
node .claude/skills/thermo-nuclear-ui-review/scripts/capture.mjs <url> <scratchpad>/<nombre>.png            # 375×812
node .claude/skills/thermo-nuclear-ui-review/scripts/capture.mjs <url> <scratchpad>/<nombre>.png 1280 800   # desktop
node .claude/skills/thermo-nuclear-ui-review/scripts/capture.mjs <url> <scratchpad>/<nombre>.png 375 812 --full   # página completa
```

El script avisa con `⚠ scroll horizontal` cuando el contenido es más ancho que el viewport. No uses `--window-size` de Chrome headless directamente: en Mac no baja de 500px de ancho, la página se dibuja a 500px y la captura sale recortada como si hubiera scroll horizontal.

| App | Arranque | Qué recorrer |
|-----|----------|--------------|
| customer (mobile-first) | `pnpm dev:customer` → `http://localhost:5173` | Sin backend: `/vista-previa/oliva`, `/vista-previa/brasas`, `/vista-previa/linterna`. Con Supabase local (`docs/SETUP.md`) y `pnpm dev:functions`: `/m/demo-burger-mesa-1` → producto → carrito → revisar → pedidos → división de la cuenta → pago. |
| admin | `pnpm dev:admin` → `http://localhost:5174` | Login, mesas y QR, salón, menú, diseños. |
| pos | `pnpm dev:pos` → `http://localhost:5175` | Login `pos.esquina` / `demo-pos1234`, tablero de comandas, mapa del salón, cierre. |

Si no se puede levantar la app o una parte del flujo, decilo al principio del informe y marcá cada hallazgo visual como "sin verificar en pantalla". No presentes como vista una pantalla que no miraste.

## 2. Postura

- **Buscá el "design judo".** Ante cada pantalla, estado o variante, preguntá primero si puede desaparecer y después cómo mejorarla. Por ejemplo: dos pantallas que muestran lo mismo con otra forma, un modal que podría estar inline, una confirmación que no protege nada, tres estilos de botón para la misma acción, o carga, vacío y error resueltos distinto en cada pantalla.
- **La inconsistencia es un problema estructural, no cosmético.** Si un mismo concepto (precio, estado de un pedido, botón primario, error, anuncio en vivo) se ve o se comporta distinto en dos lugares, lo que falta es un componente, una clase o un token canónico. Señalá dónde debería vivir: `packages/ui`, `src/index.css` o `packages/shared/src/designs.ts`.
- **Nada de parches.** Desconfiá de un `className` suelto, un color hex en un componente, un `!important`, un breakpoint mágico, un `style={{…}}` inline o un `aria-*` agregado para tapar una estructura que no es semántica. Proponé el arreglo en la capa que corresponde.
- **Pocos hallazgos y de alta convicción.** Si hay problemas estructurales, no los tapes con una lista de detalles.

## 3. Qué revisar

Recorré las diez categorías de ui-ux-pro-max en su orden de prioridad y leé la sección de `references/quick-reference.md` de cada una. Además, en este repo:

- **Contraste en cada diseño**, no solo en uno: texto, texto apagado (`--menu-muted`), bordes de inputs y anillo de foco (`--menu-focus`) contra su fondo real, en `oliva`, `brasas` y `linterna`.
- **Áreas táctiles de 44px** en customer, que se usa con el celular en la mesa, y una separación que evite tocar el botón de al lado.
- **Todos los estados de cada pantalla que va a red**: carga, vacío, error, sin conexión, datos desactualizados por Realtime o polling, y doble envío. Si una pantalla tiene los cinco bien y otra ninguno, es un hallazgo sistémico.
- **Anuncios para lector de pantalla** en los cambios que el usuario no provoca (otro comensal agrega un plato, cambia el estado de un pedido, se reparte la cuenta), resueltos de una sola forma en toda la app.
- **Inputs a 16px o más**, porque con menos Safari de iOS hace zoom al enfocar. Labels visibles y el error al lado del campo.
- **Navegación**: el botón atrás del navegador hace lo esperado, cada ruta abre bien si se entra directo por link (por ejemplo `carrito/:itemId` o `producto/:productId`) y volver no pierde lo que el usuario había escrito.
- **Safe areas y barras fijas**: la barra del carrito y los botones del final de la página no quedan tapados por el notch ni por la barra del navegador.
- **`prefers-reduced-motion`** en toda animación o transición.

Antes de citar una regla, confirmala con el buscador. Corrélo desde la raíz del repo con esta ruta y no con la de `${CLAUDE_PLUGIN_ROOT}` que trae el SKILL.md de ui-ux-pro-max, porque acá esa variable no está definida:

```bash
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<resultado observable, 2–5 términos>" --domain ux
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<detalle de implementación>" --stack react
```

Una intención por consulta y un solo reintento con una consulta más acotada. Si no hay coincidencia, decí que la regla sale de los valores generales de la skill y no de la base.

## 4. Informe

Empezá con un veredicto de una línea: **aprobado**, **cambios necesarios** o **bloqueado**. Seguí con los hallazgos en este orden:

1. Bloqueos de tarea o de accesibilidad: alguien no puede completar el flujo con teclado, con lector de pantalla o en 375px.
2. Simplificaciones grandes del flujo o del sistema visual que se están dejando pasar.
3. Inconsistencias sistémicas: falta un componente, una clase o un token canónico.
4. Estados faltantes o engañosos.
5. Layout y responsive.
6. Pulido: tipografía, espaciado, animación.

Cada hallazgo lleva:

- **Qué ve el usuario**: pantalla, viewport y diseño, y si lo verificaste en una captura o no.
- **Dónde está**: `archivo:línea` del origen del problema, no solo del síntoma.
- **Regla**: la categoría de ui-ux-pro-max y el resultado del buscador cuando lo hubo.
- **Remedio**: el cambio en la capa correcta. Si un mismo remedio resuelve varios hallazgos, agrupalos bajo ese remedio.

Cerrá con un plan de arreglos ordenado en pasos chicos, uno por remedio. En esta pasada no toques código salvo que el usuario lo pida.

## 5. Umbral de aprobación

Tomalo como bloqueante salvo que haya una justificación clara:

- Un paso del flujo principal que no se puede completar con teclado, con lector de pantalla o en 375px.
- Texto o foco por debajo de 4.5:1 (3:1 para texto grande y bordes) en cualquiera de los diseños.
- Una acción que va a red sin feedback de carga y de error, o que se puede enviar dos veces.
- Un mismo concepto resuelto con dos formas visuales o dos comportamientos distintos sin razón.
- Colores, medidas o tipografías sueltos en un componente cuando existe el token o la clase.
- Una pantalla, modal o paso que se puede eliminar sin que el usuario pierda nada.

## 6. Cuando se apliquen los arreglos

- Un commit por remedio, con el estilo del repo: `tipo(app): descripción` en español.
- Borrá complejidad en vez de moverla de lugar: si el arreglo agrega una variante o un condicional, reconsiderá el remedio.
- Después de cada remedio corré `pnpm typecheck`, `pnpm lint` y `pnpm test`, y volvé a capturar las pantallas que tocaste para comparar con las de antes.

## Tono

Directo y exigente, como la thermo-nuclear, sin ser grosero. Frases del estilo:

- `esta pantalla y la de X muestran lo mismo con dos formas distintas. ¿podemos quedarnos con una?`
- `este estado de error está resuelto a mano acá y distinto en X. falta un componente compartido.`
- `en brasas el texto apagado queda en 3.1:1. hay que corregir el token, no esta pantalla.`
- `este modal no protege de nada. ¿lo sacamos y dejamos la acción directa con deshacer?`
- `el botón mide 32px de alto en mobile. con el celular en una mano, se toca el de al lado.`
