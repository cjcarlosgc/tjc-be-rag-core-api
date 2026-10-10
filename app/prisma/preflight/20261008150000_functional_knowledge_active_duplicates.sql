-- WI-CORE-020 (DEC-FK-005): consulta de SOLO LECTURA previa a `20261008150000_functional_knowledge_scenarios`.
--
-- Uso: ejecutar contra el entorno ANTES de desplegar la migración. Aplica a entornos que aún NO tienen las
-- columnas `scenarioKind` / `scenarioKey`. Reporta las identidades con más de una regla ACTIVE, con el mismo
-- orden y el mismo formato que el listado del RAISE EXCEPTION de la migración.
-- Antes de la migración, todas las reglas son históricas: tras el backfill su scenarioKey es LEGACY
-- (DEC-FK-004). Por eso la identidad previa es (projectId, scope, COALESCE(targetRef, '')).
--
-- Interpretación:
--   0 filas  -> no hay duplicados: la migración puede ejecutarse.
--   1+ filas -> resolver cada caso con SUPERSEDE o KEEP_EXISTING (flujo vigente) y volver a ejecutar esta
--               consulta hasta obtener 0 filas. Esta consulta no escribe datos: no contiene INSERT, UPDATE,
--               DELETE ni DDL, y la sesión se fuerza a solo lectura.
--
-- Ejecución (sustituir la URL por la del entorno objetivo):
--   psql "$URL" -X -q -A -t -f app/prisma/preflight/20261008150000_functional_knowledge_active_duplicates.sql
-- (-A -t: una línea por caso, sin cabeceras; -q: sin etiquetas de comando.)

-- Solo lectura por construcción: cualquier escritura de la sesión fallaría.
SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;

SELECT format(
         'projectId=%s scope=%s targetRef=%L scenarioKey=%s activeCount=%s activeIds=%s',
         "projectId", "scope", "targetKey", 'LEGACY', "activeCount", "activeIds"
       ) AS "caso"
FROM (
  SELECT "projectId",
         "scope",
         COALESCE("targetRef", '') AS "targetKey",
         count(*) AS "activeCount",
         string_agg("id", ',' ORDER BY "createdAt", "id") AS "activeIds"
  FROM "functional_knowledge"
  WHERE "status" = 'ACTIVE'
  GROUP BY "projectId", "scope", COALESCE("targetRef", '')
  HAVING count(*) > 1
) AS "duplicados"
ORDER BY "projectId", "scope", "targetKey";
