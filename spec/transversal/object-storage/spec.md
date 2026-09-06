# object-storage — Especificación

**Estado:** aprobado para SDD 1.0 salvo elementos marcados PENDING/PROPOSED.  
**Historias:** capacidad técnica transversal

## Objetivo

Abstraer snapshots `source.zip` y artifacts sin acoplar a proveedor.

## Reglas y comportamiento

- El proveedor concreto es Supabase Storage y se integra mediante `@supabase/supabase-js`.
- La lógica de dominio consume exclusivamente la abstracción interna `ObjectStorageService`; no importa ni invoca directamente el SDK de Supabase.
- `ObjectStorageService` define las operaciones requeridas para almacenar, recuperar, eliminar y entregar snapshots y artefactos, sin exponer tipos específicos del proveedor.
- Las keys son internas y no se construyen confiando en nombres suministrados por el usuario.
- PostgreSQL + pgvector en Supabase conserva los datos de dominio, chunks, embeddings vectoriales y la cola DB-backed de jobs; Supabase Storage se limita a snapshots y artefactos.

## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.
