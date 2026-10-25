# WI-CORE-096 — alcance propuesto: indexación por lotes (memoria acotada) — DESCARTADO
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Estado:** DESCARTADA por decisión del usuario (2026-10-25, relayada por cross, no confirmada directamente en el chat de Core): orm se sustituye y los demás repos son 15–35× menores; WI cancelado (`W-CANCELLED`), nada implementado. La propuesta y la medición se conservan como referencia. Origen: Core (Render free, 512 MB) murió por `JavaScript heap out of memory` al indexar `rag-tesis-org/orm` (2026-10-24 22:06:38 UTC) y el usuario pidió (2026-10-25, relayado por cross) un WI para que Core indexe repos más grandes en el plan gratuito. La aprobación de alcance es del usuario, en el chat de Core.

## 1. Problema y evidencia

- Log de Render (instancia `[Nest] 73`): `Mark-Compact 242.9 (258.9) → 241.9 (258.7) MB, allocation failure` y `FATAL ERROR: Ineffective mark-compacts near heap limit`. Límite efectivo del heap de V8 ≈256 MB; conjunto vivo ≈242 MB. Reinicio en 32 s; el job `snapshot-analysis` quedó `RUNNING` huérfano (no está en `RELEASABLE_UNKEYED_JOB_TYPES`).
- Causa en código (`snapshot-analysis-job.handler.ts`): se parsean todos los archivos, se llama una vez a `embedMany` con TODOS los textos (`openai-embedding.provider.ts` acumula `number[][]`), se crea `chunksToPersist` y solo entonces se inserta (`code-chunks.repository.ts` `insertMany`, una fila por sentencia). Los vectores completos conviven en el heap: 1 536 dobles × 8 B ≈ 12,3 KB por chunk.
- Cada Run reindexa y re-embebe el snapshot entero (el modo INCREMENTAL solo afecta a `detectSymbols`): pre-indexar fuera de Render no evita el problema.

## 2. Medición previa (emulación; no es una medición en Render)

Parser real de Core (`PhpParserService`, dist) sobre un clon de `rag-tesis-org/orm` `e6dfa8a`; vectores sintéticos de 1 536 dobles; `--max-old-space-size=256`; sin la base de Nest/Prisma:

| Chunks | Actual: pico heap / RSS | Por lotes de 96: pico heap / RSS |
|---:|---|---|
| 3 335 | 78 MB / 201 MB | 46 MB / 165 MB |
| 4 876 | 91 MB / 215 MB | 52 MB / 176 MB |
| 11 152 (orm completo) | 178 MB / 309 MB | 75 MB / 198 MB |

Pendiente por chunk: ≈12,7 KB actual frente a ≈3,8 KB por lotes. Base de Nest/Prisma inferida del log del crash (242 − 178): ≈64 MB (inferencia, no medición). `money` (709 chunks) quedó muy por debajo del límite.

## 3. Alcance propuesto (opción «a»)

Dentro:
- `snapshot-analysis-job.handler.ts`: crear la `ProjectVersion` (`createPending` + `markStarted`) ANTES de embeber; embeber e insertar por lotes (lote = el de `embedMany`, 96) y soltar los vectores de cada lote; `detectSymbols` y los `testTargets` usan solo metadatos de los chunks (sin vectores). El resultado final (filas de `code_chunks`, orden, contenido, vector por chunk, `completeAndPromote`) es el mismo que hoy.
- `code-chunks.repository.ts`: inserción por lote y borrado de los chunks de una versión (limpieza de fallo parcial).
- Política de fallo parcial: un fallo del embedding, de una inserción o de cualquier paso posterior → `ProjectVersionsRepository.markFailed(version, motivo)` + borrado de sus chunks parciales + el camino de fallo del Run ya existente (`INFRASTRUCTURE_FAILURE`, Check). Hoy nadie llama a `markFailed` en este flujo.
- Sin variable de entorno nueva (lote constante); sin cambio de `EmbeddingProvider`, modelo ni dimensiones.

Fuera:
- Contratos (rutas, DTO, enums, eventos, esquemas) y otros repos: sin impacto contractual esperado (se confirma en la revisión contractual del WI, `contractImpact: false`).
- Chunking/parseo, recuperación, Validation (el job de Validation re-materializa y comprime el workspace; no se modela aquí), Sandbox, Console.
- Recuperación de un proceso caído a medio indexar (sigue sin reanudarse solo; `snapshot-analysis` no es liberable por diseño) y limpieza de versiones huérfanas por crash; se declara como riesgo residual.
- Plan de Render, `NODE_OPTIONS`, e inserción multi-fila (rendimiento, no memoria).

## 4. Pruebas y evidencia de aceptación

- Orden y tamaño de las llamadas (doble de proveedor): `embedMany` nunca recibe más que un lote y cada lote se inserta antes de pedir el siguiente; los vectores de un lote no sobreviven al siguiente (comprobación determinista por conteo, sin depender del GC).
- Equivalencia: con un proveedor determinista, las filas finales (orden, contenido, vector asociado a su chunk) son idénticas a las de la implementación anterior.
- Fallos: embedding que falla en el lote k, inserción que falla a mitad, y fallo posterior a la inserción → `markFailed`, chunks parciales borrados, Run `INFRASTRUCTURE_FAILURE`, sin versión huérfana no terminal.
- Pico de memoria: script de medición (sin red ni BD) con parser real y proveedor sintético sobre `money` (709 chunks) y una referencia de ≈3 000–5 000 chunks y otra de 11 152 (orm), con `--max-old-space-size=256`; resultados en el informe de cierre. Opcional, a decidir por el usuario: medición en Render con un repo real de ≥15 000 chunks.
- Lint, build, test del repo en verde; revisión independiente (`reviewer`).

## 5. Techo esperado en free 512 MB (derivado, a confirmar)

| | Hoy | Tras el WI |
|---|---|---|
| Heap por chunk | ≈12,7 KB | ≈3,8 KB |
| Chunks por límite de heap (256 MB − base ≈64 MB) | ≈9 000 (orm, 11 152, ya excede) | ≈40 000 solo por heap |
| Techo de trabajo que propongo comunicar | ≈9 000 chunks (≈4,6 MB de PHP) | ≈20 000–25 000 chunks (≈10–13 MB de PHP), con margen ×2 por lo no modelado (símbolos, targets, RSS real de Nest) |

Lectura: repos de 3 000–5 000 chunks ya caben hoy (pico emulado 78–91 MB + base ≈64 MB < 256 MB); el WI es robustez y capacidad para repos como orm, no un requisito para los pilotos si orm se sustituye por un repo menor.

## 6. Cambios de proceso y decisiones

- Carril STANDARD, `contractImpact: false`, historia HU03 (índice liga chunks y embeddings al commit); subtarea `ST-CORE-113` en `spec/features/002-project-version-indexing/tasks.md`. Sin migración de BD.
- Consecuencia para el tag: Core cambiará antes de `arch-v1.0` (decisión del usuario, 2026-10-25); el SHA de la línea base incluirá este WI.
- A decidir por el usuario: (1) aprobar este alcance para empezar; (2) si quiere la medición opcional en Render.
