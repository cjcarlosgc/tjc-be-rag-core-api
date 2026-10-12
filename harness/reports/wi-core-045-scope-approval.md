# WI-CORE-045 — aprobación de alcance
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-12 · **Autoriza:** Jean (Human Reviewer), directamente en el chat de Core: «Sí, cerrar 004 y abrir el WI de contrato» (veredicto de `WI-CORE-004`); las decisiones que este WI consolida son las seis del 2026-10-12 registradas en `harness/reports/wi-core-004-user-decisions-2026-10-12.md` («Sí, las seis aprobadas»).

## Alcance aprobado (solo `spec/contracts/` y registro del Harness; sin `app/`)
a. INTEROP §6.11: nombrar `404 FUNCTIONAL_QUESTION_NOT_FOUND` para la respuesta tardía (OC15) y corregir la narrativa que habla de «regla potencial».
b. SYSTEM «Baseline, generación y clasificación» (§152-154): definición de «fallo de plataforma por símbolo» y precedencia entre símbolos con resultados mezclados (OC08). Si la precedencia implica alternativas con consecuencias de producto distintas (conclusión del Check, publicación), queda como decisión `PROPOSED` con recomendación, sin presentarla como cerrada.
c. Semántica de `functionalBehaviorValidated`: «el pipeline terminó sin hallar discrepancia», no «se ejecutó una validación» (INTEROP §6.10/§6.11 y feature 013).
d. `continuationAttemptId` es `null` mientras queden preguntas pendientes (INTEROP §6.11).
e. OC11: `resultSummary` «PR excede 300 archivos; análisis no realizado»; 300 es un límite de GitHub Integration (`COMPARE_MAX_CHANGED_FILES`), repositorio ajeno: solo se documenta.

## Fuera de alcance
Código de `app/` (los WI de OC11 y de OC08 vienen después, con aprobación de alcance); cambios en Console, Integration o Sandbox; push.

## Proceso
Contract Sync `start`; sdd-analyst breve; contract-reviewer antes de editar INTEROP/SYSTEM; publicación por `harness/contract-sync.mjs publish` a Console e Integration (Sandbox solo si el contenido le afecta); el usuario valida el cierre.
