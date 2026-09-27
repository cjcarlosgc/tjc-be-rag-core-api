# 003-test-inventory — Especificación

**Estado:** aprobado para SDD 1.0 salvo elementos marcados PENDING/PROPOSED.  
**Historias:** HU04

El inventario se deriva del snapshot de un `AnalysisRun` y se reutiliza en generación y validación PR-driven.

## Objetivo

Construir el inventario de objetivos testables y pruebas existentes por ProjectVersion.

## Reglas y comportamiento

- Detectar framework Jest/Vitest cuando sea posible. Para el pool PHP, detectar PHPUnit solo cuando esté declarado/configurado directamente; Pest y frameworks ambiguos quedan sin atribución.
- Identificar clases, métodos y funciones testables como `TestTarget` (`targetType` CLASS|METHOD|FUNCTION, ver `004-rag-retrieval-context`).
- Relacionar pruebas existentes de forma trazable y marcar targets con/sin test.
- Para PHP V1, incorporar clases, traits, interfaces y enums al índice; los targets de test son clases, métodos públicos y funciones. Asociar pruebas PHPUnit existentes por import/uso de símbolos sin afirmar cobertura de ejecución.
- Un proyecto sin detección concluyente no puede inventar framework.

El detalle del pool PHP y sus límites está en `018-php-laravel-support`; la cobertura sigue siendo evidencia heurística del inventario, no resultado de ejecutar pruebas.

## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.
