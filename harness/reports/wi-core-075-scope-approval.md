# WI-CORE-075 — aprobación de alcance
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Procedencia:** mensaje escrito directamente por el usuario en el chat de la sesión Core, el 2026-10-21.

Cita literal del usuario: «Apruebo WI-CORE-075 como solo documentación: spec de proveedores y de experimentos con la regla gpt-6-luna low = prueba, medium = evidencia, congelado por protocolo (tesis 3.3, Anexo K), sin salvaguardas B/C/D ni cambios de código.»

## Alcance aprobado

Documentar en `spec/transversal/providers/spec.md` y en `spec/features/008-experimental-comparison/spec.md` la regla `gpt-6-luna` con esfuerzo `low` = prueba económica y `medium` = evidencia oficial congelada por protocolo (tesis 3.3 y Anexo K, por referencia), que no se mezclan, que cada `ExperimentRun` persiste modelo y esfuerzo en `modelConfig`, que `gpt-5.4-nano` queda descartado (experimentos `07b20829` y `924e38ab` solo como antecedente). **Sin** salvaguardas B (aviso), C (marca persistida) ni D (bloqueo), **sin** cambios de código, contrato, migración ni DTO. Carril `lane: FAST` (documentación, `contractImpact=false`, `publishesContract=false`); el `reviewer` independiente se mantiene. Sin push, PR ni merge; sin tag.
