# object-storage — Especificación

**Estado:** aprobado para SDD 1.0 salvo elementos marcados PENDING/PROPOSED.  
**Historias:** capacidad técnica transversal

## Objetivo

Abstraer snapshots y artifacts sin acoplar el dominio al proveedor.

## Reglas y comportamiento

- El proveedor concreto es Supabase Storage y se integra únicamente en RAG Core mediante `@supabase/supabase-js`.
- El bucket privado aprobado es `repository-zips`; el ZIP original de cada versión usa `repositories/{projectId}/versions/{projectVersionId}/original.zip` y se crea con `upsert=false`.
- La lógica de dominio consume exclusivamente la abstracción interna `ObjectStorageService`; no importa ni invoca directamente el SDK de Supabase.
- `ObjectStorageService` define las operaciones requeridas para almacenar, recuperar, eliminar y entregar snapshots y artefactos, sin exponer tipos específicos del proveedor.
- Las keys son internas y no se construyen confiando en nombres suministrados por el usuario.
- PostgreSQL + pgvector en Supabase conserva los datos de dominio, chunks, embeddings vectoriales y la cola DB-backed de jobs; Supabase Storage se limita a snapshots y artefactos.
- Para una ejecución, Core genera mediante `ObjectStorageService` una URL firmada temporal conforme a `EphemeralDownloadRef` de `INTEROP-1.6`, acompañada de SHA-256 y tamaño verificables. La vigencia solo debe permitir iniciar la descarga.
- Las URLs firmadas no se persisten, no se registran completas y no sustituyen la `snapshotKey`. Los repositorios no se publican.
- Frontend y Sandbox no consumen este SDK, bucket ni credenciales. El Sandbox descarga por HTTPS y Core persiste el resultado devuelto.

## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.
