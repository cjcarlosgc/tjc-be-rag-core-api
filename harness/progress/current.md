# Progreso actual

Sprint 1 completo (HU01-HU07) en `app/`: gestión de proyectos, indexación asíncrona completa (ZIP → snapshot en Object Storage → extracción segura → parsing ts-morph → chunking → embeddings OpenAI → pgvector) e inventario de pruebas (targets CLASS/METHOD/FUNCTION, detección de framework, resolución heurística de cobertura existente). Cola de jobs DB-backed. Lint/test/build en verde. Evidencia en `harness/reports/`.

Object Storage migrado de MinIO/S3-compatible a **Supabase Storage** (`@supabase/supabase-js`) detrás de la abstracción `ObjectStorageService`, con bucket-check perezoso (no bloquea el arranque de la app sin credenciales reales). Migración de código completa y verificada (unit + e2e con fake en memoria); ver `harness/reports/object-storage-supabase-migration.md`. `docker-compose.yml` ya no incluye MinIO.

Decisiones PENDING resueltas en el camino: package manager (pnpm), mecanismo durable de jobs (cola DB-backed en PostgreSQL), proveedor de Object Storage (Supabase Storage, sustituyendo la elección inicial de MinIO).

Cambio de contrato SDD 1.0 → 1.1: `TestTarget.targetType` ahora es `CLASS|METHOD|FUNCTION`; el modo de generación puntual de `005-test-generation` se renombra de `METHOD` a `TARGET`. SDD 1.1 → 1.2: proveedor de Object Storage a Supabase Storage. SDD 1.2 → 1.3: TypeScript-only explícito, baseline sustituido por agente generalista, validación empresarial y puertas de decisión para embeddings, chunking, mutation score y test-aware. Ver `CHANGELOG.md`.

Fix aplicado: si falla la subida del snapshot, `setSnapshot` o el encolado del job, la `ProjectVersion` se marca `FAILED` en vez de quedar huérfana en `PENDING` (evita bloqueo permanente por 409 en reintentos). Verificado con pruebas unitarias y manualmente contra Supabase inalcanzable; detalle en `harness/reports/object-storage-supabase-migration.md`.

Auditoría de completitud actualizada: se documentó el comportamiento real de servicios/chunking de Sprint 1, pero la estrategia definitiva para retrieval continúa en `DEC-CHUNK-001`. Los transversales de providers y métricas ya declaran sus reglas y puertas principales; otros contratos operativos se refinan cuando el work item los necesite. Ver `harness/reports/sdd-1.3-decision-consolidation.md`.

En el corte SDD 1.4 se incorporó `SYSTEM-1.0`, se corrigieron HU06/HU08 para incluir funciones y `DEC-INT-001` registró entonces el contrato HTTP Core↔Sandbox como pendiente.

SDD 1.5 / SYSTEM-1.1 incorpora `INTEROP-1.0`, contrato universal con rutas, DTOs, errores, asincronía, artefactos y ejecución Sandbox. `DEC-INT-001` queda aprobado; no se cierran las puertas de retrieval, agente generalista, mutation testing, package managers o validación empresarial.

SDD 1.6 queda homologada como línea base conjunta de los tres repositorios y formaliza la entrega Git común: cada commit es un cambio coherente con `Refs: HU...`; cada work item conserva su revisión y, antes del push de cierre de sprint, el reviewer debe aprobar y documentar el rango acumulado exacto que se publicará. `SYSTEM-*` e `INTEROP-*` conservan versionado propio. Commit y push continúan requiriendo solicitud humana explícita.

SDD 1.7 / SYSTEM-1.2 aprueba como entorno temporal de desarrollo y prevalidación la MacBook encendida con Docker Desktop y su VM Linux. El destino previsto continúa siendo una VM Linux remota, pero `DEC-INF-001` mantiene `PENDING` la selección del proveedor, priorizando opciones gratuitas sin asumir que cumplen capacidad, disponibilidad o seguridad. INTEROP-1.0 no cambia.

SDD 1.8 / SYSTEM-1.3 / INTEROP-1.1 consolida la frontera de datos: solo RAG Core usa Supabase Storage/PostgreSQL/pgvector, genera URLs firmadas temporales para que Sandbox descargue inputs y persiste sus resultados. Sandbox y Frontend no reciben credenciales Supabase/DB ni incorporan el SDK por esta infraestructura. Se fija el proyecto Supabase, el bucket privado `repository-zips`, las variables canónicas, cargas sin sobrescritura y migraciones Prisma como mecanismo de esquema; no se ejecutaron migraciones remotas.

Siguiente paso sugerido: antes de implementar `004-rag-retrieval-context`, resolver humanamente `DEC-CHUNK-001` y `DEC-EMB-001`. `DEC-RAG-001` y `DEC-MET-001` son análisis deseados inmediatamente después del núcleo de Sprint 2 y no lo bloquean. HU19 queda bloqueada específicamente por `DEC-EXP-002`; la integración Sandbox ya dispone de contrato, mientras la validación empresarial continúa sujeta a `DEC-VAL-001`.
