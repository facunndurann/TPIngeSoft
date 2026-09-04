# Plataforma de Autoservicio para Restaurantes — Documento de Requerimientos

## 1. Visión General

Plataforma web multi-restaurante que permite a los comensales acceder a un menú digital interactivo escaneando un código QR de mesa, personalizar platos, realizar pedidos grupales, recibir asistencia inteligente mediante un chatbot (LLM), y pagar de forma total o dividida con Mercado Pago. Incluye un panel administrativo completo para la gestión del catálogo, un POS propio integrado con tablero de comandas en tiempo real, y un sistema de beeper digital para locales con modalidad auto-servicio.

---

## 2. Actores del Sistema

| Actor | Descripción |
|-------|-------------|
| **Comensal** | Cliente del restaurante que interactúa con la app mobile-first desde su celular |
| **Administrador** | Dueño o encargado del restaurante que gestiona el catálogo, configuración y reportes |
| **Personal de cocina/barra** | Operador que recibe, prepara y marca pedidos como listos |
| **Personal de mostrador** | Operador que confirma entregas y gestiona el despacho |

---

## 3. Épicas y User Stories

### 3.1 Experiencia del Comensal: Pedido y Carta Digital *(Epic MI-4)*

> Gestión completa de la experiencia del comensal desde el escaneo del QR hasta la confirmación del pedido.

#### MI-1 — Acceso por QR

**Como** comensal, **quiero** escanear el código QR de mi mesa, **para** acceder al menú interactivo de forma rápida y autónoma.

#### MI-2 — Exploración del catálogo

**Como** comensal, **quiero** explorar el catálogo y seleccionar los platos que deseo, **para** armar mi pedido directamente desde el menú interactivo.

#### MI-3 — Envío del pedido

**Como** comensal, **quiero** confirmar y enviar mi pedido desde el menú, **para** que se registre automáticamente en el sistema POS del restaurante.

#### MI-8 — Personalización de platos

**Como** comensal, **quiero** personalizar los platos agregando o quitando ingredientes, **para** adaptar la comida a mis preferencias y restricciones alimentarias.

#### MI-12 — Cancelación de pedido

**Como** comensal, **quiero** cancelar o solicitar la cancelación de un pedido no preparado desde el menú interactivo, **para** evitar cargos o preparaciones no deseadas si cambio de opinión.

#### MI-13 — Agregar ítems a comanda existente

**Como** comensal, **quiero** volver a escanear el QR y agregar nuevos ítems a mi comanda existente, **para** pedir platos adicionales o postres durante mi visita.

#### MI-24 — Filtros dietarios

**Como** comensal, **quiero** seleccionar mis preferencias y restricciones alimenticias (Sin TACC, vegano, etc.), **para** que el menú me muestre únicamente los platos seguros y aptos para mi consumo.

**Criterios de Aceptación:**

- **Dado que** el comensal abre el menú digital, **cuando** selecciona uno o más filtros dietarios (Celiaco / Sin TACC, Vegano, Vegetariano, Sin Lactosa, Sin Frutos Secos), **entonces** el catálogo oculta los platos no aptos o resalta visualmente los platos certificados.
- Si un plato puede adaptarse quitando ingredientes (ej. hamburguesa sin queso para intolerantes a la lactosa), el sistema lo muestra con la etiqueta "Apto con modificaciones".
- Se incluye un disclaimer de seguridad sobre contaminación cruzada configurable por el local.

---

### 3.2 Backoffice Gastronómico: Gestión de Carta y Catálogo *(Epic MI-5)*

> Panel administrativo para dueños y encargados del restaurante: creación, edición y eliminación de platos, precios, fotos, categorías y reglas de personalización de ingredientes.

#### MI-9 — CRUD de platos

**Como** administrador del restaurante, **quiero** agregar, editar y eliminar platos del menú con sus precios y fotos, **para** mantener la carta siempre actualizada.

#### MI-10 — Reglas de personalización

**Como** administrador del restaurante, **quiero** configurar las opciones y reglas de personalización de los platos, **para** definir qué modificaciones pueden solicitar los clientes.

#### MI-11 — Gestión de ingredientes

**Como** administrador del restaurante, **quiero** habilitar o deshabilitar la adición y remoción de ingredientes por plato, **para** ofrecer flexibilidad en la comanda según la disponibilidad de cocina.

#### MI-25 — Etiquetado dietario y alérgenos

**Como** administrador del restaurante, **quiero** etiquetar platos e ingredientes con sellos dietarios y advertencias de alérgenos, **para** alimentar el catálogo y garantizar información clara al comensal.

**Criterios de Aceptación:**

- En la ficha de edición de cada plato, el administrador puede tildar etiquetas dietarias (Vegano, Vegetariano, Kosher, etc.) y alérgenos reconocidos (Gluten, Lácteos, Huevos, Maní, Mariscos, Soja).
- Al agregar o quitar ingredientes en platos personalizables, el sistema recalcula automáticamente los sellos resultantes.

---

### 3.3 Operaciones de Cocina, KDS e Integración POS *(Epic MI-14)*

> Recepción de comandas en cocina, panel de monitoreo de estados (KDS), comunicación y sincronización transparente con el sistema POS del restaurante.

#### MI-7 — Panel de gestión de pedidos

**Como** personal del restaurante, **quiero** acceder a un panel para visualizar y gestionar pedidos (pendientes, en proceso, cancelados), **para** controlar el flujo de pedidos y actualizar sus estados.

---

### 3.4 Beeper Digital y Modalidad Auto-Servicio *(Epic MI-15)*

> Solución para restaurantes y bares con modalidad de auto-servicio: alertas visuales, sonoras y con vibración en el celular del cliente, disparadores desde cocina/barra y confirmación de entrega en mostrador.

#### MI-16 — Estado en vivo y alertas del beeper

**Como** comensal, **quiero** ver en mi celular el estado en vivo de mi pedido y recibir alertas del beeper digital, **para** saber cuándo acercarme a retirar mi comida sin esperar de pie.

**Criterios de Aceptación:**

- **Dado que** el comensal envió un pedido en un local con modo auto-servicio activo, **cuando** el pedido pase al estado _'Listo para retirar'_, **entonces** la pantalla del celular debe mostrar una alerta visual llamativa, reproducir un tono sonoro continuo/intermitente y activar la vibración del dispositivo.
- **Dado que** la alerta está sonando, **cuando** el comensal presione _'Entendido / Voy a retirar'_, **entonces** el sonido se silencia y la pantalla muestra claramente el número de comanda y el punto de retiro.
- **Dado que** el comensal bloqueó su pantalla o cambió de pestaña, **cuando** el pedido esté listo, **entonces** debe recibir una notificación web push / aviso en el navegador.

#### MI-17 — Llamador desde cocina/barra

**Como** personal de cocina/barra, **quiero** marcar un pedido como 'Listo para retirar' con un clic, **para** hacer sonar el beeper en el celular del comensal y despejar la barra.

**Criterios de Aceptación:**

- **Dado que** un plato o bebida finalizó su preparación en cocina/barra, **cuando** el personal presione el botón _'Llamar Comensal / Listo'_, **entonces** el estado del pedido cambia a _'Esperando Retiro'_ y se envía la alerta en tiempo real al dispositivo del comensal.
- El panel de despacho muestra un contador en vivo con los minutos transcurridos desde que se disparó la llamada.

#### MI-18 — Re-llamada de pedidos demorados

**Como** personal de mostrador/barra, **quiero** reenviar la alerta sonora del beeper a pedidos demorados, **para** evitar que la comida se enfríe en el mostrador.

**Criterios de Aceptación:**

- **Dado que** un pedido lleva más de X minutos en estado _'Esperando Retiro'_, **cuando** el personal presione _'Re-llamar'_, **entonces** el celular del comensal vuelve a sonar y vibrar con un aviso de insistencia.
- El sistema registra la cantidad de re-llamados efectuados para auditoría de tiempos de entrega.

#### MI-19 — Confirmación de entrega

**Como** personal de mostrador, **quiero** confirmar la entrega del pedido verificando el número de orden, **para** cerrar el ciclo de la comanda y apagar la alerta en el cliente.

**Criterios de Aceptación:**

- **Dado que** el comensal se acerca a retirar su pedido, **cuando** el personal de mostrador verifica el número de orden y presiona _'Entregado'_, **entonces** el pedido se archiva en el KDS y la pantalla del comensal pasa al estado final de agradecimiento (_'¡Buen provecho!'_).
- Se desactiva cualquier alerta sonora, vibración o bloqueo de pantalla en el cliente.

#### MI-20 — Toggle auto-servicio

**Como** administrador del restaurante, **quiero** habilitar o deshabilitar la modalidad 'Beeper / Auto-servicio' por local o sector, **para** adaptar el sistema al modelo operativo de mi negocio.

**Criterios de Aceptación:**

- **Dado que** el administrador accede a la configuración de su local o sector, **cuando** activa la opción _'Modo Auto-servicio / Beeper'_, **entonces** la webapp del comensal asigna un número de retiro visible y activa el ciclo de avisos sonoros/visuales.
- **Dado que** la opción está desactivada, **entonces** el sistema opera en modo servicio a la mesa tradicional (el comensal espera a que el mozo acerque el pedido y no se activa el llamador digital).

---

### 3.5 Configuración del Asistente y Prompts del Local *(Epic MI-21)*

> Chatbot inteligente asistido por LLM integrado al menú digital, con personalización del comportamiento por parte del administrador del restaurante.

#### MI-26 — Chat conversacional con el asistente

**Como** comensal, **quiero** conversar con un chatbot asistente dentro del menú para pedirle sugerencias según mis gustos, antojos y presupuesto, **para** recibir recomendaciones personalizadas de la carta.

**Criterios de Aceptación:**

- **Dado que** el comensal abre el chat del asistente y escribe consultas en lenguaje natural (ej. "Tengo ganas de algo liviano y sin carne", "¿Qué bebida combina con el plato X?", "Somos 3 y queremos compartir"), **cuando** el chatbot procesa la consulta, **entonces** responde en lenguaje natural y presenta tarjetas interactivas de los platos sugeridos existentes en la carta con foto, precio y descripción.
- Si el comensal tiene activadas restricciones alimenticias en el menú, el chatbot las respeta estrictamente en sus sugerencias.

#### MI-27 — Agregar al carrito desde el chat

**Como** comensal, **quiero** poder agregar platos directamente a mi pedido desde las recomendaciones del chatbot, **para** agilizar mi compra sin buscarlos manualmente en el catálogo.

**Criterios de Aceptación:**

- Cada tarjeta de plato recomendada por el chatbot incluye un botón "Agregar a la comanda" o "Personalizar".
- Al hacer clic, el ítem se suma al carrito/comanda del comensal manteniendo el contexto de la conversación.

#### MI-22 / MI-28 — Configuración del chatbot por el admin

**Como** administrador del restaurante, **quiero** configurar el tono, especialidades del chef y platos prioritarios para el chatbot, **para** alinear las recomendaciones con la estrategia comercial del negocio.

**Criterios de Aceptación:**

- El administrador puede definir sugerencias destacadas (ej. plato del día, promociones vigentes, sugerencias de maridaje).
- El chatbot solo sugiere platos que se encuentren en estado _"Disponible"_ (con stock) en el sistema.

---

### 3.6 Gestión de Pagos *(Epic MI-6)*

#### MI-23 — División de cuenta

**Como** comensal de la mesa, **quiero** la posibilidad de dividir la cuenta desde mi celular, **para** repartir los gastos equitativamente o por consumo individual entre las personas de la mesa sin depender del personal del restaurante.

---

## 4. Requerimientos No Funcionales

| Categoría | Requerimiento |
|-----------|---------------|
| **Plataforma** | Web app mobile-first (PWA), accesible desde cualquier navegador moderno sin instalación |
| **Multi-tenant** | Soporte para múltiples restaurantes y sucursales en la misma instancia |
| **Tiempo real** | Actualizaciones de estado de pedidos y alertas del beeper vía WebSocket (Supabase Realtime) |
| **Seguridad** | Row Level Security (RLS) en Postgres, autenticación por Supabase Auth |
| **Rendimiento** | Carga inicial del menú < 3s en conexión 4G |
| **Accesibilidad** | Contraste adecuado, navegación por teclado, labels semánticos |
| **Notificaciones** | Web Push API para alertas con pantalla bloqueada |
| **Auditoría** | Registro de re-llamados del beeper y tiempos de entrega para métricas operativas |

---

## 5. Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| **Frontend** | React 19, TypeScript, Vite 7, Tailwind CSS 4, React Router, TanStack Query, Zustand, react-hook-form + Zod |
| **Backend** | Supabase (Postgres + RLS, Auth, Realtime, Storage, Edge Functions) |
| **LLM** | Integración con API de modelo de lenguaje (por definir: OpenAI / Anthropic / etc.) |
| **Pagos** | Mercado Pago SDK (sandbox → producción) |
| **CI/CD** | GitHub Actions (typecheck + lint + build en cada push/PR) |

---

## 6. Trazabilidad Épicas → Fases de Desarrollo

| Épica | Fase(s) |
|-------|---------|
| MI-4 — Experiencia del Comensal | Fase 3, Fase 4 |
| MI-5 — Backoffice Gastronómico | Fase 2 |
| MI-14 — Operaciones de Cocina, KDS e Integración POS | Fase 4, Fase 6 |
| MI-15 — Beeper Digital y Auto-Servicio | Fase 5 |
| MI-21 — Configuración del Asistente y Prompts | Fase 7 |
| MI-6 — Gestión de Pagos | Fase 8 |
