# WI-CORE-086 — registrar en la propuesta CT las decisiones D-3, D-4, D-6, D-7, D-12 y D-13 (FAST documental)
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Procedencia:** mensaje escrito directamente por el usuario en el chat de Core el 2026-10-24: «Apruebo una sola ronda INTEROP-2.20 / GH-INTEROP-1.9 con el esquema canónico de CT-01, la errata E-01, SYSTEM-2.15 (tjc-piloto-ventas) y la corrección de sandbox-result.failed.json. No oracleRef. Los pilotos corren sobre forks míos con la App instalada. Acepto tus recomendaciones D-3, D-4, D-6 y D-7. Continúa.»

## Alcance

Solo texto en `harness/reports/arch-v1.0-aserciones-ct-propuesta.md` (producto de WI-CORE-082/083): mover D-3, D-4, D-6 y D-7 de «Pendientes» a «Decisiones tomadas por el usuario» con la recomendación aceptada; añadir **D-12** (una sola ronda de contratos: esquema canónico de CT-01, E-01, SYSTEM-2.15 y corrección del ejemplo `sandbox-result.failed.json`; sin `oracleRef`) y **D-13** (los pilotos corren sobre forks del usuario con la GitHub App instalada); ajustar las aserciones y la tabla resumen que dependían de esas decisiones (CT-02 nota, CT-04-A2, CT-10 discrepancia, columna «Decisiones abiertas», orden sugerido). Sin cambios en `app/`, contratos, esquemas, tesis, Full Paper ni `AGENTS.md`.

## Qué NO se decide aquí

- La cuenta dueña de los forks (personal u organización): el usuario dijo «forks míos» sin precisar; afecta al workspace del Project y al impacto del fallo de `ACCESS_REVERIFY` (solo organizaciones). Queda como detalle abierto para cross/usuario.
- El workspace del Project = dueño de los forks y el binding creado antes de abrir el PR son **consecuencias verificadas en el código** (WI-CORE-085), no decisiones nuevas.
- La ejecución de la ronda de contratos es `WI-CORE-079` (reactivado, alcance ampliado); este WI solo deja las decisiones registradas.
