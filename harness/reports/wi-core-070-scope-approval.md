# WI-CORE-070 — aprobación de alcance
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Procedencia:** aprobación escrita directamente por el usuario en el chat de la sesión Core, el 2026-10-19.

Cita literal: «Apruebo el alcance de WI-CORE-070 tal como está en harness/reports/wi-core-070-scope.md: refactor de runAttempt y pipeline compartido sin cambio de comportamiento, en dos cortes (A y B), con F3 fuera de alcance.»

Aprobado: cortes **A** (pruebas de caracterización y descomposición de `runAttempt`) y **B** (pipeline compartido en `app/src/generation/test-generation-pipeline.ts` y adopción en ambos handlers), sin cambio de comportamiento, F3 fuera.

## Adenda: corte C

Primero se registró el corte **C** (log y contador de los reintentos de GET) como no aprobado, porque la cita anterior nombra solo A y B. Después el usuario escribió en el chat «la apruebo también» y, al preguntarle cuál aprobación quedaba cubierta, eligió explícitamente **Corte C de WI-CORE-070** y **WI HARNESS retroactivo**. Quedan aprobados el corte C (único cambio observable de este WI: log sin payload ni secretos y un contador; sin cambio de reintentos, tiempos, DTO ni contratos) y el WI HARNESS retroactivo para `5fa5666` y `9945342`. El corte C se ejecuta después de A y B.
