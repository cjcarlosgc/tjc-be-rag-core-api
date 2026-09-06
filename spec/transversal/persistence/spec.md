# persistence — Especificación

**Estado:** aprobado para SDD 1.0 salvo elementos marcados PENDING/PROPOSED.  
**Historias:** capacidad técnica transversal

## Objetivo

Persistir datos, chunks, embeddings, jobs y resultados autoritativos con trazabilidad por versión en PostgreSQL + pgvector de Supabase.

## Reglas y comportamiento

- Prisma es la fuente versionada del esquema relacional; pgvector se habilita y evoluciona mediante migraciones SQL del repositorio. No crear tablas manualmente como sustituto de las migraciones.
- La migración actual materializa `projects`, `project_versions`, `code_chunks`, `test_targets` y `jobs`, además de la extensión `vector`. Las entidades de generación, validación, artifacts y experimento se añadirán en los work items que las implementen; no declararlas existentes antes de ello.
- `project_versions.snapshotKey` almacena la key privada y estable del objeto. No almacenar URLs firmadas.
- RAG Core es propietario de la persistencia del estado y resultado de ejecución. Sandbox devuelve hechos estructurados y no conecta directamente a esta base por defecto.
- Si una arquitectura futura exige acceso directo de un worker Sandbox, requiere una decisión separada y un rol PostgreSQL restringido a tablas/operaciones mínimas; nunca el usuario administrador `postgres`.
- `DATABASE_URL` es configuración de servidor y no se expone a Frontend, Sandbox ni contenedores de código no confiable.
- La dimensionalidad `1536` refleja el default provisional vigente; no constituye una decisión definitiva independiente de `DEC-EMB-001`.


## Fuera de alcance

- No ampliar a capacidades no mencionadas en esta spec.
- No convertir decisiones PENDING en implementación definitiva sin aprobación.
