# Evidencia de implementación — WI-CORE-012

**Estado:** implementación local verificada; WI permanece `W-IN_PROGRESS` para Contract Sync, revisión contractual y visto bueno humano.  
**Alcance:** análisis estructural e inventario heurístico de snapshots PHP en Core (HU03/HU04). No incluye generación/ejecución PHPUnit ni cambios en Sandbox.

## Entregado

- Parser PHP WASM fijado por `DEC-PHP-AST-001`; conserva namespaces/FQCN, clases, traits, interfaces, enums, funciones, métodos y constructores, con recuperación estructural y partición de chunks grandes.
- Selección PHP por `composer.json` en raíz, con precedencia sobre `package.json`; pool PHP independiente, sin Blade/dependencias/runtime y sin mezclar TypeScript en la misma ProjectVersion.
- Detección explícita de PHPUnit sin inferirlo por Pest; asociación existente por imports/uso de símbolos como heurística, no como cobertura ejecutada.
- Persistencia de `ProjectVersion.language`, backfill de versiones existentes a `TYPESCRIPT` y DTOs `INTEROP-2.6` con lenguaje y PHPUNIT.
- Los flujos de generación, validación y experimentos no envían aún snapshots PHP al runner Node: PHPUnit queda planificado en WI-CORE-013.

## Verificaciones

- `cd app && ./node_modules/.bin/vitest run` — 102 archivos aprobados, 1 omitido; 1125 tests aprobados, 36 omitidos.
- `cd app && ./node_modules/.bin/oxlint src/ test/` — aprobado.
- `cd app && ./node_modules/.bin/nest build` — aprobado.
- `cd app && ./node_modules/.bin/prisma validate` — esquema válido.
- `node scripts/sdd-check.mjs` — aprobado.
- `node harness/validate-harness.mjs` — Harness V3 válido.
- `node harness/validate-work-items.mjs` — 13 WIs Core válidos.
- `git diff --check` — aprobado.

## Pendiente antes de revisión/cierre

- Publicar Contract Sync de `INTEROP-2.6` hacia Console y resolver su espejo/impacto local.
- Revisión contractual y revisión/visto bueno humano del WI. No se cierra la subtarea ni el work item en este reporte.
