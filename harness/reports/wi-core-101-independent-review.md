# WI-CORE-101 — revisión independiente
Modelo: reviewer · configurado claude-sonnet-5-5 · atendido claude-sonnet-5-5 · esfuerzo medium

Ciclo 1 de 2. Veredicto: **APPROVED** (con 2 hallazgos LOW para el cierre).

## Alcance confirmado
`git diff --stat -- app/src`: 3 ficheros modificados (zip-extraction.service.ts, materializer + spec) más 2 nuevos (util + spec). Sin cambios en handlers, contratos, DTO, enum, ErrorCode, env ni migración. Los handlers no cambian.

## Verificado directamente
1. Núcleo: `Promise.allSettled` espera a todas las escrituras del lote; `results.find` relanza el primer rechazo en orden de lote, la misma instancia (`rejects.toBe(originalError)`), sin envolver. Los lotes siguientes no se lanzan tras el fallo (el `throw` sale del bucle). Sin error, mismo orden, concurrencia 8 y filtros. El handler de snapshot no reclasifica el error de `materialize` (solo el de `compare`), por lo que se conserva la clasificación actual.
2. `removeWorkspaceDir`: try/catch total, nunca lanza; aviso con solo el código. `maxRetries: 3, retryDelay: 100` con `force: true` en Node 22 es válido (rm reintenta EBUSY, EMFILE, ENFILE, ENOTEMPTY, EPERM con backoff lineal 100+200+300 ms, peor caso ~0,6 s si el fallo es persistente, algo sobre el ~0,3 s previsto; irrelevante en la práctica). Ver LOW-2.
3. Aviso en `warn` es adecuado; el riesgo de acumulación en /tmp existe pero es visible por el aviso.
4. Zip: solo cambia la limpieza; la extracción y validación de rutas no cambian.
5. Mutaciones propias (14 tests de los 2 specs): relanzar `new Error(String(reason))` falla (3); saltarse limpieza del catch falla (2); cleanup con `rm` directo falla; catch con `rm` directo falla (1); ignorar `rejected` falla (4). Volver a `Promise.all` falla 5/5 (determinista, 2 pruebas). **Sobreviven:** M2 (lanzar el último rechazo en vez del primero) y las dos del zip (quitar limpieza del catch, `cleanup` vacío) pues no hay spec del servicio zip. Todos los ficheros restaurados (`cmp` y `git diff --stat` idénticos).
   Los mocks de `node:os` y `node:fs/promises` son por fichero de test (vitest aísla módulos) y se restauran en `afterEach`; el caso (d) prueba lo que dice (cleanup no lanza con rm fallando).
6. Alcance: sin reintento ni política nueva; CHANGELOG no afirma resolver la causa de fondo.
7. Estilo: lint sin errores; `tsc --noEmit` solo reporta en los ficheros del WI el error preexistente de `disabledReason` en el `binding` del spec (el bloque no cambió respecto de HEAD).
8. Suite completa: 185 ficheros pasan | 10 omitidos; 3147 pasan, 121 omitidos, 0 fallos.

## Hallazgos
- LOW-1: sin prueba que distinga primer vs. último rechazo (mutación M2 sobrevive) ni cobertura de `ZipExtractionService` (mutaciones Z sobreviven). Opcional: caso con dos descargas fallidas en el mismo lote y espera del primero; spec mínimo del zip.
- LOW-2: peor caso de reintentos ~0,6 s (100+200+300 ms) frente a ~0,3 s previsto; aceptable, o bajar `maxRetries` a 2 si se quiere ceñir.

## No verificado
Comportamiento en Render real ni el motivo de fondo de la descarga fallida; no se ejecutó BD ni se leyó `.env`.
