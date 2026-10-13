# Cierre — WI-CORE-052
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-13 (según el coordinador) · **Estado:** `W-DONE` · **Subtarea:** ST-CORE-059 · **Caso:** OC04

## Validación
Cerrado bajo el Modo fuera de casa (`awayMode` activo): lo valida la revisión independiente delegada `harness/reports/wi-core-052-independent-review.md` (agente `reviewer`, ciclo 1 de 2, APPROVED, 4 mutantes detectados, sin blockers ni decisiones abiertas). Alcance aprobado por el usuario: «Sí, WI de constructs PHP ya». El usuario es informado y puede reabrirlo. No autoriza push.

## Qué entrega
El job de snapshot calcula `behaviorConstructs` también para símbolos PHP (sin el condicional `!isPhp`; el extractor y el evaluador de `WI-CORE-032` ya existían), respetando `projectRoot`; OC04 documenta que PHP queda cubierto. Código en `379e16d2732a3f08a3d64286c390b928ea996296`; evidencia `harness/reports/wi-core-052-technical-checks.md`. Sin tocar experimentos, OE2/OE5, evidencia, métricas ni contratos.

## Riesgos y notas
- Una lectura adicional a GitHub por archivo PHP cambiado; un fallo termina el Run `INFRASTRUCTURE_FAILURE` como en TypeScript; los PRs PHP con construcciones nuevas pasan a `ACTION_REQUIRED` (esperado por `DEC-FK-003/004`) y necesitan respuesta de Maintainer/Admin.
- F1: el constructor PHP no genera pregunta (`Clase.constructor` frente a `__construct`): registrado como `IDEA-024`. F2 (CHANGELOG y ST) resuelto en este cierre. `POTENTIALLY_IMPACTED` para PHP no está aprobado.
