# WI-CORE-075 — cierre
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

Resultado: documentada la regla de esfuerzo de prueba y de evidencia sobre la configuración única del LLM, según el alcance aprobado por el usuario el 2026-10-21 (solo documentación; sin salvaguardas B/C/D ni cambios de código). Carril `lane: FAST` (`contractImpact=false`, `publishesContract=false`). Commits: documentación `180248d` y el de cierre.

- **Qué quedó escrito** en `spec/transversal/providers/spec.md` (sección «WI-CORE-075») y `spec/features/008-experimental-comparison/spec.md` (sección «Corridas de prueba y corridas de evidencia»): `gpt-6-luna` con esfuerzo `low` = prueba económica y `medium` = evidencia oficial (piloto, confirmatorio OE5, OE2) congelada por protocolo (tesis 3.3 y Anexo K, por referencia); no se mezclan; el `modelConfig` persistido de cada `ExperimentRun` (`model.reasoningEffort` en `GET /experiments/{id}`) identifica la corrida, no el entorno vigente; sin marca, aviso ni bloqueo automáticos (la verificación es del operador: entorno en `medium` antes, esfuerzo del Run después, corrida corta tras cambiar el esfuerzo); `gpt-5.4-nano` descartado y los experimentos `07b20829` y `924e38ab` (2026-10-13) como antecedente histórico no comparable.
- **Revisión independiente (`reviewer`):** APPROVED, ciclo 1 de 2, sin bloqueantes; exactitud verificada contra el código (grep confirma que no existe ninguna marca de evidencia); dos precisiones opcionales incorporadas (`wi-core-075-independent-review.md`).
- `contract-reviewer`: no aplica. Contract Sync: sin eventos (sin impacto de contrato); checkpoints `start`, `implementation-delivery`, `before-review` y `before-done` sin relevantes pendientes.
- `retryLimitRespected`: 0 ciclos de corrección de 2 permitidos.

Fuera de alcance: salvaguardas B (aviso), C (marca persistida) y D (bloqueo): se descartaron; si el usuario las quisiera después, serían un WI nuevo. Sin push, PR ni merge; sin tag.
