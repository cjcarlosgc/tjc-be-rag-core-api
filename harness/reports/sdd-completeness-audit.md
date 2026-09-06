# Auditoría de completitud del SDD

> Snapshot previo a la consolidación SDD 1.3. Las conclusiones vigentes sobre baseline, validación empresarial, chunking y puertas de decisión están en `spec/` y en `harness/reports/sdd-1.3-decision-consolidation.md`.

**Fecha:** 2026-09-05  
**Alcance:** documentación SDD y harness; no se modificó comportamiento funcional.

## Fuentes contrastadas

- Constitución, backlog, features, transversales, estado y reportes del repositorio.
- Contexto operativo relevante del proyecto de ChatGPT «Nueva tesis pregrado», tratado como insumo externo y contrastado contra `spec/`.

No se importaron papers, marco teórico, nombres de personas, organización académica ni decisiones históricas que no produzcan requisitos implementables.

## Conclusión

El SDD es suficiente para explicar la dirección del producto y el alcance ya implementado de Sprint 1, pero todavía no está completo para ejecutar de forma autónoma todo Sprint 2 y posteriores. La estructura existe; algunos contratos transversales siguen vacíos y ciertas decisiones de detalle deben cerrarse por el work item que realmente bloqueen.

## Áreas sólidas

- Misión, límites, roadmap y arquitectura general del backend RAG.
- Stack vigente: NestJS/TypeScript, PostgreSQL + pgvector en Supabase y cola DB-backed.
- Object Storage: Supabase Storage mediante `@supabase/supabase-js`, detrás de `ObjectStorageService`.
- Features 001–009 con trío `spec.md` + `plan.md` + `tasks.md` y trazabilidad al backlog.
- Separación conceptual entre RAG y baseline, trazabilidad de resultados y evolución por niveles.

## Vacíos que requieren refinamiento

Los siguientes documentos existen, pero su sección `Reglas y comportamiento` no contiene todavía un contrato operativo:

- `spec/transversal/async-jobs/spec.md`
- `spec/transversal/errors/spec.md`
- `spec/transversal/experimental-metrics/spec.md`
- `spec/transversal/observability/spec.md`
- `spec/transversal/persistence/spec.md`
- `spec/transversal/providers/spec.md`

Esto no debe bloquear indiscriminadamente todo trabajo. Al seleccionar una feature, el analyst debe completar o abrir decisiones únicamente en los transversales que esa feature referencie.

También conviene hacer explícito, antes de cambiar o usar experimentalmente la indexación en Sprint 2, el contrato vigente de chunking: unidad, límites, solapamiento si aplica, metadatos, estabilidad de IDs y relación con símbolos/imports. El proyecto académico aún exploraba ese detalle; por tanto, no se infirió aquí una estrategia nueva ni se reabrió automáticamente la implementación existente.

## Contradicciones externas filtradas

- Contexto histórico mencionaba modos `METHOD|CLASS|FILE|MODULE|PROJECT`; la spec canónica vigente define `TARGET|CLASS_ALL|CLASS_MISSING|PROJECT_MISSING|PROJECT_ALL`. Se conserva la spec.
- Contexto histórico recomendaba S3/`@aws-sdk/client-s3`; la decisión aprobada vigente es Supabase Storage mediante `@supabase/supabase-js` y `ObjectStorageService`. Se conserva la decisión vigente.
- La noción externa de recuperación híbrida coincide con la arquitectura actual: candidatos semánticos más dependencias estructurales, distinguiendo recuperación de construcción y presupuesto del contexto. Se incorporó solo como invariante operativo, sin inventar un algoritmo nuevo.

## Mejora aplicada al harness

- Se añadió una frontera de contexto canónica para evitar mezclar tesis académica y contrato de software.
- Se agregó una puerta de decisiones por work item, con IDs estables y alcance `Blocks`.
- Se reforzaron los roles de analyst, implementer, leader y reviewer para no inventar decisiones ni bloquear por pendientes no relacionados.
- Se documentó cómo procesar handoffs externos antes de modificar la fuente de verdad.

## Resultado de esta actualización

No se cerró ninguna decisión funcional, no se cambió el alcance de una feature y no se modificó código de `app/`. Los próximos refinamientos deben ocurrir al seleccionar el primer corte de Sprint 2, con preguntas concretas solo cuando un vacío afecte ese corte.

## Validación

- `git diff --check`: correcto.
- `jq empty harness/state.json`: correcto.
- `pnpm lint`: correcto.
- `pnpm test`: 13 archivos y 65 pruebas aprobadas.
- `pnpm build`: correcto.
