# WI-CORE-100 — alcance: verificación OE3 (casos C1–C6 y campos de auditoría de FK) y prueba pg del índice ACTIVE
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Aprobado por el usuario (chat de Core, 2026-10-25):** «suite OE3 C1–C6 y prueba pg del índice ACTIVE», dentro del inventario previo al tag `arch-v1.0`. Solo pruebas y documentos: sin cambio de código de producción, contrato, DTO, enum, `ErrorCode`, variable de entorno ni migración; sin tocar otros repositorios.

Fuente: tesis, Anexo I, Tabla 62 (C1–C6 y medida complementaria ConcordanciaFK) y Tabla 63 (campos de auditoría); IOE3.1 e IOE3.2 (`referencias/tesis.md`, §5.4 y Anexo I); código de `app/src/functional-knowledge/` y `app/src/project-access/`; decisiones DEC-FK-001…004, D-9 y D-23 (la «versión» = linaje `supersedesId` + `createdAt`).

## Pruebas nuevas (`app/src/ct/`)
1. `oe3-c1-c6.spec.ts` (sin pg): una suite con un `describe` por caso y `it` titulados `OE3-C1: …` … `OE3-C6: …`, que ejecuta el comportamiento real (evaluador, servicio, repositorio con dobles de borde) y nombra cada caso de la Tabla 62:
   - C1: ACTION_REQUIRED solo ante incertidumbre elegible (símbolo `METHOD`/`FUNCTION` `DIRECTLY_CHANGED` con construcciones nuevas o modificadas frente a la base y sin regla ACTIVE aplicable); y NO se activa por un cambio sin construcciones, por complejidad ni porque falte una regla no requerida.
   - C2: respuesta confirmada por MAINTAINER o ADMIN crea la FK ACTIVE y permite la continuación solo con el HEAD vigente (HEAD obsoleto ⇒ la pregunta pasa a OBSOLETE y no continúa).
   - C3: WRITER (y READER) no confirma ni persiste FK (403 `PROJECT_ROLE_INSUFFICIENT`; mapeo `admin`/`maintain`→MAINTAINER, `write`→WRITER, `triage`/`read`→READER).
   - C4: UNKNOWN deja la solicitud pendiente, no crea FK ni continúa la generación (abstención auditada con quién, rol y cuándo).
   - C5: una regla posterior de la misma clave sustituye a la previa (SUPERSEDED, `supersedesId`); reglas de claves distintas coexisten ACTIVE.
   - C6: un conflicto (misma clave, regla ACTIVE existente) se conserva para resolución explícita (409 con la regla ganadora; `KEEP_EXISTING` o `SUPERSEDE` explícito) y nunca se sobrescribe en silencio.
   - Campos de auditoría (Tabla 63): tras confirmar, la regla guarda project/target, `source`, `scope`, `scenarioKey`, `status`, `confirmedByUserId`, `confirmedRole` (solo ADMIN o MAINTAINER), `originHeadSha` (procedencia, no vencimiento) y `sourceRef` solo con `APPROVED_IMPORT`; el linaje de versiones se reconstruye con `supersedesId` + `createdAt`.
2. `oe3-active-index.pg.spec.ts` (pg, `CT_TEST_DATABASE_URL`, solo localhost, ids únicos, limpia solo sus filas): contra Postgres real y `FunctionalKnowledgeRepository` real, el índice único parcial de reglas ACTIVE (`(projectId, scope, COALESCE(targetRef,''), scenarioKey) WHERE status='ACTIVE'`) rechaza una segunda ACTIVE de la misma clave (`ActiveKnowledgeConflictError` con la ganadora); una SUPERSEDED no cuenta; claves distintas coexisten; `supersede` es atómico (la antigua queda SUPERSEDED y la nueva ACTIVE con `supersedesId`; si la inserción viola el índice, la transacción revierte y la antigua sigue ACTIVE); dos creaciones concurrentes de la misma clave dejan exactamente una ACTIVE.

## Documento
`harness/reports/oe3-protocolo-verificacion.md`: protocolo para la ejecución viva de C1–C6 en la Console (cuentas ADMIN, MAINTAINER, WRITER y READER, un Project controlado, cambio de HEAD), con pasos, resultado esperado, qué capturar para cada Evidence ID `EV-OE3-…`, cómo calcular IOE3.1 (reglas ACTIVE con fuente, alcance, versión, estado y auditoría completa / reglas ACTIVE; con la «versión» = linaje) e IOE3.2, y cómo registrar ConcordanciaFK (regla esperada ex ante frente a regla aplicada, descriptivo); consulta SQL de solo lectura para IOE3.1; mapeo caso → prueba automática de `app/src/ct/oe3-*.spec.ts`. Sin resultados inventados: lo vivo lo ejecutan el usuario y cross.

## Hecho cuando
Las pruebas nuevas pasan (y fallan si se rompe la lógica que dicen cubrir), la prueba pg pasa contra un Postgres local descartable con las migraciones aplicadas y queda en el job de CI de pgvector (la variable `CT_TEST_DATABASE_URL` ya existe), lint/build/test en verde, el protocolo no afirma resultados no ejecutados y el reviewer independiente aprueba.
