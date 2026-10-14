# Cierre — WI-CORE-058
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-13 · **Estado:** `W-DONE` · **Subtarea:** ST-CORE-065

## Validación
Cerrado bajo el Modo fuera de casa (`awayMode` activo): lo valida la revisión independiente delegada `harness/reports/wi-core-058-independent-review.md` (agente `reviewer`; ciclo 1 CHANGES_REQUESTED con F1 a F4, corregidos; ciclo 2 de 2 APPROVED, 6 mutantes del repositorio detectados, 34 sondas de `isFinalPhpDeclaration`, replay 9/9). Alcance aprobado por el usuario (mensaje directo: indicar si el tipo resuelto es `final`). `DEC-RAG-001` sigue `PENDING`. El usuario es informado y puede reabrirlo. No autoriza push ni despliegue.

## Qué entrega
La sección «Dependencias del código objetivo» marca los tipos resueltos que son `final class`/`final readonly class` o enumeraciones («final: no se puede mockear; usa una instancia real (new, o un caso si es un enum)»), determinado desde el chunk de declaración del índice (si no se puede determinar o el FQCN tiene varias declaraciones, no se afirma); traza aditiva `final?: true` (INTEROP-2.15, evento `CS-CORE-20261013-003` a Console). Contrato `4b0f34a3a73d50df1c2b88934e8a2350732067a9`; código `334708c2c7b88bc1d4b57ab67d3b229f26738408` y corrección `3d209a4ad3538abd8601ab4ea1ae35edd2de3592`. Replay de los 9 casos: top-10 idéntico, +24 tokens por marca (hasta 48 por caso; sección ≤ 139 tokens). Sin cambios en ranking, pesos, `topK`, R-PHP1..5, `contextTokens`, métricas ni agente generalista.

## Notas
Mutante equivalente del `slice` de 20 consultas (el resolutor ya limita a 20) y sonda unitaria opcional de `final function` al inicio de la declaración: sin acción. Los resultados posteriores no son comparables con los de `WI-CORE-057` sin anotar la versión.
