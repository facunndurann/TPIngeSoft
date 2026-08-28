# _shared

Código compartido entre edge functions:

- `pos/`: capa de adaptadores POS (`InternalPosAdapter` hoy; `FudoAdapter` y otros a futuro).
- `llm/`: cliente del LLM para el menú inteligente.
- `validation/`: validadores de pedidos (precios, disponibilidad, reglas de modificadores).

Se implementa a partir de la Fase 4.
