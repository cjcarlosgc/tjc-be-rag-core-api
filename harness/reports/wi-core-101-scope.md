# WI-CORE-101 — alcance: materialización del snapshot sin enmascarar errores y limpieza del workspace best-effort
Modelo: leader · configurado claude-sonnet-5-5 · atendido unknown · esfuerzo medium

**Aprobado por el usuario (chat de Core, 2026-10-25), opción A:** arreglo de `materialize` y de la limpieza, sin contrato, con revisión, merge a `develop` y despliegue; sin tocar el tag hasta que cross valide y repita el smoke de los tres pilotos.

## Problema y evidencia
Run `733637c2…` de `smoke-casbin` (2026-10-25 20:27 UTC, Core `863876d15b`): «Falla de infraestructura: ENOTEMPTY: directory not empty, rmdir '/tmp/rag-core-snapshot-QBfCQV'». `GithubSnapshotMaterializerService.materialize` descarga los archivos en lotes de 8 con `Promise.all` y, en su `catch`, hace `await rm(dir, { recursive: true, force: true })` y relanza. Si una descarga falla, `Promise.all` rechaza de inmediato mientras las otras siguen escribiendo en el directorio; el `rm` compite con ellas, lanza ENOTEMPTY y ese error REEMPLAZA al original (reproducido en local: 17 de 20 ensayos con el mismo patrón). El error original no es observable, por lo que un fallo no puede clasificarse ni demostrarse externo. Además, la limpieza del `finally` de los handlers (`workspace.cleanup()`) puede lanzar y pisar el resultado.

## Alcance (sin contrato, DTO, enum, `ErrorCode`, evento, esquema, variable de entorno ni migración)
- Utilidad común `removeWorkspaceDir(dir, logger?)` (nueva, en `app/src/common/`): `rm` recursivo con `force` y reintentos (`maxRetries`, `retryDelay`) que NUNCA lanza: si falla, registra un aviso sin rutas ni contenido y sigue.
- `GithubSnapshotMaterializerService`: cada lote espera a que terminen TODAS sus escrituras (`Promise.allSettled`) y relanza el primer error real; en el `catch` limpia con la utilidad y relanza el error ORIGINAL (nunca el de la limpieza); `cleanup` del workspace usa la utilidad.
- `ZipExtractionService`: misma utilidad en su `cleanup` y en su `catch` (consistencia; no tiene carrera, pero no debe enmascarar ni lanzar).
- Los handlers que ya hacen `finally { await workspace?.cleanup() }` no cambian: con `cleanup` no lanzante dejan de poder pisar el resultado.
- Fuera de alcance: reintento automático de la materialización antes de declarar `INFRASTRUCTURE_FAILURE` (opción C, política), cambios de contrato, el motivo de fondo del fallo original de descarga (desconocido).

## Hecho cuando
Pruebas: el error original de una descarga fallida se conserva (no ENOTEMPTY) con escritores hermanos aún activos y el directorio queda eliminado sin escrituras tardías; la limpieza nunca lanza aunque `rm` falle (aviso registrado); `cleanup` elimina el directorio; la utilidad pasa los reintentos; lint/build/test en verde; el reviewer independiente aprueba.
