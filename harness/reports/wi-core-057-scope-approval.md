# WI-CORE-057 — aprobación de alcance
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-13 · **Autoriza:** Jean, directamente en el chat de Core vía el coordinador (AskUserQuestion «Confirmo el alcance»), sobre el WI de Fase 2 #1. Diagnóstico: `harness/reports/fase2-01-recuperacion-colaboradores-diagnostico.md` (commit `61d7ff9`): en SUB-1/SUB-2 el LLM inventó `Pilot\Subscriptions\Contracts\RenewalDatePolicy` porque el constructor no trae el FQCN de un tipo del mismo namespace.

## Alcance
Añadir al contexto de generación RAG (solo PHP) una sección con los nombres completos (FQCN) de las dependencias del target: tipos del constructor de la clase declarante y de la firma del método, resueltos desde `importsUsed` y el namespace de la clase declarante, verificando contra el índice de tipos de la versión y sin inventar nombres que no resuelvan. Con límite de tokens propio que no desplaza chunks. Visible en la traza RAG de forma aditiva (contrato con contract-reviewer ANTES de editar + Contract Sync). **No** modifica ranking, pesos, `topK`, `minimumScore`, relaciones R-PHP1..5, `contextTokens` ni métricas; `DEC-RAG-001` sigue `PENDING`; TypeScript sin cambio; sin migraciones.
