# WI-CORE-058 — aprobación de alcance
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-13 · **Autoriza:** Jean, directamente en el chat de Core vía el coordinador (mensaje directo): ampliar el alcance de Fase 2 #1 para indicar en la sección «Dependencias del código objetivo» si el tipo resuelto es `final` (no se puede mockear), sin modificar el ranking ni las relaciones R-PHP; con prueba rojo→verde, replay offline sobre los 9 casos del piloto V1 y verificación no oficial en SUB-1/SUB-2; sin push ni despliegue sin su orden.

## Motivo
Verificación no oficial posterior a `WI-CORE-057` (experimentos `951a7bb2` y `656140e5`): la alucinación de namespace desapareció pero `ClassIsFinalException` (mock de `Pilot\Subscriptions\Services\RenewalDatePolicy`, `final class`) causó 3 de 5 fallos RAG y 2 de 4 del agente generalista.

## Alcance
Determinar, desde el chunk de declaración del tipo resuelto en el índice de la versión, si es `final` (`final class`, `final readonly class`) o una enumeración (implícitamente final); marcarlo de forma aditiva en la entrada de `dependencyContext` (`final?: true`, omitido si no se puede afirmar) y renderizarlo en la sección con texto claro. INTEROP aditivo con contract-reviewer ANTES de editar y Contract Sync a Console. No cambia ranking, pesos, `topK`, R-PHP1..5, `contextTokens` ni métricas; respeta tope de 20 entradas y 300 tokens; el agente generalista no cambia; sin migraciones; `DEC-RAG-001` sigue `PENDING`.
