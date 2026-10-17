# WI-CORE-041 — Verificación SDD

Modelo: sdd-analyst · configurado gpt-6-luna · atendido unknown · esfuerzo high

## Handoff

- **status:** SPEC_VERIFIED
- **findings:** El alcance registrado en `WI-CORE-041` / `ST-CORE-048` es consistente con la regla normativa: solo el nombre base exacto y case-sensitive `composer.json` identifica un candidato PHP. El cambio corrige la implementación para que materialización, pool y resolución de raíz apliquen esa misma regla; no cambia comportamiento aprobado, contrato ni API.
- **blockers:** Ninguno. `DEC-PHP-ROOT-001` solo bloquea la selección de raíz cuando hay más de un candidato canónico; no bloquea esta corrección. El PULL de Contract Sync `start` para WI-CORE-041 pasó y no reporta eventos pendientes relevantes.
- **filesAffected:** `app/src/snapshot-intelligence/github-snapshot-materializer.service.ts`, `app/src/snapshot-intelligence/github-snapshot-materializer.service.spec.ts`, `app/src/project-versions/indexing.constants.ts`, `app/src/project-versions/indexing.constants.spec.ts`, `app/src/snapshot-intelligence/snapshot-analysis-job.handler.ts`, `app/src/snapshot-intelligence/snapshot-analysis-job.handler.spec.ts`, `app/src/project-versions/project-root.util.ts`, `app/src/project-versions/project-root.util.spec.ts` (confirmar el conjunto real al implementar; minimizar los sitios que no necesiten cambio).
- **evidence:** Revisión de `spec/features/019-project-root-detection/{spec.md,plan.md,tasks.md}`, `spec/features/018-php-laravel-support/spec.md`, `spec/features/002-project-version-indexing/spec.md`, `spec/contracts/system-contract.md`, `spec/contracts/interoperability-contract.md`, `harness/work-items.json`, `harness/state.json` y `harness/contract-sync/README.md`; `node harness/validate-harness.mjs` pasó; `node harness/contract-sync.mjs check --checkpoint start --work-item WI-CORE-041` pasó.
- **recommendedNextStep:** Puede comenzar Implementer con el alcance ya aprobado. Tras el cambio, correr regresiones dirigidas y gates completos antes de revisión independiente.

## Criterios precisos de regresión

1. Materializar un tree mixto con `COMPOSER.JSON`, `.ts`, `package.json` y configuración TS/Jest/Vitest: la clasificación debe seguir el pool TypeScript e incluir fuentes/configuración TS; el nombre variante no debe iniciar el pool PHP ni dejar el snapshot sin fuentes.
2. Discovery/resolución de raíz sobre un snapshot que contiene `COMPOSER.JSON` más fuentes TS debe devolver cero candidatos canónicos y no seleccionar `projectRoot` PHP. La ejecución conserva el camino legacy TypeScript desde `.`.
3. `composer.json` exacto en raíz sigue seleccionando el pool PHP y raíz `.`; `backend/composer.json` exacto sigue seleccionando el pool PHP y `backend` como raíz única.
4. La detección de múltiples manifiestos continúa contando solo marcadores exactos; dos `composer.json` canónicos no deben seleccionar raíz y mantienen el parking existente por `DEC-PHP-ROOT-001`. No cambiar esta política.
5. Añadir cobertura a la función común de selección de pool/discovery para evitar divergencia entre el `isPhpPoolFile` actual (regex case-insensitive) y los detectores de candidato actuales (lowercase antes de comparar).

## Riesgos / límites

- La inconsistencia confirmada abarca cuatro puntos: el materializer activa PHP con `toLowerCase()`, `isPhpPoolFile` acepta manifests con regex `/i`, el handler cuenta candidatos con `toLowerCase()` y `resolveUniqueComposerRoot` hace lo mismo. Corregir solo el materializer evitaría el snapshot vacío del caso observado, pero dejaría falsas raíces/candidatos si un archivo variante llega por otra ruta.
- `fileDiscoveryService` opera sobre los archivos ya materializados y usa el pool general. Debe verificarse que `COMPOSER.JSON` no se convierta por sí solo en fuente relevante tras el cambio; no se debe alterar parsing fuera de los criterios del WI.
- No se modifica `spec/`, contrato compartido, DTOs, rutas, Sandbox ni otros repositorios. `syncScopePaths` del WI apunta al espejo INTEROP pero `contractImpact=false`; no publicar Contract Sync para una corrección local sin impacto contractual.
- No decidir el comportamiento de varios candidatos ni extender el alcance a otras reglas de sensibilidad a mayúsculas de nombres de archivos.
