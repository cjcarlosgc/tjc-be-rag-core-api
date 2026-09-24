# 011-context-traces — Plan

## Dependencias

- `004-rag-retrieval-context`, `005-test-generation`, `007-artifacts` y `008-experimental-comparison`.
- `spec/transversal/persistence/` para almacenamiento e índices.
- `INTEROP-2.4`, sección 6.7.

## Diseño técnico

- Agregar una cabecera relacional `ContextTrace` indexada por `projectVersionId`, `targetId`, `experimentId`, `experimentRepetitionId`, `attempt` y `current`. El detalle versionado se guarda como JSONB validado por tipo (`RAG` o `AGENT`); los archivos descubiertos se conservan en filas paginables o una estructura equivalente que no obligue a devolverlos todos.
- Extender `ContextBuilder` para producir, junto con `GenerationContext`, decisiones explícitas para candidatos bajo mínimo, fuera de top-K y excluidos por presupuesto. La selección usada por el prompt no cambia.
- Persistir la traza RAG antes de invocar el LLM, de forma atómica o recuperable con el resultado del target. Si el pipeline falla después, la evidencia adquirida sigue consultable al llegar el run a estado terminal.
- Normalizar las respuestas de `WorkspaceAgentTools` en observaciones estructuradas sin alterar el texto efectivamente entregado al modelo. Calcular hashes sobre ese resultado y conservar truncamiento/rangos.
- Resolver hasta tres líneas circundantes desde `ProjectVersion`/`CodeChunk` o desde el snapshot privado mediante un servicio de lectura segura; nunca devolver paths absolutos, signed URLs ni storage keys.
- Implementar el listado paginado de trazas de Experiments, el detalle y el listado paginado de archivos descubiertos, siguiendo exactamente `INTEROP-2.4` §6.7.
- Autorizar consultas con el acceso Reader vigente al Project del experimento y filtrar en repositorio por el experimento visible.

## Validación

- Pruebas de cada motivo de descarte, combinación dual de señales y respeto exacto al token budget.
- Pruebas de orden, vacío, error, truncamiento, hashes, líneas circundantes y paginación de `list_files`.
- Pruebas de retry: historial conservado y último intento por defecto.
- Pruebas de aislamiento entre ProjectVersion y Project autorizado, redacción de secretos y ausencia de chain-of-thought.
- `lint`, `test`, `build` y SDD check antes de cierre.
