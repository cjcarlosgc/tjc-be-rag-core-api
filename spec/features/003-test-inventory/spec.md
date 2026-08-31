# 003-test-inventory — Especificación

**Estado:** aprobado para SDD 1.0 salvo elementos marcados PENDING/PROPOSED.  
**Historias:** HU06

## Objetivo

Construir el inventario de objetivos testables y pruebas existentes por ProjectVersion.

## Reglas y comportamiento

- Detectar framework Jest/Vitest cuando sea posible.
- Identificar clases, métodos y funciones testables.
- Relacionar pruebas existentes de forma trazable y marcar targets con/sin test.
- Un proyecto sin detección concluyente no puede inventar framework.

## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.
