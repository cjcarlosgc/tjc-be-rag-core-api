-- WI-CORE-019 (DEC-ORG-003, INTEROP-2.7 §6.13): rol Writer entre Maintainer y Reader.
--
-- Migración aditiva: solo añade el valor al enum. No reescribe filas de `project_access`
-- (los registros existentes se reclasifican por la reverificación de ACCESS_REVERIFY).
-- `WRITER` no se usa en este archivo: la jerarquía se evalúa en código (ROLE_RANK), nunca
-- con operadores del enum SQL.
--
-- Rollback: no existe. Postgres no permite quitar un valor de un enum; una fila `WRITER`
-- es ilegible para el código anterior a esta migración.

-- AlterEnum
ALTER TYPE "ProjectRole" ADD VALUE IF NOT EXISTS 'WRITER' BEFORE 'READER';
