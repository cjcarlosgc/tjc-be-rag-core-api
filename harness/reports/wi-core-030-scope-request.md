# WI-CORE-030 — solicitud del usuario (2026-10-09)

Modelo: agente principal de la sesión Core · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Origen:** el usuario, en chat, tras leer la limitación registrada en `WI-CORE-025` (un job de experimento cuyo worker muere queda `RUNNING` porque `releaseStale` solo libera jobs con `dedupeKey`): «Sí, habría que resolverlo... si no lo más pronto posible».

**Qué es y qué no es:** es la petición de planificar el trabajo (`IDEA-008` → `WI-CORE-030`, `ST-CORE-037`, `W-PLANNED`, P1, dependiente de `WI-CORE-025`). **No** es aprobación del alcance de implementación: el análisis SDD debe fijar por tipo de job si se libera (la restricción por `dedupeKey` existe por algún motivo, probablemente efectos no idempotentes) y el usuario aprueba ese alcance antes de `W-IN_PROGRESS`.

**Relación con `WI-CORE-025`:** el latido por repetición de 025 resuelve la reentrada cuando `handle()` rechaza; 030 cierra la otra mitad (caída del proceso del worker).
