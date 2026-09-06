# Evidencia — HU06 (003-test-inventory)

**Sprint:** Sprint 1 · **Estado:** DONE

## Contradicción detectada y resuelta antes de implementar (SDD 1.0 → 1.1)

Al analizar la spec encontré que `003-test-inventory` pedía identificar "clases, métodos **y funciones**" testables, pero el contrato `TestTarget` ya aprobado en `004-rag-retrieval-context` solo definía `targetType CLASS|METHOD` — sin un tercer valor para funciones top-level. Se escaló al usuario en vez de resolverlo por iniciativa propia (afecta un contrato ya consumido por dos features). Decisión del usuario:

- `TestTarget.targetType` pasa a `CLASS|METHOD|FUNCTION`.
  - CLASS: `symbolName` = clase, sin `methodName`.
  - METHOD: `symbolName` = clase, `methodName` = método.
  - FUNCTION: `symbolName` = función top-level, sin `methodName`.
- El modo de generación puntual de `005-test-generation` se renombra de `METHOD` a `TARGET` (resuelve un `TestTarget` de tipo METHOD o FUNCTION sin excepciones semánticas).

Specs actualizadas: `003-test-inventory/spec.md`, `004-rag-retrieval-context/spec.md`, `005-test-generation/spec.md`. Registrado en `CHANGELOG.md`. `sddVersion` incrementado de `1.0` a `1.1` en `harness/state.json`. Re-validada la coherencia backlog↔specs (`node scripts/sdd-check.mjs` + grep dirigido) antes de continuar con la implementación.

## Alcance implementado

- Prisma: modelo `TestTarget` (`targetType`, `symbolName`, `methodName?`, `hasTest`, `testFilePaths: String[]`, posición) + campos de resumen en `ProjectVersion` (`detectedFramework`, `targetsTotal`, `targetsWithTest`).
- `TestTargetExtractorService`: identifica clases exportadas (target CLASS), sus métodos públicos/default (target METHOD; excluye `private`/`protected`) y funciones top-level exportadas (target FUNCTION) vía ts-morph. Solo se consideran declaraciones exportadas — no son alcanzables desde un test externo si no lo están.
- `ExistingTestResolverService`: heurística de relación por convención — para cada archivo `*.spec.ts(x)`/`*.test.ts(x)` del pool, resuelve sus imports relativos contra el árbol del proyecto; si importa el símbolo de un target CLASS/FUNCTION, lo marca `hasTest=true` y registra el archivo en `testFilePaths` (trazabilidad). Para METHOD exige además que el texto del test contenga `.metodo(`.
- `detectFramework`: VITEST/JEST por config file (`vitest.config.*`/`jest.config.*`) o por dependencia en `package.json`; si hay señales contradictorias o ninguna, devuelve `null` — nunca inventa framework.
- `IndexingJobHandler` ampliado: durante `CHUNKING` construye el inventario (candidatos + resolución + detección de framework) y lo persiste en `PERSISTING` junto a los chunks, de forma idempotente (`deleteByProjectVersion` antes de reinsertar).
- `GET /project-versions/:id/results` ahora incluye `detectedFramework`, `targetsTotal`, `targetsWithTest`, `targetsMissingTest` — esto resuelve el campo que había quedado explícitamente diferido en la evidencia de HU02-05/07.
- Nuevo `GET /project-versions/:id/test-inventory`: lista completa de targets con `hasTest`/`testFilePaths`, para que el usuario identifique exactamente qué objetivos aún requieren cobertura (HU06). 409 `ANALYSIS_NOT_FINISHED` si la versión no está `COMPLETED`.

## Interpretaciones documentadas (no cerradas como definitivas)

- Solo se generan targets para declaraciones **exportadas** (no testeables desde fuera si no lo están); no hay indicación explícita en la spec, pero es la lectura más defendible dado que el objetivo es generación de pruebas externas.
- La relación "prueba existente ↔ target" es heurística V1 (import + referencia textual al método), no un análisis semántico completo de qué se ejercita realmente.

## Verificación

- `pnpm lint` → OK.
- `pnpm test` → 60/60 unitarias OK, incluyendo `framework-detector` (7 casos, incluye ambigüedad→`null`), `test-target-extractor.service` (exportado vs no exportado, visibilidad de métodos), `existing-test-resolver.service` (cobertura real vía ts-morph sobre archivos temporales), y las suites de `project-versions.service`/`indexing-job.handler` actualizadas para el nuevo flujo.
- `pnpm test:e2e` → 7/7 OK; el caso principal de `project-versions.e2e-spec.ts` sube un ZIP con `vitest.config.ts` + una clase con dos métodos + un spec que solo ejercita uno de ellos, y verifica end-to-end (Postgres/MinIO reales) que `results` y `test-inventory` reflejan `detectedFramework=VITEST`, `targetsTotal=3`, `targetsWithTest=2` y el método no cubierto marcado correctamente.
- `pnpm build` → OK.
