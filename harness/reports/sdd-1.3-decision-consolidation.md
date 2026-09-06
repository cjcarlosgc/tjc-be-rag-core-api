# Consolidación de decisiones SDD 1.3

**Fecha:** 2026-09-05

**Alcance:** SDD y harness; sin cambios en `app/`.

## Decisiones aprobadas consolidadas

- V1 procesa exclusivamente TypeScript (`.ts/.tsx`); “ecosistema JavaScript/TypeScript” es delimitación académica, no soporte de JavaScript puro.
- La comparación principal es RAG especializado vs `GENERALIST_AGENT` con exploración read-only controlada y trazable del mismo snapshot. Queda supersedido el baseline sin contexto/exploración.
- La validación final debe producir evidencia en el área de desarrollo de una empresa real. Repositorios públicos/controlados quedan como apoyo de desarrollo o prevalidación.
- La solución se materializa en dos backends (`rag-core-api`, `test-execution-sandbox`) y un frontend (`rag-developer-console`).
- Supabase Storage mediante `@supabase/supabase-js` detrás de `ObjectStorageService`; PostgreSQL + pgvector y cola DB-backed en Supabase permanecen sin cambios.
- `text-embedding-3-small` es default provisional, no selección definitiva ni evidencia de superioridad.

## Decisiones PENDING y alcance

- `DEC-CHUNK-001`: bloquea retrieval/context definitivo; decidir si se conserva o refina el chunking implementado.
- `DEC-EMB-001`: bloquea vector retrieval definitivo y cualquier consolidación de dimensionalidad; evaluar `text-embedding-3-small`, `voyage-code-4` u otra alternativa con evidencia.
- `DEC-EXP-002`: bloquea HU19; definir herramientas, límites, trazabilidad y paridad del agente generalista.
- `DEC-RAG-001`: investigación posterior al núcleo de Sprint 2 sobre señal test-aware; no bloquea el retrieval híbrido base.
- `DEC-MET-001`: investigación posterior al núcleo de Sprint 2 sobre mutation score/StrykerJS; no bloquea HU19 ni autoriza implementación.
- `DEC-VAL-001`: bloquea únicamente despliegue/validación empresarial; definir seguridad, tratamiento de código privado, cuentas, retención y evidencia.

## Chunking y servicios verificados

El contexto externo no cerró una estrategia exacta de chunking: la conversación terminó cuando empezaba ese refinamiento. El código de Sprint 1 sí implementa chunks por declaración top-level (`CLASS`, `FUNCTION`, `INTERFACE`, `TYPE_ALIAS`, `ENUM`) y fallback `FILE`; no separa métodos dentro de clases, no limita declaraciones extensas y genera nuevos IDs al persistir.

El SDD 1.3 registra ese comportamiento y las responsabilidades actuales de `FileDiscoveryService`, `TypeScriptParserService`, `TestTargetExtractorService`, `ExistingTestResolverService`, `EmbeddingProvider`, repositorios de persistencia e `IndexingJobHandler`. No confunde ese hecho implementado con la decisión investigativa definitiva.

## Opciones descartadas

- Prohibición general de recuperar pruebas existentes por supuesto leakage.
- Ablación obligatoria semántico vs estructural vs híbrido.
- JavaScript puro en V1.
- Baseline compuesto por LLM aislado del repositorio.

## Modelo documental

No se crea un registro central duplicado. La decisión vive en la spec dueña del contrato; `CHANGELOG.md` conserva su historia; `harness/state.json` registra solo los IDs que afectan el work item activo.

## Validación

- `git diff --check`: correcto.
- `jq empty harness/state.json`: correcto.
- `pnpm lint`: correcto.
- `pnpm test`: 13 archivos y 65 pruebas aprobadas.
- `pnpm build`: correcto.
