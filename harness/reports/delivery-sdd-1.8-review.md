# Revisión de entrega extraordinaria — SDD 1.8

**Fecha:** 2026-09-05

**Tipo:** entrega extraordinaria solicitada por el usuario

**Componente:** RAG Core API

**Commit revisado:** `20493e96241278e4bbb90eb08682afdcef9c8434`

**Parent:** `42d2d789f757758386daa720c6fb07b2c6d7fa67`

**Rango revisado:** `42d2d789f757758386daa720c6fb07b2c6d7fa67..20493e96241278e4bbb90eb08682afdcef9c8434`

**Veredicto:** `APPROVED`

## Alcance y trazabilidad

- Línea base: SDD 1.8 / SYSTEM-1.3 / INTEROP-1.1.
- Historias: HU02, HU07, HU08, HU09, HU10, HU11, HU12, HU13, HU14, HU15, HU16, HU17, HU18, HU19, HU23.
- El commit usa Conventional Commits y contiene la línea `Refs` requerida.
- El cambio consolida a Core como único propietario de Supabase Storage y PostgreSQL/pgvector, actualiza configuración, bucket/key inmutable y `upsert=false`, y define la frontera de descargas efímeras Core→Sandbox.
- No se aplicaron migraciones ni cambios sobre la base remota durante esta revisión.

## Verificaciones

- `node --check scripts/sdd-check.mjs`: OK.
- `node scripts/sdd-check.mjs`: `SDD check OK`.
- `git diff --check 42d2d789f757758386daa720c6fb07b2c6d7fa67..20493e96241278e4bbb90eb08682afdcef9c8434`: OK.
- `git diff --check origin/main..HEAD`: OK.
- `pnpm lint`: OK.
- `pnpm test`: 13 archivos y 65/65 pruebas unitarias OK.
- `pnpm build`: OK.
- `git status --porcelain=v1` antes de registrar este reporte: limpio.
- Contratos `system`/`interoperability` y backlog: idénticos byte a byte en los tres repositorios.
- `sddVersion`: 1.8 en los tres repositorios.
- Escaneo de archivos versionados: no se detectaron secretos; `.env` no está versionado y `.env.example` usa placeholders o valores públicos.
- Frontend y Sandbox no incorporan `@supabase/supabase-js` ni credenciales Supabase/DB.
- Las decisiones `DEC-INF-001`, `DEC-CHUNK-001`, `DEC-EMB-001`, `DEC-RAG-001`, `DEC-EXP-002`, `DEC-MET-001` y `DEC-VAL-001` conservan estado `PENDING` y alcance acotado; `DEC-INT-001` permanece aprobado conforme a INTEROP-1.1.

## Limitación E2E

La ejecución informada de `pnpm test:e2e` obtuvo 5/7 pruebas en verde. Las dos fallas de `project-versions.e2e-spec.ts` dependen del PostgreSQL configurado, cuyo esquema no estaba preparado mediante las migraciones versionadas. La validación de los nuevos nombres de variables de entorno sí quedó resuelta antes de alcanzar esa dependencia. No se aplicaron migraciones remotas porque la revisión no estaba autorizada a modificar ese entorno.

Esta limitación **no bloquea la publicación de este commit**: no hay cambios de esquema en el rango, las modificaciones de configuración, Storage y key versionada tienen cobertura unitaria y lint/unit/build están en verde. Sí bloquea declarar validación E2E completa contra Supabase o preparación para despliegue. Antes de esa afirmación se debe disponer de un PostgreSQL aislado/autorizado con migraciones aplicadas y repetir la suite hasta 7/7.

## Hallazgos

No quedan hallazgos abiertos ni decisiones pendientes cerradas indebidamente. La revisión aplicó las reglas de configuración, inyección y pruebas aisladas de `nestjs-best-practices`; el adapter continúa detrás de `ObjectStorageService` y los tests unitarios sustituyen dependencias externas.

Este reporte debe incorporarse mediante el commit exclusivo `docs(review)` permitido por `spec/constitution/delivery-workflow.md`. Antes del push, el reviewer debe comprobar que ese commit solo añade los reportes declarados y conserva las mismas HU.
