# Cierre — WI-CORE-044
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-12 (America/Lima) · **Estado:** `W-DONE` · **Historias:** HU05, HU06, HU10, HU11 · **Subtarea:** ST-CORE-051

## Veredicto del usuario
El usuario cerró el WI directamente en el chat de Core (2026-10-12): «Sí, cerrar W-DONE», eligiendo cerrar sin añadir el caso discriminante entre las opciones que se le mostraron.

## Revisión
Agente `reviewer` por el Modo fuera de casa: ciclo 1 `APPROVED` con tres riesgos menores (`wi-core-044-independent-review.md`); el usuario ordenó corregirlos y revisar de nuevo; ciclo 2 `APPROVED`, 0 blockers y 0 importantes, 3 menores (`wi-core-044-independent-review-cycle-2.md`). `reviewCycles` quedó en 2 de 2. La revisión no sustituye la aprobación del usuario.

## Qué entrega
Constructor sin chunk (cortes 1 y 3: `METHOD`+`CONSTRUCTOR`, un solo kind ganador), símbolos de archivos de test fuera de los objetivos de generación y de preguntas (cortes 2, 4 y 5, con `isTestSourcePath` sensible al `projectRoot`) y desaparición de la ruta PHP duplicada. Commits: `4811825`, `8bea14c`, `f1c4088`, `6c44dbb`, `14af3e1`. Evidencia rojo→verde en `wi-core-044-implementation.md`. Sin cambio de contrato, DTO, Sandbox, Integration ni migraciones; sin `build` en `app/`.

## Menores y deuda
`IDEA-022` (caso discriminante del cableado de `effectiveProjectRoot`; el usuario decidió no añadirlo), `IDEA-023` (`tests/` anidados y helpers sin sufijo con `projectRoot` `.`) y la consolidación de spec (hecha en `65f0113`). El trace, la evidencia 027, los experimentos y la comparación OE2 siguen viendo los símbolos de test por contrato §6.16.

## Verificación final
vitest completo 2170 pasan / 104 omitidos; oxlint 0; `tsc` 45 en base limpia y 45 con los cortes (delta 0); e2e 246; `validate-harness` y tests de `harness/` pasan.
