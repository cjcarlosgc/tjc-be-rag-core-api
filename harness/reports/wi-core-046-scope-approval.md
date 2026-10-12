# WI-CORE-046 — aprobación de alcance
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Fecha:** 2026-10-12 · **Autoriza:** Jean (Human Reviewer), directamente en el chat de Core: «1: mensaje genérico veraz (Recomendado)» (texto de OC11) y «Sí, cerrar y empezar 046 y 048».

## Alcance
- Compare del PR `UNVERIFIABLE`: el Run termina `INFRASTRUCTURE_FAILURE` con Check `neutral` y `resultSummary` textual del contrato (INTEROP-2.10 §6.10): «No se pudo verificar el compare de GitHub (por ejemplo, un PR con 300 o más archivos); análisis no realizado». No afirma que sean 300 archivos. El job no relanza el error en ese caso; los demás errores de GitHub conservan su comportamiento.
- Confinado al análisis de PR (`snapshot-intelligence/snapshot-analysis-job.handler.ts`; `github-app/github-repository-content.service.ts` solo para distinguir la causa). Sin tocar experimentos (008), OE2/OE5, evidencia, métricas ni `sandbox/map-sandbox-result.ts`; sin cambio de contrato, DTO ni migración; sin build en `app/`.
- Prueba roja-verde; `tsc` contra HEAD limpio en worktree (delta 0 por archivo), vitest completo, oxlint, validate-harness y tests de harness.
