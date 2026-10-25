# WI-CORE-098 — cierre
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Resultado: G-01 V1 (regla D-5 «contexto insuficiente», CT-05-A5) y G-03 (texto neutral del 422 de temperature) implementados sin cambio de contrato, DTO, enum, `ErrorCode`, evento, esquema, variable de entorno ni migración.

- **Compuerta:** `app/src/generation/context-sufficiency.ts` (`InsufficientGenerationContextError`, `assessContextSufficiency`); `acquireGenerationContext` la aplica solo si recibe `sufficiency` (sin él, comportamiento idéntico). Bloquea si el target no tiene código o si ningún candidato supera el mínimo Y faltan reglas funcionales requeridas del símbolo; cada cláusula sola no bloquea.
- **Validation:** propuesta HELD sin LLM ni Sandbox; el símbolo es `TECHNICAL_GENERATION_FAILURE` no de plataforma (el Run no pasa a `ACTION_REQUIRED`: la variante V2, con pregunta, queda declarada como limitación, y contradice la redacción de CT-05-A5).
- **Experiments:** pre-chequeo único por experimento, antes de snapshot, pares e intentos; si bloquea, el experimento termina `FAILED` («Contexto insuficiente…») con cero repeticiones, sin LLM ni Sandbox y sin reintento del job. Paridad entre brazos por construcción; es un caso no evaluable para OE5 (no entra en CF/CO/VT) y no se reintenta.
- **G-03:** texto neutral respecto del proveedor, mismo código, 422 y `details`.
- **Riesgo residual declarado (spec 004, 008, CHANGELOG):** puede sobre-bloquear cuando coinciden cero candidatos sobre el mínimo (con `RETRIEVAL_MINIMUM_SCORE=0`, cero candidatos recuperados) y reglas requeridas faltantes (p. ej. pregunta histórica sin regla); en Experiments la cláusula de reglas solo opera si se localiza el símbolo del AnalysisRun.

Verificación (leader): `lint` exit 0, `build` exit 0, `test` 3007 pasan y 104 omitidos, 0 fallos (base 2981 + 26 pruebas nuevas); los cuatro validadores del Harness en verde.
Implementación: `implementer-high` (escalada decidida por el leader), servido por `claude-haiku-5-5` (declarado). El leader ajustó 3 aserciones de conteo de `experiment-job.handler.spec.ts` por el +1 del pre-chequeo.
Revisión independiente (`reviewer`): APPROVED en el ciclo 1 de 2, sin hallazgos HIGH ni MEDIUM; 4 LOW aplicados en el cierre: L1 línea en spec 008 sobre la localización del símbolo, L2 tipos de los fixtures de `context-sufficiency.spec.ts` (`tsc` sin errores en ese fichero), L3 línea en blanco sobrante, L4 subtareas ST-CORE-115 y ST-CORE-116 a hecho. Cuatro mutaciones manuales del revisor hicieron fallar pruebas.
`retryLimitRespected`: 0 ciclos de corrección de 2 permitidos.
Publicación: commit local; saldrá a `develop` con el lote de WI-CORE-099/100 bajo la autorización permanente.
