[reviewer::GPT-6 Luna / xhigh] · WI-CORE-036 · Revisión independiente
Modelo: reviewer · configurado gpt-6-luna · atendido unknown · esfuerzo xhigh

## status

CHANGES_REQUESTED

## findings

1. **[P1] `Project.projectRoot` queda desactualizado en snapshots resueltos fuera del candidato PHP único.** El handler persiste `effectiveProjectRoot: '.'` para TypeScript y para la detección legacy, pero solo envía `projectRoot` a `completeAndPromote` cuando `resolveUniqueComposerRoot` encontró exactamente un manifiesto. Por tanto, un Project nuevo sigue exponiendo `null` tras completar su primer snapshot TypeScript; si un Project que tenía raíz `backend` pasa a un snapshot TypeScript o a un snapshot sin candidato PHP, la API conserva `backend` aunque su versión actual use `.`. Esto contradice que `ProjectResponse.projectRoot` sea la raíz activa y que TypeScript conserve `.` (`INTEROP-2.8` §6.1; `SYSTEM-2.7`). La prueba del repositorio codifica la omisión como “preservar” la raíz para ejecuciones legacy, por lo que no cubre el cambio de raíz activa entre versiones (`app/src/project-versions/project-versions.repository.spec.ts:37-51`). Actualizar la raíz activa a `.` al promover snapshots cuya raíz está resuelta; mantener aparte el subcaso ambiguo pendiente.

2. **[P1] Varios `composer.json` pasan por una ruta ejecutable implícita, en vez de quedar aparcados.** `resolveUniqueComposerRoot` devuelve `undefined` tanto para cero como para varios candidatos; el handler asigna `selectedProjectRoot = '.'` y cae en `detectProjectLanguage` (`app/src/snapshot-intelligence/snapshot-analysis-job.handler.ts:183-197`). Para varios manifiestos anidados, el materializador ahora decide que es proyecto PHP por la presencia de cualquiera de ellos y materializa el pool PHP (`app/src/snapshot-intelligence/github-snapshot-materializer.service.ts:39-43`), pero el detector legacy solo reconoce `composer.json` en la raíz (`app/src/project-versions/inventory/framework-detector.ts:3-5`): el handler termina creando una versión TypeScript `.` sin indexar PHP. La prueba actual afirma precisamente esa ruta (`app/src/snapshot-intelligence/snapshot-analysis-job.handler.spec.ts:340-354`). Si hay un manifiesto en la raíz y otro anidado, el detector sí elige PHP y el root implícito `.` permite analizar todos los PHP de ambos candidatos. Ambos resultados son ejecución con una raíz no aprobada y no respetan que el subcaso multi-candidato quede sin ejecución hasta resolver `DEC-PHP-ROOT-001`. No se solicita inventar un estado público; separar explícitamente la detección de multi-candidato y no promover una versión con resultado engañoso para esa rama. La decisión pendiente sigue sin bloquear el candidato único, pero esta implementación no puede aprobarse mientras caiga silenciosamente en esos caminos.

## blockers

- Los dos findings anteriores impiden aprobar el corte actual. `DEC-PHP-ROOT-001` solo bloquea la rama de dos o más candidatos, no el comportamiento del candidato único; el segundo finding señala que esa rama hoy sí tiene comportamiento implícito.

## filesAffected

- `app/src/snapshot-intelligence/snapshot-analysis-job.handler.ts`
- `app/src/snapshot-intelligence/snapshot-analysis-job.handler.spec.ts`
- `app/src/snapshot-intelligence/github-snapshot-materializer.service.ts`
- `app/src/project-versions/inventory/framework-detector.ts`
- `app/src/project-versions/project-versions.repository.ts`
- `app/src/project-versions/project-versions.repository.spec.ts`
- `app/src/project-versions/project-root.util.ts`
- `app/prisma/schema.prisma`
- `app/prisma/migrations/20261011100000_project_roots/migration.sql`
- DTOs de Project y ProjectVersion bajo `app/src/projects/dto/` y `app/src/project-versions/dto/`

## evidence

- Contract Sync PULL `before-review`: lectura PASS, `relevantPendingSyncIds: []`; incluye `CS-GH-20261010-001` como resuelto y `CS-20260920-001`/`CS-20260921-003` como no relevantes para este WI. El checkpoint ya estaba registrado en orden; la repetición con `--record` fue rechazada como duplicada y no alteró `harness/state.json`.
- Pruebas focalizadas reejecutadas independientemente desde `app/`: 5 archivos, 49/49 tests pasaron (`project-root.util`, repositorio/servicio ProjectVersion, materializador y handler).
- `git diff --check`, `node harness/validate-work-items.mjs`, `node harness/validate-harness.mjs` y `node scripts/sdd-check.mjs`: PASS.
- `npm run lint`, `npm run build` y suite completa reportados por el implementer en `harness/reports/wi-core-036-implementation.md`; no se repitieron durante esta revisión.
- Persistencia: el nuevo `effectiveProjectRoot` tiene default/backfill `.` y se crea con la versión; `completeAndPromote` actualiza versión y Project en una transacción. La promoción atómica del candidato único está cubierta por `project-versions.repository.spec.ts`.
- Wrapper ZIP: no hallé un defecto atribuible a este corte Core. El handler consume el tree GitHub ya materializado con paths relativos al repositorio, no un ZIP externo; la normalización de `extractionRoot` corresponde al Sandbox/`WI-CORE-037`. No se toma la ausencia de esa prueba como blocker de WI-CORE-036.

## recommendedNextStep

Corregir el update de `Project.projectRoot` para los snapshots resueltos cuya raíz efectiva es `.`, y aislar la rama con múltiples manifiestos para que no cree ni promueva una versión elegida implícitamente. No inventar una respuesta de producto para la decisión pendiente; dejar ese subcaso aparcado y conservar habilitado el corte aprobado de candidato único. Repetir pruebas focalizadas y los gates completos; después solicitar una nueva revisión independiente dentro del límite de ciclos.
