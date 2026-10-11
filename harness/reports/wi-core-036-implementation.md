[implementer-high::GPT-6 Luna / high] · WI-CORE-036 · projectRoot único
Modelo: implementer-high · configurado gpt-6-luna · atendido unknown · esfuerzo high

## status

IMPLEMENTATION_CORRECTED_AFTER_REVIEW_CYCLE_3; además del parking sticky, la migración ahora backfillea `Project.projectRoot='.'` para Projects preexistentes con `currentVersionId`. El ciclo excepcional 3/3 reportó ese hallazgo P1; queda pendiente revisión humana y no se solicitará otro reviewer IA. La rama de manifiestos múltiples conserva el Run en `QUEUED`, sin nuevo estado ni resultado público, mientras sigue pendiente `DEC-PHP-ROOT-001`.

## findings

- `Project.projectRoot` queda nullable hasta resolver el snapshot; al promover una versión resuelta se actualiza atómicamente a su raíz efectiva (`.` para TypeScript/legacy). `ProjectVersion.effectiveProjectRoot` se congela al crear la versión y tiene `.` como default/backfill histórico.
- Para exactamente un `composer.json` candidato, Core persiste la raíz al promover la versión, congela la misma raíz en `ProjectVersion`, limita el análisis PHP al subárbol y conserva los paths de símbolos/targets relativos al repositorio.
- La detección e inclusión de archivos Composer anidados respeta exclusiones existentes. El PHP único se detecta aunque haya un frontend hermano; TypeScript conserva el flujo legacy.
- La validación rechaza rutas absolutas, traversal, separadores Windows y raíces fuera del snapshot por symlink.
- Cero manifiestos conserva el análisis legacy desde `.` y promueve `Project.projectRoot='.'` junto con la versión. Para dos o más manifiestos, la detección ocurre antes de `startProcessing`; el job lanza `RescheduleJobError` y el Run permanece `QUEUED`. En esa rama no se llama a compare, parser, persistencia de versión/chunks/targets, promoción ni finalización/resultado público.
- El parking usa backoff exponencial de 1 minuto, duplicado por cada diferimiento, con tope de 24 horas. El payload interno del job conserva `{headSha, policyVersion, deferrals}`: tras detectar ambigüedad, la misma SHA inmutable solo se materializa una vez por decisión; sus reintentos pegajosos no consultan GitHub ni redescubren archivos y solo reprograman el job. Al alcanzar el tope, queda como máximo una reconsulta remota cada 24 horas si cambia la versión de política. Incrementar la versión explícita invalida el marker y permite volver a evaluar la decisión. El Run sigue sujeto al guard de estado existente: al quedar obsoleto por un nuevo HEAD, su job no-op ya no reprograma.
- La migración backfillea `projects.projectRoot='.'` solo donde `currentVersionId IS NOT NULL`; los Projects sin versión vigente conservan `null`. Una prueba fija el predicado de migración y otra verifica que `ProjectsService` expone `projectRoot='.'` para el Project legacy cargado tras ese backfill.
- No se implementó el transporte hacia Sandbox, cambios de Console ni normalización de wrapper ZIP. El selector Core recibe el tree GitHub materializado con paths del repositorio; el transporte/working directory corresponde al WI-CORE-037 y al WI Sandbox ya cerrado.

## blockers

- Sigue pendiente `DEC-PHP-ROOT-001`, que determina cómo seleccionar/administrar una raíz cuando existen varios `composer.json`. Ese subcaso queda fuera del corte aprobado y sus Runs se aparcan en `QUEUED` mediante el backoff descrito; no se inventa status ni se reinterpreta un resultado existente. La decisión no bloquea la detección de candidato único ni el cierre de este WI bajo ese alcance. Debe resolverse antes de implementar selección multi-manifiesto.

## filesAffected

- `app/prisma/schema.prisma`
- `app/prisma/migrations/20261011100000_project_roots/migration.sql`
- `app/src/project-versions/project-root.util.ts` y su spec
- `app/src/project-versions/project-versions.repository.ts` y su spec
- DTOs/servicios de `Project` y `ProjectVersion`
- `app/src/project-versions/indexing.constants.ts`
- `app/src/snapshot-intelligence/github-snapshot-materializer.service.ts` y su spec
- `app/src/snapshot-intelligence/snapshot-analysis-job.handler.ts` y su spec

## evidence

- Después de añadir el marker sticky para la ambigüedad: suites dirigidas de handler, persistencia, DTO/servicio, utilidades de raíz y materializador — 5 archivos, 52 pruebas pasaron. Las pruebas cubren reprogramación sin resultado público, reintento sticky sin llamadas remotas, cap de 24 horas e invalidación al cambiar SHA o versión de política.
- Tras corregir el backfill: `pnpm test` — 138 archivos pasaron, 6 saltados; 2,098 pruebas pasaron, 104 saltadas. Incluye regresión de migración y serialización de respuesta de Project.
- En `app/`: `pnpm run lint`, `pnpm run build` y `pnpm exec prisma validate --schema prisma/schema.prisma` — pasaron.
- `node scripts/sdd-check.mjs`, `node harness/validate-work-items.mjs`, `node harness/validate-harness.mjs` y `git diff --check` — pasaron.
- PULL Contract Sync `implementation-delivery`, solo lectura: `relevantPendingSyncIds: []`; 9 eventos relevantes `C-RESOLVED` y 2 históricos `NOT_RELEVANT`.

## recommendedNextStep

Presentar el diff actualizado y la evidencia al Human Reviewer (usuario); no pedir otra revisión IA ni iniciar WI-CORE-037 hasta que WI-CORE-036 cierre.
