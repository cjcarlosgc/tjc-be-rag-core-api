# WI-CORE-027 — revisión de contrato, corte D (StrategyMetricsResponse nulable) y hallazgo IDEA-017

Modelo: contract-reviewer · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo low

Veredicto: CHANGES (correcciones menores de texto, ninguna de código; sin bloqueo de decisión).

Alcance revisado: `c96e1e8` (INTEROP) contra `55e3ec9` (código) y `2d203cb` contra `275f687`. Solo lectura; no se editó INTEROP.

## 1. INTEROP (c96e1e8) vs código (55e3ec9)

Coincide:

- Campos y tipos de `StrategyMetricsResponse` (§6.5): `evaluableRepetitions`, `nonEvaluableRepetitions` (`number`); `validRate`, `compilationRate`, `executionRate`, `passedRate`, `generationDurationMs`, `executionDurationMs`, `totalDurationMs` (`number | null`); tokens, costo, chunks, herramientas y archivos sin cambio.
- Contadores: `evaluable = vigentes con technicallyEvaluable !== false`, `nonEvaluable = resto`; suma = vigentes de la estrategia; pre-OE5 (campo ausente) = `n/0`; estrategia sin filas = `0/0` y métricas `null`.
- `executionDurationMs` = media de no nulos de las evaluables, `null` si ninguna invocó el Sandbox (mean() devuelve null sobre cero no nulos + `roundOrNull`). La no evaluable no cuenta.
- `failures` vacío con 0 evaluables; `passedRate: 0` real con evaluables>0.
- `ExperimentRepetitionResponse` sin claves nuevas (§6.5 no cambia sus claves; prueba de forma en el commit).
- Línea de estado 14, §6.13 y §8 son coherentes con el estado real (trace y las tres rutas `/evidence` en Core; Console consume en WI-CONSOLE-017/-020).
- Nota IDEA-015 (saneado de `errorSummary`/`failureSummary`, `failure.category` desconocido -> `UNKNOWN`, forma sin cambio) coincide con el mapeo de `getResults` (`sanitizeFailureMessage` idempotente sobre filas previas).
- §6.16 congelado en `2d203cb` coherente con `275f687`: `sandbox[].durationMs` = duración de la llamada (= `executionDurationMs` de la repetición, `null` si no registrada o negativa, `0` observado se conserva), sin entrada `sandbox[]` si no hubo invocación, y la aclaración «una duración que no pudo medirse es `null`» respalda `clampDuration` devolviendo `null` ante negativos. Sin diferencias de forma ni de `schemaVersion '1'`.

Discrepancias (texto exacto de corrección propuesto):

D1. §6.5 (interface `StrategyMetricsResponse`) y prosa de «Semántica observable», alcance de la condición `null` de duraciones. El código devuelve `null` en `generationDurationMs` y `totalDurationMs` también cuando hay evaluables pero ninguna tiene el valor (media de no nulos), no solo con `evaluableRepetitions = 0`. El texto dice «null si evaluableRepetitions = 0». Corrección:

- Línea ~287: `generationDurationMs: number | null // media de los valores no nulos de las repeticiones evaluables; null si ninguna lo registró (siempre null si evaluableRepetitions = 0)`
- Línea ~289: `totalDurationMs: number | null // ídem`
- En la viñeta de semántica, reemplazar «Cuando `evaluableRepetitions` vale `0`, las tasas y las medias de duración (`generationDurationMs`, `executionDurationMs`, `totalDurationMs`) valen `null`» por «Cuando `evaluableRepetitions` vale `0`, las tasas y las medias de duración (`generationDurationMs`, `executionDurationMs`, `totalDurationMs`) valen `null`; con evaluables, cada media de duración es la de los valores no nulos y es `null` si ninguna repetición evaluable lo registró».
- Y la frase «Un `0` ... significa cero real sobre al menos una repetición evaluable» queda válida.

D2. Mismo bloque, la frase «`nonEvaluableRepetitions` ... no cuenta intentos superados»: el agregador recibe las repeticiones vigentes; es consistente, pero el texto afirma «una por slot, su último intento; 3 en un experimento completo». Verificar que `getResults` solo pasa vigentes (la prueba mezcla 2/1 usa una fila por slot y no ejerce un intento superado). Si el implementer no tiene una prueba con `attempt` superado, añadir la prueba o rebajar la frase a «las repeticiones vigentes devueltas». No es discrepancia de forma; es evidencia faltante (nivel nota).

D3 (fuera de INTEROP, informativa). `spec/features/008-experimental-comparison/plan.md:66` y la nota de obligación heredada en `harness/work-items.json` (~línea 1444) aún dicen «con cero slots evaluables las tasas valen `0`». Deben actualizarse en la consolidación de WI-CORE-027 para no contradecir §6.5.1.

No hay discrepancia en nombres, tipos de contadores ni en la interpretación de `executionDurationMs`.

## 2. IDEA-017 (`generationDurationMs ?? 0` y `totalDurationMs ?? 0` por repetición)

Veredicto: WI aparte, no dentro de WI-CORE-027.

Motivo:

- Es un cambio de tipo (`number` -> `number | null`) en `ExperimentRepetitionResponse`, un DTO ya emitido a Console; es breaking para un consumidor tipado estricto, igual que lo fue `executionDurationMs` en WI-CORE-025. Exige Contract Sync propio, versión de DTO/nota en §6.5 y entrega al consumidor.
- DEC-EVID-001 y los contadores de WI-CORE-027 cubren `StrategyMetricsResponse` y el bundle de evidencia; el alcance aprobado del corte D declaró que `ExperimentRepetitionResponse` «no cambia» (hay una prueba de forma que lo fija). Añadirlo ahora reabre un alcance ya aprobado y ya publicado (CS-CORE-20261009-014/-015 con breaking true).
- No bloquea la corrección de las medias: el agregador ya lee los valores crudos y los ignora si son null, por lo que sus resultados no dependen del `?? 0` de la repetición. El `0` por repetición es cosmético para el consumidor, no corrompe agregados ni evidencia (el bundle ya emite `null`).
- Un WI aparte permite que Console decida su corte de tolerancia a `null` sin atar el cierre de WI-CORE-027.

Alcance mínimo del WI aparte (propuesta, sin aprobación):

1. Spec: en §6.5 `ExperimentRepetitionResponse` cambiar `generationDurationMs: number` y `totalDurationMs: number` a `number | null` con comentario «null si no se observó (p. ej. fallo antes de generar o fila previa); nunca 0 inventado»; nota en §6.5.1 y CHANGELOG. Versión documental: aditiva sobre INTEROP-2.7 (en la misma línea que `executionDurationMs`); decidir si exige bump si el consumidor ya publicó.
2. Código: `experiment.response.ts` tipos a `number | null`; `experiments.service.ts` líneas ~300 y ~302 quitar `?? 0` (emitir `repetition.generationDurationMs` / `totalDurationMs` tal cual).
3. Pruebas: fila con duraciones `null` emite `null`; fila con `0` real emite `0`; las medias de `StrategyMetricsResponse` no cambian.
4. Contract Sync: CS hacia Console (breaking true), mismo patrón que WI-CORE-025; preguntar al usuario antes de enviar el handoff.
5. Registrar el WI en `harness/work-items.json` enlazado desde `ST-CORE-NNN` de la feature 008; IDEA-017 pasa a I-APPROVED/linked solo con aprobación del usuario.

Nota de consistencia: mientras IDEA-017 siga abierta, §6.5 debe seguir diciendo `number` en esos dos campos (ya lo dice) y la frase «un valor no observable es null» de §6.5 queda como excepción documentada para las duraciones por repetición; sugerida una línea en la nota de §6.5.1: «`generationDurationMs` y `totalDurationMs` de `ExperimentRepetitionResponse` conservan `0` cuando no se observaron hasta IDEA-017».

## Resumen

- CHANGES: aplicar D1 (texto), cubrir D2 (prueba o rebajar frase), D3 en la consolidación.
- IDEA-017: WI aparte con el alcance anterior; no requiere decisión nueva salvo la elección de versionado documental.
