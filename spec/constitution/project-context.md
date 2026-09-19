# Contexto operativo del proyecto

**Estado:** APROBADO — SDD 2.1
**Alcance:** frontera de contexto para especificación, implementación y revisión.

## Identidad

`tjc-be-rag-core-api` es el backend principal de RAG Test Studio. Coordina GitHub Integration, conocimiento de código/funcional, generación, validación, jobs, métricas y publicación; el código fuente vive exclusivamente en `app/`.

## Núcleo del producto

El producto valida changesets de Pull Requests mediante RAG semántico-estructural-funcional trazable. Developer Console actúa como control plane y Test Execution Sandbox como ejecutor neutral aislado.

## Invariantes

- Separar recuperación de candidatos de construcción del contexto final.
- Distinguir `CHANGESET` de `INDEX DELTA`, Run de Attempt y resultado objetivo de merge policy.
- Ligar snapshots, contexto, propuestas, evidence y Checks a un HEAD concreto.
- Mantener Functional Knowledge versionado; `No lo sé` no crea regla autoritativa.
- Autorizar Console por Project y separar PlatformUser, GitHub Installation, Repository y Actor.
- Mantener Sandbox ciego a GitHub, usuarios, RAG, reglas funcionales y experimento.
- Preservar `RAG` vs `GENERALIST_AGENT` y evitar atribuir razonamiento interno no observable.
- Mantener compatibilidad TypeScript; desarrollar PHP mediante adapters/perfiles reales.
- No usar mocks frontend como contrato o evidencia; Core/Sandbox no sustituyen capacidades productivas con fakes.

## Dónde vive cada decisión

- Contrato compartido: `spec/contracts/system-contract.md`.
- Transporte/DTOs/estados: `spec/contracts/interoperability-contract.md`.
- Re-baseline: `spec/backlog.md` y `spec/backlog-migration-sdd-2.0.md`.
- Comportamiento Core: `spec/features/013-pr-driven-analysis/` y specs transversales.
- Historia: `CHANGELOG.md`.

## Contexto excluido

No se incorporan personas, reuniones, cronogramas académicos, bibliografía, marco teórico ni handoffs antiguos. El único insumo externo de T-001 es el handoff final contrastado con la spec; solo sus decisiones funcionales aprobadas se consolidan.
