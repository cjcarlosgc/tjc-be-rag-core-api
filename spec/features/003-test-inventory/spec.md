# 003-test-inventory — Especificación

**Estado:** aprobado para SDD 1.0 salvo elementos marcados PENDING/PROPOSED.  
**Historias:** HU06

> **Retirado por SDD 2.0:** el disparador ZIP que poblaba este inventario queda retirado (ver `CHANGELOG.md`). El pipeline de detección de framework/targets se reutiliza desde `013-pr-driven-analysis` (HU33/34), con disparador PR-driven en vez de carga manual.

## Objetivo

Construir el inventario de objetivos testables y pruebas existentes por ProjectVersion.

## Reglas y comportamiento

- Detectar framework Jest/Vitest cuando sea posible.
- Identificar clases, métodos y funciones testables como `TestTarget` (`targetType` CLASS|METHOD|FUNCTION, ver `004-rag-retrieval-context`).
- Relacionar pruebas existentes de forma trazable y marcar targets con/sin test.
- Un proyecto sin detección concluyente no puede inventar framework.

## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.
