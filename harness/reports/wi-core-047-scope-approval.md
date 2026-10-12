# WI-CORE-047 — aprobación de alcance
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-12 · **Autoriza:** Jean (Human Reviewer), vía el chat de Core.

## Decisión consolidada: DEC-VAL-002 APROBADA
- Pregunta del coordinador al usuario: «DEC-VAL-002 tiene dos versiones tuyas que se contradicen. ¿Cuál es la vigente?». Respuesta textual: «La recomendada, sin afectar métricas».
- Cita relayada por Cross en su chat: «Si son decisiones técnicas puramente… no van a afectar a la medición, a las métricas… 1 aprobado, DEC-VAL-002 recomendada, 3 aprobado».
- Existió una redacción directa anterior del usuario (el fallo de plataforma por encima de cualquier clasificación parcial, incluido `BEHAVIORAL_MISMATCH`) que el usuario descartó; no tiene efecto.
- Regla aprobada: precedencia `BEHAVIORAL_MISMATCH` > `TECHNICAL_GENERATION_FAILURE` > `INFRASTRUCTURE_FAILURE` > `SUCCESS` > `NO_ADDITIONAL_TESTS_REQUIRED`/`NO_TEST_RELEVANT_CHANGES`, con la definición de fallo de plataforma por símbolo y la razón de la propuesta publicada en `30b9acd`.
- **Condición del usuario:** el cambio queda confinado al análisis de PR y no puede alterar experimentos (008), OE2/OE5 ni la evidencia o métricas existentes; si hubiera que tocar `sandbox/map-sandbox-result.ts` (compartido por 005 y 008), prueba de no regresión explícita sobre experimentos o no se toca; si afecta métricas, `DECISION_REQUIRED`.

## Alcance
SYSTEM-2.10: `DEC-VAL-002` pasa de PROPOSED a APROBADA (se retiran A2/A3 como no elegidas; se actualizan la línea «Ver DEC-VAL-002» y el estado vigente); corrección de la cita `INTEROP-2.8` en `system-contract.md` l.68; INTEROP solo si el contract-reviewer lo exige. Contract Sync a console y github-integration (Sandbox solo si el contenido le afecta). Sin `app/`.
