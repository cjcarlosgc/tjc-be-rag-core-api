# WI-CORE-041 — Implementación y comprobaciones

Modelo: implementer · configurado gpt-6-luna · atendido unknown · esfuerzo medium

## Resultado

La detección del marcador Composer ahora es consistente y sensible a mayúsculas: únicamente el nombre base exacto `composer.json` activa el pool PHP o cuenta como candidato de `projectRoot`. `COMPOSER.JSON` ya no excluye fuentes TypeScript. Se conserva la selección de manifiestos canónicos y la regla existente para varios candidatos.

Archivos de producto modificados:

- `app/src/project-versions/indexing.constants.ts` y su spec.
- `app/src/project-versions/project-root.util.ts` y su spec.
- `app/src/snapshot-intelligence/github-snapshot-materializer.service.ts` y su spec.
- `app/src/snapshot-intelligence/snapshot-analysis-job.handler.ts` y su spec.

No cambian contratos, DTOs, rutas, decisiones, Sandbox ni otros repositorios.

## Evidencia de pruebas

- Regresiones focalizadas: 43 pruebas pasan en 4 archivos; oxlint focalizado y `git diff --check` pasan.
- `pnpm --dir app run lint`: pasa.
- `pnpm --dir app test`: 138 archivos pasan, 6 omitidos; 2103 pruebas pasan, 104 omitidas.
- `pnpm --dir app run build`: pasa.
- `pnpm --dir app exec prisma validate --schema prisma/schema.prisma`: esquema válido.

El implementer no creó commits ni hizo push. Este reporte acredita implementación y gates técnicos; no sustituye la revisión independiente.
