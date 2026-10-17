# Cierre — WI-CORE-064
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-14 · **Estado:** `W-DONE` · **Subtarea:** ST-CORE-071

## Validación
Cerrado bajo el Modo fuera de casa (`awayMode` activo): lo valida la revisión independiente delegada `harness/reports/wi-core-064-independent-review.md` (agente `reviewer`; ciclo 1 CHANGES_REQUESTED por H1 a H3, corregidos; ciclo 2 de 2 APPROVED con replay 9/9, mutantes detectados y tokens recomputados). Alcance aprobado por Jean (mensaje directo: Fase 3 A). El usuario es informado y puede reabrirlo. No autoriza push ni despliegue.

## Qué entrega
Tres convenciones PHPUnit con la MISMA redacción (misma constante `php-phpunit-conventions.ts`, versión del prompt `php-prompt-2026-10-14.3`) en el prompt de generación PHP del RAG y en las instrucciones iniciales del agente PHP: objetos de valor con `assertEquals` y `assertSame` solo para escalares o identidad; sin dobles de clases `final` ni enums (clases con `new`, enum con uno de sus casos); solo FQCN presentes en el contexto (y los de la sección de dependencias si existe). +126 tokens (≈ +10 % a +14,5 % del prompt RAG). Sin cambios en ranking, R-PHP, pesos, `topK`, herramientas del agente, prompt TypeScript ni contrato. Código: `009fa854031132aa2ea96a5cc3dc3efb77ead4d8` (convenciones) y `dc45e1e42984b252981758965c7139c168abb0c3` (corrección de la revisión). Replay y criterio de verificación para un experimento no oficial: `harness/reports/wi-core-064-replay-y-verificacion.md`.

## Notas
IDEA-036 (persistir la versión del prompt en la traza; medir el efecto con un experimento nuevo).
