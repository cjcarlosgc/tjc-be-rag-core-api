# 013 — Plan

## Dependencias

- SYSTEM-2.2 e INTEROP-2.2.
- ownership HU29, jobs DB-backed, object storage, snapshots, retrieval, generación, Sandbox client, artifacts y traces existentes.

## Cortes de implementación

1. Dominio/state model: AnalysisRun, PR/HEAD, attempts, states y repository binding.
2. Repository binding user-centric: discovery OAuth efímero, validación App por repositorio, listado de ramas por installation token y persistencia del binding con rama explícita; después Functional Knowledge versionado.
3. GitHub ingress: firma, event normalization, idempotencia y PR lifecycle.
4. Snapshot intelligence: commit SHA, bootstrap/incremental, CHANGESET/INDEX DELTA, símbolos cambiados/impactados.
5. Functional RAG: retrieval multi-source, preguntas, ACTION_REQUIRED y continuation.
6. Validation: baseline, generación, execution profile y clasificación objetiva.
7. Feedback: Checks por SHA, review/freshness y companion PR.
8. PHP: adapters de lenguaje/generación coordinados con el profile real del Sandbox.

Cada corte reutiliza capacidades internas existentes sin conservar APIs, DTOs o adapters de producto paralelos. GitHub se integra mediante un puerto productivo real; fakes se limitan a tests.

## Verificación

- Contract tests para INTEROP-2.2 y fixtures compartidos por copia, no por paquete oculto.
- Tests de discovery sin/ con provider token inválido, repositorio visible sin App, autorización App, ramas por installation token, creación con rama real y webhook firmado/alterado/duplicado.
- Tests de state machine para draft/base change/closed/merged/force-push/new HEAD durante processing o action required.
- Matriz de ownership 404 sobre bindings, Runs, preguntas, conocimiento y publicaciones.
- Casos obligatorios 1-15 de la spec.
- Tests de freshness y garantía de no publicar resultados/propuestas viejos.
- Compatibilidad TypeScript y contract tests PHP antes de habilitar el profile.
- Lint, unit, integration, e2e, build y revisión consolidada antes de cada push.
