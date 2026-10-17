# Revisión humana — WI-CORE-023
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-08 (America/Lima)
**Reviewer:** usuario (Human Reviewer); el veredicto y las condiciones provienen del usuario en el chat de la sesión, no de un agente (sin `executedBy`).
**Veredicto:** `APPROVED` condicionado a (1) corregir la Desviación 1 y (2) validar la migración `20261008160000_experiment_run_model_config` contra un PostgreSQL desechable/local antes de `W-DONE`.

Evidencia revisada: `wi-core-023-implementation.md`, `wi-core-023-sdd-verification.md`, `wi-core-023-contract-sync-checkpoints.md`.

## Desviaciones
1. **CORREGIR (cumplido).** `modelConfig` se resuelve y valida una única vez al crear el experimento, se persiste en `ExperimentRun.modelConfig` y es inmutable para sus repeticiones; si modelo/esfuerzo son incompatibles la creación falla antes de crear el run. Corridas históricas con `modelConfig` NULL siguen resolviéndose al ejecutar. La auditoría de código mostró que `createRun` ya resolvía al crear; la brecha real era que un replay con la misma `Idempotency-Key` re-resolvía con el entorno actual. Corrección: hook `prepare` en `IdempotencyService.run` (solo creaciones nuevas). Pruebas: una sola resolución, falla previa a la creación con el proveedor real, repeticiones con la config persistida aunque cambie el entorno, replay sin re-resolver.
2. **Aprobada.** Un modelo/combinación fuera de `LLM_SUPPORTED_COMBINATIONS` falla con `REASONING_EFFORT_UNSUPPORTED`, sin fallback. El código no registra esfuerzos de `gpt-6-luna` (solo el nombre por defecto; la lista está vacía por defecto). No se llamó a la API de OpenAI.
3. **Aprobada.** `EXPERIMENT_LLM_MODEL` aplica solo al experimento RAG vs GENERALIST_AGENT; el flujo de producto conserva su configuración.
4. **Aprobada.** Referencia técnica: definiciones instaladas del SDK OpenAI 7.8.0; Context7 no obligatorio; los tipos del SDK no sustituyen la validación real de `gpt-6-luna`.

## Validación de la migración (condición de cierre)
PostgreSQL local desechable 14.18 (Homebrew; no había 16 ni pgvector), solo 127.0.0.1:54329, sin tocar producción ni Supabase. `prisma migrate deploy` falla en la primera migración por falta de pgvector (esperado), así que se aplicó el historial con `psql` sobre una copia con un shim documentado (sin `CREATE EXTENSION vector`, `vector(1536)` como `real[]`, sin índice HNSW). La migración objetivo se aplicó desde el archivo original, sin shim, sobre un esquema con filas previas: `modelConfig` es `jsonb` nullable sin default, las filas previas quedan NULL y se escribe/lee JSON. `prisma migrate diff` no reporta diferencias en `experiment_runs`. Cluster detenido y directorio borrado. Limitaciones: motor psql en vez de Prisma, PG 14 en vez de 16, shim de pgvector.

## Precondiciones de despliegue abiertas (no bloquean el cierre local)
- Validar contra el runtime/API los esfuerzos efectivos de `gpt-6-luna` y cargarlos en `LLM_SUPPORTED_COMBINATIONS` antes de habilitar experimentos; sin ellos la creación falla con `REASONING_EFFORT_UNSUPPORTED`.
- Aplicar y validar la migración en el PostgreSQL real (con pgvector) antes de desplegar.

## Observaciones menores (sin decisión pendiente)
- `LLM_SUPPORTED_COMBINATIONS` se revalida en cada llamada; quitar una combinación a mitad de un experimento hace fallar las repeticiones restantes con error tipado.
- Los precios `LLM_*_COST_PER_1K_TOKENS` se leen por repetición; no forman parte de `modelConfig`.

Esta evidencia no autoriza push, PR, merge ni despliegue.
