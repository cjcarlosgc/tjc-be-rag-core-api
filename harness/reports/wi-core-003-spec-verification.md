# Verificación de especificación — WI-CORE-003

**Fecha:** 2026-09-25
**Analista independiente:** `/root/core_migration_analyst`
**Resultado:** `APPROVED` para iniciar la implementación del corte Core.

## Alcance revisado

- `spec/features/016-github-integration/{spec,plan,tasks}.md`
- `spec/contracts/github-integration-contract.md` (`GH-INTEROP-1.0`)
- `spec/contracts/interoperability-contract.md` y los criterios registrados en `harness/work-items.json`
- Decisiones pendientes y su campo `Blocks` en las specs canónicas.

El WI está suficientemente especificado para migrar Core. No se agregan épicas ni HU; las cuatro subtareas de `tasks.md` son cortes técnicos agrupados en este WI local. Console conserva sus rutas públicas Core→Console; GitHub Integration posee llamadas GitHub y webhook público; Core conserva identidad/autorización de dominio, persistencia, trabajos, RAG, freshness y efectos idempotentes. Sandbox, configuración externa, despliegue y cutover quedan fuera.

## Decisiones y riesgos

No hay decisiones bloqueantes para el trabajo local. Se registran como no bloqueantes `DEC-INF-001`, `DEC-VAL-001`, `DEC-EXP-FK-001` y `DEC-RAG-001`; sus `Blocks` corresponden a aprovisionamiento remoto, datos/código empresarial y funciones experimentales, no al corte de migración.

La comprobación estática del repo GH confirmó que el parser JSON privado para publicación usa un límite de ruta `136mb`, instalado antes del parser general de `100kb`. El contrato permite hasta `100,000,000` bytes por blob; su Base64 llega a `133,333,336` caracteres más JSON. Esta ruta envía el contenido de forma transitoria para publicar el blob; no cambia el almacenamiento de archivos en Core/Storage ni el ZIP interno de snapshots que consume Docker/Sandbox. La matriz de tareas incluye pruebas de webhooks con campos opcionales, eventos ignorados, duplicados, errores y reintentos.

## Evidencia

- Auditoría independiente del SDD/Harness: suficiencia de alcance, mapa de consumidores, decisiones no bloqueantes y riesgos de tamaño/webhook.
- Verificación del parser de GH en `tjc-be-github-integration-api/app/src/request-body-parsers.ts` y del máximo de blob en `app/src/github/github-publication.service.ts`.
- `node scripts/sdd-check.mjs`, `node harness/validate-work-items.mjs`, `node harness/validate-harness.mjs`, `node harness/contract-sync.mjs check --checkpoint start --work-item WI-CORE-003` y `git diff --check` — aprobados.

La aprobación de especificación no declara implementado el WI ni aprueba despliegue/cutover. La aceptación humana del diff completo sigue reservada para el cierre extraordinario acordado por el usuario.
